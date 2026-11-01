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
 * Returns the comments belonging to this tracked-change thread, in original list order.
 */
export const collectTrackedChangeThread = <
  Comment extends {
    commentId: string;
    parentCommentId?: string | null;
    threadingParentCommentId?: string | null;
    trackedChangeThreadParentId?: string | null;
  },
>(
  parentComment: Comment,
  allComments: ReadonlyArray<Comment>,
): Array<Comment> => {
  const trackedChangeId = parentComment.commentId;
  const threadIds = new Set([trackedChangeId]);
  const queue: string[] = [];

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
