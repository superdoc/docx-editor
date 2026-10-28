import { describe, expect, it } from 'vite-plus/test';
import { measureBlock, type TableMeasurementObservation } from './index.js';
import type { DrawingBlock, FlowBlock, ListBlock, Measure, TableBlock, ParagraphBlock } from '@superdoc/contracts';

const textRun = (text: string, fontSize = 16) => ({
  kind: 'text' as const,
  text,
  fontFamily: 'Arial',
  fontSize,
});

const expectMeasureKind = <TKind extends Measure['kind']>(
  measure: Measure,
  kind: TKind,
): Extract<Measure, { kind: TKind }> => {
  expect(measure.kind).toBe(kind);
  return measure as Extract<Measure, { kind: TKind }>;
};

describe('Measuring to Layout contract', () => {
  it.each([-14, 48])('wraps a historical prefix exactly like plain text with first-line delta %i', async (delta) => {
    const make = (): ParagraphBlock => ({
      kind: 'paragraph',
      id: 'retained-paragraph',
      attrs: { indent: { left: 96, ...(delta < 0 ? { hanging: -delta } : { firstLine: delta }) } },
      runs: [
        textRun('Alpha'),
        { kind: 'tab' },
        textRun('Every following word preserves the authored tab and wraps predictably. '.repeat(10)),
      ],
    });
    const plain = make(),
      historical = make();
    historical.attrs!.wordLayout = {
      textStartMode: 'paragraph',
      indentLeftPx: 96,
      hangingPx: 24,
      firstLinePx: 0,
      tabsPx: [],
      marker: { markerText: 'LONG.', justification: 'left', suffix: 'tab', run: { fontFamily: 'Arial', fontSize: 16 } },
    };
    const before = expectMeasureKind(await measureBlock(plain, 400), 'paragraph');
    const after = expectMeasureKind(await measureBlock(historical, 400), 'paragraph');
    expect(before.lines.length).toBeGreaterThan(1);
    expect(after.lines).toEqual(before.lines);
    expect(after.totalHeight).toBe(before.totalHeight);
  });

  it('produces paragraph line geometry and total height for layout', async () => {
    const block: FlowBlock = {
      kind: 'paragraph',
      id: 'paragraph-contract',
      runs: [textRun('SuperDoc wraps this paragraph into measured lines.')],
    };

    const measure = expectMeasureKind(await measureBlock(block, 120), 'paragraph');

    expect(measure.lines.length).toBeGreaterThan(0);
    expect(measure.totalHeight).toBe(measure.lines.reduce((sum, line) => sum + line.lineHeight, 0));
    for (const line of measure.lines) {
      expect(line.width).toBeGreaterThanOrEqual(0);
      expect(line.lineHeight).toBeGreaterThan(0);
      expect(line.maxWidth).toBeGreaterThan(0);
    }
  });

  it('includes inline box edges and block padding in layout-owned line geometry', async () => {
    const block: FlowBlock = {
      kind: 'paragraph',
      id: 'inline-box-contract',
      runs: [textRun('citation text')],
      inlineBoxes: [
        {
          id: 'citation',
          from: 0,
          to: 8,
          layout: {
            paddingInlineStart: 5,
            paddingInlineEnd: 7,
            paddingBlockStart: 3,
            paddingBlockEnd: 4,
            gapBefore: 2,
            gapAfter: 2,
            borderWidth: 1,
          },
          appearance: {},
        },
      ],
    };
    const plain = { ...block, inlineBoxes: undefined };
    const [measure, plainMeasure] = await Promise.all([
      measureBlock(block, 200).then((value) => expectMeasureKind(value, 'paragraph')),
      measureBlock(plain, 200).then((value) => expectMeasureKind(value, 'paragraph')),
    ]);

    expect(measure.lines[0]!.inlineBoxes).toHaveLength(1);
    expect(measure.lines[0]!.width - plainMeasure.lines[0]!.width).toBeCloseTo(18, 3);
    expect(measure.lines[0]!.lineHeight - plainMeasure.lines[0]!.lineHeight).toBe(9);
    expect(measure.totalHeight).toBe(measure.lines.reduce((sum, line) => sum + line.lineHeight, 0));
  });

  it('produces list item marker metrics and nested paragraph measures', async () => {
    const block: ListBlock = {
      kind: 'list',
      id: 'list-contract',
      listType: 'number',
      items: [
        {
          id: 'item-1',
          marker: { kind: 'number', text: '1.', level: 0, order: 1 },
          paragraph: {
            kind: 'paragraph',
            id: 'item-1-paragraph',
            runs: [textRun('A list item paragraph measured under the item content width.')],
            attrs: { indent: { left: 24, hanging: 18 } },
          },
        },
      ],
    };

    const measure = expectMeasureKind(await measureBlock(block, 220), 'list');

    expect(measure.items).toHaveLength(1);
    expect(measure.items[0]).toMatchObject({
      itemId: 'item-1',
      indentLeft: 24,
      paragraph: { kind: 'paragraph' },
    });
    expect(measure.items[0].markerTextWidth).toBeGreaterThan(0);
    expect(measure.items[0].markerWidth).toBeGreaterThanOrEqual(measure.items[0].markerTextWidth);
    expect(measure.totalHeight).toBe(measure.items[0].paragraph.totalHeight);
  });

  it('produces table row, cell, column, and nested content measures', async () => {
    const block: TableBlock = {
      kind: 'table',
      id: 'table-contract',
      columnWidths: [120],
      rows: [
        {
          id: 'row-1',
          cells: [
            {
              id: 'cell-1',
              blocks: [
                {
                  kind: 'paragraph',
                  id: 'cell-paragraph',
                  runs: [textRun('Nested cell paragraph')],
                },
                {
                  kind: 'image',
                  id: 'cell-image',
                  src: 'image.png',
                  width: 40,
                  height: 20,
                },
              ],
            },
          ],
        },
      ],
    };

    const measure = expectMeasureKind(await measureBlock(block, 240), 'table');

    expect(measure.columnWidths).toHaveLength(1);
    expect(measure.totalWidth).toBeGreaterThan(0);
    expect(measure.totalHeight).toBeGreaterThan(0);
    expect(measure.rows).toHaveLength(1);
    expect(measure.rows[0].cells).toHaveLength(1);
    expect(measure.rows[0].cells[0].blocks?.map((nested) => nested.kind)).toEqual(['paragraph', 'image']);
  });

  it('attributes table measurement phases without changing the measure contract', async () => {
    const observations: TableMeasurementObservation[] = [];
    const block: TableBlock = {
      kind: 'table',
      id: 'table-attribution-contract',
      columnWidths: [120],
      attrs: { tableLayout: 'fixed' },
      rows: [
        {
          id: 'row-attribution',
          cells: [
            {
              id: 'cell-attribution',
              blocks: [
                {
                  kind: 'paragraph',
                  id: 'cell-attribution-paragraph',
                  runs: [textRun('Measured exactly once')],
                },
              ],
            },
          ],
        },
      ],
    };

    const measure = await measureBlock(block, {
      maxWidth: 240,
      tableMeasurementTrace: {
        depth: 0,
        cacheIdentity: 'strict',
        observer: (observation) => observations.push(observation),
      },
    });

    expect(measure.kind).toBe('table');
    expect(observations).toHaveLength(1);
    const observation = observations[0];
    expect(observation).toMatchObject({
      depth: 0,
      mode: 'fixed',
      rowCount: 1,
      cellCount: 1,
      nestedBlockCount: 1,
    });
    const attributedWallMs = Object.values(observation.phases).reduce((sum, wallMs) => sum + wallMs, 0);
    expect(Math.abs(attributedWallMs - observation.totalWallMs)).toBeLessThan(0.001);
    expect(observation.reconciliationDeltaMs).toBeLessThan(0.001);
    expect(Object.values(observation.cellBlockCache).reduce((sum, count) => sum + count, 0)).toBe(1);
  });

  it('produces final image dimensions after measurement constraints', async () => {
    const block: FlowBlock = {
      kind: 'image',
      id: 'image-contract',
      src: 'image.png',
      width: 400,
      height: 200,
    };

    const measure = expectMeasureKind(await measureBlock(block, { maxWidth: 100, maxHeight: 80 }), 'image');

    expect(measure.width).toBe(100);
    expect(measure.height).toBe(50);
  });

  it('produces drawing geometry, scale, and natural size for layout', async () => {
    const block: DrawingBlock = {
      kind: 'drawing',
      id: 'drawing-contract',
      drawingKind: 'vectorShape',
      geometry: { width: 200, height: 100 },
    };

    const measure = expectMeasureKind(await measureBlock(block, { maxWidth: 100, maxHeight: 100 }), 'drawing');

    expect(measure).toMatchObject({
      drawingKind: 'vectorShape',
      width: 100,
      height: 50,
      scale: 0.5,
      naturalWidth: 200,
      naturalHeight: 100,
      geometry: { width: 200, height: 100 },
    });
  });

  it('produces zero-dimensional control measures for break blocks', async () => {
    await expect(measureBlock({ kind: 'sectionBreak', id: 'section-break', margins: {} }, 500)).resolves.toEqual({
      kind: 'sectionBreak',
    });
    await expect(measureBlock({ kind: 'pageBreak', id: 'page-break' }, 500)).resolves.toEqual({ kind: 'pageBreak' });
    await expect(measureBlock({ kind: 'columnBreak', id: 'column-break' }, 500)).resolves.toEqual({
      kind: 'columnBreak',
    });
  });
});
