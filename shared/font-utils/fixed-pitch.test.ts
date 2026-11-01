import { describe, it, expect } from 'bun:test';
import { toCssFontFamily } from './index.js';

describe('fixed-pitch fallback', () => {
  for (const name of ['Courier New', 'consolas', '"Courier New"', ' COURIER ']) {
    it(`recognizes ${name} without document metadata`, () => {
      expect(toCssFontFamily(name).split(',').at(-1).trim()).toBe('monospace');
    });
  }
  for (const options of [
    { pitch: 'fixed' },
    { pitch: 'fixed', wordFamily: 'swiss' },
    { pitch: 'fixed', wordFamily: 'roman' },
    { pitch: 'variable', wordFamily: 'modern' },
  ]) {
    it(`honors ${JSON.stringify(options)}`, () => {
      expect(toCssFontFamily('Missing Face', options).split(',').at(-1).trim()).toBe('monospace');
    });
  }
  it('keeps explicit stacks and overrides authoritative', () => {
    expect(toCssFontFamily('Consolas, serif', { pitch: 'fixed' })).toBe('Consolas, serif');
    expect(toCssFontFamily('Consolas', { pitch: 'fixed', fallback: 'serif' })).toBe('Consolas, serif');
  });
  it('uses the name heuristic for unknown or automatic classification', () => {
    expect(toCssFontFamily('Consolas', { wordFamily: 'auto' })).toBe('Consolas, monospace');
    expect(toCssFontFamily('Cambria', { wordFamily: 'unknown' })).toBe('Cambria, serif');
    expect(toCssFontFamily('Missing Face', { pitch: 'invalid' })).toBe('Missing Face, sans-serif');
  });
});
