import { normalizeCommentId, normalizeTrackedChangePositionAliases } from './tracked-change-identity.js';

export type CompactableTrackedChangeRow = {
  commentId?: unknown;
  importedId?: unknown;
  trackedChangeCanonicalId?: unknown;
  trackedChangeAnchorKey?: unknown;
  trackedChangePositionAliases?: unknown;
  resolvedTime?: unknown;
  resolvedById?: unknown;
  resolvedByEmail?: unknown;
  resolvedByName?: unknown;
  trackedChangeDecision?: unknown;
};

const isPresentId = (id: string | null): id is string => Boolean(id);

// SD-4689: One logical body tracked change must produce one sidebar card.
export const getBodyTrackedChangeIdentityIds = (comment: CompactableTrackedChangeRow): string[] => {
  const commentId = normalizeCommentId(comment.commentId);
  const canonicalId = normalizeCommentId(comment.trackedChangeCanonicalId);
  return [
    commentId,
    ...(!canonicalId
      ? [
          comment.importedId,
          comment.trackedChangeAnchorKey,
          ...normalizeTrackedChangePositionAliases(comment.trackedChangePositionAliases),
        ]
      : []),
  ]
    .map((id) => normalizeCommentId(id))
    .filter(isPresentId);
};

export const groupBodyTrackedChangeCommentsByIdentity = <Row extends CompactableTrackedChangeRow>(
  comments: readonly Row[],
): Map<number, Row[]> => {
  const parents = comments.map((_, index) => index);
  const findRoot = (index: number): number => {
    let root = index;
    while (parents[root] !== root) root = parents[root];
    while (parents[index] !== index) {
      const next = parents[index];
      parents[index] = root;
      index = next;
    }
    return root;
  };
  const join = (left: number, right: number): void => {
    const leftRoot = findRoot(left);
    const rightRoot = findRoot(right);
    if (leftRoot === rightRoot) return;
    parents[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
  };
  const identityOwner = new Map<string, number>();
  comments.forEach((comment, index) => {
    getBodyTrackedChangeIdentityIds(comment).forEach((identityId) => {
      const owner = identityOwner.get(identityId);
      if (owner === undefined) identityOwner.set(identityId, index);
      else join(index, owner);
    });
  });
  const groups = new Map<number, Row[]>();
  comments.forEach((comment, index) => {
    const root = findRoot(index);
    const group = groups.get(root) ?? [];
    group.push(comment);
    groups.set(root, group);
  });
  return groups;
};

export const mergeDuplicateBodyTrackedChangeComments = <Row extends CompactableTrackedChangeRow>(
  groups: ReadonlyMap<number, readonly Row[]>,
): Map<Row, Row> => {
  const duplicates = new Map<Row, Row>();
  groups.forEach(([survivor, ...duplicateRows]) => {
    if (!survivor || duplicateRows.length === 0) return;
    const resolvedDuplicate = duplicateRows.find((comment) => comment.resolvedTime != null);
    if (survivor.resolvedTime == null && resolvedDuplicate) {
      survivor.resolvedTime = resolvedDuplicate.resolvedTime;
      survivor.resolvedById = resolvedDuplicate.resolvedById;
      survivor.resolvedByEmail = resolvedDuplicate.resolvedByEmail;
      survivor.resolvedByName = resolvedDuplicate.resolvedByName;
      survivor.trackedChangeDecision = resolvedDuplicate.trackedChangeDecision;
    }
    survivor.trackedChangePositionAliases = normalizeTrackedChangePositionAliases([
      ...normalizeTrackedChangePositionAliases(survivor.trackedChangePositionAliases),
      ...duplicateRows.flatMap((comment) => [
        comment.commentId,
        comment.importedId,
        comment.trackedChangeCanonicalId,
        ...normalizeTrackedChangePositionAliases(comment.trackedChangePositionAliases),
      ]),
    ]);
    duplicateRows.forEach((comment) => duplicates.set(comment, survivor));
  });
  return duplicates;
};

export const createDroppedCommentIdMap = <Row extends CompactableTrackedChangeRow>(
  duplicates: ReadonlyMap<Row, Row>,
): Map<string, string> => {
  const droppedCommentIds = new Map<string, string>();
  duplicates.forEach((survivor, duplicate) => {
    const fromId = normalizeCommentId(duplicate.commentId);
    const toId = normalizeCommentId(survivor.commentId);
    if (fromId && toId) droppedCommentIds.set(fromId, toId);
  });
  return droppedCommentIds;
};
