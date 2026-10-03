import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { FlowBlock, Layout, Line, Measure, ParagraphBlock, ParagraphMeasure } from '@superdoc/contracts';
import { incrementalLayout, measureCache } from '../src/incrementalLayout.js';
import { computeDirtyRegions } from '../src/diff.js';
import { selectionToRects } from '../src/index.js';

const options = {
  pageSize: { w: 200, h: 100 },
  margins: { top: 10, right: 10, bottom: 10, left: 10 },
  columns: { count: 1, gap: 0 },
};

function paragraph(id: string, text: string, pmStart: number, token?: 'pageReference'): ParagraphBlock {
  return {
    kind: 'paragraph',
    id,
    runs: [
      {
        text,
        fontFamily: 'Arial',
        fontSize: 12,
        pmStart,
        pmEnd: pmStart + text.length,
        ...(token
          ? {
              token,
              pageRefMetadata: { bookmarkId: 'target', instruction: 'PAGEREF target' },
            }
          : {}),
      },
    ],
  };
}

function documentBlocks(count = 10): ParagraphBlock[] {
  return Array.from({ length: count }, (_, index) => paragraph(`p${index}`, `text-${index}`, 1 + index * 20));
}

function replaceParagraphText(blocks: ParagraphBlock[], changedIndex: number, text: string): ParagraphBlock[] {
  const previousText = blocks[changedIndex]!.runs[0]!.text;
  const delta = text.length - previousText.length;
  return blocks.map((block, index) =>
    paragraph(
      block.id,
      index === changedIndex ? text : block.runs[0]!.text,
      block.runs[0]!.pmStart! + (index > changedIndex ? delta : 0),
    ),
  );
}

function measureFor(block: FlowBlock): ParagraphMeasure {
  if (block.kind !== 'paragraph') throw new Error(`Unexpected block kind ${block.kind}`);
  const textLength = block.runs.reduce((length, run) => length + ('text' in run ? run.text.length : 0), 0);
  const line: Line = {
    fromRun: 0,
    fromChar: 0,
    toRun: 0,
    toChar: textLength,
    width: 100,
    ascent: 24,
    descent: 6,
    lineHeight: 30,
  };
  return { kind: 'paragraph', lines: [line], totalHeight: 30 };
}

function measureWithLines(block: FlowBlock, lineCount: number): ParagraphMeasure {
  if (block.kind !== 'paragraph') throw new Error(`Unexpected block kind ${block.kind}`);
  const textLength = block.runs.reduce((length, run) => length + ('text' in run ? run.text.length : 0), 0);
  const lines: Line[] = Array.from({ length: lineCount }, (_, lineIndex) => {
    const fromChar = Math.floor((textLength * lineIndex) / lineCount);
    const toChar = Math.floor((textLength * (lineIndex + 1)) / lineCount);
    return {
      fromRun: 0,
      fromChar,
      toRun: 0,
      toChar,
      width: 100,
      ascent: 24,
      descent: 6,
      lineHeight: 30,
    };
  });
  return { kind: 'paragraph', lines, totalHeight: lines.length * 30 };
}

function sourceBackedEditView(base: readonly ParagraphBlock[], editCount: number): ParagraphBlock[] {
  const target = new Array<ParagraphBlock>(base.length);
  return new Proxy(target, {
    has(_array, property) {
      if (typeof property === 'string' && /^(?:0|[1-9]\d*)$/.test(property)) {
        const index = Number(property);
        return index >= 0 && index < base.length;
      }
      return Reflect.has(target, property);
    },
    get(array, property, receiver) {
      if (typeof property === 'string' && /^(?:0|[1-9]\d*)$/.test(property)) {
        const index = Number(property);
        const block = base[index];
        if (!block) return undefined;
        return paragraph(
          block.id,
          index === 0 ? `${block.runs[0]!.text}${'x'.repeat(editCount)}` : block.runs[0]!.text,
          block.runs[0]!.pmStart! + (index > 0 ? editCount : 0),
        );
      }
      return Reflect.get(array, property, receiver);
    },
  });
}

function blockPageIndex(layout: Layout): Map<string, { firstPage: number; lastPage: number }> {
  const result = new Map<string, { firstPage: number; lastPage: number }>();
  layout.pages.forEach((page, pageIndex) => {
    for (const fragment of page.fragments) {
      const existing = result.get(fragment.blockId);
      if (existing) existing.lastPage = pageIndex;
      else result.set(fragment.blockId, { firstPage: pageIndex, lastPage: pageIndex });
    }
  });
  return result;
}

function pageStartKey(page: Layout['pages'][number]): string {
  const first = page.fragments[0];
  const sectionIndex = page.sectionIndex ?? 0;
  if (!first) return `#empty#0#${sectionIndex}#0`;
  const fromLine = 'fromLine' in first ? first.fromLine : 'fromRow' in first ? first.fromRow : 0;
  const carry = 'continuesFromPrev' in first && first.continuesFromPrev === true ? 1 : 0;
  return `${first.blockId}#${fromLine ?? 0}#${sectionIndex}#${carry}`;
}

function pageStartKeyIndex(layout: Layout): Map<string, readonly number[]> {
  const mutable = new Map<string, number[]>();
  layout.pages.forEach((page, pageIndex) => {
    const key = pageStartKey(page);
    const indexes = mutable.get(key);
    if (indexes) indexes.push(pageIndex);
    else mutable.set(key, [pageIndex]);
  });
  return mutable;
}

function retainedMetadata(
  layout: Layout,
  epoch = 1,
): {
  previousLayout: Layout;
  retainedMetadataSourceLayoutEpoch: number;
} {
  layout.layoutEpoch = epoch;
  return { previousLayout: layout, retainedMetadataSourceLayoutEpoch: epoch };
}

function provedReuse(previousBlocks: FlowBlock[], nextBlocks: FlowBlock[], layout: Layout) {
  const provedDirtyRegion = computeDirtyRegions(previousBlocks, nextBlocks);
  return {
    ...retainedMetadata(layout),
    previousPageStartKeys: layout.pages.map(pageStartKey),
    previousBlockPageIndex: blockPageIndex(layout),
    previousPageStartKeyIndex: pageStartKeyIndex(layout),
    currentBlockIndexById: new Map(nextBlocks.map((block, index) => [block.id, index])),
    dirtyBlockIds: provedDirtyRegion.changedBlockIds,
    dependencyProof: {
      profile: 'single-section-local-text' as const,
      blockIdsUnchanged: true as const,
      blockIdsUnique: true as const,
      globalDependenciesAbsent: true as const,
      renderInputsUnchanged: true as const,
      pageReferencesAbsent: true as const,
    },
    provedDirtyRegion,
  };
}

function geometry(layout: Layout): unknown {
  return layout.pages.map((page) => ({
    number: page.number,
    size: page.size,
    margins: page.margins,
    fragments: page.fragments.map((fragment) => ({
      kind: fragment.kind,
      blockId: fragment.blockId,
      x: fragment.x,
      y: fragment.y,
      width: fragment.width,
      fromLine: 'fromLine' in fragment ? fragment.fromLine : undefined,
      toLine: 'toLine' in fragment ? fragment.toLine : undefined,
    })),
  }));
}

describe('contiguous paragraph-range layout reuse', () => {
  beforeEach(() => measureCache.clear());

  it.each([2, 5].flatMap((removedCount) => [false, true].map((churn) => ({ removedCount, churn }))))(
    'reuses layout and measurements after $removedCount paragraphs collapse (id churn: $churn)',
    async ({ removedCount, churn }) => {
      const before = documentBlocks(60);
      const head = 8;
      // Each single line fills most of a page: both range sizes have an exact
      // shifted tail boundary, independent of half-page line wrapping.
      const measureRangeBlock = async (block: FlowBlock): Promise<ParagraphMeasure> => {
        const measured = measureFor(block);
        return { ...measured, totalHeight: 60, lines: measured.lines.map((line) => ({ ...line, lineHeight: 60 })) };
      };
      const previous = await incrementalLayout([], null, before, options, measureRangeBlock);
      const previousToCurrent = new Map<string, string>();
      const currentToPrevious = new Map<string, string>();
      const after = [
        ...before.slice(0, head),
        paragraph(`p${head}`, 'merged', 1 + head * 20),
        ...before.slice(head + removedCount + 1).map((block) => {
          const currentId = churn ? `${block.id}-shifted` : block.id;
          if (currentId !== block.id) {
            previousToCurrent.set(block.id, currentId);
            currentToPrevious.set(currentId, block.id);
          }
          return paragraph(currentId, block.runs[0]!.text, block.runs[0]!.pmStart! - removedCount * 20);
        }),
      ];
      const reuse = {
        ...provedReuse(before, after, previous.layout),
        allowBlockIdChurn: true,
        previousBlockIndexById: new Map(before.map((block, index) => [block.id, index])),
        blockIdRewrites: { previousToCurrent, currentToPrevious },
        dirtyBlockIds: [before[head]!.id],
        provedDirtyRegion: {
          firstDirtyIndex: head,
          lastStableIndex: head - 1,
          insertedBlockIds: [],
          deletedBlockIds: before.slice(head + 1, head + removedCount + 1).map((block) => block.id),
          changedBlockIds: [before[head]!.id],
          stableBlockIds: new Set(after.filter((_, index) => index !== head).map((block) => block.id)),
        },
        pmShift: { atChar: before[head + removedCount + 1]!.runs[0]!.pmStart!, delta: -removedCount * 20 },
      };

      const result = await incrementalLayout(
        before,
        previous.layout,
        after,
        options,
        measureRangeBlock,
        undefined,
        previous.measures,
        undefined,
        undefined,
        reuse,
      );
      const cold = await incrementalLayout([], null, after, options, measureRangeBlock);

      expect(result.layoutReuse.mode, JSON.stringify(result.layoutReuse)).toBe('tail-splice');
      expect(result.layoutReuse.pagesPaginated).toBeLessThan(previous.layout.pages.length);
      expect(geometry(result.layout)).toEqual(geometry(cold.layout));
      expect(result.measureReuse).toMatchObject({ mode: 'proved-dirty-only', blocksMeasured: 1 });
      expect(result.bridgeTiming.counters.bodyMeasureCacheKeyComputations).toBe(1);
      expect(result.bridgeTiming.counters.measureContentSignatureComputations).toBe(0);
      result.measures.forEach((measurement, index) => {
        if (index !== head) expect(measurement).toBe(previous.measures[index < head ? index : index + removedCount]);
      });

      // Undo restores the exact ordered range, not just the first paragraph.
      // Keep both the untouched measure plane and cold-layout geometry exact.
      const restoredIds = before.slice(head + 1, head + removedCount + 1).map((block) => block.id);
      const restoredDirty = [before[head]!.id, ...restoredIds];
      const restoreReuse = {
        ...provedReuse(after, before, result.layout),
        allowBlockIdChurn: true,
        // This miniature puts each restored paragraph on its own page. Give
        // the bounded probe room to pass the genuinely changed range.
        maxRelaidPages: removedCount + 2,
        previousBlockIndexById: new Map(after.map((block, index) => [block.id, index])),
        blockIdRewrites: { previousToCurrent: currentToPrevious, currentToPrevious: previousToCurrent },
        dirtyBlockIds: restoredDirty,
        provedDirtyRegion: {
          firstDirtyIndex: head,
          lastStableIndex: head - 1,
          insertedBlockIds: restoredIds,
          deletedBlockIds: [],
          changedBlockIds: restoredDirty,
          stableBlockIds: new Set(
            before.filter((_, index) => index < head || index > head + removedCount).map((block) => block.id),
          ),
        },
        pmShift: { atChar: after[head + 1]!.runs[0]!.pmStart!, delta: removedCount * 20 },
      };
      const restored = await incrementalLayout(
        after,
        result.layout,
        before,
        options,
        measureRangeBlock,
        undefined,
        result.measures,
        undefined,
        undefined,
        restoreReuse,
      );
      expect(restored.layoutReuse.mode, JSON.stringify(restored.layoutReuse)).toBe('tail-splice');
      expect(restored.layoutReuse.pagesPaginated).toBeLessThan(previous.layout.pages.length);
      expect(geometry(restored.layout)).toEqual(geometry(previous.layout));
      expect(restored.measureReuse.mode).toBe('proved-dirty-only');
      expect(restored.bridgeTiming.counters.bodyMeasureCacheKeyComputations).toBe(removedCount + 1);
      expect(restored.bridgeTiming.counters.measureContentSignatureComputations).toBe(0);
      restored.measures.forEach((measurement, index) => {
        if (index < head || index > head + removedCount) {
          expect(measurement).toBe(result.measures[index < head ? index : index - removedCount]);
        }
      });

      for (const insertedBlockIds of [
        [...restoredIds].reverse(),
        [restoredIds[0]!, ...restoredIds.slice(0, -1)],
        [...restoredIds.slice(0, -1), before[head + removedCount + 2]!.id],
      ]) {
        const rejected = await incrementalLayout(
          after,
          result.layout,
          before,
          options,
          measureRangeBlock,
          undefined,
          result.measures,
          undefined,
          undefined,
          { ...restoreReuse, provedDirtyRegion: { ...restoreReuse.provedDirtyRegion, insertedBlockIds } },
        );
        expect(rejected.layoutReuse.mode).toBe('full');
        expect(rejected.measureReuse.mode).toBe('full-scan');
        expect(geometry(rejected.layout)).toEqual(geometry(previous.layout));
      }
    },
  );
});

function paginationGeometry(layout: Layout): unknown {
  return layout.pages.map((page) => ({
    size: page.size,
    margins: page.margins,
    sectionIndex: page.sectionIndex,
    fragments: page.fragments.map((fragment) => ({
      kind: fragment.kind,
      blockId: fragment.blockId,
      x: fragment.x,
      y: fragment.y,
      width: fragment.width,
      fromLine: 'fromLine' in fragment ? fragment.fromLine : undefined,
      toLine: 'toLine' in fragment ? fragment.toLine : undefined,
      continuesFromPrev: 'continuesFromPrev' in fragment ? fragment.continuesFromPrev : undefined,
      continuesOnNext: 'continuesOnNext' in fragment ? fragment.continuesOnNext : undefined,
    })),
  }));
}

function json(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe('incrementalLayout affected frontier', () => {
  beforeEach(() => measureCache.clear());

  it('reports canonical block constraints even when measurement is served from cache', async () => {
    const blocks = documentBlocks(3);
    const observeConstraints = vi.fn();
    const measureBlock = Object.assign(
      vi.fn(async (block: FlowBlock) => measureFor(block)),
      { observeConstraints },
    );

    await incrementalLayout([], null, blocks, options, measureBlock);
    expect(measureBlock).toHaveBeenCalledTimes(3);
    measureBlock.mockClear();
    observeConstraints.mockClear();

    await incrementalLayout([], null, blocks, options, measureBlock);

    expect(measureBlock).not.toHaveBeenCalled();
    expect(observeConstraints).toHaveBeenCalledTimes(3);
    expect(observeConstraints.mock.calls).toEqual(blocks.map((block) => [block, { maxWidth: 180, maxHeight: 80 }]));
  });

  it('remeasures and repaginates only a proved same-position diagnostic replacement', async () => {
    const previousBlocks = documentBlocks(24);
    const measureBlock = vi.fn(async (block: FlowBlock) => measureFor(block));
    const previous = await incrementalLayout([], null, previousBlocks, options, measureBlock);
    previous.layout.layoutEpoch = 1;
    const replacementIndex = 10;
    const previousBlock = previousBlocks[replacementIndex]!;
    const diagnosticBlock = paragraph('render-diagnostic/main/10-11', 'unavailable', previousBlock.runs[0]!.pmStart!);
    const nextBlocks = previousBlocks.slice();
    nextBlocks[replacementIndex] = diagnosticBlock;
    const dirty = computeDirtyRegions(previousBlocks, nextBlocks);
    const previousBlockIndexById = new Map(previousBlocks.map((block, index) => [block.id, index]));
    const currentBlockIndexById = new Map(nextBlocks.map((block, index) => [block.id, index]));
    measureBlock.mockClear();

    const result = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      options,
      measureBlock,
      undefined,
      previous.measures,
      undefined,
      undefined,
      {
        ...retainedMetadata(previous.layout),
        previousPageStartKeys: previous.layout.pages.map(pageStartKey),
        previousPageStartKeyIndex: pageStartKeyIndex(previous.layout),
        previousBlockPageIndex: blockPageIndex(previous.layout),
        maxRelaidPages: 4,
        requireDocumentStartCheckpoint: false,
        allowBlockIdChurn: true,
        dirtyBlockIds: [...dirty.changedBlockIds, ...dirty.insertedBlockIds],
        previousBlockIndexById,
        currentBlockIndexById,
        blockIdRewrites: {
          previousToCurrent: new Map([[previousBlock.id, diagnosticBlock.id]]),
          currentToPrevious: new Map([[diagnosticBlock.id, previousBlock.id]]),
        },
        dependencyProof: {
          profile: 'single-section-local-text',
          blockIdsUnchanged: true,
          blockIdsUnique: true,
          globalDependenciesAbsent: true,
          renderInputsUnchanged: true,
          pageReferencesAbsent: true,
        },
        provedDirtyRegion: dirty,
        provedDirtyMeasureConstraints: new Map([[diagnosticBlock.id, { maxWidth: 180, maxHeight: 80 }]]),
      },
      {
        provedDirtyRegion: dirty,
        dependencyProof: {
          profile: 'single-section-local-text',
          blockIdsUnchanged: true,
          blockIdsUnique: true,
          globalDependenciesAbsent: true,
          renderInputsUnchanged: true,
          pageReferencesAbsent: true,
        },
        previousBlockIndexById,
        currentBlockIndexById,
        provedDirtyMeasureConstraints: new Map([[diagnosticBlock.id, { maxWidth: 180, maxHeight: 80 }]]),
      },
    );

    expect(measureBlock).toHaveBeenCalledTimes(1);
    expect(measureBlock).toHaveBeenCalledWith(diagnosticBlock, { maxWidth: 180, maxHeight: 80 });
    expect(result.measureReuse).toMatchObject({ mode: 'proved-dirty-only', blocksMeasured: 1 });
    expect(result.layoutReuse?.mode).toBe('tail-splice');
    expect(result.layoutReuse?.pagesPaginated).not.toBeNull();
    expect(result.layoutReuse!.pagesPaginated!).toBeLessThan(previous.layout.pages.length);
    expect(result.measures[replacementIndex - 1]).toBe(previous.measures[replacementIndex - 1]);
    expect(result.measures[replacementIndex + 1]).toBe(previous.measures[replacementIndex + 1]);
  });

  it('boundedly collapses a contiguous multi-block source owner into one diagnostic', async () => {
    const previousBlocks = documentBlocks(24);
    const measureBlock = vi.fn(async (block: FlowBlock) => measureFor(block));
    const previous = await incrementalLayout([], null, previousBlocks, options, measureBlock);
    previous.layout.layoutEpoch = 1;
    const replacementIndex = 10;
    const removedBlocks = previousBlocks.slice(replacementIndex, replacementIndex + 2);
    const diagnosticBlock = paragraph(
      'render-diagnostic/main/10-12',
      'unavailable',
      removedBlocks[0]!.runs[0]!.pmStart!,
    );
    const nextBlocks = [
      ...previousBlocks.slice(0, replacementIndex),
      diagnosticBlock,
      ...previousBlocks.slice(replacementIndex + removedBlocks.length),
    ];
    const dirty = computeDirtyRegions(previousBlocks, nextBlocks);
    const previousBlockIndexById = new Map(previousBlocks.map((block, index) => [block.id, index]));
    const currentBlockIndexById = new Map(nextBlocks.map((block, index) => [block.id, index]));
    const dependencyProof = {
      profile: 'single-section-local-text' as const,
      blockIdsUnchanged: true as const,
      blockIdsUnique: true as const,
      globalDependenciesAbsent: true as const,
      renderInputsUnchanged: true as const,
      pageReferencesAbsent: true as const,
    };
    const previousToCurrent = new Map(removedBlocks.map((block) => [block.id, diagnosticBlock.id]));
    const currentToPrevious = new Map([[diagnosticBlock.id, removedBlocks[0]!.id]]);
    measureBlock.mockClear();

    const result = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      options,
      measureBlock,
      undefined,
      previous.measures,
      undefined,
      undefined,
      {
        ...retainedMetadata(previous.layout),
        previousPageStartKeys: previous.layout.pages.map(pageStartKey),
        previousPageStartKeyIndex: pageStartKeyIndex(previous.layout),
        previousBlockPageIndex: blockPageIndex(previous.layout),
        maxRelaidPages: 4,
        requireDocumentStartCheckpoint: false,
        allowBlockIdChurn: true,
        dirtyBlockIds: [...dirty.changedBlockIds, ...dirty.insertedBlockIds],
        previousBlockIndexById,
        currentBlockIndexById,
        blockIdRewrites: { previousToCurrent, currentToPrevious },
        dependencyProof,
        provedDirtyRegion: dirty,
        provedDirtyMeasureConstraints: new Map([[diagnosticBlock.id, { maxWidth: 180, maxHeight: 80 }]]),
      },
      {
        provedDirtyRegion: dirty,
        dependencyProof,
        previousBlockIndexById,
        currentBlockIndexById,
        provedDirtyMeasureConstraints: new Map([[diagnosticBlock.id, { maxWidth: 180, maxHeight: 80 }]]),
      },
    );

    expect(measureBlock).toHaveBeenCalledTimes(1);
    expect(measureBlock).toHaveBeenCalledWith(diagnosticBlock, { maxWidth: 180, maxHeight: 80 });
    expect(result.measureReuse).toMatchObject({ mode: 'proved-dirty-only', blocksMeasured: 1 });
    expect(result.layoutReuse?.mode).toBe('tail-splice');
    expect(result.measures).toHaveLength(nextBlocks.length);
    expect(result.measures[replacementIndex - 1]).toBe(previous.measures[replacementIndex - 1]);
    expect(result.measures[replacementIndex + 1]).toBe(previous.measures[replacementIndex + 2]);
  });

  it('boundedly replaces a fragmentless pageBreakBefore companion with its paragraph owner', async () => {
    const bodyBlocks = documentBlocks(24);
    const replacementIndex = 10;
    const pageBreak = {
      kind: 'pageBreak' as const,
      id: 'page-break-before-p10',
      attrs: { source: 'pageBreakBefore' as const },
    };
    const paragraphOwner = bodyBlocks[replacementIndex]!;
    const previousBlocks: FlowBlock[] = [
      ...bodyBlocks.slice(0, replacementIndex),
      pageBreak,
      paragraphOwner,
      ...bodyBlocks.slice(replacementIndex + 1),
    ];
    const measureBlock = vi.fn(
      async (block: FlowBlock): Promise<Measure> =>
        block.kind === 'pageBreak' ? { kind: 'pageBreak' } : measureFor(block),
    );
    const previous = await incrementalLayout([], null, previousBlocks, options, measureBlock);
    previous.layout.layoutEpoch = 1;
    expect(
      previous.layout.pages.some((page) => page.fragments.some((fragment) => fragment.blockId === pageBreak.id)),
    ).toBe(false);

    const diagnosticBlock = paragraph('render-diagnostic/main/10-11', 'unavailable', paragraphOwner.runs[0]!.pmStart!);
    const nextBlocks = [
      ...previousBlocks.slice(0, replacementIndex),
      diagnosticBlock,
      ...previousBlocks.slice(replacementIndex + 2),
    ];
    const dirty = computeDirtyRegions(previousBlocks, nextBlocks);
    const previousBlockIndexById = new Map(previousBlocks.map((block, index) => [block.id, index]));
    const currentBlockIndexById = new Map(nextBlocks.map((block, index) => [block.id, index]));
    const previousBlockPageIndex = blockPageIndex(previous.layout);
    const paragraphPageRange = previousBlockPageIndex.get(paragraphOwner.id)!;
    previousBlockPageIndex.set(pageBreak.id, paragraphPageRange);
    const dependencyProof = {
      profile: 'single-section-local-text' as const,
      blockIdsUnchanged: true as const,
      blockIdsUnique: true as const,
      globalDependenciesAbsent: true as const,
      renderInputsUnchanged: true as const,
      pageReferencesAbsent: true as const,
    };
    measureBlock.mockClear();

    const result = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      options,
      measureBlock,
      undefined,
      previous.measures,
      undefined,
      undefined,
      {
        ...retainedMetadata(previous.layout),
        previousPageStartKeys: previous.layout.pages.map(pageStartKey),
        previousPageStartKeyIndex: pageStartKeyIndex(previous.layout),
        previousBlockPageIndex,
        maxRelaidPages: 12,
        requireDocumentStartCheckpoint: false,
        allowBlockIdChurn: true,
        dirtyBlockIds: [...dirty.changedBlockIds, ...dirty.insertedBlockIds],
        previousBlockIndexById,
        currentBlockIndexById,
        blockIdRewrites: {
          previousToCurrent: new Map([
            [pageBreak.id, diagnosticBlock.id],
            [paragraphOwner.id, diagnosticBlock.id],
          ]),
          currentToPrevious: new Map([[diagnosticBlock.id, paragraphOwner.id]]),
        },
        dependencyProof,
        provedDirtyRegion: dirty,
        provedDirtyMeasureConstraints: new Map([[diagnosticBlock.id, { maxWidth: 180, maxHeight: 80 }]]),
      },
      {
        provedDirtyRegion: dirty,
        dependencyProof,
        previousBlockIndexById,
        currentBlockIndexById,
        provedDirtyMeasureConstraints: new Map([[diagnosticBlock.id, { maxWidth: 180, maxHeight: 80 }]]),
      },
    );

    expect(measureBlock).toHaveBeenCalledTimes(1);
    expect(measureBlock).toHaveBeenCalledWith(diagnosticBlock, { maxWidth: 180, maxHeight: 80 });
    expect(result.measureReuse).toMatchObject({ mode: 'proved-dirty-only', blocksMeasured: 1 });
    expect(result.layoutReuse?.mode).toBe('tail-splice');
    expect(result.layoutReuse?.pagesPaginated).not.toBeNull();
    expect(result.layoutReuse!.pagesPaginated!).toBeLessThan(previous.layout.pages.length);
    expect(result.measures[replacementIndex - 1]).toBe(previous.measures[replacementIndex - 1]);
    expect(result.measures[replacementIndex + 1]).toBe(previous.measures[replacementIndex + 2]);
  });

  it.each([
    { kind: 'pageBreak' as const, lineBreakType: 'page' as const },
    { kind: 'columnBreak' as const, lineBreakType: 'column' as const },
  ])(
    'boundedly replaces a fragmentless manual $lineBreakType break and both paragraph companions',
    async ({ kind, lineBreakType }) => {
      const bodyBlocks = documentBlocks(24);
      const replacementIndex = 10;
      const before = paragraph('manual-break-before', 'before', bodyBlocks[replacementIndex]!.runs[0]!.pmStart!);
      const manualBreak: FlowBlock = {
        kind,
        id: `manual-${lineBreakType}-break`,
        attrs: { lineBreakType },
      };
      const after = paragraph('manual-break-after', 'after', before.runs[0]!.pmEnd! + 1);
      const removedBlocks: FlowBlock[] = [before, manualBreak, after];
      const previousBlocks: FlowBlock[] = [
        ...bodyBlocks.slice(0, replacementIndex),
        ...removedBlocks,
        ...bodyBlocks.slice(replacementIndex + 1),
      ];
      const measureBlock = vi.fn(
        async (block: FlowBlock): Promise<Measure> =>
          block.kind === 'pageBreak' || block.kind === 'columnBreak' ? { kind: block.kind } : measureFor(block),
      );
      const previous = await incrementalLayout([], null, previousBlocks, options, measureBlock);
      previous.layout.layoutEpoch = 1;
      expect(
        previous.layout.pages.some((page) => page.fragments.some((fragment) => fragment.blockId === manualBreak.id)),
      ).toBe(false);

      const diagnosticBlock = paragraph('render-diagnostic/main/10-11', 'unavailable', before.runs[0]!.pmStart!);
      const nextBlocks = [
        ...previousBlocks.slice(0, replacementIndex),
        diagnosticBlock,
        ...previousBlocks.slice(replacementIndex + removedBlocks.length),
      ];
      const dirty = computeDirtyRegions(previousBlocks, nextBlocks);
      const previousBlockIndexById = new Map(previousBlocks.map((block, index) => [block.id, index]));
      const currentBlockIndexById = new Map(nextBlocks.map((block, index) => [block.id, index]));
      const previousBlockPageIndex = blockPageIndex(previous.layout);
      expect(previousBlockPageIndex.has(before.id)).toBe(true);
      expect(previousBlockPageIndex.has(after.id)).toBe(true);
      expect(previousBlockPageIndex.has(manualBreak.id)).toBe(false);
      const dependencyProof = {
        profile: 'single-section-local-text' as const,
        blockIdsUnchanged: true as const,
        blockIdsUnique: true as const,
        globalDependenciesAbsent: true as const,
        renderInputsUnchanged: true as const,
        pageReferencesAbsent: true as const,
      };
      measureBlock.mockClear();

      const result = await incrementalLayout(
        previousBlocks,
        previous.layout,
        nextBlocks,
        options,
        measureBlock,
        undefined,
        previous.measures,
        undefined,
        undefined,
        {
          ...retainedMetadata(previous.layout),
          previousPageStartKeys: previous.layout.pages.map(pageStartKey),
          previousPageStartKeyIndex: pageStartKeyIndex(previous.layout),
          previousBlockPageIndex,
          maxRelaidPages: 12,
          requireDocumentStartCheckpoint: false,
          allowBlockIdChurn: true,
          dirtyBlockIds: [...dirty.changedBlockIds, ...dirty.insertedBlockIds],
          previousBlockIndexById,
          currentBlockIndexById,
          blockIdRewrites: {
            previousToCurrent: new Map(removedBlocks.map((block) => [block.id, diagnosticBlock.id])),
            currentToPrevious: new Map([[diagnosticBlock.id, after.id]]),
          },
          dependencyProof,
          provedDirtyRegion: dirty,
          provedDirtyMeasureConstraints: new Map([[diagnosticBlock.id, { maxWidth: 180, maxHeight: 80 }]]),
        },
        {
          provedDirtyRegion: dirty,
          dependencyProof,
          previousBlockIndexById,
          currentBlockIndexById,
          provedDirtyMeasureConstraints: new Map([[diagnosticBlock.id, { maxWidth: 180, maxHeight: 80 }]]),
        },
      );

      expect(measureBlock).toHaveBeenCalledTimes(1);
      expect(measureBlock).toHaveBeenCalledWith(diagnosticBlock, { maxWidth: 180, maxHeight: 80 });
      expect(result.measureReuse).toMatchObject({ mode: 'proved-dirty-only', blocksMeasured: 1 });
      expect(result.layoutReuse?.mode).toBe('tail-splice');
      expect(result.layoutReuse?.pagesPaginated).not.toBeNull();
      expect(result.layoutReuse!.pagesPaginated!).toBeLessThan(previous.layout.pages.length);
      expect(result.measures[replacementIndex - 1]).toBe(previous.measures[replacementIndex - 1]);
      expect(result.measures[replacementIndex + 1]).toBe(previous.measures[replacementIndex + 3]);
    },
  );

  it('keeps an accepted text edit dirty when a different owner becomes diagnostic', async () => {
    const previousBlocks = documentBlocks(24);
    const measureBlock = vi.fn(async (block: FlowBlock) => measureFor(block));
    const previous = await incrementalLayout([], null, previousBlocks, options, measureBlock);
    previous.layout.layoutEpoch = 1;
    const editedIndex = 5;
    const diagnosticIndex = 10;
    const editedBlock = paragraph(
      previousBlocks[editedIndex]!.id,
      'accepted-edit-that-wraps-differently',
      previousBlocks[editedIndex]!.runs[0]!.pmStart!,
    );
    const replacedBlock = previousBlocks[diagnosticIndex]!;
    const diagnosticBlock = paragraph('render-diagnostic/main/10-11', 'unavailable', replacedBlock.runs[0]!.pmStart!);
    const nextBlocks = previousBlocks.slice();
    nextBlocks[editedIndex] = editedBlock;
    nextBlocks[diagnosticIndex] = diagnosticBlock;
    const dirty = computeDirtyRegions(previousBlocks, nextBlocks);
    const previousBlockIndexById = new Map(previousBlocks.map((block, index) => [block.id, index]));
    const currentBlockIndexById = new Map(nextBlocks.map((block, index) => [block.id, index]));
    const dependencyProof = {
      profile: 'single-section-local-text' as const,
      blockIdsUnchanged: true as const,
      blockIdsUnique: true as const,
      globalDependenciesAbsent: true as const,
      renderInputsUnchanged: true as const,
      pageReferencesAbsent: true as const,
    };
    measureBlock.mockClear();

    const result = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      options,
      measureBlock,
      undefined,
      previous.measures,
      undefined,
      undefined,
      {
        ...retainedMetadata(previous.layout),
        previousPageStartKeys: previous.layout.pages.map(pageStartKey),
        previousPageStartKeyIndex: pageStartKeyIndex(previous.layout),
        previousBlockPageIndex: blockPageIndex(previous.layout),
        maxRelaidPages: 4,
        requireDocumentStartCheckpoint: false,
        allowBlockIdChurn: true,
        dirtyBlockIds: [...dirty.changedBlockIds, ...dirty.insertedBlockIds],
        previousBlockIndexById,
        currentBlockIndexById,
        blockIdRewrites: {
          previousToCurrent: new Map([[replacedBlock.id, diagnosticBlock.id]]),
          currentToPrevious: new Map([[diagnosticBlock.id, replacedBlock.id]]),
        },
        dependencyProof,
        provedDirtyRegion: dirty,
        provedDirtyMeasureConstraints: new Map([
          [editedBlock.id, { maxWidth: 180, maxHeight: 80 }],
          [diagnosticBlock.id, { maxWidth: 180, maxHeight: 80 }],
        ]),
      },
      {
        provedDirtyRegion: dirty,
        dependencyProof,
        previousBlockIndexById,
        currentBlockIndexById,
        provedDirtyMeasureConstraints: new Map([
          [editedBlock.id, { maxWidth: 180, maxHeight: 80 }],
          [diagnosticBlock.id, { maxWidth: 180, maxHeight: 80 }],
        ]),
      },
    );

    expect(measureBlock.mock.calls.map(([block]) => block.id).sort()).toEqual(
      [editedBlock.id, diagnosticBlock.id].sort(),
    );
    expect(result.measures[editedIndex]).not.toBe(previous.measures[editedIndex]);
    expect(result.measures[diagnosticIndex]).not.toBe(previous.measures[diagnosticIndex]);
    expect(result.measureReuse).toMatchObject({ mode: 'proved-dirty-only', blocksMeasured: 2 });
    expect(result.layoutReuse?.mode).toBe('tail-splice');
  });

  it('locally paginates a proved split without treating its inserted tail as retained vAlign evidence', async () => {
    const previousBlocks = Array.from({ length: 12 }, (_, index) =>
      paragraph(`n/main:body/P${index}/o${index}`, `text-${index}`, 1 + index * 20),
    );
    const coldMeasure = vi.fn(async (block: FlowBlock) => measureFor(block));
    const previous = await incrementalLayout([], null, previousBlocks, options, coldMeasure);
    previous.layout.layoutEpoch = 1;

    const splitIndex = 5;
    const head = previousBlocks[splitIndex]!;
    const previousToCurrent = new Map<string, string>();
    const currentToPrevious = new Map<string, string>();
    const shiftedTail = previousBlocks.slice(splitIndex + 1).map((block, offset) => {
      const previousIndex = splitIndex + 1 + offset;
      const currentId = `n/main:body/P${previousIndex}/o${previousIndex + 1}`;
      previousToCurrent.set(block.id, currentId);
      currentToPrevious.set(currentId, block.id);
      return paragraph(currentId, block.runs[0]!.text, block.runs[0]!.pmStart! + 1);
    });
    const tailId = 'n/main:body/TAIL/o6';
    const nextBlocks = [
      ...previousBlocks.slice(0, splitIndex),
      paragraph(head.id, 'te', head.runs[0]!.pmStart!),
      paragraph(tailId, 'xt-5', head.runs[0]!.pmStart! + 3),
      ...shiftedTail,
    ];
    const dirtyIds = [head.id, tailId];
    const stableBlockIds = new Set(nextBlocks.map((block) => block.id).filter((id) => !dirtyIds.includes(id)));
    const provedDirtyRegion = {
      firstDirtyIndex: splitIndex,
      lastStableIndex: splitIndex - 1,
      insertedBlockIds: [tailId],
      deletedBlockIds: [],
      changedBlockIds: dirtyIds,
      stableBlockIds,
    };
    const measureNext = async (block: FlowBlock): Promise<ParagraphMeasure> => {
      const measured = measureFor(block);
      if (!dirtyIds.includes(block.id)) return measured;
      return {
        ...measured,
        totalHeight: 15,
        lines: measured.lines.map((line) => ({ ...line, lineHeight: 15, ascent: 12, descent: 3 })),
      };
    };
    const warmMeasure = vi.fn(async (block: FlowBlock) => {
      if (!dirtyIds.includes(block.id)) throw new Error(`structural warm measure touched stable block ${block.id}`);
      return measureNext(block);
    });
    const warm = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      options,
      warmMeasure,
      undefined,
      previous.measures,
      undefined,
      undefined,
      {
        ...retainedMetadata(previous.layout),
        previousPageStartKeys: previous.layout.pages.map(pageStartKey),
        previousBlockPageIndex: blockPageIndex(previous.layout),
        previousPageStartKeyIndex: pageStartKeyIndex(previous.layout),
        previousBlockIndexById: new Map(previousBlocks.map((block, index) => [block.id, index])),
        currentBlockIndexById: new Map(nextBlocks.map((block, index) => [block.id, index])),
        blockIdRewrites: { previousToCurrent, currentToPrevious },
        allowBlockIdChurn: true,
        dirtyBlockIds: dirtyIds,
        dependencyProof: {
          profile: 'page-checkpoint-local-text',
          blockIdsUnchanged: true,
          blockIdsUnique: true,
          globalDependenciesAbsent: false,
          globalDependenciesFencedByPageCheckpoint: true,
          admittedDependencyClasses: ['cross-references'],
          renderInputsUnchanged: true,
          pageReferencesAbsent: true,
          crossReferencesAbsent: false,
          multiColumnSectionsProvedNonBalanceable: true,
          vAlignSectionsBoundaryBlockId: previousBlocks[2]!.id,
        },
        provedDirtyRegion,
        provedDirtyMeasureConstraints: new Map(dirtyIds.map((id) => [id, { maxWidth: 180, maxHeight: 80 }])),
        maxRelaidPages: 3,
        requireDocumentStartCheckpoint: false,
        pmShift: { atChar: head.runs[0]!.pmStart! + 3, delta: 1 },
      },
    );

    expect(warm.measureReuse).toEqual({
      mode: 'proved-dirty-only',
      blocksMeasured: 2,
      measuresAdopted: nextBlocks.length - 2,
      reason: 'exact-envelope-dirty-measure-packet',
    });
    expect(warmMeasure).toHaveBeenCalledTimes(2);
    expect(warm.layoutReuse?.reason).toBe('m4-affected-frontier-converged-tail-adopted');
    expect(warm.layoutReuse!.pagesPaginated).toBeLessThan(previous.layout.pages.length);

    measureCache.clear();
    const full = await incrementalLayout([], null, nextBlocks, options, measureNext);
    expect(paginationGeometry(warm.layout)).toEqual(paginationGeometry(full.layout));
  });

  it.each(
    [16, 29].flatMap((changedIndex) =>
      (['unchanged', 'note-source-changed', 'render-inputs-changed'] as const).map((change) => ({
        changedIndex,
        change,
      })),
    ),
  )(
    'reuses a complete local note band only with exact ownership at paragraph $changedIndex: $change',
    async ({ changedIndex, change }) => {
      const previousBlocks = documentBlocks(30);
      const footnoteOptions = {
        ...options,
        pageSize: { w: 200, h: 240 },
        footnotes: {
          refs: [6, 16, 26].map((index) => ({
            id: String(index),
            pos: Number.MAX_SAFE_INTEGER,
            blockId: previousBlocks[index]!.id,
          })),
          blocksById: new Map(
            [6, 16, 26].map((index) => [
              String(index),
              [paragraph(`footnote-${index}-0-paragraph`, 'unchanged note', 0)],
            ]),
          ),
          topPadding: 4,
          dividerHeight: 2,
        },
      };
      const previous = await incrementalLayout([], null, previousBlocks, footnoteOptions, async (block) =>
        measureFor(block),
      );
      previous.layout.layoutEpoch = 1;
      const nextBlocks = replaceParagraphText(previousBlocks, changedIndex, `text-${changedIndex}!`);
      const dirtyIds = [`p${changedIndex}`];
      const currentFootnoteOptions =
        change === 'note-source-changed'
          ? {
              ...footnoteOptions,
              footnotes: {
                ...footnoteOptions.footnotes,
                blocksById: new Map(footnoteOptions.footnotes.blocksById).set('16', [
                  paragraph('footnote-16-0-paragraph', 'changed note body', 0),
                ]),
              },
            }
          : footnoteOptions;
      const warm = await incrementalLayout(
        previousBlocks,
        previous.layout,
        nextBlocks,
        currentFootnoteOptions,
        async (block) => measureFor(block),
        undefined,
        previous.measures,
        undefined,
        {
          footnoteReserveSeed: previous.footnoteReserveSeed!,
          noteMeasurePlaneRetainedExact: change !== 'note-source-changed',
          retainedFootnoteExtras: { blocks: previous.extraBlocks!, measures: previous.extraMeasures! },
        },
        {
          ...provedReuse(previousBlocks, nextBlocks, previous.layout),
          previousBlockIndexById: new Map(previousBlocks.map((block, index) => [block.id, index])),
          dependencyProof: {
            profile: 'page-checkpoint-local-text',
            blockIdsUnchanged: true,
            blockIdsUnique: true,
            globalDependenciesAbsent: false,
            globalDependenciesFencedByPageCheckpoint: true,
            admittedDependencyClasses: ['footnotes'],
            renderInputsUnchanged: change !== 'render-inputs-changed',
            pageReferencesAbsent: true,
            multiColumnSectionsProvedNonBalanceable: true,
          },
          dirtyBlockIds: dirtyIds,
          provedDirtyMeasureConstraints: new Map(dirtyIds.map((id) => [id, { maxWidth: 180, maxHeight: 220 }])),
          maxRelaidPages: 3,
          requireDocumentStartCheckpoint: false,
          pmShift: { atChar: previousBlocks[changedIndex]!.runs[0]!.pmEnd!, delta: 1 },
        },
      );

      if (change === 'unchanged') {
        expect(warm.layoutReuse).toMatchObject({
          mode: 'tail-splice',
          tailDisposition: changedIndex === 29 ? 'relaid-to-document-end' : 'adopted-source-tail',
        });
        expect(warm.bridgeTiming.counters.footnoteRelayouts).toBe(0);
        expect(warm.extraBlocks).toBe(previous.extraBlocks);
        expect(warm.extraMeasures).toBe(previous.extraMeasures);
      } else {
        expect(warm.extraBlocks).not.toBe(previous.extraBlocks);
      }
      expect(
        previous.layout.pages[blockPageIndex(previous.layout).get('p16')!.firstPage]!.footnoteLedger?.anchorIds,
      ).toContain('16');
      measureCache.clear();
      const cold = await incrementalLayout([], null, nextBlocks, currentFootnoteOptions, async (block) =>
        measureFor(block),
      );
      expect(json(warm.layout)).toEqual(json(cold.layout));
      expect(json(warm.extraBlocks)).toEqual(json(cold.extraBlocks));
    },
  );

  it('preserves retained footnotes when exact dirty measurement derives a different global height', async () => {
    const previousBlocks = Array.from({ length: 18 }, (_, index) =>
      paragraph(`n/main:body/P${index}/o${index}`, `text-${index}`, 1 + index * 20),
    );
    const footnoteSourceIndex = 14;
    const footnoteOptions = {
      ...options,
      footnotes: {
        refs: [{ id: '1', pos: Number.MAX_SAFE_INTEGER, blockId: previousBlocks[footnoteSourceIndex]!.id }],
        blocksById: new Map([['1', [paragraph('footnote-1-0-paragraph', 'note', 0)]]]),
        topPadding: 4,
        dividerHeight: 2,
      },
    };
    const measureBlock = vi.fn(async (block: FlowBlock) => measureFor(block));
    const previous = await incrementalLayout([], null, previousBlocks, footnoteOptions, measureBlock);
    previous.layout.layoutEpoch = 1;
    expect(previous.extraBlocks).toBeTruthy();
    expect(previous.extraMeasures).toBeTruthy();
    expect(previous.footnoteReserveSeed?.notePageIndexes?.length).toBeLessThan(previous.layout.pages.length);
    const retainedSeedWithDerivedHeightDrift = {
      ...previous.footnoteReserveSeed!,
      // The proved-dirty path deliberately skips the whole-body section scan.
      // This aggregate constraint is not an input to an exactly retained note plane.
      measurementHeight: previous.footnoteReserveSeed!.measurementHeight + 1,
    };

    const splitIndex = 5;
    const head = previousBlocks[splitIndex]!;
    const previousToCurrent = new Map<string, string>();
    const currentToPrevious = new Map<string, string>();
    const shiftedTail = previousBlocks.slice(splitIndex + 1).map((block, offset) => {
      const previousIndex = splitIndex + 1 + offset;
      const currentId = `n/main:body/P${previousIndex}/o${previousIndex + 1}`;
      previousToCurrent.set(block.id, currentId);
      currentToPrevious.set(currentId, block.id);
      return paragraph(currentId, block.runs[0]!.text, block.runs[0]!.pmStart! + 1);
    });
    const tailId = 'n/main:body/TAIL/o6';
    const nextBlocks = [
      ...previousBlocks.slice(0, splitIndex),
      paragraph(head.id, 'te', head.runs[0]!.pmStart!),
      paragraph(tailId, 'xt-5', head.runs[0]!.pmStart! + 3),
      ...shiftedTail,
    ];
    const currentFootnoteOptions = {
      ...footnoteOptions,
      footnotes: {
        ...footnoteOptions.footnotes,
        refs: [
          {
            id: '1',
            pos: Number.MAX_SAFE_INTEGER,
            blockId: previousToCurrent.get(previousBlocks[footnoteSourceIndex]!.id)!,
          },
        ],
      },
    };
    const dirtyIds = [head.id, tailId];
    const provedDirtyRegion = {
      firstDirtyIndex: splitIndex,
      lastStableIndex: splitIndex - 1,
      insertedBlockIds: [tailId],
      deletedBlockIds: [],
      changedBlockIds: dirtyIds,
      stableBlockIds: new Set(nextBlocks.map((block) => block.id).filter((id) => !dirtyIds.includes(id))),
    };
    const measureNext = async (block: FlowBlock): Promise<ParagraphMeasure> => {
      const measured = measureFor(block);
      if (!dirtyIds.includes(block.id)) return measured;
      return {
        ...measured,
        totalHeight: 15,
        lines: measured.lines.map((line) => ({ ...line, lineHeight: 15, ascent: 12, descent: 3 })),
      };
    };
    const warm = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      currentFootnoteOptions,
      measureNext,
      undefined,
      previous.measures,
      undefined,
      {
        footnoteReserveSeed: retainedSeedWithDerivedHeightDrift,
        noteMeasurePlaneRetainedExact: true,
        retainedFootnoteExtras: {
          blocks: previous.extraBlocks!,
          measures: previous.extraMeasures!,
        },
      },
      {
        ...retainedMetadata(previous.layout),
        previousPageStartKeys: previous.layout.pages.map(pageStartKey),
        previousBlockPageIndex: blockPageIndex(previous.layout),
        previousPageStartKeyIndex: pageStartKeyIndex(previous.layout),
        previousBlockIndexById: new Map(previousBlocks.map((block, index) => [block.id, index])),
        currentBlockIndexById: new Map(nextBlocks.map((block, index) => [block.id, index])),
        blockIdRewrites: { previousToCurrent, currentToPrevious },
        allowBlockIdChurn: true,
        dirtyBlockIds: dirtyIds,
        dependencyProof: {
          profile: 'page-checkpoint-local-text',
          blockIdsUnchanged: true,
          blockIdsUnique: true,
          globalDependenciesAbsent: false,
          globalDependenciesFencedByPageCheckpoint: true,
          admittedDependencyClasses: ['footnotes'],
          renderInputsUnchanged: true,
          pageReferencesAbsent: true,
          multiColumnSectionsProvedNonBalanceable: true,
        },
        provedDirtyRegion,
        provedDirtyMeasureConstraints: new Map(dirtyIds.map((id) => [id, { maxWidth: 180, maxHeight: 80 }])),
        maxRelaidPages: 3,
        requireDocumentStartCheckpoint: false,
        pmShift: { atChar: head.runs[0]!.pmStart! + 3, delta: 1 },
      },
    );

    expect(warm.layoutReuse).toMatchObject({
      mode: 'tail-splice',
      reason: 'm4-affected-frontier-converged-tail-adopted',
    });
    expect(warm.extraBlocks).toBe(previous.extraBlocks);
    expect(warm.extraMeasures).toBe(previous.extraMeasures);
    measureCache.clear();
    const cold = await incrementalLayout([], null, nextBlocks, currentFootnoteOptions, measureNext);
    expect(json(warm.layout)).toEqual(json(cold.layout));
  });

  it('cannot converge from document start before reaching a later dirty page', async () => {
    const previousBlocks = documentBlocks(14);
    previousBlocks[7]!.sourceAnchor = { flowBlockId: 'p7', pmRange: { from: 141, to: 147 } };
    const measureBlock = vi.fn(async (block: FlowBlock) => measureFor(block));
    const previous = await incrementalLayout([], null, previousBlocks, options, measureBlock);
    const previousIndex = blockPageIndex(previous.layout);

    const nextBlocks = replaceParagraphText(previousBlocks, 6, 'text-6!');
    nextBlocks[7]!.sourceAnchor = { flowBlockId: 'p7', pmRange: { from: 142, to: 148 } };
    const currentIndex = new Map(nextBlocks.map((block, index) => [block.id, index]));

    const incremental = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      options,
      measureBlock,
      undefined,
      previous.measures,
      undefined,
      undefined,
      {
        ...provedReuse(previousBlocks, nextBlocks, previous.layout),
        previousPageStartKeys: previous.layout.pages.map(pageStartKey),
        previousBlockPageIndex: previousIndex,
        requireDocumentStartCheckpoint: true,
        maxRelaidPages: 3,
        pmShift: { atChar: 1 + 6 * 20 + 'text-6'.length, delta: 1 },
        dirtyBlockIds: ['p6'],
        currentBlockIndexById: currentIndex,
      },
    );

    const dirtyPage = previousIndex.get('p6')!.lastPage;
    expect(incremental.layoutReuse).toMatchObject({
      mode: 'tail-splice',
      affectedFrontierPageIndex: dirtyPage,
    });
    expect(incremental.layoutReuse!.convergencePageIndex).toBeGreaterThan(dirtyPage);
    expect(incremental.layoutReuse!.pagesPaginated).toBeGreaterThan(dirtyPage);

    const adoption = incremental.layoutReuse!.tailAdoption!;
    expect(adoption.startPageIndex).toBe(incremental.layoutReuse!.convergencePageIndex);
    expect(adoption.positionTransforms).toEqual([{ atChar: 1 + 6 * 20 + 'text-6'.length, delta: 1 }]);
    expect(incremental.layout.pages[adoption.startPageIndex]).not.toBe(previous.layout.pages[adoption.startPageIndex]);
    expect(incremental.layout.pages[adoption.startPageIndex]!.fragments[0]!.pmStart).toBe(
      previous.layout.pages[adoption.startPageIndex]!.fragments[0]!.pmStart! + 1,
    );
    const adoptedP7 = incremental.layout.pages
      .flatMap((page) => page.fragments)
      .find((fragment) => fragment.blockId === 'p7');
    expect(adoptedP7?.sourceAnchor?.pmRange).toEqual({ from: 142, to: 148 });

    measureCache.clear();
    const full = await incrementalLayout([], null, nextBlocks, options, measureBlock);
    expect(geometry(incremental.layout)).toEqual(geometry(full.layout));
    expect(json(incremental.layout)).toEqual(json(full.layout));
  });

  it('reuses a same-index tail when the section uses non-decimal page numbering', async () => {
    const numberedOptions = {
      ...options,
      sectionMetadata: [{ sectionIndex: 0, numbering: { start: 1, format: 'upperRoman' as const } }],
    };
    const previousBlocks = documentBlocks(14);
    const measureBlock = vi.fn(async (block: FlowBlock) => measureFor(block));
    const previous = await incrementalLayout([], null, previousBlocks, numberedOptions, measureBlock);
    const nextBlocks = replaceParagraphText(previousBlocks, 6, 'text-6!');

    const incremental = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      numberedOptions,
      measureBlock,
      undefined,
      previous.measures,
      undefined,
      undefined,
      {
        ...provedReuse(previousBlocks, nextBlocks, previous.layout),
        pmShift: { atChar: previousBlocks[6]!.runs[0]!.pmEnd!, delta: 1 },
      },
    );

    expect(incremental.layoutReuse).toMatchObject({
      mode: 'tail-splice',
      reason: 'm4-affected-frontier-converged-tail-adopted',
      tailAdoption: { pageIndexDelta: 0, pageReferenceLocationsStable: true },
    });

    measureCache.clear();
    const full = await incrementalLayout([], null, nextBlocks, numberedOptions, measureBlock);
    expect(incremental.layout.pages.map((page) => page.numberText)).toEqual(
      full.layout.pages.map((page) => page.numberText),
    );
    expect(incremental.layout.pages.map((page) => page.pageNumberFormat)).toEqual(
      full.layout.pages.map((page) => page.pageNumberFormat),
    );
    expect(json(incremental.layout)).toEqual(json(full.layout));
  });

  it.each(['chapter-numbering', 'missing-display-number', 'changed-display-number'] as const)(
    'does not certify unchanged PAGEREF locations for %s',
    async (caseName) => {
      const numberedOptions = {
        ...options,
        sectionMetadata: [
          {
            sectionIndex: 0,
            numbering: {
              start: 1,
              format: 'upperRoman' as const,
              ...(caseName === 'chapter-numbering' ? { chapterStyle: 1 } : {}),
            },
          },
        ],
      };
      const previousBlocks = documentBlocks(14);
      const measureBlock = async (block: FlowBlock) => measureFor(block);
      const previous = await incrementalLayout([], null, previousBlocks, numberedOptions, measureBlock);
      // Exercise incomplete or differing retained metadata at the actual producer boundary.
      if (caseName !== 'chapter-numbering') {
        const dirtyPage = blockPageIndex(previous.layout).get('p6')!.lastPage;
        for (const page of previous.layout.pages.slice(dirtyPage + 1)) {
          if (caseName === 'missing-display-number') delete page.displayNumber;
          else page.displayNumber = (page.displayNumber ?? page.number) + 10;
        }
      }
      const nextBlocks = replaceParagraphText(previousBlocks, 6, 'text-6!');
      const incremental = await incrementalLayout(
        previousBlocks,
        previous.layout,
        nextBlocks,
        numberedOptions,
        measureBlock,
        undefined,
        previous.measures,
        undefined,
        undefined,
        {
          ...provedReuse(previousBlocks, nextBlocks, previous.layout),
          pmShift: { atChar: previousBlocks[6]!.runs[0]!.pmEnd!, delta: 1 },
        },
      );
      expect(incremental.layoutReuse?.tailAdoption?.pageReferenceLocationsStable ?? false).toBe(false);
      if (caseName !== 'chapter-numbering') expect(incremental.layoutReuse?.mode).toBe('tail-splice');
    },
  );

  it('supports a page-zero edit and adopts only the proved tail', async () => {
    const previousBlocks = documentBlocks(8);
    const measureBlock = vi.fn(async (block: FlowBlock) => measureFor(block));
    const previous = await incrementalLayout([], null, previousBlocks, options, measureBlock);
    const nextBlocks = replaceParagraphText(previousBlocks, 0, 'text-0!');

    const incremental = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      options,
      measureBlock,
      undefined,
      previous.measures,
      undefined,
      undefined,
      {
        ...provedReuse(previousBlocks, nextBlocks, previous.layout),
        previousPageStartKeys: previous.layout.pages.map(pageStartKey),
        previousBlockPageIndex: blockPageIndex(previous.layout),
        requireDocumentStartCheckpoint: true,
        pmShift: { atChar: 1 + 'text-0'.length, delta: 1 },
        dirtyBlockIds: ['p0'],
      },
    );

    expect(incremental.layoutReuse).toMatchObject({
      mode: 'tail-splice',
      checkpointPageIndex: 0,
      affectedFrontierPageIndex: 0,
      convergencePageIndex: 1,
    });
    expect(incremental.layoutReuse!.tailAdoption!.startPageIndex).toBe(1);
  });

  it('falls back to the canonical full layout when the bounded probe cannot prove convergence', async () => {
    const beforeBreak = documentBlocks(16);
    const afterBreak = Array.from({ length: 16 }, (_, offset) => {
      const index = beforeBreak.length + offset;
      return paragraph(`p${index}`, `text-${index}`, 1 + index * 20);
    });
    const sectionBreak: FlowBlock = {
      kind: 'sectionBreak',
      id: 'section-break-1',
      type: 'nextPage',
      margins: {},
      attrs: { sectionIndex: 1 },
    };
    const previousBlocks: FlowBlock[] = [...beforeBreak, sectionBreak, ...afterBreak];
    const previousMeasure = vi.fn(async (block: FlowBlock) => measureFor(block));
    const previous = await incrementalLayout([], null, previousBlocks, options, previousMeasure);
    const nextBlocks = previousBlocks.map((block) => {
      if (block.kind === 'sectionBreak') return block;
      const run = block.runs[0]!;
      return paragraph(
        block.id,
        block.id === 'p0' ? `${run.text}!` : run.text,
        run.pmStart! + (block.id === 'p0' ? 0 : 1),
      );
    });
    const nextMeasure = vi.fn(async (block: FlowBlock) =>
      block.id === 'p0' ? measureWithLines(block, 2) : measureFor(block),
    );
    const baseReuse = provedReuse(previousBlocks, nextBlocks, previous.layout);
    const provedDirtyRegion = {
      firstDirtyIndex: 0,
      lastStableIndex: -1,
      insertedBlockIds: [],
      deletedBlockIds: [],
      changedBlockIds: ['p0'],
      stableBlockIds: new Set(nextBlocks.slice(1).map((block) => block.id)),
    };

    const incremental = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      options,
      nextMeasure,
      undefined,
      previous.measures,
      undefined,
      undefined,
      {
        ...baseReuse,
        provedDirtyRegion,
        dependencyProof: {
          profile: 'page-checkpoint-local-text',
          blockIdsUnchanged: true,
          blockIdsUnique: true,
          globalDependenciesAbsent: false,
          globalDependenciesFencedByPageCheckpoint: true,
          admittedDependencyClasses: ['multiple-sections'],
          renderInputsUnchanged: true,
          pageReferencesAbsent: true,
          multiColumnSectionsProvedNonBalanceable: true,
        },
        maxRelaidPages: 1,
        pmShift: { atChar: beforeBreak[0]!.runs[0]!.pmEnd!, delta: 1 },
        dirtyBlockIds: ['p0'],
      },
    );

    expect(incremental.layoutReuse).toMatchObject({
      mode: 'full',
      reason: expect.stringContaining('m4-layout-reuse-bounded-convergence-not-proved'),
      tailDisposition: 'none',
      convergencePageIndex: null,
      pagesSplicedByReuse: 0,
    });
    measureCache.clear();
    const full = await incrementalLayout([], null, nextBlocks, options, nextMeasure);
    expect(paginationGeometry(incremental.layout)).toEqual(paginationGeometry(full.layout));
    expect(json(incremental.layout)).toEqual(json(full.layout));
  });

  it('admits a page-zero MID-PAGE partial checkpoint (suffix resolves by block id, not document start)', async () => {
    // Plan 09 admission regression: a partial (mid-page) checkpoint ON PAGE
    // ZERO resumes at the checkpoint's own paragraph boundary. The former
    // `checkpointPageIndex === 0 → suffix index 0` shortcut assumed every
    // page-zero checkpoint was a document-start checkpoint and mislabeled
    // this class `current-block-index-stale`, falling to full layout on
    // every keystroke (observed on real first-page targets).
    const previousBlocks = documentBlocks(8);
    const measureBlock = vi.fn(async (block: FlowBlock) => measureFor(block));
    const previous = await incrementalLayout([], null, previousBlocks, options, measureBlock);
    const dirtyIndex = 1; // mid page zero, a stable paragraph before it
    const nextBlocks = replaceParagraphText(previousBlocks, dirtyIndex, `text-${dirtyIndex}!`);

    const incremental = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      options,
      measureBlock,
      undefined,
      previous.measures,
      undefined,
      undefined,
      {
        ...provedReuse(previousBlocks, nextBlocks, previous.layout),
        previousPageStartKeys: previous.layout.pages.map(pageStartKey),
        previousBlockPageIndex: blockPageIndex(previous.layout),
        pmShift: { atChar: 1 + `text-${dirtyIndex}`.length, delta: 1 },
        dirtyBlockIds: [`p${dirtyIndex}`],
      },
    );

    const reuse = incremental.layoutReuse as { mode?: string; reason?: string };
    expect(reuse.reason ?? '').not.toMatch(/current-block-index-stale/);
    expect(incremental.layoutReuse).toMatchObject({
      mode: 'tail-splice',
      checkpointPageIndex: 0,
    });

    measureCache.clear();
    const full = await incrementalLayout([], null, nextBlocks, options, measureBlock);
    expect(paginationGeometry(incremental.layout)).toEqual(paginationGeometry(full.layout));
    expect(json(incremental.layout)).toEqual(json(full.layout));
  });

  it('carries leading-section geometry into a page-zero partial checkpoint', async () => {
    // The resumed suffix starts at p1 and therefore does not replay the
    // leading section carrier. Its page-zero checkpoint must seed the exact
    // stamped geometry instead of falling back to the document defaults.
    const initialSection: FlowBlock = {
      kind: 'sectionBreak',
      id: 'initial-section',
      type: 'continuous',
      attrs: { isFirstSection: true, sectionIndex: 0 },
      pageSize: { w: 240, h: 140 },
      margins: { top: 20, right: 25, bottom: 20, left: 25, header: 6, footer: 7 },
      columns: { count: 1, gap: 0 },
    };
    const previousParagraphs = documentBlocks(10);
    const previousBlocks: FlowBlock[] = [initialSection, ...previousParagraphs];
    const nextParagraphs = replaceParagraphText(previousParagraphs, 1, 'text-1!');
    const nextBlocks: FlowBlock[] = [initialSection, ...nextParagraphs];
    const measureBlock = vi.fn(async (block: FlowBlock) => measureFor(block));
    const previous = await incrementalLayout([], null, previousBlocks, options, measureBlock);
    const provedDirtyRegion = {
      firstDirtyIndex: 2,
      lastStableIndex: 1,
      insertedBlockIds: [],
      deletedBlockIds: [],
      changedBlockIds: ['p1'],
      stableBlockIds: new Set(nextBlocks.filter((block) => block.id !== 'p1').map((block) => block.id)),
    };

    expect(previous.layout.pages[0]?.margins).toMatchObject({
      top: 20,
      right: 25,
      bottom: 20,
      left: 25,
      header: 6,
      footer: 7,
    });

    const incremental = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      options,
      measureBlock,
      undefined,
      previous.measures,
      undefined,
      undefined,
      {
        ...provedReuse(previousBlocks, nextBlocks, previous.layout),
        provedDirtyRegion,
        dependencyProof: {
          profile: 'page-checkpoint-local-text',
          blockIdsUnchanged: true,
          blockIdsUnique: true,
          globalDependenciesAbsent: false,
          globalDependenciesFencedByPageCheckpoint: true,
          admittedDependencyClasses: ['multiple-sections'],
          renderInputsUnchanged: true,
          pageReferencesAbsent: true,
          multiColumnSectionsProvedNonBalanceable: true,
        },
        dirtyBlockIds: ['p1'],
        pmShift: { atChar: 1 + 20 + 'text-1'.length, delta: 1 },
      },
    );

    expect(incremental.layoutReuse?.mode, incremental.layoutReuse?.reason).toBe('tail-splice');
    expect(incremental.layoutReuse?.checkpointPageIndex).toBe(0);
    measureCache.clear();
    const cold = await incrementalLayout([], null, nextBlocks, options, measureBlock);
    expect(paginationGeometry(incremental.layout)).toEqual(paginationGeometry(cold.layout));
    expect(json(incremental.layout)).toEqual(json(cold.layout));
  });

  it('replays the leading section carrier from a required document-start checkpoint', async () => {
    const initialSection: FlowBlock = {
      kind: 'sectionBreak',
      id: 'initial-section',
      type: 'continuous',
      attrs: { isFirstSection: true, sectionIndex: 0 },
      pageSize: { w: 240, h: 140 },
      margins: { top: 20, right: 25, bottom: 20, left: 25, header: 6, footer: 7 },
      columns: { count: 1, gap: 0 },
    };
    const previousParagraphs = documentBlocks(10);
    const previousBlocks: FlowBlock[] = [initialSection, ...previousParagraphs];
    const nextParagraphs = replaceParagraphText(previousParagraphs, 1, 'text-1!');
    const nextBlocks: FlowBlock[] = [initialSection, ...nextParagraphs];
    const measureBlock = vi.fn(async (block: FlowBlock) => measureFor(block));
    const previous = await incrementalLayout([], null, previousBlocks, options, measureBlock);
    const provedDirtyRegion = {
      firstDirtyIndex: 2,
      lastStableIndex: 1,
      insertedBlockIds: [],
      deletedBlockIds: [],
      changedBlockIds: ['p1'],
      stableBlockIds: new Set(nextBlocks.filter((block) => block.id !== 'p1').map((block) => block.id)),
    };

    const incremental = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      options,
      measureBlock,
      undefined,
      previous.measures,
      undefined,
      undefined,
      {
        ...provedReuse(previousBlocks, nextBlocks, previous.layout),
        provedDirtyRegion,
        dirtyBlockIds: ['p1'],
        requireDocumentStartCheckpoint: true,
        pmShift: { atChar: 1 + 20 + 'text-1'.length, delta: 1 },
      },
    );

    expect(incremental.layoutReuse?.mode, incremental.layoutReuse?.reason).toBe('tail-splice');
    expect(incremental.layoutReuse?.checkpointPageIndex).toBe(0);
    measureCache.clear();
    const cold = await incrementalLayout([], null, nextBlocks, options, measureBlock);
    expect(paginationGeometry(incremental.layout)).toEqual(paginationGeometry(cold.layout));
    expect(json(incremental.layout)).toEqual(json(cold.layout));
  });

  it('bounds a direct start-key lookup when the retained lazy index cannot resolve the candidate', async () => {
    const previousBlocks = documentBlocks(8);
    const measureBlock = vi.fn(async (block: FlowBlock) => measureFor(block));
    const previous = await incrementalLayout([], null, previousBlocks, options, measureBlock);
    const dirtyIndex = 1;
    const nextBlocks = replaceParagraphText(previousBlocks, dirtyIndex, `text-${dirtyIndex}!`);

    const incremental = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      options,
      measureBlock,
      undefined,
      previous.measures,
      undefined,
      undefined,
      {
        ...provedReuse(previousBlocks, nextBlocks, previous.layout),
        // A retained lazy index can miss when its block→page sidecar only
        // covers the materialized window. The complete lazy key plane remains
        // authoritative inside the bounded convergence window.
        previousPageStartKeyIndex: new Map(),
        pmShift: { atChar: 1 + `text-${dirtyIndex}`.length, delta: 1 },
        dirtyBlockIds: [`p${dirtyIndex}`],
      },
    );

    expect(incremental.layoutReuse).toMatchObject({
      mode: 'tail-splice',
      checkpointPageIndex: 0,
    });
    measureCache.clear();
    const full = await incrementalLayout([], null, nextBlocks, options, measureBlock);
    expect(paginationGeometry(incremental.layout)).toEqual(paginationGeometry(full.layout));
  });

  it('admits stable dependency-rich text only from the required document-start checkpoint', async () => {
    const previousBlocks = documentBlocks(10);
    const measureBlock = vi.fn(async (block: FlowBlock) => measureFor(block));
    const multiSectionOptions = {
      ...options,
      sectionMetadata: Array.from({ length: 9 }, (_, sectionIndex) => ({
        sectionIndex,
        numbering: { start: 1, format: 'decimal' as const },
      })),
    };
    const previous = await incrementalLayout([], null, previousBlocks, multiSectionOptions, measureBlock);
    const nextBlocks = replaceParagraphText(previousBlocks, 0, 'text-0!');
    const reuse = {
      ...provedReuse(previousBlocks, nextBlocks, previous.layout),
      dependencyProof: {
        profile: 'document-start-local-text' as const,
        blockIdsUnchanged: true as const,
        blockIdsUnique: true as const,
        globalDependenciesAbsent: false as const,
        globalDependenciesFencedByDocumentStart: true as const,
        multiColumnSectionsProvedNonBalanceable: true as const,
        renderInputsUnchanged: true as const,
        pageReferencesAbsent: true as const,
      },
      // Zero is the measuring contract's exact unbounded-height constraint.
      provedDirtyMeasureConstraints: new Map([['p0', { maxWidth: 180, maxHeight: 0 }]]),
      pmShift: { atChar: 1 + 'text-0'.length, delta: 1 },
      dirtyBlockIds: ['p0'],
    };

    const missingCheckpoint = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      multiSectionOptions,
      measureBlock,
      undefined,
      previous.measures,
      undefined,
      undefined,
      reuse,
    );
    expect(missingCheckpoint.layoutReuse).toMatchObject({
      mode: 'full',
      reason: 'm4-layout-reuse-disabled-document-start-checkpoint-required',
    });

    const missingFence = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      multiSectionOptions,
      measureBlock,
      undefined,
      previous.measures,
      undefined,
      undefined,
      {
        ...reuse,
        requireDocumentStartCheckpoint: true,
        dependencyProof: {
          ...reuse.dependencyProof,
          globalDependenciesFencedByDocumentStart: false,
        } as unknown as typeof reuse.dependencyProof,
      },
    );
    expect(missingFence.layoutReuse).toMatchObject({
      mode: 'full',
      reason: 'm4-layout-reuse-disabled-dependency-proof-invalid',
    });

    const missingBalancingProof = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      multiSectionOptions,
      measureBlock,
      undefined,
      previous.measures,
      undefined,
      undefined,
      {
        ...reuse,
        requireDocumentStartCheckpoint: true,
        dependencyProof: {
          ...reuse.dependencyProof,
          multiColumnSectionsProvedNonBalanceable: undefined,
        } as unknown as typeof reuse.dependencyProof,
      },
    );
    expect(missingBalancingProof.layoutReuse).toMatchObject({
      mode: 'full',
      reason: 'm4-layout-reuse-disabled-dependency-proof-invalid',
    });

    const incremental = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      multiSectionOptions,
      measureBlock,
      undefined,
      previous.measures,
      undefined,
      undefined,
      { ...reuse, requireDocumentStartCheckpoint: true },
    );
    expect(incremental.layoutReuse).toMatchObject({
      mode: 'tail-splice',
      checkpointPageIndex: 0,
      affectedFrontierPageIndex: 0,
    });
    measureCache.clear();
    const full = await incrementalLayout([], null, nextBlocks, multiSectionOptions, measureBlock);
    expect(json(incremental.layout)).toEqual(json(full.layout));
  });

  it('replays through a balanced multi-column section before adopting its stable tail', async () => {
    const sectionStart: FlowBlock = {
      kind: 'sectionBreak',
      id: 'section-start',
      type: 'continuous',
      columns: { count: 2, gap: 10 },
      margins: {},
      attrs: { source: 'sectPr', sectionIndex: 0, isFirstSection: true },
    };
    const balancedParagraphs = Array.from({ length: 24 }, (_, index) => ({
      ...paragraph(`p${index}`, `text-${index}`, 1 + index * 20),
      attrs: { sectionIndex: 0 },
    }));
    const sectionEnd: FlowBlock = {
      kind: 'sectionBreak',
      id: 'section-end',
      type: 'continuous',
      columns: { count: 1, gap: 0 },
      margins: {},
      attrs: { source: 'sectPr', sectionIndex: 1 },
    };
    const tailParagraphs = Array.from({ length: 10 }, (_, offset) => {
      const index = balancedParagraphs.length + offset;
      return {
        ...paragraph(`p${index}`, `text-${index}`, 1 + index * 20),
        attrs: { sectionIndex: 1 },
      };
    });
    const previousBlocks: FlowBlock[] = [sectionStart, ...balancedParagraphs, sectionEnd, ...tailParagraphs];
    const nextBlocks = previousBlocks.map((block) =>
      block.kind === 'paragraph' && block.id === 'p2'
        ? { ...block, runs: [{ ...block.runs[0]!, text: 'text-2!' }] }
        : block,
    );
    const measureBlock = vi.fn(async (block: FlowBlock) => {
      if (block.kind !== 'paragraph') throw new Error(`Unexpected block kind ${block.kind}`);
      return measureWithLines(block, 1);
    });
    const previous = await incrementalLayout([], null, previousBlocks, options, measureBlock);
    const boundaryBlockId = 'p23';
    const boundaryPages = blockPageIndex(previous.layout).get(boundaryBlockId)!;
    expect(boundaryPages.lastPage).toBeGreaterThan(3);
    const baseReuse = provedReuse(previousBlocks, nextBlocks, previous.layout);
    const dirtyBlockIndex = nextBlocks.findIndex((block) => block.id === 'p2');
    const provedDirtyRegion = {
      firstDirtyIndex: dirtyBlockIndex,
      lastStableIndex: dirtyBlockIndex - 1,
      insertedBlockIds: [],
      deletedBlockIds: [],
      changedBlockIds: ['p2'],
      stableBlockIds: new Set(nextBlocks.map((block) => block.id).filter((blockId) => blockId !== 'p2')),
    };
    const incremental = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      options,
      measureBlock,
      undefined,
      previous.measures,
      undefined,
      undefined,
      {
        ...baseReuse,
        provedDirtyRegion,
        dirtyBlockIds: ['p2'],
        maxRelaidPages: 4,
        requireDocumentStartCheckpoint: true,
        pmShift: { atChar: 1 + 2 * 20 + 'text-2'.length, delta: 1 },
        dependencyProof: {
          profile: 'page-checkpoint-local-text',
          blockIdsUnchanged: true,
          blockIdsUnique: true,
          globalDependenciesAbsent: false,
          globalDependenciesFencedByPageCheckpoint: true,
          admittedDependencyClasses: ['multiple-sections', 'non-balanceable-multi-column-sections'],
          multiColumnSectionsProvedNonBalanceable: false,
          balanceableSectionsBoundaryBlockId: boundaryBlockId,
          renderInputsUnchanged: true,
          pageReferencesAbsent: true,
        },
      },
    );

    expect(incremental.layoutReuse, incremental.layoutReuse?.reason).toMatchObject({
      mode: 'tail-splice',
      checkpointPageIndex: 0,
      tailDisposition: 'adopted-source-tail',
    });
    expect(incremental.layoutReuse?.sourceConvergencePageIndex).toBeGreaterThan(boundaryPages.lastPage);
    expect(incremental.layoutReuse?.pagesPaginated).toBeLessThan(previous.layout.pages.length);
    measureCache.clear();
    const full = await incrementalLayout([], null, nextBlocks, options, measureBlock);
    expect(paginationGeometry(incremental.layout)).toEqual(paginationGeometry(full.layout));
  });

  it('retains an exact zero-delta tail across a later decimal numbering restart', async () => {
    const before = documentBlocks(8);
    const sectionBreak: FlowBlock = {
      kind: 'sectionBreak',
      id: 's1',
      type: 'nextPage',
      margins: { top: 10, right: 10, bottom: 10, left: 10 },
      numbering: { start: 1, format: 'decimal' },
      attrs: { sectionIndex: 1 },
    };
    const after = Array.from({ length: 8 }, (_, index) => paragraph(`q${index}`, `tail-${index}`, 500 + index * 20));
    const previousBlocks: FlowBlock[] = [...before, sectionBreak, ...after];
    const nextBlocks: FlowBlock[] = previousBlocks.map((block, index) => {
      if (block.kind !== 'paragraph') return block;
      const run = block.runs[0]!;
      return paragraph(block.id, block.id === 'p0' ? `${run.text}!` : run.text, run.pmStart! + (index > 0 ? 1 : 0));
    });
    const restartedOptions = {
      ...options,
      sectionMetadata: [
        { sectionIndex: 0, numbering: { start: 1, format: 'decimal' as const } },
        { sectionIndex: 1, numbering: { start: 1, format: 'decimal' as const } },
      ],
    };
    const measureBlock = vi.fn(async (block: FlowBlock) => measureFor(block));
    const previous = await incrementalLayout([], null, previousBlocks, restartedOptions, measureBlock);
    const baseReuse = provedReuse(previousBlocks, nextBlocks, previous.layout);
    const provedDirtyRegion = {
      firstDirtyIndex: 0,
      lastStableIndex: -1,
      insertedBlockIds: [],
      deletedBlockIds: [],
      changedBlockIds: ['p0'],
      stableBlockIds: new Set(nextBlocks.slice(1).map((block) => block.id)),
    };
    const incremental = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      restartedOptions,
      measureBlock,
      undefined,
      previous.measures,
      undefined,
      undefined,
      {
        ...baseReuse,
        provedDirtyRegion,
        dependencyProof: {
          profile: 'document-start-local-text' as const,
          blockIdsUnchanged: true as const,
          blockIdsUnique: true as const,
          globalDependenciesAbsent: false as const,
          globalDependenciesFencedByDocumentStart: true as const,
          multiColumnSectionsProvedNonBalanceable: true as const,
          renderInputsUnchanged: true as const,
          pageReferencesAbsent: true as const,
        },
        provedDirtyMeasureConstraints: new Map([['p0', { maxWidth: 180, maxHeight: 80 }]]),
        requireDocumentStartCheckpoint: true,
        pmShift: { atChar: before[0]!.runs[0]!.pmEnd!, delta: 1 },
        dirtyBlockIds: ['p0'],
      },
    );
    expect(incremental.layoutReuse).toMatchObject({
      mode: 'tail-splice',
      tailAdoption: { pageIndexDelta: 0 },
    });
    measureCache.clear();
    const full = await incrementalLayout([], null, nextBlocks, restartedOptions, measureBlock);
    expect(incremental.layout.pages.some((page) => page.sectionIndex === 1 && page.displayNumber === 1)).toBe(true);
    expect(json(incremental.layout)).toEqual(json(full.layout));
  });

  it('rejects a start-key match when page-start geometry differs', async () => {
    const previousBlocks = documentBlocks(12);
    const measureBlock = vi.fn(async (block: FlowBlock) => measureFor(block));
    const previous = await incrementalLayout([], null, previousBlocks, options, measureBlock);
    const retainedLayout: Layout = {
      ...previous.layout,
      pages: previous.layout.pages.map((page, pageIndex) =>
        pageIndex === 1 ? { ...page, margins: { ...page.margins, top: (page.margins?.top ?? 0) + 1 } } : page,
      ),
    };
    const nextBlocks = replaceParagraphText(previousBlocks, 0, 'text-0!');

    const incremental = await incrementalLayout(
      previousBlocks,
      retainedLayout,
      nextBlocks,
      options,
      measureBlock,
      undefined,
      previous.measures,
      undefined,
      undefined,
      {
        ...provedReuse(previousBlocks, nextBlocks, retainedLayout),
        previousPageStartKeys: retainedLayout.pages.map(pageStartKey),
        previousBlockPageIndex: blockPageIndex(retainedLayout),
        requireDocumentStartCheckpoint: true,
        pmShift: { atChar: 1 + 'text-0'.length, delta: 1 },
        dirtyBlockIds: ['p0'],
      },
    );

    expect(incremental.layoutReuse).toMatchObject({
      mode: 'tail-splice',
      affectedFrontierPageIndex: 0,
      convergencePageIndex: 2,
    });
    expect(incremental.layout.pages[1]!.margins?.top).toBe(options.margins.top);
  });

  it('finds a unique shifted convergence boundary when wrapping adds a page', async () => {
    const previousBlocks = documentBlocks(14);
    const previousMeasure = vi.fn(async (block: FlowBlock) => measureFor(block));
    const previous = await incrementalLayout([], null, previousBlocks, options, previousMeasure);
    const nextBlocks = replaceParagraphText(previousBlocks, 0, 'text-0-expanded-over-three-lines');
    const nextMeasure = vi.fn(async (block: FlowBlock) =>
      block.id === 'p0' ? measureWithLines(block, 3) : measureFor(block),
    );

    const incremental = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      options,
      nextMeasure,
      undefined,
      previous.measures,
      undefined,
      undefined,
      {
        ...provedReuse(previousBlocks, nextBlocks, previous.layout),
        previousPageStartKeys: previous.layout.pages.map(pageStartKey),
        previousBlockPageIndex: blockPageIndex(previous.layout),
        previousPageStartKeyIndex: pageStartKeyIndex(previous.layout),
        requireDocumentStartCheckpoint: true,
        pmShift: { atChar: previousBlocks[0]!.runs[0]!.pmEnd!, delta: 26 },
        dirtyBlockIds: ['p0'],
      },
    );

    expect(incremental.layoutReuse).toMatchObject({
      mode: 'tail-splice',
      convergencePageIndex: 2,
      sourceConvergencePageIndex: 1,
      tailAdoption: {
        startPageIndex: 2,
        sourcePageStartIndex: 1,
        pageIndexDelta: 1,
        sectionPageNumberTransform: { sectionIndex: 0, delta: 1 },
      },
    });
    expect(incremental.layout.pages).toHaveLength(previous.layout.pages.length + 1);
    expect(incremental.layout.pages[2]).not.toBe(previous.layout.pages[1]);
    expect(incremental.layout.pages[2]!.number).toBe(3);
    measureCache.clear();
    const full = await incrementalLayout([], null, nextBlocks, options, nextMeasure);
    expect(paginationGeometry(incremental.layout)).toEqual(paginationGeometry(full.layout));
    expect(incremental.layout.pages.map((page) => page.sectionPageNumber)).toEqual(
      full.layout.pages.map((page) => page.sectionPageNumber),
    );
    expect(json(incremental.layout)).toEqual(json(full.layout));
  });

  it('rebases only the convergence section when a shifted tail crosses a later section', async () => {
    const before = documentBlocks(8);
    const sectionBreak: FlowBlock = {
      kind: 'sectionBreak',
      id: 's1',
      type: 'nextPage',
      margins: { top: 10, right: 10, bottom: 10, left: 10 },
      numbering: { format: 'decimal' },
      attrs: { sectionIndex: 1 },
    };
    const after = Array.from({ length: 8 }, (_, index) => paragraph(`q${index}`, `tail-${index}`, 500 + index * 20));
    const previousBlocks: FlowBlock[] = [...before, sectionBreak, ...after];
    const expandedText = 'text-0-expanded-over-three-lines';
    const pmDelta = expandedText.length - before[0]!.runs[0]!.text.length;
    const nextBefore = replaceParagraphText(before, 0, expandedText);
    const nextAfter = after.map((block) => paragraph(block.id, block.runs[0]!.text, block.runs[0]!.pmStart! + pmDelta));
    const nextBlocks: FlowBlock[] = [...nextBefore, sectionBreak, ...nextAfter];
    const continuousOptions = {
      ...options,
      sectionMetadata: [
        { sectionIndex: 0, numbering: { format: 'decimal' as const } },
        { sectionIndex: 1, numbering: { format: 'decimal' as const } },
      ],
    };
    const previousMeasure = vi.fn(async (block: FlowBlock) => measureFor(block));
    const previous = await incrementalLayout([], null, previousBlocks, continuousOptions, previousMeasure);
    const nextMeasure = vi.fn(async (block: FlowBlock) =>
      block.id === 'p0' ? measureWithLines(block, 3) : measureFor(block),
    );
    const baseReuse = provedReuse(previousBlocks, nextBlocks, previous.layout);
    const provedDirtyRegion = {
      firstDirtyIndex: 0,
      lastStableIndex: -1,
      insertedBlockIds: [],
      deletedBlockIds: [],
      changedBlockIds: ['p0'],
      stableBlockIds: new Set(nextBlocks.slice(1).map((block) => block.id)),
    };
    const incremental = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      continuousOptions,
      nextMeasure,
      undefined,
      previous.measures,
      undefined,
      undefined,
      {
        ...baseReuse,
        provedDirtyRegion,
        dependencyProof: {
          profile: 'document-start-local-text' as const,
          blockIdsUnchanged: true as const,
          blockIdsUnique: true as const,
          globalDependenciesAbsent: false as const,
          globalDependenciesFencedByDocumentStart: true as const,
          multiColumnSectionsProvedNonBalanceable: true as const,
          renderInputsUnchanged: true as const,
          pageReferencesAbsent: true as const,
        },
        provedDirtyMeasureConstraints: new Map([['p0', { maxWidth: 180, maxHeight: 80 }]]),
        requireDocumentStartCheckpoint: true,
        pmShift: { atChar: before[0]!.runs[0]!.pmEnd!, delta: pmDelta },
        dirtyBlockIds: ['p0'],
      },
    );

    expect(incremental.layoutReuse).toMatchObject({
      mode: 'tail-splice',
      tailAdoption: {
        pageIndexDelta: 1,
        sectionPageNumberTransform: { sectionIndex: 0, delta: 1 },
      },
    });
    measureCache.clear();
    const full = await incrementalLayout([], null, nextBlocks, continuousOptions, nextMeasure);
    const incrementalSecondSection = incremental.layout.pages.filter((page) => page.sectionIndex === 1);
    expect(incrementalSecondSection[0]?.sectionPageNumber).toBe(1);
    expect(incrementalSecondSection.map((page) => page.sectionPageNumber)).toEqual(
      full.layout.pages.filter((page) => page.sectionIndex === 1).map((page) => page.sectionPageNumber),
    );
    expect(json(incremental.layout)).toEqual(json(full.layout));
  });

  it('adopts a shifted tail without rebasing display numbers after a later decimal restart', async () => {
    const terminalMarker: ParagraphBlock = {
      kind: 'paragraph',
      id: 'terminal-sectpr-marker',
      runs: [],
      attrs: { sectPrMarker: true },
    };
    const terminalSectionBreak: FlowBlock = {
      kind: 'sectionBreak',
      id: 'terminal-section-break',
      type: 'nextPage',
      margins: {},
      attrs: { sectionIndex: 1, source: 'sectPr' },
    };
    const previousBodyBlocks = documentBlocks(14);
    const previousBlocks: FlowBlock[] = [...previousBodyBlocks, terminalMarker, terminalSectionBreak];
    const previousMeasure = vi.fn(async (block: FlowBlock) => measureFor(block));
    const callerPageBoundary = vi.fn(() => false);
    const restartedOptions = {
      ...options,
      sectionMetadata: [
        { sectionIndex: 0, numbering: { start: 1, format: 'decimal' as const } },
        { sectionIndex: 1, numbering: { start: 1, format: 'decimal' as const } },
      ],
      pageBoundary: { shouldStopBeforeNewPage: callerPageBoundary },
    };
    const previous = await incrementalLayout([], null, previousBlocks, restartedOptions, previousMeasure);
    callerPageBoundary.mockClear();
    const nextBlocks = previousBlocks.map((block) => {
      if (block.kind !== 'paragraph' || block.runs.length === 0) return block;
      const run = block.runs[0]!;
      return paragraph(
        block.id,
        block.id === 'p0' ? 'text-0-expanded-over-three-lines' : run.text,
        run.pmStart! + (block.id === 'p0' ? 0 : 26),
      );
    });
    const nextMeasure = vi.fn(async (block: FlowBlock) =>
      block.id === 'p0' ? measureWithLines(block, 3) : measureFor(block),
    );
    const baseReuse = provedReuse(previousBlocks, nextBlocks, previous.layout);
    const incremental = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      restartedOptions,
      nextMeasure,
      undefined,
      previous.measures,
      undefined,
      undefined,
      {
        ...baseReuse,
        provedDirtyRegion: {
          firstDirtyIndex: 0,
          lastStableIndex: -1,
          insertedBlockIds: [],
          deletedBlockIds: [],
          changedBlockIds: ['p0'],
          stableBlockIds: new Set(nextBlocks.slice(1).map((block) => block.id)),
        },
        dependencyProof: {
          profile: 'document-start-local-text' as const,
          blockIdsUnchanged: true as const,
          blockIdsUnique: true as const,
          globalDependenciesAbsent: false as const,
          globalDependenciesFencedByDocumentStart: true as const,
          multiColumnSectionsProvedNonBalanceable: true as const,
          renderInputsUnchanged: true as const,
          pageReferencesAbsent: true as const,
        },
        provedDirtyMeasureConstraints: new Map([['p0', { maxWidth: 180, maxHeight: 80 }]]),
        requireDocumentStartCheckpoint: true,
        pmShift: { atChar: previousBodyBlocks[0]!.runs[0]!.pmEnd!, delta: 26 },
        dirtyBlockIds: ['p0'],
      },
    );

    expect(incremental.layoutReuse).toMatchObject({
      mode: 'tail-splice',
      reason: 'm4-affected-frontier-converged-tail-adopted',
      tailDisposition: 'adopted-source-tail',
      tailAdoption: {
        pageIndexDelta: 1,
        sectionPageNumberTransform: { sectionIndex: 0, delta: 1 },
        displayPageNumberTransform: {
          startSectionIndex: 0,
          endSectionIndexExclusive: 1,
          delta: 1,
        },
      },
    });
    expect(incremental.layoutReuse.pagesSplicedByReuse).toBeGreaterThan(0);
    expect(callerPageBoundary).not.toHaveBeenCalled();
    measureCache.clear();
    const full = await incrementalLayout([], null, nextBlocks, restartedOptions, nextMeasure);
    expect(paginationGeometry(incremental.layout)).toEqual(paginationGeometry(full.layout));
    expect(json(incremental.layout)).toEqual(json(full.layout));
  });

  it('reuses an unchanged page boundary with non-decimal section numbering', async () => {
    const previousBlocks = documentBlocks(14);
    const romanOptions = {
      ...options,
      sectionMetadata: [{ sectionIndex: 0, numbering: { start: 1, format: 'upperRoman' as const } }],
    };
    const measure = vi.fn(async (block: FlowBlock) => measureFor(block));
    const previous = await incrementalLayout([], null, previousBlocks, romanOptions, measure);
    const nextBlocks = replaceParagraphText(previousBlocks, 0, 'text-0x');
    const incremental = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      romanOptions,
      measure,
      undefined,
      previous.measures,
      undefined,
      undefined,
      {
        ...provedReuse(previousBlocks, nextBlocks, previous.layout),
        previousPageStartKeys: previous.layout.pages.map(pageStartKey),
        previousBlockPageIndex: blockPageIndex(previous.layout),
        previousPageStartKeyIndex: pageStartKeyIndex(previous.layout),
        requireDocumentStartCheckpoint: true,
        pmShift: { atChar: previousBlocks[0]!.runs[0]!.pmEnd!, delta: 1 },
        dirtyBlockIds: ['p0'],
      },
    );

    expect(incremental.layoutReuse.mode).toBe('tail-splice');
    measureCache.clear();
    const full = await incrementalLayout([], null, nextBlocks, romanOptions, measure);
    expect(json(incremental.layout)).toEqual(json(full.layout));
    expect(incremental.layout.pages[0]?.numberText).toBe('I');
  });

  it('recomputes non-decimal numbering when shifted tail adoption adds a page', async () => {
    const previousBlocks = documentBlocks(14);
    const romanOptions = {
      ...options,
      sectionMetadata: [{ sectionIndex: 0, numbering: { start: 1, format: 'upperRoman' as const } }],
    };
    const previousMeasure = vi.fn(async (block: FlowBlock) => measureFor(block));
    const previous = await incrementalLayout([], null, previousBlocks, romanOptions, previousMeasure);
    const nextBlocks = replaceParagraphText(previousBlocks, 0, 'text-0-expanded-over-three-lines');
    const nextMeasure = vi.fn(async (block: FlowBlock) =>
      block.id === 'p0' ? measureWithLines(block, 3) : measureFor(block),
    );
    const incremental = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      romanOptions,
      nextMeasure,
      undefined,
      previous.measures,
      undefined,
      undefined,
      {
        ...provedReuse(previousBlocks, nextBlocks, previous.layout),
        previousPageStartKeys: previous.layout.pages.map(pageStartKey),
        previousBlockPageIndex: blockPageIndex(previous.layout),
        previousPageStartKeyIndex: pageStartKeyIndex(previous.layout),
        requireDocumentStartCheckpoint: true,
        pmShift: { atChar: previousBlocks[0]!.runs[0]!.pmEnd!, delta: 26 },
        dirtyBlockIds: ['p0'],
      },
    );

    expect(incremental.layoutReuse).toMatchObject({
      mode: 'tail-splice',
      tailAdoption: {
        pageIndexDelta: 1,
        pageReferenceLocationsStable: false,
        sectionPageNumberTransform: { sectionIndex: 0, delta: 1 },
      },
    });
    measureCache.clear();
    const full = await incrementalLayout([], null, nextBlocks, romanOptions, nextMeasure);
    expect(json(incremental.layout)).toEqual(json(full.layout));
  });

  it('finds a unique shifted convergence boundary when wrapping removes a page', async () => {
    const nextBlocks = documentBlocks(14);
    const previousBlocks = replaceParagraphText(nextBlocks, 0, 'text-0-expanded-over-three-lines');
    const previousMeasure = vi.fn(async (block: FlowBlock) =>
      block.id === 'p0' ? measureWithLines(block, 3) : measureFor(block),
    );
    const previous = await incrementalLayout([], null, previousBlocks, options, previousMeasure);
    const nextMeasure = vi.fn(async (block: FlowBlock) => measureFor(block));

    const incremental = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      options,
      nextMeasure,
      undefined,
      previous.measures,
      undefined,
      undefined,
      {
        ...provedReuse(previousBlocks, nextBlocks, previous.layout),
        previousPageStartKeys: previous.layout.pages.map(pageStartKey),
        previousBlockPageIndex: blockPageIndex(previous.layout),
        previousPageStartKeyIndex: pageStartKeyIndex(previous.layout),
        requireDocumentStartCheckpoint: true,
        pmShift: { atChar: previousBlocks[0]!.runs[0]!.pmEnd!, delta: -26 },
        dirtyBlockIds: ['p0'],
      },
    );

    expect(incremental.layoutReuse).toMatchObject({
      mode: 'tail-splice',
      convergencePageIndex: 1,
      sourceConvergencePageIndex: 2,
      tailAdoption: {
        startPageIndex: 1,
        sourcePageStartIndex: 2,
        pageIndexDelta: -1,
        sectionPageNumberTransform: { sectionIndex: 0, delta: -1 },
      },
    });
    expect(incremental.layout.pages).toHaveLength(previous.layout.pages.length - 1);
    expect(incremental.layout.pages[1]).not.toBe(previous.layout.pages[2]);
    expect(incremental.layout.pages[1]!.number).toBe(2);
    measureCache.clear();
    const full = await incrementalLayout([], null, nextBlocks, options, nextMeasure);
    expect(paginationGeometry(incremental.layout)).toEqual(paginationGeometry(full.layout));
    expect(incremental.layout.pages.map((page) => page.sectionPageNumber)).toEqual(
      full.layout.pages.map((page) => page.sectionPageNumber),
    );
    expect(json(incremental.layout)).toEqual(json(full.layout));
  });

  it('fails page-reference dependencies onto the full canonical path', async () => {
    const previousBlocks = documentBlocks(8);
    previousBlocks[2] = paragraph('p2', '2', 41, 'pageReference');
    const measureBlock = vi.fn(async (block: FlowBlock) => measureFor(block));
    const previous = await incrementalLayout([], null, previousBlocks, options, measureBlock);
    const nextBlocks = previousBlocks.slice();
    nextBlocks[2] = paragraph('p2', '3', 41, 'pageReference');

    const result = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      options,
      measureBlock,
      undefined,
      previous.measures,
      undefined,
      undefined,
      {
        ...retainedMetadata(previous.layout),
        previousPageStartKeys: previous.layout.pages.map(pageStartKey),
        previousBlockPageIndex: blockPageIndex(previous.layout),
        dirtyBlockIds: ['p2'],
      },
    );

    expect(result.layoutReuse).toMatchObject({
      mode: 'full',
      reason: 'm4-layout-reuse-disabled-dependency-proof-missing',
      tailAdoption: null,
    });
  });

  it('falls back to the full oracle when a global render input changes without an atomic proof', async () => {
    const previousBlocks = documentBlocks(10);
    const measureBlock = vi.fn(async (block: FlowBlock) => measureFor(block));
    const previous = await incrementalLayout([], null, previousBlocks, options, measureBlock);
    const nextBlocks = replaceParagraphText(previousBlocks, 6, 'text-6!');
    const nextOptions = { ...options, margins: { ...options.margins, top: 20 } };

    const result = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      nextOptions,
      measureBlock,
      undefined,
      previous.measures,
      undefined,
      undefined,
      {
        ...retainedMetadata(previous.layout),
        previousPageStartKeys: previous.layout.pages.map(pageStartKey),
        previousBlockPageIndex: blockPageIndex(previous.layout),
        dirtyBlockIds: ['p6'],
      },
    );
    expect(result.layoutReuse).toMatchObject({
      mode: 'full',
      reason: 'm4-layout-reuse-disabled-dependency-proof-missing',
    });

    measureCache.clear();
    const full = await incrementalLayout([], null, nextBlocks, nextOptions, measureBlock);
    expect(json(result.layout)).toEqual(json(full.layout));
  });

  it('fails duplicate block identities closed', async () => {
    const previousBlocks = documentBlocks(10);
    previousBlocks[4] = paragraph('p3', 'duplicate-id', 81);
    const measureBlock = vi.fn(async (block: FlowBlock) => measureFor(block));
    const previous = await incrementalLayout([], null, previousBlocks, options, measureBlock);
    const nextBlocks = previousBlocks.slice();
    nextBlocks[3] = paragraph('p3', 'text-3!', 61);

    const result = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      options,
      measureBlock,
      undefined,
      previous.measures,
      undefined,
      undefined,
      {
        ...provedReuse(previousBlocks, nextBlocks, previous.layout),
        previousPageStartKeys: previous.layout.pages.map(pageStartKey),
        previousBlockPageIndex: blockPageIndex(previous.layout),
        dirtyBlockIds: ['p3'],
      },
    );

    expect(result.layoutReuse).toMatchObject({
      mode: 'full',
      reason: 'm4-layout-reuse-disabled-duplicate-block-id',
    });
  });

  it('fails a stale commit-envelope dirty identity closed before convergence', async () => {
    const previousBlocks = documentBlocks(12);
    const measureBlock = vi.fn(async (block: FlowBlock) => measureFor(block));
    const previous = await incrementalLayout([], null, previousBlocks, options, measureBlock);
    const nextBlocks = previousBlocks.slice();
    nextBlocks[6] = paragraph('p6', 'text-6!', 1 + 6 * 20);

    const result = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      options,
      measureBlock,
      undefined,
      previous.measures,
      undefined,
      undefined,
      {
        ...provedReuse(previousBlocks, nextBlocks, previous.layout),
        previousPageStartKeys: previous.layout.pages.map(pageStartKey),
        previousBlockPageIndex: blockPageIndex(previous.layout),
        requireDocumentStartCheckpoint: true,
        dirtyBlockIds: ['p0'],
      },
    );

    expect(result.layoutReuse).toMatchObject({
      mode: 'full',
      reason: 'm4-layout-reuse-disabled-dirty-block-set-mismatch',
    });
  });

  it('fails stale retained page and current-ordinal indexes closed with bounded checks', async () => {
    const previousBlocks = documentBlocks(12);
    const measureBlock = vi.fn(async (block: FlowBlock) => measureFor(block));
    const previous = await incrementalLayout([], null, previousBlocks, options, measureBlock);
    const nextBlocks = previousBlocks.slice();
    nextBlocks[6] = paragraph('p6', 'text-6!', 1 + 6 * 20);
    const previousIndex = blockPageIndex(previous.layout);
    previousIndex.set('p6', { firstPage: 0, lastPage: 0 });
    const common = {
      ...provedReuse(previousBlocks, nextBlocks, previous.layout),
      previousPageStartKeys: previous.layout.pages.map(pageStartKey),
      previousBlockPageIndex: previousIndex,
      dirtyBlockIds: ['p6'],
    };

    const stalePageRange = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      options,
      measureBlock,
      undefined,
      previous.measures,
      undefined,
      undefined,
      common,
    );
    expect(stalePageRange.layoutReuse).toMatchObject({
      mode: 'full',
      reason: 'm4-layout-reuse-disabled-stale-dirty-page-range',
    });

    const correctPreviousIndex = blockPageIndex(previous.layout);
    const staleCurrentIndex = new Map(nextBlocks.map((block, index) => [block.id, index]));
    staleCurrentIndex.set('p6', 7);
    const staleOrdinal = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      options,
      measureBlock,
      undefined,
      previous.measures,
      undefined,
      undefined,
      {
        ...common,
        previousBlockPageIndex: correctPreviousIndex,
        currentBlockIndexById: staleCurrentIndex,
      },
    );
    expect(staleOrdinal.layoutReuse).toMatchObject({ mode: 'full' });
    // The reason carries a named diagnostic detail (which identity diverged,
    // at which index) so admission failures are attributable from artifacts.
    expect((staleOrdinal.layoutReuse as { reason?: string }).reason).toMatch(
      /^m4-layout-reuse-disabled-current-block-index-stale:dirty=p6@7 saw=p7/,
    );
  });

  it('binds retained page metadata to the exact source layout epoch', async () => {
    const previousBlocks = documentBlocks(8);
    const measureBlock = vi.fn(async (block: FlowBlock) => measureFor(block));
    const previous = await incrementalLayout([], null, previousBlocks, options, measureBlock);
    const nextBlocks = replaceParagraphText(previousBlocks, 0, 'text-0!');
    const metadata = retainedMetadata(previous.layout, 41);

    const result = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      options,
      measureBlock,
      undefined,
      previous.measures,
      undefined,
      undefined,
      {
        ...metadata,
        retainedMetadataSourceLayoutEpoch: 40,
        previousPageStartKeys: previous.layout.pages.map(pageStartKey),
        previousBlockPageIndex: blockPageIndex(previous.layout),
        dirtyBlockIds: ['p0'],
      },
    );

    expect(result.layoutReuse).toMatchObject({
      mode: 'full',
      reason: 'm4-layout-reuse-disabled-retained-metadata-epoch-mismatch',
    });
  });

  it('uses retained dirty/index proofs and never falls back to warm-path document scans', async () => {
    const previousBlocks = documentBlocks(10);
    const measureBlock = vi.fn(async (block: FlowBlock) => measureFor(block));
    const previous = await incrementalLayout([], null, previousBlocks, options, measureBlock);
    const nextBlocks = replaceParagraphText(previousBlocks, 0, 'text-0!');
    const provedDirtyRegion = computeDirtyRegions(previousBlocks, nextBlocks);
    const commonReuse = {
      ...provedReuse(previousBlocks, nextBlocks, previous.layout),
      previousPageStartKeys: previous.layout.pages.map(pageStartKey),
      previousBlockPageIndex: blockPageIndex(previous.layout),
      requireDocumentStartCheckpoint: true,
      pmShift: { atChar: 1 + 'text-0'.length, delta: 1 },
      dirtyBlockIds: ['p0'],
      dependencyProof: {
        profile: 'single-section-local-text' as const,
        blockIdsUnchanged: true as const,
        blockIdsUnique: true as const,
        globalDependenciesAbsent: true as const,
        renderInputsUnchanged: true as const,
        pageReferencesAbsent: true as const,
      },
      provedDirtyRegion,
      currentBlockIndexById: null,
      previousPageStartKeyIndex: null,
    };

    const missingIndexes = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      options,
      measureBlock,
      undefined,
      previous.measures,
      undefined,
      undefined,
      commonReuse,
    );
    expect(missingIndexes.layoutReuse).toMatchObject({
      mode: 'full',
      reason: 'm4-layout-reuse-disabled-current-block-index-missing',
    });
    measureBlock.mockClear();
    measureBlock.mockImplementation(async (block: FlowBlock) => {
      if (block.id !== 'p0') throw new Error(`warm measure touched non-dirty block ${block.id}`);
      return measureFor(block);
    });

    const proved = await incrementalLayout(
      previousBlocks,
      previous.layout,
      nextBlocks,
      options,
      measureBlock,
      undefined,
      previous.measures,
      undefined,
      undefined,
      {
        ...commonReuse,
        currentBlockIndexById: new Map(nextBlocks.map((block, index) => [block.id, index])),
        previousPageStartKeyIndex: pageStartKeyIndex(previous.layout),
      },
    );
    expect(proved.layoutReuse).toMatchObject({ mode: 'tail-splice', convergencePageIndex: 1 });
    expect(proved.measureReuse).toEqual({
      mode: 'proved-dirty-only',
      blocksMeasured: 1,
      measuresAdopted: 9,
      reason: 'exact-envelope-dirty-measure-packet',
    });
    expect(measureBlock).toHaveBeenCalledTimes(1);

    measureBlock.mockClear();
    measureBlock.mockImplementation(async (block: FlowBlock) => {
      if (block.id !== 'p1') throw new Error(`second warm measure touched non-dirty block ${block.id}`);
      return measureFor(block);
    });
    const twiceBlocks = replaceParagraphText(nextBlocks, 1, 'text-1!');
    const twice = await incrementalLayout(
      nextBlocks,
      proved.layout,
      twiceBlocks,
      options,
      measureBlock,
      undefined,
      proved.measures,
      undefined,
      undefined,
      {
        ...provedReuse(nextBlocks, twiceBlocks, proved.layout),
        previousPageStartKeys: proved.layout.pages.map(pageStartKey),
        previousBlockPageIndex: blockPageIndex(proved.layout),
        previousPageStartKeyIndex: pageStartKeyIndex(proved.layout),
        requireDocumentStartCheckpoint: true,
        pmShift: { atChar: 1 + 20 + 'text-1'.length, delta: 1 },
        dirtyBlockIds: ['p1'],
      },
    );
    expect(twice.measureReuse).toMatchObject({
      mode: 'proved-dirty-only',
      blocksMeasured: 1,
      measuresAdopted: 9,
    });
    expect(measureBlock).toHaveBeenCalledTimes(1);
    expect(twice.measures[0]).toBe(proved.measures[0]);
    expect(twice.measures[9]).toBe(proved.measures[9]);
  });

  it('keeps the layout-layer dirty-only work bounded across 1,000 source-backed edit views', async () => {
    const authoritativeSourceBlocks = documentBlocks(1_000);
    let currentBlocks = sourceBackedEditView(authoritativeSourceBlocks, 0);
    const coldMeasure = vi.fn(async (block: FlowBlock) => measureFor(block));
    const cold = await incrementalLayout([], null, currentBlocks, options, coldMeasure);
    let currentLayout = cold.layout;
    let currentMeasures = cold.measures;
    currentLayout.layoutEpoch = 1;

    // Retained indexes are generation-stable for this same-length edit chain.
    // Building them here models the one cold snapshot; no warm call may scan
    // the 1,000-block tail to reconstruct them.
    const retainedPageStartKeys = currentLayout.pages.map(pageStartKey);
    const retainedBlockPageIndex = blockPageIndex(currentLayout);
    const retainedPageStartKeyIndex = pageStartKeyIndex(currentLayout);
    const retainedBlockIndex = new Map(currentBlocks.map((block, index) => [block.id, index]));
    const stableBlockIds = new Set(authoritativeSourceBlocks.slice(1).map((block) => block.id));
    const dependencyProof = {
      profile: 'single-section-local-text' as const,
      blockIdsUnchanged: true as const,
      blockIdsUnique: true as const,
      globalDependenciesAbsent: true as const,
      renderInputsUnchanged: true as const,
      pageReferencesAbsent: true as const,
    };
    const warmMeasure = vi.fn(async (block: FlowBlock) => {
      if (block.id !== 'p0') throw new Error(`warm measure touched non-dirty block ${block.id}`);
      return measureFor(block);
    });

    for (let edit = 0; edit < 1_000; edit += 1) {
      const insertionAt = currentBlocks[0]!.runs[0]!.pmEnd!;
      const nextBlocks = sourceBackedEditView(authoritativeSourceBlocks, edit + 1);
      const guardedNextBlocks = new Proxy(nextBlocks, {
        get(target, property, receiver) {
          if (typeof property === 'string' && /^(?:0|[1-9]\d*)$/.test(property) && Number(property) > 32) {
            throw new Error(`warm pagination scanned untouched block ${property}`);
          }
          return Reflect.get(target, property, receiver);
        },
      });
      const provedDirtyRegion = {
        firstDirtyIndex: 0,
        lastStableIndex: -1,
        insertedBlockIds: [],
        deletedBlockIds: [],
        changedBlockIds: ['p0'],
        stableBlockIds,
      };
      const epoch = edit + 1;
      const result = await incrementalLayout(
        currentBlocks,
        currentLayout,
        guardedNextBlocks,
        options,
        warmMeasure,
        undefined,
        currentMeasures,
        undefined,
        undefined,
        {
          previousLayout: currentLayout,
          retainedMetadataSourceLayoutEpoch: epoch,
          previousPageStartKeys: retainedPageStartKeys,
          previousBlockPageIndex: retainedBlockPageIndex,
          previousPageStartKeyIndex: retainedPageStartKeyIndex,
          currentBlockIndexById: retainedBlockIndex,
          dirtyBlockIds: ['p0'],
          dependencyProof,
          provedDirtyRegion,
          maxRelaidPages: 3,
          requireDocumentStartCheckpoint: true,
          pmShift: { atChar: insertionAt, delta: 1 },
        },
      );
      expect(result.layoutReuse).toMatchObject({ mode: 'tail-splice' });
      result.layout.layoutEpoch = epoch + 1;
      currentBlocks = nextBlocks;
      currentLayout = result.layout;
      currentMeasures = result.measures;
    }

    expect(warmMeasure).toHaveBeenCalledTimes(1_000);
    // A deep retained read after 1,000 generations must not recurse through
    // 1,000 proxy layers; the flattened page sequence reveals it directly.
    expect(currentLayout.pages.at(-1)?.fragments.at(-1)?.blockId).toBe('p999');

    measureCache.clear();
    const full = await incrementalLayout([], null, currentBlocks, options, coldMeasure);
    expect(paginationGeometry(currentLayout)).toEqual(paginationGeometry(full.layout));
    const tailBlock = currentBlocks.at(-1)!;
    const tailStart = tailBlock.runs[0]!.pmStart!;
    const tailEnd = tailBlock.runs[0]!.pmEnd!;
    const incrementalTailFragment = currentLayout.pages
      .at(-1)!
      .fragments.find((fragment) => fragment.blockId === tailBlock.id)!;
    const fullTailFragment = full.layout.pages.at(-1)!.fragments.find((fragment) => fragment.blockId === tailBlock.id)!;
    expect(incrementalTailFragment.pmStart).toBe(fullTailFragment.pmStart);
    expect(incrementalTailFragment.pmEnd).toBe(fullTailFragment.pmEnd);
    expect(selectionToRects(currentLayout, currentBlocks, currentMeasures, tailStart, tailEnd)).toEqual(
      selectionToRects(full.layout, currentBlocks, full.measures, tailStart, tailEnd),
    );
  });

  it('does not rescan the body to prepare retained footnote geometry for an exact edit', async () => {
    const authoritativeSourceBlocks = documentBlocks(256);
    const currentBlocks = sourceBackedEditView(authoritativeSourceBlocks, 0);
    const noteBlock = paragraph('footnote-1/0/paragraph/0', 'note body', 0);
    const footnoteOptions = {
      ...options,
      footnotes: {
        refs: [{ id: '1', blockId: 'p0', runOrdinal: 0, pos: 1 }],
        blocksById: new Map([['1', [noteBlock]]]),
      },
    };
    const coldMeasure = vi.fn(async (block: FlowBlock) => measureFor(block));
    const cold = await incrementalLayout([], null, currentBlocks, footnoteOptions, coldMeasure);
    expect(cold.footnoteReserveSeed).toBeTruthy();
    cold.layout.layoutEpoch = 1;

    const nextBlocks = sourceBackedEditView(authoritativeSourceBlocks, 1);
    const guardedNextBlocks = new Proxy(nextBlocks, {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^(?:0|[1-9]\d*)$/.test(property) && Number(property) > 32) {
          throw new Error(`warm footnote preparation scanned untouched block ${property}`);
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const stableBlockIds = new Set(authoritativeSourceBlocks.slice(1).map((block) => block.id));
    const provedDirtyRegion = {
      firstDirtyIndex: 0,
      lastStableIndex: -1,
      insertedBlockIds: [],
      deletedBlockIds: [],
      changedBlockIds: ['p0'],
      stableBlockIds,
    };
    const dependencyProof = {
      profile: 'page-checkpoint-local-text' as const,
      blockIdsUnchanged: true as const,
      blockIdsUnique: true as const,
      globalDependenciesAbsent: false as const,
      globalDependenciesFencedByPageCheckpoint: true as const,
      admittedDependencyClasses: ['footnotes'] as const,
      renderInputsUnchanged: true as const,
      pageReferencesAbsent: true as const,
      multiColumnSectionsProvedNonBalanceable: true as const,
    };
    const insertionAt = currentBlocks[0]!.runs[0]!.pmEnd!;
    const retainedBlockIndex = new Map(currentBlocks.map((block, index) => [block.id, index]));
    const warmMeasure = vi.fn(async (block: FlowBlock) => {
      if (block.id !== 'p0') throw new Error(`warm measure touched non-dirty block ${block.id}`);
      return measureFor(block);
    });
    const result = await incrementalLayout(
      currentBlocks,
      cold.layout,
      guardedNextBlocks,
      footnoteOptions,
      warmMeasure,
      undefined,
      cold.measures,
      undefined,
      {
        footnoteReserveSeed: cold.footnoteReserveSeed,
        noteMeasurePlaneRetainedExact: true,
      },
      {
        previousLayout: cold.layout,
        retainedMetadataSourceLayoutEpoch: 1,
        previousPageStartKeys: cold.layout.pages.map(pageStartKey),
        previousBlockPageIndex: blockPageIndex(cold.layout),
        previousPageStartKeyIndex: pageStartKeyIndex(cold.layout),
        previousBlockIndexById: retainedBlockIndex,
        currentBlockIndexById: retainedBlockIndex,
        dirtyBlockIds: ['p0'],
        provedDirtyMeasureConstraints: new Map([['p0', { maxWidth: 180, maxHeight: 80 }]]),
        dependencyProof,
        provedDirtyRegion,
        maxRelaidPages: 3,
        requireDocumentStartCheckpoint: false,
        pmShift: { atChar: insertionAt, delta: 1 },
      },
    );

    expect(result.layoutReuse).toMatchObject({ mode: 'tail-splice' });
    expect(result.measureReuse).toMatchObject({ mode: 'proved-dirty-only', blocksMeasured: 1 });
    expect(warmMeasure).toHaveBeenCalledTimes(1);
  });
});
