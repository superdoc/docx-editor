// @vitest-environment jsdom
import { expect, it, vi } from 'vite-plus/test';
import type { FlowBlock, ParagraphBlock, TableBlock } from '@superdoc/contracts';
import { createDomMeasurementRuntime, type TableMeasurementObservation } from '@superdoc/measuring-dom';
import { computeDirtyRegions } from '../src/diff.js';
import { clearIncrementalModuleState, incrementalLayout, type IncrementalMeasureReuseProof } from '../src/index.js';
import { measureCache } from '../src/incrementalLayout.js';

function freezeData<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if ('value' in descriptor) freezeData(descriptor.value);
    }
    Object.freeze(value);
  }
  return value;
}

it('carries retained cell measurements through the bridge to the surface runtime', async () => {
  clearIncrementalModuleState();
  const runtime = createDomMeasurementRuntime();
  const coldRuntime = createDomMeasurementRuntime();
  const fonts = { fontSignature: 'table-integration', resolvePhysical: (family: string) => family };
  const options = {
    pageSize: { w: 240, h: 140 },
    margins: { top: 10, right: 10, bottom: 10, left: 10 },
  };
  const original: TableBlock = freezeData({
    kind: 'table',
    id: 'table',
    attrs: { tableLayout: 'fixed' },
    columnWidths: [200],
    rows: Array.from({ length: 6 }, (_, row) => ({
      id: `row-${row}`,
      cells: [
        {
          id: `cell-${row}`,
          blocks: [
            {
              kind: 'paragraph',
              id: `paragraph-${row}`,
              runs: [{ text: `Cell ${row}`, fontFamily: 'Arial', fontSize: 12 }],
            },
          ],
        },
      ],
    })),
  });
  try {
    const initialPass = runtime.beginPass(fonts);
    const initial = await incrementalLayout(
      [],
      null,
      [original],
      options,
      initialPass.measureBlock,
      undefined,
      undefined,
      { fontContext: fonts },
    );
    initialPass.finish();

    const changedRow = original.rows[2]!;
    const changedCell = changedRow.cells[0]!;
    const paragraph = changedCell.blocks![0] as ParagraphBlock;
    const edited: TableBlock = freezeData({
      ...original,
      rows: original.rows.map((row, index) =>
        index !== 2
          ? row
          : {
              ...changedRow,
              cells: [
                {
                  ...changedCell,
                  blocks: [
                    {
                      ...paragraph,
                      runs: [{ ...paragraph.runs[0], text: 'An edited cell that wraps onto more than one line' }],
                    },
                  ],
                },
              ],
            },
      ),
    });
    const proof: IncrementalMeasureReuseProof = {
      dependencyProof: {
        profile: 'page-checkpoint-local-text',
        blockIdsUnchanged: true,
        blockIdsUnique: true,
        globalDependenciesAbsent: false,
        globalDependenciesFencedByPageCheckpoint: true,
        admittedDependencyClasses: ['tables'],
        renderInputsUnchanged: true,
        pageReferencesAbsent: true,
        multiColumnSectionsProvedNonBalanceable: true,
      },
      provedDirtyRegion: computeDirtyRegions([original], [edited]),
      previousBlockIndexById: new Map([['table', 0]]),
      currentBlockIndexById: new Map([['table', 0]]),
      provedDirtyMeasureConstraints: new Map([['table', { maxWidth: 220, maxHeight: 120 }]]),
    };
    let observation: TableMeasurementObservation | undefined;
    const editPass = runtime.beginPass(fonts);
    const result = await incrementalLayout(
      [original],
      initial.layout,
      [edited],
      options,
      (block, constraints) =>
        editPass.measureBlock(block, {
          ...constraints,
          tableMeasurementTrace: {
            depth: 0,
            cacheIdentity: 'strict',
            observer: (value) => {
              observation = value;
            },
          },
        }),
      undefined,
      initial.measures,
      { fontContext: fonts, previousFontSignature: fonts.fontSignature },
      undefined,
      undefined,
      proof,
    );
    editPass.finish();

    expect(result.measureReuse?.mode).toBe('proved-dirty-only');
    expect(observation?.cellBlockCache).toMatchObject({ 'retained-hit': 5, miss: 1 });

    clearIncrementalModuleState();
    const coldPass = coldRuntime.beginPass(fonts);
    const cold = await incrementalLayout([], null, [edited], options, coldPass.measureBlock, undefined, undefined, {
      fontContext: fonts,
    });
    coldPass.finish();
    expect(result.measures).toEqual(cold.measures);
    expect(result.layout).toEqual(cold.layout);
  } finally {
    runtime.dispose();
    coldRuntime.dispose();
    clearIncrementalModuleState();
  }
});

it.each(['unchanged inputs', 'changed width', 'replaced block', 'mutated child', 'changed font'] as const)(
  'hashes the measured table after the callback with %s',
  async (scenario) => {
    clearIncrementalModuleState();
    const runtime = createDomMeasurementRuntime();
    const fonts = { fontSignature: 'prepared-table-v1', resolvePhysical: (family: string) => family };
    const fontCapabilities = { hasTabularDigits: () => false };
    const options = {
      pageSize: { w: 240, h: 140 },
      margins: { top: 10, right: 10, bottom: 10, left: 10 },
    };
    const table = (text: string): TableBlock => ({
      kind: 'table',
      id: 'prepared-table',
      attrs: { tableLayout: 'fixed' },
      columnWidths: [200],
      rows: Array.from({ length: 6 }, (_, row) => ({
        id: `row-${row}`,
        cells: [
          {
            id: `cell-${row}`,
            blocks: [
              {
                kind: 'paragraph',
                id: `paragraph-${row}`,
                runs: [{ text: row === 2 ? text : `Cell ${row}`, fontFamily: 'Arial', fontSize: 12 }],
              },
            ],
          },
        ],
      })),
    });
    const original = table('Before');
    const edited = table('After');
    const replacement = table('Replacement');
    let observeTraversal = false;
    let currentKeyTraversals = 0;
    let previousKeyTraversals = 0;
    original.rows = new Proxy(original.rows, {
      get(rows, key, receiver) {
        if (key === Symbol.iterator)
          return function* () {
            if (observeTraversal) previousKeyTraversals += 1;
            yield* rows;
          };
        return Reflect.get(rows, key, receiver);
      },
    });
    edited.rows = new Proxy(edited.rows, {
      get(rows, key, receiver) {
        if (key === Symbol.iterator)
          return function* () {
            if (observeTraversal) currentKeyTraversals += 1;
            yield* rows;
          };
        return Reflect.get(rows, key, receiver);
      },
    });
    const nextBlocks: FlowBlock[] = [edited];
    const constraints = { maxWidth: 220, maxHeight: 120 };
    const proof: IncrementalMeasureReuseProof = {
      dependencyProof: {
        profile: 'page-checkpoint-local-text',
        blockIdsUnchanged: true,
        blockIdsUnique: true,
        globalDependenciesAbsent: false,
        globalDependenciesFencedByPageCheckpoint: true,
        admittedDependencyClasses: ['tables'],
        renderInputsUnchanged: true,
        pageReferencesAbsent: true,
        multiColumnSectionsProvedNonBalanceable: true,
      },
      provedDirtyRegion: computeDirtyRegions([original], nextBlocks),
      previousBlockIndexById: new Map([['prepared-table', 0]]),
      currentBlockIndexById: new Map([['prepared-table', 0]]),
      provedDirtyMeasureConstraints: new Map([['prepared-table', constraints]]),
    };
    let keyTraversalsAtInsertion = -1;
    const setPrepared = measureCache.setPrepared;
    const observation = vi.spyOn(measureCache, 'setPrepared').mockImplementation(function (key, blockId, value) {
      if (observeTraversal && blockId === edited.id) {
        keyTraversalsAtInsertion = currentKeyTraversals;
        observeTraversal = false;
      }
      return setPrepared.call(this, key, blockId, value);
    });
    try {
      const initialPass = runtime.beginPass(fonts);
      const initial = await incrementalLayout(
        [],
        null,
        [original],
        options,
        initialPass.measureBlock,
        undefined,
        undefined,
        { fontContext: fonts, fontCapabilities },
      );
      initialPass.finish();
      const currentFonts = scenario === 'changed font' ? { ...fonts, fontSignature: 'prepared-table-v2' } : fonts;
      const editPass = runtime.beginPass(currentFonts);
      let changed = false;
      const measure = vi.fn(async (block, measuredConstraints) => {
        observeTraversal = false;
        try {
          return await editPass.measureBlock(block, measuredConstraints);
        } finally {
          observeTraversal = true;
        }
      });
      observeTraversal = true;
      const result = await incrementalLayout(
        [original],
        initial.layout,
        nextBlocks,
        options,
        measure,
        undefined,
        initial.measures,
        { fontContext: currentFonts, previousFontSignature: fonts.fontSignature, fontCapabilities },
        undefined,
        undefined,
        proof,
        {
          checkpointIfDue: (checkpoint) => {
            if (!changed && checkpoint?.phase === 'measure:block') {
              changed = true;
              if (scenario === 'changed width') constraints.maxWidth = 180;
              if (scenario === 'replaced block') nextBlocks[0] = replacement;
              if (scenario === 'mutated child') {
                (edited.rows[2]!.cells[0]!.blocks![0] as ParagraphBlock).runs[0]!.text = 'Mutated in place';
              }
            }
            return null;
          },
        },
      );
      editPass.finish();
      observeTraversal = false;
      expect(measure).toHaveBeenCalledTimes(1);
      const measuredBlock = nextBlocks[0]!;
      expect(
        measureCache.get(
          measuredBlock,
          constraints.maxWidth,
          constraints.maxHeight,
          currentFonts.fontSignature,
          fontCapabilities,
        ),
      ).toBe(result.measures[0]);
      if (scenario === 'unchanged inputs') {
        expect(result.measureReuse?.mode).toBe('proved-dirty-only');
        expect(keyTraversalsAtInsertion).toBe(1);
        expect(previousKeyTraversals).toBe(0);
      } else if (scenario === 'changed width') {
        expect(measureCache.get(edited, 220, 120, fonts.fontSignature, fontCapabilities)).toBeUndefined();
      } else if (scenario === 'replaced block') {
        expect(measureCache.get(edited, 220, 120, fonts.fontSignature, fontCapabilities)).toBeUndefined();
      } else if (scenario === 'mutated child') {
        expect(measureCache.get(table('After'), 220, 120, fonts.fontSignature, fontCapabilities)).toBeUndefined();
      } else {
        expect(measureCache.get(edited, 220, 120, fonts.fontSignature, fontCapabilities)).toBeUndefined();
      }
    } finally {
      observation.mockRestore();
      runtime.dispose();
      clearIncrementalModuleState();
    }
  },
);
