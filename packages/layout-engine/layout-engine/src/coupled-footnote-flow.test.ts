import { describe, expect, it } from 'bun:test';
import type { FlowBlock, Measure, ParagraphBlock } from '@superdoc/contracts';
import { layoutDocument, type FootnotePageFlow, type LayoutOptions } from './index';

const paragraph = (id: string, attrs: ParagraphBlock['attrs'] = {}): ParagraphBlock => ({
  kind: 'paragraph',
  id,
  attrs,
  runs: [{ text: 'abc', fontFamily: 'Arial', fontSize: 12, pmStart: 0, pmEnd: 3 }],
});

const measure = (lineHeight: number, count = 1): Measure => ({
  kind: 'paragraph',
  lines: Array.from({ length: count }, (_, index) => ({
    fromRun: 0,
    toRun: 0,
    fromChar: index,
    toChar: index + 1,
    width: 50,
    ascent: lineHeight * 0.8,
    descent: lineHeight * 0.2,
    lineHeight,
  })),
  totalHeight: lineHeight * count,
});

const pageOptions: LayoutOptions = {
  pageSize: { w: 240, h: 220 },
  margins: { top: 10, bottom: 10, left: 10, right: 10 },
};

const flowObserver = (incomingHeight = 0) => {
  const completed: Parameters<FootnotePageFlow['completePage']>[0][] = [];
  const flow: FootnotePageFlow = {
    incomingDemand: (pageIndex) => ({
      height: pageIndex === 0 ? incomingHeight : 0,
      refs: pageIndex === 0 && incomingHeight > 0 ? 1 : 0,
    }),
    completePage: (page) => completed.push(page),
    hasPendingContinuation: () => false,
  };
  return { flow, completed };
};

const withNote = (blockId: string, height: number): NonNullable<LayoutOptions['footnotes']> => ({
  refs: [{ id: 'note', pos: 0, blockId, runOrdinal: 0 }],
  bodyHeightById: new Map([['note', height]]),
  firstLineHeightById: new Map([['note', 10]]),
  topPadding: 0,
  dividerHeight: 0,
  separatorSpacingBefore: 0,
  gap: 0,
});

const pagesForBlock = (layout: ReturnType<typeof layoutDocument>, id: string) =>
  layout.pages.flatMap((page, index) => (page.fragments.some((fragment) => fragment.blockId === id) ? [index] : []));

describe('coupled body and footnote page flow', () => {
  it.each([
    { height: 160, before: 0, nextHeight: 30 },
    { height: 140, before: 60, nextHeight: 40 },
  ])('does not charge uncommitted paragraph spacing to the completed body (%j)', ({ height, before, nextHeight }) => {
    const { flow, completed } = flowObserver();
    const blocks = [paragraph('prefix', { spacing: { after: 20 } }), paragraph('next', { spacing: { before } })];
    const result = layoutDocument(blocks, [measure(height), measure(nextHeight)], {
      ...pageOptions,
      footnotePageFlow: flow,
    });
    expect(pagesForBlock(result, 'next')).toEqual([1]);
    expect(completed[0].bodyBottom).toBe(10 + height);
    expect(result.pages[0].bodyMaxY).toBe(10 + height);
  });

  it('adds incoming note content to fresh-anchor demand before accepting body lines', () => {
    const { flow, completed } = flowObserver(50);
    const blocks: FlowBlock[] = Array.from({ length: 8 }, (_, index) => paragraph('body-' + index));

    const result = layoutDocument(
      blocks,
      blocks.map(() => measure(25)),
      {
        ...pageOptions,
        footnotes: withNote('body-0', 40),
        footnotePageFlow: flow,
      },
    );

    expect(result.pages[0].fragments).toHaveLength(4);
    expect(completed).toHaveLength(result.pages.length);
    expect(completed[0].bodyBottom).toBe(110);
    expect(completed[0].anchors.map((anchor) => anchor.refId)).toEqual(['note']);
    expect(completed[0].physicalBottom).toBe(210);
  });

  it('keeps a heading with the widow-protected start of a note-bearing paragraph', () => {
    const { flow } = flowObserver();
    const blocks = [paragraph('prefix'), paragraph('heading', { keepNext: true }), paragraph('anchor')];

    const result = layoutDocument(blocks, [measure(80), measure(20), measure(20, 3)], {
      ...pageOptions,
      footnotes: withNote('anchor', 60),
      footnotePageFlow: flow,
    });

    expect(pagesForBlock(result, 'prefix')).toEqual([0]);
    expect(pagesForBlock(result, 'heading')).toEqual([1]);
    expect(pagesForBlock(result, 'anchor')[0]).toBe(1);
  });

  it('preserves ordinary keepNext pagination when the coupled flow has no note demand', () => {
    const { flow } = flowObserver();
    const blocks = [paragraph('prefix'), paragraph('heading', { keepNext: true }), paragraph('anchor')];
    const measures = [measure(130), measure(20), measure(20, 3)];

    const legacy = layoutDocument(blocks, measures, pageOptions);
    const coupled = layoutDocument(blocks, measures, {
      ...pageOptions,
      footnotePageFlow: flow,
    });

    expect(pagesForBlock(legacy, 'heading')).toEqual([0]);
    expect(pagesForBlock(coupled, 'heading')).toEqual(pagesForBlock(legacy, 'heading'));
    expect(pagesForBlock(coupled, 'anchor')).toEqual(pagesForBlock(legacy, 'anchor'));
  });

  it('keeps a keepLines anchor with its keepNext predecessor without note demand', () => {
    const { flow } = flowObserver();
    const blocks = [
      paragraph('prefix'),
      paragraph('heading', { keepNext: true }),
      paragraph('anchor', { keepLines: true }),
    ];
    const measures = [measure(130), measure(20), measure(20, 3)];

    const legacy = layoutDocument(blocks, measures, pageOptions);
    const coupled = layoutDocument(blocks, measures, {
      ...pageOptions,
      footnotePageFlow: flow,
    });

    expect(pagesForBlock(legacy, 'heading')).toEqual([1]);
    expect(pagesForBlock(coupled, 'heading')).toEqual([1]);
    expect(pagesForBlock(legacy, 'anchor')).toEqual([1]);
    expect(pagesForBlock(coupled, 'anchor')).toEqual([1]);
  });

  it('honors keepLines against the same note budget even when widow control is off', () => {
    const { flow } = flowObserver();
    const blocks = [paragraph('prefix'), paragraph('kept', { keepLines: true, widowControl: false })];

    const result = layoutDocument(blocks, [measure(100), measure(20, 3)], {
      ...pageOptions,
      footnotes: withNote('kept', 60),
      footnotePageFlow: flow,
    });

    expect(pagesForBlock(result, 'kept')).toEqual([1]);
    expect(result.pages[1].fragments.find((fragment) => fragment.blockId === 'kept')).toMatchObject({
      fromLine: 0,
      toLine: 3,
    });
  });

  it('finishes the actual EOF page and preserves subsequent note-only continuation pages', () => {
    const completed: number[] = [];
    let pending = 0;
    const flow: FootnotePageFlow = {
      incomingDemand: () => ({ height: pending * 50, refs: pending > 0 ? 1 : 0 }),
      completePage: ({ page, pageIndex }) => {
        completed.push(pageIndex);
        pending = pageIndex === 0 ? 2 : pending - 1;
        page.footnoteReserved = 50;
      },
      hasPendingContinuation: () => pending > 0,
    };

    const result = layoutDocument([paragraph('body')], [measure(20)], {
      ...pageOptions,
      footnotePageFlow: flow,
    });

    expect(completed).toEqual([0, 1, 2]);
    expect(result.pages).toHaveLength(3);
    expect(result.pages.map((page) => page.number)).toEqual([1, 2, 3]);
    expect(result.pages.slice(1).every((page) => page.fragments.length === 0)).toBe(true);
    expect(pending).toBe(0);
  });
});
