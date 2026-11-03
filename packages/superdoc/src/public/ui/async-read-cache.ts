import { isPromiseLike } from './command-results.js';
import { emitUiBenchTiming, readUiBenchRuntime, uiBenchNowMs } from './ui-bench-timing.js';

export type AsyncReadEntry = {
  token: string | null;
  value: unknown;
  hasSettled: boolean;
  inflightToken: string | null;
  failedToken?: string | null;
  failureCount?: number;
  retryAtMs?: number;
  settled?: Promise<void>;
};

export type AsyncReadSettlement = {
  key: string;
  settledAtMs: number;
  commandId: string | null;
  commandKind: string | null;
};

export interface AsyncReadCacheOptions {
  isDisposed: () => boolean;
  recomputeAfterSettle: () => void;
  recomputeWhenRetryDue: () => void;
}

const FAILURE_RETRY_BASE_MS = 250;
const FAILURE_RETRY_MAX_MS = 5_000;

export function failureRetryDelayMs(failureCount: number): number {
  return Math.min(FAILURE_RETRY_MAX_MS, FAILURE_RETRY_BASE_MS * 2 ** Math.min(failureCount - 1, 8));
}

function settledEntry(token: string, value: unknown): AsyncReadEntry {
  return {
    token,
    value,
    hasSettled: true,
    inflightToken: null,
    failedToken: null,
    failureCount: 0,
    retryAtMs: 0,
  };
}

export function createAsyncReadCache(options: AsyncReadCacheOptions) {
  const entries = new Map<string, AsyncReadEntry>();
  const settlements: AsyncReadSettlement[] = [];
  let refreshScheduled = false;
  let failureRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let failureRetryAtMs = 0;

  const isStillInFlight = (key: string, token: string): AsyncReadEntry | null => {
    const entry = entries.get(key);
    return entry && entry.inflightToken === token ? entry : null;
  };

  const scheduleRefresh = (): void => {
    if (refreshScheduled || options.isDisposed()) return;
    refreshScheduled = true;
    const run = (): void => {
      refreshScheduled = false;
      if (!options.isDisposed()) options.recomputeAfterSettle();
    };
    if (typeof queueMicrotask === 'function') queueMicrotask(run);
    else void Promise.resolve().then(run);
  };

  const scheduleFailureRetry = (retryAtMs: number): void => {
    if (options.isDisposed()) return;
    if (failureRetryTimer && failureRetryAtMs <= retryAtMs) return;
    if (failureRetryTimer) clearTimeout(failureRetryTimer);
    failureRetryAtMs = retryAtMs;
    failureRetryTimer = setTimeout(
      () => {
        failureRetryTimer = null;
        failureRetryAtMs = 0;
        if (!options.isDisposed()) options.recomputeWhenRetryDue();
      },
      Math.max(0, retryAtMs - Date.now()),
    );
  };

  const cancelFailureRetry = (): void => {
    if (failureRetryTimer) clearTimeout(failureRetryTimer);
    failureRetryTimer = null;
    failureRetryAtMs = 0;
  };

  const recordSettlement = (key: string): void => {
    const { sink, workerContext } = readUiBenchRuntime();
    if (!sink) return;
    const settledAtMs = uiBenchNowMs();
    const commandId = workerContext?.commandId ?? null;
    const commandKind = workerContext?.commandKind ?? null;
    settlements.push({ key, settledAtMs, commandId, commandKind });
    emitUiBenchTiming({
      stage: 'superdoc-ui-async-read-settled',
      atMs: settledAtMs,
      key,
      settledAtMs,
      commandId,
      commandKind,
    });
  };

  const issue = (
    key: string,
    token: string,
    run: () => unknown,
    normalize: (raw: unknown) => unknown,
  ): AsyncReadEntry | null => {
    let raw: unknown;
    try {
      raw = run();
    } catch {
      raw = undefined;
    }
    if (!isPromiseLike(raw)) {
      const settled = settledEntry(token, normalize(raw));
      entries.set(key, settled);
      return settled;
    }
    const prev = entries.get(key);
    const retryingSameToken = prev?.failedToken === token;
    entries.set(key, {
      token: prev?.token ?? null,
      value: prev?.value ?? null,
      hasSettled: prev?.hasSettled ?? false,
      inflightToken: token,
      failedToken: retryingSameToken ? token : null,
      failureCount: retryingSameToken ? (prev.failureCount ?? 0) : 0,
      retryAtMs: 0,
    });
    const settled = Promise.resolve(raw).then(
      (resolved) => {
        if (!isStillInFlight(key, token)) return;
        entries.set(key, settledEntry(token, normalize(resolved)));
        recordSettlement(key);
        scheduleRefresh();
      },
      () => {
        const entry = isStillInFlight(key, token);
        if (!entry) return;
        const failureCount = entry.failedToken === token ? (entry.failureCount ?? 0) + 1 : 1;
        const retryAtMs = Date.now() + failureRetryDelayMs(failureCount);
        entries.set(key, {
          ...entry,
          settled: undefined,
          inflightToken: null,
          failedToken: token,
          failureCount,
          retryAtMs,
        });
        scheduleFailureRetry(retryAtMs);
      },
    );
    const entry = isStillInFlight(key, token);
    if (entry) entry.settled = settled;
    return null;
  };

  const seed = (key: string, token: string | null, value: unknown, inflightToken: string | null = null): void => {
    entries.set(key, { token, value, hasSettled: true, inflightToken });
  };

  const clearKeys = (predicate: (key: string) => boolean): void => {
    for (const key of entries.keys()) {
      if (predicate(key)) entries.delete(key);
    }
  };

  return {
    entries,
    issue,
    seed,
    clearKeys,
    scheduleRefresh,
    scheduleFailureRetry,
    cancelFailureRetry,
    drainSettlements: (): AsyncReadSettlement[] => settlements.splice(0),
  };
}
