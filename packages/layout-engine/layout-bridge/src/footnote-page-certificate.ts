import type { Page } from '@superdoc/contracts';
import type { CoupledFootnotePaginationOptions } from './coupled-footnote-pagination';
import type { FootnoteRange } from './footnote-content';

export type FootnoteCertificatePreparedOptions = Readonly<Omit<CoupledFootnotePaginationOptions, 'start'>>;
type PendingEntry = Readonly<{ id: string; ranges: readonly Readonly<FootnoteRange>[] }>;
export type FootnotePendingQueue = ReadonlyMap<number, readonly PendingEntry[]>;

declare const ownerBrand: unique symbol;
declare const certificateBrand: unique symbol;

export type FootnoteCertificateOwner = Readonly<{
  prepared: FootnoteCertificatePreparedOptions;
  [ownerBrand]: true;
}>;

export type FootnotePageCertificateFacts = Readonly<{
  /** Issuance/source index; transporting a certificate does not rebase it. */
  pageIndex: number;
  incomingByColumn: FootnotePendingQueue;
  outgoingByColumn: FootnotePendingQueue;
}>;

export type FootnotePageCertificate = FootnotePageCertificateFacts &
  Readonly<{
    owner: FootnoteCertificateOwner;
    [certificateBrand]: true;
  }>;

const pageCertificate = Symbol('footnote-page-certificate');
const issuedOwners = new WeakSet<object>();
const issuedCertificates = new WeakSet<object>();

const isIssuedOwner = (value: unknown): value is FootnoteCertificateOwner =>
  value !== null && typeof value === 'object' && issuedOwners.has(value);

/** Prepared inputs must remain unchanged for the owner's lifetime; no inventory is copied or scanned here. */
export const createFootnoteCertificateOwner = (
  prepared: FootnoteCertificatePreparedOptions,
): FootnoteCertificateOwner => {
  const owner = Object.freeze({ prepared }) as FootnoteCertificateOwner;
  issuedOwners.add(owner);
  return owner;
};

const readonlyMap = <K, V>(data: Map<K, V>): ReadonlyMap<K, V> => {
  // A bound Map proxy leaks its mutable target through forEach's third argument
  // and Object.prototype.valueOf. This facade never exposes that target.
  const view: ReadonlyMap<K, V> = {
    size: data.size,
    get: (key) => data.get(key),
    has: (key) => data.has(key),
    entries: () => data.entries(),
    keys: () => data.keys(),
    values: () => data.values(),
    [Symbol.iterator]: () => data[Symbol.iterator](),
    forEach: (callback, thisArg) => data.forEach((value, key) => callback.call(thisArg, value, key, view)),
  };
  return Object.freeze(view);
};

const immutableQueueCopy = (source: FootnotePendingQueue): FootnotePendingQueue => {
  const copy = new Map<number, readonly PendingEntry[]>();
  for (const [columnIndex, entries] of source) {
    copy.set(
      columnIndex,
      Object.freeze(
        entries.map((entry) =>
          Object.freeze({
            id: entry.id,
            ranges: Object.freeze(entry.ranges.map((range) => Object.freeze({ ...range }))),
          }),
        ),
      ),
    );
  }
  return readonlyMap(copy);
};

export const issueFootnotePageCertificate = (
  page: Page,
  owner: FootnoteCertificateOwner,
  facts: FootnotePageCertificateFacts,
): FootnotePageCertificate => {
  if (!isIssuedOwner(owner)) throw new TypeError('Footnote certificate owner must be issued by the layout bridge');
  const certificate = Object.freeze({
    owner,
    pageIndex: facts.pageIndex,
    incomingByColumn: immutableQueueCopy(facts.incomingByColumn),
    outgoingByColumn: immutableQueueCopy(facts.outgoingByColumn),
  }) as FootnotePageCertificate;
  // Enumerable symbols survive ordinary page spreads and transparent proxies,
  // while JSON/structuredClone cannot manufacture an issued certificate.
  Object.defineProperty(page, pageCertificate, {
    value: certificate,
    enumerable: true,
    configurable: true,
    writable: false,
  });
  issuedCertificates.add(certificate);
  return certificate;
};

/** Omitting expectedOwner discovers retained inputs only; tail admission must supply its validated owner. */
export const readFootnotePageCertificate = (
  page: Page | null | undefined,
  expectedOwner?: FootnoteCertificateOwner,
): FootnotePageCertificate | null => {
  if (page === null || typeof page !== 'object') return null;
  let candidate: unknown;
  try {
    candidate = Reflect.get(page, pageCertificate);
  } catch {
    return null;
  }
  if (candidate === null || typeof candidate !== 'object' || !issuedCertificates.has(candidate)) return null;
  const certificate = candidate as FootnotePageCertificate;
  if (!isIssuedOwner(certificate.owner)) return null;
  if (expectedOwner !== undefined && (!isIssuedOwner(expectedOwner) || certificate.owner !== expectedOwner))
    return null;
  return certificate;
};

/**
 * Restores note-continuation provenance lost by string-key page cloning.
 * The caller must separately prove body/rekey equivalence; this does not certify body reuse.
 */
export const transferFootnotePageCertificate = (
  source: Page,
  target: Page,
  pageIndexDelta: number,
): FootnotePageCertificate | null => {
  if (pageIndexDelta !== 0) return null;
  const certificate = readFootnotePageCertificate(source);
  if (
    !certificate ||
    !Number.isSafeInteger(certificate.pageIndex) ||
    certificate.pageIndex < 0 ||
    source.number !== certificate.pageIndex + 1 ||
    target.number !== source.number
  )
    return null;
  Object.defineProperty(target, pageCertificate, {
    value: certificate,
    enumerable: true,
    configurable: true,
    writable: false,
  });
  return certificate;
};

/** Reissues exact page-local facts after an owner-proved retained-tail index shift. */
export const rebaseFootnotePageCertificate = (
  source: Page,
  target: Page,
  pageIndexDelta: number,
  expectedOwner: FootnoteCertificateOwner,
): FootnotePageCertificate | null => {
  if (!Number.isSafeInteger(pageIndexDelta) || !isIssuedOwner(expectedOwner)) return null;
  const certificate = readFootnotePageCertificate(source, expectedOwner);
  if (
    !certificate ||
    !Number.isSafeInteger(certificate.pageIndex) ||
    certificate.pageIndex < 0 ||
    source.number !== certificate.pageIndex + 1
  ) {
    return null;
  }
  const targetPageIndex = certificate.pageIndex + pageIndexDelta;
  if (
    !Number.isSafeInteger(targetPageIndex) ||
    targetPageIndex < 0 ||
    target.number !== source.number + pageIndexDelta ||
    target.number !== targetPageIndex + 1
  ) {
    return null;
  }
  return issueFootnotePageCertificate(target, expectedOwner, {
    pageIndex: targetPageIndex,
    incomingByColumn: certificate.incomingByColumn,
    outgoingByColumn: certificate.outgoingByColumn,
  });
};

const rangesEqual = (left: Readonly<FootnoteRange>, right: Readonly<FootnoteRange>): boolean => {
  if (left.kind !== right.kind || left.blockId !== right.blockId || left.height !== right.height) return false;
  if ('fromLine' in left && 'fromLine' in right) {
    if (
      left.fromLine !== right.fromLine ||
      left.toLine !== right.toLine ||
      left.totalLines !== right.totalLines ||
      left.spacingAfter !== right.spacingAfter
    )
      return false;
    if (left.kind === 'list-item' && right.kind === 'list-item' && left.itemId !== right.itemId) return false;
  }
  return true;
};

/** Queue order and every range field are part of the boundary; equal height is not equivalence. */
export const pendingFootnoteQueuesEqual = (left: FootnotePendingQueue, right: FootnotePendingQueue): boolean => {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  const rightColumns = right[Symbol.iterator]();
  for (const [columnIndex, entries] of left) {
    const other = rightColumns.next();
    if (other.done || columnIndex !== other.value[0]) return false;
    const otherEntries = other.value[1];
    if (entries.length !== otherEntries.length) return false;
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
      const entry = entries[entryIndex];
      const otherEntry = otherEntries[entryIndex];
      if (entry.id !== otherEntry.id || entry.ranges.length !== otherEntry.ranges.length) return false;
      for (let rangeIndex = 0; rangeIndex < entry.ranges.length; rangeIndex += 1) {
        if (!rangesEqual(entry.ranges[rangeIndex], otherEntry.ranges[rangeIndex])) return false;
      }
    }
  }
  return rightColumns.next().done === true;
};
