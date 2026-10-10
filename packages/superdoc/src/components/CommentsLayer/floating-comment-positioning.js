export const normalizeFloatingAnchorTop = (top) => {
  return top;
};

export const isAnchorOutsideFloatingViewport = (anchorTop, viewportTop, viewportBottom, anchorBottom = anchorTop) => {
  if (!Number.isFinite(anchorTop) || !Number.isFinite(viewportTop) || !Number.isFinite(viewportBottom)) {
    return false;
  }

  const resolvedAnchorBottom = Number.isFinite(anchorBottom) ? anchorBottom : anchorTop;
  return resolvedAnchorBottom < viewportTop || anchorTop > viewportBottom;
};

export const shouldKeepFloatingCardAtAnchor = ({ anchorTop, anchorBottom, viewportTop, viewportBottom }) => {
  return isAnchorOutsideFloatingViewport(anchorTop, viewportTop, viewportBottom, anchorBottom);
};

export const resolveOffscreenFloatingCardTop = ({
  anchorTop,
  anchorBottom,
  cardHeight,
  viewportTop,
  viewportBottom,
}) => {
  if (
    !shouldKeepFloatingCardAtAnchor({ anchorTop, anchorBottom, viewportTop, viewportBottom }) ||
    !Number.isFinite(cardHeight)
  ) {
    return null;
  }

  const resolvedAnchorBottom = Number.isFinite(anchorBottom) ? anchorBottom : anchorTop;
  if (resolvedAnchorBottom < viewportTop) {
    return Math.min(anchorTop, viewportTop - cardHeight - 1);
  }

  return anchorTop;
};

export const shouldMountFloatingCommentDialog = ({ id, visibleIds, activeCommentInstanceId }) => {
  if (!id) {
    return false;
  }

  if (id === 'pending') {
    return true;
  }

  if (activeCommentInstanceId != null && String(id) === String(activeCommentInstanceId)) {
    return true;
  }

  if (visibleIds?.has?.(id)) {
    return true;
  }

  return false;
};

/**
 * Pick a stable surviving card when an active review row is removed.
 * Continue forward in review order when possible, then fall back backward.
 *
 * @param {object} input
 * @param {readonly string[]} input.previousIds Ordered IDs before removal.
 * @param {ReadonlySet<string>} input.currentIds IDs that still exist.
 * @param {string} input.removedId Removed active card ID.
 * @returns {string | null}
 */
export const resolveRemovedReviewCardContinuityTarget = ({ previousIds, currentIds, removedId }) => {
  if (!Array.isArray(previousIds) || !(currentIds instanceof Set) || !removedId) return null;

  const removedIndex = previousIds.indexOf(removedId);
  if (removedIndex < 0) return null;

  for (let index = removedIndex + 1; index < previousIds.length; index += 1) {
    const candidateId = previousIds[index];
    if (currentIds.has(candidateId)) return candidateId;
  }

  for (let index = removedIndex - 1; index >= 0; index -= 1) {
    const candidateId = previousIds[index];
    if (currentIds.has(candidateId)) return candidateId;
  }

  return null;
};
