/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vite-plus/test';
import { defineComponent, h, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { useCommentsStore } from '../stores/comments-store.js';
import { makeV2CommentsAdapter, makeV2TrackedChangesAdapter } from '../test-support/v2-review-adapters.js';
import type { SuperDocCommentsListChangePayload } from './types/index.js';
import { SuperDoc } from './SuperDoc.js';

vi.mock('../components/CommentsLayer/commentsList/commentsList.vue', () => ({
  default: defineComponent({
    name: 'CommentsListStub',
    setup: () => () => h('div', { class: 'comments-list-stub' }),
  }),
}));

vi.mock('@superdoc/common', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  vClickOutside: { mounted: vi.fn(), unmounted: vi.fn() },
}));

type DirectorySnapshot = { listStatus: 'pending' | 'ready'; items: unknown[] };
type Family = 'comments' | 'trackChanges';

function commentsListHost({ role = 'editor', comments = {} }: { role?: string; comments?: object | false } = {}) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const listeners: Partial<Record<Family, (snapshot: DirectorySnapshot) => void>> = {};
  const handle = (family: Family) => ({
    observe: (listener: (snapshot: DirectorySnapshot) => void) => {
      listeners[family] = listener;
      listener({ listStatus: 'pending', items: [] });
      return () => undefined;
    },
    getSnapshot: (): DirectorySnapshot => ({
      listStatus: 'ready',
      items: family === 'comments' ? [{ id: 'comment-on-painted-page' }] : [],
    }),
  });
  const payloads: SuperDocCommentsListChangePayload[] = [];
  const emitted: unknown[][] = [];
  const store = useCommentsStore();
  const superdoc = Object.create(SuperDoc.prototype) as InstanceType<typeof SuperDoc>;
  Object.assign(superdoc, {
    config: {
      role,
      modules: { comments },
      onCommentsListChange: (payload: SuperDocCommentsListChangePayload) => payloads.push(payload),
    },
    emit: (...args: unknown[]) => emitted.push(args),
    pinia,
    commentsStore: store,
    activeEditor: {
      documentId: 'doc-1',
      v2Comments: makeV2CommentsAdapter({
        mapV2CommentToUseCommentInput: (item: { id: string }) => ({
          commentId: item.id,
          fileId: 'doc-1',
          commentText: 'Body',
        }),
      }),
      v2TrackedChanges: makeV2TrackedChangesAdapter({
        mapV2TrackedChangeToCommentParams: (item: { id: string }) => ({
          changeId: item.id,
          documentId: 'doc-1',
        }),
      }),
    },
  });
  Object.defineProperty(superdoc, 'ui', {
    value: {
      comments: handle('comments'),
      trackChanges: handle('trackChanges'),
    },
  });
  const deliver = async (family: Family, listStatus: DirectorySnapshot['listStatus']) => {
    listeners[family]?.({
      listStatus,
      items: family === 'comments' ? [{ id: 'comment-1' }] : [],
    });
    await nextTick();
  };
  const deliverDirectory = async (listStatus: DirectorySnapshot['listStatus']) => {
    await deliver('comments', listStatus);
    await deliver('trackChanges', listStatus);
  };
  return { superdoc, store, payloads, emitted, deliver, deliverDirectory };
}

describe('built-in comments list', () => {
  it('reports { isRendered } at mount and removal on both the callback and the event', () => {
    const { superdoc, payloads, emitted } = commentsListHost();

    expect(superdoc.addCommentsList(document.body.appendChild(document.createElement('div')))).toBe(true);
    superdoc.removeCommentsList();

    expect(payloads).toEqual([{ isRendered: true }, { isRendered: false }]);
    expect(emitted).toEqual(payloads.map((payload) => ['comments-list-change', payload]));
  });

  it('stays loading until both directories are ready, and loads again while they reload', async () => {
    const { superdoc, store, deliverDirectory } = commentsListHost();
    const isLoading = () => store.isReviewDirectoryLoading;

    superdoc.addCommentsList(document.body.appendChild(document.createElement('div')));
    expect(isLoading()).toBe(true);

    await deliverDirectory('ready');
    expect(isLoading()).toBe(false);

    await deliverDirectory('pending');
    expect(isLoading()).toBe(true);
    await deliverDirectory('ready');
    expect(isLoading()).toBe(false);
  });

  it('ignores the painted-page snapshot and a family that finishes first', async () => {
    const { superdoc, store, deliver, deliverDirectory } = commentsListHost();
    const isLoading = () => store.isReviewDirectoryLoading;

    superdoc.addCommentsList(document.body.appendChild(document.createElement('div')));
    await Promise.resolve();
    await nextTick();
    expect(isLoading()).toBe(true);

    await deliver('comments', 'ready');
    expect(isLoading()).toBe(true);
    await deliver('trackChanges', 'ready');
    expect(isLoading()).toBe(false);

    await deliverDirectory('pending');
    await deliver('trackChanges', 'ready');
    expect(isLoading()).toBe(true);
    await deliver('comments', 'ready');
    expect(isLoading()).toBe(false);
  });

  it.each([
    ['a viewer', { role: 'viewer' }],
    ['comments turned off', { comments: false as const }],
  ])('returns false and reports nothing for %s', (_case, options) => {
    const { superdoc, payloads, emitted } = commentsListHost(options);

    expect(superdoc.addCommentsList(document.body.appendChild(document.createElement('div')))).toBe(false);
    expect(payloads).toEqual([]);
    expect(emitted).toEqual([]);
  });
});
