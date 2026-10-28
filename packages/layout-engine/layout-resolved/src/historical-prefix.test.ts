import { expect, it } from 'vite-plus/test';
import type { ParagraphBlock, ParagraphMeasure, ParaFragment } from '@superdoc/contracts';
import { resolveParagraphContent } from './resolveParagraph.js';

for (const delta of [-14, 48]) {
  it.each([false, true])(`preserves first-line width at delta ${delta} with positioned segments=%s`, (positioned) => {
    const plain: ParagraphBlock = {
      kind: 'paragraph',
      id: 'historical-width',
      attrs: { indent: { left: 96, ...(delta < 0 ? { hanging: -delta } : { firstLine: delta }) } },
      runs: [{ kind: 'text', text: 'Alpha Bravo Charlie' }],
    };
    const historical: ParagraphBlock = {
      ...plain,
      attrs: {
        ...plain.attrs,
        wordLayout: {
          textStartMode: 'paragraph',
          indentLeftPx: 96,
          hangingPx: 24,
          firstLinePx: 0,
          tabsPx: [],
          marker: { markerText: 'LONG.', suffix: 'nothing', justification: 'left' },
        },
      },
    };
    const measure: ParagraphMeasure = {
      kind: 'paragraph',
      totalHeight: 40,
      lines: [0, 1].map((index) => ({
        fromRun: 0,
        toRun: 0,
        fromChar: index * 6,
        toChar: index * 6 + 6,
        width: 40,
        maxWidth: 400 - 96 - (index === 0 ? delta : 0),
        ascent: 12,
        descent: 4,
        lineHeight: 20,
        ...(positioned
          ? { segments: [{ runIndex: 0, fromChar: index * 6, toChar: index * 6 + 6, x: 0, width: 40 }] }
          : {}),
      })),
    };
    const fragment: ParaFragment = {
      kind: 'para',
      blockId: plain.id,
      x: 0,
      y: 0,
      width: 400,
      fromLine: 0,
      toLine: 2,
      markerWidth: 24,
      markerTextWidth: 25,
    };
    const before = resolveParagraphContent(
      { ...fragment, markerWidth: undefined, markerTextWidth: undefined },
      plain,
      measure,
    );
    const after = resolveParagraphContent(fragment, historical, measure);
    expect(after.lines.map((line) => line.availableWidth)).toEqual(before.lines.map((line) => line.availableWidth));
    expect(after.lines.map((line) => line.indentOffset)).toEqual([96 + delta, 96]);
    expect(after.lines[0].resolvedListTextStartPx).toBe(96 + delta);
    expect(after.marker?.textStartPx).toBe(96 + delta);
  });
}
