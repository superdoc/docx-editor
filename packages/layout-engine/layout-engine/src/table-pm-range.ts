import {
  PARTIAL_ROW_RENDERS_TO_CELL_END,
  type LinePmRange,
  type Measure,
  type PartialRowInfo,
  type TableBlock,
  type TableCell,
  type TableCellMeasure,
  type TableFragment,
  type TableMeasure,
} from '@superdoc/contracts';
import { computeFragmentPmRange, extractBlockPmRange } from './layout-utils.js';
import { getCellLines, getEmbeddedRowLines } from './layout-table.js';

type CellBlock = NonNullable<TableCell['blocks']>[number];

type CellContentPair = { block: CellBlock | undefined; measure: Measure };

type CellLineWindow = { fromLine: number; toLine: number };

function mergePmRange(target: LinePmRange, range: LinePmRange): void {
  if (typeof range.pmStart === 'number') {
    target.pmStart = target.pmStart == null ? range.pmStart : Math.min(target.pmStart, range.pmStart);
  }
  if (typeof range.pmEnd === 'number') {
    target.pmEnd = target.pmEnd == null ? range.pmEnd : Math.max(target.pmEnd, range.pmEnd);
  }
}

function pairCellContentTruncatedToShorterList(cell: TableCell, cellMeasure: TableCellMeasure): CellContentPair[] {
  const cellBlocks: CellBlock[] = cell.blocks ?? (cell.paragraph ? [cell.paragraph] : []);
  const blockMeasures: Measure[] = cellMeasure.blocks ?? (cellMeasure.paragraph ? [cellMeasure.paragraph] : []);
  const pairCount = Math.min(cellBlocks.length, blockMeasures.length);
  const pairs: CellContentPair[] = [];
  for (let index = 0; index < pairCount; index++) {
    pairs.push({ block: cellBlocks[index], measure: blockMeasures[index] });
  }
  return pairs;
}

function embeddedTableSegmentCount(tableMeasure: TableMeasure): number {
  let segments = 0;
  for (const row of tableMeasure.rows) {
    segments += getEmbeddedRowLines(row).length;
  }
  return segments;
}

const UNSPLITTABLE_BLOCK_SEGMENT_COUNT = 1;

export function computeCellPmRange(
  cell: TableCell | undefined,
  cellMeasure: TableCellMeasure | undefined,
  fromLine: number,
  toLine: number,
): LinePmRange {
  const range: LinePmRange = {};
  if (!cell || !cellMeasure) return range;

  let cumulativeLineCount = 0;
  for (const { block, measure } of pairCellContentTruncatedToShorterList(cell, cellMeasure)) {
    if (measure.kind === 'paragraph' && block?.kind === 'paragraph') {
      const lines = measure.lines;
      const blockLineCount = lines?.length ?? 0;
      const blockStartGlobal = cumulativeLineCount;
      const blockEndGlobal = cumulativeLineCount + blockLineCount;
      const localFrom = Math.max(fromLine, blockStartGlobal) - blockStartGlobal;
      const localTo = Math.min(toLine, blockEndGlobal) - blockStartGlobal;

      const paragraphHasLinesInWindow = lines && lines.length > 0 && localFrom < localTo;
      mergePmRange(
        range,
        paragraphHasLinesInWindow
          ? computeFragmentPmRange(block, lines, localFrom, localTo)
          : extractBlockPmRange(block),
      );
      cumulativeLineCount = blockEndGlobal;
      continue;
    }

    const blockStart = cumulativeLineCount;
    if (measure.kind === 'table') {
      const blockEnd = blockStart + embeddedTableSegmentCount(measure);
      if (blockStart < toLine && blockEnd > fromLine) {
        mergePmRange(range, extractBlockPmRange(block));
      }
      cumulativeLineCount = blockEnd;
    } else {
      cumulativeLineCount += UNSPLITTABLE_BLOCK_SEGMENT_COUNT;
      if (blockStart < toLine && blockStart >= fromLine) {
        mergePmRange(range, extractBlockPmRange(block));
      }
    }
  }

  return range;
}

function partialRowLineWindow(
  partialRow: PartialRowInfo | undefined,
  cellIndex: number,
  totalLines: number,
): CellLineWindow {
  let fromLine = 0;
  let toLine = totalLines;

  if (partialRow) {
    if (partialRow.fromLineByCell && cellIndex < partialRow.fromLineByCell.length) {
      const rawFrom = partialRow.fromLineByCell[cellIndex];
      if (typeof rawFrom === 'number' && rawFrom >= 0) {
        fromLine = rawFrom;
      }
    }
    if (partialRow.toLineByCell && cellIndex < partialRow.toLineByCell.length) {
      const rawTo = partialRow.toLineByCell[cellIndex];
      if (typeof rawTo === 'number') {
        toLine = rawTo === PARTIAL_ROW_RENDERS_TO_CELL_END ? totalLines : rawTo;
      }
    }
  }

  const clampedFrom = Math.max(0, Math.min(fromLine, totalLines));
  const clampedTo = Math.max(0, Math.min(toLine, totalLines));
  return { fromLine: clampedFrom, toLine: Math.max(clampedTo, clampedFrom) };
}

export function computeTableFragmentPmRange(
  block: TableBlock,
  measure: TableMeasure,
  fromRow: number,
  toRow: number,
  partialRow?: PartialRowInfo,
): LinePmRange {
  const range: LinePmRange = {};

  for (let rowIndex = fromRow; rowIndex < toRow; rowIndex++) {
    const row = block.rows[rowIndex];
    const rowMeasure = measure.rows[rowIndex];
    if (!row || !rowMeasure) continue;

    const splitRow = partialRow?.rowIndex === rowIndex ? partialRow : undefined;
    const cellCount = Math.min(row.cells.length, rowMeasure.cells.length);

    for (let cellIndex = 0; cellIndex < cellCount; cellIndex++) {
      const cell = row.cells[cellIndex];
      const cellMeasure = rowMeasure.cells[cellIndex];
      if (!cell || !cellMeasure) continue;

      const { fromLine, toLine } = partialRowLineWindow(splitRow, cellIndex, getCellLines(cellMeasure).length);
      mergePmRange(range, computeCellPmRange(cell, cellMeasure, fromLine, toLine));
    }
  }

  return range;
}

export function applyTableFragmentPmRange(fragment: TableFragment, block: TableBlock, measure: TableMeasure): void {
  const range = computeTableFragmentPmRange(block, measure, fragment.fromRow, fragment.toRow, fragment.partialRow);
  for (const slice of fragment.mergedCellContent ?? []) {
    if (slice.fromLine === slice.toLine) continue;
    mergePmRange(range, computeTableFragmentPmRange(block, measure, slice.rowIndex, slice.rowIndex + 1));
  }
  if (range.pmStart != null) {
    fragment.pmStart = range.pmStart;
  }
  if (range.pmEnd != null) {
    fragment.pmEnd = range.pmEnd;
  }
}
