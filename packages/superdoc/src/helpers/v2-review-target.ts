type V2ReviewTargetInput = { entityId?: unknown; entityType?: unknown };

type V2ReviewTargetComment = { trackedChange?: unknown; commentId?: unknown; importedId?: unknown };

/**
 * Resolve the comments-store identity for a document-origin v2 review target.
 * Painted review carriers can become interactive before the asynchronous row
 * hydration finishes. In that window the host's canonical entity id remains
 * the correct pending active identity; once hydrated, the row aliases win.
 */
export function resolveV2ReviewTargetCommentId(
  target: V2ReviewTargetInput | null | undefined,
  getComment: ((id: string) => V2ReviewTargetComment | null | undefined) | null | undefined,
): string | null {
  if (!target || typeof target.entityId !== 'string') return null;
  if (target.entityType !== 'comment' && target.entityType !== 'trackedChange') return null;
  const comment = typeof getComment === 'function' ? getComment(target.entityId) : null;
  if (target.entityType === 'comment' && comment?.trackedChange) {
    return target.entityId;
  }
  const commentId = comment?.commentId ?? comment?.importedId ?? target.entityId;
  return commentId != null ? String(commentId) : null;
}
