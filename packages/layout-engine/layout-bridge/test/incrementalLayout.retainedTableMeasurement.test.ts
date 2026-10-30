// @vitest-environment jsdom
import '../../measuring/dom/vitest.setup';
import { describe, expect, it, vi } from 'vite-plus/test';
import type {
  FlowBlock,
  Measure,
  ParagraphBlock,
  ParagraphMeasure,
  TableBlock,
  TableMeasure,
} from '@superdoc/contracts';
import {
  createDomMeasurementRuntime,
  readTableMeasurementClosure,
  type TableMeasurementObservation,
} from '@superdoc/measuring-dom';
import { computeDirtyRegions } from '../src/diff.js';
import { analyzeTableLayoutLocality } from '../src/table-layout-locality.js';
import { clearIncrementalModuleState, incrementalLayout, type IncrementalMeasureReuseProof } from '../src/index.js';
import { measureCache } from '../src/incrementalLayout.js';
import { resolveCanvas } from '../../measuring/dom/src/canvas-resolver.js';
import { resolveParagraphContent } from '../../layout-resolved/src/resolveParagraph.js';
import {
  createListMarkerElement,
  resolvePainterListMarkerGeometry,
} from '../../painters/dom/src/paragraph/list-marker.js';

function freezeData<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if ('value' in descriptor) freezeData(descriptor.value);
    }
    Object.freeze(value);
  }
  return value;
}

it('carries the canonical paragraph proof through changing-height measurement and table pagination locality', async () => {
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
                      runs: [
                        {
                          ...paragraph.runs[0],
                          text: 'An edited cell that wraps onto more than one line',
                        },
                      ],
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
          ...(constraints.retainedTable
            ? {
                retainedTable: {
                  ...constraints.retainedTable,
                  paragraphReplacement: {
                    current: edited,
                    rowIndex: 2,
                    cellIndex: 0,
                    blockIndex: 0,
                  },
                },
              }
            : {}),
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
    expect(observation?.reusedGrid).toBe(true);
    expect(observation?.measuredRowCount).toBe(2);
    const closureInput = {
      previousBlock: original,
      currentBlock: edited,
      previousMeasure: previousTable,
      currentMeasure: currentTable,
    };
    expect(readTableMeasurementClosure(closureInput)).toEqual({
      firstAffectedRow: 2,
      lastAffectedRowExclusive: 4,
    });
    expect(analyzeTableLayoutLocality(closureInput)).toMatchObject({
      currentFirstAffectedRow: 2,
      currentLastAffectedRowExclusive: 4,
      stableSuffixRowStart: 4,
    });
    expect(readTableMeasurementClosure({ ...closureInput, currentBlock: { ...edited } })).toBeNull();
    expect(readTableMeasurementClosure({ ...closureInput, previousMeasure: { ...previousTable } })).toBeNull();
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
    const fonts = {
      fontSignature: 'prepared-table-v1',
      resolvePhysical: (family: string) => family,
    };
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

describe('native table marker cache geometry', () => {
  const fonts = {
    fontSignature: 'native-marker-table',
    resolvePhysical: (family: string) => family,
  };
  const options = {
    pageSize: { w: 240, h: 140 },
    margins: { top: 10, right: 10, bottom: 10, left: 10 },
  };
  const paragraph = (markerText: string): ParagraphBlock => ({
    kind: 'paragraph',
    id: 'native-marker-owner',
    runs: [
      {
        text: 'Follower text wraps inside a narrow table cell with unchanged content.',
        fontFamily: 'Arial',
        fontSize: 16,
      },
    ],
    attrs: {
      wordLayout: {
        marker: {
          markerText,
          suffix: 'space',
          justification: 'left',
          run: { fontFamily: 'Arial', fontSize: 16 },
          trackedChange: { id: 'marker-format', kind: 'format', author: 'Reviewer' },
        },
      },
    },
  });
  const table = (markerText: string, shape: 'modern' | 'legacy' | 'nested'): TableBlock => {
    const inner: TableBlock = {
      kind: 'table',
      id: 'native-marker-table',
      attrs: { tableLayout: 'fixed' },
      columnWidths: [200],
      rows: [
        {
          id: 'row',
          cells: [
            {
              id: 'cell',
              ...(shape === 'legacy' ? { paragraph: paragraph(markerText) } : { blocks: [paragraph(markerText)] }),
            },
          ],
        },
      ],
    };
    return freezeData(
      shape === 'nested'
        ? {
            kind: 'table',
            id: 'native-outer-table',
            attrs: { tableLayout: 'fixed' },
            columnWidths: [200],
            rows: [{ id: 'outer-row', cells: [{ id: 'outer-cell', blocks: [inner] }] }],
          }
        : inner,
    );
  };
  const readParagraph = (measure: Measure): ParagraphMeasure => {
    if (measure.kind === 'paragraph') return measure;
    if (measure.kind !== 'table') throw new Error('Expected table measure');
    const cell = measure.rows[0]!.cells[0]!;
    return readParagraph(cell.blocks?.[0] ?? cell.paragraph!);
  };
  const resolveAndPaint = (block: ParagraphBlock, measure: ParagraphMeasure) => {
    const resolved = resolveParagraphContent(
      {
        kind: 'para',
        blockId: block.id,
        x: 0,
        y: 0,
        width: measure.measuredAtMaxWidth!,
        fromLine: 0,
        toLine: measure.lines.length,
        markerWidth: measure.marker!.markerWidth,
        markerTextWidth: measure.marker!.markerTextWidth,
      },
      block,
      measure,
    );
    const marker = resolved.marker!;
    const element = createListMarkerElement(
      document,
      marker.text,
      marker.run,
      marker.sourceAnchor,
      fonts.resolvePhysical,
      marker.trackedChange,
    );
    const geometry = resolvePainterListMarkerGeometry({
      wordLayout: block.attrs!.wordLayout,
      indentLeftPx: 0,
      hangingIndentPx: 0,
      firstLineIndentPx: 0,
      markerTextWidthPx: measure.marker!.markerTextWidth,
    })!;
    expect(element.textContent).toBe(block.attrs!.wordLayout!.marker!.markerText);
    const glyph = element.querySelector<HTMLElement>('.superdoc-paragraph-marker')!;
    expect(glyph.dataset.trackChangeId).toBe('marker-format');
    expect(glyph.style.textTransform).toBe('');
    expect(geometry.textStartPx).toBeGreaterThanOrEqual(geometry.markerStartPx + geometry.markerTextWidthPx);
    expect(geometry.suffixWidthPx).toBe(marker.suffixWidthPx);
    expect(geometry.markerStartPx).toBe(marker.markerStartPx);
    expect(measure.lines[0]!.maxWidth).toBeCloseTo(measure.measuredAtMaxWidth! - geometry.textStartPx, 3);
    return { resolved, geometry, html: element.outerHTML };
  };

  describe.each(['modern', 'legacy', 'nested'] as const)('%s cells', (shape) => {
    it.each([
      ['historical half', '1.3→1.2', '1.44→1.2'],
      ['history removal', '1.3→1.2', '1.2'],
      ['history appearance', '1.2', '1.3→1.2'],
      ['current half', '1.3→1.2', '1.3→1.22'],
      ['independently prepared case', 'b.→A.', 'B.→A.'],
    ])('matches cold native measure, pagination and paint after changing %s', async (_name, before, after) => {
      expect(resolveCanvas().usingStub).toBe(false);
      clearIncrementalModuleState();
      const runtime = createDomMeasurementRuntime();
      const coldRuntime = createDomMeasurementRuntime();
      const measure = vi.fn();
      const run = async (
        activeRuntime: typeof runtime,
        previous: FlowBlock[],
        previousResult: Awaited<ReturnType<typeof incrementalLayout>> | null,
        next: FlowBlock[],
      ) => {
        const pass = activeRuntime.beginPass(fonts);
        measure.mockImplementation(pass.measureBlock);
        try {
          return await incrementalLayout(
            previous,
            previousResult?.layout ?? null,
            next,
            options,
            measure,
            undefined,
            previousResult?.measures,
            {
              fontContext: fonts,
              previousFontSignature: fonts.fontSignature,
              fontCapabilities: pass.fontCapabilities,
            },
          );
        } finally {
          pass.finish();
        }
      };
      try {
        const previous = [table(before, shape)];
        const next = [table(after, shape)];
        const initial = await run(runtime, [], null, previous);
        const equal = await run(runtime, [], null, structuredClone(previous));
        expect(equal.measures[0]).toBe(initial.measures[0]);
        expect(measure).toHaveBeenCalledTimes(1);
        const initialParagraph = readParagraph(initial.measures[0]!);
        expect(initialParagraph.marker!.markerTextWidth).toBeGreaterThan(0);
        const warm = await run(runtime, previous, initial, next);
        clearIncrementalModuleState();
        const cold = await run(coldRuntime, [], null, next);
        const warmParagraph = readParagraph(warm.measures[0]!);
        const coldParagraph = readParagraph(cold.measures[0]!);
        expect(coldParagraph.marker!.markerTextWidth).not.toBe(initialParagraph.marker!.markerTextWidth);
        expect(coldParagraph.lines[0]!.maxWidth).not.toBe(initialParagraph.lines[0]!.maxWidth);
        expect(coldParagraph.totalHeight).toBeGreaterThan(0);
        expect(warmParagraph).toEqual(coldParagraph);
        expect(warm.measures).toEqual(cold.measures);
        expect(warm.layout.pages).toEqual(cold.layout.pages);
        expect(measure).toHaveBeenCalledTimes(3);
        expect(resolveAndPaint(paragraph(after), warmParagraph)).toEqual(
          resolveAndPaint(paragraph(after), coldParagraph),
        );
      } finally {
        runtime.dispose();
        coldRuntime.dispose();
        clearIncrementalModuleState();
      }
    });
  });
});
