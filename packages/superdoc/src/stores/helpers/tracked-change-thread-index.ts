import { trackedChangeThreadParentIdForComment } from '../../components/CommentsLayer/tracked-change-threading.js';

type CommentId = string | number;

export type TrackedChangeSideGroup = 'source' | 'destination';

type TrackedChangeLinkFields = {
  parentCommentId?: CommentId | null;
  threadingParentCommentId?: CommentId | null;
  trackedChangeParentId?: CommentId | null;
  trackedChangeThreadParentId?: CommentId | null;
};

type TrackedChangeThreadOwnerFields = TrackedChangeLinkFields & {
  commentId: CommentId;
  trackedChange?: boolean;
  trackedChangeCanonicalId?: CommentId | null;
  trackedChangeSide?: string | null;
  semanticColorKey?: string | null;
};

type TrackedChangeThreadFields = TrackedChangeThreadOwnerFields & {
  createdTime?: number;
};

const trackedChangeSideGroup = (side: string | null | undefined): TrackedChangeSideGroup | null => {
  if (side === 'source' || side === 'deleted') return 'source';
  if (side === 'destination' || side === 'inserted') return 'destination';
  return null;
};

export const trackedChangeRowSideGroup = (comment: {
  semanticColorKey?: string | null;
}): TrackedChangeSideGroup | null => {
  if (comment.semanticColorKey === 'move-from') return 'source';
  if (comment.semanticColorKey === 'move-to') return 'destination';
  return null;
};

const append = <Key, Value>(map: Map<Key, Value[]>, key: Key, value: Value): void => {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
};

const nonNullIds = (ids: ReadonlyArray<CommentId | null | undefined>): string[] =>
  ids.filter((id) => id != null).map((id) => String(id));

export const buildTrackedChangeThreadOwnerIndex = <Comment extends TrackedChangeThreadOwnerFields>(
  allComments: ReadonlyArray<Comment>,
): Map<Comment, Comment> => {
  const trackedRowsById = new Map<string, Comment[]>();
  const trackedRowsByCanonicalId = new Map<string, Comment[]>();

  for (const comment of allComments) {
    if (comment.trackedChange !== true) continue;
    if (typeof comment.commentId === 'string') append(trackedRowsById, comment.commentId, comment);
    if (comment.trackedChangeCanonicalId != null) {
      append(trackedRowsByCanonicalId, String(comment.trackedChangeCanonicalId), comment);
    }
  }

  const ownerByComment = new Map<Comment, Comment>();
  for (const comment of allComments) {
    if (comment.trackedChange === true) continue;
    const aliases = new Set(
      nonNullIds([comment.threadingParentCommentId, trackedChangeThreadParentIdForComment(comment)]),
    );
    if (aliases.size === 0) continue;

    const directOwners = [...new Set([...aliases].flatMap((alias) => trackedRowsById.get(alias) ?? []))];
    if (directOwners.length === 1) {
      ownerByComment.set(comment, directOwners[0]);
      continue;
    }
    if (directOwners.length > 1) continue;

    const canonicalOwners = [...new Set([...aliases].flatMap((alias) => trackedRowsByCanonicalId.get(alias) ?? []))];
    if (canonicalOwners.length === 1) {
      ownerByComment.set(comment, canonicalOwners[0]);
      continue;
    }

    const sideGroup = trackedChangeSideGroup(comment.trackedChangeSide);
    if (!sideGroup) continue;
    const sideOwners = canonicalOwners.filter((owner) => trackedChangeRowSideGroup(owner) === sideGroup);
    if (sideOwners.length === 1) ownerByComment.set(comment, sideOwners[0]);
  }

  return ownerByComment;
};

export const buildTrackedChangeThreadIndex = <Comment extends TrackedChangeThreadFields>(
  allComments: ReadonlyArray<Comment>,
  previous: ReadonlyMap<CommentId, ReadonlyArray<Comment>> = new Map(),
): Map<CommentId, ReadonlyArray<Comment>> => {
  const childrenByParentId = new Map<string, Comment[]>();
  const anchoredCommentsByTrackedChangeId = new Map<string, Comment[]>();
  const commentsById = new Map<CommentId, Comment[]>();
  const sourceIndex = new Map<Comment, number>();
  const trackedChangeOwnerByComment = buildTrackedChangeThreadOwnerIndex(allComments);

  allComments.forEach((comment, index) => {
    sourceIndex.set(comment, index);
    append(commentsById, comment.commentId, comment);
    const parentIds = new Set(nonNullIds([comment.parentCommentId, comment.threadingParentCommentId]));
    parentIds.forEach((parentId) => append(childrenByParentId, parentId, comment));
    const owner = trackedChangeOwnerByComment.get(comment);
    if (owner?.commentId != null) {
      append(anchoredCommentsByTrackedChangeId, String(owner.commentId), comment);
    }
  });

  const next = new Map<CommentId, ReadonlyArray<Comment>>();
  for (const parentComment of allComments) {
    if (!parentComment?.trackedChange || parentComment.commentId == null) continue;
    const trackedChangeId = parentComment.commentId;
    const threadIds = new Set<CommentId>([trackedChangeId]);
    const queue: CommentId[] = [];
    const threadParentIds: string[] = [];
    if (typeof trackedChangeId === 'string') {
      threadParentIds.push(trackedChangeId);
    }
    const seed = threadParentIds.flatMap((parentId) => [
      ...(childrenByParentId.get(parentId) ?? []),
      ...(anchoredCommentsByTrackedChangeId.get(parentId) ?? []),
    ]);
    for (const comment of seed) {
      const id = comment.commentId;
      if (id === trackedChangeId || threadIds.has(id)) continue;
      threadIds.add(id);
      queue.push(id);
    }
    for (let index = 0; index < queue.length; index += 1) {
      const parentId = queue[index];
      for (const comment of typeof parentId === 'string' ? (childrenByParentId.get(parentId) ?? []) : []) {
        const id = comment.commentId;
        if (threadIds.has(id)) continue;
        threadIds.add(id);
        queue.push(id);
      }
    }

    const members = [...threadIds]
      .flatMap((id) => commentsById.get(id) ?? [])
      .sort((left, right) => (sourceIndex.get(left) ?? 0) - (sourceIndex.get(right) ?? 0));
    members.sort((left, right) => {
      if (left === parentComment) return -1;
      if (right === parentComment) return 1;
      return Number(left.createdTime) - Number(right.createdTime);
    });
    const prior = previous.get(trackedChangeId);
    const stable =
      prior?.length === members.length && members.every((comment, index) => prior[index] === comment) ? prior : members;
    next.set(trackedChangeId, stable);
  }
  return next;
};

export const buildTrackedChangeDecisionLinkIndex = <Comment extends TrackedChangeLinkFields>(
  allComments: ReadonlyArray<Comment>,
  previous: ReadonlyMap<string, ReadonlyArray<Comment>> = new Map(),
): Map<string, ReadonlyArray<Comment>> => {
  const grouped = new Map<string, Comment[]>();
  for (const comment of allComments) {
    const ids = new Set(
      nonNullIds([
        comment.parentCommentId,
        comment.threadingParentCommentId,
        comment.trackedChangeParentId,
        comment.trackedChangeThreadParentId,
      ]),
    );
    for (const id of ids) append(grouped, id, comment);
  }

  const next = new Map<string, ReadonlyArray<Comment>>();
  for (const [id, comments] of grouped) {
    const prior = previous.get(id);
    next.set(
      id,
      prior?.length === comments.length && comments.every((comment, index) => prior[index] === comment)
        ? prior
        : comments,
    );
  }
  return next;
};
