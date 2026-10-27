import { describe, expect, it } from 'vite-plus/test';
import type { BlockId, ParagraphBlock, TableBlock, TableFragment, TableMeasure } from '@superdoc/contracts';
import { completeRenderWork } from '../render-work.js';
import { renderTextRun } from '../runs/text-run.js';
import type { RunRenderContext } from '../runs/types.js';
import type { FragmentRenderContext } from '../renderer.js';
import {
  applyTableFragmentPatchWork,
  planTableFragmentPatch,
  readTablePaintLedger,
  renderTableFragment,
  type TableFragmentPatchInput,
  type TableRenderDependencies,
} from './renderTableFragment.js';

const ROWS = 3;
const COLUMNS = 2;
const CELL_WIDTH = 100;
const ROW_HEIGHT = 20;

type Grid = { table: TableBlock; measure: TableMeasure; source?: TableBlock };

/** Host resolver: a painted (pm-rebased) table reads cell identity from its source table. */
function sourceIdentity(...grids: Grid[]) {
  const sources = new WeakMap<TableBlock, TableBlock>(
    grids.map((candidate) => [candidate.table, candidate.source ?? candidate.table]),
  );
  return (block: TableBlock, row: number, column: number) =>
    (sources.get(block) ?? block).rows[row]?.cells[column] ?? null;
}

function paragraph(row: number, column: number, text: string, pmStart: number): ParagraphBlock {
  return Object.freeze({
    kind: 'paragraph',
    id: `p-${row}-${column}` as BlockId,
    runs: Object.freeze([
      Object.freeze({ kind: 'text', text, fontFamily: 'Arial', fontSize: 12, pmStart, pmEnd: pmStart + text.length }),
    ]),
  }) as unknown as ParagraphBlock;
}

function cellText(row: number, column: number): string {
  return `r${row}c${column}`;
}

/** Row-major pm layout: each cell's text occupies its own span, one gap between cells. */
function pmStartFor(row: number, column: number, texts: (r: number, c: number) => string): number {
  let position = 0;
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLUMNS; c += 1) {
      if (r === row && c === column) return position;
      position += texts(r, c).length + 1;
    }
  }
  return position;
}

function grid(texts: (r: number, c: number) => string = cellText): Grid {
  const rows = Array.from({ length: ROWS }, (_, row) =>
    Object.freeze({
      id: `row-${row}` as BlockId,
      cells: Object.freeze(
        Array.from({ length: COLUMNS }, (_, column) =>
          Object.freeze({
            id: `cell-${row}-${column}` as BlockId,
            attrs: Object.freeze({ borders: Object.freeze({ top: { style: 'single', width: 1, color: '#000000' } }) }),
            blocks: Object.freeze([paragraph(row, column, texts(row, column), pmStartFor(row, column, texts))]),
          }),
        ),
      ),
    }),
  );
  const table = Object.freeze({
    kind: 'table',
    id: 'table' as BlockId,
    attrs: Object.freeze({ borders: Object.freeze({ insideH: { style: 'single', width: 1, color: '#000000' } }) }),
    columnWidths: Object.freeze([CELL_WIDTH, CELL_WIDTH]),
    rows: Object.freeze(rows),
  }) as unknown as TableBlock;
  const measure: TableMeasure = {
    kind: 'table',
    columnWidths: [CELL_WIDTH, CELL_WIDTH],
    totalWidth: CELL_WIDTH * COLUMNS,
    totalHeight: ROW_HEIGHT * ROWS,
    rows: rows.map((row) => ({
      height: ROW_HEIGHT,
      cells: row.cells.map((cell, column) => ({
        width: CELL_WIDTH,
        height: ROW_HEIGHT,
        gridColumnStart: column,
        colSpan: 1,
        blocks: [
          {
            kind: 'paragraph',
            totalHeight: 10,
            lines: [
              {
                fromRun: 0,
                fromChar: 0,
                toRun: 0,
                toChar: texts(0, 0).length,
                width: 40,
                ascent: 8,
                descent: 2,
                lineHeight: 10,
              },
            ],
          },
        ],
      })),
    })),
  };
  return { table, measure };
}

/**
 * The same grid after one cell edit, the way the host paints it: the painted
 * table carries fresh pm on every cell after the edit (clones), while its
 * source table keeps the previous cell objects for every unchanged cell.
 */
function editedGrid(previous: Grid, row: number, column: number, text: string): Grid {
  const texts = (r: number, c: number) => (r === row && c === column ? text : cellText(r, c));
  const fresh = grid(texts);
  const previousSource = previous.source ?? previous.table;
  const sourceRows = fresh.table.rows.map((freshRow, r) =>
    Object.freeze({
      ...freshRow,
      cells: Object.freeze(
        freshRow.cells.map((freshCell, c) =>
          r === row && c === column ? freshCell : previousSource.rows[r]!.cells[c]!,
        ),
      ),
    }),
  );
  const source = Object.freeze({ ...fresh.table, rows: Object.freeze(sourceRows) }) as unknown as TableBlock;
  const rows = fresh.table.rows.map((freshRow, r) =>
    Object.freeze({
      ...freshRow,
      cells: Object.freeze(
        freshRow.cells.map((freshCell, c) => {
          if (r === row && c === column) return freshCell;
          // Cells before the edit keep their painted objects; later cells are pm-rebased clones.
          return pmStartFor(r, c, texts) === pmStartFor(r, c, cellText) ? previous.table.rows[r]!.cells[c]! : freshCell;
        }),
      ),
    }),
  );
  const table = Object.freeze({ ...fresh.table, rows: Object.freeze(rows) }) as unknown as TableBlock;
  const measure: TableMeasure = {
    ...fresh.measure,
    rows: fresh.measure.rows.map((freshRow, r) => ({
      ...freshRow,
      cells: freshRow.cells.map((freshCell, c) =>
        r === row && c === column ? freshCell : previous.measure.rows[r]!.cells[c]!,
      ),
    })),
  };
  return { table, measure, source };
}

function fragment(overrides: Partial<TableFragment> = {}): TableFragment {
  return {
    kind: 'table',
    blockId: 'table' as BlockId,
    fromRow: 0,
    toRow: ROWS,
    x: 10,
    y: 20,
    width: CELL_WIDTH * COLUMNS,
    height: ROW_HEIGHT * ROWS,
    pmStart: 0,
    pmEnd: 60,
    metadata: {
      coordinateSystem: 'fragment',
      columnBoundaries: [
        { index: 0, x: 0, width: CELL_WIDTH, minWidth: 10, resizable: true },
        { index: 1, x: CELL_WIDTH, width: CELL_WIDTH, minWidth: 10, resizable: true },
      ],
      rowBoundaries: Array.from({ length: ROWS }, (_, index) => ({
        index,
        y: index * ROW_HEIGHT,
        height: ROW_HEIGHT,
        minHeight: 5,
        resizable: true,
      })),
    },
    ...overrides,
  };
}

const context: FragmentRenderContext = { pageNumber: 1, totalPages: 2, section: 'body', pageIndex: 0 };

function deps(
  doc: Document,
  { table, measure }: Grid,
  overrides: Partial<TableRenderDependencies> = {},
): TableRenderDependencies {
  return {
    doc,
    fragment: fragment(),
    context,
    block: table,
    measure,
    cellSpacingPx: 0,
    effectiveColumnWidths: measure.columnWidths,
    renderLine: (block) => {
      const run = block.runs[0] as { text?: string; pmStart?: number; pmEnd?: number } | undefined;
      const line = doc.createElement('div');
      line.textContent = run?.text ?? '';
      if (run?.pmStart != null) line.dataset.pmStart = String(run.pmStart);
      if (run?.pmEnd != null) line.dataset.pmEnd = String(run.pmEnd);
      return line;
    },
    applyFragmentFrame: (el, frag) => {
      el.style.left = `${frag.x}px`;
      el.style.top = `${frag.y}px`;
    },
    applySdtDataset: () => {},
    applyStyles: (el, styles) => Object.assign(el.style, styles),
    ...overrides,
  };
}

function patchInput(
  doc: Document,
  container: HTMLElement,
  next: Grid,
  overrides: Partial<TableFragmentPatchInput> = {},
): TableFragmentPatchInput {
  return { ...deps(doc, next), container, ...overrides };
}

function cellElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.children) as HTMLElement[];
}

describe('in-place table fragment patching', () => {
  const doc = document.implementation.createHTMLDocument('table-patch');

  it('repaints only the edited cell and equals a fresh render of the new table', () => {
    const previous = grid();
    const container = renderTableFragment(deps(doc, previous));
    const before = cellElements(container);
    expect(before).toHaveLength(ROWS * COLUMNS);
    const next = editedGrid(previous, 1, 0, 'edited text');
    const plan = planTableFragmentPatch(
      patchInput(doc, container, next, { cellSourceIdentity: sourceIdentity(previous, next) }),
    );
    expect(plan).not.toBeNull();
    expect(plan!.cellsChanged).toBe(1);
    expect(plan!.reused).toHaveLength(ROWS * COLUMNS - 1);
    // Cells before the edit are untouched; cells after it move by the edit delta.
    const delta = 'edited text'.length - cellText(1, 0).length;
    expect(plan!.reused.map((entry) => entry.pmDelta)).toEqual([0, 0, delta, delta, delta]);

    const result = completeRenderWork(applyTableFragmentPatchWork(plan!));
    expect(result).toEqual({ cellsRendered: 1, cellsReused: ROWS * COLUMNS - 1 });
    const after = cellElements(container);
    expect(after).toHaveLength(ROWS * COLUMNS);
    after.forEach((element, index) => {
      if (index === 2) expect(element).not.toBe(before[index]);
      else expect(element).toBe(before[index]);
    });
    const oracle = renderTableFragment(deps(doc, next));
    expect(container.outerHTML).toBe(oracle.outerHTML);
    expect(readTablePaintLedger(container)?.block).toBe(next.table);
  });

  it('reads cell identity through the host resolver when paint blocks are clones', () => {
    const previous = grid();
    const container = renderTableFragment(deps(doc, previous));
    const next = editedGrid(previous, 2, 1, 'z');
    // Every painted cell is a fresh clone; only the resolver knows which source cell it came from.
    const clone = (source: Grid): Grid => ({
      ...source,
      table: {
        ...source.table,
        rows: source.table.rows.map((row) => ({ ...row, cells: row.cells.map((cell) => ({ ...cell })) })),
      },
    });
    const previousClone = { ...clone(previous), source: previous.table };
    const nextClone = { ...clone(next), source: next.source };
    const paintedContainer = renderTableFragment(deps(doc, previousClone));
    expect(planTableFragmentPatch(patchInput(doc, paintedContainer, nextClone))!.cellsChanged).toBe(ROWS * COLUMNS);
    const plan = planTableFragmentPatch(
      patchInput(doc, paintedContainer, nextClone, { cellSourceIdentity: sourceIdentity(previousClone, nextClone) }),
    );
    expect(plan!.cellsChanged).toBe(1);
    completeRenderWork(applyTableFragmentPatchWork(plan!));
    expect(paintedContainer.outerHTML).toBe(renderTableFragment(deps(doc, nextClone)).outerHTML);
    expect(container.outerHTML).not.toBe(paintedContainer.outerHTML);
  });

  it('repaints a cell whose pm shift is not uniform', () => {
    const previous = grid();
    const container = renderTableFragment(deps(doc, previous));
    const next = editedGrid(previous, 0, 0, 'ab');
    const lastRow = next.table.rows[2]!;
    const skewed = {
      ...lastRow.cells[1]!,
      blocks: [{ ...(lastRow.cells[1]!.blocks![0] as ParagraphBlock), pmEnd: 999 }],
    };
    const table = {
      ...next.table,
      rows: [next.table.rows[0]!, next.table.rows[1]!, { ...lastRow, cells: [lastRow.cells[0]!, skewed] }],
    } as TableBlock;
    const skewedGrid: Grid = { table, measure: next.measure, source: next.source };
    const plan = planTableFragmentPatch(
      patchInput(doc, container, skewedGrid, { cellSourceIdentity: sourceIdentity(previous, skewedGrid) }),
    );
    expect(plan!.cellsChanged).toBe(2);
    completeRenderWork(applyTableFragmentPatchWork(plan!));
    expect(container.outerHTML).toBe(renderTableFragment(deps(doc, skewedGrid)).outerHTML);
  });

  it('patches a continuation fragment with repeated header rows', () => {
    const previous = grid();
    const continuation = fragment({
      fromRow: 1,
      toRow: ROWS,
      repeatHeaderCount: 1,
      continuesFromPrev: true,
      height: ROW_HEIGHT * ROWS,
    });
    const container = renderTableFragment(deps(doc, previous, { fragment: continuation }));
    const next = editedGrid(previous, 2, 0, 'tail edit');
    const plan = planTableFragmentPatch(
      patchInput(doc, container, next, { fragment: continuation, cellSourceIdentity: sourceIdentity(previous, next) }),
    );
    expect(plan!.rows.map((row) => row.role)).toEqual(['repeat-header', 'body', 'body']);
    expect(plan!.cellsChanged).toBe(1);
    completeRenderWork(applyTableFragmentPatchWork(plan!));
    expect(container.outerHTML).toBe(renderTableFragment(deps(doc, next, { fragment: continuation })).outerHTML);
  });

  it.each([
    [
      'a changed row height',
      (next: Grid) => ({
        ...next,
        measure: {
          ...next.measure,
          rows: next.measure.rows.map((row, index) => (index === 1 ? { ...row, height: 30 } : row)),
        },
      }),
    ],
    ['changed column widths', (next: Grid) => ({ ...next, measure: { ...next.measure, columnWidths: [120, 80] } })],
    [
      'changed table attrs',
      (next: Grid) => ({
        ...next,
        table: { ...next.table, attrs: { ...next.table.attrs, cellSpacing: 2 } } as TableBlock,
      }),
    ],
    [
      'changed attrs on the edited cell',
      (next: Grid) => {
        const row = next.table.rows[1]!;
        const cell = { ...row.cells[0]!, attrs: { borders: { top: { style: 'double', width: 2, color: '#ff0000' } } } };
        return {
          ...next,
          table: {
            ...next.table,
            rows: [next.table.rows[0]!, { ...row, cells: [cell, row.cells[1]!] }, next.table.rows[2]!],
          } as TableBlock,
        };
      },
    ],
    [
      'a vertically merged cell',
      (next: Grid) => ({
        ...next,
        measure: {
          ...next.measure,
          rows: next.measure.rows.map((row, index) =>
            index === 0 ? { ...row, cells: [{ ...row.cells[0]!, rowSpan: 2 }, row.cells[1]!] } : row,
          ),
        },
      }),
    ],
  ])('rebuilds instead of patching for %s', (_label, mutate) => {
    const previous = grid();
    const container = renderTableFragment(deps(doc, previous));
    const next = mutate(editedGrid(previous, 1, 0, 'edited'));
    expect(planTableFragmentPatch(patchInput(doc, container, next))).toBeNull();
  });

  it.each([
    ['a different row range', { fromRow: 1 }],
    ['a split row', { partialRow: { rowIndex: 2, partialHeight: 10, fromLineByCell: {}, toLineByCell: {} } }],
  ] as const)('rebuilds instead of patching for %s', (_label, overrides) => {
    const previous = grid();
    const container = renderTableFragment(deps(doc, previous));
    const next = editedGrid(previous, 1, 0, 'edited');
    expect(
      planTableFragmentPatch(
        patchInput(doc, container, next, { fragment: fragment(overrides as Partial<TableFragment>) }),
      ),
    ).toBeNull();
  });

  it('rebuilds instead of patching when the page context changed', () => {
    const previous = grid();
    const container = renderTableFragment(deps(doc, previous));
    const next = editedGrid(previous, 1, 0, 'edited');
    expect(
      planTableFragmentPatch(patchInput(doc, container, next, { context: { ...context, pageNumber: 2 } })),
    ).toBeNull();
  });

  it('treats pm-rebased clones as changed cells without a host identity resolver', () => {
    const previous = grid();
    const container = renderTableFragment(deps(doc, previous));
    const next = editedGrid(previous, 1, 0, 'edited text');
    const plan = planTableFragmentPatch(patchInput(doc, container, next));
    // The edited cell plus every later clone repaint; earlier cells keep identity.
    expect(plan!.cellsChanged).toBe(4);
    expect(plan!.reused).toHaveLength(2);
    completeRenderWork(applyTableFragmentPatchWork(plan!));
    expect(container.outerHTML).toBe(renderTableFragment(deps(doc, next)).outerHTML);
  });

  it('never patches a container it did not paint', () => {
    const next = grid();
    expect(planTableFragmentPatch(patchInput(doc, doc.createElement('div'), next))).toBeNull();
  });
});

describe('SD-5989 table review marker clipping', () => {
  const doc = document.implementation.createHTMLDocument('table-review');
  const runContext = {
    doc,
    layoutEpoch: 42,
    showFormattingMarks: false,
    pendingTooltips: new WeakMap(),
    applySdtDataset: () => {},
    applyTrackedChangeDecorations: () => {},
  } as unknown as RunRenderContext;
  const renderLine: TableRenderDependencies['renderLine'] = (block, _line, lineContext) => {
    const line = doc.createElement('div');
    line.className = 'superdoc-line';
    for (const run of block.runs) {
      if (run.kind && run.kind !== 'text') continue;
      const element = renderTextRun(run, lineContext, runContext, {
        enabled: true,
        mode: block.attrs?.trackedChangesMode === 'final' ? 'final' : 'review',
      });
      if (element) line.appendChild(element);
    }
    return line;
  };
  const markedGrid = (nested = false): Grid => {
    const original = grid();
    const first = original.table.rows[0].cells[0];
    const paragraph = first.blocks![0] as ParagraphBlock;
    const marked: ParagraphBlock = {
      ...paragraph,
      sourceAnchor: { sourceNodeId: 'recipient' },
      runs: [
        {
          kind: 'text',
          text: '\u200b',
          vanish: true,
          fontFamily: 'Arial',
          fontSize: 12,
          pmStart: 0,
          pmEnd: 0,
          dataAttrs: { 'data-page-break-deletion-anchor': 'true', 'data-page-break-deletion-source-node-id': 'donor' },
          trackedChange: { id: 'canonical-deletion', kind: 'delete', storyKey: 'body', author: 'Ada' },
        },
        ...paragraph.runs,
      ],
    };
    const markedMeasure = {
      ...original.measure.rows[0].cells[0].blocks![0],
      lines: [
        {
          fromRun: 0,
          toRun: 1,
          fromChar: 0,
          toChar: paragraph.runs[0].text.length,
          width: 40,
          ascent: 12,
          descent: 4,
          lineHeight: ROW_HEIGHT,
        },
      ],
    };
    const cell = { ...first, attrs: { padding: { top: 0, bottom: 0, left: 0, right: 0 } }, blocks: [marked] };
    const cellMeasure = { ...original.measure.rows[0].cells[0], blocks: [markedMeasure] };
    const nestedTable = {
      ...original.table,
      id: 'nested-table' as BlockId,
      rows: [{ id: 'nested-row' as BlockId, cells: [cell] }],
      columnWidths: [CELL_WIDTH],
    };
    const nestedMeasure = {
      ...original.measure,
      totalWidth: CELL_WIDTH,
      totalHeight: ROW_HEIGHT,
      columnWidths: [CELL_WIDTH],
      rows: [{ height: ROW_HEIGHT, cells: [cellMeasure] }],
    };
    return {
      table: {
        ...original.table,
        rows: original.table.rows.map((row, index) =>
          index
            ? row
            : {
                ...row,
                cells: row.cells.map((item, column) =>
                  column ? item : nested ? { ...cell, id: 'outer-cell' as BlockId, blocks: [nestedTable] } : cell,
                ),
              },
        ),
      },
      measure: {
        ...original.measure,
        rows: original.measure.rows.map((row, index) =>
          index
            ? row
            : {
                ...row,
                cells: row.cells.map((item, column) =>
                  column ? item : nested ? { ...cellMeasure, blocks: [nestedMeasure] } : cellMeasure,
                ),
              },
        ),
      },
    } as Grid;
  };

  it.each([false, true])('keeps a relocated marker outside cell clipping without moving text (nested=%s)', (nested) => {
    const input = markedGrid(nested);
    const container = renderTableFragment(deps(doc, input, { renderLine }));
    const marker = container.querySelector<HTMLElement>('[data-page-break-deletion-anchor]')!;
    expect(marker.textContent).toBe('Page break');
    expect(marker.dataset.trackChangeId).toBe('canonical-deletion');
    expect(marker.dataset.pageBreakDeletionSourceNodeId).toBe('donor');
    expect(marker.dataset.pmStart).toBe(marker.dataset.pmEnd);
    const clippingAncestors: HTMLElement[] = [];
    for (let parent = marker.parentElement; parent && parent !== container; parent = parent.parentElement) {
      if (parent.style.overflow === 'hidden') clippingAncestors.push(parent);
    }
    expect(clippingAncestors).toEqual([]);
    const paintedCells = [...container.querySelectorAll<HTMLElement>('[data-superdoc-table-row-role]')];
    expect(paintedCells.every((cell) => cell.style.overflow === 'hidden')).toBe(true);
    expect(container.querySelectorAll('[data-page-break-deletion-anchor]')).toHaveLength(1);
    expect(container.textContent?.replace('Page break', '')).toBe(
      Array.from({ length: ROWS }, (_, r) => Array.from({ length: COLUMNS }, (_, c) => cellText(r, c)).join('')).join(
        '',
      ),
    );
    expect(container.style.height).toBe(`${ROW_HEIGHT * ROWS}px`);
  });

  it.each([false, true])(
    'keeps each recipient fragment uniquely owned after marker extraction (nested=%s)',
    (nested) => {
      const container = renderTableFragment(deps(doc, markedGrid(nested), { renderLine }));
      const marker = container.querySelector<HTMLElement>('[data-page-break-deletion-anchor]')!;
      const recipient = container.querySelector<HTMLElement>(
        '[data-source-node-id="recipient"]:not([data-page-break-deletion-anchor])',
      )!;
      const fragmentId = recipient.dataset.layoutFragmentId;
      expect(fragmentId).toBeTruthy();
      const owners = [...container.querySelectorAll<HTMLElement>('[data-layout-fragment-id]')].filter(
        (element) => element.dataset.layoutFragmentId === fragmentId,
      );
      expect(owners).toEqual([recipient]);
      expect(marker.hasAttribute('data-layout-fragment-id')).toBe(false);
      expect(marker.dataset.sourceNodeId).toBe('recipient');
      expect(marker.dataset.sourceAnchor).toBe(recipient.dataset.sourceAnchor);
      expect(marker.dataset.layoutBlockRef).toBe(recipient.dataset.layoutBlockRef);
      expect(marker.dataset.layoutStory).toBe(recipient.dataset.layoutStory);
      expect(marker.dataset.pageBreakDeletionSourceNodeId).toBe('donor');
      expect(marker.dataset.trackChangeId).toBe('canonical-deletion');
    },
  );

  it.each(['remove', 'final'])('cleans up the owned marker during a %s table patch', (change) => {
    const previous = markedGrid();
    const container = renderTableFragment(deps(doc, previous, { renderLine }));
    const marker = container.querySelector<HTMLElement>('[data-page-break-deletion-anchor]')!;
    const ledger = readTablePaintLedger(container)!;
    expect(ledger.groups[0].elements.some((element) => element === marker || element.contains(marker))).toBe(true);
    expect(marker.closest('[data-source-node-id]')?.getAttribute('data-source-node-id')).toBe('recipient');
    const next: Grid = {
      table: {
        ...previous.table,
        rows: previous.table.rows.map((row, index) =>
          index
            ? row
            : {
                ...row,
                cells: row.cells.map((cell, column) =>
                  column
                    ? cell
                    : {
                        ...cell,
                        blocks: [
                          {
                            ...(cell.blocks![0] as ParagraphBlock),
                            ...(change === 'remove'
                              ? { runs: (cell.blocks![0] as ParagraphBlock).runs.slice(1) }
                              : {
                                  attrs: { ...(cell.blocks![0] as ParagraphBlock).attrs, trackedChangesMode: 'final' },
                                }),
                          },
                        ],
                      },
                ),
              },
        ),
      },
      measure: previous.measure,
    };
    const input = patchInput(doc, container, next, { renderLine });
    const plan = planTableFragmentPatch(input);
    expect(plan).not.toBeNull();
    completeRenderWork(applyTableFragmentPatchWork(plan!));
    expect(container.querySelector('[data-page-break-deletion-anchor][aria-label]')).toBeNull();
    expect(marker.isConnected).toBe(false);
    expect(container.textContent).toBe(renderTableFragment(deps(doc, next, { renderLine })).textContent);
  });
});
