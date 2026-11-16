import { describe, expect, it } from 'vite-plus/test';
import type { Layout, ListBlock, ParagraphBlock, TableBlock, TableMeasure } from './index.js';
import { buildPageRefAnchorMap } from './page-ref-anchor.js';
import { PARTIAL_ROW_RENDERS_TO_CELL_END } from './partial-row.js';

describe('buildPageRefAnchorMap', () => {
  it('returns display page information for fragment PM ranges', () => {
    const layout: Layout = {
      pageSize: { w: 800, h: 1000 },
      pages: [
        {
          number: 4,
          displayNumber: 2,
          numberText: 'ii',
          pageNumberFormat: 'lowerRoman',
          pageNumberChapterText: 'A',
          pageNumberChapterSeparator: 'colon',
          sectionIndex: 1,
          fragments: [
            { kind: 'para', blockId: 'p1', fromLine: 0, toLine: 1, x: 0, y: 0, width: 100, pmStart: 10, pmEnd: 20 },
          ],
        },
      ],
    };

    const result = buildPageRefAnchorMap(new Map([['target', 12]]), layout);

    expect(result.get('target')).toMatchObject({
      physicalPage: 4,
      displayNumber: 2,
      displayText: 'ii',
      pageFormat: 'lowerRoman',
      chapterNumberText: 'A',
      chapterSeparator: 'colon',
      sectionIndex: 1,
      pmPosition: 12,
    });
  });

  it('resolves targets inside table fragments with PM ranges', () => {
    const layout: Layout = {
      pageSize: { w: 800, h: 1000 },
      pages: [
        {
          number: 2,
          fragments: [
            {
              kind: 'table',
              blockId: 't1',
              fromRow: 0,
              toRow: 1,
              x: 0,
              y: 0,
              width: 100,
              height: 20,
              pmStart: 30,
              pmEnd: 60,
            } as any,
          ],
        },
      ],
    };

    expect(buildPageRefAnchorMap(new Map([['inTable', 45]]), layout).get('inTable')?.physicalPage).toBe(2);
  });

  it('falls back to paragraph block run ranges when fragment PM data is missing', () => {
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'p1',
      runs: [{ text: 'Target', fontFamily: 'Arial', fontSize: 12, pmStart: 100, pmEnd: 106 }],
    };
    const layout: Layout = {
      pageSize: { w: 800, h: 1000 },
      pages: [
        {
          number: 3,
          fragments: [{ kind: 'para', blockId: 'p1', fromLine: 0, toLine: 1, x: 0, y: 0, width: 100 }],
        },
      ],
    };

    expect(buildPageRefAnchorMap(new Map([['target', 103]]), layout, [block]).get('target')?.physicalPage).toBe(3);
  });

  it('maps leading bookmark markers to the next visible fragment', () => {
    const layout: Layout = {
      pageSize: { w: 800, h: 1000 },
      pages: [
        {
          number: 2,
          displayNumber: 2,
          numberText: '2',
          fragments: [
            {
              kind: 'para',
              blockId: 'target',
              fromLine: 0,
              toLine: 1,
              x: 0,
              y: 0,
              width: 100,
              pmStart: 1377,
              pmEnd: 1400,
            },
          ],
        },
      ],
    };

    expect(buildPageRefAnchorMap(new Map([['target', 1374]]), layout).get('target')).toMatchObject({
      physicalPage: 2,
      displayNumber: 2,
      displayText: '2',
      pmPosition: 1374,
    });
  });

  it('omits bookmarks in gaps between visible fragments', () => {
    const layout: Layout = {
      pageSize: { w: 800, h: 1000 },
      pages: [
        {
          number: 1,
          fragments: [
            { kind: 'para', blockId: 'before', fromLine: 0, toLine: 1, x: 0, y: 0, width: 100, pmStart: 10, pmEnd: 20 },
          ],
        },
        {
          number: 2,
          fragments: [
            { kind: 'para', blockId: 'after', fromLine: 0, toLine: 1, x: 0, y: 0, width: 100, pmStart: 30, pmEnd: 40 },
          ],
        },
      ],
    };

    expect(buildPageRefAnchorMap(new Map([['gap', 25]]), layout).has('gap')).toBe(false);
  });

  it('maps bookmark markers immediately before a later visible fragment', () => {
    const layout: Layout = {
      pageSize: { w: 800, h: 1000 },
      pages: [
        {
          number: 1,
          fragments: [
            { kind: 'para', blockId: 'before', fromLine: 0, toLine: 1, x: 0, y: 0, width: 100, pmStart: 10, pmEnd: 20 },
          ],
        },
        {
          number: 2,
          fragments: [
            { kind: 'para', blockId: 'target', fromLine: 0, toLine: 1, x: 0, y: 0, width: 100, pmStart: 32, pmEnd: 40 },
          ],
        },
      ],
    };

    expect(buildPageRefAnchorMap(new Map([['target', 30]]), layout).get('target')?.physicalPage).toBe(2);
  });

  it('falls back to visible paragraph ranges inside table blocks', () => {
    const table: TableBlock = {
      kind: 'table',
      id: 't1',
      rows: [
        {
          id: 'r1',
          cells: [
            {
              id: 'c1',
              paragraph: {
                kind: 'paragraph',
                id: 'p1',
                runs: [{ text: 'Cell', fontFamily: 'Arial', fontSize: 12, pmStart: 200, pmEnd: 204 }],
              },
            },
          ],
        },
      ],
    };
    const layout: Layout = {
      pageSize: { w: 800, h: 1000 },
      pages: [
        {
          number: 5,
          fragments: [{ kind: 'table', blockId: 't1', fromRow: 0, toRow: 1, x: 0, y: 0, width: 100, height: 20 }],
        },
      ],
    };

    expect(buildPageRefAnchorMap(new Map([['cellTarget', 202]]), layout, [table]).get('cellTarget')?.physicalPage).toBe(
      5,
    );
  });

  it('limits table fallback ranges to the rows covered by each table fragment', () => {
    const table: TableBlock = {
      kind: 'table',
      id: 't1',
      rows: [
        {
          id: 'r1',
          cells: [
            {
              id: 'c1',
              paragraph: {
                kind: 'paragraph',
                id: 'p1',
                runs: [{ text: 'First row', fontFamily: 'Arial', fontSize: 12, pmStart: 100, pmEnd: 109 }],
              },
            },
          ],
        },
        {
          id: 'r2',
          cells: [
            {
              id: 'c2',
              paragraph: {
                kind: 'paragraph',
                id: 'p2',
                runs: [{ text: 'Second row', fontFamily: 'Arial', fontSize: 12, pmStart: 200, pmEnd: 210 }],
              },
            },
          ],
        },
      ],
    };
    const layout: Layout = {
      pageSize: { w: 800, h: 1000 },
      pages: [
        {
          number: 1,
          fragments: [{ kind: 'table', blockId: 't1', fromRow: 0, toRow: 1, x: 0, y: 0, width: 100, height: 20 }],
        },
        {
          number: 2,
          fragments: [{ kind: 'table', blockId: 't1', fromRow: 1, toRow: 2, x: 0, y: 0, width: 100, height: 20 }],
        },
      ],
    };

    expect(buildPageRefAnchorMap(new Map([['secondRow', 205]]), layout, [table]).get('secondRow')?.physicalPage).toBe(
      2,
    );
  });

  it('limits split-row table fallback ranges to visible partial row lines', () => {
    const table: TableBlock = {
      kind: 'table',
      id: 't1',
      rows: [
        {
          id: 'r1',
          cells: [
            {
              id: 'c1',
              paragraph: {
                kind: 'paragraph',
                id: 'p1',
                runs: [
                  { text: 'First line', fontFamily: 'Arial', fontSize: 12, pmStart: 100, pmEnd: 110 },
                  { text: 'Second line', fontFamily: 'Arial', fontSize: 12, pmStart: 111, pmEnd: 122 },
                ],
              },
            },
          ],
        },
      ],
    };
    const measure: TableMeasure = {
      kind: 'table',
      rows: [
        {
          height: 40,
          cells: [
            {
              width: 100,
              height: 40,
              paragraph: {
                kind: 'paragraph',
                totalHeight: 40,
                lines: [
                  { fromRun: 0, fromChar: 0, toRun: 0, toChar: 10, width: 60, ascent: 8, descent: 2, lineHeight: 20 },
                  { fromRun: 1, fromChar: 0, toRun: 1, toChar: 11, width: 70, ascent: 8, descent: 2, lineHeight: 20 },
                ],
              },
            },
          ],
        },
      ],
      totalHeight: 40,
      columnWidths: [100],
    };
    const layout: Layout = {
      pageSize: { w: 800, h: 1000 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'table',
              blockId: 't1',
              fromRow: 0,
              toRow: 1,
              x: 0,
              y: 0,
              width: 100,
              height: 20,
              partialRow: {
                rowIndex: 0,
                fromLineByCell: [0],
                toLineByCell: [1],
                isFirstPart: true,
                isLastPart: false,
                partialHeight: 20,
              },
            },
          ],
        },
        {
          number: 2,
          fragments: [
            {
              kind: 'table',
              blockId: 't1',
              fromRow: 0,
              toRow: 1,
              x: 0,
              y: 0,
              width: 100,
              height: 20,
              partialRow: {
                rowIndex: 0,
                fromLineByCell: [1],
                toLineByCell: [2],
                isFirstPart: false,
                isLastPart: true,
                partialHeight: 20,
              },
            },
          ],
        },
      ],
    };

    expect(
      buildPageRefAnchorMap(new Map([['secondLine', 115]]), layout, [table], [measure]).get('secondLine')?.physicalPage,
    ).toBe(2);
  });

  it('anchors a split-row target through the end of the cell when toLineByCell is PARTIAL_ROW_RENDERS_TO_CELL_END', () => {
    const table: TableBlock = {
      kind: 'table',
      id: 't1',
      rows: [
        {
          id: 'r1',
          cells: [
            {
              id: 'c1',
              paragraph: {
                kind: 'paragraph',
                id: 'p1',
                runs: [
                  { text: 'First line', fontFamily: 'Arial', fontSize: 12, pmStart: 100, pmEnd: 110 },
                  { text: 'Second line', fontFamily: 'Arial', fontSize: 12, pmStart: 111, pmEnd: 122 },
                ],
              },
            },
          ],
        },
      ],
    };
    const measure: TableMeasure = {
      kind: 'table',
      rows: [
        {
          height: 40,
          cells: [
            {
              width: 100,
              height: 40,
              paragraph: {
                kind: 'paragraph',
                totalHeight: 40,
                lines: [
                  { fromRun: 0, fromChar: 0, toRun: 0, toChar: 10, width: 60, ascent: 8, descent: 2, lineHeight: 20 },
                  { fromRun: 1, fromChar: 0, toRun: 1, toChar: 11, width: 70, ascent: 8, descent: 2, lineHeight: 20 },
                ],
              },
            },
          ],
        },
      ],
      totalHeight: 40,
      columnWidths: [100],
    };
    const layout: Layout = {
      pageSize: { w: 800, h: 1000 },
      pages: [
        {
          number: 3,
          fragments: [
            {
              kind: 'table',
              blockId: 't1',
              fromRow: 0,
              toRow: 1,
              x: 0,
              y: 0,
              width: 100,
              height: 40,
              partialRow: {
                rowIndex: 0,
                fromLineByCell: [0],
                toLineByCell: [PARTIAL_ROW_RENDERS_TO_CELL_END],
                isFirstPart: true,
                isLastPart: true,
                partialHeight: 40,
              },
            },
          ],
        },
      ],
    };

    expect(
      buildPageRefAnchorMap(new Map([['secondLine', 115]]), layout, [table], [measure]).get('secondLine')?.physicalPage,
    ).toBe(3);
  });

  it('falls back to list item paragraph ranges when fragment PM data is missing', () => {
    const list: ListBlock = {
      kind: 'list',
      id: 'list1',
      listType: 'number',
      items: [
        {
          id: 'li1',
          marker: { kind: 'number', text: '1.', level: 0 },
          paragraph: {
            kind: 'paragraph',
            id: 'p1',
            runs: [{ text: 'Heading', fontFamily: 'Arial', fontSize: 12, pmStart: 300, pmEnd: 307 }],
          },
        },
      ],
    };
    const layout: Layout = {
      pageSize: { w: 800, h: 1000 },
      pages: [
        {
          number: 6,
          fragments: [
            {
              kind: 'list-item',
              blockId: 'list1',
              itemId: 'li1',
              fromLine: 0,
              toLine: 1,
              x: 0,
              y: 0,
              width: 100,
              markerWidth: 20,
            },
          ],
        },
      ],
    };

    expect(buildPageRefAnchorMap(new Map([['listTarget', 303]]), layout, [list]).get('listTarget')?.physicalPage).toBe(
      6,
    );
  });

  it('omits bookmarks not found in any fragment', () => {
    const layout: Layout = {
      pageSize: { w: 800, h: 1000 },
      pages: [{ number: 1, fragments: [] }],
    };

    expect(buildPageRefAnchorMap(new Map([['missing', 1]]), layout).has('missing')).toBe(false);
  });

  it('batches thousands of marker-leading bookmarks while preserving caller order', () => {
    const fragmentCount = 4_096;
    const fragmentsPerPage = 32;
    const pages: Layout['pages'] = [];
    for (let pageIndex = 0; pageIndex < fragmentCount / fragmentsPerPage; pageIndex += 1) {
      pages.push({
        number: pageIndex + 1,
        fragments: Array.from({ length: fragmentsPerPage }, (_, offset) => {
          const fragmentIndex = pageIndex * fragmentsPerPage + offset;
          const pmStart = fragmentIndex * 10 + 3;
          return {
            kind: 'para' as const,
            blockId: `p${fragmentIndex}`,
            fromLine: 0,
            toLine: 1,
            x: 0,
            y: offset * 20,
            width: 100,
            pmStart,
            pmEnd: pmStart + 5,
          };
        }),
      });
    }
    const bookmarks = new Map<string, number>();
    for (let fragmentIndex = fragmentCount - 1; fragmentIndex >= 0; fragmentIndex -= 1) {
      bookmarks.set(`b${fragmentIndex}`, fragmentIndex * 10 + 1);
    }

    const result = buildPageRefAnchorMap(bookmarks, { pageSize: { w: 800, h: 1000 }, pages });

    expect(result.size).toBe(fragmentCount);
    expect([...result.keys()].slice(0, 3)).toEqual(['b4095', 'b4094', 'b4093']);
    expect(result.get('b0')?.physicalPage).toBe(1);
    expect(result.get('b4095')?.physicalPage).toBe(128);
  });
});
