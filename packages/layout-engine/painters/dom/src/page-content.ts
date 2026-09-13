// Page-content rendering, extracted from the DomPainter class (painter plan
// P3a, §4.2). `renderPage` / `patchPage` are the parity-proven page-content
// entry points, parameterized over an explicit `PageContentContext` instead
// of `this.*` class state, so BOTH the existing DomPainter orchestration and
// the persistent-page path (and, later, the new paint orchestrator) drive the
// exact same rendering with the exact same reuse semantics.
//
// This extraction is behavior-neutral by construction: the function bodies
// are the former `DomPainter.createPageState` / `DomPainter.patchPage`
// verbatim with `this.` replaced by `ctx.`; the painter's existing test
// battery plus the v2 render-parity suite pin that neutrality.

import type {
  DrawingBlock,
  Fragment,
  FlowBlock,
  ListBlock,
  ParagraphBlock,
  ResolvedPage,
  ResolvedPaintItem,
  ShapeGroupChild,
  ShapeTextContent,
  TableBlock,
} from '@superdoc/contracts';
import { LAYOUT_BOUNDARY_SCHEMA } from '@superdoc/contracts';
import type { FragmentRenderContext, PositionMapping } from './renderer.js';
import { DATASET_KEYS } from '@superdoc/dom-contract';
import { computeSdtBoundaries } from './sdt/boundaries.js';
import { shouldRebuildForSdtBoundary, type SdtBoundaryOptions } from './sdt/container.js';
import { computeBetweenBorderFlags, type BetweenBorderInfo } from './paragraph/borders/index.js';
import { applyStyles } from './utils/apply-styles.js';
import { CLASS_NAMES, pageStyles, type PageStyles } from './styles.js';
import { TABLE_ROW_ROLE_ATTRIBUTE } from './table/row-role.js';
import { blockUsesDerivedRunTextPlane, type DerivedRunTextPlane } from './derived-run-text-plane.js';

export type FragmentDomState = {
  key: string;
  signature: string;
  fragment: Fragment;
  element: HTMLElement;
  context: FragmentRenderContext;
  /**
   * Interior-pm signature captured from the resolved item at render/rebuild
   * (painter plan P5). Reuse-with-pm-drift is only provably uniform when the
   * retained and fresh keys are EQUAL; null (older retained state, missing
   * stamp) fails closed to a rebuild.
   */
  pmInteriorVersion: string | null;
  /**
   * Whether the rendered DOM carries any `data-pm-*` attribute (root or
   * descendant), recorded once at render/rebuild. A fragment with pm-bearing
   * DOM but NO fragment-level pm span cannot prove position freshness and
   * must never be reused across pm drift (anchored drawings/textboxes whose
   * blocks lack attrs.pmStart).
   */
  hasPmDescendants: boolean;
};

export type PageDomState = {
  element: HTMLElement;
  fragments: FragmentDomState[];
};

/** Fragment-level render work performed by one `patchPage` call. */
export type PatchPageWork = {
  fragmentsRendered: number;
  fragmentsReused: number;
};

/**
 * Painter plan §4.6 (dark observability): work performed by the persistent-page
 * paint path, accumulated across paints until consumed. Fields the path
 * cannot attribute yet are reported as 0/null, never invented:
 * `domNodesCreated` stays null until node counting is instrumented. Since P5,
 * `pagesPositionRemapped` counts pages whose reused DOM had its pm attributes
 * uniformly shifted in place (uniform fresh-shift, proven by the interior-pm
 * signature — no transaction mapping on the window path).
 *
 * The per-page index arrays are populated ONLY when the painter is created
 * with `paintWorkAttribution: true` (the perf harness's repaint oracle needs
 * WHICH pages). Dark by default: counters are O(1) forever, but unconsumed
 * arrays would grow per paint on the product path.
 */
export type PaintWorkSummary = {
  /** Persistent page roots newly created for a committed scaffold. */
  persistentPagesCreated: number;
  /** Persistent page roots reused by index whose exact geometry changed. */
  persistentPagesUpdated: number;
  /** Persistent page roots removed by a generation commit (never by scroll). */
  persistentPagesRemoved: number;
  /** Pages whose content hydrated into an existing persistent root. */
  contentHydrated: number;
  /** Pages whose painter-owned content descendants were removed, root kept. */
  contentDehydrated: number;
  /** Hydrated pages reconciled through the fragment-keyed patch. */
  contentPatched: number;
  /** Hydrated pages left completely untouched. */
  contentUntouched: number;
  /** Hydrated pages whose pm positions were uniformly shifted in place. */
  contentRemapped: number;
  /** Hydrated pages whose header/footer DOM refreshed without body rebuild. */
  contentDecorationsRefreshed: number;
  /** Hydrated pages demoted from reuse because position drift was not uniform. */
  contentPmDemoted: number;
  fragmentsRendered: number;
  fragmentsReused: number;
  domNodesCreated: number | null;
  /**
   * Per-page attribution for the counters above (painter plan P5 §4.6): the
   * repaint oracle's subset gates (`rebuilt ⊆ relevance-changed ∩ window`,
   * `remapped ⊆ full-changed ∩ window`) need to know WHICH pages, not how
   * many. Accumulated like the counters, drained on consume.
   */
  createdPersistentPageIndices: number[];
  removedPersistentPageIndices: number[];
  patchedContentPageIndices: number[];
  untouchedContentPageIndices: number[];
  decorationRefreshedContentPageIndices: number[];
  remappedContentPageIndices: number[];
  pmDemotedContentPageIndices: number[];
  hydratedContentPageIndices: number[];
  dehydratedContentPageIndices: number[];
};

export function createEmptyPaintWorkSummary(): PaintWorkSummary {
  return {
    persistentPagesCreated: 0,
    persistentPagesUpdated: 0,
    persistentPagesRemoved: 0,
    contentHydrated: 0,
    contentDehydrated: 0,
    contentPatched: 0,
    contentUntouched: 0,
    contentRemapped: 0,
    contentDecorationsRefreshed: 0,
    contentPmDemoted: 0,
    fragmentsRendered: 0,
    fragmentsReused: 0,
    domNodesCreated: null,
    createdPersistentPageIndices: [],
    removedPersistentPageIndices: [],
    patchedContentPageIndices: [],
    untouchedContentPageIndices: [],
    decorationRefreshedContentPageIndices: [],
    remappedContentPageIndices: [],
    pmDemotedContentPageIndices: [],
    hydratedContentPageIndices: [],
    dehydratedContentPageIndices: [],
  };
}

/**
 * Painter plan P3a: reuse key for one exact page slot on the persistent-page
 * path. Joins everything the painted page DOM depends on for a fixed page
 * index: the resolve-stage version stamp per item (the product paint-reuse
 * mechanism), fragment identity + geometry + column ownership (stamps do not
 * cover these), and, only when body content contains a dynamic field, its
 * page context.
 * Header/footer providers have a separate decoration-only refresh path, so
 * their context must not invalidate otherwise reusable body fragments.
 *
 * Returns null when any fragment item carries NO resolve stamp — reuse
 * cannot be proven safe, so the caller must fall back to a fragment-keyed
 * patch, never to "untouched". Inside that patch, an unstamped fragment is
 * itself fail-closed: `patchPage` force-rebuilds any fragment whose resolve
 * signature is empty (two missing stamps must never compare equal).
 *
 * Deliberately EXCLUDED: pm/story position attributes — positions are
 * coordinates, not content, and a keystroke shifts every downstream one.
 * Since P5 the window path REMAPS instead: a version-key-matched page whose
 * fragment pm drifted gets an in-place uniform shift when the interior-pm
 * signature proves the drift uniform (`planWindowPositionRemap`), and demotes
 * to a real rebuild otherwise (the shared `planPmReuse` decision inside
 * `patchPage`). The
 * pass-level paint-equivalence oracle stays RAW-sha (positions kept): remap
 * is byte-exact, so reused-then-remapped DOM must equal a fresh dense paint
 * attribute-for-attribute — that exactness is the proof, never normalize it
 * away at the pass level (only the §7.7 unit tests use the normalized form).
 */
export function persistentPageVersionKey(
  page: ResolvedPage,
  totalPages: number,
  sectionPageCount: number,
  derivedRunTextPlane?: DerivedRunTextPlane | null,
): string | null {
  const parts: string[] = [`w:${page.width}`, `h:${page.height}`, `n:${page.number}`];
  const hasBodyPageContextToken = page.items.some((item) => {
    const block = item.kind === 'fragment' && 'block' in item ? item.block : undefined;
    return hasPageContextTokenInBlock(block);
  });
  if (hasBodyPageContextToken) {
    parts.push(
      `t:${totalPages}`,
      `s:${sectionPageCount}`,
      `nt:${page.numberText ?? ''}`,
      `dn:${page.displayNumber ?? ''}`,
      `nf:${page.pageNumberFormat ?? ''}`,
      `ct:${page.pageNumberChapterText ?? ''}`,
      `cs:${page.pageNumberChapterSeparator ?? ''}`,
      `pc:${page.pageCountFieldsExact === false ? 'provisional' : 'exact'}`,
    );
  }
  let missingStamp = false;
  for (const item of page.items) {
    if (item.kind !== 'fragment') {
      parts.push(`i:${String((item as { kind?: string }).kind ?? 'unknown')}`);
      continue;
    }
    const signature = resolvedPaintCacheSignature(item);
    if (signature === '') missingStamp = true;
    const fragment = item.fragment;
    if (blockUsesDerivedRunTextPlane(item.block, derivedRunTextPlane)) {
      parts.push(`d:${derivedRunTextPlane!.revision}`);
    }
    const height = (fragment as { height?: number }).height;
    const columnIndex = 'columnIndex' in fragment ? fragment.columnIndex : undefined;
    parts.push(
      `f:${fragmentKey(fragment)}@${fragment.x},${fragment.y},${fragment.width},${height ?? ''},${columnIndex ?? ''}#${signature}`,
    );
  }
  if (missingStamp) return null;
  return parts.join('|');
}

/**
 * The class state `renderPage`/`patchPage` consume, made explicit. The
 * DomPainter builds one per call (values like `totalPages`, `layoutEpoch`,
 * and `currentMapping` change between paints); the deep fragment-rendering
 * call graph stays on the painter and is reached through the function
 * members.
 */
export interface PageContentContext {
  doc: Document;
  layoutEpoch: number;
  totalPages: number;
  currentMapping: PositionMapping | null;
  changedBlocks: ReadonlySet<string>;
  derivedRunTextPlane?: DerivedRunTextPlane | null;
  /** Record the smallest newly painted subtree for transaction finalization. */
  recordChangedRoot?(root: HTMLElement): void;
  sdtLabelsRendered: Set<string>;
  getEffectivePageStyles(): PageStyles | undefined;
  applySemanticPageOverrides(el: HTMLElement): void;
  getSectionPageCount(page: ResolvedPage): number;
  renderFragment(
    fragment: Fragment,
    context: FragmentRenderContext,
    sdtBoundary?: SdtBoundaryOptions,
    betweenInfo?: BetweenBorderInfo,
    resolvedItem?: ResolvedPaintItem,
  ): HTMLElement;
  renderDecorationsForPage(pageEl: HTMLElement, page: ResolvedPage, pageIndex: number): void;
  renderColumnSeparators(pageEl: HTMLElement, page: ResolvedPage, pageWidth: number, pageHeight: number): void;
  updateStoryPositionAttributes(fragmentEl: HTMLElement, resolvedItem: ResolvedPaintItem | undefined): void;
  updatePositionAttributes(fragmentEl: HTMLElement, mapping: PositionMapping): void;
  updateFragmentElement(
    el: HTMLElement,
    fragment: Fragment,
    section?: 'body' | 'header' | 'footer',
    resolvedItem?: ResolvedPaintItem,
  ): void;
}

/**
 * The subset of `PageContentContext` needed to build a canonical page shell —
 * the `.superdoc-page` element with exact geometry, chrome, epoch, and layout
 * boundary stamps, but no content. Persistent scaffold reconciliation builds
 * shells through this context and hydrates content independently.
 */
export type PageShellContext = Pick<
  PageContentContext,
  'doc' | 'layoutEpoch' | 'getEffectivePageStyles' | 'applySemanticPageOverrides'
>;

/**
 * The exact page box a shell derives from. `ResolvedPage` satisfies it, and
 * so does a numbers-only scaffold band — the persistent page surface builds
 * shells without materializing resolved packets.
 */
export type PageShellGeometry = { width: number; height: number };

/** Refresh geometry and document-level presentation without replacing a page. */
export function refreshPageShell(ctx: PageShellContext, el: HTMLElement, page: PageShellGeometry): void {
  applyStyles(el, pageStyles(page.width, page.height, ctx.getEffectivePageStyles()));
  ctx.applySemanticPageOverrides(el);
  el.dataset.layoutEpoch = String(ctx.layoutEpoch);
  el.dataset[DATASET_KEYS.LAYOUT_BOUNDARY_SCHEMA] = LAYOUT_BOUNDARY_SCHEMA;
}

/**
 * Canonical `.superdoc-page` shell: the one place a paginated page element is
 * created. The persistent scaffold mounts it bare and bounded content
 * reconciliation hydrates the same element in place.
 */
export function renderPageShell(ctx: PageShellContext, page: PageShellGeometry): HTMLElement {
  const el = ctx.doc.createElement('div');
  el.classList.add(CLASS_NAMES.page);
  refreshPageShell(ctx, el, page);
  return el;
}

/**
 * Content half of page painting: resolved fragments, decorations (headers,
 * footers, behind-doc sections), and column separators, appended to an
 * existing page shell. Persistent hydration goes through exactly this
 * function, so a hydrated page is byte-equivalent to one painted
 * by the content path from scratch — same element, same append order.
 */
export function hydratePageContent(
  ctx: PageContentContext,
  el: HTMLElement,
  page: ResolvedPage,
  pageIndex: number,
): FragmentDomState[] {
  const contextBase: FragmentRenderContext = {
    pageNumber: page.number,
    totalPages: ctx.totalPages,
    section: 'body',
    pageNumberText: page.numberText,
    displayPageNumber: page.displayNumber,
    pageNumberFormat: page.pageNumberFormat,
    pageNumberChapterText: page.pageNumberChapterText,
    pageNumberChapterSeparator: page.pageNumberChapterSeparator,
    sectionPageCount: ctx.getSectionPageCount(page),
    pageIndex,
    ...(page.pageCountFieldsExact === false ? { pageCountFieldsExact: false } : {}),
    ...(ctx.derivedRunTextPlane ? { derivedRunTextPlane: ctx.derivedRunTextPlane } : {}),
  };

  const resolvedItems = page.items;
  const sdtBoundaries = computeSdtBoundaries(resolvedItems, ctx.sdtLabelsRendered);
  const betweenBorderFlags = computeBetweenBorderFlags(resolvedItems);
  const fragmentStates: FragmentDomState[] = resolvedItems.flatMap((resolvedItem, index) => {
    if (resolvedItem.kind !== 'fragment') return [];
    const fragment = resolvedItem.fragment;
    const sdtBoundary = sdtBoundaries.get(index);
    const fragmentEl = ctx.renderFragment(
      fragment,
      contextBase,
      sdtBoundary,
      betweenBorderFlags.get(index),
      resolvedItem,
    );
    el.appendChild(fragmentEl);
    const initSig = resolvedPaintCacheSignature(resolvedItem);
    return [
      {
        key: fragmentKey(fragment),
        signature: initSig,
        fragment,
        element: fragmentEl,
        context: contextBase,
        pmInteriorVersion: resolvedPmInteriorVersion(resolvedItem),
        hasPmDescendants: elementHasPmAttributes(fragmentEl),
      },
    ];
  });

  reconcileBodyFragmentPaintOrder(el, fragmentStates);

  ctx.renderDecorationsForPage(el, page, pageIndex);
  ctx.renderColumnSeparators(el, page, page.width, page.height);
  ctx.recordChangedRoot?.(el);
  return fragmentStates;
}

export function renderPage(ctx: PageContentContext, page: ResolvedPage, pageIndex: number): PageDomState {
  const el = renderPageShell(ctx, page);
  const fragments = hydratePageContent(ctx, el, page, pageIndex);
  return { element: el, fragments };
}

/**
 * Selector matching every painter-owned non-fragment content descendant a
 * content fill can leave on a page root: decoration containers, behind-doc
 * drawing fragments (direct page children by design), and column separators.
 * Host-owned overlays (selection, caret, interaction chrome) never match —
 * dehydration must remove exactly what hydration created and nothing else.
 */
const PAINTER_OWNED_CONTENT_SELECTOR = [
  `.${CLASS_NAMES.fragment}`,
  `.${CLASS_NAMES.pageHeader}`,
  `.${CLASS_NAMES.pageFooter}`,
  '[data-behind-doc-section]',
  '[data-superdoc-column-separator="true"]',
].join(', ');

/**
 * Inverse of {@link hydratePageContent} (default persistent page geometry
 * plan, Unit 1): remove the painter-owned content descendants from an
 * existing page root, leaving root identity, root attributes, page order,
 * exact geometry, and the document scroll extent untouched. The tracked
 * fragment list is removed first (authoritative retained state), then any
 * painter-owned straggler matched by class/attribute — a fragment orphaned
 * from the retained list must not survive dehydration.
 */
export function dehydratePageContent(el: HTMLElement, state: PageDomState): void {
  for (const fragmentState of state.fragments) {
    fragmentState.element.remove();
  }
  state.fragments = [];
  for (const child of Array.from(el.children)) {
    if (child instanceof HTMLElement && child.matches(PAINTER_OWNED_CONTENT_SELECTOR)) {
      child.remove();
    }
  }
}

export function patchPage(
  ctx: PageContentContext,
  state: PageDomState,
  page: ResolvedPage,
  pageIndex: number,
): PatchPageWork {
  let fragmentsRendered = 0;
  let fragmentsReused = 0;
  const pageEl = state.element;
  applyStyles(pageEl, pageStyles(page.width, page.height, ctx.getEffectivePageStyles()));
  ctx.applySemanticPageOverrides(pageEl);
  pageEl.dataset.pageNumber = String(page.number);
  pageEl.dataset.layoutEpoch = String(ctx.layoutEpoch);
  // pageIndex is already set during creation and doesn't change during patch

  const existing = new Map(state.fragments.map((frag) => [frag.key, frag]));
  const nextFragments: FragmentDomState[] = [];
  const resolvedItems = page.items;
  const sdtBoundaries = computeSdtBoundaries(resolvedItems, ctx.sdtLabelsRendered);
  const betweenBorderFlags = computeBetweenBorderFlags(resolvedItems);

  const contextBase: FragmentRenderContext = {
    pageNumber: page.number,
    totalPages: ctx.totalPages,
    section: 'body',
    pageNumberText: page.numberText,
    displayPageNumber: page.displayNumber,
    pageNumberFormat: page.pageNumberFormat,
    pageNumberChapterText: page.pageNumberChapterText,
    pageNumberChapterSeparator: page.pageNumberChapterSeparator,
    sectionPageCount: ctx.getSectionPageCount(page),
    pageIndex,
    ...(page.pageCountFieldsExact === false ? { pageCountFieldsExact: false } : {}),
    ...(ctx.derivedRunTextPlane ? { derivedRunTextPlane: ctx.derivedRunTextPlane } : {}),
  };

  resolvedItems.forEach((resolvedItem, index) => {
    if (resolvedItem.kind !== 'fragment') return;
    const fragment = resolvedItem.fragment;
    const key = fragmentKey(fragment);
    const current = existing.get(key);
    const sdtBoundary = sdtBoundaries.get(index);
    const betweenInfo = betweenBorderFlags.get(index);
    const resolvedSig = resolvedPaintCacheSignature(resolvedItem);

    if (current) {
      existing.delete(key);
      const geometryChanged = hasFragmentGeometryChanged(current.fragment, fragment);
      const sdtBoundaryMismatch = shouldRebuildForSdtBoundary(current.element, sdtBoundary);
      // Detect mismatch in any between-border property
      const betweenBorderMismatch =
        (current.element.dataset.betweenBorder === 'true') !== (betweenInfo?.showBetweenBorder ?? false) ||
        (current.element.dataset.suppressTopBorder === 'true') !== (betweenInfo?.suppressTopBorder ?? false) ||
        (current.element.dataset.gapBelow ?? '') !== (betweenInfo?.gapBelow ? String(betweenInfo.gapBelow) : '');
      const pageContextChanged = needsRebuildForPageContext(current.context, contextBase, resolvedItem);
      // Verify the position mapping is reliable: if mapping the old pmStart doesn't produce
      // the expected new pmStart, the mapping is degenerate (e.g. full-document paste) and
      // we must rebuild to get correct span position attributes.
      const newPmStart = (fragment as { pmStart?: number }).pmStart;
      const mappingUnreliable =
        ctx.currentMapping != null &&
        newPmStart != null &&
        current.element.dataset.pmStart != null &&
        ctx.currentMapping.map(Number(current.element.dataset.pmStart)) !== newPmStart;
      // Painter plan P5 (review fix): with no transaction mapping, reuse
      // across pm drift is only sound when provably UNIFORM — the SAME
      // `planPmReuse` decision the window remap planner uses, so a planner
      // demote lands on a real fail-closed rebuild here. Story fragments are
      // exempt (their story-local updater below handles them).
      const pmDecision =
        ctx.currentMapping == null && !isNonBodyStoryBlockId(fragment.blockId)
          ? planPmReuse(current, fragment, resolvedPmInteriorVersion(resolvedItem))
          : null;
      const needsRebuild =
        geometryChanged ||
        ctx.changedBlocks.has(fragment.blockId) ||
        current.element.dataset.v2RenderDiagnostic === 'true' ||
        current.signature !== resolvedSig ||
        // Fail closed on missing resolve stamps: two unstamped fragments
        // compare '' === '' above, which proves nothing — content could have
        // changed without geometry moving. Rebuild instead of reusing.
        resolvedSig === '' ||
        sdtBoundaryMismatch ||
        betweenBorderMismatch ||
        pageContextChanged ||
        mappingUnreliable ||
        pmDecision?.kind === 'rebuild';

      if (needsRebuild) {
        const replacement = ctx.renderFragment(fragment, contextBase, sdtBoundary, betweenInfo, resolvedItem);
        pageEl.replaceChild(replacement, current.element);
        ctx.recordChangedRoot?.(replacement);
        current.element = replacement;
        current.signature = resolvedSig;
        current.pmInteriorVersion = resolvedPmInteriorVersion(resolvedItem);
        current.hasPmDescendants = elementHasPmAttributes(replacement);
        fragmentsRendered += 1;
      } else if (isNonBodyStoryBlockId(fragment.blockId)) {
        // Story fragments (notes, headers/footers) use story-local positions:
        // the body transaction mapping does not apply, but the resolved item
        // carries FRESH story positions every paint. Shift the painted
        // attributes by the fresh-vs-painted delta so reused fragments never
        // serve stale positions (SD-3400: stale note ranges broke caret,
        // selection, and arrow navigation downstream).
        ctx.updateStoryPositionAttributes(current.element, resolvedItem);
        fragmentsReused += 1;
      } else if (ctx.currentMapping) {
        // Fragment NOT rebuilt - update position attributes to reflect document changes
        ctx.updatePositionAttributes(current.element, ctx.currentMapping);
        fragmentsReused += 1;
      } else {
        // No transaction mapping (persistent-page path): reused fragments still
        // must not serve stale positions. `planPmReuse` above proved the
        // drift UNIFORM (equal span length, equal relative interior offsets,
        // interior base moved by exactly the fragment delta), so shifting
        // every descendant by `deltaPm` is byte-exact — kind-agnostic.
        // Painter plan P5 — closes the P3-era gap where the root wrapper got
        // fresh pm attrs while leaf spans kept pre-edit positions.
        if (pmDecision?.kind === 'shift' || pmDecision?.kind === 'table-shift') {
          applyPmReuseDecision(current.element, pmDecision);
        }
        fragmentsReused += 1;
      }

      ctx.updateFragmentElement(current.element, fragment, contextBase.section, resolvedItem);
      if (sdtBoundary?.widthOverride != null) {
        current.element.style.width = `${sdtBoundary.widthOverride}px`;
      }
      current.fragment = fragment;
      current.key = key;
      current.context = contextBase;
      // Track the fresh interior version on every kept path (shift included):
      // a stale base would demote the NEXT steady-state repaint.
      current.pmInteriorVersion = resolvedPmInteriorVersion(resolvedItem);
      nextFragments.push(current);

      return;
    }

    const fresh = ctx.renderFragment(fragment, contextBase, sdtBoundary, betweenInfo, resolvedItem);
    pageEl.insertBefore(fresh, getPageContentFragments(pageEl)[index] ?? null);
    ctx.recordChangedRoot?.(fresh);
    fragmentsRendered += 1;
    nextFragments.push({
      key,
      fragment,
      element: fresh,
      signature: resolvedSig,
      context: contextBase,
      pmInteriorVersion: resolvedPmInteriorVersion(resolvedItem),
      hasPmDescendants: elementHasPmAttributes(fresh),
    });
  });

  existing.forEach((stale) => stale.element.remove());

  reconcileBodyFragmentPaintOrder(pageEl, nextFragments);

  state.fragments = nextFragments;
  ctx.renderDecorationsForPage(pageEl, page, pageIndex);
  ctx.renderColumnSeparators(pageEl, page, page.width, page.height);
  return { fragmentsRendered, fragmentsReused };
}

function getPageContentFragments(pageEl: HTMLElement): Element[] {
  return Array.from(pageEl.children).filter(
    (child) => child.classList.contains(CLASS_NAMES.fragment) && !child.hasAttribute('data-behind-doc-section'),
  );
}

/**
 * OOXML `wp:anchor/@behindDoc` puts the entire anchored object behind document
 * text, independent of where its anchor appears in source order. A zero
 * z-index is not sufficient here: body fragments are sibling stacking-level
 * boxes, so a later anchored image at z-index 0 still paints over earlier
 * text. Negative z-index is also unsafe because it falls behind the opaque
 * page surface.
 *
 * Keep `PageDomState.fragments` in resolved/source order (the persistent-page
 * remap path relies on that lockstep), but reconcile the sibling DOM order so
 * explicit behind-document media paints first. Relative order within each
 * partition remains stable.
 */
function reconcileBodyFragmentPaintOrder(pageEl: HTMLElement, sourceOrderedStates: readonly FragmentDomState[]): void {
  const behindDocument: FragmentDomState[] = [];
  const remaining: FragmentDomState[] = [];
  for (const state of sourceOrderedStates) {
    const fragment = state.fragment;
    if ((fragment.kind === 'image' || fragment.kind === 'drawing') && fragment.behindDoc === true) {
      behindDocument.push(state);
    } else {
      remaining.push(state);
    }
  }

  const pageContentFragments = getPageContentFragments(pageEl);
  [...behindDocument, ...remaining].forEach((fragmentState, index) => {
    const desiredChild = pageContentFragments[index];
    if (fragmentState.element !== desiredChild) {
      pageEl.insertBefore(fragmentState.element, desiredChild ?? null);
      const currentIndex = pageContentFragments.indexOf(fragmentState.element);
      if (currentIndex >= 0) pageContentFragments.splice(currentIndex, 1);
      pageContentFragments.splice(index, 0, fragmentState.element);
    }
  });
}

// ---------------------------------------------------------------------------
// Reuse-decision helpers (moved verbatim from renderer.ts). The dense patch
// path reaches them only through the renderPage/patchPage entry points above;
// they are exported for tests and future paint-orchestrator callers.
// ---------------------------------------------------------------------------

export function pageContextSignature(context: FragmentRenderContext): string {
  return [
    context.pageNumber,
    context.totalPages,
    context.sectionPageCount ?? '',
    context.pageNumberText ?? '',
    context.displayPageNumber ?? '',
    context.pageNumberFormat ?? '',
    context.pageNumberChapterText ?? '',
    context.pageNumberChapterSeparator ?? '',
    context.pageCountFieldsExact === false ? 'provisional' : 'exact',
  ].join('|');
}

function hasPageContextTokenInShapeText(textContent: ShapeTextContent | undefined): boolean {
  return (
    Array.isArray(textContent?.parts) &&
    textContent.parts.some(
      (part) => part.fieldType === 'PAGE' || part.fieldType === 'NUMPAGES' || part.fieldType === 'SECTIONPAGES',
    )
  );
}

function hasPageContextTokenInShapeGroup(shapes: readonly ShapeGroupChild[] | undefined): boolean {
  return (
    Array.isArray(shapes) &&
    shapes.some((shape) => {
      if (shape.shapeType !== 'vectorShape') {
        return false;
      }
      return hasPageContextTokenInShapeText(shape.attrs.textContent);
    })
  );
}

export function hasPageContextTokenInBlock(block: FlowBlock | undefined): boolean {
  if (!block) return false;
  if (block.kind === 'paragraph') {
    for (const run of (block as ParagraphBlock).runs) {
      if (
        'token' in run &&
        (run.token === 'pageNumber' || run.token === 'totalPageCount' || run.token === 'sectionPageCount')
      ) {
        return true;
      }
    }
  } else if (block.kind === 'list') {
    const list = block as ListBlock;
    for (const item of list.items ?? []) {
      if (hasPageContextTokenInBlock(item.paragraph)) {
        return true;
      }
    }
  } else if (block.kind === 'table') {
    const table = block as TableBlock;
    for (const row of table.rows ?? []) {
      for (const cell of row.cells ?? []) {
        const cellBlocks: FlowBlock[] = cell.blocks
          ? (cell.blocks as FlowBlock[])
          : cell.paragraph
            ? [cell.paragraph]
            : [];
        if (cellBlocks.some(hasPageContextTokenInBlock)) {
          return true;
        }
      }
    }
  } else if (block.kind === 'drawing') {
    const drawing = block as DrawingBlock;
    if (drawing.drawingKind === 'vectorShape' || drawing.drawingKind === 'textboxShape') {
      if (hasPageContextTokenInShapeText(drawing.textContent)) return true;
      if (
        drawing.drawingKind === 'textboxShape' &&
        drawing.contentBlocks.some((paragraph) => hasPageContextTokenInBlock(paragraph))
      ) {
        return true;
      }
    }
    if (drawing.drawingKind === 'shapeGroup') {
      return hasPageContextTokenInShapeGroup(drawing.shapes);
    }
  }
  return false;
}

export function needsRebuildForPageContext(
  currentContext: FragmentRenderContext,
  nextContext: FragmentRenderContext,
  resolvedItem: ResolvedPaintItem | undefined,
): boolean {
  const block = resolvedItem?.kind === 'fragment' && 'block' in resolvedItem ? resolvedItem.block : undefined;
  if (pageContextSignature(currentContext) !== pageContextSignature(nextContext) && hasPageContextTokenInBlock(block)) {
    return true;
  }
  const currentPlane = currentContext.derivedRunTextPlane;
  const nextPlane = nextContext.derivedRunTextPlane;
  return (
    currentPlane?.revision !== nextPlane?.revision &&
    (blockUsesDerivedRunTextPlane(block, currentPlane) || blockUsesDerivedRunTextPlane(block, nextPlane))
  );
}

/**
 * Painter plan P5: shift every painted pm attribute in a fragment subtree by
 * a KNOWN uniform delta (fresh-vs-retained fragment pmStart — exact for
 * unchanged content, whose whole span moves together). Fragment-kind
 * agnostic: tables, drawings, and paragraphs all carry data-pm-* on their
 * spans, while the fresh-landmark derivation in
 * `updateStoryPositionAttributes` only understands paragraph-shaped items
 * (block runs / content lines) and silently no-ops for tables — the raw-sha
 * paint-equivalence oracle caught exactly that on real table pages.
 */
function shiftElementPositionAttributes(element: HTMLElement, deltaPm: number): void {
  if (!Number.isFinite(deltaPm) || deltaPm === 0) return;
  const rawStart = element.dataset.pmStart;
  if (rawStart !== undefined && rawStart !== '') {
    const start = Number(rawStart);
    if (Number.isFinite(start)) element.dataset.pmStart = String(start + deltaPm);
  }
  const rawEnd = element.dataset.pmEnd;
  if (rawEnd !== undefined && rawEnd !== '') {
    const end = Number(rawEnd);
    if (Number.isFinite(end)) element.dataset.pmEnd = String(end + deltaPm);
  }
}

function shiftPositionAttributesInSubtree(root: HTMLElement, deltaPm: number): void {
  shiftElementPositionAttributes(root, deltaPm);
  if (!Number.isFinite(deltaPm) || deltaPm === 0) return;
  for (const element of Array.from(root.querySelectorAll<HTMLElement>('[data-pm-start], [data-pm-end]'))) {
    shiftElementPositionAttributes(element, deltaPm);
  }
}

export function shiftFragmentPositionAttributes(fragmentEl: HTMLElement, deltaPm: number): void {
  shiftPositionAttributesInSubtree(fragmentEl, deltaPm);
}

function shiftTableFragmentPositionAttributes(
  fragmentEl: HTMLElement,
  repeatHeaderDeltaPm: number,
  bodyDeltaPm: number,
): void {
  shiftElementPositionAttributes(fragmentEl, bodyDeltaPm);
  for (const child of Array.from(fragmentEl.children)) {
    if (!(child instanceof HTMLElement)) continue;
    const role = child.getAttribute(TABLE_ROW_ROLE_ATTRIBUTE);
    if (role === 'repeat-header') {
      shiftPositionAttributesInSubtree(child, repeatHeaderDeltaPm);
    } else if (role === 'body') {
      shiftPositionAttributesInSubtree(child, bodyDeltaPm);
    }
  }
}

/** The resolve stage's interior-pm signature for this item (painter plan P5), null when unstamped. */
export function resolvedPmInteriorVersion(resolvedItem: ResolvedPaintItem | undefined): string | null {
  if (!resolvedItem) return null;
  return (resolvedItem as { pmInteriorVersion?: string }).pmInteriorVersion ?? null;
}

/** Fragment-level pm span, or null when either bound is missing. */
export function fragmentPmSpan(fragment: Fragment): { start: number; end: number } | null {
  const start = (fragment as { pmStart?: number }).pmStart;
  const end = (fragment as { pmEnd?: number }).pmEnd;
  if (typeof start !== 'number' || typeof end !== 'number') return null;
  return { start, end };
}

/** Whether the rendered fragment DOM carries any pm attribute (root or descendant). */
export function elementHasPmAttributes(el: HTMLElement): boolean {
  return (
    el.hasAttribute('data-pm-start') ||
    el.hasAttribute('data-pm-end') ||
    el.querySelector('[data-pm-start], [data-pm-end]') != null
  );
}

/** The `pm:<count>:<hash>@<base>` interior version, split for uniformity checks. */
export function pmInteriorParts(version: string | null): { relative: string; base: number | null } | null {
  if (version == null) return null;
  const at = version.lastIndexOf('@');
  if (at < 0) return { relative: version, base: null };
  const base = Number(version.slice(at + 1));
  return { relative: version.slice(0, at), base: Number.isFinite(base) ? base : null };
}

export type PmReuseDecision =
  | { kind: 'clean' }
  | { kind: 'shift'; deltaPm: number }
  | { kind: 'table-shift'; repeatHeaderDeltaPm: number; bodyDeltaPm: number }
  | { kind: 'rebuild' };
const PM_REUSE_CLEAN: PmReuseDecision = { kind: 'clean' };
const PM_REUSE_REBUILD: PmReuseDecision = { kind: 'rebuild' };

type SegmentedTablePmInterior = {
  repeatHeaderCount: number;
  repeatHeader: { relative: string; base: number | null };
  body: { relative: string; base: number | null };
};

function segmentedTablePmInteriorParts(version: string | null): SegmentedTablePmInterior | null {
  if (!version?.startsWith('table-pm:')) return null;
  const firstSeparator = version.indexOf(':', 'table-pm:'.length);
  const segmentSeparator = version.indexOf('|', firstSeparator + 1);
  if (firstSeparator < 0 || segmentSeparator < 0) return null;
  const repeatHeaderCount = Number(version.slice('table-pm:'.length, firstSeparator));
  const repeatHeader = pmInteriorParts(version.slice(firstSeparator + 1, segmentSeparator));
  const body = pmInteriorParts(version.slice(segmentSeparator + 1));
  if (!Number.isInteger(repeatHeaderCount) || repeatHeaderCount <= 0 || repeatHeader == null || body == null) {
    return null;
  }
  return { repeatHeaderCount, repeatHeader, body };
}

function pmSegmentDelta(
  previous: { relative: string; base: number | null },
  fresh: { relative: string; base: number | null },
): number | null {
  if (previous.relative !== fresh.relative || (previous.base == null) !== (fresh.base == null)) return null;
  if (previous.base == null || fresh.base == null) return 0;
  return fresh.base - previous.base;
}

export function applyPmReuseDecision(fragmentEl: HTMLElement, decision: PmReuseDecision): void {
  if (decision.kind === 'shift') {
    shiftFragmentPositionAttributes(fragmentEl, decision.deltaPm);
  } else if (decision.kind === 'table-shift') {
    shiftTableFragmentPositionAttributes(fragmentEl, decision.repeatHeaderDeltaPm, decision.bodyDeltaPm);
  }
}

/**
 * Painter plan P5 (review fix): THE single soundness decision for reusing a
 * stamp-equal fragment across pm drift without a transaction mapping —
 * consumed by both the window remap planner and `patchPage` so the two paths
 * can never diverge (a planner "demote" lands on a patch that applies the
 * SAME rule and rebuilds).
 *
 * - `clean`: nothing to do (no pm anywhere, or absolutely identical pm).
 * - `shift`: drift proven UNIFORM — equal span length, equal relative
 *   interior offsets, and the interior base moved by exactly the fragment
 *   delta. Shifting every pm attribute by `deltaPm` is byte-exact.
 * - `rebuild`: anything unprovable — one-sided pm, span-length change,
 *   interior redistribution (a moved PM node emits no run), a missing
 *   interior stamp, interior drift under an equal span, or pm-bearing DOM
 *   under a fragment with no fragment-level anchor whose interior moved.
 */
export function planPmReuse(
  current: Pick<FragmentDomState, 'fragment' | 'pmInteriorVersion' | 'hasPmDescendants'>,
  freshFragment: Fragment,
  freshInteriorVersion: string | null,
): PmReuseDecision {
  const previousSpan = fragmentPmSpan(current.fragment);
  const freshSpan = fragmentPmSpan(freshFragment);
  if ((previousSpan == null) !== (freshSpan == null)) return PM_REUSE_REBUILD;
  if (previousSpan == null || freshSpan == null) {
    if (!current.hasPmDescendants) return PM_REUSE_CLEAN;
    // No fragment-level anchor: reuse is only provable when the interior pm
    // layout is ABSOLUTELY identical (the interior version embeds its base).
    if (current.pmInteriorVersion == null || freshInteriorVersion == null) return PM_REUSE_REBUILD;
    return current.pmInteriorVersion === freshInteriorVersion ? PM_REUSE_CLEAN : PM_REUSE_REBUILD;
  }
  if (freshSpan.end - freshSpan.start !== previousSpan.end - previousSpan.start) return PM_REUSE_REBUILD;
  const deltaPm = freshSpan.start - previousSpan.start;
  const previousTableParts = segmentedTablePmInteriorParts(current.pmInteriorVersion);
  const freshTableParts = segmentedTablePmInteriorParts(freshInteriorVersion);
  const hasSegmentedTableVersion =
    current.pmInteriorVersion?.startsWith('table-pm:') === true ||
    freshInteriorVersion?.startsWith('table-pm:') === true;
  if (hasSegmentedTableVersion) {
    if (
      previousTableParts == null ||
      freshTableParts == null ||
      current.fragment.kind !== 'table' ||
      freshFragment.kind !== 'table' ||
      previousTableParts.repeatHeaderCount !== freshTableParts.repeatHeaderCount ||
      (freshFragment.repeatHeaderCount ?? 0) !== freshTableParts.repeatHeaderCount
    ) {
      return PM_REUSE_REBUILD;
    }
    const repeatHeaderDeltaPm = pmSegmentDelta(previousTableParts.repeatHeader, freshTableParts.repeatHeader);
    const bodyDeltaPm = pmSegmentDelta(previousTableParts.body, freshTableParts.body);
    if (repeatHeaderDeltaPm == null || bodyDeltaPm == null || bodyDeltaPm !== deltaPm) return PM_REUSE_REBUILD;
    if (repeatHeaderDeltaPm === bodyDeltaPm) {
      return bodyDeltaPm === 0 ? PM_REUSE_CLEAN : { kind: 'shift', deltaPm: bodyDeltaPm };
    }
    return { kind: 'table-shift', repeatHeaderDeltaPm, bodyDeltaPm };
  }
  const previousParts = pmInteriorParts(current.pmInteriorVersion);
  const freshParts = pmInteriorParts(freshInteriorVersion);
  if (previousParts == null || freshParts == null) return PM_REUSE_REBUILD;
  if (previousParts.relative !== freshParts.relative) return PM_REUSE_REBUILD;
  if ((previousParts.base == null) !== (freshParts.base == null)) return PM_REUSE_REBUILD;
  if (previousParts.base != null && freshParts.base != null && freshParts.base - previousParts.base !== deltaPm) {
    // Interior runs moved by a DIFFERENT delta than the fragment span — the
    // drift is not uniform; a fragment-delta shift would write wrong values.
    return PM_REUSE_REBUILD;
  }
  return deltaPm === 0 ? PM_REUSE_CLEAN : { kind: 'shift', deltaPm };
}

export function resolvedPaintCacheSignature(resolvedItem: ResolvedPaintItem | undefined): string {
  if (!resolvedItem) return '';
  return (
    (resolvedItem as { paintCacheVersion?: string }).paintCacheVersion ??
    (resolvedItem as { version?: string }).version ??
    ''
  );
}

export const fragmentKey = (fragment: Fragment): string => {
  switch (fragment.kind) {
    case 'para':
      return `para:${fragment.blockId}:${fragment.fromLine}:${fragment.toLine}`;
    case 'list-item':
      throw new Error(`DomPainter: unsupported fragment kind ${fragment.kind}`);
    case 'image':
      return `image:${fragment.blockId}:${fragment.x}:${fragment.y}`;
    case 'drawing':
      return `drawing:${fragment.blockId}:${fragment.x}:${fragment.y}`;
    case 'table': {
      // Include row range and partial row info to uniquely identify table fragments
      // This is critical for mid-row splitting where multiple fragments can exist for the same table
      const partialKey = fragment.partialRow
        ? `:${fragment.partialRow.fromLineByCell.join(',')}-${fragment.partialRow.toLineByCell.join(',')}`
        : '';
      return `table:${fragment.blockId}:${fragment.fromRow}:${fragment.toRow}${partialKey}`;
    }
    default: {
      const _exhaustiveCheck: never = fragment;
      return _exhaustiveCheck;
    }
  }
};

export const hasFragmentGeometryChanged = (previous: Fragment, next: Fragment): boolean =>
  previous.x !== next.x ||
  previous.y !== next.y ||
  previous.width !== next.width ||
  ('height' in previous &&
    'height' in next &&
    typeof previous.height === 'number' &&
    typeof next.height === 'number' &&
    previous.height !== next.height);

export const isNonBodyStoryBlockId = (blockId: string | undefined): boolean =>
  typeof blockId === 'string' &&
  (blockId.startsWith('footnote-') ||
    blockId.startsWith('endnote-') ||
    blockId.startsWith('__sd_semantic_footnote-') ||
    blockId.startsWith('__sd_semantic_endnote-'));

/** Order-insensitive equality over two SDT label key sets. */
export function sdtLabelSetsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const label of a) {
    if (!b.has(label)) return false;
  }
  return true;
}

export type WindowPositionRemapEntry = {
  fragmentState: FragmentDomState;
  freshItem: ResolvedPaintItem & { fragment: Fragment };
  decision: Exclude<PmReuseDecision, { kind: 'clean' | 'rebuild' }>;
};

export type WindowPositionRemapPlan = { kind: 'none' | 'remap' | 'demote'; drifted: WindowPositionRemapEntry[] };

const REMAP_DEMOTE: WindowPositionRemapPlan = { kind: 'demote', drifted: [] };
const REMAP_NONE: WindowPositionRemapPlan = { kind: 'none', drifted: [] };

/**
 * Painter plan P5: decide whether a version-key-matched page is reusable
 * untouched (`none`), needs an in-place uniform position remap (`remap` —
 * resolve stamps are pm-insensitive, so unchanged content legitimately
 * drifts), or must be demoted to the fragment-keyed patch (`demote`, where
 * `pmReuseUnsound` forces a REAL rebuild of the offending fragment).
 *
 * Fail-closed: one-sided pm, a span-LENGTH change, an interior-pm signature
 * mismatch (a PM node inserted/moved inside the block emits no run, so
 * stamps stay equal while interior offsets move), a missing interior key, or
 * pm-bearing DOM under a fragment with no fragment-level pm all demote —
 * only a PROVABLY uniform drift is shifted in place.
 *
 * Pairing is lockstep by index (review fix): this only runs under versionKey
 * EQUALITY, and the key is an order-sensitive join of every fragment's
 * key+geometry+stamp, so equal keys imply identical ordered fragment
 * sequences — no per-paint key strings or Maps on the steady-state path.
 */
export function planWindowPositionRemap(state: PageDomState, resolvedPage: ResolvedPage): WindowPositionRemapPlan {
  const fragments = state.fragments;
  let drifted: WindowPositionRemapEntry[] | null = null;
  let cursor = 0;
  for (const item of resolvedPage.items) {
    if (item.kind !== 'fragment') continue;
    const fragmentState = fragments[cursor];
    cursor += 1;
    if (!fragmentState) return REMAP_DEMOTE;
    const fresh = item as ResolvedPaintItem & { fragment: Fragment };
    // ONE soundness decision shared with patchPage (review fix): a demote
    // here lands on a patch applying the SAME rule, so it rebuilds for real.
    const decision = planPmReuse(fragmentState, fresh.fragment, resolvedPmInteriorVersion(fresh));
    if (decision.kind === 'rebuild') return REMAP_DEMOTE;
    if (decision.kind === 'shift' || decision.kind === 'table-shift') {
      (drifted ??= []).push({ fragmentState, freshItem: fresh, decision });
    }
  }
  if (cursor !== fragments.length) return REMAP_DEMOTE;
  return drifted && drifted.length > 0 ? { kind: 'remap', drifted } : REMAP_NONE;
}
