import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { FlowBlock, ParagraphBlock, ParagraphMeasure, SectionBreakBlock } from '@superdoc/contracts';
import { createDomMeasurementRuntime } from '@superdoc/measuring-dom';
import { resolveCanvas } from '@superdoc/measuring-dom/canvas-resolver';
import { incrementalLayout, measureCache } from '../src/incrementalLayout';

const makeParagraph = (id: string, text: string): FlowBlock => ({
  kind: 'paragraph',
  id,
  runs: [{ text, fontFamily: 'Arial', fontSize: 12 }],
});

const makeNoteReferenceParagraph = (text: string): FlowBlock => ({
  kind: 'paragraph',
  id: 'note-reference-paragraph',
  runs: [
    {
      kind: 'text',
      text,
      fontFamily: 'Arial',
      fontSize: 12,
      dataAttrs: { 'data-v2-note-ref': 'footnote:42' },
    },
  ],
});

const makeSectionBreak = (id: string, left: number, right: number): SectionBreakBlock => ({
  kind: 'sectionBreak',
  id,
  margins: { top: 20, right, bottom: 20, left },
});

describe('incrementalLayout previous-measure reuse', () => {
  beforeEach(() => {
    measureCache.clear();
  });

  it('reuses an equal-digit-count note marker only when the active face is proven tabular', async () => {
    const options = {
      pageSize: { w: 300, h: 400 },
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
      columns: { count: 1, gap: 0 },
    };
    const measureBlock = vi.fn(async () => ({
      kind: 'paragraph' as const,
      lines: [],
      totalHeight: 10,
    }));
    const fontContext = { fontSignature: 'tabular-face', resolvePhysical: (family: string) => family };
    const fontCapabilities = { hasTabularDigits: () => true };
    const previousBlocks = [makeNoteReferenceParagraph('1000')];
    const firstPass = await incrementalLayout([], null, previousBlocks, options, measureBlock, undefined, undefined, {
      fontContext,
      fontCapabilities,
    });
    expect(measureBlock).toHaveBeenCalledTimes(1);
    expect(measureCache.getSize()).toBe(1);
    const firstConstraints = measureBlock.mock.calls[0]![1];
    expect(
      measureCache.get(
        makeNoteReferenceParagraph('1001'),
        firstConstraints.maxWidth,
        firstConstraints.maxHeight,
        fontContext.fontSignature,
        fontCapabilities,
      ),
    ).toBeDefined();
    measureBlock.mockClear();

    await incrementalLayout(
      previousBlocks,
      firstPass.layout,
      [makeNoteReferenceParagraph('1001')],
      options,
      measureBlock,
      undefined,
      firstPass.measures,
      { fontContext, previousFontSignature: fontContext.fontSignature, fontCapabilities },
    );

    expect(measureBlock).not.toHaveBeenCalled();
  });

  it('remeasures note marker text without a measured digit capability', async () => {
    const options = {
      pageSize: { w: 300, h: 400 },
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
      columns: { count: 1, gap: 0 },
    };
    const measureBlock = vi.fn(async () => ({
      kind: 'paragraph' as const,
      lines: [],
      totalHeight: 10,
    }));
    const previousBlocks = [makeNoteReferenceParagraph('1000')];
    const firstPass = await incrementalLayout([], null, previousBlocks, options, measureBlock);
    measureBlock.mockClear();

    await incrementalLayout(
      previousBlocks,
      firstPass.layout,
      [makeNoteReferenceParagraph('1001')],
      options,
      measureBlock,
      undefined,
      firstPass.measures,
    );

    expect(measureBlock).toHaveBeenCalledTimes(1);
  });

  it('remeasures stable blocks when their section width changes even if global max constraints are unchanged', async () => {
    const options = {
      pageSize: { w: 300, h: 400 },
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
      columns: { count: 1, gap: 0 },
    };

    const intro = makeParagraph('intro', 'Intro paragraph');
    const sectionBreakBefore = makeSectionBreak('section-1', 60, 140); // 100px content width
    const sectionBreakAfter = makeSectionBreak('section-1', 80, 140); // 80px content width
    const body = makeParagraph('body', 'Body paragraph');

    const previousBlocks: FlowBlock[] = [intro, sectionBreakBefore, body];
    const nextBlocks: FlowBlock[] = [intro, sectionBreakAfter, body];

    const measureBlock = vi.fn(async (_block: FlowBlock, constraints: { maxWidth: number; maxHeight: number }) => {
      return {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 1,
            width: constraints.maxWidth,
            ascent: 8,
            descent: 2,
            lineHeight: 10,
          },
        ],
        totalHeight: 10,
      } satisfies ParagraphMeasure;
    });

    const firstPass = await incrementalLayout([], null, previousBlocks, options, measureBlock);
    const firstPassBodyMeasure = firstPass.measures[2] as ParagraphMeasure;
    expect(firstPassBodyMeasure.lines?.[0]?.width).toBe(100);

    measureBlock.mockClear();

    const secondPass = await incrementalLayout(
      previousBlocks,
      firstPass.layout,
      nextBlocks,
      options,
      measureBlock,
      undefined,
      firstPass.measures,
    );

    const secondPassBodyMeasure = secondPass.measures[2] as ParagraphMeasure;
    expect(secondPassBodyMeasure.lines?.[0]?.width).toBe(80);
    expect(measureBlock).toHaveBeenCalledTimes(1);
  });

  it('adopts previous measures by content under positional id churn (P8.4 structural keystrokes)', async () => {
    const options = {
      pageSize: { w: 300, h: 400 },
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
      columns: { count: 1, gap: 0 },
    };

    // Ten paragraphs under POSITIONAL ids (the paraId-less occurrence-ordinal
    // scheme). A structural insert at the front shifts every downstream block
    // onto the id its neighbor wore last pass: all ids look "known" while
    // every id-keyed lookup misses on content.
    const texts = Array.from({ length: 10 }, (_, i) => `paragraph text ${i}`);
    const previousBlocks: FlowBlock[] = texts.map((text, i) => makeParagraph(`w:p/${i}/o0`, text));
    const nextBlocks: FlowBlock[] = [
      makeParagraph('w:p/0/o0', 'the structurally inserted paragraph'),
      ...texts.map((text, i) => makeParagraph(`w:p/${i + 1}/o0`, text)),
    ];

    const measureBlock = vi.fn(async (_block: FlowBlock, constraints: { maxWidth: number; maxHeight: number }) => {
      return {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 1,
            width: constraints.maxWidth,
            ascent: 8,
            descent: 2,
            lineHeight: 10,
          },
        ],
        totalHeight: 10,
      } satisfies ParagraphMeasure;
    });

    const firstPass = await incrementalLayout([], null, previousBlocks, options, measureBlock);
    expect(measureBlock).toHaveBeenCalledTimes(10);
    measureBlock.mockClear();
    measureCache.clear(); // isolate the adoption path from the id-keyed cache

    const secondPass = await incrementalLayout(
      previousBlocks,
      firstPass.layout,
      nextBlocks,
      options,
      measureBlock,
      undefined,
      firstPass.measures,
    );

    // The genuinely-new content plus the pre-threshold misses DOM-measure;
    // everything past the miss threshold adopts by content. Without the
    // adoption every one of the 11 blocks would re-measure.
    expect(measureBlock.mock.calls.length).toBeLessThanOrEqual(5);
    expect(secondPass.measures).toHaveLength(11);
    for (const measure of secondPass.measures) {
      expect((measure as ParagraphMeasure).totalHeight).toBe(10);
    }
  });

  it('never adopts by content when the content genuinely changed (fail closed)', async () => {
    const options = {
      pageSize: { w: 300, h: 400 },
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
      columns: { count: 1, gap: 0 },
    };
    const previousBlocks: FlowBlock[] = Array.from({ length: 8 }, (_, i) =>
      makeParagraph(`w:p/${i}/o0`, `original ${i}`),
    );
    // Every block's content changes AND ids shift — nothing is adoptable.
    const nextBlocks: FlowBlock[] = Array.from({ length: 8 }, (_, i) => makeParagraph(`w:p/${i}/o1`, `rewritten ${i}`));
    const measureBlock = vi.fn(async (_block: FlowBlock, constraints: { maxWidth: number; maxHeight: number }) => {
      return {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 1,
            width: constraints.maxWidth,
            ascent: 8,
            descent: 2,
            lineHeight: 10,
          },
        ],
        totalHeight: 10,
      } satisfies ParagraphMeasure;
    });
    const firstPass = await incrementalLayout([], null, previousBlocks, options, measureBlock);
    measureBlock.mockClear();
    measureCache.clear();
    await incrementalLayout(
      previousBlocks,
      firstPass.layout,
      nextBlocks,
      options,
      measureBlock,
      undefined,
      firstPass.measures,
    );
    expect(measureBlock).toHaveBeenCalledTimes(8);
  });

  it('measures pre-section content using single-column width when a following section break omits columns', async () => {
    const options = {
      pageSize: { w: 300, h: 400 },
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
      columns: { count: 2, gap: 20 },
    };

    const intro = makeParagraph('intro', 'Intro paragraph');
    const firstSection: SectionBreakBlock = {
      kind: 'sectionBreak',
      id: 'section-0',
      attrs: { isFirstSection: true, sectionIndex: 0, source: 'sectPr' },
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
    };
    const nextSection: SectionBreakBlock = {
      kind: 'sectionBreak',
      id: 'section-1',
      attrs: { sectionIndex: 1, source: 'sectPr' },
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
      columns: { count: 2, gap: 20 },
    };
    const body = makeParagraph('body', 'Body paragraph');

    const blocks: FlowBlock[] = [firstSection, intro, nextSection, body];

    const measureBlock = vi.fn(async (_block: FlowBlock, constraints: { maxWidth: number; maxHeight: number }) => {
      return {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 1,
            width: constraints.maxWidth,
            ascent: 8,
            descent: 2,
            lineHeight: 10,
          },
        ],
        totalHeight: 10,
      } satisfies ParagraphMeasure;
    });

    const result = await incrementalLayout([], null, blocks, options, measureBlock);

    const introMeasure = result.measures[1] as ParagraphMeasure;
    const bodyMeasure = result.measures[3] as ParagraphMeasure;

    expect(introMeasure.lines?.[0]?.width).toBe(260);
    expect(bodyMeasure.lines?.[0]?.width).toBe(120);
  });

  it('measures paragraphs after nextColumn at the target explicit column width', async () => {
    const options = {
      pageSize: { w: 816, h: 1056 },
      margins: { top: 44, right: 88, bottom: 49, left: 90 },
      columns: { count: 1, gap: 0 },
    };
    const contentWidth = 816 - (90 + 88);
    const columns = { count: 2, gap: 0, widths: [272.67, 365.4], equalWidth: false };

    const continuous: SectionBreakBlock = {
      kind: 'sectionBreak',
      id: 'sb-continuous',
      type: 'continuous',
      columns,
      margins: options.margins,
      attrs: { sectionIndex: 5, source: 'sectPr' },
    };
    const left = makeParagraph('left', 'By: ____ Name: Left Signer');
    const nextColumn: SectionBreakBlock = {
      kind: 'sectionBreak',
      id: 'sb-next-column',
      type: 'nextColumn',
      columns,
      margins: options.margins,
      attrs: { sectionIndex: 6, source: 'sectPr' },
    };
    const right = makeParagraph('right', 'By: ____ Name: ____________________');

    const measureWidths: number[] = [];
    const measureBlock = vi.fn(async (block: FlowBlock, constraints: { maxWidth: number; maxHeight: number }) => {
      if (block.kind === 'paragraph') measureWidths.push(constraints.maxWidth);
      return {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 1,
            width: constraints.maxWidth,
            ascent: 8,
            descent: 2,
            lineHeight: 10,
          },
        ],
        totalHeight: 10,
      } satisfies ParagraphMeasure;
    });

    await incrementalLayout([], null, [continuous, left, nextColumn, right], options, measureBlock);

    expect(measureWidths).toEqual([272.67, 365.4]);
    expect(contentWidth).toBe(638);
  });

  it('bounds broad dirty-region work without a unique block-index proof', async () => {
    const count = 128;
    let reads = 0;
    const freeze = <T>(value: T): T => {
      if (value && typeof value === 'object') {
        for (const child of Object.values(value)) freeze(child);
        Object.freeze(value);
      }
      return value;
    };
    const previousData = Array.from({ length: count }, (_, index) =>
      freeze({
        kind: 'paragraph' as const,
        id: `p${index}`,
        runs: [
          {
            kind: 'text' as const,
            text: `body ${index}`,
            fontFamily: 'Arial',
            fontSize: 12,
            pmStart: index * 20,
            pmEnd: index * 20 + 8,
          },
        ],
      }),
    );
    const nextData = previousData.map((block) =>
      freeze({ ...block, runs: block.runs.map((run) => ({ ...run, pmStart: run.pmStart + 1, pmEnd: run.pmEnd + 1 })) }),
    );
    const source = (data: FlowBlock[]) =>
      new Proxy(Object.freeze(data) as unknown as FlowBlock[], {
        get(target, key, receiver) {
          if (typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key)) reads++;
          return Reflect.get(target, key, receiver);
        },
      });
    const previous = source(previousData),
      next = source(nextData);
    const measure = vi.fn(async () => ({ kind: 'paragraph' as const, lines: [], totalHeight: 10 }));
    const options = { pageSize: { w: 300, h: 400 }, margins: { top: 20, right: 20, bottom: 20, left: 20 } };
    const fontContext = { fontSignature: 'owned-lookup', resolvePhysical: (family: string) => family };
    const fontCapabilities = { hasTabularDigits: () => false };
    const cold = await incrementalLayout([], null, previous, options, measure, undefined, undefined, {
      fontContext,
      fontCapabilities,
    });
    reads = 0;
    measure.mockClear();
    const warm = await incrementalLayout(
      previous,
      cold.layout,
      next,
      options,
      measure,
      undefined,
      cold.measures,
      { fontContext, previousFontSignature: fontContext.fontSignature, fontCapabilities },
      undefined,
      undefined,
      {
        provedDirtyRegion: {
          firstDirtyIndex: 0,
          lastStableIndex: -1,
          changedBlockIds: nextData.map((block) => block.id),
          insertedBlockIds: [],
          deletedBlockIds: [],
          stableBlockIds: new Set<string>(),
        },
      },
    );
    const warmReads = reads;
    measureCache.clear();
    const reference = await incrementalLayout([], null, nextData, options, measure, undefined, undefined, {
      fontContext,
      fontCapabilities,
    });
    expect(warm.layout.pages).toEqual(reference.layout.pages);
    expect(warmReads).toBeLessThan(count * 32);
  });
});

describe('SD-5988 previous marker metrics', () => {
  it.each([
    { text: 'iii.', run: { bold: true } },
    { text: '1.2', run: { fontSize: 24 } },
  ])(
    'remeasures marker-only %o before stable-block reuse and matches fresh Canvas2D geometry',
    async ({ text, run }) => {
      const { Canvas, usingStub } = resolveCanvas();
      expect(usingStub).toBe(false);
      const canvas = new Canvas(1, 1).getContext('2d');
      canvas.font = '16px Arial';
      const regularWidth = canvas.measureText(text).width;
      canvas.font = `${run.bold ? 'bold ' : ''}${run.fontSize ?? 16}px Arial`;
      expect(canvas.measureText(text).width).not.toBe(regularWidth);
      const runtime = createDomMeasurementRuntime({ createCanvasContext: () => canvas });
      const oracle = createDomMeasurementRuntime({ createCanvasContext: () => new Canvas(1, 1).getContext('2d') });
      const fontContext = { fontSignature: 'sd5988-actual-arial', resolvePhysical: (family: string) => family };
      const options = { pageSize: { w: 300, h: 400 }, margins: { top: 20, right: 20, bottom: 20, left: 20 } };
      const before: ParagraphBlock = {
        kind: 'paragraph',
        id: 'marker',
        runs: [{ text: 'Beta.', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {
          numberingProperties: { numId: 1, ilvl: 1 },
          indent: { left: 48, hanging: 48 },
          wordLayout: {
            marker: {
              markerText: text,
              suffix: 'tab',
              justification: 'left',
              markerBoxWidthPx: 48,
              run: { fontFamily: 'Arial', fontSize: 16 },
            },
          },
        },
      };
      const after = structuredClone(before);
      Object.assign(after.attrs!.wordLayout!.marker!.run, run);
      const sibling = makeParagraph('untouched', 'Gamma.');
      try {
        measureCache.clear();
        const firstPass = runtime.beginPass(fontContext);
        const first = await incrementalLayout(
          [],
          null,
          [before, sibling],
          options,
          (block, constraints) => firstPass.measureBlock(block, constraints),
          undefined,
          undefined,
          { fontContext },
        );
        firstPass.finish();
        measureCache.clear();
        const nextPass = runtime.beginPass(fontContext);
        const measure = vi.fn((block: FlowBlock, constraints: { maxWidth: number; maxHeight: number }) =>
          nextPass.measureBlock(block, constraints),
        );
        const next = await incrementalLayout(
          [before, sibling],
          first.layout,
          [after, sibling],
          options,
          measure,
          undefined,
          first.measures,
          { fontContext, previousFontSignature: fontContext.fontSignature },
        );
        nextPass.finish();
        const freshPass = oracle.beginPass(fontContext);
        const fresh = await freshPass.measureBlock(after, { maxWidth: 260, maxHeight: 360 });
        freshPass.finish();
        expect(fresh.kind).toBe('paragraph');
        expect.soft(measure.mock.calls.map(([block]) => block.id)).toEqual(['marker']);
        expect.soft(next.measures[0]).toEqual(fresh);
        expect
          .soft((next.measures[0] as ParagraphMeasure).marker?.markerTextWidth)
          .not.toBe((first.measures[0] as ParagraphMeasure).marker?.markerTextWidth);
        expect(next.measures[1]).toBe(first.measures[1]);
        expect(after.runs).toEqual(before.runs);
      } finally {
        runtime.dispose();
        oracle.dispose();
        measureCache.clear();
      }
    },
  );
});
