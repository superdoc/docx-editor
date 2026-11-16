import { isPlainObject, type TableRowBoundary } from '@superdoc/contracts';
import type { BalancingFragment, MeasureData } from './column-balancing.js';

export const MIN_SPLITTABLE_TABLE_ROWS = 2;
export const MIN_SPLIT_TARGET_HEIGHT = 1;
export const TABLE_FITS_TARGET_TOLERANCE = 1;
export const SPLIT_ROW_BOUNDARY_ORIGIN_Y = 0.5;

export type DominantTableSplit = { rollback: () => void };

export type DominantTableSplitArgs = {
  sectionFragments: BalancingFragment[];
  fragments: BalancingFragment[];
  columnCount: number;
  measureMap: Map<string, MeasureData>;
  balancingHeight: (fragment: BalancingFragment) => number;
};

function rowHeight(row: unknown): number {
  return isPlainObject(row) && typeof row.height === 'number' ? row.height : 0;
}

function tableRowHeights(measure: MeasureData | undefined): number[] | null {
  if (!measure || measure.kind !== 'table' || !('rows' in measure) || !Array.isArray(measure.rows)) return null;
  return Array.from(measure.rows, rowHeight);
}

function heightBeforeFirstTable(
  sectionFragments: BalancingFragment[],
  balancingHeight: (fragment: BalancingFragment) => number,
): number {
  let height = 0;
  for (const fragment of sectionFragments) {
    if (fragment.kind === 'table') break;
    height += balancingHeight(fragment);
  }
  return Math.max(0, height);
}

function sumHeights(heights: number[]): number {
  return heights.reduce((sum, height) => sum + height, 0);
}

export function findSplitRowBeforeLastRow(
  rowHeights: number[],
  fromRow: number,
  toRow: number,
  target: number,
): number | null {
  let cumulativeHeight = 0;
  let splitRow = fromRow + 1;
  for (let row = fromRow; row < toRow - 1; row++) {
    const height = rowHeights[row] ?? 0;
    if (cumulativeHeight + height >= target) {
      splitRow = row + 1;
      break;
    }
    cumulativeHeight += height;
    splitRow = row + 2;
  }
  return splitRow <= fromRow || splitRow >= toRow ? null : splitRow;
}

export function fragmentRowBoundaries(rowHeights: number[]): TableRowBoundary[] {
  let y = SPLIT_ROW_BOUNDARY_ORIGIN_Y;
  return rowHeights.map((height, index) => {
    const boundary: TableRowBoundary = { index, y, height, minHeight: height, resizable: true };
    y += height;
    return boundary;
  });
}

function withRowBoundaries(metadata: unknown, rowHeights: number[]) {
  return metadata ? { ...metadata, rowBoundaries: fragmentRowBoundaries(rowHeights) } : undefined;
}

function insertAfter(list: BalancingFragment[], anchor: BalancingFragment, inserted: BalancingFragment): void {
  const index = list.indexOf(anchor);
  if (index >= 0) list.splice(index + 1, 0, inserted);
}

function remove(list: BalancingFragment[], fragment: BalancingFragment): void {
  const index = list.indexOf(fragment);
  if (index >= 0) list.splice(index, 1);
}

export function splitDominantTableAtRowBoundary(args: DominantTableSplitArgs): DominantTableSplit | null {
  const { sectionFragments, fragments, columnCount, measureMap, balancingHeight } = args;
  if (columnCount <= 1) return null;

  const tables = sectionFragments.filter((fragment) => fragment.kind === 'table');
  if (tables.length !== 1) return null;
  const table = tables[0];
  const fromRow = 'fromRow' in table && typeof table.fromRow === 'number' ? table.fromRow : 0;
  const toRow = 'toRow' in table && typeof table.toRow === 'number' ? table.toRow : fromRow;
  if (toRow - fromRow < MIN_SPLITTABLE_TABLE_ROWS) return null;

  const rowHeights = tableRowHeights(measureMap.get(table.blockId));
  if (!rowHeights) return null;

  const totalSectionHeight = sumHeights(sectionFragments.map(balancingHeight));
  if (totalSectionHeight <= 0) return null;
  const target = Math.max(
    MIN_SPLIT_TARGET_HEIGHT,
    totalSectionHeight / columnCount - heightBeforeFirstTable(sectionFragments, balancingHeight),
  );
  if (balancingHeight(table) <= target + TABLE_FITS_TARGET_TOLERANCE) return null;

  const splitRow = findSplitRowBeforeLastRow(rowHeights, fromRow, toRow, target);
  if (splitRow === null) return null;

  const firstHalfRows = rowHeights.slice(fromRow, splitRow);
  const secondHalfRows = rowHeights.slice(splitRow, toRow);
  const originalHeight = table.height;
  const originalContinuesOnNext = ('continuesOnNext' in table ? table.continuesOnNext : undefined) ?? false;
  const originalMetadata = 'metadata' in table ? table.metadata : undefined;
  const firstMetadata = withRowBoundaries(originalMetadata, firstHalfRows);
  const secondMetadata = withRowBoundaries(originalMetadata, secondHalfRows);

  Object.assign(
    table,
    { toRow: splitRow, height: sumHeights(firstHalfRows), continuesOnNext: true },
    firstMetadata ? { metadata: firstMetadata } : {},
  );
  const secondHalf = {
    ...table,
    fromRow: splitRow,
    toRow,
    height: sumHeights(secondHalfRows),
    continuesFromPrev: true,
    continuesOnNext: originalContinuesOnNext,
    metadata: secondMetadata ?? originalMetadata,
  };
  insertAfter(fragments, table, secondHalf);
  insertAfter(sectionFragments, table, secondHalf);

  return {
    rollback: () => {
      Object.assign(table, {
        toRow,
        height: originalHeight,
        continuesOnNext: originalContinuesOnNext,
        metadata: originalMetadata,
      });
      remove(fragments, secondHalf);
      remove(sectionFragments, secondHalf);
    },
  };
}
