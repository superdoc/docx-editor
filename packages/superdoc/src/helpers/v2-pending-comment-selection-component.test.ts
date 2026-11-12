import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { defineComponent, h, nextTick } from 'vue';
import { EventEmitter } from 'eventemitter3';
import { DOCX } from '@superdoc/common';
import { useSuperdocStore } from '../stores/superdoc-store.js';
import { useCommentsStore } from '../stores/comments-store.js';
import { normalizeUiConfig } from '../core/config/normalize-ui-config.js';
import SuperDoc from '../SuperDoc.vue';
import { globalPropertiesWith } from '../test-support/global-properties.js';

vi.mock('../core/v2-integration/v2-integration.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/v2-integration/v2-integration.js')>();
  return {
    ...actual,
    createDefaultV2Integration: () => ({
      ...actual.createStubV2Integration(),
      EditorComponent: defineComponent({
        name: 'PendingCommentSelectionFixture',
        emits: ['v2-render'],
        setup: () => () => h('div'),
      }),
    }),
  };
});

const TOOL = '.superdoc__tools .tools-item[data-id="is-tool"]';
const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  vi.unstubAllGlobals();
});

async function mountShell(documentMode: 'viewing' | 'editing') {
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));

  const pinia = createPinia();
  const store = useSuperdocStore(pinia);
  const comments = useCommentsStore(pinia);
  store.documents = ['doc-a'].map((id) => ({
    id,
    type: DOCX,
    data: new Blob([]),
    editorMountNonce: 0,
    isReady: false,
    pageContainers: [],
    getEditor: () => null,
    getDocumentRuntime: () => null,
  }));
  const config = { modules: { comments: {} }, documentMode, allowSelectionInViewMode: true };
  Object.assign(store.modules, config.modules);

  const hostSelection = { range: true };
  const snapshot = {
    anchor: { fragmentId: 'commented-fragment', blockOffset: 0 },
    focus: { fragmentId: 'commented-fragment', blockOffset: 8 },
  };
  const selectionHandles = {
    getSnapshot: () => snapshot,
    toSelectionTarget: () => ({ kind: 'ok', mode: hostSelection.range ? 'range' : 'collapsed' }),
    syncVisibleOverlay() {},
    clear() {
      hostSelection.range = false;
    },
  };
  const superdoc = Object.assign(new EventEmitter(), {
    config,
    uiConfig: normalizeUiConfig(config),
    activeEditor: {
      editorVersion: 2,
      documentId: 'doc-a',
      options: { documentId: 'doc-a' },
      host: {
        getHandles: () =>
          documentMode === 'viewing'
            ? { selection: selectionHandles }
            : { selection: selectionHandles, editing: { selection: selectionHandles } },
      },
    },
    user: { name: 'Reviewer' },
    users: [],
    colors: [],
    broadcastSidebarToggle() {},
    setActiveEditor() {},
  });
  const wrapper = mount(SuperDoc, {
    global: {
      plugins: [pinia],
      config: { globalProperties: globalPropertiesWith({ $superdoc: superdoc }) },
      stubs: { SurfaceHost: true, FloatingComments: true, CommentDialog: true },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  superdoc.emit('active-editor-change');
  await nextTick();

  wrapper.find('.superdoc__layers').element.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
  const anchor = document.createElement('span');
  anchor.dataset.layoutFragmentId = 'commented-fragment';
  anchor.getBoundingClientRect = () => new DOMRect(100, 200, 120, 24);
  const mountContainer = document.createElement('div');
  mountContainer.append(anchor);
  const editor = wrapper.findComponent({ name: 'PendingCommentSelectionFixture' });

  const runFrames = async () => {
    for (let turn = 0; turn < 10 && frames.size; turn++) {
      for (const [id, callback] of [...frames]) {
        frames.delete(id);
        callback(0);
      }
      await nextTick();
      await flushPromises();
    }
    expect(frames.size).toBe(0);
  };
  let epoch = 0;
  const repaint = async () => {
    editor.vm.$emit('v2-render', { documentId: 'doc-a', epoch: ++epoch, mountContainer });
    await runFrames();
  };
  const openPendingComment = async () => {
    comments.pendingComment = comments.getPendingComment({
      selection: { documentId: 'doc-a', page: 1, selectionBounds: {}, source: 'document-editor' },
      documentId: 'doc-a',
      parentCommentId: null,
    });
    document.dispatchEvent(new Event('selectionchange'));
    await runFrames();
  };
  const closePendingComment = async () => {
    comments.pendingComment = null;
    store.selectionPosition = null;
    if (documentMode === 'viewing') selectionHandles.clear();
    await nextTick();
    await runFrames();
  };

  await repaint();
  return { closePendingComment, openPendingComment, repaint, wrapper };
}

describe('comment action after a pending comment closes', () => {
  it('stays hidden through a later repaint in viewing mode once the host range is gone', async () => {
    const { closePendingComment, openPendingComment, repaint, wrapper } = await mountShell('viewing');

    await openPendingComment();
    expect(wrapper.find(TOOL).exists()).toBe(true);

    await closePendingComment();
    expect(wrapper.find(TOOL).exists()).toBe(false);

    await repaint();
    expect(wrapper.find(TOOL).exists()).toBe(false);
  });

  it('keeps following the surviving host range in editing mode', async () => {
    const { closePendingComment, openPendingComment, repaint, wrapper } = await mountShell('editing');

    await openPendingComment();
    expect(wrapper.find(TOOL).exists()).toBe(true);

    await closePendingComment();
    await repaint();
    expect(wrapper.find(TOOL).exists()).toBe(true);
  });
});
