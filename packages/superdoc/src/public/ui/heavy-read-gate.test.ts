import type { TrackChangesListResult } from '@superdoc/document-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { AsyncReadEntry } from './async-read-cache.js';
import { createSuperDocUI } from './create-super-doc-ui.js';
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
    shouldRefreshActiveContentControls: () => false,
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

  it('demands a directory catalog while leased and drops the demand on last release', () => {
    const ctx = setup();
    const releaseA = ctx.gate.acquireDirectoryLease('comments');
    const releaseB = ctx.gate.acquireDirectoryLease('comments');
    releaseA();
    releaseA();
    ctx.setHost(loadingHost('source-loading').host);
    expect(ctx.gate.holdsHeavyRead('comments', 'tok-1')).toBe(false);
    releaseB();
    expect(ctx.gate.holdsHeavyRead('comments', 'tok-1')).toBe(true);
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

  it('resets demand, coverage and the subscription for a new editor', () => {
    const ctx = setup();
    const loading = loadingHost('source-loading');
    ctx.setHost(loading.host);
    ctx.gate.demandHeavyDocRead('comments');
    ctx.gate.noteTrackChangesDirectoryRead('trackChanges', 'tok-1', 'partial');
    ctx.gate.resetForEditor();
    expect(loading.off).toHaveBeenCalledTimes(1);
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
    vi.advanceTimersByTime(HEAVY_READ_IDLE_MS * 2);
    expect(ctx.deps.recompute).not.toHaveBeenCalled();
  });
});

type SourceStage = 'source-loading' | 'source-complete';
type LoadingSupport = 'subscribe' | 'no-subscribe' | 'subscribe-throws';
type TrackChangesReply = () => TrackChangesListResult | Promise<TrackChangesListResult>;

function trackedChanges(ids: string[], coverage: 'complete' | 'partial' = 'complete'): TrackChangesListResult {
  const result: TrackChangesListResult = {
    evaluatedRevision: 'r1',
    total: ids.length,
    items: ids.map((id) => ({
      id,
      handle: { ref: `tracked-change:${id}`, refStability: 'stable', targetKind: 'trackedChange' },
      address: { kind: 'entity', entityType: 'trackedChange', entityId: id },
      type: 'insertion',
    })),
    page: { limit: ids.length, offset: 0, returned: ids.length },
  };
  return coverage === 'partial' ? Object.assign(result, { complete: false }) : result;
}

function describeTrackedChanges(result: TrackChangesListResult): string {
  const coverage = Reflect.get(result, 'complete') === false ? ' (partial coverage)' : '';
  return `[${result.items.map((item) => item.id).join(', ')}]${coverage}`;
}

function uiEditor(options: { stage: SourceStage; loading: LoadingSupport; trackChanges: TrackChangesReply[] }) {
  let stage = options.stage;
  const reads: string[] = [];
  const loadingListeners = new Set<LoadingListener>();
  const eventListeners = new Set<(event: Record<string, unknown>) => void>();
  let trackChangesCall = 0;
  const doc = {
    selection: {
      current: () => ({
        empty: true,
        target: null,
        selectionTarget: null,
        activeMarks: [],
        activeCommentIds: [],
        activeChangeIds: [],
      }),
    },
    comments: {
      list: () => {
        reads.push('doc.comments.list() -> [c-1]');
        return {
          evaluatedRevision: 'r1',
          total: 1,
          items: [
            {
              id: 'c-1',
              handle: { ref: 'comment:c-1', refStability: 'stable' as const, targetKind: 'comment' as const },
              address: { kind: 'entity' as const, entityType: 'comment' as const, entityId: 'c-1' },
              status: 'open' as const,
            },
          ],
          page: { limit: 1, offset: 0, returned: 1 },
        };
      },
    },
    trackChanges: {
      list: (input: unknown) => {
        const reply = options.trackChanges[Math.min(trackChangesCall, options.trackChanges.length - 1)];
        trackChangesCall += 1;
        const result = reply ? reply() : trackedChanges([]);
        const label = `doc.trackChanges.list(${JSON.stringify(input)})`;
        if (result instanceof Promise) {
          reads.push(`${label} -> (in flight)`);
          void result.then((settled) => reads.push(`${label} settled -> ${describeTrackedChanges(settled)}`));
        } else {
          reads.push(`${label} -> ${describeTrackedChanges(result)}`);
        }
        return result;
      },
    },
    contentControls: {
      list: () => {
        reads.push('doc.contentControls.list() -> []');
        return { items: [], total: 0 };
      },
      listInRange: () => ({ items: [], total: 0 }),
    },
  };
  const host: LooseRecord = {
    getHandles: () => ({ editing: { selection: { subscribe: () => () => undefined } } }),
    readLiveSelectionSyncSnapshot: () => ({ empty: true, target: null, selectionTarget: null }),
    getDocumentLoadingSnapshot: () => ({ sourceStage: stage }),
    events: {
      subscribe: (listener: (event: Record<string, unknown>) => void) => {
        eventListeners.add(listener);
        return () => eventListeners.delete(listener);
      },
    },
  };
  if (options.loading === 'subscribe') {
    host.subscribeDocumentLoading = (listener: LoadingListener) => {
      loadingListeners.add(listener);
      return () => loadingListeners.delete(listener);
    };
  }
  if (options.loading === 'subscribe-throws') {
    host.subscribeDocumentLoading = () => {
      throw new Error('loading events unavailable');
    };
  }
  const editor = { doc, host };
  const superdoc = { activeEditor: editor, config: { documentMode: 'editing' }, on: () => {}, off: () => {} };
  const ui = createSuperDocUI({ superdoc });
  const log: string[] = [];
  return {
    ui,
    setStage: (next: SourceStage) => {
      stage = next;
    },
    emitStage: (next: SourceStage) => {
      stage = next;
      for (const listener of [...loadingListeners]) listener({ sourceStage: next });
    },
    emitEdit: () => {
      for (const listener of [...eventListeners]) listener({ type: 'mutation:committed', origin: 'command' });
    },
    async step(label: string) {
      for (let index = 0; index < 4; index += 1) await Promise.resolve();
      const comments = ui.comments.getSnapshot();
      const trackChanges = ui.trackChanges.getSnapshot();
      log.push(
        `step: ${label}`,
        ...(reads.length > 0 ? reads.splice(0).map((read) => `  read ${read}`) : ['  no reads']),
        `  comments: ${comments.listStatus} [${comments.items.map((item) => item.id).join(', ')}]`,
        `  trackChanges: ${trackChanges.listStatus} [${trackChanges.items.map((item) => item.id).join(', ')}]`,
        '',
      );
    },
    recording: () => log.join('\n'),
  };
}

describe('heavy reads through createSuperDocUI', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const recordingPath = (name: string) => `./__snapshots__/heavy-read-gate/${name}.txt`;

  it('re-reads a partial tracked-change directory once when the source completes', async () => {
    const fake = uiEditor({
      stage: 'source-loading',
      loading: 'subscribe',
      trackChanges: [() => trackedChanges(['tc-a'], 'partial'), () => trackedChanges(['tc-a', 'tc-b'])],
    });
    await fake.step('mount while the source is loading');
    fake.ui.trackChanges.list();
    await fake.step('ui.trackChanges.list()');
    fake.emitStage('source-complete');
    await fake.step('the source completes');
    await vi.advanceTimersByTimeAsync(HEAVY_READ_IDLE_MS);
    await fake.step(`input stays idle for ${HEAVY_READ_IDLE_MS}ms`);
    fake.emitStage('source-complete');
    await vi.advanceTimersByTimeAsync(HEAVY_READ_IDLE_MS);
    await fake.step('the host reports source-complete again');
    fake.ui.destroy();
    await expect(fake.recording()).toMatchFileSnapshot(recordingPath('partial-directory-refresh'));
  });

  it('re-reads a directory that is still partial after the source completes only once', async () => {
    const fake = uiEditor({
      stage: 'source-loading',
      loading: 'subscribe',
      trackChanges: [
        () => trackedChanges(['tc-a'], 'partial'),
        () => trackedChanges(['tc-a', 'tc-b'], 'partial'),
        () => trackedChanges(['tc-a', 'tc-b', 'tc-c']),
      ],
    });
    await fake.step('mount while the source is loading');
    fake.ui.trackChanges.list();
    await fake.step('ui.trackChanges.list()');
    fake.emitStage('source-complete');
    await fake.step('the source completes');
    fake.emitStage('source-complete');
    await fake.step('the host reports source-complete again');
    fake.ui.destroy();
    await expect(fake.recording()).toMatchFileSnapshot(recordingPath('partial-directory-still-partial'));
  });

  it('re-reads a partial directory that arrives after the source already completed', async () => {
    const fake = uiEditor({
      stage: 'source-complete',
      loading: 'subscribe',
      trackChanges: [() => trackedChanges(['tc-a'], 'partial'), () => trackedChanges(['tc-a', 'tc-b'])],
    });
    await fake.step('mount after the source completed');
    await vi.advanceTimersByTimeAsync(HEAVY_READ_IDLE_MS);
    await fake.step(`input stays idle for ${HEAVY_READ_IDLE_MS}ms`);
    fake.ui.destroy();
    await expect(fake.recording()).toMatchFileSnapshot(recordingPath('partial-directory-after-completion'));
  });

  it('does not re-read a partial directory from an older content revision', async () => {
    const fake = uiEditor({
      stage: 'source-loading',
      loading: 'subscribe',
      trackChanges: [() => trackedChanges(['tc-a'], 'partial'), () => trackedChanges(['tc-a', 'tc-b'])],
    });
    await fake.step('mount while the source is loading');
    fake.ui.trackChanges.list();
    await fake.step('ui.trackChanges.list()');
    fake.emitEdit();
    await fake.step('an edit commits');
    fake.emitStage('source-complete');
    await fake.step('the source completes');
    await vi.advanceTimersByTimeAsync(HEAVY_READ_IDLE_MS);
    await fake.step(`input stays idle for ${HEAVY_READ_IDLE_MS}ms`);
    fake.ui.destroy();
    await expect(fake.recording()).toMatchFileSnapshot(recordingPath('partial-directory-older-revision'));
  });

  it.each(['no-subscribe', 'subscribe-throws'] as const)(
    'releases held reads on the retry timer when the host loading subscription is %s',
    async (loading) => {
      const fake = uiEditor({ stage: 'source-loading', loading, trackChanges: [() => trackedChanges(['tc-a'])] });
      await fake.step('mount while the source is loading');
      await vi.advanceTimersByTimeAsync(HEAVY_READ_IDLE_MS);
      await fake.step(`the first retry fires ${HEAVY_READ_IDLE_MS}ms later, still loading`);
      fake.setStage('source-complete');
      await vi.advanceTimersByTimeAsync(HEAVY_READ_IDLE_MS - 1);
      await fake.step(`the source completes silently, ${HEAVY_READ_IDLE_MS - 1}ms later`);
      await vi.advanceTimersByTimeAsync(1 + HEAVY_READ_IDLE_POLL_MS);
      await fake.step(`${1 + HEAVY_READ_IDLE_POLL_MS}ms later`);
      fake.ui.destroy();
      await expect(fake.recording()).toMatchFileSnapshot(recordingPath(`retry-timer-${loading}`));
    },
  );

  it('reuses a tracked-change directory read that is in flight or settled for the current revision', async () => {
    let settleFirst: (result: TrackChangesListResult) => void = () => undefined;
    const fake = uiEditor({
      stage: 'source-loading',
      loading: 'subscribe',
      trackChanges: [
        () =>
          new Promise<TrackChangesListResult>((resolve) => {
            settleFirst = resolve;
          }),
        () => trackedChanges(['tc-a', 'tc-b']),
      ],
    });
    await fake.step('mount while the source is loading');
    fake.ui.trackChanges.list();
    fake.ui.trackChanges.list();
    fake.ui.trackChanges.list();
    await fake.step('ui.trackChanges.list() three times');
    settleFirst(trackedChanges(['tc-a']));
    await fake.step('the directory read settles');
    fake.ui.trackChanges.list();
    fake.ui.trackChanges.list();
    await fake.step('ui.trackChanges.list() twice more');
    fake.emitEdit();
    fake.ui.trackChanges.list();
    await fake.step('an edit commits, then ui.trackChanges.list()');
    fake.ui.destroy();
    await expect(fake.recording()).toMatchFileSnapshot(recordingPath('directory-read-reuse'));
  });
});
