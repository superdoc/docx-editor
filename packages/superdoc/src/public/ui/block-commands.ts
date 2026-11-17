import { readRecord, type LooseRecord } from './loose-record.js';
import type { TableCommandSpec } from './commands.js';

export const PARAGRAPH_INDENT_STEP_TWIPS = 720;

export interface ResolvedTableContext {
  canMerge: boolean;
  tableNodeId: string;
  rowIndex: number;
  columnIndex: number;
  cellNodeId: string | null;
  mergeRange: {
    start: { rowIndex: number; columnIndex: number };
    end: { rowIndex: number; columnIndex: number };
  } | null;
}

export function readMergeRange(
  range: LooseRecord | undefined,
): { start: { rowIndex: number; columnIndex: number }; end: { rowIndex: number; columnIndex: number } } | null {
  const point = (value: unknown): { rowIndex: number; columnIndex: number } | null => {
    const record = readRecord(value);
    const rowIndex = record?.rowIndex;
    const columnIndex = record?.columnIndex;
    if (typeof rowIndex !== 'number' || !Number.isInteger(rowIndex)) return null;
    if (typeof columnIndex !== 'number' || !Number.isInteger(columnIndex)) return null;
    return { rowIndex, columnIndex };
  };
  if (!range) return null;
  const start = point(range.start);
  const end = point(range.end);
  if (!start || !end) return null;
  return { start, end };
}

export function buildTableCommandInput(
  action: TableCommandSpec['action'],
  context: ResolvedTableContext,
): LooseRecord | null {
  const { tableNodeId: nodeId, rowIndex, columnIndex, cellNodeId, mergeRange } = context;
  switch (action) {
    case 'insert-row-before':
      return { nodeId, rowIndex, position: 'above' };
    case 'insert-row-after':
      return { nodeId, rowIndex, position: 'below' };
    case 'delete-row':
      return { nodeId, rowIndex };
    case 'insert-column-before':
      return { nodeId, columnIndex, position: 'left' };
    case 'insert-column-after':
      return { nodeId, columnIndex, position: 'right' };
    case 'delete-column':
      return { nodeId, columnIndex };
    case 'delete-table':
      return { nodeId };
    case 'merge-cells': {
      if (!context.canMerge) return null;
      const range = mergeRange ?? {
        start: { rowIndex, columnIndex },
        end: { rowIndex, columnIndex },
      };
      return { nodeId, start: range.start, end: range.end };
    }
    case 'split-cell':
      return cellNodeId ? { nodeId: cellNodeId, rows: 1, columns: 2 } : null;
    case 'remove-borders':
      return { nodeId, mode: 'applyTo', applyTo: 'all', border: null };
    default: {
      const exhaustive: never = action;
      void exhaustive;
      return null;
    }
  }
}
