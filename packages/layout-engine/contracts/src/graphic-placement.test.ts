import { describe, expect, it } from 'vite-plus/test';
import {
  resolveAnchoredGraphicY,
  resolveAnchoredGraphicX,
  resolveFooterPageFrameOriginY,
  isPositionedParagraphFrame,
  isPagePositionedParagraphFrame,
  isPagePositionedFloatingTable,
} from './graphic-placement.js';

const yBase = {
  objectHeight: 100,
  contentTop: 72,
  contentBottom: 720,
  pageBottomMargin: 72,
};

const columns = { width: 200, gap: 20, count: 2 };
const margins = { left: 72, right: 72 };
const pageWidth = 600;
const objectWidth = 80;

describe('isPositionedParagraphFrame', () => {
  it.each(['around', 'none'])('accepts layout-supported wrap=%s frames', (wrap) => {
    expect(isPositionedParagraphFrame({ wrap })).toBe(true);
  });

  it.each([undefined, 'auto', 'notBeside', 'tight', 'through'])('rejects ordinary-flow wrap=%s frames', (wrap) => {
    expect(isPositionedParagraphFrame(wrap === undefined ? undefined : { wrap })).toBe(false);
  });
});

describe('isPagePositionedParagraphFrame', () => {
  it.each(['around', 'none'])('accepts finite page-positioned wrap=%s frames', (wrap) => {
    expect(isPagePositionedParagraphFrame({ wrap, vAnchor: 'page', y: 12 })).toBe(true);
  });

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY])('rejects non-finite y=%s', (y) => {
    expect(isPagePositionedParagraphFrame({ wrap: 'around', vAnchor: 'page', y })).toBe(false);
  });
});

describe('isPagePositionedFloatingTable', () => {
  it('accepts an anchored table positioned relative to the page', () => {
    expect(
      isPagePositionedFloatingTable({
        kind: 'table',
        anchor: { isAnchored: true, vRelativeFrom: 'page' },
      }),
    ).toBe(true);
  });

  it.each([
    { kind: 'table', anchor: { isAnchored: false, vRelativeFrom: 'page' } },
    { kind: 'table', anchor: { isAnchored: true, vRelativeFrom: 'margin' } },
    { kind: 'paragraph', anchor: { isAnchored: true, vRelativeFrom: 'page' } },
  ])('rejects non-page-positioned floating tables', (block) => {
    expect(isPagePositionedFloatingTable(block)).toBe(false);
  });
});

describe('resolveFooterPageFrameOriginY', () => {
  it.each([72, -24, Number.NaN, undefined])('clamps or defaults bottom margin %s', (bottomMargin) => {
    const expectedMargin =
      typeof bottomMargin === 'number' && Number.isFinite(bottomMargin) ? Math.max(0, bottomMargin) : 0;
    expect(resolveFooterPageFrameOriginY(1056, bottomMargin)).toBe(1056 - expectedMargin);
  });

  it('clamps the origin to the page top when the bottom margin exceeds the page height', () => {
    expect(resolveFooterPageFrameOriginY(1056, 1200)).toBe(0);
  });
});

describe('resolveAnchoredGraphicY', () => {
  it('uses simple page coordinates instead of relative positioning when simplePos is active', () => {
    expect(
      resolveAnchoredGraphicY({
        ...yBase,
        anchor: {
          simplePos: { x: 25.5, y: 41.25 },
          vRelativeFrom: 'margin',
          alignV: 'bottom',
          offsetV: 999,
        },
        anchorParagraphY: 300,
      }),
    ).toBe(41.25);
  });

  it('positions margin-relative top with offset', () => {
    expect(
      resolveAnchoredGraphicY({
        ...yBase,
        anchor: { vRelativeFrom: 'margin', alignV: 'top', offsetV: 10 },
      }),
    ).toBe(82);
  });

  it('positions page-relative bottom with page margin', () => {
    expect(
      resolveAnchoredGraphicY({
        ...yBase,
        anchor: { vRelativeFrom: 'page', alignV: 'bottom', offsetV: 5 },
      }),
    ).toBe(720 + 72 - 100 + 5);
  });

  it('positions paragraph-relative center on first line', () => {
    expect(
      resolveAnchoredGraphicY({
        ...yBase,
        anchor: { vRelativeFrom: 'paragraph', alignV: 'center', offsetV: 0 },
        anchorParagraphY: 200,
        firstLineHeight: 24,
      }),
    ).toBe(200 + (24 - 100) / 2);
  });

  it('uses pre-registered fallback when vRelativeFrom is paragraph without paragraph context', () => {
    expect(
      resolveAnchoredGraphicY({
        ...yBase,
        anchor: { vRelativeFrom: 'paragraph', offsetV: 20 },
        preRegisteredFallbackToContentTop: true,
      }),
    ).toBe(92);
  });

  it('ignores paragraph alignV when pre-registered fallback has no paragraph context', () => {
    expect(
      resolveAnchoredGraphicY({
        ...yBase,
        anchor: { vRelativeFrom: 'paragraph', alignV: 'center', offsetV: 0 },
        preRegisteredFallbackToContentTop: true,
      }),
    ).toBe(72);
    expect(
      resolveAnchoredGraphicY({
        ...yBase,
        objectHeight: 50,
        anchor: { vRelativeFrom: 'paragraph', alignV: 'bottom', offsetV: 10 },
        preRegisteredFallbackToContentTop: true,
      }),
    ).toBe(82);
  });

  it('legacy undefined vRelativeFrom uses anchor paragraph Y plus offsetV', () => {
    expect(
      resolveAnchoredGraphicY({
        ...yBase,
        anchor: { offsetV: 15 },
        anchorParagraphY: 300,
      }),
    ).toBe(315);
  });

  it('legacy undefined vRelativeFrom with preRegisteredFallbackToContentTop uses contentTop', () => {
    expect(
      resolveAnchoredGraphicY({
        ...yBase,
        anchor: { alignV: 'center', offsetV: 20 },
        anchorParagraphY: 300,
        preRegisteredFallbackToContentTop: true,
      }),
    ).toBe(92);
  });

  it('legacy undefined vRelativeFrom does not use paragraph alignV without vRelativeFrom paragraph', () => {
    expect(
      resolveAnchoredGraphicY({
        ...yBase,
        anchor: { alignV: 'bottom', offsetV: 0 },
        anchorParagraphY: 200,
        firstLineHeight: 24,
      }),
    ).toBe(200);
  });

  it.each([
    { relativeFrom: 'page' as const, pageNumber: 1, expected: 0 },
    { relativeFrom: 'margin' as const, pageNumber: 1, expected: 72 },
    { relativeFrom: 'paragraph' as const, pageNumber: 1, expected: 200 },
    { relativeFrom: 'line' as const, pageNumber: 1, expected: 240 },
    { relativeFrom: 'topMargin' as const, pageNumber: 1, expected: 0 },
    { relativeFrom: 'bottomMargin' as const, pageNumber: 1, expected: 720 },
    { relativeFrom: 'insideMargin' as const, pageNumber: 1, expected: 0 },
    { relativeFrom: 'insideMargin' as const, pageNumber: 2, expected: 720 },
    { relativeFrom: 'outsideMargin' as const, pageNumber: 1, expected: 720 },
    { relativeFrom: 'outsideMargin' as const, pageNumber: 2, expected: 0 },
  ])(
    'matches Word for $relativeFrom with posOffset=0 on physical page $pageNumber',
    ({ relativeFrom, pageNumber, expected }) => {
      expect(
        resolveAnchoredGraphicY({
          ...yBase,
          anchor: { vRelativeFrom: relativeFrom, offsetV: 0 },
          anchorParagraphY: 200,
          anchorLineY: 240,
          firstLineHeight: 24,
          pageNumber,
        }),
      ).toBe(expected);
    },
  );

  it.each([
    { alignV: 'inside' as const, pageNumber: 1, expected: 72 },
    { alignV: 'inside' as const, pageNumber: 2, expected: 620 },
    { alignV: 'outside' as const, pageNumber: 1, expected: 620 },
    { alignV: 'outside' as const, pageNumber: 2, expected: 72 },
  ])('matches Word logical vertical $alignV alignment on page $pageNumber', ({ alignV, pageNumber, expected }) => {
    expect(
      resolveAnchoredGraphicY({
        ...yBase,
        anchor: { vRelativeFrom: 'margin', alignV },
        pageNumber,
      }),
    ).toBe(expected);
  });
});

describe('resolveAnchoredGraphicX', () => {
  it('uses simple page coordinates instead of relative positioning when simplePos is active', () => {
    expect(
      resolveAnchoredGraphicX(
        {
          simplePos: { x: 25.5, y: 41.25 },
          hRelativeFrom: 'margin',
          alignH: 'right',
          offsetH: 999,
        },
        1,
        columns,
        objectWidth,
        margins,
        pageWidth,
      ),
    ).toBe(25.5);
  });

  const columnIndex = 1;
  const columnLeft = margins.left + columnIndex * (columns.width + columns.gap);

  describe('column-relative (default)', () => {
    it.each([
      { alignH: 'left' as const, offsetH: 10, expected: columnLeft + 10 },
      { alignH: 'center' as const, offsetH: 5, expected: columnLeft + (columns.width - objectWidth) / 2 + 5 },
      { alignH: 'right' as const, offsetH: 3, expected: columnLeft + columns.width - objectWidth - 3 },
    ])('alignH=$alignH offsetH=$offsetH', ({ alignH, offsetH, expected }) => {
      expect(resolveAnchoredGraphicX({ alignH, offsetH }, columnIndex, columns, objectWidth, margins, pageWidth)).toBe(
        expected,
      );
    });
  });

  describe('margin-relative', () => {
    const baseX = margins.left;
    const availableWidth = pageWidth - margins.left - margins.right;

    it.each([
      { alignH: 'left' as const, offsetH: 10, expected: baseX + 10 },
      { alignH: 'center' as const, offsetH: 5, expected: baseX + (availableWidth - objectWidth) / 2 + 5 },
      { alignH: 'right' as const, offsetH: 3, expected: baseX + availableWidth - objectWidth - 3 },
    ])('alignH=$alignH offsetH=$offsetH', ({ alignH, offsetH, expected }) => {
      expect(
        resolveAnchoredGraphicX(
          { hRelativeFrom: 'margin', alignH, offsetH },
          columnIndex,
          columns,
          objectWidth,
          margins,
          pageWidth,
        ),
      ).toBe(expected);
    });
  });

  describe('page-relative', () => {
    const baseX = 0;
    const availableWidth = pageWidth;

    it.each([
      { alignH: 'left' as const, offsetH: 10, expected: baseX + 10 },
      { alignH: 'center' as const, offsetH: 5, expected: baseX + (availableWidth - objectWidth) / 2 + 5 },
      { alignH: 'right' as const, offsetH: 3, expected: baseX + availableWidth - objectWidth - 3 },
    ])('alignH=$alignH offsetH=$offsetH', ({ alignH, offsetH, expected }) => {
      expect(
        resolveAnchoredGraphicX(
          { hRelativeFrom: 'page', alignH, offsetH },
          columnIndex,
          columns,
          objectWidth,
          margins,
          pageWidth,
        ),
      ).toBe(expected);
    });
  });

  it('defaults alignH to left and offsetH to zero', () => {
    expect(resolveAnchoredGraphicX({}, 0, columns, objectWidth, margins, pageWidth)).toBe(margins.left);
  });

  describe('column-relative honors the authored per-column origin (SD-2629)', () => {
    // Explicit unequal columns: col0 = 100px, gap-after-col0 = 40px, col1 = 300px. The column ORIGIN
    // follows the resolved geometry (not a uniform columnIndex * (width + gap) stride); the available
    // width stays the scalar (max) column width to match anchored-object measurement.
    const unequal = { width: 300, gap: 20, count: 2, widths: [100, 300], gaps: [40] };

    it('places a column-1 anchor at the authored column origin, not the uniform stride', () => {
      // Geometry col1 x = 100 + 40 = 140; + left margin 72 = 212. The uniform stride would place it
      // at 72 + (300 + 20) = 392; ignoring per-column gaps (scalar 20) would give 192.
      expect(resolveAnchoredGraphicX({ alignH: 'left', offsetH: 0 }, 1, unequal, objectWidth, margins, pageWidth)).toBe(
        212,
      );
    });

    it('right-aligns within the scalar (max) column width to match object measurement', () => {
      // Available width is the scalar max (columns.width = 300), matching the measurement clamp, so a
      // max-sized object is not pushed into the margin/gap: col0 right edge = 72 + 300 - 80 = 292.
      // (Per-column width 100 would give 92, but the object was measured against the max width.)
      expect(
        resolveAnchoredGraphicX({ alignH: 'right', offsetH: 0 }, 0, unequal, objectWidth, margins, pageWidth),
      ).toBe(292);
    });
  });

  it('derives an omitted RTL content width from the page and margins', () => {
    const rtlUnderfill = {
      width: 100,
      gap: 20,
      count: 2,
      equalWidth: false,
      widths: [100, 100],
      direction: 'rtl' as const,
    };

    expect(resolveAnchoredGraphicX({ alignH: 'left' }, 0, rtlUnderfill, objectWidth, margins, pageWidth)).toBe(
      pageWidth - margins.right - rtlUnderfill.width,
    );
  });

  it.each([
    { relativeFrom: 'page' as const, pageNumber: 1, expected: 0 },
    { relativeFrom: 'margin' as const, pageNumber: 1, expected: 72 },
    { relativeFrom: 'column' as const, pageNumber: 1, expected: 292 },
    { relativeFrom: 'character' as const, pageNumber: 1, expected: 350 },
    { relativeFrom: 'leftMargin' as const, pageNumber: 1, expected: 0 },
    { relativeFrom: 'rightMargin' as const, pageNumber: 1, expected: 528 },
    { relativeFrom: 'insideMargin' as const, pageNumber: 1, expected: 0 },
    { relativeFrom: 'insideMargin' as const, pageNumber: 2, expected: 528 },
    { relativeFrom: 'outsideMargin' as const, pageNumber: 1, expected: 528 },
    { relativeFrom: 'outsideMargin' as const, pageNumber: 2, expected: 0 },
  ])(
    'matches Word for $relativeFrom with posOffset=0 on physical page $pageNumber',
    ({ relativeFrom, pageNumber, expected }) => {
      expect(
        resolveAnchoredGraphicX(
          { hRelativeFrom: relativeFrom, offsetH: 0 },
          1,
          columns,
          objectWidth,
          margins,
          pageWidth,
          { anchorCharacterX: 350, pageNumber },
        ),
      ).toBe(expected);
    },
  );

  it.each([
    { alignH: 'inside' as const, pageNumber: 1, expected: 72 },
    { alignH: 'inside' as const, pageNumber: 2, expected: 448 },
    { alignH: 'outside' as const, pageNumber: 1, expected: 448 },
    { alignH: 'outside' as const, pageNumber: 2, expected: 72 },
  ])('matches Word logical horizontal $alignH alignment on page $pageNumber', ({ alignH, pageNumber, expected }) => {
    expect(
      resolveAnchoredGraphicX({ hRelativeFrom: 'margin', alignH }, 0, columns, objectWidth, margins, pageWidth, {
        pageNumber,
      }),
    ).toBe(expected);
  });
});
