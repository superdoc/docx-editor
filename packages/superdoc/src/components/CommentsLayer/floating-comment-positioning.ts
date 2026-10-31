import { isFiniteNumber } from '../../helpers/is-finite-number';

type OptionalNumber = number | null | undefined;

type FloatingAnchorGeometry = {
  anchorTop: OptionalNumber;
  anchorBottom?: OptionalNumber;
  viewportTop: OptionalNumber;
  viewportBottom: OptionalNumber;
};

type OffscreenFloatingCardInput = FloatingAnchorGeometry & {
  cardHeight: OptionalNumber;
};

type FloatingCommentDialogMountInput = {
  id: string | null | undefined;
  visibleIds?: ReadonlySet<string> | null;
  activeCommentInstanceId?: string | null;
};

type RemovedReviewCardContinuityInput = {
  previousIds: readonly string[];
  currentIds: ReadonlySet<string>;
  removedId: string | null | undefined;
};

export const isAnchorOutsideFloatingViewport = (
  anchorTop: OptionalNumber,
  viewportTop: OptionalNumber,
  viewportBottom: OptionalNumber,
  anchorBottom: OptionalNumber = anchorTop,
): boolean => {
  if (!isFiniteNumber(anchorTop) || !isFiniteNumber(viewportTop) || !isFiniteNumber(viewportBottom)) {
    return false;
  }

  const resolvedAnchorBottom = isFiniteNumber(anchorBottom) ? anchorBottom : anchorTop;
  return resolvedAnchorBottom < viewportTop || anchorTop > viewportBottom;
};

export const shouldKeepFloatingCardAtAnchor = ({
  anchorTop,
  anchorBottom,
  viewportTop,
  viewportBottom,
}: FloatingAnchorGeometry): boolean => {
  return isAnchorOutsideFloatingViewport(anchorTop, viewportTop, viewportBottom, anchorBottom);
};

export const resolveOffscreenFloatingCardTop = ({
  anchorTop,
  anchorBottom,
  cardHeight,
  viewportTop,
  viewportBottom,
}: OffscreenFloatingCardInput): number | null => {
  if (
    !isFiniteNumber(anchorTop) ||
    !isFiniteNumber(viewportTop) ||
    !isFiniteNumber(cardHeight) ||
    !shouldKeepFloatingCardAtAnchor({ anchorTop, anchorBottom, viewportTop, viewportBottom })
  ) {
    return null;
  }

  const resolvedAnchorBottom = isFiniteNumber(anchorBottom) ? anchorBottom : anchorTop;
  if (resolvedAnchorBottom < viewportTop) {
    return Math.min(anchorTop, viewportTop - cardHeight - 1);
  }

  return anchorTop;
};

export const shouldMountFloatingCommentDialog = ({
  id,
  visibleIds,
  activeCommentInstanceId,
}: FloatingCommentDialogMountInput): boolean => {
  if (!id) {
    return false;
  }

  if (id === 'pending') {
    return true;
  }

  if (activeCommentInstanceId != null && id === activeCommentInstanceId) {
    return true;
  }

  if (visibleIds?.has(id)) {
    return true;
  }

  return false;
};

export const resolveRemovedReviewCardContinuityTarget = ({
  previousIds,
  currentIds,
  removedId,
}: RemovedReviewCardContinuityInput): string | null => {
  if (!removedId) return null;

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
