/**
 * Instrumentation Tests
 *
 * Tests for debug logging and metrics collection.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vite-plus/test';
import { MetricsCollector } from '../src/instrumentation';

const loadWithDebugFlagsOff = async () => {
  vi.stubEnv('SD_DEBUG_PAGE_TOKENS', '0');
  vi.stubEnv('SD_DEBUG_HF_CACHE', '0');
  vi.resetModules();
  return import('../src/instrumentation');
};

describe('Instrumentation', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  describe('PageTokenLogger', () => {
    it('prints nothing while SD_DEBUG_PAGE_TOKENS is off', async () => {
      const { PageTokenLogger } = await loadWithDebugFlagsOff();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      PageTokenLogger.logIterationStart(0, 10);
      PageTokenLogger.logAffectedBlocks(0, new Set(['block1', 'block2']));
      PageTokenLogger.logConvergence(1, true, 100);
      PageTokenLogger.logRemeasure(5, 20);
      PageTokenLogger.logError('block1', new Error('test'));

      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });

  describe('HeaderFooterCacheLogger', () => {
    it('prints nothing while SD_DEBUG_HF_CACHE is off', async () => {
      const { HeaderFooterCacheLogger } = await loadWithDebugFlagsOff();

      HeaderFooterCacheLogger.logCacheHit('default', 5, 'd1');
      HeaderFooterCacheLogger.logCacheMiss('default', 50, 'd2');
      HeaderFooterCacheLogger.logInvalidation('test', ['block1']);
      HeaderFooterCacheLogger.logStats({
        hits: 10,
        misses: 5,
        sets: 15,
        invalidations: 0,
        clears: 0,
        evictions: 0,
        size: 15,
        memorySizeEstimate: 75000,
      });
      HeaderFooterCacheLogger.logBucketingDecision(150, true, ['d1', 'd2']);

      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });
  });

  describe('MetricsCollector', () => {
    let collector: MetricsCollector;

    beforeEach(() => {
      collector = new MetricsCollector();
    });

    it('should record and retrieve page token metrics', () => {
      const metrics = {
        totalTimeMs: 50,
        iterations: 1,
        affectedBlocks: 5,
        remeasureTimeMs: 20,
        relayoutTimeMs: 25,
        converged: true,
      };

      collector.recordPageTokenMetrics(metrics);

      const retrieved = collector.getMetrics();
      expect(retrieved.pageTokens).toEqual(metrics);
    });

    it('should record and retrieve header/footer cache metrics', () => {
      const stats = {
        hits: 100,
        misses: 10,
        sets: 110,
        invalidations: 0,
        clears: 0,
        evictions: 0,
        size: 110,
        memorySizeEstimate: 550000,
      };

      collector.recordHeaderFooterCacheMetrics(stats);

      const retrieved = collector.getMetrics();
      expect(retrieved.headerFooterCache).toBeDefined();
      expect(retrieved.headerFooterCache?.hits).toBe(100);
      expect(retrieved.headerFooterCache?.misses).toBe(10);
      expect(retrieved.headerFooterCache?.hitRate).toBeCloseTo(90.9, 1);
    });

    it('should reset all metrics', () => {
      collector.recordPageTokenMetrics({
        totalTimeMs: 50,
        iterations: 1,
        affectedBlocks: 5,
        remeasureTimeMs: 20,
        relayoutTimeMs: 25,
        converged: true,
      });

      collector.reset();

      const retrieved = collector.getMetrics();
      expect(retrieved.pageTokens).toBeNull();
      expect(retrieved.headerFooterCache).toBeNull();
      expect(retrieved.layout).toBeNull();
    });

    describe('Rollback Triggers', () => {
      it('should warn on excessive iterations without convergence', () => {
        collector.recordPageTokenMetrics({
          totalTimeMs: 150,
          iterations: 3,
          affectedBlocks: 10,
          remeasureTimeMs: 50,
          relayoutTimeMs: 80,
          converged: false,
        });

        expect(consoleWarnSpy).toHaveBeenCalled();
        const call = consoleWarnSpy.mock.calls[0][0];
        expect(call).toContain('[Rollback Trigger]');
        expect(call).toContain('did not converge');
      });

      it('should warn on slow token resolution', () => {
        collector.recordPageTokenMetrics({
          totalTimeMs: 150,
          iterations: 2,
          affectedBlocks: 5,
          remeasureTimeMs: 50,
          relayoutTimeMs: 80,
          converged: true,
        });

        expect(consoleWarnSpy).toHaveBeenCalled();
        const call = consoleWarnSpy.mock.calls[0][0];
        expect(call).toContain('[Rollback Trigger]');
        expect(call).toContain('>100ms threshold');
      });

      it('should warn on low cache hit rate', () => {
        collector.recordHeaderFooterCacheMetrics({
          hits: 10,
          misses: 90,
          sets: 100,
          invalidations: 0,
          clears: 0,
          evictions: 0,
          size: 100,
          memorySizeEstimate: 500000,
        });

        expect(consoleWarnSpy).toHaveBeenCalled();
        const call = consoleWarnSpy.mock.calls[0][0];
        expect(call).toContain('[Rollback Trigger]');
        expect(call).toContain('hit rate is low');
      });

      it('should warn on excessive memory usage', () => {
        collector.recordHeaderFooterCacheMetrics({
          hits: 100,
          misses: 10,
          sets: 110,
          invalidations: 0,
          clears: 0,
          evictions: 0,
          size: 500,
          memorySizeEstimate: 2_000_000, // 2MB - exceeds 1MB threshold
        });

        expect(consoleWarnSpy).toHaveBeenCalled();
        const call = consoleWarnSpy.mock.calls[0][0];
        expect(call).toContain('[Rollback Trigger]');
        expect(call).toContain('memory usage is high');
      });

      it('should not warn on acceptable performance', () => {
        consoleWarnSpy.mockClear();

        collector.recordPageTokenMetrics({
          totalTimeMs: 50,
          iterations: 1,
          affectedBlocks: 5,
          remeasureTimeMs: 20,
          relayoutTimeMs: 25,
          converged: true,
        });

        collector.recordHeaderFooterCacheMetrics({
          hits: 90,
          misses: 10,
          sets: 100,
          invalidations: 0,
          clears: 0,
          evictions: 0,
          size: 100,
          memorySizeEstimate: 500000,
        });

        expect(consoleWarnSpy).not.toHaveBeenCalled();
      });
    });
  });
});
