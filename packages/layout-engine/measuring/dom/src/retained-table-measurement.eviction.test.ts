import { describe, expect, it } from 'vite-plus/test';
import type { TableBlock } from '@superdoc/contracts';
import type { FontMeasureContext } from '@superdoc/font-system';
import {
  bindSurfaceMeasurementPass,
  createSurfaceMeasurementRuntimeState,
  disposeSurfaceMeasurementRuntime,
} from './measurement-runtime-context.js';
import {
  certifyTableMeasurementCell,
  createTableMeasurementOwner,
  createTableRowMeasurementOwner,
  finishTableRowMeasurementOwner,
  prepareTableMeasurementCell,
} from './retained-table-measurement.js';
import { createImmutableDataProofCache } from './immutable-data-proof-cache.js';

function frozenGrid(rowCount: number, columns: number): TableBlock {
  return Object.freeze({
    kind: 'table' as const,
    id: 'proof-cache-grid',
    rows: Object.freeze(
      Array.from({ length: rowCount }, () =>
        Object.freeze({
          cells: Object.freeze(
            Array.from({ length: columns }, () =>
              Object.freeze({
                blocks: Object.freeze([
                  Object.freeze({
                    kind: 'paragraph' as const,
                    id: 'proof-cache-paragraph',
                    runs: Object.freeze([Object.freeze({ text: 'x', fontFamily: 'Arial', fontSize: 12 })]),
                  }),
                ]),
              }),
            ),
          ),
        }),
      ),
    ),
  }) as unknown as TableBlock;
}

function certify(table: TableBlock): void {
  const runtime = createSurfaceMeasurementRuntimeState({ maxTextEntries: 1, maxEstimatedTextBytes: 1024 });
  const fonts: FontMeasureContext = { fontSignature: 'proof-cache', resolvePhysical: (family) => family };
  bindSurfaceMeasurementPass(runtime, fonts, undefined);
  try {
    const owner = createTableMeasurementOwner(table, fonts, 'proof-cache');
    for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex++) {
      const row = createTableRowMeasurementOwner(owner, rowIndex);
      for (let cellIndex = 0; cellIndex < table.rows[rowIndex]!.cells.length; cellIndex++) {
        prepareTableMeasurementCell(row, cellIndex);
        certifyTableMeasurementCell(row);
      }
      finishTableRowMeasurementOwner(owner, row);
    }
  } finally {
    disposeSurfaceMeasurementRuntime(runtime);
  }
}

describe('retained measurement proof eviction', () => {
  it('inspects a cold table once and reuses the warm proof', () => {
    let inspections = 0;
    const cell = new Proxy(frozenGrid(1, 1).rows[0]!.cells[0]!, {
      getPrototypeOf(target) {
        inspections++;
        return Reflect.getPrototypeOf(target);
      },
    });
    const table = Object.freeze({
      kind: 'table' as const,
      id: 'observed-proof',
      rows: Object.freeze([Object.freeze({ cells: Object.freeze([cell]) })]),
    }) as unknown as TableBlock;
    certify(table);
    expect(inspections).toBeGreaterThan(0);
    inspections = 0;
    certify(table);
    expect(inspections).toBe(0);
  });

  it('forgets the oldest proofs once eight segments are full', () => {
    const cache = createImmutableDataProofCache(2);
    const first = {};
    cache.add(first);
    for (let index = 0; index < 15; index++) cache.add({});
    expect(cache.has(first)).toBe(true);

    cache.add({});
    expect(cache.has(first)).toBe(false);
  });
});
