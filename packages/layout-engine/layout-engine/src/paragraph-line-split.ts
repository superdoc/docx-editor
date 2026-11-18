import { isSectPrMarkerParagraph, remeasuredLines, setRecordedColumnIndex } from './balancing-fragment.js';
import type { BalancingFragment, BlockBreakPoint, MeasureData } from './column-balancing.js';

export const MAX_ATOMIC_PARAGRAPH_LINES = 1;

export type ParagraphLineSplitSources = {
  measureMap: Map<string, MeasureData>;
  sectPrMarkerBlockIds?: Set<string>;
  keepLinesBlockIds?: Set<string>;
};

export type NextColumnPlacement = {
  columnIndex: number;
  x: number;
  y: number;
  width: number;
};

export function splittableLineHeights(
  fragment: BalancingFragment,
  sources: ParagraphLineSplitSources,
): number[] | undefined {
  if (fragment.kind !== 'para') return undefined;
  if (isSectPrMarkerParagraph(fragment, sources.sectPrMarkerBlockIds)) return undefined;
  if (sources.keepLinesBlockIds?.has(fragment.blockId)) return undefined;
  const lines = remeasuredLines(fragment);
  if (lines) {
    if (lines.length <= MAX_ATOMIC_PARAGRAPH_LINES) return undefined;
    return lines.map((line) => line.lineHeight);
  }
  const measure = sources.measureMap.get(fragment.blockId);
  if (!measure || measure.kind !== 'paragraph' || !Array.isArray(measure.lines)) return undefined;
  const fromLine = fragment.fromLine ?? 0;
  const toLine = fragment.toLine ?? measure.lines.length;
  if (toLine - fromLine <= MAX_ATOMIC_PARAGRAPH_LINES) return undefined;
  return measure.lines.slice(fromLine, toLine).map((line) => line.lineHeight);
}

export function breaksIntoNextColumn(
  breakPoint: BlockBreakPoint | undefined,
  columnIndex: number,
  columnCount: number,
): breakPoint is BlockBreakPoint {
  if (!breakPoint) return false;
  return breakPoint.heightAfterBreak > 0 && columnIndex < columnCount - 1;
}

export function splitParagraphIntoNextColumn(args: {
  fragment: BalancingFragment;
  fragments: BalancingFragment[];
  breakAfterLine: number;
  measureMap: Map<string, MeasureData>;
  next: NextColumnPlacement;
}): BalancingFragment {
  const { fragment, fragments, breakAfterLine, measureMap, next } = args;
  const linesBeforeBreak = breakAfterLine + 1;
  const splitLine = (fragment.fromLine ?? 0) + linesBeforeBreak;
  const measureLineCount = measureMap.get(fragment.blockId)?.lines?.length ?? splitLine;
  const originalToLine = fragment.toLine ?? measureLineCount;
  const originalContinuesOnNext = ('continuesOnNext' in fragment ? fragment.continuesOnNext : undefined) ?? false;
  const secondHalf = {
    ...fragment,
    fromLine: splitLine,
    toLine: originalToLine,
    x: next.x,
    y: next.y,
    width: next.width,
    continuesFromPrev: true,
    continuesOnNext: originalContinuesOnNext,
  };
  setRecordedColumnIndex(secondHalf, next.columnIndex);
  const lines = remeasuredLines(fragment);
  if (lines) {
    secondHalf.lines = lines.slice(linesBeforeBreak);
    fragment.lines = lines.slice(0, linesBeforeBreak);
  }
  Object.assign(fragment, { toLine: splitLine, continuesOnNext: true });
  const index = fragments.indexOf(fragment);
  if (index >= 0) fragments.splice(index + 1, 0, secondHalf);
  return secondHalf;
}
