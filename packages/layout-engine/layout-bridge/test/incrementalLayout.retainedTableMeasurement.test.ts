// @vitest-environment jsdom
import { expect, it } from 'vite-plus/test';
import type { FlowBlock, ParagraphBlock, TableBlock, TableMeasure } from '@superdoc/contracts';
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

it('carries retained row and cell measurements through the bridge to the surface runtime', async () => {
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
    expect(observation?.cellBlockCache.miss).toBe(1);
    const previousTable = initial.measures[0] as TableMeasure;
    const currentTable = result.measures[0] as TableMeasure;
    expect(currentTable.rows[2]).not.toBe(previousTable.rows[2]);
    for (const row of [0, 1, 4, 5]) {
      expect(currentTable.rows[row]).toBe(previousTable.rows[row]);
    }
    // The following row may refresh border context while retaining its unchanged paragraph geometry.
    expect(currentTable.rows[3]!.cells[0]!.blocks![0]).toBe(previousTable.rows[3]!.cells[0]!.blocks![0]);

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

it.each([
  'unchanged inputs',
  'changed width',
  'replaced block',
  'mutated child',
  'changed font',
  'missing proof',
] as const)(
  'preserves current table measurement and cold parity without redundant admission for %s',
  async (scenario) => {
    clearIncrementalModuleState();
    const runtime = createDomMeasurementRuntime();
    const coldRuntime = createDomMeasurementRuntime();
    const fonts = { fontSignature: 'prepared-table-v1', resolvePhysical: (family: string) => family };
    const fontCapabilities = { hasTabularDigits: () => false };
    const options = {
      pageSize: { w: 240, h: 140 },
      margins: { top: 10, right: 10, bottom: 10, left: 10 },
    };
    let observePostMeasure = false;
    let postMeasureRowReads = 0;
    const table = (text: string): TableBlock => ({
      kind: 'table',
      id: 'prepared-table',
      attrs: { tableLayout: 'fixed' },
      columnWidths: [200],
      rows: new Proxy(
        Array.from({ length: 6 }, (_, row) => ({
          id: `row-${row}`,
          cells: [
            {
              id: `cell-${row}`,
              blocks: [
                {
                  kind: 'paragraph' as const,
                  id: `paragraph-${row}`,
                  runs: [{ text: row === 2 ? text : `Cell ${row}`, fontFamily: 'Arial', fontSize: 12 }],
                },
              ],
            },
          ],
        })),
        {
          get(rows, property, receiver) {
            if (observePostMeasure && typeof property === 'string' && /^(0|[1-9]\d*)$/.test(property)) {
              postMeasureRowReads += 1;
            }
            return Reflect.get(rows, property, receiver);
          },
        },
      ),
    });
    const original = table('Before');
    const edited = table('After');
    const replacement = table('Replacement');
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
      expect(measureCache.get(original, 220, 120, fonts.fontSignature, fontCapabilities)).toBe(initial.measures[0]);

      const currentFonts = scenario === 'changed font' ? { ...fonts, fontSignature: 'prepared-table-v2' } : fonts;
      const editPass = runtime.beginPass(currentFonts);
      let changed = false;
      let measuredCount = 0;
      let returnedMeasurement: Awaited<ReturnType<typeof editPass.measureBlock>> | undefined;
      const result = await incrementalLayout(
        [original],
        initial.layout,
        nextBlocks,
        options,
        async (block, measuredConstraints) => {
          measuredCount += 1;
          returnedMeasurement = await editPass.measureBlock(block, measuredConstraints);
          observePostMeasure = true;
          return returnedMeasurement;
        },
        undefined,
        initial.measures,
        { fontContext: currentFonts, previousFontSignature: fonts.fontSignature, fontCapabilities },
        undefined,
        undefined,
        scenario === 'missing proof' ? undefined : proof,
        {
          checkpointIfDue: (checkpoint) => {
            // The existing phase checkpoint ends the cache-admission interval;
            // subsequent pagination is allowed to read the current table rows.
            if (checkpoint == null) observePostMeasure = false;
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
      observePostMeasure = false;
      expect(measuredCount).toBe(1);
      expect(result.measures[0]).toBe(returnedMeasurement);
      expect(postMeasureRowReads).toBe(0);

      const usesProof = scenario !== 'changed font' && scenario !== 'missing proof';
      if (usesProof) {
        expect(result.measureReuse?.mode).toBe('proved-dirty-only');
        expect(result.bridgeTiming.counters.bodyMeasureCacheWrites).toBe(0);
        expect(result.bridgeTiming.counters.bodyMeasureCacheKeyComputations).toBe(0);
        expect(
          measureCache.get(
            nextBlocks[0],
            constraints.maxWidth,
            constraints.maxHeight,
            currentFonts.fontSignature,
            fontCapabilities,
          ),
        ).toBeUndefined();
      } else {
        expect(result.measureReuse?.mode).not.toBe('proved-dirty-only');
        expect(result.bridgeTiming.counters.bodyMeasureCacheWrites).toBe(1);
        expect(measureCache.get(nextBlocks[0], 220, 120, currentFonts.fontSignature, fontCapabilities)).toBe(
          result.measures[0],
        );
      }
      if (scenario !== 'unchanged inputs' && scenario !== 'missing proof') {
        expect(measureCache.get(edited, 220, 120, fonts.fontSignature, fontCapabilities)).toBeUndefined();
      }

      if (scenario === 'unchanged inputs') {
        const fallbackPass = runtime.beginPass(currentFonts);
        let fallbackMeasurements = 0;
        const fallback = await incrementalLayout(
          [nextBlocks[0]!],
          result.layout,
          nextBlocks,
          options,
          (block, fallbackConstraints) => {
            fallbackMeasurements += 1;
            return fallbackPass.measureBlock(block, fallbackConstraints);
          },
          undefined,
          undefined,
          { fontContext: currentFonts, fontCapabilities },
        );
        fallbackPass.finish();
        expect(fallbackMeasurements).toBe(1);
        expect(fallback.measures).toEqual(result.measures);
        expect(fallback.layout).toEqual(result.layout);
        expect(measureCache.get(nextBlocks[0], 220, 120, currentFonts.fontSignature, fontCapabilities)).toBe(
          fallback.measures[0],
        );
      }

      clearIncrementalModuleState();
      const coldPass = coldRuntime.beginPass(currentFonts);
      const cold = await incrementalLayout(
        [],
        null,
        nextBlocks,
        options,
        (block, coldConstraints) => coldPass.measureBlock(block, { ...coldConstraints, ...constraints }),
        undefined,
        undefined,
        { fontContext: currentFonts, fontCapabilities },
      );
      coldPass.finish();
      expect(result.measures).toEqual(cold.measures);
      expect(result.layout).toEqual(cold.layout);
    } finally {
      observePostMeasure = false;
      runtime.dispose();
      coldRuntime.dispose();
      clearIncrementalModuleState();
    }
  },
);
