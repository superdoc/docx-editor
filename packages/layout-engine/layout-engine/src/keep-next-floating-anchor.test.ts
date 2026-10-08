import { describe, expect, it } from 'bun:test';
import type {
  FlowBlock,
  ImageBlock,
  Measure,
  ParagraphBlock,
  ParagraphMeasure,
  TextboxDrawing,
  VectorShapeDrawing,
} from '@superdoc/contracts';
import { layoutDocument } from './index.js';

function paragraph(
  id: string,
  height: number,
  attrs: ParagraphBlock['attrs'] = {},
): [ParagraphBlock, ParagraphMeasure] {
  return [
    { kind: 'paragraph', id, runs: [{ text: id, fontFamily: 'Calibri', fontSize: 11 }], attrs },
    {
      kind: 'paragraph',
      totalHeight: height,
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: id.length,
          width: 100,
          maxWidth: 500,
          ascent: height - 4,
          descent: 4,
          lineHeight: height,
        },
      ],
    },
  ];
}

function document({ floating = true, filler = 390, following = 20, chain = false } = {}) {
  const blocks: FlowBlock[] = [],
    measures: Measure[] = [];
  const add = (pair: [FlowBlock, Measure]) => {
    blocks.push(pair[0]);
    measures.push(pair[1]);
  };
  if (filler) add(paragraph('filler', filler));
  add(paragraph('heading', 26, { keepNext: true, keepLines: true, spacing: { before: 32, after: 0 } }));
  const image: ImageBlock = {
    kind: 'image',
    id: 'picture',
    src: 'generated.png',
    width: 20,
    height: 70,
    wrap: { type: floating ? 'None' : 'Inline' },
    ...(floating
      ? { anchor: { isAnchored: true, hRelativeFrom: 'page', vRelativeFrom: 'page', offsetH: 0, offsetV: 100 } }
      : {}),
  };
  add([image, { kind: 'image', width: 20, height: 70 }]);
  add(paragraph('following', following, { keepNext: chain, spacing: { before: 0, after: 0 } }));
  if (chain) add(paragraph('last', following, { spacing: { before: 0, after: 0 } }));
  return layoutDocument(blocks, measures, {
    pageSize: { w: 600, h: 600 },
    margins: { top: 50, bottom: 50, left: 50, right: 50 },
  });
}

function pageOf(layout: ReturnType<typeof document>, id: string) {
  return layout.pages.findIndex((page) => page.fragments.some((fragment) => fragment.blockId === id)) + 1;
}

describe('keepNext across floating anchors', () => {
  it('keeps the heading and following text on the current page without reserving a floating picture height', () => {
    const layout = document();
    expect(layout.pages).toHaveLength(1);
    expect(pageOf(layout, 'heading')).toBe(1);
    expect(pageOf(layout, 'following')).toBe(1);
    expect(layout.pages[0].fragments.filter((f) => f.blockId === 'picture')).toHaveLength(1);
  });

  it('reserves an inline picture and suppresses heading before-spacing after the automatic page move', () => {
    const layout = document({ floating: false });
    expect(layout.pages).toHaveLength(2);
    expect(pageOf(layout, 'heading')).toBe(2);
    expect(pageOf(layout, 'picture')).toBe(2);
    expect(pageOf(layout, 'following')).toBe(2);
    expect(layout.pages[1].fragments.find((f) => f.blockId === 'heading')?.y).toBe(50);
  });

  it('reserves the real following paragraph even when a floating object precedes it', () => {
    const layout = document({ following: 80 });
    expect(pageOf(layout, 'heading')).toBe(2);
    expect(pageOf(layout, 'following')).toBe(2);
  });

  it('continues a keepNext chain through a floating object to later real paragraphs', () => {
    const layout = document({ filler: 330, following: 100, chain: true });
    expect(pageOf(layout, 'heading')).toBe(2);
    expect(pageOf(layout, 'following')).toBe(2);
    expect(pageOf(layout, 'last')).toBe(2);
  });

  it('preserves authored before-spacing when the document starts on its first page', () => {
    const layout = document({ filler: 0 });
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0].fragments.find((f) => f.blockId === 'heading')?.y).toBe(82);
  });
});

function ownAnchorDocument({
  offset = 50.5,
  anchorBehind = false,
  wrapBehind = false,
  wrap = 'None',
  explicit = true,
  mixed = false,
  vector = false,
  vectorAttrs = {},
  textbox = false,
  textboxAttrs = {},
}: {
  offset?: number;
  anchorBehind?: boolean;
  wrapBehind?: boolean;
  wrap?: string;
  explicit?: boolean;
  mixed?: boolean;
  vector?: boolean;
  vectorAttrs?: Partial<VectorShapeDrawing>;
  textbox?: boolean;
  textboxAttrs?: Partial<TextboxDrawing>;
} = {}) {
  const heading = paragraph('heading', 26, { keepNext: true, keepLines: true, spacing: { before: 32, after: 0 } });
  const image: ImageBlock = {
    kind: 'image',
    id: 'own-picture',
    src: 'generated.png',
    width: 20,
    height: 70,
    anchor: {
      isAnchored: true,
      hRelativeFrom: 'page',
      ...(explicit ? { vRelativeFrom: 'paragraph' as const } : {}),
      offsetH: 100,
      offsetV: offset,
      behindDoc: anchorBehind,
    },
    wrap: { type: wrap as 'None' | 'Square', behindDoc: wrapBehind },
    attrs: { anchorParagraphId: 'heading' },
  };
  const graphic: FlowBlock = textbox
    ? {
        kind: 'drawing',
        id: image.id,
        drawingKind: 'textboxShape',
        geometry: { width: 20, height: 70 },
        shapeKind: 'rect',
        textWarp: { preset: 'textNoShape' },
        contentBlocks: [paragraph('BOX', 8)[0]],
        anchor: image.anchor,
        wrap: image.wrap,
        attrs: image.attrs,
        ...textboxAttrs,
      }
    : vector
      ? {
          kind: 'drawing',
          id: image.id,
          drawingKind: 'vectorShape',
          geometry: { width: 20, height: 70 },
          shapeKind: 'rect',
          anchor: image.anchor,
          wrap: image.wrap,
          attrs: image.attrs,
          ...vectorAttrs,
        }
      : image;
  const graphicMeasure: Measure =
    vector || textbox
      ? {
          kind: 'drawing',
          drawingKind: textbox ? 'textboxShape' : 'vectorShape',
          width: 20,
          height: 70,
          scale: 1,
          naturalWidth: 20,
          naturalHeight: 70,
          geometry: { width: 20, height: 70 },
        }
      : { kind: 'image', width: 20, height: 70 };
  const pairs: [FlowBlock, Measure][] = [paragraph('filler', 390), [graphic, graphicMeasure]];
  if (mixed)
    pairs.push([
      { ...image, id: 'behind-picture', anchor: { ...image.anchor, behindDoc: true } },
      { kind: 'image', width: 20, height: 70 },
    ]);
  pairs.push(heading, paragraph('following', 20, { spacing: { before: 0, after: 0 } }));
  return layoutDocument(
    pairs.map((pair) => pair[0]),
    pairs.map((pair) => pair[1]),
    {
      pageSize: { w: 600, h: 600 },
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
    },
  );
}

describe('own foreground paragraph anchors at the footer', () => {
  it('keeps a Word-qualified wrap-none foreground picture with its fitting heading', () => {
    const layout = ownAnchorDocument();
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0].fragments.find((fragment) => fragment.blockId === 'heading')?.y).toBe(472);
    expect(layout.pages[0].fragments.find((fragment) => fragment.blockId === 'own-picture')?.y).toBeCloseTo(490.5, 0);
    expect(pageOf(layout, 'following')).toBe(1);
  });
  it('preserves the contained foreground control', () => {
    expect(ownAnchorDocument({ offset: -100 }).pages).toHaveLength(1);
  });
  it('preserves fit when only the anchor declares behind-document placement', () => {
    expect(pageOf(ownAnchorDocument({ anchorBehind: true }), 'heading')).toBe(2);
  });
  it('preserves fit when only the wrap declares behind-document placement', () => {
    expect(pageOf(ownAnchorDocument({ wrapBehind: true }), 'heading')).toBe(2);
  });
  it('preserves foreground Square wrapping fit', () => {
    expect(pageOf(ownAnchorDocument({ wrap: 'Square' }), 'heading')).toBe(2);
  });
  it('preserves legacy unspecified vertical anchor fit', () => {
    expect(pageOf(ownAnchorDocument({ explicit: false }), 'heading')).toBe(2);
  });
  it('still fits a separate behind-document object in a mixed batch', () => {
    expect(pageOf(ownAnchorDocument({ mixed: true }), 'heading')).toBe(2);
  });
});

describe('Word-qualified own foreground vector anchors at the footer', () => {
  it('keeps a text-free rectangle crossing the footer with its fitting heading', () => {
    const layout = ownAnchorDocument({ vector: true });
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0].fragments.find((fragment) => fragment.blockId === 'heading')?.y).toBe(472);
    expect(layout.pages[0].fragments.find((fragment) => fragment.blockId === 'own-picture')?.y).toBeCloseTo(490.5, 0);
    expect(pageOf(layout, 'following')).toBe(1);
  });
  it('preserves the contained rectangle control', () => {
    const layout = ownAnchorDocument({ vector: true, offset: -100 });
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0].fragments.find((fragment) => fragment.blockId === 'heading')?.y).toBe(472);
    expect(layout.pages[0].fragments.find((fragment) => fragment.blockId === 'own-picture')?.y).toBe(340);
  });
  for (const control of [
    { anchorBehind: true },
    { wrapBehind: true },
    { wrap: 'Square' },
    { explicit: false },
    { mixed: true },
    { vectorAttrs: { textContent: { parts: [] } } },
    { vectorAttrs: { textWarp: { preset: 'textWave1' as const } } },
  ])
    it(`preserves existing fit for ${JSON.stringify(control)}`, () => {
      expect(pageOf(ownAnchorDocument({ vector: true, ...control }), 'heading')).toBe(2);
    });
});

describe('original-Word-qualified rectangular textbox own anchors', () => {
  for (const autoFit of [false, true]) {
    it(`keeps a no-shape-warp rectangle with its fitting paragraph, autoFit=${autoFit}`, () => {
      const layout = ownAnchorDocument({ textbox: true, textboxAttrs: { autoFit } });
      expect(layout.pages).toHaveLength(1);
      expect(layout.pages[0].fragments.find((f) => f.blockId === 'heading')?.y).toBe(472);
      expect(layout.pages[0].fragments.find((f) => f.blockId === 'own-picture')?.y).toBeCloseTo(490.5, 0);
      expect(pageOf(layout, 'following')).toBe(1);
    });
  }
  it('keeps a rectangle without authored text warp', () => {
    expect(ownAnchorDocument({ textbox: true, textboxAttrs: { textWarp: undefined } }).pages).toHaveLength(1);
  });
  it('preserves the contained rectangle control', () => {
    expect(ownAnchorDocument({ textbox: true, offset: -100 }).pages).toHaveLength(1);
  });
  for (const control of [
    { anchorBehind: true },
    { wrapBehind: true },
    { wrap: 'Square' },
    { explicit: false },
    { mixed: true },
    { textboxAttrs: { textWarp: { preset: 'textWave1' as const } } },
    { textboxAttrs: { shapeKind: 'wave' } },
    { textboxAttrs: { shapeKind: undefined } },
  ])
    it(`preserves unqualified own-anchor fit for ${JSON.stringify(control)}`, () => {
      expect(pageOf(ownAnchorDocument({ textbox: true, ...control }), 'heading')).toBe(2);
    });
});
