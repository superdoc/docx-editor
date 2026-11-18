import type { FlowBlock, Measure, ParagraphBlock, ParagraphMeasure } from '@superdoc/contracts';
import type { LayoutWorkCheckpoint } from './execution.js';
import { isOutOfFlowDrawing, shouldSuppressOwnSpacing, shouldSuppressSpacingForEmpty } from './layout-utils.js';
import type { PageState } from './paginator.js';

export const NO_KEEP_NEXT_ANCHOR = -1;

export type KeepNextChain = {
  startIndex: number;
  endIndex: number;
  memberIndices: number[];
  anchorIndex: number;
};

export type PrecedingParagraphState = Pick<
  PageState,
  'trailingSpacing' | 'lastParagraphStyleId' | 'lastParagraphContextualSpacing'
>;

const UNMEASURED_PARAGRAPH_HEIGHT_PX = 20;
const MIN_LINES_PER_SIDE_OF_WIDOW_CONTROLLED_SPLIT = 2;
const SHORTEST_WIDOW_CONTROLLED_SPLITTABLE_LINE_COUNT = MIN_LINES_PER_SIDE_OF_WIDOW_CONTROLLED_SPLIT * 2;

const LEGACY_SPACING_KEY = { before: 'lineSpaceBefore', after: 'lineSpaceAfter' } as const;

function paragraphSpacingPx(block: ParagraphBlock, side: 'before' | 'after'): number {
  const spacing = block.attrs?.spacing;
  const legacyKey = LEGACY_SPACING_KEY[side];
  const legacyValue = typeof spacing === 'object' && spacing !== null ? Reflect.get(spacing, legacyKey) : undefined;
  const value = spacing?.[side] ?? legacyValue;
  if (shouldSuppressSpacingForEmpty(block, side)) return 0;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

export function getParagraphSpacingBefore(block: ParagraphBlock): number {
  return paragraphSpacingPx(block, 'before');
}

export function getParagraphSpacingAfter(block: ParagraphBlock): number {
  return paragraphSpacingPx(block, 'after');
}

export function getMeasureHeight(block: FlowBlock, measure: Measure): number {
  switch (measure.kind) {
    case 'paragraph':
    case 'table':
    case 'list':
      return measure.totalHeight;
    case 'image':
    case 'drawing':
      return measure.height;
    case 'sectionBreak':
    case 'pageBreak':
    case 'columnBreak':
      return 0;
    default: {
      const _unknownMeasure: never = measure;
      return block.kind === 'paragraph' ? UNMEASURED_PARAGRAPH_HEIGHT_PX : 0;
    }
  }
}

export function keptAnchorLineCount(block: ParagraphBlock, measure: ParagraphMeasure): number {
  const lineCount = measure.lines.length;
  if (block.attrs?.keepLines === true) return lineCount;
  if (block.attrs?.widowControl === false) return 1;
  return lineCount < SHORTEST_WIDOW_CONTROLLED_SPLITTABLE_LINE_COUNT
    ? lineCount
    : MIN_LINES_PER_SIDE_OF_WIDOW_CONTROLLED_SPLIT;
}

function isExplicitBreak(block: FlowBlock): boolean {
  return block.kind === 'sectionBreak' || block.kind === 'pageBreak' || block.kind === 'columnBreak';
}

function isKeepNextParagraph(block: FlowBlock): block is ParagraphBlock {
  return block.kind === 'paragraph' && block.attrs?.keepNext === true;
}

export function* computeKeepNextChainSteps(
  blocks: readonly FlowBlock[],
  checkpointEveryBlocks: number | null,
  candidateIndices?: readonly number[],
): Generator<LayoutWorkCheckpoint, Map<number, KeepNextChain>, void> {
  const chains = new Map<number, KeepNextChain>();
  const claimedByEarlierChain = new Set<number>();

  for (const startIndex of candidateIndices ?? Array.from({ length: blocks.length }, (_, index) => index)) {
    if (checkpointEveryBlocks != null && startIndex % checkpointEveryBlocks === 0) {
      yield { index: startIndex, total: blocks.length };
    }
    if (claimedByEarlierChain.has(startIndex)) continue;
    if (!isKeepNextParagraph(blocks[startIndex])) continue;

    const memberIndices: number[] = [startIndex];
    let terminatorIndex: number | undefined;
    for (let j = startIndex + 1; j < blocks.length; j++) {
      if (checkpointEveryBlocks != null && j % checkpointEveryBlocks === 0) {
        yield { index: j, total: blocks.length };
      }
      const next = blocks[j];
      if (isOutOfFlowDrawing(next)) continue;
      if (isKeepNextParagraph(next)) {
        memberIndices.push(j);
        claimedByEarlierChain.add(j);
        continue;
      }
      terminatorIndex = j;
      break;
    }

    const endIndex = memberIndices[memberIndices.length - 1] ?? startIndex;
    const endsAtExplicitBreak = terminatorIndex !== undefined && isExplicitBreak(blocks[terminatorIndex]);
    if (endsAtExplicitBreak && memberIndices.length === 1) continue;
    chains.set(startIndex, {
      startIndex,
      endIndex,
      memberIndices,
      anchorIndex: endsAtExplicitBreak || terminatorIndex === undefined ? NO_KEEP_NEXT_ANCHOR : terminatorIndex,
    });
  }

  return chains;
}

type ParagraphSpacingFacts = {
  before: number;
  after: number;
  styleId: string | undefined;
  contextualSpacing: boolean;
};

const NO_PARAGRAPH_SPACING: ParagraphSpacingFacts = {
  before: 0,
  after: 0,
  styleId: undefined,
  contextualSpacing: false,
};

function paragraphSpacingFacts(block: ParagraphBlock): ParagraphSpacingFacts {
  return {
    before: getParagraphSpacingBefore(block),
    after: getParagraphSpacingAfter(block),
    styleId: typeof block.attrs?.styleId === 'string' ? block.attrs.styleId : undefined,
    contextualSpacing: block.attrs?.contextualSpacing === true,
  };
}

function collapsedSpacingBetween(previous: ParagraphSpacingFacts, next: ParagraphSpacingFacts): number {
  const previousAfter = shouldSuppressOwnSpacing(previous.styleId, previous.contextualSpacing, next.styleId)
    ? 0
    : previous.after;
  const nextBefore = shouldSuppressOwnSpacing(next.styleId, next.contextualSpacing, previous.styleId) ? 0 : next.before;
  return Math.max(previousAfter, nextBefore);
}

function spacingBeforeChainStart(first: ParagraphSpacingFacts, state: PrecedingParagraphState): number {
  const precedingTrailing =
    Number.isFinite(state.trailingSpacing) && state.trailingSpacing > 0 ? state.trailingSpacing : 0;
  const precedingSuppressesAfter = shouldSuppressOwnSpacing(
    state.lastParagraphStyleId,
    state.lastParagraphContextualSpacing,
    first.styleId,
  );
  const firstSuppressesBefore = shouldSuppressOwnSpacing(
    first.styleId,
    first.contextualSpacing,
    state.lastParagraphStyleId,
  );
  if (firstSuppressesBefore) return 0;
  if (precedingSuppressesAfter) return first.before;
  return Math.max(first.before - precedingTrailing, 0);
}

function positiveFiniteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function anchorReservedHeight(
  anchorBlock: FlowBlock,
  anchorMeasure: Measure,
  lastMember: ParagraphSpacingFacts,
): number {
  if (anchorBlock.kind === 'paragraph' && anchorMeasure.kind === 'paragraph') {
    const keptStartHeight = anchorMeasure.lines
      .slice(0, keptAnchorLineCount(anchorBlock, anchorMeasure))
      .reduce((sum, line) => sum + line.lineHeight, 0);
    return (
      collapsedSpacingBetween(lastMember, paragraphSpacingFacts(anchorBlock)) +
      positiveFiniteOr(keptStartHeight, getMeasureHeight(anchorBlock, anchorMeasure))
    );
  }
  if (anchorBlock.kind === 'table' && anchorBlock.anchor?.isAnchored === true) return 0;
  const fullHeight = getMeasureHeight(anchorBlock, anchorMeasure);
  const startHeight =
    anchorBlock.kind === 'table' && anchorMeasure.kind === 'table' && anchorMeasure.rows.length > 0
      ? positiveFiniteOr(anchorMeasure.rows[0]?.height, fullHeight)
      : fullHeight;
  return lastMember.after + startHeight;
}

export function calculateChainHeight(
  chain: KeepNextChain,
  blocks: readonly FlowBlock[],
  measures: readonly Measure[],
  state: PrecedingParagraphState,
): number {
  let totalHeight = 0;
  let previous: ParagraphSpacingFacts | null = null;

  for (const memberIndex of chain.memberIndices) {
    const block = blocks[memberIndex];
    const measure = measures[memberIndex];
    if (!measure) continue;
    const facts = block.kind === 'paragraph' ? paragraphSpacingFacts(block) : NO_PARAGRAPH_SPACING;
    totalHeight += previous ? collapsedSpacingBetween(previous, facts) : spacingBeforeChainStart(facts, state);
    totalHeight += getMeasureHeight(block, measure);
    previous = facts;
  }

  if (chain.anchorIndex === NO_KEEP_NEXT_ANCHOR) return totalHeight;
  const anchorBlock = blocks[chain.anchorIndex];
  const anchorMeasure = measures[chain.anchorIndex];
  if (!anchorBlock || !anchorMeasure) return totalHeight;
  return totalHeight + anchorReservedHeight(anchorBlock, anchorMeasure, previous ?? NO_PARAGRAPH_SPACING);
}
