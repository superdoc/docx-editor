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

const fontContext = (fontSignature: string): FontMeasureContext => ({
  fontSignature,
  resolvePhysical: (family) => family,
});

const legalParagraph = (): FlowBlock => ({
  kind: 'paragraph',
  id: 'legal-prose',
  runs: [
    {
      text: Array.from({ length: 180 }, (_, index) => `(${index % 20}) covenant`).join(' '),
      fontFamily: 'Arial',
      fontSize: 16,
    },
  ],
  attrs: {},
});

describe('surface-owned DOM measurement runtime', () => {
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
    expect(probes).toBe(47);
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
