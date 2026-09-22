import type { FlowBlock, Measure, ParagraphBlock, Run, TableBlock, TableMeasure, TableWrap } from '@superdoc/contracts';
import { OOXML_PCT_DIVISOR, resolveTableWidthAttr } from '@superdoc/contracts';
import { shouldSkipParagraphDuringLayout } from './paragraph-layout-eligibility.js';
import type { LayoutWorkCheckpoint } from './execution.js';

export type FloatingTableAnchorResolution = {
  paragraphIndex: number;
  offsetV: number;
  /**
   * True when w:tblpY applies directly on the anchor paragraph's first line (Word line-scoped).
   * Tall wrap-none form fields vertically center on that line.
   */
  lineScopedOnAnchor?: boolean;
};

/** Width ratio for inline (paginated) layout vs single float fragment. */
export const ANCHORED_TABLE_FULL_WIDTH_RATIO = 0.99;

/**
 * Word pins page-relative floating tables to the physical page instead of
 * allowing a negative tblpY to clip the table above the page canvas.
 */
export function clampPageRelativeFloatingTableY(block: TableBlock, y: number): number {
  return block.anchor?.vRelativeFrom === 'page' ? Math.max(0, y) : y;
}

/**
 * Floating tables in FlowBlock order do not carry Word's anchor-paragraph pointer.
 * When {@link TableBlock.attrs.anchorParagraphId} is set at import time, that wins.
 * Otherwise a paragraph-relative table anchors to the next regular paragraph. Negative
 * text-relative offsets (vertAnchor="text" with negative tblpY) use the preceding
 * paragraph's text bottom as their vertical reference.
 */

function runText(run: Run): string {
  if (run.kind != null && run.kind !== 'text') return '';
  return 'text' in run && typeof run.text === 'string' ? run.text : '';
}

function paragraphText(block: ParagraphBlock): string {
  return block.runs?.map(runText).join('') ?? '';
}

function isTextEmptyParagraph(blocks: FlowBlock[], index: number): boolean {
  const block = blocks[index];
  if (block.kind !== 'paragraph') return false;
  return paragraphText(block).trim().length === 0;
}

function isRegularAnchorParagraph(blocks: FlowBlock[], index: number): boolean {
  const block = blocks[index];
  return block?.kind === 'paragraph' && !shouldSkipParagraphDuringLayout(blocks, index);
}

function* findPreviousParagraphIndexSteps(
  blocks: FlowBlock[],
  fromIndex: number,
  checkpointEveryBlocks: number | null,
): Generator<LayoutWorkCheckpoint, number | null, void> {
  for (let i = fromIndex - 1; i >= 0; i -= 1) {
    if (checkpointEveryBlocks != null && i % checkpointEveryBlocks === 0) {
      yield { index: i, total: blocks.length };
    }
    if (isRegularAnchorParagraph(blocks, i)) return i;
  }
  return null;
}

function* findNextParagraphIndexSteps(
  blocks: FlowBlock[],
  fromIndex: number,
  len: number,
  checkpointEveryBlocks: number | null,
): Generator<LayoutWorkCheckpoint, number | null, void> {
  for (let i = fromIndex + 1; i < len; i += 1) {
    if (checkpointEveryBlocks != null && i % checkpointEveryBlocks === 0) {
      yield { index: i, total: len };
    }
    if (isRegularAnchorParagraph(blocks, i)) return i;
  }
  return null;
}

function* findNearestParagraphIndexSteps(
  blocks: FlowBlock[],
  len: number,
  fromIndex: number,
  checkpointEveryBlocks: number | null,
): Generator<LayoutWorkCheckpoint, number | null, void> {
  const previous = yield* findPreviousParagraphIndexSteps(blocks, fromIndex, checkpointEveryBlocks);
  return previous ?? (yield* findNextParagraphIndexSteps(blocks, fromIndex, len, checkpointEveryBlocks));
}

/** True when offsetV is line-scoped (w:tblpY in the first-line range). */
function isLineScopedTblpY(measures: Measure[], paragraphIndex: number, offsetV: number): boolean {
  const measure = measures[paragraphIndex];
  if (measure?.kind !== 'paragraph') return false;
  const firstLineHeight = measure.lines?.[0]?.lineHeight || measure.totalHeight || 0;
  if (firstLineHeight <= 0) return offsetV <= 1;
  return offsetV <= firstLineHeight * 1.5;
}

function resolutionForParagraph(
  blocks: FlowBlock[],
  measures: Measure[],
  paragraphIndex: number,
  offsetV: number,
  tableBlock: TableBlock,
): FloatingTableAnchorResolution {
  return {
    paragraphIndex,
    offsetV,
    lineScopedOnAnchor:
      (tableBlock.wrap?.type ?? 'None') === 'None' &&
      offsetV >= 0 &&
      isLineScopedTblpY(measures, paragraphIndex, offsetV) &&
      !isTextEmptyParagraph(blocks, paragraphIndex),
  };
}

function getTableIndentPx(attrs: TableBlock['attrs']): number {
  const tableIndent = attrs?.tableIndent as { width?: unknown } | undefined;
  return typeof tableIndent?.width === 'number' && Number.isFinite(tableIndent.width) ? tableIndent.width : 0;
}

function horizontalWrapMargin(wrap?: TableWrap): number {
  if (wrap?.type === 'None') return 0;
  return (wrap?.distLeft ?? 0) + (wrap?.distRight ?? 0);
}

/** Sub-pixel slack from column-width rescaling during measure. */
function measureRoundingSlack(columnCount: number): number {
  return Math.max(1, columnCount) * 0.5;
}

/**
 * True when an anchored table should paginate inline instead of as one float fragment.
 * Uses tbl width, flow-affecting wrap distances from w:tblpPr, and table indent — not a fixed px fudge factor.
 */
export function isAnchoredTableFullWidth(
  block: TableBlock,
  measure: TableMeasure,
  columnWidth: number,
  pageHeight?: number,
): boolean {
  if (columnWidth <= 0) return false;
  if (block.anchor?.vRelativeFrom === 'page' && block.anchor.alignV && block.anchor.alignV !== 'inline') {
    if (pageHeight != null && measure.totalHeight != null && measure.totalHeight > pageHeight) {
      return true;
    }
    return false;
  }

  const totalWidth = measure.totalWidth ?? 0;
  const indent = getTableIndentPx(block.attrs);
  const effectiveWidth = totalWidth + horizontalWrapMargin(block.wrap) + Math.max(0, -indent);
  const slack = measureRoundingSlack(measure.columnWidths?.length ?? 1);

  const tblWidth = resolveTableWidthAttr(block.attrs?.tableWidth);
  if (tblWidth?.type === 'pct' && tblWidth.width >= OOXML_PCT_DIVISOR * ANCHORED_TABLE_FULL_WIDTH_RATIO) {
    return true;
  }

  return effectiveWidth + slack >= columnWidth * ANCHORED_TABLE_FULL_WIDTH_RATIO;
}

/**
 * Resolve anchor paragraph + vertical offset for a block-level floating table.
 */
export function* resolveFloatingTableAnchorResolutionSteps(
  blocks: FlowBlock[],
  measures: Measure[],
  len: number,
  tableIndex: number,
  tableBlock: TableBlock,
  paragraphIndexById: Map<string, number>,
  checkpointEveryBlocks: number | null = null,
): Generator<LayoutWorkCheckpoint, FloatingTableAnchorResolution | null, void> {
  const offsetV = tableBlock.anchor?.offsetV ?? 0;
  const anchorParagraphId =
    typeof tableBlock.attrs === 'object' && tableBlock.attrs
      ? (tableBlock.attrs as { anchorParagraphId?: unknown }).anchorParagraphId
      : undefined;
  if (typeof anchorParagraphId === 'string') {
    const explicitIndex = paragraphIndexById.get(anchorParagraphId);
    if (typeof explicitIndex === 'number') {
      const eligibleIndex = isRegularAnchorParagraph(blocks, explicitIndex)
        ? explicitIndex
        : yield* findNextParagraphIndexSteps(blocks, explicitIndex, len, checkpointEveryBlocks);
      if (eligibleIndex != null) {
        if ((tableBlock.anchor?.vRelativeFrom ?? 'paragraph') !== 'paragraph') {
          return { paragraphIndex: eligibleIndex, offsetV, lineScopedOnAnchor: false };
        }
        return resolutionForParagraph(blocks, measures, eligibleIndex, offsetV, tableBlock);
      }
    }
  }

  const vRelativeFrom = tableBlock.anchor?.vRelativeFrom ?? 'paragraph';
  if (vRelativeFrom !== 'paragraph') {
    const fallback = yield* findNearestParagraphIndexSteps(blocks, len, tableIndex, checkpointEveryBlocks);
    return fallback == null ? null : { paragraphIndex: fallback, offsetV, lineScopedOnAnchor: false };
  }

  const usesPrecedingTextBottom = tableBlock.anchor?.offsetV != null && tableBlock.anchor.offsetV < 0;
  if (usesPrecedingTextBottom) {
    const previousParagraphIndex = yield* findPreviousParagraphIndexSteps(blocks, tableIndex, checkpointEveryBlocks);
    if (previousParagraphIndex != null) {
      const previousMeasure = measures[previousParagraphIndex];
      const textBottomOffset = previousMeasure?.kind === 'paragraph' ? previousMeasure.totalHeight : 0;
      return {
        paragraphIndex: previousParagraphIndex,
        offsetV: offsetV + textBottomOffset,
        lineScopedOnAnchor: false,
      };
    }
  }

  const paragraphIndex =
    (yield* findNextParagraphIndexSteps(blocks, tableIndex, len, checkpointEveryBlocks)) ??
    (yield* findPreviousParagraphIndexSteps(blocks, tableIndex, checkpointEveryBlocks));
  if (paragraphIndex == null) return null;

  return resolutionForParagraph(blocks, measures, paragraphIndex, offsetV, tableBlock);
}

export function resolveFloatingTableAnchorResolution(
  blocks: FlowBlock[],
  measures: Measure[],
  len: number,
  tableIndex: number,
  tableBlock: TableBlock,
  paragraphIndexById: Map<string, number>,
): FloatingTableAnchorResolution | null {
  const steps = resolveFloatingTableAnchorResolutionSteps(
    blocks,
    measures,
    len,
    tableIndex,
    tableBlock,
    paragraphIndexById,
  );
  while (true) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}
