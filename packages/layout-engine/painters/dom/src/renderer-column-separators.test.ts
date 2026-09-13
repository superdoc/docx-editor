import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import { createTestPainter as createDomPainter } from './_test-utils.js';
import type { ColumnRegion, Fragment, FlowBlock, Layout, Measure, Page } from '@superdoc/contracts';

// These tests pin down DomPainter's column-separator rendering:
//   - the fallback path (page.columns only, no mid-page regions)
//   - the region-aware path (page.columnRegions supersedes page.columns)
//   - the early-return guards inside renderColumnSeparators
//   - the content-presence gate: per Word's behavior, a separator is
//     suppressed when the column to its right is empty within the region.
// The layout-engine tests cover which data reaches the painter; these tests
// cover what the painter does with it.

// Minimal fragment factory for separator-presence assertions. We only need x
// (column placement) and y (region membership). The other fields are required
// by the contract but not read by renderColumnSeparators.
const fragAt = (x: number, y: number = 100): Fragment => ({
  kind: 'para',
  blockId: `frag-${x}-${y}`,
  fromLine: 0,
  toLine: 1,
  x,
  y,
  width: 100,
});

const buildPage = (overrides: Partial<Page> = {}): Page => ({
  number: 1,
  fragments: [],
  margins: { top: 96, right: 96, bottom: 96, left: 96 },
  ...overrides,
});

const buildLayout = (page: Page, pageSize = { w: 816, h: 1056 }): Layout => ({
  pageSize,
  pages: [page],
});

const querySeparators = (mount: HTMLElement): HTMLDivElement[] => {
  // Separators are the only 1px-wide absolutely-positioned divs added to a page.
  // Scoping by the inline styles keeps this brittle-free against unrelated
  // absolute-positioned overlays (rulers, selection, floats).
  return Array.from(mount.querySelectorAll('div')).filter((el) => {
    const s = el.style;
    return s.position === 'absolute' && s.width === '1px' && s.backgroundColor === '#000000';
  }) as HTMLDivElement[];
};

const paintOnce = (layout: Layout, mount: HTMLElement): void => {
  const painter = createDomPainter({ blocks: [], measures: [] });
  painter.paint(layout, mount);
};

// Like paintOnce, but registers extra blocks/measures first. `_test-utils`'s
// paint() auto-synthesizes a block+measure for any 'para' fragment (see
// createTestPainter in _test-utils.ts), but NOT for image/drawing/table
// fragments — resolveImageItem (layout-resolved/resolveImage.ts) throws
// "Missing block/measure entry" without a matching entry, so anchored-float
// fixtures below must supply one explicitly.
const paintWithBlocks = (layout: Layout, mount: HTMLElement, blocks: FlowBlock[], measures: Measure[]): void => {
  const painter = createDomPainter({ blocks, measures });
  painter.paint(layout, mount);
};

// Minimal image block/measure pair for anchored-float fixtures. `resolveImageItem`
// only checks the block/measure KIND matches ('image'/'image'); it never reads
// width/height off either — those come straight from the fragment — so one
// fixed pair covers every float test below regardless of the fragment's own size.
const FLOAT_BLOCK_ID = 'float-fixture';
const floatBlock: FlowBlock = {
  kind: 'image',
  id: FLOAT_BLOCK_ID,
  src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
  attrs: {},
};
const floatMeasure: Measure = { kind: 'image', width: 10, height: 10, scale: 1, naturalWidth: 10, naturalHeight: 10 };

// An anchored (floating) image fragment at a given page x/width. `isAnchored: true`
// is what `renderColumnSeparators`'s gate loop reads directly off `item.fragment`
// (FIX 1); `columnIndex` is never set here, so — pre-fix — attribution falls
// through to `columnOwningSpan` exactly like an ordinary fragment would.
const floatAt = (x: number, width: number, y: number = 100): Fragment => ({
  kind: 'image',
  blockId: FLOAT_BLOCK_ID,
  x,
  y,
  width,
  height: 10,
  isAnchored: true,
});

describe('DomPainter renderColumnSeparators', () => {
  let mount: HTMLElement;

  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  afterEach(() => {
    mount.remove();
  });

  describe('fallback path (page.columns only)', () => {
    it('draws a single separator centered in the gap for 2 equal columns', () => {
      // 2 cols at x=96 and x=384 (96+288). Fragments in both → separator
      // gate is satisfied; the test pins down geometry, not the gate.
      const page = buildPage({
        columns: { count: 2, gap: 48, withSeparator: true },
        fragments: [fragAt(96), fragAt(432)],
      });
      paintOnce(buildLayout(page), mount);

      const seps = querySeparators(mount);
      expect(seps).toHaveLength(1);
      // pageWidth=816, margins=96 → contentWidth=624, columnWidth=(624-48)/2=288.
      // separator x = leftMargin + columnWidth + gap/2 = 96 + 288 + 24 = 408.
      expect(seps[0].style.left).toBe('408px');
      expect(seps[0].style.top).toBe('96px');
      // height = pageHeight - top - bottom = 1056 - 96 - 96 = 864.
      expect(seps[0].style.height).toBe('864px');
    });

    it('gates an RTL separator on the LEFT column, which is the later one there', () => {
      // In an RTL section column 0 sits on the right, so "content past the separator" — the
      // condition Word uses to decide whether to draw the line at all — is content to its LEFT.
      // With the LTR test, a fragment that never left the FIRST column satisfies `x >= separatorX`
      // and the painter draws a line Word does not draw.
      const firstColumnOnly = buildPage({
        columns: { count: 2, gap: 48, withSeparator: true, direction: 'rtl' },
        fragments: [fragAt(432)],
      });
      paintOnce(buildLayout(firstColumnOnly), mount);
      expect(querySeparators(mount)).toHaveLength(0);

      mount.remove();
      mount = document.createElement('div');
      document.body.append(mount);

      const bothColumns = buildPage({
        columns: { count: 2, gap: 48, withSeparator: true, direction: 'rtl' },
        fragments: [fragAt(432), fragAt(96)],
      });
      paintOnce(buildLayout(bothColumns), mount);

      const seps = querySeparators(mount);
      expect(seps).toHaveLength(1);
      // Equal columns fill the content area, so the gutter — and the line in it — is where it was.
      expect(seps[0].style.left).toBe('408px');
    });

    it('does not let a page-wide anchored graphic satisfy the RTL gate', () => {
      // `page.items` carries anchored drawings as well as column content, and a page-relative
      // watermark sits at x = 0 spanning the whole page. Testing its LEFT edge against the
      // separator makes it 'past' the separator in RTL while the same item is never past it in
      // LTR, so a section whose text never left the first column would draw a line Word does not.
      const watermark: Fragment = { ...fragAt(0), width: 816 };
      const page = buildPage({
        columns: { count: 2, gap: 48, withSeparator: true, direction: 'rtl' },
        fragments: [fragAt(432), watermark],
      });
      paintOnce(buildLayout(page), mount);

      expect(querySeparators(mount)).toHaveLength(0);
    });

    it('draws the RTL separator for a wide right-aligned table whose x is OUTSIDE its column', () => {
      // The real shape of over-wide content, not the idealised one. `resolveTableFrame` right-aligns
      // a table inside its column, and `end` is the default justification for any bidiVisual table,
      // so an RTL table wider than its column gets a NEGATIVE offset: it starts left of its own
      // column and ends past the separator. Neither of its edges identifies the column it belongs
      // to, and neither does its origin. `columnIndex` — which the engine records as it lays the
      // fragment out — does.
      const wideRtlTable: Fragment = { ...fragAt(-116), width: 500, columnIndex: 1 };
      const page = buildPage({
        columns: { count: 2, gap: 48, withSeparator: true, direction: 'rtl' },
        fragments: [{ ...fragAt(432), columnIndex: 0 }, wideRtlTable],
      });
      paintOnce(buildLayout(page), mount);

      const seps = querySeparators(mount);
      expect(seps).toHaveLength(1);
      expect(seps[0].style.left).toBe('408px');
    });

    it('still ignores an over-wide table that belongs to the FIRST column', () => {
      // The other half of the contract: overflowing out of column 0 is not evidence that a later
      // column holds anything, whichever direction the columns run and wherever the box lands.
      const rtl = buildPage({
        columns: { count: 2, gap: 48, withSeparator: true, direction: 'rtl' },
        fragments: [{ ...fragAt(220), width: 500, columnIndex: 0 }],
      });
      paintOnce(buildLayout(rtl), mount);
      expect(querySeparators(mount)).toHaveLength(0);

      mount.remove();
      mount = document.createElement('div');
      document.body.append(mount);

      const ltr = buildPage({
        columns: { count: 2, gap: 48, withSeparator: true },
        fragments: [{ ...fragAt(96), width: 500, columnIndex: 0 }],
      });
      paintOnce(buildLayout(ltr), mount);
      expect(querySeparators(mount)).toHaveLength(0);
    });

    it('counts a fragment nudged out of its column by a negative indent', () => {
      // A negative `w:ind` puts a paragraph's origin in the gutter, outside every column span. The
      // engine still knows which column it belongs to, so the line must be drawn.
      const outdented: Fragment = { ...fragAt(422), columnIndex: 1 };
      const page = buildPage({
        columns: { count: 2, gap: 48, withSeparator: true },
        fragments: [{ ...fragAt(96), columnIndex: 0 }, outdented],
      });
      paintOnce(buildLayout(page), mount);

      expect(querySeparators(mount)).toHaveLength(1);
    });

    it('attributes a fragment on a zero-gap column boundary to the LATER column', () => {
      // With `w:space="0"` adjacent columns share an endpoint, and that endpoint is exactly where
      // the later column's content starts. Column spans are half-open so the boundary belongs to
      // the column that begins there, not the one that ends there.
      const page = buildPage({
        columns: { count: 2, gap: 0, withSeparator: true },
        fragments: [fragAt(96), fragAt(408)],
      });
      paintOnce(buildLayout(page), mount);

      expect(querySeparators(mount)).toHaveLength(1);
    });

    it('does not let a page-wide anchored graphic satisfy the LTR gate either', () => {
      // The watermark guard is not an RTL special case: an item that belongs to no column is not
      // evidence for any separator, whichever way the columns run.
      const watermark: Fragment = { ...fragAt(0), width: 816 };
      const page = buildPage({
        columns: { count: 2, gap: 48, withSeparator: true },
        fragments: [fragAt(96), watermark],
      });
      paintOnce(buildLayout(page), mount);

      expect(querySeparators(mount)).toHaveLength(0);
    });

    it('still draws the separator when the later column holds only an outdented paragraph', () => {
      // The paginator records `columnIndex` for tables and footnote bodies but not for ordinary
      // paragraphs, so a paragraph reaches the geometry fallback. A negative `w:ind` puts its
      // origin in the gutter, outside its own column: attributing by containment of the origin
      // would find no column and suppress a line Word draws.
      // 2 equal columns of 288 in a 624 content area: column 1 starts at 96 + 288 + 48 = 432.
      const outdented: Fragment = { ...fragAt(432 - 40), width: 288 };
      const page = buildPage({
        columns: { count: 2, gap: 48, withSeparator: true },
        fragments: [fragAt(96), outdented],
      });
      paintOnce(buildLayout(page), mount);

      expect(querySeparators(mount)).toHaveLength(1);
    });

    it('ignores content that overflows the FIRST column when nothing recorded its column', () => {
      // The sibling test above pins the same contract for a fragment the engine tagged with
      // `columnIndex: 0`. Ordinary paragraphs never carry that tag, so this one goes through the
      // geometry fallback — and attributing by overlap alone answers column 1 here: with
      // `widths: [100, 400]` a 500px box starting at column 0's own edge covers 100px of column 0
      // and 352px of column 1. Overflowing out of column 0 is not evidence that column 1 holds
      // anything, so the origin has to be consulted before the overlap.
      const overflowing: Fragment = { ...fragAt(96), width: 500 };
      const page = buildPage({
        columns: { count: 2, gap: 48, widths: [100, 400], equalWidth: false, withSeparator: true },
        fragments: [overflowing],
      });
      paintOnce(buildLayout(page), mount);

      expect(querySeparators(mount)).toHaveLength(0);
    });

    it('does not let a page-wide graphic satisfy the gate when explicit widths overfill the page', () => {
      // Explicit widths are floored to >= 1px but never CAPPED, so [150, 600] with a 48px gap
      // occupies 798px inside a 624px content area. Measured against the strip's OWN span a
      // page-wide item is merely partial, and overlap attribution then hands it to the column it
      // covers most: column 1, the wider one (150px of column 0 against 426px of column 1). That is
      // exactly the "a later column holds content" the gate asks about, so the line would be drawn
      // on a page where Word draws none. Bounding by the page content area as well is what stops it.
      //
      // Direction-independent: the LTR strip runs 0..150 / 198..798 and the mirrored RTL one
      // 474..624 / -174..426, and the graphic wins column 1 in both.
      const overfull = { count: 2, gap: 48, widths: [150, 600], equalWidth: false, withSeparator: true };
      // Spans the content area exactly: x = leftMargin, width = 816 - 96 - 96.
      const pageWide: Fragment = { ...fragAt(96), width: 624 };
      // Column 0 runs 96..246 in LTR page coordinates and 570..720 in RTL; column 1 runs 294..894
      // and -78..522. The second row is a positive control: ordinary content in the later column
      // still draws the line, so the suppression above is not vacuous.
      const cases = {
        ltr: { first: fragAt(96), later: fragAt(300) },
        rtl: { first: fragAt(570), later: fragAt(200) },
      } as const;

      for (const direction of ['ltr', 'rtl'] as const) {
        const { first, later } = cases[direction];
        for (const [fragments, expected] of [
          [[first, pageWide], 0],
          [[first, later], 1],
        ] as const) {
          mount.remove();
          mount = document.createElement('div');
          document.body.append(mount);

          paintOnce(buildLayout(buildPage({ columns: { ...overfull, direction }, fragments })), mount);
          expect(querySeparators(mount)).toHaveLength(expected);
        }
      }
    });

    it('draws count-1 separators for 3 equal columns', () => {
      const page = buildPage({
        columns: { count: 3, gap: 48, withSeparator: true },
        fragments: [fragAt(96), fragAt(320), fragAt(544)],
      });
      paintOnce(buildLayout(page), mount);

      const seps = querySeparators(mount);
      expect(seps).toHaveLength(2);
      // columnWidth = (624 - 48*2) / 3 = 176.
      // sep 0: 96 + 176 + 48/2 = 296. sep 1: 96 + 2*176 + 48 + 48/2 = 520.
      expect(seps.map((s) => s.style.left)).toEqual(['296px', '520px']);
    });

    it('uses authored explicit column widths (unscaled) when drawing separators (SD-2629)', () => {
      // Explicit widths are NOT scaled to fill: [200, 300] in a 576px available area stay [200, 300]
      // (trailing space), so the separator sits after the authored 200px column, not a scaled one.
      // (Old behavior scaled them up to [230.4, 345.6] and placed the separator near 350.)
      const page = buildPage({
        columns: { count: 2, gap: 48, widths: [200, 300], equalWidth: false, withSeparator: true },
        fragments: [fragAt(96), fragAt(360)],
      });
      paintOnce(buildLayout(page), mount);

      const seps = querySeparators(mount);
      expect(seps).toHaveLength(1);
      // separator = leftMargin + authored width[0] + gap/2 = 96 + 200 + 24 = 320.
      expect(seps[0].style.left).toBe('320px');
    });

    it('renders nothing when withSeparator is false', () => {
      const page = buildPage({ columns: { count: 2, gap: 48, withSeparator: false } });
      paintOnce(buildLayout(page), mount);

      expect(querySeparators(mount)).toHaveLength(0);
    });

    it('renders nothing when withSeparator is omitted (undefined)', () => {
      const page = buildPage({ columns: { count: 2, gap: 48 } });
      paintOnce(buildLayout(page), mount);

      expect(querySeparators(mount)).toHaveLength(0);
    });

    it('renders nothing for single-column pages', () => {
      const page = buildPage({ columns: { count: 1, gap: 0, withSeparator: true } });
      paintOnce(buildLayout(page), mount);

      expect(querySeparators(mount)).toHaveLength(0);
    });

    it('renders nothing when page has neither columns nor columnRegions', () => {
      paintOnce(buildLayout(buildPage()), mount);
      expect(querySeparators(mount)).toHaveLength(0);
    });

    it('renders nothing when page.margins is missing', () => {
      const page: Page = {
        number: 1,
        fragments: [],
        columns: { count: 2, gap: 48, withSeparator: true },
      };
      paintOnce(buildLayout(page), mount);
      expect(querySeparators(mount)).toHaveLength(0);
    });

    it('renders nothing when columnWidth collapses to <=1px', () => {
      // Pathological case: tiny page with a huge gap leaves no room for columns.
      const page = buildPage({
        margins: { top: 10, right: 10, bottom: 10, left: 10 },
        columns: { count: 2, gap: 100, withSeparator: true },
      });
      paintOnce(buildLayout(page, { w: 110, h: 200 }), mount);
      // contentWidth=90, columnWidth=(90-100)/2=-5 → guard fires.
      expect(querySeparators(mount)).toHaveLength(0);
    });

    it('renders nothing for equal columns whose gap overflows the content area (SD-2629 legacy guard)', () => {
      // count:3 with a gap so large the evenly-divided column width goes negative. normalize floors
      // fabricated widths at the full content width, so the geometry width alone would not reveal the
      // overflow; the pre-geometry equalWidth<=1 guard must still suppress the separators. The far
      // fragment sits past where the phantom separators would land, so only the guard (not the
      // content-past-separator gate) can suppress them.
      const page = buildPage({
        columns: { count: 3, gap: 400, withSeparator: true },
        fragments: [fragAt(96), fragAt(2000)],
      });
      paintOnce(buildLayout(page), mount);

      // contentWidth=624, equalWidth=(624-400*2)/3 < 0, so the guard fires.
      expect(querySeparators(mount)).toHaveLength(0);
    });
  });

  describe('region-aware path (page.columnRegions)', () => {
    it('draws per-region separators bounded by each region yStart/yEnd', () => {
      const regions: ColumnRegion[] = [
        { yStart: 96, yEnd: 400, columns: { count: 2, gap: 48, withSeparator: true } },
        { yStart: 400, yEnd: 700, columns: { count: 3, gap: 48, withSeparator: true } },
      ];
      // page.columns is set to the first region's config (matches what the
      // layout engine does); the renderer must prefer columnRegions.
      const page = buildPage({
        columns: regions[0].columns,
        columnRegions: regions,
        // Region 0 has fragments in both 2-col positions; Region 1 has one
        // in each of three columns.
        fragments: [fragAt(96, 200), fragAt(432, 200), fragAt(96, 500), fragAt(320, 500), fragAt(544, 500)],
      });
      paintOnce(buildLayout(page), mount);

      const seps = querySeparators(mount);
      // Region 0: 1 separator for 2-col. Region 1: 2 separators for 3-col.
      expect(seps).toHaveLength(3);

      // Region 0 bounds.
      expect(seps[0].style.top).toBe('96px');
      expect(seps[0].style.height).toBe('304px'); // 400 - 96
      expect(seps[0].style.left).toBe('408px');

      // Region 1 bounds.
      expect(seps[1].style.top).toBe('400px');
      expect(seps[1].style.height).toBe('300px'); // 700 - 400
      expect(seps[2].style.top).toBe('400px');
      expect(seps[2].style.height).toBe('300px');
      // 3-col positions computed fresh for region 1: 296px and 520px.
      expect([seps[1].style.left, seps[2].style.left]).toEqual(['296px', '520px']);
    });

    it('skips regions whose withSeparator is false even if other regions render', () => {
      const regions: ColumnRegion[] = [
        { yStart: 96, yEnd: 400, columns: { count: 2, gap: 48, withSeparator: true } },
        { yStart: 400, yEnd: 700, columns: { count: 2, gap: 48, withSeparator: false } },
        { yStart: 700, yEnd: 960, columns: { count: 2, gap: 48, withSeparator: true } },
      ];
      const page = buildPage({
        columnRegions: regions,
        fragments: [
          fragAt(96, 200),
          fragAt(432, 200),
          fragAt(96, 500),
          fragAt(432, 500),
          fragAt(96, 800),
          fragAt(432, 800),
        ],
      });
      paintOnce(buildLayout(page), mount);

      const seps = querySeparators(mount);
      expect(seps).toHaveLength(2);
      // Only regions 0 and 2 produce output.
      expect(seps.map((s) => s.style.top)).toEqual(['96px', '700px']);
      expect(seps.map((s) => s.style.height)).toEqual(['304px', '260px']);
    });

    it('skips single-column regions', () => {
      const regions: ColumnRegion[] = [
        { yStart: 96, yEnd: 400, columns: { count: 1, gap: 0, withSeparator: true } },
        { yStart: 400, yEnd: 700, columns: { count: 2, gap: 48, withSeparator: true } },
      ];
      const page = buildPage({
        columnRegions: regions,
        fragments: [fragAt(96, 500), fragAt(432, 500)],
      });
      paintOnce(buildLayout(page), mount);

      const seps = querySeparators(mount);
      expect(seps).toHaveLength(1);
      expect(seps[0].style.top).toBe('400px');
    });

    it('skips regions with non-positive height', () => {
      const regions: ColumnRegion[] = [
        { yStart: 96, yEnd: 96, columns: { count: 2, gap: 48, withSeparator: true } },
        { yStart: 96, yEnd: 500, columns: { count: 2, gap: 48, withSeparator: true } },
      ];
      const page = buildPage({
        columnRegions: regions,
        fragments: [fragAt(96, 200), fragAt(432, 200)],
      });
      paintOnce(buildLayout(page), mount);

      const seps = querySeparators(mount);
      expect(seps).toHaveLength(1);
      expect(seps[0].style.height).toBe('404px');
    });

    it('prefers columnRegions over page.columns when both are present', () => {
      // page.columns says "no separator", but columnRegions says "draw one".
      // The regions should win — they represent the authoritative per-region
      // state, page.columns only represents the page-start config.
      const page = buildPage({
        columns: { count: 2, gap: 48, withSeparator: false },
        columnRegions: [{ yStart: 96, yEnd: 960, columns: { count: 2, gap: 48, withSeparator: true } }],
        fragments: [fragAt(96), fragAt(432)],
      });
      paintOnce(buildLayout(page), mount);

      const seps = querySeparators(mount);
      expect(seps).toHaveLength(1);
      expect(seps[0].style.top).toBe('96px');
      expect(seps[0].style.height).toBe('864px');
    });

    it('uses authored explicit column widths when drawing separators for columnRegions (SD-2629)', () => {
      const page = buildPage({
        columnRegions: [
          {
            yStart: 96,
            yEnd: 500,
            columns: { count: 2, gap: 48, widths: [200, 952], equalWidth: false, withSeparator: true },
          },
        ],
        // Under authored-width geometry the separator sits at 96 + 200 + 24 = 320,
        // so the right-column fragment must sit past 320px for the content gate to draw it.
        fragments: [fragAt(96, 200), fragAt(360, 200)],
      });
      paintOnce(buildLayout(page), mount);

      const seps = querySeparators(mount);
      expect(seps).toHaveLength(1);
      expect(seps[0].style.top).toBe('96px');
      expect(seps[0].style.height).toBe('404px');
      expect(seps[0].style.left).toBe('320px');
    });
  });

  // The content-presence gate matches Word: a column separator is suppressed
  // when the column to its right has no content within the region. This is
  // observable in `multi-column-sections.docx` page 2 — Word draws no line
  // because the section's content fits entirely in column 0.
  describe('content-presence gate', () => {
    it('suppresses the separator when no fragment sits past the column boundary', () => {
      const page = buildPage({
        columns: { count: 2, gap: 48, withSeparator: true },
        // Only column 0 has content (x=96 < separatorX=408). Word draws nothing.
        fragments: [fragAt(96), fragAt(96, 300)],
      });
      paintOnce(buildLayout(page), mount);

      expect(querySeparators(mount)).toHaveLength(0);
    });

    it('draws only the separator whose right neighbor has content (3-col, col 3 empty)', () => {
      // 3 cols at x=96, x=320, x=544. Separators at 296 and 520.
      // Cols 1 and 2 have content; col 3 is empty. Only the 296 separator
      // draws; the 520 separator (col 2 → col 3 boundary) is suppressed.
      const page = buildPage({
        columns: { count: 3, gap: 48, withSeparator: true },
        fragments: [fragAt(96), fragAt(320)],
      });
      paintOnce(buildLayout(page), mount);

      const seps = querySeparators(mount);
      expect(seps).toHaveLength(1);
      expect(seps[0].style.left).toBe('296px');
    });

    it('checks fragment presence within the region only, not the whole page', () => {
      // Region 0 (2-col): only col 0 has content → no separator.
      // Region 1 (2-col): both cols have content → separator drawn.
      // Without the y-bounded gate, region 0's separator would draw because
      // region 1's col-1 fragment exists somewhere on the page.
      const regions: ColumnRegion[] = [
        { yStart: 96, yEnd: 400, columns: { count: 2, gap: 48, withSeparator: true } },
        { yStart: 400, yEnd: 700, columns: { count: 2, gap: 48, withSeparator: true } },
      ];
      const page = buildPage({
        columnRegions: regions,
        fragments: [
          fragAt(96, 200), // region 0, col 0
          fragAt(96, 500), // region 1, col 0
          fragAt(432, 500), // region 1, col 1
        ],
      });
      paintOnce(buildLayout(page), mount);

      const seps = querySeparators(mount);
      expect(seps).toHaveLength(1);
      expect(seps[0].style.top).toBe('400px');
      expect(seps[0].style.height).toBe('300px');
    });
  });

  // Reference geometry for every test below, derived (not assumed) from the real
  // normalizeColumnLayout/getColumnGeometry: page 816x1056, margins 96 all round →
  // contentWidth = 816 - 96 - 96 = 624. `{count:2, gap:48, withSeparator:true}` in
  // equal mode gives availableWidth = 624 - 48 = 576, so each column is 576/2 = 288.
  // Column 0 is content-relative [0,288), column 1 is [336,624) (288 + the 48 gap),
  // and the separator sits at the gutter midpoint, content x 312. Page x = content x
  // + leftMargin(96): col0 → page [96,384), col1 → page [432,720), separator → page
  // 408. In an RTL section the same equal-width strip mirrors about the content area
  // and lands on the identical page x's — verified in the existing "gates an RTL
  // separator on the LEFT column" test above — because column 0's mirrored span
  // [336,624) is column 1's un-mirrored span and vice versa.

  describe('FIX 1 - a float never lights the content-presence gate', () => {
    // `page.items` is `page.fragments.map(...)` with no anchor filtering (renderer.ts,
    // around the `occupiedColumns` loop), and an anchored fragment carries its own
    // width — so a narrow float is the ordinary case the gate has to reject, not an
    // exception. Verified against the pre-fix gate loop (git HEAD, commit 2438bd9,
    // before `if (source?.isAnchored === true) continue;` existed) via a scratch
    // replica built on the real normalizeColumnLayout/getColumnGeometry: for every
    // case below, the pre-fix loop (no anchor check, `columnOwningSpan` = pure overlap)
    // puts the float in column 1, drawing a separator at page x 408; the current gate
    // excludes it and draws none.
    it('excludes an anchored float whose origin sits inside the other column', () => {
      // Body text never leaves column 0 (page x 96, content x 0). A 200px-wide
      // anchored float at page x 500 has content x 500-96=404, inside column 1's
      // [336,624) span (404 < 624). Pre-fix: columnOwningSpan(404, 200) — overlap
      // with col0 is min(604,288)-max(404,0) = -116 → 0; overlap with col1 is
      // min(604,624)-max(404,336) = 200. Column 1 wins on overlap alone, occupied
      // becomes {0,1}, and column 0's separator (content x 312) draws because a
      // LATER column (1) is occupied. Post-fix the float is skipped before
      // `columnOwningSpan` ever runs, occupied stays {0}, and the gate stays shut.
      const page = buildPage({
        columns: { count: 2, gap: 48, withSeparator: true },
        fragments: [fragAt(96), floatAt(500, 200)],
      });
      paintWithBlocks(buildLayout(page), mount, [floatBlock], [floatMeasure]);

      expect(querySeparators(mount)).toHaveLength(0);
    });

    it('excludes an anchored float sitting entirely in the gutter', () => {
      // A 40px float at page x 416 has content x 416-96=320, inside the gutter
      // (288 <= 320 < 336) — outside BOTH columns' own spans. Pre-fix overlap still
      // awards it column 1: overlap with col0 is min(360,288)-max(320,0) = -32 → 0;
      // overlap with col1 is min(360,624)-max(320,336) = 24 > 0, so column 1 wins by
      // the only nonzero margin. Same outcome as the wider float above — occupied
      // {0,1} pre-fix draws the separator, {0} post-fix does not — confirming the
      // exclusion isn't just catching floats that already sit in a column's span.
      const page = buildPage({
        columns: { count: 2, gap: 48, withSeparator: true },
        fragments: [fragAt(96), floatAt(416, 40)],
      });
      paintWithBlocks(buildLayout(page), mount, [floatBlock], [floatMeasure]);

      expect(querySeparators(mount)).toHaveLength(0);
    });

    it('excludes an anchored float in an RTL section too', () => {
      // Mirrored geometry: column 0 (fill-order first) is on the RIGHT, content
      // [336,624) / page [432,720); column 1 is on the LEFT, content [0,288) / page
      // [96,384) (see the reference-geometry note above this describe block, and the
      // existing "gates an RTL separator on the LEFT column" test, which pins the
      // same mirrored spans). Body text stays in column 0 (page x 432). A 200px
      // float at page x 150 has content x 150-96=54, entirely inside column 1's
      // [0,288) span (54+200=254 < 288) — overlap picks it with no ambiguity: overlap
      // with col1 is the full 200, overlap with col0 is 0. Pre-fix that occupies
      // column 1 and draws the separator (content x 312 either direction, since
      // equal columns fill the content area exactly); post-fix the float is skipped
      // and only column 0 is occupied, so the gate stays shut — the exclusion is
      // direction-independent, matching FIX 1's own reasoning (`hRelativeFrom` never
      // reaches the fragment, so every float is excluded, not only page-relative ones).
      const page = buildPage({
        columns: { count: 2, gap: 48, withSeparator: true, direction: 'rtl' },
        fragments: [fragAt(432), floatAt(150, 200)],
      });
      paintWithBlocks(buildLayout(page), mount, [floatBlock], [floatMeasure]);

      expect(querySeparators(mount)).toHaveLength(0);
    });

    it('still draws the separator for a NON-anchored fragment at the same position (guard)', () => {
      // Positive control for the exclusion above, same page x 500 / width 200 as the
      // first case, but the fragment is ordinary column content (isAnchored omitted).
      // This is not expected to fail against pre-fix HEAD — it doesn't: both the
      // pre-fix pure-overlap columnOwningSpan and the current one attribute this box
      // to column 1 (overlap/fit both favor it, since the box sits entirely past
      // column 0), so both draw the separator. It's here as a guard against
      // over-breadth: proving the FIX 1 exclusion is keyed on `isAnchored`
      // specifically, not on "any narrow box past the first column."
      const page = buildPage({
        columns: { count: 2, gap: 48, withSeparator: true },
        fragments: [fragAt(96), { ...fragAt(500), width: 200 }],
      });
      paintOnce(buildLayout(page), mount);

      expect(querySeparators(mount)).toHaveLength(1);
      expect(querySeparators(mount)[0].style.left).toBe('408px');
    });
  });

  describe('FIX 2 - an out-of-range recorded columnIndex is rejected, not clamped', () => {
    it('rejects columnIndex:5 on a 2-column page rather than clamping it to column 1', () => {
      // The only fragment on the page sits at page x 96 (content x 0), which geometry
      // alone attributes to column 0. It also carries a stale/corrupt `columnIndex: 5`
      // — there is no column 5 on a 2-column page (lastColumnIndex is 1). Pre-fix (git
      // HEAD): `Math.max(0, Math.min(1, Math.floor(5)))` clamps that to column 1,
      // occupying it and drawing the separator at page x 408 even though nothing is
      // really there. Post-fix: 5 is outside [0, lastColumnIndex] after flooring, so
      // the record is rejected outright and attribution falls through to geometry,
      // which (correctly) says column 0 — leaving column 1 unoccupied and the gate shut.
      const page = buildPage({
        columns: { count: 2, gap: 48, withSeparator: true },
        fragments: [{ ...fragAt(96), columnIndex: 5 }],
      });
      paintOnce(buildLayout(page), mount);

      expect(querySeparators(mount)).toHaveLength(0);
    });

    it('still lets a valid recorded columnIndex beat geometry (guard)', () => {
      // Same page x 96 (content x 0) that geometry alone would call column 0, but
      // this time columnIndex:1 is IN range (0 <= 1 <= lastColumnIndex 1). This is not
      // expected to fail against pre-fix HEAD — it doesn't: a valid record was never
      // clamped either version, only an out-of-range one, so both accept it and draw
      // the separator. It's here to guard the boundary the fix drew: rejection is for
      // out-of-range records specifically, not for every mismatch between the record
      // and where geometry would have placed the fragment.
      const page = buildPage({
        columns: { count: 2, gap: 48, withSeparator: true },
        fragments: [{ ...fragAt(96), columnIndex: 1 }],
      });
      paintOnce(buildLayout(page), mount);

      const seps = querySeparators(mount);
      expect(seps).toHaveLength(1);
      expect(seps[0].style.left).toBe('408px');
    });

    it('floors a near-integer columnIndex before range-checking it (guard)', () => {
      // columnIndex: 1.0000001 (ordinary float drift, not corruption) floors to 1,
      // which IS in range, and resolves to column 1 — it must not be discarded as
      // "out of range" by comparing the unfloored 1.0000001 against lastColumnIndex
      // first. Not expected to fail against pre-fix HEAD — it doesn't: the pre-fix
      // clamp expression also floors before comparing (`Math.floor(owned)` is the
      // innermost call in both versions), so this pins the flooring order rather than
      // distinguishing the two. Kept as a guard because the reject-vs-clamp rewrite
      // touched this exact expression and a reordering slip here would be silent.
      const page = buildPage({
        columns: { count: 2, gap: 48, withSeparator: true },
        fragments: [{ ...fragAt(96), columnIndex: 1.0000001 }],
      });
      paintOnce(buildLayout(page), mount);

      const seps = querySeparators(mount);
      expect(seps).toHaveLength(1);
      expect(seps[0].style.left).toBe('408px');
    });
  });

  describe('a box wider than its column is the only origin the gate distrusts', () => {
    // Why WIDTH and not the right edge, stated once for both cases below. An edge gate would be
    // dead code: pass it and the box lies wholly inside one column's span, and since
    // `getColumnGeometry` never emits overlapping spans, every other column's overlap is zero and
    // the vote below returns the same column anyway. Swept over outdents from 0 to 160px in 2px
    // steps, an edge-gated containment step and plain overlap never disagreed once. The width gate
    // is what makes the step do work, because it admits the one shape whose right edge overhangs
    // while its origin is still authoritative -- the right-aligned frame in the first test.
    it('keeps a right-aligned framed paragraph in the column its origin is in', () => {
      // `w:framePr` with `xAlign="right"` re-points the fragment at
      // `columnX + (effectiveColumnWidth - maxLineWidth)` (layout-paragraph.ts, `floatAlignment`)
      // and leaves `width` at the FULL column width, so the recorded box overhangs the gutter and
      // the next column while the text never left column 0. Two equal 288px columns over 624 put a
      // frame whose longest line is 50px at content-relative 238 with width 288, i.e. the box
      // [238, 526]: neither edge lands on a column edge, and overlap alone favours the neighbour --
      // 50px of column 0 against 190px of column 1 -- so the gate drew a separator on a page with
      // nothing in its second column.
      //
      // This is why origin containment is gated on the box's WIDTH and not on its right edge. The
      // box is 288 wide against a 288px column, so it fits, and its origin is believed. Gating on
      // the right edge rejects it (526 > 288) and hands it to the overlap vote, which is wrong.
      const framed: Fragment = { ...fragAt(96 + 288 - 50), width: 288 };
      const page = buildPage({
        columns: { count: 2, gap: 48, withSeparator: true },
        fragments: [fragAt(96), framed],
      });
      paintOnce(buildLayout(page), mount);

      expect(querySeparators(mount)).toHaveLength(0);
    });

    it('still distrusts the origin of a box that outgrew its column', () => {
      // The shape that actually reaches the gate's rejection path. `resolveTableFrame` centres an
      // over-wide table inside its column, at `col.x + (col.width - width) / 2` -- a NEGATIVE offset
      // once the table is wider than the column -- so it begins inside an earlier column without
      // ever having left its own. A 400px box centred in column 1 of two equal 288px columns over
      // 624 is [280, 680]: neither edge lands on a column edge (680 misses column 1's 624 by 56),
      // the origin 280 falls inside column 0, and 400 does not fit a 288px column. So the origin is
      // rejected and the overlap vote answers column 1, 288px against 8px.
      //
      // An outdented paragraph does NOT reach here, though this test used one until cubic pointed
      // out that it could not. A negative `w:ind` widens the fragment by exactly the outdent it
      // shifts by, so `x + width` lands on its own column's trailing edge for every outdent and the
      // trailing-edge rule answers first. Worth recording rather than quietly swapping the fixture:
      // that outdent was the only guard on this gate, and replacing the width comparison with
      // unconditional origin trust left all 39 tests in this file passing.
      const centredOverWide: Fragment = { ...fragAt(96 + 280), width: 400 };
      const page = buildPage({
        columns: { count: 2, gap: 48, withSeparator: true },
        fragments: [fragAt(96), centredOverWide],
      });
      paintOnce(buildLayout(page), mount);

      expect(querySeparators(mount)).toHaveLength(1);
    });
  });

  describe('FIX 4 - columnOwningSpan folds the geometry bound instead of spreading it', () => {
    it('does not throw for a six-figure column count', () => {
      // `Math.min(...arr)`/`Math.max(...arr)` pass every element as a call argument,
      // and V8 has a hard argument-count ceiling on that: a scratch check on this
      // machine (plain `node -e`, this repo's pinned Node) found the largest array
      // Math.min(...arr) still accepts is 124729 elements — 124730 throws
      // `RangeError: Maximum call stack size exceeded`. 150000 is comfortably past
      // that measured threshold (and the task-suggested count), with margin for a
      // deeper call stack inside the real test runner.
      //
      // Reaching columnOwningSpan at all takes a layout that survives
      // resolveSeparatorColumnGeometry's OWN pre-geometry guard: equal-mode columns
      // are rejected pre-geometry when (contentWidth - gap*(count-1))/count <= 1.
      // With gap 0 that requires contentWidth > count, so this page is 200020px wide
      // with 10px margins (contentWidth 200000) against a 150000-column layout —
      // equalWidth = 200000/150000 ≈ 1.33, just over the guard, and each of the
      // 150000 columns floors to that same ~1.33px width, so geometry.some(w<=1)
      // (the other pre-existing guard) doesn't reject it either. A single fragment at
      // the content origin (page x 10) is enough to reach columnOwningSpan — it isn't
      // testing WHICH column wins, only that resolving one doesn't crash the paint.
      //
      // Confirmed via the scratch replica against this exact 150000-column geometry:
      // the pre-fix (git HEAD) columnOwningSpan throws `RangeError: Maximum call
      // stack size exceeded` on `Math.min(...geometry.map(...))`; the current,
      // fold-based one returns a plain column index with no throw.
      const page = buildPage({
        margins: { top: 10, right: 10, bottom: 10, left: 10 },
        columns: { count: 150000, gap: 0, withSeparator: true },
        fragments: [{ ...fragAt(10), width: 100 }],
      });

      expect(() => paintOnce(buildLayout(page, { w: 200020, h: 400 }), mount)).not.toThrow();
    });
  });
});
