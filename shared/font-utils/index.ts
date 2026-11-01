export type WordFontFamily = 'swiss' | 'roman' | 'modern' | 'script' | 'decorative' | 'system' | 'auto' | (string & {});

/**
 * Word font family fallbacks derived from common DOCX classifications.
 *
 * Maps DOCX font family types (w:family attribute values) to CSS font-family fallback chains.
 * This provides sensible defaults when a specific font is not available.
 *
 * Reference: ISO/IEC 29500-1:2016 (OOXML) Section 17.4.68 - ST_FontFamily
 *
 * @property swiss - Sans-serif fonts (e.g., Arial, Helvetica) → "Arial, sans-serif"
 * @property roman - Serif fonts (e.g., Times New Roman) → "Times New Roman, serif"
 * @property modern - Monospace fonts (e.g., Courier) → "Courier New, monospace"
 * @property script - Cursive/script fonts → "cursive"
 * @property decorative - Decorative/fantasy fonts → "fantasy"
 * @property system - System default fonts → "system-ui"
 * @property auto - Automatic font selection → "sans-serif"
 *
 * @example
 * // Using a DOCX font family classification
 * const fallback = FONT_FAMILY_FALLBACKS['swiss']; // "Arial, sans-serif"
 * const style = `font-family: Helvetica, ${fallback}`;
 */
export const FONT_FAMILY_FALLBACKS: Readonly<Record<string, string>> = Object.freeze({
  swiss: 'Arial, sans-serif',
  roman: 'Times New Roman, serif',
  modern: 'Courier New, monospace',
  script: 'cursive',
  decorative: 'fantasy',
  system: 'system-ui',
  auto: 'sans-serif',
});

/**
 * Default CSS generic font-family to use when no specific family is known.
 *
 * This is the most universally supported generic font family and provides
 * a safe fallback for all font rendering scenarios.
 *
 * @example
 * // Use as a final fallback
 * const fontFamily = specificFont || DEFAULT_GENERIC_FALLBACK; // "sans-serif"
 */
export const DEFAULT_GENERIC_FALLBACK: string = 'sans-serif';

const INHERITED_FONT_FAMILY = 'inherit';

/**
 * Known serif-like font families used as a heuristic when OOXML `w:family`
 * is unavailable. This keeps fallbacks closer to Word metrics for fonts like Cambria.
 */
const SERIF_LIKE_FONTS = new Set([
  'cambria',
  'cambria math',
  'times',
  'times new roman',
  'georgia',
  'garamond',
  'palatino',
  'palatino linotype',
  'book antiqua',
  'baskerville',
  'cochin',
  'hoefler text',
  'minion pro',
  'didot',
  'bodoni mt',
  'constantia',
]);

const normalizeFontNameForLookup = (fontName: string): string => {
  if (!fontName || typeof fontName !== 'string') return '';
  return fontName
    .trim()
    .replace(/^["']|["']$/g, '')
    .toLowerCase();
};

const MONOSPACE_FONTS = new Set([
  'courier',
  'courier new',
  'consolas',
  'menlo',
  'monaco',
  'lucida console',
  'liberation mono',
  'dejavu sans mono',
  'source code pro',
]);

const inferGenericFallbackFromFontName = (fontName: string): string => {
  const name = normalizeFontNameForLookup(fontName);
  if (MONOSPACE_FONTS.has(name)) return 'monospace';
  return SERIF_LIKE_FONTS.has(name) ? 'serif' : DEFAULT_GENERIC_FALLBACK;
};

/**
 * Normalizes a comma-separated font-family string into an array of trimmed, non-empty parts.
 *
 * This internal helper splits a CSS font-family string by commas, trims whitespace
 * from each part, and filters out any empty strings. This is used to clean up
 * fallback chains before processing.
 *
 * @private
 * @param value - The font-family string to normalize
 * @returns Array of trimmed, non-empty font family names
 *
 * @example
 * normalizeParts('Arial, sans-serif'); // ['Arial', 'sans-serif']
 * normalizeParts('  Times  ,  serif  '); // ['Times', 'serif']
 * normalizeParts('Arial,,,serif'); // ['Arial', 'serif']
 * normalizeParts(''); // []
 * normalizeParts(null); // []
 */
const normalizeParts = (value: string | undefined | null): string[] => splitOutsideQuotes(value || '', ',');

/**
 * Splits a string by a delimiter, but only when the delimiter is outside of quotes.
 *
 * @private
 * @param str - The string to split
 * @param delimiter - The delimiter to split on (single character)
 * @returns Array of parts, trimmed and filtered for empty strings
 */
const splitOutsideQuotes = (str: string, delimiter: string): string[] => {
  if (!str.includes('"') && !str.includes("'")) {
    return str
      .split(delimiter)
      .map((p) => p.trim())
      .filter(Boolean);
  }

  const parts: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar: string | null = null;
  let escaped = false;

  for (const char of str) {
    if (escaped) {
      current += char;
      escaped = false;
    } else if (char === '\\') {
      current += char;
      escaped = true;
    } else if (!inQuote && (char === '"' || char === "'")) {
      inQuote = true;
      quoteChar = char;
      current += char;
    } else if (inQuote && char === quoteChar) {
      inQuote = false;
      quoteChar = null;
      current += char;
    } else if (!inQuote && char === delimiter) {
      if (current.trim()) parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) parts.push(current.trim());

  return parts;
};

// Unquoted family names must be sequences of CSS identifiers. A numeric token
// or punctuation invalidates the declaration in both canvas and DOM styling.
const CSS_IDENTIFIER = /^(?:--|-?(?:[a-zA-Z_]|[^\x00-\x7f]))(?:[a-zA-Z0-9_-]|[^\x00-\x7f])*$/;
const serializeFamily = (family: string): string => {
  const first = family[0];
  if ((first === '"' || first === "'") && family.endsWith(first)) return family;
  if (family.split(/\s+/).every((part) => CSS_IDENTIFIER.test(part))) return family;
  const escaped = family.replace(/["\\\x00-\x1f\x7f]/g, (char) =>
    char === '"' || char === '\\' ? `\\${char}` : `\\${char.charCodeAt(0).toString(16)} `,
  );
  return `"${escaped}"`;
};

/**
 * Maps a DOCX font family classification to a CSS fallback string.
 *
 * Takes a Word/DOCX font family type (from the w:family attribute) and returns
 * an appropriate CSS font-family fallback chain. The mapping is case-insensitive.
 * If the family is unknown or falsy, returns the default generic fallback.
 *
 * @param wordFamily - The DOCX font family classification
 *   (e.g., 'swiss', 'roman', 'modern', 'script', 'decorative', 'system', 'auto')
 * @returns CSS font-family fallback string. Returns DEFAULT_GENERIC_FALLBACK
 *   ('sans-serif') if wordFamily is null, undefined, empty, or unrecognized.
 *
 * @example
 * // Map known DOCX families
 * mapWordFamilyFallback('swiss'); // "Arial, sans-serif"
 * mapWordFamilyFallback('roman'); // "Times New Roman, serif"
 * mapWordFamilyFallback('modern'); // "Courier New, monospace"
 *
 * @example
 * // Case-insensitive matching
 * mapWordFamilyFallback('SWISS'); // "Arial, sans-serif"
 * mapWordFamilyFallback('RoMaN'); // "Times New Roman, serif"
 *
 * @example
 * // Fallback for unknown/missing values
 * mapWordFamilyFallback('unknown'); // "sans-serif"
 * mapWordFamilyFallback(null); // "sans-serif"
 * mapWordFamilyFallback(''); // "sans-serif"
 */
export function mapWordFamilyFallback(wordFamily?: WordFontFamily | null): string {
  if (!wordFamily) return DEFAULT_GENERIC_FALLBACK;
  const mapped = FONT_FAMILY_FALLBACKS[wordFamily.toLowerCase()];
  return mapped || DEFAULT_GENERIC_FALLBACK;
}

export interface ToCssFontFamilyOptions {
  fallback?: string;
  wordFamily?: WordFontFamily | null;
  pitch?: string | null;
}

/**
 * Composes a CSS font-family string with an appropriate fallback chain.
 *
 * This function takes a primary font name and intelligently appends a fallback chain,
 * ensuring proper CSS syntax and avoiding duplication. It implements the following algorithm:
 *
 * 1. **Passthrough for non-strings**: Returns the input unchanged if it's not a string
 *    (null, undefined, number, object, etc.)
 * 2. **Trimming**: Removes leading/trailing whitespace from the font name
 * 3. **Explicit stacks**: Serializes each family in comma-separated stacks without
 *    adding fallbacks. Quotes names that cannot be expressed as CSS identifiers.
 * 4. **Fallback resolution**: Determines the fallback chain using this precedence:
 *    - Explicit `options.fallback` (highest priority)
 *    - Fixed `options.pitch` uses monospace, including conflicting family metadata
 *    - A recognized, non-auto `options.wordFamily` mapped via mapWordFamilyFallback()
 *    - The font-name heuristic (known monospace, known serif, otherwise sans-serif)
 * 5. **Duplicate detection**: If the font name already appears in the fallback chain
 *    (case-insensitive), returns just the fallback chain
 * 6. **Composition**: Serializes the font name and fallback chain as CSS families
 *
 * **Edge cases handled:**
 * - Preserves quotes in font names (e.g., "Times New Roman")
 * - Case-insensitive duplicate detection prevents "Arial, Arial, sans-serif"
 * - Normalizes whitespace in fallback chains (trims each part, filters empties)
 * - Empty fallback results in just the font name (no trailing comma)
 *
 * @param fontName - The primary font name to use.
 *   Can be null/undefined (returned as-is), or a string font name.
 * @param options - Configuration options
 * @param options.fallback - Explicit CSS fallback string (e.g., 'Arial, sans-serif').
 *   Takes precedence over wordFamily. Can be a comma-separated list.
 * @param options.wordFamily - DOCX font family classification
 *   (e.g., 'swiss', 'roman'). Mapped to CSS fallback via mapWordFamilyFallback().
 *   Ignored if options.fallback is provided.
 * @param options.pitch - DOCX pitch. Fixed pitch takes precedence over family classification.
 *
 * @returns A complete CSS font-family string, or the original
 *   value if it was not a string. Never throws errors; returns passthrough values safely.
 *
 * @throws This function does not throw. Invalid inputs are returned as-is.
 *
 * @example
 * // Basic usage with default fallback
 * toCssFontFamily('Arial'); // "Arial, sans-serif"
 * toCssFontFamily('Times New Roman'); // "Times New Roman, serif"
 *
 * @example
 * // Custom explicit fallback
 * toCssFontFamily('Georgia', { fallback: 'Times, serif' });
 * // "Georgia, Times, serif"
 *
 * @example
 * // DOCX wordFamily option
 * toCssFontFamily('Helvetica', { wordFamily: 'swiss' });
 * // "Helvetica, Arial, sans-serif"
 *
 * toCssFontFamily('Courier', { wordFamily: 'modern' });
 * // "Courier, Courier New, monospace"
 *
 * @example
 * // Fallback takes precedence over wordFamily
 * toCssFontFamily('MyFont', { fallback: 'serif', wordFamily: 'swiss' });
 * // "MyFont, serif" (wordFamily is ignored)
 *
 * @example
 * // Duplicate detection (case-insensitive)
 * toCssFontFamily('Arial', { fallback: 'Arial, sans-serif' });
 * // "Arial, sans-serif" (not "Arial, Arial, sans-serif")
 *
 * toCssFontFamily('arial', { fallback: 'Arial, sans-serif' });
 * // "Arial, sans-serif" (case-insensitive match)
 *
 * @example
 * // Passthrough for non-strings and special cases
 * toCssFontFamily(null); // null
 * toCssFontFamily(undefined); // undefined
 * toCssFontFamily(''); // '' (empty string)
 * toCssFontFamily('  '); // '' (whitespace-only)
 * toCssFontFamily('Arial, sans-serif'); // "Arial, sans-serif" (already has comma)
 * toCssFontFamily(123); // 123 (non-string passthrough)
 *
 * @example
 * // Whitespace handling
 * toCssFontFamily('  Arial  '); // "Arial, sans-serif"
 * toCssFontFamily('Arial', { fallback: '  serif  ,  monospace  ' });
 * // "Arial, serif, monospace"
 */
export function toCssFontFamily(
  fontName?: string | null,
  options: ToCssFontFamilyOptions = {},
): string | undefined | null {
  if (!fontName || typeof fontName !== 'string') return fontName;
  let trimmed = fontName.trim();
  if (!trimmed) return trimmed;
  const explicitParts = normalizeParts(trimmed);
  if (explicitParts.length > 1) {
    const serialized = explicitParts.map(serializeFamily);
    return serialized.every((part, i) => part === explicitParts[i]) ? trimmed : serialized.join(', ');
  }
  // OOXML may use this placeholder instead of a concrete font; adding a fallback makes canvas measurement diverge from CSS paint.
  if (trimmed.toLowerCase() === INHERITED_FONT_FAMILY) return undefined;
  // Replace semicolon font fallback separators (e.g., "Liberation Sans;Arial" from LibreOffice).
  // Only split on semicolons outside of quotes to preserve font names like "Foo;Bar".
  if (trimmed.includes(';')) {
    trimmed = splitOutsideQuotes(trimmed, ';').join(', ');
  }

  const { fallback, wordFamily, pitch } = options;
  const family = typeof wordFamily === 'string' ? wordFamily.trim().toLowerCase() : '';
  const fixedPitch = typeof pitch === 'string' && pitch.trim().toLowerCase() === 'fixed';
  const fallbackValue =
    fallback ??
    (fixedPitch ? 'monospace' : undefined) ??
    (family !== 'auto' && Object.prototype.hasOwnProperty.call(FONT_FAMILY_FALLBACKS, family)
      ? mapWordFamilyFallback(family)
      : undefined) ??
    inferGenericFallbackFromFontName(trimmed);

  const fallbackParts = normalizeParts(fallbackValue);
  const primaryParts = normalizeParts(trimmed);
  if (fallbackParts.length === 0) {
    return primaryParts.map(serializeFamily).join(', ');
  }

  const normalizedName = trimmed.toLowerCase();
  const includesName = fallbackParts.some((part) => part.toLowerCase() === normalizedName);
  if (includesName) {
    return fallbackParts.map(serializeFamily).join(', ');
  }

  return [...primaryParts, ...fallbackParts].map(serializeFamily).join(', ');
}

const CSS_GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
  'fangsong',
]);

/**
 * Returns the first unquoted CSS generic in the normalized renderer stack.
 * Bare names use the same fallback heuristic as rendering. Explicit stacks
 * without a generic return null; quoted generic words are named faces.
 */
export function getGenericFontFamily(fontFamily?: string | null): string | null {
  const stack = toCssFontFamily(fontFamily);
  if (typeof stack !== 'string') return null;
  for (const part of splitOutsideQuotes(stack, ',')) {
    const family = part.toLowerCase();
    if (CSS_GENERIC_FAMILIES.has(family)) return family;
  }
  return null;
}
