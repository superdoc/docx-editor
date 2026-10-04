import { describe, expect, it } from 'bun:test';
import { layoutDrawingBlock } from './layout-drawing.js';
import type { DrawingBlock, DrawingMeasure, DrawingFragment, DrawingGeometry } from '@superdoc/contracts';
import type { DrawingLayoutContext } from './layout-drawing.js';
import type { NormalizedColumns } from './layout-image.js';
import type { PageState } from './paginator.js';

/**
 * Unit tests for layoutDrawingBlock function.
 *
 * Tests cover:
 * - Anchored drawings (early return)
 * - Basic inline placement at cursor position
 * - Width scaling when drawing exceeds column width
 * - Height scaling when drawing exceeds page content height
 * - Page overflow handling (advance column)
 * - Margin calculations (top, bottom, left, right)
 * - Negative margin guards (Math.max protection)
 * - Fragment creation with correct geometry and PM ranges
 */
describe('layoutDrawingBlock', () => {
  const mockColumns: NormalizedColumns = { width: 600, gap: 20, count: 1 };

  const createMockGeometry = (overrides: Partial<DrawingGeometry> = {}): DrawingGeometry => ({
    width: 200,
    height: 150,
    ...overrides,
  });

  const createMockDrawingBlock = (overrides: Partial<DrawingBlock> = {}): DrawingBlock => {
    const base = {
      kind: 'drawing' as const,
      id: 'test-drawing-1',
      drawingKind: 'vectorShape' as const,
      geometry: createMockGeometry(),
      attrs: {
        pmStart: 10,
        pmEnd: 11,
      },
    };
    return { ...base, ...overrides } as DrawingBlock;
  };

  const createMockMeasure = (overrides: Partial<DrawingMeasure> = {}): DrawingMeasure => ({
    kind: 'drawing',
    drawingKind: 'vectorShape',
    width: 200,
    height: 150,
    scale: 1.0,
    naturalWidth: 200,
    naturalHeight: 150,
    geometry: createMockGeometry(),
    ...overrides,
  });

  type MockPageState = {
    page: { fragments: DrawingFragment[] };
    columnIndex: number;
    cursorY: number;
    topMargin: number;
    contentBottom: number;
    constraintBoundaries: [];
    activeConstraintIndex: number;
    trailingSpacing: number;
    maxCursorY: number;
  };

  const createMockPageState = (overrides: Record<string, unknown> = {}): MockPageState =>
    ({
      page: {
        fragments: [] as DrawingFragment[],
      },
      columnIndex: 0,
      cursorY: 100,
      topMargin: 50,
      contentBottom: 750,
      constraintBoundaries: [],
      activeConstraintIndex: -1,
      trailingSpacing: 0,
      maxCursorY: 100,
      ...overrides,
    }) as MockPageState;

  const createMockContext = (
    blockOverrides: Partial<DrawingBlock> = {},
    measureOverrides: Partial<DrawingMeasure> = {},
    stateOverrides: Record<string, unknown> = {},
  ): DrawingLayoutContext => {
    const state = createMockPageState(stateOverrides);
    return {
      block: createMockDrawingBlock(blockOverrides),
      measure: createMockMeasure(measureOverrides),
      columns: mockColumns,
      ensurePage: () => state as unknown as PageState,
      advanceColumn: (currentState: PageState): PageState =>
        ({
          ...currentState,
          columnIndex: currentState.columnIndex + 1,
          cursorY: currentState.topMargin,
        }) as unknown as PageState,
      columnX: (state: PageState) => state.columnIndex * (mockColumns.width + mockColumns.gap),
    };
  };

  describe('Anchored drawings', () => {
    it('should skip layout for anchored drawings (early return)', () => {
      const context = createMockContext({
        anchor: {
          isAnchored: true,
          hRelativeFrom: 'column',
          vRelativeFrom: 'paragraph',
          alignH: 'left',
          offsetH: 0,
          offsetV: 0,
        },
      });

      const stateBefore = context.ensurePage();
      const fragmentCountBefore = stateBefore.page.fragments.length;

      layoutDrawingBlock(context);

      const stateAfter = context.ensurePage();
      expect(stateAfter.page.fragments.length).toBe(fragmentCountBefore);
      expect(stateAfter.cursorY).toBe(100); // Cursor should not move
    });

    it('should skip layout when anchor.isAnchored is true even with undefined other anchor properties', () => {
      const context = createMockContext({
        anchor: {
          isAnchored: true,
        },
      });

      context.ensurePage();
      layoutDrawingBlock(context);
      const stateAfter = context.ensurePage();

      expect(stateAfter.page.fragments.length).toBe(0);
    });
  });

  describe('Textbox content measures', () => {
    it('should attach textbox content measures to drawing fragments when provided', () => {
      const contentMeasures = [{ kind: 'paragraph', lines: [], totalHeight: 24 }];
      const context = {
        ...createMockContext({
          drawingKind: 'textboxShape',
        }),
        textboxContentMeasures: contentMeasures,
      };

      layoutDrawingBlock(context);

      const state = context.ensurePage();
      expect(state.page.fragments).toHaveLength(1);
      expect(state.page.fragments[0]?.kind).toBe('drawing');
      expect((state.page.fragments[0] as DrawingFragment).contentMeasures).toEqual(contentMeasures);
    });

    it('carries groupChildContentMeasures from the shape-group measure onto its fragment (SD-5244)', () => {
      const groupChildContentMeasures = {
        'tb-exhibit-a': [{ kind: 'paragraph', lines: [], totalHeight: 18 }],
        'tb-exhibit-b': [{ kind: 'paragraph', lines: [], totalHeight: 18 }],
      };
      const context = createMockContext(
        { drawingKind: 'shapeGroup' },
        { drawingKind: 'shapeGroup', groupChildContentMeasures },
      );

      layoutDrawingBlock(context);

      const state = context.ensurePage();
      expect(state.page.fragments).toHaveLength(1);
      expect((state.page.fragments[0] as DrawingFragment).groupChildContentMeasures).toEqual(groupChildContentMeasures);
    });

    it('does not attach groupChildContentMeasures for a non-shapeGroup drawing', () => {
      const context = createMockContext({ drawingKind: 'vectorShape' }, {
        drawingKind: 'vectorShape',
        groupChildContentMeasures: { 'tb-x': [] },
      } as Partial<DrawingMeasure>);

      layoutDrawingBlock(context);

      const state = context.ensurePage();
      expect((state.page.fragments[0] as DrawingFragment).groupChildContentMeasures).toBeUndefined();
    });
  });

  describe('Basic inline placement', () => {
    it('should place drawing at current cursor position with no margins', () => {
      const context = createMockContext();
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      expect(state.page.fragments.length).toBe(1);
      const fragment = state.page.fragments[0] as DrawingFragment;
      expect(fragment.kind).toBe('drawing');
      expect(fragment.x).toBe(0); // columnX(0) + marginLeft(0)
      expect(fragment.y).toBe(100); // cursorY(100) + marginTop(0)
      expect(fragment.width).toBe(200);
      expect(fragment.height).toBe(150);
    });

    it('should advance cursor by drawing height after placement', () => {
      const context = createMockContext();
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      expect(state.cursorY).toBe(250); // 100 + 0(marginTop) + 150(height) + 0(marginBottom)
    });

    it('should preserve geometry and scale from measure', () => {
      const geometry = createMockGeometry({ rotation: 45, flipH: true });
      const context = createMockContext({ geometry }, { geometry, scale: 2.5 });
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const fragment = state.page.fragments[0] as DrawingFragment;
      expect(fragment.geometry).toEqual(geometry);
      expect(fragment.scale).toBe(2.5);
    });

    it('should include drawingContentId and zIndex if present', () => {
      const context = createMockContext({
        drawingContentId: 'content-abc-123',
        zIndex: 42,
      });
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const fragment = state.page.fragments[0] as DrawingFragment;
      expect(fragment.drawingContentId).toBe('content-abc-123');
      expect(fragment.zIndex).toBe(42);
    });
  });

  describe('Width scaling', () => {
    it('should scale down drawing when width exceeds column width', () => {
      const context = createMockContext(
        {},
        { width: 800, height: 600 }, // 800 > 600 (column width)
      );
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const fragment = state.page.fragments[0] as DrawingFragment;
      const expectedScale = 600 / 800; // maxWidth / width
      expect(fragment.width).toBe(600); // Scaled to column width
      expect(fragment.height).toBe(600 * expectedScale); // Height scaled proportionally (450)
    });

    it('should scale drawing that is wider than column after accounting for margins', () => {
      const context = createMockContext(
        {
          margin: { left: 50, right: 50 },
        },
        { width: 600, height: 300 },
      );
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const maxWidth = 600 - 50 - 50; // 500
      const expectedScale = maxWidth / 600; // 500/600
      const fragment = state.page.fragments[0] as DrawingFragment;
      expect(fragment.width).toBe(maxWidth); // 500
      expect(fragment.height).toBe(300 * expectedScale); // 250
    });

    it('should not scale down if drawing width equals column width', () => {
      const context = createMockContext({}, { width: 600, height: 400 });
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const fragment = state.page.fragments[0] as DrawingFragment;
      expect(fragment.width).toBe(600);
      expect(fragment.height).toBe(400); // No scaling
    });

    it('should not scale up small drawings', () => {
      const context = createMockContext({}, { width: 100, height: 80 });
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const fragment = state.page.fragments[0] as DrawingFragment;
      expect(fragment.width).toBe(100); // Keep original size
      expect(fragment.height).toBe(80);
    });

    it('should handle zero maxWidth gracefully (no division by zero)', () => {
      const context = createMockContext(
        {
          margin: { left: 300, right: 300 }, // Sum equals column width
        },
        { width: 200, height: 150 },
      );
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const fragment = state.page.fragments[0] as DrawingFragment;
      // With maxWidth = 0, should not scale
      expect(fragment.width).toBe(200);
      expect(fragment.height).toBe(150);
    });
  });

  describe('Height scaling', () => {
    it('should scale down drawing when height exceeds page content height', () => {
      const context = createMockContext(
        {},
        { width: 400, height: 800 }, // height > contentHeight (700)
        { topMargin: 50, contentBottom: 750 }, // contentHeight = 750 - 50 = 700
      );
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const pageContentHeight = 750 - 50; // 700
      const expectedScale = pageContentHeight / 800; // 0.875
      const fragment = state.page.fragments[0] as DrawingFragment;
      expect(fragment.height).toBe(pageContentHeight); // 700
      expect(fragment.width).toBe(400 * expectedScale); // 350
    });

    it('should apply both width and height scaling when both are needed', () => {
      const context = createMockContext(
        {},
        { width: 800, height: 900 }, // Both exceed limits
        { topMargin: 50, contentBottom: 750 }, // contentHeight = 700
      );
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      // First: width scaling (800 -> 600)
      const widthScale = 600 / 800; // 0.75

      const _width = 600;

      const _height = 900 * widthScale; // 675

      // Second: height scaling (675 -> 700, but 675 < 700 so no height scaling needed)
      // Actually height after width scaling is 675, which is less than 700, so no additional scaling

      const fragment = state.page.fragments[0] as DrawingFragment;
      expect(fragment.width).toBe(600);
      expect(fragment.height).toBe(675);
    });

    it('should apply height scaling after width scaling', () => {
      const context = createMockContext(
        {},
        { width: 700, height: 900 },
        { topMargin: 50, contentBottom: 550 }, // contentHeight = 500
      );
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      // First: width scaling (700 > 600, scale to 600)
      const widthScale = 600 / 700;
      let _width = 600;
      let _height = 900 * widthScale; // ~771

      // Second: height scaling (771 > 500, scale to 500)
      const heightScale = 500 / _height;
      _height = 500;
      _width = _width * heightScale; // ~389

      const fragment = state.page.fragments[0] as DrawingFragment;
      expect(fragment.height).toBe(500);
      expect(fragment.width).toBeCloseTo(389, 0);
    });

    it('should handle zero content height gracefully', () => {
      const context = createMockContext(
        {},
        { width: 200, height: 300 },
        { topMargin: 400, contentBottom: 400 }, // contentHeight = 0
      );
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const fragment = state.page.fragments[0] as DrawingFragment;
      // With pageContentHeight = 0, should not scale
      expect(fragment.width).toBe(200);
      expect(fragment.height).toBe(300);
    });
  });

  describe('Page overflow and column advancement', () => {
    it('should advance column when drawing does not fit on current page', () => {
      const advanceColumnCalled: boolean[] = [];
      let stateRef = createMockPageState({ cursorY: 700, topMargin: 50, contentBottom: 750 });

      const context: DrawingLayoutContext = {
        block: createMockDrawingBlock(),
        measure: createMockMeasure({ width: 200, height: 200 }),
        columns: mockColumns,
        ensurePage: () => stateRef as unknown as PageState,
        advanceColumn: (state: PageState): PageState => {
          advanceColumnCalled.push(true);
          stateRef = {
            ...stateRef,
            columnIndex: stateRef.columnIndex + 1,
            cursorY: stateRef.topMargin,
          };
          return stateRef as unknown as PageState;
        },
        columnX: (state: PageState) => state.columnIndex * (mockColumns.width + mockColumns.gap),
      };

      layoutDrawingBlock(context);

      expect(advanceColumnCalled.length).toBe(1);
      expect(stateRef.columnIndex).toBe(1);
      expect(stateRef.cursorY).toBe(50 + 200); // Reset to topMargin + drawing height
    });

    it('should not advance column when drawing fits on current page', () => {
      const advanceColumnCalled: boolean[] = [];
      const context = createMockContext(
        {},
        { width: 200, height: 100 },
        { cursorY: 100, topMargin: 50, contentBottom: 750 },
      );

      context.advanceColumn = (state: PageState): PageState => {
        advanceColumnCalled.push(true);
        return state;
      };

      const state = context.ensurePage();
      layoutDrawingBlock(context);

      expect(advanceColumnCalled.length).toBe(0);
      expect(state.columnIndex).toBe(0);
    });

    it('should not advance column when cursor is already at top margin', () => {
      const advanceColumnCalled: boolean[] = [];
      const context = createMockContext(
        {},
        { width: 200, height: 800 }, // Larger than page
        { cursorY: 50, topMargin: 50, contentBottom: 750 },
      );

      context.advanceColumn = (state: PageState): PageState => {
        advanceColumnCalled.push(true);
        return state;
      };

      layoutDrawingBlock(context);

      expect(advanceColumnCalled.length).toBe(0);
    });

    it('should include margins in overflow calculation', () => {
      const advanceColumnCalled: boolean[] = [];
      const context = createMockContext(
        {
          margin: { top: 30, bottom: 20 },
        },
        { width: 200, height: 100 },
        { cursorY: 680, topMargin: 50, contentBottom: 750 },
      );

      context.advanceColumn = (state: PageState): PageState => {
        advanceColumnCalled.push(true);
        return {
          ...state,
          columnIndex: 1,
          cursorY: state.topMargin,
        } as PageState;
      };

      context.ensurePage();
      layoutDrawingBlock(context);

      // Required height = 30 + 100 + 20 = 150
      // cursorY(680) + 150 = 830 > contentBottom(750)
      expect(advanceColumnCalled.length).toBe(1);
    });
  });

  describe('Margin calculations', () => {
    it('should apply top margin to Y position', () => {
      const context = createMockContext({
        margin: { top: 25 },
      });
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const fragment = state.page.fragments[0] as DrawingFragment;
      expect(fragment.y).toBe(125); // cursorY(100) + marginTop(25)
    });

    it('should apply bottom margin to cursor advancement', () => {
      const context = createMockContext(
        {
          margin: { bottom: 30 },
        },
        { width: 200, height: 100 },
      );
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      expect(state.cursorY).toBe(230); // 100 + 0(top) + 100(height) + 30(bottom)
    });

    it('should apply left margin to X position', () => {
      const context = createMockContext({
        margin: { left: 40 },
      });
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const fragment = state.page.fragments[0] as DrawingFragment;
      expect(fragment.x).toBe(40); // columnX(0) + marginLeft(40)
    });

    it('should apply right margin to width calculation', () => {
      const context = createMockContext(
        {
          margin: { right: 100 },
        },
        { width: 550, height: 200 },
      );
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const maxWidth = 600 - 0 - 100; // 500
      const expectedScale = maxWidth / 550;
      const fragment = state.page.fragments[0] as DrawingFragment;
      expect(fragment.width).toBe(maxWidth);
      expect(fragment.height).toBe(200 * expectedScale);
    });

    it('should apply all margins correctly', () => {
      const context = createMockContext(
        {
          margin: { top: 10, bottom: 20, left: 30, right: 40 },
        },
        { width: 200, height: 100 },
      );
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const fragment = state.page.fragments[0] as DrawingFragment;
      expect(fragment.x).toBe(30); // columnX(0) + marginLeft(30)
      expect(fragment.y).toBe(110); // cursorY(100) + marginTop(10)
      expect(state.cursorY).toBe(230); // 100 + 10 + 100 + 20
    });
  });

  describe('Negative margin guards', () => {
    it('should clamp negative top margin to zero', () => {
      const context = createMockContext({
        margin: { top: -50 },
      });
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const fragment = state.page.fragments[0] as DrawingFragment;
      expect(fragment.y).toBe(100); // cursorY(100) + Math.max(0, -50) = 100
    });

    it('should clamp negative bottom margin to zero', () => {
      const context = createMockContext(
        {
          margin: { bottom: -30 },
        },
        { width: 200, height: 100 },
      );
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      expect(state.cursorY).toBe(200); // 100 + 0 + 100 + Math.max(0, -30)
    });

    it('should clamp negative left margin to zero', () => {
      const context = createMockContext({
        margin: { left: -40 },
      });
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const fragment = state.page.fragments[0] as DrawingFragment;
      expect(fragment.x).toBe(0); // columnX(0) + Math.max(0, -40)
    });

    it('should clamp negative right margin to zero', () => {
      const context = createMockContext(
        {
          margin: { right: -100 },
        },
        { width: 650, height: 200 },
      );
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const maxWidth = 600 - 0 - 0; // Negative margin clamped to 0
      const expectedScale = maxWidth / 650;
      const fragment = state.page.fragments[0] as DrawingFragment;
      expect(fragment.width).toBe(maxWidth);
      expect(fragment.height).toBe(200 * expectedScale);
    });

    it('should handle all margins being negative', () => {
      const context = createMockContext(
        {
          margin: { top: -10, bottom: -20, left: -30, right: -40 },
        },
        { width: 200, height: 100 },
      );
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const fragment = state.page.fragments[0] as DrawingFragment;
      expect(fragment.x).toBe(0);
      expect(fragment.y).toBe(100);
      expect(fragment.width).toBe(200); // No scaling needed
      expect(state.cursorY).toBe(200); // 100 + 0 + 100 + 0
    });
  });

  describe('Fragment creation', () => {
    it('should create fragment with correct blockId and drawingKind', () => {
      const context = createMockContext({
        id: 'drawing-block-789',
        drawingKind: 'shapeGroup',
      });
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const fragment = state.page.fragments[0] as DrawingFragment;
      expect(fragment.blockId).toBe('drawing-block-789');
      expect(fragment.drawingKind).toBe('shapeGroup');
    });

    it('should extract pmStart and pmEnd from block attrs', () => {
      const context = createMockContext({
        attrs: {
          pmStart: 42,
          pmEnd: 43,
        },
      });
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const fragment = state.page.fragments[0] as DrawingFragment;
      expect(fragment.pmStart).toBe(42);
      expect(fragment.pmEnd).toBe(43);
    });

    it('should default pmEnd to pmStart + 1 when pmEnd is missing', () => {
      const context = createMockContext({
        attrs: {
          pmStart: 100,
        },
      });
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const fragment = state.page.fragments[0] as DrawingFragment;
      expect(fragment.pmStart).toBe(100);
      expect(fragment.pmEnd).toBe(101); // pmStart + 1
    });

    it('should handle missing attrs (pmStart and pmEnd undefined)', () => {
      const context = createMockContext({
        attrs: undefined,
      });
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const fragment = state.page.fragments[0] as DrawingFragment;
      expect(fragment.pmStart).toBeUndefined();
      expect(fragment.pmEnd).toBeUndefined();
    });

    it('should handle attrs with non-number pmStart', () => {
      const context = createMockContext({
        attrs: {
          pmStart: 'invalid' as unknown as number,
          pmEnd: 50,
        },
      });
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const fragment = state.page.fragments[0] as DrawingFragment;
      expect(fragment.pmStart).toBeUndefined();
      // pmEnd is a valid number (50), so it should be preserved
      expect(fragment.pmEnd).toBe(50);
    });

    it('should push fragment to page fragments array', () => {
      const context = createMockContext();
      const state = context.ensurePage();
      expect(state.page.fragments.length).toBe(0);

      layoutDrawingBlock(context);

      expect(state.page.fragments.length).toBe(1);
    });

    it('should use correct columnX for multi-column layout', () => {
      const context = createMockContext({}, {}, { columnIndex: 2 });
      context.columnX = (state: PageState) => state.columnIndex * 620; // width(600) + gap(20)

      const state = context.ensurePage();
      layoutDrawingBlock(context);

      const fragment = state.page.fragments[0] as DrawingFragment;
      expect(fragment.x).toBe(1240); // columnX(2) = 2 * 620
    });
  });

  describe('Edge cases', () => {
    it('should handle drawing with zero width', () => {
      const context = createMockContext({}, { width: 0, height: 100 });
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const fragment = state.page.fragments[0] as DrawingFragment;
      expect(fragment.width).toBe(0);
      expect(fragment.height).toBe(100);
    });

    it('should handle drawing with zero height', () => {
      const context = createMockContext({}, { width: 200, height: 0 });
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const fragment = state.page.fragments[0] as DrawingFragment;
      expect(fragment.width).toBe(200);
      expect(fragment.height).toBe(0);
      expect(state.cursorY).toBe(100); // Cursor should not move
    });

    it('should handle drawing with both zero dimensions', () => {
      const context = createMockContext({}, { width: 0, height: 0 });
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const fragment = state.page.fragments[0] as DrawingFragment;
      expect(fragment.width).toBe(0);
      expect(fragment.height).toBe(0);
    });

    it('should handle undefined margin object', () => {
      const context = createMockContext({
        margin: undefined,
      });
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const fragment = state.page.fragments[0] as DrawingFragment;
      expect(fragment.x).toBe(0);
      expect(fragment.y).toBe(100);
      expect(state.cursorY).toBe(250); // 100 + 0 + 150 + 0
    });

    it('should handle partial margin object', () => {
      const context = createMockContext({
        margin: { left: 10 }, // Only left defined
      });
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const fragment = state.page.fragments[0] as DrawingFragment;
      expect(fragment.x).toBe(10);
      expect(fragment.y).toBe(100); // No top margin
    });

    it('should handle very large drawing dimensions', () => {
      const context = createMockContext({}, { width: 10000, height: 8000 }, { topMargin: 50, contentBottom: 750 });
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const fragment = state.page.fragments[0] as DrawingFragment;
      // Should scale to fit both width (600) and height (700) constraints
      expect(fragment.width).toBeLessThanOrEqual(600);
      expect(fragment.height).toBeLessThanOrEqual(700);
    });

    it('should handle fractional dimensions after scaling', () => {
      const context = createMockContext({}, { width: 700, height: 333 });
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const expectedScale = 600 / 700;
      const fragment = state.page.fragments[0] as DrawingFragment;
      expect(fragment.width).toBe(600);
      expect(fragment.height).toBeCloseTo(333 * expectedScale, 10); // Allow floating point precision
    });

    it('should center inline shapeGroup drawings using paragraph alignment metadata', () => {
      const context = createMockContext(
        {
          drawingKind: 'shapeGroup',
          attrs: {
            pmStart: 10,
            pmEnd: 11,
            wrap: { type: 'Inline' },
            inlineParagraphAlignment: 'center',
          },
        },
        { width: 200, height: 150 },
      );
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const fragment = state.page.fragments[0] as DrawingFragment;
      expect(fragment.x).toBe(200);
    });

    it('should right-align inline shapeGroup drawings using paragraph alignment metadata', () => {
      const context = createMockContext(
        {
          drawingKind: 'shapeGroup',
          attrs: {
            pmStart: 10,
            pmEnd: 11,
            wrap: { type: 'Inline' },
            inlineParagraphAlignment: 'right',
          },
        },
        { width: 200, height: 150 },
      );
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const fragment = state.page.fragments[0] as DrawingFragment;
      expect(fragment.x).toBe(400);
    });

    it('should not apply paragraph alignment metadata when shapeGroup is not inline', () => {
      const context = createMockContext(
        {
          drawingKind: 'shapeGroup',
          attrs: {
            pmStart: 10,
            pmEnd: 11,
            wrap: { type: 'Square' },
            inlineParagraphAlignment: 'center',
          },
        },
        { width: 200, height: 150 },
      );
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const fragment = state.page.fragments[0] as DrawingFragment;
      expect(fragment.x).toBe(0);
    });

    it('should center within indented text box when paragraph has left indent', () => {
      const context = createMockContext(
        {
          drawingKind: 'shapeGroup',
          attrs: {
            pmStart: 10,
            pmEnd: 11,
            wrap: { type: 'Inline' },
            inlineParagraphAlignment: 'center',
            paragraphIndentLeft: 48,
          },
        },
        { width: 200, height: 150 },
      );
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const fragment = state.page.fragments[0] as DrawingFragment;
      // alignBox = 600 - 48 = 552, extra = 552 - 200 = 352, x = 0 + 48 + 176 = 224
      expect(fragment.x).toBe(224);
    });

    it('should center within indented text box when paragraph has left and right indent', () => {
      const context = createMockContext(
        {
          drawingKind: 'shapeGroup',
          attrs: {
            pmStart: 10,
            pmEnd: 11,
            wrap: { type: 'Inline' },
            inlineParagraphAlignment: 'center',
            paragraphIndentLeft: 48,
            paragraphIndentRight: 48,
          },
        },
        { width: 200, height: 150 },
      );
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const fragment = state.page.fragments[0] as DrawingFragment;
      // alignBox = 600 - 48 - 48 = 504, extra = 504 - 200 = 304, x = 0 + 48 + 152 = 200
      expect(fragment.x).toBe(200);
    });

    it('should right-align within indented text box when paragraph has left indent', () => {
      const context = createMockContext(
        {
          drawingKind: 'shapeGroup',
          attrs: {
            pmStart: 10,
            pmEnd: 11,
            wrap: { type: 'Inline' },
            inlineParagraphAlignment: 'right',
            paragraphIndentLeft: 96,
          },
        },
        { width: 200, height: 150 },
      );
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const fragment = state.page.fragments[0] as DrawingFragment;
      // alignBox = 600 - 96 = 504, extra = 504 - 200 = 304, x = 0 + 96 + 304 = 400
      expect(fragment.x).toBe(400);
    });

    it('should place a left-aligned inline shapeGroup at the paragraph left indent', () => {
      const context = createMockContext(
        {
          drawingKind: 'shapeGroup',
          attrs: {
            pmStart: 10,
            pmEnd: 11,
            wrap: { type: 'Inline' },
            paragraphIndentLeft: 96,
            paragraphIndentRight: 24,
          },
        },
        { width: 400, height: 150 },
      );
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const fragment = state.page.fragments[0] as DrawingFragment;
      expect(fragment.x).toBe(96);
      expect(fragment.width).toBe(400);
    });

    it('should scale an inline shapeGroup to the indented paragraph width', () => {
      const context = createMockContext(
        {
          drawingKind: 'shapeGroup',
          attrs: {
            pmStart: 10,
            pmEnd: 11,
            wrap: { type: 'Inline' },
            paragraphIndentLeft: 96,
            paragraphIndentRight: 24,
          },
        },
        { width: 600, height: 300 },
      );
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const fragment = state.page.fragments[0] as DrawingFragment;
      expect(fragment.x).toBe(96);
      expect(fragment.width).toBe(480);
      expect(fragment.height).toBe(240);
    });

    it('should not offset when alignment is left or justify', () => {
      for (const alignment of ['left', 'justify'] as const) {
        const context = createMockContext(
          {
            drawingKind: 'shapeGroup',
            attrs: {
              pmStart: 10,
              pmEnd: 11,
              wrap: { type: 'Inline' },
              inlineParagraphAlignment: alignment,
            },
          },
          { width: 200, height: 150 },
        );
        const state = context.ensurePage();

        layoutDrawingBlock(context);

        const fragment = state.page.fragments[0] as DrawingFragment;
        expect(fragment.x).toBe(0);
      }
    });

    it('should not offset non-shapeGroup drawings even with inline wrap and alignment', () => {
      for (const drawingKind of ['image', 'vectorShape', 'chart'] as const) {
        const context = createMockContext(
          {
            drawingKind,
            attrs: {
              pmStart: 10,
              pmEnd: 11,
              wrap: { type: 'Inline' },
              inlineParagraphAlignment: 'center',
            },
          },
          { width: 200, height: 150 },
        );
        const state = context.ensurePage();

        layoutDrawingBlock(context);

        const fragment = state.page.fragments[0] as DrawingFragment;
        expect(fragment.x).toBe(0);
      }
    });

    it('should not offset shapeGroup when wrap is undefined', () => {
      const context = createMockContext(
        {
          drawingKind: 'shapeGroup',
          attrs: {
            pmStart: 10,
            pmEnd: 11,
            inlineParagraphAlignment: 'center',
          },
        },
        { width: 200, height: 150 },
      );
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const fragment = state.page.fragments[0] as DrawingFragment;
      expect(fragment.x).toBe(0);
    });

    it('should not offset shapeGroup when wrap has no type', () => {
      const context = createMockContext(
        {
          drawingKind: 'shapeGroup',
          attrs: {
            pmStart: 10,
            pmEnd: 11,
            wrap: {},
            inlineParagraphAlignment: 'center',
          },
        },
        { width: 200, height: 150 },
      );
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const fragment = state.page.fragments[0] as DrawingFragment;
      expect(fragment.x).toBe(0);
    });

    it('should not shift oversized centered shapeGroup after width scaling', () => {
      const context = createMockContext(
        {
          drawingKind: 'shapeGroup',
          attrs: {
            pmStart: 10,
            pmEnd: 11,
            wrap: { type: 'Inline' },
            inlineParagraphAlignment: 'center',
          },
        },
        { width: 800, height: 600 },
      );
      const state = context.ensurePage();

      layoutDrawingBlock(context);

      const fragment = state.page.fragments[0] as DrawingFragment;
      // Scaled to maxWidthForBlock (600), no slack left, x = 0
      expect(fragment.width).toBe(600);
      expect(fragment.x).toBe(0);
    });
  });
});
