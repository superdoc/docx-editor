import { describe, it, expect, vi } from 'vitest';
import { sortPropertyChildElements, getCanonicalChildOrder } from './ooxml-property-order.js';
import { translator as numPrTranslator } from './w/numPr/numPr-translator.js';
import { translator as trPrTranslator } from './w/trPr/trPr-translator.js';
import { translator as rPrTranslator } from './w/rpr/rpr-translator.js';

// Some property translators transitively import the exporter; stub it to keep
// this unit suite isolated (mirrors numPr-translator.test.js).
vi.mock('@converter/exporter', () => ({
  exportSchemaToJson: vi.fn(),
  createTrackStyleMark: vi.fn(),
}));

const names = (node) => node.elements.map((el) => el.name);

describe('sortPropertyChildElements', () => {
  it('orders w:rPr children by canonical CT_RPr sequence (e.g. rFonts before color)', () => {
    const elements = [{ name: 'w:color' }, { name: 'w:sz' }, { name: 'w:rFonts' }, { name: 'w:b' }];
    expect(sortPropertyChildElements('w:rPr', elements).map((e) => e.name)).toEqual([
      'w:rFonts',
      'w:b',
      'w:color',
      'w:sz',
    ]);
  });

  it('orders w:pPr children by canonical CT_PPr sequence', () => {
    const elements = [{ name: 'w:jc' }, { name: 'w:spacing' }, { name: 'w:numPr' }, { name: 'w:pStyle' }];
    expect(sortPropertyChildElements('w:pPr', elements).map((e) => e.name)).toEqual([
      'w:pStyle',
      'w:numPr',
      'w:spacing',
      'w:jc',
    ]);
  });

  it('orders w:numPr children so w:ilvl precedes w:numId', () => {
    const elements = [{ name: 'w:numId' }, { name: 'w:ilvl' }];
    expect(sortPropertyChildElements('w:numPr', elements).map((e) => e.name)).toEqual(['w:ilvl', 'w:numId']);
  });

  it('orders w:trPr children so w:trHeight precedes w:hidden', () => {
    const elements = [{ name: 'w:hidden' }, { name: 'w:trHeight' }, { name: 'w:cnfStyle' }];
    expect(sortPropertyChildElements('w:trPr', elements).map((e) => e.name)).toEqual([
      'w:cnfStyle',
      'w:trHeight',
      'w:hidden',
    ]);
  });

  it('orders w:tcPr children by canonical CT_TcPr sequence', () => {
    const elements = [{ name: 'w:vAlign' }, { name: 'w:tcW' }, { name: 'w:gridSpan' }];
    expect(sortPropertyChildElements('w:tcPr', elements).map((e) => e.name)).toEqual([
      'w:tcW',
      'w:gridSpan',
      'w:vAlign',
    ]);
  });

  it('orders w:tblPr children so w:tblCellMar precedes w:tblLook', () => {
    const elements = [{ name: 'w:tblLook' }, { name: 'w:tblCellMar' }, { name: 'w:tblStyle' }];
    expect(sortPropertyChildElements('w:tblPr', elements).map((e) => e.name)).toEqual([
      'w:tblStyle',
      'w:tblCellMar',
      'w:tblLook',
    ]);
  });

  it('places unknown/extension elements after known children, preserving their relative order (stable)', () => {
    const elements = [
      { name: 'w14:ligatures' },
      { name: 'w:color' },
      { name: 'mc:AlternateContent' },
      { name: 'w:rFonts' },
    ];
    expect(sortPropertyChildElements('w:rPr', elements).map((e) => e.name)).toEqual([
      'w:rFonts',
      'w:color',
      'w14:ligatures',
      'mc:AlternateContent',
    ]);
  });

  it('returns the input unchanged for containers without a canonical sequence', () => {
    const elements = [{ name: 'w:bottom' }, { name: 'w:top' }];
    expect(sortPropertyChildElements('w:tcMar', elements)).toBe(elements);
  });

  it('returns the input unchanged when there are fewer than two elements', () => {
    const single = [{ name: 'w:numId' }];
    expect(sortPropertyChildElements('w:numPr', single)).toBe(single);
  });

  it('exposes canonical sequences via getCanonicalChildOrder (prefix-insensitive)', () => {
    expect(getCanonicalChildOrder('w:numPr')).toEqual(['ilvl', 'numId', 'numberingChange', 'ins']);
    expect(getCanonicalChildOrder('numPr')).toEqual(['ilvl', 'numId', 'numberingChange', 'ins']);
    expect(getCanonicalChildOrder('w:notAContainer')).toBeUndefined();
  });
});

describe('property container translators emit children in canonical order', () => {
  it('w:numPr emits w:ilvl before w:numId even when attrs are set numId-first', () => {
    const result = numPrTranslator.decode({
      node: { attrs: { numberingProperties: { numId: 7, ilvl: 2 } } },
    });
    expect(names(result)).toEqual(['w:ilvl', 'w:numId']);
  });

  it('w:trPr emits w:trHeight before w:hidden even when attrs are set hidden-first', () => {
    const result = trPrTranslator.decode({
      node: { attrs: { tableRowProperties: { hidden: true, rowHeight: { value: 240, rule: 'atLeast' } } } },
    });
    expect(names(result)).toEqual(['w:trHeight', 'w:hidden']);
  });

  it('w:rPr emits w:rFonts before w:color even when attrs are set color-first', () => {
    const result = rPrTranslator.decode({
      node: { attrs: { runProperties: { color: { val: 'FF0000' }, fontFamily: { ascii: 'Arial' } } } },
    });
    expect(names(result)).toEqual(['w:rFonts', 'w:color']);
  });
});
