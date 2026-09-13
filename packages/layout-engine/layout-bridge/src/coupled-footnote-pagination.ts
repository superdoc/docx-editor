import type { Page } from '@superdoc/contracts';
import type { FootnoteRange, FootnoteSlice } from './footnote-content';
import {
  planFootnotePage,
  type FootnotePageLedgerDraft,
  type FootnotePagePlanInput,
  type PendingFootnote,
} from './footnote-page-planner';

export type CoupledFootnotePaginationOptions = Omit<
  FootnotePagePlanInput,
  'pageIndex' | 'columnCount' | 'availableHeight' | 'idsByColumn' | 'pendingByColumn'
> & {
  pageSize: { w: number; h: number };
  /** The bridge must validate exact boundary provenance before supplying a start, never a height-only seed. */
  start?: {
    pageIndex: number;
    pendingByColumn: FootnotePagePlanInput['pendingByColumn'];
    isPreviouslyAnchored(id: string): boolean;
  };
};

export type CoupledFootnotePageCompletion = {
  page: Page;
  pageIndex: number;
  bodyBottom: number;
  physicalBottom: number;
  anchors: readonly { refId: string }[];
};

export type CoupledFootnotePageFlow = {
  incomingDemand(pageIndex: number): { height: number; refs: number };
  completePage(completion: CoupledFootnotePageCompletion): void;
  hasPendingContinuation(): boolean;
};

export type CoupledFootnotePagination = {
  flow: CoupledFootnotePageFlow;
  plan: {
    slicesByPage: Map<number, FootnoteSlice[]>;
    reserves: number[];
    hasContinuationByColumn: Map<string, boolean>;
    separatorSpacingBefore: number;
    ledgersByPage: Map<number, FootnotePageLedgerDraft>;
    incomingByPage: Map<number, Map<number, PendingFootnote[]>>;
    outgoingByPage: Map<number, Map<number, PendingFootnote[]>>;
  };
};

export type CoupledFootnotePaginationFailure =
  | 'unsupported-page'
  | 'page-sequence'
  | 'missing-anchor'
  | 'duplicate-claim'
  | 'ordered-minimum'
  | 'physical-overflow'
  | 'range-conservation'
  | 'reference-conservation'
  | 'no-progress';

export class CoupledFootnotePaginationError extends Error {
  readonly name = 'CoupledFootnotePaginationError';

  constructor(
    readonly code: CoupledFootnotePaginationFailure,
    readonly pageIndex: number,
    message: string,
    readonly footnoteId?: string,
  ) {
    super(message);
  }
}

/** Call only at real document EOF; expected IDs exclude references anchored before this pass. */
export const validateCoupledFootnoteReferenceConservation = (
  plan: Pick<CoupledFootnotePagination['plan'], 'ledgersByPage'>,
  expectedAnchorIds: Iterable<string>,
): void => {
  const fail = (id: string, pageIndex: number, message: string): never => {
    throw new CoupledFootnotePaginationError('reference-conservation', pageIndex, message, id);
  };
  const anchoredPageById = new Map<string, number>();
  let lastPageIndex = 0;
  for (const [pageIndex, ledger] of plan.ledgersByPage) {
    lastPageIndex = Math.max(lastPageIndex, pageIndex);
    for (const id of ledger.anchorIds) {
      if (anchoredPageById.has(id)) fail(id, pageIndex, `Footnote ${id} was anchored more than once in this pass`);
      anchoredPageById.set(id, pageIndex);
    }
  }

  const expectedIds = new Set<string>();
  for (const id of expectedAnchorIds) {
    if (expectedIds.has(id)) {
      fail(
        id,
        anchoredPageById.get(id) ?? lastPageIndex,
        `Footnote ${id} occurs more than once in expected references`,
      );
    }
    expectedIds.add(id);
    if (!anchoredPageById.has(id)) fail(id, lastPageIndex, `Expected footnote ${id} was never anchored in this pass`);
  }
  for (const [id, pageIndex] of anchoredPageById) {
    if (!expectedIds.has(id))
      fail(id, pageIndex, `Footnote ${id} was anchored outside this pass's expected references`);
  }
};

const HEIGHT_EPSILON = 1e-7;

const conservesRanges = (expected: readonly FootnoteRange[], actual: readonly FootnoteRange[]): boolean => {
  let sourceIndex = 0;
  let nextLine: number | undefined;
  let rangeHeight = 0;
  for (const range of actual) {
    const source = expected[sourceIndex];
    if (!source || source.kind !== range.kind || source.blockId !== range.blockId) return false;
    if (!Number.isFinite(range.height) || range.height < 0) return false;
    if ('fromLine' in source) {
      if (!('fromLine' in range)) return false;
      if (source.kind === 'list-item' && range.kind === 'list-item' && source.itemId !== range.itemId) return false;
      if (
        range.fromLine !== (nextLine ?? source.fromLine) ||
        range.toLine <= range.fromLine ||
        range.toLine > source.toLine ||
        range.totalLines !== source.totalLines ||
        range.spacingAfter !== source.spacingAfter
      )
        return false;
      rangeHeight += range.height;
      if (range.toLine < source.toLine) {
        nextLine = range.toLine;
        continue;
      }
      if (Math.abs(rangeHeight - source.height) > HEIGHT_EPSILON) return false;
      nextLine = undefined;
      rangeHeight = 0;
    } else if (Math.abs(range.height - source.height) > HEIGHT_EPSILON) {
      return false;
    }
    sourceIndex += 1;
  }
  return sourceIndex === expected.length;
};

const appendRanges = (target: Map<string, FootnoteRange[]>, id: string, ranges: readonly FootnoteRange[]): void => {
  const list = target.get(id) ?? [];
  for (const range of ranges) list.push(range);
  target.set(id, list);
};

const copyPending = (pending: FootnotePagePlanInput['pendingByColumn']): Map<number, PendingFootnote[]> => {
  const copy = new Map<number, PendingFootnote[]>();
  for (const [columnIndex, entries] of pending) {
    copy.set(
      columnIndex,
      entries.map((entry) => ({
        id: entry.id,
        ranges: entry.ranges.map((range) => ({ ...range })),
      })),
    );
  }
  return copy;
};

const pendingDemand = (pending: FootnotePagePlanInput['pendingByColumn']): { height: number; refs: number } => {
  const demand = { height: 0, refs: 0 };
  for (const entries of pending.values()) {
    for (const entry of entries) {
      if (entry.ranges.length === 0) continue;
      demand.refs += 1;
      for (const range of entry.ranges) {
        demand.height += range.height + ('spacingAfter' in range ? (range.spacingAfter ?? 0) : 0);
      }
    }
  }
  return demand;
};

/**
 * Owns forward page admission from a fresh start or a bridge-validated boundary.
 * Prepared inventories and prior anchor ownership remain lookup-only.
 */
export const createCoupledFootnotePagination = (
  options: CoupledFootnotePaginationOptions,
): CoupledFootnotePagination => {
  const plan: CoupledFootnotePagination['plan'] = {
    slicesByPage: new Map(),
    reserves: [],
    hasContinuationByColumn: new Map(),
    separatorSpacingBefore: options.separatorSpacingBefore,
    ledgersByPage: new Map(),
    incomingByPage: new Map(),
    outgoingByPage: new Map(),
  };
  let nextPageIndex = options.start?.pageIndex ?? 0;
  let pendingByColumn = copyPending(options.start?.pendingByColumn ?? new Map());
  let incoming = pendingDemand(pendingByColumn);
  const isPreviouslyAnchored = options.start?.isPreviouslyAnchored;
  const claimedIds = new Set<string>();
  const blockOwners = new Map<string, string>();
  if (!Number.isInteger(nextPageIndex) || nextPageIndex < 0) {
    throw new CoupledFootnotePaginationError(
      'page-sequence',
      nextPageIndex,
      'Starting page index must be nonnegative and integral',
    );
  }
  for (const [columnIndex, entries] of pendingByColumn) {
    if (columnIndex !== 0) {
      throw new CoupledFootnotePaginationError(
        'unsupported-page',
        nextPageIndex,
        'Starting continuation must belong to the single admitted column',
      );
    }
    for (const entry of entries) {
      claimedIds.add(entry.id);
      for (const range of entry.ranges) blockOwners.set(range.blockId, entry.id);
    }
  }

  const requireNextPage = (pageIndex: number): void => {
    if (pageIndex !== nextPageIndex) {
      throw new CoupledFootnotePaginationError(
        'page-sequence',
        pageIndex,
        `Expected footnote page ${nextPageIndex}, received ${pageIndex}`,
      );
    }
  };

  const completePage = ({
    page,
    pageIndex,
    bodyBottom,
    physicalBottom,
    anchors,
  }: CoupledFootnotePageCompletion): void => {
    requireNextPage(pageIndex);
    function fail(code: CoupledFootnotePaginationFailure, message: string, id?: string): never {
      throw new CoupledFootnotePaginationError(code, pageIndex, message, id);
    }
    const pageHeight = (page.size ?? options.pageSize).h;
    if (
      (page.columns?.count ?? 1) !== 1 ||
      page.columnRegions?.some((region) => region.columns.count !== 1) ||
      (page.vAlign !== undefined && page.vAlign !== 'top') ||
      !Number.isFinite(pageHeight) ||
      pageHeight <= 0 ||
      !Number.isFinite(bodyBottom) ||
      bodyBottom < 0 ||
      !Number.isFinite(physicalBottom) ||
      physicalBottom < 0 ||
      physicalBottom > pageHeight + HEIGHT_EPSILON
    )
      fail('unsupported-page', 'Coupled footnotes require finite single-column, top-aligned page geometry');
    if (bodyBottom > physicalBottom + HEIGHT_EPSILON) {
      fail('physical-overflow', `Body bottom ${bodyBottom} exceeds physical bottom ${physicalBottom}`);
    }

    const ids: string[] = [];
    const freshIds = new Set<string>();
    const freshBlockOwners = new Map<string, string>();
    const expectedById = new Map<string, readonly FootnoteRange[]>();
    for (const entries of pendingByColumn.values()) {
      for (const entry of entries) expectedById.set(entry.id, entry.ranges);
    }

    for (const { refId: id } of anchors) {
      if (claimedIds.has(id) || freshIds.has(id) || isPreviouslyAnchored?.(id))
        fail('duplicate-claim', `Footnote ${id} has already been anchored`, id);
      const ranges = options.rangesByFootnoteId.get(id);
      const fullHeight = options.fullHeightById.get(id);
      const firstLineHeight = options.firstLineHeightById.get(id);
      if (
        !ranges?.length ||
        typeof fullHeight !== 'number' ||
        !Number.isFinite(fullHeight) ||
        fullHeight < 0 ||
        typeof firstLineHeight !== 'number' ||
        !Number.isFinite(firstLineHeight) ||
        firstLineHeight <= 0
      )
        fail('missing-anchor', `Footnote ${id} is missing measured source content`, id);

      for (const range of ranges) {
        const owner = freshBlockOwners.get(range.blockId) ?? blockOwners.get(range.blockId);
        if (owner !== undefined && owner !== id)
          fail('duplicate-claim', `Source block ${range.blockId} already belongs to footnote ${owner}`, id);
        const measure = options.measuresById.get(range.blockId);
        const expectedKind = range.kind === 'list-item' ? 'list' : range.kind;
        if (!measure || measure.kind !== expectedKind || !Number.isFinite(range.height) || range.height < 0) {
          fail('missing-anchor', `Footnote ${id} has no matching measurement for ${range.blockId}`, id);
        }
        if (
          'fromLine' in range &&
          (!Number.isInteger(range.fromLine) ||
            !Number.isInteger(range.toLine) ||
            range.fromLine < 0 ||
            range.toLine <= range.fromLine ||
            range.toLine > range.totalLines ||
            (measure.kind === 'paragraph' && range.toLine > measure.lines.length))
        )
          fail('missing-anchor', `Footnote ${id} has an invalid measured line range`, id);
        freshBlockOwners.set(range.blockId, id);
      }
      freshIds.add(id);
      ids.push(id);
      expectedById.set(id, ranges);
    }

    const capacity = Math.max(0, physicalBottom - bodyBottom);
    const pagePlan = planFootnotePage({
      ...options,
      pageIndex,
      columnCount: 1,
      availableHeight: capacity,
      idsByColumn: new Map([[0, ids]]),
      pendingByColumn,
    });
    // The diagnostic ledger is rounded and can sum multiple columns. Admission
    // is tied to the actual placed band, with only floating-point tolerance.
    if (!Number.isFinite(pagePlan.actualReserve) || pagePlan.actualReserve > capacity + HEIGHT_EPSILON) {
      fail('physical-overflow', `Footnote band ${pagePlan.actualReserve} exceeds capacity ${capacity}`);
    }

    const placedById = new Map<string, FootnoteRange[]>();
    const outgoingById = new Map<string, FootnoteRange[]>();
    for (const slice of pagePlan.slices) {
      if (!expectedById.has(slice.id)) fail('range-conservation', `Unexpected placed footnote ${slice.id}`, slice.id);
      appendRanges(placedById, slice.id, slice.ranges);
    }
    for (const entries of pagePlan.pendingByColumn.values()) {
      for (const entry of entries) {
        if (!expectedById.has(entry.id))
          fail('range-conservation', `Unexpected outgoing footnote ${entry.id}`, entry.id);
        appendRanges(outgoingById, entry.id, entry.ranges);
      }
    }
    for (const [id, ranges] of expectedById) {
      const actual = [...(placedById.get(id) ?? []), ...(outgoingById.get(id) ?? [])];
      if (!conservesRanges(ranges, actual))
        fail('range-conservation', `Footnote ${id} did not conserve its exact source ranges`, id);
    }
    for (let index = 0; index < ids.length; index += 1) {
      const id = ids[index];
      if (!placedById.get(id)?.length || (index < ids.length - 1 && outgoingById.get(id)?.length)) {
        fail('ordered-minimum', `Footnote ${id} did not satisfy the page's ordered anchor minimum`, id);
      }
    }
    if (ids.length === 0 && incoming.refs > 0 && pagePlan.slices.length === 0) {
      fail('no-progress', 'Continuation-only page cannot consume any pending footnote range');
    }

    const nextIncoming = pendingDemand(pagePlan.pendingByColumn);
    const incomingCertificate = copyPending(pendingByColumn);
    const outgoingCertificate = copyPending(pagePlan.pendingByColumn);

    // No page or sequence state is committed before all admission checks pass.
    (page as Page & { bodyMaxY: number }).bodyMaxY = bodyBottom;
    page.margins = { ...page.margins, bottom: pageHeight - physicalBottom + pagePlan.reserve };
    page.footnoteReserved = pagePlan.reserve;
    plan.reserves[pageIndex] = pagePlan.reserve;
    plan.ledgersByPage.set(pageIndex, pagePlan.ledger);
    plan.incomingByPage.set(pageIndex, incomingCertificate);
    plan.outgoingByPage.set(pageIndex, outgoingCertificate);
    if (pagePlan.slices.length > 0) plan.slicesByPage.set(pageIndex, pagePlan.slices);
    for (const [columnIndex, hasContinuation] of pagePlan.hasContinuationByColumn) {
      plan.hasContinuationByColumn.set(`${pageIndex}:${columnIndex}`, hasContinuation);
    }
    for (const id of freshIds) claimedIds.add(id);
    for (const [blockId, id] of freshBlockOwners) blockOwners.set(blockId, id);
    pendingByColumn = pagePlan.pendingByColumn;
    incoming = nextIncoming;
    nextPageIndex += 1;
  };

  return {
    plan,
    flow: {
      incomingDemand(pageIndex) {
        requireNextPage(pageIndex);
        return { ...incoming };
      },
      completePage,
      hasPendingContinuation: () => incoming.refs > 0,
    },
  };
};
