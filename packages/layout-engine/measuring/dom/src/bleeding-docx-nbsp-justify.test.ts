import { describe, it, expect } from 'vite-plus/test';
import { measureBlock } from './index.js';
import type { FlowBlock, ParagraphMeasure, Measure } from '@superdoc/contracts';

/**
 * End-to-end regression for the "justified text with NBSP overflows the right
 * margin" ticket (customer file: plans/bleeding.docx). See
 * plans/NBSP_JUSTIFY_BLEED_FINDINGS.md for the full root-cause writeup.
 *
 * Root cause: CSS word-spacing stretches/compresses U+00A0 identically to
 * U+0020 in real browsers (confirmed empirically across Chromium/Firefox/
 * WebKit), but the measurer only counted U+0020 toward Line.spaceCount. A
 * justified line's spacingPerSpace = slack / spaceCount then got applied by
 * the browser at more positions than spaceCount accounted for, overshooting
 * availableWidth by spacingPerSpace * (trueStretchPoints - spaceCount).
 *
 * This test reproduces the exact run fragmentation from the customer's
 * word/document.xml (NBSP sitting at <w:r> boundaries between several short
 * runs -- a redaction/rsid-fragmented amount+entity-name run right before the
 * text that visibly overflowed) and independently recomputes, from scratch,
 * the true count of stretch points a browser would actually paint -- not via
 * the same code path as Line.spaceCount, so this can't pass tautologically.
 */

const expectParagraphMeasure = (measure: Measure): ParagraphMeasure => {
  expect(measure.kind).toBe('paragraph');
  return measure as ParagraphMeasure;
};

// Numbers pulled from plans/bleeding.docx word/document.xml + styles.xml:
// pgSz w=11907 twips, pgMar left=right=1440 twips -> content width = 9027 twips.
// Paragraph pPr: ind left=567 twips, jc=both (justify).
// Font: Times New Roman, sz=24 half-points = 12pt (docDefaults / Normal style).
const TWIPS_TO_PX = 96 / 1440;
const PAGE_CONTENT_WIDTH_PX = 9027 * TWIPS_TO_PX;
const INDENT_LEFT_PX = 567 * TWIPS_TO_PX;
const FONT_SIZE_PX = 12 * (96 / 72);
const FONT_FAMILY = 'Times New Roman';
const NBSP = ' ';
const FILLER = "A décidé de procéder, dans le cadre du programme d'émission, à l'émission d'obligations ";

// Mirrors the real <w:r> fragmentation: "xxxxxx" | NBSP | "xxxxxxxx" | NBSP +
// "S.A.," | trailing text, each its own run (rsid/proofErr fragmentation).
const nbspRuns = [
  { text: FILLER, fontFamily: FONT_FAMILY, fontSize: FONT_SIZE_PX },
  { text: 'xxxxxx', fontFamily: FONT_FAMILY, fontSize: FONT_SIZE_PX },
  { text: NBSP, fontFamily: FONT_FAMILY, fontSize: FONT_SIZE_PX },
  { text: 'xxxxxxxx', fontFamily: FONT_FAMILY, fontSize: FONT_SIZE_PX },
  { text: NBSP + 'S.A.,', fontFamily: FONT_FAMILY, fontSize: FONT_SIZE_PX },
  {
    text: ' sociales et financières diverses portant sur un montant total significatif',
    fontFamily: FONT_FAMILY,
    fontSize: FONT_SIZE_PX,
  },
];

const makeBlock = (): FlowBlock => ({
  kind: 'paragraph',
  id: 'bleeding-repro',
  runs: nbspRuns,
  attrs: { alignment: 'justify', indent: { left: INDENT_LEFT_PX } },
});

// Independently counts every ASCII-space-or-NBSP character actually rendered
// within a line's committed range -- deliberately NOT via Line.spaceCount, so
// this is a genuine cross-check against what a browser will actually stretch,
// not a tautological self-comparison.
const countTrueStretchPoints = (block: FlowBlock, line: ParagraphMeasure['lines'][number]): number => {
  if (block.kind !== 'paragraph') return 0;
  let lineText = '';
  for (let runIndex = line.fromRun; runIndex <= line.toRun; runIndex += 1) {
    const run = block.runs[runIndex] as { text?: string } | undefined;
    if (!run || typeof run.text !== 'string') continue;
    const start = runIndex === line.fromRun ? line.fromChar : 0;
    const end = runIndex === line.toRun ? line.toChar : run.text.length;
    lineText += run.text.slice(start, end);
  }
  // Mirrors trimTrailingWrapSpaces' own rule (index.ts): a trailing wrap-point
  // ASCII space stays within the line's addressable toChar range (needed for
  // caret positioning) but is deliberately excluded from width/spaceCount
  // because it is never actually painted at the line's visible right edge.
  // This is a pre-existing, correct trim unrelated to the NBSP fix -- this
  // helper must exclude it too, or it would over-count what a browser really
  // stretches.
  lineText = lineText.replace(/ +$/, '');
  let count = 0;
  for (const ch of lineText) {
    if (ch === ' ' || ch === ' ') count += 1;
  }
  return count;
};

describe('bleeding.docx numeric repro', () => {
  it('every non-last justified line counts each space and NBSP the browser stretches', async () => {
    const measure = expectParagraphMeasure(await measureBlock(makeBlock(), PAGE_CONTENT_WIDTH_PX));
    expect(measure.lines.length).toBeGreaterThan(1);

    measure.lines.forEach((line, i) => {
      const isLastLine = i === measure.lines.length - 1;
      if (isLastLine) return; // justify doesn't apply to the true last line

      expect(line.spaceCount).toBe(countTrueStretchPoints(makeBlock(), line));
    });
  });
});
