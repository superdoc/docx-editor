import type { AsyncReadEntry } from './async-read-cache.js';
import { safeCall } from './command-results.js';
import { isHeavyDocReadKey } from './heavy-read-policy.js';
import type { LooseRecord } from './loose-record.js';

export const HEAVY_READ_IDLE_MS = 6500;
export const HEAVY_READ_IDLE_POLL_MS = 250;

export const DIRECTORY_FAMILIES = ['comments', 'trackChanges', 'contentControls'] as const;
export type DirectoryFamily = (typeof DIRECTORY_FAMILIES)[number];

export type SourceLoadPhase = 'loading' | 'complete' | 'unknown';
export type TrackChangesDirectoryCoverage = 'complete' | 'partial';

const SOURCE_STAGES_STILL_LOADING: ReadonlySet<unknown> = new Set(['opening', 'bootstrap-ready', 'source-loading']);
const SOURCE_STAGES_TERMINAL: ReadonlySet<unknown> = new Set(['source-complete', 'source-failed', 'source-cancelled']);

function snapshotField(snapshot: unknown, field: string): unknown {
  return snapshot === null || snapshot === undefined ? undefined : Reflect.get(Object(snapshot), field, snapshot);
}

function sourceStageOf(snapshot: unknown): unknown {
  return snapshotField(snapshot, 'sourceStage');
}

function surfaceStillOpening(snapshot: unknown): boolean {
  const phase = snapshotField(snapshot, 'phase');
  return (phase === 'opening' || phase === 'preparing') && snapshotField(snapshot, 'terminal') !== 'failed';
}

export interface HeavyReadGateDeps {
  isDisposed: () => boolean;
  currentHost: () => LooseRecord | null;
  contentToken: () => string;
  readAsyncEntry: (key: string) => AsyncReadEntry | undefined;
  replaceAsyncEntry: (key: string, entry: AsyncReadEntry) => void;
  scheduleAsyncRefresh: () => void;
  recompute: () => void;
  foregroundMutationActive: () => boolean;
  scheduleForegroundAsyncRetry: (delayMs: number) => void;
}

export interface HeavyReadGate {
  directoryLeaseCounts: Readonly<Record<DirectoryFamily, number>>;
  incompleteTrackChangesDirectoryReadTokens: ReadonlyMap<string, string>;
  hostSourceLoadPhase: () => SourceLoadPhase;
  holdsHeavyRead: (key: string, token: string) => boolean;
  typingIsRecent: () => boolean;
  demandHeavyDocRead: (key: string) => void;
  acquireDirectoryLease: (family: DirectoryFamily) => () => void;
  ensureTrackChangesCatalog: () => void;
  ensureCommentsCatalog: () => void;
  commentsCatalogMayHaveRows: () => boolean;
  noteTrackChangesDirectoryRead: (key: string, token: string, coverage: TrackChangesDirectoryCoverage) => void;
  noteSourceComplete: () => void;
  noteEditableActivity: () => void;
  noteTypingBurst: () => void;
  holdHeavyReadsUntilIdle: () => void;
  scheduleHeavyReadCompletionRecompute: () => void;
  invalidateSourceCoverage: () => void;
  resetForEditor: () => void;
  dispose: () => void;
}

export function createHeavyReadGate(deps: HeavyReadGateDeps): HeavyReadGate {
  const demandedHeavyReadTokens = new Map<string, string>();
  const incompleteTrackChangesDirectoryReadTokens = new Map<string, string>();
  const postSourceCompletionRefreshTokens = new Map<string, string>();
  let sourceCompletionObservedToken: string | null = null;
  const directoryLeaseCounts: Record<DirectoryFamily, number> = {
    comments: 0,
    trackChanges: 0,
    contentControls: 0,
  };
  let lastEditableActivityAtMs = 0;
  let lastTypingBurstAtMs = 0;
  let heavyReadsHeldUntilIdle = false;
  let heavyReadCompletionRecomputeTimer: ReturnType<typeof setTimeout> | null = null;
  let sourceLoadingSubscriptionHost: LooseRecord | null = null;
  let detachSourceLoading: (() => void) | null = null;

  const hostSourceLoadPhase = (): SourceLoadPhase => {
    const host = deps.currentHost();
    const read = host?.getDocumentLoadingSnapshot;
    if (typeof read !== 'function') return 'unknown';
    const snapshot = safeCall<unknown>((): unknown => read.call(host), null);
    if (surfaceStillOpening(snapshot)) return 'loading';
    const stage = sourceStageOf(snapshot);
    if (SOURCE_STAGES_STILL_LOADING.has(stage)) return 'loading';
    if (SOURCE_STAGES_TERMINAL.has(stage)) return 'complete';
    return 'unknown';
  };

  const demandHeavyDocRead = (key: string): void => {
    const token = deps.contentToken();
    if (demandedHeavyReadTokens.get(key) === token) return;
    demandedHeavyReadTokens.set(key, token);
    deps.scheduleAsyncRefresh();
  };

  const commentsCatalogMayHaveRows = (): boolean => {
    const entry = deps.readAsyncEntry('comments');
    if (!entry?.hasSettled) return entry?.inflightToken != null;
    return Array.isArray(entry.value) && entry.value.length > 0;
  };

  const heavyReadDemandActive = (key: string, token: string): boolean => demandedHeavyReadTokens.get(key) === token;

  const refreshIncompleteTrackChangesDirectories = (): void => {
    const token = deps.contentToken();
    let invalidated = false;
    for (const [key, incompleteToken] of incompleteTrackChangesDirectoryReadTokens) {
      if (incompleteToken !== token) {
        incompleteTrackChangesDirectoryReadTokens.delete(key);
        continue;
      }
      if (postSourceCompletionRefreshTokens.get(key) === token) continue;
      const entry = deps.readAsyncEntry(key);
      if (!entry?.hasSettled || entry.token !== token || entry.inflightToken != null) continue;
      deps.replaceAsyncEntry(key, { ...entry, token: null, inflightToken: null });
      postSourceCompletionRefreshTokens.set(key, token);
      invalidated = true;
    }
    if (invalidated) deps.scheduleAsyncRefresh();
  };

  const acquireDirectoryLease = (family: DirectoryFamily): (() => void) => {
    directoryLeaseCounts[family] += 1;

    demandHeavyDocRead(family);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      directoryLeaseCounts[family] = Math.max(0, directoryLeaseCounts[family] - 1);
      if (directoryLeaseCounts[family] === 0 && demandedHeavyReadTokens.get(family) === deps.contentToken()) {
        demandedHeavyReadTokens.delete(family);
      }
      deps.scheduleAsyncRefresh();
    };
  };

  const demandCurrentCatalog = (key: DirectoryFamily): void => {
    const entry = deps.readAsyncEntry(key);
    const token = deps.contentToken();
    if ((entry?.hasSettled && entry.token === token) || entry?.inflightToken === token) return;
    if ((entry?.hasSettled || entry?.inflightToken != null) && typingIsRecent()) return;
    demandHeavyDocRead(key);
  };

  const scheduleHeavyReadCompletionRecompute = (): void => {
    if (deps.isDisposed() || heavyReadCompletionRecomputeTimer) return;
    const attempt = (): void => {
      heavyReadCompletionRecomputeTimer = null;
      if (deps.isDisposed()) return;
      const idleForMs = Date.now() - lastEditableActivityAtMs;
      const busy = deps.foregroundMutationActive() || idleForMs < HEAVY_READ_IDLE_MS;
      if (busy) {
        heavyReadCompletionRecomputeTimer = setTimeout(attempt, HEAVY_READ_IDLE_POLL_MS);
        return;
      }
      heavyReadsHeldUntilIdle = false;
      deps.recompute();
    };
    heavyReadCompletionRecomputeTimer = setTimeout(attempt, 0);
  };

  const noteSourceComplete = (): void => {
    sourceCompletionObservedToken = deps.contentToken();
    refreshIncompleteTrackChangesDirectories();
  };

  const retrySourcePhaseWithoutSubscription = (): void => {
    sourceLoadingSubscriptionHost = null;
    deps.scheduleForegroundAsyncRetry(HEAVY_READ_IDLE_MS);
  };

  const armSourceLoadCompletionRecompute = (): void => {
    const host = deps.currentHost();
    if (!host || sourceLoadingSubscriptionHost === host) return;
    if (detachSourceLoading) {
      detachSourceLoading();
      detachSourceLoading = null;
    }
    sourceLoadingSubscriptionHost = host;
    const subscribe = host.subscribeDocumentLoading;
    if (typeof subscribe !== 'function') {
      retrySourcePhaseWithoutSubscription();
      return;
    }
    try {
      const handleLoadingSnapshot = (snapshot: unknown): void => {
        if (!SOURCE_STAGES_TERMINAL.has(sourceStageOf(snapshot)) && snapshotField(snapshot, 'phase') !== 'hidden')
          return;
        noteSourceComplete();
        lastEditableActivityAtMs = Math.max(lastEditableActivityAtMs, Date.now());
        scheduleHeavyReadCompletionRecompute();
      };
      const off: unknown = subscribe.call(host, handleLoadingSnapshot);
      if (typeof off === 'function') {
        detachSourceLoading = () => {
          Reflect.apply(off, undefined, []);
        };
      }
      const read = host.getDocumentLoadingSnapshot;
      if (typeof read === 'function') {
        handleLoadingSnapshot(safeCall<unknown>((): unknown => read.call(host), null));
      }
    } catch {
      retrySourcePhaseWithoutSubscription();
    }
  };

  const typingIsRecent = (): boolean => Date.now() - lastTypingBurstAtMs < HEAVY_READ_IDLE_MS;

  const holdsHeavyRead = (key: string, token: string): boolean => {
    if (!isHeavyDocReadKey(key) || heavyReadDemandActive(key, token)) return false;
    if (hostSourceLoadPhase() === 'loading') {
      heavyReadsHeldUntilIdle = true;
      armSourceLoadCompletionRecompute();
      return true;
    }
    if (heavyReadsHeldUntilIdle || typingIsRecent()) {
      heavyReadsHeldUntilIdle = true;
      scheduleHeavyReadCompletionRecompute();
      return true;
    }
    return false;
  };

  const noteTrackChangesDirectoryRead = (key: string, token: string, coverage: TrackChangesDirectoryCoverage): void => {
    if (coverage === 'complete') {
      if (incompleteTrackChangesDirectoryReadTokens.get(key) === token) {
        incompleteTrackChangesDirectoryReadTokens.delete(key);
      }
      return;
    }
    incompleteTrackChangesDirectoryReadTokens.set(key, token);
    armSourceLoadCompletionRecompute();
    if (sourceCompletionObservedToken === token || hostSourceLoadPhase() === 'complete') {
      const refreshAfterPartialEntryIsStored = (): void => {
        if (!deps.isDisposed()) refreshIncompleteTrackChangesDirectories();
      };
      if (typeof queueMicrotask === 'function') queueMicrotask(refreshAfterPartialEntryIsStored);
      else void Promise.resolve().then(refreshAfterPartialEntryIsStored);
    }
  };

  const invalidateSourceCoverage = (): void => {
    incompleteTrackChangesDirectoryReadTokens.clear();
    postSourceCompletionRefreshTokens.clear();
    sourceCompletionObservedToken = null;
  };

  const detachSourceLoadingSubscription = (): void => {
    if (detachSourceLoading) detachSourceLoading();
    detachSourceLoading = null;
    sourceLoadingSubscriptionHost = null;
  };

  const resetForEditor = (): void => {
    demandedHeavyReadTokens.clear();
    invalidateSourceCoverage();
    heavyReadsHeldUntilIdle = false;
    detachSourceLoadingSubscription();
  };

  const dispose = (): void => {
    if (heavyReadCompletionRecomputeTimer) {
      clearTimeout(heavyReadCompletionRecomputeTimer);
      heavyReadCompletionRecomputeTimer = null;
    }
    detachSourceLoadingSubscription();
    for (const family of DIRECTORY_FAMILIES) {
      directoryLeaseCounts[family] = 0;
    }
    demandedHeavyReadTokens.clear();
    invalidateSourceCoverage();
  };

  return {
    directoryLeaseCounts,
    incompleteTrackChangesDirectoryReadTokens,
    hostSourceLoadPhase,
    holdsHeavyRead,
    typingIsRecent,
    demandHeavyDocRead,
    acquireDirectoryLease,
    ensureTrackChangesCatalog: () => demandCurrentCatalog('trackChanges'),
    ensureCommentsCatalog: () => demandCurrentCatalog('comments'),
    commentsCatalogMayHaveRows,
    noteTrackChangesDirectoryRead,
    noteSourceComplete,
    noteEditableActivity: () => {
      lastEditableActivityAtMs = Date.now();
    },
    noteTypingBurst: () => {
      lastTypingBurstAtMs = Date.now();
    },
    holdHeavyReadsUntilIdle: () => {
      heavyReadsHeldUntilIdle = true;
    },
    scheduleHeavyReadCompletionRecompute,
    invalidateSourceCoverage,
    resetForEditor,
    dispose,
  };
}
