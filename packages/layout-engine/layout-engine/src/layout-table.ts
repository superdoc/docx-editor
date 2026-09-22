import type {
  TableBlock,
  TableMeasure,
  TableFragment,
  TableColumnBoundary,
  TableRowBoundary,
  TableFragmentMetadata,
  TableRowMeasure,
  TableRow,
  PartialRowInfo,
  ParagraphMeasure,
  ParagraphBlock,
} from '@superdoc/contracts';
import {
  OOXML_PCT_DIVISOR,
  rescaleColumnWidths,
  resolveTableWidthAttr,
  getTableVisualDirection,
} from '@superdoc/contracts';
import { breakParagraphAdjacency, type PageState } from './paginator.js';
import { computeFragmentPmRange, extractBlockPmRange } from './layout-utils.js';
import { describeCellRenderBlocks, createCellSliceCursor, computeFullCellContentHeight } from './table-cell-slice.js';
import { isAnchoredTableFullWidth } from './floating-table-anchor.js';

export { ANCHORED_TABLE_FULL_WIDTH_RATIO, isAnchoredTableFullWidth } from './floating-table-anchor.js';

export type TableLayoutContext = {
  block: TableBlock;
  measure: TableMeasure;
  columnWidth: number;
  ensurePage: () => PageState;
  advanceColumn: (state: PageState) => PageState;
  columnX: (state: PageState, columnIndex?: number) => number;
  resumeCursor?: TableLayoutCursor;
  onFragmentStart?: (state: PageState, cursor: TableLayoutCursor) => void;
};

export type TableLayoutCursor = {
  currentRow: number;
  isTableContinuation: boolean;
  pendingPartialRow: PartialRowInfo | null;
  samePagePartialContinuation: boolean;
  retryWithoutHeaders: boolean;
};

export type TableLayoutStep = {
  index: number;
  total: number;
};

const clonePartialRow = (partialRow: PartialRowInfo | null): PartialRowInfo | null =>
  partialRow
    ? {
        ...partialRow,
        fromLineByCell: partialRow.fromLineByCell.slice(),
        toLineByCell: partialRow.toLineByCell.slice(),
      }
    : null;

const cloneTableLayoutCursor = (cursor: TableLayoutCursor): TableLayoutCursor => ({
  ...cursor,
  pendingPartialRow: clonePartialRow(cursor.pendingPartialRow),
});

/**
 * Safely extract the tableIndent width value from table attributes.
 *
 * The tableIndent attribute controls horizontal offset of tables from the left margin.
 * Negative values are supported and allow tables to extend into the left margin,
 * matching Microsoft Word behavior.
 *
 * Edge cases handled:
 * - Missing attrs object: Returns 0
 * - Missing tableIndent property: Returns 0
 * - tableIndent is not an object: Returns 0
 * - tableIndent.width is missing: Returns 0
 * - tableIndent.width is not a number: Returns 0
 * - tableIndent.width is NaN: Returns 0
 * - tableIndent.width is Infinity/-Infinity: Returns 0
 *
 * @param attrs - Table attributes object (may be undefined)
 * @returns Table indent width in pixels, or 0 if invalid/missing
 *
 * @example
 * ```typescript
 * // Valid positive indent (table moves right)
 * getTableIndentWidth({ tableIndent: { width: 50 } }); // returns 50
 *
 * // Valid negative indent (table extends into left margin)
 * getTableIndentWidth({ tableIndent: { width: -20 } }); // returns -20
 *
 * // Invalid cases - all return 0
 * getTableIndentWidth(undefined); // returns 0
 * getTableIndentWidth({}); // returns 0
 * getTableIndentWidth({ tableIndent: null }); // returns 0
 * getTableIndentWidth({ tableIndent: { width: 'invalid' } }); // returns 0
 * getTableIndentWidth({ tableIndent: { width: NaN } }); // returns 0
 * ```
 */
function getTableIndentWidth(attrs: TableBlock['attrs']): number {
  // Guard: attrs must be defined
  if (!attrs) {
    return 0;
  }

  // Guard: tableIndent must exist and be an object
  const tableIndent = attrs.tableIndent;
  if (!tableIndent || typeof tableIndent !== 'object') {
    return 0;
  }

  // Guard: width must exist in tableIndent
  const width = (tableIndent as Record<string, unknown>).width;
  if (width === undefined || width === null) {
    return 0;
  }

  // Guard: width must be a number
  if (typeof width !== 'number') {
    return 0;
  }

  // Guard: width must be finite (not NaN or Infinity)
  if (!Number.isFinite(width)) {
    return 0;
  }

  return width;
}

/**
 * Apply table indent offset to x position and width, ensuring width stays in a sane range.
 *
 * Positive indents move the table right. Width is only reduced when needed to prevent
 * right overflow past the current column (avoids double-shrinking tables whose grid is
 * already reduced by tblInd in OOXML).
 *
 * Negative indents keep the historical behavior: move left and expand width to preserve
 * the same right edge.
 *
 * @param x - Original x position in pixels
 * @param width - Original width in pixels
 * @param indent - Table indent offset in pixels (positive or negative)
 * @param columnWidth - Column width available for the table
 * @returns Object with adjusted x and width values
 */
function applyTableIndent(x: number, width: number, indent: number, columnWidth: number): { x: number; width: number } {
  const shiftedX = x + indent;

  if (indent <= 0) {
    return {
      x: shiftedX,
      width: Math.max(0, width - indent),
    };
  }

  if (width > columnWidth) {
    return {
      x: shiftedX,
      width,
    };
  }

  const maxWidthWithinColumn = Math.max(0, columnWidth - indent);
  return {
    x: shiftedX,
    width: Math.min(width, maxWidthWithinColumn),
  };
}

export function resolveRenderedTableWidth(
  columnWidth: number,
  measuredWidth: number,
  attrs: TableBlock['attrs'],
): number {
  const safeMeasuredWidth =
    Number.isFinite(measuredWidth) && measuredWidth > 0 ? measuredWidth : Math.max(0, columnWidth);
  const configuredWidth = resolveTableWidthAttr(attrs?.tableWidth);
  if (!configuredWidth) {
    return safeMeasuredWidth;
  }

  if (configuredWidth.type === 'pct') {
    return Math.max(0, Math.round(columnWidth * (configuredWidth.width / OOXML_PCT_DIVISOR)));
  }

  // Explicit px/pixel/dxa widths are already applied during measurement in
  // measuring/dom's resolveTableWidth() + measureTableBlock() pipeline. We keep
  // measuredWidth authoritative here so layout uses the fully measured table
  // total, including any border/cell-spacing effects, while only percentage
  // widths are recomputed against the current section width.
  return safeMeasuredWidth;
}

/**
 * Resolve the table fragment frame within a column based on justification.
 *
 * When justification is center or right/end, the table is aligned within the
 * column width and tableIndent is ignored. Otherwise, tableIndent offsets the
 * table from the left margin and clamps width only when needed to avoid overflow.
 *
 * @param baseX - Left edge of the column in pixels
 * @param columnWidth - Available column width in pixels
 * @param tableWidth - Measured table width in pixels
 * @param attrs - Table attributes
 * @returns Resolved x and width for the table fragment
 */
export function resolveTableFrame(
  baseX: number,
  columnWidth: number,
  tableWidth: number,
  attrs: TableBlock['attrs'],
): { x: number; width: number } {
  const width = resolveRenderedTableWidth(columnWidth, tableWidth, attrs);
  const explicitJustification = typeof attrs?.justification === 'string' ? attrs.justification : undefined;
  const isRtlTable = getTableVisualDirection(attrs) === 'rtl';
  const effectiveJustification = explicitJustification ?? (isRtlTable ? 'end' : undefined);
  const tableIndent = getTableIndentWidth(attrs);

  if (effectiveJustification === 'center') {
    return { x: baseX + (columnWidth - width) / 2, width };
  }
  if (effectiveJustification === 'right' || effectiveJustification === 'end') {
    const rightAlignedX = baseX + (columnWidth - width);
    // In bidiVisual tables with no explicit jc, Word keeps right alignment
    // and applies tblInd from the right edge.
    if (explicitJustification == null && isRtlTable && tableIndent !== 0) {
      return { x: rightAlignedX - tableIndent, width };
    }
    return { x: rightAlignedX, width };
  }

  return applyTableIndent(baseX, width, tableIndent, columnWidth);
}

/**
 * Rescales column widths when a table is clamped to fit a narrower section.
 *
 * In mixed-orientation documents, tables are measured at the widest section's
 * content width but may render in narrower sections. When the measured total
 * width exceeds the fragment width, column widths must be proportionally
 * rescaled so cells don't overflow the fragment container (SD-1859).
 *
 * @returns Rescaled column widths if clamping occurred, undefined otherwise.
 */
const COLUMN_MIN_WIDTH_PX = 25;
const COLUMN_MAX_WIDTH_PX = 200;
const ROW_MIN_HEIGHT_PX = 10;

/**
 * Calculate minimum width for a table column from its measured width.
 *
 * Clamps the measured width to [COLUMN_MIN_WIDTH_PX, COLUMN_MAX_WIDTH_PX]
 * so that resize handles enforce a sensible range (min 25px, max 200px).
 * Invalid/negative/zero measured widths are treated as the minimum.
 *
 * @param measuredWidth - Measured width in pixels (may be invalid)
 * @returns Clamped minimum width in pixels
 */
function calculateColumnMinWidth(measuredWidth: number): number {
  if (!Number.isFinite(measuredWidth) || measuredWidth <= 0) {
    return COLUMN_MIN_WIDTH_PX;
  }
  return Math.max(COLUMN_MIN_WIDTH_PX, Math.min(COLUMN_MAX_WIDTH_PX, measuredWidth));
}

/**
 * Generate column boundary metadata for interactive table resizing.
 *
 * Creates metadata that enables the overlay component to position resize handles
 * and enforce minimum width constraints during drag operations.
 *
 * The generated metadata includes:
 * - Column index (for identifying which column to resize)
 * - X position (for positioning resize handles)
 * - Current width (for calculating new widths during resize)
 * - Minimum width (for constraining resize operations)
 * - Resizable flag (currently always true, future: lock specific columns)
 *
 * Edge cases handled:
 * - Empty columnWidths array: Returns empty array (no boundaries)
 * - Single column: Returns one boundary with proper min/max constraints
 * - Very wide/narrow columns: Supported with a fixed resize floor
 *
 * @param measure - Table measurement containing column widths
 * @returns Array of column boundary metadata, one per column
 */
function generateColumnBoundaries(measure: TableMeasure, effectiveWidths?: number[]): TableColumnBoundary[] {
  const boundaries: TableColumnBoundary[] = [];
  const cellSpacingPx = measure.cellSpacingPx ?? 0;
  let xPosition = cellSpacingPx; // space before first column
  const widths = effectiveWidths ?? measure.columnWidths;

  for (let i = 0; i < widths.length; i++) {
    const width = widths[i];
    const minWidth = calculateColumnMinWidth(width);

    const boundary = {
      index: i,
      x: xPosition,
      width,
      minWidth,
      resizable: true, // All columns resizable initially
    };

    boundaries.push(boundary);

    // Next boundary is after this column plus spacing (border-spacing between columns)
    xPosition += width + cellSpacingPx;
  }

  return boundaries;
}

/**
 * Generate row boundary metadata for interactive table row resizing.
 *
 * Creates metadata that enables the overlay component to position horizontal
 * resize handles and enforce minimum height constraints during drag operations.
 *
 * Boundaries are marked non-resizable when:
 * - A cell in the row above has a rowSpan that crosses the boundary
 * - The row is a repeated header on a continuation fragment (resize originals only)
 *
 * @param measure - Table measurement containing row heights
 * @param block - Table block (used for content height inspection)
 * @param fromRow - Starting body row index (inclusive)
 * @param toRow - Ending body row index (exclusive)
 * @param repeatHeaderCount - Number of repeated header rows on this fragment
 * @param cellSpacingPx - Cell spacing in pixels (border-spacing)
 * @returns Array of row boundary metadata
 */
function generateRowBoundaries(
  measure: TableMeasure,
  block: TableBlock,
  fromRow: number,
  toRow: number,
  repeatHeaderCount: number,
  cellSpacingPx: number,
  blockedBoundaries: Uint8Array,
  partialRow?: PartialRowInfo | null,
): TableRowBoundary[] {
  const boundaries: TableRowBoundary[] = [];

  // Build ordered list of rendered rows: headers first, then body rows
  const renderedRows: Array<{ rowIndex: number; isRepeatedHeader: boolean }> = [];
  if (repeatHeaderCount > 0) {
    for (let r = 0; r < repeatHeaderCount && r < measure.rows.length; r++) {
      renderedRows.push({ rowIndex: r, isRepeatedHeader: fromRow > 0 });
    }
  }
  for (let r = fromRow; r < toRow && r < measure.rows.length; r++) {
    renderedRows.push({ rowIndex: r, isRepeatedHeader: false });
  }

  let yPosition = cellSpacingPx;
  for (let ri = 0; ri < renderedRows.length; ri++) {
    const { rowIndex, isRepeatedHeader } = renderedRows[ri];
    const rowMeasure = measure.rows[rowIndex];
    if (!rowMeasure) continue;

    const isPartial = partialRow?.rowIndex === rowIndex;
    const height = isPartial ? partialRow.partialHeight : rowMeasure.height;
    const contentHeight = getRowContentHeight(block.rows[rowIndex], rowMeasure);
    const minHeight = isPartial ? Math.max(1, height) : Math.max(ROW_MIN_HEIGHT_PX, contentHeight);

    // A boundary is resizable unless:
    // 1. It's a repeated header on a continuation fragment
    // 2. A rowspan crosses this boundary (blockedBoundaries)
    const resizable = !isRepeatedHeader && !isPartial && blockedBoundaries[rowIndex] !== 1;

    boundaries.push({
      index: rowIndex,
      y: yPosition,
      height,
      minHeight,
      resizable,
    });

    yPosition += height + cellSpacingPx;
  }

  return boundaries;
}

/**
 * Count contiguous header rows from the beginning of the table.
 *
 * Header rows are identified by the `repeatHeader` attribute in tableRowProperties.
 * Only contiguous header rows from row 0 are counted; the first non-header row
 * terminates the count.
 *
 * @param block - Table block containing rows and attributes
 * @returns Number of contiguous header rows from row 0
 */
function countHeaderRows(block: TableBlock): number {
  let count = 0;
  for (let i = 0; i < block.rows.length; i++) {
    const row = block.rows[i];
    const repeatHeader = row.attrs?.tableRowProperties?.repeatHeader;
    if (repeatHeader === true) {
      count++;
    } else {
      // Stop at first non-header row
      break;
    }
  }
  return count;
}

/**
 * Extend the declared header row count to fully cover any rowSpan (w:vMerge)
 * that starts in a header row but reaches past it into non-header rows.
 *
 * Word repeats a vertically-merged cell in its entirety when it starts inside
 * a repeated header, so the row(s) it merges into are implicitly part of the
 * repeated header even when not individually flagged `repeatHeader`. Without
 * this, a header row's rowspan cell renders at its full merged height while
 * the header-repeat paint loop only advances past the declared header rows,
 * leaving the merged cell overlapping the body content painted right after.
 *
 * The scan is transitive: a row pulled in only because a merge from above
 * reaches into it may itself have a rowSpan reaching further down (chained
 * merges), so `count` grows in place and the loop bound (`r < count`) is
 * re-evaluated each iteration until nothing new is pulled in.
 *
 * @param block - Table block containing rows and attributes
 * @param measure - Table measurements, providing per-row cell rowSpans
 * @param headerCount - Declared header row count from countHeaderRows()
 * @returns Effective header row count, extended to cover crossing rowSpans
 */
function computeEffectiveHeaderCount(block: TableBlock, measure: TableMeasure, headerCount: number): number {
  let count = headerCount;
  for (let r = 0; r < count; r += 1) {
    for (const cell of measure.rows[r]?.cells ?? []) {
      const rowSpan = cell.rowSpan ?? 1;
      count = Math.max(count, r + rowSpan);
    }
  }
  return Math.min(count, block.rows.length);
}

/**
 * Find the largest repeatable header prefix that does not cut through a
 * vertical merge.
 *
 * When a later header row continues on a new page, we normally repeat only the
 * completed header prefix. That prefix must be self-contained: if any row
 * inside it has a cell whose rowSpan reaches past the prefix boundary, the
 * painter would still render the merged cell at its full height and overlap the
 * continued row below. In that case, we fall back to the largest shorter prefix
 * that is rowspan-safe, or 0 if every non-empty prefix would cut a merge.
 *
 * @param measure - Table measurements, providing per-row cell rowSpans
 * @param maxCount - Maximum prefix length under consideration
 * @returns Largest safe prefix length in the range [0, maxCount]
 */
function computeSelfContainedHeaderPrefix(measure: TableMeasure, maxCount: number): number {
  const cappedMaxCount = Math.max(0, Math.min(maxCount, measure.rows.length));

  for (let candidate = cappedMaxCount; candidate > 0; candidate -= 1) {
    let crossesBoundary = false;

    for (let r = 0; r < candidate && !crossesBoundary; r += 1) {
      for (const cell of measure.rows[r]?.cells ?? []) {
        const rowSpan = cell.rowSpan ?? 1;
        if (r + rowSpan > candidate) {
          crossesBoundary = true;
          break;
        }
      }
    }

    if (!crossesBoundary) {
      return candidate;
    }
  }

  return 0;
}

/**
 * Sum row heights for a given range.
 *
 * @param rows - Array of measured table rows
 * @param fromRow - Starting row index (inclusive)
 * @param toRow - Ending row index (exclusive)
 * @returns Total height in pixels
 */
function sumRowHeights(rows: TableRowMeasure[], fromRow: number, toRow: number): number {
  let total = 0;
  for (let i = fromRow; i < toRow && i < rows.length; i++) {
    total += rows[i].height;
  }
  return total;
}

/**
 * Compute the rendered height of a table fragment, including repeated headers,
 * body rows, cell spacing, and outer borders.
 *
 * CRITICAL: Used for cursor advancement and fragment positioning. All three
 * partial-row fragment paths (continuation, forced-split, normal) must use this
 * function to stay aligned with `renderTableFragment.ts`.
 *
 * When `partialRow` is provided, its `partialHeight` is substituted for the
 * measured row height at `partialRow.rowIndex`.
 */
function computeFragmentHeight(
  measure: TableMeasure,
  fromRow: number,
  toRow: number,
  repeatHeaderCount: number,
  borderCollapse?: 'collapse' | 'separate',
  partialRow?: PartialRowInfo | null,
): number {
  let height = 0;
  let rowCount = 0;

  // Repeated headers
  if (repeatHeaderCount > 0) {
    height += sumRowHeights(measure.rows, 0, repeatHeaderCount);
    rowCount += repeatHeaderCount;
  }

  // Body rows — substitute partialRow height when applicable
  for (let i = fromRow; i < toRow && i < measure.rows.length; i++) {
    if (partialRow && partialRow.rowIndex === i) {
      height += partialRow.partialHeight;
    } else {
      height += measure.rows[i].height;
    }
    rowCount++;
  }

  // Cell spacing: gaps before first row, between rows, and after last row
  const cellSpacingPx = measure.cellSpacingPx ?? 0;
  if (rowCount > 0 && cellSpacingPx > 0) {
    height += (rowCount + 1) * cellSpacingPx;
  }

  // Outer border height when border-collapse is separate
  if (rowCount > 0 && measure.tableBorderWidths && borderCollapse === 'separate') {
    height += measure.tableBorderWidths.top + measure.tableBorderWidths.bottom;
  }

  return height;
}

/**
 * Return the height Word uses for the pagination fit decision.
 *
 * Collapsed borders do not grow the DOM table box, so `computeFragmentHeight`
 * intentionally excludes them from fragment geometry. Word nevertheless
 * reserves the authored terminal bottom border before admitting the final row
 * to a page. Keeping that budget in the fit plane (and out of the paint plane)
 * avoids a one-pixel geometry inflation while preserving Word's boundary
 * decision for rows that otherwise fit by only a few twips.
 */
function computeFragmentFitHeight(
  measure: TableMeasure,
  fromRow: number,
  toRow: number,
  repeatHeaderCount: number,
  borderCollapse?: 'collapse' | 'separate',
  partialRow?: PartialRowInfo | null,
): number {
  const fragmentHeight = computeFragmentHeight(measure, fromRow, toRow, repeatHeaderCount, borderCollapse, partialRow);
  if (borderCollapse !== 'collapse' || toRow < measure.rows.length) {
    return fragmentHeight;
  }
  return fragmentHeight + (measure.tableBorderWidths?.bottom ?? 0);
}

type SplitPointResult = {
  endRow: number; // Exclusive row index (next row after last included)
  partialRow: PartialRowInfo | null; // Null for row-boundary splits, PartialRowInfo for mid-row splits
};

/**
 * Minimum height in pixels required to render a partial row.
 * Below this threshold, we don't attempt mid-row splits as there's
 * insufficient space to render even a single line of text.
 */
const MIN_PARTIAL_ROW_HEIGHT = 20;

/**
 * Get the line segments for a single embedded table row.
 *
 * If any cell in the row contains nested tables, recursively expand using
 * the tallest cell's segments. This enables the layout engine to split at
 * sub-row boundaries even for deeply nested tables (table-in-table-in-table).
 * Otherwise, return the row as a single segment with its measured height.
 */
export function getEmbeddedRowLines(row: TableRowMeasure): Array<{ lineHeight: number }> {
  // Check if any cell has nested table blocks
  const hasNestedTable = row.cells.some((cell) => cell.blocks?.some((b) => b.kind === 'table'));

  if (!hasNestedTable) {
    // Simple case: no nested tables, row is one segment
    return [{ lineHeight: row.height || 0 }];
  }

  // Recursive case: find the cell with the most segments (tallest content)
  let tallestLines: Array<{ lineHeight: number }> = [];
  for (const cell of row.cells) {
    const cellLines = getCellLines(cell);
    if (cellLines.length > tallestLines.length) {
      tallestLines = cellLines;
    }
  }

  return tallestLines.length > 0 ? tallestLines : [{ lineHeight: row.height || 0 }];
}

export function getCellLines(cell: TableRowMeasure['cells'][number]): Array<{ lineHeight: number }> {
  // Multi-block cells use the `blocks` array
  if (cell.blocks && cell.blocks.length > 0) {
    const allLines: Array<{ lineHeight: number }> = [];
    for (const block of cell.blocks) {
      if (block.kind === 'paragraph') {
        if ('lines' in block) {
          const paraBlock = block as ParagraphMeasure;
          if (paraBlock.lines) {
            allLines.push(...paraBlock.lines);
          }
        }
      } else if (block.kind === 'table') {
        // Embedded tables: expand individual rows as separate segments so the
        // outer table splitter can break at embedded-table row boundaries,
        // matching MS Word behavior where nested tables paginate across pages.
        // Recursively expand rows that contain further nested tables.
        const tableBlock = block as TableMeasure;
        for (const row of tableBlock.rows) {
          allLines.push(...getEmbeddedRowLines(row));
        }
      } else {
        // Non-paragraph blocks (images, drawings) are represented as a single
        // unsplittable segment with their full height. This ensures computePartialRow
        // accounts for their height when splitting rows across pages.
        const blockHeight = 'height' in block ? (block as { height: number }).height : 0;
        if (blockHeight > 0) {
          allLines.push({ lineHeight: blockHeight });
        }
      }
    }
    return allLines;
  }

  // Fallback to single paragraph (backward compatibility)
  if (cell.paragraph?.lines) {
    return cell.paragraph.lines;
  }

  return [];
}

type CellPadding = { top: number; bottom: number; left: number; right: number };

function getCellPadding(cellIdx: number, blockRow?: TableRow): CellPadding {
  const padding = blockRow?.cells?.[cellIdx]?.attrs?.padding ?? {};
  return {
    top: padding.top ?? 0,
    bottom: padding.bottom ?? 0,
    left: padding.left ?? 4,
    right: padding.right ?? 4,
  };
}

/**
 * Get total line count for a cell across all its paragraph blocks.
 *
 * @param cell - Cell measure
 * @returns Total number of lines
 */
function getCellTotalLines(cell: TableRowMeasure['cells'][number]): number {
  return getCellLines(cell).length;
}

const ROW_HEIGHT_EPSILON = 0.1;

function getRowContentHeight(blockRow: TableRow | undefined, rowMeasure: TableRowMeasure): number {
  let contentHeight = 0;
  for (let cellIdx = 0; cellIdx < rowMeasure.cells.length; cellIdx++) {
    const cell = rowMeasure.cells[cellIdx];
    const cellPadding = getCellPadding(cellIdx, blockRow);
    const paddingTotal = cellPadding.top + cellPadding.bottom;
    const cellBlock = blockRow?.cells?.[cellIdx];
    // Use the allocation-free fast path — this runs on every row.
    const sliceHeight = computeFullCellContentHeight(cell, cellBlock, cellPadding);
    contentHeight = Math.max(contentHeight, sliceHeight + paddingTotal);
  }
  return contentHeight;
}

function hasExplicitRowHeightSlack(blockRow: TableRow | undefined, rowMeasure: TableRowMeasure): boolean {
  const rowHeightSpec = blockRow?.attrs?.rowHeight;
  if (!rowHeightSpec || rowHeightSpec.value == null || !Number.isFinite(rowHeightSpec.value)) {
    return false;
  }

  const contentHeight = getRowContentHeight(blockRow, rowMeasure);
  return rowMeasure.height > contentHeight + ROW_HEIGHT_EPSILON;
}

/**
 * ProseMirror range representing a contiguous span of document positions.
 *
 * Used to track which portion of the ProseMirror document a table fragment
 * corresponds to, enabling accurate selection and editing of table content.
 *
 * @property pmStart - Absolute ProseMirror position (inclusive) where the range begins
 * @property pmEnd - Absolute ProseMirror position (exclusive) where the range ends
 */
type PmRange = { pmStart?: number; pmEnd?: number };

/**
 * Merge a source PmRange into a target PmRange, expanding the target to include the source.
 *
 * This function performs a union operation on two ranges by taking the minimum start
 * position and maximum end position. It handles undefined values gracefully, treating
 * them as unbounded in that direction.
 *
 * The target range is mutated in place for efficiency during aggregation of multiple ranges.
 *
 * @param target - The range to be expanded (mutated in place)
 * @param range - The source range to merge into the target
 *
 * @example
 * ```typescript
 * const target: PmRange = { pmStart: 10, pmEnd: 20 };
 * const range: PmRange = { pmStart: 15, pmEnd: 25 };
 * mergePmRange(target, range);
 * // target is now { pmStart: 10, pmEnd: 25 }
 * ```
 *
 * @example
 * ```typescript
 * // Handles undefined values
 * const target: PmRange = {};
 * const range: PmRange = { pmStart: 5, pmEnd: 10 };
 * mergePmRange(target, range);
 * // target is now { pmStart: 5, pmEnd: 10 }
 * ```
 */
function mergePmRange(target: PmRange, range: PmRange): void {
  if (typeof range.pmStart === 'number') {
    target.pmStart = target.pmStart == null ? range.pmStart : Math.min(target.pmStart, range.pmStart);
  }
  if (typeof range.pmEnd === 'number') {
    target.pmEnd = target.pmEnd == null ? range.pmEnd : Math.max(target.pmEnd, range.pmEnd);
  }
}

/**
 * Compute the ProseMirror range for a subset of lines within a table cell.
 *
 * Table cells can contain multiple blocks (paragraphs, images, etc.). This function
 * calculates which portion of the cell's content falls within the specified line range,
 * accounting for multi-block cells by accumulating line counts across blocks.
 *
 * Edge cases handled:
 * - Undefined cell or cellMeasure: Returns empty range
 * - Mismatched block counts: Uses minimum of both arrays to avoid out-of-bounds errors
 * - Lines spanning multiple blocks: Correctly maps global line indices to block-local indices
 * - Non-paragraph blocks: Includes their full PM range if within the line range
 *
 * @param cell - The table cell block data containing content blocks
 * @param cellMeasure - The measured cell data containing line information
 * @param fromLine - Starting line index (inclusive, 0-based) across all blocks in the cell
 * @param toLine - Ending line index (exclusive) across all blocks in the cell
 * @returns PmRange covering the specified lines, or empty range if cell is invalid
 *
 * @remarks
 * When cellBlocks.length !== blockMeasures.length, the function uses the minimum of both
 * lengths to prevent array access errors. This mismatch can occur during incremental
 * updates or measurement failures. The function gracefully handles this by processing
 * only the valid overlapping blocks.
 *
 * @example
 * ```typescript
 * // Single-block cell with 3 lines, requesting lines 0-2
 * const cell = { paragraph: { kind: 'paragraph', runs: [...] } };
 * const cellMeasure = { paragraph: { kind: 'paragraph', lines: [{...}, {...}, {...}] } };
 * const range = computeCellPmRange(cell, cellMeasure, 0, 2);
 * // range covers lines 0-1 (exclusive end)
 * ```
 *
 * @example
 * ```typescript
 * // Multi-block cell with lines spanning blocks
 * const cell = { blocks: [para1, para2] }; // para1 has 3 lines, para2 has 2 lines
 * const cellMeasure = { blocks: [measure1, measure2] };
 * const range = computeCellPmRange(cell, cellMeasure, 2, 4);
 * // range covers line 2 from para1 and line 0 from para2
 * ```
 */
function computeCellPmRange(
  cell: TableRow['cells'][number] | undefined,
  cellMeasure: TableRowMeasure['cells'][number] | undefined,
  fromLine: number,
  toLine: number,
): PmRange {
  const range: PmRange = {};
  if (!cell || !cellMeasure) return range;

  const cellBlocks = cell.blocks ?? (cell.paragraph ? [cell.paragraph] : []);
  const blockMeasures = cellMeasure.blocks ?? (cellMeasure.paragraph ? [cellMeasure.paragraph] : []);

  // Use minimum length to handle mismatched data gracefully
  // This can occur during incremental updates or if measurement fails for some blocks
  const maxBlocks = Math.min(cellBlocks.length, blockMeasures.length);

  let cumulativeLineCount = 0;
  for (let i = 0; i < maxBlocks; i++) {
    const block = cellBlocks[i];
    const blockMeasure = blockMeasures[i];

    if (blockMeasure.kind === 'paragraph' && block?.kind === 'paragraph') {
      const paraMeasure = blockMeasure as ParagraphMeasure;
      const lines = paraMeasure.lines;
      const blockLineCount = lines?.length ?? 0;
      const blockStartGlobal = cumulativeLineCount;
      const blockEndGlobal = cumulativeLineCount + blockLineCount;

      const localFrom = Math.max(fromLine, blockStartGlobal) - blockStartGlobal;
      const localTo = Math.min(toLine, blockEndGlobal) - blockStartGlobal;

      if (lines && lines.length > 0 && localFrom < localTo) {
        // Use line-level PM range computation when lines are available
        mergePmRange(range, computeFragmentPmRange(block as ParagraphBlock, lines, localFrom, localTo));
      } else {
        // Fallback to block-level PM range when no lines or no overlap
        // This handles cases where the paragraph has PM range in attrs but no line data
        mergePmRange(range, extractBlockPmRange(block as { attrs?: Record<string, unknown> }));
      }

      cumulativeLineCount += blockLineCount;
      continue;
    }

    // Non-paragraph blocks: advance cumulative count to stay aligned with getCellLines().
    // Embedded tables expand to N segments (recursively, matching getEmbeddedRowLines);
    // images/drawings are 1 segment.
    if (blockMeasure.kind === 'table') {
      const tableMeasure = blockMeasure as TableMeasure;
      let tableSegments = 0;
      for (const row of tableMeasure.rows) {
        tableSegments += getEmbeddedRowLines(row).length;
      }
      const blockStart = cumulativeLineCount;
      const blockEnd = cumulativeLineCount + tableSegments;
      // Only include PM range if this block overlaps the requested line range
      if (blockStart < toLine && blockEnd > fromLine) {
        mergePmRange(range, extractBlockPmRange(block as { attrs?: Record<string, unknown> }));
      }
      cumulativeLineCount += tableSegments;
    } else {
      // Images, drawings: 1 segment each
      const blockStart = cumulativeLineCount;
      cumulativeLineCount += 1;
      if (blockStart < toLine && blockStart >= fromLine) {
        mergePmRange(range, extractBlockPmRange(block as { attrs?: Record<string, unknown> }));
      }
    }
  }

  return range;
}

/**
 * Compute the ProseMirror range for a table fragment spanning multiple rows.
 *
 * Aggregates PM ranges from all cells within the fragment, handling both full rows
 * and partial row splits (mid-row page breaks). For partial rows, consults the
 * partialRow metadata to determine which lines to include from each cell.
 *
 * Edge cases handled:
 * - Missing row or rowMeasure data: Skips invalid rows
 * - Mismatched cell counts: Uses minimum of both arrays
 * - Partial row with out-of-bounds cellIndex: Validates array access before reading fromLineByCell/toLineByCell
 * - Invalid line indices: Clamps to valid range and ensures toLine >= fromLine
 * - Empty cells (no lines): Gracefully handles totalLines = 0
 *
 * @param block - The table block containing row and cell data
 * @param measure - The table measurements containing cell line information
 * @param fromRow - Starting row index (inclusive, 0-based)
 * @param toRow - Ending row index (exclusive)
 * @param partialRow - Optional partial row metadata for mid-row splits
 * @returns Aggregated PmRange covering all included content
 *
 * @remarks
 * Partial row handling: When a row is split across pages, partialRow specifies
 * which lines to include from each cell via fromLineByCell and toLineByCell arrays.
 * These arrays are indexed by cellIndex. If cellIndex exceeds the array bounds,
 * the function defaults to including all lines (0 to totalLines), preventing errors.
 *
 * Line index validation: The function clamps fromLine and toLine to [0, totalLines]
 * and ensures toLine >= fromLine. This handles edge cases where partialRow metadata
 * contains invalid indices (e.g., from corrupt state or race conditions).
 *
 * @example
 * ```typescript
 * // Full table fragment (rows 0-2)
 * const range = computeTableFragmentPmRange(block, measure, 0, 2);
 * // range covers all content in rows 0 and 1
 * ```
 *
 * @example
 * ```typescript
 * // Partial row fragment (row 1, lines 2-5 from each cell)
 * const partialRow = {
 *   rowIndex: 1,
 *   fromLineByCell: [2, 2],
 *   toLineByCell: [5, 5],
 *   isFirstPart: false,
 *   isLastPart: false,
 *   partialHeight: 60
 * };
 * const range = computeTableFragmentPmRange(block, measure, 1, 2, partialRow);
 * // range covers only lines 2-4 (exclusive end) from each cell in row 1
 * ```
 */
function computeTableFragmentPmRange(
  block: TableBlock,
  measure: TableMeasure,
  fromRow: number,
  toRow: number,
  partialRow?: PartialRowInfo,
): PmRange {
  const range: PmRange = {};

  for (let rowIndex = fromRow; rowIndex < toRow; rowIndex++) {
    const row = block.rows[rowIndex];
    const rowMeasure = measure.rows[rowIndex];
    if (!row || !rowMeasure) continue;

    const isPartial = partialRow?.rowIndex === rowIndex;
    const cellCount = Math.min(row.cells.length, rowMeasure.cells.length);

    for (let cellIndex = 0; cellIndex < cellCount; cellIndex++) {
      const cell = row.cells[cellIndex];
      const cellMeasure = rowMeasure.cells[cellIndex];
      if (!cell || !cellMeasure) continue;

      const totalLines = getCellTotalLines(cellMeasure);
      let fromLine = 0;
      let toLine = totalLines;

      if (isPartial) {
        // Validate cellIndex is within bounds before accessing arrays
        // This prevents errors when partialRow metadata is inconsistent with actual cell count
        const hasValidFromLineByCell = partialRow?.fromLineByCell && cellIndex < partialRow.fromLineByCell.length;
        const hasValidToLineByCell = partialRow?.toLineByCell && cellIndex < partialRow.toLineByCell.length;

        if (hasValidFromLineByCell) {
          const rawFrom = partialRow.fromLineByCell[cellIndex];
          if (typeof rawFrom === 'number' && rawFrom >= 0) {
            fromLine = rawFrom;
          }
        }

        if (hasValidToLineByCell) {
          const rawTo = partialRow.toLineByCell[cellIndex];
          if (typeof rawTo === 'number') {
            toLine = rawTo === -1 ? totalLines : rawTo;
          }
        }
      }

      // Clamp line indices to valid range
      fromLine = Math.max(0, Math.min(fromLine, totalLines));
      toLine = Math.max(0, Math.min(toLine, totalLines));
      if (toLine < fromLine) {
        toLine = fromLine;
      }

      mergePmRange(range, computeCellPmRange(cell, cellMeasure, fromLine, toLine));
    }
  }

  return range;
}

/**
 * Apply computed ProseMirror range to a table fragment.
 *
 * Mutates the fragment by setting its pmStart and pmEnd properties based on the
 * content it contains. This enables the overlay component to map fragment coordinates
 * back to ProseMirror document positions for selection and editing.
 *
 * The function computes the range by aggregating PM positions from all cells within
 * the fragment's row range, handling both full rows and partial row splits.
 *
 * @param fragment - The table fragment to annotate with PM range (mutated in place)
 * @param block - The table block containing row and cell data
 * @param measure - The table measurements containing cell line information
 *
 * @remarks
 * This function is called for every table fragment created during layout, including:
 * - Single-page tables (one fragment covering all rows)
 * - Multi-page tables (multiple fragments with row ranges)
 * - Partial row fragments (fragments with mid-row page breaks)
 *
 * The computed range is inclusive for pmStart and exclusive for pmEnd, matching
 * ProseMirror's position semantics.
 *
 * @example
 * ```typescript
 * const fragment: TableFragment = {
 *   kind: 'table',
 *   blockId: 'table-1',
 *   fromRow: 0,
 *   toRow: 3,
 *   x: 0,
 *   y: 0,
 *   width: 400,
 *   height: 150
 * };
 * applyTableFragmentPmRange(fragment, block, measure);
 * // fragment now has pmStart and pmEnd set based on rows 0-2 content
 * ```
 */
function applyTableFragmentPmRange(fragment: TableFragment, block: TableBlock, measure: TableMeasure): void {
  const range = computeTableFragmentPmRange(block, measure, fragment.fromRow, fragment.toRow, fragment.partialRow);
  if (range.pmStart != null) {
    fragment.pmStart = range.pmStart;
  }
  if (range.pmEnd != null) {
    fragment.pmEnd = range.pmEnd;
  }
}

/**
 * Compute partial row split information for rows that don't fit.
 *
 * When a row exceeds the available height and cantSplit is not set,
 * this function calculates where to split within the row by advancing
 * each cell independently based on its available line height.
 *
 * Algorithm:
 *
 * 1. For each cell, calculate available height for lines (subtract padding)
 * 2. Find cumulative line heights and determine initial cutoff point per cell
 * 3. Use each cell's fitted line height independently (no line-count normalization)
 * 4. Row fragment height is the max of fitted cell heights + padding
 *
 * Rationale:
 * Each cell should render as many lines as fit within the available height. Forcing
 * all cells to advance the same number of lines can prematurely truncate taller cells
 * when neighboring cells have fewer lines (e.g., one column overflows, another does not).
 * This manifests as a border drawn after the first line in the overflowing cell.
 *
 * @param rowIndex - Index of the row to split
 * @param blockRow - Table row data for accessing cell attributes (padding, etc.)
 * @param measure - Table measurements with cell line data
 * @param availableHeight - Available vertical space for the partial row
 * @param fromLineByCell - Starting line indices per cell (for continuations)
 * @returns PartialRowInfo with line cutoffs per cell, partial height, and split flags
 */
function computePartialRow(
  rowIndex: number,
  blockRow: TableRow | undefined,
  measure: TableMeasure,
  availableHeight: number,
  fromLineByCell?: number[],
  fullPageHeight?: number,
): PartialRowInfo {
  const row = measure.rows[rowIndex];
  if (!row) {
    throw new Error(`Invalid rowIndex ${rowIndex}: measure.rows has ${measure.rows.length} rows`);
  }
  const cellCount = row.cells.length;

  // Initialize fromLineByCell if not provided (first part of split)
  const startLines = fromLineByCell || new Array(cellCount).fill(0);

  const toLineByCell: number[] = [];
  const heightByCell: number[] = [];

  // Capture cell paddings to keep height math aligned with rendering
  const cellPaddings = row.cells.map((_, idx: number) => getCellPadding(idx, blockRow));

  // First pass: find cutoff for each cell based on available height.
  // Uses block-aware height from the cell slice cursor so that paragraph
  // spacing.before, totalHeight promotion, and spacing.after are included
  // in the fit check — matching what the DOM painter actually renders.
  for (let cellIdx = 0; cellIdx < cellCount; cellIdx++) {
    const cell = row.cells[cellIdx];
    const startLine = startLines[cellIdx] || 0;

    // Calculate available height for lines (subtract this cell's padding)
    const cellPadding = cellPaddings[cellIdx];
    const availableForLines = Math.max(0, availableHeight - (cellPadding.top + cellPadding.bottom));

    // Build block descriptors and cursor for block-aware height accumulation
    const cellBlock = blockRow?.cells?.[cellIdx];
    const blocks = describeCellRenderBlocks(cell, cellBlock, cellPadding);
    const cursor = createCellSliceCursor(blocks, startLine);

    // Get all lines for index bookkeeping (line indices remain unchanged)
    const lines = getCellLines(cell);
    let cumulativeHeight = 0;
    let cutLine = startLine;

    for (let i = startLine; i < lines.length; i++) {
      const lineCost = cursor.advanceLine(i);
      if (cumulativeHeight + lineCost > availableForLines) {
        // Force progress: only when the minimum rendered cost of this segment
        // exceeds a full page height. This accounts for spacing.before and
        // totalHeight promotion that can make a segment over-tall even when
        // the raw line height alone would fit.
        // When availableForLines === 0 (e.g. headers consumed the budget and
        // cell padding exceeded the remainder), we do NOT force here — that
        // would advance line indices for lines rendered with zero content
        // height, permanently dropping content. Instead, the caller retries
        // without headers (retryWithoutHeaders flag in the layout loop).
        if (
          cumulativeHeight === 0 &&
          i === startLine &&
          availableForLines > 0 &&
          fullPageHeight != null &&
          cursor.minSegmentCost(i) > fullPageHeight
        ) {
          // Cap height to available space — overflow:hidden on the cell clips the rest.
          cumulativeHeight += Math.min(lineCost, availableForLines);
          cutLine = i + 1;
        }
        break;
      }
      cumulativeHeight += lineCost;
      cutLine = i + 1; // Exclusive index
    }

    toLineByCell.push(cutLine);
    heightByCell.push(cumulativeHeight);
  }

  let actualPartialHeight = 0;
  let maxPaddingTotal = 0;
  for (let cellIdx = 0; cellIdx < cellCount; cellIdx++) {
    const cellPadding = cellPaddings[cellIdx];
    const paddingTotal = cellPadding.top + cellPadding.bottom;
    maxPaddingTotal = Math.max(maxPaddingTotal, paddingTotal);
    actualPartialHeight = Math.max(actualPartialHeight, heightByCell[cellIdx] + paddingTotal);
  }

  // CRITICAL: Check if we made any progress (advanced any lines)
  const madeProgress = toLineByCell.some((cutLine, idx: number) => cutLine > (startLines[idx] || 0));

  const isFirstPart = startLines.every((l) => l === 0);

  // Determine if this is the last part (all cells exhausted OR no progress made)
  const allCellsExhausted = toLineByCell.every((cutLine, idx: number) => {
    const totalLines = getCellTotalLines(row.cells[idx]);
    return cutLine >= totalLines;
  });
  const isLastPart = allCellsExhausted || !madeProgress;

  // Ensure the partial height includes at least padding when we have content to render
  if (actualPartialHeight === 0 && isFirstPart) {
    actualPartialHeight = maxPaddingTotal;
  }

  return {
    rowIndex,
    fromLineByCell: startLines,
    toLineByCell,
    isFirstPart,
    isLastPart,
    partialHeight: actualPartialHeight,
  };
}

/**
 * Find the split point for table rows given available height and constraints.
 *
 * Algorithm:
 * 1. Iterate rows from startRow, accumulating heights
 * 2. Check cantSplit attribute for each row
 * 3. Return endRow (exclusive) where split should occur
 * 4. For rows that don't fit AND don't have cantSplit, split mid-row using computePartialRow()
 * 5. For over-tall rows (row > fullPageHeight), force mid-row split even with cantSplit
 *
 * MS Word Behavior:
 * - Default: Rows CAN break across pages (cantSplit = false by default)
 * - When a row doesn't fit and cantSplit is false, Word splits mid-row at line boundaries
 * - cantSplit = true prevents mid-row splitting; row moves to next page
 * - Even with cantSplit, rows taller than a full page must split
 *
 * @param block - Table block
 * @param measure - Table measurements
 * @param startRow - Starting row index (inclusive)
 * @param availableHeight - Available vertical space
 * @param fullPageHeight - Full page height (for detecting over-tall rows)
 * @param pendingPartialRow - If continuing a partial row from previous page
 * @returns Split point result with endRow and partialRow
 */
function findSplitPoint(
  block: TableBlock,
  measure: TableMeasure,
  startRow: number,
  availableHeight: number,
  fullPageHeight?: number,
  _pendingPartialRow?: PartialRowInfo | null,
): SplitPointResult {
  let lastFitRow = startRow; // Last row that fit completely (exclusive end index)
  const borderCollapse = block.attrs?.borderCollapse ?? (block.attrs?.cellSpacing != null ? 'separate' : 'collapse');

  for (let i = startRow; i < block.rows.length; i++) {
    const row = block.rows[i];
    const rowMeasure = measure.rows[i];
    const rowHeight = rowMeasure?.height || 0;
    let cantSplit = row.attrs?.tableRowProperties?.cantSplit === true;
    if (rowMeasure && hasExplicitRowHeightSlack(row, rowMeasure) && (!fullPageHeight || rowHeight <= fullPageHeight)) {
      cantSplit = true;
    }

    // Check if this row fits: use full fragment height (rows + spacing + borders) so pagination matches render
    const fragmentHeightWithRow = computeFragmentFitHeight(measure, startRow, i + 1, 0, borderCollapse);
    if (fragmentHeightWithRow <= availableHeight) {
      // Row fits completely
      lastFitRow = i + 1; // Next row index (exclusive)
    } else {
      // Row doesn't fit completely; remaining space after last full row set.
      // When lastFitRow === startRow (first row doesn't fit), no rows have been placed yet, so
      // we must subtract the vertical space that appears before the first row (top spacing + top border)
      // instead of using computeFragmentHeight(startRow, startRow) which is 0.
      let remainingHeight = availableHeight - computeFragmentHeight(measure, startRow, lastFitRow, 0, borderCollapse);
      if (lastFitRow === startRow) {
        const cellSpacingPx = measure.cellSpacingPx ?? 0;
        const topBorderPx =
          borderCollapse === 'separate' && measure.tableBorderWidths ? measure.tableBorderWidths.top : 0;
        remainingHeight = availableHeight - cellSpacingPx - topBorderPx;
      }

      // Check if this is an over-tall row (exceeds full page height) - force split regardless of cantSplit
      // This handles edge case where a row is taller than an entire page
      if (fullPageHeight && rowHeight > fullPageHeight) {
        const partialRow = computePartialRow(i, block.rows[i], measure, remainingHeight, undefined, fullPageHeight);
        return { endRow: i + 1, partialRow };
      }

      // If row has cantSplit, don't split it - break before this row
      if (cantSplit) {
        // If we haven't fit any rows yet, return startRow to trigger page advance
        if (lastFitRow === startRow) {
          return { endRow: startRow, partialRow: null };
        }
        // Break before the cantSplit row
        return { endRow: lastFitRow, partialRow: null };
      }

      // Row doesn't have cantSplit - try to split mid-row (MS Word default behavior)
      // Only split if we have meaningful space (at least MIN_PARTIAL_ROW_HEIGHT for one line)
      if (remainingHeight >= MIN_PARTIAL_ROW_HEIGHT) {
        const partialRow = computePartialRow(i, block.rows[i], measure, remainingHeight, undefined, fullPageHeight);

        // Check if we can actually fit any lines
        const hasContent = partialRow.toLineByCell.some(
          (cutLine: number, idx: number) => cutLine > (partialRow.fromLineByCell[idx] || 0),
        );

        if (hasContent) {
          // We can fit some content - do mid-row split
          return { endRow: i + 1, partialRow };
        }
      }

      return { endRow: lastFitRow, partialRow: null };
    }
  }

  // All remaining rows fit
  return { endRow: block.rows.length, partialRow: null };
}

function createFragmentMetadataGenerator(measure: TableMeasure, block: TableBlock) {
  // Keep span coverage local to one pagination pass: a merge can begin before
  // this fragment, and a later pass may reuse a measure after its rows change.
  const blockedBoundaries = new Uint8Array(measure.rows.length);
  let spanEnd = 0;
  for (let rowIndex = 0; rowIndex < measure.rows.length; rowIndex += 1) {
    for (const cell of measure.rows[rowIndex]?.cells ?? []) {
      const rowSpan = cell.rowSpan ?? 1;
      if (rowSpan > 1) spanEnd = Math.max(spanEnd, rowIndex + rowSpan - 1);
    }
    if (rowIndex < spanEnd) blockedBoundaries[rowIndex] = 1;
  }

  return (
    fromRow: number,
    toRow: number,
    repeatHeaderCount: number,
    effectiveWidths?: number[],
    partialRow?: PartialRowInfo | null,
  ): TableFragmentMetadata => ({
    columnBoundaries: generateColumnBoundaries(measure, effectiveWidths),
    rowBoundaries: generateRowBoundaries(
      measure,
      block,
      fromRow,
      toRow,
      repeatHeaderCount,
      measure.cellSpacingPx ?? 0,
      blockedBoundaries,
      partialRow,
    ),
    coordinateSystem: 'fragment',
  });
}

/**
 * Generate fragment metadata for a table fragment.
 *
 * Includes column boundaries and row boundaries for interactive resizing.
 *
 * @param measure - Table measurements
 * @param block - Table block (used for rowSpan and content height inspection)
 * @param fromRow - Starting body row index (inclusive)
 * @param toRow - Ending body row index (exclusive)
 * @param repeatHeaderCount - Number of repeated header rows on this fragment
 * @param effectiveWidths - Optional rescaled column widths
 * @returns Table fragment metadata
 */
export function generateFragmentMetadata(
  measure: TableMeasure,
  block: TableBlock,
  fromRow: number,
  toRow: number,
  repeatHeaderCount: number,
  effectiveWidths?: number[],
  partialRow?: PartialRowInfo | null,
): TableFragmentMetadata {
  return createFragmentMetadataGenerator(measure, block)(
    fromRow,
    toRow,
    repeatHeaderCount,
    effectiveWidths,
    partialRow,
  );
}

/**
 * Layout a table block with monolithic rendering (no splitting).
 *
 * Used for floating tables (tblpPr) which should not split across pages.
 *
 * @param context - Table layout context
 */
function layoutMonolithicTable(context: TableLayoutContext): void {
  let state = context.ensurePage();
  if (state.cursorY + context.measure.totalHeight > state.contentBottom && state.page.fragments.length > 0) {
    state = context.advanceColumn(state);
  }
  state = context.ensurePage();
  const height = Math.min(context.measure.totalHeight, state.contentBottom - state.cursorY);

  // Canonical projection attaches anchor.isAnchored to tblpPr tables, so
  // narrow floats return before this path and full-width floats paginate via
  // the inline path. Keep the layout contract defensive for callers that pass
  // floating properties without an anchor: monolithic placement consumes body
  // height, and therefore must break paragraph adjacency too.
  if (height > 0) {
    breakParagraphAdjacency(state);
  }

  const baseX = context.columnX(state);
  const baseWidth = Math.max(0, context.measure.totalWidth || context.columnWidth);
  const { x, width } = resolveTableFrame(baseX, context.columnWidth, baseWidth, context.block.attrs);
  const columnWidths = rescaleColumnWidths(context.measure.columnWidths, context.measure.totalWidth, width);

  const metadata = generateFragmentMetadata(
    context.measure,
    context.block,
    0,
    context.block.rows.length,
    0,
    columnWidths,
  );

  const fragment: TableFragment = {
    kind: 'table',
    blockId: context.block.id,
    columnIndex: state.columnIndex,
    fromRow: 0,
    toRow: context.block.rows.length,
    x,
    y: state.cursorY,
    width,
    height,
    metadata,
    columnWidths,
    sourceAnchor: context.block.sourceAnchor,
  };
  applyTableFragmentPmRange(fragment, context.block, context.measure);
  state.page.fragments.push(fragment);
  state.cursorY += height;
  state.maxCursorY = Math.max(state.maxCursorY, state.cursorY);
}

/**
 * Layout a table block with row-boundary and mid-row splitting.
 *
 * Implements MS Word-compatible table splitting:
 * - Breaks tables at row boundaries when exceeding page height
 * - Splits rows mid-content when cantSplit is false (default)
 * - Respects cantSplit attribute (prevents row from splitting)
 * - Repeats header rows on continuation fragments
 * - Handles floating tables (tblpPr) with monolithic layout
 * - Tracks partial row continuations across pages
 *
 * Algorithm:
 * 1. Detect floating tables → delegate to monolithic layout
 * 2. Count header rows
 * 3. Loop through rows, finding split points
 * 4. When a partial row split occurs, track it for continuation
 * 5. Create fragments with proper fromRow/toRow/repeatHeaderCount/partialRow
 * 6. Advance cursor by actual fragment height (not total table height)
 *
 * @param context - Table layout context

 */
export function* layoutTableBlockSteps({
  block,
  measure,
  columnWidth,
  ensurePage,
  advanceColumn,
  columnX,
  resumeCursor,
  onFragmentStart,
}: TableLayoutContext): Generator<TableLayoutStep, void, void> {
  // Anchored/floating tables are normally placed by the float manager when we layout their anchor
  // paragraph. Treat full-width floating tables as inline so they flow like normal tables and
  // don't create overlap or extra pages.
  let treatAsInline = false;
  if (block.anchor?.isAnchored) {
    treatAsInline = isAnchoredTableFullWidth(block, measure, columnWidth);
    if (!treatAsInline) {
      return;
    }
  }

  // Narrow floating tables (form fields) use monolithic layout. Full-width anchored tables flow
  // inline and paginate at row boundaries even when tblpPr is present (exhibit schedules).
  const tableProps = block.attrs?.tableProperties as Record<string, unknown> | undefined;
  const floatingProps = tableProps?.floatingTableProperties as Record<string, unknown> | undefined;
  if (floatingProps && Object.keys(floatingProps).length > 0 && !treatAsInline) {
    layoutMonolithicTable({ block, measure, columnWidth, ensurePage, advanceColumn, columnX });
    return;
  }

  const generateMetadata = createFragmentMetadataGenerator(measure, block);

  // 2. Count header rows. A header row's cell may vertically merge (rowSpan)
  // past the declared header rows; the effective count extends to cover the
  // full merge so the repeated header's height/paint loop stay consistent
  // with what the rowspan cell actually renders (see computeEffectiveHeaderCount).
  const headerCount = computeEffectiveHeaderCount(block, measure, countHeaderRows(block));
  const headerPrefixHeights = [0];
  for (let i = 0; i < headerCount; i += 1) {
    headerPrefixHeights.push(headerPrefixHeights[i] + (measure.rows[i]?.height ?? 0));
  }

  // 3. Initialize state
  let state = ensurePage();

  // Inline tables are body-flow boundaries. The preceding paragraph's
  // trailing spacing is already reflected in cursorY; retain that position,
  // but do not let the next paragraph collapse spacing or borders through the
  // table. Anchored/out-of-flow tables return above and preserve adjacency.
  breakParagraphAdjacency(state);

  // Check if we need to advance column/page before starting the table
  // If the table doesn't fit in the current position and there's already content on the page,
  // move to the next column/page to avoid starting a table that immediately needs to split
  const availableHeight = state.contentBottom - state.cursorY;

  // Table start preflight check: Decide whether to start the table on the current page
  // or advance to a new page. This prevents starting a table that immediately splits,
  // which would waste the remaining space on the current page.
  const hasPriorFragments = state.page.fragments.length > 0;
  const hasMeasuredRows = measure.rows.length > 0 && block.rows.length > 0;

  if (!resumeCursor && hasMeasuredRows && hasPriorFragments) {
    // Decision tree for tables with measured rows and existing page content:
    const firstRowCantSplit = block.rows[0]?.attrs?.tableRowProperties?.cantSplit === true;
    const firstRowHeight = measure.rows[0]?.height ?? measure.totalHeight ?? 0;
    const firstRowSlack = hasExplicitRowHeightSlack(block.rows[0], measure.rows[0]);
    const firstRowFitsPage = firstRowHeight <= state.contentBottom;
    const treatFirstRowAsCantSplit = firstRowCantSplit || (firstRowSlack && firstRowFitsPage);

    if (treatFirstRowAsCantSplit) {
      // Branch 1: cantSplit row
      // Require the entire first row to fit on the current page.
      // If it doesn't fit, advance to a new page to avoid an immediate split.
      if (firstRowHeight > availableHeight) {
        state = advanceColumn(state);
      }
    } else {
      // Branch 2: Splittable row (cantSplit = false or undefined)
      // Allow the table to start on the current page if ANY content can fit.
      // Use computePartialRow to check if at least one line can be rendered.
      const partial = computePartialRow(0, block.rows[0], measure, availableHeight);
      const madeProgress = partial.toLineByCell.some(
        (toLine: number, idx: number) => toLine > (partial.fromLineByCell[idx] || 0),
      );
      const hasRenderableHeight = partial.partialHeight > 0;

      // Advance only if we can't fit any lines at all
      if (!madeProgress || !hasRenderableHeight) {
        state = advanceColumn(state);
      }
      // Otherwise, start on current page and let normal row processing handle the split
    }
  } else if (!resumeCursor && hasPriorFragments) {
    // Fallback for cases without measured rows (e.g., empty measure.rows)
    let minRequiredHeight = 0;
    if (measure.rows.length > 0) {
      minRequiredHeight = sumRowHeights(measure.rows, 0, 1);
    } else if (measure.totalHeight > 0) {
      minRequiredHeight = measure.totalHeight;
    }

    if (minRequiredHeight > availableHeight) {
      state = advanceColumn(state);
    }
  }

  let currentRow = resumeCursor?.currentRow ?? 0;
  let isTableContinuation = resumeCursor?.isTableContinuation ?? false;
  let pendingPartialRow: PartialRowInfo | null = clonePartialRow(resumeCursor?.pendingPartialRow ?? null);

  // Handle edge case: table with no rows but non-zero totalHeight
  // This can occur in test scenarios or with placeholder tables
  if (block.rows.length === 0 && measure.totalHeight > 0) {
    const height = Math.min(measure.totalHeight, state.contentBottom - state.cursorY);

    const baseX = columnX(state);
    const baseWidth = Math.max(0, measure.totalWidth || columnWidth);
    const { x, width } = resolveTableFrame(baseX, columnWidth, baseWidth, block.attrs);
    const columnWidths = rescaleColumnWidths(measure.columnWidths, measure.totalWidth, width);

    const metadata = generateMetadata(0, 0, 0, columnWidths);

    const fragment: TableFragment = {
      kind: 'table',
      blockId: block.id,
      columnIndex: state.columnIndex,
      fromRow: 0,
      toRow: 0,
      x,
      y: state.cursorY,
      width,
      height,
      metadata,
      columnWidths,
      sourceAnchor: block.sourceAnchor,
    };
    applyTableFragmentPmRange(fragment, block, measure);
    onFragmentStart?.(state, {
      currentRow,
      isTableContinuation,
      pendingPartialRow: null,
      samePagePartialContinuation: false,
      retryWithoutHeaders: false,
    });
    state.page.fragments.push(fragment);
    state.cursorY += height;
    state.maxCursorY = Math.max(state.maxCursorY, state.cursorY);
    yield { index: 1, total: 1 };
    return;
  }

  // Resolve border-collapse for fragment height (match measuring/render: only add borders when separate)
  const borderCollapse = block.attrs?.borderCollapse ?? (block.attrs?.cellSpacing != null ? 'separate' : 'collapse');

  const getRepeatedHeaderHeight = (repeatCount: number): number => {
    const clampedCount = Math.max(0, Math.min(repeatCount, headerCount));
    return headerPrefixHeights[clampedCount] ?? 0;
  };

  // Tracks whether the current iteration's fragment is known to sit on the
  // same physical page as the fragment immediately before it — either
  // because it's another slice of the same partially-split row, or because
  // a split row just finished and the next body row starts right after it
  // with no page advance in between. Headers must not repeat mid-page: the
  // painter always renders repeated headers at the top of a fragment, which
  // would insert a duplicate header between two fragments that share a page.
  let samePagePartialContinuation = resumeCursor?.samePagePartialContinuation ?? false;

  // When computePartialRow makes no progress because repeated headers
  // consumed the body budget, this flag causes the next iteration to retry
  // with repeatHeaderCount = 0 (full page budget) instead of advancing to
  // a new page with the same cramped budget. This avoids both livelocking
  // and the content-dropping alternative of forcing line indices forward
  // with zero content height.
  let retryWithoutHeaders = resumeCursor?.retryWithoutHeaders ?? false;

  // 4. Loop until all rows processed (including pending partial rows)
  while (currentRow < block.rows.length || pendingPartialRow !== null) {
    state = ensurePage();
    const availableHeight = state.contentBottom - state.cursorY;
    const fragmentCursor = cloneTableLayoutCursor({
      currentRow,
      isTableContinuation,
      pendingPartialRow,
      samePagePartialContinuation,
      retryWithoutHeaders,
    });

    // Determine repeat header count for this fragment
    let repeatHeaderCount = 0;

    if (retryWithoutHeaders) {
      // Previous iteration's no-progress was caused by headers eating the
      // body budget. Retry this page without headers.
      repeatHeaderCount = 0;
      retryWithoutHeaders = false;
    } else if (currentRow === 0 && !pendingPartialRow) {
      // First fragment: headers are part of body rows, don't repeat separately
      repeatHeaderCount = 0;
    } else if (samePagePartialContinuation) {
      // Same-page continuation of a partial row: never insert headers mid-page
      repeatHeaderCount = 0;
    } else {
      // When continuing a later header row on a new page, repeat only the
      // completed header prefix. The current partial header row continues as
      // body content, so including it in repeatHeaderCount would duplicate it.
      // If that completed prefix would cut through a vertical merge, shrink it
      // to the largest self-contained prefix (or 0).
      const candidateRepeatHeaderCount =
        pendingPartialRow && pendingPartialRow.rowIndex < headerCount
          ? computeSelfContainedHeaderPrefix(measure, pendingPartialRow.rowIndex)
          : headerCount;
      const candidateHeaderHeight = getRepeatedHeaderHeight(candidateRepeatHeaderCount);

      if (candidateRepeatHeaderCount > 0 && candidateHeaderHeight < availableHeight) {
        // New page with room for the repeated header prefix plus body content.
        repeatHeaderCount = candidateRepeatHeaderCount;
      }
    }

    // Reset for this iteration — set by same-page partial-row paths below.
    samePagePartialContinuation = false;

    // If repeated headers would prevent a cantSplit row from fitting, skip header repetition.
    // Word does not split cantSplit rows just because repeated headers eat up space.
    if (repeatHeaderCount > 0 && !pendingPartialRow) {
      const bodyRow = block.rows[currentRow];
      const bodyRowHeight = measure.rows[currentRow]?.height || 0;
      const bodyCantSplit = bodyRow?.attrs?.tableRowProperties?.cantSplit === true;
      const spaceWithHeaders = availableHeight - getRepeatedHeaderHeight(repeatHeaderCount);
      if (bodyCantSplit && bodyRowHeight > spaceWithHeaders && bodyRowHeight <= availableHeight) {
        repeatHeaderCount = 0;
      }
    }

    const repeatedHeaderHeight = getRepeatedHeaderHeight(repeatHeaderCount);

    // Adjust available height for header repetition
    const availableForBody = availableHeight - repeatedHeaderHeight;

    // Calculate full page height (for detecting over-tall rows)
    // This is the actual usable content area height, accounting for top margin.
    // The ?? 0 handles test fixtures that may not set topMargin.
    const fullPageHeight = state.contentBottom - (state.topMargin ?? 0);

    // When headers are repeated on every page, the force-progress threshold
    // must account for the header budget. Otherwise a segment that's smaller
    // than a full page but larger than (fullPage − repeated headers) will livelock:
    // computePartialRow makes no progress, the guard advances to a new page
    // with the same repeated-header budget, and the same no-progress state recurs.
    const fullPageHeightForBody = fullPageHeight - repeatedHeaderHeight;

    // Handle pending partial row continuation
    if (pendingPartialRow !== null) {
      const rowIndex = pendingPartialRow.rowIndex;
      const fromLineByCell = pendingPartialRow.toLineByCell;

      const continuationPartialRow = computePartialRow(
        rowIndex,
        block.rows[rowIndex],
        measure,
        availableForBody,
        fromLineByCell,
        fullPageHeightForBody,
      );

      const madeProgress = continuationPartialRow.toLineByCell.some(
        (toLine: number, idx: number) => toLine > (fromLineByCell[idx] || 0),
      );

      const hasRemainingLinesAfterContinuation = continuationPartialRow.toLineByCell.some(
        (toLine: number, idx: number) => {
          const totalLines = getCellTotalLines(measure.rows[rowIndex].cells[idx]);
          return toLine < totalLines;
        },
      );

      const hadRemainingLinesBefore = fromLineByCell.some((fromLine: number, idx: number) => {
        const totalLines = getCellTotalLines(measure.rows[rowIndex].cells[idx]);
        return fromLine < totalLines;
      });

      const fragmentHeight = computeFragmentHeight(
        measure,
        rowIndex,
        rowIndex + 1,
        repeatHeaderCount,
        borderCollapse,
        continuationPartialRow,
      );

      // Only create a fragment if we made progress (rendered some lines)
      // Don't create empty fragments with just padding
      if (fragmentHeight > 0 && madeProgress) {
        const baseX = columnX(state);
        const baseWidth = Math.max(0, measure.totalWidth || columnWidth);
        const { x, width } = resolveTableFrame(baseX, columnWidth, baseWidth, block.attrs);
        const scaledWidths = rescaleColumnWidths(measure.columnWidths, measure.totalWidth, width);

        const fragment: TableFragment = {
          kind: 'table',
          blockId: block.id,
          columnIndex: state.columnIndex,
          fromRow: rowIndex,
          toRow: rowIndex + 1,
          x,
          y: state.cursorY,
          width,
          height: fragmentHeight,
          continuesFromPrev: true,
          continuesOnNext: hasRemainingLinesAfterContinuation || rowIndex + 1 < block.rows.length,
          repeatHeaderCount,
          partialRow: continuationPartialRow,
          metadata: generateMetadata(rowIndex, rowIndex + 1, repeatHeaderCount, scaledWidths, continuationPartialRow),
          columnWidths: scaledWidths,
          sourceAnchor: block.sourceAnchor,
        };

        applyTableFragmentPmRange(fragment, block, measure);
        onFragmentStart?.(state, fragmentCursor);
        state.page.fragments.push(fragment);
        state.cursorY += fragmentHeight;
        state.maxCursorY = Math.max(state.maxCursorY, state.cursorY);
        yield { index: Math.min(block.rows.length, rowIndex + 1), total: block.rows.length };
      }

      const rowComplete = !hasRemainingLinesAfterContinuation;

      if (rowComplete) {
        currentRow = rowIndex + 1;
        pendingPartialRow = null;
        // The row that just finished and the next body row are on the SAME
        // physical page (no advanceColumn happened between them). Suppress
        // header repetition on the next iteration so we don't insert a
        // duplicate header mid-page before the next row.
        samePagePartialContinuation = true;
      } else if (!madeProgress && hadRemainingLinesBefore) {
        if (repeatHeaderCount > 0) {
          // Headers consumed the body budget. Retry this page without headers
          // instead of advancing to a new page with the same cramped budget.
          retryWithoutHeaders = true;
        } else {
          // No progress and no headers to drop — advance to a new page.
          state = advanceColumn(state);
        }
        // Keep the same pendingPartialRow to retry (no assignment needed)
      } else {
        // Made progress but row not complete - continue on SAME page.
        // Flag this so the next iteration does NOT insert repeated headers
        // mid-page between two slices of the same row.
        pendingPartialRow = continuationPartialRow;
        samePagePartialContinuation = true;
      }

      isTableContinuation = true;
      continue;
    }

    // Normal row processing
    const bodyStartRow = currentRow;
    const { endRow, partialRow } = findSplitPoint(
      block,
      measure,
      bodyStartRow,
      availableForBody,
      fullPageHeightForBody,
    );

    // If no rows fit and page has content, advance
    if (endRow === bodyStartRow && partialRow === null && state.page.fragments.length > 0) {
      state = advanceColumn(state);
      continue;
    }

    // If still no rows fit after retry, force split
    // This handles edge case where row is too tall to fit on empty page
    if (endRow === bodyStartRow && partialRow === null) {
      const forcedPartialRow = computePartialRow(
        bodyStartRow,
        block.rows[bodyStartRow],
        measure,
        availableForBody,
        undefined,
        fullPageHeightForBody,
      );

      // Guard against zero-line-progress fragments. With block-aware height,
      // spacing alone can exceed available space. If no lines were rendered,
      // creating a fragment would cause an infinite loop of blank fragments.
      const forcedMadeProgress = forcedPartialRow.toLineByCell.some((cutLine: number) => cutLine > 0);
      if (!forcedMadeProgress) {
        if (repeatHeaderCount > 0) {
          // Headers consumed the body budget. Retry this page without headers.
          retryWithoutHeaders = true;
        } else {
          state = advanceColumn(state);
        }
        continue;
      }

      const forcedEndRow = bodyStartRow + 1;
      const fragmentHeight = computeFragmentHeight(
        measure,
        bodyStartRow,
        forcedEndRow,
        repeatHeaderCount,
        borderCollapse,
        forcedPartialRow,
      );

      const baseX = columnX(state);
      const baseWidth = Math.max(0, measure.totalWidth || columnWidth);
      const { x, width } = resolveTableFrame(baseX, columnWidth, baseWidth, block.attrs);
      const scaledWidths = rescaleColumnWidths(measure.columnWidths, measure.totalWidth, width);

      const fragment: TableFragment = {
        kind: 'table',
        blockId: block.id,
        columnIndex: state.columnIndex,
        fromRow: bodyStartRow,
        toRow: forcedEndRow,
        x,
        y: state.cursorY,
        width,
        height: fragmentHeight,
        continuesFromPrev: isTableContinuation,
        continuesOnNext: !forcedPartialRow.isLastPart || forcedEndRow < block.rows.length,
        repeatHeaderCount,
        partialRow: forcedPartialRow,
        metadata: generateMetadata(bodyStartRow, forcedEndRow, repeatHeaderCount, scaledWidths, forcedPartialRow),
        columnWidths: scaledWidths,
        sourceAnchor: block.sourceAnchor,
      };

      applyTableFragmentPmRange(fragment, block, measure);
      onFragmentStart?.(state, fragmentCursor);
      state.page.fragments.push(fragment);
      state.cursorY += fragmentHeight;
      state.maxCursorY = Math.max(state.maxCursorY, state.cursorY);
      yield { index: Math.min(block.rows.length, forcedEndRow), total: block.rows.length };
      pendingPartialRow = forcedPartialRow;
      samePagePartialContinuation = true;
      isTableContinuation = true;
      continue;
    }

    // Calculate fragment height — unified for both partial and full row cases
    const fragmentHeight = computeFragmentHeight(
      measure,
      bodyStartRow,
      endRow,
      repeatHeaderCount,
      borderCollapse,
      partialRow,
    );

    const baseX = columnX(state);
    const baseWidth = Math.max(0, measure.totalWidth || columnWidth);
    const { x, width } = resolveTableFrame(baseX, columnWidth, baseWidth, block.attrs);
    const scaledWidths = rescaleColumnWidths(measure.columnWidths, measure.totalWidth, width);

    const fragment: TableFragment = {
      kind: 'table',
      blockId: block.id,
      columnIndex: state.columnIndex,
      fromRow: bodyStartRow,
      toRow: endRow,
      x,
      y: state.cursorY,
      width,
      height: fragmentHeight,
      continuesFromPrev: isTableContinuation,
      continuesOnNext: endRow < block.rows.length || (partialRow ? !partialRow.isLastPart : false),
      repeatHeaderCount,
      partialRow: partialRow || undefined,
      metadata: generateMetadata(bodyStartRow, endRow, repeatHeaderCount, scaledWidths, partialRow),
      columnWidths: scaledWidths,
      sourceAnchor: block.sourceAnchor,
    };

    applyTableFragmentPmRange(fragment, block, measure);
    onFragmentStart?.(state, fragmentCursor);
    state.page.fragments.push(fragment);
    state.cursorY += fragmentHeight;
    state.maxCursorY = Math.max(state.maxCursorY, state.cursorY);
    yield { index: Math.min(block.rows.length, endRow), total: block.rows.length };

    // Handle partial row tracking
    if (partialRow && !partialRow.isLastPart) {
      pendingPartialRow = partialRow;
      currentRow = partialRow.rowIndex;
    } else {
      currentRow = endRow;
      pendingPartialRow = null;
    }

    isTableContinuation = true;

    if (pendingPartialRow) {
      // The partial row will continue on the same page. Suppress header
      // repetition on the next iteration to avoid mid-page headers.
      samePagePartialContinuation = true;
    }
  }
}

export function layoutTableBlock(context: TableLayoutContext): void {
  const steps = layoutTableBlockSteps(context);
  let step = steps.next();
  while (!step.done) step = steps.next();
}

/**
 * Create a table fragment for an anchored/floating table at its computed position.
 * Called by the layout engine after the float manager computes the table's position.
 */
export function createAnchoredTableFragment(
  block: TableBlock,
  measure: TableMeasure,
  x: number,
  y: number,
): TableFragment {
  const metadata = generateFragmentMetadata(measure, block, 0, block.rows.length, 0);

  const fragment: TableFragment = {
    kind: 'table',
    blockId: block.id,
    isAnchored: true,
    fromRow: 0,
    toRow: block.rows.length,
    x,
    y,
    width: measure.totalWidth ?? 0,
    height: measure.totalHeight ?? 0,
    metadata,
    sourceAnchor: block.sourceAnchor,
  };
  applyTableFragmentPmRange(fragment, block, measure);
  return fragment;
}
