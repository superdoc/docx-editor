import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { sanitizeNumber, throttle } from './helpers.js';

describe('sanitizeNumber', () => {
  it('reads the number from a value with a unit suffix', () => {
    expect(sanitizeNumber('12pt', 12)).toBe(12);
  });

  it('keeps half points', () => {
    expect(sanitizeNumber('10.5', 12)).toBe(10.5);
  });

  it('returns the default when no number can be read', () => {
    expect(sanitizeNumber('abc', 12)).toBe(12);
    expect(sanitizeNumber('', 12)).toBe(12);
  });

  it('reads a numeric value', () => {
    expect(sanitizeNumber(14, 12)).toBe(14);
  });

  it('returns the default for a missing value', () => {
    expect(sanitizeNumber(undefined, 12)).toBe(12);
    expect(sanitizeNumber(null, 12)).toBe(12);
  });

  it('drops a minus sign along with other non-numeric characters', () => {
    expect(sanitizeNumber('-14', 12)).toBe(14);
  });
});

describe('throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs on the leading edge, then once more with the last arguments after the wait', () => {
    const calls: number[] = [];
    const throttled = throttle((value: number) => calls.push(value), 100);

    throttled(1);
    throttled(2);
    throttled(3);
    expect(calls).toEqual([1]);

    vi.advanceTimersByTime(100);
    expect(calls).toEqual([1, 3]);
  });

  it('returns the result of the last run', () => {
    const throttled = throttle((value: number) => value * 2, 100);

    expect(throttled(1)).toBe(2);
    expect(throttled(5)).toBe(2);
    vi.advanceTimersByTime(100);
    expect(throttled(7)).toBe(10);
  });

  it('drops the pending trailing run after cancel', () => {
    const calls: number[] = [];
    const throttled = throttle((value: number) => calls.push(value), 100);

    throttled(1);
    throttled(2);
    throttled.cancel();
    vi.advanceTimersByTime(200);
    expect(calls).toEqual([1]);
  });

  it('runs the next call at once after cancel', () => {
    const calls: number[] = [];
    const throttled = throttle((value: number) => calls.push(value), 100);

    throttled(1);
    throttled(2);
    throttled.cancel();
    throttled(3);
    expect(calls).toEqual([1, 3]);
  });

  it('keeps the cancelled timer from delaying a later call', () => {
    const calls: number[] = [];
    const throttled = throttle((value: number) => calls.push(value), 100);

    throttled(1);
    throttled(2);
    throttled.cancel();
    vi.advanceTimersByTime(100);
    throttled(3);
    expect(calls).toEqual([1, 3]);
  });

  it('defers the first run until the wait passes when leading is false', () => {
    const calls: number[] = [];
    const throttled = throttle((value: number) => calls.push(value), 100, { leading: false });

    throttled(1);
    expect(calls).toEqual([]);

    vi.advanceTimersByTime(100);
    expect(calls).toEqual([1]);
  });

  it('skips the trailing run when trailing is false', () => {
    const calls: number[] = [];
    const throttled = throttle((value: number) => calls.push(value), 100, { trailing: false });

    throttled(1);
    throttled(2);
    vi.advanceTimersByTime(200);
    expect(calls).toEqual([1]);
  });
});
