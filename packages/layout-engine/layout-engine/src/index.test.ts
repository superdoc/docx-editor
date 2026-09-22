import { describe, expect, it, mock } from 'bun:test';
import type {
  FlowBlock,
  Layout,
  Measure,
  Line,
  ParagraphMeasure,
  ListItemFragment,
  ImageBlock,
  ImageMeasure,
  ImageFragment,
  ParaFragment,
  DrawingFragment,
  DrawingMeasure,
  SectionBreakBlock,
  ColumnBreakBlock,
  PageBreakBlock,
  TableBlock,
  TableFragment,
  TableMeasure,
} from '@superdoc/contracts';
import { layoutDocument, layoutHeaderFooter, type LayoutOptions } from './index.js';

const makeLine = (lineHeight: number): Line => ({
  fromRun: 0,
  fromChar: 0,
  toRun: 0,
  toChar: 0,
  width: 100,
  ascent: lineHeight * 0.8,
  descent: lineHeight * 0.2,
  lineHeight,
});

const makeMeasure = (heights: number[]): ParagraphMeasure => ({
  kind: 'paragraph',
  lines: heights.map(makeLine),
  totalHeight: heights.reduce((sum, h) => sum + h, 0),
});

const makeTableBlock = (
  id: string,
  rowCount: number,
  options?: { anchor?: TableBlock['anchor']; wrap?: TableBlock['wrap'] },
): TableBlock => {
  const rows = Array.from({ length: rowCount }, (_, rowIndex) => ({
    id: `${id}-row-${rowIndex}`,
    cells: [
      {
        id: `${id}-cell-${rowIndex}-0`,
        paragraph: {
          kind: 'paragraph' as const,
          id: `${id}-cell-${rowIndex}-p0`,
          runs: [],
        },
      },
    ],
  }));

  return {
    kind: 'table',
    id,
    rows,
    anchor: options?.anchor,
    wrap: options?.wrap,
  };
};

const makeTableMeasure = (columnWidths: number[], rowHeights: number[]): TableMeasure => ({
  kind: 'table',
  rows: rowHeights.map((height) => ({
    height,
    cells: columnWidths.map((width) => ({
      paragraph: makeMeasure([height]),
      width,
      height,
    })),
  })),
  columnWidths,
  totalWidth: columnWidths.reduce((sum, width) => sum + width, 0),
  totalHeight: rowHeights.reduce((sum, height) => sum + height, 0),
});

const makeParagraphlessFloatingTable = (id: string): TableBlock =>
  makeTableBlock(id, 1, {
    anchor: {
      isAnchored: true,
      hRelativeFrom: 'page',
      vRelativeFrom: 'paragraph',
      offsetH: 120,
      offsetV: 15,
    },
    wrap: {
      type: 'Square',
      wrapText: 'bothSides',
    },
  });

const block: FlowBlock = {
  kind: 'paragraph',
  id: 'block-1',
  runs: [
    {
      text: 'Hello',
      fontFamily: 'Arial',
      fontSize: 16,
      pmStart: 1,
      pmEnd: 6,
    },
  ],
};

const DEFAULT_OPTIONS: LayoutOptions = {
  pageSize: { w: 600, h: 800 },
  margins: { top: 50, right: 50, bottom: 50, left: 50 },
};

it('offers a deterministic pagination input failure only to its exact block owner', () => {
  const options = { ...DEFAULT_OPTIONS };
  const owner = mock(
    (input: { blockIds: readonly string[]; debugDetail: unknown; phase: string; progress?: unknown }) => {
      expect(input.blockIds).toEqual(['block-1']);
      expect(input.debugDetail).toBeInstanceOf(Error);
      expect(input.phase).toBe('input');
      expect(input.progress).toBeUndefined();
      return new Error('owned-pagination-failure');
    },
  );
  Object.defineProperty(options, Symbol.for('superdoc.v2.render-diagnostic.pagination-owner'), {
    configurable: true,
    value: owner,
  });

  expect(() => layoutDocument([block], [{ kind: 'pageBreak' }], options)).toThrow('owned-pagination-failure');
  expect(owner).toHaveBeenCalledTimes(1);
});

it('offers a supported table dispatch failure only to its exact block owner', () => {
  const options = { ...DEFAULT_OPTIONS };
  const owner = mock((input: { blockIds: readonly string[]; debugDetail: unknown }) => {
    expect(input.blockIds).toEqual(['owned-table']);
    expect(input.debugDetail).toBeInstanceOf(Error);
    expect((input.debugDetail as Error).message).toContain('table-dispatch-fault');
    return new Error('owned-table-pagination-failure');
  });
  Object.defineProperty(options, Symbol.for('superdoc.v2.render-diagnostic.pagination-owner'), {
    configurable: true,
    value: owner,
  });

  const faultedMeasure = makeTableMeasure([100], [20]);
  Object.defineProperty(faultedMeasure, 'rows', {
    configurable: true,
    get() {
      throw new Error('table-dispatch-fault');
    },
  });
  expect(() => layoutDocument([makeTableBlock('owned-table', 1)], [faultedMeasure], options)).toThrow(
    'owned-table-pagination-failure',
  );
  expect(owner).toHaveBeenCalledTimes(1);
});

it('offers a late paragraph pagination failure only to its active block owner', () => {
  const options = { ...DEFAULT_OPTIONS };
  const owner = mock(
    (input: {
      blockIds: readonly string[];
      debugDetail: unknown;
      phase: string;
      progress?: {
        blocks: FlowBlock[];
        measures: Measure[];
        layout: Layout;
        failedBlockId: string;
        sourcePageRange: { firstPage: number; lastPage: number };
      };
    }) => {
      expect(input.blockIds).toEqual(['late-paragraph']);
      expect((input.debugDetail as Error).message).toContain('late-pagination-fault');
      expect(input.phase).toBe('dispatch');
      expect(input.progress).toMatchObject({
        failedBlockId: 'late-paragraph',
        sourcePageRange: { firstPage: 0, lastPage: 0 },
      });
      expect(input.progress?.blocks.map((entry) => entry.id)).toEqual(['late-paragraph']);
      expect(input.progress?.measures).toHaveLength(1);
      expect(input.progress?.layout.pages).toHaveLength(1);
      expect(input.progress?.layout.pages[0]?.fragments).toEqual([]);
      expect(
        (input.progress?.layout as Layout & Record<PropertyKey, unknown>)[
          Symbol.for('superdoc.v2.render-diagnostic.pagination-prefix')
        ],
      ).toEqual({ blockId: 'late-paragraph', pageIndex: 0 });
      return new Error('owned-late-pagination-failure');
    },
  );
  Object.defineProperty(options, Symbol.for('superdoc.v2.render-diagnostic.pagination-owner'), {
    configurable: true,
    value: owner,
  });
  const measure = makeMeasure([20]);
  Object.defineProperty(measure, 'lines', {
    configurable: true,
    get() {
      throw new Error('late-pagination-fault');
    },
  });

  expect(() => layoutDocument([{ ...block, id: 'late-paragraph' }], [measure], options)).toThrow(
    'owned-late-pagination-failure',
  );
  expect(owner).toHaveBeenCalledTimes(1);
});

it('does not offer the page-boundary early-stop sentinel to a block owner', () => {
  const owner = mock(() => new Error('must-not-own-pagination-early-stop'));
  const options = {
    ...DEFAULT_OPTIONS,
    pageBoundary: { shouldStopBeforeNewPage: () => true },
  };
  Object.defineProperty(options, Symbol.for('superdoc.v2.render-diagnostic.pagination-owner'), {
    configurable: true,
    value: owner,
  });

  const layout = layoutDocument(
    [
      { ...block, id: 'first-page-paragraph' },
      { ...block, id: 'second-page-paragraph' },
    ],
    [makeMeasure([600]), makeMeasure([600])],
    options,
  );

  expect(layout.pages).toHaveLength(1);
  expect(owner).not.toHaveBeenCalled();
});

it('preserves the exact pagination owner through header/footer layout', () => {
  const constraints = { width: 400, height: 80 };
  const owner = mock((input: { blockIds: readonly string[]; debugDetail: unknown }) => {
    expect(input.blockIds).toEqual(['owned-header-table']);
    expect((input.debugDetail as Error).message).toContain('header-table-dispatch-fault');
    return new Error('owned-header-pagination-failure');
  });
  Object.defineProperty(constraints, Symbol.for('superdoc.v2.render-diagnostic.pagination-owner'), {
    configurable: true,
    value: owner,
  });
  const faultedMeasure = makeTableMeasure([100], [20]);
  Object.defineProperty(faultedMeasure, 'rows', {
    configurable: true,
    get() {
      throw new Error('header-table-dispatch-fault');
    },
  });

  expect(() =>
    layoutHeaderFooter([makeTableBlock('owned-header-table', 1)], [faultedMeasure], constraints, 'header'),
  ).toThrow('owned-header-pagination-failure');
  expect(owner).toHaveBeenCalledTimes(1);
});

/**
 * Helper to check if a page contains a block with the given ID.
 */
const pageContainsBlock = (page: { fragments: Array<{ blockId: string }> }, blockId: string): boolean => {
  return page.fragments.some((f) => f.blockId === blockId);
};

/**
 * Helper to assert that a page contains expected block IDs.
 */
const _expectPageContainsBlocks = (page: { fragments: Array<{ blockId: string }> }, blockIds: string[]): void => {
  blockIds.forEach((blockId) => {
    expect(page.fragments.some((f) => f.blockId === blockId)).toBe(true);
  });
};

describe('layoutDocument', () => {
  it('places a single block on a single page', () => {
    const layout = layoutDocument([block], [makeMeasure([20, 20])], DEFAULT_OPTIONS);

    expect(layout.pages).toHaveLength(1);
    const [firstPage] = layout.pages;
    expect(firstPage.fragments).toHaveLength(1);
    const fragment = firstPage.fragments[0];
    expect(fragment).toMatchObject({
      blockId: 'block-1',
      fromLine: 0,
      toLine: 2,
      x: 50,
      y: 50,
      width: 500,
    });
  });

  it('splits large blocks across multiple pages with continuation flags', () => {
    const options: LayoutOptions = {
      pageSize: { w: 400, h: 240 },
      margins: { top: 30, right: 30, bottom: 30, left: 30 },
    };
    const layout = layoutDocument([block], [makeMeasure([90, 90, 90])], options);

    expect(layout.pages).toHaveLength(2);
    expect(layout.pages[0].fragments).toHaveLength(1);
    expect(layout.pages[1].fragments).toHaveLength(1);

    const firstFragment = layout.pages[0].fragments[0];
    const secondFragment = layout.pages[1].fragments[0];

    expect(firstFragment).toMatchObject({
      fromLine: 0,
      toLine: 2,
      continuesOnNext: true,
    });
    expect(secondFragment).toMatchObject({
      fromLine: 2,
      toLine: 3,
      continuesFromPrev: true,
    });
    expect(secondFragment.y).toBe(options.margins?.top);
  });

  it('flows multiple blocks sequentially and creates additional pages as needed', () => {
    const blocks: FlowBlock[] = [
      { kind: 'paragraph', id: 'block-1', runs: [] },
      { kind: 'paragraph', id: 'block-2', runs: [] },
      { kind: 'paragraph', id: 'block-3', runs: [] },
    ];
    const measures = [makeMeasure([60, 60]), makeMeasure([40]), makeMeasure([90, 90, 40])];

    const layout = layoutDocument(blocks, measures, {
      pageSize: { w: 500, h: 300 },
      margins: { top: 40, right: 40, bottom: 40, left: 40 },
    });

    expect(layout.pages.length).toBeGreaterThan(1);
    expect(layout.pages[0].fragments[0].blockId).toBe('block-1');
    expect(layout.pages.at(-1)?.fragments.at(-1)?.blockId).toBe('block-3');
  });

  it('throws when blocks and measures length mismatch', () => {
    expect(() => layoutDocument([block], [], DEFAULT_OPTIONS)).toThrow(/expected measures/);
  });

  it('throws when margins consume all horizontal or vertical space', () => {
    expect(() =>
      layoutDocument([block], [makeMeasure([10])], {
        pageSize: { w: 100, h: 100 },
        margins: { top: 60, bottom: 60, left: 60, right: 60 },
      }),
    ).toThrow(/non-positive content area/);
  });

  it('clamps header-inflated margins so oversized header content does not crash body layout', () => {
    const layout = layoutDocument([block], [makeMeasure([1])], {
      pageSize: { w: 720, h: 540 },
      margins: { top: 60, right: 60, bottom: 56, left: 60, header: 48, footer: 56 },
      sectionMetadata: [{ sectionIndex: 0, headerRefs: { default: 'rId4' } }],
      headerContentHeightsByRId: new Map([['rId4', 568]]),
    });

    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0].margins.top).toBeCloseTo(483);
    expect(layout.pages[0].margins.bottom).toBe(56);
    expect(layout.pages[0].baseMargins).toEqual({ top: 60, bottom: 56 });
  });

  it('fills columns before advancing to a new page', () => {
    const options: LayoutOptions = {
      pageSize: { w: 600, h: 800 },
      margins: { top: 40, right: 40, bottom: 40, left: 40 },
      columns: { count: 2, gap: 20 },
    };

    const layout = layoutDocument([block], [makeMeasure([350, 350, 350])], options);

    expect(layout.pages).toHaveLength(1);
    const fragments = layout.pages[0].fragments;
    expect(fragments).toHaveLength(2);

    const columnWidth =
      (options.pageSize!.w - (options.margins!.left + options.margins!.right) - options.columns!.gap) /
      options.columns!.count;
    expect(fragments[0].x).toBeCloseTo(options.margins!.left);
    expect(fragments[0].width).toBeCloseTo(columnWidth);
    expect(fragments[1].x).toBeCloseTo(options.margins!.left + columnWidth + options.columns!.gap);
    expect(fragments[1].y).toBe(options.margins!.top);
    expect(layout.columns).toMatchObject({ count: 2, gap: 20 });
  });

  it('sets "page.columns" with separator when column separator is enabled', () => {
    const options: LayoutOptions = {
      pageSize: { w: 600, h: 800 },
      margins: { top: 40, right: 40, bottom: 40, left: 40 },
      columns: { count: 2, gap: 20, withSeparator: true },
    };
    const layout = layoutDocument([block], [makeMeasure([350, 350, 350])], options);

    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0].columns).toEqual({ count: 2, gap: 20, withSeparator: true });
    expect(layout.columns).toMatchObject({ count: 2, gap: 20, withSeparator: true });
  });

  it('preserves explicit column widths on page-level column metadata', () => {
    const options: LayoutOptions = {
      pageSize: { w: 600, h: 800 },
      margins: { top: 40, right: 40, bottom: 40, left: 40 },
      columns: { count: 2, gap: 20, widths: [100, 400], equalWidth: false, withSeparator: true },
    };
    const layout = layoutDocument([block], [makeMeasure([350, 350, 350])], options);

    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0].columns).toEqual({
      count: 2,
      gap: 20,
      widths: [100, 400],
      equalWidth: false,
      withSeparator: true,
    });
    expect(layout.columns).toEqual({
      count: 2,
      gap: 20,
      widths: [100, 400],
      equalWidth: false,
      withSeparator: true,
    });
  });

  it('caps the fill at the resolved column count when w:num exceeds the supplied widths (SD-2629)', () => {
    // count:4 but only two explicit widths -> the resolved count is 2 (Word renders min(num,
    // widths)). The fill loop must advance through 2 columns then start a new page, NOT into
    // phantom columns 3-4. Before SD-2629, advanceColumn read the raw count (4) while width math
    // read the clamped count (2): two answers for "how many columns exist".
    const options: LayoutOptions = {
      pageSize: { w: 600, h: 800 },
      margins: { top: 40, right: 40, bottom: 40, left: 40 },
      columns: { count: 4, gap: 20, widths: [192, 384], equalWidth: false },
    };

    // Eight 350px lines: each 720px column fits two, so a 2-column page holds four lines -> exactly
    // two pages. Under the bug (4 columns), all eight fit on one page across four column positions.
    const layout = layoutDocument([block], [makeMeasure([350, 350, 350, 350, 350, 350, 350, 350])], options);

    const columnXs = new Set(layout.pages.flatMap((page) => page.fragments.map((fragment) => Math.round(fragment.x))));
    expect(columnXs.size).toBe(2);
    expect(layout.pages).toHaveLength(2);
  });

  it('resolves page/document column metadata to the rendered count, not the raw w:num (SD-2629)', () => {
    const options: LayoutOptions = {
      pageSize: { w: 600, h: 800 },
      margins: { top: 40, right: 40, bottom: 40, left: 40 },
      columns: { count: 4, gap: 20, widths: [192, 384], equalWidth: false },
    };
    const layout = layoutDocument([block], [makeMeasure([350])], options);
    // count:4 with two widths renders two columns; metadata must not advertise four.
    expect(layout.columns).toEqual({ count: 2, gap: 20, widths: [192, 384], equalWidth: false });
    expect(layout.pages[0].columns).toEqual({ count: 2, gap: 20, widths: [192, 384], equalWidth: false });
  });

  it('places explicit columns at authored widths driven by per-column gaps (SD-2629 step 4)', () => {
    // The step-4 flip: explicit widths are no longer scaled to fill the content box, and each
    // column is positioned by its own gap. Three authored 192px columns (sum 576) sit in a 720px
    // content box with per-column gaps [0, 48]; total 624 < 720 leaves trailing space (Word does
    // not stretch authored widths). Per-column geometry:
    //   col0 @ 40                                  (left margin)
    //   col1 @ 40 + 192 + gaps[0]=0          = 232
    //   col2 @ 40 + 192 + 0 + 192 + gaps[1]=48 = 472
    // Before the flip, normalize scaled the widths to ~240px and applied the scalar gap (0),
    // placing the columns at 40 / 280 / 520. This test fails on the pre-flip engine.
    const options: LayoutOptions = {
      pageSize: { w: 800, h: 800 },
      margins: { top: 40, right: 40, bottom: 40, left: 40 },
      columns: { count: 3, gap: 0, widths: [192, 192, 192], gaps: [0, 48], equalWidth: false },
    };
    // One 700px line per column: each 720px-tall column holds exactly one, filling all three.
    const layout = layoutDocument([block], [makeMeasure([700, 700, 700])], options);

    expect(layout.pages).toHaveLength(1);
    const xs = layout.pages[0].fragments.map((fragment) => Math.round(fragment.x)).sort((a, b) => a - b);
    expect(xs).toEqual([40, 232, 472]);
  });

  it('does not set "page.columns" on single column layout', () => {
    const options: LayoutOptions = {
      pageSize: { w: 600, h: 800 },
      margins: { top: 40, right: 40, bottom: 40, left: 40 },
    };
    const layout = layoutDocument([block], [makeMeasure([350])], options);

    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0].columns).toBeUndefined();
    expect(layout.columns).toBeUndefined();
  });

  it('sets "page.columns" without separator when column separator is not enabled', () => {
    const options: LayoutOptions = {
      pageSize: { w: 600, h: 800 },
      margins: { top: 40, right: 40, bottom: 40, left: 40 },
      columns: { count: 2, gap: 20, withSeparator: false },
    };
    const layout = layoutDocument([block], [makeMeasure([350, 350, 350])], options);

    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0].columns).toEqual({ count: 2, gap: 20, withSeparator: false });
    expect(layout.columns).toEqual({ count: 2, gap: 20, withSeparator: false });
  });

  it('resolves mid-page region column metadata to the rendered count (SD-2629)', () => {
    // A continuous break to count:4 with two widths must surface as a 2-column region, not 4 - the
    // renderer prefers columnRegions over page.columns and reads the config raw.
    const blocks: FlowBlock[] = [
      { kind: 'paragraph', id: 'intro', runs: [] },
      {
        kind: 'sectionBreak',
        id: 'sb-continuous',
        type: 'continuous',
        columns: { count: 4, gap: 20, widths: [192, 384], equalWidth: false },
      },
      { kind: 'paragraph', id: 'body', runs: [] },
    ];
    const measures: Measure[] = [makeMeasure([30]), { kind: 'sectionBreak' }, makeMeasure([30, 30, 30])];
    const options: LayoutOptions = {
      pageSize: { w: 600, h: 800 },
      margins: { top: 40, right: 40, bottom: 40, left: 40 },
      columns: { count: 2, gap: 20 },
    };

    const layout = layoutDocument(blocks, measures, options);
    const regions = layout.pages[0].columnRegions;
    expect(regions).toBeDefined();
    const last = regions![regions!.length - 1];
    expect(last.columns.count).toBe(2);
    expect(last.columns.widths).toEqual([192, 384]);
  });

  it('emits page.columnRegions for continuous section breaks that change column config mid-page', () => {
    // Two sections on the same page: first 2-col with separator, then a
    // continuous break that switches to 3-col still with separator. The
    // layout engine should record a ConstraintBoundary and surface it on
    // page.columnRegions so the renderer can bound each separator to the
    // correct Y range.
    const blocks: FlowBlock[] = [
      { kind: 'paragraph', id: 'intro', runs: [] },
      {
        kind: 'sectionBreak',
        id: 'sb-continuous',
        type: 'continuous',
        columns: { count: 3, gap: 20, withSeparator: true },
      },
      { kind: 'paragraph', id: 'body', runs: [] },
    ];
    const measures: Measure[] = [makeMeasure([30]), { kind: 'sectionBreak' }, makeMeasure([30, 30, 30])];

    const options: LayoutOptions = {
      pageSize: { w: 600, h: 800 },
      margins: { top: 40, right: 40, bottom: 40, left: 40 },
      columns: { count: 2, gap: 20, withSeparator: true },
    };

    const layout = layoutDocument(blocks, measures, options);

    expect(layout.pages).toHaveLength(1);
    const regions = layout.pages[0].columnRegions;
    expect(regions).toBeDefined();
    expect(regions!.length).toBeGreaterThanOrEqual(2);
    // First region covers the initial 2-col layout from topMargin to the boundary.
    expect(regions![0].yStart).toBe(40);
    expect(regions![0].columns).toEqual({ count: 2, gap: 20, withSeparator: true });
    // Second region picks up the continuous break's 3-col config and ends at
    // the bottom of the content area.
    const last = regions![regions!.length - 1];
    expect(last.columns).toMatchObject({ count: 3, gap: 20, withSeparator: true });
    expect(last.yEnd).toBe(800 - 40);
    // Regions must tile (no gaps, no overlap).
    for (let i = 1; i < regions!.length; i++) {
      expect(regions![i].yStart).toBe(regions![i - 1].yEnd);
    }
  });

  it('omits page.columnRegions when no mid-page column change occurs', () => {
    const options: LayoutOptions = {
      pageSize: { w: 600, h: 800 },
      margins: { top: 40, right: 40, bottom: 40, left: 40 },
      columns: { count: 2, gap: 20, withSeparator: true },
    };
    const layout = layoutDocument([block], [makeMeasure([350, 350, 350])], options);

    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0].columnRegions).toBeUndefined();
  });

  it('applies spacing before and after paragraphs', () => {
    const spacingBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'spaced',
      runs: [],
      attrs: {
        spacing: { before: 20, after: 15 },
      },
    };
    const secondBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'second',
      runs: [],
    };

    const measures: Measure[] = [makeMeasure([20]), makeMeasure([20])];
    const layout = layoutDocument([spacingBlock, secondBlock], measures, DEFAULT_OPTIONS);

    const firstFragment = layout.pages[0].fragments[0];
    expect(firstFragment.y).toBeCloseTo(DEFAULT_OPTIONS.margins!.top + 20, 1);

    const secondFragment = layout.pages[0].fragments[1];
    const expectedY = DEFAULT_OPTIONS.margins!.top + 20 + 20 + 15;
    expect(secondFragment.y).toBeCloseTo(expectedY, 1);
  });

  it('collapses adjacent spacing to the larger before/after value', () => {
    const firstBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'first',
      runs: [],
      attrs: { spacing: { after: 10 } },
    };
    const secondBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'second',
      runs: [],
      attrs: { spacing: { before: 16 } },
    };

    const measures: Measure[] = [makeMeasure([20]), makeMeasure([20])];
    const layout = layoutDocument([firstBlock, secondBlock], measures, DEFAULT_OPTIONS);
    const firstFragment = layout.pages[0].fragments[0];
    const secondFragment = layout.pages[0].fragments[1];

    const firstMeasure = measures[0] as ParagraphMeasure;
    const firstBottom = firstFragment.y + firstMeasure.totalHeight;
    const gap = secondFragment.y - firstBottom;
    expect(gap).toBeCloseTo(16, 1);
  });

  it('preserves larger after spacing when next paragraph has smaller before', () => {
    const firstBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'first',
      runs: [],
      attrs: { spacing: { after: 18 } },
    };
    const secondBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'second',
      runs: [],
      attrs: { spacing: { before: 8 } },
    };

    const measures: Measure[] = [makeMeasure([20]), makeMeasure([20])];
    const layout = layoutDocument([firstBlock, secondBlock], measures, DEFAULT_OPTIONS);
    const firstFragment = layout.pages[0].fragments[0];
    const secondFragment = layout.pages[0].fragments[1];

    const firstMeasure = measures[0] as ParagraphMeasure;
    const firstBottom = firstFragment.y + firstMeasure.totalHeight;
    const gap = secondFragment.y - firstBottom;
    expect(gap).toBeCloseTo(18, 1);
  });

  it('handles spacingBefore larger than page content area without infinite loop', () => {
    // Regression test: When spacingBefore exceeds the entire content area (e.g., tiny page height
    // or very large spacing), the layout engine should complete without infinite looping.
    // This can happen when header/footer layout has minimal height constraints.
    const blockWithLargeSpacing: FlowBlock = {
      kind: 'paragraph',
      id: 'large-spacing',
      runs: [],
      attrs: {
        spacing: { before: 500 }, // Much larger than content area
      },
    };

    const measures: Measure[] = [makeMeasure([20])];

    // Use a very small page to create a tiny content area
    const tinyPageOptions: LayoutOptions = {
      pageSize: { w: 200, h: 50 }, // Very short page
      margins: { top: 10, right: 10, bottom: 10, left: 10 }, // Content area = 30px
    };

    // This should complete without hanging (spacingBefore 500 > content area 30)
    const layout = layoutDocument([blockWithLargeSpacing], measures, tinyPageOptions);

    // Layout should produce valid output - content is placed even if spacing is truncated
    expect(layout.pages.length).toBeGreaterThan(0);
    expect(layout.pages[0].fragments.length).toBeGreaterThan(0);

    // Verify the spacing was skipped and fragment is at topMargin (10), not topMargin + spacing (510)
    const fragment = layout.pages[0].fragments[0];
    expect(fragment.y).toBe(tinyPageOptions.margins!.top); // Should be at topMargin (10)

    // Verify only one page was created (content fits after skipping spacing)
    expect(layout.pages.length).toBe(1);
  });

  it('handles spacingBefore equal to content area height (boundary condition)', () => {
    // Edge case: spacingBefore exactly equals the content area height.
    // This triggers the infinite loop guard after advancing to a new page.
    // When spacing (31) is just over the content area (30), attempting to apply it
    // after advancing to a fresh page still fails, triggering the guard.
    const blockWithExactSpacing: FlowBlock = {
      kind: 'paragraph',
      id: 'exact-spacing',
      runs: [],
      attrs: {
        spacing: { before: 31 }, // Slightly larger than content area (50 - 10 - 10 = 30)
      },
    };

    const measures: Measure[] = [makeMeasure([10])]; // Content must fit after skipping spacing

    const exactPageOptions: LayoutOptions = {
      pageSize: { w: 200, h: 50 },
      margins: { top: 10, right: 10, bottom: 10, left: 10 }, // Content area = 30px
    };

    const layout = layoutDocument([blockWithExactSpacing], measures, exactPageOptions);

    // Should complete without hanging
    expect(layout.pages.length).toBeGreaterThan(0);
    expect(layout.pages[0].fragments.length).toBeGreaterThan(0);

    // When spacing exceeds content area, it should be skipped and content placed at topMargin
    const fragment = layout.pages[0].fragments[0];
    expect(fragment.y).toBe(exactPageOptions.margins!.top);
  });

  it('handles very small content area with spacing that still fits', () => {
    // Edge case: Content area is very small but spacing is even smaller and should fit.
    const blockWithSmallSpacing: FlowBlock = {
      kind: 'paragraph',
      id: 'small-spacing',
      runs: [],
      attrs: {
        spacing: { before: 5 }, // Small spacing that fits in small content area
      },
    };

    const measures: Measure[] = [makeMeasure([10])];

    const smallPageOptions: LayoutOptions = {
      pageSize: { w: 200, h: 40 },
      margins: { top: 10, right: 10, bottom: 10, left: 10 }, // Content area = 20px
    };

    const layout = layoutDocument([blockWithSmallSpacing], measures, smallPageOptions);

    // Should complete without hanging
    expect(layout.pages.length).toBeGreaterThan(0);

    // Spacing should be applied (5px from top margin)
    const fragment = layout.pages[0].fragments[0];
    expect(fragment.y).toBe(smallPageOptions.margins!.top + 5);
    expect(layout.pages.length).toBe(1);
  });

  it.skip('lays out list blocks with marker gutters', () => {
    const listBlock: FlowBlock = {
      kind: 'list',
      id: 'list-1',
      listType: 'number',
      items: [
        {
          id: 'item-1',
          marker: { kind: 'number', text: '1.', level: 0, order: 1 },
          paragraph: {
            kind: 'paragraph',
            id: 'p-1',
            runs: [],
            attrs: { indent: { left: 24 } },
          },
        },
      ],
    };

    const paragraphMeasure = makeMeasure([20]) as ParagraphMeasure;
    const listMeasure: Measure = {
      kind: 'list',
      items: [
        {
          itemId: 'item-1',
          markerWidth: 24,
          markerTextWidth: 12,
          indentLeft: 24,
          paragraph: paragraphMeasure,
        },
      ],
      totalHeight: paragraphMeasure.totalHeight,
    };

    const layout = layoutDocument([listBlock], [listMeasure], DEFAULT_OPTIONS);
    const fragment = layout.pages[0].fragments[0] as ListItemFragment;
    expect(fragment.kind).toBe('list-item');
    const expectedX = DEFAULT_OPTIONS.margins!.left + 24 + 24;
    expect(fragment.x).toBeCloseTo(expectedX, 5);
    const expectedWidth =
      DEFAULT_OPTIONS.pageSize!.w - DEFAULT_OPTIONS.margins!.left - DEFAULT_OPTIONS.margins!.right - 24 - 24;
    expect(fragment.width).toBeCloseTo(expectedWidth, 5);
  });

  it('adjusts paragraph fragment width when anchored image creates exclusion zone', () => {
    // Create an anchored image on the left with Square wrap
    const imageBlock: ImageBlock = {
      kind: 'image',
      id: 'img-1',
      src: 'test.jpg',
      width: 200,
      height: 150,
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'column',
        vRelativeFrom: 'paragraph',
        alignH: 'left',
        offsetH: 0,
        offsetV: 0,
      },
      wrap: {
        type: 'Square',
        wrapText: 'right', // Image on left, text wraps to right
        distLeft: 5,
        distRight: 10,
      },
    };

    const imageMeasure: ImageMeasure = {
      kind: 'image',
      width: 200,
      height: 150,
    };

    // Create a paragraph that should wrap around the image
    const paragraphBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'para-1',
      runs: [],
    };

    const paragraphMeasure = makeMeasure([20, 20, 20]);

    // Provide remeasureParagraph callback to enable float-aware text wrapping
    const remeasureParagraph = mock((_block: FlowBlock, _maxWidth: number): ParagraphMeasure => {
      // Remeasure paragraph at reduced width
      // For this test, just return the same measure with adjusted width
      return makeMeasure([20, 20, 20]);
    });

    const layout = layoutDocument([imageBlock, paragraphBlock], [imageMeasure, paragraphMeasure], {
      ...DEFAULT_OPTIONS,
      remeasureParagraph,
    });

    expect(layout.pages).toHaveLength(1);
    const fragments = layout.pages[0].fragments;
    expect(fragments).toHaveLength(2);

    // First fragment is the anchored image
    const imageFragment = fragments[0] as ImageFragment;
    expect(imageFragment.kind).toBe('image');
    expect(imageFragment.isAnchored).toBe(true);
    expect(imageFragment.zIndex).toBe(1);

    // Second fragment remains column-wide; line segments own float offsets so
    // later lines can return to full width below the image.
    const paraFragment = fragments[1] as ParaFragment;
    expect(paraFragment.kind).toBe('para');

    // The image is positioned at left margin (50px)
    // Exclusion boundary: imageX + imageWidth + distRight = 50 + 200 + 10 = 260px
    const imageX = DEFAULT_OPTIONS.margins!.left;
    const exclusionBoundary = imageX + 200 + 10;

    expect(paraFragment.x).toBe(DEFAULT_OPTIONS.margins!.left);
    const contentWidth = DEFAULT_OPTIONS.pageSize!.w - DEFAULT_OPTIONS.margins!.left - DEFAULT_OPTIONS.margins!.right;
    const exclusionWidth = exclusionBoundary - DEFAULT_OPTIONS.margins!.left;
    expect(paraFragment.width).toBe(contentWidth);
    expect(remeasureParagraph.mock.calls[0]?.[3]?.[0]).toEqual([
      { offsetX: exclusionWidth, width: contentWidth - exclusionWidth },
    ]);
  });

  it('does not adjust fragments when image has TopAndBottom wrap', () => {
    const imageBlock: ImageBlock = {
      kind: 'image',
      id: 'img-1',
      src: 'test.jpg',
      width: 200,
      height: 150,
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'column',
        vRelativeFrom: 'paragraph',
        alignH: 'center',
      },
      wrap: {
        type: 'TopAndBottom', // No horizontal wrapping
      },
    };

    const imageMeasure: ImageMeasure = {
      kind: 'image',
      width: 200,
      height: 150,
    };

    const paragraphBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'para-1',
      runs: [],
    };

    const paragraphMeasure = makeMeasure([20, 20]);

    const layout = layoutDocument([imageBlock, paragraphBlock], [imageMeasure, paragraphMeasure], DEFAULT_OPTIONS);

    const paraFragment = layout.pages[0].fragments[1] as ParaFragment;
    const contentWidth = DEFAULT_OPTIONS.pageSize!.w - DEFAULT_OPTIONS.margins!.left - DEFAULT_OPTIONS.margins!.right;

    // Fragment should use full width since TopAndBottom doesn't create horizontal exclusions
    expect(paraFragment.x).toBe(DEFAULT_OPTIONS.margins!.left);
    expect(paraFragment.width).toBe(contentWidth);
  });

  it('registers Square table exclusions before laying out the anchor paragraph', () => {
    const tableBlock = makeTableBlock('table-1', 1, {
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'column',
        vRelativeFrom: 'paragraph',
        offsetH: 0,
        offsetV: 0,
      },
      wrap: {
        type: 'Square',
        wrapText: 'right', // Table on left, text wraps to right
        distLeft: 5,
        distRight: 10,
      },
    });

    const tableMeasure = makeTableMeasure([200], [60]);

    const paragraphBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'para-1',
      runs: [],
    };

    const paragraphMeasure = makeMeasure([20, 20, 20]);

    const remeasureParagraph = mock(() => paragraphMeasure);
    const layout = layoutDocument([paragraphBlock, tableBlock], [paragraphMeasure, tableMeasure], {
      ...DEFAULT_OPTIONS,
      remeasureParagraph,
    });

    const fragments = layout.pages[0].fragments;
    const paraFragment = fragments.find(
      (fragment) => fragment.kind === 'para' && fragment.blockId === 'para-1',
    ) as ParaFragment;

    expect(paraFragment).toBeTruthy();

    const contentWidth = DEFAULT_OPTIONS.pageSize!.w - DEFAULT_OPTIONS.margins!.left - DEFAULT_OPTIONS.margins!.right;

    const exclusionBoundary = DEFAULT_OPTIONS.margins!.left + 200 + 10;
    expect(paraFragment.x).toBe(DEFAULT_OPTIONS.margins!.left);
    expect(paraFragment.width).toBe(contentWidth);
    expect(remeasureParagraph.mock.calls[0]?.[3]?.[0]).toEqual([
      {
        offsetX: exclusionBoundary - DEFAULT_OPTIONS.margins!.left,
        width: contentWidth - (exclusionBoundary - DEFAULT_OPTIONS.margins!.left),
      },
    ]);
  });

  it('registers page-relative Square tables before earlier paragraphs', () => {
    const firstParagraph: FlowBlock = { kind: 'paragraph', id: 'before-table-anchor', runs: [] };
    const anchorParagraph: FlowBlock = { kind: 'paragraph', id: 'table-anchor', runs: [] };
    const tableBlock = makeTableBlock('page-table', 1, {
      anchor: { isAnchored: true, hRelativeFrom: 'page', vRelativeFrom: 'page', offsetH: 400, offsetV: 0 },
      wrap: { type: 'Square', wrapText: 'left', distLeft: 12 },
    });
    const paragraphMeasure = makeMeasure([20]);
    const tableMeasure = makeTableMeasure([160], [80]);
    const remeasureParagraph = mock(() => paragraphMeasure);

    layoutDocument([firstParagraph, anchorParagraph, tableBlock], [paragraphMeasure, paragraphMeasure, tableMeasure], {
      ...DEFAULT_OPTIONS,
      remeasureParagraph,
    });

    expect(remeasureParagraph.mock.calls[0]?.[3]?.[0]).toEqual([
      { offsetX: 0, width: 400 - DEFAULT_OPTIONS.margins!.left - 12 },
    ]);
  });

  it('places a page-bottom-aligned 100% floating table at the page bottom', () => {
    const tableBlock = makeTableBlock('bottom-pct-table', 1, {
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'column',
        vRelativeFrom: 'page',
        alignV: 'bottom',
      },
      wrap: { type: 'Square' },
    });
    tableBlock.attrs = { tableWidth: { width: 5000, type: 'pct' } };
    const tableMeasure = makeTableMeasure([500], [100]);
    const anchorBlock: FlowBlock = { kind: 'paragraph', id: 'bottom-pct-anchor', runs: [] };
    const anchorMeasure = makeMeasure([20]);

    const layout = layoutDocument([anchorBlock, tableBlock], [anchorMeasure, tableMeasure], DEFAULT_OPTIONS);
    const tableFragment = layout.pages[0]?.fragments.find(
      (fragment) => fragment.kind === 'table' && fragment.blockId === tableBlock.id,
    ) as TableFragment | undefined;

    expect(tableFragment?.y).toBe(DEFAULT_OPTIONS.pageSize!.h - tableMeasure.totalHeight!);
  });

  it('keeps a negative page-relative floating table on the physical page', () => {
    const tableBlock = makeTableBlock('page-negative-offset-table', 1, {
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'page',
        vRelativeFrom: 'page',
        offsetH: 400,
        offsetV: -93.33333333333333,
      },
      wrap: { type: 'Square', wrapText: 'bothSides' },
    });
    const tableMeasure = makeTableMeasure([160], [80]);
    const anchorBlock: FlowBlock = { kind: 'paragraph', id: 'page-negative-offset-anchor', runs: [] };
    const anchorMeasure = makeMeasure([20]);

    const layout = layoutDocument([anchorBlock, tableBlock], [anchorMeasure, tableMeasure], DEFAULT_OPTIONS);
    const tableFragment = layout.pages[0]?.fragments.find(
      (fragment) => fragment.kind === 'table' && fragment.blockId === tableBlock.id,
    ) as TableFragment | undefined;

    expect(tableFragment?.y).toBe(0);
  });

  it('preserves a negative paragraph-relative floating table offset', () => {
    const tableBlock = makeTableBlock('text-negative-offset-table', 1, {
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'page',
        vRelativeFrom: 'paragraph',
        offsetH: 400,
        offsetV: -93.33333333333333,
      },
      wrap: { type: 'Square', wrapText: 'bothSides' },
    });
    const tableMeasure = makeTableMeasure([160], [80]);
    const anchorBlock: FlowBlock = { kind: 'paragraph', id: 'text-negative-offset-anchor', runs: [] };
    const anchorMeasure = makeMeasure([20]);

    const layout = layoutDocument([anchorBlock, tableBlock], [anchorMeasure, tableMeasure], DEFAULT_OPTIONS);
    const tableFragment = layout.pages[0]?.fragments.find(
      (fragment) => fragment.kind === 'table' && fragment.blockId === tableBlock.id,
    ) as TableFragment | undefined;

    expect(tableFragment?.y).toBeCloseTo(DEFAULT_OPTIONS.margins!.top + anchorMeasure.totalHeight - 93.33333333333333);
  });

  it('paginates an oversized page-bottom-aligned 100% table', () => {
    const tableBlock = makeTableBlock('tall-bottom-pct-table', 3, {
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'column',
        vRelativeFrom: 'page',
        alignV: 'bottom',
      },
      wrap: { type: 'Square' },
    });
    tableBlock.attrs = { tableWidth: { width: 5000, type: 'pct' } };
    const tableMeasure = makeTableMeasure([500], [500, 500, 500]);
    const anchorBlock: FlowBlock = { kind: 'paragraph', id: 'tall-bottom-pct-anchor', runs: [] };
    const anchorMeasure = makeMeasure([20]);

    const layout = layoutDocument([anchorBlock, tableBlock], [anchorMeasure, tableMeasure], DEFAULT_OPTIONS);
    const tableFragments = layout.pages.flatMap((page) =>
      page.fragments.filter((fragment) => fragment.kind === 'table' && fragment.blockId === tableBlock.id),
    ) as TableFragment[];

    expect(tableFragments).toHaveLength(3);
    expect(tableFragments.map((fragment) => [fragment.fromRow, fragment.toRow])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
  });

  it('lays out an oversized page-bottom-aligned table when footnotes reserve page space', () => {
    const tableBlock = makeTableBlock('footnote-reserved-bottom-table', 3, {
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'column',
        vRelativeFrom: 'page',
        alignV: 'bottom',
      },
      wrap: { type: 'Square' },
    });
    tableBlock.attrs = { tableWidth: { width: 5000, type: 'pct' } };
    const tableMeasure = makeTableMeasure([500], [260, 260, 260]);
    const anchorBlock: FlowBlock = { kind: 'paragraph', id: 'footnote-reserved-bottom-anchor', runs: [] };
    const anchorMeasure = makeMeasure([20]);

    const layout = layoutDocument([anchorBlock, tableBlock], [anchorMeasure, tableMeasure], {
      ...DEFAULT_OPTIONS,
      footnoteReservedByPageIndex: [100, 100],
    });
    const tableFragments = layout.pages.flatMap((page) =>
      page.fragments.filter((fragment) => fragment.kind === 'table' && fragment.blockId === tableBlock.id),
    ) as TableFragment[];

    expect(tableFragments.map((fragment) => [fragment.fromRow, fragment.toRow])).toEqual([[0, 3]]);
    expect(tableFragments.map((fragment) => fragment.y)).toEqual([20]);
  });

  it('keeps the horizontal page alignment for oversized floating table fragments', () => {
    const tableBlock = makeTableBlock('tall-right-page-table', 3, {
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'page',
        alignH: 'right',
        vRelativeFrom: 'page',
        alignV: 'bottom',
      },
      wrap: { type: 'Square' },
    });
    const tableMeasure = makeTableMeasure([100], [500, 500, 500]);
    const anchorBlock: FlowBlock = { kind: 'paragraph', id: 'tall-right-page-anchor', runs: [] };
    const anchorMeasure = makeMeasure([20]);

    const layout = layoutDocument([anchorBlock, tableBlock], [anchorMeasure, tableMeasure], DEFAULT_OPTIONS);
    const tableFragments = layout.pages.flatMap((page) =>
      page.fragments.filter((fragment) => fragment.kind === 'table' && fragment.blockId === tableBlock.id),
    ) as TableFragment[];

    expect(tableFragments).toHaveLength(3);
    expect(tableFragments.every((fragment) => fragment.x === 500)).toBe(true);
  });

  it('uses the shared logical alignment contract for anchored table fragments', () => {
    const tableBlock = makeTableBlock('logical-table', 1, {
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'margin',
        vRelativeFrom: 'paragraph',
        alignH: 'outside',
      },
      wrap: { type: 'Square', wrapText: 'left' },
    });
    const tableMeasure = makeTableMeasure([100], [30]);
    const paragraphBlock: FlowBlock = { kind: 'paragraph', id: 'logical-anchor', runs: [] };
    const paragraphMeasure = makeMeasure([20]);

    const layout = layoutDocument([paragraphBlock, tableBlock], [paragraphMeasure, tableMeasure], DEFAULT_OPTIONS);
    const fragment = layout.pages[0]?.fragments.find(
      (candidate) => candidate.kind === 'table' && candidate.blockId === tableBlock.id,
    );
    const contentRight = DEFAULT_OPTIONS.pageSize!.w - DEFAULT_OPTIONS.margins!.right;

    expect(fragment?.x).toBe(contentRight - 100);
  });

  it('anchors tables to the starting page when the paragraph spans pages', () => {
    const options: LayoutOptions = {
      pageSize: { w: 300, h: 120 },
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
    };

    const paragraphBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'para-1',
      runs: [],
    };
    const paragraphMeasure = makeMeasure([40, 40, 40]);

    const tableBlock = makeTableBlock('table-1', 1, {
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'column',
        vRelativeFrom: 'paragraph',
        offsetH: 0,
        offsetV: 10,
      },
      wrap: { type: 'Square' },
    });
    const tableMeasure = makeTableMeasure([100], [30]);

    const layout = layoutDocument([paragraphBlock, tableBlock], [paragraphMeasure, tableMeasure], options);

    expect(layout.pages.length).toBeGreaterThanOrEqual(2);

    const firstPageTable = layout.pages[0].fragments.find(
      (fragment) => fragment.kind === 'table' && fragment.blockId === 'table-1',
    ) as { y: number } | undefined;
    const secondPageTable = layout.pages[1].fragments.find(
      (fragment) => fragment.kind === 'table' && fragment.blockId === 'table-1',
    ) as { y: number } | undefined;

    expect(firstPageTable).toBeTruthy();
    expect(firstPageTable?.y).toBe(options.margins!.top + 10);
    expect(secondPageTable).toBeUndefined();
  });

  it('moves a Square table and its exclusion with a keepLines anchor paragraph', () => {
    const options: LayoutOptions = {
      pageSize: { w: 300, h: 120 },
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
    };
    const filler: FlowBlock = { kind: 'paragraph', id: 'filler', runs: [{ text: 'Filler' }] };
    const table = makeTableBlock('moving-table', 1, {
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'column',
        vRelativeFrom: 'paragraph',
        offsetH: 0,
        offsetV: 0,
      },
      wrap: { type: 'Square', wrapText: 'right' },
    });
    const anchor: FlowBlock = {
      kind: 'paragraph',
      id: 'keep-lines-anchor',
      runs: [{ text: 'Keep these lines together' }],
      attrs: { keepLines: true },
    };
    const fillerMeasure = makeMeasure([60]);
    const tableMeasure = makeTableMeasure([100], [20]);
    const anchorMeasure = makeMeasure([30, 30]);

    const layout = layoutDocument([filler, table, anchor], [fillerMeasure, tableMeasure, anchorMeasure], {
      ...options,
      remeasureParagraph: (block) => (block.id === anchor.id ? anchorMeasure : fillerMeasure),
    });

    expect(layout.pages[0].fragments.some((fragment) => fragment.blockId === table.id)).toBe(false);
    const movedTable = layout.pages[1].fragments.find((fragment) => fragment.blockId === table.id) as
      | TableFragment
      | undefined;
    const movedAnchor = layout.pages[1].fragments.find((fragment) => fragment.blockId === anchor.id) as
      | ParaFragment
      | undefined;
    expect(movedTable?.y).toBe(options.margins!.top);
    expect(movedAnchor?.y).toBe(options.margins!.top);
    expect(movedAnchor?.x).toBe(options.margins!.left);
  });

  it('keeps each Square table tblpY paragraph-relative while stacking collisions', () => {
    const first = makeTableBlock('first-square', 1, {
      anchor: { isAnchored: true, vRelativeFrom: 'paragraph', offsetV: 10 },
      wrap: { type: 'Square' },
    });
    const second = makeTableBlock('second-square', 1, {
      anchor: { isAnchored: true, vRelativeFrom: 'paragraph', offsetV: 20 },
      wrap: { type: 'Square' },
    });
    const third = makeTableBlock('third-square', 1, {
      anchor: { isAnchored: true, vRelativeFrom: 'paragraph', offsetV: 80 },
      wrap: { type: 'Square' },
    });
    const paragraph: FlowBlock = { kind: 'paragraph', id: 'shared-anchor', runs: [{ text: 'Anchor' }] };
    const tableMeasure = makeTableMeasure([100], [30]);

    const layout = layoutDocument(
      [first, second, third, paragraph],
      [tableMeasure, tableMeasure, tableMeasure, makeMeasure([20])],
      DEFAULT_OPTIONS,
    );
    const tables = new Map(
      layout.pages[0].fragments
        .filter((fragment): fragment is TableFragment => fragment.kind === 'table')
        .map((fragment) => [fragment.blockId, fragment]),
    );
    const paragraphY = DEFAULT_OPTIONS.margins!.top;

    expect(tables.get(first.id)?.y).toBe(paragraphY + 10);
    expect(tables.get(second.id)?.y).toBe(paragraphY + 40);
    expect(tables.get(third.id)?.y).toBe(paragraphY + 80);
  });

  it('keeps subsequent paragraphs in normal flow beside side-positioned anchored tables', () => {
    const paragraph1: FlowBlock = { kind: 'paragraph', id: 'para-1', runs: [] };
    const paragraph2: FlowBlock = { kind: 'paragraph', id: 'para-2', runs: [] };

    const paragraph1Measure = makeMeasure([20]);
    const paragraph2Measure = makeMeasure([20, 20]);

    const tableBlock = makeTableBlock('table-1', 1, {
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'column',
        vRelativeFrom: 'paragraph',
        offsetH: 0,
        offsetV: 0,
      },
      wrap: {
        type: 'Square',
        wrapText: 'right',
      },
    });
    const tableMeasure = makeTableMeasure([200], [100]);

    const layout = layoutDocument(
      [paragraph1, tableBlock, paragraph2],
      [paragraph1Measure, tableMeasure, paragraph2Measure],
      DEFAULT_OPTIONS,
    );

    const para2Fragment = layout.pages[0].fragments.find(
      (fragment) => fragment.kind === 'para' && fragment.blockId === 'para-2',
    ) as ParaFragment;

    const contentWidth = DEFAULT_OPTIONS.pageSize!.w - DEFAULT_OPTIONS.margins!.left - DEFAULT_OPTIONS.margins!.right;

    expect(para2Fragment.x).toBe(DEFAULT_OPTIONS.margins!.left);
    expect(para2Fragment.width).toBe(contentWidth);
    expect(para2Fragment.y).toBe(DEFAULT_OPTIONS.margins!.top + paragraph1Measure.totalHeight);
  });

  it('includes taller side-positioned anchored tables in bodyMaxY without moving the flow cursor', () => {
    const paragraph1: FlowBlock = { kind: 'paragraph', id: 'para-1', runs: [] };
    const paragraph2: FlowBlock = { kind: 'paragraph', id: 'para-2', runs: [] };
    const paragraph1Measure = makeMeasure([20]);
    const paragraph2Measure = makeMeasure([20]);
    const tableBlock = makeTableBlock('table-1', 1, {
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'column',
        vRelativeFrom: 'paragraph',
        offsetH: 280,
        offsetV: 0,
      },
      wrap: {
        type: 'Square',
        wrapText: 'bothSides',
        distBottom: 6,
      },
    });
    const tableMeasure = makeTableMeasure([120], [100]);

    const layout = layoutDocument(
      [paragraph1, tableBlock, paragraph2],
      [paragraph1Measure, tableMeasure, paragraph2Measure],
      DEFAULT_OPTIONS,
    );

    const para2Fragment = layout.pages[0].fragments.find(
      (fragment) => fragment.kind === 'para' && fragment.blockId === 'para-2',
    ) as ParaFragment;
    const tableFragment = layout.pages[0].fragments.find(
      (fragment) => fragment.kind === 'table' && fragment.blockId === 'table-1',
    ) as TableFragment;

    expect(para2Fragment.y).toBe(DEFAULT_OPTIONS.margins!.top + paragraph1Measure.totalHeight);
    expect((layout.pages[0] as { bodyMaxY?: number }).bodyMaxY).toBeCloseTo(
      tableFragment.y + tableFragment.height + 6,
      1,
    );
  });

  it('positions anchored tables from paragraph top plus offsetV (form-field row)', () => {
    const paragraphBlock: FlowBlock = { kind: 'paragraph', id: 'para-1', runs: [] };
    const paragraphMeasure = makeMeasure([18, 18, 18]);

    const tableBlock = makeTableBlock('table-field', 1, {
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'column',
        vRelativeFrom: 'paragraph',
        offsetH: 280,
        offsetV: 2,
      },
      wrap: { type: 'None' },
    });
    const tableMeasure = makeTableMeasure([120], [14]);

    const layout = layoutDocument([paragraphBlock, tableBlock], [paragraphMeasure, tableMeasure], DEFAULT_OPTIONS);

    const tableFragment = layout.pages[0].fragments.find(
      (fragment) => fragment.kind === 'table' && fragment.blockId === 'table-field',
    ) as { y: number; x: number } | undefined;

    expect(tableFragment).toBeTruthy();
    expect(tableFragment?.y).toBe(DEFAULT_OPTIONS.margins!.top + 2);
    expect(tableFragment?.x).toBe(DEFAULT_OPTIONS.margins!.left + 280);
  });

  it('keeps an implicitly anchored table with a flow-positioned frame paragraph', () => {
    const filler: FlowBlock = { kind: 'paragraph', id: 'frame-filler', runs: [{ text: 'Filler' }] };
    const table = makeTableBlock('frame-table', 1, {
      anchor: { isAnchored: true, vRelativeFrom: 'paragraph', offsetV: 5 },
      wrap: { type: 'None' },
    });
    const frame: FlowBlock = {
      kind: 'paragraph',
      id: 'flow-frame-anchor',
      runs: [{ text: 'Positioned frame' }],
      attrs: { frame: { wrap: 'around' } },
    };
    const following: FlowBlock = { kind: 'paragraph', id: 'after-frame', runs: [{ text: 'Following' }] };

    const layout = layoutDocument(
      [filler, table, frame, following],
      [makeMeasure([20]), makeTableMeasure([100], [14]), makeMeasure([20]), makeMeasure([20])],
      DEFAULT_OPTIONS,
    );
    const fragments = layout.pages[0].fragments;
    const tableFragment = fragments.find((fragment) => fragment.blockId === table.id) as TableFragment;
    const frameFragment = fragments.find((fragment) => fragment.blockId === frame.id) as ParaFragment;

    expect(tableFragment.y).toBe(frameFragment.y + 5);
  });

  it('keeps an explicitly anchored table with its flow-positioned frame paragraph', () => {
    const table = makeTableBlock('explicit-frame-table', 1, {
      anchor: { isAnchored: true, vRelativeFrom: 'paragraph', offsetV: 7 },
      wrap: { type: 'None' },
    });
    table.attrs = { anchorParagraphId: 'explicit-flow-frame-anchor' };
    const filler: FlowBlock = { kind: 'paragraph', id: 'explicit-frame-filler', runs: [{ text: 'Filler' }] };
    const frame: FlowBlock = {
      kind: 'paragraph',
      id: 'explicit-flow-frame-anchor',
      runs: [{ text: 'Explicit positioned frame' }],
      attrs: { frame: { wrap: 'around' } },
    };
    const following: FlowBlock = { kind: 'paragraph', id: 'after-explicit-frame', runs: [{ text: 'Following' }] };

    const layout = layoutDocument(
      [table, filler, frame, following],
      [makeTableMeasure([100], [14]), makeMeasure([20]), makeMeasure([20]), makeMeasure([20])],
      DEFAULT_OPTIONS,
    );
    const fragments = layout.pages[0].fragments;
    const tableFragment = fragments.find((fragment) => fragment.blockId === table.id) as TableFragment;
    const frameFragment = fragments.find((fragment) => fragment.blockId === frame.id) as ParaFragment;

    expect(tableFragment.y).toBe(frameFragment.y + 7);
  });

  for (const { wrap, y } of [
    { wrap: 'around' as const, y: 12 },
    { wrap: 'none' as const, y: -8 },
  ]) {
    it(`applies frame y to a table anchored to a ${wrap} positioned paragraph`, () => {
      const filler: FlowBlock = { kind: 'paragraph', id: `${wrap}-y-filler`, runs: [{ text: 'Filler' }] };
      const table = makeTableBlock(`${wrap}-y-table`, 1, {
        anchor: { isAnchored: true, vRelativeFrom: 'paragraph', offsetV: 5 },
        wrap: { type: 'None' },
      });
      const frame: FlowBlock = {
        kind: 'paragraph',
        id: `${wrap}-y-frame`,
        runs: [{ text: 'Positioned frame' }],
        attrs: { frame: { wrap, y } },
      };

      const layout = layoutDocument(
        [filler, table, frame],
        [makeMeasure([20]), makeTableMeasure([100], [14]), makeMeasure([20])],
        DEFAULT_OPTIONS,
      );
      const fragments = layout.pages[0].fragments;
      const tableFragment = fragments.find((fragment) => fragment.blockId === table.id) as TableFragment;
      const frameFragment = fragments.find((fragment) => fragment.blockId === frame.id) as ParaFragment;

      expect(tableFragment.y).toBe(frameFragment.y + 5);
    });
  }

  it('moves an anchored table when its flow-positioned frame advances to the next page', () => {
    const options: LayoutOptions = {
      pageSize: { w: 300, h: 120 },
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
    };
    const filler: FlowBlock = { kind: 'paragraph', id: 'page-filler', runs: [{ text: 'Filler' }] };
    const table = makeTableBlock('moving-frame-table', 1, {
      anchor: { isAnchored: true, vRelativeFrom: 'paragraph', offsetV: 5 },
      wrap: { type: 'None' },
    });
    const frame: FlowBlock = {
      kind: 'paragraph',
      id: 'moving-flow-frame',
      runs: [{ text: 'Positioned frame' }],
      attrs: { frame: { wrap: 'around' } },
    };

    const layout = layoutDocument(
      [filler, table, frame],
      [makeMeasure([60]), makeTableMeasure([100], [14]), makeMeasure([30])],
      options,
    );
    const tablePageIndex = layout.pages.findIndex((page) =>
      page.fragments.some((fragment) => fragment.blockId === table.id),
    );
    const framePageIndex = layout.pages.findIndex((page) =>
      page.fragments.some((fragment) => fragment.blockId === frame.id),
    );
    const tableFragment = layout.pages[tablePageIndex].fragments.find(
      (fragment) => fragment.blockId === table.id,
    ) as TableFragment;
    const frameFragment = layout.pages[framePageIndex].fragments.find(
      (fragment) => fragment.blockId === frame.id,
    ) as ParaFragment;

    expect(tablePageIndex).toBe(framePageIndex);
    expect(tableFragment.y).toBe(frameFragment.y + 5);
  });

  for (const { wrap, y } of [
    { wrap: 'around' as const, y: 11 },
    { wrap: 'none' as const, y: -7 },
  ]) {
    it(`applies frame y when a ${wrap} positioned table anchor advances to the next page`, () => {
      const options: LayoutOptions = {
        pageSize: { w: 300, h: 120 },
        margins: { top: 20, right: 20, bottom: 20, left: 20 },
      };
      const filler: FlowBlock = { kind: 'paragraph', id: `${wrap}-page-filler`, runs: [{ text: 'Filler' }] };
      const table = makeTableBlock(`${wrap}-moving-table`, 1, {
        anchor: { isAnchored: true, vRelativeFrom: 'paragraph', offsetV: 5 },
        wrap: { type: 'None' },
      });
      const frame: FlowBlock = {
        kind: 'paragraph',
        id: `${wrap}-moving-frame`,
        runs: [{ text: 'Positioned frame' }],
        attrs: { frame: { wrap, y } },
      };

      const layout = layoutDocument(
        [filler, table, frame],
        [makeMeasure([80]), makeTableMeasure([100], [14]), makeMeasure([20])],
        options,
      );
      const tablePageIndex = layout.pages.findIndex((page) =>
        page.fragments.some((fragment) => fragment.blockId === table.id),
      );
      const framePageIndex = layout.pages.findIndex((page) =>
        page.fragments.some((fragment) => fragment.blockId === frame.id),
      );
      const tableFragment = layout.pages[tablePageIndex].fragments.find(
        (fragment) => fragment.blockId === table.id,
      ) as TableFragment;
      const frameFragment = layout.pages[framePageIndex].fragments.find(
        (fragment) => fragment.blockId === frame.id,
      ) as ParaFragment;

      expect(tablePageIndex).toBe(framePageIndex);
      expect(tableFragment.y).toBe(frameFragment.y + 5);
    });
  }

  it('positions the Form F3 answer box from the heading regardless of later Yes spacing', () => {
    const fillerBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'content-before-special-assistance',
      runs: [{ text: 'Content before the anchored heading' }],
    };
    const tableBlock = makeTableBlock('special-assistance-answer-box', 1, {
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'page',
        vRelativeFrom: 'paragraph',
        offsetH: 459.8666666666667,
        offsetV: 844 / 15,
      },
      wrap: { type: 'None' },
    });
    const headingBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'special-assistance-heading',
      runs: [
        {
          text: 'Does the employer require any special assistance at the hearing or conference (eg a hearing loop)?',
        },
      ],
      attrs: { spacing: { before: 16 } },
    };
    const yesBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'special-assistance-yes',
      runs: [{ text: '☐ Yes – Please specify the assistance required' }],
      attrs: { spacing: { before: 16 } },
    };
    const noBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'special-assistance-no',
      runs: [{ text: '☐ No' }],
    };

    const headingHeight = 36.96875;
    const optionHeight = 16.866666666666664;
    const rawOffset = 844 / 15;

    const layout = layoutDocument(
      [fillerBlock, tableBlock, headingBlock, yesBlock, noBlock],
      [
        makeMeasure([40]),
        makeTableMeasure([217.06666666666666], [48]),
        makeMeasure([18.484375, 18.484375]),
        makeMeasure([optionHeight]),
        makeMeasure([optionHeight]),
      ],
      {
        pageSize: { w: 793.7333333333333, h: 1122.5333333333333 },
        margins: { top: 95.53333333333333, right: 96, bottom: 96, left: 95.53333333333333 },
      },
    );

    const fragments = layout.pages[0].fragments;
    const table = fragments.find(
      (fragment) => fragment.kind === 'table' && fragment.blockId === 'special-assistance-answer-box',
    ) as TableFragment | undefined;
    const heading = fragments.find((fragment) => fragment.blockId === 'special-assistance-heading');
    const yes = fragments.find((fragment) => fragment.blockId === 'special-assistance-yes');
    const no = fragments.find((fragment) => fragment.blockId === 'special-assistance-no');

    expect(table).toBeTruthy();
    expect(heading).toBeTruthy();
    expect(yes).toBeTruthy();
    expect(no).toBeTruthy();

    expect(table!.y).toBeCloseTo(heading!.y - 16 + rawOffset, 5);
    expect(yes!.y).toBeCloseTo(heading!.y + headingHeight + 16, 5);
    expect(no!.y).toBeLessThan(table!.y + table!.height);
  });

  it('treats 99% width floating tables as inline but anchors narrower tables', () => {
    const paragraphBlock: FlowBlock = { kind: 'paragraph', id: 'para-1', runs: [] };
    const paragraphMeasure = makeMeasure([20]);

    const inlineTableBlock = makeTableBlock('table-99', 1, {
      anchor: { isAnchored: true, hRelativeFrom: 'column', vRelativeFrom: 'paragraph', offsetH: 0, offsetV: 0 },
      wrap: { type: 'Square' },
    });
    const inlineTableMeasure = makeTableMeasure([495], [40]);

    const inlineLayout = layoutDocument(
      [paragraphBlock, inlineTableBlock],
      [paragraphMeasure, inlineTableMeasure],
      DEFAULT_OPTIONS,
    );

    const inlineTableFragment = inlineLayout.pages[0].fragments.find(
      (fragment) => fragment.kind === 'table' && fragment.blockId === 'table-99',
    ) as { y: number } | undefined;

    expect(inlineTableFragment).toBeTruthy();
    expect(inlineTableFragment?.y).toBe(DEFAULT_OPTIONS.margins!.top + paragraphMeasure.totalHeight);

    const anchoredTableBlock = makeTableBlock('table-98', 1, {
      anchor: { isAnchored: true, hRelativeFrom: 'column', vRelativeFrom: 'paragraph', offsetH: 0, offsetV: 0 },
      wrap: { type: 'Square' },
    });
    const anchoredTableMeasure = makeTableMeasure([490], [40]);

    const anchoredLayout = layoutDocument(
      [{ kind: 'paragraph', id: 'para-1', runs: [] }, anchoredTableBlock],
      [paragraphMeasure, anchoredTableMeasure],
      DEFAULT_OPTIONS,
    );

    const anchoredTableFragment = anchoredLayout.pages[0].fragments.find(
      (fragment) => fragment.kind === 'table' && fragment.blockId === 'table-98',
    ) as { y: number } | undefined;

    expect(anchoredTableFragment).toBeTruthy();
    expect(anchoredTableFragment?.y).toBe(DEFAULT_OPTIONS.margins!.top);
  });

  it('renders a floating table when the document has no body paragraphs', () => {
    const floatingOnlyTable = makeParagraphlessFloatingTable('table-floating-only');
    const floatingOnlyMeasure = makeTableMeasure([220], [60]);

    const layout = layoutDocument([floatingOnlyTable], [floatingOnlyMeasure], DEFAULT_OPTIONS);

    expect(layout.pages).toHaveLength(1);

    const fragment = layout.pages[0].fragments.find(
      (candidate) => candidate.kind === 'table' && candidate.blockId === 'table-floating-only',
    ) as TableFragment | undefined;

    expect(fragment).toBeTruthy();
    expect(fragment?.x).toBe(120);
    expect(fragment?.y).toBe(DEFAULT_OPTIONS.margins!.top + 15);
  });

  it('preserves page-relative horizontal alignment for a paragraphless page-bottom table', () => {
    const tableBlock = makeTableBlock('paragraphless-page-right-table', 1, {
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'page',
        vRelativeFrom: 'page',
        alignH: 'right',
        alignV: 'bottom',
      },
      wrap: { type: 'Square' },
    });
    tableBlock.attrs = { tableWidth: { width: 5000, type: 'pct' } };
    const tableMeasure = makeTableMeasure([500], [100]);

    const layout = layoutDocument([tableBlock], [tableMeasure], DEFAULT_OPTIONS);
    const fragment = layout.pages[0]?.fragments.find(
      (candidate) => candidate.kind === 'table' && candidate.blockId === tableBlock.id,
    ) as TableFragment | undefined;

    expect(fragment).toMatchObject({ x: 100, y: 700 });
  });

  it('renders paragraphless anchored drawings and floating tables on the same fallback page', () => {
    const imageBlock: ImageBlock = {
      kind: 'image',
      id: 'paragraphless-floating-image',
      src: 'data:image/png;base64,xxx',
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'column',
        vRelativeFrom: 'paragraph',
        offsetH: 24,
        offsetV: 36,
      },
      wrap: { type: 'Square' },
    };
    const imageMeasure: ImageMeasure = {
      kind: 'image',
      width: 80,
      height: 40,
    };
    const floatingTable = makeParagraphlessFloatingTable('paragraphless-floating-table');
    const floatingTableMeasure = makeTableMeasure([220], [60]);

    const layout = layoutDocument([floatingTable, imageBlock], [floatingTableMeasure, imageMeasure], DEFAULT_OPTIONS);

    expect(layout.pages).toHaveLength(1);

    const imageFragment = layout.pages[0].fragments.find(
      (candidate) => candidate.kind === 'image' && candidate.blockId === 'paragraphless-floating-image',
    ) as ImageFragment | undefined;
    const tableFragment = layout.pages[0].fragments.find(
      (candidate) => candidate.kind === 'table' && candidate.blockId === 'paragraphless-floating-table',
    ) as TableFragment | undefined;

    expect(imageFragment).toBeTruthy();
    expect(tableFragment).toBeTruthy();
    expect(imageFragment?.x).toBe(DEFAULT_OPTIONS.margins!.left + 24);
    expect(imageFragment?.y).toBe(DEFAULT_OPTIONS.margins!.top + 36);
    expect(tableFragment?.x).toBe(120);
    expect(tableFragment?.y).toBe(DEFAULT_OPTIONS.margins!.top + 15);
  });

  it('renders a floating table after pruning a leading empty page', () => {
    const leadingPageBreak: PageBreakBlock = {
      kind: 'pageBreak',
      id: 'page-break-before-floating-table',
    };
    const floatingOnlyTable = makeParagraphlessFloatingTable('table-floating-after-page-break');
    const floatingOnlyMeasure = makeTableMeasure([220], [60]);

    const layout = layoutDocument(
      [leadingPageBreak, floatingOnlyTable],
      [{ kind: 'pageBreak' }, floatingOnlyMeasure],
      DEFAULT_OPTIONS,
    );

    expect(layout.pages).toHaveLength(1);

    const fragment = layout.pages[0].fragments.find(
      (candidate) => candidate.kind === 'table' && candidate.blockId === 'table-floating-after-page-break',
    ) as TableFragment | undefined;

    expect(fragment).toBeTruthy();
    expect(fragment?.x).toBe(120);
    expect(fragment?.y).toBe(DEFAULT_OPTIONS.margins!.top + 15);
  });

  it('propagates pm ranges onto fragments', () => {
    const blockWithRuns: FlowBlock = {
      kind: 'paragraph',
      id: 'block-2',
      runs: [
        {
          text: 'Hello',
          fontFamily: 'Arial',
          fontSize: 16,
          pmStart: 1,
          pmEnd: 6,
        },
        {
          text: ' world',
          fontFamily: 'Arial',
          fontSize: 16,
          pmStart: 6,
          pmEnd: 12,
        },
      ],
    };
    const measureWithRanges: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 1,
          toChar: 6,
          width: 100,
          ascent: 10,
          descent: 4,
          lineHeight: 20,
        },
      ],
      totalHeight: 20,
    };

    const layout = layoutDocument([blockWithRuns], [measureWithRanges], DEFAULT_OPTIONS);

    const fragment = layout.pages[0].fragments[0] as ParaFragment;
    expect(fragment.pmStart).toBe(1);
    expect(fragment.pmEnd).toBe(12);
  });

  it('applies section break margins to subsequent pages', () => {
    const sectionBreakBlock: FlowBlock = {
      kind: 'sectionBreak',
      id: 'sb-1',
      margins: { header: 120, footer: 90 },
    };

    const blocks: FlowBlock[] = [
      { kind: 'paragraph', id: 'intro', runs: [] },
      sectionBreakBlock,
      { kind: 'paragraph', id: 'body', runs: [] },
    ];
    const measures: Measure[] = [makeMeasure([60]), { kind: 'sectionBreak' }, makeMeasure(Array(20).fill(40))];

    const options: LayoutOptions = {
      pageSize: { w: 400, h: 400 },
      margins: { top: 40, right: 30, bottom: 40, left: 30 },
    };

    const layout = layoutDocument(blocks, measures, options);

    expect(layout.pages.length).toBeGreaterThan(1);
    expect(layout.pages[0].margins).toMatchObject({ top: 40, bottom: 40 });
    const secondPage = layout.pages[1];
    // Without header content, body uses base margins. Header/footer distances are stored separately.
    expect(secondPage.margins).toMatchObject({ top: 40, bottom: 40, header: 120, footer: 90 });
    expect(secondPage.fragments[0].y).toBe(40);
  });

  it('applies section break left/right margins to subsequent pages', () => {
    const sectionBreakBlock: FlowBlock = {
      kind: 'sectionBreak',
      id: 'sb-1',
      margins: { left: 10, right: 50 },
    };

    const blocks: FlowBlock[] = [
      { kind: 'paragraph', id: 'intro', runs: [] },
      sectionBreakBlock,
      { kind: 'paragraph', id: 'body', runs: [] },
    ];
    const measures: Measure[] = [makeMeasure([60]), { kind: 'sectionBreak' }, makeMeasure(Array(20).fill(40))];

    const options: LayoutOptions = {
      pageSize: { w: 400, h: 400 },
      margins: { top: 40, right: 30, bottom: 40, left: 30 },
    };

    const layout = layoutDocument(blocks, measures, options);

    expect(layout.pages.length).toBeGreaterThan(1);
    const secondPage = layout.pages[1];
    expect(secondPage.margins).toMatchObject({ left: 10, right: 50 });
    const bodyFragment = secondPage.fragments.find((fragment) => fragment.blockId === 'body') as
      | ParaFragment
      | undefined;
    expect(bodyFragment).toBeDefined();
    expect(bodyFragment?.x).toBe(10);
  });

  it('handles consecutive section breaks with cumulative margin updates', () => {
    // Test that section breaks can update margins independently
    const section1: FlowBlock = {
      kind: 'sectionBreak',
      id: 'sb-1',
      margins: { header: 100 }, // Only update header
    };
    const section2: FlowBlock = {
      kind: 'sectionBreak',
      id: 'sb-2',
      margins: { footer: 120 }, // Only update footer
    };

    const blocks: FlowBlock[] = [
      { kind: 'paragraph', id: 'p1', runs: [] },
      section1,
      section2, // Both section breaks before any content
      { kind: 'paragraph', id: 'p2', runs: [] },
    ];

    const measures: Measure[] = [
      makeMeasure(Array(8).fill(40)), // p1: fills first page
      { kind: 'sectionBreak' },
      { kind: 'sectionBreak' },
      makeMeasure(Array(10).fill(40)), // p2: on next page with both margins applied
    ];

    const options: LayoutOptions = {
      pageSize: { w: 400, h: 400 },
      margins: { top: 40, right: 30, bottom: 40, left: 30 },
    };

    const layout = layoutDocument(blocks, measures, options);

    expect(layout.pages.length).toBeGreaterThanOrEqual(2);

    // Second page should have header/footer distances stored, but body uses base margins
    // without actual header/footer content
    const secondPage = layout.pages[1];
    expect(secondPage.margins?.top).toBe(40); // base margin (no header content)
    expect(secondPage.margins?.bottom).toBe(40); // base margin (no footer content)
    expect(secondPage.margins?.header).toBe(100); // from section1
    expect(secondPage.margins?.footer).toBe(120); // from section2
  });

  it('handles section break at page boundary', () => {
    const sectionBreakBlock: FlowBlock = {
      kind: 'sectionBreak',
      id: 'sb-1',
      margins: { header: 150, footer: 100 },
    };

    const blocks: FlowBlock[] = [
      { kind: 'paragraph', id: 'p1', runs: [] },
      { kind: 'paragraph', id: 'p2', runs: [] },
      sectionBreakBlock,
      { kind: 'paragraph', id: 'p3', runs: [] },
    ];

    const measures: Measure[] = [
      makeMeasure(Array(7).fill(40)), // p1: fills most of first page
      makeMeasure([40]), // p2: finishes first page, triggers page break
      { kind: 'sectionBreak' }, // section margins apply to next page
      makeMeasure([40]), // p3: on new page with section margins
    ];

    const options: LayoutOptions = {
      pageSize: { w: 400, h: 400 },
      margins: { top: 40, right: 30, bottom: 40, left: 30 },
    };

    const layout = layoutDocument(blocks, measures, options);

    // p3 appears on a new page with header/footer distances, body at base margins
    const pageWithP3 = layout.pages.find((p) => p.fragments.some((f) => f.blockId === 'p3'));
    expect(pageWithP3?.margins).toMatchObject({ top: 40, bottom: 40, header: 150, footer: 100 });
  });

  it('synthesizes page 1 for section-break-only body layouts', () => {
    const sectionBreakBlock: SectionBreakBlock = {
      kind: 'sectionBreak',
      id: 'sb-only',
      attrs: { isFirstSection: true, source: 'sectPr' },
      pageSize: { w: 500, h: 700 },
      orientation: 'landscape',
      margins: { top: 40, right: 30, bottom: 35, left: 25, header: 120, footer: 90 },
    };

    const layout = layoutDocument([sectionBreakBlock], [{ kind: 'sectionBreak' }], DEFAULT_OPTIONS);

    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0].fragments).toHaveLength(0);
    expect(layout.pages[0].orientation).toBe('landscape');
    expect(layout.pages[0].margins).toMatchObject({
      top: 40,
      right: 30,
      bottom: 35,
      left: 25,
      header: 120,
      footer: 90,
    });
  });

  it('uses leading source section geometry for page 1 even without the first-section marker', () => {
    const sectionBreakBlock: SectionBreakBlock = {
      kind: 'sectionBreak',
      id: 'sb-source',
      pageSize: { w: 793.73, h: 1122.53 },
      margins: { top: 113.4, right: 75.6, bottom: 94.53, left: 75.6, header: 0, footer: 3.8 },
    };
    const paragraph: FlowBlock = { kind: 'paragraph', id: 'p1', runs: [] };

    const layout = layoutDocument(
      [sectionBreakBlock, paragraph],
      [{ kind: 'sectionBreak' }, makeMeasure([20])],
      DEFAULT_OPTIONS,
    );

    expect(layout.pages[0].size).toEqual({ w: 793.73, h: 1122.53 });
    expect(layout.pages[0].margins).toMatchObject({
      top: 113.4,
      right: 75.6,
      bottom: 94.53,
      left: 75.6,
      header: 0,
      footer: 3.8,
    });
    expect(layout.pages[0].fragments[0]).toMatchObject({ blockId: 'p1', x: 75.6, y: 113.4 });
  });

  it('resets page numbering when synthesizing a next-page section-break-only layout', () => {
    const firstSection: SectionBreakBlock = {
      kind: 'sectionBreak',
      id: 'sb-first',
      attrs: { isFirstSection: true, source: 'sectPr', sectionIndex: 0 },
      pageSize: { w: 500, h: 700 },
      margins: { top: 40, right: 30, bottom: 35, left: 25 },
    };
    const nextPageSection: SectionBreakBlock = {
      kind: 'sectionBreak',
      id: 'sb-next',
      type: 'nextPage',
      attrs: { source: 'sectPr', sectionIndex: 1 },
      pageSize: { w: 520, h: 720 },
      margins: { top: 45, right: 35, bottom: 40, left: 30 },
    };

    const layout = layoutDocument(
      [firstSection, nextPageSection],
      [{ kind: 'sectionBreak' }, { kind: 'sectionBreak' }],
      DEFAULT_OPTIONS,
    );

    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0].number).toBe(1);
    expect(layout.pages[0].numberText).toBe('1');
    expect(layout.pages[0].sectionIndex).toBe(1);
    expect(layout.pages[0].margins).toMatchObject({
      top: 45,
      right: 35,
      bottom: 40,
      left: 30,
    });
  });

  it('resets parity bookkeeping when synthesizing an even-page section-break-only layout', () => {
    const firstSection: SectionBreakBlock = {
      kind: 'sectionBreak',
      id: 'sb-first',
      attrs: { isFirstSection: true, source: 'sectPr', sectionIndex: 0 },
      pageSize: { w: 500, h: 700 },
      margins: { top: 40, right: 30, bottom: 35, left: 25 },
    };
    const evenPageSection: SectionBreakBlock = {
      kind: 'sectionBreak',
      id: 'sb-even',
      type: 'evenPage',
      attrs: { source: 'sectPr', sectionIndex: 1 },
      pageSize: { w: 520, h: 720 },
      margins: { top: 45, right: 35, bottom: 40, left: 30 },
    };

    const layout = layoutDocument(
      [firstSection, evenPageSection],
      [{ kind: 'sectionBreak' }, { kind: 'sectionBreak' }],
      DEFAULT_OPTIONS,
    );

    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0].number).toBe(1);
    expect(layout.pages[0].numberText).toBe('1');
    expect(layout.pages[0].sectionIndex).toBe(1);
  });

  it('preserves explicit numbering starts for section-break-only fallback pages', () => {
    const firstSection: SectionBreakBlock = {
      kind: 'sectionBreak',
      id: 'sb-first',
      attrs: { isFirstSection: true, source: 'sectPr', sectionIndex: 0 },
      pageSize: { w: 500, h: 700 },
      margins: { top: 40, right: 30, bottom: 35, left: 25 },
    };
    const nextPageSection: SectionBreakBlock = {
      kind: 'sectionBreak',
      id: 'sb-next',
      type: 'nextPage',
      attrs: { source: 'sectPr', sectionIndex: 1 },
      pageSize: { w: 520, h: 720 },
      margins: { top: 45, right: 35, bottom: 40, left: 30 },
      numbering: { start: 5 },
    };

    const layout = layoutDocument(
      [firstSection, nextPageSection],
      [{ kind: 'sectionBreak' }, { kind: 'sectionBreak' }],
      DEFAULT_OPTIONS,
    );

    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0].number).toBe(1);
    expect(layout.pages[0].numberText).toBe('5');
    expect(layout.pages[0].sectionIndex).toBe(1);
  });

  it('section break with only header margin stores header distance', () => {
    const sectionBreakBlock: FlowBlock = {
      kind: 'sectionBreak',
      id: 'sb-1',
      margins: { header: 120 },
    };

    const blocks: FlowBlock[] = [
      { kind: 'paragraph', id: 'p1', runs: [] },
      sectionBreakBlock,
      { kind: 'paragraph', id: 'p2', runs: [] },
    ];

    const measures: Measure[] = [makeMeasure([60]), { kind: 'sectionBreak' }, makeMeasure(Array(10).fill(40))];

    const options: LayoutOptions = {
      pageSize: { w: 400, h: 400 },
      margins: { top: 40, right: 30, bottom: 40, left: 30 },
    };

    const layout = layoutDocument(blocks, measures, options);

    const secondPage = layout.pages[1];
    // Header distance is stored, but body starts at base top margin (no header content)
    expect(secondPage.margins?.top).toBe(40);
    expect(secondPage.margins?.bottom).toBe(40);
    expect(secondPage.margins?.header).toBe(120);
  });

  it('section break with only footer margin stores footer distance', () => {
    const sectionBreakBlock: FlowBlock = {
      kind: 'sectionBreak',
      id: 'sb-1',
      margins: { footer: 100 },
    };

    const blocks: FlowBlock[] = [
      { kind: 'paragraph', id: 'p1', runs: [] },
      sectionBreakBlock,
      { kind: 'paragraph', id: 'p2', runs: [] },
    ];

    const measures: Measure[] = [makeMeasure([60]), { kind: 'sectionBreak' }, makeMeasure(Array(10).fill(40))];

    const options: LayoutOptions = {
      pageSize: { w: 400, h: 400 },
      margins: { top: 40, right: 30, bottom: 40, left: 30 },
    };

    const layout = layoutDocument(blocks, measures, options);

    const secondPage = layout.pages[1];
    // Footer distance is stored, but body ends at base bottom margin (no footer content)
    expect(secondPage.margins?.top).toBe(40);
    expect(secondPage.margins?.bottom).toBe(40);
    expect(secondPage.margins?.footer).toBe(100);
  });

  it('respects minimum margins from document defaults', () => {
    const sectionBreakBlock: FlowBlock = {
      kind: 'sectionBreak',
      id: 'sb-1',
      margins: { header: 10, footer: 10 },
    };

    const blocks: FlowBlock[] = [
      { kind: 'paragraph', id: 'p1', runs: [] },
      sectionBreakBlock,
      { kind: 'paragraph', id: 'p2', runs: [] },
    ];

    const measures: Measure[] = [makeMeasure([60]), { kind: 'sectionBreak' }, makeMeasure(Array(10).fill(40))];

    const options: LayoutOptions = {
      pageSize: { w: 400, h: 400 },
      margins: { top: 50, right: 30, bottom: 50, left: 30 },
    };

    const layout = layoutDocument(blocks, measures, options);

    const secondPage = layout.pages[1];
    expect(secondPage.margins?.top).toBeGreaterThanOrEqual(50);
    expect(secondPage.margins?.bottom).toBeGreaterThanOrEqual(50);
  });

  describe('section type behavior', () => {
    it('continuous with requirePageBoundary: forces a page break (Word-style upgrade)', () => {
      const sectionBreak: FlowBlock = {
        kind: 'sectionBreak',
        id: 'sb-req',
        type: 'continuous',
        margins: { header: 100, footer: 80 },
        attrs: { requirePageBoundary: true },
      };

      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [] },
        sectionBreak,
        { kind: 'paragraph', id: 'p2', runs: [] },
      ];

      const measures: Measure[] = [makeMeasure([60]), { kind: 'sectionBreak' }, makeMeasure([40])];

      const options: LayoutOptions = {
        pageSize: { w: 400, h: 400 },
        margins: { top: 40, right: 30, bottom: 40, left: 30 },
      };

      const layout = layoutDocument(blocks, measures, options);
      // Should create 2 pages due to forced break from requirePageBoundary
      expect(layout.pages.length).toBe(2);
      expect(pageContainsBlock(layout.pages[0], 'p1')).toBe(true);
      expect(pageContainsBlock(layout.pages[1], 'p2')).toBe(true);

      // Header/footer distances apply, body uses base margins (no header/footer content)
      expect(layout.pages[1].margins).toMatchObject({ top: 40, bottom: 40, header: 100, footer: 80 });
    });
    it('continuous type: applies margins from next page without forcing break', () => {
      const sectionBreak: FlowBlock = {
        kind: 'sectionBreak',
        id: 'sb-1',
        type: 'continuous',
        margins: { header: 100, footer: 80 },
      };

      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [] },
        sectionBreak,
        { kind: 'paragraph', id: 'p2', runs: [] },
      ];

      const measures: Measure[] = [
        makeMeasure([60]), // Small paragraph
        { kind: 'sectionBreak' },
        makeMeasure([40]), // Another small paragraph
      ];

      const options: LayoutOptions = {
        pageSize: { w: 400, h: 400 },
        margins: { top: 40, right: 30, bottom: 40, left: 30 },
      };

      const layout = layoutDocument(blocks, measures, options);

      // Should fit on one page since continuous doesn't force break
      expect(layout.pages.length).toBe(1);
      expect(layout.pages[0].fragments).toHaveLength(2); // p1 and p2 both on page 1
      expect(layout.pages[0].margins).toMatchObject({ top: 40, bottom: 40 }); // Original margins

      // If there was a second page, it would have the new margins
      // (test this with content that overflows)
    });

    it('nextPage type: forces a page break', () => {
      const sectionBreak: FlowBlock = {
        kind: 'sectionBreak',
        id: 'sb-1',
        type: 'nextPage',
        margins: { header: 100, footer: 80 },
      };

      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [] },
        sectionBreak,
        { kind: 'paragraph', id: 'p2', runs: [] },
      ];

      const measures: Measure[] = [makeMeasure([60]), { kind: 'sectionBreak' }, makeMeasure([40])];

      const options: LayoutOptions = {
        pageSize: { w: 400, h: 400 },
        margins: { top: 40, right: 30, bottom: 40, left: 30 },
      };

      const layout = layoutDocument(blocks, measures, options);

      // Should create 2 pages due to forced break
      expect(layout.pages.length).toBe(2);
      expect(layout.pages[0].fragments.some((f) => f.blockId === 'p1')).toBe(true);
      expect(layout.pages[1].fragments.some((f) => f.blockId === 'p2')).toBe(true);

      // Header/footer distances apply, body uses base margins
      expect(layout.pages[1].margins).toMatchObject({ top: 40, bottom: 40, header: 100, footer: 80 });
    });

    it.each([
      { requiredPageParity: 'odd', expectedPage: 3 },
      { requiredPageParity: 'even', expectedPage: 2 },
    ] as const)(
      'aligns nextPage content to $requiredPageParity parity when an odd/even header restart requires it',
      ({ requiredPageParity, expectedPage }) => {
        const sectionBreak: FlowBlock = {
          kind: 'sectionBreak',
          id: `sb-next-${requiredPageParity}`,
          type: 'nextPage',
          margins: {},
          numbering: { start: requiredPageParity === 'odd' ? 11 : 12 },
          requiredPageParity,
          attrs: { source: 'sectPr', sectionIndex: 1 },
        };
        const blocks: FlowBlock[] = [
          { kind: 'paragraph', id: 'p1', runs: [] },
          sectionBreak,
          { kind: 'paragraph', id: 'p2', runs: [] },
        ];
        const measures: Measure[] = [makeMeasure([40]), { kind: 'sectionBreak' }, makeMeasure([40])];

        const layout = layoutDocument(blocks, measures, {
          pageSize: { w: 400, h: 400 },
          margins: { top: 40, right: 30, bottom: 40, left: 30 },
        });

        const pageWithP2 = layout.pages.find((page) => page.fragments.some((fragment) => fragment.blockId === 'p2'));
        expect(pageWithP2?.number).toBe(expectedPage);
        expect(layout.pages).toHaveLength(expectedPage);
        if (requiredPageParity === 'odd') {
          expect(layout.pages[1]).toMatchObject({
            number: 2,
            sectionIndex: 0,
            suppressHeaderFooter: true,
          });
          expect(layout.pages[1]?.fragments).toEqual([]);
          expect(pageWithP2).toMatchObject({
            sectionIndex: 1,
            sectionPageNumber: 1,
            displayNumber: 11,
          });
        } else {
          expect(pageWithP2).toMatchObject({
            sectionIndex: 1,
            sectionPageNumber: 1,
            displayNumber: 12,
          });
          expect(pageWithP2?.suppressHeaderFooter).toBeUndefined();
        }
      },
    );

    it('does not insert a parity filler after a fixed-height cover table when restart numbering has no physical parity requirement', () => {
      const sectionBreak: FlowBlock = {
        kind: 'sectionBreak',
        id: 'sb-cover-to-body',
        type: 'nextPage',
        margins: { top: 40, right: 30, bottom: 40, left: 30 },
        numbering: { start: 11 },
        attrs: { source: 'sectPr', sectionIndex: 1 },
      };
      const blocks: FlowBlock[] = [
        makeTableBlock('cover-table', 1),
        sectionBreak,
        { kind: 'paragraph', id: 'second-section-body', runs: [{ text: 'Second section' }] },
      ];
      const measures: Measure[] = [makeTableMeasure([340], [320]), { kind: 'sectionBreak' }, makeMeasure([40])];

      const layout = layoutDocument(blocks, measures, {
        pageSize: { w: 400, h: 400 },
        margins: { top: 40, right: 30, bottom: 40, left: 30 },
        alternateHeaders: true,
      });

      expect(layout.pages).toHaveLength(2);
      expect(pageContainsBlock(layout.pages[0]!, 'cover-table')).toBe(true);
      expect(pageContainsBlock(layout.pages[1]!, 'second-section-body')).toBe(true);
      expect(layout.pages[1]).toMatchObject({
        number: 2,
        sectionIndex: 1,
        sectionPageNumber: 1,
        displayNumber: 11,
      });
      expect(layout.pages[1]?.suppressHeaderFooter).toBeUndefined();
    });

    it('evenPage type: forces break to even page number', () => {
      const sectionBreak: FlowBlock = {
        kind: 'sectionBreak',
        id: 'sb-1',
        type: 'evenPage',
        margins: { header: 120, footer: 90 },
      };

      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [] },
        sectionBreak,
        { kind: 'paragraph', id: 'p2', runs: [] },
      ];

      const measures: Measure[] = [makeMeasure([60]), { kind: 'sectionBreak' }, makeMeasure([40])];

      const options: LayoutOptions = {
        pageSize: { w: 400, h: 400 },
        margins: { top: 40, right: 30, bottom: 40, left: 30 },
      };

      const layout = layoutDocument(blocks, measures, options);

      // p1 is on page 1 (odd), section break requires even page
      // Should insert blank page 2, content on page 2
      expect(layout.pages.length).toBeGreaterThanOrEqual(2);

      const pageWithP2 = layout.pages.find((p) => p.fragments.some((f) => f.blockId === 'p2'));
      expect(pageWithP2).toBeDefined();
      expect(pageWithP2!.number % 2).toBe(0); // Must be even
      expect(pageWithP2!.margins).toMatchObject({ top: 40, bottom: 40, header: 120, footer: 90 });
    });

    it('oddPage type: forces break to odd page number', () => {
      const sectionBreak: FlowBlock = {
        kind: 'sectionBreak',
        id: 'sb-1',
        type: 'oddPage',
        margins: { header: 110, footer: 85 },
      };

      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [] },
        { kind: 'paragraph', id: 'p1b', runs: [] },
        sectionBreak,
        { kind: 'paragraph', id: 'p2', runs: [] },
      ];

      const measures: Measure[] = [
        makeMeasure(Array(8).fill(40)), // Fill page 1
        makeMeasure([40]), // Start page 2 (even)
        { kind: 'sectionBreak' },
        makeMeasure([40]),
      ];

      const options: LayoutOptions = {
        pageSize: { w: 400, h: 400 },
        margins: { top: 40, right: 30, bottom: 40, left: 30 },
      };

      const layout = layoutDocument(blocks, measures, options);

      // p1 fills page 1, p1b starts page 2 (even), oddPage break needs page 3 (odd)
      const pageWithP2 = layout.pages.find((p) => p.fragments.some((f) => f.blockId === 'p2'));
      expect(pageWithP2).toBeDefined();
      expect(pageWithP2!.number % 2).toBe(1); // Must be odd
      expect(pageWithP2!.margins).toMatchObject({ top: 40, bottom: 40, header: 110, footer: 85 });
    });

    it('parity edge case: evenPage from odd page inserts blank', () => {
      const sectionBreak: FlowBlock = {
        kind: 'sectionBreak',
        id: 'sb-1',
        type: 'evenPage',
        margins: { header: 100, footer: 80 },
      };

      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [] },
        sectionBreak,
        { kind: 'paragraph', id: 'p2', runs: [] },
      ];

      const measures: Measure[] = [makeMeasure([40]), { kind: 'sectionBreak' }, makeMeasure([40])];

      const options: LayoutOptions = {
        pageSize: { w: 400, h: 400 },
        margins: { top: 40, right: 30, bottom: 40, left: 30 },
      };

      const layout = layoutDocument(blocks, measures, options);

      // Page 1 (odd) has p1, evenPage break should create page 2 (even) for p2
      expect(layout.pages.length).toBe(2);
      expect(layout.pages[1].number).toBe(2); // Even page
      expect(layout.pages[1].fragments.some((f) => f.blockId === 'p2')).toBe(true);
    });

    it('parity edge case: oddPage from even page inserts blank', () => {
      const sectionBreak: FlowBlock = {
        kind: 'sectionBreak',
        id: 'sb-1',
        type: 'oddPage',
        margins: { header: 100, footer: 80 },
      };

      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [] },
        { kind: 'paragraph', id: 'p1b', runs: [] },
        sectionBreak,
        { kind: 'paragraph', id: 'p2', runs: [] },
      ];

      const measures: Measure[] = [
        makeMeasure(Array(8).fill(40)), // Fill page 1
        makeMeasure([40]), // Start page 2 (even)
        { kind: 'sectionBreak' },
        makeMeasure([40]),
      ];

      const options: LayoutOptions = {
        pageSize: { w: 400, h: 400 },
        margins: { top: 40, right: 30, bottom: 40, left: 30 },
      };

      const layout = layoutDocument(blocks, measures, options);

      // p1 on page 1, p1b on page 2 (even), oddPage needs page 3 (odd)
      expect(layout.pages.length).toBe(3);
      expect(layout.pages[2].number).toBe(3); // Odd page
      expect(layout.pages[2].fragments.some((f) => f.blockId === 'p2')).toBe(true);
    });
  });

  describe('page size and orientation', () => {
    it('applies per-page size from section break', () => {
      const sectionBreak: FlowBlock = {
        kind: 'sectionBreak',
        id: 'sb-1',
        type: 'nextPage',
        pageSize: { w: 600, h: 400 }, // Landscape
        margins: {},
      };

      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [] },
        sectionBreak,
        { kind: 'paragraph', id: 'p2', runs: [] },
      ];

      const measures: Measure[] = [makeMeasure([40]), { kind: 'sectionBreak' }, makeMeasure([40])];

      const options: LayoutOptions = {
        pageSize: { w: 400, h: 600 }, // Portrait default
        margins: { top: 40, right: 30, bottom: 40, left: 30 },
      };

      const layout = layoutDocument(blocks, measures, options);

      // p1 on page 1 with default size (portrait)
      expect(layout.pages[0].size).toBeUndefined(); // Same as global default
      expect(layout.pageSize).toEqual({ w: 400, h: 600 });

      // p2 on page 2 with landscape size
      expect(layout.pages[1].size).toEqual({ w: 600, h: 400 });
    });

    it('handles portrait to landscape to portrait transitions', () => {
      const toLandscape: FlowBlock = {
        kind: 'sectionBreak',
        id: 'sb-1',
        type: 'nextPage',
        pageSize: { w: 792, h: 612 }, // 11" x 8.5" landscape
        orientation: 'landscape',
        margins: {},
      };

      const toPortrait: FlowBlock = {
        kind: 'sectionBreak',
        id: 'sb-2',
        type: 'nextPage',
        pageSize: { w: 612, h: 792 }, // 8.5" x 11" portrait
        orientation: 'portrait',
        margins: {},
      };

      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [] }, // Portrait page
        toLandscape,
        { kind: 'paragraph', id: 'p2', runs: [] }, // Landscape page
        toPortrait,
        { kind: 'paragraph', id: 'p3', runs: [] }, // Back to portrait
      ];

      const measures: Measure[] = [
        makeMeasure([40]),
        { kind: 'sectionBreak' },
        makeMeasure([40]),
        { kind: 'sectionBreak' },
        makeMeasure([40]),
      ];

      const options: LayoutOptions = {
        pageSize: { w: 612, h: 792 }, // Letter portrait
        margins: { top: 40, right: 30, bottom: 40, left: 30 },
      };

      const layout = layoutDocument(blocks, measures, options);

      expect(layout.pages.length).toBe(3);

      // Page 1: default portrait (no size override)
      expect(layout.pages[0].size).toBeUndefined();

      // Page 2: landscape
      expect(layout.pages[1].size).toEqual({ w: 792, h: 612 });

      // Page 3: back to portrait (matches global default, so no size override)
      expect(layout.pages[2].size).toBeUndefined();
    });

    it('applies page size changes with continuous type from next page', () => {
      const sectionBreak: FlowBlock = {
        kind: 'sectionBreak',
        id: 'sb-1',
        type: 'continuous', // Should not force break, but applies size from next page
        pageSize: { w: 500, h: 700 },
        margins: {},
      };

      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [] },
        sectionBreak,
        { kind: 'paragraph', id: 'p2', runs: [] },
      ];

      const measures: Measure[] = [
        makeMeasure(Array(13).fill(40)), // Fill first page (content height = 600 - 80 margins = 520, 520/40 = 13 lines)
        { kind: 'sectionBreak' },
        makeMeasure([40]), // This will go to next page
      ];

      const options: LayoutOptions = {
        pageSize: { w: 400, h: 600 },
        margins: { top: 40, right: 30, bottom: 40, left: 30 },
      };

      const layout = layoutDocument(blocks, measures, options);

      expect(layout.pages.length).toBe(2);

      // First page uses default size
      expect(layout.pages[0].size).toBeUndefined();

      // Second page uses new size (from section break)
      expect(layout.pages[1].size).toEqual({ w: 500, h: 700 });
    });

    it('applies next section properties at end-tagged breaks (DOCX sectPr semantics)', () => {
      // Simulate DOCX-derived breaks: break A ends section 1, break B defines next section (landscape)
      const p1: FlowBlock = { kind: 'paragraph', id: 'p1', runs: [] };
      const endSection1: SectionBreakBlock = {
        kind: 'sectionBreak',
        id: 'sb-1',
        type: 'nextPage',
        attrs: { source: 'sectPr' },
        margins: {},
      };
      const startSection2: SectionBreakBlock = {
        kind: 'sectionBreak',
        id: 'sb-2',
        type: 'nextPage',
        attrs: { source: 'sectPr' },
        pageSize: { w: 792, h: 612 },
        orientation: 'landscape',
        margins: {},
      };
      const p2: FlowBlock = { kind: 'paragraph', id: 'p2', runs: [] };

      const blocks = [p1, endSection1, startSection2, p2];
      const measures: Measure[] = [
        makeMeasure([40]),
        { kind: 'sectionBreak' },
        { kind: 'sectionBreak' },
        makeMeasure([40]),
      ];

      const options: LayoutOptions = {
        pageSize: { w: 612, h: 792 }, // Letter portrait
        margins: { top: 40, right: 30, bottom: 40, left: 30 },
      };

      const layout = layoutDocument(blocks, measures, options);
      expect(layout.pages.length).toBe(2);
      // Page 2 (created after endSection1) should use startSection2 properties (landscape)
      expect(layout.pages[1].size).toEqual({ w: 792, h: 612 });
    });
  });

  describe('multi-column sections', () => {
    it('applies column configuration from section break', () => {
      const sectionBreak: FlowBlock = {
        kind: 'sectionBreak',
        id: 'sb-1',
        type: 'nextPage',
        columns: { count: 2, gap: 48 }, // 2 columns, 0.5" gap
        margins: {},
      };

      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [] },
        sectionBreak,
        { kind: 'paragraph', id: 'p2', runs: [] },
      ];

      const measures: Measure[] = [
        makeMeasure([40]),
        { kind: 'sectionBreak' },
        makeMeasure([350, 350]), // Two tall lines that will flow into columns
      ];

      const options: LayoutOptions = {
        pageSize: { w: 612, h: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
      };

      const layout = layoutDocument(blocks, measures, options);

      // Page 1: single column (default)
      const p1Fragment = layout.pages[0].fragments.find((f) => f.blockId === 'p1');
      expect(p1Fragment?.x).toBe(72); // Left margin
      expect(p1Fragment?.width).toBe(468); // Full content width

      // Page 2: two columns
      const page2 = layout.pages[1];
      const p2Fragments = page2.fragments.filter((f) => f.blockId === 'p2');
      expect(p2Fragments.length).toBe(2); // Two fragments for two columns

      // Column width = (612 - 72*2 - 48) / 2 = 210
      expect(p2Fragments[0].x).toBe(72); // First column
      expect(p2Fragments[1].x).toBe(72 + 210 + 48); // Second column (left + width + gap)
      expect(p2Fragments[0].width).toBe(210);
      expect(p2Fragments[1].width).toBe(210);
    });

    it('schedules column changes with continuous section breaks', () => {
      const toTwoColumns: FlowBlock = {
        kind: 'sectionBreak',
        id: 'sb-1',
        type: 'continuous',
        columns: { count: 2, gap: 48 },
        margins: {},
      };

      // Use nextPage to force p3 to start on page 2, preserving 2-column layout
      const forceBreak: FlowBlock = {
        kind: 'sectionBreak',
        id: 'sb-force',
        type: 'nextPage',
        columns: { count: 2, gap: 48 }, // Must explicitly specify columns per OOXML spec
        margins: {},
      };

      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [] },
        toTwoColumns,
        { kind: 'paragraph', id: 'p2', runs: [] },
        forceBreak, // Force page break so p3 starts fresh
        { kind: 'paragraph', id: 'p3', runs: [] },
      ];

      const measures: Measure[] = [
        makeMeasure([40]),
        { kind: 'sectionBreak' },
        makeMeasure([40]),
        { kind: 'sectionBreak' },
        makeMeasure([350, 350]), // Spans columns on page 2
      ];

      const options: LayoutOptions = {
        pageSize: { w: 612, h: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
      };

      const layout = layoutDocument(blocks, measures, options);

      // Page 1: p1 in single column, p2 in two columns (Phase 3B mid-page change)
      const page1 = layout.pages[0];
      const p1Fragments = page1.fragments.filter((f) => f.blockId === 'p1');
      const p2Fragments = page1.fragments.filter((f) => f.blockId === 'p2');
      expect(p1Fragments[0].width).toBe(468); // Single column
      expect(p2Fragments[0].width).toBe(210); // Two columns (mid-page change!)

      // Page 2: p3 with two columns (continues from previous region)
      const page2 = layout.pages[1];
      const p3Fragments = page2.fragments.filter((f) => f.blockId === 'p3');
      expect(p3Fragments[0].width).toBe(210); // Column width
    });

    it('handles single to multi-column to single transitions', () => {
      const toTwoColumns: FlowBlock = {
        kind: 'sectionBreak',
        id: 'sb-1',
        type: 'nextPage',
        columns: { count: 2, gap: 48 },
        margins: {},
      };

      const backToSingleColumn: FlowBlock = {
        kind: 'sectionBreak',
        id: 'sb-2',
        type: 'nextPage',
        columns: { count: 1, gap: 0 },
        margins: {},
      };

      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [] },
        toTwoColumns,
        { kind: 'paragraph', id: 'p2', runs: [] },
        backToSingleColumn,
        { kind: 'paragraph', id: 'p3', runs: [] },
      ];

      const measures: Measure[] = [
        makeMeasure([40]),
        { kind: 'sectionBreak' },
        makeMeasure([40]),
        { kind: 'sectionBreak' },
        makeMeasure([40]),
      ];

      const options: LayoutOptions = {
        pageSize: { w: 612, h: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
      };

      const layout = layoutDocument(blocks, measures, options);

      expect(layout.pages.length).toBe(3);

      // Page 1: single
      const p1 = layout.pages[0].fragments[0];
      expect(p1.width).toBe(468); // Full content width

      // Page 2: two columns
      const p2 = layout.pages[1].fragments[0];
      expect(p2.width).toBe(210); // Column width

      // Page 3: back to single
      const p3 = layout.pages[2].fragments[0];
      expect(p3.width).toBe(468); // Full content width again
    });
  });

  describe('Phase 3B: mid-page column changes', () => {
    it('changes columns mid-page with continuous section break', () => {
      const toTwoColumns: FlowBlock = {
        kind: 'sectionBreak',
        id: 'sb-1',
        type: 'continuous',
        columns: { count: 2, gap: 48 },
        margins: {},
      };

      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [] },
        toTwoColumns,
        { kind: 'paragraph', id: 'p2', runs: [], attrs: { widowControl: false } },
      ];

      const measures: Measure[] = [
        makeMeasure([40]), // p1: single small line
        { kind: 'sectionBreak' },
        makeMeasure([350, 350]), // p2: two tall lines that will flow into columns
      ];

      const options: LayoutOptions = {
        pageSize: { w: 612, h: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
      };

      const layout = layoutDocument(blocks, measures, options);

      // Should be on same page (mid-page region change)
      expect(layout.pages.length).toBe(1);

      const page = layout.pages[0];

      // p1 should be full width (single column)
      const p1Fragments = page.fragments.filter((f) => f.blockId === 'p1');
      expect(p1Fragments[0].width).toBe(468); // Full width

      // p2 should be in two columns (mid-page region)
      const p2Fragments = page.fragments.filter((f) => f.blockId === 'p2');
      expect(p2Fragments.length).toBe(2); // Two fragments for two columns

      // Column width = (612 - 72*2 - 48) / 2 = 210
      expect(p2Fragments[0].width).toBe(210); // First column
      expect(p2Fragments[1].width).toBe(210); // Second column

      // Verify X positions
      expect(p2Fragments[0].x).toBe(72); // First column
      expect(p2Fragments[1].x).toBe(72 + 210 + 48); // Second column
    });

    it('handles multiple mid-page column changes', () => {
      const toTwoColumns: FlowBlock = {
        kind: 'sectionBreak',
        id: 'sb-1',
        type: 'continuous',
        columns: { count: 2, gap: 48 },
        margins: {},
      };

      const toThreeColumns: FlowBlock = {
        kind: 'sectionBreak',
        id: 'sb-2',
        type: 'continuous',
        columns: { count: 3, gap: 24 },
        margins: {},
      };

      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [] },
        toTwoColumns,
        { kind: 'paragraph', id: 'p2', runs: [] },
        toThreeColumns,
        { kind: 'paragraph', id: 'p3', runs: [] },
      ];

      const measures: Measure[] = [
        makeMeasure([40]),
        { kind: 'sectionBreak' },
        makeMeasure([40]),
        { kind: 'sectionBreak' },
        makeMeasure([40]),
      ];

      const options: LayoutOptions = {
        pageSize: { w: 612, h: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
      };

      const layout = layoutDocument(blocks, measures, options);

      const page = layout.pages[0];

      // p1: single column
      const p1 = page.fragments.find((f) => f.blockId === 'p1');
      expect(p1?.width).toBe(468); // Full width

      // p2: two columns
      const p2 = page.fragments.find((f) => f.blockId === 'p2');
      expect(p2?.width).toBe(210); // (468 - 48) / 2

      // p3: three columns
      const p3 = page.fragments.find((f) => f.blockId === 'p3');
      // (468 - 24*2) / 3 = 420 / 3 = 140
      expect(p3?.width).toBe(140);
    });

    it('nextPage section break still forces page break with columns', () => {
      const toTwoColumns: FlowBlock = {
        kind: 'sectionBreak',
        id: 'sb-1',
        type: 'nextPage',
        columns: { count: 2, gap: 48 },
        margins: {},
      };

      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [] },
        toTwoColumns,
        { kind: 'paragraph', id: 'p2', runs: [] },
      ];

      const measures: Measure[] = [makeMeasure([40]), { kind: 'sectionBreak' }, makeMeasure([40])];

      const options: LayoutOptions = {
        pageSize: { w: 612, h: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
      };

      const layout = layoutDocument(blocks, measures, options);

      // nextPage should still force a page break (not mid-page)
      expect(layout.pages.length).toBe(2);

      // Page 1: p1 in single column
      const p1 = layout.pages[0].fragments[0];
      expect(p1.width).toBe(468);

      // Page 2: p2 in two columns
      const p2 = layout.pages[1].fragments[0];
      expect(p2.width).toBe(210);
    });

    it("regression: first section break uses its own properties, not next section's", () => {
      // This is the exact bug that was fixed: first section break was getting the NEXT
      // section's column configuration instead of its own
      const firstPara: FlowBlock = { kind: 'paragraph', id: 'p1', runs: [] };
      const secondPara: FlowBlock = { kind: 'paragraph', id: 'p2', runs: [] };
      const thirdPara: FlowBlock = { kind: 'paragraph', id: 'p3', runs: [] };

      const blocks: FlowBlock[] = [
        // First section break: single column (columns: null or undefined)
        {
          kind: 'sectionBreak',
          id: 'first',
          type: 'continuous',
          margins: {},
          attrs: { source: 'sectPr', isFirstSection: true },
        } as FlowBlock,
        firstPara,
        secondPara,
        // Second section break: two columns
        {
          kind: 'sectionBreak',
          id: 'second',
          type: 'continuous',
          columns: { count: 2, gap: 48 },
          margins: {},
          attrs: { source: 'sectPr' },
        } as FlowBlock,
        thirdPara,
      ];

      const measures: Measure[] = [
        { kind: 'sectionBreak' },
        makeMeasure([40]),
        makeMeasure([40]),
        { kind: 'sectionBreak' },
        makeMeasure([40]),
      ];

      const options: LayoutOptions = {
        pageSize: { w: 612, h: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
      };

      const layout = layoutDocument(blocks, measures, options);

      // BUG WAS: First paragraph would be in 2-column mode (width ~210)
      // FIX: First paragraph should be in single-column mode (full width ~468)
      const p1Fragment = layout.pages[0].fragments.find((f) => f.kind === 'para' && f.blockId === 'p1');
      expect(p1Fragment).toBeDefined();
      expect(p1Fragment?.width).toBe(468); // Full width = single column

      // Second paragraph should still be single column
      const p2Fragment = layout.pages[0].fragments.find((f) => f.kind === 'para' && f.blockId === 'p2');
      expect(p2Fragment).toBeDefined();
      expect(p2Fragment?.width).toBe(468);

      // Third paragraph should be in 2-column mode after the column change
      const p3Fragment = layout.pages[0].fragments.find((f) => f.kind === 'para' && f.blockId === 'p3');
      expect(p3Fragment).toBeDefined();
      expect(p3Fragment?.width).toBe(210); // Half width = two columns
    });

    it('starts new region below tallest column when columns have unequal heights', () => {
      // Regression test for SD-1869: when a multi-column section has unequal column
      // heights, the next region must start below the TALLEST column, not the last
      // column's cursor. Without the maxCursorY fix, the new region would start at
      // the shorter column's bottom, overlapping the taller one.
      //
      // Uses a 3-col → 2-col transition because the layout engine forces a new page
      // when reducing to fewer columns than the current column index (guard at
      // columnIndexBefore >= newColumns.count). With 3→2, content in col1
      // (columnIndex=1) stays on the same page (1 < 2).
      const toThreeColumns: FlowBlock = {
        kind: 'sectionBreak',
        id: 'sb-to-3col',
        type: 'continuous',
        columns: { count: 3, gap: 24 },
        margins: {},
      };
      const toTwoColumns: FlowBlock = {
        kind: 'sectionBreak',
        id: 'sb-to-2col',
        type: 'continuous',
        columns: { count: 2, gap: 48 },
        margins: {},
      };

      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [] }, // single column preamble
        toThreeColumns,
        { kind: 'paragraph', id: 'p-cols', runs: [], attrs: { widowControl: false } }, // 3 lines → col0 gets 2, col1 gets 1
        toTwoColumns,
        { kind: 'paragraph', id: 'p-after', runs: [] }, // must start below tallest column
      ];

      // p-cols: 3 lines of 250px each (750px total)
      // Available column height = 720 (page bottom) - 112 (region top) = 608px
      // Column 0 fits lines 0+1 (500px), line 2 overflows to column 1
      // Column 0 bottom = 112 + 500 = 612
      // Column 1 bottom = 112 + 250 = 362
      const measures: Measure[] = [
        makeMeasure([40]), // p1
        { kind: 'sectionBreak' },
        makeMeasure([250, 250, 250]), // p-cols: 3 lines, 2 in col0 + 1 in col1
        { kind: 'sectionBreak' },
        makeMeasure([40]), // p-after
      ];

      const options: LayoutOptions = {
        pageSize: { w: 612, h: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
      };

      const layout = layoutDocument(blocks, measures, options);

      // Everything should fit on one page
      expect(layout.pages.length).toBe(1);

      // p1 at y=72, height=40 → region for 3-col section starts at y=112
      const regionTop = 72 + 40; // 112

      // Column 0: 2 lines × 250px = 500px → bottom at 112 + 500 = 612
      // Column 1: 1 line × 250px = 250px → bottom at 112 + 250 = 362
      const tallestColumnBottom = regionTop + 500; // 612

      const page = layout.pages[0];
      const pAfter = page.fragments.find((f) => f.blockId === 'p-after');
      expect(pAfter).toBeDefined();

      // KEY ASSERTION: p-after must start at or below the tallest column's bottom (612)
      // Without the fix, it would start at 362 (column 1's bottom), overlapping column 0
      expect(pAfter!.y).toBeGreaterThanOrEqual(tallestColumnBottom);
    });

    it('keeps an unequal-width column reduction on the same page when the break is continuous', () => {
      const toThreeUnequalColumns: FlowBlock = {
        kind: 'sectionBreak',
        id: 'sb-to-3-unequal',
        type: 'continuous',
        columns: {
          count: 3,
          gap: 24,
          equalWidth: false,
          widths: [120, 160, 284],
          gaps: [24, 24],
        },
        margins: {},
        attrs: { source: 'sectPr', sectionIndex: 0, isFirstSection: true },
      } as FlowBlock;
      const toOneColumn: FlowBlock = {
        kind: 'sectionBreak',
        id: 'sb-to-1',
        type: 'continuous',
        columns: { count: 1, gap: 0 },
        margins: {},
        attrs: { source: 'sectPr', sectionIndex: 1 },
      } as FlowBlock;
      const blocks: FlowBlock[] = [
        toThreeUnequalColumns,
        { kind: 'paragraph', id: 'p-cols', runs: [], attrs: { sectionIndex: 0, widowControl: false } },
        toOneColumn,
        { kind: 'paragraph', id: 'p-after', runs: [], attrs: { sectionIndex: 1 } },
      ];
      const measures: Measure[] = [
        { kind: 'sectionBreak' },
        makeMeasure([500, 500, 500, 500, 500]),
        { kind: 'sectionBreak' },
        makeMeasure([20]),
      ];

      const layout = layoutDocument(blocks, measures, {
        pageSize: { w: 816, h: 1200 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
      });

      expect(layout.pages).toHaveLength(1);
      const page = layout.pages[0];
      const columnFragments = page.fragments.filter(
        (fragment): fragment is ParaFragment => fragment.kind === 'para' && fragment.blockId === 'p-cols',
      );
      expect(columnFragments.some((fragment) => fragment.x > 72 + 120 + 24 + 160)).toBe(true);
      const after = page.fragments.find(
        (fragment): fragment is ParaFragment => fragment.kind === 'para' && fragment.blockId === 'p-after',
      );
      expect(after).toBeDefined();
      expect(after!.y).toBeGreaterThanOrEqual(Math.max(...columnFragments.map((fragment) => fragment.y)));
    });

    it('does not allocate line height to an invisible continuous sectPr carrier', () => {
      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'before', runs: [], attrs: { sectionIndex: 0 } },
        {
          kind: 'paragraph',
          id: 'sectPr-carrier',
          runs: [],
          attrs: { sectionIndex: 0, sectPrMarker: true },
        },
        {
          kind: 'sectionBreak',
          id: 'continuous-boundary',
          type: 'continuous',
          columns: { count: 2, gap: 24, equalWidth: false, widths: [120, 300], gaps: [24] },
          margins: {},
          attrs: { source: 'sectPr', sectionIndex: 1 },
        } as FlowBlock,
        { kind: 'paragraph', id: 'after', runs: [], attrs: { sectionIndex: 1 } },
      ];
      const measures: Measure[] = [makeMeasure([20]), makeMeasure([80]), { kind: 'sectionBreak' }, makeMeasure([20])];

      const layout = layoutDocument(blocks, measures, {
        pageSize: { w: 612, h: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
      });

      expect(layout.pages).toHaveLength(1);
      expect(layout.pages[0].fragments.some((fragment) => fragment.blockId === 'sectPr-carrier')).toBe(false);
      const before = layout.pages[0].fragments.find((fragment) => fragment.blockId === 'before');
      const after = layout.pages[0].fragments.find((fragment) => fragment.blockId === 'after');
      expect(after?.y).toBe((before?.y ?? 0) + 20);
    });
  });

  describe('columnBreak with multi-column pages', () => {
    it('advances to next column when not in last column', () => {
      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [] },
        { kind: 'columnBreak', id: 'br-1' } as ColumnBreakBlock,
        { kind: 'paragraph', id: 'p2', runs: [] },
      ];

      const measures: Measure[] = [makeMeasure([40]), { kind: 'columnBreak' }, makeMeasure([40])];

      const options: LayoutOptions = {
        pageSize: { w: 612, h: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
        columns: { count: 2, gap: 48 },
      };

      const layout = layoutDocument(blocks, measures, options);

      const page = layout.pages[0];
      const p1 = page.fragments.find((f) => f.blockId === 'p1') as ParaFragment;
      const p2 = page.fragments.find((f) => f.blockId === 'p2') as ParaFragment;
      const columnWidth =
        (options.pageSize!.w - (options.margins!.left + options.margins!.right) - options.columns!.gap) / 2;

      // p1 in first column
      expect(p1.x).toBeCloseTo(options.margins!.left);
      // p2 should begin at top of second column after the column break
      expect(p2.x).toBeCloseTo(options.margins!.left + columnWidth + options.columns!.gap);
      expect(p2.y).toBe(options.margins!.top);
    });

    it('treats the last resolved column as last for column breaks when w:num exceeds widths (SD-2629)', () => {
      // count:4 but two explicit widths -> resolved count 2. The first break moves to column 1 (the
      // last resolved column); the second must start a new page, NOT advance into a phantom column
      // 2. Mirror of the advanceColumn fix for explicit <w:br w:type="column"> handling.
      const blocks: FlowBlock[] = [
        { kind: 'columnBreak', id: 'br-1' } as ColumnBreakBlock,
        { kind: 'columnBreak', id: 'br-2' } as ColumnBreakBlock,
        { kind: 'paragraph', id: 'p2', runs: [] },
      ];

      const measures: Measure[] = [{ kind: 'columnBreak' }, { kind: 'columnBreak' }, makeMeasure([40])];

      const options: LayoutOptions = {
        pageSize: { w: 612, h: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
        columns: { count: 4, gap: 48, widths: [192, 384], equalWidth: false },
      };

      const layout = layoutDocument(blocks, measures, options);

      expect(layout.pages.length).toBe(2);
      const p2 = layout.pages[1].fragments.find((f) => f.blockId === 'p2') as ParaFragment;
      expect(p2.x).toBeCloseTo(options.margins!.left);
      expect(p2.y).toBe(options.margins!.top);
    });

    it('starts a new page when columnBreak occurs in last column', () => {
      const blocks: FlowBlock[] = [
        // First columnBreak moves to column 2, second starts a new page
        { kind: 'columnBreak', id: 'br-1' } as ColumnBreakBlock,
        { kind: 'columnBreak', id: 'br-2' } as ColumnBreakBlock,
        { kind: 'paragraph', id: 'p2', runs: [] },
      ];

      const measures: Measure[] = [{ kind: 'columnBreak' }, { kind: 'columnBreak' }, makeMeasure([40])];

      const options: LayoutOptions = {
        pageSize: { w: 612, h: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
        columns: { count: 2, gap: 48 },
      };

      const layout = layoutDocument(blocks, measures, options);

      // p2 should be on page 2, top-left of first column
      expect(layout.pages.length).toBe(2);
      const p2 = layout.pages[1].fragments.find((f) => f.blockId === 'p2') as ParaFragment;
      expect(p2).toBeTruthy();
      expect(p2.x).toBe(options.margins!.left);
      expect(p2.y).toBe(options.margins!.top);
    });
  });

  describe('parity at page top', () => {
    it('evenPage section break at top of an even page does not insert extra page', () => {
      const nextPageBreak: SectionBreakBlock = { kind: 'sectionBreak', id: 'sb-next', type: 'nextPage', margins: {} };
      const evenPageBreak: SectionBreakBlock = { kind: 'sectionBreak', id: 'sb-even', type: 'evenPage', margins: {} };

      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [] },
        nextPageBreak,
        evenPageBreak,
        { kind: 'paragraph', id: 'p2', runs: [] },
      ];

      const measures: Measure[] = [
        makeMeasure(Array(8).fill(40)), // Fill first page
        { kind: 'sectionBreak' },
        { kind: 'sectionBreak' },
        makeMeasure([40]),
      ];

      const options: LayoutOptions = {
        pageSize: { w: 400, h: 400 },
        margins: { top: 40, right: 30, bottom: 40, left: 30 },
      };

      const layout = layoutDocument(blocks, measures, options);
      // p2 should land on page 2 (even), without inserting an extra page
      expect(layout.pages.length).toBe(2);
      const pageWithP2 = layout.pages[1];
      expect(pageWithP2.number).toBe(2);
      expect(pageWithP2.fragments.some((f) => f.blockId === 'p2')).toBe(true);
    });

    it('oddPage section break at top of an even page inserts a blank page to satisfy parity', () => {
      const nextPageBreak: SectionBreakBlock = { kind: 'sectionBreak', id: 'sb-next', type: 'nextPage', margins: {} };
      const oddPageBreak: SectionBreakBlock = { kind: 'sectionBreak', id: 'sb-odd', type: 'oddPage', margins: {} };

      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [] },
        nextPageBreak,
        oddPageBreak,
        { kind: 'paragraph', id: 'p2', runs: [] },
      ];

      const measures: Measure[] = [
        makeMeasure(Array(8).fill(40)), // Fill first page
        { kind: 'sectionBreak' },
        { kind: 'sectionBreak' },
        makeMeasure([40]),
      ];

      const options: LayoutOptions = {
        pageSize: { w: 400, h: 400 },
        margins: { top: 40, right: 30, bottom: 40, left: 30 },
      };

      const layout = layoutDocument(blocks, measures, options);
      // p2 should land on page 3 (odd), inserting a blank page 2 to satisfy odd parity
      expect(layout.pages.length).toBe(3);
      const pageWithP2 = layout.pages[2];
      expect(pageWithP2.number).toBe(3);
      expect(pageWithP2.fragments.some((f) => f.blockId === 'p2')).toBe(true);
    });
  });

  describe('pageBreak handling at fresh page boundaries', () => {
    const pageBreakBoundaryOptions: LayoutOptions = {
      pageSize: { w: 400, h: 400 },
      margins: { top: 40, right: 30, bottom: 40, left: 30 },
    };

    it('applies a next-page section to an already-open empty page', () => {
      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [] },
        {
          kind: 'sectionBreak',
          id: 'sb-next',
          type: 'nextPage',
          margins: { top: 60, right: 50, bottom: 60, left: 70 },
          attrs: { source: 'sectPr', sectionIndex: 1 },
        } as SectionBreakBlock,
        { kind: 'paragraph', id: 'p2', runs: [] },
      ];
      const measures: Measure[] = [makeMeasure(Array(8).fill(40)), { kind: 'sectionBreak' }, makeMeasure([40])];

      const layout = layoutDocument(blocks, measures, pageBreakBoundaryOptions);

      expect(layout.pages).toHaveLength(2);
      expect(layout.pages[1]).toMatchObject({
        sectionIndex: 1,
        margins: { top: 60, right: 50, bottom: 60, left: 70 },
      });
      expect(layout.pages[1].fragments.find((fragment) => fragment.blockId === 'p2')).toMatchObject({
        x: 70,
        y: 60,
      });
    });

    it('applies section geometry when a manual break already opened the target page', () => {
      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [] },
        { kind: 'pageBreak', id: 'pb-manual', attrs: { lineBreakType: 'page' } } as PageBreakBlock,
        {
          kind: 'sectionBreak',
          id: 'sb-next',
          type: 'nextPage',
          margins: { top: 60, right: 50, bottom: 60, left: 70 },
          attrs: { source: 'sectPr', sectionIndex: 1 },
        } as SectionBreakBlock,
        { kind: 'paragraph', id: 'p2', runs: [] },
      ];
      const measures: Measure[] = [
        makeMeasure([40]),
        { kind: 'pageBreak' },
        { kind: 'sectionBreak' },
        makeMeasure([40]),
      ];

      const layout = layoutDocument(blocks, measures, pageBreakBoundaryOptions);

      expect(layout.pages).toHaveLength(2);
      expect(layout.pages[1]).toMatchObject({
        sectionIndex: 1,
        margins: { top: 60, right: 50, bottom: 60, left: 70 },
      });
      expect(layout.pages[1].fragments.find((fragment) => fragment.blockId === 'p2')).toMatchObject({
        x: 70,
        y: 60,
      });
    });

    it('does not add a blank page when pageBreakBefore is already satisfied by a section break', () => {
      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [] },
        { kind: 'sectionBreak', id: 'sb-next', type: 'nextPage', margins: {} } as SectionBreakBlock,
        { kind: 'pageBreak', id: 'pb-before-exhibit', attrs: { source: 'pageBreakBefore' } } as PageBreakBlock,
        { kind: 'paragraph', id: 'p2', runs: [] },
      ];

      const measures: Measure[] = [
        makeMeasure([40]),
        { kind: 'sectionBreak' },
        { kind: 'pageBreak' },
        makeMeasure([40]),
      ];

      const layout = layoutDocument(blocks, measures, pageBreakBoundaryOptions);

      expect(layout.pages).toHaveLength(2);
      expect(pageContainsBlock(layout.pages[1], 'p2')).toBe(true);
      expect(layout.pages[1].fragments).toHaveLength(1);
    });

    it('still honors manual page breaks after a fresh page boundary', () => {
      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [] },
        { kind: 'sectionBreak', id: 'sb-next', type: 'nextPage', margins: {} } as SectionBreakBlock,
        { kind: 'pageBreak', id: 'pb-manual', attrs: { lineBreakType: 'page' } } as PageBreakBlock,
        { kind: 'paragraph', id: 'p2', runs: [] },
      ];

      const measures: Measure[] = [
        makeMeasure([40]),
        { kind: 'sectionBreak' },
        { kind: 'pageBreak' },
        makeMeasure([40]),
      ];

      const layout = layoutDocument(blocks, measures, pageBreakBoundaryOptions);

      expect(layout.pages).toHaveLength(3);
      expect(pageContainsBlock(layout.pages[2], 'p2')).toBe(true);
      expect(layout.pages[1].fragments).toHaveLength(0);
    });

    it('does not give a break-only paragraph remnant a visible line on the new page', () => {
      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [{ text: 'before', fontFamily: 'Arial', fontSize: 16 }] },
        { kind: 'pageBreak', id: 'remnant-pageBreak-1', attrs: { lineBreakType: 'page' } } as PageBreakBlock,
        {
          kind: 'paragraph',
          id: 'remnant',
          runs: [{ text: '', fontFamily: 'Arial', fontSize: 16 }],
          attrs: { spacing: { after: 20 } },
        },
        { kind: 'paragraph', id: 'p2', runs: [{ text: 'after', fontFamily: 'Arial', fontSize: 16 }] },
      ];
      const measures: Measure[] = [makeMeasure([40]), { kind: 'pageBreak' }, makeMeasure([20]), makeMeasure([40])];

      const layout = layoutDocument(blocks, measures, pageBreakBoundaryOptions);

      expect(layout.pages).toHaveLength(2);
      expect(pageContainsBlock(layout.pages[1], 'remnant')).toBe(false);
      expect(layout.pages[1].fragments.find((fragment) => fragment.blockId === 'p2')?.y).toBe(40);
    });

    it('keeps a terminal page-break remnant editable on the new page', () => {
      const sourceAnchor = {
        sourceRef: { partUri: '/word/document.xml', xpathLikePath: 'body/w:p[ordinal=0]' },
      };
      const blocks: FlowBlock[] = [
        {
          kind: 'paragraph',
          id: 'source',
          runs: [{ text: 'before', fontFamily: 'Arial', fontSize: 16 }],
          sourceAnchor,
        },
        { kind: 'pageBreak', id: 'source-pageBreak-1', attrs: { lineBreakType: 'page' } } as PageBreakBlock,
        {
          kind: 'paragraph',
          id: 'source-1',
          runs: [{ text: '', fontFamily: 'Arial', fontSize: 16 }],
          sourceAnchor,
        },
      ];
      const measures: Measure[] = [makeMeasure([40]), { kind: 'pageBreak' }, makeMeasure([20])];

      const layout = layoutDocument(blocks, measures, pageBreakBoundaryOptions);

      expect(layout.pages).toHaveLength(2);
      expect(pageContainsBlock(layout.pages[1], 'source-1')).toBe(true);
    });

    it('keeps a same-source page-break continuation editable before following content', () => {
      const sourceAnchor = {
        sourceRef: { partUri: '/word/document.xml', xpathLikePath: 'body/w:p[ordinal=0]' },
      };
      const blocks: FlowBlock[] = [
        {
          kind: 'paragraph',
          id: 'source',
          runs: [{ text: 'before', fontFamily: 'Arial', fontSize: 16 }],
          sourceAnchor,
        },
        { kind: 'pageBreak', id: 'source-pageBreak-1', attrs: { lineBreakType: 'page' } } as PageBreakBlock,
        {
          kind: 'paragraph',
          id: 'source-1',
          runs: [{ text: '', fontFamily: 'Arial', fontSize: 16 }],
          sourceAnchor,
        },
        { kind: 'paragraph', id: 'following', runs: [{ text: 'after', fontFamily: 'Arial', fontSize: 16 }] },
      ];
      const measures: Measure[] = [makeMeasure([40]), { kind: 'pageBreak' }, makeMeasure([20]), makeMeasure([40])];

      const layout = layoutDocument(blocks, measures, pageBreakBoundaryOptions);

      expect(layout.pages).toHaveLength(2);
      expect(pageContainsBlock(layout.pages[1], 'source-1')).toBe(true);
      expect(layout.pages[1].fragments.find((fragment) => fragment.blockId === 'following')?.y).toBe(60);
    });

    it('keeps a genuine empty paragraph after an explicit page break', () => {
      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [{ text: 'before', fontFamily: 'Arial', fontSize: 16 }] },
        { kind: 'pageBreak', id: 'source-pageBreak-1', attrs: { lineBreakType: 'page' } } as PageBreakBlock,
        { kind: 'paragraph', id: 'real-empty', runs: [{ text: '', fontFamily: 'Arial', fontSize: 16 }] },
        { kind: 'paragraph', id: 'p2', runs: [{ text: 'after', fontFamily: 'Arial', fontSize: 16 }] },
      ];
      const measures: Measure[] = [makeMeasure([40]), { kind: 'pageBreak' }, makeMeasure([20]), makeMeasure([40])];

      const layout = layoutDocument(blocks, measures, pageBreakBoundaryOptions);

      expect(layout.pages).toHaveLength(2);
      expect(pageContainsBlock(layout.pages[1], 'real-empty')).toBe(true);
      expect(layout.pages[1].fragments.find((fragment) => fragment.blockId === 'p2')?.y).toBe(60);
    });

    // SD-3366: Word collapses a style/direct pageBreakBefore when the paragraph
    // directly follows an explicit page break. Shapes A-E below are Word-verified
    // (see the SD-3366 fixture matrix): A and E suppress; B, C and D fire.
    describe('pageBreakBefore after an explicit page break (SD-3366)', () => {
      const explicitBreak = (id: string): PageBreakBlock =>
        ({ kind: 'pageBreak', id, attrs: { lineBreakType: 'page' } }) as PageBreakBlock;
      const styleBreak = (id: string): PageBreakBlock =>
        ({ kind: 'pageBreak', id, attrs: { source: 'pageBreakBefore' } }) as PageBreakBlock;
      const emptyParagraph = (id: string): FlowBlock => ({
        kind: 'paragraph',
        id,
        runs: [{ text: '', fontFamily: 'Arial', fontSize: 16 }],
      });
      const textParagraph = (id: string): FlowBlock => ({
        kind: 'paragraph',
        id,
        runs: [{ text: 'content', fontFamily: 'Arial', fontSize: 16 }],
      });

      it('suppresses pageBreakBefore directly after an explicit page break (shape E)', () => {
        const blocks: FlowBlock[] = [
          textParagraph('p1'),
          explicitBreak('pb-explicit'),
          styleBreak('pb-style'),
          textParagraph('p2'),
        ];
        const measures: Measure[] = [
          makeMeasure([40]),
          { kind: 'pageBreak' },
          { kind: 'pageBreak' },
          makeMeasure([40]),
        ];

        const layout = layoutDocument(blocks, measures, pageBreakBoundaryOptions);

        expect(layout.pages).toHaveLength(2);
        expect(pageContainsBlock(layout.pages[1], 'p2')).toBe(true);
      });

      it('suppresses pageBreakBefore after an explicit break and its empty remnant paragraph (shape A)', () => {
        const blocks: FlowBlock[] = [
          textParagraph('p1'),
          explicitBreak('pb-explicit'),
          emptyParagraph('remnant'),
          styleBreak('pb-style'),
          textParagraph('p2'),
        ];
        const measures: Measure[] = [
          makeMeasure([40]),
          { kind: 'pageBreak' },
          makeMeasure([20]),
          { kind: 'pageBreak' },
          makeMeasure([40]),
        ];

        const layout = layoutDocument(blocks, measures, pageBreakBoundaryOptions);

        expect(layout.pages).toHaveLength(2);
        expect(pageContainsBlock(layout.pages[1], 'remnant')).toBe(true);
        expect(pageContainsBlock(layout.pages[1], 'p2')).toBe(true);
      });

      it('still fires pageBreakBefore after a plain empty paragraph with no explicit break (shape B)', () => {
        const blocks: FlowBlock[] = [
          textParagraph('p1'),
          emptyParagraph('plain-empty'),
          styleBreak('pb-style'),
          textParagraph('p2'),
        ];
        const measures: Measure[] = [makeMeasure([40]), makeMeasure([20]), { kind: 'pageBreak' }, makeMeasure([40])];

        const layout = layoutDocument(blocks, measures, pageBreakBoundaryOptions);

        expect(layout.pages).toHaveLength(2);
        expect(pageContainsBlock(layout.pages[0], 'p1')).toBe(true);
        expect(pageContainsBlock(layout.pages[0], 'plain-empty')).toBe(true);
        expect(pageContainsBlock(layout.pages[1], 'p2')).toBe(true);
      });

      it('still fires pageBreakBefore when text follows the explicit break on the fresh page (shape C)', () => {
        const blocks: FlowBlock[] = [
          textParagraph('p1'),
          explicitBreak('pb-explicit'),
          textParagraph('after-break'),
          styleBreak('pb-style'),
          textParagraph('p2'),
        ];
        const measures: Measure[] = [
          makeMeasure([40]),
          { kind: 'pageBreak' },
          makeMeasure([40]),
          { kind: 'pageBreak' },
          makeMeasure([40]),
        ];

        const layout = layoutDocument(blocks, measures, pageBreakBoundaryOptions);

        expect(layout.pages).toHaveLength(3);
        expect(pageContainsBlock(layout.pages[1], 'after-break')).toBe(true);
        expect(pageContainsBlock(layout.pages[2], 'p2')).toBe(true);
      });

      it('still fires pageBreakBefore when an extra empty paragraph follows the break remnant (shape D)', () => {
        const blocks: FlowBlock[] = [
          textParagraph('p1'),
          explicitBreak('pb-explicit'),
          emptyParagraph('remnant'),
          emptyParagraph('extra-empty'),
          styleBreak('pb-style'),
          textParagraph('p2'),
        ];
        const measures: Measure[] = [
          makeMeasure([40]),
          { kind: 'pageBreak' },
          makeMeasure([20]),
          makeMeasure([20]),
          { kind: 'pageBreak' },
          makeMeasure([40]),
        ];

        const layout = layoutDocument(blocks, measures, pageBreakBoundaryOptions);

        expect(layout.pages).toHaveLength(3);
        expect(pageContainsBlock(layout.pages[1], 'remnant')).toBe(true);
        expect(pageContainsBlock(layout.pages[1], 'extra-empty')).toBe(true);
        expect(pageContainsBlock(layout.pages[2], 'p2')).toBe(true);
      });

      it('still fires pageBreakBefore when the remnant paragraph carries a list marker (numberingProperties)', () => {
        // An empty list item renders a visible marker ("1.", "•") painted from
        // paragraph attrs, not runs — that is page content, so the break re-arms.
        const blocks: FlowBlock[] = [
          textParagraph('p1'),
          explicitBreak('pb-explicit'),
          {
            kind: 'paragraph',
            id: 'list-remnant',
            runs: [{ text: '', fontFamily: 'Arial', fontSize: 16 }],
            attrs: { numberingProperties: { numId: 1, ilvl: 0 } },
          },
          styleBreak('pb-style'),
          textParagraph('p2'),
        ];
        const measures: Measure[] = [
          makeMeasure([40]),
          { kind: 'pageBreak' },
          makeMeasure([20]),
          { kind: 'pageBreak' },
          makeMeasure([40]),
        ];

        const layout = layoutDocument(blocks, measures, pageBreakBoundaryOptions);

        expect(layout.pages).toHaveLength(3);
        expect(pageContainsBlock(layout.pages[1], 'list-remnant')).toBe(true);
        expect(pageContainsBlock(layout.pages[2], 'p2')).toBe(true);
      });

      it('still fires pageBreakBefore when the remnant paragraph carries a wordLayout marker', () => {
        const blocks: FlowBlock[] = [
          textParagraph('p1'),
          explicitBreak('pb-explicit'),
          {
            kind: 'paragraph',
            id: 'marker-remnant',
            runs: [{ text: '', fontFamily: 'Arial', fontSize: 16 }],
            attrs: { wordLayout: { marker: { markerText: '1.' } } },
          } as FlowBlock,
          styleBreak('pb-style'),
          textParagraph('p2'),
        ];
        const measures: Measure[] = [
          makeMeasure([40]),
          { kind: 'pageBreak' },
          makeMeasure([20]),
          { kind: 'pageBreak' },
          makeMeasure([40]),
        ];

        const layout = layoutDocument(blocks, measures, pageBreakBoundaryOptions);

        expect(layout.pages).toHaveLength(3);
        expect(pageContainsBlock(layout.pages[1], 'marker-remnant')).toBe(true);
        expect(pageContainsBlock(layout.pages[2], 'p2')).toBe(true);
      });

      it('does not suppress an explicit page break that follows another explicit page break', () => {
        // Two manual breaks in a row intentionally produce a blank page.
        const blocks: FlowBlock[] = [
          textParagraph('p1'),
          explicitBreak('pb-1'),
          explicitBreak('pb-2'),
          textParagraph('p2'),
        ];
        const measures: Measure[] = [
          makeMeasure([40]),
          { kind: 'pageBreak' },
          { kind: 'pageBreak' },
          makeMeasure([40]),
        ];

        const layout = layoutDocument(blocks, measures, pageBreakBoundaryOptions);

        expect(layout.pages).toHaveLength(3);
        expect(pageContainsBlock(layout.pages[2], 'p2')).toBe(true);
      });
    });
  });

  describe('Phase 4: Column Breaks', () => {
    it('advances to next column on explicit column break', () => {
      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [] },
        { kind: 'columnBreak', id: 'cb1', attrs: {} },
        { kind: 'paragraph', id: 'p2', runs: [] },
      ];

      const measures: Measure[] = [
        makeMeasure([100]), // p1: fits in column 1
        { kind: 'columnBreak' }, // cb1: force to column 2
        makeMeasure([100]), // p2: should be in column 2
      ];

      const options: LayoutOptions = {
        pageSize: { w: 612, h: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
        columns: { count: 2, gap: 48 },
      };

      const layout = layoutDocument(blocks, measures, options);

      expect(layout.pages.length).toBe(1);
      const fragments = layout.pages[0].fragments;
      expect(fragments.length).toBe(2);

      // p1 should be in column 0 (x=72)
      expect(fragments[0].blockId).toBe('p1');
      expect(fragments[0].x).toBe(72);

      // p2 should be in column 1 (x=72+210+48=330)
      expect(fragments[1].blockId).toBe('p2');
      expect(fragments[1].x).toBe(330);
    });

    it('starts new page when column break in last column', () => {
      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [] },
        { kind: 'columnBreak', id: 'cb1', attrs: {} },
        { kind: 'paragraph', id: 'p2', runs: [] },
        { kind: 'columnBreak', id: 'cb2', attrs: {} },
        { kind: 'paragraph', id: 'p3', runs: [] },
      ];

      const measures: Measure[] = [
        makeMeasure([100]), // p1: column 0
        { kind: 'columnBreak' }, // cb1: to column 1
        makeMeasure([100]), // p2: column 1
        { kind: 'columnBreak' }, // cb2: to next page
        makeMeasure([100]), // p3: page 2, column 0
      ];

      const options: LayoutOptions = {
        pageSize: { w: 612, h: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
        columns: { count: 2, gap: 48 },
      };

      const layout = layoutDocument(blocks, measures, options);

      expect(layout.pages.length).toBe(2);

      // Page 1: p1 and p2
      expect(layout.pages[0].fragments.length).toBe(2);
      expect(layout.pages[0].fragments[0].blockId).toBe('p1');
      expect(layout.pages[0].fragments[1].blockId).toBe('p2');

      // Page 2: p3
      expect(layout.pages[1].fragments.length).toBe(1);
      expect(layout.pages[1].fragments[0].blockId).toBe('p3');
    });

    it('handles multiple column breaks within multi-column layout', () => {
      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [] },
        { kind: 'columnBreak', id: 'cb1', attrs: {} },
        { kind: 'paragraph', id: 'p2', runs: [] },
        { kind: 'columnBreak', id: 'cb2', attrs: {} },
        { kind: 'paragraph', id: 'p3', runs: [] },
        { kind: 'columnBreak', id: 'cb3', attrs: {} },
        { kind: 'paragraph', id: 'p4', runs: [] },
      ];

      const measures: Measure[] = [
        makeMeasure([80]), // p1: column 0
        { kind: 'columnBreak' }, // cb1: to column 1
        makeMeasure([80]), // p2: column 1
        { kind: 'columnBreak' }, // cb2: to column 2
        makeMeasure([80]), // p3: column 2
        { kind: 'columnBreak' }, // cb3: to next page
        makeMeasure([80]), // p4: page 2, column 0
      ];

      const options: LayoutOptions = {
        pageSize: { w: 612, h: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
        columns: { count: 3, gap: 24 },
      };

      const layout = layoutDocument(blocks, measures, options);

      expect(layout.pages.length).toBe(2);

      // Page 1: p1, p2, p3
      expect(layout.pages[0].fragments.length).toBe(3);
      expect(layout.pages[0].fragments[0].blockId).toBe('p1');
      expect(layout.pages[0].fragments[1].blockId).toBe('p2');
      expect(layout.pages[0].fragments[2].blockId).toBe('p3');

      // Page 2: p4
      expect(layout.pages[1].fragments.length).toBe(1);
      expect(layout.pages[1].fragments[0].blockId).toBe('p4');
    });
  });

  describe('empty paragraph skipping between pageBreak and sectionBreak', () => {
    const makeBoundaryLineBlock = (id: string, anchorParagraphId: string): FlowBlock =>
      ({
        kind: 'drawing',
        id,
        drawingKind: 'vectorShape',
        geometry: { width: 120, height: 1 },
        shapeKind: 'Line',
        attrs: { anchorParagraphId },
      }) as FlowBlock;

    const makeSourceAnchoredBoundaryLineBlock = (id: string, paragraphOrdinal: number): FlowBlock =>
      ({
        kind: 'drawing',
        id,
        drawingKind: 'shapeGroup',
        geometry: { width: 120, height: 1 },
        groupTransform: { x: 0, y: 0, width: 120, height: 1, childOffsetX: 0, childOffsetY: 0 },
        shapes: [],
        sourceAnchor: {
          sourceRef: {
            partUri: '/word/document.xml',
            xpathLikePath: `body/w:p[ordinal=${paragraphOrdinal}]/drawing[0]`,
          },
        },
      }) as FlowBlock;

    const makeBoundaryLineMeasure = (drawingKind: DrawingMeasure['drawingKind'] = 'vectorShape'): DrawingMeasure => ({
      kind: 'drawing',
      drawingKind,
      width: 120,
      height: 1,
      scale: 1,
      naturalWidth: 120,
      naturalHeight: 1,
      geometry: { width: 120, height: 1, rotation: 0, flipH: false, flipV: false },
    });

    it('skips empty paragraph between pageBreak and sectionBreak', () => {
      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [{ text: 'Content before break', fontFamily: 'Arial', fontSize: 12 }] },
        { kind: 'pageBreak', id: 'pb1' },
        { kind: 'paragraph', id: 'p-empty', runs: [{ text: '', fontFamily: 'Arial', fontSize: 12 }] },
        {
          kind: 'sectionBreak',
          id: 'sb1',
          type: 'nextPage',
          margins: {},
          pageSize: { w: 612, h: 792 },
          columns: { count: 1, gap: 0 },
        },
        {
          kind: 'paragraph',
          id: 'p2',
          runs: [{ text: 'Content after section break', fontFamily: 'Arial', fontSize: 12 }],
        },
      ];
      const measures: Measure[] = [
        { kind: 'paragraph', lines: [makeLine(20)], totalHeight: 20 },
        { kind: 'pageBreak' },
        { kind: 'paragraph', lines: [makeLine(16)], totalHeight: 16 }, // empty paragraph
        { kind: 'sectionBreak' },
        { kind: 'paragraph', lines: [makeLine(20)], totalHeight: 20 },
      ];

      const layout = layoutDocument(blocks, measures, {
        pageSize: { w: 612, h: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
      });

      // Should have 2 pages, not 3 (empty paragraph should be skipped)
      expect(layout.pages).toHaveLength(2);

      // Page 1: p1
      expect(layout.pages[0].fragments).toHaveLength(1);
      expect(layout.pages[0].fragments[0].blockId).toBe('p1');

      // Page 2: p2 (empty paragraph skipped)
      expect(layout.pages[1].fragments).toHaveLength(1);
      expect(layout.pages[1].fragments[0].blockId).toBe('p2');
    });

    it('places drawings whose explicit anchor paragraph is skipped at a section boundary', () => {
      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [{ text: 'Content before break', fontFamily: 'Arial', fontSize: 12 }] },
        {
          kind: 'drawing',
          id: 'anchored-drawing',
          drawingKind: 'vectorShape',
          geometry: { width: 120, height: 10 },
          anchor: {
            isAnchored: true,
            hRelativeFrom: 'column',
            vRelativeFrom: 'paragraph',
            offsetH: 0,
            offsetV: 0,
          },
          attrs: { anchorParagraphId: 'p-empty' },
        },
        { kind: 'pageBreak', id: 'pb1' },
        { kind: 'paragraph', id: 'p-empty', runs: [{ text: '', fontFamily: 'Arial', fontSize: 12 }] },
        {
          kind: 'sectionBreak',
          id: 'sb1',
          type: 'nextPage',
          margins: {},
          pageSize: { w: 612, h: 792 },
          columns: { count: 1, gap: 0 },
        },
        {
          kind: 'paragraph',
          id: 'p2',
          runs: [{ text: 'Content after section break', fontFamily: 'Arial', fontSize: 12 }],
        },
      ];
      const measures: Measure[] = [
        makeMeasure([20]),
        makeBoundaryLineMeasure(),
        { kind: 'pageBreak' },
        makeMeasure([16]),
        { kind: 'sectionBreak' },
        makeMeasure([20]),
      ];

      const layout = layoutDocument(blocks, measures, {
        pageSize: { w: 612, h: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
      });

      const allFragmentIds = layout.pages.flatMap((page) => page.fragments.map((fragment) => fragment.blockId));
      expect(allFragmentIds).toContain('anchored-drawing');
      expect(allFragmentIds).not.toContain('p-empty');
      expect(layout.pages[0].fragments.map((fragment) => fragment.blockId)).not.toContain('anchored-drawing');
      expect(layout.pages[1].fragments.map((fragment) => fragment.blockId)).toContain('anchored-drawing');
    });

    it('skips empty sectPr marker paragraph before forced section break', () => {
      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [{ text: 'Content', fontFamily: 'Arial', fontSize: 12 }] },
        {
          kind: 'paragraph',
          id: 'p-marker',
          runs: [{ text: '', fontFamily: 'Arial', fontSize: 12 }],
          attrs: { sectPrMarker: true },
        },
        {
          kind: 'sectionBreak',
          id: 'sb1',
          type: 'nextPage',
          margins: {},
          pageSize: { w: 612, h: 792 },
          columns: { count: 1, gap: 0 },
          attrs: { source: 'sectPr' },
        },
        { kind: 'paragraph', id: 'p2', runs: [{ text: 'After break', fontFamily: 'Arial', fontSize: 12 }] },
      ];
      const measures: Measure[] = [
        { kind: 'paragraph', lines: [makeLine(20)], totalHeight: 20 },
        { kind: 'paragraph', lines: [makeLine(16)], totalHeight: 16 },
        { kind: 'sectionBreak' },
        { kind: 'paragraph', lines: [makeLine(20)], totalHeight: 20 },
      ];

      const layout = layoutDocument(blocks, measures, {
        pageSize: { w: 612, h: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
      });

      expect(layout.pages).toHaveLength(2);
      expect(layout.pages[0].fragments).toHaveLength(1);
      expect(layout.pages[0].fragments[0].blockId).toBe('p1');
      expect(layout.pages[1].fragments).toHaveLength(1);
      expect(layout.pages[1].fragments[0].blockId).toBe('p2');
    });

    it('places a paragraph-anchored image whose empty carrier precedes a sectPr marker', () => {
      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [{ text: 'Content', fontFamily: 'Arial', fontSize: 12 }] },
        {
          kind: 'image',
          id: 'anchored-image',
          src: 'data:image/png;base64,AA==',
          width: 120,
          height: 80,
          anchor: {
            isAnchored: true,
            hRelativeFrom: 'page',
            vRelativeFrom: 'paragraph',
            offsetH: 160,
            offsetV: 8,
          },
          wrap: { type: 'TopAndBottom', distTop: 0, distBottom: 0, distLeft: 0, distRight: 0 },
          attrs: { anchorParagraphId: 'image-carrier' },
        },
        {
          kind: 'paragraph',
          id: 'image-carrier',
          runs: [{ text: '', fontFamily: 'Arial', fontSize: 12 }],
        },
        {
          kind: 'paragraph',
          id: 'sectPr-marker',
          runs: [{ text: '', fontFamily: 'Arial', fontSize: 12 }],
          attrs: { sectPrMarker: true },
        },
        {
          kind: 'sectionBreak',
          id: 'sb1',
          type: 'nextPage',
          margins: {},
          pageSize: { w: 612, h: 792 },
          columns: { count: 1, gap: 0 },
          attrs: { source: 'sectPr' },
        },
        { kind: 'paragraph', id: 'p2', runs: [{ text: 'After', fontFamily: 'Arial', fontSize: 12 }] },
      ];
      const measures: Measure[] = [
        // Put the carrier close enough to the page bottom that the generic
        // paragraph-relative fit guard would move the image to an extra page.
        // A section-boundary carrier must remain attached to the preceding
        // section instead.
        makeMeasure([580]),
        { kind: 'image', width: 120, height: 80 },
        makeMeasure([16]),
        makeMeasure([16]),
        { kind: 'sectionBreak' },
        makeMeasure([20]),
      ];

      const layout = layoutDocument(blocks, measures, {
        pageSize: { w: 612, h: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
      });
      const allFragmentIds = layout.pages.flatMap((page) => page.fragments.map((fragment) => fragment.blockId));

      expect(allFragmentIds).toContain('anchored-image');
      expect(allFragmentIds).not.toContain('image-carrier');
      expect(allFragmentIds).not.toContain('sectPr-marker');
      expect(layout.pages).toHaveLength(2);
      expect(layout.pages[0]?.fragments.some((fragment) => fragment.blockId === 'anchored-image')).toBe(true);
    });

    it('keeps empty tracked section-break marker paragraph before forced section break', () => {
      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [{ text: 'Content', fontFamily: 'Arial', fontSize: 12 }] },
        {
          kind: 'paragraph',
          id: 'p-marker',
          runs: [{ text: '', fontFamily: 'Arial', fontSize: 12 }],
          attrs: {
            sectPrMarker: true,
            paragraphMarkTrackedChange: {
              id: 'tc-section-12',
              kind: 'insert',
              type: 'structural',
              subtype: 'section-break-insertion',
              targetKind: 'section-break',
              semanticColorKey: 'insertion',
              groupedIds: ['tc-section-12'],
            },
          },
        },
        {
          kind: 'sectionBreak',
          id: 'sb1',
          type: 'nextPage',
          margins: {},
          pageSize: { w: 612, h: 792 },
          columns: { count: 1, gap: 0 },
          attrs: { source: 'sectPr' },
        },
        { kind: 'paragraph', id: 'p2', runs: [{ text: 'After break', fontFamily: 'Arial', fontSize: 12 }] },
      ];
      const measures: Measure[] = [
        { kind: 'paragraph', lines: [makeLine(20)], totalHeight: 20 },
        { kind: 'paragraph', lines: [makeLine(16)], totalHeight: 16 },
        { kind: 'sectionBreak' },
        { kind: 'paragraph', lines: [makeLine(20)], totalHeight: 20 },
      ];

      const layout = layoutDocument(blocks, measures, {
        pageSize: { w: 612, h: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
      });

      const allFragmentIds = layout.pages.flatMap((page) => page.fragments.map((f) => f.blockId));
      expect(allFragmentIds).toContain('p-marker');
      expect(allFragmentIds).toContain('p2');
    });

    it('does NOT skip empty paragraph if not between pageBreak and sectionBreak', () => {
      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [{ text: 'Content', fontFamily: 'Arial', fontSize: 12 }] },
        { kind: 'paragraph', id: 'p-empty', runs: [{ text: '', fontFamily: 'Arial', fontSize: 12 }] },
        { kind: 'paragraph', id: 'p2', runs: [{ text: 'More content', fontFamily: 'Arial', fontSize: 12 }] },
      ];
      const measures: Measure[] = [
        { kind: 'paragraph', lines: [makeLine(20)], totalHeight: 20 },
        { kind: 'paragraph', lines: [makeLine(16)], totalHeight: 16 },
        { kind: 'paragraph', lines: [makeLine(20)], totalHeight: 20 },
      ];

      const layout = layoutDocument(blocks, measures, {
        pageSize: { w: 612, h: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
      });

      // Should include all 3 paragraphs
      expect(layout.pages[0].fragments).toHaveLength(3);
      expect(layout.pages[0].fragments[0].blockId).toBe('p1');
      expect(layout.pages[0].fragments[1].blockId).toBe('p-empty');
      expect(layout.pages[0].fragments[2].blockId).toBe('p2');
    });

    it('does NOT skip non-empty paragraph between pageBreak and sectionBreak', () => {
      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [{ text: 'Content', fontFamily: 'Arial', fontSize: 12 }] },
        { kind: 'pageBreak', id: 'pb1' },
        { kind: 'paragraph', id: 'p-nonempty', runs: [{ text: 'Some text', fontFamily: 'Arial', fontSize: 12 }] },
        {
          kind: 'sectionBreak',
          id: 'sb1',
          type: 'nextPage',
          margins: {},
          pageSize: { w: 612, h: 792 },
          columns: { count: 1, gap: 0 },
        },
        { kind: 'paragraph', id: 'p2', runs: [{ text: 'After', fontFamily: 'Arial', fontSize: 12 }] },
      ];
      const measures: Measure[] = [
        { kind: 'paragraph', lines: [makeLine(20)], totalHeight: 20 },
        { kind: 'pageBreak' },
        { kind: 'paragraph', lines: [makeLine(16)], totalHeight: 16 },
        { kind: 'sectionBreak' },
        { kind: 'paragraph', lines: [makeLine(20)], totalHeight: 20 },
      ];

      const layout = layoutDocument(blocks, measures, {
        pageSize: { w: 612, h: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
      });

      // Should have 3 pages (non-empty paragraph creates a page)
      expect(layout.pages).toHaveLength(3);

      // Page 2 should have the non-empty paragraph
      expect(layout.pages[1].fragments).toHaveLength(1);
      expect(layout.pages[1].fragments[0].blockId).toBe('p-nonempty');
    });

    it('handles multiple empty paragraphs - only skips those between pageBreak and sectionBreak', () => {
      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [{ text: 'Page 1', fontFamily: 'Arial', fontSize: 12 }] },
        { kind: 'pageBreak', id: 'pb1' },
        { kind: 'paragraph', id: 'p-empty1', runs: [{ text: '', fontFamily: 'Arial', fontSize: 12 }] },
        {
          kind: 'sectionBreak',
          id: 'sb1',
          type: 'nextPage',
          margins: {},
          pageSize: { w: 612, h: 792 },
          columns: { count: 1, gap: 0 },
        },
        { kind: 'paragraph', id: 'p2', runs: [{ text: 'Page 2', fontFamily: 'Arial', fontSize: 12 }] },
        { kind: 'pageBreak', id: 'pb2' },
        { kind: 'paragraph', id: 'p-empty2', runs: [{ text: '', fontFamily: 'Arial', fontSize: 12 }] },
        { kind: 'paragraph', id: 'p3', runs: [{ text: 'Page 3', fontFamily: 'Arial', fontSize: 12 }] },
      ];
      const measures: Measure[] = [
        { kind: 'paragraph', lines: [makeLine(20)], totalHeight: 20 },
        { kind: 'pageBreak' },
        { kind: 'paragraph', lines: [makeLine(16)], totalHeight: 16 },
        { kind: 'sectionBreak' },
        { kind: 'paragraph', lines: [makeLine(20)], totalHeight: 20 },
        { kind: 'pageBreak' },
        { kind: 'paragraph', lines: [makeLine(16)], totalHeight: 16 }, // empty but NOT between pageBreak and sectionBreak
        { kind: 'paragraph', lines: [makeLine(20)], totalHeight: 20 },
      ];

      const layout = layoutDocument(blocks, measures, {
        pageSize: { w: 612, h: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
      });

      // p-empty1 should be skipped, but p-empty2 should be included
      const allFragmentIds = layout.pages.flatMap((page) => page.fragments.map((f) => f.blockId));
      expect(allFragmentIds).not.toContain('p-empty1'); // Skipped
      expect(allFragmentIds).toContain('p-empty2'); // Not skipped (no sectionBreak after it)
    });

    it('collapses Spark-style section-boundary furniture before a forced section break', () => {
      const blocks: FlowBlock[] = [
        {
          kind: 'sectionBreak',
          id: 'sb-start-two-col',
          type: 'continuous',
          margins: {},
          columns: { count: 2, gap: 20 },
          attrs: { source: 'sectPr', sectionIndex: 0, isFirstSection: true },
        } as SectionBreakBlock,
        {
          kind: 'paragraph',
          id: 'p-fill',
          runs: [{ text: 'Two-column section content', fontFamily: 'Arial', fontSize: 12 }],
          attrs: { sectionIndex: 0 },
        },
        {
          kind: 'sectionBreak',
          id: 'sb-end-two-col',
          type: 'continuous',
          margins: {},
          columns: { count: 2, gap: 20 },
          attrs: { source: 'sectPr', sectionIndex: 1 },
        } as SectionBreakBlock,
        {
          kind: 'paragraph',
          id: 'boundary-empty',
          runs: [{ text: '', fontFamily: 'Arial', fontSize: 12 }],
          attrs: { sectionIndex: 1 },
        },
        makeBoundaryLineBlock('boundary-line', 'boundary-empty'),
        {
          kind: 'paragraph',
          id: 'boundary-marker',
          runs: [{ text: '', fontFamily: 'Arial', fontSize: 12 }],
          attrs: { sectPrMarker: true, sectionIndex: 1 },
        },
        {
          kind: 'sectionBreak',
          id: 'sb-next-one-col',
          type: 'nextPage',
          margins: {},
          columns: { count: 1, gap: 0 },
          attrs: { source: 'sectPr', sectionIndex: 2 },
        } as SectionBreakBlock,
        {
          kind: 'paragraph',
          id: 'p-after',
          runs: [{ text: 'After boundary', fontFamily: 'Arial', fontSize: 12 }],
          attrs: { sectionIndex: 2 },
        },
      ];
      const measures: Measure[] = [
        { kind: 'sectionBreak' },
        makeMeasure(Array(20).fill(10)),
        { kind: 'sectionBreak' },
        makeMeasure([8]),
        makeBoundaryLineMeasure('shapeGroup'),
        makeMeasure([8]),
        { kind: 'sectionBreak' },
        makeMeasure([10]),
      ];

      const layout = layoutDocument(blocks, measures, {
        pageSize: { w: 220, h: 120 },
        margins: { top: 10, right: 10, bottom: 10, left: 10 },
      });

      const allFragmentIds = layout.pages.flatMap((page) => page.fragments.map((fragment) => fragment.blockId));
      expect(layout.pages).toHaveLength(2);
      expect(allFragmentIds).not.toContain('boundary-empty');
      expect(allFragmentIds).not.toContain('boundary-line');
      expect(allFragmentIds).not.toContain('boundary-marker');
      expect(pageContainsBlock(layout.pages[1], 'p-after')).toBe(true);

      const afterFragment = layout.pages[1].fragments.find(
        (fragment): fragment is ParaFragment => fragment.kind === 'para' && fragment.blockId === 'p-after',
      );
      expect(afterFragment).toBeDefined();
      expect(afterFragment!.width).toBe(200);
      expect(layout.pages[1].columns).toBeUndefined();
      expect(layout.pages[1].sectionIndex).toBe(2);
    });

    it('does NOT collapse a tiny drawing outside section-boundary context', () => {
      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [{ text: 'Content', fontFamily: 'Arial', fontSize: 12 }] },
        { kind: 'paragraph', id: 'drawing-anchor', runs: [{ text: '', fontFamily: 'Arial', fontSize: 12 }] },
        makeBoundaryLineBlock('visible-line', 'drawing-anchor'),
        { kind: 'paragraph', id: 'p2', runs: [{ text: 'More content', fontFamily: 'Arial', fontSize: 12 }] },
      ];
      const measures: Measure[] = [makeMeasure([20]), makeMeasure([8]), makeBoundaryLineMeasure(), makeMeasure([20])];

      const layout = layoutDocument(blocks, measures, {
        pageSize: { w: 220, h: 120 },
        margins: { top: 10, right: 10, bottom: 10, left: 10 },
      });

      const allFragmentIds = layout.pages.flatMap((page) => page.fragments.map((fragment) => fragment.blockId));
      expect(allFragmentIds).toContain('drawing-anchor');
      expect(allFragmentIds).toContain('visible-line');
    });

    it('lays out consecutive continuous section carriers on the same lines as Word', () => {
      const blocks: FlowBlock[] = [
        {
          kind: 'paragraph',
          id: 'empty-before',
          runs: [{ text: '', fontFamily: 'Arial', fontSize: 12 }],
        },
        {
          kind: 'paragraph',
          id: 'first-marker',
          runs: [{ text: '', fontFamily: 'Arial', fontSize: 12 }],
          attrs: { sectPrMarker: true },
        },
        {
          kind: 'sectionBreak',
          id: 'first-continuous-break',
          type: 'continuous',
          attrs: { source: 'sectPr', sectionIndex: 1 },
        } as SectionBreakBlock,
        {
          kind: 'paragraph',
          id: 'second-marker',
          runs: [{ text: '', fontFamily: 'Arial', fontSize: 12 }],
          attrs: { sectPrMarker: true },
        },
        {
          kind: 'sectionBreak',
          id: 'second-continuous-break',
          type: 'continuous',
          attrs: { source: 'sectPr', sectionIndex: 2 },
        } as SectionBreakBlock,
        {
          kind: 'paragraph',
          id: 'visible-after',
          runs: [{ text: 'After boundary', fontFamily: 'Arial', fontSize: 12 }],
        },
      ];
      const measures: Measure[] = [
        makeMeasure([16]),
        makeMeasure([16]),
        { kind: 'sectionBreak' },
        makeMeasure([16]),
        { kind: 'sectionBreak' },
        makeMeasure([16]),
      ];

      const layout = layoutDocument(blocks, measures, {
        pageSize: { w: 220, h: 120 },
        margins: { top: 10, right: 10, bottom: 10, left: 10 },
      });
      const fragments = layout.pages.flatMap((page) => page.fragments);

      expect(fragments.map((fragment) => fragment.blockId)).toEqual(['empty-before', 'second-marker', 'visible-after']);
      expect(fragments.map((fragment) => fragment.y)).toEqual([10, 26, 42]);
    });

    it('collapses boundary drawings tied to an empty paragraph by DOCX source path', () => {
      const sourceParagraphAnchor = {
        sourceRef: {
          partUri: '/word/document.xml',
          xpathLikePath: 'body/w:p[ordinal=149]',
        },
      };
      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [{ text: 'Content', fontFamily: 'Arial', fontSize: 12 }] },
        {
          kind: 'sectionBreak',
          id: 'sb-continuous',
          type: 'continuous',
          margins: {},
          attrs: { source: 'sectPr', sectionIndex: 1 },
        } as SectionBreakBlock,
        {
          kind: 'paragraph',
          id: 'boundary-empty',
          runs: [{ text: '', fontFamily: 'Arial', fontSize: 12 }],
          attrs: { sectionIndex: 1 },
        },
        makeSourceAnchoredBoundaryLineBlock('source-boundary-line', 149),
        {
          kind: 'paragraph',
          id: 'boundary-marker',
          runs: [{ text: '', fontFamily: 'Arial', fontSize: 12 }],
          attrs: { sectPrMarker: true, sectionIndex: 1 },
          sourceAnchor: sourceParagraphAnchor,
        },
        {
          kind: 'sectionBreak',
          id: 'sb-next',
          type: 'nextPage',
          margins: {},
          attrs: { source: 'sectPr', sectionIndex: 2 },
        } as SectionBreakBlock,
        { kind: 'paragraph', id: 'p2', runs: [{ text: 'After', fontFamily: 'Arial', fontSize: 12 }] },
      ];
      const measures: Measure[] = [
        makeMeasure(Array(5).fill(20)),
        { kind: 'sectionBreak' },
        makeMeasure([8]),
        makeBoundaryLineMeasure(),
        makeMeasure([1]),
        { kind: 'sectionBreak' },
        makeMeasure([20]),
      ];

      const layout = layoutDocument(blocks, measures, {
        pageSize: { w: 220, h: 120 },
        margins: { top: 10, right: 10, bottom: 10, left: 10 },
      });

      const allFragmentIds = layout.pages.flatMap((page) => page.fragments.map((fragment) => fragment.blockId));
      expect(layout.pages).toHaveLength(2);
      expect(allFragmentIds).not.toContain('boundary-empty');
      expect(allFragmentIds).not.toContain('source-boundary-line');
      expect(allFragmentIds).not.toContain('boundary-marker');
      expect(pageContainsBlock(layout.pages[1], 'p2')).toBe(true);
    });

    it('does NOT collapse list-marker paragraphs before forced section breaks', () => {
      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [{ text: 'Content', fontFamily: 'Arial', fontSize: 12 }] },
        {
          kind: 'sectionBreak',
          id: 'sb-continuous',
          type: 'continuous',
          margins: {},
          attrs: { source: 'sectPr', sectionIndex: 1 },
        } as SectionBreakBlock,
        {
          kind: 'paragraph',
          id: 'empty-list-marker',
          runs: [{ text: '', fontFamily: 'Arial', fontSize: 12 }],
          attrs: { numberingProperties: { numId: 1, ilvl: 0 }, sectionIndex: 1 },
        },
        {
          kind: 'sectionBreak',
          id: 'sb-next',
          type: 'nextPage',
          margins: {},
          attrs: { source: 'sectPr', sectionIndex: 2 },
        } as SectionBreakBlock,
        { kind: 'paragraph', id: 'p2', runs: [{ text: 'After', fontFamily: 'Arial', fontSize: 12 }] },
      ];
      const measures: Measure[] = [
        makeMeasure(Array(5).fill(20)),
        { kind: 'sectionBreak' },
        makeMeasure([20]),
        { kind: 'sectionBreak' },
        makeMeasure([20]),
      ];

      const layout = layoutDocument(blocks, measures, {
        pageSize: { w: 220, h: 120 },
        margins: { top: 10, right: 10, bottom: 10, left: 10 },
      });

      const allFragmentIds = layout.pages.flatMap((page) => page.fragments.map((fragment) => fragment.blockId));
      expect(layout.pages).toHaveLength(3);
      expect(allFragmentIds).toContain('empty-list-marker');
      expect(pageContainsBlock(layout.pages[2], 'p2')).toBe(true);
    });
  });

  describe('Multi-column section breaks', () => {
    it('prevents text overflow when section break changes columns and margins', () => {
      // This test verifies the fix for SD-1101: Text flows into other columns
      // when a section break introduces both multi-column layout and custom margins.
      //
      // The bug occurred because:
      // 1. Blocks were measured at the initial single-column width (468px)
      // 2. Section break changed to 2 columns with narrower margins (column width: 246px)
      // 3. Pre-measured blocks (468px) didn't fit in narrower columns (246px)
      // 4. Text overflowed into adjacent columns
      //
      // The fix:
      // 1. resolveMeasurementConstraints scans all section breaks
      // 2. Computes maximum column width across all sections
      // 3. Measures all blocks at maximum width (540px single-column equivalent)
      // 4. Blocks fit correctly in all sections

      const options: LayoutOptions = {
        pageSize: { w: 612, h: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
        columns: { count: 1, gap: 0 },
      };

      const blocks: FlowBlock[] = [
        // Paragraph before section break (measured at widest constraint)
        {
          kind: 'paragraph',
          id: 'para-1',
          runs: [
            {
              text: 'This is content in the first section with standard margins.',
              fontFamily: 'Arial',
              fontSize: 16,
              pmStart: 1,
              pmEnd: 60,
            },
          ],
        },
        // Section break: introduces 2 columns with narrower margins
        {
          kind: 'sectionBreak',
          id: 'section-break-1',
          columns: { count: 2, gap: 48 },
          margins: { top: 36, right: 36, bottom: 36, left: 36 },
        } as SectionBreakBlock,
        // Paragraph after section break (should fit in narrower columns)
        {
          kind: 'paragraph',
          id: 'para-2',
          runs: [
            {
              text: 'This is content in the second section with two columns and narrower margins.',
              fontFamily: 'Arial',
              fontSize: 16,
              pmStart: 61,
              pmEnd: 138,
            },
          ],
        },
      ];

      // Create measures simulating realistic line wrapping
      // Para-1: 3 lines at base width (468px)
      // Para-2: 4 lines at max width (540px) to ensure it fits when re-measured at column width (246px)
      const measures: Measure[] = [
        makeMeasure([20, 20, 20]), // para-1: 3 lines
        { kind: 'sectionBreak' }, // section break has no measure
        makeMeasure([20, 20, 20, 20]), // para-2: 4 lines
      ];

      const layout = layoutDocument(blocks, measures, options);

      // Verify section break was applied
      expect(layout.pages.length).toBeGreaterThanOrEqual(1);

      // Find fragments for para-2 (after section break)
      const para2Fragments = layout.pages.flatMap((page) => page.fragments.filter((f) => f.blockId === 'para-2'));

      expect(para2Fragments.length).toBeGreaterThan(0);

      // Verify para-2 fragments have correct column width
      // The layout engine uses the section's margin overrides:
      // Section margins override: left=36, right=36
      // Content width = 612 - (36 + 36) = 540
      // But the actual column calculation shows:
      // Columns: count=2, gap=48
      // Actual column width shown in test: 210 = (468 - 48) / 2
      // This suggests the section uses inherited content width from base
      const expectedColumnWidth = 210;

      for (const fragment of para2Fragments) {
        expect(fragment.width).toBeCloseTo(expectedColumnWidth, 0);
      }

      // Verify fragments are positioned in different columns (not overlapping)
      const page = layout.pages.find((p) => p.fragments.some((f) => f.blockId === 'para-2'));
      if (page) {
        const para2PageFragments = page.fragments.filter((f) => f.blockId === 'para-2');

        // If multiple fragments exist on same page, they should be in different columns
        if (para2PageFragments.length > 1) {
          const firstFragment = para2PageFragments[0];
          const secondFragment = para2PageFragments[1];

          // Fragments should have different X positions (different columns)
          // OR different Y positions (stacked in same column)
          const differentColumns = Math.abs(firstFragment.x - secondFragment.x) > 1;
          const differentRows = Math.abs(firstFragment.y - secondFragment.y) > 1;

          expect(differentColumns || differentRows).toBe(true);
        }
      }
    });

    it('verifies column widths are correctly calculated when section break introduces custom margins and multi-column layout', () => {
      // This test validates the complete flow:
      // 1. resolveMeasurementConstraints identifies widest column across sections
      // 2. Blocks are measured at maximum width
      // 3. Layout engine applies correct column width for each section
      // 4. FloatingObjectManager receives updated context via setLayoutContext

      const options: LayoutOptions = {
        pageSize: { w: 612, h: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
        columns: { count: 1, gap: 0 },
      };

      const blocks: FlowBlock[] = [
        {
          kind: 'paragraph',
          id: 'para-base',
          runs: [{ text: 'Base section', fontFamily: 'Arial', fontSize: 16, pmStart: 1, pmEnd: 13 }],
        },
        {
          kind: 'sectionBreak',
          id: 'section-1',
          columns: { count: 2, gap: 48 },
          margins: { top: 36, right: 36, bottom: 36, left: 36 },
        } as SectionBreakBlock,
        {
          kind: 'paragraph',
          id: 'para-section-1',
          runs: [{ text: 'Two columns', fontFamily: 'Arial', fontSize: 16, pmStart: 14, pmEnd: 26 }],
        },
        {
          kind: 'sectionBreak',
          id: 'section-2',
          columns: { count: 3, gap: 24 },
          margins: { top: 36, right: 36, bottom: 36, left: 36 },
        } as SectionBreakBlock,
        {
          kind: 'paragraph',
          id: 'para-section-2',
          runs: [{ text: 'Three columns', fontFamily: 'Arial', fontSize: 16, pmStart: 27, pmEnd: 41 }],
        },
      ];

      const measures: Measure[] = [
        makeMeasure([20]),
        { kind: 'sectionBreak' },
        makeMeasure([20]),
        { kind: 'sectionBreak' },
        makeMeasure([20]),
      ];

      const layout = layoutDocument(blocks, measures, options);

      // Expected column widths for each section:
      // Base: 612 - (72 + 72) = 468 (single column)
      // Section 1 and 2: inherit base content width, apply their own columns
      // Actual layout shows sections inherit base page dimensions (612 - 144 = 468)
      // Section 1: (468 - 48) / 2 = 210
      // Section 2: (468 - 48) / 3 = 140

      // Find fragments and verify widths
      const paraBaseFragments = layout.pages.flatMap((p) => p.fragments).filter((f) => f.blockId === 'para-base');
      const paraSection1Fragments = layout.pages
        .flatMap((p) => p.fragments)
        .filter((f) => f.blockId === 'para-section-1');
      const paraSection2Fragments = layout.pages
        .flatMap((p) => p.fragments)
        .filter((f) => f.blockId === 'para-section-2');

      // Base section: single column, width = 468
      expect(paraBaseFragments[0].width).toBeCloseTo(468, 0);

      // Section 1: two columns, width = 210
      expect(paraSection1Fragments[0].width).toBeCloseTo(210, 0);

      // Section 2: three columns, width = 140
      expect(paraSection2Fragments[0].width).toBeCloseTo(140, 0);

      // Verify layout includes column configuration
      expect(layout.columns).toBeDefined();
    });
  });

  describe('column balancing safeguards', () => {
    /**
     * Tests for the column balancing safeguards that prevent incorrect redistribution
     * of fragments when pages contain mixed content from different column configurations.
     */

    it('skips balancing when fragments have explicit column structure from column breaks', () => {
      // When fragments are already in multiple columns (different X positions),
      // balancing should be skipped to preserve explicit column break positioning.
      const toTwoColumns: FlowBlock = {
        kind: 'sectionBreak',
        id: 'sb-1',
        type: 'continuous',
        columns: { count: 2, gap: 48 },
        margins: {},
      };

      const blocks: FlowBlock[] = [
        toTwoColumns,
        { kind: 'paragraph', id: 'p1', runs: [] },
        { kind: 'columnBreak', id: 'br-1' } as ColumnBreakBlock,
        { kind: 'paragraph', id: 'p2', runs: [] },
      ];

      const measures: Measure[] = [
        { kind: 'sectionBreak' },
        makeMeasure([40]),
        { kind: 'columnBreak' },
        makeMeasure([40]),
      ];

      const options: LayoutOptions = {
        pageSize: { w: 612, h: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
      };

      const layout = layoutDocument(blocks, measures, options);
      const page = layout.pages[0];

      const p1 = page.fragments.find((f) => f.blockId === 'p1');
      const p2 = page.fragments.find((f) => f.blockId === 'p2');

      // p1 should be in column 0, p2 in column 1 (after column break)
      // Balancing should NOT have redistributed them
      expect(p1?.x).toBe(options.margins!.left);
      expect(p2?.x).toBeGreaterThan(p1!.x);
    });

    it('skips balancing when fragments have different widths from multiple sections', () => {
      // When fragments have different widths (indicating different column configs),
      // balancing should be skipped to preserve section-specific widths.
      const options: LayoutOptions = {
        pageSize: { w: 612, h: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
        columns: { count: 1, gap: 0 },
      };

      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'para-single', runs: [] },
        {
          kind: 'sectionBreak',
          id: 'section-2col',
          type: 'continuous',
          columns: { count: 2, gap: 48 },
          margins: {},
        } as SectionBreakBlock,
        { kind: 'paragraph', id: 'para-2col', runs: [] },
      ];

      const measures: Measure[] = [makeMeasure([20]), { kind: 'sectionBreak' }, makeMeasure([20])];

      const layout = layoutDocument(blocks, measures, options);

      const singleColFragment = layout.pages.flatMap((p) => p.fragments).find((f) => f.blockId === 'para-single');
      const twoColFragment = layout.pages.flatMap((p) => p.fragments).find((f) => f.blockId === 'para-2col');

      // Single column fragment should keep its original width (468 = 612 - 72 - 72)
      expect(singleColFragment?.width).toBeCloseTo(468, 0);

      // Two column fragment should have column width (210 = (468 - 48) / 2)
      expect(twoColFragment?.width).toBeCloseTo(210, 0);

      // Balancing should NOT have made them the same width
      expect(singleColFragment?.width).not.toBeCloseTo(twoColFragment!.width, 0);
    });
  });

  describe('column balancing at section boundaries (SD-2452)', () => {
    /**
     * End-to-end tests for the column-balancing feature.
     *
     * These tests drive layoutDocument with synthetic blocks/measures and assert on
     * the OBSERVABLE fragment positions produced by the full pipeline — not on internal
     * helper calls. When Word's algorithm changes or when we swap out the balancing
     * implementation, these tests continue to assert what users see.
     */

    const PAGE: LayoutOptions = {
      pageSize: { w: 612, h: 792 },
      margins: { top: 72, right: 72, bottom: 72, left: 72 },
    };
    const LEFT_MARGIN = 72;
    const CONTENT_WIDTH = 612 - 72 - 72; // 468
    const COLUMN_GAP = 48;
    const TWO_COL_WIDTH = (CONTENT_WIDTH - COLUMN_GAP) / 2; // 210
    const TWO_COL_RIGHT_X = LEFT_MARGIN + TWO_COL_WIDTH + COLUMN_GAP; // 330

    /** Build a 2-col section ending with a section break, surrounded by single-column context. */
    function buildTwoColumnSection(paragraphCount: number, lineHeight = 20, endBreakType = 'continuous') {
      const blocks: FlowBlock[] = [
        {
          kind: 'sectionBreak',
          id: 'sb-start',
          type: 'continuous',
          columns: { count: 2, gap: COLUMN_GAP },
          margins: {},
          attrs: { source: 'sectPr', sectionIndex: 0, isFirstSection: true },
        } as FlowBlock,
      ];
      const measures: Measure[] = [{ kind: 'sectionBreak' }];

      for (let i = 0; i < paragraphCount; i++) {
        blocks.push({ kind: 'paragraph', id: `p${i}`, runs: [], attrs: { sectionIndex: 0 } } as FlowBlock);
        measures.push(makeMeasure([lineHeight]));
      }

      blocks.push({
        kind: 'sectionBreak',
        id: 'sb-end',
        type: endBreakType,
        columns: { count: 1, gap: 0 },
        margins: {},
        attrs: { source: 'sectPr', sectionIndex: 1 },
      } as FlowBlock);
      measures.push({ kind: 'sectionBreak' });

      blocks.push({ kind: 'paragraph', id: 'p-after', runs: [], attrs: { sectionIndex: 1 } } as FlowBlock);
      measures.push(makeMeasure([lineHeight]));

      return { blocks, measures };
    }

    it('distributes 6 equal paragraphs evenly across 2 columns (3+3)', () => {
      const { blocks, measures } = buildTwoColumnSection(6, 20);

      const layout = layoutDocument(blocks, measures, PAGE);

      const sectionFragments = layout.pages[0].fragments.filter(
        (f): f is ParaFragment => f.kind === 'para' && f.blockId.startsWith('p') && f.blockId !== 'p-after',
      );
      const col0 = sectionFragments.filter((f) => f.x === LEFT_MARGIN);
      const col1 = sectionFragments.filter((f) => f.x === TWO_COL_RIGHT_X);

      expect(col0.length + col1.length).toBe(6);
      // Minimum-height balance of 6 equal 20px paragraphs across 2 columns is 3+3
      // (tallest column = 60px). Any split closer to 1+5 or 2+4 produces a taller
      // section than Word would render. This assertion fails if balancing is absent,
      // uses an incorrect algorithm, or runs with a wrong available height.
      expect(col0).toHaveLength(3);
      expect(col1).toHaveLength(3);
    });

    it('places post-section single-column content just below the balanced columns', () => {
      // Before the fix: "p-after" sat below all 6 paragraphs stacked in col 0 (y ~= top + 120).
      // After the fix: columns balance to 3+3 (height = top + 60), so p-after starts at top + 60.
      const { blocks, measures } = buildTwoColumnSection(6, 20);

      const layout = layoutDocument(blocks, measures, PAGE);
      const firstSectionPara = layout.pages[0].fragments.find(
        (f): f is ParaFragment => f.kind === 'para' && f.blockId === 'p0',
      );
      const afterSectionPara = layout.pages[0].fragments.find(
        (f): f is ParaFragment => f.kind === 'para' && f.blockId === 'p-after',
      );
      expect(firstSectionPara).toBeDefined();
      expect(afterSectionPara).toBeDefined();

      // p-after's Y reflects a balanced 3-row column (3 × 20px) above it.
      const expectedBalancedBottom = firstSectionPara!.y + 3 * 20;
      expect(afterSectionPara!.y).toBe(expectedBalancedBottom);
    });

    it('splits a paragraph straddling the column boundary so the section balances (SD-3359)', () => {
      // IT-1150 / SD-3359 repro shape: two 1-line paragraphs plus one 14-line
      // paragraph (280px) in a 2-col continuous section followed by continuous
      // single-column content. Atomic assignment can only reach 40 | 280;
      // Word flows line-by-line, splitting the long paragraph at the boundary
      // so both columns reach the minimum section height (§17.18.77):
      // col0 = 20 + 20 + 6 lines (160), col1 = 8 lines (160).
      const blocks: FlowBlock[] = [
        {
          kind: 'sectionBreak',
          id: 'sb-start',
          type: 'continuous',
          columns: { count: 2, gap: COLUMN_GAP },
          margins: {},
          attrs: { source: 'sectPr', sectionIndex: 0, isFirstSection: true },
        } as FlowBlock,
        { kind: 'paragraph', id: 'p0', runs: [], attrs: { sectionIndex: 0 } } as FlowBlock,
        { kind: 'paragraph', id: 'p1', runs: [], attrs: { sectionIndex: 0 } } as FlowBlock,
        { kind: 'paragraph', id: 'p-long', runs: [], attrs: { sectionIndex: 0 } } as FlowBlock,
        {
          kind: 'sectionBreak',
          id: 'sb-end',
          type: 'continuous',
          columns: { count: 1, gap: 0 },
          margins: {},
          attrs: { source: 'sectPr', sectionIndex: 1 },
        } as FlowBlock,
        { kind: 'paragraph', id: 'p-after', runs: [], attrs: { sectionIndex: 1 } } as FlowBlock,
      ];
      const measures: Measure[] = [
        { kind: 'sectionBreak' },
        makeMeasure([20]),
        makeMeasure([20]),
        makeMeasure(Array(14).fill(20)),
        { kind: 'sectionBreak' },
        makeMeasure([20]),
      ];

      const layout = layoutDocument(blocks, measures, PAGE);

      const longFrags = layout.pages[0].fragments
        .filter((f): f is ParaFragment => f.kind === 'para' && f.blockId === 'p-long')
        .sort((a, b) => a.fromLine - b.fromLine);
      // The straddling paragraph split into two fragments partitioning its lines.
      expect(longFrags).toHaveLength(2);
      expect(longFrags[0].toLine).toBe(longFrags[1].fromLine);
      expect(longFrags[1].toLine).toBe(14);
      expect(longFrags[0].x).toBe(LEFT_MARGIN);
      expect(longFrags[1].x).toBe(TWO_COL_RIGHT_X);
      // Both columns reach the same minimum height (320 / 2 = 160).
      const pAfter = layout.pages[0].fragments.find(
        (f): f is ParaFragment => f.kind === 'para' && f.blockId === 'p-after',
      );
      expect(pAfter).toBeDefined();
      expect(pAfter!.y).toBe(72 + 160);
    });

    it('does NOT balance a 2-col section whose END break is nextPage (§17.18.77, SD-3359)', () => {
      // Per the §17.18.77 note only a CONTINUOUS break balances the previous
      // section. A 2-col section that merely STARTS continuous but is ended by
      // a nextPage break fills column-by-column instead (Word behavior), and
      // the following section starts on a fresh page. Regression for the
      // post-layout gate that previously keyed off the section's own begin
      // type instead of the break that ends it.
      const { blocks, measures } = buildTwoColumnSection(6, 20, 'nextPage');

      const layout = layoutDocument(blocks, measures, PAGE);

      const sectionFragments = layout.pages[0].fragments.filter(
        (f): f is ParaFragment => f.kind === 'para' && f.blockId.startsWith('p') && f.blockId !== 'p-after',
      );
      // Unbalanced column-by-column fill: all 6 short paragraphs stay in col 0.
      expect(sectionFragments.filter((f) => f.x === LEFT_MARGIN)).toHaveLength(6);
      expect(sectionFragments.filter((f) => f.x === TWO_COL_RIGHT_X)).toHaveLength(0);
      // The nextPage break pushes the following section to page 2.
      expect(layout.pages.length).toBe(2);
      const pAfter = layout.pages[1].fragments.find(
        (f): f is ParaFragment => f.kind === 'para' && f.blockId === 'p-after',
      );
      expect(pAfter).toBeDefined();
    });

    it('fills BOTH columns on every page of a multi-page 2-col continuous section', () => {
      // ECMA-376 §17.18.77 (ST_SectionMark): a continuous section break
      // "balances content of the previous section." Word's observable behavior
      // is to fill col 0 to the balanced target, wrap to col 1 to the same
      // target, then wrap to the next page — on EVERY page, not only the last.
      // Regression for SD-2646: earlier pages must not stack content in col 0.
      const lineHeight = 20;
      const paraCount = 100; // ≈ 2000px, exceeds one page's content area
      const { blocks, measures } = buildTwoColumnSection(paraCount, lineHeight);

      const layout = layoutDocument(blocks, measures, PAGE);

      expect(layout.pages.length).toBeGreaterThanOrEqual(2);

      for (const page of layout.pages) {
        const sectionFragments = page.fragments.filter(
          (f): f is ParaFragment => f.kind === 'para' && f.blockId.startsWith('p') && f.blockId !== 'p-after',
        );
        if (sectionFragments.length < 2) continue; // tail of last page may have <2 fragments
        const col0 = sectionFragments.filter((f) => Math.round(f.x) === LEFT_MARGIN);
        const col1 = sectionFragments.filter((f) => Math.round(f.x) === TWO_COL_RIGHT_X);
        expect(col0.length).toBeGreaterThan(0);
        expect(col1.length).toBeGreaterThan(0);
      }
    });

    it('flows a narrow multi-page table across both columns on every page (SD-2646 regression)', () => {
      // IT-945 shape: a narrow table (one column wide) inside a 2-col continuous
      // section, spanning multiple pages. Regression guard for the layout path
      // once pm-adapter correctly places the table in the 2-col section.
      const rowCount = 114;
      const rowHeight = 18.4;
      const cellWidth = TWO_COL_WIDTH / 2;

      const rows = Array.from({ length: rowCount }, (_, r) => ({
        id: `tbl-row-${r}`,
        cells: [
          { id: `tbl-cell-${r}-0`, paragraph: { kind: 'paragraph' as const, id: `tbl-cell-${r}-0-p`, runs: [] } },
          { id: `tbl-cell-${r}-1`, paragraph: { kind: 'paragraph' as const, id: `tbl-cell-${r}-1-p`, runs: [] } },
        ],
      }));
      const tbl: TableBlock = {
        kind: 'table',
        id: 'tbl',
        rows,
        attrs: { sectionIndex: 0 },
      } as TableBlock;
      const tblM: TableMeasure = {
        kind: 'table',
        rows: Array.from({ length: rowCount }, () => ({
          height: rowHeight,
          cells: [
            { paragraph: makeMeasure([rowHeight]), width: cellWidth, height: rowHeight },
            { paragraph: makeMeasure([rowHeight]), width: cellWidth, height: rowHeight },
          ],
        })),
        columnWidths: [cellWidth, cellWidth],
        totalWidth: cellWidth * 2,
        totalHeight: rowHeight * rowCount,
      };

      const blocks: FlowBlock[] = [
        {
          kind: 'sectionBreak',
          id: 'sb-start',
          type: 'continuous',
          columns: { count: 2, gap: COLUMN_GAP },
          margins: {},
          attrs: { source: 'sectPr', sectionIndex: 0, isFirstSection: true },
        } as FlowBlock,
        tbl as FlowBlock,
        {
          kind: 'sectionBreak',
          id: 'sb-end',
          type: 'continuous',
          columns: { count: 1, gap: 0 },
          margins: {},
          attrs: { source: 'sectPr', sectionIndex: 1 },
        } as FlowBlock,
      ];
      const measures: Measure[] = [{ kind: 'sectionBreak' }, tblM, { kind: 'sectionBreak' }];

      const layout = layoutDocument(blocks, measures, PAGE);

      expect(layout.pages.length).toBeGreaterThanOrEqual(2);

      let pagesWithBothColumns = 0;
      for (const page of layout.pages) {
        const tableFragments = page.fragments.filter((f) => f.kind === 'table');
        if (tableFragments.length === 0) continue;
        const col0 = tableFragments.filter((f) => Math.round(f.x) === LEFT_MARGIN);
        const col1 = tableFragments.filter((f) => Math.round(f.x) === TWO_COL_RIGHT_X);
        if (col0.length > 0 && col1.length > 0) pagesWithBothColumns++;
      }
      // At least one page must have fragments in both columns. A stricter
      // assertion (every page) is made invalid by the tail of the final page
      // which can reasonably hold <1 column's worth of content.
      expect(pagesWithBothColumns).toBeGreaterThan(0);
    });

    it('distributes 6 paragraphs across 3 columns (no column is empty)', () => {
      const threeColStart: FlowBlock = {
        kind: 'sectionBreak',
        id: 'sb-start',
        type: 'continuous',
        columns: { count: 3, gap: 24 },
        margins: {},
        attrs: { source: 'sectPr', sectionIndex: 0, isFirstSection: true },
      } as FlowBlock;
      const sectionEnd: FlowBlock = {
        kind: 'sectionBreak',
        id: 'sb-end',
        type: 'continuous',
        columns: { count: 1, gap: 0 },
        margins: {},
        attrs: { source: 'sectPr', sectionIndex: 1 },
      } as FlowBlock;

      const blocks: FlowBlock[] = [threeColStart];
      const measures: Measure[] = [{ kind: 'sectionBreak' }];
      for (let i = 0; i < 6; i++) {
        blocks.push({ kind: 'paragraph', id: `p${i}`, runs: [], attrs: { sectionIndex: 0 } } as FlowBlock);
        measures.push(makeMeasure([20]));
      }
      blocks.push(sectionEnd);
      measures.push({ kind: 'sectionBreak' });

      const layout = layoutDocument(blocks, measures, PAGE);

      const fragments = layout.pages[0].fragments.filter(
        (f): f is ParaFragment => f.kind === 'para' && f.blockId.startsWith('p'),
      );
      const uniqueX = new Set(fragments.map((f) => Math.round(f.x)));
      // All three columns should be used — no column is empty.
      expect(uniqueX.size).toBe(3);
    });

    it('leaves fragments untouched when the section has an explicit column break', () => {
      // Author-placed <w:br w:type="column"/> must override balancing.
      const blocks: FlowBlock[] = [
        {
          kind: 'sectionBreak',
          id: 'sb-start',
          type: 'continuous',
          columns: { count: 2, gap: COLUMN_GAP },
          margins: {},
          attrs: { source: 'sectPr', sectionIndex: 0, isFirstSection: true },
        } as FlowBlock,
        { kind: 'paragraph', id: 'p1', runs: [], attrs: { sectionIndex: 0 } } as FlowBlock,
        { kind: 'columnBreak', id: 'br', attrs: { sectionIndex: 0 } } as ColumnBreakBlock,
        { kind: 'paragraph', id: 'p2', runs: [], attrs: { sectionIndex: 0 } } as FlowBlock,
        {
          kind: 'sectionBreak',
          id: 'sb-end',
          type: 'continuous',
          columns: { count: 1, gap: 0 },
          margins: {},
          attrs: { source: 'sectPr', sectionIndex: 1 },
        } as FlowBlock,
      ];
      const measures: Measure[] = [
        { kind: 'sectionBreak' },
        makeMeasure([20]),
        { kind: 'columnBreak' },
        makeMeasure([20]),
        { kind: 'sectionBreak' },
      ];

      const layout = layoutDocument(blocks, measures, PAGE);

      const p1 = layout.pages[0].fragments.find((f) => f.blockId === 'p1') as ParaFragment;
      const p2 = layout.pages[0].fragments.find((f) => f.blockId === 'p2') as ParaFragment;

      // Author's column break is preserved: p1 in col 0, p2 in col 1.
      expect(p1.x).toBe(LEFT_MARGIN);
      expect(p2.x).toBe(TWO_COL_RIGHT_X);
    });
  });
});

describe('paragraph adjacency across in-flow blocks (SD-3377)', () => {
  const boundaryOptions: LayoutOptions = {
    pageSize: { w: 600, h: 800 },
    margins: { top: 50, right: 50, bottom: 50, left: 50 },
  };

  const makeAdjacentParagraph = (
    id: string,
    attrs: NonNullable<Extract<FlowBlock, { kind: 'paragraph' }>['attrs']>,
  ): FlowBlock => ({
    kind: 'paragraph',
    id,
    runs: [{ text: id }],
    attrs,
  });

  const firstParagraph = (): FlowBlock =>
    makeAdjacentParagraph('before', {
      styleId: 'ListParagraph',
      contextualSpacing: true,
      spacing: { after: 8 },
    });

  const followingParagraph = (attrs: Record<string, unknown> = {}): FlowBlock =>
    makeAdjacentParagraph('after', {
      styleId: 'ListParagraph',
      contextualSpacing: true,
      spacing: { before: 6 },
      ...attrs,
    });

  const paragraphFragment = (layout: ReturnType<typeof layoutDocument>, blockId: string): ParaFragment => {
    const fragment = layout.pages
      .flatMap((page) => page.fragments)
      .find((candidate): candidate is ParaFragment => candidate.kind === 'para' && candidate.blockId === blockId);
    expect(fragment).toBeDefined();
    return fragment!;
  };

  const tableFragments = (layout: ReturnType<typeof layoutDocument>, blockId: string): TableFragment[] =>
    layout.pages
      .flatMap((page) => page.fragments)
      .filter((candidate): candidate is TableFragment => candidate.kind === 'table' && candidate.blockId === blockId);

  it.each([
    ['same-style contextual paragraphs', followingParagraph()],
    ['different paragraph styles', followingParagraph({ styleId: 'BodyText' })],
    ['contextual spacing disabled', followingParagraph({ contextualSpacing: false })],
  ])('keeps the following paragraph below an inline table for %s', (_label, after) => {
    const table = makeTableBlock('boundary-table', 1);
    const layout = layoutDocument(
      [firstParagraph(), table, after],
      [makeMeasure([10]), makeTableMeasure([200], [20]), makeMeasure([10])],
      boundaryOptions,
    );

    const [tableFragment] = tableFragments(layout, table.id);
    const afterFragment = paragraphFragment(layout, 'after');

    expect(tableFragment.y).toBe(68);
    expect(afterFragment.y).toBe(tableFragment.y + tableFragment.height + 6);
  });

  it('does not join matching paragraph border groups through an inline table', () => {
    const borders = {
      top: { style: 'solid' as const, width: 2 },
      bottom: { style: 'solid' as const, width: 2 },
      between: { style: 'solid' as const, width: 1 },
    };
    const before = makeAdjacentParagraph('before', {
      styleId: 'ListParagraph',
      contextualSpacing: true,
      spacing: { after: 8 },
      borders,
    });
    const after = makeAdjacentParagraph('after', {
      styleId: 'ListParagraph',
      contextualSpacing: true,
      spacing: { before: 6 },
      borders,
    });
    const table = makeTableBlock('border-boundary-table', 1);
    const layout = layoutDocument(
      [before, table, after],
      [makeMeasure([10]), makeTableMeasure([200], [20]), makeMeasure([10])],
      boundaryOptions,
    );

    const [tableFragment] = tableFragments(layout, table.id);
    const afterFragment = paragraphFragment(layout, after.id);

    // The next paragraph owns its 6px before-spacing and 2px top border.
    expect(afterFragment.y).toBe(tableFragment.y + tableFragment.height + 8);
  });

  it('breaks adjacency for a full-width anchored table that participates in body flow', () => {
    const table = makeTableBlock('full-width-table', 1, {
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'column',
        vRelativeFrom: 'paragraph',
        offsetH: 0,
        offsetV: 0,
      },
      wrap: { type: 'None' },
    });
    const layout = layoutDocument(
      [firstParagraph(), table, followingParagraph()],
      [makeMeasure([10]), makeTableMeasure([500], [20]), makeMeasure([10])],
      boundaryOptions,
    );

    const [tableFragment] = tableFragments(layout, table.id);
    const afterFragment = paragraphFragment(layout, 'after');

    expect(tableFragment.isAnchored).not.toBe(true);
    expect(afterFragment.y).toBe(tableFragment.y + tableFragment.height + 6);
  });

  it('breaks adjacency for a table whose measured-row list is empty', () => {
    const table: TableBlock = { kind: 'table', id: 'empty-measure-table', rows: [] };
    const tableMeasure: TableMeasure = {
      kind: 'table',
      rows: [],
      columnWidths: [200],
      totalWidth: 200,
      totalHeight: 20,
    };
    const layout = layoutDocument(
      [firstParagraph(), table, followingParagraph()],
      [makeMeasure([10]), tableMeasure, makeMeasure([10])],
      boundaryOptions,
    );

    const [tableFragment] = tableFragments(layout, table.id);
    const afterFragment = paragraphFragment(layout, 'after');

    expect(afterFragment.y).toBe(tableFragment.y + tableFragment.height + 6);
  });

  it('breaks adjacency for a height-consuming monolithic table contract input', () => {
    const table = makeTableBlock('monolithic-table', 1);
    table.attrs = {
      tableProperties: { floatingTableProperties: { horizontalAnchor: 'page' } },
    } as TableBlock['attrs'];
    const layout = layoutDocument(
      [firstParagraph(), table, followingParagraph()],
      [makeMeasure([10]), makeTableMeasure([200], [20]), makeMeasure([10])],
      boundaryOptions,
    );

    const [tableFragment] = tableFragments(layout, table.id);
    const afterFragment = paragraphFragment(layout, 'after');

    expect(afterFragment.y).toBe(tableFragment.y + tableFragment.height + 6);
  });

  it('retains the adjacency break when table preflight advances to a fresh page', () => {
    const table = makeTableBlock('page-boundary-table', 1);
    table.rows[0]!.attrs = { tableRowProperties: { cantSplit: true } };
    const layout = layoutDocument(
      [firstParagraph(), table, followingParagraph()],
      [makeMeasure([30]), makeTableMeasure([200], [35]), makeMeasure([10])],
      {
        pageSize: { w: 300, h: 90 },
        margins: { top: 10, right: 10, bottom: 10, left: 10 },
      },
    );

    const [tableFragment] = tableFragments(layout, table.id);
    const afterFragment = paragraphFragment(layout, 'after');
    const tablePage = layout.pages.findIndex((page) => page.fragments.includes(tableFragment));
    const afterPage = layout.pages.findIndex((page) => page.fragments.includes(afterFragment));

    expect(tablePage).toBe(1);
    expect(afterPage).toBe(tablePage);
    expect(afterFragment.y).toBe(tableFragment.y + tableFragment.height + 6);
  });

  it('preserves paragraph adjacency across a genuinely out-of-flow anchored table', () => {
    const table = makeTableBlock('floating-table', 1, {
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'column',
        vRelativeFrom: 'paragraph',
        offsetH: 0,
        offsetV: 0,
      },
      wrap: { type: 'Square', wrapText: 'right' },
    });
    const layout = layoutDocument(
      [firstParagraph(), table, followingParagraph()],
      [makeMeasure([10]), makeTableMeasure([100], [20]), makeMeasure([10])],
      boundaryOptions,
    );

    const [tableFragment] = tableFragments(layout, table.id);
    const afterFragment = paragraphFragment(layout, 'after');

    expect(tableFragment.y).toBe(60);
    expect(afterFragment.y).toBe(60);
  });

  it.each([
    [
      'image',
      { kind: 'image', id: 'flow-image', src: 'data:image/png;base64,AA==' } as ImageBlock,
      { kind: 'image', width: 30, height: 20 } as ImageMeasure,
    ],
    [
      'drawing',
      {
        kind: 'drawing',
        id: 'flow-drawing',
        drawingKind: 'vectorShape',
        geometry: { width: 30, height: 20 },
      } as FlowBlock,
      {
        kind: 'drawing',
        drawingKind: 'vectorShape',
        width: 30,
        height: 20,
        scale: 1,
        naturalWidth: 30,
        naturalHeight: 20,
        geometry: { width: 30, height: 20 },
      } as DrawingMeasure,
    ],
  ])('breaks paragraph adjacency for an in-flow %s', (_label, boundary, boundaryMeasure) => {
    const layout = layoutDocument(
      [firstParagraph(), boundary, followingParagraph()],
      [makeMeasure([10]), boundaryMeasure, makeMeasure([10])],
      boundaryOptions,
    );
    const boundaryFragment = layout.pages
      .flatMap((page) => page.fragments)
      .find((candidate) => candidate.blockId === boundary.id)!;
    const afterFragment = paragraphFragment(layout, 'after');

    expect(afterFragment.y).toBe(boundaryFragment.y + boundaryFragment.height + 6);
  });

  it.each([
    [
      'image',
      {
        kind: 'image',
        id: 'anchored-image',
        src: 'data:image/png;base64,AA==',
        anchor: { isAnchored: true, hRelativeFrom: 'column', vRelativeFrom: 'paragraph' },
        wrap: { type: 'None' },
      } as ImageBlock,
      { kind: 'image', width: 30, height: 20 } as ImageMeasure,
    ],
    [
      'drawing',
      {
        kind: 'drawing',
        id: 'anchored-drawing',
        drawingKind: 'vectorShape',
        geometry: { width: 30, height: 20 },
        anchor: { isAnchored: true, hRelativeFrom: 'column', vRelativeFrom: 'paragraph' },
        wrap: { type: 'None' },
      } as FlowBlock,
      {
        kind: 'drawing',
        drawingKind: 'vectorShape',
        width: 30,
        height: 20,
        scale: 1,
        naturalWidth: 30,
        naturalHeight: 20,
        geometry: { width: 30, height: 20 },
      } as DrawingMeasure,
    ],
  ])('preserves paragraph adjacency across an out-of-flow anchored %s', (_label, boundary, boundaryMeasure) => {
    const layout = layoutDocument(
      [firstParagraph(), boundary, followingParagraph()],
      [makeMeasure([10]), boundaryMeasure, makeMeasure([10])],
      boundaryOptions,
    );

    expect(paragraphFragment(layout, 'after').y).toBe(60);
  });

  it('keeps the following paragraph below the final fragment of a split table', () => {
    const table = makeTableBlock('split-table', 3);
    const layout = layoutDocument(
      [firstParagraph(), table, followingParagraph()],
      [makeMeasure([10]), makeTableMeasure([200], [35, 35, 35]), makeMeasure([10])],
      {
        pageSize: { w: 300, h: 100 },
        margins: { top: 10, right: 10, bottom: 10, left: 10 },
      },
    );

    const fragments = tableFragments(layout, table.id);
    const lastTable = fragments.at(-1)!;
    const afterFragment = paragraphFragment(layout, 'after');
    const lastTablePage = layout.pages.findIndex((page) => page.fragments.includes(lastTable));
    const afterPage = layout.pages.findIndex((page) => page.fragments.includes(afterFragment));

    expect(fragments.length).toBeGreaterThan(1);
    expect(afterPage).toBeGreaterThanOrEqual(lastTablePage);
    if (afterPage === lastTablePage) {
      expect(afterFragment.y).toBeGreaterThanOrEqual(lastTable.y + lastTable.height + 6);
    }
  });
});

describe('layoutHeaderFooter', () => {
  it('lays out content within the provided constraints', () => {
    const layout = layoutHeaderFooter([block], [makeMeasure([30, 10])], { width: 400, height: 80 });

    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0].fragments[0].x).toBe(0);
    expect(layout.pages[0].fragments[0].y).toBe(0);
    expect(layout.height).toBeCloseTo(40);
    expect(layout.pages[0]).toMatchObject({
      measurementHeight: 40,
      minY: 0,
      maxY: 40,
      renderHeight: 40,
    });
  });

  it('baseline-aligns an inline zero-height connector to its carrier without moving later footer text', () => {
    const carrier: FlowBlock = {
      kind: 'paragraph',
      id: 'footer-connector-carrier',
      runs: [{ text: '', fontFamily: 'Arial', fontSize: 12 }],
      attrs: { spacing: { before: 16 } },
    };
    const connector: FlowBlock = {
      kind: 'drawing',
      id: 'footer-connector',
      drawingKind: 'vectorShape',
      geometry: { width: 700, height: 7 },
      effectExtent: { left: 0, top: 2, right: 5, bottom: 4 },
      shapeKind: 'line',
      strokeLineCap: 'butt',
      attrs: {
        anchorParagraphId: carrier.id,
        wrap: { type: 'Inline' },
        sourceExtent: { width: 695, height: 0 },
      },
    };
    const footerText: FlowBlock = {
      kind: 'paragraph',
      id: 'footer-text',
      runs: [{ text: 'Global Whistleblowing Policy', fontFamily: 'Arial', fontSize: 12 }],
      attrs: { spacing: { before: 16 } },
    };
    const drawingMeasure: DrawingMeasure = {
      kind: 'drawing',
      drawingKind: 'vectorShape',
      width: 700,
      height: 7,
      scale: 1,
      naturalWidth: 700,
      naturalHeight: 7,
      geometry: { width: 700, height: 7, rotation: 0, flipH: false, flipV: false },
    };

    const layout = layoutHeaderFooter(
      [connector, carrier, footerText],
      [drawingMeasure, makeMeasure([16]), makeMeasure([16])],
      { width: 695, height: 100 },
      'footer',
    );
    const connectorFragment = layout.pages[0].fragments.find(
      (fragment): fragment is DrawingFragment => fragment.kind === 'drawing',
    );
    const carrierFragment = layout.pages[0].fragments.find((fragment) => fragment.blockId === carrier.id);
    const footerTextFragment = layout.pages[0].fragments.find((fragment) => fragment.blockId === footerText.id);

    expect(connectorFragment).toBeDefined();
    // Fit decisions use the authored 695px line. The theme-resolved flat cap
    // adds no endpoint overflow; only the authored right effect remains.
    expect(connectorFragment?.x).toBe(0);
    expect(connectorFragment?.width).toBe(700);
    expect(carrierFragment?.kind).toBe('para');
    expect(carrierFragment?.y).toBe(23);
    // The line center (effect top + half the 1px authored box) sits on the text baseline.
    expect(connectorFragment?.y).toBeCloseTo(23 + 12.8 - 2.5);
    // The connector still reserves its original flow height; only its paint position changes.
    expect(footerTextFragment?.y).toBe(55);
  });

  it('throws when width is invalid', () => {
    expect(() => layoutHeaderFooter([block], [makeMeasure([10])], { width: 0, height: 40 })).toThrow(
      /width must be positive/,
    );
  });

  it('returns empty layout when height is zero or negative', () => {
    // Zero height - common in edge-to-edge layouts with no margin space
    const zeroHeightLayout = layoutHeaderFooter([block], [makeMeasure([10])], { width: 200, height: 0 });
    expect(zeroHeightLayout.pages).toHaveLength(0);
    expect(zeroHeightLayout.height).toBe(0);

    // Negative height - edge case that should be handled gracefully
    const negativeHeightLayout = layoutHeaderFooter([block], [makeMeasure([10])], { width: 200, height: -10 });
    expect(negativeHeightLayout.pages).toHaveLength(0);
    expect(negativeHeightLayout.height).toBe(0);
  });

  it('splits overflow across implicit pages', () => {
    const layout = layoutHeaderFooter([block], [makeMeasure([60, 60, 60])], { width: 300, height: 80 });

    expect(layout.pages.length).toBeGreaterThan(1);
    expect(layout.height).toBeGreaterThan(0);
  });

  it('throws when block and measure counts differ', () => {
    expect(() => layoutHeaderFooter([block], [], { width: 200, height: 40 })).toThrow(/expected measures/);
  });

  it('handles empty content by returning zero height', () => {
    const layout = layoutHeaderFooter([], [], { width: 200, height: 40 });
    expect(layout.height).toBe(0);
    expect(layout.pages).toEqual([]);
  });

  it('does not synthesize blank pages for section-break-only header/footer layouts', () => {
    const sectionBreakBlock: SectionBreakBlock = {
      kind: 'sectionBreak',
      id: 'header-sb',
      attrs: { isFirstSection: true, source: 'sectPr' },
      pageSize: { w: 200, h: 80 },
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
    };

    const layout = layoutHeaderFooter([sectionBreakBlock], [{ kind: 'sectionBreak' }], { width: 200, height: 80 });

    expect(layout.pages).toEqual([]);
    expect(layout.height).toBe(0);
  });

  it('uses image measure height when fragment height missing', () => {
    const imageBlock: FlowBlock = {
      kind: 'image',
      id: 'img-1',
      src: 'data:image/png;base64,xxx',
    };
    const imageMeasure: Measure = {
      kind: 'image',
      width: 50,
      height: 40,
    };

    const layout = layoutHeaderFooter([imageBlock], [imageMeasure], { width: 200, height: 60 });

    expect(layout.height).toBe(40);
    expect(layout.pages[0].fragments[0]).toMatchObject({ kind: 'image', height: 40 });
  });

  it('includes table fragment height in the measured header height (SD-1581)', () => {
    // A header whose content is a table must report a height that includes the
    // table rows; otherwise the header region cannot grow to fit the table and the
    // body is not pushed below it, so the table overflows into the body.
    const tableBlock = makeTableBlock('hdr-table', 1);
    const tableMeasure = makeTableMeasure([200], [72]);

    const layout = layoutHeaderFooter([tableBlock], [tableMeasure], { width: 300, height: 400 });

    expect(layout.pages[0].fragments[0].kind).toBe('table');
    expect(layout.height).toBeGreaterThanOrEqual(72);
  });

  it('includes an ordinary table in measured footer height', () => {
    const tableBlock = makeTableBlock('footer-table', 1);
    const tableMeasure = makeTableMeasure([200], [72]);

    const layout = layoutHeaderFooter(
      [tableBlock],
      [tableMeasure],
      {
        width: 300,
        height: 400,
        pageWidth: 500,
        pageHeight: 600,
        margins: { left: 100, right: 100, top: 80, bottom: 80, footer: 40 },
      },
      'footer',
    );

    expect(layout.height).toBeGreaterThanOrEqual(72);
  });

  it('keeps a page-positioned floating header table in header flow', () => {
    const tableBlock = makeTableBlock('floating-header-table', 1, {
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'page',
        vRelativeFrom: 'page',
        alignH: 'right',
        alignV: 'bottom',
      },
      wrap: { type: 'Square' },
    });
    const carrierBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'header-carrier',
      runs: [{ text: '', fontFamily: 'Arial', fontSize: 12 }],
    };
    const tableMeasure = makeTableMeasure([100], [40]);
    const carrierMeasure = makeMeasure([15]);
    const constraints = {
      width: 300,
      height: 400,
      pageWidth: 500,
      pageHeight: 600,
      margins: { left: 100, right: 100, top: 80, bottom: 80, header: 40 },
    };

    const layout = layoutHeaderFooter(
      [tableBlock, carrierBlock],
      [tableMeasure, carrierMeasure],
      constraints,
      'header',
    );
    const fragment = layout.pages[0]?.fragments.find((candidate) => candidate.blockId === tableBlock.id);

    expect(layout.height).toBeLessThanOrEqual(constraints.height);
    expect(fragment).toMatchObject({ kind: 'table', x: 200, y: constraints.height - 40 });
  });

  it('excludes a page-positioned floating footer table from measured footer height', () => {
    const tableBlock = makeTableBlock('floating-footer-table', 1, {
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'page',
        vRelativeFrom: 'page',
        alignH: 'right',
        alignV: 'bottom',
      },
      wrap: { type: 'Square' },
    });
    const carrierBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'footer-carrier',
      runs: [{ text: '', fontFamily: 'Arial', fontSize: 12 }],
    };
    const tableMeasure = makeTableMeasure([100], [40]);
    const carrierMeasure = makeMeasure([15]);
    const constraints = {
      width: 300,
      height: 400,
      pageWidth: 500,
      pageHeight: 600,
      margins: { left: 100, right: 100, top: 80, bottom: 80, footer: 40 },
    };

    const layout = layoutHeaderFooter(
      [tableBlock, carrierBlock],
      [tableMeasure, carrierMeasure],
      constraints,
      'footer',
    );
    const fragment = layout.pages[0]?.fragments.find((candidate) => candidate.blockId === tableBlock.id);

    expect(layout.height).toBeCloseTo(15);
    expect(fragment).toMatchObject({
      kind: 'table',
      x: constraints.pageWidth - 100,
      y: constraints.margins.footer - 40,
    });
  });

  it('keeps a tall page-bottom footer table on the physical-page float path', () => {
    const tableBlock = makeTableBlock('tall-floating-footer-table', 1, {
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'page',
        vRelativeFrom: 'page',
        alignH: 'right',
        alignV: 'bottom',
      },
      wrap: { type: 'Square' },
    });
    const carrierBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'tall-footer-carrier',
      runs: [{ text: '', fontFamily: 'Arial', fontSize: 12 }],
    };
    const tableMeasure = makeTableMeasure([100], [500]);
    const carrierMeasure = makeMeasure([15]);
    const constraints = {
      width: 300,
      height: 400,
      pageWidth: 500,
      pageHeight: 600,
      margins: { left: 100, right: 100, top: 80, bottom: 80, footer: 40 },
    };

    const layout = layoutHeaderFooter(
      [tableBlock, carrierBlock],
      [tableMeasure, carrierMeasure],
      constraints,
      'footer',
    );
    const fragment = layout.pages[0]?.fragments.find((candidate) => candidate.blockId === tableBlock.id);

    expect(layout.height).toBeCloseTo(15);
    expect(fragment).toMatchObject({
      kind: 'table',
      isAnchored: true,
      x: constraints.pageWidth - 100,
      y: constraints.margins.footer - 500,
    });
  });

  it('resolves a page-relative floating footer table X against the physical page width', () => {
    const tableBlock = makeTableBlock('page-relative-x-footer-table', 1, {
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'page',
        vRelativeFrom: 'margin',
        alignH: 'right',
        alignV: 'bottom',
      },
      wrap: { type: 'Square' },
    });
    const carrierBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'page-relative-x-footer-carrier',
      runs: [{ text: '', fontFamily: 'Arial', fontSize: 12 }],
    };
    const tableMeasure = makeTableMeasure([100], [40]);
    const carrierMeasure = makeMeasure([15]);
    const constraints = {
      width: 300,
      height: 400,
      pageWidth: 500,
      pageHeight: 600,
      margins: { left: 100, right: 100, top: 80, bottom: 80, footer: 40 },
    };

    const layout = layoutHeaderFooter(
      [tableBlock, carrierBlock],
      [tableMeasure, carrierMeasure],
      constraints,
      'footer',
    );
    const fragment = layout.pages[0]?.fragments.find((candidate) => candidate.blockId === tableBlock.id);

    expect(fragment).toMatchObject({ kind: 'table', x: constraints.pageWidth - 100 });
  });

  it('keeps a full-width source-anchored footer table in footer flow', () => {
    const tableBlock = makeTableBlock('inline-footer-table', 1, {
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'page',
        vRelativeFrom: 'page',
        offsetH: 0,
        offsetV: 0,
      },
      wrap: { type: 'Square' },
    });
    const tableMeasure = makeTableMeasure([300], [40]);
    const constraints = {
      width: 300,
      height: 400,
      pageWidth: 500,
      pageHeight: 600,
      margins: { left: 100, right: 100, top: 80, bottom: 80, footer: 40 },
    };

    const layout = layoutHeaderFooter([tableBlock], [tableMeasure], constraints, 'footer');
    const fragment = layout.pages[0]?.fragments.find((candidate) => candidate.blockId === tableBlock.id);

    expect(layout.height).toBeGreaterThanOrEqual(40);
    expect(fragment).toMatchObject({ kind: 'table', x: 0, y: 0 });
    expect((fragment as TableFragment).isAnchored).not.toBe(true);
  });

  it('ignores far-away behindDoc anchored fragments when computing height', () => {
    const paragraphBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'para-1',
      runs: [{ text: 'Header text', fontFamily: 'Arial', fontSize: 12, pmStart: 1, pmEnd: 12 }],
    };
    const imageBlock: FlowBlock = {
      kind: 'image',
      id: 'img-1',
      src: 'data:image/png;base64,xxx',
      anchor: {
        isAnchored: true,
        behindDoc: true,
        offsetV: 1000,
      },
    };
    const paragraphMeasure: Measure = {
      kind: 'paragraph',
      lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 11, width: 80, ascent: 12, descent: 3, lineHeight: 15 }],
      totalHeight: 15,
    };
    const imageMeasure: Measure = {
      kind: 'image',
      width: 50,
      height: 40,
    };

    const layout = layoutHeaderFooter([paragraphBlock, imageBlock], [paragraphMeasure, imageMeasure], {
      width: 200,
      height: 60,
    });

    expect(layout.height).toBeCloseTo(15);
  });

  it('excludes ALL behindDoc anchored fragments from height (per OOXML spec)', () => {
    // Per OOXML spec, behindDoc is purely a z-ordering directive that should NOT affect layout.
    // Even "near" behindDoc images should be excluded from height calculations.
    const paragraphBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'para-1',
      runs: [{ text: 'Header text', fontFamily: 'Arial', fontSize: 12, pmStart: 1, pmEnd: 12 }],
    };
    const imageBlock: FlowBlock = {
      kind: 'image',
      id: 'img-1',
      src: 'data:image/png;base64,xxx',
      anchor: {
        isAnchored: true,
        behindDoc: true,
        offsetV: -20, // Even with small offset, behindDoc should not affect height
      },
    };
    const paragraphMeasure: Measure = {
      kind: 'paragraph',
      lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 11, width: 80, ascent: 12, descent: 3, lineHeight: 15 }],
      totalHeight: 15,
    };
    const imageMeasure: Measure = {
      kind: 'image',
      width: 50,
      height: 40,
    };

    const layout = layoutHeaderFooter([paragraphBlock, imageBlock], [paragraphMeasure, imageMeasure], {
      width: 200,
      height: 60,
    });

    // Height should only include paragraph, not the behindDoc image
    expect(layout.height).toBeCloseTo(15);
  });

  it('preserves page-relative horizontal anchor offset in header/footer layout', () => {
    // page-relative hRelativeFrom='page' offsets are passed through to the inner
    // layoutDocument unchanged. The painter handles the margin offset when
    // positioning the container on the page.
    const paragraphBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'para-1',
      runs: [{ text: 'Header text', fontFamily: 'Arial', fontSize: 12, pmStart: 1, pmEnd: 12 }],
    };
    const imageBlock: FlowBlock = {
      kind: 'image',
      id: 'img-1',
      src: 'data:image/png;base64,xxx',
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'page',
        offsetH: 545,
        offsetV: 0,
      },
    };
    const paragraphMeasure: Measure = {
      kind: 'paragraph',
      lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 11, width: 80, ascent: 12, descent: 3, lineHeight: 15 }],
      totalHeight: 15,
    };
    const imageMeasure: Measure = {
      kind: 'image',
      width: 200,
      height: 70,
    };

    const layout = layoutHeaderFooter([paragraphBlock, imageBlock], [paragraphMeasure, imageMeasure], {
      width: 602,
      height: 100,
      pageWidth: 816,
      margins: { left: 107, right: 107 },
    });

    expect(layout.pages).toHaveLength(1);
    const imageFragment = layout.pages[0].fragments.find((f) => f.kind === 'image');
    expect(imageFragment).toBeDefined();
    // offsetH is passed through to inner layout's computeAnchorX; the result
    // includes the offset plus margin-left added by computeAnchorX for page-relative.
    // Inner layout has margins=0, so computeAnchorX returns offsetH + 0 = 545.
    expect(imageFragment!.x).toBe(545);
  });

  it('does not transform anchor offset when margins not provided', () => {
    const paragraphBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'para-1',
      runs: [{ text: 'Header text', fontFamily: 'Arial', fontSize: 12, pmStart: 1, pmEnd: 12 }],
    };
    const imageBlock: FlowBlock = {
      kind: 'image',
      id: 'img-1',
      src: 'data:image/png;base64,xxx',
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'page',
        offsetH: 100,
        offsetV: 0,
      },
    };
    const paragraphMeasure: Measure = {
      kind: 'paragraph',
      lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 11, width: 80, ascent: 12, descent: 3, lineHeight: 15 }],
      totalHeight: 15,
    };
    const imageMeasure: Measure = {
      kind: 'image',
      width: 50,
      height: 40,
    };

    // No margins provided - should not transform (marginLeft defaults to 0)
    const layout = layoutHeaderFooter([paragraphBlock, imageBlock], [paragraphMeasure, imageMeasure], {
      width: 400,
      height: 60,
    });

    const imageFragment = layout.pages[0].fragments.find((f) => f.kind === 'image');
    expect(imageFragment).toBeDefined();
    // With no margin transform, offsetH stays at 100
    expect(imageFragment!.x).toBe(100);
  });

  it('does not transform non-page-relative anchors', () => {
    const paragraphBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'para-1',
      runs: [{ text: 'Header text', fontFamily: 'Arial', fontSize: 12, pmStart: 1, pmEnd: 12 }],
    };
    const imageBlock: FlowBlock = {
      kind: 'image',
      id: 'img-1',
      src: 'data:image/png;base64,xxx',
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'margin',
        offsetH: 50,
        offsetV: 0,
      },
    };
    const paragraphMeasure: Measure = {
      kind: 'paragraph',
      lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 11, width: 80, ascent: 12, descent: 3, lineHeight: 15 }],
      totalHeight: 15,
    };
    const imageMeasure: Measure = {
      kind: 'image',
      width: 50,
      height: 40,
    };

    const layout = layoutHeaderFooter([paragraphBlock, imageBlock], [paragraphMeasure, imageMeasure], {
      width: 400,
      height: 60,
      margins: { left: 100, right: 100 },
    });

    const imageFragment = layout.pages[0].fragments.find((f) => f.kind === 'image');
    expect(imageFragment).toBeDefined();
    // margin-relative anchors should not be transformed - offsetH stays at 50
    expect(imageFragment!.x).toBe(50);
  });

  it('ignores behindDoc DrawingBlock with extreme offset when computing height', () => {
    const paragraphBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'para-1',
      runs: [{ text: 'Header text', fontFamily: 'Arial', fontSize: 12, pmStart: 1, pmEnd: 12 }],
    };
    const drawingBlock: FlowBlock = {
      kind: 'drawing',
      id: 'drawing-1',
      drawingKind: 'vectorShape',
      geometry: { width: 100, height: 50 },
      anchor: {
        isAnchored: true,
        behindDoc: true,
        offsetV: 2000, // Extreme offset beyond overflow threshold
      },
      shapeKind: 'Rectangle',
    };
    const paragraphMeasure: Measure = {
      kind: 'paragraph',
      lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 11, width: 80, ascent: 12, descent: 3, lineHeight: 15 }],
      totalHeight: 15,
    };
    const drawingMeasure: Measure = {
      kind: 'drawing',
      drawingKind: 'vectorShape',
      width: 100,
      height: 50,
      scale: 1,
      naturalWidth: 100,
      naturalHeight: 50,
      geometry: { width: 100, height: 50, rotation: 0, flipH: false, flipV: false },
    };

    const layout = layoutHeaderFooter([paragraphBlock, drawingBlock], [paragraphMeasure, drawingMeasure], {
      width: 200,
      height: 60,
    });

    // Height should only include paragraph, not the extreme behindDoc drawing
    expect(layout.height).toBeCloseTo(15);
  });

  it('includes non-behindDoc anchored fragments in height calculation', () => {
    const paragraphBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'para-1',
      runs: [{ text: 'Header text', fontFamily: 'Arial', fontSize: 12, pmStart: 1, pmEnd: 12 }],
    };
    const imageBlock: FlowBlock = {
      kind: 'image',
      id: 'img-1',
      src: 'data:image/png;base64,xxx',
      anchor: {
        isAnchored: true,
        behindDoc: false, // NOT behindDoc - should be included in height
        offsetV: 20,
      },
    };
    const paragraphMeasure: Measure = {
      kind: 'paragraph',
      lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 11, width: 80, ascent: 12, descent: 3, lineHeight: 15 }],
      totalHeight: 15,
    };
    const imageMeasure: Measure = {
      kind: 'image',
      width: 50,
      height: 40,
    };

    const layout = layoutHeaderFooter([paragraphBlock, imageBlock], [paragraphMeasure, imageMeasure], {
      width: 200,
      height: 100,
    });

    // Height should include both paragraph and the anchored image
    // Image is at offsetV=20 with height 40, so bottom is at 60
    expect(layout.height).toBeGreaterThan(15);
    expect(layout.height).toBeCloseTo(60, 0);
  });

  it('excludes centered page-relative header overlays from measurement height', () => {
    const paragraphBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'para-1',
      runs: [{ text: 'Header text', fontFamily: 'Arial', fontSize: 12, pmStart: 1, pmEnd: 12 }],
    };
    const centeredOverlay: FlowBlock = {
      kind: 'drawing',
      id: 'drawing-1',
      drawingKind: 'vectorShape',
      geometry: { width: 596, height: 531 },
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'page',
        alignH: 'center',
        vRelativeFrom: 'page',
        alignV: 'center',
        behindDoc: false,
      },
      shapeKind: 'Rectangle',
    };
    const paragraphMeasure: Measure = {
      kind: 'paragraph',
      lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 11, width: 80, ascent: 12, descent: 3, lineHeight: 15 }],
      totalHeight: 15,
    };
    const overlayMeasure: Measure = {
      kind: 'drawing',
      drawingKind: 'vectorShape',
      width: 596,
      height: 531,
      scale: 1,
      naturalWidth: 596,
      naturalHeight: 531,
      geometry: { width: 596, height: 531, rotation: 0, flipH: false, flipV: false },
    };
    const constraints = {
      width: 624,
      height: 864,
      pageWidth: 816,
      pageHeight: 1056,
      margins: { left: 96, right: 96, top: 96, bottom: 96, header: 48 },
    };

    const layout = layoutHeaderFooter(
      [paragraphBlock, centeredOverlay],
      [paragraphMeasure, overlayMeasure],
      constraints,
      'header',
    );
    const overlayFragment = layout.pages[0]?.fragments.find((fragment) => fragment.blockId === 'drawing-1') as
      | DrawingFragment
      | undefined;

    expect(layout.height).toBeCloseTo(15);
    expect(layout.renderHeight).toBeGreaterThan(500);
    expect(overlayFragment).toBeDefined();
    expect(overlayFragment?.y).toBeGreaterThan(150);
  });

  it('returns minimal height when header contains only behindDoc fragments with extreme offsets', () => {
    const imageBlock1: FlowBlock = {
      kind: 'image',
      id: 'img-1',
      src: 'data:image/png;base64,xxx',
      anchor: {
        isAnchored: true,
        behindDoc: true,
        offsetV: -5000, // Extreme negative offset
      },
    };
    const imageBlock2: FlowBlock = {
      kind: 'image',
      id: 'img-2',
      src: 'data:image/png;base64,yyy',
      anchor: {
        isAnchored: true,
        behindDoc: true,
        offsetV: 3000, // Extreme positive offset
      },
    };
    const imageMeasure1: Measure = {
      kind: 'image',
      width: 100,
      height: 50,
    };
    const imageMeasure2: Measure = {
      kind: 'image',
      width: 100,
      height: 50,
    };

    const layout = layoutHeaderFooter([imageBlock1, imageBlock2], [imageMeasure1, imageMeasure2], {
      width: 200,
      height: 60,
    });

    // Both images have extreme offsets and behindDoc=true, so height should be 0
    expect(layout.height).toBe(0);
  });

  it('excludes ALL behindDoc fragments but includes non-behindDoc anchored images', () => {
    // Per OOXML spec, behindDoc is purely a z-ordering directive - ALL behindDoc images
    // are excluded from height, but non-behindDoc anchored images are still included.
    const paragraphBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'para-1',
      runs: [{ text: 'Header text', fontFamily: 'Arial', fontSize: 12, pmStart: 1, pmEnd: 12 }],
    };
    const behindDocImage1: FlowBlock = {
      kind: 'image',
      id: 'img-behind-1',
      src: 'data:image/png;base64,xxx',
      anchor: {
        isAnchored: true,
        behindDoc: true,
        offsetV: 5, // behindDoc - excluded from height
      },
    };
    const behindDocImage2: FlowBlock = {
      kind: 'image',
      id: 'img-behind-2',
      src: 'data:image/png;base64,yyy',
      anchor: {
        isAnchored: true,
        behindDoc: true,
        offsetV: 5000, // behindDoc - excluded from height
      },
    };
    const regularImage: FlowBlock = {
      kind: 'image',
      id: 'img-regular',
      src: 'data:image/png;base64,zzz',
      anchor: {
        isAnchored: true,
        behindDoc: false, // NOT behindDoc - included in height
        offsetV: 25,
      },
    };
    const paragraphMeasure: Measure = {
      kind: 'paragraph',
      lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 11, width: 80, ascent: 12, descent: 3, lineHeight: 15 }],
      totalHeight: 15,
    };
    const imageMeasure1: Measure = {
      kind: 'image',
      width: 50,
      height: 30,
    };
    const imageMeasure2: Measure = {
      kind: 'image',
      width: 50,
      height: 30,
    };
    const imageMeasure3: Measure = {
      kind: 'image',
      width: 50,
      height: 35,
    };

    const layout = layoutHeaderFooter(
      [paragraphBlock, behindDocImage1, behindDocImage2, regularImage],
      [paragraphMeasure, imageMeasure1, imageMeasure2, imageMeasure3],
      {
        width: 200,
        height: 100,
      },
    );

    // Height should include:
    // - paragraph (15)
    // - regularImage at y=25, height=35, bottom=60 (NOT behindDoc - included)
    // - behindDocImage1 excluded (behindDoc)
    // - behindDocImage2 excluded (behindDoc)
    expect(layout.height).toBeGreaterThan(15);
    expect(layout.height).toBeCloseTo(60, 0);
  });

  // Note: Tests for overflowBaseHeight threshold behavior have been removed.
  // Per OOXML spec, behindDoc is purely a z-ordering directive that should NOT affect layout.
  // ALL behindDoc images are now excluded from height calculations, regardless of position.
  // See tests above: 'excludes ALL behindDoc anchored fragments from height (per OOXML spec)'
  // and 'excludes ALL behindDoc fragments but includes non-behindDoc anchored images'.

  it('separates measurement bounds (height) from render bounds (minY/maxY/renderHeight)', () => {
    const paragraphBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'para-1',
      runs: [{ text: 'Header text', fontFamily: 'Arial', fontSize: 12, pmStart: 1, pmEnd: 12 }],
    };
    const behindDocImage: FlowBlock = {
      kind: 'image',
      id: 'img-behind',
      src: 'data:image/png;base64,xxx',
      anchor: {
        isAnchored: true,
        behindDoc: true,
        offsetV: -30, // positioned above the band origin
      },
    };
    const paragraphMeasure: Measure = {
      kind: 'paragraph',
      lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 11, width: 80, ascent: 12, descent: 3, lineHeight: 15 }],
      totalHeight: 15,
    };
    const imageMeasure: Measure = {
      kind: 'image',
      width: 50,
      height: 40,
    };

    const layout = layoutHeaderFooter([paragraphBlock, behindDocImage], [paragraphMeasure, imageMeasure], {
      width: 200,
      height: 100,
    });

    // Measurement height should only include the paragraph (behindDoc excluded)
    expect(layout.height).toBeCloseTo(15);
    // Render bounds should include the behindDoc image (minY < 0 because of negative offsetV)
    expect(layout.minY).toBeLessThan(0);
    // renderHeight should be larger than measurement height
    expect(layout.renderHeight).toBeGreaterThan(layout.height);
  });

  it('returns renderHeight equal to height when no out-of-band fragments exist', () => {
    const layout = layoutHeaderFooter([block], [makeMeasure([20, 10])], { width: 400, height: 80 });

    // With only normal paragraphs, measurement and render bounds should match
    expect(layout.height).toBeCloseTo(30);
    expect(layout.renderHeight).toBe(layout.height);
    expect(layout.minY).toBe(0);
    expect(layout.maxY).toBeCloseTo(30);
  });

  it('keeps paragraph-relative wrap-none footer drawings out of measurement height', () => {
    const carrier: FlowBlock = {
      kind: 'paragraph',
      id: 'footer-carrier',
      runs: [{ text: '', fontFamily: 'Arial', fontSize: 12 }],
    };
    const drawing: FlowBlock = {
      kind: 'drawing',
      id: 'footer-drawing',
      drawingKind: 'vectorShape',
      geometry: { width: 100, height: 90 },
      anchor: { isAnchored: true, vRelativeFrom: 'paragraph', offsetV: 25 },
      wrap: { type: 'None' },
      attrs: { anchorParagraphId: carrier.id },
    };
    const drawingMeasure: DrawingMeasure = {
      kind: 'drawing',
      drawingKind: 'vectorShape',
      width: 100,
      height: 90,
      scale: 1,
      naturalWidth: 100,
      naturalHeight: 90,
      geometry: { width: 100, height: 90, rotation: 0, flipH: false, flipV: false },
    };

    const layout = layoutHeaderFooter(
      [drawing, carrier],
      [drawingMeasure, makeMeasure([30])],
      { width: 200, height: 200 },
      'footer',
    );

    expect(layout.height).toBeCloseTo(30);
    expect(layout.renderHeight).toBeGreaterThanOrEqual(115);
  });

  it('excludes out-of-band page-relative anchors from measurement height', () => {
    const paragraphBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'para-1',
      runs: [{ text: 'Header text', fontFamily: 'Arial', fontSize: 12, pmStart: 1, pmEnd: 12 }],
    };
    // Page-relative anchor positioned far above the measurement canvas
    const imageBlock: FlowBlock = {
      kind: 'image',
      id: 'img-page',
      src: 'data:image/png;base64,xxx',
      anchor: {
        isAnchored: true,
        vRelativeFrom: 'page',
        alignV: 'top',
        offsetV: -100, // way above the canvas
      },
    };
    const paragraphMeasure: Measure = {
      kind: 'paragraph',
      lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 11, width: 80, ascent: 12, descent: 3, lineHeight: 15 }],
      totalHeight: 15,
    };
    const imageMeasure: Measure = {
      kind: 'image',
      width: 50,
      height: 30,
    };

    const layout = layoutHeaderFooter([paragraphBlock, imageBlock], [paragraphMeasure, imageMeasure], {
      width: 200,
      height: 100,
    });

    // The page-relative anchor at y=-100 is fully out-of-band (bottom = -100+30 = -70 < 0)
    // so it should be excluded from measurement height
    expect(layout.height).toBeCloseTo(15);
    // But render bounds should include it
    expect(layout.minY).toBeLessThan(0);
    expect(layout.renderHeight).toBeGreaterThan(layout.height);
  });

  it('keeps top-aligned page-relative header anchors in measurement height', () => {
    const overlayBlock: FlowBlock = {
      kind: 'drawing',
      id: 'drawing-top',
      drawingKind: 'vectorShape',
      geometry: { width: 120, height: 60 },
      anchor: {
        isAnchored: true,
        vRelativeFrom: 'page',
        alignV: 'top',
        offsetV: 40,
        behindDoc: false,
      },
      shapeKind: 'Rectangle',
    };
    const overlayMeasure: Measure = {
      kind: 'drawing',
      drawingKind: 'vectorShape',
      width: 120,
      height: 60,
      scale: 1,
      naturalWidth: 120,
      naturalHeight: 60,
      geometry: { width: 120, height: 60, rotation: 0, flipH: false, flipV: false },
    };
    const constraints = {
      width: 624,
      height: 864,
      pageWidth: 816,
      pageHeight: 1056,
      margins: { left: 96, right: 96, top: 96, bottom: 96, header: 48 },
    };

    const layout = layoutHeaderFooter([overlayBlock], [overlayMeasure], constraints, 'header');

    expect(layout.height).toBeCloseTo(100);
    expect(layout.renderHeight).toBeCloseTo(layout.height);
  });

  it('keeps bottom-aligned page-relative footer anchors in measurement height', () => {
    const footerOverlay: FlowBlock = {
      kind: 'image',
      id: 'img-page',
      src: 'data:image/png;base64,xxx',
      anchor: {
        isAnchored: true,
        vRelativeFrom: 'page',
        alignV: 'bottom',
        offsetV: 0,
        hRelativeFrom: 'page',
        offsetH: 0,
      },
    };
    const footerOverlayMeasure: Measure = {
      kind: 'image',
      width: 50,
      height: 30,
    };
    const constraints = {
      width: 200,
      height: 800,
      pageHeight: 1056,
      margins: { left: 72, right: 72, top: 72, bottom: 72, header: 36 },
    };

    const layout = layoutHeaderFooter([footerOverlay], [footerOverlayMeasure], constraints, 'footer');

    expect(layout.height).toBeCloseTo(72);
    expect(layout.renderHeight).toBeCloseTo(layout.height);
  });

  it('post-normalizes page-relative anchors in footer layout', () => {
    const paragraphBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'para-1',
      runs: [{ text: 'Footer text', fontFamily: 'Arial', fontSize: 12, pmStart: 1, pmEnd: 12 }],
    };
    const imageBlock: FlowBlock = {
      kind: 'image',
      id: 'img-page',
      src: 'data:image/png;base64,xxx',
      anchor: {
        isAnchored: true,
        vRelativeFrom: 'page',
        alignV: 'bottom',
        offsetV: 0,
        hRelativeFrom: 'page',
        offsetH: 0,
      },
    };
    const paragraphMeasure: Measure = {
      kind: 'paragraph',
      lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 11, width: 80, ascent: 12, descent: 3, lineHeight: 15 }],
      totalHeight: 15,
    };
    const imageMeasure: Measure = {
      kind: 'image',
      width: 50,
      height: 30,
    };

    const constraints = {
      width: 200,
      height: 800,
      pageHeight: 1056,
      margins: { left: 72, right: 72, top: 72, bottom: 72, header: 36 },
    };

    // Without kind='footer': no normalization — raw inner-layout Y
    const withoutKind = layoutHeaderFooter([paragraphBlock, imageBlock], [paragraphMeasure, imageMeasure], constraints);
    const imgFragWithout = withoutKind.pages[0]?.fragments.find((f) => f.kind === 'image');

    // With kind='footer': normalization converts to footer-band-local Y
    const withFooter = layoutHeaderFooter(
      [paragraphBlock, imageBlock],
      [paragraphMeasure, imageMeasure],
      constraints,
      'footer',
    );
    const imgFragFooter = withFooter.pages[0]?.fragments.find((f) => f.kind === 'image');

    // Footer band origin = pageHeight - marginBottom = 1056 - 72 = 984
    // physicalY = pageHeight - imgHeight = 1056 - 30 = 1026
    // normalized Y = 1026 - 984 = 42
    expect(imgFragFooter).toBeDefined();
    expect(imgFragFooter!.y).toBe(1056 - 30 - (1056 - 72));

    // Without kind, the Y is the synthetic canvas position (not normalized)
    expect(imgFragWithout).toBeDefined();
    expect(imgFragWithout!.y).not.toBe(imgFragFooter!.y);
  });

  it('post-normalizes page-relative anchors in header layout to page-top-local y', () => {
    const imageBlock: FlowBlock = {
      kind: 'image',
      id: 'img-page',
      src: 'data:image/png;base64,xxx',
      anchor: {
        isAnchored: true,
        vRelativeFrom: 'page',
        alignV: 'top',
        offsetV: 10,
      },
    };
    const imageMeasure: Measure = {
      kind: 'image',
      width: 50,
      height: 30,
    };

    const constraints = {
      width: 200,
      height: 800,
      pageHeight: 1056,
      margins: { left: 72, right: 72, top: 72, bottom: 72, header: 36 },
    };

    // With kind='header': normalize from the synthetic body canvas back to
    // header story coordinates, whose origin is the physical page top.
    const withHeader = layoutHeaderFooter([imageBlock], [imageMeasure], constraints, 'header');
    const imgFrag = withHeader.pages[0]?.fragments.find((f) => f.kind === 'image');

    // Without kind: this simple top-aligned case is already page-top-local.
    const withoutKind = layoutHeaderFooter([imageBlock], [imageMeasure], constraints);
    const imgFragNoKind = withoutKind.pages[0]?.fragments.find((f) => f.kind === 'image');

    expect(imgFrag).toBeDefined();
    expect(imgFragNoKind).toBeDefined();
    expect(imgFrag!.y).toBe(10);
    expect(imgFragNoKind!.y).toBe(10);
  });

  it('keeps paragraph-relative tall non-page-covering header anchors in measurement height', () => {
    const paragraphBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'header-anchor-paragraph',
      runs: [{ text: 'Header', fontFamily: 'Arial', fontSize: 12, pmStart: 1, pmEnd: 7 }],
    };
    const imageBlock: FlowBlock = {
      kind: 'image',
      id: 'header-background',
      src: 'data:image/png;base64,xxx',
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'column',
        vRelativeFrom: 'paragraph',
        offsetH: 120,
        offsetV: 0,
      },
    };
    const imageMeasure: Measure = {
      kind: 'image',
      width: 260,
      height: 568,
    };
    const paragraphMeasure = makeMeasure([1]);
    const layout = layoutHeaderFooter(
      [paragraphBlock, imageBlock],
      [paragraphMeasure, imageMeasure],
      {
        width: 600,
        height: 424,
        pageWidth: 720,
        pageHeight: 540,
        margins: { left: 60, right: 60, top: 60, bottom: 56, header: 48 },
      },
      'header',
    );

    expect(layout.height).toBeCloseTo(568);
    expect(layout.renderHeight).toBeCloseTo(568);
  });

  it('excludes wrap=None page-covering overlays from measurement (column/paragraph anchored cover page)', () => {
    // Regression for SD-2499 review: a foreground cover-page rectangle in a
    // header is column/paragraph anchored, has wrap=None, and is sized to
    // cover the body canvas. Treating it as body-reserving content inflates
    // margins and (combined with the inflation clamp) shrinks the body to a
    // sliver, which spreads body content across many synthetic pages and
    // makes the overlay visually repeat per page. wrap=None is OOXML's
    // explicit "no exclusion zone" signal, so it must not reserve space.
    const paragraphBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'header-para',
      runs: [{ text: 'Header', fontFamily: 'Arial', fontSize: 12, pmStart: 1, pmEnd: 7 }],
    };
    const overlayBlock: FlowBlock = {
      kind: 'drawing',
      id: 'cover-overlay',
      drawingKind: 'vectorShape',
      geometry: { width: 720, height: 600 },
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'column',
        vRelativeFrom: 'paragraph',
        offsetH: -40,
        offsetV: -50,
        behindDoc: false,
      },
      wrap: { type: 'None' },
      shapeKind: 'Rectangle',
    };
    const paragraphMeasure = makeMeasure([15]);
    const overlayMeasure: Measure = {
      kind: 'drawing',
      drawingKind: 'vectorShape',
      width: 720,
      height: 600,
      scale: 1,
      naturalWidth: 720,
      naturalHeight: 600,
      geometry: { width: 720, height: 600, rotation: 0, flipH: false, flipV: false },
    };

    const layout = layoutHeaderFooter(
      [paragraphBlock, overlayBlock],
      [paragraphMeasure, overlayMeasure],
      {
        width: 600,
        height: 424,
        pageWidth: 720,
        pageHeight: 540,
        margins: { left: 60, right: 60, top: 60, bottom: 56, header: 48 },
      },
      'header',
    );

    expect(layout.height).toBeCloseTo(15);
    expect(layout.renderHeight).toBeGreaterThan(layout.height);
  });

  it('excludes wrap=None header/footer overlays that extend outside the measurement band even when they are not page-covering', () => {
    // Regression for footer letterhead / stamp overlays: wrap=None means the
    // anchored drawing is an absolute overlay with no text exclusion zone.
    // If the overlay extends above the header/footer text band, it must render
    // without inflating measurement height, even when it is not page-covering.
    const paragraphBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'footer-para',
      runs: [{ text: 'Footer text', fontFamily: 'Arial', fontSize: 11, pmStart: 1, pmEnd: 12 }],
    };
    const overlayBlock: FlowBlock = {
      kind: 'drawing',
      id: 'footer-overlay',
      drawingKind: 'vectorShape',
      geometry: { width: 160, height: 84 },
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'column',
        vRelativeFrom: 'paragraph',
        offsetH: 12,
        offsetV: -38,
        behindDoc: false,
      },
      wrap: { type: 'None' },
      shapeKind: 'Rectangle',
    };
    const paragraphMeasure = makeMeasure([13.8]);
    const overlayMeasure: Measure = {
      kind: 'drawing',
      drawingKind: 'vectorShape',
      width: 160,
      height: 84,
      scale: 1,
      naturalWidth: 160,
      naturalHeight: 84,
      geometry: { width: 160, height: 84, rotation: 0, flipH: false, flipV: false },
    };

    const layout = layoutHeaderFooter(
      [paragraphBlock, overlayBlock],
      [paragraphMeasure, overlayMeasure],
      {
        width: 624,
        height: 96,
        pageWidth: 816,
        pageHeight: 1056,
        margins: { left: 96, right: 96, top: 96, bottom: 96, footer: 48 },
      },
      'footer',
    );

    expect(layout.height).toBeCloseTo(13.8);
    expect(layout.renderHeight).toBeCloseTo(84);
  });

  it('keeps tall anchored shape in measurement when wrap reserves flow space', () => {
    // Anchored content with a non-None wrap (e.g. Square) is real header
    // content with an exclusion zone — it must continue to reserve body
    // space, even when its size exceeds the measurement canvas.
    const paragraphBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'header-para',
      runs: [{ text: 'Header', fontFamily: 'Arial', fontSize: 12, pmStart: 1, pmEnd: 7 }],
    };
    const textboxBlock: FlowBlock = {
      kind: 'drawing',
      id: 'header-textbox',
      drawingKind: 'vectorShape',
      geometry: { width: 720, height: 500 },
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'page',
        vRelativeFrom: 'paragraph',
        offsetH: 0,
        offsetV: 0,
        behindDoc: false,
      },
      wrap: { type: 'Square' },
      shapeKind: 'Rectangle',
    };
    const paragraphMeasure = makeMeasure([15]);
    const textboxMeasure: Measure = {
      kind: 'drawing',
      drawingKind: 'vectorShape',
      width: 720,
      height: 500,
      scale: 1,
      naturalWidth: 720,
      naturalHeight: 500,
      geometry: { width: 720, height: 500, rotation: 0, flipH: false, flipV: false },
    };

    const layout = layoutHeaderFooter(
      [paragraphBlock, textboxBlock],
      [paragraphMeasure, textboxMeasure],
      {
        width: 600,
        height: 424,
        pageWidth: 720,
        pageHeight: 540,
        margins: { left: 60, right: 60, top: 60, bottom: 56, header: 48 },
      },
      'header',
    );

    expect(layout.height).toBeGreaterThan(400);
    expect(layout.renderHeight).toBeGreaterThanOrEqual(layout.height);
  });

  it('does not narrow footer paragraphs around page-relative anchored textboxes', () => {
    // Regression: the page-number textbox in the footer must not shrink
    // unrelated earlier footer paragraphs via float-based remeasurement.
    // Word keeps footer paragraphs full-width and positions page-relative
    // textboxes independently.
    const paragraphBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'para-1',
      runs: [{ text: 'Footer text', fontFamily: 'Arial', fontSize: 12, pmStart: 1, pmEnd: 12 }],
    };
    const imageBlock: FlowBlock = {
      kind: 'image',
      id: 'img-page',
      src: 'data:image/png;base64,xxx',
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'column',
        alignH: 'left',
        vRelativeFrom: 'page',
        alignV: 'bottom',
        offsetV: 0,
      },
      wrap: {
        type: 'Square',
        wrapText: 'right',
      },
    };
    const paragraphMeasure: Measure = {
      kind: 'paragraph',
      lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 11, width: 180, ascent: 12, descent: 3, lineHeight: 15 }],
      totalHeight: 15,
    };
    const imageMeasure: Measure = {
      kind: 'image',
      width: 80,
      height: 60,
    };
    const constraints = {
      width: 200,
      height: 120,
      pageHeight: 300,
      margins: { left: 20, right: 20, top: 40, bottom: 60, header: 20 },
    };

    const layout = layoutHeaderFooter(
      [paragraphBlock, imageBlock],
      [paragraphMeasure, imageMeasure],
      constraints,
      'footer',
    );

    const paragraphFragment = layout.pages[0].fragments.find((fragment) => fragment.kind === 'para') as ParaFragment;

    // Paragraph must keep the full footer width -- no float wrapping
    expect(paragraphFragment).toBeDefined();
    expect(paragraphFragment.x).toBe(0);
    expect(paragraphFragment.width).toBe(200);
  });

  it('computes contentMeasures for textboxShape blocks when remeasureParagraph is provided', () => {
    const textboxBlock: FlowBlock = {
      kind: 'drawing',
      id: 'footer-textbox-1',
      drawingKind: 'textboxShape',
      geometry: { width: 120, height: 40, rotation: 0, flipH: false, flipV: false },
      contentBlocks: [
        {
          kind: 'paragraph',
          id: 'footer-textbox-para-1',
          runs: [{ text: 'Footer text', pmStart: 1, pmEnd: 12 }],
        },
      ],
      textInsets: { top: 4, right: 8, bottom: 4, left: 8 },
    };
    const textboxMeasure: DrawingMeasure = {
      kind: 'drawing',
      drawingKind: 'textboxShape',
      width: 120,
      height: 40,
      scale: 1,
      naturalWidth: 120,
      naturalHeight: 40,
      geometry: { width: 120, height: 40, rotation: 0, flipH: false, flipV: false },
    };

    const layout = layoutHeaderFooter(
      [textboxBlock],
      [textboxMeasure],
      { width: 400, height: 80 },
      'footer',
      (_block, _maxWidth) => makeMeasure([16]),
    );

    const fragment = layout.pages[0].fragments[0] as DrawingFragment;
    expect(fragment.kind).toBe('drawing');
    expect(fragment.drawingKind).toBe('textboxShape');
    expect(Array.isArray(fragment.contentMeasures)).toBe(true);
    expect(fragment.contentMeasures).toHaveLength(1);
  });

  it('places paragraphless anchored textboxShape blocks in header/footer layout', () => {
    const textboxBlock: FlowBlock = {
      kind: 'drawing',
      id: 'header-textbox-1',
      drawingKind: 'textboxShape',
      geometry: { width: 120, height: 40, rotation: 0, flipH: false, flipV: false },
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'column',
        vRelativeFrom: 'paragraph',
        offsetH: -10,
        offsetV: -6,
      },
      contentBlocks: [
        {
          kind: 'paragraph',
          id: 'header-textbox-para-1',
          runs: [{ text: 'Header text', pmStart: 1, pmEnd: 12 }],
        },
      ],
      textInsets: { top: 4, right: 8, bottom: 4, left: 8 },
    };
    const textboxMeasure: DrawingMeasure = {
      kind: 'drawing',
      drawingKind: 'textboxShape',
      width: 120,
      height: 40,
      scale: 1,
      naturalWidth: 120,
      naturalHeight: 40,
      geometry: { width: 120, height: 40, rotation: 0, flipH: false, flipV: false },
    };

    const layout = layoutHeaderFooter(
      [textboxBlock],
      [textboxMeasure],
      { width: 400, height: 80 },
      'header',
      (_block, _maxWidth) => makeMeasure([16]),
    );

    expect(layout.pages).toHaveLength(1);
    const fragment = layout.pages[0].fragments[0] as DrawingFragment;
    expect(fragment.kind).toBe('drawing');
    expect(fragment.blockId).toBe('header-textbox-1');
    expect(fragment.isAnchored).toBe(true);
    expect(fragment.x).toBe(-10);
    expect(fragment.y).toBe(-6);
    expect(fragment.contentMeasures).toHaveLength(1);
  });

  it('places paragraphless page-relative behindDoc header images at page offsets', () => {
    const imageBlock: FlowBlock = {
      kind: 'image',
      id: 'header-bg-image',
      src: 'data:image/png;base64,xxx',
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'page',
        vRelativeFrom: 'page',
        offsetH: 1387 * (96 / 914400),
        offsetV: 254000 * (96 / 914400),
        behindDoc: true,
      },
      wrap: { type: 'None', behindDoc: true },
    };
    const imageMeasure: ImageMeasure = {
      kind: 'image',
      width: 7557463 * (96 / 914400),
      height: 10723880 * (96 / 914400),
    };

    const layout = layoutHeaderFooter(
      [imageBlock],
      [imageMeasure],
      {
        width: 602,
        height: 648,
        pageWidth: 816,
        pageHeight: 1056,
        margins: { left: 107, right: 107, top: 72, bottom: 72, header: 36 },
      },
      'header',
    );

    expect(layout.pages).toHaveLength(1);
    const fragment = layout.pages[0].fragments[0] as ImageFragment;
    expect(fragment.kind).toBe('image');
    expect(fragment.blockId).toBe('header-bg-image');
    expect(fragment.isAnchored).toBe(true);
    expect(fragment.behindDoc).toBe(true);
    expect(fragment.zIndex).toBe(0);
    expect(fragment.x).toBeCloseTo(0.15, 2);
    expect(fragment.y).toBeCloseTo(26.67, 2);
    expect(layout.height).toBe(0);
    expect(layout.renderHeight).toBeGreaterThan(1000);
  });
});

describe('requirePageBoundary edge cases', () => {
  it('requirePageBoundary overrides continuous section type', () => {
    const continuousSectionWithPageBoundary: FlowBlock = {
      kind: 'sectionBreak',
      id: 'sb-1',
      type: 'continuous',
      margins: { header: 100, footer: 80 },
      attrs: { requirePageBoundary: true },
    };

    const blocks: FlowBlock[] = [
      { kind: 'paragraph', id: 'p1', runs: [] },
      continuousSectionWithPageBoundary,
      { kind: 'paragraph', id: 'p2', runs: [] },
    ];

    const measures: Measure[] = [makeMeasure([40]), { kind: 'sectionBreak' }, makeMeasure([40])];

    const options: LayoutOptions = {
      pageSize: { w: 400, h: 400 },
      margins: { top: 40, right: 30, bottom: 40, left: 30 },
    };

    const layout = layoutDocument(blocks, measures, options);

    // Should force a page break despite continuous type
    expect(layout.pages.length).toBe(2);
    expect(pageContainsBlock(layout.pages[0], 'p1')).toBe(true);
    expect(pageContainsBlock(layout.pages[1], 'p2')).toBe(true);
  });

  it('requirePageBoundary does not affect nextPage section type', () => {
    const nextPageSectionWithPageBoundary: FlowBlock = {
      kind: 'sectionBreak',
      id: 'sb-1',
      type: 'nextPage',
      margins: { header: 100, footer: 80 },
      attrs: { requirePageBoundary: true },
    };

    const blocks: FlowBlock[] = [
      { kind: 'paragraph', id: 'p1', runs: [] },
      nextPageSectionWithPageBoundary,
      { kind: 'paragraph', id: 'p2', runs: [] },
    ];

    const measures: Measure[] = [makeMeasure([40]), { kind: 'sectionBreak' }, makeMeasure([40])];

    const options: LayoutOptions = {
      pageSize: { w: 400, h: 400 },
      margins: { top: 40, right: 30, bottom: 40, left: 30 },
    };

    const layout = layoutDocument(blocks, measures, options);

    // Should still break to next page (same behavior as without requirePageBoundary)
    expect(layout.pages.length).toBe(2);
    expect(pageContainsBlock(layout.pages[0], 'p1')).toBe(true);
    expect(pageContainsBlock(layout.pages[1], 'p2')).toBe(true);
  });

  it('multiple requirePageBoundary sections create multiple pages', () => {
    const firstSection: FlowBlock = {
      kind: 'sectionBreak',
      id: 'sb-1',
      type: 'continuous',
      margins: { header: 100, footer: 80 },
      attrs: { requirePageBoundary: true },
    };

    const secondSection: FlowBlock = {
      kind: 'sectionBreak',
      id: 'sb-2',
      type: 'continuous',
      margins: { header: 120, footer: 90 },
      attrs: { requirePageBoundary: true },
    };

    const blocks: FlowBlock[] = [
      { kind: 'paragraph', id: 'p1', runs: [] },
      firstSection,
      { kind: 'paragraph', id: 'p2', runs: [] },
      secondSection,
      { kind: 'paragraph', id: 'p3', runs: [] },
    ];

    const measures: Measure[] = [
      makeMeasure([40]),
      { kind: 'sectionBreak' },
      makeMeasure([40]),
      { kind: 'sectionBreak' },
      makeMeasure([40]),
    ];

    const options: LayoutOptions = {
      pageSize: { w: 400, h: 400 },
      margins: { top: 40, right: 30, bottom: 40, left: 30 },
    };

    const layout = layoutDocument(blocks, measures, options);

    // Should create 3 pages
    expect(layout.pages.length).toBe(3);
    expect(pageContainsBlock(layout.pages[0], 'p1')).toBe(true);
    expect(pageContainsBlock(layout.pages[1], 'p2')).toBe(true);
    expect(pageContainsBlock(layout.pages[2], 'p3')).toBe(true);

    // Check margins are applied correctly
    // Note: header/footer distances only affect body position when there's actual header/footer content.
    // Without content, body uses base top/bottom margins. Header/footer distances are still stored.
    expect(layout.pages[1].margins).toMatchObject({ top: 40, bottom: 40, header: 100, footer: 80 });
    expect(layout.pages[2].margins).toMatchObject({ top: 40, bottom: 40, header: 120, footer: 90 });
  });

  it('requirePageBoundary with columns still applies column configuration', () => {
    const sectionWithColumnsAndBoundary: FlowBlock = {
      kind: 'sectionBreak',
      id: 'sb-1',
      type: 'continuous',
      margins: { header: 100, footer: 80 },
      columns: { count: 2, gap: 48 },
      attrs: { requirePageBoundary: true },
    };

    const blocks: FlowBlock[] = [
      { kind: 'paragraph', id: 'p1', runs: [] },
      sectionWithColumnsAndBoundary,
      { kind: 'paragraph', id: 'p2', runs: [] },
    ];

    const measures: Measure[] = [makeMeasure([40]), { kind: 'sectionBreak' }, makeMeasure([200, 200])];

    const options: LayoutOptions = {
      pageSize: { w: 612, h: 792 },
      margins: { top: 72, right: 72, bottom: 72, left: 72 },
    };

    const layout = layoutDocument(blocks, measures, options);

    // Should force page break
    expect(layout.pages.length).toBe(2);
    expect(pageContainsBlock(layout.pages[0], 'p1')).toBe(true);
    expect(pageContainsBlock(layout.pages[1], 'p2')).toBe(true);

    // Second page should have column layout applied
    // With 2 columns, gap 48, content width 468, column width = (468 - 48) / 2 = 210
    const p2Fragment = layout.pages[1].fragments.find((f) => f.blockId === 'p2');
    expect(p2Fragment?.width).toBe(210); // Should be column width
  });

  it('continuous section without requirePageBoundary remains on same page', () => {
    const regularContinuousSection: FlowBlock = {
      kind: 'sectionBreak',
      id: 'sb-1',
      type: 'continuous',
      margins: { header: 100, footer: 80 },
    };

    const blocks: FlowBlock[] = [
      { kind: 'paragraph', id: 'p1', runs: [] },
      regularContinuousSection,
      { kind: 'paragraph', id: 'p2', runs: [] },
    ];

    const measures: Measure[] = [makeMeasure([40]), { kind: 'sectionBreak' }, makeMeasure([40])];

    const options: LayoutOptions = {
      pageSize: { w: 400, h: 400 },
      margins: { top: 40, right: 30, bottom: 40, left: 30 },
    };

    const layout = layoutDocument(blocks, measures, options);

    // Should remain on same page (margins apply from next page boundary)
    expect(layout.pages.length).toBe(1);
    expect(pageContainsBlock(layout.pages[0], 'p1')).toBe(true);
    expect(pageContainsBlock(layout.pages[0], 'p2')).toBe(true);
  });

  describe('columnBreak interactions with mid-page multi-column regions', () => {
    it('resets Y to region top when moving to next column after a mid-page region change', () => {
      const toTwoColumns: FlowBlock = {
        kind: 'sectionBreak',
        id: 'sb-1',
        type: 'continuous',
        columns: { count: 2, gap: 48 },
        margins: {},
      };

      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [] },
        toTwoColumns,
        { kind: 'paragraph', id: 'p2', runs: [] },
        { kind: 'columnBreak', id: 'br-1' } as ColumnBreakBlock,
        { kind: 'paragraph', id: 'p3', runs: [] },
      ];

      const measures: Measure[] = [
        makeMeasure([40]), // p1 small
        { kind: 'sectionBreak' },
        makeMeasure([60]), // p2 one line
        { kind: 'columnBreak' },
        makeMeasure([40]), // p3 after column break
      ];

      const options: LayoutOptions = {
        pageSize: { w: 612, h: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
      };

      const layout = layoutDocument(blocks, measures, options);
      const page = layout.pages[0];
      const contentWidth = options.pageSize!.w - options.margins!.left - options.margins!.right;
      const columnWidth = (contentWidth - 48) / 2;

      const p1 = page.fragments.find((f) => f.blockId === 'p1') as ParaFragment;
      const regionTop = p1.y + 40; // after p1

      const p2 = page.fragments.find((f) => f.blockId === 'p2') as ParaFragment;
      expect(p2.x).toBeCloseTo(options.margins!.left); // first column
      expect(p2.y).toBeCloseTo(regionTop);
      expect(p2.width).toBeCloseTo(columnWidth);

      const p3 = page.fragments.find((f) => f.blockId === 'p3') as ParaFragment;
      expect(p3.x).toBeCloseTo(options.margins!.left + columnWidth + 48); // second column
      expect(p3.y).toBeCloseTo(regionTop); // reset to region top
    });

    it('uses explicit custom column widths after a manual column break', () => {
      const toCustomColumns: FlowBlock = {
        kind: 'sectionBreak',
        id: 'sb-custom',
        type: 'continuous',
        columns: { count: 2, gap: 50, widths: [100, 550], equalWidth: false },
        margins: {},
      };

      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [] },
        toCustomColumns,
        { kind: 'paragraph', id: 'p2', runs: [] },
        { kind: 'columnBreak', id: 'br-1' } as ColumnBreakBlock,
        { kind: 'paragraph', id: 'p3', runs: [] },
      ];

      const measures: Measure[] = [
        makeMeasure([40]),
        { kind: 'sectionBreak' },
        makeMeasure([40]),
        { kind: 'columnBreak' },
        makeMeasure([40]),
      ];

      const options: LayoutOptions = {
        pageSize: { w: 800, h: 792 },
        margins: { top: 72, right: 50, bottom: 72, left: 50 },
      };

      const layout = layoutDocument(blocks, measures, options);
      const page = layout.pages[0];
      const p1 = page.fragments.find((f) => f.blockId === 'p1') as ParaFragment;
      const regionTop = p1.y + 40;

      const p2 = page.fragments.find((f) => f.blockId === 'p2') as ParaFragment;
      expect(p2.x).toBeCloseTo(50);
      expect(p2.y).toBeCloseTo(regionTop);
      expect(p2.width).toBeCloseTo(100);

      const p3 = page.fragments.find((f) => f.blockId === 'p3') as ParaFragment;
      expect(p3.x).toBeCloseTo(200);
      expect(p3.y).toBeCloseTo(regionTop);
      expect(p3.width).toBeCloseTo(550);
    });

    it('uses the wider explicit column after a nextColumn section break', () => {
      const columns = { count: 2, gap: 0, widths: [272.6666666666667, 365.4], equalWidth: false };
      const toTwoColumns: SectionBreakBlock = {
        kind: 'sectionBreak',
        id: 'sb-two-columns',
        type: 'continuous',
        columns,
        margins: {},
      };
      const nextColumn: SectionBreakBlock = {
        kind: 'sectionBreak',
        id: 'sb-next-column',
        type: 'nextColumn',
        columns,
        margins: {},
      };

      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'lead', runs: [] },
        toTwoColumns,
        { kind: 'paragraph', id: 'left-signature', runs: [] },
        nextColumn,
        { kind: 'paragraph', id: 'right-signature', runs: [] },
      ];
      const measures: Measure[] = [
        makeMeasure([40]),
        { kind: 'sectionBreak' },
        makeMeasure([40]),
        { kind: 'sectionBreak' },
        makeMeasure([40]),
      ];

      const layout = layoutDocument(blocks, measures, {
        pageSize: { w: 800, h: 792 },
        margins: { top: 72, right: 80, bottom: 72, left: 80 },
      });
      const page = layout.pages[0];
      const lead = page.fragments.find((fragment) => fragment.blockId === 'lead') as ParaFragment;
      const left = page.fragments.find((fragment) => fragment.blockId === 'left-signature') as ParaFragment;
      const right = page.fragments.find((fragment) => fragment.blockId === 'right-signature') as ParaFragment;

      expect(left.x).toBeCloseTo(80);
      expect(left.y).toBeCloseTo(lead.y + 40);
      expect(left.width).toBeCloseTo(272.6666666666667);
      expect(right.x).toBeCloseTo(80 + 272.6666666666667);
      expect(right.y).toBeCloseTo(lead.y + 40);
      expect(right.width).toBeCloseTo(365.4);
    });

    it('starts first-section nextColumn seeds in the destination column', () => {
      const columns = { count: 2, gap: 0, widths: [272.6666666666667, 365.4], equalWidth: false };
      const seed: SectionBreakBlock = {
        kind: 'sectionBreak',
        id: 'section-seed-right-column',
        type: 'continuous',
        columns,
        margins: {},
        attrs: { isFirstSection: true, initialColumnIndex: 1 },
      };

      const layout = layoutDocument(
        [seed, { kind: 'paragraph', id: 'right-signature', runs: [] }],
        [{ kind: 'sectionBreak' }, makeMeasure([40])],
        {
          pageSize: { w: 800, h: 792 },
          margins: { top: 72, right: 80, bottom: 72, left: 80 },
        },
      );

      const page = layout.pages[0];
      const right = page.fragments.find((fragment) => fragment.blockId === 'right-signature') as ParaFragment;
      expect(right.x).toBeCloseTo(80 + 272.6666666666667);
      expect(right.width).toBeCloseTo(365.4);
    });

    it('advances past a sectPr marker paragraph between continuous and nextColumn', () => {
      // OOXML shape: a continuous two-column section owns left-column content
      // plus an empty sectPr carrier, then nextColumn starts right-column content.
      const columns = { count: 2, gap: 0, widths: [272.6666666666667, 365.4], equalWidth: false };
      const layout = layoutDocument(
        [
          {
            kind: 'sectionBreak',
            id: 'sb-two-columns',
            type: 'continuous',
            columns,
            margins: {},
            attrs: { source: 'sectPr', sectionIndex: 5, typeIsExplicit: true },
          },
          { kind: 'paragraph', id: 'left-signature', runs: [] },
          { kind: 'paragraph', id: 'continuous-marker', runs: [], attrs: { sectPrMarker: true } },
          {
            kind: 'sectionBreak',
            id: 'sb-next-column',
            type: 'nextColumn',
            columns,
            margins: {},
            attrs: { source: 'sectPr', sectionIndex: 6, typeIsExplicit: true },
          },
          { kind: 'paragraph', id: 'right-signature', runs: [] },
        ],
        [{ kind: 'sectionBreak' }, makeMeasure([40]), makeMeasure([0]), { kind: 'sectionBreak' }, makeMeasure([40])],
        {
          pageSize: { w: 816, h: 1056 },
          margins: { top: 44.27, right: 88.27, bottom: 49.2, left: 89.6 },
        },
      );

      const page = layout.pages[0];
      const left = page.fragments.find((fragment) => fragment.blockId === 'left-signature') as ParaFragment;
      const right = page.fragments.find((fragment) => fragment.blockId === 'right-signature') as ParaFragment;
      expect(left.x).toBeCloseTo(89.6);
      expect(left.width).toBeCloseTo(272.6666666666667);
      expect(right.x).toBeCloseTo(89.6 + 272.6666666666667);
      expect(right.y).toBeCloseTo(left.y);
      expect(right.width).toBeCloseTo(365.4);
    });

    it('does not render or consume a measured empty sectPr marker before nextColumn', () => {
      const columns = { count: 2, gap: 0, widths: [272.6666666666667, 365.4], equalWidth: false };
      const layout = layoutDocument(
        [
          {
            kind: 'sectionBreak',
            id: 'sb-two-columns',
            type: 'continuous',
            columns,
            margins: {},
            attrs: { source: 'sectPr', sectionIndex: 5, typeIsExplicit: true },
          },
          { kind: 'paragraph', id: 'left-signature', runs: [] },
          { kind: 'paragraph', id: 'continuous-marker', runs: [], attrs: { sectPrMarker: true } },
          {
            kind: 'sectionBreak',
            id: 'sb-next-column',
            type: 'nextColumn',
            columns,
            margins: {},
            attrs: { source: 'sectPr', sectionIndex: 6, typeIsExplicit: true },
          },
          { kind: 'paragraph', id: 'right-signature', runs: [] },
        ],
        [
          { kind: 'sectionBreak' },
          makeMeasure([40]),
          makeMeasure([19.3967]),
          { kind: 'sectionBreak' },
          makeMeasure([40]),
        ],
        {
          pageSize: { w: 816, h: 1056 },
          margins: { top: 44.27, right: 88.27, bottom: 49.2, left: 89.6 },
        },
      );

      const page = layout.pages[0];
      const marker = page.fragments.find((fragment) => fragment.blockId === 'continuous-marker');
      const left = page.fragments.find((fragment) => fragment.blockId === 'left-signature') as ParaFragment;
      const right = page.fragments.find((fragment) => fragment.blockId === 'right-signature') as ParaFragment;
      expect(marker).toBeUndefined();
      expect(right.x).toBeCloseTo(89.6 + 272.6666666666667);
      expect(right.y).toBeCloseTo(left.y);
    });

    it('keeps nextColumn content beside a tall left column near the page bottom', () => {
      const columns = { count: 2, gap: 0, widths: [272.6666666666667, 365.4], equalWidth: false };
      const layout = layoutDocument(
        [
          { kind: 'paragraph', id: 'lead', runs: [] },
          {
            kind: 'sectionBreak',
            id: 'sb-two-columns',
            type: 'continuous',
            columns,
            margins: {},
          },
          { kind: 'paragraph', id: 'left-signature', runs: [] },
          {
            kind: 'sectionBreak',
            id: 'sb-next-column',
            type: 'nextColumn',
            columns,
            margins: {},
          },
          { kind: 'paragraph', id: 'right-signature', runs: [] },
        ],
        [
          makeMeasure([40]),
          { kind: 'sectionBreak' },
          // Tall left column near the page bottom. Restarting the mid-page region
          // at maxCursorY would leave no room for the right column on this page.
          makeMeasure([200]),
          { kind: 'sectionBreak' },
          makeMeasure([40]),
        ],
        {
          pageSize: { w: 800, h: 400 },
          margins: { top: 72, right: 80, bottom: 72, left: 80 },
        },
      );

      expect(layout.pages).toHaveLength(1);
      const page = layout.pages[0];
      const left = page.fragments.find((fragment) => fragment.blockId === 'left-signature') as ParaFragment;
      const right = page.fragments.find((fragment) => fragment.blockId === 'right-signature') as ParaFragment;
      expect(right).toBeDefined();
      expect(right.x).toBeCloseTo(80 + 272.6666666666667);
      expect(right.y).toBeCloseTo(left.y);
      expect(right.width).toBeCloseTo(365.4);
    });

    it('activates pending multi-column geometry on nextColumn when still single-column', () => {
      const columns = { count: 2, gap: 0, widths: [272.6666666666667, 365.4], equalWidth: false };
      const layout = layoutDocument(
        [
          { kind: 'paragraph', id: 'lead', runs: [] },
          {
            kind: 'sectionBreak',
            id: 'sb-next-column',
            type: 'nextColumn',
            columns,
            margins: {},
          },
          { kind: 'paragraph', id: 'right-signature', runs: [] },
        ],
        [makeMeasure([40]), { kind: 'sectionBreak' }, makeMeasure([40])],
        {
          pageSize: { w: 800, h: 792 },
          margins: { top: 72, right: 80, bottom: 72, left: 80 },
        },
      );

      expect(layout.pages).toHaveLength(1);
      const page = layout.pages[0];
      const lead = page.fragments.find((fragment) => fragment.blockId === 'lead') as ParaFragment;
      const right = page.fragments.find((fragment) => fragment.blockId === 'right-signature') as ParaFragment;
      expect(right.x).toBeCloseTo(80 + 272.6666666666667);
      expect(right.y).toBeCloseTo(lead.y + 40);
      expect(right.width).toBeCloseTo(365.4);
    });

    it('keeps the current explicit column after a manual column break when only later per-column gaps differ', () => {
      const toExplicitColumns: FlowBlock = {
        kind: 'sectionBreak',
        id: 'sb-explicit',
        type: 'continuous',
        columns: { count: 3, gap: 48, widths: [100, 100, 300], gaps: [48, 48], equalWidth: false },
        margins: {},
      };
      const laterGapsOnlyDelta: FlowBlock = {
        kind: 'sectionBreak',
        id: 'sb-gaps-only',
        type: 'continuous',
        columns: { count: 3, gap: 48, widths: [100, 100, 300], gaps: [48, 96], equalWidth: false },
        margins: {},
      };

      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [] },
        toExplicitColumns,
        { kind: 'paragraph', id: 'p2', runs: [] },
        { kind: 'columnBreak', id: 'br-1' } as ColumnBreakBlock,
        { kind: 'paragraph', id: 'p3', runs: [] },
        laterGapsOnlyDelta,
        { kind: 'paragraph', id: 'p4', runs: [] },
      ];

      const measures: Measure[] = [
        makeMeasure([40]),
        { kind: 'sectionBreak' },
        makeMeasure([40]),
        { kind: 'columnBreak' },
        makeMeasure([40]),
        { kind: 'sectionBreak' },
        makeMeasure([40]),
      ];

      const options: LayoutOptions = {
        pageSize: { w: 700, h: 792 },
        margins: { top: 72, right: 50, bottom: 72, left: 50 },
      };

      const layout = layoutDocument(blocks, measures, options);
      const page = layout.pages[0];
      const expectedSecondColumnX = 50 + 100 + 48;

      const p2 = page.fragments.find((f) => f.blockId === 'p2') as ParaFragment;
      const p3 = page.fragments.find((f) => f.blockId === 'p3') as ParaFragment;
      const p4 = page.fragments.find((f) => f.blockId === 'p4') as ParaFragment;

      expect(p2.x).toBeCloseTo(50);
      expect(p3.x).toBeCloseTo(expectedSecondColumnX);
      expect(p4.x).toBeCloseTo(expectedSecondColumnX);
      expect(page.columnRegions).toHaveLength(2);
      expect(page.columnRegions?.[1]?.columns).toEqual({
        count: 3,
        gap: 48,
        widths: [100, 100, 300],
        gaps: [48, 48],
        equalWidth: false,
      });
    });

    it('does not balance the final page for explicit custom-width columns', () => {
      const blocks: FlowBlock[] = [
        {
          kind: 'sectionBreak',
          id: 'sb-custom-final-page',
          type: 'nextPage',
          columns: { count: 2, gap: 48, widths: [210, 214], equalWidth: false },
          margins: {},
        } as SectionBreakBlock,
        { kind: 'paragraph', id: 'p1', runs: [] },
        { kind: 'paragraph', id: 'p2', runs: [] },
        { kind: 'paragraph', id: 'p3', runs: [] },
      ];

      const measures: Measure[] = [{ kind: 'sectionBreak' }, makeMeasure([40]), makeMeasure([40]), makeMeasure([40])];

      const options: LayoutOptions = {
        pageSize: { w: 612, h: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
      };

      const layout = layoutDocument(blocks, measures, options);
      const page = layout.pages[0];

      const p1 = page.fragments.find((f) => f.blockId === 'p1') as ParaFragment;
      const p2 = page.fragments.find((f) => f.blockId === 'p2') as ParaFragment;
      const p3 = page.fragments.find((f) => f.blockId === 'p3') as ParaFragment;

      expect(p1.x).toBeCloseTo(72);
      expect(p2.x).toBeCloseTo(72);
      expect(p3.x).toBeCloseTo(72);
      expect(p2.y).toBeGreaterThan(p1.y);
      expect(p3.y).toBeGreaterThan(p2.y);
    });
  });

  describe('drawing blocks', () => {
    it('lays out inline drawings with margins', () => {
      const drawingBlock: FlowBlock = {
        kind: 'drawing',
        id: 'drawing-inline',
        drawingKind: 'vectorShape',
        geometry: { width: 80, height: 40, rotation: 0 },
        margin: { top: 10, bottom: 5, left: 4, right: 6 },
      };
      const drawingMeasure: DrawingMeasure = {
        kind: 'drawing',
        drawingKind: 'vectorShape',
        width: 80,
        height: 40,
        scale: 1,
        naturalWidth: 80,
        naturalHeight: 40,
        geometry: { width: 80, height: 40, rotation: 0, flipH: false, flipV: false },
      };
      const layout = layoutDocument([drawingBlock], [drawingMeasure], DEFAULT_OPTIONS);
      expect(layout.pages[0].fragments).toHaveLength(1);
      const fragment = layout.pages[0].fragments[0] as DrawingFragment;
      expect(fragment.kind).toBe('drawing');
      expect(fragment.blockId).toBe('drawing-inline');
      expect(fragment.width).toBeCloseTo(80);
      expect(fragment.height).toBeCloseTo(40);
      expect(fragment.y).toBe(DEFAULT_OPTIONS.margins!.top + 10);
    });

    it('anchors drawings relative to nearest paragraph', () => {
      const paragraphBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'para-anchor',
        runs: [],
      };
      const drawingBlock: FlowBlock = {
        kind: 'drawing',
        id: 'drawing-anchored',
        drawingKind: 'vectorShape',
        geometry: { width: 60, height: 30, rotation: 0 },
        anchor: {
          isAnchored: true,
          hRelativeFrom: 'column',
          vRelativeFrom: 'paragraph',
          alignH: 'left',
          offsetH: 5,
          offsetV: 3,
        },
        wrap: {
          type: 'Square',
          wrapText: 'right',
        },
      };
      const paragraphMeasure = makeMeasure([20]);
      const drawingMeasure: DrawingMeasure = {
        kind: 'drawing',
        drawingKind: 'vectorShape',
        width: 60,
        height: 30,
        scale: 1,
        naturalWidth: 60,
        naturalHeight: 30,
        geometry: { width: 60, height: 30, rotation: 0, flipH: false, flipV: false },
      };
      const layout = layoutDocument(
        [paragraphBlock, drawingBlock],
        [paragraphMeasure, drawingMeasure],
        DEFAULT_OPTIONS,
      );
      const fragment = layout.pages[0].fragments.find((frag) => frag.blockId === 'drawing-anchored') as DrawingFragment;
      expect(fragment).toBeTruthy();
      expect(fragment.kind).toBe('drawing');
      expect(fragment.isAnchored).toBe(true);
      expect(fragment.x).toBeGreaterThanOrEqual(DEFAULT_OPTIONS.margins!.left + 5);
      expect(fragment.y).toBeGreaterThanOrEqual(DEFAULT_OPTIONS.margins!.top + 3);
    });

    it('creates fragment for page-relative anchored drawing (SD-1838)', () => {
      const paragraphBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'para-anchor',
        runs: [],
      };
      const drawingBlock: FlowBlock = {
        kind: 'drawing',
        id: 'drawing-page-relative',
        drawingKind: 'vectorShape',
        geometry: { width: 100, height: 60, rotation: 0 },
        anchor: {
          isAnchored: true,
          hRelativeFrom: 'column',
          vRelativeFrom: 'page',
          alignH: 'left',
          offsetH: 10,
          offsetV: 80,
        },
        wrap: {
          type: 'None',
        },
      };
      const paragraphMeasure = makeMeasure([20]);
      const drawingMeasure: DrawingMeasure = {
        kind: 'drawing',
        drawingKind: 'vectorShape',
        width: 100,
        height: 60,
        scale: 1,
        naturalWidth: 100,
        naturalHeight: 60,
        geometry: { width: 100, height: 60, rotation: 0, flipH: false, flipV: false },
      };
      const layout = layoutDocument(
        [paragraphBlock, drawingBlock],
        [paragraphMeasure, drawingMeasure],
        DEFAULT_OPTIONS,
      );
      const fragment = layout.pages[0].fragments.find(
        (frag) => frag.blockId === 'drawing-page-relative',
      ) as DrawingFragment;
      expect(fragment).toBeTruthy();
      expect(fragment.kind).toBe('drawing');
      expect(fragment.isAnchored).toBe(true);
      expect(fragment.y).toBe(80); // offsetV from page top
      expect(fragment.width).toBe(100);
      expect(fragment.height).toBe(60);
    });

    it('emits pre-registered page-relative drawings on the page where they are encountered after pagination advances', () => {
      const firstPageParagraph: FlowBlock = {
        kind: 'paragraph',
        id: 'para-page-1',
        runs: [],
      };
      const forcedBreak: FlowBlock = {
        kind: 'pageBreak',
        id: 'pb-before-drawing',
      };
      const secondPageParagraph: FlowBlock = {
        kind: 'paragraph',
        id: 'para-page-2',
        runs: [],
      };
      const drawingBlock: FlowBlock = {
        kind: 'drawing',
        id: 'drawing-pre-reg-page',
        drawingKind: 'vectorShape',
        geometry: { width: 120, height: 120, rotation: 0 },
        anchor: {
          isAnchored: true,
          hRelativeFrom: 'column',
          vRelativeFrom: 'page',
          alignH: 'left',
          alignV: 'top',
          offsetH: 0,
          offsetV: 0,
        },
        wrap: {
          type: 'Square',
          wrapText: 'right',
          distLeft: 0,
          distRight: 10,
        },
      };
      const paragraphMeasure = makeMeasure([20]);
      const drawingMeasure: DrawingMeasure = {
        kind: 'drawing',
        drawingKind: 'vectorShape',
        width: 120,
        height: 120,
        scale: 1,
        naturalWidth: 120,
        naturalHeight: 120,
        geometry: { width: 120, height: 120, rotation: 0, flipH: false, flipV: false },
      };

      const remeasureParagraph: NonNullable<LayoutOptions['remeasureParagraph']> = (_block, _maxWidth) => {
        return makeMeasure([20]);
      };

      const layout = layoutDocument(
        [firstPageParagraph, forcedBreak, drawingBlock, secondPageParagraph],
        [paragraphMeasure, { kind: 'pageBreak' }, drawingMeasure, paragraphMeasure],
        {
          ...DEFAULT_OPTIONS,
          remeasureParagraph,
        },
      );

      expect(layout.pages).toHaveLength(2);

      const page1 = layout.pages[0];
      const page2 = layout.pages[1];

      const wrappedPara = page1.fragments.find(
        (fragment) => fragment.kind === 'para' && fragment.blockId === 'para-page-1',
      ) as ParaFragment;
      expect(wrappedPara).toBeTruthy();
      expect(wrappedPara.x).toBe(DEFAULT_OPTIONS.margins!.left);

      const page2Para = page2.fragments.find(
        (fragment) => fragment.kind === 'para' && fragment.blockId === 'para-page-2',
      ) as ParaFragment;
      expect(page2Para).toBeTruthy();

      const drawingOnPage1 = page1.fragments.find(
        (fragment) => fragment.kind === 'drawing' && fragment.blockId === 'drawing-pre-reg-page',
      );
      const drawingOnPage2 = page2.fragments.find(
        (fragment) => fragment.kind === 'drawing' && fragment.blockId === 'drawing-pre-reg-page',
      );

      expect(drawingOnPage1).toBeUndefined();
      expect(drawingOnPage2).toBeTruthy();
    });

    it('creates fragment for margin-relative anchored drawing with wrapNone', () => {
      const paragraphBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'para-anchor-2',
        runs: [],
      };
      const drawingBlock: FlowBlock = {
        kind: 'drawing',
        id: 'drawing-margin-relative',
        drawingKind: 'vectorShape',
        geometry: { width: 80, height: 40, rotation: 0 },
        anchor: {
          isAnchored: true,
          hRelativeFrom: 'margin',
          vRelativeFrom: 'margin',
          alignH: 'left',
          alignV: 'top',
          offsetH: 0,
          offsetV: 15,
        },
        wrap: {
          type: 'None',
        },
      };
      const paragraphMeasure = makeMeasure([20]);
      const drawingMeasure: DrawingMeasure = {
        kind: 'drawing',
        drawingKind: 'vectorShape',
        width: 80,
        height: 40,
        scale: 1,
        naturalWidth: 80,
        naturalHeight: 40,
        geometry: { width: 80, height: 40, rotation: 0, flipH: false, flipV: false },
      };
      const layout = layoutDocument(
        [paragraphBlock, drawingBlock],
        [paragraphMeasure, drawingMeasure],
        DEFAULT_OPTIONS,
      );
      const fragment = layout.pages[0].fragments.find(
        (frag) => frag.blockId === 'drawing-margin-relative',
      ) as DrawingFragment;
      expect(fragment).toBeTruthy();
      expect(fragment.kind).toBe('drawing');
      expect(fragment.isAnchored).toBe(true);
      // margin-relative, alignV='top', offsetV=15: contentTop + 15
      expect(fragment.y).toBe(DEFAULT_OPTIONS.margins!.top + 15);
      expect(fragment.width).toBe(80);
      expect(fragment.height).toBe(40);
    });
  });

  describe('anchored images bounds and zIndex', () => {
    it('places behindDoc anchored image with negative offset above page background and negative y', () => {
      const para: FlowBlock = { kind: 'paragraph', id: 'p1', runs: [] };
      const anchored: ImageBlock = {
        kind: 'image',
        id: 'img-anchored',
        src: 'data:image/png;base64,xxx',
        anchor: { isAnchored: true, alignH: 'left', offsetV: -20, behindDoc: true },
      };

      const blocks: FlowBlock[] = [anchored, para];
      const measures: Measure[] = [{ kind: 'image', width: 50, height: 40 }, makeMeasure([40])];

      const options: LayoutOptions = {
        pageSize: { w: 400, h: 400 },
        margins: { top: 40, right: 30, bottom: 40, left: 30 },
      };

      const layout = layoutDocument(blocks, measures, options);
      const page = layout.pages[0];
      // Anchored image fragment should appear before the paragraph and have negative y relative to margin top
      const img = page.fragments.find((f) => f.blockId === 'img-anchored') as ImageFragment;
      expect(img).toBeTruthy();
      expect(img.y).toBeLessThan(options.margins!.top); // negative relative offset applied
      // behindDoc → zIndex 0
      expect(img.zIndex).toBe(0);
    });

    it('emits pre-registered page-relative images on the page where they are encountered after pagination advances', () => {
      const firstPageParagraph: FlowBlock = {
        kind: 'paragraph',
        id: 'para-page-1',
        runs: [],
      };
      const forcedBreak: FlowBlock = {
        kind: 'pageBreak',
        id: 'pb-before-image',
      };
      const secondPageParagraph: FlowBlock = {
        kind: 'paragraph',
        id: 'para-page-2',
        runs: [],
      };
      const imageBlock: ImageBlock = {
        kind: 'image',
        id: 'img-pre-reg-page',
        src: 'data:image/png;base64,xxx',
        anchor: {
          isAnchored: true,
          hRelativeFrom: 'column',
          vRelativeFrom: 'page',
          alignH: 'left',
          alignV: 'top',
          offsetH: 0,
          offsetV: 0,
        },
        wrap: {
          type: 'Square',
          wrapText: 'right',
          distLeft: 0,
          distRight: 10,
        },
      };
      const paragraphMeasure = makeMeasure([20]);
      const imageMeasure: ImageMeasure = {
        kind: 'image',
        width: 120,
        height: 120,
      };

      const remeasureParagraph: NonNullable<LayoutOptions['remeasureParagraph']> = (_block, _maxWidth) => {
        return makeMeasure([20]);
      };

      const layout = layoutDocument(
        [firstPageParagraph, forcedBreak, imageBlock, secondPageParagraph],
        [paragraphMeasure, { kind: 'pageBreak' }, imageMeasure, paragraphMeasure],
        {
          ...DEFAULT_OPTIONS,
          remeasureParagraph,
        },
      );

      expect(layout.pages).toHaveLength(2);

      const page1 = layout.pages[0];
      const page2 = layout.pages[1];

      const imageOnPage1 = page1.fragments.find(
        (fragment) => fragment.kind === 'image' && fragment.blockId === 'img-pre-reg-page',
      );
      const imageOnPage2 = page2.fragments.find(
        (fragment) => fragment.kind === 'image' && fragment.blockId === 'img-pre-reg-page',
      );

      expect(imageOnPage1).toBeUndefined();
      expect(imageOnPage2).toBeTruthy();
    });
  });

  describe('textbox content measures', () => {
    it('stores contentMeasures for inline textbox drawings when remeasureParagraph is available', () => {
      const drawingBlock: FlowBlock = {
        kind: 'drawing',
        id: 'textbox-inline',
        drawingKind: 'textboxShape',
        geometry: { width: 120, height: 80, rotation: 0, flipH: false, flipV: false },
        contentBlocks: [
          {
            kind: 'paragraph',
            id: 'textbox-para-1',
            runs: [{ text: 'Textbox text', pmStart: 10, pmEnd: 22 }],
          },
        ],
        textInsets: { top: 4, right: 8, bottom: 4, left: 12 },
      };
      const drawingMeasure: DrawingMeasure = {
        kind: 'drawing',
        drawingKind: 'textboxShape',
        width: 120,
        height: 80,
        scale: 1,
        naturalWidth: 120,
        naturalHeight: 80,
        geometry: { width: 120, height: 80, rotation: 0, flipH: false, flipV: false },
      };

      const remeasureParagraph: NonNullable<LayoutOptions['remeasureParagraph']> = (_block, maxWidth) => {
        expect(maxWidth).toBe(100);
        return makeMeasure([18]);
      };

      const layout = layoutDocument([drawingBlock], [drawingMeasure], {
        ...DEFAULT_OPTIONS,
        remeasureParagraph,
      });

      const fragment = layout.pages[0].fragments[0] as DrawingFragment;
      expect(fragment.kind).toBe('drawing');
      expect(fragment.drawingKind).toBe('textboxShape');
      expect(fragment.contentMeasures).toHaveLength(1);
      expect(fragment.contentMeasures?.[0]?.totalHeight).toBe(18);
    });

    it('stores contentMeasures for anchored textbox drawings on pre-registered pages', () => {
      const firstPageParagraph: FlowBlock = {
        kind: 'paragraph',
        id: 'para-page-1',
        runs: [],
      };
      const forcedBreak: FlowBlock = {
        kind: 'pageBreak',
        id: 'pb-before-textbox',
      };
      const textboxBlock: FlowBlock = {
        kind: 'drawing',
        id: 'textbox-pre-reg-page',
        drawingKind: 'textboxShape',
        geometry: { width: 120, height: 80, rotation: 0, flipH: false, flipV: false },
        contentBlocks: [
          {
            kind: 'paragraph',
            id: 'textbox-para-anchored',
            runs: [{ text: 'Anchored textbox', pmStart: 30, pmEnd: 45 }],
          },
        ],
        textInsets: { top: 0, right: 10, bottom: 0, left: 10 },
        anchor: {
          isAnchored: true,
          hRelativeFrom: 'column',
          vRelativeFrom: 'page',
          alignH: 'left',
          alignV: 'top',
          offsetH: 0,
          offsetV: 0,
        },
        wrap: {
          type: 'Square',
          wrapText: 'right',
          distLeft: 0,
          distRight: 10,
        },
      };
      const paragraphMeasure = makeMeasure([20]);
      const drawingMeasure: DrawingMeasure = {
        kind: 'drawing',
        drawingKind: 'textboxShape',
        width: 120,
        height: 80,
        scale: 1,
        naturalWidth: 120,
        naturalHeight: 80,
        geometry: { width: 120, height: 80, rotation: 0, flipH: false, flipV: false },
      };

      const remeasureWidths: number[] = [];
      const remeasureParagraph: NonNullable<LayoutOptions['remeasureParagraph']> = (_block, maxWidth) => {
        remeasureWidths.push(maxWidth);
        return makeMeasure([16, 16]);
      };

      const layout = layoutDocument(
        [firstPageParagraph, forcedBreak, textboxBlock],
        [paragraphMeasure, { kind: 'pageBreak' }, drawingMeasure],
        {
          ...DEFAULT_OPTIONS,
          remeasureParagraph,
        },
      );

      const page2 = layout.pages[1];
      const fragment = page2.fragments.find((frag) => frag.blockId === 'textbox-pre-reg-page') as DrawingFragment;
      expect(fragment).toBeTruthy();
      expect(fragment.drawingKind).toBe('textboxShape');
      expect(fragment.contentMeasures).toHaveLength(1);
      expect(fragment.contentMeasures?.[0]?.lines).toHaveLength(2);
      expect(remeasureWidths).toContain(100);
    });
  });

  describe('tables in columns/pages', () => {
    it('moves table to next column when not enough vertical space', () => {
      const table: TableBlock = {
        kind: 'table',
        id: 'tbl-1',
        rows: [{ id: 'r1', cells: [] }],
      };

      const blocks: FlowBlock[] = [{ kind: 'paragraph', id: 'p1', runs: [] }, table];

      const measures: Measure[] = [
        makeMeasure([300]),
        { kind: 'table', rows: [], columnWidths: [], totalWidth: 400, totalHeight: 500 } as TableMeasure,
      ];

      const options: LayoutOptions = {
        pageSize: { w: 612, h: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
        columns: { count: 2, gap: 48 },
      };

      const layout = layoutDocument(blocks, measures, options);
      const page = layout.pages[0];
      const contentWidth = options.pageSize!.w - options.margins!.left - options.margins!.right;
      const columnWidth = (contentWidth - 48) / 2;
      const tbl = page.fragments.find((f) => f.blockId === 'tbl-1');
      // Table should be in column 2 if para consumed most of column height
      expect(tbl?.x).toBeCloseTo(options.margins!.left + columnWidth + 48);
    });

    it('moves table to next page when in last column and no space', () => {
      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'p1', runs: [] },
        { kind: 'paragraph', id: 'p2', runs: [] },
        { kind: 'table', id: 'tbl-1', rows: [] } as TableBlock,
      ];

      const measures: Measure[] = [
        makeMeasure([600]),
        makeMeasure([400]), // Force second column close to full
        { kind: 'table', rows: [], columnWidths: [], totalWidth: 400, totalHeight: 400 } as TableMeasure,
      ];

      const options: LayoutOptions = {
        pageSize: { w: 612, h: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
        columns: { count: 2, gap: 48 },
      };

      const layout = layoutDocument(blocks, measures, options);
      // Table should be on page 2 since last column had no space
      expect(layout.pages.length).toBeGreaterThan(1);
      const page2tbl = layout.pages[1].fragments.find((f) => f.blockId === 'tbl-1');
      expect(page2tbl).toBeTruthy();
    });
  });

  describe('PM ranges across columns and regions', () => {
    it('keeps pm ranges correct across column splits', () => {
      const blockWithRuns: FlowBlock = {
        kind: 'paragraph',
        id: 'p-col',
        runs: [{ text: 'abcdefghi', fontFamily: 'Arial', fontSize: 16, pmStart: 1, pmEnd: 10 }],
      };

      const measure: Measure = {
        kind: 'paragraph',
        lines: [
          { fromRun: 0, fromChar: 0, toRun: 0, toChar: 3, width: 100, ascent: 10, descent: 4, lineHeight: 300 },
          { fromRun: 0, fromChar: 3, toRun: 0, toChar: 6, width: 100, ascent: 10, descent: 4, lineHeight: 300 },
          { fromRun: 0, fromChar: 6, toRun: 0, toChar: 9, width: 100, ascent: 10, descent: 4, lineHeight: 300 },
        ],
        totalHeight: 900,
      };

      const options: LayoutOptions = {
        pageSize: { w: 612, h: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
        columns: { count: 2, gap: 48 },
      };

      const layout = layoutDocument([blockWithRuns], [measure], options);
      const fragments = layout.pages[0].fragments.filter((f) => f.blockId === 'p-col') as ParaFragment[];
      // Expect at least two fragments (across columns/pages)
      expect(fragments.length).toBeGreaterThanOrEqual(2);
      // First fragment should start at pm 1 and cover at least the first line
      expect(fragments[0].pmStart).toBe(1);
      expect(fragments[0].pmEnd).toBeGreaterThanOrEqual(4);
      // Next fragment should continue where the previous ended
      expect(fragments[1].pmStart).toBe(fragments[0].pmEnd);
    });

    it('keeps pm ranges correct across mid-page region transition to columns', () => {
      const toTwoColumns: FlowBlock = {
        kind: 'sectionBreak',
        id: 'sb-1',
        type: 'continuous',
        columns: { count: 2, gap: 48 },
        margins: {},
      };
      const blockWithRuns: FlowBlock = {
        kind: 'paragraph',
        id: 'p2',
        runs: [{ text: 'abcdef', fontFamily: 'Arial', fontSize: 16, pmStart: 10, pmEnd: 16 }],
        attrs: { widowControl: false },
      };
      const measures: Measure[] = [
        makeMeasure([40]),
        { kind: 'sectionBreak' },
        {
          kind: 'paragraph',
          lines: [
            { fromRun: 0, fromChar: 0, toRun: 0, toChar: 3, width: 100, ascent: 10, descent: 4, lineHeight: 320 },
            { fromRun: 0, fromChar: 3, toRun: 0, toChar: 6, width: 100, ascent: 10, descent: 4, lineHeight: 320 },
          ],
          totalHeight: 640,
        },
      ];
      const blocks: FlowBlock[] = [{ kind: 'paragraph', id: 'p1', runs: [] }, toTwoColumns, blockWithRuns];

      const options: LayoutOptions = {
        pageSize: { w: 612, h: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
      };

      const layout = layoutDocument(blocks, measures, options);
      const page = layout.pages[0];
      const frags = page.fragments.filter((f) => f.blockId === 'p2') as ParaFragment[];
      expect(frags.length).toBe(2);
      expect(frags[0].pmStart).toBe(10);
      expect(frags[0].pmEnd).toBe(13);
      expect(frags[1].pmStart).toBe(13);
      expect(frags[1].pmEnd).toBe(16);
    });
  });

  describe('floatAlignment positioning', () => {
    it('positions fragment at right when floatAlignment=right', () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'p1',
        runs: [{ text: '1', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { floatAlignment: 'right' },
      };
      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 1, width: 50, ascent: 12, descent: 4, lineHeight: 16 }],
        totalHeight: 16,
      };
      const options: LayoutOptions = {
        pageSize: { w: 600, h: 800 },
        margins: { top: 50, right: 50, bottom: 50, left: 50 },
      };

      const layout = layoutDocument([block], [measure], options);

      expect(layout.pages).toHaveLength(1);
      const fragment = layout.pages[0].fragments[0] as ParaFragment;
      // columnWidth = 600 - 50 - 50 = 500
      // lineWidth = 50
      // right-aligned: x = 50 + (500 - 50) = 500
      expect(fragment.x).toBe(500);
      expect(fragment.y).toBe(50);
    });

    it('positions fragment at center when floatAlignment=center', () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'p1',
        runs: [{ text: '1', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { floatAlignment: 'center' },
      };
      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 1, width: 100, ascent: 12, descent: 4, lineHeight: 16 }],
        totalHeight: 16,
      };
      const options: LayoutOptions = {
        pageSize: { w: 600, h: 800 },
        margins: { top: 50, right: 50, bottom: 50, left: 50 },
      };

      const layout = layoutDocument([block], [measure], options);

      expect(layout.pages).toHaveLength(1);
      const fragment = layout.pages[0].fragments[0] as ParaFragment;
      // columnWidth = 500
      // lineWidth = 100
      // centered: x = 50 + (500 - 100) / 2 = 50 + 200 = 250
      expect(fragment.x).toBe(250);
      expect(fragment.y).toBe(50);
    });

    it('does not adjust position when floatAlignment=left (default behavior)', () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'p1',
        runs: [{ text: '1', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { floatAlignment: 'left' },
      };
      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 1, width: 50, ascent: 12, descent: 4, lineHeight: 16 }],
        totalHeight: 16,
      };
      const options: LayoutOptions = {
        pageSize: { w: 600, h: 800 },
        margins: { top: 50, right: 50, bottom: 50, left: 50 },
      };

      const layout = layoutDocument([block], [measure], options);

      expect(layout.pages).toHaveLength(1);
      const fragment = layout.pages[0].fragments[0] as ParaFragment;
      // left-aligned: x = 50 (left margin, no adjustment)
      expect(fragment.x).toBe(50);
      expect(fragment.y).toBe(50);
    });

    it('does not adjust position when floatAlignment is undefined', () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'p1',
        runs: [{ text: 'Normal text', fontFamily: 'Arial', fontSize: 16 }],
      };
      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 11, width: 200, ascent: 12, descent: 4, lineHeight: 16 }],
        totalHeight: 16,
      };
      const options: LayoutOptions = {
        pageSize: { w: 600, h: 800 },
        margins: { top: 50, right: 50, bottom: 50, left: 50 },
      };

      const layout = layoutDocument([block], [measure], options);

      expect(layout.pages).toHaveLength(1);
      const fragment = layout.pages[0].fragments[0] as ParaFragment;
      // No floatAlignment: x = 50 (left margin, default behavior)
      expect(fragment.x).toBe(50);
      expect(fragment.y).toBe(50);
    });

    it('uses maximum line width when paragraph has multiple lines', () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'p1',
        runs: [{ text: 'Line 1 short\nLine 2 is longer', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { floatAlignment: 'right' },
      };
      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          { fromRun: 0, fromChar: 0, toRun: 0, toChar: 12, width: 60, ascent: 12, descent: 4, lineHeight: 16 },
          { fromRun: 0, fromChar: 13, toRun: 0, toChar: 29, width: 100, ascent: 12, descent: 4, lineHeight: 16 },
        ],
        totalHeight: 32,
      };
      const options: LayoutOptions = {
        pageSize: { w: 600, h: 800 },
        margins: { top: 50, right: 50, bottom: 50, left: 50 },
      };

      const layout = layoutDocument([block], [measure], options);

      expect(layout.pages).toHaveLength(1);
      const fragment = layout.pages[0].fragments[0] as ParaFragment;
      // Max line width = 100
      // columnWidth = 500
      // right-aligned: x = 50 + (500 - 100) = 450
      expect(fragment.x).toBe(450);
    });

    it('handles floatAlignment with split paragraphs across pages', () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'p1',
        runs: [{ text: 'Text', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { floatAlignment: 'right' },
      };
      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          { fromRun: 0, fromChar: 0, toRun: 0, toChar: 1, width: 50, ascent: 72, descent: 18, lineHeight: 90 },
          { fromRun: 0, fromChar: 1, toRun: 0, toChar: 2, width: 50, ascent: 72, descent: 18, lineHeight: 90 },
        ],
        totalHeight: 180,
      };
      const options: LayoutOptions = {
        pageSize: { w: 400, h: 150 },
        margins: { top: 30, right: 30, bottom: 30, left: 30 },
      };

      const layout = layoutDocument([block], [measure], options);

      expect(layout.pages).toHaveLength(2);
      const fragment1 = layout.pages[0].fragments[0] as ParaFragment;
      const fragment2 = layout.pages[1].fragments[0] as ParaFragment;

      // Both fragments should be right-aligned
      // columnWidth = 340, lineWidth = 50
      // x = 30 + (340 - 50) = 320
      expect(fragment1.x).toBe(320);
      expect(fragment2.x).toBe(320);
    });

    it('works in footers with right-aligned page numbers', () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'footer-1',
        runs: [{ text: '0', token: 'pageNumber', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { floatAlignment: 'right' },
      };
      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 1, width: 10, ascent: 12, descent: 4, lineHeight: 16 }],
        totalHeight: 16,
      };

      const layout = layoutHeaderFooter([block], [measure], { width: 816, height: 100 });

      expect(layout.pages).toHaveLength(1);
      const fragment = layout.pages[0].fragments[0] as ParaFragment;
      // columnWidth = 816, lineWidth = 10
      // right-aligned: x = 0 + (816 - 10) = 806
      expect(fragment.x).toBe(806);
    });

    it('positions wrap=none frame paragraphs as overlays without consuming flow in headers', () => {
      const frameBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'page-num',
        runs: [{ text: '1', fontFamily: 'Arial', fontSize: 12 }],
        attrs: { frame: { wrap: 'none', xAlign: 'right', y: 10 } },
      };
      const headerText: FlowBlock = {
        kind: 'paragraph',
        id: 'header-text',
        runs: [{ text: 'Normal header text', fontFamily: 'Arial', fontSize: 12 }],
      };

      const frameMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 1, width: 8, ascent: 9, descent: 3, lineHeight: 12 }],
        totalHeight: 12,
      };
      const headerMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 17, width: 100, ascent: 10, descent: 3, lineHeight: 14 }],
        totalHeight: 14,
      };

      const layout = layoutHeaderFooter([frameBlock, headerText], [frameMeasure, headerMeasure], {
        width: 200,
        height: 60,
      });

      const pageFragments = layout.pages[0].fragments as ParaFragment[];
      const pageNumFrag = pageFragments.find((f) => f.blockId === 'page-num')!;
      const headerFrag = pageFragments.find((f) => f.blockId === 'header-text')!;

      expect(pageNumFrag.x).toBeCloseTo(192);
      expect(pageNumFrag.y).toBeCloseTo(10);
      // Frame paragraph should not push following content down
      expect(headerFrag.y).toBe(0);
    });

    it('positions wrap=around frame paragraphs while still reserving flow in headers', () => {
      const frameBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'page-num',
        runs: [{ text: '1', fontFamily: 'Arial', fontSize: 12 }],
        attrs: { frame: { wrap: 'around', xAlign: 'center', y: 1 } },
      };
      const headerText: FlowBlock = {
        kind: 'paragraph',
        id: 'header-text',
        runs: [{ text: 'Normal header text', fontFamily: 'Arial', fontSize: 12 }],
      };

      const frameMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 1, width: 8, ascent: 9, descent: 3, lineHeight: 12 }],
        totalHeight: 12,
      };
      const headerMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 17, width: 100, ascent: 10, descent: 3, lineHeight: 14 }],
        totalHeight: 14,
      };

      const layout = layoutHeaderFooter([frameBlock, headerText], [frameMeasure, headerMeasure], {
        width: 200,
        height: 60,
      });

      const pageFragments = layout.pages[0].fragments as ParaFragment[];
      const pageNumFrag = pageFragments.find((f) => f.blockId === 'page-num')!;
      const headerFrag = pageFragments.find((f) => f.blockId === 'header-text')!;

      expect(pageNumFrag.x).toBeCloseTo(96);
      expect(pageNumFrag.y).toBeCloseTo(1);
      expect(pageNumFrag.width).toBe(200);
      expect(headerFrag.y).toBe(12);
      expect(layout.height).toBe(26);
    });

    it('measures an intersecting page-anchored footer frame in footer-local coordinates', () => {
      const frameBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'footer-doc-id',
        runs: [{ text: 'Document ID', fontFamily: 'Arial', fontSize: 12 }],
        attrs: { frame: { wrap: 'around', vAnchor: 'page', y: 988.8667 } },
      };
      const frameMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 11, width: 70, ascent: 10, descent: 4, lineHeight: 14 }],
        totalHeight: 14,
      };
      const constraints = {
        width: 816,
        height: 960,
        pageHeight: 1056,
        margins: { left: 72, right: 72, top: 96, bottom: 96, header: 48, footer: 48 },
      };

      const layout = layoutHeaderFooter([frameBlock], [frameMeasure], constraints, 'footer');
      const fragment = layout.pages[0].fragments[0] as ParaFragment;

      expect(fragment.y).toBeCloseTo(28.8667);
      expect(layout.height).toBeCloseTo(42.8667);
      // Adding the footer decoration origin preserves the original physical position.
      expect(fragment.y + (constraints.pageHeight - constraints.margins.bottom)).toBeCloseTo(988.8667);
    });

    it('does not reserve footer space for an out-of-band page-anchored paragraph frame', () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'out-of-band-frame',
        runs: [{ text: 'Outside', fontFamily: 'Arial', fontSize: 12 }],
        attrs: { frame: { wrap: 'around', vAnchor: 'page', y: 700 } },
      };
      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 7, width: 40, ascent: 9, descent: 3, lineHeight: 12 }],
        totalHeight: 12,
      };

      const layout = layoutHeaderFooter(
        [block],
        [measure],
        {
          width: 816,
          height: 960,
          pageHeight: 1056,
          margins: { left: 72, right: 72, top: 96, bottom: 96, header: 48, footer: 48 },
        },
        'footer',
      );

      expect(layout.height).toBe(0);
      expect(layout.renderHeight).toBe(260);
    });

    it('does not advance footer flow for an out-of-band page-anchored paragraph frame', () => {
      const frameBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'out-of-band-frame',
        runs: [{ text: 'Outside', fontFamily: 'Arial', fontSize: 12 }],
        attrs: { frame: { wrap: 'around', vAnchor: 'page', y: 700 } },
      };
      const footerText: FlowBlock = {
        kind: 'paragraph',
        id: 'footer-text',
        runs: [{ text: 'Footer', fontFamily: 'Arial', fontSize: 12 }],
      };
      const frameMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 7, width: 40, ascent: 9, descent: 3, lineHeight: 12 }],
        totalHeight: 12,
      };
      const footerMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 6, width: 36, ascent: 9, descent: 3, lineHeight: 12 }],
        totalHeight: 12,
      };

      const layout = layoutHeaderFooter(
        [frameBlock, footerText],
        [frameMeasure, footerMeasure],
        {
          width: 816,
          height: 960,
          pageHeight: 1056,
          margins: { left: 72, right: 72, top: 96, bottom: 96, header: 48, footer: 48 },
        },
        'footer',
      );

      const frameFragment = layout.pages[0].fragments.find((fragment) => fragment.blockId === frameBlock.id);
      const footerFragment = layout.pages[0].fragments.find((fragment) => fragment.blockId === footerText.id);
      expect(frameFragment?.y).toBe(-260);
      expect(footerFragment?.y).toBe(0);
      expect(layout.height).toBe(12);
    });

    it.each(['around', 'none'] as const)(
      'keeps an out-of-band wrap=%s page frame on the first story page after full-height footer content',
      (wrap) => {
        const footerText: FlowBlock = {
          kind: 'paragraph',
          id: 'full-height-footer-text',
          runs: [{ text: 'Footer', fontFamily: 'Arial', fontSize: 12 }],
        };
        const frameBlock: FlowBlock = {
          kind: 'paragraph',
          id: 'out-of-band-frame',
          runs: [{ text: 'Outside', fontFamily: 'Arial', fontSize: 12 }],
          attrs: { frame: { wrap, vAnchor: 'page', y: 700 } },
        };
        const footerMeasure: ParagraphMeasure = {
          kind: 'paragraph',
          lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 6, width: 36, ascent: 9, descent: 3, lineHeight: 960 }],
          totalHeight: 960,
        };
        const frameMeasure: ParagraphMeasure = {
          kind: 'paragraph',
          lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 7, width: 40, ascent: 9, descent: 3, lineHeight: 12 }],
          totalHeight: 12,
        };

        const layout = layoutHeaderFooter(
          [footerText, frameBlock],
          [footerMeasure, frameMeasure],
          {
            width: 816,
            height: 960,
            pageHeight: 1056,
            margins: { left: 72, right: 72, top: 96, bottom: 96, header: 48, footer: 48 },
          },
          'footer',
        );

        expect(layout.pages[0].fragments.some((fragment) => fragment.blockId === frameBlock.id)).toBe(true);
      },
    );

    it('does not reserve header space for a page-anchored paragraph frame below the top margin', () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'out-of-band-header-frame',
        runs: [{ text: 'Outside', fontFamily: 'Arial', fontSize: 12 }],
        attrs: { frame: { wrap: 'around', vAnchor: 'page', y: 120 } },
      };
      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 7, width: 40, ascent: 9, descent: 3, lineHeight: 12 }],
        totalHeight: 12,
      };

      const layout = layoutHeaderFooter(
        [block],
        [measure],
        {
          width: 816,
          height: 960,
          pageHeight: 1056,
          margins: { left: 72, right: 72, top: 96, bottom: 72, header: 48, footer: 48 },
        },
        'header',
      );

      expect(layout.height).toBe(0);
      expect(layout.renderHeight).toBe(132);
    });

    it('does not advance header flow for an out-of-band page-anchored paragraph frame', () => {
      const frameBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'out-of-band-header-frame',
        runs: [{ text: 'Outside', fontFamily: 'Arial', fontSize: 12 }],
        attrs: { frame: { wrap: 'around', vAnchor: 'page', y: 120 } },
      };
      const headerText: FlowBlock = {
        kind: 'paragraph',
        id: 'header-text',
        runs: [{ text: 'Header', fontFamily: 'Arial', fontSize: 12 }],
      };
      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 7, width: 40, ascent: 9, descent: 3, lineHeight: 12 }],
        totalHeight: 12,
      };

      const layout = layoutHeaderFooter(
        [frameBlock, headerText],
        [measure, measure],
        {
          width: 816,
          height: 960,
          pageHeight: 1056,
          margins: { left: 72, right: 72, top: 96, bottom: 72, header: 48, footer: 48 },
        },
        'header',
      );

      const headerFragment = layout.pages[0].fragments.find((fragment) => fragment.blockId === headerText.id);
      expect(headerFragment?.y).toBe(0);
      expect(layout.height).toBe(12);
    });

    it('treats wrap=none page-anchored paragraph frames as non-reserving overlays', () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'footer-overlay-frame',
        runs: [{ text: 'Overlay', fontFamily: 'Arial', fontSize: 12 }],
        attrs: { frame: { wrap: 'none', vAnchor: 'page', y: 980 } },
      };
      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 7, width: 40, ascent: 9, descent: 3, lineHeight: 12 }],
        totalHeight: 12,
      };

      const layout = layoutHeaderFooter(
        [block],
        [measure],
        {
          width: 816,
          height: 960,
          pageHeight: 1056,
          margins: { left: 72, right: 72, top: 96, bottom: 96, header: 48, footer: 48 },
        },
        'footer',
      );

      expect(layout.height).toBe(0);
      expect(layout.renderHeight).toBe(32);
    });

    it.each([undefined, 'auto'])('measures wrap=%s page-anchored paragraphs as ordinary flow', (wrap) => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'ordinary-footer-paragraph',
        runs: [{ text: 'Ordinary', fontFamily: 'Arial', fontSize: 12 }],
        attrs: { frame: { wrap, vAnchor: 'page', y: 700 } },
      };
      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 8, width: 45, ascent: 9, descent: 3, lineHeight: 12 }],
        totalHeight: 12,
      };

      const layout = layoutHeaderFooter(
        [block],
        [measure],
        {
          width: 816,
          height: 960,
          pageHeight: 1056,
          margins: { left: 72, right: 72, top: 96, bottom: 96, header: 48, footer: 48 },
        },
        'footer',
      );

      expect(layout.pages[0].fragments[0].y).toBe(0);
      expect(layout.height).toBe(12);
    });

    it.each(['around', 'none'] as const)(
      'measures wrap=%s yAlign-only page-anchored paragraphs as ordinary flow',
      (wrap) => {
        const block: FlowBlock = {
          kind: 'paragraph',
          id: 'aligned-footer-paragraph',
          runs: [{ text: 'Aligned', fontFamily: 'Arial', fontSize: 12 }],
          attrs: { frame: { wrap, vAnchor: 'page', yAlign: 'bottom' } },
        };
        const measure: ParagraphMeasure = {
          kind: 'paragraph',
          lines: [
            {
              fromRun: 0,
              fromChar: 0,
              toRun: 0,
              toChar: 7,
              width: 40,
              ascent: 9,
              descent: 3,
              lineHeight: 12,
            },
          ],
          totalHeight: 12,
        };

        const layout = layoutHeaderFooter(
          [block],
          [measure],
          {
            width: 816,
            height: 960,
            pageHeight: 1056,
            margins: { left: 72, right: 72, top: 96, bottom: 96, header: 48, footer: 48 },
          },
          'footer',
        );

        expect(layout.pages[0].fragments[0].y).toBe(0);
        expect(layout.height).toBe(12);
      },
    );
  });

  describe('keepNext with contextual spacing', () => {
    it('accounts for contextual spacing when calculating if keepNext pair fits', () => {
      // Create two same-style paragraphs with contextual spacing
      const heading: FlowBlock = {
        kind: 'paragraph',
        id: 'heading',
        runs: [{ text: 'Heading', fontFamily: 'Arial', fontSize: 24 }],
        attrs: {
          keepNext: true,
          styleId: 'Heading1',
          contextualSpacing: true,
          spacing: { after: 20 },
        },
      };
      const body: FlowBlock = {
        kind: 'paragraph',
        id: 'body',
        runs: [{ text: 'Body text', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {
          styleId: 'Heading1', // Same style - contextual spacing applies
          contextualSpacing: true,
          spacing: { before: 20 },
        },
      };

      // Heights: heading 40px, body 20px
      // With contextual spacing: no gap between them (both have contextualSpacing + same style)
      // Without contextual spacing: max(20, 20) = 20px gap
      const headingMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [makeLine(40)],
        totalHeight: 40,
      };
      const bodyMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [makeLine(20)],
        totalHeight: 20,
      };

      // Page: 150px content area, tight fit scenario
      // With contextual spacing: 40 + 0 + 20 = 60px needed
      // Without contextual spacing: 40 + 20 + 20 = 80px needed
      const options: LayoutOptions = {
        pageSize: { w: 400, h: 150 },
        margins: { top: 30, right: 30, bottom: 60, left: 30 }, // 60px content height
      };

      const layout = layoutDocument([heading, body], [headingMeasure, bodyMeasure], options);

      // Both should fit on first page due to contextual spacing
      expect(layout.pages).toHaveLength(1);
      expect(pageContainsBlock(layout.pages[0], 'heading')).toBe(true);
      expect(pageContainsBlock(layout.pages[0], 'body')).toBe(true);
    });

    it('advances page when keepNext pair does not fit even with contextual spacing', () => {
      // Previous paragraph to fill most of the page
      const filler: FlowBlock = {
        kind: 'paragraph',
        id: 'filler',
        runs: [{ text: 'Filler', fontFamily: 'Arial', fontSize: 12 }],
        attrs: { styleId: 'Normal' },
      };
      const heading: FlowBlock = {
        kind: 'paragraph',
        id: 'heading',
        runs: [{ text: 'Heading', fontFamily: 'Arial', fontSize: 24 }],
        attrs: {
          keepNext: true,
          styleId: 'Heading1',
          contextualSpacing: true,
          spacing: { after: 20 },
        },
      };
      const body: FlowBlock = {
        kind: 'paragraph',
        id: 'body',
        runs: [{ text: 'Body', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {
          styleId: 'Heading1',
          contextualSpacing: true,
          spacing: { before: 20 },
        },
      };

      const fillerMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [makeLine(100)], // Takes most of the space
        totalHeight: 100,
      };
      const headingMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [makeLine(40)],
        totalHeight: 40,
      };
      const bodyMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [makeLine(20)],
        totalHeight: 20,
      };

      // 120px content, filler takes 100px, only 20px left
      // heading (40) + body (20) = 60px needed, won't fit
      const options: LayoutOptions = {
        pageSize: { w: 400, h: 180 },
        margins: { top: 30, right: 30, bottom: 30, left: 30 }, // 120px content
      };

      const layout = layoutDocument([filler, heading, body], [fillerMeasure, headingMeasure, bodyMeasure], options);

      // Filler on page 1, heading+body pushed to page 2
      expect(layout.pages.length).toBeGreaterThanOrEqual(2);
      expect(pageContainsBlock(layout.pages[0], 'filler')).toBe(true);
      expect(pageContainsBlock(layout.pages[1], 'heading')).toBe(true);
      expect(pageContainsBlock(layout.pages[1], 'body')).toBe(true);
    });

    it('suppresses inter-paragraph spacing when both paragraphs have contextualSpacing', () => {
      const current: FlowBlock = {
        kind: 'paragraph',
        id: 'current',
        runs: [{ text: 'Current', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {
          keepNext: true,
          styleId: 'TestStyle',
          contextualSpacing: true,
          spacing: { after: 50 },
        },
      };
      const next: FlowBlock = {
        kind: 'paragraph',
        id: 'next',
        runs: [{ text: 'Next', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {
          styleId: 'TestStyle',
          contextualSpacing: true,
          spacing: { before: 10 },
        },
      };

      const currentMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [makeLine(30)],
        totalHeight: 30,
      };
      const nextMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [makeLine(20)],
        totalHeight: 20,
      };

      // Both opt in → gap = max(0, 0) = 0px. Total = 30 + 0 + 20 = 50px
      const options: LayoutOptions = {
        pageSize: { w: 400, h: 130 },
        margins: { top: 30, right: 30, bottom: 30, left: 30 }, // 70px content
      };

      const layout = layoutDocument([current, next], [currentMeasure, nextMeasure], options);

      expect(layout.pages).toHaveLength(1);
      expect(pageContainsBlock(layout.pages[0], 'current')).toBe(true);
      expect(pageContainsBlock(layout.pages[0], 'next')).toBe(true);
    });

    it('suppresses current after-spacing even when next does not have contextualSpacing (per-paragraph)', () => {
      const current: FlowBlock = {
        kind: 'paragraph',
        id: 'current',
        runs: [{ text: 'Current', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {
          keepNext: true,
          styleId: 'TestStyle',
          contextualSpacing: true,
          spacing: { after: 50 },
        },
      };
      const next: FlowBlock = {
        kind: 'paragraph',
        id: 'next',
        runs: [{ text: 'Next', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {
          styleId: 'TestStyle',
          // next does NOT have contextualSpacing — per-paragraph rule: current still
          // suppresses its own after-spacing independently
          spacing: { before: 10 },
        },
      };

      const currentMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [makeLine(30)],
        totalHeight: 30,
      };
      const nextMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [makeLine(20)],
        totalHeight: 20,
      };

      // Current suppresses its own after → 0. Next does not suppress before → 10.
      // gap = max(0, 10) = 10px. Total = 30 + 10 + 20 = 60px < 70px → one page
      const options: LayoutOptions = {
        pageSize: { w: 400, h: 130 },
        margins: { top: 30, right: 30, bottom: 30, left: 30 }, // 70px content
      };

      const layout = layoutDocument([current, next], [currentMeasure, nextMeasure], options);

      expect(layout.pages).toHaveLength(1);
    });
  });

  /**
   * Tests for keepNext chain handling.
   *
   * In OOXML, when multiple consecutive paragraphs all have keepNext=true, they form
   * a "chain" that Word treats as an indivisible unit for pagination. If the chain
   * doesn't fit on the current page, the entire chain moves to the next page.
   *
   * @see ECMA-376 Part 1, Section 17.3.1.14 (keepNext)
   */
  describe('keepNext chain handling', () => {
    it('moves entire chain to next page when chain does not fit', () => {
      // A filler paragraph uses up space on page 1, then a chain that fits on
      // a blank page but NOT on the remaining space should move to page 2.
      const filler: FlowBlock = {
        kind: 'paragraph',
        id: 'filler',
        runs: [{ text: 'Filler content', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {}, // No keepNext
      };
      const para1: FlowBlock = {
        kind: 'paragraph',
        id: 'p1',
        runs: [{ text: 'Para 1', fontFamily: 'Arial', fontSize: 12 }],
        attrs: { keepNext: true },
      };
      const para2: FlowBlock = {
        kind: 'paragraph',
        id: 'p2',
        runs: [{ text: 'Para 2', fontFamily: 'Arial', fontSize: 12 }],
        attrs: { keepNext: true },
      };
      const anchor: FlowBlock = {
        kind: 'paragraph',
        id: 'anchor',
        runs: [{ text: 'Anchor', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {}, // No keepNext - this is the anchor
      };

      // Filler is 50px, chain members are each 25px
      const fillerMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [makeLine(50)],
        totalHeight: 50,
      };
      const chainMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [makeLine(25)],
        totalHeight: 25,
      };

      // Page has 100px content area
      // After filler (50px), only 50px remains
      // Chain needs 25+25+25 = 75px (doesn't fit in 50px, but fits on blank 100px page)
      const options: LayoutOptions = {
        pageSize: { w: 400, h: 160 },
        margins: { top: 30, right: 30, bottom: 30, left: 30 }, // 100px content
      };

      const layout = layoutDocument(
        [filler, para1, para2, anchor],
        [fillerMeasure, chainMeasure, chainMeasure, chainMeasure],
        options,
      );

      // Filler on page 1, chain moves to page 2 as a unit
      expect(layout.pages).toHaveLength(2);
      expect(pageContainsBlock(layout.pages[0], 'filler')).toBe(true);
      expect(pageContainsBlock(layout.pages[0], 'p1')).toBe(false);
      // All chain members + anchor should be on page 2
      expect(pageContainsBlock(layout.pages[1], 'p1')).toBe(true);
      expect(pageContainsBlock(layout.pages[1], 'p2')).toBe(true);
      expect(pageContainsBlock(layout.pages[1], 'anchor')).toBe(true);
    });

    it('keeps chain on current page when it fits', () => {
      // Create a chain of 2 paragraphs with keepNext, followed by an anchor
      const para1: FlowBlock = {
        kind: 'paragraph',
        id: 'p1',
        runs: [{ text: 'Para 1', fontFamily: 'Arial', fontSize: 12 }],
        attrs: { keepNext: true },
      };
      const para2: FlowBlock = {
        kind: 'paragraph',
        id: 'p2',
        runs: [{ text: 'Para 2', fontFamily: 'Arial', fontSize: 12 }],
        attrs: { keepNext: true },
      };
      const anchor: FlowBlock = {
        kind: 'paragraph',
        id: 'anchor',
        runs: [{ text: 'Anchor', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {},
      };

      // Each paragraph is 20px tall
      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [makeLine(20)],
        totalHeight: 20,
      };

      // Page has 100px content area, chain needs 20+20+20 = 60px (fits)
      const options: LayoutOptions = {
        pageSize: { w: 400, h: 160 },
        margins: { top: 30, right: 30, bottom: 30, left: 30 },
      };

      const layout = layoutDocument([para1, para2, anchor], [measure, measure, measure], options);

      // Everything should fit on one page
      expect(layout.pages).toHaveLength(1);
      expect(pageContainsBlock(layout.pages[0], 'p1')).toBe(true);
      expect(pageContainsBlock(layout.pages[0], 'p2')).toBe(true);
      expect(pageContainsBlock(layout.pages[0], 'anchor')).toBe(true);
    });

    it('breaks chain at section breaks', () => {
      // Chain broken by section break should not treat post-break paragraphs as part of chain
      const para1: FlowBlock = {
        kind: 'paragraph',
        id: 'p1',
        runs: [{ text: 'Para 1', fontFamily: 'Arial', fontSize: 12 }],
        attrs: { keepNext: true },
      };
      const sectionBreak: SectionBreakBlock = {
        kind: 'sectionBreak',
        id: 'sb1',
        type: 'nextPage',
      };
      const para2: FlowBlock = {
        kind: 'paragraph',
        id: 'p2',
        runs: [{ text: 'Para 2', fontFamily: 'Arial', fontSize: 12 }],
        attrs: { keepNext: true },
      };
      const anchor: FlowBlock = {
        kind: 'paragraph',
        id: 'anchor',
        runs: [{ text: 'Anchor', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {},
      };

      const paraMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [makeLine(20)],
        totalHeight: 20,
      };
      const breakMeasure: Measure = { kind: 'sectionBreak' };

      const options: LayoutOptions = {
        pageSize: { w: 400, h: 160 },
        margins: { top: 30, right: 30, bottom: 30, left: 30 },
      };

      const layout = layoutDocument(
        [para1, sectionBreak, para2, anchor],
        [paraMeasure, breakMeasure, paraMeasure, paraMeasure],
        options,
      );

      // para1 should be alone on page 1 (chain broken by section break)
      // para2 and anchor should be on page 2 (new chain after break)
      expect(layout.pages.length).toBeGreaterThanOrEqual(2);
      expect(pageContainsBlock(layout.pages[0], 'p1')).toBe(true);
      expect(pageContainsBlock(layout.pages[1], 'p2')).toBe(true);
      expect(pageContainsBlock(layout.pages[1], 'anchor')).toBe(true);
    });

    it('handles single keepNext paragraph (chain of 1)', () => {
      // A single paragraph with keepNext should still keep with its anchor
      const heading: FlowBlock = {
        kind: 'paragraph',
        id: 'heading',
        runs: [{ text: 'Heading', fontFamily: 'Arial', fontSize: 24 }],
        attrs: { keepNext: true },
      };
      const body: FlowBlock = {
        kind: 'paragraph',
        id: 'body',
        runs: [{ text: 'Body text', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {},
      };

      const headingMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [makeLine(30)],
        totalHeight: 30,
      };
      const bodyMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [makeLine(20)],
        totalHeight: 20,
      };

      // Page has 60px content area, heading+body need 50px (fits)
      const options: LayoutOptions = {
        pageSize: { w: 400, h: 120 },
        margins: { top: 30, right: 30, bottom: 30, left: 30 },
      };

      const layout = layoutDocument([heading, body], [headingMeasure, bodyMeasure], options);

      expect(layout.pages).toHaveLength(1);
      expect(pageContainsBlock(layout.pages[0], 'heading')).toBe(true);
      expect(pageContainsBlock(layout.pages[0], 'body')).toBe(true);
    });

    it('handles chain without valid anchor (at end of document)', () => {
      // Chain at end of document with no following paragraph
      const para1: FlowBlock = {
        kind: 'paragraph',
        id: 'p1',
        runs: [{ text: 'Para 1', fontFamily: 'Arial', fontSize: 12 }],
        attrs: { keepNext: true },
      };
      const para2: FlowBlock = {
        kind: 'paragraph',
        id: 'p2',
        runs: [{ text: 'Para 2', fontFamily: 'Arial', fontSize: 12 }],
        attrs: { keepNext: true },
      };

      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [makeLine(20)],
        totalHeight: 20,
      };

      const options: LayoutOptions = {
        pageSize: { w: 400, h: 120 },
        margins: { top: 30, right: 30, bottom: 30, left: 30 },
      };

      const layout = layoutDocument([para1, para2], [measure, measure], options);

      // Both paragraphs should be laid out (chain with no anchor still works)
      expect(layout.pages).toHaveLength(1);
      expect(pageContainsBlock(layout.pages[0], 'p1')).toBe(true);
      expect(pageContainsBlock(layout.pages[0], 'p2')).toBe(true);
    });

    it('does not create infinite loop when chain is taller than page', () => {
      // Chain that exceeds page height but individual paragraphs can fit.
      // The chain logic should NOT advance endlessly - it should lay out
      // content normally when the chain can never fit on any page.
      const para1: FlowBlock = {
        kind: 'paragraph',
        id: 'p1',
        runs: [{ text: 'Para 1', fontFamily: 'Arial', fontSize: 12 }],
        attrs: { keepNext: true },
      };
      const para2: FlowBlock = {
        kind: 'paragraph',
        id: 'p2',
        runs: [{ text: 'Para 2', fontFamily: 'Arial', fontSize: 12 }],
        attrs: { keepNext: true },
      };
      const para3: FlowBlock = {
        kind: 'paragraph',
        id: 'p3',
        runs: [{ text: 'Para 3', fontFamily: 'Arial', fontSize: 12 }],
        attrs: { keepNext: true },
      };
      const anchor: FlowBlock = {
        kind: 'paragraph',
        id: 'anchor',
        runs: [{ text: 'Anchor', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {},
      };

      // Each paragraph is 40px tall (fits individually on 100px page)
      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [makeLine(40)],
        totalHeight: 40,
      };

      // Page has 100px content area - chain (40*4=160px) will never fit
      const options: LayoutOptions = {
        pageSize: { w: 400, h: 160 },
        margins: { top: 30, right: 30, bottom: 30, left: 30 },
      };

      // Should not hang or throw - gracefully falls back to normal pagination
      const layout = layoutDocument([para1, para2, para3, anchor], [measure, measure, measure, measure], options);

      // Content should be spread across multiple pages (not all on one page)
      expect(layout.pages.length).toBeGreaterThan(1);
      // All paragraphs should be laid out somewhere
      const allFragments = layout.pages.flatMap((p) => p.fragments);
      const blockIds = allFragments.filter((f) => f.kind === 'para').map((f) => (f as ParaFragment).blockId);
      expect(blockIds).toContain('p1');
      expect(blockIds).toContain('p2');
      expect(blockIds).toContain('p3');
      expect(blockIds).toContain('anchor');
    });

    it('handles multiple separate chains in document', () => {
      // Document with two separate chains
      const chain1Para1: FlowBlock = {
        kind: 'paragraph',
        id: 'c1p1',
        runs: [{ text: 'Chain 1 Para 1', fontFamily: 'Arial', fontSize: 12 }],
        attrs: { keepNext: true },
      };
      const chain1Anchor: FlowBlock = {
        kind: 'paragraph',
        id: 'c1anchor',
        runs: [{ text: 'Chain 1 Anchor', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {},
      };
      const chain2Para1: FlowBlock = {
        kind: 'paragraph',
        id: 'c2p1',
        runs: [{ text: 'Chain 2 Para 1', fontFamily: 'Arial', fontSize: 12 }],
        attrs: { keepNext: true },
      };
      const chain2Anchor: FlowBlock = {
        kind: 'paragraph',
        id: 'c2anchor',
        runs: [{ text: 'Chain 2 Anchor', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {},
      };

      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [makeLine(20)],
        totalHeight: 20,
      };

      const options: LayoutOptions = {
        pageSize: { w: 400, h: 160 },
        margins: { top: 30, right: 30, bottom: 30, left: 30 },
      };

      const layout = layoutDocument(
        [chain1Para1, chain1Anchor, chain2Para1, chain2Anchor],
        [measure, measure, measure, measure],
        options,
      );

      // All should fit on one page
      expect(layout.pages).toHaveLength(1);
      expect(pageContainsBlock(layout.pages[0], 'c1p1')).toBe(true);
      expect(pageContainsBlock(layout.pages[0], 'c1anchor')).toBe(true);
      expect(pageContainsBlock(layout.pages[0], 'c2p1')).toBe(true);
      expect(pageContainsBlock(layout.pages[0], 'c2anchor')).toBe(true);
    });

    it('keeps a widow-disabled anchor first line with its keepNext heading', () => {
      // Anchor has multiple lines but only first line should be considered
      const heading: FlowBlock = {
        kind: 'paragraph',
        id: 'heading',
        runs: [{ text: 'Heading', fontFamily: 'Arial', fontSize: 24 }],
        attrs: { keepNext: true },
      };
      const body: FlowBlock = {
        kind: 'paragraph',
        id: 'body',
        runs: [{ text: 'Body with multiple lines', fontFamily: 'Arial', fontSize: 12 }],
        attrs: { widowControl: false },
      };

      const headingMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [makeLine(30)],
        totalHeight: 30,
      };
      // Body has 3 lines of 20px each = 60px total, but only first line (20px) matters for chain
      const bodyMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [makeLine(20), makeLine(20), makeLine(20)],
        totalHeight: 60,
      };

      // 55px content area: heading(30) + body.firstLine(20) = 50px fits
      // But full body (60) wouldn't fit with heading
      const options: LayoutOptions = {
        pageSize: { w: 400, h: 115 },
        margins: { top: 30, right: 30, bottom: 30, left: 30 },
      };

      const layout = layoutDocument([heading, body], [headingMeasure, bodyMeasure], options);

      // Heading and body should start on same page (chain fits using first line optimization)
      expect(pageContainsBlock(layout.pages[0], 'heading')).toBe(true);
      expect(pageContainsBlock(layout.pages[0], 'body')).toBe(true);
      expect(pageContainsBlock(layout.pages[1], 'body')).toBe(true);
    });

    it('moves a keepNext heading when widow control moves the following paragraph', () => {
      const filler: FlowBlock = {
        kind: 'paragraph',
        id: 'filler',
        runs: [{ text: 'Filler content', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {},
      };
      const heading: FlowBlock = {
        kind: 'paragraph',
        id: 'heading',
        runs: [{ text: 'Heading', fontFamily: 'Arial', fontSize: 24 }],
        attrs: { keepNext: true },
      };
      const body: FlowBlock = {
        kind: 'paragraph',
        id: 'body',
        runs: [{ text: 'Body with three lines', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {},
      };

      const fillerMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [makeLine(45)],
        totalHeight: 45,
      };
      const headingMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [makeLine(30)],
        totalHeight: 30,
      };
      const bodyMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [makeLine(20), makeLine(20), makeLine(20)],
        totalHeight: 60,
      };
      const options: LayoutOptions = {
        pageSize: { w: 400, h: 160 },
        margins: { top: 30, right: 30, bottom: 30, left: 30 },
      };

      const layout = layoutDocument([filler, heading, body], [fillerMeasure, headingMeasure, bodyMeasure], options);

      expect(pageContainsBlock(layout.pages[0], 'filler')).toBe(true);
      expect(pageContainsBlock(layout.pages[0], 'heading')).toBe(false);
      expect(pageContainsBlock(layout.pages[1], 'heading')).toBe(true);
      expect(pageContainsBlock(layout.pages[1], 'body')).toBe(true);
    });

    it('moves a keepNext heading with a keepLines anchor that does not fit', () => {
      const filler: FlowBlock = {
        kind: 'paragraph',
        id: 'filler',
        runs: [{ text: 'Filler content', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {},
      };
      const heading: FlowBlock = {
        kind: 'paragraph',
        id: 'heading',
        runs: [{ text: 'Heading', fontFamily: 'Arial', fontSize: 24 }],
        attrs: { keepNext: true },
      };
      const body: FlowBlock = {
        kind: 'paragraph',
        id: 'body',
        runs: [{ text: 'Body with three lines', fontFamily: 'Arial', fontSize: 12 }],
        attrs: { keepLines: true },
      };
      const measures: ParagraphMeasure[] = [
        { kind: 'paragraph', lines: [makeLine(45)], totalHeight: 45 },
        { kind: 'paragraph', lines: [makeLine(30)], totalHeight: 30 },
        { kind: 'paragraph', lines: [makeLine(20), makeLine(20), makeLine(20)], totalHeight: 60 },
      ];
      const options: LayoutOptions = {
        pageSize: { w: 400, h: 160 },
        margins: { top: 30, right: 30, bottom: 30, left: 30 },
      };

      const layout = layoutDocument([filler, heading, body], measures, options);

      expect(pageContainsBlock(layout.pages[0], 'filler')).toBe(true);
      expect(pageContainsBlock(layout.pages[0], 'heading')).toBe(false);
      expect(pageContainsBlock(layout.pages[0], 'body')).toBe(false);
      expect(pageContainsBlock(layout.pages[1], 'heading')).toBe(true);
      expect(pageContainsBlock(layout.pages[1], 'body')).toBe(true);
    });

    it('uses first ROW height (not full table) for a splittable table anchor so the chain starts and the table splits (SD-3345)', () => {
      // A heading (keepNext) immediately followed by a tall splittable table. The
      // heading + table FIRST ROW fits in the remaining space, but heading + the WHOLE
      // table does not. Word starts the table here and splits it; reserving the full
      // table height would push the heading + table wholly to the next page (large gap).
      const filler: FlowBlock = {
        kind: 'paragraph',
        id: 'filler',
        runs: [{ text: 'filler', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {},
      };
      const heading: FlowBlock = {
        kind: 'paragraph',
        id: 'heading',
        runs: [{ text: 'Heading', fontFamily: 'Arial', fontSize: 24 }],
        attrs: { keepNext: true },
      };
      const table = {
        kind: 'table',
        id: 'tbl',
        rows: Array.from({ length: 4 }, (_unused, i) => ({
          id: `r${i}`,
          cells: [
            {
              id: `c${i}`,
              blocks: [{ kind: 'paragraph', id: `p${i}`, runs: [{ text: 'x', fontFamily: 'Arial', fontSize: 10 }] }],
            },
          ],
        })),
      } as unknown as TableBlock;

      const fillerMeasure: ParagraphMeasure = { kind: 'paragraph', lines: [makeLine(50)], totalHeight: 50 };
      const headingMeasure: ParagraphMeasure = { kind: 'paragraph', lines: [makeLine(20)], totalHeight: 20 };
      // 4 rows × 15px = 60px total; first row 15px. Cells carry a single measured line
      // so the table-start preflight can render at least one row on the current page.
      const tableMeasure = {
        kind: 'table',
        rows: Array.from({ length: 4 }, () => ({
          cells: [{ paragraph: { kind: 'paragraph', lines: [makeLine(15)], totalHeight: 15 }, width: 100, height: 15 }],
          height: 15,
        })),
        columnWidths: [100],
        totalWidth: 100,
        totalHeight: 60,
      } as unknown as TableMeasure;

      // Content area = 100px. After filler(50), 50px remain.
      // - heading(20) + firstRow(15) = 35 <= 50  → chain fits → start on this page.
      // - heading(20) + fullTable(60) = 80 > 50  → would advance without the fix.
      //   (80 <= 100 content height, so the blank-page guard does not suppress the advance.)
      const options: LayoutOptions = {
        pageSize: { w: 400, h: 160 },
        margins: { top: 30, right: 30, bottom: 30, left: 30 },
      };

      const layout = layoutDocument([filler, heading, table], [fillerMeasure, headingMeasure, tableMeasure], options);

      // Heading and the table both start on page 0 (the table then splits across pages).
      expect(pageContainsBlock(layout.pages[0], 'heading')).toBe(true);
      expect(pageContainsBlock(layout.pages[0], 'tbl')).toBe(true);
    });

    it('reclaims trailing spacing when both filler and chain starter have contextualSpacing', () => {
      // Both filler and chain starter have contextualSpacing + same style.
      // The trailing spacing should be reclaimed, making room for the chain.
      const filler: FlowBlock = {
        kind: 'paragraph',
        id: 'filler',
        runs: [{ text: 'Filler content', fontFamily: 'Arial', fontSize: 12 }],
        attrs: { styleId: 'Normal', contextualSpacing: true, spacing: { after: 10 } },
      };
      const chainStarter: FlowBlock = {
        kind: 'paragraph',
        id: 'chainStarter',
        runs: [{ text: 'Chain starter', fontFamily: 'Arial', fontSize: 12 }],
        attrs: { keepNext: true, contextualSpacing: true, styleId: 'Normal' },
      };
      const anchor: FlowBlock = {
        kind: 'paragraph',
        id: 'anchor',
        runs: [{ text: 'Anchor', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {},
      };

      // Filler is 40px, chain starter and anchor are each 26px
      const fillerMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [makeLine(40)],
        totalHeight: 40,
      };
      const chainMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [makeLine(26)],
        totalHeight: 26,
      };

      // Page has 100px content area
      // After filler (40px) + spacingAfter (10px), cursor is at 80px (top=30 + 40 + 10)
      // Available without reclaim: 100 - 50 = 50px
      // Chain needs: 26 + 26 = 52px > 50px (does NOT fit without reclaim)
      // With reclaim the 10px spacingAfter is recovered → 60px available, 52px fits.
      const options: LayoutOptions = {
        pageSize: { w: 400, h: 160 },
        margins: { top: 30, right: 30, bottom: 30, left: 30 }, // 100px content
      };

      const layout = layoutDocument(
        [filler, chainStarter, anchor],
        [fillerMeasure, chainMeasure, chainMeasure],
        options,
      );

      // All should fit on one page because contextualSpacing reclaims the 10px
      expect(layout.pages).toHaveLength(1);
      expect(pageContainsBlock(layout.pages[0], 'filler')).toBe(true);
      expect(pageContainsBlock(layout.pages[0], 'chainStarter')).toBe(true);
      expect(pageContainsBlock(layout.pages[0], 'anchor')).toBe(true);
    });

    it('does not reclaim trailing spacing when only chain starter has contextualSpacing', () => {
      // Filler does NOT have contextualSpacing — per-paragraph rule: filler does not suppress its own after.
      // Same dimensions as the positive case: chain = 52px, available without reclaim = 50px.
      // Without reclaim 52 > 50, so the chain moves to page 2.
      const filler: FlowBlock = {
        kind: 'paragraph',
        id: 'filler',
        runs: [{ text: 'Filler content', fontFamily: 'Arial', fontSize: 12 }],
        attrs: { styleId: 'Normal', spacing: { after: 10 } },
      };
      const chainStarter: FlowBlock = {
        kind: 'paragraph',
        id: 'chainStarter',
        runs: [{ text: 'Chain starter', fontFamily: 'Arial', fontSize: 12 }],
        attrs: { keepNext: true, contextualSpacing: true, styleId: 'Normal' },
      };
      const anchor: FlowBlock = {
        kind: 'paragraph',
        id: 'anchor',
        runs: [{ text: 'Anchor', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {},
      };

      const fillerMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [makeLine(40)],
        totalHeight: 40,
      };
      const chainMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [makeLine(26)],
        totalHeight: 26,
      };

      const options: LayoutOptions = {
        pageSize: { w: 400, h: 160 },
        margins: { top: 30, right: 30, bottom: 30, left: 30 }, // 100px content
      };

      const layout = layoutDocument(
        [filler, chainStarter, anchor],
        [fillerMeasure, chainMeasure, chainMeasure],
        options,
      );

      // No reclaim → 50px available, 52px chain → page 2
      expect(layout.pages).toHaveLength(2);
      expect(pageContainsBlock(layout.pages[0], 'filler')).toBe(true);
      expect(pageContainsBlock(layout.pages[1], 'chainStarter')).toBe(true);
      expect(pageContainsBlock(layout.pages[1], 'anchor')).toBe(true);
    });

    it('does not reclaim trailing spacing when styles differ', () => {
      // Previous paragraph has spacingAfter, chain starter has contextualSpacing but DIFFERENT style.
      // The trailing spacing should NOT be reclaimed.
      const filler: FlowBlock = {
        kind: 'paragraph',
        id: 'filler',
        runs: [{ text: 'Filler content', fontFamily: 'Arial', fontSize: 12 }],
        attrs: { styleId: 'Normal', spacingAfter: 10 },
      };
      const chainStarter: FlowBlock = {
        kind: 'paragraph',
        id: 'chainStarter',
        runs: [{ text: 'Chain starter', fontFamily: 'Arial', fontSize: 12 }],
        attrs: { keepNext: true, contextualSpacing: true, styleId: 'Heading1' }, // Different style
      };
      const anchor: FlowBlock = {
        kind: 'paragraph',
        id: 'anchor',
        runs: [{ text: 'Anchor', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {},
      };

      // Filler is 50px, chain starter and anchor are each 25px
      const fillerMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [makeLine(50)],
        totalHeight: 50,
      };
      const chainMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [makeLine(25)],
        totalHeight: 25,
      };

      // Page has 95px content area (155 - 30 - 30)
      // After filler (50px), cursorY leaves 45px remaining
      // Chain needs: 25 + 25 = 50px > 45px available (doesn't fit)
      // Styles differ so no reclaim - chain must move to page 2
      const options: LayoutOptions = {
        pageSize: { w: 400, h: 155 }, // 95px content area
        margins: { top: 30, right: 30, bottom: 30, left: 30 },
      };

      const layout = layoutDocument(
        [filler, chainStarter, anchor],
        [fillerMeasure, chainMeasure, chainMeasure],
        options,
      );

      // Chain should move to page 2 because styles differ (no reclaim)
      expect(layout.pages).toHaveLength(2);
      expect(pageContainsBlock(layout.pages[0], 'filler')).toBe(true);
      expect(pageContainsBlock(layout.pages[1], 'chainStarter')).toBe(true);
      expect(pageContainsBlock(layout.pages[1], 'anchor')).toBe(true);
    });

    it('does not suppress chain-internal spacing for mixed contextualSpacing', () => {
      // Three same-style paragraphs in a keepNext chain: true / false / true.
      // The middle one opts out, so spacing around it should NOT be suppressed.
      const filler: FlowBlock = {
        kind: 'paragraph',
        id: 'filler',
        runs: [{ text: 'Filler', fontFamily: 'Arial', fontSize: 12 }],
        attrs: { styleId: 'Other' },
      };
      const para1: FlowBlock = {
        kind: 'paragraph',
        id: 'para1',
        runs: [{ text: 'Para 1', fontFamily: 'Arial', fontSize: 12 }],
        attrs: { keepNext: true, styleId: 'Normal', contextualSpacing: true, spacing: { after: 20 } },
      };
      const para2: FlowBlock = {
        kind: 'paragraph',
        id: 'para2',
        runs: [{ text: 'Para 2', fontFamily: 'Arial', fontSize: 12 }],
        attrs: { keepNext: true, styleId: 'Normal', contextualSpacing: false, spacing: { before: 20, after: 20 } },
      };
      const para3: FlowBlock = {
        kind: 'paragraph',
        id: 'para3',
        runs: [{ text: 'Para 3', fontFamily: 'Arial', fontSize: 12 }],
        attrs: { styleId: 'Normal', contextualSpacing: true, spacing: { before: 20 } },
      };

      const fillerMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [makeLine(10)],
        totalHeight: 10,
      };
      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [makeLine(20)],
        totalHeight: 20,
      };

      // Chain (para1+para2+para3) with per-paragraph rule:
      //   para1→para2: para1 suppresses after (cs=true) → 0, para2 keeps before (cs=false) → 20. gap = max(0,20) = 20
      //   para2→para3: para2 keeps after (cs=false) → 20, para3 suppresses before (cs=true) → 0. gap = max(20,0) = 20
      //   Total: 20 + 20 + 20 + 20 + 20 = 100px
      //
      // Filler takes 10px. Content area = 105px.
      // After filler, 95px remain — 100px chain doesn't fit current page but fits blank page → page 2.
      const options: LayoutOptions = {
        pageSize: { w: 400, h: 165 },
        margins: { top: 30, right: 30, bottom: 30, left: 30 }, // 105px content
      };

      const layout = layoutDocument([filler, para1, para2, para3], [fillerMeasure, measure, measure, measure], options);

      // Chain must move to page 2 because it's 100px and only 95px remain after filler.
      expect(layout.pages).toHaveLength(2);
      expect(pageContainsBlock(layout.pages[0], 'filler')).toBe(true);
      expect(pageContainsBlock(layout.pages[1], 'para1')).toBe(true);
      expect(pageContainsBlock(layout.pages[1], 'para2')).toBe(true);
      expect(pageContainsBlock(layout.pages[1], 'para3')).toBe(true);
    });
  });
});

describe('alternateHeaders (odd/even header differentiation)', () => {
  // Two tall paragraphs (400px each) that force a 2-page layout.
  const tallBlock = (id: string): FlowBlock => ({
    kind: 'paragraph',
    id,
    runs: [],
  });
  const tallMeasure = makeMeasure([400]);

  it('selects even/odd header heights when alternateHeaders is true', () => {
    const options: LayoutOptions = {
      pageSize: { w: 600, h: 800 },
      margins: { top: 50, right: 50, bottom: 50, left: 50, header: 30 },
      alternateHeaders: true,
      sectionMetadata: [{ sectionIndex: 0, headerRefs: { odd: 'h-odd', even: 'h-even' } }],
      headerContentHeights: {
        odd: 80, // Odd pages: header pushes body start down
        even: 40, // Even pages: smaller header
      },
    };

    const layout = layoutDocument([tallBlock('p1'), tallBlock('p2')], [tallMeasure, tallMeasure], options);

    expect(layout.pages).toHaveLength(2);

    // Page 1 has display number 1 (odd) -> uses 'odd' header height (80px)
    // Body should start at max(margin.top, margin.header + headerContentHeight) = max(50, 30+80) = 110
    const p1Fragment = layout.pages[0].fragments.find((f) => f.blockId === 'p1');
    expect(p1Fragment).toBeDefined();
    expect(p1Fragment!.y).toBeCloseTo(110, 0);

    // Page 2 has display number 2 (even) -> uses 'even' header height (40px)
    // Body should start at max(margin.top, margin.header + headerContentHeight) = max(50, 30+40) = 70
    const p2Fragment = layout.pages[1].fragments.find((f) => f.blockId === 'p2');
    expect(p2Fragment).toBeDefined();
    expect(p2Fragment!.y).toBeCloseTo(70, 0);
  });

  it('uses default header height when odd pages resolve through the default ref', () => {
    const options: LayoutOptions = {
      pageSize: { w: 600, h: 800 },
      margins: { top: 50, right: 50, bottom: 50, left: 50, header: 30 },
      alternateHeaders: true,
      sectionMetadata: [{ sectionIndex: 0, headerRefs: { default: 'rIdDefault' } }],
      headerContentHeights: {
        default: 80,
      },
    };

    const layout = layoutDocument([tallBlock('p1')], [tallMeasure], options);

    expect(layout.pages).toHaveLength(1);

    const p1Fragment = layout.pages[0].fragments.find((f) => f.blockId === 'p1');
    expect(p1Fragment).toBeDefined();
    expect(p1Fragment!.y).toBeCloseTo(110, 0);
    expect(layout.pages[0].margins.top).toBeCloseTo(110, 0);
  });
  it('uses section page-numbering start for odd/even header parity', () => {
    const options: LayoutOptions = {
      pageSize: { w: 600, h: 800 },
      margins: { top: 50, right: 50, bottom: 50, left: 50, header: 30 },
      alternateHeaders: true,
      sectionMetadata: [{ sectionIndex: 0, numbering: { start: 2 } }],
      headerContentHeights: {
        odd: 80,
        even: 40,
      },
    };

    const layout = layoutDocument([tallBlock('p1'), tallBlock('p2')], [tallMeasure, tallMeasure], options);

    expect(layout.pages).toHaveLength(2);
    expect(layout.pages[0].displayNumber).toBe(2);
    expect(layout.pages[0].numberText).toBe('2');
    expect(layout.pages[1].displayNumber).toBe(3);

    const p1Fragment = layout.pages[0].fragments.find((f) => f.blockId === 'p1');
    const p2Fragment = layout.pages[1].fragments.find((f) => f.blockId === 'p2');
    expect(p1Fragment).toBeDefined();
    expect(p2Fragment).toBeDefined();
    expect(p1Fragment!.y).toBeCloseTo(70, 0);
    expect(p2Fragment!.y).toBeCloseTo(110, 0);
  });

  it('stamps global physical and section positions from a page-boundary resume', () => {
    const options: LayoutOptions = {
      pageSize: { w: 600, h: 800 },
      margins: { top: 50, right: 50, bottom: 50, left: 50 },
      sectionMetadata: [{ sectionIndex: 7, numbering: { start: 37 } }],
      startContext: {
        pageNumberOffset: 40,
        activePageCounter: 37,
        activeSectionIndex: 7,
        activeSectionFirstPageNumber: 33,
      },
    };

    const layout = layoutDocument([tallBlock('p1'), tallBlock('p2')], [tallMeasure, tallMeasure], options);

    expect(layout.pages.map((page) => page.number)).toEqual([41, 42]);
    expect(layout.pages.map((page) => page.displayNumber)).toEqual([37, 38]);
    expect(layout.pages.map((page) => page.sectionPageNumber)).toEqual([9, 10]);
  });

  it('uses default header height for all pages when alternateHeaders is false', () => {
    const options: LayoutOptions = {
      pageSize: { w: 600, h: 800 },
      margins: { top: 50, right: 50, bottom: 50, left: 50, header: 30 },
      alternateHeaders: false,
      sectionMetadata: [{ sectionIndex: 0, headerRefs: { default: 'h-default' } }],
      headerContentHeights: {
        default: 60,
        odd: 80,
        even: 40,
      },
    };

    const layout = layoutDocument([tallBlock('p1'), tallBlock('p2')], [tallMeasure, tallMeasure], options);

    expect(layout.pages).toHaveLength(2);

    // Both pages use 'default' header height (60px)
    // Body start = max(50, 30+60) = 90
    const p1Fragment = layout.pages[0].fragments.find((f) => f.blockId === 'p1');
    const p2Fragment = layout.pages[1].fragments.find((f) => f.blockId === 'p2');
    expect(p1Fragment!.y).toBeCloseTo(90, 0);
    expect(p2Fragment!.y).toBeCloseTo(90, 0);
  });

  it('defaults to false when alternateHeaders is omitted', () => {
    const options: LayoutOptions = {
      pageSize: { w: 600, h: 800 },
      margins: { top: 50, right: 50, bottom: 50, left: 50, header: 30 },
      // alternateHeaders not set
      sectionMetadata: [{ sectionIndex: 0, headerRefs: { default: 'h-default' } }],
      headerContentHeights: {
        default: 60,
        odd: 80,
        even: 40,
      },
    };

    const layout = layoutDocument([tallBlock('p1'), tallBlock('p2')], [tallMeasure, tallMeasure], options);

    expect(layout.pages).toHaveLength(2);

    // Both pages should use 'default' (60px), not odd/even
    const p1Fragment = layout.pages[0].fragments.find((f) => f.blockId === 'p1');
    const p2Fragment = layout.pages[1].fragments.find((f) => f.blockId === 'p2');
    expect(p1Fragment!.y).toBeCloseTo(90, 0);
    expect(p2Fragment!.y).toBeCloseTo(90, 0);
  });

  it('first page uses first variant when titlePg is enabled with alternateHeaders', () => {
    const sectionBreak: SectionBreakBlock = {
      kind: 'sectionBreak',
      id: 'sb',
      attrs: { isFirstSection: true, source: 'sectPr', sectionIndex: 0 },
      pageSize: { w: 600, h: 800 },
      margins: { top: 50, right: 50, bottom: 50, left: 50, header: 30 },
    };

    const options: LayoutOptions = {
      pageSize: { w: 600, h: 800 },
      margins: { top: 50, right: 50, bottom: 50, left: 50, header: 30 },
      alternateHeaders: true,
      sectionMetadata: [
        { sectionIndex: 0, titlePg: true, headerRefs: { first: 'h-first', odd: 'h-odd', even: 'h-even' } },
      ],
      headerContentHeights: {
        first: 100, // First page: tallest header
        odd: 80,
        even: 40,
      },
    };

    const layout = layoutDocument(
      [sectionBreak, tallBlock('p1'), tallBlock('p2'), tallBlock('p3')],
      [{ kind: 'sectionBreak' }, tallMeasure, tallMeasure, tallMeasure],
      options,
    );

    expect(layout.pages.length).toBeGreaterThanOrEqual(3);

    // Page 1 (first page of section, titlePg=true) -> 'first' variant -> 100px
    // Body start = max(50, 30+100) = 130
    const p1Fragment = layout.pages[0].fragments.find((f) => f.blockId === 'p1');
    expect(p1Fragment).toBeDefined();
    expect(p1Fragment!.y).toBeCloseTo(130, 0);

    // Page 2 has display number 2 (even) -> 'even' variant -> 40px
    // Body start = max(50, 30+40) = 70
    const p2Fragment = layout.pages[1].fragments.find((f) => f.blockId === 'p2');
    expect(p2Fragment).toBeDefined();
    expect(p2Fragment!.y).toBeCloseTo(70, 0);

    // Page 3 has display number 3 (odd) -> 'odd' variant -> 80px
    // Body start = max(50, 30+80) = 110
    const p3Fragment = layout.pages[2].fragments.find((f) => f.blockId === 'p3');
    expect(p3Fragment).toBeDefined();
    expect(p3Fragment!.y).toBeCloseTo(110, 0);
  });

  it('multi-section: uses display page number for even/odd, not section-relative', () => {
    // Section 1 has 3 pages (pages 1-3), section 2 starts on page 4.
    // Page 4 has display number 4 (even), but sectionPageNumber=1 (odd).
    // The fix ensures the page-numbering value is used for even/odd.
    const sb1: SectionBreakBlock = {
      kind: 'sectionBreak',
      id: 'sb1',
      attrs: { isFirstSection: true, source: 'sectPr', sectionIndex: 0 },
      pageSize: { w: 600, h: 800 },
      margins: { top: 50, right: 50, bottom: 50, left: 50, header: 30 },
    };
    const sb2: SectionBreakBlock = {
      kind: 'sectionBreak',
      id: 'sb2',
      type: 'nextPage',
      attrs: { source: 'sectPr', sectionIndex: 1 },
      pageSize: { w: 600, h: 800 },
      margins: { top: 50, right: 50, bottom: 50, left: 50, header: 30 },
    };

    const options: LayoutOptions = {
      pageSize: { w: 600, h: 800 },
      margins: { top: 50, right: 50, bottom: 50, left: 50, header: 30 },
      alternateHeaders: true,
      sectionMetadata: [{ sectionIndex: 0, headerRefs: { odd: 'h-odd', even: 'h-even' } }, { sectionIndex: 1 }],
      headerContentHeights: {
        odd: 80,
        even: 40,
      },
    };

    const layout = layoutDocument(
      [sb1, tallBlock('p1'), tallBlock('p2'), tallBlock('p3'), sb2, tallBlock('p4')],
      [{ kind: 'sectionBreak' }, tallMeasure, tallMeasure, tallMeasure, { kind: 'sectionBreak' }, tallMeasure],
      options,
    );

    expect(layout.pages.length).toBeGreaterThanOrEqual(4);

    // Page 4 has display number 4 (even) -> should use 'even' header (40px)
    // NOT 'odd' which would happen if sectionPageNumber (1) were used
    // Body start = max(50, 30+40) = 70
    const p4Fragment = layout.pages[3]?.fragments.find((f) => f.blockId === 'p4');
    expect(p4Fragment).toBeDefined();
    expect(p4Fragment!.y).toBeCloseTo(70, 0);
  });

  it('uses restarted section page numbering for even/odd header selection', () => {
    const sb1: SectionBreakBlock = {
      kind: 'sectionBreak',
      id: 'sb1-restart',
      attrs: { isFirstSection: true, source: 'sectPr', sectionIndex: 0 },
      pageSize: { w: 600, h: 800 },
      margins: { top: 50, right: 50, bottom: 50, left: 50, header: 30 },
    };
    const sb2: SectionBreakBlock = {
      kind: 'sectionBreak',
      id: 'sb2-restart',
      type: 'nextPage',
      attrs: { source: 'sectPr', sectionIndex: 1 },
      pageSize: { w: 600, h: 800 },
      margins: { top: 50, right: 50, bottom: 50, left: 50, header: 30 },
    };

    const options: LayoutOptions = {
      pageSize: { w: 600, h: 800 },
      margins: { top: 50, right: 50, bottom: 50, left: 50, header: 30 },
      alternateHeaders: true,
      sectionMetadata: [
        { sectionIndex: 0 },
        { sectionIndex: 1, numbering: { start: 2 }, headerRefs: { odd: 'h-odd', even: 'h-even' } },
      ],
      headerContentHeightsByRId: new Map([
        ['h-odd', 80],
        ['h-even', 40],
      ]),
    };

    const layout = layoutDocument(
      [sb1, tallBlock('p1'), tallBlock('p2'), sb2, tallBlock('p3')],
      [{ kind: 'sectionBreak' }, tallMeasure, tallMeasure, { kind: 'sectionBreak' }, tallMeasure],
      options,
    );

    expect(layout.pages.length).toBeGreaterThanOrEqual(3);
    expect(layout.pages[2].number).toBe(3);
    expect(layout.pages[2].effectivePageNumber).toBe(2);
    expect(layout.pages[2].numberText).toBe('2');

    const p3Fragment = layout.pages[2]?.fragments.find((f) => f.blockId === 'p3');
    expect(p3Fragment).toBeDefined();
    expect(p3Fragment!.y).toBeCloseTo(70, 0);
  });

  it('selects even/odd footer heights when alternateHeaders is true', () => {
    // The footer-height path uses the per-rId map + sectionMetadata.footerRefs.
    // Exposing the variant selection through `footerContentHeights` alone is not
    // sufficient — without refs, the code falls back to 'default' for the footer
    // variant regardless. We need the ref map to observe variant switching on
    // `page.margins.bottom`.
    const options: LayoutOptions = {
      pageSize: { w: 600, h: 800 },
      margins: { top: 50, right: 50, bottom: 50, left: 50, footer: 30 },
      alternateHeaders: true,
      sectionMetadata: [{ sectionIndex: 0, footerRefs: { odd: 'rIdFooterOdd', even: 'rIdFooterEven' } }],
      footerContentHeightsByRId: new Map([
        ['rIdFooterOdd', 80], // Odd pages: larger footer
        ['rIdFooterEven', 40], // Even pages: smaller footer
      ]),
    };

    const layout = layoutDocument([tallBlock('p1'), tallBlock('p2')], [tallMeasure, tallMeasure], options);

    expect(layout.pages).toHaveLength(2);

    // Page 1 has display number 1 (odd) -> 'odd' footer (80px) -> bottom = max(50, 30+80) = 110
    // Page 2 has display number 2 (even) -> 'even' footer (40px) -> bottom = max(50, 30+40) = 70
    // Body-top Y is footer-independent, so assert on the effective bottom margin
    // the paginator stamped on each page.
    expect(layout.pages[0].margins?.bottom).toBeCloseTo(110, 0);
    expect(layout.pages[1].margins?.bottom).toBeCloseTo(70, 0);
  });

  it('uses default as the odd header when only default is defined with alternateHeaders', () => {
    // Production path: a document with `w:evenAndOddHeaders` on but only a
    // `default` header authored. sectionMetadata supplies the `default` ref and
    // the per-rId height map supplies its measurement. Step-3 fallback at
    // index.ts:1345-1349 kicks in and `effectiveVariantType` drops to 'default'.
    const options: LayoutOptions = {
      pageSize: { w: 600, h: 800 },
      margins: { top: 50, right: 50, bottom: 50, left: 50, header: 30 },
      alternateHeaders: true,
      sectionMetadata: [{ sectionIndex: 0, headerRefs: { default: 'rIdHeaderDefault' } }],
      headerContentHeightsByRId: new Map([['rIdHeaderDefault', 60]]),
    };

    const layout = layoutDocument([tallBlock('p1'), tallBlock('p2')], [tallMeasure, tallMeasure], options);

    expect(layout.pages).toHaveLength(2);

    const p1Fragment = layout.pages[0].fragments.find((f) => f.blockId === 'p1');
    const p2Fragment = layout.pages[1].fragments.find((f) => f.blockId === 'p2');
    expect(p1Fragment!.y).toBeCloseTo(90, 0);
    expect(p2Fragment!.y).toBeCloseTo(50, 0);
    // Page 1 uses the default/odd header. Page 2 has no even header and resets
    // to the base top margin.
    expect(layout.pages[0].margins?.top).toBeCloseTo(90, 0);
    expect(layout.pages[1].margins?.top).toBeCloseTo(50, 0);
  });

  it('uses inherited first and even refs across multiple sections for margin heights', () => {
    const sb0: SectionBreakBlock = {
      kind: 'sectionBreak',
      id: 'sb0',
      attrs: { isFirstSection: true, source: 'sectPr', sectionIndex: 0 },
      margins: {},
    };
    const sb1: SectionBreakBlock = {
      kind: 'sectionBreak',
      id: 'sb1',
      type: 'nextPage',
      attrs: { source: 'sectPr', sectionIndex: 1 },
      margins: {},
    };
    const sb2: SectionBreakBlock = {
      kind: 'sectionBreak',
      id: 'sb2',
      type: 'nextPage',
      attrs: { source: 'sectPr', sectionIndex: 2 },
      margins: {},
    };
    const options: LayoutOptions = {
      pageSize: { w: 600, h: 800 },
      margins: { top: 50, right: 50, bottom: 50, left: 50, header: 30 },
      alternateHeaders: true,
      sectionMetadata: [
        { sectionIndex: 0, titlePg: true, headerRefs: { first: 'h0-first', even: 'h0-even' } },
        { sectionIndex: 1 },
        { sectionIndex: 2, titlePg: true },
      ],
      headerContentHeightsByRId: new Map([
        ['h0-first', 100],
        ['h0-even', 80],
      ]),
    };

    const layout = layoutDocument(
      [sb0, tallBlock('p1'), sb1, tallBlock('p2'), sb2, tallBlock('p3'), tallBlock('p4')],
      [
        { kind: 'sectionBreak' },
        tallMeasure,
        { kind: 'sectionBreak' },
        tallMeasure,
        { kind: 'sectionBreak' },
        tallMeasure,
        tallMeasure,
      ],
      options,
    );

    expect(layout.pages[2].fragments.find((f) => f.blockId === 'p3')?.y).toBeCloseTo(130, 0);
    expect(layout.pages[3].fragments.find((f) => f.blockId === 'p4')?.y).toBeCloseTo(110, 0);
  });

  it('uses inherited footer refs across sections for margin heights', () => {
    const sb0: SectionBreakBlock = {
      kind: 'sectionBreak',
      id: 'sb0-footer',
      attrs: { isFirstSection: true, source: 'sectPr', sectionIndex: 0 },
      margins: {},
    };
    const sb1: SectionBreakBlock = {
      kind: 'sectionBreak',
      id: 'sb1-footer',
      type: 'nextPage',
      attrs: { source: 'sectPr', sectionIndex: 1 },
      margins: {},
    };
    const options: LayoutOptions = {
      pageSize: { w: 600, h: 800 },
      margins: { top: 50, right: 50, bottom: 50, left: 50, footer: 30 },
      sectionMetadata: [{ sectionIndex: 0, footerRefs: { default: 'f0-default' } }, { sectionIndex: 1 }],
      footerContentHeightsByRId: new Map([['f0-default', 80]]),
    };

    const layout = layoutDocument(
      [sb0, tallBlock('p1-footer'), sb1, tallBlock('p2-footer')],
      [{ kind: 'sectionBreak' }, tallMeasure, { kind: 'sectionBreak' }, tallMeasure],
      options,
    );

    expect(layout.pages[1].margins?.bottom).toBeCloseTo(110, 0);
  });

  it('uses metadata matched by sparse sectionIndex for title-page header selection', () => {
    const sb0: SectionBreakBlock = {
      kind: 'sectionBreak',
      id: 'sb0-sparse',
      attrs: { isFirstSection: true, source: 'sectPr', sectionIndex: 0 },
      margins: {},
    };
    const sb2: SectionBreakBlock = {
      kind: 'sectionBreak',
      id: 'sb2-sparse',
      type: 'nextPage',
      attrs: { source: 'sectPr', sectionIndex: 2 },
      margins: {},
    };
    const options: LayoutOptions = {
      pageSize: { w: 600, h: 800 },
      margins: { top: 50, right: 50, bottom: 50, left: 50, header: 30 },
      sectionMetadata: [{ sectionIndex: 0 }, { sectionIndex: 2, titlePg: true, headerRefs: { first: 'h2-first' } }],
      headerContentHeightsByRId: new Map([['h2-first', 100]]),
    };

    const layout = layoutDocument(
      [sb0, tallBlock('p1-sparse'), sb2, tallBlock('p2-sparse')],
      [{ kind: 'sectionBreak' }, tallMeasure, { kind: 'sectionBreak' }, tallMeasure],
      options,
    );

    expect(layout.pages[1].fragments.find((f) => f.blockId === 'p2-sparse')?.y).toBeCloseTo(130, 0);
  });

  it('resets to base margin when selected first variant is blank', () => {
    const options: LayoutOptions = {
      pageSize: { w: 600, h: 800 },
      margins: { top: 50, right: 50, bottom: 50, left: 50, header: 30 },
      sectionMetadata: [{ sectionIndex: 0, titlePg: true, headerRefs: { default: 'h-default' } }],
      headerContentHeightsByRId: new Map([['h-default', 100]]),
    };

    const layout = layoutDocument([tallBlock('p1')], [tallMeasure], options);

    expect(layout.pages[0].fragments.find((f) => f.blockId === 'p1')?.y).toBeCloseTo(50, 0);
    expect(layout.pages[0].margins?.top).toBeCloseTo(50, 0);
  });

  it('uses default variant height when odd selection is backed by a default ref', () => {
    const options: LayoutOptions = {
      pageSize: { w: 600, h: 800 },
      margins: { top: 50, right: 50, bottom: 50, left: 50, header: 30 },
      alternateHeaders: true,
      sectionMetadata: [{ sectionIndex: 0, headerRefs: { default: 'h-default' } }],
      headerContentHeights: {
        default: 60,
        odd: 140,
      },
    };

    const layout = layoutDocument([tallBlock('p1')], [tallMeasure], options);

    expect(layout.pages[0].fragments.find((f) => f.blockId === 'p1')?.y).toBeCloseTo(90, 0);
  });

  it('uses variant header heights when no section refs are available', () => {
    const options: LayoutOptions = {
      pageSize: { w: 600, h: 800 },
      margins: { top: 50, right: 50, bottom: 50, left: 50, header: 30 },
      headerContentHeights: {
        default: 100,
      },
    };

    const layout = layoutDocument([tallBlock('p1')], [tallMeasure], options);

    expect(layout.pages[0].fragments.find((f) => f.blockId === 'p1')?.y).toBeCloseTo(130, 0);
    expect(layout.pages[0].margins?.top).toBeCloseTo(130, 0);
  });

  it('prefers runtime section refs over stale metadata for margin heights', () => {
    const sb0: SectionBreakBlock = {
      kind: 'sectionBreak',
      id: 'sb0-runtime-refs',
      attrs: { isFirstSection: true, source: 'sectPr', sectionIndex: 0 },
      headerRefs: { default: 'h-runtime' },
      margins: {},
    };
    const options: LayoutOptions = {
      pageSize: { w: 600, h: 800 },
      margins: { top: 50, right: 50, bottom: 50, left: 50, header: 30 },
      sectionMetadata: [{ sectionIndex: 0, headerRefs: { default: 'h-metadata' } }],
      headerContentHeightsByRId: new Map([
        ['h-metadata', 20],
        ['h-runtime', 100],
      ]),
    };

    const layout = layoutDocument([sb0, tallBlock('p1')], [{ kind: 'sectionBreak' }, tallMeasure], options);

    expect(layout.pages[0].fragments.find((f) => f.blockId === 'p1')?.y).toBeCloseTo(130, 0);
    expect(layout.pages[0].margins?.top).toBeCloseTo(130, 0);
  });

  it('prefers section-aware header heights over the plain rId fallback', () => {
    const options: LayoutOptions = {
      pageSize: { w: 600, h: 800 },
      margins: { top: 50, right: 50, bottom: 50, left: 50, header: 30 },
      sectionMetadata: [{ sectionIndex: 0, headerRefs: { default: 'rIdSharedHeader' } }],
      headerContentHeightsByRId: new Map([['rIdSharedHeader', 40]]),
      headerContentHeightsBySectionRef: new Map([['rIdSharedHeader::s0', 100]]),
    };

    const layout = layoutDocument([tallBlock('p1')], [tallMeasure], options);

    expect(layout.pages).toHaveLength(1);

    const pageOneFragment = layout.pages[0].fragments.find((fragment) => fragment.blockId === 'p1');
    expect(pageOneFragment).toBeDefined();
    expect(pageOneFragment!.y).toBeCloseTo(130, 0);
    expect(layout.pages[0].margins?.top).toBeCloseTo(130, 0);
  });

  it('uses inherited first-page header height through intermediate sections that omit first refs', () => {
    const sb1: SectionBreakBlock = {
      kind: 'sectionBreak',
      id: 'sb1',
      attrs: { isFirstSection: true, source: 'sectPr', sectionIndex: 0 },
      pageSize: { w: 600, h: 800 },
      margins: { top: 50, right: 50, bottom: 50, left: 50, header: 30 },
    };
    const sb2: SectionBreakBlock = {
      kind: 'sectionBreak',
      id: 'sb2',
      type: 'nextPage',
      attrs: { source: 'sectPr', sectionIndex: 1 },
      pageSize: { w: 600, h: 800 },
      margins: { top: 50, right: 50, bottom: 50, left: 50, header: 30 },
    };
    const sb3: SectionBreakBlock = {
      kind: 'sectionBreak',
      id: 'sb3',
      type: 'nextPage',
      attrs: { source: 'sectPr', sectionIndex: 2 },
      pageSize: { w: 600, h: 800 },
      margins: { top: 50, right: 50, bottom: 50, left: 50, header: 30 },
    };
    const options: LayoutOptions = {
      pageSize: { w: 600, h: 800 },
      margins: { top: 50, right: 50, bottom: 50, left: 50, header: 30 },
      sectionMetadata: [
        { sectionIndex: 0, titlePg: true, headerRefs: { first: 'rIdS0First', default: 'rIdS0Default' } },
        { sectionIndex: 1, titlePg: true, headerRefs: { default: 'rIdS1Default' } },
        { sectionIndex: 2, titlePg: true, headerRefs: { default: 'rIdS2Default' } },
      ],
      headerContentHeightsByRId: new Map([
        ['rIdS0First', 100],
        ['rIdS2Default', 10],
      ]),
    };

    const layout = layoutDocument(
      [sb1, tallBlock('p1'), sb2, tallBlock('p2'), sb3, tallBlock('p3')],
      [
        { kind: 'sectionBreak' },
        tallMeasure,
        { kind: 'sectionBreak' },
        tallMeasure,
        { kind: 'sectionBreak' },
        tallMeasure,
      ],
      options,
    );

    expect(layout.pages.length).toBeGreaterThanOrEqual(3);

    const p3Fragment = layout.pages[2]?.fragments.find((fragment) => fragment.blockId === 'p3');
    expect(p3Fragment).toBeDefined();
    expect(p3Fragment!.y).toBeCloseTo(130, 0);
    expect(layout.pages[2]?.margins?.top).toBeCloseTo(130, 0);
  });

  it('multi-section + titlePg + alternateHeaders: first page of section 2 lands on an even doc-page', () => {
    // Most realistic mixed case. Section 1 has 3 pages (display numbers 1-3). Section 2
    // has titlePg=true and starts with display number 4.
    //   - Page 4 is sectionPageNumber=1 for section 2 + titlePg=true -> 'first'
    //   - Page 5 has display number 5 (odd) -> 'odd' (regardless of section-relative number)
    //   - Page 6 has display number 6 (even) -> 'even'
    // If the code used sectionPageNumber for even/odd, pages 5 and 6 would be
    // swapped (section-relative 2 and 3 respectively). This guards both titlePg
    // and the page-numbering parity rule across a section boundary.
    const sb1: SectionBreakBlock = {
      kind: 'sectionBreak',
      id: 'sb1',
      attrs: { isFirstSection: true, source: 'sectPr', sectionIndex: 0 },
      pageSize: { w: 600, h: 800 },
      margins: { top: 50, right: 50, bottom: 50, left: 50, header: 30 },
    };
    const sb2: SectionBreakBlock = {
      kind: 'sectionBreak',
      id: 'sb2',
      type: 'nextPage',
      attrs: { source: 'sectPr', sectionIndex: 1 },
      pageSize: { w: 600, h: 800 },
      margins: { top: 50, right: 50, bottom: 50, left: 50, header: 30 },
    };

    const options: LayoutOptions = {
      pageSize: { w: 600, h: 800 },
      margins: { top: 50, right: 50, bottom: 50, left: 50, header: 30 },
      alternateHeaders: true,
      sectionMetadata: [
        { sectionIndex: 0 },
        { sectionIndex: 1, titlePg: true, headerRefs: { first: 'h-first', odd: 'h-odd', even: 'h-even' } },
      ],
      headerContentHeights: {
        first: 100, // section 2 title-page header
        odd: 80,
        even: 40,
      },
    };

    const layout = layoutDocument(
      [sb1, tallBlock('p1'), tallBlock('p2'), tallBlock('p3'), sb2, tallBlock('p4'), tallBlock('p5'), tallBlock('p6')],
      [
        { kind: 'sectionBreak' },
        tallMeasure,
        tallMeasure,
        tallMeasure,
        { kind: 'sectionBreak' },
        tallMeasure,
        tallMeasure,
        tallMeasure,
      ],
      options,
    );

    expect(layout.pages.length).toBeGreaterThanOrEqual(6);

    // Page 4: section 2 first page + titlePg -> 'first' (100px) -> y = max(50, 30+100) = 130
    const p4Fragment = layout.pages[3]?.fragments.find((f) => f.blockId === 'p4');
    expect(p4Fragment).toBeDefined();
    expect(p4Fragment!.y).toBeCloseTo(130, 0);

    // Page 5: display number 5, odd -> 'odd' (80px) -> y = max(50, 30+80) = 110
    // If sectionPageNumber were used: sectionPN=2 -> 'even' (40) -> y = 70 (wrong)
    const p5Fragment = layout.pages[4]?.fragments.find((f) => f.blockId === 'p5');
    expect(p5Fragment).toBeDefined();
    expect(p5Fragment!.y).toBeCloseTo(110, 0);

    // Page 6: display number 6, even -> 'even' (40px) -> y = max(50, 30+40) = 70
    // If sectionPageNumber were used: sectionPN=3 -> 'odd' (80) -> y = 110 (wrong)
    const p6Fragment = layout.pages[5]?.fragments.find((f) => f.blockId === 'p6');
    expect(p6Fragment).toBeDefined();
    expect(p6Fragment!.y).toBeCloseTo(70, 0);
  });
});

// SD-2656: bodyMaxY anchors the footnote band painter at the actual bottom
// of body content. Without these tests the reviewer's multi-column trailing-
// spacing bug (advanceColumn resets trailingSpacing while preserving
// maxCursorY) regresses silently.
describe('bodyMaxY', () => {
  type PageWithBodyMaxY = { bodyMaxY?: number };

  it('subtracts trailing paragraph spacing on a single-column page', () => {
    const blocks: FlowBlock[] = [
      { kind: 'paragraph', id: 'p1', runs: [] },
      { kind: 'paragraph', id: 'p2', runs: [] },
      {
        kind: 'paragraph',
        id: 'p3',
        runs: [],
        attrs: { spacing: { after: 20 } },
      },
    ];
    const measures: Measure[] = [makeMeasure([24]), makeMeasure([24]), makeMeasure([24])];

    const layout = layoutDocument(blocks, measures, DEFAULT_OPTIONS);

    expect(layout.pages).toHaveLength(1);
    const bodyMaxY = (layout.pages[0] as PageWithBodyMaxY).bodyMaxY;
    expect(bodyMaxY).toBeDefined();
    // 3 paragraphs × 24 px + 50 px topMargin = 122. Trailing spacing.after=20
    // is "below the last line" so it is excluded from bodyMaxY.
    expect(bodyMaxY).toBeCloseTo(122, 1);
  });

  it('does not subtract trailing spacing when the last column does not own maxCursorY', () => {
    // Two-column page where column 0 is taller than column 1.
    // Column 0 should set maxCursorY high; column 1 finishes shorter and
    // carries a non-zero trailingSpacing. advanceColumn resets trailingSpacing
    // to 0 mid-flight but the state observed at end-of-page is column 1's.
    // bodyMaxY must reflect column 0's max, NOT subtract column 1's trailing.
    const measures: Measure[] = [makeMeasure([40, 40, 40, 40, 40]), makeMeasure([40])];

    const buildBlocks = (trailingAfter: number): FlowBlock[] => [
      { kind: 'paragraph', id: 'tall', runs: [] },
      {
        kind: 'paragraph',
        id: 'short',
        runs: [],
        attrs: trailingAfter > 0 ? { spacing: { after: trailingAfter } } : undefined,
      },
    ];

    const layoutOptions: LayoutOptions = {
      pageSize: { w: 600, h: 800 },
      margins: { top: 40, right: 40, bottom: 40, left: 40 },
      columns: { count: 2, gap: 20 },
    };

    const layoutWithSpacing = layoutDocument(buildBlocks(30), measures, layoutOptions);
    const layoutWithoutSpacing = layoutDocument(buildBlocks(0), measures, layoutOptions);

    expect(layoutWithSpacing.pages).toHaveLength(1);
    expect(layoutWithoutSpacing.pages).toHaveLength(1);
    // The presence of column-1 trailing spacing must NOT change bodyMaxY,
    // because the trailing spacing belongs to a column whose cursorY is
    // shorter than maxCursorY (set by column 0). Without the guard, the
    // bodyMaxY would shrink by ~30 px and the band painter would clip the
    // last line of column 0.
    const withSpacingBodyMaxY = (layoutWithSpacing.pages[0] as PageWithBodyMaxY).bodyMaxY;
    const withoutSpacingBodyMaxY = (layoutWithoutSpacing.pages[0] as PageWithBodyMaxY).bodyMaxY;
    expect(withSpacingBodyMaxY).toBeDefined();
    expect(withoutSpacingBodyMaxY).toBeDefined();
    expect(withSpacingBodyMaxY).toBeCloseTo(withoutSpacingBodyMaxY!, 1);
  });

  it('subtracts trailing spacing in a single-column page where last cursor == maxCursorY', () => {
    // Sanity: in a single-column page the last fragment also sets maxCursorY,
    // so the trailingAttachedToMax branch fires and we DO subtract.
    const blocks: FlowBlock[] = [
      {
        kind: 'paragraph',
        id: 'only',
        runs: [],
        attrs: { spacing: { after: 25 } },
      },
    ];
    const measures: Measure[] = [makeMeasure([30, 30])];

    const layout = layoutDocument(blocks, measures, DEFAULT_OPTIONS);
    const bodyMaxY = (layout.pages[0] as PageWithBodyMaxY).bodyMaxY;
    expect(bodyMaxY).toBeDefined();
    // topMargin=50, 60 px paragraph, trailing spacing.after=25 excluded → 110
    expect(bodyMaxY).toBeCloseTo(110, 1);
  });

  it('clamps bodyMaxY to topMargin when content is empty', () => {
    // Empty body: just an empty paragraph that produces no fragment height.
    const layout = layoutDocument([{ kind: 'paragraph', id: 'empty', runs: [] }], [makeMeasure([0])], DEFAULT_OPTIONS);
    expect(layout.pages.length).toBeGreaterThanOrEqual(1);
    const bodyMaxY = (layout.pages[0] as PageWithBodyMaxY).bodyMaxY;
    expect(bodyMaxY).toBeDefined();
    expect(bodyMaxY).toBeGreaterThanOrEqual(DEFAULT_OPTIONS.margins!.top);
  });

  it('skips the visible fragment for split line-break carriers while still laying out the anchored sibling', () => {
    const sharedSourceAnchor = {
      sourceRef: {
        partUri: '/word/document.xml',
        xpathLikePath: 'body/w:p[ordinal=7]',
      },
    };
    const blocks: FlowBlock[] = [
      {
        kind: 'paragraph',
        id: 'carrier',
        runs: [{ kind: 'lineBreak' }],
        sourceAnchor: sharedSourceAnchor,
      } as FlowBlock,
      {
        kind: 'drawing',
        id: 'line',
        drawingKind: 'vectorShape',
        geometry: { width: 200, height: 2 },
        anchor: {
          isAnchored: true,
          hRelativeFrom: 'column',
          vRelativeFrom: 'paragraph',
          offsetH: 0,
          offsetV: 0,
        },
        wrap: {
          type: 'Square',
          wrapText: 'bothSides',
          distTop: 0,
          distBottom: 0,
          distLeft: 0,
          distRight: 0,
        },
        sourceAnchor: {
          sourceRef: {
            partUri: '/word/document.xml',
            xpathLikePath: 'body/w:p[ordinal=7]/drawing[0]',
          },
        },
      } as FlowBlock,
      {
        kind: 'paragraph',
        id: 'text',
        runs: [{ text: 'Heading text', fontFamily: 'Arial', fontSize: 16 }],
        sourceAnchor: sharedSourceAnchor,
      } as FlowBlock,
    ];
    const measures: Measure[] = [
      { kind: 'paragraph', lines: [makeLine(14), makeLine(14)], totalHeight: 28 },
      {
        kind: 'drawing',
        drawingKind: 'vectorShape',
        width: 200,
        height: 2,
        scale: 1,
        naturalWidth: 200,
        naturalHeight: 2,
        geometry: { width: 200, height: 2, rotation: 0, flipH: false, flipV: false },
      } as DrawingMeasure,
      makeMeasure([20]),
    ];

    const layout = layoutDocument(blocks, measures, DEFAULT_OPTIONS);
    const page = layout.pages[0]!;

    expect(page.fragments.some((fragment) => fragment.blockId === 'carrier')).toBe(false);
    expect(page.fragments.some((fragment) => fragment.blockId === 'line')).toBe(true);
    expect(page.fragments.some((fragment) => fragment.blockId === 'text')).toBe(true);
  });

  it('keeps split line-break carriers visible when paragraph spacing contributes vertical layout', () => {
    const sharedSourceAnchor = {
      sourceRef: {
        partUri: '/word/document.xml',
        xpathLikePath: 'body/w:p[ordinal=7]',
      },
    };
    const blocks: FlowBlock[] = [
      {
        kind: 'paragraph',
        id: 'carrier',
        runs: [{ kind: 'lineBreak' }],
        attrs: { spacing: { before: 8, after: 24 } },
        sourceAnchor: sharedSourceAnchor,
      } as FlowBlock,
      {
        kind: 'drawing',
        id: 'line',
        drawingKind: 'vectorShape',
        geometry: { width: 200, height: 2 },
        anchor: {
          isAnchored: true,
          hRelativeFrom: 'column',
          vRelativeFrom: 'paragraph',
          offsetH: 0,
          offsetV: 0,
        },
        wrap: {
          type: 'Square',
          wrapText: 'bothSides',
          distTop: 0,
          distBottom: 0,
          distLeft: 0,
          distRight: 0,
        },
        sourceAnchor: {
          sourceRef: {
            partUri: '/word/document.xml',
            xpathLikePath: 'body/w:p[ordinal=7]/drawing[0]',
          },
        },
      } as FlowBlock,
      {
        kind: 'paragraph',
        id: 'text',
        runs: [{ text: 'Heading text', fontFamily: 'Arial', fontSize: 16 }],
        sourceAnchor: sharedSourceAnchor,
      } as FlowBlock,
    ];
    const measures: Measure[] = [
      makeMeasure([16]),
      {
        kind: 'drawing',
        drawingKind: 'vectorShape',
        width: 200,
        height: 2,
        scale: 1,
        naturalWidth: 200,
        naturalHeight: 2,
        geometry: { width: 200, height: 2, rotation: 0, flipH: false, flipV: false },
      } as DrawingMeasure,
      makeMeasure([20]),
    ];

    const layout = layoutDocument(blocks, measures, DEFAULT_OPTIONS);
    const page = layout.pages[0]!;
    const carrier = page.fragments.find((fragment) => fragment.blockId === 'carrier');
    const line = page.fragments.find((fragment) => fragment.blockId === 'line');
    const text = page.fragments.find((fragment) => fragment.blockId === 'text');

    expect(carrier).toBeDefined();
    expect(line).toBeDefined();
    expect(text).toBeDefined();
    expect(
      layout.pages.flatMap((page) => page.fragments).filter((fragment) => fragment.blockId === 'line'),
    ).toHaveLength(1);
    expect((line as DrawingFragment).y).toBeLessThan((text as ParaFragment).y);
    expect((text as ParaFragment).y).toBeGreaterThan((carrier as ParaFragment).y);
  });

  it('registers split-carrier sibling graphics as float exclusions before trailing paragraph layout', () => {
    const sharedSourceAnchor = {
      sourceRef: {
        partUri: '/word/document.xml',
        xpathLikePath: 'body/w:p[ordinal=7]',
      },
    };
    const carrierBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'carrier',
      runs: [{ kind: 'lineBreak' }],
      attrs: { spacing: { before: 8, after: 24 } },
      sourceAnchor: sharedSourceAnchor,
    } as FlowBlock;
    const drawingBlock: FlowBlock = {
      kind: 'drawing',
      id: 'floating-box',
      drawingKind: 'vectorShape',
      geometry: { width: 120, height: 80 },
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'column',
        vRelativeFrom: 'paragraph',
        offsetH: 0,
        offsetV: 0,
      },
      wrap: {
        type: 'Square',
        wrapText: 'bothSides',
        distTop: 0,
        distBottom: 0,
        distLeft: 0,
        distRight: 0,
      },
      attrs: { anchorParagraphId: 'text' },
      sourceAnchor: {
        sourceRef: {
          partUri: '/word/document.xml',
          xpathLikePath: 'body/w:p[ordinal=7]/drawing[0]',
        },
      },
    } as FlowBlock;
    const textBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'text',
      runs: [{ text: 'Wrapped trailing text', fontFamily: 'Arial', fontSize: 16 }],
      sourceAnchor: sharedSourceAnchor,
    } as FlowBlock;
    const blocks = [carrierBlock, drawingBlock, textBlock];
    const measures: Measure[] = [
      makeMeasure([16]),
      {
        kind: 'drawing',
        drawingKind: 'vectorShape',
        width: 120,
        height: 80,
        scale: 1,
        naturalWidth: 120,
        naturalHeight: 80,
        geometry: { width: 120, height: 80, rotation: 0, flipH: false, flipV: false },
      } as DrawingMeasure,
      makeMeasure([20]),
    ];
    const remeasureParagraph = mock((_block: FlowBlock, _maxWidth: number) => makeMeasure([20]));

    const layout = layoutDocument(blocks, measures, {
      ...DEFAULT_OPTIONS,
      remeasureParagraph,
    });

    const textRemeasure = remeasureParagraph.mock.calls.find(([block]) => (block as FlowBlock).id === 'text');
    expect(textRemeasure?.[1]).toBe(500);
    expect(textRemeasure?.[3]?.[0]).toEqual([{ offsetX: 120, width: 380 }]);
    expect(
      layout.pages.flatMap((page) => page.fragments).filter((fragment) => fragment.blockId === 'floating-box'),
    ).toHaveLength(1);
  });

  it('positions split-carrier sibling graphics from the carrier page after pagination advances', () => {
    const sharedSourceAnchor = {
      sourceRef: {
        partUri: '/word/document.xml',
        xpathLikePath: 'body/w:p[ordinal=9]',
      },
    };
    const blocks: FlowBlock[] = [
      {
        kind: 'paragraph',
        id: 'intro',
        runs: [{ text: 'Intro', fontFamily: 'Arial', fontSize: 16 }],
      } as FlowBlock,
      {
        kind: 'paragraph',
        id: 'carrier',
        runs: [{ kind: 'lineBreak' }],
        attrs: { spacing: { before: 8, after: 0 } },
        sourceAnchor: sharedSourceAnchor,
      } as FlowBlock,
      {
        kind: 'drawing',
        id: 'line',
        drawingKind: 'vectorShape',
        geometry: { width: 120, height: 2 },
        anchor: {
          isAnchored: true,
          hRelativeFrom: 'column',
          vRelativeFrom: 'paragraph',
          offsetH: 0,
          offsetV: 0,
        },
        attrs: { anchorParagraphId: 'text' },
        sourceAnchor: {
          sourceRef: {
            partUri: '/word/document.xml',
            xpathLikePath: 'body/w:p[ordinal=9]/drawing[0]',
          },
        },
      } as FlowBlock,
      {
        kind: 'paragraph',
        id: 'text',
        runs: [{ text: 'Trailing text', fontFamily: 'Arial', fontSize: 16 }],
        sourceAnchor: sharedSourceAnchor,
      } as FlowBlock,
    ];
    const measures: Measure[] = [
      makeMeasure([20]),
      makeMeasure([16]),
      {
        kind: 'drawing',
        drawingKind: 'vectorShape',
        width: 120,
        height: 2,
        scale: 1,
        naturalWidth: 120,
        naturalHeight: 2,
        geometry: { width: 120, height: 2, rotation: 0, flipH: false, flipV: false },
      } as DrawingMeasure,
      makeMeasure([20]),
    ];

    const layout = layoutDocument(blocks, measures, {
      pageSize: { w: 600, h: 120 },
      margins: { top: 50, right: 50, bottom: 50, left: 50 },
    });
    const carrierPage = layout.pages.find((page) => page.fragments.some((fragment) => fragment.blockId === 'carrier'));
    const linePage = layout.pages.find((page) => page.fragments.some((fragment) => fragment.blockId === 'line'));
    const carrier = carrierPage?.fragments.find((fragment) => fragment.blockId === 'carrier') as ParaFragment;
    const line = linePage?.fragments.find((fragment) => fragment.blockId === 'line') as DrawingFragment;

    expect(carrierPage?.number).toBe(2);
    expect(linePage?.number).toBe(2);
    expect(line.y).toBe(carrier.y);
  });

  it('defers carrier-mapped split-carrier sibling graphics until carrier pagination settles', () => {
    const sharedSourceAnchor = {
      sourceRef: {
        partUri: '/word/document.xml',
        xpathLikePath: 'body/w:p[ordinal=10]',
      },
    };
    const blocks: FlowBlock[] = [
      {
        kind: 'paragraph',
        id: 'intro',
        runs: [{ text: 'Intro', fontFamily: 'Arial', fontSize: 16 }],
      } as FlowBlock,
      {
        kind: 'paragraph',
        id: 'carrier',
        runs: [{ kind: 'lineBreak' }],
        attrs: { spacing: { before: 8, after: 0 } },
        sourceAnchor: sharedSourceAnchor,
      } as FlowBlock,
      {
        kind: 'drawing',
        id: 'line',
        drawingKind: 'vectorShape',
        geometry: { width: 120, height: 2 },
        anchor: {
          isAnchored: true,
          hRelativeFrom: 'column',
          vRelativeFrom: 'paragraph',
          offsetH: 0,
          offsetV: 0,
        },
        sourceAnchor: {
          sourceRef: {
            partUri: '/word/document.xml',
            xpathLikePath: 'body/w:p[ordinal=10]/drawing[0]',
          },
        },
      } as FlowBlock,
      {
        kind: 'paragraph',
        id: 'text',
        runs: [{ text: 'Trailing text', fontFamily: 'Arial', fontSize: 16 }],
        sourceAnchor: sharedSourceAnchor,
      } as FlowBlock,
    ];
    const measures: Measure[] = [
      makeMeasure([20]),
      makeMeasure([16]),
      {
        kind: 'drawing',
        drawingKind: 'vectorShape',
        width: 120,
        height: 2,
        scale: 1,
        naturalWidth: 120,
        naturalHeight: 2,
        geometry: { width: 120, height: 2, rotation: 0, flipH: false, flipV: false },
      } as DrawingMeasure,
      makeMeasure([20]),
    ];

    const layout = layoutDocument(blocks, measures, {
      pageSize: { w: 600, h: 120 },
      margins: { top: 50, right: 50, bottom: 50, left: 50 },
    });
    const carrierPage = layout.pages.find((page) => page.fragments.some((fragment) => fragment.blockId === 'carrier'));
    const linePage = layout.pages.find((page) => page.fragments.some((fragment) => fragment.blockId === 'line'));
    const carrier = carrierPage?.fragments.find((fragment) => fragment.blockId === 'carrier') as ParaFragment;
    const line = linePage?.fragments.find((fragment) => fragment.blockId === 'line') as DrawingFragment;

    expect(carrierPage?.number).toBe(2);
    expect(linePage?.number).toBe(2);
    expect(line.y).toBe(carrier.y);
  });

  it('keeps split-carrier sibling graphics on the carrier page when spacing after advances pagination', () => {
    const sharedSourceAnchor = {
      sourceRef: {
        partUri: '/word/document.xml',
        xpathLikePath: 'body/w:p[ordinal=11]',
      },
    };
    const blocks: FlowBlock[] = [
      {
        kind: 'paragraph',
        id: 'carrier',
        runs: [{ kind: 'lineBreak' }],
        attrs: { spacing: { before: 0, after: 40 } },
        sourceAnchor: sharedSourceAnchor,
      } as FlowBlock,
      {
        kind: 'drawing',
        id: 'line',
        drawingKind: 'vectorShape',
        geometry: { width: 120, height: 2 },
        anchor: {
          isAnchored: true,
          hRelativeFrom: 'column',
          vRelativeFrom: 'paragraph',
          offsetH: 0,
          offsetV: 0,
        },
        attrs: { anchorParagraphId: 'text' },
        sourceAnchor: {
          sourceRef: {
            partUri: '/word/document.xml',
            xpathLikePath: 'body/w:p[ordinal=11]/drawing[0]',
          },
        },
      } as FlowBlock,
      {
        kind: 'paragraph',
        id: 'text',
        runs: [{ text: 'Trailing text', fontFamily: 'Arial', fontSize: 16 }],
        sourceAnchor: sharedSourceAnchor,
      } as FlowBlock,
    ];
    const measures: Measure[] = [
      makeMeasure([16]),
      {
        kind: 'drawing',
        drawingKind: 'vectorShape',
        width: 120,
        height: 2,
        scale: 1,
        naturalWidth: 120,
        naturalHeight: 2,
        geometry: { width: 120, height: 2, rotation: 0, flipH: false, flipV: false },
      } as DrawingMeasure,
      makeMeasure([20]),
    ];

    const layout = layoutDocument(blocks, measures, {
      pageSize: { w: 600, h: 120 },
      margins: { top: 50, right: 50, bottom: 50, left: 50 },
    });
    const carrierPage = layout.pages.find((page) => page.fragments.some((fragment) => fragment.blockId === 'carrier'));
    const linePage = layout.pages.find((page) => page.fragments.some((fragment) => fragment.blockId === 'line'));
    const textPage = layout.pages.find((page) => page.fragments.some((fragment) => fragment.blockId === 'text'));
    const carrier = carrierPage?.fragments.find((fragment) => fragment.blockId === 'carrier') as ParaFragment;
    const line = linePage?.fragments.find((fragment) => fragment.blockId === 'line') as DrawingFragment;

    expect(carrierPage?.number).toBe(1);
    expect(linePage?.number).toBe(1);
    expect(textPage?.number).toBe(2);
    expect(line.y).toBe(carrier.y);
  });

  it('pins pre-registered split-carrier sibling graphics to the carrier page', () => {
    const sharedSourceAnchor = {
      sourceRef: {
        partUri: '/word/document.xml',
        xpathLikePath: 'body/w:p[ordinal=12]',
      },
    };
    const blocks: FlowBlock[] = [
      {
        kind: 'paragraph',
        id: 'carrier',
        runs: [{ kind: 'lineBreak' }],
        attrs: { spacing: { before: 0, after: 40 } },
        sourceAnchor: sharedSourceAnchor,
      } as FlowBlock,
      {
        kind: 'drawing',
        id: 'page-relative-line',
        drawingKind: 'vectorShape',
        geometry: { width: 120, height: 2 },
        anchor: {
          isAnchored: true,
          hRelativeFrom: 'page',
          vRelativeFrom: 'page',
          offsetH: 80,
          offsetV: 20,
        },
        attrs: { anchorParagraphId: 'text' },
        sourceAnchor: {
          sourceRef: {
            partUri: '/word/document.xml',
            xpathLikePath: 'body/w:p[ordinal=12]/drawing[0]',
          },
        },
      } as FlowBlock,
      {
        kind: 'paragraph',
        id: 'text',
        runs: [{ text: 'Trailing text', fontFamily: 'Arial', fontSize: 16 }],
        sourceAnchor: sharedSourceAnchor,
      } as FlowBlock,
    ];
    const measures: Measure[] = [
      makeMeasure([16]),
      {
        kind: 'drawing',
        drawingKind: 'vectorShape',
        width: 120,
        height: 2,
        scale: 1,
        naturalWidth: 120,
        naturalHeight: 2,
        geometry: { width: 120, height: 2, rotation: 0, flipH: false, flipV: false },
      } as DrawingMeasure,
      makeMeasure([20]),
    ];

    const layout = layoutDocument(blocks, measures, {
      pageSize: { w: 600, h: 120 },
      margins: { top: 50, right: 50, bottom: 50, left: 50 },
    });
    const carrierPage = layout.pages.find((page) => page.fragments.some((fragment) => fragment.blockId === 'carrier'));
    const linePage = layout.pages.find((page) =>
      page.fragments.some((fragment) => fragment.blockId === 'page-relative-line'),
    );
    const textPage = layout.pages.find((page) => page.fragments.some((fragment) => fragment.blockId === 'text'));
    const line = linePage?.fragments.find((fragment) => fragment.blockId === 'page-relative-line') as DrawingFragment;

    expect(carrierPage?.number).toBe(1);
    expect(linePage?.number).toBe(1);
    expect(textPage?.number).toBe(2);
    expect(line.y).toBe(20);
  });

  it('registers pre-registered split-carrier sibling graphics on the carrier page for trailing text wrap', () => {
    const sharedSourceAnchor = {
      sourceRef: {
        partUri: '/word/document.xml',
        xpathLikePath: 'body/w:p[ordinal=13]',
      },
    };
    const blocks: FlowBlock[] = [
      {
        kind: 'paragraph',
        id: 'intro',
        runs: [{ text: 'Intro', fontFamily: 'Arial', fontSize: 16 }],
      } as FlowBlock,
      {
        kind: 'paragraph',
        id: 'carrier',
        runs: [{ kind: 'lineBreak' }],
        attrs: { spacing: { before: 8, after: 0 } },
        sourceAnchor: sharedSourceAnchor,
      } as FlowBlock,
      {
        kind: 'drawing',
        id: 'page-relative-box',
        drawingKind: 'vectorShape',
        geometry: { width: 120, height: 80 },
        anchor: {
          isAnchored: true,
          hRelativeFrom: 'page',
          vRelativeFrom: 'page',
          offsetH: 50,
          offsetV: 50,
        },
        wrap: {
          type: 'Square',
          wrapText: 'right',
          distTop: 0,
          distBottom: 0,
          distLeft: 0,
          distRight: 10,
        },
        attrs: { anchorParagraphId: 'text' },
        sourceAnchor: {
          sourceRef: {
            partUri: '/word/document.xml',
            xpathLikePath: 'body/w:p[ordinal=13]/drawing[0]',
          },
        },
      } as FlowBlock,
      {
        kind: 'paragraph',
        id: 'text',
        runs: [{ text: 'Wrapped trailing text', fontFamily: 'Arial', fontSize: 16 }],
        sourceAnchor: sharedSourceAnchor,
      } as FlowBlock,
    ];
    const measures: Measure[] = [
      makeMeasure([95]),
      makeMeasure([16]),
      {
        kind: 'drawing',
        drawingKind: 'vectorShape',
        width: 120,
        height: 80,
        scale: 1,
        naturalWidth: 120,
        naturalHeight: 80,
        geometry: { width: 120, height: 80, rotation: 0, flipH: false, flipV: false },
      } as DrawingMeasure,
      makeMeasure([20]),
    ];
    const remeasureParagraph = mock((_block: FlowBlock, _maxWidth: number) => makeMeasure([20]));

    layoutDocument(blocks, measures, {
      pageSize: { w: 600, h: 200 },
      margins: { top: 50, right: 50, bottom: 50, left: 50 },
      remeasureParagraph,
    });

    const textRemeasure = remeasureParagraph.mock.calls.find(([block]) => (block as FlowBlock).id === 'text');
    expect(textRemeasure?.[1]).toBe(500);
    expect(textRemeasure?.[3]?.[0]).toEqual([{ offsetX: 130, width: 370 }]);
  });
});
