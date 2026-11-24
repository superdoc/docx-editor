import { sanitizeHref } from '../../internal/toolbar/built-in/url-safety.js';

function isAbsoluteWebUrl(value: string): boolean {
  if (!/^https?:\/\/[^\s/?#\\]+/i.test(value) || /[\s\\]/u.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function trimUrlPunctuation(value: string): string {
  const closingDelimiter: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  const balance: Record<string, number> = { ')': 0, ']': 0, '}': 0 };
  for (const character of value) {
    const close = closingDelimiter[character];
    if (close) {
      balance[close] += 1;
    } else if (Object.prototype.hasOwnProperty.call(balance, character)) {
      balance[character] -= 1;
    }
  }

  let end = value.length;
  while (end > 0) {
    const character = value[end - 1];
    if ('.,!?;:'.includes(character)) {
      end -= 1;
    } else if (balance[character] < 0) {
      balance[character] += 1;
      end -= 1;
    } else {
      break;
    }
  }
  return value.slice(0, end);
}

function configureLink(link: Element, href: string): void {
  link.setAttribute('href', href);
  link.setAttribute('target', '_blank');
  link.setAttribute('rel', 'noopener noreferrer');
}

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

const NO_ATTRIBUTES: ReadonlySet<string> = new Set();

const ALLOWED_COMMENT_ELEMENTS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['p', NO_ATTRIBUTES],
  ['br', NO_ATTRIBUTES],
  ['b', NO_ATTRIBUTES],
  ['strong', NO_ATTRIBUTES],
  ['i', NO_ATTRIBUTES],
  ['em', NO_ATTRIBUTES],
  ['u', NO_ATTRIBUTES],
  ['s', NO_ATTRIBUTES],
  ['code', NO_ATTRIBUTES],
  ['pre', NO_ATTRIBUTES],
  ['strike', NO_ATTRIBUTES],
  ['del', NO_ATTRIBUTES],
  ['ins', NO_ATTRIBUTES],
  ['sub', NO_ATTRIBUTES],
  ['sup', NO_ATTRIBUTES],
  ['mark', NO_ATTRIBUTES],
  ['div', NO_ATTRIBUTES],
  ['blockquote', NO_ATTRIBUTES],
  ['h1', NO_ATTRIBUTES],
  ['h2', NO_ATTRIBUTES],
  ['h3', NO_ATTRIBUTES],
  ['h4', NO_ATTRIBUTES],
  ['h5', NO_ATTRIBUTES],
  ['h6', NO_ATTRIBUTES],
  ['ul', NO_ATTRIBUTES],
  ['ol', NO_ATTRIBUTES],
  ['li', NO_ATTRIBUTES],
  ['table', NO_ATTRIBUTES],
  ['thead', NO_ATTRIBUTES],
  ['tbody', NO_ATTRIBUTES],
  ['tfoot', NO_ATTRIBUTES],
  ['tr', NO_ATTRIBUTES],
  ['td', NO_ATTRIBUTES],
  ['th', NO_ATTRIBUTES],
  ['a', new Set(['href'])],
]);

const MENTION_ATTRIBUTES: ReadonlySet<string> = new Set(['data-type', 'name', 'email']);

const ELEMENTS_DROPPED_WITH_CONTENT: ReadonlySet<string> = new Set([
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
]);

function isMentionSpan(element: Element): boolean {
  return element.localName === 'span' && element.getAttribute('data-type') === 'mention';
}

function allowedAttributesFor(element: Element): ReadonlySet<string> | null {
  if (isMentionSpan(element)) return MENTION_ATTRIBUTES;
  return ALLOWED_COMMENT_ELEMENTS.get(element.localName) ?? null;
}

function sanitizeCommentChildren(parent: ParentNode): void {
  for (const child of Array.from(parent.childNodes)) {
    if (child instanceof Text) continue;
    if (!(child instanceof Element)) {
      child.remove();
      continue;
    }
    if (child.namespaceURI !== HTML_NAMESPACE || ELEMENTS_DROPPED_WITH_CONTENT.has(child.localName)) {
      child.remove();
      continue;
    }
    sanitizeCommentChildren(child);
    const allowedAttributes = allowedAttributesFor(child);
    if (!allowedAttributes) {
      child.replaceWith(...Array.from(child.childNodes));
      continue;
    }
    for (const attribute of Array.from(child.attributes)) {
      if (!allowedAttributes.has(attribute.name)) child.removeAttribute(attribute.name);
    }
  }
}

export function renderCommentHtml(value: unknown): string {
  if (typeof value !== 'string') return '';
  if (typeof document === 'undefined') return '';
  const template = document.createElement('template');
  template.innerHTML = value;
  sanitizeCommentChildren(template.content);

  for (const link of Array.from(template.content.querySelectorAll('a'))) {
    const rawHref = link.getAttribute('href');
    const safe = rawHref === null ? null : sanitizeHref(rawHref);
    // Preserve existing mail/tel links; only absolute web URLs are auto-detected.
    if (safe && (isAbsoluteWebUrl(safe.href) || /^(mailto|tel):\S+$/i.test(safe.href))) {
      configureLink(link, safe.href);
    } else {
      link.replaceWith(...Array.from(link.childNodes));
    }
  }

  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    if (walker.currentNode instanceof Text) textNodes.push(walker.currentNode);
  }
  for (const node of textNodes) {
    if (node.parentElement?.closest('a, script, style, textarea, code, pre')) continue;
    const text = node.data;
    const fragment = document.createDocumentFragment();
    let end = 0;
    for (const match of text.matchAll(/(^|[\s([{])(https?:\/\/[^\s<>"']+)/gi)) {
      const href = trimUrlPunctuation(match[2]);
      if (!isAbsoluteWebUrl(href)) continue;
      const start = match.index + match[1].length;
      fragment.append(document.createTextNode(text.slice(end, start)));
      const link = document.createElement('a');
      configureLink(link, href);
      link.textContent = href;
      fragment.append(link);
      end = start + href.length;
    }
    if (end === 0) continue;
    fragment.append(document.createTextNode(text.slice(end)));
    node.replaceWith(fragment);
  }
  return template.innerHTML;
}
