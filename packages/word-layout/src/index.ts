/**
 * Canonical Word layout contracts shared between SuperDoc packages.
 *
 * Track A focuses on defining data interfaces and pure helpers.
 */

import type { WordParagraphLayoutInput, WordParagraphLayoutOutput, WordListSuffix } from './types.js';
import { DEFAULT_LIST_HANGING_PX, LIST_MARKER_GAP } from './marker-utils.js';
import { twipsToPixels } from './unit-conversions.js';

export * from './types.js';

export {
  TWIPS_PER_PIXEL,
  PIXELS_PER_TWIP,
  TWIPS_PER_POINT,
  POINTS_PER_TWIP,
  pixelsToTwips,
  twipsToPixels,
  pointsToTwips,
  twipsToPoints,
  halfPointsToPoints,
  pointsToHalfPoints,
} from './unit-conversions.js';

export { LIST_MARKER_GAP, DEFAULT_LIST_HANGING_PX } from './marker-utils.js';
export type { NumberingFormat } from './marker-utils.js';
export { createNumberingManager } from './numbering-manager.js';
export type { NumberingManager, NumberingManagerSnapshot, NumberingCursor } from './numbering-manager.js';
export { computeWordListMarker } from './list-marker.js';
export { isCountedNumberFormat } from '@superdoc/common/list-numbering';
export type {
  ComputeWordListMarkerInput,
  ComputeWordListMarkerResult,
  WordListMarkerDefinition,
} from './list-marker.js';
export {
  createReviewAwareWordNumberingSequence,
  reviewAwareWordNumberingCounterScope,
} from './review-aware-numbering.js';
export type {
  ReviewAwareNumberingMembership,
  ReviewAwareNumberingStateMode,
  ReviewAwareWordMarkerFact,
  ReviewAwareWordNumberingDefinition,
  ReviewAwareWordNumberingResult,
  ReviewAwareWordNumberingSequence,
  ReviewAwareWordNumberingSnapshot,
} from './review-aware-numbering.js';

/**
 * Computes the complete layout properties for a Word paragraph, including indentation,
 * tabs, and optional list marker positioning.
 *
 * This is the main entry point for Word paragraph layout calculation. It processes
 * paragraph properties, document defaults, and optional numbering to produce a complete
 * layout specification that can be used for rendering.
 *
 * @param input - The paragraph layout input containing paragraph properties, document defaults,
 *   optional numbering information, and an optional measurement adapter for calculating text widths.
 *
 * @returns A complete layout specification including:
 *   - `indentLeftPx`: Left indent in pixels
 *   - `hangingPx`: Hanging indent in pixels (clamped to >= 0)
 *   - `firstLinePx`: First line indent in pixels (if specified)
 *   - `tabsPx`: Array of tab stop positions in pixels
 *   - `textStartPx`: Horizontal position where paragraph text begins
 *   - `marker`: Optional list marker layout (position, text, styling)
 *   - `resolvedIndent`: Merged indent configuration
 *   - `resolvedTabs`: Resolved tab stops
 *   - `defaultTabIntervalPx`: Default tab interval in pixels
 *   - `firstLineIndentMode`: Boolean flag indicating firstLine indent pattern detection.
 *     When true, this indicates the paragraph uses OOXML's alternative list indent pattern
 *     where the marker is positioned at `left + firstLine` instead of the standard
 *     `left - hanging` pattern. This flag is set when `firstLine > 0` and `hanging` is
 *     not defined. It affects marker positioning and tab spacing calculations in the renderer.
 *
 * @example
 * ```typescript
 * // Standard hanging indent pattern
 * const layout1 = computeWordParagraphLayout({
 *   paragraph: {
 *     indent: { left: 720, hanging: 720 },
 *     tabs: [],
 *     numberingProperties: { numId: '1', ilvl: 0, format: 'decimal', lvlText: '%1.', path: [1] }
 *   },
 *   docDefaults: { run: { fontFamily: 'Calibri', fontSize: 12 } }
 * });
 * // layout1.firstLineIndentMode is undefined (standard pattern)
 * // Marker positioned at: left (720) - hanging (720) = 0
 *
 * // FirstLine indent pattern (alternative OOXML style)
 * const layout2 = computeWordParagraphLayout({
 *   paragraph: {
 *     indent: { left: 0, firstLine: 720 },
 *     tabs: [],
 *     numberingProperties: { numId: '1', ilvl: 0, format: 'decimal', lvlText: '%1.', path: [1] }
 *   },
 *   docDefaults: { run: { fontFamily: 'Calibri', fontSize: 12 } }
 * });
 * // layout2.firstLineIndentMode is true
 * // Marker positioned at: left (0) + firstLine (720) = 720
 * ```
 */
export function computeWordParagraphLayout(input: WordParagraphLayoutInput): WordParagraphLayoutOutput {
  const { paragraph, markerRun, listRenderingAttrs } = input;

  const layout: WordParagraphLayoutOutput = {
    indentLeftPx: paragraph.indent?.left ?? 0,
    hangingPx: paragraph.indent?.hanging ?? 0,
    firstLinePx: paragraph.indent?.firstLine,
    tabsPx:
      paragraph.tabs
        ?.filter((tab) => tab.val !== 'clear' && tab.val !== 'bar')
        .map((tab) => twipsToPixels(tab.pos))
        .sort((a, b) => a - b) ?? [],
    textStartPx: paragraph.indent?.left ?? 0,
    marker: undefined,
    defaultTabIntervalPx: paragraph.tabIntervalTwips,
  };

  // Detect "firstLine indent" pattern: OOXML allows lists to use firstLine instead of hanging.
  // Standard: left=720, hanging=720 (marker hangs back to position 0)
  // Alternative: left=0, firstLine=720 (marker at position 720, text follows)
  // Per OOXML spec, firstLine and hanging are mutually exclusive.
  // Validate that firstLine is a finite number to handle NaN, Infinity, and -Infinity gracefully.
  const hasFirstLineIndent =
    paragraph.indent?.firstLine != null &&
    Number.isFinite(paragraph.indent.firstLine) &&
    paragraph.indent.firstLine > 0 &&
    !paragraph.indent.hanging;

  let markerBoxWidthPx: number;
  let markerX: number;
  if (hasFirstLineIndent) {
    // FirstLine pattern: marker at (left + firstLine), text follows inline
    markerBoxWidthPx = DEFAULT_LIST_HANGING_PX;
    markerX = layout.indentLeftPx + (layout.firstLinePx ?? 0);
    layout.textStartPx = markerX + markerBoxWidthPx;
    layout.hangingPx = 0;
    layout.firstLineIndentMode = true;
  } else {
    if (layout.hangingPx === 0) {
      markerBoxWidthPx = DEFAULT_LIST_HANGING_PX;
    } else {
      markerBoxWidthPx = layout.hangingPx;
    }
    markerX = layout.indentLeftPx - markerBoxWidthPx;
    layout.hangingPx = markerBoxWidthPx;
  }

  layout.marker = {
    markerText: listRenderingAttrs.markerText,
    markerBoxWidthPx,
    markerX,
    textStartX: layout.textStartPx,
    gutterWidthPx: LIST_MARKER_GAP,
    justification: listRenderingAttrs.justification ?? 'left',
    suffix: normalizeSuffix(listRenderingAttrs.suffix),
    run: markerRun,
  };

  return layout;
}

const normalizeSuffix = (suffix?: string | null): WordListSuffix => {
  if (suffix === 'tab' || suffix === 'space' || suffix === 'nothing') {
    return suffix;
  }
  return 'tab';
};
