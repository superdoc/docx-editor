import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vite-plus/test';
import type { ParagraphBlock, TableBlock, TextRun, TextboxDrawing } from '@superdoc/contracts';
import { hashMeasureContent, MeasureCache } from '../src/cache.js';

const paragraph = (id: string, text: string): ParagraphBlock => ({
  kind: 'paragraph',
  id,
  runs: [{ text, fontSize: 12, fontFamily: 'Arial' }],
});

const table = (count = 10_000): TableBlock => ({
  kind: 'table',
  id: 'large-table',
  rows: Array.from({ length: count / 10 }, (_, row) => ({
    id: `r${row}`,
    cells: Array.from({ length: 10 }, (_, col) => ({
      id: `c${row}-${col}`,
      blocks: [paragraph(`p${row}-${col}`, `cell ${row}-${col}: ${'content '.repeat(12)}`)],
    })),
  })),
});

describe('bounded table measurement identity', () => {
  it('bounds content and retained cache key size independently of cell count', () => {
    const block = table();
    const cache = new MeasureCache<{ height: number }>();

    expect(hashMeasureContent(block).length).toBeLessThan(128);
    expect(cache.prepareKey(block, 400, 600, 'fonts').length).toBeLessThan(192);
    cache.set(block, 400, 600, { height: 100 }, 'fonts');
    expect(cache.get(structuredClone(block), 400, 600, 'fonts')).toEqual({ height: 100 });
    expect(cache.get(block, 401, 600, 'fonts')).toBeUndefined();
    expect(cache.get(block, 400, 601, 'fonts')).toBeUndefined();
    expect(cache.get(block, 400, 600, 'other-fonts')).toBeUndefined();
    cache.invalidate([block.id]);
    expect(cache.get(block, 400, 600, 'fonts')).toBeUndefined();
  });

  it.each([0, 500, 999])('invalidates a large table after a text or style edit in row %i', (row) => {
    const block = table();
    const cache = new MeasureCache<{ height: number }>();
    cache.set(block, 400, 600, { height: 100 });
    const edited = structuredClone(block);
    const run = (edited.rows[row]!.cells[0]!.blocks![0] as ParagraphBlock).runs[0] as TextRun;
    run.text += ' ';
    expect(cache.get(edited, 400, 600)).toBeUndefined();
    run.text = (block.rows[row]!.cells[0]!.blocks![0] as ParagraphBlock).runs[0]!.text!;
    run.bold = true;
    expect(cache.get(edited, 400, 600)).toBeUndefined();
    expect(cache.get(block, 400, 600)).toEqual({ height: 100 });
  });

  it('streams the existing ordered serialization, including nested tables and geometry', () => {
    const block: TableBlock = {
      kind: 'table',
      id: 'outer',
      rows: [
        {
          id: 'row',
          attrs: { rowHeight: { value: 20.8, rule: 'exact' } },
          cells: [
            {
              id: 'cell',
              attrs: { padding: { top: 1, right: 2, bottom: 3, left: 4 }, verticalAlign: 'center' },
              blocks: [
                paragraph('p', ' a\t\uD800\uDC00\uD800 '),
                {
                  kind: 'table',
                  id: 'nested',
                  rows: [{ id: 'nr', cells: [{ id: 'nc', paragraph: paragraph('np', 'inner') }] }],
                },
              ],
            },
          ],
        },
      ],
      attrs: { borderCollapse: 'collapse', cellSpacing: 2 },
      columnWidths: [100.1, 200.8],
    };
    const legacySerialization =
      'outer:table:rh:21:exact|ca:cp:1:2:3:4:va:center| a\t\uD800\uDC00\uD800 :fs:12ff:Arial|nb:table:nested:table:inner:fs:12ff:Arial|ta:bc:collapse:cs:n:2|cw:100,201';
    const expected = createHash('sha256').update(Buffer.from(legacySerialization, 'utf16le')).digest('hex');

    expect(hashMeasureContent(block)).toBe(`table-sha256:${expected}`);
    expect(hashMeasureContent(structuredClone(block))).toBe(hashMeasureContent(block));
    const changed = structuredClone(block);
    const nested = changed.rows[0]!.cells[0]!.blocks![1] as TableBlock;
    (nested.rows[0]!.cells[0]!.paragraph!.runs[0] as TextRun).text += '!';
    expect(hashMeasureContent(changed)).not.toBe(hashMeasureContent(block));
  });

  it('keeps whitespace, unpaired surrogates, order, and table identity distinct', () => {
    const block = table(10);
    const hash = hashMeasureContent(block);
    for (const text of [' a ', ' a  ', '\ud800', '\ud801', '\ufffd', '😀']) {
      const edited = structuredClone(block);
      (edited.rows[0]!.cells[0]!.blocks![0] as ParagraphBlock).runs = [{ text }];
      expect(hashMeasureContent(edited)).not.toBe(hash);
    }
    const surrogates = ['\ud800', '\ud801', '\ufffd'].map((text) => {
      const edited = structuredClone(block);
      (edited.rows[0]!.cells[0]!.blocks![0] as ParagraphBlock).runs = [{ text }];
      return hashMeasureContent(edited);
    });
    expect(new Set(surrogates).size).toBe(3);
    const reordered = structuredClone(block);
    reordered.rows[0]!.cells.reverse();
    expect(hashMeasureContent(reordered)).not.toBe(hash);
    expect(hashMeasureContent({ ...block, id: 'different-table' })).not.toBe(hash);
  });

  it('bounds a table nested inside a textbox without substituting a nested digest', () => {
    const nested = table();
    const drawing: TextboxDrawing = {
      kind: 'drawing',
      id: 'textbox',
      drawingKind: 'textboxShape',
      geometry: { width: 100, height: 200 },
      contentBlocks: [nested],
    };
    const outer: TableBlock = {
      kind: 'table',
      id: 'outer',
      rows: [{ id: 'r', cells: [{ id: 'c', blocks: [drawing] }] }],
    };
    const key = hashMeasureContent(outer);
    expect(key.length).toBeLessThan(128);
    const legacyNested =
      'large-table:table:' +
      nested.rows
        .flatMap((row) =>
          row.cells.map((cell) => {
            const run = (cell.blocks![0] as ParagraphBlock).runs[0] as TextRun;
            return `${run.text}:fs:12ff:Arial`;
          }),
        )
        .join('|');
    const legacyDrawingPrefix = [
      'drawing:textbox',
      '100:200:0:0:0',
      '',
      'null',
      'null',
      '',
      'null',
      'null',
      'null',
      'null',
      '',
      '',
      'null',
    ].join(':');
    const expected = createHash('sha256')
      .update(Buffer.from(`outer:table:nb:${legacyDrawingPrefix}:large-table:${legacyNested}`, 'utf16le'))
      .digest('hex');
    expect(key).toBe(`table-sha256:${expected}`);
    const changed = structuredClone(outer);
    const changedDrawing = changed.rows[0]!.cells[0]!.blocks![0] as TextboxDrawing;
    const changedTable = changedDrawing.contentBlocks[0] as TableBlock;
    (changedTable.rows[999]!.cells[9]!.blocks![0] as ParagraphBlock).runs[0]!.text += '!';
    expect(hashMeasureContent(changed)).not.toBe(key);
  });
});
