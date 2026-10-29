import { describe, expect, it } from 'bun:test';
import type { FlowBlock, Measure, ParagraphMeasure, SectionPageBorders } from '@superdoc/contracts';
import { createLayoutDocumentContinuation, layoutDocument } from './index.js';

const options = {
  pageSize: { w: 200, h: 120 },
  margins: { top: 10, right: 10, bottom: 10, left: 10 },
};
const borders = {
  offsetFrom: 'page',
  display: 'firstPage',
  top: { width: 8, space: 32, color: '#EE0000' },
} as const;

function fixture(first: SectionPageBorders = borders, second: SectionPageBorders | undefined = borders) {
  const blocks: FlowBlock[] = [];
  const measures: Measure[] = [];
  for (let section = 0; section < 2; section += 1) {
    blocks.push({
      kind: 'sectionBreak',
      id: `section-${section}`,
      type: 'nextPage',
      attrs: { sectionIndex: section, isFirstSection: section === 0 },
      pageBorders: section === 0 ? first : second,
    });
    measures.push({ kind: 'sectionBreak' });
    blocks.push({
      kind: 'paragraph',
      id: `paragraph-${section}`,
      attrs: { widowControl: false },
      runs: [{ text: 'Some text here' }],
    });
    measures.push({
      kind: 'paragraph',
      totalHeight: 150,
      lines: Array.from({ length: 15 }, () => ({
        fromRun: 0,
        toRun: 0,
        fromChar: 0,
        toChar: 1,
        width: 20,
        ascent: 8,
        descent: 2,
        lineHeight: 10,
      })),
    });
  }
  return { blocks, measures };
}

function manualBreakFixture() {
  const input = fixture();
  input.blocks[0] = { ...input.blocks[0], pageBorders: undefined } as FlowBlock;
  const measure = input.measures[1] as ParagraphMeasure;
  const shortMeasure = { ...measure, totalHeight: 10, lines: measure.lines.slice(0, 1) };
  input.measures[1] = shortMeasure;
  input.blocks.splice(2, 0, { kind: 'pageBreak', id: 'manual-break' });
  input.measures.splice(2, 0, { kind: 'pageBreak' });
  input.blocks.push(
    { kind: 'sectionBreak', id: 'section-2', type: 'nextPage', attrs: { sectionIndex: 2 }, pageBorders: borders },
    { kind: 'paragraph', id: 'last', runs: [{ text: 'Later section first page' }] },
  );
  input.measures.push({ kind: 'sectionBreak' }, shortMeasure);
  return input;
}

describe('section page border display', () => {
  it('keeps physical and section page numbers stable when a manual break page is replaced', async () => {
    const input = manualBreakFixture();
    const cold = layoutDocument(input.blocks, input.measures, options);
    expect(
      cold.pages.map((page) => [page.number, page.displayNumber, page.sectionIndex, page.sectionPageNumber]),
    ).toEqual([
      [1, 1, 0, 1],
      [2, 2, 1, 1],
      [3, 3, 1, 2],
      [4, 4, 2, 1],
    ]);
    expect(cold.pages.map((page) => page.pageBorders)).toEqual([undefined, borders, undefined, borders]);
    const continuation = createLayoutDocumentContinuation(input.blocks, input.measures, options);
    try {
      while (true) {
        const batch = await continuation.advance({ pageCount: 1 });
        expect(batch.layout.pages).toEqual(cold.pages.slice(0, batch.layout.pages.length));
        if (batch.status === 'complete') break;
      }
    } finally {
      continuation.dispose();
    }
  });

  it('honors a section numbering restart when rebuilding the manual-break page', () => {
    const input = manualBreakFixture();
    input.blocks[3] = { ...input.blocks[3], numbering: { start: 7, format: 'decimal' } } as FlowBlock;
    const layout = layoutDocument(input.blocks, input.measures, options);
    expect(layout.pages.map((page) => page.displayNumber)).toEqual([1, 7, 8, 9]);
    expect(layout.pages.map((page) => page.sectionPageNumber)).toEqual([1, 1, 2, 1]);
    expect(layout.pages.map((page) => page.pageBorders)).toEqual([undefined, borders, undefined, borders]);
  });

  it('applies firstPage to each owning section rather than document page one', () => {
    const input = fixture();
    const layout = layoutDocument(input.blocks, input.measures, options);
    expect(layout.pages.map((page) => [page.sectionIndex, page.sectionPageNumber])).toEqual([
      [0, 1],
      [0, 2],
      [1, 1],
      [1, 2],
    ]);
    expect(layout.pages.map((page) => page.pageBorders)).toEqual([borders, undefined, borders, undefined]);
  });

  for (const display of [undefined, 'allPages'] as const) {
    it(`keeps ${display ?? 'default'} borders within their owning section`, () => {
      const allPages = { ...borders, display };
      const input = fixture(allPages);
      input.blocks[2] = { ...input.blocks[2], pageBorders: undefined } as FlowBlock;
      const layout = layoutDocument(input.blocks, input.measures, options);
      expect(layout.pages.map((page) => page.pageBorders)).toEqual([allPages, allPages, undefined, undefined]);
    });
  }

  it('publishes the same eligible borders in every progressive prefix', async () => {
    const input = fixture();
    const cold = layoutDocument(input.blocks, input.measures, options);
    const continuation = createLayoutDocumentContinuation(input.blocks, input.measures, options);
    let prefixes = 0;
    try {
      while (true) {
        const batch = await continuation.advance({ pageCount: 1 });
        expect(batch.layout.pages).toEqual(cold.pages.slice(0, batch.layout.pages.length));
        expect(batch.layout.pages.map((page) => Boolean(page.pageBorders))).toEqual(
          [true, false, true, false].slice(0, batch.layout.pages.length),
        );
        if (batch.status === 'complete') break;
        prefixes += 1;
      }
      expect(prefixes).toBeGreaterThan(0);
    } finally {
      continuation.dispose();
    }
  });

  it('does not repeat a first-page frame on a resumed section suffix', () => {
    const input = fixture();
    const layout = layoutDocument(input.blocks.slice(0, 2), input.measures.slice(0, 2), {
      ...options,
      startContext: { pageNumberOffset: 4, activeSectionIndex: 0, activeSectionFirstPageNumber: 3 },
    });
    expect(layout.pages[0].sectionPageNumber).toBe(3);
    expect(layout.pages.every((page) => page.pageBorders === undefined)).toBe(true);
  });
});
