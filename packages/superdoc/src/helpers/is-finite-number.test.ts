import { describe, expect, it } from 'vite-plus/test';
import { isFiniteNumber } from './is-finite-number.js';

describe('isFiniteNumber', () => {
  it('accepts finite numbers', () => {
    expect(isFiniteNumber(0)).toBe(true);
    expect(isFiniteNumber(-0)).toBe(true);
    expect(isFiniteNumber(42)).toBe(true);
    expect(isFiniteNumber(-3.5)).toBe(true);
    expect(isFiniteNumber(Number.MAX_VALUE)).toBe(true);
  });

  it('rejects NaN and infinities', () => {
    expect(isFiniteNumber(NaN)).toBe(false);
    expect(isFiniteNumber(Infinity)).toBe(false);
    expect(isFiniteNumber(-Infinity)).toBe(false);
  });

  it('rejects numeric strings without coercing them', () => {
    expect(isFiniteNumber('42')).toBe(false);
    expect(isFiniteNumber('0')).toBe(false);
    expect(isFiniteNumber('')).toBe(false);
  });

  it('rejects null, undefined, and other non-number values', () => {
    expect(isFiniteNumber(null)).toBe(false);
    expect(isFiniteNumber(undefined)).toBe(false);
    expect(isFiniteNumber(true)).toBe(false);
    expect(isFiniteNumber({})).toBe(false);
    expect(isFiniteNumber([1])).toBe(false);
  });
});
