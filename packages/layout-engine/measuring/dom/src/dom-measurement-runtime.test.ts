import { describe, expect, it, vi } from 'vite-plus/test';
import type { FlowBlock } from '@superdoc/contracts';
import type { FontMeasureContext } from '@superdoc/font-system';
import { createDomMeasurementRuntime, measureBlock } from './index.js';
import { TextWidthMeasurementCache } from './measurementCache.js';

function fakeContext(onMeasure?: () => void): CanvasRenderingContext2D {
  return {
    font: '',
    measureText(text: string) {
      onMeasure?.();
      return { width: text.length + 1 } as TextMetrics;
    },
  } as unknown as CanvasRenderingContext2D;
}

it('keeps settled native table metrics owned by their surface with the same font generation', async () => {
  const context = (width: number) =>
    ({
      font: '',
      measureText: (text: string) =>
        ({
          width: text.length * width,
          actualBoundingBoxAscent: 12,
          actualBoundingBoxDescent: 3,
        }) as TextMetrics,
    }) as unknown as CanvasRenderingContext2D;
  const table: FlowBlock = {
    kind: 'table',
    id: 'surface-owned-native-table',
    attrs: { tableLayout: 'fixed' },
    columnWidths: [120],
    rows: [
      {
        id: 'surface-owned-row',
        cells: [
          {
            id: 'surface-owned-cell',
            blocks: [
              {
                kind: 'paragraph',
                id: 'surface-owned-paragraph',
                runs: [{ text: 'alpha beta gamma delta epsilon', fontFamily: 'Browser Font', fontSize: 16 }],
              },
            ],
          },
        ],
      },
    ],
  };
  const first = createDomMeasurementRuntime({
    createCanvasContext: () => context(2),
    flushTextMetrics: () => null,
    provisionalTextMetrics: () => 0,
  });
  const second = createDomMeasurementRuntime({
    createCanvasContext: () => context(12),
    flushTextMetrics: () => null,
    provisionalTextMetrics: () => 0,
  });
  const oracle = createDomMeasurementRuntime({ createCanvasContext: () => context(12) });
  const measure = async (runtime: ReturnType<typeof createDomMeasurementRuntime>, signature: string) => {
    const pass = runtime.beginPass(fontContext(signature));
    try {
      return await pass.measureBlock(table, 120);
    } finally {
      pass.finish();
    }
  };
  try {
    const narrow = await measure(first, 'shared-native-generation');
    const wide = await measure(second, 'shared-native-generation');
    const expected = await measure(oracle, 'independent-native-oracle');
    expect(wide).toEqual(expected);
    expect(wide).not.toEqual(narrow);
    expect(await measure(second, 'shared-native-generation')).toEqual(expected);
  } finally {
    first.dispose();
    second.dispose();
    oracle.dispose();
  }
});

const fontContext = (fontSignature: string): FontMeasureContext => ({
  fontSignature,
  resolvePhysical: (family) => family,
});

const legalProse = Array.from({ length: 180 }, (_, index) => `(${index % 20}) covenant`).join(' ');

const legalParagraph = (): FlowBlock => ({
  kind: 'paragraph',
  id: 'legal-prose',
  runs: [
    {
      text: legalProse,
      fontFamily: 'Arial',
      fontSize: 16,
    },
  ],
  attrs: {},
});

describe('surface-owned DOM measurement runtime', () => {
  it('settles browser font metrics before returning a measured block', async () => {
    let exact = false,
      pending = false;
    const context = {
      font: '',
      measureText(text: string) {
        if (!exact) pending = true;
        return {
          width: text.length * (exact ? 9 : 2),
          actualBoundingBoxAscent: 12,
          actualBoundingBoxDescent: 3,
        } as TextMetrics;
      },
    } as unknown as CanvasRenderingContext2D;
    const flushTextMetrics = vi.fn(() =>
      pending
        ? Promise.resolve().then(() => {
            exact = true;
            pending = false;
          })
        : null,
    );
    const runtime = createDomMeasurementRuntime({ createCanvasContext: () => context, flushTextMetrics });
    const block: FlowBlock = {
      kind: 'paragraph',
      id: 'browser-font',
      attrs: {},
      runs: [{ text: 'alpha beta gamma delta', fontFamily: 'Browser Font', fontSize: 16 }],
    };
    const pass = runtime.beginPass(fontContext('browser-font'));
    try {
      const actual = await pass.measureBlock(block, 90);
      pass.finish();
      // The oracle must use exact metrics even when the candidate never settles.
      exact = true;
      const oracle = createDomMeasurementRuntime({ createCanvasContext: () => context });
      const oraclePass = oracle.beginPass(fontContext('oracle'));
      try {
        expect(actual).toEqual(await oraclePass.measureBlock(block, 90));
      } finally {
        oraclePass.finish();
        oracle.dispose();
      }
    } finally {
      pass.finish();
      runtime.dispose();
    }
  });

  it('keeps settled widths and table entries across native metric retries under one font signature', async () => {
    // Mirrors the worker's native font proxy: a miss answers with a placeholder
    // width and queues the query; flush settles queued queries to exact widths.
    const settled = new Map<string, number>();
    const queued = new Set<string>();
    const waves: string[][] = [];
    let provisional = 0;
    const calls = new Map<string, number>();
    const context = {
      font: '',
      measureText(text: string) {
        calls.set(text, (calls.get(text) ?? 0) + 1);
        const exact = settled.get(text);
        if (exact !== undefined)
          return { width: exact, actualBoundingBoxAscent: 12, actualBoundingBoxDescent: 3 } as TextMetrics;
        provisional += 1;
        queued.add(text);
        return { width: text.length * 2, actualBoundingBoxAscent: 5, actualBoundingBoxDescent: 1 } as TextMetrics;
      },
    } as unknown as CanvasRenderingContext2D;
    const flushTextMetrics = () => {
      if (queued.size === 0) return null;
      const wave = [...queued];
      queued.clear();
      waves.push(wave);
      return Promise.resolve().then(() => {
        for (const text of wave) settled.set(text, text.length * 9);
      });
    };
    const exactContext = {
      font: '',
      measureText: (text: string) =>
        ({ width: text.length * 9, actualBoundingBoxAscent: 12, actualBoundingBoxDescent: 3 }) as TextMetrics,
    } as unknown as CanvasRenderingContext2D;
    const paragraph = (id: string, text: string): FlowBlock => ({
      kind: 'paragraph',
      id,
      attrs: {},
      runs: [{ text, fontFamily: 'Browser Font', fontSize: 16 }],
    });
    const table = (id: string): FlowBlock => ({
      kind: 'table',
      id,
      attrs: { tableLayout: 'fixed' },
      columnWidths: [120, 120],
      rows: [
        {
          id: `${id}-row`,
          cells: [
            { id: `${id}-a`, blocks: [paragraph(`${id}-a-p`, 'alpha beta gamma')] },
            { id: `${id}-b`, blocks: [paragraph(`${id}-b-p`, 'delta epsilon zeta')] },
          ],
        },
      ],
    });
    const runtime = createDomMeasurementRuntime({
      createCanvasContext: () => context,
      flushTextMetrics,
      provisionalTextMetrics: () => provisional,
    });
    const oracle = createDomMeasurementRuntime({ createCanvasContext: () => exactContext });
    const measureExact = async (block: FlowBlock, width: number) => {
      const pass = oracle.beginPass(fontContext('oracle'));
      try {
        return await pass.measureBlock(block, width);
      } finally {
        pass.finish();
      }
    };
    try {
      const pass = runtime.beginPass(fontContext('browser-fonts'));
      const first = await pass.measureBlock(paragraph('first', 'alpha beta gamma'), 400);
      expect(first).toEqual(await measureExact(paragraph('first', 'alpha beta gamma'), 400));
      expect(waves).toHaveLength(1);
      const alphaCalls = calls.get('alpha');
      // A second block sharing settled words only discovers its new word: the
      // retry of the first block did not evict the settled widths.
      const second = await pass.measureBlock(paragraph('second', 'alpha beta delta'), 400);
      expect(second).toEqual(await measureExact(paragraph('second', 'alpha beta delta'), 400));
      expect(waves).toHaveLength(2);
      expect(waves[1]).not.toContain('alpha');
      expect(waves[1]).not.toContain('beta');
      expect(calls.get('alpha')).toBe(alphaCalls);
      expect(runtime.snapshotStats().residentEntries).toBeGreaterThan(0);

      const outcomes: Record<string, number> = {};
      const trace = {
        depth: 0,
        cacheIdentity: 'strict' as const,
        observer: (observation: { cellBlockCache: Record<string, number>; measuredRowCount: number }) => {
          for (const [outcome, count] of Object.entries(observation.cellBlockCache)) {
            outcomes[outcome] = (outcomes[outcome] ?? 0) + count;
          }
        },
      };
      const grid = table('grid');
      const measuredGrid = await pass.measureBlock(grid, { maxWidth: 240, tableMeasurementTrace: trace });
      // Equality with the exact oracle proves no placeholder-derived cell measure
      // was recorded and served to a later attempt under the shared signature.
      expect(measuredGrid).toEqual(await measureExact(table('grid'), 240));
      expect(outcomes.miss).toBeGreaterThanOrEqual(4);
      pass.finish();
      const wavesBeforeReuse = waves.length;

      const again = runtime.beginPass(fontContext('browser-fonts'));
      const outcomesAgain: Record<string, number> = {};
      await again.measureBlock(grid, {
        maxWidth: 240,
        tableMeasurementTrace: {
          ...trace,
          observer: (observation) => {
            for (const [outcome, count] of Object.entries(observation.cellBlockCache)) {
              outcomesAgain[outcome] = (outcomesAgain[outcome] ?? 0) + count;
            }
          },
        },
      });
      again.finish();
      // Settled cell measures were recorded under the pass font signature, so a
      // later pass over identical cells reuses them.
      expect(outcomesAgain).toMatchObject({ 'exact-hit': 2, miss: 0 });
      expect(waves).toHaveLength(wavesBeforeReuse);
    } finally {
      runtime.dispose();
      oracle.dispose();
    }
  });

  it('freezes and memoizes the active surface digit capability', () => {
    const context = {
      font: '',
      fontKerning: 'auto',
      measureText: vi.fn(() => ({ width: 8 })),
    } as unknown as CanvasRenderingContext2D;
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    const runtime = createDomMeasurementRuntime();

    try {
      const pass = runtime.beginPass({
        fontSignature: 'digit-capability',
        resolvePhysical: () => 'Physical Serif',
      });
      const face = {
        family: 'Logical Serif',
        sizePx: 8,
        weight: '700' as const,
        style: 'italic' as const,
      };

      expect(Object.isFrozen(pass.fontCapabilities)).toBe(true);
      expect(pass.fontCapabilities.hasTabularDigits(face)).toBe(true);
      expect(pass.fontCapabilities.hasTabularDigits(face)).toBe(true);
      expect(context.font).toBe('italic bold 8px Physical Serif');
      expect(context.fontKerning).toBe('none');
      expect(context.measureText).toHaveBeenCalledTimes(10);
      pass.finish();
    } finally {
      runtime.dispose();
      getContext.mockRestore();
    }
  });

  it('keeps a North-shaped exact working set resident without repeat canvas work', () => {
    let intrinsicCalls = 0;
    const cache = new TextWidthMeasurementCache({
      maxEntries: 50_000,
      maxEstimatedBytes: 16 * 1024 * 1024,
    });
    const context = fakeContext(() => {
      intrinsicCalls += 1;
    });

    for (let index = 0; index < 25_084; index += 1) {
      cache.measure(`legal-token-${index}`, '16px Arial', 0, context);
    }
    const firstWidth = cache.measure('legal-token-0', '16px Arial', 0, context);
    const stats = cache.snapshotStats();

    expect(firstWidth).toBe('legal-token-0'.length + 1);
    expect(intrinsicCalls).toBe(25_084);
    expect(stats).toMatchObject({
      requests: 25_085,
      hits: 1,
      misses: 25_084,
      evictions: 0,
      intrinsicMeasureCalls: 25_084,
      residentEntries: 25_084,
    });
    expect(stats.estimatedResidentBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
  });

  it('enforces the byte bound independently of the entry bound', () => {
    const cache = new TextWidthMeasurementCache({ maxEntries: 100, maxEstimatedBytes: 700 });
    const context = fakeContext();
    for (let index = 0; index < 20; index += 1) {
      cache.measure(`${index}-${'x'.repeat(80)}`, '16px Arial', 0, context);
    }

    const stats = cache.snapshotStats();
    expect(stats.evictions).toBeGreaterThan(0);
    expect(stats.estimatedResidentBytes).toBeLessThanOrEqual(700);
    expect(stats.residentEntries).toBeLessThan(20);
  });

  it('keeps cooperative probes bounded across many short words without changing its exact measure', async () => {
    const block = legalParagraph();
    const baseline = await measureBlock(block, 420, fontContext('baseline'));
    const runtime = createDomMeasurementRuntime();
    let probes = 0;
    let yields = 0;
    const pass = runtime.beginPass(fontContext('runtime-a'), {
      checkpointIfDue: () => {
        probes += 1;
        if (probes % 11 !== 0) return null;
        yields += 1;
        return Promise.resolve();
      },
    });

    const measured = await pass.measureBlock(block, 420);
    const stats = pass.finish();

    expect(measured).toEqual(baseline);
    const words = legalProse.split(' ').length;
    expect(probes).toBeGreaterThanOrEqual(words / 8);
    expect(probes).toBeLessThan(words / 4);
    expect(yields).toBeGreaterThan(0);
    expect(stats.requests).toBeGreaterThan(0);
    expect(stats.intrinsicMeasureCalls).toBeLessThanOrEqual(stats.misses);
    runtime.dispose();
  });

  it('surfaces cancellation from a bounded checkpoint inside a large paragraph', async () => {
    const runtime = createDomMeasurementRuntime();
    let probes = 0;
    let aborted = false;
    const pass = runtime.beginPass(fontContext('runtime-cancellation'), {
      throwIfAborted: () => {
        if (aborted) throw new Error('measurement cancelled');
      },
      checkpointIfDue: () => {
        probes += 1;
        if (probes !== 3) return null;
        return Promise.resolve().then(() => {
          aborted = true;
        });
      },
    });

    await expect(pass.measureBlock(legalParagraph(), 420)).rejects.toThrow('measurement cancelled');
    expect(probes).toBe(3);
    pass.finish();
    runtime.dispose();
  });

  it('clears only its own cache on a font-generation transition and on disposal', async () => {
    const block = legalParagraph();
    const firstRuntime = createDomMeasurementRuntime();
    const secondRuntime = createDomMeasurementRuntime();

    const firstPass = firstRuntime.beginPass(fontContext('generation-a'));
    await firstPass.measureBlock(block, 420);
    firstPass.finish();
    const secondPass = secondRuntime.beginPass(fontContext('generation-a'));
    await secondPass.measureBlock(block, 420);
    secondPass.finish();
    const secondResident = secondRuntime.snapshotStats().residentEntries;

    firstRuntime.clearForFontGeneration('generation-b');
    expect(firstRuntime.snapshotStats().residentEntries).toBe(0);
    expect(secondRuntime.snapshotStats().residentEntries).toBe(secondResident);

    firstRuntime.dispose();
    expect(() => firstRuntime.beginPass(fontContext('generation-b'))).toThrow(/disposed/);
    const stillLive = secondRuntime.beginPass(fontContext('generation-a'));
    await expect(stillLive.measureBlock(block, 420)).resolves.toBeDefined();
    stillLive.finish();
    secondRuntime.dispose();
  });
});

describe('native font retry with repeated table content', () => {
  for (const withCounter of [true, false])
    it(`matches exact geometry after cached placeholders, counter=${withCounter}`, async () => {
      const settled = new Set<string>();
      const pending = new Set<string>();
      let provisional = 0;
      const canvas = (exact: boolean) =>
        ({
          font: '',
          measureText(text: string) {
            if (!exact && !settled.has(text)) {
              pending.add(text);
              provisional++;
            }
            const ready = exact || settled.has(text);
            return {
              width: text.length * (ready ? 9 : 2),
              actualBoundingBoxAscent: ready ? 12 : 5,
              actualBoundingBoxDescent: ready ? 3 : 1,
            } as TextMetrics;
          },
        }) as unknown as CanvasRenderingContext2D;
      const context = canvas(false);
      const runtime = createDomMeasurementRuntime({
        createCanvasContext: () => context,
        flushTextMetrics: () => {
          if (!pending.size) return null;
          const wave = [...pending];
          pending.clear();
          return Promise.resolve().then(() => {
            for (const text of wave) settled.add(text);
          });
        },
        ...(withCounter ? { provisionalTextMetrics: () => provisional } : {}),
      });
      const oracle = createDomMeasurementRuntime({ createCanvasContext: () => canvas(true) });
      const paragraph = (id: string) => ({
        kind: 'paragraph' as const,
        id,
        attrs: {},
        runs: [{ text: 'novel repeated words in every cell', fontFamily: 'Browser Font', fontSize: 16 }],
      });
      const table = () => ({
        kind: 'table' as const,
        id: 'table',
        attrs: { tableLayout: 'fixed' },
        columnWidths: [120, 120],
        rows: [
          {
            id: 'row',
            cells: [
              { id: 'a', blocks: [paragraph('a-p')] },
              { id: 'b', blocks: [paragraph('b-p')] },
            ],
          },
        ],
      });
      const pass = runtime.beginPass({
        fontSignature: `repeated-candidate-${withCounter}`,
        resolvePhysical: (family) => family,
      });
      const exactPass = oracle.beginPass({
        fontSignature: `repeated-oracle-${withCounter}`,
        resolvePhysical: (family) => family,
      });
      try {
        const actual = await pass.measureBlock(table(), 240);
        const expected = await exactPass.measureBlock(table(), 240);
        expect(actual).toEqual(expected);
      } finally {
        pass.finish();
        exactPass.finish();
        runtime.dispose();
        oracle.dispose();
      }
    });
});
