import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { createAsyncReadCache, failureRetryDelayMs } from './async-read-cache.js';

function setup() {
  const recomputeAfterSettle = vi.fn();
  const recomputeWhenRetryDue = vi.fn();
  const cache = createAsyncReadCache({ isDisposed: () => false, recomputeAfterSettle, recomputeWhenRetryDue });
  return { cache, recomputeAfterSettle, recomputeWhenRetryDue };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('async read cache', () => {
  it('settles synchronous reads on the same tick', () => {
    const { cache } = setup();
    const entry = cache.issue(
      'k',
      't1',
      () => 5,
      (raw) => raw,
    );
    expect(entry).toMatchObject({ token: 't1', value: 5, hasSettled: true, inflightToken: null });
    expect(cache.entries.get('k')).toBe(entry);
  });

  it('keeps the previous value while a new token is in flight, then accepts the settle', async () => {
    const { cache, recomputeAfterSettle } = setup();
    cache.issue(
      'k',
      't1',
      () => 'old',
      (raw) => raw,
    );
    const read = deferred<string>();
    expect(
      cache.issue(
        'k',
        't2',
        () => read.promise,
        (raw) => raw,
      ),
    ).toBeNull();
    expect(cache.entries.get('k')).toMatchObject({ token: 't1', value: 'old', inflightToken: 't2' });
    read.resolve('new');
    await cache.entries.get('k')?.settled;
    expect(cache.entries.get('k')).toMatchObject({ token: 't2', value: 'new', hasSettled: true, inflightToken: null });
    await Promise.resolve();
    expect(recomputeAfterSettle).toHaveBeenCalledTimes(1);
  });

  it('drops a resolution whose token is no longer the one in flight', async () => {
    const { cache } = setup();
    const older = deferred<string>();
    const newer = deferred<string>();
    cache.issue(
      'k',
      't1',
      () => older.promise,
      (raw) => raw,
    );
    const olderSettled = cache.entries.get('k')?.settled;
    cache.issue(
      'k',
      't2',
      () => newer.promise,
      (raw) => raw,
    );
    newer.resolve('newer');
    await cache.entries.get('k')?.settled;
    older.resolve('older');
    await olderSettled;
    expect(cache.entries.get('k')).toMatchObject({ token: 't2', value: 'newer' });
  });

  it('coalesces several settles into one recompute', async () => {
    const { cache, recomputeAfterSettle } = setup();
    const first = deferred<number>();
    const second = deferred<number>();
    cache.issue(
      'a',
      't',
      () => first.promise,
      (raw) => raw,
    );
    cache.issue(
      'b',
      't',
      () => second.promise,
      (raw) => raw,
    );
    first.resolve(1);
    second.resolve(2);
    await Promise.all([cache.entries.get('a')?.settled, cache.entries.get('b')?.settled]);
    await Promise.resolve();
    expect(recomputeAfterSettle).toHaveBeenCalledTimes(1);
  });

  it('backs off failed reads exponentially up to five seconds', () => {
    expect([1, 2, 3, 4, 5, 6, 20].map(failureRetryDelayMs)).toEqual([250, 500, 1000, 2000, 4000, 5000, 5000]);
  });

  it('records a failure for the token and recomputes when the retry is due', async () => {
    vi.useFakeTimers();
    const { cache, recomputeWhenRetryDue } = setup();
    const read = deferred<string>();
    cache.issue(
      'k',
      't1',
      () => read.promise,
      (raw) => raw,
    );
    const settled = cache.entries.get('k')?.settled;
    read.reject(new Error('worker busy'));
    await settled;
    expect(cache.entries.get('k')).toMatchObject({ failedToken: 't1', failureCount: 1, inflightToken: null });
    vi.advanceTimersByTime(250);
    expect(recomputeWhenRetryDue).toHaveBeenCalledTimes(1);
  });
});
