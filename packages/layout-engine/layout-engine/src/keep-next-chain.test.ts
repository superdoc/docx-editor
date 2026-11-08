import { describe, expect, it } from 'bun:test';
import type {
  FlowBlock,
  ImageBlock,
  Measure,
  ParagraphAttrs,
  ParagraphBlock,
  ParagraphMeasure,
  TableBlock,
  TableMeasure,
} from '@superdoc/contracts';
import {
  NO_KEEP_NEXT_ANCHOR,
  calculateChainHeight,
  computeKeepNextChainSteps,
  getParagraphSpacingAfter,
  getParagraphSpacingBefore,
  keptAnchorLineCount,
  type KeepNextChain,
  type PrecedingParagraphState,
} from './keep-next-chain.js';

function paragraph(id: string, attrs: ParagraphAttrs = {}): ParagraphBlock {
  return { kind: 'paragraph', id, runs: [{ kind: 'text', text: id, fontFamily: 'Calibri', fontSize: 11 }], attrs };
}

function kept(id: string, attrs: ParagraphAttrs = {}): ParagraphBlock {
  return paragraph(id, { ...attrs, keepNext: true });
}

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
      maxWidth: 500,
      ascent: lineHeight - 4,
      descent: 4,
      lineHeight,
    })),
  };
}

function floatingImage(id: string): ImageBlock {
  return {
    kind: 'image',
    id,
    src: 'generated.png',
    width: 20,
    height: 20,
    anchor: { isAnchored: true, hRelativeFrom: 'page', vRelativeFrom: 'page', offsetH: 0, offsetV: 0 },
  };
}

function table(id: string, anchored = false): TableBlock {
  return { kind: 'table', id, rows: [], ...(anchored ? { anchor: { isAnchored: true } } : {}) };
}

function tableMeasure(...rowHeights: number[]): TableMeasure {
  return {
    kind: 'table',
    rows: rowHeights.map((height) => ({ cells: [], height })),
    columnWidths: [100],
    totalWidth: 100,
    totalHeight: rowHeights.reduce((sum, height) => sum + height, 0),
  };
}

function chainsOf(blocks: FlowBlock[]): Map<number, KeepNextChain> {
  const steps = computeKeepNextChainSteps(blocks, null);
  for (let step = steps.next(); ; step = steps.next()) {
    if (step.done) return step.value;
  }
}

const freshPage: PrecedingParagraphState = {
  trailingSpacing: 0,
  lastParagraphStyleId: undefined,
  lastParagraphContextualSpacing: false,
};

describe('computeKeepNextChainSteps', () => {
  it('groups consecutive keep-next paragraphs and anchors them to the next paragraph', () => {
    const chains = chainsOf([kept('a'), kept('b'), paragraph('c'), kept('d'), paragraph('e')]);
    expect([...chains.values()]).toEqual([
      { startIndex: 0, endIndex: 1, memberIndices: [0, 1], anchorIndex: 2 },
      { startIndex: 3, endIndex: 3, memberIndices: [3], anchorIndex: 4 },
    ]);
  });

  it('does not start a second chain at a paragraph already inside one', () => {
    const chains = chainsOf([kept('a'), kept('b'), kept('c'), paragraph('d')]);
    expect([...chains.keys()]).toEqual([0]);
  });

  it('looks past floating drawings when finding members and the anchor', () => {
    const chains = chainsOf([kept('a'), floatingImage('float-1'), kept('b'), floatingImage('float-2'), paragraph('c')]);
    expect(chains.get(0)).toEqual({ startIndex: 0, endIndex: 2, memberIndices: [0, 2], anchorIndex: 4 });
  });

  it('anchors to a table that follows the chain', () => {
    const chains = chainsOf([kept('a'), table('t')]);
    expect(chains.get(0)?.anchorIndex).toBe(1);
  });

  it('has no anchor when the chain reaches the end of the document', () => {
    const chains = chainsOf([paragraph('x'), kept('a'), kept('b')]);
    expect(chains.get(1)).toEqual({
      startIndex: 1,
      endIndex: 2,
      memberIndices: [1, 2],
      anchorIndex: NO_KEEP_NEXT_ANCHOR,
    });
  });

  it('drops a single keep-next paragraph that runs into an explicit break', () => {
    expect(chainsOf([kept('a'), { kind: 'pageBreak', id: 'pb' }, paragraph('b')]).size).toBe(0);
    expect(chainsOf([kept('a'), { kind: 'columnBreak', id: 'cb' }, paragraph('b')]).size).toBe(0);
    expect(chainsOf([kept('a'), { kind: 'sectionBreak', id: 'sb', margins: {} }, paragraph('b')]).size).toBe(0);
  });

  it('keeps a multi-paragraph chain that runs into an explicit break, without an anchor', () => {
    const chains = chainsOf([kept('a'), kept('b'), { kind: 'pageBreak', id: 'pb' }, paragraph('c')]);
    expect(chains.get(0)).toEqual({
      startIndex: 0,
      endIndex: 1,
      memberIndices: [0, 1],
      anchorIndex: NO_KEEP_NEXT_ANCHOR,
    });
  });

  it('only scans the candidate indices it is given', () => {
    const steps = computeKeepNextChainSteps([kept('a'), paragraph('b'), kept('c'), paragraph('d')], null, [2]);
    let step = steps.next();
    while (!step.done) step = steps.next();
    expect([...step.value.keys()]).toEqual([2]);
  });

  it('yields a checkpoint at every multiple of the checkpoint interval it visits', () => {
    const blocks = [kept('a'), kept('b'), kept('c'), paragraph('d')];
    const steps = computeKeepNextChainSteps(blocks, 2);
    const checkpoints = [];
    for (let step = steps.next(); !step.done; step = steps.next()) checkpoints.push(step.value);
    expect(checkpoints).toEqual([
      { index: 0, total: 4 },
      { index: 2, total: 4 },
      { index: 2, total: 4 },
    ]);
  });
});

describe('keptAnchorLineCount', () => {
  it('keeps every line of a keep-lines paragraph', () => {
    expect(keptAnchorLineCount(paragraph('p', { keepLines: true }), lines(10, 10, 10, 10, 10))).toBe(5);
  });

  it('keeps one line when widow control is off', () => {
    expect(keptAnchorLineCount(paragraph('p', { widowControl: false }), lines(10, 10, 10, 10, 10))).toBe(1);
  });

  it('keeps every line of a widow-controlled paragraph too short to split', () => {
    expect(keptAnchorLineCount(paragraph('p'), lines(10))).toBe(1);
    expect(keptAnchorLineCount(paragraph('p'), lines(10, 10))).toBe(2);
    expect(keptAnchorLineCount(paragraph('p'), lines(10, 10, 10))).toBe(3);
  });

  it('keeps two lines of a widow-controlled paragraph long enough to split', () => {
    expect(keptAnchorLineCount(paragraph('p'), lines(10, 10, 10, 10))).toBe(2);
    expect(keptAnchorLineCount(paragraph('p'), lines(10, 10, 10, 10, 10, 10))).toBe(2);
  });
});

describe('paragraph spacing', () => {
  it('reads the legacy lineSpace keys when the current keys are absent', () => {
    const legacySpacing = { line: 1, lineSpaceBefore: 7, lineSpaceAfter: 9 };
    const legacy = paragraph('p', { spacing: legacySpacing });
    expect(getParagraphSpacingBefore(legacy)).toBe(7);
    expect(getParagraphSpacingAfter(legacy)).toBe(9);
  });

  it('prefers the current keys over the legacy keys', () => {
    const bothSpacing = { before: 3, after: 4, lineSpaceBefore: 7, lineSpaceAfter: 9 };
    const both = paragraph('p', { spacing: bothSpacing });
    expect(getParagraphSpacingBefore(both)).toBe(3);
    expect(getParagraphSpacingAfter(both)).toBe(4);
  });

  it('treats negative and non-finite spacing as zero', () => {
    expect(getParagraphSpacingBefore(paragraph('p', { spacing: { before: -5, after: Number.NaN } }))).toBe(0);
    expect(getParagraphSpacingAfter(paragraph('p', { spacing: { before: -5, after: Number.NaN } }))).toBe(0);
  });
});

describe('calculateChainHeight', () => {
  function heightOf(blocks: FlowBlock[], measures: Measure[], state: PrecedingParagraphState = freshPage): number {
    const chain = chainsOf(blocks).get(0);
    if (!chain) throw new Error('expected a chain starting at block 0');
    return calculateChainHeight(chain, blocks, measures, state);
  }

  it('adds member heights, collapsed spacing between them, and the anchor start', () => {
    const blocks = [
      kept('heading', { spacing: { before: 0, after: 12 } }),
      kept('body', { spacing: { before: 6, after: 10 } }),
      paragraph('anchor', { spacing: { before: 4 } }),
    ];
    expect(heightOf(blocks, [lines(30), lines(50), lines(20)])).toBe(0 + 30 + 12 + 50 + 10 + 20);
  });

  it('collapses adjacent spacing to the larger of after and before', () => {
    const blocks = [kept('a', { spacing: { after: 5 } }), paragraph('b', { spacing: { before: 15 } })];
    expect(heightOf(blocks, [lines(10), lines(10)])).toBe(10 + 15 + 10);
  });

  it('drops a paragraph’s own spacing next to a same-style paragraph when it is contextual', () => {
    const style = { styleId: 'List', contextualSpacing: true };
    const blocks = [
      kept('a', { ...style, spacing: { after: 8 } }),
      paragraph('b', { ...style, spacing: { before: 8 } }),
    ];
    expect(heightOf(blocks, [lines(10), lines(10)])).toBe(20);
  });

  it('keeps the other paragraph’s spacing when only one side is contextual', () => {
    const blocks = [
      kept('a', { styleId: 'List', contextualSpacing: true, spacing: { after: 8 } }),
      paragraph('b', { styleId: 'List', spacing: { before: 6 } }),
    ];
    expect(heightOf(blocks, [lines(10), lines(10)])).toBe(26);
  });

  it('subtracts the preceding paragraph’s trailing spacing from the first member’s before spacing', () => {
    const blocks = [kept('a', { spacing: { before: 10 } }), paragraph('b')];
    const state = { ...freshPage, trailingSpacing: 4 };
    expect(heightOf(blocks, [lines(10), lines(10)], state)).toBe(6 + 10 + 10);
  });

  it('counts the first member’s full before spacing when the preceding paragraph drops its after spacing', () => {
    const blocks = [kept('a', { styleId: 'List', spacing: { before: 10 } }), paragraph('b')];
    const state = { trailingSpacing: 4, lastParagraphStyleId: 'List', lastParagraphContextualSpacing: true };
    expect(heightOf(blocks, [lines(10), lines(10)], state)).toBe(10 + 10 + 10);
  });

  it('drops the first member’s before spacing when it is contextual next to the same style', () => {
    const blocks = [kept('a', { styleId: 'List', contextualSpacing: true, spacing: { before: 10 } }), paragraph('b')];
    const state = { ...freshPage, lastParagraphStyleId: 'List' };
    expect(heightOf(blocks, [lines(10), lines(10)], state)).toBe(10 + 10);
  });

  it('reserves the anchor paragraph’s widow-valid start, not just its first line', () => {
    const blocks = [kept('a'), paragraph('b')];
    expect(heightOf(blocks, [lines(10), lines(7, 7, 7, 7, 7)])).toBe(10 + 14);
  });

  it('reserves only the first row of a table anchor, plus the last member’s after spacing', () => {
    const blocks = [kept('heading', { spacing: { after: 6 } }), table('t')];
    expect(heightOf(blocks, [lines(10), tableMeasure(25, 300, 300)])).toBe(10 + 6 + 25);
  });

  it('reserves the whole table when its first row has no usable height', () => {
    const blocks = [kept('heading'), table('t')];
    expect(heightOf(blocks, [lines(10), tableMeasure(0, 40)])).toBe(10 + 40);
  });

  it('reserves nothing for a floating table anchor', () => {
    const blocks = [kept('heading', { spacing: { after: 6 } }), table('t', true)];
    expect(heightOf(blocks, [lines(10), tableMeasure(25, 300)])).toBe(10);
  });

  it('counts a non-paragraph member’s height with no paragraph spacing', () => {
    const blocks: FlowBlock[] = [kept('a', { spacing: { after: 6 } }), floatingImage('picture'), paragraph('b')];
    const chain: KeepNextChain = { startIndex: 0, endIndex: 1, memberIndices: [0, 1], anchorIndex: 2 };
    const measures: Measure[] = [lines(10), { kind: 'image', width: 20, height: 20 }, lines(8)];
    expect(calculateChainHeight(chain, blocks, measures, freshPage)).toBe(10 + 6 + 20 + 0 + 8);
  });

  it('reserves nothing past the members when the chain has no anchor', () => {
    const blocks = [kept('a', { spacing: { after: 6 } }), kept('b')];
    expect(heightOf(blocks, [lines(10), lines(15)])).toBe(10 + 6 + 15);
  });
});
