import type { FootnotePageLedger, Measure } from '@superdoc/contracts';
import { fitFootnoteContent, getRangeRenderHeight, type FootnoteRange, type FootnoteSlice } from './footnote-content';

export type PendingFootnote = { id: string; ranges: FootnoteRange[] };
type IncomingFootnote = { readonly id: string; readonly ranges: readonly FootnoteRange[] };

export type FootnotePageLedgerDraft = Omit<FootnotePageLedger, 'pageIndex' | 'appliedBodyReservePx' | 'deadReservePx'>;

export type FootnotePagePlanInput = {
  pageIndex: number;
  columnCount: number;
  /** Physical capacity for this page's note band, including separator, padding, and gaps. */
  availableHeight: number;
  idsByColumn: ReadonlyMap<number, readonly string[]>;
  rangesByFootnoteId: ReadonlyMap<string, readonly FootnoteRange[]>;
  measuresById: ReadonlyMap<string, Measure>;
  fullHeightById: ReadonlyMap<string, number>;
  firstLineHeightById: ReadonlyMap<string, number>;
  pendingByColumn: ReadonlyMap<number, readonly IncomingFootnote[]>;
  separatorSpacingBefore: number;
  dividerHeight: number;
  continuationDividerHeight: number;
  topPadding: number;
  gap: number;
};

export type FootnotePagePlan = {
  slices: FootnoteSlice[];
  pendingByColumn: Map<number, PendingFootnote[]>;
  ledger: FootnotePageLedgerDraft;
  /** Rounded reserve capped at the supplied capacity; not a proof that every slice fits. */
  reserve: number;
  /** Unrounded, uncapped height of the tallest placed column. */
  actualReserve: number;
  hasContinuationByColumn: Map<number, boolean>;
  capped: boolean;
  overflowHeightPx: number;
  overflowHeightByColumn: Map<number, number>;
  /** Outgoing ranges or physical overflow still require a controller decision. */
  hasUnresolvedContent: boolean;
};

const rangeDemand = (ranges: readonly FootnoteRange[]): number => {
  let total = 0;
  for (const range of ranges) {
    total += getRangeRenderHeight(range);
  }
  return total;
};

const continuationEntries = (pending: ReadonlyMap<number, readonly IncomingFootnote[]>) => {
  const entries: FootnotePageLedgerDraft['continuationIn'] = [];
  for (const column of pending.values()) {
    for (const entry of column) {
      entries.push({
        id: entry.id,
        remainingRangeCount: entry.ranges.length,
        remainingHeightPx: rangeDemand(entry.ranges),
      });
    }
  }
  return entries;
};

/**
 * Places one page from exact incoming ranges. Global inventories are lookup-only;
 * body placement and any future-page capacity decision belong to the caller.
 */
export const planFootnotePage = (input: FootnotePagePlanInput): FootnotePagePlan => {
  const columnCount = Math.max(1, Math.floor(input.columnCount));
  const placementCeiling = Math.max(0, input.availableHeight);
  const safeGap = Math.max(0, input.gap);
  const safeTopPadding = Math.max(0, input.topPadding);
  const safeDividerHeight = Math.max(0, input.dividerHeight);
  const continuationDividerHeight = Math.max(0, input.continuationDividerHeight);
  const safeSeparatorSpacingBefore = Math.max(0, input.separatorSpacingBefore);
  const fullHeightOf = (id: string): number =>
    input.fullHeightById.get(id) ?? rangeDemand(input.rangesByFootnoteId.get(id) ?? []);
  const firstLineOf = (id: string): number => {
    const measured = input.firstLineHeightById.get(id);
    if (typeof measured === 'number' && Number.isFinite(measured) && measured > 0) return measured;
    return input.rangesByFootnoteId.get(id)?.[0]?.height ?? 0;
  };

  const pendingForPage = new Map<number, PendingFootnote[]>();
  for (const [columnIndex, entries] of input.pendingByColumn) {
    const targetIndex = columnIndex < columnCount ? columnIndex : columnCount - 1;
    const list = pendingForPage.get(targetIndex) ?? [];
    for (const entry of entries) list.push({ id: entry.id, ranges: entry.ranges.slice() });
    pendingForPage.set(targetIndex, list);
  }
  const continuationIn = continuationEntries(pendingForPage);
  const pendingByColumn = new Map<number, PendingFootnote[]>();
  const hasContinuationByColumn = new Map<number, boolean>();
  const overflowHeightByColumn = new Map<number, number>();
  const slices: FootnoteSlice[] = [];
  let reserve = 0;
  let actualReserve = 0;
  let overflowHeightPx = 0;
  let capped = false;

  for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
    let usedHeight = 0;
    const columnSlices: FootnoteSlice[] = [];
    const nextPending: PendingFootnote[] = [];

    const placeFootnote = (
      id: string,
      ranges: readonly FootnoteRange[],
      isContinuation: boolean,
      isLastOnPage: boolean,
    ): { placed: boolean; remaining: FootnoteRange[] } => {
      if (ranges.length === 0) return { placed: false, remaining: [] };

      const isFirstSlice = columnSlices.length === 0;
      const separatorHeight = isContinuation ? continuationDividerHeight : safeDividerHeight;
      const overhead = isFirstSlice ? safeSeparatorSpacingBefore + separatorHeight + safeTopPadding : 0;
      const gapBefore = !isFirstSlice ? safeGap : 0;
      const availableHeight = Math.max(0, placementCeiling - usedHeight - overhead - gapBefore);
      // SD-2656: only the last new anchor or a continuation may force its first
      // range. The caller must reject physical overflow reported below.
      const allowForceFirst = (isLastOnPage || isContinuation) && placementCeiling > 0;
      const { slice, remainingRanges } = fitFootnoteContent(
        id,
        ranges,
        availableHeight,
        input.pageIndex,
        columnIndex,
        isContinuation,
        input.measuresById,
        allowForceFirst,
      );

      if (slice.ranges.length === 0 || (!isLastOnPage && !isContinuation && remainingRanges.length > 0)) {
        return { placed: false, remaining: ranges.slice() };
      }

      if (isFirstSlice) {
        usedHeight += overhead;
        if (isContinuation) hasContinuationByColumn.set(columnIndex, true);
      }
      usedHeight += gapBefore + slice.totalHeight;
      columnSlices.push(slice);
      return { placed: true, remaining: remainingRanges };
    };

    const ids = input.idsByColumn.get(columnIndex) ?? [];
    const lastIdx = ids.length - 1;
    let clusterReserve = 0;
    for (let index = 0; index < ids.length; index += 1) {
      clusterReserve += index === lastIdx ? firstLineOf(ids[index]) : fullHeightOf(ids[index]);
      if (index > 0) clusterReserve += safeGap;
    }

    // Reserve the ordered cluster while placing continuations at the visual top.
    usedHeight += clusterReserve;
    const pending = pendingForPage.get(columnIndex) ?? [];
    for (let index = 0; index < pending.length; index += 1) {
      const entry = pending[index];
      if (entry.ranges.length === 0) continue;
      const result = placeFootnote(entry.id, entry.ranges, true, false);
      if (!result.placed) {
        for (const deferred of pending.slice(index)) {
          if (deferred.ranges.length > 0) nextPending.push(deferred);
        }
        break;
      }
      if (result.remaining.length > 0) {
        nextPending.push({ id: entry.id, ranges: result.remaining });
        for (const deferred of pending.slice(index + 1)) {
          if (deferred.ranges.length > 0) nextPending.push(deferred);
        }
        break;
      }
    }
    usedHeight -= clusterReserve;

    for (let index = 0; index < ids.length; index += 1) {
      const id = ids[index];
      const ranges = input.rangesByFootnoteId.get(id) ?? [];
      if (ranges.length === 0) continue;
      const result = placeFootnote(id, ranges, false, index === lastIdx);
      if (!result.placed) {
        nextPending.push({ id, ranges: ranges.slice() });
        for (let remainingIndex = index + 1; remainingIndex < ids.length; remainingIndex += 1) {
          const remainingId = ids[remainingIndex];
          nextPending.push({ id: remainingId, ranges: (input.rangesByFootnoteId.get(remainingId) ?? []).slice() });
        }
        break;
      }
      if (result.remaining.length > 0) nextPending.push({ id, ranges: result.remaining });
    }

    if (columnSlices.length > 0) {
      const rawReserve = Math.max(0, Math.ceil(usedHeight));
      const cappedReserve = Math.min(rawReserve, placementCeiling);
      capped ||= cappedReserve < rawReserve;
      reserve = Math.max(reserve, cappedReserve);
      actualReserve = Math.max(actualReserve, usedHeight);
      const overflow = Math.max(0, usedHeight - placementCeiling);
      if (overflow > 0) overflowHeightByColumn.set(columnIndex, overflow);
      overflowHeightPx = Math.max(overflowHeightPx, overflow);
      slices.push(...columnSlices);
    }
    if (nextPending.length > 0) pendingByColumn.set(columnIndex, nextPending);
  }

  const anchorIds: string[] = [];
  const anchorIdSet = new Set<string>();
  for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
    for (const id of input.idsByColumn.get(columnIndex) ?? []) {
      if (anchorIdSet.has(id)) continue;
      anchorIdSet.add(id);
      anchorIds.push(id);
    }
  }

  const seenNewAnchor = new Set<string>();
  const mandatorySliceIds: string[] = [];
  const continuationSliceIds: string[] = [];
  const extendedSliceIds: string[] = [];
  let actualBandHeight = 0;
  const overheadBase = safeSeparatorSpacingBefore + safeDividerHeight + safeTopPadding;
  for (const slice of slices) {
    if (slice.isContinuation) {
      continuationSliceIds.push(slice.id);
    } else if (!seenNewAnchor.has(slice.id)) {
      mandatorySliceIds.push(slice.id);
      seenNewAnchor.add(slice.id);
    } else {
      extendedSliceIds.push(slice.id);
    }
    actualBandHeight += slice.totalHeight;
  }
  // Keep the existing ledger's cross-column diagnostic arithmetic. Physical
  // admission uses actualReserve/overflowHeightByColumn, never this sum.
  if (slices.length > 0) actualBandHeight += overheadBase + safeGap * Math.max(0, slices.length - 1);

  let mandatoryReserve = 0;
  let preferredReserve = 0;
  let continuationInHeight = 0;
  for (const entry of continuationIn) continuationInHeight += entry.remainingHeightPx;
  if (continuationInHeight > 0) {
    mandatoryReserve += continuationInHeight;
    preferredReserve += continuationInHeight;
    if (anchorIds.length > 0) {
      mandatoryReserve += safeGap;
      preferredReserve += safeGap;
    }
  }
  if (anchorIds.length > 0) {
    for (let index = 0; index < anchorIds.length; index += 1) {
      mandatoryReserve +=
        index === anchorIds.length - 1 ? firstLineOf(anchorIds[index]) : fullHeightOf(anchorIds[index]);
      preferredReserve += fullHeightOf(anchorIds[index]);
      if (index > 0) {
        mandatoryReserve += safeGap;
        preferredReserve += safeGap;
      }
    }
    mandatoryReserve += overheadBase;
    preferredReserve += overheadBase;
  } else if (continuationInHeight > 0) {
    mandatoryReserve += overheadBase;
    preferredReserve += overheadBase;
  }

  let lastAnchorRenderedLines = 0;
  if (anchorIds.length > 0) {
    const lastId = anchorIds[anchorIds.length - 1];
    for (const slice of slices) {
      if (slice.id !== lastId || slice.isContinuation) continue;
      for (const range of slice.ranges) {
        lastAnchorRenderedLines +=
          range.kind === 'paragraph' || range.kind === 'list-item' ? Math.max(0, range.toLine - range.fromLine) : 1;
      }
    }
  }

  return {
    slices,
    pendingByColumn,
    reserve,
    actualReserve,
    hasContinuationByColumn,
    capped,
    overflowHeightPx,
    overflowHeightByColumn,
    hasUnresolvedContent: pendingByColumn.size > 0 || overflowHeightPx > 0,
    ledger: {
      anchorIds,
      mandatorySliceIds,
      continuationSliceIds,
      extendedSliceIds,
      continuationIn,
      continuationOut: continuationEntries(pendingByColumn),
      mandatoryReservePx: Math.ceil(mandatoryReserve),
      preferredReservePx: Math.ceil(preferredReserve),
      actualBandHeightPx: Math.ceil(actualBandHeight),
      lastAnchorRenderedLines,
    },
  };
};
