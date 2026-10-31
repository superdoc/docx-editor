import { describe, expect, it } from 'vite-plus/test';
import { sdRunPropsToInlineRunPatch, selectionKey } from './format-painter-helpers.js';

describe('sdRunPropsToInlineRunPatch', () => {
  it('returns an empty patch for empty props', () => {
    expect(sdRunPropsToInlineRunPatch({})).toEqual({});
  });

  it('renames read-side keys to their write-side names', () => {
    expect(
      sdRunPropsToInlineRunPatch({
        fontFamily: 'Arial',
        fontSize: 12,
        fontSizeCs: 14,
        highlight: 'yellow',
        cs: false,
        rtl: true,
        bold: true,
        boldCs: false,
        italic: false,
        italicCs: true,
        strikethrough: true,
        doubleStrikethrough: false,
        caps: true,
        smallCaps: false,
        outline: true,
        shadow: false,
        emboss: true,
        imprint: false,
        verticalAlign: 'superscript',
        characterSpacing: 1.5,
        characterScale: 90,
        kern: 8,
        baselineShift: -2,
        fitTextWidth: 40,
        vanish: true,
        webHidden: false,
        specVanish: true,
      }),
    ).toEqual({
      fontFamily: 'Arial',
      fontSize: 12,
      fontSizeCs: 14,
      highlight: 'yellow',
      cs: false,
      rtl: true,
      bold: true,
      bCs: false,
      italic: false,
      iCs: true,
      strike: true,
      dstrike: false,
      caps: true,
      smallCaps: false,
      outline: true,
      shadow: false,
      emboss: true,
      imprint: false,
      vertAlign: 'superscript',
      letterSpacing: 1.5,
      charScale: 90,
      kerning: 8,
      position: -2,
      fitText: { val: 40 },
      vanish: true,
      webHidden: false,
      specVanish: true,
    });
  });

  it('projects fonts to rFonts and lang with every field', () => {
    expect(
      sdRunPropsToInlineRunPatch({
        fonts: { ascii: 'Calibri', eastAsia: 'MS Mincho', csTheme: 'minorBidi' },
        lang: { val: 'en-US', bidi: 'ar-SA' },
      }),
    ).toEqual({
      rFonts: {
        ascii: 'Calibri',
        hAnsi: undefined,
        eastAsia: 'MS Mincho',
        cs: undefined,
        asciiTheme: undefined,
        hAnsiTheme: undefined,
        eastAsiaTheme: undefined,
        csTheme: 'minorBidi',
        hint: undefined,
      },
      lang: { val: 'en-US', eastAsia: undefined, bidi: 'ar-SA' },
    });
  });

  it('writes no rFonts or lang patch for non-object fonts or lang', () => {
    expect(Object.keys(sdRunPropsToInlineRunPatch({ fonts: 'Arial', lang: 'en-US', bold: true }))).toEqual(['bold']);
    expect(Object.keys(sdRunPropsToInlineRunPatch({ fonts: [], lang: [], bold: true }))).toEqual(['bold']);
  });

  it('projects color references to inline colors', () => {
    expect(sdRunPropsToInlineRunPatch({ color: { model: 'rgb', value: 'FF0000' } })).toEqual({ color: 'FF0000' });
    expect(sdRunPropsToInlineRunPatch({ color: { model: 'auto' } })).toEqual({ color: 'auto' });
    expect(sdRunPropsToInlineRunPatch({ color: '00FF00' })).toEqual({ color: '00FF00' });
    expect(sdRunPropsToInlineRunPatch({ color: { model: 'theme', theme: 'accent1' } })).toEqual({});
  });

  it('projects underline style and colors, and a bare underline to true', () => {
    expect(
      sdRunPropsToInlineRunPatch({ underline: { style: 'double', color: { model: 'rgb', value: '0000FF' } } }),
    ).toEqual({ underline: { style: 'double', color: '0000FF' } });
    expect(sdRunPropsToInlineRunPatch({ underline: { color: { model: 'theme', theme: 'accent2' } } })).toEqual({
      underline: { themeColor: 'accent2' },
    });
    expect(sdRunPropsToInlineRunPatch({ underline: {} })).toEqual({ underline: true });
    expect(sdRunPropsToInlineRunPatch({ underline: null })).toEqual({});
  });

  it('projects shading and drops an empty shading', () => {
    expect(
      sdRunPropsToInlineRunPatch({
        shading: { fill: { model: 'rgb', value: 'FFFF00' }, color: { model: 'auto' }, pattern: 'clear' },
      }),
    ).toEqual({ shading: { fill: 'FFFF00', color: 'auto', val: 'clear' } });
    expect(sdRunPropsToInlineRunPatch({ shading: {} })).toEqual({});
  });

  it('projects border and drops an empty border', () => {
    expect(
      sdRunPropsToInlineRunPatch({
        border: { style: 'single', width: 0.5, space: 1, color: { model: 'rgb', value: '333333' } },
      }),
    ).toEqual({ border: { val: 'single', sz: 0.5, space: 1, color: '333333' } });
    expect(sdRunPropsToInlineRunPatch({ border: {} })).toEqual({});
  });

  it('skips null and undefined values', () => {
    expect(sdRunPropsToInlineRunPatch({ bold: null, fontSize: undefined, fontFamily: null })).toEqual({});
  });
});

describe('selectionKey', () => {
  it('serializes the selection target, preferring selectionTarget', () => {
    expect(selectionKey({ selectionTarget: { kind: 'text', id: 1 }, target: { kind: 'text', id: 2 } })).toBe(
      '{"kind":"text","id":1}',
    );
    expect(selectionKey({ target: { kind: 'text', id: 2 } })).toBe('{"kind":"text","id":2}');
  });

  it('returns an empty key without a selection or target', () => {
    expect(selectionKey(null)).toBe('');
    expect(selectionKey(undefined)).toBe('');
    expect(selectionKey({})).toBe('');
  });

  it('falls back to String when the target cannot be serialized', () => {
    const target: Record<string, unknown> = { kind: 'text' };
    target.self = target;
    expect(selectionKey({ target })).toBe('[object Object]');
  });
});
