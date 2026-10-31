import { describe, it, expect } from 'vite-plus/test';
import { flattenPoints } from './flattenPoints';

describe('flattenPoints', () => {
  it('returns empty array for empty input', () => {
    expect(flattenPoints([])).toEqual([]);
  });

  it('flattens a single point pair', () => {
    expect(flattenPoints([[10, 20]])).toEqual([10, 20]);
  });

  it('flattens multiple point pairs in order', () => {
    const points = [
      [1, 2],
      [3, 4],
      [5, 6],
    ];
    expect(flattenPoints(points)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
