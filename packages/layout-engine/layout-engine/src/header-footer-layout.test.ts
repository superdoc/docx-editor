import { describe, expect, it } from 'bun:test';
import type {
  FlowBlock,
  Fragment,
  ImageBlock,
  ImageFragment,
  ImageMeasure,
  Layout,
  ListMeasure,
  Measure,
  ParagraphBlock,
  ParagraphFrame,
  ParagraphMeasure,
  TableBlock,
  TableFragment,
} from '@superdoc/contracts';
import { buildLayoutSourceIdentityForFragment } from '@superdoc/contracts';
import {
  collectNonFlowPagePositionedParagraphFrameIds,
  computeFragmentBottom,
  finalizeHeaderFooterLayout,
  shouldExcludeFromMeasurement,
  type HeaderFooterMeasurementConstraints,
} from './header-footer-layout.js';

const constraints: HeaderFooterMeasurementConstraints = {
  width: 500,
  pageWidth: 600,
  pageHeight: 800,
  margins: { left: 50, right: 50, top: 60, bottom: 70 },
};

function lines(...heights: number[]): ParagraphMeasure {
  return {
    kind: 'paragraph',
    totalHeight: heights.reduce((sum, height) => sum + height, 0),
    lines: heights.map((lineHeight) => ({
      fromRun: 0,
      fromChar: 0,
      toRun: 0,
      toChar: 1,
      width: 100,
      ascent: lineHeight - 4,
      descent: 4,
      lineHeight,
    })),
  };
}

function paragraph(id: string, spacingAfter?: number, frame?: ParagraphFrame): ParagraphBlock {
  return {
    kind: 'paragraph',
    id,
    runs: [],
    attrs: { ...(spacingAfter == null ? {} : { spacing: { after: spacingAfter } }), ...(frame ? { frame } : {}) },
  };
}

function para(blockId: string, y: number, fromLine: number, toLine: number): Fragment {
  return { kind: 'para', blockId, fromLine, toLine, x: 0, y, width: 100 };
}

function image(anchor: ImageBlock['anchor'], wrap?: ImageBlock['wrap']): ImageBlock {
  return { kind: 'image', id: 'img', src: 'data:', anchor: { isAnchored: true, ...anchor }, ...(wrap ? { wrap } : {}) };
}

function imageFragment(y: number, height: number, x = 0, width = 100, isAnchored = true): ImageFragment {
  return { kind: 'image', blockId: 'img', x, y, width, height, isAnchored };
}

function floatingTable(vRelativeFrom: 'page' | 'paragraph'): TableBlock {
  return { kind: 'table', id: 'tbl', rows: [], anchor: { isAnchored: true, vRelativeFrom } };
}

function tableFragment(y: number, height: number, isAnchored = true): TableFragment {
  return { kind: 'table', blockId: 'tbl', fromRow: 0, toRow: 1, x: 0, y, width: 100, height, isAnchored };
}

const canvasHeight = 100;

function excluded(fragment: Fragment, block: FlowBlock, kind: 'header' | 'footer' | undefined): boolean {
  return shouldExcludeFromMeasurement(
    fragment,
    block,
    computeFragmentBottom(fragment, block, undefined),
    canvasHeight,
    kind,
    constraints,
  );
}

describe('computeFragmentBottom', () => {
  it('adds the paragraph spacing after only on the fragment that ends the paragraph', () => {
    const block = paragraph('p', 6);
    const measure = lines(10, 12, 14);
    expect(computeFragmentBottom(para('p', 5, 0, 2), block, measure)).toBe(27);
    expect(computeFragmentBottom(para('p', 5, 2, 3), block, measure)).toBe(25);
  });

  it('never subtracts a negative spacing after', () => {
    expect(computeFragmentBottom(para('p', 0, 0, 1), paragraph('p', -8), lines(10))).toBe(10);
  });

  it('leaves a paragraph fragment at its top without a paragraph measure', () => {
    expect(computeFragmentBottom(para('p', 7, 0, 1), paragraph('p', 6), undefined)).toBe(7);
  });

  it('counts a table fragment height (SD-1581)', () => {
    expect(computeFragmentBottom(tableFragment(3, 40, false), floatingTable('paragraph'), undefined)).toBe(43);
  });

  it('sums the list item lines the fragment covers', () => {
    const measure: ListMeasure = {
      kind: 'list',
      totalHeight: 30,
      items: [{ itemId: 'item', markerWidth: 0, markerTextWidth: 0, indentLeft: 0, paragraph: lines(10, 20) }],
    };
    const fragment: Fragment = {
      kind: 'list-item',
      blockId: 'list',
      itemId: 'item',
      fromLine: 1,
      toLine: 2,
      x: 0,
      y: 2,
      width: 100,
      markerWidth: 0,
    };
    const block: FlowBlock = { kind: 'list', id: 'list', listType: 'bullet', items: [] };
    expect(computeFragmentBottom(fragment, block, measure)).toBe(22);
  });
});

describe('collectNonFlowPagePositionedParagraphFrameIds', () => {
  const pageFrame = (wrap: string, y: number): ParagraphFrame => ({ wrap, vAnchor: 'page', y });

  function ids(
    blocks: ParagraphBlock[],
    kind: 'header' | 'footer' | undefined,
    regionConstraints: HeaderFooterMeasurementConstraints = constraints,
  ): string[] {
    const measures: Measure[] = blocks.map(() => lines(20));
    return [...collectNonFlowPagePositionedParagraphFrameIds(blocks, measures, kind, regionConstraints)];
  }

  it('keeps every frame in flow outside a header or footer', () => {
    expect(ids([paragraph('none', 0, pageFrame('none', 10))], undefined)).toEqual([]);
  });

  it('keeps every frame in flow without a physical page height', () => {
    const { pageHeight: _unused, ...withoutPage } = constraints;
    expect(ids([paragraph('none', 0, pageFrame('none', 10))], 'header', withoutPage)).toEqual([]);
  });

  it('takes a wrap-none page frame out of flow wherever it sits', () => {
    expect(ids([paragraph('none', 0, pageFrame('none', 10))], 'header')).toEqual(['none']);
  });

  it('takes a wrap-around page frame out of flow only when it misses the header margin band', () => {
    expect(ids([paragraph('inside', 0, pageFrame('around', 30))], 'header')).toEqual([]);
    expect(ids([paragraph('below', 0, pageFrame('around', 60))], 'header')).toEqual(['below']);
  });

  it('counts the frame spacing after toward its footprint', () => {
    expect(ids([paragraph('reaches', 15, pageFrame('around', -30))], 'header')).toEqual([]);
    expect(ids([paragraph('short', 0, pageFrame('around', -30))], 'header')).toEqual(['short']);
  });

  it('measures a footer frame from the top of the bottom margin', () => {
    expect(ids([paragraph('inside', 0, pageFrame('around', 740))], 'footer')).toEqual([]);
    expect(ids([paragraph('above', 0, pageFrame('around', 700))], 'footer')).toEqual(['above']);
  });

  it('keeps a wrap-around frame in flow when the region has no margin band', () => {
    const { margins: _unused, ...withoutMargins } = constraints;
    expect(ids([paragraph('far', 0, pageFrame('around', 400))], 'header', withoutMargins)).toEqual([]);
  });

  it('decides wrap-none frames and frames without a margin band before reading their lines', () => {
    const unreadable = lines(20);
    Object.defineProperty(unreadable, 'lines', {
      get() {
        throw new Error('lines read');
      },
    });
    const { margins: _unused, ...withoutMargins } = constraints;
    const none = [paragraph('none', 0, pageFrame('none', 10))];
    const around = [paragraph('around', 0, pageFrame('around', 400))];
    expect([...collectNonFlowPagePositionedParagraphFrameIds(none, [unreadable], 'header', constraints)]).toEqual([
      'none',
    ]);
    expect([...collectNonFlowPagePositionedParagraphFrameIds(around, [unreadable], 'header', withoutMargins)]).toEqual(
      [],
    );
    expect(() => collectNonFlowPagePositionedParagraphFrameIds(around, [unreadable], 'header', constraints)).toThrow(
      'lines read',
    );
  });

  it('reads the region margin band once, before checking the page height or the frames', () => {
    let reads = 0;
    const margins = {
      left: 0,
      right: 0,
      get top() {
        reads += 1;
        return 60;
      },
    };
    const frames = [paragraph('a', 0, pageFrame('around', 400)), paragraph('b', 0, pageFrame('around', 500))];
    collectNonFlowPagePositionedParagraphFrameIds(frames, [lines(20), lines(20)], 'header', { width: 500, margins });
    expect(reads).toBe(1);
    reads = 0;
    expect(ids(frames, 'header', { ...constraints, margins })).toEqual(['a', 'b']);
    expect(reads).toBe(1);
  });

  it('ignores frames that are not anchored to the page', () => {
    const marginFrame: ParagraphFrame = { wrap: 'none', vAnchor: 'margin', y: 10 };
    expect(ids([paragraph('margin', 0, marginFrame)], 'header')).toEqual([]);
  });
});

describe('shouldExcludeFromMeasurement', () => {
  it('leaves a page-positioned floating table out of footer measurement only', () => {
    expect(excluded(tableFragment(0, 20), floatingTable('page'), 'footer')).toBe(true);
    expect(excluded(tableFragment(0, 20), floatingTable('page'), 'header')).toBe(false);
    expect(excluded(tableFragment(0, 20, false), floatingTable('page'), 'footer')).toBe(false);
    expect(excluded(tableFragment(0, 20), floatingTable('paragraph'), 'footer')).toBe(false);
  });

  it('applies the page-frame flow rule to measured paragraph fragments', () => {
    const none = paragraph('p', 0, { wrap: 'none', vAnchor: 'page', y: 10 });
    const around = paragraph('p', 0, { wrap: 'around', vAnchor: 'page', y: 10 });
    expect(excluded(para('p', 10, 0, 0), none, 'header')).toBe(true);
    expect(excluded(para('p', 10, 0, 0), none, undefined)).toBe(false);
    expect(shouldExcludeFromMeasurement(para('p', 10, 0, 1), around, 30, canvasHeight, 'header', constraints)).toBe(
      false,
    );
    expect(shouldExcludeFromMeasurement(para('p', 70, 0, 1), around, 90, canvasHeight, 'header', constraints)).toBe(
      true,
    );
  });

  it('measures ordinary paragraphs and inline graphics', () => {
    expect(excluded(para('p', 500, 0, 0), paragraph('p'), 'header')).toBe(false);
    expect(excluded(imageFragment(500, 20, 0, 100, false), image({ behindDoc: true }), 'header')).toBe(false);
  });

  it('rejects an anchored graphic fragment whose block is not a graphic', () => {
    expect(() => excluded(imageFragment(0, 10), paragraph('img'), 'header')).toThrow('Type mismatch');
  });

  it('leaves a both-sides wrapped graphic beside the text band out of measurement', () => {
    const square = { type: 'Square' as const };
    expect(excluded(imageFragment(0, 20, 0, 40), image({ hRelativeFrom: 'page' }, square), 'header')).toBe(true);
    expect(excluded(imageFragment(0, 20, 0, 60), image({ hRelativeFrom: 'page' }, square), 'header')).toBe(false);
    expect(excluded(imageFragment(0, 20, -50, 40), image({ hRelativeFrom: 'column' }, square), 'header')).toBe(true);
    expect(excluded(imageFragment(0, 20, 0, 40), image({ hRelativeFrom: 'column' }, square), 'header')).toBe(false);
  });

  it('counts the wrap distance as part of a side graphic', () => {
    const graphic = imageFragment(0, 20, 0, 40);
    expect(excluded(graphic, image({ hRelativeFrom: 'page' }, { type: 'Square', distRight: 15 }), 'header')).toBe(
      false,
    );
    expect(excluded(graphic, image({ hRelativeFrom: 'page' }, { type: 'Square', distRight: -1 }), 'header')).toBe(
      false,
    );
  });

  it('measures side graphics that wrap one side, wrap top and bottom, or lack page geometry', () => {
    const graphic = imageFragment(0, 20, 0, 40);
    const page = { hRelativeFrom: 'page' as const };
    expect(excluded(graphic, image(page, { type: 'Square', wrapText: 'left' }), 'header')).toBe(false);
    expect(excluded(graphic, image(page, { type: 'TopAndBottom' }), 'header')).toBe(false);
    expect(excluded(graphic, image(page, { type: 'Square' }), undefined)).toBe(false);
    const { pageWidth: _unused, ...withoutPageWidth } = constraints;
    expect(
      shouldExcludeFromMeasurement(
        graphic,
        image(page, { type: 'Square' }),
        20,
        canvasHeight,
        'header',
        withoutPageWidth,
      ),
    ).toBe(false);
  });

  it('leaves behind-text graphics out of measurement in any story', () => {
    expect(excluded(imageFragment(10, 20), image({ behindDoc: true }), undefined)).toBe(true);
  });

  it('leaves wrap-none graphics out of header and footer measurement', () => {
    expect(excluded(imageFragment(10, 20), image({}, { type: 'None' }), 'footer')).toBe(true);
    expect(excluded(imageFragment(10, 20), image({}, { type: 'None' }), undefined)).toBe(false);
  });

  it('leaves page-relative graphics outside the measurement canvas out of measurement', () => {
    expect(excluded(imageFragment(-30, 30), image({ vRelativeFrom: 'margin' }), undefined)).toBe(true);
    expect(excluded(imageFragment(canvasHeight, 10), image({ vRelativeFrom: 'margin' }), undefined)).toBe(true);
    expect(excluded(imageFragment(-30, 31), image({ vRelativeFrom: 'margin' }), undefined)).toBe(false);
    expect(excluded(imageFragment(-30, 30), image({ vRelativeFrom: 'paragraph' }), undefined)).toBe(false);
  });

  it('leaves page-anchored graphics that miss the region margin band out of measurement', () => {
    expect(excluded(imageFragment(65, 10), image({ vRelativeFrom: 'page' }), 'header')).toBe(true);
    expect(excluded(imageFragment(55, 10), image({ vRelativeFrom: 'page' }), 'header')).toBe(false);
    expect(excluded(imageFragment(75, 10), image({ vRelativeFrom: 'page' }), 'footer')).toBe(true);
    expect(excluded(imageFragment(65, 10), image({ vRelativeFrom: 'page' }), 'footer')).toBe(false);
  });
});

describe('finalizeHeaderFooterLayout', () => {
  function layoutOf(...pages: Fragment[][]): Layout {
    return { pageSize: { w: 500, h: 100 }, pages: pages.map((fragments, index) => ({ number: index + 1, fragments })) };
  }

  const text = paragraph('text');
  const textMeasure = lines(20);
  const behind = image({ behindDoc: true });
  const behindMeasure: ImageMeasure = { kind: 'image', width: 100, height: 200 };

  it('measures pagination height without excluded fragments but renders all of them', () => {
    const result = finalizeHeaderFooterLayout(
      layoutOf([para('text', 10, 0, 1), imageFragment(-40, 200)], [para('text', 0, 0, 1)]),
      [text, behind],
      [textMeasure, behindMeasure],
      { width: 500 },
      canvasHeight,
      undefined,
    );
    expect(result).toMatchObject({ height: 30, minY: -40, maxY: 160, renderHeight: 200 });
    expect(result.pages).toEqual([
      { number: 1, fragments: expect.any(Array), measurementHeight: 30, minY: -40, maxY: 160, renderHeight: 200 },
      { number: 2, fragments: expect.any(Array), measurementHeight: 20, minY: 0, maxY: 20, renderHeight: 20 },
    ]);
  });

  it('skips fragments whose block is not in the story', () => {
    const result = finalizeHeaderFooterLayout(
      layoutOf([{ ...para('text', 0, 0, 1), blockId: 'missing' }]),
      [text],
      [textMeasure],
      { width: 500 },
      canvasHeight,
      'header',
    );
    expect(result.height).toBe(0);
  });

  it('stamps a story identity on fragments only for headers and footers', () => {
    const body = finalizeHeaderFooterLayout(
      layoutOf([para('text', 0, 0, 1)]),
      [text],
      [textMeasure],
      { width: 500 },
      canvasHeight,
      undefined,
    );
    expect(body.pages[0].fragments[0].layoutSourceIdentity).toBeUndefined();
    const footer = finalizeHeaderFooterLayout(
      layoutOf([para('text', 0, 0, 1)]),
      [text],
      [textMeasure],
      { width: 500 },
      canvasHeight,
      'footer',
    );
    const { layoutSourceIdentity, ...fragment } = footer.pages[0].fragments[0];
    expect(layoutSourceIdentity).toEqual(buildLayoutSourceIdentityForFragment(fragment, { kind: 'footer' }));
    expect(layoutSourceIdentity).not.toEqual(buildLayoutSourceIdentityForFragment(fragment, { kind: 'header' }));
    const header = finalizeHeaderFooterLayout(
      layoutOf([para('text', 0, 0, 1)]),
      [text],
      [textMeasure],
      { width: 500 },
      canvasHeight,
      'header',
    );
    const { layoutSourceIdentity: headerIdentity, ...headerFragment } = header.pages[0].fragments[0];
    expect(headerIdentity).toEqual(buildLayoutSourceIdentityForFragment(headerFragment, { kind: 'header' }));
  });
});
