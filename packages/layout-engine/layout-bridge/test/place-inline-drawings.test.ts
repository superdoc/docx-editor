import { describe, expect, it } from 'vitest';
import type { DrawingBlock, DrawingMeasure, Layout, Line, ParagraphBlock, ParagraphMeasure } from '@superdoc/contracts';
import { placeInlineDrawings } from '../src/place-inline-drawings.js';

function fixture(alignment: 'left' | 'center' | 'right' = 'left') {
  const paragraph: ParagraphBlock = {
    kind: 'paragraph',
    id: 'paragraph',
    attrs: { alignment },
    runs: [
      { kind: 'text', text: 'before', fontSize: 16, fontFamily: 'Arial' },
      { kind: 'image', src: '', inlineDrawingId: 'shape', width: 100, height: 30, pmStart: 7, pmEnd: 8 },
      { kind: 'text', text: 'after', fontSize: 16, fontFamily: 'Arial' },
    ],
  };
  const drawing: DrawingBlock = {
    kind: 'drawing',
    id: 'shape',
    drawingKind: 'textboxShape',
    geometry: { width: 100, height: 30 },
    attrs: { inlineParagraphRunIndex: 1, anchorParagraphId: 'paragraph', textboxId: 'tb0' },
    contentBlocks: [],
  };
  const line: Line = {
    fromRun: 0,
    fromChar: 0,
    toRun: 2,
    toChar: 5,
    width: 180,
    maxWidth: 400,
    ascent: 12,
    descent: 4,
    lineHeight: 30,
    segments: [
      { runIndex: 0, fromChar: 0, toChar: 6, width: 40 },
      { runIndex: 1, fromChar: 0, toChar: 1, width: 100 },
      { runIndex: 2, fromChar: 0, toChar: 5, width: 40 },
    ],
  };
  const paragraphMeasure: ParagraphMeasure = { kind: 'paragraph', lines: [line], totalHeight: 30 };
  const drawingMeasure: DrawingMeasure = {
    kind: 'drawing',
    inlineDrawing: true,
    drawingKind: 'textboxShape',
    width: 100,
    height: 30,
    naturalWidth: 100,
    naturalHeight: 30,
    geometry: { width: 100, height: 30 },
    scale: 1,
    contentMeasures: [],
  };
  const layout: Layout = {
    pageSize: { w: 600, h: 800 },
    pages: [
      {
        number: 1,
        fragments: [{ kind: 'para', blockId: 'paragraph', x: 50, y: 70, width: 400, fromLine: 0, toLine: 1 }],
      },
    ],
  };
  return { paragraph, drawing, line, paragraphMeasure, drawingMeasure, layout };
}

describe('inline drawing placement', () => {
  for (const rewriteKind of ['explicit', 'structural'] as const) {
    it.each([
      [1, true],
      [1, false],
      [-1, true],
      [-1, false],
    ] as const)(
      `uses adopted current drawing identities exactly once for an ordinal shift of %s with guarded payload %s (${rewriteKind})`,
      (delta, guardPayload) => {
        const f = fixture();
        const oldId = 'n/main:/word/document.xml/body/o60/drawing0';
        const id = `n/main:/word/document.xml/body/o${60 + delta}/drawing0`;
        f.drawing.id = id;
        const slot = f.paragraph.runs[1];
        if (slot.kind !== 'image') throw new Error('expected drawing slot');
        slot.inlineDrawingId = id;
        const blocks = [
          ...Array.from({ length: 90 }, (_, index) => ({ ...f.paragraph, id: `prefix-${index}`, runs: [] })),
          f.drawing,
          f.paragraph,
        ];
        const measures = [
          ...Array.from({ length: 90 }, () => f.paragraphMeasure),
          f.drawingMeasure,
          f.paragraphMeasure,
        ];
        const prior = placeInlineDrawings(f.layout, blocks, measures);
        const guarded = new Proxy(blocks, {
          get(target, key, receiver) {
            if (guardPayload && typeof key === 'string' && /^\d+$/.test(key) && Number(key) >= 90)
              throw new Error(`Read adopted drawing payload ${key}`);
            return Reflect.get(target, key, receiver);
          },
        });
        const rewrites =
          rewriteKind === 'explicit'
            ? new Map([
                [oldId, id],
                [id, `n/main:/word/document.xml/body/o${60 + delta * 2}/drawing0`],
              ])
            : new (class extends Map<string, string> {
                override get(key: string): string | undefined {
                  return key.replace(/\/o(\d+)\//u, (_, ordinal) => `/o${Number(ordinal) + delta}/`);
                }
              })();
        const output = placeInlineDrawings(
          prior,
          guarded,
          measures,
          new Map([
            [id, 90],
            [f.paragraph.id, 91],
          ]),
          {
            tail: { startPageIndex: 0, endPageIndexExclusive: 1, blockIdRewrites: rewrites },
          },
        );
        expect(output).toBe(prior);
        expect(output.pages[0].fragments.filter((fragment) => fragment.kind === 'drawing')).toEqual(
          prior.pages[0].fragments.filter((fragment) => fragment.kind === 'drawing'),
        );
      },
    );
  }

  it('does not read source body payload when lightweight measures contain no inline drawings', () => {
    const f = fixture();
    const guarded = new Proxy([f.paragraph], {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) throw new Error('Read unneeded source body payload');
        return Reflect.get(target, key, receiver);
      },
    });
    expect(placeInlineDrawings(f.layout, guarded, [f.paragraphMeasure])).toBe(f.layout);
  });

  it('does not materialize retained pages when lightweight measures contain no inline drawings', () => {
    const f = fixture();
    const layout: Layout = {
      ...f.layout,
      get pages() {
        throw new Error('Read retained pages without inline drawings');
      },
    };
    const blocks = new Proxy([f.paragraph], {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) throw new Error('Read unneeded source body payload');
        return Reflect.get(target, key, receiver);
      },
    });
    expect(
      placeInlineDrawings(layout, blocks, [f.paragraphMeasure], new Map([[f.paragraph.id, 0]]), {
        tail: { startPageIndex: 0, endPageIndexExclusive: 1 },
      }),
    ).toBe(layout);
  });

  it('places an inline drawing from targeted owner payloads while retaining an unread distant source tail', () => {
    const f = fixture();
    const blocks = [
      f.drawing,
      f.paragraph,
      ...Array.from({ length: 98 }, (_, index) => ({ ...f.paragraph, id: `tail-${index}` })),
    ];
    const measures = [f.drawingMeasure, f.paragraphMeasure, ...Array.from({ length: 98 }, () => f.paragraphMeasure)];
    const prior = placeInlineDrawings(f.layout, blocks, measures);
    const guarded = new Proxy(blocks, {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key) && Number(key) > 64)
          throw new Error(`Read distant source body ${key}`);
        return Reflect.get(target, key, receiver);
      },
    });
    const output = placeInlineDrawings(
      prior,
      guarded,
      measures,
      new Map([
        [f.paragraph.id, 1],
        [f.drawing.id, 0],
      ]),
    );
    expect(output.pages[0].fragments).toEqual(prior.pages[0].fragments);
    expect(output.pages[0].fragments.filter((fragment) => fragment.kind === 'drawing')).toHaveLength(1);
  });

  it('retains a placed drawing in an adopted distant tail without materializing its source payload', () => {
    const f = fixture();
    const tail = Array.from({ length: 90 }, (_, index) => ({ ...f.paragraph, id: `prefix-${index}`, runs: [] }));
    const blocks = [...tail, f.drawing, f.paragraph];
    const measures = [...Array.from({ length: 90 }, () => f.paragraphMeasure), f.drawingMeasure, f.paragraphMeasure];
    const layout = {
      ...f.layout,
      pages: [
        { number: 1, fragments: [] },
        { ...f.layout.pages[0], number: 2 },
      ],
    };
    const prior = placeInlineDrawings(layout, blocks, measures);
    const guarded = new Proxy(blocks, {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key) && Number(key) > 64)
          throw new Error(`Read retained distant source ${key}`);
        return Reflect.get(target, key, receiver);
      },
    });
    const output = placeInlineDrawings(
      prior,
      guarded,
      measures,
      new Map([
        [f.drawing.id, 90],
        [f.paragraph.id, 91],
      ]),
      { tail: { startPageIndex: 1, endPageIndexExclusive: 2 } },
    );
    expect(output).toBe(prior);
    expect(output.pages[1].fragments.filter((fragment) => fragment.kind === 'drawing')).toHaveLength(1);
  });

  for (const retained of ['prefix', 'tail'] as const) {
    it(`preserves the ${retained} drawing when its owner paragraph continues onto the active page`, () => {
      const f = fixture();
      const slot = f.paragraph.runs[1];
      if (slot.kind !== 'image') throw new Error('expected drawing slot');
      f.paragraph.runs = [slot, { ...slot, inlineDrawingId: 'second-shape' }];
      const drawing = { ...f.drawing, id: 'second-shape', attrs: { ...f.drawing.attrs, inlineParagraphRunIndex: 1 } };
      const lines = [0, 1].map((runIndex) => ({
        ...f.line,
        fromRun: runIndex,
        fromChar: 0,
        toRun: runIndex,
        toChar: 1,
        width: 100,
        segments: [{ runIndex, fromChar: 0, toChar: 1, width: 100 }],
      }));
      f.paragraphMeasure.lines = lines;
      f.paragraphMeasure.totalHeight = 60;
      const fragment = f.layout.pages[0].fragments[0];
      if (fragment.kind !== 'para') throw new Error('expected paragraph');
      f.layout.pages = [0, 1].map((index) => ({
        number: index + 1,
        fragments: [{ ...fragment, fromLine: index, toLine: index + 1 }],
      }));
      const blocks = [f.drawing, drawing, f.paragraph];
      const measures = [f.drawingMeasure, { ...f.drawingMeasure }, f.paragraphMeasure];
      const prior = placeInlineDrawings(f.layout, blocks, measures);
      const output = placeInlineDrawings(
        prior,
        blocks,
        measures,
        new Map(blocks.map((block, index) => [block.id, index])),
        retained === 'prefix' ? { prefixEndPageIndex: 1 } : { tail: { startPageIndex: 1, endPageIndexExclusive: 2 } },
      );
      expect(
        output.pages.map((page) =>
          page.fragments.filter((candidate) => candidate.kind === 'drawing').map((candidate) => candidate.blockId),
        ),
      ).toEqual([['shape'], ['second-shape']]);
      expect(output.pages[retained === 'prefix' ? 0 : 1]).toBe(prior.pages[retained === 'prefix' ? 0 : 1]);
    });
  }
  for (const [alignment, expected] of [
    ['left', 90],
    ['center', 200],
    ['right', 310],
  ] as const) {
    it(`uses the ${alignment} paragraph's measured inline slot`, () => {
      const f = fixture(alignment);
      const output = placeInlineDrawings(f.layout, [f.drawing, f.paragraph], [f.drawingMeasure, f.paragraphMeasure]);
      expect(output.pages[0].fragments[1]).toMatchObject({
        kind: 'drawing',
        blockId: 'shape',
        x: expected,
        y: 70,
        width: 100,
        height: 30,
        textboxId: 'tb0',
        contentMeasures: [],
        pmStart: 7,
        pmEnd: 8,
      });
      expect(f.layout.pages[0].fragments).toHaveLength(1);
      expect(
        placeInlineDrawings(output, [f.drawing, f.paragraph], [f.drawingMeasure, f.paragraphMeasure]).pages[0]
          .fragments,
      ).toEqual(output.pages[0].fragments);
    });
  }

  it('uses the current wrapped line and its measured baseline alignment', () => {
    const f = fixture();
    const run = f.paragraph.runs[1];
    if (run.kind !== 'image') throw new Error('expected inline drawing slot');
    run.height = 8;
    f.drawingMeasure.height = 8;
    f.drawingMeasure.geometry.height = 8;
    const first = {
      ...f.line,
      fromRun: 0,
      toRun: 0,
      toChar: 6,
      lineHeight: 20,
      width: 40,
      segments: f.line.segments!.slice(0, 1),
    };
    const second = {
      ...f.line,
      fromRun: 1,
      toRun: 2,
      width: 140,
      lineHeight: 20,
      segments: f.line.segments!.slice(1),
      inlineImageAlignments: [{ runIndex: 1, verticalAlign: 'baseline' as const }],
    };
    const fragment = f.layout.pages[0].fragments[0];
    if (fragment.kind !== 'para') throw new Error('expected paragraph');
    fragment.toLine = 2;
    fragment.lines = [first, second];
    const output = placeInlineDrawings(f.layout, [f.paragraph, f.drawing], [f.paragraphMeasure, f.drawingMeasure]);
    expect(output.pages[0].fragments[1]).toMatchObject({ x: 50, y: 96, height: 8 });
  });

  it('respects explicit segment positioning and paragraph indents', () => {
    const f = fixture();
    f.paragraph.attrs = { indent: { left: 25 } };
    f.line.segments![1].x = 150;
    const output = placeInlineDrawings(f.layout, [f.paragraph, f.drawing], [f.paragraphMeasure, f.drawingMeasure]);
    expect(output.pages[0].fragments[1]).toMatchObject({ x: 225, y: 70 });
  });
});
