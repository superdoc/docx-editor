import { afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { defineComponent, h, nextTick } from 'vue';
import { EventEmitter } from 'eventemitter3';
import { DOCX } from '@superdoc/common';
import { useSuperdocStore } from '../stores/superdoc-store.js';
import { useCommentsStore } from '../stores/comments-store.js';
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
        name: 'CheckboxSelectionFixture',
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
  window.getSelection()?.removeAllRanges();
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
  window.getSelection()?.removeAllRanges();
  const pinia = createPinia();
  const store = useSuperdocStore(pinia);
  store.documents = [{ id: 'doc-a', type: DOCX, data: new Uint8Array(), editorMountNonce: 0 }];
  const config = { modules: { comments: {} }, documentMode: 'editing' };
  const uiConfig = normalizeUiConfig(config);
  Object.assign(store.modules, config.modules);
  let currentSnapshot = null;
  const selection = {
    getSnapshot: () => currentSnapshot,
    toSelectionTarget: () => ({ kind: 'ok', mode: currentSnapshot ? 'range' : 'caret' }),
  };
  const superdoc = Object.assign(new EventEmitter(), {
    config,
    uiConfig,
    activeEditor: {
      editorVersion: 2,
      documentId: 'doc-a',
      host: { getHandles: () => ({ editing: { selection } }) },
    },
    user: { name: 'Fixture author' },
    users: [],
    colors: [],
    broadcastSidebarToggle() {},
  });
  const commentsStore = useCommentsStore(pinia);
  Object.assign(commentsStore.viewingVisibility, { documentMode: 'editing', commentsVisible: false });
  const addComment = vi.spyOn(commentsStore, 'showAddComment').mockResolvedValue({ ok: false });
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
  const editor = wrapper.findComponent({ name: 'CheckboxSelectionFixture' });
  expect(editor.exists()).toBe(true);
  const container = document.createElement('div');
  const checkbox = document.createElement('span');
  checkbox.dataset.sourceNodeId = 'checkbox-block';
  checkbox.dataset.sdtId = 'checkbox-sdt';
  checkbox.dataset.wordCheckbox = 'true';
  checkbox.textContent = '☐';
  checkbox.getBoundingClientRect = () => new DOMRect(100, 200, 20, 20);
  const ordinary = document.createElement('span');
  ordinary.dataset.sourceNodeId = 'ordinary-block';
  ordinary.textContent = 'After';
  ordinary.getBoundingClientRect = () => new DOMRect(140, 240, 60, 20);
  container.append(checkbox, ordinary);
  const settle = async () => {
    await nextTick();
    for (let attempt = 0; attempt < 8 && frames.size; attempt += 1) {
      for (const [id, callback] of [...frames]) {
        frames.delete(id);
        callback(0);
      }
      await flushPromises();
    }
    await flushPromises();
  };
  let epoch = 0;
  const paint = async () => {
    editor.vm.$emit('v2-render', { epoch: ++epoch, mountContainer: container });
    await settle();
  };
  const select = async (blockId) => {
    currentSnapshot = blockId
      ? { anchor: { blockId, blockOffset: 0 }, focus: { blockId, blockOffset: blockId === 'checkbox-block' ? 1 : 5 } }
      : null;
    editor.vm.$emit('v2-selection-changed', {
      hasRangeSelection: currentSnapshot !== null,
      snapshot: currentSnapshot,
    });
    await settle();
  };
  await paint();
  return { wrapper, store, addComment, checkbox, select, paint };
}

const commentAction = (wrapper) => wrapper.find('.superdoc__tools [data-id="is-tool"]');

describe('SD-3055 actual shell checkbox selection during repaint', () => {
  it('retains the positioned comment action and selection through null geometry while the host range survives', async () => {
    const { wrapper, store, addComment, checkbox, select, paint } = await mountShell();
    await select('checkbox-block');
    const selection = store.activeSelection;
    const position = store.selectionPosition;
    const action = commentAction(wrapper).element;
    expect(selection).not.toBeNull();
    expect(position).toMatchObject({ source: 'document-editor', top: 200, left: 100 });

    checkbox.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
    await paint();

    expect(store.activeSelection).toBe(selection);
    expect(store.selectionPosition).toBe(position);
    expect(commentAction(wrapper).element).toBe(action);
    await commentAction(wrapper).trigger('mousedown');
    await flushPromises();
    expect(addComment).toHaveBeenCalledTimes(1);
    expect(addComment).toHaveBeenCalledWith(
      expect.objectContaining({ activeEditor: expect.objectContaining({ documentId: 'doc-a' }) }),
      200,
    );
  });

  it('clears the stale selection and comment action when the host range ends during null geometry', async () => {
    const { wrapper, store, checkbox, select, paint } = await mountShell();
    await select('checkbox-block');
    expect(commentAction(wrapper).exists()).toBe(true);
    checkbox.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
    await paint();
    expect(commentAction(wrapper).exists()).toBe(true);

    await select(null);

    expect(store.activeSelection).toBeNull();
    expect(store.selectionPosition).toBeNull();
    expect(commentAction(wrapper).exists()).toBe(false);
  });

  it('replaces checkbox selection with ordinary text geometry and keeps its legitimate comment action', async () => {
    const { wrapper, store, select } = await mountShell();
    await select('checkbox-block');
    const checkboxSelection = store.activeSelection;
    expect(store.selectionPosition).toMatchObject({ left: 100, top: 200 });

    await select('ordinary-block');

    expect(store.activeSelection).not.toBe(checkboxSelection);
    expect(store.selectionPosition).toMatchObject({ source: 'document-editor', left: 140, top: 240, right: 200 });
    expect(store.activeSelection.selectionBounds).toMatchObject({ left: 140, top: 240, width: 60 });
    expect(commentAction(wrapper).exists()).toBe(true);
  });
});
