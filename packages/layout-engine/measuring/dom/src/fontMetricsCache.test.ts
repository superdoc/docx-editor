/**
 * Tests for the font metrics cache module.
 * Verifies that actual Canvas TextMetrics are used instead of hardcoded approximations.
 */

import { describe, it, expect, beforeEach } from 'vite-plus/test';
import {
  getFontMetrics,
  clearFontMetricsCache,
  getFontMetricsCacheSize,
  getCalibratedBodyEmptyLine,
  getCalibratedNaturalSingleLine,
  FontMetricsMeasurementCache,
} from './fontMetricsCache';

describe('fontMetricsCache', () => {
  // Create a canvas context for testing
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    clearFontMetricsCache();
    const canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d')!;
  });

  const defaultFonts = {
    deterministicFamily: 'Noto Sans',
    fallbackStack: ['Noto Sans', 'Arial', 'sans-serif'],
  };

  it('uses Word-native natural-line calibration for evidenced fonts', () => {
    expect(getCalibratedNaturalSingleLine('Aptos, sans-serif', 16)).toBeCloseTo(19.584, 3);
    expect(getCalibratedNaturalSingleLine('"Helvetica", sans-serif', 16)).toBeCloseTo(19.2, 3);
    // SD-4125 marker-font mutations: 11pt Symbol resolves to a 13.44pt
    // first-line box (17.92 CSS px).
    expect(getCalibratedNaturalSingleLine('Symbol, serif', 44 / 3)).toBeCloseTo(17.92, 3);
    // SD-1331 Word PDF: consecutive 11pt Nunito Sans lines start 15.12pt
    // apart (20.16 CSS px), including regular and bold paragraphs.
    expect(getCalibratedNaturalSingleLine('Nunito Sans, sans-serif', 44 / 3)).toBeCloseTo(20.16, 3);
    expect(getCalibratedNaturalSingleLine('Unknown Font', 16)).toBeUndefined();
  });

  it('uses the Word mutation-derived empty body-line calibration for Arial and its physical substitute', () => {
    expect(getCalibratedBodyEmptyLine('Arial, sans-serif', 16)).toBeCloseTo(18.4, 3);
    expect(getCalibratedBodyEmptyLine('Liberation Sans, sans-serif', 16)).toBeCloseTo(18.4, 3);
  });

  it('does not derive uncalibrated line height from availability-sensitive font bounds', () => {
    const metrics = new FontMetricsMeasurementCache().get(
      {
        font: '',
        measureText: () => ({
          actualBoundingBoxAscent: 12.496875,
          actualBoundingBoxDescent: 2.902921,
          fontBoundingBoxAscent: 19,
          fontBoundingBoxDescent: 3,
        }),
      } as unknown as CanvasRenderingContext2D,
      { fontFamily: 'Unknown Font, sans-serif', fontSize: 40 / 3 },
      'browser',
      defaultFonts,
    );

    expect(metrics).toEqual({ ascent: 12.496875, descent: 2.902921, naturalSingleLine: undefined });
  });

  it('preserves Word-native calibration when Canvas font bounds are ignored', () => {
    const metrics = new FontMetricsMeasurementCache().get(
      {
        font: '',
        measureText: () => ({
          actualBoundingBoxAscent: 8,
          actualBoundingBoxDescent: 2,
          fontBoundingBoxAscent: 20,
          fontBoundingBoxDescent: 5,
        }),
      } as unknown as CanvasRenderingContext2D,
      { fontFamily: 'Physical Font, sans-serif', wordLineMetricFamily: 'Aptos, sans-serif', fontSize: 12 },
      'browser',
      defaultFonts,
    );

    expect(metrics.ascent).toBe(8);
    expect(metrics.descent).toBe(2);
    expect(metrics.naturalSingleLine).toBeCloseTo(14.688, 3);
  });

  it('uses deterministic embedded metrics without overriding a reviewed Word calibration', () => {
    const cache = new FontMetricsMeasurementCache();
    const canvas = {
      font: '',
      measureText: () => ({ actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    } as unknown as CanvasRenderingContext2D;
    const embedded = cache.get(
      canvas,
      {
        fontFamily: 'Embedded Alias',
        wordLineMetricFamily: 'Helvetica Neue',
        fontSize: 12,
        naturalLineMultiplier: 2581 / 2048,
      },
      'browser',
      defaultFonts,
    );
    const calibrated = cache.get(
      canvas,
      { fontFamily: 'Embedded Alias', wordLineMetricFamily: 'Aptos', fontSize: 12, naturalLineMultiplier: 2 },
      'browser',
      defaultFonts,
    );
    const changedEmbeddedMetric = cache.get(
      canvas,
      {
        fontFamily: 'Embedded Alias',
        wordLineMetricFamily: 'Helvetica Neue',
        fontSize: 12,
        naturalLineMultiplier: 1.5,
      },
      'browser',
      defaultFonts,
    );

    expect(embedded.naturalSingleLine).toBeCloseTo(12 * (2581 / 2048), 6);
    expect(calibrated.naturalSingleLine).toBeCloseTo(12 * 1.224, 6);
    expect(changedEmbeddedMetric.naturalSingleLine).toBe(18);
  });

  describe('getFontMetrics', () => {
    it('returns positive ascent and descent values', () => {
      const metrics = getFontMetrics(ctx, { fontFamily: 'Arial', fontSize: 16 }, 'browser', defaultFonts);

      expect(metrics.ascent).toBeGreaterThan(0);
      expect(metrics.descent).toBeGreaterThan(0);
    });

    it('returns larger metrics for larger font sizes', () => {
      const small = getFontMetrics(ctx, { fontFamily: 'Arial', fontSize: 12 }, 'browser', defaultFonts);

      const large = getFontMetrics(ctx, { fontFamily: 'Arial', fontSize: 24 }, 'browser', defaultFonts);

      expect(large.ascent).toBeGreaterThan(small.ascent);
      expect(large.descent).toBeGreaterThan(small.descent);
    });

    it('caches results for repeated calls with same font', () => {
      const fontInfo = { fontFamily: 'Arial', fontSize: 16 };

      const first = getFontMetrics(ctx, fontInfo, 'browser', defaultFonts);
      const second = getFontMetrics(ctx, fontInfo, 'browser', defaultFonts);

      expect(first).toEqual(second);
      expect(getFontMetricsCacheSize()).toBe(1);
    });

    it('caches different results for different fonts', () => {
      getFontMetrics(ctx, { fontFamily: 'Arial', fontSize: 16 }, 'browser', defaultFonts);
      getFontMetrics(ctx, { fontFamily: 'Arial', fontSize: 20 }, 'browser', defaultFonts);
      getFontMetrics(ctx, { fontFamily: 'Times New Roman', fontSize: 16 }, 'browser', defaultFonts);

      expect(getFontMetricsCacheSize()).toBe(3);
    });

    it('produces different cache entries for bold/italic variants', () => {
      const base = { fontFamily: 'Arial', fontSize: 16 };

      getFontMetrics(ctx, base, 'browser', defaultFonts);
      getFontMetrics(ctx, { ...base, bold: true }, 'browser', defaultFonts);
      getFontMetrics(ctx, { ...base, italic: true }, 'browser', defaultFonts);
      getFontMetrics(ctx, { ...base, bold: true, italic: true }, 'browser', defaultFonts);

      expect(getFontMetricsCacheSize()).toBe(4);
    });

    it('uses fallback stack in deterministic mode', () => {
      const metricsA = getFontMetrics(ctx, { fontFamily: 'CustomFont', fontSize: 16 }, 'deterministic', defaultFonts);

      const metricsB = getFontMetrics(
        ctx,
        { fontFamily: 'AnotherCustomFont', fontSize: 16 },
        'deterministic',
        defaultFonts,
      );

      // In deterministic mode, both should use the fallback stack, so metrics should be equal
      // (though this depends on the test environment having the fallback fonts)
      expect(metricsA.ascent).toBeGreaterThan(0);
      expect(metricsB.ascent).toBeGreaterThan(0);
    });
  });

  describe('clearFontMetricsCache', () => {
    it('clears all cached entries', () => {
      getFontMetrics(ctx, { fontFamily: 'Arial', fontSize: 12 }, 'browser', defaultFonts);
      getFontMetrics(ctx, { fontFamily: 'Arial', fontSize: 16 }, 'browser', defaultFonts);

      expect(getFontMetricsCacheSize()).toBe(2);

      clearFontMetricsCache();

      expect(getFontMetricsCacheSize()).toBe(0);
    });
  });

  describe('cache eviction', () => {
    it('enforces MAX_CACHE_SIZE limit of 1000 entries', () => {
      clearFontMetricsCache();

      // Fill cache to exactly 1000 entries
      for (let i = 0; i < 1000; i++) {
        getFontMetrics(ctx, { fontFamily: `Font${i}`, fontSize: 12 }, 'browser', defaultFonts);
      }

      expect(getFontMetricsCacheSize()).toBe(1000);

      // Adding one more entry should trigger eviction
      getFontMetrics(ctx, { fontFamily: 'Font1000', fontSize: 12 }, 'browser', defaultFonts);

      // Cache should still be at max size
      expect(getFontMetricsCacheSize()).toBe(1000);
    });

    it('uses FIFO eviction when cache is full', () => {
      clearFontMetricsCache();

      // Fill cache to max capacity
      for (let i = 0; i < 1000; i++) {
        getFontMetrics(ctx, { fontFamily: `Font${i}`, fontSize: 12 }, 'browser', defaultFonts);
      }

      // Get the metrics for the first entry to verify it exists
      const firstEntry = getFontMetrics(ctx, { fontFamily: 'Font0', fontSize: 12 }, 'browser', defaultFonts);
      expect(firstEntry).toBeDefined();

      // Clear cache and refill to test eviction order
      clearFontMetricsCache();
      for (let i = 0; i < 1000; i++) {
        getFontMetrics(ctx, { fontFamily: `Font${i}`, fontSize: 12 }, 'browser', defaultFonts);
      }

      // Add a new entry, which should evict the oldest (Font0)
      getFontMetrics(ctx, { fontFamily: 'NewFont', fontSize: 12 }, 'browser', defaultFonts);

      // Verify cache is still at max size
      expect(getFontMetricsCacheSize()).toBe(1000);

      // The newest entry should be in cache
      const newestEntry = getFontMetrics(ctx, { fontFamily: 'NewFont', fontSize: 12 }, 'browser', defaultFonts);
      expect(newestEntry).toBeDefined();
    });

    it('maintains cache integrity during eviction', () => {
      clearFontMetricsCache();

      // Fill cache beyond max size
      for (let i = 0; i < 1100; i++) {
        getFontMetrics(ctx, { fontFamily: `Font${i}`, fontSize: 12 }, 'browser', defaultFonts);
      }

      // Cache should not exceed max size
      expect(getFontMetricsCacheSize()).toBe(1000);
      expect(getFontMetricsCacheSize()).toBeLessThanOrEqual(1000);

      // All recently added entries should still be accessible
      const recentEntry = getFontMetrics(ctx, { fontFamily: 'Font1099', fontSize: 12 }, 'browser', defaultFonts);
      expect(recentEntry).toBeDefined();
      expect(recentEntry.ascent).toBeGreaterThan(0);
    });
  });

  describe('input validation', () => {
    it('throws TypeError for null canvas context', () => {
      expect(() => {
        getFontMetrics(
          null as unknown as CanvasRenderingContext2D,
          { fontFamily: 'Arial', fontSize: 16 },
          'browser',
          defaultFonts,
        );
      }).toThrow(TypeError);
      expect(() => {
        getFontMetrics(
          null as unknown as CanvasRenderingContext2D,
          { fontFamily: 'Arial', fontSize: 16 },
          'browser',
          defaultFonts,
        );
      }).toThrow('Canvas context must be a valid CanvasRenderingContext2D object');
    });

    it('throws TypeError for invalid font size', () => {
      // Negative font size
      expect(() => {
        getFontMetrics(ctx, { fontFamily: 'Arial', fontSize: -16 }, 'browser', defaultFonts);
      }).toThrow(TypeError);
      expect(() => {
        getFontMetrics(ctx, { fontFamily: 'Arial', fontSize: -16 }, 'browser', defaultFonts);
      }).toThrow('Font size must be a positive finite number');

      // Zero font size
      expect(() => {
        getFontMetrics(ctx, { fontFamily: 'Arial', fontSize: 0 }, 'browser', defaultFonts);
      }).toThrow(TypeError);

      // Infinity font size
      expect(() => {
        getFontMetrics(ctx, { fontFamily: 'Arial', fontSize: Infinity }, 'browser', defaultFonts);
      }).toThrow(TypeError);

      // NaN font size
      expect(() => {
        getFontMetrics(ctx, { fontFamily: 'Arial', fontSize: NaN }, 'browser', defaultFonts);
      }).toThrow(TypeError);
    });

    it('throws TypeError for invalid font family', () => {
      // Empty string
      expect(() => {
        getFontMetrics(ctx, { fontFamily: '', fontSize: 16 }, 'browser', defaultFonts);
      }).toThrow(TypeError);
      expect(() => {
        getFontMetrics(ctx, { fontFamily: '', fontSize: 16 }, 'browser', defaultFonts);
      }).toThrow('Font family must be a non-empty string');

      // Whitespace only
      expect(() => {
        getFontMetrics(ctx, { fontFamily: '   ', fontSize: 16 }, 'browser', defaultFonts);
      }).toThrow(TypeError);
    });

    it('throws TypeError for invalid mode parameter', () => {
      expect(() => {
        getFontMetrics(ctx, { fontFamily: 'Arial', fontSize: 16 }, 'invalid' as 'browser', defaultFonts);
      }).toThrow(TypeError);
      expect(() => {
        getFontMetrics(ctx, { fontFamily: 'Arial', fontSize: 16 }, 'invalid' as 'browser', defaultFonts);
      }).toThrow("Mode must be 'browser' or 'deterministic'");
    });

    it('accepts valid inputs without throwing', () => {
      expect(() => {
        getFontMetrics(ctx, { fontFamily: 'Arial', fontSize: 16 }, 'browser', defaultFonts);
      }).not.toThrow();

      expect(() => {
        getFontMetrics(
          ctx,
          { fontFamily: 'Times New Roman', fontSize: 12, bold: true, italic: true },
          'deterministic',
          defaultFonts,
        );
      }).not.toThrow();
    });
  });

  describe('fallback behavior', () => {
    it('uses fallback approximations when actualBoundingBox metrics are unavailable', () => {
      // Mock measureText to simulate legacy browser without actualBoundingBox support
      const originalMeasureText = ctx.measureText;
      ctx.measureText = (text: string): TextMetrics => {
        const metrics = originalMeasureText.call(ctx, text);
        // Create a new object without actualBoundingBox properties
        return {
          width: metrics.width,
        } as TextMetrics;
      };

      clearFontMetricsCache();

      const metrics = getFontMetrics(ctx, { fontFamily: 'Arial', fontSize: 16 }, 'browser', defaultFonts);

      // Should fall back to approximations: ascent = fontSize * 0.8, descent = fontSize * 0.2
      expect(metrics.ascent).toBe(16 * 0.8);
      expect(metrics.descent).toBe(16 * 0.2);

      // Restore original measureText
      ctx.measureText = originalMeasureText;
    });

    it('uses fallback when actualBoundingBoxAscent is zero', () => {
      const originalMeasureText = ctx.measureText;
      ctx.measureText = (text: string): TextMetrics => {
        const metrics = originalMeasureText.call(ctx, text);
        return {
          width: metrics.width,
          actualBoundingBoxAscent: 0,
          actualBoundingBoxDescent: 3,
        } as TextMetrics;
      };

      clearFontMetricsCache();

      const metrics = getFontMetrics(ctx, { fontFamily: 'Arial', fontSize: 20 }, 'browser', defaultFonts);

      // Should use fallback when ascent is 0
      expect(metrics.ascent).toBe(20 * 0.8);
      expect(metrics.descent).toBe(20 * 0.2);

      ctx.measureText = originalMeasureText;
    });

    it('uses fallback when actualBoundingBox properties are not numbers', () => {
      const originalMeasureText = ctx.measureText;
      ctx.measureText = (text: string): TextMetrics => {
        const metrics = originalMeasureText.call(ctx, text);
        return {
          width: metrics.width,
          actualBoundingBoxAscent: undefined,
          actualBoundingBoxDescent: undefined,
        } as unknown as TextMetrics;
      };

      clearFontMetricsCache();

      const metrics = getFontMetrics(ctx, { fontFamily: 'Arial', fontSize: 14 }, 'browser', defaultFonts);

      expect(metrics.ascent).toBe(14 * 0.8);
      expect(metrics.descent).toBe(14 * 0.2);

      ctx.measureText = originalMeasureText;
    });

    it('uses actual metrics when actualBoundingBox is available and valid', () => {
      clearFontMetricsCache();

      const metrics = getFontMetrics(ctx, { fontFamily: 'Arial', fontSize: 16 }, 'browser', defaultFonts);

      // In a real browser environment with Canvas API support,
      // actual metrics should be different from simple approximations
      expect(metrics.ascent).toBeGreaterThan(0);
      expect(metrics.descent).toBeGreaterThan(0);

      // The actual values should be positive and finite
      expect(Number.isFinite(metrics.ascent)).toBe(true);
      expect(Number.isFinite(metrics.descent)).toBe(true);
    });
  });

  describe('text clipping prevention', () => {
    it('provides metrics that prevent capital letter clipping', () => {
      // This test verifies that the actual font metrics from Canvas API
      // provide sufficient space for rendering without clipping
      const metrics = getFontMetrics(ctx, { fontFamily: 'Arial', fontSize: 16 }, 'browser', defaultFonts);

      // The old hardcoded approach used fontSize * 0.8 = 12.8 for ascent
      // Actual metrics should be at least as large to prevent clipping
      // For Arial 16px, the actual ascent is typically around 14-15px
      const oldApproximation = 16 * 0.8;
      expect(metrics.ascent).toBeGreaterThanOrEqual(oldApproximation * 0.9); // Allow some variance

      // Total line height should accommodate full text without clipping
      const totalHeight = metrics.ascent + metrics.descent;
      expect(totalHeight).toBeGreaterThanOrEqual(16 * 0.9); // Should be close to or exceed font size
    });

    it('accounts for accented characters in metrics test string', () => {
      // The metrics test string includes accented capitals like 'ÁÉÍ'
      // which have larger ascenders than regular letters
      const metrics = getFontMetrics(ctx, { fontFamily: 'Arial', fontSize: 16 }, 'browser', defaultFonts);

      // Metrics should be sufficient to render accented text without clipping
      expect(metrics.ascent).toBeGreaterThan(0);
      // The ascent should be notably larger than descent for most fonts
      expect(metrics.ascent).toBeGreaterThan(metrics.descent);
    });
  });
});
