import { describe, expect, it } from 'vite-plus/test';
import type { FormatReadSelectionResult } from '@superdoc/document-api';
import { buildStyleMatchPatch, STYLE_MATCH_READ_KEYS } from './style-match-patch.js';

type Properties = FormatReadSelectionResult['properties'];

const read = (properties: Properties): FormatReadSelectionResult => ({ collapsed: false, properties });
const uniform = (value: unknown) => ({ state: 'uniform', value }) as never;
const unset = { state: 'unset' } as const;

const styled: Properties = {
  bold: uniform(true),
  italic: uniform(false),
  underline: uniform(false),
  color: uniform('1F4E79'),
  fontSize: uniform(16),
  rFonts: uniform({ ascii: 'Calibri', hAnsi: 'Calibri' }),
};
const noDirect: Properties = Object.fromEntries(STYLE_MATCH_READ_KEYS.map((key) => [key, unset]));

describe('buildStyleMatchPatch', () => {
  it('reads exactly the keys "Update to match selection" folds in', () => {
    expect(STYLE_MATCH_READ_KEYS).toEqual(['bold', 'italic', 'underline', 'color', 'fontSize', 'rFonts', 'rStyle']);
  });

  it('folds only directly formatted keys when the selection already uses the style', () => {
    const effective = read({ ...styled, italic: uniform(true), fontSize: uniform(18) });
    const direct = read({ ...noDirect, italic: uniform(true), fontSize: uniform(18) });
    expect(buildStyleMatchPatch(effective, direct, { selectionUsesStyle: true })).toEqual({
      italic: true,
      fontSize: 36,
    });
  });

  it('returns an empty patch when nothing is directly formatted', () => {
    expect(buildStyleMatchPatch(read(styled), read(noDirect), { selectionUsesStyle: true })).toEqual({});
  });

  it('writes an explicit off for a property turned off directly, not inherit', () => {
    const effective = read({ ...styled, bold: uniform(false), underline: uniform(false) });
    const direct = read({ ...noDirect, bold: uniform(false), underline: uniform(false) });
    expect(buildStyleMatchPatch(effective, direct, { selectionUsesStyle: true })).toEqual({
      bold: false,
      underline: { val: 'none' },
    });
  });

  it('removes a value property that resolves to nothing, so the style inherits it', () => {
    const effective = read({ ...styled, color: uniform(null), fontSize: uniform(null), rFonts: uniform(null) });
    const direct = read({ ...noDirect, color: uniform('auto'), fontSize: uniform(11), rFonts: uniform({ hint: '' }) });
    expect(buildStyleMatchPatch(effective, direct, { selectionUsesStyle: true })).toEqual({
      color: null,
      fontSize: null,
      fontFamily: null,
    });
  });

  it('converts format.apply shapes to styles.apply shapes', () => {
    const effective = read({
      ...styled,
      color: uniform('#C00000'),
      fontSize: uniform(10.5),
      underline: uniform({ style: 'double', color: 'FF0000', themeColor: 'accent2' }),
      rFonts: uniform({ ascii: 'Arial', hAnsi: 'Arial', asciiTheme: 'minorHAnsi', csTheme: 'minorBidi', eastAsia: '' }),
    });
    const patch = buildStyleMatchPatch(effective, read({}), { selectionUsesStyle: false });
    expect(patch).toMatchObject({
      color: { val: 'C00000' },
      fontSize: 21,
      underline: { val: 'double', color: 'FF0000', themeColor: 'accent2' },
      fontFamily: { ascii: 'Arial', hAnsi: 'Arial', asciiTheme: 'minorHAnsi', cstheme: 'minorBidi' },
    });
  });

  it('skips keys the selection does not agree on', () => {
    const effective = read({
      ...styled,
      bold: { state: 'mixed' },
      color: { state: 'unresolvable', reason: 'theme-reference' },
    });
    const direct = read({ ...noDirect, bold: { state: 'mixed' }, color: uniform('C00000'), italic: uniform(true) });
    const patch = buildStyleMatchPatch(effective, direct, { selectionUsesStyle: true });
    expect(patch).toEqual({ italic: false });
  });

  it('folds every agreed key when updating a style the selection does not use', () => {
    expect(buildStyleMatchPatch(read(styled), read(noDirect), { selectionUsesStyle: false })).toEqual({
      bold: true,
      italic: false,
      underline: { val: 'none' },
      color: { val: '1F4E79' },
      fontSize: 32,
      fontFamily: { ascii: 'Calibri', hAnsi: 'Calibri' },
    });
  });
});
