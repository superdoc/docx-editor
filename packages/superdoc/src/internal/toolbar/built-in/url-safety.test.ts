import { describe, expect, it } from 'vite-plus/test';
import { sanitizeHref } from './url-safety.js';

describe('built-in toolbar sanitizeHref', () => {
  it.each([
    ['tab', '\t'],
    ['LF', '\n'],
    ['CR', '\r'],
  ])('rejects a %s anywhere inside the link', (_name, character) => {
    expect(sanitizeHref(`java${character}script:alert(1)`)).toBeNull();
    expect(sanitizeHref(`ht${character}tps://example.com/`)).toBeNull();
    expect(sanitizeHref(`https://exa${character}mple.com/`)).toBeNull();
    expect(sanitizeHref(`https://example.com/pa${character}th`)).toBeNull();
    expect(sanitizeHref(`#sec${character}tion`)).toBeNull();
    expect(sanitizeHref(`example${character}.com`)).toBeNull();
  });

  it.each([
    ['NUL', '\u0000'],
    ['SOH', '\u0001'],
    ['unit separator', '\u001f'],
  ])('rejects a dangerous scheme behind a leading %s, which the URL parser strips', (_name, character) => {
    expect(sanitizeHref(`${character}javascript:alert(1)`)).toBeNull();
    expect(sanitizeHref(`${character}${character}data:text/html,x`)).toBeNull();
    expect(sanitizeHref(`${character}vbscript:x`)).toBeNull();
    expect(sanitizeHref(`${character}ftp://example.com`)).toBeNull();
  });

  it('keeps a safe link with surrounding C0 controls as written', () => {
    expect(sanitizeHref('\u0001https://example.com/\u0000')).toEqual({ href: '\u0001https://example.com/\u0000' });
  });

  it('still accepts a link whose only tab or newline is surrounding whitespace', () => {
    expect(sanitizeHref('\t\r\nhttps://example.com/path\r\n\t')).toEqual({ href: 'https://example.com/path' });
  });

  it('keeps accepting safe links and rejecting dangerous schemes', () => {
    expect(sanitizeHref('https://example.com/a%09b')).toEqual({ href: 'https://example.com/a%09b' });
    expect(sanitizeHref('mailto:user@example.com')).toEqual({ href: 'mailto:user@example.com' });
    expect(sanitizeHref('#section')).toEqual({ href: '#section' });
    expect(sanitizeHref('example.com')).toEqual({ href: 'example.com' });
    expect(sanitizeHref('javascript:alert(1)')).toBeNull();
    expect(sanitizeHref('ftp://example.com')).toBeNull();
  });
});
