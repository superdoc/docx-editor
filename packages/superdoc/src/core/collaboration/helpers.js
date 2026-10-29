import useComment from '../../components/CommentsLayer/use-comment';
import { actorIdentitiesMatch } from '@superdoc/common';

import { addYComment, updateYComment, deleteYComment } from './collaboration-comments';

const isV2ReviewRuntimeActive = (superdoc) =>
  superdoc?.activeEditor?.editorVersion === 2 || superdoc?.editorVersion === 2;

const commentKey = (comment) => {
  const key = comment?.commentId ?? comment?.importedId;
  return key == null ? null : String(key);
};

const preserveLocalV2TrackedChangeRows = (superdoc, incomingComments) => {
  if (!isV2ReviewRuntimeActive(superdoc)) return [];
  const currentRows = superdoc?.commentsStore?.commentsList;
  if (!Array.isArray(currentRows) || !currentRows.length) return [];
  const incomingKeys = new Set(incomingComments.map(commentKey).filter(Boolean));
  return currentRows.filter((row) => {
    if (row?.trackedChange !== true) return false;
    const key = commentKey(row);
    return !key || !incomingKeys.has(key);
  });
};

/**
 * Load comments from the ydoc into the comments store.
 *
 * @param {Object} superdoc The SuperDoc instance
 * @returns {boolean} True if comments were loaded into the store
 */
export const loadCommentsFromYdoc = (superdoc) => {
  if (!superdoc?.ydoc || !superdoc?.commentsStore) return false;
  const commentsArray = superdoc.ydoc.getArray('comments');
  const comments = commentsArray.toJSON();
  const seenCommentIdByKey = new Map();
  const filtered = [];
  comments.forEach((c) => {
    const key = c?.importedId ?? c?.commentId;
    if (!key) return;
    if (seenCommentIdByKey.has(key)) {
      const existingCommentId = seenCommentIdByKey.get(key);
      const currentCommentId = c?.commentId;

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
    seenCommentIdByKey.set(key, c?.commentId);
    if (!c?.commentId) {
      filtered.push({ ...c, commentId: key });
      return;
    }
    filtered.push(c);
  });
  superdoc.commentsStore.commentsList = [
    ...filtered.map((c) => useComment(c)),
    ...preserveLocalV2TrackedChangeRows(superdoc, filtered),
  ];
  if (superdoc.provider?.synced) {
    superdoc.commentsStore.hasSyncedCollaborationComments = true;
  }
  return true;
};

/**
 * Initialize sync for comments if the module is enabled
 *
 * @param {Object} superdoc The SuperDoc instance
 * @returns {void}
 */
export const initCollaborationComments = (superdoc) => {
  if (!superdoc.config.modules.comments || !superdoc.provider) return;
  if (superdoc._commentsCollabInitialized) {
    loadCommentsFromYdoc(superdoc);
    return;
  }
  superdoc._commentsCollabInitialized = true;

  // If we have comments and collaboration, wait for sync and then let the store know when its ready
  const commentsArray = superdoc.ydoc.getArray('comments');
  const updateCommentsStore = () => loadCommentsFromYdoc(superdoc);

  const onSuperDocYdocSynced = () => {
    if (!updateCommentsStore()) {
      setTimeout(updateCommentsStore, 0);
    }
    // Update the editor comment locations
    if (superdoc.commentsStore) {
      const parent = superdoc.commentsStore.commentsParentElement;
      const ids = superdoc.commentsStore.editorCommentIds;
      superdoc.commentsStore.handleEditorLocationsUpdate(parent, ids);
      superdoc.commentsStore.hasSyncedCollaborationComments = true;
    }

    superdoc.provider.off('synced', onSuperDocYdocSynced);
  };

  // Listen for the synced event
  superdoc.provider.on('synced', onSuperDocYdocSynced);

  // Load any existing comments immediately (in case provider synced before we subscribed)
  if (!updateCommentsStore()) {
    setTimeout(updateCommentsStore, 0);
  }

  // Observe changes to the comments map
  commentsArray.observe((event) => {
    if (!superdoc.commentsStore) return;
    // Ignore events if triggered by the current user
    const currentUser = superdoc.config.user;
    const origin = event?.transaction?.origin;
    const { user = {} } = origin || {};

    if (actorIdentitiesMatch({ current: currentUser, other: user })) return;

    // Update conversations
    updateCommentsStore();
  });
};

/**
 * Sync local comments with ydoc and other clients if in collaboration mode and comments module is enabled
 *
 * @param {Object} superdoc
 * @param {Object} event
 * @returns {void}
 */
export const syncCommentsToClients = (superdoc, event) => {
  if (!superdoc.isCollaborative || !superdoc.config.modules.comments) return;

  const yArray = superdoc.ydoc.getArray('comments');
  const user = superdoc.config.user;

  switch (event.type) {
    case 'add':
      addYComment(yArray, superdoc.ydoc, event, user);
      break;
    case 'update':
      updateYComment(yArray, superdoc.ydoc, event, user);
      break;
    case 'resolved':
      updateYComment(yArray, superdoc.ydoc, event, user);
      break;
    case 'deleted':
      deleteYComment(yArray, superdoc.ydoc, event, user);
      break;
  }
};
