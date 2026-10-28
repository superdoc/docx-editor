import { describe, expect, it } from 'bun:test';
import { generateOrderedListIndex, intToJapaneseCounting, normalizeLvlTextChar } from './index';

describe('generateOrderedListIndex', () => {
  // SD-5466: Word reproduces every non-placeholder lvlText character verbatim, leading zero included.
  it('formats decimal markers with multi-digit replacements and keeps literal text', () => {
    const result = generateOrderedListIndex({
      listLevel: [12, 4],
      lvlText: '0.%1.%2)',
      listNumberingType: 'decimal',
    });
    expect(result).toBe('0.12.4)');
  });

  it('formats decimalZero markers with leading zeros for single digits', () => {
    const singleDigit = generateOrderedListIndex({
      listLevel: [1, 1],
      lvlText: '%1.%2',
      listNumberingType: 'decimalZero',
    });
    expect(singleDigit).toBe('01.01');

    const doubleDigit = generateOrderedListIndex({
      listLevel: [1, 10],
      lvlText: '%1.%2',
      listNumberingType: 'decimalZero',
    });
    expect(doubleDigit).toBe('01.10');
  });

  it('pads decimalZero markers on the first list level', () => {
    const at = (n: number) =>
      generateOrderedListIndex({ listLevel: [n], lvlText: '%1.', listNumberingType: 'decimalZero' });
    expect(at(1)).toBe('01.');
    expect(at(2)).toBe('02.');
    expect(at(9)).toBe('09.');
    expect(at(10)).toBe('10.');
    expect(at(12)).toBe('12.');
  });

  it('keeps a padded ancestor when a deeper level reaches two digits', () => {
    const result = generateOrderedListIndex({
      listLevel: [1, 12],
      lvlText: '%1.%2',
      listNumberingType: 'decimalZero',
    });
    expect(result).toBe('01.12');
  });

  it('formats lower roman numerals', () => {
    const result = generateOrderedListIndex({
      listLevel: [4],
      lvlText: '%1.',
      listNumberingType: 'lowerRoman',
    });
    expect(result).toBe('iv.');
  });

  it('formats ordinal values', () => {
    const result = generateOrderedListIndex({
      listLevel: [21],
      lvlText: '%1',
      listNumberingType: 'ordinal',
    });
    expect(result).toBe('21st');
  });

  it('pads custom formats that match the Word pattern', () => {
    const result = generateOrderedListIndex({
      listLevel: [7],
      lvlText: '%1.',
      listNumberingType: 'custom',
      customFormat: '001, 002, 003, ...',
    });
    expect(result).toBe('007.');
  });

  it('falls back to plain numbers when custom format does not match the pattern', () => {
    const result = generateOrderedListIndex({
      listLevel: [5],
      lvlText: '%1)',
      listNumberingType: 'custom',
      customFormat: '1, 2, 3, ...',
    });
    expect(result).toBe('5)');
  });

  it('returns null for unknown numbering types', () => {
    const result = generateOrderedListIndex({
      listLevel: [1],
      lvlText: '%1',
      listNumberingType: 'non-existent',
    });
    expect(result).toBeNull();
  });

  // Word's `upperLetter` / `lowerLetter` use repeated-letter notation (AA, BB,
  // CC, ..., AAA, BBB, ...) rather than Excel-style base-26 (AA, AB, AC, ...).
  // OOXML spec: at value n, repeat the letter at index (n-1)%26 floor((n-1)/26)+1 times.
  it('formats upperLetter markers with Word-compatible repeated letters', () => {
    const at = (n: number) =>
      generateOrderedListIndex({ listLevel: [n], lvlText: '%1.', listNumberingType: 'upperLetter' });
    expect(at(1)).toBe('A.');
    expect(at(26)).toBe('Z.');
    expect(at(27)).toBe('AA.');
    expect(at(28)).toBe('BB.');
    expect(at(52)).toBe('ZZ.');
    expect(at(53)).toBe('AAA.');
    expect(at(78)).toBe('ZZZ.');
    expect(at(79)).toBe('AAAA.');
  });

  it('formats lowerLetter markers with Word-compatible repeated letters', () => {
    const at = (n: number) =>
      generateOrderedListIndex({ listLevel: [n], lvlText: '%1)', listNumberingType: 'lowerLetter' });
    expect(at(1)).toBe('a)');
    expect(at(26)).toBe('z)');
    expect(at(27)).toBe('aa)');
    expect(at(28)).toBe('bb)');
    expect(at(52)).toBe('zz)');
    expect(at(53)).toBe('aaa)');
  });

  // Expected strings for both Chinese formats are pinned to Word 16 output
  // (ListFormat.ListString), captured codepoint-by-codepoint. Note the two
  // distinct zero glyphs: chineseCounting uses U+25CB (○) inside positional
  // values; chineseCountingThousand uses U+3007 (〇) for interior zero runs.
  it('formats chineseCounting markers with Word-compatible ideographs', () => {
    const at = (n: number) =>
      generateOrderedListIndex({ listLevel: [n], lvlText: '%1', listNumberingType: 'chineseCounting' });
    expect(at(0)).toBe('○');
    expect(at(1)).toBe('一');
    expect(at(9)).toBe('九');
    expect(at(10)).toBe('十');
    expect(at(11)).toBe('十一');
    expect(at(19)).toBe('十九');
    expect(at(20)).toBe('二十');
    expect(at(21)).toBe('二十一');
    expect(at(99)).toBe('九十九');
    // From 100 upward Word switches to positional digits with U+25CB zeros.
    expect(at(100)).toBe('一○○');
    expect(at(101)).toBe('一○一');
    expect(at(999)).toBe('九九九');
    expect(at(1000)).toBe('一○○○');
    expect(at(1010)).toBe('一○一○');
    expect(at(12345)).toBe('一二三四五');
    expect(at(100000)).toBe('一○○○○○');
  });

  it('formats chineseCountingThousand markers with Word-compatible grouped ideographs', () => {
    const at = (n: number) =>
      generateOrderedListIndex({ listLevel: [n], lvlText: '%1', listNumberingType: 'chineseCountingThousand' });
    expect(at(0)).toBe('〇');
    expect(at(1)).toBe('一');
    expect(at(10)).toBe('十');
    expect(at(11)).toBe('十一');
    expect(at(19)).toBe('十九');
    expect(at(20)).toBe('二十');
    expect(at(99)).toBe('九十九');
    // Unlike values 10-19, larger values keep the leading 一 (一百, 一十万).
    expect(at(100)).toBe('一百');
    expect(at(101)).toBe('一百〇一');
    expect(at(999)).toBe('九百九十九');
    expect(at(1000)).toBe('一千');
    expect(at(1001)).toBe('一千〇一');
    expect(at(1010)).toBe('一千〇一十');
    expect(at(1100)).toBe('一千一百');
    expect(at(1101)).toBe('一千一百〇一');
    expect(at(9999)).toBe('九千九百九十九');
    expect(at(10000)).toBe('一万');
    expect(at(10001)).toBe('一万〇一');
    expect(at(10010)).toBe('一万〇一十');
    expect(at(10100)).toBe('一万〇一百');
    expect(at(12345)).toBe('一万二千三百四十五');
    expect(at(99999)).toBe('九万九千九百九十九');
    expect(at(100000)).toBe('一十万');
    expect(at(100001)).toBe('一十万〇一');
    expect(at(100101)).toBe('一十万〇一百〇一');
    expect(at(109999)).toBe('一十万〇九千九百九十九');
    expect(at(110000)).toBe('一十一万');
    expect(at(999999)).toBe('九十九万九千九百九十九');
    // Word renders nothing from 1,000,000 upward.
    expect(at(1000000)).toBe('');
  });

  // Expected strings are pinned to Word 16 output (ListFormat.ListString),
  // captured codepoint-by-codepoint from a DOCX carrying <w:numFmt w:val="hebrew1"/>
  // and hebrew2. Word represents only 1-392 and then restarts from א, so the
  // wrap cases below are Word parity rather than an arbitrary choice.
  it('formats hebrew1 markers as Word-compatible gematria numerals', () => {
    const at = (n: number) => generateOrderedListIndex({ listLevel: [n], lvlText: '%1', listNumberingType: 'hebrew1' });
    expect(at(1)).toBe('א');
    expect(at(9)).toBe('ט');
    expect(at(10)).toBe('י');
    expect(at(11)).toBe('יא');
    expect(at(20)).toBe('כ');
    expect(at(99)).toBe('צט');
    expect(at(100)).toBe('ק');
    expect(at(200)).toBe('ר');
    expect(at(300)).toBe('ש');
    expect(at(392)).toBe('שצב');
  });

  // 15 and 16 are טו and טז rather than יה and יו, which spell divine names.
  // Word applies the substitution at every hundreds level, and nowhere else:
  // these eight values are the only places Word departs from naive gematria.
  it('formats hebrew1 15 and 16 as טו/טז at every hundreds level', () => {
    const at = (n: number) => generateOrderedListIndex({ listLevel: [n], lvlText: '%1', listNumberingType: 'hebrew1' });
    expect(at(15)).toBe('טו');
    expect(at(16)).toBe('טז');
    expect(at(115)).toBe('קטו');
    expect(at(116)).toBe('קטז');
    expect(at(215)).toBe('רטו');
    expect(at(216)).toBe('רטז');
    expect(at(315)).toBe('שטו');
    expect(at(316)).toBe('שטז');
    // The rule is scoped to the last two digits: 105 and 110 stay plain.
    expect(at(105)).toBe('קה');
    expect(at(110)).toBe('קי');
  });

  // hebrew2 counts through the 22-letter alphabet, then prefixes a ת per
  // completed pass. Every hebrew2 marker carries a leading U+200F; no hebrew1
  // marker does. Both observed on ListFormat.ListString and Field.Result.Text.
  it('formats hebrew2 markers as Word-compatible alphabet counting', () => {
    const at = (n: number) => generateOrderedListIndex({ listLevel: [n], lvlText: '%1', listNumberingType: 'hebrew2' });
    expect(at(1)).toBe('\u200fא');
    expect(at(10)).toBe('\u200fי');
    expect(at(11)).toBe('\u200fכ');
    expect(at(22)).toBe('\u200fת');
    expect(at(23)).toBe('\u200fתא');
    expect(at(44)).toBe('\u200fתת');
    expect(at(45)).toBe('\u200fתתא');
    expect(at(392)).toBe('\u200fתתתתתתתתתתתתתתתתתצ');
  });

  it('restarts both Hebrew formats from א above the range Word represents', () => {
    const h1 = (n: number) => generateOrderedListIndex({ listLevel: [n], lvlText: '%1', listNumberingType: 'hebrew1' });
    const h2 = (n: number) => generateOrderedListIndex({ listLevel: [n], lvlText: '%1', listNumberingType: 'hebrew2' });
    expect(h1(392)).toBe('שצב');
    expect(h1(393)).toBe('א');
    expect(h1(784)).toBe('שצב');
    expect(h1(785)).toBe('א');
    expect(h2(393)).toBe('\u200fא');
    expect(h2(785)).toBe('\u200fא');
  });

  // w:start="0" is schema-valid (ST_DecimalNumber) and Word draws no marker for
  // that item. Returning '' keeps the render path total: a throw here would
  // propagate out of computeWordListMarker into layout.
  it('renders an empty Hebrew marker for values Word cannot number', () => {
    const at = (n: number, type: string) =>
      generateOrderedListIndex({ listLevel: [n], lvlText: '%1', listNumberingType: type });
    for (const type of ['hebrew1', 'hebrew2']) {
      expect(at(0, type)).toBe('');
      expect(at(-1, type)).toBe('');
      expect(at(1.5, type)).toBe('');
      expect(at(Number.NaN, type)).toBe('');
      expect(at(Number.POSITIVE_INFINITY, type)).toBe('');
    }
  });

  // Word repeats the U+200F once per formatted number rather than once per
  // marker, so a three-level hebrew2 marker carries three of them. Measured on
  // a multilevel DOCX; hebrew1 markers carry none at any depth.
  it('substitutes Hebrew numerals into multilevel lvlText templates', () => {
    const at = (listLevel: number[], lvlText: string, type: string) =>
      generateOrderedListIndex({ listLevel, lvlText, listNumberingType: type });
    expect(at([3, 12], '%1.%2)', 'hebrew1')).toBe('ג.יב)');
    expect(at([1, 2, 1], '%1.%2.%3', 'hebrew1')).toBe('א.ב.א');
    expect(at([1, 2], '%1.%2', 'hebrew2')).toBe('\u200fא.\u200fב');
    expect(at([1, 2, 1], '%1.%2.%3', 'hebrew2')).toBe('\u200fא.\u200fב.\u200fא');
  });

  describe('malformed lvlText', () => {
    it('returns null when lvlText is null', () => {
      const result = generateOrderedListIndex({
        listLevel: [1],
        lvlText: null,
        listNumberingType: 'decimal',
      });
      expect(result).toBeNull();
    });

    it('returns null when lvlText is undefined', () => {
      const result = generateOrderedListIndex({
        listLevel: [1],
        lvlText: undefined,
        listNumberingType: 'decimal',
      });
      expect(result).toBeNull();
    });

    it('returns null when lvlText is a non-string type', () => {
      const result = generateOrderedListIndex({
        listLevel: [1],
        lvlText: 42 as any,
        listNumberingType: 'decimal',
      });
      expect(result).toBeNull();
    });

    it('still formats correctly with valid lvlText after guard', () => {
      const result = generateOrderedListIndex({
        listLevel: [3],
        lvlText: '%1.',
        listNumberingType: 'decimal',
      });
      expect(result).toBe('3.');
    });
  });

  it('handles undefined customFormat for custom numbering type', () => {
    const result = generateOrderedListIndex({
      listLevel: [5],
      lvlText: '%1)',
      listNumberingType: 'custom',
      customFormat: undefined,
    });
    expect(result).toBe('5)');
  });
});

describe('normalizeLvlTextChar', () => {
  it('normalizes known bullet glyphs', () => {
    expect(normalizeLvlTextChar('')).toBe('•');
    expect(normalizeLvlTextChar('○')).toBe('◦');
    expect(normalizeLvlTextChar('o')).toBe('◦');
    expect(normalizeLvlTextChar('■')).toBe('▪');
    expect(normalizeLvlTextChar('□')).toBe('◯');
  });

  it('returns the original character when no normalization is required', () => {
    expect(normalizeLvlTextChar('•')).toBe('•');
    expect(normalizeLvlTextChar(undefined)).toBeUndefined();
  });
});

describe('intToJapaneseCounting', () => {
  it('returns zero and single digit representations', () => {
    expect(intToJapaneseCounting(0)).toBe('零');
    expect(intToJapaneseCounting(3)).toBe('三');
  });

  it('handles teens and hundreds', () => {
    expect(intToJapaneseCounting(10)).toBe('十');
    expect(intToJapaneseCounting(15)).toBe('十五');
    expect(intToJapaneseCounting(342)).toBe('三百四十二');
  });
});
