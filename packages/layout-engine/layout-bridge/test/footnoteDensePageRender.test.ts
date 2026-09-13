/**
 * SD-3400 (prerequisite): footnotes must still render when the body nearly fills
 * a single (terminal) page.
 *
 * Root cause: the SD-2656 bodyMaxY-anchored reserve (`computeMaxFootnoteReserve`)
 * makes the planner's max reserve equal the leftover body-region space
 * (`pageH - bottomMargin - bodyMaxY`). When the body fills the page that leftover
 * is ~0, so the footnote can't be placed; on a single-page document there is no
 * continuation page to overflow onto, and the footnote is silently dropped.
 *
 * Reproduced live: `Footnote tests.docx` (body fills ~98% of the body region,
 * leaving ~17px) renders 0 of its 6 footnotes. `basic-footnotes.docx` (tiny body)
 * and multi-page docs render fine — so this is specifically the dense terminal-page
 * case.
 *
 * Invariant: a footnote anchored on a page must render its body. The body must
 * yield space (break earlier / grow a page) so the footnote fits on its anchor
 * page, rather than being dropped.
 */

import { describe, it, expect, vi } from 'vite-plus/test';
import type { FlowBlock, Measure, ParagraphBlock, TableBlock, TableMeasure } from '@superdoc/contracts';
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

const countFootnoteFragments = (
  layout: { pages: Array<{ fragments: Array<{ blockId?: string }> }> },
  idPrefix: string,
) => {
  let count = 0;
  for (const page of layout.pages) {
    for (const f of page.fragments) {
      if (String(f.blockId).startsWith(idPrefix)) count += 1;
    }
  }
  return count;
};

const countRenderedLines = (
  layout: { pages: Array<{ fragments: Array<{ blockId?: string; fromLine?: number; toLine?: number }> }> },
  blockId: string,
) => {
  const lines = new Set<number>();
  for (const page of layout.pages) {
    for (const fragment of page.fragments) {
      if (fragment.blockId !== blockId) continue;
      for (let line = fragment.fromLine ?? 0; line < (fragment.toLine ?? 0); line += 1) lines.add(line);
    }
  }
  return lines.size;
};

describe('SD-3400 prerequisite: footnote render on a dense terminal page', () => {
  it('renders the footnote body even when the body nearly fills the only page', async () => {
    // Page geometry: body region = 600px (h 744, margins 72/72), line height 20.
    // 30 body lines × 20 = 600px → the body fills the region exactly, leaving ~0
    // reserve. The footnote ref is mid-body (line 10), so it is anchored on page 1.
    const BODY_LINES = 30;
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
    const refBlock = blocks[9];
    const refPos = (refBlock.kind === 'paragraph' ? (refBlock.runs?.[0]?.pmStart ?? 0) : 0) + 2;
    const ftBlock = makeParagraph('footnote-1-0-paragraph', 'Footnote body content here.', 0);

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

    // The footnote body must render somewhere (it is currently dropped → 0).
    const noteFragments = countFootnoteFragments(result.layout, 'footnote-1');
    expect(noteFragments).toBeGreaterThan(0);

    // And its separator should render too, confirming the band exists.
    const sepFragments = countFootnoteFragments(result.layout, 'footnote-separator');
    expect(sepFragments).toBeGreaterThan(0);
  });

  it('retains long table-owned continuations when the body reaches its final page', async () => {
    const PAGE_HEIGHT = 800;
    const BODY_LINE_HEIGHT = 100;
    const TABLE_HEIGHT = 600;
    const FOOTNOTE_LINES = 44;
    const FOOTNOTE_LINE_HEIGHT = 14;
    let pos = 0;
    const bodyParagraphs = Array.from({ length: 9 }, (_, index) => {
      const text = `Body paragraph ${index + 1}.`;
      const paragraph = makeParagraph(`body-${index}`, text, pos);
      pos += text.length + 1;
      return paragraph;
    });
    const cellParagraphs = [0, 1].map((index) => {
      const text = `Table cell ${index + 1}.`;
      const paragraph = makeParagraph(`table-cell-${index + 1}`, text, pos) as ParagraphBlock;
      pos += text.length + 1;
      return paragraph;
    });
    const table: TableBlock = {
      kind: 'table',
      id: 'table',
      rows: [
        {
          id: 'table-row',
          attrs: { tableRowProperties: { cantSplit: true } },
          cells: cellParagraphs.map((paragraph, index) => ({
            id: `table-cell-${index + 1}`,
            blocks: [paragraph],
          })),
        },
      ],
    };
    const blocks: FlowBlock[] = [...bodyParagraphs.slice(0, 6), table, ...bodyParagraphs.slice(6)];
    const tableMeasure: TableMeasure = {
      kind: 'table',
      rows: [
        {
          height: TABLE_HEIGHT,
          cells: cellParagraphs.map((_, index) => ({
            gridColumnStart: index,
            width: 250,
            height: TABLE_HEIGHT,
            blocks: [makeMeasure(20, 30)],
          })),
        },
      ],
      columnWidths: [250, 250],
      totalWidth: 500,
      totalHeight: TABLE_HEIGHT,
    };
    const footnoteBlocks = [1, 2].map((id) => makeParagraph(`footnote-${id}-paragraph`, `Footnote ${id}.`, 0));
    const measureBlock = vi.fn(async (block: FlowBlock) => {
      if (block.kind === 'table') return tableMeasure;
      if (block.id.startsWith('footnote-')) return makeMeasure(FOOTNOTE_LINE_HEIGHT, FOOTNOTE_LINES);
      return makeMeasure(BODY_LINE_HEIGHT, 1);
    });
    const margins = { top: 50, right: 50, bottom: 50, left: 50 };
    const result = await incrementalLayout(
      [],
      null,
      blocks,
      {
        pageSize: { w: 600, h: PAGE_HEIGHT },
        margins,
        footnotes: {
          refs: cellParagraphs.map((paragraph, index) => ({
            id: String(index + 1),
            blockId: paragraph.id,
            pos: paragraph.runs?.[0]?.pmStart ?? 0,
          })),
          blocksById: new Map(footnoteBlocks.map((block, index) => [String(index + 1), [block]])),
          topPadding: 0,
          dividerHeight: 0,
        },
      },
      measureBlock,
    );

    expect(countRenderedLines(result.layout, footnoteBlocks[0].id)).toBe(FOOTNOTE_LINES);
    expect(countRenderedLines(result.layout, footnoteBlocks[1].id)).toBe(FOOTNOTE_LINES);
  });
});
