import { completeRenderWork, type RenderWork } from '../render-work.js';
import type {
  CellBorders,
  DrawingBlock,
  ImageDrawing,
  DrawingMeasure,
  Fragment,
  ImageBlock,
  ImageHyperlink,
  ImageMeasure,
  Line,
  ParagraphBlock,
  ParagraphMeasure,
  PartialRowInfo,
  SdtMetadata,
  TableBlock,
  TableCell,
  TableFragment,
  TableMeasure,
  WrapExclusion,
  WrapTextMode,
} from '@superdoc/contracts';
import {
  effectiveTableCellSpacing,
  rescaleColumnWidths,
  normalizeZIndex,
  resolveFloatingZIndex,
  getCellSpacingPx,
  buildLayoutSourceIdentity,
  resolveAnchoredGraphicY,
} from '@superdoc/contracts';
import type { ResolvePhysicalFamily } from '@superdoc/font-system';
import type { MinimalWordLayout } from '@superdoc/common/list-marker-utils';
import { DOM_CLASS_NAMES } from '@superdoc/dom-contract';
import type { FragmentRenderContext, RenderedLineInfo } from '../renderer.js';
import { applyLayoutIdentityDataset } from '../utils/layout-identity.js';
import { applySourceAnchorDataset } from '../utils/source-anchor.js';
import { applySquareWrapExclusionsToLines } from '../utils/anchor-helpers';
import { createBlockImageContent } from '../images/image-block.js';
import { buildImageHyperlinkAnchor } from '../images/hyperlink.js';
import {
  getSdtContainerKeyForBlock,
  getSdtSiblingBoundaries,
  type SdtAncestorOptions,
  type SdtBoundaryOptions,
} from '../sdt/container.js';
import { applyCellBorders } from './border-utils.js';
import { renderTableFragmentWork as renderTableFragmentElement } from './renderTableFragment.js';
import { renderParagraphContentWork } from '../paragraph/renderParagraphContent.js';

type TableRowMeasure = TableMeasure['rows'][number];
type TableCellMeasure = TableRowMeasure['cells'][number];
type TableCellBlock = NonNullable<TableCell['blocks']>[number];
type TableCellBlockMeasure = NonNullable<TableCellMeasure['blocks']>[number];

type ResolveCellAnchoredTopParams = {
  anchor: ImageBlock['anchor'] | DrawingBlock['anchor'];
  anchorParagraphId?: string;
  cellBlocks: TableCellBlock[];
  blockMeasures: TableCellBlockMeasure[];
  globalFromLine: number;
  globalToLine: number;
  paddingTop: number;
  objectHeight: number;
};

/**
 * Compute the total segment count for a cell's blocks, matching the layout engine's
 * recursive getCellLines() expansion. Paragraph blocks contribute their line count,
 * embedded tables contribute the sum of their rows' recursive segment counts,
 * and other blocks (images, drawings) contribute 1 segment.
 */
export function getCellSegmentCount(cell: TableCellMeasure): number {
  if (cell.blocks && cell.blocks.length > 0) {
    let total = 0;
    for (const block of cell.blocks) {
      if (block.kind === 'paragraph') {
        total += (block as ParagraphMeasure).lines?.length || 0;
      } else if (block.kind === 'table') {
        const tableMeasure = block as TableMeasure;
        for (const row of tableMeasure.rows) {
          total += getEmbeddedRowSegmentCount(row);
        }
      } else {
        const blockHeight = 'height' in block ? (block as { height: number }).height : 0;
        if (blockHeight > 0) total += 1;
      }
    }
    return total;
  }
  if (cell.paragraph) {
    return (cell.paragraph as ParagraphMeasure).lines?.length || 0;
  }
  return 0;
}

/**
 * Compute the segment count for a single embedded table row.
 * If any cell in the row contains nested tables, recursively expand using the
 * tallest cell's segment count. Otherwise, the row is 1 segment.
 * This mirrors the layout engine's getEmbeddedRowLines() logic.
 */
function getEmbeddedRowSegmentCount(row: TableRowMeasure): number {
  const hasNestedTable = row.cells.some((cell: TableCellMeasure) => cell.blocks?.some((b) => b.kind === 'table'));
  if (!hasNestedTable) return 1;

  let maxSegments = 0;
  for (const cell of row.cells) {
    maxSegments = Math.max(maxSegments, getCellSegmentCount(cell));
  }
  return maxSegments > 0 ? maxSegments : 1;
}

/**
 * Compute the total recursive segment count for an embedded table.
 */
function getEmbeddedTableSegmentCount(tableMeasure: TableMeasure): number {
  let total = 0;
  for (const row of tableMeasure.rows) {
    total += getEmbeddedRowSegmentCount(row);
  }
  return total;
}

/**
 * Compute the visible height for a range of table rows, using partial height
 * where a row is only partially rendered (mid-row split).
 */
function computeVisibleHeight(
  rows: TableMeasure['rows'],
  fromRow: number,
  toRow: number,
  partialRow?: PartialRowInfo,
): number {
  let height = 0;
  for (let r = fromRow; r < toRow; r++) {
    if (partialRow && partialRow.rowIndex === r) {
      height += partialRow.partialHeight;
    } else {
      height += rows[r]?.height || 0;
    }
  }
  return height;
}

/**
 * Compute the visible height of a single cell's content for a given segment range.
 * Handles paragraphs, embedded tables, and non-paragraph blocks (images, drawings).
 * Falls back to cell.paragraph for legacy single-paragraph cells.
 */
function computeCellVisibleHeight(cell: TableCellMeasure, cellFrom: number, cellTo: number): number {
  let cellVisHeight = 0;
  if (cell.blocks && cell.blocks.length > 0) {
    let segIdx = 0;
    for (const blk of cell.blocks) {
      if (blk.kind === 'paragraph') {
        const lines = (blk as ParagraphMeasure).lines || [];
        for (const line of lines) {
          if (segIdx >= cellFrom && segIdx < cellTo) {
            cellVisHeight += line.lineHeight || 0;
          }
          segIdx++;
        }
      } else if (blk.kind === 'table') {
        const nestedTable = blk as TableMeasure;
        for (const nestedRow of nestedTable.rows) {
          const nestedRowSegs = getEmbeddedRowSegmentCount(nestedRow);
          // TODO: use actual segment heights from getEmbeddedRowLines() instead of
          // even split for more precise height when rows have non-uniform line heights.
          for (let s = 0; s < nestedRowSegs; s++) {
            if (segIdx >= cellFrom && segIdx < cellTo) {
              cellVisHeight += (nestedRow.height || 0) / nestedRowSegs;
            }
            segIdx++;
          }
        }
      } else {
        const blkHeight = 'height' in blk ? (blk as { height: number }).height : 0;
        if (blkHeight > 0) {
          if (segIdx >= cellFrom && segIdx < cellTo) {
            cellVisHeight += blkHeight;
          }
          segIdx++;
        }
      }
    }
  } else if (cell.paragraph) {
    // Legacy single-paragraph fallback (matches getCellSegmentCount)
    const lines = (cell.paragraph as ParagraphMeasure).lines || [];
    for (let i = 0; i < lines.length; i++) {
      if (i >= cellFrom && i < cellTo) {
        cellVisHeight += lines[i].lineHeight || 0;
      }
    }
  }
  return cellVisHeight;
}

const getCellBlockSegmentCount = (blockMeasure: TableCellBlockMeasure): number => {
  if (blockMeasure.kind === 'paragraph') {
    return (blockMeasure as ParagraphMeasure).lines?.length || 0;
  }
  if (blockMeasure.kind === 'table') {
    return getEmbeddedTableSegmentCount(blockMeasure as TableMeasure);
  }
  if (blockMeasure.kind === 'image' || blockMeasure.kind === 'drawing') {
    return blockMeasure.height > 0 ? 1 : 0;
  }

  return 0;
};

const computeRenderedParagraphFlowHeight = (
  block: ParagraphBlock,
  measure: ParagraphMeasure,
  localStartLine: number,
  localEndLine: number,
  isFirstBlock: boolean,
  isLastBlock: boolean,
  paddingTop: number,
): number => {
  const lines = measure.lines ?? [];
  const renderedLocalEndLine = Math.min(localEndLine, lines.length);
  let renderedHeight = 0;

  for (let lineIdx = localStartLine; lineIdx < renderedLocalEndLine; lineIdx += 1) {
    renderedHeight += lines[lineIdx]?.lineHeight ?? 0;
  }

  const renderedEntireBlock = localStartLine === 0 && renderedLocalEndLine >= lines.length;
  if (renderedEntireBlock && measure.totalHeight && measure.totalHeight > renderedHeight) {
    renderedHeight = measure.totalHeight;
  }

  const beforeHeight =
    localStartLine === 0 ? effectiveTableCellSpacing(block.attrs?.spacing?.before, isFirstBlock, paddingTop) : 0;
  const spacingAfter = block.attrs?.spacing?.after;
  const afterHeight =
    renderedEntireBlock && !isLastBlock && typeof spacingAfter === 'number' && spacingAfter > 0 ? spacingAfter : 0;

  return beforeHeight + renderedHeight + afterHeight;
};

const computeRenderedBlockFlowHeight = (
  block: TableCellBlock,
  blockMeasure: TableCellBlockMeasure,
  blockIndex: number,
  blockStartGlobal: number,
  blockEndGlobal: number,
  globalFromLine: number,
  globalToLine: number,
  blockCount: number,
  paddingTop: number,
): number => {
  if (blockEndGlobal <= globalFromLine || blockStartGlobal >= globalToLine) {
    return 0;
  }

  if (blockMeasure.kind === 'paragraph' && block.kind === 'paragraph') {
    const blockLineCount = (blockMeasure as ParagraphMeasure).lines?.length || 0;
    const localStartLine = Math.max(0, globalFromLine - blockStartGlobal);
    const localEndLine = Math.min(blockLineCount, globalToLine - blockStartGlobal);

    return computeRenderedParagraphFlowHeight(
      block,
      blockMeasure as ParagraphMeasure,
      localStartLine,
      localEndLine,
      blockIndex === 0,
      blockIndex === blockCount - 1,
      paddingTop,
    );
  }

  if (blockMeasure.kind === 'table') {
    return computeCellVisibleHeight(
      { blocks: [blockMeasure], width: 0, height: 0 },
      Math.max(0, globalFromLine - blockStartGlobal),
      Math.min(blockEndGlobal - blockStartGlobal, globalToLine - blockStartGlobal),
    );
  }

  if (blockMeasure.kind === 'image' || blockMeasure.kind === 'drawing') {
    if ((block.kind === 'image' || block.kind === 'drawing') && block.anchor?.isAnchored) {
      return 0;
    }

    return blockMeasure.height;
  }

  return 0;
};

type CellAnchoredTop = {
  top: number;
  /**
   * True only when the anchor paragraph was found and used as the base. Fallback results
   * (page/margin bases, missing/unresolvable anchorParagraphId) keep the legacy
   * top-of-cell invariant and must NOT be shifted by the vertical-alignment offset.
   */
  paragraphResolved: boolean;
};

export const resolveCellAnchoredTop = (params: ResolveCellAnchoredTopParams): CellAnchoredTop | null => {
  const offsetV = params.anchor?.offsetV ?? 0;
  const vRelativeFrom = params.anchor?.vRelativeFrom;
  if (vRelativeFrom !== undefined && vRelativeFrom !== 'paragraph') {
    return { top: offsetV, paragraphResolved: false };
  }

  if (!params.anchorParagraphId) {
    return { top: offsetV, paragraphResolved: false };
  }

  let flowY = 0;
  let cumulativeLineCount = 0;
  const blockCount = Math.min(params.blockMeasures.length, params.cellBlocks.length);

  for (let i = 0; i < blockCount; i += 1) {
    const blockMeasure = params.blockMeasures[i]!;
    const block = params.cellBlocks[i]!;
    const blockSegmentCount = getCellBlockSegmentCount(blockMeasure);
    const blockStartGlobal = cumulativeLineCount;
    const blockEndGlobal = cumulativeLineCount + blockSegmentCount;

    if (block.kind === 'paragraph' && block.id === params.anchorParagraphId) {
      // Paint only on the slice where the anchor paragraph STARTS: a paragraph split across
      // slices intersects several windows, and painting on each would duplicate the object.
      if (blockStartGlobal < params.globalFromLine || blockStartGlobal >= params.globalToLine) {
        return null;
      }

      // Word measures the paragraph anchor base at the paragraph's flow position BEFORE its
      // own spacing-before region (fixture evidence: adding SpaceBefore moves the text, not
      // the anchored object), so flowY is not adjusted by this paragraph's spacing.
      const firstLineHeight = (blockMeasure as ParagraphMeasure).lines?.[0]?.lineHeight ?? 0;
      return {
        top: resolveAnchoredGraphicY({
          anchor: { vRelativeFrom, alignV: params.anchor?.alignV, offsetV },
          objectHeight: params.objectHeight,
          contentTop: 0,
          contentBottom: 0,
          anchorParagraphY: flowY,
          firstLineHeight,
        }),
        paragraphResolved: true,
      };
    }

    flowY += computeRenderedBlockFlowHeight(
      block,
      blockMeasure,
      i,
      blockStartGlobal,
      blockEndGlobal,
      params.globalFromLine,
      params.globalToLine,
      blockCount,
      params.paddingTop,
    );
    cumulativeLineCount = blockEndGlobal;
  }

  return { top: offsetV, paragraphResolved: false };
};

/**
 * Applies inline CSS styles to an element, filtering out null/undefined/empty values.
 *
 * Only applies styles where the key exists in the element's style object and
 * the value is non-null and non-empty. This prevents accidentally clearing
 * existing styles with undefined values.
 *
 * @param el - The HTML element to apply styles to
 * @param styles - Partial CSSStyleDeclaration with styles to apply
 */
const applyInlineStyles = (el: HTMLElement, styles: Partial<CSSStyleDeclaration>): void => {
  Object.entries(styles).forEach(([key, value]) => {
    if (value != null && value !== '' && key in el.style) {
      (el.style as unknown as Record<string, string>)[key] = String(value);
    }
  });
};

const applyTableImageInteractionDataset = (element: HTMLElement, block: ImageBlock): void => {
  element.classList.add(DOM_CLASS_NAMES.IMAGE_FRAGMENT);
  if (block.id) element.dataset.sdBlockId = block.id;
  if (block.imageId) element.dataset.sdImageId = String(block.imageId);
  if (block.imageMutationId) element.dataset.sdImageMutationId = block.imageMutationId;
};

/**
 * Parameters for rendering a nested table inside a table cell.
 *
 * When a table cell contains another table (nested/embedded table), we render it
 * using the same table rendering infrastructure but with a synthetic TableFragment
 * positioned at (0,0) within the cell content area.
 */
type EmbeddedTableRenderParams = {
  /** Document object for creating DOM elements */
  doc: Document;
  /** The nested table block to render */
  table: TableBlock;
  /** Measurement data for the nested table */
  measure: TableMeasure;
  /** Available width for the embedded table (render-scale cell content area) */
  availableWidth: number;
  /** Rendering context (section, page, column info) */
  context: FragmentRenderContext;
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
  /** Optional callback to render drawing content (shapes, etc.) */
  renderDrawingContent?: (block: DrawingBlock, interactionHost: HTMLElement, measure: DrawingMeasure) => HTMLElement;
  /** Function to apply SDT metadata as data attributes */
  applySdtDataset: (el: HTMLElement | null, metadata?: SdtMetadata | null) => void;
  /** Built-in SDT chrome rendering mode. */
  chrome?: 'default' | 'none';
  /** Starting row index for partial rendering (inclusive, default 0) */
  fromRow?: number;
  /** Ending row index for partial rendering (exclusive, default all rows) */
  toRow?: number;
  /** Partial row info for mid-row splits within the embedded table */
  partialRow?: PartialRowInfo;
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
  /** Receives notification when this embedded table or its descendants render SDT chrome */
  onSdtContainerChrome?: () => void;
};

/**
 * Version identifier for embedded table block lookups.
 * Used to distinguish nested tables from top-level tables in the block lookup map.
 */

/**
 * Renders a nested table that appears inside a table cell.
 *
 * This function creates a synthetic TableFragment positioned at (0,0) within the cell
 * and delegates to the standard table fragment renderer. The embedded table reuses the
 * same rendering infrastructure as top-level tables but with its own isolated block lookup.
 *
 * @param params - Parameters including the table block, measure, and rendering callbacks
 * @returns The rendered table element ready to be appended to the cell content
 *
 * @example
 * ```typescript
 * const tableEl = renderEmbeddedTable({
 *   doc,
 *   table: nestedTableBlock,
 *   measure: nestedTableMeasure,
 *   context,
 *   renderLine,
 *   applySdtDataset,
 * });
 * cellContent.appendChild(tableEl);
 * ```
 */
function* renderEmbeddedTable(
  params: EmbeddedTableRenderParams,
): RenderWork<{ element: HTMLElement; hasSdtContainerChrome: boolean }> {
  const {
    doc,
    table,
    measure,
    availableWidth,
    context,
    renderLine,
    captureLineSnapshot,
    renderDrawingContent,
    applySdtDataset,
    chrome,
    fromRow: paramFromRow,
    toRow: paramToRow,
    partialRow: paramPartialRow,
    sdtBoundary,
    ancestorContainerKey,
    ancestorContainerSdt,
    ancestorContainerKeys,
    ancestorContainerSdts,
    onSdtContainerChrome,
  } = params;

  const effectiveFromRow = paramFromRow ?? 0;
  const effectiveToRow = paramToRow ?? table.rows.length;

  const visibleHeight = computeVisibleHeight(measure.rows, effectiveFromRow, effectiveToRow, paramPartialRow);

  // Rescale column widths when measurement-scale exceeds render-scale (SD-1962).
  // Top-level tables get rescaled by layout-engine's rescaleColumnWidths(), but
  // embedded tables bypass that path. We reuse the same function here.
  const columnWidths = rescaleColumnWidths(measure.columnWidths, measure.totalWidth, availableWidth);
  const fragmentWidth = columnWidths ? availableWidth : measure.totalWidth;

  const fragment: TableFragment = {
    kind: 'table',
    blockId: table.id,
    fromRow: effectiveFromRow,
    toRow: effectiveToRow,
    x: 0,
    y: 0,
    width: fragmentWidth,
    height: visibleHeight,
    columnWidths,
    partialRow: paramPartialRow,
  };
  const effectiveColumnWidths = columnWidths ?? measure.columnWidths;
  const embeddedCellSpacingPx = measure.cellSpacingPx ?? getCellSpacingPx(table.attrs?.cellSpacing);

  const applyFragmentFrame = (el: HTMLElement, frag: Fragment): void => {
    el.style.left = `${frag.x}px`;
    el.style.top = `${frag.y}px`;
    el.style.width = `${frag.width}px`;
    el.dataset.blockId = frag.blockId;
  };

  let hasSdtContainerChrome = false;
  const tableEl = yield* renderTableFragmentElement({
    doc,
    fragment,
    context,
    block: table,
    measure,
    cellSpacingPx: embeddedCellSpacingPx,
    effectiveColumnWidths,
    renderLine,
    captureLineSnapshot,
    renderDrawingContent,
    applyFragmentFrame,
    applySdtDataset,
    chrome,
    applyStyles: applyInlineStyles,
    sdtBoundary,
    ancestorContainerKey,
    ancestorContainerSdt,
    ancestorContainerKeys,
    ancestorContainerSdts,
    onSdtContainerChrome: () => {
      hasSdtContainerChrome = true;
      onSdtContainerChrome?.();
    },
  });

  return { element: tableEl, hasSdtContainerChrome };
}

/**
 * Render an embedded table block within a cell, handling segment-based pagination.
 *
 * Maps the cell's global segment range into the embedded table's local row range,
 * computes partial row info when a page break falls mid-row, and delegates to
 * renderEmbeddedTable for actual DOM creation.
 */
function* renderPartialEmbeddedTable(params: {
  doc: Document;
  block: TableBlock;
  blockMeasure: TableMeasure;
  cumulativeLineCount: number;
  globalFromLine: number;
  globalToLine: number;
  contentWidthPx: number;
  context: FragmentRenderContext;
  renderLine: EmbeddedTableRenderParams['renderLine'];
  captureLineSnapshot?: EmbeddedTableRenderParams['captureLineSnapshot'];
  renderDrawingContent?: EmbeddedTableRenderParams['renderDrawingContent'];
  applySdtDataset: EmbeddedTableRenderParams['applySdtDataset'];
  chrome?: EmbeddedTableRenderParams['chrome'];
  sdtBoundary?: SdtBoundaryOptions;
  ancestorContainerKey?: string | null;
  ancestorContainerSdt?: SdtMetadata | null;
  ancestorContainerKeys?: SdtAncestorOptions['ancestorContainerKeys'];
  ancestorContainerSdts?: SdtAncestorOptions['ancestorContainerSdts'];
  onSdtContainerChrome?: () => void;
}): RenderWork<{
  element: HTMLElement | null;
  height: number;
  nextCumulativeLineCount: number;
  hasSdtContainerChrome: boolean;
}> {
  const {
    doc,
    block,
    blockMeasure: tableMeasure,
    cumulativeLineCount,
    globalFromLine,
    globalToLine,
    contentWidthPx,
    context,
    renderLine,
    captureLineSnapshot,
    renderDrawingContent,
    applySdtDataset,
    chrome,
    sdtBoundary,
    ancestorContainerKey,
    ancestorContainerSdt,
    ancestorContainerKeys,
    ancestorContainerSdts,
    onSdtContainerChrome,
  } = params;

  // Compute per-row segment counts (recursive, matching getCellLines/getEmbeddedRowLines).
  const rowSegmentCounts = tableMeasure.rows.map((row: TableRowMeasure) => getEmbeddedRowSegmentCount(row));
  const totalTableSegments = rowSegmentCounts.reduce((s: number, c: number) => s + c, 0);

  const tableStartSegment = cumulativeLineCount;
  const nextCumulativeLineCount = cumulativeLineCount + totalTableSegments;
  const tableEndSegment = nextCumulativeLineCount;

  // Skip entirely if no segments are in the visible range
  if (tableEndSegment <= globalFromLine || tableStartSegment >= globalToLine) {
    return { element: null, height: 0, nextCumulativeLineCount, hasSdtContainerChrome: false };
  }

  // Map global line range to local segment range within this embedded table
  const localFrom = Math.max(0, globalFromLine - tableStartSegment);
  const localTo = Math.min(totalTableSegments, globalToLine - tableStartSegment);

  // Determine which rows to render and whether any need partial rendering
  let segmentOffset = 0;
  let embeddedFromRow = -1;
  let embeddedToRow = -1;
  // TODO: partialRowInfo is overwritten each iteration — if the visible segment range
  // cuts through two different multi-segment rows, only the last one's info survives.
  // TableFragment only supports a single partialRow, so fixing this requires a design change.
  let partialRowInfo: PartialRowInfo | undefined;

  for (let r = 0; r < tableMeasure.rows.length; r++) {
    const rowSegs = rowSegmentCounts[r];
    const rowStart = segmentOffset;
    const rowEnd = segmentOffset + rowSegs;
    segmentOffset = rowEnd;

    // Skip rows completely outside the range
    if (rowEnd <= localFrom || rowStart >= localTo) continue;

    if (embeddedFromRow === -1) embeddedFromRow = r;
    embeddedToRow = r + 1;

    // Check if this row needs partial rendering (multi-segment row spanning the boundary)
    if (rowSegs > 1 && (rowStart < localFrom || rowEnd > localTo)) {
      const rowLocalFrom = Math.max(0, localFrom - rowStart);
      const rowLocalTo = Math.min(rowSegs, localTo - rowStart);
      const row = tableMeasure.rows[r];

      const fromLineByCell: number[] = [];
      const toLineByCell: number[] = [];
      let partialHeight = 0;

      for (const cell of row.cells) {
        const cellTotal = getCellSegmentCount(cell);
        const cellFrom = Math.min(rowLocalFrom, cellTotal);
        const cellTo = Math.min(rowLocalTo, cellTotal);
        fromLineByCell.push(cellFrom);
        toLineByCell.push(cellTo);
        partialHeight = Math.max(partialHeight, computeCellVisibleHeight(cell, cellFrom, cellTo));
      }

      partialRowInfo = {
        rowIndex: r,
        fromLineByCell,
        toLineByCell,
        isFirstPart: rowLocalFrom === 0,
        isLastPart: rowLocalTo >= rowSegs,
        partialHeight,
      };
    }
  }

  if (embeddedFromRow === -1) {
    return { element: null, height: 0, nextCumulativeLineCount, hasSdtContainerChrome: false };
  }

  const visibleHeight = computeVisibleHeight(tableMeasure.rows, embeddedFromRow, embeddedToRow, partialRowInfo);
  const effectiveSdtBoundary = sdtBoundary
    ? {
        ...sdtBoundary,
        isStart: (sdtBoundary.isStart ?? true) && localFrom === 0,
        isEnd: (sdtBoundary.isEnd ?? true) && localTo >= totalTableSegments,
        showLabel: sdtBoundary.showLabel === undefined ? undefined : sdtBoundary.showLabel && localFrom === 0,
      }
    : undefined;

  const tableWrapper = doc.createElement('div');
  tableWrapper.style.position = 'relative';
  tableWrapper.style.width = '100%';
  tableWrapper.style.height = `${visibleHeight}px`;
  tableWrapper.style.flexShrink = '0';
  tableWrapper.style.boxSizing = 'border-box';

  const tableResult = yield* renderEmbeddedTable({
    doc,
    table: block,
    measure: tableMeasure,
    availableWidth: contentWidthPx,
    // Preserve the inherited section (and story): nested table content in a
    // header/footer belongs to that furniture story, not the body. Forcing
    // 'body' here previously misclassified furniture-table runs for position
    // validation (SD-3715 follow-up). This changes only editor identity and
    // validation metadata; table geometry and visual layout are unchanged.
    context,
    renderLine,
    captureLineSnapshot,
    renderDrawingContent,
    applySdtDataset,
    chrome,
    fromRow: embeddedFromRow,
    toRow: embeddedToRow,
    partialRow: partialRowInfo,
    sdtBoundary: effectiveSdtBoundary,
    ancestorContainerKey,
    ancestorContainerSdt,
    ancestorContainerKeys,
    ancestorContainerSdts,
    onSdtContainerChrome,
  });
  tableWrapper.appendChild(tableResult.element);

  return {
    element: tableWrapper,
    height: visibleHeight,
    nextCumulativeLineCount,
    hasSdtContainerChrome: tableResult.hasSdtContainerChrome,
  };
}

/**
 * Dependencies required for rendering a table cell.
 *
 * Contains positioning, sizing, content, and rendering functions needed to
 * create a table cell DOM element with its content.
 */
type TableCellRenderDependencies = {
  /** Document object for creating DOM elements */
  doc: Document;
  /** Horizontal position (left edge) in pixels */
  x: number;
  /** Vertical position (top edge) in pixels */
  y: number;
  /** Height of the row containing this cell */
  rowHeight: number;
  /** Measurement data for this cell (width, paragraph layout) */
  cellMeasure: TableRowMeasure['cells'][number];
  /** Cell data (content, attributes), or undefined for empty cells */
  cell?: TableBlock['rows'][number]['cells'][number];
  /** Resolved borders for this cell */
  borders?: CellBorders;
  /** Whether to apply default border if no borders specified */
  useDefaultBorder?: boolean;
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
  /**
   * Optional callback function to render drawing content (vectorShapes, shapeGroups).
   * If provided, this callback is used to render DrawingBlocks with drawingKind of 'vectorShape' or 'shapeGroup'.
   * The callback receives a DrawingBlock and must return an HTMLElement.
   * The returned element will have width: 100% and height: 100% styles applied automatically.
   * If undefined, a placeholder element with diagonal stripes pattern is rendered instead.
   */
  renderDrawingContent?: (block: DrawingBlock, interactionHost: HTMLElement, measure: DrawingMeasure) => HTMLElement;
  /** Rendering context */
  context: FragmentRenderContext;
  /** Function to apply SDT metadata as data attributes */
  applySdtDataset: (el: HTMLElement | null, metadata?: SdtMetadata | null) => void;
  /** Built-in SDT chrome rendering mode. */
  chrome?: 'default' | 'none';
  /** Ancestor SDT container key for suppressing duplicate container styling in cells */
  ancestorContainerKey?: string | null;
  /** Ancestor SDT metadata for suppressing duplicate id-less container styling in cells */
  ancestorContainerSdt?: SdtMetadata | null;
  /** Ancestor SDT keys for suppressing duplicate container styling in cells */
  ancestorContainerKeys?: SdtAncestorOptions['ancestorContainerKeys'];
  /** Ancestor SDT metadata chain for suppressing duplicate id-less container styling in cells */
  ancestorContainerSdts?: SdtAncestorOptions['ancestorContainerSdts'];
  /** Receives notification when this cell or descendants render SDT container chrome */
  onSdtContainerChrome?: () => void;
  /** Table indent in pixels (applied to table fragment positioning) */
  tableIndent?: number;
  /** Whether the table is visually right-to-left (w:bidiVisual, ECMA-376 §17.4.1) */
  isRtl?: boolean;
  /** Computed cell width from rescaled columnWidths (overrides cellMeasure.width when present) */
  cellWidth?: number;
  /** Starting line index for partial row rendering (inclusive) */
  fromLine?: number;
  /** Ending line index for partial row rendering (exclusive), -1 means render to end */
  toLine?: number;
  /**
   * Per-document logical->physical font resolver for in-cell list markers and drop caps. Threaded
   * from the renderer's per-document resolver so they paint the same physical family they were
   * measured in. Undefined falls back to the global resolver.
   */
  resolvePhysical?: ResolvePhysicalFamily;
};

/**
 * Result of rendering a table cell.
 */
export type TableCellRenderResult = {
  /** The cell container element (with borders, background, sizing, and content as child) */
  cellElement: HTMLElement;
};

/**
 * Renders a table cell as a DOM element.
 *
 * Creates a single cell element with content as a child:
 * - cellElement: Absolutely-positioned container with borders, background, sizing, padding,
 *   and content rendered inside. Cell uses overflow:hidden to clip any overflow.
 *
 * Handles:
 * - Cell borders (explicit or default)
 * - Background colors
 * - Vertical alignment (top, center, bottom)
 * - Cell padding (applied directly to cell element)
 * - Empty cells
 *
 * **Multi-Block Cell Rendering:**
 * - Iterates through all blocks in the cell (cell.blocks or cell.paragraph)
 * - Each block is rendered sequentially and stacked vertically
 * - Only paragraph blocks are currently rendered (other block types are ignored)
 *
 * **Backward Compatibility:**
 * - Supports legacy cell.paragraph field (single paragraph)
 * - Falls back to empty array if neither cell.blocks nor cell.paragraph is present
 * - Handles mismatches between blockMeasures and cellBlocks arrays using bounds checking
 *
 * **Empty Cell Handling:**
 * - Cells with no blocks render only the cell container (no content inside)
 * - Empty blocks arrays are safe (no content rendered)
 *
 * @param deps - All dependencies required for rendering
 * @returns Object containing cellElement (content is rendered inside as child)
 *
 * @example
 * ```typescript
 * const { cellElement } = renderTableCell({
 *   doc: document,
 *   x: 100,
 *   y: 50,
 *   rowHeight: 30,
 *   cellMeasure,
 *   cell,
 *   borders,
 *   useDefaultBorder: false,
 *   renderLine,
 *   renderDrawingContent: (block) => {
 *     // Custom drawing renderer for vectorShapes and shapeGroups
 *     const el = document.createElement('div');
 *     // Render drawing content...
 *     return el;
 *   },
 *   context,
 *   applySdtDataset
 * });
 * container.appendChild(cellElement);
 * ```
 */
export function* renderTableCellWork(deps: TableCellRenderDependencies): RenderWork<TableCellRenderResult> {
  const {
    doc,
    x,
    y,
    rowHeight,
    cellMeasure,
    cell,
    borders,
    useDefaultBorder,
    renderLine,
    captureLineSnapshot,
    renderDrawingContent,
    context,
    applySdtDataset,
    chrome,
    ancestorContainerKey,
    ancestorContainerSdt,
    ancestorContainerKeys,
    ancestorContainerSdts,
    onSdtContainerChrome,
    isRtl,
    cellWidth,
    fromLine,
    toLine,
    resolvePhysical,
  } = deps;

  const attrs = cell?.attrs;
  const padding = attrs?.padding || { top: 0, left: 4, right: 4, bottom: 0 };
  const buildTableImageHyperlinkAnchor = (
    imageEl: HTMLElement,
    hyperlink: ImageHyperlink | undefined,
    display: 'block' | 'inline-block',
  ): HTMLElement => buildImageHyperlinkAnchor(doc, imageEl, hyperlink, display);

  // RTL: swap left↔right cell margins (ECMA-376 Part 4 §14.3.3–14.3.4, §14.3.7–14.3.8)
  const paddingLeft = isRtl ? (padding.right ?? 4) : (padding.left ?? 4);
  const paddingTop = padding.top ?? 0;
  const paddingRight = isRtl ? (padding.left ?? 4) : (padding.right ?? 4);
  const paddingBottom = padding.bottom ?? 0;

  const cellEl = doc.createElement('div');
  cellEl.style.position = 'absolute';
  cellEl.style.left = `${x}px`;
  cellEl.style.top = `${y}px`;
  cellEl.style.width = `${cellWidth ?? cellMeasure.width}px`;
  cellEl.style.height = `${rowHeight}px`;
  cellEl.style.boxSizing = 'border-box';
  // Cell clips all overflow - no scrollbars, content just gets clipped at boundaries
  cellEl.style.overflow = 'hidden';
  // Apply padding directly to cell so content is positioned correctly
  cellEl.style.paddingLeft = `${paddingLeft}px`;
  cellEl.style.paddingTop = `${paddingTop}px`;
  cellEl.style.paddingRight = `${paddingRight}px`;
  cellEl.style.paddingBottom = `${paddingBottom}px`;

  if (borders) {
    applyCellBorders(cellEl, borders, true);
  } else if (useDefaultBorder) {
    cellEl.style.border = '1px solid rgba(0,0,0,0.6)';
  }

  if (cell?.attrs?.background) {
    cellEl.style.backgroundColor = cell.attrs.background;
  }

  // Support multi-block cells with backward compatibility
  const cellBlocks = cell?.blocks ?? (cell?.paragraph ? [cell.paragraph] : []);
  const blockMeasures = cellMeasure?.blocks ?? (cellMeasure?.paragraph ? [cellMeasure.paragraph] : []);
  const sdtContainerKeys = cellBlocks.map((block) =>
    block.kind === 'paragraph' || block.kind === 'table' ? getSdtContainerKeyForBlock(block) : null,
  );
  const sdtBoundaries = getSdtSiblingBoundaries(sdtContainerKeys);

  if (cellBlocks.length > 0 && blockMeasures.length > 0) {
    // Content is a child of the cell, positioned relative to it
    // Cell's overflow:hidden handles clipping, no explicit width needed
    const content = doc.createElement('div');
    content.style.position = 'relative';
    const verticalText = cellMeasure.verticalText;
    content.style.width = verticalText ? `${verticalText.inlineSize}px` : '100%';
    content.style.height = verticalText ? `${verticalText.blockSize}px` : '100%';
    if (verticalText) {
      content.style.transformOrigin = '0 0';
      content.style.transform =
        verticalText.direction === 'btLr'
          ? `translate(0, ${verticalText.inlineSize}px) rotate(-90deg)`
          : `translate(${verticalText.blockSize}px, 0) rotate(90deg)`;
    }
    content.style.display = 'flex';
    content.style.flexDirection = 'column';

    if (cell?.attrs?.verticalAlign === 'center') {
      content.style.justifyContent = 'center';
    } else if (cell?.attrs?.verticalAlign === 'bottom') {
      content.style.justifyContent = 'flex-end';
    } else {
      content.style.justifyContent = 'flex-start';
    }

    // Append content to cell (content is now a child, not a sibling)
    cellEl.appendChild(content);

    // Establish a local stacking context so anchored objects can reliably layer above/below text.
    // (Needed for negative z-index behindDoc behavior.)
    content.style.zIndex = '0';

    // Calculate total segments across all blocks for proper global index mapping.
    // Embedded tables expand recursively (matching the layout engine's getCellLines()
    // which uses getEmbeddedRowLines() for recursive nested table expansion).
    // Non-paragraph blocks (images, drawings) occupy 1 segment each when height > 0,
    // including anchored blocks (matching getCellLines() in layout-table.ts).
    const blockLineCounts: number[] = [];
    for (let i = 0; i < Math.min(blockMeasures.length, cellBlocks.length); i++) {
      yield;
      const bm = blockMeasures[i];
      if (bm.kind === 'paragraph') {
        blockLineCounts.push((bm as ParagraphMeasure).lines?.length || 0);
      } else if (bm.kind === 'table') {
        // Embedded tables: recursively count segments (matches getCellLines expansion)
        blockLineCounts.push(getEmbeddedTableSegmentCount(bm as TableMeasure));
      } else {
        // Non-paragraph/non-table blocks (images, drawings) occupy 1 segment when
        // their height > 0, matching getCellLines() in layout-table.ts which only
        // counts non-paragraph blocks with positive height.
        const blockHeight = 'height' in bm ? (bm as { height: number }).height : 0;
        blockLineCounts.push(blockHeight > 0 ? 1 : 0);
      }
    }
    const totalLines = blockLineCounts.reduce((a, b) => a + b, 0);

    // Determine global line range to render
    const globalFromLine = fromLine ?? 0;
    const globalToLine = toLine === -1 || toLine === undefined ? totalLines : toLine;

    const effectiveCellWidth = cellWidth ?? cellMeasure.width;
    const contentWidthPx = verticalText?.inlineSize ?? Math.max(0, effectiveCellWidth - paddingLeft - paddingRight);
    const contentHeightPx = Math.max(0, rowHeight - paddingTop - paddingBottom);
    let flowCursorY = 0;
    const anchoredBlocks: Array<{ block: ImageBlock | DrawingBlock; measure: ImageMeasure | DrawingMeasure }> = [];
    const renderedLines: RenderedLineInfo[] = [];

    let cumulativeLineCount = 0; // Track cumulative line count across blocks
    for (let i = 0; i < Math.min(blockMeasures.length, cellBlocks.length); i++) {
      yield;
      const blockMeasure = blockMeasures[i];
      const block = cellBlocks[i];

      if (blockMeasure.kind === 'table' && block?.kind === 'table') {
        const result = yield* renderPartialEmbeddedTable({
          doc,
          block: block as TableBlock,
          blockMeasure: blockMeasure as TableMeasure,
          cumulativeLineCount,
          globalFromLine,
          globalToLine,
          contentWidthPx,
          context,
          renderLine,
          captureLineSnapshot,
          renderDrawingContent,
          applySdtDataset,
          chrome,
          sdtBoundary: sdtBoundaries[i],
          ancestorContainerKey,
          ancestorContainerSdt,
          ancestorContainerKeys,
          ancestorContainerSdts,
          onSdtContainerChrome,
        });
        cumulativeLineCount = result.nextCumulativeLineCount;
        if (result.element) {
          content.appendChild(result.element);
          flowCursorY += result.height;
        }
        if (result.hasSdtContainerChrome) {
          cellEl.style.overflow = 'visible';
        }
        continue;
      }

      if (blockMeasure.kind === 'image' && block?.kind === 'image') {
        if (block.anchor?.isAnchored) {
          anchoredBlocks.push({ block, measure: blockMeasure as ImageMeasure });
          // Advance cumulative count only when height > 0 to stay aligned with
          // getCellLines() which only counts non-paragraph blocks with positive height.
          if (blockMeasure.height > 0) {
            cumulativeLineCount += 1;
          }
          continue;
        }

        // Non-paragraph blocks occupy 1 segment in the combined line/segment index.
        const imgSegmentIndex = cumulativeLineCount;
        cumulativeLineCount += 1;

        if (imgSegmentIndex < globalFromLine || imgSegmentIndex >= globalToLine) {
          continue;
        }

        const imageWrapper = doc.createElement('div');
        imageWrapper.style.position = 'relative';
        imageWrapper.style.width = `${blockMeasure.width}px`;
        imageWrapper.style.height = `${blockMeasure.height}px`;
        imageWrapper.style.flexShrink = '0';
        imageWrapper.style.maxWidth = '100%';
        imageWrapper.style.boxSizing = 'border-box';
        applyTableImageInteractionDataset(imageWrapper, block as ImageBlock);
        applySdtDataset(imageWrapper, (block as ImageBlock).attrs?.sdt);

        imageWrapper.appendChild(
          createBlockImageContent({
            doc,
            block,
            className: 'superdoc-table-image',
            clipContainer: imageWrapper,
            imageDisplay: 'block',
            buildImageHyperlinkAnchor: buildTableImageHyperlinkAnchor,
          }),
        );
        content.appendChild(imageWrapper);
        flowCursorY += blockMeasure.height;
        continue;
      }

      if (blockMeasure.kind === 'drawing' && block?.kind === 'drawing') {
        if (block.anchor?.isAnchored) {
          anchoredBlocks.push({ block, measure: blockMeasure as DrawingMeasure });
          // Advance cumulative count only when height > 0 to stay aligned with
          // getCellLines() which only counts non-paragraph blocks with positive height.
          if (blockMeasure.height > 0) {
            cumulativeLineCount += 1;
          }
          continue;
        }

        // Non-paragraph blocks occupy 1 segment in the combined line/segment index.
        const drawSegmentIndex = cumulativeLineCount;
        cumulativeLineCount += 1;

        if (drawSegmentIndex < globalFromLine || drawSegmentIndex >= globalToLine) {
          continue;
        }

        const drawingWrapper = doc.createElement('div');
        drawingWrapper.style.position = 'relative';
        drawingWrapper.style.width = `${blockMeasure.width}px`;
        drawingWrapper.style.height = `${blockMeasure.height}px`;
        drawingWrapper.style.flexShrink = '0';
        drawingWrapper.style.maxWidth = '100%';
        drawingWrapper.style.boxSizing = 'border-box';
        drawingWrapper.dataset.blockId = (block as DrawingBlock).id;
        applySdtDataset(drawingWrapper, (block as DrawingBlock).attrs as SdtMetadata | undefined);

        const drawingInner = doc.createElement('div');
        drawingInner.classList.add('superdoc-table-drawing');
        drawingInner.style.width = '100%';
        drawingInner.style.height = '100%';
        drawingInner.style.display = 'flex';
        drawingInner.style.alignItems = 'center';
        drawingInner.style.justifyContent = 'center';
        drawingInner.style.overflow = 'hidden';

        if (block.drawingKind === 'image' && 'src' in block && block.src) {
          drawingInner.appendChild(
            createBlockImageContent({
              doc,
              block: block as ImageDrawing,
              className: 'superdoc-drawing-image',
              clipContainer: drawingInner,
              imageDisplay: 'block',
              buildImageHyperlinkAnchor: buildTableImageHyperlinkAnchor,
            }),
          );
        } else if (renderDrawingContent) {
          // Use the callback for other drawing types (vectorShape, shapeGroup, etc.)
          const drawingContent = renderDrawingContent(
            block as DrawingBlock,
            drawingWrapper,
            blockMeasure as DrawingMeasure,
          );
          drawingContent.style.width = '100%';
          drawingContent.style.height = '100%';
          drawingInner.appendChild(drawingContent);
        } else {
          // Fallback placeholder when no rendering callback is provided
          const placeholder = doc.createElement('div');
          placeholder.classList.add('superdoc-drawing-placeholder');
          placeholder.style.width = '100%';
          placeholder.style.height = '100%';
          const stripePattern =
            'repeating-linear-gradient(45deg, rgba(15,23,42,0.1), rgba(15,23,42,0.1) 6px, rgba(15,23,42,0.2) 6px, rgba(15,23,42,0.2) 12px)';
          // Set both shorthand and longhand to handle partial CSS property support in test DOMs.
          placeholder.style.background = stripePattern;
          placeholder.style.backgroundImage = stripePattern;
          placeholder.style.border = '1px dashed rgba(15, 23, 42, 0.3)';
          drawingInner.appendChild(placeholder);
        }

        drawingWrapper.appendChild(drawingInner);
        content.appendChild(drawingWrapper);
        flowCursorY += blockMeasure.height;
        continue;
      }

      if (blockMeasure.kind === 'paragraph' && block?.kind === 'paragraph') {
        const paragraphMeasure = blockMeasure as ParagraphMeasure;
        const lines = paragraphMeasure.lines;
        const blockLineCount = lines?.length || 0;
        const isLastBlockInCell = i === Math.min(blockMeasures.length, cellBlocks.length) - 1;
        const wordLayout = (block.attrs?.wordLayout ?? null) as MinimalWordLayout | null;

        // Calculate the global line indices for this block
        const blockStartGlobal = cumulativeLineCount;
        const blockEndGlobal = cumulativeLineCount + blockLineCount;

        // Skip blocks entirely before/after the global range
        if (blockEndGlobal <= globalFromLine) {
          cumulativeLineCount += blockLineCount;
          continue;
        }
        if (blockStartGlobal >= globalToLine) {
          cumulativeLineCount += blockLineCount;
          continue;
        }

        // Calculate local line indices within this block
        const localStartLine = Math.max(0, globalFromLine - blockStartGlobal);
        const localEndLine = Math.min(blockLineCount, globalToLine - blockStartGlobal);

        // Create wrapper for this paragraph's SDT metadata
        // Use absolute positioning within the content container to stack blocks vertically
        const paraWrapper = doc.createElement('div');
        paraWrapper.style.position = 'relative';
        paraWrapper.style.left = '0';
        paraWrapper.style.width = '100%';
        if (verticalText) paraWrapper.style.flexShrink = '0';
        const baseSdtBoundary = sdtBoundaries[i];
        const sdtBoundary = baseSdtBoundary
          ? {
              ...baseSdtBoundary,
              isStart: (baseSdtBoundary.isStart ?? true) && localStartLine === 0,
              isEnd: (baseSdtBoundary.isEnd ?? true) && localEndLine >= blockLineCount,
              showLabel:
                baseSdtBoundary.showLabel === undefined ? undefined : baseSdtBoundary.showLabel && localStartLine === 0,
            }
          : undefined;

        content.appendChild(paraWrapper);

        // V2 projection: stamp the cell paragraph wrapper with editor-neutral
        // layout identity + source anchor so host hit-testing can address this
        // specific cell paragraph (caret placement / selection / structural
        // editing) instead of falling back to the table-level identity. Guarded
        // on `block.sourceAnchor` so this is v2-projection-specific and does not
        // change v1 rendering. `context.story` keeps header/footer table cells
        // from being addressed as body cells.
        if (block.sourceAnchor) {
          applySourceAnchorDataset(paraWrapper, block.sourceAnchor);
          applyLayoutIdentityDataset(
            paraWrapper,
            buildLayoutSourceIdentity({
              blockId: block.id,
              kind: 'para',
              fromLine: localStartLine,
              toLine: localEndLine,
              sourceAnchor: block.sourceAnchor,
              ...(context.story ? { story: context.story } : {}),
            }),
          );
        }

        const result = yield* renderParagraphContentWork({
          doc,
          frameEl: paraWrapper,
          block: block as ParagraphBlock,
          measure: paragraphMeasure,
          containerKind: 'table-cell',
          width: contentWidthPx,
          localStartLine,
          localEndLine,
          wordLayout: wordLayout ?? undefined,
          spacingPolicy: {
            isFirstBlock: i === 0,
            isLastBlock: isLastBlockInCell,
            paddingTop: verticalText ? (verticalText.direction === 'btLr' ? paddingLeft : paddingRight) : paddingTop,
          },
          sdtBoundary,
          ancestorContainerKey,
          ancestorContainerSdt,
          ancestorContainerKeys,
          ancestorContainerSdts,
          onSdtContainerChrome: () => {
            cellEl.style.overflow = 'visible';
            onSdtContainerChrome?.();
          },
          contentControlsChrome: chrome,
          applySdtDataset,
          resolvePhysical,
          renderLine: ({ block, line, lineIndex, isLastLine, resolvedListTextStartPx }) =>
            renderLine(block, line, context, lineIndex, isLastLine, resolvedListTextStartPx),
          convertFinalParagraphMark: isLastBlockInCell,
          lineTopOffset: flowCursorY,
        });
        renderedLines.push(...result.renderedLines);
        flowCursorY += result.totalHeight;

        cumulativeLineCount += blockLineCount;
      }
      // Unsupported block types are skipped (no line count contribution)
      // TODO: Handle other block types (list) if needed
    }

    // Handle anchor elements
    const verticalAlign = cell?.attrs?.verticalAlign;
    // The measurer includes paragraph-relative floating objects in cellMeasure.height
    // when layoutInCell is enabled. Use that measured footprint for vertical alignment:
    // flex layout only sees in-flow children, so basing this on flowCursorY alone can
    // center the anchor paragraph while pushing a cell-sized object out of the row.
    // An exact-height row must therefore consume the larger measured footprint even
    // though the anchored object remains absolutely positioned.
    const measuredContentHeightPx = Math.max(0, cellMeasure.height - paddingTop - paddingBottom);
    const alignmentContentHeight = Math.max(flowCursorY, measuredContentHeightPx);
    const remainingSpace = contentHeightPx - alignmentContentHeight;
    const alignmentOffsetY =
      verticalAlign === 'center'
        ? Math.max(0, remainingSpace / 2)
        : verticalAlign === 'bottom'
          ? Math.max(0, remainingSpace)
          : 0;

    const wrapExclusions: WrapExclusion[] = [];
    for (const entry of anchoredBlocks) {
      const anchoredBlock = entry.block;
      const anchoredMeasure = entry.measure;
      const anchor = anchoredBlock.anchor;
      if (!anchor || !anchor.isAnchored) {
        continue;
      }

      const objectWidth = anchoredMeasure.width;
      const objectHeight = anchoredMeasure.height;

      const baseLeft = anchor.offsetH ?? 0;
      // Word probes (SD-3626, real Word 16 PDF-measured): a cell-anchored object with
      // hRelativeFrom="column" is positioned offsetH from the CELL CONTENT BOX - not from the
      // page text column - and layoutInCell (1 or 0) does not change that base. Square-wrapped
      // objects are additionally CLAMPED so the right edge stays inside the cell content box,
      // while wrapNone objects overflow freely (both probed). The clamp is deliberately limited
      // to Square: it is the only wrap type probed AND the only one this function builds cell
      // wrap exclusions for, so widening it would move objects without wrapping text around
      // them. Probe Tight/Through/TopAndBottom before extending.
      const clampsToCell = anchoredBlock.wrap?.type === 'Square';
      const clampedLeft =
        clampsToCell && baseLeft + objectWidth > contentWidthPx ? Math.max(0, contentWidthPx - objectWidth) : baseLeft;
      // Omitted hRelativeFrom defaults to column, matching the shared body-path model
      // (resolveAnchoredGraphicX in @superdoc/contracts uses the same default).
      const left = (anchor.hRelativeFrom ?? 'column') === 'column' ? clampedLeft : baseLeft;
      const anchorParagraphId =
        typeof anchoredBlock.attrs?.anchorParagraphId === 'string' ? anchoredBlock.attrs.anchorParagraphId : undefined;
      const resolvedTop = resolveCellAnchoredTop({
        anchor,
        anchorParagraphId,
        cellBlocks,
        blockMeasures,
        globalFromLine,
        globalToLine,
        paddingTop,
        objectHeight,
      });
      if (resolvedTop === null) {
        continue;
      }
      // Flow content is shifted by alignmentOffsetY via the flex container (verticalAlign
      // center/bottom), and applySquareWrapExclusionsToLines compares lines in that shifted
      // space - paragraph-anchored objects and their exclusions must follow the paragraph
      // into that visual space. Fallback results (page/margin bases, missing anchor id)
      // keep the legacy top-of-cell invariant and stay unshifted.
      const top = resolvedTop.top + (resolvedTop.paragraphResolved ? alignmentOffsetY : 0);

      const behindDoc =
        anchor.behindDoc === true || (anchoredBlock.wrap?.type === 'None' && anchoredBlock.wrap?.behindDoc);
      // Match top-level anchored media: a non-behind object must remain above
      // the cell/page paint even when OOXML relativeHeight normalizes to zero.
      // Using the raw block value here made such drawings un-hittable because
      // z-index: 0 placed them behind the page's stacking background.
      const rawZIndex =
        typeof anchoredBlock.zIndex === 'number'
          ? anchoredBlock.zIndex
          : normalizeZIndex(anchoredBlock.attrs?.originalAttributes);
      const zIndex = resolveFloatingZIndex(Boolean(behindDoc), rawZIndex);

      const wrap = anchoredBlock.wrap;
      if (!behindDoc && wrap?.type === 'Square') {
        const wrapText = (wrap.wrapText ?? 'bothSides') as WrapTextMode;
        const distLeft = anchoredBlock.padding?.left ?? 0;
        const distRight = anchoredBlock.padding?.right ?? 0;
        const distTop = anchoredBlock.padding?.top ?? 0;
        const distBottom = anchoredBlock.padding?.bottom ?? 0;
        wrapExclusions.push({
          left: left - distLeft,
          right: left + objectWidth + distRight,
          top: top - distTop,
          bottom: top + objectHeight + distBottom,
          wrapText,
        });
      }

      if (anchoredBlock.kind === 'image') {
        const imageWrapper = doc.createElement('div');
        imageWrapper.style.position = 'absolute';
        imageWrapper.style.left = `${left}px`;
        imageWrapper.style.top = `${top}px`;
        imageWrapper.style.width = `${objectWidth}px`;
        imageWrapper.style.height = `${objectHeight}px`;
        imageWrapper.style.maxWidth = '100%';
        imageWrapper.style.boxSizing = 'border-box';
        imageWrapper.style.zIndex = String(zIndex);
        applyTableImageInteractionDataset(imageWrapper, anchoredBlock);
        applySdtDataset(imageWrapper, anchoredBlock.attrs?.sdt);

        imageWrapper.appendChild(
          createBlockImageContent({
            doc,
            block: anchoredBlock,
            className: 'superdoc-table-image',
            clipContainer: imageWrapper,
            imageDisplay: 'block',
            buildImageHyperlinkAnchor: buildTableImageHyperlinkAnchor,
          }),
        );
        content.appendChild(imageWrapper);
      } else {
        const drawingWrapper = doc.createElement('div');
        drawingWrapper.style.position = 'absolute';
        drawingWrapper.style.left = `${left}px`;
        drawingWrapper.style.top = `${top}px`;
        drawingWrapper.style.width = `${objectWidth}px`;
        drawingWrapper.style.height = `${objectHeight}px`;
        drawingWrapper.style.maxWidth = '100%';
        drawingWrapper.style.boxSizing = 'border-box';
        drawingWrapper.style.zIndex = String(zIndex);
        drawingWrapper.dataset.blockId = anchoredBlock.id;
        applySdtDataset(drawingWrapper, anchoredBlock.attrs as SdtMetadata | undefined);

        const drawingInner = doc.createElement('div');
        drawingInner.classList.add('superdoc-table-drawing');
        drawingInner.style.width = '100%';
        drawingInner.style.height = '100%';
        drawingInner.style.display = 'flex';
        drawingInner.style.alignItems = 'center';
        drawingInner.style.justifyContent = 'center';
        drawingInner.style.overflow = 'hidden';

        if (anchoredBlock.drawingKind === 'image' && 'src' in anchoredBlock && anchoredBlock.src) {
          drawingInner.appendChild(
            createBlockImageContent({
              doc,
              block: anchoredBlock as ImageDrawing,
              className: 'superdoc-drawing-image',
              clipContainer: drawingInner,
              imageDisplay: 'block',
              buildImageHyperlinkAnchor: buildTableImageHyperlinkAnchor,
            }),
          );
        } else if (renderDrawingContent) {
          const drawingContent = renderDrawingContent(
            anchoredBlock as DrawingBlock,
            drawingWrapper,
            anchoredMeasure as DrawingMeasure,
          );
          drawingContent.style.width = '100%';
          drawingContent.style.height = '100%';
          drawingInner.appendChild(drawingContent);
        } else {
          const placeholder = doc.createElement('div');
          placeholder.classList.add('superdoc-drawing-placeholder');
          placeholder.style.width = '100%';
          placeholder.style.height = '100%';
          const stripePattern =
            'repeating-linear-gradient(45deg, rgba(15,23,42,0.1), rgba(15,23,42,0.1) 6px, rgba(15,23,42,0.2) 6px, rgba(15,23,42,0.2) 12px)';
          // Set both shorthand and longhand to handle partial CSS property support in test DOMs.
          placeholder.style.background = stripePattern;
          placeholder.style.backgroundImage = stripePattern;
          placeholder.style.border = '1px dashed rgba(15, 23, 42, 0.3)';
          drawingInner.appendChild(placeholder);
        }

        drawingWrapper.appendChild(drawingInner);
        content.appendChild(drawingWrapper);
      }
    }

    // Apply wrapSquare exclusions after all blocks are rendered and anchored positions are known.
    // This keeps anchored objects out-of-flow while preventing text overlap in table cells.
    applySquareWrapExclusionsToLines(renderedLines, wrapExclusions, contentWidthPx, alignmentOffsetY);

    if (captureLineSnapshot && !verticalText) {
      for (const rendered of renderedLines) {
        const candidateLine = rendered.el.classList.contains('superdoc-line')
          ? rendered.el
          : rendered.el.querySelector('.superdoc-line');
        if (!(candidateLine instanceof HTMLElement)) {
          continue;
        }
        const wrapperEl = rendered.el.classList.contains('superdoc-line') ? undefined : rendered.el;
        captureLineSnapshot(candidateLine, context, { inTableParagraph: false, wrapperEl });
      }
    }
  }

  return { cellElement: cellEl };
}

export const renderTableCell = (deps: TableCellRenderDependencies): TableCellRenderResult =>
  completeRenderWork(renderTableCellWork(deps));
