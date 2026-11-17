import { afterEach, expect, it, vi } from 'vite-plus/test';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { EventEmitter } from 'eventemitter3';
import { PDF } from '@superdoc/common';
import { useSuperdocStore } from '../stores/superdoc-store.js';
import { useCommentsStore } from '../stores/comments-store.js';
import { normalizeUiConfig } from '../core/config/normalize-ui-config.js';
import { fixedCommentsLayout } from '../test-support/comments-layout.js';
import useComment from '../components/CommentsLayer/use-comment.js';
import SuperDoc from '../SuperDoc.vue';

vi.mock('../components/CommentsLayer/FloatingComments.vue', () => {
  throw new Error('Synthetic sidebar chunk unavailable');
});

let wrapper: VueWrapper | null = null;
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

it('keeps a pending sidebar comment available and dismissible after its renderer fails to load', async () => {
  const pinia = createPinia();
  const store = useSuperdocStore(pinia);
  store.documents = [
    {
      id: 'pdf-a',
      type: PDF,
      data: new Blob(),
      getEditor: () => null,
      getDocumentRuntime: () => null,
      isReady: false,
      pageContainers: [],
    },
  ];
  const config = { modules: { comments: {} }, documentMode: 'editing' };
  Object.assign(store.modules, config.modules);
  const superdoc = Object.assign(new EventEmitter(), {
    config,
    ...fixedCommentsLayout('sidebar'),
    uiConfig: normalizeUiConfig(config),
    activeEditor: null,
    user: { name: 'Fixture author' },
    users: [],
    colors: [],
    broadcastSidebarToggle: vi.fn(),
  });
  const exception = vi.fn();
  superdoc.on('exception', exception);
  const comments = useCommentsStore(pinia);
  comments.pendingComment = useComment({
    commentId: 'pending-pdf',
    fileId: 'pdf-a',
    selection: {
      source: 'pdf',
      selectionBounds: { top: 10, bottom: 30, left: 10, right: 40 },
    },
  });
  comments.currentCommentText = 'Synthetic unsaved draft';
  wrapper = mount(SuperDoc, {
    global: {
      plugins: [pinia],
      config: { globalProperties: { $superdoc: superdoc, $pinia: pinia } },
      stubs: { SurfaceHost: true, PdfViewer: true, CommentDialog: true },
    },
  });
  await vi.dynamicImportSettled();
  await flushPromises();
  expect(exception).toHaveBeenCalledTimes(1);
  expect(wrapper.find('.superdoc__compact-comment-popover').exists()).toBe(true);
  expect(wrapper.findComponent({ name: 'CommentDialog' }).props('comment')).toBe(comments.pendingComment);
  expect(comments.currentCommentText).toBe('Synthetic unsaved draft');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await flushPromises();
  expect(comments.pendingComment).toBeNull();
  expect(wrapper.find('.superdoc__compact-comment-popover').exists()).toBe(false);
});
