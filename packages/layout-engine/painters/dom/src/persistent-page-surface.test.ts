// Persistent paginated page surface — Unit 1 gates (default persistent page
// geometry plan). One generation-scoped scaffold owns every page root; only
// content descendants are virtualized. These tests pin the plan's required
// painter contract: exact atomic shell publication, in-place hydration and
// dehydration that never touch root identity/order/geometry, delta-bounded
// content-window shifts, fail-before-mutation on missing packets and torn
// generations, rollback fidelity, and zero shell-root DOM operations on
// steady same-generation paints.

import { describe, expect, it, vi } from 'vite-plus/test';
import type {
  FlowBlock,
  Layout,
  Measure,
  ResolvedLayout,
  ResolvedPage,
  TableBlock,
  TableMeasure,
} from '@superdoc/contracts';
import { resolveLayout } from '@superdoc/layout-resolved';
import { createDomPainter } from './index.js';
import { DomPainter } from './renderer.js';
import type { DerivedRunTextPlane } from './derived-run-text-plane.js';
import type { DomPainterPersistentPageInput, DomPainterPersistentScaffold } from './persistent-page-surface.js';

const GAP_PX = 24;

function syntheticPage(pageIndex: number, overrides: Partial<Record<string, unknown>> = {}): ResolvedPage {
  return {
    id: `page-${pageIndex}`,
    index: pageIndex,
    number: pageIndex + 1,
    width: 816,
    height: 1000,
    items: [],
    ...overrides,
  } as unknown as ResolvedPage;
}

function scaffoldFor(
  pages: ReadonlyArray<{ widthPx: number; heightPx: number }>,
  generation: number,
): DomPainterPersistentScaffold {
  let topPx = 0;
  const bands = pages.map((page, pageIndex) => {
    const band = {
      index: pageIndex,
      topPx,
      heightPx: page.heightPx,
      widthPx: page.widthPx,
      pageNumber: pageIndex + 1,
    };
    topPx += page.heightPx + GAP_PX;
    return band;
  });
  const last = bands[bands.length - 1];
  return {
    generation,
    pageCount: bands.length,
    gapPx: GAP_PX,
    totalHeightPx: last ? last.topPx + last.heightPx : 0,
    pages: bands,
  };
}

function uniformScaffold(count: number, generation: number): DomPainterPersistentScaffold {
  return scaffoldFor(
    Array.from({ length: count }, () => ({ widthPx: 816, heightPx: 1000 })),
    generation,
  );
}

function packetsFor(pages: readonly ResolvedPage[]): Map<number, ResolvedPage> {
  return new Map(pages.map((page, pageIndex) => [pageIndex, page]));
}

function persistentInput(
  scaffold: DomPainterPersistentScaffold,
  packets: ReadonlyMap<number, ResolvedPage>,
  desired: readonly number[],
  extra: Partial<DomPainterPersistentPageInput> = {},
): DomPainterPersistentPageInput {
  return {
    scaffold,
    desiredContentPageIndices: desired,
    packetsByPageIndex: packets,
    captureSnapshot: false,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Real-content fixtures resolved through the actual resolve stage so
// hydration renders genuine stamped items (same idiom as persistent-page-reuse).
// ---------------------------------------------------------------------------

const REAL_PAGE = { w: 400, h: 500 } as const;

function paraBlock(id: string, text: string): FlowBlock {
  return {
    kind: 'paragraph',
    id,
    runs: [{ text, fontFamily: 'Arial', fontSize: 12, pmStart: 0, pmEnd: text.length }],
  } as unknown as FlowBlock;
}

function noteMarkerResolved(markerText: string, pageCount = 1): ResolvedLayout {
  const blocks = Array.from({ length: pageCount }, (_, index) => ({
    kind: 'paragraph' as const,
    id: `note-page-${index}`,
    runs: [
      {
        kind: 'text' as const,
        text: markerText,
        fontFamily: 'Arial',
        fontSize: 12,
        pmStart: index,
        pmEnd: index + markerText.length,
        dataAttrs: { 'data-v2-note-ref': 'footnote:note-1' },
      },
    ],
  }));
  const layout: Layout = {
    pageSize: REAL_PAGE,
    pages: blocks.map((block, index) => ({
      number: index + 1,
      fragments: [
        {
          kind: 'para',
          blockId: block.id,
          fromLine: 0,
          toLine: 1,
          x: 20,
          y: 30,
          width: 320,
          pmStart: index,
          pmEnd: index + markerText.length,
        },
      ],
    })),
    layoutEpoch: 7,
  } as unknown as Layout;
  return resolveLayout({
    layout,
    flowMode: 'paginated',
    blocks,
    measures: blocks.map(() => paraMeasure([[0, markerText.length]])),
  });
}

function noteDisplayPlane(generation: number, markerText: string): DerivedRunTextPlane {
  return {
    generation,
    revision: `note:${markerText}`,
    valuesByDataAttribute: new Map([['data-v2-note-ref', new Map([['footnote:note-1', markerText]])]]),
  };
}

function paraMeasure(lineCharRanges: Array<[number, number]>): Measure {
  return {
    kind: 'paragraph',
    lines: lineCharRanges.map(([fromChar, toChar]) => ({
      fromRun: 0,
      fromChar,
      toRun: 0,
      toChar,
      width: 120,
      ascent: 8,
      descent: 2,
      lineHeight: 10,
    })),
    totalHeight: lineCharRanges.length * 10,
  } as unknown as Measure;
}

function realResolved(pageCount: number): ResolvedLayout {
  const texts = Array.from({ length: pageCount }, (_, index) => `Body text for page ${index + 1}`);
  let pmCursor = 0;
  const layout: Layout = {
    pageSize: { w: REAL_PAGE.w, h: REAL_PAGE.h },
    pages: texts.map((text, index) => {
      const pmStart = pmCursor;
      pmCursor += text.length;
      return {
        number: index + 1,
        fragments: [
          {
            kind: 'para',
            blockId: `body-${index}`,
            fromLine: 0,
            toLine: 1,
            x: 20,
            y: 30,
            width: 320,
            pmStart,
            pmEnd: pmCursor,
          },
        ],
      };
    }),
  } as unknown as Layout;
  return resolveLayout({
    layout,
    flowMode: 'paginated',
    blocks: texts.map((text, index) => paraBlock(`body-${index}`, text)),
    measures: texts.map((text) => paraMeasure([[0, text.length]])),
  });
}

function repeatedHeaderTableResolved(interveningText: string, bodyPmShift: number): ResolvedLayout {
  const rowTexts = ['Header', interveningText, 'Body two', 'Body three'];
  const basePositions = [0, 10, 20 + bodyPmShift, 30 + bodyPmShift];
  const rows: TableBlock['rows'] = rowTexts.map((text, rowIndex) => {
    const pmStart = basePositions[rowIndex]!;
    return {
      id: `row-${rowIndex}`,
      cells: [
        {
          id: `cell-${rowIndex}`,
          blocks: [
            {
              kind: 'paragraph',
              id: `paragraph-${rowIndex}`,
              runs: [
                {
                  kind: 'text',
                  text,
                  fontFamily: 'Arial',
                  fontSize: 12,
                  pmStart,
                  pmEnd: pmStart + text.length,
                },
              ],
            },
          ],
        },
      ],
    };
  });
  const block: TableBlock = { kind: 'table', id: 'repeated-header-table', rows, columnWidths: [320] };
  const measure: TableMeasure = {
    kind: 'table',
    columnWidths: [320],
    totalWidth: 320,
    totalHeight: 80,
    rows: rowTexts.map((text) => ({
      height: 20,
      cells: [
        {
          width: 320,
          height: 20,
          gridColumnStart: 0,
          blocks: [paraMeasure([[0, text.length]])],
        },
      ],
    })),
  };
  const layout: Layout = {
    pageSize: REAL_PAGE,
    pages: [
      {
        number: 1,
        fragments: [
          {
            kind: 'table',
            blockId: block.id,
            fromRow: 2,
            toRow: 4,
            repeatHeaderCount: 1,
            x: 20,
            y: 30,
            width: 320,
            height: 60,
            pmStart: 20 + bodyPmShift,
            pmEnd: 40 + bodyPmShift,
          },
        ],
      },
    ],
  };
  return resolveLayout({ layout, flowMode: 'paginated', blocks: [block], measures: [measure] });
}

function realScaffold(resolved: ResolvedLayout, generation: number): DomPainterPersistentScaffold {
  return scaffoldFor(
    resolved.pages.map(() => ({ widthPx: REAL_PAGE.w, heightPx: REAL_PAGE.h })),
    generation,
  );
}

function shellsOf(mount: HTMLElement): HTMLElement[] {
  return Array.from(mount.querySelectorAll<HTMLElement>('.superdoc-page'));
}

function rootAttributeSignature(page: HTMLElement): string {
  return Array.from(page.attributes)
    .filter((attribute) => attribute.name !== 'data-v2-page-content')
    .map((attribute) => `${attribute.name}=${attribute.value}`)
    .sort()
    .join('\n');
}

type PrivatePainterTransaction = {
  readFragmentFailures?(): readonly unknown[];
  readChangedRoots?(): readonly HTMLElement[];
  commit(): void;
  rollback(): void;
};

function beginPrivatePainterTransaction(painter: unknown): PrivatePainterTransaction {
  const begin = (painter as Record<PropertyKey, unknown>)[
    Symbol.for('superdoc.painter-dom.persistent-page-transaction.v1')
  ];
  if (typeof begin !== 'function') throw new Error('missing private painter transaction seam');
  return (begin as () => PrivatePainterTransaction)();
}

function preparePrivatePersistentPages(
  painter: unknown,
  input: DomPainterPersistentPageInput,
  options: {
    mount: HTMLElement;
    signal?: AbortSignal;
    yieldToHost?: (checkpoint: { phase: string; index: number; total: number }) => Promise<void>;
  },
): Promise<{ input: DomPainterPersistentPageInput; discard(): void }> {
  const prepare = (painter as Record<PropertyKey, unknown>)[
    Symbol.for('superdoc.painter-dom.prepare-persistent-pages.v1')
  ];
  if (typeof prepare !== 'function') throw new Error('missing private detached preparation seam');
  return prepare(input, options);
}

function denseRunParagraphResolved(runCount: number): ResolvedLayout {
  const block = {
    kind: 'paragraph',
    id: 'dense-runs',
    runs: Array.from({ length: runCount }, (_, index) => ({
      kind: 'text',
      text: 'x',
      fontFamily: 'Arial',
      fontSize: 12,
      bold: index % 2 === 0,
      pmStart: index,
      pmEnd: index + 1,
      link: { version: 2, href: 'https://example.com', tooltip: `Run ${index}` },
    })),
  } as FlowBlock;
  const measure = paraMeasure([[0, 1]]);
  if (measure.kind !== 'paragraph') throw new Error('expected paragraph measure');
  measure.lines[0].toRun = runCount - 1;
  return resolveLayout({
    layout: {
      pageSize: { w: REAL_PAGE.w, h: REAL_PAGE.h },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: block.id,
              fromLine: 0,
              toLine: 1,
              x: 20,
              y: 30,
              width: 320,
              pmStart: 0,
              pmEnd: runCount,
            },
          ],
        },
      ],
    } as Layout,
    flowMode: 'paginated',
    blocks: [block],
    measures: [measure],
  });
}

function beginDomMutationJournal(root: HTMLElement): PrivatePainterTransaction {
  const observer = new MutationObserver(() => {});
  observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    characterDataOldValue: true,
    attributes: true,
    attributeOldValue: true,
  });
  let settled = false;
  return {
    commit() {
      if (settled) return;
      settled = true;
      observer.takeRecords();
      observer.disconnect();
    },
    rollback() {
      if (settled) return;
      settled = true;
      const records = observer.takeRecords();
      observer.disconnect();
      for (let index = records.length - 1; index >= 0; index -= 1) {
        const record = records[index]!;
        if (record.type === 'characterData') {
          record.target.nodeValue = record.oldValue;
          continue;
        }
        if (record.type === 'attributes') {
          const element = record.target as Element;
          if (!record.attributeName) continue;
          if (record.oldValue == null) {
            element.removeAttributeNS(record.attributeNamespace, record.attributeName);
          } else {
            element.setAttributeNS(record.attributeNamespace, record.attributeName, record.oldValue);
          }
          continue;
        }
        for (const node of Array.from(record.addedNodes)) {
          if (node.parentNode === record.target) record.target.removeChild(node);
        }
        const reference = record.nextSibling?.parentNode === record.target ? record.nextSibling : null;
        for (const node of Array.from(record.removedNodes)) {
          record.target.insertBefore(node, reference);
        }
      }
    },
  };
}

describe('persistent page scaffold publication', () => {
  it('publishes every exact shell atomically with exact count, order, and geometry (1,003 pages)', () => {
    const mount = document.createElement('div');
    const painter = createDomPainter({ layoutMode: 'vertical', pageGap: GAP_PX });
    const pages = Array.from({ length: 1003 }, (_, index) => syntheticPage(index));
    const scaffold = uniformScaffold(1003, 1);

    painter.paintPersistentPages(persistentInput(scaffold, packetsFor(pages), []), mount);

    const work = painter.consumePaintWorkSummary();
    expect(work.persistentPagesCreated).toBe(1003);
    expect(work.persistentPagesRemoved).toBe(0);
    expect(work.contentHydrated).toBe(0);
    expect(work.fragmentsRendered).toBe(0);

    const shells = shellsOf(mount);
    expect(shells).toHaveLength(1003);
    expect(mount.children).toHaveLength(1003);
    for (const [slot, shell] of shells.entries()) {
      expect(shell.dataset.pageIndex).toBe(String(slot));
      expect(shell.dataset.pageNumber).toBe(String(slot + 1));
      expect(shell.style.width).toBe('816px');
      expect(shell.style.height).toBe('1000px');
      expect(shell.dataset.v2PageContent).toBe('shell');
      expect(shell.dataset.layoutEpoch).toBe('1');
      expect(shell.children).toHaveLength(0);
    }
    // No spacer nodes exist: the container gap owns the vertical rhythm.
    expect(mount.querySelector('[data-v2-persistent-page-spacer]')).toBeNull();
    expect(mount.style.gap).toBe(`${GAP_PX}px`);
    expect(painter.getPersistentPageIndices()).toEqual(Array.from({ length: 1003 }, (_, index) => index));
    expect(painter.getHydratedContentPageIndices()).toEqual([]);
  });

  it('renders mixed page sizes and orientations with exact per-shell dimensions', () => {
    const mount = document.createElement('div');
    const painter = createDomPainter({ layoutMode: 'vertical', pageGap: GAP_PX });
    const dims = [
      { widthPx: 816, heightPx: 1056 },
      { widthPx: 1056, heightPx: 816 },
      { widthPx: 612, heightPx: 1008 },
    ];
    const pages = dims.map((dim, index) => syntheticPage(index, { width: dim.widthPx, height: dim.heightPx }));
    const scaffold = scaffoldFor(dims, 3);

    painter.paintPersistentPages(persistentInput(scaffold, packetsFor(pages), []), mount);

    const shells = shellsOf(mount);
    expect(shells.map((shell) => [shell.style.width, shell.style.height])).toEqual([
      ['816px', '1056px'],
      ['1056px', '816px'],
      ['612px', '1008px'],
    ]);
  });

  it('same-generation repeat paints skip all shell work (O(1) scaffold skip)', () => {
    const mount = document.createElement('div');
    const painter = createDomPainter({ layoutMode: 'vertical', pageGap: GAP_PX });
    const pages = Array.from({ length: 4 }, (_, index) => syntheticPage(index));
    const scaffold = uniformScaffold(4, 1);
    const packets = packetsFor(pages);

    painter.paintPersistentPages(persistentInput(scaffold, packets, []), mount);
    painter.consumePaintWorkSummary();
    const before = shellsOf(mount);
    const observer = new MutationObserver(() => {});
    observer.observe(mount, { attributes: true, childList: true, subtree: true });

    painter.paintPersistentPages(persistentInput(scaffold, packets, []), mount);
    const repeat = painter.consumePaintWorkSummary();
    const rootMutations = observer
      .takeRecords()
      .filter(
        (record) =>
          (record.type === 'childList' && record.target === mount) ||
          (record.target as Element).classList?.contains('superdoc-page'),
      );
    observer.disconnect();
    expect(repeat.persistentPagesCreated).toBe(0);
    expect(repeat.persistentPagesUpdated).toBe(0);
    expect(repeat.persistentPagesRemoved).toBe(0);
    expect(rootMutations).toHaveLength(0);

    const after = shellsOf(mount);
    expect(after).toHaveLength(4);
    for (const [slot, shell] of after.entries()) {
      expect(shell).toBe(before[slot]);
    }
  });

  it('a new generation commit reuses common page roots by index and removes shrunk pages', () => {
    const mount = document.createElement('div');
    const painter = createDomPainter({ layoutMode: 'vertical', pageGap: GAP_PX });
    const pagesG1 = Array.from({ length: 4 }, (_, index) => syntheticPage(index));
    painter.paintPersistentPages(persistentInput(uniformScaffold(4, 1), packetsFor(pagesG1), []), mount);
    painter.consumePaintWorkSummary();
    const before = shellsOf(mount);

    // Generation 2: three pages, same geometry, restamped packets.
    const pagesG2 = Array.from({ length: 3 }, (_, index) => syntheticPage(index));
    painter.paintPersistentPages(persistentInput(uniformScaffold(3, 2), packetsFor(pagesG2), []), mount);
    const work = painter.consumePaintWorkSummary();
    expect(work.persistentPagesCreated).toBe(0);
    expect(work.persistentPagesRemoved).toBe(1);

    const after = shellsOf(mount);
    expect(after).toHaveLength(3);
    for (const [slot, shell] of after.entries()) {
      expect(shell).toBe(before[slot]);
      // Locality contract: an unchanged root receives ZERO attribute writes
      // on a generation commit — its epoch stamp names the generation that
      // last touched it. Content operations keep hydrated pages current.
      expect(shell.dataset.layoutEpoch).toBe('1');
    }
    expect(before[3]!.parentElement).toBeNull();
  });

  it('fails closed on a torn scaffold before any DOM mutation', () => {
    const mount = document.createElement('div');
    const painter = createDomPainter({ layoutMode: 'vertical', pageGap: GAP_PX });
    const pages = Array.from({ length: 2 }, (_, index) => syntheticPage(index));
    const scaffold = uniformScaffold(2, 1);
    const torn = { ...scaffold, totalHeightPx: scaffold.totalHeightPx + 100 };

    expect(() => painter.paintPersistentPages(persistentInput(torn, packetsFor(pages), []), mount)).toThrow(
      /totalHeightPx/,
    );
    expect(mount.querySelectorAll('.superdoc-page')).toHaveLength(0);
  });
});

describe('persistent content hydration and dehydration', () => {
  it('hydration renders content into existing roots and preserves every root attribute', () => {
    const mount = document.createElement('div');
    const painter = createDomPainter({ layoutMode: 'vertical', pageGap: GAP_PX });
    const resolved = realResolved(2);
    const scaffold = realScaffold(resolved, resolved.pages[0]!.layoutEpoch ?? 0);
    const packets = packetsFor(resolved.pages);

    painter.paintPersistentPages(persistentInput(scaffold, packets, []), mount);
    painter.consumePaintWorkSummary();
    const before = shellsOf(mount);
    const signaturesBefore = before.map(rootAttributeSignature);
    expect(before.every((shell) => shell.dataset.v2PageContent === 'shell')).toBe(true);

    painter.paintPersistentPages(persistentInput(scaffold, packets, [0, 1]), mount);
    const work = painter.consumePaintWorkSummary();
    expect(work.contentHydrated).toBe(2);
    expect(work.persistentPagesCreated).toBe(0);
    expect(work.fragmentsRendered).toBeGreaterThan(0);

    const after = shellsOf(mount);
    for (const [slot, shell] of after.entries()) {
      expect(shell).toBe(before[slot]);
      expect(rootAttributeSignature(shell)).toBe(signaturesBefore[slot]);
      expect(shell.dataset.v2PageContent).toBe('filled');
      expect(shell.querySelector('.superdoc-fragment, [data-layout-block-ref]')).not.toBeNull();
      expect(shell.textContent).toContain(`Body text for page ${slot + 1}`);
    }
    expect(painter.getHydratedContentPageIndices()).toEqual([0, 1]);
  });

  it('advances retained hydrated page provenance without restamping reused descendants', () => {
    const mount = document.createElement('div');
    const painter = createDomPainter({ layoutMode: 'vertical', pageGap: GAP_PX });
    const resolved = realResolved(1);
    const pageG1 = { ...resolved.pages[0]!, layoutEpoch: 1 };
    const pageG2 = { ...resolved.pages[0]!, layoutEpoch: 2 };

    painter.paintPersistentPages(persistentInput(realScaffold(resolved, 1), packetsFor([pageG1]), [0]), mount);
    painter.consumePaintWorkSummary();
    const pageBefore = shellsOf(mount)[0]!;
    const fragmentBefore = pageBefore.querySelector<HTMLElement>('.superdoc-fragment')!;
    expect(pageBefore.dataset.layoutEpoch).toBe('1');
    expect(fragmentBefore.dataset.layoutEpoch).toBe('1');
    pageBefore.dataset.pageNumber = '99';

    painter.paintPersistentPages(persistentInput(realScaffold(resolved, 2), packetsFor([pageG2]), [0]), mount);
    const work = painter.consumePaintWorkSummary();
    const pageAfter = shellsOf(mount)[0]!;
    const fragmentAfter = pageAfter.querySelector<HTMLElement>('.superdoc-fragment')!;

    expect(pageAfter).toBe(pageBefore);
    expect(fragmentAfter).toBe(fragmentBefore);
    expect(work.contentUntouched).toBe(1);
    expect(work.contentPatched).toBe(0);
    expect(pageAfter.dataset.layoutEpoch).toBe('2');
    expect(pageAfter.dataset.pageNumber).toBe('1');
    expect(fragmentAfter.dataset.layoutEpoch).toBe('1');
  });

  it('remaps repeated headers and table body positions independently without rebuilding the fragment', () => {
    const before = repeatedHeaderTableResolved('Middle', 0);
    const after = repeatedHeaderTableResolved('Middle+', 1);
    const scaffold = realScaffold(before, 0);
    const mount = document.createElement('div');
    const painter = createDomPainter({ layoutMode: 'vertical', pageGap: GAP_PX });

    painter.paintPersistentPages(persistentInput(scaffold, packetsFor(before.pages), [0]), mount);
    painter.consumePaintWorkSummary();
    const fragmentBefore = mount.querySelector<HTMLElement>('.superdoc-table-fragment')!;

    painter.paintPersistentPages(persistentInput(scaffold, packetsFor(after.pages), [0]), mount);
    const work = painter.consumePaintWorkSummary();
    const fragmentAfter = mount.querySelector<HTMLElement>('.superdoc-table-fragment')!;

    expect(fragmentAfter).toBe(fragmentBefore);
    expect(work.contentRemapped).toBe(1);
    expect(work.contentPmDemoted).toBe(0);
    expect(work.contentPatched).toBe(0);
    expect(work.fragmentsRendered).toBe(0);

    const freshMount = document.createElement('div');
    const freshPainter = createDomPainter({ layoutMode: 'vertical', pageGap: GAP_PX });
    freshPainter.paintPersistentPages(persistentInput(scaffold, packetsFor(after.pages), [0]), freshMount);
    expect(mount.innerHTML).toBe(freshMount.innerHTML);
  });

  it('dehydration restores shell-only posture without replacing or resizing the root', () => {
    const mount = document.createElement('div');
    const painter = createDomPainter({ layoutMode: 'vertical', pageGap: GAP_PX });
    const resolved = realResolved(2);
    const scaffold = realScaffold(resolved, resolved.pages[0]!.layoutEpoch ?? 0);
    const packets = packetsFor(resolved.pages);

    painter.paintPersistentPages(persistentInput(scaffold, packets, [0, 1]), mount);
    painter.consumePaintWorkSummary();
    const before = shellsOf(mount);
    const signaturesBefore = before.map(rootAttributeSignature);

    painter.paintPersistentPages(persistentInput(scaffold, packets, [0]), mount);
    const work = painter.consumePaintWorkSummary();
    expect(work.contentDehydrated).toBe(1);
    expect(work.contentUntouched).toBe(1);

    const after = shellsOf(mount);
    expect(after[1]).toBe(before[1]);
    expect(rootAttributeSignature(after[1]!)).toBe(signaturesBefore[1]);
    expect(after[1]!.dataset.v2PageContent).toBe('shell');
    expect(after[1]!.children).toHaveLength(0);
    expect(after[1]!.style.width).toBe(`${REAL_PAGE.w}px`);
    expect(after[1]!.style.height).toBe(`${REAL_PAGE.h}px`);
    expect(painter.getHydratedContentPageIndices()).toEqual([0]);
    // Page 0 stays hydrated and untouched.
    expect(after[0]!.dataset.v2PageContent).toBe('filled');
    expect(after[0]!.textContent).toContain('Body text for page 1');
  });

  it('dehydration removes painter-owned descendants only; host-owned overlays survive', () => {
    const mount = document.createElement('div');
    const painter = createDomPainter({ layoutMode: 'vertical', pageGap: GAP_PX });
    const resolved = realResolved(1);
    const scaffold = realScaffold(resolved, resolved.pages[0]!.layoutEpoch ?? 0);
    const packets = packetsFor(resolved.pages);

    painter.paintPersistentPages(persistentInput(scaffold, packets, [0]), mount);
    const page = shellsOf(mount)[0]!;
    const hostOverlay = document.createElement('div');
    hostOverlay.className = 'sd-host-selection-overlay';
    page.appendChild(hostOverlay);

    painter.paintPersistentPages(persistentInput(scaffold, packets, []), mount);
    expect(page.querySelector('.superdoc-fragment')).toBeNull();
    expect(page.querySelector('.superdoc-page-header')).toBeNull();
    expect(page.querySelector('.superdoc-page-footer')).toBeNull();
    expect(hostOverlay.parentElement).toBe(page);
  });

  it('a content-window shift hydrates and dehydrates only the delta', () => {
    const mount = document.createElement('div');
    const painter = createDomPainter({ layoutMode: 'vertical', pageGap: GAP_PX });
    const resolved = realResolved(4);
    const scaffold = realScaffold(resolved, resolved.pages[0]!.layoutEpoch ?? 0);
    const packets = packetsFor(resolved.pages);

    painter.paintPersistentPages(persistentInput(scaffold, packets, [0, 1]), mount);
    painter.consumePaintWorkSummary();

    painter.paintPersistentPages(persistentInput(scaffold, packets, [1, 2]), mount);
    const work = painter.consumePaintWorkSummary();
    expect(work.contentHydrated).toBe(1);
    expect(work.contentDehydrated).toBe(1);
    expect(work.contentUntouched).toBe(1);
    expect(work.contentPatched).toBe(0);
    expect(work.persistentPagesCreated).toBe(0);
    expect(painter.getHydratedContentPageIndices()).toEqual([1, 2]);
  });

  it('hydrates the complete next window before dehydrating prior pages', () => {
    const mount = document.createElement('div');
    const painter = createDomPainter({ layoutMode: 'vertical', pageGap: GAP_PX });
    const resolved = realResolved(4);
    const scaffold = realScaffold(resolved, resolved.pages[0]!.layoutEpoch ?? 0);
    const packets = packetsFor(resolved.pages);

    painter.paintPersistentPages(persistentInput(scaffold, packets, [0, 1]), mount);
    const observer = new MutationObserver(() => {});
    observer.observe(mount, { childList: true, subtree: true });

    painter.paintPersistentPages(persistentInput(scaffold, packets, [2, 3]), mount);
    const events = observer.takeRecords().map((record) => {
      const target =
        record.target instanceof HTMLElement ? record.target.closest<HTMLElement>('[data-page-index]') : null;
      return {
        pageIndex: target ? Number(target.dataset.pageIndex) : null,
        added: record.addedNodes.length,
        removed: record.removedNodes.length,
      };
    });
    observer.disconnect();

    const enteringMutations = events
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => event.pageIndex != null && event.pageIndex >= 2 && event.added > 0);
    const firstEnteringMutation = enteringMutations.at(0)?.index ?? -1;
    const lastEnteringMutation = enteringMutations.at(-1)?.index ?? -1;
    const firstPriorWindowRemoval = events.findIndex(
      (event) => event.pageIndex != null && event.pageIndex < 2 && event.removed > 0,
    );
    expect(firstEnteringMutation).toBeGreaterThanOrEqual(0);
    expect(lastEnteringMutation).toBeGreaterThanOrEqual(firstEnteringMutation);
    expect(firstPriorWindowRemoval).toBeGreaterThan(lastEnteringMutation);
    expect(painter.getHydratedContentPageIndices()).toEqual([2, 3]);
  });

  it('pinned pages stay hydrated outside the desired window', () => {
    const mount = document.createElement('div');
    const painter = createDomPainter({ layoutMode: 'vertical', pageGap: GAP_PX });
    const resolved = realResolved(4);
    const scaffold = realScaffold(resolved, resolved.pages[0]!.layoutEpoch ?? 0);
    const packets = packetsFor(resolved.pages);

    painter.paintPersistentPages(persistentInput(scaffold, packets, [0], { pinnedContentPageIndices: [3] }), mount);
    expect(painter.getHydratedContentPageIndices()).toEqual([0, 3]);

    painter.paintPersistentPages(persistentInput(scaffold, packets, [1], { pinnedContentPageIndices: [3] }), mount);
    expect(painter.getHydratedContentPageIndices()).toEqual([1, 3]);
  });

  it('a missing packet fails before changing the visible page', () => {
    const mount = document.createElement('div');
    const painter = createDomPainter({ layoutMode: 'vertical', pageGap: GAP_PX });
    const resolved = realResolved(2);
    const scaffold = realScaffold(resolved, resolved.pages[0]!.layoutEpoch ?? 0);
    const packets = packetsFor(resolved.pages);

    painter.paintPersistentPages(persistentInput(scaffold, packets, [0]), mount);
    const htmlBefore = mount.innerHTML;

    const holed = new Map(packets);
    holed.delete(1);
    expect(() => painter.paintPersistentPages(persistentInput(scaffold, holed, [1]), mount)).toThrow(
      /no exact resolved packet for page 1/,
    );
    expect(mount.innerHTML).toBe(htmlBefore);
    expect(painter.getHydratedContentPageIndices()).toEqual([0]);
  });

  it('a stale generation fails before changing shell or content state', () => {
    const mount = document.createElement('div');
    const painter = createDomPainter({ layoutMode: 'vertical', pageGap: GAP_PX });
    const pages = [syntheticPage(0, { layoutEpoch: 7 }), syntheticPage(1, { layoutEpoch: 7 })];
    const scaffold = uniformScaffold(2, 7);
    painter.paintPersistentPages(persistentInput(scaffold, packetsFor(pages), [0]), mount);
    const htmlBefore = mount.innerHTML;

    // A generation-8 scaffold arriving with generation-7 packets is torn the
    // moment a desired page consumes one.
    const staleInput = persistentInput(uniformScaffold(2, 8), packetsFor(pages), [0]);
    expect(() => painter.paintPersistentPages(staleInput, mount)).toThrow(/torn generation/);
    expect(mount.innerHTML).toBe(htmlBefore);
  });

  it('repaints a mounted derived marker when only the display-plane revision changes', () => {
    const painter = createDomPainter({ flowMode: 'paginated' });
    const mount = document.createElement('div');
    const resolved = noteMarkerResolved('8735');
    const scaffold = realScaffold(resolved, 7);
    const packets = packetsFor(resolved.pages);

    painter.paintPersistentPages(persistentInput(scaffold, packets, [0]), mount);
    expect(mount.querySelector('[data-v2-note-ref="footnote:note-1"]')?.textContent).toBe('8735');
    painter.consumePaintWorkSummary();

    painter.paintPersistentPages(
      persistentInput(scaffold, packets, [0], {
        derivedRunTextPlane: noteDisplayPlane(7, '8720'),
      }),
      mount,
    );

    expect(mount.querySelector('[data-v2-note-ref="footnote:note-1"]')?.textContent).toBe('8720');
    const work = painter.consumePaintWorkSummary();
    expect(work.contentPatched).toBe(1);
    expect(work.contentUntouched).toBe(0);
    expect(work.fragmentsRendered).toBe(1);
  });

  it('restores canonical marker text when the display plane is removed and reapplies it on redo', () => {
    const painter = createDomPainter({ flowMode: 'paginated' });
    const mount = document.createElement('div');
    const resolved = noteMarkerResolved('8735');
    const scaffold = realScaffold(resolved, 7);
    const packets = packetsFor(resolved.pages);

    painter.paintPersistentPages(
      persistentInput(scaffold, packets, [0], {
        derivedRunTextPlane: noteDisplayPlane(7, '8720'),
      }),
      mount,
    );
    expect(mount.querySelector('[data-v2-note-ref="footnote:note-1"]')?.textContent).toBe('8720');
    painter.consumePaintWorkSummary();

    painter.paintPersistentPages(persistentInput(scaffold, packets, [0]), mount);

    expect(mount.querySelector('[data-v2-note-ref="footnote:note-1"]')?.textContent).toBe('8735');
    const undoWork = painter.consumePaintWorkSummary();
    expect(undoWork.contentPatched).toBe(1);
    expect(undoWork.contentUntouched).toBe(0);

    painter.paintPersistentPages(
      persistentInput(scaffold, packets, [0], {
        derivedRunTextPlane: noteDisplayPlane(7, '8720'),
      }),
      mount,
    );

    expect(mount.querySelector('[data-v2-note-ref="footnote:note-1"]')?.textContent).toBe('8720');
    const redoWork = painter.consumePaintWorkSummary();
    expect(redoWork.contentPatched).toBe(1);
    expect(redoWork.contentUntouched).toBe(0);
  });

  it('hydrates an offscreen marker from the current display plane', () => {
    const painter = createDomPainter({ flowMode: 'paginated' });
    const mount = document.createElement('div');
    const resolved = noteMarkerResolved('8735', 2);
    const scaffold = realScaffold(resolved, 7);
    const input = persistentInput(scaffold, packetsFor(resolved.pages), [0], {
      derivedRunTextPlane: noteDisplayPlane(7, '8720'),
    });

    painter.paintPersistentPages(input, mount);
    painter.paintPersistentPages({ ...input, desiredContentPageIndices: [1] }, mount);

    const secondPage = mount.querySelector<HTMLElement>('[data-page-index="1"]');
    expect(secondPage?.querySelector('[data-v2-note-ref="footnote:note-1"]')?.textContent).toBe('8720');
  });

  it('rejects a stale display plane before mutating the mounted surface', () => {
    const painter = createDomPainter({ flowMode: 'paginated' });
    const mount = document.createElement('div');
    const resolved = noteMarkerResolved('8735');
    const scaffold = realScaffold(resolved, 7);
    const packets = packetsFor(resolved.pages);
    painter.paintPersistentPages(persistentInput(scaffold, packets, [0]), mount);
    const htmlBefore = mount.innerHTML;

    expect(() =>
      painter.paintPersistentPages(
        persistentInput(scaffold, packets, [0], {
          derivedRunTextPlane: noteDisplayPlane(6, '8720'),
        }),
        mount,
      ),
    ).toThrow(/display plane generation 6 does not match scaffold generation 7/);
    expect(mount.innerHTML).toBe(htmlBefore);
  });
});

describe('persistent surface stability and rollback', () => {
  it('prepares a single dense paragraph cooperatively while retaining the committed DOM', async () => {
    const mount = document.createElement('div');
    const painter = createDomPainter({
      layoutMode: 'vertical',
      pageGap: GAP_PX,
      positionValidation: { enabled: true, policy: 'off' },
    });
    const resolved = denseRunParagraphResolved(256);
    const scaffold = realScaffold(resolved, resolved.pages[0]!.layoutEpoch ?? 0);
    const input = persistentInput(scaffold, packetsFor(resolved.pages), [0]);
    painter.paintPersistentPages({ ...input, desiredContentPageIndices: [] }, mount);
    const htmlBefore = mount.innerHTML;
    const root = mount.firstElementChild;
    let checkpoints = 0;
    const prepared = await preparePrivatePersistentPages(painter, input, {
      mount,
      yieldToHost: async () => {
        checkpoints += 1;
        expect(mount.innerHTML).toBe(htmlBefore);
        expect(mount.firstElementChild).toBe(root);
      },
    });
    expect(checkpoints).toBeGreaterThanOrEqual(256);
    expect(mount.innerHTML).toBe(htmlBefore);
    expect(painter.consumePositionValidationSummary().checked).toBe(0);
    const transaction = beginPrivatePainterTransaction(painter);
    painter.paintPersistentPages(prepared.input, mount);
    transaction.commit();
    prepared.discard();
    const reference = document.createElement('div');
    createDomPainter({ layoutMode: 'vertical', pageGap: GAP_PX }).paintPersistentPages(input, reference);
    expect(mount.innerHTML).toBe(reference.innerHTML);
    expect(mount.firstElementChild).toBe(root);
    expect(painter.consumePositionValidationSummary().checked).toBe(256);
  });

  it.each(['paragraph', 'table'] as const)(
    'retains the renderLine fault boundary during cooperative %s preparation',
    async (kind) => {
      const resolved = kind === 'paragraph' ? denseRunParagraphResolved(64) : repeatedHeaderTableResolved('Middle', 0);
      const input = persistentInput(
        realScaffold(resolved, resolved.pages[0]!.layoutEpoch ?? 0),
        packetsFor(resolved.pages),
        [0],
      );
      const mount = document.createElement('div');
      const painter = createDomPainter({ layoutMode: 'vertical', pageGap: GAP_PX });
      painter.paintPersistentPages({ ...input, desiredContentPageIndices: [] }, mount);
      const before = mount.innerHTML;
      const prototype = DomPainter.prototype as unknown as { renderLine: (...args: unknown[]) => unknown };
      const original = prototype.renderLine;
      let faults = 0;
      const fault = vi.spyOn(prototype, 'renderLine').mockImplementation(function (...args) {
        if (faults++ === 0) throw new Error('controlled line renderer fault');
        return original.apply(this, args);
      });
      try {
        const prepared = await preparePrivatePersistentPages(painter, input, {
          mount,
          yieldToHost: async () => {},
        });
        expect(fault).toHaveBeenCalled();
        expect(mount.innerHTML).toBe(before);
        const transaction = beginPrivatePainterTransaction(painter);
        painter.paintPersistentPages(prepared.input, mount);
        expect(transaction.readFragmentFailures?.().length).toBeGreaterThan(0);
        transaction.commit();
        prepared.discard();
      } finally {
        fault.mockRestore();
      }
    },
  );

  it('discards an aborted detached candidate without consuming link identities or changing last-good pixels', async () => {
    const mount = document.createElement('div');
    const painter = createDomPainter({
      layoutMode: 'vertical',
      pageGap: GAP_PX,
      positionValidation: { enabled: true, policy: 'off' },
    });
    const resolved = denseRunParagraphResolved(64);
    const scaffold = realScaffold(resolved, resolved.pages[0]!.layoutEpoch ?? 0);
    const input = persistentInput(scaffold, packetsFor(resolved.pages), [0]);
    painter.paintPersistentPages({ ...input, desiredContentPageIndices: [] }, mount);
    const htmlBefore = mount.innerHTML;
    const abort = new AbortController();
    let checkpoints = 0;
    await expect(
      preparePrivatePersistentPages(painter, input, {
        mount,
        signal: abort.signal,
        yieldToHost: async () => {
          if (++checkpoints === 8) abort.abort();
        },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(mount.innerHTML).toBe(htmlBefore);
    expect(painter.getHydratedContentPageIndices()).toEqual([]);
    expect(painter.consumePositionValidationSummary().checked).toBe(0);
    painter.paintPersistentPages(input, mount);
    const reference = document.createElement('div');
    createDomPainter({ layoutMode: 'vertical', pageGap: GAP_PX }).paintPersistentPages(input, reference);
    expect(mount.innerHTML).toBe(reference.innerHTML);
    expect(painter.consumePositionValidationSummary().checked).toBe(64);
  });

  it('prepares table row and cell work through the canonical painter with exact synchronous parity', async () => {
    const resolved = repeatedHeaderTableResolved('Middle', 0);
    const input = persistentInput(
      realScaffold(resolved, resolved.pages[0]!.layoutEpoch ?? 0),
      packetsFor(resolved.pages),
      [0],
    );
    const painter = createDomPainter({ layoutMode: 'vertical', pageGap: GAP_PX });
    const mount = document.createElement('div');
    painter.paintPersistentPages({ ...input, desiredContentPageIndices: [] }, mount);
    const before = mount.innerHTML;
    let checkpoints = 0;
    const prepared = await preparePrivatePersistentPages(painter, input, {
      mount,
      yieldToHost: async () => {
        checkpoints++;
        expect(mount.innerHTML).toBe(before);
      },
    });
    expect(checkpoints).toBeGreaterThanOrEqual(12);
    painter.paintPersistentPages(prepared.input, mount);
    prepared.discard();
    const reference = document.createElement('div');
    createDomPainter({ layoutMode: 'vertical', pageGap: GAP_PX }).paintPersistentPages(input, reference);
    expect(mount.innerHTML).toBe(reference.innerHTML);
  });

  it('preserves header link order across pages and avoids rebuilding unchanged fragment work', async () => {
    const resolved = realResolved(2);
    const header = denseRunParagraphResolved(32).pages[0]!;
    const provider = () => ({
      fragments: header.items.flatMap((item) => (item.kind === 'fragment' ? [item.fragment] : [])),
      items: header.items,
      height: 20,
      offset: 0,
    });
    const options = { layoutMode: 'vertical' as const, pageGap: GAP_PX, headerProvider: provider };
    const input = persistentInput(
      realScaffold(resolved, resolved.pages[0]!.layoutEpoch ?? 0),
      packetsFor(resolved.pages),
      [0, 1],
    );
    const painter = createDomPainter(options);
    const mount = document.createElement('div');
    painter.paintPersistentPages({ ...input, desiredContentPageIndices: [] }, mount);
    const prepared = await preparePrivatePersistentPages(painter, input, { mount, yieldToHost: async () => {} });
    painter.paintPersistentPages(prepared.input, mount);
    prepared.discard();
    const reference = document.createElement('div');
    createDomPainter(options).paintPersistentPages(input, reference);
    expect(mount.innerHTML).toBe(reference.innerHTML);
    const fragments = [...mount.querySelectorAll('.superdoc-fragment')];
    let checkpoints = 0;
    const steady = await preparePrivatePersistentPages(painter, input, {
      mount,
      yieldToHost: async () => {
        checkpoints++;
      },
    });
    expect(checkpoints).toBeLessThan(10);
    painter.paintPersistentPages(steady.input, mount);
    steady.discard();
    expect([...mount.querySelectorAll('.superdoc-fragment')]).toEqual(fragments);
    expect(mount.innerHTML).toBe(reference.innerHTML);
  });

  it('rejects a detached candidate after another paint before changing connected DOM', async () => {
    const resolved = denseRunParagraphResolved(16);
    const input = persistentInput(
      realScaffold(resolved, resolved.pages[0]!.layoutEpoch ?? 0),
      packetsFor(resolved.pages),
      [0],
    );
    const painter = createDomPainter({ layoutMode: 'vertical', pageGap: GAP_PX });
    const mount = document.createElement('div');
    painter.paintPersistentPages({ ...input, desiredContentPageIndices: [] }, mount);
    const prepared = await preparePrivatePersistentPages(painter, input, { mount });
    painter.paintPersistentPages(input, mount);
    const before = mount.innerHTML;
    expect(() => painter.paintPersistentPages(prepared.input, mount)).toThrow(/candidate is stale/);
    expect(mount.innerHTML).toBe(before);
    prepared.discard();
  });

  it.each([20, 200])('bounds issued progressive shell work with %s retained pages and restores rollback', (count) => {
    const mount = document.createElement('div');
    const painter = createDomPainter({ layoutMode: 'vertical', pageGap: GAP_PX });
    const previous = uniformScaffold(count, 1);
    painter.paintPersistentPages(persistentInput(previous, new Map(), []), mount);
    const shellsBefore = shellsOf(mount);
    const htmlBefore = mount.innerHTML;
    let bandReads = 0;
    const next = uniformScaffold(count, 2);
    const bands = next.pages.map((band, index) =>
      index === 2
        ? { ...band, heightPx: 900 }
        : index > 2
          ? { ...band, topPx: band.topPx - 100 }
          : previous.pages[index]!,
    );
    next.totalHeightPx -= 100;
    next.pages = new Proxy(bands, {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) bandReads++;
        return Reflect.get(target, key, receiver);
      },
    });
    Object.defineProperty(next, Symbol.for('superdoc.painter-dom.scaffold-interval.v1'), {
      value: Object.freeze({ previous, startPageIndex: 2, endPageIndexExclusive: 3, pendingGeometryFromPageIndex: 3 }),
    });
    const transaction = beginPrivatePainterTransaction(painter);
    const journal = beginDomMutationJournal(mount);
    painter.paintPersistentPages(persistentInput(next, new Map(), []), mount);
    expect(bandReads).toBeLessThanOrEqual(4);
    expect(shellsOf(mount)).toEqual(shellsBefore);
    expect(mount.dataset.v2PendingGeometryFromPageIndex).toBe('3');
    expect(shellsBefore[3]!.dataset.layoutEpoch).toBe('1');
    expect(shellsBefore[2]!.style.height).toBe('900px');
    transaction.rollback();
    journal.rollback();
    expect(mount.innerHTML).toBe(htmlBefore);
    expect(mount.dataset.v2PendingGeometryFromPageIndex).toBeUndefined();
    bandReads = 0;
    painter.paintPersistentPages(persistentInput(next, new Map(), []), mount);
    expect(bandReads).toBeLessThanOrEqual(4);
    expect(shellsOf(mount)).toEqual(shellsBefore);
  });

  it('rejects the interval shortcut after foreign DOM corruption and heals canonical order', () => {
    const mount = document.createElement('div');
    const painter = createDomPainter({ layoutMode: 'vertical', pageGap: GAP_PX });
    const previous = uniformScaffold(20, 1);
    painter.paintPersistentPages(persistentInput(previous, new Map(), []), mount);
    const old = shellsOf(mount);
    old[10]!.replaceWith(document.createElement('aside'));
    let reads = 0;
    const next = uniformScaffold(20, 2);
    next.pages = new Proxy(next.pages, {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
        return Reflect.get(target, key, receiver);
      },
    });
    Object.defineProperty(next, Symbol.for('superdoc.painter-dom.scaffold-interval.v1'), {
      value: Object.freeze({ previous, startPageIndex: 2, endPageIndexExclusive: 3 }),
    });
    painter.paintPersistentPages(persistentInput(next, new Map(), []), mount);
    expect(reads).toBeGreaterThanOrEqual(20);
    expect(shellsOf(mount)).toHaveLength(20);
    expect(shellsOf(mount)[10]).not.toBe(old[10]);
    expect(shellsOf(mount)[9]).toBe(old[9]);
    expect(mount.querySelector('aside')).toBeNull();
    expect(painter.isPersistentPageSurfaceIntact()).toBe(true);
  });

  it('does not traverse document-sized registries for a rollbackable viewport shift', () => {
    const mount = document.createElement('div');
    const painter = createDomPainter({ layoutMode: 'vertical', pageGap: GAP_PX });
    const resolved = realResolved(3);
    const pageCount = 200;
    const scaffold = scaffoldFor(
      Array.from({ length: pageCount }, () => ({ widthPx: REAL_PAGE.w, heightPx: REAL_PAGE.h })),
      resolved.pages[0]!.layoutEpoch ?? 0,
    );
    const packets = packetsFor(resolved.pages);
    painter.paintPersistentPages(persistentInput(scaffold, packets, [0]), mount);
    const htmlBefore = mount.innerHTML;
    const shellsBefore = shellsOf(mount);
    let documentRegistryVisits = 0;
    const mapIterator = Map.prototype[Symbol.iterator];
    const arrayIterator = Array.prototype[Symbol.iterator];
    const arrayFrom = Array.from;
    Map.prototype[Symbol.iterator] = function* (this: Map<unknown, unknown>) {
      for (const entry of mapIterator.call(this)) {
        if (this.size === pageCount) documentRegistryVisits += 1;
        yield entry;
      }
    } as typeof mapIterator;
    Array.prototype[Symbol.iterator] = function* (this: unknown[]) {
      for (const value of arrayIterator.call(this)) {
        if (this.length === pageCount && this[0] === 0 && this[pageCount - 1] === pageCount - 1) {
          documentRegistryVisits += 1;
        }
        yield value;
      }
    } as typeof arrayIterator;
    Array.from = ((...args: Parameters<typeof Array.from>) => {
      const source = args[0] as { length?: number; [Symbol.iterator]?: unknown };
      if (source.length === pageCount && source[Symbol.iterator] == null) {
        documentRegistryVisits += pageCount;
      }
      return Reflect.apply(arrayFrom, Array, args);
    }) as typeof Array.from;
    try {
      const transaction = beginPrivatePainterTransaction(painter);
      const domJournal = beginDomMutationJournal(mount);
      painter.paintPersistentPages(persistentInput(scaffold, packets, [1, 2]), mount);
      transaction.rollback();
      domJournal.rollback();
    } finally {
      Array.from = arrayFrom;
      Array.prototype[Symbol.iterator] = arrayIterator;
      Map.prototype[Symbol.iterator] = mapIterator;
    }
    expect(documentRegistryVisits).toBe(0);
    expect(mount.innerHTML).toBe(htmlBefore);
    expect(shellsOf(mount)).toEqual(shellsBefore);
    expect(painter.getHydratedContentPageIndices()).toEqual([0]);
    painter.paintPersistentPages(persistentInput(scaffold, packets, [1, 2]), mount);
    expect(painter.getHydratedContentPageIndices()).toEqual([1, 2]);
    expect(painter.getPersistentPageIndices()).toEqual(Array.from({ length: pageCount }, (_, index) => index));
  });

  it('restores shell keys and page-index ranges after a scaffold replacement rolls back', () => {
    const mount = document.createElement('div');
    const painter = createDomPainter({ layoutMode: 'vertical', pageGap: GAP_PX });
    const scaffold = uniformScaffold(3, 1);
    const packets = packetsFor([syntheticPage(0), syntheticPage(1), syntheticPage(2)]);
    painter.paintPersistentPages(persistentInput(scaffold, packets, [1]), mount);
    const htmlBefore = mount.innerHTML;
    const shellsBefore = shellsOf(mount);

    for (const pageCount of [2, 5]) {
      const transaction = beginPrivatePainterTransaction(painter);
      const domJournal = beginDomMutationJournal(mount);
      const changedScaffold = scaffoldFor(
        Array.from({ length: pageCount }, () => ({ widthPx: 700, heightPx: 800 })),
        2,
      );
      painter.paintPersistentPages(persistentInput(changedScaffold, new Map(), []), mount);
      transaction.rollback();
      domJournal.rollback();
      expect(mount.innerHTML).toBe(htmlBefore);
      expect(shellsOf(mount)).toEqual(shellsBefore);
      expect(painter.getPersistentPageIndices()).toEqual([0, 1, 2]);
      expect(painter.getHydratedContentPageIndices()).toEqual([1]);
      painter.paintPersistentPages(persistentInput(scaffold, packets, [1]), mount);
      expect(mount.innerHTML).toBe(htmlBefore);
    }
  });

  it('wakes the registered repair owner when a live shell is replaced', async () => {
    const mount = document.createElement('div');
    const painter = createDomPainter({ layoutMode: 'vertical', pageGap: GAP_PX });
    const scaffold = uniformScaffold(3, 1);
    const packets = packetsFor([syntheticPage(0), syntheticPage(1), syntheticPage(2)]);
    let invalidations = 0;

    painter.paintPersistentPages(persistentInput(scaffold, packets, []), mount);
    painter.setPersistentSurfaceInvalidationHandler(() => {
      invalidations += 1;
    });
    mount.children[1]!.replaceWith(document.createElement('div'));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(invalidations).toBe(1);
    expect(painter.isPersistentPageSurfaceIntact()).toBe(false);
  });

  it('steady same-window paints perform zero shell-root DOM operations', () => {
    const mount = document.createElement('div');
    const painter = createDomPainter({ layoutMode: 'vertical', pageGap: GAP_PX });
    const resolved = realResolved(4);
    const scaffold = realScaffold(resolved, resolved.pages[0]!.layoutEpoch ?? 0);
    const packets = packetsFor(resolved.pages);

    painter.paintPersistentPages(persistentInput(scaffold, packets, [0, 1]), mount);
    painter.consumePaintWorkSummary();

    // Observe the mount's own child list only: content shifts must mutate
    // page descendants, never the page-root list.
    const observer = new MutationObserver(() => {});
    observer.observe(mount, { childList: true });

    painter.paintPersistentPages(persistentInput(scaffold, packets, [0, 1]), mount);
    const steady = painter.consumePaintWorkSummary();
    expect(steady.contentUntouched).toBe(2);
    expect(steady.contentHydrated).toBe(0);
    expect(steady.contentDehydrated).toBe(0);

    painter.paintPersistentPages(persistentInput(scaffold, packets, [2, 3]), mount);
    const rootMutations = observer.takeRecords();
    observer.disconnect();
    expect(rootMutations).toHaveLength(0);
  });

  it('self-heals a same-count external shell replacement before reconciling content', () => {
    const mount = document.createElement('div');
    const painter = createDomPainter({ layoutMode: 'vertical', pageGap: GAP_PX });
    const pages = [syntheticPage(0), syntheticPage(1), syntheticPage(2)];
    const scaffold = uniformScaffold(3, 1);
    const packets = packetsFor(pages);

    painter.paintPersistentPages(persistentInput(scaffold, packets, []), mount);
    const originalShells = shellsOf(mount);
    const replacement = document.createElement('div');
    replacement.dataset.externalReplacement = 'true';
    originalShells[1]!.replaceWith(replacement);
    const repairObserver = new MutationObserver(() => {});
    repairObserver.observe(mount, { childList: true });

    painter.paintPersistentPages(persistentInput(scaffold, packets, [1]), mount);
    const repairRecords = repairObserver.takeRecords();
    repairObserver.disconnect();

    const healedShells = shellsOf(mount);
    expect(mount.children).toHaveLength(3);
    expect(healedShells).toHaveLength(3);
    expect(replacement.isConnected).toBe(false);
    expect(healedShells[0]).toBe(originalShells[0]);
    expect(healedShells[2]).toBe(originalShells[2]);
    expect(healedShells[1]).not.toBe(originalShells[1]);
    expect(healedShells[1]?.dataset.pageIndex).toBe('1');
    expect(painter.getHydratedContentPageIndices()).toEqual([1]);
    expect(repairRecords).toHaveLength(2);
    expect(repairRecords.flatMap((record) => Array.from(record.removedNodes))).toEqual([replacement]);
    expect(repairRecords.flatMap((record) => Array.from(record.addedNodes))).toEqual([healedShells[1]]);
  });

  it('rollback after a post-mutation callback failure restores the exact prior DOM and retained state', () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    try {
      let failSnapshotCommit = false;
      const handle = createDomPainter({
        layoutMode: 'vertical',
        pageGap: GAP_PX,
        onPaintSnapshot: () => {
          if (failSnapshotCommit) throw new Error('injected post-mutation snapshot failure');
        },
      });
      const resolved = realResolved(2);
      const scaffold = realScaffold(resolved, resolved.pages[0]!.layoutEpoch ?? 0);
      const packets = packetsFor(resolved.pages);

      handle.paintPersistentPages(persistentInput(scaffold, packets, []), mount);
      const htmlBefore = mount.innerHTML;
      const shellsBefore = shellsOf(mount);

      const painterTransaction = beginPrivatePainterTransaction(handle);
      const domJournal = beginDomMutationJournal(mount);
      failSnapshotCommit = true;
      handle.paintPersistentPages(persistentInput(scaffold, packets, [0, 1], { captureSnapshot: true }), mount);
      expect(shellsOf(mount)[0]?.dataset.v2PageContent).toBe('filled');
      expect(handle.getHydratedContentPageIndices()).toEqual([0, 1]);
      expect(painterTransaction.readChangedRoots?.()).toEqual(shellsBefore);
      expect(() => painterTransaction.commit()).toThrow(/injected post-mutation snapshot failure/);
      domJournal.rollback();
      failSnapshotCommit = false;

      expect(mount.innerHTML).toBe(htmlBefore);
      const shellsAfter = shellsOf(mount);
      for (const [slot, shell] of shellsAfter.entries()) {
        expect(shell).toBe(shellsBefore[slot]);
      }
      expect(handle.getHydratedContentPageIndices()).toEqual([]);

      // The surviving retained state still serves the next paint normally.
      handle.paintPersistentPages(persistentInput(scaffold, packets, [0, 1]), mount);
      expect(handle.getHydratedContentPageIndices()).toEqual([0, 1]);
      expect(shellsOf(mount)[0]).toBe(shellsBefore[0]);
    } finally {
      mount.remove();
    }
  });

  it('rejects semantic flow before any state mutation', () => {
    const mount = document.createElement('div');
    const painter = createDomPainter({ layoutMode: 'vertical', flowMode: 'semantic' });
    const pages = [syntheticPage(0)];
    expect(() =>
      painter.paintPersistentPages(persistentInput(uniformScaffold(1, 1), packetsFor(pages), []), mount),
    ).toThrow(/semantic flow/);
  });
});
