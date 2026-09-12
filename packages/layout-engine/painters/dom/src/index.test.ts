import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createDomPainter, sanitizeUrl, linkMetrics, applyRunDataAttributes } from './index.js';
import { DomPainter } from './renderer.js';
import { underlineOffsetFromLineTop } from './runs/tab-run.js';
import { resolveLayout } from '@superdoc/layout-resolved';
import type { DomPainterOptions, DomPainterInput, PaintSnapshot } from './index.js';
import { resolveListMarkerGeometry } from '../../../../../shared/common/list-marker-utils.js';
import type {
  FlowBlock,
  ImageHyperlink,
  Measure,
  Layout,
  Line,
  ParagraphMeasure,
  FlowRunLink,
  Fragment,
  ResolvedLayout,
  TableBlock,
  TableMeasure,
  TextRun,
  TrackedChangeMeta,
  TrackedChangesMode,
} from '@superdoc/contracts';
import { OOXML_Z_INDEX_BASE } from '@superdoc/contracts';

const emptyResolved: ResolvedLayout = { version: 1, flowMode: 'paginated', pageGap: 0, pages: [] };

/**
 * Test-only bridge: accepts old-style `{ blocks, measures, ...options }` and
 * returns a painter whose `paint()` automatically builds a `DomPainterInput`.
 * This lets existing tests exercise the new DomPainter code path without
 * rewriting every call site.
 */
function createTestPainter(opts: { blocks?: FlowBlock[]; measures?: Measure[] } & DomPainterOptions) {
  const { blocks: initBlocks, measures: initMeasures, headerProvider, footerProvider, ...painterOpts } = opts;
  let lastPaintSnapshot: PaintSnapshot | null = null;

  let currentBlocks: FlowBlock[] = initBlocks ?? [];
  let currentMeasures: Measure[] = initMeasures ?? [];
  let currentResolved: ResolvedLayout = emptyResolved;
  let headerBlocks: FlowBlock[] | undefined;
  let headerMeasures: Measure[] | undefined;
  let footerBlocks: FlowBlock[] | undefined;
  let footerMeasures: Measure[] | undefined;
  let resolvedLayoutOverridden = false;

  /**
   * Resolve decoration items from the currently-registered decoration blocks/measures
   * (plus body blocks, which historically also carry decoration block ids in tests).
   * This lets tests keep using providers that return `{ fragments, height }` without items:
   * the wrapper synthesizes `items` by running the fragments through `resolveLayout`.
   */
  const resolveDecorationItems = (
    fragments: readonly import('@superdoc/contracts').Fragment[],
    kind: 'header' | 'footer',
  ): import('@superdoc/contracts').ResolvedPaintItem[] | undefined => {
    const decorationBlocks = kind === 'header' ? headerBlocks : footerBlocks;
    const decorationMeasures = kind === 'header' ? headerMeasures : footerMeasures;
    const mergedBlocks = [...(currentBlocks ?? []), ...(decorationBlocks ?? [])];
    const mergedMeasures = [...(currentMeasures ?? []), ...(decorationMeasures ?? [])];
    if (mergedBlocks.length !== mergedMeasures.length || mergedBlocks.length === 0) {
      return undefined;
    }
    const fakeLayout: Layout = { pageSize: { w: 400, h: 500 }, pages: [{ number: 1, fragments: [...fragments] }] };
    try {
      const resolved = resolveLayout({
        layout: fakeLayout,
        flowMode: opts.flowMode ?? 'paginated',
        blocks: mergedBlocks,
        measures: mergedMeasures,
      });
      return resolved.pages[0]?.items;
    } catch {
      return undefined;
    }
  };

  const wrapProvider = (
    provider: import('./renderer.js').PageDecorationProvider | undefined,
    kind: 'header' | 'footer',
  ): import('./renderer.js').PageDecorationProvider | undefined => {
    if (!provider) return undefined;
    return (pageNumber, pageMargins, page) => {
      const payload = provider(pageNumber, pageMargins, page);
      if (!payload) return payload;
      if (payload.items) return payload;
      const items = resolveDecorationItems(payload.fragments, kind);
      return items ? { ...payload, items } : payload;
    };
  };

  const painter = createDomPainter({
    ...painterOpts,
    headerProvider: wrapProvider(headerProvider, 'header'),
    footerProvider: wrapProvider(footerProvider, 'footer'),
    onPaintSnapshot: (snapshot) => {
      lastPaintSnapshot = snapshot;
    },
  });

  return {
    paint(layout: Layout, mount: HTMLElement, mapping?: unknown) {
      const effectiveResolved = resolvedLayoutOverridden
        ? currentResolved
        : resolveLayout({
            layout,
            flowMode: opts.flowMode ?? 'paginated',
            blocks: currentBlocks,
            measures: currentMeasures,
          });
      const input: DomPainterInput = {
        resolvedLayout: effectiveResolved,
      };
      painter.paint(input, mount, mapping as any);
    },
    setData(
      blocks: FlowBlock[],
      measures: Measure[],
      hb?: FlowBlock[],
      hm?: Measure[],
      fb?: FlowBlock[],
      fm?: Measure[],
    ) {
      currentBlocks = blocks;
      currentMeasures = measures;
      headerBlocks = hb;
      headerMeasures = hm;
      footerBlocks = fb;
      footerMeasures = fm;
    },
    setResolvedLayout(rl: ResolvedLayout | null) {
      currentResolved = rl ?? emptyResolved;
      resolvedLayoutOverridden = true;
    },
    setProviders: painter.setProviders,
    setVirtualizationPins: painter.setVirtualizationPins,
    getPaintSnapshot() {
      return lastPaintSnapshot;
    },
    onScroll: painter.onScroll,
    setZoom: painter.setZoom,
    setScrollContainer: painter.setScrollContainer,
  };
}

const block: FlowBlock = {
  kind: 'paragraph',
  id: 'block-1',
  runs: [
    { text: 'Hello ', fontFamily: 'Arial', fontSize: 16, pmStart: 1, pmEnd: 7 },
    { text: 'world', fontFamily: 'Arial', fontSize: 16, bold: true, pmStart: 7, pmEnd: 12 },
  ],
};

const measure: Measure = {
  kind: 'paragraph',
  lines: [
    {
      fromRun: 0,
      fromChar: 0,
      toRun: 1,
      toChar: 5,
      width: 120,
      ascent: 12,
      descent: 4,
      lineHeight: 20,
    },
  ],
  totalHeight: 20,
};

const layout: Layout = {
  pageSize: { w: 400, h: 500 },
  pages: [
    {
      number: 1,
      fragments: [
        {
          kind: 'para',
          blockId: 'block-1',
          fromLine: 0,
          toLine: 1,
          x: 30,
          y: 40,
          width: 300,
          pmStart: 1,
          pmEnd: 12,
        },
      ],
    },
  ],
};

const buildSingleParagraphData = (blockId: string, runLength: number) => {
  const paragraphMeasure: ParagraphMeasure = {
    kind: 'paragraph',
    lines: [
      {
        fromRun: 0,
        fromChar: 0,
        toRun: 0,
        toChar: runLength,
        width: 160,
        ascent: 12,
        descent: 4,
        lineHeight: 20,
      },
    ],
    totalHeight: 20,
  };

  const paragraphLayout: Layout = {
    pageSize: layout.pageSize,
    pages: [
      {
        number: 1,
        fragments: [
          {
            kind: 'para',
            blockId,
            fromLine: 0,
            toLine: 1,
            x: 24,
            y: 24,
            width: 260,
          },
        ],
      },
    ],
  };

  return { paragraphMeasure, paragraphLayout };
};

const createOverlapTrackedBlock = (mode: TrackedChangesMode): FlowBlock => {
  const parentInsert: TrackedChangeMeta = {
    kind: 'insert',
    id: 'ins-parent',
    relationship: 'parent',
    author: 'Author 1',
  };
  const childDelete: TrackedChangeMeta = {
    kind: 'delete',
    id: 'del-child',
    relationship: 'child',
    overlapParentId: parentInsert.id,
    author: 'Reviewer 2',
  };
  const run: TextRun = {
    text: 'Overlapped text',
    fontFamily: 'Arial',
    fontSize: 16,
    trackedChange: parentInsert,
    trackedChanges: [parentInsert, childDelete],
  };

  return {
    kind: 'paragraph',
    id: `overlap-block-${mode}`,
    runs: [run],
    attrs: {
      trackedChangesMode: mode,
      trackedChangesEnabled: true,
    },
  };
};

const createResolvedTestLine = (textLength: number, overrides: Partial<Line> = {}): Line => ({
  fromRun: 0,
  fromChar: 0,
  toRun: 0,
  toChar: textLength,
  width: 160,
  ascent: 12,
  descent: 4,
  lineHeight: 20,
  ...overrides,
});

const withFallbackFragment = (
  item: ResolvedLayout['pages'][number]['items'][number],
): ResolvedLayout['pages'][number]['items'][number] => {
  if (item.kind !== 'fragment' || item.fragment) {
    return item;
  }

  const fromLine = 'fromLine' in item && typeof item.fromLine === 'number' ? item.fromLine : 0;
  const toLine = 'toLine' in item && typeof item.toLine === 'number' ? item.toLine : fromLine + 1;

  return {
    ...item,
    fragment: {
      kind: 'para',
      blockId: item.blockId,
      fromLine,
      toLine,
      x: item.x,
      y: item.y,
      width: item.width,
    },
  };
};

const createSinglePageResolvedLayout = (item: ResolvedLayout['pages'][number]['items'][number]): ResolvedLayout => ({
  version: 1,
  flowMode: 'paginated',
  pageGap: 0,
  pages: [
    {
      id: 'page-0',
      index: 0,
      number: 1,
      width: 400,
      height: 500,
      items: [withFallbackFragment(item)],
    },
  ],
});

const expectCssColor = (actual: string, expectedHex: string): void => {
  const normalizedActual = actual.replace(/\s+/g, '').toLowerCase();
  let normalizedHex = expectedHex.toLowerCase();
  if (!normalizedHex.startsWith('#')) {
    normalizedHex = `#${normalizedHex}`;
  }
  if (normalizedHex.length === 4) {
    normalizedHex = `#${normalizedHex[1]}${normalizedHex[1]}${normalizedHex[2]}${normalizedHex[2]}${normalizedHex[3]}${normalizedHex[3]}`;
  }
  const r = Number.parseInt(normalizedHex.slice(1, 3), 16);
  const g = Number.parseInt(normalizedHex.slice(3, 5), 16);
  const b = Number.parseInt(normalizedHex.slice(5, 7), 16);
  const rgb = `rgb(${r},${g},${b})`;
  expect([normalizedHex, rgb]).toContain(normalizedActual);
};

const sdtBlock: FlowBlock = {
  kind: 'paragraph',
  id: 'sdt-block',
  runs: [
    { text: 'Field: ', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 7 },
    {
      text: 'Client Name',
      fontFamily: 'Arial',
      fontSize: 16,
      pmStart: 7,
      pmEnd: 19,
      sdt: {
        type: 'fieldAnnotation',
        fieldId: 'FIELD-1',
        fieldType: 'text',
        variant: 'text',
        visibility: 'visible',
      },
    },
  ],
  attrs: {
    sdt: {
      type: 'structuredContent',
      scope: 'inline',
      id: 'SC-1',
      tag: 'client_inline',
      alias: 'Client Data',
    },
  },
};

const sdtMeasure: Measure = {
  kind: 'paragraph',
  lines: [
    {
      fromRun: 0,
      fromChar: 0,
      toRun: 1,
      toChar: 11,
      width: 160,
      ascent: 12,
      descent: 4,
      lineHeight: 20,
    },
  ],
  totalHeight: 20,
};

const sdtLayout: Layout = {
  pageSize: { w: 400, h: 500 },
  pages: [
    {
      number: 1,
      fragments: [
        {
          kind: 'para',
          blockId: 'sdt-block',
          fromLine: 0,
          toLine: 1,
          x: 20,
          y: 30,
          width: 320,
          pmStart: 0,
          pmEnd: 19,
        },
      ],
    },
  ],
};

describe('DomPainter', () => {
  let mount: HTMLElement;

  beforeEach(() => {
    mount = document.createElement('div');
  });

  it('renders pages and fragments into the mount', () => {
    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    expect(mount.classList.contains('superdoc-layout')).toBe(true);
    expect(mount.children).toHaveLength(1);

    const page = mount.children[0] as HTMLElement;
    expect(page.classList.contains('superdoc-page')).toBe(true);
    expect(page.dataset.pageNumber).toBe('1');
    expect(page.style.width).toBe('400px');
    expect(page.style.height).toBe('500px');
    expect(page.children).toHaveLength(1);

    const fragment = page.children[0] as HTMLElement;
    expect(fragment.classList.contains('superdoc-fragment')).toBe(true);
    expect(fragment.dataset.blockId).toBe('block-1');
    expect(fragment.style.left).toBe('30px');
    expect(fragment.style.top).toBe('40px');
    expect(fragment.textContent).toContain('Hello');
    expect(fragment.textContent).toContain('world');
  });

  it('isolates unresolved document text from host foreground CSS', () => {
    const hostStyle = document.createElement('style');
    hostStyle.textContent = `
      :root { color: #f2f4f8; }
      body * { color: #f2f4f8; }
      span { color: #f2f4f8; }
    `;
    document.head.appendChild(hostStyle);

    try {
      const painter = createTestPainter({ blocks: [block], measures: [measure] });
      painter.paint(layout, mount);

      const page = mount.querySelector('.superdoc-page') as HTMLElement;
      const fragment = mount.querySelector('.superdoc-fragment') as HTMLElement;
      const line = mount.querySelector('.superdoc-line') as HTMLElement;
      const textRun = Array.from(mount.querySelectorAll<HTMLElement>('.superdoc-text-run')).find((el) =>
        el.textContent?.includes('Hello'),
      );
      const styleEl = document.querySelector('[data-superdoc-document-surface-styles="true"]');
      const cssText = styleEl?.textContent ?? '';

      expect(page.classList.contains('superdoc-page')).toBe(true);
      expect(fragment.style.color).toBe('inherit');
      expect(line.style.color).toBe('inherit');
      expect(textRun).toBeTruthy();
      expect(cssText).toContain('color: var(--sd-layout-page-color, #000000);');
      expect(cssText).toContain('.superdoc-layout .superdoc-page .superdoc-text-run');
    } finally {
      hostStyle.remove();
    }
  });

  it('paints document-level page background from resolved layout', () => {
    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint({ ...layout, documentBackground: { color: '#EEEEEE' } }, mount);

    const page = mount.querySelector('.superdoc-page') as HTMLElement;
    expectCssColor(page.style.background, '#EEEEEE');
  });

  it('keeps the configured page background when no document background is present', () => {
    const painter = createTestPainter({
      blocks: [block],
      measures: [measure],
      pageStyles: { background: '#FFFFFF' },
    });
    painter.paint(layout, mount);

    const page = mount.querySelector('.superdoc-page') as HTMLElement;
    expectCssColor(page.style.background, '#FFFFFF');
  });

  it('applies paragraph alignment to line elements', () => {
    const alignedBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'aligned-block',
      runs: [{ text: 'Aligned', fontFamily: 'Arial', fontSize: 16 }],
      attrs: { alignment: 'right' },
    };

    const alignedMeasure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 7,
          width: 60,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
      ],
      totalHeight: 20,
    };

    const alignedLayout: Layout = {
      pageSize: { w: 200, h: 200 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'aligned-block',
              fromLine: 0,
              toLine: 1,
              x: 0,
              y: 0,
              width: 100,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [alignedBlock], measures: [alignedMeasure] });
    painter.paint(alignedLayout, mount);

    const line = mount.querySelector('.superdoc-line') as HTMLElement;
    expect(line).toBeTruthy();
    expect(line.style.textAlign).toBe('right');
  });

  it('applies justified spacing to non-last lines only (Word behavior)', () => {
    const justifyBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'justify-block',
      runs: [
        { text: 'a b', fontFamily: 'Arial', fontSize: 16 },
        { text: 'c d', fontFamily: 'Arial', fontSize: 16 },
      ],
      attrs: { alignment: 'justify' },
    };

    const justifyMeasure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 3,
          width: 60,
          maxWidth: 100,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
        {
          fromRun: 1,
          fromChar: 0,
          toRun: 1,
          toChar: 3,
          width: 50,
          maxWidth: 100,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
      ],
      totalHeight: 40,
    };

    const justifyLayout: Layout = {
      pageSize: { w: 200, h: 200 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'justify-block',
              fromLine: 0,
              toLine: 2,
              x: 0,
              y: 0,
              width: 100,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [justifyBlock], measures: [justifyMeasure] });
    painter.paint(justifyLayout, mount);

    const lines = Array.from(mount.querySelectorAll('.superdoc-line')) as HTMLElement[];
    expect(lines).toHaveLength(2);
    // First line should be justified via word-spacing (non-last line)
    expect(lines[0].style.wordSpacing).toBe('40px');
    // Last line should NOT be justified (Word behavior: last line of paragraph is left-aligned)
    expect(lines[1].style.wordSpacing).toBe('');
  });

  it('applies justify for manual tab runs that use default positioning', () => {
    const tabBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'tab-justify-block',
      runs: [
        { text: '1.', fontFamily: 'Arial', fontSize: 16 },
        { kind: 'tab', text: '\t', width: 48 },
        { text: 'a b c d', fontFamily: 'Arial', fontSize: 16 },
      ],
      attrs: { alignment: 'justify' },
    };

    const tabMeasure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 2,
          toChar: 7,
          width: 60,
          maxWidth: 100,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
          segments: [{ runIndex: 2, fromChar: 0, toChar: 7, width: 60, x: 40 }],
        },
        {
          fromRun: 2,
          fromChar: 7,
          toRun: 2,
          toChar: 7,
          width: 0,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
      ],
      totalHeight: 40,
    };

    const tabLayout: Layout = {
      pageSize: { w: 200, h: 200 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'tab-justify-block',
              fromLine: 0,
              toLine: 2,
              x: 0,
              y: 0,
              width: 100,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [tabBlock], measures: [tabMeasure] });
    painter.paint(tabLayout, mount);

    const lines = Array.from(mount.querySelectorAll('.superdoc-line')) as HTMLElement[];
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(parseFloat(lines[0].style.wordSpacing)).toBeGreaterThan(0);
  });

  it('paints underlined text and default-positioned tabs with one measured overlay', () => {
    const block: FlowBlock = {
      kind: 'paragraph',
      id: 'underlined-default-tabs',
      runs: [
        {
          text: 'This is some text followed by some tab stops ',
          fontFamily: 'Arial',
          fontSize: 16,
          underline: { style: 'single' },
        },
        { kind: 'tab', text: '\t', width: 14.0859375, fontSize: 16, underline: { style: 'single' } },
        { kind: 'tab', text: '\t', width: 48, fontSize: 16, underline: { style: 'single' } },
        { kind: 'tab', text: '\t', width: 48, fontSize: 16, underline: { style: 'single' } },
        { kind: 'tab', text: '\t', width: 48, fontSize: 16, underline: { style: 'single' } },
        { kind: 'tab', text: '\t', width: 48, fontSize: 16, underline: { style: 'single' } },
      ],
    };

    const measure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 5,
          toChar: 1,
          width: 528,
          maxWidth: 624,
          ascent: 14.640625,
          descent: 3.5390625,
          lineHeight: 21.313333333333333,
          segments: [{ runIndex: 0, fromChar: 0, toChar: 45, width: 321.9140625 }],
          spaceCount: 9,
        },
      ],
      totalHeight: 21.313333333333333,
    };

    const layout: Layout = {
      pageSize: { w: 816, h: 1056 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'underlined-default-tabs',
              fromLine: 0,
              toLine: 1,
              x: 0,
              y: 0,
              width: 624,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    const lineEl = mount.querySelector('.superdoc-line') as HTMLElement;
    const overlay = lineEl.querySelector('.superdoc-underline-overlay') as HTMLElement;
    const textRun = lineEl.querySelector('span:not(.superdoc-tab):not(.superdoc-underline-overlay)') as HTMLElement;
    const tabRuns = Array.from(lineEl.querySelectorAll('.superdoc-tab')) as HTMLElement[];

    expect(overlay).toBeTruthy();
    expect(overlay.style.left).toBe('0px');
    expect(overlay.style.width).toBe('528px');
    expect(overlay.style.borderTop).toContain('solid');
    // Pin the underline y to the computed offset - the whole point of SD-3330 - not just > ascent.
    expect(parseFloat(overlay.style.top)).toBeCloseTo(underlineOffsetFromLineTop(measure.lines[0]), 5);
    expect(textRun.style.textDecorationLine).toBe('none');
    expect(tabRuns).toHaveLength(5);
    tabRuns.forEach((tab) => expect(tab.style.borderBottom).toBe(''));
  });

  it('keeps native underlines (no overlay) on RTL tab lines', () => {
    // PR #3627 review: RTL paragraphs skip segment positioning (shouldUseSegmentPositioning returns
    // false for RTL) and fall to inline flow so the browser's bidi algorithm places the tabs. The
    // overlay builds LTR left-offsets from the line start, so it must NOT own the underline there -
    // otherwise it suppresses the natively-correct underlines and paints on the wrong side. RTL must
    // keep native text-decoration + tab borders.
    const block: FlowBlock = {
      kind: 'paragraph',
      id: 'rtl-underlined-tabs',
      attrs: { directionContext: { inlineDirection: 'rtl', writingMode: 'horizontal-tb' } },
      runs: [
        { text: 'שלום', fontFamily: 'Arial', fontSize: 16, underline: { style: 'single' } },
        { kind: 'tab', text: '\t', width: 48, fontSize: 16, underline: { style: 'single' } },
        { kind: 'tab', text: '\t', width: 48, fontSize: 16, underline: { style: 'single' } },
      ],
    };

    const measure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 2,
          toChar: 1,
          width: 140,
          maxWidth: 624,
          ascent: 14.640625,
          descent: 3.5390625,
          lineHeight: 21.313333333333333,
          // Segments are present (as for any tab line); the RTL guard - not absent segments - is
          // what must keep the overlay off.
          segments: [{ runIndex: 0, fromChar: 0, toChar: 4, width: 44 }],
          spaceCount: 0,
        },
      ],
      totalHeight: 21.313333333333333,
    };

    const layout: Layout = {
      pageSize: { w: 816, h: 1056 },
      pages: [
        {
          number: 1,
          fragments: [{ kind: 'para', blockId: 'rtl-underlined-tabs', fromLine: 0, toLine: 1, x: 0, y: 0, width: 624 }],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    const lineEl = mount.querySelector('.superdoc-line') as HTMLElement;
    const overlay = lineEl.querySelector('.superdoc-underline-overlay');
    const textRun = lineEl.querySelector('span:not(.superdoc-tab):not(.superdoc-underline-overlay)') as HTMLElement;
    const tabRuns = Array.from(lineEl.querySelectorAll('.superdoc-tab')) as HTMLElement[];

    // No overlay on RTL lines - the LTR overlay offsets would land on the wrong side.
    expect(overlay).toBeNull();
    // Native underlines are preserved (not suppressed): text keeps its decoration, tabs keep borders.
    expect(textRun.style.textDecorationLine).not.toBe('none');
    expect(tabRuns).toHaveLength(2);
    tabRuns.forEach((tab) => expect(tab.style.borderBottom).toContain('solid'));
  });

  // SD-3330 review: the inline overlay builds left-origin offsets, so it must stay off (native
  // underlines preserved) whenever the content is horizontally shifted in a way it can't see, or
  // when the line carries an atomic run the overlay can't measure.
  const expectNoOverlayNativesKept = (blockAttrs: Record<string, unknown>, extraRuns: unknown[] = []) => {
    const block = {
      kind: 'paragraph',
      id: 'overlay-origin-mismatch',
      attrs: blockAttrs,
      runs: [
        { text: 'Name', fontFamily: 'Arial', fontSize: 16, underline: { style: 'single' } },
        { kind: 'tab', text: '\t', width: 48, fontSize: 16, underline: { style: 'single' } },
        ...extraRuns,
      ],
    } as unknown as FlowBlock;
    const measure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 1 + extraRuns.length,
          toChar: 1,
          width: 120,
          maxWidth: 624,
          ascent: 14.640625,
          descent: 3.5390625,
          lineHeight: 21.313333333333333,
          segments: [{ runIndex: 0, fromChar: 0, toChar: 4, width: 40 }],
          spaceCount: 0,
        },
      ],
      totalHeight: 21.313333333333333,
    };
    const layout: Layout = {
      pageSize: { w: 816, h: 1056 },
      pages: [
        {
          number: 1,
          fragments: [
            { kind: 'para', blockId: 'overlay-origin-mismatch', fromLine: 0, toLine: 1, x: 0, y: 0, width: 624 },
          ],
        },
      ],
    };
    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);
    const lineEl = mount.querySelector('.superdoc-line') as HTMLElement;
    const textRun = lineEl.querySelector('span:not(.superdoc-tab):not(.superdoc-underline-overlay)') as HTMLElement;
    const tabRuns = Array.from(lineEl.querySelectorAll('.superdoc-tab')) as HTMLElement[];
    expect(lineEl.querySelector('.superdoc-underline-overlay')).toBeNull();
    expect(textRun.style.textDecorationLine).not.toBe('none');
    expect(tabRuns.length).toBeGreaterThan(0);
    tabRuns.forEach((tab) => expect(tab.style.borderBottom).toContain('solid'));
  };

  it('keeps native underlines (no overlay) on center-aligned inline tab lines', () => {
    expectNoOverlayNativesKept({ alignment: 'center' });
  });

  it('keeps native underlines (no overlay) on right-aligned inline tab lines', () => {
    expectNoOverlayNativesKept({ alignment: 'right' });
  });

  it('keeps native underlines (no overlay) on hanging-indent inline tab lines', () => {
    expectNoOverlayNativesKept({ indent: { left: 0, hanging: 360 } });
  });

  it('keeps native underlines (no overlay) when an underlined field annotation shares the line', () => {
    // FieldAnnotationRun.underline is a boolean the overlay would treat as eligible and suppress, but
    // it cannot measure the field's width (run.size, not run.width). An atomic run on the line keeps
    // the overlay off so the field's underline is not silently dropped.
    expectNoOverlayNativesKept({}, [
      {
        kind: 'fieldAnnotation',
        variant: 'text',
        displayLabel: 'Client',
        fieldId: 'F1',
        fieldType: 'text',
        fieldColor: '#980043',
        underline: true,
        pmStart: 0,
        pmEnd: 1,
      },
    ]);

    // Sharper than just "no overlay": the field's own underline must not be suppressed. The overlay's
    // suppression path forces textDecorationLine to 'none' on the run's element; with the overlay off
    // it keeps its native value.
    const fieldEl = mount.querySelector('[aria-label="Field annotation"]') as HTMLElement;
    expect(fieldEl).toBeTruthy();
    expect(fieldEl.style.textDecorationLine).not.toBe('none');
  });

  it('paints one measured overlay for underlined text + tabs on the segment-positioned path', () => {
    // Regression for SD-3330: a line with an explicit segment x (e.g. text after a tab stop)
    // takes the segment-positioned branch. The line-level underline overlay must own the mark
    // there too, so text + preserved spaces + tabs share one y instead of text-decoration and
    // tab-border landing on different rows.
    const block: FlowBlock = {
      kind: 'paragraph',
      id: 'underlined-positioned-tabs',
      runs: [
        { text: 'Name: ', fontFamily: 'Arial', fontSize: 16, underline: { style: 'single' } },
        { kind: 'tab', text: '\t', width: 48, fontSize: 16, underline: { style: 'single' } },
        { kind: 'tab', text: '\t', width: 48, fontSize: 16, underline: { style: 'single' } },
        { text: 'Value', fontFamily: 'Arial', fontSize: 16, underline: { style: 'single' } },
      ],
    };

    const measure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 3,
          toChar: 5,
          width: 232,
          maxWidth: 624,
          ascent: 14.640625,
          descent: 3.5390625,
          lineHeight: 21.313333333333333,
          // The explicit x on the trailing "Value" segment forces the segment-positioned path.
          segments: [
            { runIndex: 0, fromChar: 0, toChar: 6, width: 50 },
            { runIndex: 3, fromChar: 0, toChar: 5, width: 40, x: 192 },
          ],
          spaceCount: 1,
        },
      ],
      totalHeight: 21.313333333333333,
    };

    const layout: Layout = {
      pageSize: { w: 816, h: 1056 },
      pages: [
        {
          number: 1,
          fragments: [
            { kind: 'para', blockId: 'underlined-positioned-tabs', fromLine: 0, toLine: 1, x: 0, y: 0, width: 624 },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    const lineEl = mount.querySelector('.superdoc-line') as HTMLElement;
    const overlays = Array.from(lineEl.querySelectorAll('.superdoc-underline-overlay')) as HTMLElement[];
    const textRuns = Array.from(lineEl.querySelectorAll('.superdoc-text-run')).filter((s) =>
      /Name:|Value/.test(s.textContent || ''),
    ) as HTMLElement[];
    const borderedEls = Array.from(lineEl.querySelectorAll('span, div')).filter(
      (el) => (el as HTMLElement).style.borderBottom !== '',
    );

    // The positioned branch must coalesce text + both tabs + the x=192 "Value" segment into a
    // SINGLE continuous overlay spanning the whole content - Name: [0,50], tab [50,98], tab
    // [98,192] (filling to the next segment x), Value [192,232] - not several abutting spans
    // that could each round to a different sub-pixel edge and reintroduce a seam.
    expect(overlays).toHaveLength(1);
    expect(overlays[0].style.left).toBe('0px');
    expect(overlays[0].style.width).toBe('232px');
    expect(overlays[0].style.borderTop).toContain('solid');
    expect(parseFloat(overlays[0].style.top)).toBeCloseTo(underlineOffsetFromLineTop(measure.lines[0]), 5);
    // Native underlines are suppressed where the overlay owns the mark.
    expect(textRuns.length).toBeGreaterThan(0);
    textRuns.forEach((t) => expect(t.style.textDecorationLine).toBe('none'));
    expect(borderedEls).toHaveLength(0);
  });

  it('uses first-line hanging width when justifying default-tab positioned segments', () => {
    const tabBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'hanging-default-tab-justify-block',
      runs: [
        { text: 'WHEREAS:', fontFamily: 'Times New Roman', fontSize: 16 },
        { kind: 'tab', text: '\t', width: 62.2265625 },
        {
          text: "The Board of Directors of the Corporation has reviewed the Corporation's ",
          fontFamily: 'Times New Roman',
          fontSize: 16,
        },
        { text: 'next line', fontFamily: 'Times New Roman', fontSize: 16 },
      ],
      attrs: {
        alignment: 'justify',
        indent: { left: 144, hanging: 144 },
      },
    };

    const tabMeasure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 2,
          toChar: 73,
          width: 620.96875,
          maxWidth: 624,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
          spaceCount: 10,
          segments: [
            { runIndex: 0, fromChar: 0, toChar: 8, width: 81.7734375 },
            { runIndex: 2, fromChar: 0, toChar: 73, width: 476.96875, x: 144 },
          ],
        },
        {
          fromRun: 3,
          fromChar: 0,
          toRun: 3,
          toChar: 9,
          width: 60,
          maxWidth: 480,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
      ],
      totalHeight: 40,
    };

    const tabLayout: Layout = {
      pageSize: { w: 816, h: 1056 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'hanging-default-tab-justify-block',
              fromLine: 0,
              toLine: 2,
              x: 96,
              y: 96,
              width: 624,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [tabBlock], measures: [tabMeasure] });
    painter.paint(tabLayout, mount);

    const lines = Array.from(mount.querySelectorAll('.superdoc-line')) as HTMLElement[];
    expect(lines).toHaveLength(2);
    expect(parseFloat(lines[0].style.wordSpacing)).toBeCloseTo(0.303125, 5);
  });

  it('advances flow-positioned tab segments by accumulated justify spacing', () => {
    const tabBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'justify-tab-flow-segments',
      runs: [
        { text: '10.1', fontFamily: 'Calibri', fontSize: 13.333, bold: true },
        { text: '.', fontFamily: 'Calibri', fontSize: 13.333 },
        { kind: 'tab', text: '\t', width: 7 },
        { text: 'Any and all', fontFamily: 'Calibri', fontSize: 13.333 },
        { text: ' intellectual property', fontFamily: 'Calibri', fontSize: 13.333 },
        { text: 'last line', fontFamily: 'Calibri', fontSize: 13.333 },
      ],
      attrs: { alignment: 'justify' },
    };

    const tabMeasure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 4,
          toChar: 22,
          width: 100,
          maxWidth: 120,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
          spaceCount: 4,
          segments: [
            { runIndex: 0, fromChar: 0, toChar: 4, width: 25 },
            { runIndex: 1, fromChar: 0, toChar: 1, width: 4 },
            { runIndex: 3, fromChar: 0, toChar: 11, width: 60, x: 37 },
            { runIndex: 4, fromChar: 0, toChar: 22, width: 40 },
          ],
        },
        {
          fromRun: 5,
          fromChar: 0,
          toRun: 5,
          toChar: 9,
          width: 40,
          maxWidth: 120,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
      ],
      totalHeight: 40,
    };

    const tabLayout: Layout = {
      pageSize: { w: 200, h: 200 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'justify-tab-flow-segments',
              fromLine: 0,
              toLine: 2,
              x: 0,
              y: 0,
              width: 120,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [tabBlock], measures: [tabMeasure] });
    painter.paint(tabLayout, mount);

    const lines = Array.from(mount.querySelectorAll('.superdoc-line')) as HTMLElement[];
    expect(lines[0].style.wordSpacing).toBe('5px');

    const continuation = Array.from(lines[0].querySelectorAll('span')).find((span) =>
      span.textContent?.includes('intellectual property'),
    ) as HTMLElement;
    expect(continuation.style.left).toBe('107px');
  });

  it('does not justify lines with multiple explicit tab columns', () => {
    const tabBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'multi-column-tab-justify-block',
      runs: [
        { text: 'Each Accident', fontFamily: 'Times New Roman', fontSize: 16 },
        { kind: 'tab', text: '\t', width: 120 },
        { text: '$1,000,000', fontFamily: 'Times New Roman', fontSize: 16 },
        { text: 'last line', fontFamily: 'Times New Roman', fontSize: 16 },
      ],
      attrs: { alignment: 'justify' },
    };

    const tabMeasure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 2,
          toChar: 10,
          width: 160,
          maxWidth: 300,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
          spaceCount: 1,
          segments: [
            { runIndex: 0, fromChar: 0, toChar: 13, width: 94, x: 0 },
            { runIndex: 2, fromChar: 0, toChar: 10, width: 72, x: 192 },
          ],
        },
        {
          fromRun: 3,
          fromChar: 0,
          toRun: 3,
          toChar: 9,
          width: 40,
          maxWidth: 300,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
      ],
      totalHeight: 40,
    };

    const tabLayout: Layout = {
      pageSize: { w: 400, h: 200 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'multi-column-tab-justify-block',
              fromLine: 0,
              toLine: 2,
              x: 0,
              y: 0,
              width: 300,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [tabBlock], measures: [tabMeasure] });
    painter.paint(tabLayout, mount);

    const lines = Array.from(mount.querySelectorAll('.superdoc-line')) as HTMLElement[];
    expect(lines[0].style.wordSpacing).toBe('');
  });

  it('skips justify for lines that used author-defined tab stops', () => {
    const tabBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'explicit-tab-justify-block',
      runs: [
        { text: 'A', fontFamily: 'Arial', fontSize: 16 },
        { kind: 'tab', text: '\t', width: 48 },
        { text: 'a b c d', fontFamily: 'Arial', fontSize: 16 },
      ],
      attrs: { alignment: 'justify' },
    };

    const tabMeasure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 2,
          toChar: 7,
          width: 60,
          maxWidth: 100,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
          hasExplicitTabStops: true,
          segments: [{ runIndex: 2, fromChar: 0, toChar: 7, width: 60, x: 40 }],
        },
        {
          fromRun: 2,
          fromChar: 7,
          toRun: 2,
          toChar: 7,
          width: 0,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
      ],
      totalHeight: 40,
    };

    const tabLayout: Layout = {
      pageSize: { w: 200, h: 200 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'explicit-tab-justify-block',
              fromLine: 0,
              toLine: 2,
              x: 0,
              y: 0,
              width: 100,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [tabBlock], measures: [tabMeasure] });
    painter.paint(tabLayout, mount);

    const lines = Array.from(mount.querySelectorAll('.superdoc-line')) as HTMLElement[];
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines[0].style.wordSpacing).toBe('');
  });

  it('justifies last visible line when paragraph ends with lineBreak', () => {
    // When a paragraph ends with <w:br/> (lineBreak), the visible text before the break
    // should still be justified because the "last line" is the empty line after the break.
    const justifyWithBreakBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'justify-break-block',
      runs: [
        { text: 'a b', fontFamily: 'Arial', fontSize: 16 },
        { text: 'c d', fontFamily: 'Arial', fontSize: 16 },
        { kind: 'lineBreak' }, // Trailing lineBreak means last visible line should be justified
      ],
      attrs: { alignment: 'justify' },
    };

    const justifyWithBreakMeasure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 3,
          width: 60,
          maxWidth: 100,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
        {
          fromRun: 1,
          fromChar: 0,
          toRun: 1,
          toChar: 3,
          width: 50,
          maxWidth: 100,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
      ],
      totalHeight: 40,
    };

    const justifyWithBreakLayout: Layout = {
      pageSize: { w: 200, h: 200 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'justify-break-block',
              fromLine: 0,
              toLine: 2,
              x: 0,
              y: 0,
              width: 100,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [justifyWithBreakBlock], measures: [justifyWithBreakMeasure] });
    painter.paint(justifyWithBreakLayout, mount);

    const lines = Array.from(mount.querySelectorAll('.superdoc-line')) as HTMLElement[];
    expect(lines).toHaveLength(2);
    // Both lines should be justified because paragraph ends with lineBreak
    expect(lines[0].style.wordSpacing).toBe('40px');
    expect(lines[1].style.wordSpacing).toBe('50px');
  });

  it('does not justify single-line paragraph (features_lists case)', () => {
    // A single-line paragraph like "A list of list features:" should NOT be justified
    // because that single line is also the last line.
    const singleLineBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'single-line-block',
      runs: [{ text: 'A list of list features:', fontFamily: 'Arial', fontSize: 16 }],
      attrs: { alignment: 'justify' },
    };

    const singleLineMeasure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 24,
          width: 150,
          maxWidth: 400,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
      ],
      totalHeight: 20,
    };

    const singleLineLayout: Layout = {
      pageSize: { w: 500, h: 500 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'single-line-block',
              fromLine: 0,
              toLine: 1,
              x: 0,
              y: 0,
              width: 400,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [singleLineBlock], measures: [singleLineMeasure] });
    painter.paint(singleLineLayout, mount);

    const lines = Array.from(mount.querySelectorAll('.superdoc-line')) as HTMLElement[];
    expect(lines).toHaveLength(1);
    // Single line = last line, should NOT be justified
    expect(lines[0].style.wordSpacing).toBe('');
  });

  it('justifies single-line paragraph when it ends with lineBreak', () => {
    // A single-line paragraph that ends with <w:br/> SHOULD be justified
    // because the empty line after the break is the "true" last line.
    const singleLineWithBreakBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'single-line-break-block',
      runs: [{ text: 'Justified single line', fontFamily: 'Arial', fontSize: 16 }, { kind: 'lineBreak' }],
      attrs: { alignment: 'justify' },
    };

    const singleLineWithBreakMeasure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 21,
          width: 150,
          maxWidth: 400,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
      ],
      totalHeight: 20,
    };

    const singleLineWithBreakLayout: Layout = {
      pageSize: { w: 500, h: 500 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'single-line-break-block',
              fromLine: 0,
              toLine: 1,
              x: 0,
              y: 0,
              width: 400,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [singleLineWithBreakBlock], measures: [singleLineWithBreakMeasure] });
    painter.paint(singleLineWithBreakLayout, mount);

    const lines = Array.from(mount.querySelectorAll('.superdoc-line')) as HTMLElement[];
    expect(lines).toHaveLength(1);
    // Ends with lineBreak, so this visible line SHOULD be justified
    expect(lines[0].style.wordSpacing).not.toBe('');
  });

  it('justifies last line of fragment when paragraph continues to next fragment', () => {
    // When a paragraph spans multiple fragments (pages), the last line of an
    // intermediate fragment should still be justified because it's not the
    // true last line of the paragraph.
    const multiFragmentBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'multi-fragment-block',
      runs: [
        { text: 'First line text', fontFamily: 'Arial', fontSize: 16 },
        { text: 'Second line text', fontFamily: 'Arial', fontSize: 16 },
      ],
      attrs: { alignment: 'justify' },
    };

    const multiFragmentMeasure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 15,
          width: 100,
          maxWidth: 200,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
        {
          fromRun: 1,
          fromChar: 0,
          toRun: 1,
          toChar: 16,
          width: 110,
          maxWidth: 200,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
      ],
      totalHeight: 40,
    };

    const multiFragmentLayout: Layout = {
      pageSize: { w: 300, h: 100 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'multi-fragment-block',
              fromLine: 0,
              toLine: 1,
              x: 0,
              y: 0,
              width: 200,
              continuesOnNext: true, // Paragraph continues to next page
            },
          ],
        },
        {
          number: 2,
          fragments: [
            {
              kind: 'para',
              blockId: 'multi-fragment-block',
              fromLine: 1,
              toLine: 2,
              x: 0,
              y: 0,
              width: 200,
              continuesFromPrev: true,
              // No continuesOnNext = this is the final fragment
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [multiFragmentBlock], measures: [multiFragmentMeasure] });
    painter.paint(multiFragmentLayout, mount);

    const lines = Array.from(mount.querySelectorAll('.superdoc-line')) as HTMLElement[];
    expect(lines).toHaveLength(2);
    // First fragment's last line SHOULD be justified (continuesOnNext=true)
    expect(lines[0].style.wordSpacing).toBe('50px');
    // Second fragment's last line should NOT be justified (true last line of paragraph)
    expect(lines[1].style.wordSpacing).toBe('');
  });

  it('preserves right/center alignment for single-line paragraphs', () => {
    // Right/center aligned paragraphs should maintain their alignment
    // even when it's a single line (the skipJustify logic should not affect them).
    const rightAlignBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'right-align-block',
      runs: [{ text: 'Right aligned text', fontFamily: 'Arial', fontSize: 16 }],
      attrs: { alignment: 'right' },
    };

    const centerAlignBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'center-align-block',
      runs: [{ text: 'Center aligned text', fontFamily: 'Arial', fontSize: 16 }],
      attrs: { alignment: 'center' },
    };

    const singleLineMeasure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 18,
          width: 120,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
      ],
      totalHeight: 20,
    };

    const rightAlignLayout: Layout = {
      pageSize: { w: 300, h: 100 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'right-align-block',
              fromLine: 0,
              toLine: 1,
              x: 0,
              y: 0,
              width: 200,
            },
          ],
        },
      ],
    };

    const centerAlignLayout: Layout = {
      pageSize: { w: 300, h: 100 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'center-align-block',
              fromLine: 0,
              toLine: 1,
              x: 0,
              y: 0,
              width: 200,
            },
          ],
        },
      ],
    };

    // Test right alignment
    const rightPainter = createTestPainter({ blocks: [rightAlignBlock], measures: [singleLineMeasure] });
    rightPainter.paint(rightAlignLayout, mount);
    let line = mount.querySelector('.superdoc-line') as HTMLElement;
    expect(line.style.textAlign).toBe('right');

    // Clear and test center alignment
    mount.innerHTML = '';
    const centerPainter = createTestPainter({ blocks: [centerAlignBlock], measures: [singleLineMeasure] });
    centerPainter.paint(centerAlignLayout, mount);
    line = mount.querySelector('.superdoc-line') as HTMLElement;
    expect(line.style.textAlign).toBe('center');
  });

  it('justifies multi-line list paragraphs (except last line)', () => {
    // List paragraphs with alignment='justify' should be justified just like normal paragraphs.
    // Multi-line list items have their non-final lines justified, and the last line is not justified.
    const listParaBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'list-para-block',
      runs: [
        { text: 'First line of list item text', fontFamily: 'Arial', fontSize: 16 },
        { text: ' Second line of list item text', fontFamily: 'Arial', fontSize: 16 },
      ],
      attrs: { alignment: 'justify' },
      wordLayout: {
        marker: {
          markerText: '1.',
          markerFontSize: 16,
          markerBoxWidthPx: 24,
          markerX: 4,
          markerY: 0,
          markerJustification: 'left',
        },
        spacing: { before: 0, after: 0, line: 12, lineRule: 'auto' },
        indent: { left: 48, right: 0, firstLine: 0, hanging: 24 },
      },
    };

    const listParaMeasure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 28,
          width: 180,
          maxWidth: 400,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
        {
          fromRun: 1,
          fromChar: 0,
          toRun: 1,
          toChar: 31,
          width: 190,
          maxWidth: 400,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
      ],
      totalHeight: 40,
      marker: {
        markerWidth: 24,
        markerTextWidth: 12,
        indentLeft: 48,
      },
    };

    const listParaLayout: Layout = {
      pageSize: { w: 500, h: 500 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'list-para-block',
              fromLine: 0,
              toLine: 2,
              x: 0,
              y: 0,
              width: 400,
              markerWidth: 24,
              markerTextWidth: 12,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [listParaBlock], measures: [listParaMeasure] });
    painter.paint(listParaLayout, mount);

    const lines = Array.from(mount.querySelectorAll('.superdoc-line')) as HTMLElement[];
    expect(lines).toHaveLength(2);
    // First line SHOULD be justified (not the last line)
    expect(lines[0].style.wordSpacing).toBe('44px');
    // Second line should NOT be justified (last line of paragraph)
    expect(lines[1].style.wordSpacing).toBe('');
  });

  it('does not stretch list marker suffix spaces when justifying', () => {
    const listParaBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'list-suffix-space',
      runs: [
        { text: 'First line of list item text', fontFamily: 'Arial', fontSize: 16 },
        { text: ' Second line of list item text', fontFamily: 'Arial', fontSize: 16 },
      ],
      attrs: {
        alignment: 'justify',
        indent: { left: 48, hanging: 24 },
        wordLayout: {
          indentLeftPx: 48,
          marker: {
            markerText: '1.',
            glyphWidthPx: 12,
            markerBoxWidthPx: 24,
            markerX: 4,
            textStartX: 24,
            baselineOffsetPx: 0,
            justification: 'left',
            suffix: 'space',
            run: { fontFamily: 'Arial', fontSize: 16 },
          },
        },
      },
    };

    const listParaMeasure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 28,
          width: 180,
          maxWidth: 400,
          spaceCount: 5,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
        {
          fromRun: 1,
          fromChar: 0,
          toRun: 1,
          toChar: 31,
          width: 190,
          maxWidth: 400,
          spaceCount: 6,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
      ],
      totalHeight: 40,
      marker: {
        markerWidth: 24,
        markerTextWidth: 12,
        indentLeft: 48,
      },
    };

    const listParaLayout: Layout = {
      pageSize: { w: 500, h: 500 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'list-suffix-space',
              fromLine: 0,
              toLine: 2,
              x: 0,
              y: 0,
              width: 400,
              markerWidth: 24,
              markerTextWidth: 12,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [listParaBlock], measures: [listParaMeasure] });
    painter.paint(listParaLayout, mount);

    const firstLine = mount.querySelector('.superdoc-line') as HTMLElement;
    // Inline list first lines without explicit segment positioning keep the measured width contract.
    // The painter caps line.maxWidth by fragment width minus positive paragraph indents.
    // availableWidth = 400 - leftIndent(48) = 352
    // slack = 352 - 180 = 172, wordSpacing = 172 / 5 = 34.4px
    expect(firstLine.style.wordSpacing).toBe('34.4px');

    const suffix = firstLine.querySelector('.superdoc-marker-suffix-space') as HTMLElement;
    expect(suffix).toBeTruthy();
    expect(suffix.style.wordSpacing).toBe('0px');
    expect(suffix.textContent).toBe('\u00A0');
  });

  it('does not justify single-line list paragraphs (last line rule)', () => {
    // Single-line list paragraphs with alignment='justify' should NOT be justified
    // because that single line is also the last line, which should not be justified per Word spec.
    const singleLineListBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'single-list-block',
      runs: [{ text: 'Single line list item', fontFamily: 'Arial', fontSize: 16 }],
      attrs: { alignment: 'justify' },
      wordLayout: {
        marker: {
          markerText: '1.',
          markerFontSize: 16,
          markerBoxWidthPx: 24,
          markerX: 4,
          markerY: 0,
          markerJustification: 'left',
        },
        spacing: { before: 0, after: 0, line: 12, lineRule: 'auto' },
        indent: { left: 48, right: 0, firstLine: 0, hanging: 24 },
      },
    };

    const singleLineListMeasure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 21,
          width: 150,
          maxWidth: 400,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
      ],
      totalHeight: 20,
      marker: {
        markerWidth: 24,
        markerTextWidth: 12,
        indentLeft: 48,
      },
    };

    const singleLineListLayout: Layout = {
      pageSize: { w: 500, h: 500 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'single-list-block',
              fromLine: 0,
              toLine: 1,
              x: 0,
              y: 0,
              width: 400,
              markerWidth: 24,
              markerTextWidth: 12,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [singleLineListBlock], measures: [singleLineListMeasure] });
    painter.paint(singleLineListLayout, mount);

    const lines = Array.from(mount.querySelectorAll('.superdoc-line')) as HTMLElement[];
    expect(lines).toHaveLength(1);
    // Single line = last line, should NOT be justified
    expect(lines[0].style.wordSpacing).toBe('');
  });

  it('does not justify last line in table cell (same as regular paragraph)', () => {
    // Word justifies text inside table cells, but skips the last line (like regular paragraphs).
    // Single-line cells are their own "last line", so they should not be justified.
    const tableBlock: TableBlock = {
      kind: 'table',
      id: 'table-block',
      rows: [
        {
          id: 'row-1',
          cells: [
            {
              id: 'cell-1',
              blocks: [
                {
                  kind: 'paragraph',
                  id: 'cell-para',
                  runs: [{ text: 'Cell text with spaces here', fontFamily: 'Arial', fontSize: 16 }],
                  attrs: { alignment: 'justify' },
                },
              ],
            },
          ],
        },
      ],
    };

    const tableMeasure: TableMeasure = {
      kind: 'table',
      rows: [
        {
          height: 30,
          cells: [
            {
              width: 200,
              height: 30,
              blocks: [
                {
                  kind: 'paragraph',
                  lines: [
                    {
                      fromRun: 0,
                      fromChar: 0,
                      toRun: 0,
                      toChar: 26,
                      width: 150,
                      maxWidth: 200,
                      ascent: 12,
                      descent: 4,
                      lineHeight: 20,
                    },
                  ],
                  totalHeight: 20,
                },
              ],
            },
          ],
        },
      ],
      columnWidths: [200],
      totalWidth: 200,
      totalHeight: 30,
    };

    const tableLayout: Layout = {
      pageSize: { w: 300, h: 300 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'table',
              blockId: 'table-block',
              x: 0,
              y: 0,
              width: 200,
              height: 30,
              fromRow: 0,
              toRow: 1,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [tableBlock], measures: [tableMeasure] });
    painter.paint(tableLayout, mount);

    // Find the line inside the table cell
    const line = mount.querySelector('.superdoc-line') as HTMLElement;
    expect(line).toBeTruthy();
    // Single-line cell = last line, so should NOT be justified
    expect(line.style.wordSpacing).toBe('');
  });

  it('justifies non-last lines in multi-line table cell', () => {
    // Word justifies text inside table cells, justifying all lines except the last.
    // This test verifies that the first line of a multi-line cell IS justified.
    const tableBlock: TableBlock = {
      kind: 'table',
      id: 'table-block',
      rows: [
        {
          id: 'row-1',
          cells: [
            {
              id: 'cell-1',
              blocks: [
                {
                  kind: 'paragraph',
                  id: 'cell-para',
                  runs: [
                    {
                      text: 'First line of text in this cell. Second line of text here.',
                      fontFamily: 'Arial',
                      fontSize: 16,
                    },
                  ],
                  attrs: { alignment: 'justify' },
                },
              ],
            },
          ],
        },
      ],
    };

    const tableMeasure: TableMeasure = {
      kind: 'table',
      rows: [
        {
          height: 50,
          cells: [
            {
              width: 200,
              height: 50,
              blocks: [
                {
                  kind: 'paragraph',
                  lines: [
                    {
                      fromRun: 0,
                      fromChar: 0,
                      toRun: 0,
                      toChar: 33,
                      width: 150,
                      maxWidth: 200,
                      ascent: 12,
                      descent: 4,
                      lineHeight: 20,
                    },
                    {
                      fromRun: 0,
                      fromChar: 33,
                      toRun: 0,
                      toChar: 59,
                      width: 140,
                      maxWidth: 200,
                      ascent: 12,
                      descent: 4,
                      lineHeight: 20,
                    },
                  ],
                  totalHeight: 40,
                },
              ],
            },
          ],
        },
      ],
      columnWidths: [200],
      totalWidth: 200,
      totalHeight: 50,
    };

    const tableLayout: Layout = {
      pageSize: { w: 300, h: 300 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'table',
              blockId: 'table-block',
              x: 0,
              y: 0,
              width: 200,
              height: 50,
              fromRow: 0,
              toRow: 1,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [tableBlock], measures: [tableMeasure] });
    painter.paint(tableLayout, mount);

    // Find both lines inside the table cell
    const lines = mount.querySelectorAll('.superdoc-line') as NodeListOf<HTMLElement>;
    expect(lines.length).toBe(2);

    // First line should be justified (non-last line)
    expect(lines[0].style.wordSpacing).not.toBe('');

    // Last line should NOT be justified
    expect(lines[1].style.wordSpacing).toBe('');
  });

  it('surfaces a missing-block error from resolveLayout when a table fragment references an unknown block', () => {
    // Previous behavior: painter rendered a placeholder for missing lookup entries.
    // New behavior: resolveLayout validates block/measure integrity upstream and throws
    // before the painter runs. Missing-block bugs are now caught at the resolved stage.
    const missingTableLayout: Layout = {
      pageSize: { w: 300, h: 300 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'table',
              blockId: 'missing-table',
              x: 0,
              y: 0,
              width: 200,
              height: 30,
              fromRow: 0,
              toRow: 1,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [], measures: [] });
    expect(() => painter.paint(missingTableLayout, mount)).toThrow(/Missing block\/measure/);
  });

  it('renders an error placeholder when table-cell line rendering throws', () => {
    const renderLineError = new Error('renderLine forced error');
    const tableBlock: TableBlock = {
      kind: 'table',
      id: 'table-err',
      rows: [
        {
          id: 'row-0',
          cells: [
            {
              id: 'cell-0',
              blocks: [
                {
                  kind: 'paragraph',
                  id: 'cell-para-err',
                  runs: [{ text: 'Cell text', fontFamily: 'Arial', fontSize: 12, pmStart: 1, pmEnd: 10 }],
                },
              ],
              attrs: {},
            },
          ],
        },
      ],
    };
    const tableMeasure: TableMeasure = {
      kind: 'table',
      rows: [
        {
          height: 24,
          cells: [
            {
              width: 120,
              height: 24,
              gridColumnStart: 0,
              blocks: [
                {
                  kind: 'paragraph',
                  lines: [
                    {
                      fromRun: 0,
                      fromChar: 0,
                      toRun: 0,
                      toChar: 9,
                      width: 60,
                      ascent: 10,
                      descent: 4,
                      lineHeight: 16,
                    },
                  ],
                  totalHeight: 16,
                },
              ],
            },
          ],
        },
      ],
      columnWidths: [120],
      totalWidth: 120,
      totalHeight: 24,
    };
    const tableLayout: Layout = {
      pageSize: { w: 400, h: 500 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'table',
              blockId: 'table-err',
              fromRow: 0,
              toRow: 1,
              x: 0,
              y: 0,
              width: 120,
              height: 24,
            },
          ],
        },
      ],
    };

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      // Intentionally empty - suppress expected error logging during this regression test.
    });
    const renderLineSpy = vi.spyOn(DomPainter.prototype as any, 'renderLine').mockImplementation(() => {
      throw renderLineError;
    });

    try {
      const painter = createTestPainter({ blocks: [tableBlock], measures: [tableMeasure] });
      expect(() => painter.paint(tableLayout, mount)).not.toThrow();

      const placeholder = mount.querySelector('.render-error-placeholder') as HTMLElement | null;
      expect(placeholder).toBeTruthy();
      expect(placeholder?.textContent).toContain('[Render Error: table-err]');
      expect(placeholder?.title).toBe('renderLine forced error');
      expect(consoleErrorSpy).toHaveBeenCalled();
    } finally {
      renderLineSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });

  it('applies negative word-spacing for compressed justify lines', () => {
    // When the measurer allows small overflow for justified text, the painter applies
    // negative word-spacing so the line still fits the available width.
    const compressBlock: ParagraphBlock = {
      kind: 'paragraph',
      id: 'compress-test',
      runs: [{ text: 'Word one two three four', fontFamily: 'Arial', fontSize: 16 }],
      attrs: { alignment: 'justify' },
    };

    // Simulate a line where natural width > maxWidth (measurer allowed overflow via compression)
    const compressMeasure: ParagraphMeasure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 14, // "Word one two t" - not last line
          width: 200, // Compressed to maxWidth
          naturalWidth: 210, // Original width before compression
          maxWidth: 200,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
        {
          fromRun: 0,
          fromChar: 14,
          toRun: 0,
          toChar: 24, // rest of text - last line
          width: 80,
          maxWidth: 200,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
      ],
      totalHeight: 40,
    };

    const compressLayout: Layout = {
      pageSize: { w: 300, h: 300 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'compress-test',
              x: 0,
              y: 0,
              width: 200,
              fromLine: 0,
              toLine: 2,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [compressBlock], measures: [compressMeasure] });
    painter.paint(compressLayout, mount);

    const lines = mount.querySelectorAll('.superdoc-line') as NodeListOf<HTMLElement>;
    expect(lines.length).toBe(2);

    // First line should have negative word-spacing applied
    expect(Number.parseFloat(lines[0].style.wordSpacing)).toBeCloseTo(-3.3333333333333335, 5);

    // Last line should NOT be justified
    expect(lines[1].style.wordSpacing).toBe('');
  });

  it('handles negative indents correctly with justify alignment', () => {
    // Regression test: When a paragraph has negative indents, the layout engine expands
    // fragment.width to include the negative indent area. The painter should NOT subtract
    // negative indents again (which would cause text overflow).
    const negativeIndentBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'negative-indent-test',
      runs: [{ text: 'This text has negative left indent to extend into margin', fontFamily: 'Arial', fontSize: 16 }],
      attrs: {
        alignment: 'justify',
        indent: {
          left: -18, // Negative indent extends 18px into left margin
          right: 0,
          firstLine: 0,
          hanging: 0,
        },
      },
    };

    // Fragment width (594px) already includes the negative indent expansion.
    // The painter should justify to 594px, NOT 594 - (-18) = 612px.
    const negativeIndentMeasure: ParagraphMeasure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 30, // "This text has negative left i" - not last line
          width: 594,
          maxWidth: 594,
          naturalWidth: 580, // Natural width < maxWidth, will expand
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
        {
          fromRun: 0,
          fromChar: 30,
          toRun: 0,
          toChar: 58, // rest of text - last line
          width: 350,
          maxWidth: 594,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
      ],
      totalHeight: 40,
    };

    const negativeIndentLayout: Layout = {
      pageSize: { w: 612, h: 792 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'negative-indent-test',
              x: 54, // Page left margin is 72px, negative indent of -18px puts fragment at 72-18=54px
              y: 0,
              width: 594, // Fragment width includes the negative indent expansion
              fromLine: 0,
              toLine: 2,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [negativeIndentBlock], measures: [negativeIndentMeasure] });
    painter.paint(negativeIndentLayout, mount);

    const lines = mount.querySelectorAll('.superdoc-line') as NodeListOf<HTMLElement>;
    expect(lines.length).toBe(2);

    // First line should be justified with positive word-spacing (expanding from 580 to 594)
    const firstLineWordSpacing = parseFloat(lines[0].style.wordSpacing);
    expect(firstLineWordSpacing).toBeGreaterThan(0);
    // Word spacing should be reasonable - expanding 14px across ~6 spaces = ~2.33px per space
    expect(firstLineWordSpacing).toBeLessThan(5);

    // Last line should NOT be justified
    expect(lines[1].style.wordSpacing).toBe('');

    // Verify the fragment has the correct width (should be 594px, not expanded to 612px)
    const fragment = mount.querySelector('.superdoc-fragment') as HTMLElement;
    expect(fragment.style.width).toBe('594px');
  });

  it('emits pm metadata attributes', () => {
    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    const fragment = mount.querySelector('.superdoc-fragment') as HTMLElement;
    expect(fragment.dataset.pmStart).toBe('1');
    expect(fragment.dataset.pmEnd).toBe('12');
    const line = mount.querySelector('.superdoc-line') as HTMLElement;
    expect(line.dataset.pmStart).toBe('1');
    expect(line.dataset.pmEnd).toBe('12');
    const runSpans = mount.querySelectorAll('.superdoc-line span');
    expect(runSpans[0].dataset.pmStart).toBe('1');
    expect(runSpans[0].dataset.pmEnd).toBe('7');
    expect(runSpans[1].dataset.pmStart).toBe('7');
    expect(runSpans[1].dataset.pmEnd).toBe('12');
  });

  it('throws if blocks and measures length mismatch', () => {
    // Block/measure integrity is now validated at the resolve-layout stage.
    const painter = createTestPainter({ blocks: [block], measures: [] });
    expect(() => painter.paint(layout, mount)).toThrow();
  });

  it('renders placeholder content for empty lines', () => {
    const blockWithEmptyRun: FlowBlock = {
      kind: 'paragraph',
      id: 'empty-block',
      runs: [{ text: '', fontFamily: 'Arial', fontSize: 16 }],
    };
    const measureWithEmptyLine: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 0,
          width: 0,
          ascent: 0,
          descent: 0,
          lineHeight: 18,
        },
      ],
      totalHeight: 18,
    };
    const emptyLayout: Layout = {
      pageSize: layout.pageSize,
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'empty-block',
              fromLine: 0,
              toLine: 1,
              x: 10,
              y: 10,
              width: 200,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({
      blocks: [blockWithEmptyRun],
      measures: [measureWithEmptyLine],
    });
    painter.paint(emptyLayout, mount);

    const line = mount.querySelector('.superdoc-line');
    expect(line?.textContent).toBe('\u00A0');
  });

  it('annotates placeholder spans for empty lines with pm positions', () => {
    const blockWithEmptyRun: FlowBlock = {
      kind: 'paragraph',
      id: 'empty-block',
      runs: [{ text: '', fontFamily: 'Arial', fontSize: 16, pmStart: 1, pmEnd: 1 }],
    };
    const measureWithEmptyLine: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 0,
          width: 0,
          ascent: 0,
          descent: 0,
          lineHeight: 18,
        },
      ],
      totalHeight: 18,
    };
    const emptyLayout: Layout = {
      pageSize: layout.pageSize,
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'empty-block',
              fromLine: 0,
              toLine: 1,
              x: 10,
              y: 10,
              width: 200,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({
      blocks: [blockWithEmptyRun],
      measures: [measureWithEmptyLine],
    });
    painter.paint(emptyLayout, mount);

    const emptySpan = mount.querySelector('.superdoc-line span.superdoc-empty-run') as HTMLElement | null;
    expect(emptySpan?.dataset.pmStart).toBe('1');
    expect(emptySpan?.dataset.pmEnd).toBe('1');
    // Empty-run must set explicit fontSize so it doesn't inherit fontSize:0 from the line
    expect(emptySpan?.style.fontSize).toBe('18px');
  });

  it('sets fallback fontSize on field annotation without explicit fontSize', () => {
    const block: FlowBlock = {
      kind: 'paragraph',
      id: 'fa-no-fontsize',
      runs: [
        {
          kind: 'fieldAnnotation',
          variant: 'text',
          displayLabel: 'Client Name',
          fieldId: 'F1',
          fieldType: 'text',
          fieldColor: '#980043',
          pmStart: 0,
          pmEnd: 1,
        },
      ],
    };
    const measure: Measure = {
      kind: 'paragraph',
      lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 0, width: 100, ascent: 12, descent: 4, lineHeight: 20 }],
      totalHeight: 20,
    };
    const testLayout: Layout = {
      pageSize: layout.pageSize,
      pages: [
        {
          number: 1,
          fragments: [{ kind: 'para', blockId: 'fa-no-fontsize', fromLine: 0, toLine: 1, x: 10, y: 10, width: 200 }],
        },
      ],
    };
    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(testLayout, mount);

    const annotation = mount.querySelector('.annotation') as HTMLElement | null;
    // Must always set fontSize so it doesn't inherit fontSize:0 from the line.
    // Falls back to 16px (browser default) when run has no explicit fontSize.
    expect(annotation?.style.fontSize).toBe('16px');
  });

  it('converts numeric fontSize to pt on field annotation', () => {
    const block: FlowBlock = {
      kind: 'paragraph',
      id: 'fa-numeric-fontsize',
      runs: [
        {
          kind: 'fieldAnnotation',
          variant: 'text',
          displayLabel: 'Client Name',
          fieldId: 'F1',
          fieldType: 'text',
          fieldColor: '#980043',
          fontSize: 14,
          pmStart: 0,
          pmEnd: 1,
        },
      ],
    };
    const measure: Measure = {
      kind: 'paragraph',
      lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 0, width: 100, ascent: 12, descent: 4, lineHeight: 20 }],
      totalHeight: 20,
    };
    const testLayout: Layout = {
      pageSize: layout.pageSize,
      pages: [
        {
          number: 1,
          fragments: [
            { kind: 'para', blockId: 'fa-numeric-fontsize', fromLine: 0, toLine: 1, x: 10, y: 10, width: 200 },
          ],
        },
      ],
    };
    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(testLayout, mount);

    const annotation = mount.querySelector('.annotation') as HTMLElement | null;
    // Numeric fontSize is converted to pt units.
    expect(annotation?.style.fontSize).toBe('14pt');
  });

  it('renders field annotation images with non-base64 SVG data URLs', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10"/></svg>';
    const imageSrc = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    const block: FlowBlock = {
      kind: 'paragraph',
      id: 'fa-svg-image',
      runs: [
        {
          kind: 'fieldAnnotation',
          variant: 'signature',
          displayLabel: 'Signature',
          fieldId: 'F1',
          fieldType: 'signer',
          fieldColor: '#980043',
          imageSrc,
          pmStart: 0,
          pmEnd: 1,
        },
      ],
    };
    const measure: Measure = {
      kind: 'paragraph',
      lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 0, width: 100, ascent: 12, descent: 4, lineHeight: 20 }],
      totalHeight: 20,
    };
    const testLayout: Layout = {
      pageSize: layout.pageSize,
      pages: [
        {
          number: 1,
          fragments: [{ kind: 'para', blockId: 'fa-svg-image', fromLine: 0, toLine: 1, x: 10, y: 10, width: 200 }],
        },
      ],
    };
    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(testLayout, mount);

    const img = mount.querySelector('.annotation img') as HTMLImageElement | null;
    expect(img).toBeTruthy();
    expect(img?.src).toBe(imageSrc);
    expect(img?.alt).toBe('Signature');
  });

  it('sets explicit fontSize on math run wrapper', () => {
    const block: FlowBlock = {
      kind: 'paragraph',
      id: 'math-block',
      runs: [
        {
          kind: 'math',
          ommlJson: {},
          textContent: 'x+1',
          width: 40,
          height: 14,
          pmStart: 0,
          pmEnd: 1,
        },
      ],
    };
    const measure: Measure = {
      kind: 'paragraph',
      lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 0, width: 40, ascent: 10, descent: 4, lineHeight: 18 }],
      totalHeight: 18,
    };
    const testLayout: Layout = {
      pageSize: layout.pageSize,
      pages: [
        {
          number: 1,
          fragments: [{ kind: 'para', blockId: 'math-block', fromLine: 0, toLine: 1, x: 10, y: 10, width: 200 }],
        },
      ],
    };
    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(testLayout, mount);

    const mathWrapper = mount.querySelector('.sd-math') as HTMLElement | null;
    // Must set fontSize so fallback text doesn't inherit fontSize:0 from the line.
    // Uses browser default (16px) rather than run.height, which would render tall
    // expressions at 80–100px for the plain-text fallback path.
    expect(mathWrapper?.style.fontSize).toBe('16px');
  });

  it('renders image fragments', () => {
    const imageBlock: FlowBlock = {
      kind: 'image',
      id: 'img-block',
      src: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/',
      width: 150,
      height: 100,
    };
    const imageMeasure: Measure = {
      kind: 'image',
      width: 150,
      height: 100,
    };
    const imageLayout: Layout = {
      pageSize: layout.pageSize,
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'image',
              blockId: 'img-block',
              x: 20,
              y: 30,
              width: 150,
              height: 100,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [imageBlock], measures: [imageMeasure] });
    painter.paint(imageLayout, mount);

    const img = mount.querySelector('img');
    expect(img).toBeTruthy();
    expect(img?.src).toContain('data:image/jpeg');
    expect((img?.parentElement as HTMLElement).style.left).toBe('20px');
  });

  it('preserves clip-path zoom while applying rotation on anchored image fragments', () => {
    const clipPath = 'inset(10% 20% 30% 40%)';
    const imageBlock: FlowBlock = {
      kind: 'image',
      id: 'img-block',
      src: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/',
      width: 150,
      height: 100,
      rotation: 15,
      attrs: {
        clipPath,
      },
    };
    const imageMeasure: Measure = {
      kind: 'image',
      width: 150,
      height: 100,
    };
    const imageLayout: Layout = {
      pageSize: layout.pageSize,
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'image',
              blockId: 'img-block',
              x: 20,
              y: 30,
              width: 150,
              height: 100,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [imageBlock], measures: [imageMeasure] });
    painter.paint(imageLayout, mount);

    const fragmentEl = mount.querySelector('.superdoc-image-fragment') as HTMLElement | null;
    const img = fragmentEl?.querySelector('img') as HTMLElement | null;
    expect(fragmentEl).toBeTruthy();
    expect(img).toBeTruthy();
    expect(fragmentEl?.style.overflow).toBe('hidden');
    expect(fragmentEl?.style.transform).toContain('rotate(15deg)');
    expect(img?.style.clipPath).toBe(clipPath);
    expect(img?.style.transformOrigin).toBe('0 0');
    expect(img?.style.transform).toMatch(/translate\([-\d.]+%,\s*[-\d.]+%\)\s*scale\([-\d.]+,\s*[-\d.]+\)/);
  });

  it('annotates fragments and runs with SDT metadata', () => {
    const painter = createTestPainter({ blocks: [sdtBlock], measures: [sdtMeasure] });
    painter.paint(sdtLayout, mount);

    const fragment = mount.querySelector('.superdoc-fragment') as HTMLElement;
    expect(fragment.dataset.sdtType).toBe('structuredContent');
    expect(fragment.dataset.sdtId).toBe('SC-1');
    expect(fragment.dataset.sdtTag).toBe('client_inline');
    expect(fragment.dataset.sdtAlias).toBe('Client Data');

    const runSpans = mount.querySelectorAll('.superdoc-line span');
    const fieldSpan = runSpans[runSpans.length - 1] as HTMLElement;
    expect(fieldSpan.dataset.sdtType).toBe('fieldAnnotation');
    expect(fieldSpan.dataset.sdtFieldId).toBe('FIELD-1');
    expect(fieldSpan.dataset.sdtFieldVariant).toBe('text');
  });

  it('annotates documentSection fragments with section metadata', () => {
    const sectionBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'section-para',
      runs: [{ text: 'Confidential terms', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 18 }],
      attrs: {
        sdt: {
          type: 'documentSection',
          id: 'section-1',
          title: 'Locked Section',
          description: 'Confidential clause',
          sectionType: 'locked',
          isLocked: true,
        },
      },
    };

    const sectionMeasure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 18,
          width: 120,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
      ],
      totalHeight: 20,
    };

    const sectionLayout: Layout = {
      pageSize: { w: 400, h: 500 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'section-para',
              fromLine: 0,
              toLine: 1,
              x: 20,
              y: 30,
              width: 320,
              pmStart: 0,
              pmEnd: 18,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [sectionBlock], measures: [sectionMeasure] });
    painter.paint(sectionLayout, mount);

    const fragment = mount.querySelector('.superdoc-fragment') as HTMLElement;
    expect(fragment.dataset.sdtType).toBe('documentSection');
    expect(fragment.dataset.sdtId).toBe('section-1');
    expect(fragment.dataset.sdtSectionTitle).toBe('Locked Section');
    expect(fragment.dataset.sdtSectionType).toBe('locked');
    expect(fragment.dataset.sdtSectionLocked).toBe('true');
  });

  it('keeps documentSection tooltip when contentControlsChrome is none', () => {
    const sectionBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'section-para-tooltip',
      runs: [{ text: 'Confidential terms', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 18 }],
      attrs: {
        sdt: {
          type: 'documentSection',
          id: 'section-2',
          title: 'Locked Section',
          description: 'Confidential clause',
          sectionType: 'locked',
          isLocked: true,
        },
      },
    };

    const sectionMeasure: Measure = {
      kind: 'paragraph',
      lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 18, width: 120, ascent: 12, descent: 4, lineHeight: 20 }],
      totalHeight: 20,
    };

    const sectionLayout: Layout = {
      pageSize: { w: 400, h: 500 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'section-para-tooltip',
              fromLine: 0,
              toLine: 1,
              x: 20,
              y: 30,
              width: 320,
              pmStart: 0,
              pmEnd: 18,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({
      blocks: [sectionBlock],
      measures: [sectionMeasure],
      contentControlsChrome: 'none',
    });
    painter.paint(sectionLayout, mount);

    expect(mount.classList.contains('superdoc-cc-chrome-none')).toBe(true);
    expect(mount.querySelector('.superdoc-document-section__tooltip')).toBeTruthy();
  });

  it('annotates fragments with both primary SDT and container SDT metadata', () => {
    // Test case: TOC paragraph inside a documentSection
    // Should have docPart metadata as primary (data-sdt-*) and section as container (data-sdt-container-*)
    const tocBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'toc-in-section',
      runs: [{ text: 'TOC Entry', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 9 }],
      attrs: {
        isTocEntry: true,
        sdt: {
          type: 'docPartObject',
          gallery: 'Table of Contents',
          uniqueId: 'toc-1',
          instruction: 'TOC \\o "1-3"',
          alias: null,
        },
        containerSdt: {
          type: 'documentSection',
          id: 'locked-section',
          title: 'Locked TOC Section',
          description: null,
          sectionType: 'locked',
          isLocked: true,
          sdBlockId: null,
        },
      },
    };

    const tocMeasure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 9,
          width: 100,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
      ],
      totalHeight: 20,
    };

    const tocLayout: Layout = {
      pageSize: { w: 612, h: 792 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'toc-in-section',
              fromLine: 0,
              toLine: 1,
              x: 30,
              y: 40,
              width: 552,
              pmStart: 0,
              pmEnd: 9,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [tocBlock], measures: [tocMeasure] });
    painter.paint(tocLayout, mount);

    const fragment = mount.querySelector('.superdoc-fragment') as HTMLElement;

    // Primary SDT metadata (docPart)
    expect(fragment.dataset.sdtType).toBe('docPartObject');
    expect(fragment.dataset.sdtDocpartGallery).toBe('Table of Contents');
    expect(fragment.dataset.sdtDocpartId).toBe('toc-1');
    expect(fragment.dataset.sdtDocpartInstruction).toBe('TOC \\o "1-3"');

    // Container SDT metadata (documentSection)
    expect(fragment.dataset.sdtContainerType).toBe('documentSection');
    expect(fragment.dataset.sdtContainerId).toBe('locked-section');
    expect(fragment.dataset.sdtContainerSectionTitle).toBe('Locked TOC Section');
    expect(fragment.dataset.sdtContainerSectionType).toBe('locked');
    expect(fragment.dataset.sdtContainerSectionLocked).toBe('true');
  });

  it('wraps inline structuredContent runs in container element and groups adjacent runs with same SDT id', () => {
    // Test case: Multiple runs with the same inline SDT id should be grouped into ONE wrapper
    const inlineScBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'inline-sc-para',
      runs: [
        { text: 'Before ', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 7 },
        {
          text: 'controlled',
          fontFamily: 'Arial',
          fontSize: 16,
          pmStart: 7,
          pmEnd: 17,
          sdt: {
            type: 'structuredContent',
            scope: 'inline',
            id: 'sc-inline-1',
            tag: 'dropdown',
            alias: 'Test Dropdown',
          },
        },
        {
          text: ' ',
          fontFamily: 'Arial',
          fontSize: 16,
          pmStart: 17,
          pmEnd: 18,
          sdt: {
            type: 'structuredContent',
            scope: 'inline',
            id: 'sc-inline-1',
            tag: 'dropdown',
            alias: 'Test Dropdown',
          },
        },
        {
          text: 'text',
          fontFamily: 'Arial',
          fontSize: 16,
          pmStart: 18,
          pmEnd: 22,
          sdt: {
            type: 'structuredContent',
            scope: 'inline',
            id: 'sc-inline-1',
            tag: 'dropdown',
            alias: 'Test Dropdown',
          },
        },
        { text: ' after', fontFamily: 'Arial', fontSize: 16, pmStart: 22, pmEnd: 28 },
      ],
      attrs: {},
    };

    const inlineScMeasure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 4,
          toChar: 6,
          width: 200,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
      ],
      totalHeight: 20,
    };

    const inlineScLayout: Layout = {
      pageSize: { w: 612, h: 792 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'inline-sc-para',
              fromLine: 0,
              toLine: 1,
              x: 30,
              y: 40,
              width: 552,
              pmStart: 0,
              pmEnd: 28,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [inlineScBlock], measures: [inlineScMeasure] });
    painter.paint(inlineScLayout, mount);

    // Should have exactly ONE wrapper for the grouped runs
    const wrappers = mount.querySelectorAll('.superdoc-structured-content-inline');
    expect(wrappers.length).toBe(1);

    const wrapper = wrappers[0] as HTMLElement;
    expect(wrapper.tagName.toLowerCase()).toBe('span');
    expect(wrapper.dataset.sdtType).toBe('structuredContent');
    expect(wrapper.dataset.sdtScope).toBe('inline');
    expect(wrapper.dataset.sdtId).toBe('sc-inline-1');
    expect(wrapper.dataset.sdtTag).toBe('dropdown');
    expect(wrapper.dataset.containsInlineImage).toBeUndefined();

    // The wrapper should span all contained runs (pmStart=7 to pmEnd=22)
    expect(wrapper.dataset.pmStart).toBe('7');
    expect(wrapper.dataset.pmEnd).toBe('22');

    // The wrapper should contain all three inner text spans plus the label span
    const innerSpans = wrapper.querySelectorAll('span');
    expect(innerSpans.length).toBe(4); // 3 text spans + 1 label span

    // Verify the label span exists
    const labelSpan = wrapper.querySelector('.superdoc-structured-content-inline__label');
    expect(labelSpan).toBeTruthy();

    // Verify text content (label text + run text)
    expect(wrapper.textContent).toContain('controlled text');
  });

  it('marks inline structuredContent wrappers that contain inline images', () => {
    const block: FlowBlock = {
      kind: 'paragraph',
      id: 'inline-sc-image',
      runs: [
        { text: 'Before ', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 7 },
        {
          text: 'Caption ',
          fontFamily: 'Arial',
          fontSize: 16,
          pmStart: 7,
          pmEnd: 15,
          sdt: {
            type: 'structuredContent',
            scope: 'inline',
            id: 'sc-inline-image',
            alias: 'Image control',
          },
        },
        {
          kind: 'image',
          src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          width: 40,
          height: 40,
          pmStart: 15,
          pmEnd: 16,
          sdt: {
            type: 'structuredContent',
            scope: 'inline',
            id: 'sc-inline-image',
            alias: 'Image control',
          },
        },
        {
          text: ' after',
          fontFamily: 'Arial',
          fontSize: 16,
          pmStart: 16,
          pmEnd: 22,
          sdt: {
            type: 'structuredContent',
            scope: 'inline',
            id: 'sc-inline-image',
            alias: 'Image control',
          },
        },
      ],
      attrs: {},
    };

    const measure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 3,
          toChar: 6,
          width: 160,
          ascent: 40,
          descent: 0,
          lineHeight: 40,
        },
      ],
      totalHeight: 40,
    };

    const layout: Layout = {
      pageSize: { w: 612, h: 792 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'inline-sc-image',
              fromLine: 0,
              toLine: 1,
              x: 30,
              y: 40,
              width: 552,
              pmStart: 0,
              pmEnd: 22,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    const wrapper = mount.querySelector(
      '.superdoc-structured-content-inline[data-sdt-id="sc-inline-image"]',
    ) as HTMLElement | null;
    expect(wrapper).toBeTruthy();
    expect(wrapper?.dataset.containsInlineImage).toBe('true');
    expect(wrapper?.querySelector('.superdoc-inline-image')).toBeTruthy();
    expect(wrapper?.dataset.pmStart).toBe('7');
    expect(wrapper?.dataset.pmEnd).toBe('22');
  });

  it('omits inline content-control label when contentControlsChrome is none', () => {
    const inlineScBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'inline-sc-no-chrome',
      runs: [
        { text: 'Before ', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 7 },
        {
          text: 'controlled',
          fontFamily: 'Arial',
          fontSize: 16,
          pmStart: 7,
          pmEnd: 17,
          sdt: {
            type: 'structuredContent',
            scope: 'inline',
            id: 'sc-inline-none',
            tag: 'dropdown',
            alias: 'Test Dropdown',
          },
        },
        { text: ' after', fontFamily: 'Arial', fontSize: 16, pmStart: 17, pmEnd: 23 },
      ],
      attrs: {},
    };

    const inlineScMeasure: Measure = {
      kind: 'paragraph',
      lines: [{ fromRun: 0, fromChar: 0, toRun: 2, toChar: 6, width: 200, ascent: 12, descent: 4, lineHeight: 20 }],
      totalHeight: 20,
    };

    const inlineScLayout: Layout = {
      pageSize: { w: 612, h: 792 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'inline-sc-no-chrome',
              fromLine: 0,
              toLine: 1,
              x: 30,
              y: 40,
              width: 552,
              pmStart: 0,
              pmEnd: 23,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({
      blocks: [inlineScBlock],
      measures: [inlineScMeasure],
      contentControlsChrome: 'none',
    });
    painter.paint(inlineScLayout, mount);

    const wrapper = mount.querySelector(
      '.superdoc-structured-content-inline[data-sdt-id="sc-inline-none"]',
    ) as HTMLElement | null;
    expect(wrapper).toBeTruthy();
    if (!wrapper) return;
    expect(wrapper.querySelector('.superdoc-structured-content-inline__label')).toBeNull();
  });

  it('omits chrome and alias label when inline SDT appearance is hidden (SD-3110)', () => {
    // ECMA-376 `<w15:appearance w15:val="hidden"/>` should render the
    // SDT transparently: no padding/border/label, and the alias text
    // MUST NOT appear in DOM textContent (copy-paste / screen reader
    // leak otherwise).
    const block: FlowBlock = {
      kind: 'paragraph',
      id: 'inline-sc-hidden',
      runs: [
        { text: 'See ', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 4 },
        {
          text: 'Alpha Corp v. SEC',
          fontFamily: 'Arial',
          fontSize: 16,
          pmStart: 4,
          pmEnd: 21,
          sdt: {
            type: 'structuredContent',
            scope: 'inline',
            id: 'sc-hidden-1',
            tag: 'citation',
            alias: 'Harvey citation',
            appearance: 'hidden',
          },
        },
        { text: ' today.', fontFamily: 'Arial', fontSize: 16, pmStart: 21, pmEnd: 28 },
      ],
      attrs: {},
    };

    const measure: Measure = {
      kind: 'paragraph',
      lines: [{ fromRun: 0, fromChar: 0, toRun: 2, toChar: 7, width: 200, ascent: 12, descent: 4, lineHeight: 20 }],
      totalHeight: 20,
    };

    const layout: Layout = {
      pageSize: { w: 612, h: 792 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'inline-sc-hidden',
              fromLine: 0,
              toLine: 1,
              x: 30,
              y: 40,
              width: 552,
              pmStart: 0,
              pmEnd: 28,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    const wrapper = mount.querySelector(
      '.superdoc-structured-content-inline[data-sdt-id="sc-hidden-1"]',
    ) as HTMLElement | null;
    expect(wrapper).toBeTruthy();
    if (!wrapper) return;

    // data-appearance="hidden" is the hook CSS uses to drop chrome.
    expect(wrapper.dataset.appearance).toBe('hidden');

    // No alias label child. It must not be in the DOM at all.
    expect(wrapper.querySelector('.superdoc-structured-content-inline__label')).toBeNull();

    // textContent of the wrapper must equal exactly the wrapped phrase,
    // with no alias text leaked in.
    expect(wrapper.textContent).toBe('Alpha Corp v. SEC');
    expect(wrapper.textContent).not.toContain('Harvey citation');
  });

  it('renders a visible wrapper for an empty inline SDT placeholder', () => {
    const block: FlowBlock = {
      kind: 'paragraph',
      id: 'inline-sc-empty',
      runs: [
        { text: 'Before ', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 7 },
        {
          kind: 'text',
          text: '',
          fontFamily: 'Arial',
          fontSize: 16,
          pmStart: 8,
          pmEnd: 8,
          visualPlaceholder: 'emptyInlineSdt',
          sdt: {
            type: 'structuredContent',
            scope: 'inline',
            id: 'sc-empty-1',
            alias: 'Empty SDT',
          },
        },
        { text: ' after', fontFamily: 'Arial', fontSize: 16, pmStart: 8, pmEnd: 14 },
      ],
      attrs: {},
    };

    const measure: Measure = {
      kind: 'paragraph',
      lines: [{ fromRun: 0, fromChar: 0, toRun: 2, toChar: 6, width: 120, ascent: 12, descent: 4, lineHeight: 20 }],
      totalHeight: 20,
    };

    const layout: Layout = {
      pageSize: { w: 612, h: 792 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'inline-sc-empty',
              fromLine: 0,
              toLine: 1,
              x: 30,
              y: 40,
              width: 552,
              pmStart: 0,
              pmEnd: 14,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    const wrapper = mount.querySelector(
      '.superdoc-structured-content-inline[data-sdt-id="sc-empty-1"]',
    ) as HTMLElement | null;
    expect(wrapper).toBeTruthy();
    expect(wrapper?.dataset.empty).toBe('true');
    expect(wrapper?.dataset.pmStart).toBe('8');
    expect(wrapper?.dataset.pmEnd).toBe('8');
    const placeholder = wrapper?.querySelector('.superdoc-empty-inline-sdt-placeholder') as HTMLElement | null;
    expect(placeholder).toBeTruthy();
    expect(placeholder?.classList.contains('superdoc-empty-sdt-placeholder')).toBe(true);
    expect(placeholder?.dataset.placeholderText).toBe('Click or tap here to enter text');
    expect(wrapper?.textContent).not.toContain('old content');
    expect(wrapper?.textContent).not.toContain('Click or tap here to enter text');
  });

  it('renders placeholder chrome for an empty block SDT without adding document text', () => {
    const sdt = {
      type: 'structuredContent',
      scope: 'block',
      id: 'sc-block-empty-1',
      alias: 'Empty block',
    } as const;
    const block: FlowBlock = {
      kind: 'paragraph',
      id: 'block-sc-empty',
      runs: [
        {
          kind: 'text',
          text: '',
          fontFamily: 'Arial',
          fontSize: 16,
          pmStart: 4,
          pmEnd: 4,
          visualPlaceholder: 'emptyBlockSdt',
          sdt,
        },
      ],
      attrs: { sdt },
    };

    const measure: Measure = {
      kind: 'paragraph',
      lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 0, width: 220, ascent: 12, descent: 4, lineHeight: 20 }],
      totalHeight: 20,
    };

    const layout: Layout = {
      pageSize: { w: 612, h: 792 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'block-sc-empty',
              fromLine: 0,
              toLine: 1,
              x: 30,
              y: 40,
              width: 552,
              pmStart: 3,
              pmEnd: 5,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    const fragment = mount.querySelector(
      '.superdoc-structured-content-block[data-sdt-id="sc-block-empty-1"]',
    ) as HTMLElement | null;
    const placeholder = fragment?.querySelector('.superdoc-empty-block-sdt-placeholder') as HTMLElement | null;

    expect(fragment).toBeTruthy();
    expect(placeholder).toBeTruthy();
    expect(placeholder?.classList.contains('superdoc-empty-sdt-placeholder')).toBe(true);
    expect(placeholder?.dataset.placeholderText).toBe('Click or tap here to enter text');
    expect(placeholder?.dataset.pmStart).toBe('4');
    expect(placeholder?.dataset.pmEnd).toBe('4');
    // Painted with the resolved PHYSICAL family (Arial -> Liberation Sans), like all
    // painted text - the placeholder chrome goes through the same paint path. The logical
    // family is preserved for export, not in painted DOM. Quoted because the serialized
    // CSS value wraps a multi-word family name.
    expect(placeholder?.style.fontFamily).toBe('"Liberation Sans"');
    expect(placeholder?.style.fontSize).toBe('16px');
    expect(fragment?.style.getPropertyValue('--sd-sdt-chrome-left')).toBe('0px');
    expect(fragment?.style.getPropertyValue('--sd-sdt-chrome-width')).toBe('220px');
    expect(fragment?.textContent).not.toContain('Click or tap here to enter text');
  });

  it('marks hidden empty block SDT wrappers so placeholder chrome can be suppressed', () => {
    const sdt = {
      type: 'structuredContent',
      scope: 'block',
      id: 'sc-block-hidden-empty-1',
      alias: 'Hidden empty block',
      appearance: 'hidden',
    } as const;
    const block: FlowBlock = {
      kind: 'paragraph',
      id: 'block-sc-hidden-empty',
      runs: [
        {
          kind: 'text',
          text: '',
          fontFamily: 'Arial',
          fontSize: 16,
          pmStart: 4,
          pmEnd: 4,
          visualPlaceholder: 'emptyBlockSdt',
          sdt,
        },
      ],
      attrs: { sdt },
    };

    const measure: Measure = {
      kind: 'paragraph',
      lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 0, width: 0, ascent: 12, descent: 4, lineHeight: 20 }],
      totalHeight: 20,
    };

    const layout: Layout = {
      pageSize: { w: 612, h: 792 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'block-sc-hidden-empty',
              fromLine: 0,
              toLine: 1,
              x: 30,
              y: 40,
              width: 552,
              pmStart: 3,
              pmEnd: 5,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    const fragment = mount.querySelector('[data-sdt-id="sc-block-hidden-empty-1"]') as HTMLElement | null;

    expect(fragment).toBeTruthy();
    expect(fragment?.dataset.appearance).toBe('hidden');
    expect(fragment?.classList.contains('superdoc-structured-content-block')).toBe(false);
    expect(fragment?.querySelector('.superdoc-structured-content__label')).toBeNull();
  });

  it('keeps inline SDT wrapper font-size in sync when run font-size changes', () => {
    const block: FlowBlock = {
      kind: 'paragraph',
      id: 'inline-sdt-font-sync',
      runs: [
        {
          text: 'Company Address',
          fontFamily: 'Arial, sans-serif',
          fontSize: 14.6667,
          pmStart: 2044,
          pmEnd: 2059,
          sdt: {
            type: 'structuredContent',
            scope: 'inline',
            id: '574416526',
            tag: 'inline_text_sdt',
            alias: 'Company Address',
            lockMode: 'unlocked',
          },
        },
      ],
      attrs: {},
    };

    const measure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 15,
          width: 180,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
      ],
      totalHeight: 20,
    };

    const layout: Layout = {
      pageSize: { w: 612, h: 792 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'inline-sdt-font-sync',
              fromLine: 0,
              toLine: 1,
              x: 30,
              y: 40,
              width: 552,
              pmStart: 2044,
              pmEnd: 2059,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    const getInlineSdtWrapper = () =>
      mount.querySelector('.superdoc-structured-content-inline[data-sdt-id="574416526"]') as HTMLElement | null;

    const wrapperBefore = getInlineSdtWrapper();
    expect(wrapperBefore).toBeTruthy();
    expect(wrapperBefore?.style.fontSize).toBe('14.6667px');

    const updatedBlock: FlowBlock = {
      ...block,
      runs: [
        {
          ...block.runs[0],
          fontSize: 10,
        },
      ],
    };

    painter.setData([updatedBlock], [measure]);
    painter.paint(layout, mount);

    const wrapperAfter = getInlineSdtWrapper();
    expect(wrapperAfter).toBeTruthy();
    expect(wrapperAfter?.style.fontSize).toBe('10px');
  });

  it('keeps segment-positioned inline SDT text aligned with adjacent plain runs', () => {
    const block: FlowBlock = {
      kind: 'paragraph',
      id: 'segment-positioned-inline-sdt-baseline',
      runs: [
        { text: 'KvK', fontFamily: 'Arial, sans-serif', fontSize: 16, pmStart: 0, pmEnd: 3 },
        { kind: 'tab', text: '\t', width: 48, fontSize: 16 },
        {
          text: 'KvK_number',
          fontFamily: 'Arial, sans-serif',
          fontSize: 16,
          pmStart: 4,
          pmEnd: 14,
          sdt: {
            type: 'structuredContent',
            scope: 'inline',
            id: 'header-value-sdt',
            tag: 'inline_text_sdt',
            alias: 'Header value',
            lockMode: 'unlocked',
          },
        },
      ],
      attrs: {},
    };

    const measure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 2,
          toChar: 10,
          width: 140,
          maxWidth: 300,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
          segments: [
            { runIndex: 0, fromChar: 0, toChar: 3, width: 28 },
            { runIndex: 2, fromChar: 0, toChar: 10, width: 92, x: 80 },
          ],
        },
      ],
      totalHeight: 20,
    };

    const layout: Layout = {
      pageSize: { w: 612, h: 792 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'segment-positioned-inline-sdt-baseline',
              fromLine: 0,
              toLine: 1,
              x: 30,
              y: 40,
              width: 552,
              pmStart: 0,
              pmEnd: 14,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    const wrapper = mount.querySelector(
      '.superdoc-structured-content-inline[data-sdt-id="header-value-sdt"]',
    ) as HTMLElement | null;
    expect(wrapper).toBeTruthy();
    expect(wrapper?.style.padding).toBe('0px');
    expect(wrapper?.style.borderWidth).toBe('0px');
    expect(wrapper?.style.lineHeight).toBe('20px');

    const value = wrapper?.querySelector('[data-pm-start="4"]') as HTMLElement | null;
    expect(value).toBeTruthy();
    expect(value?.style.left).toBe('0px');
    expect(value?.style.top).toBe('0px');
  });

  it('wraps only highlighted tracked text on the segment-positioned path', () => {
    const block: FlowBlock = {
      kind: 'paragraph',
      id: 'segment-positioned-tracked-tab-highlight',
      runs: [
        { text: 'Name', fontFamily: 'Arial, sans-serif', fontSize: 16, pmStart: 0, pmEnd: 4 },
        { kind: 'tab', text: '\t', width: 48, fontSize: 16, pmStart: 4, pmEnd: 5 },
        {
          text: 'Value',
          fontFamily: 'Arial, sans-serif',
          fontSize: 16,
          pmStart: 5,
          pmEnd: 10,
          trackedChange: { kind: 'insert', id: 'tracked-value' },
        },
      ],
      attrs: {
        trackedChangesMode: 'review',
        trackedChangesEnabled: true,
      },
    };

    const measure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 2,
          toChar: 5,
          width: 120,
          maxWidth: 300,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
          segments: [
            { runIndex: 0, fromChar: 0, toChar: 4, width: 40 },
            { runIndex: 2, fromChar: 0, toChar: 5, width: 40, x: 80 },
          ],
        },
      ],
      totalHeight: 20,
    };

    const layout: Layout = {
      pageSize: { w: 612, h: 792 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'segment-positioned-tracked-tab-highlight',
              fromLine: 0,
              toLine: 1,
              x: 30,
              y: 40,
              width: 552,
              pmStart: 0,
              pmEnd: 10,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    const plain = mount.querySelector('.superdoc-text-run[data-pm-start="0"]') as HTMLElement | null;
    const tracked = mount.querySelector('.track-insert-dec.highlighted[data-pm-start="5"]') as HTMLElement | null;
    const trackedWrapper = tracked?.closest('.superdoc-positioned-run') as HTMLElement | null;

    expect(plain).toBeTruthy();
    expect(plain?.closest('.superdoc-positioned-run')).toBeNull();
    expect(plain?.style.position).toBe('absolute');
    expect(plain?.style.left).toBe('0px');

    expect(tracked).toBeTruthy();
    expect(tracked?.style.position).not.toBe('absolute');
    expect(trackedWrapper).toBeTruthy();
    expect(trackedWrapper?.style.left).toBe('80px');
  });

  it('uses first run font-size for inline SDT wrapper when a field has mixed run sizes', () => {
    const mixedSizeBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'inline-sdt-mixed-font-size',
      runs: [
        {
          text: 'Big',
          fontFamily: 'Arial, sans-serif',
          fontSize: 36,
          pmStart: 100,
          pmEnd: 103,
          sdt: {
            type: 'structuredContent',
            scope: 'inline',
            id: 'mixed-size-sdt',
            tag: 'inline_text_sdt',
            alias: 'Mixed Size Field',
            lockMode: 'unlocked',
          },
        },
        {
          text: ' small',
          fontFamily: 'Arial, sans-serif',
          fontSize: 10,
          pmStart: 103,
          pmEnd: 109,
          sdt: {
            type: 'structuredContent',
            scope: 'inline',
            id: 'mixed-size-sdt',
            tag: 'inline_text_sdt',
            alias: 'Mixed Size Field',
            lockMode: 'unlocked',
          },
        },
      ],
      attrs: {},
    };

    const mixedSizeMeasure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 1,
          toChar: 6,
          width: 180,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
      ],
      totalHeight: 20,
    };

    const mixedSizeLayout: Layout = {
      pageSize: { w: 612, h: 792 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'inline-sdt-mixed-font-size',
              fromLine: 0,
              toLine: 1,
              x: 30,
              y: 40,
              width: 552,
              pmStart: 100,
              pmEnd: 109,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [mixedSizeBlock], measures: [mixedSizeMeasure] });
    painter.paint(mixedSizeLayout, mount);

    const wrapper = mount.querySelector(
      '.superdoc-structured-content-inline[data-sdt-id="mixed-size-sdt"]',
    ) as HTMLElement | null;
    expect(wrapper).toBeTruthy();
    expect(wrapper?.style.fontSize).toBe('36px');
  });

  it('positions word-layout markers relative to the text start', () => {
    const markerBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'word-layout-block',
      runs: [{ text: 'List text', fontFamily: 'Arial', fontSize: 16 }],
      attrs: {
        indent: { left: 48, hanging: 24 },
        numberingProperties: { numId: 5, ilvl: 0 },
        wordLayout: {
          indentLeftPx: 48,
          marker: {
            markerText: '-',
            glyphWidthPx: 12,
            markerBoxWidthPx: 20,
            markerX: 4,
            textStartX: 24,
            baselineOffsetPx: 0,
            justification: 'left',
            suffix: 'tab',
            run: { fontFamily: 'Arial', fontSize: 18 },
          },
        },
      },
    };

    const markerMeasure: ParagraphMeasure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 8,
          width: 100,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
      ],
      totalHeight: 20,
      marker: {
        markerWidth: 20,
        markerTextWidth: 12,
        indentLeft: 48,
      },
    };

    const markerLayout: Layout = {
      pageSize: layout.pageSize,
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'word-layout-block',
              fromLine: 0,
              toLine: 1,
              x: 96,
              y: 96,
              width: 300,
              markerWidth: 20,
              markerTextWidth: 12,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({
      blocks: [markerBlock],
      measures: [markerMeasure],
    });
    painter.paint(markerLayout, mount);

    const fragment = mount.querySelector('[data-block-id="word-layout-block"]') as HTMLElement;
    expect(fragment).toBeTruthy();
    const markerEl = fragment.querySelector('.superdoc-paragraph-marker') as HTMLElement;
    expect(markerEl).toBeTruthy();
    expect(markerEl.textContent).toBe('-');

    const markerContainer = markerEl.parentElement as HTMLElement;
    expect(markerContainer).toBeTruthy();
    // Left-justified markers stay inline (no absolute positioning)
    expect(markerContainer.style.position === '' || markerContainer.style.position === 'relative').toBe(true);

    expect(markerEl.style.fontSize).toBe('18px');
  });

  it('positions nested word-layout markers at the correct outdent without affecting inline flow', () => {
    const nestedBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'nested-word-layout-block',
      runs: [{ text: 'Nested list text', fontFamily: 'Arial', fontSize: 16 }],
      attrs: {
        indent: { left: 96, hanging: 24 },
        numberingProperties: { numId: 6, ilvl: 1 },
        wordLayout: {
          indentLeftPx: 96,
          marker: {
            markerText: 'a.',
            glyphWidthPx: 12,
            markerBoxWidthPx: 24,
            markerX: 48,
            textStartX: 72,
            baselineOffsetPx: 0,
            justification: 'left',
            suffix: 'tab',
            run: { fontFamily: 'Arial', fontSize: 16 },
          },
        },
      },
    };

    const nestedMeasure: ParagraphMeasure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 16,
          width: 120,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
      ],
      totalHeight: 20,
      marker: {
        markerWidth: 24,
        markerTextWidth: 12,
        indentLeft: 96,
      },
    };

    const nestedLayout: Layout = {
      pageSize: layout.pageSize,
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'nested-word-layout-block',
              fromLine: 0,
              toLine: 1,
              x: 96,
              y: 120,
              width: 300,
              markerWidth: 24,
              markerTextWidth: 12,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({
      blocks: [nestedBlock],
      measures: [nestedMeasure],
    });
    painter.paint(nestedLayout, mount);

    const fragment = mount.querySelector('[data-block-id="nested-word-layout-block"]') as HTMLElement;
    expect(fragment).toBeTruthy();
    const markerEl = fragment.querySelector('.superdoc-paragraph-marker') as HTMLElement;
    expect(markerEl).toBeTruthy();
    expect(markerEl.textContent).toBe('a.');

    const markerContainer = markerEl.parentElement as HTMLElement;
    expect(markerContainer).toBeTruthy();
    expect(markerContainer.style.position === '' || markerContainer.style.position === 'relative').toBe(true);
  });

  it('calculates left-justified marker tab width when marker fits before implicit tab stop', () => {
    const tabBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'tab-fit-block',
      runs: [{ text: 'List item text', fontFamily: 'Arial', fontSize: 16 }],
      attrs: {
        indent: { left: 48, hanging: 24 },
        numberingProperties: { numId: 1, ilvl: 0 },
        wordLayout: {
          indentLeftPx: 48,
          marker: {
            markerText: '1.',
            glyphWidthPx: 10,
            markerBoxWidthPx: 15,
            markerX: 9,
            textStartX: 24,
            baselineOffsetPx: 0,
            justification: 'left',
            suffix: 'tab',
            run: { fontFamily: 'Arial', fontSize: 16 },
          },
        },
      },
    };

    const tabMeasure: ParagraphMeasure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 14,
          width: 120,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
      ],
      totalHeight: 20,
      marker: {
        markerWidth: 15,
        markerTextWidth: 10,
        indentLeft: 48,
      },
    };

    const tabLayout: Layout = {
      pageSize: layout.pageSize,
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'tab-fit-block',
              fromLine: 0,
              toLine: 1,
              x: 96,
              y: 96,
              width: 300,
              markerWidth: 15,
              markerTextWidth: 10,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({
      blocks: [tabBlock],
      measures: [tabMeasure],
    });
    painter.paint(tabLayout, mount);

    const fragment = mount.querySelector('[data-block-id="tab-fit-block"]') as HTMLElement;
    expect(fragment).toBeTruthy();
    const tabEl = fragment.querySelector('.superdoc-tab') as HTMLElement;
    expect(tabEl).toBeTruthy();

    // Tab should reach implicit tab stop at indentLeft (48px)
    // markerStartPos = paraIndentLeft - hanging = 48 - 24 = 24
    // currentPos = markerStartPos + markerTextWidth = 24 + 10 = 34
    // implicitTabStop = paraIndentLeft = 48
    // tabWidth = 48 - 34 = 14
    const expectedTabWidth = 14;
    expect(tabEl.style.width).toBe(`${expectedTabWidth}px`);
  });

  it('calculates left-justified marker tab width when marker extends past implicit tab stop', () => {
    const longMarkerBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'tab-overflow-block',
      runs: [{ text: 'List item text', fontFamily: 'Arial', fontSize: 16 }],
      attrs: {
        indent: { left: 24, hanging: 12 },
        numberingProperties: { numId: 1, ilvl: 0 },
        wordLayout: {
          indentLeftPx: 24,
          marker: {
            markerText: 'VIII.',
            glyphWidthPx: 40,
            markerBoxWidthPx: 45,
            markerX: 0,
            textStartX: 12,
            baselineOffsetPx: 0,
            justification: 'left',
            suffix: 'tab',
            run: { fontFamily: 'Arial', fontSize: 16 },
          },
        },
      },
    };

    const longMarkerMeasure: ParagraphMeasure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 14,
          width: 120,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
      ],
      totalHeight: 20,
      marker: {
        markerWidth: 45,
        markerTextWidth: 40,
        indentLeft: 24,
      },
    };

    const longMarkerLayout: Layout = {
      pageSize: layout.pageSize,
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'tab-overflow-block',
              fromLine: 0,
              toLine: 1,
              x: 96,
              y: 96,
              width: 300,
              markerWidth: 45,
              markerTextWidth: 40,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({
      blocks: [longMarkerBlock],
      measures: [longMarkerMeasure],
    });
    painter.paint(longMarkerLayout, mount);

    const fragment = mount.querySelector('[data-block-id="tab-overflow-block"]') as HTMLElement;
    expect(fragment).toBeTruthy();
    const tabEl = fragment.querySelector('.superdoc-tab') as HTMLElement;
    expect(tabEl).toBeTruthy();

    // Marker extends past implicit tab stop, so advance to next default tab interval
    // markerStartPos = paraIndentLeft - hanging = 24 - 12 = 12
    // currentPos = markerStartPos + markerTextWidth = 12 + 40 = 52
    // implicitTabStop = paraIndentLeft = 24
    // tabWidth would be negative (24 - 57 = -33), so use default tab interval
    // tabWidth = 48 - (52 % 48) = 48 - 4 = 44
    const expectedTabWidth = 44;
    expect(tabEl.style.width).toBe(`${expectedTabWidth}px`);
  });

  it('calculates right-justified marker tab width using fragment.markerGutter', () => {
    const rightMarkerBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'right-marker-block',
      runs: [{ text: 'List item text', fontFamily: 'Arial', fontSize: 16 }],
      attrs: {
        indent: { left: 48, hanging: 24 },
        numberingProperties: { numId: 1, ilvl: 0 },
        wordLayout: {
          indentLeftPx: 48,
          marker: {
            markerText: '1.',
            glyphWidthPx: 10,
            markerBoxWidthPx: 20,
            markerX: 4,
            textStartX: 24,
            baselineOffsetPx: 0,
            justification: 'right',
            suffix: 'tab',
            gutterWidthPx: 12,
            run: { fontFamily: 'Arial', fontSize: 16 },
          },
        },
      },
    };

    const rightMarkerMeasure: ParagraphMeasure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 14,
          width: 120,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
      ],
      totalHeight: 20,
      marker: {
        markerWidth: 20,
        markerTextWidth: 10,
        indentLeft: 48,
        gutterWidth: 12,
      },
    };

    const rightMarkerLayout: Layout = {
      pageSize: layout.pageSize,
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'right-marker-block',
              fromLine: 0,
              toLine: 1,
              x: 96,
              y: 96,
              width: 300,
              markerWidth: 20,
              markerGutter: 12,
              markerTextWidth: 10,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({
      blocks: [rightMarkerBlock],
      measures: [rightMarkerMeasure],
    });
    painter.paint(rightMarkerLayout, mount);

    const fragment = mount.querySelector('[data-block-id="right-marker-block"]') as HTMLElement;
    expect(fragment).toBeTruthy();
    const tabEl = fragment.querySelector('.superdoc-tab') as HTMLElement;
    expect(tabEl).toBeTruthy();

    // For right-justified markers without firstLine, tab width uses hanging indent
    const expectedTabWidth = 24;
    expect(tabEl.style.width).toBe(`${expectedTabWidth}px`);
  });

  it('positions tab-aligned list text using textStartX instead of hanging indent', () => {
    const block: FlowBlock = {
      kind: 'paragraph',
      id: 'list-tab-textstart-block',
      runs: [{ text: 'Item', fontFamily: 'Arial', fontSize: 16 }],
      attrs: {
        indent: { left: 48, hanging: 24 },
        numberingProperties: { numId: 1, ilvl: 0 },
        wordLayout: {
          indentLeftPx: 48,
          textStartPx: 48,
          marker: {
            markerText: '1.',
            glyphWidthPx: 10,
            markerBoxWidthPx: 15,
            markerX: 24,
            textStartX: 48,
            baselineOffsetPx: 0,
            justification: 'left',
            suffix: 'tab',
            run: { fontFamily: 'Arial', fontSize: 16 },
          },
        },
      },
    };

    const measure: ParagraphMeasure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 4,
          width: 40,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
          segments: [{ runIndex: 0, fromChar: 0, toChar: 4, width: 40, x: 0 }],
        },
      ],
      totalHeight: 20,
      marker: {
        markerWidth: 15,
        markerTextWidth: 10,
        indentLeft: 48,
      },
    };

    const listLayout: Layout = {
      pageSize: layout.pageSize,
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'list-tab-textstart-block',
              fromLine: 0,
              toLine: 1,
              x: 0,
              y: 0,
              width: 200,
              markerWidth: 15,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(listLayout, mount);

    const lineEl = mount.querySelector('.superdoc-line') as HTMLElement;
    expect(lineEl).toBeTruthy();
    const textSpan = Array.from(lineEl.querySelectorAll('span')).find((el) => el.textContent === 'Item') as
      | HTMLElement
      | undefined;
    expect(textSpan).toBeTruthy();
    expect(textSpan?.style.left).toBe('48px');
  });

  it('keeps segment-positioned first-line list text at its measured segment offset', () => {
    const block: FlowBlock = {
      kind: 'paragraph',
      id: 'list-tab-stop-block',
      runs: [{ text: 'Closing.', fontFamily: 'Arial', fontSize: 16 }],
      attrs: {
        indent: { left: 48, hanging: 24 },
        numberingProperties: { numId: 1, ilvl: 0 },
        wordLayout: {
          firstLineIndentMode: true,
          indentLeftPx: 48,
          textStartPx: 48,
          tabsPx: [144],
          marker: {
            markerText: '2.1',
            glyphWidthPx: 20,
            markerBoxWidthPx: 20,
            markerX: 0,
            justification: 'left',
            suffix: 'tab',
            run: { fontFamily: 'Arial', fontSize: 16 },
          },
        },
      },
    };

    const measure: ParagraphMeasure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 8,
          width: 64,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
          segments: [{ runIndex: 0, fromChar: 0, toChar: 8, width: 64, x: 0 }],
        },
      ],
      totalHeight: 20,
      marker: {
        markerWidth: 20,
        markerTextWidth: 20,
        indentLeft: 48,
      },
    };

    const listLayout: Layout = {
      pageSize: layout.pageSize,
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'list-tab-stop-block',
              fromLine: 0,
              toLine: 1,
              x: 0,
              y: 0,
              width: 240,
              markerWidth: 20,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(listLayout, mount);

    const lineEl = mount.querySelector('.superdoc-line') as HTMLElement;
    expect(lineEl).toBeTruthy();

    const textSpan = Array.from(lineEl.querySelectorAll('span')).find((el) => el.textContent === 'Closing.') as
      | HTMLElement
      | undefined;
    expect(textSpan).toBeTruthy();
    expect(textSpan?.style.left).toBe('48px');
  });

  it('preserves measured justification width for inline list first lines without explicit segments', () => {
    const block: FlowBlock = {
      kind: 'paragraph',
      id: 'inline-justify-list-block',
      runs: [
        {
          text: 'Subject to the terms of this Agreement, Company will use',
          fontFamily: 'Times New Roman',
          fontSize: 13.333333333333332,
        },
      ],
      attrs: {
        alignment: 'justify',
        numberingProperties: { numId: 1, ilvl: 3 },
        wordLayout: {
          indentLeftPx: 0,
          hangingPx: 18,
          firstLinePx: 0,
          tabsPx: [],
          textStartPx: 0,
          marker: {
            markerText: '1.1',
            glyphWidthPx: 16.6669921875,
            markerBoxWidthPx: 24.6669921875,
            justification: 'left',
            suffix: 'tab',
            run: {
              fontFamily: 'Times New Roman',
              fontSize: 13.333333333333332,
            },
          },
        },
      },
    };

    const measure: ParagraphMeasure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 57,
          width: 309.5732421875,
          ascent: 11.69921875,
          descent: 2.876953125,
          lineHeight: 15.33333333333333,
          maxWidth: 325.7330078125,
          segments: [{ runIndex: 0, fromChar: 0, toChar: 57, width: 312.90625 }],
          spaceCount: 9,
        },
        {
          fromRun: 0,
          fromChar: 57,
          toRun: 0,
          toChar: 61,
          width: 24,
          ascent: 11.69921875,
          descent: 2.876953125,
          lineHeight: 15.33333333333333,
          maxWidth: 350.4,
          segments: [{ runIndex: 0, fromChar: 57, toChar: 61, width: 24 }],
          spaceCount: 0,
        },
      ],
      totalHeight: 30.66666666666666,
      marker: {
        markerWidth: 24.6669921875,
        markerTextWidth: 16.6669921875,
        indentLeft: 0,
        gutterWidth: 8,
      },
    };

    const listLayout: Layout = {
      pageSize: layout.pageSize,
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'inline-justify-list-block',
              fromLine: 0,
              toLine: 2,
              x: 0,
              y: 0,
              width: 350.4,
              markerWidth: 24.6669921875,
              markerTextWidth: 16.6669921875,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(listLayout, mount);

    const lineEl = mount.querySelector('.superdoc-line') as HTMLElement;
    expect(lineEl).toBeTruthy();
    const markerEl = mount.querySelector('.superdoc-paragraph-marker') as HTMLElement;
    const tabEl = mount.querySelector('.superdoc-tab') as HTMLElement;

    const expectedMarkerGeometry = resolveListMarkerGeometry(
      block.attrs?.wordLayout as Parameters<typeof resolveListMarkerGeometry>[0],
      0,
      0,
      0,
      () => 16.6669921875,
    );

    const appliedWordSpacing = Number.parseFloat(lineEl.style.wordSpacing);
    const expectedWordSpacing = (325.7330078125 - 309.5732421875) / 9;

    expect(markerEl).toBeTruthy();
    expect(tabEl).toBeTruthy();
    expect(expectedMarkerGeometry).toBeTruthy();
    expect(lineEl.style.paddingLeft).toBe(`${expectedMarkerGeometry!.markerStartPx}px`);
    expect(Number.parseFloat(tabEl.style.width)).toBeCloseTo(expectedMarkerGeometry!.suffixWidthPx, 4);
    expect(appliedWordSpacing).toBeGreaterThan(0);
    expect(appliedWordSpacing).toBeCloseTo(expectedWordSpacing, 5);
  });

  it('rebuilds fragment DOM nodes when layout geometry changes to keep line epochs in sync', () => {
    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    const fragmentBefore = mount.querySelector('.superdoc-fragment') as HTMLElement;
    const movedLayout: Layout = {
      ...layout,
      pages: [
        {
          ...layout.pages[0],
          fragments: [
            {
              ...layout.pages[0].fragments[0],
              x: 60,
            },
          ],
        },
      ],
    };

    painter.paint(movedLayout, mount);
    const fragmentAfter = mount.querySelector('.superdoc-fragment') as HTMLElement;
    const lineAfter = fragmentAfter.querySelector('.superdoc-line') as HTMLElement;

    expect(fragmentAfter).not.toBe(fragmentBefore);
    expect(fragmentAfter.style.left).toBe('60px');
    expect(fragmentAfter.dataset.layoutEpoch).toBeTruthy();
    expect(lineAfter.dataset.layoutEpoch).toBe(fragmentAfter.dataset.layoutEpoch);
  });

  it('rebuilds fragment DOM when block content changes via setData', () => {
    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    const fragmentBefore = mount.querySelector('.superdoc-fragment') as HTMLElement;

    const updatedBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'block-1',
      runs: [block.runs[0], { text: 'world!!!', fontFamily: 'Arial', fontSize: 16, bold: true, pmStart: 7, pmEnd: 15 }],
    };
    const updatedMeasure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 1,
          toChar: 8,
          width: 140,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
      ],
      totalHeight: 20,
    };
    painter.setData([updatedBlock], [updatedMeasure]);

    const updatedLayout: Layout = {
      ...layout,
      pages: [
        {
          ...layout.pages[0],
          fragments: [
            {
              ...(layout.pages[0].fragments[0] as (typeof layout.pages)[0]['fragments'][0]),
              pmEnd: 15,
            },
          ],
        },
      ],
    };

    painter.paint(updatedLayout, mount);
    const fragmentAfter = mount.querySelector('.superdoc-fragment') as HTMLElement;

    expect(fragmentAfter).not.toBe(fragmentBefore);
    expect(fragmentAfter?.textContent).toContain('world!!!');
  });

  it('updates structured-content lock metadata when lockMode changes via setData', () => {
    const lockedBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'lock-mode-block',
      runs: [{ text: 'Protected text', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 14 }],
      attrs: {
        sdt: {
          type: 'structuredContent',
          scope: 'block',
          id: 'sc-lock-mode-1',
          alias: 'Protected Control',
          lockMode: 'unlocked',
        },
      },
    };

    const lockedMeasure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 14,
          width: 140,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
      ],
      totalHeight: 20,
    };

    const lockedLayout: Layout = {
      pageSize: { w: 400, h: 500 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'lock-mode-block',
              fromLine: 0,
              toLine: 1,
              x: 20,
              y: 30,
              width: 300,
              pmStart: 0,
              pmEnd: 14,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [lockedBlock], measures: [lockedMeasure] });
    painter.paint(lockedLayout, mount);

    const fragmentBefore = mount.querySelector('.superdoc-fragment') as HTMLElement;
    expect(fragmentBefore.dataset.lockMode).toBe('unlocked');

    const updatedLockedBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'lock-mode-block',
      runs: [{ text: 'Protected text', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 14 }],
      attrs: {
        sdt: {
          type: 'structuredContent',
          scope: 'block',
          id: 'sc-lock-mode-1',
          alias: 'Protected Control',
          lockMode: 'contentLocked',
        },
      },
    };

    painter.setData([updatedLockedBlock], [lockedMeasure]);
    painter.paint(lockedLayout, mount);

    const fragmentAfter = mount.querySelector('.superdoc-fragment') as HTMLElement;
    expect(fragmentAfter.dataset.lockMode).toBe('contentLocked');
  });

  it('updates fragment positions in virtualized mode when layout changes without block diffs', () => {
    const painter = createTestPainter({
      blocks: [block],
      measures: [measure],
      virtualization: { enabled: true, window: 2 },
    });
    const virtualMount = document.createElement('div');
    // jsdom returns zeros by default but provide an explicit rect for clarity
    virtualMount.getBoundingClientRect = () =>
      ({
        width: 0,
        height: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        x: 0,
        y: 0,
        toJSON() {
          return {};
        },
      }) as DOMRect;

    painter.setData([block], [measure]);
    painter.paint(layout, virtualMount);
    const fragmentBefore = virtualMount.querySelector('.superdoc-fragment') as HTMLElement;
    expect(fragmentBefore.style.left).toBe('30px');

    const shiftedLayout: Layout = {
      ...layout,
      pages: [
        {
          ...layout.pages[0],
          fragments: layout.pages[0].fragments.map((fragment) => ({
            ...fragment,
            x: fragment.x + 40,
          })),
        },
      ],
    };

    painter.setData([block], [measure]);
    painter.paint(shiftedLayout, virtualMount);
    const fragmentAfter = virtualMount.querySelector('.superdoc-fragment') as HTMLElement;

    expect(fragmentAfter.style.left).toBe('70px');
  });

  it('exposes a paint snapshot after rendering', () => {
    const painter = createTestPainter({ blocks: [block], measures: [measure] });

    painter.paint(layout, mount);

    const snapshot = painter.getPaintSnapshot?.();
    expect(snapshot).toBeTruthy();
    expect(snapshot?.formatVersion).toBe(1);
    expect(snapshot?.pageCount).toBe(1);
    expect(snapshot?.lineCount).toBeGreaterThan(0);
  });

  it('captures annotation, structured content, and image identity entities in the paint snapshot', () => {
    const annotationBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'annotation-snapshot',
      runs: [
        {
          kind: 'fieldAnnotation',
          variant: 'text',
          displayLabel: 'Client Name',
          fieldId: 'FIELD-1',
          fieldType: 'text',
          fieldColor: '#980043',
          pmStart: 0,
          pmEnd: 1,
        },
      ],
    };

    const annotationMeasure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 0,
          width: 120,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
      ],
      totalHeight: 20,
    };

    const inlineSdtBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'inline-sdt-snapshot',
      runs: [
        { text: 'Before ', fontFamily: 'Arial', fontSize: 16, pmStart: 1, pmEnd: 8 },
        {
          text: 'Client',
          fontFamily: 'Arial',
          fontSize: 16,
          pmStart: 8,
          pmEnd: 14,
          sdt: {
            type: 'structuredContent',
            scope: 'inline',
            id: 'SC-1',
            tag: 'client_inline',
            alias: 'Client Data',
          },
        },
        {
          text: ' Name',
          fontFamily: 'Arial',
          fontSize: 16,
          pmStart: 14,
          pmEnd: 19,
          sdt: {
            type: 'structuredContent',
            scope: 'inline',
            id: 'SC-1',
            tag: 'client_inline',
            alias: 'Client Data',
          },
        },
        { text: ' after', fontFamily: 'Arial', fontSize: 16, pmStart: 19, pmEnd: 25 },
      ],
    };

    const inlineSdtMeasure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 3,
          toChar: 6,
          width: 220,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
      ],
      totalHeight: 20,
    };

    const blockSdtBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'block-sdt-snapshot',
      runs: [{ text: 'Block SDT', fontFamily: 'Arial', fontSize: 16, pmStart: 20, pmEnd: 29 }],
      attrs: {
        sdt: {
          type: 'structuredContent',
          scope: 'block',
          id: 'scb-snapshot-1',
          alias: 'Snapshot Block',
        },
      },
    };

    const blockSdtMeasure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 9,
          width: 140,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
      ],
      totalHeight: 20,
    };

    const inlineImageBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'snapshot-inline-image',
      runs: [
        {
          kind: 'image',
          src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          width: 80,
          height: 60,
          clipPath: 'inset(10% 20% 30% 40%)',
          pmStart: 29,
          pmEnd: 30,
        },
      ],
    };

    const inlineImageMeasure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 0,
          width: 80,
          ascent: 60,
          descent: 0,
          lineHeight: 60,
        },
      ],
      totalHeight: 60,
    };

    const entityLayout: Layout = {
      pageSize: { w: 400, h: 500 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'annotation-snapshot',
              fromLine: 0,
              toLine: 1,
              x: 20,
              y: 30,
              width: 180,
              pmStart: 0,
              pmEnd: 1,
            },
            {
              kind: 'para',
              blockId: 'inline-sdt-snapshot',
              fromLine: 0,
              toLine: 1,
              x: 20,
              y: 60,
              width: 320,
              pmStart: 1,
              pmEnd: 25,
            },
            {
              kind: 'para',
              blockId: 'block-sdt-snapshot',
              fromLine: 0,
              toLine: 1,
              x: 20,
              y: 90,
              width: 320,
              pmStart: 20,
              pmEnd: 29,
            },
            {
              kind: 'para',
              blockId: 'snapshot-inline-image',
              fromLine: 0,
              toLine: 1,
              x: 20,
              y: 120,
              width: 80,
              pmStart: 29,
              pmEnd: 30,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({
      blocks: [annotationBlock, inlineSdtBlock, blockSdtBlock, inlineImageBlock],
      measures: [annotationMeasure, inlineSdtMeasure, blockSdtMeasure, inlineImageMeasure],
    });

    painter.paint(entityLayout, mount);

    const snapshot = painter.getPaintSnapshot?.();
    expect(snapshot).toBeTruthy();

    expect(snapshot?.entities.annotations).toHaveLength(1);
    expect(snapshot?.entities.annotations[0]).toMatchObject({
      pageIndex: 0,
      pmStart: 0,
      pmEnd: 1,
      fieldId: 'FIELD-1',
      fieldType: 'text',
      type: 'text',
    });
    expect(snapshot?.entities.annotations[0]?.element.classList.contains('annotation')).toBe(true);
    expect(snapshot?.entities.annotations[0]?.element.dataset.displayLabel).toBe('Client Name');

    expect(snapshot?.entities.structuredContentInlines).toHaveLength(1);
    expect(snapshot?.entities.structuredContentInlines[0]).toMatchObject({
      pageIndex: 0,
      sdtId: 'SC-1',
      pmStart: 8,
      pmEnd: 19,
    });

    expect(snapshot?.entities.structuredContentBlocks).toHaveLength(1);
    expect(snapshot?.entities.structuredContentBlocks[0]).toMatchObject({
      pageIndex: 0,
      sdtId: 'scb-snapshot-1',
      pmStart: 20,
      pmEnd: 29,
    });

    expect(snapshot?.entities.images).toHaveLength(1);
    expect(snapshot?.entities.images[0]).toMatchObject({
      pageIndex: 0,
      kind: 'inline',
      pmStart: 29,
      pmEnd: 30,
    });
    expect(snapshot?.entities.images[0]?.element.classList.contains('superdoc-inline-image-clip-wrapper')).toBe(true);
  });

  it('uses actual page indices when collecting virtualized paint snapshots', () => {
    const painter = createTestPainter({
      blocks: [block],
      measures: [measure],
      virtualization: { enabled: true, window: 2 },
    });
    const virtualMount = document.createElement('div');
    virtualMount.getBoundingClientRect = () =>
      ({
        width: 0,
        height: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        x: 0,
        y: 0,
        toJSON() {
          return {};
        },
      }) as DOMRect;

    const multiPageLayout: Layout = {
      ...layout,
      pages: Array.from({ length: 10 }, (_, pageIndex) => ({
        number: pageIndex + 1,
        fragments: [
          {
            kind: 'para',
            blockId: 'block-1',
            fromLine: 0,
            toLine: 1,
            x: 30,
            y: 40,
            width: 300,
            pmStart: 1,
            pmEnd: 12,
          },
        ],
      })),
    };

    painter.setVirtualizationPins?.([8]);
    painter.paint(multiPageLayout, virtualMount);

    const snapshot = painter.getPaintSnapshot?.();
    expect(snapshot).toBeTruthy();
    const pageIndices = snapshot?.pages.map((page) => page.index) ?? [];
    expect(pageIndices).toContain(8);
    expect(snapshot?.pages.find((page) => page.index === 8)?.pageNumber).toBe(9);
  });

  it('renders header decorations with tokens resolved', () => {
    const headerBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'header-block',
      runs: [
        { text: 'Page ', fontFamily: 'Arial', fontSize: 14 },
        { text: '0', fontFamily: 'Arial', fontSize: 14, token: 'pageNumber' },
        { text: ' of ', fontFamily: 'Arial', fontSize: 14 },
        { text: '0', fontFamily: 'Arial', fontSize: 14, token: 'totalPageCount' },
      ],
    };
    const headerMeasure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 3,
          toChar: 1,
          width: 120,
          ascent: 10,
          descent: 4,
          lineHeight: 16,
        },
      ],
      totalHeight: 16,
    };
    const headerFragment = {
      kind: 'para' as const,
      blockId: 'header-block',
      fromLine: 0,
      toLine: 1,
      x: 0,
      y: 0,
      width: 200,
    };

    const painter = createTestPainter({
      blocks: [block, headerBlock],
      measures: [measure, headerMeasure],
      headerProvider: () => ({ fragments: [headerFragment], height: 16 }),
    });

    painter.paint({ ...layout, pages: [{ ...layout.pages[0], number: 1 }] }, mount);

    const headerEl = mount.querySelector('.superdoc-page-header');
    expect(headerEl).toBeTruthy();
    expect(headerEl?.textContent).toBe('Page 1 of 1');
  });

  it('stamps a stable header/footer ref-id attribute on the decoration container', () => {
    const headerBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'header-block',
      runs: [{ text: 'HEADER_LINE_1', fontFamily: 'Arial', fontSize: 14 }],
    };
    const headerMeasure: Measure = {
      kind: 'paragraph',
      lines: [{ fromRun: 0, fromChar: 0, toRun: 1, toChar: 1, width: 120, ascent: 10, descent: 4, lineHeight: 16 }],
      totalHeight: 16,
    };
    const headerFragment = {
      kind: 'para' as const,
      blockId: 'header-block',
      fromLine: 0,
      toLine: 1,
      x: 0,
      y: 0,
      width: 200,
    };

    const painter = createTestPainter({
      blocks: [block, headerBlock],
      measures: [measure, headerMeasure],
      headerProvider: () => ({
        fragments: [headerFragment],
        height: 16,
        headerFooterRefId: 'rId101',
        sectionType: 'first',
      }),
    });

    painter.paint({ ...layout, pages: [{ ...layout.pages[0], number: 1 }] }, mount);

    const headerEl = mount.querySelector('.superdoc-page-header') as HTMLElement | null;
    expect(headerEl).toBeTruthy();
    expect(headerEl?.getAttribute('data-sd-headerfooter-ref-id')).toBe('rId101');
    expect(headerEl?.getAttribute('data-sd-headerfooter-variant')).toBe('first');
    expect(headerEl?.getAttribute('data-sd-headerfooter-kind')).toBe('header');
  });

  it('renders behindDoc header images directly on page, not in header container', () => {
    // Per OOXML spec, behindDoc images should render behind body content.
    // This requires placing them directly on the page element (not in header container)
    // because the header container has z-index: 1 which creates a stacking context.
    const behindDocImageBlock: FlowBlock = {
      kind: 'image',
      id: 'behind-doc-img',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      width: 200,
      height: 100,
      anchor: { behindDoc: true },
    };
    const behindDocImageMeasure: Measure = {
      kind: 'image',
      width: 200,
      height: 100,
    };

    const normalImageBlock: FlowBlock = {
      kind: 'image',
      id: 'normal-img',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      width: 50,
      height: 30,
    };
    const normalImageMeasure: Measure = {
      kind: 'image',
      width: 50,
      height: 30,
    };

    // behindDoc routing should use explicit fragment metadata, not zIndex proxy.
    const behindDocFragment = {
      kind: 'image' as const,
      blockId: 'behind-doc-img',
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      behindDoc: true,
      zIndex: 5, // deliberately non-zero to prove routing is metadata-driven
      isAnchored: true,
    };

    // Normal fragment in header
    const normalFragment = {
      kind: 'image' as const,
      blockId: 'normal-img',
      x: 10,
      y: 10,
      width: 50,
      height: 30,
      behindDoc: false,
    };

    const painter = createTestPainter({
      blocks: [block, behindDocImageBlock, normalImageBlock],
      measures: [measure, behindDocImageMeasure, normalImageMeasure],
      headerProvider: () => ({
        fragments: [behindDocFragment, normalFragment],
        height: 100,
      }),
    });

    painter.paint({ ...layout, pages: [{ ...layout.pages[0], number: 1 }] }, mount);

    const headerEl = mount.querySelector('.superdoc-page-header');
    expect(headerEl).toBeTruthy();

    // Normal image should be inside header container
    const normalInHeader = headerEl?.querySelectorAll('.superdoc-fragment');

    // The header should contain only the normal fragment, not the behindDoc one
    // behindDoc fragment is rendered directly on the page element
    expect(normalInHeader?.length).toBe(1);

    // behindDoc image should be rendered directly on page with z-index: 0
    const pageEl = mount.querySelector('.superdoc-page');
    const allImagesOnPage = pageEl?.querySelectorAll(':scope > .superdoc-fragment img');
    // One of these should be the behindDoc image rendered directly on the page
    expect(allImagesOnPage?.length).toBeGreaterThanOrEqual(1);

    // Find the behindDoc fragment on the page (direct child with z-index: 0 and data attribute)
    const directFragments = pageEl?.querySelectorAll(':scope > .superdoc-fragment');
    let foundBehindDoc = false;
    directFragments?.forEach((frag) => {
      const el = frag as HTMLElement;
      if (el.style.zIndex === '0' && el.dataset.behindDocSection === 'header') {
        foundBehindDoc = true;
      }
    });
    expect(foundBehindDoc).toBe(true);
  });

  it('renders header WordArt watermarks behind page content even when behindDoc is false in OOXML', () => {
    const watermarkBlock: FlowBlock = {
      kind: 'drawing',
      id: 'header-wordart-watermark',
      drawingKind: 'vectorShape',
      geometry: { width: 200, height: 60, rotation: 320, flipH: false, flipV: false },
      shapeKind: 'rect',
      fillColor: null,
      strokeColor: null,
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'page',
        alignH: 'center',
        vRelativeFrom: 'page',
        alignV: 'center',
        behindDoc: false,
      },
      wrap: { type: 'None' },
      textAlign: 'center',
      textContent: {
        parts: [{ text: 'AUTE', formatting: { fontFamily: 'Arial', fontSize: 24, color: 'C0C0C0' } }],
      },
      attrs: { isWordArt: true, isTextBox: true },
    };
    const watermarkMeasure: Measure = {
      kind: 'drawing',
      drawingKind: 'vectorShape',
      width: 200,
      height: 60,
      scale: 1,
      naturalWidth: 200,
      naturalHeight: 60,
      geometry: { width: 200, height: 60, rotation: 320, flipH: false, flipV: false },
    };
    const watermarkFragment = {
      kind: 'drawing' as const,
      blockId: 'header-wordart-watermark',
      drawingKind: 'vectorShape' as const,
      x: 40,
      y: 180,
      width: 240,
      height: 120,
      geometry: { width: 200, height: 60, rotation: 320, flipH: false, flipV: false },
      scale: 1,
      isAnchored: true,
      behindDoc: false,
      zIndex: 251658241,
    };

    const painter = createTestPainter({
      blocks: [block, watermarkBlock],
      measures: [measure, watermarkMeasure],
      headerProvider: () => ({
        fragments: [watermarkFragment],
        height: 40,
      }),
    });

    painter.paint({ ...layout, pages: [{ ...layout.pages[0], number: 1 }] }, mount);

    const pageEl = mount.querySelector('.superdoc-page') as HTMLElement | null;
    const headerEl = mount.querySelector('.superdoc-page-header') as HTMLElement | null;
    const behindDocWatermark = pageEl?.querySelector(
      '[data-behind-doc-section="header"][data-block-id="header-wordart-watermark"]',
    ) as HTMLElement | null;
    const watermarkInHeader = headerEl?.querySelector('[data-block-id="header-wordart-watermark"]');
    const watermarkText = behindDocWatermark?.querySelector('.superdoc-wordart-text text') as SVGTextElement | null;

    expect(behindDocWatermark).toBeTruthy();
    expect(watermarkInHeader).toBeNull();
    expect(behindDocWatermark?.style.zIndex).toBe('0');
    expect(watermarkText).toBeTruthy();
    expect(watermarkText?.getAttribute('lengthAdjust')).toBe('spacingAndGlyphs');
  });

  it('renders VML text watermark images behind page content and dims them outside header edit mode', () => {
    const watermarkBlock: FlowBlock = {
      kind: 'image',
      id: 'header-vml-text-watermark',
      src: 'data:image/svg+xml;base64,PHN2Zy8+',
      width: 200,
      height: 100,
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'page',
        vRelativeFrom: 'page',
      },
      attrs: { vmlTextWatermark: true },
    };
    const watermarkMeasure: Measure = {
      kind: 'image',
      width: 200,
      height: 100,
    };
    const watermarkFragment = {
      kind: 'image' as const,
      blockId: 'header-vml-text-watermark',
      x: 40,
      y: 180,
      width: 200,
      height: 100,
      isAnchored: true,
      behindDoc: false,
    };

    const painter = createTestPainter({
      blocks: [block, watermarkBlock],
      measures: [measure, watermarkMeasure],
      headerProvider: () => ({
        fragments: [watermarkFragment],
        height: 40,
        offset: 20,
      }),
    });

    painter.paint({ ...layout, pages: [{ ...layout.pages[0], number: 1 }] }, mount);

    const pageEl = mount.querySelector('.superdoc-page') as HTMLElement;
    const headerEl = mount.querySelector('.superdoc-page-header') as HTMLElement | null;
    const behindDocWatermark = pageEl.querySelector(
      '[data-behind-doc-section="header"][data-block-id="header-vml-text-watermark"]',
    ) as HTMLElement | null;
    const watermarkInHeader = headerEl?.querySelector('[data-block-id="header-vml-text-watermark"]');

    expect(behindDocWatermark).toBeTruthy();
    expect(watermarkInHeader).toBeNull();
    expect(behindDocWatermark?.dataset.vmlTextWatermark).toBe('true');
    expect(behindDocWatermark?.style.opacity).toBe('0.5');
  });

  it('renders active header VML text watermarks at full preview opacity', () => {
    const watermarkBlock: FlowBlock = {
      kind: 'image',
      id: 'active-header-vml-text-watermark',
      src: 'data:image/svg+xml;base64,PHN2Zy8+',
      width: 200,
      height: 100,
      attrs: { vmlTextWatermark: true },
    };
    const watermarkMeasure: Measure = {
      kind: 'image',
      width: 200,
      height: 100,
    };
    const watermarkFragment = {
      kind: 'image' as const,
      blockId: 'active-header-vml-text-watermark',
      x: 40,
      y: 180,
      width: 200,
      height: 100,
      isAnchored: true,
      behindDoc: true,
    };

    const painter = createTestPainter({
      blocks: [block, watermarkBlock],
      measures: [measure, watermarkMeasure],
      headerProvider: () => ({
        fragments: [watermarkFragment],
        height: 40,
        offset: 20,
        isActiveHeaderFooter: true,
      }),
    });

    painter.paint({ ...layout, pages: [{ ...layout.pages[0], number: 1 }] }, mount);

    const activeWatermark = mount.querySelector(
      '[data-behind-doc-section="header"][data-block-id="active-header-vml-text-watermark"]',
    ) as HTMLElement | null;

    expect(activeWatermark).toBeTruthy();
    expect(activeWatermark?.style.opacity).toBe('1');
  });

  it('renders non-WordArt wrapNone page-relative header media above behindDoc media but below body content', () => {
    const bodyBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'body-text',
      runs: [{ text: 'Body text', fontFamily: 'Arial', fontSize: 16 }],
    };
    const bodyMeasure: Measure = {
      kind: 'paragraph',
      lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 9, width: 80, ascent: 12, descent: 4, lineHeight: 20 }],
      totalHeight: 20,
    };
    const headerBackgroundBlock: FlowBlock = {
      kind: 'image',
      id: 'header-background',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      width: 200,
      height: 100,
      attrs: { originalAttributes: { relativeHeight: OOXML_Z_INDEX_BASE + 10 } },
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'page',
        vRelativeFrom: 'page',
        behindDoc: true,
      },
      wrap: {
        type: 'None',
      },
    };
    const headerTintBlock: FlowBlock = {
      kind: 'image',
      id: 'header-tint',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      width: 200,
      height: 100,
      attrs: { originalAttributes: { relativeHeight: OOXML_Z_INDEX_BASE + 20 } },
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'page',
        vRelativeFrom: 'page',
        behindDoc: true,
      },
      wrap: {
        type: 'None',
      },
    };
    const headerImageBlock: FlowBlock = {
      kind: 'image',
      id: 'header-image',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      width: 200,
      height: 100,
      attrs: { originalAttributes: { relativeHeight: OOXML_Z_INDEX_BASE - 1000 } },
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'page',
        vRelativeFrom: 'page',
      },
      wrap: {
        type: 'None',
      },
    };
    const footerBackgroundBlock: FlowBlock = {
      kind: 'image',
      id: 'footer-background',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      width: 200,
      height: 100,
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'page',
        vRelativeFrom: 'page',
        behindDoc: true,
      },
      wrap: {
        type: 'None',
      },
    };
    const headerBackgroundMeasure: Measure = {
      kind: 'image',
      width: 200,
      height: 100,
    };
    const headerImageMeasure: Measure = {
      kind: 'image',
      width: 200,
      height: 100,
    };
    const headerTintMeasure: Measure = {
      kind: 'image',
      width: 200,
      height: 100,
    };
    const footerBackgroundMeasure: Measure = {
      kind: 'image',
      width: 200,
      height: 100,
    };
    const headerBackgroundFragment = {
      kind: 'image' as const,
      blockId: 'header-background',
      x: 0,
      y: 40,
      width: 200,
      height: 100,
      isAnchored: true,
      behindDoc: true,
      zIndex: 0,
    };
    const headerTintFragment = {
      kind: 'image' as const,
      blockId: 'header-tint',
      x: 0,
      y: 40,
      width: 200,
      height: 100,
      isAnchored: true,
      behindDoc: true,
      zIndex: 0,
    };
    const headerFragment = {
      kind: 'image' as const,
      blockId: 'header-image',
      x: 0,
      y: 40,
      width: 200,
      height: 100,
      isAnchored: true,
      behindDoc: false,
      zIndex: 1,
    };
    const footerBackgroundFragment = {
      kind: 'image' as const,
      blockId: 'footer-background',
      x: 0,
      y: 420,
      width: 200,
      height: 100,
      isAnchored: true,
      behindDoc: true,
    };

    const painter = createTestPainter({
      blocks: [bodyBlock],
      measures: [bodyMeasure],
      headerProvider: () => ({
        fragments: [headerTintFragment, headerBackgroundFragment, headerFragment],
        height: 100,
        offset: 60,
      }),
      footerProvider: () => ({
        fragments: [footerBackgroundFragment],
        height: 100,
        offset: 400,
      }),
    });
    painter.setData(
      [bodyBlock],
      [bodyMeasure],
      [headerBackgroundBlock, headerTintBlock, headerImageBlock],
      [headerBackgroundMeasure, headerTintMeasure, headerImageMeasure],
      [footerBackgroundBlock],
      [footerBackgroundMeasure],
    );

    const pageLayout: Layout = {
      ...layout,
      pages: [
        {
          ...layout.pages[0],
          number: 1,
          fragments: [{ kind: 'para', blockId: 'body-text', fromLine: 0, toLine: 1, x: 0, y: 80, width: 200 }],
        },
      ],
    };

    painter.paint(pageLayout, mount);

    const assertBackgroundOrder = () => {
      const pageEl = mount.querySelector('.superdoc-page') as HTMLElement;
      const headerEl = mount.querySelector('.superdoc-page-header') as HTMLElement;
      const behindDocBackground = pageEl.querySelector(
        '[data-behind-doc-section="header"][data-block-id="header-background"]',
      ) as HTMLElement | null;
      const behindDocTint = pageEl.querySelector(
        '[data-behind-doc-section="header"][data-block-id="header-tint"]',
      ) as HTMLElement | null;
      const imageInHeader = headerEl.querySelector('[data-block-id="header-image"]') as HTMLElement | null;
      const overlayImage = pageEl.querySelector(
        '[data-header-footer-overlay-section="header"][data-block-id="header-image"]',
      ) as HTMLElement | null;
      const footerBackground = pageEl.querySelector(
        '[data-behind-doc-section="footer"][data-block-id="footer-background"]',
      ) as HTMLElement | null;
      const bodyText = pageEl.querySelector('[data-block-id="body-text"]') as HTMLElement | null;

      expect(behindDocBackground).toBeTruthy();
      expect(behindDocTint).toBeTruthy();
      expect(imageInHeader).toBeNull();
      expect(overlayImage).toBeTruthy();
      expect(overlayImage?.style.top).toBe('40px');
      expect(overlayImage?.style.zIndex).toBe('0');
      expect(overlayImage?.style.pointerEvents).toBe('none');
      expect(footerBackground).toBeTruthy();
      expect(bodyText).toBeTruthy();
      expect(bodyText?.style.zIndex).toBe('');

      const directChildren = Array.from(pageEl.children);
      expect(directChildren.indexOf(behindDocBackground as Element)).toBeLessThan(
        directChildren.indexOf(behindDocTint as Element),
      );
      expect(directChildren.indexOf(behindDocTint as Element)).toBeLessThan(
        directChildren.indexOf(overlayImage as Element),
      );
      expect(directChildren.indexOf(overlayImage as Element)).toBeLessThan(directChildren.indexOf(bodyText as Element));
      expect(directChildren.indexOf(footerBackground as Element)).toBeLessThan(
        directChildren.indexOf(bodyText as Element),
      );
    };

    assertBackgroundOrder();

    painter.paint(pageLayout, mount);
    assertBackgroundOrder();
  });

  it('positions non-WordArt wrapNone paragraph-relative header media from the header origin', () => {
    const headerImageBlock: FlowBlock = {
      kind: 'image',
      id: 'header-image',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      width: 200,
      height: 100,
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'column',
        vRelativeFrom: 'paragraph',
      },
      wrap: {
        type: 'None',
      },
    };
    const headerImageMeasure: Measure = {
      kind: 'image',
      width: 200,
      height: 100,
    };
    const headerFragment = {
      kind: 'image' as const,
      blockId: 'header-image',
      x: 0,
      y: 40,
      width: 200,
      height: 100,
      isAnchored: true,
      behindDoc: false,
    };

    const painter = createTestPainter({
      blocks: [block, headerImageBlock],
      measures: [measure, headerImageMeasure],
      headerProvider: () => ({
        fragments: [headerFragment],
        height: 100,
        offset: 60,
      }),
    });

    painter.paint({ ...layout, pages: [{ ...layout.pages[0], number: 1 }] }, mount);

    const pageEl = mount.querySelector('.superdoc-page') as HTMLElement;
    const headerEl = mount.querySelector('.superdoc-page-header') as HTMLElement;
    const imageInHeader = headerEl.querySelector('[data-block-id="header-image"]') as HTMLElement | null;
    const overlayImage = pageEl.querySelector(
      '[data-header-footer-overlay-section="header"][data-block-id="header-image"]',
    ) as HTMLElement | null;

    expect(imageInHeader).toBeNull();
    expect(overlayImage).toBeTruthy();
    expect(overlayImage?.style.top).toBe('100px');
  });

  it('cleans up behindDoc fragments on re-render (no accumulation)', () => {
    // This test verifies that behindDoc fragments don't accumulate across re-renders.
    // Since they're inserted directly on the page (not in header container), they must
    // be explicitly removed before re-rendering.
    const behindDocImageBlock: FlowBlock = {
      kind: 'image',
      id: 'behind-doc-img',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      width: 200,
      height: 100,
      anchor: { behindDoc: true },
    };
    const behindDocImageMeasure: Measure = {
      kind: 'image',
      width: 200,
      height: 100,
    };

    const behindDocFragment = {
      kind: 'image' as const,
      blockId: 'behind-doc-img',
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      behindDoc: true,
      zIndex: 5,
      isAnchored: true,
    };

    const painter = createTestPainter({
      blocks: [block, behindDocImageBlock],
      measures: [measure, behindDocImageMeasure],
      headerProvider: () => ({
        fragments: [behindDocFragment],
        height: 100,
      }),
    });

    const testLayout = { ...layout, pages: [{ ...layout.pages[0], number: 1 }] };

    // First render
    painter.paint(testLayout, mount);

    // Second render (simulates incremental update)
    painter.paint(testLayout, mount);

    // Third render
    painter.paint(testLayout, mount);

    // Should only have ONE behindDoc fragment, not three
    const pageEl = mount.querySelector('.superdoc-page');
    const behindDocElements = pageEl?.querySelectorAll('[data-behind-doc-section="header"]');
    expect(behindDocElements?.length).toBe(1);
  });

  it('applies track-change classes and metadata when rendering review mode', () => {
    const trackedBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'tracked-block',
      runs: [
        {
          text: 'Inserted content',
          fontFamily: 'Arial',
          fontSize: 16,
          trackedChange: {
            kind: 'insert',
            id: 'change-1',
            author: 'Reviewer 1',
            authorEmail: 'reviewer@example.com',
            color: '#8250df',
          },
        },
      ],
      attrs: {
        trackedChangesMode: 'review',
        trackedChangesEnabled: true,
      },
    };

    const { paragraphMeasure, paragraphLayout } = buildSingleParagraphData(
      trackedBlock.id,
      trackedBlock.runs[0].text.length,
    );

    const painter = createTestPainter({ blocks: [trackedBlock], measures: [paragraphMeasure] });
    painter.paint(paragraphLayout, mount);

    const span = mount.querySelector('.superdoc-line span') as HTMLElement;
    expect(span.classList.contains('track-insert-dec')).toBe(true);
    expect(span.classList.contains('highlighted')).toBe(true);
    expect(span.dataset.trackChangeId).toBe('change-1');
    expect(span.dataset.trackChangeKind).toBe('insert');
    expect(span.dataset.trackChangeAuthor).toBe('Reviewer 1');
    expect(span.dataset.trackChangeAuthorEmail).toBe('reviewer@example.com');
    expect(span.dataset.trackChangeAuthorColor).toBe('#8250df');
    expect(span.style.getPropertyValue('--sd-tracked-changes-insert-border')).toBe('#8250df');
    expect(span.style.getPropertyValue('--sd-tracked-changes-insert-background')).toBe('');
    expect(span.style.getPropertyValue('--sd-tracked-changes-insert-background-focused')).toBe('#8250df44');
  });

  it('does not turn named author colors into opaque tracked-change backgrounds', () => {
    const trackedBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'tracked-block',
      runs: [
        {
          text: 'Inserted content',
          fontFamily: 'Arial',
          fontSize: 16,
          trackedChange: {
            kind: 'insert',
            id: 'change-1',
            author: 'Reviewer 1',
            color: 'red',
          },
        },
      ],
      attrs: {
        trackedChangesMode: 'review',
        trackedChangesEnabled: true,
      },
    };

    const { paragraphMeasure, paragraphLayout } = buildSingleParagraphData(
      trackedBlock.id,
      trackedBlock.runs[0].text.length,
    );

    const painter = createTestPainter({ blocks: [trackedBlock], measures: [paragraphMeasure] });
    painter.paint(paragraphLayout, mount);

    const span = mount.querySelector('.superdoc-line span') as HTMLElement;
    expect(span.style.getPropertyValue('--sd-tracked-changes-insert-border')).toBe('red');
    expect(span.style.getPropertyValue('--sd-tracked-changes-insert-background')).toBe('');
    expect(span.style.getPropertyValue('--sd-tracked-changes-insert-background-focused')).toBe('');
  });

  it('renders overlapping parent insert and child delete as an insertion with delete strikethrough metadata', () => {
    const overlapBlock = createOverlapTrackedBlock('review');
    const { paragraphMeasure, paragraphLayout } = buildSingleParagraphData(
      overlapBlock.id,
      (overlapBlock.runs[0] as TextRun).text.length,
    );

    const painter = createTestPainter({ blocks: [overlapBlock], measures: [paragraphMeasure] });
    painter.paint(paragraphLayout, mount);

    const span = mount.querySelector('[data-track-change-id="ins-parent"]') as HTMLElement;
    expect(span).toBeTruthy();
    expect(span.classList.contains('track-insert-dec')).toBe(true);
    expect(span.classList.contains('track-delete-dec')).toBe(true);
    expect(span.classList.contains('track-overlap-insert-delete-dec')).toBe(true);
    expect(span.classList.contains('highlighted')).toBe(true);
    expect(span.dataset.trackChangeKind).toBe('insert');
    expect(span.dataset.trackChangeIds).toBe('ins-parent,del-child');
    expect(span.dataset.trackChangeKinds).toBe('insert,delete');
    expect(span.dataset.trackChangePreferredTargetId).toBe('del-child');

    const styleEl = document.head.querySelector('[data-superdoc-track-change-styles="true"]') as HTMLStyleElement;
    expect(styleEl).toBeTruthy();
    const cssText = styleEl.textContent ?? '';
    const deleteRuleIndex = cssText.indexOf('.superdoc-layout .track-delete-dec.highlighted');
    const overlapRuleIndex = cssText.indexOf(
      '.superdoc-layout .track-overlap-insert-delete-dec.track-insert-dec.track-delete-dec.highlighted',
    );
    expect(deleteRuleIndex).toBeGreaterThanOrEqual(0);
    expect(overlapRuleIndex).toBeGreaterThan(deleteRuleIndex);

    const overlapRule =
      cssText.match(
        /\.superdoc-layout \.track-overlap-insert-delete-dec\.track-insert-dec\.track-delete-dec\.highlighted\s*\{([\s\S]*?)\}/,
      )?.[1] ?? '';
    expect(overlapRule).toContain('var(--sd-tracked-changes-insert-border, #00853d)');
    expect(overlapRule).toContain('background-color: var(--sd-tracked-changes-insert-background, #399c7222);');
    expect(overlapRule).toContain('color: var(--sd-tracked-changes-insert-text, currentColor);');
    expect(overlapRule).toMatch(
      /text-decoration:\s*line-through\s+solid\s+var\(--sd-tracked-changes-delete-text,\s*#cb0e47\)\s+var\(--sd-tracked-changes-delete-decoration-thickness,\s*2px\)\s*!important;/,
    );

    const overlapFocusRule =
      cssText.match(
        /\.superdoc-layout \.track-overlap-insert-delete-dec\.track-insert-dec\.track-delete-dec\.highlighted\.track-change-focused\s*\{([\s\S]*?)\}/,
      )?.[1] ?? '';
    expect(overlapFocusRule).toContain(
      'background-color: var(--sd-tracked-changes-insert-background-focused, #399c7244);',
    );
    expect(overlapFocusRule).toContain('border-top-style: solid;');
    expect(overlapFocusRule).toContain('border-bottom-style: solid;');
    expect(overlapFocusRule).toMatch(
      /text-decoration:\s*line-through\s+solid\s+var\(--sd-tracked-changes-delete-text,\s*#cb0e47\)\s+var\(--sd-tracked-changes-delete-decoration-thickness,\s*2px\)\s*!important;/,
    );
  });

  it('keeps overlap visibility driven by all revision layers', () => {
    const originalBlock = createOverlapTrackedBlock('original');
    const finalBlock = createOverlapTrackedBlock('final');
    const { paragraphMeasure: originalMeasure, paragraphLayout: originalLayout } = buildSingleParagraphData(
      originalBlock.id,
      (originalBlock.runs[0] as TextRun).text.length,
    );
    const { paragraphMeasure: finalMeasure, paragraphLayout: finalLayout } = buildSingleParagraphData(
      finalBlock.id,
      (finalBlock.runs[0] as TextRun).text.length,
    );

    const painter = createTestPainter({ blocks: [originalBlock], measures: [originalMeasure] });
    painter.paint(originalLayout, mount);

    let span = mount.querySelector('[data-track-change-id="ins-parent"]') as HTMLElement;
    expect(span).toBeTruthy();
    expect(span.classList.contains('track-overlap-insert-delete-dec')).toBe(true);
    expect(span.classList.contains('hidden')).toBe(true);

    painter.setData([finalBlock], [finalMeasure]);
    painter.paint(finalLayout, mount);

    span = mount.querySelector('[data-track-change-id="ins-parent"]') as HTMLElement;
    expect(span).toBeTruthy();
    expect(span.classList.contains('track-overlap-insert-delete-dec')).toBe(true);
    expect(span.classList.contains('normal')).toBe(true);
    expect(span.classList.contains('hidden')).toBe(true);
    expect(span.classList.contains('highlighted')).toBe(false);
  });

  it('stamps comment metadata on tracked-change text', () => {
    const trackedCommentBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'tracked-comment-block',
      runs: [
        {
          text: 'Replace me',
          fontFamily: 'Arial',
          fontSize: 16,
          comments: [{ commentId: 'comment-1', internal: false, trackedChange: true }],
          trackedChange: {
            kind: 'insert',
            id: 'change-1',
          },
        },
      ],
    };

    const { paragraphMeasure, paragraphLayout } = buildSingleParagraphData(
      trackedCommentBlock.id,
      trackedCommentBlock.runs[0].text.length,
    );

    const painter = createTestPainter({ blocks: [trackedCommentBlock], measures: [paragraphMeasure] });
    painter.paint(paragraphLayout, mount);

    const span = mount.querySelector('.superdoc-comment-highlight') as HTMLElement;
    expect(span).toBeTruthy();
    expect(span.dataset.commentIds).toBe('comment-1');
    // Highlight styles are applied post-paint by CommentHighlightDecorator, not the painter
  });

  it('stamps comment metadata alongside Word highlight formatting (SD-2188)', () => {
    const highlightedCommentBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'highlight-comment-block',
      runs: [
        {
          text: 'Highlighted and commented',
          fontFamily: 'Arial',
          fontSize: 16,
          highlight: '#ffff00',
          comments: [{ commentId: 'comment-hl', internal: false, trackedChange: false }],
        },
      ],
    };

    const { paragraphMeasure, paragraphLayout } = buildSingleParagraphData(
      highlightedCommentBlock.id,
      highlightedCommentBlock.runs[0].text.length,
    );

    const painter = createTestPainter({ blocks: [highlightedCommentBlock], measures: [paragraphMeasure] });
    painter.paint(paragraphLayout, mount);

    const span = mount.querySelector('.superdoc-comment-highlight') as HTMLElement;
    expect(span).toBeTruthy();
    expect(span.dataset.commentIds).toBe('comment-hl');
    // Painter stamps metadata; CommentHighlightDecorator applies highlight colors post-paint
  });

  it('stamps comment metadata for non-tracked-change comments', () => {
    const commentBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'comment-block',
      runs: [
        {
          text: 'Commented text',
          fontFamily: 'Arial',
          fontSize: 16,
          comments: [{ commentId: 'comment-2', internal: false, trackedChange: false }],
        },
      ],
    };

    const { paragraphMeasure, paragraphLayout } = buildSingleParagraphData(
      commentBlock.id,
      commentBlock.runs[0].text.length,
    );

    const painter = createTestPainter({ blocks: [commentBlock], measures: [paragraphMeasure] });
    painter.paint(paragraphLayout, mount);

    const span = mount.querySelector('.superdoc-comment-highlight') as HTMLElement;
    expect(span).toBeTruthy();
    expect(span.dataset.commentIds).toBe('comment-2');
    expect(span.classList.contains('superdoc-comment-highlight')).toBe(true);
  });

  it('stamps internal comment IDs in data-comment-internal-ids', () => {
    const commentBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'internal-comment-block',
      runs: [
        {
          text: 'Internal text',
          fontFamily: 'Arial',
          fontSize: 16,
          comments: [
            { commentId: 'ext-1', internal: false },
            { commentId: 'int-1', internal: true },
          ],
        },
      ],
    };

    const { paragraphMeasure, paragraphLayout } = buildSingleParagraphData(
      commentBlock.id,
      commentBlock.runs[0].text.length,
    );

    const painter = createTestPainter({ blocks: [commentBlock], measures: [paragraphMeasure] });
    painter.paint(paragraphLayout, mount);

    const span = mount.querySelector('.superdoc-comment-highlight') as HTMLElement;
    expect(span).toBeTruthy();
    expect(span.dataset.commentIds).toBe('ext-1,int-1');
    expect(span.dataset.commentInternal).toBe('true');
    expect(span.dataset.commentInternalIds).toBe('int-1');
  });

  it('stamps imported ID aliases in data-comment-imported-ids', () => {
    const commentBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'imported-comment-block',
      runs: [
        {
          text: 'Imported text',
          fontFamily: 'Arial',
          fontSize: 16,
          comments: [{ commentId: 'uuid-1', importedId: 'w:comment-7', internal: false }],
        },
      ],
    };

    const { paragraphMeasure, paragraphLayout } = buildSingleParagraphData(
      commentBlock.id,
      commentBlock.runs[0].text.length,
    );

    const painter = createTestPainter({ blocks: [commentBlock], measures: [paragraphMeasure] });
    painter.paint(paragraphLayout, mount);

    const span = mount.querySelector('.superdoc-comment-highlight') as HTMLElement;
    expect(span).toBeTruthy();
    expect(span.dataset.commentIds).toBe('uuid-1');
    expect(span.dataset.commentImportedIds).toBe('w:comment-7=uuid-1');
  });

  it('preserves comment metadata across repeated repaints', () => {
    const commentBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'active-comment-block',
      runs: [
        {
          text: 'Commented text',
          fontFamily: 'Arial',
          fontSize: 16,
          comments: [{ commentId: 'comment-A', internal: false }],
        },
      ],
    };

    const { paragraphMeasure, paragraphLayout } = buildSingleParagraphData(
      commentBlock.id,
      commentBlock.runs[0].text.length,
    );

    const painter = createTestPainter({ blocks: [commentBlock], measures: [paragraphMeasure] });

    painter.paint(paragraphLayout, mount);
    let span = mount.querySelector('.superdoc-comment-highlight') as HTMLElement;
    expect(span.dataset.commentIds).toBe('comment-A');

    painter.paint(paragraphLayout, mount);
    span = mount.querySelector('.superdoc-comment-highlight') as HTMLElement;
    expect(span.dataset.commentIds).toBe('comment-A');

    painter.paint(paragraphLayout, mount);
    span = mount.querySelector('.superdoc-comment-highlight') as HTMLElement;
    expect(span.dataset.commentIds).toBe('comment-A');
  });

  it('stamps metadata for nested comments (multiple IDs)', () => {
    const nestedCommentBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'nested-comment-block',
      runs: [
        {
          text: 'Nested area',
          fontFamily: 'Arial',
          fontSize: 16,
          comments: [
            { commentId: 'outer-comment', internal: false },
            { commentId: 'inner-comment', internal: false },
          ],
        },
      ],
    };

    const { paragraphMeasure, paragraphLayout } = buildSingleParagraphData(
      nestedCommentBlock.id,
      nestedCommentBlock.runs[0].text.length,
    );

    const painter = createTestPainter({ blocks: [nestedCommentBlock], measures: [paragraphMeasure] });
    painter.paint(paragraphLayout, mount);

    const span = mount.querySelector('.superdoc-comment-highlight') as HTMLElement;
    expect(span).toBeTruthy();
    expect(span.dataset.commentIds).toBe('outer-comment,inner-comment');
  });

  it('respects trackedChangesMode modifiers for insertions', () => {
    const finalBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'final-block',
      runs: [
        {
          text: 'Kept content',
          fontFamily: 'Arial',
          fontSize: 16,
          trackedChange: {
            kind: 'insert',
            id: 'change-final',
          },
        },
      ],
      attrs: {
        trackedChangesMode: 'final',
        trackedChangesEnabled: true,
      },
    };

    const { paragraphMeasure, paragraphLayout } = buildSingleParagraphData(
      finalBlock.id,
      finalBlock.runs[0].text.length,
    );

    const painter = createTestPainter({ blocks: [finalBlock], measures: [paragraphMeasure] });
    painter.paint(paragraphLayout, mount);

    const span = mount.querySelector('[data-track-change-id="change-final"]') as HTMLElement;
    expect(span.classList.contains('track-insert-dec')).toBe(true);
    expect(span.classList.contains('normal')).toBe(true);
    expect(span.classList.contains('highlighted')).toBe(false);
  });

  it('omits track-change styling when disabled', () => {
    const disabledBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'disabled-block',
      runs: [
        {
          text: 'Hidden metadata',
          fontFamily: 'Arial',
          fontSize: 16,
          trackedChange: {
            kind: 'insert',
            id: 'disabled-change',
          },
        },
      ],
      attrs: {
        trackedChangesMode: 'review',
        trackedChangesEnabled: false,
      },
    };

    const { paragraphMeasure, paragraphLayout } = buildSingleParagraphData(
      disabledBlock.id,
      disabledBlock.runs[0].text.length,
    );

    const painter = createTestPainter({ blocks: [disabledBlock], measures: [paragraphMeasure] });
    painter.paint(paragraphLayout, mount);

    const span = mount.querySelector('.superdoc-line span') as HTMLElement;
    expect(span.classList.contains('track-insert-dec')).toBe(false);
    expect(span.dataset.trackChangeId).toBeUndefined();
    expect(span.dataset.trackChangeKind).toBeUndefined();
  });

  it('re-renders tracked changes if current version has no tracked changes but next version does', () => {
    const blockId = 'tracked-version-block';
    const trackedAttrs = {
      trackedChangesMode: 'review' as const,
      trackedChangesEnabled: true,
    };
    const originalBlock: FlowBlock = {
      kind: 'paragraph',
      id: blockId,
      runs: [
        {
          text: 'Pending review',
          fontFamily: 'Arial',
          fontSize: 16,
        },
      ],
      attrs: trackedAttrs,
    };

    const updatedBlock: FlowBlock = {
      ...originalBlock,
      runs: [
        {
          ...originalBlock.runs[0],
          trackedChange: {
            kind: 'delete',
            id: 'tc-new',
          },
        },
      ],
    };

    const { paragraphMeasure, paragraphLayout } = buildSingleParagraphData(blockId, originalBlock.runs[0].text.length);

    const painter = createTestPainter({ blocks: [originalBlock], measures: [paragraphMeasure] });
    painter.paint(paragraphLayout, mount);

    expect(mount.querySelector('[data-track-change-id]')).toBeNull();

    painter.setData([updatedBlock], [paragraphMeasure]);
    painter.paint(paragraphLayout, mount);

    const trackedSpan = mount.querySelector('[data-track-change-id="tc-new"]') as HTMLElement;
    expect(trackedSpan).toBeTruthy();
    expect(trackedSpan.classList.contains('track-delete-dec')).toBe(true);
    expect(trackedSpan.classList.contains('highlighted')).toBe(true);
  });

  it('injects a delete-decoration reset that overrides inherited underline metadata', () => {
    document.body.appendChild(mount);
    mount.style.setProperty('--sd-tracked-changes-delete-text', '#2e64a8');
    mount.style.setProperty('--sd-tracked-changes-delete-decoration-thickness', '1.5px');

    try {
      const trackedDeleteBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'tracked-delete-underline-reset',
        runs: [
          {
            text: 'Deleted underlined text',
            fontFamily: 'Arial',
            fontSize: 16,
            underline: {
              style: 'wavy',
              color: '#1f9d55',
            },
            trackedChange: {
              kind: 'delete',
              id: 'tracked-delete-1',
            },
          },
        ],
        attrs: {
          trackedChangesMode: 'review',
          trackedChangesEnabled: true,
        },
      };

      const { paragraphMeasure, paragraphLayout } = buildSingleParagraphData(
        trackedDeleteBlock.id,
        trackedDeleteBlock.runs[0].text.length,
      );

      const painter = createTestPainter({ blocks: [trackedDeleteBlock], measures: [paragraphMeasure] });
      painter.paint(paragraphLayout, mount);

      const trackedSpan = mount.querySelector('[data-track-change-id="tracked-delete-1"]') as HTMLElement;
      expect(trackedSpan).toBeTruthy();
      expect(trackedSpan.style.textDecorationLine).toBe('underline');
      expect(trackedSpan.style.textDecorationStyle).toBe('wavy');
      expectCssColor(trackedSpan.style.textDecorationColor, '#1f9d55');

      const styleEl = document.head.querySelector('[data-superdoc-track-change-styles="true"]') as HTMLStyleElement;
      expect(styleEl).toBeTruthy();
      expect(styleEl.textContent).toMatch(
        /\.track-delete-dec\.highlighted\s*\{[\s\S]*text-decoration:\s*line-through\s+solid\s+var\(--sd-tracked-changes-delete-text,\s*currentColor\)\s+var\(--sd-tracked-changes-delete-decoration-thickness,\s*2px\)\s*!important;/,
      );
    } finally {
      mount.remove();
    }
  });

  describe('token resolution tests', () => {
    it('renders footer with page numbers resolved', () => {
      const footerBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'footer-block',
        runs: [
          { text: 'Footer: ', fontFamily: 'Arial', fontSize: 12 },
          { text: '0', fontFamily: 'Arial', fontSize: 12, token: 'pageNumber' },
        ],
      };
      const footerMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 1,
            toChar: 1,
            width: 80,
            ascent: 10,
            descent: 2,
            lineHeight: 14,
          },
        ],
        totalHeight: 14,
      };
      const footerFragment = {
        kind: 'para' as const,
        blockId: 'footer-block',
        fromLine: 0,
        toLine: 1,
        x: 0,
        y: 0,
        width: 200,
      };

      const painter = createTestPainter({
        blocks: [block, footerBlock],
        measures: [measure, footerMeasure],
        footerProvider: () => ({ fragments: [footerFragment], height: 14 }),
      });

      painter.paint({ ...layout, pages: [{ ...layout.pages[0], number: 3 }] }, mount);

      const footerEl = mount.querySelector('.superdoc-page-footer');
      expect(footerEl).toBeTruthy();
      expect(footerEl?.textContent).toBe('Footer: 3');
    });

    it('renders footer page-number tokens with explicit field format metadata', () => {
      const footerBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'footer-formatted-page',
        runs: [
          {
            text: '0',
            fontFamily: 'Arial',
            fontSize: 12,
            token: 'pageNumber',
            pageNumberFieldFormat: { format: 'numberInDash' },
          },
        ],
      };
      const footerMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 1,
            width: 40,
            ascent: 10,
            descent: 2,
            lineHeight: 14,
          },
        ],
        totalHeight: 14,
      };
      const footerFragment = {
        kind: 'para' as const,
        blockId: 'footer-formatted-page',
        fromLine: 0,
        toLine: 1,
        x: 0,
        y: 0,
        width: 200,
      };

      const painter = createTestPainter({
        blocks: [block, footerBlock],
        measures: [measure, footerMeasure],
        footerProvider: () => ({ fragments: [footerFragment], height: 14 }),
      });

      painter.paint(
        { ...layout, pages: [{ ...layout.pages[0], number: 10, displayNumber: 4, numberText: 'iv' }] },
        mount,
      );

      const footerEl = mount.querySelector('.superdoc-page-footer');
      expect(footerEl).toBeTruthy();
      expect(footerEl?.textContent).toBe('- 4 -');
    });

    it('bottom-aligns footer content within the footer box', () => {
      const footerBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'footer-align',
        runs: [{ text: 'Footer', fontFamily: 'Arial', fontSize: 12 }],
      };
      const footerMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 1,
            toChar: 1,
            width: 60,
            ascent: 8,
            descent: 2,
            lineHeight: 10,
          },
        ],
        totalHeight: 10,
      };
      const footerFragment = {
        kind: 'para' as const,
        blockId: 'footer-align',
        fromLine: 0,
        toLine: 1,
        x: 0,
        y: 0,
        width: 200,
      };
      const footerHeight = 60;
      const contentHeight = 20;
      const footerOffset = 400;

      const painter = createTestPainter({
        blocks: [block, footerBlock],
        measures: [measure, footerMeasure],
        footerProvider: () => ({
          fragments: [footerFragment],
          height: footerHeight,
          contentHeight,
          offset: footerOffset,
        }),
      });

      painter.paint({ ...layout, pages: [{ ...layout.pages[0], number: 1 }] }, mount);

      const footerEl = mount.querySelector('.superdoc-page-footer') as HTMLElement;
      const fragEl = mount.querySelector('.superdoc-page-footer .superdoc-fragment') as HTMLElement;
      expect(fragEl).toBeTruthy();
      expect(footerEl.style.top).toBe(`${footerOffset}px`);
      expect(fragEl.style.top).toBe(`${footerHeight - contentHeight + footerFragment.y}px`);
    });

    it('applies paragraph rtl direction inside footer content', () => {
      const footerBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'footer-rtl',
        runs: [
          { text: 'الإصدار', fontFamily: 'Arial', fontSize: 12 },
          { text: ' ', fontFamily: 'Arial', fontSize: 12 },
          { text: '<1.0>', fontFamily: 'Arial', fontSize: 12 },
        ],
        attrs: {
          alignment: 'center',
          directionContext: { inlineDirection: 'rtl', writingMode: 'horizontal-tb' },
        },
      };
      const footerMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 2,
            toChar: 5,
            width: 120,
            ascent: 8,
            descent: 2,
            lineHeight: 10,
          },
        ],
        totalHeight: 10,
      };
      const footerFragment = {
        kind: 'para' as const,
        blockId: 'footer-rtl',
        fromLine: 0,
        toLine: 1,
        x: 0,
        y: 0,
        width: 200,
      };

      const painter = createTestPainter({
        blocks: [block, footerBlock],
        measures: [measure, footerMeasure],
        footerProvider: () => ({ fragments: [footerFragment], height: 14 }),
      });

      painter.paint({ ...layout, pages: [{ ...layout.pages[0], number: 2 }] }, mount);

      const footerFragmentEl = mount.querySelector('.superdoc-page-footer .superdoc-fragment') as HTMLElement;
      expect(footerFragmentEl).toBeTruthy();
      expect(footerFragmentEl.getAttribute('dir')).toBe('rtl');
      expect(footerFragmentEl.style.direction).toBe('rtl');
    });

    it('renders page-relative behindDoc header media at absolute page Y', () => {
      const headerImageBlock: FlowBlock = {
        kind: 'image',
        id: 'header-page-relative-img',
        src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        anchor: {
          isAnchored: true,
          hRelativeFrom: 'page',
          vRelativeFrom: 'page',
          behindDoc: true,
        },
      };
      const headerImageMeasure: Measure = {
        kind: 'image',
        width: 24,
        height: 14,
      };
      const headerFragment: Fragment = {
        kind: 'image',
        blockId: 'header-page-relative-img',
        x: 12,
        y: 40,
        width: 24,
        height: 14,
        isAnchored: true,
        behindDoc: true,
      };

      const painter = createTestPainter({
        blocks: [block, headerImageBlock],
        measures: [measure, headerImageMeasure],
        headerProvider: () => ({
          fragments: [headerFragment],
          height: 20,
          offset: 60,
          marginLeft: 30,
        }),
      });

      painter.paint({ ...layout, pages: [{ ...layout.pages[0], number: 1 }] }, mount);

      const pageEl = mount.querySelector('.superdoc-page') as HTMLElement;
      const behindDocEl = pageEl.querySelector(
        '[data-behind-doc-section="header"][data-block-id="header-page-relative-img"]',
      ) as HTMLElement;

      expect(behindDocEl).toBeTruthy();
      expect(behindDocEl.style.top).toBe('40px');
      expect(behindDocEl.style.left).toBe('12px');
    });

    it('renders footer page-relative media using normalized band-local coordinates', () => {
      const footerImageBlock: FlowBlock = {
        kind: 'image',
        id: 'footer-page-relative-img',
        src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        anchor: {
          isAnchored: true,
          hRelativeFrom: 'page',
          vRelativeFrom: 'page',
        },
      };
      const footerImageMeasure: Measure = {
        kind: 'image',
        width: 20,
        height: 20,
      };
      // fragment.y = 25 represents a footer-band-local coordinate
      // (produced by normalizeFragmentsForRegion in the layout engine)
      const footerFragment: Fragment = {
        kind: 'image',
        blockId: 'footer-page-relative-img',
        x: 8,
        y: 25,
        width: 20,
        height: 20,
        isAnchored: true,
      };

      const footerOffset = 400;
      const footerHeight = 80;
      const footerContentHeight = 30;

      const painter = createTestPainter({
        blocks: [block, footerImageBlock],
        measures: [measure, footerImageMeasure],
        footerProvider: () => ({
          fragments: [footerFragment],
          height: footerHeight,
          contentHeight: footerContentHeight,
          offset: footerOffset,
        }),
      });

      painter.paint(
        {
          ...layout,
          pages: [
            {
              ...layout.pages[0],
              number: 1,
              margins: { left: 0, right: 0, bottom: 100, footer: 20 },
            },
          ],
        },
        mount,
      );

      const footerEl = mount.querySelector('.superdoc-page-footer') as HTMLElement;
      const footerFragmentEl = footerEl.querySelector('[data-block-id="footer-page-relative-img"]') as HTMLElement;

      expect(footerFragmentEl).toBeTruthy();
      // Footer container is at effectiveOffset (400px)
      expect(footerEl.style.top).toBe(`${footerOffset}px`);
      // Fragment uses band-local Y + container offset from band origin.
      // With footer distance provided, anchors convert back to absolute page-space
      // using the physical footer reference point (pageHeight - footerDistance).
      const renderedPageTop = parseFloat(footerEl.style.top || '0') + parseFloat(footerFragmentEl.style.top || '0');
      expect(renderedPageTop).toBe((layout.pageSize?.h ?? 0) - 20 + footerFragment.y);
    });

    it('falls back to bottom margin origin when footer distance is missing', () => {
      const footerImageBlock: FlowBlock = {
        kind: 'image',
        id: 'footer-page-relative-img-missing',
        src: 'data:image/png;base64,xxx',
        anchor: {
          isAnchored: true,
          hRelativeFrom: 'page',
          vRelativeFrom: 'page',
        },
      };
      const footerImageMeasure: Measure = {
        kind: 'image',
        width: 20,
        height: 20,
      };
      const footerOffset = 400;
      const footerFragment: Fragment = {
        kind: 'image',
        blockId: footerImageBlock.id,
        x: 0,
        y: 25,
        width: 20,
        height: 20,
        isAnchored: true,
      };

      const painter = createTestPainter({
        blocks: [block, footerImageBlock],
        measures: [measure, footerImageMeasure],
        footerProvider: () => ({
          fragments: [footerFragment],
          height: 80,
          offset: footerOffset,
        }),
      });

      painter.paint(
        {
          ...layout,
          pages: [
            {
              ...layout.pages[0],
              number: 1,
              margins: { left: 0, right: 0, bottom: 100 },
            },
          ],
        },
        mount,
      );

      const footerEl = mount.querySelector('.superdoc-page-footer') as HTMLElement;
      const footerFragmentEl = footerEl.querySelector(
        '[data-block-id="footer-page-relative-img-missing"]',
      ) as HTMLElement;

      expect(footerFragmentEl).toBeTruthy();
      const renderedPageTop = parseFloat(footerEl.style.top || '0') + parseFloat(footerFragmentEl.style.top || '0');
      expect(renderedPageTop).toBe(footerOffset + footerFragment.y);
    });

    it('preserves bold styling on page number tokens in DOM', () => {
      const headerBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'header-bold',
        runs: [
          { text: 'Page ', fontFamily: 'Arial', fontSize: 14 },
          { text: '0', fontFamily: 'Arial', fontSize: 14, bold: true, token: 'pageNumber' },
        ],
      };
      const headerMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 1,
            toChar: 1,
            width: 60,
            ascent: 10,
            descent: 4,
            lineHeight: 16,
          },
        ],
        totalHeight: 16,
      };
      const headerFragment = {
        kind: 'para' as const,
        blockId: 'header-bold',
        fromLine: 0,
        toLine: 1,
        x: 0,
        y: 0,
        width: 200,
      };

      const painter = createTestPainter({
        blocks: [block, headerBlock],
        measures: [measure, headerMeasure],
        headerProvider: () => ({ fragments: [headerFragment], height: 16 }),
      });

      painter.paint({ ...layout, pages: [{ ...layout.pages[0], number: 5 }] }, mount);

      const headerEl = mount.querySelector('.superdoc-page-header');
      expect(headerEl).toBeTruthy();
      expect(headerEl?.textContent).toBe('Page 5');

      // Verify bold styling is applied (browser normalizes to 'bold' in style.fontWeight)
      const boldSpan = headerEl?.querySelector('span:nth-child(2)') as HTMLElement;
      expect(boldSpan?.style.fontWeight).toBe('bold');
      expect(boldSpan?.textContent).toBe('5');
    });

    it('resolves different page numbers across multi-page document', () => {
      const headerBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'header-multi',
        runs: [{ text: '0', fontFamily: 'Arial', fontSize: 14, token: 'pageNumber' }],
      };
      const headerMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 1,
            width: 20,
            ascent: 10,
            descent: 4,
            lineHeight: 16,
          },
        ],
        totalHeight: 16,
      };
      const headerFragment = {
        kind: 'para' as const,
        blockId: 'header-multi',
        fromLine: 0,
        toLine: 1,
        x: 0,
        y: 0,
        width: 200,
      };

      const painter = createTestPainter({
        blocks: [block, headerBlock],
        measures: [measure, headerMeasure],
        headerProvider: () => ({ fragments: [headerFragment], height: 16 }),
      });

      const multiPageLayout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          { number: 1, fragments: [] },
          { number: 2, fragments: [] },
          { number: 3, fragments: [] },
        ],
      };

      painter.paint(multiPageLayout, mount);

      const pages = mount.querySelectorAll('.superdoc-page');
      expect(pages).toHaveLength(3);

      const header1 = pages[0].querySelector('.superdoc-page-header');
      const header2 = pages[1].querySelector('.superdoc-page-header');
      const header3 = pages[2].querySelector('.superdoc-page-header');

      expect(header1?.textContent).toBe('1');
      expect(header2?.textContent).toBe('2');
      expect(header3?.textContent).toBe('3');
    });

    it('renders header with only totalPageCount token', () => {
      const headerBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'header-total',
        runs: [
          { text: 'Total pages: ', fontFamily: 'Arial', fontSize: 14 },
          { text: '0', fontFamily: 'Arial', fontSize: 14, token: 'totalPageCount' },
        ],
      };
      const headerMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 1,
            toChar: 1,
            width: 100,
            ascent: 10,
            descent: 4,
            lineHeight: 16,
          },
        ],
        totalHeight: 16,
      };
      const headerFragment = {
        kind: 'para' as const,
        blockId: 'header-total',
        fromLine: 0,
        toLine: 1,
        x: 0,
        y: 0,
        width: 200,
      };

      const painter = createTestPainter({
        blocks: [block, headerBlock],
        measures: [measure, headerMeasure],
        headerProvider: () => ({ fragments: [headerFragment], height: 16 }),
      });

      const threePageLayout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          { number: 1, fragments: [] },
          { number: 2, fragments: [] },
          { number: 3, fragments: [] },
        ],
      };

      painter.paint(threePageLayout, mount);

      const headerEl = mount.querySelector('.superdoc-page-header');
      expect(headerEl).toBeTruthy();
      expect(headerEl?.textContent).toBe('Total pages: 3');
    });

    it('uses placeholder text when totalPages cannot be determined', () => {
      const headerBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'header-fallback',
        runs: [
          { text: 'Count: ', fontFamily: 'Arial', fontSize: 14 },
          { text: '99', fontFamily: 'Arial', fontSize: 14, token: 'totalPageCount' },
        ],
      };
      const headerMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 1,
            toChar: 2,
            width: 80,
            ascent: 10,
            descent: 4,
            lineHeight: 16,
          },
        ],
        totalHeight: 16,
      };
      const headerFragment = {
        kind: 'para' as const,
        blockId: 'header-fallback',
        fromLine: 0,
        toLine: 1,
        x: 0,
        y: 0,
        width: 200,
      };

      const painter = createTestPainter({
        blocks: [block, headerBlock],
        measures: [measure, headerMeasure],
        headerProvider: () => ({ fragments: [headerFragment], height: 16 }),
      });

      // Single page layout - totalPageCount resolves to 1 from layout.pages.length
      painter.paint({ ...layout, pages: [{ number: 1, fragments: [] }] }, mount);

      const headerEl = mount.querySelector('.superdoc-page-header');
      expect(headerEl).toBeTruthy();
      // totalPageCount is resolved from layout.pages.length = 1
      expect(headerEl?.textContent).toBe('Count: 1');
    });
  });

  it('applies resolved zIndex only to anchored media fragments', () => {
    const anchoredDrawingBlock: FlowBlock = {
      kind: 'drawing',
      id: 'drawing-anchored',
      drawingKind: 'vectorShape',
      geometry: { width: 10, height: 10 },
      anchor: { isAnchored: true },
    };

    const inlineDrawingBlock: FlowBlock = {
      kind: 'drawing',
      id: 'drawing-inline',
      drawingKind: 'vectorShape',
      geometry: { width: 10, height: 10 },
      zIndex: 1,
    };

    const drawingMeasure: Measure = {
      kind: 'drawing',
      drawingKind: 'vectorShape',
      width: 30,
      height: 15,
      scale: 1,
      naturalWidth: 30,
      naturalHeight: 15,
      geometry: { width: 10, height: 10 },
    };

    const drawingLayout: Layout = {
      pageSize: layout.pageSize,
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'drawing',
              drawingKind: 'vectorShape',
              blockId: 'drawing-anchored',
              x: 30,
              y: 40,
              width: 30,
              height: 15,
              isAnchored: true,
              zIndex: 7,
              geometry: { width: 10, height: 10 },
              scale: 1,
            },
            {
              kind: 'drawing',
              drawingKind: 'vectorShape',
              blockId: 'drawing-inline',
              x: 30,
              y: 80,
              width: 30,
              height: 15,
              zIndex: 1,
              geometry: { width: 10, height: 10 },
              scale: 1,
            },
          ],
        },
      ],
    };

    const resolvedLayout: ResolvedLayout = {
      version: 1,
      flowMode: 'paginated',
      pageGap: 0,
      pages: [
        {
          id: 'page-0',
          index: 0,
          number: 1,
          width: 400,
          height: 500,
          items: [
            {
              kind: 'fragment',
              id: 'drawing:drawing-anchored:30:40',
              pageIndex: 0,
              x: 30,
              y: 40,
              width: 30,
              height: 15,
              zIndex: 7,
              fragmentKind: 'drawing',
              fragment: drawingLayout.pages[0].fragments[0],
              blockId: 'drawing-anchored',
              fragmentIndex: 0,
              block: anchoredDrawingBlock as import('@superdoc/contracts').DrawingBlock,
            },
            {
              kind: 'fragment',
              id: 'drawing:drawing-inline:30:80',
              pageIndex: 0,
              x: 30,
              y: 80,
              width: 30,
              height: 15,
              zIndex: 1,
              fragmentKind: 'drawing',
              fragment: drawingLayout.pages[0].fragments[1],
              blockId: 'drawing-inline',
              fragmentIndex: 1,
              block: inlineDrawingBlock as import('@superdoc/contracts').DrawingBlock,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({
      blocks: [anchoredDrawingBlock, inlineDrawingBlock],
      measures: [drawingMeasure, drawingMeasure],
    });

    painter.setResolvedLayout(resolvedLayout);
    painter.paint(drawingLayout, mount);

    const anchoredDrawingEl = mount.querySelector('[data-block-id="drawing-anchored"]') as HTMLElement;
    const inlineDrawingEl = mount.querySelector('[data-block-id="drawing-inline"]') as HTMLElement;

    expect(anchoredDrawingEl.style.zIndex).toBe('7');
    expect(inlineDrawingEl.style.zIndex).toBe('');
  });

  it('applies vector shape transforms to the shared drawing wrapper so text overlays rotate with the shape', () => {
    const vectorShapeBlock: FlowBlock = {
      kind: 'drawing',
      id: 'drawing-with-text',
      drawingKind: 'vectorShape',
      geometry: { width: 100, height: 50, rotation: 320, flipH: false, flipV: false },
      shapeKind: 'rect',
      textContent: {
        parts: [
          {
            text: 'AUTE',
            fontFamily: 'Arial',
            fontSize: 32,
            color: '#c0c0c0',
          },
        ],
      },
      textAlign: 'center',
    };

    const vectorShapeMeasure: Measure = {
      kind: 'drawing',
      drawingKind: 'vectorShape',
      width: 100,
      height: 50,
      scale: 1,
      naturalWidth: 100,
      naturalHeight: 50,
      geometry: { width: 100, height: 50, rotation: 320, flipH: false, flipV: false },
    };

    const vectorShapeLayout: Layout = {
      pageSize: layout.pageSize,
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'drawing',
              drawingKind: 'vectorShape',
              blockId: 'drawing-with-text',
              x: 30,
              y: 40,
              width: 100,
              height: 50,
              geometry: { width: 100, height: 50, rotation: 320, flipH: false, flipV: false },
              scale: 1,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [vectorShapeBlock], measures: [vectorShapeMeasure] });
    painter.paint(vectorShapeLayout, mount);

    const shapeEl = mount.querySelector('.superdoc-vector-shape') as HTMLElement | null;
    const drawingInner = mount.querySelector('.superdoc-drawing-inner') as HTMLElement | null;
    const svgEl = shapeEl?.querySelector('svg') as HTMLElement | null;

    expect(shapeEl).toBeTruthy();
    expect(drawingInner).toBeTruthy();
    expect(drawingInner?.style.transform).toContain('rotate(320deg)');
    expect(shapeEl?.textContent).toContain('AUTE');
    expect(svgEl?.style.transform).toBe('');
  });

  it('rebuilds drawing text with PAGE fields when page context changes during patch rendering', () => {
    const vectorShapeBlock: FlowBlock = {
      kind: 'drawing',
      id: 'drawing-page-field',
      drawingKind: 'vectorShape',
      geometry: { width: 100, height: 50, rotation: 0, flipH: false, flipV: false },
      shapeKind: 'rect',
      textContent: {
        parts: [
          { text: 'Page ', formatting: { fontFamily: 'Arial', fontSize: 18 } },
          { text: '', fieldType: 'PAGE', formatting: { fontFamily: 'Arial', fontSize: 18 } },
        ],
      },
      textAlign: 'center',
    };

    const vectorShapeMeasure: Measure = {
      kind: 'drawing',
      drawingKind: 'vectorShape',
      width: 100,
      height: 50,
      scale: 1,
      naturalWidth: 100,
      naturalHeight: 50,
      geometry: { width: 100, height: 50, rotation: 0, flipH: false, flipV: false },
    };

    const drawingFragment = {
      kind: 'drawing' as const,
      drawingKind: 'vectorShape' as const,
      blockId: 'drawing-page-field',
      x: 30,
      y: 40,
      width: 100,
      height: 50,
      geometry: { width: 100, height: 50, rotation: 0, flipH: false, flipV: false },
      scale: 1,
    };

    const painter = createTestPainter({ blocks: [vectorShapeBlock], measures: [vectorShapeMeasure] });
    const firstLayout: Layout = {
      pageSize: layout.pageSize,
      pages: [{ number: 1, numberText: '1', fragments: [drawingFragment] }],
    };
    const secondLayout: Layout = {
      pageSize: layout.pageSize,
      pages: [{ number: 2, numberText: '2', fragments: [drawingFragment] }],
    };

    painter.paint(firstLayout, mount);
    expect(mount.querySelector('.superdoc-vector-shape')?.textContent).toContain('Page 1');

    painter.paint(secondLayout, mount);
    expect(mount.querySelector('.superdoc-vector-shape')?.textContent).toContain('Page 2');
  });

  it('renders textboxShape contentMeasures as line-based DOM with pm datasets', () => {
    const textboxBlock: FlowBlock = {
      kind: 'drawing',
      id: 'drawing-textbox-lines',
      drawingKind: 'textboxShape',
      geometry: { width: 120, height: 80, rotation: 0, flipH: false, flipV: false },
      shapeKind: 'rect',
      fillColor: '#ffffff',
      strokeColor: '#000000',
      strokeWidth: 1,
      textInsets: { top: 4, right: 8, bottom: 4, left: 12 },
      contentBlocks: [
        {
          kind: 'paragraph',
          id: 'textbox-paragraph-lines',
          runs: [{ text: 'Textbox line', fontFamily: 'Arial', fontSize: 16, pmStart: 10, pmEnd: 22 }],
        },
      ],
      textContent: {
        parts: [{ text: 'Fallback textbox line' }],
      },
    };

    const textboxMeasure: Measure = {
      kind: 'drawing',
      drawingKind: 'textboxShape',
      width: 120,
      height: 80,
      scale: 1,
      naturalWidth: 120,
      naturalHeight: 80,
      geometry: { width: 120, height: 80, rotation: 0, flipH: false, flipV: false },
    };

    const textboxLayout: Layout = {
      pageSize: layout.pageSize,
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'drawing',
              drawingKind: 'textboxShape',
              blockId: 'drawing-textbox-lines',
              x: 30,
              y: 40,
              width: 120,
              height: 80,
              geometry: { width: 120, height: 80, rotation: 0, flipH: false, flipV: false },
              scale: 1,
              contentMeasures: [
                {
                  kind: 'paragraph',
                  lines: [
                    {
                      fromRun: 0,
                      fromChar: 0,
                      toRun: 0,
                      toChar: 12,
                      width: 80,
                      ascent: 12,
                      descent: 4,
                      lineHeight: 20,
                    },
                  ],
                  totalHeight: 20,
                },
              ],
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [textboxBlock], measures: [textboxMeasure] });
    painter.paint(textboxLayout, mount);

    const shapeEl = mount.querySelector('.superdoc-vector-shape') as HTMLElement | null;
    const lineEl = mount.querySelector('.superdoc-line') as HTMLElement | null;

    expect(shapeEl).toBeTruthy();
    expect(lineEl).toBeTruthy();
    expect(lineEl?.dataset.pmStart).toBe('10');
    expect(lineEl?.dataset.pmEnd).toBe('22');
    expect(shapeEl?.textContent).toContain('Textbox line');
    expect(shapeEl?.textContent).not.toContain('Fallback textbox line');
  });

  it('renders textboxShape fallback text inside table cells', () => {
    const textboxBlock: FlowBlock = {
      kind: 'drawing',
      id: 'table-textbox-drawing',
      drawingKind: 'textboxShape',
      geometry: { width: 120, height: 80, rotation: 0, flipH: false, flipV: false },
      shapeKind: 'rect',
      fillColor: '#ffffff',
      strokeColor: '#000000',
      strokeWidth: 1,
      textInsets: { top: 4, right: 8, bottom: 4, left: 12 },
      textContent: {
        parts: [{ text: 'Contract ACC' }],
      },
      contentBlocks: [],
    };

    const tableBlock: TableBlock = {
      kind: 'table',
      id: 'table-with-textbox',
      rows: [
        {
          id: 'row-0',
          cells: [
            {
              id: 'cell-0',
              blocks: [textboxBlock],
              attrs: {},
            },
          ],
        },
      ],
    };

    const textboxMeasure: Measure = {
      kind: 'drawing',
      drawingKind: 'textboxShape',
      width: 120,
      height: 80,
      scale: 1,
      naturalWidth: 120,
      naturalHeight: 80,
      geometry: { width: 120, height: 80, rotation: 0, flipH: false, flipV: false },
    };

    const tableMeasure: TableMeasure = {
      kind: 'table',
      rows: [
        {
          height: 80,
          cells: [
            {
              width: 140,
              height: 80,
              gridColumnStart: 0,
              blocks: [textboxMeasure],
            },
          ],
        },
      ],
      columnWidths: [140],
      totalWidth: 140,
      totalHeight: 80,
    };

    const tableLayout: Layout = {
      pageSize: { w: 300, h: 300 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'table',
              blockId: 'table-with-textbox',
              x: 0,
              y: 0,
              width: 140,
              height: 80,
              fromRow: 0,
              toRow: 1,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [tableBlock], measures: [tableMeasure] });
    painter.paint(tableLayout, mount);

    const shapeEl = mount.querySelector('.superdoc-vector-shape') as HTMLElement | null;
    expect(shapeEl).toBeTruthy();
    expect(shapeEl?.textContent).toContain('Contract ACC');
  });

  it('renders textboxShape with contentMeasures as superdoc-line DOM inside table cell', () => {
    const textboxBlock: FlowBlock = {
      kind: 'drawing',
      id: 'table-cell-textbox-lines',
      drawingKind: 'textboxShape',
      geometry: { width: 120, height: 80, rotation: 0, flipH: false, flipV: false },
      shapeKind: 'rect',
      textInsets: { top: 4, right: 8, bottom: 4, left: 12 },
      contentBlocks: [
        {
          kind: 'paragraph',
          id: 'cell-textbox-para',
          runs: [{ text: 'Cell text', fontFamily: 'Arial', fontSize: 14, pmStart: 5, pmEnd: 14 }],
        },
      ],
      contentMeasures: [
        {
          kind: 'paragraph',
          lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 9, width: 80, ascent: 12, descent: 4, lineHeight: 18 }],
          totalHeight: 18,
        },
      ],
    };

    const tableBlock: TableBlock = {
      kind: 'table',
      id: 'table-cell-textbox',
      rows: [{ id: 'row-0', cells: [{ id: 'cell-0', blocks: [textboxBlock], attrs: {} }] }],
    };

    const textboxMeasure: Measure = {
      kind: 'drawing',
      drawingKind: 'textboxShape',
      width: 120,
      height: 80,
      scale: 1,
      naturalWidth: 120,
      naturalHeight: 80,
      geometry: { width: 120, height: 80, rotation: 0, flipH: false, flipV: false },
    };
    const tableMeasure: TableMeasure = {
      kind: 'table',
      rows: [{ height: 80, cells: [{ width: 140, height: 80, gridColumnStart: 0, blocks: [textboxMeasure] }] }],
      columnWidths: [140],
      totalWidth: 140,
      totalHeight: 80,
    };

    const tableLayout: Layout = {
      pageSize: { w: 300, h: 300 },
      pages: [
        {
          number: 1,
          fragments: [
            { kind: 'table', blockId: 'table-cell-textbox', x: 0, y: 0, width: 140, height: 80, fromRow: 0, toRow: 1 },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [tableBlock], measures: [tableMeasure] });
    painter.paint(tableLayout, mount);

    const wrapper = mount.querySelector('[data-block-id="table-cell-textbox-lines"]') as HTMLElement | null;
    const lineEl = mount.querySelector('.superdoc-line') as HTMLElement | null;

    expect(wrapper).toBeTruthy();
    expect(lineEl).toBeTruthy();
    expect(lineEl?.dataset.pmStart).toBe('5');
    expect(lineEl?.dataset.pmEnd).toBe('14');
    expect(mount.querySelector('.superdoc-vector-shape')?.textContent).toContain('Cell text');
  });

  it('renders formatted PAGE fields in drawing text', () => {
    const vectorShapeBlock: FlowBlock = {
      kind: 'drawing',
      id: 'drawing-formatted-page-field',
      drawingKind: 'vectorShape',
      geometry: { width: 100, height: 50, rotation: 0, flipH: false, flipV: false },
      shapeKind: 'rect',
      textContent: {
        parts: [
          { text: 'Page ', formatting: { fontFamily: 'Arial', fontSize: 18 } },
          {
            text: '',
            fieldType: 'PAGE',
            pageNumberFormat: 'upperRoman',
            formatting: { fontFamily: 'Arial', fontSize: 18 },
          },
        ],
      },
      textAlign: 'center',
    };

    const vectorShapeMeasure: Measure = {
      kind: 'drawing',
      drawingKind: 'vectorShape',
      width: 100,
      height: 50,
      scale: 1,
      naturalWidth: 100,
      naturalHeight: 50,
      geometry: { width: 100, height: 50, rotation: 0, flipH: false, flipV: false },
    };

    const painter = createTestPainter({ blocks: [vectorShapeBlock], measures: [vectorShapeMeasure] });
    painter.paint(
      {
        pageSize: layout.pageSize,
        pages: [
          {
            number: 7,
            displayNumber: 5,
            numberText: '5',
            fragments: [
              {
                kind: 'drawing',
                drawingKind: 'vectorShape',
                blockId: 'drawing-formatted-page-field',
                x: 30,
                y: 40,
                width: 100,
                height: 50,
                geometry: { width: 100, height: 50, rotation: 0, flipH: false, flipV: false },
                scale: 1,
              },
            ],
          },
        ],
      },
      mount,
    );

    expect(mount.querySelector('.superdoc-vector-shape')?.textContent).toContain('Page V');
  });

  it('preserves cached SECTIONPAGES drawing text when section context is unavailable', () => {
    const painter = new DomPainter();
    const resolvePartText = (
      painter as unknown as {
        resolveShapeTextPartText: (
          part: { text: string; fieldType: string; pageNumberFormat?: string },
          context: { pageNumber: number; totalPages: number; section: 'body' },
        ) => string;
      }
    ).resolveShapeTextPartText.bind(painter);

    expect(
      resolvePartText({ text: '3', fieldType: 'SECTIONPAGES' }, { pageNumber: 1, totalPages: 9, section: 'body' }),
    ).toBe('3');
  });

  it('formats NUMPAGES drawing text with supported pageNumberFormat', () => {
    const painter = new DomPainter();
    const resolvePartText = (
      painter as unknown as {
        resolveShapeTextPartText: (
          part: { text: string; fieldType: string; pageNumberFormat?: string },
          context: { pageNumber: number; totalPages: number; section: 'body' },
        ) => string;
      }
    ).resolveShapeTextPartText.bind(painter);

    expect(
      resolvePartText(
        { text: '9', fieldType: 'NUMPAGES', pageNumberFormat: 'upperRoman' },
        { pageNumber: 1, totalPages: 9, section: 'body' },
      ),
    ).toBe('IX');
    expect(
      resolvePartText(
        { text: '9', fieldType: 'NUMPAGES', pageNumberFormat: 'ordinal' },
        { pageNumber: 1, totalPages: 12, section: 'body' },
      ),
    ).toBe('12th');
  });
  describe('resolved paragraph rendering', () => {
    it('renders resolved paragraph lines with precomputed indent styles', () => {
      const paragraphBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'resolved-indent',
        runs: [{ text: 'Resolved paragraph text', fontFamily: 'Arial', fontSize: 16, pmStart: 1, pmEnd: 24 }],
        attrs: {
          indent: { left: 0, hanging: 36 },
        },
      };

      const paragraphMeasure: Measure = {
        kind: 'paragraph',
        lines: [createResolvedTestLine(10), createResolvedTestLine(22, { fromChar: 10, toChar: 22 })],
        totalHeight: 40,
      };

      const paragraphLayout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'resolved-indent',
                fromLine: 0,
                toLine: 2,
                x: 30,
                y: 40,
                width: 300,
                pmStart: 1,
                pmEnd: 24,
              },
            ],
          },
        ],
      };

      const resolvedLayout = createSinglePageResolvedLayout({
        kind: 'fragment',
        id: 'para:resolved-indent:0:2',
        fragment: paragraphLayout.pages[0].fragments[0],
        pageIndex: 0,
        x: 30,
        y: 40,
        width: 300,
        height: 40,
        fragmentKind: 'para',
        blockId: 'resolved-indent',
        fragmentIndex: 0,
        block: paragraphBlock as import('@superdoc/contracts').ParagraphBlock,
        measure: paragraphMeasure as import('@superdoc/contracts').ParagraphMeasure,
        content: {
          lines: [
            {
              line: createResolvedTestLine(10),
              lineIndex: 0,
              availableWidth: 300,
              skipJustify: false,
              paddingLeftPx: 0,
              paddingRightPx: 12,
              textIndentPx: -36,
              isListFirstLine: false,
              hasExplicitSegmentPositioning: false,
              indentOffset: 0,
            },
            {
              line: createResolvedTestLine(22, { fromChar: 10, toChar: 22 }),
              lineIndex: 1,
              availableWidth: 300,
              skipJustify: true,
              paddingLeftPx: 36,
              paddingRightPx: 12,
              textIndentPx: 0,
              isListFirstLine: false,
              hasExplicitSegmentPositioning: false,
              indentOffset: 0,
            },
          ],
        },
      });

      const painter = createTestPainter({
        blocks: [paragraphBlock],
        measures: [paragraphMeasure],
      });

      painter.setResolvedLayout(resolvedLayout);
      painter.paint(paragraphLayout, mount);

      const lineEls = mount.querySelectorAll('.superdoc-line');
      expect(lineEls).toHaveLength(2);
      expect((lineEls[0] as HTMLElement).style.textIndent).toBe('-36px');
      expect((lineEls[0] as HTMLElement).style.paddingRight).toBe('12px');
      expect((lineEls[1] as HTMLElement).style.paddingLeft).toBe('36px');
      expect((lineEls[1] as HTMLElement).style.paddingRight).toBe('12px');
      expect((lineEls[1] as HTMLElement).style.textIndent).toBe('0px');
    });

    it('renders a resolved list marker without legacy wordLayout metadata', () => {
      const paragraphBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'resolved-marker',
        runs: [{ text: 'List item text', fontFamily: 'Arial', fontSize: 12, pmStart: 1, pmEnd: 15 }],
      };

      const paragraphMeasure: Measure = {
        kind: 'paragraph',
        lines: [createResolvedTestLine(14)],
        totalHeight: 20,
      };

      const paragraphLayout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'resolved-marker',
                fromLine: 0,
                toLine: 1,
                x: 30,
                y: 40,
                width: 300,
                pmStart: 1,
                pmEnd: 15,
                markerTextWidth: 12,
              },
            ],
          },
        ],
      };

      const resolvedLayout = createSinglePageResolvedLayout({
        kind: 'fragment',
        id: 'para:resolved-marker:0:1',
        fragment: paragraphLayout.pages[0].fragments[0],
        pageIndex: 0,
        x: 30,
        y: 40,
        width: 300,
        height: 20,
        fragmentKind: 'para',
        blockId: 'resolved-marker',
        fragmentIndex: 0,
        block: paragraphBlock as import('@superdoc/contracts').ParagraphBlock,
        measure: paragraphMeasure as import('@superdoc/contracts').ParagraphMeasure,
        content: {
          lines: [
            {
              line: createResolvedTestLine(14),
              lineIndex: 0,
              availableWidth: 300,
              skipJustify: true,
              paddingLeftPx: 0,
              paddingRightPx: 0,
              textIndentPx: 0,
              isListFirstLine: true,
              hasExplicitSegmentPositioning: false,
              indentOffset: 0,
            },
          ],
          marker: {
            text: '1.',
            justification: 'left',
            suffix: 'tab',
            markerStartPx: 0,
            suffixWidthPx: 24,
            firstLinePaddingLeftPx: 36,
            run: {
              fontFamily: 'Arial',
              fontSize: 12,
            },
          },
        },
      });

      const painter = createTestPainter({
        blocks: [paragraphBlock],
        measures: [paragraphMeasure],
        showFormattingMarks: true,
      });

      painter.setResolvedLayout(resolvedLayout);
      painter.paint(paragraphLayout, mount);

      const lineEl = mount.querySelector('.superdoc-line') as HTMLElement;
      const markerEl = mount.querySelector('.superdoc-paragraph-marker') as HTMLElement;
      const tabEl = mount.querySelector('.superdoc-tab') as HTMLElement;
      const paragraphMark = mount.querySelector('.superdoc-formatting-paragraph-mark') as HTMLElement;

      expect(markerEl.textContent).toBe('1.');
      expect(lineEl.style.paddingLeft).toBe('36px');
      expect(tabEl.classList.contains('superdoc-marker-suffix-tab')).toBe(true);
      expect(tabEl.style.width).toBe('24px');
      expect(tabEl.style.fontSize).toBe('12px');
      expect(paragraphMark.textContent).toBe('¶');
      expect(paragraphMark.style.left).toBe('232px');
    });

    it('renders RTL resolved list first-line anchor on padding-right for nested numbered levels', () => {
      const paragraphBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'resolved-rtl-marker',
        runs: [{ text: 'RTL nested item', fontFamily: 'Arial', fontSize: 12, pmStart: 1, pmEnd: 16 }],
        attrs: { directionContext: { inlineDirection: 'rtl', writingMode: 'horizontal-tb' } },
      };

      const paragraphMeasure: Measure = {
        kind: 'paragraph',
        lines: [createResolvedTestLine(16)],
        totalHeight: 20,
      };

      const paragraphLayout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              { kind: 'para', blockId: 'resolved-rtl-marker', fromLine: 0, toLine: 1, x: 30, y: 40, width: 300 },
            ],
          },
        ],
      };

      const resolvedLayout = createSinglePageResolvedLayout({
        kind: 'fragment',
        id: 'para:resolved-rtl-marker:0:1',
        pageIndex: 0,
        x: 30,
        y: 40,
        width: 300,
        height: 20,
        fragmentKind: 'para',
        blockId: 'resolved-rtl-marker',
        fragmentIndex: 0,
        block: paragraphBlock as import('@superdoc/contracts').ParagraphBlock,
        measure: paragraphMeasure as import('@superdoc/contracts').ParagraphMeasure,
        content: {
          lines: [
            {
              line: createResolvedTestLine(16),
              lineIndex: 0,
              availableWidth: 300,
              skipJustify: true,
              paddingLeftPx: 0,
              paddingRightPx: 0,
              textIndentPx: 0,
              isListFirstLine: true,
              hasExplicitSegmentPositioning: false,
              indentOffset: 0,
            },
          ],
          marker: {
            text: 'i.',
            justification: 'right',
            suffix: 'tab',
            markerStartPx: 72,
            suffixWidthPx: 24,
            firstLinePaddingLeftPx: 72,
            run: {
              fontFamily: 'Arial',
              fontSize: 12,
            },
          },
        },
      });

      const painter = createTestPainter({
        blocks: [paragraphBlock],
        measures: [paragraphMeasure],
      });

      painter.setResolvedLayout(resolvedLayout);
      painter.paint(paragraphLayout, mount);

      const lineEl = mount.querySelector('.superdoc-line') as HTMLElement;
      const markerEl = mount.querySelector('.superdoc-paragraph-marker') as HTMLElement;

      expect(lineEl.getAttribute('dir')).toBe('rtl');
      expect(lineEl.style.paddingRight).toBe('72px');
      expect(lineEl.style.paddingLeft).toBe('');
      expect(markerEl.textContent).toBe('i.');
    });

    it('renders a resolved drop cap without a legacy descriptor on the block', () => {
      const paragraphBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'resolved-drop-cap',
        runs: [{ text: 'Hello world', fontFamily: 'Arial', fontSize: 16, pmStart: 1, pmEnd: 12 }],
      };

      const paragraphMeasure: Measure = {
        kind: 'paragraph',
        lines: [createResolvedTestLine(11)],
        totalHeight: 20,
      };

      const paragraphLayout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'resolved-drop-cap',
                fromLine: 0,
                toLine: 1,
                x: 30,
                y: 40,
                width: 300,
                pmStart: 1,
                pmEnd: 12,
              },
            ],
          },
        ],
      };

      const resolvedLayout = createSinglePageResolvedLayout({
        kind: 'fragment',
        id: 'para:resolved-drop-cap:0:1',
        fragment: paragraphLayout.pages[0].fragments[0],
        pageIndex: 0,
        x: 30,
        y: 40,
        width: 300,
        height: 20,
        fragmentKind: 'para',
        blockId: 'resolved-drop-cap',
        fragmentIndex: 0,
        block: paragraphBlock as import('@superdoc/contracts').ParagraphBlock,
        measure: paragraphMeasure as import('@superdoc/contracts').ParagraphMeasure,
        content: {
          lines: [
            {
              line: createResolvedTestLine(11),
              lineIndex: 0,
              availableWidth: 300,
              skipJustify: true,
              paddingLeftPx: 0,
              paddingRightPx: 0,
              textIndentPx: 0,
              isListFirstLine: false,
              hasExplicitSegmentPositioning: false,
              indentOffset: 0,
            },
          ],
          dropCap: {
            text: 'H',
            mode: 'drop',
            fontFamily: 'Georgia',
            fontSize: 72,
            bold: true,
            color: '#112233',
            width: 50,
            height: 60,
          },
        },
      });

      const painter = createTestPainter({
        blocks: [paragraphBlock],
        measures: [paragraphMeasure],
      });

      painter.setResolvedLayout(resolvedLayout);
      painter.paint(paragraphLayout, mount);

      const dropCapEl = mount.querySelector('.superdoc-drop-cap') as HTMLElement;
      expect(dropCapEl.textContent).toBe('H');
      // Drop caps paint the physical render family: Georgia's bundled substitute is Gelasio.
      expect(dropCapEl.style.fontFamily).toBe('Gelasio');
      expect(dropCapEl.style.fontSize).toBe('72px');
      expect(dropCapEl.style.fontWeight).toBe('bold');
      expect(dropCapEl.style.width).toBe('50px');
      expect(dropCapEl.style.height).toBe('60px');
    });
  });

  it('applies run-level decorations and hyperlinks', () => {
    const decoratedBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'decorated',
      runs: [
        {
          text: 'Visit',
          fontFamily: 'Arial',
          fontSize: 16,
          underline: { style: 'dashed', color: '#00ff00' },
          highlight: '#ffff00',
          link: { href: 'https://example.com', title: 'Example' },
        },
      ],
      attrs: {
        alignment: 'center',
        indent: { left: 10, firstLine: 20 },
      },
    };
    const decoratedMeasure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 5,
          width: 80,
          ascent: 12,
          descent: 4,
          lineHeight: 18,
          segments: [{ runIndex: 0, fromChar: 0, toChar: 5, width: 80 }],
        },
      ],
      totalHeight: 18,
    };
    const decoratedLayout: Layout = {
      pageSize: layout.pageSize,
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'decorated',
              fromLine: 0,
              toLine: 1,
              x: 0,
              y: 0,
              width: 200,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [decoratedBlock], measures: [decoratedMeasure] });
    painter.paint(decoratedLayout, mount);

    const anchor = mount.querySelector('a') as HTMLAnchorElement;
    expect(anchor).toBeTruthy();
    expect(anchor.getAttribute('href')).toBe('https://example.com');
    expect(anchor.style.textDecorationLine).toContain('underline');
    expectCssColor(anchor.style.backgroundColor, '#ffff00');

    const fragment = mount.querySelector('.superdoc-fragment') as HTMLElement;
    expect(fragment.style.textAlign).toBe('center');
    // Indent is now applied at line-level, not fragment-level
    const lineEl = fragment.querySelector('.superdoc-line') as HTMLElement;
    expect(lineEl.style.paddingLeft).toBe('10px');
    expect(lineEl.style.textIndent).toBe('20px');
  });

  it('honors FlowRunLink v2 metadata when rendering anchors', () => {
    const block: FlowBlock = {
      kind: 'paragraph',
      id: 'rich-link',
      runs: [
        {
          text: 'Docs',
          fontFamily: 'Arial',
          fontSize: 16,
          link: {
            version: 2,
            href: 'https://example.com/docs',
            target: '_self',
            rel: 'nofollow',
            tooltip: '"Documentation"',
            docLocation: 'section-1',
            rId: 'rId42',
            history: false,
          },
        },
      ],
    };
    const measure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 4,
          width: 80,
          ascent: 12,
          descent: 4,
          lineHeight: 18,
          segments: [{ runIndex: 0, fromChar: 0, toChar: 4, width: 80 }],
        },
      ],
      totalHeight: 18,
    };
    const richLayout: Layout = {
      pageSize: layout.pageSize,
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'rich-link',
              fromLine: 0,
              toLine: 1,
              x: 0,
              y: 0,
              width: 200,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(richLayout, mount);

    const anchor = mount.querySelector('a') as HTMLAnchorElement;
    expect(anchor).toBeTruthy();
    expect(anchor.getAttribute('href')).toBe('https://example.com/docs#section-1');
    expect(anchor.getAttribute('target')).toBe('_self');
    expect(anchor.getAttribute('rel')).toBe('nofollow');
    // REGRESSION FIX: Should use raw text, not HTML-encoded entities
    expect(anchor.getAttribute('title')).toBe('"Documentation"');
    expect(anchor.dataset.linkRid).toBe('rId42');
    expect(anchor.dataset.linkDocLocation).toBe('section-1');
    expect(anchor.dataset.linkHistory).toBe('false');
  });

  it('renders blocked links as spans with data-link-blocked metadata', () => {
    const block: FlowBlock = {
      kind: 'paragraph',
      id: 'blocked-link',
      runs: [
        {
          text: 'Malicious',
          fontFamily: 'Arial',
          fontSize: 16,
          link: {
            version: 2,
            href: 'javascript:alert(1)',
            rId: 'rId99',
          },
        },
      ],
    };
    const measure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 9,
          width: 160,
          ascent: 12,
          descent: 4,
          lineHeight: 18,
          segments: [{ runIndex: 0, fromChar: 0, toChar: 9, width: 160 }],
        },
      ],
      totalHeight: 18,
    };
    const blockedLayout: Layout = {
      pageSize: layout.pageSize,
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'blocked-link',
              fromLine: 0,
              toLine: 1,
              x: 0,
              y: 0,
              width: 200,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(blockedLayout, mount);

    const span = mount.querySelector('.superdoc-fragment span') as HTMLSpanElement;
    expect(span).toBeTruthy();
    expect(span.dataset.linkBlocked).toBe('true');
    expect(span.dataset.linkRid).toBe('rId99');
  });

  it('should block URLs exceeding maximum length', () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(2100);
    const block: FlowBlock = {
      kind: 'paragraph',
      id: 'long-url-block',
      runs: [
        {
          text: 'Long URL',
          fontFamily: 'Arial',
          fontSize: 16,
          link: {
            version: 2,
            href: longUrl,
          },
        },
      ],
    };
    const measure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 8,
          width: 100,
          ascent: 12,
          descent: 4,
          lineHeight: 18,
        },
      ],
      totalHeight: 18,
    };
    const longUrlLayout: Layout = {
      pageSize: layout.pageSize,
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'long-url-block',
              fromLine: 0,
              toLine: 1,
              x: 0,
              y: 0,
              width: 200,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(longUrlLayout, mount);

    // Should render as blocked span, not anchor
    const span = mount.querySelector('span[data-link-blocked="true"]');
    expect(span).toBeTruthy();
    expect(mount.querySelector('a')).toBeNull();
  });

  it('should allow URLs at exactly max length', () => {
    const maxUrl = 'https://example.com/' + 'a'.repeat(2048 - 'https://example.com/'.length);
    const block: FlowBlock = {
      kind: 'paragraph',
      id: 'max-url-block',
      runs: [
        {
          text: 'Max URL',
          fontFamily: 'Arial',
          fontSize: 16,
          link: {
            version: 2,
            href: maxUrl,
          },
        },
      ],
    };
    const measure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 7,
          width: 100,
          ascent: 12,
          descent: 4,
          lineHeight: 18,
        },
      ],
      totalHeight: 18,
    };
    const maxUrlLayout: Layout = {
      pageSize: layout.pageSize,
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'max-url-block',
              fromLine: 0,
              toLine: 1,
              x: 0,
              y: 0,
              width: 200,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(maxUrlLayout, mount);

    const anchor = mount.querySelector('a');
    expect(anchor).toBeTruthy();
    expect(anchor?.getAttribute('href')).toBe(maxUrl);
  });

  it('renders tab leaders and bar decorations', () => {
    const blockWithTabs: FlowBlock = {
      kind: 'paragraph',
      id: 'tabs-block',
      runs: [{ text: 'Tab leaders', fontFamily: 'Arial', fontSize: 16 }],
    };
    const measureWithLeaders: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 11,
          width: 100,
          ascent: 12,
          descent: 4,
          lineHeight: 18,
          segments: [{ runIndex: 0, fromChar: 0, toChar: 11, width: 100 }],
          leaders: [
            { from: 10, to: 60, style: 'dot' },
            { from: 65, to: 90, style: 'middleDot' },
          ],
          bars: [{ x: 80 }],
        },
      ],
      totalHeight: 18,
    };

    const painter = createTestPainter({ blocks: [blockWithTabs], measures: [measureWithLeaders] });
    const tabLayout: Layout = {
      pageSize: layout.pageSize,
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'tabs-block',
              fromLine: 0,
              toLine: 1,
              x: 0,
              y: 0,
              width: 200,
            },
          ],
        },
      ],
    };

    painter.paint(tabLayout, mount);

    const leaders = mount.querySelectorAll('.superdoc-leader');
    const bar = mount.querySelector('.superdoc-tab-bar') as HTMLElement;
    expect(leaders.length).toBe(2);
    const leaderDot = leaders[0] as HTMLElement;
    const leaderMiddle = leaders[1] as HTMLElement;
    expect(leaderDot.getAttribute('data-style')).toBe('dot');
    expect(leaderDot.style.left).toBe('10px');
    expect(leaderDot.style.width).toBe('50px');
    expect(leaderMiddle.getAttribute('data-style')).toBe('middleDot');
    expect(leaderMiddle.style.left).toBe('65px');
    expect(leaderMiddle.style.width).toBe('25px');
    expect(bar).toBeTruthy();
    expect(bar.style.left).toBe('80px');
  });

  it('renders paragraph borders on fragments', () => {
    const blockWithBorders: FlowBlock = {
      kind: 'paragraph',
      id: 'border-block',
      attrs: {
        borders: {
          top: { style: 'solid', width: 2, color: '#ff0000' },
          left: { style: 'dashed', width: 1, color: '#00ff00' },
        },
      },
      runs: [{ text: 'Border test', fontFamily: 'Arial', fontSize: 16 }],
    };

    const painter = createTestPainter({
      blocks: [blockWithBorders],
      measures: [measure],
    });

    const borderLayout: Layout = {
      pageSize: layout.pageSize,
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'border-block',
              fromLine: 0,
              toLine: 1,
              x: 50,
              y: 60,
              width: 260,
            },
          ],
        },
      ],
    };

    painter.paint(borderLayout, mount);

    const fragment = mount.querySelector('[data-block-id="border-block"]') as HTMLElement;
    const borderLayer = fragment.querySelector('.superdoc-paragraph-border') as HTMLElement;
    expect(borderLayer).toBeTruthy();
    expect(borderLayer.style.borderTopStyle).toBe('solid');
    expect(borderLayer.style.borderTopWidth).toBe('2px');
    expectCssColor(borderLayer.style.borderTopColor, '#ff0000');
    expect(borderLayer.style.borderLeftStyle).toBe('dashed');
    expect(borderLayer.style.borderLeftWidth).toBe('1px');
    expectCssColor(borderLayer.style.borderLeftColor, '#00ff00');
  });

  it('applies paragraph shading fill to fragment backgrounds', () => {
    const shadedBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'shaded-block',
      attrs: {
        shading: {
          fill: '#ffeeaa',
        },
      },
      runs: [{ text: 'Shaded paragraph', fontFamily: 'Arial', fontSize: 16 }],
    };

    const painter = createTestPainter({
      blocks: [shadedBlock],
      measures: [measure],
    });

    const shadedLayout: Layout = {
      pageSize: layout.pageSize,
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'shaded-block',
              fromLine: 0,
              toLine: 1,
              x: 20,
              y: 30,
              width: 200,
            },
          ],
        },
      ],
    };

    painter.paint(shadedLayout, mount);

    const fragment = mount.querySelector('[data-block-id="shaded-block"]') as HTMLElement;
    const shadingLayer = fragment.querySelector('.superdoc-paragraph-shading') as HTMLElement;
    expect(shadingLayer).toBeTruthy();
    expectCssColor(shadingLayer.style.backgroundColor, '#ffeeaa');
  });

  describe('line-level paragraph indent handling', () => {
    it('applies paragraph left/right indent to each line element', () => {
      const indentBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'indent-block',
        runs: [{ text: 'Line one then line two', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { indent: { left: 24, right: 12 } },
      };

      const indentMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 8,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
            segments: [{ runIndex: 0, fromChar: 0, toChar: 8, width: 100 }],
          },
          {
            fromRun: 0,
            fromChar: 9,
            toRun: 0,
            toChar: 22,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
            segments: [{ runIndex: 0, fromChar: 9, toChar: 22, width: 100 }],
          },
        ],
        totalHeight: 40,
      };

      const indentLayout: Layout = {
        pageSize: layout.pageSize,
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'indent-block',
                fromLine: 0,
                toLine: 2,
                x: 0,
                y: 0,
                width: 200,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({ blocks: [indentBlock], measures: [indentMeasure] });
      painter.paint(indentLayout, mount);

      const lines = mount.querySelectorAll('.superdoc-line') as NodeListOf<HTMLElement>;
      expect(lines).toHaveLength(2);
      // Both lines should have left/right padding
      expect(lines[0].style.paddingLeft).toBe('24px');
      expect(lines[0].style.paddingRight).toBe('12px');
      expect(lines[1].style.paddingLeft).toBe('24px');
      expect(lines[1].style.paddingRight).toBe('12px');
    });

    it('applies first-line indent (textIndent) only to the first line', () => {
      const firstLineBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'firstline-block',
        runs: [{ text: 'First line content and second line content', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { indent: { left: 20, firstLine: 36 } },
      };

      const firstLineMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 18,
            width: 150,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
            segments: [{ runIndex: 0, fromChar: 0, toChar: 18, width: 150 }],
          },
          {
            fromRun: 0,
            fromChar: 19,
            toRun: 0,
            toChar: 42,
            width: 150,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
            segments: [{ runIndex: 0, fromChar: 19, toChar: 42, width: 150 }],
          },
        ],
        totalHeight: 40,
      };

      const firstLineLayout: Layout = {
        pageSize: layout.pageSize,
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'firstline-block',
                fromLine: 0,
                toLine: 2,
                x: 0,
                y: 0,
                width: 200,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({ blocks: [firstLineBlock], measures: [firstLineMeasure] });
      painter.paint(firstLineLayout, mount);

      const lines = mount.querySelectorAll('.superdoc-line') as NodeListOf<HTMLElement>;
      expect(lines).toHaveLength(2);
      // First line gets textIndent of firstLine value
      expect(lines[0].style.textIndent).toBe('36px');
      // Second line should have textIndent reset to 0
      expect(lines[1].style.textIndent).toBe('0px');
    });

    it('applies hanging indent as negative textIndent on first line', () => {
      const hangingBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'hanging-block',
        runs: [{ text: 'First line and second line text', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { indent: { left: 48, hanging: 24 } },
      };

      const hangingMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 14,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
            segments: [{ runIndex: 0, fromChar: 0, toChar: 14, width: 100 }],
          },
          {
            fromRun: 0,
            fromChar: 15,
            toRun: 0,
            toChar: 32,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
            segments: [{ runIndex: 0, fromChar: 15, toChar: 32, width: 100 }],
          },
        ],
        totalHeight: 40,
      };

      const hangingLayout: Layout = {
        pageSize: layout.pageSize,
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'hanging-block',
                fromLine: 0,
                toLine: 2,
                x: 0,
                y: 0,
                width: 200,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({ blocks: [hangingBlock], measures: [hangingMeasure] });
      painter.paint(hangingLayout, mount);

      const lines = mount.querySelectorAll('.superdoc-line') as NodeListOf<HTMLElement>;
      expect(lines).toHaveLength(2);
      // First line gets textIndent = firstLine(0) - hanging(24) = -24
      expect(lines[0].style.textIndent).toBe('-24px');
      // Second line should have textIndent reset to 0
      expect(lines[1].style.textIndent).toBe('0px');
    });

    it('does not apply first-line indent to continued fragments (continuesFromPrev)', () => {
      const continuedBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'continued-block',
        runs: [{ text: 'Text spanning pages', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { indent: { left: 20, firstLine: 48 } },
      };

      const continuedMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 10,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
            segments: [{ runIndex: 0, fromChar: 0, toChar: 10, width: 100 }],
          },
          {
            fromRun: 0,
            fromChar: 11,
            toRun: 0,
            toChar: 19,
            width: 80,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
            segments: [{ runIndex: 0, fromChar: 11, toChar: 19, width: 80 }],
          },
        ],
        totalHeight: 40,
      };

      const continuedLayout: Layout = {
        pageSize: layout.pageSize,
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'continued-block',
                fromLine: 0,
                toLine: 1,
                x: 0,
                y: 0,
                width: 200,
              },
            ],
          },
          {
            number: 2,
            fragments: [
              {
                kind: 'para',
                blockId: 'continued-block',
                fromLine: 1,
                toLine: 2,
                x: 0,
                y: 0,
                width: 200,
                continuesFromPrev: true,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({ blocks: [continuedBlock], measures: [continuedMeasure] });
      painter.paint(continuedLayout, mount);

      const pages = mount.querySelectorAll('.superdoc-page');
      // First page, first line should have firstLine indent
      const page1Line = pages[0].querySelector('.superdoc-line') as HTMLElement;
      expect(page1Line.style.textIndent).toBe('48px');

      // Second page (continues from prev) - line should NOT have firstLine indent
      const page2Line = pages[1].querySelector('.superdoc-line') as HTMLElement;
      expect(page2Line.style.textIndent).toBe('0px');
    });

    it('removes fragment-level indent styles to prevent double-application', () => {
      const doubleIndentBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'double-indent-block',
        runs: [{ text: 'Test content', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { indent: { left: 30, right: 15, firstLine: 20 } },
      };

      const doubleIndentMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 12,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
            segments: [{ runIndex: 0, fromChar: 0, toChar: 12, width: 100 }],
          },
        ],
        totalHeight: 20,
      };

      const doubleIndentLayout: Layout = {
        pageSize: layout.pageSize,
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'double-indent-block',
                fromLine: 0,
                toLine: 1,
                x: 0,
                y: 0,
                width: 200,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({ blocks: [doubleIndentBlock], measures: [doubleIndentMeasure] });
      painter.paint(doubleIndentLayout, mount);

      const fragment = mount.querySelector('.superdoc-fragment') as HTMLElement;
      // Fragment-level indent should be removed
      expect(fragment.style.paddingLeft).toBe('');
      expect(fragment.style.paddingRight).toBe('');
      expect(fragment.style.textIndent).toBe('');

      // Line-level indent should be applied
      const lineEl = fragment.querySelector('.superdoc-line') as HTMLElement;
      expect(lineEl.style.paddingLeft).toBe('30px');
      expect(lineEl.style.paddingRight).toBe('15px');
      expect(lineEl.style.textIndent).toBe('20px');
    });
  });

  describe('renderImageRun (inline image runs)', () => {
    const inlineImageSrc =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const renderInlineImageRun = (
      run: Extract<FlowBlock, { kind: 'paragraph' }>['runs'][number],
      lineWidth = 100,
      lineHeight = 100,
    ) => {
      const imageBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'img-block',
        runs: [run],
      };

      const imageMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 0,
            width: lineWidth,
            ascent: lineHeight,
            descent: 0,
            lineHeight,
          },
        ],
        totalHeight: lineHeight,
      };

      const imageLayout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'img-block',
                fromLine: 0,
                toLine: 1,
                x: 0,
                y: 0,
                width: lineWidth,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({ blocks: [imageBlock], measures: [imageMeasure] });
      painter.paint(imageLayout, mount);
    };

    const renderInlineImageTextLine = (runs: Extract<FlowBlock, { kind: 'paragraph' }>['runs']) => {
      const imageBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'img-text-block',
        runs,
      };

      const imageMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: runs.length - 1,
            toChar: 'text' in runs[runs.length - 1]! ? runs[runs.length - 1]!.text.length : 0,
            width: 140,
            ascent: 40,
            descent: 0,
            lineHeight: 40,
          },
        ],
        totalHeight: 40,
      };

      const imageLayout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'img-text-block',
                fromLine: 0,
                toLine: 1,
                x: 0,
                y: 0,
                width: 140,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({ blocks: [imageBlock], measures: [imageMeasure] });
      painter.paint(imageLayout, mount);
    };

    it('bottom-aligns normal text runs on lines containing inline images', () => {
      renderInlineImageTextLine([
        { text: 'Before ', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 7 },
        { kind: 'image', src: inlineImageSrc, width: 40, height: 40, pmStart: 7, pmEnd: 8 },
        { text: ' after', fontFamily: 'Arial', fontSize: 16, pmStart: 8, pmEnd: 14 },
      ]);

      const textSpans = Array.from(mount.querySelectorAll('.superdoc-line > span')) as HTMLElement[];
      expect(textSpans.map((span) => span.textContent)).toEqual(['Before ', ' after']);
      expect(textSpans[0]?.style.lineHeight).toBe('normal');
      expect(textSpans[0]?.style.verticalAlign).toBe('bottom');
      expect(textSpans[1]?.style.lineHeight).toBe('normal');
      expect(textSpans[1]?.style.verticalAlign).toBe('bottom');

      const img = mount.querySelector('img') as HTMLImageElement | null;
      expect(img?.style.verticalAlign).toBe('top');
    });

    it('preserves explicit vertical positioning on text runs beside inline images', () => {
      renderInlineImageTextLine([
        { text: 'Base ', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 5 },
        { kind: 'image', src: inlineImageSrc, width: 40, height: 40, pmStart: 5, pmEnd: 6 },
        {
          text: '2',
          fontFamily: 'Arial',
          fontSize: 10.4,
          vertAlign: 'superscript',
          pmStart: 6,
          pmEnd: 7,
        },
      ]);

      const textSpans = Array.from(mount.querySelectorAll('.superdoc-line > span')) as HTMLElement[];
      expect(textSpans.map((span) => span.textContent)).toEqual(['Base ', '2']);
      expect(textSpans[0]?.style.lineHeight).toBe('normal');
      expect(textSpans[0]?.style.verticalAlign).toBe('bottom');
      expect(textSpans[1]?.style.lineHeight).toBe('1');
      expect(textSpans[1]?.style.verticalAlign).toBe('5.28px');
    });

    it('renders img element with valid data URL', () => {
      const imageBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'img-block',
        runs: [
          {
            kind: 'image',
            src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            width: 100,
            height: 100,
          },
        ],
      };

      const imageMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 0,
            width: 100,
            ascent: 100,
            descent: 0,
            lineHeight: 100,
          },
        ],
        totalHeight: 100,
      };

      const imageLayout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'img-block',
                fromLine: 0,
                toLine: 1,
                x: 0,
                y: 0,
                width: 100,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({ blocks: [imageBlock], measures: [imageMeasure] });
      painter.paint(imageLayout, mount);

      const img = mount.querySelector('img');
      expect(img).toBeTruthy();
      expect(img?.src).toContain('data:image/png;base64');
      expect(img?.width).toBe(100);
      expect(img?.height).toBe(100);
    });

    it('renders inline image shape masks on a clip wrapper', () => {
      renderInlineImageRun({
        kind: 'image',
        src: inlineImageSrc,
        width: 100,
        height: 80,
        shapeClipPath: 'ellipse(50% 50% at 50% 50%)',
        objectFit: 'cover',
      } as Extract<FlowBlock, { kind: 'paragraph' }>['runs'][number]);

      const wrapper = mount.querySelector('.superdoc-inline-image-clip-wrapper') as HTMLElement | null;
      const img = wrapper?.querySelector('img') as HTMLImageElement | null;

      expect(wrapper?.style.clipPath).toBe('ellipse(50% 50% at 50% 50%)');
      expect(img?.style.objectFit).toBe('cover');
      expect(img?.style.objectPosition).toBe('left top');
    });

    it('renders img element with non-base64 SVG data URL', () => {
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><text x="0" y="20">Signature</text></svg>';
      const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

      renderInlineImageRun({
        kind: 'image',
        src: svgDataUrl,
        width: 100,
        height: 50,
      });

      const img = mount.querySelector('img');
      expect(img).toBeTruthy();
      expect(img?.src).toBe(svgDataUrl);
      expect(img?.width).toBe(100);
      expect(img?.height).toBe(50);
    });

    it('rejects non-base64 raster data URLs', () => {
      renderInlineImageRun({
        kind: 'image',
        src: 'data:image/png,not-base64',
        width: 100,
        height: 100,
      });

      const img = mount.querySelector('img');
      expect(img).toBeNull();
    });

    it('rejects non-image data URLs without requiring base64', () => {
      renderInlineImageRun({
        kind: 'image',
        src: 'data:text/html;charset=utf-8,%3Cscript%3Ealert(1)%3C%2Fscript%3E',
        width: 100,
        height: 100,
      });

      const img = mount.querySelector('img');
      expect(img).toBeNull();
    });

    it('renders DrawingML luminance using percentage units', () => {
      const dataUrl =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const imageBlocks: FlowBlock[] = [
        {
          kind: 'paragraph',
          id: 'img-block-dml',
          runs: [
            {
              kind: 'image',
              src: dataUrl,
              width: 100,
              height: 100,
              lum: {
                bright: 70000,
                contrast: -70000,
              },
            },
          ],
        },
      ];

      const imageMeasures: Measure[] = [
        {
          kind: 'paragraph',
          lines: [
            {
              fromRun: 0,
              fromChar: 0,
              toRun: 0,
              toChar: 0,
              width: 100,
              ascent: 100,
              descent: 0,
              lineHeight: 100,
            },
          ],
          totalHeight: 100,
        },
      ];

      const imageLayout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'img-block-dml',
                fromLine: 0,
                toLine: 1,
                x: 0,
                y: 0,
                width: 100,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({ blocks: imageBlocks, measures: imageMeasures });
      painter.paint(imageLayout, mount);

      const img = mount.querySelector('img');
      expect(img).toBeTruthy();

      const parseFilter = (value: string) => {
        const match = value.match(/contrast\(([^)]+)\)\s+brightness\(([^)]+)\)/);
        expect(match).toBeTruthy();
        return {
          contrast: Number(match?.[1]),
          brightness: Number(match?.[2]),
        };
      };

      const filter = parseFilter((img as HTMLElement).style.filter);
      expect(filter.contrast).toBeCloseTo(0.3, 4);
      expect(filter.brightness).toBeCloseTo(1.7, 4);
    });

    it('preserves zero-valued DrawingML luminance filters', () => {
      const dataUrl =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const imageBlocks: FlowBlock[] = [
        {
          kind: 'paragraph',
          id: 'img-block-dml-zero',
          runs: [
            {
              kind: 'image',
              src: dataUrl,
              width: 100,
              height: 100,
              lum: {
                bright: -100000,
                contrast: -100000,
              },
            },
          ],
        },
      ];

      const imageMeasures: Measure[] = [
        {
          kind: 'paragraph',
          lines: [
            {
              fromRun: 0,
              fromChar: 0,
              toRun: 0,
              toChar: 0,
              width: 100,
              ascent: 100,
              descent: 0,
              lineHeight: 100,
            },
          ],
          totalHeight: 100,
        },
      ];

      const imageLayout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'img-block-dml-zero',
                fromLine: 0,
                toLine: 1,
                x: 0,
                y: 0,
                width: 100,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({ blocks: imageBlocks, measures: imageMeasures });
      painter.paint(imageLayout, mount);

      const img = mount.querySelector('img');
      expect(img).toBeTruthy();
      expect((img as HTMLElement).style.filter).toContain('contrast(0)');
      expect((img as HTMLElement).style.filter).toContain('brightness(0)');
    });

    it('renders DrawingML fixed alpha as image opacity', () => {
      renderInlineImageRun({
        kind: 'image',
        src: inlineImageSrc,
        width: 100,
        height: 100,
        alphaModFix: { amt: 9000 },
      });

      const img = mount.querySelector('img');
      expect(img).toBeTruthy();
      expect((img as HTMLElement).style.opacity).toBe('0.09');
    });

    it('renders VML gain and blacklevel using fixed-fraction units', () => {
      const dataUrl =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const imageBlocks: FlowBlock[] = [
        {
          kind: 'paragraph',
          id: 'img-block-vml',
          runs: [
            {
              kind: 'image',
              src: dataUrl,
              width: 100,
              height: 100,
              gain: '19661f',
              blacklevel: '22938f',
            },
          ],
        },
      ];

      const imageMeasures: Measure[] = [
        {
          kind: 'paragraph',
          lines: [
            {
              fromRun: 0,
              fromChar: 0,
              toRun: 0,
              toChar: 0,
              width: 100,
              ascent: 100,
              descent: 0,
              lineHeight: 100,
            },
          ],
          totalHeight: 100,
        },
      ];

      const imageLayout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'img-block-vml',
                fromLine: 0,
                toLine: 1,
                x: 0,
                y: 0,
                width: 100,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({ blocks: imageBlocks, measures: imageMeasures });
      painter.paint(imageLayout, mount);

      const img = mount.querySelector('img');
      expect(img).toBeTruthy();

      const parseFilter = (value: string) => {
        const match = value.match(/contrast\(([^)]+)\)\s+brightness\(([^)]+)\)/);
        expect(match).toBeTruthy();
        return {
          contrast: Number(match?.[1]),
          brightness: Number(match?.[2]),
        };
      };

      const filter = parseFilter((img as HTMLElement).style.filter);
      expect(filter.contrast).toBeCloseTo(19661 / 65536, 4);
      expect(filter.brightness).toBeCloseTo(1 + 22938 / 32767, 4);
    });

    it('renders img element with external https URL', () => {
      const imageBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'img-block',
        runs: [
          {
            kind: 'image',
            src: 'https://example.com/image.png',
            width: 200,
            height: 150,
          },
        ],
      };

      const imageMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 0,
            width: 200,
            ascent: 150,
            descent: 0,
            lineHeight: 150,
          },
        ],
        totalHeight: 150,
      };

      const imageLayout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'img-block',
                fromLine: 0,
                toLine: 1,
                x: 0,
                y: 0,
                width: 200,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({ blocks: [imageBlock], measures: [imageMeasure] });
      painter.paint(imageLayout, mount);

      const img = mount.querySelector('img');
      expect(img).toBeTruthy();
      expect(img?.src).toBe('https://example.com/image.png');
      expect(img?.width).toBe(200);
      expect(img?.height).toBe(150);
    });

    it('returns null for missing src', () => {
      const imageBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'img-block',
        runs: [
          {
            kind: 'image',
            src: '',
            width: 100,
            height: 100,
          },
        ],
      };

      const imageMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 0,
            width: 100,
            ascent: 100,
            descent: 0,
            lineHeight: 100,
          },
        ],
        totalHeight: 100,
      };

      const imageLayout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'img-block',
                fromLine: 0,
                toLine: 1,
                x: 0,
                y: 0,
                width: 100,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({ blocks: [imageBlock], measures: [imageMeasure] });
      painter.paint(imageLayout, mount);

      const img = mount.querySelector('img');
      expect(img).toBeNull();
    });

    it('returns null for javascript: URL (blocked by sanitizeUrl)', () => {
      const imageBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'img-block',
        runs: [
          {
            kind: 'image',
            src: 'javascript:alert("XSS")',
            width: 100,
            height: 100,
          },
        ],
      };

      const imageMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 0,
            width: 100,
            ascent: 100,
            descent: 0,
            lineHeight: 100,
          },
        ],
        totalHeight: 100,
      };

      const imageLayout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'img-block',
                fromLine: 0,
                toLine: 1,
                x: 0,
                y: 0,
                width: 100,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({ blocks: [imageBlock], measures: [imageMeasure] });
      painter.paint(imageLayout, mount);

      const img = mount.querySelector('img');
      expect(img).toBeNull();
    });

    it('wraps linked inline image in anchor without clipPath', () => {
      renderInlineImageRun({
        kind: 'image',
        src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        width: 100,
        height: 100,
        title: 'Image',
        hyperlink: { url: 'https://example.com/inline', tooltip: ' Inline tooltip ' },
      });

      const anchor = mount.querySelector('a.superdoc-link') as HTMLAnchorElement | null;
      const img = anchor?.querySelector('img') as HTMLImageElement | null;
      expect(anchor).toBeTruthy();
      expect(anchor?.href).toBe('https://example.com/inline');
      expect(anchor?.title).toBe('Inline tooltip');
      expect(img?.getAttribute('title')).toBeNull();
      expect(anchor?.firstElementChild?.tagName).toBe('IMG');
    });

    it('falls back to hyperlink URL for linked inline image title', () => {
      renderInlineImageRun({
        kind: 'image',
        src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        width: 100,
        height: 100,
        title: 'Image',
        hyperlink: { url: 'https://superdoc.dev' },
      });

      const anchor = mount.querySelector('a.superdoc-link') as HTMLAnchorElement | null;
      const img = anchor?.querySelector('img') as HTMLImageElement | null;
      expect(anchor).toBeTruthy();
      expect(anchor?.title).toBe('https://superdoc.dev');
      expect(img?.getAttribute('title')).toBeNull();
    });

    it('wraps linked inline image clip wrapper in anchor when clipPath uses positive dimensions', () => {
      renderInlineImageRun(
        {
          kind: 'image',
          src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          width: 80,
          height: 60,
          clipPath: 'inset(10% 20% 30% 40%)',
          hyperlink: { url: 'https://example.com/clip-wrapper' },
        },
        80,
        60,
      );

      const anchor = mount.querySelector('a.superdoc-link') as HTMLAnchorElement | null;
      expect(anchor).toBeTruthy();
      expect(anchor?.querySelector('.superdoc-inline-image-clip-wrapper')).toBeTruthy();
      expect(anchor?.querySelector('.superdoc-inline-image-clip-wrapper img')).toBeTruthy();
    });

    it('wraps linked inline image clip wrapper in anchor when clipPath falls back to wrapper return path', () => {
      renderInlineImageRun(
        {
          kind: 'image',
          src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          width: 0,
          height: 60,
          clipPath: 'inset(10% 20% 30% 40%)',
          hyperlink: { url: 'https://example.com/fallback-wrapper' },
        },
        1,
        60,
      );

      const anchor = mount.querySelector('a.superdoc-link') as HTMLAnchorElement | null;
      const wrapper = anchor?.querySelector('.superdoc-inline-image-clip-wrapper') as HTMLElement | null;
      expect(anchor).toBeTruthy();
      expect(wrapper).toBeTruthy();
      expect(wrapper?.style.width).toBe('0px');
      expect(wrapper?.querySelector('img')).toBeTruthy();
    });

    it('renders cropped inline image with clipPath in wrapper (overflow hidden, img with clip-path and transform)', () => {
      const clipPath = 'inset(10% 20% 30% 40%)';
      const imageBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'img-block',
        runs: [
          {
            kind: 'image',
            src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            width: 80,
            height: 60,
            clipPath,
          },
        ],
      };

      const imageMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 0,
            width: 80,
            ascent: 60,
            descent: 0,
            lineHeight: 60,
          },
        ],
        totalHeight: 60,
      };

      const imageLayout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'img-block',
                fromLine: 0,
                toLine: 1,
                x: 0,
                y: 0,
                width: 80,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({ blocks: [imageBlock], measures: [imageMeasure] });
      painter.paint(imageLayout, mount);

      const wrapper = mount.querySelector('.superdoc-inline-image-clip-wrapper');
      expect(wrapper).toBeTruthy();
      expect((wrapper as HTMLElement).style.overflow).toBe('hidden');
      expect((wrapper as HTMLElement).style.width).toBe('80px');
      expect((wrapper as HTMLElement).style.height).toBe('60px');

      const img = wrapper?.querySelector('img');
      expect(img).toBeTruthy();
      expect((img as HTMLElement).style.clipPath).toBe(clipPath);
      expect((img as HTMLElement).style.transformOrigin).toBe('0 0');
      expect((img as HTMLElement).style.transform).toMatch(
        /translate\([-\d.]+%,\s*[-\d.]+%\)\s*scale\([-\d.]+,\s*[-\d.]+\)/,
      );
    });

    it('returns null for data URLs exceeding MAX_DATA_URL_LENGTH (10MB)', () => {
      // Create a data URL that exceeds 10MB
      const largeBase64 = 'A'.repeat(10 * 1024 * 1024 + 1);
      const imageBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'img-block',
        runs: [
          {
            kind: 'image',
            src: `data:image/png;base64,${largeBase64}`,
            width: 100,
            height: 100,
          },
        ],
      };

      const imageMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 0,
            width: 100,
            ascent: 100,
            descent: 0,
            lineHeight: 100,
          },
        ],
        totalHeight: 100,
      };

      const imageLayout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'img-block',
                fromLine: 0,
                toLine: 1,
                x: 0,
                y: 0,
                width: 100,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({ blocks: [imageBlock], measures: [imageMeasure] });
      painter.paint(imageLayout, mount);

      const img = mount.querySelector('img');
      expect(img).toBeNull();
    });

    it('returns null for invalid MIME type (e.g., data:text/html)', () => {
      const imageBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'img-block',
        runs: [
          {
            kind: 'image',
            src: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgnWFNTJyk8L3NjcmlwdD4=',
            width: 100,
            height: 100,
          },
        ],
      };

      const imageMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 0,
            width: 100,
            ascent: 100,
            descent: 0,
            lineHeight: 100,
          },
        ],
        totalHeight: 100,
      };

      const imageLayout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'img-block',
                fromLine: 0,
                toLine: 1,
                x: 0,
                y: 0,
                width: 100,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({ blocks: [imageBlock], measures: [imageMeasure] });
      painter.paint(imageLayout, mount);

      const img = mount.querySelector('img');
      expect(img).toBeNull();
    });

    it('applies correct dimensions (width, height)', () => {
      const imageBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'img-block',
        runs: [
          {
            kind: 'image',
            src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            width: 250,
            height: 175,
          },
        ],
      };

      const imageMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 0,
            width: 250,
            ascent: 175,
            descent: 0,
            lineHeight: 175,
          },
        ],
        totalHeight: 175,
      };

      const imageLayout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'img-block',
                fromLine: 0,
                toLine: 1,
                x: 0,
                y: 0,
                width: 250,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({ blocks: [imageBlock], measures: [imageMeasure] });
      painter.paint(imageLayout, mount);

      const img = mount.querySelector('img');
      expect(img?.width).toBe(250);
      expect(img?.height).toBe(175);
    });

    it('sets alt attribute (empty string default)', () => {
      const imageBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'img-block',
        runs: [
          {
            kind: 'image',
            src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            width: 100,
            height: 100,
          },
        ],
      };

      const imageMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 0,
            width: 100,
            ascent: 100,
            descent: 0,
            lineHeight: 100,
          },
        ],
        totalHeight: 100,
      };

      const imageLayout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'img-block',
                fromLine: 0,
                toLine: 1,
                x: 0,
                y: 0,
                width: 100,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({ blocks: [imageBlock], measures: [imageMeasure] });
      painter.paint(imageLayout, mount);

      const img = mount.querySelector('img');
      expect(img?.alt).toBe('');
    });

    it('sets title attribute when provided', () => {
      const imageBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'img-block',
        runs: [
          {
            kind: 'image',
            src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            width: 100,
            height: 100,
            title: 'Test Image',
          },
        ],
      };

      const imageMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 0,
            width: 100,
            ascent: 100,
            descent: 0,
            lineHeight: 100,
          },
        ],
        totalHeight: 100,
      };

      const imageLayout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'img-block',
                fromLine: 0,
                toLine: 1,
                x: 0,
                y: 0,
                width: 100,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({ blocks: [imageBlock], measures: [imageMeasure] });
      painter.paint(imageLayout, mount);

      const img = mount.querySelector('img');
      expect(img?.title).toBe('Test Image');
    });

    it('applies spacing margins (distTop, distBottom, distLeft, distRight)', () => {
      const imageBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'img-block',
        runs: [
          {
            kind: 'image',
            src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            width: 100,
            height: 100,
            distTop: 10,
            distBottom: 20,
            distLeft: 5,
            distRight: 15,
          },
        ],
      };

      const imageMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 0,
            width: 100,
            ascent: 100,
            descent: 0,
            lineHeight: 100,
          },
        ],
        totalHeight: 100,
      };

      const imageLayout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'img-block',
                fromLine: 0,
                toLine: 1,
                x: 0,
                y: 0,
                width: 100,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({ blocks: [imageBlock], measures: [imageMeasure] });
      painter.paint(imageLayout, mount);

      const img = mount.querySelector('img') as HTMLElement;
      expect(img?.style.marginTop).toBe('10px');
      expect(img?.style.marginBottom).toBe('20px');
      expect(img?.style.marginLeft).toBe('5px');
      expect(img?.style.marginRight).toBe('15px');
    });

    it('sets vertical alignment', () => {
      const imageBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'img-block',
        runs: [
          {
            kind: 'image',
            src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            width: 100,
            height: 100,
            verticalAlign: 'bottom',
          },
        ],
      };

      const imageMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 0,
            width: 100,
            ascent: 100,
            descent: 0,
            lineHeight: 100,
          },
        ],
        totalHeight: 100,
      };

      const imageLayout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'img-block',
                fromLine: 0,
                toLine: 1,
                x: 0,
                y: 0,
                width: 100,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({ blocks: [imageBlock], measures: [imageMeasure] });
      painter.paint(imageLayout, mount);

      const img = mount.querySelector('img') as HTMLElement;
      expect(img?.style.verticalAlign).toBe('bottom');
    });

    describe('data-image-metadata attribute', () => {
      it('produces metadata with correct aspectRatio for valid dimensions', () => {
        const imageBlock: FlowBlock = {
          kind: 'paragraph',
          id: 'img-block',
          runs: [
            {
              kind: 'image',
              src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
              width: 100,
              height: 50,
            },
          ],
        };

        const imageMeasure: Measure = {
          kind: 'paragraph',
          lines: [
            {
              fromRun: 0,
              fromChar: 0,
              toRun: 0,
              toChar: 0,
              width: 100,
              ascent: 50,
              descent: 0,
              lineHeight: 50,
            },
          ],
          totalHeight: 50,
        };

        const imageLayout: Layout = {
          pageSize: { w: 400, h: 500 },
          pages: [
            {
              number: 1,
              fragments: [
                {
                  kind: 'para',
                  blockId: 'img-block',
                  fromLine: 0,
                  toLine: 1,
                  x: 0,
                  y: 0,
                  width: 100,
                },
              ],
            },
          ],
        };

        const painter = createTestPainter({ blocks: [imageBlock], measures: [imageMeasure] });
        painter.paint(imageLayout, mount);

        const img = mount.querySelector('img');
        expect(img).toBeTruthy();

        const metadataAttr = img?.getAttribute('data-image-metadata');
        expect(metadataAttr).toBeTruthy();

        const metadata = JSON.parse(metadataAttr!);
        expect(metadata.originalWidth).toBe(100);
        expect(metadata.originalHeight).toBe(50);
        expect(metadata.aspectRatio).toBe(2); // 100 / 50 = 2
        expect(metadata.minWidth).toBe(20);
        expect(metadata.minHeight).toBe(20);
        expect(metadata.maxWidth).toBe(1000); // Math.max(100 * 3, 1000) = 1000
        expect(metadata.maxHeight).toBe(1000); // Math.max(50 * 3, 1000) = 1000
      });

      it('produces NO metadata attribute when width is zero', () => {
        const imageBlock: FlowBlock = {
          kind: 'paragraph',
          id: 'img-block',
          runs: [
            {
              kind: 'image',
              src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
              width: 0,
              height: 100,
            },
          ],
        };

        const imageMeasure: Measure = {
          kind: 'paragraph',
          lines: [
            {
              fromRun: 0,
              fromChar: 0,
              toRun: 0,
              toChar: 0,
              width: 0,
              ascent: 100,
              descent: 0,
              lineHeight: 100,
            },
          ],
          totalHeight: 100,
        };

        const imageLayout: Layout = {
          pageSize: { w: 400, h: 500 },
          pages: [
            {
              number: 1,
              fragments: [
                {
                  kind: 'para',
                  blockId: 'img-block',
                  fromLine: 0,
                  toLine: 1,
                  x: 0,
                  y: 0,
                  width: 0,
                },
              ],
            },
          ],
        };

        const painter = createTestPainter({ blocks: [imageBlock], measures: [imageMeasure] });
        painter.paint(imageLayout, mount);

        const img = mount.querySelector('img');
        expect(img).toBeTruthy();

        const metadataAttr = img?.getAttribute('data-image-metadata');
        expect(metadataAttr).toBeNull();
      });

      it('produces NO metadata attribute when height is zero', () => {
        const imageBlock: FlowBlock = {
          kind: 'paragraph',
          id: 'img-block',
          runs: [
            {
              kind: 'image',
              src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
              width: 100,
              height: 0,
            },
          ],
        };

        const imageMeasure: Measure = {
          kind: 'paragraph',
          lines: [
            {
              fromRun: 0,
              fromChar: 0,
              toRun: 0,
              toChar: 0,
              width: 100,
              ascent: 0,
              descent: 0,
              lineHeight: 0,
            },
          ],
          totalHeight: 0,
        };

        const imageLayout: Layout = {
          pageSize: { w: 400, h: 500 },
          pages: [
            {
              number: 1,
              fragments: [
                {
                  kind: 'para',
                  blockId: 'img-block',
                  fromLine: 0,
                  toLine: 1,
                  x: 0,
                  y: 0,
                  width: 100,
                },
              ],
            },
          ],
        };

        const painter = createTestPainter({ blocks: [imageBlock], measures: [imageMeasure] });
        painter.paint(imageLayout, mount);

        const img = mount.querySelector('img');
        expect(img).toBeTruthy();

        const metadataAttr = img?.getAttribute('data-image-metadata');
        expect(metadataAttr).toBeNull();
      });

      it('calculates maxWidth/maxHeight based on 3x multiplier for large images', () => {
        const imageBlock: FlowBlock = {
          kind: 'paragraph',
          id: 'img-block',
          runs: [
            {
              kind: 'image',
              src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
              width: 800,
              height: 600,
            },
          ],
        };

        const imageMeasure: Measure = {
          kind: 'paragraph',
          lines: [
            {
              fromRun: 0,
              fromChar: 0,
              toRun: 0,
              toChar: 0,
              width: 800,
              ascent: 600,
              descent: 0,
              lineHeight: 600,
            },
          ],
          totalHeight: 600,
        };

        const imageLayout: Layout = {
          pageSize: { w: 1000, h: 1200 },
          pages: [
            {
              number: 1,
              fragments: [
                {
                  kind: 'para',
                  blockId: 'img-block',
                  fromLine: 0,
                  toLine: 1,
                  x: 0,
                  y: 0,
                  width: 800,
                },
              ],
            },
          ],
        };

        const painter = createTestPainter({ blocks: [imageBlock], measures: [imageMeasure] });
        painter.paint(imageLayout, mount);

        const img = mount.querySelector('img');
        expect(img).toBeTruthy();

        const metadataAttr = img?.getAttribute('data-image-metadata');
        expect(metadataAttr).toBeTruthy();

        const metadata = JSON.parse(metadataAttr!);
        expect(metadata.originalWidth).toBe(800);
        expect(metadata.originalHeight).toBe(600);
        expect(metadata.aspectRatio).toBeCloseTo(800 / 600, 5);
        // For large images, 3x multiplier is used (800 * 3 = 2400 > 1000)
        expect(metadata.maxWidth).toBe(2400);
        expect(metadata.maxHeight).toBe(1800);
        expect(metadata.minWidth).toBe(20);
        expect(metadata.minHeight).toBe(20);
      });
    });
  });

  describe('RTL paragraph rendering', () => {
    const rtlBlock = (attrs: Record<string, unknown>): FlowBlock => ({
      kind: 'paragraph',
      id: 'rtl-block',
      runs: [{ text: 'مرحبا', fontFamily: 'Arial', fontSize: 16 }],
      attrs: { directionContext: { inlineDirection: 'rtl', writingMode: 'horizontal-tb' }, ...attrs },
    });

    const rtlMeasure: Measure = {
      kind: 'paragraph',
      lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 5, width: 80, ascent: 12, descent: 4, lineHeight: 20 }],
      totalHeight: 20,
    };

    const rtlLayout: Layout = {
      pageSize: { w: 300, h: 200 },
      pages: [
        {
          number: 1,
          fragments: [{ kind: 'para', blockId: 'rtl-block', fromLine: 0, toLine: 1, x: 0, y: 0, width: 200 }],
        },
      ],
    };

    it('sets dir="rtl" and defaults text-align to right', () => {
      const painter = createTestPainter({ blocks: [rtlBlock({})], measures: [rtlMeasure] });
      painter.paint(rtlLayout, mount);

      const line = mount.querySelector('.superdoc-line') as HTMLElement;
      expect(line.dir).toBe('rtl');
      expect(line.style.textAlign).toBe('right');
    });

    it('preserves explicit left alignment on RTL paragraphs', () => {
      const painter = createTestPainter({ blocks: [rtlBlock({ alignment: 'left' })], measures: [rtlMeasure] });
      painter.paint(rtlLayout, mount);

      const line = mount.querySelector('.superdoc-line') as HTMLElement;
      expect(line.dir).toBe('rtl');
      expect(line.style.textAlign).toBe('left');
    });

    it('uses text-align right for RTL justified paragraphs', () => {
      const painter = createTestPainter({ blocks: [rtlBlock({ alignment: 'justify' })], measures: [rtlMeasure] });
      painter.paint(rtlLayout, mount);

      const line = mount.querySelector('.superdoc-line') as HTMLElement;
      expect(line.dir).toBe('rtl');
      expect(line.style.textAlign).toBe('right');
    });

    it('does not use absolute positioning for RTL lines with tab segments', () => {
      const tabBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'rtl-block',
        runs: [
          { text: 'مرحبا', fontFamily: 'Arial', fontSize: 16 },
          { kind: 'tab', width: 40, fontFamily: 'Arial', fontSize: 16 } as any,
          { text: 'عالم', fontFamily: 'Arial', fontSize: 16 },
        ],
        attrs: { directionContext: { inlineDirection: 'rtl', writingMode: 'horizontal-tb' } },
      };

      const tabMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 2,
            toChar: 4,
            width: 160,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
            segments: [
              { runIndex: 0, fromChar: 0, toChar: 5, width: 60 },
              { runIndex: 1, fromChar: 0, toChar: 0, width: 40, x: 60 },
              { runIndex: 2, fromChar: 0, toChar: 4, width: 60, x: 100 },
            ],
          },
        ],
        totalHeight: 20,
      };

      const painter = createTestPainter({ blocks: [tabBlock], measures: [tabMeasure] });
      painter.paint(rtlLayout, mount);

      const line = mount.querySelector('.superdoc-line') as HTMLElement;
      expect(line.dir).toBe('rtl');
      const spans = Array.from(line.querySelectorAll('span'));
      const hasAbsolute = spans.some((s) => s.style.position === 'absolute');
      expect(hasAbsolute).toBe(false);
    });
  });
});

describe('ImageFragment (block-level images)', () => {
  let mount: HTMLElement;

  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  afterEach(() => {
    mount.remove();
  });

  describe('data-image-metadata attribute for watermarks', () => {
    it('does NOT add data-image-metadata for watermark images (vmlWatermark: true)', () => {
      const watermarkBlock: FlowBlock = {
        kind: 'image',
        id: 'watermark-img',
        src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        width: 200,
        height: 100,
        attrs: { vmlWatermark: true },
      };

      const watermarkMeasure: Measure = {
        kind: 'image',
        width: 200,
        height: 100,
      };

      const imageFragment = {
        kind: 'image' as const,
        blockId: 'watermark-img',
        x: 50,
        y: 50,
        width: 200,
        height: 100,
        metadata: {
          originalWidth: 200,
          originalHeight: 100,
          maxWidth: 600,
          maxHeight: 300,
          aspectRatio: 2,
          minWidth: 20,
          minHeight: 20,
        },
      };

      const imageLayout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [imageFragment],
          },
        ],
      };

      const painter = createTestPainter({
        blocks: [watermarkBlock],
        measures: [watermarkMeasure],
      });
      painter.paint(imageLayout, mount);

      const imageEl = mount.querySelector('.superdoc-image-fragment');
      expect(imageEl).toBeTruthy();

      // Watermarks should NOT have data-image-metadata (makes them non-interactive)
      const metadataAttr = imageEl?.getAttribute('data-image-metadata');
      expect(metadataAttr).toBeNull();
    });

    it('DOES add data-image-metadata for regular images (no vmlWatermark)', () => {
      const regularBlock: FlowBlock = {
        kind: 'image',
        id: 'regular-img',
        src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        width: 200,
        height: 100,
      };

      const regularMeasure: Measure = {
        kind: 'image',
        width: 200,
        height: 100,
      };

      const imageFragment = {
        kind: 'image' as const,
        blockId: 'regular-img',
        x: 50,
        y: 50,
        width: 200,
        height: 100,
        metadata: {
          originalWidth: 200,
          originalHeight: 100,
          maxWidth: 600,
          maxHeight: 300,
          aspectRatio: 2,
          minWidth: 20,
          minHeight: 20,
        },
      };

      const imageLayout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [imageFragment],
          },
        ],
      };

      const painter = createTestPainter({
        blocks: [regularBlock],
        measures: [regularMeasure],
      });
      painter.paint(imageLayout, mount);

      const imageEl = mount.querySelector('.superdoc-image-fragment');
      expect(imageEl).toBeTruthy();

      // Regular images SHOULD have data-image-metadata (makes them interactive/resizable)
      const metadataAttr = imageEl?.getAttribute('data-image-metadata');
      expect(metadataAttr).toBeTruthy();

      const metadata = JSON.parse(metadataAttr!);
      expect(metadata.originalWidth).toBe(200);
      expect(metadata.originalHeight).toBe(100);
    });

    it('DOES add data-image-metadata for images with vmlWatermark: false explicitly set', () => {
      // This test ensures that only vmlWatermark: true skips metadata, not false
      const regularBlock: FlowBlock = {
        kind: 'image',
        id: 'regular-img-explicit',
        src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        width: 150,
        height: 75,
        attrs: { vmlWatermark: false },
      };

      const regularMeasure: Measure = {
        kind: 'image',
        width: 150,
        height: 75,
      };

      const imageFragment = {
        kind: 'image' as const,
        blockId: 'regular-img-explicit',
        x: 50,
        y: 50,
        width: 150,
        height: 75,
        metadata: {
          originalWidth: 150,
          originalHeight: 75,
          maxWidth: 450,
          maxHeight: 225,
          aspectRatio: 2,
          minWidth: 20,
          minHeight: 20,
        },
      };

      const imageLayout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [imageFragment],
          },
        ],
      };

      const painter = createTestPainter({
        blocks: [regularBlock],
        measures: [regularMeasure],
      });
      painter.paint(imageLayout, mount);

      const imageEl = mount.querySelector('.superdoc-image-fragment');
      expect(imageEl).toBeTruthy();

      // vmlWatermark: false should still have metadata (interactive)
      const metadataAttr = imageEl?.getAttribute('data-image-metadata');
      expect(metadataAttr).toBeTruthy();
    });
  });

  describe('hyperlink (DrawingML a:hlinkClick)', () => {
    const makePainter = (hyperlink?: ImageHyperlink) => {
      const block: FlowBlock = {
        kind: 'image',
        id: 'linked-img',
        src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        width: 100,
        height: 50,
        ...(hyperlink ? { hyperlink } : {}),
      };
      const measure: Measure = { kind: 'image', width: 100, height: 50 };
      return createTestPainter({ blocks: [block], measures: [measure] });
    };

    it('wraps linked image in <a class="superdoc-link"> with correct href', () => {
      const painter = makePainter({ url: 'https://example.com' });
      const layout: Layout = {
        pageSize: { w: 400, h: 300 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'image' as const,
                blockId: 'linked-img',
                x: 20,
                y: 20,
                width: 100,
                height: 50,
              },
            ],
          },
        ],
      };
      painter.paint(layout, mount);

      const fragmentEl = mount.querySelector('.superdoc-image-fragment');
      expect(fragmentEl).toBeTruthy();

      const anchor = fragmentEl?.querySelector('a.superdoc-link') as HTMLAnchorElement | null;
      expect(anchor).toBeTruthy();
      expect(anchor?.href).toBe('https://example.com/');
      expect(anchor?.target).toBe('_blank');
      expect(anchor?.rel).toContain('noopener');
      expect(anchor?.getAttribute('role')).toBe('link');
    });

    it('encodes tooltip before setting title attribute', () => {
      const block: FlowBlock = {
        kind: 'image',
        id: 'tip-img',
        src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        width: 100,
        height: 50,
        hyperlink: { url: 'https://example.com', tooltip: `  ${'x'.repeat(600)}  ` },
      };
      const measure: Measure = { kind: 'image', width: 100, height: 50 };
      const fragment = { kind: 'image' as const, blockId: 'tip-img', x: 0, y: 0, width: 100, height: 50 };
      const layout: Layout = {
        pageSize: { w: 400, h: 300 },
        pages: [{ number: 1, fragments: [fragment] }],
      };
      const painter = createTestPainter({ blocks: [block], measures: [measure] });
      painter.paint(layout, mount);

      const anchor = mount.querySelector('a.superdoc-link') as HTMLAnchorElement | null;
      expect(anchor?.title).toBe('x'.repeat(500));
    });

    it('does NOT wrap unlinked image in anchor', () => {
      const block: FlowBlock = {
        kind: 'image',
        id: 'plain-img',
        src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        width: 100,
        height: 50,
      };
      const measure: Measure = { kind: 'image', width: 100, height: 50 };
      const fragment = { kind: 'image' as const, blockId: 'plain-img', x: 0, y: 0, width: 100, height: 50 };
      const layout: Layout = {
        pageSize: { w: 400, h: 300 },
        pages: [{ number: 1, fragments: [fragment] }],
      };
      const painter = createTestPainter({ blocks: [block], measures: [measure] });
      painter.paint(layout, mount);

      const anchor = mount.querySelector('a.superdoc-link');
      expect(anchor).toBeNull();

      // Image element should still be present
      const img = mount.querySelector('.superdoc-image-fragment img');
      expect(img).toBeTruthy();
    });

    it('does NOT wrap image when hyperlink URL fails sanitization', () => {
      const block: FlowBlock = {
        kind: 'image',
        id: 'unsafe-img',
        src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        width: 100,
        height: 50,
        hyperlink: { url: 'javascript:alert(1)' },
      };
      const measure: Measure = { kind: 'image', width: 100, height: 50 };
      const fragment = { kind: 'image' as const, blockId: 'unsafe-img', x: 0, y: 0, width: 100, height: 50 };
      const layout: Layout = {
        pageSize: { w: 400, h: 300 },
        pages: [{ number: 1, fragments: [fragment] }],
      };
      const painter = createTestPainter({ blocks: [block], measures: [measure] });
      painter.paint(layout, mount);

      const anchor = mount.querySelector('a.superdoc-link');
      expect(anchor).toBeNull();
    });
  });
});

describe('URL sanitization security', () => {
  it('blocks javascript: URLs', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeUrl('JavaScript:alert(1)')).toBeNull();
    expect(sanitizeUrl('JAVASCRIPT:alert(1)')).toBeNull();
  });

  it('blocks data: URLs', () => {
    expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(sanitizeUrl('Data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('blocks vbscript: URLs', () => {
    expect(sanitizeUrl('vbscript:alert(1)')).toBeNull();
    expect(sanitizeUrl('VBScript:alert(1)')).toBeNull();
  });

  it('allows safe http and https URLs', () => {
    expect(sanitizeUrl('http://example.com')).toBe('http://example.com');
    expect(sanitizeUrl('https://example.com')).toBe('https://example.com');
    expect(sanitizeUrl('HTTP://example.com')).toBe('HTTP://example.com');
    expect(sanitizeUrl('HTTPS://example.com')).toBe('HTTPS://example.com');
  });

  it('allows mailto: URLs', () => {
    expect(sanitizeUrl('mailto:user@example.com')).toBe('mailto:user@example.com');
    expect(sanitizeUrl('MAILTO:user@example.com')).toBe('MAILTO:user@example.com');
  });

  it('allows tel: URLs', () => {
    expect(sanitizeUrl('tel:+1234567890')).toBe('tel:+1234567890');
    expect(sanitizeUrl('TEL:+1234567890')).toBe('TEL:+1234567890');
  });

  it('allows internal anchor links', () => {
    expect(sanitizeUrl('#section1')).toBe('#section1');
    expect(sanitizeUrl('#top')).toBe('#top');
  });

  it('resolves relative URLs against page origin', () => {
    expect(sanitizeUrl('/path/to/page')).toBe(`${window.location.origin}/path/to/page`);
    expect(sanitizeUrl('./relative/path')).toBe(`${window.location.origin}/relative/path`);
    expect(sanitizeUrl('../parent/path')).toBe(`${window.location.origin}/parent/path`);
  });

  it('handles empty and whitespace-only URLs', () => {
    expect(sanitizeUrl('')).toBeNull();
    expect(sanitizeUrl('   ')).toBeNull();
  });

  it('trims whitespace from URLs', () => {
    expect(sanitizeUrl('  https://example.com  ')).toBe('https://example.com');
    expect(sanitizeUrl(' #anchor ')).toBe('#anchor');
  });
});

describe('normalizeAnchor XSS protection', () => {
  let mount: HTMLElement;
  let painter: ReturnType<typeof createTestPainter>;

  const createFlowBlockWithLink = (link: unknown): FlowBlock => ({
    kind: 'paragraph',
    id: 'test-anchor-block',
    runs: [
      {
        text: 'Test Link',
        fontFamily: 'Arial',
        fontSize: 16,
        link,
      },
    ],
  });

  const createMeasureForBlock = (): Measure => ({
    kind: 'paragraph',
    lines: [
      {
        fromRun: 0,
        fromChar: 0,
        toRun: 0,
        toChar: 9,
        width: 100,
        ascent: 12,
        descent: 4,
        lineHeight: 18,
      },
    ],
    totalHeight: 18,
  });

  const createLayout = (): Layout => ({
    pageSize: { w: 400, h: 500 },
    pages: [
      {
        number: 1,
        fragments: [
          {
            kind: 'para',
            blockId: 'test-anchor-block',
            fromLine: 0,
            toLine: 1,
            x: 0,
            y: 0,
            width: 200,
          },
        ],
      },
    ],
  });

  beforeEach(() => {
    mount = document.createElement('div');
  });

  it('should block anchor with quote injection', () => {
    const link = {
      version: 2,
      anchor: 'x" onclick="alert(1)',
    };

    const block = createFlowBlockWithLink(link);
    const measure = createMeasureForBlock();
    const layout = createLayout();

    painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    // Should render as blocked span, not anchor
    const span = mount.querySelector('span[data-link-blocked="true"]');
    expect(span).toBeTruthy();
    expect(mount.querySelector('a')).toBeNull();
  });

  it('should block anchor with angle brackets', () => {
    const link = {
      version: 2,
      anchor: 'test<script>alert(1)</script>',
    };

    const block = createFlowBlockWithLink(link);
    const measure = createMeasureForBlock();
    const layout = createLayout();

    painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    const span = mount.querySelector('span[data-link-blocked="true"]');
    expect(span).toBeTruthy();
  });

  it('should block anchor with spaces', () => {
    const link = {
      version: 2,
      anchor: 'foo bar baz',
    };

    const block = createFlowBlockWithLink(link);
    const measure = createMeasureForBlock();
    const layout = createLayout();

    painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    const span = mount.querySelector('span[data-link-blocked="true"]');
    expect(span).toBeTruthy();
  });

  it('should allow valid anchor names', () => {
    const link = {
      version: 2,
      anchor: 'valid-anchor_123',
    };

    const block = createFlowBlockWithLink(link);
    const measure = createMeasureForBlock();
    const layout = createLayout();

    painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    const anchor = mount.querySelector('a');
    expect(anchor).toBeTruthy();
    expect(anchor?.getAttribute('href')).toBe('#valid-anchor_123');
  });

  it('should handle anchor with leading hash', () => {
    const link = {
      version: 2,
      anchor: '#bookmark',
    };

    const block = createFlowBlockWithLink(link);
    const measure = createMeasureForBlock();
    const layout = createLayout();

    painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    const anchor = mount.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('#bookmark');
  });
});

describe('appendDocLocation XSS protection', () => {
  let mount: HTMLElement;
  let painter: ReturnType<typeof createTestPainter>;

  const createFlowBlockWithLink = (link: unknown): FlowBlock => ({
    kind: 'paragraph',
    id: 'test-docloc-block',
    runs: [
      {
        text: 'Test Link',
        fontFamily: 'Arial',
        fontSize: 16,
        link,
      },
    ],
  });

  const createMeasureForBlock = (): Measure => ({
    kind: 'paragraph',
    lines: [
      {
        fromRun: 0,
        fromChar: 0,
        toRun: 0,
        toChar: 9,
        width: 100,
        ascent: 12,
        descent: 4,
        lineHeight: 18,
      },
    ],
    totalHeight: 18,
  });

  const createLayout = (): Layout => ({
    pageSize: { w: 400, h: 500 },
    pages: [
      {
        number: 1,
        fragments: [
          {
            kind: 'para',
            blockId: 'test-docloc-block',
            fromLine: 0,
            toLine: 1,
            x: 0,
            y: 0,
            width: 200,
          },
        ],
      },
    ],
  });

  beforeEach(() => {
    mount = document.createElement('div');
  });

  it('DATA INTEGRITY: URL-encodes docLocation with quote injection instead of blocking', () => {
    const link = {
      version: 2,
      href: 'https://example.com',
      docLocation: '" onmouseover="alert(1)',
    };

    const block = createFlowBlockWithLink(link);
    const measure = createMeasureForBlock();
    const layout = createLayout();

    painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    // CRITICAL FIX: Should preserve the sanitized href and URL-encode the unsafe fragment
    // Previously this would destroy the entire link by returning null
    const anchor = mount.querySelector('a');
    expect(anchor).toBeTruthy();
    const href = anchor?.getAttribute('href');
    expect(href).toBe('https://example.com#%22%20onmouseover%3D%22alert(1)');
    expect(mount.querySelector('span[data-link-blocked="true"]')).toBeNull();
  });

  it('DATA INTEGRITY: URL-encodes docLocation with angle brackets instead of blocking', () => {
    const link = {
      version: 2,
      href: 'https://example.com',
      docLocation: '<script>alert(1)</script>',
    };

    const block = createFlowBlockWithLink(link);
    const measure = createMeasureForBlock();
    const layout = createLayout();

    painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    // CRITICAL FIX: Should preserve the sanitized href and URL-encode the unsafe fragment
    const anchor = mount.querySelector('a');
    expect(anchor).toBeTruthy();
    const href = anchor?.getAttribute('href');
    expect(href).toBe('https://example.com#%3Cscript%3Ealert(1)%3C%2Fscript%3E');
    expect(mount.querySelector('span[data-link-blocked="true"]')).toBeNull();
  });

  it('DATA INTEGRITY: URL-encodes docLocation with spaces instead of blocking', () => {
    const link = {
      version: 2,
      href: 'https://example.com',
      docLocation: 'foo bar',
    };

    const block = createFlowBlockWithLink(link);
    const measure = createMeasureForBlock();
    const layout = createLayout();

    painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    // CRITICAL FIX: Should preserve the sanitized href and URL-encode the unsafe fragment
    const anchor = mount.querySelector('a');
    expect(anchor).toBeTruthy();
    const href = anchor?.getAttribute('href');
    expect(href).toBe('https://example.com#foo%20bar');
    expect(mount.querySelector('span[data-link-blocked="true"]')).toBeNull();
  });

  it('should allow valid docLocation', () => {
    const link = {
      version: 2,
      href: 'https://example.com',
      docLocation: 'section-123',
    };

    const block = createFlowBlockWithLink(link);
    const measure = createMeasureForBlock();
    const layout = createLayout();

    painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    const anchor = mount.querySelector('a');
    expect(anchor).toBeTruthy();
    expect(anchor?.getAttribute('href')).toBe('https://example.com#section-123');
  });

  it('should handle docLocation without href', () => {
    const link = {
      version: 2,
      docLocation: 'bookmark',
    };

    const block = createFlowBlockWithLink(link);
    const measure = createMeasureForBlock();
    const layout = createLayout();

    painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    const anchor = mount.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('#bookmark');
  });

  it('should not append docLocation if href already has fragment', () => {
    const link = {
      version: 2,
      href: 'https://example.com#existing',
      docLocation: 'new',
    };

    const block = createFlowBlockWithLink(link);
    const measure = createMeasureForBlock();
    const layout = createLayout();

    painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    const anchor = mount.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('https://example.com#existing');
  });
});

describe('appendDocLocation edge cases', () => {
  let mount: HTMLElement;
  let painter: ReturnType<typeof createTestPainter>;

  const createFlowBlockWithLink = (link: unknown): FlowBlock => ({
    kind: 'paragraph',
    id: 'test-edge-case-block',
    runs: [
      {
        text: 'Test Link',
        fontFamily: 'Arial',
        fontSize: 16,
        link,
      },
    ],
  });

  const createMeasureForBlock = (): Measure => ({
    kind: 'paragraph',
    lines: [
      {
        fromRun: 0,
        fromChar: 0,
        toRun: 0,
        toChar: 9,
        width: 100,
        ascent: 12,
        descent: 4,
        lineHeight: 18,
      },
    ],
    totalHeight: 18,
  });

  const createLayout = (): Layout => ({
    pageSize: { w: 400, h: 500 },
    pages: [
      {
        number: 1,
        fragments: [
          {
            kind: 'para',
            blockId: 'test-edge-case-block',
            fromLine: 0,
            toLine: 1,
            x: 0,
            y: 0,
            width: 200,
          },
        ],
      },
    ],
  });

  beforeEach(() => {
    mount = document.createElement('div');
  });

  it('should handle very long fragments (>1000 chars) by URL-encoding', () => {
    // Test that extremely long fragments are URL-encoded rather than rejected
    const longFragment = 'a'.repeat(1500);
    const link = {
      version: 2,
      href: 'https://example.com',
      docLocation: longFragment,
    };

    const block = createFlowBlockWithLink(link);
    const measure = createMeasureForBlock();
    const layout = createLayout();

    painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    const anchor = mount.querySelector('a');
    expect(anchor).toBeTruthy();
    const href = anchor?.getAttribute('href');
    // Fragment should be the base URL + # + the long fragment (all a's are safe chars, no encoding needed)
    expect(href).toBe(`https://example.com#${longFragment}`);
    // Link should not be blocked
    expect(mount.querySelector('span[data-link-blocked="true"]')).toBeNull();
  });

  it('should handle empty string fragment by preserving href', () => {
    // Empty docLocation should not modify the href
    const link = {
      version: 2,
      href: 'https://example.com',
      docLocation: '',
    };

    const block = createFlowBlockWithLink(link);
    const measure = createMeasureForBlock();
    const layout = createLayout();

    painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    const anchor = mount.querySelector('a');
    expect(anchor).toBeTruthy();
    expect(anchor?.getAttribute('href')).toBe('https://example.com');
  });

  it('should handle whitespace-only fragment by preserving href', () => {
    // Whitespace-only docLocation should not modify the href
    const link = {
      version: 2,
      href: 'https://example.com',
      docLocation: '   \t\n  ',
    };

    const block = createFlowBlockWithLink(link);
    const measure = createMeasureForBlock();
    const layout = createLayout();

    painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    const anchor = mount.querySelector('a');
    expect(anchor).toBeTruthy();
    expect(anchor?.getAttribute('href')).toBe('https://example.com');
  });

  it('should preserve href when encoding fails gracefully', () => {
    // Test that if fragment encoding somehow fails, the base href is preserved
    // Using a docLocation that contains only special characters that need encoding
    const link = {
      version: 2,
      href: 'https://example.com',
      docLocation: '!@#$%^&*()',
    };

    const block = createFlowBlockWithLink(link);
    const measure = createMeasureForBlock();
    const layout = createLayout();

    painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    const anchor = mount.querySelector('a');
    expect(anchor).toBeTruthy();
    const href = anchor?.getAttribute('href');
    // Special characters should be URL-encoded
    expect(href).toBe('https://example.com#!%40%23%24%25%5E%26*()');
    // Link should not be blocked
    expect(mount.querySelector('span[data-link-blocked="true"]')).toBeNull();
  });

  it('should handle fragment with only special characters', () => {
    // Test fragments containing only special characters that require encoding
    const link = {
      version: 2,
      href: 'https://example.com',
      docLocation: '!@#$%^&*()',
    };

    const block = createFlowBlockWithLink(link);
    const measure = createMeasureForBlock();
    const layout = createLayout();

    painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    const anchor = mount.querySelector('a');
    expect(anchor).toBeTruthy();
    const href = anchor?.getAttribute('href');
    // All special characters should be properly URL-encoded
    expect(href).toContain('https://example.com#');
    expect(href?.includes('%')).toBe(true); // Should contain encoded characters
    // Link should render as an anchor, not blocked
    expect(mount.querySelector('span[data-link-blocked="true"]')).toBeNull();
  });

  it('should handle docLocation with null href by creating anchor-only link', () => {
    // When href is null/undefined but docLocation exists, should create internal anchor
    const link = {
      version: 2,
      href: null,
      docLocation: 'bookmark123',
    };

    const block = createFlowBlockWithLink(link);
    const measure = createMeasureForBlock();
    const layout = createLayout();

    painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    const anchor = mount.querySelector('a');
    expect(anchor).toBeTruthy();
    expect(anchor?.getAttribute('href')).toBe('#bookmark123');
  });

  it('should preserve base href when docLocation contains unicode characters', () => {
    // Test that unicode characters in fragments are properly handled
    const link = {
      version: 2,
      href: 'https://example.com',
      docLocation: '中文锚点',
    };

    const block = createFlowBlockWithLink(link);
    const measure = createMeasureForBlock();
    const layout = createLayout();

    painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    const anchor = mount.querySelector('a');
    expect(anchor).toBeTruthy();
    const href = anchor?.getAttribute('href');
    // Unicode characters should be URL-encoded
    expect(href).toContain('https://example.com#');
    expect(href?.includes('%')).toBe(true);
    // Link should not be blocked
    expect(mount.querySelector('span[data-link-blocked="true"]')).toBeNull();
  });
});

describe('Tooltip truncation signaling', () => {
  let mount: HTMLElement;
  let painter: ReturnType<typeof createTestPainter>;

  const createFlowBlockWithLink = (link: unknown): FlowBlock => ({
    kind: 'paragraph',
    id: 'test-tooltip-block',
    runs: [
      {
        text: 'Test Link',
        fontFamily: 'Arial',
        fontSize: 16,
        link,
      },
    ],
  });

  const createMeasureForBlock = (): Measure => ({
    kind: 'paragraph',
    lines: [
      {
        fromRun: 0,
        fromChar: 0,
        toRun: 0,
        toChar: 9,
        width: 100,
        ascent: 12,
        descent: 4,
        lineHeight: 18,
      },
    ],
    totalHeight: 18,
  });

  const createLayout = (_blocks: FlowBlock[]): Layout => ({
    pageSize: { w: 400, h: 500 },
    pages: [
      {
        number: 1,
        fragments: [
          {
            kind: 'para',
            blockId: 'test-tooltip-block',
            fromLine: 0,
            toLine: 1,
            x: 0,
            y: 0,
            width: 200,
          },
        ],
      },
    ],
  });

  beforeEach(() => {
    mount = document.createElement('div');
  });

  it('should add data attribute when tooltip is truncated', () => {
    const longTooltip = 'a'.repeat(600);
    const link: FlowRunLink = {
      version: 2,
      href: 'https://example.com',
      tooltip: longTooltip,
    };

    const block = createFlowBlockWithLink(link);
    const measure = createMeasureForBlock();
    const layout = createLayout([block]);

    painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    const anchor = mount.querySelector('a');
    expect(anchor).toBeTruthy();
    expect(anchor?.getAttribute('title')).toHaveLength(500);
    expect(anchor?.dataset.linkTooltipTruncated).toBe('true');
  });

  it('should not add truncation attribute for short tooltips', () => {
    const link: FlowRunLink = {
      version: 2,
      href: 'https://example.com',
      tooltip: 'Short tooltip',
    };

    const block = createFlowBlockWithLink(link);
    const measure = createMeasureForBlock();
    const layout = createLayout([block]);

    painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    const anchor = mount.querySelector('a');
    expect(anchor?.getAttribute('title')).toBe('Short tooltip');
    expect(anchor?.dataset.linkTooltipTruncated).toBeUndefined();
  });

  it('REGRESSION FIX: should not double-encode tooltip special characters', () => {
    // This tests the critical fix: tooltips should show readable text, not HTML entities
    const link: FlowRunLink = {
      version: 2,
      href: 'https://example.com',
      tooltip: '"Click here" to view <details> & more',
    };

    const block = createFlowBlockWithLink(link);
    const measure = createMeasureForBlock();
    const layout = createLayout([block]);

    painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    const anchor = mount.querySelector('a');
    // Browser automatically escapes when setting title attribute
    // We should pass raw text, NOT pre-encoded HTML entities like &quot;
    expect(anchor?.getAttribute('title')).toBe('"Click here" to view <details> & more');
    expect(anchor?.getAttribute('title')).not.toContain('&quot;');
    expect(anchor?.getAttribute('title')).not.toContain('&lt;');
    expect(anchor?.getAttribute('title')).not.toContain('&gt;');
    expect(anchor?.getAttribute('title')).not.toContain('&amp;');
  });
});

describe('Link accessibility - Focus styles', () => {
  let mount: HTMLElement;

  beforeEach(() => {
    mount = document.createElement('div');
  });

  it('should inject link styles into document', () => {
    const link: FlowRunLink = {
      version: 2,
      href: 'https://example.com',
    };

    const block: FlowBlock = {
      kind: 'paragraph',
      id: 'test-focus-block',
      runs: [
        {
          text: 'Test link',
          fontFamily: 'Arial',
          fontSize: 16,
          link,
        },
      ],
    };

    const measure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 9,
          width: 100,
          ascent: 12,
          descent: 4,
          lineHeight: 18,
        },
      ],
      totalHeight: 18,
    };

    const testLayout: Layout = {
      pageSize: { w: 400, h: 500 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'test-focus-block',
              fromLine: 0,
              toLine: 1,
              x: 0,
              y: 0,
              width: 200,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(testLayout, mount);

    // Check that style tag exists
    const styleTag = document.querySelector('[data-superdoc-link-styles]');
    expect(styleTag).toBeTruthy();
    expect(styleTag?.textContent).toContain(':focus-visible');
    expect(styleTag?.textContent).toContain('superdoc-sr-only');
  });

  it('should not inject styles twice', () => {
    const link: FlowRunLink = {
      version: 2,
      href: 'https://example.com',
    };

    const block: FlowBlock = {
      kind: 'paragraph',
      id: 'test-duplicate-block',
      runs: [
        {
          text: 'Test',
          fontFamily: 'Arial',
          fontSize: 16,
          link,
        },
      ],
    };

    const measure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 4,
          width: 80,
          ascent: 12,
          descent: 4,
          lineHeight: 18,
        },
      ],
      totalHeight: 18,
    };

    const testLayout: Layout = {
      pageSize: { w: 400, h: 500 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'test-duplicate-block',
              fromLine: 0,
              toLine: 1,
              x: 0,
              y: 0,
              width: 200,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(testLayout, mount);
    painter.paint(testLayout, mount);

    const styleTags = document.querySelectorAll('[data-superdoc-link-styles]');
    expect(styleTags.length).toBe(1);
  });
});

describe('Link accessibility - ARIA labels', () => {
  let mount: HTMLElement;

  const createFlowBlockWithRun = (run: unknown): FlowBlock => ({
    kind: 'paragraph',
    id: 'test-aria-block',
    runs: [run],
  });

  const createMeasureForRun = (textLength: number): Measure => ({
    kind: 'paragraph',
    lines: [
      {
        fromRun: 0,
        fromChar: 0,
        toRun: 0,
        toChar: textLength,
        width: 100,
        ascent: 12,
        descent: 4,
        lineHeight: 18,
      },
    ],
    totalHeight: 18,
  });

  const createLayout = (): Layout => ({
    pageSize: { w: 400, h: 500 },
    pages: [
      {
        number: 1,
        fragments: [
          {
            kind: 'para',
            blockId: 'test-aria-block',
            fromLine: 0,
            toLine: 1,
            x: 0,
            y: 0,
            width: 200,
          },
        ],
      },
    ],
  });

  beforeEach(() => {
    mount = document.createElement('div');
  });

  it('should add aria-label for ambiguous "click here" text', () => {
    const link: FlowRunLink = {
      version: 2,
      href: 'https://example.com/article',
    };

    const run = {
      text: 'click here',
      fontFamily: 'Arial',
      fontSize: 16,
      link,
    };

    const block = createFlowBlockWithRun(run);
    const measure = createMeasureForRun(run.text.length);
    const testLayout = createLayout();

    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(testLayout, mount);

    const anchor = mount.querySelector('a');
    expect(anchor?.getAttribute('aria-label')).toContain('example.com');
    expect(anchor?.getAttribute('aria-label')).toBe('click here - example.com');
  });

  it('should add aria-label for "read more" text', () => {
    const link: FlowRunLink = {
      version: 2,
      href: 'https://blog.example.com',
    };

    const run = {
      text: 'read more',
      fontFamily: 'Arial',
      fontSize: 16,
      link,
    };

    const block = createFlowBlockWithRun(run);
    const measure = createMeasureForRun(run.text.length);
    const testLayout = createLayout();

    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(testLayout, mount);

    const anchor = mount.querySelector('a');
    expect(anchor?.getAttribute('aria-label')).toBe('read more - blog.example.com');
  });

  it('should add "opens in new tab" for target=_blank', () => {
    const link: FlowRunLink = {
      version: 2,
      href: 'https://example.com',
      target: '_blank',
    };

    const run = {
      text: 'External site',
      fontFamily: 'Arial',
      fontSize: 16,
      link,
    };

    const block = createFlowBlockWithRun(run);
    const measure = createMeasureForRun(run.text.length);
    const testLayout = createLayout();

    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(testLayout, mount);

    const anchor = mount.querySelector('a');
    expect(anchor?.getAttribute('aria-label')).toContain('opens in new tab');
  });

  it('should not add aria-label for descriptive link text without target', () => {
    const link: FlowRunLink = {
      version: 2,
      href: 'https://example.com',
      target: '_self', // Explicitly set to _self to avoid default _blank behavior
    };

    const run = {
      text: 'View the complete documentation',
      fontFamily: 'Arial',
      fontSize: 16,
      link,
    };

    const block = createFlowBlockWithRun(run);
    const measure = createMeasureForRun(run.text.length);
    const testLayout = createLayout();

    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(testLayout, mount);

    const anchor = mount.querySelector('a');
    // Should not have aria-label for non-ambiguous, non-external text
    expect(anchor?.getAttribute('aria-label')).toBeFalsy();
  });

  it('should handle case-insensitive ambiguous pattern matching', () => {
    const link: FlowRunLink = {
      version: 2,
      href: 'https://example.com',
    };

    const run = {
      text: 'CLICK HERE',
      fontFamily: 'Arial',
      fontSize: 16,
      link,
    };

    const block = createFlowBlockWithRun(run);
    const measure = createMeasureForRun(run.text.length);
    const testLayout = createLayout();

    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(testLayout, mount);

    const anchor = mount.querySelector('a');
    expect(anchor?.getAttribute('aria-label')).toContain('example.com');
  });
});

describe('Link accessibility - Role attributes', () => {
  let mount: HTMLElement;

  const createFlowBlockWithLink = (link: unknown, text: string): FlowBlock => ({
    kind: 'paragraph',
    id: 'test-role-block',
    runs: [
      {
        text,
        fontFamily: 'Arial',
        fontSize: 16,
        link,
      },
    ],
  });

  const createMeasureForText = (textLength: number): Measure => ({
    kind: 'paragraph',
    lines: [
      {
        fromRun: 0,
        fromChar: 0,
        toRun: 0,
        toChar: textLength,
        width: 100,
        ascent: 12,
        descent: 4,
        lineHeight: 18,
      },
    ],
    totalHeight: 18,
  });

  const createLayout = (): Layout => ({
    pageSize: { w: 400, h: 500 },
    pages: [
      {
        number: 1,
        fragments: [
          {
            kind: 'para',
            blockId: 'test-role-block',
            fromLine: 0,
            toLine: 1,
            x: 0,
            y: 0,
            width: 200,
          },
        ],
      },
    ],
  });

  beforeEach(() => {
    mount = document.createElement('div');
  });

  it('should set role=link for valid links', () => {
    const link: FlowRunLink = {
      version: 2,
      href: 'https://example.com',
    };

    const block = createFlowBlockWithLink(link, 'Valid link');
    const measure = createMeasureForText(10);
    const testLayout = createLayout();

    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(testLayout, mount);

    const anchor = mount.querySelector('a');
    expect(anchor?.getAttribute('role')).toBe('link');
    expect(anchor?.getAttribute('tabindex')).toBe('0');
  });

  it('should set role=text for blocked links', () => {
    const link: FlowRunLink = {
      version: 2,
      href: 'javascript:alert(1)',
    };

    const block = createFlowBlockWithLink(link, 'Blocked link');
    const measure = createMeasureForText(12);
    const testLayout = createLayout();

    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(testLayout, mount);

    const span = mount.querySelector('span[data-link-blocked="true"]');
    expect(span?.getAttribute('role')).toBe('text');
    expect(span?.getAttribute('aria-label')).toBe('Invalid link - not clickable');
  });
});

describe('Link accessibility - Tooltip aria-describedby', () => {
  let mount: HTMLElement;

  const createFlowBlockWithLink = (link: unknown): FlowBlock => ({
    kind: 'paragraph',
    id: 'test-tooltip-block',
    runs: [
      {
        text: 'Test Link',
        fontFamily: 'Arial',
        fontSize: 16,
        link,
      },
    ],
  });

  const createMeasureForBlock = (): Measure => ({
    kind: 'paragraph',
    lines: [
      {
        fromRun: 0,
        fromChar: 0,
        toRun: 0,
        toChar: 9,
        width: 100,
        ascent: 12,
        descent: 4,
        lineHeight: 18,
      },
    ],
    totalHeight: 18,
  });

  const createLayout = (): Layout => ({
    pageSize: { w: 400, h: 500 },
    pages: [
      {
        number: 1,
        fragments: [
          {
            kind: 'para',
            blockId: 'test-tooltip-block',
            fromLine: 0,
            toLine: 1,
            x: 0,
            y: 0,
            width: 200,
          },
        ],
      },
    ],
  });

  beforeEach(() => {
    mount = document.createElement('div');
  });

  it('should add aria-describedby for tooltips', () => {
    const link: FlowRunLink = {
      version: 2,
      href: 'https://example.com',
      tooltip: 'Visit our homepage for more information',
    };

    const block = createFlowBlockWithLink(link);
    const measure = createMeasureForBlock();
    const testLayout = createLayout();

    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(testLayout, mount);

    const anchor = mount.querySelector('a');
    const describedBy = anchor?.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();

    // Look for the description element in the mount, not document
    const descElem = mount.querySelector(`#${describedBy}`);
    expect(descElem?.textContent).toBe('Visit our homepage for more information');
    expect(descElem?.className).toContain('superdoc-sr-only');
  });

  it('should maintain title attribute for visual tooltip', () => {
    const link: FlowRunLink = {
      version: 2,
      href: 'https://example.com',
      tooltip: 'Tooltip text',
    };

    const block = createFlowBlockWithLink(link);
    const measure = createMeasureForBlock();
    const testLayout = createLayout();

    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(testLayout, mount);

    const anchor = mount.querySelector('a');
    expect(anchor?.getAttribute('title')).toBe('Tooltip text');
  });

  it('should not add aria-describedby for links without tooltips', () => {
    const link: FlowRunLink = {
      version: 2,
      href: 'https://example.com',
    };

    const block = createFlowBlockWithLink(link);
    const measure = createMeasureForBlock();
    const testLayout = createLayout();

    const painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(testLayout, mount);

    const anchor = mount.querySelector('a');
    expect(anchor?.getAttribute('aria-describedby')).toBeFalsy();
  });

  it('should generate unique IDs for multiple links with tooltips', () => {
    const block1: FlowBlock = {
      kind: 'paragraph',
      id: 'block-1',
      runs: [
        {
          text: 'Link 1',
          fontFamily: 'Arial',
          fontSize: 16,
          link: {
            version: 2,
            href: 'https://example.com',
            tooltip: 'First tooltip',
          },
        },
      ],
    };

    const block2: FlowBlock = {
      kind: 'paragraph',
      id: 'block-2',
      runs: [
        {
          text: 'Link 2',
          fontFamily: 'Arial',
          fontSize: 16,
          link: {
            version: 2,
            href: 'https://test.com',
            tooltip: 'Second tooltip',
          },
        },
      ],
    };

    const measure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 6,
          width: 80,
          ascent: 12,
          descent: 4,
          lineHeight: 18,
        },
      ],
      totalHeight: 18,
    };

    const multiLayout: Layout = {
      pageSize: { w: 400, h: 500 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'block-1',
              fromLine: 0,
              toLine: 1,
              x: 0,
              y: 0,
              width: 200,
            },
            {
              kind: 'para',
              blockId: 'block-2',
              fromLine: 0,
              toLine: 1,
              x: 0,
              y: 20,
              width: 200,
            },
          ],
        },
      ],
    };

    const painter = createTestPainter({ blocks: [block1, block2], measures: [measure, measure] });
    painter.paint(multiLayout, mount);

    const anchors = mount.querySelectorAll('a');
    expect(anchors).toHaveLength(2);

    const id1 = anchors[0].getAttribute('aria-describedby');
    const id2 = anchors[1].getAttribute('aria-describedby');

    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);

    // Look for description elements in the mount, not document
    const desc1 = mount.querySelector(`#${id1}`);
    const desc2 = mount.querySelector(`#${id2}`);

    expect(desc1?.textContent).toBe('First tooltip');
    expect(desc2?.textContent).toBe('Second tooltip');
  });
});

describe('Link rendering metrics', () => {
  let mount: HTMLElement;
  let painter: ReturnType<typeof createTestPainter>;

  const createFlowBlockWithLink = (link: unknown): FlowBlock => ({
    kind: 'paragraph',
    id: 'test-metrics-block',
    runs: [
      {
        text: 'Test Link',
        fontFamily: 'Arial',
        fontSize: 16,
        link,
      },
    ],
  });

  const createMeasureForBlock = (): Measure => ({
    kind: 'paragraph',
    lines: [
      {
        fromRun: 0,
        fromChar: 0,
        toRun: 0,
        toChar: 9,
        width: 100,
        ascent: 12,
        descent: 4,
        lineHeight: 18,
      },
    ],
    totalHeight: 18,
  });

  const createLayout = (): Layout => ({
    pageSize: { w: 400, h: 500 },
    pages: [
      {
        number: 1,
        fragments: [
          {
            kind: 'para',
            blockId: 'test-metrics-block',
            fromLine: 0,
            toLine: 1,
            x: 0,
            y: 0,
            width: 200,
          },
        ],
      },
    ],
  });

  beforeEach(() => {
    mount = document.createElement('div');
    linkMetrics.reset();
  });

  it('should increment sanitized count for valid links', () => {
    const link: FlowRunLink = {
      version: 2,
      href: 'https://example.com',
    };

    const block = createFlowBlockWithLink(link);
    const measure = createMeasureForBlock();
    const layout = createLayout();

    painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    const metrics = linkMetrics.getMetrics();
    expect(metrics['hyperlink.sanitized.count']).toBeGreaterThan(0);
  });

  it('should increment blocked count for invalid links', () => {
    const link: FlowRunLink = {
      version: 2,
      href: 'javascript:alert(1)',
    };

    const block = createFlowBlockWithLink(link);
    const measure = createMeasureForBlock();
    const layout = createLayout();

    painter = createTestPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    const metrics = linkMetrics.getMetrics();
    expect(metrics['hyperlink.blocked.count']).toBeGreaterThan(0);
    expect(metrics['hyperlink.invalid_protocol.count']).toBeGreaterThan(0);
  });

  it('should track multiple metrics across multiple links', () => {
    // Create blocks with different IDs for proper multi-block rendering
    const validBlock1: FlowBlock = {
      kind: 'paragraph',
      id: 'valid-block-1',
      runs: [
        {
          text: 'Valid Link 1',
          fontFamily: 'Arial',
          fontSize: 16,
          link: { version: 2, href: 'https://example.com' },
        },
      ],
    };

    const blockedBlock: FlowBlock = {
      kind: 'paragraph',
      id: 'blocked-block',
      runs: [
        {
          text: 'Blocked Link',
          fontFamily: 'Arial',
          fontSize: 16,
          link: { version: 2, href: 'javascript:alert(1)' },
        },
      ],
    };

    const validBlock2: FlowBlock = {
      kind: 'paragraph',
      id: 'valid-block-2',
      runs: [
        {
          text: 'Valid Link 2',
          fontFamily: 'Arial',
          fontSize: 16,
          link: { version: 2, href: 'https://test.com' },
        },
      ],
    };

    const measure: Measure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 12,
          width: 100,
          ascent: 12,
          descent: 4,
          lineHeight: 18,
        },
      ],
      totalHeight: 18,
    };

    const multiLayout: Layout = {
      pageSize: { w: 400, h: 500 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'para',
              blockId: 'valid-block-1',
              fromLine: 0,
              toLine: 1,
              x: 0,
              y: 0,
              width: 200,
            },
            {
              kind: 'para',
              blockId: 'blocked-block',
              fromLine: 0,
              toLine: 1,
              x: 0,
              y: 20,
              width: 200,
            },
            {
              kind: 'para',
              blockId: 'valid-block-2',
              fromLine: 0,
              toLine: 1,
              x: 0,
              y: 40,
              width: 200,
            },
          ],
        },
      ],
    };

    // Create single painter with all blocks
    painter = createTestPainter({
      blocks: [validBlock1, blockedBlock, validBlock2],
      measures: [measure, measure, measure],
    });
    painter.paint(multiLayout, mount);

    const metrics = linkMetrics.getMetrics();
    expect(metrics['hyperlink.sanitized.count']).toBe(2);
    expect(metrics['hyperlink.blocked.count']).toBe(1);
  });
});

describe('applyRunDataAttributes', () => {
  let element: HTMLElement;

  beforeEach(() => {
    element = document.createElement('span');
  });

  describe('Happy path', () => {
    it('applies valid data attributes to element', () => {
      const dataAttrs = {
        'data-id': '123',
        'data-name': 'test',
        'data-category': 'example',
      };

      applyRunDataAttributes(element, dataAttrs);

      expect(element.getAttribute('data-id')).toBe('123');
      expect(element.getAttribute('data-name')).toBe('test');
      expect(element.getAttribute('data-category')).toBe('example');
    });

    it('applies single data attribute', () => {
      const dataAttrs = {
        'data-id': '456',
      };

      applyRunDataAttributes(element, dataAttrs);

      expect(element.getAttribute('data-id')).toBe('456');
    });

    it('applies attributes with special characters in values', () => {
      const dataAttrs = {
        'data-text': 'hello world',
        'data-url': 'https://example.com/page?param=value',
        'data-json': '{"key":"value"}',
      };

      applyRunDataAttributes(element, dataAttrs);

      expect(element.getAttribute('data-text')).toBe('hello world');
      expect(element.getAttribute('data-url')).toBe('https://example.com/page?param=value');
      expect(element.getAttribute('data-json')).toBe('{"key":"value"}');
    });
  });

  describe('Edge cases', () => {
    it('handles undefined dataAttrs gracefully', () => {
      applyRunDataAttributes(element, undefined);

      // Should not have any data attributes
      expect(element.attributes.length).toBe(0);
    });

    it('handles empty object', () => {
      applyRunDataAttributes(element, {});

      // Should not have any data attributes
      expect(element.attributes.length).toBe(0);
    });

    it('filters out non-data-* attributes at runtime', () => {
      const dataAttrs = {
        'data-id': '123',
        id: 'invalid',
        class: 'invalid',
        'data-valid': 'test',
      } as Record<string, string>;

      applyRunDataAttributes(element, dataAttrs);

      // Only data-* attributes should be set
      expect(element.getAttribute('data-id')).toBe('123');
      expect(element.getAttribute('data-valid')).toBe('test');
      expect(element.getAttribute('id')).toBeNull();
      expect(element.getAttribute('class')).toBeNull();
    });

    it('filters out non-string values at runtime', () => {
      const dataAttrs = {
        'data-id': '123',
        'data-invalid': 456,
        'data-also-invalid': true,
      } as unknown as Record<string, string>;

      applyRunDataAttributes(element, dataAttrs);

      // Only string values should be set
      expect(element.getAttribute('data-id')).toBe('123');
      expect(element.getAttribute('data-invalid')).toBeNull();
      expect(element.getAttribute('data-also-invalid')).toBeNull();
    });

    it('handles case-insensitive data- prefix matching', () => {
      const dataAttrs = {
        'DATA-ID': '123',
        'Data-Name': 'test',
        'dAtA-MiXeD': 'value',
      };

      applyRunDataAttributes(element, dataAttrs);

      expect(element.getAttribute('DATA-ID')).toBe('123');
      expect(element.getAttribute('Data-Name')).toBe('test');
      expect(element.getAttribute('dAtA-MiXeD')).toBe('value');
    });

    it('handles empty string values', () => {
      const dataAttrs = {
        'data-empty': '',
      };

      applyRunDataAttributes(element, dataAttrs);

      expect(element.getAttribute('data-empty')).toBe('');
    });

    it('overwrites existing attributes with same name', () => {
      element.setAttribute('data-id', 'old-value');

      const dataAttrs = {
        'data-id': 'new-value',
      };

      applyRunDataAttributes(element, dataAttrs);

      expect(element.getAttribute('data-id')).toBe('new-value');
    });

    it('preserves existing non-data attributes', () => {
      element.setAttribute('class', 'my-class');
      element.setAttribute('id', 'my-id');

      const dataAttrs = {
        'data-custom': 'value',
      };

      applyRunDataAttributes(element, dataAttrs);

      expect(element.getAttribute('class')).toBe('my-class');
      expect(element.getAttribute('id')).toBe('my-id');
      expect(element.getAttribute('data-custom')).toBe('value');
    });

    it('handles attributes with numeric suffixes', () => {
      const dataAttrs = {
        'data-attr-1': 'value1',
        'data-attr-2': 'value2',
        'data-attr-999': 'value999',
      };

      applyRunDataAttributes(element, dataAttrs);

      expect(element.getAttribute('data-attr-1')).toBe('value1');
      expect(element.getAttribute('data-attr-2')).toBe('value2');
      expect(element.getAttribute('data-attr-999')).toBe('value999');
    });

    it('handles attributes with hyphens and underscores', () => {
      const dataAttrs = {
        'data-kebab-case': 'value1',
        'data-snake_case': 'value2',
        'data-mixed-kebab_snake': 'value3',
      };

      applyRunDataAttributes(element, dataAttrs);

      expect(element.getAttribute('data-kebab-case')).toBe('value1');
      expect(element.getAttribute('data-snake_case')).toBe('value2');
      expect(element.getAttribute('data-mixed-kebab_snake')).toBe('value3');
    });
  });

  describe('Security and safety', () => {
    it('does not execute JavaScript in attribute values', () => {
      const dataAttrs = {
        'data-script': 'javascript:alert(1)',
        'data-onclick': 'alert(1)',
      };

      applyRunDataAttributes(element, dataAttrs);

      // Attributes should be set as plain text, not executed
      expect(element.getAttribute('data-script')).toBe('javascript:alert(1)');
      expect(element.getAttribute('data-onclick')).toBe('alert(1)');
      // Element should not have onclick handler
      expect(element.onclick).toBeNull();
    });

    it('handles HTML entities in values', () => {
      const dataAttrs = {
        'data-html': '<script>alert(1)</script>',
        'data-entities': '&lt;div&gt;',
      };

      applyRunDataAttributes(element, dataAttrs);

      // Should store as plain text
      expect(element.getAttribute('data-html')).toBe('<script>alert(1)</script>');
      expect(element.getAttribute('data-entities')).toBe('&lt;div&gt;');
    });

    it('handles very long attribute values', () => {
      const longValue = 'a'.repeat(10000);
      const dataAttrs = {
        'data-long': longValue,
      };

      applyRunDataAttributes(element, dataAttrs);

      expect(element.getAttribute('data-long')).toBe(longValue);
    });

    it('handles special Unicode characters', () => {
      const dataAttrs = {
        'data-emoji': '😀🎉',
        'data-chinese': '你好',
        'data-arabic': 'مرحبا',
      };

      applyRunDataAttributes(element, dataAttrs);

      expect(element.getAttribute('data-emoji')).toBe('😀🎉');
      expect(element.getAttribute('data-chinese')).toBe('你好');
      expect(element.getAttribute('data-arabic')).toBe('مرحبا');
    });
  });

  describe('setData with header/footer blocks', () => {
    let mount: HTMLElement;

    beforeEach(() => {
      mount = document.createElement('div');
      document.body.appendChild(mount);
    });

    it('should accept header and footer blocks in setData', () => {
      // Main document block
      const mainBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'main-block-1',
        runs: [{ text: 'Main content', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 12 }],
      };

      const mainMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 12,
            width: 120,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      // Header block with prefixed ID (matching HeaderFooterLayoutAdapter pattern)
      const headerBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'hf-header-rId6-0-paragraph',
        runs: [{ text: 'Header text', fontFamily: 'Arial', fontSize: 14, pmStart: 0, pmEnd: 11 }],
      };

      const headerMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 11,
            width: 100,
            ascent: 10,
            descent: 3,
            lineHeight: 16,
          },
        ],
        totalHeight: 16,
      };

      // Footer block with prefixed ID
      const footerBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'hf-footer-rId7-0-paragraph',
        runs: [{ text: 'Footer text', fontFamily: 'Arial', fontSize: 14, pmStart: 0, pmEnd: 11 }],
      };

      const footerMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 11,
            width: 100,
            ascent: 10,
            descent: 3,
            lineHeight: 16,
          },
        ],
        totalHeight: 16,
      };

      const painter = createTestPainter({
        blocks: [mainBlock],
        measures: [mainMeasure],
      });

      // Call setData with header and footer blocks
      expect(() => {
        painter.setData([mainBlock], [mainMeasure], [headerBlock], [headerMeasure], [footerBlock], [footerMeasure]);
      }).not.toThrow();
    });

    it('should render fragments with header block IDs without errors', () => {
      const mainBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'main-block-1',
        runs: [{ text: 'Main content', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 12 }],
      };

      const mainMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 12,
            width: 120,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const headerBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'hf-header-rId6-0-paragraph',
        runs: [{ text: 'Header', fontFamily: 'Arial', fontSize: 14, pmStart: 0, pmEnd: 6 }],
      };

      const headerMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 6,
            width: 60,
            ascent: 10,
            descent: 3,
            lineHeight: 16,
          },
        ],
        totalHeight: 16,
      };

      const layoutWithHeader: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'main-block-1',
                fromLine: 0,
                toLine: 1,
                x: 30,
                y: 40,
                width: 300,
                pmStart: 0,
                pmEnd: 12,
              },
            ],
          },
        ],
      };

      const headerFragment = {
        kind: 'para' as const,
        blockId: 'hf-header-rId6-0-paragraph',
        fromLine: 0,
        toLine: 1,
        x: 0,
        y: 0,
        width: 200,
        pmStart: 0,
        pmEnd: 6,
      };

      const painter = createTestPainter({
        blocks: [mainBlock],
        measures: [mainMeasure],
        headerProvider: () => ({ fragments: [headerFragment], height: 16 }),
      });

      // Set data with header blocks
      painter.setData([mainBlock], [mainMeasure], [headerBlock], [headerMeasure]);

      // Paint should not throw errors about missing blocks
      expect(() => {
        painter.paint(layoutWithHeader, mount);
      }).not.toThrow();

      // Verify header was rendered
      const headerEl = mount.querySelector('.superdoc-page-header');
      expect(headerEl).toBeTruthy();
      expect(headerEl?.textContent).toContain('Header');
    });

    it('should handle multiple header/footer blocks', () => {
      const mainBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'main-1',
        runs: [{ text: 'Content', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 7 }],
      };

      const mainMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 7,
            width: 70,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const headerBlocks: FlowBlock[] = [
        {
          kind: 'paragraph',
          id: 'hf-header-default-0-paragraph',
          runs: [{ text: 'Default Header', fontFamily: 'Arial', fontSize: 14, pmStart: 0, pmEnd: 14 }],
        },
        {
          kind: 'paragraph',
          id: 'hf-header-first-0-paragraph',
          runs: [{ text: 'First Page Header', fontFamily: 'Arial', fontSize: 14, pmStart: 0, pmEnd: 17 }],
        },
      ];

      const headerMeasures: Measure[] = [
        {
          kind: 'paragraph',
          lines: [
            { fromRun: 0, fromChar: 0, toRun: 0, toChar: 14, width: 100, ascent: 10, descent: 3, lineHeight: 16 },
          ],
          totalHeight: 16,
        },
        {
          kind: 'paragraph',
          lines: [
            { fromRun: 0, fromChar: 0, toRun: 0, toChar: 17, width: 120, ascent: 10, descent: 3, lineHeight: 16 },
          ],
          totalHeight: 16,
        },
      ];

      const footerBlocks: FlowBlock[] = [
        {
          kind: 'paragraph',
          id: 'hf-footer-default-0-paragraph',
          runs: [{ text: 'Footer', fontFamily: 'Arial', fontSize: 12, pmStart: 0, pmEnd: 6 }],
        },
      ];

      const footerMeasures: Measure[] = [
        {
          kind: 'paragraph',
          lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 6, width: 50, ascent: 9, descent: 3, lineHeight: 14 }],
          totalHeight: 14,
        },
      ];

      const painter = createTestPainter({
        blocks: [mainBlock],
        measures: [mainMeasure],
      });

      // Should handle multiple header and footer blocks without errors
      expect(() => {
        painter.setData([mainBlock], [mainMeasure], headerBlocks, headerMeasures, footerBlocks, footerMeasures);
      }).not.toThrow();
    });

    it('should handle empty header/footer arrays', () => {
      const mainBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'main-1',
        runs: [{ text: 'Content', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 7 }],
      };

      const mainMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 7,
            width: 70,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const painter = createTestPainter({
        blocks: [mainBlock],
        measures: [mainMeasure],
      });

      // Should handle empty arrays gracefully
      expect(() => {
        painter.setData([mainBlock], [mainMeasure], [], [], [], []);
      }).not.toThrow();
    });

    it('should handle undefined header/footer parameters', () => {
      const mainBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'main-1',
        runs: [{ text: 'Content', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 7 }],
      };

      const mainMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 7,
            width: 70,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const painter = createTestPainter({
        blocks: [mainBlock],
        measures: [mainMeasure],
      });

      // Should handle undefined parameters (backward compatibility)
      expect(() => {
        painter.setData([mainBlock], [mainMeasure], undefined, undefined, undefined, undefined);
      }).not.toThrow();
    });

    it('should maintain backward compatibility with original setData signature', () => {
      const mainBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'main-1',
        runs: [{ text: 'Content', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 7 }],
      };

      const mainMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 7,
            width: 70,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const painter = createTestPainter({
        blocks: [mainBlock],
        measures: [mainMeasure],
      });

      // Should work with just blocks and measures (original signature)
      expect(() => {
        painter.setData([mainBlock], [mainMeasure]);
      }).not.toThrow();

      const layoutData: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'main-1',
                fromLine: 0,
                toLine: 1,
                x: 30,
                y: 40,
                width: 300,
                pmStart: 0,
                pmEnd: 7,
              },
            ],
          },
        ],
      };

      expect(() => {
        painter.paint(layoutData, mount);
      }).not.toThrow();
    });

    it('should properly merge header/footer blocks into blockLookup', () => {
      const mainBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'main-1',
        runs: [{ text: 'Main', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 4 }],
      };

      const headerBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'hf-header-rId6-0-paragraph',
        runs: [{ text: 'Header', fontFamily: 'Arial', fontSize: 14, pmStart: 0, pmEnd: 6 }],
      };

      const footerBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'hf-footer-rId7-0-paragraph',
        runs: [{ text: 'Footer', fontFamily: 'Arial', fontSize: 14, pmStart: 0, pmEnd: 6 }],
      };

      const mainMeasure: Measure = {
        kind: 'paragraph',
        lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 4, width: 40, ascent: 12, descent: 4, lineHeight: 20 }],
        totalHeight: 20,
      };

      const headerMeasure: Measure = {
        kind: 'paragraph',
        lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 6, width: 60, ascent: 10, descent: 3, lineHeight: 16 }],
        totalHeight: 16,
      };

      const footerMeasure: Measure = {
        kind: 'paragraph',
        lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 6, width: 60, ascent: 10, descent: 3, lineHeight: 16 }],
        totalHeight: 16,
      };

      const layoutData: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'main-1',
                fromLine: 0,
                toLine: 1,
                x: 30,
                y: 100,
                width: 300,
                pmStart: 0,
                pmEnd: 4,
              },
            ],
          },
        ],
      };

      const headerFragment = {
        kind: 'para' as const,
        blockId: 'hf-header-rId6-0-paragraph',
        fromLine: 0,
        toLine: 1,
        x: 30,
        y: 10,
        width: 300,
        pmStart: 0,
        pmEnd: 6,
      };

      const footerFragment = {
        kind: 'para' as const,
        blockId: 'hf-footer-rId7-0-paragraph',
        fromLine: 0,
        toLine: 1,
        x: 30,
        y: 450,
        width: 300,
        pmStart: 0,
        pmEnd: 6,
      };

      const painter = createTestPainter({
        blocks: [mainBlock],
        measures: [mainMeasure],
        headerProvider: () => ({ fragments: [headerFragment], height: 20 }),
        footerProvider: () => ({ fragments: [footerFragment], height: 20 }),
      });

      painter.setData([mainBlock], [mainMeasure], [headerBlock], [headerMeasure], [footerBlock], [footerMeasure]);

      // Paint should successfully render all blocks without errors
      expect(() => {
        painter.paint(layoutData, mount);
      }).not.toThrow();

      // Verify all content is rendered
      const content = mount.textContent;
      expect(content).toContain('Main');
      expect(content).toContain('Header');
      expect(content).toContain('Footer');
    });
  });

  describe('footer alignment logic', () => {
    let mount: HTMLElement;

    beforeEach(() => {
      mount = document.createElement('div');
      document.body.appendChild(mount);
    });

    afterEach(() => {
      document.body.removeChild(mount);
    });

    it('should apply offset when footer content is shorter than allocated height with explicit contentHeight', () => {
      const mainBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'main-1',
        runs: [{ text: 'Main', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 4 }],
      };

      const mainMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 4,
            width: 40,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const footerBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'footer-1',
        runs: [{ text: 'Footer', fontFamily: 'Arial', fontSize: 14, pmStart: 0, pmEnd: 6 }],
      };

      const footerMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 6,
            width: 60,
            ascent: 10,
            descent: 3,
            lineHeight: 16,
          },
        ],
        totalHeight: 16,
      };

      const footerFragment: Fragment = {
        kind: 'para',
        blockId: 'footer-1',
        fromLine: 0,
        toLine: 1,
        x: 0,
        y: 0,
        width: 200,
        pmStart: 0,
        pmEnd: 6,
      };

      const layout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'main-1',
                fromLine: 0,
                toLine: 1,
                x: 30,
                y: 40,
                width: 300,
                pmStart: 0,
                pmEnd: 4,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({
        blocks: [mainBlock],
        measures: [mainMeasure],
        footerProvider: () => ({
          fragments: [footerFragment],
          height: 50,
          contentHeight: 16, // Explicit content height smaller than allocated height
        }),
      });

      painter.setData([mainBlock], [mainMeasure], undefined, undefined, [footerBlock], [footerMeasure]);
      painter.paint(layout, mount);

      const footerEl = mount.querySelector('.superdoc-page-footer');
      expect(footerEl).toBeTruthy();

      // Footer content should be pushed to bottom
      // With height=50 and contentHeight=16, offset should be 34px
      const paraEl = footerEl?.querySelector('[data-block-id="footer-1"]') as HTMLElement;
      expect(paraEl).toBeTruthy();
      // The fragment's y position should be offset by (50 - 16) = 34
      expect(paraEl.style.top).toBe('34px');
    });

    it('should calculate offset from fragments when contentHeight is not provided', () => {
      const mainBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'main-1',
        runs: [{ text: 'Main', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 4 }],
      };

      const mainMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 4,
            width: 40,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const footerBlock: FlowBlock = {
        kind: 'table',
        id: 'footer-table',
        rows: [
          {
            id: 'row-1',
            cells: [
              {
                id: 'cell-1',
                paragraph: {
                  kind: 'paragraph',
                  id: 'cell-para-1',
                  runs: [{ text: 'Cell', fontFamily: 'Arial', fontSize: 12, pmStart: 0, pmEnd: 4 }],
                },
              },
            ],
          },
        ],
      };

      const footerMeasure: Measure = {
        kind: 'table',
        rows: [
          {
            cells: [{ paragraph: { kind: 'paragraph', lines: [], totalHeight: 20 }, width: 100, height: 20 }],
            height: 20,
          },
        ],
        columnWidths: [100],
        totalWidth: 100,
        totalHeight: 20,
      };

      // Table fragment with explicit height
      const footerFragment: Fragment = {
        kind: 'table',
        blockId: 'footer-table',
        fromRow: 0,
        toRow: 1,
        x: 0,
        y: 5,
        width: 100,
        height: 20,
      };

      const layout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'main-1',
                fromLine: 0,
                toLine: 1,
                x: 30,
                y: 40,
                width: 300,
                pmStart: 0,
                pmEnd: 4,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({
        blocks: [mainBlock],
        measures: [mainMeasure],
        footerProvider: () => ({
          fragments: [footerFragment],
          height: 60,
          // No contentHeight provided - should calculate from fragments
        }),
      });

      painter.setData([mainBlock], [mainMeasure], undefined, undefined, [footerBlock], [footerMeasure]);
      painter.paint(layout, mount);

      const footerEl = mount.querySelector('.superdoc-page-footer');
      expect(footerEl).toBeTruthy();

      // Fragment at y=5 with height=20, so max y+height = 25
      // With allocated height=60, offset should be 60-25=35
      const tableEl = footerEl?.querySelector('[data-block-id="footer-table"]') as HTMLElement;
      expect(tableEl).toBeTruthy();
      expect(tableEl.style.top).toBe('40px'); // 5 (original y) + 35 (offset)
    });

    it('should not apply offset when footer content is taller than allocated height', () => {
      const mainBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'main-1',
        runs: [{ text: 'Main', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 4 }],
      };

      const mainMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 4,
            width: 40,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const footerBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'footer-1',
        runs: [{ text: 'Tall Footer', fontFamily: 'Arial', fontSize: 14, pmStart: 0, pmEnd: 11 }],
      };

      const footerMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 11,
            width: 110,
            ascent: 10,
            descent: 3,
            lineHeight: 16,
          },
        ],
        totalHeight: 16,
      };

      const footerFragment: Fragment = {
        kind: 'para',
        blockId: 'footer-1',
        fromLine: 0,
        toLine: 1,
        x: 0,
        y: 0,
        width: 200,
        pmStart: 0,
        pmEnd: 11,
      };

      const layout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'main-1',
                fromLine: 0,
                toLine: 1,
                x: 30,
                y: 40,
                width: 300,
                pmStart: 0,
                pmEnd: 4,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({
        blocks: [mainBlock],
        measures: [mainMeasure],
        footerProvider: () => ({
          fragments: [footerFragment],
          height: 30,
          contentHeight: 50, // Content height exceeds allocated height
        }),
      });

      painter.setData([mainBlock], [mainMeasure], undefined, undefined, [footerBlock], [footerMeasure]);
      painter.paint(layout, mount);

      const footerEl = mount.querySelector('.superdoc-page-footer');
      expect(footerEl).toBeTruthy();

      // No offset should be applied (Math.max(0, 30-50) = 0)
      const paraEl = footerEl?.querySelector('[data-block-id="footer-1"]') as HTMLElement;
      expect(paraEl).toBeTruthy();
      expect(paraEl.style.top).toBe('0px');
    });

    it('renders page-relative footer wrapNone foreground media at page level while footer text stays bottom-aligned', () => {
      const mainBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'main-1',
        runs: [{ text: 'Main', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 4 }],
      };
      const mainMeasure: Measure = {
        kind: 'paragraph',
        lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 4, width: 40, ascent: 12, descent: 4, lineHeight: 20 }],
        totalHeight: 20,
      };
      const footerTextBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'footer-text',
        runs: [{ text: 'This document is an insurance summary...', fontFamily: 'Arial', fontSize: 7 }],
      };
      const footerLogoBlock: FlowBlock = {
        kind: 'image',
        id: 'footer-logo',
        src: 'data:image/png;base64,xxx',
        anchor: {
          isAnchored: true,
          hRelativeFrom: 'column',
          vRelativeFrom: 'page',
          offsetH: 575,
          offsetV: -388,
          behindDoc: false,
        },
        wrap: { type: 'None' },
      };
      const footerTextMeasure: Measure = {
        kind: 'paragraph',
        lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 40, width: 500, ascent: 6, descent: 2, lineHeight: 16 }],
        totalHeight: 16,
      };
      const footerLogoMeasure: Measure = { kind: 'image', width: 533, height: 408 };
      const footerTextFragment: Fragment = {
        kind: 'para',
        blockId: 'footer-text',
        fromLine: 0,
        toLine: 1,
        x: 0,
        y: 0,
        width: 900,
      };
      const footerLogoFragment: Fragment = {
        kind: 'image',
        blockId: 'footer-logo',
        x: 575,
        y: -388,
        width: 533,
        height: 408,
        isAnchored: true,
        behindDoc: false,
      };
      const layoutData: Layout = {
        pageSize: { w: 960, h: 540 },
        pages: [
          {
            number: 1,
            margins: { footer: 100 },
            fragments: [{ kind: 'para', blockId: 'main-1', fromLine: 0, toLine: 1, x: 30, y: 40, width: 300 }],
          },
        ],
      };

      const painter = createTestPainter({
        blocks: [mainBlock],
        measures: [mainMeasure],
        footerProvider: () => ({
          fragments: [footerTextFragment, footerLogoFragment],
          height: 16,
          contentHeight: 16,
          offset: 514,
          marginLeft: 44,
        }),
      });

      painter.setData(
        [mainBlock],
        [mainMeasure],
        undefined,
        undefined,
        [footerTextBlock, footerLogoBlock],
        [footerTextMeasure, footerLogoMeasure],
      );
      painter.paint(layoutData, mount);

      const footerEl = mount.querySelector('.superdoc-page-footer') as HTMLElement;
      expect(footerEl).toBeTruthy();
      expect(footerEl.style.top).toBe('514px');

      const textEl = footerEl.querySelector('[data-block-id="footer-text"]') as HTMLElement;
      expect(textEl).toBeTruthy();
      expect(textEl.style.top).toBe('0px');
      expect(footerEl.querySelector('[data-block-id="footer-logo"]')).toBeNull();

      const pageEl = mount.querySelector('.superdoc-page') as HTMLElement;
      const logoPageLevel = pageEl.querySelector(
        '[data-header-footer-overlay-section="footer"][data-block-id="footer-logo"]',
      ) as HTMLElement;
      expect(logoPageLevel).toBeTruthy();
      expect(logoPageLevel.style.top).toBe('52px');
      expect(logoPageLevel.style.left).toBe('619px');
    });

    it('places page-horizontal-relative footer wrapNone overlay media without re-adding the left margin', () => {
      // Companion to the column-relative case above: a wrapNone overlay whose
      // hRelativeFrom is 'page' already carries page-local x, so the foreground
      // overlay path must NOT add marginLeft (doing so double-offsets it right).
      // The left offset keys off hRelativeFrom, independent of vRelativeFrom.
      const mainBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'main-1',
        runs: [{ text: 'Main', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 4 }],
      };
      const mainMeasure: Measure = {
        kind: 'paragraph',
        lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 4, width: 40, ascent: 12, descent: 4, lineHeight: 20 }],
        totalHeight: 20,
      };
      const footerLogoBlock: FlowBlock = {
        kind: 'image',
        id: 'footer-logo',
        src: 'data:image/png;base64,xxx',
        anchor: {
          isAnchored: true,
          hRelativeFrom: 'page',
          vRelativeFrom: 'page',
          offsetH: 700,
          offsetV: -388,
          behindDoc: false,
        },
        wrap: { type: 'None' },
      };
      const footerLogoMeasure: Measure = { kind: 'image', width: 533, height: 408 };
      const footerLogoFragment: Fragment = {
        kind: 'image',
        blockId: 'footer-logo',
        x: 700,
        y: -388,
        width: 533,
        height: 408,
        isAnchored: true,
        behindDoc: false,
      };
      const layoutData: Layout = {
        pageSize: { w: 960, h: 540 },
        pages: [
          {
            number: 1,
            margins: { footer: 100 },
            fragments: [{ kind: 'para', blockId: 'main-1', fromLine: 0, toLine: 1, x: 30, y: 40, width: 300 }],
          },
        ],
      };

      const painter = createTestPainter({
        blocks: [mainBlock],
        measures: [mainMeasure],
        footerProvider: () => ({
          fragments: [footerLogoFragment],
          height: 16,
          contentHeight: 16,
          offset: 514,
          marginLeft: 44,
        }),
      });

      painter.setData([mainBlock], [mainMeasure], undefined, undefined, [footerLogoBlock], [footerLogoMeasure]);
      painter.paint(layoutData, mount);

      const pageEl = mount.querySelector('.superdoc-page') as HTMLElement;
      const logoPageLevel = pageEl.querySelector(
        '[data-header-footer-overlay-section="footer"][data-block-id="footer-logo"]',
      ) as HTMLElement;
      expect(logoPageLevel).toBeTruthy();
      expect(logoPageLevel.style.top).toBe('52px');
      // Page-horizontal-relative: x is page-local, marginLeft (44) is NOT added.
      expect(logoPageLevel.style.left).toBe('700px');
    });

    it('toggles wrapNone overlay pointer events with the active header/footer session', () => {
      const mainBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'main-1',
        runs: [{ text: 'Main', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 4 }],
      };
      const mainMeasure: Measure = {
        kind: 'paragraph',
        lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 4, width: 40, ascent: 12, descent: 4, lineHeight: 20 }],
        totalHeight: 20,
      };
      const footerLogoBlock: FlowBlock = {
        kind: 'image',
        id: 'footer-logo',
        src: 'data:image/png;base64,xxx',
        anchor: {
          isAnchored: true,
          hRelativeFrom: 'column',
          vRelativeFrom: 'page',
          offsetH: 575,
          offsetV: -388,
          behindDoc: false,
        },
        wrap: { type: 'None' },
      };
      const footerLogoMeasure: Measure = { kind: 'image', width: 533, height: 408 };
      const footerLogoFragment: Fragment = {
        kind: 'image',
        blockId: 'footer-logo',
        x: 575,
        y: -388,
        width: 533,
        height: 408,
        isAnchored: true,
        behindDoc: false,
      };
      const layoutData: Layout = {
        pageSize: { w: 960, h: 540 },
        pages: [
          {
            number: 1,
            margins: { footer: 100 },
            fragments: [{ kind: 'para', blockId: 'main-1', fromLine: 0, toLine: 1, x: 30, y: 40, width: 300 }],
          },
        ],
      };

      let isActiveHeaderFooter = false;
      const painter = createTestPainter({
        blocks: [mainBlock],
        measures: [mainMeasure],
        footerProvider: () => ({
          fragments: [footerLogoFragment],
          height: 16,
          contentHeight: 16,
          offset: 514,
          marginLeft: 44,
          isActiveHeaderFooter,
        }),
      });

      painter.setData([mainBlock], [mainMeasure], undefined, undefined, [footerLogoBlock], [footerLogoMeasure]);
      painter.paint(layoutData, mount);

      const overlaySelector = '[data-header-footer-overlay-section="footer"][data-block-id="footer-logo"]';
      const pageEl = mount.querySelector('.superdoc-page') as HTMLElement;
      const inertOverlay = pageEl.querySelector(overlaySelector) as HTMLElement;
      expect(inertOverlay).toBeTruthy();
      expect(inertOverlay.style.pointerEvents).toBe('none');

      // Activating the footer session makes the overlay clickable (Word parity:
      // header/footer objects become editable only inside an active session).
      isActiveHeaderFooter = true;
      painter.paint(layoutData, mount);

      const activeOverlay = (mount.querySelector('.superdoc-page') as HTMLElement).querySelector(
        overlaySelector,
      ) as HTMLElement;
      expect(activeOverlay).toBeTruthy();
      expect(activeOverlay.style.pointerEvents).not.toBe('none');
    });

    it('positions paragraph-relative footer wrapNone foreground media from the footer origin', () => {
      const mainBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'main-1',
        runs: [{ text: 'Main', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 4 }],
      };
      const mainMeasure: Measure = {
        kind: 'paragraph',
        lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 4, width: 40, ascent: 12, descent: 4, lineHeight: 20 }],
        totalHeight: 20,
      };
      const footerTextBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'footer-text',
        runs: [{ text: 'Footer text', fontFamily: 'Arial', fontSize: 7 }],
      };
      const footerLogoBlock: FlowBlock = {
        kind: 'image',
        id: 'footer-logo',
        src: 'data:image/png;base64,xxx',
        anchor: {
          isAnchored: true,
          hRelativeFrom: 'column',
          vRelativeFrom: 'paragraph',
          offsetH: 575,
          offsetV: 126,
          behindDoc: false,
        },
        wrap: { type: 'None' },
      };
      const footerTextMeasure: Measure = {
        kind: 'paragraph',
        lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 11, width: 100, ascent: 6, descent: 2, lineHeight: 16 }],
        totalHeight: 16,
      };
      const footerLogoMeasure: Measure = { kind: 'image', width: 533, height: 408 };
      const footerTextFragment: Fragment = {
        kind: 'para',
        blockId: 'footer-text',
        fromLine: 0,
        toLine: 1,
        x: 0,
        y: 0,
        width: 900,
      };
      const footerLogoFragment: Fragment = {
        kind: 'image',
        blockId: 'footer-logo',
        x: 575,
        y: 126,
        width: 533,
        height: 408,
        isAnchored: true,
        behindDoc: false,
      };
      const layoutData: Layout = {
        pageSize: { w: 960, h: 540 },
        pages: [
          {
            number: 1,
            fragments: [{ kind: 'para', blockId: 'main-1', fromLine: 0, toLine: 1, x: 30, y: 40, width: 300 }],
          },
        ],
      };

      const painter = createTestPainter({
        blocks: [mainBlock],
        measures: [mainMeasure],
        footerProvider: () => ({
          fragments: [footerTextFragment, footerLogoFragment],
          height: 32,
          contentHeight: 16,
          offset: 514,
          marginLeft: 44,
        }),
      });

      painter.setData(
        [mainBlock],
        [mainMeasure],
        undefined,
        undefined,
        [footerTextBlock, footerLogoBlock],
        [footerTextMeasure, footerLogoMeasure],
      );
      painter.paint(layoutData, mount);

      const footerEl = mount.querySelector('.superdoc-page-footer') as HTMLElement;
      const textEl = footerEl.querySelector('[data-block-id="footer-text"]') as HTMLElement;
      expect(textEl.style.top).toBe('16px');

      const pageEl = mount.querySelector('.superdoc-page') as HTMLElement;
      const logoPageLevel = pageEl.querySelector(
        '[data-header-footer-overlay-section="footer"][data-block-id="footer-logo"]',
      ) as HTMLElement;
      expect(logoPageLevel).toBeTruthy();
      expect(logoPageLevel.style.top).toBe('656px');
      expect(logoPageLevel.style.left).toBe('619px');
    });

    it('keeps behindDoc footer media on the existing behind-doc path', () => {
      const mainBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'main-1',
        runs: [{ text: 'Main', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 4 }],
      };
      const mainMeasure: Measure = {
        kind: 'paragraph',
        lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 4, width: 40, ascent: 12, descent: 4, lineHeight: 20 }],
        totalHeight: 20,
      };
      const footerBackgroundBlock: FlowBlock = {
        kind: 'image',
        id: 'footer-background',
        src: 'data:image/png;base64,xxx',
        anchor: {
          isAnchored: true,
          hRelativeFrom: 'column',
          vRelativeFrom: 'paragraph',
          offsetH: -46,
          offsetV: 41,
          behindDoc: true,
        },
        wrap: { type: 'None' },
      };
      const footerBackgroundMeasure: Measure = {
        kind: 'image',
        width: 960,
        height: 540,
      };
      const footerBackgroundFragment: Fragment = {
        kind: 'image',
        blockId: 'footer-background',
        x: -46,
        y: 41,
        width: 960,
        height: 540,
        isAnchored: true,
        behindDoc: true,
      };
      const layoutData: Layout = {
        pageSize: { w: 960, h: 540 },
        pages: [
          {
            number: 1,
            fragments: [{ kind: 'para', blockId: 'main-1', fromLine: 0, toLine: 1, x: 30, y: 40, width: 300 }],
          },
        ],
      };

      const painter = createTestPainter({
        blocks: [mainBlock],
        measures: [mainMeasure],
        footerProvider: () => ({
          fragments: [footerBackgroundFragment],
          height: 16,
          contentHeight: 16,
          offset: 514,
          marginLeft: 44,
        }),
      });

      painter.setData(
        [mainBlock],
        [mainMeasure],
        undefined,
        undefined,
        [footerBackgroundBlock],
        [footerBackgroundMeasure],
      );
      painter.paint(layoutData, mount);

      const pageEl = mount.querySelector('.superdoc-page') as HTMLElement;
      expect(
        pageEl.querySelector('[data-behind-doc-section="footer"][data-block-id="footer-background"]'),
      ).toBeTruthy();
      expect(
        pageEl.querySelector('[data-header-footer-overlay-section="footer"][data-block-id="footer-background"]'),
      ).toBeNull();
    });

    it('should handle empty footer with 0 fragments', () => {
      const mainBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'main-1',
        runs: [{ text: 'Main', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 4 }],
      };

      const mainMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 4,
            width: 40,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const layout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'main-1',
                fromLine: 0,
                toLine: 1,
                x: 30,
                y: 40,
                width: 300,
                pmStart: 0,
                pmEnd: 4,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({
        blocks: [mainBlock],
        measures: [mainMeasure],
        footerProvider: () => ({
          fragments: [], // Empty footer
          height: 40,
        }),
      });

      painter.setData([mainBlock], [mainMeasure]);
      expect(() => {
        painter.paint(layout, mount);
      }).not.toThrow();

      const footerEl = mount.querySelector('.superdoc-page-footer');
      // Footer container should NOT exist when there are no fragments (correct behavior)
      expect(footerEl).toBeNull();
    });

    it('should handle multiple fragments with varying heights', () => {
      const mainBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'main-1',
        runs: [{ text: 'Main', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 4 }],
      };

      const mainMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 4,
            width: 40,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const footerBlocks: FlowBlock[] = [
        {
          kind: 'paragraph',
          id: 'footer-1',
          runs: [{ text: 'Line 1', fontFamily: 'Arial', fontSize: 12, pmStart: 0, pmEnd: 6 }],
        },
        {
          kind: 'table',
          id: 'footer-table',
          rows: [
            {
              id: 'row-1',
              cells: [
                {
                  id: 'cell-1',
                  paragraph: {
                    kind: 'paragraph',
                    id: 'cell-para-1',
                    runs: [{ text: 'Table', fontFamily: 'Arial', fontSize: 10, pmStart: 0, pmEnd: 5 }],
                  },
                },
              ],
            },
          ],
        },
      ];

      const footerMeasures: Measure[] = [
        {
          kind: 'paragraph',
          lines: [
            {
              fromRun: 0,
              fromChar: 0,
              toRun: 0,
              toChar: 6,
              width: 60,
              ascent: 10,
              descent: 2,
              lineHeight: 14,
            },
          ],
          totalHeight: 14,
        },
        {
          kind: 'table',
          rows: [
            {
              cells: [{ paragraph: { kind: 'paragraph', lines: [], totalHeight: 15 }, width: 100, height: 15 }],
              height: 15,
            },
          ],
          columnWidths: [100],
          totalWidth: 100,
          totalHeight: 15,
        },
      ];

      // Multiple fragments with different types and heights
      const footerFragments: Fragment[] = [
        {
          kind: 'para',
          blockId: 'footer-1',
          fromLine: 0,
          toLine: 1,
          x: 0,
          y: 0,
          width: 200,
          pmStart: 0,
          pmEnd: 6,
        },
        {
          kind: 'table',
          blockId: 'footer-table',
          fromRow: 0,
          toRow: 1,
          x: 0,
          y: 20, // Positioned below first fragment
          width: 100,
          height: 15,
        },
      ];

      const layout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'main-1',
                fromLine: 0,
                toLine: 1,
                x: 30,
                y: 40,
                width: 300,
                pmStart: 0,
                pmEnd: 4,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({
        blocks: [mainBlock],
        measures: [mainMeasure],
        footerProvider: () => ({
          fragments: footerFragments,
          height: 70,
          // No contentHeight - should calculate max from fragments
          // Para fragment: y=0, no explicit height (uses measure)
          // Table fragment: y=20, height=15, so max is y+height=35
        }),
      });

      painter.setData([mainBlock], [mainMeasure], undefined, undefined, footerBlocks, footerMeasures);
      painter.paint(layout, mount);

      const footerEl = mount.querySelector('.superdoc-page-footer');
      expect(footerEl).toBeTruthy();

      // Max content height should be calculated as 20 + 15 = 35
      // Offset should be 70 - 35 = 35
      const tableEl = footerEl?.querySelector('[data-block-id="footer-table"]') as HTMLElement;
      expect(tableEl).toBeTruthy();
      expect(tableEl.style.top).toBe('55px'); // 20 (original y) + 35 (offset)

      const paraEl = footerEl?.querySelector('[data-block-id="footer-1"]') as HTMLElement;
      expect(paraEl).toBeTruthy();
      expect(paraEl.style.top).toBe('35px'); // 0 (original y) + 35 (offset)
    });

    it('should apply offset correctly when footer has only para fragments without explicit height', () => {
      const mainBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'main-1',
        runs: [{ text: 'Main', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 4 }],
      };

      const mainMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 4,
            width: 40,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const footerBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'footer-1',
        runs: [{ text: 'Footer', fontFamily: 'Arial', fontSize: 14, pmStart: 0, pmEnd: 6 }],
      };

      const footerMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 6,
            width: 60,
            ascent: 10,
            descent: 3,
            lineHeight: 16,
          },
        ],
        totalHeight: 16,
      };

      // Para fragment without explicit height property
      const footerFragment: Fragment = {
        kind: 'para',
        blockId: 'footer-1',
        fromLine: 0,
        toLine: 1,
        x: 0,
        y: 2,
        width: 200,
        pmStart: 0,
        pmEnd: 6,
      };

      const layout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'main-1',
                fromLine: 0,
                toLine: 1,
                x: 30,
                y: 40,
                width: 300,
                pmStart: 0,
                pmEnd: 4,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({
        blocks: [mainBlock],
        measures: [mainMeasure],
        footerProvider: () => ({
          fragments: [footerFragment],
          height: 50,
          // No contentHeight, para fragment has no height property
          // Should fall back to calculating from y position (y=2, height=0, so max=2)
        }),
      });

      painter.setData([mainBlock], [mainMeasure], undefined, undefined, [footerBlock], [footerMeasure]);
      painter.paint(layout, mount);

      const footerEl = mount.querySelector('.superdoc-page-footer');
      expect(footerEl).toBeTruthy();

      // Para fragments don't have explicit height, so we fall back to the measure's totalHeight (16)
      // Calculated content height = y (2) + 16 = 18, offset = 50 - 18 = 32
      const paraEl = footerEl?.querySelector('[data-block-id="footer-1"]') as HTMLElement;
      expect(paraEl).toBeTruthy();
      expect(paraEl.style.top).toBe('34px'); // 2 (original y) + 32 (offset)
    });
  });

  describe('LineBreak run handling', () => {
    let mount: HTMLElement;

    beforeEach(() => {
      mount = document.createElement('div');
    });
    it('renders paragraph with lineBreak runs without crashing', () => {
      const lineBreakBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'linebreak-1',
        runs: [
          { text: 'First line', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 10 },
          { kind: 'lineBreak', pmStart: 10, pmEnd: 11 },
          { text: 'Second line', fontFamily: 'Arial', fontSize: 16, pmStart: 11, pmEnd: 22 },
        ],
      };

      const lineBreakMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 1,
            toChar: 0,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
          {
            fromRun: 2,
            fromChar: 0,
            toRun: 2,
            toChar: 11,
            width: 110,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 40,
      };

      const lineBreakLayout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'linebreak-1',
                fromLine: 0,
                toLine: 2,
                x: 20,
                y: 20,
                width: 300,
                pmStart: 0,
                pmEnd: 22,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({
        blocks: [lineBreakBlock],
        measures: [lineBreakMeasure],
      });

      // Should not throw TypeError when accessing run.text on lineBreak
      expect(() => {
        painter.paint(lineBreakLayout, mount);
      }).not.toThrow();

      const fragment = mount.querySelector('.superdoc-fragment') as HTMLElement;
      expect(fragment).toBeTruthy();
      expect(fragment.textContent).toContain('First line');
      expect(fragment.textContent).toContain('Second line');
    });

    it('handles lineBreak runs in sliceRunsForLine without TypeError', () => {
      const lineBreakBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'linebreak-slice',
        runs: [
          { text: 'Before', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 6 },
          { kind: 'lineBreak', pmStart: 6, pmEnd: 7 },
          { text: 'After', fontFamily: 'Arial', fontSize: 16, pmStart: 7, pmEnd: 12 },
        ],
      };

      const lineBreakMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 1,
            toChar: 0,
            width: 60,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
          {
            fromRun: 2,
            fromChar: 0,
            toRun: 2,
            toChar: 5,
            width: 50,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 40,
      };

      const lineBreakLayout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'linebreak-slice',
                fromLine: 0,
                toLine: 2,
                x: 20,
                y: 20,
                width: 300,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({
        blocks: [lineBreakBlock],
        measures: [lineBreakMeasure],
      });

      // Should handle lineBreak in line boundary without accessing .text property
      expect(() => {
        painter.paint(lineBreakLayout, mount);
      }).not.toThrow();
    });

    it('renders all lines when measure indices come from inline-newline expansion', () => {
      const inlineNewlineBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'inline-newline-slice',
        runs: [{ text: 'first\nsecond\nthird', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 18 }],
      };

      // Measurer expands inline '\n' into: text, break, text, break, text.
      const inlineNewlineMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 5,
            width: 40,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
          {
            fromRun: 2,
            fromChar: 0,
            toRun: 2,
            toChar: 6,
            width: 50,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
          {
            fromRun: 4,
            fromChar: 0,
            toRun: 4,
            toChar: 5,
            width: 40,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 60,
      };

      const inlineNewlineLayout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'inline-newline-slice',
                fromLine: 0,
                toLine: 3,
                x: 20,
                y: 20,
                width: 300,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({
        blocks: [inlineNewlineBlock],
        measures: [inlineNewlineMeasure],
      });

      expect(() => {
        painter.paint(inlineNewlineLayout, mount);
      }).not.toThrow();

      const fragment = mount.querySelector<HTMLElement>('.superdoc-fragment');
      expect(fragment).not.toBeNull();
      expect(fragment?.textContent).toContain('first');
      expect(fragment?.textContent).toContain('second');
      expect(fragment?.textContent).toContain('third');
      const lines = fragment?.querySelectorAll<HTMLElement>('.superdoc-line');
      expect(lines?.length).toBe(3);
      expect(lines?.[0].dataset.pmStart).toEqual('0');
      expect(lines?.[0].dataset.pmEnd).toEqual('5');
      expect(lines?.[1].dataset.pmStart).toEqual('6');
      expect(lines?.[1].dataset.pmEnd).toEqual('12');
      expect(lines?.[2].dataset.pmStart).toEqual('13');
      expect(lines?.[2].dataset.pmEnd).toEqual('18');
    });

    it('preserves PM positions for lineBreak runs', () => {
      const lineBreakBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'linebreak-pm',
        runs: [
          { text: 'Text', fontFamily: 'Arial', fontSize: 16, pmStart: 5, pmEnd: 9 },
          { kind: 'lineBreak', pmStart: 9, pmEnd: 10 },
        ],
      };

      const lineBreakMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 1,
            toChar: 0,
            width: 40,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const lineBreakLayout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'linebreak-pm',
                fromLine: 0,
                toLine: 1,
                x: 20,
                y: 20,
                width: 300,
                pmStart: 5,
                pmEnd: 10,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({
        blocks: [lineBreakBlock],
        measures: [lineBreakMeasure],
      });

      painter.paint(lineBreakLayout, mount);

      const fragment = mount.querySelector('.superdoc-fragment') as HTMLElement;
      expect(fragment).toBeTruthy();
      expect(fragment.dataset.pmStart).toBe('5');
      expect(fragment.dataset.pmEnd).toBe('10');
    });

    it('renders a trailing lineBreak continuation as a bare PM-ranged line', () => {
      const lineBreakBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'linebreak-continuation',
        runs: [
          { text: 'Text', fontFamily: 'Arial', fontSize: 16, pmStart: 5, pmEnd: 9 },
          { kind: 'lineBreak', pmStart: 9, pmEnd: 10 },
        ],
      };

      const lineBreakMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 4,
            width: 40,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
          {
            fromRun: 1,
            fromChar: 0,
            toRun: 1,
            toChar: 0,
            width: 0,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 40,
      };

      const lineBreakLayout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'linebreak-continuation',
                fromLine: 0,
                toLine: 2,
                x: 20,
                y: 20,
                width: 300,
                pmStart: 5,
                pmEnd: 10,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({
        blocks: [lineBreakBlock],
        measures: [lineBreakMeasure],
      });

      painter.paint(lineBreakLayout, mount);

      const lines = mount.querySelectorAll<HTMLElement>('.superdoc-line');
      expect(lines).toHaveLength(2);
      expect(lines[1].dataset.pmStart).toBe('9');
      expect(lines[1].dataset.pmEnd).toBe('10');
      expect(lines[1].children).toHaveLength(0);
      expect(lines[1].querySelector('.superdoc-empty-run')).toBeNull();
      expect(lines[1].textContent).toBe('');
    });

    it('handles multiple consecutive lineBreak runs', () => {
      const multiLineBreakBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'multi-linebreak',
        runs: [
          { text: 'Line 1', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 6 },
          { kind: 'lineBreak', pmStart: 6, pmEnd: 7 },
          { kind: 'lineBreak', pmStart: 7, pmEnd: 8 },
          { text: 'Line 3', fontFamily: 'Arial', fontSize: 16, pmStart: 8, pmEnd: 14 },
        ],
      };

      const multiLineBreakMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 1,
            toChar: 0,
            width: 60,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
          {
            fromRun: 2,
            fromChar: 0,
            toRun: 2,
            toChar: 0,
            width: 0,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
          {
            fromRun: 3,
            fromChar: 0,
            toRun: 3,
            toChar: 6,
            width: 60,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 60,
      };

      const multiLineBreakLayout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'multi-linebreak',
                fromLine: 0,
                toLine: 3,
                x: 20,
                y: 20,
                width: 300,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({
        blocks: [multiLineBreakBlock],
        measures: [multiLineBreakMeasure],
      });

      expect(() => {
        painter.paint(multiLineBreakLayout, mount);
      }).not.toThrow();

      const fragment = mount.querySelector('.superdoc-fragment') as HTMLElement;
      expect(fragment).toBeTruthy();
      const lines = fragment.querySelectorAll('.superdoc-line');
      expect(lines.length).toBe(3);
    });

    it('handles lineBreak with OOXML attributes preserved', () => {
      const lineBreakWithAttrsBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'linebreak-attrs',
        runs: [
          { text: 'Text', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 4 },
          {
            kind: 'lineBreak',
            attrs: { lineBreakType: 'textWrapping', clear: 'left' },
            pmStart: 4,
            pmEnd: 5,
          },
        ],
      };

      const lineBreakWithAttrsMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 1,
            toChar: 0,
            width: 40,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const lineBreakWithAttrsLayout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'linebreak-attrs',
                fromLine: 0,
                toLine: 1,
                x: 20,
                y: 20,
                width: 300,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({
        blocks: [lineBreakWithAttrsBlock],
        measures: [lineBreakWithAttrsMeasure],
      });

      // Should handle lineBreak with attrs without error
      expect(() => {
        painter.paint(lineBreakWithAttrsLayout, mount);
      }).not.toThrow();
    });
  });

  describe('list marker version detection', () => {
    let mount: HTMLElement;

    beforeEach(() => {
      mount = document.createElement('div');
    });

    it('rebuilds fragment DOM when list marker text changes via setData (indent change)', () => {
      // Initial block at indent level 0 with marker "1."
      const listBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'list-block-1',
        runs: [{ text: 'List item text', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 14 }],
        attrs: {
          numberingProperties: { numId: 1, ilvl: 0 },
          wordLayout: {
            marker: {
              markerText: '1.',
              justification: 'left',
              suffix: 'tab',
              run: { fontFamily: 'Arial', fontSize: 16 },
            },
          },
        },
      };

      const listMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 14,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
        marker: { markerWidth: 15, markerTextWidth: 10, indentLeft: 24 },
      };

      const listLayout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'list-block-1',
                fromLine: 0,
                toLine: 1,
                x: 24,
                y: 24,
                width: 300,
                markerWidth: 15,
                markerTextWidth: 10,
                pmStart: 0,
                pmEnd: 14,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({ blocks: [listBlock], measures: [listMeasure] });
      painter.paint(listLayout, mount);

      const fragmentBefore = mount.querySelector('.superdoc-fragment') as HTMLElement;
      const markerBefore = mount.querySelector('.superdoc-paragraph-marker') as HTMLElement;
      expect(markerBefore?.textContent).toBe('1.');

      // Updated block at indent level 1 with marker "a." (same text content, different marker)
      const updatedListBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'list-block-1',
        runs: [{ text: 'List item text', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 14 }],
        attrs: {
          numberingProperties: { numId: 1, ilvl: 1 },
          wordLayout: {
            marker: {
              markerText: 'a.',
              justification: 'left',
              suffix: 'tab',
              run: { fontFamily: 'Arial', fontSize: 16 },
            },
          },
        },
      };

      painter.setData([updatedListBlock], [listMeasure]);
      painter.paint(listLayout, mount);

      const fragmentAfter = mount.querySelector('.superdoc-fragment') as HTMLElement;
      const markerAfter = mount.querySelector('.superdoc-paragraph-marker') as HTMLElement;

      // Fragment should be rebuilt because marker changed
      expect(fragmentAfter).not.toBe(fragmentBefore);
      expect(markerAfter?.textContent).toBe('a.');
    });

    it('rebuilds fragment DOM when ilvl changes even if markerText is the same', () => {
      // Edge case: marker text might be same at different levels (e.g., both "1." at level 0 and level 2)
      const listBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'list-block-2',
        runs: [{ text: 'Item', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 4 }],
        attrs: {
          numberingProperties: { numId: 2, ilvl: 0 },
          wordLayout: {
            marker: {
              markerText: '1.',
              justification: 'left',
              suffix: 'tab',
              run: { fontFamily: 'Arial', fontSize: 16 },
            },
          },
        },
      };

      const listMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 4,
            width: 40,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
        marker: { markerWidth: 15, markerTextWidth: 10, indentLeft: 24 },
      };

      const listLayout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'list-block-2',
                fromLine: 0,
                toLine: 1,
                x: 24,
                y: 24,
                width: 300,
                markerWidth: 15,
                markerTextWidth: 10,
                pmStart: 0,
                pmEnd: 4,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({ blocks: [listBlock], measures: [listMeasure] });
      painter.paint(listLayout, mount);

      const fragmentBefore = mount.querySelector('.superdoc-fragment') as HTMLElement;

      // Update only ilvl, keep markerText the same
      const updatedListBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'list-block-2',
        runs: [{ text: 'Item', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 4 }],
        attrs: {
          numberingProperties: { numId: 2, ilvl: 2 }, // Changed from 0 to 2
          wordLayout: {
            marker: {
              markerText: '1.', // Same marker text
              justification: 'left',
              suffix: 'tab',
              run: { fontFamily: 'Arial', fontSize: 16 },
            },
          },
        },
      };

      painter.setData([updatedListBlock], [listMeasure]);
      painter.paint(listLayout, mount);

      const fragmentAfter = mount.querySelector('.superdoc-fragment') as HTMLElement;

      // Fragment should be rebuilt because ilvl changed (even if markerText is same)
      expect(fragmentAfter).not.toBe(fragmentBefore);
    });

    it('does not rebuild fragment when list properties are unchanged', () => {
      const listBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'list-block-3',
        runs: [{ text: 'Item', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 4 }],
        attrs: {
          numberingProperties: { numId: 3, ilvl: 0 },
          wordLayout: {
            marker: {
              markerText: '1.',
              justification: 'left',
              suffix: 'tab',
              run: { fontFamily: 'Arial', fontSize: 16 },
            },
          },
        },
      };

      const listMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 4,
            width: 40,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
        marker: { markerWidth: 15, markerTextWidth: 10, indentLeft: 24 },
      };

      const listLayout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'list-block-3',
                fromLine: 0,
                toLine: 1,
                x: 24,
                y: 24,
                width: 300,
                markerWidth: 15,
                markerTextWidth: 10,
                pmStart: 0,
                pmEnd: 4,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({ blocks: [listBlock], measures: [listMeasure] });
      painter.paint(listLayout, mount);

      const fragmentBefore = mount.querySelector('.superdoc-fragment') as HTMLElement;

      // Set identical data
      painter.setData([listBlock], [listMeasure]);
      painter.paint(listLayout, mount);

      const fragmentAfter = mount.querySelector('.superdoc-fragment') as HTMLElement;

      // Fragment should be reused (same reference) since nothing changed
      expect(fragmentAfter).toBe(fragmentBefore);
    });

    it('rebuilds fragment DOM when numId changes even if ilvl and markerText are the same', () => {
      // Edge case: Different list styles (numId) may have same marker text at same level
      const listBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'list-block-4',
        runs: [{ text: 'Item', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 4 }],
        attrs: {
          numberingProperties: { numId: 1, ilvl: 0 },
          wordLayout: {
            marker: {
              markerText: '1.',
              justification: 'left',
              suffix: 'tab',
              run: { fontFamily: 'Arial', fontSize: 16 },
            },
          },
        },
      };

      const listMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 4,
            width: 40,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
        marker: { markerWidth: 15, markerTextWidth: 10, indentLeft: 24 },
      };

      const listLayout: Layout = {
        pageSize: { w: 400, h: 500 },
        pages: [
          {
            number: 1,
            fragments: [
              {
                kind: 'para',
                blockId: 'list-block-4',
                fromLine: 0,
                toLine: 1,
                x: 24,
                y: 24,
                width: 300,
                markerWidth: 15,
                markerTextWidth: 10,
                pmStart: 0,
                pmEnd: 4,
              },
            ],
          },
        ],
      };

      const painter = createTestPainter({ blocks: [listBlock], measures: [listMeasure] });
      painter.paint(listLayout, mount);

      const fragmentBefore = mount.querySelector('.superdoc-fragment') as HTMLElement;

      // Update numId only, keep ilvl and markerText the same
      const updatedListBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'list-block-4',
        runs: [{ text: 'Item', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 4 }],
        attrs: {
          numberingProperties: { numId: 2, ilvl: 0 }, // Changed from 1 to 2
          wordLayout: {
            marker: {
              markerText: '1.', // Same marker text
              justification: 'left',
              suffix: 'tab',
              run: { fontFamily: 'Arial', fontSize: 16 },
            },
          },
        },
      };

      painter.setData([updatedListBlock], [listMeasure]);
      painter.paint(listLayout, mount);

      const fragmentAfter = mount.querySelector('.superdoc-fragment') as HTMLElement;

      // Fragment should be rebuilt because numId changed (different list style)
      expect(fragmentAfter).not.toBe(fragmentBefore);
    });

    describe('block-level structuredContent styling', () => {
      it('adds superdoc-structured-content-block class for block-level structuredContent', () => {
        const blockSdtBlock: FlowBlock = {
          kind: 'paragraph',
          id: 'block-sdt-test',
          runs: [{ text: 'Content in block SDT', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 20 }],
          attrs: {
            sdt: {
              type: 'structuredContent',
              scope: 'block',
              id: 'scb-block-1',
              tag: '{"fieldType":"signer"}',
              alias: 'Block Content Control',
            },
          },
        };

        const blockSdtMeasure: Measure = {
          kind: 'paragraph',
          lines: [
            {
              fromRun: 0,
              fromChar: 0,
              toRun: 0,
              toChar: 20,
              width: 180,
              ascent: 12,
              descent: 4,
              lineHeight: 20,
            },
          ],
          totalHeight: 20,
        };

        const blockSdtLayout: Layout = {
          pageSize: { w: 400, h: 500 },
          pages: [
            {
              number: 1,
              fragments: [
                {
                  kind: 'para',
                  blockId: 'block-sdt-test',
                  fromLine: 0,
                  toLine: 1,
                  x: 20,
                  y: 30,
                  width: 320,
                  pmStart: 0,
                  pmEnd: 20,
                },
              ],
            },
          ],
        };

        const painter = createTestPainter({ blocks: [blockSdtBlock], measures: [blockSdtMeasure] });
        painter.paint(blockSdtLayout, mount);

        const fragment = mount.querySelector('.superdoc-fragment') as HTMLElement;

        // Should have the block SDT class
        expect(fragment.classList.contains('superdoc-structured-content-block')).toBe(true);

        // Should have SDT metadata
        expect(fragment.dataset.sdtType).toBe('structuredContent');
        expect(fragment.dataset.sdtScope).toBe('block');
        expect(fragment.dataset.sdtId).toBe('scb-block-1');
        expect(fragment.dataset.sdtTag).toBe('{"fieldType":"signer"}');

        // Should have the label element
        const label = fragment.querySelector('.superdoc-structured-content__label') as HTMLElement;
        expect(label).toBeTruthy();
        expect(label.classList.contains('superdoc-structured-content-block__label')).toBe(true);
        expect(label.textContent).toBe('Block Content Control');

        // Should have container boundary markers
        expect(fragment.dataset.sdtContainerStart).toBe('true');
        expect(fragment.dataset.sdtContainerEnd).toBe('true');
      });

      it('continues parent block SDT chrome across a nested child block SDT fragment', () => {
        const parentSdt = {
          type: 'structuredContent' as const,
          scope: 'block' as const,
          id: 'parent-sdt',
          alias: 'Parent',
        };
        const childSdt = {
          type: 'structuredContent' as const,
          scope: 'block' as const,
          id: 'child-sdt',
          alias: 'Child',
        };
        const blocks: FlowBlock[] = [
          {
            kind: 'paragraph',
            id: 'parent-marker',
            runs: [{ text: '', fontFamily: 'Arial', fontSize: 16 }],
            attrs: { sdt: parentSdt },
          },
          {
            kind: 'paragraph',
            id: 'child-content',
            runs: [{ text: 'Child text', fontFamily: 'Arial', fontSize: 16 }],
            attrs: { sdt: childSdt, containerSdt: parentSdt },
          },
        ];
        const measures: Measure[] = [
          {
            kind: 'paragraph',
            lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 0, width: 0, ascent: 12, descent: 4, lineHeight: 20 }],
            totalHeight: 20,
          },
          {
            kind: 'paragraph',
            lines: [
              { fromRun: 0, fromChar: 0, toRun: 0, toChar: 10, width: 80, ascent: 12, descent: 4, lineHeight: 20 },
            ],
            totalHeight: 20,
          },
        ];
        const layout: Layout = {
          pageSize: { w: 400, h: 500 },
          pages: [
            {
              number: 1,
              fragments: [
                { kind: 'para', blockId: 'parent-marker', fromLine: 0, toLine: 1, x: 20, y: 30, width: 320 },
                { kind: 'para', blockId: 'child-content', fromLine: 0, toLine: 1, x: 20, y: 50, width: 320 },
              ],
            },
          ],
        };

        const painter = createTestPainter({ blocks, measures });
        painter.paint(layout, mount);

        const fragments = Array.from(mount.querySelectorAll<HTMLElement>('.superdoc-fragment'));
        expect(fragments).toHaveLength(2);
        expect(fragments[0].dataset.sdtId).toBe('parent-sdt');
        expect(fragments[0].dataset.sdtContainerStart).toBe('true');
        expect(fragments[0].dataset.sdtContainerEnd).toBe('false');
        expect(fragments[0].dataset.sdtNextOwnContainerStartsNested).toBe('true');
        expect(fragments[1].dataset.sdtId).toBe('child-sdt');
        expect(fragments[1].dataset.sdtContainerId).toBe('parent-sdt');
        expect(fragments[1].dataset.sdtContainerStart).toBe('false');
        expect(fragments[1].dataset.sdtContainerEnd).toBe('true');
        expect(fragments[1].dataset.sdtOwnContainerStart).toBe('true');
        expect(fragments[1].dataset.sdtOwnContainerEnd).toBe('true');
        expect(fragments[1].dataset.sdtOwnContainerNested).toBe('true');
        expect(fragments[0].querySelector('.superdoc-structured-content__label')?.textContent).toBe('Parent');
        expect(fragments[1].querySelector('.superdoc-structured-content__label')?.textContent).toBe('Child');
      });

      it('keeps the parent label available when a parent block SDT starts with a child block SDT', () => {
        const parentSdt = {
          type: 'structuredContent' as const,
          scope: 'block' as const,
          id: 'parent-sdt',
          alias: 'Parent',
        };
        const childSdt = {
          type: 'structuredContent' as const,
          scope: 'block' as const,
          id: 'child-sdt',
          alias: 'Child',
        };
        const blocks: FlowBlock[] = [
          {
            kind: 'paragraph',
            id: 'child-content',
            runs: [{ text: 'Child text', fontFamily: 'Arial', fontSize: 16 }],
            attrs: { sdt: childSdt, containerSdt: parentSdt },
          },
          {
            kind: 'paragraph',
            id: 'parent-content',
            runs: [{ text: 'Parent text', fontFamily: 'Arial', fontSize: 16 }],
            attrs: { sdt: parentSdt },
          },
        ];
        const measures: Measure[] = [
          {
            kind: 'paragraph',
            lines: [
              { fromRun: 0, fromChar: 0, toRun: 0, toChar: 10, width: 80, ascent: 12, descent: 4, lineHeight: 20 },
            ],
            totalHeight: 20,
          },
          {
            kind: 'paragraph',
            lines: [
              { fromRun: 0, fromChar: 0, toRun: 0, toChar: 11, width: 90, ascent: 12, descent: 4, lineHeight: 20 },
            ],
            totalHeight: 20,
          },
        ];
        const layout: Layout = {
          pageSize: { w: 400, h: 500 },
          pages: [
            {
              number: 1,
              fragments: [
                { kind: 'para', blockId: 'child-content', fromLine: 0, toLine: 1, x: 20, y: 30, width: 320 },
                { kind: 'para', blockId: 'parent-content', fromLine: 0, toLine: 1, x: 20, y: 50, width: 320 },
              ],
            },
          ],
        };

        const painter = createTestPainter({ blocks, measures });
        painter.paint(layout, mount);

        const fragments = Array.from(mount.querySelectorAll<HTMLElement>('.superdoc-fragment'));
        expect(fragments).toHaveLength(2);
        expect(fragments[0].dataset.sdtId).toBe('child-sdt');
        expect(fragments[0].dataset.sdtContainerId).toBe('parent-sdt');
        expect(fragments[0].dataset.sdtContainerStart).toBe('true');
        expect(fragments[0].dataset.sdtContainerEnd).toBe('false');
        expect(fragments[0].dataset.sdtOwnContainerStart).toBe('true');
        expect(fragments[0].dataset.sdtOwnContainerEnd).toBe('true');
        expect(fragments[0].dataset.sdtOwnContainerNested).toBe('true');
        expect(fragments[1].dataset.sdtId).toBe('parent-sdt');
        expect(fragments[1].dataset.sdtContainerStart).toBe('false');
        expect(fragments[1].dataset.sdtContainerEnd).toBe('true');
        expect(
          fragments.map((fragment) => fragment.querySelector('.superdoc-structured-content__label')?.textContent),
        ).toEqual(['Child', 'Parent']);
      });

      it('limits block SDT chrome to paragraph content width', () => {
        const textSdtBlock: FlowBlock = {
          kind: 'paragraph',
          id: 'block-sdt-text',
          runs: [{ text: 'Short content', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 13 }],
          attrs: {
            sdt: {
              type: 'structuredContent',
              scope: 'block',
              id: 'scb-text',
              alias: 'Text Control',
            },
          },
        };

        const textSdtMeasure: Measure = {
          kind: 'paragraph',
          lines: [
            {
              fromRun: 0,
              fromChar: 0,
              toRun: 0,
              toChar: 13,
              width: 96,
              ascent: 12,
              descent: 4,
              lineHeight: 20,
            },
          ],
          totalHeight: 20,
        };

        const textSdtLayout: Layout = {
          pageSize: { w: 400, h: 500 },
          pages: [
            {
              number: 1,
              fragments: [
                {
                  kind: 'para',
                  blockId: 'block-sdt-text',
                  fromLine: 0,
                  toLine: 1,
                  x: 20,
                  y: 30,
                  width: 320,
                  pmStart: 0,
                  pmEnd: 13,
                },
              ],
            },
          ],
        };

        const painter = createTestPainter({ blocks: [textSdtBlock], measures: [textSdtMeasure] });
        painter.paint(textSdtLayout, mount);

        const fragment = mount.querySelector('.superdoc-fragment') as HTMLElement;
        expect(fragment.style.width).toBe('320px');
        expect(fragment.style.getPropertyValue('--sd-sdt-chrome-left')).toBe('0px');
        expect(fragment.style.getPropertyValue('--sd-sdt-chrome-width')).toBe('96px');
      });

      it('keeps multiline block SDT chrome at full fragment width', () => {
        const multilineSdtBlock: FlowBlock = {
          kind: 'paragraph',
          id: 'block-sdt-multiline',
          runs: [{ text: 'First line second line', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 22 }],
          attrs: {
            sdt: {
              type: 'structuredContent',
              scope: 'block',
              id: 'scb-multiline',
              alias: 'Multiline Control',
            },
          },
        };

        const multilineSdtMeasure: Measure = {
          kind: 'paragraph',
          lines: [
            {
              fromRun: 0,
              fromChar: 0,
              toRun: 0,
              toChar: 10,
              width: 80,
              ascent: 12,
              descent: 4,
              lineHeight: 20,
            },
            {
              fromRun: 0,
              fromChar: 11,
              toRun: 0,
              toChar: 22,
              width: 96,
              ascent: 12,
              descent: 4,
              lineHeight: 20,
            },
          ],
          totalHeight: 40,
        };

        const multilineSdtLayout: Layout = {
          pageSize: { w: 400, h: 500 },
          pages: [
            {
              number: 1,
              fragments: [
                {
                  kind: 'para',
                  blockId: 'block-sdt-multiline',
                  fromLine: 0,
                  toLine: 2,
                  x: 20,
                  y: 30,
                  width: 320,
                  pmStart: 0,
                  pmEnd: 22,
                },
              ],
            },
          ],
        };

        const painter = createTestPainter({ blocks: [multilineSdtBlock], measures: [multilineSdtMeasure] });
        painter.paint(multilineSdtLayout, mount);

        const fragment = mount.querySelector('.superdoc-fragment') as HTMLElement;
        expect(fragment.style.width).toBe('320px');
        expect(fragment.style.getPropertyValue('--sd-sdt-chrome-left')).toBe('');
        expect(fragment.style.getPropertyValue('--sd-sdt-chrome-width')).toBe('');
      });

      it('expands block SDT chrome to justified line width', () => {
        const justifiedSdtBlock: FlowBlock = {
          kind: 'paragraph',
          id: 'block-sdt-justified',
          runs: [{ text: 'Alpha beta gamma', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 16 }],
          attrs: {
            alignment: 'justify',
            sdt: {
              type: 'structuredContent',
              scope: 'block',
              id: 'scb-justified',
              alias: 'Justified Control',
            },
          },
        };

        const justifiedSdtMeasure: Measure = {
          kind: 'paragraph',
          lines: [
            {
              fromRun: 0,
              fromChar: 0,
              toRun: 0,
              toChar: 10,
              width: 100,
              ascent: 12,
              descent: 4,
              lineHeight: 20,
            },
            {
              fromRun: 0,
              fromChar: 11,
              toRun: 0,
              toChar: 16,
              width: 60,
              ascent: 12,
              descent: 4,
              lineHeight: 20,
            },
          ],
          totalHeight: 40,
        };

        const justifiedSdtLayout: Layout = {
          pageSize: { w: 400, h: 500 },
          pages: [
            {
              number: 1,
              fragments: [
                {
                  kind: 'para',
                  blockId: 'block-sdt-justified',
                  fromLine: 0,
                  toLine: 1,
                  x: 20,
                  y: 30,
                  width: 320,
                  pmStart: 0,
                  pmEnd: 10,
                  continuesOnNext: true,
                },
              ],
            },
          ],
        };

        const painter = createTestPainter({ blocks: [justifiedSdtBlock], measures: [justifiedSdtMeasure] });
        painter.paint(justifiedSdtLayout, mount);

        const fragment = mount.querySelector('.superdoc-fragment') as HTMLElement;
        expect(fragment.style.width).toBe('320px');
        expect(fragment.style.getPropertyValue('--sd-sdt-chrome-left')).toBe('');
        expect(fragment.style.getPropertyValue('--sd-sdt-chrome-width')).toBe('');
      });

      it('offsets block SDT chrome for indented paragraph content', () => {
        const indentedSdtBlock: FlowBlock = {
          kind: 'paragraph',
          id: 'block-sdt-indented',
          runs: [{ text: 'Indented', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 8 }],
          attrs: {
            indent: { left: 40 },
            sdt: {
              type: 'structuredContent',
              scope: 'block',
              id: 'scb-indented',
              alias: 'Indented Control',
            },
          },
        };

        const indentedSdtMeasure: Measure = {
          kind: 'paragraph',
          lines: [
            {
              fromRun: 0,
              fromChar: 0,
              toRun: 0,
              toChar: 8,
              width: 96,
              ascent: 12,
              descent: 4,
              lineHeight: 20,
            },
          ],
          totalHeight: 20,
        };

        const indentedSdtLayout: Layout = {
          pageSize: { w: 400, h: 500 },
          pages: [
            {
              number: 1,
              fragments: [
                {
                  kind: 'para',
                  blockId: 'block-sdt-indented',
                  fromLine: 0,
                  toLine: 1,
                  x: 20,
                  y: 30,
                  width: 320,
                  pmStart: 0,
                  pmEnd: 8,
                },
              ],
            },
          ],
        };

        const painter = createTestPainter({ blocks: [indentedSdtBlock], measures: [indentedSdtMeasure] });
        painter.paint(indentedSdtLayout, mount);

        const fragment = mount.querySelector('.superdoc-fragment') as HTMLElement;
        expect(fragment.style.width).toBe('320px');
        expect(fragment.style.getPropertyValue('--sd-sdt-chrome-left')).toBe('40px');
        expect(fragment.style.getPropertyValue('--sd-sdt-chrome-width')).toBe('96px');
      });

      it('keeps continuation fragment block SDT chrome at full fragment width', () => {
        const continuedSdtBlock: FlowBlock = {
          kind: 'paragraph',
          id: 'block-sdt-continued',
          runs: [{ text: 'First line second line', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 22 }],
          attrs: {
            indent: { left: 40, firstLine: 30 },
            sdt: {
              type: 'structuredContent',
              scope: 'block',
              id: 'scb-continued',
              alias: 'Continued Control',
            },
          },
        };

        const continuedSdtMeasure: Measure = {
          kind: 'paragraph',
          lines: [
            {
              fromRun: 0,
              fromChar: 0,
              toRun: 0,
              toChar: 10,
              width: 100,
              ascent: 12,
              descent: 4,
              lineHeight: 20,
            },
            {
              fromRun: 0,
              fromChar: 11,
              toRun: 0,
              toChar: 22,
              width: 96,
              ascent: 12,
              descent: 4,
              lineHeight: 20,
            },
          ],
          totalHeight: 40,
        };

        const fragment: Fragment = {
          kind: 'para',
          blockId: 'block-sdt-continued',
          fromLine: 1,
          toLine: 2,
          x: 20,
          y: 30,
          width: 320,
          pmStart: 11,
          pmEnd: 22,
          continuesFromPrev: true,
        };

        const continuedSdtLayout: Layout = {
          pageSize: { w: 400, h: 500 },
          pages: [{ number: 1, fragments: [fragment] }],
        };

        const painter = createTestPainter({ blocks: [continuedSdtBlock], measures: [continuedSdtMeasure] });
        painter.setResolvedLayout({
          version: 1,
          flowMode: 'paginated',
          pageGap: 0,
          pages: [
            {
              id: 'page-0',
              index: 0,
              number: 1,
              width: 400,
              height: 500,
              items: [
                {
                  kind: 'fragment',
                  id: 'block-sdt-continued:1:2',
                  pageIndex: 0,
                  x: fragment.x,
                  y: fragment.y,
                  width: fragment.width,
                  height: 20,
                  fragmentKind: 'para',
                  fragment,
                  blockId: 'block-sdt-continued',
                  fragmentIndex: 0,
                  pmStart: fragment.pmStart,
                  pmEnd: fragment.pmEnd,
                  continuesFromPrev: true,
                  block: continuedSdtBlock,
                  measure: continuedSdtMeasure,
                },
              ],
            },
          ],
        });
        painter.paint(continuedSdtLayout, mount);

        const paintedFragment = mount.querySelector('.superdoc-fragment') as HTMLElement;
        expect(paintedFragment.style.width).toBe('320px');
        expect(paintedFragment.style.getPropertyValue('--sd-sdt-chrome-left')).toBe('');
        expect(paintedFragment.style.getPropertyValue('--sd-sdt-chrome-width')).toBe('');
      });

      it('limits block SDT chrome to inline image content width', () => {
        const imageOnlySdtBlock: FlowBlock = {
          kind: 'paragraph',
          id: 'block-sdt-image-only',
          runs: [
            {
              kind: 'image',
              src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
              width: 210,
              height: 118,
              pmStart: 0,
              pmEnd: 1,
            },
          ],
          attrs: {
            sdt: {
              type: 'structuredContent',
              scope: 'block',
              id: 'scb-image-only',
              alias: 'Image Control',
            },
          },
        };

        const imageOnlySdtMeasure: Measure = {
          kind: 'paragraph',
          lines: [
            {
              fromRun: 0,
              fromChar: 0,
              toRun: 0,
              toChar: 0,
              width: 210,
              ascent: 118,
              descent: 0,
              lineHeight: 118,
            },
          ],
          totalHeight: 118,
        };

        const imageOnlySdtLayout: Layout = {
          pageSize: { w: 400, h: 500 },
          pages: [
            {
              number: 1,
              fragments: [
                {
                  kind: 'para',
                  blockId: 'block-sdt-image-only',
                  fromLine: 0,
                  toLine: 1,
                  x: 20,
                  y: 30,
                  width: 320,
                  pmStart: 0,
                  pmEnd: 1,
                },
              ],
            },
          ],
        };

        const painter = createTestPainter({ blocks: [imageOnlySdtBlock], measures: [imageOnlySdtMeasure] });
        painter.paint(imageOnlySdtLayout, mount);

        const fragment = mount.querySelector('.superdoc-fragment') as HTMLElement;
        expect(fragment.style.width).toBe('320px');
        expect(fragment.style.getPropertyValue('--sd-sdt-chrome-left')).toBe('0px');
        expect(fragment.style.getPropertyValue('--sd-sdt-chrome-width')).toBe('210px');
      });

      it('positions block SDT chrome around centered paragraph content', () => {
        const centeredSdtBlock: FlowBlock = {
          kind: 'paragraph',
          id: 'block-sdt-centered',
          runs: [{ text: 'Centered', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 8 }],
          attrs: {
            alignment: 'center',
            sdt: {
              type: 'structuredContent',
              scope: 'block',
              id: 'scb-centered',
              alias: 'Centered Control',
            },
          },
        };

        const centeredSdtMeasure: Measure = {
          kind: 'paragraph',
          lines: [
            {
              fromRun: 0,
              fromChar: 0,
              toRun: 0,
              toChar: 8,
              width: 100,
              ascent: 12,
              descent: 4,
              lineHeight: 20,
            },
          ],
          totalHeight: 20,
        };

        const centeredSdtLayout: Layout = {
          pageSize: { w: 400, h: 500 },
          pages: [
            {
              number: 1,
              fragments: [
                {
                  kind: 'para',
                  blockId: 'block-sdt-centered',
                  fromLine: 0,
                  toLine: 1,
                  x: 20,
                  y: 30,
                  width: 320,
                  pmStart: 0,
                  pmEnd: 8,
                },
              ],
            },
          ],
        };

        const painter = createTestPainter({ blocks: [centeredSdtBlock], measures: [centeredSdtMeasure] });
        painter.paint(centeredSdtLayout, mount);

        const fragment = mount.querySelector('.superdoc-fragment') as HTMLElement;
        expect(fragment.style.width).toBe('320px');
        expect(fragment.style.getPropertyValue('--sd-sdt-chrome-left')).toBe('110px');
        expect(fragment.style.getPropertyValue('--sd-sdt-chrome-width')).toBe('100px');
      });

      it('positions block SDT chrome around default RTL paragraph content', () => {
        const rtlSdtBlock: FlowBlock = {
          kind: 'paragraph',
          id: 'block-sdt-rtl',
          runs: [{ text: 'مرحبا', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 5 }],
          attrs: {
            directionContext: { inlineDirection: 'rtl', writingMode: 'horizontal-tb' },
            sdt: {
              type: 'structuredContent',
              scope: 'block',
              id: 'scb-rtl',
              alias: 'RTL Control',
            },
          },
        };

        const rtlSdtMeasure: Measure = {
          kind: 'paragraph',
          lines: [
            {
              fromRun: 0,
              fromChar: 0,
              toRun: 0,
              toChar: 5,
              width: 80,
              ascent: 12,
              descent: 4,
              lineHeight: 20,
            },
          ],
          totalHeight: 20,
        };

        const rtlSdtLayout: Layout = {
          pageSize: { w: 400, h: 500 },
          pages: [
            {
              number: 1,
              fragments: [
                {
                  kind: 'para',
                  blockId: 'block-sdt-rtl',
                  fromLine: 0,
                  toLine: 1,
                  x: 20,
                  y: 30,
                  width: 320,
                  pmStart: 0,
                  pmEnd: 5,
                },
              ],
            },
          ],
        };

        const painter = createTestPainter({ blocks: [rtlSdtBlock], measures: [rtlSdtMeasure] });
        painter.paint(rtlSdtLayout, mount);

        const fragment = mount.querySelector('.superdoc-fragment') as HTMLElement;
        expect(fragment.style.width).toBe('320px');
        expect(fragment.style.getPropertyValue('--sd-sdt-chrome-left')).toBe('240px');
        expect(fragment.style.getPropertyValue('--sd-sdt-chrome-width')).toBe('80px');
      });

      it('positions centered block SDT chrome within paragraph indents', () => {
        const centeredIndentedSdtBlock: FlowBlock = {
          kind: 'paragraph',
          id: 'block-sdt-centered-indented',
          runs: [{ text: 'Centered', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 8 }],
          attrs: {
            alignment: 'center',
            indent: { left: 40, right: 60 },
            sdt: {
              type: 'structuredContent',
              scope: 'block',
              id: 'scb-centered-indented',
              alias: 'Centered Indented Control',
            },
          },
        };

        const centeredIndentedSdtMeasure: Measure = {
          kind: 'paragraph',
          lines: [
            {
              fromRun: 0,
              fromChar: 0,
              toRun: 0,
              toChar: 8,
              width: 100,
              ascent: 12,
              descent: 4,
              lineHeight: 20,
            },
          ],
          totalHeight: 20,
        };

        const centeredIndentedSdtLayout: Layout = {
          pageSize: { w: 400, h: 500 },
          pages: [
            {
              number: 1,
              fragments: [
                {
                  kind: 'para',
                  blockId: 'block-sdt-centered-indented',
                  fromLine: 0,
                  toLine: 1,
                  x: 20,
                  y: 30,
                  width: 320,
                  pmStart: 0,
                  pmEnd: 8,
                },
              ],
            },
          ],
        };

        const painter = createTestPainter({
          blocks: [centeredIndentedSdtBlock],
          measures: [centeredIndentedSdtMeasure],
        });
        painter.paint(centeredIndentedSdtLayout, mount);

        const fragment = mount.querySelector('.superdoc-fragment') as HTMLElement;
        expect(fragment.style.width).toBe('320px');
        expect(fragment.style.getPropertyValue('--sd-sdt-chrome-left')).toBe('100px');
        expect(fragment.style.getPropertyValue('--sd-sdt-chrome-width')).toBe('100px');
      });

      it('omits block structured-content label when contentControlsChrome is none', () => {
        const blockSdtBlock: FlowBlock = {
          kind: 'paragraph',
          id: 'block-sdt-none',
          runs: [{ text: 'Content in block SDT', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 20 }],
          attrs: {
            sdt: {
              type: 'structuredContent',
              scope: 'block',
              id: 'scb-block-none',
              tag: '{"fieldType":"signer"}',
              alias: 'Block Content Control',
            },
          },
        };

        const blockSdtMeasure: Measure = {
          kind: 'paragraph',
          lines: [
            { fromRun: 0, fromChar: 0, toRun: 0, toChar: 20, width: 180, ascent: 12, descent: 4, lineHeight: 20 },
          ],
          totalHeight: 20,
        };

        const blockSdtLayout: Layout = {
          pageSize: { w: 400, h: 500 },
          pages: [
            {
              number: 1,
              fragments: [
                {
                  kind: 'para',
                  blockId: 'block-sdt-none',
                  fromLine: 0,
                  toLine: 1,
                  x: 20,
                  y: 30,
                  width: 320,
                  pmStart: 0,
                  pmEnd: 20,
                },
              ],
            },
          ],
        };

        const painter = createTestPainter({
          blocks: [blockSdtBlock],
          measures: [blockSdtMeasure],
          contentControlsChrome: 'none',
        });
        painter.paint(blockSdtLayout, mount);

        const fragment = mount.querySelector('.superdoc-fragment') as HTMLElement;
        expect(fragment.classList.contains('superdoc-structured-content-block')).toBe(true);
        expect(fragment.querySelector('.superdoc-structured-content__label')).toBeFalsy();
      });

      it('updates block SDT boundaries when appending a new fragment during patch rendering', () => {
        const sdtMetadata = {
          type: 'structuredContent' as const,
          scope: 'block' as const,
          id: 'scb-boundary-1',
          alias: 'Boundary Control',
        };

        const buildParagraph = (id: string, text: string, pmStart: number) => {
          const runLength = text.length;
          const block: FlowBlock = {
            kind: 'paragraph',
            id,
            runs: [{ text, fontFamily: 'Arial', fontSize: 16, pmStart, pmEnd: pmStart + runLength }],
            attrs: { sdt: sdtMetadata },
          };

          const measure: Measure = {
            kind: 'paragraph',
            lines: [
              {
                fromRun: 0,
                fromChar: 0,
                toRun: 0,
                toChar: runLength,
                width: 160,
                ascent: 12,
                descent: 4,
                lineHeight: 20,
              },
            ],
            totalHeight: 20,
          };

          return { block, measure };
        };

        const paraA = buildParagraph('sdt-para-a', 'Alpha', 0);
        const paraB = buildParagraph('sdt-para-b', 'Bravo', 5);
        const paraC = buildParagraph('sdt-para-c', 'Charlie', 10);

        const baseFragments = [
          { kind: 'para' as const, blockId: paraA.block.id, fromLine: 0, toLine: 1, x: 20, y: 20, width: 320 },
          { kind: 'para' as const, blockId: paraB.block.id, fromLine: 0, toLine: 1, x: 20, y: 40, width: 320 },
          { kind: 'para' as const, blockId: paraC.block.id, fromLine: 0, toLine: 1, x: 20, y: 60, width: 320 },
        ];

        const initialLayout: Layout = {
          pageSize: { w: 400, h: 500 },
          pages: [{ number: 1, fragments: baseFragments }],
        };

        const painter = createTestPainter({
          blocks: [paraA.block, paraB.block, paraC.block],
          measures: [paraA.measure, paraB.measure, paraC.measure],
        });

        painter.paint(initialLayout, mount);

        const initialA = mount.querySelector('[data-block-id="sdt-para-a"]') as HTMLElement;
        const initialB = mount.querySelector('[data-block-id="sdt-para-b"]') as HTMLElement;
        const initialC = mount.querySelector('[data-block-id="sdt-para-c"]') as HTMLElement;
        expect(initialA).toBeTruthy();
        expect(initialB).toBeTruthy();
        expect(initialC).toBeTruthy();
        expect(initialA.dataset.sdtContainerStart).toBe('true');
        expect(initialA.dataset.sdtContainerEnd).toBe('false');
        expect(initialB.dataset.sdtContainerStart).toBe('false');
        expect(initialB.dataset.sdtContainerEnd).toBe('false');
        expect(initialC.dataset.sdtContainerStart).toBe('false');
        expect(initialC.dataset.sdtContainerEnd).toBe('true');
        expect(initialA.style.getPropertyValue('--sd-sdt-chrome-width')).toBe('');
        expect(initialB.style.getPropertyValue('--sd-sdt-chrome-width')).toBe('');
        expect(initialC.style.getPropertyValue('--sd-sdt-chrome-width')).toBe('');

        const paraD = buildParagraph('sdt-para-d', 'Delta', 17);
        const updatedLayout: Layout = {
          pageSize: initialLayout.pageSize,
          pages: [
            {
              number: 1,
              fragments: [
                ...baseFragments,
                { kind: 'para', blockId: paraD.block.id, fromLine: 0, toLine: 1, x: 20, y: 80, width: 320 },
              ],
            },
          ],
        };

        painter.setData(
          [paraA.block, paraB.block, paraC.block, paraD.block],
          [paraA.measure, paraB.measure, paraC.measure, paraD.measure],
        );
        painter.paint(updatedLayout, mount);

        const updatedC = mount.querySelector('[data-block-id="sdt-para-c"]') as HTMLElement;
        const updatedD = mount.querySelector('[data-block-id="sdt-para-d"]') as HTMLElement;

        expect(updatedC).toBeTruthy();
        expect(updatedD).toBeTruthy();
        expect(updatedC).not.toBe(initialC);
        expect(updatedC.dataset.sdtContainerStart).toBe('false');
        expect(updatedC.dataset.sdtContainerEnd).toBe('false');
        expect(updatedD.dataset.sdtContainerStart).toBe('false');
        expect(updatedD.dataset.sdtContainerEnd).toBe('true');
        expect(updatedC.style.getPropertyValue('--sd-sdt-chrome-width')).toBe('');
        expect(updatedD.style.getPropertyValue('--sd-sdt-chrome-width')).toBe('');
      });

      it('keeps table fragments within block SDT boundaries', () => {
        const sdtMetadata = {
          type: 'structuredContent' as const,
          scope: 'block' as const,
          id: 'scb-table-1',
          alias: 'Table Container',
        };

        const buildParagraph = (id: string, text: string, pmStart: number) => {
          const runLength = text.length;
          const block: FlowBlock = {
            kind: 'paragraph',
            id,
            runs: [{ text, fontFamily: 'Arial', fontSize: 16, pmStart, pmEnd: pmStart + runLength }],
            attrs: { sdt: sdtMetadata },
          };

          const measure: Measure = {
            kind: 'paragraph',
            lines: [
              {
                fromRun: 0,
                fromChar: 0,
                toRun: 0,
                toChar: runLength,
                width: 160,
                ascent: 12,
                descent: 4,
                lineHeight: 20,
              },
            ],
            totalHeight: 20,
          };

          return { block, measure };
        };

        const paraA = buildParagraph('sdt-para-a', 'Alpha', 0);
        const paraB = buildParagraph('sdt-para-b', 'Bravo', 5);

        const tableBlock: TableBlock = {
          kind: 'table',
          id: 'sdt-table',
          attrs: { sdt: sdtMetadata },
          rows: [
            {
              id: 'sdt-table-row',
              cells: [
                {
                  id: 'sdt-table-cell',
                  blocks: [
                    {
                      kind: 'paragraph',
                      id: 'sdt-table-para',
                      runs: [{ text: 'Cell', fontFamily: 'Arial', fontSize: 16 }],
                      attrs: { sdt: sdtMetadata },
                    },
                  ],
                },
              ],
            },
          ],
        };

        const tableMeasure: TableMeasure = {
          kind: 'table',
          rows: [
            {
              height: 30,
              cells: [
                {
                  width: 200,
                  height: 30,
                  blocks: [
                    {
                      kind: 'paragraph',
                      lines: [
                        {
                          fromRun: 0,
                          fromChar: 0,
                          toRun: 0,
                          toChar: 4,
                          width: 40,
                          ascent: 12,
                          descent: 4,
                          lineHeight: 20,
                        },
                      ],
                      totalHeight: 20,
                    },
                  ],
                },
              ],
            },
          ],
          columnWidths: [200],
          totalWidth: 200,
          totalHeight: 30,
        };

        const layout: Layout = {
          pageSize: { w: 400, h: 500 },
          pages: [
            {
              number: 1,
              fragments: [
                { kind: 'para', blockId: paraA.block.id, fromLine: 0, toLine: 1, x: 20, y: 20, width: 320 },
                { kind: 'table', blockId: tableBlock.id, fromRow: 0, toRow: 1, x: 20, y: 40, width: 200, height: 30 },
                { kind: 'para', blockId: paraB.block.id, fromLine: 0, toLine: 1, x: 20, y: 80, width: 320 },
              ],
            },
          ],
        };

        const painter = createTestPainter({
          blocks: [paraA.block, tableBlock, paraB.block],
          measures: [paraA.measure, tableMeasure, paraB.measure],
        });

        painter.paint(layout, mount);

        const paraAEl = mount.querySelector('[data-block-id="sdt-para-a"]') as HTMLElement;
        const tableEl = mount.querySelector('[data-block-id="sdt-table"]') as HTMLElement;
        const paraBEl = mount.querySelector('[data-block-id="sdt-para-b"]') as HTMLElement;

        expect(paraAEl).toBeTruthy();
        expect(tableEl).toBeTruthy();
        expect(paraBEl).toBeTruthy();

        expect(tableEl.style.width).toBe(paraAEl.style.width);
        expect(paraAEl.dataset.sdtContainerStart).toBe('true');
        expect(paraAEl.dataset.sdtContainerEnd).toBe('false');
        expect(tableEl.dataset.sdtContainerStart).toBe('false');
        expect(tableEl.dataset.sdtContainerEnd).toBe('false');
        expect(paraBEl.dataset.sdtContainerStart).toBe('false');
        expect(paraBEl.dataset.sdtContainerEnd).toBe('true');

        expect(tableEl.classList.contains('superdoc-structured-content-block')).toBe(true);
        expect(tableEl.querySelector('.superdoc-structured-content__label')).toBeFalsy();
      });

      it('does not add block SDT styling for inline-scoped structuredContent', () => {
        const inlineSdtBlock: FlowBlock = {
          kind: 'paragraph',
          id: 'inline-sdt-test',
          runs: [{ text: 'Content in inline SDT', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 21 }],
          attrs: {
            sdt: {
              type: 'structuredContent',
              scope: 'inline',
              id: 'sc-inline-test',
              tag: 'text',
              alias: 'Inline Control',
            },
          },
        };

        const inlineSdtMeasure: Measure = {
          kind: 'paragraph',
          lines: [
            {
              fromRun: 0,
              fromChar: 0,
              toRun: 0,
              toChar: 21,
              width: 190,
              ascent: 12,
              descent: 4,
              lineHeight: 20,
            },
          ],
          totalHeight: 20,
        };

        const inlineSdtLayout: Layout = {
          pageSize: { w: 400, h: 500 },
          pages: [
            {
              number: 1,
              fragments: [
                {
                  kind: 'para',
                  blockId: 'inline-sdt-test',
                  fromLine: 0,
                  toLine: 1,
                  x: 20,
                  y: 30,
                  width: 320,
                  pmStart: 0,
                  pmEnd: 21,
                },
              ],
            },
          ],
        };

        const painter = createTestPainter({ blocks: [inlineSdtBlock], measures: [inlineSdtMeasure] });
        painter.paint(inlineSdtLayout, mount);

        const fragment = mount.querySelector('.superdoc-fragment') as HTMLElement;

        // Should NOT have the block SDT class (only inline scope)
        expect(fragment.classList.contains('superdoc-structured-content-block')).toBe(false);

        // Should still have the inline SDT metadata
        expect(fragment.dataset.sdtType).toBe('structuredContent');
        expect(fragment.dataset.sdtScope).toBe('inline');

        // Should NOT have the label element
        const label = fragment.querySelector('.superdoc-structured-content__label');
        expect(label).toBeFalsy();
      });
    });
  });
});
