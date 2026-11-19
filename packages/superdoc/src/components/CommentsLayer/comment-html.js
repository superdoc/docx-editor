const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

const STYLE_ONLY = new Set(['style']);
const TABLE_CELL_ATTRIBUTES = new Set(['style', 'colspan', 'rowspan']);
const LINK_ATTRIBUTES = new Set(['style', 'href']);
const IMAGE_ATTRIBUTES = new Set(['style', 'src', 'alt', 'width', 'height']);
const MENTION_ATTRIBUTES = new Set(['style', 'data-type', 'name', 'email', 'class', 'aria-label']);

const ALLOWED_ELEMENTS = new Map([
  ['p', STYLE_ONLY],
  ['br', STYLE_ONLY],
  ['span', STYLE_ONLY],
  ['b', STYLE_ONLY],
  ['strong', STYLE_ONLY],
  ['i', STYLE_ONLY],
  ['em', STYLE_ONLY],
  ['u', STYLE_ONLY],
  ['s', STYLE_ONLY],
  ['strike', STYLE_ONLY],
  ['del', STYLE_ONLY],
  ['ins', STYLE_ONLY],
  ['sub', STYLE_ONLY],
  ['sup', STYLE_ONLY],
  ['mark', STYLE_ONLY],
  ['code', STYLE_ONLY],
  ['pre', STYLE_ONLY],
  ['blockquote', STYLE_ONLY],
  ['h1', STYLE_ONLY],
  ['h2', STYLE_ONLY],
  ['h3', STYLE_ONLY],
  ['h4', STYLE_ONLY],
  ['h5', STYLE_ONLY],
  ['h6', STYLE_ONLY],
  ['ul', STYLE_ONLY],
  ['ol', STYLE_ONLY],
  ['li', STYLE_ONLY],
  ['table', STYLE_ONLY],
  ['thead', STYLE_ONLY],
  ['tbody', STYLE_ONLY],
  ['tfoot', STYLE_ONLY],
  ['tr', STYLE_ONLY],
  ['td', TABLE_CELL_ATTRIBUTES],
  ['th', TABLE_CELL_ATTRIBUTES],
  ['a', LINK_ATTRIBUTES],
  ['img', IMAGE_ATTRIBUTES],
]);

const ELEMENTS_DROPPED_WITH_CONTENT = new Set([
  'script',
  'style',
  'template',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'svg',
  'math',
  'noscript',
  'noembed',
  'noframes',
  'textarea',
  'select',
  'title',
  'xmp',
  'plaintext',
  'head',
  'link',
  'meta',
  'base',
]);

const ALLOWED_STYLE_PROPERTIES = [
  'color',
  'background-color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-decoration',
  'text-decoration-line',
  'text-align',
];

const IMAGE_STYLE_RULES = new Map([
  ['width', /^\d+(\.\d+)?px$/],
  ['height', /^(\d+(\.\d+)?px|auto)$/],
  ['object-fit', /^(cover|contain|fill|none|scale-down)$/],
  ['object-position', /^(left|right|center|top|bottom)( (left|right|center|top|bottom))?$/],
]);

const UNSAFE_STYLE_VALUE = /url\s*\(|expression\s*\(|image-set\s*\(|[\\<>]/i;

const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:', 'sms:']);
const IN_DOCUMENT_ANCHOR = /^#[A-Za-z0-9._-]+$/;
const SAFE_IMAGE_DATA_URL = /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i;

/**
 * @param {string} rawSrc
 * @returns {string | null}
 */
function safeImageSrc(rawSrc) {
  const src = rawSrc.trim();
  if (SAFE_IMAGE_DATA_URL.test(src)) return src;
  if (!src || /[\u0000-\u001f\u007f]/.test(src)) return null;
  try {
    const url = new URL(src);
    return url.protocol === 'https:' || url.protocol === 'http:' ? src : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} rawHref
 * @returns {string | null}
 */
function safeHref(rawHref) {
  const href = rawHref.trim();
  if (!href || /[\u0000-\u001f\u007f]/.test(href)) return null;
  try {
    const url = new URL(href);
    return SAFE_LINK_PROTOCOLS.has(url.protocol) ? href : null;
  } catch {
    return null;
  }
}

/**
 * @param {HTMLElement} element
 */
function filterStyle(element) {
  const declaration = element.style;
  const kept = [];
  for (const property of ALLOWED_STYLE_PROPERTIES) {
    const value = declaration.getPropertyValue(property);
    if (value && !UNSAFE_STYLE_VALUE.test(value)) kept.push(`${property}: ${value}`);
  }
  if (element.localName === 'img') {
    for (const [property, rule] of IMAGE_STYLE_RULES) {
      const value = declaration.getPropertyValue(property).trim();
      if (rule.test(value)) kept.push(`${property}: ${value}`);
    }
  }
  element.removeAttribute('style');
  if (kept.length > 0) element.setAttribute('style', kept.join('; '));
}

/**
 * @param {Element} element
 * @returns {Set<string> | null}
 */
function allowedAttributesFor(element) {
  if (element.localName === 'span' && element.getAttribute('data-type') === 'mention') return MENTION_ATTRIBUTES;
  return ALLOWED_ELEMENTS.get(element.localName) ?? null;
}

/**
 * @param {ParentNode} parent
 */
function sanitizeChildren(parent) {
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === 3) continue;
    if (child.nodeType !== 1) {
      child.remove();
      continue;
    }
    const element = /** @type {HTMLElement} */ (child);
    if (element.namespaceURI !== HTML_NAMESPACE || ELEMENTS_DROPPED_WITH_CONTENT.has(element.localName)) {
      element.remove();
      continue;
    }
    sanitizeChildren(element);
    const allowedAttributes = allowedAttributesFor(element);
    if (!allowedAttributes) {
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      if (!allowedAttributes.has(attribute.name)) element.removeAttribute(attribute.name);
    }
    if (element.hasAttribute('style')) filterStyle(element);
    if (element.localName === 'img') {
      const src = element.getAttribute('src');
      const safe = src === null ? null : safeImageSrc(src);
      if (!safe) {
        element.remove();
        continue;
      }
      element.setAttribute('src', safe);
    }
    if (element.localName === 'a') {
      const href = element.getAttribute('href')?.trim() ?? '';
      if (IN_DOCUMENT_ANCHOR.test(href)) {
        element.setAttribute('href', href);
        continue;
      }
      const safe = safeHref(href);
      if (!safe) {
        element.replaceWith(...Array.from(element.childNodes));
        continue;
      }
      element.setAttribute('href', safe);
      element.setAttribute('target', '_blank');
      element.setAttribute('rel', 'noopener noreferrer');
    }
  }
}

/**
 * Sanitize stored comment HTML before it reaches the live DOM.
 *
 * @param {unknown} value Stored comment HTML.
 * @returns {string} HTML limited to supported comment formatting.
 */
export function sanitizeCommentHtml(value) {
  if (typeof value !== 'string' || !value) return '';
  if (typeof DOMParser === 'undefined') return '';
  const body = new DOMParser().parseFromString(value, 'text/html').body;
  sanitizeChildren(body);
  return body.innerHTML;
}
