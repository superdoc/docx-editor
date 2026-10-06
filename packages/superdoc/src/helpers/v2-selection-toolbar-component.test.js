import { afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { defineComponent, h, nextTick } from 'vue';
import { EventEmitter } from 'eventemitter3';
import { DOCX } from '@superdoc/common';
import { useSuperdocStore } from '../stores/superdoc-store.js';
import { normalizeUiConfig } from '../core/config/normalize-ui-config.js';
import { loadDefaultV2Integration } from '../core/v2-integration/v2-integration.js';
import SuperDoc from '../SuperDoc.vue';

vi.mock('../core/v2-integration/v2-integration.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveV2Integration: () => ({
      ...actual.resolveV2Integration(),
      EditorComponent: defineComponent({
        name: 'V2SelectionToolbarFixture',
        emits: ['v2-render', 'v2-selection-changed'],
        setup: () => () => h('div'),
      }),
    }),
  };
});

beforeAll(() => loadDefaultV2Integration(), 30_000);

const mounted = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  vi.unstubAllGlobals();
});

async function mountShell() {
  const frames = new Map();
  let frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id) => frames.delete(id));

  const pinia = createPinia();
  const store = useSuperdocStore(pinia);
  store.documents = [{ id: 'doc-a', type: DOCX, data: new Uint8Array(), editorMountNonce: 0 }];
  const config = { modules: { comments: {} }, ui: { comments: {} }, documentMode: 'editing' };
  const uiConfig = normalizeUiConfig(config);
  Object.assign(store.modules, config.modules);
  const superdoc = Object.assign(new EventEmitter(), {
    config,
    uiConfig,
    activeEditor: { editorVersion: 2, documentId: 'doc-a', options: { documentId: 'doc-a' } },
    user: { name: 'Fixture author' },
    users: [],
    colors: [],
    broadcastSidebarToggle() {},
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
  superdoc.emit('active-editor-change');
  await nextTick();

  const layers = wrapper.find('.superdoc__layers').element;
  layers.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
  const anchor = document.createElement('span');
  anchor.dataset.layoutFragmentId = 'checkbox-fragment';
  anchor.getBoundingClientRect = () => new DOMRect(100, 200, 24, 24);
  const mountContainer = document.createElement('div');
  mountContainer.append(anchor);
  const editor = wrapper.findComponent({ name: 'V2SelectionToolbarFixture' });

  const flushFrames = async () => {
    for (const [id, callback] of [...frames]) {
      frames.delete(id);
      callback(0);
    }
    await nextTick();
    await flushPromises();
  };
  const syncSelection = async (hasRangeSelection) => {
    editor.vm.$emit('v2-selection-changed', {
      hasRangeSelection,
      snapshot: hasRangeSelection
        ? {
            anchor: { fragmentId: 'checkbox-fragment', blockOffset: 0 },
            focus: { fragmentId: 'checkbox-fragment', blockOffset: 1 },
          }
        : null,
    });
    await flushFrames();
  };

  editor.vm.$emit('v2-render', { epoch: 1, mountContainer });
  await flushFrames();
  return { anchor, store, syncSelection, wrapper };
}

describe('V2 floating comment action selection continuity', () => {
  it('keeps the comment action mounted through a checkbox repaint with no painted geometry, then clears it when the host range ends', async () => {
    const { anchor, store, syncSelection, wrapper } = await mountShell();

    await syncSelection(true);
    expect(store.activeSelection).toMatchObject({
      documentId: 'doc-a',
      source: 'document-editor',
    });
    expect(wrapper.find('.superdoc__tools .tools-item[data-id="is-tool"]').exists()).toBe(true);

    anchor.remove();
    await syncSelection(true);
    expect(store.activeSelection).toMatchObject({
      documentId: 'doc-a',
      source: 'document-editor',
    });
    expect(wrapper.find('.superdoc__tools .tools-item[data-id="is-tool"]').exists()).toBe(true);

    await syncSelection(false);
    expect(store.activeSelection).toBeNull();
    expect(wrapper.find('.superdoc__tools .tools-item[data-id="is-tool"]').exists()).toBe(false);
  });
});
