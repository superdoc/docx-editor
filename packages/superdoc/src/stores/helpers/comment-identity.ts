import { computed, isReactive } from 'vue';
import { isV2SyntheticTrackedChangeRow } from '../../core/v2-integration/v2-integration.js';
import { trackedChangeThreadParentIdForComment as resolveTrackedChangeThreadParentId } from '../../components/CommentsLayer/tracked-change-threading.js';
import {
  buildTrackedChangeImportedPositionId,
  getTrackedChangeStoryKey,
  makeTrackedChangeAnchorKey,
  normalizeCommentId,
  normalizeTrackedChangePositionAliases,
  normalizeTrackedChangeStoryKey,
  positionEntryMatchesTrackedChangeStory,
} from './tracked-change-identity.js';

export type CommentIdentityRow = Record<string, unknown>;

type PositionBounds = { left?: number; right?: number; top?: number; bottom?: number };

export type CommentPositionEntry = {
  key?: unknown;
  threadId?: unknown;
  kind?: string;
  storyKey?: string;
  pageIndex?: number | null;
  start?: number;
  end?: number;
  bounds?: PositionBounds | null;
} | null;

export type CommentPositions = Record<string, CommentPositionEntry | undefined>;

type PositionMatch = { key: string; entry: CommentPositionEntry } | { key: null; entry: null };

type CommentIdentitySources = {
  getComments: () => CommentIdentityRow[];
  getReviewDirectory: () => CommentIdentityRow[];
  getPositions: () => CommentPositions | null | undefined;
};

type CommentReference = CommentIdentityRow | string | number | null | undefined;

const NO_POSITION_MATCH: PositionMatch = { key: null, entry: null };

const isOptionalString = (value: unknown): value is string | null | undefined =>
  value == null || typeof value === 'string';

const isNonEmptyString = (value: string | null): value is string => Boolean(value);

const boundsOverlap = (a: PositionBounds | null | undefined, b: PositionBounds | null | undefined): boolean => {
  if (!a || !b) return false;
  const left = Math.max(Number(a.left), Number(b.left));
  const right = Math.min(Number(a.right), Number(b.right));
  const top = Math.max(Number(a.top), Number(b.top));
  const bottom = Math.min(Number(a.bottom), Number(b.bottom));
  return [left, right, top, bottom].every(Number.isFinite) && right > left && bottom > top;
};

const isEquivalentTrackedChangePosition = (
  candidate: CommentPositionEntry | undefined,
  existing: CommentPositionEntry | undefined,
): boolean => {
  if (!candidate || !existing) return false;
  if (candidate.kind !== 'trackedChange' || existing.kind !== 'trackedChange') return false;
  if (candidate.storyKey && existing.storyKey && candidate.storyKey !== existing.storyKey) return false;
  const candidatePage = Number(candidate.pageIndex);
  const existingPage = Number(existing.pageIndex);
  if (Number.isFinite(candidatePage) && Number.isFinite(existingPage) && candidatePage !== existingPage) {
    return false;
  }

  if (boundsOverlap(candidate.bounds, existing.bounds)) return true;

  const candidateStart = Number(candidate.start);
  const candidateEnd = Number(candidate.end);
  const existingStart = Number(existing.start);
  const existingEnd = Number(existing.end);
  return (
    [candidateStart, candidateEnd, existingStart, existingEnd].every(Number.isFinite) &&
    candidateStart === existingStart &&
    candidateEnd === existingEnd
  );
};

export const trackedChangeThreadParentIdForComment = (comment: CommentIdentityRow | null | undefined): unknown => {
  if (comment?.trackedChangeThreadParentId) return comment.trackedChangeThreadParentId;
  if (isV2SyntheticTrackedChangeRow(comment) && comment?.trackedChange === true) return null;
  return resolveTrackedChangeThreadParentId(comment);
};

export const createCommentIdentity = ({ getComments, getReviewDirectory, getPositions }: CommentIdentitySources) => {
  const currentPositions = (): CommentPositions => getPositions() || {};

  const positionEntriesByAlias = computed(() => {
    const aliases = new Map<string, PositionMatch>();
    for (const [key, entry] of Object.entries(currentPositions())) {
      for (const alias of [normalizeCommentId(entry?.key), normalizeCommentId(entry?.threadId)]) {
        if (alias && !aliases.has(alias)) aliases.set(alias, { key, entry: entry ?? null });
      }
    }
    return aliases;
  });

  const getPositionEntryByAlias = (id: unknown): PositionMatch => {
    const normalizedId = normalizeCommentId(id);
    if (!normalizedId) return NO_POSITION_MATCH;

    const positions = currentPositions();
    const direct = positions[normalizedId];
    if (direct !== undefined) {
      return { key: normalizedId, entry: direct };
    }

    return positionEntriesByAlias.value.get(normalizedId) ?? NO_POSITION_MATCH;
  };

  const getTrackedChangeCommentByPositionAlias = (id: unknown): CommentIdentityRow | null => {
    const { entry: targetEntry } = getPositionEntryByAlias(id);
    if (!targetEntry) return null;

    const matches = getComments().filter((comment) => {
      if (!comment?.trackedChange) return false;

      return getCommentAliasIds(comment).some((alias) => {
        const { entry } = getPositionEntryByAlias(alias);
        return isEquivalentTrackedChangePosition(targetEntry, entry);
      });
    });

    return matches.length === 1 ? matches[0] : null;
  };

  const commentIdentityIndex = computed(() => {
    const list = getComments();
    if (!isReactive(list)) return null;
    const primary = new Map<string, CommentIdentityRow>();
    const aliases = new Map<string, CommentIdentityRow>();
    for (const comment of list) {
      if (!isReactive(comment)) return null;
      for (const key of ['commentId', 'importedId', 'trackedChangeAnchorKey', 'trackedChange']) {
        const descriptor = Object.getOwnPropertyDescriptor(comment, key);
        if (descriptor?.get || descriptor?.set || (!descriptor && key in comment)) return null;
      }
      const { commentId, importedId, trackedChangeAnchorKey } = comment;
      if (!isOptionalString(commentId) || !isOptionalString(importedId) || !isOptionalString(trackedChangeAnchorKey)) {
        return null;
      }
      if (commentId != null && !primary.has(commentId)) primary.set(commentId, comment);
      const importedPositionId = comment.trackedChange ? buildTrackedChangeImportedPositionId(importedId) : null;
      for (const alias of [importedId, trackedChangeAnchorKey, importedPositionId]) {
        if (alias != null && !aliases.has(alias)) aliases.set(alias, comment);
      }
    }
    return { primary, aliases };
  });

  const getComment = (id: unknown): CommentIdentityRow | null => {
    if (id === undefined || id === null) return null;
    const byPrimaryId = (c: CommentIdentityRow) => c.commentId == id;
    const byAliasId = (c: CommentIdentityRow) =>
      c.importedId == id ||
      c.trackedChangeAnchorKey == id ||
      (c?.trackedChange && buildTrackedChangeImportedPositionId(c.importedId) == id);
    const findIn = (list: CommentIdentityRow[]) => list.find(byPrimaryId) ?? list.find(byAliasId);
    const lookupIndexed = (key: string) => {
      const index = commentIdentityIndex.value;
      return index ? (index.primary.get(key) ?? index.aliases.get(key)) : findIn(getComments());
    };
    const comment = typeof id === 'string' ? lookupIndexed(id) : findIn(getComments());
    return comment ?? findIn(getReviewDirectory()) ?? getTrackedChangeCommentByPositionAlias(id);
  };

  const getThreadParent = (comment: CommentIdentityRow | null | undefined): CommentIdentityRow | null | undefined => {
    if (!comment?.parentCommentId) return comment;
    return getComment(comment.parentCommentId);
  };

  const getCommentPositionKey = (commentOrId: CommentIdentityRow | string | null | undefined): unknown => {
    if (!commentOrId) return null;

    const positions = currentPositions();

    if (typeof commentOrId === 'string' && positions[commentOrId]) return commentOrId;
    const comment = typeof commentOrId === 'string' ? getComment(commentOrId) : commentOrId;
    if (!comment) return typeof commentOrId === 'string' ? commentOrId : null;

    const commentId = comment.commentId ?? null;
    const importedId = comment.importedId ?? null;
    const importedPositionId = comment.trackedChange ? buildTrackedChangeImportedPositionId(importedId) : null;
    const trackedChangeAnchorKey = comment.trackedChangeAnchorKey ?? null;
    for (const key of [trackedChangeAnchorKey, commentId, importedId, importedPositionId]) {
      if (key && positions[String(key)]) return key;
    }
    return trackedChangeAnchorKey ?? commentId ?? importedPositionId ?? importedId ?? null;
  };

  const getCommentAliasIds = (commentOrId: CommentReference): string[] => {
    if (commentOrId === undefined || commentOrId === null) return [];

    const rawId = typeof commentOrId === 'object' ? null : commentOrId;
    const comment = typeof commentOrId === 'object' ? commentOrId : getComment(commentOrId);
    const trackedChangePositionAliases = comment?.trackedChange
      ? normalizeTrackedChangePositionAliases(comment?.trackedChangePositionAliases)
      : [];
    const trackedChangeStoryKey = normalizeTrackedChangeStoryKey(getTrackedChangeStoryKey(comment));
    const seen = new Set<string>();

    return [
      rawId,
      getCommentPositionKey(comment),
      comment?.trackedChangeAnchorKey,
      comment?.commentId,
      comment?.importedId,
      comment?.trackedChange ? buildTrackedChangeImportedPositionId(comment?.importedId) : null,
      ...trackedChangePositionAliases.flatMap((id) => [
        trackedChangeStoryKey && !id.startsWith('tc::')
          ? makeTrackedChangeAnchorKey({ storyKey: trackedChangeStoryKey, rawId: id })
          : null,
        id,
      ]),
    ]
      .map((id) => normalizeCommentId(id))
      .filter((id): id is string => {
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
  };

  const resolveCommentPositionEntry = (commentOrId: CommentReference, preferredId?: unknown): PositionMatch => {
    const positions = currentPositions();
    const comment = typeof commentOrId === 'object' ? commentOrId : getComment(commentOrId);
    const seen = new Set<string>();

    for (const key of [preferredId, ...getCommentAliasIds(commentOrId)]
      .map((id) => normalizeCommentId(id))
      .filter(isNonEmptyString)) {
      if (seen.has(key)) continue;
      seen.add(key);

      const entry = positions[key];
      if (entry !== undefined && positionEntryMatchesTrackedChangeStory(entry, comment)) {
        return { key, entry };
      }
    }

    return NO_POSITION_MATCH;
  };

  return { getComment, getThreadParent, getCommentPositionKey, getCommentAliasIds, resolveCommentPositionEntry };
};
