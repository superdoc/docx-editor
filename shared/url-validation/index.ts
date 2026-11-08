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

const DEFAULT_ALLOWED_PROTOCOLS = ['http', 'https', 'mailto', 'tel', 'sms'];

const OPTIONAL_PROTOCOLS = ['ftp', 'sftp', 'irc'];

const BLOCKED_PROTOCOLS = ['javascript', 'data', 'vbscript', 'file', 'ssh', 'ws', 'wss'];

const EXTERNAL_PROTOCOLS = ['http', 'https'];

const DEFAULT_MAX_LENGTH = 2048;

export const MAX_IMAGE_DATA_URL_LENGTH = 10 * 1024 * 1024;

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

const IMAGE_MIME_TYPE_WITH_PERCENT_ENCODED_PAYLOAD = 'image/svg+xml';

const DATA_URI_PREFIX = 'data:';

export const getDataUriMetadata = (src: string = ''): DataUriMetadata | null => {
  if (typeof src !== 'string' || !src.startsWith(DATA_URI_PREFIX)) return null;

  const commaIndex = src.indexOf(',');
  const hasPayloadSeparator = commaIndex !== -1;
  const metadata = src.slice(DATA_URI_PREFIX.length, hasPayloadSeparator ? commaIndex : undefined);
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

const isValidPercentEncodedImagePayload = (metadata: DataUriMetadata): boolean =>
  metadata.mimeType === IMAGE_MIME_TYPE_WITH_PERCENT_ENCODED_PAYLOAD && tryDecodeDataUriText(metadata.payload) != null;

export const isValidImageDataUrl = (src: unknown): boolean => {
  if (typeof src !== 'string' || !src.startsWith(DATA_URI_PREFIX) || src.length > MAX_IMAGE_DATA_URL_LENGTH) {
    return false;
  }

  const metadata = getDataUriMetadata(src);
  if (!metadata?.hasPayloadSeparator || !IMAGE_DATA_URL_MIME_TYPES.includes(metadata.mimeType)) return false;
  if (metadata.isBase64) return isValidBase64Payload(metadata.payload);

  return isValidPercentEncodedImagePayload(metadata);
};

export const DEFAULT_TOOLTIP_MAX_LENGTH: number = 500;

const SAFE_ANCHOR_NAME_PATTERN = /^[A-Za-z0-9._=-]+$/;

const CONTROL_OR_INVISIBLE_CHARACTER_PATTERN = /[\x00-\x1f\x7f\u200b-\u200f\u2028\u2029\ufeff]/;

const SCHEME_PREFIX_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

const LEADING_SCHEME_PATTERN = /^([a-z0-9+.-]+):/i;

const WWW_PREFIX_PATTERN = /^www\./i;

const NON_ASCII_CHARACTER_PATTERN = /[^\x00-\x7F]/;

const ATTRIBUTE_BREAKING_CHARACTER_PATTERN = /[<>"']/;

const URL_PREFIX_MARKER = '://';

const HOMOGRAPH_WARNING_HOSTNAME_LENGTH = 50;

function normalizeProtocols(values?: readonly string[]): Set<string> {
  const result = new Set<string>();
  if (!values) return result;
  values.forEach((value) => {
    if (typeof value === 'string' && value.trim()) {
      result.add(value.trim().toLowerCase());
    }
  });
  return result;
}

const isOptInProtocol = (protocol: string): boolean => OPTIONAL_PROTOCOLS.includes(protocol);

function buildAllowedProtocols(config: SanitizerConfig = {}): Set<string> {
  const allowed = config.allowedProtocols?.length
    ? normalizeProtocols(config.allowedProtocols)
    : new Set(DEFAULT_ALLOWED_PROTOCOLS);

  normalizeProtocols(config.optionalProtocols).forEach((protocol) => {
    if (isOptInProtocol(protocol)) {
      allowed.add(protocol);
    }
  });

  return allowed;
}

const isUrlPrefixBlocklistEntry = (entry: string): boolean => entry.includes(URL_PREFIX_MARKER);

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
    if (isUrlPrefixBlocklistEntry(trimmed)) {
      urls.add(trimmed);
    } else {
      hosts.add(trimmed);
    }
  });
  return { hosts, urls };
}

function parseAnchorLink(trimmed: string): AnchorLink | null {
  if (!trimmed.startsWith('#')) return null;

  const anchor = trimmed.slice(1);
  if (!anchor || !SAFE_ANCHOR_NAME_PATTERN.test(anchor)) {
    return null;
  }

  return { href: `#${anchor}`, protocol: null, isExternal: false };
}

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

const isHostWithoutScheme = (trimmed: string): boolean => trimmed.startsWith('//') || WWW_PREFIX_PATTERN.test(trimmed);

const currentPageHref = (): string | null => (typeof window !== 'undefined' ? window.location.href : null);

function parseUrl(input: string, base?: string): URL | null {
  try {
    return new URL(input, base);
  } catch {
    return null;
  }
}

function sanitizeRelativePath(pathString: string, blocklist: Blocklist): AnchorLink | null {
  if (CONTROL_OR_INVISIBLE_CHARACTER_PATTERN.test(pathString)) {
    return null;
  }

  const pageHref = currentPageHref();
  if (!pageHref) {
    return null;
  }

  const resolved = parseUrl(pathString, pageHref);
  if (!resolved) {
    return null;
  }

  if (resolved.origin !== new URL(pageHref).origin) {
    return null;
  }

  if (isBlockedByRedirectList(resolved.href, resolved, blocklist)) {
    return null;
  }

  return { href: resolved.href, protocol: null, isExternal: false };
}

function hostnameAsTyped(trimmed: string): string {
  const hostStartIndex = trimmed.indexOf(URL_PREFIX_MARKER) + URL_PREFIX_MARKER.length;
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
  return trimmed.slice(hostStartIndex, hostEndIndex).toLowerCase();
}

function warnIfHostnameMayBeHomograph(trimmed: string): void {
  const hostname = hostnameAsTyped(trimmed);
  if (!hostname || !NON_ASCII_CHARACTER_PATTERN.test(hostname)) return;
  if (process.env.NODE_ENV === 'development' || process.env.DEBUG_HYPERLINKS === 'true') {
    console.warn(
      `[URL Validation] Potential homograph attack detected in hostname: ${hostname.slice(0, HOMOGRAPH_WARNING_HOSTNAME_LENGTH)}`,
    );
  }
}

function queryHasAttributeBreakingCharacter(trimmed: string): boolean {
  const queryStartIndex = trimmed.indexOf('?');
  return queryStartIndex !== -1 && ATTRIBUTE_BREAKING_CHARACTER_PATTERN.test(trimmed.slice(queryStartIndex));
}

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

  if (isHostWithoutScheme(trimmed)) {
    return null;
  }

  const blocklist = normalizeBlocklist(config.redirectBlocklist);

  if (isRelativeUrl(trimmed)) {
    return sanitizeRelativePath(trimmed, blocklist);
  }

  const schemeMatch = trimmed.match(LEADING_SCHEME_PATTERN);
  if (!schemeMatch) {
    return null;
  }
  const scheme = schemeMatch[1].toLowerCase();

  const allowedProtocols = buildAllowedProtocols(config);
  const blockedProtocols = BLOCKED_PROTOCOLS.concat(config.blockedProtocols ?? []).map((p) => p.toLowerCase());

  if (!isProtocolAllowed(scheme, allowedProtocols, blockedProtocols)) {
    return null;
  }

  warnIfHostnameMayBeHomograph(trimmed);

  if (queryHasAttributeBreakingCharacter(trimmed)) {
    return null;
  }

  const parsed = parseUrl(trimmed);
  if (!parsed) {
    return null;
  }

  if (isBlockedByRedirectList(trimmed, parsed, blocklist)) {
    return null;
  }

  return { href: trimmed, protocol: scheme, isExternal: EXTERNAL_PROTOCOLS.includes(scheme) };
}

const tooltipTruncationLimit = (maxLength: number): number | null =>
  typeof maxLength === 'number' && maxLength > 0 ? maxLength : null;

export function encodeTooltip(
  raw: string | null | undefined,
  maxLength: number = DEFAULT_TOOLTIP_MAX_LENGTH,
): EncodedTooltip | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const limit = tooltipTruncationLimit(maxLength);
  const wasTruncated = limit !== null && trimmed.length > limit;

  return {
    text: wasTruncated ? trimmed.slice(0, limit) : trimmed,
    wasTruncated,
  };
}

export function isRelativeUrl(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('#')) return false;
  if (trimmed.startsWith('//')) return false;
  if (SCHEME_PREFIX_PATTERN.test(trimmed)) return false;
  return true;
}

export const UrlValidationConstants = {
  DEFAULT_ALLOWED_PROTOCOLS,
  OPTIONAL_PROTOCOLS,
  BLOCKED_PROTOCOLS,
  DEFAULT_MAX_LENGTH,
};

export { buildAllowedProtocols };
