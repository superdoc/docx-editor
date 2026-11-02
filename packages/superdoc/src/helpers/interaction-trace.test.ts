import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import { endInteractionSpan, startInteractionSpan, withInteractionSpan } from './interaction-trace.js';

type Span = { traceId: string; spanId: string };
type Ended = { span: Span; meta: Record<string, unknown> | undefined };

const TRACE_KEY = '__superdocInteractionTrace';
const hadTrace = () => Reflect.has(globalThis, TRACE_KEY);
let previousTrace: unknown;
let previousTraceExisted = false;

function installCollector() {
  const started: Array<{ stage: string; branch: string; meta: Record<string, unknown> | undefined }> = [];
  const ended: Ended[] = [];
  Reflect.set(globalThis, TRACE_KEY, {
    startSpan(stage: string, branch: string, meta: Record<string, unknown> | undefined): Span {
      started.push({ stage, branch, meta });
      return { traceId: 'trace-1', spanId: `span-${started.length}` };
    },
    endSpan(span: Span, meta: Record<string, unknown> | undefined) {
      ended.push({ span, meta });
    },
  });
  return { started, ended };
}

beforeEach(() => {
  previousTraceExisted = hadTrace();
  previousTrace = Reflect.get(globalThis, TRACE_KEY);
});

afterEach(() => {
  if (previousTraceExisted) Reflect.set(globalThis, TRACE_KEY, previousTrace);
  else Reflect.deleteProperty(globalThis, TRACE_KEY);
});

describe('startInteractionSpan and endInteractionSpan', () => {
  it('starts and ends a span through the collector', () => {
    const { started, ended } = installCollector();
    const span = startInteractionSpan('store.stage', 'command', { id: 'a' });
    expect(span).toEqual({ traceId: 'trace-1', spanId: 'span-1' });
    expect(started).toEqual([{ stage: 'store.stage', branch: 'command', meta: { id: 'a' } }]);
    endInteractionSpan(span, { work: 2 });
    expect(ended).toEqual([{ span, meta: { work: 2 } }]);
  });

  it('returns null and ignores ends without a collector', () => {
    Reflect.deleteProperty(globalThis, TRACE_KEY);
    const span = startInteractionSpan('store.stage', 'command', undefined);
    expect(span).toBe(null);
    expect(() => endInteractionSpan(span)).not.toThrow();
    expect(() => endInteractionSpan({ traceId: 't', spanId: 's' })).not.toThrow();
  });

  it('returns null when the collector startSpan throws', () => {
    Reflect.set(globalThis, TRACE_KEY, {
      startSpan() {
        throw new Error('collector broke');
      },
    });
    expect(startInteractionSpan('store.stage', 'command', undefined)).toBe(null);
  });

  it('ignores a collector whose endSpan throws', () => {
    Reflect.set(globalThis, TRACE_KEY, {
      endSpan() {
        throw new Error('collector broke');
      },
    });
    expect(() => endInteractionSpan({ traceId: 't', spanId: 's' })).not.toThrow();
  });
});

describe('withInteractionSpan', () => {
  it('returns a sync value unchanged and ends the span', () => {
    const { started, ended } = installCollector();
    const result = withInteractionSpan('store.stage', 'command', { id: 'a' }, () => 42);
    expect(result).toBe(42);
    expect(started).toHaveLength(1);
    expect(ended).toEqual([{ span: { traceId: 'trace-1', spanId: 'span-1' }, meta: undefined }]);
  });

  it('ends the span when an async result resolves and returns its value', async () => {
    const { ended } = installCollector();
    const pending = withInteractionSpan('store.stage', 'command', undefined, () => Promise.resolve('done'));
    expect(ended).toHaveLength(0);
    await expect(pending).resolves.toBe('done');
    expect(ended).toEqual([{ span: { traceId: 'trace-1', spanId: 'span-1' }, meta: undefined }]);
  });

  it('ends the span with the error message and rethrows a sync throw', () => {
    const { ended } = installCollector();
    const failure = new Error('sync failure');
    expect(() =>
      withInteractionSpan('store.stage', 'command', undefined, () => {
        throw failure;
      }),
    ).toThrow(failure);
    expect(ended).toEqual([{ span: { traceId: 'trace-1', spanId: 'span-1' }, meta: { error: 'sync failure' } }]);
  });

  it('ends the span with the error message and rethrows an async rejection', async () => {
    const { ended } = installCollector();
    const failure = new Error('async failure');
    await expect(withInteractionSpan('store.stage', 'command', undefined, () => Promise.reject(failure))).rejects.toBe(
      failure,
    );
    expect(ended).toEqual([{ span: { traceId: 'trace-1', spanId: 'span-1' }, meta: { error: 'async failure' } }]);
  });

  it('records a non-error rejection as a string', async () => {
    const { ended } = installCollector();
    await expect(withInteractionSpan('store.stage', 'command', undefined, () => Promise.reject('nope'))).rejects.toBe(
      'nope',
    );
    expect(ended).toEqual([{ span: { traceId: 'trace-1', spanId: 'span-1' }, meta: { error: 'nope' } }]);
  });

  it('traces a thenable that has no catch method', async () => {
    const { ended } = installCollector();
    const thenableOf = <T>(settled: Promise<T>): PromiseLike<T> => ({
      then(onFulfilled, onRejected) {
        return thenableOf(settled.then(onFulfilled, onRejected));
      },
    });
    const thenable = thenableOf(Promise.resolve('from thenable'));
    expect('catch' in thenable).toBe(false);
    const traced = withInteractionSpan('store.stage', 'command', undefined, () => thenable);
    expect('catch' in traced).toBe(false);
    await expect(Promise.resolve(traced)).resolves.toBe('from thenable');
    expect(ended).toEqual([{ span: { traceId: 'trace-1', spanId: 'span-1' }, meta: undefined }]);
  });

  it('passes the result through untouched without a collector', () => {
    Reflect.deleteProperty(globalThis, TRACE_KEY);
    const value = { id: 'same' };
    expect(withInteractionSpan('store.stage', 'command', undefined, () => value)).toBe(value);
    const pending = Promise.resolve(1);
    expect(withInteractionSpan('store.stage', 'command', undefined, () => pending)).toBe(pending);
  });

  it('passes the result through untouched when the collector startSpan throws', () => {
    Reflect.set(globalThis, TRACE_KEY, {
      startSpan() {
        throw new Error('collector broke');
      },
      endSpan() {
        throw new Error('should not end');
      },
    });
    const pending = Promise.resolve(1);
    expect(withInteractionSpan('store.stage', 'command', undefined, () => pending)).toBe(pending);
    const failure = new Error('fn failure');
    expect(() =>
      withInteractionSpan('store.stage', 'command', undefined, () => {
        throw failure;
      }),
    ).toThrow(failure);
  });
});
