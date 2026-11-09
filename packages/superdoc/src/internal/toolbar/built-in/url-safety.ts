/**
 * Minimal href sanitizer for the built-in link popover.
 *
 * The v1 toolbar used the shared `@superdoc/url-validation` package, which is not
 * a resolvable runtime dependency of the published `superdoc` ES build. This
 * keeps the same fail-closed posture (only known-safe schemes pass) without
 * pulling in that package: dangerous schemes (`javascript:`, `data:`,
 * `vbscript:`) return `null`, mirroring the v1 contract that callers treat a
 * `null` result as an invalid URL.
 */

const SAFE_SCHEME = /^(https?|mailto|tel):/i;
const DANGEROUS_SCHEME = /^(javascript|data|vbscript):/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const ASCII_TAB_OR_NEWLINE = /[\t\n\r]/;
const LEADING_C0_CONTROL_OR_SPACE = /^[\x00-\x20]+/;

/**
 * Validate and normalize an href. Returns `{ href }` for safe values, or `null`.
 */
export function sanitizeHref(value: unknown): { href: string } | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (ASCII_TAB_OR_NEWLINE.test(trimmed)) return null;

  // In-document anchors are always safe.
  if (trimmed.startsWith('#')) return { href: trimmed };

  const schemeAsParsed = trimmed.replace(LEADING_C0_CONTROL_OR_SPACE, '');
  if (DANGEROUS_SCHEME.test(schemeAsParsed)) return null;

  if (HAS_SCHEME.test(schemeAsParsed)) {
    return SAFE_SCHEME.test(schemeAsParsed) ? { href: trimmed } : null;
  }

  // Schemeless input is treated as https by the caller; accept it here.
  return { href: trimmed };
}
