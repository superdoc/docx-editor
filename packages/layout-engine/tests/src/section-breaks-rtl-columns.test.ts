/**
 * RTL Section Column Order Tests
 *
 * A section carrying `w:sectPr/w:bidi` fills its columns right to left: the first paragraph belongs
 * in the RIGHT column and overflow spills into the left one (ECMA-376 §17.6.1). Column widths, the
 * gutter and the text direction inside each column are governed elsewhere and must not move.
 *
 * Regression coverage for the issue where fill order was a fixed left-to-right and the section
 * direction was never consulted on the column axis.
 *
 * @module section-breaks-rtl-columns.test
 */

import { describe, it, expect, beforeEach } from 'vite-plus/test';
import type { Layout } from '@superdoc/contracts';
import {
  createPMDocWithSections,
  convertAndLayout,
  pmToFlowBlocks,
  getSectionBreaks,
  PAGE_SIZES,
  resetBlockIdCounter,
  type TestSectionProps,
} from './test-helpers/section-test-utils.js';

/** Enough numbered paragraphs to overflow the first column, so the fill order is observable. */
const NUMBERED_PARAGRAPHS = Array.from(
  { length: 24 },
  (_, index) => `Paragraph number ${index + 1}. ${'filler '.repeat(20)}`,
);

const TWO_COLUMN_SECTION: TestSectionProps = {
  type: 'nextPage',
  pageSize: PAGE_SIZES.LETTER_PORTRAIT,
  columns: { count: 2, gap: 48 },
};

const layoutTwoColumnSection = async (props: TestSectionProps): Promise<Layout> => {
  const pmDoc = createPMDocWithSections([{ paragraphs: NUMBERED_PARAGRAPHS }], props);
  return convertAndLayout(pmDoc, { pageSize: PAGE_SIZES.LETTER_PORTRAIT });
};

/** `blockId` is `<paragraph index>-paragraph`, which is the document order of the source array. */
const paragraphIndex = (blockId: string): number => Number.parseInt(blockId, 10);

type ColumnReadout = {
  /** Distinct fragment x values on the page, ascending. */
  columnXs: number[];
  /** Paragraph indices in each column, keyed by that column's x, each in visual top-to-bottom order. */
  indicesByX: Map<number, number[]>;
};

const readFirstPage = (layout: Layout): ColumnReadout => {
  const fragments = [...layout.pages[0].fragments]
    .filter((fragment) => fragment.blockId.endsWith('-paragraph'))
    .sort((a, b) => a.y - b.y);

  const indicesByX = new Map<number, number[]>();
  for (const fragment of fragments) {
    const x = Math.round(fragment.x);
    if (!indicesByX.has(x)) indicesByX.set(x, []);
    indicesByX.get(x)!.push(paragraphIndex(fragment.blockId));
  }

  return { columnXs: [...indicesByX.keys()].sort((a, b) => a - b), indicesByX };
};

/** True when `indices` is 0,1,2,… — i.e. this column holds a contiguous prefix of the document. */
const isAscendingPrefix = (indices: number[]): boolean => indices.every((value, i) => value === i);

describe('Section Breaks - RTL Column Order', () => {
  beforeEach(() => {
    resetBlockIdCounter();
  });

  it('starts an RTL section in the right column and overflows into the left one', async () => {
    const layout = await layoutTwoColumnSection({ ...TWO_COLUMN_SECTION, bidi: true });
    const { columnXs, indicesByX } = readFirstPage(layout);

    expect(columnXs).toHaveLength(2);
    const [leftX, rightX] = columnXs;
    const right = indicesByX.get(rightX)!;
    const left = indicesByX.get(leftX)!;

    // Paragraph 1 opens the section, in the RIGHT column.
    expect(right[0]).toBe(0);
    // The right column holds a contiguous prefix and the left column continues it, so reading
    // right-then-left reproduces document order exactly.
    expect(isAscendingPrefix(right)).toBe(true);
    expect(left).toEqual(left.map((_, i) => right.length + i));
    // Both columns are actually used — otherwise "first column is on the right" proves nothing.
    expect(left.length).toBeGreaterThan(0);
  });

  it('leaves an LTR section filling left to right', async () => {
    const layout = await layoutTwoColumnSection(TWO_COLUMN_SECTION);
    const { columnXs, indicesByX } = readFirstPage(layout);

    const [leftX, rightX] = columnXs;
    expect(indicesByX.get(leftX)![0]).toBe(0);
    expect(isAscendingPrefix(indicesByX.get(leftX)!)).toBe(true);
    expect(indicesByX.get(rightX)![0]).toBeGreaterThan(0);
  });

  it('moves only the order — column widths and the gutter are untouched', async () => {
    const ltr = readFirstPage(await layoutTwoColumnSection(TWO_COLUMN_SECTION));
    resetBlockIdCounter();
    const rtl = readFirstPage(await layoutTwoColumnSection({ ...TWO_COLUMN_SECTION, bidi: true }));

    // Identical geometry: the same two column origins, so no width or gutter moved.
    expect(rtl.columnXs).toEqual(ltr.columnXs);

    // And an exact mirror of the assignment: whatever LTR put in the left column, RTL puts in the
    // right one, paragraph for paragraph. Comparing only the x values or the fragment total would
    // pass even with the mirror ripped out, since both are invariant under it.
    const [leftX, rightX] = ltr.columnXs;
    expect(rtl.indicesByX.get(rightX)).toEqual(ltr.indicesByX.get(leftX));
    expect(rtl.indicesByX.get(leftX)).toEqual(ltr.indicesByX.get(rightX));
  });

  it('starts a continuous RTL section on the right after an LTR section on the same page', async () => {
    const pmDoc = createPMDocWithSections(
      [
        {
          paragraphs: ['LTR section'],
          props: { ...TWO_COLUMN_SECTION, type: 'continuous' },
        },
        { paragraphs: ['RTL section'] },
      ],
      { ...TWO_COLUMN_SECTION, type: 'continuous', bidi: true },
    );
    const layout = await convertAndLayout(pmDoc, { pageSize: PAGE_SIZES.LETTER_PORTRAIT });

    expect(layout.pages).toHaveLength(1);
    const firstPageParagraphs = layout.pages[0].fragments.filter((fragment) => fragment.blockId.endsWith('-paragraph'));
    const ltr = firstPageParagraphs.find((fragment) => fragment.blockId === '0-paragraph');
    const rtl = firstPageParagraphs.find((fragment) => fragment.blockId === '1-paragraph');

    expect(ltr).toBeDefined();
    expect(rtl).toBeDefined();
    expect(rtl!.x).toBeGreaterThan(ltr!.x);
  });

  it('keeps a balanced last page right-to-left', async () => {
    // A multi-column section that ends mid-page gets its last page re-balanced, which REBUILDS the
    // column geometry and overwrites every fragment's x from it. That rebuild is a separate code
    // path from ordinary fill, so it can lose the axis on its own: the tail page of a two-column
    // Hebrew section would flip to left-to-right while every earlier page stayed right-to-left.
    const balanced = async (bidi: boolean) => {
      resetBlockIdCounter();
      const pmDoc = createPMDocWithSections(
        [
          {
            paragraphs: Array.from({ length: 8 }, (_, i) => `Paragraph number ${i + 1}. ${'word '.repeat(30)}`),
            props: {
              type: 'continuous',
              pageSize: PAGE_SIZES.LETTER_PORTRAIT,
              columns: { count: 2, gap: 48 },
              ...(bidi ? { bidi: true } : {}),
            },
          },
          { paragraphs: ['Tail section, back to a single column'] },
        ],
        { type: 'continuous', pageSize: PAGE_SIZES.LETTER_PORTRAIT },
      );
      const layout = await convertAndLayout(pmDoc, { pageSize: PAGE_SIZES.LETTER_PORTRAIT });
      // Only the multi-column section's own paragraphs; the tail section is single-column.
      const columnised = layout.pages[0].fragments.filter(
        (fragment) => fragment.blockId.endsWith('-paragraph') && paragraphIndex(fragment.blockId) < 8,
      );
      return columnised.sort((a, b) => paragraphIndex(a.blockId) - paragraphIndex(b.blockId));
    };

    const ltr = await balanced(false);
    const rtl = await balanced(true);

    // Balancing actually engaged: the 8 paragraphs are split across both columns, not stacked in one.
    const ltrXs = [...new Set(ltr.map((f) => Math.round(f.x)))];
    expect(ltrXs).toHaveLength(2);
    const [leftX, rightX] = ltrXs.sort((a, b) => a - b);

    // LTR balances into the left column first; RTL into the right one. Same split, mirrored sides.
    expect(ltr.map((f) => Math.round(f.x))).toEqual([leftX, leftX, leftX, leftX, rightX, rightX, rightX, rightX]);
    expect(rtl.map((f) => Math.round(f.x))).toEqual([rightX, rightX, rightX, rightX, leftX, leftX, leftX, leftX]);
    // Balancing must not disturb the vertical rhythm either.
    expect(rtl.map((f) => Math.round(f.y))).toEqual(ltr.map((f) => Math.round(f.y)));
  });

  it('treats an explicitly disabled w:bidi as left to right', async () => {
    // `<w:bidi w:val="0"/>` is the section opting out, not opting in.
    const layout = await layoutTwoColumnSection({ ...TWO_COLUMN_SECTION, bidi: false });
    const { columnXs, indicesByX } = readFirstPage(layout);

    expect(indicesByX.get(columnXs[0])![0]).toBe(0);
  });

  it('carries the section direction onto the column layout, and only when columns exist', async () => {
    const withColumns = pmToFlowBlocks(
      createPMDocWithSections([{ paragraphs: ['a'] }], { ...TWO_COLUMN_SECTION, bidi: true }),
    );
    expect(getSectionBreaks(withColumns.blocks).map((block) => block.columns)).toEqual([
      { count: 2, gap: 48, direction: 'rtl' },
    ]);

    // A single-column RTL section has no order to flip. The adapter must not invent a column layout
    // for it, or an unstyled section would start to look like it carries explicit column properties.
    const singleColumn = pmToFlowBlocks(
      createPMDocWithSections([{ paragraphs: ['a'] }], {
        type: 'nextPage',
        pageSize: PAGE_SIZES.LETTER_PORTRAIT,
        bidi: true,
      }),
    );
    expect(getSectionBreaks(singleColumn.blocks).map((block) => block.columns)).toEqual([undefined]);
  });
});
