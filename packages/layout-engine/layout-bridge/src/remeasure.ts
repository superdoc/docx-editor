import type {
  ParagraphBlock,
  ParagraphMeasure,
  ParagraphSpacing,
  Line,
  LineInlineImageAlignment,
  LineSegment,
  Run,
  ImageRun,
  TextRun,
  TabRun,
  TabStop,
  ParagraphIndent,
  LeaderDecoration,
  ParagraphLineRegion,
} from '@superdoc/contracts';
import {
  EMPTY_SDT_PLACEHOLDER_TEXT,
  Engines,
  getParagraphInlineDirection,
  isEmptySdtPlaceholderRun,
  sliceRunsForLine,
} from '@superdoc/contracts';
import type { WordParagraphLayoutOutput } from '@superdoc/word-layout';
import {
  LIST_MARKER_GAP as _LIST_MARKER_GAP,
  SPACE_SUFFIX_GAP_PX as _SPACE_SUFFIX_GAP_PX,
  DEFAULT_TAB_INTERVAL_PX as _DEFAULT_TAB_INTERVAL_PX,
} from '@superdoc/common/layout-constants';
import { resolveListTextStartPx } from '@superdoc/common/list-marker-utils';
import { DEFAULT_FONT_MEASURE_CONTEXT, type FaceKey, type FontMeasureContext } from '@superdoc/font-system';
import {
  getCalibratedNaturalSingleLine,
  collectCjkJustificationBoundaries,
  isCjkBreakOpportunityChar,
  nextCodePointBoundary,
  resolveKinsokuBoundary,
} from '@superdoc/measuring-dom';

/**
 * Type definition for paragraph block attributes that include indentation and tab stops.
 * Extracted for cleaner type safety when accessing block.attrs.
 */
type ParagraphBlockAttrs = {
  alignment?: 'left' | 'center' | 'right' | 'justify';
  indent?: { left?: number; right?: number; firstLine?: number; hanging?: number };
  tabs?: TabStop[];
  tabIntervalTwips?: number;
  decimalSeparator?: string;
  spacing?: ParagraphSpacing;
  wordLayout?: WordParagraphLayoutOutput;
  numberingProperties?: unknown;
  /** Word quirk: justified paragraphs ignore first-line indent. Set by pm-adapter. */
  suppressFirstLineIndent?: boolean;
};

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;

/**
 * Retrieves or creates a canvas rendering context for text measurement.
 *
 * This function manages a singleton canvas context used across all text measurements.
 * The canvas context provides the measureText API which is essential for accurate
 * text width calculations that match browser rendering.
 *
 * @returns Canvas 2D rendering context if available in browser environment, null otherwise.
 *   Returns null in server-side rendering contexts where document is undefined.
 */
function getCtx(): CanvasRenderingContext2D | null {
  if (ctx) return ctx;
  if (typeof document === 'undefined') return null;
  canvas = document.createElement('canvas');
  ctx = canvas.getContext('2d');
  return ctx;
}

// ---------------------------------------------------------------------------
// Text-width caches (plans/layout-improvements.md idea 2).
//
// remeasureParagraph historically issued one `ctx.font = ...` assignment plus
// one `ctx.measureText(singleChar)` call PER CHARACTER of every remeasured
// paragraph, with no caching — the dominant cost of a legitimate remeasure
// (multi-column sections, float-narrowed regions, textboxes). Both caches are
// exact under the existing width model:
// - the greedy line breaker sums independent single-character measurements, so
//   a per-(font, char) advance cache reproduces identical arithmetic;
// - slice measurement (tab groups / line segments / SDT placeholders) measures
//   a whole slice in one measureText call, so results are memoized verbatim by
//   (font, text) with letter-spacing applied arithmetically outside the cache.
// Word-chunked measurement was deliberately NOT adopted: measuring whole words
// in one call would let intra-word kerning/ligatures change computed widths
// versus the per-character summing model, shifting line breaks.
//
// Staleness: entries key off the resolved canvas font string, so a late-
// loading font face (same font string, new face) would invalidate them. The
// incrementalLayout pipeline clears these caches whenever the document font
// signature changes; standalone callers can clear via
// clearRemeasureTextCaches(). This matches the exposure of measuring-dom's
// module-level measurement cache.
// ---------------------------------------------------------------------------

const MAX_GLYPH_FONT_ENTRIES = 64;
const MAX_GLYPH_ADVANCES_PER_FONT = 2048;
const MAX_SLICE_CACHE_ENTRIES = 4096;

/** Per-font single-character advance cache: font string -> (char -> width px). */
const glyphAdvancesByFont = new Map<string, Map<string, number>>();
/** Whole-slice base width cache (no letter-spacing): "font\0text" -> width px. */
const sliceWidthCache = new Map<string, number>();

/** Drop cached text widths and the canvas context. Call when registered font faces may have changed. */
export function clearRemeasureTextCaches(): void {
  glyphAdvancesByFont.clear();
  sliceWidthCache.clear();
  ctx = null;
  canvas = null;
}

/** Measure a single character's advance for a font, through the glyph cache. */
function measureGlyphAdvance(context: CanvasRenderingContext2D, font: string, char: string): number {
  let advances = glyphAdvancesByFont.get(font);
  if (!advances) {
    if (glyphAdvancesByFont.size >= MAX_GLYPH_FONT_ENTRIES) glyphAdvancesByFont.clear();
    advances = new Map();
    glyphAdvancesByFont.set(font, advances);
  }
  const cached = advances.get(char);
  if (cached !== undefined) return cached;
  context.font = font;
  const width = context.measureText(char).width;
  if (advances.size >= MAX_GLYPH_ADVANCES_PER_FONT) advances.clear();
  advances.set(char, width);
  return width;
}

/** Measure a multi-character slice's base width (no letter-spacing), memoized. */
function measureSliceBaseWidth(context: CanvasRenderingContext2D, font: string, text: string): number {
  // "\0" cannot appear in a canvas font string, so the first NUL delimits unambiguously.
  const key = font + '\u0000' + text;
  const cached = sliceWidthCache.get(key);
  if (cached !== undefined) return cached;
  context.font = font;
  const width = context.measureText(text).width;
  if (sliceWidthCache.size >= MAX_SLICE_CACHE_ENTRIES) sliceWidthCache.clear();
  sliceWidthCache.set(key, width);
  return width;
}

/**
 * Type guard to determine if a run is a TextRun (has text content and formatting).
 *
 * In the SuperDoc run model, runs can be various types (text, tab, image, break, etc.).
 * TextRuns are the only runs that have text content and typography properties
 * (fontSize, fontFamily, bold, italic). This type guard enables safe access to
 * these properties by narrowing the Run union type to TextRun.
 *
 * Run types that are NOT TextRuns:
 * - tab: Represents horizontal tab character (no text content)
 * - lineBreak: Represents soft line break
 * - break: Represents page/column break
 * - fieldAnnotation: Represents field metadata
 * - image/drawing runs with 'src' property
 *
 * @param run - The run to check (can be any Run type from the union).
 * @returns True if the run is a TextRun with text content and formatting properties,
 *   false for tabs, breaks, images, and other non-text run types.
 */
function isTextRun(run: Run): run is TextRun {
  // Explicitly check for non-text run types
  if (run.kind === 'tab' || run.kind === 'lineBreak' || run.kind === 'break' || run.kind === 'fieldAnnotation') {
    return false;
  }
  // Check for image/drawing runs which have 'src' property
  if ('src' in run) {
    return false;
  }
  // All other runs are text runs
  return true;
}

const isVanishedRun = (run: Run | undefined): boolean => (run as { vanish?: boolean } | undefined)?.vanish === true;

function visibleTextFontSize(run: Run | undefined): number | undefined {
  if (!run || isVanishedRun(run) || !isTextRun(run)) return undefined;
  return typeof run.fontSize === 'number' ? run.fontSize : undefined;
}

function visibleLineHeightFontSize(run: Run | undefined): number | undefined {
  if (!run || isVanishedRun(run)) return undefined;
  if (!isTextRun(run) && run.kind !== 'tab') return undefined;
  const fontSize = (run as TextRun | TabRun).fontSize;
  return typeof fontSize === 'number' ? fontSize : undefined;
}

/**
 * Generates a CSS font string for canvas text measurement from a run's formatting.
 *
 * The canvas measureText API requires a CSS font string (e.g., "italic bold 16px Arial")
 * to accurately measure text width. This function converts SuperDoc run formatting
 * properties (fontSize, fontFamily, bold, italic) into the CSS font string format.
 *
 * CSS font string format: [style] [weight] <size> <family>
 * - style: "italic" or omitted
 * - weight: "bold" or omitted
 * - size: font size in pixels (required)
 * - family: font family name (required)
 *
 * @param run - The run containing formatting properties (fontSize, fontFamily, bold, italic).
 *   For non-text runs (tabs, breaks), uses default formatting values.
 * @returns CSS font string suitable for CanvasRenderingContext2D.font property.
 *   Example outputs: "16px Arial", "italic bold 24px Times New Roman"
 */
function fontString(run: Run): string {
  const textRun = isTextRun(run) ? run : null;
  const size = textRun?.fontSize ?? 16;
  const family = textRun?.fontFamily ?? 'Arial';
  const italic = textRun?.italic ? 'italic ' : '';
  const bold = textRun?.bold ? 'bold ' : '';
  return `${italic}${bold}${size}px ${family}`.trim();
}

/**
 * Extracts text content from a run.
 *
 * Different run types have different text content:
 * - Text runs: Have text property with string content
 * - Image/drawing runs: Have 'src' property, no text content
 * - Line breaks, breaks, field annotations: Special kinds with no text content
 *
 * @param run - The run to extract text from
 * @returns Text content of the run, or empty string for non-text runs
 */
function runText(run: Run): string {
  if (isEmptySdtPlaceholderRun(run)) {
    return run.sdt?.type === 'structuredContent' && run.sdt.appearance === 'hidden' ? '' : EMPTY_SDT_PLACEHOLDER_TEXT;
  }

  return 'src' in run ||
    run.kind === 'lineBreak' ||
    run.kind === 'break' ||
    run.kind === 'fieldAnnotation' ||
    run.kind === 'math'
    ? ''
    : (run.text ?? '');
}

const runAddressableLength = (run: Run): number => {
  const textLength = runText(run).length;
  return textLength > 0 ? textLength : run.kind === 'tab' ? 1 : 0;
};

/**
 * Determines if a character is considered a "word character" for capitalization.
 *
 * Word characters are defined as:
 * - Digits: 0-9 (ASCII 48-57)
 * - Uppercase letters: A-Z (ASCII 65-90)
 * - Lowercase letters: a-z (ASCII 97-122)
 * - Apostrophe: ' (for contractions like "don't", "it's")
 *
 * Used by capitalizeText to determine word boundaries. A capital letter is
 * applied when a word character follows a non-word character.
 *
 * @param char - The character to check (single character string)
 * @returns True if the character is a word character, false otherwise
 *
 * @example
 * ```typescript
 * isWordChar('a');  // true
 * isWordChar('Z');  // true
 * isWordChar('5');  // true
 * isWordChar("'");  // true (for contractions)
 * isWordChar(' ');  // false
 * isWordChar('-');  // false
 * ```
 */
const isWordChar = (char: string): boolean => {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || char === "'";
};

/**
 * Capitalizes the first letter of each word in text.
 *
 * Implements CSS text-transform: capitalize by uppercasing the first character
 * of each word. A word is defined as any sequence of word characters (letters,
 * digits, apostrophes) preceded by a non-word character or the start of text.
 *
 * This function handles proper word boundary detection even when operating on
 * a slice of text within a larger string (via fullText and startOffset parameters),
 * ensuring correct capitalization at slice boundaries.
 *
 * @param text - The text to capitalize
 * @param fullText - Optional full text context (for proper boundary detection when text is a slice)
 * @param startOffset - Optional offset of text within fullText (required if fullText provided)
 * @returns Text with first letter of each word capitalized
 *
 * @example
 * ```typescript
 * capitalizeText("hello world");
 * // Returns: "Hello World"
 *
 * capitalizeText("don't stop");
 * // Returns: "Don't Stop"
 *
 * // With full text context for slice
 * capitalizeText("world", "hello world", 6);
 * // Returns: "world" (not "World" because 'w' is mid-word in full context)
 * ```
 */
const capitalizeText = (text: string, fullText?: string, startOffset?: number): string => {
  if (!text) return text;
  const hasFullText = typeof startOffset === 'number' && fullText != null;
  let result = '';
  for (let i = 0; i < text.length; i += 1) {
    const prevChar = hasFullText
      ? startOffset! + i > 0
        ? fullText![startOffset! + i - 1]
        : ''
      : i > 0
        ? text[i - 1]
        : '';
    const ch = text[i];
    result += isWordChar(ch) && !isWordChar(prevChar) ? ch.toUpperCase() : ch;
  }
  return result;
};

/**
 * Applies CSS text-transform to text.
 *
 * Implements the CSS text-transform property values:
 * - 'uppercase': Convert all characters to uppercase
 * - 'lowercase': Convert all characters to lowercase
 * - 'capitalize': Capitalize first letter of each word (via capitalizeText)
 * - 'none': No transformation (return original text)
 *
 * Used during text measurement to apply visual transformations without mutating
 * the underlying document model. The transform is applied during rendering and
 * measurement but does not affect the stored text content.
 *
 * @param text - The text to transform
 * @param transform - CSS text-transform value ('uppercase', 'lowercase', 'capitalize', 'none', undefined)
 * @param fullText - Optional full text context (passed to capitalizeText for proper word boundaries)
 * @param startOffset - Optional offset within fullText (passed to capitalizeText)
 * @returns Transformed text, or original text if transform is 'none' or undefined
 *
 * @example
 * ```typescript
 * applyTextTransform("Hello World", "uppercase");
 * // Returns: "HELLO WORLD"
 *
 * applyTextTransform("Hello World", "lowercase");
 * // Returns: "hello world"
 *
 * applyTextTransform("hello world", "capitalize");
 * // Returns: "Hello World"
 *
 * applyTextTransform("hello", undefined);
 * // Returns: "hello" (no transformation)
 * ```
 */
const applyTextTransform = (
  text: string,
  transform: 'uppercase' | 'lowercase' | 'capitalize' | 'none' | undefined,
  fullText?: string,
  startOffset?: number,
): string => {
  if (!text || !transform || transform === 'none') return text;
  if (transform === 'uppercase') return text.toUpperCase();
  if (transform === 'lowercase') return text.toLowerCase();
  if (transform === 'capitalize') return capitalizeText(text, fullText, startOffset);
  return text;
};

/**
 * Single-character variant of applyTextTransform for the line-breaking hot
 * loop. Equivalent to `applyTextTransform(text[index], transform, text, index)`
 * without the per-character slice/branch overhead.
 */
const transformChar = (
  text: string,
  index: number,
  transform: 'uppercase' | 'lowercase' | 'capitalize' | 'none' | undefined,
  /** Exclusive end of the code point at `index`; two units for astral characters. */
  end?: number,
): string => {
  const char = typeof end === 'number' ? text.slice(index, end) : text[index];
  if (!transform || transform === 'none') return char;
  if (transform === 'uppercase') return char.toUpperCase();
  if (transform === 'lowercase') return char.toLowerCase();
  // capitalize: uppercase a word character that follows a non-word character.
  const prevChar = index > 0 ? text[index - 1] : '';
  return isWordChar(char) && !isWordChar(prevChar) ? char.toUpperCase() : char;
};

// --- Tab helpers (aligned with measuring/dom defaults) ---
const DEFAULT_TAB_INTERVAL_TWIPS = 720; // 0.5in
const TWIPS_PER_INCH = 1440;
const PX_PER_INCH = 96;
const TWIPS_PER_PX = TWIPS_PER_INCH / PX_PER_INCH; // 15 twips per px
/**
 * Floating-point tolerance for tab stop comparison (0.1 pixels).
 *
 * Why this constant exists:
 * - Canvas text measurement produces floating-point widths with minor precision variations
 * - When checking if current position has passed a tab stop, exact equality is unreliable
 * - Without tolerance, tab stops at position X might be skipped when current position is X - 0.0001
 *
 * Why 0.1px was chosen:
 * - Large enough to absorb floating-point rounding errors (typically < 0.05px)
 * - Small enough to avoid incorrectly skipping legitimate tab stops
 * - Visually imperceptible at standard screen resolutions (< 1/10th of a pixel)
 *
 * Usage:
 * - When finding next tab stop: `tabStops[i].pos <= currentX + TAB_EPSILON`
 * - Ensures tab stops within 0.1px of current position are considered "reached"
 */
const TAB_EPSILON = 0.1;

/**
 * Floating-point tolerance for line breaking decisions (0.5 pixels).
 *
 * Why this constant exists:
 * - Canvas text measurement can vary slightly between measurement and rendering contexts
 * - Different browsers may round sub-pixel measurements differently
 * - Without tolerance, lines might break prematurely when text is *almost* at maxWidth
 *
 * Why 0.5px was chosen:
 * - Large enough to absorb typical floating-point rounding errors (0.1-0.3px)
 * - Small enough to be visually imperceptible at standard screen resolutions
 * - Conservative value that prevents premature line breaks without allowing significant overflow
 *
 * Usage:
 * - When checking if another glyph still fits: `width + glyphWidth > effectiveMaxWidth - WIDTH_FUDGE_PX`
 * - Gives layout a 0.5px safety margin before triggering a normal line break
 * - Prevents edge cases where measured text at 199.7px breaks on a 200px line
 */
const WIDTH_FUDGE_PX = 0.5;
const twipsToPx = (twips: number): number => twips / TWIPS_PER_PX;
const pxToTwips = (px: number): number => Math.round(px * TWIPS_PER_PX);

/**
 * Sanitizes an indent value to ensure it's a valid non-negative finite number.
 *
 * Handles edge cases where indent values may be undefined, NaN, Infinity, or negative
 * from malformed document data or style cascade issues. Negative values are clamped
 * to 0 to prevent widening the content area beyond maxWidth.
 *
 * @param value - The indent value to sanitize (may be undefined, non-finite, or negative)
 * @returns The original value if it's a positive finite number, otherwise 0
 */
const sanitizeIndent = (value: number | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
const sanitizeRawIndent = (value: number | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

/**
 * Sanitizes the decimal separator to ensure it's a valid value for decimal tab alignment.
 *
 * OOXML documents may specify locale-specific decimal separators. This function
 * normalizes the value to either ',' (comma) or '.' (period, the default).
 *
 * @param value - The decimal separator value from document attributes
 * @returns ',' if the value is a comma, otherwise '.' (default)
 */
const sanitizeDecimalSeparator = (value: unknown): string => (value === ',' ? ',' : '.');

/**
 * Safely extracts the width property from a run that may have an optional width.
 *
 * Used for non-text runs (images, breaks) that may have pre-calculated widths.
 *
 * @param run - The run to extract width from
 * @returns The width value if present and numeric, otherwise 0
 */
const getRunWidth = (run: Run): number => {
  const width = (run as { width?: number }).width;
  return typeof width === 'number' ? width : 0;
};

/**
 * Checks if a break run is a line break (as opposed to page/column break).
 *
 * @param run - The run to check
 * @returns True if the run is a line break
 */
const isLineBreakRun = (run: Run): boolean =>
  run.kind === 'lineBreak' || (run.kind === 'break' && (run as { breakType?: string }).breakType === 'line');

/** True when a run is an inline image run. */
const isImageRun = (run: Run): run is ImageRun => run.kind === 'image';

/**
 * Tolerance (px) for the "image fits inside the text line box" decision.
 *
 * MIRRORS `INLINE_IMAGE_BASELINE_TOLERANCE_PX` in `measuring/dom/src/index.ts`.
 * The two live in separate packages, so the tiny predicate is duplicated rather
 * than shared across a package boundary; the values MUST stay in sync (covered
 * by the small-image remeasure test asserting `baseline`).
 */
const INLINE_IMAGE_BASELINE_TOLERANCE_PX = 0.5;

/** One inline-image candidate tracked on the current remeasured line. */
type RemeasureImageCandidate = {
  runIndex: number;
  imageWidth: number;
  imageHeight: number;
  hasExplicitVerticalAlign: boolean;
  hasVerticalMargins: boolean;
};

const makeRemeasureImageCandidate = (
  runIndex: number,
  run: ImageRun,
  imageWidth: number,
  imageHeight: number,
): RemeasureImageCandidate => ({
  runIndex,
  imageWidth,
  imageHeight,
  hasExplicitVerticalAlign: run.verticalAlign != null,
  hasVerticalMargins: (run.distTop ?? 0) !== 0 || (run.distBottom ?? 0) !== 0,
});

/**
 * Resolve measured per-image baseline alignment for one remeasured line.
 *
 * MIRRORS `resolveInlineImageAlignments` in `measuring/dom/src/index.ts` so a
 * narrower-region reflow produces the same glyph-vs-line-expanding decision as
 * the initial measurement and the fix is not lost on reflowed lines.
 */
const resolveRemeasureImageAlignments = (
  candidates: RemeasureImageCandidate[],
  hasVisibleText: boolean,
  textLineHeight: number,
): LineInlineImageAlignment[] | undefined => {
  if (candidates.length === 0) return undefined;
  const alignments: LineInlineImageAlignment[] = [];
  for (const candidate of candidates) {
    if (candidate.hasExplicitVerticalAlign) continue;
    if (candidate.imageWidth <= 0) continue;
    if (candidate.imageHeight <= 0) continue;
    if (!hasVisibleText) continue;
    if (candidate.hasVerticalMargins) continue;
    if (candidate.imageHeight > textLineHeight + INLINE_IMAGE_BASELINE_TOLERANCE_PX) continue;
    alignments.push({ runIndex: candidate.runIndex, verticalAlign: 'baseline' });
  }
  return alignments.length > 0 ? alignments : undefined;
};

/**
 * Tab stop position and alignment info in pixels.
 * Converted from twips for rendering calculations.
 */
type TabStopPx = {
  /** Position in pixels from left margin */
  pos: number;
  /** Alignment type: 'start' (left), 'end' (right), 'center', or 'decimal' */
  val: TabStop['val'];
  /** Optional leader character style (dots, dashes, etc.) */
  leader?: TabStop['leader'];
  /** Whether this came from author-defined tabs or the default tab grid. */
  source?: TabStop['source'];
};

type PendingTabAlignStart = {
  layoutX: number;
  paintX: number;
  precedingTabEndX?: number;
};

/**
 * Type definition for minimal marker run formatting properties.
 *
 * Used to generate font strings for marker text measurement. Contains only
 * the essential typography properties needed for canvas measurement.
 */
type MarkerRun = {
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
};

/**
 * Generates a CSS font string for measuring list marker text.
 *
 * Similar to the main fontString() function but specialized for marker runs
 * which may have incomplete formatting information. Provides sensible defaults
 * for missing properties (16px Arial) to ensure measurement always succeeds.
 *
 * The CSS font string format is required by canvas.measureText() API:
 * [style] [weight] <size> <family>
 *
 * @param run - Marker run with optional formatting properties (fontFamily, fontSize, bold, italic)
 * @returns CSS font string suitable for CanvasRenderingContext2D.font property
 *
 * @example
 * ```typescript
 * markerFontString({ fontFamily: 'Arial', fontSize: 14, bold: true });
 * // Returns: "bold 14px Arial"
 *
 * markerFontString({ fontSize: 18, italic: true });
 * // Returns: "italic 18px Arial" (defaults to Arial)
 *
 * markerFontString();
 * // Returns: "16px Arial" (all defaults)
 * ```
 */
const markerFontString = (run?: MarkerRun): string => {
  const size = run?.fontSize ?? 16;
  const family = run?.fontFamily ?? 'Arial';
  const italic = run?.italic ? 'italic ' : '';
  const bold = run?.bold ? 'bold ' : '';
  return `${italic}${bold}${size}px ${family}`.trim();
};

/**
 * Build tab stop positions in pixels from OOXML tab stop specifications.
 *
 * Converts tab stops from TWIPS (the unit used in OOXML) to pixels and applies
 * paragraph indentation rules to compute the effective tab stop positions. This
 * function delegates the complex tab stop computation logic to the Engines module
 * which implements the full OOXML specification including default tab intervals,
 * explicit tab stops, and indent adjustments.
 *
 * OOXML tab stop behavior:
 * - Explicit tab stops override default tab intervals
 * - Default tab interval creates infinite grid of implicit tab stops
 * - Paragraph indents can shift or mask tab stops in the indented region
 * - Tab stops are measured from the left edge of the paragraph content area
 *
 * @param indent - Paragraph indentation settings (left, right, firstLine, hanging) in pixels.
 *   These values affect where tab stops are positioned relative to the paragraph text.
 * @param tabs - Array of explicit tab stop definitions from OOXML (position in TWIPS, alignment, leader).
 *   Each tab stop specifies a position and optional formatting (left/right/center/decimal alignment, leader dots/dashes).
 * @param tabIntervalTwips - Default tab interval in TWIPS. If not specified, uses the OOXML default of 720 TWIPS (0.5 inches).
 *   This creates a regular grid of implicit tab stops at this interval.
 * @returns Array of tab stops with positions converted to pixels, preserving alignment and leader information.
 *   Each tab stop includes: pos (position in pixels), val (alignment type), and optional leader (visual character).
 *
 * @example
 * ```typescript
 * // Create tab stops with default interval and one explicit tab at 1 inch
 * const tabStops = buildTabStopsPx(
 *   { left: 0, right: 0, firstLine: 0, hanging: 0 },
 *   [{ pos: 1440, val: 'left' }], // 1440 TWIPS = 1 inch
 *   720 // Default interval = 0.5 inch
 * );
 * // Returns: [{ pos: 96, val: 'left' }, { pos: 48, val: 'left' }, ...]
 * // (96px = 1 inch at 96dpi, 48px = 0.5 inch default interval)
 * ```
 */
const buildTabStopsPx = (indent?: ParagraphIndent, tabs?: TabStop[], tabIntervalTwips?: number): TabStopPx[] => {
  const paragraphIndentTwips = {
    left: pxToTwips(sanitizeIndent(indent?.left)),
    right: pxToTwips(sanitizeIndent(indent?.right)),
    firstLine: pxToTwips(sanitizeIndent(indent?.firstLine)),
    hanging: pxToTwips(sanitizeIndent(indent?.hanging)),
  };
  const rawParagraphIndentTwips = {
    left: pxToTwips(sanitizeRawIndent(indent?.left)),
    right: pxToTwips(sanitizeRawIndent(indent?.right)),
    firstLine: pxToTwips(sanitizeRawIndent(indent?.firstLine)),
    // Hanging is unsigned in OOXML; preserve negative left/right/firstLine only.
    hanging: pxToTwips(sanitizeIndent(indent?.hanging)),
  };

  const stops = Engines.computeTabStops({
    explicitStops: tabs ?? [],
    defaultTabInterval: tabIntervalTwips ?? DEFAULT_TAB_INTERVAL_TWIPS,
    paragraphIndent: paragraphIndentTwips,
    rawParagraphIndent: rawParagraphIndentTwips,
  });

  return stops.map((stop: TabStop) => ({
    pos: twipsToPx(stop.pos),
    val: stop.val,
    leader: stop.leader,
    source: stop.source,
  }));
};

/**
 * Find the next tab stop position after the current cursor position.
 *
 * Implements the OOXML tab stop resolution algorithm: searches through explicit
 * tab stops to find the first one that is strictly after the current X position,
 * accounting for floating-point precision with a small epsilon tolerance. If all
 * explicit tab stops have been exhausted, falls back to the default tab interval
 * to compute an implicit tab stop position.
 *
 * Algorithm:
 * 1. Starting from `startIndex`, iterate through `tabStops` array
 * 2. Skip any tab stops that are at or before `currentX` (within epsilon tolerance)
 * 3. Return the first tab stop position strictly after `currentX`
 * 4. If no explicit tab stop found, add default tab interval to `currentX`
 *
 * The epsilon tolerance (TAB_EPSILON = 0.1px) handles floating-point rounding
 * errors from text measurement and ensures consistent tab stop snapping behavior.
 *
 * IMPORTANT: The tabStops array must be sorted in ascending order by position.
 * This requirement is enforced by buildTabStopsPx which relies on Engines.computeTabStops
 * to produce correctly ordered tab stops. The algorithm assumes sorted order for
 * correct tab stop selection and index advancement.
 *
 * @param currentX - Current horizontal cursor position in pixels (where text currently ends).
 *   This is the reference point from which to find the next tab stop.
 * @param tabStops - Array of explicit tab stops sorted by position in ascending order.
 *   Pre-computed by buildTabStopsPx with positions in pixels.
 * @param startIndex - Index in tabStops array to begin searching from (optimization to avoid
 *   re-scanning earlier tab stops). Typically incremented as tabs are consumed.
 * @returns Object containing:
 *   - target: The X position in pixels where the tab should advance to
 *   - nextIndex: The array index to start searching from for the next tab (startIndex + consumed stops)
 *   - stop: The resolved explicit tab stop (if any) including alignment/leader metadata
 *
 * @example
 * ```typescript
 * const tabStops = [{ pos: 48, val: 'left' }, { pos: 96, val: 'left' }];
 * const result = getNextTabStopPx(30, tabStops, 0);
 * // Returns: { target: 48, nextIndex: 1 }
 * // (next tab stop after position 30 is at 48px, search index advances to 1)
 *
 * const result2 = getNextTabStopPx(100, tabStops, 0);
 * // Returns: { target: 148, nextIndex: 2 }
 * // (no explicit tab after 100, falls back to 100 + default interval 48px)
 * ```
 */
const getNextTabStopPx = (
  currentX: number,
  tabStops: TabStopPx[],
  startIndex: number,
): { target: number; nextIndex: number; stop?: TabStopPx } => {
  while (startIndex < tabStops.length && tabStops[startIndex].pos <= currentX + TAB_EPSILON) {
    startIndex += 1;
  }
  if (startIndex < tabStops.length) {
    return {
      target: tabStops[startIndex].pos,
      nextIndex: startIndex + 1,
      stop: tabStops[startIndex],
    };
  }
  // default tab advance if we've exhausted explicit stops
  return { target: currentX + _DEFAULT_TAB_INTERVAL_PX, nextIndex: startIndex };
};

/**
 * Measures the pixel width of a slice of text within a run.
 *
 * Uses the HTML5 Canvas API to measure text width with the same precision as browser
 * text rendering. This is essential for accurate line breaking and layout calculations.
 * The measurement respects all text formatting properties (font family, size, bold, italic)
 * to produce pixel-accurate widths.
 *
 * Measurement approach:
 * - Primary: Uses canvas.measureText() for browser-accurate text measurement
 * - Fallback: Uses character count * 60% of font size for server-side rendering
 *
 * The fallback heuristic (0.6 * fontSize per character) is approximate and intended
 * only for non-browser environments where canvas is unavailable. It works reasonably
 * for Latin text in proportional fonts but will be less accurate for:
 * - Monospace fonts (should use 1.0 * fontSize)
 * - Wide characters (CJK scripts, emoji)
 * - Condensed/extended font variants
 *
 * @param run - The run containing text and formatting properties.
 * @param fromChar - Start character index (inclusive) within the run's text.
 * @param toChar - End character index (exclusive) within the run's text.
 * @returns Width of the text slice in pixels (floating-point precision for sub-pixel accuracy).
 */
function measureRunSliceWidth(run: Run, fromChar: number, toChar: number): number {
  if (isVanishedRun(run)) return 0;
  const context = getCtx();
  const fullText = runText(run);
  // Only TextRun and TabRun have textTransform property (via RunMarks)
  const transform = isTextRun(run) ? run.textTransform : undefined;
  const text = applyTextTransform(fullText.slice(fromChar, toChar), transform, fullText, fromChar);
  const textRun = isTextRun(run) ? run : null;
  const letterSpacing = textRun?.letterSpacing ?? 0;
  const horizontalScale = runHorizontalScale(run);
  if (!context) {
    // Fallback: simple proportional width (approximate)
    // When canvas context is unavailable (e.g., server-side rendering),
    // estimate character width as 60% of font size (size * 0.6).
    // This is a rough approximation based on typical proportional fonts like Arial:
    // - Average character width is ~0.5-0.7x the font size
    // - 0.6 is a middle ground that works reasonably for most Latin text
    // - For 16px font: estimated ~9.6px per character
    const size = textRun?.fontSize ?? 16;
    return Math.max(1, text.length * (size * 0.6) + Math.max(0, text.length - 1) * letterSpacing) * horizontalScale;
  }
  const font = fontString(run);
  const letterSpacingTotal = Math.max(0, text.length - 1) * letterSpacing;
  if (text.length === 1) {
    return (measureGlyphAdvance(context, font, text) + letterSpacingTotal) * horizontalScale;
  }
  return (measureSliceBaseWidth(context, font, text) + letterSpacingTotal) * horizontalScale;
}

const runHorizontalScale = (run: Run | undefined): number => {
  if (!run || !('horizontalScale' in run)) return 1;
  const value = run.horizontalScale;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 1;
};

const runLetterSpacing = (run: Run | undefined): number =>
  run && isTextRun(run) ? (run.letterSpacing ?? 0) * runHorizontalScale(run) : 0;

/**
 * Measurement summary for an aligned tab group contained within a single line.
 * Used to right/center/decimal align the grouped content to a tab stop.
 */
type TabAlignmentGroupMeasure = {
  /** Total width of all content in the tab group (in pixels) */
  totalWidth: number;
  /** Width of content before the decimal point (for decimal alignment) */
  beforeDecimalWidth?: number;
};

/**
 * Scan result for an aligned tab group across runs while reflowing text.
 * Provides width info plus where to resume line-breaking after the group.
 */
type TabAlignmentGroupScan = {
  /** Total width of all content in the tab group (in pixels) */
  totalWidth: number;
  /** Width of content before the decimal point (for decimal alignment) */
  beforeDecimalWidth?: number;
  /** Index of the last run included in this group */
  endRun: number;
  /** Character offset within the last run */
  endChar: number;
  /** Run index to resume scanning from after this group */
  resumeRun: number;
  /** Character offset to resume from within the resume run */
  resumeChar: number;
};

/**
 * Scans forward from a run/char position until the next tab or line break to
 * measure the width of the aligned tab group and capture resume positions.
 *
 * This function is used during line breaking to handle right, center, and decimal
 * tab alignments. It scans ahead to find all content that belongs to the tab group
 * (everything between this tab and the next tab or line break) and measures its
 * total width.
 *
 * For decimal tabs, it also tracks the position of the decimal separator to enable
 * alignment on that character.
 *
 * @param runs - Array of runs in the paragraph
 * @param startRunIndex - Index of the run to start scanning from
 * @param startChar - Character offset within the starting run
 * @param decimalSeparator - The decimal separator character ('.' or ',')
 * @returns Scan result with width measurements and resume positions
 */
const scanTabAlignmentGroup = (
  runs: Run[],
  startRunIndex: number,
  startChar: number,
  decimalSeparator: string,
): TabAlignmentGroupScan => {
  let totalWidth = 0;
  let beforeDecimalWidth: number | undefined;
  let foundDecimal = false;
  let endRun = startRunIndex;
  let endChar = startChar;

  for (let r = startRunIndex; r < runs.length; r += 1) {
    const run = runs[r];
    if (!run) continue;
    if (isVanishedRun(run)) continue;
    if (run.kind === 'tab') {
      return { totalWidth, beforeDecimalWidth, endRun, endChar, resumeRun: r, resumeChar: 0 };
    }
    if (isLineBreakRun(run)) {
      return { totalWidth, beforeDecimalWidth, endRun, endChar, resumeRun: r, resumeChar: 0 };
    }

    const text = runText(run);
    if (!text) {
      const runWidth = getRunWidth(run);
      if (runWidth > 0) {
        totalWidth += runWidth;
        endRun = r;
        endChar = 1;
      }
      continue;
    }

    const sliceStart = r === startRunIndex ? startChar : 0;
    if (sliceStart >= text.length) continue;
    const tabIndex = text.indexOf('\t', sliceStart);
    const effectiveEnd = tabIndex >= 0 ? tabIndex : text.length;

    if (effectiveEnd > sliceStart) {
      const sliceWidth = measureRunSliceWidth(run, sliceStart, effectiveEnd);
      if (!foundDecimal) {
        const decimalIndex = text.slice(sliceStart, effectiveEnd).indexOf(decimalSeparator);
        if (decimalIndex >= 0) {
          foundDecimal = true;
          const beforeWidth = decimalIndex > 0 ? measureRunSliceWidth(run, sliceStart, sliceStart + decimalIndex) : 0;
          beforeDecimalWidth = totalWidth + beforeWidth;
        }
      }
      totalWidth += sliceWidth;
      endRun = r;
      endChar = effectiveEnd;
    }

    if (tabIndex >= 0) {
      return { totalWidth, beforeDecimalWidth, endRun, endChar, resumeRun: r, resumeChar: tabIndex };
    }
  }

  return { totalWidth, beforeDecimalWidth, endRun, endChar, resumeRun: runs.length, resumeChar: 0 };
};

/**
 * Measures the width of the aligned tab group within the current line bounds.
 *
 * Similar to scanTabAlignmentGroup, but constrained to content that has already
 * been placed on a specific line. Used during the tab layout pass to calculate
 * positioning for right, center, and decimal aligned tabs.
 *
 * @param runs - Array of runs in the paragraph
 * @param line - The line containing the tab group
 * @param startRunIndex - Index of the run to start measuring from
 * @param startChar - Character offset within the starting run
 * @param decimalSeparator - The decimal separator character ('.' or ',')
 * @returns Measurement result with total and before-decimal widths
 */
const measureTabAlignmentGroupInLine = (
  runs: Run[],
  line: Line,
  startRunIndex: number,
  startChar: number,
  decimalSeparator: string,
): TabAlignmentGroupMeasure => {
  let totalWidth = 0;
  let beforeDecimalWidth: number | undefined;
  let foundDecimal = false;

  for (let r = startRunIndex; r <= line.toRun; r += 1) {
    const run = runs[r];
    if (!run) continue;
    if (isVanishedRun(run)) continue;
    if (run.kind === 'tab') break;
    if (isLineBreakRun(run)) break;

    const text = runText(run);
    if (!text) {
      totalWidth += getRunWidth(run);
      continue;
    }

    const sliceStart = r === startRunIndex ? startChar : 0;
    const sliceEnd = r === line.toRun ? line.toChar : text.length;
    if (sliceStart >= sliceEnd) continue;
    const slice = text.slice(sliceStart, sliceEnd);
    const tabIndex = slice.indexOf('\t');
    const effectiveSlice = tabIndex >= 0 ? slice.slice(0, tabIndex) : slice;
    const effectiveSliceEnd = tabIndex >= 0 ? sliceStart + tabIndex : sliceEnd;

    if (effectiveSlice.length > 0) {
      const sliceWidth = measureRunSliceWidth(run, sliceStart, effectiveSliceEnd);
      totalWidth += sliceWidth;
      if (!foundDecimal) {
        const decimalIndex = effectiveSlice.indexOf(decimalSeparator);
        if (decimalIndex >= 0) {
          foundDecimal = true;
          const beforeWidth = decimalIndex > 0 ? measureRunSliceWidth(run, sliceStart, sliceStart + decimalIndex) : 0;
          beforeDecimalWidth = totalWidth - sliceWidth + beforeWidth;
        }
      }
    }

    if (tabIndex >= 0) {
      break;
    }
  }

  return { totalWidth, beforeDecimalWidth };
};

/**
 * Applies tab stop layout to all lines, calculating segment positions and tab leaders.
 *
 * This is a post-processing pass that runs after initial line breaking. It handles:
 * - Right-aligned tabs: Content is positioned to end at the tab stop
 * - Center-aligned tabs: Content is centered on the tab stop
 * - Decimal-aligned tabs: Content is aligned on the decimal separator
 * - Tab leaders: Fills the space before aligned content with dots, dashes, etc.
 *
 * The function mutates the line objects to add:
 * - `segments`: Array of positioned text segments with explicit x coordinates
 * - `leaders`: Array of leader fill regions
 * - Updated `width` values
 *
 * @param lines - Array of lines to process
 * @param runs - Array of runs in the paragraph
 * @param tabStops - Array of tab stop positions and types (in pixels)
 * @param decimalSeparator - The decimal separator character for decimal tabs
 * @param indentLeft - Left indent value (in pixels)
 * @param firstLineTabOffset - First line offset used to resolve tab positions
 */
const applyTabLayoutToLines = (
  lines: Line[],
  runs: Run[],
  tabStops: TabStopPx[],
  decimalSeparator: string,
  indentLeft: number,
  firstLineTabOffset: number,
): void => {
  const totalTabRuns = runs.reduce((count, run) => (run.kind === 'tab' && !isVanishedRun(run) ? count + 1 : count), 0);
  const alignmentTabStopsPx = tabStops
    .map((stop, index) => ({ stop, index }))
    .filter(({ stop }) => stop.val === 'end' || stop.val === 'center' || stop.val === 'decimal');

  // Per-line-segment tab counts. Segments are delimited by explicit <w:br/> because
  // pPr/tabs apply per line, not per paragraph. sd-1480: "Page\t2<br/>Page\t5" must
  // bind the trailing tab of EACH segment to the alignment stop, not just the
  // paragraph-final tab.
  const tabSegmentInfo = new Map<number, { localOrdinal: number; segmentTotal: number }>();
  {
    let segmentTabRunIndices: number[] = [];
    const closeSegment = () => {
      const total = segmentTabRunIndices.length;
      segmentTabRunIndices.forEach((runIdx, ord) => {
        tabSegmentInfo.set(runIdx, { localOrdinal: ord, segmentTotal: total });
      });
      segmentTabRunIndices = [];
    };
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i];
      if (r.kind === 'lineBreak' || (r.kind === 'break' && (r as { breakType?: string }).breakType === 'line')) {
        closeSegment();
      } else if (r.kind === 'tab' && !isVanishedRun(r)) {
        segmentTabRunIndices.push(i);
      }
    }
    closeSegment();
  }

  // Word-compat heuristic (not ECMA-376 17.3.3.32): the last N tab characters in a
  // line bind to the last N explicit end/center/decimal stops. Needed for TOC
  // entries where a right-aligned dot-leader stop coexists with default grid stops.
  // Mirrored in measuring/dom/src/index.ts.
  const getAlignmentStopForOrdinal = (ordinal: number, runIdx?: number): { stop: TabStopPx; index: number } | null => {
    if (alignmentTabStopsPx.length === 0 || totalTabRuns === 0 || !Number.isFinite(ordinal)) return null;
    let scopeOrdinal = ordinal;
    let scopeTotal = totalTabRuns;
    if (runIdx !== undefined) {
      const info = tabSegmentInfo.get(runIdx);
      if (info) {
        scopeOrdinal = info.localOrdinal;
        scopeTotal = info.segmentTotal;
      }
    }
    if (scopeOrdinal < 0 || scopeOrdinal >= scopeTotal) return null;
    const remainingTabs = scopeTotal - scopeOrdinal - 1;
    const targetIndex = alignmentTabStopsPx.length - 1 - remainingTabs;
    if (targetIndex < 0 || targetIndex >= alignmentTabStopsPx.length) return null;
    return alignmentTabStopsPx[targetIndex];
  };
  let sequentialTabIndex = 0;
  const consumeTabOrdinal = (explicitIndex?: number): number => {
    if (typeof explicitIndex === 'number' && Number.isFinite(explicitIndex)) {
      sequentialTabIndex = Math.max(sequentialTabIndex, explicitIndex + 1);
      return explicitIndex;
    }
    const ordinal = sequentialTabIndex;
    sequentialTabIndex += 1;
    return ordinal;
  };

  lines.forEach((line, lineIndex) => {
    let cursorX = 0;
    let lineWidth = 0;
    let tabStopCursor = 0;
    let pendingTabAlignStartX: PendingTabAlignStart | null = null;
    const segments: NonNullable<Line['segments']> = [];
    const leaders: NonNullable<Line['leaders']> = [];
    const effectiveIndent = lineIndex === 0 ? indentLeft + firstLineTabOffset : indentLeft;
    const maxAbsWidth =
      typeof line.maxWidth === 'number' && Number.isFinite(line.maxWidth)
        ? line.maxWidth + effectiveIndent
        : Number.POSITIVE_INFINITY;

    /**
     * Processes a tab character, calculating position and handling alignment.
     */
    const applyTab = (
      startRunIndex: number,
      startChar: number,
      run?: Run,
      tabOrdinal?: number,
      tabRunIdx?: number,
    ): void => {
      const originX = cursorX;
      const absCurrentX = cursorX + effectiveIndent;
      let stop: TabStopPx | undefined;
      let target: number;
      // Mirror of measuring/dom: only force the SD-2447 heuristic when greedy
      // would land on a `source:default` stop (synthetic 0.5" grid). Explicit
      // start stops should win greedy.
      const greedy = getNextTabStopPx(absCurrentX, tabStops, tabStopCursor);
      const greedyOnDefault = greedy.stop?.source === 'default';
      const forcedAlignment =
        greedyOnDefault && typeof tabOrdinal === 'number' && Number.isFinite(tabOrdinal)
          ? getAlignmentStopForOrdinal(tabOrdinal, tabRunIdx)
          : null;
      if (forcedAlignment && forcedAlignment.stop.pos > absCurrentX + TAB_EPSILON) {
        stop = forcedAlignment.stop;
        target = forcedAlignment.stop.pos;
        tabStopCursor = forcedAlignment.index + 1;
      } else {
        stop = greedy.stop;
        target = greedy.target;
        tabStopCursor = greedy.nextIndex;
      }
      const clampedTarget = Number.isFinite(maxAbsWidth) ? Math.min(target, maxAbsWidth) : target;
      const relativeTarget = clampedTarget - effectiveIndent;
      const stopVal = stop?.val ?? 'start';
      const shouldCompensateNegativeLeft =
        stopVal === 'start' && indentLeft < 0 && effectiveIndent === indentLeft && stop?.source !== 'explicit';
      // `relativeTarget` is layout geometry and controls the tab run width.
      // `paintTarget` is explicit segment geometry consumed by the DOM painter,
      // which adds the current line indentOffset again. For negative-left body
      // lines, only compensate generated/default stops that advance from the
      // negative line origin. Authored explicit stops already have the same
      // geometry Word uses.
      const paintTarget = shouldCompensateNegativeLeft ? relativeTarget - Math.min(effectiveIndent, 0) : relativeTarget;
      const precedingTabEndX = shouldCompensateNegativeLeft ? relativeTarget : undefined;
      lineWidth = Math.max(lineWidth, relativeTarget);
      if (stop?.source === 'explicit') {
        line.hasExplicitTabStops = true;
      }
      let currentLeader: LeaderDecoration | null = null;

      // Add leader if specified
      if (stop?.leader && stop.leader !== 'none') {
        const from = Math.min(originX + effectiveIndent, clampedTarget);
        const to = Math.max(originX + effectiveIndent, clampedTarget);
        currentLeader = { from, to, style: stop.leader };
        leaders.push(currentLeader);
      }

      // Handle alignment types
      if (stopVal === 'end' || stopVal === 'center' || stopVal === 'decimal') {
        const groupMeasure = measureTabAlignmentGroupInLine(runs, line, startRunIndex, startChar, decimalSeparator);
        if (groupMeasure.totalWidth > 0) {
          let groupStartX: number;
          if (stopVal === 'end') {
            groupStartX = Math.max(0, relativeTarget - groupMeasure.totalWidth);
          } else if (stopVal === 'center') {
            groupStartX = Math.max(0, relativeTarget - groupMeasure.totalWidth / 2);
          } else {
            const beforeDecimal = groupMeasure.beforeDecimalWidth ?? groupMeasure.totalWidth;
            groupStartX = Math.max(0, relativeTarget - beforeDecimal);
          }

          // Update current leader "to" ensuring leaders end where right-aligned content begins
          if (currentLeader) {
            currentLeader.to = groupStartX + effectiveIndent;
          }

          pendingTabAlignStartX = {
            layoutX: groupStartX,
            paintX: groupStartX,
          };
        } else {
          cursorX = Math.max(cursorX, relativeTarget);
        }
      } else {
        cursorX = Math.max(cursorX, relativeTarget);
        // Keep start-tab text explicitly positioned to match measuring/dom.
        // Ordinary start tabs use the same layout and paint x; only compensated
        // negative-left generated/default tabs carry a distinct precedingTabEndX
        // for the painter's tab-span sizing.
        pendingTabAlignStartX = {
          layoutX: relativeTarget,
          paintX: paintTarget,
          ...(precedingTabEndX !== undefined ? { precedingTabEndX } : {}),
        };
      }

      // Set tab run width for rendering
      if (run && run.kind === 'tab') {
        (run as { width?: number }).width = Math.max(0, relativeTarget - originX);
      }
    };

    const consumePendingTabAlignStart = (): PendingTabAlignStart | null => {
      const pending = pendingTabAlignStartX;
      pendingTabAlignStartX = null;
      return pending;
    };

    for (let runIndex = line.fromRun; runIndex <= line.toRun; runIndex += 1) {
      const run = runs[runIndex];
      if (!run) continue;
      if (run.kind === 'tab') {
        if (isVanishedRun(run)) {
          (run as { width?: number }).width = 0;
          continue;
        }
        const tabRun = run as TabRun;
        const ordinal = consumeTabOrdinal(tabRun.tabIndex);
        applyTab(runIndex + 1, 0, run, ordinal, runIndex);
        continue;
      }

      const text = runText(run);
      if (!text) {
        cursorX += getRunWidth(run);
        lineWidth = Math.max(lineWidth, cursorX);
        continue;
      }

      const sliceStart = runIndex === line.fromRun ? line.fromChar : 0;
      const sliceEnd = runIndex === line.toRun ? line.toChar : text.length;
      if (sliceStart >= sliceEnd) continue;

      let segmentStart = sliceStart;
      for (let i = sliceStart; i < sliceEnd; i += 1) {
        if (text[i] !== '\t') continue;
        if (i > segmentStart) {
          const segmentWidth = measureRunSliceWidth(run, segmentStart, i);
          const segment: LineSegment = {
            runIndex,
            fromChar: segmentStart,
            toChar: i,
            width: segmentWidth,
          };
          const pendingTabAlign = consumePendingTabAlignStart();
          if (pendingTabAlign != null) {
            segment.x = pendingTabAlign.paintX;
            if (pendingTabAlign.precedingTabEndX !== undefined) {
              segment.precedingTabEndX = pendingTabAlign.precedingTabEndX;
            }
            cursorX = pendingTabAlign.layoutX + segmentWidth;
          } else {
            cursorX += segmentWidth;
          }
          lineWidth = Math.max(lineWidth, cursorX);
          segments.push(segment);
        }
        const ordinal = consumeTabOrdinal();
        applyTab(runIndex, i + 1, undefined, ordinal);
        segmentStart = i + 1;
      }

      if (segmentStart < sliceEnd) {
        const segmentWidth = measureRunSliceWidth(run, segmentStart, sliceEnd);
        const segment: LineSegment = {
          runIndex,
          fromChar: segmentStart,
          toChar: sliceEnd,
          width: segmentWidth,
        };
        const pendingTabAlign = consumePendingTabAlignStart();
        if (pendingTabAlign != null) {
          segment.x = pendingTabAlign.paintX;
          if (pendingTabAlign.precedingTabEndX !== undefined) {
            segment.precedingTabEndX = pendingTabAlign.precedingTabEndX;
          }
          cursorX = pendingTabAlign.layoutX + segmentWidth;
        } else {
          cursorX += segmentWidth;
        }
        lineWidth = Math.max(lineWidth, cursorX);
        segments.push(segment);
      }
    }

    if (segments.length > 0) {
      line.segments = segments;
    }
    if (leaders.length > 0) {
      line.leaders = leaders;
    }
    if (lineWidth > 0) {
      line.width = Math.max(line.width, lineWidth);
    }
  });
};

/**
 * Calculates the line height for a range of runs based on maximum font size and
 * paragraph spacing. This fast remeasurement path must match measuring/dom for
 * explicit OOXML spacing because column pagination depends on these line sums.
 */
const DEFAULT_AUTO_LINE_HEIGHT_MULTIPLIER = 1.15;

function resolveLineHeight(
  spacing: ParagraphSpacing | undefined,
  fontSize: number,
  fontFamily?: string,
  face?: FaceKey,
  text?: string,
  fontContext: FontMeasureContext = DEFAULT_FONT_MEASURE_CONTEXT,
): number {
  const calibratedMultiplier = fontFamily ? getCalibratedNaturalSingleLine(fontFamily, 1) : undefined;
  const embeddedMultiplier =
    calibratedMultiplier == null && fontFamily && face
      ? fontContext.resolveNaturalLineMultiplier?.(fontFamily, face, text ?? '')
      : undefined;
  const defaultLineHeight = Math.max(
    fontSize * DEFAULT_AUTO_LINE_HEIGHT_MULTIPLIER,
    fontSize * (calibratedMultiplier ?? embeddedMultiplier ?? 0),
  );
  if (!spacing || spacing.line == null) {
    return defaultLineHeight;
  }

  let computedHeight = spacing.line;
  if (spacing.lineUnit === 'multiplier') {
    computedHeight *= defaultLineHeight;
  }

  const lineRule = spacing.lineRule ?? 'auto';
  if (lineRule === 'exact') {
    return computedHeight;
  }
  if (lineRule === 'atLeast') {
    return Math.max(computedHeight, defaultLineHeight);
  }
  if (spacing.lineUnit === 'multiplier') {
    return computedHeight;
  }
  return Math.max(computedHeight, defaultLineHeight);
}

function lineHeightForRuns(
  runs: Run[],
  fromRun: number,
  toRun: number,
  fallbackFontSize: number = 16,
  spacing?: ParagraphSpacing,
  fontContext: FontMeasureContext = DEFAULT_FONT_MEASURE_CONTEXT,
): number {
  let maxLineHeight = 0;
  for (let i = fromRun; i <= toRun; i += 1) {
    const run = runs[i];
    const size = visibleLineHeightFontSize(run) ?? 0;
    if (size <= 0) continue;
    const metricRun = run as TextRun | TabRun | undefined;
    const family = typeof metricRun?.fontFamily === 'string' ? metricRun.fontFamily : undefined;
    const face: FaceKey | undefined = metricRun
      ? { weight: metricRun.bold ? '700' : '400', style: metricRun.italic ? 'italic' : 'normal' }
      : undefined;
    maxLineHeight = Math.max(
      maxLineHeight,
      resolveLineHeight(spacing, size, family, face, metricRun?.text, fontContext),
    );
  }
  return maxLineHeight > 0 ? maxLineHeight : resolveLineHeight(spacing, fallbackFontSize);
}

type RegionCursor = { runIndex: number; charIndex: number };

type RegionRunMap = {
  sourceRunIndex: number;
  sourceCharOffset: number;
};

const normalizeRegionCursor = (runs: Run[], cursor: RegionCursor): RegionCursor => {
  let { runIndex, charIndex } = cursor;
  while (runIndex < runs.length) {
    const text = runText(runs[runIndex]);
    if (charIndex < text.length) break;
    runIndex += 1;
    charIndex = 0;
  }
  return { runIndex, charIndex };
};

/**
 * Compose a physical line from multiple disjoint horizontal regions.
 *
 * The fast measurer's normal loop owns one contiguous width. Centered
 * `wrapText="bothSides"` floats need two independent word-wrapping widths on
 * the same baseline, so this deliberately reuses that loop once per region and
 * maps each first-line result back onto the original runs. The supported path
 * is intentionally narrow: plain left-aligned text with no tabs, lists,
 * indents, inline boxes, or non-text runs. Unsupported paragraphs fall back to
 * the single largest safe region in the caller rather than painting through a
 * float.
 */
function remeasurePlainTextAcrossRegions(
  block: ParagraphBlock,
  maxWidth: number,
  firstLineIndent: number,
  lineRegions: readonly (readonly ParagraphLineRegion[])[],
  fontContext: FontMeasureContext,
): ParagraphMeasure | null {
  const attrs = block.attrs;
  const internalAttrs = attrs as ParagraphBlockAttrs | undefined;
  const indent = internalAttrs?.indent;
  const hasUnsupportedIndent = [indent?.left, indent?.right, indent?.hanging].some(
    (value) => typeof value === 'number' && Math.abs(value) > 0.01,
  );
  const hasMultipleRegions = lineRegions.some((regions) => regions.length > 1);
  const unsupported =
    !hasMultipleRegions ||
    Math.abs(firstLineIndent) > 0.01 ||
    hasUnsupportedIndent ||
    Boolean(internalAttrs?.wordLayout) ||
    Boolean(internalAttrs?.numberingProperties) ||
    Boolean(internalAttrs?.tabs?.length) ||
    Boolean(block.inlineBoxes?.length) ||
    (attrs?.alignment != null && attrs.alignment !== 'left') ||
    getParagraphInlineDirection(attrs) === 'rtl' ||
    block.runs.some(
      (run) =>
        !isTextRun(run) ||
        isEmptySdtPlaceholderRun(run) ||
        run.bidi != null ||
        run.textTransform === 'capitalize' ||
        (typeof run.text === 'string' && run.text.includes('\t')),
    );
  if (unsupported) return null;

  const makeRemainingBlock = (cursor: RegionCursor): { block: ParagraphBlock; maps: RegionRunMap[] } | null => {
    const slicedRuns: TextRun[] = [];
    const maps: RegionRunMap[] = [];
    for (let sourceRunIndex = cursor.runIndex; sourceRunIndex < block.runs.length; sourceRunIndex += 1) {
      const sourceRun = block.runs[sourceRunIndex];
      if (!isTextRun(sourceRun)) return null;
      const sourceCharOffset = sourceRunIndex === cursor.runIndex ? cursor.charIndex : 0;
      if (sourceCharOffset >= sourceRun.text.length) continue;
      slicedRuns.push({
        ...sourceRun,
        text: sourceRun.text.slice(sourceCharOffset),
        pmStart: sourceRun.pmStart == null ? undefined : sourceRun.pmStart + sourceCharOffset,
      });
      maps.push({ sourceRunIndex, sourceCharOffset });
    }
    if (slicedRuns.length === 0) return null;
    return {
      block: {
        ...block,
        id: `${block.id}:float-regions`,
        runs: slicedRuns,
        attrs: block.attrs ? { ...block.attrs, indent: undefined } : undefined,
        inlineBoxes: undefined,
      },
      maps,
    };
  };

  const lines: Line[] = [];
  let cursor = normalizeRegionCursor(block.runs, { runIndex: 0, charIndex: 0 });
  const runOffsets: number[] = [];
  let plainText = '';
  for (const run of block.runs) {
    runOffsets.push(plainText.length);
    plainText += runText(run);
  }
  const cursorOffset = (value: RegionCursor): number =>
    (runOffsets[value.runIndex] ?? plainText.length) + value.charIndex;
  const totalAddressableChars = block.runs.reduce((sum, run) => sum + runText(run).length, 0);
  const maxPhysicalLines = Math.max(1, totalAddressableChars + 1);

  for (let physicalLineIndex = 0; cursor.runIndex < block.runs.length; physicalLineIndex += 1) {
    if (physicalLineIndex >= maxPhysicalLines) return null;
    const authoredRegions = lineRegions[physicalLineIndex];
    const regions = (authoredRegions?.length ? authoredRegions : [{ offsetX: 0, width: maxWidth }]).filter(
      (region) => Number.isFinite(region.offsetX) && Number.isFinite(region.width) && region.width > 0,
    );
    if (regions.length === 0) return null;

    const lineStart = { ...cursor };
    const segments: LineSegment[] = [];
    let lineWidth = 0;
    let lineHeight = 0;
    let lineAscent = 0;
    let lineDescent = 0;
    let consumedRegion = false;

    const firstLineOffset =
      physicalLineIndex === 0 ? Math.max(0, (indent?.firstLine ?? 0) - (indent?.hanging ?? 0)) : 0;

    for (const [regionIndex, region] of regions.entries()) {
      const remaining = makeRemainingBlock(cursor);
      if (!remaining) break;
      const regionOriginAdjustment = regionIndex === 0 ? 0 : firstLineOffset;
      const regionMeasureWidth = Math.max(1, region.width - (regionIndex === 0 ? firstLineOffset : 0));
      const regionMeasure = remeasureParagraph(remaining.block, regionMeasureWidth, 0, undefined, fontContext);
      const regionLine = regionMeasure.lines[0];
      if (!regionLine) break;

      const fromMap = remaining.maps[regionLine.fromRun];
      const toMap = remaining.maps[regionLine.toRun];
      if (!fromMap || !toMap) return null;
      const regionFirstSegmentIndex = segments.length;

      for (let slicedRunIndex = regionLine.fromRun; slicedRunIndex <= regionLine.toRun; slicedRunIndex += 1) {
        const map = remaining.maps[slicedRunIndex];
        const slicedRun = remaining.block.runs[slicedRunIndex];
        if (!map || !slicedRun) return null;
        const localFrom = slicedRunIndex === regionLine.fromRun ? regionLine.fromChar : 0;
        const localTo = slicedRunIndex === regionLine.toRun ? regionLine.toChar : runText(slicedRun).length;
        if (localTo <= localFrom) continue;
        segments.push({
          runIndex: map.sourceRunIndex,
          fromChar: map.sourceCharOffset + localFrom,
          toChar: map.sourceCharOffset + localTo,
          width: measureRunSliceWidth(slicedRun, localFrom, localTo),
          ...(segments.length === regionFirstSegmentIndex ? { x: region.offsetX - regionOriginAdjustment } : {}),
        });
      }

      const nextCursor = normalizeRegionCursor(block.runs, {
        runIndex: toMap.sourceRunIndex,
        charIndex: toMap.sourceCharOffset + regionLine.toChar,
      });
      if (nextCursor.runIndex === cursor.runIndex && nextCursor.charIndex === cursor.charIndex) return null;

      // Word does not strand the leading characters of a word in a tiny
      // wrap-both-sides sliver when a wider region remains on the same
      // baseline. The normal single-width measurer must force-break a word
      // when even its first token cannot fit, so detect that narrow case and
      // leave the cursor untouched for the later region. Regions that fit a
      // whole token, or that are already the largest remaining option, retain
      // the existing multi-region composition behavior.
      const startOffset = cursorOffset(cursor);
      const endOffset = cursorOffset(nextCursor);
      const firstTokenStart = plainText.slice(startOffset).search(/\S/);
      const firstTokenEnd =
        firstTokenStart < 0
          ? startOffset
          : (() => {
              const tokenTail = plainText.slice(startOffset + firstTokenStart);
              const whitespaceOffset = tokenTail.search(/\s/);
              return whitespaceOffset < 0 ? plainText.length : startOffset + firstTokenStart + whitespaceOffset;
            })();
      const forceBreaksLeadingToken =
        firstTokenStart >= 0 && endOffset > startOffset + firstTokenStart && endOffset < firstTokenEnd;
      const hasLargerRemainingRegion = regions
        .slice(regionIndex + 1)
        .some((candidate) => candidate.width > region.width + 0.5);
      if (forceBreaksLeadingToken && hasLargerRemainingRegion) {
        segments.splice(regionFirstSegmentIndex);
        continue;
      }

      cursor = nextCursor;
      consumedRegion = true;
      lineWidth = Math.max(lineWidth, region.offsetX - regionOriginAdjustment + regionLine.width);
      lineHeight = Math.max(lineHeight, regionLine.lineHeight);
      lineAscent = Math.max(lineAscent, regionLine.ascent);
      lineDescent = Math.max(lineDescent, regionLine.descent);
      if (cursor.runIndex >= block.runs.length) break;
    }

    if (!consumedRegion || segments.length === 0) return null;
    const lineEnd = segments[segments.length - 1]!;
    lines.push({
      fromRun: lineStart.runIndex,
      fromChar: lineStart.charIndex,
      toRun: lineEnd.runIndex,
      toChar: lineEnd.toChar,
      width: lineWidth,
      ascent: lineAscent,
      descent: lineDescent,
      lineHeight,
      maxWidth: Math.max(...regions.map((region) => region.offsetX + region.width)) - firstLineOffset,
      segments,
    });
  }

  return {
    kind: 'paragraph',
    lines,
    totalHeight: lines.reduce((sum, line) => sum + line.lineHeight, 0),
    measuredAtMaxWidth: maxWidth,
  };
}

/**
 * Re-measure a paragraph block to fit within a specified maximum width.
 *
 * This function performs fast, canvas-based text measurement and line breaking for
 * paragraphs that need to be reflowed due to column width changes (e.g., when a
 * document transitions from single-column to multi-column layout, or when floating
 * images reduce available width). It implements a greedy line-breaking algorithm
 * with support for tab stops, indentation, and word wrapping.
 *
 * Why remeasurement is needed:
 * - Paragraphs are initially measured at document load for the widest column width
 * - When placed in narrower columns, text must reflow to fit the reduced width
 * - Floating images can further reduce available width, requiring dynamic remeasurement
 * - Remeasurement is expensive, so it's only performed when necessary (width changes)
 *
 * Measurement approach:
 * - Uses HTML5 Canvas API for accurate text width measurement (same as initial measurement)
 * - Performs greedy word-based line breaking (breaks at whitespace when text exceeds maxWidth)
 * - Respects paragraph indents (left, right, firstLine, hanging)
 * - Processes tab stops using OOXML tab stop resolution algorithm
 * - Falls back to estimated widths if canvas context is unavailable (server-side rendering)
 *
 * Limitations:
 * - Does NOT perform full typography measurement (ascent, descent, font metrics)
 * - Line height is estimated from paragraph spacing and max font size.
 * - Does NOT handle complex features like drop caps, justified alignment compression, or bidirectional text
 * - Intended as a fast path for width-constrained remeasurement, not full initial measurement
 *
 * @param block - The paragraph block to measure, containing runs of text/tabs/images and formatting attributes.
 *   Must have a valid runs array with text runs that have fontSize and fontFamily properties.
 * @param maxWidth - Maximum available width in pixels for the paragraph content.
 *   This should be the column width minus left and right indents, adjusted for any floating images.
 *   Must be a positive number for meaningful line breaking.
 * @param firstLineIndent - Additional indent to apply to the first line in pixels (default: 0).
 *   Used for in-flow list markers in firstLineIndentMode where the marker consumes horizontal space
 *   on the first line. For standard hanging indent lists, this should be 0 as the marker is positioned
 *   absolutely outside the text flow.
 * @returns A ParagraphMeasure object containing:
 *   - kind: 'paragraph' (discriminator for measure type)
 *   - lines: Array of Line objects with fromRun/toRun/fromChar/toChar boundaries, width, and lineHeight
 *   - totalHeight: Sum of all line heights in pixels
 *   Note: Does NOT include full typography metrics (ascent, descent) - these are computed by the full measurer
 *
 * @throws Does not throw exceptions, but will produce degraded output if:
 *   - maxWidth is zero or negative (lines will be very narrow or degenerate)
 *   - block.runs is empty or invalid (will produce empty or minimal measure)
 *   - Canvas context is unavailable (will use fallback width estimation)
 *
 * @example
 * ```typescript
 * const block: ParagraphBlock = {
 *   kind: 'paragraph',
 *   id: 'p1',
 *   runs: [
 *     { text: 'Hello world', fontFamily: 'Arial', fontSize: 16 }
 *   ],
 *   attrs: {
 *     indent: { left: 20, right: 20, firstLine: 0, hanging: 0 }
 *   }
 * };
 *
 * // Remeasure for a narrower column width
 * const measure = remeasureParagraph(block, 200);
 * // Returns: { kind: 'paragraph', lines: [...], totalHeight: 38.4 }
 * // (text breaks into 2 lines of ~19.2px each)
 *
 * // Remeasure with first line indent for list marker
 * const measureWithIndent = remeasureParagraph(block, 200, 30);
 * // First line has only 170px available (200 - 30), subsequent lines have full 200px
 * ```
 */
export function remeasureParagraph(
  block: ParagraphBlock,
  maxWidth: number,
  firstLineIndent: number = 0,
  lineRegions?: readonly (readonly ParagraphLineRegion[])[],
  fontContext: FontMeasureContext = DEFAULT_FONT_MEASURE_CONTEXT,
): ParagraphMeasure {
  // Input validation: maxWidth must be positive
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) {
    throw new Error(`remeasureParagraph: maxWidth must be a positive number, got ${maxWidth}`);
  }

  // Input validation: firstLineIndent must be a finite number
  if (!Number.isFinite(firstLineIndent)) {
    throw new Error(`remeasureParagraph: firstLineIndent must be a finite number, got ${firstLineIndent}`);
  }

  // Input validation: block must be defined
  if (!block) {
    throw new Error('remeasureParagraph: block must be defined');
  }

  // Input validation: block.runs must be an array
  if (!Array.isArray(block.runs)) {
    throw new Error(`remeasureParagraph: block.runs must be an array, got ${typeof block.runs}`);
  }

  if (lineRegions?.some((regions) => regions.length > 1)) {
    const composedMeasure = remeasurePlainTextAcrossRegions(block, maxWidth, firstLineIndent, lineRegions, fontContext);
    if (composedMeasure) return composedMeasure;
  }

  // Complex paragraphs that cannot safely compose disjoint regions must stay
  // wholly on one side of the float. Pick the largest region and preserve its
  // offset; painting through the excluded band is never an acceptable fallback.
  const resolvedLineRegions = lineRegions?.map((regions) => {
    const valid = regions.filter(
      (region) => Number.isFinite(region.offsetX) && Number.isFinite(region.width) && region.width > 0,
    );
    if (valid.length <= 1) return valid;
    return [valid.reduce((largest, region) => (region.width > largest.width ? region : largest))];
  });

  if (block.inlineBoxes?.length) {
    console.warn(
      `layout.inline-box-remeasure-unsupported: dropped ${block.inlineBoxes.length} inline box(es) from paragraph ${block.id}`,
    );
    block = { ...block, inlineBoxes: undefined };
  }

  const runs = block.runs ?? [];
  const lines: Line[] = [];
  const attrs = block.attrs as ParagraphBlockAttrs | undefined;
  const indent = attrs?.indent;
  const wordLayout = attrs?.wordLayout;
  const spacing = attrs?.spacing;
  // Preserve finite negative indents for paragraph width geometry. This mirrors
  // measuring/dom: negative indents expand the usable line width into the margin
  // area, so tab cursor math and tab clamp bounds stay in the same coordinate space.
  const rawIndentLeft = typeof indent?.left === 'number' && Number.isFinite(indent.left) ? indent.left : 0;
  const rawIndentRight = typeof indent?.right === 'number' && Number.isFinite(indent.right) ? indent.right : 0;
  const indentLeft = rawIndentLeft;
  const indentRight = rawIndentRight;
  const indentFirstLine = Math.max(0, indent?.firstLine ?? 0);
  const indentHanging = Math.max(0, indent?.hanging ?? 0);
  // Match measuring/dom/src/index.ts: `suppressFirstLineIndent` is a Word quirk where
  // justified paragraphs ignore their first-line indent. Without honoring it here, the
  // initial measure and remeasure (triggered by live editing, resize, etc.) produce
  // different first-line offsets and the first line jumps on redraw.
  const suppressFirstLine = attrs?.suppressFirstLineIndent === true;
  const baseFirstLineOffset = suppressFirstLine ? 0 : firstLineIndent || indentFirstLine - indentHanging;
  // When wordLayout is present, the hanging region is occupied by the list marker/tab,
  // so keep the same available width as body lines. For normal paragraphs we must honor
  // negative offsets (hanging indent) so the first line can extend into the hanging region.
  const clampedFirstLineOffset = Math.max(0, baseFirstLineOffset);
  // Avoid widening the first line when a negative LEFT indent already expands the content area.
  // Negative right indent doesn't cause this problem — it only extends rightward.
  const hasNegativeLeftIndent = rawIndentLeft < 0;
  const allowNegativeFirstLineOffset = !wordLayout?.marker && !hasNegativeLeftIndent && baseFirstLineOffset < 0;
  const effectiveFirstLineOffset = wordLayout?.marker
    ? 0
    : allowNegativeFirstLineOffset
      ? baseFirstLineOffset
      : clampedFirstLineOffset;
  const contentWidth = Math.max(1, maxWidth - indentLeft - indentRight);
  // Shared helper is the canonical source for list text-start geometry.
  // Keep an explicit top-level fallback for producers that only provide textStartPx.
  const textStartPx = wordLayout?.textStartPx;
  // Track measured marker text width for returning in measure.marker
  let measuredMarkerTextWidth: number | undefined;
  const resolvedTextStartPx = resolveListTextStartPx(
    wordLayout,
    indentLeft,
    indentFirstLine,
    indentHanging,
    (markerText, marker) => {
      const context = getCtx();
      if (!context) return 0;
      context.font = markerFontString(marker.run);
      const width = context.measureText(markerText).width;
      measuredMarkerTextWidth = width;
      return width;
    },
  );
  const effectiveTextStartPx = resolvedTextStartPx ?? textStartPx;
  const hasResolvedTextStartPx = typeof resolvedTextStartPx === 'number' && Number.isFinite(resolvedTextStartPx);
  const shouldUseListTextStartWidth =
    typeof effectiveTextStartPx === 'number' &&
    (hasResolvedTextStartPx ? effectiveTextStartPx !== indentLeft : effectiveTextStartPx > indentLeft);
  // If numbering defines only a firstLine indent with no left/hanging, treat it as a hanging-style layout:
  // don't shrink available width in columns (matches Word which positions marker + tab but leaves normal text width).
  // IMPORTANT: If a list marker is present, the marker+tab are rendered inline, so we MUST
  // shrink the first-line width to match the painter's availableWidth.
  const treatAsHanging = !wordLayout?.marker && effectiveTextStartPx && indentLeft === 0 && indentHanging === 0;
  const firstLineWidth =
    shouldUseListTextStartWidth && !treatAsHanging
      ? Math.max(1, maxWidth - effectiveTextStartPx - indentRight)
      : Math.max(1, contentWidth - effectiveFirstLineOffset);
  const tabStops = buildTabStopsPx(indent as ParagraphIndent | undefined, attrs?.tabs, attrs?.tabIntervalTwips);
  const decimalSeparator = sanitizeDecimalSeparator(attrs?.decimalSeparator);
  // Standard Word list markers are painted in the hanging region while first-line
  // text starts at indentLeft. Applying the negative hanging offset again when
  // resolving inline tabs shifts every authored stop to the right by that amount.
  // Positive first-line list layouts still resolve tabs from their in-flow origin.
  const firstLineTabOffset = wordLayout?.marker && baseFirstLineOffset < 0 ? 0 : baseFirstLineOffset;

  let currentRun = 0;
  let currentChar = 0;
  // Match measuring/dom behavior: prefer the first visible text run for leading
  // break fallback, but allow a visible tab run when the paragraph has no visible
  // sized text.
  let firstTextFontSize: number | undefined;
  for (const run of runs) {
    firstTextFontSize = visibleTextFontSize(run);
    if (firstTextFontSize !== undefined) break;
  }
  let firstRunFontSize = firstTextFontSize;
  if (firstRunFontSize === undefined) {
    for (const run of runs) {
      firstRunFontSize = visibleLineHeightFontSize(run);
      if (firstRunFontSize !== undefined) break;
    }
  }
  let lastMeasuredFontSize = firstRunFontSize ?? 16;

  while (currentRun < runs.length) {
    const isFirstLine = lines.length === 0;
    // For first line, reduce available width by textStart/first-line offset (e.g., for in-flow list markers)
    const ordinaryLineWidth = Math.max(1, isFirstLine ? firstLineWidth : contentWidth);
    const regionsForLine = resolvedLineRegions?.[lines.length]?.filter(
      (region) => Number.isFinite(region.offsetX) && Number.isFinite(region.width) && region.width > 0,
    );
    const regionWidth = regionsForLine?.reduce((sum, region) => sum + region.width, 0);
    const effectiveMaxWidth = Math.max(
      1,
      regionWidth != null && regionWidth > 0 ? Math.min(ordinaryLineWidth, regionWidth) : ordinaryLineWidth,
    );
    const effectiveIndent = isFirstLine ? indentLeft + firstLineTabOffset : indentLeft;
    const startRun = currentRun;
    const startChar = currentChar;
    let width = 0;
    // Track the measured width at the last valid break point (space/tab/hyphen).
    // When we wrap back to that break point, we must rewind width to avoid
    // counting overflow content in the stored line width (which would zero-out justify slack).
    let widthAtLastBreak = -1;
    let lastBreakRun = -1;
    let lastBreakChar = -1;
    // Latest inter-ideograph break opportunity passed on this line, tracked
    // separately from the space-delimited one so CJK can break where CJK breaks.
    let widthAtLastCjkBreak = -1;
    let lastCjkBreakRun = -1;
    let lastCjkBreakChar = -1;
    let endRun = currentRun;
    let endChar = currentChar;
    let tabStopCursor = 0;
    let hasAuthoredTabStop = false;
    let didBreakInThisLine = false;
    let explicitLineBreakRun = -1;
    let resumeRun = -1;
    let resumeChar = 0;
    let lineMaxTextFontSize = 0;
    let lineMaxImageHeight = 0;
    let previousRunLetterSpacing = 0;
    const lineImageCandidates: RemeasureImageCandidate[] = [];

    for (let r = currentRun; r < runs.length; r += 1) {
      const run = runs[r];
      if (isLineBreakRun(run)) {
        explicitLineBreakRun = r;
        if (startRun === r && startChar === 0 && width === 0) {
          // Preserve leading/manual explicit break as an empty line.
          endRun = r;
          endChar = 0;
        }
        didBreakInThisLine = true;
        break;
      }
      if (isVanishedRun(run)) {
        endRun = r;
        endChar = runAddressableLength(run);
        previousRunLetterSpacing = 0;
        continue;
      }
      if (run.kind === 'tab') {
        const absCurrentX = width + effectiveIndent;
        const { target, nextIndex, stop } = getNextTabStopPx(absCurrentX, tabStops, tabStopCursor);
        if (stop?.source === 'explicit') hasAuthoredTabStop = true;
        const maxAbsWidth = effectiveMaxWidth + effectiveIndent;
        const clampedTarget = Math.min(target, maxAbsWidth);
        const tabAdvance = Math.max(0, clampedTarget - absCurrentX);
        width += tabAdvance;
        tabStopCursor = nextIndex;
        if (stop && (stop.val === 'end' || stop.val === 'center' || stop.val === 'decimal')) {
          const group = scanTabAlignmentGroup(runs, r + 1, 0, decimalSeparator);
          if (group.totalWidth > 0) {
            const relativeTarget = clampedTarget - effectiveIndent;
            let groupStartX: number;
            if (stop.val === 'end') {
              groupStartX = Math.max(0, relativeTarget - group.totalWidth);
            } else if (stop.val === 'center') {
              groupStartX = Math.max(0, relativeTarget - group.totalWidth / 2);
            } else {
              const beforeDecimal = group.beforeDecimalWidth ?? group.totalWidth;
              groupStartX = Math.max(0, relativeTarget - beforeDecimal);
            }
            const rightEdge = stop.val === 'end' ? relativeTarget : groupStartX + group.totalWidth;
            width = Math.max(width, rightEdge);
            endRun = group.endRun;
            endChar = group.endChar;
            lastBreakRun = group.endRun;
            lastBreakChar = group.endChar;
            widthAtLastBreak = width;

            if (group.resumeRun >= runs.length) {
              didBreakInThisLine = true;
              break;
            }
            if (group.resumeRun > r) {
              resumeRun = group.resumeRun;
              resumeChar = group.resumeChar;
              r = resumeRun - 1;
              continue;
            }
          }
        }
        endRun = r;
        endChar = 1; // tab is treated as a single character
        lastBreakRun = r;
        lastBreakChar = 1;
        widthAtLastBreak = width;
        previousRunLetterSpacing = 0;
        continue;
      }
      const text = runText(run);
      const start = r === currentRun ? currentChar : r === resumeRun ? resumeChar : 0;
      if (r === resumeRun) {
        resumeRun = -1;
      }
      if (text.length > 0 && isTextRun(run)) {
        lineMaxTextFontSize = Math.max(lineMaxTextFontSize, run.fontSize ?? 16);
      }
      if (isEmptySdtPlaceholderRun(run)) {
        const placeholderWidth = text.length > 0 ? measureRunSliceWidth(run, 0, text.length) : 0;
        if (width > 0 && width + placeholderWidth > effectiveMaxWidth - WIDTH_FUDGE_PX) {
          didBreakInThisLine = true;
          break;
        }
        width += placeholderWidth;
        endRun = r;
        endChar = text.length > 0 ? text.length : start + 1;
        previousRunLetterSpacing = runLetterSpacing(run);
        continue;
      }
      if (isImageRun(run)) {
        // Inline images are atomic. Preserve their width in reflow (they were
        // previously dropped because runText() is empty) and record a candidate
        // so reflowed lines keep the same baseline-vs-top decision as initial
        // measurement.
        const imageWidth = run.width + (run.distLeft ?? 0) + (run.distRight ?? 0);
        if (width > 0 && width + imageWidth > effectiveMaxWidth - WIDTH_FUDGE_PX) {
          didBreakInThisLine = true;
          break;
        }
        width += imageWidth;
        endRun = r;
        endChar = 1;
        const imageHeight = run.height + (run.distTop ?? 0) + (run.distBottom ?? 0);
        lineMaxImageHeight = Math.max(lineMaxImageHeight, imageHeight);
        lineImageCandidates.push(makeRemeasureImageCandidate(r, run, imageWidth, imageHeight));
        previousRunLetterSpacing = 0;
        continue;
      }
      // Hot line-breaking loop: hoist per-run invariants so each character costs
      // one glyph-cache lookup instead of a font-string rebuild + ctx.font
      // assignment + measureText call (see the text-width cache block above).
      const charMeasureContext = getCtx();
      const runFont = fontString(run);
      const runTransform = isTextRun(run) ? run.textTransform : undefined;
      const runScale = runHorizontalScale(run);
      const runLetterSpacingPx = runLetterSpacing(run);
      // Mirrors the no-canvas fallback in measureRunSliceWidth for a single char.
      const runFallbackCharWidth = Math.max(1, ((isTextRun(run) ? run.fontSize : undefined) ?? 16) * 0.6) * runScale;
      /** Width of `text[from, to)` under this run, for kinsoku boundary adjustments. */
      const measureCharRange = (from: number, to: number): number => {
        let total = 0;
        for (let i = from; i < to; i = nextCodePointBoundary(text, i)) {
          const advance = charMeasureContext
            ? measureGlyphAdvance(
                charMeasureContext,
                runFont,
                transformChar(text, i, runTransform, nextCodePointBoundary(text, i)),
              ) * runScale
            : runFallbackCharWidth;
          total += advance + runLetterSpacingPx;
        }
        return total;
      };
      // Astral characters (CJK extension planes) are two UTF-16 units, so the
      // cursor advances by code point: measuring or breaking on half a surrogate
      // pair both mis-measures the glyph and emits invalid ranges.
      for (let c = start, chEnd = nextCodePointBoundary(text, start); c < text.length; c = chEnd) {
        chEnd = nextCodePointBoundary(text, c);
        const ch = text.slice(c, chEnd);
        if (ch === '\t') {
          const absCurrentX = width + effectiveIndent;
          const { target, nextIndex, stop } = getNextTabStopPx(absCurrentX, tabStops, tabStopCursor);
          if (stop?.source === 'explicit') hasAuthoredTabStop = true;
          const maxAbsWidth = effectiveMaxWidth + effectiveIndent;
          const clampedTarget = Math.min(target, maxAbsWidth);
          const tabAdvance = Math.max(0, clampedTarget - absCurrentX);
          width += tabAdvance;
          tabStopCursor = nextIndex;
          if (stop && (stop.val === 'end' || stop.val === 'center' || stop.val === 'decimal')) {
            const group = scanTabAlignmentGroup(runs, r, chEnd, decimalSeparator);
            if (group.totalWidth > 0) {
              const relativeTarget = clampedTarget - effectiveIndent;
              let groupStartX: number;
              if (stop.val === 'end') {
                groupStartX = Math.max(0, relativeTarget - group.totalWidth);
              } else if (stop.val === 'center') {
                groupStartX = Math.max(0, relativeTarget - group.totalWidth / 2);
              } else {
                const beforeDecimal = group.beforeDecimalWidth ?? group.totalWidth;
                groupStartX = Math.max(0, relativeTarget - beforeDecimal);
              }
              const rightEdge = stop.val === 'end' ? relativeTarget : groupStartX + group.totalWidth;
              width = Math.max(width, rightEdge);
              endRun = group.endRun;
              endChar = group.endChar;
              lastBreakRun = group.endRun;
              lastBreakChar = group.endChar;
              widthAtLastBreak = width;

              if (group.resumeRun >= runs.length) {
                didBreakInThisLine = true;
                break;
              }
              if (group.resumeRun > r) {
                resumeRun = group.resumeRun;
                resumeChar = group.resumeChar;
                r = resumeRun - 1;
                break;
              }
              if (group.resumeRun === r) {
                chEnd = group.resumeChar;
                continue;
              }
            }
          }
          endRun = r;
          endChar = chEnd;
          lastBreakRun = r;
          lastBreakChar = chEnd;
          widthAtLastBreak = width;
          previousRunLetterSpacing = 0;
          continue;
        }
        const spacingBeforeChar = width > 0 ? (c === start ? previousRunLetterSpacing : runLetterSpacingPx) : 0;
        const glyphWidth = charMeasureContext
          ? measureGlyphAdvance(charMeasureContext, runFont, transformChar(text, c, runTransform, chEnd)) * runScale
          : runFallbackCharWidth;
        const w = spacingBeforeChar + glyphWidth;
        // Word accepts a trailing glyph that lands within the reciprocal
        // subpixel tolerance after an authored tab stop. The explicit stop is
        // part of the paragraph's layout contract, so reserving another 0.5px
        // after it falsely wraps narrow form labels during column remeasure.
        // Justified lines keep the conservative threshold because their fit is
        // governed by the separate space-compression model below.
        const fitThreshold =
          hasAuthoredTabStop && attrs?.alignment !== 'justify'
            ? effectiveMaxWidth + WIDTH_FUDGE_PX
            : effectiveMaxWidth - WIDTH_FUDGE_PX;
        if (width + w > fitThreshold && width > 0) {
          if (ch === ' ') {
            // The space is only a wrap delimiter. Consume it so the next line
            // starts at the following word, but do not charge its width to the
            // completed line.
            endRun = r;
            endChar = chEnd;
            didBreakInThisLine = true;
            break;
          }
          const canKeepBorderlineUnbreakableText = lastBreakRun < 0 && width + w <= effectiveMaxWidth + WIDTH_FUDGE_PX;
          if (canKeepBorderlineUnbreakableText) {
            width += w;
            endRun = r;
            endChar = chEnd;
            continue;
          }
          // CJK offers a break opportunity at every ideograph, so rewinding to
          // the last space is wrong there: it strands whatever preceded the
          // clause on a short line. Prefer, in order: this character when it is
          // itself a CJK break opportunity, the latest ideograph boundary passed
          // on this line, then the last space. The glyph that overflows need not
          // be CJK for a CJK boundary to be the right one — in `甲方 本合同ABC`
          // it is `A`, yet breaking after `同` is what the primary measurer in
          // `measuring/dom` does. Whichever wins goes through kinsoku.
          const cjkBreakIsLaterThanSpace =
            lastCjkBreakRun > lastBreakRun || (lastCjkBreakRun === lastBreakRun && lastCjkBreakChar > lastBreakChar);
          // Kinsoku is resolved against this run's text, so a recorded boundary
          // is only usable here when it lies in the run being scanned.
          const usableCjkBreak = lastCjkBreakRun === r && cjkBreakIsLaterThanSpace;
          if (isCjkBreakOpportunityChar(ch) || lastBreakRun < 0) {
            const boundary = resolveKinsokuBoundary(text, start, c);
            if (boundary > c) {
              // Closers hang past the line end.
              width += measureCharRange(c, boundary);
            } else if (boundary < c) {
              // An opener carries down to the next line.
              width -= measureCharRange(boundary, c);
            }
            endRun = r;
            endChar = boundary;
          } else if (usableCjkBreak) {
            const boundary = resolveKinsokuBoundary(text, start, lastCjkBreakChar);
            width = widthAtLastCjkBreak;
            if (boundary > lastCjkBreakChar) {
              width += measureCharRange(lastCjkBreakChar, boundary);
            } else if (boundary < lastCjkBreakChar) {
              width -= measureCharRange(boundary, lastCjkBreakChar);
            }
            endRun = r;
            endChar = boundary;
          } else {
            endRun = lastBreakRun;
            endChar = lastBreakChar;
            width = widthAtLastBreak >= 0 ? widthAtLastBreak : width;
          }
          didBreakInThisLine = true;
          break;
        }
        width += w;
        endRun = r;
        endChar = chEnd;
        if (ch === ' ') {
          lastBreakRun = r;
          lastBreakChar = chEnd;
          widthAtLastBreak = width - w;
        } else if (ch === '\t' || ch === '-') {
          lastBreakRun = r;
          lastBreakChar = chEnd;
          widthAtLastBreak = width;
        } else if (isCjkBreakOpportunityChar(ch)) {
          // Every ideograph is a break opportunity. Record it so an overflow
          // later in the line breaks between ideographs instead of rewinding to
          // a space that may be far to the left.
          lastCjkBreakRun = r;
          lastCjkBreakChar = chEnd;
          widthAtLastCjkBreak = width;
        }
      }
      if (didBreakInThisLine) break;
      if (text.length > start) {
        previousRunLetterSpacing = runLetterSpacing(run);
      }
    }

    // If we didn't consume any chars (e.g., very long single char), force one char
    if (explicitLineBreakRun < 0 && startRun === endRun && startChar === endChar) {
      endRun = startRun;
      endChar = startChar + 1;
    }

    // Text-derived line height is the threshold for the baseline decision.
    // Reflowed lines still preserve line-expanding image height, matching
    // measuring/dom's `max(textLineHeight, maxImageHeight)` behavior.
    const textLineHeight = lineHeightForRuns(runs, startRun, endRun, lastMeasuredFontSize, spacing, fontContext);
    const lineHeight = Math.max(textLineHeight, lineMaxImageHeight);
    const line: Line = {
      fromRun: startRun,
      fromChar: startChar,
      toRun: endRun,
      toChar: endChar,
      width,
      ascent: 0,
      descent: 0,
      lineHeight,
      maxWidth: effectiveMaxWidth,
    };
    const inlineImageAlignments = resolveRemeasureImageAlignments(
      lineImageCandidates,
      lineMaxTextFontSize > 0,
      textLineHeight,
    );
    if (inlineImageAlignments) {
      line.inlineImageAlignments = inlineImageAlignments;
    }
    lines.push(line);
    if (lineMaxTextFontSize > 0) {
      lastMeasuredFontSize = lineMaxTextFontSize;
    }

    // Advance to next line start
    if (explicitLineBreakRun >= 0) {
      // Preserve trailing/manual break boundaries:
      // - If this line started on the break, we've already emitted its empty-line boundary,
      //   so advance past it.
      // - If this line ended before the break (text + break), keep the break for the next
      //   iteration only when the remaining tail is all breaks (trailing break chain).
      //   This avoids creating an extra empty line for [text, break, break, text].
      const emittedBreakBoundary =
        startRun === explicitLineBreakRun && startChar === 0 && endRun === explicitLineBreakRun && endChar === 0;
      if (emittedBreakBoundary) {
        currentRun = explicitLineBreakRun + 1;
      } else {
        let nextNonBreakRun = explicitLineBreakRun + 1;
        while (nextNonBreakRun < runs.length && isLineBreakRun(runs[nextNonBreakRun])) {
          nextNonBreakRun += 1;
        }
        const preserveBoundaryForNextIteration = nextNonBreakRun >= runs.length;
        currentRun = preserveBoundaryForNextIteration ? explicitLineBreakRun : explicitLineBreakRun + 1;
      }
      currentChar = 0;
    } else {
      currentRun = endRun;
      currentChar = endChar;
    }
    if (currentRun >= runs.length) {
      break;
    }
    if (!isLineBreakRun(runs[currentRun]) && currentChar >= runText(runs[currentRun]).length) {
      currentRun += 1;
      currentChar = 0;
    }
  }

  const hasTabRun = runs.some((run) => run?.kind === 'tab' && !isVanishedRun(run));
  const hasTextTab = runs.some(
    (run) =>
      run?.kind === 'text' &&
      !isVanishedRun(run) &&
      typeof (run as TextRun).text === 'string' &&
      (run as TextRun).text.includes('\t'),
  );
  const hasLineRegionOffsets = resolvedLineRegions?.some((regions) =>
    regions.some((region) => Number.isFinite(region.offsetX) && Math.abs(region.offsetX) > 0.01),
  );
  if (hasTabRun || hasTextTab || hasLineRegionOffsets) {
    applyTabLayoutToLines(lines, runs, tabStops, decimalSeparator, indentLeft, firstLineTabOffset);
  }

  if (hasLineRegionOffsets) {
    lines.forEach((line, lineIndex) => {
      const regions = resolvedLineRegions?.[lineIndex];
      if (!regions || regions.length !== 1 || !line.segments?.length) return;
      const offsetX = regions[0]?.offsetX ?? 0;
      if (!Number.isFinite(offsetX) || Math.abs(offsetX) <= 0.01) return;

      const firstSegment = line.segments[0];
      firstSegment.x = (firstSegment.x ?? 0) + offsetX;
      for (let index = 1; index < line.segments.length; index += 1) {
        const segment = line.segments[index];
        if (segment.x != null) segment.x += offsetX;
        if (segment.precedingTabEndX != null) segment.precedingTabEndX += offsetX;
      }
      line.leaders?.forEach((leader) => {
        leader.from += offsetX;
        leader.to += offsetX;
      });
      line.bars?.forEach((bar) => {
        bar.x += offsetX;
      });
    });
  }

  if (attrs?.alignment === 'justify' && getParagraphInlineDirection(block.attrs) !== 'rtl') {
    for (const line of lines) {
      if ((line.spaceCount ?? 0) !== 0 || line.segments?.some((segment) => segment.x !== undefined)) continue;
      const boundaries = collectCjkJustificationBoundaries(sliceRunsForLine(block, line));
      if (boundaries) line.justificationPlan = { type: 'inter-character', boundaries };
    }
  }

  const totalHeight = lines.reduce((s, l) => s + l.lineHeight, 0);

  // Build marker info if this is a list paragraph
  const marker = wordLayout?.marker;
  const markerTextWidth =
    typeof marker?.glyphWidthPx === 'number' && Number.isFinite(marker.glyphWidthPx) && marker.glyphWidthPx >= 0
      ? marker.glyphWidthPx
      : (measuredMarkerTextWidth ?? 0);
  const markerInfo = marker
    ? {
        // Keep remeasure output consistent with the primary DOM measurer. A
        // paragraph can override w:ind without repeating the numbering level's
        // hanging indent, while wordLayout still supplies a valid marker. Using
        // only attrs.indent.hanging here collapses that marker to zero after a
        // column/float remeasure and makes the painter suppress it entirely.
        markerWidth: Math.max(0, markerTextWidth + _LIST_MARKER_GAP),
        markerTextWidth,
        indentLeft,
        gutterWidth: marker.gutterWidthPx,
      }
    : undefined;

  return { kind: 'paragraph', lines, totalHeight, measuredAtMaxWidth: maxWidth, marker: markerInfo };
}
