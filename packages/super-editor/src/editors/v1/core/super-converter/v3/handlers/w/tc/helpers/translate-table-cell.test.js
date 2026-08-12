import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock children translation to keep tests focused on this module
vi.mock('@converter/v2/exporter/helpers/index', () => ({
  translateChildNodes: vi.fn(() => [{ name: 'w:p', elements: [] }]),
}));

import { pixelsToTwips, pixelsToEightPoints, twipsToPixels } from '@converter/helpers.js';
import { translateTableCell, generateTableCellProperties } from './translate-table-cell.js';

describe('translate-table-cell helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generateTableCellProperties builds tcPr with width, span, bg, margins, vAlign, vMerge, and borders', () => {
    const node = {
      attrs: {
        colwidth: [100, 50],
        widthUnit: 'px',
        cellWidthType: 'dxa',
        background: { color: '#FF00FF' },
        colspan: 2,
        rowspan: 3,
        cellMargins: { top: 96, right: 48, bottom: 0, left: 24 },
        verticalAlign: 'center',
        borders: {
          top: { color: '#FF0000', size: 2, space: 1 },
          bottom: { val: 'none' },
        },
      },
    };

    const tcPr = generateTableCellProperties(node);
    expect(tcPr.name).toBe('w:tcPr');

    const byName = Object.fromEntries(tcPr.elements.map((e) => [e.name, e]));

    // tcW
    expect(byName['w:tcW'].attributes['w:w']).toBe(String(pixelsToTwips(150)));
    expect(byName['w:tcW'].attributes['w:type']).toBe('dxa');

    // gridSpan
    expect(byName['w:gridSpan'].attributes['w:val']).toBe('2');

    // background - OOXML requires bare 6-char hex (no #) and w:val="clear" for solid fills
    expect(byName['w:shd'].attributes['w:fill']).toBe('FF00FF');
    expect(byName['w:shd'].attributes['w:val']).toBe('clear');

    // tcMar
    const mar = byName['w:tcMar'];

    expect(Array.isArray(mar.elements)).toBe(true);
    const marMap = Object.fromEntries(mar.elements.map((e) => [e.name, e.attributes['w:w']]));
    expect(marMap['w:top']).toBe(String(pixelsToTwips(96)));
    expect(marMap['w:right']).toBe(String(pixelsToTwips(48)));
    expect(marMap['w:bottom']).toBe(String(pixelsToTwips(0)));
    expect(marMap['w:left']).toBe(String(pixelsToTwips(24)));

    // vAlign
    expect(byName['w:vAlign'].attributes['w:val']).toBe('center');

    // vMerge for start of a vertical merge
    expect(byName['w:vMerge'].attributes['w:val']).toBe('restart');

    // borders
    const borders = byName['w:tcBorders'];
    const bMap = Object.fromEntries(borders.elements.map((e) => [e.name, e]));
    expect(bMap['w:top'].attributes).toMatchObject({
      'w:val': 'single',
      'w:color': 'FF0000',
      'w:sz': String(pixelsToEightPoints(2)),
      'w:space': '1',
    });
    expect(bMap['w:bottom'].attributes['w:val']).toBe('nil');
  });

  it('generateTableCellProperties adds continuation vMerge when continueMerge is set', () => {
    const node = { attrs: { colwidth: [10], widthUnit: 'px', continueMerge: true } };
    const tcPr = generateTableCellProperties(node);
    const vMerge = tcPr.elements.find((e) => e.name === 'w:vMerge');
    expect(vMerge).toBeTruthy();
    expect(vMerge.attributes).toEqual({ 'w:val': 'continue' });
  });

  it('generateTableCellProperties does not output w:tcMar when cell had no w:tcMar (tableCellPropertiesInlineKeys excludes cellMargins)', () => {
    // Cell from DOCX with table style providing margins: only cellWidth was in w:tcPr
    const node = {
      attrs: {
        tableCellProperties: { cellWidth: { value: 1000, type: 'dxa' } },
        tableCellPropertiesInlineKeys: ['cellWidth'],
        colwidth: [50],
        widthUnit: 'px',
        cellMargins: { top: 96, right: 48, bottom: 0, left: 24 }, // from table style, not inline
      },
    };
    const tcPr = generateTableCellProperties(node);
    const byName = Object.fromEntries(tcPr.elements.map((e) => [e.name, e]));
    expect(byName['w:tcMar']).toBeUndefined();
    expect(byName['w:tcW']).toBeTruthy();
  });

  it('generateTableCellProperties does not output w:tcMar when tableCellPropertiesInlineKeys is empty array', () => {
    // Cell had no w:tcPr at all (all props from table style) — margins should stay table-style-only.
    const node = {
      attrs: {
        tableCellProperties: { cellWidth: { value: 1000, type: 'dxa' } },
        tableCellPropertiesInlineKeys: [],
        colwidth: [50],
        widthUnit: 'px',
        cellMargins: { top: 12, right: 0, bottom: 0, left: 0 },
      },
    };
    const tcPr = generateTableCellProperties(node);
    const byName = Object.fromEntries(tcPr.elements.map((e) => [e.name, e]));
    expect(byName['w:tcMar']).toBeUndefined();
    expect(byName['w:tcW']).toBeTruthy();
  });

  // SD-3152: round-trip preservation of CT_TcMar logical vs physical pairs.
  // Importer keeps the source key family on tableCellProperties.cellMargins
  // (logical marginStart/marginEnd or physical marginLeft/marginRight) while
  // attrs.cellMargins is the LTR-default physical-only painter view (SD-3134).
  // Export must write the user-visible value back into the imported pair and
  // must not gain the opposite pair on round-trip.
  describe('SD-3152: w:tcMar key-family preservation on export', () => {
    const marByName = (tcPr) => {
      const mar = tcPr.elements.find((e) => e.name === 'w:tcMar');
      return Object.fromEntries((mar?.elements ?? []).map((e) => [e.name, e.attributes['w:w']]));
    };

    it('logical-only source: unchanged values export only <w:start>/<w:end>', () => {
      const node = {
        attrs: {
          colwidth: [50],
          widthUnit: 'px',
          tableCellProperties: {
            cellMargins: {
              marginTop: { value: 120, type: 'dxa' },
              marginBottom: { value: 120, type: 'dxa' },
              marginStart: { value: 480, type: 'dxa' },
              marginEnd: { value: 60, type: 'dxa' },
            },
          },
          tableCellPropertiesInlineKeys: ['cellMargins'],
          cellMargins: {
            top: twipsToPixels(120),
            bottom: twipsToPixels(120),
            left: twipsToPixels(480),
            right: twipsToPixels(60),
          },
        },
      };
      const tcPr = generateTableCellProperties(node);
      const m = marByName(tcPr);
      expect(m['w:start']).toBe('480');
      expect(m['w:end']).toBe('60');
      expect(m['w:left']).toBeUndefined();
      expect(m['w:right']).toBeUndefined();
    });

    it('logical-only source: edited left edits <w:start>, still no <w:left>', () => {
      const node = {
        attrs: {
          colwidth: [50],
          widthUnit: 'px',
          tableCellProperties: {
            cellMargins: {
              marginStart: { value: 480, type: 'dxa' },
              marginEnd: { value: 60, type: 'dxa' },
            },
          },
          tableCellPropertiesInlineKeys: ['cellMargins'],
          // user-visible left was edited from twipsToPixels(480) to 100 px
          cellMargins: { top: 0, bottom: 0, left: 100, right: twipsToPixels(60) },
        },
      };
      const tcPr = generateTableCellProperties(node);
      const m = marByName(tcPr);
      expect(m['w:start']).toBe(String(pixelsToTwips(100)));
      expect(m['w:end']).toBe('60');
      expect(m['w:left']).toBeUndefined();
      expect(m['w:right']).toBeUndefined();
    });

    it('physical-only source: exports only <w:left>/<w:right>', () => {
      const node = {
        attrs: {
          colwidth: [50],
          widthUnit: 'px',
          tableCellProperties: {
            cellMargins: {
              marginLeft: { value: 120, type: 'dxa' },
              marginRight: { value: 60, type: 'dxa' },
            },
          },
          tableCellPropertiesInlineKeys: ['cellMargins'],
          cellMargins: { top: 0, bottom: 0, left: twipsToPixels(120), right: twipsToPixels(60) },
        },
      };
      const tcPr = generateTableCellProperties(node);
      const m = marByName(tcPr);
      expect(m['w:left']).toBe('120');
      expect(m['w:right']).toBe('60');
      expect(m['w:start']).toBeUndefined();
      expect(m['w:end']).toBeUndefined();
    });

    it('mixed source unchanged: preserves both pairs', () => {
      // Synthetic. Real Word output never produces this; the path exists for
      // resilience and to keep import precedence (physical wins) self-consistent.
      const node = {
        attrs: {
          colwidth: [50],
          widthUnit: 'px',
          tableCellProperties: {
            cellMargins: {
              marginLeft: { value: 120, type: 'dxa' },
              marginRight: { value: 60, type: 'dxa' },
              marginStart: { value: 480, type: 'dxa' },
              marginEnd: { value: 90, type: 'dxa' },
            },
          },
          tableCellPropertiesInlineKeys: ['cellMargins'],
          // Unchanged: mirrors getTableCellMargins precedence (physical wins).
          cellMargins: { top: 0, bottom: 0, left: twipsToPixels(120), right: twipsToPixels(60) },
        },
      };
      const tcPr = generateTableCellProperties(node);
      const m = marByName(tcPr);
      expect(m['w:left']).toBe('120');
      expect(m['w:right']).toBe('60');
      expect(m['w:start']).toBe('480');
      expect(m['w:end']).toBe('90');
    });

    it('mixed source, only left edited: normalizes left to physical, leaves right pair intact', () => {
      // Per-side policy: each horizontal side decides logical-vs-physical
      // independently. An edit to one side does not retroactively rewrite the
      // other side's preserved shape.
      const node = {
        attrs: {
          colwidth: [50],
          widthUnit: 'px',
          tableCellProperties: {
            cellMargins: {
              marginLeft: { value: 120, type: 'dxa' },
              marginRight: { value: 60, type: 'dxa' },
              marginStart: { value: 480, type: 'dxa' },
              marginEnd: { value: 90, type: 'dxa' },
            },
          },
          tableCellPropertiesInlineKeys: ['cellMargins'],
          // Left edited (100 px). Right unchanged (still mirrors import physical).
          cellMargins: { top: 0, bottom: 0, left: 100, right: twipsToPixels(60) },
        },
      };
      const tcPr = generateTableCellProperties(node);
      const m = marByName(tcPr);
      expect(m['w:left']).toBe(String(pixelsToTwips(100)));
      expect(m['w:start']).toBeUndefined();
      // Right side untouched: both pairs preserved.
      expect(m['w:right']).toBe('60');
      expect(m['w:end']).toBe('90');
    });

    it('mixed source edited: normalizes to physical, drops logical', () => {
      const node = {
        attrs: {
          colwidth: [50],
          widthUnit: 'px',
          tableCellProperties: {
            cellMargins: {
              marginLeft: { value: 120, type: 'dxa' },
              marginRight: { value: 60, type: 'dxa' },
              marginStart: { value: 480, type: 'dxa' },
              marginEnd: { value: 90, type: 'dxa' },
            },
          },
          tableCellPropertiesInlineKeys: ['cellMargins'],
          // Edited: left differs from imported physical (120 twips -> 8 px).
          cellMargins: { top: 0, bottom: 0, left: 100, right: 50 },
        },
      };
      const tcPr = generateTableCellProperties(node);
      const m = marByName(tcPr);
      expect(m['w:left']).toBe(String(pixelsToTwips(100)));
      expect(m['w:right']).toBe(String(pixelsToTwips(50)));
      expect(m['w:start']).toBeUndefined();
      expect(m['w:end']).toBeUndefined();
    });

    it('new cell (no imported tableCellProperties.cellMargins): defaults to physical', () => {
      const node = {
        attrs: {
          colwidth: [50],
          widthUnit: 'px',
          cellMargins: { top: 8, right: 4, bottom: 8, left: 4 },
        },
      };
      const tcPr = generateTableCellProperties(node);
      const m = marByName(tcPr);
      expect(m['w:left']).toBe(String(pixelsToTwips(4)));
      expect(m['w:right']).toBe(String(pixelsToTwips(4)));
      expect(m['w:start']).toBeUndefined();
      expect(m['w:end']).toBeUndefined();
    });

    it('emits w:tcMar children in CT_TcMar sequence order', () => {
      const node = {
        attrs: {
          colwidth: [50],
          widthUnit: 'px',
          tableCellProperties: {
            cellMargins: {
              marginStart: { value: 480, type: 'dxa' },
              marginEnd: { value: 60, type: 'dxa' },
              marginTop: { value: 120, type: 'dxa' },
              marginBottom: { value: 90, type: 'dxa' },
            },
          },
          tableCellPropertiesInlineKeys: ['cellMargins'],
          cellMargins: {
            top: twipsToPixels(120),
            bottom: twipsToPixels(90),
            left: twipsToPixels(480),
            right: twipsToPixels(60),
          },
        },
      };
      const tcPr = generateTableCellProperties(node);
      const mar = tcPr.elements.find((e) => e.name === 'w:tcMar');
      const names = mar.elements.map((e) => e.name);
      // CT_TcMar sequence subset: top, start, bottom, end.
      expect(names).toEqual(['w:top', 'w:start', 'w:bottom', 'w:end']);
    });
  });

  it('translateTableCell wraps children with tcPr as the first element', async () => {
    const params = {
      node: { attrs: { colwidth: [60], widthUnit: 'px' } },
      children: [],
    };

    const out = translateTableCell(params);
    expect(out.name).toBe('w:tc');
    expect(Array.isArray(out.elements)).toBe(true);
    expect(out.elements[0].name).toBe('w:tcPr');
    // mocked child from translateChildNodes
    expect(out.elements[1]).toMatchObject({ name: 'w:p' });
  });

  it('generateTableCellProperties strips # from background color and adds val:clear', () => {
    const node = { attrs: { background: { color: '#A1B2C3' } } };
    const tcPr = generateTableCellProperties(node);
    const shd = tcPr.elements.find((e) => e.name === 'w:shd');
    expect(shd.attributes['w:fill']).toBe('A1B2C3');
    expect(shd.attributes['w:val']).toBe('clear');
  });

  it('generateTableCellProperties does not write w:shd for non-hex background (e.g. auto)', () => {
    const node = { attrs: { colwidth: [100], widthUnit: 'px', background: { color: 'auto' } } };
    const tcPr = generateTableCellProperties(node);
    const shd = tcPr.elements.find((e) => e.name === 'w:shd');
    expect(shd).toBeUndefined();
  });
});

/** Helper: extract w:tcW element from a generateTableCellProperties result */
function getTcW(tcPr) {
  return tcPr.elements?.find((e) => e.name === 'w:tcW') ?? null;
}

describe('IT-550: tableHeader width export fixes', () => {
  it('uses pixelsToTwips when widthUnit is px', () => {
    const node = { attrs: { colwidth: [100], widthUnit: 'px' } };
    const tcPr = generateTableCellProperties(node);
    const tcW = getTcW(tcPr);
    expect(tcW.attributes['w:w']).toBe(String(pixelsToTwips(100)));
    expect(tcW.attributes['w:type']).toBe('dxa');
  });

  it('defaults widthUnit to px when missing', () => {
    // Simulates a tableHeader node before Step 1 fix — no widthUnit attr at all
    const node = { attrs: { colwidth: [100] } };
    const tcPr = generateTableCellProperties(node);
    const tcW = getTcW(tcPr);
    // Should use pixelsToTwips (not inchesToTwips), producing 1500, not 144000
    expect(tcW.attributes['w:w']).toBe(String(pixelsToTwips(100)));
  });

  it('preserves existing cellWidth when colwidth is null', () => {
    const originalCellWidth = { value: 3000, type: 'dxa' };
    const node = {
      attrs: {
        colwidth: null,
        widthUnit: 'px',
        tableCellProperties: { cellWidth: originalCellWidth },
      },
    };
    const tcPr = generateTableCellProperties(node);
    const tcW = getTcW(tcPr);
    // Should preserve the original value, not write 0
    expect(tcW.attributes['w:w']).toBe('3000');
    expect(tcW.attributes['w:type']).toBe('dxa');
  });

  it('preserves existing cellWidth when colwidth is empty array', () => {
    const originalCellWidth = { value: 3000, type: 'dxa' };
    const node = {
      attrs: {
        colwidth: [],
        widthUnit: 'px',
        tableCellProperties: { cellWidth: originalCellWidth },
      },
    };
    const tcPr = generateTableCellProperties(node);
    const tcW = getTcW(tcPr);
    expect(tcW.attributes['w:w']).toBe('3000');
  });

  it('filters non-finite values from colwidth', () => {
    const node = { attrs: { colwidth: [100, NaN, 50], widthUnit: 'px' } };
    const tcPr = generateTableCellProperties(node);
    const tcW = getTcW(tcPr);
    // Only 100 + 50 = 150 should be summed (NaN filtered out)
    expect(tcW.attributes['w:w']).toBe(String(pixelsToTwips(150)));
  });

  it('preserves original cellWidth for pct width type', () => {
    // Simulates a pct-imported cell: widthType is 'pct', colwidth is in pixels (from tblGrid fallback)
    const originalCellWidth = { value: 5000, type: 'pct' };
    const node = {
      attrs: {
        colwidth: [200],
        widthUnit: 'px',
        widthType: 'pct',
        tableCellProperties: { cellWidth: originalCellWidth },
      },
    };
    const tcPr = generateTableCellProperties(node);
    const tcW = getTcW(tcPr);
    // Should preserve original pct value, NOT rewrite with pixelsToTwips(200)
    expect(tcW.attributes['w:w']).toBe('5000');
    expect(tcW.attributes['w:type']).toBe('pct');
  });

  it('resolves widthType dxa from node attrs', () => {
    const node = { attrs: { colwidth: [100], widthUnit: 'px', widthType: 'dxa' } };
    const tcPr = generateTableCellProperties(node);
    const tcW = getTcW(tcPr);
    expect(tcW.attributes['w:type']).toBe('dxa');
  });

  it('falls through auto widthType to tableCellProperties.cellWidth.type', () => {
    const node = {
      attrs: {
        colwidth: [100],
        widthUnit: 'px',
        widthType: 'auto',
        tableCellProperties: { cellWidth: { value: 1500, type: 'dxa' } },
      },
    };
    const tcPr = generateTableCellProperties(node);
    const tcW = getTcW(tcPr);
    // 'auto' is the uninformative default — should fall through to tableCellProperties type
    expect(tcW.attributes['w:type']).toBe('dxa');
  });

  it('falls through auto widthType to dxa when no tableCellProperties type', () => {
    const node = {
      attrs: {
        colwidth: [100],
        widthUnit: 'px',
        widthType: 'auto',
      },
    };
    const tcPr = generateTableCellProperties(node);
    const tcW = getTcW(tcPr);
    expect(tcW.attributes['w:type']).toBe('dxa');
  });
});
