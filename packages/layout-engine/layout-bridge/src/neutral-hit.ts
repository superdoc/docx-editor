/**
 * Editor-neutral hit-test and range-mapping substrate (prep-001).
 *
 * Wraps the existing PM-shaped hit-test / selection-rect functions in a
 * neutral surface that does not require `pmStart` / `pmEnd` in its result
 * types. Today the implementation is a thin adapter over `clickToPosition`
 * and `selectionToRects` — that preserves current v1 behavior — but the
 * shape of the result is owned by the layout boundary, not by ProseMirror.
 *
 * Hard rules from `prep-001-layout-boundary-and-identity.md`:
 *
 *  - `pmStart` / `pmEnd` may remain as legacy/diagnostic fields, but the
 *    neutral types here MUST NOT require them.
 *  - No Phase 3/v2 package may be imported from this module.
 *  - This module is additive; nothing here may be load-bearing for v1.
 */

import type {
  FlowBlock,
  Fragment,
  Layout,
  LayoutBlockRef,
  LayoutFragmentId,
  LayoutSourceIdentity,
  LayoutStoryLocator,
  Measure,
  SourceAnchor,
} from '@superdoc/contracts';
import {
  LAYOUT_BOUNDARY_SCHEMA,
  bodyStoryLocator,
  buildLayoutSourceIdentity,
  buildLayoutSourceIdentityForFragment,
} from '@superdoc/contracts';
import {
  calculatePageTopFallback,
  clickToPositionGeometry,
  type ClickToPositionGeometryOptions,
  findBlockIndexByFragmentId,
  hitTestAtomicFragment,
  hitTestFragment,
  hitTestPage,
  hitTestTableFragment,
  snapToNearestFragment,
  type PositionHit,
  type Point,
} from './position-hit.js';

/** Container-space rectangle (mirrors `Rect` from this package's `index.ts`). */
export type LayoutRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  pageIndex: number;
};

// ---------------------------------------------------------------------------
// Public neutral types
// ---------------------------------------------------------------------------

/**
 * Layout-side representation of a hit-tested point.
 *
 * Carries everything an editor-neutral consumer needs to address the
 * rendered fragment under a click. Legacy PM fields (`pmPosition`,
 * `layoutEpoch`, `lineIndex`, `column`) are surfaced under `legacyPm` for
 * v1 callers that still need them.
 */
export type LayoutHit = {
  /** Schema version for this hit-test result. */
  schema: typeof LAYOUT_BOUNDARY_SCHEMA;
  /** Layout revision (today: `layout.layoutEpoch`). */
  layoutRevision: number;
  /** Composite editor-neutral identity for the hit fragment. */
  identity: LayoutSourceIdentity;
  /** Story locator for the hit fragment. */
  story: LayoutStoryLocator;
  /** Source block reference (today: producer's `blockId`). */
  blockRef: LayoutBlockRef;
  /** Stable opaque fragment id. */
  fragmentId: LayoutFragmentId;
  /** 0-based page index containing the hit. */
  pageIndex: number;
  /** Optional cross-reference to the DOCX source anchor. */
  sourceAnchor?: SourceAnchor;
  /** Diagnostics for partially supported or rejected hits. */
  diagnostics?: LayoutHitDiagnostic[];
  legacyPm?: PositionHit;
};

export type LayoutHitDiagnostic =
  | { code: 'no-page-hit' }
  | { code: 'no-fragment-hit' }
  | { code: 'pm-position-unavailable' }
  | { code: 'unsupported-fragment-kind'; fragmentKind: string };

/**
 * Subrange of a single fragment, in editor-neutral terms.
 *
 * `inlineFromOpaque` / `inlineToOpaque` are placeholders for the offsets a
 * future neutral text-offset model will carry. They are intentionally
 * optional because the current producer can only describe character offsets
 * via PM positions, and PM-required fields are not allowed on this contract.
 * v1 consumers that need pixel rects should use `selectionToRects` directly;
 * they should not gate behavior on this neutral surface yet.
 */
export type LayoutFragmentSubrange = {
  identity: LayoutSourceIdentity;
  story: LayoutStoryLocator;
  blockRef: LayoutBlockRef;
  fragmentId: LayoutFragmentId;
  pageIndex: number;
  /** Container-space rectangle covered by the fragment slice. */
  rect: LayoutRect;
  /** Optional opaque inline-offset start (may be omitted). */
  inlineFromOpaque?: string;
  /** Optional opaque inline-offset end (may be omitted). */
  inlineToOpaque?: string;
};

/**
 * PM-free rendered range for the current neutral subset.
 *
 * This maps one or more already-known rendered fragment ids to their full
 * fragment rectangles. It intentionally does not model text offsets; v1 PM
 * range slicing remains available through `PmOpaqueRange`.
 */
export type LayoutFragmentOpaqueRange = {
  fragmentIds: readonly LayoutFragmentId[];
};

/**
 * Result of mapping an opaque source range to rendered fragments.
 *
 * The opaque range type is intentionally `unknown` here; today the only
 * concrete instantiation is `{ pmFrom: number; pmTo: number }`, but the
 * contract names neither, so a future v2 source range can substitute
 * without reopening the layout boundary.
 */
export type LayoutRangeMapping = {
  schema: typeof LAYOUT_BOUNDARY_SCHEMA;
  layoutRevision: number;
  fragments: LayoutFragmentSubrange[];
  diagnostics?: LayoutHitDiagnostic[];
};

/**
 * Concrete opaque-range instantiation for v1 consumers using PM positions.
 *
 * Kept here (and not in `@superdoc/contracts`) because nothing about it is
 * editor-neutral. v2 consumers should not import this type; they should
 * define their own opaque-range shape and the same `mapRangeToFragmentsNeutral`
 * entry point will accept it (via the function overload defined below).
 */
export type PmOpaqueRange = { pmFrom: number; pmTo: number };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const buildIdentityForFragment = (fragment: Fragment, story: LayoutStoryLocator): LayoutSourceIdentity => {
  return buildLayoutSourceIdentityForFragment(fragment, story);
};

const resolveBodyStoryForHit = (): LayoutStoryLocator => bodyStoryLocator();

const resolvePageHitForPoint = (layout: Layout, containerPoint: Point, options?: ClickToPositionGeometryOptions) => {
  const pageHint = options?.pageHint;
  if (pageHint != null && pageHint.pageIndex >= 0 && pageHint.pageIndex < layout.pages.length) {
    return { pageIndex: pageHint.pageIndex, page: layout.pages[pageHint.pageIndex] };
  }
  return hitTestPage(layout, containerPoint, options?.geometryHelper);
};

const resolvePageRelativePoint = (
  layout: Layout,
  pageIndex: number,
  containerPoint: Point,
  options?: ClickToPositionGeometryOptions,
): Point => {
  const pageTopY = options?.geometryHelper
    ? options.geometryHelper.getPageTop(pageIndex)
    : calculatePageTopFallback(layout, pageIndex);
  return {
    x: containerPoint.x,
    y: options?.pageHint?.pageRelativeY ?? containerPoint.y - pageTopY,
  };
};

const isWithinTableFragment = (fragment: Fragment, point: Point): boolean => {
  if (fragment.kind !== 'table') return false;
  return (
    point.x >= fragment.x &&
    point.x <= fragment.x + fragment.width &&
    point.y >= fragment.y &&
    point.y <= fragment.y + fragment.height
  );
};

const findNeutralHitFragment = (
  layout: Layout,
  blocks: FlowBlock[],
  measures: Measure[],
  pageHit: { pageIndex: number; page: Layout['pages'][number] },
  pageRelativePoint: Point,
): Fragment | undefined => {
  const textHit = hitTestFragment(layout, pageHit, blocks, measures, pageRelativePoint);
  if (textHit) return textHit.fragment;

  const tableHit = hitTestTableFragment(pageHit, blocks, measures, pageRelativePoint);
  if (tableHit) return tableHit.fragment;

  const atomicHit = hitTestAtomicFragment(pageHit, blocks, measures, pageRelativePoint);
  if (atomicHit) return atomicHit.fragment;

  if (!pageHit.page.fragments.some((fragment) => isWithinTableFragment(fragment, pageRelativePoint))) {
    const snapped = snapToNearestFragment(pageHit, blocks, measures, pageRelativePoint);
    if (snapped) return snapped.fragment;
  }

  return undefined;
};

const isPmOpaqueRange = (range: PmOpaqueRange | LayoutFragmentOpaqueRange): range is PmOpaqueRange =>
  typeof (range as PmOpaqueRange).pmFrom === 'number' && typeof (range as PmOpaqueRange).pmTo === 'number';

const pageTopForRectMapping = (layout: Layout, pageIndex: number): number =>
  calculatePageTopFallback(layout, pageIndex);

const sumLineHeights = (lines: { lineHeight: number }[] | undefined, fromLine: number, toLine: number): number => {
  if (!lines) return 0;
  let height = 0;
  for (let i = fromLine; i < toLine && i < lines.length; i += 1) {
    height += lines[i]?.lineHeight ?? 0;
  }
  return height;
};

const fragmentHeight = (fragment: Fragment, blocks: FlowBlock[], measures: Measure[]): number => {
  if (fragment.kind === 'table' || fragment.kind === 'image' || fragment.kind === 'drawing') return fragment.height;
  const blockIndex = findBlockIndexByFragmentId(blocks, fragment.blockId);
  if (blockIndex === -1) return 0;
  const measure = measures[blockIndex];
  if (fragment.kind === 'para' && measure?.kind === 'paragraph') {
    return sumLineHeights(measure.lines, fragment.fromLine, fragment.toLine);
  }
  if (fragment.kind === 'list-item' && measure?.kind === 'list') {
    const item = measure.items.find((candidate) => candidate.itemId === fragment.itemId);
    return sumLineHeights(item?.paragraph.lines, fragment.fromLine, fragment.toLine);
  }
  return 0;
};

const fragmentRect = (
  layout: Layout,
  fragment: Fragment,
  pageIndex: number,
  blocks: FlowBlock[],
  measures: Measure[],
): LayoutRect => ({
  x: fragment.x,
  y: fragment.y + pageTopForRectMapping(layout, pageIndex),
  width: fragment.width,
  height: fragmentHeight(fragment, blocks, measures),
  pageIndex,
});

const rectOverlapArea = (a: LayoutRect, b: LayoutRect): number => {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
};

const findFragmentForRect = (
  layout: Layout,
  blocks: FlowBlock[],
  measures: Measure[],
  rect: LayoutRect,
): Fragment | undefined => {
  const page = layout.pages[rect.pageIndex];
  if (!page) return undefined;
  let best: { fragment: Fragment; overlap: number } | undefined;
  for (const fragment of page.fragments) {
    const candidateRect = fragmentRect(layout, fragment, rect.pageIndex, blocks, measures);
    const overlap = rectOverlapArea(candidateRect, rect);
    if (overlap > 0 && (!best || overlap > best.overlap)) {
      best = { fragment, overlap };
    }
  }
  return best?.fragment;
};

const findFragmentsByNeutralRange = (
  layout: Layout,
  blocks: FlowBlock[],
  measures: Measure[],
  range: LayoutFragmentOpaqueRange,
  story: LayoutStoryLocator,
): LayoutFragmentSubrange[] => {
  const wanted = new Set(range.fragmentIds);
  const fragments: LayoutFragmentSubrange[] = [];
  layout.pages.forEach((page, pageIndex) => {
    for (const fragment of page.fragments) {
      const identity = buildIdentityForFragment(fragment, story);
      if (!wanted.has(identity.fragmentId)) continue;
      fragments.push({
        identity,
        story,
        blockRef: identity.blockRef,
        fragmentId: identity.fragmentId,
        pageIndex,
        rect: fragmentRect(layout, fragment, pageIndex, blocks, measures),
      });
    }
  });
  return fragments;
};

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/**
 * Hit-test a container-space coordinate and return an editor-neutral
 * `LayoutHit`.
 *
 * Today the implementation derives the underlying mapping by calling
 * `clickToPositionGeometry` and projecting the result onto the neutral
 * shape. The `legacyPm` field is populated so v1 callers continue to work.
 *
 * Returns `null` only when no page can be hit at all; partial hits emit
 * diagnostics rather than failing closed so consumers can distinguish
 * "outside content" from "fragment unrecognized".
 */
export function hitTestNeutral(
  layout: Layout,
  blocks: FlowBlock[],
  measures: Measure[],
  containerPoint: Point,
  options?: ClickToPositionGeometryOptions,
): LayoutHit | null {
  const layoutRevision = layout.layoutEpoch ?? 0;
  const story = resolveBodyStoryForHit();
  const pageHit = resolvePageHitForPoint(layout, containerPoint, options);
  if (!pageHit) {
    return null;
  }

  const pageRelativePoint = resolvePageRelativePoint(layout, pageHit.pageIndex, containerPoint, options);
  const fragment = findNeutralHitFragment(layout, blocks, measures, pageHit, pageRelativePoint);
  const legacy = clickToPositionGeometry(layout, blocks, measures, containerPoint, options);

  if (!fragment) {
    return {
      schema: LAYOUT_BOUNDARY_SCHEMA,
      layoutRevision,
      story,
      blockRef: legacy?.blockId ?? '',
      fragmentId: legacy?.blockId ?? '',
      identity: buildLayoutSourceIdentity({ blockId: legacy?.blockId ?? '', story, kind: 'unknown' }),
      pageIndex: pageHit.pageIndex,
      diagnostics: [{ code: 'no-fragment-hit' }],
      legacyPm: legacy ?? undefined,
    };
  }

  const identity = buildIdentityForFragment(fragment, story);
  const diagnostics = legacy ? undefined : [{ code: 'pm-position-unavailable' } satisfies LayoutHitDiagnostic];

  return {
    schema: LAYOUT_BOUNDARY_SCHEMA,
    layoutRevision,
    story,
    blockRef: identity.blockRef,
    fragmentId: identity.fragmentId,
    identity,
    pageIndex: pageHit.pageIndex,
    sourceAnchor: identity.sourceAnchor,
    diagnostics,
    legacyPm: legacy ?? undefined,
  };
}

/**
 * Project rendered selection rectangles into editor-neutral fragment
 * subranges.
 *
 * Accepts a `PmOpaqueRange` today; future neutral range shapes can be
 * accepted via overloads without reopening this contract.
 *
 * The `selectionToRects` produces one `Rect` per visual line; this helper
 * groups them by page and surfaces the underlying fragment identity for
 * each rect. v1 callers that need raw pixel rects should continue to call
 * `selectionToRects` directly — this is the editor-neutral adapter.
 */
export function mapRangeToFragmentsNeutral(
  layout: Layout,
  blocks: FlowBlock[],
  measures: Measure[],
  range: PmOpaqueRange,
  selectionToRectsFn: (
    layout: Layout,
    blocks: FlowBlock[],
    measures: Measure[],
    from: number,
    to: number,
  ) => LayoutRect[],
): LayoutRangeMapping;
export function mapRangeToFragmentsNeutral(
  layout: Layout,
  blocks: FlowBlock[],
  measures: Measure[],
  range: LayoutFragmentOpaqueRange,
): LayoutRangeMapping;
export function mapRangeToFragmentsNeutral(
  layout: Layout,
  blocks: FlowBlock[],
  measures: Measure[],
  range: PmOpaqueRange | LayoutFragmentOpaqueRange,
  selectionToRectsFn?: (
    layout: Layout,
    blocks: FlowBlock[],
    measures: Measure[],
    from: number,
    to: number,
  ) => LayoutRect[],
): LayoutRangeMapping {
  const layoutRevision = layout.layoutEpoch ?? 0;
  const story = resolveBodyStoryForHit();

  if (!isPmOpaqueRange(range)) {
    return {
      schema: LAYOUT_BOUNDARY_SCHEMA,
      layoutRevision,
      fragments: findFragmentsByNeutralRange(layout, blocks, measures, range, story),
    };
  }

  if (range.pmFrom === range.pmTo) {
    return {
      schema: LAYOUT_BOUNDARY_SCHEMA,
      layoutRevision,
      fragments: [],
    };
  }

  if (!selectionToRectsFn) {
    return {
      schema: LAYOUT_BOUNDARY_SCHEMA,
      layoutRevision,
      fragments: [],
      diagnostics: [{ code: 'pm-position-unavailable' }],
    };
  }

  const rects = selectionToRectsFn(layout, blocks, measures, range.pmFrom, range.pmTo);
  const fragments: LayoutFragmentSubrange[] = [];
  const diagnostics: LayoutHitDiagnostic[] = [];

  for (const rect of rects) {
    const fragment = findFragmentForRect(layout, blocks, measures, rect);
    if (!fragment) {
      diagnostics.push({ code: 'no-fragment-hit' });
      continue;
    }

    const identity = buildIdentityForFragment(fragment, story);
    fragments.push({
      identity,
      story,
      blockRef: identity.blockRef,
      fragmentId: identity.fragmentId,
      pageIndex: rect.pageIndex,
      rect,
    });
  }

  return {
    schema: LAYOUT_BOUNDARY_SCHEMA,
    layoutRevision,
    fragments,
    diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
  };
}
