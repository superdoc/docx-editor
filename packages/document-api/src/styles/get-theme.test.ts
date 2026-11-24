// SD-4787: `styles.getTheme` is a public read of the document theme (colors,
// fonts, color mapping) without fetching the whole document through doc.get().
import { describe, expect, it, mock } from 'bun:test';
import { createDocumentApi, type DocumentApiAdapters } from '../index.js';
import { DocumentApiValidationError } from '../errors.js';
import { executeStylesGetTheme, type StylesAdapter, type StylesGetThemeResult } from './index.js';

const THEME_RESULT: StylesGetThemeResult = {
  theme: {
    source: 'document',
    colorScheme: {
      dk1: '000000',
      lt1: 'FFFFFF',
      dk2: '1F2A44',
      lt2: 'F2EFE6',
      accent1: '0B6E4F',
      accent2: 'C2410C',
      accent3: '6D28D9',
      accent4: 'B45309',
      accent5: '0E7490',
      accent6: 'BE123C',
      hyperlink: '1D4ED8',
      followedHyperlink: '7C3AED',
    },
  },
  sourceStatus: { theme: 'present', settings: 'present' },
  diagnostics: [],
};

function makeThemeAdapter(): Pick<StylesAdapter, 'getTheme'> {
  return { getTheme: mock(() => THEME_RESULT) };
}

function expectValidationError(fn: () => unknown, code: string, message: RegExp): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DocumentApiValidationError);
    expect((error as DocumentApiValidationError).code).toBe(code);
    expect((error as Error).message).toMatch(message);
    return;
  }
  throw new Error('Expected a DocumentApiValidationError.');
}

describe('styles.getTheme validation', () => {
  it('accepts an omitted or empty input', () => {
    const adapter = makeThemeAdapter();

    expect(executeStylesGetTheme(adapter)).toBe(THEME_RESULT);
    expect(executeStylesGetTheme(adapter, {})).toBe(THEME_RESULT);
  });

  it('rejects null input instead of treating it as the default request', () => {
    expectValidationError(
      () => executeStylesGetTheme(makeThemeAdapter(), null as never),
      'INVALID_INPUT',
      /non-null object/,
    );
  });

  it('rejects unknown input fields', () => {
    expectValidationError(
      () => executeStylesGetTheme(makeThemeAdapter(), { includeResolved: true } as never),
      'INVALID_INPUT',
      /Unknown field "includeResolved" on styles\.getTheme input/,
    );
  });

  it('fails closed when the styles adapter has no theme hook', () => {
    expectValidationError(
      () => executeStylesGetTheme({}),
      'CAPABILITY_UNAVAILABLE',
      /styles\.getTheme is not available/,
    );
  });
});

describe('styles.getTheme on the public API', () => {
  it('delegates to the styles adapter', () => {
    const adapter = makeThemeAdapter();
    const api = createDocumentApi({ styles: adapter } as unknown as DocumentApiAdapters);

    expect(api.styles.getTheme()).toBe(THEME_RESULT);
    expect(adapter.getTheme).toHaveBeenCalledTimes(1);
  });
});
