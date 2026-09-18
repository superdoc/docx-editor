import { describe, expect, it } from 'bun:test';

import { resolveThemeColor } from './colors.js';
import { normalizeParagraphAttrsFromOoxml } from './paragraph-attrs.js';
import { normalizeRunAttrsFromOoxml } from './run-attrs.js';

describe('resolveThemeColor', () => {
  it('maps DrawingML background/text aliases onto Word theme palette keys', () => {
    const palette = {
      lt1: '#F1F2F3',
      dk1: '#111213',
      lt2: '#E1E2E3',
      dk2: '#212223',
    };

    expect(resolveThemeColor('bg1', palette)).toBe('#F1F2F3');
    expect(resolveThemeColor('tx1', palette)).toBe('#111213');
    expect(resolveThemeColor('bg2', palette)).toBe('#E1E2E3');
    expect(resolveThemeColor('tx2', palette)).toBe('#212223');
  });
});

describe('normalizeParagraphAttrsFromOoxml', () => {
  it('maps paragraph-mark vanish to suppressParagraphBreak', () => {
    const attrs = normalizeParagraphAttrsFromOoxml({
      runProperties: { vanish: true },
    });

    expect(attrs.suppressParagraphBreak).toBe(true);
  });

  it('preserves OOXML auto line spacing as a natural-line multiplier', () => {
    const attrs = normalizeParagraphAttrsFromOoxml({
      spacing: {
        line: 240,
        lineRule: 'auto',
      },
    });

    expect(attrs.spacing).toEqual({
      line: 1,
      lineUnit: 'multiplier',
      lineRule: 'auto',
    });
  });

  it('preserves an explicit widow-control override', () => {
    expect(normalizeParagraphAttrsFromOoxml({ widowControl: false }).widowControl).toBe(false);
    expect(normalizeParagraphAttrsFromOoxml({ widowControl: true }).widowControl).toBe(true);
    expect(normalizeParagraphAttrsFromOoxml({}).widowControl).toBeUndefined();
  });

  it('maps stored jc values to visual left/right alignment for RTL paragraphs', () => {
    expect(
      normalizeParagraphAttrsFromOoxml({
        rightToLeft: true,
        justification: 'left',
      }).alignment,
    ).toBe('right');

    expect(
      normalizeParagraphAttrsFromOoxml({
        rightToLeft: true,
        justification: 'right',
      }).alignment,
    ).toBe('left');

    expect(
      normalizeParagraphAttrsFromOoxml({
        rightToLeft: true,
        justification: 'center',
      }).alignment,
    ).toBe('center');
  });

  it('preserves explicit paragraph bidi as directionContext', () => {
    expect(
      normalizeParagraphAttrsFromOoxml({
        rightToLeft: true,
      }).directionContext,
    ).toEqual({
      inlineDirection: 'rtl',
      writingMode: 'horizontal-tb',
    });

    expect(
      normalizeParagraphAttrsFromOoxml({
        rightToLeft: false,
      }).directionContext,
    ).toBeUndefined();
  });

  it('maps RTL paragraph indents to the legacy visual contract used by layout', () => {
    const attrs = normalizeParagraphAttrsFromOoxml({
      rightToLeft: true,
      indent: {
        left: 1440,
        right: 720,
        firstLine: 360,
        hanging: 180,
      },
    });

    expect(attrs.indent).toEqual({
      left: 48,
      right: 96,
      firstLine: -24,
      hanging: -12,
    });
  });
});

describe('normalizeRunAttrsFromOoxml', () => {
  it('maps the extended visual/script/visibility subset', () => {
    const attrs = normalizeRunAttrsFromOoxml({
      dstrike: true,
      textTransform: 'uppercase',
      smallCaps: true,
      vanish: true,
      specVanish: true,
      noProof: true,
      cs: true,
      lang: { val: 'en-US', bidi: 'ar-SA', eastAsia: 'ja-JP' },
      position: 6,
      letterSpacing: 30,
      w: '90',
    });

    expect(attrs).toMatchObject({
      strike: true,
      doubleStrike: true,
      textTransform: 'uppercase',
      allCaps: true,
      smallCaps: true,
      vanish: true,
      specVanish: true,
      noProof: true,
      baselineShift: 3,
      horizontalScale: 0.9,
    });
    expect(attrs.letterSpacing).toBeCloseTo((30 * 96) / 1440, 4);
    expect(attrs.script).toEqual({
      complexScript: true,
      language: {
        default: 'en-US',
        complexScript: 'ar-SA',
        eastAsian: 'ja-JP',
      },
    });
  });

  it('carries the Word 97-2003 effect flags through to the paint contract', () => {
    expect(normalizeRunAttrsFromOoxml({ outline: true, shadow: true, emboss: true, imprint: true })).toMatchObject({
      outline: true,
      shadow: true,
      emboss: true,
      imprint: true,
    });
  });

  it('preserves an explicitly cleared effect flag rather than dropping it', () => {
    // `<w:shadow w:val="0"/>` is how Word turns an inherited effect off, and a
    // dropped key would let the style layer below switch it back on.
    const attrs = normalizeRunAttrsFromOoxml({ outline: false, shadow: false, emboss: false, imprint: false });

    expect(attrs).toMatchObject({ outline: false, shadow: false, emboss: false, imprint: false });
  });

  it('leaves the effect flags absent when the run does not carry them', () => {
    const attrs = normalizeRunAttrsFromOoxml({ bold: true });

    expect(attrs.outline).toBeUndefined();
    expect(attrs.shadow).toBeUndefined();
    expect(attrs.emboss).toBeUndefined();
    expect(attrs.imprint).toBeUndefined();
  });

  it('normalizes decimal and percent OOXML character-width values and rejects invalid values', () => {
    expect(normalizeRunAttrsFromOoxml({ w: '90' }).horizontalScale).toBe(0.9);
    expect(normalizeRunAttrsFromOoxml({ w: '125%' }).horizontalScale).toBe(1.25);
    expect(normalizeRunAttrsFromOoxml({ w: '601' }).horizontalScale).toBeUndefined();
    expect(normalizeRunAttrsFromOoxml({ w: 'wide' }).horizontalScale).toBeUndefined();
  });

  it('preserves explicit false values for ST_OnOff properties', () => {
    const attrs = normalizeRunAttrsFromOoxml({
      bold: false,
      italic: false,
      smallCaps: false,
      vanish: false,
      specVanish: false,
      noProof: false,
      textTransform: 'none',
    });

    expect(attrs).toMatchObject({
      bold: false,
      italic: false,
      smallCaps: false,
      vanish: false,
      specVanish: false,
      noProof: false,
      textTransform: 'none',
      allCaps: false,
    });
  });

  it('maps w:rPr/w:rtl to bidi.rtl regardless of which cascade layer set it (SD-3098)', () => {
    expect(normalizeRunAttrsFromOoxml({ rtl: true }).bidi).toEqual({ rtl: true });
    expect(normalizeRunAttrsFromOoxml({ rtl: false }).bidi).toBeUndefined();
    expect(normalizeRunAttrsFromOoxml({}).bidi).toBeUndefined();
  });

  it('materializes resolved font names as CSS-safe fallback stacks', () => {
    const attrs = normalizeRunAttrsFromOoxml({
      fontFamily: { ascii: 'Roboto', hAnsi: 'Roboto' },
    });

    expect(attrs.fontFamily).toBe('Roboto, sans-serif');
  });

  it('maps OOXML green and darkGreen highlights to distinct Word colors', () => {
    expect(normalizeRunAttrsFromOoxml({ highlight: { 'w:val': 'green' } }).highlight).toBe('#00FF00');
    expect(normalizeRunAttrsFromOoxml({ highlight: { 'w:val': 'darkGreen' } }).highlight).toBe('#008000');
  });

  it('treats OOXML highlight none as no rendered highlight', () => {
    expect(normalizeRunAttrsFromOoxml({ highlight: { 'w:val': 'none' } }).highlight).toBeUndefined();
  });

  it('uses nonstandard OOXML highlight fill when the highlight val itself is non-rendering', () => {
    expect(
      normalizeRunAttrsFromOoxml({
        highlight: { 'w:val': 'clear', 'w:fill': 'FEF3C7' },
      }).highlight,
    ).toBe('#FEF3C7');
  });

  it('falls back to run shading fill when no explicit highlight color is present', () => {
    expect(
      normalizeRunAttrsFromOoxml({
        shading: { val: 'clear', fill: 'CCE2DE' },
      }).highlight,
    ).toBe('#CCE2DE');
  });

  it('uses implicit auto text color to preserve contrast on dark backgrounds', () => {
    expect(normalizeRunAttrsFromOoxml({}, { backgroundColor: '#000000' }).color).toBe('#FFFFFF');
    expect(normalizeRunAttrsFromOoxml({}, { backgroundColor: '#FAE2D5' }).color).toBeUndefined();
  });
});
