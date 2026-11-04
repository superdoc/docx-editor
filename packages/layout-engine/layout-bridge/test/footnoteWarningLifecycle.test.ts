import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import type { FlowBlock, Measure } from '@superdoc/contracts';
import { incrementalLayout } from '../src/incrementalLayout';

const RESERVE_CAPPED_WARNING = '[layout] Footnote reserve capped to preserve body area';
const BODY_LINE_HEIGHT = 20;
const FOOTNOTE_LINE_HEIGHT = 220;
const MARGINS = { top: 72, right: 72, bottom: 72, left: 72 };

const makeParagraph = (id: string, text: string, pmStart: number): FlowBlock => ({
  kind: 'paragraph',
  id,
  runs: [{ text, fontFamily: 'Arial', fontSize: 12, pmStart, pmEnd: pmStart + text.length }],
});

const makeMeasure = (lineHeight: number, lineCount: number, textLength: number): Measure => ({
  kind: 'paragraph',
  lines: Array.from({ length: lineCount }, (_, index) => ({
    fromRun: 0,
    fromChar: index,
    toRun: 0,
    toChar: Math.min(textLength, index + 1),
    width: 200,
    ascent: lineHeight * 0.8,
    descent: lineHeight * 0.2,
    lineHeight,
  })),
  totalHeight: lineCount * lineHeight,
});

const makeScenario = () => {
  const blocks: FlowBlock[] = [makeParagraph('body-0', 'Body with a footnote anchor.', 0)];
  const footnote = makeParagraph('footnote-1-0-paragraph', 'Tall footnote line.', 0);
  const options: Parameters<typeof incrementalLayout>[3] = {
    pageSize: { w: 612, h: 200 + MARGINS.top + MARGINS.bottom },
    margins: MARGINS,
    footnotes: {
      refs: [{ id: '1', pos: 2 }],
      blocksById: new Map([['1', [footnote]]]),
      topPadding: 6,
      dividerHeight: 6,
    },
  };
  const measureBlock: Parameters<typeof incrementalLayout>[4] = async (block) => {
    const textLength = block.kind === 'paragraph' ? (block.runs?.[0]?.text?.length ?? 1) : 1;
    return block.id.startsWith('footnote-')
      ? makeMeasure(FOOTNOTE_LINE_HEIGHT, 1, textLength)
      : makeMeasure(BODY_LINE_HEIGHT, 1, textLength);
  };

  return { blocks, options, measureBlock };
};

const reserveWarningKeys = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls
    .filter(([message]) => message === RESERVE_CAPPED_WARNING)
    .map(([, detail]) => {
      const pages = (detail as { pages?: unknown } | undefined)?.pages;
      return Array.isArray(pages) ? `reserve-capped:${pages.join(',')}` : 'reserve-capped:unknown';
    });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('issue #4051: footnote warning lifecycle', () => {
  it('control: emits the cap warning once during one layout invocation', async () => {
    const { blocks, options, measureBlock } = makeScenario();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await incrementalLayout([], null, blocks, options, measureBlock);

    expect(reserveWarningKeys(warn)).toEqual(['reserve-capped:0']);
  });

  it('trigger: keeps the same warning deduped after a typing-like second layout invocation', async () => {
    const { blocks, options, measureBlock } = makeScenario();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const first = await incrementalLayout([], null, blocks, options, measureBlock);

    const editedBlocks = blocks.map((block) => {
      if (block.kind !== 'paragraph') return block;
      const run = block.runs?.[0];
      const text = run && 'text' in run && typeof run.text === 'string' ? run.text : '';
      const pmStart = run && 'pmStart' in run && typeof run.pmStart === 'number' ? run.pmStart : 0;
      return makeParagraph(block.id, `${text}x`, pmStart);
    });

    await incrementalLayout(
      blocks,
      first.layout,
      editedBlocks,
      options,
      measureBlock,
      undefined,
      first.measures,
      undefined,
      { footnoteReserveSeed: first.footnoteReserveSeed },
    );

    // Expected document-lifetime behavior: the same stable condition warns once.
    expect(reserveWarningKeys(warn)).toEqual(['reserve-capped:0']);
  });
});

const truncatedWarningKeys = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls
    .filter(([message]) => message === '[layout] Footnote content truncated: extends beyond document pages')
    .map(([, detail]) => `content-truncated:${(detail as { ids: string[] }).ids.join(',')}`);

describe('footnote diagnostic document boundaries', () => {
  it('drains every line when continuation pages cannot fill the physical band', async () => {
    const { blocks, options } = makeScenario();
    options.pageSize = { w: 612, h: MARGINS.top + MARGINS.bottom + 121 };
    options.footnotes!.separatorSpacingBefore = 0;
    options.footnotes!.topPadding = 4;
    options.footnotes!.dividerHeight = 6;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const measureBlock: Parameters<typeof incrementalLayout>[4] = async (block) => {
      const textLength = block.kind === 'paragraph' ? (block.runs?.[0]?.text?.length ?? 1) : 1;
      return block.id.startsWith('footnote-')
        ? makeMeasure(70, 10, textLength)
        : makeMeasure(BODY_LINE_HEIGHT, 1, textLength);
    };

    const result = await incrementalLayout([], null, blocks, options, measureBlock);
    const renderedLines = result.layout.pages.flatMap((page) =>
      page.fragments.flatMap((fragment) => {
        if (fragment.blockId !== 'footnote-1-0-paragraph' || fragment.kind !== 'para') return [];
        return Array.from({ length: fragment.toLine - fragment.fromLine }, (_, index) => fragment.fromLine + index);
      }),
    );

    expect(renderedLines).toEqual(Array.from({ length: 10 }, (_, index) => index));
    expect(truncatedWarningKeys(warn)).toEqual([]);
  });

  it('does not report truncation when final continuation pages drain the queue', async () => {
    const { blocks, options, measureBlock } = makeScenario();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    options.footnotes!.refs.push({ id: '3', pos: 3 });
    options.footnotes!.blocksById.set('3', [makeParagraph('footnote-3-0-paragraph', 'Third tall note.', 0)]);

    const result = await incrementalLayout([], null, blocks, options, measureBlock);

    expect(result.layout.pages.length).toBeGreaterThan(1);
    expect(truncatedWarningKeys(warn)).toEqual([]);
  });

  it('dedupes the same truncation key after an edit and allows a new note key', async () => {
    const { blocks, options, measureBlock } = makeScenario();
    options.pageSize = { w: 612, h: MARGINS.top + MARGINS.bottom + 1 };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    options.footnotes!.refs.push({ id: '3', pos: 3 });
    options.footnotes!.blocksById.set('3', [makeParagraph('footnote-3-0-paragraph', 'Third tall note.', 0)]);
    const measured = measureBlock;
    const first = await incrementalLayout([], null, blocks, options, measured);
    const edited = [makeParagraph('body-0', 'Body with a footnote anchor.x', 0)];
    const second = await incrementalLayout(blocks, first.layout, edited, options, measured);
    expect(truncatedWarningKeys(warn)).toEqual(['content-truncated:1,3']);
    const nextOptions = {
      ...options,
      footnotes: {
        ...options.footnotes!,
        refs: [
          { id: '2', pos: 2 },
          { id: '3', pos: 3 },
        ],
        blocksById: new Map([
          ['2', [makeParagraph('footnote-2-0-paragraph', 'Tall second footnote.', 0)]],
          ['3', [makeParagraph('footnote-3-0-paragraph', 'Third tall note.', 0)]],
        ]),
      },
    };
    const third = await incrementalLayout(edited, second.layout, edited, nextOptions, measured);
    await incrementalLayout(edited, third.layout, edited, nextOptions, measured);
    expect(truncatedWarningKeys(warn)).toEqual(['content-truncated:1,3', 'content-truncated:2,3']);
  });

  it('allows a changed cap-page key without repeating it', async () => {
    const { blocks, options, measureBlock } = makeScenario();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const first = await incrementalLayout([], null, blocks, options, measureBlock);
    const edited: FlowBlock[] = [
      makeParagraph('intro', 'New first page.', 0),
      { kind: 'pageBreak', id: 'break' },
      makeParagraph('body-0', 'Body with a footnote anchor.x', 100),
    ];
    const nextOptions = { ...options, footnotes: { ...options.footnotes!, refs: [{ id: '1', pos: 102 }] } };
    const nextMeasure: typeof measureBlock = async (block, constraints) =>
      block.kind === 'pageBreak' ? { kind: 'pageBreak' } : measureBlock(block, constraints);
    const second = await incrementalLayout(blocks, first.layout, edited, nextOptions, nextMeasure);
    await incrementalLayout(edited, second.layout, edited, nextOptions, nextMeasure);
    expect(reserveWarningKeys(warn)).toEqual(['reserve-capped:0', 'reserve-capped:1']);
  });

  it('retains warnings across cold relayouts with the same document owner', async () => {
    const { blocks, options, measureBlock } = makeScenario();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const context = { footnoteWarningOwner: {}, footnoteReserveSeed: null };
    await incrementalLayout([], null, blocks, options, measureBlock, undefined, undefined, undefined, context);
    await incrementalLayout([], null, blocks, options, measureBlock, undefined, undefined, undefined, context);
    expect(reserveWarningKeys(warn)).toEqual(['reserve-capped:0']);
    const nextContext = { ...context, footnoteWarningOwner: {} };
    await incrementalLayout([], null, blocks, options, measureBlock, undefined, undefined, undefined, nextContext);
    expect(reserveWarningKeys(warn)).toEqual(['reserve-capped:0', 'reserve-capped:0']);
  });

  it('does not share the first warning between independent documents', async () => {
    const firstDoc = makeScenario();
    const secondDoc = makeScenario();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await incrementalLayout([], null, firstDoc.blocks, firstDoc.options, firstDoc.measureBlock);
    await incrementalLayout([], null, secondDoc.blocks, secondDoc.options, secondDoc.measureBlock);
    expect(reserveWarningKeys(warn)).toEqual(['reserve-capped:0', 'reserve-capped:0']);
  });
});
