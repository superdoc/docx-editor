import type {
  FlowBlock,
  Fragment,
  Layout,
  ListBlock,
  Measure,
  Page,
  PageRefLocation,
  ParagraphMeasure,
  Run,
  TableBlock,
  TableCell,
  TableCellMeasure,
  TableFragment,
  TableMeasure,
} from './index.js';
import { PARTIAL_ROW_RENDERS_TO_CELL_END } from './partial-row.js';
import { computeFragmentPmRange } from './pm-range.js';

// Bookmark start/end markers are inline PM leaf nodes. A bookmark can legally sit
// immediately before visible text, and with start+end plus one wrapper/offset
// boundary the visible fragment may begin up to three PM positions later.
const MAX_BOOKMARK_MARKER_LEAD_DISTANCE = 3;

export function buildPageRefAnchorMap(
  bookmarks: Map<string, number>,
  layout: Layout,
  blocks: FlowBlock[] = [],
  measures: Measure[] = [],
): Map<string, PageRefLocation> {
  const anchors = new Map<string, PageRefLocation>();
  if (bookmarks.size === 0) return anchors;

  const blockById = new Map<string, FlowBlock>();
  const measureById = new Map<string, Measure>();
  for (const block of blocks) {
    blockById.set(block.id, block);
  }
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const measure = measures[index];
    if (block && measure) {
      measureById.set(block.id, measure);
    }
  }

  const orderedBookmarks = [...bookmarks].map(([name, pmPosition]) => ({ name, pmPosition }));
  const sortedBookmarks = orderedBookmarks
    .filter((bookmark) => Number.isFinite(bookmark.pmPosition))
    .sort((left, right) => left.pmPosition - right.pmPosition);
  const resolvedByName = new Map<string, PageRefLocation>();
  const nextUnresolved = Array.from({ length: sortedBookmarks.length + 1 }, (_, index) => index);
  const findNextUnresolved = (index: number): number => {
    let root = index;
    while (nextUnresolved[root] !== root) root = nextUnresolved[root]!;
    while (nextUnresolved[index] !== index) {
      const parent = nextUnresolved[index]!;
      nextUnresolved[index] = root;
      index = parent;
    }
    return root;
  };
  const assignRange = (range: PositionRange | null, page: Page): void => {
    if (!range) return;
    let index = findNextUnresolved(lowerBoundBookmark(sortedBookmarks, range.start));
    while (index < sortedBookmarks.length && sortedBookmarks[index]!.pmPosition < range.end) {
      const bookmark = sortedBookmarks[index]!;
      resolvedByName.set(bookmark.name, pageRefLocationFromPage(page, bookmark.pmPosition));
      nextUnresolved[index] = findNextUnresolved(index + 1);
      index = nextUnresolved[index]!;
    }
  };

  // Containment is resolved in layout order, exactly like the former
  // bookmark-at-a-time scan. The disjoint-set skips bookmarks already claimed
  // by an earlier fragment, making this O(fragments + bookmarks) apart from
  // range lookup rather than O(fragments * bookmarks).
  const fallbackCandidates: FallbackCandidate[] = [];
  let fragmentOrdinal = 0;
  let minimumPriorRangeEnd = Number.POSITIVE_INFINITY;
  for (const page of layout.pages) {
    for (const fragment of page.fragments) {
      const block = blockById.get(fragment.blockId);
      const measure = measureById.get(fragment.blockId);
      assignRange(fragmentPmRange(fragment), page);
      if (fragment.kind === 'para' && block?.kind === 'paragraph') {
        assignRange(runRange(block.runs), page);
      } else if (fragment.kind === 'table' && block?.kind === 'table') {
        for (const range of tableFragmentContainmentRanges(block, fragment, measure)) assignRange(range, page);
      } else if (fragment.kind === 'list-item' && block?.kind === 'list') {
        assignRange(listItemRunRange(block, fragment.itemId), page);
      }

      const fallbackRange = fragmentPositionRange(fragment, block);
      if (fallbackRange) {
        // The legacy scan updated its prior-range flag before considering this
        // fragment as a fallback candidate. For valid ranges this ordering is
        // immaterial; retaining it also preserves malformed-range behavior.
        minimumPriorRangeEnd = Math.min(minimumPriorRangeEnd, fallbackRange.end);
        fallbackCandidates.push({
          start: fallbackRange.start,
          noPriorBefore: minimumPriorRangeEnd,
          ordinal: fragmentOrdinal,
          page,
        });
      }
      fragmentOrdinal += 1;
    }
  }

  resolveFallbackBookmarks(sortedBookmarks, resolvedByName, fallbackCandidates);
  // Preserve the caller's bookmark iteration order even though the batched
  // resolver processes positions in numeric order.
  for (const bookmark of orderedBookmarks) {
    const location = resolvedByName.get(bookmark.name);
    if (location) anchors.set(bookmark.name, location);
  }

  return anchors;
}

type PositionRange = { start: number; end: number };

type FallbackCandidate = {
  start: number;
  /** Minimum visible-range end observed through this fragment in layout order. */
  noPriorBefore: number;
  ordinal: number;
  page: Page;
};

function lowerBoundBookmark(bookmarks: readonly { pmPosition: number }[], target: number): number {
  let low = 0;
  let high = bookmarks.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (bookmarks[middle]!.pmPosition < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function upperBoundCandidate(candidates: readonly FallbackCandidate[], target: number): number {
  let low = 0;
  let high = candidates.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (candidates[middle]!.start <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Resolve marker-leading and pre-document fallbacks without rescanning the layout per bookmark. */
function resolveFallbackBookmarks(
  bookmarks: readonly { name: string; pmPosition: number }[],
  resolvedByName: Map<string, PageRefLocation>,
  candidatesInLayoutOrder: readonly FallbackCandidate[],
): void {
  if (candidatesInLayoutOrder.length === 0) return;
  const candidates = [...candidatesInLayoutOrder].sort(
    (left, right) => left.start - right.start || left.ordinal - right.ordinal,
  );
  const maxNoPriorIndex = buildRangeMaximumIndex(candidates.map((candidate) => candidate.noPriorBefore));
  for (const bookmark of bookmarks) {
    if (resolvedByName.has(bookmark.name)) continue;
    const firstAfter = upperBoundCandidate(candidates, bookmark.pmPosition);
    const nearest = candidates[firstAfter];
    let candidate =
      nearest && nearest.start - bookmark.pmPosition <= MAX_BOOKMARK_MARKER_LEAD_DISTANCE ? nearest : undefined;
    if (!candidate) {
      const farIndex = findFirstRangeMaximumAbove(maxNoPriorIndex, candidates.length, firstAfter, bookmark.pmPosition);
      candidate = farIndex < candidates.length ? candidates[farIndex] : undefined;
    }
    if (candidate) {
      resolvedByName.set(bookmark.name, pageRefLocationFromPage(candidate.page, bookmark.pmPosition));
    }
  }
}

type RangeMaximumIndex = { tree: number[]; leafCount: number };

function buildRangeMaximumIndex(values: readonly number[]): RangeMaximumIndex {
  let leafCount = 1;
  while (leafCount < values.length) leafCount *= 2;
  const tree = new Array<number>(leafCount * 2).fill(Number.NEGATIVE_INFINITY);
  for (let index = 0; index < values.length; index += 1) tree[leafCount + index] = values[index]!;
  for (let index = leafCount - 1; index > 0; index -= 1) {
    tree[index] = Math.max(tree[index * 2]!, tree[index * 2 + 1]!);
  }
  return { tree, leafCount };
}

function findFirstRangeMaximumAbove(
  index: RangeMaximumIndex,
  valueCount: number,
  fromIndex: number,
  threshold: number,
): number {
  const visit = (node: number, left: number, right: number): number => {
    if (right <= fromIndex || left >= valueCount || index.tree[node]! <= threshold) return valueCount;
    if (right - left === 1) return left;
    const middle = (left + right) >>> 1;
    const inLeft = visit(node * 2, left, middle);
    return inLeft < valueCount ? inLeft : visit(node * 2 + 1, middle, right);
  };
  return visit(1, 0, index.leafCount);
}

function pageRefLocationFromPage(page: Page, pmPosition: number): PageRefLocation {
  const displayNumber = Math.max(1, page.displayNumber ?? page.effectivePageNumber ?? page.number);
  return {
    physicalPage: page.number,
    displayNumber,
    displayText: page.numberText ?? String(displayNumber),
    pageFormat: page.pageNumberFormat,
    chapterNumberText: page.pageNumberChapterText,
    chapterSeparator: page.pageNumberChapterSeparator,
    sectionIndex: page.sectionIndex,
    pmPosition,
  };
}

function fragmentPmRange(fragment: Fragment): PositionRange | null {
  const range = fragment as { pmStart?: number; pmEnd?: number };
  return range.pmStart != null && range.pmEnd != null && range.pmStart < range.pmEnd
    ? { start: range.pmStart, end: range.pmEnd }
    : null;
}

function tableFragmentContainmentRanges(
  block: TableBlock,
  fragment: TableFragment,
  measure?: Measure,
): PositionRange[] {
  const ranges: PositionRange[] = [];
  const fromRow = Math.max(0, fragment.fromRow);
  const toRow = Math.min(block.rows.length, fragment.toRow);
  const tableMeasure = measure?.kind === 'table' ? (measure as TableMeasure) : undefined;
  for (let rowIndex = fromRow; rowIndex < toRow; rowIndex += 1) {
    const row = block.rows[rowIndex];
    if (!row) continue;
    const isPartialRow = fragment.partialRow?.rowIndex === rowIndex;
    for (let cellIndex = 0; cellIndex < row.cells.length; cellIndex += 1) {
      const cell = row.cells[cellIndex];
      if (!cell) continue;
      if (isPartialRow && tableMeasure) {
        const cellMeasure = tableMeasure.rows[rowIndex]?.cells[cellIndex];
        const range = cellLineRange(cell, cellMeasure, fragment.partialRow!, cellIndex);
        if (range) ranges.push(range);
        continue;
      }
      const blocks = cell.blocks ?? (cell.paragraph ? [cell.paragraph] : []);
      for (const childBlock of blocks) {
        if (childBlock.kind === 'paragraph') {
          const range = runRange(childBlock.runs);
          if (range) ranges.push(range);
        } else if (childBlock.kind === 'table') {
          collectTableBlockContainmentRanges(childBlock, ranges);
        }
      }
    }
  }
  return ranges;
}

function cellLineRange(
  cell: TableCell,
  cellMeasure: TableCellMeasure | undefined,
  partialRow: NonNullable<TableFragment['partialRow']>,
  cellIndex: number,
): PositionRange | null {
  if (!cellMeasure) return null;

  const totalLines = getCellTotalLines(cellMeasure);
  const rawFromLine = partialRow.fromLineByCell[cellIndex];
  const rawToLine = partialRow.toLineByCell[cellIndex];
  const fromLine = typeof rawFromLine === 'number' && rawFromLine >= 0 ? Math.min(rawFromLine, totalLines) : 0;
  const toLine =
    typeof rawToLine === 'number'
      ? Math.max(0, Math.min(rawToLine === PARTIAL_ROW_RENDERS_TO_CELL_END ? totalLines : rawToLine, totalLines))
      : totalLines;

  return computeCellLineRange(cell, cellMeasure, fromLine, Math.max(fromLine, toLine));
}

function computeCellLineRange(
  cell: TableCell,
  cellMeasure: TableCellMeasure,
  fromLine: number,
  toLine: number,
): { start: number; end: number } | null {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  const blocks = cell.blocks ?? (cell.paragraph ? [cell.paragraph] : []);
  const measures = cellMeasure.blocks ?? (cellMeasure.paragraph ? [cellMeasure.paragraph] : []);
  const blockCount = Math.min(blocks.length, measures.length);

  let lineOffset = 0;
  for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
    const childBlock = blocks[blockIndex];
    const childMeasure = measures[blockIndex];
    const lineCount = getBlockLineCount(childMeasure);
    const blockFromLine = Math.max(fromLine, lineOffset) - lineOffset;
    const blockToLine = Math.min(toLine, lineOffset + lineCount) - lineOffset;

    if (childBlock?.kind === 'paragraph' && childMeasure?.kind === 'paragraph' && blockFromLine < blockToLine) {
      const range = computeFragmentPmRange(
        childBlock,
        (childMeasure as ParagraphMeasure).lines,
        blockFromLine,
        blockToLine,
      );
      if (range.pmStart != null) start = Math.min(start, range.pmStart);
      if (range.pmEnd != null) end = Math.max(end, range.pmEnd);
    }

    lineOffset += lineCount;
  }

  return Number.isFinite(start) && Number.isFinite(end) && start < end ? { start, end } : null;
}

function getCellTotalLines(cellMeasure: TableCellMeasure): number {
  const measures = cellMeasure.blocks ?? (cellMeasure.paragraph ? [cellMeasure.paragraph] : []);
  return measures.reduce((total, measure) => total + getBlockLineCount(measure), 0);
}

function getBlockLineCount(measure: Measure | undefined): number {
  if (!measure) return 0;
  if (measure.kind === 'paragraph') return (measure as ParagraphMeasure).lines.length;
  if (measure.kind === 'table') return (measure as TableMeasure).rows.length;
  return 1;
}

function collectTableBlockContainmentRanges(block: TableBlock, ranges: PositionRange[]): void {
  for (const row of block.rows) {
    for (const cell of row.cells) {
      const blocks = cell.blocks ?? (cell.paragraph ? [cell.paragraph] : []);
      for (const childBlock of blocks) {
        if (childBlock.kind === 'paragraph') {
          const range = runRange(childBlock.runs);
          if (range) ranges.push(range);
        } else if (childBlock.kind === 'table') {
          collectTableBlockContainmentRanges(childBlock, ranges);
        }
      }
    }
  }
}

function fragmentPositionRange(
  fragment: Fragment,
  block: FlowBlock | undefined,
): { start: number; end: number } | null {
  const fullRange = fragment as { pmStart?: number; pmEnd?: number };
  if (fullRange.pmStart != null && fullRange.pmEnd != null) return { start: fullRange.pmStart, end: fullRange.pmEnd };
  if (block?.kind === 'paragraph') return runRange(block.runs);
  if (block?.kind === 'table') return tableRunRange(block);
  if (fragment.kind === 'list-item' && block?.kind === 'list') {
    return listItemRunRange(block, fragment.itemId);
  }
  return null;
}

function listItemRunRange(block: ListBlock, itemId: string): { start: number; end: number } | null {
  const item = block.items.find((candidate) => candidate.id === itemId);
  return item ? runRange(item.paragraph.runs) : null;
}

function tableRunRange(block: TableBlock): { start: number; end: number } | null {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const row of block.rows) {
    for (const cell of row.cells) {
      const blocks = cell.blocks ?? (cell.paragraph ? [cell.paragraph] : []);
      for (const childBlock of blocks) {
        const range =
          childBlock.kind === 'paragraph'
            ? runRange(childBlock.runs)
            : childBlock.kind === 'table'
              ? tableRunRange(childBlock)
              : null;
        if (!range) continue;
        start = Math.min(start, range.start);
        end = Math.max(end, range.end);
      }
    }
  }
  return Number.isFinite(start) && Number.isFinite(end) && start < end ? { start, end } : null;
}

function runRange(runs: Run[]): { start: number; end: number } | null {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const run of runs) {
    const range = run as { pmStart?: number; pmEnd?: number };
    if (range.pmStart != null) start = Math.min(start, range.pmStart);
    if (range.pmEnd != null) end = Math.max(end, range.pmEnd);
  }
  return Number.isFinite(start) && Number.isFinite(end) && start < end ? { start, end } : null;
}
