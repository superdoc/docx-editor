import { describe, expect, it } from 'vite-plus/test';
import { isThenable } from './object-guards.js';

describe('isThenable', () => {
  it('accepts promises and thenable objects', () => {
    expect(isThenable(Promise.resolve(1))).toBe(true);
    expect(isThenable({ then: () => undefined })).toBe(true);
  });

  it('accepts a function with a then method', () => {
    const thenableFunction = Object.assign(() => undefined, { then: () => undefined });
    expect(isThenable(thenableFunction)).toBe(true);
  });

  it('rejects null, undefined and primitives', () => {
    expect(isThenable(null)).toBe(false);
    expect(isThenable(undefined)).toBe(false);
    expect(isThenable(0)).toBe(false);
    expect(isThenable('then')).toBe(false);
    expect(isThenable(false)).toBe(false);
  });

  it('rejects objects whose then is not a function', () => {
    expect(isThenable({ then: true })).toBe(false);
    expect(isThenable({ then: null })).toBe(false);
    expect(isThenable({})).toBe(false);
    expect(isThenable(() => undefined)).toBe(false);
  });
});
