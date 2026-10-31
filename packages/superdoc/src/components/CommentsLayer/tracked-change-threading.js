// @ts-check

/**
 * Legacy comment payloads predate explicit tracked-change thread provenance.
 * These fields distinguish a true legacy review child from a v2 comment whose
 * anchor merely overlaps tracked content.
 *
 * @param {Record<string, any> | null | undefined} comment
 * @returns {boolean}
 */
const hasLegacyTrackedChangeThreadSignal = (comment) =>
  Boolean(comment?.trackedChangeLink) ||
  Boolean(comment?.trackedChangeType) ||
  Boolean(comment?.trackedChangeDisplayType) ||
  Boolean(comment?.trackedChangeText) ||
  Boolean(comment?.deletedText) ||
  comment?.trackedChange === true;

/**
 * Resolve explicit thread provenance first, then the guarded legacy fallback.
 * Spatial-only v2 comments carry neither the explicit field nor a legacy
 * review signal and therefore remain standalone.
 *
 * @param {Record<string, any> | null | undefined} comment
 * @returns {string | number | null}
 */
export const trackedChangeThreadParentIdForComment = (comment) => {
  if (comment?.trackedChangeThreadParentId != null) return comment.trackedChangeThreadParentId;
  if (comment?.trackedChangeParentId != null && hasLegacyTrackedChangeThreadSignal(comment)) {
    return comment.trackedChangeParentId;
  }
  return null;
};
