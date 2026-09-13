const DECIMAL_DIGITS = '0123456789';
const TABULAR_ADVANCE_TOLERANCE_PX = 0.01;

export interface TabularDigitProbe {
  hasTabularDigits(font: string): boolean;
}

export function createTabularDigitProbe(context: CanvasRenderingContext2D): TabularDigitProbe {
  const results = new Map<string, boolean>();

  return Object.freeze({
    hasTabularDigits(font: string): boolean {
      const cached = results.get(font);
      if (cached !== undefined) return cached;

      context.font = font;
      context.fontKerning = 'none';
      const widths = Array.from(DECIMAL_DIGITS, (digit) => context.measureText(digit).width);
      const result = Math.max(...widths) - Math.min(...widths) <= TABULAR_ADVANCE_TOLERANCE_PX;
      results.set(font, result);
      return result;
    },
  });
}
