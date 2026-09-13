import { DomMeasurementInfrastructureError } from './measurement-infrastructure-error.js';

/**
 * Font Metrics Cache for Typography Measurements
 *
 * Provides accurate font ascent/descent metrics using the Canvas TextMetrics API.
 * This replaces hardcoded approximations (0.8/0.2 ratios) that caused text clipping
 * for fonts with non-standard glyph heights.
 *
 * The Canvas API's actualBoundingBoxAscent and actualBoundingBoxDescent properties
 * give the exact pixel dimensions needed to render text without clipping.
 *
 * @module fontMetricsCache
 */

/**
 * Font information needed to measure typography metrics.
 */
export type FontInfo = {
  fontFamily: string;
  /** Logical OOXML family retained when `fontFamily` is a substituted physical face. */
  wordLineMetricFamily?: string;
  /** Exact loaded embedded face's deterministic baseline-pitch ratio. */
  naturalLineMultiplier?: number;
  fontSize: number;
  bold?: boolean;
  italic?: boolean;
};

/**
 * Measured font metrics from the Canvas API.
 */
export type FontMetricsResult = {
  ascent: number;
  descent: number;
  /** Word-compatible natural single-line height used by `w:lineRule="auto"`. */
  naturalSingleLine?: number;
};

/**
 * Word-native single-line calibration for fonts whose Canvas metrics omit or
 * disagree with Word's intrinsic leading. Values are ratios of CSS font size.
 *
 * The Microsoft-family values come from the reviewed SD-2735 Word fixtures.
 * Aptos is additionally confirmed by SD-43's Word PDF (12.24 pt pitch at
 * 10 pt); Helvetica is 9.6 pt at 8 pt in the same evidence set. Keep this list
 * deliberately small; SD-3296 owns replacing it with generated fixtures.
 */
const WORD_NATURAL_LINE_MULTIPLIER: Readonly<Record<string, number>> = Object.freeze({
  aptos: 1.224,
  'aptos display': 1.224,
  calibri: 1.219,
  'calibri light': 1.219,
  cambria: 1.219,
  helvetica: 1.2,
  // SD-4125 Word mutation: an 11pt Symbol list marker makes its first
  // baseline 13.44pt tall. Marker faces participate in Word's shared line
  // envelope even though the glyph is painted in the hanging-indent gutter.
  symbol: 1.2218181818181817,
  // SD-1331 Word PDF: 11pt Nunito Sans baselines are 15.12pt apart.
  'nunito sans': 1.374545,
});

/**
 * Word-native pitch for an empty body-story paragraph whose paragraph mark is
 * formatted with Arial. The value is measured from paired 0-line/10-line DOCX
 * mutations in Word so marker-line geometry cancels out. Word 2010 and Word
 * 2013 compatibility modes both resolve 10pt and 13.5pt Arial to 1.15x.
 *
 * Keep the physical substitute in the same family contract: the projected
 * OOXML face is still Arial even when the browser resolves Liberation Sans.
 */
const WORD_BODY_EMPTY_LINE_MULTIPLIER: Readonly<Record<string, number>> = Object.freeze({
  arial: 1.15,
  'liberation sans': 1.15,
});

function primaryFontFamily(fontFamily: string): string {
  const first = fontFamily.split(',')[0] ?? '';
  return first
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .toLowerCase();
}

export function getCalibratedNaturalSingleLine(fontFamily: string, fontSize: number): number | undefined {
  const multiplier = WORD_NATURAL_LINE_MULTIPLIER[primaryFontFamily(fontFamily)];
  if (multiplier == null || !Number.isFinite(fontSize) || fontSize <= 0) return undefined;
  return multiplier * fontSize;
}

export function getCalibratedBodyEmptyLine(fontFamily: string, fontSize: number): number | undefined {
  const multiplier = WORD_BODY_EMPTY_LINE_MULTIPLIER[primaryFontFamily(fontFamily)];
  if (multiplier == null || !Number.isFinite(fontSize) || fontSize <= 0) return undefined;
  return multiplier * fontSize;
}

/**
 * Measurement configuration for deterministic mode.
 */
type MeasurementFonts = {
  deterministicFamily: string;
  fallbackStack: string[];
};

/**
 * Maximum cache size to prevent memory issues.
 */
const MAX_CACHE_SIZE = 1000;

/**
 * Test string for measuring font metrics.
 * Includes characters that exercise both ascenders and descenders:
 * - 'M' and 'H' for typical cap height
 * - 'g', 'y', 'p' for descenders
 * - 'b', 'd', 'l' for ascenders
 * - Accented capitals for maximum ascent
 */
const METRICS_TEST_STRING = 'MHgypbdlÁÉÍ';

/**
 * Builds a CSS font string from font info.
 *
 * Constructs a valid CSS font shorthand string for use with Canvas 2D context.
 * Handles both browser mode (uses actual font family) and deterministic mode
 * (uses fixed fallback stack for consistent measurements across environments).
 *
 * @param fontInfo - Font configuration (family, size, weight, style)
 * @param mode - Measurement mode: 'browser' uses fontInfo.fontFamily, 'deterministic' uses fallback stack
 * @param fonts - Font configuration containing deterministic family and fallback stack
 * @returns CSS font string in format "italic bold 16px Arial" (style and weight are optional)
 *
 * @example
 * ```typescript
 * buildFontStringForMetrics(
 *   { fontFamily: 'Arial', fontSize: 16, bold: true, italic: true },
 *   'browser',
 *   { deterministicFamily: 'Noto Sans', fallbackStack: [] }
 * )
 * // Returns: "italic bold 16px Arial"
 *
 * buildFontStringForMetrics(
 *   { fontFamily: 'CustomFont', fontSize: 12 },
 *   'deterministic',
 *   { deterministicFamily: 'Noto Sans', fallbackStack: ['Noto Sans', 'Arial'] }
 * )
 * // Returns: "12px Noto Sans, Arial"
 * ```
 */
function buildFontStringForMetrics(
  fontInfo: FontInfo,
  mode: 'browser' | 'deterministic',
  fonts: MeasurementFonts,
): string {
  const parts: string[] = [];

  if (fontInfo.italic) parts.push('italic');
  if (fontInfo.bold) parts.push('bold');
  parts.push(`${fontInfo.fontSize}px`);

  if (mode === 'deterministic') {
    parts.push(fonts.fallbackStack.length > 0 ? fonts.fallbackStack.join(', ') : fonts.deterministicFamily);
  } else {
    parts.push(fontInfo.fontFamily);
  }

  return parts.join(' ');
}

/** Surface-owned font metrics cache. The exact CSS font string and pinned
 * font generation are both part of identity, so a newly available face can
 * never inherit ascent/descent measured against its fallback. */
export class FontMetricsMeasurementCache {
  private entries = new Map<string, FontMetricsResult>();
  private disposed = false;

  get(
    ctx: CanvasRenderingContext2D,
    fontInfo: FontInfo,
    mode: 'browser' | 'deterministic',
    fonts: MeasurementFonts,
    fontSignature = '',
  ): FontMetricsResult {
    if (this.disposed) throw new DomMeasurementInfrastructureError('FontMetricsMeasurementCache has been disposed');
    const font = buildFontStringForMetrics(fontInfo, mode, fonts);
    const key = `${fontSignature}\u0000${fontInfo.wordLineMetricFamily ?? ''}\u0000${fontInfo.naturalLineMultiplier ?? ''}\u0000${font}`;
    const cached = this.entries.get(key);
    if (cached) return cached;

    ctx.font = font;
    const textMetrics = ctx.measureText(METRICS_TEST_STRING);
    const glyphMetrics: FontMetricsResult =
      typeof textMetrics.actualBoundingBoxAscent === 'number' &&
      typeof textMetrics.actualBoundingBoxDescent === 'number' &&
      textMetrics.actualBoundingBoxAscent > 0
        ? {
            ascent: textMetrics.actualBoundingBoxAscent,
            descent: textMetrics.actualBoundingBoxDescent,
          }
        : {
            ascent: fontInfo.fontSize * 0.8,
            descent: fontInfo.fontSize * 0.2,
          };

    // Canvas font bounds can change while fallback discovery settles even when the measured glyphs do not.
    // Only a family calibration or metadata pinned to the exact loaded face may override the stable fallback.
    const calibratedNaturalSingleLine = getCalibratedNaturalSingleLine(
      fontInfo.wordLineMetricFamily ?? fontInfo.fontFamily,
      fontInfo.fontSize,
    );
    const embeddedNaturalSingleLine =
      typeof fontInfo.naturalLineMultiplier === 'number' &&
      Number.isFinite(fontInfo.naturalLineMultiplier) &&
      fontInfo.naturalLineMultiplier > 0
        ? fontInfo.naturalLineMultiplier * fontInfo.fontSize
        : undefined;
    const naturalSingleLine = calibratedNaturalSingleLine ?? embeddedNaturalSingleLine;
    const result: FontMetricsResult = { ...glyphMetrics, naturalSingleLine };

    if (this.entries.size >= MAX_CACHE_SIZE) {
      const firstKey = this.entries.keys().next().value;
      if (firstKey !== undefined) this.entries.delete(firstKey);
    }
    this.entries.set(key, result);
    return result;
  }

  clear(): void {
    if (this.disposed) throw new DomMeasurementInfrastructureError('FontMetricsMeasurementCache has been disposed');
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }

  dispose(): void {
    if (this.disposed) return;
    this.entries.clear();
    this.disposed = true;
  }
}

const defaultFontMetricsCache = new FontMetricsMeasurementCache();

/**
 * Gets font metrics (ascent/descent) for the given font configuration.
 *
 * Uses the Canvas TextMetrics API to measure actual glyph bounds rather than
 * relying on hardcoded approximations. This prevents text clipping for fonts
 * with non-standard ascent/descent ratios.
 *
 * Results are cached to avoid repeated measurements.
 *
 * @param ctx - Canvas 2D rendering context
 * @param fontInfo - Font configuration (family, size, bold, italic)
 * @param mode - Measurement mode ('browser' or 'deterministic')
 * @param fonts - Font configuration for deterministic mode
 * @returns Font metrics with ascent and descent in pixels
 * @throws {TypeError} If canvas context is null or undefined
 * @throws {TypeError} If font size is not a positive finite number
 * @throws {TypeError} If font family is not a non-empty string
 * @throws {TypeError} If mode is not 'browser' or 'deterministic'
 *
 * @example
 * ```typescript
 * const ctx = canvas.getContext('2d');
 * const metrics = getFontMetrics(ctx, {
 *   fontFamily: 'Arial',
 *   fontSize: 16,
 *   bold: true
 * }, 'browser', { deterministicFamily: 'Noto Sans', fallbackStack: [] });
 * // Returns: { ascent: 14.5, descent: 3.8 }
 * ```
 */
export function getFontMetrics(
  ctx: CanvasRenderingContext2D,
  fontInfo: FontInfo,
  mode: 'browser' | 'deterministic',
  fonts: MeasurementFonts,
): FontMetricsResult {
  // Validate canvas context
  if (!ctx || typeof ctx !== 'object') {
    throw new TypeError('Canvas context must be a valid CanvasRenderingContext2D object');
  }

  // Validate font size: must be positive and finite
  if (typeof fontInfo.fontSize !== 'number' || !Number.isFinite(fontInfo.fontSize) || fontInfo.fontSize <= 0) {
    throw new TypeError(
      `Font size must be a positive finite number, got: ${typeof fontInfo.fontSize === 'number' ? fontInfo.fontSize : typeof fontInfo.fontSize}`,
    );
  }

  // Validate font family: must be non-empty string
  if (typeof fontInfo.fontFamily !== 'string' || fontInfo.fontFamily.trim().length === 0) {
    throw new TypeError('Font family must be a non-empty string');
  }

  // Validate mode parameter
  if (mode !== 'browser' && mode !== 'deterministic') {
    throw new TypeError(`Mode must be 'browser' or 'deterministic', got: ${mode}`);
  }

  return defaultFontMetricsCache.get(ctx, fontInfo, mode, fonts);
}

/**
 * Clears the font metrics cache.
 *
 * Removes all cached font metrics to ensure fresh measurements. Call this function
 * when fonts are loaded, unloaded, or changed to prevent stale metrics from being
 * used. This is particularly important for:
 * - Dynamic font loading (e.g., Google Fonts, custom web fonts)
 * - Font face updates or replacements
 * - Test isolation (clearing state between test cases)
 *
 * @returns void
 *
 * @example
 * ```typescript
 * // Clear cache after loading custom fonts
 * await document.fonts.ready;
 * clearFontMetricsCache();
 *
 * // Clear cache in test cleanup
 * afterEach(() => {
 *   clearFontMetricsCache();
 * });
 * ```
 */
export function clearFontMetricsCache(): void {
  defaultFontMetricsCache.clear();
}

/**
 * Gets the current size of the font metrics cache.
 *
 * Returns the number of font metric entries currently stored in the cache.
 * Useful for debugging, monitoring memory usage, and understanding cache behavior.
 * The cache has a maximum size of MAX_CACHE_SIZE (1000 entries) and uses FIFO
 * eviction when the limit is reached.
 *
 * @returns The number of cached font metric entries (0 to MAX_CACHE_SIZE)
 *
 * @example
 * ```typescript
 * // Monitor cache growth during font measurements
 * console.log('Cache size before:', getFontMetricsCacheSize()); // 0
 * getFontMetrics(ctx, { fontFamily: 'Arial', fontSize: 16 }, 'browser', fonts);
 * console.log('Cache size after:', getFontMetricsCacheSize()); // 1
 *
 * // Verify cache clearing
 * clearFontMetricsCache();
 * console.log('Cache size:', getFontMetricsCacheSize()); // 0
 *
 * // Debug cache behavior in tests
 * const initialSize = getFontMetricsCacheSize();
 * measureManyFonts();
 * expect(getFontMetricsCacheSize()).toBeGreaterThan(initialSize);
 * ```
 */
export function getFontMetricsCacheSize(): number {
  return defaultFontMetricsCache.size();
}
