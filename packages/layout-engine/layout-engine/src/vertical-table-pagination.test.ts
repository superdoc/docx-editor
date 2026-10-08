import { describe, expect, it } from 'bun:test';
import type {
  FlowBlock,
  Measure,
  ParagraphBlock,
  ParagraphMeasure,
  TableBlock,
  TableMeasure,
} from '@superdoc/contracts';
import { layoutDocument } from './index.js';

function paragraph(id: string, height: number): [ParagraphBlock, ParagraphMeasure] {
  return [
    { kind: 'paragraph', id, runs: [{ text: id, fontFamily: 'Arial', fontSize: 12 }] },
    {
      kind: 'paragraph',
      totalHeight: height,
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: id.length,
          width: 50,
          maxWidth: 400,
          ascent: height - 4,
          descent: 4,
          lineHeight: height,
        },
      ],
    },
  ];
}
function scenario(filler: number, rowHeight: number) {
  const [text, textMeasure] = paragraph('rotated', 56);
  const [neighbor, neighborMeasure] = paragraph('neighbor', 20);
  const table: TableBlock = {
    kind: 'table',
    id: 'vertical-table',
    columnWidths: [50, 350],
    rows: Array.from({ length: 4 }, (_, i) => ({
      id: `row-${i}`,
      cells: [
        ...(i === 0
          ? [
              {
                id: 'vertical-cell',
                rowSpan: 4,
                blocks: [text],
                attrs: { tableCellProperties: { textDirection: 'btLr' } },
              },
            ]
          : []),
        { id: `neighbor-${i}`, blocks: [neighbor] },
      ],
    })),
  };
  const tableMeasure: TableMeasure = {
    kind: 'table',
    columnWidths: [50, 350],
    totalWidth: 400,
    totalHeight: 4 * rowHeight,
    rows: Array.from({ length: 4 }, (_, i) => ({
      height: rowHeight,
      cells: [
        ...(i === 0
          ? [
              {
                width: 50,
                height: rowHeight * 4,
                rowSpan: 4,
                colSpan: 1,
                gridColumnStart: 0,
                blocks: [textMeasure],
                paragraph: textMeasure,
                verticalText: { direction: 'btLr', inlineSize: rowHeight * 4, blockSize: 50 },
              },
            ]
          : []),
        {
          width: 350,
          height: rowHeight,
          rowSpan: 1,
          colSpan: 1,
          gridColumnStart: 1,
          blocks: [neighborMeasure],
          paragraph: neighborMeasure,
        },
      ],
    })),
  };
  const pairs: [FlowBlock, Measure][] = [
    ...(filler ? [paragraph('filler', filler)] : []),
    [table, tableMeasure],
    paragraph('following', 20),
  ];
  return layoutDocument(
    pairs.map((p) => p[0]),
    pairs.map((p) => p[1]),
    { pageSize: { w: 600, h: 600 }, margins: { top: 50, bottom: 50, left: 50, right: 50 } },
  );
}

describe('rotated merged-cell pagination boundary', () => {
  it('moves a fitting vertical span intact to the next page instead of treating cross-axis lines as Y slices', () => {
    const layout = scenario(430, 24);
    const fragments = layout.pages.flatMap((page, index) =>
      page.fragments.filter((f) => f.blockId === 'vertical-table').map((f) => ({ page: index + 1, fragment: f })),
    );
    expect(fragments).toHaveLength(1);
    expect(fragments[0].page).toBe(2);
    expect(fragments[0].fragment).toMatchObject({ fromRow: 0, toRow: 4 });
    expect(fragments[0].fragment.kind === 'table' && fragments[0].fragment.partialRow).toBeUndefined();
  });
  it('makes finite progress for an oversized unsupported span without losing its rows', () => {
    const layout = scenario(0, 150);
    expect(layout.pages.length).toBeLessThan(10);
    const fragments = layout.pages.flatMap((page) => page.fragments).filter((f) => f.kind === 'table');
    expect(fragments.flatMap((f) => Array.from({ length: f.toRow - f.fromRow }, (_, i) => f.fromRow + i))).toEqual([
      0, 1, 2, 3,
    ]);
    expect(layout.pages.some((page) => page.fragments.some((f) => f.blockId === 'following'))).toBe(true);
  });
});
