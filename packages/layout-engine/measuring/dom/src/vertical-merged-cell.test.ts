import { afterEach, describe, expect, it } from 'vite-plus/test';
import type { ParagraphBlock, TableBlock, TableMeasure } from '@superdoc/contracts';
import { clearTextMeasurementCaches, configureMeasurement, createDomMeasurementRuntime } from './index.js';
import { clearTableCellBlockMeasureCache } from './table-cell-block-measure-cache.js';

function mergedTable(direction?: string): TableBlock {
  const paragraph = (id: string, text: string): ParagraphBlock => ({
    kind: 'paragraph',
    id,
    runs: [{ text, fontFamily: 'Arial', fontSize: 12 }],
    attrs: { spacing: { before: 0, after: 0, line: 14, lineRule: 'exact' } },
  });
  return {
    kind: 'table',
    id: 'direction-table',
    columnWidths: [50, 350],
    attrs: { tableLayout: 'fixed' },
    rows: Array.from({ length: 4 }, (_, i) => ({
      id: `row-${i}`,
      cells: [
        ...(i === 0
          ? [
              {
                id: 'merged',
                rowSpan: 4,
                attrs: {
                  padding: { top: 3, bottom: 5, left: 4, right: 6 },
                  tableCellProperties: direction ? { textDirection: direction } : {},
                },
                blocks: [paragraph('rotated', 'NORTH EAST SOUTH WEST LABEL 123456')],
              },
            ]
          : []),
        { id: `neighbor-${i}`, blocks: [paragraph(`neighbor-p-${i}`, `Row ${i + 1}`)] },
      ],
    })),
  };
}

async function measure(block: TableBlock, retainedTable?: { block: TableBlock; measure: TableMeasure }) {
  const runtime = createDomMeasurementRuntime();
  const pass = runtime.beginPass({ fontSignature: 'vertical-cell-fixture', resolvePhysical: (f) => f });
  try {
    return (await pass.measureBlock(block, { maxWidth: 400, retainedTable })) as TableMeasure;
  } finally {
    pass.finish();
    runtime.dispose();
  }
}

describe('Word-qualified merged paragraph cell direction', () => {
  afterEach(() => {
    clearTextMeasurementCaches();
    clearTableCellBlockMeasureCache();
    configureMeasurement({ mode: 'browser' });
  });
  for (const direction of ['btLr', 'tbRl']) {
    it(`does not reserve horizontal wrapping height for ${direction}, and reflows at the final span`, async () => {
      const vertical = await measure(mergedTable(direction));
      const horizontal = await measure(mergedTable());
      expect(vertical.totalHeight).toBeLessThan(horizontal.totalHeight);
      const paragraph = vertical.rows[0].cells[0].paragraph!;
      expect(paragraph.measuredAtMaxWidth).toBeCloseTo(vertical.totalHeight - 8, 4);
      expect(paragraph.lines.length).toBeLessThan(horizontal.rows[0].cells[0].paragraph!.lines.length);
    });
  }
  for (const direction of ['btLr', 'tbRl']) {
    for (const padding of [
      { top: 0, bottom: 0, left: 0, right: 0 },
      { top: 3, bottom: 5, left: 4, right: 6 },
    ]) {
      it(`retains horizontal fallback for ${direction} without usable span capacity (${padding.top}/${padding.bottom})`, async () => {
        const source = mergedTable(direction);
        source.columnWidths = [80];
        source.rows = source.rows.map((row, index) => ({
          ...row,
          cells: index === 0 ? [{ ...row.cells[0], attrs: { ...row.cells[0].attrs, padding } }] : [],
        }));
        const horizontal = structuredClone(source);
        horizontal.rows[0].cells[0].attrs!.tableCellProperties = {};
        const sourceBefore = JSON.stringify(source);
        const control = await measure(horizontal);
        const controlBefore = JSON.stringify(control);
        const result = await measure(source);
        expect(result.totalHeight).toBeGreaterThan(0);
        expect(result).toEqual(control);
        expect(result.rows[0].cells[0].verticalText).toBeUndefined();
        expect(await measure(source, { block: horizontal, measure: control })).toEqual(result);
        expect(JSON.stringify(source)).toBe(sourceBefore);
        expect(JSON.stringify(control)).toBe(controlBefore);
      });
    }
  }
  for (const span of [3, 5]) {
    for (const direction of ['btLr', 'tbRl']) {
      for (const chromeKind of ['padding', 'border', 'both']) {
        it(`retains ${direction} text with fractional ${chromeKind} across ${span} rows`, async () => {
          const source = mergedTable(direction);
          const cell = source.rows[0].cells[0];
          const chrome = span === 3 ? 23 / 15 : 11 / 15;
          cell.rowSpan = span;
          cell.attrs = {
            ...cell.attrs,
            padding: {
              top: chromeKind === 'padding' ? chrome : chromeKind === 'both' ? chrome / 2 : 0,
              bottom: 0,
              left: 4,
              right: 4,
            },
            borders:
              chromeKind === 'padding'
                ? undefined
                : {
                    top: { width: chromeKind === 'both' ? chrome / 2 : chrome, style: 'single', color: '000000' },
                  },
          };
          source.columnWidths = [80];
          source.rows = Array.from({ length: span }, (_, index) => ({
            id: `row-${index}`,
            cells: index === 0 ? [cell] : [],
          }));
          const horizontal = structuredClone(source);
          horizontal.rows[0].cells[0].attrs!.tableCellProperties = {};
          const before = JSON.stringify(source);
          expect(await measure(source)).toEqual(await measure(horizontal));
          expect(JSON.stringify(source)).toBe(before);
        });
      }
      it(`preserves authored tiny exact heights for ${direction} across ${span} rows`, async () => {
        const source = mergedTable(direction);
        const cell = source.rows[0].cells[0];
        cell.rowSpan = span;
        cell.attrs = { ...cell.attrs, padding: { top: 0, bottom: 0, left: 0, right: 0 } };
        source.columnWidths = [80];
        source.rows = Array.from({ length: span }, (_, index) => ({
          id: `row-${index}`,
          attrs: { rowHeight: { value: 0.1, rule: 'exact' } },
          cells: index === 0 ? [cell] : [],
        }));
        const horizontal = structuredClone(source);
        horizontal.rows[0].cells[0].attrs!.tableCellProperties = {};
        const control = await measure(horizontal);
        const result = await measure(source);
        expect(result.totalHeight).toBe(control.totalHeight);
        expect(result.totalHeight).toBeCloseTo(span * 0.1, 6);
        expect(result.totalHeight).toBeLessThan(control.rows[0].cells[0].paragraph!.totalHeight);
      });
    }
  }
  it('keeps direction-only warm changes equal to cold layout', async () => {
    const original = mergedTable();
    const old = await measure(original);
    const before = JSON.stringify(old);
    const next = {
      ...original,
      rows: original.rows.map((row, i) =>
        i
          ? row
          : {
              ...row,
              cells: row.cells.map((cell, j) =>
                j ? cell : { ...cell, attrs: { ...cell.attrs, tableCellProperties: { textDirection: 'btLr' } } },
              ),
            },
      ),
    };
    const warm = await measure(next, { block: original, measure: old });
    const cold = await measure(next);
    expect(warm).toEqual(cold);
    expect(warm.totalHeight).toBeLessThan(old.totalHeight);
    expect(JSON.stringify(old)).toBe(before);
  });
  it('reflows unchanged vertical text when neighboring row capacity changes', async () => {
    const original = mergedTable('btLr');
    const old = await measure(original);
    const first = original.rows[0].cells[0].blocks![0];
    const next = {
      ...original,
      rows: original.rows.map((row, i) =>
        i !== 3
          ? row
          : {
              ...row,
              cells: row.cells.map((cell) => ({
                ...cell,
                blocks: [
                  {
                    ...cell.blocks![0],
                    runs: [{ text: 'Changed neighbor '.repeat(40), fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              })),
            },
      ),
    } as TableBlock;
    expect(next.rows[0].cells[0].blocks![0]).toBe(first);
    const warm = await measure(next, { block: original, measure: old });
    expect(warm).toEqual(await measure(next));
    expect(warm.rows[0].cells[0].paragraph!.measuredAtMaxWidth).toBeGreaterThan(
      old.rows[0].cells[0].paragraph!.measuredAtMaxWidth!,
    );
    expect(warm.rows[0].cells[0].paragraph!.lines.length).toBeLessThan(old.rows[0].cells[0].paragraph!.lines.length);
  });
  it('preserves a paragraph writing-mode override instead of rotating it from the cell', async () => {
    const source = mergedTable('btLr');
    const p = source.rows[0].cells[0].blocks![0] as ParagraphBlock;
    p.attrs = { ...p.attrs, textDirection: 'lrTb' };
    const result = await measure(source);
    expect(result.rows[0].cells[0].verticalText).toBeUndefined();
    expect(result.totalHeight).toBe((await measure(mergedTable())).totalHeight);
  });
  it('preserves unqualified nested content and unknown direction values', async () => {
    const horizontal = await measure(mergedTable());
    expect(await measure(mergedTable('tbRlV'))).toEqual(horizontal);
    const source = mergedTable('btLr');
    source.rows[0].cells[0].blocks!.push({
      kind: 'image',
      id: 'inline-image',
      src: 'generated.png',
      width: 20,
      height: 70,
    });
    const control = {
      ...source,
      rows: source.rows.map((row, i) =>
        i
          ? row
          : {
              ...row,
              cells: row.cells.map((cell, j) =>
                j ? cell : { ...cell, attrs: { ...cell.attrs, tableCellProperties: {} } },
              ),
            },
      ),
    };
    expect(await measure(source)).toEqual(await measure(control));
  });
});
