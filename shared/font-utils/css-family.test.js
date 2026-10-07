import { describe, it, expect } from 'bun:test';
import { toCssFontFamily } from './index.js';

describe('CSS family serialization', () => {
  for (const name of ['Acme Sans 45 Light', 'Acme Sans 3', 'Acme.Sans Light', 'Acme Sans (Body)']) {
    it(`quotes ${name} without changing the logical family`, () => {
      expect(toCssFontFamily(name)).toBe(`"${name}", sans-serif`);
      expect(toCssFontFamily(toCssFontFamily(name))).toBe(`"${name}", sans-serif`);
    });
  }
  it('preserves ordinary identifier names and generic fallbacks', () => {
    expect(toCssFontFamily('Acme Sans Light')).toBe('Acme Sans Light, sans-serif');
    expect(toCssFontFamily('Arial-123')).toBe('Arial-123, sans-serif');
    expect(toCssFontFamily('微软雅黑')).toBe('微软雅黑, sans-serif');
    expect(toCssFontFamily('serif')).toBe('serif, sans-serif');
    expect(toCssFontFamily('inherit')).toBeUndefined();
  });
  it('serializes numeric and punctuation families in explicit fallback stacks', () => {
    expect(toCssFontFamily('Acme Sans 3, Arial, sans-serif')).toBe('"Acme Sans 3", Arial, sans-serif');
    expect(toCssFontFamily('Acme Sans 3;Arial')).toBe('"Acme Sans 3", Arial, sans-serif');
    expect(toCssFontFamily('Acme Sans 3', { fallback: 'Other 55, serif' })).toBe('"Acme Sans 3", "Other 55", serif');
    expect(toCssFontFamily('Acme Sans 3', { fallback: 'Acme Sans 3, serif' })).toBe('"Acme Sans 3", serif');
  });
  it('preserves quoted names and escapes literal quotes and backslashes', () => {
    expect(toCssFontFamily('"Acme Sans 3"')).toBe('"Acme Sans 3", sans-serif');
    expect(toCssFontFamily("'Acme Sans 3'")).toBe("'Acme Sans 3', sans-serif");
    expect(toCssFontFamily('Acme "Body"')).toBe(String.raw`"Acme \"Body\"", sans-serif`);
    expect(toCssFontFamily('Acme\\Body')).toBe('"Acme\\\\Body", sans-serif');
    expect(toCssFontFamily('"Acme;Body";Arial')).toBe('"Acme;Body", Arial, sans-serif');
  });
});
