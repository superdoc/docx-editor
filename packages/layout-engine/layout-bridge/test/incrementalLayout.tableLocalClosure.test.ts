/**
 * Plan 12 — table-local layout closure at the incremental (m4) admission
 * tier. Plan 05 owns cell PROJECTION and the dependencyCheckpoint suite pins
 * documents that merely CONTAIN stable tables; what was unpinned is the
 * geometry closure when the TABLE ITSELF is the dirty block:
 *
 *  1. a cell text edit that keeps row geometry must stay bounded and
 *     cold-exact with the `tables` class admitted;
 *  2. a cell edit that GROWS its row (page-shifting geometry) must stay
 *     cold-exact — bounded splice if convergence can be proved, named
 *     fallback otherwise;
 *  3. a dirty table without the `tables` class admitted must fail closed to
 *     a named full result with cold-exact output.
 */
import { beforeEach, describe, expect, it } from 'vite-plus/test';
import type {
  FlowBlock,
  Layout,
  Line,
  Measure,
  Page,
  ParagraphBlock,
  ParagraphMeasure,
  TableBlock,
} from '@superdoc/contracts';
import { clearIncrementalModuleState, incrementalLayout, type IncrementalLayoutReuseOptions } from '../src/index.js';
import { computeDirtyRegions } from '../src/diff.js';
import { __test_only_lazyPageTransformStats } from '../src/incrementalLayout.js';

const OPTIONS = {
  pageSize: { w: 240, h: 140 },
  margins: { top: 10, right: 10, bottom: 10, left: 10 },
  columns: { count: 1, gap: 0 },
};
const CELL_LINE_HEIGHT = 12;
const TABLE_INDEX = 18;

function paragraph(id: string, text: string, pmStart: number): ParagraphBlock {
  return {
    kind: 'paragraph',
    id,
    runs: [{ kind: 'text', text, pmStart, pmEnd: pmStart + text.length }],
  };
}

/** Three single-cell rows; each cell holds one paragraph. */
function table(cellTexts: readonly string[], pmStart: number): TableBlock {
  return {
    kind: 'table',
    id: 'table-mid',
    rows: cellTexts.map((text, rowIndex) => ({
      id: `row-${rowIndex}`,
      cells: [
        {
          id: `cell-${rowIndex}`,
          blocks: [paragraph(`cellp-${rowIndex}`, text, pmStart + rowIndex * 20)],
          attrs: { padding: { top: 2, bottom: 2, left: 4, right: 4 } },
        },
      ],
    })),
  };
}

function documentBlocks(cellTexts: readonly string[]): FlowBlock[] {
  const blocks: FlowBlock[] = [];
  for (let index = 0; index < 36; index += 1) {
    if (index === TABLE_INDEX) blocks.push(table(cellTexts, 1 + index * 20));
    blocks.push(paragraph(`p${index}`, `text-${index}`, 1 + (index + (index >= TABLE_INDEX ? 3 : 0)) * 20));
  }
  return blocks;
}

function largeTableDocument(rowCount: number, growingRow: number | null = null): FlowBlock[] {
  const cellTexts = Array.from({ length: rowCount }, (_, rowIndex) =>
    rowIndex === growingRow ? '12345678' : `r${rowIndex}`.padEnd(7, '-'),
  );
  return [
    paragraph('before-table', 'before', 1),
    table(cellTexts, 100),
    paragraph('after-table', 'after', 100 + rowCount * 20),
  ];
}

/** Cell paragraphs wrap to one line per 8 characters; body paragraphs are one 30px line. */
function cellLineCount(text: string): number {
  return Math.max(1, Math.ceil(text.length / 8));
}

function paragraphMeasure(block: ParagraphBlock): ParagraphMeasure {
  const textLength = block.runs.reduce((length, run) => length + ('text' in run ? run.text.length : 0), 0);
  const line: Line = {
    fromRun: 0,
    fromChar: 0,
    toRun: 0,
    toChar: textLength,
    width: 100,
    ascent: 22,
    descent: 8,
    lineHeight: 30,
  };
  return { kind: 'paragraph', lines: [line], totalHeight: 30 };
}

async function measureBlock(block: FlowBlock): Promise<Measure> {
  if (block.kind === 'paragraph') return paragraphMeasure(block);
  if (block.kind !== 'table') throw new Error(`Unexpected block kind ${block.kind}`);
  return {
    kind: 'table',
    rows: block.rows.map((row) => {
      const cellParagraph = row.cells[0]!.blocks![0]!;
      if (cellParagraph.kind !== 'paragraph') throw new Error('Expected cell paragraph');
      const text = cellParagraph.runs[0]!.text;
      const lineCount = cellLineCount(text);
      const lines: Line[] = Array.from({ length: lineCount }, (_, lineIndex) => ({
        fromRun: 0,
        fromChar: Math.floor((text.length * lineIndex) / lineCount),
        toRun: 0,
        toChar: Math.floor((text.length * (lineIndex + 1)) / lineCount),
        width: 100,
        ascent: 9,
        descent: 3,
        lineHeight: CELL_LINE_HEIGHT,
      }));
      const height = lineCount * CELL_LINE_HEIGHT + 4;
      return {
        height,
        cells: [
          {
            width: 120,
            height,
            gridColumnStart: 0,
            blocks: [{ kind: 'paragraph' as const, lines, totalHeight: lineCount * CELL_LINE_HEIGHT }],
          },
        ],
      };
    }),
    columnWidths: [120],
    totalWidth: 120,
    totalHeight: block.rows.reduce((sum, row) => {
      const cellParagraph = row.cells[0]!.blocks![0]!;
      const text = cellParagraph.kind === 'paragraph' ? cellParagraph.runs[0]!.text : '';
      return sum + cellLineCount(text) * CELL_LINE_HEIGHT + 4;
    }, 0),
  };
}

async function measureFixedHeightTableBlock(block: FlowBlock): Promise<Measure> {
  if (block.kind !== 'table') return measureBlock(block);
  return {
    kind: 'table',
    rows: block.rows.map((row) => {
      const cellParagraph = row.cells[0]!.blocks![0]!;
      if (cellParagraph.kind !== 'paragraph') throw new Error('Expected cell paragraph');
      const textLength = cellParagraph.runs[0]!.text.length;
      const line: Line = {
        fromRun: 0,
        fromChar: 0,
        toRun: 0,
        toChar: textLength,
        width: 100,
        ascent: 9,
        descent: 3,
        lineHeight: CELL_LINE_HEIGHT,
      };
      return {
        height: CELL_LINE_HEIGHT + 4,
        cells: [
          {
            width: 120,
            height: CELL_LINE_HEIGHT + 4,
            gridColumnStart: 0,
            blocks: [{ kind: 'paragraph' as const, lines: [line], totalHeight: CELL_LINE_HEIGHT }],
          },
        ],
      };
    }),
    columnWidths: [120],
    totalWidth: 120,
    totalHeight: block.rows.length * (CELL_LINE_HEIGHT + 4),
  };
}

function pageStartKey(page: Page): string {
  const first = page.fragments[0];
  const sectionIndex = page.sectionIndex ?? 0;
  if (!first) return `#empty#0#${sectionIndex}#0`;
  const from = 'fromLine' in first ? first.fromLine : 'fromRow' in first ? first.fromRow : 0;
  const carry = 'continuesFromPrev' in first && first.continuesFromPrev === true ? 1 : 0;
  return `${first.blockId}#${from ?? 0}#${sectionIndex}#${carry}`;
}

function blockPageIndex(layout: Layout): Map<string, { firstPage: number; lastPage: number }> {
  const index = new Map<string, { firstPage: number; lastPage: number }>();
  layout.pages.forEach((page, pageIndex) => {
    for (const fragment of page.fragments) {
      const previous = index.get(fragment.blockId);
      if (previous) previous.lastPage = pageIndex;
      else index.set(fragment.blockId, { firstPage: pageIndex, lastPage: pageIndex });
    }
  });
  return index;
}

function buildTableReuse(
  previousBlocks: FlowBlock[],
  nextBlocks: FlowBlock[],
  previousLayout: Layout,
  editPmEnd: number,
  admitTables: boolean,
): IncrementalLayoutReuseOptions {
  const previousPageStartKeys = previousLayout.pages.map(pageStartKey);
  const previousPageStartKeyIndex = new Map<string, number[]>();
  previousPageStartKeys.forEach((key, index) => {
    previousPageStartKeyIndex.set(key, [...(previousPageStartKeyIndex.get(key) ?? []), index]);
  });
  const provedDirtyRegion = computeDirtyRegions(previousBlocks, nextBlocks);
  return {
    previousLayout,
    retainedMetadataSourceLayoutEpoch: previousLayout.layoutEpoch ?? null,
    previousPageStartKeys,
    previousPageStartKeyIndex,
    previousBlockPageIndex: blockPageIndex(previousLayout),
    currentBlockIndexById: new Map(nextBlocks.map((block, index) => [block.id, index])),
    maxRelaidPages: 3,
    requireDocumentStartCheckpoint: false,
    dirtyBlockIds: provedDirtyRegion.changedBlockIds,
    pmShift: { atChar: editPmEnd, delta: 1 },
    provedDirtyRegion,
    dependencyProof: {
      profile: 'page-checkpoint-local-text',
      blockIdsUnchanged: true,
      blockIdsUnique: true,
      globalDependenciesAbsent: false,
      globalDependenciesFencedByPageCheckpoint: true,
      admittedDependencyClasses: admitTables ? ['tables'] : ['body-anchored-objects'],
      renderInputsUnchanged: true,
      pageReferencesAbsent: true,
      multiColumnSectionsProvedNonBalanceable: true,
    },
  } as IncrementalLayoutReuseOptions;
}

function json(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

/** Append one character to a cell paragraph, shifting later pm positions. */
function applyCellEdit(blocks: FlowBlock[], rowIndex: number): { next: FlowBlock[]; editPmEnd: number } {
  let editPmEnd = 0;
  const next = blocks.map((block) => {
    if (block.kind === 'paragraph') {
      const run = block.runs[0]!;
      return editPmEnd > 0 && run.pmStart! > editPmEnd ? paragraph(block.id, run.text, run.pmStart! + 1) : block;
    }
    if (block.kind !== 'table') return block;
    return {
      ...block,
      rows: block.rows.map((row, index) => {
        const cell = row.cells[0]!;
        const cellParagraph = cell.blocks![0]!;
        if (cellParagraph.kind !== 'paragraph') return row;
        const run = cellParagraph.runs[0]!;
        if (index === rowIndex) {
          editPmEnd = run.pmEnd!;
          return {
            ...row,
            cells: [{ ...cell, blocks: [paragraph(cellParagraph.id, `${run.text}!`, run.pmStart!)] }],
          };
        }
        if (editPmEnd > 0 && run.pmStart! > editPmEnd) {
          return {
            ...row,
            cells: [{ ...cell, blocks: [paragraph(cellParagraph.id, run.text, run.pmStart! + 1)] }],
          };
        }
        return row;
      }),
    };
  });
  return { next, editPmEnd };
}

describe('incrementalLayout table-local closure (plan 12)', () => {
  beforeEach(() => clearIncrementalModuleState());

  it.each([false, true])(
    'offers the aligned retained table only with unchanged fonts (changed=%s)',
    async (fontChanged) => {
      const previousBlocks = documentBlocks(['cell-r0', 'cell-r1', 'cell-r2']);
      const previous = await incrementalLayout([], null, previousBlocks, OPTIONS, measureBlock);
      previous.layout.layoutEpoch = 1;
      const { next: nextBlocks, editPmEnd } = applyCellEdit(previousBlocks, 1);
      const reuse = buildTableReuse(previousBlocks, nextBlocks, previous.layout, editPmEnd, true);
      reuse.previousBlockIndexById = new Map(previousBlocks.map((block, index) => [block.id, index]));
      reuse.provedDirtyMeasureConstraints = new Map([['table-mid', { maxWidth: 220, maxHeight: 120 }]]);
      let retained: unknown;

      const result = await incrementalLayout(
        previousBlocks,
        previous.layout,
        nextBlocks,
        OPTIONS,
        (block, constraints) => {
          if (block.kind === 'table') retained = Reflect.get(constraints, 'retainedTable');
          return measureBlock(block);
        },
        undefined,
        previous.measures,
        {
          fontContext: { fontSignature: fontChanged ? 'next' : 'previous', resolvePhysical: (family) => family },
          previousFontSignature: 'previous',
        },
        undefined,
        reuse,
      );

      if (fontChanged) {
        expect(retained).toBeUndefined();
      } else {
        expect(result.measureReuse?.mode).toBe('proved-dirty-only');
        expect(retained).toEqual({ block: previousBlocks[TABLE_INDEX], measure: previous.measures[TABLE_INDEX] });
        expect(Reflect.get(retained as object, 'block')).toBe(previousBlocks[TABLE_INDEX]);
        expect(Reflect.get(retained as object, 'measure')).toBe(previous.measures[TABLE_INDEX]);
      }
    },
  );

  it('keeps a same-geometry cell edit bounded and cold-exact with the tables class admitted', async () => {
    // 7-char base text stays one wrapped line after the '!' append (8 chars).
    const previousBlocks = documentBlocks(['cell-r0', 'cell-r1', 'cell-r2']);
    const previous = await incrementalLayout([], null, previousBlocks, OPTIONS, measureBlock);
    previous.layout.layoutEpoch = 1;

    const { next: nextBlocks, editPmEnd } = applyCellEdit(previousBlocks, 1);
    const incremental = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      OPTIONS,
      measureBlock,
      undefined,
      previous.measures,
      undefined,
      undefined,
      buildTableReuse(previousBlocks, nextBlocks, previous.layout, editPmEnd, true),
    );

    clearIncrementalModuleState();
    const cold = await incrementalLayout([], null, nextBlocks, OPTIONS, measureBlock);
    expect(json(incremental.layout)).toEqual(json(cold.layout));
    expect(incremental.layoutReuse).toMatchObject({
      mode: 'tail-splice',
      reason: 'm4-affected-frontier-converged-tail-adopted',
    });
    expect(incremental.layoutReuse.pagesPaginated!).toBeLessThanOrEqual(6);
  });

  it('keeps a row-growing cell edit cold-exact (page-shifting geometry included)', async () => {
    // 8-char base text wraps to a SECOND line after the '!' append: the row
    // grows by one cell line and every later page boundary shifts.
    const previousBlocks = documentBlocks(['cell-r0', 'cellrow1', 'cell-r2']);
    const previous = await incrementalLayout([], null, previousBlocks, OPTIONS, measureBlock);
    previous.layout.layoutEpoch = 1;

    const { next: nextBlocks, editPmEnd } = applyCellEdit(previousBlocks, 1);
    const incremental = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      OPTIONS,
      measureBlock,
      undefined,
      previous.measures,
      undefined,
      undefined,
      buildTableReuse(previousBlocks, nextBlocks, previous.layout, editPmEnd, true),
    );

    clearIncrementalModuleState();
    const cold = await incrementalLayout([], null, nextBlocks, OPTIONS, measureBlock);
    expect(json(incremental.layout)).toEqual(json(cold.layout));
    expect(incremental.layoutReuse).toMatchObject({
      mode: 'tail-splice',
      reason: 'm4-affected-frontier-converged-tail-adopted',
    });
    expect(incremental.layoutReuse.pagesPaginated!).toBeLessThanOrEqual(6);
  });

  it('resumes a deep same-geometry edit at its 95-row table fragment', async () => {
    const previousBlocks = largeTableDocument(95);
    const previous = await incrementalLayout([], null, previousBlocks, OPTIONS, measureBlock);
    previous.layout.layoutEpoch = 1;
    const retainedTablePages = blockPageIndex(previous.layout).get('table-mid')!;

    const { next: nextBlocks, editPmEnd } = applyCellEdit(previousBlocks, 80);
    const incremental = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      OPTIONS,
      measureBlock,
      undefined,
      previous.measures,
      undefined,
      undefined,
      buildTableReuse(previousBlocks, nextBlocks, previous.layout, editPmEnd, true),
    );

    clearIncrementalModuleState();
    const cold = await incrementalLayout([], null, nextBlocks, OPTIONS, measureBlock);
    expect(json(incremental.layout)).toEqual(json(cold.layout));
    expect(incremental.layoutReuse.mode).toBe('tail-splice');
    expect(incremental.layoutReuse.checkpointPageIndex!).toBeGreaterThan(retainedTablePages.firstPage + 8);
    expect(incremental.layoutReuse.sourceAffectedFrontierPageIndex).toBe(incremental.layoutReuse.checkpointPageIndex);
    expect(incremental.layoutReuse.pagesPaginated!).toBeLessThan(
      retainedTablePages.lastPage - retainedTablePages.firstPage + 1,
    );
  });

  it('keeps sustained same-cell position rebases in a persistent ledger', async () => {
    let blocks = largeTableDocument(95);
    let current = await incrementalLayout([], null, blocks, OPTIONS, measureFixedHeightTableBlock);

    for (let editIndex = 0; editIndex < 64; editIndex += 1) {
      current.layout.layoutEpoch = editIndex + 1;
      const { next, editPmEnd } = applyCellEdit(blocks, 80);
      const nextLayout = await incrementalLayout(
        blocks,
        current.layout,
        next,
        OPTIONS,
        measureFixedHeightTableBlock,
        undefined,
        current.measures,
        undefined,
        undefined,
        buildTableReuse(blocks, next, current.layout, editPmEnd, true),
      );
      expect(nextLayout.layoutReuse.mode).toBe('tail-splice');
      expect(nextLayout.layoutReuse.pagesPaginated!).toBeLessThanOrEqual(6);
      blocks = next;
      current = nextLayout;
    }

    const transformStats = __test_only_lazyPageTransformStats(current.layout.pages);
    expect(transformStats?.maximumLedgerCount).toBe(64);
    expect(transformStats?.maximumTreeDepth).toBeLessThanOrEqual(32);
    clearIncrementalModuleState();
    const cold = await incrementalLayout([], null, blocks, OPTIONS, measureFixedHeightTableBlock);
    expect(json(current.layout)).toEqual(json(cold.layout));
  });

  it('resumes a deep row-growing edit at its table fragment instead of the table start', async () => {
    const previousBlocks = largeTableDocument(95, 80);
    const previous = await incrementalLayout([], null, previousBlocks, OPTIONS, measureBlock);
    previous.layout.layoutEpoch = 1;
    const retainedTablePages = blockPageIndex(previous.layout).get('table-mid')!;

    const { next: nextBlocks, editPmEnd } = applyCellEdit(previousBlocks, 80);
    const incremental = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      OPTIONS,
      measureBlock,
      undefined,
      previous.measures,
      undefined,
      undefined,
      buildTableReuse(previousBlocks, nextBlocks, previous.layout, editPmEnd, true),
    );

    clearIncrementalModuleState();
    const cold = await incrementalLayout([], null, nextBlocks, OPTIONS, measureBlock);
    expect(json(incremental.layout)).toEqual(json(cold.layout));
    expect(incremental.layoutReuse.mode).toBe('tail-splice');
    expect(incremental.layoutReuse.checkpointPageIndex!).toBeGreaterThan(retainedTablePages.firstPage + 8);
    expect(incremental.layoutReuse.sourceAffectedFrontierPageIndex).toBe(incremental.layoutReuse.checkpointPageIndex);
    expect(incremental.layoutReuse.pagesPaginated!).toBeLessThan(retainedTablePages.lastPage + 1);
  });

  it('stays typed and cold-exact when the proof omits the tables class for a dirty table', async () => {
    const previousBlocks = documentBlocks(['cell-r0', 'cell-r1', 'cell-r2']);
    const previous = await incrementalLayout([], null, previousBlocks, OPTIONS, measureBlock);
    previous.layout.layoutEpoch = 1;

    const { next: nextBlocks, editPmEnd } = applyCellEdit(previousBlocks, 1);
    const incremental = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      OPTIONS,
      measureBlock,
      undefined,
      previous.measures,
      undefined,
      undefined,
      buildTableReuse(previousBlocks, nextBlocks, previous.layout, editPmEnd, false),
    );

    clearIncrementalModuleState();
    const cold = await incrementalLayout([], null, nextBlocks, OPTIONS, measureBlock);
    expect(json(incremental.layout)).toEqual(json(cold.layout));
    expect(incremental.layoutReuse).toEqual(
      expect.objectContaining({
        mode: 'full',
        reason: 'm4-layout-reuse-disabled-table-dependency-class-missing',
      }),
    );
  });
});
