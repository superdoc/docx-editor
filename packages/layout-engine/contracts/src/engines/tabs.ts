/**
 * @superdoc/engines-tabs contract
 *
 * Computes tab stops and run positions for tab-aware line breaking.
 * Extracted from PM tab plugin to ensure PM and layout measurer use identical logic.
 *
 * OOXML Alignment Strategy:
 * - Tab positions stored in **twips** (OOXML native unit: 1/1440 inch)
 * - Alignment uses **'start'/'end'** (OOXML native, handles RTL properly)
 * - Leader types match full OOXML set (including 'heavy')
 * - Unit conversion happens once at measurement boundary (twips → px for CSS/DOM)
 */

import type { ParagraphIndent } from './paragraph.js';

const TAB_POSITION_TOLERANCE_TWIPS = 20;
const DEFAULT_TAB_INTERVAL_TWIPS = 720;

/**
 * OOXML-aligned tab stop definition.
 * Positions are in twips (1/1440 inch) to preserve exact OOXML values.
 * Common conversions: 720 twips = 0.5", 1440 twips = 1"
 */
export interface TabStop {
  val: 'start' | 'end' | 'center' | 'decimal' | 'bar' | 'clear';
  pos: number; // Twips from paragraph start (after left indent)
  leader?: 'none' | 'dot' | 'hyphen' | 'heavy' | 'underscore' | 'middleDot';
  source?: 'explicit' | 'default';
}

/**
 * Context for tab stop computation.
 * All measurements in twips to match OOXML precision.
 */
export interface TabContext {
  explicitStops: TabStop[]; // Stops defined in paragraph style (OOXML format)
  defaultTabInterval: number; // Twips (invalid values fall back to 720 = 0.5 inch)
  paragraphIndent: ParagraphIndent; // Left/right/hanging indents (in twips)
  rawParagraphIndent?: ParagraphIndent; // Unclamped indents, used for Word implicit tab-stop rules
}

/**
 * A run with its computed horizontal position.
 * Generic over run type so both PM and layout can use it.
 */
export interface RunPosition<T = unknown> {
  run: T;
  x: number; // pt from line start
  width: number; // pt
  tabStop?: TabStop; // If this run follows a tab character
}

export interface TabbedRun<T = unknown> {
  run: T;
  width: number;
  isTab?: boolean;
  text?: string;
}

export interface LayoutWithTabsOptions<T = unknown> {
  measureTextWidth?: (run: T, text: string) => number;
  decimalSeparator?: string;
}

export interface CalculateTabWidthParams {
  /**
   * Current horizontal position before the tab, in the same units as tabStops (usually px)
   */
  currentX: number;
  /**
   * Sorted tab stops in the same units as currentX. Use computeTabStops + unit conversion first.
   */
  tabStops: TabStop[];
  /**
   * Available paragraph width in the same units.
   */
  paragraphWidth: number;
  /**
   * Default tab distance (fallback) in the same units.
   */
  defaultTabDistance: number;
  /**
   * Default line length (used to repeat the default grid) in the same units.
   */
  defaultLineLength: number;
  /**
   * Text immediately following the tab (used for center/end/decimal).
   */
  followingText?: string;
  /**
   * Optional measurement function for followingText; if omitted, length-based approximation is used.
   */
  measureText?: (text: string) => number;
  /**
   * Decimal separator character for decimal/num tabs.
   */
  decimalSeparator?: string;
}

export interface CalculateTabWidthResult {
  width: number;
  leader?: TabStop['leader'];
  alignment: TabStop['val'] | 'default';
  tabStopPosUsed: number | 'default';
}

/**
 * Compute the full set of tab stops for a paragraph.
 *
 * Merges explicit stops from the style with default stops at regular intervals.
 * Filters out stops that fall before the paragraph's left indent.
 *
 * @param context - Tab context (explicit stops, defaults, indents in twips)
 * @returns Sorted array of tab stops in twips
 */
export function computeTabStops(context: TabContext): TabStop[] {
  const { explicitStops, defaultTabInterval, paragraphIndent, rawParagraphIndent } = context;
  const resolvedDefaultTabInterval =
    Number.isFinite(defaultTabInterval) && defaultTabInterval > 0 ? defaultTabInterval : DEFAULT_TAB_INTERVAL_TWIPS;
  const leftIndent = paragraphIndent.left ?? 0;
  const hanging = paragraphIndent.hanging ?? 0;
  const rawLeftIndent = rawParagraphIndent?.left ?? leftIndent;
  const rawHanging = rawParagraphIndent?.hanging ?? hanging;

  // With a hanging indent, the first line starts at (leftIndent - hanging).
  // EXPLICIT tab stops between this effective position and leftIndent are valid for the first line
  // (the document author deliberately placed them there for hanging indent scenarios).
  // DEFAULT tab stops should still respect leftIndent (they're for regular body text alignment).
  const effectiveMinIndent = Math.max(0, leftIndent - hanging);

  // Extract cleared positions before filtering (OOXML: clear tabs suppress default stops)
  const clearPositions = explicitStops.filter((stop) => stop.val === 'clear').map((stop) => stop.pos);

  // Filter explicit stops: keep those >= effectiveMinIndent (supports hanging indent first lines)
  const filteredExplicitStops = explicitStops
    .filter((stop) => stop.val !== 'clear')
    .filter((stop) => stop.pos >= effectiveMinIndent)
    .map((stop) => ({ ...stop, source: 'explicit' as const }));

  // Find the rightmost explicit stop (use original stops for this calculation)
  const maxExplicit = filteredExplicitStops.reduce((max, stop) => Math.max(max, stop.pos), 0);
  // Collect all stops: start with filtered explicit stops
  const stops: TabStop[] = [...filteredExplicitStops];
  const hasStartAlignedExplicit = filteredExplicitStops.some((stop) => stop.val === 'start');
  const hasExplicitStops = filteredExplicitStops.length > 0;
  const hasClearAtPosition = (position: number): boolean =>
    clearPositions.some((clearPos) => Math.abs(clearPos - position) < TAB_POSITION_TOLERANCE_TWIPS);
  const hasClearAtLeftIndent = clearPositions.some(
    (clearPos) => Math.abs(clearPos - leftIndent) < TAB_POSITION_TOLERANCE_TWIPS,
  );

  // Word treats the body text start of a hanging-indent paragraph as an implicit
  // tab target. This is what lets manual numbering like "1.\tText" align the
  // first-line text with wrapped body lines even when the left indent is not on
  // the document's default tab grid.
  if (!hasExplicitStops && !hasClearAtLeftIndent && hanging > 0 && leftIndent > effectiveMinIndent) {
    stops.push({
      val: 'start',
      pos: leftIndent,
      leader: 'none',
      source: 'default',
    });
  }

  // Word places an implicit tab stop at the left margin. This matters when a
  // hanging indent pulls the first-line origin before the content left edge:
  // a leading tab should advance back to the left margin instead of jumping to
  // the first default tab interval.
  const firstLineOrigin = rawLeftIndent - rawHanging;
  if (
    firstLineOrigin < 0 &&
    !hasClearAtPosition(0) &&
    !stops.some((stop) => Math.abs(stop.pos) < TAB_POSITION_TOLERANCE_TWIPS)
  ) {
    stops.push({ val: 'start', pos: 0, leader: 'none', source: 'default' });
  }
  const leftIndentStop = Math.abs(rawLeftIndent);
  if (
    rawHanging > 0 &&
    leftIndentStop > 0 &&
    firstLineOrigin < leftIndentStop &&
    !hasClearAtPosition(leftIndentStop) &&
    !stops.some((stop) => Math.abs(stop.pos - leftIndentStop) < TAB_POSITION_TOLERANCE_TWIPS)
  ) {
    stops.push({ val: 'start', pos: leftIndentStop, leader: 'none', source: 'default' });
  }

  // Generate default stops at regular intervals.
  // - When no explicit start tabs exist (e.g., TOC paragraphs with only right-aligned tabs),
  //   seed defaults from the origin so numbering/content still lands on the default grid.
  // - Otherwise, preserve legacy behavior: defaults start after the rightmost explicit or left indent.
  const seedDefaultsFromZero = !hasStartAlignedExplicit;
  const defaultStart = seedDefaultsFromZero ? 0 : Math.max(maxExplicit, leftIndent);
  let pos = defaultStart;
  const targetLimit = Math.max(defaultStart, leftIndent, maxExplicit) + 14400; // 14400 twips = 10 inches

  while (pos < targetLimit) {
    pos += resolvedDefaultTabInterval;

    // Don't add if there's already a stop OR a cleared position at this position
    const hasExistingStop = stops.some((s) => Math.abs(s.pos - pos) < TAB_POSITION_TOLERANCE_TWIPS);
    const hasClearStop = clearPositions.some((clearPos) => Math.abs(clearPos - pos) < TAB_POSITION_TOLERANCE_TWIPS);

    // Default stops must be >= leftIndent (for body text alignment)
    const isValidDefault = pos >= leftIndent;

    if (!hasExistingStop && !hasClearStop && isValidDefault) {
      stops.push({
        val: 'start',
        pos,
        leader: 'none',
        source: 'default',
      });
    }
  }

  // Sort by position
  return stops.sort((a, b) => a.pos - b.pos);
}

/**
 * Layout runs with tab awareness, computing horizontal positions.
 *
 * Handles all OOXML tab alignment types:
 * - start: Text begins at tab stop (left-aligned)
 * - end: Text ends at tab stop (right-aligned)
 * - center: Text is centered at tab stop
 * - decimal: Decimal separator aligns at tab stop
 * - bar: Vertical line at tab stop (handled by painters, not layout)
 *
 * Note: This function operates in the measurer's coordinate space (typically pixels).
 * Tab stop positions should be converted from twips before calling this function.
 *
 * @param runs - Array of runs with pre-computed widths (in measurer units)
 * @param stops - Sorted tab stops (positions converted to measurer units)
 * @param lineWidth - Maximum line width (in measurer units)
 * @param options - Optional config (measureTextWidth for accuracy, decimalSeparator for locale)
 * @returns Runs with computed x positions
 */
export function layoutWithTabs<T>(
  runs: TabbedRun<T>[],
  stops: TabStop[],
  lineWidth: number,
  options: LayoutWithTabsOptions<T> = {},
): RunPosition<T>[] {
  const result: RunPosition<T>[] = [];
  let currentX = 0;
  let currentStopIndex = 0;
  let pendingDecimalStop: TabStop | undefined;
  let pendingCenterStop: TabStop | undefined;
  let pendingEndStop: TabStop | undefined;
  const decimalSeparator = options.decimalSeparator ?? '.';

  for (const entry of runs) {
    const { run, width, isTab } = entry;
    if (isTab) {
      // Find next tab stop
      while (currentStopIndex < stops.length && stops[currentStopIndex].pos <= currentX) {
        currentStopIndex++;
      }

      if (currentStopIndex < stops.length) {
        const stop = stops[currentStopIndex];

        // Tab character itself doesn't render, but we record the stop
        result.push({
          run,
          x: currentX,
          width: 0,
          tabStop: stop,
        });

        // Advance to the tab stop position
        currentX = stop.pos;
        pendingDecimalStop = stop.val === 'decimal' ? stop : undefined;
        pendingCenterStop = stop.val === 'center' ? stop : undefined;
        pendingEndStop = stop.val === 'end' ? stop : undefined;
        currentStopIndex++;
      } else {
        // No more tab stops, treat as space
        result.push({
          run,
          x: currentX,
          width,
        });
        currentX += width;
        pendingDecimalStop = undefined;
        pendingCenterStop = undefined;
        pendingEndStop = undefined;
      }
    } else {
      if (pendingDecimalStop) {
        currentX = computeDecimalAlignedX(entry, pendingDecimalStop, options, decimalSeparator);
        pendingDecimalStop = undefined;
      } else if (pendingCenterStop) {
        currentX = computeCenterAlignedX(entry, pendingCenterStop);
        pendingCenterStop = undefined;
      } else if (pendingEndStop) {
        currentX = computeEndAlignedX(entry, pendingEndStop);
        pendingEndStop = undefined;
      }
      // Regular run
      result.push({
        run,
        x: currentX,
        width,
      });
      currentX += width;
    }
  }

  return result;
}

function computeDecimalAlignedX<T>(
  entry: TabbedRun<T>,
  stop: TabStop,
  options: LayoutWithTabsOptions<T>,
  separator: string,
): number {
  const text = entry.text ?? '';
  const decimalIndex = text.indexOf(separator);

  if (decimalIndex <= 0) {
    return stop.pos;
  }

  const beforeText = text.slice(0, decimalIndex);
  let beforeWidth: number;
  if (options.measureTextWidth) {
    beforeWidth = options.measureTextWidth(entry.run, beforeText);
  } else if (text.length > 0) {
    beforeWidth = (entry.width * decimalIndex) / text.length;
  } else {
    beforeWidth = 0;
  }

  const targetX = stop.pos - beforeWidth;
  return targetX < 0 ? 0 : targetX;
}

function computeCenterAlignedX<T>(entry: TabbedRun<T>, stop: TabStop): number {
  const width = entry.width;
  const targetX = stop.pos - width / 2;
  return targetX < 0 ? 0 : targetX;
}

function computeEndAlignedX<T>(entry: TabbedRun<T>, stop: TabStop): number {
  const width = entry.width;
  const targetX = stop.pos - width;
  return targetX < 0 ? 0 : targetX;
}

/**
 * Compute the visual width a tab should occupy based on tab stops and following text.
 * This is a pure helper for consumers that only need a single tab width (e.g., adapters).
 */
export function calculateTabWidth(params: CalculateTabWidthParams): CalculateTabWidthResult {
  const {
    currentX,
    tabStops,
    paragraphWidth,
    defaultTabDistance,
    defaultLineLength,
    followingText = '',
    measureText,
    decimalSeparator = '.',
  } = params;

  const nextStop = tabStops.find((stop) => stop.val !== 'clear' && stop.pos > currentX);

  const fallbackWidth = (): CalculateTabWidthResult => {
    let tabWidth = defaultTabDistance - ((currentX % defaultLineLength) % defaultTabDistance);
    if (tabWidth <= 0) tabWidth = defaultTabDistance;
    return {
      width: tabWidth,
      alignment: 'default',
      tabStopPosUsed: 'default',
    };
  };

  if (!nextStop) {
    return fallbackWidth();
  }

  let width = Math.min(nextStop.pos, paragraphWidth) - currentX;
  const alignment = nextStop.val;

  if (alignment === 'bar') {
    return {
      width: 0,
      leader: nextStop.leader,
      alignment,
      tabStopPosUsed: nextStop.pos,
    };
  }

  if (alignment === 'center' || alignment === 'end') {
    const textWidth = measureText ? measureText(followingText) : 0;
    if (alignment === 'center') {
      width -= textWidth / 2;
    } else {
      width -= textWidth;
    }
  } else if (alignment === 'decimal') {
    const decimalIndex = followingText.indexOf(decimalSeparator);
    if (decimalIndex >= 0) {
      const before = followingText.slice(0, decimalIndex);
      const beforeWidth = measureText ? measureText(before) : 0;
      width -= beforeWidth;
    }
  }

  if (width < 1) {
    return fallbackWidth();
  }

  return {
    width,
    leader: nextStop.leader,
    alignment,
    tabStopPosUsed: nextStop.pos,
  };
}
