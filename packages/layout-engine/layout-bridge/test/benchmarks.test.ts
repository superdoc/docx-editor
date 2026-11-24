/**
 * Tests for TypingPerfBenchmark
 */

import { describe, it, expect, beforeEach } from 'vite-plus/test';
import { TypingPerfBenchmark } from './benchmarks';

describe('TypingPerfBenchmark', () => {
  let benchmark: TypingPerfBenchmark;

  beforeEach(() => {
    benchmark = new TypingPerfBenchmark();
  });

  describe('runScenario', () => {
    it('should run a scenario and return results', async () => {
      let counter = 0;
      const result = await benchmark.runScenario({
        name: 'Test scenario',
        setup: async () => {
          counter = 0;
        },
        run: () => {
          counter++;
        },
        iterations: 10,
        target: 1,
      });

      expect(result.name).toBe('Test scenario');
      expect(result.samples).toBe(10);
      expect(result.min).toBeGreaterThanOrEqual(0);
      expect(result.max).toBeGreaterThanOrEqual(result.min);
      expect(result.avg).toBeGreaterThanOrEqual(0);
      expect(result.target).toBe(1);
      expect(counter).toBeGreaterThan(10); // Includes warmup iterations
    });

    it('should calculate percentiles', async () => {
      const result = await benchmark.runScenario({
        name: 'Percentile test',
        setup: async () => {},
        run: () => {},
        iterations: 100,
        target: 1,
      });

      expect(result.p50).toBeGreaterThanOrEqual(0);
      expect(result.p95).toBeGreaterThanOrEqual(result.p50);
      expect(result.p99).toBeGreaterThanOrEqual(result.p95);
    });

    it('should mark pass/fail based on P95', async () => {
      // Fast scenario should pass
      const fast = await benchmark.runScenario({
        name: 'Fast',
        setup: async () => {},
        run: () => {}, // Very fast
        iterations: 10,
        target: 100, // Generous target
      });
      expect(fast.passed).toBe(true);
    });

    it('should call teardown if provided', async () => {
      let tornDown = false;
      await benchmark.runScenario({
        name: 'With teardown',
        setup: async () => {},
        run: () => {},
        teardown: () => {
          tornDown = true;
        },
        iterations: 5,
        target: 1,
      });
      expect(tornDown).toBe(true);
    });

    it('should handle async run functions', async () => {
      const result = await benchmark.runScenario({
        name: 'Async test',
        setup: async () => {},
        run: async () => {
          await new Promise((resolve) => setTimeout(resolve, 1));
        },
        iterations: 5,
        target: 10,
      });
      expect(result.avg).toBeGreaterThan(0);
    });
  });

  describe('runAll', () => {
    it('should run all registered scenarios', async () => {
      benchmark.registerScenario({
        name: 'Test 1',
        setup: async () => {},
        run: () => {},
        iterations: 5,
        target: 1,
      });
      benchmark.registerScenario({
        name: 'Test 2',
        setup: async () => {},
        run: () => {},
        iterations: 5,
        target: 1,
      });

      const results = await benchmark.runAll();
      expect(results.length).toBe(2);
      expect(results[0].name).toBe('Test 1');
      expect(results[1].name).toBe('Test 2');
    });

    it('should store results', async () => {
      benchmark.registerScenario({
        name: 'Test',
        setup: async () => {},
        run: () => {},
        iterations: 5,
        target: 1,
      });

      await benchmark.runAll();
      const results = benchmark.getResults();
      expect(results.length).toBe(1);
    });
  });

  describe('toMarkdown', () => {
    it('should export empty message when no results', () => {
      const markdown = benchmark.toMarkdown();
      expect(markdown).toContain('No benchmark results');
    });

    it('should export markdown table', async () => {
      benchmark.registerScenario({
        name: 'Test',
        setup: async () => {},
        run: () => {},
        iterations: 5,
        target: 1,
      });

      await benchmark.runAll();
      const markdown = benchmark.toMarkdown();

      expect(markdown).toContain('# Typing Performance Benchmarks');
      expect(markdown).toContain('| Benchmark |');
      expect(markdown).toContain('| Test |');
      expect(markdown).toContain('Summary');
    });

    it('should show pass/fail status', async () => {
      benchmark.registerScenario({
        name: 'Pass test',
        setup: async () => {},
        run: () => {},
        iterations: 5,
        target: 100,
      });

      await benchmark.runAll();
      const markdown = benchmark.toMarkdown();
      expect(markdown).toContain('✓');
    });
  });

  describe('toJSON', () => {
    it('should export results as JSON', async () => {
      benchmark.registerScenario({
        name: 'Test',
        setup: async () => {},
        run: () => {},
        iterations: 5,
        target: 1,
      });

      await benchmark.runAll();
      const json = benchmark.toJSON();
      const parsed = JSON.parse(json);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].name).toBe('Test');
    });
  });

  describe('clear', () => {
    it('should clear scenarios and results', async () => {
      benchmark.registerScenario({
        name: 'Test',
        setup: async () => {},
        run: () => {},
        iterations: 5,
        target: 1,
      });

      await benchmark.runAll();
      benchmark.clear();

      const results = benchmark.getResults();
      expect(results.length).toBe(0);
    });
  });
});
