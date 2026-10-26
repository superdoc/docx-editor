import { describe, expect, it, vi } from 'vite-plus/test';
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

vi.mock('./immutable-data-proof-cache.js', async (importOriginal) => {
  const { createImmutableDataProofCache } = await importOriginal<typeof import('./immutable-data-proof-cache.js')>();
  return { createImmutableDataProofCache: () => createImmutableDataProofCache(16) };
});

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
    expect(owner).toMatchObject({ immutable: true, rowsCertified: table.rows.length, rowsReusable: true });
  } finally {
    disposeSurfaceMeasurementRuntime(runtime);
  }
}

describe('retained measurement proof eviction', () => {
  it('reuses a warm proof and re-inspects it after independent source generations evict it', () => {
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
    inspections = 0;
    certify(table);
    expect(inspections).toBe(0);
    for (let generation = 0; generation < 9; generation++) certify(frozenGrid(1, 5));
    certify(table);
    expect(inspections).toBeGreaterThan(0);
  });
});
