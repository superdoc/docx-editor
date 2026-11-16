import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { defineComponent, h, nextTick } from 'vue';
import { EventEmitter } from 'eventemitter3';
import { DOCX } from '@superdoc/common';
import { useSuperdocStore } from '../stores/superdoc-store.js';
import { useCommentsStore } from '../stores/comments-store.js';
import { normalizeUiConfig } from '../core/config/normalize-ui-config.js';
import SuperDoc from '../SuperDoc.vue';
import FloatingComments from '../components/CommentsLayer/FloatingComments.vue';
import useComment from '../components/CommentsLayer/use-comment.js';

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
      EditorComponent: defineComponent({
        name: 'SidebarToggleFixture',
        emits: ['v2-render'],
        setup: () => () => h('div'),
      }),
    }),
  };
});

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  vi.unstubAllGlobals();
});

async function mountShell({ realFloating = false } = {}) {
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const pinia = createPinia();
  const store = useSuperdocStore(pinia);
  store.documents = [{ id: 'doc-a', type: DOCX, data: new Uint8Array(), editorMountNonce: 0 }];
  const config = { modules: { comments: {} }, documentMode: 'editing' };
  Object.assign(store.modules, config.modules);
  const broadcastSidebarToggle = vi.fn();
  const superdoc = Object.assign(new EventEmitter(), {
    config,
    uiConfig: normalizeUiConfig(config),
    activeEditor: { editorVersion: 2, documentId: 'doc-a' },
    user: { name: 'Fixture author' },
    users: [],
    colors: [],
    broadcastSidebarToggle,
  });
  const commentsStore = useCommentsStore(pinia);
  const wrapper = mount(SuperDoc, {
    global: {
      plugins: [pinia],
      config: { globalProperties: { $superdoc: superdoc } },
      stubs: { SurfaceHost: true, FloatingComments: !realFloating, CommentDialog: true },
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
  carrier.getClientRects = () => Object.assign([rect], { item: () => rect });
  const container = document.createElement('div');
  container.appendChild(carrier);
  wrapper
    .findComponent({ name: 'SidebarToggleFixture' })
    .vm.$emit('v2-render', { epoch: 1, mountContainer: container });
  await nextTick();
  for (const [id, callback] of [...frames]) {
    frames.delete(id);
    callback(0);
  }
  await flushPromises();
  broadcastSidebarToggle.mockClear();
  const setPendingComment = async (comment: { commentId: string; documentId: string } | null) => {
    commentsStore.pendingComment = comment;
    await flushPromises();
  };
  return { broadcastSidebarToggle, setPendingComment, wrapper, commentsStore, store };
}

describe('sidebar-toggle broadcast', () => {
  const first = { commentId: 'pending-1', documentId: 'doc-a' };
  const second = { commentId: 'pending-2', documentId: 'doc-a' };

  it('reports opening for a pending comment as true', async () => {
    const { broadcastSidebarToggle, setPendingComment } = await mountShell();
    await setPendingComment(first);
    expect(broadcastSidebarToggle.mock.calls).toEqual([[true]]);
  });

  it('does not report a toggle when one pending comment replaces another', async () => {
    const { broadcastSidebarToggle, setPendingComment } = await mountShell();
    await setPendingComment(first);
    await setPendingComment(second);
    expect(broadcastSidebarToggle).toHaveBeenCalledTimes(1);
  });

  it('reports closing as false', async () => {
    const { broadcastSidebarToggle, setPendingComment } = await mountShell();
    await setPendingComment(first);
    await setPendingComment(null);
    expect(broadcastSidebarToggle.mock.lastCall).toEqual([false]);
  });
});

it('keeps a committed comment mounted across geometry refresh while removing absent cards and closed contexts', async () => {
  const { wrapper, commentsStore, store } = await mountShell({ realFloating: true });
  store.isReady = true;
  commentsStore.hasInitializedLocations = true;
  const position = {
    key: 'comment-a',
    threadId: 'comment-a',
    bounds: { top: 100, bottom: 120, left: 0, right: 100 },
    rects: [{ top: 100, bottom: 120, left: 0, right: 100 }],
  };
  commentsStore.commentsList = [useComment({ commentId: 'comment-a', fileId: 'doc-a', commentText: 'Saved' })];
  commentsStore.editorCommentPositions = { 'comment-a': position };
  commentsStore.committedReviewPresentations = {
    'doc-a': {
      epoch: 'document-epoch',
      baseVersion: 0,
      version: 1,
      unchanged: false,
      coordinate: { documentEpoch: 'document-epoch', mountId: 'mount-a', commitSequence: 1, reviewVersion: 1 },
      rowVersions: { 'comment-a': 1 },
      groupOrder: { open: ['comment-a'], resolved: [] },
      updateContext: vi.fn(),
      instances: [
        {
          id: 'comment-a',
          rowId: 'comment-a',
          threadId: 'comment-a',
          pageIndex: 0,
          positionKey: 'comment-a',
          positionEntry: position,
          anchorTop: 100,
          anchorBottom: 120,
          top: 100,
          height: 110,
          isPrimary: true,
          isOffscreenReviewCard: false,
          mount: true,
        },
      ],
    },
  };
  await flushPromises();
  const sidebar = wrapper.findComponent(FloatingComments);
  expect(sidebar.exists()).toBe(true);
  const mountedSidebar = sidebar.element;
  const dialog = sidebar.findComponent({ name: 'CommentDialog' });
  expect(dialog.exists()).toBe(true);
  const mountedDialog = dialog.element;
  commentsStore.editorCommentPositions = {};
  await flushPromises();
  expect(commentsStore.getFloatingComments).toHaveLength(0);
  expect(wrapper.findComponent(FloatingComments).element).toBe(mountedSidebar);
  expect(wrapper.findComponent({ name: 'CommentDialog' }).element).toBe(mountedDialog);
  commentsStore.committedReviewPresentations = {};
  commentsStore.commentsList = [];
  await flushPromises();
  expect(wrapper.findAllComponents({ name: 'CommentDialog' })).toHaveLength(0);
  commentsStore.isCommentsListVisible = true;
  await flushPromises();
  expect(wrapper.findComponent(FloatingComments).exists()).toBe(false);
  commentsStore.isCommentsListVisible = false;
  await flushPromises();
  expect(wrapper.findComponent(FloatingComments).exists()).toBe(true);
  store.documents = [];
  await flushPromises();
  expect(wrapper.findComponent(FloatingComments).exists()).toBe(false);
});
