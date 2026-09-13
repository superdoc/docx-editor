import { describe, expect, it } from 'vite-plus/test';
import type { Measure, Page, ParagraphBlock, ParagraphMeasure } from '@superdoc/contracts';
import { buildFootnoteRanges, type FootnoteRange } from '../src/footnote-content';
import {
  CoupledFootnotePaginationError,
  createCoupledFootnotePagination,
  validateCoupledFootnoteReferenceConservation,
  type CoupledFootnotePagination,
  type CoupledFootnotePaginationOptions,
} from '../src/coupled-footnote-pagination';

type Note = { id: string; ranges: FootnoteRange[]; measure: ParagraphMeasure; blockId: string };

const note = (id: string, heights: number[], spacingAfter = 0): Note => {
  const block: ParagraphBlock = {
    id: `note-${id}`,
    kind: 'paragraph',
    runs: [{ text: 'x'.repeat(heights.length), fontFamily: 'Arial', fontSize: 10 }],
    attrs: { spacing: { after: spacingAfter } },
  };
  const measure: ParagraphMeasure = {
    kind: 'paragraph',
    lines: heights.map((lineHeight, index) => ({
      fromRun: 0,
      fromChar: index,
      toRun: 0,
      toChar: index + 1,
      width: 100,
      ascent: lineHeight * 0.8,
      descent: lineHeight * 0.2,
      lineHeight,
    })),
    totalHeight: heights.reduce((total, height) => total + height, 0),
  };
  return { id, blockId: block.id, measure, ranges: buildFootnoteRanges([block], new Map([[block.id, measure]])) };
};

const options = (
  notes: Note[],
  overrides: Partial<CoupledFootnotePaginationOptions> = {},
): CoupledFootnotePaginationOptions => ({
  pageSize: { w: 600, h: 800 },
  rangesByFootnoteId: new Map(notes.map((entry) => [entry.id, entry.ranges])),
  measuresById: new Map<string, Measure>(notes.map((entry) => [entry.blockId, entry.measure])),
  fullHeightById: new Map(
    notes.map((entry) => [
      entry.id,
      entry.ranges.reduce(
        (height, range) => height + range.height + ('spacingAfter' in range ? range.spacingAfter : 0),
        0,
      ),
    ]),
  ),
  firstLineHeightById: new Map(notes.map((entry) => [entry.id, entry.measure.lines[0].lineHeight])),
  separatorSpacingBefore: 4,
  dividerHeight: 2,
  continuationDividerHeight: 2,
  topPadding: 3,
  gap: 2,
  ...overrides,
});

const boundary = (pageIndex: number, ids: string[], capacity = 100, pageOverrides: Partial<Page> = {}) => ({
  page: {
    number: pageIndex + 1,
    fragments: [],
    size: { w: 600, h: 800 },
    margins: { top: 20, right: 20, bottom: 20, left: 20 },
    ...pageOverrides,
  } as Page,
  pageIndex,
  bodyBottom: 780 - capacity,
  physicalBottom: 780,
  anchors: ids.map((refId) => ({ refId })),
});

const tokens = (ranges: readonly FootnoteRange[]): string[] =>
  ranges.flatMap((range) =>
    range.kind === 'paragraph' || range.kind === 'list-item'
      ? Array.from(
          { length: range.toLine - range.fromLine },
          (_, index) => `${range.blockId}:${range.fromLine + index}`,
        )
      : [range.blockId],
  );

const drainAtEof = (sut: CoupledFootnotePagination, id: string): Page[] => {
  const first = boundary(0, [id], 29);
  sut.flow.completePage(first);
  const pages = [first.page];
  while (sut.flow.hasPendingContinuation()) {
    if (pages.length >= 10) throw new Error('Continuation failed to drain');
    const next = boundary(pages.length, [], 760);
    sut.flow.completePage(next);
    pages.push(next.page);
  }
  return pages;
};

class CountedInventory<K, V> extends Map<K, V> {
  reads = 0;
  override get(key: K): V | undefined {
    this.reads += 1;
    return super.get(key);
  }
  override entries(): MapIterator<[K, V]> {
    throw new Error('Unexpected global inventory scan');
  }
  override keys(): MapIterator<K> {
    throw new Error('Unexpected global inventory scan');
  }
  override values(): MapIterator<V> {
    throw new Error('Unexpected global inventory scan');
  }
  override [Symbol.iterator](): MapIterator<[K, V]> {
    throw new Error('Unexpected global inventory scan');
  }
  override forEach(): void {
    throw new Error('Unexpected global inventory scan');
  }
}

const countedOptions = (tailCount: number) => {
  const current = note('current', [10, 10, 10]);
  const tails = Array.from({ length: tailCount }, (_, index) => note(`tail-${index}`, [10, 10]));
  const prepared = options([current, ...tails]);
  const ranges = new CountedInventory(prepared.rangesByFootnoteId);
  const measures = new CountedInventory(prepared.measuresById);
  const full = new CountedInventory(prepared.fullHeightById);
  const first = new CountedInventory(prepared.firstLineHeightById);
  return {
    prepared: {
      ...prepared,
      rangesByFootnoteId: ranges,
      measuresById: measures,
      fullHeightById: full,
      firstLineHeightById: first,
    },
    reads: () => ranges.reads + measures.reads + full.reads + first.reads,
  };
};

const runCountedPage = (tailCount: number) => {
  const counted = countedOptions(tailCount);
  const sut = createCoupledFootnotePagination(counted.prepared);
  sut.flow.completePage(boundary(0, ['current'], 29));
  return { plan: sut.plan, reads: counted.reads() };
};

const remainingRange = (content: Note, fromLine: number, toLine: number): FootnoteRange => {
  const range = content.ranges[0];
  if (range.kind !== 'paragraph') throw new Error('Expected paragraph content');
  return {
    ...range,
    fromLine,
    toLine,
    height: content.measure.lines.slice(fromLine, toLine).reduce((height, line) => height + line.lineHeight, 0),
  };
};

const seededWindow = (content: Note, fromLine: number, toLine: number) =>
  createCoupledFootnotePagination(
    options([content], {
      start: {
        pageIndex: 7,
        pendingByColumn: new Map([[0, [{ id: content.id, ranges: [remainingRange(content, fromLine, toLine)] }]]]),
        isPreviouslyAnchored: (id) => id === content.id,
      },
    }),
  );

describe('coupled footnote page sequence', () => {
  it('admits a page with exact anchored content and normalizes its physical bottom', () => {
    const content = note('one', [10, 10]);
    const sut = createCoupledFootnotePagination(options([content]));
    const completed = boundary(0, ['one']);

    sut.flow.completePage(completed);

    expect(completed.page.footnoteReserved).toBe(29);
    expect(completed.page.margins).toEqual({ top: 20, right: 20, bottom: 49, left: 20 });
    expect(completed.page).toHaveProperty('bodyMaxY', 680);
    expect(sut.plan.slicesByPage.get(0)?.[0].ranges).toEqual(content.ranges);
    expect(sut.plan.reserves).toEqual([29]);
    expect(sut.plan.ledgersByPage.get(0)?.anchorIds).toEqual(['one']);
    expect(sut.flow.incomingDemand(1)).toEqual({ height: 0, refs: 0 });
    expect(sut.flow.hasPendingContinuation()).toBe(false);
  });

  it('uses prepared page size when the engine omits default page geometry', () => {
    const sut = createCoupledFootnotePagination(options([note('one', [10])]));
    const completed = boundary(0, ['one'], 100, { size: undefined });

    sut.flow.completePage(completed);

    expect(completed.page.footnoteReserved).toBe(19);
    expect(completed.page.margins?.bottom).toBe(39);
  });

  it('drains exact continuation ranges into note-only pages after body EOF', () => {
    const content = note(
      'long',
      Array.from({ length: 200 }, () => 10),
    );
    const sut = createCoupledFootnotePagination(options([content]));

    const pages = drainAtEof(sut, content.id);

    expect(pages).toHaveLength(4);
    expect(
      [...sut.plan.slicesByPage.values()].flatMap((slices) => slices.flatMap((slice) => tokens(slice.ranges))),
    ).toEqual(tokens(content.ranges));
    expect(sut.plan.reserves).toEqual([29, 759, 759, 489]);
    expect(sut.plan.hasContinuationByColumn).toEqual(
      new Map([
        ['1:0', true],
        ['2:0', true],
        ['3:0', true],
      ]),
    );
    expect(sut.plan.ledgersByPage.get(3)?.continuationOut).toEqual([]);
    expect(sut.flow.incomingDemand(4)).toEqual({ height: 0, refs: 0 });
    expect(sut.flow.hasPendingContinuation()).toBe(false);
  });

  it('preserves incoming-first order and the new cluster ordered minimum across page boundaries', () => {
    const incoming = note('incoming', [10, 10, 10, 10]);
    const first = note('first', [10, 10]);
    const last = note('last', [10, 10, 10]);
    const sut = createCoupledFootnotePagination(options([incoming, first, last]));
    sut.flow.completePage(boundary(0, [incoming.id], 29));

    sut.flow.completePage(boundary(1, [first.id, last.id], 53));

    expect(
      sut.plan.slicesByPage.get(1)?.map(({ id, isContinuation, totalHeight }) => ({ id, isContinuation, totalHeight })),
    ).toEqual([
      { id: 'incoming', isContinuation: true, totalHeight: 10 },
      { id: 'first', isContinuation: false, totalHeight: 20 },
      { id: 'last', isContinuation: false, totalHeight: 10 },
    ]);
    expect(sut.flow.incomingDemand(2)).toEqual({ height: 30, refs: 2 });
    expect(sut.plan.ledgersByPage.get(1)?.lastAnchorRenderedLines).toBe(1);
  });

  it('returns only remaining content height and reference count, without separator or gaps', () => {
    const sut = createCoupledFootnotePagination(options([note('spaced', [10, 10, 10], 4)]));
    sut.flow.completePage(boundary(0, ['spaced'], 29));

    const demand = sut.flow.incomingDemand(1);

    expect(demand).toEqual({ height: 14, refs: 1 });
  });

  it('does identical bounded inventory work when an unrelated document tail is added', () => {
    const [small, large] = [0, 2000].map(runCountedPage);

    expect(large).toEqual(small);
    expect(small.reads).toBeLessThan(40);
  });

  it('serves repeated incoming-demand checks without re-reading any note inventory', () => {
    const counted = countedOptions(10);
    const sut = createCoupledFootnotePagination(counted.prepared);
    sut.flow.completePage(boundary(0, ['current'], 29));
    const readsBefore = counted.reads();

    const demands = Array.from({ length: 100 }, () => sut.flow.incomingDemand(1));

    expect(demands).toEqual(Array.from({ length: 100 }, () => ({ height: 10, refs: 1 })));
    expect(counted.reads()).toBe(readsBefore);
  });

  it('rejects a missing anchor without admitting the page or consuming sequence state', () => {
    const sut = createCoupledFootnotePagination(options([]));
    const completed = boundary(0, ['missing']);
    const pageBefore = structuredClone(completed.page);

    expect(() => sut.flow.completePage(completed)).toThrow(
      expect.objectContaining({ code: 'missing-anchor', pageIndex: 0 }),
    );

    expect(completed.page).toEqual(pageBefore);
    expect(sut.plan.reserves).toEqual([]);
    expect(sut.plan.slicesByPage.size).toBe(0);
    expect(sut.flow.incomingDemand(0)).toEqual({ height: 0, refs: 0 });
  });

  it('rejects source content that no longer has a matching paragraph measurement', () => {
    const prepared = options([note('one', [10])], { measuresById: new Map() });
    const sut = createCoupledFootnotePagination(prepared);

    expect(() => sut.flow.completePage(boundary(0, ['one']))).toThrow(
      expect.objectContaining({ code: 'missing-anchor' }),
    );

    expect(sut.plan.reserves).toEqual([]);
  });

  it('rejects duplicate fresh claims within one page', () => {
    const sut = createCoupledFootnotePagination(options([note('one', [10])]));

    expect(() => sut.flow.completePage(boundary(0, ['one', 'one']))).toThrow(
      expect.objectContaining({ code: 'duplicate-claim' }),
    );

    expect(sut.plan.reserves).toEqual([]);
  });

  it('rejects a second anchor claim for content already owned by an earlier page', () => {
    const sut = createCoupledFootnotePagination(options([note('one', [10, 10, 10])]));
    sut.flow.completePage(boundary(0, ['one'], 29));

    expect(() => sut.flow.completePage(boundary(1, ['one']))).toThrow(
      expect.objectContaining({ code: 'duplicate-claim' }),
    );

    expect(sut.plan.reserves).toEqual([29]);
    expect(sut.flow.incomingDemand(1)).toEqual({ height: 10, refs: 1 });
  });

  it('rejects distinct footnote ids that claim the same source block', () => {
    const first = note('first', [10]);
    const second = { ...first, id: 'second' };
    const sut = createCoupledFootnotePagination(options([first, second]));

    expect(() => sut.flow.completePage(boundary(0, ['first', 'second']))).toThrow(
      expect.objectContaining({ code: 'duplicate-claim' }),
    );

    expect(sut.plan.reserves).toEqual([]);
  });

  it('rejects a page that would defer a non-last new anchor instead of placing it completely', () => {
    const sut = createCoupledFootnotePagination(options([note('first', [10, 10, 10, 10]), note('last', [10])]));

    expect(() => sut.flow.completePage(boundary(0, ['first', 'last'], 39))).toThrow(
      expect.objectContaining({ code: 'ordered-minimum' }),
    );

    expect(sut.plan.reserves).toEqual([]);
    expect(sut.flow.hasPendingContinuation()).toBe(false);
  });

  it('rejects forced placement beyond physical capacity before changing page margins', () => {
    const sut = createCoupledFootnotePagination(options([note('tall', [75])]));
    const completed = boundary(0, ['tall'], 40);
    const pageBefore = structuredClone(completed.page);

    expect(() => sut.flow.completePage(completed)).toThrow(expect.objectContaining({ code: 'physical-overflow' }));

    expect(completed.page).toEqual(pageBefore);
    expect(sut.plan.reserves).toEqual([]);
  });

  it('uses actual fractional height instead of the rounded diagnostic ledger for physical admission', () => {
    const sut = createCoupledFootnotePagination(options([note('fractional', [20.25])]));
    const completed = boundary(0, ['fractional'], 29.3);

    sut.flow.completePage(completed);

    expect(sut.plan.reserves[0]).toBeCloseTo(29.3, 8);
    expect(sut.plan.ledgersByPage.get(0)?.actualBandHeightPx).toBe(30);
    expect(completed.page.margins!.bottom! - completed.page.footnoteReserved!).toBeCloseTo(20, 8);
  });

  it('rejects body overflow even when no note anchors were committed', () => {
    const sut = createCoupledFootnotePagination(options([]));

    expect(() => sut.flow.completePage(boundary(0, [], -0.01))).toThrow(
      expect.objectContaining({ code: 'physical-overflow' }),
    );

    expect(sut.plan.reserves).toEqual([]);
  });

  it('rejects a continuation-only page that cannot make exact range progress', () => {
    const sut = createCoupledFootnotePagination(options([note('one', [10, 10, 10])]));
    sut.flow.completePage(boundary(0, ['one'], 29));
    const completed = boundary(1, [], 0);
    const pageBefore = structuredClone(completed.page);

    expect(() => sut.flow.completePage(completed)).toThrow(expect.objectContaining({ code: 'no-progress' }));

    expect(completed.page).toEqual(pageBefore);
    expect(sut.plan.reserves).toEqual([29]);
    expect(sut.flow.incomingDemand(1)).toEqual({ height: 10, refs: 1 });
  });

  it('rejects split ranges whose measured heights cannot conserve their source range', () => {
    const content = note('inconsistent', [10, 10, 10]);
    content.ranges[0].height = 31;
    const sut = createCoupledFootnotePagination(options([content]));

    expect(() => sut.flow.completePage(boundary(0, ['inconsistent'], 29))).toThrow(
      expect.objectContaining({ code: 'range-conservation' }),
    );

    expect(sut.plan.reserves).toEqual([]);
  });

  it.each<Partial<Page>>([
    { columns: { count: 2, gap: 20 } },
    { vAlign: 'center' },
    { vAlign: 'bottom' },
    { columnRegions: [{ yStart: 20, yEnd: 780, columns: { count: 2, gap: 20 } }] },
  ])('rejects page geometry outside the single-column top-aligned admission path: %j', (pageOverrides) => {
    const sut = createCoupledFootnotePagination(options([note('one', [10])]));

    expect(() => sut.flow.completePage(boundary(0, ['one'], 100, pageOverrides))).toThrow(
      expect.objectContaining({ code: 'unsupported-page' }),
    );

    expect(sut.plan.reserves).toEqual([]);
  });

  it('rejects out-of-order page completion with a typed failure', () => {
    const sut = createCoupledFootnotePagination(options([note('one', [10])]));

    expect(() => sut.flow.completePage(boundary(1, ['one']))).toThrow(CoupledFootnotePaginationError);

    expect(sut.plan.reserves).toEqual([]);
    expect(sut.flow.incomingDemand(0)).toEqual({ height: 0, refs: 0 });
  });

  it('does not mutate source range or measurement inventories while draining continuations', () => {
    const content = note(
      'long',
      Array.from({ length: 200 }, () => 10),
    );
    const before = structuredClone(content);
    content.ranges.forEach(Object.freeze);
    Object.freeze(content.ranges);
    content.measure.lines.forEach(Object.freeze);
    Object.freeze(content.measure.lines);
    Object.freeze(content.measure);
    const sut = createCoupledFootnotePagination(options([content]));

    drainAtEof(sut, content.id);

    expect(content).toEqual(before);
    expect(sut.flow.hasPendingContinuation()).toBe(false);
  });

  it('starts a bounded window at its global page index with exact pending content', () => {
    const content = note('continued', [10, 10, 10, 10]);
    const sut = seededWindow(content, 2, 4);
    const initialDemand = sut.flow.incomingDemand(7);

    sut.flow.completePage(boundary(7, [], 19));

    expect(initialDemand).toEqual({ height: 20, refs: 1 });
    expect([...sut.plan.slicesByPage.keys()]).toEqual([7]);
    expect(sut.plan.slicesByPage.get(7)?.[0].ranges).toEqual([remainingRange(content, 2, 3)]);
    expect(sut.plan.reserves[7]).toBe(19);
    expect(sut.plan.ledgersByPage.get(7)?.anchorIds).toEqual([]);
    expect(sut.flow.incomingDemand(8)).toEqual({ height: 10, refs: 1 });
    expect(sut.plan.incomingByPage.get(7)).toEqual(
      new Map([[0, [{ id: content.id, ranges: [remainingRange(content, 2, 4)] }]]]),
    );
    expect(sut.plan.outgoingByPage.get(7)).toEqual(
      new Map([[0, [{ id: content.id, ranges: [remainingRange(content, 3, 4)] }]]]),
    );
  });

  it('keeps equal-height starting queues distinct when they own different measured lines', () => {
    const content = note('continued', [10, 10, 10, 10]);
    const windows = [seededWindow(content, 0, 2), seededWindow(content, 2, 4)];

    windows.forEach((sut) => sut.flow.completePage(boundary(7, [], 19)));

    expect(windows.map((sut) => sut.plan.reserves[7])).toEqual([19, 19]);
    expect(windows.map((sut) => sut.plan.slicesByPage.get(7)?.[0].ranges)).toEqual([
      [remainingRange(content, 0, 1)],
      [remainingRange(content, 2, 3)],
    ]);
    expect(windows.map((sut) => sut.plan.outgoingByPage.get(7)?.get(0)?.[0].ranges)).toEqual([
      [remainingRange(content, 1, 2)],
      [remainingRange(content, 3, 4)],
    ]);
  });

  it('rejects a fresh claim already owned by the source prefix even without an incoming continuation', () => {
    const previouslyAnchored = new Set(['old']);
    const sut = createCoupledFootnotePagination(
      options([note('old', [10]), note('new', [10])], {
        start: { pageIndex: 7, pendingByColumn: new Map(), isPreviouslyAnchored: (id) => previouslyAnchored.has(id) },
      }),
    );

    expect(() => sut.flow.completePage(boundary(7, ['old']))).toThrow(
      expect.objectContaining({ code: 'duplicate-claim' }),
    );

    expect(sut.plan.reserves).toEqual([]);
    expect(sut.plan.incomingByPage.size).toBe(0);
    expect(sut.flow.incomingDemand(7)).toEqual({ height: 0, refs: 0 });
  });

  it('keeps independent window controllers from sharing pending content or admission state', () => {
    const content = note('continued', [10, 10, 10, 10]);
    const first = seededWindow(content, 2, 4);
    const second = seededWindow(content, 2, 4);

    first.flow.completePage(boundary(7, [], 29));

    expect(first.flow.hasPendingContinuation()).toBe(false);
    expect(second.flow.incomingDemand(7)).toEqual({ height: 20, refs: 1 });
    expect(second.plan.reserves).toEqual([]);
    expect(second.plan.incomingByPage.size).toBe(0);
  });

  it('copies starting maps, entries, and ranges so caller changes cannot alter a pending window', () => {
    const content = note('continued', [10, 10, 10, 10]);
    const inputRange = remainingRange(content, 2, 4);
    const entries = [{ id: content.id, ranges: [inputRange] }];
    const pendingByColumn = new Map([[0, entries]]);
    const sut = createCoupledFootnotePagination(
      options([content], {
        start: { pageIndex: 7, pendingByColumn, isPreviouslyAnchored: (id) => id === content.id },
      }),
    );
    inputRange.height = 999;
    entries[0].id = 'changed';
    entries[0].ranges.length = 0;
    pendingByColumn.clear();

    sut.flow.completePage(boundary(7, [], 19));

    expect(sut.plan.slicesByPage.get(7)?.[0].id).toBe(content.id);
    expect(sut.plan.slicesByPage.get(7)?.[0].ranges).toEqual([remainingRange(content, 2, 3)]);
    expect(sut.flow.incomingDemand(8)).toEqual({ height: 10, refs: 1 });
  });

  it('keeps mutable page certificate copies separate from the continuation consumed on the next page', () => {
    const content = note('continued', [10, 10, 10, 10]);
    const sut = seededWindow(content, 2, 4);
    sut.flow.completePage(boundary(7, [], 19));
    const outgoing = sut.plan.outgoingByPage.get(7)!.get(0)!;
    outgoing[0].id = 'changed';
    outgoing[0].ranges[0].height = 999;
    outgoing[0].ranges.length = 0;
    sut.plan.incomingByPage.get(7)!.clear();

    sut.flow.completePage(boundary(8, [], 19));

    expect(sut.plan.slicesByPage.get(8)?.[0].id).toBe(content.id);
    expect(sut.plan.slicesByPage.get(8)?.[0].ranges).toEqual([remainingRange(content, 3, 4)]);
    expect(sut.plan.incomingByPage.get(8)).toEqual(
      new Map([[0, [{ id: content.id, ranges: [remainingRange(content, 3, 4)] }]]]),
    );
    expect(sut.plan.outgoingByPage.get(8)?.size).toBe(0);
    expect(sut.flow.hasPendingContinuation()).toBe(false);
  });
});

describe('complete coupled footnote references', () => {
  it('accepts every expected anchor exactly once across global page indexes from a single-use iterable', () => {
    const sut = createCoupledFootnotePagination(
      options([note('first', [10]), note('second', [10])], {
        start: { pageIndex: 7, pendingByColumn: new Map(), isPreviouslyAnchored: () => false },
      }),
    );
    sut.flow.completePage(boundary(7, ['first']));
    sut.flow.completePage(boundary(8, ['second']));
    const expected = new Set(['second', 'first']).values();

    expect(() => validateCoupledFootnoteReferenceConservation(sut.plan, expected)).not.toThrow();
  });

  it('rejects a missing anchor even when the total number of committed references matches', () => {
    const sut = createCoupledFootnotePagination(options([note('first', [10]), note('extra', [10])]));
    sut.flow.completePage(boundary(0, ['first', 'extra']));
    const before = structuredClone(sut.plan);

    expect(() => validateCoupledFootnoteReferenceConservation(sut.plan, ['first', 'missing'])).toThrow(
      expect.objectContaining({
        name: 'CoupledFootnotePaginationError',
        code: 'reference-conservation',
        footnoteId: 'missing',
      }),
    );

    expect(sut.plan).toEqual(before);
  });

  it('rejects an unexpected committed anchor and identifies its global page', () => {
    const sut = createCoupledFootnotePagination(
      options([note('extra', [10])], {
        start: { pageIndex: 7, pendingByColumn: new Map(), isPreviouslyAnchored: () => false },
      }),
    );
    sut.flow.completePage(boundary(7, ['extra']));

    expect(() => validateCoupledFootnoteReferenceConservation(sut.plan, [])).toThrow(
      expect.objectContaining({ code: 'reference-conservation', footnoteId: 'extra', pageIndex: 7 }),
    );
  });

  it('rejects duplicate expected references instead of silently deduplicating them', () => {
    const sut = createCoupledFootnotePagination(options([note('one', [10])]));
    sut.flow.completePage(boundary(0, ['one']));

    expect(() => validateCoupledFootnoteReferenceConservation(sut.plan, ['one', 'one'])).toThrow(
      expect.objectContaining({ code: 'reference-conservation', footnoteId: 'one' }),
    );
  });

  it('rejects a duplicated anchor claim inside a completed page ledger', () => {
    const sut = createCoupledFootnotePagination(options([note('one', [10])]));
    sut.flow.completePage(boundary(0, ['one']));
    sut.plan.ledgersByPage.get(0)!.anchorIds.push('one');

    expect(() => validateCoupledFootnoteReferenceConservation(sut.plan, ['one'])).toThrow(
      expect.objectContaining({ code: 'reference-conservation', footnoteId: 'one', pageIndex: 0 }),
    );
  });

  it('rejects the same anchor claimed on two different page ledgers', () => {
    const sut = createCoupledFootnotePagination(options([note('one', [10])]));
    sut.flow.completePage(boundary(0, ['one']));
    sut.flow.completePage(boundary(1, []));
    sut.plan.ledgersByPage.get(1)!.anchorIds.push('one');

    expect(() => validateCoupledFootnoteReferenceConservation(sut.plan, ['one'])).toThrow(
      expect.objectContaining({ code: 'reference-conservation', footnoteId: 'one', pageIndex: 1 }),
    );
  });

  it('accepts an empty pass with no expected fresh references', () => {
    const sut = createCoupledFootnotePagination(options([]));

    expect(() => validateCoupledFootnoteReferenceConservation(sut.plan, [])).not.toThrow();
  });

  it('rejects an empty pass when a fresh reference was expected', () => {
    const sut = createCoupledFootnotePagination(options([]));

    expect(() => validateCoupledFootnoteReferenceConservation(sut.plan, ['missing'])).toThrow(
      expect.objectContaining({ code: 'reference-conservation', footnoteId: 'missing' }),
    );
  });

  it('accepts incoming continuation-only pages without claiming their ids as fresh anchors', () => {
    const sut = seededWindow(note('continued', [10, 10, 10, 10]), 2, 4);
    sut.flow.completePage(boundary(7, [], 29));

    expect(() => validateCoupledFootnoteReferenceConservation(sut.plan, [])).not.toThrow();

    expect(sut.plan.slicesByPage.get(7)?.[0].id).toBe('continued');
    expect(sut.flow.hasPendingContinuation()).toBe(false);
  });

  it('does not let continuation slices satisfy an expected fresh reference', () => {
    const sut = seededWindow(note('continued', [10, 10, 10, 10]), 2, 4);
    sut.flow.completePage(boundary(7, [], 29));

    expect(() => validateCoupledFootnoteReferenceConservation(sut.plan, ['continued'])).toThrow(
      expect.objectContaining({ code: 'reference-conservation', footnoteId: 'continued', pageIndex: 7 }),
    );
  });

  it('counts a split note once even when it continues onto later EOF pages', () => {
    const sut = createCoupledFootnotePagination(options([note('continued', [10, 10, 10, 10])]));
    sut.flow.completePage(boundary(0, ['continued'], 29));
    sut.flow.completePage(boundary(1, [], 29));
    const expected = Object.freeze(['continued']);
    Object.freeze(sut.plan.ledgersByPage.get(0)!.anchorIds);
    Object.freeze(sut.plan.ledgersByPage.get(1)!.anchorIds);
    const before = structuredClone(sut.plan);

    expect(() => validateCoupledFootnoteReferenceConservation(sut.plan, expected)).not.toThrow();

    expect(sut.plan).toEqual(before);
    expect(expected).toEqual(['continued']);
  });
});
