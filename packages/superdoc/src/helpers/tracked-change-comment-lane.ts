const TRACKED_CHANGE_COMMENT_LANE_ID_PREFIX = 'tc-comment:';

export function isSyntheticTrackedChangeCommentLaneItem(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false;
  const { id, commentId } = item as { id?: unknown; commentId?: unknown };
  const itemId = id ?? commentId;
  return typeof itemId === 'string' && itemId.startsWith(TRACKED_CHANGE_COMMENT_LANE_ID_PREFIX);
}
