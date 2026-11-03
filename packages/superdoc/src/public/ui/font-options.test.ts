import { describe, expect, it } from 'vite-plus/test';
import { composeFontFamilyOptions, normalizeDocumentFontOptions, normalizePickerFontOptions } from './font-options.js';

describe('font options', () => {
  it('reduces a document CSS stack to its first logical family', () => {
    expect(normalizeDocumentFontOptions([{ logicalFamily: '"Cambria", serif' }])).toEqual([
      { value: 'Cambria', label: 'Cambria', previewFamily: 'Cambria' },
    ]);
  });

  it('keeps commas inside a picker value', () => {
    expect(normalizePickerFontOptions([{ value: 'Acme, Inc Sans' }])[0]?.value).toBe('Acme, Inc Sans');
  });

  it('puts document families first and lets them win case-insensitive collisions', () => {
    const composed = composeFontFamilyOptions([{ value: 'arial', label: 'arial', previewFamily: 'arial' }]);
    expect(composed[0]?.value).toBe('arial');
    expect(composed.filter((option) => option.value.toLowerCase() === 'arial')).toHaveLength(1);
  });
});
