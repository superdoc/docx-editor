export type Protocol = 'http' | 'https' | 'mailto' | 'tel' | 'sms' | 'ftp' | 'sftp' | 'irc';

export type SanitizerConfig = {
  allowedProtocols?: Protocol[];
  optionalProtocols?: Protocol[];
  blockedProtocols?: Protocol[];
  redirectBlocklist?: string[];
  maxLength?: number;
};

export type SanitizedLink = {
  href: string;
  protocol: string | null;
  isExternal: boolean;
};

export type EncodedTooltip = {
  text: string;
  wasTruncated: boolean;
};

export type DataUriMetadata = {
  hasPayloadSeparator: boolean;
  payload: string;
  rawMimeType: string;
  mimeType: string;
  isBase64: boolean;
};

type AnchorLink = { href: string; protocol: null; isExternal: false };

type Blocklist = { hosts: Set<string>; urls: Set<string> };

/**
 * Default set of allowed URL protocols that are considered safe for general use.
 *
 * SECURITY: These protocols have been vetted for safety in user-generated content:
 * - http/https: Standard web protocols
 * - mailto: Email links (no script execution risk)
 * - tel: Telephone links (mobile device handlers)
 * - sms: SMS/text message links (mobile device handlers)
 *
 * Additional protocols can be enabled via optionalProtocols configuration.
 */
const DEFAULT_ALLOWED_PROTOCOLS = ['http', 'https', 'mailto', 'tel', 'sms'];

/**
 * Whitelist of optional protocols that applications can enable when needed.
 *
 * SECURITY: Only protocols in this list can be added via optionalProtocols config.
 * This prevents injection of dangerous schemes (javascript:, data:, vbscript:) through
 * configuration. Each protocol has been evaluated for security:
 * - ftp/sftp: File transfer protocols (no script execution)
 * - irc: Internet Relay Chat protocol (no script execution)
 *
 * Protocols NOT in this list will be silently ignored even if requested.
 */
const OPTIONAL_PROTOCOLS = ['ftp', 'sftp', 'irc'];

/**
 * Protocols that are explicitly blocked due to security vulnerabilities.
 *
 * SECURITY RATIONALE:
 * - javascript: Direct script execution (XSS vector)
 * - data: Can embed executable content (XSS vector)
 * - vbscript: Script execution in older IE versions
 * - file: Local file access (information disclosure)
 * - ssh: Shell access protocol (not appropriate for web links)
 * - ws/wss: WebSocket protocols (not appropriate for static hyperlinks)
 *
 * These protocols are ALWAYS blocked, even if explicitly requested in config.
 * This list takes precedence over allowedProtocols and optionalProtocols.
 */
const BLOCKED_PROTOCOLS = ['javascript', 'data', 'vbscript', 'file', 'ssh', 'ws', 'wss'];

/**
 * Default maximum URL length in characters.
 *
 * SECURITY & COMPATIBILITY:
 * - Prevents resource exhaustion from excessively long URLs
 * - Aligns with common browser/server limits (IE: 2083, Chrome/Firefox: ~2MB but 2KB recommended)
 * - HTTP/1.1 spec (RFC 7230) recommends servers support at least 8000 octets, but many use 2048
 * - Prevents URL-based DoS attacks where malicious actors send extremely long URLs
 */
const DEFAULT_MAX_LENGTH = 2048;

/**
 * Maximum allowed length for image data URLs.
 * Prevents resource exhaustion from extremely large embedded images.
 */
export const MAX_IMAGE_DATA_URL_LENGTH = 10 * 1024 * 1024;

/**
 * Canonical set of image data URL MIME types supported by rendering and export.
 */
export const IMAGE_DATA_URL_MIME_TYPES: readonly string[] = Object.freeze([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/svg+xml',
  'image/webp',
  'image/bmp',
  'image/ico',
  'image/tif',
  'image/tiff',
]);

/**
 * Parse a data URI into the MIME type, payload, and base64 flag used by image
 * validation and DOCX export. Returns null for non-data URI strings.
 *
 * The payload separator is tracked separately so callers can reject malformed
 * values like `data:image/svg+xml` instead of treating them as empty files.
 */
export const getDataUriMetadata = (src: string = ''): DataUriMetadata | null => {
  if (typeof src !== 'string' || !src.startsWith('data:')) return null;

  const commaIndex = src.indexOf(',');
  const hasPayloadSeparator = commaIndex !== -1;
  const metadata = src.slice(5, hasPayloadSeparator ? commaIndex : undefined);
  const payload = hasPayloadSeparator ? src.slice(commaIndex + 1) : '';
  const [rawMimeType = '', ...parameters] = metadata.split(';');
  const mimeType = rawMimeType.toLowerCase();

  return {
    hasPayloadSeparator,
    payload,
    rawMimeType,
    mimeType,
    isBase64: parameters.some((part) => part.toLowerCase() === 'base64'),
  };
};

/**
 * Percent-decode a non-base64 data URI payload.
 * Returns null when the payload has invalid percent escapes.
 */
export const tryDecodeDataUriText = (payload: string = ''): string | null => {
  try {
    return decodeURIComponent(payload);
  } catch {
    return null;
  }
};

const BASE64_PAYLOAD_PATTERN = /^[A-Za-z0-9+/]+$/;

const isValidBase64Payload = (payload: string = ''): boolean => {
  const normalizedPayload = payload.replace(/\s/g, '');
  if (!normalizedPayload || normalizedPayload.length % 4 === 1) return false;

  const padding = normalizedPayload.match(/=+$/)?.[0] || '';
  if (padding.length > 2) return false;

  const body = padding ? normalizedPayload.slice(0, -padding.length) : normalizedPayload;
  if (!body || !BASE64_PAYLOAD_PATTERN.test(body) || body.includes('=')) return false;
  if (!padding) return true;
  if (normalizedPayload.length % 4 !== 0) return false;

  return body.length % 4 === (padding.length === 1 ? 3 : 2);
};

/**
 * Validate an image data URL for rendering and export.
 *
 * The URL must use a supported image MIME type, include a comma payload
 * separator, and stay within MAX_IMAGE_DATA_URL_LENGTH. Base64 payloads are
 * accepted for all supported image MIME types. Non-base64 payloads are accepted
 * only for SVG, where the percent-encoded text must decode successfully.
 */
export const isValidImageDataUrl = (src: unknown): boolean => {
  if (typeof src !== 'string' || !src.startsWith('data:') || src.length > MAX_IMAGE_DATA_URL_LENGTH) {
    return false;
  }

  const metadata = getDataUriMetadata(src);
  if (!metadata?.hasPayloadSeparator || !IMAGE_DATA_URL_MIME_TYPES.includes(metadata.mimeType)) return false;
  if (metadata.isBase64) return isValidBase64Payload(metadata.payload);
  if (metadata.mimeType !== 'image/svg+xml') return false;

  return tryDecodeDataUriText(metadata.payload) != null;
};

/**
 * Default maximum tooltip length in characters.
 *
 * Prevents excessively long tooltips that degrade UX and accessibility.
 * Based on WCAG 2.1 SC 1.4.13 Content on Hover or Focus guidelines,
 * which recommend that hover content should be dismissible and not
 * interfere with page content. Tooltips over 500 characters become
 * difficult to read and may obscure important UI elements.
 *
 * Research basis:
 * - WCAG 2.1 Success Criterion 1.4.13 (Level AA) requires hover content
 *   to be dismissible, hoverable, and persistent
 * - Nielsen Norman Group research indicates tooltips should be brief
 *   (1-2 sentences) to prevent cognitive overload
 * - 500 characters approximates 75-100 words, suitable for concise
 *   context while preventing screen coverage issues
 */
export const DEFAULT_TOOLTIP_MAX_LENGTH: number = 500;
// SECURITY: Anchor names must only contain safe characters to prevent HTML attribute injection
// Removed colon (:) to align with DOM painter's SAFE_ANCHOR_PATTERN and prevent ambiguity
const ANCHOR_NAME_PATTERN = /^[A-Za-z0-9._=-]+$/;

/**
 * Control characters and whitespace tricks that can smuggle payloads
 * past naive string checks (e.g. tab, newline, null byte, zero-width chars).
 */
const CONTROL_CHAR_PATTERN = /[\x00-\x1f\x7f\u200b-\u200f\u2028\u2029\ufeff]/;

/**
 * Normalize protocol values into a lowercase Set for case-insensitive matching.
 * Filters out non-string values and empty/whitespace-only strings.
 */
function toProtocolSet(values?: readonly string[]): Set<string> {
  const result = new Set<string>();
  if (!values) return result;
  values.forEach((value) => {
    if (typeof value === 'string' && value.trim()) {
      result.add(value.trim().toLowerCase());
    }
  });
  return result;
}

/**
 * Build the final set of allowed protocols from configuration.
 *
 * This function merges default protocols with user-provided configuration while enforcing
 * critical security constraints. It supports two configuration modes:
 * 1. Override mode: If allowedProtocols is provided, it REPLACES defaults entirely
 * 2. Extend mode: If optionalProtocols is provided, it ADDS to the base set
 *
 * SECURITY GUARANTEES:
 * - Only protocols from OPTIONAL_PROTOCOLS whitelist can be added via optionalProtocols
 * - Dangerous protocols (javascript:, data:, vbscript:) are NEVER added even if requested
 * - Protocol matching is case-insensitive to prevent bypass via uppercase schemes
 * - Invalid/malformed protocol values are silently filtered out
 *
 * @example
 * // Use defaults
 * buildAllowedProtocols()
 * // Returns: Set{'http', 'https', 'mailto', 'tel', 'sms'}
 *
 * @example
 * // Add optional protocols
 * buildAllowedProtocols({ optionalProtocols: ['ftp', 'sftp'] })
 * // Returns: Set{'http', 'https', 'mailto', 'tel', 'sms', 'ftp', 'sftp'}
 *
 * @example
 * // Override defaults (use with caution)
 * buildAllowedProtocols({ allowedProtocols: ['https', 'mailto'] })
 * // Returns: Set{'https', 'mailto'}
 *
 * @example
 * // Security: Dangerous protocols ignored
 * buildAllowedProtocols({ optionalProtocols: ['ftp', 'javascript', 'data'] })
 * // Returns: Set{'http', 'https', 'mailto', 'tel', 'sms', 'ftp'}
 * // Note: 'javascript' and 'data' are silently filtered out
 */
function buildAllowedProtocols(config: SanitizerConfig = {}): Set<string> {
  const allowed = config.allowedProtocols?.length
    ? toProtocolSet(config.allowedProtocols)
    : new Set(DEFAULT_ALLOWED_PROTOCOLS);

  const optional = toProtocolSet(config.optionalProtocols);
  if (optional.size > 0) {
    optional.forEach((protocol) => {
      if (OPTIONAL_PROTOCOLS.includes(protocol)) {
        allowed.add(protocol);
      }
    });
  }

  return allowed;
}

/**
 * Normalize and categorize blocklist entries into hostnames and URL prefixes.
 *
 * This function processes the redirectBlocklist configuration to enable efficient URL blocking.
 * It separates entries into two categories for optimized matching:
 * 1. Hostname blocks: Match against parsed URL hostname (e.g., 'evil.com')
 * 2. URL prefix blocks: Match against full URL string (e.g., 'https://ads.example.com/track')
 *
 * SECURITY & ROBUSTNESS:
 * - All entries normalized to lowercase for case-insensitive matching
 * - Whitespace is trimmed to handle configuration formatting variations
 * - Invalid entries (null, undefined, non-strings, empty) are silently filtered out
 * - No regex/glob patterns - uses exact string matching for predictable behavior
 *
 * PERFORMANCE:
 * - Returns Sets for O(1) lookup during URL validation
 * - Hostname-only blocks are faster (simple Set.has() check)
 * - URL prefix blocks require iteration but are typically small lists
 *
 * @example
 * // Basic hostname blocking
 * normalizeBlocklist(['evil.com', 'tracker.net'])
 * // Returns: { hosts: Set{'evil.com', 'tracker.net'}, urls: Set{} }
 *
 * @example
 * // Case-insensitive normalization
 * normalizeBlocklist(['Evil.COM', '  TRACKER.net  '])
 * // Returns: { hosts: Set{'evil.com', 'tracker.net'}, urls: Set{} }
 *
 * @example
 * // Mixed hostnames and URL prefixes
 * normalizeBlocklist(['evil.com', 'https://ads.example.com/track'])
 * // Returns: {
 * //   hosts: Set{'evil.com'},
 * //   urls: Set{'https://ads.example.com/track'}
 * // }
 *
 * @example
 * // Malformed entries filtered out
 * normalizeBlocklist(['valid.com', null, '', '  ', 123, undefined])
 * // Returns: { hosts: Set{'valid.com'}, urls: Set{} }
 */
function normalizeBlocklist(values?: readonly unknown[]): Blocklist {
  const hosts = new Set<string>();
  const urls = new Set<string>();
  if (!values) {
    return { hosts, urls };
  }
  values.forEach((entry) => {
    if (!entry || typeof entry !== 'string') return;
    const trimmed = entry.trim().toLowerCase();
    if (!trimmed) return;
    if (trimmed.includes('://')) {
      urls.add(trimmed);
    } else {
      hosts.add(trimmed);
    }
  });
  return { hosts, urls };
}

/**
 * Parse and validate an anchor link (starting with #).
 *
 * Anchor links are internal page navigation targets. This function ensures the anchor
 * name contains only safe characters to prevent HTML attribute injection attacks.
 *
 * SECURITY:
 * - Rejects empty anchors (standalone '#')
 * - Only allows alphanumeric, dots, hyphens, underscores, and equals signs
 * - Colons explicitly rejected to prevent ambiguity with protocols (e.g., '#http:evil')
 * - Prevents special characters that could break HTML attributes
 *
 * @example
 * parseAnchorLink('#section-1')
 * // Returns: { href: '#section-1', protocol: null, isExternal: false }
 *
 * @example
 * parseAnchorLink('#')           // Returns: null (empty anchor)
 * parseAnchorLink('#bad name')   // Returns: null (contains space)
 * parseAnchorLink('#http:evil')  // Returns: null (contains colon)
 */
function parseAnchorLink(trimmed: string): AnchorLink | null {
  if (!trimmed.startsWith('#')) return null;

  const anchor = trimmed.slice(1);
  if (!anchor || !ANCHOR_NAME_PATTERN.test(anchor)) {
    return null;
  }

  return { href: `#${anchor}`, protocol: null, isExternal: false };
}

/**
 * Check if a URL protocol is allowed based on configuration.
 *
 * This function enforces the protocol whitelist/blacklist security policy.
 * It checks both allowed protocols and blocked protocols, with blocked taking precedence.
 *
 * SECURITY:
 * - Blocked protocols (javascript:, data:, etc.) are ALWAYS rejected
 * - Protocol matching is case-insensitive to prevent bypass attempts
 * - Returns false for any protocol not explicitly allowed
 *
 * @example
 * const allowed = new Set(['http', 'https', 'mailto']);
 * const blocked = ['javascript', 'data'];
 * isProtocolAllowed('https', allowed, blocked)     // Returns: true
 * isProtocolAllowed('javascript', allowed, blocked) // Returns: false
 * isProtocolAllowed('custom', allowed, blocked)    // Returns: false
 */
function isProtocolAllowed(
  scheme: string,
  allowedProtocols: Set<string>,
  blockedProtocols: readonly string[],
): boolean {
  if (blockedProtocols.includes(scheme)) {
    return false;
  }
  return allowedProtocols.has(scheme);
}

/**
 * Check if a URL should be blocked based on the redirect blocklist.
 *
 * This function matches URLs against hostname and URL prefix blocklists to prevent
 * links to malicious, tracking, or unwanted destinations. Both hostname-only and
 * full URL prefix matching are supported.
 *
 * MATCHING STRATEGY:
 * - Hostname matching: Exact match against parsed URL hostname (faster, O(1))
 * - URL prefix matching: String prefix match against full URL (slower, O(n))
 * - All matching is case-insensitive
 *
 * @example
 * const blocklist = {
 *   hosts: new Set(['evil.com', 'tracker.net']),
 *   urls: new Set(['https://ads.example.com/track'])
 * };
 * const url = new URL('https://evil.com/page');
 * isBlockedByRedirectList('https://evil.com/page', url, blocklist)
 * // Returns: true (hostname match)
 *
 * @example
 * const url2 = new URL('https://ads.example.com/track/123');
 * isBlockedByRedirectList('https://ads.example.com/track/123', url2, blocklist)
 * // Returns: true (URL prefix match)
 */
function isBlockedByRedirectList(normalizedHref: string, parsed: URL, blocklist: Blocklist): boolean {
  const { hosts, urls } = blocklist;

  const hostname = parsed.hostname ? parsed.hostname.toLowerCase() : '';
  if (hosts.size > 0 && hostname && hosts.has(hostname)) {
    return true;
  }

  if (urls.size > 0) {
    const hrefLower = normalizedHref.toLowerCase();
    for (const blockedUrl of urls) {
      if (hrefLower.startsWith(blockedUrl)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Validate and resolve a relative or absolute path for safe use as an element src/href.
 *
 * SECURITY MODEL:
 * 1. Reject control characters / whitespace-trick inputs.
 * 2. Resolve via `new URL(raw, origin)` — normalises `..`, `//`, encoded sequences.
 * 3. Enforce same-origin — the resolved URL must share the base origin.
 */
function sanitizeRelativePath(pathString: string, blocklist: Blocklist): AnchorLink | null {
  if (CONTROL_CHAR_PATTERN.test(pathString)) {
    return null;
  }

  // Determine base URL — use full href so dot-relative paths (./img.png)
  // resolve against the current page directory, not the site root.
  const base = typeof window !== 'undefined' ? window.location.href : null;
  if (!base) {
    return null;
  }

  let resolved: URL;
  try {
    resolved = new URL(pathString, base);
  } catch {
    return null;
  }

  if (resolved.origin !== new URL(base).origin) {
    return null;
  }

  if (isBlockedByRedirectList(resolved.href, resolved, blocklist)) {
    return null;
  }

  return { href: resolved.href, protocol: null, isExternal: false };
}

/**
 * Sanitize and validate a hyperlink URL for safe use in HTML href attributes.
 *
 * This is the primary security boundary for user-provided URLs in the application.
 * It performs comprehensive validation to prevent XSS attacks, phishing, and other
 * web security vulnerabilities while supporting legitimate use cases.
 *
 * SECURITY VALIDATIONS:
 * 1. Protocol Validation: Only allows whitelisted protocols, blocks dangerous schemes
 * 2. XSS Prevention: Rejects URLs with HTML-breaking characters (<>"') in query strings
 * 3. Homograph Detection: Warns about non-ASCII characters in hostnames (e.g., cyrillic 'а' vs latin 'a')
 * 4. Anchor Injection: Validates anchor names match safe pattern (alphanumeric, dots, hyphens, underscores)
 * 5. Length Limits: Prevents resource exhaustion from excessively long URLs
 * 6. Blocklist Enforcement: Rejects URLs matching hostname or prefix blocklists
 * 7. Relative Path Safety: Resolves relative paths against page origin with same-origin enforcement
 *
 * IMPORTANT BEHAVIORS:
 * - Returns null for ANY validation failure (fail-closed security model)
 * - Anchor links (#section) bypass most validation but still check anchor name safety
 * - Protocol matching is case-insensitive (HTTP === http)
 * - Hostname blocking is case-insensitive (Evil.COM === evil.com)
 * - Homograph attacks are logged but NOT blocked (legitimate international domains exist)
 *
 * @example
 * // Valid HTTPS URL
 * sanitizeHref('https://example.com/page')
 * // Returns: { href: 'https://example.com/page', protocol: 'https', isExternal: true }
 *
 * @example
 * // Valid anchor link
 * sanitizeHref('#section-1')
 * // Returns: { href: '#section-1', protocol: null, isExternal: false }
 *
 * @example
 * // XSS attempt blocked
 * sanitizeHref('javascript:alert(1)')
 * // Returns: null
 *
 * @example
 * // Query parameter XSS blocked
 * sanitizeHref('https://example.com?x=<script>alert(1)</script>')
 * // Returns: null
 *
 * @example
 * // Relative path (resolved against window.location.origin)
 * sanitizeHref('/docs/page')
 * // Returns: { href: 'https://localhost:3000/docs/page', protocol: null, isExternal: false }
 *
 * @example
 * // Custom blocklist
 * sanitizeHref('https://blocked.com/page', { redirectBlocklist: ['blocked.com'] })
 * // Returns: null
 *
 * @example
 * // Enable optional protocol
 * sanitizeHref('ftp://files.example.com/resource', { optionalProtocols: ['ftp'] })
 * // Returns: { href: 'ftp://files.example.com/resource', protocol: 'ftp', isExternal: false }
 */
export function sanitizeHref(raw: string | null | undefined, config: SanitizerConfig = {}): SanitizedLink | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const maxLength = typeof config.maxLength === 'number' ? config.maxLength : DEFAULT_MAX_LENGTH;
  if (trimmed.length > maxLength) {
    return null;
  }

  const anchorResult = parseAnchorLink(trimmed);
  if (anchorResult !== null) {
    return anchorResult;
  }

  if (trimmed.startsWith('//') || /^www\./i.test(trimmed)) {
    return null;
  }

  const blocklist = normalizeBlocklist(config.redirectBlocklist);

  // Relative paths (/, ./, ../, bare paths) have no protocol to validate
  // resolve against page origin instead
  if (isRelativeUrl(trimmed)) {
    return sanitizeRelativePath(trimmed, blocklist);
  }

  const schemeMatch = trimmed.match(/^([a-z0-9+.-]+):/i);
  if (!schemeMatch) {
    return null;
  }
  const scheme = schemeMatch[1].toLowerCase();

  const allowedProtocols = buildAllowedProtocols(config);
  const blockedProtocols = BLOCKED_PROTOCOLS.concat(config.blockedProtocols ?? []).map((p) => p.toLowerCase());

  if (!isProtocolAllowed(scheme, allowedProtocols, blockedProtocols)) {
    return null;
  }

  // Homograph attack detection: Check for non-ASCII characters in hostname BEFORE URL parsing
  // The URL constructor auto-converts international domains to Punycode (ASCII), so we must check the raw input
  // Example: раypal.com (Cyrillic 'а' instead of Latin 'a')
  const hostStartIndex = trimmed.indexOf('://') + 3;
  let hostEndIndex = trimmed.indexOf('/', hostStartIndex);
  if (hostEndIndex === -1) {
    hostEndIndex = trimmed.indexOf('?', hostStartIndex);
  }
  if (hostEndIndex === -1) {
    hostEndIndex = trimmed.indexOf('#', hostStartIndex);
  }
  if (hostEndIndex === -1) {
    hostEndIndex = trimmed.length;
  }
  const rawHostname = trimmed.slice(hostStartIndex, hostEndIndex).toLowerCase();
  if (rawHostname && /[^\x00-\x7F]/.test(rawHostname)) {
    if (process.env.NODE_ENV === 'development' || process.env.DEBUG_HYPERLINKS === 'true') {
      console.warn(`[URL Validation] Potential homograph attack detected in hostname: ${rawHostname.slice(0, 50)}`);
    }
    // Note: We log but don't block, as legitimate international domains exist
    // Consumers can use this warning to implement stricter policies if needed
  }

  // XSS Prevention: Block URLs with HTML-breaking characters in query parameters.
  // Characters like <>"' in query strings can break HTML attributes and enable XSS attacks.
  // Example attack: https://example.com?x=<script>alert(1)</script>
  // We check the original string before URL parsing because the URL constructor auto-encodes special chars.
  // Rather than attempting to encode (which is complex and error-prone), we reject these URLs.
  const queryStartIndex = trimmed.indexOf('?');
  if (queryStartIndex !== -1) {
    const queryString = trimmed.slice(queryStartIndex);
    if (/[<>"']/.test(queryString)) {
      return null;
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  const normalizedHref = trimmed;

  if (isBlockedByRedirectList(normalizedHref, parsed, blocklist)) {
    return null;
  }

  const isExternal = scheme === 'http' || scheme === 'https';
  return { href: normalizedHref, protocol: scheme, isExternal };
}

/**
 * Prepare tooltip text for safe use in HTML title attributes.
 *
 * This function processes raw text for use in title="..." or aria-label="..." attributes
 * by trimming whitespace and enforcing length limits. It intentionally does NOT perform
 * HTML encoding because browsers automatically escape attribute values.
 *
 * IMPORTANT - WHY NOT HTML-ENCODED:
 * When you set an attribute via JavaScript (element.setAttribute('title', value) or
 * element.title = value), the browser's HTML parser automatically escapes special
 * characters. If we HTML-encode here, users would see double-encoded output:
 *   - Input: 'Click "here" for info'
 *   - If we encode: 'Click &quot;here&quot; for info' (WRONG - user sees &quot; literally)
 *   - Raw output: 'Click "here" for info' (CORRECT - browser handles escaping)
 *
 * The ONLY time you need manual HTML encoding is when building HTML strings via
 * concatenation (e.g., innerHTML = '<div title="' + text + '">'), which is an
 * anti-pattern and should be avoided.
 *
 * SECURITY:
 * - No XSS risk when used with setAttribute() or property assignment
 * - Browsers prevent attribute-based injection via automatic escaping
 * - Length limits prevent UI degradation and potential DoS via enormous tooltips
 *
 * ACCESSIBILITY:
 * - Respects WCAG 2.1 SC 1.4.13 (Content on Hover or Focus)
 * - Default 500 char limit prevents screen reader fatigue and UI obscuration
 * - wasTruncated flag enables UI indicators for truncated content
 *
 * Returns null for non-string or empty-after-trim input. A maxLength of 0 or
 * less disables truncation.
 *
 * @example
 * // Basic usage
 * const result = encodeTooltip('  Click here for more info  ')
 * // Returns: { text: 'Click here for more info', wasTruncated: false }
 * // Usage: element.title = result.text
 *
 * @example
 * // Special characters NOT encoded (browser handles it)
 * const result = encodeTooltip('Use "quotes" & <brackets>')
 * // Returns: { text: 'Use "quotes" & <brackets>', wasTruncated: false }
 * // Browser will display correctly, no &quot; or &lt; visible to user
 *
 * @example
 * // Truncation
 * const result = encodeTooltip('a'.repeat(600), 500)
 * // Returns: { text: 'aaa...' (500 chars), wasTruncated: true }
 * // You can use wasTruncated to add ellipsis or expand UI
 *
 * @example
 * // Invalid input
 * encodeTooltip(null)      // Returns: null
 * encodeTooltip('')        // Returns: null
 * encodeTooltip('   ')     // Returns: null
 * encodeTooltip(123)       // Returns: null
 */
export function encodeTooltip(
  raw: string | null | undefined,
  maxLength: number = DEFAULT_TOOLTIP_MAX_LENGTH,
): EncodedTooltip | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const limit = typeof maxLength === 'number' && maxLength > 0 ? maxLength : 0;
  const wasTruncated = limit > 0 && trimmed.length > limit;
  const text = limit > 0 && trimmed.length > limit ? trimmed.slice(0, limit) : trimmed;

  // CRITICAL FIX: Return raw text instead of HTML-encoded text
  // Browsers automatically escape attribute values when set via setAttribute() or .title property
  // HTML-encoding here causes double-encoding: user sees &quot; instead of "
  return {
    text,
    wasTruncated,
  };
}

/**
 * Determine whether a URL string is relative (no scheme, no protocol-relative prefix).
 *
 * Relative URLs include:
 * - Absolute paths: `/path/to/file`
 * - Dot-relative paths: `./file`, `../file`
 * - Bare paths: `images/photo.png`
 *
 * NOT relative:
 * - Anchors: `#section`
 * - Protocol-relative: `//cdn.example.com`
 * - Absolute URLs with scheme: `https://…`, `data:…`, `blob:…`
 */
export function isRelativeUrl(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('#')) return false;
  if (trimmed.startsWith('//')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return false;
  return true;
}

export const UrlValidationConstants = {
  DEFAULT_ALLOWED_PROTOCOLS,
  OPTIONAL_PROTOCOLS,
  BLOCKED_PROTOCOLS,
  DEFAULT_MAX_LENGTH,
};

export { buildAllowedProtocols };
