export type WordFontFamily = 'swiss' | 'roman' | 'modern' | 'script' | 'decorative' | 'system' | 'auto' | (string & {});

export const FONT_FAMILY_FALLBACKS: Readonly<Record<string, string>>;
export const DEFAULT_GENERIC_FALLBACK: string;

export interface ToCssFontFamilyOptions {
  fallback?: string;
  wordFamily?: WordFontFamily | null;
  /** DOCX pitch; fixed pitch takes precedence over family classification. */
  pitch?: string | null;
}

export function mapWordFamilyFallback(wordFamily?: WordFontFamily | null): string;

export function toCssFontFamily(fontName?: string | null, options?: ToCssFontFamilyOptions): string | undefined | null;

/** First unquoted CSS generic in the normalized renderer stack, or null if none. */
export function getGenericFontFamily(fontFamily?: string | null): string | null;
