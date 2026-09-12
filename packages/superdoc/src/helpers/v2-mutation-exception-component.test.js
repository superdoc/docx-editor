import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { defineComponent, h, nextTick } from 'vue';
import { EventEmitter } from 'eventemitter3';
import { DOCX } from '@superdoc/common';
import { useSuperdocStore } from '../stores/superdoc-store.js';
import { normalizeUiConfig } from '../core/config/normalize-ui-config.js';
import SuperDoc from '../SuperDoc.vue';

vi.mock('../core/v2-integration/v2-integration.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveV2Integration: () => ({
      ...actual.createStubV2Integration(),
      EditorComponent: defineComponent({
        name: 'EditableInputFixture',
        emits: ['v2-host-event'],
        setup: () => () => h('div'),
      }),
    }),
  };
});

const mounted = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

async function mountShell() {
  const pinia = createPinia();
  const store = useSuperdocStore(pinia);
  store.documents = [{ id: 'doc-a', type: DOCX, data: new Uint8Array(), editorMountNonce: 0 }];
  const config = { modules: { comments: false }, ui: { comments: false }, documentMode: 'editing' };
  const superdoc = Object.assign(new EventEmitter(), {
    config,
    uiConfig: normalizeUiConfig(config),
    activeEditor: { editorVersion: 2, documentId: 'doc-a' },
    user: { name: 'Fixture author' },
    users: [],
    colors: [],
  });
  const onException = vi.fn();
  superdoc.on('exception', onException);
  const wrapper = mount(SuperDoc, {
    global: {
      plugins: [pinia],
      config: { globalProperties: { $superdoc: superdoc } },
      stubs: { SurfaceHost: true, FloatingComments: true, CommentDialog: true },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  superdoc.emit('active-editor-change');
  await nextTick();
  const editor = wrapper.findComponent({ name: 'EditableInputFixture' });
  expect(editor.exists()).toBe(true);
  return { wrapper, editor, onException };
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
