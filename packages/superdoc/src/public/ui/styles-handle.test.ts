import { describe, expect, it, vi } from 'vite-plus/test';
import { isObjectRecord } from '../../helpers/object-guards.js';
import type { AsyncReadEntry } from './async-read-cache.js';
import { createSuperDocUI } from './create-super-doc-ui.js';
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
    readAsync: <T>(_key: string, _token: string, run: () => unknown, normalize: (raw: unknown) => T | null) => ({
      value: normalize(run()),
      status: 'ready' as const,
    }),
    readNodeById,
  };
  return { reads: createStyleReads(deps), getCatalog, readNodeById, doc, stylesApi };
}

describe('style catalogue reads', () => {
  it('reads the full and quick-gallery views with previews, calling getCatalog on its owner', async () => {
    const { reads, getCatalog, doc } = setupReads({
      catalog: (input) =>
        isObjectRecord(input) && input.view === 'quickGallery'
          ? catalogResult({ view: 'quickGallery', items: [style('Heading1')] })
          : catalogResult(),
    });
    const { cache } = reads.catalog();
    expect(getCatalog.mock.contexts[0]).toBe(doc.styles);
    const recording = [
      'doc.styles.getCatalog calls:',
      ...getCatalog.mock.calls.map(([input]) => `  ${JSON.stringify(input)}`),
      '',
      'quickGallery:',
      ...(cache?.quickGallery ?? []).map((item) => `  ${item.id}: ${item.name}`),
      '',
      'byId:',
      ...[...(cache?.byId ?? [])].map(
        ([id, item]) => `  ${id}: ${item.name} (quickGallery ${item.visibility.quickGallery})`,
      ),
      '',
    ].join('\n');
    await expect(recording).toMatchFileSnapshot('./__snapshots__/styles-handle/catalog.txt');
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
    const { reads, getCatalog } = setupReads({ noDoc: true });
    expect(reads.readCatalog()).toEqual({ value: null, status: 'ready' });
    expect(getCatalog).not.toHaveBeenCalled();
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
    const { reads, getCatalog } = setupReads({ noEditor: true });
    const slice = reads.computeSlice(selectionOf(['P1']));
    expect(slice.ready).toBe(false);
    expect(slice).toBe(reads.computeSlice(selectionOf(['P1'])));
    expect(getCatalog).not.toHaveBeenCalled();
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
  it('serves each getCatalog view on its first call while the source is still loading', async () => {
    vi.useFakeTimers();
    try {
      const calls: unknown[] = [];
      const doc: LooseRecord = {
        styles: {
          getCatalog: (input: unknown) => {
            calls.push(input);
            const quickGallery = isObjectRecord(input) && input.view === 'quickGallery';
            return quickGallery
              ? catalogResult({ view: 'quickGallery', items: [style('Heading1')] })
              : catalogResult({ items: [style('Normal'), style('Heading1'), style('Quote', false)] });
          },
        },
      };
      const host = {
        getDocumentLoadingSnapshot: () => ({ sourceStage: 'source-loading' }),
        subscribeDocumentLoading: () => () => undefined,
      };
      const superdoc = {
        activeEditor: { doc, host },
        config: { documentMode: 'editing' },
        on: () => {},
        off: () => {},
      };
      const ui = createSuperDocUI({ superdoc });
      await vi.advanceTimersByTimeAsync(0);
      const lines = [`mount: ${calls.length} doc.styles.getCatalog calls`];
      for (const input of [undefined, { view: 'quickGallery' as const }, undefined]) {
        const before = calls.length;
        const catalog = ui.styles.getCatalog(input);
        const returned = catalog
          ? `view ${catalog.view}, items [${catalog.items.map((item) => item.id).join(', ')}]`
          : 'null';
        lines.push(
          `ui.styles.getCatalog(${JSON.stringify(input) ?? ''}) -> ${returned}; doc.styles.getCatalog calls [${calls
            .slice(before)
            .map((call) => `(${JSON.stringify(call) ?? ''})`)
            .join(', ')}]`,
        );
      }
      ui.destroy();
      await expect(`${lines.join('\n')}\n`).toMatchFileSnapshot(
        './__snapshots__/styles-handle/get-catalog-while-loading.txt',
      );
    } finally {
      vi.useRealTimers();
    }
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

  it.each([
    {
      scenario: 'direct-formatting',
      input: undefined,
      direct: 'set',
    },
    {
      scenario: 'inherited-from-the-style',
      input: undefined,
      direct: 'unset',
    },
    {
      scenario: 'named-style-input',
      input: { styleId: 'Quote' },
      direct: 'unset',
    },
  ] as const)('applies the matched run formatting to the style: $scenario', async ({ scenario, input, direct }) => {
    const { handle, apply, readSelection } = setupHandle();
    const effective = {
      bold: { state: 'uniform', value: true },
      italic: { state: 'uniform', value: false },
      underline: { state: 'uniform', value: { style: 'double', color: '00FF00' } },
      color: { state: 'uniform', value: '#C00000' },
      fontSize: { state: 'uniform', value: 13.5 },
      rFonts: { state: 'uniform', value: { ascii: 'Cambria', hAnsi: 'Cambria', eastAsia: '' } },
      rStyle: { state: 'unset' },
    };
    const directProperties = Object.fromEntries(
      Object.keys(effective).map((key) => [key, { state: key === 'rStyle' ? 'unset' : direct }]),
    );
    readSelection.mockImplementation(async (read: { view: string }) => ({
      collapsed: false,
      properties: read.view === 'effective' ? effective : directProperties,
    }));
    const receipt = await handle.updateToMatchSelection(input);
    const recording = [
      `input: ${JSON.stringify(input ?? null)}`,
      `active paragraph style: Heading1`,
      `direct formatting state: ${direct}`,
      '',
      'doc.format.readSelection calls:',
      ...readSelection.mock.calls.map(([read]) => `  ${JSON.stringify(read)}`),
      '',
      'doc.styles.apply calls:',
      ...apply.mock.calls.map((call: unknown[]) => `  ${JSON.stringify(call[0], null, 2).replace(/\n/g, '\n  ')}`),
      '',
      `receipt: ${JSON.stringify(receipt)}`,
      '',
    ].join('\n');
    await expect(recording).toMatchFileSnapshot(`./__snapshots__/styles-handle/update-to-match-${scenario}.txt`);
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
    readSelection.mockImplementation(
      async () =>
        new Proxy(
          {},
          {
            get: (_target, key) => (key === 'properties' ? { bold: { state: 'uniform', value: true } } : undefined),
            has: () => false,
          },
        ),
    );
    expect(await handle.updateToMatchSelection()).toEqual({ success: true });
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
