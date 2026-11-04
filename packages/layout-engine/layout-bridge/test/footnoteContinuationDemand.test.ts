/**
 * SD-3050: Continuation-aware break — body pagination on page N+1 must reserve
 * for footnote slices that continued from page N (before the body lays out, so
 * body content does not need to be re-broken on a later pass).
 *
 * After PR #2881 the reserve loop converges to a layout where reserves[N+1]
 * includes carry-forward height. SD-3050 verifies the final layout assigns
 * the right body height on continuation pages and the loop reaches that state.
 */

import { describe, it, expect, vi } from 'vite-plus/test';
import type { FlowBlock, Measure } from '@superdoc/contracts';
import { incrementalLayout } from '../src/incrementalLayout';

const makeParagraph = (id: string, text: string, pmStart: number): FlowBlock => ({
  kind: 'paragraph',
  id,
  runs: [{ text, fontFamily: 'Arial', fontSize: 12, pmStart, pmEnd: pmStart + text.length }],
});

const makeMeasure = (lineHeight: number, lineCount: number): Measure => ({
  kind: 'paragraph',
  lines: Array.from({ length: lineCount }, (_, i) => ({
    fromRun: 0,
    fromChar: i,
    toRun: 0,
    toChar: i + 1,
    width: 200,
    ascent: lineHeight * 0.8,
    descent: lineHeight * 0.2,
    lineHeight,
  })),
  totalHeight: lineCount * lineHeight,
});

describe('SD-3050: continuation-aware body pagination', () => {
  it('reserves carry-forward demand on the continuation page so body packs tight', async () => {
    // Page geometry: body region 600px.
    // Document: enough body paragraphs to require ≥2 pages of body content
    // by themselves (40 paragraphs × 20px = 800px > 600px region). The ref
    // is anchored on page 1, and the footnote is large enough that page 1's
    // band cannot fit it — forcing carry-forward to page 2's band.
    //
    // Under the bodyMaxY-anchored architecture the page count is driven by
    // body content, so this fixture must produce ≥2 pages from body alone
    // (the planner does not synthesize standalone pages just for footnote
    // continuation). The continuation invariant — "page 2 reserves
    // carry-forward demand BEFORE body lays out so body packs tight" — is
    // exactly what we assert against the converged final layout.
    //
    // pageH = 744; maxReserve ≈ 599 (page minus margins minus 1px floor).
    // Footnote demand ≈ 720px + overhead, exceeds maxReserve, overflows to p2.

    const BODY_LINES = 40;
    const FOOTNOTE_LINES = 60;
    const LINE_H = 20;
    const FOOTNOTE_LINE_H = 12;

    let pos = 0;
    const blocks: FlowBlock[] = [];
    for (let i = 0; i < BODY_LINES; i += 1) {
      const text = `Body line ${i + 1}.`;
      blocks.push(makeParagraph(`body-${i}`, text, pos));
      pos += text.length + 1;
    }
    // Ref in the very first body paragraph
    const refBlock = blocks[0];
    const refPos = (refBlock.kind === 'paragraph' ? (refBlock.runs?.[0]?.pmStart ?? 0) : 0) + 2;
    const ftBlock = makeParagraph('footnote-1-0-paragraph', 'Big footnote.', 0);

    const measureBlock = vi.fn(async (b: FlowBlock) => {
      if (b.id.startsWith('footnote-')) return makeMeasure(FOOTNOTE_LINE_H, FOOTNOTE_LINES);
      return makeMeasure(LINE_H, 1);
    });

    const margins = { top: 72, right: 72, bottom: 72, left: 72 };
    const result = await incrementalLayout(
      [],
      null,
      blocks,
      {
        pageSize: { w: 612, h: 600 + margins.top + margins.bottom },
        margins,
        footnotes: {
          refs: [{ id: '1', pos: refPos }],
          blocksById: new Map([['1', [ftBlock]]]),
          topPadding: 6,
          dividerHeight: 6,
        },
      },
      measureBlock,
    );

    const counters = result.bridgeTiming.counters;
    expect(counters.footnoteRelayouts).toBeGreaterThan(0);
    expect(counters.footnotePreferredTrialsDeferred).toBeGreaterThan(0);
    expect(counters.footnoteRevertSnapshotsRestored).toBe(0);
    expect(counters.footnoteRevertRelayouts).toBe(0);
    expect(counters.paginationPasses).toBe(1 + counters.pageTokenRelayouts + counters.footnoteRelayouts);
    expect(
      counters.footnoteReserveRelayouts +
        counters.footnoteGrowRelayouts +
        counters.footnoteTightenRelayouts +
        counters.footnotePreferredRelayouts +
        counters.footnoteWidowRelayouts +
        counters.footnoteRevertRelayouts +
        counters.footnoteOtherRelayouts,
    ).toBe(counters.footnoteRelayouts);

    // The footnote should span pages 1 and 2.
    expect(result.layout.pages.length).toBeGreaterThanOrEqual(2);

    const page2 = result.layout.pages[1];
    expect(page2).toBeTruthy();

    // Page 2 must have a continuation reserve > 0 (carry-forward demand).
    expect(page2.footnoteReserved ?? 0).toBeGreaterThan(0);

    // Page 2 must contain a continuation footnote fragment AND it must fit
    // strictly within the reserved band (no overflow into the bottom margin).
    const footFrags = page2.fragments.filter((f) => String(f.blockId).startsWith('footnote-'));
    expect(footFrags.length).toBeGreaterThan(0);

    // Footnote fragments must not overflow the physical page bottom margin.
    // Note: page.margins.bottom is the *inflated* margin (incl. reserve);
    // the physical edge we must not cross is pageH minus the original
    // bottom margin (the un-inflated value used for the page footer).
    const pageH = page2.size?.h ?? 744;
    for (const f of footFrags) {
      const y = (f as { y?: number }).y ?? 0;
      const h = (f as { height?: number }).height ?? 0;
      // Para fragments don't carry an explicit height field — derive when
      // the fragment is a paragraph slice; for drawing fragments h is set.
      const fromLine = (f as { fromLine?: number }).fromLine;
      const toLine = (f as { toLine?: number }).toLine;
      const derivedH =
        h || (typeof fromLine === 'number' && typeof toLine === 'number' ? (toLine - fromLine) * FOOTNOTE_LINE_H : 0);
      expect(y + derivedH).toBeLessThanOrEqual(pageH - margins.bottom + 1);
    }

    // Body on page 2 must NOT fill the page top-to-bottom — the reserve must
    // shrink the body region on the converged layout.
    const bodyMaxBottom = page2.fragments
      .filter((f) => !String(f.blockId).startsWith('footnote-'))
      .reduce((max, f) => {
        const y = (f as { y?: number }).y ?? 0;
        const fromLine = (f as { fromLine?: number }).fromLine ?? 0;
        const toLine = (f as { toLine?: number }).toLine ?? fromLine + 1;
        const lineCount = Math.max(1, toLine - fromLine);
        return Math.max(max, y + lineCount * LINE_H);
      }, 0);

    const reserveTop = pageH - margins.bottom - (page2.footnoteReserved ?? 0);
    expect(bodyMaxBottom).toBeLessThanOrEqual(reserveTop + 1);
  });
});
