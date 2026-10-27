import { describe, expect, it } from 'vite-plus/test';
import type { Layout, ParagraphBlock, ParagraphMeasure, TableBlock, TableMeasure, TextRun } from '@superdoc/contracts';
import { createTestPainter, paintResolvedLayoutPersistent } from './_test-utils.js';
import { createDomPainter } from './index.js';
import { resolveLayout } from '@superdoc/layout-resolved';

const markerRun: TextRun = {
  kind: 'text',
  text: '\u200b',
  vanish: true,
  fontFamily: 'Arial',
  fontSize: 12,
  pmStart: 1,
  pmEnd: 1,
  dataAttrs: { 'data-page-break-deletion-anchor': 'true', 'data-page-break-deletion-source-node-id': 'donor' },
  trackedChange: { id: 'page-break-deletion', kind: 'delete', author: 'Ada', storyKey: 'body' },
};
const paragraph: ParagraphBlock = {
  kind: 'paragraph',
  id: 'recipient',
  sourceAnchor: { sourceNodeId: 'recipient' },
  attrs: { trackedChangesMode: 'review' },
  runs: [markerRun, { kind: 'text', text: 'Sed', fontFamily: 'Arial', fontSize: 12, pmStart: 1, pmEnd: 4 }],
};
const measure: ParagraphMeasure = {
  kind: 'paragraph',
  lines: [{ fromRun: 0, fromChar: 0, toRun: 1, toChar: 3, width: 30, ascent: 12, descent: 4, lineHeight: 20 }],
  totalHeight: 20,
};
function layout(y: number, left = 96, right = 96, x = 96): Layout {
  return {
    pageSize: { w: 400, h: 500 },
    pages: [
      {
        number: 1,
        margins: { top: 0, bottom: 0, left, right },
        fragments: [
          { kind: 'para', blockId: paragraph.id, fromLine: 0, toLine: 1, x, y, width: 208, pmStart: 1, pmEnd: 4 },
        ],
      },
    ],
  };
}
function box(marker: HTMLElement, x: number, y: number) {
  const height = Number.parseFloat(marker.style.height) || Number.parseFloat(marker.style.fontSize);
  let top = Number.parseFloat(marker.style.top) || 0;
  let left = Number.parseFloat(marker.style.left) || 0;
  for (
    let ancestor = marker.parentElement;
    ancestor && !ancestor.classList.contains('superdoc-fragment');
    ancestor = ancestor.parentElement
  ) {
    top += Number.parseFloat(ancestor.style.top) || 0;
    left += Number.parseFloat(ancestor.style.left) || 0;
  }
  return {
    x: x + left,
    y: y + top - (marker.style.transform.includes('translateY(-100%)') ? height : 0),
    width: Number.parseFloat(marker.style.width) || 100,
    height,
  };
}
function intersection(a: { x: number; y: number; width: number; height: number }, b: typeof a) {
  return (
    Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  );
}
function tableFixture(nested: boolean, marked = true): { block: TableBlock; measure: TableMeasure } {
  const child: ParagraphBlock = {
    ...paragraph,
    id: 'cell-recipient',
    sourceAnchor: { sourceNodeId: 'cell-recipient' },
    runs: marked ? paragraph.runs : paragraph.runs.slice(1),
  };
  const childMeasure: ParagraphMeasure = { ...measure, lines: [{ ...measure.lines[0], toRun: marked ? 1 : 0 }] };
  const inner: TableBlock = {
    kind: 'table',
    id: 'inner-table',
    columnWidths: [208],
    rows: [
      {
        id: 'inner-row',
        cells: [{ id: 'inner-cell', attrs: { padding: { top: 0, bottom: 0, left: 0, right: 0 } }, blocks: [child] }],
      },
    ],
  };
  const innerMeasure: TableMeasure = {
    kind: 'table',
    totalWidth: 208,
    totalHeight: 20,
    columnWidths: [208],
    rows: [{ height: 20, cells: [{ width: 208, height: 20, gridColumnStart: 0, blocks: [childMeasure] }] }],
  };
  if (!nested) return { block: inner, measure: innerMeasure };
  return {
    block: {
      ...inner,
      id: 'outer-table',
      rows: [
        {
          id: 'outer-row',
          cells: [{ id: 'outer-cell', attrs: { padding: { top: 0, bottom: 0, left: 0, right: 0 } }, blocks: [inner] }],
        },
      ],
    },
    measure: {
      ...innerMeasure,
      rows: [{ height: 20, cells: [{ width: 208, height: 20, gridColumnStart: 0, blocks: [innerMeasure] }] }],
    },
  };
}
function tableLayout(block: TableBlock): Layout {
  return {
    ...layout(0),
    pages: [
      {
        ...layout(0).pages[0],
        fragments: [
          {
            kind: 'table',
            blockId: block.id,
            fromRow: 0,
            toRow: 1,
            x: 96,
            y: 0,
            width: 208,
            height: 20,
            pmStart: 1,
            pmEnd: 4,
          },
        ],
      },
    ],
  };
}
describe('SD-5989 page-clipped review feedback', () => {
  it('keeps the page-edge bar in the deletion color when authored text is black', () => {
    const marked: ParagraphBlock = {
      ...paragraph,
      runs: [
        {
          ...markerRun,
          color: '#000000',
          trackedChange: { ...markerRun.trackedChange!, semanticColorKey: 'deletion', semanticColor: '#cb0e47' },
        },
        paragraph.runs[1],
      ],
    };
    const mount = document.createElement('div');
    const reference = document.createElement('span');
    reference.style.backgroundColor = '#cb0e47';
    document.body.append(mount, reference);
    const painter = createTestPainter({ blocks: [marked], measures: [measure] });
    try {
      painter.paint(layout(0), mount);
      const marker = mount.querySelector<HTMLElement>('[data-page-break-deletion-anchor]')!;
      expect(marker.style.color).toBe('#000000');
      expect(marker.style.getPropertyValue('--sd-tracked-changes-semantic-color')).toBe('#cb0e47');
      expect(getComputedStyle(marker).backgroundColor).toBe(getComputedStyle(reference).backgroundColor);
      marker.style.setProperty('--sd-tracked-changes-semantic-color', '#ffffff');
      reference.style.backgroundColor = '#ffffff';
      expect(getComputedStyle(marker).backgroundColor).toBe(getComputedStyle(reference).backgroundColor);
      marker.style.removeProperty('--sd-tracked-changes-semantic-color');
      reference.style.backgroundColor = 'currentColor';
      expect(getComputedStyle(marker).backgroundColor.toLowerCase()).toBe(
        getComputedStyle(reference).backgroundColor.toLowerCase(),
      );
      expect(marker.dataset.trackChangeId).toBe('page-break-deletion');
      expect(box(marker, 96, 0)).toEqual({ x: 0, y: 0, width: 1, height: 14 });
    } finally {
      painter.dispose();
      mount.remove();
      reference.remove();
    }
  });
  it('keeps the canonical marker visible when every top and side margin is zero', () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const painter = createTestPainter({ blocks: [paragraph], measures: [measure] });
    try {
      painter.paint(layout(0, 0, 0, 0), mount);
      const root = mount.querySelector<HTMLElement>('.superdoc-fragment')!;
      const marker = root.querySelector<HTMLElement>('[data-page-break-deletion-anchor]')!;
      const rect = box(marker, 0, 0);
      expect(intersection(rect, { x: 0, y: 0, width: 400, height: 500 })).toBeGreaterThan(0);
      expect(rect).toEqual({ x: 0, y: 0, width: 1, height: 14 });
      expect(marker.dataset.trackChangeId).toBe('page-break-deletion');
      expect(marker.dataset.pageBreakDeletionSourceNodeId).toBe('donor');
      expect(marker.dataset.pmStart).toBe(marker.dataset.pmEnd);
      expect(marker.getAttribute('aria-label')).toBe('Deleted page break');
      expect(marker.title).toBe('Deleted page break');
      expect(root.style.left).toBe('0px');
      expect(root.style.top).toBe('0px');
      expect(root.style.width).toBe('208px');
      expect(root.querySelector<HTMLElement>('.superdoc-line')!.style.height).toBe('20px');
      expect(mount.querySelectorAll('.superdoc-page')).toHaveLength(1);
      expect(mount.querySelectorAll('[data-layout-fragment-id]')).toHaveLength(1);
      expect(mount.textContent?.replace('Page break', '')).toBe('Sed');
    } finally {
      painter.dispose();
      mount.remove();
    }
  });
  it('keeps feedback clear of a rendered header at 70px with the body at 96px', () => {
    const header: ParagraphBlock = {
      kind: 'paragraph',
      id: 'root-header',
      sourceAnchor: { sourceNodeId: 'root-header' },
      runs: [{ kind: 'text', text: 'Root header text', fontFamily: 'Arial', fontSize: 12 }],
    };
    const headerMeasure: ParagraphMeasure = {
      kind: 'paragraph',
      totalHeight: 18,
      lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 16, width: 150, ascent: 12, descent: 6, lineHeight: 18 }],
    };
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const painter = createTestPainter({
      blocks: [paragraph, header],
      measures: [measure, headerMeasure],
      headerProvider: () => ({
        fragments: [{ kind: 'para', blockId: header.id, fromLine: 0, toLine: 1, x: 0, y: 0, width: 208 }],
        height: 18,
        offset: 70,
        marginLeft: 96,
        headerFooterRefId: 'rIdRootHeader',
      }),
    });
    try {
      painter.paint(layout(96), mount);
      const marker = mount.querySelector<HTMLElement>('[data-page-break-deletion-anchor]')!;
      const headerRoot = mount.querySelector<HTMLElement>('.superdoc-page-header')!;
      const headerFragment = headerRoot.querySelector<HTMLElement>('.superdoc-fragment')!;
      const occupied = {
        x: Number.parseFloat(headerRoot.style.left) + Number.parseFloat(headerFragment.style.left),
        y: Number.parseFloat(headerRoot.style.top) + Number.parseFloat(headerFragment.style.top),
        width: headerMeasure.lines[0].width,
        height: Number.parseFloat(headerFragment.querySelector<HTMLElement>('.superdoc-line')!.style.height),
      };
      expect(occupied).toEqual({ x: 96, y: 70, width: 150, height: 18 });
      expect(intersection(box(marker, 96, 96), occupied)).toBe(0);
      expect(headerRoot.textContent).toBe('Root header text');
      expect(headerFragment.dataset.layoutStory).toBe('header:rIdRootHeader');
      expect(headerFragment.style.width).toBe('208px');
      const bodyRoot = marker.closest<HTMLElement>('.superdoc-fragment')!;
      expect(bodyRoot.style.top).toBe('96px');
      expect(bodyRoot.style.left).toBe('96px');
      expect(bodyRoot.querySelector<HTMLElement>('.superdoc-line')!.style.height).toBe('20px');
    } finally {
      painter.dispose();
      mount.remove();
    }
  });
  it.each([0, 495])('keeps consecutive native carriers distinct and inside the page at y=%s', (y) => {
    const second: TextRun = {
      ...markerRun,
      dataAttrs: { ...markerRun.dataAttrs, 'data-page-break-deletion-source-node-id': 'second-donor' },
      trackedChange: { ...markerRun.trackedChange!, id: 'second-page-break-deletion' },
    };
    const marked: ParagraphBlock = { ...paragraph, runs: [markerRun, second, paragraph.runs[1]] };
    const markedMeasure: ParagraphMeasure = { ...measure, lines: [{ ...measure.lines[0], toRun: 2 }] };
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const painter = createTestPainter({ blocks: [marked], measures: [markedMeasure] });
    try {
      painter.paint(layout(y, 0, 0, 0), mount);
      const markers = [...mount.querySelectorAll<HTMLElement>('[data-page-break-deletion-anchor]')];
      expect(markers.map((marker) => marker.dataset.trackChangeId)).toEqual([
        'page-break-deletion',
        'second-page-break-deletion',
      ]);
      expect(markers.map((marker) => marker.dataset.pageBreakDeletionSourceNodeId)).toEqual(['donor', 'second-donor']);
      const rects = markers.map((marker) => box(marker, 0, y));
      for (const rect of rects) {
        expect(intersection(rect, { x: 0, y: 0, width: 400, height: 500 })).toBeCloseTo(rect.width * rect.height, 6);
        expect(rect.width).toBe(1);
        expect(rect.height).toBe(14);
      }
      expect(intersection(rects[0], rects[1])).toBe(0);
      expect(rects[1].y - rects[0].y).toBe(18);
      expect(markers.every((marker) => marker.dataset.pmStart === marker.dataset.pmEnd)).toBe(true);
      painter.setData([paragraph], [measure]);
      painter.paint(layout(y, 0, 0, 0), mount);
      const remaining = mount.querySelectorAll<HTMLElement>('[data-page-break-deletion-anchor]');
      expect(remaining).toHaveLength(1);
      expect(remaining[0].dataset.trackChangeId).toBe('page-break-deletion');
      expect(markers[1].isConnected).toBe(false);
      expect(box(remaining[0], 0, y).y).toBe(Math.min(y, 486));
      expect(mount.textContent?.replace('Page break', '')).toBe('Sed');
    } finally {
      painter.dispose();
      mount.remove();
    }
  });
  it.each([0, 8, 96])('keeps the actual painted marker inside the page without covering text at y=%s', (y) => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const painter = createTestPainter({ blocks: [paragraph], measures: [measure] });
    try {
      painter.paint(layout(y), mount);
      const marker = mount.querySelector<HTMLElement>('[data-page-break-deletion-anchor]')!;
      const rect = box(marker, 96, y);
      expect(rect.height).toBeGreaterThanOrEqual(4);
      expect(intersection(rect, { x: 0, y: 0, width: 400, height: 500 })).toBeCloseTo(rect.width * rect.height, 6);
      expect(intersection(rect, { x: 96, y, width: 30, height: 20 })).toBe(0);
      expect(marker.dataset.trackChangeId).toBe('page-break-deletion');
      expect(marker.dataset.pageBreakDeletionSourceNodeId).toBe('donor');
      expect(marker.dataset.pmStart).toBe(marker.dataset.pmEnd);
      expect(marker.getAttribute('aria-label')).toBe('Deleted page break');
      expect(mount.querySelectorAll('.superdoc-page')).toHaveLength(1);
      expect(mount.querySelectorAll('[data-layout-fragment-id]')).toHaveLength(1);
      expect(mount.textContent?.replace('Page break', '')).toBe('Sed');
      expect(rect).toEqual({ x: 0, y, width: 1, height: 14 });
      expect(marker.style.transform).toBe('none');
    } finally {
      painter.dispose();
      mount.remove();
    }
  });
  it('keeps feedback current on movement and removes it with a dirty source paragraph', () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const painter = createTestPainter({ blocks: [paragraph], measures: [measure] });
    try {
      painter.paint(layout(0), mount);
      const root = mount.querySelector<HTMLElement>('.superdoc-fragment')!;
      const marker = root.querySelector<HTMLElement>('[data-page-break-deletion-anchor]')!;
      expect(marker.parentElement).toBe(root);
      expect(marker.dataset.pageBreakDeletionPresentation).toBe('page-edge');
      painter.paint(layout(96), mount);
      const moved = mount.querySelector<HTMLElement>('[data-page-break-deletion-anchor]')!;
      expect(moved.parentElement).toBe(mount.querySelector('.superdoc-fragment'));
      expect(box(moved, 96, 96)).toEqual({ x: 0, y: 96, width: 1, height: 14 });
      expect(moved.style.transform).toBe('none');
      expect(moved.style.fontSize).toBe('0px');
      expect(moved.style.backgroundColor).toBe('var(--sd-tracked-changes-semantic-color,currentColor)');
      painter.paint(layout(0), mount);
      const pending = mount.querySelector<HTMLElement>('[data-page-break-deletion-anchor]')!;
      expect(pending.parentElement).toBe(mount.querySelector('.superdoc-fragment'));
      const cleared = { ...paragraph, runs: paragraph.runs.slice(1) };
      const clearedMeasure: ParagraphMeasure = { ...measure, lines: [{ ...measure.lines[0], toRun: 0 }] };
      painter.setData([cleared], [clearedMeasure]);
      painter.paint(layout(0), mount);
      expect(mount.querySelector('[data-page-break-deletion-anchor]')).toBeNull();
      expect(pending.isConnected).toBe(false);
      expect(mount.textContent).toBe('Sed');
    } finally {
      painter.dispose();
      mount.remove();
    }
  });
  it('retains page-edge placement when the page margin changes without repainting source text', () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const painter = createTestPainter({ blocks: [paragraph], measures: [measure] });
    try {
      painter.paint(layout(0), mount);
      const marker = mount.querySelector<HTMLElement>('[data-page-break-deletion-anchor]')!;
      const root = mount.querySelector<HTMLElement>('.superdoc-fragment');
      painter.paint(layout(0, 0, 96), mount);
      expect(mount.querySelector('.superdoc-fragment')).toBe(root);
      expect(box(marker, 96, 0)).toEqual({ x: 0, y: 0, width: 1, height: 14 });
      expect(mount.querySelector('[data-page-break-deletion-anchor]')).toBe(marker);
      painter.paint(layout(0, 0, 0), mount);
      expect(marker.parentElement).toBe(root);
      expect(box(marker, 96, 0)).toEqual({ x: 0, y: 0, width: 1, height: 14 });
      expect(marker.dataset.pageBreakDeletionPresentation).toBe('page-edge');
    } finally {
      painter.dispose();
      mount.remove();
    }
  });
  it('uses the physical page edge beside an adjacent text column', () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const painter = createTestPainter({ blocks: [paragraph], measures: [measure] });
    try {
      painter.paint(layout(0, 40, 40, 220), mount);
      const marker = mount.querySelector<HTMLElement>('[data-page-break-deletion-anchor]')!;
      const rect = box(marker, 220, 0);
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(40);
      expect(rect.x).toBe(0);
      expect(intersection(rect, { x: 40, y: 0, width: 160, height: 20 })).toBe(0);
    } finally {
      painter.dispose();
      mount.remove();
    }
  });
  it('hides a clipped marker when review rendering is disabled without retaining a root orphan', () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const painter = createTestPainter({ blocks: [paragraph], measures: [measure] });
    try {
      painter.paint(layout(0), mount);
      const old = mount.querySelector<HTMLElement>('[data-page-break-deletion-anchor]')!;
      painter.setData(
        [
          {
            ...paragraph,
            attrs: { ...paragraph.attrs, trackedChangesMode: 'final' },
            runs: [
              { ...markerRun, trackedChange: { ...markerRun.trackedChange!, id: 'next-native-change' } },
              paragraph.runs[1],
            ],
          },
        ],
        [measure],
      );
      painter.paint(layout(0), mount);
      expect(old.isConnected).toBe(false);
      const hidden = mount.querySelector<HTMLElement>('[data-page-break-deletion-anchor]')!;
      expect(hidden.textContent).toBe('');
      expect(hidden.style.borderLeft).toBe('');
      expect(hidden.style.backgroundColor).toBe('');
      expect(hidden.dataset.pageBreakDeletionPresentation).toBeUndefined();
    } finally {
      painter.dispose();
      mount.remove();
    }
  });

  it.each([false, true])(
    'keeps final table glyphs at the page edge and removes them with their cell (nested=%s)',
    (nested) => {
      const initial = tableFixture(nested);
      const mount = document.createElement('div');
      document.body.appendChild(mount);
      const painter = createTestPainter({
        blocks: [initial.block],
        measures: [initial.measure],
        paintWorkAttribution: true,
        tableCellSourceIdentity: (block, row, column) => block.rows[row]?.cells[column] ?? null,
      });
      try {
        painter.paint(tableLayout(initial.block), mount);
        const root = mount.querySelector<HTMLElement>('.superdoc-table-fragment')!;
        const marker = root.querySelector<HTMLElement>('[data-page-break-deletion-anchor]')!;
        const rect = box(marker, 96, 0);
        expect(intersection(rect, { x: 0, y: 0, width: 400, height: 500 })).toBeCloseTo(rect.width * rect.height, 6);
        expect(intersection(rect, { x: 96, y: 0, width: 30, height: 20 })).toBe(0);
        expect(marker.parentElement).toBe(root);
        expect(marker.dataset.sourceNodeId).toBe('cell-recipient');
        expect(marker.dataset.pageBreakDeletionSourceNodeId).toBe('donor');
        const ids = [...root.querySelectorAll<HTMLElement>('[data-layout-fragment-id]')].map(
          (e) => e.dataset.layoutFragmentId,
        );
        expect(new Set(ids).size).toBe(ids.length);
        const cleared = tableFixture(nested, false);
        painter.setData([cleared.block], [cleared.measure]);
        painter.paint(tableLayout(cleared.block), mount);
        expect(mount.querySelector('.superdoc-table-fragment')).toBe(root);
        expect(marker.isConnected).toBe(false);
        expect(root.querySelector('[data-page-break-deletion-anchor]')).toBeNull();
        expect(root.textContent).toBe('Sed');
      } finally {
        painter.dispose();
        mount.remove();
      }
    },
  );
  it('keeps a numbered paragraph source owner when its glyph uses the page edge', () => {
    const numbered: ParagraphBlock = {
      ...paragraph,
      attrs: {
        ...paragraph.attrs,
        wordLayout: {
          marker: {
            markerText: '1.',
            justification: 'left',
            suffix: 'space',
            run: { fontFamily: 'Arial', fontSize: 12 },
          },
          gutter: { widthPx: 20 },
        },
        indent: { left: 20 },
      },
    };
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const painter = createTestPainter({ blocks: [numbered], measures: [measure] });
    try {
      painter.paint(layout(0), mount);
      const marker = mount.querySelector<HTMLElement>('[data-page-break-deletion-anchor]')!;
      expect(marker.closest('[data-source-node-id]')?.getAttribute('data-source-node-id')).toBe('recipient');
      expect(marker.dataset.pageBreakDeletionSourceNodeId).toBe('donor');
      expect(marker.dataset.layoutFragmentId).toBeUndefined();
      expect(marker.dataset.trackChangeId).toBe('page-break-deletion');
      const rect = box(marker, 96, 0);
      expect(intersection(rect, { x: 0, y: 0, width: 400, height: 500 })).toBeCloseTo(rect.width * rect.height, 6);
      expect(rect.x + rect.width).toBeLessThanOrEqual(96);
    } finally {
      painter.dispose();
      mount.remove();
    }
  });
  it('drops hoisted glyphs during dehydration and paints a fresh owned glyph on rehydration', () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const painter = createDomPainter({});
    const resolved = resolveLayout({
      layout: layout(0),
      flowMode: 'paginated',
      blocks: [paragraph],
      measures: [measure],
    });
    try {
      paintResolvedLayoutPersistent(painter, resolved, mount);
      const page = mount.querySelector('.superdoc-page');
      const old = mount.querySelector<HTMLElement>('[data-page-break-deletion-anchor]')!;
      painter.paintPersistentPages(
        {
          scaffold: {
            generation: resolved.layoutEpoch ?? 0,
            pageCount: 1,
            gapPx: resolved.pageGap,
            totalHeightPx: 500,
            pages: [{ index: 0, topPx: 0, widthPx: 400, heightPx: 500, pageNumber: 1 }],
          },
          desiredContentPageIndices: [],
          packetsByPageIndex: new Map(),
        },
        mount,
      );
      expect(mount.querySelector('.superdoc-page')).toBe(page);
      expect(old.isConnected).toBe(false);
      expect(mount.querySelector('[data-page-break-deletion-anchor]')).toBeNull();
      paintResolvedLayoutPersistent(painter, resolved, mount);
      const fresh = mount.querySelector<HTMLElement>('[data-page-break-deletion-anchor]')!;
      expect(fresh).not.toBe(old);
      expect(fresh.dataset.trackChangeId).toBe('page-break-deletion');
      const rect = box(fresh, 96, 0);
      expect(intersection(rect, { x: 0, y: 0, width: 400, height: 500 })).toBeCloseTo(rect.width * rect.height, 6);
    } finally {
      painter.dispose();
      mount.remove();
    }
  });
  it('keeps the compact review marker out of native text groups beside a tall inline image', () => {
    const withImage: ParagraphBlock = {
      ...paragraph,
      runs: [...paragraph.runs, { kind: 'image', src: 'image.png', width: 31, height: 100, pmStart: 4, pmEnd: 5 }],
    };
    const imageMeasure: ParagraphMeasure = {
      kind: 'paragraph',
      totalHeight: 100,
      lines: [{ fromRun: 0, fromChar: 0, toRun: 2, toChar: 0, width: 100, ascent: 100, descent: 0, lineHeight: 100 }],
    };
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const painter = createTestPainter({ blocks: [withImage], measures: [imageMeasure] });
    try {
      painter.paint(layout(96), mount);
      const marker = mount.querySelector<HTMLElement>('[data-page-break-deletion-anchor]')!;
      expect(marker.closest('.superdoc-inline-text-group')).toBeNull();
      expect(marker.style.height).toBe('14px');
      expect(marker.style.lineHeight).toBe('0px');
      expect(box(marker, 96, 96)).toEqual({ x: 0, y: 96, width: 1, height: 14 });
      expect([...mount.querySelectorAll('.superdoc-inline-text-group')].some((e) => e.textContent === 'Sed')).toBe(
        true,
      );
    } finally {
      painter.dispose();
      mount.remove();
    }
  });
});
