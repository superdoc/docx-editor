import type { FlowBlock, Line, Run } from '@superdoc/contracts';
import {
  shouldApplyJustify,
  calculateJustifySpacing,
  calculateInterCharacterJustifySpacing,
  sliceRunsForLine,
  SPACE_CHARS,
} from '@superdoc/contracts';

const isTabRun = (run: Run): boolean => run?.kind === 'tab';

/**
 * Shared, canvas-independent justify-adjustment calculation.
 *
 * Single source of truth for the per-line justify slack (word-spacing and
 * inter-character distribution) so painter measurement, caret/hit-test
 * geometry, and the editor-neutral segment-geometry substrate all agree on
 * the same numbers. Depends only on `@superdoc/contracts` line/run data —
 * no Canvas context — so it is safe to call from geometry producers that run
 * without a live DOM.
 */

/**
 * Represents the justify alignment adjustment applied to a line.
 *
 * When text is justified, the layout engine distributes extra space (slack)
 * evenly across all space characters in the line. This type captures both
 * the per-space adjustment amount and the total number of spaces, which are
 * used by text measurement functions to accurately calculate character
 * positions in justified text.
 *
 * @property extraPerSpace - Additional pixels to add after each space character (can be 0 for non-justified text)
 * @property totalSpaces - Total count of space characters in the line (used for validation and debugging)
 */
export type JustifyAdjustment = {
  extraPerSpace: number;
  totalSpaces: number;
  interCharacterSpacing: number;
  interCharacterBoundaries: readonly number[];
};

export type GetJustifyAdjustmentParams = {
  block: FlowBlock;
  line: Line;
  availableWidthOverride?: number;
  alignmentOverride?: string;
  isLastLineOfParagraph?: boolean;
  paragraphEndsWithLineBreak?: boolean;
  skipJustifyOverride?: boolean;
};

/**
 * Counts the number of space characters in a text string.
 *
 * Only counts spaces that participate in CSS word-spacing behavior (regular
 * space and non-breaking space). This is used for justify alignment
 * calculations where extra width needs to be distributed proportionally
 * across spaces.
 *
 * @param text - The text string to analyze
 * @returns The count of space characters (regular space U+0020 and non-breaking space U+00A0)
 *
 * @example
 * ```typescript
 * countSpaces("Hello World");  // Returns: 1
 * countSpaces("A B C");        // Returns: 2
 * countSpaces("No-spaces");    // Returns: 0
 * ```
 */
export const countSpaces = (text: string): number => {
  let spaces = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (SPACE_CHARS.has(text[i])) {
      spaces += 1;
    }
  }
  return spaces;
};

/**
 * Computes the per-space expansion applied when a line is justified.
 *
 * Uses shared justify utilities to ensure consistency with the painter's
 * justify logic, which distributes slack (extra horizontal space) evenly
 * across all space characters using CSS word-spacing.
 *
 * Algorithm:
 * 1. Use shouldApplyJustify() to determine if justify should be applied (including last-line detection)
 * 2. Count all space characters (or use pre-computed line.spaceCount)
 * 3. Use calculateJustifySpacing() to compute per-space adjustment
 * 4. Support negative slack for compressed lines (naturalWidth > availableWidth)
 *
 * Edge Cases:
 * - Non-justify alignment: Returns zero adjustment
 * - Last line of paragraph: Returns zero adjustment (unless paragraph ends with soft break)
 * - No spaces: Returns zero adjustment (prevents division by zero)
 * - Lines with author-defined tab stops: Returns zero adjustment
 * - Compressed lines: Returns negative adjustment (naturalWidth used for slack calculation)
 * - Empty runs array: Returns zero adjustment
 *
 * @param params - Named parameters for justify adjustment.
 * @param params.block - The paragraph block containing the line
 * @param params.line - The line to compute justify adjustment for
 * @param params.availableWidthOverride - The available width for content (fragment width minus paragraph indents).
 *   Must match what the painter uses to ensure consistent justify spacing. If not provided,
 *   falls back to line.maxWidth or line.width.
 * @param params.alignmentOverride - Optional alignment override (defaults to block.attrs.alignment)
 * @param params.isLastLineOfParagraph - Whether this is the last line of the paragraph.
 *   If not provided, auto-derived from block/line: `line.toRun >= block.runs.length - 1`.
 *   Auto-derivation ensures measurement matches rendering. Returns false for empty runs arrays.
 * @param params.paragraphEndsWithLineBreak - Whether the paragraph ends with a soft break (Shift+Enter).
 *   If not provided, auto-derived: `lastRun?.kind === 'lineBreak'`.
 *   Auto-derivation ensures measurement matches rendering. Returns false for empty runs arrays.
 * @param params.skipJustifyOverride - Explicit override to skip justify
 * @returns Object containing extraPerSpace (pixels to add after each space) and totalSpaces
 *
 * @example
 * ```typescript
 * // Line with 200px width in 250px available space, 5 spaces
 * const adj = getJustifyAdjustment({ block, line, availableWidthOverride: 250, isLastLineOfParagraph: false });
 * // Returns: { extraPerSpace: 10, totalSpaces: 5 }  (50px slack / 5 spaces)
 *
 * // Last line of paragraph (no soft break)
 * const adj = getJustifyAdjustment({ block, line, availableWidthOverride: 250, isLastLineOfParagraph: true });
 * // Returns: { extraPerSpace: 0, totalSpaces: 5 }  (last line not justified)
 * ```
 */
export const getJustifyAdjustment = ({
  block,
  line,
  availableWidthOverride,
  alignmentOverride,
  isLastLineOfParagraph,
  paragraphEndsWithLineBreak,
  skipJustifyOverride,
}: GetJustifyAdjustmentParams): JustifyAdjustment => {
  if (block.kind !== 'paragraph') {
    return { extraPerSpace: 0, totalSpaces: 0, interCharacterSpacing: 0, interCharacterBoundaries: [] };
  }

  // Guard against empty runs array
  if (block.runs.length === 0) {
    return { extraPerSpace: 0, totalSpaces: 0, interCharacterSpacing: 0, interCharacterBoundaries: [] };
  }

  const alignment = alignmentOverride ?? block.attrs?.alignment;

  // Derive last-line info from block/line when not explicitly provided.
  // This ensures measurement matches rendering even when callers don't pass these flags.
  const lastRunIndex = block.runs.length - 1;
  const lastRun = block.runs[lastRunIndex];
  const lastRunLength = getRunCharacterLength(lastRun);
  const derivedIsLastLine = line.toRun > lastRunIndex || (line.toRun === lastRunIndex && line.toChar >= lastRunLength);
  const derivedEndsWithLineBreak = lastRun ? lastRun.kind === 'lineBreak' : false;
  // Determine if justify should be applied using shared logic
  const shouldJustify = shouldApplyJustify({
    alignment,
    hasExplicitPositioning: line.segments?.some((seg) => seg.x !== undefined) ?? false,
    hasExplicitTabStops: line.hasExplicitTabStops === true,
    justifyAfterHangingTab: line.justifyAfterHangingTab === true,
    isLastLineOfParagraph: isLastLineOfParagraph ?? derivedIsLastLine,
    paragraphEndsWithLineBreak: paragraphEndsWithLineBreak ?? derivedEndsWithLineBreak,
    skipJustifyOverride,
  });

  if (!shouldJustify) {
    return { extraPerSpace: 0, totalSpaces: 0, interCharacterSpacing: 0, interCharacterBoundaries: [] };
  }

  // Use pre-computed spaceCount if available, otherwise count manually
  let totalSpaces = line.spaceCount ?? 0;
  if (totalSpaces === 0) {
    const runs = sliceRunsForLine(block, line);
    totalSpaces = runs.reduce((sum, run) => {
      if (
        isVanishedRun(run) ||
        isTabRun(run) ||
        'src' in run ||
        run.kind === 'lineBreak' ||
        run.kind === 'break' ||
        run.kind === 'fieldAnnotation' ||
        run.kind === 'math'
      ) {
        return sum;
      }
      return sum + countSpaces(run.text ?? '');
    }, 0);
  }

  // Use the same available width as the painter: override > maxWidth > width
  const availableWidth = availableWidthOverride ?? line.maxWidth ?? line.width;

  // Use naturalWidth if available (for compressed lines), otherwise use width
  const lineWidth = line.naturalWidth ?? line.width;

  // Calculate justify spacing using shared utility
  const extraPerSpace = calculateJustifySpacing({
    lineWidth,
    availableWidth,
    spaceCount: totalSpaces,
    shouldJustify: true, // Already checked above
  });
  const interCharacterBoundaries = totalSpaces === 0 ? (line.justificationPlan?.boundaries ?? []) : [];
  const interCharacterSpacing = calculateInterCharacterJustifySpacing({
    lineWidth,
    availableWidth,
    boundaryCount: interCharacterBoundaries.length,
    shouldJustify: true,
  });

  return {
    extraPerSpace,
    totalSpaces,
    interCharacterSpacing,
    interCharacterBoundaries,
  };
};

function getRunCharacterLength(run: Run | undefined): number {
  if (!run) return 0;
  if (isTabRun(run)) return 1;
  if (
    'src' in run ||
    run.kind === 'lineBreak' ||
    run.kind === 'break' ||
    run.kind === 'fieldAnnotation' ||
    run.kind === 'math'
  ) {
    return 0;
  }
  return run.text?.length ?? 0;
}

function isVanishedRun(run: Run | undefined): boolean {
  return !!run && 'vanish' in run && run.vanish === true;
}
