import { describe, expect, it } from 'vite-plus/test';
import type { FlowBlock, Layout, Measure, ParagraphBlock, ParagraphMeasure } from '@superdoc/contracts';
import { clearIncrementalModuleState, incrementalLayout } from '../src/incrementalLayout';

const paragraph = (id: string, attrs: ParagraphBlock['attrs'] = {}): ParagraphBlock => ({
  kind: 'paragraph',
  id,
  attrs,
  runs: [{ text: 'abc', fontFamily: 'Arial', fontSize: 12, pmStart: 0, pmEnd: 3 }],
});
const measure = (lineHeight: number, count = 1): ParagraphMeasure => ({
  kind: 'paragraph',
  totalHeight: lineHeight * count,
  measuredAtMaxWidth: 220,
  lines: Array.from({ length: count }, (_, index) => ({
    fromRun: 0,
    toRun: 0,
    fromChar: index,
    toChar: index + 1,
    width: 20,
    ascent: lineHeight * 0.8,
    descent: lineHeight * 0.2,
    lineHeight,
  })),
});
const scenario = (bodyCount = 24, noteLines = 7) => {
  const blocks: FlowBlock[] = Array.from({ length: bodyCount }, (_, index) => paragraph('body-' + index));
  const refs = blocks
    .filter((_, index) => index % 3 === 0)
    .map((block, index) => ({
      id: String(index),
      pos: 0,
      blockId: block.id,
      runOrdinal: 0,
    }));
  const notes = new Map(refs.map((ref) => [ref.id, [paragraph('footnote-' + ref.id)]]));
  const measureBlock = async (block: FlowBlock): Promise<Measure> =>
    block.id.startsWith('footnote-') ? measure(10, noteLines) : measure(25);
  const options = {
    pageSize: { w: 240, h: 220 },
    margins: { top: 10, bottom: 10, left: 10, right: 10 },
    footnotes: { refs, blocksById: notes, topPadding: 2, dividerHeight: 2, gap: 2, separatorSpacingBefore: 4 },
  };
  return { blocks, refs, notes, measureBlock, options };
};

const pageKey = (page: Layout['pages'][number]) => {
  const first = page.fragments[0];
  const from = first && ('fromLine' in first ? first.fromLine : 'fromRow' in first ? first.fromRow : 0);
  return `${first?.blockId ?? ''}#${from ?? 0}#${page.sectionIndex ?? 0}#${first && 'continuesFromPrev' in first && first.continuesFromPrev ? 1 : 0}`;
};

const retainedMetadata = (layout: Layout, blocks: FlowBlock[]) => {
  layout.layoutEpoch = 1;
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
  return {
    previousLayout: layout,
    retainedMetadataSourceLayoutEpoch: 1,
    previousPageStartKeys: layout.pages.map(pageKey),
    previousPageStartKeyIndex: keyIndexes,
    previousBlockPageIndex: blockPages,
    previousBlockIndexById: new Map(blocks.map((block, index) => [block.id, index])),
    currentBlockIndexById: new Map(blocks.map((block, index) => [block.id, index])),
  };
};

const localBodyReuse = (
  layout: Layout,
  blocks: FlowBlock[],
  changedIndex: number,
): NonNullable<Parameters<typeof incrementalLayout>[9]> => {
  const changedId = blocks[changedIndex].id;
  return {
    ...retainedMetadata(layout, blocks),
    dirtyBlockIds: [changedId],
    provedDirtyRegion: {
      firstDirtyIndex: changedIndex,
      lastStableIndex: changedIndex - 1,
      changedBlockIds: [changedId],
      insertedBlockIds: [],
      deletedBlockIds: [],
      stableBlockIds: new Set(blocks.filter((_, index) => index !== changedIndex).map((block) => block.id)),
    },
    provedDirtyMeasureConstraints: new Map([[changedId, { maxWidth: 220, maxHeight: 200 }]]),
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
    maxRelaidPages: 3,
  };
};

const editBodyText = (blocks: FlowBlock[], changedIndex: number, text: string): FlowBlock[] => {
  const next = blocks.map((block, index) =>
    index === changedIndex ? paragraph(block.id, { ...(block as ParagraphBlock).attrs }) : block,
  );
  (next[changedIndex] as ParagraphBlock).runs[0] = {
    text,
    fontFamily: 'Arial',
    fontSize: 12,
    pmStart: 0,
    pmEnd: text.length,
  };
  return next;
};

const geometry = (layout: Layout) =>
  layout.pages.map((page) => ({
    number: page.number,
    margins: page.margins,
    bodyMaxY: (page as { bodyMaxY?: number }).bodyMaxY,
    reserve: page.footnoteReserved,
    fragments: page.fragments.map((fragment) => ({
      kind: fragment.kind,
      id: fragment.blockId,
      x: fragment.x,
      y: fragment.y,
      width: fragment.width,
      from: 'fromLine' in fragment ? fragment.fromLine : undefined,
      to: 'toLine' in fragment ? fragment.toLine : undefined,
    })),
  }));

const expectPublishedExactNotePlane = (result: Awaited<ReturnType<typeof incrementalLayout>>) => {
  const coupled = result.footnoteReserveSeed?.coupled;
  expect(result.footnoteReserveSeed?.noteBlocksByBlockId).toBe(coupled?.blocksById);
  expect(result.footnoteReserveSeed?.noteMeasuresByBlockId).toBe(coupled?.measuresById);
  expect(result.footnoteReserveSeed?.noteBodyHeightById).toBe(coupled?.prepared.fullHeightById);
  expect(result.footnoteReserveSeed?.noteFirstLineHeightById).toBe(coupled?.prepared.firstLineHeightById);
};

const assertCoverageAndBounds = (
  result: Awaited<ReturnType<typeof incrementalLayout>>,
  expected: ReturnType<typeof scenario>,
) => {
  const noteMeasures = new Map(result.extraBlocks?.map((block, index) => [block.id, result.extraMeasures![index]]));
  const bodyMeasures = new Map(result.blocks.map((block, index) => [block.id, result.measures[index]]));
  const seen = new Map<string, number[]>();
  for (const page of result.layout.pages) {
    for (const fragment of page.fragments) {
      if (fragment.kind !== 'para') continue;
      const measured = noteMeasures.get(fragment.blockId) ?? bodyMeasures.get(fragment.blockId);
      expect(measured?.kind).toBe('paragraph');
      if (measured?.kind !== 'paragraph') throw new Error('Missing paragraph measure');
      const lines = fragment.lines ?? measured.lines.slice(fragment.fromLine, fragment.toLine);
      const bottom = fragment.y + lines.reduce((sum, line) => sum + line.lineHeight, 0);
      expect(bottom).toBeLessThanOrEqual(210 + 1e-7);
      const seenLines = seen.get(fragment.blockId) ?? [];
      for (let line = fragment.fromLine; line < fragment.toLine; line++) seenLines.push(line);
      seen.set(fragment.blockId, seenLines);
    }
  }
  for (const block of expected.blocks) expect(seen.get(block.id)).toEqual([0]);
  for (const blocks of expected.notes.values()) {
    for (const block of blocks) {
      const measured = noteMeasures.get(block.id) as ParagraphMeasure;
      expect(seen.get(block.id)).toEqual(measured.lines.map((_, index) => index));
    }
  }
};

describe('native coupled footnote pagination', () => {
  it('repaginates consecutive proved local windows without rescanning retained notes', async () => {
    clearIncrementalModuleState();
    const input = scenario(256);
    const options = {
      ...input.options,
      footnotes: { ...input.options.footnotes, referenceTopologyRevision: 'native-refs-1' },
    };
    const cold = await incrementalLayout([], null, input.blocks, options, input.measureBlock);
    const changedIndex = 12;
    const nextBlocks = editBodyText(input.blocks, changedIndex, 'abcd');
    let observingWarmWork = true;
    const noteValues = input.notes.values.bind(input.notes);
    input.notes.values = () => {
      if (observingWarmWork) throw new Error('coupled warm pass scanned the retained note plane');
      return noteValues();
    };
    const guarded = new Proxy(nextBlocks, {
      get(target, property, receiver) {
        if (observingWarmWork && typeof property === 'string' && /^\d+$/.test(property) && Number(property) > 64) {
          throw new Error(`coupled warm pass scanned untouched body block ${property}`);
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const result = await incrementalLayout(
      input.blocks,
      cold.layout,
      guarded,
      options,
      input.measureBlock,
      undefined,
      cold.measures,
      undefined,
      {
        footnoteReserveSeed: { ...cold.footnoteReserveSeed!, reserves: cold.layout.pages.map(() => 190) },
        noteMeasurePlaneRetainedExact: true,
        retainedFootnoteExtras: { blocks: cold.extraBlocks!, measures: cold.extraMeasures! },
      },
      localBodyReuse(cold.layout, input.blocks, changedIndex),
    );
    const secondBlocks = editBodyText(nextBlocks, changedIndex, 'abcde');
    const secondGuarded = new Proxy(secondBlocks, {
      get(target, property, receiver) {
        if (observingWarmWork && typeof property === 'string' && /^\d+$/.test(property) && Number(property) > 64) {
          throw new Error(`second coupled warm pass scanned untouched body block ${property}`);
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const second = await incrementalLayout(
      nextBlocks,
      result.layout,
      secondGuarded,
      options,
      input.measureBlock,
      undefined,
      result.measures,
      undefined,
      {
        footnoteReserveSeed: result.footnoteReserveSeed!,
        noteMeasurePlaneRetainedExact: true,
        retainedFootnoteExtras: { blocks: result.extraBlocks!, measures: result.extraMeasures! },
      },
      localBodyReuse(result.layout, nextBlocks, changedIndex),
    );
    observingWarmWork = false; // The independent whole-document oracle deliberately visits every block.
    const fresh = await incrementalLayout([], null, nextBlocks, options, input.measureBlock);
    const secondFresh = await incrementalLayout([], null, secondBlocks, options, input.measureBlock);
    expect(geometry(result.layout)).toEqual(geometry(fresh.layout));
    expect(geometry(second.layout)).toEqual(geometry(secondFresh.layout));
    expect(result.layoutReuse?.mode).toBe('tail-splice');
    expect(second.layoutReuse?.mode).toBe('tail-splice');
    expect(result.bridgeTiming.counters.footnoteCoupledPages).toBeLessThan(12);
    expect(second.bridgeTiming.counters.footnoteCoupledPages).toBeLessThan(12);
    expectPublishedExactNotePlane(result);
    expectPublishedExactNotePlane(second);
    assertCoverageAndBounds(result, { ...input, blocks: nextBlocks });
    assertCoverageAndBounds(second, { ...input, blocks: secondBlocks });
  });

  it('rejects exact-plane reuse when a note block changes', async () => {
    clearIncrementalModuleState();
    const input = scenario();
    const options = {
      ...input.options,
      footnotes: { ...input.options.footnotes, referenceTopologyRevision: 'native-refs-1' },
    };
    const cold = await incrementalLayout([], null, input.blocks, options, input.measureBlock);
    const changedIndex = 12;
    const nextBlocks = editBodyText(input.blocks, changedIndex, 'abcd');
    const changedNote = paragraph('footnote-0');
    changedNote.runs[0] = {
      text: 'a taller changed note',
      fontFamily: 'Arial',
      fontSize: 12,
      pmStart: 0,
      pmEnd: 21,
    };
    const changedNotes = new Map(input.notes);
    changedNotes.set('0', [changedNote]);
    const changedOptions = {
      ...options,
      footnotes: { ...options.footnotes, blocksById: changedNotes },
    };
    const changedMeasureBlock = async (block: FlowBlock): Promise<Measure> =>
      block === changedNote ? measure(10, 14) : input.measureBlock(block);

    const result = await incrementalLayout(
      input.blocks,
      cold.layout,
      nextBlocks,
      changedOptions,
      changedMeasureBlock,
      undefined,
      cold.measures,
      undefined,
      {
        footnoteReserveSeed: cold.footnoteReserveSeed!,
        noteMeasurePlaneRetainedExact: true,
        retainedFootnoteExtras: { blocks: cold.extraBlocks!, measures: cold.extraMeasures! },
      },
      localBodyReuse(cold.layout, input.blocks, changedIndex),
    );
    const fresh = await incrementalLayout([], null, nextBlocks, changedOptions, changedMeasureBlock);

    expect(geometry(result.layout)).toEqual(geometry(fresh.layout));
    expect(result.footnoteReserveSeed?.noteBlocksByBlockId).not.toBe(cold.footnoteReserveSeed?.noteBlocksByBlockId);
    expect(result.footnoteReserveSeed?.noteBlocksByBlockId?.get(changedNote.id)).toBe(changedNote);
    expect(result.footnoteReserveSeed?.noteBodyHeightById?.get('0')).toBeGreaterThan(
      cold.footnoteReserveSeed?.noteBodyHeightById?.get('0') ?? 0,
    );
    assertCoverageAndBounds(result, {
      ...input,
      blocks: nextBlocks,
      notes: changedNotes,
      measureBlock: changedMeasureBlock,
      options: changedOptions,
    });
  });

  it('is seed-independent, preserves every source line, and settles in one forward pass', async () => {
    clearIncrementalModuleState();
    const input = scenario();
    const cold = await incrementalLayout([], null, input.blocks, input.options, input.measureBlock);
    const warm = await incrementalLayout(
      [],
      null,
      input.blocks,
      input.options,
      input.measureBlock,
      undefined,
      undefined,
      undefined,
      {
        footnoteReserveSeed: cold.footnoteReserveSeed,
      },
    );
    const inflated = await incrementalLayout(
      [],
      null,
      input.blocks,
      input.options,
      input.measureBlock,
      undefined,
      undefined,
      undefined,
      {
        footnoteReserveSeed: { ...cold.footnoteReserveSeed!, reserves: cold.layout.pages.map(() => 170) },
      },
    );
    const json = (value: unknown) => JSON.parse(JSON.stringify(value));
    expect(json(warm.layout)).toEqual(json(cold.layout));
    expect(json(inflated.layout)).toEqual(json(cold.layout));
    for (const result of [cold, warm, inflated]) {
      assertCoverageAndBounds(result, input);
      expect(result.bridgeTiming.counters.footnoteRelayouts).toBeLessThanOrEqual(1);
      expect(result.footnoteReserveSeed).toMatchObject({ paginationPolicy: 'coupled-v1' });
    }
  });

  it('drains a long final footnote after the body ends instead of dropping its remaining lines', async () => {
    clearIncrementalModuleState();
    const input = scenario(1, 65);
    const result = await incrementalLayout([], null, input.blocks, input.options, input.measureBlock);
    assertCoverageAndBounds(result, input);
    expect(result.layout.pages.length).toBeGreaterThan(3);
    const last = result.layout.pages.at(-1)!;
    expect(last.footnoteLedger?.continuationOut).toEqual([]);
    expect(last.fragments.some((fragment) => fragment.blockId === 'footnote-0')).toBe(true);
  });
});
