import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { defineComponent, h } from 'vue';
import { EventEmitter } from 'eventemitter3';
import { DOCX } from '@superdoc/common';
import { useSuperdocStore } from '../stores/superdoc-store.js';
import { normalizeUiConfig } from '../core/config/normalize-ui-config.js';
import SuperDoc from '../SuperDoc.vue';

vi.mock('../core/v2-integration/v2-integration.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createDefaultV2Integration: () => ({
      ...actual.createStubV2Integration(),
      EditorComponent: defineComponent({
        name: 'AuthoringSelectionFixture',
        emits: ['v2-editor-ready'],
        setup: () => () => h('div'),
      }),
    }),
  };
});

const mounted = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

async function authoringFixture(selectionTargets) {
  const pinia = createPinia(),
    store = useSuperdocStore(pinia);
  store.documents = [{ id: 'selection-doc', type: DOCX, data: new Uint8Array(), editorMountNonce: 0 }];
  const config = {
    documents: [{ id: 'selection-doc' }],
    modules: { comments: false },
    ui: { comments: false },
    documentMode: 'editing',
  };
  const runtimes = new Map();
  const superdoc = Object.assign(new EventEmitter(), {
    config,
    uiConfig: normalizeUiConfig(config),
    activeEditor: null,
    user: { name: 'Fixture author' },
    users: [],
    colors: [],
    setActiveEditor(editor) {
      this.activeEditor = editor;
    },
    broadcastEditorCreate() {},
    registerEditorRuntime(runtime) {
      runtimes.set(runtime.id, runtime);
    },
    setActiveRuntime(id) {
      this.activeEditor = runtimes.get(id).getLegacyEditorProjection();
    },
    unregisterEditorRuntime(id) {
      runtimes.delete(id);
    },
  });
  const wrapper = mount(SuperDoc, {
    global: {
      plugins: [pinia],
      config: { globalProperties: { $superdoc: superdoc } },
      stubs: { SurfaceHost: true, FloatingComments: true, CommentDialog: true },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  const focus = vi.fn(() => true);
  wrapper.findComponent({ name: 'AuthoringSelectionFixture' }).vm.$emit('v2-editor-ready', {
    documentId: 'selection-doc',
    host: {
      getHandles: () => ({ editing: { selectionTargets } }),
      getSnapshot: () => ({ state: 'editing-ready', documentMode: 'editing' }),
      subscribe: () => () => {},
      getPageMetricsSnapshot: () => ({ pages: [], zoom: { percent: 100 } }),
    },
    mount: { focus: { focus } },
  });
  await flushPromises();
  expect(superdoc.activeEditor?.authoring).toBeDefined();
  return { authoring: superdoc.activeEditor.authoring, focus };
}

const target = {
  kind: 'selection',
  start: { kind: 'text', blockId: '54150004', offset: 2 },
  end: { kind: 'text', blockId: '54150004', offset: 2 },
};

describe('public V2 authoring canonical selection completion', () => {
  it('waits for the worker selection completion before returning or focusing', async () => {
    let complete;
    const apply = vi.fn(() => ({ ok: true, mode: 'collapsed' }));
    const applyAndWait = vi.fn(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const fixture = await authoringFixture({ apply, applyAndWait });
    let returned = false;
    const pending = fixture.authoring.setSelectionTarget({ target }).then((result) => {
      returned = true;
      return result;
    });
    await flushPromises();
    expect(returned).toBe(false);
    expect(fixture.focus).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    complete({ ok: true, mode: 'collapsed' });
    expect(await pending).toEqual({ ok: true, mode: 'collapsed' });
    expect(fixture.focus).toHaveBeenCalledOnce();
  });

  it.each(['host-not-ready', 'block-not-found'])(
    'preserves an actual worker %s refusal without focusing',
    async (reason) => {
      const fixture = await authoringFixture({
        apply: vi.fn(() => ({ ok: true, mode: 'collapsed' })),
        applyAndWait: vi.fn(async () => ({ ok: false, reason })),
      });
      expect(await fixture.authoring.setSelectionTarget({ target })).toEqual({ ok: false, reason });
      expect(fixture.focus).not.toHaveBeenCalled();
    },
  );

  it('retains synchronous host compatibility and the explicit no-focus policy', async () => {
    const apply = vi.fn(() => ({ ok: true, mode: 'collapsed' }));
    const fixture = await authoringFixture({ apply });
    expect(await fixture.authoring.setSelectionTarget({ target, focus: false })).toEqual({
      ok: true,
      mode: 'collapsed',
    });
    expect(apply).toHaveBeenCalledExactlyOnceWith(target);
    expect(fixture.focus).not.toHaveBeenCalled();
  });
});
