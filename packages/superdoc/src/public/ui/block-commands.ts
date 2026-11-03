import { readRecord, type LooseRecord } from './loose-record.js';
import { isFiniteNumber } from '../../helpers/is-finite-number.js';
import type { TableCommandSpec } from './commands.js';

export const PARAGRAPH_INDENT_STEP_TWIPS = 720;

export type ParagraphIndentationTwips = {
  left?: number;
  right?: number;
  firstLine?: number;
  hanging?: number;
};

export function pointsToTwips(value: number): number {
  return Math.round(value * 20);
}

export function readParagraphIndentationFromResult(result: unknown): ParagraphIndentationTwips | null {
  const node = readRecord(readRecord(result)?.node);
  if (!node) return null;
  const paragraphPayload =
    node.kind === 'heading'
      ? readRecord(node.heading)
      : node.kind === 'paragraph'
        ? readRecord(node.paragraph)
        : undefined;
  if (!paragraphPayload) return null;
  const resolvedIndent = readRecord(paragraphPayload.resolved)?.indent;
  const indent =
    resolvedIndent != null ? readRecord(resolvedIndent) : readRecord(readRecord(paragraphPayload.props)?.indent);
  if (!indent) return null;

  const left = isFiniteNumber(indent.left)
    ? pointsToTwips(indent.left)
    : isFiniteNumber(indent.start)
      ? pointsToTwips(indent.start)
      : undefined;
  const right = isFiniteNumber(indent.right)
    ? pointsToTwips(indent.right)
    : isFiniteNumber(indent.end)
      ? pointsToTwips(indent.end)
      : undefined;
  const firstLine = isFiniteNumber(indent.firstLine) ? pointsToTwips(indent.firstLine) : undefined;
  const hanging = isFiniteNumber(indent.hanging) ? pointsToTwips(indent.hanging) : undefined;
  if (left == null && right == null && firstLine == null && hanging == null) return null;
  return {
    ...(left != null ? { left } : {}),
    ...(right != null ? { right } : {}),
    ...(firstLine != null ? { firstLine } : {}),
    ...(hanging != null ? { hanging } : {}),
  };
}

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
