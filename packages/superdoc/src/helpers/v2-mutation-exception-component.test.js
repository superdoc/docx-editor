import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { defineComponent, h, nextTick } from 'vue';
import { EventEmitter } from 'eventemitter3';
import { DOCX } from '@superdoc/common';
import { useSuperdocStore } from '../stores/superdoc-store.js';
import { normalizeUiConfig } from '../core/config/normalize-ui-config.js';
import SuperDoc from '../SuperDoc.vue';
import { createInteractionHistory, closeInteractionHistory } from '../internal/diagnostics/interaction-history.js';

vi.mock('../core/v2-integration/v2-integration.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createDefaultV2Integration: () => ({
      ...actual.createStubV2Integration(),
      EditorComponent: defineComponent({
        name: 'EditableInputFixture',
        emits: ['v2-host-event', 'v2-editor-failed'],
        setup: () => () => h('div'),
      }),
    }),
  };
});

const mounted = [];
afterEach(() => {
  for (const { wrapper, superdoc } of mounted.splice(0)) {
    wrapper.unmount();
    closeInteractionHistory(superdoc);
  }
});

async function mountShell(history = { enabled: false }) {
  const pinia = createPinia();
  const store = useSuperdocStore(pinia);
  store.documents = [{ id: 'doc-a', type: DOCX, data: new Uint8Array(), editorMountNonce: 0 }];
  const config = {
    modules: { comments: false },
    ui: { comments: false },
    documentMode: 'editing',
    diagnostics: { history },
  };
  const superdoc = Object.assign(new EventEmitter(), {
    config,
    uiConfig: normalizeUiConfig(config),
    activeEditor: { editorVersion: 2, documentId: 'doc-a' },
    setActiveEditor: vi.fn(),
    user: { name: 'Fixture author' },
    users: [],
    colors: [],
  });
  const diagnostics = createInteractionHistory(superdoc, config, () => 'test', document.createElement('div'));
  const onEditorUpdate = vi.fn();
  superdoc.on('editor-update', onEditorUpdate);
  const onException = vi.fn();
  superdoc.on('exception', onException);
  const wrapper = mount(SuperDoc, {
    global: {
      plugins: [pinia],
      config: { globalProperties: { $superdoc: superdoc } },
      stubs: { SurfaceHost: true, FloatingComments: true, CommentDialog: true },
    },
  });
  mounted.push({ wrapper, superdoc });
  await flushPromises();
  superdoc.emit('active-editor-change');
  await nextTick();
  const editor = wrapper.findComponent({ name: 'EditableInputFixture' });
  expect(editor.exists()).toBe(true);
  return { wrapper, editor, onException, onEditorUpdate, diagnostics, superdoc, store };
}

const authorRejection = () => ({
  type: 'mutation:rejected',
  origin: 'document-surface',
  failureSource: 'receipt',
  reason: 'PRECONDITION_FAILED',
  failure: { code: 'PRECONDITION_FAILED', message: 'no-author-configured' },
  inputKind: 'keydown',
  editableCommandKind: 'delete-backward',
});

describe('SuperDoc collaboration configuration failures', () => {
  it.each([
    ['collaboration-session-invalidated', true, true],
    ['collaboration-session-invalidated', true, false],
    ['open-failed', false, true],
  ])('keeps guarded export ownership: %s / retained=%s / active=%s', async (reason, retainsExporter, isActive) => {
    const { editor, superdoc, store } = await mountShell();
    const failure = Object.assign(new Error('reopen the shared document with join'), {
      code: 'COLLAB_V2_SESSION_INVALIDATED',
    });
    const retiredEditor = { editorVersion: 2, documentId: 'doc-a', exportDocx: vi.fn().mockRejectedValue(failure) };
    let exporter = retiredEditor;
    const document = store.documents[0];
    document.isReady = true;
    document.getEditor = () => exporter;
    document.setEditor = (next) => {
      exporter = next;
    };
    const healthyEditor = { editorVersion: 2, documentId: 'doc-b' };
    const healthyDocument = {
      id: 'doc-b',
      type: DOCX,
      data: new Uint8Array(),
      isReady: true,
      getEditor: () => healthyEditor,
    };
    store.documents.push(healthyDocument);
    superdoc.activeEditor = isActive ? retiredEditor : healthyEditor;
    editor.vm.$emit('v2-editor-failed', { documentId: 'doc-a', reason, detail: failure.message });
    await nextTick();
    expect(document.isReady).toBe(false);
    if (isActive) expect(superdoc.setActiveEditor).toHaveBeenCalledWith(null);
    else {
      expect(superdoc.setActiveEditor).not.toHaveBeenCalled();
      expect(superdoc.activeEditor).toBe(healthyEditor);
      expect(healthyDocument.isReady).toBe(true);
      expect(healthyDocument.getEditor()).toBe(healthyEditor);
    }
    if (retainsExporter) {
      expect(document.getEditor()).toBe(retiredEditor);
      await expect(document.getEditor().exportDocx()).rejects.toBe(failure);
    } else expect(document.getEditor()).toBeNull();
  });

  it('reports a retired collaboration session as an actionable condition', async () => {
    const { editor, onException } = await mountShell();
    editor.vm.$emit('v2-editor-failed', {
      documentId: 'doc-a',
      reason: 'collaboration-session-invalidated',
      detail: 'shared document content is no longer current in this editor; reopen the shared document with join',
    });
    await nextTick();
    expect(onException).toHaveBeenCalledOnce();
    expect(onException.mock.calls[0][0]).toMatchObject({
      code: 'collaboration-session-invalidated',
      error: expect.objectContaining({ message: expect.stringMatching(/reopen.*join/) }),
    });
  });

  it('forwards actionable retry validation detail to the host', async () => {
    const { editor, onException } = await mountShell();
    editor.vm.$emit('v2-editor-failed', {
      documentId: 'doc-a',
      reason: 'collaboration-config-invalid',
      detail: 'retry.maxDelay is not a supported setting',
    });
    await nextTick();
    expect(onException).toHaveBeenCalledOnce();
    expect(onException.mock.calls[0][0]).toMatchObject({
      code: 'collaboration-config-invalid',
      error: expect.objectContaining({ message: expect.stringContaining('retry.maxDelay is not a supported setting') }),
    });
  });
});

describe('SuperDoc mutation exceptions', () => {
  it('reports an author-required rejection without adding a visible or live announcement', async () => {
    const { wrapper, editor, onException } = await mountShell();
    editor.vm.$emit('v2-host-event', authorRejection());
    await nextTick();

    expect(onException).toHaveBeenCalledTimes(1);
    expect(onException.mock.calls[0][0]).toMatchObject({
      code: 'author-required',
      documentId: 'doc-a',
      editor: null,
      error: expect.any(Error),
    });
    expect(wrapper.find('[data-superdoc-v2-author-required]').exists()).toBe(false);
    expect(wrapper.find('[data-superdoc-v2-edit-rejected]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('This edit needs an author identity');
  });

  it('reports independent author-required attempts once each and keeps their distinct code', async () => {
    const { editor, onException } = await mountShell();
    const first = authorRejection();
    editor.vm.$emit('v2-host-event', first);
    editor.vm.$emit('v2-host-event', first);
    editor.vm.$emit('v2-host-event', authorRejection());
    await nextTick();

    expect(onException).toHaveBeenCalledTimes(2);
    expect(onException.mock.calls.map(([exception]) => exception.code)).toEqual(['author-required', 'author-required']);
  });

  it('preserves safe author-required diagnostics without forwarding arbitrary receipt details', async () => {
    const { editor, onException } = await mountShell();
    const event = authorRejection();
    event.failure.details = { xml: '<w:t>private document text</w:t>' };
    editor.vm.$emit('v2-host-event', event);
    await nextTick();

    expect(onException).toHaveBeenCalledTimes(1);
    const exception = onException.mock.calls[0][0];
    expect.soft(exception.error.cause).toEqual({
      failureSource: 'receipt',
      reason: 'PRECONDITION_FAILED',
      inputKind: 'keydown',
      editableCommandKind: 'delete-backward',
    });
    expect.soft(JSON.stringify(exception)).not.toContain('private document text');
  });

  it('reports a later non-author failure independently of an earlier author requirement', async () => {
    const { editor, onException } = await mountShell();
    editor.vm.$emit('v2-host-event', authorRejection());
    editor.vm.$emit('v2-host-event', {
      type: 'mutation:rejected',
      origin: 'document-surface',
      failureSource: 'shell',
      reason: 'input-target-unsupported',
      inputKind: 'keydown',
      editableCommandKind: 'delete-forward',
    });
    await nextTick();

    expect(onException.mock.calls.map(([exception]) => exception.code)).toEqual(['author-required', 'edit-rejected']);
  });

  it('routes one author-required attempt to its specific exception code without a generic duplicate', async () => {
    const { editor, onException } = await mountShell();
    const event = authorRejection();
    editor.vm.$emit('v2-host-event', event);
    editor.vm.$emit('v2-host-event', event);
    await nextTick();

    expect(onException).toHaveBeenCalledTimes(1);
    expect(onException.mock.calls[0][0].code).toBe('author-required');
  });
});

describe('SuperDoc interaction history remains passive', () => {
  it.each([true, false])(
    'observes extension previews without editor-update callbacks when enabled=%s',
    async (enabled) => {
      const { editor, onEditorUpdate, diagnostics, superdoc } = await mountShell({ enabled });
      diagnostics.clear();
      onEditorUpdate.mockClear();
      for (const dryRun of [true, false]) {
        editor.vm.$emit('v2-host-event', {
          type: 'mutation:committed',
          origin: 'extension',
          ...(dryRun ? { dryRun: true } : {}),
          receipt: { success: true, dryRun, txId: 'extension-receipt' },
        });
      }
      await nextTick();
      expect(onEditorUpdate).toHaveBeenCalledTimes(1);
      expect(diagnostics.getSnapshot().events).toHaveLength(enabled ? 2 : 0);
      closeInteractionHistory(superdoc);
    },
  );
});
