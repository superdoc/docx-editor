// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vite-plus/test';
import { resolveCanvas } from '../../measuring/dom/src/canvas-resolver.js';
import { installNodeCanvasPolyfill } from '../../measuring/dom/src/setup.ts';
import { runBenchmarkSuite } from './benchmarks/index';

const { Canvas, usingStub } = resolveCanvas();

beforeAll(() => {
  if (usingStub) {
    console.warn(
      '[superdoc] Skipping layout-bridge benchmarks because mock canvas is active; install native deps or use Node 20 for real metrics.',
    );
    return;
  }

  installNodeCanvasPolyfill({
    document,
    Canvas,
  });
});

const describeIfRealCanvas = usingStub ? describe.skip : describe;

const IS_CI = Boolean(process.env.CI);
// Full-suite parallel runs cause significant CPU contention locally;
// CI targets (500/700/1000 ms) are the real regression gate.
const NON_CI_LATENCY_VARIANCE_FACTOR = 8;
const LATENCY_TARGETS = IS_CI
  ? {
      // CI environments are slower and more variable; use generous buffers
      p50: 500,
      p90: 700,
      p99: 1000,
    }
  : {
      p50: 70,
      p90: 80,
      p99: 90,
    };
const MIN_HIT_RATE = 0.95;
const latencyBudget = (target: number): number => {
  if (IS_CI) return target;
  return target * NON_CI_LATENCY_VARIANCE_FACTOR;
};

describeIfRealCanvas('incremental pipeline benchmarks', () => {
  it('meets latency and cache targets across document sizes', async () => {
    const scenarios = [
      { targetPages: 1, iterations: 4 },
      { targetPages: 10, iterations: 4 },
      { targetPages: 25, iterations: 4 },
      { targetPages: 50, iterations: 4 },
    ];
    const results = await runBenchmarkSuite({ scenarios });

    results.forEach((result) => {
      if (process.env.LAYOUT_BENCH_DEBUG) {
        console.log(
          JSON.stringify(
            {
              pages: result.targetPages,
              actual: result.actualPages,
              initial: result.initialPages,
              totalBlocks: result.totalBlocks,
              blocksPerPage: result.blocksPerPage,
              blockHeight: result.blockHeight,
              latency: result.latency,
              cache: result.cache,
            },
            null,
            2,
          ),
        );
      }
      expect(result.actualPages).toBe(result.targetPages);
      expect(result.latency.p50).toBeLessThanOrEqual(latencyBudget(LATENCY_TARGETS.p50));
      expect(result.latency.p90).toBeLessThanOrEqual(latencyBudget(LATENCY_TARGETS.p90));
      expect(result.latency.p99).toBeLessThanOrEqual(latencyBudget(LATENCY_TARGETS.p99));
      if (result.targetPages >= 10) {
        expect(result.cache.hitRate).toBeGreaterThanOrEqual(MIN_HIT_RATE);
      } else {
        expect(result.cache.hitRate).toBeGreaterThan(0);
      }
    });
  }, 60000); // Extended timeout for CI environments
});
