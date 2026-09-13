import { resolveColumnCount } from '@superdoc/contracts';
import type { ColumnLayout, Page, PageMargins } from '@superdoc/contracts';

export type ConstraintBoundary = {
  y: number;
  columns: ColumnLayout;
};

export type PageState = {
  page: Page;
  cursorY: number;
  columnIndex: number;
  topMargin: number;
  contentBottom: number;
  constraintBoundaries: ConstraintBoundary[];
  activeConstraintIndex: number;
  trailingSpacing: number;
  lastParagraphStyleId?: string;
  lastParagraphContextualSpacing: boolean;
  /** Border hash of the last paragraph for between-border group detection. */
  lastParagraphBorderHash?: string;
  /** Tracks the maximum cursorY reached across all columns on this page.
   *  Used when starting a mid-page region so the new section begins below
   *  all column content, not just the current column's cursor. */
  maxCursorY: number;
  /** Committed paragraph footprint, excluding speculative before/after spacing. */
  committedBodyBottom?: number;
  /**
   * SD-3049: Page-level footnote reserve already baked into `contentBottom`
   * via `getActiveBottomMargin`. The block-aware break decision compares
   * `footnoteDemandThisPage` against this; only the excess shrinks the body.
   */
  pageFootnoteReserve: number;
  /**
   * SD-3049: Accumulated measured body height of footnote refs anchored on
   * fragments already committed to this page (and column-wide). Used by the
   * paragraph break decision so the body packs tight to footnote demand
   * instead of relying solely on the post-hoc page-level reserve.
   */
  footnoteDemandThisPage: number;
  /**
   * SD-2656: Number of distinct footnote refs anchored on this page so far.
   * Drives the slicer's band-overhead computation (separator + per-extra-ref
   * gap + safety margin), which must match the planner's reserve formula.
   */
  footnoteRefsThisPage: number;
  /**
   * SD-2656: ordered list of footnote anchors committed to this page (by
   * document/PM order). The body slicer pushes a new entry when it accepts a
   * candidate line that introduces a new anchor. The list drives the ordered-
   * cluster demand formula:
   *   demand = sum(fullHeight of cluster[0..N-1]) + firstLineHeight(cluster[N-1])
   * i.e. all anchors except the last must fit fully; only the last may split.
   * Identified by refId so callers can dedupe and walk in document order.
   */
  footnoteAnchorsThisPage: Array<{ pmPos: number; refId: string; fullHeight: number; firstLineHeight: number }>;
};

export type PaginatorOptions = {
  margins: { left: number; right: number };
  getActiveTopMargin(): number;
  getActiveBottomMargin(): number;
  getActiveHeaderDistance(): number;
  getActiveFooterDistance(): number;
  getActivePageSize(): { w: number; h: number };
  getDefaultPageSize(): { w: number; h: number };
  getActiveColumns(): ColumnLayout;
  /** Exact first-page state from an engine-authored flow-fragment checkpoint. */
  initialPageState?: {
    prefixFragments: readonly Page['fragments'][number][];
    cursorY: number;
    maxCursorY: number;
    committedBodyBottom?: number;
    columnIndex: number;
    trailingSpacing: number;
    lastParagraphStyleId?: string;
    lastParagraphContextualSpacing: boolean;
    lastParagraphBorderHash?: string;
    constraintBoundaries: readonly ConstraintBoundary[];
    activeConstraintIndex: number;
    footnoteDemandThisPage: number;
    footnoteRefsThisPage: number;
    footnoteAnchorsThisPage: readonly PageState['footnoteAnchorsThisPage'][number][];
  };
  pageNumberOffset?: number;
  createPage(number: number, pageMargins: PageMargins, pageSizeOverride?: { w: number; h: number }): Page;
  onNewPage?: (state: PageState | undefined, options?: { applyPendingSection: boolean }) => void;
  shouldStopBeforeNewPage?: (input: {
    completedPageIndex: number;
    pages: readonly Page[];
    states: readonly PageState[];
  }) => boolean;
  /**
   * SD-3049: per-page footnote reserve (the value already added to
   * `getActiveBottomMargin`). Returned by index for the page about to be
   * created. Defaults to 0 when not provided.
   */
  getFootnoteReserveForPage?: (pageIndex: number) => number;
  /** Coupled note-only continuation pages are real content before note injection. */
  keepNoteOnlyPages?: boolean;
};

export class PaginationEarlyStop extends Error {
  constructor() {
    super('layoutDocument pagination stopped at page boundary');
    this.name = 'PaginationEarlyStop';
  }
}

export function isPaginationEarlyStop(error: unknown): error is PaginationEarlyStop {
  return error instanceof PaginationEarlyStop;
}

/**
 * Break paragraph-only spacing and border adjacency at an in-flow block boundary.
 *
 * Paragraph layout has already included `trailingSpacing` in `cursorY`, so this
 * intentionally does not move the cursor. It only prevents a later paragraph
 * from collapsing spacing or borders through an intervening block.
 */
export function breakParagraphAdjacency(state: PageState): void {
  state.trailingSpacing = 0;
  state.lastParagraphStyleId = undefined;
  state.lastParagraphContextualSpacing = false;
  state.lastParagraphBorderHash = undefined;
}

export function createPaginator(opts: PaginatorOptions) {
  const states: PageState[] = [];
  const pages: Page[] = [];

  const pruneTrailingEmptyPages = (): void => {
    while (
      pages.length > 0 &&
      pages[pages.length - 1].fragments.length === 0 &&
      !(opts.keepNoteOnlyPages && (pages[pages.length - 1].footnoteReserved ?? 0) > 0)
    ) {
      pages.pop();
      states.pop();
    }
  };

  const getActiveColumnsForState = (state: PageState): ColumnLayout => {
    if (state.activeConstraintIndex >= 0 && state.constraintBoundaries[state.activeConstraintIndex]) {
      return state.constraintBoundaries[state.activeConstraintIndex].columns;
    }
    return opts.getActiveColumns();
  };

  const startNewPage = (options: { applyPendingSection?: boolean; replaceCurrentPage?: boolean } = {}): PageState => {
    const replaceCurrentPage = options.replaceCurrentPage === true && pages.length > 0;
    if (replaceCurrentPage) {
      // A manual page break can open the physical page that an immediately
      // following section break also targets. Rebuild that still-empty page so
      // pending section geometry is snapshotted onto the same physical page;
      // appending here would create a spurious blank page.
      pages.pop();
      states.pop();
    }
    if (
      !replaceCurrentPage &&
      pages.length > 0 &&
      opts.shouldStopBeforeNewPage?.({
        completedPageIndex: pages.length - 1,
        pages,
        states,
      }) === true
    ) {
      throw new PaginationEarlyStop();
    }
    // Allow caller to update state (e.g., apply pending→active) before we snapshot margins/size
    // oxlint-disable-next-line @typescript-eslint/no-explicit-any
    if (opts.onNewPage) {
      opts.onNewPage(undefined, { applyPendingSection: options.applyPendingSection !== false });
    }
    const topMargin = opts.getActiveTopMargin();
    const bottomMargin = opts.getActiveBottomMargin();
    const headerDistance = opts.getActiveHeaderDistance();
    const footerDistance = opts.getActiveFooterDistance();
    const currentPageSize = opts.getActivePageSize();
    const defaultPageSize = opts.getDefaultPageSize();

    const contentBottom = currentPageSize.h - bottomMargin;
    const contentHeight = contentBottom - topMargin;

    if (contentHeight <= 0) {
      throw new Error('layoutDocument: pageSize and margins yield non-positive content area');
    }
    const pageMargins: PageMargins = {
      top: topMargin,
      bottom: bottomMargin,
      left: opts.margins.left,
      right: opts.margins.right,
      header: headerDistance,
      footer: footerDistance,
    };

    const pageSizeOverride =
      currentPageSize.w !== defaultPageSize.w || currentPageSize.h !== defaultPageSize.h ? currentPageSize : undefined;

    const pageIndex = pages.length;
    const pageFootnoteReserve = opts.getFootnoteReserveForPage?.(pageIndex) ?? 0;
    const state: PageState = {
      page: opts.createPage(pageIndex + 1 + (opts.pageNumberOffset ?? 0), pageMargins, pageSizeOverride),
      cursorY: topMargin,
      columnIndex: 0,
      topMargin,
      contentBottom,
      constraintBoundaries: [],
      activeConstraintIndex: -1,
      trailingSpacing: 0,
      lastParagraphStyleId: undefined,
      lastParagraphContextualSpacing: false,
      maxCursorY: topMargin,
      ...(opts.keepNoteOnlyPages ? { committedBodyBottom: topMargin } : {}),
      pageFootnoteReserve,
      footnoteDemandThisPage: 0,
      footnoteRefsThisPage: 0,
      footnoteAnchorsThisPage: [],
    };
    const initial = pageIndex === 0 ? opts.initialPageState : undefined;
    if (initial) {
      state.page.fragments.push(...initial.prefixFragments.map((fragment) => ({ ...fragment })));
      state.cursorY = initial.cursorY;
      state.maxCursorY = initial.maxCursorY;
      if (initial.committedBodyBottom != null) state.committedBodyBottom = initial.committedBodyBottom;
      state.columnIndex = initial.columnIndex;
      state.trailingSpacing = initial.trailingSpacing;
      state.lastParagraphStyleId = initial.lastParagraphStyleId;
      state.lastParagraphContextualSpacing = initial.lastParagraphContextualSpacing;
      state.lastParagraphBorderHash = initial.lastParagraphBorderHash;
      state.constraintBoundaries = initial.constraintBoundaries.map((boundary) => ({
        y: boundary.y,
        columns: { ...boundary.columns },
      }));
      state.activeConstraintIndex = initial.activeConstraintIndex;
      state.footnoteDemandThisPage = initial.footnoteDemandThisPage;
      state.footnoteRefsThisPage = initial.footnoteRefsThisPage;
      state.footnoteAnchorsThisPage = initial.footnoteAnchorsThisPage.map((anchor) => ({ ...anchor }));
    }
    states.push(state);
    pages.push(state.page);
    if (opts.onNewPage) opts.onNewPage(state);
    return state;
  };

  const ensurePage = (): PageState => {
    const last = states[states.length - 1];
    if (last) return last;
    return startNewPage();
  };

  const advanceColumn = (state: PageState): PageState => {
    const activeCols = getActiveColumnsForState(state);
    // Use the RESOLVED count (clamped to usable explicit widths), not the raw w:num, so the fill
    // loop and the width math (normalizeColumnLayout) agree on how many columns exist. Without this
    // the loop advances into columns that have no width (the SD-2629 two-track count bug).
    if (state.columnIndex < resolveColumnCount(activeCols) - 1) {
      // Snapshot max Y before resetting cursor for the next column
      state.maxCursorY = Math.max(state.maxCursorY, state.cursorY);
      state.columnIndex += 1;
      if (state.activeConstraintIndex >= 0 && state.constraintBoundaries[state.activeConstraintIndex]) {
        state.cursorY = state.constraintBoundaries[state.activeConstraintIndex].y;
      } else {
        state.cursorY = state.topMargin;
      }
      breakParagraphAdjacency(state);
      // Footnotes are reserved per-column; the body slicer's demand formula
      // must reset per-column. Field names retain "ThisPage" for back-compat.
      state.footnoteAnchorsThisPage = [];
      state.footnoteRefsThisPage = 0;
      return state;
    }
    return startNewPage();
  };

  const getPageByNumber = (pageNumber: number): PageState => {
    return states.find((s) => s.page.number === pageNumber) ?? ensurePage();
  };

  return {
    pages,
    states,
    startNewPage,
    ensurePage,
    advanceColumn,
    getActiveColumnsForState,
    getPageByNumber,
    pruneTrailingEmptyPages,
  } as const;
}
