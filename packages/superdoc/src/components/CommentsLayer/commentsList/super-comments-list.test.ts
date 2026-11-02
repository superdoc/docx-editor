import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';
import { defineComponent, h } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { useCommentsStore } from '../../../stores/comments-store.js';
import { useSuperdocStore } from '../../../stores/superdoc-store.js';
import { makeV2CommentsAdapter, makeV2TrackedChangesAdapter } from '../../../test-support/v2-review-adapters.js';

vi.mock('./commentsList.vue', () => ({
  default: defineComponent({
    name: 'CommentsListStub',
    setup() {
      return () => h('div', { class: 'comments-list-stub' });
    },
  }),
}));

vi.mock('@superdoc/common', async (importOriginal) => ({
  ...(await importOriginal()),
  vClickOutside: { mounted: vi.fn(), unmounted: vi.fn() },
}));

import { SuperComments } from './super-comments-list.js';

describe('SuperComments', () => {
  let element;
  const superdocStub = { id: 'sd-1' };

  beforeEach(() => {
    element = document.createElement('div');
    document.body.appendChild(element);
  });

  it('mounts the Vue app into the provided element on construction', () => {
    const instance = new SuperComments({ element, comments: [] }, superdocStub);
    expect(instance.app).not.toBeNull();
    expect(instance.element).toBe(element);
    expect(element.querySelector('.comments-list-stub')).not.toBeNull();
  });

  it('exposes the merged config', () => {
    const comments = [{ id: 'c-1' }];
    const instance = new SuperComments({ element, comments }, superdocStub);
    expect(instance.config.comments).toBe(comments);
    expect(instance.config.element).toBe(element);
  });

  it('exposes the superdoc reference as $superdoc on the Vue app', () => {
    const instance = new SuperComments({ element }, superdocStub);
    expect(instance.app.config.globalProperties.$superdoc).toBe(superdocStub);
  });

  it('reuses the parent SuperDoc pinia instance when available', () => {
    const pinia = createPinia();
    const instance = new SuperComments({ element }, { ...superdocStub, pinia });
    expect(instance.app.config.globalProperties.$pinia).toBe(pinia);
  });

  it('inherits parent app provides when mounting inside an existing SuperDoc app', () => {
    const parentProvides = { theme: 'shared-theme' };
    const instance = new SuperComments(
      { element },
      {
        ...superdocStub,
        app: {
          _context: {
            provides: parentProvides,
          },
        },
      },
    );

    expect(Object.getPrototypeOf(instance.app._context.provides)).toBe(parentProvides);
  });

  it('resolves element via selector when no element is provided', () => {
    const el = document.createElement('div');
    el.id = 'my-comments-host';
    document.body.appendChild(el);
    const instance = new SuperComments({ selector: 'my-comments-host' }, superdocStub);
    expect(instance.element).toBe(el);
  });

  it('close() unmounts the app and clears refs', () => {
    const instance = new SuperComments({ element }, superdocStub);
    instance.close();
    expect(instance.app).toBeNull();
    expect(instance.container).toBeNull();
    expect(instance.element).toBeNull();
  });

  it('holds both document-directory observers until close and publishes only ready snapshots', async () => {
    const listeners = {};
    const stops = { comments: vi.fn(), trackChanges: vi.fn() };
    const handle = (family) => ({
      observe: vi.fn((listener) => {
        listeners[family] = listener;
        listener({ listStatus: 'ready', items: [{ id: `${family}-window` }] });
        return stops[family];
      }),
      getSnapshot: vi.fn(() => ({ listStatus: 'pending', items: [] })),
    });
    const commentsStore = {
      isReviewDirectoryActive: false,
      isReviewDirectoryLoading: false,
      setReviewDirectoryFromV2: vi.fn(),
      clearReviewDirectory: vi.fn(),
    };
    const instance = new SuperComments(
      { element },
      {
        ...superdocStub,
        commentsStore,
        ui: {
          comments: handle('comments'),
          trackChanges: handle('trackChanges'),
        },
      },
    );

    listeners.comments({ listStatus: 'ready', items: [{ id: 'comment-directory' }] });
    listeners.trackChanges({ listStatus: 'ready', items: [{ id: 'change-directory' }] });
    expect(commentsStore.setReviewDirectoryFromV2).toHaveBeenLastCalledWith(
      expect.objectContaining({
        commentItems: [{ id: 'comment-directory' }],
        trackedChangeItems: [{ id: 'change-directory' }],
      }),
    );
    const stableItems = [{ id: 'stable-directory' }];
    listeners.comments({ listStatus: 'ready', items: stableItems });
    listeners.comments({ listStatus: 'ready', items: stableItems });
    expect(commentsStore.setReviewDirectoryFromV2).toHaveBeenCalledTimes(5);
    expect(commentsStore.isReviewDirectoryActive).toBe(true);

    instance.close();
    expect(stops.comments).toHaveBeenCalledTimes(1);
    expect(stops.trackChanges).toHaveBeenCalledTimes(1);
    expect(commentsStore.clearReviewDirectory).toHaveBeenCalledTimes(1);
    expect(commentsStore.isReviewDirectoryActive).toBe(false);
    await Promise.resolve();
    expect(commentsStore.setReviewDirectoryFromV2).toHaveBeenCalledTimes(5);
  });

  it('drives the real Pinia comments store through open, ready snapshots and close', () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    useSuperdocStore().documents = [{ id: 'doc-1', type: 'docx' }];
    const commentsStore = useCommentsStore();
    const readyHandle = (items) => ({
      observe: vi.fn((listener) => {
        listener({ listStatus: 'ready', items });
        return vi.fn();
      }),
      getSnapshot: vi.fn(() => ({ listStatus: 'pending', items: [] })),
    });
    const superdoc = {
      ...superdocStub,
      pinia,
      commentsStore,
      activeEditor: {
        documentId: 'doc-1',
        v2Comments: makeV2CommentsAdapter({
          mapV2CommentToUseCommentInput: (item) => ({ commentId: item.id, fileId: 'doc-1', commentText: 'Body' }),
        }),
        v2TrackedChanges: makeV2TrackedChangesAdapter({
          mapV2TrackedChangeToCommentParams: (item) => ({ changeId: item.id, documentId: 'doc-1' }),
        }),
      },
      ui: {
        comments: readyHandle([{ id: 'directory-comment' }]),
        trackChanges: readyHandle([{ id: 'directory-change' }]),
      },
    };

    const instance = new SuperComments({ element }, superdoc);

    expect(commentsStore.isReviewDirectoryActive).toBe(true);
    expect(commentsStore.isReviewDirectoryLoading).toBe(false);
    expect(commentsStore.reviewDirectoryList.map((row) => row.commentId)).toEqual([
      'directory-comment',
      'directory-change',
    ]);

    instance.close();

    expect(commentsStore.reviewDirectoryList).toEqual([]);
    expect(commentsStore.isReviewDirectoryActive).toBe(false);
    expect(commentsStore.isReviewDirectoryLoading).toBe(false);
  });

  it('close() is a no-op when there is no app', () => {
    const instance = new SuperComments({ element }, superdocStub);
    instance.close();
    expect(() => instance.close()).not.toThrow();
  });

  it('open() re-creates the app after close', () => {
    const instance = new SuperComments({ element }, superdocStub);
    instance.close();
    // Re-provide element and re-open
    instance.element = document.body.appendChild(document.createElement('div'));
    instance.open();
    expect(instance.app).not.toBeNull();
  });
});
