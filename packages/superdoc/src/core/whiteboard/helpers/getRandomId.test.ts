import { describe, it, expect } from 'vite-plus/test';
import { getRandomId } from './getRandomId';

describe('getRandomId', () => {
  it('returns a string', () => {
    const id = getRandomId();
    expect(typeof id).toBe('string');
  });

  it('includes the provided prefix', () => {
    const id = getRandomId('text');
    expect(id.startsWith('text-')).toBe(true);
  });

  it('uses the default prefix when none is provided', () => {
    const id = getRandomId();
    expect(id.startsWith('id-')).toBe(true);
  });
});
