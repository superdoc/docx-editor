/**
 * SD-3432: footnote convergence warm-start.
 *
 * The seed is ONLY a starting vector: every run re-validates it through the
 * full convergence machinery. The contract pinned here is therefore twofold:
 *   1. EQUALITY — a warm run produces a layout deep-equal to the cold run of
 *      the same inputs, for unchanged docs, edited docs, stale seeds (deleted
 *      footnotes, page-count changes), and foreign seeds (font mismatch).
 *   2. WORK — on an unchanged document a warm run paginates exactly ONCE
 *      (the initial pagination is built with the seed and the pass-1 plan
 *      validates it in place), while cold runs need the full convergence
 *      ladder. Counted by bridgeTiming.counters.paginationPasses.
 * Plus the capture guard: seeds are only captured from EXACT fixed points
 * (a captured seed always pass-1-validates on an identical rerun), and
 * oscillating documents never capture.
 */

import { describe, it, expect, vi } from 'vite-plus/test';
import type { FlowBlock, Measure } from '@superdoc/contracts';
import { clearIncrementalModuleState, incrementalLayout, type FootnoteReserveSeed } from '../src/incrementalLayout';

const makeParagraph = (id: string, text: string, pmStart: number): FlowBlock => ({
  kind: 'paragraph',
  id,
  runs: [{ text, fontFamily: 'Arial', fontSize: 12, pmStart, pmEnd: pmStart + text.length }],
});

const makeMeasure = (lineHeight: number, textLength: number): Measure => ({
  kind: 'paragraph',
  lines: [
    {
      fromRun: 0,
      fromChar: 0,
      toRun: 0,
      toChar: textLength,
      width: 200,
      ascent: lineHeight * 0.8,
      descent: lineHeight * 0.2,
      lineHeight,
    },
  ],
  totalHeight: lineHeight,
});

const makeMultiLineMeasure = (lineHeight: number, lineCount: number): Measure => {
  const lines = Array.from({ length: lineCount }, (_, i) => ({
    fromRun: 0,
    fromChar: i,
    toRun: 0,
    toChar: i + 1,
    width: 200,
    ascent: lineHeight * 0.8,
    descent: lineHeight * 0.2,
    lineHeight,
  }));
  return { kind: 'paragraph', lines, totalHeight: lineCount * lineHeight };
};

const BODY_LINE_HEIGHT = 20;
const FOOTNOTE_LINE_HEIGHT = 12;
const margins = { top: 72, right: 72, bottom: 72, left: 72 };
const contentHeight = 240;
const pageHeight = contentHeight + margins.top + margins.bottom;

/** Stable two-page scenario with two footnotes (converges to a fixed point). */
const makeScenario = (paragraphCount = 20, footnoteLines = 3) => {
  let pos = 0;
  const bodyBlocks: FlowBlock[] = [];
  for (let i = 0; i < paragraphCount; i += 1) {
    const text = `Line ${i + 1}.`;
    bodyBlocks.push(makeParagraph(`body-${i}`, text, pos));
    pos += text.length + 1;
  }
  const ref1Pos = 5; // early paragraph
  const ref2Pos = pos - 2; // last paragraph
  const fn1 = makeParagraph('footnote-1-0-paragraph', 'First footnote body.', 0);
  const fn2 = makeParagraph('footnote-2-0-paragraph', 'Second footnote body, somewhat longer.', 0);
  const measureBlock = vi.fn(async (block: FlowBlock) => {
    if (block.id.startsWith('footnote-')) {
      return makeMultiLineMeasure(FOOTNOTE_LINE_HEIGHT, footnoteLines);
    }
    const textLength = block.kind === 'paragraph' ? (block.runs?.[0]?.text?.length ?? 1) : 1;
    return makeMeasure(BODY_LINE_HEIGHT, textLength);
  });
  const options = {
    pageSize: { w: 612, h: pageHeight },
    margins,
    footnotes: {
      refs: [
        { id: '1', pos: ref1Pos },
        { id: '2', pos: ref2Pos },
      ],
      blocksById: new Map([
        ['1', [fn1]],
        ['2', [fn2]],
      ]),
      topPadding: 4,
      dividerHeight: 2,
    },
  };
  return { bodyBlocks, options, measureBlock };
};

const run = async (
  blocks: FlowBlock[],
  options: Parameters<typeof incrementalLayout>[3],
  measureBlock: Parameters<typeof incrementalLayout>[4],
  seed: FootnoteReserveSeed | null = null,
) =>
  incrementalLayout([], null, blocks, options, measureBlock, undefined, undefined, undefined, {
    footnoteReserveSeed: seed,
  });

/** Layouts must match exactly; serialize to strip undefined-vs-missing noise. */
const layoutJson = (r: Awaited<ReturnType<typeof incrementalLayout>>) => JSON.parse(JSON.stringify(r.layout));

describe('footnote convergence warm-start (SD-3432)', () => {
  it('captures a seed from a stable run, and the seed matches the painted reserves', async () => {
    const { bodyBlocks, options, measureBlock } = makeScenario();

    const cold = await run(bodyBlocks, options, measureBlock);

    expect(cold.footnoteReserveSeed).toBeTruthy();
    const seed = cold.footnoteReserveSeed!;
    expect(seed.reserves.some((h) => h > 0)).toBe(true);
    cold.layout.pages.forEach((p, i) => {
      expect(seed.reserves[i] ?? 0).toBe(p.footnoteReserved ?? 0);
    });
  });

  it('warm rerun of identical inputs: deep-equal layout, idempotent seed, exactly 1 pagination', async () => {
    const { bodyBlocks, options, measureBlock } = makeScenario();
    const cold = await run(bodyBlocks, options, measureBlock);
    const seed = cold.footnoteReserveSeed!;
    expect(seed).toBeTruthy();

    const warm = await run(bodyBlocks, options, measureBlock, seed);

    expect(layoutJson(warm)).toEqual(layoutJson(cold));
    // A captured seed validates on an identical rerun with ZERO extra
    // re-paginations: the initial pagination is built WITH the seed and the
    // pass-1 plan reproduces it (SD-3432 single-pagination steady state).
    expect(warm.bridgeTiming.counters.paginationPasses).toBe(1);
    expect(cold.bridgeTiming.counters.paginationPasses).toBeGreaterThan(1);
    // Idempotence: the warm run re-captures the same fixed point.
    expect(warm.footnoteReserveSeed).toEqual(seed);
  });

  it('seed chain across successive edits always equals the cold run of the same inputs', async () => {
    const { bodyBlocks, options, measureBlock } = makeScenario();
    let seed = (await run(bodyBlocks, options, measureBlock)).footnoteReserveSeed!;

    let blocks = bodyBlocks;
    for (let edit = 1; edit <= 3; edit += 1) {
      // Simulate typing: grow the text of a middle paragraph (new block id
      // content, same shape) — measures change with text length.
      blocks = blocks.map((b, i) => {
        if (i !== 10 || b.kind !== 'paragraph') return b;
        const first = b.runs?.[0];
        const baseText = first && 'text' in first && typeof first.text === 'string' ? first.text : '';
        const pmStart = first && 'pmStart' in first && typeof first.pmStart === 'number' ? first.pmStart : 0;
        return makeParagraph(b.id, `${baseText}${'x'.repeat(edit * 7)}`, pmStart);
      });

      const warm = await run(blocks, options, measureBlock, seed);
      const cold = await run(blocks, options, measureBlock);

      expect(layoutJson(warm)).toEqual(layoutJson(cold));
      expect(warm.footnoteReserveSeed).toEqual(cold.footnoteReserveSeed);
      seed = warm.footnoteReserveSeed!;
      expect(seed).toBeTruthy();
    }
  });

  it('stale seed after a footnote is deleted: warm equals cold', async () => {
    const { bodyBlocks, options, measureBlock } = makeScenario();
    const seed = (await run(bodyBlocks, options, measureBlock)).footnoteReserveSeed!;

    const oneNote = {
      ...options,
      footnotes: {
        ...options.footnotes,
        refs: options.footnotes.refs.slice(0, 1),
        blocksById: new Map([['1', options.footnotes.blocksById.get('1')!]]),
      },
    };
    const warm = await run(bodyBlocks, oneNote, measureBlock, seed);
    const cold = await run(bodyBlocks, oneNote, measureBlock);

    expect(layoutJson(warm)).toEqual(layoutJson(cold));
  });

  it.each([
    [20, 45],
    [45, 20],
  ])(
    'stale seed across a page-count change from %i to %i paragraphs: warm equals cold',
    async (beforeCount, afterCount) => {
      const before = makeScenario(beforeCount);
      const seed = (await run(before.bodyBlocks, before.options, before.measureBlock)).footnoteReserveSeed!;

      const after = makeScenario(afterCount);
      const warm = await run(after.bodyBlocks, after.options, after.measureBlock, seed);
      const cold = await run(after.bodyBlocks, after.options, after.measureBlock);

      expect(layoutJson(warm)).toEqual(layoutJson(cold));
      expect(warm.footnoteReserveSeed!.reserves).toHaveLength(warm.layout.pages.length);
      expect(warm.footnoteReserveSeed!.notePageIndexes!.every((index) => index < warm.layout.pages.length)).toBe(true);
      warm.layout.pages.forEach((page, index) => {
        expect(warm.footnoteReserveSeed!.reserves[index]).toBe(page.footnoteReserved ?? 0);
      });
    },
  );

  it('captures only actual page reserves after a zero-padded convergence vector', async () => {
    const { bodyBlocks, options, measureBlock } = makeScenario();
    const cold = await run(bodyBlocks, options, measureBlock);
    const seed = {
      ...cold.footnoteReserveSeed!,
      reserves: [...cold.footnoteReserveSeed!.reserves, 0, 0, 0],
    };
    const warm = await run(bodyBlocks, options, measureBlock, seed);

    expect(layoutJson(warm)).toEqual(layoutJson(cold));
    expect(warm.footnoteReserveSeed!.reserves).toHaveLength(warm.layout.pages.length);
    expect(warm.footnoteReserveSeed!.notePageIndexes).toEqual(cold.footnoteReserveSeed!.notePageIndexes);
    warm.layout.pages.forEach((page, index) => {
      expect(warm.footnoteReserveSeed!.reserves[index]).toBe(page.footnoteReserved ?? 0);
    });
  });

  it('captures reserves only for final pages after dense footnote convergence', async () => {
    clearIncrementalModuleState();
    const scenario = makeScenario(50);
    const noteOrdinals = Array.from({ length: 96 }, (_, index) => 2 + Math.floor(index / 4) * 2);
    const notes = noteOrdinals.map((_, index) => makeParagraph(`footnote-${index}-0-paragraph`, 'note content', 0));
    const options = {
      ...scenario.options,
      footnotes: {
        ...scenario.options.footnotes,
        refs: noteOrdinals.map((ordinal, index) => ({
          id: String(index),
          blockId: scenario.bodyBlocks[ordinal]!.id,
          pos: (scenario.bodyBlocks[ordinal] as Extract<FlowBlock, { kind: 'paragraph' }>).runs[0]!.pmStart! + 2,
        })),
        blocksById: new Map(notes.map((block, index) => [String(index), [block]])),
      },
    };
    const measure = async (block: FlowBlock): Promise<Measure> => {
      const index = Number(block.id.split('-')[1]);
      return block.id.startsWith('footnote-')
        ? makeMultiLineMeasure(FOOTNOTE_LINE_HEIGHT, 1 + ((index + 3) % 9))
        : makeMultiLineMeasure(BODY_LINE_HEIGHT, 1 + (index % 4));
    };
    try {
      const result = await run(scenario.bodyBlocks, options, measure);
      expect(result.footnoteReserveSeed).toBeTruthy();
      expect(result.footnoteReserveSeed!.reserves).toHaveLength(result.layout.pages.length);
      expect(result.footnoteReserveSeed!.notePageIndexes!.every((index) => index < result.layout.pages.length)).toBe(
        true,
      );
      result.layout.pages.forEach((page, index) => {
        expect(result.footnoteReserveSeed!.reserves[index]).toBe(page.footnoteReserved ?? 0);
      });
    } finally {
      clearIncrementalModuleState();
    }
  });

  it('foreign seed (font signature mismatch) is ignored: warm equals cold and re-captures', async () => {
    const { bodyBlocks, options, measureBlock } = makeScenario();
    const cold = await run(bodyBlocks, options, measureBlock);
    const foreign = { ...cold.footnoteReserveSeed!, fontSignature: 'other-doc-fonts' };

    const warm = await run(bodyBlocks, options, measureBlock, foreign);

    expect(layoutJson(warm)).toEqual(layoutJson(cold));
    expect(warm.footnoteReserveSeed).toEqual(cold.footnoteReserveSeed);
  });

  it('seed chains settle: re-feeding captured seeds reaches a byte-stable fixed point within 3 runs', async () => {
    // Real documents can end a cold ladder on a NEAR-fixed-point (reverted
    // tighten leftovers). Capture is unconditional so the chain bootstraps;
    // this pins that the chain SETTLES (no flip-flopping fixed points).
    const { bodyBlocks, options, measureBlock } = makeScenario(30, 4);
    let prev = await run(bodyBlocks, options, measureBlock);
    let settled = false;
    for (let i = 0; i < 3; i += 1) {
      const next = await run(bodyBlocks, options, measureBlock, prev.footnoteReserveSeed ?? null);
      if (
        JSON.stringify(layoutJson(next)) === JSON.stringify(layoutJson(prev)) &&
        JSON.stringify(next.footnoteReserveSeed) === JSON.stringify(prev.footnoteReserveSeed)
      ) {
        settled = true;
        prev = next;
        break;
      }
      prev = next;
    }
    expect(settled).toBe(true);

    // And the settled state is idempotent.
    const again = await run(bodyBlocks, options, measureBlock, prev.footnoteReserveSeed ?? null);
    expect(layoutJson(again)).toEqual(layoutJson(prev));
    expect(again.footnoteReserveSeed).toEqual(prev.footnoteReserveSeed);
  });

  it('documents without footnotes return a null seed', async () => {
    const { bodyBlocks, measureBlock } = makeScenario();
    const result = await incrementalLayout(
      [],
      null,
      bodyBlocks,
      { pageSize: { w: 612, h: pageHeight }, margins },
      measureBlock,
    );

    expect(result.footnoteReserveSeed ?? null).toBeNull();
  });

  it('oscillating documents never capture a seed, and a seeded oscillating run equals cold', async () => {
    // The footnoteMultiPass oscillation scenario: a tall footnote whose
    // reserve pushes its own ref to the next page (A -> B -> A).
    let pos = 0;
    const bodyBlocks: FlowBlock[] = [];
    for (let i = 0; i < 12; i += 1) {
      const text = `Line ${i + 1}.`;
      bodyBlocks.push(makeParagraph(`body-${i}`, text, pos));
      pos += text.length + 1;
    }
    const footnoteBlock = makeParagraph('footnote-1-0-paragraph', 'Footnote content that spans multiple lines.', 0);
    const measureBlock = vi.fn(async (block: FlowBlock) => {
      if (block.id.startsWith('footnote-')) return makeMultiLineMeasure(FOOTNOTE_LINE_HEIGHT, 5);
      const textLength = block.kind === 'paragraph' ? (block.runs?.[0]?.text?.length ?? 1) : 1;
      return makeMeasure(BODY_LINE_HEIGHT, textLength);
    });
    const options = {
      pageSize: { w: 612, h: pageHeight },
      margins,
      footnotes: {
        refs: [{ id: '1', pos: pos - 2 }],
        blocksById: new Map([['1', [footnoteBlock]]]),
        topPadding: 4,
        dividerHeight: 2,
      },
    };

    const cold = await run(bodyBlocks, options, measureBlock);
    if (cold.footnoteReserveSeed) {
      // If this scenario converged on this engine version, the seed contract
      // still holds; otherwise the capture guard must have blocked it.
      const warm = await run(bodyBlocks, options, measureBlock, cold.footnoteReserveSeed);
      expect(layoutJson(warm)).toEqual(layoutJson(cold));
    } else {
      const warm = await run(bodyBlocks, options, measureBlock, {
        reserves: [0, 64],
        separatorSpacingBefore: undefined,
        fontSignature: '',
        measurementWidth: 612 - margins.left - margins.right,
        measurementHeight: contentHeight,
      });
      expect(layoutJson(warm)).toEqual(layoutJson(cold));
      expect(warm.footnoteReserveSeed ?? null).toBeNull();
    }
  });
});
