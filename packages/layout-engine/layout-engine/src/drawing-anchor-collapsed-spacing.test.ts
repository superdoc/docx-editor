import { describe, expect, it } from 'bun:test';
import type { DrawingBlock, DrawingMeasure, ParagraphBlock, ParagraphMeasure } from '@superdoc/contracts';
import { createFloatingObjectManager } from './floating-objects.js';
import { layoutParagraphBlock } from './layout-paragraph.js';
import type { PageState } from './paginator.js';

function anchoredHeading({
  trailing = 0,
  ownContextual = false,
  previousContextual = false,
  relativeFrom = 'paragraph',
}: {
  trailing?: number;
  ownContextual?: boolean;
  previousContextual?: boolean;
  relativeFrom?: 'paragraph' | 'line' | 'legacy';
} = {}) {
  const current: PageState = {
    page: { number: 1, fragments: [] },
    columnIndex: 0,
    cursorY: 70 + trailing,
    topMargin: 50,
    contentBottom: 850,
    constraintBoundaries: [],
    activeConstraintIndex: -1,
    trailingSpacing: trailing,
    lastParagraphStyleId: 'shared',
    lastParagraphContextualSpacing: previousContextual,
    maxCursorY: 70 + trailing,
    pageFootnoteReserve: 0,
    footnoteDemandThisPage: 0,
    footnoteRefsThisPage: 0,
    footnoteAnchorsThisPage: [],
  };
  const block: ParagraphBlock = {
    kind: 'paragraph',
    id: 'heading',
    runs: [{ text: 'Heading', fontFamily: 'Arial', fontSize: 16 }],
    attrs: { styleId: 'shared', contextualSpacing: ownContextual, spacing: { before: 32, after: 0 } },
  };
  const measure: ParagraphMeasure = {
    kind: 'paragraph',
    totalHeight: 26,
    lines: [
      {
        fromRun: 0,
        fromChar: 0,
        toRun: 0,
        toChar: 7,
        width: 100,
        maxWidth: 500,
        ascent: 21,
        descent: 5,
        lineHeight: 26,
      },
    ],
  };
  const drawings = [
    [0, 47],
    [250, 47],
    [0, 263],
    [250, 263],
  ].map(([x, y], i) => {
    const drawing: DrawingBlock = {
      kind: 'drawing',
      drawingKind: 'vectorShape',
      id: `rectangle-${i}`,
      geometry: { width: 250, height: 200 },
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'column',
        ...(relativeFrom !== 'legacy' ? { vRelativeFrom: relativeFrom } : {}),
        offsetH: x,
        offsetV: y,
        behindDoc: true,
      },
      wrap: { type: 'Tight', wrapText: 'bothSides', distLeft: 12, distRight: 12 },
    };
    const measured: DrawingMeasure = {
      kind: 'drawing',
      drawingKind: 'vectorShape',
      width: 250,
      height: 200,
      naturalWidth: 250,
      naturalHeight: 200,
      scale: 1,
      geometry: { width: 250, height: 200, rotation: 0, flipH: false, flipV: false },
    };
    return { block: drawing, measure: measured };
  });
  const columns = { width: 500, gap: 0, count: 1 };
  layoutParagraphBlock(
    {
      block,
      measure,
      columnWidth: 500,
      ensurePage: () => current,
      advanceColumn: () => {
        throw new Error('The generated heading and objects fit on one page');
      },
      columnX: () => 50,
      floatManager: createFloatingObjectManager(columns, { left: 50, right: 50 }, 600),
    },
    {
      anchoredDrawings: drawings,
      anchoredTables: [],
      columnWidth: 500,
      pageWidth: 600,
      pageMargins: { top: 50, bottom: 50, left: 50, right: 50 },
      columns,
      placedAnchoredIds: new Set(),
    },
  );
  return {
    heading: current.page.fragments.find((f) => f.kind === 'para')!,
    drawings: current.page.fragments.filter((f) => f.kind === 'drawing'),
  };
}

describe('paragraph drawing anchors after collapsed spacing', () => {
  it('retains the preceding after-gap so the heading stays above its own wrapped drawings', () => {
    const result = anchoredHeading({ trailing: 40 / 3 });
    expect(result.heading.y).toBeCloseTo(102, 6);
    expect(result.drawings.map((f) => f.y)).toEqual([
      70 + 40 / 3 + 47,
      70 + 40 / 3 + 47,
      70 + 40 / 3 + 263,
      70 + 40 / 3 + 263,
    ]);
  });
  it('retains a preceding after-gap larger than the heading before-gap', () => {
    const result = anchoredHeading({ trailing: 40 });
    expect(result.heading.y).toBe(110);
    expect(result.drawings.map((f) => f.y)).toEqual([157, 157, 373, 373]);
  });
  it('preserves the Word control that clears below drawings with no preceding after-gap', () => {
    const result = anchoredHeading();
    expect(result.heading.y).toBe(533);
    expect(result.drawings.map((f) => f.y)).toEqual([117, 117, 333, 333]);
  });
  it('rewinds a preceding contextually suppressed after-gap', () => {
    const result = anchoredHeading({ trailing: 40 / 3, previousContextual: true });
    expect(result.heading.y).toBe(533);
    expect(result.drawings.map((f) => f.y)).toEqual([117, 117, 333, 333]);
  });
  it('keeps a preceding after-gap when only the heading suppresses its own before-gap', () => {
    const result = anchoredHeading({ trailing: 40 / 3, ownContextual: true });
    expect(result.heading.y).toBeCloseTo(70 + 40 / 3, 6);
    expect(result.drawings[0].y).toBeCloseTo(70 + 40 / 3 + 47, 6);
  });
  it('suppresses both independently opted-in gaps', () => {
    const result = anchoredHeading({ trailing: 40 / 3, ownContextual: true, previousContextual: true });
    expect(result.heading.y).toBe(70);
    expect(result.drawings[0].y).toBe(117);
  });
  it('preserves legacy omitted vertical-reference placement', () => {
    const result = anchoredHeading({ trailing: 40 / 3, relativeFrom: 'legacy' });
    expect(result.heading.y).toBe(102);
    expect(result.drawings[0].y).toBe(149);
  });
  it('preserves explicit line-relative placement', () => {
    const result = anchoredHeading({ trailing: 40 / 3, relativeFrom: 'line' });
    expect(result.heading.y).toBe(533);
    expect(result.drawings[0].y).toBe(117);
  });
});
