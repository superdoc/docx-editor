import { afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { defineComponent, h, nextTick } from 'vue';
import { EventEmitter } from 'eventemitter3';
import { DOCX } from '@superdoc/common';
import { useSuperdocStore } from '../stores/superdoc-store.js';
import { useCommentsStore } from '../stores/comments-store.js';
import { normalizeUiConfig } from '../core/config/normalize-ui-config.js';
import { loadDefaultV2Integration, resolveV2Integration } from '../core/v2-integration/v2-integration.js';
import SuperDoc from '../SuperDoc.vue';

// The shell fixture replaces the editor; keep the real integration and bridge
// without evaluating the unused source editor runtime during engine loading.
vi.mock('@superdoc/v2-browser-shell/vue', () => ({
  V2SuperEditor: defineComponent({ setup: () => () => h('div') }),
  V2Ruler: defineComponent({ setup: () => () => h('div') }),
}));

vi.mock('../core/v2-integration/v2-integration.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveV2Integration: () => ({
      ...actual.resolveV2Integration(),
      EditorComponent: defineComponent({
        name: 'ReviewGeometryFixture',
        emits: ['v2-render'],
        setup: () => () => h('div'),
      }),
    }),
  };
});

beforeAll(async () => {
  await loadDefaultV2Integration();
  expect(resolveV2Integration().version).toBe(3);
}, 30_000);
const mounted = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  vi.unstubAllGlobals();
});

async function mountShell({ ui, comments = {}, mode = 'editing', visible = false } = {}) {
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
  const config = { modules: { comments }, ui, documentMode: mode };
  const uiConfig = normalizeUiConfig(config);
  config.modules.comments = uiConfig.comments.enabled ? comments || {} : false;
  Object.assign(store.modules, config.modules);
  const superdoc = Object.assign(new EventEmitter(), {
    config,
    uiConfig,
    activeEditor: { editorVersion: 2, documentId: 'doc-a' },
    user: { name: 'Fixture author' },
    users: [],
    colors: [],
    broadcastSidebarToggle() {},
  });
  const commentsStore = useCommentsStore(pinia);
  Object.assign(commentsStore.viewingVisibility, {
    documentMode: mode,
    commentsVisible: visible,
    trackChangesVisible: visible,
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
  const carrier = document.createElement('span');
  carrier.dataset.trackChangeId = 'change-1';
  carrier.dataset.storyKey = 'body';
  const rect = new DOMRect(100, 200, 60, 20);
  carrier.getBoundingClientRect = () => rect;
  const measure = vi.fn(() => [rect]);
  carrier.getClientRects = measure;
  const container = document.createElement('div');
  container.appendChild(carrier);
  const editor = wrapper.findComponent({ name: 'ReviewGeometryFixture' });
  const paint = async () => {
    editor.vm.$emit('v2-render', { epoch: 1, mountContainer: container });
    await nextTick();
    for (const [id, callback] of [...frames]) {
      frames.delete(id);
      callback(0);
    }
    await flushPromises();
  };
  return { paint, measure, commentsStore, carrier };
}

describe('review geometry presentation demand', () => {
  it.each([
    { ui: { comments: false }, mode: 'editing' },
    { ui: { comments: false }, mode: 'suggesting' },
    { ui: false, mode: 'editing' },
    { comments: false, mode: 'editing' },
    { ui: { comments: false }, mode: 'viewing', visible: true },
  ])('does not measure disabled review presentation: %j', async (config) => {
    const { paint, measure, commentsStore } = await mountShell(config);
    await paint();
    expect(measure).not.toHaveBeenCalled();
    expect(commentsStore.editorCommentPositions).toEqual({});
  });

  it.each(['editing', 'suggesting', 'viewing'])('publishes geometry for enabled review in %s', async (mode) => {
    const { paint, measure, commentsStore } = await mountShell({ mode, visible: true });
    await paint();
    expect(measure).toHaveBeenCalled();
    expect(commentsStore.editorCommentPositions['change-1']).toMatchObject({ kind: 'trackedChange' });
  });
});
