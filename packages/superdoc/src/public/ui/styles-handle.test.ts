import { describe, expect, it, vi } from 'vite-plus/test';
import type { AsyncReadEntry } from './async-read-cache.js';
import type { LooseRecord } from './loose-record.js';
import {
  createStyleReads,
  createStylesHandle,
  documentDefaultParagraphStyleId,
  styleCatalogReadKey,
  WORD_DEFAULT_PARAGRAPH_STYLE_ID,
  type StyleReadsDeps,
} from './styles-handle.js';
import type {
  SelectionSlice,
  SliceStatus,
  SnapshotSubscribable,
  StylesSlice,
  Subscribable,
  SuperDocUIFailureReceipt,
  SuperDocUIState,
  WorkflowReceipt,
} from './types.js';

function style(id: string, quickGallery = true) {
  return { id, name: `${id} name`, type: 'paragraph', visibility: { quickGallery } };
}

function catalogResult(over: Record<string, unknown> = {}) {
  return {
    version: 'style-catalog/v1',
    revision: 'rev-1',
    view: 'all',
    defaults: { paragraphStyleId: 'Normal', characterStyleId: null, tableStyleId: null },
    items: [style('Normal'), style('Heading1')],
    styles: [style('Normal'), style('Heading1'), style('Quote', false)],
    sourceStatus: null,
    diagnostics: [{ severity: 'info', code: 'catalog-note', message: 'note' }],
    ...over,
  };
}

function selectionOf(blockIds: string[], status: SliceStatus = 'ready'): SelectionSlice {
  const segments = blockIds.map((blockId) => ({ blockId, range: { start: 0, end: 1 } }));
  return {
    status,
    empty: false,
    target: segments.length > 0 ? { kind: 'text', segments: [segments[0], ...segments.slice(1)] } : null,
    selectionTarget: null,
    activeMarks: [],
    activeCommentIds: [],
    activeChangeIds: [],
    quotedText: '',
  };
}

function setupReads(
  options: {
    blocks?: Record<string, string | null | undefined>;
    catalog?: (input: unknown) => unknown;
    noDoc?: boolean;
    noEditor?: boolean;
  } = {},
) {
  const blocks = options.blocks ?? { P1: 'Heading1' };
  const getCatalog = vi.fn(options.catalog ?? ((input: unknown) => catalogResult({ input })));
  const stylesApi: LooseRecord = { getCatalog };
  const doc: LooseRecord = { styles: stylesApi };
  const readKeys: string[] = [];
  const readTokens: string[] = [];
  const readNodeById = vi.fn(
    (_doc: LooseRecord | null, blockId: string): ReturnType<StyleReadsDeps['readNodeById']> => {
      if (!(blockId in blocks)) return { value: null, status: 'ready' as const };
      const styleRef = blocks[blockId];
      return {
        value: { node: { kind: 'paragraph', paragraph: styleRef ? { styleRef } : {} } },
        status: 'ready' as const,
      };
    },
  );
  const deps: StyleReadsDeps = {
    hasEditor: () => options.noEditor !== true,
    getDoc: () => (options.noDoc ? null : doc),
    contentToken: () => 'token-1',
    readAsync: <T>(key: string, token: string, run: () => unknown, normalize: (raw: unknown) => T | null) => {
      readKeys.push(key);
      readTokens.push(token);
      return { value: normalize(run()), status: 'ready' as const };
    },
    readNodeById,
  };
  return { reads: createStyleReads(deps), getCatalog, readKeys, readTokens, readNodeById, doc, stylesApi };
}

describe('style catalogue reads', () => {
  it('keys each catalogue read by its input', () => {
    expect(styleCatalogReadKey()).toBe('styles:catalog:{}');
    expect(styleCatalogReadKey({ includePreview: true })).toBe('styles:catalog:{"includePreview":true}');
  });

  it('reads the full and quick-gallery views with previews, calling getCatalog on its owner', () => {
    const { reads, getCatalog, readKeys, readTokens, doc } = setupReads();
    const { cache } = reads.catalog();
    expect(readKeys).toEqual([
      styleCatalogReadKey({ includePreview: true }),
      styleCatalogReadKey({ view: 'quickGallery', includePreview: true }),
    ]);
    expect(readTokens).toEqual(['token-1', 'token-1']);
    expect(getCatalog).toHaveBeenNthCalledWith(1, { includePreview: true });
    expect(getCatalog).toHaveBeenNthCalledWith(2, { view: 'quickGallery', includePreview: true });
    expect(getCatalog.mock.contexts[0]).toBe(doc.styles);
    expect(cache?.quickGallery.map((item) => item.id)).toEqual(['Normal', 'Heading1']);
    expect(cache?.byId.get('Quote')?.name).toBe('Quote name');
  });

  it('falls back to the visibility flag when the quick-gallery view is unreadable', () => {
    const { reads } = setupReads({
      catalog: (input) =>
        typeof input === 'object' && input !== null && 'view' in input ? null : catalogResult({ items: [] }),
    });
    expect(reads.catalog().cache?.quickGallery.map((item) => item.id)).toEqual(['Normal', 'Heading1']);
  });

  it('treats a result without the catalogue shape as unavailable', () => {
    const { reads } = setupReads({ catalog: () => ({ styles: [] }) });
    expect(reads.readCatalog({}).value).toBeNull();
    expect(reads.catalog().cache).toBeNull();
  });

  it('reports a ready null catalogue when the styles surface is missing, without reading', () => {
    const { reads, readKeys } = setupReads({ noDoc: true });
    expect(reads.readCatalog()).toEqual({ value: null, status: 'ready' });
    expect(readKeys).toEqual([]);
  });

  it('uses Word Normal when the catalogue names no default paragraph style', () => {
    expect(documentDefaultParagraphStyleId(null)).toBe(WORD_DEFAULT_PARAGRAPH_STYLE_ID);
    const { reads } = setupReads({
      catalog: () =>
        catalogResult({ defaults: { paragraphStyleId: null, characterStyleId: null, tableStyleId: null } }),
    });
    expect(documentDefaultParagraphStyleId(reads.catalog().cache)).toBe('Normal');
  });
});

describe('active paragraph style', () => {
  it('resolves a uniform style with its catalogue name', () => {
    const { reads } = setupReads({ blocks: { P1: 'Heading1', P2: 'Heading1' } });
    expect(reads.activeParagraphStyle(selectionOf(['P1', 'P2'])).style).toEqual({
      styleId: 'Heading1',
      styleName: 'Heading1 name',
      mixed: false,
      diagnostics: [],
    });
  });

  it('resolves a paragraph without an explicit style to the document default', () => {
    const { reads } = setupReads({ blocks: { P1: null } });
    expect(reads.activeParagraphStyle(selectionOf(['P1'])).style.styleId).toBe('Normal');
  });

  it('reports a mixed selection when blocks resolve to different styles', () => {
    const { reads } = setupReads({ blocks: { P1: 'Heading1', P2: null } });
    expect(reads.activeParagraphStyle(selectionOf(['P1', 'P2'])).style).toEqual({
      styleId: null,
      styleName: null,
      mixed: true,
      diagnostics: [],
    });
  });

  it('fails closed when any selected block is unreadable', () => {
    const { reads } = setupReads({ blocks: { P1: 'Heading1' } });
    const { style } = reads.activeParagraphStyle(selectionOf(['P1', 'P2']));
    expect(style.styleId).toBeNull();
    expect(style.diagnostics.map((d) => d.code)).toEqual(['active-style-partial']);
  });

  it('names the missing default when only unstyled paragraphs meet an unavailable catalogue', () => {
    const { reads } = setupReads({ blocks: { P1: null }, catalog: () => null });
    expect(reads.activeParagraphStyle(selectionOf(['P1'])).style.diagnostics.map((d) => d.code)).toEqual([
      'active-style-default-unavailable',
    ]);
  });

  it('reports a read failure when no selected block can be read', () => {
    const { reads } = setupReads({ blocks: {} });
    expect(reads.activeParagraphStyle(selectionOf(['P1'])).style.diagnostics.map((d) => d.code)).toEqual([
      'active-style-read-failed',
    ]);
  });

  it('reports no selection, an unreachable document, and an oversized selection without block reads', () => {
    const { reads, readNodeById } = setupReads();
    expect(reads.activeParagraphStyle(selectionOf([])).style.diagnostics[0]?.code).toBe('active-style-no-selection');
    const ids = Array.from({ length: 65 }, (_, i) => `P${i}`);
    expect(reads.activeParagraphStyle(selectionOf(ids)).style.diagnostics[0]?.code).toBe(
      'active-style-selection-too-large',
    );
    expect(readNodeById).not.toHaveBeenCalled();
    const unreachable = setupReads({ noDoc: true }).reads;
    expect(unreachable.activeParagraphStyle(selectionOf(['P1'])).style.diagnostics[0]?.code).toBe(
      'active-style-unavailable',
    );
  });
});

describe('styles slice', () => {
  it('is the not-ready empty slice before an editor exists', () => {
    const { reads, readKeys } = setupReads({ noEditor: true });
    const slice = reads.computeSlice(selectionOf(['P1']));
    expect(slice.ready).toBe(false);
    expect(slice).toBe(reads.computeSlice(selectionOf(['P1'])));
    expect(readKeys).toEqual([]);
  });

  it('reuses the catalogue diagnostics array when the active style adds none', () => {
    const catalog = catalogResult();
    const { reads } = setupReads({ catalog: () => catalog });
    const slice = reads.computeSlice(selectionOf(['P1']));
    expect(slice.diagnostics).toBe(catalog.diagnostics);
    expect(slice).toMatchObject({
      ready: true,
      catalogRevision: 'rev-1',
      activeParagraphStyleId: 'Heading1',
      mixedSelection: false,
    });
  });

  it('adds the active-style diagnostics after the catalogue ones', () => {
    const { reads } = setupReads({ blocks: {} });
    expect(reads.computeSlice(selectionOf(['P1'])).diagnostics.map((d) => d.code)).toEqual([
      'catalog-note',
      'active-style-read-failed',
    ]);
  });

  it('reports the unavailable catalogue first and the worst status of its inputs', () => {
    const { reads } = setupReads({ catalog: () => null });
    const slice = reads.computeSlice(selectionOf(['P1'], 'stale'));
    expect(slice.diagnostics[0]?.code).toBe('catalog-unavailable');
    expect(slice.status).toBe('stale');
    expect(slice.quickGallery).toEqual([]);
  });
});

function setupHandle(
  options: { mode?: SuperDocUIState['documentMode']; entries?: Record<string, AsyncReadEntry> } = {},
) {
  const reads = setupReads({ blocks: { P1: 'Heading1' } });
  const env: { selection: SelectionSlice; disposed: boolean; slice: StylesSlice } = {
    selection: selectionOf(['P1']),
    disposed: false,
    slice: reads.reads.computeSlice(selectionOf(['P1'])),
  };
  const sub: Subscribable<StylesSlice> = { get: () => env.slice, subscribe: () => () => undefined };
  const snapshotHandle = (inner: Subscribable<StylesSlice>): SnapshotSubscribable<StylesSlice> => ({
    get: () => inner.get(),
    getSnapshot: () => inner.get(),
    observe: (listener) => inner.subscribe(listener),
    subscribe: (listener) => inner.subscribe((snapshot) => listener({ snapshot })),
  });
  const demandHeavyDocRead = vi.fn();
  const settleWorkflowReceipt = vi.fn(
    (receipt: unknown, fallback: SuperDocUIFailureReceipt): WorkflowReceipt =>
      receipt === 'applied' ? { success: true } : fallback,
  );
  const apply = vi.fn(() => 'applied');
  const readSelection = vi.fn(
    async (input: { view: string }): Promise<unknown> => ({
      collapsed: false,
      properties: { bold: { state: 'uniform', value: input.view === 'effective' || input.view === 'direct' } },
    }),
  );
  reads.doc.format = { readSelection };
  reads.stylesApi.apply = apply;
  const handle = createStylesHandle({
    reads: reads.reads,
    select: (selector) => {
      expect(selector({ styles: env.slice })).toBe(env.slice);
      return sub;
    },
    snapshotHandle,
    currentSelection: () => env.selection,
    isDisposed: () => env.disposed,
    getDoc: () => reads.doc,
    contentToken: () => 'token-1',
    demandHeavyDocRead,
    readAsyncEntry: (key) => options.entries?.[key],
    readDocumentMode: () => options.mode ?? 'editing',
    readHostSelectionSnapshot: () => null,
    readSelectionInfoFresh: async () => env.selection,
    settleWorkflowReceipt,
  });
  return { handle, env, reads, demandHeavyDocRead, apply, readSelection };
}

describe('styles handle', () => {
  it('demands the heavy catalogue read before serving getCatalog', () => {
    const { handle, demandHeavyDocRead, reads } = setupHandle();
    const order: string[] = [];
    demandHeavyDocRead.mockImplementation(() => order.push('demand'));
    reads.getCatalog.mockImplementation(() => {
      order.push('read');
      return catalogResult();
    });
    expect(handle.getCatalog({ view: 'quickGallery' })?.revision).toBe('rev-1');
    expect(demandHeavyDocRead).toHaveBeenCalledWith(styleCatalogReadKey({ view: 'quickGallery' }));
    expect(order).toEqual(['demand', 'read']);
  });

  it('demands current catalog and paragraph facts before resolving a style mutation', async () => {
    const { handle, demandHeavyDocRead, reads, apply } = setupHandle();
    const demanded = new Set<string>();
    demandHeavyDocRead.mockImplementation((key: string) => demanded.add(key));
    reads.readNodeById.mockImplementation(() => ({
      value: demanded.has('node:story:body:P1')
        ? { node: { kind: 'paragraph', paragraph: { styleRef: 'Heading1' } } }
        : null,
      status: demanded.has('node:story:body:P1') ? 'ready' : 'pending',
    }));
    expect(await handle.updateToMatchSelection()).toEqual({ success: true });
    expect(demanded).toContain(styleCatalogReadKey({ includePreview: true }));
    expect(demanded).toContain('node:story:body:P1');
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('reads the active style from the selection current at call time', () => {
    const { handle, env, reads } = setupHandle();
    reads.readNodeById.mockImplementation((_doc, blockId) => ({
      value: { node: { kind: 'paragraph', paragraph: { styleRef: blockId === 'P2' ? 'Quote' : 'Heading1' } } },
      status: 'ready',
    }));
    expect(handle.getActiveParagraphStyle().styleId).toBe('Heading1');
    env.selection = selectionOf(['P2']);
    expect(handle.getActiveParagraphStyle().styleId).toBe('Quote');
  });

  it('serves the quick gallery from the published slice', () => {
    const { handle, env } = setupHandle();
    expect(handle.getQuickGallery()).toBe(env.slice.quickGallery);
  });

  it('refuses to update a style in viewing and suggesting modes', () => {
    expect(setupHandle({ mode: 'viewing' }).handle.updateToMatchSelection()).toMatchObject({
      success: false,
      failure: { code: 'DOCUMENT_READONLY' },
    });
    expect(setupHandle({ mode: 'suggesting' }).handle.updateToMatchSelection()).toMatchObject({
      success: false,
      failure: { code: 'PRECONDITION_FAILED' },
    });
  });

  it('applies the matched run formatting to the active style', async () => {
    const { handle, apply } = setupHandle();
    expect(await handle.updateToMatchSelection()).toEqual({ success: true });
    expect(apply).toHaveBeenCalledWith({
      target: { scope: 'style', styleId: 'Heading1', channel: 'run' },
      patch: { bold: true },
    });
  });

  it('refuses as stale when the controller is disposed before the selection read settles', async () => {
    const { handle, env, apply } = setupHandle();
    const receipt = handle.updateToMatchSelection();
    env.disposed = true;
    expect(await receipt).toMatchObject({ success: false, failure: { code: 'REVISION_MISMATCH' } });
    expect(apply).not.toHaveBeenCalled();
  });

  it('refuses when a style fact read failed for this content revision', async () => {
    const failed: AsyncReadEntry = {
      token: 'token-1',
      value: null,
      hasSettled: true,
      inflightToken: null,
      failedToken: 'token-1',
    };
    const { handle, apply } = setupHandle({ entries: { 'node:story:body:P1': failed } });
    expect(await handle.updateToMatchSelection()).toMatchObject({
      success: false,
      failure: { code: 'PRECONDITION_FAILED' },
    });
    expect(apply).not.toHaveBeenCalled();
  });

  it('rejects without applying when the format read returns no properties', async () => {
    const { handle, readSelection, apply } = setupHandle();
    readSelection.mockResolvedValue(null);
    await expect(handle.updateToMatchSelection()).rejects.toThrow(TypeError);
    readSelection.mockResolvedValue({ collapsed: false });
    await expect(handle.updateToMatchSelection()).rejects.toThrow(TypeError);
    readSelection.mockResolvedValue('no result');
    await expect(handle.updateToMatchSelection()).rejects.toThrow(TypeError);
    expect(apply).not.toHaveBeenCalled();
  });

  it('passes the format read result through without reading its members early', async () => {
    const { handle, readSelection, apply } = setupHandle();
    const effectiveReads: string[] = [];
    const effective = {
      get properties() {
        effectiveReads.push('properties');
        return { bold: { state: 'uniform', value: true } };
      },
    };
    readSelection.mockImplementation(async (input: { view: string }) =>
      input.view === 'effective' ? effective : { properties: { bold: { state: 'uniform', value: true } } },
    );
    expect(await handle.updateToMatchSelection()).toEqual({ success: true });
    expect(effectiveReads.length).toBeGreaterThan(0);
    const traps: string[] = [];
    readSelection.mockImplementation(
      async () =>
        new Proxy(
          {},
          {
            get: (_target, key) => (key === 'properties' ? { bold: { state: 'uniform', value: true } } : undefined),
            has: () => {
              traps.push('has');
              return false;
            },
          },
        ),
    );
    expect(await handle.updateToMatchSelection()).toEqual({ success: true });
    expect(traps).toEqual([]);
    expect(apply).toHaveBeenCalledWith({
      target: { scope: 'style', styleId: 'Heading1', channel: 'run' },
      patch: { bold: true },
    });
  });

  it('reads non-object format properties as no uniform values', async () => {
    const { handle, readSelection, apply } = setupHandle();
    readSelection.mockResolvedValue({ collapsed: false, properties: false });
    expect(await handle.updateToMatchSelection()).toMatchObject({ success: false, failure: { code: 'NO_OP' } });
    expect(apply).not.toHaveBeenCalled();
  });
});
