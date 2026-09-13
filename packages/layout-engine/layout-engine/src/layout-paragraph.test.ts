import { describe, expect, it, mock } from 'bun:test';
import type {
  DrawingFragment,
  ParagraphBlock,
  ParagraphMeasure,
  Line,
  ParaFragment,
  TextboxDrawing,
  DrawingMeasure,
  ImageBlock,
  ImageMeasure,
  ImageFragment,
} from '@superdoc/contracts';
import { layoutParagraphBlock, type ParagraphLayoutContext } from './layout-paragraph.js';
import type { PageState } from './paginator.js';
import type { FloatingObjectManager } from './floating-objects.js';

/**
 * Helper to create a minimal line for testing.
 */
const makeLine = (width: number, lineHeight: number, maxWidth: number): Line => ({
  fromRun: 0,
  fromChar: 0,
  toRun: 0,
  toChar: 0,
  width,
  ascent: lineHeight * 0.8,
  descent: lineHeight * 0.2,
  lineHeight,
  maxWidth,
});

/**
 * Helper to create a minimal paragraph measure for testing.
 */
const makeMeasure = (
  lines: Array<{ width: number; lineHeight: number; maxWidth: number }>,
  marker?: {
    markerWidth?: number;
    markerTextWidth?: number;
    gutterWidth?: number;
  },
): ParagraphMeasure => ({
  kind: 'paragraph',
  lines: lines.map((l) => makeLine(l.width, l.lineHeight, l.maxWidth)),
  totalHeight: lines.reduce((sum, l) => sum + l.lineHeight, 0),
  marker: marker
    ? {
        markerWidth: marker.markerWidth ?? 0,
        markerTextWidth: marker.markerTextWidth ?? 0,
        indentLeft: 0,
        gutterWidth: marker.gutterWidth,
      }
    : undefined,
});

/**
 * Helper to create a minimal page state for testing.
 */
const makePageState = (): PageState => ({
  page: {
    number: 1,
    fragments: [],
  },
  columnIndex: 0,
  cursorY: 50,
  topMargin: 50,
  contentBottom: 750,
  constraintBoundaries: [],
  activeConstraintIndex: -1,
  trailingSpacing: 0,
  lastParagraphStyleId: undefined,
  lastParagraphContextualSpacing: false,
  maxCursorY: 50,
  pageFootnoteReserve: 0,
  footnoteDemandThisPage: 0,
  footnoteRefsThisPage: 0,
});

/**
 * Helper to create a minimal floating object manager for testing.
 */
const makeFloatManager = (): FloatingObjectManager => ({
  registerDrawing: mock(),
  registerTable: mock(),
  getExclusionsForLine: mock(() => []),
  computeAvailableWidth: mock((lineY, lineHeight, columnWidth) => ({
    width: columnWidth,
    offsetX: 0,
  })),
  computeAvailableRegions: mock((_lineY, _lineHeight, columnWidth) => [{ offsetX: 0, width: columnWidth }]),
  computeVerticalClearance: mock(() => null),
  getAllFloatsForPage: mock(() => []),
  clear: mock(),
  setLayoutContext: mock(),
});

describe('layoutParagraphBlock - column ownership', () => {
  it('records the flow column on ordinary paragraph fragments', () => {
    const state = makePageState();
    state.columnIndex = 1;
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'column-paragraph',
      runs: [{ text: 'Right column', fontFamily: 'Arial', fontSize: 12 }],
    };

    layoutParagraphBlock({
      block,
      measure: makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 200 }]),
      columnWidth: 200,
      ensurePage: mock(() => state),
      advanceColumn: mock((current) => current),
      columnX: mock(() => 250),
      floatManager: makeFloatManager(),
    });

    expect(state.page.fragments).toEqual([
      expect.objectContaining({ kind: 'para', blockId: block.id, columnIndex: 1 }),
    ]);
  });
});

describe('layoutParagraphBlock - remeasurement with list markers', () => {
  describe('standard hanging indent mode', () => {
    it('remeasures with firstLineIndent=0 when firstLineIndentMode is not set', () => {
      const remeasureParagraph = mock((block, maxWidth, firstLineIndent) => {
        // Verify that firstLineIndent is 0 for standard hanging indent
        expect(firstLineIndent).toBe(0);
        return makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 150 }]);
      });

      const block: ParagraphBlock = {
        kind: 'paragraph',
        id: 'test-block',
        runs: [{ text: 'Test', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {
          wordLayout: {
            marker: {
              markerBoxWidthPx: 20,
            },
            // firstLineIndentMode is NOT set - this is standard hanging indent
          },
        },
      };

      const measure = makeMeasure(
        [{ width: 100, lineHeight: 20, maxWidth: 200 }], // Measured at wider width
        { markerWidth: 18, gutterWidth: 6 },
      );

      const ctx: ParagraphLayoutContext = {
        block,
        measure,
        columnWidth: 150, // Narrower than measurement width
        ensurePage: mock(() => makePageState()),
        advanceColumn: mock((state) => state),
        columnX: mock(() => 50),
        floatManager: makeFloatManager(),
        remeasureParagraph,
      };

      layoutParagraphBlock(ctx);

      expect(remeasureParagraph).toHaveBeenCalledWith(block, 150, 0);
    });

    it('remeasures with firstLineIndent=0 when marker is missing in measure', () => {
      const remeasureParagraph = mock((block, maxWidth, firstLineIndent) => {
        expect(firstLineIndent).toBe(0);
        return makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 150 }]);
      });

      const block: ParagraphBlock = {
        kind: 'paragraph',
        id: 'test-block',
        runs: [{ text: 'Test', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {
          wordLayout: {
            marker: {
              markerBoxWidthPx: 20,
            },
            firstLineIndentMode: true,
          },
        },
      };

      const measure = makeMeasure(
        [{ width: 100, lineHeight: 20, maxWidth: 200 }],
        // No marker in measure
      );

      const ctx: ParagraphLayoutContext = {
        block,
        measure,
        columnWidth: 150,
        ensurePage: mock(() => makePageState()),
        advanceColumn: mock((state) => state),
        columnX: mock(() => 50),
        floatManager: makeFloatManager(),
        remeasureParagraph,
      };

      layoutParagraphBlock(ctx);

      expect(remeasureParagraph).toHaveBeenCalledWith(block, 150, 0);
    });
  });

  describe('firstLineIndentMode', () => {
    it('remeasures with correct firstLineIndent when marker is inline', () => {
      const remeasureParagraph = mock((block, maxWidth, firstLineIndent) => {
        // Verify that firstLineIndent is markerWidth + gutterWidth
        expect(firstLineIndent).toBe(24); // 18 + 6
        return makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 150 }]);
      });

      const block: ParagraphBlock = {
        kind: 'paragraph',
        id: 'test-block',
        runs: [{ text: 'Test', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {
          wordLayout: {
            marker: {
              markerBoxWidthPx: 20,
            },
            firstLineIndentMode: true,
          },
        },
      };

      const measure = makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 200 }], { markerWidth: 18, gutterWidth: 6 });

      const ctx: ParagraphLayoutContext = {
        block,
        measure,
        columnWidth: 150,
        ensurePage: mock(() => makePageState()),
        advanceColumn: mock((state) => state),
        columnX: mock(() => 50),
        floatManager: makeFloatManager(),
        remeasureParagraph,
      };

      layoutParagraphBlock(ctx);

      expect(remeasureParagraph).toHaveBeenCalledWith(block, 150, 24);
    });

    it('uses markerWidth=0 fallback when markerWidth is missing', () => {
      const remeasureParagraph = mock((block, maxWidth, firstLineIndent) => {
        // markerWidth defaults to 0 when the measure marker is present
        expect(firstLineIndent).toBe(6);
        return makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 150 }]);
      });

      const block: ParagraphBlock = {
        kind: 'paragraph',
        id: 'test-block',
        runs: [{ text: 'Test', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {
          wordLayout: {
            marker: {
              markerBoxWidthPx: 20,
            },
            firstLineIndentMode: true,
          },
        },
      };

      const measure = makeMeasure(
        [{ width: 100, lineHeight: 20, maxWidth: 200 }],
        { gutterWidth: 6 }, // markerWidth is missing and defaults to 0
      );

      const ctx: ParagraphLayoutContext = {
        block,
        measure,
        columnWidth: 150,
        ensurePage: mock(() => makePageState()),
        advanceColumn: mock((state) => state),
        columnX: mock(() => 50),
        floatManager: makeFloatManager(),
        remeasureParagraph,
      };

      layoutParagraphBlock(ctx);

      expect(remeasureParagraph).toHaveBeenCalledWith(block, 150, 6);
    });

    it('uses fallback to 0 when both markerWidth and markerBoxWidthPx are missing', () => {
      const remeasureParagraph = mock((block, maxWidth, firstLineIndent) => {
        // Should use 0 + gutterWidth (6)
        expect(firstLineIndent).toBe(6);
        return makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 150 }]);
      });

      const block: ParagraphBlock = {
        kind: 'paragraph',
        id: 'test-block',
        runs: [{ text: 'Test', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {
          wordLayout: {
            marker: {
              // markerBoxWidthPx is missing
            },
            firstLineIndentMode: true,
          },
        },
      };

      const measure = makeMeasure(
        [{ width: 100, lineHeight: 20, maxWidth: 200 }],
        { gutterWidth: 6 }, // markerWidth is missing
      );

      const ctx: ParagraphLayoutContext = {
        block,
        measure,
        columnWidth: 150,
        ensurePage: mock(() => makePageState()),
        advanceColumn: mock((state) => state),
        columnX: mock(() => 50),
        floatManager: makeFloatManager(),
        remeasureParagraph,
      };

      layoutParagraphBlock(ctx);

      expect(remeasureParagraph).toHaveBeenCalledWith(block, 150, 6);
    });
  });

  describe('input validation', () => {
    it('handles NaN marker width gracefully', () => {
      const remeasureParagraph = mock((block, maxWidth, firstLineIndent) => {
        // NaN should be treated as 0
        expect(firstLineIndent).toBe(6); // 0 + 6
        return makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 150 }]);
      });

      const block: ParagraphBlock = {
        kind: 'paragraph',
        id: 'test-block',
        runs: [{ text: 'Test', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {
          wordLayout: {
            marker: {
              markerBoxWidthPx: 20,
            },
            firstLineIndentMode: true,
          },
        },
      };

      const measure = makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 200 }], {
        markerWidth: NaN,
        gutterWidth: 6,
      });

      const ctx: ParagraphLayoutContext = {
        block,
        measure,
        columnWidth: 150,
        ensurePage: mock(() => makePageState()),
        advanceColumn: mock((state) => state),
        columnX: mock(() => 50),
        floatManager: makeFloatManager(),
        remeasureParagraph,
      };

      layoutParagraphBlock(ctx);

      expect(remeasureParagraph).toHaveBeenCalledWith(block, 150, 6);
    });

    it('handles Infinity marker width gracefully', () => {
      const remeasureParagraph = mock((block, maxWidth, firstLineIndent) => {
        // Infinity should be treated as 0
        expect(firstLineIndent).toBe(6); // 0 + 6
        return makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 150 }]);
      });

      const block: ParagraphBlock = {
        kind: 'paragraph',
        id: 'test-block',
        runs: [{ text: 'Test', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {
          wordLayout: {
            marker: {
              markerBoxWidthPx: 20,
            },
            firstLineIndentMode: true,
          },
        },
      };

      const measure = makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 200 }], {
        markerWidth: Infinity,
        gutterWidth: 6,
      });

      const ctx: ParagraphLayoutContext = {
        block,
        measure,
        columnWidth: 150,
        ensurePage: mock(() => makePageState()),
        advanceColumn: mock((state) => state),
        columnX: mock(() => 50),
        floatManager: makeFloatManager(),
        remeasureParagraph,
      };

      layoutParagraphBlock(ctx);

      expect(remeasureParagraph).toHaveBeenCalledWith(block, 150, 6);
    });

    it('handles negative marker width gracefully', () => {
      const remeasureParagraph = mock((block, maxWidth, firstLineIndent) => {
        // Negative values should be treated as 0
        expect(firstLineIndent).toBe(6); // 0 + 6
        return makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 150 }]);
      });

      const block: ParagraphBlock = {
        kind: 'paragraph',
        id: 'test-block',
        runs: [{ text: 'Test', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {
          wordLayout: {
            marker: {
              markerBoxWidthPx: 20,
            },
            firstLineIndentMode: true,
          },
        },
      };

      const measure = makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 200 }], {
        markerWidth: -10,
        gutterWidth: 6,
      });

      const ctx: ParagraphLayoutContext = {
        block,
        measure,
        columnWidth: 150,
        ensurePage: mock(() => makePageState()),
        advanceColumn: mock((state) => state),
        columnX: mock(() => 50),
        floatManager: makeFloatManager(),
        remeasureParagraph,
      };

      layoutParagraphBlock(ctx);

      expect(remeasureParagraph).toHaveBeenCalledWith(block, 150, 6);
    });

    it('handles NaN gutter width gracefully', () => {
      const remeasureParagraph = mock((block, maxWidth, firstLineIndent) => {
        // NaN gutter should be treated as 0
        expect(firstLineIndent).toBe(18); // 18 + 0
        return makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 150 }]);
      });

      const block: ParagraphBlock = {
        kind: 'paragraph',
        id: 'test-block',
        runs: [{ text: 'Test', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {
          wordLayout: {
            marker: {
              markerBoxWidthPx: 20,
            },
            firstLineIndentMode: true,
          },
        },
      };

      const measure = makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 200 }], {
        markerWidth: 18,
        gutterWidth: NaN,
      });

      const ctx: ParagraphLayoutContext = {
        block,
        measure,
        columnWidth: 150,
        ensurePage: mock(() => makePageState()),
        advanceColumn: mock((state) => state),
        columnX: mock(() => 50),
        floatManager: makeFloatManager(),
        remeasureParagraph,
      };

      layoutParagraphBlock(ctx);

      expect(remeasureParagraph).toHaveBeenCalledWith(block, 150, 18);
    });

    it('handles negative gutter width gracefully', () => {
      const remeasureParagraph = mock((block, maxWidth, firstLineIndent) => {
        // Negative gutter should be treated as 0
        expect(firstLineIndent).toBe(18); // 18 + 0
        return makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 150 }]);
      });

      const block: ParagraphBlock = {
        kind: 'paragraph',
        id: 'test-block',
        runs: [{ text: 'Test', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {
          wordLayout: {
            marker: {
              markerBoxWidthPx: 20,
            },
            firstLineIndentMode: true,
          },
        },
      };

      const measure = makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 200 }], {
        markerWidth: 18,
        gutterWidth: -5,
      });

      const ctx: ParagraphLayoutContext = {
        block,
        measure,
        columnWidth: 150,
        ensurePage: mock(() => makePageState()),
        advanceColumn: mock((state) => state),
        columnX: mock(() => 50),
        floatManager: makeFloatManager(),
        remeasureParagraph,
      };

      layoutParagraphBlock(ctx);

      expect(remeasureParagraph).toHaveBeenCalledWith(block, 150, 18);
    });
  });

  describe('float remeasurement', () => {
    it('moves flow text below a TopAndBottom exclusion', () => {
      const floatManager = makeFloatManager();
      floatManager.computeVerticalClearance = mock(() => 262);
      const pageState = makePageState();
      const block: ParagraphBlock = {
        kind: 'paragraph',
        id: 'top-bottom-wrap',
        runs: [{ text: 'Text below the image', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {},
      };

      layoutParagraphBlock({
        block,
        measure: makeMeasure([{ width: 120, lineHeight: 20, maxWidth: 200 }]),
        columnWidth: 200,
        ensurePage: mock(() => pageState),
        advanceColumn: mock((state) => state),
        columnX: mock(() => 50),
        floatManager,
      });

      const fragment = pageState.page.fragments[0];
      expect(fragment?.kind).toBe('para');
      if (fragment?.kind !== 'para') return;
      expect(fragment.y).toBe(262);
      expect(fragment.x).toBe(50);
      expect(fragment.width).toBe(200);
    });

    it('keeps the full-width measure after clearing a full-width Square exclusion', () => {
      const floatManager = makeFloatManager();
      floatManager.computeVerticalClearance = mock((lineY) => (lineY < 262 ? 262 : null));
      floatManager.computeAvailableRegions = mock((lineY, _lineHeight, columnWidth) =>
        lineY < 262 ? [{ offsetX: 0, width: 1 }] : [{ offsetX: 0, width: columnWidth }],
      );
      const remeasureParagraph = mock((_block, maxWidth) => makeMeasure([{ width: 120, lineHeight: 20, maxWidth }]));
      const pageState = makePageState();
      const block: ParagraphBlock = {
        kind: 'paragraph',
        id: 'full-width-square-wrap',
        runs: [{ text: 'Text below the image', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {},
      };

      layoutParagraphBlock({
        block,
        measure: makeMeasure([{ width: 120, lineHeight: 20, maxWidth: 200 }]),
        columnWidth: 200,
        ensurePage: mock(() => pageState),
        advanceColumn: mock((state) => state),
        columnX: mock(() => 50),
        floatManager,
        remeasureParagraph,
      });

      expect(remeasureParagraph).not.toHaveBeenCalled();
      const fragment = pageState.page.fragments[0];
      expect(fragment?.kind).toBe('para');
      if (fragment?.kind !== 'para') return;
      expect(fragment.y).toBe(262);
      expect(fragment.lines).toBeUndefined();
    });

    it('splits a paragraph when a later line reaches a TopAndBottom exclusion', () => {
      const floatManager = makeFloatManager();
      floatManager.computeVerticalClearance = mock((lineY, lineHeight) =>
        lineY < 200 && lineY + lineHeight > 70 ? 200 : null,
      );
      const pageState = makePageState();
      const block: ParagraphBlock = {
        kind: 'paragraph',
        id: 'top-bottom-mid-paragraph',
        runs: [{ text: 'One line above, one below', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {},
      };

      layoutParagraphBlock({
        block,
        measure: makeMeasure([
          { width: 120, lineHeight: 20, maxWidth: 200 },
          { width: 120, lineHeight: 20, maxWidth: 200 },
        ]),
        columnWidth: 200,
        ensurePage: mock(() => pageState),
        advanceColumn: mock((state) => state),
        columnX: mock(() => 50),
        floatManager,
      });

      const fragments = pageState.page.fragments.filter((fragment) => fragment.kind === 'para');
      expect(fragments).toHaveLength(2);
      expect(fragments[0]?.y).toBe(50);
      expect(fragments[1]?.y).toBe(200);
    });

    it('preserves both regions around a centered float for the remeasure callback', () => {
      const remeasureParagraph = mock((_block, maxWidth) => makeMeasure([{ width: 180, lineHeight: 20, maxWidth }]));
      const floatManager = makeFloatManager();
      floatManager.computeAvailableRegions = mock(() => [
        { offsetX: 0, width: 80 },
        { offsetX: 120, width: 80 },
      ]);
      const block: ParagraphBlock = {
        kind: 'paragraph',
        id: 'centered-both-sides',
        runs: [{ text: 'Text on both sides', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {},
      };

      layoutParagraphBlock({
        block,
        measure: makeMeasure([{ width: 180, lineHeight: 20, maxWidth: 200 }]),
        columnWidth: 200,
        ensurePage: mock(() => makePageState()),
        advanceColumn: mock((state) => state),
        columnX: mock(() => 50),
        floatManager,
        remeasureParagraph,
      });

      expect(remeasureParagraph.mock.calls[0]?.[3]?.[0]).toEqual([
        { offsetX: 0, width: 80 },
        { offsetX: 120, width: 80 },
      ]);
    });

    it('remeasures with correct firstLineIndent when narrower width is found due to floats', () => {
      const remeasureParagraph = mock((block, maxWidth, firstLineIndent) => {
        expect(firstLineIndent).toBe(24); // 18 + 6
        return makeMeasure([{ width: 100, lineHeight: 20, maxWidth }]);
      });

      const floatManager = makeFloatManager();
      // Mock float manager to return narrower width
      floatManager.computeAvailableWidth = mock(() => ({
        width: 120, // Narrower than column width
        offsetX: 10,
      }));
      floatManager.computeAvailableRegions = mock(() => [{ width: 120, offsetX: 10 }]);

      const block: ParagraphBlock = {
        kind: 'paragraph',
        id: 'test-block',
        runs: [{ text: 'Test', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {
          wordLayout: {
            marker: {
              markerBoxWidthPx: 20,
            },
            firstLineIndentMode: true,
          },
        },
      };

      const measure = makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 150 }], { markerWidth: 18, gutterWidth: 6 });

      const ctx: ParagraphLayoutContext = {
        block,
        measure,
        columnWidth: 150,
        ensurePage: mock(() => makePageState()),
        advanceColumn: mock((state) => state),
        columnX: mock(() => 50),
        floatManager,
        remeasureParagraph,
      };

      layoutParagraphBlock(ctx);

      expect(remeasureParagraph).toHaveBeenCalledWith(block, 150, 24, [[{ width: 120, offsetX: 10 }]]);
    });

    it('keeps full-width layout when remeasured lines no longer intersect the float', () => {
      const remeasureParagraph = mock((_block, maxWidth) => makeMeasure([{ width: 0, lineHeight: 20.8, maxWidth }]));

      const floatManager = makeFloatManager();
      const floatTop = 72.4;
      floatManager.computeAvailableWidth = mock((lineY, lineHeight, columnWidth) => {
        const intersectsFloat = lineY < floatTop && lineY + lineHeight > floatTop;
        return intersectsFloat ? { width: 120, offsetX: 80 } : { width: columnWidth, offsetX: 0 };
      });
      floatManager.computeAvailableRegions = mock((lineY, lineHeight, columnWidth) => {
        const intersectsFloat = lineY < floatTop && lineY + lineHeight > floatTop;
        return intersectsFloat ? [{ width: 120, offsetX: 80 }] : [{ width: columnWidth, offsetX: 0 }];
      });

      const block: ParagraphBlock = {
        kind: 'paragraph',
        id: 'barely-intersecting-empty-line',
        runs: [{ text: '', fontFamily: 'IBM Plex Sans', fontSize: 17.33 }],
        attrs: {},
      };
      const measure = makeMeasure([{ width: 0, lineHeight: 22.7, maxWidth: 200 }]);
      const pageState = makePageState();

      layoutParagraphBlock({
        block,
        measure,
        columnWidth: 200,
        ensurePage: mock(() => pageState),
        advanceColumn: mock((state) => state),
        columnX: mock(() => 50),
        floatManager,
        remeasureParagraph,
      });

      expect(remeasureParagraph).toHaveBeenCalledWith(block, 200, 0, [[{ width: 120, offsetX: 80 }]]);
      const fragment = pageState.page.fragments[0];
      expect(fragment?.kind).toBe('para');
      if (fragment?.kind !== 'para') return;
      expect(fragment.x).toBe(50);
      expect(fragment.width).toBe(200);
      expect(fragment.lines).toBeUndefined();
    });

    it('does not expand fragment width past column when negative indents meet float wrap', () => {
      const remeasureParagraph = mock((_block, maxWidth, _firstLineIndent, lineRegions) => {
        const next = makeMeasure([{ width: 100, lineHeight: 20, maxWidth }]);
        next.lines[0]!.segments = [
          { runIndex: 0, fromChar: 0, toChar: 12, width: 100, x: lineRegions?.[0]?.[0]?.offsetX },
        ];
        return next;
      });

      const floatManager = makeFloatManager();
      floatManager.computeAvailableWidth = mock(() => ({
        width: 400,
        offsetX: 80,
      }));
      floatManager.computeAvailableRegions = mock(() => [{ width: 400, offsetX: 80 }]);

      const block: ParagraphBlock = {
        kind: 'paragraph',
        id: 'negative-indent-float',
        runs: [{ text: 'Wrapped text', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {
          indent: { left: -8, right: -2 },
        },
      };

      const measure = makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 500 }]);
      const pageState = makePageState();

      layoutParagraphBlock({
        block,
        measure,
        columnWidth: 500,
        ensurePage: mock(() => pageState),
        advanceColumn: mock((state) => state),
        columnX: mock(() => 50),
        floatManager,
        remeasureParagraph,
      });

      const fragment = pageState.page.fragments[0];
      expect(fragment?.kind).toBe('para');
      if (fragment?.kind !== 'para') return;
      expect(fragment.x).toBe(50);
      expect(fragment.width).toBe(500);
      expect(fragment.lines?.[0]?.segments?.[0]?.x).toBe(88);
    });
  });
});

describe('layoutParagraphBlock - split line-break carriers', () => {
  it('keeps carrier collapse after column-width remeasurement', () => {
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'split-carrier',
      runs: [{ kind: 'lineBreak' }],
    };
    const measure = makeMeasure([
      { width: 0, lineHeight: 20, maxWidth: 300 },
      { width: 0, lineHeight: 20, maxWidth: 300 },
    ]);
    const remeasureParagraph = mock(() =>
      makeMeasure([
        { width: 0, lineHeight: 20, maxWidth: 100 },
        { width: 0, lineHeight: 20, maxWidth: 100 },
      ]),
    );
    const pageState = makePageState();

    layoutParagraphBlock({
      block,
      measure,
      columnWidth: 100,
      ensurePage: mock(() => pageState),
      advanceColumn: mock((state) => state),
      columnX: mock(() => 50),
      floatManager: makeFloatManager(),
      remeasureParagraph,
      collapseSplitLineBreakCarrier: true,
    });

    expect(remeasureParagraph).toHaveBeenCalledWith(block, 100, 0);
    const fragment = pageState.page.fragments[0] as ParaFragment | undefined;
    expect(fragment?.kind).toBe('para');
    expect(fragment?.toLine).toBe(1);
    expect(pageState.cursorY).toBe(70);
  });
});

describe('layoutParagraphBlock - contextualSpacing', () => {
  describe('same-style paragraphs', () => {
    it('suppresses spacingBefore when both same-style paragraphs opt in', () => {
      const pageState = makePageState();
      pageState.lastParagraphStyleId = 'Heading1';
      pageState.lastParagraphContextualSpacing = true;
      pageState.trailingSpacing = 20;
      pageState.cursorY = 100;

      const ensurePage = mock(() => pageState);

      const block: ParagraphBlock = {
        kind: 'paragraph',
        id: 'test-block',
        runs: [{ text: 'Test', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {
          styleId: 'Heading1',
          contextualSpacing: true,
          spacing: {
            before: 30,
            after: 20,
          },
        },
      };

      const measure = makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 150 }]);

      const ctx: ParagraphLayoutContext = {
        block,
        measure,
        columnWidth: 150,
        ensurePage,
        advanceColumn: mock((state) => state),
        columnX: mock(() => 50),
        floatManager: makeFloatManager(),
      };

      layoutParagraphBlock(ctx);

      // When contextualSpacing is active and styles match:
      // 1. spacingBefore (30) is zeroed
      // 2. prevTrailing (20) is undone (cursorY -= 20)
      // 3. Line height (20) is added
      // 4. spacingAfter (20) is added at the end
      // Result: 100 - 20 + 20 + 20 = 120
      expect(pageState.cursorY).toBe(120);
    });

    it('undoes previous paragraph trailing spacing when contextualSpacing is active', () => {
      const pageState = makePageState();
      pageState.lastParagraphStyleId = 'Normal';
      pageState.lastParagraphContextualSpacing = true;
      pageState.trailingSpacing = 15;
      pageState.cursorY = 100;

      const ensurePage = mock(() => pageState);

      const block: ParagraphBlock = {
        kind: 'paragraph',
        id: 'test-block',
        runs: [{ text: 'Test', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {
          styleId: 'Normal',
          contextualSpacing: true,
          spacing: {
            before: 10,
            after: 10,
          },
        },
      };

      const measure = makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 150 }]);

      const ctx: ParagraphLayoutContext = {
        block,
        measure,
        columnWidth: 150,
        ensurePage,
        advanceColumn: mock((state) => state),
        columnX: mock(() => 50),
        floatManager: makeFloatManager(),
      };

      layoutParagraphBlock(ctx);

      // When contextualSpacing is active and styles match:
      // 1. spacingBefore (10) is zeroed
      // 2. prevTrailing (15) is undone (cursorY -= 15)
      // 3. Line height (20) is added
      // 4. spacingAfter (10) is added at the end
      // Result: 100 - 15 + 20 + 10 = 115
      expect(pageState.cursorY).toBe(115);
      expect(pageState.trailingSpacing).toBe(10);
    });

    it('handles contextualSpacing when trailingSpacing is 0', () => {
      const pageState = makePageState();
      pageState.lastParagraphStyleId = 'Normal';
      pageState.lastParagraphContextualSpacing = true;
      pageState.trailingSpacing = 0;
      pageState.cursorY = 100;

      const ensurePage = mock(() => pageState);

      const block: ParagraphBlock = {
        kind: 'paragraph',
        id: 'test-block',
        runs: [{ text: 'Test', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {
          styleId: 'Normal',
          contextualSpacing: true,
          spacing: {
            before: 10,
            after: 10,
          },
        },
      };

      const measure = makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 150 }]);

      const ctx: ParagraphLayoutContext = {
        block,
        measure,
        columnWidth: 150,
        ensurePage,
        advanceColumn: mock((state) => state),
        columnX: mock(() => 50),
        floatManager: makeFloatManager(),
      };

      layoutParagraphBlock(ctx);

      // When contextualSpacing is active and styles match:
      // 1. spacingBefore (10) is zeroed
      // 2. prevTrailing (0) is undone (no change)
      // 3. Line height (20) is added
      // 4. spacingAfter (10) is added at the end
      // Result: 100 + 20 + 10 = 130
      expect(pageState.cursorY).toBe(130);
      expect(pageState.trailingSpacing).toBe(10);
    });

    it('handles contextualSpacing when trailingSpacing is null', () => {
      const pageState = makePageState();
      pageState.lastParagraphStyleId = 'Normal';
      pageState.lastParagraphContextualSpacing = true;
      // oxlint-disable-next-line @typescript-eslint/no-explicit-any
      (pageState.trailingSpacing as any) = null;
      pageState.cursorY = 100;

      const ensurePage = mock(() => pageState);

      const block: ParagraphBlock = {
        kind: 'paragraph',
        id: 'test-block',
        runs: [{ text: 'Test', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {
          styleId: 'Normal',
          contextualSpacing: true,
          spacing: {
            before: 10,
            after: 10,
          },
        },
      };

      const measure = makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 150 }]);

      const ctx: ParagraphLayoutContext = {
        block,
        measure,
        columnWidth: 150,
        ensurePage,
        advanceColumn: mock((state) => state),
        columnX: mock(() => 50),
        floatManager: makeFloatManager(),
      };

      layoutParagraphBlock(ctx);

      // null trailingSpacing is treated as 0
      // Result: 100 + 20 + 10 = 130
      expect(pageState.cursorY).toBe(130);
    });

    it('handles contextualSpacing when trailingSpacing is undefined', () => {
      const pageState = makePageState();
      pageState.lastParagraphStyleId = 'Normal';
      pageState.lastParagraphContextualSpacing = true;
      pageState.trailingSpacing = 0;
      pageState.cursorY = 100;

      const ensurePage = mock(() => pageState);

      const block: ParagraphBlock = {
        kind: 'paragraph',
        id: 'test-block',
        runs: [{ text: 'Test', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {
          styleId: 'Normal',
          contextualSpacing: true,
          spacing: {
            before: 10,
            after: 10,
          },
        },
      };

      const measure = makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 150 }]);

      const ctx: ParagraphLayoutContext = {
        block,
        measure,
        columnWidth: 150,
        ensurePage,
        advanceColumn: mock((state) => state),
        columnX: mock(() => 50),
        floatManager: makeFloatManager(),
      };

      layoutParagraphBlock(ctx);

      // undefined trailingSpacing is treated as 0
      // Result: 100 + 20 + 10 = 130
      expect(pageState.cursorY).toBe(130);
    });
  });

  describe('different-style paragraphs', () => {
    it('does not apply contextualSpacing when style IDs differ', () => {
      const pageState = makePageState();
      pageState.lastParagraphStyleId = 'Heading1';
      pageState.trailingSpacing = 20;
      pageState.cursorY = 100;

      const ensurePage = mock(() => pageState);

      const block: ParagraphBlock = {
        kind: 'paragraph',
        id: 'test-block',
        runs: [{ text: 'Test', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {
          styleId: 'Normal',
          contextualSpacing: true,
          spacing: {
            before: 30,
            after: 20,
          },
        },
      };

      const measure = makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 150 }]);

      const ctx: ParagraphLayoutContext = {
        block,
        measure,
        columnWidth: 150,
        ensurePage,
        advanceColumn: mock((state) => state),
        columnX: mock(() => 50),
        floatManager: makeFloatManager(),
      };

      layoutParagraphBlock(ctx);

      // Different styles: contextualSpacing should NOT suppress spacing
      // Normal spacing collapse applies:
      // 1. prevTrailing (20) remains in trailingSpacing (will be collapsed)
      // 2. spacingBefore (30) - prevTrailing (20) = 10 additional spacing
      // 3. Line height (20) is added
      // 4. spacingAfter (20) is added at the end
      // Result: 100 + 10 + 20 + 20 = 150
      expect(pageState.cursorY).toBe(150);
    });

    it('does not apply contextualSpacing when lastParagraphStyleId is undefined', () => {
      const pageState = makePageState();
      pageState.lastParagraphStyleId = undefined;
      pageState.trailingSpacing = 20;
      pageState.cursorY = 100;

      const ensurePage = mock(() => pageState);

      const block: ParagraphBlock = {
        kind: 'paragraph',
        id: 'test-block',
        runs: [{ text: 'Test', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {
          styleId: 'Normal',
          contextualSpacing: true,
          spacing: {
            before: 30,
            after: 20,
          },
        },
      };

      const measure = makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 150 }]);

      const ctx: ParagraphLayoutContext = {
        block,
        measure,
        columnWidth: 150,
        ensurePage,
        advanceColumn: mock((state) => state),
        columnX: mock(() => 50),
        floatManager: makeFloatManager(),
      };

      layoutParagraphBlock(ctx);

      // No lastParagraphStyleId: contextualSpacing should NOT apply
      // Normal spacing collapse applies
      // Result: 100 + 10 + 20 + 20 = 150
      expect(pageState.cursorY).toBe(150);
    });

    it('does not apply contextualSpacing when current styleId is undefined', () => {
      const pageState = makePageState();
      pageState.lastParagraphStyleId = 'Normal';
      pageState.trailingSpacing = 20;
      pageState.cursorY = 100;

      const ensurePage = mock(() => pageState);

      const block: ParagraphBlock = {
        kind: 'paragraph',
        id: 'test-block',
        runs: [{ text: 'Test', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {
          // styleId is undefined
          contextualSpacing: true,
          spacing: {
            before: 30,
            after: 20,
          },
        },
      };

      const measure = makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 150 }]);

      const ctx: ParagraphLayoutContext = {
        block,
        measure,
        columnWidth: 150,
        ensurePage,
        advanceColumn: mock((state) => state),
        columnX: mock(() => 50),
        floatManager: makeFloatManager(),
      };

      layoutParagraphBlock(ctx);

      // No current styleId: contextualSpacing should NOT apply
      // Normal spacing collapse applies
      // Result: 100 + 10 + 20 + 20 = 150
      expect(pageState.cursorY).toBe(150);
    });
  });

  describe('contextualSpacing disabled', () => {
    it('does not suppress spacing when contextualSpacing is false', () => {
      const pageState = makePageState();
      pageState.lastParagraphStyleId = 'Normal';
      pageState.trailingSpacing = 20;
      pageState.cursorY = 100;

      const ensurePage = mock(() => pageState);

      const block: ParagraphBlock = {
        kind: 'paragraph',
        id: 'test-block',
        runs: [{ text: 'Test', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {
          styleId: 'Normal',
          contextualSpacing: false,
          spacing: {
            before: 30,
            after: 20,
          },
        },
      };

      const measure = makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 150 }]);

      const ctx: ParagraphLayoutContext = {
        block,
        measure,
        columnWidth: 150,
        ensurePage,
        advanceColumn: mock((state) => state),
        columnX: mock(() => 50),
        floatManager: makeFloatManager(),
      };

      layoutParagraphBlock(ctx);

      // contextualSpacing is false: normal spacing collapse should apply
      // Result: 100 + 10 + 20 + 20 = 150
      expect(pageState.cursorY).toBe(150);
    });

    it('does not suppress spacing when contextualSpacing is not set', () => {
      const pageState = makePageState();
      pageState.lastParagraphStyleId = 'Normal';
      pageState.trailingSpacing = 20;
      pageState.cursorY = 100;

      const ensurePage = mock(() => pageState);

      const block: ParagraphBlock = {
        kind: 'paragraph',
        id: 'test-block',
        runs: [{ text: 'Test', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {
          styleId: 'Normal',
          // contextualSpacing not set
          spacing: {
            before: 30,
            after: 20,
          },
        },
      };

      const measure = makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 150 }]);

      const ctx: ParagraphLayoutContext = {
        block,
        measure,
        columnWidth: 150,
        ensurePage,
        advanceColumn: mock((state) => state),
        columnX: mock(() => 50),
        floatManager: makeFloatManager(),
      };

      layoutParagraphBlock(ctx);

      // contextualSpacing not set: normal spacing collapse should apply
      // Result: 100 + 10 + 20 + 20 = 150
      expect(pageState.cursorY).toBe(150);
    });
  });

  describe('edge cases', () => {
    it('handles NaN trailingSpacing gracefully', () => {
      const pageState = makePageState();
      pageState.lastParagraphStyleId = 'Normal';
      pageState.lastParagraphContextualSpacing = true;
      pageState.trailingSpacing = NaN;
      pageState.cursorY = 100;

      const ensurePage = mock(() => pageState);

      const block: ParagraphBlock = {
        kind: 'paragraph',
        id: 'test-block',
        runs: [{ text: 'Test', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {
          styleId: 'Normal',
          contextualSpacing: true,
          spacing: {
            before: 10,
            after: 10,
          },
        },
      };

      const measure = makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 150 }]);

      const ctx: ParagraphLayoutContext = {
        block,
        measure,
        columnWidth: 150,
        ensurePage,
        advanceColumn: mock((state) => state),
        columnX: mock(() => 50),
        floatManager: makeFloatManager(),
      };

      layoutParagraphBlock(ctx);

      // NaN should be treated as 0
      // Result: 100 + 20 + 10 = 130
      expect(pageState.cursorY).toBe(130);
    });

    it('handles Infinity trailingSpacing gracefully', () => {
      const pageState = makePageState();
      pageState.lastParagraphStyleId = 'Normal';
      pageState.lastParagraphContextualSpacing = true;
      pageState.trailingSpacing = Infinity;
      pageState.cursorY = 100;

      const ensurePage = mock(() => pageState);

      const block: ParagraphBlock = {
        kind: 'paragraph',
        id: 'test-block',
        runs: [{ text: 'Test', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {
          styleId: 'Normal',
          contextualSpacing: true,
          spacing: {
            before: 10,
            after: 10,
          },
        },
      };

      const measure = makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 150 }]);

      const ctx: ParagraphLayoutContext = {
        block,
        measure,
        columnWidth: 150,
        ensurePage,
        advanceColumn: mock((state) => state),
        columnX: mock(() => 50),
        floatManager: makeFloatManager(),
      };

      layoutParagraphBlock(ctx);

      // Infinity should be treated as 0
      // Result: 100 + 20 + 10 = 130
      expect(pageState.cursorY).toBe(130);
    });

    it('handles negative trailingSpacing gracefully', () => {
      const pageState = makePageState();
      pageState.lastParagraphStyleId = 'Normal';
      pageState.lastParagraphContextualSpacing = true;
      pageState.trailingSpacing = -10;
      pageState.cursorY = 100;

      const ensurePage = mock(() => pageState);

      const block: ParagraphBlock = {
        kind: 'paragraph',
        id: 'test-block',
        runs: [{ text: 'Test', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {
          styleId: 'Normal',
          contextualSpacing: true,
          spacing: {
            before: 10,
            after: 10,
          },
        },
      };

      const measure = makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 150 }]);

      const ctx: ParagraphLayoutContext = {
        block,
        measure,
        columnWidth: 150,
        ensurePage,
        advanceColumn: mock((state) => state),
        columnX: mock(() => 50),
        floatManager: makeFloatManager(),
      };

      layoutParagraphBlock(ctx);

      // Negative should be treated as 0
      // Result: 100 + 20 + 10 = 130
      expect(pageState.cursorY).toBe(130);
    });
  });

  describe('per-paragraph contextual spacing', () => {
    it('suppresses only previous after when previous has contextualSpacing but current does not', () => {
      const pageState = makePageState();
      pageState.lastParagraphStyleId = 'Normal';
      pageState.lastParagraphContextualSpacing = true;
      pageState.trailingSpacing = 20;
      pageState.cursorY = 100;

      const ensurePage = mock(() => pageState);

      const block: ParagraphBlock = {
        kind: 'paragraph',
        id: 'test-block',
        runs: [{ text: 'Test', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {
          styleId: 'Normal',
          contextualSpacing: false,
          spacing: { before: 30, after: 10 },
        },
      };

      const measure = makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 150 }]);

      const ctx: ParagraphLayoutContext = {
        block,
        measure,
        columnWidth: 150,
        ensurePage,
        advanceColumn: mock((state) => state),
        columnX: mock(() => 50),
        floatManager: makeFloatManager(),
      };

      layoutParagraphBlock(ctx);

      // Previous suppresses its own after → rewind trailing (100 - 20 = 80), trailingSpacing = 0.
      // Current does NOT suppress its own before → spacingBefore (30) stays.
      // Collapse: max(30 - 0, 0) = 30. cursorY = 80 + 30 + 20 + 10 = 140
      expect(pageState.cursorY).toBe(140);
    });

    it('suppresses only current before when current has contextualSpacing but previous does not', () => {
      const pageState = makePageState();
      pageState.lastParagraphStyleId = 'Normal';
      pageState.lastParagraphContextualSpacing = false;
      pageState.trailingSpacing = 20;
      pageState.cursorY = 100;

      const ensurePage = mock(() => pageState);

      const block: ParagraphBlock = {
        kind: 'paragraph',
        id: 'test-block',
        runs: [{ text: 'Test', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {
          styleId: 'Normal',
          contextualSpacing: true,
          spacing: { before: 30, after: 10 },
        },
      };

      const measure = makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 150 }]);

      const ctx: ParagraphLayoutContext = {
        block,
        measure,
        columnWidth: 150,
        ensurePage,
        advanceColumn: mock((state) => state),
        columnX: mock(() => 50),
        floatManager: makeFloatManager(),
      };

      layoutParagraphBlock(ctx);

      // Previous does NOT suppress its own after → no rewind (trailingSpacing stays 20).
      // Current suppresses its own before → spacingBefore = 0.
      // Collapse: max(0 - 20, 0) = 0. cursorY = 100 + 0 + 20 + 10 = 130
      expect(pageState.cursorY).toBe(130);
    });

    it('persists contextualSpacing from positioned-frame early return', () => {
      const pageState = makePageState();
      pageState.cursorY = 100;

      const ensurePage = mock(() => pageState);

      // A positioned-frame paragraph with contextualSpacing=true
      const frameBlock: ParagraphBlock = {
        kind: 'paragraph',
        id: 'frame-block',
        runs: [{ text: 'Frame', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {
          styleId: 'Normal',
          contextualSpacing: true,
          frame: { wrap: 'none' },
        },
      };

      const measure = makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 150 }]);

      layoutParagraphBlock({
        block: frameBlock,
        measure,
        columnWidth: 150,
        ensurePage,
        advanceColumn: mock((state) => state),
        columnX: mock(() => 50),
        floatManager: makeFloatManager(),
      });

      // After the positioned-frame early return, page state should carry the flag
      expect(pageState.lastParagraphStyleId).toBe('Normal');
      expect(pageState.lastParagraphContextualSpacing).toBe(true);
    });

    it('advances a wrap=none frame whose anchor starts at the page boundary without advancing flow', () => {
      const firstPage = makePageState();
      firstPage.cursorY = firstPage.contentBottom;
      const nextPage = {
        ...makePageState(),
        page: { number: 2, fragments: [] },
      };
      let currentPage = firstPage;
      const advanceColumn = mock(() => {
        currentPage = nextPage;
        return nextPage;
      });
      const frameBlock: ParagraphBlock = {
        kind: 'paragraph',
        id: 'overlay-frame',
        runs: [{ text: 'Frame', fontFamily: 'Arial', fontSize: 12 }],
        attrs: { frame: { wrap: 'none', y: 10 } },
      };

      layoutParagraphBlock({
        block: frameBlock,
        measure: makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 150 }]),
        columnWidth: 150,
        ensurePage: mock(() => currentPage),
        advanceColumn,
        columnX: mock(() => 50),
        floatManager: makeFloatManager(),
      });

      expect(advanceColumn).toHaveBeenCalledTimes(1);
      expect(firstPage.page.fragments).toHaveLength(0);
      expect(nextPage.page.fragments).toHaveLength(1);
      expect(nextPage.page.fragments[0]?.y).toBe(60);
      expect(nextPage.cursorY).toBe(50);
    });

    it('positions frame paragraphs with wrap=around using frame alignment', () => {
      const pageState = makePageState();
      const ensurePage = mock(() => pageState);

      const frameBlock: ParagraphBlock = {
        kind: 'paragraph',
        id: 'frame-around',
        runs: [{ text: 'Frame', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {
          frame: {
            wrap: 'around',
            xAlign: 'center',
            y: 1,
            hAnchor: 'margin',
            vAnchor: 'text',
          },
        },
      };

      const measure = makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 600 }]);

      layoutParagraphBlock({
        block: frameBlock,
        measure,
        columnWidth: 600,
        ensurePage,
        advanceColumn: mock((state) => state),
        columnX: mock(() => 0),
        floatManager: makeFloatManager(),
      });

      const fragment = pageState.page.fragments[0] as DrawingFragment | undefined;
      expect(fragment).toBeDefined();
      expect(fragment?.kind).toBe('para');
      expect(fragment?.x).toBe(250);
      expect(fragment?.y).toBe(51);
      expect(fragment?.width).toBe(600);
      expect(pageState.cursorY).toBe(70);
      expect(pageState.maxCursorY).toBe(70);
    });

    it('centers empty wrap=around frame paragraphs using content width while keeping full fragment width', () => {
      const pageState = makePageState();
      const ensurePage = mock(() => pageState);

      const frameBlock: ParagraphBlock = {
        kind: 'paragraph',
        id: 'frame-empty',
        runs: [{ text: '', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {
          frame: {
            wrap: 'around',
            xAlign: 'center',
            y: 1,
            hAnchor: 'margin',
            vAnchor: 'text',
          },
        },
      };

      const measure = makeMeasure([{ width: 0, lineHeight: 20, maxWidth: 600 }]);

      layoutParagraphBlock({
        block: frameBlock,
        measure,
        columnWidth: 600,
        ensurePage,
        advanceColumn: mock((state) => state),
        columnX: mock(() => 0),
        floatManager: makeFloatManager(),
      });

      const fragment = pageState.page.fragments[0] as DrawingFragment | undefined;
      expect(fragment).toBeDefined();
      expect(fragment?.kind).toBe('para');
      expect(fragment?.x).toBe(300);
      expect(fragment?.y).toBe(51);
      expect(fragment?.width).toBe(600);
      expect(pageState.cursorY).toBe(70);
    });
  });
});

describe('layoutParagraphBlock - anchored textbox drawings', () => {
  it('anchors paragraph-relative drawings before paragraph spaceBefore', () => {
    const pageState = makePageState();
    const ensurePage = mock(() => pageState);
    const floatManager = makeFloatManager();
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'spaced-anchor-paragraph',
      runs: [{ text: 'Anchor', fontFamily: 'Arial', fontSize: 12 }],
      attrs: { spacing: { before: 18.4 } },
    };
    const drawingBlock: TextboxDrawing = {
      kind: 'drawing',
      id: 'paragraph-relative-drawing',
      drawingKind: 'textboxShape',
      geometry: { width: 100, height: 40, rotation: 0, flipH: false, flipV: false },
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'column',
        vRelativeFrom: 'paragraph',
        offsetH: 0,
        offsetV: -38.2,
      },
    };
    const drawingMeasure: DrawingMeasure = {
      kind: 'drawing',
      width: 100,
      height: 40,
      geometry: drawingBlock.geometry,
      scale: 1,
    };

    layoutParagraphBlock(
      {
        block,
        measure: makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 150 }]),
        columnWidth: 150,
        ensurePage,
        advanceColumn: mock((state) => state),
        columnX: mock(() => 50),
        floatManager,
      },
      {
        anchoredDrawings: [{ block: drawingBlock, measure: drawingMeasure }],
        anchoredTables: [],
        columnWidth: 150,
        pageWidth: 600,
        pageMargins: { top: 50, right: 50, bottom: 50, left: 50 },
        columns: { width: 150, gap: 20, count: 1 },
        placedAnchoredIds: new Set<string>(),
      },
    );

    const fragment = pageState.page.fragments.find((entry) => entry.kind === 'drawing') as DrawingFragment;
    expect(fragment.y).toBeCloseTo(11.8);
    const registeredY = (floatManager.registerDrawing as ReturnType<typeof mock>).mock.calls[0]?.[2] as number;
    expect(registeredY).toBeCloseTo(11.8);
  });

  it('anchors legacy drawings without vRelativeFrom after paragraph spaceBefore', () => {
    const pageState = makePageState();
    const ensurePage = mock(() => pageState);
    const floatManager = makeFloatManager();
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'spaced-legacy-anchor-paragraph',
      runs: [{ text: 'Anchor', fontFamily: 'Arial', fontSize: 12 }],
      attrs: { spacing: { before: 18.4 } },
    };
    const drawingBlock: TextboxDrawing = {
      kind: 'drawing',
      id: 'legacy-paragraph-anchor-drawing',
      drawingKind: 'textboxShape',
      geometry: { width: 100, height: 40, rotation: 0, flipH: false, flipV: false },
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'column',
        offsetH: 0,
        offsetV: -38.2,
      },
    };
    const drawingMeasure: DrawingMeasure = {
      kind: 'drawing',
      width: 100,
      height: 40,
      geometry: drawingBlock.geometry,
      scale: 1,
    };

    layoutParagraphBlock(
      {
        block,
        measure: makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 150 }]),
        columnWidth: 150,
        ensurePage,
        advanceColumn: mock((state) => state),
        columnX: mock(() => 50),
        floatManager,
      },
      {
        anchoredDrawings: [{ block: drawingBlock, measure: drawingMeasure }],
        anchoredTables: [],
        columnWidth: 150,
        pageWidth: 600,
        pageMargins: { top: 50, right: 50, bottom: 50, left: 50 },
        columns: { width: 150, gap: 20, count: 1 },
        placedAnchoredIds: new Set<string>(),
      },
    );

    const fragment = pageState.page.fragments.find((entry) => entry.kind === 'drawing') as DrawingFragment;
    expect(fragment.y).toBeCloseTo(30.2);
    const registeredY = (floatManager.registerDrawing as ReturnType<typeof mock>).mock.calls[0]?.[2] as number;
    expect(registeredY).toBeCloseTo(30.2);
  });

  it('attaches textbox content measures for anchored textbox fragments', () => {
    const pageState = makePageState();
    const ensurePage = mock(() => pageState);
    const remeasureParagraph = mock((_block: ParagraphBlock, _maxWidth: number) => ({
      kind: 'paragraph' as const,
      lines: [],
      totalHeight: 18,
    }));

    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'anchor-paragraph',
      runs: [{ text: 'Anchor', fontFamily: 'Arial', fontSize: 12 }],
    };

    const measure = makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 150 }]);
    const textboxParagraph: ParagraphBlock = {
      kind: 'paragraph',
      id: 'textbox-paragraph',
      runs: [{ text: 'Textbox text', fontFamily: 'Arial', fontSize: 10 }],
      pmStart: 21,
      pmEnd: 33,
    };
    const drawingBlock: TextboxDrawing = {
      kind: 'drawing',
      id: 'drawing-1',
      drawingKind: 'textboxShape',
      geometry: { width: 143, height: 45, rotation: 0, flipH: false, flipV: false },
      contentBlocks: [textboxParagraph],
      textInsets: { top: 10, right: 10, bottom: 10, left: 10 },
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'column',
        vRelativeFrom: 'paragraph',
        offsetH: 0,
        offsetV: 0,
      },
    };
    const drawingMeasure: DrawingMeasure = {
      kind: 'drawing',
      width: 143,
      height: 45,
      geometry: drawingBlock.geometry,
      scale: 1,
    };

    const ctx: ParagraphLayoutContext = {
      block,
      measure,
      columnWidth: 150,
      ensurePage,
      advanceColumn: mock((state) => state),
      columnX: mock(() => 50),
      floatManager: makeFloatManager(),
      remeasureParagraph,
    };

    layoutParagraphBlock(ctx, {
      anchoredDrawings: [{ block: drawingBlock, measure: drawingMeasure }],
      anchoredTables: [],
      columnWidth: 150,
      pageWidth: 600,
      pageMargins: { top: 50, right: 50, bottom: 50, left: 50 },
      columns: { width: 150, gap: 20, count: 1 },
      placedAnchoredIds: new Set<string>(),
    });

    expect(remeasureParagraph).toHaveBeenCalledWith(textboxParagraph, 123);
    expect(pageState.page.fragments).toHaveLength(2);
    expect(pageState.page.fragments[0]?.kind).toBe('drawing');
    const fragment = pageState.page.fragments[0] as DrawingFragment;
    expect(fragment.contentMeasures).toEqual([{ kind: 'paragraph', lines: [], totalHeight: 18 }]);
  });
});

describe('layoutParagraphBlock - paragraph-relative anchored image pagination', () => {
  it('moves the anchor paragraph and image together when the image would cross the page bottom', () => {
    const firstPage = makePageState();
    firstPage.cursorY = 700;
    firstPage.maxCursorY = 700;

    const secondPage = makePageState();
    secondPage.page.number = 2;

    let currentState = firstPage;
    const ensurePage = mock(() => currentState);
    const advanceColumn = mock(() => {
      currentState = secondPage;
      return secondPage;
    });
    const floatManager = makeFloatManager();
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'image-anchor-paragraph',
      runs: [],
    };
    const imageBlock: ImageBlock = {
      kind: 'image',
      id: 'page-bottom-image',
      src: 'blob:page-bottom-image',
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'column',
        vRelativeFrom: 'paragraph',
        alignH: 'center',
        alignV: 'top',
      },
      wrap: { type: 'Square', wrapText: 'largest' },
    };
    const imageMeasure: ImageMeasure = {
      kind: 'image',
      width: 500,
      height: 320,
    };

    layoutParagraphBlock(
      {
        block,
        measure: makeMeasure([{ width: 0, lineHeight: 20, maxWidth: 600 }]),
        columnWidth: 600,
        ensurePage,
        advanceColumn,
        columnX: mock(() => 50),
        floatManager,
      },
      {
        anchoredDrawings: [{ block: imageBlock, measure: imageMeasure }],
        anchoredTables: [],
        columnWidth: 600,
        pageWidth: 700,
        pageMargins: { top: 50, right: 50, bottom: 50, left: 50 },
        columns: { width: 600, gap: 0, count: 1 },
        placedAnchoredIds: new Set<string>(),
      },
    );

    expect(advanceColumn).toHaveBeenCalledTimes(1);
    expect(firstPage.page.fragments).toHaveLength(0);
    expect(secondPage.page.fragments.map((fragment) => fragment.kind)).toEqual(['image', 'para']);
    const image = secondPage.page.fragments[0] as ImageFragment;
    expect(image.y).toBe(50);
    expect(image.y + image.height).toBeLessThanOrEqual(secondPage.contentBottom);
    expect(floatManager.registerDrawing).toHaveBeenCalledWith(imageBlock, imageMeasure, 50, 0, 2);
  });

  it('moves paragraph-relative wrap-none behind-doc images instead of placing them in the previous footer', () => {
    const firstPage = makePageState();
    firstPage.cursorY = 700;
    firstPage.maxCursorY = 700;

    const secondPage = makePageState();
    secondPage.page.number = 2;

    let currentState = firstPage;
    const ensurePage = mock(() => currentState);
    const advanceColumn = mock(() => {
      currentState = secondPage;
      return secondPage;
    });
    const floatManager = makeFloatManager();
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'image-anchor-paragraph',
      runs: [{ text: '', fontFamily: 'Arial', fontSize: 12 }],
    };
    const imageBlock: ImageBlock = {
      kind: 'image',
      id: 'paragraph-relative-behind-doc-image',
      src: 'blob:paragraph-relative-behind-doc-image',
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'margin',
        vRelativeFrom: 'paragraph',
        alignH: 'left',
        alignV: 'top',
        offsetV: 0,
        behindDoc: true,
      },
      wrap: { type: 'None', behindDoc: true },
    };
    const imageMeasure: ImageMeasure = {
      kind: 'image',
      width: 500,
      height: 650,
    };

    layoutParagraphBlock(
      {
        block,
        measure: makeMeasure([{ width: 0, lineHeight: 20, maxWidth: 600 }]),
        columnWidth: 600,
        ensurePage,
        advanceColumn,
        columnX: mock(() => 50),
        floatManager,
      },
      {
        anchoredDrawings: [{ block: imageBlock, measure: imageMeasure }],
        anchoredTables: [],
        columnWidth: 600,
        pageWidth: 700,
        pageMargins: { top: 50, right: 50, bottom: 50, left: 50 },
        columns: { width: 600, gap: 0, count: 1 },
        placedAnchoredIds: new Set<string>(),
      },
    );

    expect(advanceColumn).toHaveBeenCalledTimes(1);
    expect(firstPage.page.fragments).toHaveLength(0);
    expect(secondPage.page.fragments.map((fragment) => fragment.kind)).toEqual(['image', 'para']);
    const image = secondPage.page.fragments[0] as ImageFragment;
    expect(image.behindDoc).toBe(true);
    expect(image.y).toBe(50);
    expect(image.y + image.height).toBeLessThanOrEqual(secondPage.contentBottom);
    expect(floatManager.registerDrawing).toHaveBeenCalledWith(imageBlock, imageMeasure, 50, 0, 2);
  });

  it('does not advance repeatedly when the image cannot fit on an empty page', () => {
    const page = makePageState();
    page.cursorY = 700;
    page.maxCursorY = 700;

    const advanceColumn = mock(() => page);
    const imageBlock: ImageBlock = {
      kind: 'image',
      id: 'oversized-page-bottom-image',
      src: 'blob:oversized-page-bottom-image',
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'column',
        vRelativeFrom: 'paragraph',
        alignH: 'center',
        alignV: 'top',
      },
      wrap: { type: 'Square', wrapText: 'largest' },
    };

    layoutParagraphBlock(
      {
        block: { kind: 'paragraph', id: 'oversized-image-anchor', runs: [] },
        measure: makeMeasure([{ width: 0, lineHeight: 20, maxWidth: 600 }]),
        columnWidth: 600,
        ensurePage: mock(() => page),
        advanceColumn,
        columnX: mock(() => 50),
        floatManager: makeFloatManager(),
      },
      {
        anchoredDrawings: [{ block: imageBlock, measure: { kind: 'image', width: 500, height: 1000 } }],
        anchoredTables: [],
        columnWidth: 600,
        pageWidth: 700,
        pageMargins: { top: 50, right: 50, bottom: 50, left: 50 },
        columns: { width: 600, gap: 0, count: 1 },
        placedAnchoredIds: new Set<string>(),
      },
    );

    expect(advanceColumn).not.toHaveBeenCalled();
  });
});

describe('layoutParagraphBlock - keepLines', () => {
  it('advances to next page when keepLines is true and paragraph does not fit', () => {
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'test-block',
      runs: [{ text: 'Test', fontFamily: 'Arial', fontSize: 12 }],
      attrs: {
        keepLines: true,
      },
    };

    // 3 lines of 50px each = 150px total height
    const measure = makeMeasure([
      { width: 100, lineHeight: 50, maxWidth: 200 },
      { width: 100, lineHeight: 50, maxWidth: 200 },
      { width: 100, lineHeight: 50, maxWidth: 200 },
    ]);

    const pageState = makePageState();
    // cursorY=50, contentBottom=750, so available = 700
    // But we'll set cursorY high so only 100px remains (not enough for 150px)
    pageState.cursorY = 650;
    pageState.page.fragments.push({ blockId: 'existing', kind: 'para' } as never);

    let currentState = pageState;
    const advanceColumn = mock((state: PageState) => {
      currentState = {
        ...state,
        cursorY: 50, // Reset to top of new page
        maxCursorY: 50,
        page: { number: state.page.number + 1, fragments: [] },
        trailingSpacing: 0,
      };
      return currentState;
    });

    const ctx: ParagraphLayoutContext = {
      block,
      measure,
      columnWidth: 200,
      ensurePage: mock(() => currentState),
      advanceColumn,
      columnX: mock(() => 50),
      floatManager: makeFloatManager(),
    };

    layoutParagraphBlock(ctx);

    // Should have advanced to next page because paragraph (150px) > remaining (100px)
    // but fits on blank page (150px < 700px)
    expect(advanceColumn).toHaveBeenCalled();
  });

  it('does not advance when keepLines is true but paragraph fits on current page', () => {
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'test-block',
      runs: [{ text: 'Test', fontFamily: 'Arial', fontSize: 12 }],
      attrs: {
        keepLines: true,
      },
    };

    // 3 lines of 50px each = 150px total height
    const measure = makeMeasure([
      { width: 100, lineHeight: 50, maxWidth: 200 },
      { width: 100, lineHeight: 50, maxWidth: 200 },
      { width: 100, lineHeight: 50, maxWidth: 200 },
    ]);

    const pageState = makePageState();
    // cursorY=50, contentBottom=750, available = 700px - enough for 150px
    pageState.page.fragments.push({ blockId: 'existing', kind: 'para' } as never);

    const advanceColumn = mock((state: PageState) => state);

    const ctx: ParagraphLayoutContext = {
      block,
      measure,
      columnWidth: 200,
      ensurePage: mock(() => pageState),
      advanceColumn,
      columnX: mock(() => 50),
      floatManager: makeFloatManager(),
    };

    layoutParagraphBlock(ctx);

    // Should NOT advance - paragraph fits
    expect(advanceColumn).not.toHaveBeenCalled();
  });

  it('does not pre-advance for keepLines when paragraph cannot fit on a blank page', () => {
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'test-block',
      runs: [{ text: 'Test', fontFamily: 'Arial', fontSize: 12 }],
      attrs: {
        keepLines: true,
      },
    };

    // 20 lines of 50px each = 1000px total height (exceeds page content area)
    const measure = makeMeasure(
      Array(20)
        .fill(null)
        .map(() => ({ width: 100, lineHeight: 50, maxWidth: 200 })),
    );

    const pageState = makePageState();
    // contentBottom - topMargin = 750 - 50 = 700px page content height
    // Paragraph is 1000px, won't fit on blank page
    pageState.cursorY = 650; // Only 100px remaining
    pageState.page.fragments.push({ blockId: 'existing', kind: 'para' } as never);

    let currentState = pageState;
    const advanceColumn = mock((state: PageState) => {
      currentState = {
        ...state,
        page: { number: state.page.number + 1, fragments: [] },
        cursorY: state.topMargin,
        trailingSpacing: 0,
      };
      return currentState;
    });

    const ctx: ParagraphLayoutContext = {
      block,
      measure,
      columnWidth: 200,
      ensurePage: mock(() => currentState),
      advanceColumn,
      columnX: mock(() => 50),
      floatManager: makeFloatManager(),
    };

    layoutParagraphBlock(ctx);

    // keepLines should not force an upfront move to the next page when the paragraph
    // cannot fit on a blank page anyway. The first fragment should still start on this page.
    const firstFragment = pageState.page.fragments.find(
      (fragment) => fragment.kind === 'para' && fragment.blockId === 'test-block',
    ) as { y: number } | undefined;
    expect(firstFragment).toBeTruthy();
    expect(firstFragment?.y).toBe(650);
    // The paragraph is still taller than the page, so normal pagination advances later.
    expect(advanceColumn).toHaveBeenCalled();
  });

  it('uses baseSpacingBefore (not collapsed) for blank page fit check', () => {
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'test-block',
      runs: [{ text: 'Test', fontFamily: 'Arial', fontSize: 12 }],
      attrs: {
        keepLines: true,
        spacing: { before: 50 }, // 50px spacing before
      },
    };

    // 3 lines of 200px each = 600px, plus 50px spacing = 650px
    // Page content is 700px, so it fits on blank page
    const measure = makeMeasure([
      { width: 100, lineHeight: 200, maxWidth: 200 },
      { width: 100, lineHeight: 200, maxWidth: 200 },
      { width: 100, lineHeight: 200, maxWidth: 200 },
    ]);

    const pageState = makePageState();
    // Current page has trailing spacing of 40px
    // Collapsed spacing = max(50-40, 0) = 10px (less space needed on current page)
    // But blank page needs full 50px spacing
    pageState.trailingSpacing = 40;
    pageState.cursorY = 100; // 650px remaining on current page
    pageState.page.fragments.push({ blockId: 'existing', kind: 'para' } as never);

    const advanceColumn = mock((state: PageState) => ({
      ...state,
      cursorY: 50,
      maxCursorY: 50,
      trailingSpacing: 0,
      page: { number: 2, fragments: [] },
    }));

    const ctx: ParagraphLayoutContext = {
      block,
      measure,
      columnWidth: 200,
      ensurePage: mock(() => pageState),
      advanceColumn,
      columnX: mock(() => 50),
      floatManager: makeFloatManager(),
    };

    layoutParagraphBlock(ctx);

    // Paragraph (600px) + collapsed spacing (10px) = 610px fits in 650px remaining
    // So it should NOT advance (it fits on current page)
    expect(advanceColumn).not.toHaveBeenCalled();
  });
});

describe('layoutParagraphBlock - widowControl', () => {
  const makeWidowContext = (attrs: ParagraphBlock['attrs'], cursorY: number) => {
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'widow-block',
      runs: [{ text: 'Four measured lines', fontFamily: 'Arial', fontSize: 12 }],
      attrs,
    };
    const measure = makeMeasure(Array.from({ length: 4 }, () => ({ width: 100, lineHeight: 20, maxWidth: 200 })));
    const firstPage = makePageState();
    firstPage.cursorY = cursorY;
    firstPage.page.fragments.push({ blockId: 'existing', kind: 'para' } as never);
    const secondPage: PageState = {
      ...makePageState(),
      page: { number: 2, fragments: [] },
      cursorY: 50,
      maxCursorY: 50,
      trailingSpacing: 0,
    };
    let currentState = firstPage;
    const advanceColumn = mock(() => {
      currentState = secondPage;
      return secondPage;
    });

    layoutParagraphBlock({
      block,
      measure,
      columnWidth: 200,
      ensurePage: mock(() => currentState),
      advanceColumn,
      columnX: mock(() => 50),
      floatManager: makeFloatManager(),
    });

    return { firstPage, secondPage, advanceColumn };
  };

  it('moves a single first line off the bottom of a populated page by default', () => {
    const { firstPage, secondPage, advanceColumn } = makeWidowContext({}, 730);

    expect(advanceColumn).toHaveBeenCalled();
    expect(firstPage.page.fragments.filter((fragment) => fragment.blockId === 'widow-block')).toHaveLength(0);
    expect(secondPage.page.fragments).toEqual(
      expect.arrayContaining([expect.objectContaining({ blockId: 'widow-block', fromLine: 0, toLine: 4 })]),
    );
  });

  it('allows a single first line when widowControl is explicitly disabled', () => {
    const { firstPage } = makeWidowContext({ widowControl: false }, 730);

    expect(firstPage.page.fragments).toEqual(
      expect.arrayContaining([expect.objectContaining({ blockId: 'widow-block', fromLine: 0, toLine: 1 })]),
    );
  });

  it('moves a preceding line forward instead of leaving one final line alone', () => {
    const { firstPage, secondPage } = makeWidowContext({}, 690);

    expect(firstPage.page.fragments).toEqual(
      expect.arrayContaining([expect.objectContaining({ blockId: 'widow-block', fromLine: 0, toLine: 2 })]),
    );
    expect(secondPage.page.fragments).toEqual(
      expect.arrayContaining([expect.objectContaining({ blockId: 'widow-block', fromLine: 2, toLine: 4 })]),
    );
  });
});

describe('SD-3049: footnote demand survives advanceColumn within one iteration', () => {
  it('charges the block demand onto the page advanceColumn lands on', () => {
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'block-x',
      runs: [{ text: 'Spilled block.', fontFamily: 'Arial', fontSize: 12 }],
    };
    // 3 lines that easily fit on the next page; the block only spills because
    // the starting cursor is near the page bottom on P.
    const measure = makeMeasure([
      { width: 100, lineHeight: 20, maxWidth: 200 },
      { width: 100, lineHeight: 20, maxWidth: 200 },
      { width: 100, lineHeight: 20, maxWidth: 200 },
    ]);

    // P starts near the bottom so the first break decision must advance.
    const pageP: PageState = {
      ...makePageState(),
      page: { number: 1, fragments: [] },
      cursorY: 600,
      contentBottom: 620,
    };

    // Mirror the paginator: a fresh page Q with demand reset to 0 and cursor
    // back at topMargin. Hold a reference so the test can read final state.
    const pageQ: PageState = {
      ...makePageState(),
      page: { number: 2, fragments: [] },
      cursorY: 50,
      contentBottom: 620,
    };

    const BLOCK_DEMAND = 100;

    layoutParagraphBlock({
      block,
      measure,
      columnWidth: 200,
      ensurePage: mock(() => pageP),
      advanceColumn: mock(() => pageQ),
      columnX: mock(() => 50),
      floatManager: makeFloatManager(),
      // Phase 1 (SD-2656): body uses ORDERED minimum from anchors, not the
      // legacy block-demand getter. Demand transfer on spill must still hold
      // — express it via anchors whose ordered-minimum equals BLOCK_DEMAND.
      getFootnoteAnchorsForBlockId: (blockId) =>
        blockId === 'block-x'
          ? [{ pmPos: 0, refId: 'r1', fullHeight: BLOCK_DEMAND, firstLineHeight: BLOCK_DEMAND }]
          : [],
    });

    expect(pageQ.footnoteDemandThisPage).toBe(BLOCK_DEMAND);
  });
});

describe('layoutParagraphBlock - measuredAtMaxWidth width-change gate', () => {
  const makeCtx = (
    block: ParagraphBlock,
    measure: ParagraphMeasure,
    columnWidth: number,
    remeasureParagraph: ParagraphLayoutContext['remeasureParagraph'],
  ): ParagraphLayoutContext => ({
    block,
    measure,
    columnWidth,
    ensurePage: mock(() => makePageState()),
    advanceColumn: mock((state) => state),
    columnX: mock(() => 50),
    floatManager: makeFloatManager(),
    remeasureParagraph,
  });

  it('does NOT remeasure a hanging-indent paragraph measured at the current column width', () => {
    // Regression shape from a multi-column loan agreement: column 672, indent
    // left 96, hanging 48. The FIRST line's available width (624) legitimately
    // exceeds the body width (576); the legacy lines[0].maxWidth heuristic
    // remeasured every such paragraph even though the constraint never changed.
    const remeasureParagraph = mock(() => makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 576 }]));
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'hanging-block',
      runs: [{ text: 'Test clause', fontFamily: 'Arial', fontSize: 12 }],
      attrs: { indent: { left: 96, hanging: 48 } },
    };
    const measure: ParagraphMeasure = {
      ...makeMeasure([
        { width: 500, lineHeight: 20, maxWidth: 624 }, // first line: body width + hanging
        { width: 480, lineHeight: 20, maxWidth: 576 }, // body lines
      ]),
      measuredAtMaxWidth: 672,
    };

    layoutParagraphBlock(makeCtx(block, measure, 672, remeasureParagraph));

    expect(remeasureParagraph).not.toHaveBeenCalled();
  });

  it('does NOT remeasure when the constraint delta is below the FP epsilon', () => {
    const remeasureParagraph = mock(() => makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 576 }]));
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'epsilon-block',
      runs: [{ text: 'Test', fontFamily: 'Arial', fontSize: 12 }],
      attrs: {},
    };
    const measure: ParagraphMeasure = {
      ...makeMeasure([{ width: 500, lineHeight: 20, maxWidth: 672.4 }]),
      measuredAtMaxWidth: 672.4,
    };

    layoutParagraphBlock(makeCtx(block, measure, 672, remeasureParagraph));

    expect(remeasureParagraph).not.toHaveBeenCalled();
  });

  it('remeasures a stamped measure when the column is genuinely narrower', () => {
    // Multi-column shape: measured single-column (672), placed in a 312px column.
    const remeasureParagraph = mock(() => makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 312 }]));
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'narrow-column-block',
      runs: [{ text: 'Test', fontFamily: 'Arial', fontSize: 12 }],
      attrs: { indent: { left: 96, hanging: 48 } },
    };
    const measure: ParagraphMeasure = {
      ...makeMeasure([{ width: 500, lineHeight: 20, maxWidth: 624 }]),
      measuredAtMaxWidth: 672,
    };

    layoutParagraphBlock(makeCtx(block, measure, 312, remeasureParagraph));

    expect(remeasureParagraph).toHaveBeenCalledWith(block, 312, 0);
  });

  it('falls back to the legacy first-line heuristic for unstamped measures', () => {
    // Producers that predate the measuredAtMaxWidth stamp keep today's behavior.
    const remeasureParagraph = mock(() => makeMeasure([{ width: 100, lineHeight: 20, maxWidth: 576 }]));
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'unstamped-block',
      runs: [{ text: 'Test', fontFamily: 'Arial', fontSize: 12 }],
      attrs: { indent: { left: 96, hanging: 48 } },
    };
    // No measuredAtMaxWidth: legacy predicate (624 > 672 - 96 = 576) fires.
    const measure = makeMeasure([{ width: 500, lineHeight: 20, maxWidth: 624 }]);

    layoutParagraphBlock(makeCtx(block, measure, 672, remeasureParagraph));

    expect(remeasureParagraph).toHaveBeenCalledWith(block, 672, 0);
  });
});
