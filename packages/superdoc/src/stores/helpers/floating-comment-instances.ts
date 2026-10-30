import { isFiniteNumber } from '../../helpers/is-finite-number.js';
import { isPlainObject } from '../../helpers/object-guards.js';

const HEADER_FOOTER_TRACKED_CHANGE_STORY_TYPE = 'headerFooterPart';

type FloatingCommentRect = {
  pageIndex?: number | null;
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
};

type FloatingCommentBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type FloatingCommentPositionEntry = {
  pageIndex?: number | null;
  rects?: readonly (FloatingCommentRect | null | undefined)[] | null;
  bounds?: Partial<FloatingCommentBounds> | null;
};

type FloatingCommentSource = {
  commentId?: string | null;
  trackedChange?: boolean | null;
  trackedChangeStory?: string | { storyType?: unknown } | null;
  trackedChangeCanonicalId?: string | null;
  trackedChangePositionAliases?: readonly unknown[] | null;
  selection?: { page?: unknown } | null;
};

type FloatingCommentInstance<TComment extends FloatingCommentSource = FloatingCommentSource> = {
  id: string;
  threadId: string | null;
  comment: TComment;
  positionKey: string | null;
  positionEntry: FloatingCommentPositionEntry | null;
  pageIndex: number | null;
  isPrimary: boolean;
};

type BuildFloatingCommentInstancesParams<TComment extends FloatingCommentSource> = {
  comment: TComment;
  positionKey: string | null;
  positionEntry: FloatingCommentPositionEntry | null;
  fallbackId: string | null;
};

type PageRectGroup = { pageIndex: number; rects: FloatingCommentRect[] };

const toFinitePageIndex = (value: unknown): number | null => {
  return isFiniteNumber(value) ? value : null;
};

const buildPageScopedInstanceId = (positionKey: string, pageIndex: number): string => {
  return `${positionKey}::page:${pageIndex}`;
};

const matchesTrackedChangePositionAlias = (positionKey: string, alias: unknown): boolean => {
  const normalizedPositionKey = String(positionKey);
  const normalizedAlias = String(alias);
  return (
    normalizedPositionKey === normalizedAlias ||
    (normalizedPositionKey.startsWith('tc::') && normalizedPositionKey.endsWith(`::${normalizedAlias}`))
  );
};

const aggregateRectBounds = (rects: readonly FloatingCommentRect[]): FloatingCommentBounds | null => {
  if (!Array.isArray(rects) || rects.length === 0) {
    return null;
  }

  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  rects.forEach((rect) => {
    if (
      !isFiniteNumber(rect?.left) ||
      !isFiniteNumber(rect.top) ||
      !isFiniteNumber(rect.right) ||
      !isFiniteNumber(rect.bottom)
    ) {
      return;
    }

    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  });

  if (![left, top, right, bottom].every(Number.isFinite)) {
    return null;
  }

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
};

const groupRectsByPage = (rects: FloatingCommentPositionEntry['rects']): PageRectGroup[] => {
  const groupedRects = new Map<number, FloatingCommentRect[]>();

  const geometryRects = Array.isArray(rects) ? rects : [];
  geometryRects.forEach((rect) => {
    const pageIndex = toFinitePageIndex(rect?.pageIndex);
    if (!rect || pageIndex == null) {
      return;
    }

    const pageRects = groupedRects.get(pageIndex);
    if (pageRects) {
      pageRects.push(rect);
      return;
    }

    groupedRects.set(pageIndex, [rect]);
  });

  return [...groupedRects.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([pageIndex, pageRects]) => ({ pageIndex, rects: pageRects }));
};

const readStoryType = (story: FloatingCommentSource['trackedChangeStory']): unknown => {
  return isPlainObject(story) ? story.storyType : undefined;
};

const isRepeatedHeaderFooterTrackedChange = (
  comment: FloatingCommentSource,
  positionEntry: FloatingCommentPositionEntry | null,
): boolean => {
  if (!comment?.trackedChange) {
    return false;
  }

  if (readStoryType(comment?.trackedChangeStory) !== HEADER_FOOTER_TRACKED_CHANGE_STORY_TYPE) {
    return false;
  }

  return groupRectsByPage(positionEntry?.rects).length > 1;
};

const resolveSelectionPageIndex = (comment: FloatingCommentSource): number | null => {
  const page = Number(comment?.selection?.page);
  if (!Number.isInteger(page) || page < 1) return null;
  return page - 1;
};

const buildSingleFloatingCommentInstance = <TComment extends FloatingCommentSource>({
  id,
  threadId,
  comment,
  positionKey,
  positionEntry,
}: {
  id: string;
  threadId: string | null;
  comment: TComment;
  positionKey: string | null;
  positionEntry: FloatingCommentPositionEntry | null;
}): FloatingCommentInstance<TComment> => {
  const geometryPageIndex = toFinitePageIndex(positionEntry?.pageIndex);
  const fallbackPageIndex = comment?.trackedChange ? null : resolveSelectionPageIndex(comment);
  const pageIndex = geometryPageIndex ?? fallbackPageIndex;

  return {
    id,
    threadId,
    comment,
    positionKey,
    positionEntry: positionEntry ?? null,
    pageIndex,
    isPrimary: true,
  };
};

const buildRepeatedHeaderFooterInstances = <TComment extends FloatingCommentSource>({
  comment,
  positionKey,
  positionEntry,
  primaryInstanceId,
}: {
  comment: TComment;
  positionKey: string;
  positionEntry: FloatingCommentPositionEntry | null;
  primaryInstanceId: string;
}): FloatingCommentInstance<TComment>[] => {
  const rectGroups = groupRectsByPage(positionEntry?.rects);
  if (rectGroups.length < 2) {
    return [];
  }

  const renderableGroups = rectGroups.flatMap(({ pageIndex, rects }) => {
    const bounds = aggregateRectBounds(rects);
    return bounds ? [{ pageIndex, rects, bounds }] : [];
  });
  if (renderableGroups.length < 2) {
    return [];
  }

  const geometryPageIndex = toFinitePageIndex(positionEntry?.pageIndex);
  const primaryPageIndex = renderableGroups.some(({ pageIndex }) => pageIndex === geometryPageIndex)
    ? geometryPageIndex
    : (renderableGroups[0]?.pageIndex ?? null);

  return renderableGroups.map(({ pageIndex, rects, bounds }) => {
    const isPrimary = pageIndex === primaryPageIndex;

    return {
      id: isPrimary ? primaryInstanceId : buildPageScopedInstanceId(primaryInstanceId, pageIndex),
      threadId: comment?.commentId ?? positionKey,
      comment,
      positionKey,
      pageIndex,
      isPrimary,
      positionEntry: {
        ...positionEntry,
        pageIndex,
        rects,
        bounds,
      },
    };
  });
};

export const buildFloatingCommentInstances = <TComment extends FloatingCommentSource>({
  comment,
  positionKey,
  positionEntry,
  fallbackId,
}: BuildFloatingCommentInstancesParams<TComment>): FloatingCommentInstance<TComment>[] => {
  const aliases = comment?.trackedChangePositionAliases;
  const hasTrackedChangePositionAlias =
    comment?.trackedChange &&
    positionKey &&
    fallbackId &&
    Array.isArray(aliases) &&
    aliases.some((alias) => matchesTrackedChangePositionAlias(positionKey, alias));
  const hasSharedTrackedChangeAnchor =
    comment?.trackedChange &&
    comment?.trackedChangeCanonicalId &&
    positionKey &&
    fallbackId &&
    String(positionKey) !== String(fallbackId);
  const instanceId =
    hasTrackedChangePositionAlias || hasSharedTrackedChangeAnchor ? fallbackId : (positionKey ?? fallbackId);
  if (!instanceId) {
    return [];
  }

  if (isRepeatedHeaderFooterTrackedChange(comment, positionEntry) && positionKey) {
    const repeatedInstances = buildRepeatedHeaderFooterInstances({
      comment,
      positionKey,
      positionEntry,
      primaryInstanceId: instanceId,
    });
    if (repeatedInstances.length > 0) {
      return repeatedInstances;
    }
  }

  return [
    buildSingleFloatingCommentInstance({
      id: instanceId,
      threadId: comment?.commentId ?? fallbackId,
      comment,
      positionKey,
      positionEntry,
    }),
  ];
};
