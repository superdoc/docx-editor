import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { AsyncReadEntry } from './async-read-cache.js';
import {
  createHeavyReadGate,
  HEAVY_READ_IDLE_MS,
  HEAVY_READ_IDLE_POLL_MS,
  type HeavyReadGateDeps,
} from './heavy-read-gate.js';
import type { LooseRecord } from './loose-record.js';

type LoadingListener = (snapshot: unknown) => void;

function loadingHost(initialStage: string | undefined) {
  let stage = initialStage;
  const listeners = new Set<LoadingListener>();
  const off = vi.fn();
  const subscribe = vi.fn((listener: LoadingListener) => {
    listeners.add(listener);
    return () => {
      off();
      listeners.delete(listener);
    };
  });
  const host: LooseRecord = {
    getDocumentLoadingSnapshot: () => ({ sourceStage: stage }),
    subscribeDocumentLoading: subscribe,
  };
  return {
    host,
    subscribe,
    off,
    emit(next: string) {
      stage = next;
      for (const listener of listeners) listener({ sourceStage: next });
    },
  };
}

function setup(over: Partial<HeavyReadGateDeps> = {}) {
  let token = 'tok-1';
  let disposed = false;
  let host: LooseRecord | null = null;
  let foregroundActive = false;
  const entries = new Map<string, AsyncReadEntry>();
  const deps = {
    isDisposed: () => disposed,
    currentHost: () => host,
    contentToken: () => token,
    readAsyncEntry: (key: string) => entries.get(key),
    replaceAsyncEntry: vi.fn((key: string, entry: AsyncReadEntry) => {
      entries.set(key, entry);
    }),
    scheduleAsyncRefresh: vi.fn(),
    recompute: vi.fn(),
    foregroundMutationActive: () => foregroundActive,
    scheduleForegroundAsyncRetry: vi.fn(),
    ...over,
  };
  const gate = createHeavyReadGate(deps);
  return {
    gate,
    deps,
    entries,
    setToken: (next: string) => {
      token = next;
    },
    setHost: (next: LooseRecord | null) => {
      host = next;
    },
    setDisposed: () => {
      disposed = true;
    },
    setForegroundActive: (next: boolean) => {
      foregroundActive = next;
    },
  };
}

function settled(token: string | null, value: unknown): AsyncReadEntry {
  return { token, value, hasSettled: true, inflightToken: null };
}

describe('createHeavyReadGate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('maps loading snapshot stages to a tri-state phase', () => {
    const ctx = setup();
    expect(ctx.gate.hostSourceLoadPhase()).toBe('unknown');
    for (const stage of ['opening', 'bootstrap-ready', 'source-loading']) {
      ctx.setHost(loadingHost(stage).host);
      expect(ctx.gate.hostSourceLoadPhase()).toBe('loading');
    }
    for (const stage of ['source-complete', 'source-failed', 'source-cancelled']) {
      ctx.setHost(loadingHost(stage).host);
      expect(ctx.gate.hostSourceLoadPhase()).toBe('complete');
    }
    ctx.setHost(loadingHost('mystery').host);
    expect(ctx.gate.hostSourceLoadPhase()).toBe('unknown');
    ctx.setHost({
      getDocumentLoadingSnapshot: () => {
        throw new Error('boom');
      },
    });
    expect(ctx.gate.hostSourceLoadPhase()).toBe('unknown');
  });

  it('keeps a surface that is still opening or preparing in the loading phase unless it failed', () => {
    const ctx = setup();
    for (const phase of ['opening', 'preparing']) {
      ctx.setHost({ getDocumentLoadingSnapshot: () => ({ sourceStage: 'source-complete', phase }) });
      expect(ctx.gate.hostSourceLoadPhase()).toBe('loading');
      ctx.setHost({ getDocumentLoadingSnapshot: () => ({ sourceStage: 'source-failed', phase, terminal: 'failed' }) });
      expect(ctx.gate.hostSourceLoadPhase()).toBe('complete');
    }
  });

  it('never holds non-heavy keys', () => {
    const ctx = setup();
    ctx.setHost(loadingHost('source-loading').host);
    expect(ctx.gate.holdsHeavyRead('selection', 'tok-1')).toBe(false);
    expect(ctx.gate.holdsHeavyRead('query:x', 'tok-1')).toBe(false);
  });

  it('holds heavy reads while loading and subscribes once per host', () => {
    const ctx = setup();
    const loading = loadingHost('source-loading');
    ctx.setHost(loading.host);
    expect(ctx.gate.holdsHeavyRead('comments', 'tok-1')).toBe(true);
    expect(ctx.gate.holdsHeavyRead('trackChanges', 'tok-1')).toBe(true);
    expect(loading.subscribe).toHaveBeenCalledTimes(1);
  });

  it('lets explicit demand bypass the hold for one content token', () => {
    const ctx = setup();
    ctx.setHost(loadingHost('source-loading').host);
    ctx.gate.demandHeavyDocRead('comments');
    ctx.gate.demandHeavyDocRead('comments');
    expect(ctx.deps.scheduleAsyncRefresh).toHaveBeenCalledTimes(1);
    expect(ctx.gate.holdsHeavyRead('comments', 'tok-1')).toBe(false);
    ctx.setToken('tok-2');
    expect(ctx.gate.holdsHeavyRead('comments', 'tok-2')).toBe(true);
  });

  it('releases held reads only after the source completes and input stays idle', () => {
    const ctx = setup();
    const loading = loadingHost('source-loading');
    ctx.setHost(loading.host);
    expect(ctx.gate.holdsHeavyRead('comments', 'tok-1')).toBe(true);

    loading.emit('source-complete');
    expect(ctx.gate.holdsHeavyRead('comments', 'tok-1')).toBe(true);
    vi.advanceTimersByTime(HEAVY_READ_IDLE_MS - HEAVY_READ_IDLE_POLL_MS);
    expect(ctx.deps.recompute).not.toHaveBeenCalled();
    vi.advanceTimersByTime(HEAVY_READ_IDLE_POLL_MS * 2);
    expect(ctx.deps.recompute).toHaveBeenCalledTimes(1);
    expect(ctx.gate.holdsHeavyRead('comments', 'tok-1')).toBe(false);
  });

  it('keeps polling while a foreground mutation is active', () => {
    const ctx = setup();
    ctx.setForegroundActive(true);
    ctx.gate.holdHeavyReadsUntilIdle();
    ctx.gate.scheduleHeavyReadCompletionRecompute();
    vi.advanceTimersByTime(HEAVY_READ_IDLE_POLL_MS * 4);
    expect(ctx.deps.recompute).not.toHaveBeenCalled();
    ctx.setForegroundActive(false);
    vi.advanceTimersByTime(HEAVY_READ_IDLE_POLL_MS);
    expect(ctx.deps.recompute).toHaveBeenCalledTimes(1);
  });

  it('holds heavy reads for the idle window after a typing burst', () => {
    const ctx = setup();
    ctx.gate.noteTypingBurst();
    expect(ctx.gate.typingIsRecent()).toBe(true);
    vi.setSystemTime(100_000 + HEAVY_READ_IDLE_MS);
    expect(ctx.gate.typingIsRecent()).toBe(false);
  });

  it('subscribes before the confirming read so a completion between them is not lost', () => {
    const ctx = setup();
    const calls: string[] = [];
    let stage = 'source-loading';
    ctx.setHost({
      getDocumentLoadingSnapshot: () => {
        calls.push('read');
        return { sourceStage: stage };
      },
      subscribeDocumentLoading: () => {
        calls.push('subscribe');
        stage = 'source-complete';
        return () => undefined;
      },
    });
    expect(ctx.gate.holdsHeavyRead('comments', 'tok-1')).toBe(true);
    expect(calls).toEqual(['read', 'subscribe', 'read']);
    vi.advanceTimersByTime(HEAVY_READ_IDLE_MS + HEAVY_READ_IDLE_POLL_MS);
    expect(ctx.deps.recompute).toHaveBeenCalledTimes(1);
  });

  it('falls back to the retry timer when the host cannot subscribe', () => {
    const ctx = setup();
    ctx.setHost({ getDocumentLoadingSnapshot: () => ({ sourceStage: 'source-loading' }) });
    expect(ctx.gate.holdsHeavyRead('comments', 'tok-1')).toBe(true);
    expect(ctx.gate.holdsHeavyRead('comments', 'tok-1')).toBe(true);
    expect(ctx.deps.scheduleForegroundAsyncRetry).toHaveBeenCalledTimes(2);
    expect(ctx.deps.scheduleForegroundAsyncRetry).toHaveBeenCalledWith(HEAVY_READ_IDLE_MS);
  });

  it('falls back to the retry timer when subscribing throws', () => {
    const ctx = setup();
    ctx.setHost({
      getDocumentLoadingSnapshot: () => ({ sourceStage: 'source-loading' }),
      subscribeDocumentLoading: () => {
        throw new Error('nope');
      },
    });
    expect(ctx.gate.holdsHeavyRead('comments', 'tok-1')).toBe(true);
    expect(ctx.deps.scheduleForegroundAsyncRetry).toHaveBeenCalledWith(HEAVY_READ_IDLE_MS);
  });

  it('demands a directory catalog while leased and drops the demand on last release', () => {
    const ctx = setup();
    const releaseA = ctx.gate.acquireDirectoryLease('comments');
    const releaseB = ctx.gate.acquireDirectoryLease('comments');
    expect(ctx.gate.directoryLeaseCounts.comments).toBe(2);
    releaseA();
    releaseA();
    expect(ctx.gate.directoryLeaseCounts.comments).toBe(1);
    ctx.setHost(loadingHost('source-loading').host);
    expect(ctx.gate.holdsHeavyRead('comments', 'tok-1')).toBe(false);
    releaseB();
    expect(ctx.gate.directoryLeaseCounts.comments).toBe(0);
    expect(ctx.gate.holdsHeavyRead('comments', 'tok-1')).toBe(true);
  });

  it('reuses a catalog read already started or settled for the current revision', () => {
    const ctx = setup();
    ctx.entries.set('trackChanges', { token: null, value: null, hasSettled: false, inflightToken: 'tok-1' });
    ctx.gate.ensureTrackChangesCatalog();
    expect(ctx.deps.scheduleAsyncRefresh).not.toHaveBeenCalled();
    ctx.entries.set('comments', settled('tok-1', []));
    ctx.gate.ensureCommentsCatalog();
    expect(ctx.deps.scheduleAsyncRefresh).not.toHaveBeenCalled();
    ctx.entries.delete('comments');
    ctx.gate.ensureCommentsCatalog();
    expect(ctx.deps.scheduleAsyncRefresh).toHaveBeenCalledTimes(1);
  });

  it.each(['settled', 'inflight'] as const)(
    'explicit comments demand refreshes a %s catalog from an older revision',
    (state) => {
      const ctx = setup();
      ctx.setHost(loadingHost('source-loading').host);
      ctx.entries.set(
        'comments',
        state === 'settled'
          ? settled('tok-0', [{ id: 'old' }])
          : { token: null, value: null, hasSettled: false, inflightToken: 'tok-0' },
      );
      expect(ctx.gate.holdsHeavyRead('comments', 'tok-1')).toBe(true);
      ctx.gate.ensureCommentsCatalog();
      expect(ctx.gate.holdsHeavyRead('comments', 'tok-1')).toBe(false);
      expect(ctx.deps.scheduleAsyncRefresh).toHaveBeenCalledTimes(1);
      ctx.gate.ensureCommentsCatalog();
      expect(ctx.deps.scheduleAsyncRefresh).toHaveBeenCalledTimes(1);
      expect(ctx.gate.holdsHeavyRead('trackChanges', 'tok-1')).toBe(true);
    },
  );

  it('keeps an older comments catalog behind the typing hold until input is idle', () => {
    const ctx = setup();
    ctx.entries.set('comments', settled('tok-0', [{ id: 'old' }]));
    ctx.gate.noteTypingBurst();
    ctx.gate.ensureCommentsCatalog();
    expect(ctx.gate.holdsHeavyRead('comments', 'tok-1')).toBe(true);
    expect(ctx.deps.scheduleAsyncRefresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(HEAVY_READ_IDLE_MS);
    ctx.gate.ensureCommentsCatalog();
    expect(ctx.gate.holdsHeavyRead('comments', 'tok-1')).toBe(false);
    expect(ctx.deps.scheduleAsyncRefresh).toHaveBeenCalledTimes(1);
  });

  it('reports whether the comments catalog may have rows', () => {
    const ctx = setup();
    expect(ctx.gate.commentsCatalogMayHaveRows()).toBe(false);
    ctx.entries.set('comments', { token: null, value: null, hasSettled: false, inflightToken: 'tok-1' });
    expect(ctx.gate.commentsCatalogMayHaveRows()).toBe(true);
    ctx.entries.set('comments', settled('tok-1', []));
    expect(ctx.gate.commentsCatalogMayHaveRows()).toBe(false);
    ctx.entries.set('comments', settled('tok-1', [{ id: 'c1' }]));
    expect(ctx.gate.commentsCatalogMayHaveRows()).toBe(true);
  });

  it('refreshes a partial tracked-change directory once when the source completes', () => {
    const ctx = setup();
    const loading = loadingHost('source-loading');
    ctx.setHost(loading.host);
    ctx.gate.noteTrackChangesDirectoryRead('trackChanges', 'tok-1', 'partial');
    expect(ctx.gate.incompleteTrackChangesDirectoryReadTokens.get('trackChanges')).toBe('tok-1');
    ctx.entries.set('trackChanges', settled('tok-1', [{ id: 'a' }]));

    loading.emit('source-complete');
    expect(ctx.deps.replaceAsyncEntry).toHaveBeenCalledWith('trackChanges', {
      token: null,
      value: [{ id: 'a' }],
      hasSettled: true,
      inflightToken: null,
    });
    expect(ctx.deps.scheduleAsyncRefresh).toHaveBeenCalledTimes(1);

    ctx.entries.set('trackChanges', settled('tok-1', [{ id: 'a' }]));
    ctx.gate.noteSourceComplete();
    expect(ctx.deps.replaceAsyncEntry).toHaveBeenCalledTimes(1);

    ctx.gate.noteTrackChangesDirectoryRead('trackChanges', 'tok-1', 'complete');
    expect(ctx.gate.incompleteTrackChangesDirectoryReadTokens.has('trackChanges')).toBe(false);
  });

  it('queues the refresh after storage when completion was already observed', async () => {
    const ctx = setup();
    ctx.setHost(loadingHost('source-complete').host);
    ctx.gate.noteTrackChangesDirectoryRead('trackChanges', 'tok-1', 'partial');
    expect(ctx.deps.replaceAsyncEntry).not.toHaveBeenCalled();
    ctx.entries.set('trackChanges', settled('tok-1', []));
    await Promise.resolve();
    expect(ctx.deps.replaceAsyncEntry).toHaveBeenCalledTimes(1);
  });

  it('drops partial-coverage tokens from an older content revision', () => {
    const ctx = setup();
    ctx.gate.noteTrackChangesDirectoryRead('trackChanges', 'tok-1', 'partial');
    ctx.setToken('tok-2');
    ctx.gate.noteSourceComplete();
    expect(ctx.gate.incompleteTrackChangesDirectoryReadTokens.size).toBe(0);
    expect(ctx.deps.replaceAsyncEntry).not.toHaveBeenCalled();
  });

  it('resets demand, coverage and the subscription for a new editor', () => {
    const ctx = setup();
    const loading = loadingHost('source-loading');
    ctx.setHost(loading.host);
    ctx.gate.demandHeavyDocRead('comments');
    ctx.gate.noteTrackChangesDirectoryRead('trackChanges', 'tok-1', 'partial');
    ctx.gate.resetForEditor();
    expect(loading.off).toHaveBeenCalledTimes(1);
    expect(ctx.gate.incompleteTrackChangesDirectoryReadTokens.size).toBe(0);
    expect(ctx.gate.holdsHeavyRead('comments', 'tok-1')).toBe(true);
    expect(loading.subscribe).toHaveBeenCalledTimes(2);
  });

  it('clears timers, leases and the subscription on dispose', () => {
    const ctx = setup();
    const loading = loadingHost('source-loading');
    ctx.setHost(loading.host);
    ctx.gate.acquireDirectoryLease('trackChanges');
    ctx.gate.holdsHeavyRead('comments', 'tok-1');
    ctx.gate.scheduleHeavyReadCompletionRecompute();
    ctx.gate.dispose();
    ctx.setDisposed();
    expect(loading.off).toHaveBeenCalledTimes(1);
    expect(ctx.gate.directoryLeaseCounts.trackChanges).toBe(0);
    vi.advanceTimersByTime(HEAVY_READ_IDLE_MS * 2);
    expect(ctx.deps.recompute).not.toHaveBeenCalled();
  });
});
