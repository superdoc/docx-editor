import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { createPinia, setActivePinia } from 'pinia';
import type { ReceiptSuccess } from '@superdoc/document-api';
import { useCommentsStore } from './comments-store.js';
import useComment from '../components/CommentsLayer/use-comment.js';
import { makeV2CommentsAdapter, makeV2TrackedChangesAdapter } from '../test-support/v2-review-adapters.js';

type StoreHost = Parameters<ReturnType<typeof useCommentsStore>['setActiveComment']>[0];

function makeSuperdoc(adapter: unknown): StoreHost {
  return { activeEditor: { editorVersion: 2, v2Comments: adapter }, config: {}, emit: vi.fn() };
}

describe('comments-store v2 adapter admission', () => {
  let store: ReturnType<typeof useCommentsStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    store = useCommentsStore();
  });

  it('keeps a complete adapter from the setter and from the editor facade', () => {
    const comments = makeV2CommentsAdapter();
    const trackedChanges = makeV2TrackedChangesAdapter();
    store.setV2CommentsAdapter(comments);
    store.setV2TrackedChangesAdapter(trackedChanges);
    expect(store.getV2CommentsAdapter(null)).toBe(comments);
    expect(store.getV2TrackedChangesAdapter(null)).toBe(trackedChanges);

    const facadeComments = makeV2CommentsAdapter();
    const facadeTrackedChanges = makeV2TrackedChangesAdapter();
    const superdoc = {
      activeEditor: { v2Comments: facadeComments, v2TrackedChanges: facadeTrackedChanges },
      config: {},
      emit: vi.fn(),
    };
    expect(store.getV2CommentsAdapter(superdoc)).toBe(facadeComments);
    expect(store.getV2TrackedChangesAdapter(superdoc)).toBe(facadeTrackedChanges);
  });

  it('keeps complete adapters whose host passed a numeric document id', () => {
    const comments = makeV2CommentsAdapter({ documentId: 42 });
    const trackedChanges = makeV2TrackedChangesAdapter({ documentId: 42 });
    store.setV2CommentsAdapter(comments);
    store.setV2TrackedChangesAdapter(trackedChanges);
    expect(store.v2CommentsAdapter).toBe(comments);
    expect(store.v2TrackedChangesAdapter).toBe(trackedChanges);
  });

  it('treats an adapter missing a required method as absent', async () => {
    const { reply: _reply, ...commentsWithoutReply } = makeV2CommentsAdapter();
    const { accept: _accept, ...trackedChangesWithoutAccept } = makeV2TrackedChangesAdapter();
    store.setV2CommentsAdapter(commentsWithoutReply);
    store.setV2TrackedChangesAdapter(trackedChangesWithoutAccept);
    expect(store.getV2CommentsAdapter(null)).toBeNull();
    expect(store.getV2TrackedChangesAdapter(null)).toBeNull();
    expect(store.v2CommentsAdapter).toBeNull();
    expect(store.v2TrackedChangesAdapter).toBeNull();

    const superdoc = makeSuperdoc(commentsWithoutReply);
    expect(await store.replyCommentV2({ superdoc, parentCommentId: 'c1', text: 'Reply' })).toEqual({
      ok: false,
      reason: 'v2-comments-adapter-missing',
    });
  });

  it('takes the non-V2 path for set-active and sidebar decisions instead of calling a missing method', async () => {
    const { setActiveComment: _setActiveComment, ...commentsWithoutSetActive } = makeV2CommentsAdapter();
    const { accept: _accept, ...trackedChangesWithoutAccept } = makeV2TrackedChangesAdapter();
    const setActiveComment = vi.fn();
    const decide = vi.fn(async (): Promise<ReceiptSuccess> => ({ success: true }));
    const superdoc: StoreHost = {
      activeEditor: {
        editorVersion: 2,
        v2Comments: commentsWithoutSetActive,
        v2TrackedChanges: trackedChangesWithoutAccept,
        commands: { setActiveComment },
        doc: { trackChanges: { decide } },
      },
      config: {},
      emit: vi.fn(),
    };
    store.setV2CommentsAdapter(commentsWithoutSetActive);
    store.setV2TrackedChangesAdapter(trackedChangesWithoutAccept);

    expect(() => store.setActiveComment(superdoc, null)).not.toThrow();
    expect(setActiveComment).toHaveBeenCalledWith({ commentId: null });

    const outcome = await store.decideTrackedChangeFromSidebar({
      superdoc,
      comment: useComment({ trackedChange: true, commentId: 'tc-1' }),
      decision: 'accept',
    });
    expect(outcome).not.toHaveProperty('reason', 'adapter-threw');
    expect(decide).toHaveBeenCalledWith({ decision: 'accept', target: expect.anything() });
  });

  it('falls back to the stored adapter when the editor facade holds an incomplete one', () => {
    const stored = makeV2CommentsAdapter();
    const storedTracked = makeV2TrackedChangesAdapter();
    store.setV2CommentsAdapter(stored);
    store.setV2TrackedChangesAdapter(storedTracked);
    const { resolve: _resolve, ...facadeWithoutResolve } = makeV2CommentsAdapter();
    const { reject: _reject, ...facadeWithoutReject } = makeV2TrackedChangesAdapter();
    const superdoc = {
      activeEditor: { v2Comments: facadeWithoutResolve, v2TrackedChanges: facadeWithoutReject },
      config: {},
      emit: vi.fn(),
    };
    expect(store.getV2CommentsAdapter(superdoc)).toBe(stored);
    expect(store.getV2TrackedChangesAdapter(superdoc)).toBe(storedTracked);
  });

  it('clears the stored adapter when an incomplete one replaces it', () => {
    store.setV2CommentsAdapter(makeV2CommentsAdapter());
    store.setV2CommentsAdapter({ documentId: 'doc-1' });
    expect(store.v2CommentsAdapter).toBeNull();
  });
});
