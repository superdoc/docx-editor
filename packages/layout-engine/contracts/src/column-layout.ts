import type { BaseDirection, ColumnLayout } from './index.js';

/**
 * Resolved geometry for a single column. `x` and `separatorX` are CONTENT-RELATIVE (measured from
 * the content-area left edge); add the content-left / left margin to get an absolute page x. This
 * is the single source every column consumer should read for positioning. (SD-2629)
 */
export type ColumnGeometry = {
  index: number;
  x: number;
  width: number;
  /** Gap after this column; 0 for the last column. */
  gapAfter: number;
  /** Separator x (content-relative); present only when a separator line is drawn after this column. */
  separatorX?: number;
};

export type NormalizedColumnLayout = ColumnLayout & {
  width: number;
  /**
   * The content-area width the layout was normalized against, in px.
   *
   * Only RTL geometry reads it, and it exists because `width` above is the WIDEST column, not the
   * strip: explicit widths are deliberately not scaled to fill the content area (Word renders an
   * authored 2880tw column as 2880tw and leaves the slack), so a strip of explicit columns can be
   * narrower — or wider — than the area it sits in. Mirroring such a strip about its own span would
   * keep it pinned to the LEFT margin and only swap the columns inside it, which is not what Word
   * does: the first column belongs against the RIGHT margin and the slack falls on the left.
   *
   * Optional because `getColumnGeometry` also accepts hand-built layouts (column balancing assembles
   * one directly). When absent, RTL mirrors about the strip's own span, which is exact whenever the
   * columns fill the area — always true in equal mode.
   */
  contentWidth?: number;
};

export function widthsEqual(a?: number[], b?: number[]): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Usable explicit widths: finite and > 0. Empty unless explicit mode applies. (SD-2629)
 */
function usableExplicitWidths(input: ColumnLayout | undefined): number[] {
  if (!input || input.equalWidth !== false || !Array.isArray(input.widths)) return [];
  return input.widths.filter((width) => typeof width === 'number' && Number.isFinite(width) && width > 0);
}

/**
 * Resolved column mode. Explicit ONLY when `equalWidth === false` AND at least one usable child
 * width exists; otherwise equal mode. In equal mode Word ignores any child `w:col/@w` and divides
 * the content area evenly, so this is the single explicit/equal decision shared by extraction,
 * normalization, and geometry. (SD-2324 / SD-2629)
 */
export function resolveColumnMode(input: ColumnLayout | undefined): 'explicit' | 'equal' {
  return usableExplicitWidths(input).length > 0 ? 'explicit' : 'equal';
}

/**
 * Resolved column count and the SINGLE authority for "how many columns exist": the raw `w:num`
 * (default 1, floored, min 1) clamped to the usable explicit-width count in explicit mode (Word
 * renders min(num, valid-width count)). Both `normalizeColumnLayout` (width math) and the paginator
 * fill loop read this, so the two tracks cannot disagree: a section that declares more columns
 * than it supplies widths (e.g. w:num="4" with two <w:col>) neither pads surplus columns to ~0px
 * slivers nor advances the fill into non-existent columns. Content-width-independent. (SD-2324 F8 /
 * SD-2629)
 */
export function resolveColumnCount(input: ColumnLayout | undefined): number {
  const rawCount = input && Number.isFinite(input.count) ? Math.max(1, Math.floor(input.count)) : 1;
  const explicit = usableExplicitWidths(input);
  return explicit.length > 0 ? Math.min(rawCount, explicit.length) : rawCount;
}

export function cloneColumnLayout(columns?: ColumnLayout): ColumnLayout {
  return columns
    ? {
        count: columns.count,
        gap: columns.gap,
        ...(Array.isArray(columns.widths) ? { widths: [...columns.widths] } : {}),
        ...(Array.isArray(columns.gaps) ? { gaps: [...columns.gaps] } : {}),
        ...(columns.equalWidth !== undefined ? { equalWidth: columns.equalWidth } : {}),
        ...(columns.withSeparator !== undefined ? { withSeparator: columns.withSeparator } : {}),
        ...(columns.direction !== undefined ? { direction: columns.direction } : {}),
      }
    : { count: 1, gap: 0 };
}

/**
 * Resolve an authored column config to what actually renders: count clamped to resolveColumnCount,
 * and per-column data reconciled with the mode. In explicit mode widths/gaps are sliced to the
 * resolved count (drop surplus); in equal mode they are dropped entirely, because Word ignores
 * child widths/spaces and divides evenly, and consumers like the DOM painter treat any `widths` as
 * explicit. NOT scaled to a content width; that is normalizeColumnLayout's job. Use for
 * render-facing metadata (page.columns / layout.columns / columnRegions) so it never advertises
 * phantom columns or stray explicit widths, e.g. count:4 with two widths becomes count:2. (SD-2629)
 */
export function resolveColumnLayout(input: ColumnLayout): ColumnLayout {
  const count = resolveColumnCount(input);
  const resolved = cloneColumnLayout(input);
  resolved.count = count;
  if (resolveColumnMode(input) === 'explicit') {
    // Select widths the SAME way resolveColumnCount counts them: pair each width with the gap that
    // follows it, keep only usable-width records (finite, > 0), then slice to the resolved count.
    // A positional `widths.slice(0, count)` would keep an unusable leading entry and drop a usable
    // later one (e.g. [0,192,384] -> count 2 -> [0,192]), producing metadata whose own usable-width
    // count re-resolves smaller than the fill used (non-idempotent; fill and paint disagree).
    if (Array.isArray(resolved.widths)) {
      const rawGaps = Array.isArray(resolved.gaps) ? resolved.gaps : [];
      const usable = resolved.widths
        .map((width, i) => ({ width, gapAfter: rawGaps[i] }))
        .filter((record) => typeof record.width === 'number' && Number.isFinite(record.width) && record.width > 0)
        .slice(0, count);
      resolved.widths = usable.map((record) => record.width);
      // gaps[i] is the gap AFTER column i; the last surviving column has none, so keep count-1.
      if (Array.isArray(resolved.gaps)) {
        resolved.gaps = usable.slice(0, Math.max(0, count - 1)).map((record) => record.gapAfter ?? 0);
      }
    }
  } else {
    delete resolved.widths;
    delete resolved.gaps;
  }
  return resolved;
}

/**
 * Build resolved per-column geometry from already-resolved widths. The gap after each column is its
 * own `gaps[i]` when provided (SD-2629 step 4), falling back to the uniform scalar gap; the last
 * column has no following gap. The separator sits at the midpoint of that column's own gap.
 */
function buildColumnGeometry(
  widths: number[],
  gap: number,
  withSeparator: boolean,
  gaps?: number[],
  direction?: BaseDirection,
  contentWidth?: number,
): ColumnGeometry[] {
  const geometry: ColumnGeometry[] = [];
  let x = 0;
  for (let i = 0; i < widths.length; i += 1) {
    const width = widths[i];
    const isLast = i === widths.length - 1;
    const gapAfter = isLast ? 0 : (gaps?.[i] ?? gap);
    const col: ColumnGeometry = { index: i, x, width, gapAfter };
    if (withSeparator && !isLast) col.separatorX = x + width + gapAfter / 2;
    geometry.push(col);
    x += width + gapAfter;
  }
  if (direction !== 'rtl') return geometry;

  // RTL: the FIRST column belongs on the right (ECMA-376 §17.6.1). A single column is mirrored too:
  // it is a no-op when the column fills the content area, but an explicit column that underfills it
  // still belongs against the RIGHT margin, by the same axis rule as a multi-column strip.
  //
  // Mirror rather than reverse the array: `index` stays the FILL order, so every consumer that
  // walks columns 0..n-1 keeps filling in document order and only the painted x changes. `x` stays
  // the LEFT edge of the column, which is what the whole geometry API and its callers mean by `x`.
  // `gapAfter` is likewise untouched — it is the gap after this column in fill order, and in RTL
  // that gap lies to its left, exactly where the mirrored x places it.
  //
  // The mirror axis is the CONTENT AREA, not the strip: explicit widths are not scaled to fill it
  // (see normalizeColumnLayout), so a strip that underfills must end up against the RIGHT margin
  // with the slack on the left — mirroring about the strip's own span would leave it pinned left
  // and merely swap the columns inside it. Falls back to the span when the area is unknown, which
  // is exact whenever the columns fill it (always so in equal mode).
  const span = contentWidth ?? x;
  return geometry.map((col) => ({
    ...col,
    x: span - (col.x + col.width),
    ...(col.separatorX === undefined ? {} : { separatorX: span - col.separatorX }),
  }));
}

export function normalizeColumnLayout(
  input: ColumnLayout | undefined,
  contentWidth: number,
  epsilon = 0.0001,
): NormalizedColumnLayout {
  const count = resolveColumnCount(input);
  const gap = Math.max(0, input?.gap ?? 0);
  // Honor per-column widths ONLY in explicit mode (`equalWidth === false` with usable widths).
  // In equal mode (true or omitted) Word ignores child widths and divides the content area evenly,
  // so any widths that reach here are not authoritative and must not drive geometry. (SD-2324)
  const explicitWidths = usableExplicitWidths(input);
  const totalGap = gap * (count - 1);
  const availableWidth = contentWidth - totalGap;

  let widths =
    explicitWidths.length > 0
      ? explicitWidths.slice(0, count)
      : Array.from({ length: count }, () => (availableWidth > 0 ? availableWidth / count : contentWidth));

  if (widths.length < count) {
    const remaining = Math.max(0, availableWidth - widths.reduce((sum, width) => sum + width, 0));
    const fallbackWidth = count - widths.length > 0 ? remaining / (count - widths.length) : 0;
    widths.push(...Array.from({ length: count - widths.length }, () => fallbackWidth));
  }

  // Floor each column to >= 1px. Explicit widths are NOT scaled to fill the content area: Word
  // renders authored widths as-is (a 2880tw column stays 2880tw, leaving trailing space when the
  // columns underfill), so scaling them up would distort the document. Equal-mode widths already
  // divide availableWidth evenly. (SD-2629 step 4)
  if (availableWidth > 0) {
    widths = widths.map((value) => Math.max(1, value));
  }

  // Per-column gaps drive geometry in explicit mode (step 4); equal mode uses the uniform gap.
  //
  // Clamped to >= 0 like the scalar `gap` above. OOXML cannot express a negative gutter — `w:space`
  // is ST_TwipsMeasure, unsigned — and letting one through breaks the invariant the geometry API
  // relies on: that in an LTR layout `x` rises with the column index. Direction-aware consumers read
  // that monotonicity to tell a mirrored strip from an upright one, so a negative gap wide enough to
  // pull a column back behind its predecessor would make an LTR layout answer hit tests as if it
  // were RTL.
  const gaps =
    explicitWidths.length > 0 && Array.isArray(input?.gaps)
      ? input.gaps.slice(0, Math.max(0, count - 1)).map((value) => Math.max(0, value))
      : undefined;

  const width = widths.reduce((max, value) => Math.max(max, value), 0);

  if (!Number.isFinite(width) || width <= epsilon) {
    return {
      count: 1,
      gap: 0,
      width: Math.max(0, contentWidth),
      ...(input?.withSeparator !== undefined ? { withSeparator: input.withSeparator } : {}),
      ...(input?.direction !== undefined ? { direction: input.direction } : {}),
      contentWidth: Math.max(0, contentWidth),
    };
  }

  return {
    count,
    gap,
    ...(widths.length > 0 ? { widths } : {}),
    ...(gaps && gaps.length > 0 ? { gaps } : {}),
    ...(input?.equalWidth !== undefined ? { equalWidth: input.equalWidth } : {}),
    ...(input?.withSeparator !== undefined ? { withSeparator: input.withSeparator } : {}),
    ...(input?.direction !== undefined ? { direction: input.direction } : {}),
    width,
    contentWidth: Math.max(0, contentWidth),
  };
}

/**
 * Resolve per-column geometry for an already-normalized layout. This is the SD-2629 consumer API:
 * fill/positioning/separators/hit-testing/footnotes/floating anchors/balancing should read this
 * single source rather than re-deriving from `widths`/`gap`. Geometry uses the resolved (unscaled)
 * widths and per-column `gaps`, falling back to the uniform gap when no per-column gaps exist.
 */
export function getColumnGeometry(normalized: NormalizedColumnLayout): ColumnGeometry[] {
  // A geometry must have exactly `count` columns. normalizeColumnLayout always emits one width per
  // column, but a hand-built equal-mode layout may carry only the scalar `width` with no widths array
  // (e.g. column-balancing constructs its input directly). Expand that to `count` equal columns
  // instead of collapsing to a single [width] column, which would map every column index past 0 onto
  // column 0's x and stack later columns on the left margin. (SD-2629)
  const count = Number.isFinite(normalized.count) ? Math.max(1, Math.floor(normalized.count)) : 1;
  const widths =
    Array.isArray(normalized.widths) && normalized.widths.length > 0
      ? normalized.widths
      : Array.from({ length: count }, () => normalized.width);
  return buildColumnGeometry(
    widths,
    normalized.gap,
    Boolean(normalized.withSeparator),
    normalized.gaps,
    normalized.direction,
    normalized.contentWidth,
  );
}

// ---------------------------------------------------------------------------
// Resolved-geometry consumer API (SD-2629). All x values are CONTENT-RELATIVE;
// callers pass the content-left / left margin as `originX` to get an absolute page x.
// ---------------------------------------------------------------------------

function clampColumnIndex(geometry: ColumnGeometry[], index: number): number {
  if (geometry.length === 0) return 0;
  return Math.max(0, Math.min(index, geometry.length - 1));
}

/** Width of the column at `index` (px). */
export function getColumnWidth(geometry: ColumnGeometry[], index: number): number {
  return geometry[clampColumnIndex(geometry, index)]?.width ?? 0;
}

/** Left edge of the column at `index`, as `originX + content-relative x`. */
export function getColumnX(geometry: ColumnGeometry[], index: number, originX = 0): number {
  return originX + (geometry[clampColumnIndex(geometry, index)]?.x ?? 0);
}

/** Gap after the column at `index` (0 for the last column). */
export function getColumnGapAfter(geometry: ColumnGeometry[], index: number): number {
  return geometry[clampColumnIndex(geometry, index)]?.gapAfter ?? 0;
}

/** Absolute x of each separator line (only columns that draw one), as `originX + content-relative`. */
export function getColumnSeparatorPositions(geometry: ColumnGeometry[], originX = 0): number[] {
  return geometry
    .filter((col) => typeof col.separatorX === 'number')
    .map((col) => originX + (col.separatorX as number));
}

/**
 * Index of the column whose OWN span contains absolute `x`, or `null` when `x` lies in no column at
 * all — a gutter, the page margins, or something that is not column flow in the first place.
 *
 * This is the strict counterpart to `getColumnAtX` below, and the two exist because paint-time and
 * hit-testing want opposite answers. A click has to select something, so `getColumnAtX` clamps and
 * hands a gap to its neighbouring column. Asking "is there content in a later column" must not
 * clamp: `page.items` carries page-anchored objects, and a full-width watermark belongs to no
 * column, so answering with one makes it evidence for chrome Word does not draw.
 *
 * Direction-agnostic by construction. It tests containment in each column's own span instead of
 * comparing against a boundary, so it does not care whether `x` ascends or descends with the index,
 * and — unlike an edge test — it is not fooled by a fragment WIDER than its column. An over-wide
 * table is placed at its column's left edge and overflows rightward in both directions, so its
 * origin still identifies its column while its trailing edge does not.
 *
 * Spans are half-open — `[x, x + width)` — so that adjacent columns authored with no gutter at all
 * (`w:space="0"`) do not both claim the boundary they share. That boundary is exactly where the
 * later column's own content is placed, and an inclusive upper bound would hand it to the earlier
 * column instead. Columns are scanned in fill order and the first containing span wins, which
 * after that only matters for an overfull explicit strip whose columns genuinely overlap.
 */
export function findColumnContaining(geometry: ColumnGeometry[], x: number, originX = 0): number | null {
  const cx = x - originX;
  for (const col of geometry) {
    if (cx >= col.x && cx < col.x + col.width) return col.index;
  }
  return null;
}

/**
 * Index of the column containing absolute `x` (clicks in a gap map to the preceding column).
 *
 * The walk is direction-aware and cannot assume ascending `x`: in an RTL section column 0 sits on
 * the right, so `x` DESCENDS with the index. The mirrored branch keeps the same rule the LTR branch
 * states — a point in a gap belongs to the column that precedes it in FILL order — which is what
 * makes a drag that crosses the gutter keep extending from the column it is leaving instead of
 * jumping. Direction is read off the geometry rather than taken as an argument, so every existing
 * caller keeps working unchanged.
 *
 * Both branches test a HALF-OPEN span, so this agrees with `findColumnContaining` on every boundary
 * the two can both answer. The LTR branch gets that from `cx >= col.x`: a point on a shared edge is
 * the later column's, because that is where the later column's content begins. The mirrored branch
 * has to say the same thing from the other side — the shared edge is the EARLIER fill column's left
 * edge there — which is `cx < col.x + col.width`, exclusive. An inclusive bound handed that point to
 * the later column, contradicting the half-open span the geometry places content in, and it also
 * pulled in the point one pixel-width past a column's trailing edge, which is gutter and belongs to
 * the preceding column. With `w:space="0"` the two coincide and every column boundary in an RTL
 * section resolved one column too far.
 */
export function getColumnAtX(geometry: ColumnGeometry[], x: number, originX = 0): number {
  if (geometry.length === 0) return 0;
  const cx = x - originX;
  const mirrored = geometry.length > 1 && geometry[1].x < geometry[0].x;
  let result = 0;
  for (const col of geometry) {
    if (mirrored ? cx < col.x + col.width : cx >= col.x) result = col.index;
    else break;
  }
  return result;
}

/** Structural equality of two column layouts, including per-column `gaps`. */
export function columnLayoutsEqual(a?: ColumnLayout, b?: ColumnLayout): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    a.count === b.count &&
    a.gap === b.gap &&
    a.equalWidth === b.equalWidth &&
    Boolean(a.withSeparator) === Boolean(b.withSeparator) &&
    (a.direction ?? 'ltr') === (b.direction ?? 'ltr') &&
    widthsEqual(a.widths, b.widths) &&
    widthsEqual(a.gaps, b.gaps)
  );
}

/**
 * Render equality: true when two column configs produce the SAME rendered layout even if their raw
 * fields differ. Compares the canonical render form for today's renderer (resolved mode + count,
 * scalar gap, withSeparator, and in explicit mode the sliced widths) and deliberately ignores raw
 * `equalWidth` and the surplus count/widths that resolution discards. Per-column `gaps` are
 * intentionally ignored until geometry/separators consume them (step 4), so a gaps-only authored
 * delta does not split regions or invalidate the normalized-columns cache before it becomes
 * paint-significant. Use for region/cache change detection so e.g. `{num:4, widths:[a,b]}` vs
 * `{num:2, widths:[a,b]}`, or `equalWidth:true` vs an omitted equalWidth, do not split into
 * separate regions. (SD-2629)
 */
export function columnRenderLayoutsEqual(a?: ColumnLayout, b?: ColumnLayout): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const mode = resolveColumnMode(a);
  if (mode !== resolveColumnMode(b)) return false;
  if (resolveColumnCount(a) !== resolveColumnCount(b)) return false;
  if ((a.gap ?? 0) !== (b.gap ?? 0)) return false;
  if (Boolean(a.withSeparator) !== Boolean(b.withSeparator)) return false;
  // Direction IS paint-significant: it decides which side column 0 lands on, so two layouts that
  // differ only here must split regions and invalidate the normalized-columns cache.
  if ((a.direction ?? 'ltr') !== (b.direction ?? 'ltr')) return false;
  if (mode === 'explicit') {
    const ra = resolveColumnLayout(a);
    const rb = resolveColumnLayout(b);
    if (!widthsEqual(ra.widths, rb.widths)) return false;
  }
  return true;
}
