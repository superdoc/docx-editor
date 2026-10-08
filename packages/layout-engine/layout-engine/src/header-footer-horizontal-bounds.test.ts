import { describe, expect, it } from 'bun:test';
import type { DrawingBlock, DrawingMeasure, ParagraphBlock, ParagraphMeasure } from '@superdoc/contracts';
import { layoutHeaderFooter } from './index.js';

const carrier: ParagraphBlock = { kind: 'paragraph', id: 'carrier', runs: [] };
const paragraph: ParagraphMeasure = {
  kind: 'paragraph',
  totalHeight: 15,
  lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 0, width: 0, ascent: 12, descent: 3, lineHeight: 15 }],
};

function header(
  x: number,
  kind: 'header' | 'footer' = 'header',
  hRelativeFrom: 'page' | 'column' = 'page',
  knownPageWidth = true,
  wrap: DrawingBlock['wrap'] = { type: 'Square' },
) {
  const drawing: DrawingBlock = {
    kind: 'drawing',
    id: 'sideband',
    drawingKind: 'vectorShape',
    geometry: { width: 240, height: 20, rotation: 90 },
    anchor: { isAnchored: true, hRelativeFrom, vRelativeFrom: 'paragraph', offsetH: x, offsetV: 20 },
    wrap,
    attrs: { anchorParagraphId: carrier.id },
  };
  const measure: DrawingMeasure = {
    kind: 'drawing',
    drawingKind: 'vectorShape',
    width: 20,
    height: 240,
    naturalWidth: 240,
    naturalHeight: 20,
    scale: 1,
    geometry: { width: 240, height: 20, rotation: 90, flipH: false, flipV: false },
  };
  return layoutHeaderFooter(
    [drawing, carrier],
    [measure, paragraph],
    {
      width: 500,
      height: 500,
      ...(knownPageWidth ? { pageWidth: 600 } : {}),
      pageHeight: 600,
      margins: { left: 50, right: 50, top: 50, bottom: 50, header: 10, footer: 10 },
    },
    kind,
  );
}

describe('header/footer side decorations', () => {
  for (const [x, hRelativeFrom, wrap] of [
    [30, 'page', { type: 'Square', distRight: 1 }],
    [10, 'page', { type: 'Square', distRight: 30 }],
    [550, 'page', { type: 'Square', distLeft: 1 }],
    [-20, 'column', { type: 'Square', distRight: 1 }],
    [30, 'page', { type: 'TopAndBottom' }],
    [30, 'page', { type: 'Square', wrapText: 'left' }],
    [550, 'page', { type: 'Square', wrapText: 'right' }],
    [30, 'page', { type: 'Square', distRight: Number.NaN }],
    [30, 'page', { type: 'Square', distRight: -1 }],
  ] as const) {
    it(`retains measurement for a potentially blocking wrap at ${hRelativeFrom} x=${x}: ${JSON.stringify(wrap)}`, () => {
      expect(header(x, 'header', hRelativeFrom, true, wrap).height).toBeGreaterThanOrEqual(260);
    });
  }
  it('omits only a wrapping band wholly outside the body, including exact contact', () => {
    expect(header(10, 'header', 'page', true, { type: 'Square', distRight: 20 }).height).toBeCloseTo(15);
    expect(header(550, 'header', 'page', true, { type: 'Square', distLeft: 0 }).height).toBeCloseTo(15);
  });
  it('retains measurement when page-relative horizontal geometry is incomplete', () => {
    expect(header(10, 'header', 'page', false).height).toBeGreaterThanOrEqual(260);
  });
  it('measures column-relative anchors against the story-local body band', () => {
    expect(header(10, 'header', 'column').height).toBeGreaterThanOrEqual(260);
    expect(header(-20, 'header', 'column').height).toBeCloseTo(15);
    expect(header(-19, 'header', 'column').height).toBeGreaterThanOrEqual(260);
  });
  for (const kind of ['header', 'footer'] as const) {
    for (const x of [10, 30, 550, 580]) {
      it(`${kind} retains a rotated sideband at page x=${x} without reserving body height`, () => {
        const result = header(x, kind);
        expect(result.height).toBeCloseTo(15);
        expect(result.renderHeight).toBeGreaterThanOrEqual(260);
        const fragment = result.pages.flatMap((page) => page.fragments).find((f) => f.blockId === 'sideband');
        expect(fragment?.x).toBeCloseTo(x);
        expect(fragment?.width).toBeCloseTo(20);
      });
    }
  }
  for (const x of [31, 50, 530, 549]) {
    it(`reserves height when the rotated header intersects the body at page x=${x}`, () => {
      expect(header(x).height).toBeGreaterThanOrEqual(260);
    });
  }
});
