import { beforeEach, describe, expect, it } from 'vite-plus/test';
import type { FlowBlock, Layout, Measure, ParagraphBlock, ParagraphMeasure } from '@superdoc/contracts';
import type { LayoutOptions } from '@superdoc/layout-engine';
import {
  __test_only_shouldAttemptPreparedCoupledConvergenceRetry,
  __test_only_readMeasuredCoupledInitialPageHorizon,
  clearIncrementalModuleState,
  incrementalLayout,
  type IncrementalLayoutResult,
  type IncrementalLayoutReuseOptions,
} from '../src/incrementalLayout';

type NativeReference = { id: string; pos: number; blockId: string; runOrdinal: number };
type Fixture = {
  blocks: FlowBlock[];
  refs: NativeReference[];
  notes: Map<string, ParagraphBlock[]>;
};

const pageSize = { w: 240, h: 220 };
const margins = { top: 10, bottom: 10, left: 10, right: 10 };
const paragraph = (id: string, text = 'x', attrs: ParagraphBlock['attrs'] = {}): ParagraphBlock => ({
  kind: 'paragraph',
  id,
  attrs,
  // Native reference ownership must not depend on unique synthetic PM positions.
  runs: [{ text, fontFamily: 'Arial', fontSize: 12, pmStart: 0, pmEnd: 0 }],
});
const sectionSeed: FlowBlock = {
  kind: 'sectionBreak',
  id: 'section-seed',
  type: 'continuous',
  pageSize,
  margins,
  columns: { count: 1, gap: 0 },
  attrs: { source: 'sectPr', sectionIndex: 0, isFirstSection: true },
};

// One source character per measured line gives the coverage oracle independent,
// exact run/character ranges without a browser font or platform dependency.
function sourceMeasure(block: ParagraphBlock): ParagraphMeasure {
  const lineHeight = block.attrs?.spacing?.line ?? (block.id.startsWith('footnote:') ? 10 : 25);
  const lines = block.runs.flatMap((run, runOrdinal) => {
    if (!('text' in run)) throw new Error('The locality fixture only contains text runs');
    return Array.from({ length: run.text.length }, (_, char) => ({
      fromRun: runOrdinal,
      toRun: runOrdinal,
      fromChar: char,
      toChar: char + 1,
      width: 20,
      ascent: lineHeight * 0.8,
      descent: lineHeight * 0.2,
      lineHeight,
    }));
  });
  return { kind: 'paragraph', lines, totalHeight: lines.length * lineHeight, measuredAtMaxWidth: 220 };
}

const measureBlock = async (block: FlowBlock): Promise<Measure> => {
  if (block.kind === 'sectionBreak') return { kind: 'sectionBreak' };
  if (block.kind !== 'paragraph') throw new Error('Unexpected locality fixture block');
  return sourceMeasure(block);
};

function fixture(dirtyLines = 1, tailCount = 24): Fixture {
  const body: ParagraphBlock[] = Array.from({ length: 14 }, (_, index) => paragraph(`body:prefix/o${index}`));
  body.push(paragraph('body:heading/o14', 'h', { keepNext: true }));
  body.push(paragraph('body:dirty/o15', 'x'.repeat(dirtyLines), { keepLines: true, widowControl: true }));
  body.push(...Array.from({ length: tailCount }, (_, index) => paragraph(`body:tail/o${index + 16}`)));
  const refs = body
    .slice(16)
    .flatMap((block, index) =>
      index % 3 === 0 ? [{ id: `note-${index}`, pos: 0, blockId: block.id, runOrdinal: 0 }] : [],
    );
  return {
    blocks: [sectionSeed, ...body],
    refs,
    notes: new Map(refs.map((ref) => [ref.id, [paragraph(`footnote:${ref.id}`, 'n'.repeat(7))]])),
  };
}

function options(input: Fixture): LayoutOptions {
  return {
    pageSize,
    margins,
    footnotes: {
      refs: input.refs,
      blocksById: input.notes,
      referenceTopologyRevision: 'native-locality-notes-v1',
      topPadding: 2,
      dividerHeight: 2,
      gap: 2,
      separatorSpacingBefore: 4,
    },
  };
}

function replaceParagraph(input: Fixture, id: string, text: string): Fixture {
  return {
    ...input,
    blocks: input.blocks.map((block) =>
      block.id === id && block.kind === 'paragraph' ? paragraph(id, text, block.attrs) : block,
    ),
  };
}

function withBodyPositions(input: Fixture): Fixture {
  const blocks = input.blocks.map((block, index) => {
    if (block.kind !== 'paragraph') return block;
    let offset = 20 * index + 1;
    return {
      ...block,
      runs: block.runs.map((run) => {
        if (!('text' in run)) throw new Error('The positioned fixture only contains text runs');
        const positioned = { ...run, pmStart: offset, pmEnd: offset + run.text.length };
        offset = positioned.pmEnd;
        return positioned;
      }),
    };
  });
  const byId = new Map(blocks.map((block) => [block.id, block]));
  return {
    ...input,
    blocks,
    refs: input.refs.map((ref) => ({
      ...ref,
      pos: (byId.get(ref.blockId) as ParagraphBlock).runs[ref.runOrdinal].pmStart!,
    })),
  };
}

function insertBodyCharacter(
  input: Fixture,
  dirtyId: string,
): {
  input: Fixture;
  pmShift: NonNullable<IncrementalLayoutReuseOptions['pmShift']>;
} {
  const dirtyIndex = input.blocks.findIndex((block) => block.id === dirtyId);
  const dirty = input.blocks[dirtyIndex] as ParagraphBlock;
  const atChar = dirty.runs[0].pmEnd!;
  const blocks = input.blocks.map((block, index) => {
    if (block.kind !== 'paragraph' || index < dirtyIndex) return block;
    return {
      ...block,
      runs: block.runs.map((run) => {
        if (!('text' in run)) throw new Error('The positioned fixture only contains text runs');
        return index === dirtyIndex
          ? { ...run, text: `${run.text}!`, pmEnd: run.pmEnd! + 1 }
          : { ...run, pmStart: run.pmStart! + 1, pmEnd: run.pmEnd! + 1 };
      }),
    };
  });
  return {
    input: {
      ...input,
      blocks,
      refs: input.refs.map((ref) => ({ ...ref, pos: ref.pos >= atChar ? ref.pos + 1 : ref.pos })),
    },
    pmShift: { atChar, delta: 1 },
  };
}

const pageKey = (page: Layout['pages'][number]) => {
  const first = page.fragments[0];
  const from = first && ('fromLine' in first ? first.fromLine : 'fromRow' in first ? first.fromRow : 0);
  return `${first?.blockId ?? ''}#${from ?? 0}#${page.sectionIndex ?? 0}#${first && 'continuesFromPrev' in first && first.continuesFromPrev ? 1 : 0}`;
};

function firstPage(layout: Layout, id: string): number {
  return layout.pages.findIndex((page) => page.fragments.some((fragment) => fragment.blockId === id));
}

function retainedReuse(
  previous: IncrementalLayoutResult,
  before: Fixture,
  after: Fixture,
  dirtyId: string,
  structural?: {
    deleted: string[];
    inserted?: string[];
    rewrites: NonNullable<IncrementalLayoutReuseOptions['blockIdRewrites']>;
  },
): IncrementalLayoutReuseOptions {
  const layout = previous.layout;
  layout.layoutEpoch = (layout.layoutEpoch ?? 0) + 1;
  const blockPages = new Map<string, { firstPage: number; lastPage: number }>();
  const keyIndexes = new Map<string, number[]>();
  layout.pages.forEach((page, index) => {
    const key = pageKey(page);
    keyIndexes.set(key, [...(keyIndexes.get(key) ?? []), index]);
    for (const fragment of page.fragments) {
      const range = blockPages.get(fragment.blockId);
      if (range) range.lastPage = index;
      else blockPages.set(fragment.blockId, { firstPage: index, lastPage: index });
    }
  });
  const previousIndexes = new Map(before.blocks.map((block, index) => [block.id, index]));
  const currentIndexes = new Map(after.blocks.map((block, index) => [block.id, index]));
  const dirtyIndex = currentIndexes.get(dirtyId)!;
  const previousId = structural?.rewrites.currentToPrevious.get(dirtyId) ?? dirtyId;
  const previousIndex = previousIndexes.get(previousId)!;
  let checkpointPageIndex = blockPages.get(previousId)!.firstPage;
  let checkpointBlockId = previousId;
  let predecessor = before.blocks[previousIndex - 1];
  const resume = layout.blockResumeCheckpoints?.get(previousId);
  if (resume?.pageIndex !== checkpointPageIndex || (predecessor?.kind === 'paragraph' && predecessor.attrs?.keepNext)) {
    for (; checkpointPageIndex >= 0; checkpointPageIndex--) {
      const first = layout.pages[checkpointPageIndex].fragments.find((fragment) =>
        previousIndexes.has(fragment.blockId),
      );
      if (!first) continue;
      checkpointBlockId = first.blockId;
      predecessor = before.blocks[previousIndexes.get(first.blockId)! - 1];
      if (
        first.kind === 'para' &&
        first.fromLine === 0 &&
        !first.continuesFromPrev &&
        (predecessor?.kind !== 'paragraph' || !predecessor.attrs?.keepNext)
      )
        break;
    }
  }
  expect(checkpointPageIndex).toBeGreaterThanOrEqual(0);
  return {
    previousLayout: layout,
    retainedMetadataSourceLayoutEpoch: layout.layoutEpoch,
    previousPageStartKeys: layout.pages.map(pageKey),
    previousPageStartKeyIndex: keyIndexes,
    previousBlockPageIndex: blockPages,
    previousBlockIndexById: previousIndexes,
    currentBlockIndexById: currentIndexes,
    ...(structural ? { allowBlockIdChurn: true, blockIdRewrites: structural.rewrites } : {}),
    dirtyBlockIds: [dirtyId, ...(structural?.inserted ?? [])],
    provedDirtyRegion: {
      firstDirtyIndex: dirtyIndex,
      lastStableIndex: dirtyIndex - 1,
      changedBlockIds: [dirtyId],
      insertedBlockIds: structural?.inserted ?? [],
      deletedBlockIds: structural?.deleted ?? [],
      stableBlockIds: new Set(
        after.blocks
          .filter((block) => block.id !== dirtyId && !structural?.inserted?.includes(block.id))
          .map((block) => block.id),
      ),
    },
    provedDirtyMeasureConstraints: new Map(
      [dirtyId, ...(structural?.inserted ?? [])].map((id) => [id, { maxWidth: 220, maxHeight: 200 }] as const),
    ),
    dependencyProof: {
      profile: 'page-checkpoint-local-text',
      blockIdsUnchanged: true,
      blockIdsUnique: true,
      globalDependenciesAbsent: false,
      globalDependenciesFencedByPageCheckpoint: true,
      admittedDependencyClasses: ['footnotes', 'keep-constraints'],
      localKeepDependencyClosure: {
        checkpointPageIndex,
        checkpointBlockId,
        predecessorBlockId: predecessor?.id ?? null,
      },
      renderInputsUnchanged: true,
      pageReferencesAbsent: true,
      crossReferencesAbsent: true,
      multiColumnSectionsProvedNonBalanceable: true,
    },
    maxRelaidPages: 4,
  };
}

async function historyRestorationLayout(input: {
  deleted: IncrementalLayoutResult;
  source: IncrementalLayoutResult;
  before: Fixture;
  restored: Fixture;
  reuse: IncrementalLayoutReuseOptions;
  sourceTxId: string;
  proofSourceTxId?: string;
  restoredNoteIds: readonly string[];
}): Promise<IncrementalLayoutResult> {
  const currentSeed = input.deleted.footnoteReserveSeed;
  const sourceSeed = input.source.footnoteReserveSeed;
  if (
    !currentSeed?.noteBlocksByBlockId ||
    !currentSeed.noteMeasuresByBlockId ||
    !currentSeed.noteBodyHeightById ||
    !currentSeed.noteFirstLineHeightById ||
    !sourceSeed?.noteBlocksByBlockId ||
    !sourceSeed.noteMeasuresByBlockId ||
    !sourceSeed.noteBodyHeightById ||
    !sourceSeed.noteFirstLineHeightById
  )
    throw new Error('expected exact coupled note seeds');

  const noteBlocksByBlockId = new Map(currentSeed.noteBlocksByBlockId);
  const noteMeasuresByBlockId = new Map(currentSeed.noteMeasuresByBlockId);
  const noteBodyHeightById = new Map(currentSeed.noteBodyHeightById);
  const noteFirstLineHeightById = new Map(currentSeed.noteFirstLineHeightById);
  for (const noteId of input.restoredNoteIds) {
    const blocks = input.restored.notes.get(noteId);
    const totalHeight = sourceSeed.noteBodyHeightById.get(noteId);
    const firstLineHeight = sourceSeed.noteFirstLineHeightById.get(noteId);
    if (!blocks?.length || totalHeight == null || firstLineHeight == null) {
      throw new Error(`missing source note plane for ${noteId}`);
    }
    noteBodyHeightById.set(noteId, totalHeight);
    noteFirstLineHeightById.set(noteId, firstLineHeight);
    for (const block of blocks) {
      const sourceBlock = sourceSeed.noteBlocksByBlockId.get(block.id);
      const sourceMeasure = sourceSeed.noteMeasuresByBlockId.get(block.id);
      if (sourceBlock !== block || sourceMeasure == null) {
        throw new Error(`mismatched source note block ${block.id}`);
      }
      noteBlocksByBlockId.set(block.id, block);
      noteMeasuresByBlockId.set(block.id, sourceMeasure);
    }
  }

  return incrementalLayout(
    input.before.blocks,
    input.deleted.layout,
    input.restored.blocks,
    options(input.restored),
    measureBlock,
    undefined,
    input.deleted.measures,
    undefined,
    {
      footnoteReserveSeed: {
        ...currentSeed,
        noteBlocksByBlockId,
        noteMeasuresByBlockId,
        noteBodyHeightById,
        noteFirstLineHeightById,
      },
      noteMeasurePlaneRetainedExact: true,
      retainedFootnoteExtras: {
        blocks: input.deleted.extraBlocks!,
        measures: input.deleted.extraMeasures!,
      },
      historyFootnoteRestoration: {
        sourceTxId: input.sourceTxId,
        restoredNoteIds: input.restoredNoteIds,
        sourceSeed,
      },
    },
    {
      ...input.reuse,
      provedNoteReferenceRestoration: {
        sourceTxId: input.proofSourceTxId ?? input.sourceTxId,
        restoredNoteIds: input.restoredNoteIds,
      },
    },
  );
}

async function warmLayout(
  previous: IncrementalLayoutResult,
  before: Fixture,
  after: Fixture,
  reuse: IncrementalLayoutReuseOptions,
  measureCurrentBlock = measureBlock,
): Promise<IncrementalLayoutResult> {
  return incrementalLayout(
    before.blocks,
    previous.layout,
    after.blocks,
    options(after),
    measureCurrentBlock,
    undefined,
    previous.measures,
    undefined,
    {
      footnoteReserveSeed: previous.footnoteReserveSeed,
      noteMeasurePlaneRetainedExact: true,
      retainedFootnoteExtras: { blocks: previous.extraBlocks!, measures: previous.extraMeasures! },
    },
    reuse,
  );
}

const geometry = (layout: Layout) =>
  layout.pages.map((page) => ({
    number: page.number,
    size: page.size,
    margins: page.margins,
    sectionIndex: page.sectionIndex,
    bodyMaxY: (page as { bodyMaxY?: number }).bodyMaxY,
    reserve: page.footnoteReserved,
    ledger: page.footnoteLedger,
    fragments: page.fragments.map((fragment) => ({
      kind: fragment.kind,
      id: fragment.blockId,
      x: fragment.x,
      y: fragment.y,
      width: fragment.width,
      pmStart: 'pmStart' in fragment ? fragment.pmStart : undefined,
      pmEnd: 'pmEnd' in fragment ? fragment.pmEnd : undefined,
      height: 'height' in fragment ? fragment.height : undefined,
      from: 'fromLine' in fragment ? fragment.fromLine : undefined,
      to: 'toLine' in fragment ? fragment.toLine : undefined,
      continuesFromPrev: 'continuesFromPrev' in fragment ? fragment.continuesFromPrev : undefined,
      continuesOnNext: 'continuesOnNext' in fragment ? fragment.continuesOnNext : undefined,
    })),
  }));

function assertSourceCoverage(result: IncrementalLayoutResult, input: Fixture): void {
  const sources = [
    ...input.blocks.filter((block): block is ParagraphBlock => block.kind === 'paragraph'),
    ...[...input.notes.values()].flat(),
  ];
  const expected = new Map(sources.map((block) => [block.id, sourceMeasure(block)]));
  const measured = new Map([
    ...result.blocks.map((block, index) => [block.id, result.measures[index]] as const),
    ...(result.extraBlocks ?? []).map((block, index) => [block.id, result.extraMeasures![index]] as const),
  ]);
  const seen = new Map<string, number[]>();
  for (const page of result.layout.pages) {
    for (const fragment of page.fragments) {
      expect(measured.has(fragment.blockId), `unresolved fragment ${fragment.blockId}`).toBe(true);
      if (fragment.kind !== 'para') continue;
      const source = expected.get(fragment.blockId);
      const actual = measured.get(fragment.blockId);
      expect(source, `unexpected source paragraph ${fragment.blockId}`).toBeDefined();
      if (!source || actual?.kind !== 'paragraph') throw new Error(`Missing paragraph ${fragment.blockId}`);
      const lines = fragment.lines ?? actual.lines.slice(fragment.fromLine, fragment.toLine);
      const range = (line: ParagraphMeasure['lines'][number]) => [line.fromRun, line.fromChar, line.toRun, line.toChar];
      expect(lines.map(range)).toEqual(source.lines.slice(fragment.fromLine, fragment.toLine).map(range));
      expect(fragment.y + lines.reduce((sum, line) => sum + line.lineHeight, 0)).toBeLessThanOrEqual(210 + 1e-7);
      const indices = seen.get(fragment.blockId) ?? [];
      for (let index = fragment.fromLine; index < fragment.toLine; index++) indices.push(index);
      seen.set(fragment.blockId, indices);
    }
  }
  for (const [id, source] of expected) {
    expect(seen.get(id), `source lines for ${id}`).toEqual(source.lines.map((_, index) => index));
  }
  for (const ref of input.refs) {
    const anchorLine = expected
      .get(ref.blockId)!
      .lines.findIndex((line) => line.fromRun <= ref.runOrdinal && line.toRun >= ref.runOrdinal);
    const anchorPage = result.layout.pages.findIndex((page) =>
      page.fragments.some(
        (fragment) =>
          fragment.blockId === ref.blockId &&
          fragment.kind === 'para' &&
          fragment.fromLine <= anchorLine &&
          fragment.toLine > anchorLine,
      ),
    );
    expect(anchorPage).toBeGreaterThanOrEqual(0);
    expect(firstPage(result.layout, input.notes.get(ref.id)![0].id), `first slice of ${ref.id}`).toBe(anchorPage);
  }
  expect(result.layout.pages.at(-1)?.footnoteLedger?.continuationOut ?? []).toEqual([]);
}

async function assertFreshEquivalent(
  result: IncrementalLayoutResult,
  input: Fixture,
  measureCurrentBlock = measureBlock,
): Promise<void> {
  clearIncrementalModuleState();
  const fresh = await incrementalLayout([], null, input.blocks, options(input), measureCurrentBlock);
  assertSourceCoverage(fresh, input);
  assertSourceCoverage(result, input);
  expect(geometry(result.layout)).toEqual(geometry(fresh.layout));
}

describe('coupled footnote local edit conservation', () => {
  beforeEach(() => clearIncrementalModuleState());

  it('widens the first measured-note probe by at most one quarter of the untouched tail', () => {
    expect(
      __test_only_readMeasuredCoupledInitialPageHorizon({
        requestedPageHorizon: 3,
        sourceAffectedFrontierPageIndex: 857,
        previousPageCount: 1743,
      }),
    ).toBe(128);
    expect(
      __test_only_readMeasuredCoupledInitialPageHorizon({
        requestedPageHorizon: 3,
        sourceAffectedFrontierPageIndex: 15,
        previousPageCount: 23,
      }),
    ).toBe(3);
    expect(
      __test_only_readMeasuredCoupledInitialPageHorizon({
        requestedPageHorizon: 5,
        sourceAffectedFrontierPageIndex: 90,
        previousPageCount: 100,
      }),
    ).toBe(5);
  });

  it('bounds one late coupled convergence retry to at most 25% of the retained suffix', () => {
    const largeSuffix = {
      preparedCoupled: true,
      provedPrefixToDocumentEnd: true,
      sameInvocationReserveRelayout: false,
      paginationPrefix: false,
      boundedRenderDiagnosticRetry: false,
      retryAttempted: false,
      terminalAttempted: false,
      reachesSourceTail: false,
      currentPageHorizon: 4,
      sourceAffectedFrontierPageIndex: 26,
      checkpointPageIndex: 25,
      previousPageCount: 1751,
    };
    expect(__test_only_shouldAttemptPreparedCoupledConvergenceRetry(largeSuffix)).toBe(true);
    expect(
      __test_only_shouldAttemptPreparedCoupledConvergenceRetry({
        ...largeSuffix,
        // The retry can emit 131 pages here, so a retained suffix below
        // 4 * 131 pages must go directly to the exact EOF pass.
        previousPageCount: 548,
      }),
    ).toBe(false);
    expect(
      __test_only_shouldAttemptPreparedCoupledConvergenceRetry({
        ...largeSuffix,
        previousPageCount: 549,
      }),
    ).toBe(true);
  });

  it.each([
    { gate: 'prepared coupling', change: { preparedCoupled: false } },
    { gate: 'proved prefix', change: { provedPrefixToDocumentEnd: false } },
    { gate: 'reserve pass', change: { sameInvocationReserveRelayout: true } },
    { gate: 'diagnostic prefix', change: { paginationPrefix: true } },
    { gate: 'bounded diagnostic', change: { boundedRenderDiagnosticRetry: true } },
    { gate: 'single retry', change: { retryAttempted: true } },
    { gate: 'pre-terminal retry', change: { terminalAttempted: true } },
    { gate: 'source-tail exclusion', change: { reachesSourceTail: true } },
    { gate: 'smaller first horizon', change: { currentPageHorizon: 128 } },
  ])('keeps the late coupled retry behind the $gate gate', ({ change }) => {
    expect(
      __test_only_shouldAttemptPreparedCoupledConvergenceRetry({
        preparedCoupled: true,
        provedPrefixToDocumentEnd: true,
        sameInvocationReserveRelayout: false,
        paginationPrefix: false,
        boundedRenderDiagnosticRetry: false,
        retryAttempted: false,
        terminalAttempted: false,
        reachesSourceTail: false,
        currentPageHorizon: 4,
        sourceAffectedFrontierPageIndex: 26,
        checkpointPageIndex: 25,
        previousPageCount: 1751,
        ...change,
      }),
    ).toBe(false);
  });

  it.each([
    { from: 1, to: 3, oldPage: 1, newPage: 2 },
    { from: 3, to: 1, oldPage: 2, newPage: 1 },
  ])(
    'keeps a boundary heading with its dirty follower when the follower changes from $from to $to lines',
    async ({ from, to, oldPage, newPage }) => {
      const before = fixture(from);
      const previous = await incrementalLayout([], null, before.blocks, options(before), measureBlock);
      expect(previous.footnoteReserveSeed?.paginationPolicy).toBe('coupled-v1');
      expect(firstPage(previous.layout, 'body:heading/o14')).toBe(oldPage);
      const after = replaceParagraph(before, 'body:dirty/o15', 'x'.repeat(to));
      const result = await warmLayout(
        previous,
        before,
        after,
        retainedReuse(previous, before, after, 'body:dirty/o15'),
      );
      await assertFreshEquivalent(result, after);
      expect(firstPage(result.layout, 'body:heading/o14')).toBe(newPage);
      expect(firstPage(result.layout, 'body:dirty/o15')).toBe(newPage);
    },
  );

  it('replays a kept predecessor from its exact partial-page checkpoint', async () => {
    const base = fixture(1, 36);
    const before: Fixture = {
      ...base,
      blocks: [
        sectionSeed,
        paragraph('body:long-prefix/o1', 'x'.repeat(13)),
        paragraph('body:heading/o14', 'h', { keepNext: true }),
        paragraph('body:dirty/o15', 'x', { keepLines: true, widowControl: true }),
        ...base.blocks.filter((block) => block.id.startsWith('body:tail/')),
      ],
    };
    const previous = await incrementalLayout([], null, before.blocks, options(before), measureBlock);
    const headingPage = firstPage(previous.layout, 'body:heading/o14');
    expect(headingPage).toBeGreaterThan(0);
    expect(previous.layout.pages[headingPage]?.fragments[0]).toMatchObject({
      blockId: 'body:long-prefix/o1',
      continuesFromPrev: true,
    });
    const after = replaceParagraph(before, 'body:dirty/o15', 'xx');
    const result = await warmLayout(previous, before, after, retainedReuse(previous, before, after, 'body:dirty/o15'));

    await assertFreshEquivalent(result, after);
    expect(result.layoutReuse).toMatchObject({
      mode: 'tail-splice',
      checkpointPageIndex: headingPage,
    });
    expect(result.layoutReuse?.pagesPaginated).toBeLessThan(previous.layout.pages.length);
  });

  it.each(['keepLines', 'widowControl', 'keepNext'] as const)(
    'pulls a shortened %s paragraph back before its cold deferral',
    async (keep) => {
      let before = fixture();
      const dirtyId = keep === 'keepNext' ? 'body:heading/o14' : 'body:dirty/o15';
      before = {
        ...before,
        blocks: before.blocks.map((block) => {
          if (block.id === dirtyId) return paragraph(dirtyId, 'xxx', { [keep]: true });
          if (block.id === 'body:heading/o14' && keep !== 'keepNext') return paragraph(block.id, 'h');
          return block;
        }),
      };
      const previous = await incrementalLayout([], null, before.blocks, options(before), measureBlock);
      const oldPage = firstPage(previous.layout, dirtyId);
      const resume = previous.layout.blockResumeCheckpoints?.get(dirtyId);
      expect(oldPage).toBe(2);
      // Keep-next preflight records after the push; keep-lines/widow records
      // before it. Neither checkpoint may prevent a shortened block pulling back.
      if (keep === 'keepNext') {
        expect(resume?.pageIndex).toBe(oldPage);
        expect(resume?.preflightPageIndex).toBeLessThan(oldPage);
      } else {
        expect(resume?.pageIndex).toBeLessThan(oldPage);
      }
      const after = replaceParagraph(before, dirtyId, 'x');
      const result = await warmLayout(previous, before, after, retainedReuse(previous, before, after, dirtyId));
      await assertFreshEquivalent(result, after);
      expect(firstPage(result.layout, dirtyId)).toBe(1);
    },
  );

  it('discards a later partial-page prefix when an earlier keep chain forces checkpoint rewind', async () => {
    const base = fixture();
    const chain = Array.from({ length: 14 }, (_, index) =>
      paragraph(`body:chain/o${index + 8}`, 'x', {
        keepNext: index < 13,
        spacing: { line: 30, lineUnit: 'px', lineRule: 'exact' },
      }),
    );
    const shortAttrs: ParagraphBlock['attrs'] = { spacing: { line: 5, lineUnit: 'px', lineRule: 'exact' } };
    const dirtyId = 'body:late-dirty/o23';
    const before = {
      ...base,
      blocks: [
        sectionSeed,
        ...base.blocks.slice(1, 9),
        ...chain,
        paragraph('body:short-predecessor/o22', 'x', shortAttrs),
        paragraph(dirtyId, 'x', shortAttrs),
        ...base.blocks.slice(17),
      ],
    };
    const previous = await incrementalLayout([], null, before.blocks, options(before), measureBlock);
    const dirtyPage = firstPage(previous.layout, dirtyId);
    const first = previous.layout.pages[dirtyPage].fragments[0];
    const firstIndex = before.blocks.findIndex((block) => block.id === first.blockId);
    const predecessor = before.blocks[firstIndex - 1] as ParagraphBlock;
    expect(first.blockId).toMatch(/^body:chain\//);
    expect(predecessor.attrs?.keepNext).toBe(true);
    expect(firstPage(previous.layout, chain[0].id)).toBeLessThan(dirtyPage);
    expect(previous.layout.blockResumeCheckpoints?.get(dirtyId)?.pageIndex).toBe(dirtyPage);
    expect(
      (before.blocks[before.blocks.findIndex((block) => block.id === dirtyId) - 1] as ParagraphBlock).attrs?.keepNext,
    ).not.toBe(true);
    const after = replaceParagraph(before, dirtyId, 'y');
    const result = await warmLayout(previous, before, after, retainedReuse(previous, before, after, dirtyId));
    await assertFreshEquivalent(result, after);
  });

  it('resolves the current native marker ordinal after typing splits runs without changing note topology', async () => {
    const base = fixture();
    const dirtyId = 'body:dirty/o15';
    const marker = { id: 'note-dirty', pos: 0, blockId: dirtyId, runOrdinal: 1 };
    const withRuns = (texts: string[]): ParagraphBlock => ({
      ...paragraph(dirtyId, '', { widowControl: true }),
      runs: texts.map((text) => ({ text, fontFamily: 'Arial', fontSize: 12, pmStart: 0, pmEnd: 0 })),
    });
    const before = {
      ...base,
      blocks: base.blocks.map((block) => (block.id === dirtyId ? withRuns(['ab', '1']) : block)),
      refs: [marker, ...base.refs],
      notes: new Map([...base.notes, [marker.id, [paragraph(`footnote:${marker.id}`, 'nnnn')]]]),
    };
    const previous = await incrementalLayout([], null, before.blocks, options(before), measureBlock);
    const after = {
      ...before,
      blocks: before.blocks.map((block) => (block.id === dirtyId ? withRuns(['a', 'bc', '1']) : block)),
      refs: [{ ...marker, runOrdinal: 2 }, ...base.refs],
    };
    const result = await warmLayout(previous, before, after, retainedReuse(previous, before, after, dirtyId));
    await assertFreshEquivalent(result, after);
  });

  it('locally reconciles a removed note and a surviving marker moved out of a merged paragraph', async () => {
    const base = fixture();
    const dirtyId = 'body:dirty/o15';
    const removedId = 'body:tail/o16';
    const removedReference = base.refs.find((ref) => ref.blockId === removedId);
    if (!removedReference) throw new Error('expected a note-bearing merged paragraph');
    const movedReference = { id: 'note-moved', pos: 0, blockId: removedId, runOrdinal: 0 };
    const before: Fixture = {
      ...base,
      refs: [movedReference, ...base.refs],
      notes: new Map([...base.notes, [movedReference.id, [paragraph(`footnote:${movedReference.id}`, 'm'.repeat(9))]]]),
    };
    const previous = await incrementalLayout([], null, before.blocks, options(before), measureBlock);
    const after: Fixture = {
      ...before,
      blocks: before.blocks
        .filter((block) => block.id !== removedId)
        .map((block) => (block.id === dirtyId ? paragraph(dirtyId, 'merged') : block)),
      refs: before.refs
        .filter((ref) => ref.id !== removedReference.id)
        .map((ref) => (ref.id === movedReference.id ? { ...ref, blockId: dirtyId, runOrdinal: 0 } : ref)),
      notes: new Map([...before.notes].filter(([id]) => id !== removedReference.id)),
    };
    const result = await warmLayout(
      previous,
      before,
      after,
      retainedReuse(previous, before, after, dirtyId, {
        deleted: [removedId],
        rewrites: { previousToCurrent: new Map(), currentToPrevious: new Map() },
      }),
    );

    await assertFreshEquivalent(result, after);
    expect(result.layoutReuse?.mode).not.toBe('full');
    expect(result.layoutReuse?.reason).not.toContain('footnote-finalizer-full-relayout');
    expect(result.bridgeTiming.counters.footnoteOtherRelayouts).toBe(0);
    expect(result.footnoteReserveSeed?.coupled?.referencePlaneIdentity).toBe(after.refs);
    const removedNoteBlockIds = new Set(before.notes.get(removedReference.id)?.map((block) => block.id) ?? []);
    expect(result.extraBlocks?.some((block) => removedNoteBlockIds.has(block.id))).toBe(false);
    expect(result.footnoteReserveSeed?.noteBodyHeightById?.has(removedReference.id)).toBe(false);
    expect(result.footnoteReserveSeed?.noteFirstLineHeightById?.has(removedReference.id)).toBe(false);
    expect(
      [...(result.footnoteReserveSeed?.noteBlocksByBlockId?.keys() ?? [])].some((blockId) =>
        removedNoteBlockIds.has(blockId),
      ),
    ).toBe(false);

    const afterKey = replaceParagraph(after, dirtyId, 'merged!');
    const next = await warmLayout(result, after, afterKey, retainedReuse(result, after, afterKey, dirtyId));
    await assertFreshEquivalent(next, afterKey);
    expect(next.layoutReuse?.mode).not.toBe('full');
  });

  it.each([
    { currentWidth: 20, redistributeHeight: false },
    { currentWidth: 21, redistributeHeight: false },
    { currentWidth: 21, redistributeHeight: true },
  ])('keeps current note measures after reference removal: %j', async ({ currentWidth, redistributeHeight }) => {
    const dirtyId = 'body:dirty/o15';
    const removedId = 'body:tail/o16';
    const base = fixture(1, 60);
    const before: Fixture = {
      ...base,
      blocks: base.blocks.map((block) => (block.id === removedId ? paragraph(removedId, 'x'.repeat(8)) : block)),
    };
    const removedReference = before.refs.find((reference) => reference.blockId === removedId);
    if (!removedReference) throw new Error('expected a note reference in the removed paragraph');
    const source = await incrementalLayout([], null, before.blocks, options(before), measureBlock);
    const survivingIds = before.refs
      .filter((reference) => reference.id !== removedReference.id)
      .map((reference) => reference.id);
    const retainedNoteId = survivingIds[0];
    if (!retainedNoteId || !source.footnoteReserveSeed) throw new Error('expected retained note geometry');

    const currentNotes = new Map<string, ParagraphBlock[]>();
    for (const [noteId, blocks] of before.notes) {
      if (noteId === removedReference.id) continue;
      currentNotes.set(
        noteId,
        noteId === retainedNoteId
          ? blocks
          : blocks.map((block) => ({
              ...block,
              runs: block.runs.map((run) => ('text' in run ? { ...run, text: run.text.replaceAll('n', 'm') } : run)),
            })),
      );
    }
    const after: Fixture = {
      ...before,
      blocks: before.blocks
        .filter((block) => block.id !== removedId)
        .map((block) => (block.id === dirtyId ? paragraph(dirtyId, 'merged') : block)),
      refs: before.refs.filter((reference) => reference.id !== removedReference.id),
      notes: currentNotes,
    };
    const measureCurrentBlock = async (block: FlowBlock): Promise<Measure> => {
      const measure = await measureBlock(block);
      if (measure.kind !== 'paragraph' || block.kind !== 'paragraph' || !block.id.startsWith('footnote:')) {
        return measure;
      }
      const changed = block.runs.some((run) => 'text' in run && run.text.includes('m'));
      return changed
        ? {
            ...measure,
            lines: measure.lines.map((line, index) => ({
              ...line,
              width: currentWidth,
              lineHeight: line.lineHeight + (redistributeHeight ? (index === 1 ? 5 : index === 2 ? -5 : 0) : 0),
            })),
          }
        : measure;
    };
    const sourceSeed = source.footnoteReserveSeed;
    const retainedBlocks = currentNotes.get(retainedNoteId)!;
    const noteBlocksByBlockId = new Map<string, FlowBlock>();
    const noteMeasuresByBlockId = new Map<string, Measure>();
    for (const block of retainedBlocks) {
      const retainedMeasure = sourceSeed.noteMeasuresByBlockId?.get(block.id);
      if (!retainedMeasure) throw new Error(`missing retained measure ${block.id}`);
      noteBlocksByBlockId.set(block.id, block);
      noteMeasuresByBlockId.set(block.id, retainedMeasure);
    }
    const retainedBodyHeight = sourceSeed.noteBodyHeightById?.get(retainedNoteId);
    const retainedFirstLineHeight = sourceSeed.noteFirstLineHeightById?.get(retainedNoteId);
    if (retainedBodyHeight == null || retainedFirstLineHeight == null) {
      throw new Error(`missing retained height ${retainedNoteId}`);
    }
    const rewrites = { previousToCurrent: new Map<string, string>(), currentToPrevious: new Map<string, string>() };
    const reuse: IncrementalLayoutReuseOptions = {
      ...retainedReuse(source, before, after, dirtyId, { deleted: [removedId], rewrites }),
      requireDocumentStartCheckpoint: true,
      dependencyProof: {
        profile: 'document-start-local-text',
        blockIdsUnchanged: true,
        blockIdsUnique: true,
        globalDependenciesAbsent: false,
        globalDependenciesFencedByDocumentStart: true,
        multiColumnSectionsProvedNonBalanceable: true,
        renderInputsUnchanged: true,
        pageReferencesAbsent: true,
      },
    };
    const result = await incrementalLayout(
      before.blocks,
      source.layout,
      after.blocks,
      options(after),
      measureCurrentBlock,
      undefined,
      source.measures,
      undefined,
      {
        footnoteReserveSeed: {
          ...sourceSeed,
          footnoteAssignment: undefined,
          noteBlocksByBlockId,
          noteMeasuresByBlockId,
          noteBodyHeightById: new Map([[retainedNoteId, retainedBodyHeight]]),
          noteFirstLineHeightById: new Map([[retainedNoteId, retainedFirstLineHeight]]),
        },
        noteMeasurePlaneRetainedSubset: true,
      },
      reuse,
    );

    if (redistributeHeight) {
      expect(result.layoutReuse?.mode).toBe('full');
      await assertFreshEquivalent(result, after, measureCurrentBlock);
      return;
    }
    await assertFreshEquivalent(result, after, measureCurrentBlock);
    expect(source.layout.pages.length).toBeGreaterThan(result.layout.pages.length);
    expect(result.layoutReuse?.mode).not.toBe('full');
    expect(result.layoutReuse?.reason).toContain('m4-affected-frontier-converged-tail-adopted');
    expect(result.bridgeTiming.counters.footnoteCoupledPages).toBeLessThan(result.layout.pages.length);
    for (const blocks of after.notes.values()) {
      for (const block of blocks) {
        const currentMeasure = await measureCurrentBlock(block);
        expect(result.footnoteReserveSeed?.noteMeasuresByBlockId?.get(block.id)).toEqual(currentMeasure);
      }
    }

    const afterKey = replaceParagraph(after, dirtyId, 'merged!');
    const next = await warmLayout(
      result,
      after,
      afterKey,
      retainedReuse(result, after, afterKey, dirtyId),
      measureCurrentBlock,
    );
    await assertFreshEquivalent(next, afterKey, measureCurrentBlock);
    expect(next.layoutReuse?.mode).not.toBe('full');
    for (const blocks of after.notes.values()) {
      for (const block of blocks) {
        expect(next.footnoteReserveSeed?.noteMeasuresByBlockId?.get(block.id)).toEqual(
          await measureCurrentBlock(block),
        );
      }
    }
  });

  it('remeasures only changed note geometry before one fresh coupled finalization', async () => {
    const before = fixture();
    const dirtyId = 'body:dirty/o15';
    const removedId = 'body:tail/o16';
    const removedReference = before.refs.find((reference) => reference.blockId === removedId);
    if (!removedReference) throw new Error('expected a note reference in the removed paragraph');
    const source = await incrementalLayout([], null, before.blocks, options(before), measureBlock);
    const crossingNoteId = before.refs.find(
      (reference) => reference.id !== removedReference.id && reference.blockId !== removedId,
    )?.id;
    if (!crossingNoteId || !source.footnoteReserveSeed) {
      throw new Error('expected a surviving note and retained seed');
    }

    const currentNotes = new Map<string, ParagraphBlock[]>();
    for (const [noteId, blocks] of before.notes) {
      if (noteId === removedReference.id) continue;
      currentNotes.set(
        noteId,
        blocks.map((block) => ({
          ...block,
          runs: block.runs.map((run) => {
            if (!('text' in run)) return run;
            return {
              ...run,
              text: noteId === crossingNoteId ? run.text.slice(0, -1) : run.text.replaceAll('n', 'm'),
            };
          }),
        })),
      );
    }
    const after: Fixture = {
      ...before,
      blocks: before.blocks
        .filter((block) => block.id !== removedId)
        .map((block) => (block.id === dirtyId ? paragraph(dirtyId, 'merged') : block)),
      refs: before.refs.filter((reference) => reference.id !== removedReference.id),
      notes: currentNotes,
    };
    const sourceSeed = source.footnoteReserveSeed;
    const noteBlocksByBlockId = new Map<string, FlowBlock>();
    const noteMeasuresByBlockId = new Map<string, Measure>();
    const noteBodyHeightById = new Map<string, number>();
    const noteFirstLineHeightById = new Map<string, number>();
    for (const [noteId, blocks] of currentNotes) {
      if (noteId === crossingNoteId) continue;
      const totalHeight = sourceSeed.noteBodyHeightById?.get(noteId);
      const firstLineHeight = sourceSeed.noteFirstLineHeightById?.get(noteId);
      if (totalHeight == null || firstLineHeight == null) throw new Error(`missing retained height ${noteId}`);
      noteBodyHeightById.set(noteId, totalHeight);
      noteFirstLineHeightById.set(noteId, firstLineHeight);
      for (const block of blocks) {
        const retainedMeasure = sourceSeed.noteMeasuresByBlockId?.get(block.id);
        if (!retainedMeasure) throw new Error(`missing retained measure ${block.id}`);
        noteBlocksByBlockId.set(block.id, block);
        noteMeasuresByBlockId.set(block.id, retainedMeasure);
      }
    }
    const measuredNoteBlockIds: string[] = [];
    const observedMeasure = async (block: FlowBlock): Promise<Measure> => {
      if (block.id.startsWith('footnote:')) measuredNoteBlockIds.push(block.id);
      return measureBlock(block);
    };
    const emptyRewrites = {
      previousToCurrent: new Map<string, string>(),
      currentToPrevious: new Map<string, string>(),
    };
    const result = await incrementalLayout(
      before.blocks,
      source.layout,
      after.blocks,
      options(after),
      observedMeasure,
      undefined,
      source.measures,
      undefined,
      {
        footnoteReserveSeed: {
          ...sourceSeed,
          footnoteAssignment: undefined,
          noteBlocksByBlockId,
          noteMeasuresByBlockId,
          noteBodyHeightById,
          noteFirstLineHeightById,
        },
        noteMeasurePlaneRetainedSubset: true,
      },
      retainedReuse(source, before, after, dirtyId, { deleted: [removedId], rewrites: emptyRewrites }),
    );

    await assertFreshEquivalent(result, after);
    expect(measuredNoteBlockIds).toEqual(currentNotes.get(crossingNoteId)?.map((block) => block.id));
    expect(result.layoutReuse?.mode).toBe('full');
    expect(result.layoutReuse?.tailDisposition).toBe('none');
    expect(result.layoutReuse?.tailAdoption).toBeNull();
    expect(result.layoutReuse?.reason).not.toContain('footnote-finalizer-full-relayout');
    expect(result.bridgeTiming.counters.footnoteRelayouts).toBe(0);
    expect(result.bridgeTiming.counters.footnoteOtherRelayouts).toBe(0);
    expect(result.bridgeTiming.counters.footnoteCoupledRelayouts).toBeGreaterThan(0);
    for (const blocks of currentNotes.values()) {
      for (const block of blocks) {
        expect(result.footnoteReserveSeed?.noteBlocksByBlockId?.get(block.id)).toBe(block);
      }
    }
  });

  it('keeps note-removing delete, Undo, Redo, and the following key on the exact local path', async () => {
    const before = fixture(1, 60);
    const dirtyId = 'body:dirty/o15';
    const removedId = 'body:tail/o16';
    const removedReference = before.refs.find((reference) => reference.blockId === removedId);
    if (!removedReference) throw new Error('expected note reference in the removed paragraph');
    const source = await incrementalLayout([], null, before.blocks, options(before), measureBlock);
    const deletedFixture: Fixture = {
      ...before,
      blocks: before.blocks
        .filter((block) => block.id !== removedId)
        .map((block) => (block.id === dirtyId ? paragraph(dirtyId, 'merged') : block)),
      refs: before.refs.filter((reference) => reference.id !== removedReference.id),
      notes: new Map([...before.notes].filter(([id]) => id !== removedReference.id)),
    };
    const emptyRewrites = {
      previousToCurrent: new Map<string, string>(),
      currentToPrevious: new Map<string, string>(),
    };
    const deleted = await warmLayout(
      source,
      before,
      deletedFixture,
      retainedReuse(source, before, deletedFixture, dirtyId, { deleted: [removedId], rewrites: emptyRewrites }),
    );
    await assertFreshEquivalent(deleted, deletedFixture);
    expect(deleted.layoutReuse?.mode).not.toBe('full');

    const undo = await historyRestorationLayout({
      deleted,
      source,
      before: deletedFixture,
      restored: before,
      reuse: retainedReuse(deleted, deletedFixture, before, dirtyId, {
        deleted: [],
        inserted: [removedId],
        rewrites: emptyRewrites,
      }),
      sourceTxId: 'delete-note-carrier-1',
      restoredNoteIds: [removedReference.id],
    });
    await assertFreshEquivalent(undo, before);
    expect(undo.layoutReuse?.mode).not.toBe('full');
    expect(undo.layoutReuse?.reason).not.toContain('footnote-finalizer-full-relayout');
    expect(undo.bridgeTiming.counters.footnoteOtherRelayouts).toBe(0);
    expect(undo.footnoteReserveSeed?.coupled?.referencePlaneIdentity).toBe(before.refs);

    const redo = await warmLayout(
      undo,
      before,
      deletedFixture,
      retainedReuse(undo, before, deletedFixture, dirtyId, { deleted: [removedId], rewrites: emptyRewrites }),
    );
    await assertFreshEquivalent(redo, deletedFixture);
    expect(redo.layoutReuse?.mode).not.toBe('full');

    const afterKeyFixture = replaceParagraph(deletedFixture, dirtyId, 'merged!');
    const afterKey = await warmLayout(
      redo,
      deletedFixture,
      afterKeyFixture,
      retainedReuse(redo, deletedFixture, afterKeyFixture, dirtyId),
    );
    await assertFreshEquivalent(afterKey, afterKeyFixture);
    expect(afterKey.layoutReuse?.mode).not.toBe('full');
  });

  it('restores the complete note resolve plane after a canonical deletion pass', async () => {
    const before = fixture(1, 60);
    const dirtyId = 'body:dirty/o15';
    const removedId = 'body:tail/o16';
    const removedReference = before.refs.find((reference) => reference.blockId === removedId);
    if (!removedReference) throw new Error('expected note reference in the removed paragraph');
    const source = await incrementalLayout([], null, before.blocks, options(before), measureBlock);
    const deletedFixture: Fixture = {
      ...before,
      blocks: before.blocks
        .filter((block) => block.id !== removedId)
        .map((block) => (block.id === dirtyId ? paragraph(dirtyId, 'merged') : block)),
      refs: before.refs.filter((reference) => reference.id !== removedReference.id),
      notes: new Map([...before.notes].filter(([id]) => id !== removedReference.id)),
    };
    // A canonical pass publishes exactly the current note inventory. Undo must
    // therefore restore both pagination geometry and the missing painter plane
    // from the history-owned source seed; it cannot rely on stale extras from
    // the deletion generation still being present.
    const deleted = await incrementalLayout([], null, deletedFixture.blocks, options(deletedFixture), measureBlock);
    const emptyRewrites = {
      previousToCurrent: new Map<string, string>(),
      currentToPrevious: new Map<string, string>(),
    };
    const undo = await historyRestorationLayout({
      deleted,
      source,
      before: deletedFixture,
      restored: before,
      reuse: retainedReuse(deleted, deletedFixture, before, dirtyId, {
        deleted: [],
        inserted: [removedId],
        rewrites: emptyRewrites,
      }),
      sourceTxId: 'canonical-delete-note-carrier-1',
      restoredNoteIds: [removedReference.id],
    });

    await assertFreshEquivalent(undo, before);
    expect(undo.layoutReuse?.mode).not.toBe('full');
    expect(undo.layoutReuse?.reason).not.toContain('footnote-finalizer-full-relayout');
    expect(undo.bridgeTiming.counters.footnoteOtherRelayouts).toBe(0);
  });

  it.each(['mismatched-history', 'reordered-source', 'distant-owner'] as const)(
    'rejects a forged note restoration proof: %s',
    async (variant) => {
      const before = fixture();
      const dirtyId = 'body:dirty/o15';
      const removedId = 'body:tail/o16';
      const removedReference = before.refs.find((reference) => reference.blockId === removedId)!;
      const source = await incrementalLayout([], null, before.blocks, options(before), measureBlock);
      const deletedFixture: Fixture = {
        ...before,
        blocks: before.blocks
          .filter((block) => block.id !== removedId)
          .map((block) => (block.id === dirtyId ? paragraph(dirtyId, 'merged') : block)),
        refs: before.refs.filter((reference) => reference.id !== removedReference.id),
        notes: new Map([...before.notes].filter(([id]) => id !== removedReference.id)),
      };
      const emptyRewrites = {
        previousToCurrent: new Map<string, string>(),
        currentToPrevious: new Map<string, string>(),
      };
      const deleted = await warmLayout(
        source,
        before,
        deletedFixture,
        retainedReuse(source, before, deletedFixture, dirtyId, { deleted: [removedId], rewrites: emptyRewrites }),
      );
      const restored: Fixture =
        variant === 'reordered-source'
          ? { ...before, refs: [before.refs[1]!, before.refs[0]!, ...before.refs.slice(2)] }
          : variant === 'distant-owner'
            ? {
                ...before,
                refs: before.refs.map((reference) =>
                  reference.id === removedReference.id ? { ...reference, blockId: 'body:tail/o19' } : reference,
                ),
              }
            : before;
      const result = await historyRestorationLayout({
        deleted,
        source,
        before: deletedFixture,
        restored,
        reuse: retainedReuse(deleted, deletedFixture, restored, dirtyId, {
          deleted: [],
          inserted: [removedId],
          rewrites: emptyRewrites,
        }),
        sourceTxId: 'delete-note-carrier-1',
        ...(variant === 'mismatched-history' ? { proofSourceTxId: 'forged-history-id' } : {}),
        restoredNoteIds: [removedReference.id],
      });

      await assertFreshEquivalent(result, restored);
      expect(result.layoutReuse?.mode).toBe('full');
      expect(result.layoutReuse?.reason).toContain('footnote-finalizer-full-relayout');
    },
  );

  it('rejects a disappearing reference outside the proved dirty owner', async () => {
    const before = fixture();
    const dirtyId = 'body:dirty/o15';
    const distant = before.refs.at(-1)!;
    const after: Fixture = {
      ...replaceParagraph(before, dirtyId, 'changed'),
      refs: before.refs.filter((ref) => ref.id !== distant.id),
      notes: new Map([...before.notes].filter(([id]) => id !== distant.id)),
    };
    const previous = await incrementalLayout([], null, before.blocks, options(before), measureBlock);
    const result = await warmLayout(previous, before, after, retainedReuse(previous, before, after, dirtyId));

    await assertFreshEquivalent(result, after);
    expect(result.layoutReuse?.mode).toBe('full');
    expect(result.layoutReuse?.reason).toContain('footnote-finalizer-full-relayout');
  });

  it('rejects reordered retained references instead of trusting array positions', async () => {
    const before = fixture();
    const dirtyId = before.refs[0]!.blockId;
    const after: Fixture = {
      ...replaceParagraph(before, dirtyId, 'changed'),
      refs: [before.refs[1]!, before.refs[0]!, ...before.refs.slice(2)],
    };
    const previous = await incrementalLayout([], null, before.blocks, options(before), measureBlock);
    const result = await warmLayout(previous, before, after, retainedReuse(previous, before, after, dirtyId));

    await assertFreshEquivalent(result, after);
    expect(result.layoutReuse?.mode).toBe('full');
    expect(result.layoutReuse?.reason).toContain('footnote-finalizer-full-relayout');
  });

  it.each([false, true])(
    'preserves all current sources after five note-free paragraphs collapse and the next key (suffix ID churn: %s)',
    async (churn) => {
      const before = fixture();
      const previous = await incrementalLayout([], null, before.blocks, options(before), measureBlock);
      const headIndex = 9;
      const dirtyId = before.blocks[headIndex].id;
      const deleted = before.blocks.slice(headIndex + 1, headIndex + 6).map((block) => block.id);
      const previousToCurrent = new Map<string, string>();
      const currentToPrevious = new Map<string, string>();
      const blocks = [
        ...before.blocks.slice(0, headIndex),
        paragraph(dirtyId, 'q'),
        ...before.blocks.slice(headIndex + 6).map((block, index) => {
          if (!churn) return block;
          const id = `${block.id.slice(0, block.id.lastIndexOf('/o'))}/o${headIndex + index}`;
          previousToCurrent.set(block.id, id);
          currentToPrevious.set(id, block.id);
          return { ...block, id };
        }),
      ];
      const after = {
        ...before,
        blocks,
        refs: before.refs.map((ref) => ({ ...ref, blockId: previousToCurrent.get(ref.blockId) ?? ref.blockId })),
      };
      expect(after.refs.map((ref) => ref.id)).toEqual(before.refs.map((ref) => ref.id));
      expect(after.refs.every((ref, index) => ref.blockId !== before.refs[index].blockId)).toBe(churn);
      const result = await warmLayout(
        previous,
        before,
        after,
        retainedReuse(previous, before, after, dirtyId, {
          deleted,
          rewrites: { previousToCurrent, currentToPrevious },
        }),
      );
      await assertFreshEquivalent(result, after);
      const afterKey = replaceParagraph(after, dirtyId, 'qr');
      const next = await warmLayout(result, after, afterKey, retainedReuse(result, after, afterKey, dirtyId));
      await assertFreshEquivalent(next, afterKey);
    },
  );

  it('adopts only a later exact shifted tail after the early coupled candidates are rejected', async () => {
    const maxRelaidPages = 4;
    const before = fixture(1, 96);
    const previous = await incrementalLayout([], null, before.blocks, options(before), measureBlock);
    const headIndex = 9;
    const dirtyId = before.blocks[headIndex].id;
    const deleted = before.blocks.slice(headIndex + 1, headIndex + 6).map((block) => block.id);
    const previousToCurrent = new Map<string, string>();
    const currentToPrevious = new Map<string, string>();
    const after: Fixture = {
      ...before,
      blocks: [
        ...before.blocks.slice(0, headIndex),
        paragraph(dirtyId, 'q'),
        ...before.blocks.slice(headIndex + 6).map((block, index) => {
          const id = `${block.id.slice(0, block.id.lastIndexOf('/o'))}/o${headIndex + index}`;
          previousToCurrent.set(block.id, id);
          currentToPrevious.set(id, block.id);
          return { ...block, id };
        }),
      ],
      refs: before.refs.map((ref) => ({ ...ref, blockId: previousToCurrent.get(ref.blockId) ?? ref.blockId })),
    };
    const reuse = {
      ...retainedReuse(previous, before, after, dirtyId, {
        deleted,
        rewrites: { previousToCurrent, currentToPrevious },
      }),
      maxRelaidPages,
    };

    const result = await warmLayout(previous, before, after, reuse);
    await assertFreshEquivalent(result, after);
    const afterKey = replaceParagraph(after, dirtyId, 'qr');
    const next = await warmLayout(result, after, afterKey, retainedReuse(result, after, afterKey, dirtyId));
    await assertFreshEquivalent(next, afterKey);

    expect(previous.layout.pages.length).toBeGreaterThan(
      (result.layoutReuse?.sourceAffectedFrontierPageIndex ?? 0) + maxRelaidPages + 2,
    );
    expect(result.layoutReuse?.pagesPaginated).toBeGreaterThan(maxRelaidPages);
    expect(result.layoutReuse?.tailDisposition).toBe('adopted-source-tail');
    expect(result.layoutReuse?.sourceConvergencePageIndex).not.toBeNull();
    expect(result.layoutReuse?.convergencePageIndex).not.toBeNull();
    expect(result.layoutReuse?.tailAdoption?.pageIndexDelta).not.toBe(0);
    expect(result.layoutReuse?.coupledFootnoteTailCertificateRebased).toBe(true);
    expect(result.footnoteReserveSeed?.paginationPolicy).toBe('coupled-v1');
    expect(result.footnoteReserveSeed?.coupled?.referencePlaneIdentity).toBe(after.refs);
  });

  it('does not read distant body content for an ordinary proved local edit', async () => {
    const before = fixture(1, 96);
    const previous = await incrementalLayout([], null, before.blocks, options(before), measureBlock);
    const dirtyId = 'body:tail/o20';
    const after = replaceParagraph(before, dirtyId, 'y');
    const reuse = retainedReuse(previous, before, after, dirtyId);
    let observingWarmWork = true;
    const guarded = new Proxy(after.blocks, {
      get(target, property, receiver) {
        if (observingWarmWork && typeof property === 'string' && /^\d+$/.test(property) && Number(property) > 64) {
          throw new Error(`Ordinary coupled edit read distant body block ${property}`);
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const result = await warmLayout(previous, before, { ...after, blocks: guarded }, reuse);
    observingWarmWork = false;
    await assertFreshEquivalent(result, after);
    expect(result.layoutReuse?.mode).toBe('tail-splice');
    expect(result.layoutReuse?.coupledFootnoteTailCertificateRebased).toBeUndefined();
  });

  it('adopts a source tail on two consecutive body insertions with rewritten suffix coordinates', async () => {
    const before = withBodyPositions(fixture(1, 96));
    const previous = await incrementalLayout([], null, before.blocks, options(before), measureBlock);
    const firstId = 'body:tail/o20';
    const firstEdit = insertBodyCharacter(before, firstId);
    const firstReuse = {
      ...retainedReuse(previous, before, firstEdit.input, firstId),
      pmShift: firstEdit.pmShift,
    };

    const first = await warmLayout(previous, before, firstEdit.input, firstReuse);

    await assertFreshEquivalent(first, firstEdit.input);
    expect(first.layoutReuse?.tailDisposition).toBe('adopted-source-tail');
    expect(first.layoutReuse?.tailAdoption?.positionTransforms).toEqual([firstEdit.pmShift]);
    const secondId = 'body:tail/o50';
    expect(firstPage(first.layout, secondId)).toBeGreaterThanOrEqual(first.layoutReuse!.tailAdoption!.startPageIndex);
    const secondEdit = insertBodyCharacter(firstEdit.input, secondId);
    const secondReuse = {
      ...retainedReuse(first, firstEdit.input, secondEdit.input, secondId),
      pmShift: secondEdit.pmShift,
    };

    const second = await warmLayout(first, firstEdit.input, secondEdit.input, secondReuse);

    await assertFreshEquivalent(second, secondEdit.input);
    expect(second.layoutReuse?.tailDisposition, JSON.stringify(second.layoutReuse)).toBe('adopted-source-tail');
    expect(second.layoutReuse?.tailAdoption?.positionTransforms).toEqual([secondEdit.pmShift]);
  });

  it('keeps refreshed same-height note content and measures after the following body edit', async () => {
    const before = fixture(1, 48);
    const previous = await incrementalLayout([], null, before.blocks, options(before), measureBlock);
    const reference = before.refs[0];
    const oldNote = before.notes.get(reference.id)![0];
    const currentNote: ParagraphBlock = {
      ...oldNote,
      runs: [
        { ...oldNote.runs[0], text: 'NEW' },
        { ...oldNote.runs[0], text: 'NOTE' },
      ],
    };
    const afterNote = { ...before, notes: new Map(before.notes).set(reference.id, [currentNote]) };
    const noteReuse = {
      ...retainedReuse(previous, before, afterNote, reference.blockId),
      provedNoteOnlyRefresh: { noteIds: [reference.id], bodyReferenceBlockIds: [reference.blockId] },
    };

    const refreshed = await incrementalLayout(
      before.blocks,
      previous.layout,
      afterNote.blocks,
      options(afterNote),
      measureBlock,
      undefined,
      previous.measures,
      undefined,
      { footnoteReserveSeed: previous.footnoteReserveSeed, noteMeasurePlaneRetainedExact: true },
      noteReuse,
      noteReuse,
    );

    expect(refreshed.layoutReuse?.reason).toBe('m4-note-only-geometry-stable-tail-adopted');
    expect(refreshed.extraBlocks?.find((block) => block.id === currentNote.id)).toEqual(currentNote);
    await assertFreshEquivalent(refreshed, afterNote);
    const dirtyId = 'body:tail/o20';
    const afterBody = replaceParagraph(afterNote, dirtyId, 'y');

    const result = await warmLayout(
      refreshed,
      afterNote,
      afterBody,
      retainedReuse(refreshed, afterNote, afterBody, dirtyId),
    );

    const noteIndex = result.extraBlocks!.findIndex((block) => block.id === currentNote.id);
    expect(result.extraBlocks![noteIndex]).toEqual(currentNote);
    expect(result.extraMeasures![noteIndex]).toEqual(sourceMeasure(currentNote));
    await assertFreshEquivalent(result, afterBody);
  });
});
