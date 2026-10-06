import { describe, expect, test } from 'bun:test';
import { getGenericFontFamily, toCssFontFamily } from './index.js';

describe('generic in the rendered font stack', () => {
  test.each([
    ['Cambria', 'serif'],
    ['Aptos Display', 'sans-serif'],
    ['Consolas', 'monospace'],
    ['Unknown, serif, monospace', 'serif'],
    ['Unknown, another unknown', null],
    ['"Acme, Inc", monospace', 'monospace'],
    ['"serif", fantasy', 'fantasy'],
    ['"Acme\\\" Serif, Inc", serif', 'serif'],
    ['Missing, SYSTEM-UI', 'system-ui'],
    ['Missing, ui-serif', 'ui-serif'],
    ['Missing, ui-sans-serif', 'ui-sans-serif'],
    ['Missing, ui-monospace', 'ui-monospace'],
    ['Missing, ui-rounded', 'ui-rounded'],
    ['Missing, emoji', 'emoji'],
    ['Missing, math', 'math'],
    ['Missing, fangsong', 'fangsong'],
    ['', null],
    ['inherit', null],
    [null, null],
    [undefined, null],
  ])('%s -> %s', (stack, generic) => expect(getGenericFontFamily(stack)).toBe(generic));

  test('keeps escaped quotes intact while normalizing a semicolon stack', () => {
    expect(toCssFontFamily('"Acme\\\";Serif";Cambria')).toBe('"Acme\\\";Serif", Cambria, sans-serif');
  });
});
