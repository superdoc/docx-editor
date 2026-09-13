import { describe, expect, it } from 'vite-plus/test';
import type { ColumnLayout } from './index.js';
import {
  cloneColumnLayout,
  columnLayoutsEqual,
  columnRenderLayoutsEqual,
  getColumnAtX,
  getColumnGapAfter,
  getColumnGeometry,
  getColumnSeparatorPositions,
  getColumnWidth,
  getColumnX,
  normalizeColumnLayout,
  resolveColumnCount,
  resolveColumnLayout,
  resolveColumnMode,
  widthsEqual,
  findColumnContaining,
} from './column-layout.js';

describe('widthsEqual', () => {
  it('treats two missing width arrays as equal', () => {
    expect(widthsEqual()).toBe(true);
  });

  it('returns false when only one width array is present', () => {
    expect(widthsEqual([72], undefined)).toBe(false);
    expect(widthsEqual(undefined, [72])).toBe(false);
  });

  it('returns true for identical width arrays', () => {
    expect(widthsEqual([72, 144], [72, 144])).toBe(true);
  });

  it('returns false for arrays with different lengths', () => {
    expect(widthsEqual([72], [72, 144])).toBe(false);
  });

  it('returns false for arrays with different values', () => {
    expect(widthsEqual([72, 144], [72, 145])).toBe(false);
  });
});

describe('cloneColumnLayout', () => {
  it('returns a default single-column layout when input is missing', () => {
    expect(cloneColumnLayout()).toEqual({ count: 1, gap: 0 });
  });

  it('clones count, gap, widths, and equalWidth', () => {
    const original: ColumnLayout = {
      count: 2,
      gap: 18,
      widths: [72, 144],
      equalWidth: false,
    };

    expect(cloneColumnLayout(original)).toEqual(original);
  });

  it('creates a defensive copy of widths', () => {
    const original: ColumnLayout = {
      count: 2,
      gap: 18,
      widths: [72, 144],
      equalWidth: false,
    };

    const cloned = cloneColumnLayout(original);

    expect(cloned).not.toBe(original);
    expect(cloned.widths).not.toBe(original.widths);

    cloned.widths?.push(216);
    expect(original.widths).toEqual([72, 144]);
  });

  it('omits optional fields that were not provided', () => {
    expect(cloneColumnLayout({ count: 2, gap: 18 })).toEqual({
      count: 2,
      gap: 18,
    });
  });
});

describe('normalizeColumnLayout', () => {
  it('returns a default single column when input is missing', () => {
    expect(normalizeColumnLayout(undefined, 480)).toEqual({
      count: 1,
      gap: 0,
      widths: [480],
      width: 480,
      contentWidth: 480,
    });
  });

  it('computes equal-width columns from count and gap', () => {
    expect(normalizeColumnLayout({ count: 2, gap: 24 }, 624)).toEqual({
      count: 2,
      gap: 24,
      widths: [300, 300],
      width: 300,
      contentWidth: 624,
    });
  });

  it('does not scale explicit widths; authored widths are preserved (SD-2629 step 4)', () => {
    // Word renders authored column widths as-is and leaves trailing space when they underfill, so
    // [100, 200] in a 600px content area stays [100, 200] rather than stretching to [200, 400].
    expect(normalizeColumnLayout({ count: 2, gap: 24, widths: [100, 200], equalWidth: false }, 624)).toEqual({
      count: 2,
      gap: 24,
      widths: [100, 200],
      equalWidth: false,
      width: 200,
      contentWidth: 624,
    });
  });

  it('does not scale DOWN overfull explicit widths either; authored widths overflow (SD-2629, Word-verified)', () => {
    // Word keeps authored explicit widths even when they EXCEED the content area: a Word probe of two
    // 360pt columns + 36pt gap in a 468pt content box renders both at 360pt, with column 2 overflowing
    // off the page edge (Word re-saves the w:cols unchanged). So normalize must not scale down either -
    // [200, 400] in a 300px content box stays [200, 400] (overfull), matching Word's overflow.
    expect(normalizeColumnLayout({ count: 2, gap: 24, widths: [200, 400], equalWidth: false }, 300)).toEqual({
      count: 2,
      gap: 24,
      widths: [200, 400],
      equalWidth: false,
      width: 400,
      contentWidth: 300,
    });
  });

  it('ignores widths when equalWidth is omitted and divides evenly (SD-2324: omitted = equal mode)', () => {
    // Omitted equalWidth is equal mode in Word; any widths present are not authoritative.
    expect(normalizeColumnLayout({ count: 2, gap: 24, widths: [100, 200] }, 624)).toEqual({
      count: 2,
      gap: 24,
      widths: [300, 300],
      width: 300,
      contentWidth: 624,
    });
  });

  it('ignores widths when equalWidth is true and divides evenly (SD-2324)', () => {
    expect(normalizeColumnLayout({ count: 2, gap: 24, widths: [100, 200], equalWidth: true }, 624)).toEqual({
      count: 2,
      gap: 24,
      widths: [300, 300],
      equalWidth: true,
      width: 300,
      contentWidth: 624,
    });
  });

  it('clamps count to the explicit-widths length when w:num exceeds it (SD-2324 F8)', () => {
    // w:num="4" with only two explicit widths: the surplus columns have no width and must not
    // be synthesized as ~0px slivers (the F8 phantom-column bug). Clamp to the two real columns.
    expect(normalizeColumnLayout({ count: 4, gap: 48, widths: [192, 384], equalWidth: false }, 624)).toEqual({
      count: 2,
      gap: 48,
      widths: [192, 384],
      equalWidth: false,
      width: 384,
      contentWidth: 624,
    });
  });

  it('falls back to a single column when there is no usable content width', () => {
    expect(normalizeColumnLayout({ count: 3, gap: 24 }, 0, 0.01)).toEqual({
      count: 1,
      gap: 0,
      width: 0,
      contentWidth: 0,
    });
  });
});

describe('getColumnGeometry + geometry helpers (SD-2629)', () => {
  it('mirrors equal-width normalized output (uniform gap, content-relative x)', () => {
    const geom = getColumnGeometry(normalizeColumnLayout({ count: 2, gap: 24 }, 624));
    expect(geom).toEqual([
      { index: 0, x: 0, width: 300, gapAfter: 24 },
      { index: 1, x: 324, width: 300, gapAfter: 0 },
    ]);
  });

  it('mirrors explicit widths without scaling (SD-2629 step 4)', () => {
    const geom = getColumnGeometry(
      normalizeColumnLayout({ count: 2, gap: 24, widths: [100, 200], equalWidth: false }, 624),
    );
    expect(geom).toEqual([
      { index: 0, x: 0, width: 100, gapAfter: 24 },
      { index: 1, x: 124, width: 200, gapAfter: 0 },
    ]);
  });

  it('reflects the F8 count clamp (4 declared, 2 widths => 2 columns)', () => {
    const geom = getColumnGeometry(
      normalizeColumnLayout({ count: 4, gap: 48, widths: [192, 384], equalWidth: false }, 624),
    );
    expect(geom).toHaveLength(2);
    expect(geom.map((c) => c.width)).toEqual([192, 384]);
  });

  it('places a separator centered in the gap after each non-last column', () => {
    const geom = getColumnGeometry(normalizeColumnLayout({ count: 2, gap: 24, withSeparator: true }, 624));
    expect(geom[0].separatorX).toBe(312);
    expect(geom[1].separatorX).toBeUndefined();
    expect(getColumnSeparatorPositions(geom, 96)).toEqual([408]);
  });

  it('resolves width / x / gap / column-at-x with an explicit originX', () => {
    const geom = getColumnGeometry(normalizeColumnLayout({ count: 2, gap: 24 }, 624));
    expect(getColumnWidth(geom, 1)).toBe(300);
    expect(getColumnX(geom, 1, 96)).toBe(420);
    expect(getColumnGapAfter(geom, 0)).toBe(24);
    expect(getColumnGapAfter(geom, 1)).toBe(0);
    expect(getColumnAtX(geom, 96 + 330, 96)).toBe(1);
    expect(getColumnAtX(geom, 96 + 100, 96)).toBe(0);
  });

  it('lets per-column gaps drive geometry (SD-2629 step 4)', () => {
    // gaps[i] is the gap after column i; geometry uses it instead of the uniform scalar gap.
    const geom = getColumnGeometry({ count: 2, gap: 24, widths: [300, 300], gaps: [999], width: 300 });
    expect(geom[0].gapAfter).toBe(999);
    expect(geom[1].x).toBe(300 + 999);
  });

  it('expands an equal-mode layout with no widths array to `count` columns (SD-2629 regression)', () => {
    // A hand-built equal-mode layout (column-balancing) carries only the scalar `width`, no widths
    // array. Geometry must still yield `count` columns; collapsing to a single column mapped every
    // index past 0 onto column 0's x, stacking balanced multi-column content on the left margin.
    const geom = getColumnGeometry({ count: 2, gap: 48, width: 288 });
    expect(geom).toEqual([
      { index: 0, x: 0, width: 288, gapAfter: 48 },
      { index: 1, x: 336, width: 288, gapAfter: 0 },
    ]);
    expect(getColumnX(geom, 1, 96)).toBe(432);
  });
});

describe('columnLayoutsEqual', () => {
  it('treats layouts differing only by gaps as not equal', () => {
    const a: ColumnLayout = { count: 2, gap: 24, widths: [200, 400], gaps: [24], equalWidth: false };
    const b: ColumnLayout = { count: 2, gap: 24, widths: [200, 400], gaps: [48], equalWidth: false };
    expect(columnLayoutsEqual(a, b)).toBe(false);
    expect(columnLayoutsEqual(a, { ...a, gaps: [24] })).toBe(true);
  });

  it('matches on the full shape and handles missing inputs', () => {
    expect(columnLayoutsEqual(undefined, undefined)).toBe(true);
    expect(columnLayoutsEqual({ count: 2, gap: 24 }, { count: 3, gap: 24 })).toBe(false);
  });
});

describe('resolveColumnMode (SD-2629)', () => {
  it('is explicit only when equalWidth is false AND usable widths exist', () => {
    expect(resolveColumnMode({ count: 2, gap: 24, widths: [100, 200], equalWidth: false })).toBe('explicit');
  });

  it('is equal when equalWidth is true, even with widths present', () => {
    expect(resolveColumnMode({ count: 2, gap: 24, widths: [100, 200], equalWidth: true })).toBe('equal');
  });

  it('is equal when equalWidth is omitted (Word divides evenly)', () => {
    expect(resolveColumnMode({ count: 2, gap: 24, widths: [100, 200] })).toBe('equal');
  });

  it('is equal when explicit mode is declared but no usable widths are supplied', () => {
    expect(resolveColumnMode({ count: 2, gap: 24, equalWidth: false })).toBe('equal');
    expect(resolveColumnMode({ count: 2, gap: 24, widths: [0, -5], equalWidth: false })).toBe('equal');
  });

  it('is equal for missing input', () => {
    expect(resolveColumnMode(undefined)).toBe('equal');
  });
});

describe('resolveColumnCount (SD-2629)', () => {
  it('clamps explicit count to the usable-width count (min(num, widths))', () => {
    expect(resolveColumnCount({ count: 4, gap: 20, widths: [192, 384], equalWidth: false })).toBe(2);
    expect(resolveColumnCount({ count: 4, gap: 20, widths: [192], equalWidth: false })).toBe(1);
  });

  it('keeps num when it does not exceed the usable-width count', () => {
    expect(resolveColumnCount({ count: 2, gap: 20, widths: [192, 384], equalWidth: false })).toBe(2);
  });

  it('does not clamp in equal mode (no usable explicit widths)', () => {
    expect(resolveColumnCount({ count: 3, gap: 20 })).toBe(3);
    expect(resolveColumnCount({ count: 4, gap: 20, widths: [192, 384], equalWidth: true })).toBe(4);
    expect(resolveColumnCount({ count: 4, gap: 20, equalWidth: false })).toBe(4);
  });

  it('floors to a minimum of 1', () => {
    expect(resolveColumnCount({ count: 0, gap: 0 })).toBe(1);
    expect(resolveColumnCount(undefined)).toBe(1);
  });

  it('agrees with normalizeColumnLayout.count (single count authority)', () => {
    const input: ColumnLayout = { count: 4, gap: 20, widths: [192, 384], equalWidth: false };
    expect(normalizeColumnLayout(input, 600).count).toBe(resolveColumnCount(input));
  });
});

describe('resolveColumnLayout (SD-2629)', () => {
  it('clamps count without advertising phantom columns (count:4 with two widths -> 2)', () => {
    expect(resolveColumnLayout({ count: 4, gap: 20, widths: [192, 384], equalWidth: false })).toEqual({
      count: 2,
      gap: 20,
      widths: [192, 384],
      equalWidth: false,
    });
  });

  it('slices surplus widths/gaps when num is below the supplied widths', () => {
    expect(
      resolveColumnLayout({ count: 2, gap: 20, widths: [100, 200, 300, 400], gaps: [10, 20, 30], equalWidth: false }),
    ).toEqual({ count: 2, gap: 20, widths: [100, 200], gaps: [10], equalWidth: false });
  });

  it('leaves an already-consistent config unchanged', () => {
    const input: ColumnLayout = { count: 2, gap: 20, widths: [100, 400], equalWidth: false, withSeparator: true };
    expect(resolveColumnLayout(input)).toEqual(input);
  });

  it('does not slice in equal mode (no explicit widths)', () => {
    expect(resolveColumnLayout({ count: 3, gap: 20 })).toEqual({ count: 3, gap: 20 });
  });

  it('drops stray widths/gaps in equal mode (the renderer would treat any widths as explicit)', () => {
    expect(resolveColumnLayout({ count: 2, gap: 20, widths: [100, 200], gaps: [10], equalWidth: true })).toEqual({
      count: 2,
      gap: 20,
      equalWidth: true,
    });
    // Omitted equalWidth is equal mode too.
    expect(resolveColumnLayout({ count: 2, gap: 20, widths: [100, 200] })).toEqual({ count: 2, gap: 20 });
  });

  it('drops unusable widths by record, not by position, and stays idempotent (SD-2629)', () => {
    // resolveColumnCount counts usable widths ([192, 384] -> 2). A positional slice would keep the
    // leading 0 and drop the valid 384 ([0, 192]); that metadata re-resolves to count 1, so the
    // fill (count 2) and the render metadata disagree. Record-filtering keeps [192, 384].
    const resolved = resolveColumnLayout({ count: 3, gap: 20, widths: [0, 192, 384], equalWidth: false });
    expect(resolved).toEqual({ count: 2, gap: 20, widths: [192, 384], equalWidth: false });
    // Resolving the resolved metadata is a no-op (idempotent), which the positional slice was not.
    expect(resolveColumnLayout(resolved)).toEqual(resolved);
  });

  it('keeps the gap following each surviving column when an unusable width is dropped (SD-2629)', () => {
    // gaps[i] is the gap after column i. Dropping the leading 0-width column must keep the gap that
    // sits between the surviving columns (after col 1 = 30), not the dropped column's gap (10).
    expect(
      resolveColumnLayout({ count: 3, gap: 20, widths: [0, 192, 384], gaps: [10, 30], equalWidth: false }),
    ).toEqual({ count: 2, gap: 20, widths: [192, 384], gaps: [30], equalWidth: false });
  });
});

describe('columnRenderLayoutsEqual (SD-2629)', () => {
  it('treats equalWidth:true and omitted equalWidth as render-equal (both equal mode)', () => {
    expect(columnRenderLayoutsEqual({ count: 2, gap: 24, equalWidth: true }, { count: 2, gap: 24 })).toBe(true);
  });

  it('treats num>widths and num===widths as render-equal when the resolved columns match', () => {
    expect(
      columnRenderLayoutsEqual(
        { count: 4, gap: 24, widths: [192, 384], equalWidth: false },
        { count: 2, gap: 24, widths: [192, 384], equalWidth: false },
      ),
    ).toBe(true);
  });

  it('distinguishes a separator toggle', () => {
    expect(
      columnRenderLayoutsEqual({ count: 2, gap: 24, withSeparator: true }, { count: 2, gap: 24, withSeparator: false }),
    ).toBe(false);
  });

  it('distinguishes a different gap', () => {
    expect(columnRenderLayoutsEqual({ count: 2, gap: 24 }, { count: 2, gap: 48 })).toBe(false);
  });

  it('treats explicit layouts differing only by per-column gaps as render-equal until geometry flips', () => {
    expect(
      columnRenderLayoutsEqual(
        { count: 3, gap: 24, widths: [100, 100, 300], gaps: [24, 24], equalWidth: false },
        { count: 3, gap: 24, widths: [100, 100, 300], gaps: [24, 96], equalWidth: false },
      ),
    ).toBe(true);
  });

  it('distinguishes explicit vs equal mode and different resolved widths', () => {
    expect(
      columnRenderLayoutsEqual({ count: 2, gap: 24, widths: [192, 384], equalWidth: false }, { count: 2, gap: 24 }),
    ).toBe(false);
    expect(
      columnRenderLayoutsEqual(
        { count: 2, gap: 24, widths: [192, 384], equalWidth: false },
        { count: 2, gap: 24, widths: [100, 400], equalWidth: false },
      ),
    ).toBe(false);
  });

  it('handles missing inputs', () => {
    expect(columnRenderLayoutsEqual(undefined, undefined)).toBe(true);
    expect(columnRenderLayoutsEqual({ count: 2, gap: 24 }, undefined)).toBe(false);
  });
});

describe('RTL section column order', () => {
  /** A4 body: 602px of content, two equal columns, 48px gutter (720tw). */
  const twoEqual = (direction?: 'ltr' | 'rtl'): ColumnLayout => ({
    count: 2,
    gap: 48,
    ...(direction ? { direction } : {}),
  });

  it('puts the first column on the right without reordering indices', () => {
    const ltr = getColumnGeometry(normalizeColumnLayout(twoEqual(), 602));
    const rtl = getColumnGeometry(normalizeColumnLayout(twoEqual('rtl'), 602));

    // Fill order is the index; only the painted x moves.
    expect(ltr.map((col) => col.index)).toEqual([0, 1]);
    expect(rtl.map((col) => col.index)).toEqual([0, 1]);
    expect(ltr.map((col) => col.x)).toEqual([0, 325]);
    expect(rtl.map((col) => col.x)).toEqual([325, 0]);
    // Widths and the strip's total span are untouched by the mirror.
    expect(rtl.map((col) => col.width)).toEqual(ltr.map((col) => col.width));
    expect(Math.max(...rtl.map((col) => col.x + col.width))).toBe(602);
  });

  it('leaves an LTR layout exactly where it was', () => {
    // The regression that matters most: every existing producer omits `direction`.
    expect(getColumnGeometry(normalizeColumnLayout(twoEqual(), 602))).toEqual(
      getColumnGeometry(normalizeColumnLayout({ count: 2, gap: 48 }, 602)),
    );
  });

  it('is a no-op for a single column that fills the content area', () => {
    const rtl = getColumnGeometry(normalizeColumnLayout({ count: 1, gap: 48, direction: 'rtl' }, 602));
    expect(rtl).toEqual([{ index: 0, x: 0, width: 602, gapAfter: 0 }]);
  });

  it('pins a single underfilling explicit column to the RIGHT margin', () => {
    // One column has no order to flip, but it still has a side. `<w:cols w:num="1" w:equalWidth="0">`
    // with an authored width narrower than the body leaves slack, and in an RTL section that slack
    // belongs on the left — the same axis rule the multi-column strip follows.
    const rtl = getColumnGeometry(
      normalizeColumnLayout({ count: 1, gap: 0, equalWidth: false, widths: [200], direction: 'rtl' }, 602),
    );
    expect(rtl).toEqual([{ index: 0, x: 402, width: 200, gapAfter: 0 }]);

    // LTR keeps the slack on the right, as before.
    const ltr = getColumnGeometry(normalizeColumnLayout({ count: 1, gap: 0, equalWidth: false, widths: [200] }, 602));
    expect(ltr).toEqual([{ index: 0, x: 0, width: 200, gapAfter: 0 }]);
  });

  it('mirrors three columns with per-column gaps onto the right physical gutters', () => {
    const columns: ColumnLayout = {
      count: 3,
      gap: 0,
      equalWidth: false,
      widths: [100, 150, 200],
      gaps: [20, 40],
      withSeparator: true,
      direction: 'rtl',
    };
    const rtl = getColumnGeometry(normalizeColumnLayout(columns, 602));

    // Fill order still runs 0,1,2; the strip is laid out right to left from the right margin.
    expect(rtl.map((col) => col.index)).toEqual([0, 1, 2]);
    expect(rtl.map((col) => col.x)).toEqual([502, 332, 92]);
    // Column 0's right edge is the right margin, and each separator is the midpoint of the gutter
    // between the columns it actually separates.
    expect(rtl[0].x + rtl[0].width).toBe(602);
    expect(getColumnSeparatorPositions(rtl, 0)).toEqual([492, 312]);
    // Hit testing descends with the index and every column claims its own span.
    expect(getColumnAtX(rtl, 550)).toBe(0);
    expect(getColumnAtX(rtl, 400)).toBe(1);
    expect(getColumnAtX(rtl, 150)).toBe(2);
  });

  it('clamps a negative per-column gap so an LTR layout cannot read as mirrored', () => {
    // OOXML cannot express a negative gutter (`w:space` is unsigned), but a host-built layout can.
    // Left unclamped, `gaps: [-100]` pulls column 1 back behind column 0 and the direction-aware
    // consumers — which infer the axis from x monotonicity — would answer hit tests as if the
    // upright layout were mirrored.
    const ltr = getColumnGeometry(
      normalizeColumnLayout({ count: 2, gap: 0, equalWidth: false, widths: [50, 50], gaps: [-100] }, 602),
    );
    expect(ltr.map((col) => col.x)).toEqual([0, 50]);
    expect(getColumnAtX(ltr, 20)).toBe(0);
    expect(getColumnAtX(ltr, 80)).toBe(1);
  });

  it('pins an underfilling explicit strip to the RIGHT margin, not the left', () => {
    // Word does not scale authored widths to fill the content area, so two 192px columns in a 602px
    // body leave 170px of slack. In LTR the slack falls on the right; mirrored, it must fall on the
    // left. Mirroring about the strip's own span instead of the content area would leave the whole
    // strip pinned left and merely swap the columns inside it — the document would still read as
    // left-aligned, which is the bug this whole change exists to fix.
    const columns: ColumnLayout = {
      count: 2,
      gap: 48,
      equalWidth: false,
      widths: [192, 192],
      direction: 'rtl',
    };
    const rtl = getColumnGeometry(normalizeColumnLayout(columns, 602));

    expect(rtl.map((col) => col.x)).toEqual([410, 170]);
    // Column 0's right edge is the right margin; the slack is on the left.
    expect(rtl[0].x + rtl[0].width).toBe(602);
    expect(Math.min(...rtl.map((col) => col.x))).toBe(170);
  });

  it('lets an overfull explicit strip run past the LEFT margin', () => {
    // The mirror image of the documented LTR overflow: authored widths are not scaled down either,
    // so the strip runs off the far margin — which in RTL is the left one.
    const columns: ColumnLayout = {
      count: 2,
      gap: 24,
      equalWidth: false,
      widths: [200, 400],
      direction: 'rtl',
    };
    const rtl = getColumnGeometry(normalizeColumnLayout(columns, 300));

    expect(rtl[0].x + rtl[0].width).toBe(300);
    expect(rtl[1].x).toBe(-324);
  });

  it('mirrors the separator onto the same physical gutter', () => {
    const columns: ColumnLayout = {
      count: 2,
      gap: 50,
      equalWidth: false,
      widths: [200, 352],
      withSeparator: true,
      direction: 'rtl',
    };
    const rtl = getColumnGeometry(normalizeColumnLayout(columns, 602));

    // Column 1 (left) spans [0,352], column 0 (right) spans [402,602]; the gutter is 352..402
    // and the separator sits at its midpoint.
    expect(rtl[0]).toEqual({ index: 0, x: 402, width: 200, gapAfter: 50, separatorX: 377 });
    expect(rtl[1]).toEqual({ index: 1, x: 0, width: 352, gapAfter: 0 });
    expect(getColumnSeparatorPositions(rtl, 96)).toEqual([473]);
  });

  it('resolves a point to the column that visually contains it', () => {
    const rtl = getColumnGeometry(normalizeColumnLayout(twoEqual('rtl'), 602));

    // Right half is the FIRST column now; left half is the second.
    expect(getColumnAtX(rtl, 400)).toBe(0);
    expect(getColumnAtX(rtl, 100)).toBe(1);
    // Edges stay inside their own column.
    expect(getColumnAtX(rtl, 602)).toBe(0);
    expect(getColumnAtX(rtl, 0)).toBe(1);
    // A point in the gutter belongs to the column preceding it in fill order — the same rule the
    // LTR branch applies, mirrored. This is what keeps a drag crossing the gutter from jumping.
    expect(getColumnAtX(rtl, 300)).toBe(0);
  });

  it('resolves an RTL column boundary the same way containment does', () => {
    // `w:space="0"` (ECMA-376 §17.6.3) makes adjacent columns share an edge, which is the one point
    // hit testing and containment can be made to disagree about. Two columns over 602px mirror to
    // column 0 at [301,602) and column 1 at [0,301), so 301 is column 0's leading edge and column
    // 1's trailing one at the same time.
    const flush = getColumnGeometry(normalizeColumnLayout({ count: 2, gap: 0, direction: 'rtl' }, 602));
    expect(flush.map((col) => col.x)).toEqual([301, 0]);

    // Half-open spans put a shared edge in the column that STARTS there, which in RTL is the earlier
    // column in fill order. An inclusive mirrored bound handed it to column 1 instead, so every
    // column boundary in a zero-gutter RTL section resolved one column too far — and disagreed with
    // the containment the geometry places content by.
    expect(findColumnContaining(flush, 301)).toBe(0);
    expect(getColumnAtX(flush, 301)).toBe(0);
    // A hair to the left is genuinely column 1's, in both resolvers.
    expect(findColumnContaining(flush, 300.99)).toBe(1);
    expect(getColumnAtX(flush, 300.99)).toBe(1);

    // With a gutter the same bound over-claimed the point on a column's TRAILING edge, which is
    // gutter and belongs to the column preceding it in fill order.
    const gutter = getColumnGeometry(normalizeColumnLayout(twoEqual('rtl'), 602));
    expect(gutter[1]).toEqual({ index: 1, x: 0, width: 277, gapAfter: 0 });
    expect(findColumnContaining(gutter, 277)).toBeNull();
    expect(getColumnAtX(gutter, 277)).toBe(0);
    expect(getColumnAtX(gutter, 276.99)).toBe(1);
  });

  it('keeps LTR hit testing byte-identical', () => {
    const ltr = getColumnGeometry(normalizeColumnLayout(twoEqual(), 602));
    expect(getColumnAtX(ltr, 100)).toBe(0);
    expect(getColumnAtX(ltr, 300)).toBe(0);
    expect(getColumnAtX(ltr, 400)).toBe(1);
  });

  it('honors originX in both directions', () => {
    const rtl = getColumnGeometry(normalizeColumnLayout(twoEqual('rtl'), 602));
    expect(getColumnX(rtl, 0, 96)).toBe(421);
    expect(getColumnX(rtl, 1, 96)).toBe(96);
    expect(getColumnAtX(rtl, 500, 96)).toBe(0);
    expect(getColumnAtX(rtl, 200, 96)).toBe(1);
  });

  it('carries direction through clone and normalize', () => {
    expect(cloneColumnLayout(twoEqual('rtl')).direction).toBe('rtl');
    expect(cloneColumnLayout(twoEqual()).direction).toBeUndefined();
    expect(normalizeColumnLayout(twoEqual('rtl'), 602).direction).toBe('rtl');
    expect(resolveColumnLayout(twoEqual('rtl')).direction).toBe('rtl');
  });

  it('treats direction as paint-significant in both equality checks', () => {
    // A section that only flips direction must split regions and invalidate the cache; treating it
    // as equal would leave the previous geometry painted.
    expect(columnLayoutsEqual(twoEqual('rtl'), twoEqual('ltr'))).toBe(false);
    expect(columnRenderLayoutsEqual(twoEqual('rtl'), twoEqual('ltr'))).toBe(false);
    // Absent means ltr, so omitting it must not read as a change.
    expect(columnLayoutsEqual(twoEqual(), twoEqual('ltr'))).toBe(true);
    expect(columnRenderLayoutsEqual(twoEqual(), twoEqual('ltr'))).toBe(true);
  });
});

describe('findColumnContaining', () => {
  // 3 equal columns over 624px with a 24px gap: 192px columns at 0, 216, 432.
  const ltr = getColumnGeometry(normalizeColumnLayout({ count: 3, gap: 24 }, 624));
  const rtl = getColumnGeometry(normalizeColumnLayout({ count: 3, gap: 24, direction: 'rtl' }, 624));

  it('resolves an x inside a column to that column, in both directions', () => {
    expect(findColumnContaining(ltr, 10)).toBe(0);
    expect(findColumnContaining(ltr, 300)).toBe(1);
    expect(findColumnContaining(ltr, 500)).toBe(2);
    // Mirrored: column 0 is the rightmost, so the same points answer in reverse.
    expect(findColumnContaining(rtl, 10)).toBe(2);
    expect(findColumnContaining(rtl, 300)).toBe(1);
    expect(findColumnContaining(rtl, 500)).toBe(0);
  });

  it('answers null in a gutter instead of clamping to a neighbour', () => {
    // The gap between column 0 and 1 runs 192..216 in LTR.
    expect(findColumnContaining(ltr, 200)).toBeNull();
    // getColumnAtX, which exists for hit testing, must still clamp there.
    expect(getColumnAtX(ltr, 200)).toBe(0);
  });

  it('answers null outside the strip entirely, in both directions', () => {
    expect(findColumnContaining(ltr, -50)).toBeNull();
    expect(findColumnContaining(ltr, 700)).toBeNull();
    expect(findColumnContaining(rtl, -50)).toBeNull();
    expect(findColumnContaining(rtl, 700)).toBeNull();
  });

  it('identifies a fragment WIDER than its column by its origin', () => {
    // An over-wide table is placed at its column's left edge and overflows rightward in BOTH
    // directions. Its origin still names its column; its trailing edge does not, which is exactly
    // why an edge comparison cannot answer this question.
    const originOfLastColumn = rtl[2].x;
    expect(findColumnContaining(rtl, originOfLastColumn)).toBe(2);
    // The same fragment's right edge, 500px later, has left the column and reads as another one.
    expect(findColumnContaining(rtl, originOfLastColumn + 500)).not.toBe(2);
  });

  it('gives a shared zero-gap boundary to the column that STARTS there', () => {
    // `w:space="0"` makes adjacent columns share an endpoint, and that endpoint is exactly where
    // the later column's content is placed. Inclusive spans would hand it to the column that ends
    // there instead, and — because the scan runs in fill order — would do so in LTR but not in RTL,
    // making the two directions disagree.
    const zeroGap = getColumnGeometry(normalizeColumnLayout({ count: 2, gap: 0 }, 624));
    expect(zeroGap.map((col) => col.x)).toEqual([0, 312]);
    expect(findColumnContaining(zeroGap, 311.9)).toBe(0);
    expect(findColumnContaining(zeroGap, 312)).toBe(1);

    // The mirrored strip has to answer the same way about its own shared boundary.
    const zeroGapRtl = getColumnGeometry(normalizeColumnLayout({ count: 2, gap: 0, direction: 'rtl' }, 624));
    expect(zeroGapRtl.map((col) => col.x)).toEqual([312, 0]);
    expect(findColumnContaining(zeroGapRtl, 312)).toBe(0);
    expect(findColumnContaining(zeroGapRtl, 311.9)).toBe(1);
  });

  it('honors originX', () => {
    expect(findColumnContaining(ltr, 106, 96)).toBe(0);
    expect(findColumnContaining(ltr, 96 + 300, 96)).toBe(1);
    expect(findColumnContaining(ltr, 0, 96)).toBeNull();
  });

  it('treats a single column as a column', () => {
    const one = getColumnGeometry(normalizeColumnLayout({ count: 1, gap: 0 }, 624));
    expect(findColumnContaining(one, 300)).toBe(0);
    expect(findColumnContaining(one, 900)).toBeNull();
  });
});
