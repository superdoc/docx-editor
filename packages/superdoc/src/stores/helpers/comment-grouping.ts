import { buildTrackedChangeThreadOwnerIndex } from './tracked-change-thread-index.js';

type CommentId = string | number;

export type GroupableComment = {
  commentId: CommentId;
  fileId?: CommentId | null;
  parentCommentId?: CommentId | null;
  threadingParentCommentId?: CommentId | null;
  trackedChange?: boolean;
  trackedChangeCanonicalId?: CommentId | null;
  trackedChangeSide?: string | null;
  trackedChangeParentId?: CommentId | null;
  trackedChangeThreadParentId?: CommentId | null;
  semanticColorKey?: string | null;
  createdTime?: number | null;
  resolvedTime?: number | null;
};

type GroupedComments<Comment> = {
  parentComments: Comment[];
  resolvedComments: Comment[];
};

type CommittedReviewPresentation = {
  groupOrder: { open: readonly CommentId[]; resolved: readonly CommentId[] };
};

type CommittedReviewPresentations = Readonly<Record<string, CommittedReviewPresentation | undefined>>;

const compareByCreatedTime = (a: GroupableComment, b: GroupableComment): number =>
  (a.createdTime ?? 0) - (b.createdTime ?? 0);

export const groupComments = <Comment extends GroupableComment>(
  source: readonly Comment[],
  isVisible: (comment: Comment) => boolean,
): GroupedComments<Comment> => {
  const parentComments: Comment[] = [];
  const resolvedComments: Comment[] = [];
  const trackedChangeThreadOwnerIndex = buildTrackedChangeThreadOwnerIndex(source);

  for (const comment of source) {
    if (!isVisible(comment)) continue;
    const trackedChangeThreadParentId = trackedChangeThreadOwnerIndex.get(comment)?.commentId ?? null;
    const parentId = comment.trackedChange ? null : comment.parentCommentId || trackedChangeThreadParentId;
    if (comment.resolvedTime) resolvedComments.push(comment);
    else if (!parentId) parentComments.push({ ...comment });
  }

  return {
    parentComments: parentComments.sort(compareByCreatedTime),
    resolvedComments: resolvedComments.sort(compareByCreatedTime),
  };
};

const rowKey = (documentId: string, commentId: CommentId): string => JSON.stringify([documentId, String(commentId)]);

export const groupCommittedComments = <Comment extends GroupableComment>(
  comments: readonly Comment[],
  presentations: CommittedReviewPresentations,
  isVisible: (comment: Comment) => boolean,
): GroupedComments<Comment> => {
  if (!Object.keys(presentations).length) return groupComments(comments, isVisible);
  const rows = new Map(comments.map((row) => [rowKey(String(row.fileId), row.commentId), row]));
  const visibleRowsInOrder = (documentId: string, ids: readonly CommentId[]): Comment[] =>
    ids.flatMap((id) => {
      const row = rows.get(rowKey(documentId, id));
      return row && isVisible(row) ? [row] : [];
    });

  const grouped = groupComments(
    comments.filter((row) => !presentations[String(row.fileId)]),
    isVisible,
  );
  for (const [documentId, presentation] of Object.entries(presentations)) {
    if (!presentation) continue;
    grouped.parentComments.push(...visibleRowsInOrder(documentId, presentation.groupOrder.open));
    grouped.resolvedComments.push(...visibleRowsInOrder(documentId, presentation.groupOrder.resolved));
  }
  return grouped;
};

export const hasOpenTrackedChange = ({ parentComments }: GroupedComments<GroupableComment>): boolean =>
  parentComments.some((comment) => comment.trackedChange && !comment.resolvedTime);
