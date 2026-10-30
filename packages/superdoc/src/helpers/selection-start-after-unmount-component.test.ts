import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { defineComponent, h } from 'vue';
import { EventEmitter } from 'eventemitter3';
import { DOCX } from '@superdoc/common';
import { useSuperdocStore } from '../stores/superdoc-store.js';
import { normalizeUiConfig } from '../core/config/normalize-ui-config.js';
import SuperDoc from '../SuperDoc.vue';

vi.mock('@superdoc/v2-browser-shell/vue', () => ({
  V2SuperEditor: defineComponent({ setup: () => () => h('div') }),
  V2Ruler: defineComponent({ setup: () => () => h('div') }),
}));

vi.mock('../core/v2-integration/v2-integration.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/v2-integration/v2-integration.js')>();
  const { createSuperDocV2Integration } = await import('@superdoc/v2-browser-shell/superdoc');
  return {
    ...actual,
    createDefaultV2Integration: () => ({
      ...createSuperDocV2Integration(),
      EditorComponent: defineComponent({ setup: () => () => h('div') }),
    }),
  };
});

const unhandled: unknown[] = [];
const recordUnhandled = (reason: unknown) => unhandled.push(reason);

afterEach(() => {
  process.off('unhandledRejection', recordUnhandled);
  unhandled.splice(0);
});

async function mountShell(errorHandler: (error: unknown) => void) {
  const pinia = createPinia();
  const store = useSuperdocStore(pinia);
  store.documents = [{ id: 'doc-a', type: DOCX, data: new Uint8Array(), editorMountNonce: 0 }];
  const config = { modules: { comments: {} }, documentMode: 'editing' };
  Object.assign(store.modules, config.modules);
  const superdoc = Object.assign(new EventEmitter(), {
    config,
    uiConfig: normalizeUiConfig(config),
    activeEditor: { editorVersion: 2, documentId: 'doc-a' },
    user: { name: 'Fixture author' },
    users: [],
    colors: [],
    broadcastSidebarToggle() {},
  });
  const wrapper = mount(SuperDoc, {
    global: {
      plugins: [pinia],
      config: { globalProperties: { $superdoc: superdoc }, errorHandler },
      stubs: { SurfaceHost: true, FloatingComments: true, CommentDialog: true },
    },
  });
  await flushPromises();
  return wrapper;
}

describe('selection start after unmount', () => {
  it('does not throw when SuperDoc is unmounted before the selection tick runs', async () => {
    process.on('unhandledRejection', recordUnhandled);
    const errorHandler = vi.fn();
    const wrapper = await mountShell(errorHandler);
    const layer = wrapper.find('.superdoc__selection-layer');
    expect(layer.exists()).toBe(true);

    void layer.trigger('mousedown', { clientX: 10, clientY: 10 });
    wrapper.unmount();
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(unhandled).toEqual([]);
    expect(errorHandler).not.toHaveBeenCalled();
  });

  it('starts a drag selection over a PDF page while SuperDoc stays mounted', async () => {
    const page = document.createElement('div');
    page.dataset.pdfPage = '';
    page.dataset.pageNumber = '1';
    const originalElementsFromPoint = document.elementsFromPoint;
    document.elementsFromPoint = () => [page];
    const errorHandler = vi.fn();
    const wrapper = await mountShell(errorHandler);
    const layer = wrapper.find('.superdoc__selection-layer');

    try {
      await layer.trigger('mousedown', { clientX: 10, clientY: 10 });
      await flushPromises();
      layer.element.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 70 }));
      await flushPromises();

      expect((layer.element as HTMLElement).style.pointerEvents).toBe('auto');
      const selection = wrapper.find('.superdoc__temp-selection');
      expect(selection.exists()).toBe(true);
      expect((selection.element as HTMLElement).style.width).toBe('50px');
      expect((selection.element as HTMLElement).style.height).toBe('60px');
      expect(errorHandler).not.toHaveBeenCalled();
    } finally {
      wrapper.unmount();
      document.elementsFromPoint = originalElementsFromPoint;
    }
  });
});
