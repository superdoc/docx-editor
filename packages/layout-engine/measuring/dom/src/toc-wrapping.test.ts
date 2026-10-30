import { describe, expect, it } from 'vite-plus/test';
import type { ParagraphBlock, ParagraphMeasure, TextRun } from '@superdoc/contracts';
import { measureBlock } from './index.js';

const textRun = (text: string): TextRun => ({ text, fontFamily: 'Arial', fontSize: 16 });

const tocParagraph = (title: string[], number = '15'): ParagraphBlock => ({
  kind: 'paragraph',
  id: `toc-${title.join('-')}`,
  attrs: { isTocEntry: true, tabs: [{ pos: 3000, val: 'end', leader: 'dot' }] },
  runs: [...title.map(textRun), { kind: 'tab', text: '\t' }, textRun(number)],
});

function assertBoundedSegments(measure: ParagraphMeasure, width: number) {
  for (const line of measure.lines) {
    let cursor = 0;
    for (const segment of line.segments ?? []) {
      const start = segment.x ?? cursor;
      expect(start).toBeGreaterThanOrEqual(cursor - 1);
      cursor = start + segment.width;
      expect(cursor).toBeLessThanOrEqual(width + 1);
    }
  }
}

describe('SD-5465 cached TOC title wrapping', () => {
  it.each([
    ['one title run', ['A long section title with several words before its page number']],
    ['split title runs', ['ARTICLE VI', ' SURVIVAL OF REPRESENTATIONS AND WARRANTIES; INDEMNIFICATION']],
  ])('wraps %s before its right-aligned page number', async (_name, title) => {
    const block = tocParagraph(title);
    const measure = (await measureBlock(block, 200)) as ParagraphMeasure;
    expect(measure.kind).toBe('paragraph');
    expect(measure.lines.length).toBeGreaterThan(1);
    assertBoundedSegments(measure, 200);
    const lastLine = measure.lines.at(-1)!;
    const pageNumber = lastLine.segments?.find((segment) => segment.runIndex === block.runs.length - 1);
    expect(pageNumber).toBeDefined();
    expect((pageNumber?.x ?? 0) + (pageNumber?.width ?? 0)).toBeCloseTo(200, 0);
  });

  it('keeps a short cached title and its bounded leader on one line', async () => {
    const measure = (await measureBlock(tocParagraph(['Short section']), 200)) as ParagraphMeasure;
    expect(measure.lines).toHaveLength(1);
    assertBoundedSegments(measure, 200);
    expect(measure.lines[0].leaders).toHaveLength(1);
    expect(measure.lines[0].leaders![0].from).toBeLessThan(measure.lines[0].leaders![0].to);
  });

  it.each([
    ['at the boundary', 0],
    ['past the boundary', 3000],
  ])('wraps the last title word with a page tab %s', async (_label, extraTabTwips) => {
    const title = 'A section ending near the margin';
    const titleMeasure = (await measureBlock(
      { kind: 'paragraph', id: 'natural-title', runs: [textRun(title)] },
      2000,
    )) as ParagraphMeasure;
    const width = titleMeasure.lines[0].width + 2;
    const block = tocParagraph([title]);
    block.attrs!.tabs = [{ pos: width * 15 + extraTabTwips, val: 'end', leader: 'dot' }];
    const measure = (await measureBlock(block, width)) as ParagraphMeasure;
    expect(measure.lines).toHaveLength(2);
    assertBoundedSegments(measure, width);
  });

  it.each([
    [50, 20],
    [90, 0],
  ])('keeps a %i-character title clear of its page number after a hanging indent', async (length, left) => {
    const block = tocParagraph(['A'.repeat(length)]);
    block.attrs!.indent = { left, hanging: 20 };
    const measure = (await measureBlock(block, 200)) as ParagraphMeasure;
    expect(measure.lines.length).toBeGreaterThan(1);
    assertBoundedSegments(measure, 200);
  });
});
