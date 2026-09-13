import { describe, it, expect, vi } from 'vite-plus/test';
import type { FlowBlock, Measure, TableBlock, TableMeasure } from '@superdoc/contracts';
import { incrementalLayout } from '../src/incrementalLayout';

const makeParagraph = (id: string, text: string, pmStart: number): FlowBlock => ({
  kind: 'paragraph',
  id,
  runs: [{ text, fontFamily: 'Arial', fontSize: 12, pmStart, pmEnd: pmStart + text.length }],
});

const makeMeasure = (lineHeight: number, textLength: number): Measure => ({
  kind: 'paragraph',
  lines: [
    {
      fromRun: 0,
      fromChar: 0,
      toRun: 0,
      toChar: textLength,
      width: 200,
      ascent: lineHeight * 0.8,
      descent: lineHeight * 0.2,
      lineHeight,
    },
  ],
  totalHeight: lineHeight,
});

describe('Footnotes in columns', () => {
  it('places footnotes in the column of their reference', async () => {
    const paragraphOne = makeParagraph('para-1', 'Column 1 text', 0);
    const columnBreak: FlowBlock = { kind: 'columnBreak', id: 'col-break-1' };
    const paragraphTwo = makeParagraph('para-2', 'Column 2 text', 40);

    const footnoteOne = makeParagraph('footnote-1-0-paragraph', 'Footnote one', 0);
    const footnoteTwo = makeParagraph('footnote-2-0-paragraph', 'Footnote two', 0);

    const measureBlock = vi.fn(async (block: FlowBlock) => {
      if (block.kind === 'columnBreak') {
        return { kind: 'columnBreak' } as Measure;
      }
      const textLength = block.kind === 'paragraph' ? (block.runs?.[0]?.text?.length ?? 1) : 1;
      const lineHeight = block.id.startsWith('footnote-') ? 10 : 18;
      return makeMeasure(lineHeight, textLength);
    });

    const columns = { count: 2, gap: 20 };
    const margins = { top: 60, right: 60, bottom: 60, left: 60 };
    const pageSize = { w: 600, h: 800 };

    const result = await incrementalLayout(
      [],
      null,
      [paragraphOne, columnBreak, paragraphTwo],
      {
        pageSize,
        margins,
        columns,
        footnotes: {
          refs: [
            { id: '1', pos: 2 },
            { id: '2', pos: 42 },
          ],
          blocksById: new Map([
            ['1', [footnoteOne]],
            ['2', [footnoteTwo]],
          ]),
        },
      },
      measureBlock,
    );

    const page = result.layout.pages[0];
    const columnWidth = (pageSize.w - margins.left - margins.right - columns.gap) / columns.count;
    const columnOneX = margins.left;
    const columnTwoX = margins.left + columnWidth + columns.gap;

    const footnoteOneFragment = page.fragments.find((fragment) => fragment.blockId === footnoteOne.id);
    const footnoteTwoFragment = page.fragments.find((fragment) => fragment.blockId === footnoteTwo.id);

    expect(footnoteOneFragment?.x).toBeCloseTo(columnOneX, 2);
    expect(footnoteTwoFragment?.x).toBeCloseTo(columnTwoX, 2);
  });

  it('places footnotes in the mirrored column of their reference in an RTL section', async () => {
    // Footnote refs are assigned to a column by comparing the reference fragment's x against each
    // column's far edge plus half its gap. "Far edge" is direction-relative: in an RTL section
    // column 0 sits on the right and x DESCENDS with the index, so the left-to-right test matches
    // column 0 for every fragment and collapses the whole page's notes into the first column's
    // group — the left column's notes print under the right column and its own note area is empty.
    const paragraphOne = makeParagraph('para-1', 'Column 1 text', 0);
    const columnBreak: FlowBlock = { kind: 'columnBreak', id: 'col-break-1' };
    const paragraphTwo = makeParagraph('para-2', 'Column 2 text', 40);

    const footnoteOne = makeParagraph('footnote-1-0-paragraph', 'Footnote one', 0);
    const footnoteTwo = makeParagraph('footnote-2-0-paragraph', 'Footnote two', 0);

    const measureBlock = vi.fn(async (block: FlowBlock) => {
      if (block.kind === 'columnBreak') {
        return { kind: 'columnBreak' } as Measure;
      }
      const textLength = block.kind === 'paragraph' ? (block.runs?.[0]?.text?.length ?? 1) : 1;
      const lineHeight = block.id.startsWith('footnote-') ? 10 : 18;
      return makeMeasure(lineHeight, textLength);
    });

    const columns = { count: 2, gap: 20, direction: 'rtl' as const };
    const margins = { top: 60, right: 60, bottom: 60, left: 60 };
    const pageSize = { w: 600, h: 800 };

    const result = await incrementalLayout(
      [],
      null,
      [paragraphOne, columnBreak, paragraphTwo],
      {
        pageSize,
        margins,
        columns,
        footnotes: {
          refs: [
            { id: '1', pos: 2 },
            { id: '2', pos: 42 },
          ],
          blocksById: new Map([
            ['1', [footnoteOne]],
            ['2', [footnoteTwo]],
          ]),
        },
      },
      measureBlock,
    );

    const page = result.layout.pages[0];
    const columnWidth = (pageSize.w - margins.left - margins.right - columns.gap) / columns.count;
    // Mirrored: fill column 0 is the RIGHT one, fill column 1 the left.
    const firstColumnX = margins.left + columnWidth + columns.gap;
    const secondColumnX = margins.left;

    const footnoteOneFragment = page.fragments.find((fragment) => fragment.blockId === footnoteOne.id);
    const footnoteTwoFragment = page.fragments.find((fragment) => fragment.blockId === footnoteTwo.id);

    expect(footnoteOneFragment?.x).toBeCloseTo(firstColumnX, 2);
    expect(footnoteTwoFragment?.x).toBeCloseTo(secondColumnX, 2);
    // The two notes must land in DIFFERENT columns; collapsing them into one is the failure mode.
    expect(footnoteOneFragment?.x).not.toBeCloseTo(footnoteTwoFragment?.x ?? 0, 2);
  });

  it('keeps footnotes in the owning column for wide overflow tables', async () => {
    const paragraphOne = makeParagraph('para-1', 'Column 1 text', 0);
    const columnBreak: FlowBlock = { kind: 'columnBreak', id: 'col-break-1' };

    const tableCellParagraph = makeParagraph('table-cell-para', 'Wide table ref', 80);
    const wideTable: TableBlock = {
      kind: 'table',
      id: 'wide-table',
      attrs: { justification: 'right' },
      rows: [
        {
          id: 'row-0',
          cells: [{ id: 'cell-0-0', blocks: [tableCellParagraph] }],
        },
      ],
    };

    const footnote = makeParagraph('footnote-wide-0-paragraph', 'Wide table footnote', 0);

    const tableCellMeasure = makeMeasure(18, 'Wide table ref'.length);
    const wideTableMeasure: TableMeasure = {
      kind: 'table',
      rows: [
        {
          cells: [
            {
              blocks: [tableCellMeasure],
              paragraph: tableCellMeasure,
              width: 320,
              height: 28,
              gridColumnStart: 0,
              colSpan: 1,
              rowSpan: 1,
            },
          ],
          height: 28,
        },
      ],
      columnWidths: [320],
      totalWidth: 320,
      totalHeight: 28,
    };

    const measureBlock = vi.fn(async (block: FlowBlock) => {
      if (block.kind === 'columnBreak') {
        return { kind: 'columnBreak' } as Measure;
      }
      if (block.kind === 'table') {
        return wideTableMeasure;
      }
      const textLength = block.kind === 'paragraph' ? (block.runs?.[0]?.text?.length ?? 1) : 1;
      const lineHeight = block.id.startsWith('footnote-') ? 10 : 18;
      return makeMeasure(lineHeight, textLength);
    });

    const columns = { count: 2, gap: 20 };
    const margins = { top: 60, right: 60, bottom: 60, left: 60 };
    const pageSize = { w: 600, h: 800 };

    const result = await incrementalLayout(
      [],
      null,
      [paragraphOne, columnBreak, wideTable],
      {
        pageSize,
        margins,
        columns,
        footnotes: {
          refs: [{ id: 'wide', pos: 82 }],
          blocksById: new Map([['wide', [footnote]]]),
        },
      },
      measureBlock,
    );

    const page = result.layout.pages[0];
    const columnWidth = (pageSize.w - margins.left - margins.right - columns.gap) / columns.count;
    const columnTwoX = margins.left + columnWidth + columns.gap;

    const tableFragment = page.fragments.find((fragment) => fragment.blockId === wideTable.id);
    const footnoteFragment = page.fragments.find((fragment) => fragment.blockId === footnote.id);

    expect(tableFragment?.kind).toBe('table');
    expect(tableFragment && 'columnIndex' in tableFragment ? tableFragment.columnIndex : undefined).toBe(1);
    expect(tableFragment?.x).toBeLessThan(columnTwoX);
    expect(footnoteFragment?.x).toBeCloseTo(columnTwoX, 2);
  });

  it('tags a list-item footnote body with the flow column of its reference', async () => {
    const paragraphOne = makeParagraph('para-1', 'Column 1 text', 0);
    const columnBreak: FlowBlock = { kind: 'columnBreak', id: 'col-break-1' };
    const paragraphTwo = makeParagraph('para-2', 'Column 2 text', 40);

    const listFootnote: FlowBlock = {
      kind: 'list',
      id: 'footnote-2-0-list',
      listType: 'bullet',
      items: [
        {
          id: 'footnote-2-0-list-item-0',
          marker: { text: '\u2022', font: { family: 'Arial', size: 10 } } as never,
          paragraph: makeParagraph('footnote-2-0-list-item-0', 'List note', 0) as never,
        },
      ],
    };

    const measureBlock = vi.fn(async (block: FlowBlock) => {
      if (block.kind === 'columnBreak') {
        return { kind: 'columnBreak' } as Measure;
      }
      if (block.kind === 'list') {
        return {
          kind: 'list' as const,
          items: block.items.map((item) => ({
            itemId: item.id,
            markerWidth: 10,
            markerTextWidth: 6,
            indentLeft: 0,
            paragraph: makeMeasure(10, 9) as never,
          })),
          totalHeight: 10,
        } as unknown as Measure;
      }
      const textLength = block.kind === 'paragraph' ? (block.runs?.[0]?.text?.length ?? 1) : 1;
      const lineHeight = block.id.startsWith('footnote-') ? 10 : 18;
      return makeMeasure(lineHeight, textLength);
    });

    const columns = { count: 2, gap: 20 };
    const margins = { top: 60, right: 60, bottom: 60, left: 60 };
    const pageSize = { w: 600, h: 800 };

    const result = await incrementalLayout(
      [],
      null,
      [paragraphOne, columnBreak, paragraphTwo],
      {
        pageSize,
        margins,
        columns,
        footnotes: {
          refs: [{ id: '2', pos: 42 }],
          blocksById: new Map([['2', [listFootnote]]]),
        },
      },
      measureBlock,
    );

    const page = result.layout.pages[0];
    const listFragment = page.fragments.find((fragment) => fragment.blockId === listFootnote.id);
    expect(listFragment?.kind).toBe('list-item');
    // The fragment carries its owning flow column so DOM band ids / note
    // geometry group it under column 1, not the column-0 fallback.
    expect(listFragment && 'columnIndex' in listFragment ? listFragment.columnIndex : undefined).toBe(1);
  });

  it('stamps columnBoundaries on a table laid out in the footnote band', async () => {
    const body = makeParagraph('para-1', 'Cite note 1', 0);
    const noteTable: TableBlock = {
      kind: 'table',
      id: 'footnote-1-0-table',
      rows: [
        {
          id: 'fn-row-0',
          cells: [
            { id: 'fn-cell-0', blocks: [makeParagraph('fn-cell-0-p', 'A', 0)] },
            { id: 'fn-cell-1', blocks: [makeParagraph('fn-cell-1-p', 'B', 0)] },
          ],
        },
      ],
    };
    const cellMeasure = makeMeasure(12, 1);
    const tableMeasure: TableMeasure = {
      kind: 'table',
      rows: [
        {
          cells: [
            {
              blocks: [cellMeasure],
              paragraph: cellMeasure,
              width: 80,
              height: 16,
              gridColumnStart: 0,
              colSpan: 1,
              rowSpan: 1,
            },
            {
              blocks: [cellMeasure],
              paragraph: cellMeasure,
              width: 80,
              height: 16,
              gridColumnStart: 1,
              colSpan: 1,
              rowSpan: 1,
            },
          ],
          height: 16,
        },
      ],
      columnWidths: [80, 80],
      totalWidth: 160,
      totalHeight: 16,
    };

    const result = await incrementalLayout(
      [],
      null,
      [body],
      {
        pageSize: { w: 600, h: 800 },
        margins: { top: 60, right: 60, bottom: 60, left: 60 },
        footnotes: {
          refs: [{ id: '1', pos: 2 }],
          blocksById: new Map([['1', [noteTable]]]),
        },
      },
      async (block) => {
        if (block.kind === 'table') return tableMeasure;
        const textLength = block.kind === 'paragraph' ? (block.runs?.[0]?.text?.length ?? 1) : 1;
        return makeMeasure(block.id.startsWith('footnote-') ? 10 : 18, textLength);
      },
    );

    const fragment = result.layout.pages[0]?.fragments.find((entry) => entry.blockId === noteTable.id);
    expect(fragment?.kind).toBe('table');
    expect(fragment && 'metadata' in fragment ? fragment.metadata?.columnBoundaries : undefined).toEqual([
      expect.objectContaining({ index: 0, width: 80 }),
      expect.objectContaining({ index: 1, width: 80 }),
    ]);
  });
});
