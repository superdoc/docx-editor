import { describe, expect, it } from 'bun:test';
import { balanceSectionOnPage, type BalancingFragment, type MeasureData } from './column-balancing.js';
import {
  breaksIntoNextColumn,
  MAX_ATOMIC_PARAGRAPH_LINES,
  splitParagraphIntoNextColumn,
  splittableLineHeights,
} from './paragraph-line-split.js';

type SplitFragment = BalancingFragment & {
  columnIndex?: number;
  continuesFromPrev?: boolean;
  continuesOnNext?: boolean;
};

function para(blockId: string, extra: Partial<SplitFragment> = {}): SplitFragment {
  return { kind: 'para', blockId, x: 0, y: 0, width: 600, ...extra };
}

function lines(...heights: number[]): Array<{ lineHeight: number }> {
  return heights.map((lineHeight) => ({ lineHeight }));
}

function paragraphMeasures(entries: Record<string, number[]>): Map<string, MeasureData> {
  return new Map(Object.entries(entries).map(([id, heights]) => [id, { kind: 'paragraph', lines: lines(...heights) }]));
}

describe('splittableLineHeights', () => {
  const measureMap = paragraphMeasures({ p: [10, 20, 30, 40] });

  it('exposes the measured line heights of the fragment line range', () => {
    expect(splittableLineHeights(para('p'), { measureMap })).toEqual([10, 20, 30, 40]);
    expect(splittableLineHeights(para('p', { fromLine: 1, toLine: 3 }), { measureMap })).toEqual([20, 30]);
  });

  it('keeps single-line paragraphs atomic', () => {
    expect(MAX_ATOMIC_PARAGRAPH_LINES).toBe(1);
    expect(splittableLineHeights(para('p', { fromLine: 2, toLine: 3 }), { measureMap })).toBeUndefined();
    expect(splittableLineHeights(para('p', { lines: lines(15) }), { measureMap })).toBeUndefined();
  });

  it('reads remeasured fragment lines instead of the measure', () => {
    expect(splittableLineHeights(para('p', { fromLine: 1, lines: lines(22, 22) }), { measureMap })).toEqual([22, 22]);
    expect(splittableLineHeights(para('p', { lines: [] }), { measureMap })).toEqual([10, 20, 30, 40]);
  });

  it('keeps sectPr markers and keepLines paragraphs atomic', () => {
    expect(splittableLineHeights(para('p'), { measureMap, sectPrMarkerBlockIds: new Set(['p']) })).toBeUndefined();
    expect(splittableLineHeights(para('p'), { measureMap, keepLinesBlockIds: new Set(['p']) })).toBeUndefined();
  });

  it('keeps non-paragraph fragments and paragraphs without line measures atomic', () => {
    expect(splittableLineHeights({ ...para('p'), kind: 'image' }, { measureMap })).toBeUndefined();
    expect(splittableLineHeights(para('missing'), { measureMap })).toBeUndefined();
    expect(
      splittableLineHeights(para('p'), { measureMap: new Map([['p', { kind: 'image', lines: lines(1, 2) }]]) }),
    ).toBeUndefined();
  });
});

describe('breaksIntoNextColumn', () => {
  const breakPoint = { blockId: 'p', breakAfterLine: 1, heightBeforeBreak: 20, heightAfterBreak: 20 };

  it('splits when lines remain after the break and a next column exists', () => {
    expect(breaksIntoNextColumn(breakPoint, 0, 2)).toBe(true);
  });

  it('keeps the block whole without a break point, remaining lines, or a next column', () => {
    expect(breaksIntoNextColumn(undefined, 0, 2)).toBe(false);
    expect(breaksIntoNextColumn({ ...breakPoint, heightAfterBreak: 0 }, 0, 2)).toBe(false);
    expect(breaksIntoNextColumn(breakPoint, 1, 2)).toBe(false);
  });
});

describe('splitParagraphIntoNextColumn', () => {
  const next = { columnIndex: 1, x: 432, y: 96, width: 288 };

  function split(fragment: SplitFragment, breakAfterLine: number, measureMap = paragraphMeasures({ p: [1, 1, 1, 1] })) {
    const before = para('before');
    const after = para('after');
    const fragments: BalancingFragment[] = [before, fragment, after];
    const secondHalf: SplitFragment = splitParagraphIntoNextColumn({
      fragment,
      fragments,
      breakAfterLine,
      measureMap,
      next,
    });
    return { fragments, secondHalf, before, after };
  }

  it('ends the first half after the break line and starts the second half there', () => {
    const first = para('p', { fromLine: 1 });
    const { secondHalf } = split(first, 1);
    expect(first).toMatchObject({ fromLine: 1, toLine: 3, continuesOnNext: true });
    expect(secondHalf).toMatchObject({ fromLine: 3, toLine: 4, continuesFromPrev: true });
  });

  it('ends the second half where the original fragment ended', () => {
    expect(split(para('p', { toLine: 3 }), 0).secondHalf.toLine).toBe(3);
    expect(split(para('p'), 0).secondHalf.toLine).toBe(4);
    expect(split(para('p'), 0, new Map()).secondHalf.toLine).toBe(1);
  });

  it('places the second half at the top of the next column', () => {
    const { secondHalf } = split(para('p', { columnIndex: 0 }), 0);
    expect(secondHalf).toMatchObject({ x: 432, y: 96, width: 288, columnIndex: 1 });
    expect('columnIndex' in split(para('p'), 0).secondHalf).toBe(false);
  });

  it('gives the second half the original continuation', () => {
    expect(split(para('p', { continuesOnNext: true }), 0).secondHalf.continuesOnNext).toBe(true);
    expect(split(para('p'), 0).secondHalf.continuesOnNext).toBe(false);
  });

  it('slices remeasured lines so each half carries only its own', () => {
    const first = para('p', { lines: lines(1, 2, 3, 4) });
    const { secondHalf } = split(first, 1);
    expect(first.lines).toEqual(lines(1, 2));
    expect(secondHalf.lines).toEqual(lines(3, 4));
  });

  it('inserts the second half right after the first', () => {
    const first = para('p');
    const { fragments, secondHalf, before, after } = split(first, 0);
    expect(fragments).toEqual([before, first, secondHalf, after]);
  });
});

describe('balanceSectionOnPage line splitting', () => {
  function balance(
    fragments: SplitFragment[],
    measureMap: Map<string, MeasureData>,
    sectPrMarkerBlockIds?: Set<string>,
  ) {
    return balanceSectionOnPage({
      fragments,
      sectionIndex: 0,
      sectionColumns: { count: 2, gap: 48, width: 288 },
      sectionHasExplicitColumnBreak: false,
      blockSectionMap: new Map(fragments.map((fragment) => [fragment.blockId, 0])),
      margins: { left: 96 },
      topMargin: 96,
      columnWidth: 288,
      availableHeight: 900,
      measureMap,
      sectPrMarkerBlockIds,
    });
  }

  it('keeps fragments that share a y position as separate blocks', () => {
    const left = para('left', { x: 96, y: 96 });
    const right = para('right', { x: 432, y: 96 });
    const fragments = [left, right];
    const result = balance(fragments, paragraphMeasures({ left: [60], right: [60] }));
    expect(result).toEqual({ maxY: 156 });
    expect(fragments.map((fragment) => [fragment.x, fragment.y])).toEqual([
      [96, 96],
      [432, 96],
    ]);
  });

  it('gives a sectPr-marker paragraph no height in its column', () => {
    const body = para('body', { x: 96, y: 96 });
    const marker = para('marker', { x: 96, y: 176 });
    const tail = para('tail', { x: 96, y: 196 });
    const measureMap = paragraphMeasures({ body: [80], marker: [20], tail: [80] });
    const result = balance([body, marker, tail], measureMap, new Set(['marker']));
    expect(result).toEqual({ maxY: 176 });
    expect(tail.y).toBe(96);
    expect(tail.x).toBe(432);
  });
});
