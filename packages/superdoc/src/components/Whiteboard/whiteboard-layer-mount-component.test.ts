import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { EventEmitter } from 'eventemitter3';
import { PDF } from '@superdoc/common';
import { useSuperdocStore } from '../../stores/superdoc-store.js';
import { normalizeUiConfig } from '../../core/config/normalize-ui-config.js';
import { Whiteboard } from '../../core/whiteboard/Whiteboard';
import SuperDoc from '../../SuperDoc.vue';

vi.mock('../PdfViewer/PdfViewer.vue', () => ({ default: { name: 'PdfViewer', template: '<div />' } }));

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

async function mountPdfShell(whiteboard: Whiteboard | null) {
  const pinia = createPinia();
  const store = useSuperdocStore(pinia);
  store.documents = [{ id: 'pdf-a', type: PDF, data: new Uint8Array(), editorMountNonce: 0 }];
  const config = { modules: { whiteboard: { enabled: true } }, documentMode: 'editing' };
  Object.assign(store.modules, config.modules);
  const superdoc = Object.assign(new EventEmitter(), {
    config,
    uiConfig: normalizeUiConfig(config),
    user: { name: 'Fixture author' },
    users: [],
    colors: [],
    whiteboard,
  });
  const wrapper = mount(SuperDoc, {
    global: {
      plugins: [pinia],
      config: { globalProperties: { $superdoc: superdoc } },
      stubs: { SurfaceHost: true, PdfViewer: true, WhiteboardLayer: true },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

describe('SuperDoc whiteboard layer', () => {
  it('renders the whiteboard layer for a PDF with the whiteboard module enabled', async () => {
    const wrapper = await mountPdfShell(new Whiteboard({ enabled: true }));
    expect(wrapper.find('.superdoc__whiteboard-layer').exists()).toBe(true);
  });

  it('does not render the whiteboard layer when SuperDoc has no whiteboard', async () => {
    const wrapper = await mountPdfShell(null);
    expect(wrapper.find('.superdoc__whiteboard-layer').exists()).toBe(false);
  });
});
