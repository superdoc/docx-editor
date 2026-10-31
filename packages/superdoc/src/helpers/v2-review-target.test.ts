import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { createPinia, setActivePinia } from 'pinia';

import { resolveV2ReviewTargetCommentId } from './v2-review-target.js';
import { useCommentsStore } from '../stores/comments-store.js';
import { useSuperdocStore } from '../stores/superdoc-store.js';
import useComment from '../components/CommentsLayer/use-comment.js';

const makeOpenRow = (overrides = {}) => ({
  commentId: 'c1',
  fileId: 'doc-1',
  commentText: 'Thread body',
  resolvedTime: null,
  resolvedByEmail: null,
  resolvedByName: null,
  ...overrides,
});

const makeTrackedChangeRow = (overrides = {}) => {
  const commentId = overrides.commentId ?? 'tc-old';
  return useComment({
    commentId,
    fileId: 'doc-1',
    trackedChange: true,
    trackedChangeText: 'old tracked change',
    trackedChangeType: 'insert',
    trackedChangeDisplayType: 'insert',
    trackedChangeAnchorKey: overrides.trackedChangeAnchorKey ?? `tc::body::${commentId}`,
    commentText: '',
    ...overrides,
  });
};

describe('v2 review target activation', () => {
  let store;

  beforeEach(() => {
    setActivePinia(createPinia());
    const superdocStore = useSuperdocStore();
    superdocStore.documents = [
      { id: 'doc-1', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    ];
    store = useCommentsStore();
  });

  it('uses the canonical target id while its sidebar row is still hydrating', () => {
    const getComment = vi.fn(() => null);

    expect(resolveV2ReviewTargetCommentId({ entityType: 'trackedChange', entityId: 'tc-canonical' }, getComment)).toBe(
      'tc-canonical',
    );
    expect(getComment).toHaveBeenCalledWith('tc-canonical');
  });

  it('prefers the hydrated row identity and imported alias', () => {
    expect(
      resolveV2ReviewTargetCommentId({ entityType: 'comment', entityId: 'comment-carrier' }, () => ({
        commentId: 'comment-row',
        importedId: 'imported-row',
      })),
    ).toBe('comment-row');
    expect(
      resolveV2ReviewTargetCommentId({ entityType: 'trackedChange', entityId: 'tracked-carrier' }, () => ({
        importedId: 'tracked-imported-row',
      })),
    ).toBe('tracked-imported-row');
  });

  it('resolves a painted comment entity through the real store lookup when a tracked-change alias collides', () => {
    const trackedChangeRow = makeTrackedChangeRow({
      commentId: 'tc|main:document.xml|ins|wId:2',
      importedId: '2',
      trackedChangeText: 'directory collision',
    });
    const realComment = useComment(makeOpenRow({ commentId: '2', commentText: 'Live sidebar comment' }));

    store.commentsList = [realComment];
    store.reviewDirectoryList = [trackedChangeRow];

    expect(resolveV2ReviewTargetCommentId({ entityType: 'comment', entityId: '2' }, store.getComment)).toBe('2');
  });

  it('keeps the painted comment id while its row hydrates and only a colliding tracked-change alias exists', () => {
    const trackedChangeRow = makeTrackedChangeRow({
      commentId: 'tc|main:document.xml|ins|wId:2',
      importedId: '2',
      trackedChangeText: 'directory collision',
    });

    store.commentsList = [];
    store.reviewDirectoryList = [trackedChangeRow];

    expect(resolveV2ReviewTargetCommentId({ entityType: 'comment', entityId: '2' }, store.getComment)).toBe('2');
  });

  it('rejects unsupported or malformed targets', () => {
    expect(resolveV2ReviewTargetCommentId(null, () => null)).toBeNull();
    expect(resolveV2ReviewTargetCommentId({ entityType: 'bookmark', entityId: 'b1' }, () => null)).toBeNull();
    expect(resolveV2ReviewTargetCommentId({ entityType: 'comment' }, () => null)).toBeNull();
  });
});
