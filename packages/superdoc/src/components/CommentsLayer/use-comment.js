import { ref, reactive } from 'vue';
import { v4 as uuidv4 } from 'uuid';

import { syncCommentsToClients } from '@superdoc/core/collaboration/helpers.js';
import { comments_module_events } from '@superdoc/common';
import useSelection from '@superdoc/helpers/use-selection';

const getCommentIds = (comment) =>
  [comment?.commentId, comment?.importedId].filter((id) => id != null).map((id) => String(id));

function getThreadDescendants(superdoc, rootComment) {
  const store = superdoc?.commentsStore;
  if (!store) return [];
  const raw = store.commentsList;
  const list = Array.isArray(raw) ? raw : (raw?.value ?? []);
  const threadIds = new Set(getCommentIds(rootComment));
  const descendants = [];
  let expanded = true;

  while (expanded) {
    expanded = false;
    for (const comment of list) {
      if (!comment) continue;
      const ids = getCommentIds(comment);
      if (ids.some((id) => threadIds.has(id))) continue;

      const parentIds = [comment.parentCommentId, comment.threadingParentCommentId]
        .filter((id) => id != null)
        .map((id) => String(id));
      if (!parentIds.some((id) => threadIds.has(id))) continue;

      descendants.push(comment);
      ids.forEach((id) => threadIds.add(id));
      expanded = true;
    }
  }

  return descendants;
}

/**
 * Comment composable
 *
 * @param {Object} params The initial values of the comment
 * @returns {Object} The comment composable
 */
export default function useComment(params) {
  const uid = ref(params.uid);
  const commentId = params.commentId || uuidv4();
  const importedId = params.importedId;
  const parentCommentId = params.parentCommentId;
  const trackedChangeParentId = params.trackedChangeParentId;
  const fileId = params.fileId;
  const fileType = params.fileType;
  const createdAtVersionNumber = params.createdAtVersionNumber;
  const isInternal = ref(params.isInternal !== undefined ? params.isInternal : true);

  const mentions = ref([]);

  const commentElement = ref(null);
  const isFocused = ref(params.isFocused || false);

  const creatorId = ref(params.creatorId ?? null);
  const creatorEmail = ref(params.creatorEmail ?? null);
  const creatorName = ref(params.creatorName ?? null);
  const creatorIdentity = ref(params.creatorIdentity == null ? params.creatorIdentity : { ...params.creatorIdentity });
  const wordAuthorName = ref(params.wordAuthorName);
  const creatorImage = ref(params.creatorImage ?? null);
  const createdTime = ref(params.createdTime || Date.now());
  const importedAuthor = ref(params.importedAuthor || null);
  const docxCommentJSON = ref(params.docxCommentJSON || null);
  const origin = params.origin;
  const threadingMethod = params.threadingMethod;
  const threadingStyleOverride = params.threadingStyleOverride;
  const threadingParentCommentId = params.threadingParentCommentId;
  const originalXmlStructure = params.originalXmlStructure;

  const commentText = ref(params.commentText || '');

  const selection = params.selection
    ? useSelection(params.selection)
    : useSelection({
        documentId: fileId,
        page: 1,
        selectionBounds: {},
      });

  const floatingPosition = params.selection?.selectionBounds
    ? { ...params.selection.selectionBounds }
    : { top: 0, left: 0, right: 0, bottom: 0 };

  // Tracked changes aka suggestions
  const trackedChange = ref(params.trackedChange);
  const trackedChangeType = ref(params.trackedChangeType || null);
  const trackedChangeText = ref(params.trackedChangeText || null);
  const trackedChangeDisplayType = ref(params.trackedChangeDisplayType || null);
  const trackedChangeStory = ref(params.trackedChangeStory || null);
  const trackedChangeStoryKind = ref(params.trackedChangeStoryKind || null);
  const trackedChangeStoryLabel = ref(params.trackedChangeStoryLabel || '');
  const trackedChangeAnchorKey = ref(params.trackedChangeAnchorKey || null);
  const deletedText = ref(params.deletedText || null);

  const resolvedTime = ref(params.resolvedTime || null);
  const resolvedById = ref(params.resolvedById || null);
  const resolvedByEmail = ref(params.resolvedByEmail || null);
  const resolvedByName = ref(params.resolvedByName || null);
  // For tracked-change threads: which decision resolved the thread
  // ('accept' | 'reject'). Null for plain comments and legacy payloads.
  const trackedChangeDecision = ref(params.trackedChangeDecision || null);

  /**
   * Mark this conversation as resolved with UTC date
   *
   * @param {String} id The actor id of the user marking this conversation as done
   * @param {String} email The email of the user marking this conversation as done
   * @param {String} name The name of the user marking this conversation as done
   * @param {'accept' | 'reject'} [decision] The tracked-change decision that resolved this thread
   * @returns {void}
   */
  const resolveComment = ({ id, email, name, superdoc, decision }) => {
    if (resolvedTime.value) return;
    resolvedTime.value = Date.now();
    resolvedById.value = id ?? null;
    resolvedByEmail.value = email;
    resolvedByName.value = name;
    if (decision === 'accept' || decision === 'reject') {
      trackedChangeDecision.value = decision;
    }

    const emitData = { type: comments_module_events.RESOLVED, comment: getValues() };
    propagateUpdate(superdoc, emitData);

    const commands = superdoc.activeEditor?.commands;

    // Tracked-change comments are standalone — resolve only this comment.
    if (trackedChange.value) {
      commands?.resolveComment({ commentId, importedId });
      return;
    }

    // Replies can carry their own reconstructed anchor marks. Convert the
    // whole thread in one editor transaction so resolved text stops rendering
    // as open while the root remains the thread-level resolved state.
    const replies = getThreadDescendants(superdoc, { commentId, importedId });
    if (replies.length && typeof commands?.resolveCommentThread === 'function') {
      commands.resolveCommentThread({
        comments: [
          { commentId, importedId, preserveAnchor: true },
          ...replies.map((reply) => ({
            commentId: reply.commentId,
            importedId: reply.importedId,
            preserveAnchor: false,
          })),
        ],
      });
    } else {
      commands?.resolveComment({ commentId, importedId });
    }
  };

  /**
   * Update the isInternal value of this comment
   *
   * @param {Object} param0
   * @param {Boolean} param0.isInternal The new isInternal value
   * @param {Object} param0.superdoc The SuperDoc instance
   * @returns {void}
   */
  const setIsInternal = ({ isInternal: newIsInternal, superdoc }) => {
    const previousValue = isInternal.value;
    if (previousValue === newIsInternal) return;

    // Update the isInternal value
    isInternal.value = newIsInternal;

    const emitData = {
      type: comments_module_events.UPDATE,
      changes: [{ key: 'isInternal', value: newIsInternal, previousValue }],
      comment: getValues(),
    };
    propagateUpdate(superdoc, emitData);

    const activeEditor = superdoc.activeEditor;
    if (!activeEditor) return;

    activeEditor.commands.setCommentInternal({ commentId, importedId, isInternal: newIsInternal });
  };

  /**
   * Set this comment as the active comment in the editor
   *
   * @param {Object} superdoc The SuperDoc instance
   * @returns {void}
   */
  const setActive = (superdoc) => {
    const { activeEditor } = superdoc;
    activeEditor?.commands.setActiveComment({ commentId, importedId });
  };

  /**
   *  Update the text value of this comment
   *
   * @param {Object} param0
   * @param {String} param0.text The new text value
   * @param {Object} param0.superdoc The SuperDoc instance
   * @returns {void}
   */
  const setText = ({ text, superdoc, suppressUpdate }) => {
    commentText.value = text;

    // Track mentions
    mentions.value = extractMentions(text);

    if (suppressUpdate) return;

    const emitData = {
      type: comments_module_events.UPDATE,
      changes: [{ key: 'text', value: text }],
      comment: getValues(),
    };
    propagateUpdate(superdoc, emitData);
  };

  /**
   * Extract mentions from comment contents
   *
   * @param {String} htmlString
   * @returns {Array[Object]} An array of unique mentions
   */
  const extractMentions = (htmlString) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');

    const mentionElements = [...doc.querySelectorAll('span[data-type="mention"]')];

    const uniqueMentions = [];
    mentionElements.forEach((span) => {
      const alreadyExists = uniqueMentions.some((m) => {
        const hasEmail = m.email === span.getAttribute('email');
        const hasName = m.name === span.getAttribute('name');
        return hasEmail && hasName;
      });

      if (!alreadyExists) {
        uniqueMentions.push({
          name: span.getAttribute('name'),
          email: span.getAttribute('email'),
        });
      }
    });

    return uniqueMentions;
  };

  /**
   * Update the selection bounds of this comment
   *
   * @param {Object} coords Object containing the selection bounds
   * @param {*} source Specifies the source of the selection bounds
   */
  const updatePosition = (coords, parentElement) => {
    selection.source = 'super-editor';
    const parentTop = parentElement?.getBoundingClientRect()?.top;

    const newCoords = {
      top: coords.top - parentTop,
      left: coords.left,
      right: coords.right,
      bottom: coords.bottom - parentTop,
    };
    selection.selectionBounds = newCoords;
  };

  const getCommentUser = () => {
    const user = importedAuthor.value
      ? { name: importedAuthor.value.name || '(Imported)', email: importedAuthor.value.email }
      : { id: creatorId.value, name: creatorName.value, email: creatorEmail.value, image: creatorImage.value };

    return user;
  };

  /**
   * Emit updates to the end client, and sync with collaboration if necessary
   *
   * @param {Object} superdoc The SuperDoc instance
   * @param {Object} event The data to emit to the client
   * @returns {void}
   */
  const propagateUpdate = (superdoc, event) => {
    superdoc.emit('comments-update', event);
    syncCommentsToClients(superdoc, event);
  };

  /**
   * Get the raw values of this comment
   *
   * @returns {Object} - The raw values of this comment
   */
  const getValues = () => {
    return {
      uid: uid.value,
      commentId,
      importedId,
      parentCommentId,
      trackedChangeParentId,
      fileId,
      fileType,
      mentions: mentions.value.map((u) => {
        return { ...u, name: u.name ? u.name : u.email };
      }),
      createdAtVersionNumber,
      creatorId: creatorId.value,
      creatorEmail: creatorEmail.value,
      creatorName: creatorName.value,
      creatorIdentity: creatorIdentity.value == null ? creatorIdentity.value : { ...creatorIdentity.value },
      wordAuthorName: wordAuthorName.value,
      creatorImage: creatorImage.value,
      createdTime: createdTime.value,
      importedAuthor: importedAuthor.value,
      docxCommentJSON: docxCommentJSON.value,
      isInternal: isInternal.value,
      commentText: commentText.value,
      selection: selection ? selection.getValues() : null,
      trackedChange: trackedChange.value,
      trackedChangeText: trackedChangeText.value,
      trackedChangeType: trackedChangeType.value,
      trackedChangeDisplayType: trackedChangeDisplayType.value,
      trackedChangeStory: trackedChangeStory.value,
      trackedChangeStoryKind: trackedChangeStoryKind.value,
      trackedChangeStoryLabel: trackedChangeStoryLabel.value,
      trackedChangeAnchorKey: trackedChangeAnchorKey.value,
      trackedChangeDecision: trackedChangeDecision.value,
      deletedText: deletedText.value,
      resolvedTime: resolvedTime.value,
      resolvedById: resolvedById.value,
      resolvedByEmail: resolvedByEmail.value,
      resolvedByName: resolvedByName.value,
      origin,
      threadingMethod,
      threadingStyleOverride,
      threadingParentCommentId,
      originalXmlStructure,
    };
  };

  return reactive({
    uid,
    commentId,
    importedId,
    parentCommentId,
    trackedChangeParentId,
    fileId,
    fileType,
    mentions,
    commentElement,
    isFocused,
    creatorId,
    creatorEmail,
    creatorName,
    creatorIdentity,
    wordAuthorName,
    creatorImage,
    createdTime,
    isInternal,
    commentText,
    selection,
    floatingPosition,
    trackedChange,
    deletedText,
    trackedChangeType,
    trackedChangeText,
    trackedChangeDisplayType,
    trackedChangeStory,
    trackedChangeStoryKind,
    trackedChangeStoryLabel,
    trackedChangeAnchorKey,
    trackedChangeDecision,
    resolvedTime,
    resolvedById,
    resolvedByEmail,
    resolvedByName,
    importedAuthor,
    docxCommentJSON,
    origin,
    threadingMethod,
    threadingStyleOverride,
    threadingParentCommentId,
    originalXmlStructure,

    // Actions
    setText,
    getValues,
    resolveComment,
    setIsInternal,
    setActive,
    updatePosition,
    getCommentUser,
  });
}
