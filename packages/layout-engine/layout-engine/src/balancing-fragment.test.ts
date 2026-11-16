import { describe, expect, it } from 'bun:test';
import {
  getBalancingHeight,
  getFragmentHeight,
  isSectPrMarkerParagraph,
  recordedColumnIndex,
  setRecordedColumnIndex,
} from './balancing-fragment.js';
import type { BalancingFragment, MeasureData } from './column-balancing.js';

function fragment(kind: string, extra: Partial<BalancingFragment> = {}): BalancingFragment {
  return { kind, blockId: 'b', x: 0, y: 0, width: 100, ...extra };
}

function measures(measure: MeasureData): Map<string, MeasureData> {
  return new Map([['b', measure]]);
}

const paragraphMeasure = (...lineHeights: number[]): MeasureData => ({
  kind: 'paragraph',
  lines: lineHeights.map((lineHeight) => ({ lineHeight })),
});

describe('getFragmentHeight for paragraphs', () => {
  it('sums the measured lines in the fragment line range', () => {
    const map = measures(paragraphMeasure(10, 20, 30, 40));
    expect(getFragmentHeight(fragment('para'), map)).toBe(100);
    expect(getFragmentHeight(fragment('para', { fromLine: 1, toLine: 3 }), map)).toBe(50);
    expect(getFragmentHeight(fragment('para', { fromLine: 2 }), map)).toBe(70);
    expect(getFragmentHeight(fragment('para', { toLine: 6 }), map)).toBe(100);
  });

  it('uses remeasured fragment lines over the measure', () => {
    const map = measures(paragraphMeasure(10, 10, 10));
    expect(getFragmentHeight(fragment('para', { lines: [{ lineHeight: 22 }, { lineHeight: 22 }] }), map)).toBe(44);
    expect(getFragmentHeight(fragment('para', { lines: [] }), map)).toBe(30);
  });

  it('is zero without a paragraph measure with lines', () => {
    expect(getFragmentHeight(fragment('para'), new Map())).toBe(0);
    expect(getFragmentHeight(fragment('para'), measures({ kind: 'image', lines: [{ lineHeight: 50 }] }))).toBe(0);
    expect(getFragmentHeight(fragment('para'), measures({ kind: 'paragraph' }))).toBe(0);
  });
});

describe('getFragmentHeight for images, drawings and tables', () => {
  it('prefers a positive fragment height', () => {
    for (const kind of ['image', 'drawing', 'table']) {
      expect(getFragmentHeight(fragment(kind, { height: 40 }), measures({ kind, height: 90 }))).toBe(40);
    }
  });

  it('falls back to a positive measure height', () => {
    expect(getFragmentHeight(fragment('image', { height: 0 }), measures({ kind: 'image', height: 90 }))).toBe(90);
  });

  it('falls back to the table measure total height only for tables', () => {
    expect(getFragmentHeight(fragment('table', { height: 0 }), measures({ kind: 'table', totalHeight: 75 }))).toBe(75);
    expect(getFragmentHeight(fragment('image', { height: 0 }), measures({ kind: 'image', totalHeight: 75 }))).toBe(0);
  });

  it('keeps a non-positive fragment height when nothing else is known', () => {
    expect(getFragmentHeight(fragment('image', { height: -5 }), new Map())).toBe(-5);
    expect(getFragmentHeight(fragment('drawing'), new Map())).toBe(0);
  });

  it('is zero for other fragment kinds', () => {
    expect(getFragmentHeight(fragment('textbox', { height: 40 }), measures({ kind: 'textbox', height: 40 }))).toBe(0);
  });
});

describe('getBalancingHeight', () => {
  const map = measures(paragraphMeasure(20, 20));

  it('gives a sectPr-marker paragraph no height', () => {
    expect(getBalancingHeight(fragment('para'), map, new Set(['b']))).toBe(0);
    expect(isSectPrMarkerParagraph(fragment('para'), new Set(['b']))).toBe(true);
  });

  it('keeps the height of a blank paragraph that is not a marker', () => {
    expect(getBalancingHeight(fragment('para'), map, new Set(['other']))).toBe(40);
    expect(getBalancingHeight(fragment('para'), map)).toBe(40);
  });

  it('only treats paragraphs as markers', () => {
    expect(getBalancingHeight(fragment('image', { height: 30 }), new Map(), new Set(['b']))).toBe(30);
  });
});

describe('recorded column index', () => {
  it('reads and updates columnIndex only on fragments that record one', () => {
    const recorded = Object.assign(fragment('para'), { columnIndex: 0 });
    setRecordedColumnIndex(recorded, 2);
    expect(recordedColumnIndex(recorded)).toBe(2);

    const unrecorded = fragment('para');
    setRecordedColumnIndex(unrecorded, 2);
    expect('columnIndex' in unrecorded).toBe(false);
    expect(recordedColumnIndex(unrecorded)).toBeUndefined();
  });
});
