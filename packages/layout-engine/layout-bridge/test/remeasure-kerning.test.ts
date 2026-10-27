import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import type { ParagraphBlock } from '@superdoc/contracts';
import { clearRemeasureTextCaches, remeasureParagraph } from '../src/remeasure.js';
import { measureCharacterX } from '../src/text-measurement.js';

const installCanvas = (fontKerning: CanvasFontKerning) => {
  const context = {
    font: '',
    fontKerning,
    measureText(text: string) {
      return { width: text.length * 10 - (this.fontKerning === 'none' ? 0 : (text.match(/AV/g)?.length ?? 0) * 2) };
    },
  };
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) });
  clearRemeasureTextCaches();
  return context;
};

afterEach(() => {
  vi.unstubAllGlobals();
  clearRemeasureTextCaches();
});

describe('painted kerning in float remeasurement', () => {
  it.each(['auto', 'normal', 'none'] as const)(
    'keeps the normalized width and painted caret edge aligned with a cold %s canvas',
    (initial) => {
      const context = installCanvas(initial);
      const block: ParagraphBlock = {
        kind: 'paragraph',
        id: 'kerning-float',
        attrs: { alignment: 'justify' },
        runs: [{ text: 'AV Beta Gamma Delta', fontFamily: 'Arial', fontSize: 16 }],
      };
      const region = { offsetX: 156, width: 120 };
      const measure = remeasureParagraph(block, 300, 0, [[region]]);
      const line = measure.lines[0];

      expect(line).toMatchObject({ toChar: 8, width: 70, spaceCount: 1 });
      expect(line.segments).toEqual([{ runIndex: 0, fromChar: 0, toChar: 7, width: 70, x: 156 }]);
      expect(context.fontKerning).toBe('none');
      expect(measure.lines[1]).toMatchObject({ fromChar: 8 });
      expect(measureCharacterX(block, line, 7)).toBe(region.offsetX + region.width);
      expect(measureCharacterX(block, line, 8)).toBe(region.offsetX + region.width);
    },
  );
});
