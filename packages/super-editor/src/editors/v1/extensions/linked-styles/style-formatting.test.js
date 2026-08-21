import { describe, expect, it } from 'vitest';
import {
  applyToDefinitionStyles,
  definitionStylesToFormatting,
  parseFontSizePt,
  normaliseHex,
  patchStyleXmlElement,
  findStyleXmlElement,
  applyToTranslatedStyle,
} from './style-formatting.js';

describe('style-formatting (pure)', () => {
  it('normaliseHex strips # and uppercases, rejects junk', () => {
    expect(normaliseHex('#ff0000')).toBe('FF0000');
    expect(normaliseHex('abcdef')).toBe('ABCDEF');
    expect(normaliseHex('red')).toBeNull();
  });

  it('parseFontSizePt parses "20pt", "20", 20', () => {
    expect(parseFontSizePt('20pt')).toBe(20);
    expect(parseFontSizePt('20')).toBe(20);
    expect(parseFontSizePt(20)).toBe(20);
    expect(parseFontSizePt(undefined)).toBeNull();
  });

  it('applyToDefinitionStyles writes run-level keys and sets explicit-off for cleared booleans', () => {
    const styles = { bold: {} };
    applyToDefinitionStyles(styles, {
      bold: false,
      italic: true,
      underline: false,
      fontSizePt: 18,
      fontFamily: 'Arial',
      colorHex: 'FF0000',
    });
    // Cleared booleans become explicit off ({ value: '0' }) so they override an
    // inherited basedOn value instead of falling back to it.
    expect(styles.bold).toEqual({ value: '0' });
    expect(styles.underline).toEqual({ value: '0' });
    expect(styles.italic).toEqual({});
    expect(styles['font-size']).toBe('18pt');
    expect(styles['font-family']).toBe('Arial');
    expect(styles.color).toBe('#FF0000');
  });

  it('definitionStylesToFormatting reads explicit-off booleans as false', () => {
    expect(definitionStylesToFormatting({ bold: { value: '0' }, italic: {} })).toMatchObject({
      bold: false,
      italic: true,
    });
  });

  it('applyToDefinitionStyles leaves block-level keys untouched', () => {
    const styles = { spacing: { lineSpaceAfter: 10 }, indent: {}, tabStops: null };
    applyToDefinitionStyles(styles, {
      bold: true,
      italic: false,
      underline: false,
      fontSizePt: 16,
      fontFamily: null,
      colorHex: null,
    });
    expect(styles.spacing).toEqual({ lineSpaceAfter: 10 });
    expect(styles.indent).toEqual({});
    expect(styles.tabStops).toBeNull();
  });

  it('definitionStylesToFormatting is the inverse of applyToDefinitionStyles', () => {
    const styles = {};
    const fmt = {
      bold: true,
      italic: false,
      underline: true,
      fontSizePt: 16,
      fontFamily: 'Calibri',
      colorHex: '2E74B5',
    };
    applyToDefinitionStyles(styles, fmt);
    expect(definitionStylesToFormatting(styles)).toEqual(fmt);
  });
});

describe('styles.xml patch (pure)', () => {
  const fmt = (o) => ({
    bold: false,
    italic: false,
    underline: false,
    fontSizePt: null,
    fontFamily: null,
    colorHex: null,
    ...o,
  });

  it('writes w:rPr children for the captured formatting (size in half-points)', () => {
    const styleEl = {
      type: 'element',
      name: 'w:style',
      attributes: { 'w:styleId': 'Heading1' },
      elements: [{ type: 'element', name: 'w:pPr', elements: [] }],
    };
    patchStyleXmlElement(styleEl, fmt({ bold: true, fontSizePt: 20, fontFamily: 'Arial', colorHex: 'FF0000' }));
    const rpr = styleEl.elements.find((e) => e.name === 'w:rPr');
    expect(rpr).toBeTruthy();
    // rPr must come after pPr (CT_Style order)
    expect(styleEl.elements.findIndex((e) => e.name === 'w:rPr')).toBeGreaterThan(
      styleEl.elements.findIndex((e) => e.name === 'w:pPr'),
    );
    expect(rpr.elements.find((e) => e.name === 'w:b')).toBeTruthy();
    expect(rpr.elements.find((e) => e.name === 'w:sz')?.attributes['w:val']).toBe('40');
    expect(rpr.elements.find((e) => e.name === 'w:szCs')?.attributes['w:val']).toBe('40');
    expect(rpr.elements.find((e) => e.name === 'w:rFonts')?.attributes['w:ascii']).toBe('Arial');
    expect(rpr.elements.find((e) => e.name === 'w:color')?.attributes['w:val']).toBe('FF0000');
  });

  it('writes explicit-off (w:val="0") for cleared booleans so basedOn is not inherited', () => {
    const styleEl = {
      type: 'element',
      name: 'w:style',
      attributes: { 'w:styleId': 'Heading1' },
      elements: [{ type: 'element', name: 'w:rPr', elements: [{ type: 'element', name: 'w:b', attributes: {} }] }],
    };
    patchStyleXmlElement(styleEl, fmt({ bold: false }));
    const rpr = styleEl.elements.find((e) => e.name === 'w:rPr');
    expect(rpr.elements.find((e) => e.name === 'w:b')?.attributes['w:val']).toBe('0');
  });

  it('findStyleXmlElement locates a style by w:styleId', () => {
    const xml = {
      elements: [
        {
          name: 'w:styles',
          elements: [
            { type: 'element', name: 'w:style', attributes: { 'w:styleId': 'Normal' }, elements: [] },
            { type: 'element', name: 'w:style', attributes: { 'w:styleId': 'Heading1' }, elements: [] },
          ],
        },
      ],
    };
    expect(findStyleXmlElement(xml, 'Heading1')?.attributes['w:styleId']).toBe('Heading1');
    expect(findStyleXmlElement(xml, 'Missing')).toBeUndefined();
  });

  it('applyToTranslatedStyle writes the run channel (half-points, font object)', () => {
    const def = { styleId: 'Heading1', type: 'paragraph' };
    applyToTranslatedStyle(
      def,
      fmt({ bold: true, underline: true, fontSizePt: 18, fontFamily: 'Georgia', colorHex: 'AA0000' }),
    );
    expect(def.runProperties.bold).toBe(true);
    expect(def.runProperties.underline).toEqual({ value: 'single' });
    expect(def.runProperties.fontSize).toBe(36);
    expect(def.runProperties.fontFamily).toEqual({ ascii: 'Georgia', hAnsi: 'Georgia', cs: 'Georgia' });
    expect(def.runProperties.color).toEqual({ val: 'AA0000' });
  });
});
