import type { FlowBlock } from '@superdoc/contracts';
import { describe, expect, it } from 'bun:test';

import {
  buildFootnoteAnchorIndexSteps,
  type FootnoteAnchorIndexDiagnostics,
  type FootnoteAnchorIndexInput,
} from './footnote-anchor-index';

type AnchorEntry = { pmPos: number; refId: string; fullHeight: number; firstLineHeight: number };

const paragraph = (id: string, pmStart?: number, pmEnd?: number): FlowBlock =>
  ({
    kind: 'paragraph',
    id,
    runs: [],
    ...(pmStart == null ? {} : { attrs: { pmStart, ...(pmEnd == null ? {} : { pmEnd }) } }),
  }) as FlowBlock;

const paragraphWithRunRange = (id: string, pmStart: number, pmEnd: number): FlowBlock =>
  ({ kind: 'paragraph', id, runs: [{ kind: 'text', text: 'x', pmStart, pmEnd }] }) as FlowBlock;

const table = (id: string, children: FlowBlock[], pmStart?: number, pmEnd?: number): FlowBlock =>
  ({
    kind: 'table',
    id,
    rows: [{ id: `${id}-row`, cells: [{ id: `${id}-cell`, blocks: children }] }],
    ...(pmStart == null ? {} : { attrs: { pmStart, ...(pmEnd == null ? {} : { pmEnd }) } }),
  }) as FlowBlock;

const drain = <T>(generator: Generator<unknown, T, void>): T => {
  let step = generator.next();
  while (!step.done) step = generator.next();
  return step.value;
};

const legacyAnchorIndex = (
  blocks: FlowBlock[],
  footnotes: FootnoteAnchorIndexInput | undefined,
): { result: Map<string, AnchorEntry[]>; comparisons: number } => {
  const result = new Map<string, AnchorEntry[]>();
  const refs = footnotes?.refs;
  const bodyHeights = footnotes?.bodyHeightById;
  const firstLineHeights = footnotes?.firstLineHeightById;
  let comparisons = 0;
  if (!Array.isArray(refs) || refs.length === 0 || !bodyHeights) return { result, comparisons };

  const refByPos = new Map<number, string>();
  const seenIds = new Set<string>();
  for (const ref of refs) {
    if (seenIds.has(ref.id)) continue;
    seenIds.add(ref.id);
    refByPos.set(ref.pos, ref.id);
  }

  const resolveRange = (block: FlowBlock): { pmStart: number; pmEnd: number } | null => {
    const attrs = (block as { attrs?: { pmStart?: number; pmEnd?: number } }).attrs;
    let pmStart = typeof attrs?.pmStart === 'number' ? attrs.pmStart : undefined;
    let pmEnd = typeof attrs?.pmEnd === 'number' ? attrs.pmEnd : undefined;
    if (pmStart == null && block.kind === 'paragraph') {
      for (const run of block.runs ?? []) {
        const runStart = (run as { pmStart?: number }).pmStart;
        const runEnd = (run as { pmEnd?: number }).pmEnd;
        if (typeof runStart === 'number') pmStart = pmStart == null ? runStart : Math.min(pmStart, runStart);
        if (typeof runEnd === 'number') pmEnd = pmEnd == null ? runEnd : Math.max(pmEnd, runEnd);
      }
    }
    return pmStart == null ? null : { pmStart, pmEnd: pmEnd ?? pmStart + 1 };
  };

  const recordHits = (range: { pmStart: number; pmEnd: number }, topLevelId: string): void => {
    for (const [position, refId] of refByPos.entries()) {
      comparisons += 1;
      if (position < range.pmStart || position > range.pmEnd) continue;
      const fullHeight = bodyHeights.get(refId);
      if (typeof fullHeight !== 'number' || !Number.isFinite(fullHeight) || fullHeight <= 0) continue;
      const firstLineRaw = firstLineHeights?.get(refId);
      const firstLineHeight =
        typeof firstLineRaw === 'number' && Number.isFinite(firstLineRaw) && firstLineRaw > 0
          ? Math.min(firstLineRaw, fullHeight)
          : fullHeight;
      const entries = result.get(topLevelId) ?? [];
      entries.push({ pmPos: position, refId, fullHeight, firstLineHeight });
      result.set(topLevelId, entries);
      refByPos.delete(position);
    }
  };

  for (const block of blocks) {
    if (refByPos.size === 0) break;
    const range = resolveRange(block);
    if (range) recordHits(range, block.id);
    if (block.kind !== 'table') continue;
    for (const row of block.rows ?? []) {
      for (const cell of row.cells ?? []) {
        const children: FlowBlock[] = cell.blocks
          ? (cell.blocks as FlowBlock[])
          : cell.paragraph
            ? [cell.paragraph as FlowBlock]
            : [];
        for (const child of children) {
          const childRange = resolveRange(child);
          if (childRange) recordHits(childRange, block.id);
        }
      }
    }
  }

  for (const entries of result.values()) entries.sort((left, right) => left.pmPos - right.pmPos);
  return { result, comparisons };
};

const makeFootnotes = (
  refs: Array<{ id: string; pos: number }>,
  heights?: Array<number>,
): FootnoteAnchorIndexInput => ({
  refs,
  bodyHeightById: new Map(refs.map((ref, index) => [ref.id, heights?.[index] ?? 20 + (index % 7)])),
  firstLineHeightById: new Map(refs.map((ref, index) => [ref.id, 8 + (index % 5)])),
});

describe('buildFootnoteAnchorIndexSteps', () => {
  it('preserves exact native run ownership when reference positions are synthetic or shared', () => {
    const owner = paragraphWithRunRange('native-owner', 10, 20);
    if (owner.kind !== 'paragraph') throw new Error('Expected paragraph fixture');
    owner.runs.push({ text: '2', pmStart: 20, pmEnd: 20, fontFamily: 'Arial', fontSize: 12 });
    const refs = [
      { id: 'first', pos: 9_000, blockId: owner.id, runOrdinal: 0 },
      { id: 'second', pos: 9_000, blockId: owner.id, runOrdinal: 1 },
      { id: 'first', pos: 9_001, blockId: owner.id, runOrdinal: 1 },
    ];
    const footnotes = makeFootnotes(refs);
    footnotes.nativeRunOwnership = true;

    const actual = drain(buildFootnoteAnchorIndexSteps([owner], footnotes, 1));

    expect(actual.get(owner.id)).toEqual([
      { pmPos: 9_000, refId: 'first', runOrdinal: 0, fullHeight: 22, firstLineHeight: 10 },
      { pmPos: 9_000, refId: 'second', runOrdinal: 1, fullHeight: 21, firstLineHeight: 9 },
    ]);
  });

  it('keeps invalid native anchors and nested table references on the legacy fallback', () => {
    const owner = paragraphWithRunRange('owner', 10, 20);
    const nested = paragraphWithRunRange('nested', 30, 40);
    const blocks = [owner, table('table', [nested])];
    const refs = [
      { id: 'invalid-run', pos: 15, blockId: owner.id, runOrdinal: 9 },
      { id: 'missing-owner', pos: 16, blockId: 'absent', runOrdinal: 0 },
      { id: 'nested-ref', pos: 35, blockId: nested.id, runOrdinal: 0 },
    ];
    const footnotes = makeFootnotes(refs);

    const actual = drain(buildFootnoteAnchorIndexSteps(blocks, footnotes, 1));

    expect(actual).toEqual(legacyAnchorIndex(blocks, footnotes).result);
    expect(actual.get('table')?.map((entry) => entry.refId)).toEqual(['nested-ref']);
  });

  it.each([1, 8, 16])(
    'bounds scalar preflight work without a scheduler resumption per lookup (block cadence %i)',
    (cadence) => {
      const blocks = Array.from({ length: 64 }, (_, blockIndex) => ({
        kind: 'paragraph',
        id: `block-${blockIndex}`,
        runs: Array.from({ length: 256 }, (_, runIndex) => ({
          text: 'x',
          pmStart: blockIndex * 256 + runIndex,
          pmEnd: blockIndex * 256 + runIndex + 1,
        })),
      })) as FlowBlock[];
      const footnotes = makeFootnotes(
        Array.from({ length: 4096 }, (_, index) => ({ id: `ref-${index}`, pos: index * 4 + 1 })),
      );
      const steps = buildFootnoteAnchorIndexSteps(blocks, footnotes, cadence);
      const checkpoints: number[] = [];
      let step = steps.next();
      while (!step.done) {
        checkpoints.push(step.value.index);
        step = steps.next();
      }

      expect(step.value).toEqual(legacyAnchorIndex(blocks, footnotes).result);
      expect(checkpoints[0]).toBe(0);
      expect(checkpoints.length).toBeGreaterThan(100);
      expect(checkpoints.length).toBeLessThan(3000);
      for (let index = 1; index < checkpoints.length; index += 1) {
        expect(checkpoints[index]! - checkpoints[index - 1]!).toBeGreaterThan(0);
        expect(checkpoints[index]! - checkpoints[index - 1]!).toBeLessThanOrEqual(64);
      }
    },
  );

  it('anchors an exact diagnostic-owned reference without adding model positions to the block', () => {
    const diagnostic = paragraph('__superdoc_v2_render_diagnostic__/body/1-2');
    Object.defineProperty(diagnostic, Symbol.for('superdoc.v2.render-diagnostic.block'), {
      enumerable: false,
      value: true,
    });
    const ordinary = paragraph('ordinary-without-model-range');
    const footnotes: FootnoteAnchorIndexInput = {
      refs: [
        { id: 'diagnostic-note', pos: 20_000, blockId: diagnostic.id },
        { id: 'unproved-note', pos: 30_000, blockId: ordinary.id },
      ],
      bodyHeightById: new Map([
        ['diagnostic-note', 24],
        ['unproved-note', 24],
      ]),
      firstLineHeightById: new Map([
        ['diagnostic-note', 10],
        ['unproved-note', 10],
      ]),
    };

    const actual = drain(buildFootnoteAnchorIndexSteps([diagnostic, ordinary], footnotes, null));

    expect(actual.get(diagnostic.id)).toEqual([
      { pmPos: 20_000, refId: 'diagnostic-note', fullHeight: 24, firstLineHeight: 10 },
    ]);
    expect(actual.has(ordinary.id)).toBe(false);
  });

  it('preserves legacy ownership and edge-case semantics', () => {
    const blocks: FlowBlock[] = [
      paragraph('overlap-first', 10, 20),
      paragraph('overlap-second', 15, 30),
      paragraphWithRunRange('run-derived', 31, 40),
      table('table-owner', [paragraph('cell-child', 41, 50)]),
      paragraph('nonfinite-range', Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY),
    ];
    const refs = [
      { id: 'inclusive-start', pos: 10 },
      { id: 'inclusive-end', pos: 20 },
      { id: 'overlap', pos: 18 },
      { id: 'duplicate-id', pos: 19 },
      { id: 'duplicate-id', pos: 28 },
      { id: 'overwritten-position', pos: 25 },
      { id: 'position-winner', pos: 25 },
      { id: 'run-range', pos: 35 },
      { id: 'table-child', pos: 45 },
      { id: 'invalid-height', pos: 16 },
      { id: 'infinite-position', pos: Number.POSITIVE_INFINITY },
    ];
    const footnotes = makeFootnotes(refs);
    footnotes.bodyHeightById?.set('invalid-height', Number.NaN);
    footnotes.firstLineHeightById?.set('inclusive-start', 200);

    const expected = legacyAnchorIndex(blocks, footnotes).result;
    const actual = drain(buildFootnoteAnchorIndexSteps(blocks, footnotes, 1));

    expect(actual).toEqual(expected);
    expect(actual.get('overlap-first')?.map((entry) => entry.refId)).toEqual(
      ['inclusive-start', 'invalid-height', 'overlap', 'duplicate-id', 'inclusive-end'].filter(
        (id) => id !== 'invalid-height',
      ),
    );
    expect(actual.get('overlap-second')?.map((entry) => entry.refId)).toEqual(['position-winner']);
    expect(actual.get('table-owner')?.map((entry) => entry.refId)).toEqual(['table-child']);
  });

  it('matches the legacy scan across deterministic randomized finite ranges', () => {
    let seed = 0x5d4124;
    const random = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };

    for (let trial = 0; trial < 200; trial += 1) {
      const refs = Array.from({ length: 24 }, (_, index) => ({
        id: `trial-${trial}-ref-${index}`,
        pos: Math.floor(random() * 500),
      }));
      const blocks = Array.from({ length: 36 }, (_, index) => {
        const start = Math.floor(random() * 500);
        const end = start + Math.floor(random() * 80);
        return paragraph(`trial-${trial}-block-${index}`, start, end);
      });
      const footnotes = makeFootnotes(refs);
      if (trial % 9 === 0) footnotes.bodyHeightById?.set(refs[trial % refs.length]!.id, 0);

      const expected = legacyAnchorIndex(blocks, footnotes).result;
      const actual = drain(buildFootnoteAnchorIndexSteps(blocks, footnotes, null));
      expect(actual).toEqual(expected);
    }
  });

  it('keeps the indexed successor synchronized when a non-finite range uses the legacy path', () => {
    const blocks = [paragraph('nonfinite-owner', Number.NEGATIVE_INFINITY, 15), paragraph('finite-owner', 16, 30)];
    const footnotes = makeFootnotes([
      { id: 'first', pos: 10 },
      { id: 'second', pos: 20 },
    ]);
    const diagnostics: FootnoteAnchorIndexDiagnostics = {
      rangeComparisons: 0,
      lowerBoundComparisons: 0,
      legacyComparisons: 0,
    };

    const expected = legacyAnchorIndex(blocks, footnotes).result;
    const actual = drain(buildFootnoteAnchorIndexSteps(blocks, footnotes, 1, diagnostics));

    expect(actual).toEqual(expected);
    expect(actual.get('nonfinite-owner')?.map((entry) => entry.refId)).toEqual(['first']);
    expect(actual.get('finite-owner')?.map((entry) => entry.refId)).toEqual(['second']);
    expect(diagnostics.legacyComparisons).toBeGreaterThan(0);
    expect(diagnostics.lowerBoundComparisons).toBeGreaterThan(0);
  });

  it('reduces anchor-range comparisons for the reported document shape', () => {
    const refs = Array.from({ length: 372 }, (_, index) => ({ id: `ref-${index}`, pos: (542 + index) * 10 + 5 }));
    const blocks = Array.from({ length: 914 }, (_, index) => paragraph(`block-${index}`, index * 10, index * 10 + 9));
    const footnotes = makeFootnotes(refs);
    const legacy = legacyAnchorIndex(blocks, footnotes);
    const diagnostics: FootnoteAnchorIndexDiagnostics = {
      rangeComparisons: 0,
      lowerBoundComparisons: 0,
      legacyComparisons: 0,
    };

    expect(drain(buildFootnoteAnchorIndexSteps(blocks, footnotes, null, diagnostics))).toEqual(legacy.result);
    expect(legacy.comparisons).toBeGreaterThan(200_000);
    expect(diagnostics.legacyComparisons).toBe(0);
    expect(diagnostics.rangeComparisons).toBeLessThan(legacy.comparisons / 10);
  });
});
