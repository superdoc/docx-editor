import { describe, expect, it } from 'vite-plus/test';
import { projectionRunSelectionLength } from './inline-values.js';

describe('projectionRunSelectionLength', () => {
  it('counts painted deleted text as zero selection characters', () => {
    expect(projectionRunSelectionLength({ text: 'gone', trackedChange: { kind: 'delete' } })).toBe(0);
  });

  it('keeps inserted text selectable', () => {
    expect(projectionRunSelectionLength({ text: 'new', trackedChange: { kind: 'insert' } })).toBe(3);
  });
});
