import { describe, expect, it } from 'vite-plus/test';
import type { Page } from '@superdoc/contracts';
import type { FootnoteRange } from '../src/footnote-content';
import {
  createFootnoteCertificateOwner,
  issueFootnotePageCertificate,
  pendingFootnoteQueuesEqual,
  readFootnotePageCertificate,
  rebaseFootnotePageCertificate,
  transferFootnotePageCertificate,
  type FootnoteCertificateOwner,
  type FootnoteCertificatePreparedOptions,
  type FootnotePageCertificate,
  type FootnotePendingQueue,
} from '../src/footnote-page-certificate';

const preparedOptions = (): FootnoteCertificatePreparedOptions => ({
  pageSize: { w: 600, h: 800 },
  rangesByFootnoteId: new Map(),
  measuresById: new Map(),
  fullHeightById: new Map(),
  firstLineHeightById: new Map(),
  separatorSpacingBefore: 4,
  dividerHeight: 2,
  continuationDividerHeight: 2,
  topPadding: 3,
  gap: 2,
});

const page = (): Page => ({ number: 8, fragments: [], size: { w: 600, h: 800 } });
const range = (overrides: Partial<Extract<FootnoteRange, { kind: 'paragraph' }>> = {}): FootnoteRange => ({
  kind: 'paragraph',
  blockId: 'note-block',
  fromLine: 2,
  toLine: 4,
  totalLines: 5,
  height: 20,
  spacingAfter: 3,
  ...overrides,
});
const queue = (ranges: readonly FootnoteRange[] = [range()], id = 'note', column = 0): FootnotePendingQueue =>
  new Map([[column, [{ id, ranges }]]]);

const issue = (sourcePage: Page, owner = createFootnoteCertificateOwner(preparedOptions())) =>
  issueFootnotePageCertificate(sourcePage, owner, {
    pageIndex: 7,
    incomingByColumn: queue(),
    outgoingByColumn: queue([range({ fromLine: 3, height: 10 })]),
  });

const attachmentKey = (sourcePage: Page, certificate: FootnotePageCertificate): symbol => {
  const symbol = Object.getOwnPropertySymbols(sourcePage).find((key) => Reflect.get(sourcePage, key) === certificate);
  if (!symbol) throw new Error('Missing certificate attachment');
  return symbol;
};

class NoScanMap<K, V> extends Map<K, V> {
  override entries(): MapIterator<[K, V]> {
    throw new Error('Prepared inventories must not be scanned');
  }
  override keys(): MapIterator<K> {
    throw new Error('Prepared inventories must not be scanned');
  }
  override values(): MapIterator<V> {
    throw new Error('Prepared inventories must not be scanned');
  }
  override [Symbol.iterator](): MapIterator<[K, V]> {
    throw new Error('Prepared inventories must not be scanned');
  }
  override forEach(): void {
    throw new Error('Prepared inventories must not be scanned');
  }
}

describe('private footnote page certificates', () => {
  it('retains prepared options by exact owner identity without scanning note inventories', () => {
    const prepared: FootnoteCertificatePreparedOptions = {
      ...preparedOptions(),
      rangesByFootnoteId: new NoScanMap(),
      measuresById: new NoScanMap(),
      fullHeightById: new NoScanMap(),
      firstLineHeightById: new NoScanMap(),
    };

    const owner = createFootnoteCertificateOwner(prepared);

    expect(owner.prepared).toBe(prepared);
    expect(Object.isFrozen(owner)).toBe(true);
  });

  it('reads issued immutable facts from their source page with the exact expected owner', () => {
    const sourcePage = page();
    const owner = createFootnoteCertificateOwner(preparedOptions());
    const certificate = issue(sourcePage, owner);

    const result = readFootnotePageCertificate(sourcePage, owner);

    expect(result).toBe(certificate);
    expect(result?.owner).toBe(owner);
    expect(result?.pageIndex).toBe(7);
    expect(pendingFootnoteQueuesEqual(result!.incomingByColumn, queue())).toBe(true);
    expect(pendingFootnoteQueuesEqual(result!.outgoingByColumn, queue([range({ fromLine: 3, height: 10 })]))).toBe(
      true,
    );
  });

  it('does not treat another issued owner with identical prepared options as the expected owner', () => {
    const prepared = preparedOptions();
    const sourcePage = page();
    const original = createFootnoteCertificateOwner(prepared);
    const other = createFootnoteCertificateOwner(prepared);
    issue(sourcePage, original);

    const result = readFootnotePageCertificate(sourcePage, other);

    expect(result).toBeNull();
  });

  it('allows discovery of an issued owner without treating discovery as cross-owner admission', () => {
    const sourcePage = page();
    const certificate = issue(sourcePage);

    const result = readFootnotePageCertificate(sourcePage);

    expect(result).toBe(certificate);
    expect(result?.owner.prepared).toBe(certificate.owner.prepared);
  });

  it('refuses to issue facts under a structurally forged owner', () => {
    const forged = { prepared: preparedOptions() } as FootnoteCertificateOwner;
    const sourcePage = page();

    expect(() => issue(sourcePage, forged)).toThrow(TypeError);

    expect(readFootnotePageCertificate(sourcePage)).toBeNull();
  });

  it('rejects an owner copied from a legitimate owner rather than issued by the bridge', () => {
    const owner = createFootnoteCertificateOwner(preparedOptions());
    const forged = { ...owner };
    const sourcePage = page();
    issue(sourcePage, owner);

    const result = readFootnotePageCertificate(sourcePage, forged);

    expect(result).toBeNull();
  });

  it('does not let a pagination policy label authorize a page', () => {
    const forged = { ...page(), paginationPolicy: 'coupled-v1' };

    const result = readFootnotePageCertificate(forged);

    expect(result).toBeNull();
  });

  it('rejects a copied certificate object even if attached under the real private symbol', () => {
    const sourcePage = page();
    const certificate = issue(sourcePage);
    const forgedPage = page();
    Reflect.set(forgedPage, attachmentKey(sourcePage, certificate), { ...certificate });

    const result = readFootnotePageCertificate(forgedPage, certificate.owner);

    expect(result).toBeNull();
  });

  it.each([
    ['object spread', (sourcePage: Page) => ({ ...sourcePage })],
    ['object assign', (sourcePage: Page) => Object.assign({}, sourcePage)],
    ['transparent proxy', (sourcePage: Page) => new Proxy(sourcePage, {})],
    ['spread of transparent proxy', (sourcePage: Page) => ({ ...new Proxy(sourcePage, {}) })],
  ])('preserves the same issued certificate through %s', (_name, copy) => {
    const sourcePage = page();
    const certificate = issue(sourcePage);

    const result = readFootnotePageCertificate(copy(sourcePage), certificate.owner);

    expect(result).toBe(certificate);
    expect(result?.pageIndex).toBe(7);
  });

  it.each([
    ['JSON', (sourcePage: Page) => JSON.parse(JSON.stringify(sourcePage)) as Page],
    ['structured clone', (sourcePage: Page) => structuredClone(sourcePage)],
  ])('does not preserve issuance through %s serialization', (_name, copy) => {
    const sourcePage = page();
    const certificate = issue(sourcePage);

    const result = readFootnotePageCertificate(copy(sourcePage), certificate.owner);

    expect(result).toBeNull();
  });

  it('fails closed when a revoked page proxy cannot expose its attachment', () => {
    const sourcePage = page();
    const certificate = issue(sourcePage);
    const { proxy, revoke } = Proxy.revocable(sourcePage, {});
    revoke();

    const result = readFootnotePageCertificate(proxy, certificate.owner);

    expect(result).toBeNull();
  });

  it('copies incoming and outgoing maps, entries, and ranges before freezing their facts', () => {
    const inputRange = range();
    const inputEntry = { id: 'note', ranges: [inputRange] };
    const incoming = new Map([[0, [inputEntry]]]);
    const sourcePage = page();
    const owner = createFootnoteCertificateOwner(preparedOptions());
    const certificate = issueFootnotePageCertificate(sourcePage, owner, {
      pageIndex: 7,
      incomingByColumn: incoming,
      outgoingByColumn: incoming,
    });

    inputRange.height = 999;
    inputEntry.id = 'changed';
    inputEntry.ranges.length = 0;
    incoming.clear();

    expect(pendingFootnoteQueuesEqual(certificate.incomingByColumn, queue())).toBe(true);
    expect(pendingFootnoteQueuesEqual(certificate.outgoingByColumn, queue())).toBe(true);
    expect(certificate.incomingByColumn).not.toBe(certificate.outgoingByColumn);
  });

  it('keeps certificate range records and entry arrays immutable', () => {
    const certificate = issue(page());
    const entries = certificate.incomingByColumn.get(0)!;

    const changed = Reflect.set(entries[0].ranges[0], 'height', 999);

    expect(changed).toBe(false);
    expect(Reflect.set(entries[0], 'id', 'changed')).toBe(false);
    expect(Reflect.set(entries, 'length', 0)).toBe(false);
    expect(Reflect.set(entries[0].ranges, 'length', 0)).toBe(false);
    expect(pendingFootnoteQueuesEqual(certificate.incomingByColumn, queue())).toBe(true);
  });

  it('does not leak a writable map through the forEach callback map argument', () => {
    const certificate = issue(page());
    const incoming = certificate.incomingByColumn;

    expect(() => incoming.forEach((_value, _key, map) => Map.prototype.set.call(map, 0, []))).toThrow(TypeError);

    expect(pendingFootnoteQueuesEqual(incoming, queue())).toBe(true);
  });

  it('does not leak a writable map through valueOf or borrowed Map mutators', () => {
    const incoming = issue(page()).incomingByColumn;

    expect(() => Map.prototype.clear.call(incoming.valueOf())).toThrow(TypeError);

    expect(pendingFootnoteQueuesEqual(incoming, queue())).toBe(true);
  });

  it('issues page-local facts without reading any prepared inventory', () => {
    const owner = createFootnoteCertificateOwner({
      ...preparedOptions(),
      rangesByFootnoteId: new NoScanMap(),
      measuresById: new NoScanMap(),
      fullHeightById: new NoScanMap(),
      firstLineHeightById: new NoScanMap(),
    });

    const certificate = issue(page(), owner);

    expect(certificate.owner).toBe(owner);
    expect(pendingFootnoteQueuesEqual(certificate.incomingByColumn, queue())).toBe(true);
  });
});

describe('same-page footnote certificate transfer', () => {
  it('restores the exact certificate after a string-key materialization drops its private symbol', () => {
    const sourcePage = page();
    const certificate = issue(sourcePage);
    const materializedPage = Object.fromEntries(Object.entries(sourcePage)) as Page;
    const before = readFootnotePageCertificate(materializedPage, certificate.owner);

    const result = transferFootnotePageCertificate(sourcePage, materializedPage, 0);

    expect(before).toBeNull();
    expect(result).toBe(certificate);
    expect(readFootnotePageCertificate(materializedPage, certificate.owner)).toBe(certificate);
    expect(readFootnotePageCertificate({ ...materializedPage }, certificate.owner)).toBe(certificate);
    expect(result?.incomingByColumn).toBe(certificate.incomingByColumn);
    expect(result?.outgoingByColumn).toBe(certificate.outgoingByColumn);
    expect(readFootnotePageCertificate(sourcePage, certificate.owner)).toBe(certificate);
  });

  it('preserves issued facts through transparent source and target page proxies', () => {
    const sourcePage = page();
    const certificate = issue(sourcePage);
    const materializedPage = page();

    const result = transferFootnotePageCertificate(new Proxy(sourcePage, {}), new Proxy(materializedPage, {}), 0);

    expect(result).toBe(certificate);
    expect(readFootnotePageCertificate(materializedPage, certificate.owner)).toBe(certificate);
  });

  it('does not manufacture provenance for a source page without an issued certificate', () => {
    const sourcePage = page();
    const materializedPage = page();

    const result = transferFootnotePageCertificate(sourcePage, materializedPage, 0);

    expect(result).toBeNull();
    expect(readFootnotePageCertificate(materializedPage)).toBeNull();
  });

  it('rejects a forged source certificate attached under the legitimate private symbol', () => {
    const originalPage = page();
    const certificate = issue(originalPage);
    const forgedPage = page();
    Reflect.set(forgedPage, attachmentKey(originalPage, certificate), { ...certificate });
    const materializedPage = page();

    const result = transferFootnotePageCertificate(forgedPage, materializedPage, 0);

    expect(result).toBeNull();
    expect(readFootnotePageCertificate(materializedPage)).toBeNull();
  });

  it.each([-1, 1, Number.NaN])('rejects a nonzero or invalid page-index delta: %s', (pageIndexDelta) => {
    const sourcePage = page();
    issue(sourcePage);
    const materializedPage = { ...page(), number: sourcePage.number + pageIndexDelta };

    const result = transferFootnotePageCertificate(sourcePage, materializedPage, pageIndexDelta);

    expect(result).toBeNull();
    expect(readFootnotePageCertificate(materializedPage)).toBeNull();
  });

  it('rejects a shifted target even when the caller reports a zero page-index delta', () => {
    const sourcePage = page();
    issue(sourcePage);
    const materializedPage = { ...page(), number: sourcePage.number + 1 };

    const result = transferFootnotePageCertificate(sourcePage, materializedPage, 0);

    expect(result).toBeNull();
    expect(readFootnotePageCertificate(materializedPage)).toBeNull();
  });

  it('rejects a source page already shifted away from the certificate issuance index', () => {
    const sourcePage = page();
    issue(sourcePage);
    sourcePage.number += 1;
    const materializedPage = { ...page(), number: sourcePage.number };

    const result = transferFootnotePageCertificate(sourcePage, materializedPage, 0);

    expect(result).toBeNull();
    expect(readFootnotePageCertificate(materializedPage)).toBeNull();
  });

  it.each([-1, Number.POSITIVE_INFINITY])('rejects an invalid issuance page index: %s', (pageIndex) => {
    const sourcePage = { ...page(), number: pageIndex + 1 };
    issueFootnotePageCertificate(sourcePage, createFootnoteCertificateOwner(preparedOptions()), {
      pageIndex,
      incomingByColumn: queue(),
      outgoingByColumn: queue(),
    });
    const materializedPage = { ...page(), number: sourcePage.number };

    const result = transferFootnotePageCertificate(sourcePage, materializedPage, 0);

    expect(result).toBeNull();
    expect(readFootnotePageCertificate(materializedPage)).toBeNull();
  });
});

describe('owner-bound footnote certificate rebase', () => {
  it('reissues exact immutable facts at a proved shifted page index', () => {
    const sourcePage = page();
    const owner = createFootnoteCertificateOwner(preparedOptions());
    const sourceCertificate = issue(sourcePage, owner);
    const targetPage = { ...page(), number: sourcePage.number - 1 };

    const result = rebaseFootnotePageCertificate(sourcePage, targetPage, -1, owner);

    expect(result).not.toBe(sourceCertificate);
    expect(result?.owner).toBe(owner);
    expect(result?.pageIndex).toBe(sourceCertificate.pageIndex - 1);
    expect(pendingFootnoteQueuesEqual(result!.incomingByColumn, sourceCertificate.incomingByColumn)).toBe(true);
    expect(pendingFootnoteQueuesEqual(result!.outgoingByColumn, sourceCertificate.outgoingByColumn)).toBe(true);
    expect(readFootnotePageCertificate(targetPage, owner)).toBe(result);
    expect(readFootnotePageCertificate(sourcePage, owner)).toBe(sourceCertificate);
  });

  it('rejects a caller that did not prove the issuing owner', () => {
    const sourcePage = page();
    const owner = createFootnoteCertificateOwner(preparedOptions());
    const otherOwner = createFootnoteCertificateOwner(preparedOptions());
    issue(sourcePage, owner);
    const targetPage = { ...page(), number: sourcePage.number - 1 };

    const result = rebaseFootnotePageCertificate(sourcePage, targetPage, -1, otherOwner);

    expect(result).toBeNull();
    expect(readFootnotePageCertificate(targetPage)).toBeNull();
  });

  it('rejects a target whose page number does not match the reported shift', () => {
    const sourcePage = page();
    const owner = createFootnoteCertificateOwner(preparedOptions());
    issue(sourcePage, owner);
    const targetPage = { ...page(), number: sourcePage.number };

    const result = rebaseFootnotePageCertificate(sourcePage, targetPage, -1, owner);

    expect(result).toBeNull();
    expect(readFootnotePageCertificate(targetPage)).toBeNull();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0.5])('rejects an invalid page-index delta: %s', (delta) => {
    const sourcePage = page();
    const owner = createFootnoteCertificateOwner(preparedOptions());
    issue(sourcePage, owner);
    const targetPage = { ...page(), number: sourcePage.number };

    const result = rebaseFootnotePageCertificate(sourcePage, targetPage, delta, owner);

    expect(result).toBeNull();
    expect(readFootnotePageCertificate(targetPage)).toBeNull();
  });

  it('rejects a shift before the first page', () => {
    const sourcePage = { ...page(), number: 1 };
    const owner = createFootnoteCertificateOwner(preparedOptions());
    issueFootnotePageCertificate(sourcePage, owner, {
      pageIndex: 0,
      incomingByColumn: queue(),
      outgoingByColumn: queue(),
    });
    const targetPage = { ...page(), number: 0 };

    const result = rebaseFootnotePageCertificate(sourcePage, targetPage, -1, owner);

    expect(result).toBeNull();
    expect(readFootnotePageCertificate(targetPage)).toBeNull();
  });
});

describe('exact continuation queue equality', () => {
  it('accepts separately copied equal queues', () => {
    const first = queue([range()]);
    const second = queue([range()]);

    const equal = pendingFootnoteQueuesEqual(first, second);

    expect(equal).toBe(true);
  });

  it('rejects equal-height continuations of a different line interval', () => {
    const first = queue([range({ fromLine: 0, toLine: 2 })]);
    const second = queue([range({ fromLine: 2, toLine: 4 })]);

    const equal = pendingFootnoteQueuesEqual(first, second);

    expect(equal).toBe(false);
  });

  it.each([
    ['footnote identity', queue([range()], 'other')],
    ['column ownership', queue([range()], 'note', 1)],
    ['source block', queue([range({ blockId: 'other-block' })])],
    ['end line', queue([range({ toLine: 5 })])],
    ['total lines', queue([range({ totalLines: 6 })])],
    ['height below a pixel tolerance', queue([range({ height: 20.00000001 })])],
    ['trailing spacing', queue([range({ spacingAfter: 4 })])],
    ['range count', queue([range(), range()])],
    ['range kind', queue([{ kind: 'table', blockId: 'note-block', height: 20 }])],
  ])('rejects changed %s', (_name, other) => {
    const equal = pendingFootnoteQueuesEqual(queue(), other);

    expect(equal).toBe(false);
  });

  it('rejects a different list item even when its block and line interval match', () => {
    const first: FootnoteRange = {
      kind: 'list-item',
      blockId: 'list',
      itemId: 'first',
      fromLine: 0,
      toLine: 1,
      totalLines: 1,
      height: 10,
      spacingAfter: 0,
    };
    const second: FootnoteRange = { ...first, itemId: 'second' };

    const equal = pendingFootnoteQueuesEqual(queue([first]), queue([second]));

    expect(equal).toBe(false);
  });

  it('preserves queued note order instead of comparing only their inventory', () => {
    const first = { id: 'first', ranges: [range()] };
    const second = { id: 'second', ranges: [range()] };

    const equal = pendingFootnoteQueuesEqual(new Map([[0, [first, second]]]), new Map([[0, [second, first]]]));

    expect(equal).toBe(false);
  });

  it('preserves column iteration order because collapsed-column placement consumes that order', () => {
    const entries = [{ id: 'note', ranges: [range()] }];

    const equal = pendingFootnoteQueuesEqual(
      new Map([
        [0, entries],
        [1, entries],
      ]),
      new Map([
        [1, entries],
        [0, entries],
      ]),
    );

    expect(equal).toBe(false);
  });

  it('does not normalize away an explicitly empty column', () => {
    const equal = pendingFootnoteQueuesEqual(new Map(), new Map([[0, []]]));

    expect(equal).toBe(false);
  });
});
