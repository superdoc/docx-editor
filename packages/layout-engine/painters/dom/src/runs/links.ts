import type { FlowRunLink } from '@superdoc/contracts';
import { encodeTooltip, sanitizeHref } from '@superdoc/url-validation';
import type { LinkRenderData, RunRenderContext } from './types.js';

const LINK_DATASET_KEYS = {
  blocked: 'linkBlocked',
  docLocation: 'linkDocLocation',
  history: 'linkHistory',
  rId: 'linkRid',
  truncated: 'linkTooltipTruncated',
} as const;

const MAX_HREF_LENGTH = 2048;
const SAFE_ANCHOR_PATTERN = /^[A-Za-z0-9._=-]+$/;
const SAFE_WORD_BOOKMARK_ANCHOR_PATTERN = /^[A-Za-z0-9._=\-[\]]+$/;
const VALID_BOOKMARK_ANCHOR_PATTERN = /^[\p{L}_][\p{L}\p{Mn}\p{Mc}\p{Nd}_]*$/u;
const AMBIGUOUS_LINK_PATTERNS = /^(click here|read more|more|link|here|this|download|view)$/i;
const INVALID_TARGET_CHARS = /[\u0000-\u001F\u007F]/;

/**
 * Hyperlink rendering metrics for observability.
 * Tracks sanitization, blocking, and security-related events.
 */
export const linkMetrics = {
  sanitized: 0,
  blocked: 0,
  invalidProtocol: 0,
  homographWarnings: 0,

  reset() {
    this.sanitized = 0;
    this.blocked = 0;
    this.invalidProtocol = 0;
    this.homographWarnings = 0;
  },

  getMetrics() {
    return {
      'hyperlink.sanitized.count': this.sanitized,
      'hyperlink.blocked.count': this.blocked,
      'hyperlink.invalid_protocol.count': this.invalidProtocol,
      'hyperlink.homograph_warnings.count': this.homographWarnings,
    };
  },
};

/**
 * Sanitize a URL to prevent XSS attacks.
 * Only allows http, https, mailto, tel, and internal anchors.
 *
 * @param href - The URL to sanitize
 * @returns Sanitized URL or null if blocked
 */
export function sanitizeUrl(href: string): string | null {
  if (typeof href !== 'string') return null;
  const sanitized = sanitizeHref(href);
  return sanitized?.href ?? null;
}

/**
 * Normalize and validate an anchor fragment identifier for use in hyperlinks.
 * Strips leading '#' if present and URL-encodes supported Word bookmark
 * punctuation that is not safe as a raw fragment.
 *
 * @param value - Raw anchor string (with or without leading '#')
 * @returns Normalized anchor with leading '#' (e.g., '#section-1'), or null if invalid
 *
 * @remarks
 * SECURITY: Preserves existing safe ASCII and Word bookmark punctuation (including equals), and percent-encodes
 * valid Unicode bookmark names. Rejects controls, quotes, angle brackets, colons, and spaces.
 *
 * @example
 * normalizeAnchor('section-1') // Returns: '#section-1'
 * normalizeAnchor('#bookmark') // Returns: '#bookmark'
 * normalizeAnchor('unsafe<script>') // Returns: null
 * normalizeAnchor('  whitespace  ') // Returns: null
 */
const normalizeAnchor = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string' || !value) return null;

  // Retain legacy whitespace handling for safe ASCII and imported Word punctuation.
  const legacyValue = value.trim();
  const legacyAnchor = legacyValue.startsWith('#') ? legacyValue.slice(1) : legacyValue;
  if (SAFE_ANCHOR_PATTERN.test(legacyAnchor)) return `#${legacyAnchor}`;
  if (SAFE_WORD_BOOKMARK_ANCHOR_PATTERN.test(legacyAnchor)) {
    const encoded = encodeFragment(legacyAnchor);
    return encoded ? `#${encoded}` : null;
  }

  // Valid Unicode bookmark names retain exact identity; never trim or normalize them.
  const anchor = value.startsWith('#') ? value.slice(1) : value;
  if (anchor.length <= 40 && VALID_BOOKMARK_ANCHOR_PATTERN.test(anchor)) {
    const encoded = encodeFragment(anchor);
    return encoded ? `#${encoded}` : null;
  }

  return null;
};

/**
 * Check if a fragment string contains only safe anchor characters.
 * Safe characters are alphanumeric, dots, underscores, equals signs, and hyphens.
 *
 * @param {string} fragment - Fragment to validate
 * @returns {boolean} True if fragment matches safe pattern
 * @private
 */
const isValidSafeFragment = (fragment: string): boolean => {
  return SAFE_ANCHOR_PATTERN.test(fragment);
};

/**
 * URL-encode a fragment string for use in a URL hash.
 * Returns null if encoding fails (rare edge case).
 *
 * @param {string} fragment - Fragment to encode
 * @returns {string | null} Encoded fragment or null if encoding fails
 * @private
 */
const encodeFragment = (fragment: string): string | null => {
  try {
    return encodeURIComponent(fragment);
  } catch {
    return null;
  }
};

/**
 * Append a document location fragment to an href.
 * CRITICAL FIX: URL-encode unsafe characters instead of destroying the entire href.
 *
 * @param href - Base URL or null
 * @param docLocation - Fragment identifier to append
 * @returns Combined URL with fragment, or original href if fragment is invalid
 */
const appendDocLocation = (href: string | null, docLocation?: string | null): string | null => {
  if (!docLocation?.trim()) return href;

  const fragment = docLocation.trim();
  if (href?.includes('#')) return href;

  const encoded = isValidSafeFragment(fragment) ? fragment : encodeFragment(fragment);

  if (!encoded) return href;
  return href ? `${href}#${encoded}` : `#${encoded}`;
};

/**
 * Build HTML data-* attributes object from hyperlink metadata for version 2 links.
 * Extracts relationship ID, document location fragment, and history preferences from link object.
 *
 * @param link - Flow run link object containing hyperlink metadata
 * @returns Record of data attribute keys and string values to be applied to anchor element
 *
 * @remarks
 * Only processes version 2 links (Office Open XML format). Version 1 links return empty object.
 * All dataset values are converted to strings for DOM compatibility.
 *
 * @example
 * buildLinkDataset({
 *   version: 2,
 *   rId: 'rId5',
 *   docLocation: 'bookmark1',
 *   history: true
 * })
 * // Returns: { rId: 'rId5', docLocation: 'bookmark1', history: 'true' }
 */
const buildLinkDataset = (link: FlowRunLink): Record<string, string> => {
  const dataset: Record<string, string> = {};
  if (link.version === 2) {
    if (link.rId) dataset[LINK_DATASET_KEYS.rId] = link.rId;
    if (link.docLocation) dataset[LINK_DATASET_KEYS.docLocation] = link.docLocation;
    if (typeof link.history === 'boolean') dataset[LINK_DATASET_KEYS.history] = String(link.history);
  }
  return dataset;
};

/**
 * Resolve the appropriate target attribute for a hyperlink anchor element.
 * Validates user-specified targets and auto-sets '_blank' for external HTTP(S) links.
 *
 * @param link - Flow run link object potentially containing target preference
 * @param sanitized - Sanitized URL metadata containing protocol information, or null if sanitization failed
 * @returns Valid target string ('_blank', '_self', '_parent', '_top') or undefined if not applicable
 */
const resolveLinkTarget = (
  link: FlowRunLink,
  sanitized?: ReturnType<typeof sanitizeHref> | null,
): string | undefined => {
  if (typeof link.target === 'string') {
    const target = link.target.trim();
    if (target && !INVALID_TARGET_CHARS.test(target)) return target;
  }
  if (sanitized && (sanitized.protocol === 'http' || sanitized.protocol === 'https')) {
    return '_blank';
  }
  return undefined;
};

/**
 * Resolve the rel attribute value for a hyperlink, combining user-specified relationships
 * with security-critical values for external links.
 *
 * @param link - Flow run link object potentially containing rel preference (space-separated string)
 * @param target - Resolved target attribute value (e.g., '_blank', '_self')
 * @returns Space-separated rel values, or undefined if no rel values apply
 */
const resolveLinkRel = (link: FlowRunLink, target?: string): string | undefined => {
  const relValues = new Set<string>();
  if (typeof link.rel === 'string' && link.rel.trim()) {
    link.rel
      .trim()
      .split(/\s+/)
      .forEach((value) => {
        if (value) relValues.add(value);
      });
  }
  if (target === '_blank') {
    relValues.add('noopener');
    relValues.add('noreferrer');
  }
  if (relValues.size === 0) {
    return undefined;
  }
  return Array.from(relValues).join(' ');
};

/**
 * Apply data-* attributes to an HTML element from a dataset object.
 * Safely assigns dataset properties while filtering out null/undefined values.
 *
 * @param element - Target HTML element to receive data attributes
 * @param dataset - Object mapping data attribute keys to string values
 */
export const applyLinkDataset = (element: HTMLElement, dataset?: Record<string, string>): void => {
  if (!dataset) return;
  Object.entries(dataset).forEach(([key, value]) => {
    if (value != null) {
      element.dataset[key] = value;
    }
  });
};

export const buildLinkRenderData = (link: FlowRunLink): LinkRenderData | null => {
  const dataset = buildLinkDataset(link);
  const sanitized = typeof link.href === 'string' ? sanitizeHref(link.href) : null;
  const anchorHref = normalizeAnchor(link.anchor ?? link.name ?? '');
  let href: string | null = sanitized?.href ?? anchorHref;
  if (link.version === 2) {
    href = appendDocLocation(href, link.docLocation ?? null);
  }

  // Track metrics: successful sanitization
  if (sanitized) {
    linkMetrics.sanitized++;

    // Check for homograph if hostname has non-ASCII (in raw href before URL parsing)
    if (sanitized.href && typeof link.href === 'string') {
      const hostStartIndex = link.href.indexOf('://') + 3;
      let hostEndIndex = link.href.indexOf('/', hostStartIndex);
      if (hostEndIndex === -1) {
        hostEndIndex = link.href.indexOf('?', hostStartIndex);
      }
      if (hostEndIndex === -1) {
        hostEndIndex = link.href.indexOf('#', hostStartIndex);
      }
      if (hostEndIndex === -1) {
        hostEndIndex = link.href.length;
      }
      const rawHostname = link.href.slice(hostStartIndex, hostEndIndex);
      if (rawHostname && /[^\x00-\x7F]/.test(rawHostname)) {
        linkMetrics.homographWarnings++;
      }
    }
  }

  // Defense-in-depth: Enforce maximum URL length even if sanitization was bypassed
  if (sanitized && sanitized.href.length > MAX_HREF_LENGTH) {
    console.warn(`[DomPainter] Rejecting URL exceeding ${MAX_HREF_LENGTH} characters`);
    linkMetrics.blocked++;
    return { blocked: true, dataset: { [LINK_DATASET_KEYS.blocked]: 'true' } };
  }

  if (!href) {
    if (typeof link.href === 'string' && link.href.trim()) {
      dataset[LINK_DATASET_KEYS.blocked] = 'true';
      console.warn(`[DomPainter] Blocked potentially unsafe URL: ${link.href.slice(0, 50)}`);
      linkMetrics.blocked++;
      // Track invalid protocol if sanitized was null
      if (!sanitized) {
        linkMetrics.invalidProtocol++;
      }
      return { blocked: true, dataset };
    }
    // Check if there was an anchor/name that failed validation
    const hadAnchor = (link.anchor ?? link.name ?? null) != null;
    if (Object.keys(dataset).length > 0 || hadAnchor) {
      dataset[LINK_DATASET_KEYS.blocked] = 'true';
      linkMetrics.blocked++;
      return { blocked: true, dataset };
    }
    return null;
  }

  const target = resolveLinkTarget(link, sanitized);
  const rel = resolveLinkRel(link, target);
  const tooltipSource = link.version === 2 ? (link.tooltip ?? link.title) : link.title;
  const tooltipResult = tooltipSource ? encodeTooltip(tooltipSource) : null;
  // Use raw text - browser will escape when setting attribute
  const tooltip = tooltipResult?.text ?? null;

  // Signal when tooltip is truncated
  if (tooltipResult?.wasTruncated) {
    dataset[LINK_DATASET_KEYS.truncated] = 'true';
  }

  return {
    href,
    target,
    rel,
    tooltip,
    dataset: Object.keys(dataset).length > 0 ? dataset : undefined,
    blocked: false,
  };
};

/**
 * Apply tooltip accessibility using aria-describedby for better screen reader support.
 * Creates a visually-hidden element containing the tooltip text and links it to the anchor.
 *
 * @param elem - The anchor element to enhance
 * @param tooltip - The tooltip text to make accessible
 * @returns The unique ID generated for this link
 */
export const applyTooltipAccessibility = (
  elem: HTMLAnchorElement,
  tooltip: string | null,
  context: RunRenderContext,
): string => {
  const linkId = context.getNextLinkId();
  elem.id = linkId;

  if (!tooltip) return linkId;

  // Keep title attribute for visual tooltip (browser default)
  elem.setAttribute('title', tooltip);

  // Create visually-hidden element for screen readers
  const descId = `link-desc-${linkId}`;
  const descElem = context.doc.createElement('span');
  descElem.id = descId;
  descElem.className = 'superdoc-sr-only'; // Screen reader only class
  descElem.textContent = tooltip;

  // Insert description element after the link
  // Note: We'll insert it as a sibling in the parent line element
  if (elem.parentElement) {
    elem.parentElement.appendChild(descElem);
    // Reference from link only if we successfully added the description element
    elem.setAttribute('aria-describedby', descId);
  } else {
    // Element not yet in DOM - accessibility feature will degrade gracefully
    // The title attribute will still provide tooltip functionality
    console.warn('[DomPainter] Unable to add aria-describedby for tooltip (element not in DOM)');
  }

  return linkId;
};

/**
 * Enhance accessibility of a link element with ARIA labels and attributes.
 * Adds descriptive ARIA labels for ambiguous text and target=_blank links (WCAG 2.4.4).
 *
 * @param elem - The anchor element to enhance
 * @param linkData - Link metadata including href and target
 * @param textContent - The visible link text to analyze for ambiguity
 */
export const enhanceAccessibility = (elem: HTMLAnchorElement, linkData: LinkRenderData, textContent: string): void => {
  if (!linkData.href) return;

  const trimmedText = textContent.trim().toLowerCase();

  // Check if link text is ambiguous (e.g., "click here", "read more")
  if (AMBIGUOUS_LINK_PATTERNS.test(trimmedText)) {
    try {
      const url = new URL(linkData.href);
      const hostname = url.hostname.replace(/^www\./, '');

      // Generate descriptive aria-label for screen readers
      const ariaLabel = `${textContent.trim()} - ${hostname}`;
      elem.setAttribute('aria-label', ariaLabel);
      return; // Exit early since we've set the label
    } catch {
      // If URL parsing fails, add generic label
      elem.setAttribute('aria-label', `${textContent.trim()} - external link`);
      return;
    }
  }

  // Add aria-label for external links without one (indicates new tab)
  if (linkData.target === '_blank' && !elem.getAttribute('aria-label')) {
    elem.setAttribute('aria-label', `${textContent.trim()} (opens in new tab)`);
  }
};

/**
 * Apply link attributes to an anchor element.
 */
export const applyLinkAttributes = (elem: HTMLAnchorElement, linkData: LinkRenderData): void => {
  if (!linkData.href) return;
  elem.href = linkData.href;
  elem.classList.add('superdoc-link');

  if (linkData.target) {
    elem.target = linkData.target;
  } else {
    elem.removeAttribute('target');
  }
  if (linkData.rel) {
    elem.rel = linkData.rel;
  } else {
    elem.removeAttribute('rel');
  }
  if (linkData.tooltip) {
    elem.title = linkData.tooltip;
  } else {
    elem.removeAttribute('title');
  }

  // Explicitly set role for clarity (though <a> with href has implicit role="link")
  elem.setAttribute('role', 'link');

  // Ensure link is keyboard accessible (should be default for <a>, but verify)
  elem.setAttribute('tabindex', '0');

  // Note: Click handling is done via event delegation in EditorInputManager,
  // not per-element handlers. This avoids duplicate event dispatching.
};
