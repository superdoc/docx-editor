import type {
  CellBorders,
  BorderSpec,
  DrawingBlock,
  DrawingMeasure,
  Line,
  ParagraphBlock,
  PartialRowInfo,
  SdtMetadata,
  TableBlock,
  TableBorders,
  TableMeasure,
} from '@superdoc/contracts';
import type { ResolvePhysicalFamily } from '@superdoc/font-system';
import { renderTableCell } from './renderTableCell.js';
import {
  resolveTableCellBorders,
  borderValueToSpec,
  resolveTableBorderValue,
  resolveBorderConflict,
  hasExplicitCellBorders,
  isPresentBorder,
  isExplicitNoneBorder,
  swapCellBordersLR,
  createThinDoubleBorderOverlay,
} from './border-utils.js';
import { getTableCellGridBounds, type TableCellGridPosition } from './grid-geometry.js';
import {
  resolveTrackedChangesConfig,
  applyRowTrackedChangeToCell,
  applyCellTrackedChangeToCell,
} from '../runs/tracked-changes.js';
import type { TrackedChangesRenderConfig } from '../runs/types.js';
import type { FragmentRenderContext } from '../renderer.js';
import type { SdtAncestorOptions } from '../sdt/container.js';
import { TABLE_ROW_ROLE_ATTRIBUTE, type TableRowRole } from './row-role.js';

type TableRowMeasure = TableMeasure['rows'][number];
type TableRow = TableBlock['rows'][number];

type CellBorderResolutionArgs = {
  cellBorders?: CellBorders;
  hasBordersAttribute: boolean;
  tableBorders?: TableBorders;
  cellPosition: TableCellGridPosition;
  cellSpacingPx: number;
  continuesFromPrev: boolean;
  continuesOnNext: boolean;
  /** Borders of the cell directly above (previous row, same grid column) for §17.4.66 conflict resolution. */
  aboveCellBorders?: CellBorders;
  /** Borders of the cell directly to the left (same row, previous grid column). */
  leftCellBorders?: CellBorders;
  /** Borders of the cell directly to the right (same row, next grid column), for asymmetric-edge ownership. */
  rightCellBorders?: CellBorders;
  /**
   * True when the next row's real cells do not reach this cell's right edge (e.g. the next
   * row has a `w:gridAfter` spacer while this cell spans into it). The cell below then can't
   * own the shared bottom edge across the uncovered span, so this cell must draw its own
   * bottom border or the line stops short at the bottom-right corner. (SD-3345)
   */
  nextRowLeavesRightGap?: boolean;
  /**
   * True when the cell ABOVE spans past this cell's row right edge (this row has a gridAfter
   * relative to it). The spanning cell owns the shared bottom edge and draws it, so this cell
   * must suppress its top border to avoid a doubled line. (SD-3345)
   */
  deferTopToAboveCell?: boolean;
  /**
   * True when the row BELOW has a tblPrEx border override that suppresses its shared horizontal
   * edge (insideH none/nil). The lower cell owns that edge but won't draw it, so a present
   * table/style border on THIS row must be drawn here to close the grid (§17.4.61/§17.4.66).
   * (SD-3028)
   */
  nextRowSuppressesSharedTop?: boolean;
};

const hasAnyResolvedBorder = (borders: CellBorders): boolean =>
  Boolean(borders.top || borders.right || borders.bottom || borders.left);

const borderSpecsMatch = (left?: BorderSpec, right?: BorderSpec): boolean =>
  left?.style === right?.style && left?.width === right?.width && left?.color === right?.color;

/**
 * A four-sided double border is a single visual rectangle in Word. Keep that
 * rectangle on one DOM cell so its two rasterized rings can join at all four
 * corners instead of being clipped across neighboring border boxes.
 */
const uniformDoubleRing = (borders?: CellBorders): BorderSpec | undefined => {
  const first = borders?.top;
  if (!first || first.style !== 'double') return undefined;
  return [borders?.right, borders?.bottom, borders?.left].every((border) => borderSpecsMatch(first, border))
    ? first
    : undefined;
};

/**
 * Resolves the borders that a rendered cell fragment should paint.
 *
 * The DOM table painter uses a single-owner border model, so merged cells must
 * determine edge ownership from their full occupied grid bounds, not just their
 * starting column or row.
 */
const resolveRenderedCellBorders = ({
  cellBorders,
  hasBordersAttribute,
  tableBorders,
  cellPosition,
  cellSpacingPx,
  continuesFromPrev,
  continuesOnNext,
  aboveCellBorders,
  leftCellBorders,
  rightCellBorders,
  nextRowLeavesRightGap,
  deferTopToAboveCell,
  nextRowSuppressesSharedTop,
}: CellBorderResolutionArgs): CellBorders | undefined => {
  const hasExplicitBorders = hasExplicitCellBorders(cellBorders);

  const cellBounds = getTableCellGridBounds(cellPosition);
  const touchesTopBoundary = cellBounds.touchesTopEdge || continuesFromPrev;
  // The bottom is a real boundary either when this is the last row / a fragment break, OR
  // when the next row's real cells don't reach this cell's right edge (a gridAfter spacer
  // under a spanning cell): the row below can't own the shared edge across the uncovered
  // span, so this (spanning) cell owns and draws its full-width bottom. The row below then
  // suppresses its top there (see `deferTopToAboveCell`) so the edge is drawn exactly once —
  // this painter has no border-collapse, so two cells drawing it would stack into a doubled
  // line, not overlap. (SD-3345)
  const touchesBottomBoundary = cellBounds.touchesBottomEdge || continuesOnNext || nextRowLeavesRightGap === true;

  // A shared interior edge in the collapsed model is owned by the lower/right cell, so a
  // border defined ONLY by the neighbor above/left must still be painted here — even when
  // this cell has no border of its own — or the line is dropped entirely (the neighbor
  // suppressed its own edge under single-owner). (SD-2969: a bordered clause-header row
  // above a fully borderless spacer row.)
  const hasInteriorNeighborBorder =
    (!touchesTopBoundary && !deferTopToAboveCell && isPresentBorder(aboveCellBorders?.bottom)) ||
    (!cellBounds.touchesLeftEdge && isPresentBorder(leftCellBorders?.right));

  // Collapsed model (zero cell spacing): single-owner positioning, where the value at a
  // shared interior edge is the ECMA-376 §17.4.66 winner of the two adjacent cell borders.
  // This draws a shared edge exactly ONCE (no doubling) while keeping the present border on
  // an asymmetric edge (no dropped line). Runs whenever this cell OR a neighbor above/left
  // defines a border, so `cb` defaults to {} for the borderless case (resolveBorderConflict
  // (undefined, x) === x). Interior right/bottom are owned by the neighbor to the right/below;
  // outer edges use the cell border (which beats the table border), falling back to the table
  // border. Works whether or not table-level borders exist. (SD-3345, SD-2969)
  if (cellSpacingPx === 0 && (hasExplicitBorders || hasInteriorNeighborBorder)) {
    const cb = (cellBorders ?? {}) as CellBorders;
    const cellDoubleRing = uniformDoubleRing(cb);
    const aboveDoubleRing = uniformDoubleRing(aboveCellBorders);
    const leftDoubleRing = uniformDoubleRing(leftCellBorders);
    return {
      top: touchesTopBoundary
        ? resolveTableBorderValue(cb.top, tableBorders?.top)
        : deferTopToAboveCell
          ? undefined
          : aboveDoubleRing && borderSpecsMatch(cb.top, aboveCellBorders?.bottom)
            ? undefined
            : (resolveBorderConflict(cb.top, aboveCellBorders?.bottom) ??
              // Both sides not present: an explicit nil on BOTH adjacent cells suppresses the
              // shared horizontal edge (§17.4.66); only inherit the table insideH when at least
              // one side is merely unset. (SD-3028)
              (isExplicitNoneBorder(cb.top) && isExplicitNoneBorder(aboveCellBorders?.bottom)
                ? undefined
                : borderValueToSpec(tableBorders?.insideH))),
      // Vertical interior edges: when BOTH adjacent cells declare a border, the right cell
      // owns it (draws its left as the §17.4.66 winner) so the edge is painted once (no
      // doubling). When only ONE side declares a border (asymmetric, no doubling risk) that
      // cell draws it on ITS OWN side — so an RTL cell's end (logical-right) border stays on
      // the cell after the left/right swap instead of moving onto a borderless neighbor. (SD-3345)
      left: cellBounds.touchesLeftEdge
        ? resolveTableBorderValue(cb.left, tableBorders?.left)
        : leftDoubleRing && borderSpecsMatch(cb.left, leftCellBorders?.right)
          ? undefined
          : isPresentBorder(cb.left)
            ? (resolveBorderConflict(cb.left, leftCellBorders?.right) ?? borderValueToSpec(tableBorders?.insideV))
            : isPresentBorder(leftCellBorders?.right)
              ? undefined
              : // Both sides not present: an explicit nil on BOTH adjacent cells suppresses the
                // divider (§17.4.66); only fall back to the table insideV when at least one side
                // is merely unset (and would inherit it). (SD-3028)
                isExplicitNoneBorder(cb.left) && isExplicitNoneBorder(leftCellBorders?.right)
                ? undefined
                : borderValueToSpec(tableBorders?.insideV),
      right: cellBounds.touchesRightEdge
        ? resolveTableBorderValue(cb.right, tableBorders?.right)
        : cellDoubleRing
          ? cb.right
          : isPresentBorder(cb.right) && !isPresentBorder(rightCellBorders?.left)
            ? cb.right
            : undefined,
      bottom: touchesBottomBoundary
        ? resolveTableBorderValue(cb.bottom, tableBorders?.bottom)
        : cellDoubleRing
          ? cb.bottom
          : undefined,
    };
  }

  if (hasBordersAttribute && !hasExplicitBorders) {
    return undefined;
  }

  if (!tableBorders) {
    // Separate mode (non-zero cell spacing) with explicit borders, or no table borders
    // at all: there is no shared-edge conflict, so draw every specified border.
    return hasExplicitBorders
      ? {
          top: cellBorders.top,
          right: cellBorders.right,
          bottom: cellBorders.bottom,
          left: cellBorders.left,
        }
      : undefined;
  }

  if (hasExplicitBorders) {
    // Separate mode (cellSpacingPx > 0) with table-level borders present.
    return {
      top: resolveTableBorderValue(cellBorders.top, touchesTopBoundary ? tableBorders.top : tableBorders.insideH),
      right: resolveTableBorderValue(cellBorders.right, cellBounds.touchesRightEdge ? tableBorders.right : undefined),
      bottom: resolveTableBorderValue(cellBorders.bottom, touchesBottomBoundary ? tableBorders.bottom : undefined),
      left: resolveTableBorderValue(
        cellBorders.left,
        cellBounds.touchesLeftEdge ? tableBorders.left : tableBorders.insideV,
      ),
    };
  }

  if (cellSpacingPx > 0) {
    const interiorBorders: CellBorders = {
      top: touchesTopBoundary ? undefined : borderValueToSpec(tableBorders.insideH),
      right: cellBounds.touchesRightEdge ? undefined : borderValueToSpec(tableBorders.insideV),
      bottom: touchesBottomBoundary ? undefined : borderValueToSpec(tableBorders.insideH),
      left: cellBounds.touchesLeftEdge ? undefined : borderValueToSpec(tableBorders.insideV),
    };

    return hasAnyResolvedBorder(interiorBorders) ? interiorBorders : undefined;
  }

  const baseBorders = resolveTableCellBorders(tableBorders, cellPosition);

  // The row below owns this interior bottom edge, but if its tblPrEx override suppresses it
  // (insideH none), draw this row's own present interior horizontal border so the grid still
  // closes. (SD-3028)
  const insideHSpec = borderValueToSpec(tableBorders.insideH);
  const interiorBottom = nextRowSuppressesSharedTop && isPresentBorder(insideHSpec) ? insideHSpec : baseBorders.bottom;

  return {
    top: touchesTopBoundary ? borderValueToSpec(tableBorders.top) : baseBorders.top,
    right: baseBorders.right,
    bottom: touchesBottomBoundary ? borderValueToSpec(tableBorders.bottom) : interiorBottom,
    left: baseBorders.left,
  };
};

/**
 * Dependencies required for rendering a table row.
 *
 * Contains all information needed to render cells in a table row, including
 * positioning, measurements, border resolution, and rendering functions.
 */
type TableRowRenderDependencies = {
  /** Document object for creating DOM elements */
  doc: Document;
  /** Container element to append cell elements to */
  container: HTMLElement;
  /** Zero-based index of this row */
  rowIndex: number;
  /** Whether this is a repeated header copy or a body row. */
  rowRole?: TableRowRole;
  /** Vertical position (top edge) in pixels */
  y: number;
  /** Measurement data for this row (height, cell measurements) */
  rowMeasure: TableRowMeasure;
  /** Row data (cells, attributes), or undefined for empty rows */
  row?: TableRow;
  /** Previous (above) row data + measure, for collapsed-border conflict resolution (§17.4.66). */
  prevRow?: TableRow;
  prevRowMeasure?: TableRowMeasure;
  /** Next (below) row data, to detect a row-level border override that suppresses the shared
   * horizontal edge so the current row closes the grid itself (§17.4.61/§17.4.66). */
  nextRow?: TableRow;
  /** Next (below) row measure, to detect a gridAfter gap under a spanning cell (SD-3345). */
  nextRowMeasure?: TableRowMeasure;
  /**
   * Rightmost occupied grid column (exclusive) for THIS row, counting cells that span into it
   * via w:vMerge (rowspan) from an earlier row. Falls back to this row's own cells when absent.
   * Prevents a leftmost cell on a rowspan-continuation row from being treated as the rightmost
   * column. (SD-1797)
   */
  rowOccupiedRightCol?: number;
  /** Same as {@link rowOccupiedRightCol} for the NEXT row, so a rowspan continuation below is
   * not mistaken for a gridAfter gap (which would double the shared bottom edge). (SD-1797) */
  nextRowOccupiedRightCol?: number;
  /** Total number of rows in the table (for border resolution) */
  totalRows: number;
  /** Table-level borders (for resolving cell borders) */
  tableBorders?: TableBorders;
  /** Column widths array for calculating x positions from gridColumnStart */
  columnWidths: number[];
  /** All row heights for calculating rowspan cell heights */
  allRowHeights: number[];
  /** Table indent in pixels (applied to table fragment positioning) */
  tableIndent?: number;
  /** Whether the table is visually right-to-left (w:bidiVisual, ECMA-376 §17.4.1) */
  isRtl?: boolean;
  /** Rendering context */
  context: FragmentRenderContext;
  /** Function to render a line of paragraph content */
  renderLine: (
    block: ParagraphBlock,
    line: Line,
    context: FragmentRenderContext,
    lineIndex: number,
    isLastLine: boolean,
  ) => HTMLElement;
  /** Optional callback invoked after a table line's final styles/markers are applied. */
  captureLineSnapshot?: (
    lineEl: HTMLElement,
    context: FragmentRenderContext,
    options?: { inTableParagraph?: boolean; wrapperEl?: HTMLElement },
  ) => void;
  /** Function to render drawing content (images, shapes, shape groups) */
  renderDrawingContent?: (block: DrawingBlock, interactionHost: HTMLElement, measure: DrawingMeasure) => HTMLElement;
  /** Function to apply SDT metadata as data attributes */
  applySdtDataset: (el: HTMLElement | null, metadata?: SdtMetadata | null) => void;
  /** Ancestor SDT container key for suppressing duplicate container styling in cells */
  ancestorContainerKey?: string | null;
  /** Ancestor SDT metadata for suppressing duplicate id-less container styling in cells */
  ancestorContainerSdt?: SdtMetadata | null;
  /** Ancestor SDT keys for suppressing duplicate container styling in cells */
  ancestorContainerKeys?: SdtAncestorOptions['ancestorContainerKeys'];
  /** Ancestor SDT metadata chain for suppressing duplicate id-less container styling in cells */
  ancestorContainerSdts?: SdtAncestorOptions['ancestorContainerSdts'];
  /** Receives notification when cells render SDT container chrome */
  onSdtContainerChrome?: () => void;
  /**
   * If true, this row is the first body row of a continuation fragment.
   * MS Word draws borders at split points to visually close the table on each page,
   * so we do NOT suppress borders - both fragments draw their edge borders.
   */
  continuesFromPrev?: boolean;
  /**
   * If true, this row is the last body row before a page break continuation.
   * MS Word draws borders at split points to visually close the table on each page,
   * so we do NOT suppress borders - both fragments draw their edge borders.
   */
  continuesOnNext?: boolean;
  /**
   * Partial row information for mid-row splits.
   * Contains per-cell line ranges (fromLineByCell, toLineByCell) for rendering
   * only a portion of the row's content.
   */
  partialRow?: PartialRowInfo;

  /**
   * Cell spacing in pixels (border-spacing between cells).
   * Applied to cell x positions and row y advancement.
   */
  cellSpacingPx?: number;
  /** Built-in SDT chrome rendering mode. */
  chrome?: 'default' | 'none';
  /**
   * Per-document logical->physical font resolver for in-cell list markers and drop caps. Threaded
   * from the renderer's per-document resolver so they paint the same physical family they were
   * measured in. Undefined falls back to the global resolver.
   */
  resolvePhysical?: ResolvePhysicalFamily;
};

/**
 * Renders all cells in a table row.
 *
 * Iterates through cells in the row, resolving borders based on cell position,
 * and rendering each cell with its content. Cells are positioned horizontally
 * by accumulating their widths.
 *
 * Border resolution logic:
 * - Cells with explicit borders use those borders
 * - Otherwise, cells use position-based borders from table borders:
 *   - Edge cells use outer table borders
 *   - Interior cells use inside borders (insideH, insideV)
 * - If no table borders exist, default borders are applied
 *
 * @param deps - All dependencies required for rendering
 *
 * @example
 * ```typescript
 * renderTableRow({
 *   doc: document,
 *   container: tableContainer,
 *   rowIndex: 0,
 *   y: 0,
 *   rowMeasure,
 *   row,
 *   totalRows: 3,
 *   tableBorders,
 *   context,
 *   renderLine,
 *   applySdtDataset
 * });
 * // Appends all cell elements to container
 * ```
 */
export const renderTableRow = (deps: TableRowRenderDependencies): void => {
  const {
    doc,
    container,
    rowIndex,
    rowRole = 'body',
    y,
    rowMeasure,
    row,
    prevRow,
    prevRowMeasure,
    nextRow,
    nextRowMeasure,
    rowOccupiedRightCol,
    nextRowOccupiedRightCol,
    totalRows,
    tableBorders,
    columnWidths,
    allRowHeights,
    tableIndent,
    isRtl,
    context,
    renderLine,
    captureLineSnapshot,
    renderDrawingContent,
    applySdtDataset,
    ancestorContainerKey,
    ancestorContainerSdt,
    ancestorContainerKeys,
    ancestorContainerSdts,
    onSdtContainerChrome,
    continuesFromPrev,
    continuesOnNext,
    partialRow,
    cellSpacingPx = 0,
    chrome,
    resolvePhysical,
  } = deps;

  const totalCols = columnWidths.length;

  // Structural row-level tracked change (inserted/deleted whole row). Reuses the
  // exact same metadata + painter helpers as inline tracked changes. The
  // tracked-changes MODE is threaded the same way inline runs get it: from a
  // ParagraphBlock's attrs (trackedChangesMode/trackedChangesEnabled) via
  // resolveTrackedChangesConfig. FragmentRenderContext carries no mode field, so
  // we resolve from a representative paragraph in this row's cells.
  const rowTrackedChange = row?.attrs?.trackedChange;
  let rowTrackedChangeConfig: TrackedChangesRenderConfig | undefined;
  if (rowTrackedChange) {
    let representativeParagraph: ParagraphBlock | undefined;
    for (const cell of row?.cells ?? []) {
      const candidate =
        cell.paragraph ?? (cell.blocks?.find((block) => block.kind === 'paragraph') as ParagraphBlock | undefined);
      if (candidate) {
        representativeParagraph = candidate;
        break;
      }
    }
    rowTrackedChangeConfig = representativeParagraph
      ? resolveTrackedChangesConfig(representativeParagraph)
      : { mode: 'review', enabled: true };
  }

  // Effective right grid edge for THIS row's border ownership. A row with a
  // trailing w:gridAfter reserves empty columns past its last cell (FWC forms do
  // this), so the rightmost real cell never reaches `totalCols` and the
  // single-owner model would drop the row's right border. Word draws the right
  // border at the rightmost cell, treating gridAfter columns as outside the box.
  // Use the last occupied column as the right edge; for rows without gridAfter
  // this equals totalCols (no change).
  // Prefer the rowspan-aware occupied width (counts cells spanning into this row via vMerge);
  // fall back to this row's own cells when the caller doesn't provide it. (SD-1797, SD-3345)
  const rowRightEdgeCol =
    rowOccupiedRightCol != null && rowOccupiedRightCol > 0
      ? Math.min(totalCols, rowOccupiedRightCol)
      : rowMeasure.cells.length
        ? Math.min(totalCols, Math.max(...rowMeasure.cells.map((c) => (c.gridColumnStart ?? 0) + (c.colSpan ?? 1))))
        : totalCols;

  // Row-level border override (OOXML w:tblPrEx/w:tblBorders, §17.4.61). When this
  // row carries its own borders, they override the table borders for this row only,
  // merged per edge so unspecified sides still inherit the table. Rows without an
  // override paint with the table borders unchanged (no behavior change).
  const rowBorderOverride = row?.attrs?.borders;
  const effectiveTableBorders: TableBorders | undefined = rowBorderOverride
    ? { ...tableBorders, ...rowBorderOverride }
    : tableBorders;

  // When the NEXT row carries a tblPrEx override that suppresses its shared horizontal edge
  // (insideH = none/nil), the lower cell — which owns that edge in the single-owner model —
  // won't draw it, and a table/style-derived border above (no cell tcBorder for the SD-2969
  // neighbor path to pick up) would be dropped. Per §17.4.66 a present border beats the
  // none, so THIS row must close the grid by drawing its own interior bottom. Gated on the
  // next row actually having an override, so unoverridden tables are unchanged (no doubling).
  // (SD-3028)
  const nextRowBorderOverride = nextRow?.attrs?.borders;
  const nextRowEffectiveInsideH = nextRowBorderOverride
    ? ({ ...tableBorders, ...nextRowBorderOverride } as TableBorders).insideH
    : undefined;
  const nextRowSuppressesSharedTop =
    nextRowBorderOverride !== undefined && !isPresentBorder(borderValueToSpec(nextRowEffectiveInsideH));

  /**
   * Calculates the horizontal position (x-coordinate) for a cell based on its grid column index.
   *
   * Sums the widths of all columns preceding the given column index plus spacing between
   * columns (border-spacing). When cellSpacingPx > 0, each column after the first is
   * offset by one spacing unit, so x = sum(columnWidths[0..gridColumnStart-1]) + gridColumnStart * cellSpacingPx.
   *
   * **Bounds Safety:**
   * Loop terminates at the minimum of `gridColumnStart` and `columnWidths.length`
   * to prevent out-of-bounds array access.
   *
   * @param gridColumnStart - Zero-based column index in the table grid
   * @returns Horizontal position in pixels from the left edge of the table
   *
   * @example
   * ```typescript
   * // columnWidths = [100, 150, 200], cellSpacingPx = 4
   * calculateXPosition(0) // Returns: cellSpacingPx (space before first column)
   * calculateXPosition(1) // Returns: cellSpacingPx + columnWidths[0] + cellSpacingPx
   * ```
   */
  const calculateXPosition = (gridColumnStart: number): number => {
    let x = cellSpacingPx; // space before first column
    for (let i = 0; i < gridColumnStart && i < columnWidths.length; i++) {
      x += columnWidths[i] + cellSpacingPx;
    }
    return x;
  };

  // Total table content width (for RTL mirroring)
  // RTL tables mirror cell X positions: rtlX = totalWidth - ltrX - cellWidth
  // (ECMA-376 §17.4.1: cells stored logically, displayed right-to-left)
  let tableContentWidth = 0;
  if (isRtl) {
    tableContentWidth = cellSpacingPx;
    for (let i = 0; i < columnWidths.length; i++) {
      tableContentWidth += columnWidths[i] + cellSpacingPx;
    }
  }

  /**
   * Calculates the total height for a cell that spans multiple rows (rowspan).
   *
   * Sums the heights of consecutive rows starting from `startRowIndex` up to
   * the number of rows specified by `rowSpan`. This determines the vertical
   * size needed to render a cell that merges multiple rows.
   *
   * **Bounds Safety:**
   * Loop checks both rowSpan count and array bounds to prevent accessing
   * non-existent rows.
   *
   * @param startRowIndex - Zero-based index of the first row in the span
   * @param rowSpan - Number of rows the cell spans (typically >= 1)
   * @returns Total height in pixels for the cell
   *
   * @example
   * ```typescript
   * // allRowHeights = [50, 60, 70, 80]
   * calculateRowspanHeight(0, 1) // Returns: 50 (single row)
   * calculateRowspanHeight(0, 2) // Returns: 110 (rows 0 and 1)
   * calculateRowspanHeight(1, 3) // Returns: 210 (rows 1, 2, and 3)
   * calculateRowspanHeight(3, 5) // Returns: 80 (safe - only row 3 exists)
   * ```
   */
  const calculateRowspanHeight = (startRowIndex: number, rowSpan: number): number => {
    let totalHeight = 0;
    for (let i = 0; i < rowSpan && startRowIndex + i < allRowHeights.length; i++) {
      totalHeight += allRowHeights[startRowIndex + i];
    }
    return totalHeight;
  };

  const calculateColspanWidth = (gridColumnStart: number, colSpan: number): number => {
    let width = 0;
    for (let i = gridColumnStart; i < gridColumnStart + colSpan && i < columnWidths.length; i++) {
      width += columnWidths[i];
    }
    return width;
  };

  // Find the borders of the cell in `cells` that occupies grid column `gridCol`, using
  // the row's measure to map cell index → grid span (handles colspan). Used to fetch the
  // above/left neighbor's borders for §17.4.66 collapsed-border conflict resolution.
  const findCellBordersAtColumn = (
    cells: TableRow['cells'] | undefined,
    measureCells: TableRowMeasure['cells'] | undefined,
    gridCol: number,
  ): CellBorders | undefined => {
    if (!cells || !measureCells) return undefined;
    for (let i = 0; i < measureCells.length; i++) {
      const start = measureCells[i].gridColumnStart ?? i;
      const span = measureCells[i].colSpan ?? 1;
      if (gridCol >= start && gridCol < start + span) return cells[i]?.attrs?.borders;
    }
    return undefined;
  };

  // Right edge (exclusive grid column) of the cell occupying `gridCol` in `measureCells`.
  const findCellRightEdgeAtColumn = (
    measureCells: TableRowMeasure['cells'] | undefined,
    gridCol: number,
  ): number | undefined => {
    if (!measureCells) return undefined;
    for (let i = 0; i < measureCells.length; i++) {
      const start = measureCells[i].gridColumnStart ?? i;
      const span = measureCells[i].colSpan ?? 1;
      if (gridCol >= start && gridCol < start + span) return start + span;
    }
    return undefined;
  };

  // Rightmost grid column (exclusive) covered by the next row's REAL cells. When a spanning
  // cell's right edge exceeds this, the next row has a gridAfter spacer beneath it and can't
  // own the shared bottom edge across the uncovered span. (SD-3345)
  // Rowspan-aware occupied width of the next row (counts cells spanning into it); fall back to
  // the next row's own cells. A covered column must not look like a gridAfter gap. (SD-1797)
  const nextRowMaxCol =
    nextRowOccupiedRightCol != null && nextRowOccupiedRightCol > 0
      ? nextRowOccupiedRightCol
      : nextRowMeasure?.cells?.length
        ? Math.max(...nextRowMeasure.cells.map((c) => (c.gridColumnStart ?? 0) + (c.colSpan ?? 1)))
        : Infinity;

  for (let cellIndex = 0; cellIndex < rowMeasure.cells.length; cellIndex += 1) {
    const cellMeasure = rowMeasure.cells[cellIndex];
    const cell = row?.cells?.[cellIndex];
    const gridColumnStart = cellMeasure.gridColumnStart ?? cellIndex;
    const rowSpan = cellMeasure.rowSpan ?? 1;
    const colSpan = cellMeasure.colSpan ?? 1;

    // Calculate x position from gridColumnStart if available, otherwise fallback
    let x = calculateXPosition(gridColumnStart);

    // Check if cell has any border attribute at all (even if empty - empty means "no borders")
    const cellBordersAttr = cell?.attrs?.borders;
    const hasBordersAttribute = cellBordersAttr !== undefined;

    // For RTL tables, swap left↔right edge detection so borders mirror correctly
    // (ECMA-376 Part 4 §14.3.1–14.3.8: left/right borders and margins swap for bidiVisual)
    const cellPosition: TableCellGridPosition = {
      rowIndex,
      rowSpan,
      gridColumnStart,
      colSpan,
      totalRows,
      // Use the row's effective right edge so the rightmost cell owns the right
      // border even when trailing w:gridAfter columns pad the grid (§17.4.55).
      totalCols: rowRightEdgeCol,
    };

    // Neighbor borders for §17.4.66 collapsed-border conflict resolution: the cell above
    // (previous row, same grid column) and the cell to the left (same row, previous column).
    const aboveCellBorders = findCellBordersAtColumn(prevRow?.cells, prevRowMeasure?.cells, gridColumnStart);
    const leftCellBorders =
      gridColumnStart > 0 ? findCellBordersAtColumn(row?.cells, rowMeasure.cells, gridColumnStart - 1) : undefined;
    // The cell to the right (same row, the column just past this cell's span) — used to keep
    // an asymmetric vertical edge on the owning cell instead of moving it to the neighbor.
    const rightCellBorders = findCellBordersAtColumn(row?.cells, rowMeasure.cells, gridColumnStart + colSpan);
    // This cell spans past the next row's real cells (gridAfter spacer beneath its right edge).
    const nextRowLeavesRightGap = gridColumnStart + colSpan > nextRowMaxCol;
    // Conversely, the cell ABOVE spans past THIS row's right edge (this row has a gridAfter
    // relative to it). The spanning cell then owns the full shared edge and draws its own
    // bottom, so this cell must NOT also draw its top, or the edge doubles. (SD-3345)
    const aboveCellRightEdge = findCellRightEdgeAtColumn(prevRowMeasure?.cells, gridColumnStart);
    const deferTopToAboveCell = aboveCellRightEdge !== undefined && aboveCellRightEdge > rowRightEdgeCol;

    // Resolve borders using logical positions, then swap output for RTL.
    // The resolver uses touchesLeftEdge/touchesRightEdge which are LOGICAL edges.
    // For RTL, logical left = visual right, so we swap the resolved CSS properties
    // so borderLeft/borderRight match the correct visual edges.
    const resolvedBorders = resolveRenderedCellBorders({
      cellBorders: cellBordersAttr,
      hasBordersAttribute,
      tableBorders: effectiveTableBorders,
      cellPosition,
      cellSpacingPx,
      continuesFromPrev: continuesFromPrev === true,
      continuesOnNext: continuesOnNext === true,
      aboveCellBorders,
      leftCellBorders,
      rightCellBorders,
      nextRowLeavesRightGap,
      deferTopToAboveCell,
      nextRowSuppressesSharedTop,
    });
    // RTL: swap resolved left↔right so CSS properties match visual edges
    const finalBorders = isRtl && resolvedBorders ? swapCellBordersLR(resolvedBorders) : resolvedBorders;

    // Calculate cell height - use rowspan height if cell spans multiple rows
    // For partial rows, use the partial height instead
    let cellHeight: number;
    if (partialRow) {
      // Use partial row height for mid-row splits
      cellHeight = partialRow.partialHeight;
    } else if (rowSpan > 1) {
      cellHeight = calculateRowspanHeight(rowIndex, rowSpan);
    } else {
      cellHeight = rowMeasure.height;
    }

    // Get per-cell line range for partial row rendering
    const fromLine = partialRow?.fromLineByCell?.[cellIndex];
    const toLine = partialRow?.toLineByCell?.[cellIndex];

    // Compute cell width from rescaled columnWidths (SD-1859: mixed-orientation docs
    // where cellMeasure.width may reflect landscape measurement but the fragment renders
    // in portrait). The columnWidths array is already rescaled by the layout engine.
    const computedCellWidth = calculateColspanWidth(gridColumnStart, colSpan);

    // RTL: mirror x position so first logical column appears on the right
    if (isRtl && computedCellWidth > 0) {
      x = tableContentWidth - x - computedCellWidth;
    }

    // Never use default borders - cells are either explicitly styled or borderless
    // This prevents gray borders on cells with borders={} (intentionally borderless)
    const { cellElement } = renderTableCell({
      doc,
      x,
      y,
      rowHeight: cellHeight,
      cellMeasure,
      cell,
      borders: finalBorders,
      useDefaultBorder: false,
      renderLine,
      captureLineSnapshot,
      renderDrawingContent,
      context,
      applySdtDataset,
      ancestorContainerKey,
      ancestorContainerSdt,
      ancestorContainerKeys,
      ancestorContainerSdts,
      onSdtContainerChrome,
      fromLine,
      toLine,
      tableIndent,
      isRtl,
      cellWidth: computedCellWidth > 0 ? computedCellWidth : undefined,
      chrome,
      resolvePhysical,
    });
    cellElement.setAttribute(TABLE_ROW_ROLE_ATTRIBUTE, rowRole);
    if (
      !finalBorders ||
      ![finalBorders.top, finalBorders.right, finalBorders.bottom, finalBorders.left].some(isPresentBorder)
    ) {
      cellElement.dataset.sdBorderlessCell = '';
    }

    // Paint the structural row-level tracked change onto each cell element of
    // the row (no <tr> exists in the painted DOM), reusing the inline helpers.
    // Applied before any cell-level change so the row keeps precedence on the
    // shared single-value datasets / color variables (SD-3481).
    if (rowTrackedChange && rowTrackedChangeConfig) {
      applyRowTrackedChangeToCell(cellElement, rowTrackedChange, rowTrackedChangeConfig);
    }

    // Paint the structural cell-level tracked change (SD-3481 cell insertion /
    // deletion / merge / split). The tracked-changes MODE is resolved the same
    // way row/inline changes get it: from a representative paragraph in this
    // cell, defaulting to review/enabled when the cell has no paragraph.
    const cellTrackedChange = cell?.attrs?.trackedChange;
    if (cellTrackedChange) {
      const representativeCellParagraph =
        cell?.paragraph ?? (cell?.blocks?.find((block) => block.kind === 'paragraph') as ParagraphBlock | undefined);
      const cellTrackedChangeConfig: TrackedChangesRenderConfig = representativeCellParagraph
        ? resolveTrackedChangesConfig(representativeCellParagraph)
        : { mode: 'review', enabled: true };
      applyCellTrackedChangeToCell(cellElement, cellTrackedChange, cellTrackedChangeConfig);
    }

    container.appendChild(cellElement);
    const thinDoubleBorderOverlay = createThinDoubleBorderOverlay(doc, cellElement, {
      left: cellElement.style.left,
      top: cellElement.style.top,
      width: cellElement.style.width,
      height: cellElement.style.height,
    });
    if (thinDoubleBorderOverlay) container.appendChild(thinDoubleBorderOverlay);
  }
};
