// Persistent paginated page surface (default persistent page geometry plan,
// Unit 1 — plans/2026-07-28-v2-default-persistent-page-geometry-content-hydration.md).
//
// The ONE paginated reconcile contract: an immutable generation-scoped page
// scaffold owns every `.superdoc-page` root for its whole layout generation,
// and page CONTENT is the only virtualized state. The two planes are explicit
// and separately keyed:
//
//   - the SHELL REGISTRY (generation-owned, keyed by page index): one
//     canonical page root per exact page, created through the one
//     `renderPageShell` factory. Shell roots are never added, removed, or
//     repositioned by content work or camera movement — only a scaffold
//     identity change (a new committed generation) reconciles them.
//   - the CONTENT STATE (bounded, keyed by hydrated page index): fragments,
//     decorations, and reuse stamps for the desired content window plus
//     interaction pins. Content hydrates into existing roots and dehydrates
//     out of them without touching root identity, order, geometry, or the
//     scroll extent.
//
// The contract has no posture discriminator, viewport-owned page-root set,
// or spacer node: the mount's flex column plus the
// scaffold's uniform `gapPx` reproduce the exact prefix-sum page offsets, so
// the scroll extent derives from the persistent shells alone and content
// hydration cannot change it.
//
// Locality contract (plan Unit 1/3): a same-scaffold paint skips shell work
// in O(1); a generation commit walks the scaffold bands (cheap numbers, lazy
// arrays stay lazy) but performs shell DOM writes only on pages whose shell
// key changed, entered, or left. Validated hydrated roots receive current
// provenance during bounded content work; content work is O(desired window
// + hydrated).
// Resolved packets are consumed ONLY for desired content pages — a
// generation commit never materializes the whole resolved layout.
//
// Orchestration lives HERE (not in the large renderer class) per the plan;
// page-content rendering primitives stay in `page-content.ts`. The renderer
// binds this module through a narrow context object and owns snapshot /
// rollback integration.

import type { DocumentBackground, ResolvedPage } from '@superdoc/contracts';
import { validateDerivedRunTextPlane, type DerivedRunTextPlane } from './derived-run-text-plane.js';
import { computeExpectedSdtLabelKeys } from './sdt/boundaries.js';
import {
  dehydratePageContent,
  applyPmReuseDecision,
  hydratePageContent,
  persistentPageVersionKey,
  patchPage,
  planWindowPositionRemap,
  refreshPageShell,
  renderPageShell,
  resolvedPmInteriorVersion,
  sdtLabelSetsEqual,
  type FragmentDomState,
  type PageContentContext,
  type PageDomState,
  type PaintWorkSummary,
} from './page-content.js';

/**
 * One exact page band of the committed scaffold (numbers-only,
 * serializable). Structurally compatible with the host pipeline's
 * `PageScaffoldPage` so a host scaffold's `pages` array — including a lazy
 * incremental one — is passed through zero-copy.
 */
export type DomPainterPersistentScaffoldPage = {
  index: number;
  /** Prefix-sum offset of the page's top edge from the document top. */
  topPx: number;
  heightPx: number;
  widthPx: number;
  /**
   * Physical page number for the shell's `data-page-number` stamp (page
   * numbering can restart per section, so it is data, never `index + 1`).
   * Optional: absent bands leave the stamp to content hydration — the
   * painter reports, it never invents.
   */
  pageNumber?: number;
};

/**
 * The immutable generation-scoped page scaffold. Reference identity IS the
 * commit identity: the host builds one scaffold object per committed layout
 * generation and passes the same object to every same-generation content
 * paint, so the painter's same-generation skip is O(1).
 */
export type DomPainterPersistentScaffold = {
  /** Layout generation that produced this scaffold (the torn-generation fence). */
  generation: number;
  pageCount: number;
  /**
   * Uniform inter-page gap in px. The persistent surface owns the vertical
   * rhythm through the mount's flex `gap`, never through spacer nodes, so
   * `topPx` must equal the prefix sum of heights plus `gapPx` per boundary.
   */
  gapPx: number;
  /** `last.topPx + last.heightPx`; `0` for an empty document. No trailing gap. */
  totalHeightPx: number;
  /** Ascending by `index`; `index` must equal the array position. */
  pages: readonly DomPainterPersistentScaffoldPage[];
};

/**
 * Read-only exact-packet lookup. A `ReadonlyMap<number, ResolvedPage>`
 * satisfies it; so does a thin facade over a lazily-resolved page array —
 * the painter reads only the desired content pages, so untouched document
 * tails are never materialized by a paint.
 */
export interface DomPainterPersistentPacketSource {
  get(pageIndex: number): ResolvedPage | undefined;
}

/**
 * The one paginated reconcile input (plan §Target Architecture). Shells
 * always cover the whole scaffold; only the desired content set is bounded.
 */
export type DomPainterPersistentPageInput = {
  scaffold: DomPainterPersistentScaffold;
  /** Pages whose content must be hydrated (visible window + overscan). */
  desiredContentPageIndices: readonly number[];
  /** Interaction pins that must stay hydrated regardless of the window. */
  pinnedContentPageIndices?: readonly number[];
  /**
   * Exact resolved packets by page index, consumed only for desired content
   * pages. A packet stamped with a different layout epoch than
   * `scaffold.generation` is a torn generation and fails before DOM
   * mutation; so does packet page geometry that disagrees with the band.
   */
  packetsByPageIndex: DomPainterPersistentPacketSource;
  sectionPageCounts?: Readonly<Record<string, number>>;
  documentBackground?: DocumentBackground | null;
  derivedRunTextPlane?: DerivedRunTextPlane | null;
  captureSnapshot?: boolean;
};

/** Shell registry entry: the persistent page root and its geometry/style reuse key. */
export type PersistentShellEntry = {
  element: HTMLElement;
  shellKey: string;
};

/** Bounded content state for one hydrated page. */
export type PersistentContentEntry = {
  state: PageDomState;
  versionKey: string | null;
  sdtLabels: ReadonlySet<string>;
};

type PersistentSurfaceIntegrity = {
  dirty: boolean;
  observer: MutationObserver | null;
  onInvalidated: () => void;
};

/** The retained persistent-surface state the painter snapshots and restores. */
export type PersistentPageSurfaceState = {
  mount: HTMLElement;
  /** The committed scaffold; reference identity gates the O(1) skip. */
  scaffold: DomPainterPersistentScaffold;
  shells: Map<number, PersistentShellEntry>;
  content: Map<number, PersistentContentEntry>;
  integrity: PersistentSurfaceIntegrity;
};

/**
 * The narrow renderer capabilities this module consumes. The deep
 * fragment/decoration render call graph stays on the painter class and is
 * reached through the `PageContentContext` it builds.
 */
export interface PersistentSurfaceRenderContext {
  contentContext: PageContentContext;
  work: PaintWorkSummary;
  recordPageWork(kind: PersistentPageWorkKind, pageIndex: number): void;
  /** Read-and-consume the provider-change decorations-dirty flag. */
  consumeDecorationsDirty(): boolean;
  /**
   * Signature of every non-geometry input to the shell's visual styles
   * (document background, page-style overrides). Folded into the shell reuse
   * key so a rare document-presentation change refreshes retained roots
   * while steady generations skip all shell attribute writes.
   */
  shellStyleSignature: string;
  /** Wake the host's canonical planner when foreign DOM work corrupts page roots. */
  onIntegrityInvalidated: () => void;
}

export type PersistentPageWorkKind =
  | 'createdPersistentPageIndices'
  | 'removedPersistentPageIndices'
  | 'patchedContentPageIndices'
  | 'untouchedContentPageIndices'
  | 'decorationRefreshedContentPageIndices'
  | 'remappedContentPageIndices'
  | 'pmDemotedContentPageIndices'
  | 'hydratedContentPageIndices'
  | 'dehydratedContentPageIndices';

/**
 * Shell reuse key over the exact page box, page number, and shell style
 * inputs. Deliberately EXCLUDES the generation: a steady keystroke
 * generation whose page geometry did not change performs no shell refresh on
 * unchanged roots (plan Unit 3 locality). A shell-only root may retain the
 * generation that last touched it; validated hydrated roots are stamped by
 * the bounded content reconcile.
 */
function persistentShellKey(page: DomPainterPersistentScaffoldPage, styleSignature: string): string {
  return `shell|w:${page.widthPx}|h:${page.heightPx}|n:${page.pageNumber ?? ''}|s:${styleSignature}`;
}

/** Sub-pixel-safe prefix-sum tolerance for scaffold validation. */
const SCAFFOLD_EPSILON_PX = 0.01;

/**
 * Fail-closed scaffold validation: a scaffold is exact geometry or it is
 * nothing. The prefix-sum pin also proves the flex-gap layout reproduces the
 * scaffold offsets exactly, which is what lets the surface drop spacers.
 */
export function validatePersistentScaffold(scaffold: DomPainterPersistentScaffold): void {
  if (!Number.isInteger(scaffold.generation)) {
    throw new Error(`persistent page scaffold requires an integer generation, got ${String(scaffold.generation)}`);
  }
  if (!Number.isFinite(scaffold.gapPx) || scaffold.gapPx < 0) {
    throw new Error(`persistent page scaffold requires gapPx >= 0, got ${String(scaffold.gapPx)}`);
  }
  if (scaffold.pages.length !== scaffold.pageCount) {
    throw new Error(
      `persistent page scaffold is torn: ${scaffold.pages.length} pages for pageCount ${scaffold.pageCount}`,
    );
  }
  let expectedTop = 0;
  for (let index = 0; index < scaffold.pages.length; index += 1) {
    const page = scaffold.pages[index]!;
    if (page.index !== index) {
      throw new Error(`persistent page scaffold page at position ${index} carries index ${page.index}`);
    }
    if (
      !Number.isFinite(page.widthPx) ||
      !Number.isFinite(page.heightPx) ||
      !Number.isFinite(page.topPx) ||
      page.widthPx <= 0 ||
      page.heightPx <= 0
    ) {
      throw new Error(`persistent page scaffold page ${index} has no exact dimensions`);
    }
    if (Math.abs(page.topPx - expectedTop) > SCAFFOLD_EPSILON_PX) {
      throw new Error(
        `persistent page scaffold page ${index} topPx ${page.topPx} breaks the prefix sum (expected ${expectedTop})`,
      );
    }
    expectedTop = page.topPx + page.heightPx + scaffold.gapPx;
  }
  const last = scaffold.pages[scaffold.pages.length - 1];
  const expectedTotal = last ? last.topPx + last.heightPx : 0;
  if (Math.abs(scaffold.totalHeightPx - expectedTotal) > SCAFFOLD_EPSILON_PX) {
    throw new Error(
      `persistent page scaffold totalHeightPx ${scaffold.totalHeightPx} disagrees with pages (expected ${expectedTotal})`,
    );
  }
}

/** Resolve the validated, deduplicated, ascending desired content set. */
export function resolveDesiredContentPageIndices(input: DomPainterPersistentPageInput): number[] {
  const desired = new Set<number>();
  const admit = (pageIndex: number): void => {
    if (Number.isInteger(pageIndex) && pageIndex >= 0 && pageIndex < input.scaffold.pageCount) {
      desired.add(pageIndex);
    }
  };
  for (const pageIndex of input.desiredContentPageIndices) admit(pageIndex);
  for (const pageIndex of input.pinnedContentPageIndices ?? []) admit(pageIndex);
  return [...desired].sort((left, right) => left - right);
}

/**
 * Fetch and fence one desired page's packet: it must exist, carry this
 * scaffold's generation (when stamped), and agree with the band's exact
 * geometry. Fails before any DOM mutation.
 */
function requireDesiredPacket(input: DomPainterPersistentPageInput, pageIndex: number): ResolvedPage {
  const packet = input.packetsByPageIndex.get(pageIndex);
  if (packet == null) {
    throw new Error(
      `persistent page surface: no exact resolved packet for page ${pageIndex} in generation ${input.scaffold.generation}`,
    );
  }
  const epoch = packet.layoutEpoch;
  if (epoch != null && epoch !== input.scaffold.generation) {
    throw new Error(
      `persistent page surface: packet for page ${pageIndex} carries layout epoch ${epoch} ` +
        `but the scaffold claims generation ${input.scaffold.generation}; scaffold and packets are from different layout passes (torn generation)`,
    );
  }
  const band = input.scaffold.pages[pageIndex];
  if (
    band != null &&
    (Math.abs(packet.width - band.widthPx) > SCAFFOLD_EPSILON_PX ||
      Math.abs(packet.height - band.heightPx) > SCAFFOLD_EPSILON_PX)
  ) {
    throw new Error(
      `persistent page surface: packet for page ${pageIndex} is ${packet.width}x${packet.height} ` +
        `but the scaffold band claims ${band.widthPx}x${band.heightPx} (torn generation)`,
    );
  }
  return packet;
}

/**
 * Posture provenance stamp. `shell` while a root has no content; `filled`
 * once content hydrates. The camera may legally reveal a `shell` page while
 * content catches up — it must never reveal missing geometry.
 */
function stampContentPosture(element: HTMLElement, hydrated: boolean): void {
  element.dataset.v2PageContent = hydrated ? 'filled' : 'shell';
}

/**
 * Full shell stamp, applied when a root is created or its shell key changed.
 * Steady generations skip this entirely on unchanged roots. Shell-only roots
 * may retain the generation that last touched them; content reconciliation
 * gives every validated hydrated root current provenance.
 */
function stampPersistentPageRoot(
  ctx: PersistentSurfaceRenderContext,
  element: HTMLElement,
  band: DomPainterPersistentScaffoldPage,
): void {
  refreshPageShell(ctx.contentContext, element, { width: band.widthPx, height: band.heightPx });
  if (band.pageNumber != null) {
    element.dataset.pageNumber = String(band.pageNumber);
  }
  element.dataset.pageIndex = String(band.index);
  element.dataset.v2PersistentPageRuntime = 'true';
  element.dataset.v2PersistentPageExactness = 'exact';
  element.dataset.v2PageState = 'exact';
}

function createPersistentSurfaceIntegrity(mount: HTMLElement, onInvalidated: () => void): PersistentSurfaceIntegrity {
  const integrity: PersistentSurfaceIntegrity = { dirty: false, observer: null, onInvalidated };
  const MutationObserverConstructor = mount.ownerDocument.defaultView?.MutationObserver;
  if (MutationObserverConstructor) {
    integrity.observer = new MutationObserverConstructor(() => {
      const wasDirty = integrity.dirty;
      integrity.dirty = true;
      if (!wasDirty) integrity.onInvalidated();
    });
  }
  return integrity;
}

function observePersistentSurfaceIntegrity(integrity: PersistentSurfaceIntegrity, mount: HTMLElement): void {
  integrity.observer?.observe(mount, { childList: true });
}

function consumePersistentSurfaceIntegrityFailure(state: PersistentPageSurfaceState): boolean {
  if (state.integrity.observer?.takeRecords().length) state.integrity.dirty = true;
  if (state.integrity.dirty) return true;

  const firstShell = state.shells.get(0)?.element ?? null;
  const lastShell = state.shells.get(state.scaffold.pageCount - 1)?.element ?? null;
  return (
    state.mount.children.length !== state.scaffold.pageCount ||
    (state.scaffold.pageCount > 0 &&
      (state.mount.firstElementChild !== firstShell || state.mount.lastElementChild !== lastShell))
  );
}

/**
 * Read the live shell-plane integrity without mutating page content. The host
 * uses this before its zero-work skip so external child-list corruption can
 * never strand the camera over a missing page until some unrelated repaint.
 */
export function isPersistentPageSurfaceIntact(state: PersistentPageSurfaceState | null): boolean {
  return state != null && !consumePersistentSurfaceIntegrityFailure(state);
}

export function disposePersistentPageSurfaceState(state: PersistentPageSurfaceState | null): void {
  state?.integrity.observer?.disconnect();
}

/**
 * Reconcile the shell registry for a new committed scaffold. Runs ONLY when
 * scaffold identity changes (or the surface is fresh/self-healing); a
 * same-generation content paint never enters here. Page roots are reused by
 * page index; additions/removals and geometry updates become visible
 * together in the caller's visible transaction, and unchanged shell-only
 * roots receive no attribute or child-list writes.
 */
function reconcileScaffoldShells(
  ctx: PersistentSurfaceRenderContext,
  previous: PersistentPageSurfaceState | null,
  input: DomPainterPersistentPageInput,
  mount: HTMLElement,
): PersistentPageSurfaceState {
  const scaffold = input.scaffold;
  validatePersistentScaffold(scaffold);

  const integrity =
    previous?.mount === mount
      ? previous.integrity
      : createPersistentSurfaceIntegrity(mount, ctx.onIntegrityInvalidated);
  integrity.onInvalidated = ctx.onIntegrityInvalidated;
  integrity.observer?.disconnect();
  integrity.dirty = false;

  try {
    const previousShells =
      previous && previous.mount === mount ? previous.shells : new Map<number, PersistentShellEntry>();
    const previousContent =
      previous && previous.mount === mount ? previous.content : new Map<number, PersistentContentEntry>();

    const shells = new Map<number, PersistentShellEntry>();
    const content = new Map<number, PersistentContentEntry>();
    const desiredChildren: HTMLElement[] = [];
    for (const band of scaffold.pages) {
      const shellKey = persistentShellKey(band, ctx.shellStyleSignature);
      const existing = previousShells.get(band.index);
      const reusable = existing != null && existing.element.parentElement === mount;
      if (reusable) {
        if (existing.shellKey !== shellKey) {
          stampPersistentPageRoot(ctx, existing.element, band);
          existing.element.dataset.layoutEpoch = String(scaffold.generation);
          ctx.work.persistentPagesUpdated += 1;
        }
        shells.set(band.index, { element: existing.element, shellKey });
        const retainedContent = previousContent.get(band.index);
        if (retainedContent) content.set(band.index, retainedContent);
      } else {
        const element = renderPageShell(ctx.contentContext, { width: band.widthPx, height: band.heightPx });
        stampPersistentPageRoot(ctx, element, band);
        element.dataset.layoutEpoch = String(scaffold.generation);
        stampContentPosture(element, false);
        shells.set(band.index, { element, shellKey });
        ctx.work.persistentPagesCreated += 1;
        ctx.recordPageWork('createdPersistentPageIndices', band.index);
      }
      desiredChildren.push(shells.get(band.index)!.element);
    }

    // Shells leaving the document (page-count shrink or a replaced root) are
    // removed in this same commit; their content state dies with them.
    for (const [pageIndex, entry] of previousShells) {
      if (shells.get(pageIndex)?.element === entry.element) continue;
      entry.element.remove();
      content.delete(pageIndex);
      ctx.work.persistentPagesRemoved += 1;
      ctx.recordPageWork('removedPersistentPageIndices', pageIndex);
    }

    // The persistent surface owns the vertical rhythm through the container
    // gap — no spacer nodes exist for the camera to depend on.
    if (mount.style.gap !== `${scaffold.gapPx}px`) {
      mount.style.gap = `${scaffold.gapPx}px`;
    }

    // Remove foreign children before restoring order. In the common
    // same-count corruption case this turns repair into exactly two root
    // operations (remove the impostor, insert its canonical replacement)
    // instead of moving every unaffected shell after the damaged index.
    // The mutations still commit synchronously inside the host's visible
    // transaction, so the browser cannot present the intermediate gap.
    const desiredChildSet = new Set(desiredChildren);
    for (const child of Array.from(mount.children)) {
      if (!desiredChildSet.has(child as HTMLElement)) child.remove();
    }

    // Order-preserving reconcile. Untouched in-place roots are not
    // re-inserted; genuine reorder corruption moves only the roots needed to
    // recover the scaffold's canonical index order.
    desiredChildren.forEach((child, index) => {
      if (mount.children[index] !== child) {
        mount.insertBefore(child, mount.children[index] ?? null);
      }
    });
    while (mount.children.length > desiredChildren.length) {
      mount.lastElementChild?.remove();
    }

    return { mount, scaffold, shells, content, integrity };
  } finally {
    observePersistentSurfaceIntegrity(integrity, mount);
  }
}

/**
 * Reconcile the bounded content plane inside the persistent shells. Work is
 * O(desired window + currently hydrated), never O(document): pages outside
 * the union are untouched shells.
 */
function reconcileContentWindow(
  ctx: PersistentSurfaceRenderContext,
  state: PersistentPageSurfaceState,
  input: DomPainterPersistentPageInput,
  desired: readonly number[],
  validatedPackets: ReadonlyMap<number, ResolvedPage>,
): void {
  const desiredSet = new Set(desired);
  const refreshDecorations = ctx.consumeDecorationsDirty();

  // Keep the transition bounded to prior hydrated ∪ next desired. Validate
  // every root and precompute final-window SDT ownership before mutating any
  // descendants, then hydrate the next window before removing the old one.
  // A failed entering page therefore cannot expose a blank viewport after the
  // prior window has already been torn down.
  const touched = [...new Set([...desired, ...state.content.keys()])].sort((left, right) => left - right);
  for (const pageIndex of touched) {
    if (!state.shells.has(pageIndex)) {
      throw new Error(`persistent page surface: no shell root for page ${pageIndex}`);
    }
  }

  const expectedSdtLabelsByPage = new Map<number, ReadonlySet<string>>();
  const precomputedSdtLabels = new Set<string>();
  for (const pageIndex of desired) {
    const packet = validatedPackets.get(pageIndex)!;
    const expected = computeExpectedSdtLabelKeys(packet.items, precomputedSdtLabels);
    expectedSdtLabelsByPage.set(pageIndex, expected);
    for (const label of expected) precomputedSdtLabels.add(label);
  }

  const sdtLabelsRendered = ctx.contentContext.sdtLabelsRendered;
  sdtLabelsRendered.clear();

  for (const pageIndex of desired) {
    const shell = state.shells.get(pageIndex)!;
    const entry = state.content.get(pageIndex);
    const packet = validatedPackets.get(pageIndex)!;
    const layoutEpoch = String(input.scaffold.generation);
    if (shell.element.dataset.layoutEpoch !== layoutEpoch) {
      shell.element.dataset.layoutEpoch = layoutEpoch;
    }
    const pageNumber = String(packet.number);
    if (shell.element.dataset.pageNumber !== pageNumber) {
      shell.element.dataset.pageNumber = pageNumber;
    }
    const versionKey = persistentPageVersionKey(
      packet,
      ctx.contentContext.totalPages,
      ctx.contentContext.getSectionPageCount(packet),
      input.derivedRunTextPlane,
    );
    const expectedSdtLabels = expectedSdtLabelsByPage.get(pageIndex)!;

    if (
      entry &&
      versionKey != null &&
      entry.versionKey === versionKey &&
      sdtLabelSetsEqual(entry.sdtLabels, expectedSdtLabels)
    ) {
      const remap = planWindowPositionRemap(entry.state, packet);
      if (remap.kind !== 'demote') {
        for (const label of expectedSdtLabels) sdtLabelsRendered.add(label);
        let decorationsRefreshed = false;
        if (refreshDecorations) {
          ctx.contentContext.renderDecorationsForPage(shell.element, packet, pageIndex);
          decorationsRefreshed = true;
        }
        if (remap.kind === 'remap') {
          for (const { fragmentState, freshItem, decision } of remap.drifted) {
            applyPmReuseDecision(fragmentState.element, decision);
            fragmentState.fragment = freshItem.fragment;
            fragmentState.pmInteriorVersion = resolvedPmInteriorVersion(freshItem);
          }
          ctx.work.contentRemapped += 1;
          ctx.recordPageWork('remappedContentPageIndices', pageIndex);
        } else if (decorationsRefreshed) {
          ctx.work.contentDecorationsRefreshed += 1;
          ctx.recordPageWork('decorationRefreshedContentPageIndices', pageIndex);
        } else {
          ctx.work.contentUntouched += 1;
          ctx.recordPageWork('untouchedContentPageIndices', pageIndex);
        }
        continue;
      }
      // Fall through: stamps matched but the drift is not provably uniform —
      // the fragment-keyed patch below is the sound reconcile.
      ctx.work.contentPmDemoted += 1;
      ctx.recordPageWork('pmDemotedContentPageIndices', pageIndex);
    }

    if (entry) {
      const work = patchPage(ctx.contentContext, entry.state, packet, pageIndex);
      entry.versionKey = versionKey;
      entry.sdtLabels = expectedSdtLabels;
      ctx.work.contentPatched += 1;
      ctx.recordPageWork('patchedContentPageIndices', pageIndex);
      ctx.work.fragmentsRendered += work.fragmentsRendered;
      ctx.work.fragmentsReused += work.fragmentsReused;
    } else {
      const fragments: FragmentDomState[] = hydratePageContent(ctx.contentContext, shell.element, packet, pageIndex);
      state.content.set(pageIndex, {
        state: { element: shell.element, fragments },
        versionKey,
        sdtLabels: expectedSdtLabels,
      });
      ctx.work.contentHydrated += 1;
      ctx.recordPageWork('hydratedContentPageIndices', pageIndex);
      ctx.work.fragmentsRendered += fragments.length;
      stampContentPosture(shell.element, true);
    }
    for (const label of expectedSdtLabels) sdtLabelsRendered.add(label);
  }

  for (const pageIndex of touched) {
    if (desiredSet.has(pageIndex)) continue;
    const shell = state.shells.get(pageIndex)!;
    const entry = state.content.get(pageIndex);
    if (!entry) continue;
    // Dehydrate only after every entering page is filled. Root identity,
    // attributes, order, geometry, and scroll extent remain untouched.
    dehydratePageContent(shell.element, entry.state);
    state.content.delete(pageIndex);
    stampContentPosture(shell.element, false);
    ctx.work.contentDehydrated += 1;
    ctx.recordPageWork('dehydratedContentPageIndices', pageIndex);
  }
}

/**
 * The one persistent paginated reconcile. Same-scaffold calls skip shell
 * work in O(1) (reference identity); scaffold identity changes rebuild the
 * shell registry by page index; the content window reconciles every call.
 */
export function reconcilePersistentPageSurface(
  ctx: PersistentSurfaceRenderContext,
  previous: PersistentPageSurfaceState | null,
  input: DomPainterPersistentPageInput,
  mount: HTMLElement,
): PersistentPageSurfaceState {
  // Fail closed BEFORE any DOM mutation — shell OR content: every desired
  // page needs an exact, generation-matched, geometry-matched packet, or the
  // whole reconcile refuses to start.
  validateDerivedRunTextPlane(input.derivedRunTextPlane, input.scaffold.generation);
  const desired = resolveDesiredContentPageIndices(input);
  const validatedPackets = new Map<number, ResolvedPage>();
  for (const pageIndex of desired) {
    validatedPackets.set(pageIndex, requireDesiredPacket(input, pageIndex));
  }

  const sameScaffold =
    previous != null &&
    previous.mount === mount &&
    previous.scaffold === input.scaffold &&
    !consumePersistentSurfaceIntegrityFailure(previous);

  const state = sameScaffold ? previous : reconcileScaffoldShells(ctx, previous, input, mount);
  reconcileContentWindow(ctx, state, input, desired, validatedPackets);
  return state;
}

/** Deep-clone the retained planes for the painter's rollback snapshot. */
export function clonePersistentPageSurfaceState(
  state: PersistentPageSurfaceState | null,
  clonePageState: (pageState: PageDomState) => PageDomState,
): PersistentPageSurfaceState | null {
  if (state == null) return null;
  return {
    mount: state.mount,
    scaffold: state.scaffold,
    shells: new Map(Array.from(state.shells, ([pageIndex, entry]) => [pageIndex, { ...entry }])),
    content: new Map(
      Array.from(state.content, ([pageIndex, entry]) => [
        pageIndex,
        {
          state: clonePageState(entry.state),
          versionKey: entry.versionKey,
          sdtLabels: new Set(entry.sdtLabels),
        },
      ]),
    ),
    integrity: state.integrity,
  };
}
