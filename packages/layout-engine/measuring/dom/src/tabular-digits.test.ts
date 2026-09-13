import { describe, expect, it, vi } from 'vite-plus/test';
import { createTabularDigitProbe } from './tabular-digits.js';

function contextWithWidths(widths: readonly number[]): CanvasRenderingContext2D {
  return {
    font: '',
    fontKerning: 'auto',
    measureText: vi.fn((text: string) => ({ width: widths[Number(text)] ?? 0 })),
  } as unknown as CanvasRenderingContext2D;
}

describe('tabular digit measurement capability', () => {
  it('accepts a face whose ten digit advances are equal within tolerance', () => {
    const context = contextWithWidths([8, 8.001, 7.999, 8, 8, 8, 8, 8, 8, 8]);
    const sut = createTabularDigitProbe(context);

    const result = sut.hasTabularDigits('normal 400 8px Times New Roman');

    expect(result).toBe(true);
    expect(context.fontKerning).toBe('none');
  });

  it('rejects a face when one digit has a different advance', () => {
    const context = contextWithWidths([8, 8, 8, 8, 8, 8, 8, 8, 8, 8.02]);
    const sut = createTabularDigitProbe(context);

    const result = sut.hasTabularDigits('normal 400 8px Times New Roman');

    expect(result).toBe(false);
  });

  it('measures each digit once for repeated checks of the same font string', () => {
    const context = contextWithWidths([8, 8, 8, 8, 8, 8, 8, 8, 8, 8]);
    const sut = createTabularDigitProbe(context);

    const first = sut.hasTabularDigits('normal 400 8px Times New Roman');
    const second = sut.hasTabularDigits('normal 400 8px Times New Roman');

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(context.measureText).toHaveBeenCalledTimes(10);
  });
});
