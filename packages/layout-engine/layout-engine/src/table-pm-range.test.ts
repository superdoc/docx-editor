import { describe, expect, it } from 'vite-plus/test';
import type {
  ImageBlock,
  ImageMeasure,
  Line,
  ParagraphBlock,
  ParagraphMeasure,
  PartialRowInfo,
  TableBlock,
  TableCell,
  TableCellMeasure,
  TableFragment,
  TableMeasure,
} from '@superdoc/contracts';
import { PARTIAL_ROW_RENDERS_TO_CELL_END } from '@superdoc/contracts';
import { applyTableFragmentPmRange, computeCellPmRange, computeTableFragmentPmRange } from './table-pm-range.js';

const LINE_TEXT_LENGTH = 4;
const LINE_HEIGHT = 10;

function line(runIndex: number): Line {
  return {
    fromRun: runIndex,
    fromChar: 0,
    toRun: runIndex,
    toChar: LINE_TEXT_LENGTH,
    width: 50,
    ascent: 8,
    descent: 2,
    lineHeight: LINE_HEIGHT,
  };
}

function paragraph(id: string, lineStarts: number[], attrs?: ParagraphBlock['attrs']): ParagraphBlock {
  return {
    kind: 'paragraph',
    id,
    runs: lineStarts.map((pmStart) => ({
      kind: 'text',
      text: 'abcd',
      fontFamily: 'Arial',
      fontSize: 12,
      pmStart,
      pmEnd: pmStart + LINE_TEXT_LENGTH,
    })),
    attrs,
  };
}

function paragraphMeasure(lineCount: number): ParagraphMeasure {
  const lines = Array.from({ length: lineCount }, (_, index) => line(index));
  return { kind: 'paragraph', lines, totalHeight: lineCount * LINE_HEIGHT };
}

function image(id: string, pmStart: number): ImageBlock {
  return { kind: 'image', id, src: 'x.png', attrs: { pmStart, pmEnd: pmStart + 1 } };
}

function imageMeasure(height = 20): ImageMeasure {
  return { kind: 'image', width: 20, height };
}

function cellMeasure(blocks: TableCellMeasure['blocks']): TableCellMeasure {
  return { blocks, width: 100, height: 0 };
}

function embeddedTable(id: string, pmStart: number, rowCount: number): { block: TableBlock; measure: TableMeasure } {
  const rows = Array.from({ length: rowCount }, (_, index) => ({
    id: `${id}-r${index}`,
    cells: [{ id: `${id}-r${index}-c0`, paragraph: paragraph(`${id}-p${index}`, [pmStart + 2 + index * 10]) }],
  }));
  return {
    block: { kind: 'table', id, rows, attrs: { pmStart, pmEnd: pmStart + rowCount * 10 + 2 } },
    measure: {
      kind: 'table',
      rows: rows.map(() => ({ cells: [cellMeasure([paragraphMeasure(1)])], height: LINE_HEIGHT })),
      columnWidths: [100],
      totalWidth: 100,
      totalHeight: rowCount * LINE_HEIGHT,
    },
  };
}

function oneCellTable(
  cell: TableCell,
  measure: TableCellMeasure,
  rowCount = 1,
): { block: TableBlock; measure: TableMeasure } {
  return {
    block: {
      kind: 'table',
      id: 't',
      rows: Array.from({ length: rowCount }, (_, index) => ({ id: `r${index}`, cells: [cell] })),
    },
    measure: {
      kind: 'table',
      rows: Array.from({ length: rowCount }, () => ({ cells: [measure], height: LINE_HEIGHT })),
      columnWidths: [100],
      totalWidth: 100,
      totalHeight: rowCount * LINE_HEIGHT,
    },
  };
}

function partialRow(fromLineByCell: number[], toLineByCell: number[], rowIndex = 0): PartialRowInfo {
  return { rowIndex, fromLineByCell, toLineByCell, isFirstPart: false, isLastPart: false, partialHeight: 10 };
}

function tableFragment(overrides: Partial<TableFragment>): TableFragment {
  return { kind: 'table', blockId: 't', fromRow: 0, toRow: 1, x: 0, y: 0, width: 100, height: 10, ...overrides };
}

describe('computeCellPmRange', () => {
  const threeLines = paragraph('p', [10, 20, 30]);

  it('returns an empty range when the cell or its measure is missing', () => {
    expect(computeCellPmRange(undefined, cellMeasure([paragraphMeasure(1)]), 0, 1)).toEqual({});
    expect(computeCellPmRange({ id: 'c', blocks: [threeLines] }, undefined, 0, 1)).toEqual({});
  });

  it('covers only the requested paragraph lines, with an exclusive end line', () => {
    const range = computeCellPmRange({ id: 'c', blocks: [threeLines] }, cellMeasure([paragraphMeasure(3)]), 1, 2);
    expect(range).toEqual({ pmStart: 20, pmEnd: 24 });
  });

  it('maps cell-wide line indices onto the paragraph that owns them', () => {
    const cell: TableCell = { id: 'c', blocks: [paragraph('a', [10, 20]), paragraph('b', [40, 50])] };
    const range = computeCellPmRange(cell, cellMeasure([paragraphMeasure(2), paragraphMeasure(2)]), 1, 3);
    expect(range).toEqual({ pmStart: 20, pmEnd: 44 });
  });

  it('reads the legacy single paragraph when the cell has no blocks list', () => {
    const cell: TableCell = { id: 'c', paragraph: threeLines };
    const measure: TableCellMeasure = { paragraph: paragraphMeasure(3), width: 100, height: 30 };
    expect(computeCellPmRange(cell, measure, 0, 1)).toEqual({ pmStart: 10, pmEnd: 14 });
  });

  it('falls back to the paragraph block range when no line falls in the window', () => {
    const before = paragraph('a', [10], { pmStart: 9, pmEnd: 15 });
    const after = paragraph('b', [40]);
    const range = computeCellPmRange(
      { id: 'c', blocks: [before, after] },
      cellMeasure([paragraphMeasure(1), paragraphMeasure(1)]),
      1,
      2,
    );
    expect(range).toEqual({ pmStart: 9, pmEnd: 44 });
  });

  it('falls back to the paragraph block range when the paragraph has no measured lines', () => {
    const empty = paragraph('a', [], { pmStart: 7 });
    expect(computeCellPmRange({ id: 'c', blocks: [empty] }, cellMeasure([paragraphMeasure(0)]), 0, 1)).toEqual({
      pmStart: 7,
      pmEnd: 8,
    });
  });

  it('counts an embedded table as one segment per embedded row, and includes it only when it overlaps', () => {
    const nested = embeddedTable('n', 100, 3);
    const after = paragraph('after', [200]);
    const cell: TableCell = { id: 'c', blocks: [nested.block, after] };
    const measure = cellMeasure([nested.measure, paragraphMeasure(1)]);

    expect(computeCellPmRange(cell, measure, 3, 4)).toEqual({ pmStart: 200, pmEnd: 204 });
    expect(computeCellPmRange(cell, measure, 2, 3)).toEqual({ pmStart: 100, pmEnd: 132 });
  });

  it("expands an embedded row that holds a further table into that table's rows", () => {
    const inner = embeddedTable('inner', 110, 2);
    const outer: TableBlock = {
      kind: 'table',
      id: 'outer',
      rows: [{ id: 'outer-r0', cells: [{ id: 'outer-c0', blocks: [inner.block] }] }],
      attrs: { pmStart: 100, pmEnd: 140 },
    };
    const outerMeasure: TableMeasure = {
      kind: 'table',
      rows: [{ cells: [cellMeasure([inner.measure])], height: 2 * LINE_HEIGHT }],
      columnWidths: [100],
      totalWidth: 100,
      totalHeight: 2 * LINE_HEIGHT,
    };
    const cell: TableCell = { id: 'c', blocks: [outer, paragraph('after', [200])] };
    const measure = cellMeasure([outerMeasure, paragraphMeasure(1)]);

    expect(computeCellPmRange(cell, measure, 2, 3)).toEqual({ pmStart: 200, pmEnd: 204 });
    expect(computeCellPmRange(cell, measure, 1, 2)).toEqual({ pmStart: 100, pmEnd: 140 });
  });

  it('counts an image as one segment, included only when its segment starts inside the window', () => {
    const cell: TableCell = { id: 'c', blocks: [paragraph('a', [10]), image('img', 50), paragraph('b', [60])] };
    const measure = cellMeasure([paragraphMeasure(1), imageMeasure(), paragraphMeasure(1)]);

    expect(computeCellPmRange(cell, measure, 1, 2)).toEqual({ pmStart: 50, pmEnd: 51 });
    expect(computeCellPmRange(cell, measure, 2, 3)).toEqual({ pmStart: 60, pmEnd: 64 });
    expect(computeCellPmRange(cell, measure, 0, 1)).toEqual({ pmStart: 10, pmEnd: 14 });
  });

  it('pairs blocks with measures only up to the shorter list', () => {
    const cell: TableCell = { id: 'c', blocks: [paragraph('a', [10]), paragraph('b', [20])] };
    expect(computeCellPmRange(cell, cellMeasure([paragraphMeasure(1)]), 0, 5)).toEqual({ pmStart: 10, pmEnd: 14 });
  });
});

describe('computeTableFragmentPmRange', () => {
  it('unions every cell of every row in the fragment, and skips rows outside it', () => {
    const block: TableBlock = {
      kind: 'table',
      id: 't',
      rows: [
        {
          id: 'r0',
          cells: [
            { id: 'a', paragraph: paragraph('a', [10]) },
            { id: 'b', paragraph: paragraph('b', [20]) },
          ],
        },
        {
          id: 'r1',
          cells: [
            { id: 'c', paragraph: paragraph('c', [30]) },
            { id: 'd', paragraph: paragraph('d', [40]) },
          ],
        },
        { id: 'r2', cells: [{ id: 'e', paragraph: paragraph('e', [50]) }] },
      ],
    };
    const row = (cellCount: number) => ({
      cells: Array.from({ length: cellCount }, () => cellMeasure([paragraphMeasure(1)])),
      height: LINE_HEIGHT,
    });
    const measure: TableMeasure = {
      kind: 'table',
      rows: [row(2), row(2), row(1)],
      columnWidths: [50, 50],
      totalWidth: 100,
      totalHeight: 30,
    };
    expect(computeTableFragmentPmRange(block, measure, 0, 2)).toEqual({ pmStart: 10, pmEnd: 44 });
    expect(computeTableFragmentPmRange(block, measure, 0, 9)).toEqual({ pmStart: 10, pmEnd: 54 });
  });

  it('reads only the partial row line window of the split row', () => {
    const { block, measure } = oneCellTable(
      { id: 'c', blocks: [paragraph('p', [10, 20, 30, 40])] },
      cellMeasure([paragraphMeasure(4)]),
    );
    expect(computeTableFragmentPmRange(block, measure, 0, 1, partialRow([1], [3]))).toEqual({ pmStart: 20, pmEnd: 34 });
  });

  it('applies a partial row window only to the row it names', () => {
    const { block, measure } = oneCellTable(
      { id: 'c', blocks: [paragraph('p', [10, 20, 30, 40])] },
      cellMeasure([paragraphMeasure(4)]),
      2,
    );
    expect(computeTableFragmentPmRange(block, measure, 0, 1, partialRow([1], [3], 1))).toEqual({
      pmStart: 10,
      pmEnd: 44,
    });
  });

  it('reads PARTIAL_ROW_RENDERS_TO_CELL_END as the last line of the cell', () => {
    const { block, measure } = oneCellTable(
      { id: 'c', blocks: [paragraph('p', [10, 20, 30, 40])] },
      cellMeasure([paragraphMeasure(4)]),
    );
    const window = partialRow([2], [PARTIAL_ROW_RENDERS_TO_CELL_END]);
    expect(computeTableFragmentPmRange(block, measure, 0, 1, window)).toEqual({ pmStart: 30, pmEnd: 44 });
  });

  it('uses the whole cell for a cell index beyond the partial row arrays', () => {
    const { block, measure } = oneCellTable(
      { id: 'c', blocks: [paragraph('p', [10, 20, 30])] },
      cellMeasure([paragraphMeasure(3)]),
    );
    expect(computeTableFragmentPmRange(block, measure, 0, 1, partialRow([], []))).toEqual({ pmStart: 10, pmEnd: 34 });
  });

  it('ignores a negative or non-numeric start line', () => {
    const { block, measure } = oneCellTable(
      { id: 'c', blocks: [paragraph('p', [10, 20, 30])] },
      cellMeasure([paragraphMeasure(3)]),
    );
    expect(computeTableFragmentPmRange(block, measure, 0, 1, partialRow([-3], [3]))).toEqual({
      pmStart: 10,
      pmEnd: 34,
    });
    expect(computeTableFragmentPmRange(block, measure, 0, 1, partialRow([Number.NaN], [3]))).toEqual({
      pmStart: 10,
      pmEnd: 34,
    });
  });

  it('clamps an end line past the cell to the segment count getCellLines reports', () => {
    const zeroHeightImage = image('img', 50);
    const cell: TableCell = { id: 'c', blocks: [paragraph('a', [10]), zeroHeightImage, paragraph('b', [60])] };
    const { block, measure } = oneCellTable(
      cell,
      cellMeasure([paragraphMeasure(1), imageMeasure(0), paragraphMeasure(1)]),
    );
    expect(computeTableFragmentPmRange(block, measure, 0, 1, partialRow([0], [99]))).toEqual({
      pmStart: 10,
      pmEnd: 51,
    });
  });

  it('collapses an end line before the start line into an empty window at the start line', () => {
    const cell: TableCell = { id: 'c', blocks: [paragraph('a', [10, 20, 30], { pmStart: 9, pmEnd: 35 })] };
    const { block, measure } = oneCellTable(cell, cellMeasure([paragraphMeasure(3)]));
    expect(computeTableFragmentPmRange(block, measure, 0, 1, partialRow([2], [1]))).toEqual({ pmStart: 9, pmEnd: 35 });
  });
});

describe('applyTableFragmentPmRange', () => {
  const rows = [10, 20, 30].map((pmStart, index) => ({
    id: `r${index}`,
    cells: [{ id: `c${index}`, paragraph: paragraph(`p${index}`, [pmStart]) }],
  }));
  const block: TableBlock = { kind: 'table', id: 't', rows };
  const measure: TableMeasure = {
    kind: 'table',
    rows: rows.map(() => ({ cells: [cellMeasure([paragraphMeasure(1)])], height: LINE_HEIGHT })),
    columnWidths: [100],
    totalWidth: 100,
    totalHeight: 30,
  };

  it('sets the fragment range from its own rows', () => {
    const fragment = tableFragment({ fromRow: 1, toRow: 2 });
    applyTableFragmentPmRange(fragment, block, measure);
    expect(fragment).toMatchObject({ pmStart: 20, pmEnd: 24 });
  });

  it('widens the range to the rows of merged-cell content the fragment continues', () => {
    const fragment = tableFragment({
      fromRow: 2,
      toRow: 3,
      mergedCellContent: [{ rowIndex: 0, cellIndex: 0, fromLine: 0, toLine: 1 }],
    });
    applyTableFragmentPmRange(fragment, block, measure);
    expect(fragment).toMatchObject({ pmStart: 10, pmEnd: 34 });
  });

  it('skips merged-cell content slices that carry no lines', () => {
    const fragment = tableFragment({
      fromRow: 2,
      toRow: 3,
      mergedCellContent: [{ rowIndex: 0, cellIndex: 0, fromLine: 1, toLine: 1 }],
    });
    applyTableFragmentPmRange(fragment, block, measure);
    expect(fragment).toMatchObject({ pmStart: 30, pmEnd: 34 });
  });

  it('leaves the fragment range unset when its content has no positions', () => {
    const blank: TableBlock = {
      kind: 'table',
      id: 't',
      rows: [{ id: 'r', cells: [{ id: 'c', paragraph: { kind: 'paragraph', id: 'p', runs: [] } }] }],
    };
    const fragment = tableFragment({});
    applyTableFragmentPmRange(fragment, blank, { ...measure, rows: [measure.rows[0]] });
    expect(fragment.pmStart).toBeUndefined();
    expect(fragment.pmEnd).toBeUndefined();
  });
});
