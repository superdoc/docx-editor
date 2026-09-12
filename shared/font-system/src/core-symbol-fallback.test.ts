import { describe, expect, it } from 'vite-plus/test';
import { CORE_SYMBOL_FALLBACK_COVERAGE, textForCoreSymbolFallback } from './core-symbol-fallback';

describe('core symbol fallback coverage', () => {
  it('matches provider-backed symbols rather than a checkbox-specific allowlist', () => {
    expect(textForCoreSymbolFallback('plain text 0')).toBe('');
    expect(textForCoreSymbolFallback('flight \u2708 ballot \u2610\u2611\u2612')).toBe('\u2708\u2610\u2611\u2612');
    expect(textForCoreSymbolFallback('Latin Ж →')).toBe('');
  });

  it('deduplicates supplementary-plane characters by code point', () => {
    expect(textForCoreSymbolFallback('\u{1F5F9}\u{1F5F9}')).toBe('\u{1F5F9}');
  });

  it('plans visible ASCII symbols while leaving ordinary text and separators lazy', () => {
    expect(textForCoreSymbolFallback('3. #,##0 | S: *')).toBe('#*');
    expect(textForCoreSymbolFallback('plain 123\u0000\r\t \u007f\u00a0')).toBe('');
  });

  it('does not claim separator glyphs that the load gate leaves lazy', () => {
    for (const codePoint of [0, 0x0d, 0x20, 0x7f, 0xa0]) {
      expect(
        CORE_SYMBOL_FALLBACK_COVERAGE.ranges.some((range) => range.start <= codePoint && codePoint <= range.end),
      ).toBe(false);
    }
  });

  it('does not claim ASCII digits', () => {
    const coversCodePoint = (codePoint: number) =>
      CORE_SYMBOL_FALLBACK_COVERAGE.ranges.some((r) => r.start <= codePoint && codePoint <= r.end);
    for (const digit of '0123456789') {
      expect(coversCodePoint(digit.codePointAt(0)!)).toBe(false);
    }
  });
});
