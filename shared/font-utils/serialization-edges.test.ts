import { describe, expect, it } from 'bun:test';
import { toCssFontFamily } from './index.js';

describe('wordFamily values that are Object.prototype keys', () => {
  for (const wordFamily of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']) {
    it(`treats ${wordFamily} as an unknown family`, () => {
      expect(toCssFontFamily('Missing Face', { wordFamily })).toBe('Missing Face, sans-serif');
    });
  }
  it('still maps a known family', () => {
    expect(toCssFontFamily('Missing Face', { wordFamily: 'roman' })).toBe('Missing Face, Times New Roman, serif');
  });
});

describe('escaping characters in quoted families', () => {
  it('escapes control characters as lowercase hex followed by a space', () => {
    expect(toCssFontFamily('Acme\u0001Sans')).toBe('"Acme\\1 Sans", sans-serif');
    expect(toCssFontFamily('Acme\u001fSans')).toBe('"Acme\\1f Sans", sans-serif');
  });
  it('escapes DEL as hex and a double quote with a backslash', () => {
    expect(toCssFontFamily('Acme\u007f"Sans')).toBe('"Acme\\7f \\"Sans", sans-serif');
  });
  it('escapes a backslash', () => {
    expect(toCssFontFamily('Acme\\Sans')).toBe('"Acme\\\\Sans", sans-serif');
  });
  it('keeps supplementary-plane characters intact', () => {
    expect(toCssFontFamily('Acme 😀 Sans')).toBe('Acme 😀 Sans, sans-serif');
    expect(toCssFontFamily('Acme 3 😀')).toBe('"Acme 3 😀", sans-serif');
  });
});
