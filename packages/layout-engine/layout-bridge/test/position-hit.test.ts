import { describe, expect, it } from 'vite-plus/test';
import type { FlowBlock, ParagraphAttrs, Layout, Page, TableFragment } from '@superdoc/contracts';
import { isRtlBlock, determineColumn, determineTableColumn } from '../src/position-hit';

const paragraph = (attrs?: Record<string, unknown>): FlowBlock => ({
  kind: 'paragraph',
  id: 'p1',
  runs: [],
  attrs: attrs as ParagraphAttrs | undefined,
});

describe('isRtlBlock', () => {
  it('uses resolved paragraph direction context for inline direction', () => {
    expect(
      isRtlBlock(
        paragraph({
          directionContext: {
            inlineDirection: 'rtl',
            writingMode: 'horizontal-tb',
          },
        }),
      ),
    ).toBe(true);
  });

  it('does not treat writing mode as inline RTL direction', () => {
    expect(isRtlBlock(paragraph({ textDirection: 'tbRl' }))).toBe(false);
  });

  it('lets resolved direction context override paragraphProperties.rightToLeft', () => {
    expect(
      isRtlBlock(
        paragraph({
          paragraphProperties: { rightToLeft: true },
          directionContext: {
            inlineDirection: 'ltr',
            writingMode: 'horizontal-tb',
          },
        }),
      ),
    ).toBe(false);
  });

  it('falls through to paragraphProperties.rightToLeft when directionContext.inlineDirection is undefined', () => {
    // The resolver may produce inlineDirection: undefined when no paragraph w:bidi is set
    // anywhere in the cascade. In that case the typed context carries no inline-direction
    // signal, and the PM-node paragraphProperties.rightToLeft fallback still applies.
    expect(
      isRtlBlock(
        paragraph({
          paragraphProperties: { rightToLeft: true },
          directionContext: {
            inlineDirection: undefined,
            writingMode: 'horizontal-tb',
          },
        }),
      ),
    ).toBe(true);
  });

  // SD-2778: switching to getParagraphInlineDirection is strictly broader on
  // fallback than the prior inline read. Specifically, the helper picks up
  // paragraphProperties.rightToLeft when neither directionContext nor the legacy
  // scalar field is present. Pin that case so the broader fallback is intentional.
  it('falls back to paragraphProperties.rightToLeft when no other direction signal is present', () => {
    expect(isRtlBlock(paragraph({ paragraphProperties: { rightToLeft: true } }))).toBe(true);
    expect(isRtlBlock(paragraph({ paragraphProperties: { rightToLeft: false } }))).toBe(false);
  });
});

describe('determineColumn (SD-2629: resolved per-column boundaries)', () => {
  const makeLayout = (columns: Layout['columns']): Layout =>
    ({ pageSize: { w: 600, h: 800 }, pages: [], columns }) as unknown as Layout;

  it('returns 0 for single-column or missing columns', () => {
    expect(determineColumn(makeLayout(undefined), 300)).toBe(0);
    expect(determineColumn(makeLayout({ count: 1, gap: 0 }), 300)).toBe(0);
  });

  it('maps x to equal columns by uniform boundaries', () => {
    // Two equal columns in a 600px page (gap 0): boundary at 300.
    const layout = makeLayout({ count: 2, gap: 0 });
    expect(determineColumn(layout, 100)).toBe(0);
    expect(determineColumn(layout, 350)).toBe(1);
  });

  it('honors per-column widths for explicit columns, not a uniform stride', () => {
    // Explicit unequal widths [100, 400] (gap 0): the boundary is at the authored 100px, not the
    // equal-split 300px. x=150 lands in column 1, where a uniform stride would say column 0.
    const layout = makeLayout({ count: 2, gap: 0, widths: [100, 400], equalWidth: false });
    expect(determineColumn(layout, 50)).toBe(0);
    expect(determineColumn(layout, 150)).toBe(1);
  });

  it('maps an absolute x using the page margins and content width, not full page from origin 0 (SD-2629)', () => {
    // 3 equal columns in an 816px page with 96px side margins: content width 624 -> 192px columns.
    // Column boundaries are absolute (marginLeft + content-relative x), so a click must be resolved
    // over the content box. Resolving over the full page width from origin 0 (the prior behavior)
    // mis-classifies clicks near the boundaries once margins are non-zero.
    const page = {
      columns: { count: 3, gap: 24 },
      margins: { left: 96, right: 96 },
      size: { w: 816, h: 1056 },
    } as unknown as Page;
    const layout = { pageSize: { w: 816, h: 1056 }, columns: page.columns, pages: [page] } as unknown as Layout;
    // col1 starts at 96 + 192 + 24 = 312; x=300 is left of it -> col 0. Full-page math (boundary 280)
    // would wrongly return col 1.
    expect(determineColumn(layout, 300, page)).toBe(0);
    // col2 starts at 96 + 2*(192+24) = 528; x=540 is past it -> col 2. Full-page math (boundary 560)
    // would wrongly return col 1.
    expect(determineColumn(layout, 540, page)).toBe(2);
  });

  it('resolves a click to the visually containing column in an RTL section', () => {
    // In an RTL section column 0 sits against the RIGHT margin, so a click on the right half of the
    // page selects the FIRST column. Resolving this with the left-to-right rule sends every click to
    // the wrong column — the issue's "clicks will select the wrong column".
    const columns = { count: 3, gap: 24, direction: 'rtl' as const };
    const page = {
      columns,
      margins: { left: 96, right: 96 },
      size: { w: 816, h: 1056 },
    } as unknown as Page;
    const layout = { pageSize: { w: 816, h: 1056 }, columns, pages: [page] } as unknown as Layout;

    // Content width 624 -> 192px columns with a 24px gutter between them. Mirrored, column 0 spans
    // 528..720, column 1 312..504, column 2 96..288 (absolute) -- each start is the previous
    // column's start less width+gap, so the gutters are 504..528 and 288..312.
    expect(determineColumn(layout, 700, page)).toBe(0);
    expect(determineColumn(layout, 400, page)).toBe(1);
    expect(determineColumn(layout, 150, page)).toBe(2);
    // The outer margins stay with their own end columns.
    expect(determineColumn(layout, 816, page)).toBe(0);
    expect(determineColumn(layout, 0, page)).toBe(2);

    // Same geometry without the direction keeps answering left to right.
    const ltrColumns = { count: 3, gap: 24 };
    const ltrPage = { ...page, columns: ltrColumns } as unknown as Page;
    const ltrLayout = { pageSize: { w: 816, h: 1056 }, columns: ltrColumns, pages: [ltrPage] } as unknown as Layout;
    expect(determineColumn(ltrLayout, 700, ltrPage)).toBe(2);
    expect(determineColumn(ltrLayout, 150, ltrPage)).toBe(0);
  });

  it('maps a hit to its mid-page column region, not the page-start columns (SD-2629)', () => {
    // A continuous section break splits the page: region 0 (y 96-300) is single-column; region 1
    // (y 300-700) is two-column. page.columns is only the page-START config (single column), so a
    // fragment in region 1 must be resolved with the region's two-column geometry, by its y.
    const page = {
      columns: { count: 1, gap: 0 },
      columnRegions: [
        { yStart: 96, yEnd: 300, columns: { count: 1, gap: 0 } },
        { yStart: 300, yEnd: 700, columns: { count: 2, gap: 24 } },
      ],
      margins: { left: 96, right: 96 },
      size: { w: 816, h: 1056 },
    } as unknown as Page;
    const layout = { pageSize: { w: 816, h: 1056 }, columns: page.columns, pages: [page] } as unknown as Layout;
    // y=400 is in the two-column region; x=450 is past col1's start (96 + 300 + 24 = 420) -> column 1.
    expect(determineColumn(layout, 450, page, 400)).toBe(1);
    // y=200 is in the single-column region -> column 0 at the same x (page.columns alone would always
    // say 0; the region lookup is what makes the y=400 case return 1).
    expect(determineColumn(layout, 450, page, 200)).toBe(0);
  });

  it('clamps a table fragment columnIndex against its mid-page region count, not page-start (SD-2629)', () => {
    // Table fragments carry columnIndex (the column they were laid out in). A table in a mid-page
    // two-column region has columnIndex 1; clamping against the page-START single-column count would
    // wrongly snap it to 0. Clamp against the region's count, selected by the fragment's y.
    const page = {
      columns: { count: 1, gap: 0 },
      columnRegions: [
        { yStart: 96, yEnd: 300, columns: { count: 1, gap: 0 } },
        { yStart: 300, yEnd: 700, columns: { count: 2, gap: 24 } },
      ],
      margins: { left: 96, right: 96 },
      size: { w: 816, h: 1056 },
    } as unknown as Page;
    const layout = { pageSize: { w: 816, h: 1056 }, columns: page.columns, pages: [page] } as unknown as Layout;
    const tableInRegion = { kind: 'table', x: 96, y: 400, columnIndex: 1 } as unknown as TableFragment;
    const tableInSingle = { kind: 'table', x: 96, y: 200, columnIndex: 1 } as unknown as TableFragment;
    // y=400 is in the two-column region (count 2) -> columnIndex 1 is preserved.
    expect(determineTableColumn(layout, tableInRegion, page)).toBe(1);
    // y=200 is in the single-column region (count 1) -> columnIndex 1 clamps to 0.
    expect(determineTableColumn(layout, tableInSingle, page)).toBe(0);
  });
});
