import { describe, it, expect } from 'vite-plus/test';
import { formatPageNumber } from '@superdoc/layout-engine';

describe('SD-2986/B1: formatPageNumber formats', () => {
  it('clamps cardinals < 1 to 1', () => {
    expect(formatPageNumber(0, 'decimal')).toBe('1');
    expect(formatPageNumber(-3, 'upperRoman')).toBe('I');
  });

  it('formats numberInDash with spaces around the number', () => {
    for (const n of [1, 5, 12, 99]) {
      expect(formatPageNumber(n, 'numberInDash')).toBe(`- ${n} -`);
    }
  });

  it('formats upperRoman', () => {
    expect(formatPageNumber(1, 'upperRoman')).toBe('I');
    expect(formatPageNumber(4, 'upperRoman')).toBe('IV');
    expect(formatPageNumber(9, 'upperRoman')).toBe('IX');
    expect(formatPageNumber(40, 'upperRoman')).toBe('XL');
    expect(formatPageNumber(90, 'upperRoman')).toBe('XC');
  });

  it('formats lowerRoman', () => {
    expect(formatPageNumber(1, 'lowerRoman')).toBe('i');
    expect(formatPageNumber(4, 'lowerRoman')).toBe('iv');
    expect(formatPageNumber(9, 'lowerRoman')).toBe('ix');
  });

  it('formats page upperLetter / lowerLetter using repeated letters', () => {
    expect(formatPageNumber(1, 'upperLetter')).toBe('A');
    expect(formatPageNumber(26, 'upperLetter')).toBe('Z');
    expect(formatPageNumber(27, 'upperLetter')).toBe('AA');
    expect(formatPageNumber(28, 'upperLetter')).toBe('BB');
    expect(formatPageNumber(1, 'lowerLetter')).toBe('a');
    expect(formatPageNumber(26, 'lowerLetter')).toBe('z');
    expect(formatPageNumber(27, 'lowerLetter')).toBe('aa');
    expect(formatPageNumber(28, 'lowerLetter')).toBe('bb');
  });

  it('formats every page from 1 to 100 in each roman and letter format', async () => {
    const formats = ['upperRoman', 'lowerRoman', 'upperLetter', 'lowerLetter'] as const;
    const rows = Array.from({ length: 100 }, (_, index) =>
      [String(index + 1), ...formats.map((format) => formatPageNumber(index + 1, format))].join(' '),
    );
    await expect(`page ${formats.join(' ')}\n${rows.join('\n')}\n`).toMatchFileSnapshot(
      './__snapshots__/footnote-formatter-parity/roman-and-letter-pages.txt',
    );
  });
});
