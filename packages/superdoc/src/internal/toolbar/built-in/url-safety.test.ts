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
