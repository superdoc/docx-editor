/**
 * Pure layout-side helpers for pointer-hit resolution.
 *
 * This module contains the geometry and data-lookup functions extracted from the
 * original monolithic `clickToPosition()`. Everything here is DOM-free — no
 * `elementsFromPoint`, no `getBoundingClientRect`, no `HTMLElement` references.
 *
 * @module position-hit
 */

import type {
  FlowBlock,
  Layout,
  Page,
  ColumnLayout,
  Measure,
  Fragment,
  DrawingFragment,
  ImageFragment,
  Run,
  Line,
  TableFragment,
  TableBlock,
  TableMeasure,
  ParagraphBlock,
  ParagraphMeasure,
  TextboxDrawing,
} from '@superdoc/contracts';
import {
  adjustAvailableWidthForTextIndent,
  computeLinePmRange,
  getColumnAtX,
  getColumnGeometry,
  getFirstLineIndentOffset,
  getParagraphInlineDirection,
  normalizeColumnLayout,
} from '@superdoc/contracts';
import { charOffsetToPm, findCharacterAtX } from './text-measurement.js';
import type { PageGeometryHelper } from './page-geometry-helper.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Point = { x: number; y: number };
export type PageHit = { pageIndex: number; page: Layout['pages'][number] };
export type FragmentHit = {
  fragment: Fragment;
  block: FlowBlock;
  measure: Measure;
  pageIndex: number;
  pageY: number;
};

export type PositionHit = {
  pos: number;
  layoutEpoch: number;
  blockId: string;
  pageIndex: number;
  column: number;
  lineIndex: number;
};

/**
 * Result of hit-testing a table fragment.
 * Contains all information needed to identify the cell and paragraph at a click point.
 */
export type TableHitResult = {
  /** The table fragment that was hit */
  fragment: TableFragment;
  /** The table block from the document structure */
  block: TableBlock;
  /** The table measurement data */
  measure: TableMeasure;
  /** Index of the page containing the hit */
  pageIndex: number;
  /** Row index of the hit cell (0-based) */
  cellRowIndex: number;
  /** Column index of the hit cell (0-based) */
  cellColIndex: number;
  /** The paragraph block inside the cell */
  cellBlock: ParagraphBlock;
  /** Measurement data for the paragraph inside the cell */
  cellMeasure: ParagraphMeasure;
  /** X coordinate relative to the cell content area */
  localX: number;
  /** Y coordinate relative to the cell content area */
  localY: number;
  /**
   * Cumulative line count of preceding paragraph blocks in this cell.
   * Used by callers to compute the hit paragraph's local first-line flag
   * when the row continues from a prior page: `isFirstLineOfParagraph` is
   * `lineIndex === 0 && max(0, cellLineStart - blockStartGlobal) === 0`,
   * matching `renderTableCell.ts`'s `localStartLine` computation.
   */
  blockStartGlobal: number;
};

export type TextboxHitResult = {
  /** The textbox drawing fragment that was hit */
  fragment: DrawingFragment;
  /** The textbox drawing block from the document structure */
  block: Extract<FlowBlock, { kind: 'drawing'; drawingKind: 'textboxShape' }>;
  /** The drawing measurement data */
  measure: Measure;
  /** Index of the page containing the hit */
  pageIndex: number;
  /** The paragraph block inside the textbox */
  contentBlock: ParagraphBlock;
  /** Measurement data for the paragraph inside the textbox */
  contentMeasure: ParagraphMeasure;
  /** Paragraph index inside block.contentBlocks */
  paragraphIndex: number;
  /** X coordinate relative to the textbox content area */
  localX: number;
  /** Y coordinate relative to the paragraph content area */
  localY: number;
  /** Cumulative line count of preceding textbox paragraphs */
  blockStartGlobal: number;
};

type AtomicFragment = DrawingFragment | ImageFragment;

export type GeometryPageHint = {
  pageIndex: number;
  pageRelativeY?: number;
};

export type ClickToPositionGeometryOptions = {
  geometryHelper?: PageGeometryHelper;
  pageHint?: GeometryPageHint;
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export const isAtomicFragment = (fragment: Fragment): fragment is AtomicFragment => {
  return fragment.kind === 'drawing' || fragment.kind === 'image';
};

const blockPmRangeFromAttrs = (block: FlowBlock): { pmStart?: number; pmEnd?: number } => {
  const attrs = (block as { attrs?: Record<string, unknown> })?.attrs;
  const pmStart = typeof attrs?.pmStart === 'number' ? attrs.pmStart : undefined;
  const pmEnd = typeof attrs?.pmEnd === 'number' ? attrs.pmEnd : pmStart != null ? pmStart + 1 : undefined;
  return { pmStart, pmEnd };
};

export const getAtomicPmRange = (fragment: AtomicFragment, block: FlowBlock): { pmStart?: number; pmEnd?: number } => {
  const pmStart = typeof fragment.pmStart === 'number' ? fragment.pmStart : blockPmRangeFromAttrs(block).pmStart;
  const pmEnd = typeof fragment.pmEnd === 'number' ? fragment.pmEnd : blockPmRangeFromAttrs(block).pmEnd;
  return { pmStart, pmEnd };
};

export const isRtlBlock = (block: FlowBlock): boolean => {
  if (block.kind !== 'paragraph') return false;
  // Do NOT consult attrs.textDirection here: that's writing-mode (ECMA §17.18.93,
  // values lrTb/tbRl/btLr/lrTbV/tbRlV/tbLrV) which is a separate axis from inline RTL.
  return getParagraphInlineDirection(block.attrs) === 'rtl';
};

// Columns governing a hit at this page-relative y: prefer the mid-page column REGION it falls in (a
// continuous section break can change columns within a page; page.columns is only the page-START
// config, so the contract carries per-region geometry in page.columnRegions, whose yStart/yEnd are
// page-relative like fragment.y). Otherwise the page's own page.columns. layout.columns (the
// document-wide / final-active config) is consulted ONLY when no page is supplied: a supplied page is
// authoritative, and a page with no page.columns is single-column (the engine leaves it unset for
// single-column pages; callers treat the undefined result as column 0). Deliberately NOT
// `page.columns ?? layout.columns`: falling back to the document-wide columns for an existing
// single-column page would reintroduce the cross-section mis-mapping this resolves. Shared by
// determineColumn and determineTableColumn. (SD-2629)
function resolveColumnsForHit(layout: Layout, page: Page | undefined, fragmentY?: number): ColumnLayout | undefined {
  if (page === undefined) return layout.columns;
  if (page.columnRegions && typeof fragmentY === 'number') {
    const region = page.columnRegions.find((r) => fragmentY >= r.yStart && fragmentY < r.yEnd);
    if (region) return region.columns;
  }
  return page.columns;
}

export const determineColumn = (layout: Layout, fragmentX: number, page?: Page, fragmentY?: number): number => {
  const columns = resolveColumnsForHit(layout, page, fragmentY);
  if (!columns || columns.count <= 1) return 0;
  // Mirror the engine's placement coordinates: fragments sit at marginLeft + content-relative column
  // x over the CONTENT width (page width minus side margins), NOT the full page width from origin 0 -
  // the latter mis-classifies clicks near boundaries once margins are non-zero (and for 3+ or
  // asymmetric-margin layouts). Use the fragment's own page so multi-section docs with varying margins
  // stay correct, falling back to the first page's margins when no page is supplied. getColumnAtX maps
  // a gap to the preceding column.
  const pageWidth = page?.size?.w ?? layout.pageSize.w;
  const margins = page?.margins ?? layout.pages[0]?.margins;
  const marginLeft = Math.max(0, margins?.left ?? 0);
  const marginRight = Math.max(0, margins?.right ?? 0);
  const contentWidth = Math.max(1, pageWidth - (marginLeft + marginRight));
  const geometry = getColumnGeometry(normalizeColumnLayout(columns, contentWidth));
  return getColumnAtX(geometry, fragmentX, marginLeft);
};

export const determineTableColumn = (layout: Layout, fragment: TableFragment, page?: Page): number => {
  if (typeof fragment.columnIndex === 'number') {
    // Clamp against the count of the region the table sits in (by its y), not the page-START
    // page.columns: a table laid out in a mid-page two-column region carries columnIndex 1 that the
    // single-column page-start count would wrongly snap to 0. (SD-2629)
    const count = resolveColumnsForHit(layout, page, fragment.y)?.count ?? 1;
    return Math.max(0, Math.min(Math.max(0, count - 1), fragment.columnIndex));
  }
  return determineColumn(layout, fragment.x, page, fragment.y);
};

// ---------------------------------------------------------------------------
// Line / position helpers
// ---------------------------------------------------------------------------

/**
 * Finds the line index at a given Y offset within a set of lines.
 */
export const findLineIndexAtY = (lines: Line[], offsetY: number, fromLine: number, toLine: number): number | null => {
  if (!lines || lines.length === 0) return null;

  // Validate bounds to prevent out-of-bounds access
  const lineCount = lines.length;
  if (fromLine < 0 || toLine > lineCount || fromLine >= toLine) {
    return null;
  }

  let cursor = 0;
  for (let i = fromLine; i < toLine; i += 1) {
    const line = lines[i];
    if (!line) return null;

    const next = cursor + line.lineHeight;
    if (offsetY >= cursor && offsetY < next) {
      return i;
    }
    cursor = next;
  }
  // If beyond all lines, return the last line in the range
  return toLine - 1;
};

/**
 * Maps an X coordinate within a line to a ProseMirror position.
 */
export const mapPointToPm = (
  block: FlowBlock,
  line: Line,
  x: number,
  isRTL: boolean,
  availableWidthOverride?: number,
  alignmentOverride?: string,
): number | null => {
  if (block.kind !== 'paragraph') return null;
  const range = computeLinePmRange(block, line);
  if (range.pmStart == null || range.pmEnd == null) return null;

  const result = findCharacterAtX(block, line, x, range.pmStart, availableWidthOverride, alignmentOverride);

  let pmPosition = result.pmPosition;
  if (isRTL) {
    const charOffset = result.charOffset;
    const charsInLine = Math.max(1, line.toChar - line.fromChar);
    const reversedOffset = Math.max(0, Math.min(charsInLine, charsInLine - charOffset));
    pmPosition = charOffsetToPm(block, line, reversedOffset, range.pmStart);
  }

  return pmPosition;
};

// ---------------------------------------------------------------------------
// Fragment helpers
// ---------------------------------------------------------------------------

/**
 * Finds the nearest paragraph or atomic fragment to a point on a page.
 */
export function snapToNearestFragment(
  pageHit: PageHit,
  blocks: FlowBlock[],
  measures: Measure[],
  pageRelativePoint: Point,
): FragmentHit | null {
  const fragments = pageHit.page.fragments.filter(
    (f: Fragment | undefined): f is Fragment => f != null && typeof f === 'object',
  );
  let nearestHit: FragmentHit | null = null;
  let nearestDist = Infinity;

  for (const frag of fragments) {
    const isPara = frag.kind === 'para';
    const isAtomic = isAtomicFragment(frag);
    if (!isPara && !isAtomic) continue;

    const blockIndex = findBlockIndexByFragmentId(blocks, frag.blockId);
    if (blockIndex === -1) continue;
    const block = blocks[blockIndex];
    const measure = measures[blockIndex];
    if (!block || !measure) continue;

    let fragHeight = 0;
    if (isAtomic) {
      fragHeight = frag.height;
    } else if (isPara && block.kind === 'paragraph' && measure.kind === 'paragraph') {
      fragHeight = measure.lines
        .slice(frag.fromLine, frag.toLine)
        .reduce((sum: number, line: Line) => sum + line.lineHeight, 0);
    } else {
      continue;
    }

    const top = frag.y;
    const bottom = frag.y + fragHeight;
    let dist: number;
    if (pageRelativePoint.y < top) {
      dist = top - pageRelativePoint.y;
    } else if (pageRelativePoint.y > bottom) {
      dist = pageRelativePoint.y - bottom;
    } else {
      dist = 0;
    }

    if (dist < nearestDist) {
      nearestDist = dist;
      const pageY = Math.max(0, Math.min(pageRelativePoint.y - top, fragHeight));
      nearestHit = {
        fragment: frag,
        block,
        measure,
        pageIndex: pageHit.pageIndex,
        pageY,
      };
    }
  }

  return nearestHit;
}

// ---------------------------------------------------------------------------
// Block lookup
// ---------------------------------------------------------------------------

/**
 * Find a block by fragment blockId, handling continuation fragments.
 * When paragraphs split across pages, continuation fragments get suffixed IDs
 * (e.g., "5-paragraph-1") while the blocks array uses the base ID ("5-paragraph").
 */
// Identity-memoized block-id indexes. Hit/geometry mapping calls
// findBlockIndexByFragmentId once per FRAGMENT while iterating pages, and the
// linear findIndex made that O(fragments × blocks) — ~13M comparisons
// (~125ms of self time) per caret update on a 136-page document. The blocks
// array is stable between committed passes (the retained chain reuses it), so
// one map per array identity amortizes to a plain lookup. Entries release
// with the arrays (WeakMap).
type BlockIndexLookup = {
  /** First index per id, skipping page/section breaks (findIndex parity). */
  firstIndexById: Map<string, number>;
  /** Paragraph indices per id, in document order (split-suffix fallback). */
  paragraphIndicesById: Map<string, number[]>;
};
const blockIndexLookupMemo = new WeakMap<FlowBlock[], BlockIndexLookup>();

function blockIndexLookup(blocks: FlowBlock[]): BlockIndexLookup {
  const memoized = blockIndexLookupMemo.get(blocks);
  if (memoized) return memoized;
  const firstIndexById = new Map<string, number>();
  const paragraphIndicesById = new Map<string, number[]>();
  for (let idx = 0; idx < blocks.length; idx += 1) {
    const block = blocks[idx];
    if (block.kind !== 'pageBreak' && block.kind !== 'sectionBreak' && !firstIndexById.has(block.id)) {
      firstIndexById.set(block.id, idx);
    }
    if (block.kind === 'paragraph') {
      const list = paragraphIndicesById.get(block.id);
      if (list) list.push(idx);
      else paragraphIndicesById.set(block.id, [idx]);
    }
  }
  const lookup: BlockIndexLookup = { firstIndexById, paragraphIndicesById };
  blockIndexLookupMemo.set(blocks, lookup);
  return lookup;
}

export function findBlockIndexByFragmentId(
  blocks: FlowBlock[],
  fragmentBlockId: string,
  targetPmRange?: { from: number; to: number },
): number {
  const lookup = blockIndexLookup(blocks);
  const index = lookup.firstIndexById.get(fragmentBlockId);
  if (index !== undefined) {
    return index;
  }

  const baseBlockId = fragmentBlockId.replace(/-\d+$/, '');
  if (baseBlockId === fragmentBlockId) {
    return -1;
  }

  const matchingIndices = lookup.paragraphIndicesById.get(baseBlockId) ?? [];

  if (matchingIndices.length === 0) {
    return -1;
  }

  if (matchingIndices.length === 1) {
    return matchingIndices[0];
  }

  if (targetPmRange) {
    for (const idx of matchingIndices) {
      const block = blocks[idx];
      if (block.kind !== 'paragraph') continue;

      const hasOverlap = block.runs.some((run: Run) => {
        if (run.pmStart == null || run.pmEnd == null) return false;
        return run.pmEnd > targetPmRange.from && run.pmStart < targetPmRange.to;
      });
      if (hasOverlap) {
        return idx;
      }
    }
  }

  return matchingIndices[0];
}

// ---------------------------------------------------------------------------
// Page geometry fallback
// ---------------------------------------------------------------------------

/**
 * Calculates cumulative Y position for a page (fallback when no geometry helper provided).
 */
export const calculatePageTopFallback = (layout: Layout, pageIndex: number): number => {
  const pageGap = layout.pageGap ?? 0;
  let y = 0;
  for (let i = 0; i < pageIndex; i++) {
    const pageHeight = layout.pages[i]?.size?.h ?? layout.pageSize.h;
    y += pageHeight + pageGap;
  }
  return y;
};

// ---------------------------------------------------------------------------
// Hit test functions
// ---------------------------------------------------------------------------

/**
 * Find the page hit given layout and a coordinate relative to the layout container.
 * Accounts for gaps between pages when calculating page boundaries.
 */
export function hitTestPage(layout: Layout, point: Point, geometryHelper?: PageGeometryHelper): PageHit | null {
  if (geometryHelper) {
    const pageIndex = geometryHelper.getPageIndexAtY(point.y);
    if (pageIndex !== null) {
      return { pageIndex, page: layout.pages[pageIndex] };
    }
    const nearest = geometryHelper.getNearestPageIndex(point.y);
    if (nearest !== null) {
      return { pageIndex: nearest, page: layout.pages[nearest] };
    }
    return null;
  }

  const pageGap = layout.pageGap ?? 0;
  let cursorY = 0;
  let nearestIndex: number | null = null;
  let nearestDistance = Infinity;
  for (let pageIndex = 0; pageIndex < layout.pages.length; pageIndex += 1) {
    const page = layout.pages[pageIndex];
    const pageHeight = page.size?.h ?? layout.pageSize.h;
    const top = cursorY;
    const bottom = top + pageHeight;
    if (point.y >= top && point.y < bottom) {
      return { pageIndex, page };
    }
    const center = top + pageHeight / 2;
    const distance = Math.abs(point.y - center);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = pageIndex;
    }
    cursorY = bottom + pageGap;
  }
  if (nearestIndex !== null) {
    return { pageIndex: nearestIndex, page: layout.pages[nearestIndex] };
  }
  return null;
}

/**
 * Hit-test fragments within a page for a given point (page-relative coordinates).
 */
export function hitTestFragment(
  layout: Layout,
  pageHit: PageHit,
  blocks: FlowBlock[],
  measures: Measure[],
  point: Point,
): FragmentHit | null {
  const fragments = [...pageHit.page.fragments].sort((a, b) => {
    const ay = a.kind === 'para' ? a.y : 0;
    const by = b.kind === 'para' ? b.y : 0;
    if (Math.abs(ay - by) > 0.5) return ay - by;
    const ax = a.kind === 'para' ? a.x : 0;
    const bx = b.kind === 'para' ? b.x : 0;
    return ax - bx;
  });

  for (const fragment of fragments) {
    if (fragment.kind !== 'para') continue;
    const blockIndex = findBlockIndexByFragmentId(blocks, fragment.blockId);
    if (blockIndex === -1) continue;
    const block = blocks[blockIndex];
    const measure = measures[blockIndex];
    if (!block || block.kind !== 'paragraph' || measure?.kind !== 'paragraph') continue;

    const fragmentHeight = measure.lines
      .slice(fragment.fromLine, fragment.toLine)
      .reduce((sum: number, line: Line) => sum + line.lineHeight, 0);

    const withinX = point.x >= fragment.x && point.x <= fragment.x + fragment.width;
    const withinY = point.y >= fragment.y && point.y <= fragment.y + fragmentHeight;
    if (!withinX || !withinY) {
      continue;
    }

    return {
      fragment,
      block,
      measure,
      pageIndex: pageHit.pageIndex,
      pageY: point.y - fragment.y,
    };
  }

  return null;
}

export const hitTestAtomicFragment = (
  pageHit: PageHit,
  blocks: FlowBlock[],
  measures: Measure[],
  point: Point,
): FragmentHit | null => {
  for (const fragment of pageHit.page.fragments) {
    if (!isAtomicFragment(fragment)) continue;
    const withinX = point.x >= fragment.x && point.x <= fragment.x + fragment.width;
    const withinY = point.y >= fragment.y && point.y <= fragment.y + fragment.height;
    if (!withinX || !withinY) continue;

    const blockIndex = findBlockIndexByFragmentId(blocks, fragment.blockId);
    if (blockIndex === -1) continue;
    const block = blocks[blockIndex];
    const measure = measures[blockIndex];
    if (!block || !measure) continue;

    return {
      fragment,
      block,
      measure,
      pageIndex: pageHit.pageIndex,
      pageY: 0,
    };
  }
  return null;
};

/**
 * Hit-test table fragments to find the cell and paragraph at a click point.
 */
export const hitTestTableFragment = (
  pageHit: PageHit,
  blocks: FlowBlock[],
  measures: Measure[],
  point: Point,
): TableHitResult | null => {
  for (const fragment of pageHit.page.fragments) {
    if (fragment.kind !== 'table') continue;

    const tableFragment = fragment as TableFragment;
    const withinX = point.x >= tableFragment.x && point.x <= tableFragment.x + tableFragment.width;
    const withinY = point.y >= tableFragment.y && point.y <= tableFragment.y + tableFragment.height;
    if (!withinX || !withinY) continue;

    const blockIndex = blocks.findIndex((block) => block.id === tableFragment.blockId);
    if (blockIndex === -1) continue;

    const block = blocks[blockIndex];
    const measure = measures[blockIndex];
    if (!block || block.kind !== 'table' || !measure || measure.kind !== 'table') continue;

    const tableBlock = block as TableBlock;
    const tableMeasure = measure as TableMeasure;

    const localX = point.x - tableFragment.x;
    const localY = point.y - tableFragment.y;

    // Find the row at localY
    let rowY = 0;
    let rowIndex = -1;
    if (tableMeasure.rows.length === 0 || tableBlock.rows.length === 0) continue;
    for (let r = tableFragment.fromRow; r < tableFragment.toRow && r < tableMeasure.rows.length; r++) {
      const rowMeasure = tableMeasure.rows[r];
      if (localY >= rowY && localY < rowY + rowMeasure.height) {
        rowIndex = r;
        break;
      }
      rowY += rowMeasure.height;
    }

    if (rowIndex === -1) {
      rowIndex = Math.min(tableFragment.toRow - 1, tableMeasure.rows.length - 1);
      if (rowIndex < tableFragment.fromRow) continue;
    }

    const rowMeasure = tableMeasure.rows[rowIndex];
    const row = tableBlock.rows[rowIndex];
    if (!rowMeasure || !row) continue;

    // Find the column at localX
    const firstCellGridStart = rowMeasure.cells[0]?.gridColumnStart ?? 0;
    let colX = 0;
    if (firstCellGridStart > 0 && tableMeasure.columnWidths) {
      for (let col = 0; col < firstCellGridStart && col < tableMeasure.columnWidths.length; col++) {
        colX += tableMeasure.columnWidths[col];
      }
    }
    const initialColX = colX;

    let colIndex = -1;
    if (rowMeasure.cells.length === 0 || row.cells.length === 0) continue;
    for (let c = 0; c < rowMeasure.cells.length; c++) {
      const cellMeasure = rowMeasure.cells[c];
      if (localX >= colX && localX < colX + cellMeasure.width) {
        colIndex = c;
        break;
      }
      colX += cellMeasure.width;
    }

    if (colIndex === -1) {
      if (localX < initialColX) {
        colIndex = 0;
      } else {
        colIndex = rowMeasure.cells.length - 1;
      }
      if (colIndex < 0) continue;
    }

    const cellMeasure = rowMeasure.cells[colIndex];
    const cell = row.cells[colIndex];
    if (!cellMeasure || !cell) continue;

    const cellBlocks = cell.blocks ?? (cell.paragraph ? [cell.paragraph] : []);
    const rawMeasures = cellMeasure.blocks ?? (cellMeasure.paragraph ? [cellMeasure.paragraph] : []);
    const cellBlockMeasures = (Array.isArray(rawMeasures) ? rawMeasures : []).filter(
      (m): m is Measure => m != null && typeof m === 'object' && 'kind' in m,
    );

    let blockStartY = 0;
    // Cumulative line count of preceding paragraph blocks in this cell.
    // Tracked in parallel with blockStartY so we can report it on hit return —
    // callers use it to compute the hit paragraph's local first-line flag
    // when a row spans multiple pages (matches renderTableCell's per-block
    // `localStartLine = max(0, globalFromLine - blockStartGlobal)`).
    let blockStartGlobalLines = 0;
    const getBlockHeight = (m: Measure | undefined): number => {
      if (!m) return 0;
      if ('totalHeight' in m && typeof (m as { totalHeight?: number }).totalHeight === 'number') {
        return (m as { totalHeight: number }).totalHeight;
      }
      if ('height' in m && typeof (m as { height?: number }).height === 'number') {
        return (m as { height: number }).height;
      }
      return 0;
    };

    let nearestParagraphHit:
      | (Omit<TableHitResult, 'fragment' | 'block' | 'measure' | 'pageIndex' | 'cellRowIndex' | 'cellColIndex'> & {
          distance: number;
        })
      | null = null;

    for (let i = 0; i < cellBlocks.length && i < cellBlockMeasures.length; i++) {
      const cellBlock = cellBlocks[i];
      const cellBlockMeasure = cellBlockMeasures[i];
      if (cellBlock?.kind !== 'paragraph' || cellBlockMeasure?.kind !== 'paragraph') {
        blockStartY += getBlockHeight(cellBlockMeasure);
        continue;
      }

      const blockHeight = getBlockHeight(cellBlockMeasure);
      const blockEndY = blockStartY + blockHeight;

      const padding = cell.attrs?.padding ?? { top: 0, left: 4, right: 4, bottom: 0 };
      const cellLocalX = localX - colX - (padding.left ?? 4);
      const cellLocalY = localY - rowY - (padding.top ?? 0);
      const paragraphBlock = cellBlock as ParagraphBlock;
      const paragraphMeasure = cellBlockMeasure as ParagraphMeasure;

      const isWithinBlock = cellLocalY >= blockStartY && cellLocalY < blockEndY;
      if (isWithinBlock) {
        const unclampedLocalY = cellLocalY - blockStartY;
        const localYWithinBlock = Math.max(0, Math.min(unclampedLocalY, Math.max(blockHeight, 0)));
        return {
          fragment: tableFragment,
          block: tableBlock,
          measure: tableMeasure,
          pageIndex: pageHit.pageIndex,
          cellRowIndex: rowIndex,
          cellColIndex: colIndex,
          cellBlock: paragraphBlock,
          cellMeasure: paragraphMeasure,
          localX: Math.max(0, cellLocalX),
          localY: Math.max(0, localYWithinBlock),
          blockStartGlobal: blockStartGlobalLines,
        };
      }

      const distanceToBlock = cellLocalY < blockStartY ? blockStartY - cellLocalY : Math.max(0, cellLocalY - blockEndY);
      if (!nearestParagraphHit || distanceToBlock < nearestParagraphHit.distance) {
        const unclampedLocalY = cellLocalY - blockStartY;
        nearestParagraphHit = {
          cellBlock: paragraphBlock,
          cellMeasure: paragraphMeasure,
          localX: Math.max(0, cellLocalX),
          localY: Math.max(0, Math.min(unclampedLocalY, Math.max(blockHeight, 0))),
          blockStartGlobal: blockStartGlobalLines,
          distance: distanceToBlock,
        };
      }

      blockStartY = blockEndY;
      blockStartGlobalLines += paragraphMeasure.lines.length;
    }

    if (nearestParagraphHit) {
      return {
        fragment: tableFragment,
        block: tableBlock,
        measure: tableMeasure,
        pageIndex: pageHit.pageIndex,
        cellRowIndex: rowIndex,
        cellColIndex: colIndex,
        cellBlock: nearestParagraphHit.cellBlock,
        cellMeasure: nearestParagraphHit.cellMeasure,
        localX: nearestParagraphHit.localX,
        localY: nearestParagraphHit.localY,
        blockStartGlobal: nearestParagraphHit.blockStartGlobal,
      };
    }
  }

  return null;
};

/**
 * Walk the paragraph content of an already-resolved textbox fragment and return the
 * paragraph hit at `point`. Callers that already hold a resolved fragment/block should
 * call this directly instead of {@link hitTestTextboxFragment}, which would otherwise
 * re-scan every page fragment and could resolve a different textbox for overlapping shapes.
 */
export const resolveTextboxContentHit = (
  fragment: DrawingFragment,
  block: TextboxDrawing,
  measure: Measure,
  pageIndex: number,
  point: Point,
): TextboxHitResult | null => {
  const contentMeasures = Array.isArray(fragment.contentMeasures)
    ? fragment.contentMeasures
    : Array.isArray(block.contentMeasures)
      ? block.contentMeasures
      : [];
  const contentBlocks = Array.isArray(block.contentBlocks) ? block.contentBlocks : [];
  if (contentMeasures.length === 0 || contentBlocks.length === 0) return null;

  const insets = block.textInsets ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const localX = Math.max(0, point.x - fragment.x - insets.left);
  const rawLocalY = point.y - fragment.y - insets.top;

  // Mirror the painter's flex justifyContent offset for center/bottom alignment
  // (renderer.ts renderTextboxContent sets justifyContent on the inset container).
  const totalContentHeight = contentMeasures.reduce(
    (sum, contentMeasure) =>
      sum +
      (contentMeasure?.kind === 'paragraph' || contentMeasure?.kind === 'table'
        ? (contentMeasure.totalHeight ?? 0)
        : 0),
    0,
  );
  const availableHeight = Math.max(0, fragment.height - insets.top - insets.bottom);
  const verticalAlign = block.textVerticalAlign ?? 'top';
  let contentOffset = 0;
  if (verticalAlign === 'center') {
    contentOffset = Math.max(0, (availableHeight - totalContentHeight) / 2);
  } else if (verticalAlign === 'bottom') {
    contentOffset = Math.max(0, availableHeight - totalContentHeight);
  }
  const localY = rawLocalY - contentOffset;

  let paragraphStartY = 0;
  let blockStartGlobal = 0;
  let nearestParagraphHit:
    | (Omit<TextboxHitResult, 'fragment' | 'block' | 'measure' | 'pageIndex'> & { distance: number })
    | null = null;

  for (let i = 0; i < contentBlocks.length && i < contentMeasures.length; i += 1) {
    const contentBlock = contentBlocks[i];
    const contentMeasure = contentMeasures[i];
    if (contentBlock?.kind !== 'paragraph' || contentMeasure?.kind !== 'paragraph') {
      if (contentBlock?.kind === 'table' && contentMeasure?.kind === 'table') {
        paragraphStartY += contentMeasure.totalHeight;
      }
      continue;
    }

    const paragraphHeight = contentMeasure.totalHeight;
    const paragraphEndY = paragraphStartY + paragraphHeight;
    const isWithinParagraph = localY >= paragraphStartY && localY < paragraphEndY;

    if (isWithinParagraph) {
      return {
        fragment,
        block,
        measure,
        pageIndex,
        contentBlock,
        contentMeasure,
        paragraphIndex: i,
        localX,
        localY: Math.max(0, Math.min(localY - paragraphStartY, Math.max(paragraphHeight, 0))),
        blockStartGlobal,
      };
    }

    const distanceToParagraph =
      localY < paragraphStartY ? paragraphStartY - localY : Math.max(0, localY - paragraphEndY);
    if (!nearestParagraphHit || distanceToParagraph < nearestParagraphHit.distance) {
      nearestParagraphHit = {
        contentBlock,
        contentMeasure,
        paragraphIndex: i,
        localX,
        localY: Math.max(0, Math.min(localY - paragraphStartY, Math.max(paragraphHeight, 0))),
        blockStartGlobal,
        distance: distanceToParagraph,
      };
    }

    paragraphStartY = paragraphEndY;
    blockStartGlobal += contentMeasure.lines.length;
  }

  if (nearestParagraphHit) {
    return {
      fragment,
      block,
      measure,
      pageIndex,
      contentBlock: nearestParagraphHit.contentBlock,
      contentMeasure: nearestParagraphHit.contentMeasure,
      paragraphIndex: nearestParagraphHit.paragraphIndex,
      localX: nearestParagraphHit.localX,
      localY: nearestParagraphHit.localY,
      blockStartGlobal: nearestParagraphHit.blockStartGlobal,
    };
  }

  return null;
};

/**
 * Hit-test textbox drawing fragments to find the paragraph at a click point.
 * Scans all page fragments by point — when the fragment and block are already resolved,
 * call {@link resolveTextboxContentHit} directly to avoid resolving a different textbox
 * for overlapping shapes.
 */
export const hitTestTextboxFragment = (
  pageHit: PageHit,
  blocks: FlowBlock[],
  measures: Measure[],
  point: Point,
): TextboxHitResult | null => {
  for (const fragment of pageHit.page.fragments) {
    if (fragment.kind !== 'drawing' || fragment.drawingKind !== 'textboxShape') continue;

    const withinX = point.x >= fragment.x && point.x <= fragment.x + fragment.width;
    const withinY = point.y >= fragment.y && point.y <= fragment.y + fragment.height;
    if (!withinX || !withinY) continue;

    const blockIndex = findBlockIndexByFragmentId(blocks, fragment.blockId);
    if (blockIndex === -1) continue;

    const block = blocks[blockIndex];
    const measure = measures[blockIndex];
    if (!block || block.kind !== 'drawing' || block.drawingKind !== 'textboxShape' || !measure) continue;

    return resolveTextboxContentHit(fragment as DrawingFragment, block, measure, pageHit.pageIndex, point);
  }

  return null;
};

// ---------------------------------------------------------------------------
// New extracted functions
// ---------------------------------------------------------------------------

/**
 * Enriches a DOM-resolved PM position into a full PositionHit by searching layout
 * metadata. Pure data lookup — no DOM reads.
 *
 * Extracted from the DOM-success path of the original `clickToPosition()`.
 */
export function resolvePositionHitFromDomPosition(
  layout: Layout,
  blocks: FlowBlock[],
  measures: Measure[],
  domPos: number,
  layoutEpoch: number,
): PositionHit {
  let blockId = '';
  let pageIndex = 0;
  let column = 0;
  let lineIndex = -1;

  for (let pi = 0; pi < layout.pages.length; pi++) {
    const page = layout.pages[pi];
    for (const fragment of page.fragments) {
      if (fragment.kind === 'para' && fragment.pmStart != null && fragment.pmEnd != null) {
        if (domPos >= fragment.pmStart && domPos <= fragment.pmEnd) {
          blockId = fragment.blockId;
          pageIndex = pi;
          column = determineColumn(layout, fragment.x, page, fragment.y);
          const blockIndex = findBlockIndexByFragmentId(blocks, fragment.blockId);
          if (blockIndex !== -1) {
            const measure = measures[blockIndex];
            if (measure && measure.kind === 'paragraph') {
              if (fragment.lines && fragment.lines.length > 0) {
                for (let localIndex = 0; localIndex < fragment.lines.length; localIndex++) {
                  const line = fragment.lines[localIndex];
                  if (!line) continue;
                  const range = computeLinePmRange(blocks[blockIndex], line);
                  if (range.pmStart != null && range.pmEnd != null) {
                    if (domPos >= range.pmStart && domPos <= range.pmEnd) {
                      lineIndex = fragment.fromLine + localIndex;
                      break;
                    }
                  }
                }
              } else {
                for (let li = fragment.fromLine; li < fragment.toLine; li++) {
                  const line = measure.lines[li];
                  if (!line) continue;
                  const range = computeLinePmRange(blocks[blockIndex], line);
                  if (range.pmStart != null && range.pmEnd != null) {
                    if (domPos >= range.pmStart && domPos <= range.pmEnd) {
                      lineIndex = li;
                      break;
                    }
                  }
                }
              }
            }
          }
          return { pos: domPos, layoutEpoch, blockId, pageIndex, column, lineIndex };
        }
      }
    }
  }

  // Position found by DOM but fragment could not be located in layout
  return { pos: domPos, layoutEpoch, blockId: '', pageIndex: 0, column: 0, lineIndex: -1 };
}

/**
 * Geometry-only hit testing. DOM-free — no `elementsFromPoint`, no `getBoundingClientRect`.
 *
 * When `options.pageHint` is provided, uses the hint's page index and optional
 * page-relative Y instead of recomputing from geometry. This allows callers that
 * have already done DOM page detection to pass their result through.
 *
 * Extracted from the geometry fallback path of the original `clickToPosition()`.
 */
export function clickToPositionGeometry(
  layout: Layout,
  blocks: FlowBlock[],
  measures: Measure[],
  containerPoint: Point,
  options?: ClickToPositionGeometryOptions,
): PositionHit | null {
  const layoutEpoch = layout.layoutEpoch ?? 0;
  const geometryHelper = options?.geometryHelper;
  const pageHint = options?.pageHint;

  // Resolve page hit
  let pageHit: PageHit | null = null;

  if (pageHint != null) {
    const pi = pageHint.pageIndex;
    if (pi >= 0 && pi < layout.pages.length) {
      pageHit = { pageIndex: pi, page: layout.pages[pi] };
    }
  }

  if (!pageHit) {
    pageHit = hitTestPage(layout, containerPoint, geometryHelper);
  }

  if (!pageHit) {
    return null;
  }

  // Calculate page-relative point
  const pageTopY = geometryHelper
    ? geometryHelper.getPageTop(pageHit.pageIndex)
    : calculatePageTopFallback(layout, pageHit.pageIndex);
  const pageRelativePoint: Point = {
    x: containerPoint.x,
    y: pageHint?.pageRelativeY ?? containerPoint.y - pageTopY,
  };

  let fragmentHit = hitTestFragment(layout, pageHit, blocks, measures, pageRelativePoint);

  // Snap to nearest, but skip when inside a table fragment
  if (!fragmentHit) {
    const isWithinTableFragment = pageHit.page.fragments
      .filter((f) => f.kind === 'table')
      .some((f) => {
        const tf = f as TableFragment;
        return (
          pageRelativePoint.x >= tf.x &&
          pageRelativePoint.x <= tf.x + tf.width &&
          pageRelativePoint.y >= tf.y &&
          pageRelativePoint.y <= tf.y + tf.height
        );
      });
    if (!isWithinTableFragment) {
      fragmentHit = snapToNearestFragment(pageHit, blocks, measures, pageRelativePoint);
    }
  }

  if (fragmentHit) {
    const { fragment, block, measure, pageIndex, pageY } = fragmentHit;

    // Handle paragraph fragments
    if (fragment.kind === 'para' && measure.kind === 'paragraph' && block.kind === 'paragraph') {
      const lines = fragment.lines ?? measure.lines.slice(fragment.fromLine, fragment.toLine);

      const lineIndex = findLineIndexAtY(lines, pageY, 0, lines.length);
      if (lineIndex == null) {
        return null;
      }

      const line = lines[lineIndex];

      const isRTL = isRtlBlock(block);
      const indentLeft = typeof block.attrs?.indent?.left === 'number' ? block.attrs.indent.left : 0;
      const indentRight = typeof block.attrs?.indent?.right === 'number' ? block.attrs.indent.right : 0;
      const paraIndentLeft = Number.isFinite(indentLeft) ? indentLeft : 0;
      const paraIndentRight = Number.isFinite(indentRight) ? indentRight : 0;

      const totalIndent = paraIndentLeft + paraIndentRight;
      let availableWidth = Math.max(0, fragment.width - totalIndent);

      if (totalIndent > fragment.width) {
        console.warn(
          `[clickToPosition] Paragraph indents (${totalIndent}px) exceed fragment width (${fragment.width}px) ` +
            `for block ${fragment.blockId}. This may indicate a layout miscalculation. ` +
            `Available width clamped to 0.`,
        );
      }

      const markerWidth = fragment.markerWidth ?? measure.marker?.markerWidth ?? 0;
      const isListItem = markerWidth > 0;
      const hasRenderedMarkerText = isListItem && Boolean(fragment.markerTextWidth);

      // Adjust availableWidth for first-line text indent to match the painter's justify spacing.
      // Skip for list-marker first lines — the renderer doesn't adjust those (only when marker has actual text).
      const isFirstLineOfParagraph = lineIndex === 0 && !fragment.continuesFromPrev;
      if (isFirstLineOfParagraph && !hasRenderedMarkerText) {
        const suppressFLI = (block.attrs as Record<string, unknown>)?.suppressFirstLineIndent === true;
        const firstLineOffset = getFirstLineIndentOffset(block.attrs?.indent, suppressFLI);
        availableWidth = adjustAvailableWidthForTextIndent(availableWidth, firstLineOffset, line.maxWidth);
      }
      const pos = mapPointToPm(block, line, pageRelativePoint.x - fragment.x, isRTL, availableWidth);
      if (pos == null) {
        return null;
      }

      const column = determineColumn(layout, fragment.x, layout.pages[pageIndex], fragment.y);

      return {
        pos,
        layoutEpoch,
        blockId: fragment.blockId,
        pageIndex,
        column,
        lineIndex,
      };
    }

    if (
      fragment.kind === 'drawing' &&
      fragment.drawingKind === 'textboxShape' &&
      block.kind === 'drawing' &&
      block.drawingKind === 'textboxShape'
    ) {
      // Use resolveTextboxContentHit directly — fragment and block are already resolved
      // from fragmentHit, so re-scanning via hitTestTextboxFragment could pick a different
      // textbox when shapes overlap.
      const textboxHit = resolveTextboxContentHit(
        fragment as DrawingFragment,
        block,
        measure,
        pageIndex,
        pageRelativePoint,
      );
      if (textboxHit) {
        const { contentBlock, contentMeasure, localX, localY, pageIndex } = textboxHit;

        const lineIndex = findLineIndexAtY(contentMeasure.lines, localY, 0, contentMeasure.lines.length);
        if (lineIndex != null) {
          const line = contentMeasure.lines[lineIndex];
          const isRTL = isRtlBlock(contentBlock);
          const indentLeft = typeof contentBlock.attrs?.indent?.left === 'number' ? contentBlock.attrs.indent.left : 0;
          const indentRight =
            typeof contentBlock.attrs?.indent?.right === 'number' ? contentBlock.attrs.indent.right : 0;
          const paraIndentLeft = Number.isFinite(indentLeft) ? indentLeft : 0;
          const paraIndentRight = Number.isFinite(indentRight) ? indentRight : 0;
          const totalIndent = paraIndentLeft + paraIndentRight;
          const insets = textboxHit.block.textInsets ?? { top: 0, right: 0, bottom: 0, left: 0 };
          let availableWidth = Math.max(0, textboxHit.fragment.width - insets.left - insets.right - totalIndent);

          if (totalIndent > textboxHit.fragment.width) {
            console.warn(
              `[clickToPosition:textbox] Paragraph indents (${totalIndent}px) exceed fragment width (${textboxHit.fragment.width}px) ` +
                `for block ${textboxHit.fragment.blockId}. This may indicate a layout miscalculation. ` +
                `Available width clamped to 0.`,
            );
          }

          // Textboxes are page-contained and never split across pages, so lineIndex === 0
          // is sufficient — no continuesFromPrev guard needed (unlike body paragraphs).
          const isFirstLineOfParagraph = lineIndex === 0;
          if (isFirstLineOfParagraph) {
            const suppressFLI = (contentBlock.attrs as Record<string, unknown>)?.suppressFirstLineIndent === true;
            const firstLineOffset = getFirstLineIndentOffset(contentBlock.attrs?.indent, suppressFLI);
            availableWidth = adjustAvailableWidthForTextIndent(availableWidth, firstLineOffset, line.maxWidth);
          }

          const pos = mapPointToPm(contentBlock, line, localX, isRTL, availableWidth);
          if (pos != null) {
            return {
              pos,
              layoutEpoch,
              blockId: textboxHit.fragment.blockId,
              pageIndex,
              column: determineColumn(layout, textboxHit.fragment.x, layout.pages[pageIndex], textboxHit.fragment.y),
              lineIndex,
            };
          }
        }

        const firstRun = contentBlock.runs?.[0];
        if (firstRun && firstRun.pmStart != null) {
          return {
            pos: firstRun.pmStart,
            layoutEpoch,
            blockId: textboxHit.fragment.blockId,
            pageIndex,
            column: determineColumn(layout, textboxHit.fragment.x, layout.pages[pageIndex], textboxHit.fragment.y),
            lineIndex: 0,
          };
        }
      }
    }

    // Handle atomic fragments (drawing, image)
    if (isAtomicFragment(fragment)) {
      const pmRange = getAtomicPmRange(fragment, block);
      const pos = pmRange.pmStart ?? pmRange.pmEnd ?? null;
      if (pos == null) {
        return null;
      }

      return {
        pos,
        layoutEpoch,
        blockId: fragment.blockId,
        pageIndex,
        column: determineColumn(layout, fragment.x, layout.pages[pageIndex], fragment.y),
        lineIndex: -1,
      };
    }
  }

  // Try table fragment hit testing
  const tableHit = hitTestTableFragment(pageHit, blocks, measures, pageRelativePoint);
  if (tableHit) {
    const { cellBlock, cellMeasure, localX, localY, pageIndex } = tableHit;

    const lineIndex = findLineIndexAtY(cellMeasure.lines, localY, 0, cellMeasure.lines.length);
    if (lineIndex != null) {
      const line = cellMeasure.lines[lineIndex];
      const isRTL = isRtlBlock(cellBlock);
      const indentLeft = typeof cellBlock.attrs?.indent?.left === 'number' ? cellBlock.attrs.indent.left : 0;
      const indentRight = typeof cellBlock.attrs?.indent?.right === 'number' ? cellBlock.attrs.indent.right : 0;
      const paraIndentLeft = Number.isFinite(indentLeft) ? indentLeft : 0;
      const paraIndentRight = Number.isFinite(indentRight) ? indentRight : 0;

      const totalIndent = paraIndentLeft + paraIndentRight;
      let availableWidth = Math.max(0, tableHit.fragment.width - totalIndent);

      if (totalIndent > tableHit.fragment.width) {
        console.warn(
          `[clickToPosition:table] Paragraph indents (${totalIndent}px) exceed fragment width (${tableHit.fragment.width}px) ` +
            `for block ${tableHit.fragment.blockId}. This may indicate a layout miscalculation. ` +
            `Available width clamped to 0.`,
        );
      }

      const cellMarkerWidth = cellMeasure.marker?.markerWidth ?? 0;
      const isListItem = cellMarkerWidth > 0;

      // Adjust availableWidth for first-line text indent to match the painter's justify spacing.
      // Skip for list-marker first lines — the renderer doesn't adjust those.
      // When a row is split across pages, partialRow.fromLineByCell tells us the real
      // starting line for the cell slice, but the painter decides per-paragraph (see
      // renderTableCell's `localStartLine = max(0, globalFromLine - blockStartGlobal)`).
      // Subtract the hit paragraph's cumulative block offset so multi-block cells
      // spanning pages stay aligned with the painter (SD-2415).
      const cellLineStart = tableHit.fragment.partialRow?.fromLineByCell?.[tableHit.cellColIndex] ?? 0;
      const localStartLine = Math.max(0, cellLineStart - tableHit.blockStartGlobal);
      if (lineIndex === 0 && localStartLine === 0 && !isListItem) {
        const suppressFLI = (cellBlock.attrs as Record<string, unknown>)?.suppressFirstLineIndent === true;
        const firstLineOffset = getFirstLineIndentOffset(cellBlock.attrs?.indent, suppressFLI);
        availableWidth = adjustAvailableWidthForTextIndent(availableWidth, firstLineOffset, line.maxWidth);
      }
      const pos = mapPointToPm(cellBlock, line, localX, isRTL, availableWidth);

      if (pos != null) {
        return {
          pos,
          layoutEpoch,
          blockId: tableHit.fragment.blockId,
          pageIndex,
          column: determineTableColumn(layout, tableHit.fragment, layout.pages[pageIndex]),
          lineIndex,
        };
      }
    }

    // Fallback: return first position in the cell.
    // SD-3328: an EMPTY paragraph (blank line / spacer between bullets) has no runs,
    // so `firstRun` is undefined and the old code fell through to `return null`. A null
    // hit aborts the drag (EditorInputManager #handleDragSelectionAt early-return) and
    // freezes/collapses the in-progress selection while the pointer is over the blank
    // line. Derive the paragraph's own PM start from its attrs so an empty cell paragraph
    // always resolves to a valid forward position inside the cell, never null.
    const firstRun = cellBlock.runs?.[0];
    const fallbackPos = firstRun?.pmStart ?? blockPmRangeFromAttrs(cellBlock).pmStart;
    if (fallbackPos != null) {
      return {
        pos: fallbackPos,
        layoutEpoch,
        blockId: tableHit.fragment.blockId,
        pageIndex,
        column: determineTableColumn(layout, tableHit.fragment, layout.pages[pageIndex]),
        lineIndex: 0,
      };
    }
  }

  // Final fallback: direct atomic fragment hit test
  const atomicHit = hitTestAtomicFragment(pageHit, blocks, measures, pageRelativePoint);
  if (atomicHit && isAtomicFragment(atomicHit.fragment)) {
    const { fragment, block, pageIndex } = atomicHit;
    const pmRange = getAtomicPmRange(fragment, block);
    const pos = pmRange.pmStart ?? pmRange.pmEnd ?? null;
    if (pos == null) {
      return null;
    }

    return {
      pos,
      layoutEpoch,
      blockId: fragment.blockId,
      pageIndex,
      column: determineColumn(layout, fragment.x, layout.pages[pageIndex], fragment.y),
      lineIndex: -1,
    };
  }

  return null;
}
