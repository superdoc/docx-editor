import type { Array as YArray, Doc as YDoc } from 'yjs';
import type { User } from '../types/index.js';
import { isPlainObject } from '../../helpers/object-guards.js';
import { createCollaborationCommentMap } from './collaboration-comment-map.js';

export type CollaborationCommentEvent = {
  comment: unknown;
};

const readComment = (event: CollaborationCommentEvent): Record<string, unknown> => {
  const { comment } = event;
  if (!isPlainObject(comment)) throw new TypeError('Collaboration comment events require a comment object');
  return comment;
};

export const addYComment = (
  yArray: YArray<unknown>,
  ydoc: YDoc,
  event: CollaborationCommentEvent,
  user: User | undefined,
): void => {
  const comment = readComment(event);
  const yComment = createCollaborationCommentMap(Object.entries(comment));

  ydoc.transact(
    () => {
      yArray.push([yComment]);
    },
    { user },
  );
};

export const updateYComment = (
  yArray: YArray<unknown>,
  ydoc: YDoc,
  event: CollaborationCommentEvent,
  user: User | undefined,
): void => {
  const comment = readComment(event);
  const yComment = createCollaborationCommentMap(Object.entries(comment));
  const commentIndex = getCommentIndex(yArray, comment);
  if (commentIndex === -1) return;

  ydoc.transact(
    () => {
      yArray.delete(commentIndex, 1);
      yArray.insert(commentIndex, [yComment]);
    },
    { user },
  );
};

export const deleteYComment = (
  yArray: YArray<unknown>,
  ydoc: YDoc,
  event: CollaborationCommentEvent,
  user: User | undefined,
): void => {
  const comment = readComment(event);
  const commentIndex = getCommentIndex(yArray, comment);
  if (commentIndex === -1) return;

  ydoc.transact(
    () => {
      yArray.delete(commentIndex, 1);
    },
    { user },
  );
};

export const getCommentIndex = (yArray: YArray<unknown>, comment: Record<string, unknown>): number => {
  const baseArray: unknown[] = yArray.toJSON();
  return baseArray.findIndex((c) => isPlainObject(c) && c.commentId === comment.commentId);
};
