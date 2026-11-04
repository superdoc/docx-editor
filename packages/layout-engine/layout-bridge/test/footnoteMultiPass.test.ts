import { describe, it, expect, vi } from 'vite-plus/test';
import type { FlowBlock, Measure } from '@superdoc/contracts';
import * as layoutEngine from '@superdoc/layout-engine';
import { __test_only_growFootnoteReserves, incrementalLayout } from '../src/incrementalLayout';

/**
 * Builds a paragraph with pmStart/pmEnd so footnote ref position can be resolved to a page.
 */
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

/** Multi-line paragraph measure so footnote reserve height is large enough to shift content. */
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
  return {
    kind: 'paragraph',
    lines,
    totalHeight: lineCount * lineHeight,
  };
};

const makeVariableLineMeasure = (lineHeights: number[]): Measure => ({
  kind: 'paragraph',
  lines: lineHeights.map((lineHeight, index) => ({
    fromRun: 0,
    fromChar: index,
    toRun: 0,
    toChar: index + 1,
    width: 200,
    ascent: lineHeight * 0.8,
    descent: lineHeight * 0.2,
    lineHeight,
  })),
  totalHeight: lineHeights.reduce((total, lineHeight) => total + lineHeight, 0),
});

/**
 * Scenario that forces the footnote reserve loop to run multiple passes:
 * - Content height is small (240px). Body has 12 one-line blocks (20px each) so they
 *   exactly fill page 1 with no reserve.
 * - Footnote ref is in the last body block (ref on page 1 in pass 1).
 * - Footnote is tall (5 lines) so its reserve is ~80px. When we relayout with that
 *   reserve on page 1, content height becomes 160px → only 8 lines fit → the ref
 *   moves to page 2. So pass 2 assigns the footnote to page 2 and reserves there.
 * This catches regressions where layout and reserves get out of sync (e.g. wrong
 * reserve vector used for layout when max passes hit).
 */
describe('Footnote multi-pass reserve loop', () => {
  it('reuses the stable page prefix across cold reserve convergence passes', async () => {
    const BODY_LINE_HEIGHT = 20;
    const FOOTNOTE_LINE_HEIGHT = 12;
    const BODY_PARAGRAPHS = 72;
    const FOOTNOTE_LINES = 5;

    let pos = 0;
    const bodyBlocks: FlowBlock[] = [];
    for (let i = 0; i < BODY_PARAGRAPHS; i += 1) {
      const text = `Line ${i + 1}.`;
      bodyBlocks.push(makeParagraph(`body-${i}`, text, pos));
      pos += text.length + 1;
    }
    const referenceBlock = bodyBlocks[55]!;
    const referenceRun = referenceBlock.kind === 'paragraph' ? referenceBlock.runs[0] : null;
    const refPos = referenceRun && 'pmEnd' in referenceRun ? referenceRun.pmEnd! - 1 : pos - 2;
    const footnoteBlock = makeParagraph(
      'footnote-1-0-paragraph',
      'Footnote content that spans multiple lines here.',
      0,
    );
    const measureBlock = vi.fn(async (block: FlowBlock) => {
      if (block.id.startsWith('footnote-')) {
        return makeMultiLineMeasure(FOOTNOTE_LINE_HEIGHT, FOOTNOTE_LINES);
      }
      const textLength = block.kind === 'paragraph' ? (block.runs?.[0]?.text?.length ?? 1) : 1;
      return makeMeasure(BODY_LINE_HEIGHT, textLength);
    });
    const margins = { top: 72, right: 72, bottom: 72, left: 72 };
    const pageHeight = 240 + margins.top + margins.bottom;
    const refs = [{ id: '1', pos: refPos, blockId: referenceBlock.id }];
    const footnotes = {
      refs,
      blocksById: new Map([['1', [footnoteBlock]]]),
      topPadding: 4,
      dividerHeight: 2,
    };
    const layoutDocSpy = vi.spyOn(layoutEngine, 'layoutDocument');

    const result = await incrementalLayout(
      [],
      null,
      bodyBlocks,
      {
        pageSize: { w: 612, h: pageHeight },
        margins,
        footnotes,
      },
      measureBlock,
    );

    const reserveRelayoutCalls = layoutDocSpy.mock.calls.filter((call) =>
      (call[2] as { footnoteReservedByPageIndex?: number[] })?.footnoteReservedByPageIndex?.some(
        (height) => height > 0,
      ),
    );
    const localizedReserveRelayoutCalls = reserveRelayoutCalls.filter(([blocks]) => blocks.length < bodyBlocks.length);
    layoutDocSpy.mockRestore();

    expect(result.bridgeTiming.counters.footnoteRelayouts).toBeGreaterThan(0);
    expect(result.bridgeTiming.counters.footnoteReservePassReuseAttempts).toBeGreaterThan(0);
    expect(result.bridgeTiming.counters.footnoteReservePassReuseHits).toBe(
      result.bridgeTiming.counters.footnoteReservePassReuseAttempts,
    );
    expect(reserveRelayoutCalls.length).toBeGreaterThan(0);
    expect(localizedReserveRelayoutCalls).toHaveLength(result.bridgeTiming.counters.footnoteReservePassReuseHits);
    expect(reserveRelayoutCalls.length - localizedReserveRelayoutCalls.length).toBeLessThan(
      reserveRelayoutCalls.length,
    );

    const footnotePageIndex = result.layout.pages.findIndex((page) =>
      page.fragments.some((fragment) => fragment.blockId === footnoteBlock.id),
    );
    const referencePageIndex = result.layout.pages.findIndex((page) =>
      page.fragments.some((fragment) => fragment.blockId === referenceBlock.id),
    );
    expect(footnotePageIndex).toBe(referencePageIndex);
    expect(footnotePageIndex).toBeGreaterThan(0);
    expect(result.layout.pages[footnotePageIndex]?.footnoteReserved).toBeGreaterThan(0);

    const finalReserves = result.layout.pages.map((page) => page.footnoteReserved ?? 0);
    const canonicalLayout = layoutEngine.layoutDocument(
      bodyBlocks,
      bodyBlocks.map((block) => {
        const textLength = block.kind === 'paragraph' ? (block.runs?.[0]?.text?.length ?? 1) : 1;
        return makeMeasure(BODY_LINE_HEIGHT, textLength);
      }),
      {
        pageSize: { w: 612, h: pageHeight },
        margins,
        footnoteReservedByPageIndex: finalReserves,
        footnotes: {
          ...footnotes,
          bodyHeightById: new Map([['1', FOOTNOTE_LINE_HEIGHT * FOOTNOTE_LINES]]),
          firstLineHeightById: new Map([['1', FOOTNOTE_LINE_HEIGHT]]),
        },
      },
    );
    const bodyBlockIds = new Set(bodyBlocks.map((block) => block.id));
    const bodyGeometry = (pages: typeof result.layout.pages) =>
      pages.map((page) => ({
        number: page.number,
        sectionIndex: page.sectionIndex,
        sectionPageNumber: page.sectionPageNumber,
        displayNumber: page.displayNumber,
        size: page.size,
        margins: page.margins,
        fragments: page.fragments.filter((fragment) => bodyBlockIds.has(fragment.blockId)),
      }));
    expect(bodyGeometry(result.layout.pages)).toEqual(bodyGeometry(canonicalLayout.pages));

    const pageRelativeAnchor: FlowBlock = {
      kind: 'drawing',
      id: 'page-relative-anchor',
      drawingKind: 'vectorShape',
      geometry: { width: 10, height: 10 },
      attrs: { anchorParagraphId: bodyBlocks[0]!.id },
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'page',
        vRelativeFrom: 'page',
        offsetH: 0,
        offsetV: 0,
      },
      wrap: { type: 'None', behindDoc: true },
    };
    const guardedResult = await incrementalLayout(
      [],
      null,
      [...bodyBlocks, pageRelativeAnchor],
      {
        pageSize: { w: 612, h: pageHeight },
        margins,
        footnotes,
      },
      async (block) => {
        if (block.kind === 'drawing') {
          return {
            kind: 'drawing',
            drawingKind: 'vectorShape',
            width: 10,
            height: 10,
            scale: 1,
            naturalWidth: 10,
            naturalHeight: 10,
            geometry: { width: 10, height: 10 },
          };
        }
        return measureBlock(block);
      },
    );
    expect(guardedResult.bridgeTiming.counters.footnoteRelayouts).toBeGreaterThan(0);
    expect(guardedResult.bridgeTiming.counters.footnoteReservePassReuseAttempts).toBe(0);
  });

  it('skips preferred trials that cannot fit the only remaining footnote range', async () => {
    const bodyBlocks = Array.from({ length: 50 }, (_, index) =>
      makeParagraph(`body-${index}`, `Body paragraph ${index}.`, index * 20),
    );
    const bodyBlock = bodyBlocks[0]!;
    const footnoteBlock = makeParagraph('footnote-1-paragraph', 'Large footnote.', 0);
    const margins = { top: 72, right: 72, bottom: 72, left: 72 };
    const contentHeight = 887;
    const result = await incrementalLayout(
      [],
      null,
      bodyBlocks,
      {
        pageSize: { w: 612, h: contentHeight + margins.top + margins.bottom },
        margins,
        footnotes: {
          refs: [{ id: '1', pos: 1, blockId: bodyBlock.id }],
          blocksById: new Map([['1', [footnoteBlock]]]),
          topPadding: 4,
          dividerHeight: 2,
        },
      },
      async (block) =>
        block.id === footnoteBlock.id
          ? makeVariableLineMeasure([...Array<number>(59).fill(14), 70])
          : makeMeasure(20, 17),
    );

    expect(result.bridgeTiming.counters.footnotePreferredTrialsDeferred).toBeGreaterThan(0);
    expect(result.bridgeTiming.counters.footnotePreferredRelayouts).toBe(0);
    expect(result.layout.pages[0]?.footnoteLedger?.continuationOut).toEqual([
      { id: '1', remainingRangeCount: 1, remainingHeightPx: 70 },
    ]);
    expect(result.layout.pages[0]?.footnoteLedger?.actualBandHeightPx).toBe(846);
    expect(result.layout.pages[1]?.footnoteLedger?.continuationIn).toEqual([
      { id: '1', remainingRangeCount: 1, remainingHeightPx: 70 },
    ]);
    const footnoteRendered = result.layout.pages
      .flatMap((page) => page.fragments)
      .some((fragment) => fragment.blockId === footnoteBlock.id);
    expect(footnoteRendered).toBe(true);
  });

  it('runs multiple layout passes when footnotes shift pages and stabilizes correctly', async () => {
    const BODY_LINE_HEIGHT = 20;
    const FOOTNOTE_LINE_HEIGHT = 12;
    // 20 body paragraphs so body content naturally spans 2 pages in the
    // bodyMaxY-anchored architecture (12 lines on p1 + 8 on p2 without
    // reserves). The ref lives in the *last* paragraph (page 2), and the
    // footnote is large enough that page 2's band reserve shifts body
    // breaks — re-pushing some content forward. The reserve loop iterates
    // until the layout stabilizes (page count, ref placement, reserves all
    // settle).
    const LINES_ON_PAGE_1_WITHOUT_RESERVE = 20;
    const FOOTNOTE_LINES = 5;

    let pos = 0;
    const bodyBlocks: FlowBlock[] = [];
    for (let i = 0; i < LINES_ON_PAGE_1_WITHOUT_RESERVE; i += 1) {
      const text = `Line ${i + 1}.`;
      bodyBlocks.push(makeParagraph(`body-${i}`, text, pos));
      pos += text.length + 1; // +1 for implied break
    }
    // Ref in last body block (lives on page 2 in the converged layout).
    const refPos = pos - 2; // inside last paragraph
    const footnoteBlock = makeParagraph(
      'footnote-1-0-paragraph',
      'Footnote content that spans multiple lines here.',
      0,
    );

    const measureBlock = vi.fn(async (block: FlowBlock) => {
      if (block.id.startsWith('footnote-')) {
        return makeMultiLineMeasure(FOOTNOTE_LINE_HEIGHT, FOOTNOTE_LINES);
      }
      const textLength = block.kind === 'paragraph' ? (block.runs?.[0]?.text?.length ?? 1) : 1;
      return makeMeasure(BODY_LINE_HEIGHT, textLength);
    });

    // Content height 240px (= 12 body lines per page without reserves).
    const contentHeight = 240;
    const margins = { top: 72, right: 72, bottom: 72, left: 72 };
    const pageHeight = contentHeight + margins.top + margins.bottom;

    const layoutDocSpy = vi.spyOn(layoutEngine, 'layoutDocument');

    const result = await incrementalLayout(
      [],
      null,
      bodyBlocks,
      {
        pageSize: { w: 612, h: pageHeight },
        margins,
        footnotes: {
          refs: [{ id: '1', pos: refPos }],
          blocksById: new Map([['1', [footnoteBlock]]]),
          topPadding: 4,
          dividerHeight: 2,
        },
      },
      measureBlock,
    );

    layoutDocSpy.mockRestore();

    // The SD-2656 bodyMaxY-anchored architecture is allowed to converge in a
    // single layout pass — the slicer's range-aware demand (charged line by
    // line as body commits) decides break points in-line, so the reserve
    // back-and-forth that the legacy multi-pass loop needed is unnecessary
    // for most cases. What matters for "stabilizes correctly" is the
    // converged final layout, asserted below: ref migrates to page 2 along
    // with its footnote, page 2 reserves space for the band, body doesn't
    // overlap the band.
    const { layout } = result;
    expect(layout.pages.length).toBeGreaterThanOrEqual(2);

    const page2 = layout.pages[1];
    expect(page2.footnoteReserved).toBeGreaterThan(0);

    const footnoteFragment = layout.pages.flatMap((p) => p.fragments).find((f) => f.blockId === footnoteBlock.id);
    expect(footnoteFragment).toBeTruthy();
    const pageOfFootnote = layout.pages.find((p) => p.fragments.some((f) => f.blockId === footnoteBlock.id));
    expect(pageOfFootnote).toBe(page2);

    // Sanity: footnote band does not overlap body.
    // In the bodyMaxY-anchored architecture the band paints immediately
    // below the last body fragment (at `page.bodyMaxY`), so the structural
    // invariant is "page.bodyMaxY sits at or below the bottom of every
    // body fragment, AND the band itself ends at or above the physical page
    // bottom (pageH - bottomMargin)". Using `page.bodyMaxY` here instead of
    // the legacy `pageH - bottomMargin - reserve` formula keeps the test
    // aligned with the band's actual paint anchor.
    const bodyFragmentsOnPage2 = page2.fragments.filter(
      (f) => f.blockId !== footnoteBlock.id && !String(f.blockId).startsWith('footnote-separator'),
    );
    const bodyMaxY = (page2 as { bodyMaxY?: number }).bodyMaxY ?? 0;
    expect(bodyMaxY).toBeGreaterThan(0);
    for (const f of bodyFragmentsOnPage2) {
      const fragBottom =
        'y' in f && typeof f.y === 'number' && 'height' in f
          ? f.y + (f.height as number)
          : ((f as { y?: number }).y ?? 0);
      expect(fragBottom).toBeLessThanOrEqual(bodyMaxY + 1);
    }
    // Band must fit within the physical page bottom (no overflow into the
    // bottom margin / footer region).
    const physicalBottom = (page2.size?.h ?? pageHeight) - (margins.bottom ?? 72);
    expect(bodyMaxY + (page2.footnoteReserved ?? 0)).toBeLessThanOrEqual(physicalBottom + 1);
    for (const page of layout.pages) {
      const appliedReserve = page.footnoteReserved ?? 0;
      const ledger = page.footnoteLedger;
      expect(ledger?.appliedBodyReservePx ?? 0).toBe(appliedReserve);
      expect(ledger?.actualBandHeightPx ?? 0).toBeLessThanOrEqual(appliedReserve + 1);
      const pagePhysicalBottom = (page.size?.h ?? pageHeight) - (page.baseMargins?.bottom ?? margins.bottom);
      expect((page.bodyMaxY ?? 0) + appliedReserve).toBeLessThanOrEqual(pagePhysicalBottom + 1);
    }
  });

  it('stops a doomed tighten regrow at the accepted page-count ceiling', async () => {
    let state = { appliedReserves: [0], plannedReserves: [10], pageCount: 100 };
    const applied: Array<{ target: number[]; label: string }> = [];
    const converged = await __test_only_growFootnoteReserves({
      maxPasses: 10,
      maxAcceptedPageCount: 100,
      readState: () => state,
      applyReserves: async (target, label) => {
        applied.push({ target, label });
        state = { appliedReserves: target, plannedReserves: [20], pageCount: 101 };
      },
    });

    expect(converged).toBe(false);
    expect(applied).toEqual([{ target: [10], label: 'grow-pass-1' }]);

    state = { appliedReserves: [0], plannedReserves: [10], pageCount: 100 };
    applied.length = 0;
    const unboundedConverged = await __test_only_growFootnoteReserves({
      maxPasses: 10,
      readState: () => state,
      applyReserves: async (target, label) => {
        applied.push({ target, label });
        state = {
          appliedReserves: target,
          plannedReserves: [20],
          pageCount: 100 + applied.length,
        };
      },
    });
    expect(unboundedConverged).toBe(true);
    expect(applied).toEqual([
      { target: [10], label: 'grow-pass-1' },
      { target: [20], label: 'grow-pass-2' },
    ]);
  });

  it('does not exhaust max reserve passes when reserves oscillate between pages', async () => {
    const BODY_LINE_HEIGHT = 20;
    const FOOTNOTE_LINE_HEIGHT = 12;
    const LINES_ON_PAGE_1_WITHOUT_RESERVE = 12;
    const FOOTNOTE_LINES = 5;

    let pos = 0;
    const bodyBlocks: FlowBlock[] = [];
    for (let i = 0; i < LINES_ON_PAGE_1_WITHOUT_RESERVE; i += 1) {
      const text = `Line ${i + 1}.`;
      bodyBlocks.push(makeParagraph(`body-${i}`, text, pos));
      pos += text.length + 1;
    }

    const refPos = pos - 2;
    const footnoteBlock = makeParagraph(
      'footnote-1-0-paragraph',
      'Footnote content that spans multiple lines here.',
      0,
    );

    const measureBlock = vi.fn(async (block: FlowBlock) => {
      if (block.id.startsWith('footnote-')) {
        return makeMultiLineMeasure(FOOTNOTE_LINE_HEIGHT, FOOTNOTE_LINES);
      }
      const textLength = block.kind === 'paragraph' ? (block.runs?.[0]?.text?.length ?? 1) : 1;
      return makeMeasure(BODY_LINE_HEIGHT, textLength);
    });

    const contentHeight = 240;
    const margins = { top: 72, right: 72, bottom: 72, left: 72 };
    const pageHeight = contentHeight + margins.top + margins.bottom;

    const layoutDocSpy = vi.spyOn(layoutEngine, 'layoutDocument');

    await incrementalLayout(
      [],
      null,
      bodyBlocks,
      {
        pageSize: { w: 612, h: pageHeight },
        margins,
        footnotes: {
          refs: [{ id: '1', pos: refPos }],
          blocksById: new Map([['1', [footnoteBlock]]]),
          topPadding: 4,
          dividerHeight: 2,
        },
      },
      measureBlock,
    );

    const footnoteReserveCalls = layoutDocSpy.mock.calls.filter((call) =>
      (call[2] as { footnoteReservedByPageIndex?: number[] })?.footnoteReservedByPageIndex?.some((h) => h > 0),
    );
    layoutDocSpy.mockRestore();

    // This scenario genuinely oscillates (A -> B -> A), so we can't collapse it
    // to the original ≤3 passes. The budget here bounds the combined work of
    // the outer convergence loop (MAX_FOOTNOTE_LAYOUT_PASSES=4), its merge
    // relayout, the grow-only post-reserve loop (GROW_MAX_PASSES=10), and the
    // opportunistic tighten loop (MAX_TIGHTEN_ITERATIONS=8). Observed actual
    // count is ~19; the ≤30 cap catches regressions that would balloon the
    // relayout count (e.g. if oscillation detection is removed or caps grow).
    expect(footnoteReserveCalls.length).toBeLessThanOrEqual(30);
  });
});
