/**
 * Column Balancing Tests
 *
 * Tests for Word-compatible column balancing algorithm.
 */

import { describe, it, expect } from 'bun:test';
import {
  calculateBalancedColumnHeight,
  shouldBalanceColumns,
  shouldSkipBalancing,
  DEFAULT_BALANCING_CONFIG,
  type BalancingContext,
  type BalancingBlock,
  type ColumnBalancingConfig,
} from './column-balancing.js';

// Helper to create a mock balancing block
function createBlock(id: string, height: number, options: Partial<BalancingBlock> = {}): BalancingBlock {
  return {
    blockId: id,
    measuredHeight: height,
    canBreak: true,
    keepWithNext: false,
    keepTogether: false,
    ...options,
  };
}

// Helper to create a mock balancing context
function createContext(
  columnCount: number,
  blocks: BalancingBlock[],
  options: Partial<BalancingContext> = {},
): BalancingContext {
  return {
    columnCount,
    columnWidth: 200,
    columnGap: 20,
    availableHeight: 1000,
    contentBlocks: blocks,
    ...options,
  };
}

describe('calculateBalancedColumnHeight', () => {
  describe('basic balancing', () => {
    it('should distribute content evenly across 2 columns', () => {
      const blocks = [
        createBlock('block-1', 100),
        createBlock('block-2', 100),
        createBlock('block-3', 100),
        createBlock('block-4', 100),
      ];
      const ctx = createContext(2, blocks);

      const result = calculateBalancedColumnHeight(ctx, DEFAULT_BALANCING_CONFIG);

      expect(result.success).toBe(true);
      // Total height = 400, target should be around 200 per column
      expect(result.targetColumnHeight).toBeGreaterThanOrEqual(190);
      expect(result.targetColumnHeight).toBeLessThanOrEqual(210);

      // Check assignments - should split evenly
      const col0Blocks = [...result.columnAssignments.entries()].filter(([, col]) => col === 0);
      const col1Blocks = [...result.columnAssignments.entries()].filter(([, col]) => col === 1);
      expect(col0Blocks.length + col1Blocks.length).toBe(4);
    });

    it('should distribute content across 3 columns', () => {
      const blocks = [
        createBlock('block-1', 100),
        createBlock('block-2', 100),
        createBlock('block-3', 100),
        createBlock('block-4', 100),
        createBlock('block-5', 100),
        createBlock('block-6', 100),
      ];
      const ctx = createContext(3, blocks);

      const result = calculateBalancedColumnHeight(ctx, DEFAULT_BALANCING_CONFIG);

      expect(result.success).toBe(true);
      // Total height = 600, target should be around 200 per column
      expect(result.targetColumnHeight).toBeGreaterThanOrEqual(190);
      expect(result.targetColumnHeight).toBeLessThanOrEqual(210);
    });

    it('should handle uneven block distribution', () => {
      const blocks = [
        createBlock('block-1', 150),
        createBlock('block-2', 50),
        createBlock('block-3', 100),
        createBlock('block-4', 100),
      ];
      const ctx = createContext(2, blocks);

      const result = calculateBalancedColumnHeight(ctx, DEFAULT_BALANCING_CONFIG);

      // All blocks should be assigned
      expect(result.columnAssignments.size).toBe(4);
    });
  });

  describe('single column handling', () => {
    it('should assign all blocks to column 0 for single column layout', () => {
      const blocks = [createBlock('block-1', 100), createBlock('block-2', 100)];
      const ctx = createContext(1, blocks);

      const result = calculateBalancedColumnHeight(ctx, DEFAULT_BALANCING_CONFIG);

      expect(result.success).toBe(true);
      expect(result.columnAssignments.get('block-1')).toBe(0);
      expect(result.columnAssignments.get('block-2')).toBe(0);
    });
  });

  describe('empty content handling', () => {
    it('should handle empty block list', () => {
      const ctx = createContext(2, []);

      const result = calculateBalancedColumnHeight(ctx, DEFAULT_BALANCING_CONFIG);

      expect(result.success).toBe(true);
      expect(result.columnAssignments.size).toBe(0);
      expect(result.iterations).toBe(0);
    });
  });

  describe('keepWithNext constraint', () => {
    it('should respect keepWithNext constraint', () => {
      const blocks = [
        createBlock('block-1', 100),
        createBlock('block-2', 100, { keepWithNext: true }),
        createBlock('block-3', 100),
        createBlock('block-4', 100),
      ];
      const ctx = createContext(2, blocks);

      const result = calculateBalancedColumnHeight(ctx, DEFAULT_BALANCING_CONFIG);

      // block-2 should be in the same column as block-3 (or earlier)
      const block2Col = result.columnAssignments.get('block-2');
      const block3Col = result.columnAssignments.get('block-3');
      // Note: keepWithNext means block-2 should stay with block-3
      // The algorithm should try to keep them together
      expect(block2Col).toBeDefined();
      expect(block3Col).toBeDefined();
    });
  });

  describe('unbreakable blocks', () => {
    it('should handle unbreakable blocks gracefully', () => {
      const blocks = [
        createBlock('block-1', 500, { canBreak: false, keepTogether: true }),
        createBlock('block-2', 100),
      ];
      const ctx = createContext(2, blocks, { availableHeight: 600 });

      const result = calculateBalancedColumnHeight(ctx, DEFAULT_BALANCING_CONFIG);

      // Should still produce a result
      expect(result.columnAssignments.size).toBe(2);
    });

    it('should handle large unbreakable block that exceeds column height', () => {
      const blocks = [
        createBlock('block-1', 800, { canBreak: false, keepTogether: true }),
        createBlock('block-2', 100),
      ];
      const ctx = createContext(2, blocks, { availableHeight: 500 });

      const result = calculateBalancedColumnHeight(ctx, DEFAULT_BALANCING_CONFIG);

      // Should handle gracefully even if balancing isn't perfect
      expect(result.columnAssignments.size).toBe(2);
    });
  });

  describe('paragraph line breaking', () => {
    it('should consider line heights for paragraph breaking', () => {
      const blocks = [
        createBlock('block-1', 100, {
          canBreak: true,
          lineHeights: [20, 20, 20, 20, 20], // 5 lines of 20px each
        }),
        createBlock('block-2', 100),
        createBlock('block-3', 100),
      ];
      const ctx = createContext(2, blocks, { availableHeight: 200 });

      const result = calculateBalancedColumnHeight(ctx, DEFAULT_BALANCING_CONFIG);

      // Should produce a result
      expect(result.columnAssignments.size).toBeGreaterThan(0);
    });
  });

  describe('iteration limit', () => {
    it('should respect maxIterations limit', () => {
      const blocks = Array.from({ length: 20 }, (_, i) => createBlock(`block-${i}`, 10 + (i % 5) * 10));
      const ctx = createContext(3, blocks);
      const config: ColumnBalancingConfig = {
        ...DEFAULT_BALANCING_CONFIG,
        maxIterations: 5,
      };

      const result = calculateBalancedColumnHeight(ctx, config);

      expect(result.iterations).toBeLessThanOrEqual(5);
    });
  });
});

describe('shouldBalanceColumns', () => {
  it('should return true for continuous sections', () => {
    expect(shouldBalanceColumns('continuous', undefined, false)).toBe(true);
  });

  it('should return true for last section', () => {
    expect(shouldBalanceColumns('nextPage', undefined, true)).toBe(true);
  });

  it('should return false for nextPage sections that are not last', () => {
    expect(shouldBalanceColumns('nextPage', undefined, false)).toBe(false);
  });

  it('should respect explicit balanceColumns=true', () => {
    expect(shouldBalanceColumns('nextPage', true, false)).toBe(true);
  });

  it('should respect explicit balanceColumns=false', () => {
    expect(shouldBalanceColumns('continuous', false, true)).toBe(false);
  });
});

describe('shouldSkipBalancing', () => {
  it('should skip when disabled', () => {
    const ctx = createContext(2, [createBlock('block-1', 100)]);
    const config = { ...DEFAULT_BALANCING_CONFIG, enabled: false };

    expect(shouldSkipBalancing(ctx, config)).toBe(true);
  });

  it('should skip for single column', () => {
    const ctx = createContext(1, [createBlock('block-1', 100)]);

    expect(shouldSkipBalancing(ctx, DEFAULT_BALANCING_CONFIG)).toBe(true);
  });

  it('should skip for empty content', () => {
    const ctx = createContext(2, []);

    expect(shouldSkipBalancing(ctx, DEFAULT_BALANCING_CONFIG)).toBe(true);
  });

  it('should skip for single unbreakable block', () => {
    // Single block that can't break - can't distribute a single atomic block
    const ctx = createContext(2, [createBlock('block-1', 100, { canBreak: false })]);

    expect(shouldSkipBalancing(ctx, DEFAULT_BALANCING_CONFIG)).toBe(true);
  });

  it('should NOT skip for single breakable block that overflows', () => {
    // Single paragraph that CAN be split across columns AND overflows available height
    const ctx = createContext(2, [createBlock('block-1', 100, { canBreak: true })], {
      availableHeight: 50, // Block overflows single column
    });

    expect(shouldSkipBalancing(ctx, DEFAULT_BALANCING_CONFIG)).toBe(false);
  });

  it('should skip for content smaller than minColumnHeight', () => {
    // Content (15px) is less than minColumnHeight (20px)
    const ctx = createContext(2, [createBlock('block-1', 7), createBlock('block-2', 8)], {
      availableHeight: 1000,
    });

    expect(shouldSkipBalancing(ctx, DEFAULT_BALANCING_CONFIG)).toBe(true);
  });

  it('should skip when balanced height per column would be too small', () => {
    // 30px total / 2 columns = 15px per column, less than minColumnHeight (20px)
    const ctx = createContext(2, [createBlock('block-1', 15), createBlock('block-2', 15)], {
      availableHeight: 1000,
    });

    expect(shouldSkipBalancing(ctx, DEFAULT_BALANCING_CONFIG)).toBe(true);
  });

  it('should NOT skip when content height clears the minimum thresholds', () => {
    // 100px total / 2 columns = 50px per column, which is above minColumnHeight (20px).
    const ctx = createContext(2, [createBlock('block-1', 50), createBlock('block-2', 50)]);

    expect(shouldSkipBalancing(ctx, DEFAULT_BALANCING_CONFIG)).toBe(false);
  });
});

describe('DEFAULT_BALANCING_CONFIG', () => {
  it('should have reasonable default values', () => {
    expect(DEFAULT_BALANCING_CONFIG.enabled).toBe(true);
    expect(DEFAULT_BALANCING_CONFIG.tolerance).toBeGreaterThan(0);
    expect(DEFAULT_BALANCING_CONFIG.maxIterations).toBeGreaterThan(0);
    expect(DEFAULT_BALANCING_CONFIG.minColumnHeight).toBeGreaterThan(0);
  });
});

// ============================================================================
// balanceSectionOnPage Tests (Section-scoped balancing)
// ============================================================================

import { balanceSectionOnPage } from './column-balancing.js';

/**
 * Helper to create measure data for paragraph fragments.
 */
function createMeasure(kind: string, lineHeights: number[]): { kind: string; lines: Array<{ lineHeight: number }> } {
  return {
    kind,
    lines: lineHeights.map((h) => ({ lineHeight: h })),
  };
}

describe('balanceSectionOnPage', () => {
  type TestFragment = {
    blockId: string;
    x: number;
    y: number;
    width: number;
    kind: string;
    height?: number;
    columnIndex?: number;
  };

  /** Build a fragment + section mapping for section-scoped tests. */
  function buildSectionFixture(
    sectionIndex: number,
    count: number,
    height = 20,
    startY = 96,
  ): {
    fragments: TestFragment[];
    measureMap: Map<string, { kind: string; lines: Array<{ lineHeight: number }> }>;
    blockSectionMap: Map<string, number>;
  } {
    const fragments: TestFragment[] = [];
    const measureMap = new Map<string, { kind: string; lines: Array<{ lineHeight: number }> }>();
    const blockSectionMap = new Map<string, number>();
    for (let i = 0; i < count; i++) {
      const id = `s${sectionIndex}-b${i}`;
      fragments.push({ blockId: id, x: 96, y: startY + i * height, width: 624, kind: 'para' });
      measureMap.set(id, createMeasure('paragraph', [height]));
      blockSectionMap.set(id, sectionIndex);
    }
    return { fragments, measureMap, blockSectionMap };
  }

  it('keeps an RTL section right-to-left on the balanced page', () => {
    // Balancing REBUILDS the geometry and then overwrites every fragment's x from it, so a dropped
    // direction does not fail loudly: the last page of a two-column Hebrew section would simply be
    // laid out left-to-right while every earlier page of the same section was right-to-left.
    const top = 96;
    const { fragments, measureMap, blockSectionMap } = buildSectionFixture(2, 6, 20, top);

    const result = balanceSectionOnPage({
      fragments,
      sectionIndex: 2,
      sectionColumns: { count: 2, gap: 48, width: 288, direction: 'rtl', contentWidth: 624 },
      sectionHasExplicitColumnBreak: false,
      blockSectionMap,
      margins: { left: 96 },
      topMargin: top,
      columnWidth: 288,
      availableHeight: 60,
      measureMap,
    });

    expect(result).not.toBeNull();
    // The FIRST three paragraphs land in the RIGHT column (x = left margin + 288 + 48), the last
    // three in the left one — the mirror image of the LTR case above.
    expect(fragments.slice(0, 3).map((f) => f.x)).toEqual([432, 432, 432]);
    expect(fragments.slice(3).map((f) => f.x)).toEqual([96, 96, 96]);
  });

  it('reads an already-columnised RTL page in document order, not left to right', () => {
    // Balancing re-derives document order from the fragments' current positions, because the
    // paginator fills column 0 top-to-bottom before moving on. In an RTL section column 0 is the
    // RIGHT one, so document order DESCENDS in x; ordering the page left-to-right would feed the
    // balancer the trailing column first and scramble the reading order of the balanced page.
    const top = 96;
    const RIGHT = 432; // left margin 96 + column width 288 + gap 48
    const LEFT = 96;
    // Paragraphs 0-3 were laid out in the right column, 4-5 spilled into the left one.
    const placements: Array<{ x: number; y: number }> = [
      { x: RIGHT, y: top },
      { x: RIGHT, y: top + 20 },
      { x: RIGHT, y: top + 40 },
      { x: RIGHT, y: top + 60 },
      { x: LEFT, y: top },
      { x: LEFT, y: top + 20 },
    ];
    const fragments: TestFragment[] = [];
    const measureMap = new Map<string, { kind: string; lines: Array<{ lineHeight: number }> }>();
    const blockSectionMap = new Map<string, number>();
    placements.forEach((placement, i) => {
      const id = `s2-b${i}`;
      fragments.push({ blockId: id, x: placement.x, y: placement.y, width: 288, kind: 'para' });
      measureMap.set(id, createMeasure('paragraph', [20]));
      blockSectionMap.set(id, 2);
    });

    const result = balanceSectionOnPage({
      fragments,
      sectionIndex: 2,
      sectionColumns: { count: 2, gap: 48, width: 288, direction: 'rtl', contentWidth: 624 },
      sectionHasExplicitColumnBreak: false,
      blockSectionMap,
      margins: { left: 96 },
      topMargin: top,
      columnWidth: 288,
      availableHeight: 60,
      measureMap,
    });

    expect(result).not.toBeNull();
    // 3+3 balance, still in document order: 0-2 in the right column, 3-5 in the left one.
    expect(fragments.map((f) => f.x)).toEqual([RIGHT, RIGHT, RIGHT, LEFT, LEFT, LEFT]);
    expect(fragments.map((f) => f.y)).toEqual([top, top + 20, top + 40, top, top + 20, top + 40]);
  });

  it('keeps vertically ordered RTL fragments together when their x positions differ within a column', () => {
    const top = 96;
    const right = 432;
    const left = 96;
    const placements: Array<{ x: number; y: number }> = [
      { x: right, y: top },
      { x: right + 68, y: top + 20 },
      { x: left, y: top },
      { x: left, y: top + 20 },
    ];
    const fragments: TestFragment[] = [];
    const measureMap = new Map<string, { kind: string; lines: Array<{ lineHeight: number }> }>();
    const blockSectionMap = new Map<string, number>();
    placements.forEach((placement, i) => {
      const id = `s2-b${i}`;
      fragments.push({ blockId: id, x: placement.x, y: placement.y, width: 288, kind: 'para' });
      measureMap.set(id, createMeasure('paragraph', [20]));
      blockSectionMap.set(id, 2);
    });

    const result = balanceSectionOnPage({
      fragments,
      sectionIndex: 2,
      sectionColumns: { count: 2, gap: 48, width: 288, direction: 'rtl', contentWidth: 624 },
      sectionHasExplicitColumnBreak: false,
      blockSectionMap,
      margins: { left: 96 },
      topMargin: top,
      columnWidth: 288,
      availableHeight: 40,
      measureMap,
    });

    expect(result).not.toBeNull();
    expect(fragments.map((fragment) => fragment.x)).toEqual([right, right, left, left]);
    expect(fragments.map((fragment) => fragment.y)).toEqual([top, top + 20, top, top + 20]);
  });

  it('balances the target section and returns the tallest balanced column bottom', () => {
    // 6 equal paragraphs in a 2-col section → 3+3 balanced, tallest col ends at top + 3×20 = top + 60.
    const top = 96;
    const { fragments, measureMap, blockSectionMap } = buildSectionFixture(2, 6, 20, top);

    const result = balanceSectionOnPage({
      fragments,
      sectionIndex: 2,
      sectionColumns: { count: 2, gap: 48, width: 288 },
      sectionHasExplicitColumnBreak: false,
      blockSectionMap,
      margins: { left: 96 },
      topMargin: top,
      columnWidth: 288,
      availableHeight: 60,
      measureMap,
    });

    // Returned maxY is the bottom of the tallest balanced column.
    expect(result).not.toBeNull();
    expect(result!.maxY).toBe(top + 60);

    // Observable outcome: fragments split evenly across two columns.
    const col0 = fragments.filter((f) => f.x === 96).length;
    const col1 = fragments.filter((f) => f.x === 96 + 288 + 48).length;
    expect(col0).toBe(3);
    expect(col1).toBe(3);
  });

  it('updates recorded column ownership when balancing moves a table', () => {
    const top = 96;
    const fragments: TestFragment[] = [
      { blockId: 'paragraph', x: 96, y: top, width: 288, kind: 'para', columnIndex: 0 },
      { blockId: 'table', x: 96, y: top + 20, width: 288, height: 20, kind: 'table', columnIndex: 0 },
    ];
    const measureMap = new Map([['paragraph', createMeasure('paragraph', [20])]]);
    const blockSectionMap = new Map([
      ['paragraph', 2],
      ['table', 2],
    ]);

    const result = balanceSectionOnPage({
      fragments,
      sectionIndex: 2,
      sectionColumns: { count: 2, gap: 48, width: 288 },
      sectionHasExplicitColumnBreak: false,
      blockSectionMap,
      margins: { left: 96 },
      topMargin: top,
      columnWidth: 288,
      availableHeight: 40,
      measureMap,
    });

    expect(result).not.toBeNull();
    expect(fragments[0]).toMatchObject({ x: 96, columnIndex: 0 });
    expect(fragments[1]).toMatchObject({ x: 432, columnIndex: 1 });
  });

  it('balances equal-width columns with non-uniform gaps using per-column geometry (SD-2629 F9)', () => {
    // The headline SD-2629 case: equal column WIDTHS (so the equal-width guard admits balancing) but
    // NON-UNIFORM gaps [0, 48]. Column x must follow the resolved per-column geometry, not a uniform
    // stride. With 6 paragraphs across 3 columns (2 each): col1 sits at margin(96) + width(192) +
    // gaps[0]=0 = 288 (a uniform scalar gap of 24 would wrongly place it at 312); col2 at
    // 96 + 192 + 0 + 192 + gaps[1]=48 = 528.
    const top = 96;
    const { fragments, measureMap, blockSectionMap } = buildSectionFixture(2, 6, 20, top);

    const result = balanceSectionOnPage({
      fragments,
      sectionIndex: 2,
      sectionColumns: { count: 3, gap: 24, width: 192, widths: [192, 192, 192], gaps: [0, 48], equalWidth: false },
      sectionHasExplicitColumnBreak: false,
      blockSectionMap,
      margins: { left: 96 },
      topMargin: top,
      columnWidth: 192,
      availableHeight: 40,
      measureMap,
    });

    expect(result).not.toBeNull();
    const xs = [...new Set(fragments.map((f) => f.x))].sort((a, b) => a - b);
    expect(xs).toEqual([96, 288, 528]);
    // col1 is at the per-column position 288, never the uniform-stride 312.
    expect(fragments.filter((f) => f.x === 288).length).toBe(2);
    expect(fragments.filter((f) => f.x === 312).length).toBe(0);
  });

  it('returns null and leaves fragments untouched when section has <= 1 column', () => {
    const { fragments, measureMap, blockSectionMap } = buildSectionFixture(2, 3);
    const snapshot = fragments.map((f) => ({ x: f.x, y: f.y }));

    const result = balanceSectionOnPage({
      fragments,
      sectionIndex: 2,
      sectionColumns: { count: 1, gap: 0, width: 624 },
      sectionHasExplicitColumnBreak: false,
      blockSectionMap,
      margins: { left: 96 },
      topMargin: 96,
      columnWidth: 624,
      availableHeight: 720,
      measureMap,
    });

    expect(result).toBeNull();
    fragments.forEach((f, i) => {
      expect(f.x).toBe(snapshot[i].x);
      expect(f.y).toBe(snapshot[i].y);
    });
  });

  it('returns null when section contains an explicit column break', () => {
    // Author-placed column breaks override balancing — preserve their intent.
    const { fragments, measureMap, blockSectionMap } = buildSectionFixture(2, 6);
    const snapshot = fragments.map((f) => f.x);

    const result = balanceSectionOnPage({
      fragments,
      sectionIndex: 2,
      sectionColumns: { count: 2, gap: 48, width: 288 },
      sectionHasExplicitColumnBreak: true,
      blockSectionMap,
      margins: { left: 96 },
      topMargin: 96,
      columnWidth: 288,
      availableHeight: 720,
      measureMap,
    });

    expect(result).toBeNull();
    fragments.forEach((f, i) => expect(f.x).toBe(snapshot[i]));
  });

  it('returns null when section has unequal explicit column widths', () => {
    const { fragments, measureMap, blockSectionMap } = buildSectionFixture(2, 4);

    const result = balanceSectionOnPage({
      fragments,
      sectionIndex: 2,
      sectionColumns: { count: 2, gap: 48, width: 288, equalWidth: false, widths: [200, 376] },
      sectionHasExplicitColumnBreak: false,
      blockSectionMap,
      margins: { left: 96 },
      topMargin: 96,
      columnWidth: 288,
      availableHeight: 720,
      measureMap,
    });

    expect(result).toBeNull();
  });

  it('balances explicit columns that declare EQUAL widths (equalWidth=0 with equal w:col widths)', () => {
    // SD-2324: continuous newspaper sections commonly use `<w:cols w:num="N" w:equalWidth="0">`
    // with explicit `<w:col w:w>` children that are all EQUAL (e.g. 4×2340). The unequal-width
    // skip must NOT catch these — they balance like implicit equal columns. Genuinely-unequal
    // widths (the test above, [200,376]) are still skipped.
    const top = 96;
    const { fragments, measureMap, blockSectionMap } = buildSectionFixture(2, 6, 20, top);

    const result = balanceSectionOnPage({
      fragments,
      sectionIndex: 2,
      sectionColumns: { count: 2, gap: 48, width: 288, equalWidth: false, widths: [288, 288] },
      sectionHasExplicitColumnBreak: false,
      blockSectionMap,
      margins: { left: 96 },
      topMargin: top,
      columnWidth: 288,
      availableHeight: 60,
      measureMap,
    });

    expect(result).not.toBeNull();
    expect(result!.maxY).toBe(top + 60);
    const col0 = fragments.filter((f) => f.x === 96).length;
    const col1 = fragments.filter((f) => f.x === 96 + 288 + 48).length;
    expect(col0).toBe(3);
    expect(col1).toBe(3);
  });

  it('only moves fragments of the target section when the page has mixed sections', () => {
    // Page has 3 fragments in section 1 (already positioned in col 0) and 6 in section 2.
    // Balancing section 2 must not touch section 1 fragments.
    const sec1 = buildSectionFixture(1, 3, 20, 96);
    const sec2 = buildSectionFixture(2, 6, 20, 160);
    const fragments = [...sec1.fragments, ...sec2.fragments];
    const measureMap = new Map([...sec1.measureMap, ...sec2.measureMap]);
    const blockSectionMap = new Map([...sec1.blockSectionMap, ...sec2.blockSectionMap]);
    const sec1Snapshot = sec1.fragments.map((f) => ({ id: f.blockId, x: f.x, y: f.y }));

    const result = balanceSectionOnPage({
      fragments,
      sectionIndex: 2,
      sectionColumns: { count: 2, gap: 48, width: 288 },
      sectionHasExplicitColumnBreak: false,
      blockSectionMap,
      margins: { left: 96 },
      topMargin: 160,
      columnWidth: 288,
      availableHeight: 60,
      measureMap,
    });

    expect(result).not.toBeNull();

    // Section 1 fragments unchanged.
    for (const s of sec1Snapshot) {
      const f = fragments.find((x) => x.blockId === s.id)!;
      expect(f.x).toBe(s.x);
      expect(f.y).toBe(s.y);
    }

    // Section 2 fragments now split across two columns.
    const sec2Xs = new Set(sec2.fragments.map((f) => f.x));
    expect(sec2Xs.size).toBe(2);
  });

  it('returns null when no fragments on the page belong to the target section', () => {
    const { fragments, measureMap, blockSectionMap } = buildSectionFixture(1, 3);

    const result = balanceSectionOnPage({
      fragments,
      sectionIndex: 99, // different section
      sectionColumns: { count: 2, gap: 48, width: 288 },
      sectionHasExplicitColumnBreak: false,
      blockSectionMap,
      margins: { left: 96 },
      topMargin: 96,
      columnWidth: 288,
      availableHeight: 720,
      measureMap,
    });

    expect(result).toBeNull();
  });

  // SD-3359: Word balances a continuous multi-column section by flowing content
  // line-by-line — a paragraph that straddles the column boundary SPLITS at a line
  // boundary (the IT-1150 complaint). Atomic per-fragment assignment leaves the
  // columns lumpy whenever one fragment is large relative to the section.
  describe('paragraph line splitting across columns (SD-3359)', () => {
    type SplitFragment = TestFragment & {
      fromLine?: number;
      toLine?: number;
      continuesFromPrev?: boolean;
      continuesOnNext?: boolean;
    };
    const LINE = 20;
    const TOP = 96;
    const COL1_X = 96 + 288 + 48;

    /** A (5 lines) + B (3 lines) + C (14 lines): atomic best is 160 | 280 (120px lumpy);
     * line-balanced is 220 | 220 with C split across the boundary. */
    function straddleFixture(cLines = 14): {
      fragments: SplitFragment[];
      measureMap: Map<string, { kind: string; lines: Array<{ lineHeight: number }> }>;
      blockSectionMap: Map<string, number>;
    } {
      const mk = (id: string, y: number): SplitFragment => ({
        blockId: id,
        x: 96,
        y,
        width: 624,
        kind: 'para',
      });
      const fragments = [mk('A', TOP), mk('B', TOP + 100), mk('C', TOP + 160)];
      const measureMap = new Map<string, { kind: string; lines: Array<{ lineHeight: number }> }>([
        ['A', createMeasure('paragraph', Array(5).fill(LINE))],
        ['B', createMeasure('paragraph', Array(3).fill(LINE))],
        ['C', createMeasure('paragraph', Array(cLines).fill(LINE))],
      ]);
      const blockSectionMap = new Map<string, number>([
        ['A', 1],
        ['B', 1],
        ['C', 1],
      ]);
      return { fragments, measureMap, blockSectionMap };
    }

    const balance = (
      fragments: SplitFragment[],
      measureMap: Map<string, { kind: string; lines: Array<{ lineHeight: number }> }>,
      blockSectionMap: Map<string, number>,
      extra: Record<string, unknown> = {},
    ) =>
      balanceSectionOnPage({
        fragments,
        sectionIndex: 1,
        sectionColumns: { count: 2, gap: 48, width: 288 },
        sectionHasExplicitColumnBreak: false,
        blockSectionMap,
        margins: { left: 96 },
        topMargin: TOP,
        columnWidth: 288,
        availableHeight: 720,
        measureMap,
        ...extra,
      });

    it('splits a straddling paragraph at a line boundary so columns balance', () => {
      const { fragments, measureMap, blockSectionMap } = straddleFixture();
      fragments[2].columnIndex = 0;

      const result = balance(fragments, measureMap, blockSectionMap);

      expect(result).not.toBeNull();
      // C was split into two fragments.
      const cFrags = fragments.filter((f) => f.blockId === 'C') as SplitFragment[];
      expect(cFrags.length).toBe(2);
      const [c1, c2] = cFrags.sort((a, b) => (a.fromLine ?? 0) - (b.fromLine ?? 0));
      // The halves partition C's lines contiguously.
      expect(c1.toLine).toBe(c2.fromLine!);
      expect(c2.toLine).toBe(14);
      // First half continues in col 0 below A+B; second half tops col 1.
      expect(c1.x).toBe(96);
      expect(c2.x).toBe(COL1_X);
      expect(c1.columnIndex).toBe(0);
      expect(c2.columnIndex).toBe(1);
      expect(c2.y).toBe(TOP);
      expect(c1.continuesOnNext).toBe(true);
      expect(c2.continuesFromPrev).toBe(true);
      // Column bottoms balance within one line height (vs 120px atomic lumpiness).
      const bottom = (f: SplitFragment): number => {
        const from = f.fromLine ?? 0;
        const to = f.toLine ?? measureMap.get(f.blockId)!.lines.length;
        return f.y + (to - from) * LINE;
      };
      const col0Bottom = Math.max(...fragments.filter((f) => f.x === 96).map(bottom));
      const col1Bottom = Math.max(...fragments.filter((f) => f.x === COL1_X).map(bottom));
      expect(Math.abs(col0Bottom - col1Bottom)).toBeLessThanOrEqual(LINE);
      // The balanced bottom beats the atomic assignment (TOP + 280).
      expect(result!.maxY).toBeLessThan(TOP + 280);
      expect(result!.maxY).toBe(Math.max(col0Bottom, col1Bottom));
    });

    it('does not split a paragraph with keepLines (author intent wins)', () => {
      const { fragments, measureMap, blockSectionMap } = straddleFixture();

      const result = balance(fragments, measureMap, blockSectionMap, {
        keepLinesBlockIds: new Set(['C']),
      });

      expect(result).not.toBeNull();
      // C stays whole — no extra fragment, no partial line range.
      expect(fragments.filter((f) => f.blockId === 'C').length).toBe(1);
      const c = fragments.find((f) => f.blockId === 'C')! as SplitFragment;
      expect(c.fromLine ?? 0).toBe(0);
      expect(c.toLine ?? 14).toBe(14);
    });

    it('balances a single tall paragraph alone in the section by splitting it', () => {
      const { fragments, measureMap, blockSectionMap } = straddleFixture();
      const only = [{ ...fragments[2], y: TOP }]; // C alone (14 lines = 280px)

      const result = balance(only, measureMap, blockSectionMap);

      // Previously skipped (single atomic block can't distribute); a breakable
      // paragraph CAN balance — Word splits it across the columns.
      expect(result).not.toBeNull();
      expect(only.length).toBe(2);
      const [c1, c2] = (only as SplitFragment[]).sort((a, b) => (a.fromLine ?? 0) - (b.fromLine ?? 0));
      expect(c1.toLine).toBe(c2.fromLine!);
      expect(c2.toLine).toBe(14);
      expect(result!.maxY).toBeLessThan(TOP + 280);
    });

    it('slices remeasured fragment.lines across the split (no duplicated halves)', () => {
      // A fragment remeasured for a narrower column carries its own `lines`, and
      // resolveParagraph renders that array INSTEAD of measure.lines[fromLine..toLine].
      // The split must slice `lines` for each half, or both columns render the whole
      // paragraph. The remeasured heights (22px) also differ from the stale measure
      // (20px), so the break point and cursors must come from the remeasured lines.
      const { fragments, measureMap, blockSectionMap } = straddleFixture();
      const REMEASURED = 22;
      const c = fragments[2] as SplitFragment & { lines?: Array<{ lineHeight: number }> };
      c.lines = Array.from({ length: 14 }, () => ({ lineHeight: REMEASURED }));

      const result = balance(fragments, measureMap, blockSectionMap);

      expect(result).not.toBeNull();
      const cFrags = (
        fragments.filter((f) => f.blockId === 'C') as Array<SplitFragment & { lines?: Array<{ lineHeight: number }> }>
      ).sort((a, b) => (a.fromLine ?? 0) - (b.fromLine ?? 0));
      expect(cFrags.length).toBe(2);
      const [c1, c2] = cFrags;
      // Each half carries ONLY its own remeasured lines, partitioning the original 14.
      expect(c1.lines).toBeDefined();
      expect(c2.lines).toBeDefined();
      expect(c1.lines!.length + c2.lines!.length).toBe(14);
      expect(c1.lines!.length).toBe((c1.toLine ?? 0) - (c1.fromLine ?? 0));
      expect(c2.lines!.length).toBe(c2.toLine! - c2.fromLine!);
      // Cursors advanced by the remeasured heights: the second column's bottom is
      // its line count at 22px, not at the stale 20px measure.
      const col1Frags = fragments.filter((f) => f.x === COL1_X) as Array<
        SplitFragment & { lines?: Array<{ lineHeight: number }> }
      >;
      const col1Bottom = Math.max(
        ...col1Frags.map((f) => f.y + (f.lines ? f.lines.reduce((s, l) => s + l.lineHeight, 0) : 0)),
      );
      expect(col1Bottom).toBe(result!.maxY);
    });

    it('offsets the split by the fragment fromLine when pagination already split the paragraph', () => {
      const { fragments, measureMap, blockSectionMap } = straddleFixture();
      // C is the tail of a 16-line paragraph: this page renders lines [2, 16).
      measureMap.set('C', createMeasure('paragraph', Array(16).fill(LINE)));
      const c = fragments[2];
      c.fromLine = 2;
      c.toLine = 16;

      const result = balance(fragments, measureMap, blockSectionMap);

      expect(result).not.toBeNull();
      const cFrags = (fragments.filter((f) => f.blockId === 'C') as SplitFragment[]).sort(
        (a, b) => (a.fromLine ?? 0) - (b.fromLine ?? 0),
      );
      expect(cFrags.length).toBe(2);
      const [c1, c2] = cFrags;
      expect(c1.fromLine).toBe(2);
      expect(c1.toLine).toBe(c2.fromLine!);
      expect(c2.toLine).toBe(16);
      expect(c2.fromLine!).toBeGreaterThan(2);
    });
  });
});
