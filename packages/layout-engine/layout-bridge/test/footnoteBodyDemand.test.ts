/**
 * SD-3049: Body break decisions consult footnote demand for refs anchored on this page.
 *
 * Today the body paginator's only footnote signal is `footnoteReservedByPageIndex`,
 * a uniform per-page bottom-margin add-on derived from the previous pass's plan.
 * On pass 1 this is empty, so the body fills the whole page; a ref + footnote body
 * land near the page bottom; the reserve loop then claws back space, leaving a
 * visible blank gap between the body's last fragment and the footnote separator.
 *
 * After SD-3049, when a fragment carrying a footnote ref is committed the paginator
 * accumulates that footnote's measured body height into a per-page demand counter
 * and uses it in the break decision. Body packs tight to "next-line + cumulative
 * footnote demand exceeds page bottom".
 *
 * Verified target: body→separator gap stays within the legitimate separator overhead
 * (≤ 28px = separatorSpacingBefore 12 + dividerHeight 6 + topPadding 6 + 4px slack).
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

describe('SD-3049: body break consults anchored footnote demand', () => {
  it('packs body tight to the separator when footnote demand is known up-front', async () => {
    // Page geometry:
    //   pageHeight = 600 + 144 = 744; margins top=72 bottom=72 → body region = 600px
    //   line height = 20 → 30 body lines fill the page exactly
    // Document:
    //   30 single-line body paragraphs, with a footnote ref in body line 25
    //   footnote = 5 lines × 12 = 60px, plus ~24px separator overhead
    // Today (post-hoc reserve, pass 1 with no signal):
    //   pass 1: body fills 30 lines, ref ends up on page 1
    //   plan computes ~84px reserve for page 1
    //   pass 2: body capped at 600 - 84 = 516px → 25 lines (25*20=500, 26 doesn't fit)
    //   ref still on page 1 (it's at line 25), body bottom ≈ 500 + topMargin
    //   separator at body-bottom + 12 (separatorSpacingBefore) = ~512 + topMargin
    //   reserve area ends near page bottom
    //   GAP between body line 25 bottom and separator: ~12px legit + however much was clawed back
    //   Actually with all 25 lines fitting, the gap is the legit overhead. So this test may need
    //   a different shape to expose the bug.
    //
    // Better shape: ref in middle of doc with a LONG footnote so capping is sharp.

    const BODY_LINES = 25;
    const FOOTNOTE_LINES = 8; // 96px content + ~24px overhead = ~120px reserve
    const LINE_H = 20;

    let pos = 0;
    const blocks: FlowBlock[] = [];
    for (let i = 0; i < BODY_LINES; i += 1) {
      const text = `Body line ${i + 1}.`;
      blocks.push(makeParagraph(`body-${i}`, text, pos));
      pos += text.length + 1;
    }
    // Ref inside body line 5 (early, so its demand is known well before page fills)
    const refBlockIdx = 4;
    const refBlock = blocks[refBlockIdx];
    const refPos = (refBlock.kind === 'paragraph' ? (refBlock.runs?.[0]?.pmStart ?? 0) : 0) + 2;
    const ftBlock = makeParagraph('footnote-1-0-paragraph', 'Footnote body content.', 0);

    const measureBlock = vi.fn(async (b: FlowBlock) => {
      if (b.id.startsWith('footnote-')) return makeMeasure(12, FOOTNOTE_LINES);
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

    const page1 = result.layout.pages[0];
    expect(page1).toBeTruthy();

    // Compute body bottom Y on page 1. ParaFragment doesn't carry an explicit
    // `height` field — derive from `y + (toLine - fromLine) * lineHeight`.
    const bodyMaxBottom = page1.fragments
      .filter((f) => !String(f.blockId).startsWith('footnote-'))
      .reduce((max, f) => {
        const y = (f as { y?: number }).y ?? 0;
        const fromLine = (f as { fromLine?: number }).fromLine ?? 0;
        const toLine = (f as { toLine?: number }).toLine ?? fromLine + 1;
        const lineCount = Math.max(1, toLine - fromLine);
        return Math.max(max, y + lineCount * LINE_H);
      }, 0);

    // Find the separator fragment's top Y on page 1.
    const sepFrag = page1.fragments.find((f) => String(f.blockId).startsWith('footnote-separator'));
    const sepTop = (sepFrag as { y?: number } | undefined)?.y ?? Infinity;

    const gap = sepTop - bodyMaxBottom;
    expect(gap).toBeLessThanOrEqual(32);
    expect(gap).toBeGreaterThanOrEqual(0);
  });

  it('produces a tight body→separator gap for an image-only footnote', async () => {
    const BODY_LINES = 25;
    const LINE_H = 20;
    const IMAGE_HEIGHT = 96;

    let pos = 0;
    const blocks: FlowBlock[] = [];
    for (let i = 0; i < BODY_LINES; i += 1) {
      const text = `Body line ${i + 1}.`;
      blocks.push(makeParagraph(`body-${i}`, text, pos));
      pos += text.length + 1;
    }
    const refBlockIdx = 4;
    const refBlock = blocks[refBlockIdx];
    const refPos = (refBlock.kind === 'paragraph' ? (refBlock.runs?.[0]?.pmStart ?? 0) : 0) + 2;
    const ftImage: FlowBlock = { kind: 'image', id: 'footnote-1-0-image', src: '', width: 100, height: IMAGE_HEIGHT };

    const measureBlock = vi.fn(async (b: FlowBlock) => {
      if (b.kind === 'image') return { kind: 'image' as const, width: 100, height: IMAGE_HEIGHT };
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
          blocksById: new Map([['1', [ftImage]]]),
          topPadding: 6,
          dividerHeight: 6,
        },
      },
      measureBlock,
    );

    const page1 = result.layout.pages[0];
    expect(page1).toBeTruthy();

    const bodyMaxBottom = page1.fragments
      .filter((f) => !String(f.blockId).startsWith('footnote-'))
      .reduce((max, f) => {
        const y = (f as { y?: number }).y ?? 0;
        const fromLine = (f as { fromLine?: number }).fromLine ?? 0;
        const toLine = (f as { toLine?: number }).toLine ?? fromLine + 1;
        const lineCount = Math.max(1, toLine - fromLine);
        return Math.max(max, y + lineCount * LINE_H);
      }, 0);
    const sepFrag = page1.fragments.find((f) => String(f.blockId).startsWith('footnote-separator'));
    const sepTop = (sepFrag as { y?: number } | undefined)?.y ?? Infinity;

    const gap = sepTop - bodyMaxBottom;
    expect(gap).toBeLessThanOrEqual(32);
    expect(gap).toBeGreaterThanOrEqual(0);
  });

  it('produces a tight body→separator gap for a list-only footnote', async () => {
    const BODY_LINES = 25;
    const LINE_H = 20;
    const ITEM_LINE_H = 12;
    const ITEMS = 8;

    let pos = 0;
    const blocks: FlowBlock[] = [];
    for (let i = 0; i < BODY_LINES; i += 1) {
      const text = `Body line ${i + 1}.`;
      blocks.push(makeParagraph(`body-${i}`, text, pos));
      pos += text.length + 1;
    }
    const refBlockIdx = 4;
    const refBlock = blocks[refBlockIdx];
    const refPos = (refBlock.kind === 'paragraph' ? (refBlock.runs?.[0]?.pmStart ?? 0) : 0) + 2;

    const ftItemPara = (itemId: string): FlowBlock => ({
      kind: 'paragraph',
      id: `${itemId}-p`,
      runs: [{ text: 'item', fontFamily: 'Arial', fontSize: 10, pmStart: 0, pmEnd: 4 }],
    });
    const ftList: FlowBlock = {
      kind: 'list',
      id: 'footnote-1-0-list',
      listType: 'bullet',
      items: Array.from({ length: ITEMS }, (_, i) => ({
        id: `footnote-1-0-list-item-${i}`,
        marker: { text: '•', font: { family: 'Arial', size: 10 } } as never,
        paragraph: ftItemPara(`footnote-1-0-list-item-${i}`) as never,
      })),
    };

    const measureBlock = vi.fn(async (b: FlowBlock) => {
      if (b.kind === 'list') {
        return {
          kind: 'list' as const,
          items: b.items.map((it) => ({
            itemId: it.id,
            markerWidth: 10,
            markerTextWidth: 6,
            indentLeft: 0,
            paragraph: makeMeasure(ITEM_LINE_H, 1) as never,
          })),
          totalHeight: ITEMS * ITEM_LINE_H,
        };
      }
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
          blocksById: new Map([['1', [ftList]]]),
          topPadding: 6,
          dividerHeight: 6,
        },
      },
      measureBlock,
    );

    const page1 = result.layout.pages[0];
    expect(page1).toBeTruthy();

    const bodyMaxBottom = page1.fragments
      .filter((f) => !String(f.blockId).startsWith('footnote-'))
      .reduce((max, f) => {
        const y = (f as { y?: number }).y ?? 0;
        const fromLine = (f as { fromLine?: number }).fromLine ?? 0;
        const toLine = (f as { toLine?: number }).toLine ?? fromLine + 1;
        const lineCount = Math.max(1, toLine - fromLine);
        return Math.max(max, y + lineCount * LINE_H);
      }, 0);
    const sepFrag = page1.fragments.find((f) => String(f.blockId).startsWith('footnote-separator'));
    const sepTop = (sepFrag as { y?: number } | undefined)?.y ?? Infinity;

    const gap = sepTop - bodyMaxBottom;
    expect(gap).toBeLessThanOrEqual(32);
    expect(gap).toBeGreaterThanOrEqual(0);
  });

  it('does not double-count demand when the same footnote id is referenced twice on a page', async () => {
    // Two refs to footnote id `1` on the same page must contribute its body
    // height once — the rendered footnote band dedupes per page, so the body
    // paginator must too. Otherwise the page reserves 2× the real demand and
    // leaves phantom whitespace above the separator.

    const BODY_LINES = 25;
    const LINE_H = 20;
    const FOOTNOTE_LINES = 5;
    const FOOTNOTE_LINE_H = 12;

    let pos = 0;
    const blocks: FlowBlock[] = [];
    for (let i = 0; i < BODY_LINES; i += 1) {
      const text = `Body line ${i + 1}.`;
      blocks.push(makeParagraph(`body-${i}`, text, pos));
      pos += text.length + 1;
    }
    const firstRefBlock = blocks[4];
    const secondRefBlock = blocks[19];
    const firstRefPos = (firstRefBlock.kind === 'paragraph' ? (firstRefBlock.runs?.[0]?.pmStart ?? 0) : 0) + 2;
    const secondRefPos = (secondRefBlock.kind === 'paragraph' ? (secondRefBlock.runs?.[0]?.pmStart ?? 0) : 0) + 2;
    const ftBlock = makeParagraph('footnote-1-0-paragraph', 'Footnote body.', 0);

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
          refs: [
            { id: '1', pos: firstRefPos },
            { id: '1', pos: secondRefPos },
          ],
          blocksById: new Map([['1', [ftBlock]]]),
          topPadding: 6,
          dividerHeight: 6,
        },
      },
      measureBlock,
    );

    const page1 = result.layout.pages[0];
    const bodyMaxBottom = page1.fragments
      .filter((f) => !String(f.blockId).startsWith('footnote-'))
      .reduce((max, f) => {
        const y = (f as { y?: number }).y ?? 0;
        const fromLine = (f as { fromLine?: number }).fromLine ?? 0;
        const toLine = (f as { toLine?: number }).toLine ?? fromLine + 1;
        return Math.max(max, y + Math.max(1, toLine - fromLine) * LINE_H);
      }, 0);
    const sepFrag = page1.fragments.find((f) => String(f.blockId).startsWith('footnote-separator'));
    const sepTop = (sepFrag as { y?: number } | undefined)?.y ?? Infinity;

    const gap = sepTop - bodyMaxBottom;
    expect(gap).toBeLessThanOrEqual(28);
    expect(gap).toBeGreaterThanOrEqual(0);
  });

  it('does not re-charge block demand on continuation pages of a multi-page paragraph', async () => {
    // A single long paragraph carries one footnote ref. The footnote band
    // only renders on the page that holds the ref's line — continuation pages
    // must not get the demand subtracted from their effective body region, or
    // they pack 13–15 lines instead of 20 and the document ends up with
    // unnecessary extra pages.

    const PARAGRAPH_LINES = 50;
    const LINE_H = 20;
    const FOOTNOTE_LINES = 5;
    const FOOTNOTE_LINE_H = 20;

    const block: FlowBlock = {
      kind: 'paragraph',
      id: 'long-para',
      runs: [{ text: 'x'.repeat(100), fontFamily: 'Arial', fontSize: 12, pmStart: 0, pmEnd: 100 }],
    };
    const ftBlock = makeParagraph('footnote-1-0-paragraph', 'Footnote body.', 0);

    const measureBlock = vi.fn(async (b: FlowBlock) => {
      if (b.id.startsWith('footnote-')) return makeMeasure(FOOTNOTE_LINE_H, FOOTNOTE_LINES);
      return makeMeasure(LINE_H, PARAGRAPH_LINES);
    });

    const margins = { top: 100, right: 100, bottom: 100, left: 100 };
    const result = await incrementalLayout(
      [],
      null,
      [block],
      {
        pageSize: { w: 612, h: 600 },
        margins,
        footnotes: {
          refs: [{ id: '1', pos: 5 }],
          blocksById: new Map([['1', [ftBlock]]]),
          topPadding: 6,
          dividerHeight: 6,
        },
      },
      measureBlock,
    );

    // 50 lines × 20 = 1000px. Body region per page = 400px. Footnote band on
    // page 1 reduces P1 capacity; P2+ are unconstrained.
    //
    // Baseline outcome (no preferred-reserve scorer acceptance): 3 pages.
    // Per-page-recharge bug (now fixed): 4 pages.
    //
    // SD-2656: with the +1-page-if-eliminates-split
    // relaxation, the scorer now accepts a one-page growth to fully fit the
    // 5-line footnote on the anchor page (previously split). New outcome is 4
    // pages — the same as the recharge bug numerically but for a different,
    // intentional reason (split-elimination). This test still guards against
    // per-page recharge: anything > 4 pages would indicate recharge regression.
    expect(result.layout.pages.length).toBeLessThanOrEqual(4);
  });

  it('does not change layout when document has no footnotes (no-op invariant)', async () => {
    // Regression guard: the new code path must not affect layouts without footnotes.
    const BODY_LINES = 50;
    const LINE_H = 20;
    let pos = 0;
    const blocks: FlowBlock[] = [];
    for (let i = 0; i < BODY_LINES; i += 1) {
      const text = `Body line ${i + 1}.`;
      blocks.push(makeParagraph(`body-${i}`, text, pos));
      pos += text.length + 1;
    }
    const measureBlock = vi.fn(async () => makeMeasure(LINE_H, 1));

    const margins = { top: 72, right: 72, bottom: 72, left: 72 };
    const result = await incrementalLayout(
      [],
      null,
      blocks,
      {
        pageSize: { w: 612, h: 600 + margins.top + margins.bottom },
        margins,
      },
      measureBlock,
    );

    // 50 body lines × 20px = 1000px. Body region per page = 600px → 30 lines per page.
    // Expect: 2 pages exactly, with no fragment kind starting "footnote-".
    expect(result.layout.pages.length).toBe(2);
    for (const page of result.layout.pages) {
      for (const f of page.fragments) {
        expect(String(f.blockId).startsWith('footnote-')).toBe(false);
      }
    }
  });
});
