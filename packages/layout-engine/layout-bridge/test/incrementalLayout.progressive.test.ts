import { beforeEach, describe, expect, it } from 'vite-plus/test';
import type { FlowBlock, Layout, ParagraphMeasure } from '@superdoc/contracts';
import { incrementalLayout, measureCache } from '../src/incrementalLayout.js';
import { computeDirtyRegions } from '../src/diff.js';
import { tableBlock, tableMeasure } from './mock-data.js';

const options = { pageSize: { w: 200, h: 120 }, margins: { top: 10, right: 10, bottom: 10, left: 10 } };
const blocks: FlowBlock[] = [
  { kind: 'paragraph', id: 'long', attrs: { widowControl: false }, runs: [{ text: 'x'.repeat(200) }] },
];
const measure = async (): Promise<ParagraphMeasure> => ({
  kind: 'paragraph',
  totalHeight: 2000,
  lines: Array.from({ length: 200 }, (_, index) => ({
    fromRun: 0,
    toRun: 0,
    fromChar: index,
    toChar: index + 1,
    width: 20,
    ascent: 8,
    descent: 2,
    lineHeight: 10,
  })),
});

describe('incrementalLayout progressive execution', () => {
  beforeEach(() => measureCache.clear());

  it('returns an exact sealed page and explicit continuation debt before the long paragraph tail', async () => {
    const full = await incrementalLayout([], null, blocks, options, measure);
    measureCache.clear();
    let result = await incrementalLayout(
      [],
      null,
      blocks,
      options,
      measure,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { progressive: { firstBatchPageCount: 1 } } as Parameters<typeof incrementalLayout>[11],
    );
    expect(full.layout.pages.length).toBeGreaterThan(10);
    expect(result.layout.pages).toHaveLength(1);
    expect(result.progressive?.status).toBe('pending');
    expect(result.layout.pages[0]).toEqual(full.layout.pages[0]);
    expect(result.progressive?.resume.nextBlockIndex).toBe(0);
    const continuation = result.progressive!.continuation;
    while (result.progressive) result = await continuation.advance();
    expect(result.layout).toEqual(full.layout);
    expect(result.measures).toEqual(full.measures);
  });

  it('batches the host empty footnote input without claiming note conservation work', async () => {
    const result = await incrementalLayout(
      [],
      null,
      blocks,
      {
        ...options,
        footnotes: { refs: [], blocksById: new Map() },
      },
      measure,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { progressive: { firstBatchPageCount: 1 } },
    );
    expect(result.layout.pages).toHaveLength(1);
    expect(result.progressive?.status).toBe('pending');
    result.progressive!.continuation.dispose();
  });

  it('does not enumerate a warm suffix to filter an empty host footnote reference list', async () => {
    const run = async (withEmptyFootnotes: boolean) => {
      measureCache.clear();
      const before: FlowBlock[] = Array.from({ length: 60 }, (_, index) => ({
        kind: 'paragraph',
        id: `p-${index}`,
        runs: [{ text: `text-${index}` }],
      }));
      const layoutOptions = {
        ...options,
        ...(withEmptyFootnotes ? { footnotes: { refs: [], blocksById: new Map() } } : {}),
      };
      const measureShort = async (): Promise<ParagraphMeasure> => ({
        kind: 'paragraph',
        totalHeight: 30,
        lines: [{ fromRun: 0, toRun: 0, fromChar: 0, toChar: 1, width: 20, ascent: 24, descent: 6, lineHeight: 30 }],
      });
      const previous = await incrementalLayout([], null, before, layoutOptions, measureShort);
      previous.layout.layoutEpoch = 1;
      const current = before.map((block, index) => (index === 30 ? { ...block, runs: [{ text: 'changed' }] } : block));
      let suffixReads = 0;
      const after = current.map(
        (block, index) =>
          new Proxy(block, {
            get(target, key, receiver) {
              if (key === 'id' && index >= 30) suffixReads++;
              return Reflect.get(target, key, receiver);
            },
          }),
      );
      const ranges = new Map<string, { firstPage: number; lastPage: number }>();
      const key = (page: Layout['pages'][number]) => {
        const first = page.fragments[0]!;
        return `${first.blockId}#${'fromLine' in first ? first.fromLine : 0}#${page.sectionIndex ?? 0}#0`;
      };
      previous.layout.pages.forEach((page, pageIndex) =>
        page.fragments.forEach((fragment) => {
          const range = ranges.get(fragment.blockId);
          if (range) range.lastPage = pageIndex;
          else ranges.set(fragment.blockId, { firstPage: pageIndex, lastPage: pageIndex });
        }),
      );
      const dirty = computeDirtyRegions(before, current);
      let result = await incrementalLayout(
        before,
        previous.layout,
        after,
        layoutOptions,
        measureShort,
        undefined,
        previous.measures,
        undefined,
        undefined,
        {
          previousLayout: previous.layout,
          retainedMetadataSourceLayoutEpoch: 1,
          previousPageStartKeys: previous.layout.pages.map(key),
          previousPageStartKeyIndex: new Map(previous.layout.pages.map((page, index) => [key(page), [index]])),
          previousBlockPageIndex: ranges,
          currentBlockIndexById: new Map(current.map((block, index) => [block.id, index])),
          dirtyBlockIds: dirty.changedBlockIds,
          provedDirtyRegion: dirty,
          dependencyProof: {
            profile: 'single-section-local-text',
            blockIdsUnchanged: true,
            blockIdsUnique: true,
            globalDependenciesAbsent: true,
            renderInputsUnchanged: true,
            pageReferencesAbsent: true,
          },
        },
        undefined,
        { progressive: { firstBatchPageCount: 1 } },
      );
      expect(result.progressive?.completedPageRange).toEqual({ startPageIndex: 10, endPageIndexExclusive: 11 });
      const firstBatchReads = suffixReads;
      const continuation = result.progressive!.continuation;
      while (result.progressive) result = await continuation.advance();
      const cold = await incrementalLayout([], null, current, layoutOptions, measureShort);
      expect(Array.from(result.layout.pages)).toEqual(Array.from(cold.layout.pages));
      expect(Array.from(result.measures)).toEqual(Array.from(cold.measures));
      return firstBatchReads;
    };
    const withoutFootnotes = await run(false);
    const emptyFootnotes = await run(true);
    expect(emptyFootnotes).toBe(withoutFootnotes);
  });

  it('keeps body page fields inside table cells on the complete dependency path', async () => {
    if (tableBlock.kind !== 'table') throw new Error('Expected table fixture');
    const fieldTable: FlowBlock = {
      ...tableBlock,
      rows: tableBlock.rows.map((row) => ({
        ...row,
        cells: row.cells.map((cell) => ({
          ...cell,
          blocks: [
            { kind: 'paragraph', id: 'cell-page-field', runs: [{ kind: 'text', text: '1', token: 'pageNumber' }] },
          ],
        })),
      })),
    };
    const input = [...blocks, fieldTable];
    const measureInput = async (block: FlowBlock) => (block.kind === 'table' ? tableMeasure : measure());
    const cold = await incrementalLayout([], null, input, options, measureInput);
    measureCache.clear();
    const result = await incrementalLayout(
      [],
      null,
      input,
      options,
      measureInput,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { progressive: { firstBatchPageCount: 1 } },
    );
    expect(result.progressive).toBeUndefined();
    expect(result.progressiveFallbackReason).toBe('body-page-fields');
    expect(result.layout).toEqual(cold.layout);
  });

  it('keeps the proved prefix by identity and exposes only the first changed page before continuing a deep edit', async () => {
    const before: FlowBlock[] = Array.from({ length: 60 }, (_, index) => ({
      kind: 'paragraph',
      id: `p-${index}`,
      runs: [{ text: `text-${index}` }],
    }));
    const measureShort = async (): Promise<ParagraphMeasure> => ({
      kind: 'paragraph',
      totalHeight: 30,
      lines: [{ fromRun: 0, toRun: 0, fromChar: 0, toChar: 1, width: 20, ascent: 24, descent: 6, lineHeight: 30 }],
    });
    const previous = await incrementalLayout([], null, before, options, measureShort);
    previous.layout.layoutEpoch = 1;
    const after = before.map((block, index) => (index === 30 ? { ...block, runs: [{ text: 'changed' }] } : block));
    const ranges = new Map<string, { firstPage: number; lastPage: number }>();
    const key = (page: Layout['pages'][number]) => {
      const first = page.fragments[0];
      if (!first) return `#empty#0#${page.sectionIndex ?? 0}#0`;
      return `${first.blockId}#${'fromLine' in first ? first.fromLine : 0}#${page.sectionIndex ?? 0}#${'continuesFromPrev' in first && first.continuesFromPrev ? 1 : 0}`;
    };
    previous.layout.pages.forEach((page, index) =>
      page.fragments.forEach((fragment) => {
        const range = ranges.get(fragment.blockId);
        if (range) range.lastPage = index;
        else ranges.set(fragment.blockId, { firstPage: index, lastPage: index });
      }),
    );
    const dirty = computeDirtyRegions(before, after);
    const changedPage = ranges.get('p-30')!.firstPage;
    let result = await incrementalLayout(
      before,
      previous.layout,
      after,
      options,
      measureShort,
      undefined,
      previous.measures,
      undefined,
      undefined,
      {
        previousLayout: previous.layout,
        retainedMetadataSourceLayoutEpoch: 1,
        previousPageStartKeys: previous.layout.pages.map(key),
        previousPageStartKeyIndex: new Map(previous.layout.pages.map((page, index) => [key(page), [index]])),
        previousBlockPageIndex: ranges,
        currentBlockIndexById: new Map(after.map((block, index) => [block.id, index])),
        dirtyBlockIds: dirty.changedBlockIds,
        provedDirtyRegion: dirty,
        dependencyProof: {
          profile: 'single-section-local-text',
          blockIdsUnchanged: true,
          blockIdsUnique: true,
          globalDependenciesAbsent: true,
          renderInputsUnchanged: true,
          pageReferencesAbsent: true,
        },
      },
      undefined,
      { progressive: { firstBatchPageCount: 1 } } as Parameters<typeof incrementalLayout>[11],
    );
    expect(result.layout.pages).toHaveLength(changedPage + 1);
    expect(result.progressive?.completedPageRange).toEqual({
      startPageIndex: changedPage,
      endPageIndexExclusive: changedPage + 1,
    });
    expect(result.layoutReuse).toEqual({
      mode: 'prefix-resume',
      reason: 'progressive-sealed-prefix',
      tailDisposition: 'none',
      checkpointPageIndex: changedPage,
      affectedFrontierPageIndex: null,
      sourceAffectedFrontierPageIndex: null,
      convergencePageIndex: null,
      sourceConvergencePageIndex: null,
      pagesPaginated: 1,
      pagesSplicedByReuse: changedPage,
      tailAdoption: null,
    });
    for (let index = 0; index < changedPage; index += 1)
      expect(result.layout.pages[index]).toBe(previous.layout.pages[index]);
    const continuation = result.progressive!.continuation;
    while (result.progressive) result = await continuation.advance();
    measureCache.clear();
    const cold = await incrementalLayout([], null, after, options, measureShort);
    expect(Array.from(result.layout.pages)).toEqual(Array.from(cold.layout.pages));
    expect(result.layoutReuse?.tailDisposition).toBe('adopted-source-tail');
  });

  it.each([
    { editedIndex: 0, restamp: false, foreignSource: false },
    { editedIndex: 6, restamp: false, foreignSource: false },
    { editedIndex: 0, restamp: true, foreignSource: false },
    { editedIndex: 6, restamp: true, foreignSource: false },
    { editedIndex: 0, restamp: true, foreignSource: true },
  ])(
    'consumes the unpaginated source tail for $editedIndex (restamp=$restamp, foreignSource=$foreignSource)',
    async ({ editedIndex, restamp, foreignSource }) => {
      const before: FlowBlock[] = Array.from({ length: 120 }, (_, index) => ({
        kind: 'paragraph',
        id: `p-${index}`,
        runs: [{ text: `text-${index}` }],
      }));
      const measureShort = async (): Promise<ParagraphMeasure> => ({
        kind: 'paragraph',
        totalHeight: 30,
        lines: [{ fromRun: 0, toRun: 0, fromChar: 0, toChar: 1, width: 20, ascent: 24, descent: 6, lineHeight: 30 }],
      });
      const previous = await incrementalLayout(
        [],
        null,
        before,
        options,
        measureShort,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { progressive: { firstBatchPageCount: 4 } },
      );
      expect(previous.progressive).toBeDefined();
      previous.progressive!.continuation.dispose();
      previous.layout.layoutEpoch = 1;
      const retainedLayout = restamp ? { ...previous.layout, pageGap: 24 } : previous.layout;
      const after = before.map((block, index) =>
        index === editedIndex ? { ...block, runs: [{ text: 'changed' }] } : block,
      );
      const ranges = new Map<string, { firstPage: number; lastPage: number }>();
      const key = (page: Layout['pages'][number]) => `${page.fragments[0]!.blockId}#0#0#0`;
      previous.layout.pages.forEach((page, index) =>
        page.fragments.forEach((fragment) => {
          const range = ranges.get(fragment.blockId);
          if (range) range.lastPage = index;
          else ranges.set(fragment.blockId, { firstPage: index, lastPage: index });
        }),
      );
      const dirty = computeDirtyRegions(before, after);
      let result = await incrementalLayout(
        foreignSource ? [...before] : before,
        retainedLayout,
        after,
        options,
        measureShort,
        undefined,
        previous.measures,
        undefined,
        undefined,
        {
          previousLayout: retainedLayout,
          retainedMetadataSourceLayoutEpoch: 1,
          previousPageStartKeys: previous.layout.pages.map(key),
          previousPageStartKeyIndex: new Map(previous.layout.pages.map((page, index) => [key(page), [index]])),
          previousBlockPageIndex: ranges,
          currentBlockIndexById: new Map(after.map((block, index) => [block.id, index])),
          dirtyBlockIds: dirty.changedBlockIds,
          provedDirtyRegion: dirty,
          dependencyProof: {
            profile: 'single-section-local-text',
            blockIdsUnchanged: true,
            blockIdsUnique: true,
            globalDependenciesAbsent: true,
            renderInputsUnchanged: true,
            pageReferencesAbsent: true,
          },
        },
        undefined,
        { progressive: { firstBatchPageCount: 3 } },
      );
      const continuation = result.progressive!.continuation;
      let publishedPageCount = result.layout.pages.length;
      while (result.progressive) {
        result = await continuation.advance();
        expect(
          result.layout.pages.length,
          'terminal publication preserves the freshly paginated source tail',
        ).toBeGreaterThanOrEqual(publishedPageCount);
        publishedPageCount = result.layout.pages.length;
      }
      const cold = await incrementalLayout([], null, after, options, measureShort);
      expect(Array.from(result.layout.pages)).toEqual(Array.from(cold.layout.pages));
      if (foreignSource) {
        expect(result.layoutReuse?.mode).toBe('full');
        expect(result.layoutReuse?.reason).toContain('pending-layout-source-owner-mismatch');
      } else expect(result.layoutReuse?.tailDisposition).toBe('relaid-to-document-end');

      if (restamp && !foreignSource) {
        // A fresh terminal plane has no pending debt: the next edit can adopt its exact tail.
        const completed = result;
        const completedLayout = { ...completed.layout, layoutEpoch: 2 };
        const next = after.map((block, index) =>
          index === editedIndex ? { ...block, runs: [{ text: 'next edit after terminal completion' }] } : block,
        );
        const nextRanges = new Map<string, { firstPage: number; lastPage: number }>();
        completedLayout.pages.forEach((page, index) =>
          page.fragments.forEach((fragment) => {
            const range = nextRanges.get(fragment.blockId);
            if (range) range.lastPage = index;
            else nextRanges.set(fragment.blockId, { firstPage: index, lastPage: index });
          }),
        );
        const nextDirty = computeDirtyRegions(completed.blocks, next);
        let nextResult = await incrementalLayout(
          completed.blocks,
          completedLayout,
          next,
          options,
          measureShort,
          undefined,
          completed.measures,
          undefined,
          undefined,
          {
            previousLayout: completedLayout,
            retainedMetadataSourceLayoutEpoch: 2,
            previousPageStartKeys: completedLayout.pages.map(key),
            previousPageStartKeyIndex: new Map(completedLayout.pages.map((page, index) => [key(page), [index]])),
            previousBlockPageIndex: nextRanges,
            currentBlockIndexById: new Map(next.map((block, index) => [block.id, index])),
            dirtyBlockIds: nextDirty.changedBlockIds,
            provedDirtyRegion: nextDirty,
            dependencyProof: {
              profile: 'single-section-local-text',
              blockIdsUnchanged: true,
              blockIdsUnique: true,
              globalDependenciesAbsent: true,
              renderInputsUnchanged: true,
              pageReferencesAbsent: true,
            },
          },
          undefined,
          { progressive: { firstBatchPageCount: 1 } },
        );
        const nextContinuation = nextResult.progressive!.continuation;
        while (nextResult.progressive) nextResult = await nextContinuation.advance();
        expect(nextResult.layoutReuse?.tailDisposition).toBe('adopted-source-tail');
        const nextCold = await incrementalLayout([], null, next, options, measureShort);
        expect(Array.from(nextResult.layout.pages)).toEqual(Array.from(nextCold.layout.pages));
      }
    },
  );

  it('resumes the same cursor after an advance request is aborted between paragraph fragments', async () => {
    const checkpoints: { phase: string; index?: number }[] = [];
    let result = await incrementalLayout(
      [],
      null,
      blocks,
      options,
      measure,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        progressive: { firstBatchPageCount: 1 },
        yieldToHost: async (checkpoint) => {
          if (checkpoint) checkpoints.push(checkpoint);
        },
      },
    );
    const continuation = result.progressive!.continuation;
    const identity = result.progressive!.resume.checkpointIdentity;
    const controller = new AbortController();
    const revoked = new Error('viewport advance superseded');
    await expect(
      continuation.advance({
        signal: controller.signal,
        yieldToHost: async (checkpoint) => {
          if (checkpoint?.phase === 'layout-document:paragraph-fragment') controller.abort(revoked);
        },
      }),
    ).rejects.toBe(revoked);
    result = await continuation.advance({ signal: new AbortController().signal });
    expect(result.progressive?.resume.checkpointIdentity).toBe(identity);
    while (result.progressive) result = await continuation.advance();
    measureCache.clear();
    const cold = await incrementalLayout([], null, blocks, options, measure);
    expect(result.layout).toEqual(cold.layout);
    expect(
      checkpoints.filter((checkpoint) => checkpoint.phase === 'layout-document:prepare' && checkpoint.index === 0),
    ).toHaveLength(1);
  });

  it('restarts an overlapping later edit from the current sealed prefix rather than skipping unfinished source', async () => {
    const before: FlowBlock[] = Array.from({ length: 60 }, (_, index) => ({
      kind: 'paragraph',
      id: `p-${index}`,
      runs: [{ text: `text-${index}` }],
    }));
    const measureShort = async (block: FlowBlock): Promise<ParagraphMeasure> => {
      const count = block.kind === 'paragraph' && block.runs[0]?.text === 'first edit' ? 2 : 1;
      return {
        kind: 'paragraph',
        totalHeight: 30 * count,
        lines: Array.from({ length: count }, (_, index) => ({
          fromRun: 0,
          toRun: 0,
          fromChar: index,
          toChar: index + 1,
          width: 20,
          ascent: 24,
          descent: 6,
          lineHeight: 30,
        })),
      };
    };
    const reuse = (previous: Awaited<ReturnType<typeof incrementalLayout>>, current: FlowBlock[]) => {
      const ranges = new Map<string, { firstPage: number; lastPage: number }>();
      const keys = previous.layout.pages.map((page) => {
        const first = page.fragments[0]!;
        return `${first.blockId}#${'fromLine' in first ? first.fromLine : 0}#${page.sectionIndex ?? 0}#${'continuesFromPrev' in first && first.continuesFromPrev ? 1 : 0}`;
      });
      previous.layout.pages.forEach((page, index) =>
        page.fragments.forEach((fragment) => {
          const range = ranges.get(fragment.blockId);
          if (range) range.lastPage = index;
          else ranges.set(fragment.blockId, { firstPage: index, lastPage: index });
        }),
      );
      const dirty = computeDirtyRegions(previous.blocks, current);
      return {
        previousLayout: previous.layout,
        retainedMetadataSourceLayoutEpoch: previous.layout.layoutEpoch,
        previousPageStartKeys: keys,
        previousPageStartKeyIndex: new Map(keys.map((key, index) => [key, [index]])),
        previousBlockPageIndex: ranges,
        currentBlockIndexById: new Map(current.map((block, index) => [block.id, index])),
        dirtyBlockIds: dirty.changedBlockIds,
        provedDirtyRegion: dirty,
        dependencyProof: {
          profile: 'single-section-local-text' as const,
          blockIdsUnchanged: true as const,
          blockIdsUnique: true as const,
          globalDependenciesAbsent: true as const,
          renderInputsUnchanged: true as const,
          pageReferencesAbsent: true as const,
        },
      };
    };
    const full = await incrementalLayout([], null, before, options, measureShort);
    full.layout.layoutEpoch = 1;
    const afterFirst = before.map((block, index) =>
      index === 30 ? { ...block, runs: [{ text: 'first edit' }] } : block,
    );
    const pending = await incrementalLayout(
      full.blocks,
      full.layout,
      afterFirst,
      options,
      measureShort,
      undefined,
      full.measures,
      undefined,
      undefined,
      reuse(full, afterFirst),
      undefined,
      { progressive: { firstBatchPageCount: 1 } },
    );
    expect(pending.layout.pages).toHaveLength(11);
    expect(pending.layout.blockResumeCheckpoints?.has('p-30')).toBe(true);
    pending.progressive!.continuation.dispose();
    pending.layout.layoutEpoch = 2;
    const afterSecond = afterFirst.map((block, index) =>
      index === 50 ? { ...block, runs: [{ text: 'later edit' }] } : block,
    );
    let result = await incrementalLayout(
      pending.blocks,
      pending.layout,
      afterSecond,
      options,
      measureShort,
      undefined,
      pending.measures,
      undefined,
      undefined,
      reuse(pending, afterSecond),
      undefined,
      { progressive: { firstBatchPageCount: 1 } },
    );
    expect(result.progressive?.completedPageRange.startPageIndex).toBe(10);
    for (let index = 0; index < 10; index += 1) expect(result.layout.pages[index]).toBe(pending.layout.pages[index]);
    const continuation = result.progressive!.continuation;
    while (result.progressive) result = await continuation.advance();
    measureCache.clear();
    const cold = await incrementalLayout([], null, afterSecond, options, measureShort);
    expect(Array.from(result.layout.pages)).toEqual(cold.layout.pages);
  });

  it('publishes furniture PAGE tokens for the actual sealed batch and refreshes terminal totals', async () => {
    const footer: FlowBlock = {
      kind: 'paragraph',
      id: 'footer',
      runs: [
        { kind: 'text', text: '1', token: 'pageNumber' },
        { kind: 'text', text: '/' },
        { kind: 'text', text: '99', token: 'totalPageCount' },
      ],
    };
    const furniture = {
      footerBlocks: { default: [footer] },
      constraints: { width: 180, height: 15 },
      measure: async (): Promise<ParagraphMeasure> => ({
        kind: 'paragraph',
        totalHeight: 10,
        lines: [{ fromRun: 0, toRun: 2, fromChar: 0, toChar: 2, width: 30, ascent: 8, descent: 2, lineHeight: 10 }],
      }),
    };
    const full = await incrementalLayout([], null, blocks, options, measure, furniture);
    measureCache.clear();
    let result = await incrementalLayout(
      [],
      null,
      blocks,
      options,
      measure,
      furniture,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { progressive: { firstBatchPageCount: 1 } },
    );
    expect(result.progressive?.pageCountFieldsExact).toBe(false);
    const continuation = result.progressive!.continuation;
    result = await continuation.advance();
    const page = result.footers?.[0]?.layout.pages.find((page) => page.number === 2);
    expect(page?.blocks[0]).toMatchObject({ runs: [{ text: '2' }, { text: '/' }, { text: '99' }] });
    while (result.progressive) result = await continuation.advance();
    expect(result.layout).toEqual(full.layout);
    expect(result.footers).toEqual(full.footers);
  });
});
