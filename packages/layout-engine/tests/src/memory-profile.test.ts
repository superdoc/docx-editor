import { describe, it, expect } from 'vite-plus/test';
import { layoutDocument } from '@superdoc/layout-engine';
import type { FlowBlock, Measure, ParagraphBlock } from '@superdoc/contracts';

const LINE_HEIGHT = 20;
const PAGE_SIZE = { w: 816, h: 1056 };
const MARGINS = { top: 96, right: 96, bottom: 96, left: 96 };
const LINES_PER_PAGE = Math.floor((PAGE_SIZE.h - MARGINS.top - MARGINS.bottom) / LINE_HEIGHT);
const HEAP_LIMIT_MB = 300;
const LEAK_TOLERANCE_MB = 15;
const LEAK_SAMPLE_COUNT = 5;

const gcOnly = typeof globalThis.gc === 'function' ? it : it.skip;

const paragraph = (index: number): ParagraphBlock => ({
  kind: 'paragraph',
  id: `paragraph-${index}`,
  runs: [{ kind: 'text', text: `Paragraph ${index}`, fontFamily: 'Arial', fontSize: 12 }],
});

const oneLine: Measure = {
  kind: 'paragraph',
  lines: [
    {
      fromRun: 0,
      fromChar: 0,
      toRun: 0,
      toChar: 0,
      width: 100,
      ascent: LINE_HEIGHT * 0.8,
      descent: LINE_HEIGHT * 0.2,
      lineHeight: LINE_HEIGHT,
    },
  ],
  totalHeight: LINE_HEIGHT,
};

const documentOfPages = (pageCount: number): { blocks: FlowBlock[]; measures: Measure[] } => {
  const blocks = Array.from({ length: pageCount * LINES_PER_PAGE }, (_, index) => paragraph(index));
  return { blocks, measures: blocks.map(() => oneLine) };
};

const layoutPages = (pageCount: number): number => {
  const { blocks, measures } = documentOfPages(pageCount);
  return layoutDocument(blocks, measures, { pageSize: PAGE_SIZE, margins: MARGINS }).pages.length;
};

const heapUsedMb = (): number => process.memoryUsage().heapUsed / 1024 / 1024;

const collectGarbage = (): void => {
  globalThis.gc?.();
};

const medianHeapGrowthMb = (operation: () => void): number => {
  const samples = Array.from({ length: LEAK_SAMPLE_COUNT }, () => {
    collectGarbage();
    const before = heapUsedMb();
    operation();
    collectGarbage();
    return heapUsedMb() - before;
  }).sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)] ?? 0;
};

describe('Memory Profiling', () => {
  it('lays out a 100-page document within the heap limit', () => {
    collectGarbage();
    const before = heapUsedMb();
    const { blocks, measures } = documentOfPages(100);
    const layout = layoutDocument(blocks, measures, { pageSize: PAGE_SIZE, margins: MARGINS });

    expect(layout.pages).toHaveLength(100);
    expect(heapUsedMb() - before).toBeLessThan(HEAP_LIMIT_MB);
  });

  it('produces pages in proportion to document length', () => {
    expect([10, 50, 100].map(layoutPages)).toEqual([10, 50, 100]);
  });

  gcOnly('releases layout memory after 10 layouts of a 50-page document', () => {
    const retained = medianHeapGrowthMb(() => {
      for (let cycle = 0; cycle < 10; cycle++) layoutPages(50);
    });

    expect(retained).toBeLessThan(LEAK_TOLERANCE_MB);
  });
});
