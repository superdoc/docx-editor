import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import type { ParagraphBlock, TableBlock, TableMeasure } from '@superdoc/contracts';
import {
  clearTextMeasurementCaches,
  configureMeasurement,
  createDomMeasurementRuntime,
  type DomMeasurementRuntime,
  type TableMeasurementObservation,
} from './index.js';
import { clearTableCellBlockMeasureCache } from './table-cell-block-measure-cache.js';

function freezeData<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if ('value' in descriptor) freezeData(descriptor.value);
    }
    Object.freeze(value);
  }
  return value;
}

function tableGrid(rowCount = 25, columnCount = 4): TableBlock {
  return {
    kind: 'table',
    id: 'row-sharing-table',
    attrs: { tableLayout: 'fixed' },
    columnWidths: Array.from({ length: columnCount }, () => 96),
    rows: Array.from({ length: rowCount }, (_, row) => ({
      id: `row-${row}`,
      cells: Array.from({ length: columnCount }, (_, column) => ({
        id: `cell-${row}-${column}`,
        blocks: [
          {
            kind: 'paragraph' as const,
            id: `paragraph-${row}-${column}`,
            runs: [{ text: `Cell ${row}:${column}`, fontFamily: 'Arial', fontSize: 12 }],
          },
        ],
      })),
    })),
  };
}

function editRow(table: TableBlock, rowIndex: number, text: string): TableBlock {
  const row = table.rows[rowIndex]!;
  const cell = row.cells[0]!;
  const paragraph = cell.blocks![0] as ParagraphBlock;
  const rows = table.rows.slice();
  rows[rowIndex] = {
    ...row,
    cells: [{ ...cell, blocks: [{ ...paragraph, runs: [{ ...paragraph.runs[0], text }] }] }, ...row.cells.slice(1)],
  };
  return freezeData({ ...table, rows });
}

async function measure(
  runtime: DomMeasurementRuntime,
  block: TableBlock,
  retainedTable?: { block: TableBlock; measure: TableMeasure },
  options: { width?: number; fontSignature?: string } = {},
): Promise<{ value: TableMeasure; observation: TableMeasurementObservation }> {
  clearTableCellBlockMeasureCache();
  let observation: TableMeasurementObservation | undefined;
  const pass = runtime.beginPass({
    fontSignature: options.fontSignature ?? 'row-sharing-fonts',
    resolvePhysical: (family) => family,
  });
  try {
    const value = await pass.measureBlock(block, {
      maxWidth: options.width ?? 384,
      retainedTable,
      tableMeasurementTrace: {
        depth: 0,
        cacheIdentity: 'strict',
        observer: (entry) => {
          if (entry.depth === 0) observation = entry;
        },
      },
    });
    expect(value.kind).toBe('table');
    expect(observation).toBeDefined();
    return { value: value as TableMeasure, observation: observation! };
  } finally {
    pass.finish();
  }
}

function allocationCensus(previous: TableMeasure, current: TableMeasure) {
  return current.rows.reduce(
    (counts, row, rowIndex) => {
      const oldRow = previous.rows[rowIndex];
      counts.rows += Number(row !== oldRow);
      counts.cellArrays += Number(row.cells !== oldRow?.cells);
      row.cells.forEach((cell, cellIndex) => {
        counts.cells += Number(cell !== oldRow?.cells[cellIndex]);
        counts.blockArrays += Number(cell.blocks !== oldRow?.cells[cellIndex]?.blocks);
      });
      return counts;
    },
    { rows: 0, cellArrays: 0, cells: 0, blockArrays: 0 },
  );
}

describe('retained table row geometry', () => {
  beforeEach(() => clearTextMeasurementCaches());
  afterEach(() => configureMeasurement({ mode: 'browser' }));

  it.each([0, 12, 24])(
    'shares unchanged row containers across repeated edits at row %i without changing history',
    async (rowIndex) => {
      const runtime = createDomMeasurementRuntime();
      const coldRuntime = createDomMeasurementRuntime();
      try {
        let source = freezeData(tableGrid());
        let previous = (await measure(runtime, source)).value;
        const history: Array<{ value: TableMeasure; json: string }> = [];
        for (const text of [
          'First edit',
          'A much longer replacement that wraps across several lines in this narrow cell',
          'Third',
        ]) {
          history.push({ value: freezeData(previous), json: JSON.stringify(previous) });
          const current = editRow(source, rowIndex, text);
          const warm = await measure(runtime, current, { block: source, measure: previous });
          const cold = await measure(coldRuntime, current);
          expect(warm.value).toEqual(cold.value);
          history.forEach((entry) => expect(JSON.stringify(entry.value)).toBe(entry.json));
          const rebuiltRows = rowIndex === source.rows.length - 1 ? 1 : 2;
          expect.soft(allocationCensus(previous, warm.value)).toEqual({
            rows: rebuiltRows,
            cellArrays: rebuiltRows,
            cells: rebuiltRows * 4,
            blockArrays: rebuiltRows * 4,
          });
          expect(warm.value.rows[rowIndex]).not.toBe(previous.rows[rowIndex]);
          if (rowIndex + 1 < source.rows.length)
            expect(warm.value.rows[rowIndex + 1]).not.toBe(previous.rows[rowIndex + 1]);
          expect(warm.observation.cellBlockCache.miss).toBe(1);
          source = current;
          previous = warm.value;
        }
      } finally {
        runtime.dispose();
        coldRuntime.dispose();
      }
    },
  );

  it('does not revisit every retained cell beyond the bounded paragraph cache', async () => {
    const runtime = createDomMeasurementRuntime();
    const coldRuntime = createDomMeasurementRuntime();
    const rowReads = new Uint32Array(251);
    try {
      const input = freezeData(tableGrid(251, 20));
      // Transparent proxies count reads without replacing real measurement or adding source getters.
      const original = freezeData({
        ...input,
        rows: input.rows.map(
          (row, index) =>
            new Proxy(row, {
              get(target, key, receiver) {
                if (key === 'cells') rowReads[index] += 1;
                return Reflect.get(target, key, receiver);
              },
            }),
        ),
      });
      const initial = freezeData((await measure(runtime, original, undefined, { width: 1920 })).value);
      const edited = editRow(original, 123, 'Changed');
      rowReads.fill(0);
      const warm = await measure(runtime, edited, { block: original, measure: initial }, { width: 1920 });
      // The changed row reads its predecessor's bottom borders once per column.
      const maximumUnchangedRowReads = Math.max(
        ...Array.from(rowReads).filter((_, index) => index < 122 || index > 124),
      );
      expect.soft(maximumUnchangedRowReads).toBeLessThanOrEqual(16);
      expect
        .soft(allocationCensus(initial, warm.value))
        .toEqual({ rows: 2, cellArrays: 2, cells: 40, blockArrays: 40 });
      expect(warm.value).toEqual((await measure(coldRuntime, edited, undefined, { width: 1920 })).value);
    } finally {
      runtime.dispose();
      coldRuntime.dispose();
    }
  });

  it.each(['exact', 'atLeast'] as const)(
    'preserves %s row heights, padding and collapsed border chrome',
    async (rule) => {
      const runtime = createDomMeasurementRuntime();
      const coldRuntime = createDomMeasurementRuntime();
      try {
        const input = tableGrid(5, 4);
        input.attrs!.borders = { insideH: { style: 'single', width: 2 } };
        input.rows.forEach((row) => {
          row.attrs = { rowHeight: { rule, value: 40 } };
          row.cells.forEach((cell) => {
            cell.attrs = { padding: { top: 5, bottom: 7, left: 4, right: 4 } };
          });
        });
        const original = freezeData(input);
        const initial = freezeData((await measure(runtime, original)).value);
        const edited = editRow(original, 2, 'A long paragraph that becomes taller than the authored minimum height');
        const warm = await measure(runtime, edited, { block: original, measure: initial });
        expect(warm.value).toEqual((await measure(coldRuntime, edited)).value);
        expect.soft(warm.value.rows[0]).toBe(initial.rows[0]);
        expect.soft(warm.value.rows[4]).toBe(initial.rows[4]);
      } finally {
        runtime.dispose();
        coldRuntime.dispose();
      }
    },
  );

  it('remeasures the row below a changed collapsed border', async () => {
    const runtime = createDomMeasurementRuntime();
    const coldRuntime = createDomMeasurementRuntime();
    try {
      const original = freezeData(tableGrid(5, 4));
      const initial = freezeData((await measure(runtime, original)).value);
      const rows = original.rows.slice();
      const changed = original.rows[1]!;
      rows[1] = {
        ...changed,
        cells: changed.cells.map((cell) => ({
          ...cell,
          attrs: { borders: { bottom: { style: 'single', width: 6 } } },
        })),
      };
      const edited = freezeData({ ...original, rows });
      const warm = await measure(runtime, edited, { block: original, measure: initial });
      expect(warm.value).toEqual((await measure(coldRuntime, edited)).value);
      expect(warm.value.rows[2]!.height).toBeGreaterThan(initial.rows[2]!.height);
      expect(warm.value.rows[1]).not.toBe(initial.rows[1]);
      expect(warm.value.rows[2]).not.toBe(initial.rows[2]);
      expect.soft(warm.value.rows[3]).toBe(initial.rows[3]);
    } finally {
      runtime.dispose();
      coldRuntime.dispose();
    }
  });

  it.each(['inherited cell span', 'custom row prototype', 'span accessor', 'late shared span'] as const)(
    'falls back for %s topology and preserves cold geometry',
    async (shape) => {
      const runtime = createDomMeasurementRuntime();
      const coldRuntime = createDomMeasurementRuntime();
      const originalPrototypeSpan = Object.getOwnPropertyDescriptor(Object.prototype, 'rowSpan');
      try {
        const input = tableGrid(5, shape === 'late shared span' ? 1 : 4);
        input.columnWidths = [96, 96, 96, 96];
        const original = freezeData(input);
        const initial = freezeData((await measure(runtime, original)).value);
        const rows = original.rows.slice();
        const row = { ...rows[2]!, cells: rows[2]!.cells.slice() };
        const cell = { ...row.cells[0]! };
        row.cells[0] = cell;
        rows[2] = row;
        if (shape === 'inherited cell span') Object.setPrototypeOf(cell, { rowSpan: 2 });
        if (shape === 'custom row prototype') Object.setPrototypeOf(row, { unrelated: true });
        if (shape === 'span accessor') Object.defineProperty(cell, 'rowSpan', { get: () => 2 });
        if (shape === 'late shared span')
          Object.defineProperty(Object.prototype, 'rowSpan', { value: 2, configurable: true });
        const current = freezeData({ ...original, rows });
        const warm = await measure(runtime, current, { block: original, measure: initial });
        expect(warm.value).toEqual((await measure(coldRuntime, current)).value);
        expect(warm.value.rows.every((value, index) => value !== initial.rows[index])).toBe(true);
      } finally {
        if (originalPrototypeSpan) Object.defineProperty(Object.prototype, 'rowSpan', originalPrototypeSpan);
        else delete (Object.prototype as { rowSpan?: number }).rowSpan;
        runtime.dispose();
        coldRuntime.dispose();
      }
    },
  );

  it.each(['installed after measurement', 'mutated after measurement', 'removed after measurement'] as const)(
    'falls back when inherited padding is %s and preserves cold geometry',
    async (change) => {
      const runtime = createDomMeasurementRuntime();
      const coldRuntime = createDomMeasurementRuntime();
      const originalPrototypeAttrs = Object.getOwnPropertyDescriptor(Object.prototype, 'attrs');
      const inheritedAttrs = { padding: { top: 2, bottom: 2 } };
      const installAttrs = () =>
        Object.defineProperty(Object.prototype, 'attrs', {
          value: inheritedAttrs,
          configurable: true,
          writable: true,
        });
      try {
        const original = freezeData(tableGrid(5, 4));
        if (change !== 'installed after measurement') installAttrs();
        const initial = freezeData((await measure(runtime, original)).value);
        const current = editRow(original, 2, 'Edited');
        if (change === 'installed after measurement') installAttrs();
        inheritedAttrs.padding.top = 20;
        inheritedAttrs.padding.bottom = 20;
        if (change === 'removed after measurement') delete (Object.prototype as { attrs?: unknown }).attrs;
        const warm = await measure(runtime, current, { block: original, measure: initial });
        const cold = (await measure(coldRuntime, current)).value;
        expect(cold.rows[0]!.height).not.toBe(initial.rows[0]!.height);
        expect(warm.value).toEqual(cold);
        expect(warm.value.rows.every((value, index) => value !== initial.rows[index])).toBe(true);
      } finally {
        if (originalPrototypeAttrs) Object.defineProperty(Object.prototype, 'attrs', originalPrototypeAttrs);
        else delete (Object.prototype as { attrs?: unknown }).attrs;
        runtime.dispose();
        coldRuntime.dispose();
      }
    },
  );

  it.each(['columns', 'width', 'font', 'runtime', 'mode', 'attrs', 'row count', 'new span', 'clear'] as const)(
    'declines row reuse after a %s change and matches cold measurement',
    async (change) => {
      const runtime = createDomMeasurementRuntime();
      const coldRuntime = createDomMeasurementRuntime();
      try {
        const original = freezeData(tableGrid(5, 4));
        const initial = freezeData((await measure(runtime, original)).value);
        let edited = editRow(original, 2, 'Edited');
        const options: { width?: number; fontSignature?: string } = {};
        if (change === 'columns') edited = freezeData({ ...edited, columnWidths: [72, 104, 104, 104] });
        if (change === 'width') options.width = 383.7;
        if (change === 'font') options.fontSignature = 'new-font-generation';
        if (change === 'mode') configureMeasurement({ mode: 'deterministic' });
        if (change === 'attrs')
          edited = freezeData({
            ...edited,
            attrs: { ...edited.attrs, borders: { insideH: { style: 'single', width: 3 } } },
          });
        if (change === 'row count') edited = freezeData({ ...edited, rows: edited.rows.slice(0, -1) });
        if (change === 'new span') {
          const rows = edited.rows.slice();
          const row = rows[2]!;
          rows[2] = { ...row, cells: [{ ...row.cells[0]!, rowSpan: 2 }, ...row.cells.slice(1)] };
          rows[3] = { ...rows[3]!, cells: rows[3]!.cells.slice(1) };
          edited = freezeData({ ...edited, rows });
        }
        if (change === 'clear') clearTextMeasurementCaches();
        const warm = await measure(
          change === 'runtime' ? coldRuntime : runtime,
          edited,
          { block: original, measure: initial },
          options,
        );
        expect(warm.value).toEqual((await measure(coldRuntime, edited, undefined, options)).value);
        expect(warm.value.rows.every((row, index) => row !== initial.rows[index])).toBe(true);
      } finally {
        runtime.dispose();
        coldRuntime.dispose();
      }
    },
  );
});
