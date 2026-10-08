import type { Line, ParagraphIndent } from '@superdoc/contracts';
import { adjustAvailableWidthForTextIndent } from '@superdoc/contracts';

export type ParagraphLineIndentationParams = {
  lineEl: HTMLElement;
  line: Line;
  indent?: ParagraphIndent;
  indentLeftPx: number;
  hasListMarkerLayout: boolean;
  lineIndex: number;
  localStartLine: number;
  continuesFromPrev?: boolean;
  suppressFirstLineIndent: boolean;
  resetContinuationTextIndent?: boolean;
  positionedTextGeometry?: boolean;
};

export const hasExplicitSegmentPositioning = (line: Line): boolean =>
  line.segments?.some((segment) => segment.x !== undefined) === true;

export const applyParagraphLineIndentation = (params: ParagraphLineIndentationParams): void => {
  const {
    lineEl,
    line,
    indent,
    indentLeftPx,
    hasListMarkerLayout,
    lineIndex,
    localStartLine,
    continuesFromPrev,
    suppressFirstLineIndent,
    resetContinuationTextIndent,
    positionedTextGeometry,
  } = params;
  const paraIndentLeft = indent?.left ?? 0;
  const paraIndentRight = indent?.right ?? 0;
  const firstLineOffset = suppressFirstLineIndent ? 0 : (indent?.firstLine ?? 0) - (indent?.hanging ?? 0);
  const isFirstLine = lineIndex === 0 && localStartLine === 0 && !continuesFromPrev;
  const explicitSegmentPositioning = hasExplicitSegmentPositioning(line);
  const usesPositionedGeometry = positionedTextGeometry ?? explicitSegmentPositioning;

  if (hasListMarkerLayout && indentLeftPx) {
    if (!usesPositionedGeometry) {
      lineEl.style.paddingLeft = `${indentLeftPx}px`;
    }
  } else if (usesPositionedGeometry) {
    if (isFirstLine && firstLineOffset !== 0) {
      const effectiveLeftIndent = paraIndentLeft < 0 ? 0 : paraIndentLeft;
      const adjustedPadding = effectiveLeftIndent + firstLineOffset;
      if (adjustedPadding > 0) {
        lineEl.style.paddingLeft = `${adjustedPadding}px`;
      }
    }
  } else if (paraIndentLeft && paraIndentLeft > 0) {
    lineEl.style.paddingLeft = `${paraIndentLeft}px`;
  } else if (!isFirstLine && indent?.hanging && indent.hanging > 0 && (paraIndentLeft == null || paraIndentLeft >= 0)) {
    lineEl.style.paddingLeft = `${indent.hanging}px`;
  }

  if (paraIndentRight && paraIndentRight > 0) {
    lineEl.style.paddingRight = `${paraIndentRight}px`;
  }
  if (isFirstLine && firstLineOffset && !usesPositionedGeometry) {
    lineEl.style.textIndent = `${firstLineOffset}px`;
  } else if (firstLineOffset && usesPositionedGeometry) {
    lineEl.style.textIndent = '0px';
  } else if (firstLineOffset && !hasListMarkerLayout && resetContinuationTextIndent) {
    lineEl.style.textIndent = '0px';
  }
};

export const resolveAvailableWidthForLine = (params: {
  containerWidth: number;
  line: Line;
  indentLeftPx: number;
  indentRightPx: number;
  firstLineOffset: number;
  isFirstLine: boolean;
  isListFirstLine: boolean;
  resolvedListTextStartPx?: number;
}): number => {
  const {
    containerWidth,
    line,
    indentLeftPx,
    indentRightPx,
    firstLineOffset,
    isFirstLine,
    isListFirstLine,
    resolvedListTextStartPx,
  } = params;
  const positiveIndentReduction = Math.max(0, indentLeftPx) + Math.max(0, indentRightPx);
  const fallbackAvailableWidth = Math.max(0, containerWidth - positiveIndentReduction);
  let availableWidth = line.maxWidth != null ? Math.min(line.maxWidth, fallbackAvailableWidth) : fallbackAvailableWidth;

  if (resolvedListTextStartPx != null) {
    availableWidth = containerWidth - resolvedListTextStartPx - Math.max(0, indentRightPx);
  }

  if (isFirstLine && !isListFirstLine && (line.hasExplicitTabStops !== true || line.justifyAfterHangingTab === true)) {
    availableWidth = adjustAvailableWidthForTextIndent(availableWidth, firstLineOffset, line.maxWidth);
  }

  return availableWidth;
};
