import { describe, expect, it } from 'bun:test';
import type { TableFragmentMetadata } from '@superdoc/contracts';
import { balanceSectionOnPage, type BalancingFragment, type MeasureData } from './column-balancing.js';
import {
  findSplitRowBeforeLastRow,
  fragmentRowBoundaries,
  splitDominantTableAtRowBoundary,
} from './dominant-table-split.js';

type TestFragment = BalancingFragment & {
  fromRow?: number;
  toRow?: number;
  continuesFromPrev?: boolean;
  continuesOnNext?: boolean;
  metadata?: TableFragmentMetadata;
};

const METADATA: TableFragmentMetadata = {
  columnBoundaries: [{ index: 0, x: 0, width: 100, minWidth: 10, resizable: true }],
  coordinateSystem: 'fragment',
};

function table(rowHeights: number[], extra: Partial<TestFragment> = {}): TestFragment {
  return {
    kind: 'table',
    blockId: 'table',
    x: 0,
    y: 0,
    width: 100,
    fromRow: 0,
    toRow: rowHeights.length,
    height: rowHeights.reduce((sum, height) => sum + height, 0),
    ...extra,
  };
}

function block(blockId: string, height: number): TestFragment {
  return { kind: 'image', blockId, x: 0, y: 0, width: 100, height };
}

function tableMeasure(rowHeights: number[]): MeasureData & { rows: Array<{ height: number }> } {
  return { kind: 'table', rows: rowHeights.map((height) => ({ height })) };
}

function split(sectionFragments: TestFragment[], rowHeights: number[]) {
  const fragments = [...sectionFragments];
  const result = splitDominantTableAtRowBoundary({
    sectionFragments,
    fragments,
    columnCount: 2,
    measureMap: new Map([['table', tableMeasure(rowHeights)]]),
    balancingHeight: (fragment) => fragment.height ?? 0,
  });
  return { result, fragments, sectionFragments };
}

describe('splitDominantTableAtRowBoundary', () => {
  it('splits only when the section has exactly one table fragment', () => {
    const rows = [50, 50, 50, 50];
    expect(split([table(rows)], rows).result).not.toBeNull();
    expect(split([table(rows), table(rows, { blockId: 'other', height: 10 })], rows).result).toBeNull();
    expect(split([block('image', 200)], rows).result).toBeNull();
  });

  it('needs at least two rows in the fragment', () => {
    const rows = [200, 200];
    expect(split([table(rows, { fromRow: 1, toRow: 2, height: 200 }), block('tail', 1)], rows).result).toBeNull();
    expect(split([table(rows, { height: 200 }), block('tail', 1)], rows).result).not.toBeNull();
  });

  it('needs a table measure with rows', () => {
    const fragments = [table([50, 50, 50])];
    const result = splitDominantTableAtRowBoundary({
      sectionFragments: fragments,
      fragments: [...fragments],
      columnCount: 2,
      measureMap: new Map([['table', { kind: 'paragraph', rows: [{ height: 50 }, { height: 50 }, { height: 50 }] }]]),
      balancingHeight: (fragment) => fragment.height ?? 0,
    });
    expect(result).toBeNull();
  });

  it('subtracts the height before the table from the per-column target', () => {
    const rows = [100, 100, 100];
    const tableFragment = table(rows);
    const { fragments } = split([block('lead', 100), tableFragment], rows);
    expect(tableFragment.toRow).toBe(1);
    expect(tableFragment.height).toBe(100);
    expect(fragments.map((fragment) => fragment.height)).toEqual([100, 100, 200]);
  });

  it('floors the target at one pixel when earlier content already fills a column', () => {
    const rows = [0, 10, 10];
    const tableFragment = table(rows);
    split([block('lead', 500), tableFragment], rows);
    expect(tableFragment.toRow).toBe(2);
  });

  it('keeps a table that fits within one pixel of the target whole', () => {
    const rows = [59, 1];
    expect(split([table(rows), block('tail', 58)], rows).result).toBeNull();
    expect(split([table(rows), block('tail', 56)], rows).result).not.toBeNull();
  });

  it('never splits a fragment spanning fewer than two rows', () => {
    const rows = [100, 0];
    expect(split([table(rows, { toRow: 1.5, height: 100 })], rows).result).toBeNull();
  });

  it('never starts the second half after the last row', () => {
    expect(findSplitRowBeforeLastRow([10, 10, 100], 0, 3, 60)).toBeNull();
    expect(findSplitRowBeforeLastRow([10, 60, 100], 0, 3, 60)).toBe(2);
    expect(findSplitRowBeforeLastRow([70, 10, 100], 0, 3, 60)).toBe(1);
    const rows = [10, 10, 100];
    expect(split([table(rows)], rows).result).toBeNull();
  });

  it('builds fragment-relative row boundaries in the contract shape', () => {
    expect(fragmentRowBoundaries([20, 30])).toEqual([
      { index: 0, y: 0.5, height: 20, minHeight: 20, resizable: true },
      { index: 1, y: 20.5, height: 30, minHeight: 30, resizable: true },
    ]);
  });

  it('gives each half its own row boundaries and the second half the original continuation', () => {
    const rows = [40, 40, 40, 40];
    const tableFragment = table(rows, { continuesOnNext: true, metadata: METADATA });
    const { fragments, sectionFragments } = split([tableFragment], rows);
    const secondHalf: TestFragment | undefined = fragments[1];
    expect(sectionFragments[1]).toBe(secondHalf);
    expect(tableFragment).toMatchObject({ fromRow: 0, toRow: 2, height: 80, continuesOnNext: true });
    expect(secondHalf).toMatchObject({
      fromRow: 2,
      toRow: 4,
      height: 80,
      continuesFromPrev: true,
      continuesOnNext: true,
    });
    expect(tableFragment.metadata?.rowBoundaries?.map((boundary) => boundary.index)).toEqual([0, 1]);
    expect(secondHalf?.metadata?.rowBoundaries?.map((boundary) => boundary.index)).toEqual([0, 1]);
    expect(secondHalf?.metadata?.columnBoundaries).toEqual(METADATA.columnBoundaries);
  });

  it('carries the original continuation value and metadata spread through unchanged', () => {
    const rows = [40, 40, 40, 40];
    const continuation: unknown = 1;
    const metadata: unknown = [];
    const tableFragment = Object.assign(table(rows), { continuesOnNext: continuation, metadata });
    const { fragments } = split([tableFragment], rows);
    const firstMetadata: unknown = tableFragment.metadata;
    expect(fragments[1]).toMatchObject({ continuesOnNext: 1 });
    expect(firstMetadata).toEqual({ rowBoundaries: fragmentRowBoundaries([40, 40]) });
  });

  it('ends the second half where the original fragment ended when it did not continue', () => {
    const rows = [40, 40, 40, 40];
    const { fragments } = split([table(rows)], rows);
    expect(fragments[1]).toMatchObject({ continuesOnNext: false, metadata: undefined });
  });

  it('rolls back to the original fragment and arrays', () => {
    const rows = [40, 40, 40, 40];
    const tableFragment = table(rows, { metadata: METADATA });
    const before = { ...tableFragment, continuesOnNext: false };
    const { result, fragments, sectionFragments } = split([tableFragment], rows);
    result?.rollback();
    expect(fragments).toEqual([tableFragment]);
    expect(sectionFragments).toEqual([tableFragment]);
    expect(tableFragment).toEqual(before);
  });
});

describe('balanceSectionOnPage with a dominant table', () => {
  function balance(rowHeights: number[]) {
    const fragment = table(rowHeights, { x: 96, y: 96, width: 624 });
    const fragments: BalancingFragment[] = [fragment];
    const result = balanceSectionOnPage({
      fragments,
      sectionIndex: 0,
      sectionColumns: { count: 2, gap: 48, width: 288 },
      sectionHasExplicitColumnBreak: false,
      blockSectionMap: new Map([['table', 0]]),
      margins: { left: 96 },
      topMargin: 96,
      columnWidth: 288,
      availableHeight: 900,
      measureMap: new Map([['table', tableMeasure(rowHeights)]]),
    });
    return { result, fragments, fragment };
  }

  it('balances the two halves into both columns', () => {
    const { result, fragments } = balance([50, 50, 50, 50]);
    expect(result).toEqual({ maxY: 196 });
    expect(fragments.map((fragment) => [fragment.x, fragment.y])).toEqual([
      [96, 96],
      [432, 96],
    ]);
  });

  it('rolls the split back when balancing is skipped afterwards', () => {
    const { result, fragments, fragment } = balance([3, 3, 3]);
    expect(result).toBeNull();
    expect(fragments).toEqual([fragment]);
    expect(fragment).toMatchObject({ toRow: 3, height: 9, continuesOnNext: false });
  });
});
