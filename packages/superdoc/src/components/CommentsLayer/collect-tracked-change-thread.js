// @ts-check

import { trackedChangeThreadParentIdForComment } from './tracked-change-threading.js';

/**
 * Collect every comment that should appear inside the tracked-change dialog
 * for `parentComment`. Walks two sources of membership:
 *
 *   1. **Seed**: comments explicitly threaded to this TC via
 *      `trackedChangeThreadParentId`
 *      whose conversational thread *starts here* (no `parentCommentId`),
 *      plus direct replies whose stored or UI-threading parent points at
 *      `parentComment.commentId`.
 *   2. **BFS**: replies-of-replies — any comment whose `parentCommentId`
 *      points to something already in the thread.
 *
 * Pure function — no side effects, no Vue, no store. Extracted from
 * CommentDialog.vue so the logic can be unit-tested in isolation.
 *
 * @template {{ commentId: string, parentCommentId?: string|null, threadingParentCommentId?: string|null, trackedChangeThreadParentId?: string|null }} Comment
 * @param {Comment} parentComment The tracked-change comment whose dialog this collects.
 * @param {ReadonlyArray<Comment>} allComments All known comments in the store.
 * @returns {Array<Comment>} Comments belonging to this tracked-change thread, in original list order.
 */
export const collectTrackedChangeThread = (parentComment, allComments) => {
  const trackedChangeId = parentComment.commentId;
  const threadIds = new Set([trackedChangeId]);
  /** @type {string[]} */
  const queue = [];

  allComments.forEach((comment) => {
    if (comment.commentId === trackedChangeId) return;
    const parentIds = [comment.parentCommentId, comment.threadingParentCommentId]
      .filter((id) => id != null)
      .map((id) => String(id));
    const isDirectChild = parentIds.includes(trackedChangeId);
    const isTrackedChangeThreadRoot =
      String(trackedChangeThreadParentIdForComment(comment) ?? '') === trackedChangeId && !comment.parentCommentId;

    if (isDirectChild || isTrackedChangeThreadRoot) {
      threadIds.add(comment.commentId);
      queue.push(comment.commentId);
    }
  });

  for (let i = 0; i < queue.length; i += 1) {
    const parentId = queue[i];
    allComments.forEach((comment) => {
      const parentIds = [comment.parentCommentId, comment.threadingParentCommentId]
        .filter((id) => id != null)
        .map((id) => String(id));
      if (parentIds.includes(parentId) && !threadIds.has(comment.commentId)) {
        threadIds.add(comment.commentId);
        queue.push(comment.commentId);
      }
    });
  }

  return allComments.filter((comment) => threadIds.has(comment.commentId));
};
