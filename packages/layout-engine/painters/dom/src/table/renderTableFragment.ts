import { completeRenderWork, type RenderWork } from '../render-work.js';
import type {
  CellBorders,
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
import { getRenderedTableBorderWidthPx, getTableVisualDirection } from '@superdoc/contracts';
import type { ResolvePhysicalFamily } from '@superdoc/font-system';
import { CLASS_NAMES, fragmentStyles } from '../styles.js';
import { DOM_CLASS_NAMES } from '../constants.js';
import type { FragmentRenderContext } from '../renderer.js';
import { TABLE_ROW_ROLE_ATTRIBUTE, type TableRowRole } from './row-role.js';
import { renderTableCellWork } from './renderTableCell.js';
import { renderTableRowWork } from './renderTableRow.js';
import {
  applySdtContainerChrome,
  getSdtContainerKey,
  getSdtContainerMetadata,
  hasExplicitSdtContainerKey,
  type SdtAncestorOptions,
  type SdtBoundaryOptions,
} from '../sdt/container.js';
import {
  applyCellBorders,
  borderValueToSpec,
  createCellBorderOverlay,
  hasExplicitCellBorders,
} from './border-utils.js';
import { getTableCellGridBounds } from './grid-geometry.js';

type ApplyStylesFn = (el: HTMLElement, styles: Partial<CSSStyleDeclaration>) => void;

const applyFragmentBorders = (
  doc: Document,
  element: HTMLElement,
  borders: CellBorders,
  geometry: { left: string; top: string; width: number; height: number },
): SVGSVGElement | null => {
  applyCellBorders(element, borders);
  const compoundBorders: CellBorders = {};
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    if (borders[side]?.style === 'thinThickThinLargeGap') compoundBorders[side] = borders[side];
  }
  applyCellBorders(element, compoundBorders, true);
  return createCellBorderOverlay(doc, compoundBorders, geometry);
};

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
  if (block.anchor?.isAnchored) container.dataset.sdTableFloating = 'true';
  applyStyles(container, fragmentStyles);
  applyFragmentFrame(container, fragment);
  if (fragment.pmStart != null) {
    container.dataset.pmStart = String(fragment.pmStart);
  }
  if (fragment.pmEnd != null) {
    container.dataset.pmEnd = String(fragment.pmEnd);
  }
  if (fragment.continuesFromPrev) container.dataset.continuesFromPrev = 'true';
  if (fragment.continuesOnNext) container.dataset.continuesOnNext = 'true';
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
  const groups: TablePaintCellGroup[] = [];
  let ghostCells = 0;
  let sdtChrome = false;
  const noteSdtContainerChrome = (): void => {
    sdtChrome = true;
    onSdtContainerChrome?.();
  };
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
    noteSdtContainerChrome();
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

  applyTableBoundariesMetadata(container, {
    fragment,
    measure,
    effectiveColumnWidths,
    cellSpacingPx,
    isRtl,
    contentLeft,
    contentTop,
  });

  // Add block ID for PM transaction targeting
  if (block.id) {
    container.setAttribute('data-sd-block-id', block.id);
  }

  const borderCollapse = block.attrs?.borderCollapse ?? (block.attrs?.cellSpacing != null ? 'separate' : 'collapse');
  if (borderCollapse === 'separate' && tableBorders) {
    const borders = {
      top: borderValueToSpec(tableBorders.top),
      right: borderValueToSpec(isRtl ? tableBorders.left : tableBorders.right),
      bottom: borderValueToSpec(tableBorders.bottom),
      left: borderValueToSpec(isRtl ? tableBorders.right : tableBorders.left),
    };
    const leftWidth = (borders.left?.width ?? 1) > 0 ? getRenderedTableBorderWidthPx(borders.left, 1) : 0;
    const topWidth = (borders.top?.width ?? 1) > 0 ? getRenderedTableBorderWidthPx(borders.top, 1) : 0;
    const overlay = applyFragmentBorders(doc, container, borders, {
      left: `${-leftWidth}px`,
      top: `${-topWidth}px`,
      width: fragment.width,
      height: fragment.height,
    });
    if (overlay) container.appendChild(overlay);
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
    return fragment.rowHeightOverrides?.[idx] ?? r?.height ?? 0;
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
        onSdtContainerChrome: noteSdtContainerChrome,
        chrome,
        // Headers are always rendered as-is (no border suppression)
        continuesFromPrev: false,
        continuesOnNext: false,
        cellSpacingPx,
        resolvePhysical,
        onCellRendered: (cellIndex, elements) =>
          groups.push({ rowIndex: r, cellIndex, role: 'repeat-header', elements }),
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
          ghostHeight +=
            fragment.partialRow?.rowIndex === ri ? fragment.partialRow.partialHeight : (allRowHeights[ri] ?? 0);
        }

        if (ghostWidth <= 0 || ghostHeight <= 0) continue;

        const srcCell = block.rows[r]?.cells?.[ci];
        const slice = fragment.mergedCellContent?.find((item) => item.rowIndex === r && item.cellIndex === ci);
        const ghostResult = slice
          ? yield* renderTableCellWork({
              doc,
              x: ghostX,
              y,
              rowHeight: ghostHeight,
              cellWidth: ghostWidth,
              cellMeasure: srcCellMeasure,
              cell: srcCell,
              fromLine: slice.fromLine,
              toLine: slice.toLine,
              renderLine,
              captureLineSnapshot,
              renderDrawingContent,
              context,
              applySdtDataset,
              ancestorContainerKey: nextAncestorContainerKey,
              ancestorContainerSdt: nextAncestorContainerSdt,
              ancestorContainerKeys: nextAncestorContainerKeys,
              ancestorContainerSdts: nextAncestorContainerSdts,
              onSdtContainerChrome: noteSdtContainerChrome,
              chrome,
              resolvePhysical,
              isRtl,
            })
          : undefined;
        const ghostDiv = ghostResult?.cellElement ?? doc.createElement('div');
        ghostDiv.setAttribute(TABLE_ROW_ROLE_ATTRIBUTE, 'body');
        ghostDiv.style.position = 'absolute';
        ghostDiv.style.left = `${ghostX}px`;
        ghostDiv.style.top = `${y}px`;
        ghostDiv.style.width = `${ghostWidth}px`;
        ghostDiv.style.height = `${ghostHeight}px`;
        ghostDiv.style.boxSizing = 'border-box';
        ghostDiv.style.overflow = 'hidden';

        // Resolve borders for the ghost cell
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
        // A page break is an outer edge even when the logical merge continues.
        const touchesFragmentBottom =
          cellSpacingPx === 0 && spanEndRow >= fragment.toRow && fragment.continuesOnNext === true;

        let ghostBorderOverlay: SVGSVGElement | null = null;
        if (tableBorders) {
          // Resolve borders using logical positions
          const topB = (explicit ? cellBordersAttr.top : undefined) ?? borderValueToSpec(tableBorders.top);
          let leftB =
            (explicit ? cellBordersAttr.left : undefined) ??
            borderValueToSpec(cellBounds.touchesLeftEdge ? tableBorders.left : tableBorders.insideV);
          let rightB =
            (explicit ? cellBordersAttr.right : undefined) ??
            borderValueToSpec(cellBounds.touchesRightEdge ? tableBorders.right : tableBorders.insideV);
          const bottomB =
            cellEndsWithinFragment || touchesFragmentBottom
              ? ((explicit ? cellBordersAttr.bottom : undefined) ??
                borderValueToSpec(
                  cellBounds.touchesBottomEdge || touchesFragmentBottom ? tableBorders.bottom : tableBorders.insideH,
                ))
              : undefined;

          // RTL: swap resolved left↔right so CSS matches visual edges
          if (isRtl) {
            const tmp = leftB;
            leftB = rightB;
            rightB = tmp;
          }

          ghostBorderOverlay = applyFragmentBorders(
            doc,
            ghostDiv,
            { top: topB, left: leftB, right: rightB, bottom: bottomB },
            { left: ghostDiv.style.left, top: ghostDiv.style.top, width: ghostWidth, height: ghostHeight },
          );
        }

        // Apply cell background if present
        if (srcCell?.attrs?.background) {
          ghostDiv.style.backgroundColor = srcCell.attrs.background;
        }

        container.appendChild(ghostDiv);
        for (const marker of ghostResult?.reviewMarkers ?? []) container.appendChild(marker);
        if (ghostBorderOverlay) container.appendChild(ghostBorderOverlay);
        ghostCells += 1;
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
    const actualRowHeight = partialRowData ? partialRowData.partialHeight : allRowHeights[r];

    yield* renderTableRowWork({
      doc,
      container,
      rowIndex: r,
      rowRole: 'body',
      y,
      rowMeasure:
        fragment.rowHeightOverrides?.[r] !== undefined ? { ...rowMeasure, height: allRowHeights[r] } : rowMeasure,
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
      fragmentEndRow: fragment.toRow,
      mergedCellContent: fragment.mergedCellContent,
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
      onSdtContainerChrome: noteSdtContainerChrome,
      chrome,
      // Draw top border if table continues from previous fragment (MS Word behavior)
      continuesFromPrev: isFirstRenderedBodyRow && fragment.continuesFromPrev === true,
      // Draw bottom border if table continues on next fragment (MS Word behavior)
      continuesOnNext: isLastRenderedBodyRow && fragment.continuesOnNext === true,
      // Pass partial row data for mid-row splits
      partialRow: partialRowData,
      cellSpacingPx,
      resolvePhysical,
      onCellRendered: (cellIndex, elements) => groups.push({ rowIndex: r, cellIndex, role: 'body', elements }),
    });
    // Add row height + spacing after every row (including last) for outer spacing after last row
    y += actualRowHeight + cellSpacingPx;
  }

  tablePaintLedgers.set(container, {
    block,
    measure,
    fragment,
    context,
    effectiveColumnWidths,
    cellSpacingPx,
    chrome,
    groups,
    ghostCells,
    sdtChrome,
  });
  return container;
}

export const renderTableFragment = (deps: TableRenderDependencies): HTMLElement =>
  completeRenderWork(renderTableFragmentWork(deps));

type TableBoundariesMetadataInput = {
  fragment: TableFragment;
  measure: TableMeasure;
  effectiveColumnWidths: readonly number[];
  cellSpacingPx: number;
  isRtl: boolean;
  contentLeft: number;
  contentTop: number;
};

/** Column/row resize metadata for the rows this fragment actually paints. */
function applyTableBoundariesMetadata(container: HTMLElement, input: TableBoundariesMetadataInput): void {
  const { fragment, measure, effectiveColumnWidths, cellSpacingPx, isRtl, contentLeft, contentTop } = input;
  if (!fragment.metadata?.columnBoundaries) return;
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
    const actualHeight = isPartialRow
      ? fragment.partialRow!.partialHeight
      : (fragment.rowHeightOverrides?.[r] ?? rowMeasure.height);
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

// ---------------------------------------------------------------------------
// In-place table fragment patching
//
// A table fragment is one DOM subtree whose children are the painted cells in
// row-major order (plus border overlays that follow their cell). Rebuilding
// that subtree for a one-cell text edit recreates every cell. The ledger below
// retains what a render painted so a later paint can prove, cell by cell,
// which inputs are unchanged and leave that DOM untouched.

/** One painted cell: the cell element plus any border overlays appended after it. */
export type TablePaintCellGroup = {
  rowIndex: number;
  cellIndex: number;
  role: TableRowRole;
  elements: Element[];
};

export type TablePaintLedger = {
  block: TableBlock;
  measure: TableMeasure;
  fragment: TableFragment;
  context: FragmentRenderContext;
  effectiveColumnWidths: readonly number[];
  cellSpacingPx: number;
  chrome: 'default' | 'none' | undefined;
  groups: TablePaintCellGroup[];
  /** Rowspan continuation ("ghost") cells painted outside the cell groups. */
  ghostCells: number;
  /** The table root or a descendant rendered SDT container chrome. */
  sdtChrome: boolean;
};

const tablePaintLedgers = new WeakMap<HTMLElement, TablePaintLedger>();

export function readTablePaintLedger(container: HTMLElement): TablePaintLedger | undefined {
  return tablePaintLedgers.get(container);
}

/**
 * Resolves the immutable source identity of a painted cell. The default is the
 * cell object itself; a host whose paint blocks are pm-rebased clones supplies
 * the clone's source owner so unchanged cells keep one identity across edits.
 */
export type TableCellSourceIdentity = (block: TableBlock, rowIndex: number, cellIndex: number) => object | null;

export type TableFragmentPatchInput = TableRenderDependencies & {
  /** The fragment element painted by an earlier `renderTableFragmentWork`. */
  container: HTMLElement;
  cellSourceIdentity?: TableCellSourceIdentity;
};

export type TableFragmentPatchPlan = {
  input: TableFragmentPatchInput;
  previous: TablePaintLedger;
  /** Rendered rows in paint order with the cells whose DOM must be rebuilt. */
  rows: Array<{ rowIndex: number; role: TableRowRole; y: number; changed: Set<number> }>;
  /** Unchanged cell groups and the pm delta their position attributes move by. */
  reused: Array<{ group: TablePaintCellGroup; pmDelta: number }>;
  cellsChanged: number;
};

export type TableFragmentPatchResult = { cellsRendered: number; cellsReused: number };

const defaultCellSourceIdentity: TableCellSourceIdentity = (block, rowIndex, cellIndex) =>
  block.rows[rowIndex]?.cells[cellIndex] ?? null;

function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left == null || right == null) return left == right;
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameNumbers(left: readonly number[] | undefined, right: readonly number[] | undefined): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return false;
  return true;
}

/** Scalar render context equal, object-valued inputs identical. */
function sameRenderContext(previous: FragmentRenderContext, next: FragmentRenderContext): boolean {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const key of keys) {
    const left = (previous as Record<string, unknown>)[key];
    const right = (next as Record<string, unknown>)[key];
    if (left === right) continue;
    if (key === 'story' && sameJson(left, right)) continue;
    return false;
  }
  return true;
}

function sameCellMeasureGeometry(
  previous: TableMeasure['rows'][number]['cells'][number],
  next: typeof previous,
): boolean {
  return (
    previous.width === next.width &&
    previous.height === next.height &&
    (previous.gridColumnStart ?? null) === (next.gridColumnStart ?? null) &&
    (previous.colSpan ?? 1) === (next.colSpan ?? 1) &&
    (previous.rowSpan ?? 1) === (next.rowSpan ?? 1) &&
    sameJson(previous.verticalText, next.verticalText)
  );
}

function sameCellMeasureContent(
  previous: TableMeasure['rows'][number]['cells'][number],
  next: typeof previous,
): boolean {
  if (previous.paragraph !== next.paragraph) return false;
  if (previous.blocks === next.blocks) return true;
  if (!previous.blocks || !next.blocks || previous.blocks.length !== next.blocks.length) return false;
  for (let index = 0; index < previous.blocks.length; index += 1) {
    if (previous.blocks[index] !== next.blocks[index]) return false;
  }
  return true;
}

type PmCarrier = { pmStart?: number; pmEnd?: number };

function collectPmValues(block: FlowBlockLike, out: number[]): boolean {
  if (block.kind !== 'paragraph') return false;
  const carrier = block as PmCarrier;
  if (typeof carrier.pmStart === 'number') out.push(carrier.pmStart);
  if (typeof carrier.pmEnd === 'number') out.push(carrier.pmEnd);
  for (const run of block.runs) {
    const span = run as PmCarrier;
    if (typeof span.pmStart === 'number') out.push(span.pmStart);
    if (typeof span.pmEnd === 'number') out.push(span.pmEnd);
  }
  return true;
}

type FlowBlockLike = NonNullable<TableBlock['rows'][number]['cells'][number]['blocks']>[number];

/**
 * The uniform pm shift between two paintings of one unchanged cell, or null
 * when the shift is not provably uniform (then the cell is repainted).
 */
function uniformCellPmDelta(
  previous: TableBlock['rows'][number]['cells'][number],
  next: typeof previous,
): number | null {
  const previousBlocks = previous.blocks ?? (previous.paragraph ? [previous.paragraph] : []);
  const nextBlocks = next.blocks ?? (next.paragraph ? [next.paragraph] : []);
  if (previousBlocks.length !== nextBlocks.length) return null;
  const before: number[] = [];
  const after: number[] = [];
  for (let index = 0; index < previousBlocks.length; index += 1) {
    if (!collectPmValues(previousBlocks[index]!, before) || !collectPmValues(nextBlocks[index]!, after)) return null;
  }
  if (before.length !== after.length) return null;
  if (before.length === 0) return 0;
  const delta = after[0]! - before[0]!;
  for (let index = 1; index < before.length; index += 1) {
    if (after[index]! - before[index]! !== delta) return null;
  }
  return delta;
}

function renderedRowOrder(
  fragment: TableFragment,
  measure: TableMeasure,
): Array<{ rowIndex: number; role: TableRowRole }> {
  const rows: Array<{ rowIndex: number; role: TableRowRole }> = [];
  if (fragment.repeatHeaderCount && fragment.repeatHeaderCount > 0) {
    for (let r = 0; r < fragment.repeatHeaderCount; r += 1) {
      if (!measure.rows[r]) break;
      rows.push({ rowIndex: r, role: 'repeat-header' });
    }
  }
  for (let r = fragment.fromRow; r < fragment.toRow; r += 1) {
    if (!measure.rows[r]) break;
    rows.push({ rowIndex: r, role: 'body' });
  }
  return rows;
}

function shiftPmAttributes(root: Element, delta: number): void {
  const element = root as HTMLElement;
  const shift = (target: HTMLElement): void => {
    const start = target.dataset.pmStart;
    if (start !== undefined && start !== '') {
      const value = Number(start);
      if (Number.isFinite(value)) target.dataset.pmStart = String(value + delta);
    }
    const end = target.dataset.pmEnd;
    if (end !== undefined && end !== '') {
      const value = Number(end);
      if (Number.isFinite(value)) target.dataset.pmEnd = String(value + delta);
    }
  };
  shift(element);
  for (const descendant of Array.from(element.querySelectorAll<HTMLElement>('[data-pm-start], [data-pm-end]'))) {
    shift(descendant);
  }
}

/**
 * Decide whether `container` can be brought to `input`'s table without a
 * rebuild. Every unproven condition yields null; the plan names exactly the
 * cells to repaint. Pure: it mutates nothing.
 */
export function planTableFragmentPatch(input: TableFragmentPatchInput): TableFragmentPatchPlan | null {
  const { container, fragment, block, measure, effectiveColumnWidths, cellSpacingPx, context } = input;
  const previous = tablePaintLedgers.get(container);
  if (!previous || previous.fragment.blockId !== fragment.blockId || previous.block.id !== block.id) return null;
  if (previous.chrome !== input.chrome || previous.sdtChrome || previous.ghostCells > 0) return null;
  if (
    (fragment.width !== previous.fragment.width || fragment.height !== previous.fragment.height) &&
    (block.attrs?.borderCollapse ?? (block.attrs?.cellSpacing != null ? 'separate' : 'collapse')) === 'separate' &&
    (['top', 'right', 'bottom', 'left'] as const).some((side) => {
      const border = borderValueToSpec(block.attrs?.borders?.[side]);
      return border?.style === 'thinThickThinLargeGap' && (border.width ?? 1) > 0;
    })
  )
    return null;
  if (fragment.partialRow || previous.fragment.partialRow) return null;
  if (fragment.mergedCellContent?.length || previous.fragment.mergedCellContent?.length) return null;
  if (
    fragment.fromRow !== previous.fragment.fromRow ||
    fragment.toRow !== previous.fragment.toRow ||
    (fragment.repeatHeaderCount ?? 0) !== (previous.fragment.repeatHeaderCount ?? 0) ||
    (fragment.continuesFromPrev ?? false) !== (previous.fragment.continuesFromPrev ?? false) ||
    (fragment.continuesOnNext ?? false) !== (previous.fragment.continuesOnNext ?? false) ||
    (fragment.isAnchored ?? false) !== (previous.fragment.isAnchored ?? false) ||
    !sameJson(fragment.rowHeightOverrides, previous.fragment.rowHeightOverrides) ||
    !sameNumbers(fragment.columnWidths, previous.fragment.columnWidths)
  )
    return null;
  if (
    cellSpacingPx !== previous.cellSpacingPx ||
    !sameNumbers(effectiveColumnWidths, previous.effectiveColumnWidths) ||
    !sameNumbers(measure.columnWidths, previous.measure.columnWidths) ||
    measure.totalWidth !== previous.measure.totalWidth ||
    !sameJson(measure.tableBorderWidths, previous.measure.tableBorderWidths) ||
    measure.rows.length !== previous.measure.rows.length ||
    block.rows.length !== previous.block.rows.length
  )
    return null;
  for (let r = 0; r < measure.rows.length; r += 1) {
    if (measure.rows[r]!.height !== previous.measure.rows[r]!.height) return null;
  }
  if (!sameJson(block.attrs, previous.block.attrs)) return null;
  if (!sameRenderContext(previous.context, context)) return null;

  const identity = input.cellSourceIdentity ?? defaultCellSourceIdentity;
  const groupsByCell = new Map<string, TablePaintCellGroup>();
  for (const group of previous.groups) groupsByCell.set(`${group.rowIndex}:${group.cellIndex}`, group);
  const order = renderedRowOrder(fragment, measure);
  if (order.length !== renderedRowOrder(previous.fragment, previous.measure).length) return null;
  const rows: TableFragmentPatchPlan['rows'] = [];
  const reused: TableFragmentPatchPlan['reused'] = [];
  let cellsChanged = 0;
  let groupCount = 0;
  let y = cellSpacingPx;
  for (const { rowIndex, role } of order) {
    const row = block.rows[rowIndex];
    const previousRow = previous.block.rows[rowIndex];
    const rowMeasure = measure.rows[rowIndex]!;
    const previousRowMeasure = previous.measure.rows[rowIndex]!;
    if (!row || !previousRow || row.cells.length !== previousRow.cells.length) return null;
    if (rowMeasure.cells.length !== previousRowMeasure.cells.length) return null;
    if (!sameJson(row.attrs, previousRow.attrs)) return null;
    const changed = new Set<number>();
    for (let cellIndex = 0; cellIndex < rowMeasure.cells.length; cellIndex += 1) {
      const cellMeasure = rowMeasure.cells[cellIndex]!;
      const previousCellMeasure = previousRowMeasure.cells[cellIndex]!;
      if ((cellMeasure.rowSpan ?? 1) !== 1 || !sameCellMeasureGeometry(previousCellMeasure, cellMeasure)) return null;
      const cell = row.cells[cellIndex];
      const previousCell = previousRow.cells[cellIndex];
      if (!cell || !previousCell || (cell.rowSpan ?? 1) !== 1) return null;
      if ((cell.colSpan ?? 1) !== (previousCell.colSpan ?? 1) || (cell.rowSpan ?? 1) !== (previousCell.rowSpan ?? 1))
        return null;
      const group = groupsByCell.get(`${rowIndex}:${cellIndex}`);
      if (!group || group.role !== role || group.elements.some((element) => element.parentNode !== container))
        return null;
      groupCount += 1;
      const previousSource = identity(previous.block, rowIndex, cellIndex);
      const source = identity(block, rowIndex, cellIndex);
      const unchanged =
        previousSource != null && previousSource === source && sameCellMeasureContent(previousCellMeasure, cellMeasure);
      const pmDelta = unchanged ? uniformCellPmDelta(previousCell, cell) : null;
      if (pmDelta != null) {
        reused.push({ group, pmDelta });
        continue;
      }
      // Border resolution reads neighbor cell attrs, so a repainted cell must
      // keep the attrs its neighbors were painted against.
      if (!sameJson(cell.attrs, previousCell.attrs)) return null;
      changed.add(cellIndex);
      cellsChanged += 1;
    }
    rows.push({ rowIndex, role, y, changed });
    // Mirrors the render loop: body rows honor sparse height overrides, header copies do not.
    y +=
      (role === 'body' ? (fragment.rowHeightOverrides?.[rowIndex] ?? rowMeasure.height) : rowMeasure.height) +
      cellSpacingPx;
  }
  if (groupCount !== previous.groups.length) return null;
  return { input, previous, rows, reused, cellsChanged };
}

/** Apply a plan from {@link planTableFragmentPatch}; the container stays the fragment element. */
export function* applyTableFragmentPatchWork(plan: TableFragmentPatchPlan): RenderWork<TableFragmentPatchResult> {
  const { input, previous } = plan;
  const {
    doc,
    container,
    fragment,
    block,
    measure,
    cellSpacingPx,
    effectiveColumnWidths,
    chrome,
    context,
    ancestorContainerKey,
    ancestorContainerSdt,
    ancestorContainerKeys,
    ancestorContainerSdts,
    onSdtContainerChrome,
    renderLine,
    captureLineSnapshot,
    renderDrawingContent,
    applySdtDataset,
    resolvePhysical,
  } = input;
  const tableBorders = block.attrs?.borders;
  const tableIndentValue = (block.attrs?.tableIndent as { width?: unknown } | null | undefined)?.width;
  const tableIndent = typeof tableIndentValue === 'number' && Number.isFinite(tableIndentValue) ? tableIndentValue : 0;
  const isRtl = getTableVisualDirection(block.attrs) === 'rtl';
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
  const allRowHeights: number[] = measure.rows.map((r, idx) => fragment.rowHeightOverrides?.[idx] ?? r?.height ?? 0);
  const rowOccupiedRightCols: number[] = new Array(measure.rows.length).fill(0);
  measure.rows.forEach((rowM, r) => {
    for (const c of rowM?.cells ?? []) {
      const right = (c.gridColumnStart ?? 0) + (c.colSpan ?? 1);
      const lastRow = Math.min(measure.rows.length - 1, r + (c.rowSpan ?? 1) - 1);
      for (let rr = r; rr <= lastRow; rr += 1) {
        if (right > rowOccupiedRightCols[rr]!) rowOccupiedRightCols[rr] = right;
      }
    }
  });
  let sdtChrome = false;
  const noteSdtContainerChrome = (): void => {
    sdtChrome = true;
    onSdtContainerChrome?.();
  };
  const groupsByCell = new Map<string, TablePaintCellGroup>();
  for (const group of previous.groups) groupsByCell.set(`${group.rowIndex}:${group.cellIndex}`, group);
  let cellsRendered = 0;
  for (const { rowIndex: r, role, y, changed } of plan.rows) {
    if (changed.size === 0) continue;
    yield;
    const staging = doc.createElement('div');
    const rendered: TablePaintCellGroup[] = [];
    const rowMeasure = measure.rows[r]!;
    const isFirstRenderedBodyRow = r === fragment.fromRow;
    const isLastRenderedBodyRow = r === fragment.toRow - 1;
    yield* renderTableRowWork({
      doc,
      container: staging,
      rowIndex: r,
      rowRole: role,
      y,
      rowMeasure:
        role === 'body' && fragment.rowHeightOverrides?.[r] !== undefined
          ? { ...rowMeasure, height: allRowHeights[r]! }
          : rowMeasure,
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
      ...(role === 'body' ? { fragmentEndRow: fragment.toRow, mergedCellContent: fragment.mergedCellContent } : {}),
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
      onSdtContainerChrome: noteSdtContainerChrome,
      chrome,
      continuesFromPrev: role === 'body' && isFirstRenderedBodyRow && fragment.continuesFromPrev === true,
      continuesOnNext: role === 'body' && isLastRenderedBodyRow && fragment.continuesOnNext === true,
      cellSpacingPx,
      resolvePhysical,
      onlyCellIndices: changed,
      onCellRendered: (cellIndex, elements) => rendered.push({ rowIndex: r, cellIndex, role, elements }),
    });
    for (const group of rendered) {
      const stale = groupsByCell.get(`${group.rowIndex}:${group.cellIndex}`)!;
      const before = stale.elements[0]!;
      for (const element of group.elements) container.insertBefore(element, before);
      for (const element of stale.elements) element.remove();
      groupsByCell.set(`${group.rowIndex}:${group.cellIndex}`, group);
      cellsRendered += 1;
    }
  }
  for (const { group, pmDelta } of plan.reused) {
    if (pmDelta === 0) continue;
    for (const element of group.elements) shiftPmAttributes(element, pmDelta);
  }
  if (fragment.pmStart != null) container.dataset.pmStart = String(fragment.pmStart);
  else delete container.dataset.pmStart;
  if (fragment.pmEnd != null) container.dataset.pmEnd = String(fragment.pmEnd);
  else delete container.dataset.pmEnd;
  container.style.height = `${fragment.height}px`;
  const tableBorderWidths = measure.tableBorderWidths;
  applyTableBoundariesMetadata(container, {
    fragment,
    measure,
    effectiveColumnWidths,
    cellSpacingPx,
    isRtl,
    contentLeft: tableBorderWidths?.left ?? 0,
    contentTop: tableBorderWidths?.top ?? 0,
  });
  const groups: TablePaintCellGroup[] = [];
  for (const { rowIndex, role } of plan.rows) {
    const rowMeasure = measure.rows[rowIndex]!;
    for (let cellIndex = 0; cellIndex < rowMeasure.cells.length; cellIndex += 1) {
      const group = groupsByCell.get(`${rowIndex}:${cellIndex}`)!;
      groups.push({ rowIndex, cellIndex, role, elements: group.elements });
    }
  }
  tablePaintLedgers.set(container, {
    block,
    measure,
    fragment,
    context,
    effectiveColumnWidths,
    cellSpacingPx,
    chrome,
    groups,
    ghostCells: 0,
    sdtChrome,
  });
  return { cellsRendered, cellsReused: plan.reused.length };
}
