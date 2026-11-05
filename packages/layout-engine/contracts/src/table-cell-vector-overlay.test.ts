import { describe, expect, it } from 'vite-plus/test';
import type { VectorShapeDrawing } from './index.js';
import { isTableCellVectorOverlay } from './table-cell-vector-overlay.js';

const line: VectorShapeDrawing = {
  kind: 'drawing',
  id: 'rule',
  drawingKind: 'vectorShape',
  shapeKind: 'line',
  geometry: { width: 5, height: 166 },
  anchor: { isAnchored: true, layoutInCell: true, vRelativeFrom: 'paragraph', offsetV: -75 },
  wrap: { type: 'None' },
};

describe('isTableCellVectorOverlay', () => {
  it.each([-75, 0, 75])('retains decorative lines at offset %s in either draw plane', (offsetV) => {
    for (const behindDoc of [true, false]) {
      expect(isTableCellVectorOverlay({ ...line, anchor: { ...line.anchor, offsetV, behindDoc } })).toBe(true);
    }
  });

  it.each([0, 1])('recognizes the customer and Word-calibrated two-point custom paths with width %s', (w) => {
    expect(
      isTableCellVectorOverlay({
        ...line,
        shapeKind: undefined,
        customGeometry: { paths: [{ d: 'M 1 0 L 0 1557655', w, h: 1557655 }] },
      }),
    ).toBe(true);
  });

  it('recognizes the existing straight connector line family', () => {
    expect(isTableCellVectorOverlay({ ...line, shapeKind: 'straightConnector1' })).toBe(true);
  });

  it.each([
    { shapeKind: 'rect', fillColor: '#0060FF' },
    { shapeKind: 'rect', customGeometry: { paths: [{ d: 'M 0 0 L 1 0 L 1 10 Z', w: 1, h: 10 }] } },
    { shapeKind: 'rect', customGeometry: { paths: [] } },
    { anchor: { isAnchored: false } },
    { wrap: { type: 'Square' as const } },
    { textContent: { parts: [{ text: 'Shape text' }] } },
  ])('retains ordinary sizing and clipping for %j', (overrides) => {
    expect(isTableCellVectorOverlay({ ...line, ...overrides })).toBe(false);
  });
});
