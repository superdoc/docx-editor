import { beforeEach, describe, expect, it } from 'vite-plus/test';
import type { FlowBlock, Layout, Measure, ParagraphBlock } from '@superdoc/contracts';
import {
  clearIncrementalModuleState,
  incrementalLayout,
  type IncrementalLayoutReuseOptions,
} from '../src/incrementalLayout.js';
import { computeDirtyRegions } from '../src/diff.js';

const options = {
  pageSize: { w: 600, h: 600 },
  margins: { top: 50, right: 50, bottom: 50, left: 50 },
  columns: { count: 1, gap: 0 },
};
const paragraph = (id: string, text: string, pmStart: number, attrs: ParagraphBlock['attrs'] = {}): ParagraphBlock => ({
  kind: 'paragraph',
  id,
  runs: [{ text, fontFamily: 'Arial', fontSize: 11, pmStart, pmEnd: pmStart + text.length }],
  attrs,
});
function blocks(long: boolean, floating: boolean): FlowBlock[] {
  return [
    paragraph('filler', 'filler', 1),
    paragraph('heading', 'heading', 20, { keepNext: true, keepLines: true, spacing: { before: 32, after: 0 } }),
    ...(floating
      ? [
          {
            kind: 'image' as const,
            id: 'picture',
            src: 'generated.png',
            width: 20,
            height: 70,
            wrap: { type: 'None' as const },
            anchor: {
              isAnchored: true,
              hRelativeFrom: 'column' as const,
              vRelativeFrom: 'paragraph' as const,
              offsetH: -20,
              offsetV: 0,
            },
          },
        ]
      : []),
    paragraph('following', long ? 'long' : 'short', 40),
    ...Array.from({ length: 8 }, (_, i) => paragraph(`tail${i}`, `tail${i}`, 60 + i * 20)),
  ];
}
async function measure(block: FlowBlock): Promise<Measure> {
  if (block.kind === 'image') return { kind: 'image', width: 20, height: 70 };
  if (block.kind === 'drawing')
    return {
      kind: 'drawing',
      drawingKind: 'vectorShape',
      width: 20,
      height: 150,
      naturalWidth: 20,
      naturalHeight: 150,
      scale: 1,
      geometry: { width: 20, height: 150, rotation: 0, flipH: false, flipV: false },
    };
  if (block.kind !== 'paragraph') throw new Error(`Unexpected ${block.kind}`);
  const height =
    block.id === 'filler'
      ? 390
      : block.id === 'heading'
        ? 26
        : block.id === 'following'
          ? (block.runs[0] as { text: string }).text === 'long'
            ? 80
            : 20
          : 40;
  return {
    kind: 'paragraph',
    totalHeight: height,
    lines: [
      {
        fromRun: 0,
        fromChar: 0,
        toRun: 0,
        toChar: (block.runs[0] as { text: string }).text.length,
        width: 100,
        maxWidth: 500,
        lineHeight: height,
        ascent: height - 4,
        descent: 4,
      },
    ],
  };
}
function reuse(
  before: FlowBlock[],
  after: FlowBlock[],
  layout: Layout,
  floating: boolean,
): IncrementalLayoutReuseOptions {
  layout.layoutEpoch = 1;
  const keys = layout.pages.map((page) => {
    const f = page.fragments[0];
    return `${f?.blockId ?? ''}#${f && 'fromLine' in f ? f.fromLine : 0}#${page.sectionIndex ?? 0}#${f && 'continuesFromPrev' in f && f.continuesFromPrev ? 1 : 0}`;
  });
  const keyIndex = new Map<string, number[]>(),
    pageIndex = new Map<string, { firstPage: number; lastPage: number }>();
  keys.forEach((key, i) => keyIndex.set(key, [...(keyIndex.get(key) ?? []), i]));
  layout.pages.forEach((page, i) =>
    page.fragments.forEach((f) => {
      const old = pageIndex.get(f.blockId);
      if (old) old.lastPage = i;
      else pageIndex.set(f.blockId, { firstPage: i, lastPage: i });
    }),
  );
  const dirty = computeDirtyRegions(before, after);
  return {
    previousLayout: layout,
    retainedMetadataSourceLayoutEpoch: 1,
    previousPageStartKeys: keys,
    previousPageStartKeyIndex: keyIndex,
    previousBlockPageIndex: pageIndex,
    currentBlockIndexById: new Map(after.map((block, i) => [block.id, i])),
    dirtyBlockIds: dirty.changedBlockIds,
    provedDirtyRegion: dirty,
    dependencyProof: {
      profile: floating ? 'page-checkpoint-local-text' : 'single-section-local-text',
      blockIdsUnchanged: true,
      blockIdsUnique: true,
      globalDependenciesAbsent: !floating,
      ...(floating
        ? {
            globalDependenciesFencedByPageCheckpoint: true,
            admittedDependencyClasses: ['keep-constraints' as const, 'body-anchored-objects' as const],
            multiColumnSectionsProvedNonBalanceable: true,
            localKeepDependencyClosure: {
              checkpointPageIndex: 0,
              checkpointBlockId: 'filler',
              predecessorBlockId: null,
            },
          }
        : {}),
      renderInputsUnchanged: true,
      pageReferencesAbsent: true,
    },
  };
}
const geometry = (layout: Layout) =>
  layout.pages.map((page) => ({
    number: page.number,
    fragments: page.fragments.map((f) => ({
      id: f.blockId,
      x: f.x,
      y: f.y,
      width: f.width,
      height: 'height' in f ? f.height : undefined,
      from: 'fromLine' in f ? f.fromLine : undefined,
      to: 'toLine' in f ? f.toLine : undefined,
    })),
  }));

describe('keepNext edit replay', () => {
  beforeEach(() => clearIncrementalModuleState());
  for (const drawingFit of [false, true])
    it(`preserves the owner and graphic when a clean checkpoint begins with a graphic: ${drawingFit}`, async () => {
      let before = blocks(true, true);
      if (drawingFit) {
        before = blocks(true, false).map((block) =>
          block.kind === 'paragraph' && block.id === 'heading'
            ? { ...block, attrs: { spacing: { before: 32, after: 0 } } }
            : block,
        );
        before.splice(1, 0, {
          kind: 'drawing',
          id: 'picture',
          drawingKind: 'vectorShape',
          geometry: { width: 20, height: 150 },
          anchor: {
            isAnchored: true,
            hRelativeFrom: 'column',
            vRelativeFrom: 'paragraph',
            offsetH: -20,
            offsetV: 0,
            behindDoc: true,
          },
          wrap: { type: 'None', wrapText: 'bothSides', distLeft: 12, distRight: 12 },
          attrs: { anchorParagraphId: 'heading' },
        });
      }
      const after = before.map((block) =>
        block.kind === 'paragraph' && ['tail0', 'tail1'].includes(block.id)
          ? paragraph(block.id, `${(block.runs[0] as { text: string }).text}!`, block.runs[0].pmStart!)
          : block,
      );
      const previous = await incrementalLayout([], null, before, options, measure);
      const warm = await incrementalLayout(
        before,
        previous.layout,
        after,
        options,
        measure,
        undefined,
        previous.measures,
        undefined,
        undefined,
        reuse(before, after, previous.layout, true),
      );
      clearIncrementalModuleState();
      const cold = await incrementalLayout([], null, after, options, measure);
      expect(warm.layoutReuse?.reason).not.toContain('dependency-proof-invalid');
      expect(geometry(warm.layout)).toEqual(geometry(cold.layout));
      expect(warm.layout.pages.flatMap((page) => page.fragments).filter((f) => f.blockId === 'heading')).toHaveLength(
        1,
      );
      expect(warm.layout.pages.flatMap((page) => page.fragments).filter((f) => f.blockId === 'picture')).toHaveLength(
        1,
      );
    });
  it('replays a moved heading when later same-page edits select a clean-page checkpoint', async () => {
    const before = blocks(true, false);
    const after = before.map((block) =>
      block.kind === 'paragraph' && ['tail0', 'tail1'].includes(block.id)
        ? paragraph(block.id, `${(block.runs[0] as { text: string }).text}!`, block.runs[0].pmStart!)
        : block,
    );
    const previous = await incrementalLayout([], null, before, options, measure);
    const warm = await incrementalLayout(
      before,
      previous.layout,
      after,
      options,
      measure,
      undefined,
      previous.measures,
      undefined,
      undefined,
      reuse(before, after, previous.layout, false),
    );
    clearIncrementalModuleState();
    const cold = await incrementalLayout([], null, after, options, measure);
    expect(geometry(warm.layout)).toEqual(geometry(cold.layout));
    expect(warm.layout.pages[1].fragments.find((f) => f.blockId === 'heading')?.y).toBe(50);
  });
  for (const floating of [false, true])
    for (const longBefore of [false, true]) {
      it(`matches fresh layout when a follower ${longBefore ? 'shrinks' : 'grows'} across ${floating ? 'a floating picture' : 'a paragraph boundary'}`, async () => {
        const before = blocks(longBefore, floating),
          after = blocks(!longBefore, floating);
        const previous = await incrementalLayout([], null, before, options, measure);
        const warm = await incrementalLayout(
          before,
          previous.layout,
          after,
          options,
          measure,
          undefined,
          previous.measures,
          undefined,
          undefined,
          reuse(before, after, previous.layout, floating),
        );
        clearIncrementalModuleState();
        const cold = await incrementalLayout([], null, after, options, measure);
        expect(warm.layoutReuse?.reason).not.toContain('dependency-proof-invalid');
        expect(geometry(warm.layout)).toEqual(geometry(cold.layout));
        const headingPage = cold.layout.pages.findIndex((page) => page.fragments.some((f) => f.blockId === 'heading'));
        expect(headingPage).toBe(longBefore ? 0 : 1);
        expect(warm.layout.pages[headingPage].fragments.find((f) => f.blockId === 'heading')?.y).toBe(
          longBefore ? 472 : 50,
        );
        expect(
          warm.layout.pages.flatMap((page) => page.fragments).filter((f) => f.blockId === 'following'),
        ).toHaveLength(1);
      });
    }
});

describe('ordinary paragraph line-fit replay', () => {
  beforeEach(() => clearIncrementalModuleState());
  for (const scenario of [
    { name: 'keepLines shrink', filler: 430, before: [20, 20, 20, 20], after: [20], keepLines: true },
    { name: 'default widow shrink', filler: 470, before: [20, 20], after: [20], keepLines: false },
    {
      name: 'equal total height with changed widow start',
      filler: 470,
      before: [20, 20, 20, 20],
      after: [10, 10, 30, 30],
      keepLines: false,
    },
  ]) {
    for (const reverse of [false, true]) {
      it(`matches fresh layout for ${scenario.name}${reverse ? ' reversed' : ''}`, async () => {
        const body = (text: string): FlowBlock[] => [
          paragraph('filler', 'filler', 1),
          paragraph('heading', text, 20, { keepLines: scenario.keepLines, spacing: { before: 0, after: 0 } }),
          paragraph('following', 'following', 40),
          ...Array.from({ length: 8 }, (_, i) => paragraph(`tail${i}`, `tail${i}`, 60 + i * 20)),
        ];
        const before = body(reverse ? 'short' : 'long');
        const after = body(reverse ? 'long' : 'short');
        const measureLines = async (block: FlowBlock): Promise<Measure> => {
          if (block.kind !== 'paragraph') throw new Error(`Unexpected ${block.kind}`);
          const text = (block.runs[0] as { text: string }).text;
          const heights =
            block.id === 'filler'
              ? [scenario.filler]
              : block.id === 'heading'
                ? text === 'long'
                  ? scenario.before
                  : scenario.after
                : [40];
          return {
            kind: 'paragraph',
            totalHeight: heights.reduce((sum, height) => sum + height, 0),
            lines: heights.map((height, index) => ({
              fromRun: 0,
              fromChar: Math.floor((text.length * index) / heights.length),
              toRun: 0,
              toChar: Math.floor((text.length * (index + 1)) / heights.length),
              width: 100,
              maxWidth: 500,
              lineHeight: height,
              ascent: height - 4,
              descent: 4,
            })),
          };
        };
        const previous = await incrementalLayout([], null, before, options, measureLines);
        const warm = await incrementalLayout(
          before,
          previous.layout,
          after,
          options,
          measureLines,
          undefined,
          previous.measures,
          undefined,
          undefined,
          reuse(before, after, previous.layout, false),
        );
        clearIncrementalModuleState();
        const cold = await incrementalLayout([], null, after, options, measureLines);
        expect(warm.layoutReuse?.reason).not.toContain('dependency-proof-invalid');
        expect(geometry(warm.layout)).toEqual(geometry(cold.layout));
        expect(
          cold.layout.pages.findIndex((page) => page.fragments.some((fragment) => fragment.blockId === 'heading')),
        ).toBe(reverse ? 1 : 0);
      });
    }
  }
});

describe('paragraph attributes outside measured line heights', () => {
  beforeEach(() => clearIncrementalModuleState());
  for (const contextual of [false, true]) {
    for (const reverse of [false, true]) {
      it(`matches fresh layout for ${contextual ? 'contextual spacing' : 'border expansion'}${reverse ? ' reversed' : ''}`, async () => {
        const body = (changed: boolean): FlowBlock[] => [
          paragraph('filler', 'filler', 1, { styleId: 'Same' }),
          paragraph('heading', 'heading', 20, {
            keepLines: true,
            styleId: 'Same',
            spacing: { before: contextual ? 32 : 0, after: 0 },
            ...(contextual
              ? { contextualSpacing: changed }
              : changed
                ? {}
                : { borders: { top: { style: 'single', width: 1, space: 45 } } }),
          }),
          paragraph('following', 'following', 40),
          ...Array.from({ length: 8 }, (_, i) => paragraph(`tail${i}`, `tail${i}`, 60 + i * 20)),
        ];
        const before = body(reverse),
          after = body(!reverse);
        const measureUnchanged = async (block: FlowBlock): Promise<Measure> => {
          if (block.kind !== 'paragraph') throw new Error(`Unexpected ${block.kind}`);
          const height = block.id === 'filler' ? (contextual ? 470 : 430) : block.id === 'heading' ? 20 : 40;
          return {
            kind: 'paragraph',
            totalHeight: height,
            lines: [
              {
                fromRun: 0,
                fromChar: 0,
                toRun: 0,
                toChar: (block.runs[0] as { text: string }).text.length,
                width: 100,
                maxWidth: 500,
                lineHeight: height,
                ascent: height - 4,
                descent: 4,
              },
            ],
          };
        };
        const previous = await incrementalLayout([], null, before, options, measureUnchanged);
        const warm = await incrementalLayout(
          before,
          previous.layout,
          after,
          options,
          measureUnchanged,
          undefined,
          previous.measures,
          undefined,
          undefined,
          reuse(before, after, previous.layout, false),
        );
        clearIncrementalModuleState();
        const cold = await incrementalLayout([], null, after, options, measureUnchanged);
        expect(geometry(warm.layout)).toEqual(geometry(cold.layout));
        expect(
          cold.layout.pages.findIndex((page) => page.fragments.some((fragment) => fragment.blockId === 'heading')),
        ).toBe(reverse ? 1 : 0);
      });
    }
  }
});
