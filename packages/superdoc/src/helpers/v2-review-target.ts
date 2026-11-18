type V2ReviewTargetInput = { entityId?: unknown; entityType?: unknown; paintedEntityId?: unknown };

type V2ReviewTargetComment = {
  trackedChange?: unknown;
  commentId?: unknown;
  importedId?: unknown;
  trackedChangeCanonicalId?: unknown;
};

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
  if (
    target.entityType === 'trackedChange' &&
    typeof target.paintedEntityId === 'string' &&
    target.paintedEntityId !== target.entityId &&
    typeof getComment === 'function'
  ) {
    const paintedRow = getComment(target.paintedEntityId);
    if (
      paintedRow?.trackedChange &&
      paintedRow.commentId === target.paintedEntityId &&
      paintedRow.trackedChangeCanonicalId === target.entityId
    ) {
      return target.paintedEntityId;
    }
  }
  const comment = typeof getComment === 'function' ? getComment(target.entityId) : null;
  if (target.entityType === 'comment' && comment?.trackedChange) {
    return target.entityId;
  }
  const commentId = comment?.commentId ?? comment?.importedId ?? target.entityId;
  return commentId != null ? String(commentId) : null;
}
