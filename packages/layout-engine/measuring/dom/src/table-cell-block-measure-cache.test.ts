import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { FlowBlock, Measure, ParagraphMeasure, TabRun } from '@superdoc/contracts';
import { DEFAULT_FONT_MEASURE_CONTEXT } from '@superdoc/font-system';
import { measureBlock as measureDomBlock } from './index.js';
import { clearTableCellBlockMeasureCache, measureTableCellBlocks } from './table-cell-block-measure-cache.js';

const paragraphMeasure = (tabWidth?: number): ParagraphMeasure => ({
  kind: 'paragraph',
  lines: [
    {
      fromRun: 0,
      fromChar: 0,
      toRun: 0,
      toChar: 4,
      width: 20,
      maxWidth: 100,
      lineHeight: 12,
      ascent: 9,
      descent: 3,
      maxFontSize: 12,
      ...(tabWidth == null ? {} : { tabWidths: { 0: tabWidth } }),
    },
  ],
  totalHeight: 12,
  measuredAtMaxWidth: 100,
});

describe('table cell block measure cache', () => {
  beforeEach(() => clearTableCellBlockMeasureCache());

  it('reuses unchanged geometry across absolute position shifts and proves a safe single-line width adoption', async () => {
    const measure = vi.fn(async (): Promise<Measure> => paragraphMeasure());
    const original: FlowBlock[] = [
      {
        kind: 'paragraph',
        id: 'CELL0001',
        sourceAnchor: { sourceNodeId: 'CELL0001', pmRange: { from: 10, to: 14 } },
        runs: [{ text: 'same', fontFamily: 'Arial', fontSize: 12, pmStart: 10, pmEnd: 14 }],
      },
    ];
    const shifted: FlowBlock[] = [
      {
        ...(original[0] as Extract<FlowBlock, { kind: 'paragraph' }>),
        sourceAnchor: { sourceNodeId: 'CELL0001', pmRange: { from: 11, to: 15 } },
        runs: [{ text: 'same', fontFamily: 'Arial', fontSize: 12, pmStart: 11, pmEnd: 15 }],
      },
    ];
    const changed: FlowBlock[] = [
      {
        ...(shifted[0] as Extract<FlowBlock, { kind: 'paragraph' }>),
        runs: [{ text: 'changed', fontFamily: 'Arial', fontSize: 12, pmStart: 11, pmEnd: 18 }],
      },
    ];

    await measureTableCellBlocks(original, 200, DEFAULT_FONT_MEASURE_CONTEXT, 'browser', measure);
    await measureTableCellBlocks(shifted, 200, DEFAULT_FONT_MEASURE_CONTEXT, 'browser', measure);
    expect(measure).toHaveBeenCalledTimes(1);

    const resized = await measureTableCellBlocks(shifted, 201, DEFAULT_FONT_MEASURE_CONTEXT, 'browser', measure);
    expect(measure).toHaveBeenCalledTimes(1);
    expect((resized[0] as ParagraphMeasure).measuredAtMaxWidth).toBe(201);
    expect((resized[0] as ParagraphMeasure).lines[0]!.maxWidth).toBe(101);

    await measureTableCellBlocks(changed, 200, DEFAULT_FONT_MEASURE_CONTEXT, 'browser', measure);
    expect(measure).toHaveBeenCalledTimes(2);
  });

  it('reuses paragraph geometry across identity-only differences', async () => {
    const measure = vi.fn(async (): Promise<Measure> => paragraphMeasure());
    const first: FlowBlock = {
      kind: 'paragraph',
      id: 'PARAGRAPH-A',
      runs: [{ text: 'same geometry', fontFamily: 'Arial', fontSize: 12 }],
    };
    const second: FlowBlock = { ...first, id: 'PARAGRAPH-B' };

    await measureTableCellBlocks([first], 200, DEFAULT_FONT_MEASURE_CONTEXT, 'browser', measure, undefined, true);
    await measureTableCellBlocks([second], 200, DEFAULT_FONT_MEASURE_CONTEXT, 'browser', measure, undefined, true);

    expect(measure).toHaveBeenCalledTimes(1);
  });

  it('keeps identity differences distinct in strict cache mode', async () => {
    const measure = vi.fn(async (): Promise<Measure> => paragraphMeasure());
    const first: FlowBlock = {
      kind: 'paragraph',
      id: 'PARAGRAPH-A',
      runs: [{ text: 'same geometry', fontFamily: 'Arial', fontSize: 12 }],
    };
    const second: FlowBlock = { ...first, id: 'PARAGRAPH-B' };

    await measureTableCellBlocks([first], 200, DEFAULT_FONT_MEASURE_CONTEXT, 'browser', measure);
    await measureTableCellBlocks([second], 200, DEFAULT_FONT_MEASURE_CONTEXT, 'browser', measure);

    expect(measure).toHaveBeenCalledTimes(2);
  });

  it('remeasures nested paragraphs when inline-box metrics change', async () => {
    const measure = vi.fn(async (): Promise<Measure> => paragraphMeasure());
    const block = (paddingInlineStart: number): FlowBlock => ({
      kind: 'paragraph',
      id: 'INLINEBOX1',
      runs: [{ text: 'Citation', fontFamily: 'Arial', fontSize: 12 }],
      inlineBoxes: [
        {
          id: 'citation',
          from: 0,
          to: 8,
          layout: {
            paddingInlineStart,
            paddingInlineEnd: 4,
            paddingBlockStart: 1,
            paddingBlockEnd: 1,
            gapBefore: 1,
            gapAfter: 1,
            borderWidth: 1,
          },
          appearance: { backgroundColor: '#eef2ff' },
        },
      ],
    });

    await measureTableCellBlocks([block(4)], 200, DEFAULT_FONT_MEASURE_CONTEXT, 'browser', measure);
    await measureTableCellBlocks([block(4)], 200, DEFAULT_FONT_MEASURE_CONTEXT, 'browser', measure);
    await measureTableCellBlocks([block(8)], 200, DEFAULT_FONT_MEASURE_CONTEXT, 'browser', measure);

    expect(measure).toHaveBeenCalledTimes(2);
  });

  it('remeasures when widening could merge multiple lines', async () => {
    const measure = vi.fn(
      async (): Promise<Measure> => ({
        ...paragraphMeasure(),
        lines: [
          { ...paragraphMeasure().lines[0]!, width: 80 },
          { ...paragraphMeasure().lines[0]!, width: 40 },
        ],
        totalHeight: 24,
      }),
    );
    const blocks: FlowBlock[] = [
      {
        kind: 'paragraph',
        id: 'MULTILINE1',
        runs: [{ text: 'content on more than one line', fontFamily: 'Arial', fontSize: 12 }],
      },
    ];

    await measureTableCellBlocks(blocks, 100, DEFAULT_FONT_MEASURE_CONTEXT, 'browser', measure);
    await measureTableCellBlocks(blocks, 101, DEFAULT_FONT_MEASURE_CONTEXT, 'browser', measure);

    expect(measure).toHaveBeenCalledTimes(2);
  });

  it('rehydrates tab widths onto freshly projected runs on a cache hit', async () => {
    const measure = vi.fn(async (): Promise<Measure> => paragraphMeasure(37));
    const first: FlowBlock[] = [
      {
        kind: 'paragraph',
        id: 'CELLTAB1',
        runs: [{ kind: 'tab', text: '\t', pmStart: 20, pmEnd: 21 }],
      },
    ];
    const fresh: FlowBlock[] = [
      {
        kind: 'paragraph',
        id: 'CELLTAB1',
        runs: [{ kind: 'tab', text: '\t', pmStart: 21, pmEnd: 22 }],
      },
    ];

    await measureTableCellBlocks(first, 200, DEFAULT_FONT_MEASURE_CONTEXT, 'browser', measure);
    await measureTableCellBlocks(fresh, 200, DEFAULT_FONT_MEASURE_CONTEXT, 'browser', measure);

    expect(measure).toHaveBeenCalledTimes(1);
    expect((fresh[0] as Extract<FlowBlock, { kind: 'paragraph' }>).runs[0] as TabRun).toMatchObject({ width: 37 });
  });

  it('matches a cold DOM measurement after adopting a subpixel single-line width change', async () => {
    const blocks: FlowBlock[] = [
      {
        kind: 'paragraph',
        id: 'SUBPIXEL1',
        runs: [{ text: 'Short table value', fontFamily: 'Arial', fontSize: 12 }],
      },
    ];
    const measure = (block: FlowBlock, constraints: { maxWidth: number; maxHeight: number }) =>
      measureDomBlock(block, constraints, DEFAULT_FONT_MEASURE_CONTEXT);

    await measureTableCellBlocks(blocks, 200, DEFAULT_FONT_MEASURE_CONTEXT, 'browser', measure);
    const adopted = await measureTableCellBlocks(blocks, 200.3, DEFAULT_FONT_MEASURE_CONTEXT, 'browser', measure);
    clearTableCellBlockMeasureCache();
    const cold = await measureTableCellBlocks(blocks, 200.3, DEFAULT_FONT_MEASURE_CONTEXT, 'browser', measure);

    expect(adopted).toEqual(cold);
  });

  it('reuses immutable tab paragraphs through the measure-owned width records', async () => {
    const measure = vi.fn(async (): Promise<Measure> => paragraphMeasure(37));
    const block = (): FlowBlock => ({
      kind: 'paragraph',
      id: 'FROZEN-CELL-TAB',
      runs: [{ kind: 'tab', text: '\t', pmStart: 21, pmEnd: 22 }],
    });
    const cold = await measureTableCellBlocks([block()], 200, DEFAULT_FONT_MEASURE_CONTEXT, 'browser', measure);
    const frozen = block() as Extract<FlowBlock, { kind: 'paragraph' }>;
    Object.freeze(frozen.runs[0]);
    Object.freeze(frozen.runs);
    Object.freeze(frozen);
    const cached = await measureTableCellBlocks([frozen], 200, DEFAULT_FONT_MEASURE_CONTEXT, 'browser', measure);
    expect(measure).toHaveBeenCalledTimes(1);
    expect(cached).toEqual(cold);
    expect((cached[0] as ParagraphMeasure).lines[0]!.tabWidths?.[0]).toBe(37);
    expect(frozen.runs[0]).not.toHaveProperty('width');
  });
});
