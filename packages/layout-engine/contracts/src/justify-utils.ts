/**
 * Shared justify alignment utilities.
 *
 * CRITICAL: This module provides the single source of truth for justify decisions.
 * Both the painter (visual rendering) and text measurement (caret positioning) MUST use
 * these functions to ensure consistent behavior and prevent caret drift.
 */

/**
 * Set of characters considered as spaces for justify distribution.
 * Includes both regular space and non-breaking space.
 */
export const SPACE_CHARS = new Set([' ', '\u00A0']);

/**
 * Parameters for determining whether to apply justify to a line.
 */
export type ShouldApplyJustifyParams = {
  /** Paragraph alignment value (must be 'justify' for justify to apply). */
  alignment: string | undefined;
  /** Whether the line has explicit segment positioning. Used as a legacy fallback. */
  hasExplicitPositioning?: boolean;
  /** Whether the line used author-defined OOXML tab stops. */
  hasExplicitTabStops?: boolean;
  /** Whether a single start tab only separates a hanging prefix from the body. */
  justifyAfterHangingTab?: boolean;
  /** Whether this is the last line of the paragraph. */
  isLastLineOfParagraph: boolean;
  /** Whether the paragraph ends with a soft break (Shift+Enter / LineBreak run). */
  paragraphEndsWithLineBreak: boolean;
  /** Explicit override to skip justify (e.g., from rendering context). */
  skipJustifyOverride?: boolean;
};

/**
 * Determines whether justify spacing should be applied to a line.
 *
 * Justify is applied when ALL of the following are true:
 * - Alignment is 'justify'
 * - No explicit skip override
 * - Line has no column-aligned tab stops
 * - Line is NOT the last line, OR paragraph ends with a soft break
 *
 * This matches Microsoft Word's behavior:
 * - All lines are justified except the true last line
 * - Soft breaks (Shift+Enter) do NOT count as "last line"
 * - Explicit column-aligned text is never justified
 * - A single start tab at the hanging indent leaves body text justifiable
 * - Default/manual tab-aligned text can still be justified
 *
 * @param params - Parameters for justify decision
 * @returns true if justify should be applied, false otherwise
 */
export function shouldApplyJustify(params: ShouldApplyJustifyParams): boolean {
  const {
    alignment,
    hasExplicitPositioning,
    hasExplicitTabStops,
    justifyAfterHangingTab,
    isLastLineOfParagraph,
    paragraphEndsWithLineBreak,
    skipJustifyOverride,
  } = params;
  const lineHasExplicitTabStops = hasExplicitTabStops ?? hasExplicitPositioning ?? false;

  // Must be justify alignment
  // Accept both 'justify' (normalized) and 'both' (raw OOXML) for defensive compatibility
  if (alignment !== 'justify' && alignment !== 'both') {
    return false;
  }

  // Explicit override to skip
  if (skipJustifyOverride === true) {
    return false;
  }

  // Column-aligned tab stops fix horizontal positioning; a hanging prefix leaves body text justifiable.
  if (lineHasExplicitTabStops && !justifyAfterHangingTab) {
    return false;
  }

  // Skip justify on the true last line (but NOT if it ends with a soft break)
  if (isLastLineOfParagraph && !paragraphEndsWithLineBreak) {
    return false;
  }

  return true;
}

/**
 * Parameters for calculating justify spacing.
 */
export type CalculateJustifySpacingParams = {
  /** Line width (use naturalWidth ?? width to support compression). */
  lineWidth: number;
  /** Available width for the line. */
  availableWidth: number;
  /** Number of space characters in the line. */
  spaceCount: number;
  /** Whether justify should be applied (from shouldApplyJustify). */
  shouldJustify: boolean;
};

export type CalculateInterCharacterJustifySpacingParams = {
  lineWidth: number;
  availableWidth: number;
  boundaryCount: number;
  shouldJustify: boolean;
};

/**
 * Calculates the extra spacing to apply per space character for justify.
 *
 * Returns the number of pixels to add after each space (via CSS word-spacing).
 * Can be negative for compression (when line is slightly too wide).
 *
 * Returns 0 if:
 * - Justify should not be applied
 * - There are no spaces in the line (division by zero prevention)
 *
 * Formula: (availableWidth - lineWidth) / spaceCount
 *
 * @param params - Parameters for spacing calculation
 * @returns Extra spacing per space in pixels (can be negative)
 */
/**
 * Computes the first-line indent offset from paragraph indent attributes.
 *
 * Returns 0 when first-line indent is suppressed.
 * The result is positive for firstLine indent, negative for hanging indent.
 */
export function getFirstLineIndentOffset(
  indent: { firstLine?: number; hanging?: number } | undefined,
  suppressFirstLineIndent: boolean,
): number {
  if (suppressFirstLineIndent) return 0;
  return (indent?.firstLine ?? 0) - (indent?.hanging ?? 0);
}

/**
 * Adjusts availableWidth for first-line text indent.
 *
 * Negative textIndent (hanging indent): the measurer sets line.maxWidth to the
 * correct wider value, but Math.min with fallbackAvailableWidth clamps it back down.
 * Always adjust to restore actual available space.
 *
 * Positive textIndent (firstLine indent): the measurer already bakes it into
 * line.maxWidth, so only adjust on the fallback path (maxWidth not set).
 */
export function adjustAvailableWidthForTextIndent(
  availableWidth: number,
  textIndentOffset: number,
  lineMaxWidth: number | null | undefined,
): number {
  if (textIndentOffset !== 0 && (textIndentOffset < 0 || lineMaxWidth == null)) {
    return Math.max(0, availableWidth - textIndentOffset);
  }
  return availableWidth;
}

export function calculateJustifySpacing(params: CalculateJustifySpacingParams): number {
  const { lineWidth, availableWidth, spaceCount, shouldJustify } = params;

  // Don't justify if conditions aren't met
  if (!shouldJustify) {
    return 0;
  }

  // Can't distribute across zero spaces
  if (spaceCount <= 0) {
    return 0;
  }

  // Calculate slack (can be negative for compression)
  const slack = availableWidth - lineWidth;

  // Distribute slack evenly across all spaces
  return slack / spaceCount;
}

export function calculateInterCharacterJustifySpacing(params: CalculateInterCharacterJustifySpacingParams): number {
  const { lineWidth, availableWidth, boundaryCount, shouldJustify } = params;
  if (!shouldJustify || boundaryCount <= 0 || availableWidth <= lineWidth) return 0;
  return (availableWidth - lineWidth) / boundaryCount;
}

export function interCharacterJustifyAdvanceBeforeOffset(
  boundaries: readonly number[],
  offset: number,
  spacing: number,
): number {
  if (spacing === 0 || boundaries.length === 0) return 0;
  let count = 0;
  while (count < boundaries.length && boundaries[count]! <= offset) count += 1;
  return count * spacing;
}
