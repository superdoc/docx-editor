import { describe, expect, it } from 'vite-plus/test';
import type { FlowBlock, Measure, ParagraphMeasure } from '@superdoc/contracts';
import { buildFootnoteRanges, type FootnoteRange } from '../src/footnote-content';
import { planFootnotePage, type FootnotePagePlanInput } from '../src/footnote-page-planner';

type Note = {
  id: string;
  ranges: FootnoteRange[];
  measuresById: Map<string, Measure>;
  firstLineHeight: number;
};

const paragraphNote = (id: string, paragraphs: number[][], spacingAfter = 0): Note => {
  const blocks: FlowBlock[] = paragraphs.map((lineHeights, index) => ({
    kind: 'paragraph',
    id: `${id}-paragraph-${index}`,
    runs: [{ text: 'x'.repeat(lineHeights.length), fontFamily: 'Arial', fontSize: 10 }],
    attrs: { spacing: { after: spacingAfter } },
  }));
  const measuresById = new Map<string, Measure>(
    paragraphs.map((lineHeights, index) => [
      blocks[index].id,
      {
        kind: 'paragraph',
        lines: lineHeights.map((lineHeight, line) => ({
          fromRun: 0,
          fromChar: line,
          toRun: 0,
          toChar: line + 1,
          width: 100,
          ascent: lineHeight * 0.8,
          descent: lineHeight * 0.2,
          lineHeight,
        })),
        totalHeight: lineHeights.reduce((total, height) => total + height, 0),
      } satisfies ParagraphMeasure,
    ]),
  );
  return {
    id,
    ranges: buildFootnoteRanges(blocks, measuresById),
    measuresById,
    firstLineHeight: paragraphs[0][0],
  };
};

const pageInput = (notes: Note[], overrides: Partial<FootnotePagePlanInput> = {}): FootnotePagePlanInput => ({
  pageIndex: 0,
  columnCount: 1,
  availableHeight: 100,
  idsByColumn: new Map([[0, notes.map((note) => note.id)]]),
  rangesByFootnoteId: new Map(notes.map((note) => [note.id, note.ranges])),
  measuresById: new Map(notes.flatMap((note) => [...note.measuresById])),
  fullHeightById: new Map(
    notes.map((note) => [
      note.id,
      note.ranges.reduce(
        (total, range) => total + range.height + ('spacingAfter' in range ? range.spacingAfter : 0),
        0,
      ),
    ]),
  ),
  firstLineHeightById: new Map(notes.map((note) => [note.id, note.firstLineHeight])),
  pendingByColumn: new Map(),
  separatorSpacingBefore: 4,
  dividerHeight: 2,
  continuationDividerHeight: 2,
  topPadding: 3,
  gap: 2,
  ...overrides,
});

const paragraphRanges = (note: Note, fromLine: number, toLine: number): FootnoteRange[] => {
  const range = note.ranges[0];
  const measure = note.measuresById.get(range.blockId);
  if (range.kind !== 'paragraph' || measure?.kind !== 'paragraph') throw new Error('Expected a paragraph note');
  return [
    {
      ...range,
      fromLine,
      toLine,
      height: measure.lines.slice(fromLine, toLine).reduce((sum, line) => sum + line.lineHeight, 0),
    },
  ];
};

const lineTokens = (ranges: readonly FootnoteRange[]): string[] =>
  ranges.flatMap((range) =>
    range.kind === 'paragraph' || range.kind === 'list-item'
      ? Array.from(
          { length: range.toLine - range.fromLine },
          (_, index) => `${range.blockId}:${range.fromLine + index}`,
        )
      : [range.blockId],
  );

const drainPages = (input: FootnotePagePlanInput) => {
  const pages: ReturnType<typeof planFootnotePage>[] = [];
  let pendingByColumn = input.pendingByColumn;
  for (let offset = 0; offset < 12; offset += 1) {
    const page = planFootnotePage({
      ...input,
      pageIndex: input.pageIndex + offset,
      idsByColumn: offset === 0 ? input.idsByColumn : new Map(),
      pendingByColumn,
    });
    pages.push(page);
    pendingByColumn = page.pendingByColumn;
    if (pendingByColumn.size === 0) return pages;
  }
  throw new Error('Footnote continuation did not drain');
};

const freezeInput = (value: unknown): void => {
  if (value instanceof Map) {
    value.forEach((entry) => freezeInput(entry));
  } else if (value !== null && typeof value === 'object') {
    Object.values(value).forEach((entry) => freezeInput(entry));
  }
  if (value !== null && typeof value === 'object') Object.freeze(value);
};

class LookupOnlyMap<K, V> extends Map<K, V> {
  override entries(): MapIterator<[K, V]> {
    throw new Error('Page planning must not scan the document inventory');
  }
  override keys(): MapIterator<K> {
    throw new Error('Page planning must not scan the document inventory');
  }
  override values(): MapIterator<V> {
    throw new Error('Page planning must not scan the document inventory');
  }
  override [Symbol.iterator](): MapIterator<[K, V]> {
    throw new Error('Page planning must not scan the document inventory');
  }
  override forEach(): void {
    throw new Error('Page planning must not scan the document inventory');
  }
}

describe('footnote page placement', () => {
  const sut = planFootnotePage;

  it('places short anchors completely in reference order with one separator and inter-note gaps', () => {
    const first = paragraphNote('first', [[10, 10]]);
    const last = paragraphNote('last', [[12]]);

    const result = sut(pageInput([first, last], { pageIndex: 7 }));

    expect(result.slices).toEqual([
      { id: 'first', pageIndex: 7, columnIndex: 0, isContinuation: false, ranges: first.ranges, totalHeight: 20 },
      { id: 'last', pageIndex: 7, columnIndex: 0, isContinuation: false, ranges: last.ranges, totalHeight: 12 },
    ]);
    expect(result.reserve).toBe(43);
    expect(result.actualReserve).toBe(43);
    expect(result.pendingByColumn.size).toBe(0);
    expect(result.hasUnresolvedContent).toBe(false);
    expect(result.ledger).toEqual({
      anchorIds: ['first', 'last'],
      mandatorySliceIds: ['first', 'last'],
      continuationSliceIds: [],
      extendedSliceIds: [],
      continuationIn: [],
      continuationOut: [],
      mandatoryReservePx: 43,
      preferredReservePx: 43,
      actualBandHeightPx: 43,
      lastAnchorRenderedLines: 1,
    });
  });

  it('puts incoming continuation above complete non-last anchors and the first line of the last anchor', () => {
    const incoming = paragraphNote('incoming', [[10, 10, 10, 10]]);
    const first = paragraphNote('first', [[10, 10]]);
    const last = paragraphNote('last', [[10, 10, 10]]);
    const input = pageInput([incoming, first, last], {
      availableHeight: 73,
      idsByColumn: new Map([[0, ['first', 'last']]]),
      pendingByColumn: new Map([[0, [{ id: incoming.id, ranges: incoming.ranges }]]]),
    });

    const result = sut(input);

    expect(result.slices.map(({ id, isContinuation, totalHeight }) => ({ id, isContinuation, totalHeight }))).toEqual([
      { id: 'incoming', isContinuation: true, totalHeight: 30 },
      { id: 'first', isContinuation: false, totalHeight: 20 },
      { id: 'last', isContinuation: false, totalHeight: 10 },
    ]);
    expect(result.pendingByColumn.get(0)).toEqual([
      { id: 'incoming', ranges: paragraphRanges(incoming, 3, 4) },
      { id: 'last', ranges: paragraphRanges(last, 1, 3) },
    ]);
    expect(result.reserve).toBe(73);
    expect(result.overflowHeightPx).toBe(0);
    expect(result.hasContinuationByColumn).toEqual(new Map([[0, true]]));
    expect(result.ledger).toMatchObject({
      anchorIds: ['first', 'last'],
      mandatorySliceIds: ['first', 'last'],
      continuationSliceIds: ['incoming'],
      mandatoryReservePx: 83,
      preferredReservePx: 103,
      lastAnchorRenderedLines: 1,
      continuationOut: [
        { id: 'incoming', remainingRangeCount: 1, remainingHeightPx: 10 },
        { id: 'last', remainingRangeCount: 1, remainingHeightPx: 20 },
      ],
    });
  });

  it('keeps later pending continuations behind an unfinished continuation', () => {
    const first = paragraphNote('first', [[10, 10, 10, 10]]);
    const second = paragraphNote('second', [[10]]);
    const fresh = paragraphNote('fresh', [[10]]);
    const input = pageInput([first, second, fresh], {
      availableHeight: 41,
      idsByColumn: new Map([[0, [fresh.id]]]),
      pendingByColumn: new Map([
        [
          0,
          [
            { id: first.id, ranges: first.ranges },
            { id: second.id, ranges: second.ranges },
          ],
        ],
      ]),
    });

    const result = sut(input);

    expect(result.slices).toEqual([
      {
        id: first.id,
        pageIndex: 0,
        columnIndex: 0,
        isContinuation: true,
        ranges: paragraphRanges(first, 0, 2),
        totalHeight: 20,
      },
      {
        id: fresh.id,
        pageIndex: 0,
        columnIndex: 0,
        isContinuation: false,
        ranges: fresh.ranges,
        totalHeight: 10,
      },
    ]);
    expect(result.pendingByColumn.get(0)).toEqual([
      { id: first.id, ranges: paragraphRanges(first, 2, 4) },
      { id: second.id, ranges: second.ranges },
    ]);
    expect(result.overflowHeightPx).toBe(0);
  });

  it('defers a non-last anchor intact when only some of its lines fit', () => {
    const first = paragraphNote('first', [[10, 10, 10, 10]]);
    const last = paragraphNote('last', [[10]]);

    const result = sut(pageInput([first, last], { availableHeight: 39 }));

    expect(result.slices).toEqual([]);
    expect(result.pendingByColumn.get(0)).toEqual([
      { id: 'first', ranges: first.ranges },
      { id: 'last', ranges: last.ranges },
    ]);
    expect(result.reserve).toBe(0);
    expect(result.hasUnresolvedContent).toBe(true);
  });

  it('conserves every ordered range line exactly once across repeated page steps', () => {
    const note = paragraphNote('long', [
      [7, 11, 13],
      [5, 17],
      [9, 10],
    ]);

    const pages = drainPages(pageInput([note], { availableHeight: 43 }));

    expect(pages).toHaveLength(3);
    expect(pages.flatMap((page) => page.slices.flatMap((slice) => lineTokens(slice.ranges)))).toEqual(
      lineTokens(note.ranges),
    );
    expect(pages.map((page) => page.overflowHeightPx)).toEqual([0, 0, 0]);
    expect(pages.map((page) => page.slices[0].isContinuation)).toEqual([false, true, true]);
    expect(pages[2].pendingByColumn.size).toBe(0);
    expect(pages[2].hasUnresolvedContent).toBe(false);
  });

  it('depends only on this page and exact incoming ranges, not unrelated document inventories', () => {
    const note = paragraphNote('current', [[10, 10, 10]]);
    const fresh = paragraphNote('fresh', [[10, 10]]);
    const tail = paragraphNote('unrelated-tail', [[100, 200, 300]]);
    const input = pageInput([note, fresh], {
      availableHeight: 51,
      idsByColumn: new Map([[0, [fresh.id]]]),
      pendingByColumn: new Map([[0, [{ id: note.id, ranges: note.ranges }]]]),
    });
    const extended = { ...input };
    extended.rangesByFootnoteId = new LookupOnlyMap([
      [note.id, note.ranges],
      [fresh.id, fresh.ranges],
      [tail.id, tail.ranges],
    ]);
    extended.measuresById = new LookupOnlyMap([...note.measuresById, ...fresh.measuresById, ...tail.measuresById]);
    extended.fullHeightById = new LookupOnlyMap([
      [note.id, 30],
      [fresh.id, 20],
      [tail.id, 600],
    ]);
    extended.firstLineHeightById = new LookupOnlyMap([
      [note.id, 10],
      [fresh.id, 10],
      [tail.id, 100],
    ]);

    const [withoutTail, withTail] = [input, extended].map(sut);

    expect(withTail).toEqual(withoutTail);
    expect(withTail.pendingByColumn.get(0)).toEqual([{ id: fresh.id, ranges: paragraphRanges(fresh, 1, 2) }]);
  });

  it('retains exact identity and line ranges for equal-height incoming continuations', () => {
    const first = paragraphNote('first', [[10, 10, 10, 10]]);
    const second = paragraphNote('second', [[10, 10]]);
    const input = pageInput([first, second], { idsByColumn: new Map(), availableHeight: 19 });
    const variants = [
      new Map([[0, [{ id: first.id, ranges: paragraphRanges(first, 2, 4) }]]]),
      new Map([[0, [{ id: second.id, ranges: paragraphRanges(second, 0, 2) }]]]),
    ];

    const results = variants.map((pendingByColumn) => sut({ ...input, pendingByColumn }));

    expect(results.map((page) => page.reserve)).toEqual([19, 19]);
    expect(results.map((page) => page.slices.map(({ id, ranges }) => ({ id, ranges })))).toEqual([
      [{ id: first.id, ranges: paragraphRanges(first, 2, 3) }],
      [{ id: second.id, ranges: paragraphRanges(second, 0, 1) }],
    ]);
    expect(results.map((page) => page.pendingByColumn.get(0))).toEqual([
      [{ id: first.id, ranges: paragraphRanges(first, 3, 4) }],
      [{ id: second.id, ranges: paragraphRanges(second, 1, 2) }],
    ]);
  });

  it('does not mutate any incoming queue, range, measure, or reference list', () => {
    const incoming = paragraphNote('incoming', [[10, 10, 10]]);
    const fresh = paragraphNote('fresh', [[10, 10]]);
    const input = pageInput([incoming, fresh], {
      availableHeight: 41,
      idsByColumn: new Map([[0, [fresh.id]]]),
      pendingByColumn: new Map([[0, [{ id: incoming.id, ranges: incoming.ranges }]]]),
    });
    const before = structuredClone(input);
    freezeInput(input);

    const result = sut(input);

    expect(input).toEqual(before);
    expect(result.pendingByColumn).not.toBe(input.pendingByColumn);
    expect(result.pendingByColumn.get(0)).not.toBe(input.pendingByColumn.get(0));
    expect(result.slices).toHaveLength(2);
  });

  it.each([2, 3])('keeps incoming queues in their original columns when the page has %i columns', (columnCount) => {
    const first = paragraphNote('first', [[10, 10, 10]]);
    const second = paragraphNote('second', [[10, 10]]);
    const input = pageInput([first, second], {
      columnCount,
      availableHeight: 19,
      idsByColumn: new Map(),
      pendingByColumn: new Map([
        [0, [{ id: first.id, ranges: first.ranges }]],
        [1, [{ id: second.id, ranges: second.ranges }]],
      ]),
    });

    const result = sut(input);

    expect(result.slices.map(({ id, columnIndex }) => ({ id, columnIndex }))).toEqual([
      { id: first.id, columnIndex: 0 },
      { id: second.id, columnIndex: 1 },
    ]);
    expect(result.pendingByColumn).toEqual(
      new Map([
        [0, [{ id: first.id, ranges: paragraphRanges(first, 1, 3) }]],
        [1, [{ id: second.id, ranges: paragraphRanges(second, 1, 2) }]],
      ]),
    );
    expect(result.actualReserve).toBe(19);
    expect(result.overflowHeightPx).toBe(0);
    expect(result.overflowHeightByColumn.size).toBe(0);
    expect(result.ledger.actualBandHeightPx).toBe(31);
  });

  it('remaps only unavailable incoming columns to the last explicit page column', () => {
    const first = paragraphNote('first', [[10]]);
    const second = paragraphNote('second', [[10]]);
    const third = paragraphNote('third', [[10]]);
    const input = pageInput([first, second, third], {
      columnCount: 2,
      availableHeight: 0,
      idsByColumn: new Map(),
      pendingByColumn: new Map([
        [0, [{ id: first.id, ranges: first.ranges }]],
        [1, [{ id: second.id, ranges: second.ranges }]],
        [2, [{ id: third.id, ranges: third.ranges }]],
      ]),
    });

    const result = sut(input);

    expect(result.pendingByColumn).toEqual(
      new Map([
        [0, [{ id: first.id, ranges: first.ranges }]],
        [
          1,
          [
            { id: second.id, ranges: second.ranges },
            { id: third.id, ranges: third.ranges },
          ],
        ],
      ]),
    );
    expect(result.slices).toEqual([]);
    expect(result.hasUnresolvedContent).toBe(true);
  });

  it('reports physical overflow when force-first places an oversized atomic range', () => {
    const note: Note = {
      id: 'atomic',
      ranges: [{ kind: 'image', blockId: 'atomic-image', height: 75 }],
      measuresById: new Map(),
      firstLineHeight: 75,
    };

    const result = sut(pageInput([note], { availableHeight: 40 }));

    expect(result.slices[0].ranges).toEqual(note.ranges);
    expect(result.pendingByColumn.size).toBe(0);
    expect(result.actualReserve).toBe(84);
    expect(result.reserve).toBe(40);
    expect(result.capped).toBe(true);
    expect(result.overflowHeightPx).toBe(44);
    expect(result.overflowHeightByColumn).toEqual(new Map([[0, 44]]));
    expect(result.hasUnresolvedContent).toBe(true);
  });

  it('returns all unresolved ranges without forced placement when the page has zero note capacity', () => {
    const incoming = paragraphNote('incoming', [[10, 10]]);
    const fresh = paragraphNote('fresh', [[12]]);
    const input = pageInput([incoming, fresh], {
      availableHeight: 0,
      idsByColumn: new Map([[0, [fresh.id]]]),
      pendingByColumn: new Map([[0, [{ id: incoming.id, ranges: incoming.ranges }]]]),
    });

    const result = sut(input);

    expect(result.slices).toEqual([]);
    expect(result.pendingByColumn.get(0)).toEqual([
      { id: incoming.id, ranges: incoming.ranges },
      { id: fresh.id, ranges: fresh.ranges },
    ]);
    expect(result.reserve).toBe(0);
    expect(result.overflowHeightPx).toBe(0);
    expect(result.hasUnresolvedContent).toBe(true);
  });

  it('keeps paragraph trailing spacing out of an exactly fitting final slice', () => {
    const note = paragraphNote('spaced', [[10, 10]], 7);

    const result = sut(pageInput([note], { availableHeight: 29 }));

    expect(result.slices[0].totalHeight).toBe(20);
    expect(result.slices[0].ranges).toEqual(note.ranges);
    expect(result.pendingByColumn.size).toBe(0);
    expect(result.reserve).toBe(29);
    expect(result.overflowHeightPx).toBe(0);
  });

  it('does not charge trailing paragraph spacing to a partial continuation range', () => {
    const note = paragraphNote('spaced-continuation', [[10, 10]], 7);
    const partial = paragraphRanges(note, 0, 1);

    const result = sut(
      pageInput([note], {
        availableHeight: 0,
        idsByColumn: new Map(),
        pendingByColumn: new Map([[0, [{ id: note.id, ranges: partial }]]]),
      }),
    );

    expect(result.ledger.continuationIn).toEqual([{ id: note.id, remainingRangeCount: 1, remainingHeightPx: 10 }]);
    expect(result.ledger.continuationOut).toEqual([{ id: note.id, remainingRangeCount: 1, remainingHeightPx: 10 }]);
    expect(result.ledger.mandatoryReservePx).toBe(19);
    expect(result.ledger.preferredReservePx).toBe(19);
  });
});
