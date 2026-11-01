import { describe, it, expect } from 'vite-plus/test';
import {
  findPrefixMatchIndex,
  computeTypeahead,
  normalizeCustomFontFamily,
  normalizeCustomFontSize,
} from './font-typeahead.js';

const LABELS = ['Arial', 'Calibri', 'Cambria', 'Courier New', 'Times New Roman'];

describe('findPrefixMatchIndex', () => {
  it('matches case-insensitively on a prefix', () => {
    expect(findPrefixMatchIndex('ari', LABELS)).toBe(0);
    expect(findPrefixMatchIndex('CAL', LABELS)).toBe(1);
  });

  it('returns the first matching label when several share a prefix', () => {
    expect(findPrefixMatchIndex('ca', LABELS)).toBe(1);
  });

  it('keeps spaces as part of the query', () => {
    expect(findPrefixMatchIndex('times new', LABELS)).toBe(4);
  });

  it('returns -1 for empty or whitespace queries', () => {
    expect(findPrefixMatchIndex('', LABELS)).toBe(-1);
    expect(findPrefixMatchIndex('   ', LABELS)).toBe(-1);
  });

  it('returns -1 when nothing matches', () => {
    expect(findPrefixMatchIndex('zzz', LABELS)).toBe(-1);
  });
});

describe('computeTypeahead', () => {
  it('completes a prefix and selects the suffix', () => {
    const result = computeTypeahead('ari', LABELS, { autocomplete: true });
    expect(result.matchIndex).toBe(0);
    expect(result.display).toBe('Arial');
    expect(result.selectionStart).toBe(3);
    expect(result.selectionEnd).toBe(5);
  });

  it('completes "Cour" to "Courier New" and selects the remainder', () => {
    const result = computeTypeahead('Cour', LABELS, { autocomplete: true });
    expect(result.matchIndex).toBe(3);
    expect(result.display).toBe('Courier New');
    expect(result.selectionStart).toBe(4);
    expect(result.selectionEnd).toBe('Courier New'.length);
  });

  it('does not autocomplete on deletion, but still reports the highlight', () => {
    const result = computeTypeahead('cal', LABELS, { autocomplete: false });
    expect(result.matchIndex).toBe(1);
    expect(result.display).toBe('cal');
    expect(result.selectionStart).toBe(3);
    expect(result.selectionEnd).toBe(3);
  });

  it('leaves a custom typed value untouched when nothing matches', () => {
    const result = computeTypeahead('Wingdings', LABELS, { autocomplete: true });
    expect(result.matchIndex).toBe(-1);
    expect(result.display).toBe('Wingdings');
    expect(result.selectionStart).toBe(9);
    expect(result.selectionEnd).toBe(9);
  });

  it('does not re-select when the query already equals the label', () => {
    const result = computeTypeahead('Arial', LABELS, { autocomplete: true });
    expect(result.display).toBe('Arial');
    expect(result.selectionStart).toBe(5);
    expect(result.selectionEnd).toBe(5);
  });
});

describe('normalizeCustomFontFamily', () => {
  it('keeps a bare logical font name', () => {
    expect(normalizeCustomFontFamily('Brand Sans')).toBe('Brand Sans');
  });

  it('uses only the first family from a CSS-style stack', () => {
    expect(normalizeCustomFontFamily('Arial,sans-serif')).toBe('Arial');
    expect(normalizeCustomFontFamily('Arial, sans-serif')).toBe('Arial');
  });

  it('strips wrapping quotes and collapses whitespace', () => {
    expect(normalizeCustomFontFamily(' "Brand   Sans" , serif')).toBe('Brand Sans');
  });

  it('rejects empty or control-only custom names', () => {
    expect(normalizeCustomFontFamily(', serif')).toBe('');
    expect(normalizeCustomFontFamily(String.fromCharCode(0, 7))).toBe('');
  });
});

describe('normalizeCustomFontSize', () => {
  it('keeps a plain integer size', () => {
    expect(normalizeCustomFontSize('13')).toBe('13');
    expect(normalizeCustomFontSize(' 24 ')).toBe('24');
  });

  it('ignores a unit suffix and rounds to the nearest half point', () => {
    expect(normalizeCustomFontSize('12pt')).toBe('12');
    // Half points are valid in DOCX/Word and must be preserved, not floored.
    expect(normalizeCustomFontSize('10.5')).toBe('10.5');
    expect(normalizeCustomFontSize('12.7')).toBe('12.5');
    expect(normalizeCustomFontSize('12.8')).toBe('13');
  });

  it('clamps above the maximum and rejects sizes below the minimum', () => {
    expect(normalizeCustomFontSize('0')).toBe('');
    expect(normalizeCustomFontSize('99999')).toBe('1638');
  });

  it('rejects negative sizes instead of applying their magnitude', () => {
    expect(normalizeCustomFontSize('-5')).toBe('');
    expect(normalizeCustomFontSize('-10.5')).toBe('');
  });

  it('returns an empty string when nothing usable was typed', () => {
    expect(normalizeCustomFontSize('')).toBe('');
    expect(normalizeCustomFontSize('abc')).toBe('');
  });
});
