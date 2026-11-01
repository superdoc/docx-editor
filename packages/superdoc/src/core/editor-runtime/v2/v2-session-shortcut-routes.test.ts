/**
 * @vitest-environment jsdom
 */
/**
 * v2-keyboard-005 — Durable session/reference shortcut route tests.
 *
 * Proves the public-layer routes are wired honestly: toolbar focus reaches the
 * shell chrome, reference workflows route through the public Document API facade
 * when the capability is present, and every route fails closed with a named
 * reason when the seam is absent. (Field durability through export/reopen is
 * proven separately by the Labs reference-workflow rows, not here.)
 */
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { createV2SessionShortcutRoutes } from './v2-session-shortcut-routes.js';

afterEach(() => {
  document.body.innerHTML = '';
});

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('createV2SessionShortcutRoutes — toolbar focus', () => {
  it('focuses the inner .superdoc-toolbar element and makes it focusable', () => {
    const container = document.createElement('div');
    const toolbar = document.createElement('div');
    toolbar.className = 'superdoc-toolbar';
    container.appendChild(toolbar);
    document.body.appendChild(container);

    const routes = createV2SessionShortcutRoutes({
      resolveToolbarElement: () => container,
      getDocumentApi: () => null,
    });
    const result = routes.focusToolbar?.();
    expect(result).toBe(true);
    expect(toolbar.getAttribute('tabindex')).toBe('0');
    expect(document.activeElement).toBe(toolbar);
  });

  it('fails closed when no toolbar element is resolved', () => {
    const routes = createV2SessionShortcutRoutes({
      resolveToolbarElement: () => null,
      getDocumentApi: () => null,
    });
    expect(routes.focusToolbar?.()).toEqual({ handled: false, reason: 'no-toolbar' });
  });

  it('does not expose header/footer or session-exit routes (no public seam)', () => {
    const routes = createV2SessionShortcutRoutes({
      resolveToolbarElement: () => null,
      getDocumentApi: () => null,
    });
    expect(routes.focusHeaderFooter).toBeUndefined();
    expect(routes.exitSession).toBeUndefined();
  });
});

describe('createV2SessionShortcutRoutes — field update (F9)', () => {
  it('routes through toc/fields/index list+rebuild when the facade supports it', async () => {
    const toc = { list: vi.fn(() => ({ items: [{ target: 'toc:1' }] })), update: vi.fn(() => ({ ok: true })) };
    const fields = { list: vi.fn(() => [{ target: 'field:1' }]), rebuild: vi.fn(() => ({ ok: true })) };
    const index = { list: vi.fn(() => ({ items: [] })), rebuild: vi.fn(() => ({ ok: true })) };
    const routes = createV2SessionShortcutRoutes({
      resolveToolbarElement: () => null,
      getDocumentApi: () => ({ toc, fields, index }),
    });
    expect(routes.updateFields?.()).toBe(true);
    await flush();
    expect(toc.list).toHaveBeenCalled();
    expect(toc.update).toHaveBeenCalledWith({ target: 'toc:1' });
    expect(fields.rebuild).toHaveBeenCalledWith({ target: 'field:1' });
    expect(index.rebuild).not.toHaveBeenCalled(); // empty list
  });

  it('updates via the durable address, not the ephemeral handle (SD-3735 F9)', async () => {
    // `toc.list().items` carry both an ephemeral `handle` and a durable
    // `address`; only the address resolves in `toc.update`, so F9 must target it.
    const address = { kind: 'block', nodeType: 'tableOfContents', nodeId: '1EF55A5A' };
    const toc = {
      list: vi.fn(() => ({ items: [{ id: '1EF55A5A', handle: { ref: 'toc:1EF55A5A' }, address }] })),
      update: vi.fn(() => ({ success: true })),
    };
    const routes = createV2SessionShortcutRoutes({
      resolveToolbarElement: () => null,
      getDocumentApi: () => ({ toc }),
    });
    expect(routes.updateFields?.()).toBe(true);
    await flush();
    expect(toc.update).toHaveBeenCalledWith({ target: address });
  });

  it('fails closed when the facade exposes no field-update capability', () => {
    const routes = createV2SessionShortcutRoutes({
      resolveToolbarElement: () => null,
      getDocumentApi: () => ({}),
    });
    expect(routes.updateFields?.()).toEqual({ handled: false, reason: 'field-update-workflow-unavailable' });
  });

  it('fails closed when the document API is unavailable', () => {
    const routes = createV2SessionShortcutRoutes({
      resolveToolbarElement: () => null,
      getDocumentApi: () => null,
    });
    expect(routes.updateFields?.()).toEqual({ handled: false, reason: 'document-api-unavailable' });
  });
});

describe('createV2SessionShortcutRoutes — page-field insert', () => {
  const footerTarget = {
    kind: 'text',
    story: {
      kind: 'story',
      storyType: 'headerFooterSlot',
      section: { kind: 'section', index: 0 },
      headerFooterKind: 'footer',
      variant: 'default',
    },
    segments: [{ blockId: 'footer-p1', range: { start: 5, end: 5 } }],
  };

  it('inserts PAGE and NUMPAGES through the documented raw fields.insert payload in header/footer context', async () => {
    const insert = vi.fn(() => ({ ok: true }));
    const current = vi.fn(() => ({ empty: true, target: footerTarget }));
    const routes = createV2SessionShortcutRoutes({
      resolveToolbarElement: () => null,
      getDocumentApi: () => ({ selection: { current }, fields: { insert } }),
    });
    expect(routes.insertPageField?.('page')).toBe(true);
    expect(routes.insertPageField?.('numpages')).toBe(true);
    await flush();
    expect(current).toHaveBeenCalledWith({ includeText: false });
    expect(insert).toHaveBeenNthCalledWith(1, { at: footerTarget, instruction: 'PAGE', mode: 'raw' });
    expect(insert).toHaveBeenNthCalledWith(2, { at: footerTarget, instruction: 'NUMPAGES', mode: 'raw' });
  });

  it('fails closed when fields.insert is not exposed', () => {
    const routes = createV2SessionShortcutRoutes({
      resolveToolbarElement: () => null,
      getDocumentApi: () => ({ fields: {} }),
    });
    expect(routes.insertPageField?.('page')).toEqual({ handled: false, reason: 'page-field-insert-unavailable' });
  });

  it('fails closed outside a header/footer insertion context', () => {
    const insert = vi.fn(() => ({ ok: true }));
    const routes = createV2SessionShortcutRoutes({
      resolveToolbarElement: () => null,
      getDocumentApi: () => ({
        selection: {
          current: () => ({
            empty: true,
            target: { kind: 'text', segments: [{ blockId: 'body-p1', range: { start: 0, end: 0 } }] },
          }),
        },
        fields: { insert },
      }),
    });
    expect(routes.insertPageField?.('page')).toEqual({
      handled: false,
      reason: 'page-field-context-unavailable',
    });
    expect(insert).not.toHaveBeenCalled();
  });
});

describe('createV2SessionShortcutRoutes — PAGE through the built-in page-number command', () => {
  function asyncSelectionDoc(insert: (input: unknown) => unknown) {
    // The worker-backed facade answers selection reads asynchronously.
    const footerTarget = {
      kind: 'text',
      story: { kind: 'story', storyType: 'headerFooterPart', refId: 'rId7' },
      segments: [{ blockId: 'footer-p1', range: { start: 0, end: 0 } }],
    };
    return { selection: { current: () => Promise.resolve({ empty: true, target: footerTarget }) }, fields: { insert } };
  }

  it('runs the command instead of reading the selection synchronously', async () => {
    const insert = vi.fn();
    const execute = vi.fn(async () => ({ success: true }));
    const routes = createV2SessionShortcutRoutes({
      resolveToolbarElement: () => null,
      getDocumentApi: () => asyncSelectionDoc(insert),
      pageNumberCommand: { isEnabled: () => true, execute },
    });
    expect(routes.insertPageField?.('page')).toBe(true);
    await flush();
    expect(execute).toHaveBeenCalledOnce();
    expect(insert).not.toHaveBeenCalled();
  });

  it('is not handled when the command is unavailable at the current selection', () => {
    const execute = vi.fn(async () => ({ success: true }));
    const routes = createV2SessionShortcutRoutes({
      resolveToolbarElement: () => null,
      getDocumentApi: () => asyncSelectionDoc(vi.fn()),
      pageNumberCommand: { isEnabled: () => false, execute },
    });
    expect(routes.insertPageField?.('page')).toEqual({ handled: false, reason: 'page-field-context-unavailable' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('keeps NUMPAGES on the Document API route', () => {
    const execute = vi.fn(async () => ({ success: true }));
    const routes = createV2SessionShortcutRoutes({
      resolveToolbarElement: () => null,
      getDocumentApi: () => asyncSelectionDoc(vi.fn()),
      pageNumberCommand: { isEnabled: () => true, execute },
    });
    expect(routes.insertPageField?.('numpages')).toEqual({ handled: false, reason: 'page-field-selection-async' });
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('F9 first-party mutation handoff', () => {
  it('dispatches each mutation through the trusted route only after its asynchronous list resolves', async () => {
    let resolveFields!: (items: unknown) => void;
    const fields = {
      list: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveFields = resolve;
          }),
      ),
      rebuild: vi.fn(),
    };
    const toc = { list: vi.fn(async () => ({ items: [{ address: 'toc:1' }] })), update: vi.fn() };
    const index = { list: vi.fn(async () => ({ items: [{ address: 'index:1' }] })), rebuild: vi.fn() };
    const runReferenceMutation = vi.fn(async () => ({ success: true }));
    const routes = createV2SessionShortcutRoutes({
      resolveToolbarElement: () => null,
      getDocumentApi: () => ({ fields, toc, index }),
      runReferenceMutation,
    });
    expect(routes.updateFields?.()).toBe(true);
    await flush();
    expect(runReferenceMutation).not.toHaveBeenCalledWith('fields.rebuild', expect.anything());
    resolveFields({ items: [{ address: 'field:1' }, { address: 'field:2' }] });
    await flush();
    expect(runReferenceMutation.mock.calls).toEqual(
      expect.arrayContaining([
        ['toc.update', { target: 'toc:1' }],
        ['index.rebuild', { target: 'index:1' }],
        ['fields.rebuild', { target: 'field:1' }],
        ['fields.rebuild', { target: 'field:2' }],
      ]),
    );
    expect(runReferenceMutation).toHaveBeenCalledTimes(4);
    expect(fields.rebuild).not.toHaveBeenCalled();
    expect(toc.update).not.toHaveBeenCalled();
    expect(index.rebuild).not.toHaveBeenCalled();
  });
});
