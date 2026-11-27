// Painter plan P7: the mode-ownership boundary battery.
//
// After P7 there is exactly one paint entry per mode and no other paginated
// arrangement: the persistent reconcile owns paginated flow, `paint()` owns semantic
// flow, horizontal/book layout modes and the legacy virtualization machinery
// are DELETED. These tests pin the guards (cross-mode use fails loud, BEFORE
// any painter state mutates), fresh-state persistent oracle use, and the
// absence of deleted public entry points and options.

import { describe, expect, it, expectTypeOf } from 'vite-plus/test';
import type { ResolvedLayout, ResolvedPage } from '@superdoc/contracts';
import * as painterDom from './index.js';
import { createDomPainter } from './index.js';
import type { DomPainterOptions, LayoutMode } from './index.js';

function resolvedPage(pageIndex: number): ResolvedPage {
  return {
    id: `page-${pageIndex}`,
    index: pageIndex,
    number: pageIndex + 1,
    width: 816,
    height: 1000,
    items: [],
  } as unknown as ResolvedPage;
}

function resolved(pageCount: number, flowMode: 'paginated' | 'semantic' = 'paginated'): ResolvedLayout {
  return {
    version: 1,
    flowMode,
    pageGap: 24,
    pages: Array.from({ length: pageCount }, (_, pageIndex) => resolvedPage(pageIndex)),
  } as unknown as ResolvedLayout;
}

function persistentInput(pages: ResolvedPage[]) {
  return {
    scaffold: {
      generation: 1,
      pageCount: pages.length,
      gapPx: 24,
      totalHeightPx: pages.length * 1024 - 24,
      pages: pages.map((_page, index) => ({
        index,
        topPx: index * 1024,
        heightPx: 1000,
        widthPx: 816,
      })),
    },
    desiredContentPageIndices: pages.map((_page, pageIndex) => pageIndex),
    pinnedContentPageIndices: [],
    packetsByPageIndex: new Map(pages.map((page, pageIndex) => [pageIndex, page])),
    captureSnapshot: false,
  };
}

describe('mode ownership (painter plan P7)', () => {
  it('createDomPainter().paint() rejects paginated flow — default and explicit', () => {
    for (const options of [{}, { flowMode: 'paginated' as const }, { layoutMode: 'vertical' as const }]) {
      const painter = createDomPainter(options);
      const mount = document.createElement('div');
      expect(() => painter.paint({ resolvedLayout: resolved(1) }, mount)).toThrowError(/rejects paginated flow/);
      painter.dispose();
    }
  });

  it('a rejected paginated paint() mutates nothing — the same painter still reconciles persistent pages', () => {
    const painter = createDomPainter({ layoutMode: 'vertical', paintWorkAttribution: true });
    const mount = document.createElement('div');
    expect(() => painter.paint({ resolvedLayout: resolved(2) }, mount)).toThrow();
    // The guard fired at the handle boundary: no pages, no spacers, no state.
    expect(mount.children).toHaveLength(0);
    painter.paintPersistentPages(persistentInput(resolved(2).pages as ResolvedPage[]), mount);
    const work = painter.consumePaintWorkSummary();
    expect(work.persistentPagesCreated).toBe(2);
    expect(mount.querySelectorAll('.superdoc-page')).toHaveLength(2);
    painter.dispose();
  });

  it('createDomPainter().paint() serves semantic flow', () => {
    const painter = createDomPainter({ flowMode: 'semantic' });
    const mount = document.createElement('div');
    expect(() => painter.paint({ resolvedLayout: resolved(1, 'semantic') }, mount)).not.toThrow();
    expect(mount.querySelectorAll('.superdoc-page')).toHaveLength(1);
    painter.dispose();
  });

  it('semantic paint rejects a paginated layout BEFORE any state mutation', () => {
    const painter = createDomPainter({ flowMode: 'semantic' });
    const mount = document.createElement('div');
    expect(() => painter.paint({ resolvedLayout: resolved(1, 'paginated') }, mount)).toThrowError(
      /rejects paginated layout input/,
    );
    expect(mount.children).toHaveLength(0);
    expect(() => painter.paint({ resolvedLayout: resolved(1, 'semantic') }, mount)).not.toThrow();
    painter.dispose();
  });

  it('paintPersistentPages() rejects semantic flow BEFORE any state mutation', () => {
    const painter = createDomPainter({ flowMode: 'semantic' });
    const mount = document.createElement('div');
    expect(() =>
      painter.paintPersistentPages(persistentInput(resolved(1).pages as ResolvedPage[]), mount),
    ).toThrowError(/rejects semantic flow/);
    expect(mount.children).toHaveLength(0);
    // The same painter still dense-paints semantic content afterwards.
    expect(() => painter.paint({ resolvedLayout: resolved(1, 'semantic') }, mount)).not.toThrow();
    painter.dispose();
  });

  it('fresh-state paginated oracles use the same persistent reconcile', () => {
    const oracle = createDomPainter({ layoutMode: 'vertical' });
    const mount = document.createElement('div');
    const layout = resolved(3);
    expect(() => oracle.paintPersistentPages(persistentInput(layout.pages as ResolvedPage[]), mount)).not.toThrow();
    expect(mount.querySelectorAll('.superdoc-page')).toHaveLength(3);
    expect(oracle.getPersistentPageIndices()).toEqual([0, 1, 2]);
    expect(oracle.getHydratedContentPageIndices()).toEqual([0, 1, 2]);
    oracle.dispose();
  });

  it('exports no alternate paginated painter factory or batch method', () => {
    const ordinary = createDomPainter({ layoutMode: 'vertical' }) as unknown as Record<string, unknown>;
    const retiredFactory = ['createDense', 'ReferencePainter'].join('');
    const retiredBatch = ['paintDense', 'PageBatch'].join('');
    expect((painterDom as Record<string, unknown>)[retiredFactory]).toBeUndefined();
    expect(ordinary[retiredBatch]).toBeUndefined();
    ordinary.dispose?.();
  });

  it('LayoutMode is exactly "vertical" and the deleted options stay off DomPainterOptions', () => {
    expectTypeOf<LayoutMode>().toEqualTypeOf<'vertical'>();
    expectTypeOf<DomPainterOptions>().not.toHaveProperty('virtualization');
    expectTypeOf<DomPainterOptions>().not.toHaveProperty('ruler');
  });
});
