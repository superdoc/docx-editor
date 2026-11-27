import { Session } from 'node:inspector';
import { setImmediate } from 'node:timers/promises';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { ParagraphBlock, TableBlock, TableMeasure } from '@superdoc/contracts';
import type { FontMeasureContext } from '@superdoc/font-system';
import {
  createDomMeasurementRuntime,
  configureMeasurement,
  clearTextMeasurementCaches,
  type DomMeasurementRuntime,
  type TableMeasurementObservation,
} from './index.js';
import { clearTableCellBlockMeasureCache } from './table-cell-block-measure-cache.js';
import * as retainedTableModule from './retained-table-measurement.js';

function freezeData<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if ('value' in descriptor) freezeData(descriptor.value);
    }
    Object.freeze(value);
  }
  return value;
}

function tableGrid(rows = 251, columns = 20): TableBlock {
  return {
    kind: 'table',
    id: 'retained-table',
    attrs: { tableLayout: 'fixed' },
    columnWidths: Array.from({ length: columns }, () => 96),
    rows: Array.from({ length: rows }, (_, row) => ({
      id: `row-${row}`,
      cells: Array.from({ length: columns }, (_, column) => ({
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

function editCell(table: TableBlock, rowIndex: number, text: string): TableBlock {
  const row = table.rows[rowIndex]!;
  const cell = row.cells[0]!;
  const paragraph = cell.blocks![0] as ParagraphBlock;
  return freezeData({
    ...table,
    rows: table.rows.map((current, index) =>
      index !== rowIndex
        ? current
        : {
            ...row,
            cells: row.cells.map((currentCell, column) =>
              column !== 0
                ? currentCell
                : {
                    ...cell,
                    blocks: [{ ...paragraph, runs: [{ ...paragraph.runs[0], text }] }],
                  },
            ),
          },
    ),
  });
}

const fontContext = (fontSignature = 'retained-table-fonts'): FontMeasureContext => ({
  fontSignature,
  resolvePhysical: (family) => family,
});

async function measure(
  runtime: DomMeasurementRuntime,
  block: TableBlock,
  retainedTable?: import('./retained-table-measurement.js').RetainedTableMeasurement,
  width = 1920,
  fonts = fontContext(),
): Promise<{ measure: TableMeasure; observation: TableMeasurementObservation }> {
  let observation: TableMeasurementObservation | undefined;
  const pass = runtime.beginPass(fonts);
  try {
    const constraints = {
      maxWidth: width,
      retainedTable,
      tableMeasurementTrace: {
        depth: 0,
        cacheIdentity: 'strict' as const,
        observer: (value: TableMeasurementObservation) => {
          if (value.depth === 0) observation = value;
        },
      },
    };
    const measured = await pass.measureBlock(block, constraints);
    expect(measured.kind).toBe('table');
    expect(observation).toBeDefined();
    return { measure: measured as TableMeasure, observation: observation! };
  } finally {
    pass.finish();
  }
}

function nativeMetricsRuntime(onFlush?: () => void) {
  const canvas = document.createElement('canvas').getContext('2d')!;
  const known = new Set<string>();
  const pending = new Set<string>();
  let flushCount = 0;
  const context = new Proxy(canvas, {
    get(target, key) {
      if (key === 'measureText')
        return (text: string) => {
          const query = JSON.stringify([target.font, text]);
          const actual = target.measureText(text);
          if (known.has(query)) return actual;
          pending.add(query);
          return new Proxy(actual, {
            get: (metric, field) => (field === 'width' ? metric.width / 2 : Reflect.get(metric, field)),
          });
        };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set: (target, key, value) => Reflect.set(target, key, value, target),
  });
  const runtime = createDomMeasurementRuntime({
    createCanvasContext: () => context,
    flushTextMetrics: () =>
      pending.size
        ? Promise.resolve().then(() => {
            flushCount++;
            onFlush?.();
            for (const query of pending) known.add(query);
            pending.clear();
          })
        : null,
  });
  return {
    runtime,
    canvas,
    get flushCount() {
      return flushCount;
    },
  };
}

describe('retained table paragraph measurement', () => {
  beforeEach(() => clearTableCellBlockMeasureCache());

  it('does not revive speculative cell widths on a later pass without retained input', async () => {
    clearTableCellBlockMeasureCache();
    const native = nativeMetricsRuntime();
    const { runtime, canvas } = native;
    const oracle = createDomMeasurementRuntime({ createCanvasContext: () => canvas });
    try {
      const source = editCell(
        freezeData(tableGrid(2, 2)),
        0,
        'Native widths must remain authoritative across repeated measurement passes',
      );
      const initial = await measure(runtime, source, undefined, 192);
      const repeated = await measure(runtime, source, undefined, 192);
      clearTableCellBlockMeasureCache();
      const cold = await measure(oracle, source, undefined, 192);
      expect(initial.measure).toEqual(cold.measure);
      expect(repeated.measure).toEqual(cold.measure);
    } finally {
      runtime.dispose();
      oracle.dispose();
      clearTableCellBlockMeasureCache();
    }
  });

  it('retains settled row geometry when a later edit discovers new native text metrics', async () => {
    const native = nativeMetricsRuntime();
    const { runtime, canvas } = native;
    const oracle = createDomMeasurementRuntime({ createCanvasContext: () => canvas });
    try {
      const original = freezeData(tableGrid(4, 2));
      const initial = await measure(runtime, original, undefined, 192);
      const initialFlushes = native.flushCount;
      const edited = editCell(original, 2, 'A new native width that wraps over several lines');
      clearTableCellBlockMeasureCache();
      const next = await measure(runtime, edited, { block: original, measure: initial.measure }, 192);
      expect(native.flushCount).toBeGreaterThan(initialFlushes);
      expect(next.observation.cellBlockCache.miss).toBe(1);
      expect(next.measure.rows[0]).toBe(initial.measure.rows[0]);
      clearTableCellBlockMeasureCache();
      expect(next.measure).toEqual((await measure(oracle, edited, undefined, 192)).measure);
    } finally {
      runtime.dispose();
      oracle.dispose();
    }
  });

  it.each(['failed', 'canceled'] as const)(
    'refuses geometry produced by a %s native discovery attempt',
    async (kind) => {
      let fail = true,
        aborted = false;
      const native = nativeMetricsRuntime(() => {
        if (!fail) return;
        if (kind === 'failed') throw new Error('Injected native metric failure');
        aborted = true;
      });
      const { runtime, canvas } = native;
      const completed: TableMeasure[] = [];
      const record = retainedTableModule.recordTableMeasurementOwner;
      const observation = vi.spyOn(retainedTableModule, 'recordTableMeasurementOwner').mockImplementation((...args) => {
        record(...args);
        completed.push(args[0]);
      });
      const oracle = createDomMeasurementRuntime({ createCanvasContext: () => canvas });
      try {
        const source = freezeData(tableGrid(4, 2));
        const pass = runtime.beginPass(fontContext(), {
          throwIfAborted: () => {
            if (aborted) throw new Error('Native measurement canceled');
          },
        });
        try {
          await expect(pass.measureBlock(source, { maxWidth: 192 })).rejects.toThrow(
            kind === 'failed' ? 'Injected native metric failure' : 'Native measurement canceled',
          );
        } finally {
          pass.finish();
        }
        const discarded = completed.find((value) => value.rows.length === 4);
        expect(discarded).toBeDefined();
        fail = false;
        aborted = false;
        clearTableCellBlockMeasureCache();
        const edited = editCell(source, 2, 'Current authoritative native geometry');
        const next = await measure(runtime, edited, { block: source, measure: discarded! }, 192);
        expect(next.observation.cellBlockCache['retained-hit']).toBe(0);
        expect(next.measure.rows[0]).not.toBe(discarded!.rows[0]);
        clearTableCellBlockMeasureCache();
        expect(next.measure).toEqual((await measure(oracle, edited, undefined, 192)).measure);
      } finally {
        observation.mockRestore();
        runtime.dispose();
        oracle.dispose();
      }
    },
  );

  it('does not retain a disposed source table through its completed measurement certificate', async () => {
    const retained = await (async () => {
      const runtime = createDomMeasurementRuntime();
      const block = freezeData(tableGrid(2, 2));
      try {
        const completed = await measure(runtime, block);
        return { measure: completed.measure, source: new WeakRef(block), collectibleControl: new WeakRef({}) };
      } finally {
        runtime.dispose();
      }
    })();
    clearTableCellBlockMeasureCache();
    const session = new Session();
    session.connect();
    try {
      for (let turn = 0; turn < 5; turn += 1) {
        await setImmediate();
        await new Promise<void>((resolve, reject) => {
          session.post('HeapProfiler.collectGarbage', (error) => (error ? reject(error) : resolve()));
        });
      }
      expect(retained.collectibleControl.deref()).toBeUndefined();
      expect(retained.source.deref()).toBeUndefined();
      expect(retained.measure.rows).toHaveLength(2);
    } finally {
      session.disconnect();
    }
  });

  it('measures only the edited paragraph beyond the bounded cell cache and matches cold geometry across edits', async () => {
    const runtime = createDomMeasurementRuntime();
    const coldRuntime = createDomMeasurementRuntime();
    try {
      const original = freezeData(tableGrid());
      const initial = await measure(runtime, original);
      const edited = editCell(original, 123, 'Changed cell wraps onto another line after this edit');
      clearTableCellBlockMeasureCache();

      const firstEdit = await measure(runtime, edited, { block: original, measure: initial.measure });
      expect(firstEdit.observation.cellBlockCache.miss).toBe(1);
      expect(firstEdit.observation.cellBlockCache).toMatchObject({ 'retained-hit': 39 });
      expect(firstEdit.measure.rows[0]).toBe(initial.measure.rows[0]);
      expect(firstEdit.measure.rows[0]!.cells[0]!.blocks![0]).toBe(initial.measure.rows[0]!.cells[0]!.blocks![0]);
      expect(firstEdit.measure.rows[123]!.cells[0]!.blocks![0]).not.toBe(
        initial.measure.rows[123]!.cells[0]!.blocks![0],
      );
      clearTableCellBlockMeasureCache();
      expect(firstEdit.measure).toEqual((await measure(coldRuntime, edited)).measure);

      const editedAgain = editCell(edited, 124, 'Second edit');
      clearTableCellBlockMeasureCache();
      const secondEdit = await measure(runtime, editedAgain, { block: edited, measure: firstEdit.measure });
      expect(secondEdit.observation.cellBlockCache.miss).toBe(1);
      expect(secondEdit.observation.cellBlockCache).toMatchObject({ 'retained-hit': 39 });
      expect(secondEdit.measure.rows[0]).toBe(firstEdit.measure.rows[0]);
      clearTableCellBlockMeasureCache();
      expect(secondEdit.measure).toEqual((await measure(coldRuntime, editedAgain)).measure);
    } finally {
      runtime.dispose();
      coldRuntime.dispose();
    }
  });

  it.each(['font', 'runtime mode', 'foreign owner', 'forged measure', 'wrong block', 'explicit clear'] as const)(
    'declines retained geometry after a %s change',
    async (change) => {
      const runtime = createDomMeasurementRuntime();
      const secondRuntime = createDomMeasurementRuntime();
      try {
        const original = freezeData(tableGrid(2, 2));
        const initial = await measure(runtime, original, undefined, 192);
        clearTableCellBlockMeasureCache();
        if (change === 'runtime mode') configureMeasurement({ mode: 'deterministic' });
        if (change === 'explicit clear') clearTextMeasurementCaches();
        const result = await measure(
          change === 'foreign owner' ? secondRuntime : runtime,
          original,
          {
            block: change === 'wrong block' ? freezeData({ ...original }) : original,
            measure: change === 'forged measure' ? { ...initial.measure } : initial.measure,
          },
          192,
          fontContext(change === 'font' ? 'new-font-generation' : undefined),
        );
        expect(result.observation.cellBlockCache).toMatchObject({ 'retained-hit': 0, miss: 4 });
        clearTableCellBlockMeasureCache();
        expect(result.measure).toEqual(
          (
            await measure(
              secondRuntime,
              original,
              undefined,
              192,
              fontContext(change === 'font' ? 'new-font-generation' : undefined),
            )
          ).measure,
        );
      } finally {
        configureMeasurement({ mode: 'browser' });
        runtime.dispose();
        secondRuntime.dispose();
      }
    },
  );

  it('uses the current resolved cell width and current paragraph style', async () => {
    const runtime = createDomMeasurementRuntime();
    const coldRuntime = createDomMeasurementRuntime();
    try {
      const original = freezeData(tableGrid(2, 2));
      const initial = await measure(runtime, original, undefined, 192);
      const narrower = freezeData({ ...original, columnWidths: [48, 48] });
      clearTableCellBlockMeasureCache();
      const resized = await measure(runtime, narrower, { block: original, measure: initial.measure }, 96);
      expect(resized.observation.cellBlockCache).toMatchObject({ 'retained-hit': 0, miss: 4 });
      clearTableCellBlockMeasureCache();
      expect(resized.measure).toEqual((await measure(coldRuntime, narrower, undefined, 96)).measure);

      const styled = tableGrid(2, 2);
      styled.rows = [...original.rows];
      const row = original.rows[0]!;
      const paragraph = row.cells[0]!.blocks![0] as ParagraphBlock;
      styled.rows[0] = {
        ...row,
        cells: [
          { ...row.cells[0]!, blocks: [{ ...paragraph, attrs: { spacing: { line: 2, lineRule: 'auto' } } }] },
          row.cells[1]!,
        ],
      };
      freezeData(styled);
      clearTableCellBlockMeasureCache();
      const restyled = await measure(runtime, styled, { block: original, measure: initial.measure }, 192);
      expect(restyled.observation.cellBlockCache).toMatchObject({ 'retained-hit': 3, miss: 1 });
      clearTableCellBlockMeasureCache();
      expect(restyled.measure).toEqual((await measure(coldRuntime, styled, undefined, 192)).measure);
    } finally {
      runtime.dispose();
      coldRuntime.dispose();
    }
  });

  it.each(['mutable child', 'frozen getter'] as const)('does not attest a %s as immutable input', async (kind) => {
    const runtime = createDomMeasurementRuntime();
    try {
      const original = tableGrid(2, 2);
      const paragraph = original.rows[0]!.cells[0]!.blocks![0] as ParagraphBlock;
      let text = 'Original';
      if (kind === 'frozen getter') {
        Object.defineProperty(paragraph.runs[0], 'text', { enumerable: true, get: () => text });
        freezeData(original);
      } else {
        Object.freeze(original);
      }
      const initial = await measure(runtime, original, undefined, 192);
      text = 'Changed content that wraps';
      if (kind === 'mutable child') (paragraph.runs[0] as { text: string }).text = text;
      clearTableCellBlockMeasureCache();
      const result = await measure(runtime, original, { block: original, measure: initial.measure }, 192);
      expect(result.observation.cellBlockCache).toMatchObject({ 'retained-hit': 0, miss: 4 });
      expect(result.measure.rows[0]!.cells[0]!.blocks![0]).not.toEqual(initial.measure.rows[0]!.cells[0]!.blocks![0]);
    } finally {
      runtime.dispose();
    }
  });

  it('keeps nested table and row-span geometry equal to cold measurement', async () => {
    const runtime = createDomMeasurementRuntime();
    const coldRuntime = createDomMeasurementRuntime();
    try {
      const nested = tableGrid(3, 2);
      nested.id = 'nested-table';
      nested.rows[0]!.cells[0]!.rowSpan = 2;
      nested.rows[1]!.cells = nested.rows[1]!.cells.slice(1);
      const outer = tableGrid(1, 1);
      outer.columnWidths = [200];
      outer.rows[0]!.cells[0]!.blocks = [nested];
      freezeData(outer);
      const initial = await measure(runtime, outer, undefined, 200);
      const editedNested = editCell(nested, 2, 'Nested text grows across multiple wrapped lines');
      const editedOuter = freezeData({
        ...outer,
        rows: [{ ...outer.rows[0]!, cells: [{ ...outer.rows[0]!.cells[0]!, blocks: [editedNested] }] }],
      });
      clearTableCellBlockMeasureCache();
      const edited = await measure(runtime, editedOuter, { block: outer, measure: initial.measure }, 200);
      const previousNestedMeasure = initial.measure.rows[0]!.cells[0]!.blocks![0] as TableMeasure;
      const nextNestedMeasure = edited.measure.rows[0]!.cells[0]!.blocks![0] as TableMeasure;
      expect(nextNestedMeasure.rows[0]!.cells[0]!.blocks![0]).toBe(previousNestedMeasure.rows[0]!.cells[0]!.blocks![0]);
      clearTableCellBlockMeasureCache();
      expect(edited.measure).toEqual((await measure(coldRuntime, editedOuter, undefined, 200)).measure);
    } finally {
      runtime.dispose();
      coldRuntime.dispose();
    }
  });

  it('remains cooperatively cancellable while reusing retained paragraphs', async () => {
    const runtime = createDomMeasurementRuntime();
    try {
      const original = freezeData(tableGrid(128, 2));
      const initial = await measure(runtime, original, undefined, 192);
      clearTableCellBlockMeasureCache();
      const cancelled = new Error('retained table cancelled');
      let checkpoints = 0;
      const pass = runtime.beginPass(fontContext(), {
        checkpointIfDue: () => (++checkpoints === 3 ? Promise.reject(cancelled) : null),
      });
      try {
        await expect(
          pass.measureBlock(original, {
            maxWidth: 192,
            retainedTable: { block: original, measure: initial.measure },
          }),
        ).rejects.toBe(cancelled);
        expect(checkpoints).toBe(3);
      } finally {
        pass.finish();
      }
      const continued = await measure(runtime, original, { block: original, measure: initial.measure }, 192);
      expect(continued.observation.cellBlockCache).toMatchObject({ 'retained-hit': 0, miss: 0 });
      expect(continued.measure.rows[0]).toBe(initial.measure.rows[0]);
      expect(continued.measure).toEqual(initial.measure);
    } finally {
      runtime.dispose();
    }
  });

  it('does not attest inputs that become frozen during asynchronous measurement', async () => {
    const runtime = createDomMeasurementRuntime();
    try {
      const original = tableGrid(1, 1);
      const cell = original.rows[0]!.cells[0]!;
      Object.freeze(cell.blocks);
      Object.freeze(cell);
      Object.freeze(original.rows[0]!.cells);
      Object.freeze(original.rows[0]);
      Object.freeze(original.rows);
      freezeData(original.attrs);
      freezeData(original.columnWidths);
      Object.freeze(original);
      let checkpoints = 0;
      const pass = runtime.beginPass(fontContext(), {
        checkpointIfDue: () =>
          ++checkpoints === 2
            ? Promise.resolve().then(() => {
                freezeData(original);
              })
            : null,
      });
      let initial: TableMeasure;
      try {
        initial = (await pass.measureBlock(original, 96)) as TableMeasure;
      } finally {
        pass.finish();
      }
      clearTableCellBlockMeasureCache();
      const after = await measure(runtime, original, { block: original, measure: initial }, 96);
      expect(after.observation.cellBlockCache).toMatchObject({ 'retained-hit': 0, miss: 1 });
      expect(after.measure).toEqual(initial);
    } finally {
      runtime.dispose();
    }
  });
});

it('consumes the canonical paragraph replacement for fixed-table growth and shrink with cold parity', async () => {
  configureMeasurement({ mode: 'deterministic' });
  const runtime = createDomMeasurementRuntime();
  const coldRuntime = createDomMeasurementRuntime();
  try {
    let block = freezeData(tableGrid(251, 2));
    let previous = await measure(runtime, block, undefined, 192);
    for (const text of ['long wrapped text '.repeat(30), 'short']) {
      const current = editCell(block, 120, text);
      const next = await measure(
        runtime,
        current,
        {
          block,
          measure: previous.measure,
          paragraphReplacement: { current, rowIndex: 120, cellIndex: 0, blockIndex: 0 },
        },
        192,
      );
      const cold = await measure(coldRuntime, current, undefined, 192);
      expect(next.measure).toEqual(cold.measure);
      expect(next.observation.reusedGrid).toBe(true);
      expect(next.observation.measuredRowCount).toBe(2);
      expect(next.measure.rows[119]).toBe(previous.measure.rows[119]);
      expect(next.measure.rows[122]).toBe(previous.measure.rows[122]);
      expect(next.measure.rows[120]!.height).not.toBe(previous.measure.rows[120]!.height);
      block = current;
      previous = next;
    }
    const changedWidth = freezeData({ ...editCell(block, 120, 'new'), columnWidths: [80, 112] });
    const rejected = await measure(
      runtime,
      changedWidth,
      {
        block,
        measure: previous.measure,
        paragraphReplacement: { current: changedWidth, rowIndex: 120, cellIndex: 0, blockIndex: 0 },
      },
      192,
    );
    expect(rejected.observation.reusedGrid).toBe(false);
    expect(rejected.measure).toEqual((await measure(coldRuntime, changedWidth, undefined, 192)).measure);
  } finally {
    runtime.dispose();
    coldRuntime.dispose();
  }
});
