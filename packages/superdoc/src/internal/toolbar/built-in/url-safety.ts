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

/**
 * Validate and normalize an href. Returns `{ href }` for safe values, or `null`.
 */
export function sanitizeHref(value: unknown): { href: string } | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // In-document anchors are always safe.
  if (trimmed.startsWith('#')) return { href: trimmed };

  if (DANGEROUS_SCHEME.test(trimmed)) return null;

  if (HAS_SCHEME.test(trimmed)) {
    return SAFE_SCHEME.test(trimmed) ? { href: trimmed } : null;
  }

  // Schemeless input is treated as https by the caller; accept it here.
  return { href: trimmed };
}
