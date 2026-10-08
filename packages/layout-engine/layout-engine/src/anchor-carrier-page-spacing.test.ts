import { describe, expect, it } from 'bun:test';
import type { DrawingBlock, DrawingMeasure, ParagraphBlock, ParagraphMeasure } from '@superdoc/contracts';
import { createFloatingObjectManager } from './floating-objects.js';
import { layoutParagraphBlock } from './layout-paragraph.js';
import type { PageState } from './paginator.js';

function state(number: number, cursorY = 50): PageState {
  return {
    page: { number, fragments: [] },
    columnIndex: 0,
    cursorY,
    topMargin: 50,
    contentBottom: 550,
    constraintBoundaries: [],
    activeConstraintIndex: -1,
    trailingSpacing: 0,
    lastParagraphContextualSpacing: false,
    maxCursorY: cursorY,
    pageFootnoteReserve: 0,
    footnoteDemandThisPage: 0,
    footnoteRefsThisPage: 0,
    footnoteAnchorsThisPage: [],
  };
}

function carrier(mode: 'document' | 'page' | 'column') {
  const first = state(1, mode === 'document' ? 50 : 350);
  const next = state(mode === 'column' ? 1 : 2);
  if (mode === 'column') next.columnIndex = 1;
  let current = first;
  const block: ParagraphBlock = {
    kind: 'paragraph',
    id: 'heading',
    runs: [{ text: 'Heading', fontFamily: 'Cambria', fontSize: 14 }],
    attrs: { spacing: { before: 32, after: 0 } },
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
        vRelativeFrom: 'paragraph',
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
  const columns = { width: 500, gap: 0, count: mode === 'column' ? 2 : 1 };
  layoutParagraphBlock(
    {
      block,
      measure,
      columnWidth: 500,
      ensurePage: () => current,
      advanceColumn: () => {
        current = next;
        return next;
      },
      columnX: (state) => 50 + state.columnIndex * 500,
      floatManager: createFloatingObjectManager(columns, { left: 50, right: 50 }, mode === 'column' ? 1100 : 600),
    },
    {
      anchoredDrawings: drawings,
      anchoredTables: [],
      columnWidth: 500,
      pageWidth: mode === 'column' ? 1100 : 600,
      pageMargins: { top: 50, bottom: 50, left: 50, right: 50 },
      columns,
      placedAnchoredIds: new Set(),
    },
  );
  return { first, current, heading: current.page.fragments.find((f) => f.kind === 'para') };
}

describe('anchor-carrier spacing after pagination', () => {
  it('suppresses before-spacing after the carrier automatically advances to a fresh page', () => {
    const result = carrier('page');
    expect(result.first.page.fragments).toHaveLength(0);
    expect(result.current.page.number).toBe(2);
    expect(result.heading?.y).toBe(50);
    expect(result.current.page.fragments.filter((f) => f.kind === 'drawing').map((f) => f.y)).toEqual([
      97, 97, 313, 313,
    ]);
  });
  it('preserves authored before-spacing at document start and clears below its own floats', () => {
    const result = carrier('document');
    expect(result.current.page.number).toBe(1);
    expect(result.heading?.y).toBe(513);
  });
  it('preserves the existing same-page column transition without a Word-qualified page move', () => {
    const result = carrier('column');
    expect(result.current.page.number).toBe(1);
    expect(result.current.columnIndex).toBe(1);
    expect(result.heading?.y).toBe(513);
  });
});
