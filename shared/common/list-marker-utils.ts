/**
 * Shared utilities for list marker positioning and text start calculation.
 *
 * This module provides a unified implementation of list marker text positioning logic
 * that is used consistently across the measuring and layout subsystems. The core
 * function `resolveListTextStartPx` determines where paragraph text begins after
 * accounting for list markers, tabs, and various justification modes.
 *
 * This module is extracted to ensure consistency across:
 * - remeasure.ts (fast canvas-based remeasurement)
 * - list-indent-utils.ts (layout bridge utilities)
 * - measuring/dom/src/index.ts (full typography measurement)
 */

import { LIST_MARKER_GAP, SPACE_SUFFIX_GAP_PX, DEFAULT_TAB_INTERVAL_PX } from './layout-constants.js';

/**
 * Minimal marker run formatting information for text measurement.
 */
export type MinimalMarkerRun = {
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  letterSpacing?: number;
  vanish?: boolean;
  // SD-2656: caps mark on the level rPr ( w:caps ). When true the marker
  // text is rendered with CSS text-transform: uppercase, matching Word's
  // legal/contract list styles ("FIRST:", "SECOND:", "THIRD:").
  allCaps?: boolean;
  smallCaps?: boolean;
};

/**
 * Tracked-change review metadata for a list marker glyph (Plan 5).
 *
 * Structurally mirrors the canonical `MarkerTrackedChange` in
 * `@superdoc/contracts` (which reuses `TrackedChangeMeta`). It is re-declared
 * here so `@superdoc/common` stays dependency-free; the painter accepts both
 * shapes through one permissive view. Keep the two declarations in sync.
 */
export type MinimalMarkerTrackedChange = {
  /** Primary tracked-change id, stamped as `data-track-change-id`. */
  id: string;
  /** Review kind driving base class + marker color/decoration. */
  kind: 'insert' | 'delete' | 'format';
  /** All affected ids for `data-track-change-ids`, when more than one. */
  groupedIds?: readonly string[];
  /** Raw structural change type (e.g. `paragraph-mark`, `list-properties`). */
  type?: string;
  /** Logical structural subtype. */
  subtype?: string;
  /** Structural target kind (e.g. `list-item`). */
  targetKind?: string;
  /** Semantic color category (e.g. `insertion`, `move-from`). */
  semanticColorKey?: string;
  /** Paint-ready semantic color. */
  semanticColor?: string;
  /** Per-author color. */
  color?: string;
  author?: string;
  authorEmail?: string;
  date?: string;
  storyKey?: string;
};

/**
 * Minimal marker information required for text start calculation.
 *
 * This type represents the essential properties needed from a marker object
 * to calculate where text should start after the marker. It's designed to be
 * compatible with various marker representations across different subsystems.
 */
export type MinimalMarker = {
  /** Pre-measured width of the entire marker box in pixels */
  markerBoxWidthPx?: number;
  /** Pre-measured width of the marker glyph/text in pixels */
  glyphWidthPx?: number;
  /** Horizontal position where marker is drawn (used in firstLineIndentMode) */
  markerX?: number;
  /** Horizontal position where text should start (used in firstLineIndentMode) */
  textStartX?: number;
  /** Width of the gutter between marker and text (used for center/right justification) */
  gutterWidthPx?: number;
  /** Marker justification: 'left', 'center', or 'right' */
  justification?: 'left' | 'center' | 'right';
  /** What follows the marker: 'tab', 'space', or 'nothing' */
  suffix?: 'tab' | 'space' | 'nothing';
  /** The text content of the marker (for measurement if glyphWidthPx not available) */
  markerText?: string;
  /** Formatting information for the marker (for measurement if needed) */
  run?: MinimalMarkerRun;
  /**
   * Optional tracked-change review metadata for the marker glyph (Plan 5).
   * Carried through the `wordLayout.marker` legacy paint path so the painter
   * can stamp marker review identity/styling. Absent for normal markers.
   */
  trackedChange?: MinimalMarkerTrackedChange;
};

/**
 * Minimal word layout configuration for text start calculation.
 *
 * Contains the subset of word layout properties needed to determine text positioning.
 */
export type MinimalWordLayout = {
  textStartMode?: 'paragraph';
  firstLinePx?: number;
  hangingPx?: number;
  /** Whether this list uses first-line indent mode (input-rule created lists) */
  firstLineIndentMode?: boolean;
  /** Pre-calculated horizontal position where text should start */
  textStartPx?: number;
  /** Left indent in pixels from word-layout marker positioning */
  indentLeftPx?: number;
  /** Array of tab stop positions in pixels (for firstLineIndentMode) */
  tabsPx?: number[];
  /** Marker information */
  marker?: MinimalMarker;
};

/**
 * Function type for measuring marker text width.
 *
 * Different subsystems use different text measurement approaches:
 * - remeasure.ts: Canvas-based measurement with getCtx()
 * - measuring/dom: Canvas-based measurement with cached context
 * - list-indent-utils: May not have access to canvas, provides markerWidth parameter
 */
export type MarkerTextMeasurer = (markerText: string, marker: MinimalMarker) => number;

/**
 * Resolved list prefix geometry for a single numbered or bulleted paragraph line.
 *
 * All coordinates are measured from the left edge of the paragraph content area.
 */
export type ResolvedListMarkerGeometry = {
  /** Left edge where the visible marker glyph should be painted. */
  markerStartPx: number;
  /** Visible marker glyph width in pixels. */
  markerTextWidthPx: number;
  /** Horizontal position where paragraph text begins after marker + suffix. */
  textStartPx: number;
  /** Width contributed by the suffix separator (tab, space, or nothing). */
  suffixWidthPx: number;
};

const getFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
};

const getNonNegativeFiniteNumber = (value: unknown): number | undefined => {
  const numericValue = getFiniteNumber(value);
  if (numericValue == null || numericValue < 0) {
    return undefined;
  }
  return numericValue;
};

const getMarkerTextWidthPx = (marker: MinimalMarker, measureMarkerText: MarkerTextMeasurer): number => {
  const glyphWidthPx = getNonNegativeFiniteNumber(marker.glyphWidthPx);
  if (glyphWidthPx != null) {
    return glyphWidthPx;
  }

  if (marker.markerText) {
    const measuredWidthPx = measureMarkerText(marker.markerText, marker);
    const safeMeasuredWidthPx = getNonNegativeFiniteNumber(measuredWidthPx);
    if (safeMeasuredWidthPx != null) {
      return safeMeasuredWidthPx;
    }
  }

  return getNonNegativeFiniteNumber(marker.markerBoxWidthPx) ?? 0;
};

const getMarkerBoxWidthPx = (marker: MinimalMarker, markerTextWidthPx: number): number =>
  Math.max(getNonNegativeFiniteNumber(marker.markerBoxWidthPx) ?? 0, markerTextWidthPx);

const getExplicitFirstLineMarkerStartPx = (
  wordLayout: MinimalWordLayout | undefined,
  marker: MinimalMarker,
): number | undefined => {
  if (wordLayout?.firstLineIndentMode !== true) {
    return undefined;
  }

  return getFiniteNumber(marker.markerX);
};

const getMarkerAnchorPx = (indentLeft: number, firstLine: number, hanging: number): number =>
  indentLeft - hanging + firstLine;

const getMarkerStartPx = (anchorPx: number, justification: string, markerTextWidthPx: number): number => {
  if (justification === 'right') {
    return anchorPx - markerTextWidthPx;
  }
  if (justification === 'center') {
    return anchorPx - markerTextWidthPx / 2;
  }
  return anchorPx;
};

const getNextDefaultTabStopPx = (currentPosPx: number, originPx = 0): number => {
  const remainderPx = (currentPosPx - originPx) % DEFAULT_TAB_INTERVAL_PX;
  if (remainderPx === 0) {
    return currentPosPx + DEFAULT_TAB_INTERVAL_PX;
  }
  return currentPosPx + DEFAULT_TAB_INTERVAL_PX - remainderPx;
};

const getMinimumReadableTextStartPx = (markerContentEndPx: number, gutterWidthPx: number): number =>
  markerContentEndPx + gutterWidthPx;

const resolveExplicitStandardTextStartPx = (
  explicitTextStartPx: number | undefined,
  markerContentEndPx: number,
  gutterWidthPx: number,
  originPx = 0,
): number | undefined => {
  if (explicitTextStartPx == null) {
    return undefined;
  }

  if (explicitTextStartPx > markerContentEndPx) {
    return explicitTextStartPx;
  }

  if (explicitTextStartPx > 0) {
    // Marker overflows the hanging-indent text-start (e.g. "mm)" wider than
    // its level's hanging in a multi-letter alphabetic list). Word's
    // behavior: the suffix tab advances to the next default tab stop (every
    // 0.5"), NOT to a fixed small gutter. The minimum-readable gutter remains
    // as a safety floor when marker happens to land right on a tab stop.
    const nextTabStopPx = getNextDefaultTabStopPx(markerContentEndPx, originPx);
    const minReadablePx = getMinimumReadableTextStartPx(markerContentEndPx, gutterWidthPx);
    return Math.max(nextTabStopPx, minReadablePx);
  }

  return undefined;
};

const resolveExplicitStandardSuffixTabPx = (
  tabsPx: readonly number[] | undefined,
  markerContentEndPx: number,
  explicitTextStartPx: number | undefined,
  originPx = 0,
): number | undefined => {
  if (explicitTextStartPx == null) {
    return undefined;
  }

  const explicitTabsAfterMarker = tabsPx
    ?.filter((tabStopPx) => {
      return Number.isFinite(tabStopPx) && tabStopPx > markerContentEndPx;
    })
    .sort((a, b) => a - b);

  if (!explicitTabsAfterMarker?.length) {
    return undefined;
  }

  if (explicitTextStartPx > markerContentEndPx) {
    return explicitTabsAfterMarker.find((tabStopPx) => tabStopPx < explicitTextStartPx);
  }

  if (explicitTextStartPx > 0) {
    const nextDefaultTabStopPx = getNextDefaultTabStopPx(markerContentEndPx, originPx);
    return explicitTabsAfterMarker.find((tabStopPx) => tabStopPx < nextDefaultTabStopPx);
  }

  return undefined;
};

/**
 * Resolves full marker geometry for a list prefix on a paragraph line.
 *
 * This is the canonical geometry source for marker start, suffix width, and
 * paragraph text start. Measurement and painting should both use this helper
 * so they stay aligned on numbered-list first lines.
 *
 * @param wordLayout - Word list layout metadata for the paragraph
 * @param indentLeft - Paragraph left indent in pixels
 * @param firstLine - Paragraph first-line indent in pixels
 * @param hanging - Paragraph hanging indent in pixels
 * @param measureMarkerText - Callback used when marker glyph width is not precomputed
 * @returns Resolved list prefix geometry, or undefined when the paragraph has no marker
 */
export function resolveListMarkerGeometry(
  wordLayout: MinimalWordLayout | undefined,
  indentLeft: number,
  firstLine: number,
  hanging: number,
  measureMarkerText: MarkerTextMeasurer,
  markerOffsetX = 0,
): ResolvedListMarkerGeometry | undefined {
  const marker = wordLayout?.marker;
  if (!marker) {
    return undefined;
  }

  if (wordLayout?.textStartMode === 'paragraph') {
    const reference = resolveListMarkerGeometry(
      { ...wordLayout, textStartMode: undefined },
      wordLayout.indentLeftPx ?? indentLeft,
      wordLayout.firstLinePx ?? 0,
      wordLayout.hangingPx ?? 0,
      measureMarkerText,
      markerOffsetX,
    );
    if (!reference) return undefined;
    const textStartPx = indentLeft + firstLine - hanging;
    return { ...reference, textStartPx, markerStartPx: reference.markerStartPx + textStartPx - reference.textStartPx };
  }

  const markerTextWidthPx = getMarkerTextWidthPx(marker, measureMarkerText);
  const markerBoxWidthPx = getMarkerBoxWidthPx(marker, markerTextWidthPx);
  const justification = marker.justification ?? 'left';
  const explicitFirstLineMarkerStartPx = getExplicitFirstLineMarkerStartPx(wordLayout, marker);
  const anchorPx = getMarkerAnchorPx(indentLeft, firstLine, hanging) + markerOffsetX;
  const markerStartPx =
    explicitFirstLineMarkerStartPx != null
      ? explicitFirstLineMarkerStartPx + markerOffsetX
      : getMarkerStartPx(anchorPx, justification, markerTextWidthPx);
  const markerContentEndPx = markerStartPx + markerTextWidthPx;
  const suffix = marker.suffix ?? 'tab';

  if (suffix === 'nothing') {
    return {
      markerStartPx,
      markerTextWidthPx,
      textStartPx: markerContentEndPx,
      suffixWidthPx: 0,
    };
  }

  if (suffix === 'space') {
    return {
      markerStartPx,
      markerTextWidthPx,
      textStartPx: markerContentEndPx + SPACE_SUFFIX_GAP_PX,
      suffixWidthPx: SPACE_SUFFIX_GAP_PX,
    };
  }

  if (wordLayout?.firstLineIndentMode === true) {
    const markerCurrentPosPx = justification === 'right' ? anchorPx : markerContentEndPx;
    const suffixWidthPx = computeTabWidth(
      markerCurrentPosPx,
      justification,
      wordLayout.tabsPx,
      hanging,
      firstLine,
      indentLeft,
    );
    const textStartPx = markerContentEndPx + suffixWidthPx;

    return {
      markerStartPx,
      markerTextWidthPx,
      textStartPx,
      suffixWidthPx,
    };
  }

  if (justification !== 'left') {
    // Right/center-justified markers separate from their text with a tab that
    // advances to the same stop the painter targets (computeTabWidth: the
    // hanging-indent text start, or the next default tab stop when a first-line
    // indent applies), not a fixed marker gutter. Using the gutter here left the
    // caret/text-start short of the painted text on hanging-indent levels, so
    // the caret rendered ~one glyph to the left of the clicked position
    // (SD-3778). This mirrors the firstLineIndentMode branch above.
    const markerCurrentPosPx = justification === 'right' ? anchorPx : markerContentEndPx;
    const suffixWidthPx = computeTabWidth(
      markerCurrentPosPx,
      justification,
      wordLayout?.tabsPx,
      hanging,
      firstLine,
      indentLeft,
    );
    return {
      markerStartPx,
      markerTextWidthPx,
      textStartPx: markerContentEndPx + suffixWidthPx,
      suffixWidthPx,
    };
  }

  // Standard hanging-indent: text usually lands at the hanging-indent text start
  // (indent.left), not the next paragraph tab stop. A valid explicit paragraph
  // tab between the marker and that inherited text start is the marker suffix
  // stop; later tabs are for inline w:tab characters and must not be consumed.
  //
  // Gap: w:doNotUseIndentAsNumberingTabStop and w:noTabHangInd can opt out of this
  // behavior, but those compat flags are not yet plumbed through the word-layout
  // contract. Until they are, this unconditionally assumes the default Word mode.
  // That is correct for the vast majority of documents.
  const gutterWidthPx = Math.max(getNonNegativeFiniteNumber(marker.gutterWidthPx) ?? 0, LIST_MARKER_GAP);
  const wordTextStartPx = getFiniteNumber(wordLayout?.textStartPx);
  const explicitSuffixTabPx = resolveExplicitStandardSuffixTabPx(
    wordLayout?.tabsPx,
    markerContentEndPx,
    wordTextStartPx,
    markerOffsetX,
  );
  if (explicitSuffixTabPx != null) {
    return {
      markerStartPx,
      markerTextWidthPx,
      textStartPx: explicitSuffixTabPx,
      suffixWidthPx: explicitSuffixTabPx - markerContentEndPx,
    };
  }

  const explicitTextStartPx = resolveExplicitStandardTextStartPx(
    wordTextStartPx,
    markerContentEndPx,
    gutterWidthPx,
    markerOffsetX,
  );
  if (explicitTextStartPx != null) {
    return {
      markerStartPx,
      markerTextWidthPx,
      textStartPx: explicitTextStartPx,
      suffixWidthPx: explicitTextStartPx - markerContentEndPx,
    };
  }

  // A zero-indent numbering level can use a direct paragraph tab as the
  // numbering suffix stop. There is no hanging-indent text start to prefer in
  // this shape, so falling back to the default 0.5-inch stop creates a much
  // larger marker gap than Word (for example, 284 twips / 18.93 px).
  if (indentLeft === 0 && firstLine === 0 && hanging === 0) {
    const explicitNumberingTabPx = wordLayout?.tabsPx?.find(
      (tabStopPx) => Number.isFinite(tabStopPx) && tabStopPx > markerContentEndPx,
    );
    if (explicitNumberingTabPx != null) {
      return {
        markerStartPx,
        markerTextWidthPx,
        textStartPx: explicitNumberingTabPx,
        suffixWidthPx: explicitNumberingTabPx - markerContentEndPx,
      };
    }
  }

  const markerBoxEndPx = markerStartPx + markerBoxWidthPx;
  const implicitTextStartPx = indentLeft + firstLine;
  let textStartPx = implicitTextStartPx;
  if (textStartPx <= markerBoxEndPx) {
    textStartPx = getNextDefaultTabStopPx(markerBoxEndPx, markerOffsetX);
  }

  return {
    markerStartPx,
    markerTextWidthPx,
    textStartPx,
    suffixWidthPx: textStartPx - markerContentEndPx,
  };
}

/**
 * Convenience wrapper that returns only the text-start X coordinate from
 * {@link resolveListMarkerGeometry}. Falls back to `wordLayout.textStartPx`
 * for firstLineIndentMode paragraphs that have no marker.
 *
 * @param wordLayout - Word list layout metadata for the paragraph
 * @param indentLeft - Paragraph left indent in pixels
 * @param firstLine - Paragraph first-line indent in pixels
 * @param hanging - Paragraph hanging indent in pixels
 * @param measureMarkerText - Callback used when marker glyph width is not precomputed
 * @returns Horizontal pixel position where text content should begin, or undefined if no marker present
 */
export function resolveListTextStartPx(
  wordLayout: MinimalWordLayout | undefined,
  indentLeft: number,
  firstLine: number,
  hanging: number,
  measureMarkerText: MarkerTextMeasurer,
): number | undefined {
  const geometry = resolveListMarkerGeometry(wordLayout, indentLeft, firstLine, hanging, measureMarkerText);
  if (geometry) {
    return geometry.textStartPx;
  }

  if (wordLayout?.firstLineIndentMode === true) {
    return getFiniteNumber(wordLayout.textStartPx);
  }

  return undefined;
}

/**
 * Type guard to check if a value is a valid MinimalWordLayout object.
 *
 * Validates that the object has the expected structure for MinimalWordLayout
 * without unsafe type assertions. Shared across resolver and painter.
 */
export function isMinimalWordLayout(value: unknown): value is MinimalWordLayout {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  if (obj.marker !== undefined) {
    if (typeof obj.marker !== 'object' || obj.marker === null) {
      return false;
    }
    const marker = obj.marker as Record<string, unknown>;

    if (marker.markerText !== undefined && typeof marker.markerText !== 'string') {
      return false;
    }
    if (marker.markerX !== undefined && typeof marker.markerX !== 'number') {
      return false;
    }
    if (marker.textStartX !== undefined && typeof marker.textStartX !== 'number') {
      return false;
    }
  }

  if (obj.indentLeftPx !== undefined) {
    if (typeof obj.indentLeftPx !== 'number') {
      return false;
    }
  }
  if (obj.firstLineIndentMode !== undefined) {
    if (typeof obj.firstLineIndentMode !== 'boolean') {
      return false;
    }
  }
  if (obj.textStartPx !== undefined) {
    if (typeof obj.textStartPx !== 'number') {
      return false;
    }
  }
  if (obj.tabsPx !== undefined) {
    if (!Array.isArray(obj.tabsPx)) {
      return false;
    }
    for (const tab of obj.tabsPx) {
      if (typeof tab !== 'number') {
        return false;
      }
    }
  }

  return true;
}

/**
 * Compute the width of the tab separator between a list marker and its text content.
 *
 * Used for marker modes whose rendering contract differs from the shared geometry
 * helper, such as right/center-justified markers and firstLineIndentMode paragraphs.
 */
export type MarkerIndent = {
  anchorIndentPx: number;
  firstLinePx: number;
  hangingPx: number;
};

export function resolveMarkerIndent(
  indent: { left?: number; right?: number; firstLine?: number; hanging?: number } | undefined,
  isRtl: boolean,
): MarkerIndent {
  const left = indent?.left ?? 0;
  const right = indent?.right ?? 0;
  return {
    anchorIndentPx: isRtl ? right : left,
    firstLinePx: isRtl ? -(indent?.firstLine ?? 0) : (indent?.firstLine ?? 0),
    hangingPx: isRtl ? -(indent?.hanging ?? 0) : (indent?.hanging ?? 0),
  };
}

export function computeTabWidth(
  currentPos: number,
  justification: string,
  tabs: number[] | undefined,
  hangingIndent: number | undefined,
  firstLineIndent: number | undefined,
  leftIndent: number,
): number {
  const nextDefaultTabStop = currentPos + DEFAULT_TAB_INTERVAL_PX - (currentPos % DEFAULT_TAB_INTERVAL_PX);
  let tabWidth: number;
  if (justification === 'left') {
    const explicitTabs = [...(tabs ?? [])];
    if (hangingIndent && hangingIndent > 0) {
      explicitTabs.push(leftIndent);
      explicitTabs.sort((a, b) => a - b);
    }
    let targetTabStop: number | undefined;

    for (const tab of explicitTabs) {
      if (tab > currentPos) {
        targetTabStop = tab;
        break;
      }
    }

    if (targetTabStop === undefined) {
      targetTabStop = nextDefaultTabStop;
    }
    tabWidth = targetTabStop - currentPos;
  } else if (justification === 'right') {
    if (firstLineIndent != null && firstLineIndent > 0) {
      tabWidth = nextDefaultTabStop - currentPos;
    } else {
      tabWidth = hangingIndent ?? 0;
    }
  } else {
    tabWidth = nextDefaultTabStop - currentPos;
  }
  return tabWidth;
}
