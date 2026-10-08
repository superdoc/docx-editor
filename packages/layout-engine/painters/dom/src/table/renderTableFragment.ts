import { completeRenderWork, type RenderWork } from '../render-work.js';
import type {
  DrawingBlock,
  DrawingMeasure,
  Fragment,
  Line,
  ParagraphBlock,
  SdtMetadata,
  TableBlock,
  TableFragment,
  TableMeasure,
} from '@superdoc/contracts';
import { getTableVisualDirection } from '@superdoc/contracts';
import type { ResolvePhysicalFamily } from '@superdoc/font-system';
import { CLASS_NAMES, fragmentStyles } from '../styles.js';
import { DOM_CLASS_NAMES } from '../constants.js';
import type { FragmentRenderContext } from '../renderer.js';
import { renderTableRowWork } from './renderTableRow.js';
import {
  applySdtContainerChrome,
  getSdtContainerKey,
  getSdtContainerMetadata,
  hasExplicitSdtContainerKey,
  type SdtAncestorOptions,
  type SdtBoundaryOptions,
} from '../sdt/container.js';
import { applyBorder, borderValueToSpec, hasExplicitCellBorders } from './border-utils.js';
import { getTableCellGridBounds } from './grid-geometry.js';

type ApplyStylesFn = (el: HTMLElement, styles: Partial<CSSStyleDeclaration>) => void;
/**
 * Dependencies required for rendering a table fragment.
 *
 * Encapsulates all external dependencies needed to render a table, including
 * document access, rendering context, pre-resolved table data, and helper functions.
 */
export type TableRenderDependencies = {
  /** Document object for creating DOM elements */
  doc: Document;
  /** Table fragment to render (contains dimensions and row range) */
  fragment: TableFragment;
  /** Rendering context (section info, etc.) */
  context: FragmentRenderContext;
  /** Pre-extracted TableBlock (replaces blockLookup.get()) */
  block: TableBlock;
  /** Pre-extracted TableMeasure (replaces blockLookup.get()) */
  measure: TableMeasure;
  /** Pre-computed cell spacing in pixels */
  cellSpacingPx: number;
  /** Pre-computed effective column widths (fragment.columnWidths ?? measure.columnWidths) */
  effectiveColumnWidths: number[];
  /** Optional SDT boundary overrides for container styling */
  sdtBoundary?: SdtBoundaryOptions;
  /** Ancestor SDT key used to suppress duplicate container chrome in nested tables */
  ancestorContainerKey?: string | null;
  /** Ancestor SDT metadata used to suppress duplicate id-less container chrome in nested tables */
  ancestorContainerSdt?: SdtMetadata | null;
  /** Ancestor SDT keys used to suppress duplicate container chrome in nested tables */
  ancestorContainerKeys?: SdtAncestorOptions['ancestorContainerKeys'];
  /** Ancestor SDT metadata chain used to suppress duplicate id-less container chrome in nested tables */
  ancestorContainerSdts?: SdtAncestorOptions['ancestorContainerSdts'];
  /** Receives notification when this table fragment or descendants render SDT container chrome */
  onSdtContainerChrome?: () => void;
  /** Built-in SDT chrome rendering mode. */
  chrome?: 'default' | 'none';
  /** Function to render a line of paragraph content */
  renderLine: (
    block: ParagraphBlock,
    line: Line,
    context: FragmentRenderContext,
    lineIndex: number,
    isLastLine: boolean,
    resolvedListTextStartPx?: number,
  ) => HTMLElement | RenderWork<HTMLElement>;
  /** Optional callback invoked after a table line's final styles/markers are applied. */
  captureLineSnapshot?: (
    lineEl: HTMLElement,
    context: FragmentRenderContext,
    options?: { inTableParagraph?: boolean; wrapperEl?: HTMLElement },
  ) => void;
  /** Function to render drawing content (images, shapes, shape groups) */
  renderDrawingContent?: (block: DrawingBlock, interactionHost: HTMLElement, measure: DrawingMeasure) => HTMLElement;
  /** Function to apply fragment positioning and dimensions */
  applyFragmentFrame: (el: HTMLElement, fragment: Fragment) => void;
  /** Function to apply SDT metadata as data attributes */
  applySdtDataset: (el: HTMLElement | null, metadata?: SdtMetadata | null) => void;
  /** Function to apply container SDT metadata as data attributes */
  applyContainerSdtDataset?: (el: HTMLElement | null, metadata?: SdtMetadata | null) => void;
  /** Function to apply CSS styles to an element */
  applyStyles: ApplyStylesFn;
  /**
   * Per-document logical->physical font resolver for in-cell list markers and drop caps. Threaded
   * from the renderer's per-document resolver so they paint the same physical family they were
   * measured in. Undefined falls back to the global resolver.
   */
  resolvePhysical?: ResolvePhysicalFamily;
};

/**
 * Renders a table fragment as a DOM element.
 *
 * Creates a container div with absolutely-positioned rows and cells. Handles:
 * - Table border overlays for outer borders
 * - Border collapse settings
 * - Cell spacing
 * - Row-by-row rendering with proper positioning
 * - Metadata embedding for interactive table resizing
 *
 * **Error Handling:**
 * If the document is unavailable, returns an error placeholder instead of
 * throwing. Table block/measure validation is performed by the caller before
 * invoking this helper.
 *
 * **SDT Container Styling:**
 * If the table block has SDT metadata (`block.attrs?.sdt`), applies appropriate
 * container styling via `applySdtContainerChrome()`:
 * - Document sections: Gray border with hover tooltip
 * - Structured content blocks: Blue border with label
 * Uses type-safe helper functions to avoid unsafe type assertions.
 *
 * **Metadata Embedding:**
 * Embeds column boundary metadata in the `data-table-boundaries` attribute
 * using a compact JSON format:
 * ```json
 * {
 *   "columns": [
 *     {"i": 0, "x": 0, "w": 100, "min": 25, "r": 1},
 *     {"i": 1, "x": 100, "w": 150, "min": 30, "r": 1}
 *   ],
 *   "rows": [
 *     {"i": 0, "y": 0, "h": 30, "min": 10, "r": 1},
 *     {"i": 1, "y": 34, "h": 25, "min": 10, "r": 1}
 *   ]
 * }
 * ```
 * Where for columns: i=index, x=position, w=width, min=minWidth, r=resizable(0/1)
 * Where for rows: i=index, y=position, h=height, min=minHeight, r=resizable(0/1)
 *
 * **Edge Cases:**
 * - Missing metadata: Element created without data-table-boundaries attribute
 * - Empty columnBoundaries: Creates empty columns array in JSON
 * - Missing block ID: Element created without data-sd-block-id attribute
 *
 * @param deps - All dependencies required for rendering
 * @returns HTMLElement containing the rendered table fragment, or error placeholder
 *
 * @example
 * ```typescript
 * const tableElement = renderTableFragment({
 *   doc: document,
 *   fragment: tableFragment,
 *   context: renderContext,
 *   block: tableBlock,
 *   measure: tableMeasure,
 *   cellSpacingPx: 0,
 *   effectiveColumnWidths: tableMeasure.columnWidths,
 *   renderLine,
 *   applyFragmentFrame,
 *   applySdtDataset,
 *   applyStyles
 * });
 * container.appendChild(tableElement);
 * ```
 */
export function* renderTableFragmentWork(deps: TableRenderDependencies): RenderWork<HTMLElement> {
  const {
    doc,
    fragment,
    block,
    measure,
    cellSpacingPx,
    effectiveColumnWidths,
    chrome,
    context,
    sdtBoundary,
    ancestorContainerKey,
    ancestorContainerSdt,
    ancestorContainerKeys,
    ancestorContainerSdts,
    onSdtContainerChrome,
    renderLine,
    captureLineSnapshot,
    renderDrawingContent,
    applyFragmentFrame,
    applySdtDataset,
    applyContainerSdtDataset,
    applyStyles,
    resolvePhysical,
  } = deps;

  // Check document first before using it in error handlers
  if (!doc) {
    console.error('DomPainter: document is not available');

    // Use global document as fallback for error placeholder when available
    if (typeof document !== 'undefined') {
      const placeholder = document.createElement('div');
      placeholder.classList.add(CLASS_NAMES.fragment, 'superdoc-error-placeholder');
      placeholder.textContent = '[Document not available]';
      placeholder.style.border = '1px dashed red';
      placeholder.style.padding = '8px';
      return placeholder;
    }

    throw new Error('Document is required for table rendering');
  }
  const tableBorders = block.attrs?.borders;
  const tableIndentValue = (block.attrs?.tableIndent as { width?: unknown } | null | undefined)?.width;
  const tableIndent = typeof tableIndentValue === 'number' && Number.isFinite(tableIndentValue) ? tableIndentValue : 0;

  // RTL table: w:bidiVisual (ECMA-376 §17.4.1) — cells displayed right-to-left,
  // table-level properties (borders, margins, indent) are mirrored.
  const isRtl = getTableVisualDirection(block.attrs) === 'rtl';
  // Note: We don't use createTableBorderOverlay because we implement single-owner
  // border model where cells handle all borders (including outer table borders)
  // to prevent double borders when rendering with absolutely-positioned divs.

  const container = doc.createElement('div');
  container.classList.add(CLASS_NAMES.fragment);
  applyStyles(container, fragmentStyles);
  applyFragmentFrame(container, fragment);
  if (fragment.pmStart != null) {
    container.dataset.pmStart = String(fragment.pmStart);
  }
  if (fragment.pmEnd != null) {
    container.dataset.pmEnd = String(fragment.pmEnd);
  }
  container.style.height = `${fragment.height}px`;
  applySdtDataset(container, block.attrs?.sdt);
  applyContainerSdtDataset?.(container, block.attrs?.containerSdt);

  // Outer table border widths: reserve space so border is inside fragment size; content is offset
  const tableBorderWidths = measure.tableBorderWidths;
  if (tableBorderWidths) {
    container.style.boxSizing = 'border-box';
  }
  const contentLeft = tableBorderWidths?.left ?? 0;
  const contentTop = tableBorderWidths?.top ?? 0;

  // Apply SDT container styling (document sections, structured content blocks)
  if (
    applySdtContainerChrome(
      doc,
      container,
      block.attrs?.sdt,
      block.attrs?.containerSdt,
      sdtBoundary,
      {
        ancestorContainerKey,
        ancestorContainerSdt,
        ancestorContainerKeys,
        ancestorContainerSdts,
      },
      chrome,
    )
  ) {
    onSdtContainerChrome?.();
  }
  const tableContainerSdt = getSdtContainerMetadata(block.attrs?.sdt, block.attrs?.containerSdt);
  const tableContainerKey = getSdtContainerKey(block.attrs?.sdt, block.attrs?.containerSdt);
  const nextAncestorContainerKeys = [
    ...(ancestorContainerKeys ?? []),
    ancestorContainerKey,
    hasExplicitSdtContainerKey(block.attrs?.sdt, block.attrs?.containerSdt) ? tableContainerKey : null,
  ].filter((key): key is string => Boolean(key));
  const nextAncestorContainerSdts = [...(ancestorContainerSdts ?? []), ancestorContainerSdt, tableContainerSdt].filter(
    (sdt): sdt is SdtMetadata => Boolean(sdt),
  );
  const nextAncestorContainerKey = nextAncestorContainerKeys[nextAncestorContainerKeys.length - 1] ?? null;
  const nextAncestorContainerSdt = nextAncestorContainerSdts[nextAncestorContainerSdts.length - 1] ?? null;

  // Add table-specific class for resize overlay targeting and click mapping
  container.classList.add(DOM_CLASS_NAMES.TABLE_FRAGMENT);

  // Cell spacing pre-computed by the resolver; no cross-stage import needed.

  // Add metadata for interactive table resizing
  if (fragment.metadata?.columnBoundaries) {
    // Build row-aware boundary segments scoped to THIS fragment's rows.
    // When a table splits across pages, each fragment only renders a subset of rows
    // (repeated headers + body rows from fromRow to toRow). Segments must match
    // exactly the rendered rows so resize handles don't overflow the fragment.
    const columnCount = effectiveColumnWidths.length;

    // boundarySegments[colIndex] = array of {fromRow, toRow, y, height} segments where this boundary exists
    const boundarySegments: Array<Array<{ fromRow: number; toRow: number; y: number; height: number }>> = [];
    for (let i = 0; i < columnCount; i++) {
      boundarySegments.push([]);
    }

    // Build the list of rows actually rendered in this fragment, matching the
    // rendering order: repeated headers first, then body rows.
    // NOTE: This header-then-body iteration must stay in sync with the rendering
    // loop below (~line 315) which uses the same order to render row elements.
    const renderedRows: Array<{ rowIndex: number; height: number }> = [];

    // Repeated header rows (only on continuation fragments)
    if (fragment.repeatHeaderCount && fragment.repeatHeaderCount > 0) {
      for (let r = 0; r < fragment.repeatHeaderCount; r++) {
        const rowMeasure = measure.rows[r];
        if (!rowMeasure) break;
        renderedRows.push({ rowIndex: r, height: rowMeasure.height });
      }
    }

    // Body rows (fromRow to toRow), with partial row height for mid-row splits
    for (let r = fragment.fromRow; r < fragment.toRow; r++) {
      const rowMeasure = measure.rows[r];
      if (!rowMeasure) break;
      const isPartialRow = fragment.partialRow && fragment.partialRow.rowIndex === r;
      const actualHeight = isPartialRow ? fragment.partialRow!.partialHeight : rowMeasure.height;
      renderedRows.push({ rowIndex: r, height: actualHeight });
    }

    // For each rendered row, determine which grid columns have cell boundaries
    // A boundary exists at column X if there's a cell that ENDS at column X (gridColumnStart + colSpan = X)
    // rowY includes outer spacing (before first row, between rows, after last) so segment positions match rendered cells
    let rowY = cellSpacingPx;
    for (let i = 0; i < renderedRows.length; i++) {
      const { rowIndex, height } = renderedRows[i];
      const rowMeasure = measure.rows[rowIndex];
      if (!rowMeasure) continue;

      // Track which column boundaries exist in this row
      const boundariesInRow = new Set<number>();

      // Columns occupied by a cell in this row. Used to detect a trailing
      // w:gridAfter spacer column this row leaves empty.
      const occupiedCols = new Set<number>();
      for (const cellMeasure of rowMeasure.cells) {
        const s = cellMeasure.gridColumnStart ?? 0;
        const sp = cellMeasure.colSpan ?? 1;
        for (let c = s; c < s + sp; c++) occupiedCols.add(c);
      }
      // A degenerate trailing gridAfter spacer (last column, unoccupied this row,
      // narrower than its own min width) sits a few px from the table edge. Emitting
      // a resize boundary at its left edge crowds the table-edge handle and reads as a
      // doubled border on hover, so skip that boundary for this row (SD-3345).
      const lastColIndex = columnCount - 1;
      const lastColMeta = fragment.metadata.columnBoundaries[lastColIndex];
      const skipTrailingSpacerBoundary =
        lastColIndex > 0 &&
        !occupiedCols.has(lastColIndex) &&
        !!lastColMeta &&
        typeof lastColMeta.width === 'number' &&
        typeof lastColMeta.minWidth === 'number' &&
        lastColMeta.width < lastColMeta.minWidth;

      for (const cellMeasure of rowMeasure.cells) {
        const startCol = cellMeasure.gridColumnStart ?? 0;
        const colSpan = cellMeasure.colSpan ?? 1;
        const endCol = startCol + colSpan;

        // A cell creates boundaries at its start and end columns
        // Start boundary (left edge of cell)
        if (startCol > 0) {
          boundariesInRow.add(startCol);
        }
        // End boundary (right edge of cell), unless it lands on a degenerate
        // trailing gridAfter spacer (its left edge is the table edge for practical
        // purposes, handled by the table-edge handle).
        if (endCol < columnCount && !(skipTrailingSpacerBoundary && endCol === lastColIndex)) {
          boundariesInRow.add(endCol);
        }
      }

      // For each boundary that exists in this row, extend or create a segment
      for (const boundaryCol of boundariesInRow) {
        const segments = boundarySegments[boundaryCol];
        const lastSegment = segments[segments.length - 1];

        // If the last segment ends at the previous rendered row, extend it
        if (lastSegment && i > 0 && lastSegment.toRow === i) {
          lastSegment.toRow = i + 1;
          lastSegment.height += height;
        } else {
          // Start a new segment
          segments.push({
            fromRow: i,
            toRow: i + 1,
            y: rowY,
            height,
          });
        }
      }

      rowY += height + cellSpacingPx;
    }

    const metadata: Record<string, unknown> = {
      columns: fragment.metadata.columnBoundaries.map((boundary) => ({
        i: boundary.index,
        x: boundary.x + contentLeft,
        w: boundary.width,
        min: boundary.minWidth,
        r: boundary.resizable ? 1 : 0,
      })),
      rtl: isRtl,
      // Add segments for each column boundary (segments where resize handle should appear)
      segments: boundarySegments.map((segs, colIndex) =>
        segs.map((seg) => ({
          c: colIndex, // column index
          y: seg.y + contentTop, // y position (relative to table container)
          h: seg.height, // height of segment
        })),
      ),
    };

    // Add row boundary metadata for interactive row resizing
    // Where: i=index, y=position, h=height, min=minHeight, r=resizable(0/1)
    if (fragment.metadata.rowBoundaries && fragment.metadata.rowBoundaries.length > 0) {
      metadata.rows = fragment.metadata.rowBoundaries.map((rb) => ({
        i: rb.index,
        y: rb.y + contentTop,
        h: rb.height,
        min: rb.minHeight,
        r: rb.resizable ? 1 : 0,
      }));
    }

    container.setAttribute('data-table-boundaries', JSON.stringify(metadata));
  }

  // Add block ID for PM transaction targeting
  if (block.id) {
    container.setAttribute('data-sd-block-id', block.id);
  }

  const borderCollapse = block.attrs?.borderCollapse ?? (block.attrs?.cellSpacing != null ? 'separate' : 'collapse');
  if (borderCollapse === 'separate' && tableBorders) {
    applyBorder(container, 'Top', borderValueToSpec(tableBorders.top));
    applyBorder(container, 'Right', borderValueToSpec(isRtl ? tableBorders.left : tableBorders.right));
    applyBorder(container, 'Bottom', borderValueToSpec(tableBorders.bottom));
    applyBorder(container, 'Left', borderValueToSpec(isRtl ? tableBorders.right : tableBorders.left));
  }

  // Pre-calculate all row heights for rowspan calculations
  // IMPORTANT: If this fragment has a partial row, we need to use the partial height
  // for that row, not the full measured height. This ensures rowspan cells that
  // extend into the partial row are sized correctly for this fragment.
  const allRowHeights: number[] = measure.rows.map((r, idx: number) => {
    if (fragment.partialRow && fragment.partialRow.rowIndex === idx) {
      // Use partial height for the split row
      return fragment.partialRow.partialHeight;
    }
    return r?.height ?? 0;
  });

  // Per-row rightmost occupied grid column (exclusive), INCLUDING cells that span into a row
  // via w:vMerge (rowspan) from an earlier row. A single row's measure only lists the cells
  // that START in that row, so on a rowspan-continuation row the columns held by a spanning
  // cell look empty. The single-owner edge helpers (rowRightEdgeCol / nextRowMaxCol) would
  // then undercount and treat a leftmost cell as the rightmost column (drawing an interior
  // right border) or treat a covered column as a gridAfter gap (drawing an interior bottom),
  // doubling the shared edge. Counting rowspan occupancy keeps those edges single-owned.
  // (SD-1797)
  const rowOccupiedRightCols: number[] = new Array(measure.rows.length).fill(0);
  measure.rows.forEach((rowM, r) => {
    for (const c of rowM?.cells ?? []) {
      const right = (c.gridColumnStart ?? 0) + (c.colSpan ?? 1);
      const lastRow = Math.min(measure.rows.length - 1, r + (c.rowSpan ?? 1) - 1);
      for (let rr = r; rr <= lastRow; rr += 1) {
        if (right > rowOccupiedRightCols[rr]) rowOccupiedRightCols[rr] = right;
      }
    }
  });

  // First row starts after space before table content (space between table border and first row)
  let y = cellSpacingPx;

  // If this is a continuation fragment with repeated headers, render headers first.
  // NOTE: This header-then-body iteration must stay in sync with the metadata
  // segment builder above (~line 199) which uses the same order.
  if (fragment.repeatHeaderCount && fragment.repeatHeaderCount > 0) {
    for (let r = 0; r < fragment.repeatHeaderCount; r += 1) {
      const rowMeasure = measure.rows[r];
      if (!rowMeasure) break;
      yield* renderTableRowWork({
        doc,
        container,
        rowIndex: r,
        rowRole: 'repeat-header',
        y,
        rowMeasure,
        row: block.rows[r],
        prevRow: r > 0 ? block.rows[r - 1] : undefined,
        prevRowMeasure: r > 0 ? measure.rows[r - 1] : undefined,
        nextRow: r < block.rows.length - 1 ? block.rows[r + 1] : undefined,
        nextRowMeasure: r < block.rows.length - 1 ? measure.rows[r + 1] : undefined,
        rowOccupiedRightCol: rowOccupiedRightCols[r],
        nextRowOccupiedRightCol: rowOccupiedRightCols[r + 1],
        totalRows: block.rows.length,
        tableBorders,
        columnWidths: effectiveColumnWidths,
        allRowHeights,
        tableIndent,
        isRtl,
        context,
        renderLine,
        captureLineSnapshot,
        renderDrawingContent,
        applySdtDataset,
        ancestorContainerKey: nextAncestorContainerKey,
        ancestorContainerSdt: nextAncestorContainerSdt,
        ancestorContainerKeys: nextAncestorContainerKeys,
        ancestorContainerSdts: nextAncestorContainerSdts,
        onSdtContainerChrome,
        chrome,
        // Headers are always rendered as-is (no border suppression)
        continuesFromPrev: false,
        continuesOnNext: false,
        cellSpacingPx,
        resolvePhysical,
      });
      // Add row height + spacing after every row (including last) for outer spacing after last row
      y += rowMeasure.height + cellSpacingPx;
    }
  }

  // Render rowspan continuation cells ("ghost cells")
  // When a table continues from a previous fragment, some grid columns in the
  // first body rows may be occupied by rowspan cells that started on a previous page.
  // Create empty cells to maintain table structure and borders (matching Word behavior).
  if (fragment.continuesFromPrev && fragment.fromRow > 0) {
    const repeatCount = fragment.repeatHeaderCount ?? 0;

    for (let r = repeatCount; r < fragment.fromRow; r++) {
      const srcRowMeasure = measure.rows[r];
      if (!srcRowMeasure) continue;

      for (let ci = 0; ci < srcRowMeasure.cells.length; ci++) {
        const srcCellMeasure = srcRowMeasure.cells[ci];
        const rowSpan = srcCellMeasure.rowSpan ?? 1;
        if (rowSpan <= 1) continue;

        const spanEndRow = r + rowSpan;
        if (spanEndRow <= fragment.fromRow) continue;

        // This cell's rowspan extends into this fragment's body rows
        const gridCol = srcCellMeasure.gridColumnStart ?? 0;
        const colSpan = srcCellMeasure.colSpan ?? 1;

        // Calculate x position (sum of columns before gridCol)
        let ghostX = 0;
        for (let i = 0; i < gridCol && i < effectiveColumnWidths.length; i++) {
          ghostX += effectiveColumnWidths[i];
        }

        // Calculate width (sum of spanned columns)
        let ghostWidth = 0;
        for (let i = gridCol; i < gridCol + colSpan && i < effectiveColumnWidths.length; i++) {
          ghostWidth += effectiveColumnWidths[i];
        }

        // RTL: mirror ghost cell x position.
        // ghostX must include spacing to match the totalWidth formula.
        if (isRtl && ghostWidth > 0) {
          let totalWidth = cellSpacingPx;
          for (let i = 0; i < effectiveColumnWidths.length; i++) {
            totalWidth += effectiveColumnWidths[i] + cellSpacingPx;
          }
          // Recompute ghostX with spacing (matching calculateXPosition in renderTableRow)
          let ghostXWithSpacing = cellSpacingPx;
          for (let i = 0; i < gridCol && i < effectiveColumnWidths.length; i++) {
            ghostXWithSpacing += effectiveColumnWidths[i] + cellSpacingPx;
          }
          ghostX = totalWidth - ghostXWithSpacing - ghostWidth;
        }

        // Calculate height: from fromRow to min(spanEndRow, toRow)
        const effectiveEnd = Math.min(spanEndRow, fragment.toRow);
        let ghostHeight = 0;
        for (let ri = fragment.fromRow; ri < effectiveEnd; ri++) {
          ghostHeight += allRowHeights[ri] ?? 0;
        }

        if (ghostWidth <= 0 || ghostHeight <= 0) continue;

        // Create ghost cell
        const ghostDiv = doc.createElement('div');
        ghostDiv.style.position = 'absolute';
        ghostDiv.style.left = `${ghostX}px`;
        ghostDiv.style.top = `${y}px`;
        ghostDiv.style.width = `${ghostWidth}px`;
        ghostDiv.style.height = `${ghostHeight}px`;
        ghostDiv.style.boxSizing = 'border-box';
        ghostDiv.style.overflow = 'hidden';

        // Resolve borders for the ghost cell
        const srcCell = block.rows[r]?.cells?.[ci];
        const cellBordersAttr = srcCell?.attrs?.borders;
        const explicit = hasExplicitCellBorders(cellBordersAttr);
        const cellBounds = getTableCellGridBounds({
          rowIndex: r,
          rowSpan,
          gridColumnStart: gridCol,
          colSpan,
          totalRows: block.rows.length,
          totalCols: effectiveColumnWidths.length,
        });
        const cellEndsWithinFragment = effectiveEnd <= fragment.toRow && spanEndRow <= fragment.toRow;

        if (tableBorders) {
          // Resolve borders using logical positions
          const topB = (explicit ? cellBordersAttr.top : undefined) ?? borderValueToSpec(tableBorders.top);
          let leftB =
            (explicit ? cellBordersAttr.left : undefined) ??
            borderValueToSpec(cellBounds.touchesLeftEdge ? tableBorders.left : tableBorders.insideV);
          let rightB =
            (explicit ? cellBordersAttr.right : undefined) ??
            borderValueToSpec(cellBounds.touchesRightEdge ? tableBorders.right : tableBorders.insideV);
          const bottomB = cellEndsWithinFragment
            ? ((explicit ? cellBordersAttr.bottom : undefined) ??
              borderValueToSpec(cellBounds.touchesBottomEdge ? tableBorders.bottom : tableBorders.insideH))
            : undefined;

          // RTL: swap resolved left↔right so CSS matches visual edges
          if (isRtl) {
            const tmp = leftB;
            leftB = rightB;
            rightB = tmp;
          }

          applyBorder(ghostDiv, 'Top', topB);
          applyBorder(ghostDiv, 'Left', leftB);
          applyBorder(ghostDiv, 'Right', rightB);
          if (bottomB) applyBorder(ghostDiv, 'Bottom', bottomB);
        }

        // Apply cell background if present
        if (srcCell?.attrs?.background) {
          ghostDiv.style.backgroundColor = srcCell.attrs.background;
        }

        container.appendChild(ghostDiv);
      }
    }
  }

  // Render body rows (fromRow to toRow)
  for (let r = fragment.fromRow; r < fragment.toRow; r += 1) {
    yield;
    const rowMeasure = measure.rows[r];
    if (!rowMeasure) break;

    const isFirstRenderedBodyRow = r === fragment.fromRow;
    const isLastRenderedBodyRow = r === fragment.toRow - 1;

    // Check if this row has partial row data (mid-row split)
    const isPartialRow = fragment.partialRow && fragment.partialRow.rowIndex === r;
    const partialRowData = isPartialRow ? fragment.partialRow : undefined;
    const actualRowHeight = partialRowData ? partialRowData.partialHeight : rowMeasure.height;

    yield* renderTableRowWork({
      doc,
      container,
      rowIndex: r,
      rowRole: 'body',
      y,
      rowMeasure,
      row: block.rows[r],
      prevRow: r > 0 ? block.rows[r - 1] : undefined,
      prevRowMeasure: r > 0 ? measure.rows[r - 1] : undefined,
      nextRow: r < block.rows.length - 1 ? block.rows[r + 1] : undefined,
      nextRowMeasure: r < block.rows.length - 1 ? measure.rows[r + 1] : undefined,
      rowOccupiedRightCol: rowOccupiedRightCols[r],
      nextRowOccupiedRightCol: rowOccupiedRightCols[r + 1],
      totalRows: block.rows.length,
      tableBorders,
      columnWidths: effectiveColumnWidths,
      allRowHeights,
      tableIndent,
      isRtl,
      context,
      renderLine,
      captureLineSnapshot,
      renderDrawingContent,
      applySdtDataset,
      ancestorContainerKey: nextAncestorContainerKey,
      ancestorContainerSdt: nextAncestorContainerSdt,
      ancestorContainerKeys: nextAncestorContainerKeys,
      ancestorContainerSdts: nextAncestorContainerSdts,
      onSdtContainerChrome,
      chrome,
      // Draw top border if table continues from previous fragment (MS Word behavior)
      continuesFromPrev: isFirstRenderedBodyRow && fragment.continuesFromPrev === true,
      // Draw bottom border if table continues on next fragment (MS Word behavior)
      continuesOnNext: isLastRenderedBodyRow && fragment.continuesOnNext === true,
      // Pass partial row data for mid-row splits
      partialRow: partialRowData,
      cellSpacingPx,
      resolvePhysical,
    });
    // Add row height + spacing after every row (including last) for outer spacing after last row
    y += actualRowHeight + cellSpacingPx;
  }

  return container;
}

export const renderTableFragment = (deps: TableRenderDependencies): HTMLElement =>
  completeRenderWork(renderTableFragmentWork(deps));
