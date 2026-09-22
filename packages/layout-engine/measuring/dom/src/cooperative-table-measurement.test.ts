import { beforeEach, describe, expect, it } from 'vite-plus/test';
import type { ParagraphBlock, TableBlock } from '@superdoc/contracts';
import type { FontMeasureContext } from '@superdoc/font-system';
import { createDomMeasurementRuntime, measureBlock, type TableMeasurementObservation } from './index.js';
import { clearTableCellBlockMeasureCache } from './table-cell-block-measure-cache.js';

const fontContext: FontMeasureContext = {
  fontSignature: 'cooperative-table-measurement',
  resolvePhysical: (family) => family,
};

const paragraph: ParagraphBlock = {
  kind: 'paragraph',
  id: 'repeated-cell-paragraph',
  runs: [{ text: 'Cell', fontFamily: 'Arial', fontSize: 12 }],
};

function tableGrid(rowCount: number, columnCount: number, onCellContentRead?: () => void): TableBlock {
  return {
    kind: 'table',
    id: 'grid-table',
    attrs: { tableLayout: 'fixed' },
    columnWidths: Array.from({ length: columnCount }, () => 96),
    rows: Array.from({ length: rowCount }, (_, row) => ({
      id: `row-${row}`,
      cells: Array.from({ length: columnCount }, (_, column) => ({
        id: `cell-${row}-${column}`,
        get blocks() {
          onCellContentRead?.();
          return [paragraph];
        },
      })),
    })),
  };
}

describe('cooperative table measurement', () => {
  beforeEach(() => {
    clearTableCellBlockMeasureCache();
  });

  it.each([
    ['many rows', 1024, 1],
    ['one wide row', 1, 1024],
  ])('can cancel cached cell work in %s before consuming the complete table', async (_label, rows, columns) => {
    await measureBlock(tableGrid(1, 1), 96, fontContext);
    let cellsRead = 0;
    const table = tableGrid(rows, columns, () => {
      cellsRead += 1;
    });
    const cancelled = new Error('table measurement superseded');
    const runtime = createDomMeasurementRuntime();
    let aborted = false;
    const pass = runtime.beginPass(fontContext, {
      throwIfAborted: () => {
        if (aborted) throw cancelled;
      },
      checkpointIfDue: () =>
        cellsRead === 0
          ? null
          : Promise.resolve().then(() => {
              aborted = true;
            }),
    });

    try {
      await expect(pass.measureBlock(table, columns * 96).then(() => 'completed')).rejects.toBe(cancelled);
      expect(cellsRead).toBeGreaterThan(0);
      expect(cellsRead).toBeLessThan(rows * columns);
    } finally {
      pass.finish();
      runtime.dispose();
    }
  });

  it('preserves the exact table measure while yielding across cache hits', async () => {
    const table = tableGrid(512, 2);
    const expected = await measureBlock(table, 192, fontContext);
    const runtime = createDomMeasurementRuntime();
    let checkpoints = 0;
    let observation: TableMeasurementObservation | undefined;
    const pass = runtime.beginPass(fontContext, {
      checkpointIfDue: () => {
        checkpoints += 1;
        return Promise.resolve();
      },
    });

    try {
      const actual = await pass.measureBlock(table, {
        maxWidth: 192,
        tableMeasurementTrace: {
          depth: 0,
          cacheIdentity: 'strict',
          observer: (value) => {
            observation = value;
          },
        },
      });
      expect(actual).toEqual(expected);
      expect(observation?.cellBlockCache).toEqual({ 'exact-hit': 1024, 'adopted-hit': 0, 'retained-hit': 0, miss: 0 });
      expect(checkpoints).toBeGreaterThan(1);
    } finally {
      pass.finish();
      runtime.dispose();
    }
  });

  it('uses the same execution owner for nested table cell checkpoints', async () => {
    await measureBlock(tableGrid(1, 1), 96, fontContext);
    const nested = tableGrid(1024, 1);
    const outer: TableBlock = {
      kind: 'table',
      id: 'outer-table',
      attrs: { tableLayout: 'fixed' },
      columnWidths: [104],
      rows: [{ id: 'outer-row', cells: [{ id: 'outer-cell', blocks: [nested] }] }],
    };
    const cancelled = new Error('nested table measurement superseded');
    let checkpoints = 0;
    const runtime = createDomMeasurementRuntime();
    const pass = runtime.beginPass(fontContext, {
      checkpointIfDue: () => {
        checkpoints += 1;
        if (checkpoints === 4) return Promise.reject(cancelled);
        return null;
      },
    });

    try {
      await expect(pass.measureBlock(outer, 104).then(() => 'completed')).rejects.toBe(cancelled);
      expect(checkpoints).toBe(4);
    } finally {
      pass.finish();
      runtime.dispose();
    }
  });
});
