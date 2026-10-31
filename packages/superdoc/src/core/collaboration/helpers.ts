import type * as Y from 'yjs';
import useComment, { type UseCommentParams } from '../../components/CommentsLayer/use-comment';
import { actorIdentitiesMatch, type CommentEvent } from '@superdoc/common';
import type { SuperDoc } from '../SuperDoc.js';
import type { Modules, User } from '../types/index.js';

import { addYComment, updateYComment, deleteYComment, type CollaborationCommentEvent } from './collaboration-comments';

type PropertyBag = Readonly<Record<string, unknown>>;

type CollaborationCommentRow = {
  commentId?: unknown;
  importedId?: unknown;
  trackedChange?: unknown;
};

type CollaborationCommentsStore = {
  commentsList: CollaborationCommentRow[];
  hasSyncedCollaborationComments: boolean;
};

type CommentsSyncHost = {
  isCollaborative?: boolean;
  ydoc?: Y.Doc;
  config?: { modules?: Modules; user?: User };
};

type CommentsSyncEvent = CollaborationCommentEvent & { type: CommentEvent };

const isPropertyBag = (value: unknown): value is PropertyBag =>
  (typeof value === 'object' && value !== null) || typeof value === 'function';

const readCommentsStore = (superdoc: SuperDoc): CollaborationCommentsStore | undefined => superdoc['commentsStore'];

const isV2ReviewRuntimeActive = (superdoc: SuperDoc) =>
  superdoc.activeEditor?.editorVersion === 2 || superdoc.editorVersion === 2;

const commentKey = (comment: CollaborationCommentRow) => {
  const key = comment.commentId ?? comment.importedId;
  return key == null ? null : String(key);
};

const preserveLocalV2TrackedChangeRows = (
  superdoc: SuperDoc,
  commentsStore: CollaborationCommentsStore,
  incomingComments: PropertyBag[],
) => {
  if (!isV2ReviewRuntimeActive(superdoc)) return [];
  const currentRows = commentsStore.commentsList;
  if (!Array.isArray(currentRows) || !currentRows.length) return [];
  const incomingKeys = new Set(incomingComments.map(commentKey).filter(Boolean));
  return currentRows.filter((row) => {
    if (row?.trackedChange !== true) return false;
    const key = commentKey(row);
    return !key || !incomingKeys.has(key);
  });
};

export const loadCommentsFromYdoc = (superdoc: SuperDoc | null | undefined): boolean => {
  if (!superdoc?.ydoc) return false;
  const commentsStore = readCommentsStore(superdoc);
  if (!commentsStore) return false;
  const commentsArray = superdoc.ydoc.getArray<unknown>('comments');
  const comments: unknown[] = commentsArray.toJSON();
  const seenCommentIdByKey = new Map<unknown, unknown>();
  const filtered: PropertyBag[] = [];
  comments.forEach((c) => {
    if (!isPropertyBag(c)) return;
    const key = c.importedId ?? c.commentId;
    if (!key) return;
    if (seenCommentIdByKey.has(key)) {
      const existingCommentId = seenCommentIdByKey.get(key);
      const currentCommentId = c.commentId;

      if (existingCommentId && currentCommentId && existingCommentId !== currentCommentId) {
        console.warn(
          `[SuperDoc] Duplicate collaboration comment key "${key}" detected with conflicting commentId values. Keeping first entry and dropping duplicate.`,
          {
            key,
            keptCommentId: existingCommentId,
            droppedCommentId: currentCommentId,
          },
        );
      }
      return;
    }
    seenCommentIdByKey.set(key, c.commentId);
    if (!c.commentId) {
      filtered.push({ ...c, commentId: key });
      return;
    }
    filtered.push(c);
  });
  commentsStore.commentsList = [
    ...filtered.map((c) => useComment(c as UseCommentParams)),
    ...preserveLocalV2TrackedChangeRows(superdoc, commentsStore, filtered),
  ];
  if (superdoc.provider?.synced) {
    commentsStore.hasSyncedCollaborationComments = true;
  }
  return true;
};

export const initCollaborationComments = (superdoc: SuperDoc): void => {
  if (!superdoc.config.modules.comments || !superdoc.provider) return;
  if (superdoc._commentsCollabInitialized) {
    loadCommentsFromYdoc(superdoc);
    return;
  }
  superdoc._commentsCollabInitialized = true;

  const ydoc = superdoc.ydoc;
  if (!ydoc) throw new TypeError('initCollaborationComments requires superdoc.ydoc');
  const commentsArray = ydoc.getArray<unknown>('comments');
  const updateCommentsStore = () => loadCommentsFromYdoc(superdoc);

  const onSuperDocYdocSynced = () => {
    if (!updateCommentsStore()) {
      setTimeout(updateCommentsStore, 0);
    }
    const commentsStore = readCommentsStore(superdoc);
    if (commentsStore) {
      commentsStore.hasSyncedCollaborationComments = true;
    }

    const currentProvider = superdoc.provider;
    if (!currentProvider) throw new TypeError('initCollaborationComments requires superdoc.provider');
    if (typeof currentProvider.off !== 'function') throw new TypeError('superdoc.provider.off is not a function');
    currentProvider.off('synced', onSuperDocYdocSynced);
  };

  const provider = superdoc.provider;
  if (typeof provider.on !== 'function') throw new TypeError('superdoc.provider.on is not a function');
  provider.on('synced', onSuperDocYdocSynced);

  if (!updateCommentsStore()) {
    setTimeout(updateCommentsStore, 0);
  }

  commentsArray.observe((event) => {
    if (!readCommentsStore(superdoc)) return;
    const currentUser = superdoc.config.user;
    const origin: unknown = event?.transaction?.origin;
    const originUser = isPropertyBag(origin) ? origin.user : null;
    const user = isPropertyBag(originUser) ? originUser : null;

    if (actorIdentitiesMatch({ current: currentUser, other: user })) return;

    updateCommentsStore();
  });
};

export const syncCommentsToClients = (superdoc: CommentsSyncHost, event: CommentsSyncEvent): void => {
  if (!superdoc.isCollaborative) return;
  const config = superdoc.config;
  if (!config) throw new TypeError('syncCommentsToClients requires superdoc.config');
  if (!config.modules) throw new TypeError('syncCommentsToClients requires superdoc.config.modules');
  if (!config.modules.comments) return;

  const ydoc = superdoc.ydoc;
  if (!ydoc) throw new TypeError('syncCommentsToClients requires superdoc.ydoc');
  const yArray = ydoc.getArray<unknown>('comments');
  const user = config.user;

  switch (event.type) {
    case 'add':
      addYComment(yArray, ydoc, event, user);
      break;
    case 'update':
      updateYComment(yArray, ydoc, event, user);
      break;
    case 'resolved':
      updateYComment(yArray, ydoc, event, user);
      break;
    case 'deleted':
      deleteYComment(yArray, ydoc, event, user);
      break;
  }
};
