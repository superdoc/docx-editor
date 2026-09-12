import { Extension } from '@core/Extension.js';
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { CommentMarkName } from './comments-constants.js';
import {
  getHighlightColor,
  removeCommentsById,
  reopenCommentById,
  resolveCommentById,
  resolveCommentsInTr,
  translateFormatChangesToEnglish,
} from './comments-helpers.js';
import { resolveTrackedFormatDisplay } from './tracked-change-display.js';

// Example tracked-change keys, if needed
import { comments_module_events } from '@superdoc/common';
import { v4 as uuidv4 } from 'uuid';
import { TrackDeleteMarkName, TrackFormatMarkName, TrackInsertMarkName } from '../track-changes/constants.js';
import { TrackChangesBasePluginKey } from '../track-changes/plugins/index.js';
import { getTrackChanges } from '../track-changes/trackChangesHelpers/getTrackChanges.js';
import { normalizeCommentEventPayload, updatePosition } from './helpers/index.js';

const TRACK_CHANGE_MARKS = [TrackInsertMarkName, TrackDeleteMarkName, TrackFormatMarkName];

export const CommentsPluginKey = new PluginKey('comments');

export const CommentsPlugin = Extension.create({
  name: 'comments',

  addCommands() {
    return {
      /**
       * Add a comment to the current selection
       * @category Command
       * @param {string|Object} contentOrOptions - Comment content as a string, or an options object
       * @param {string} [contentOrOptions.content] - The comment content (text or HTML)
       * @param {string} [contentOrOptions.commentId] - Explicit comment ID (defaults to a new UUID)
       * @param {string} [contentOrOptions.author] - Author name (defaults to user from editor config)
       * @param {string} [contentOrOptions.authorId] - Stable actor id (defaults to user from editor config)
       * @param {string} [contentOrOptions.authorEmail] - Author email (defaults to user from editor config)
       * @param {string} [contentOrOptions.authorImage] - Author image URL (defaults to user from editor config)
       * @param {boolean} [contentOrOptions.isInternal=false] - Whether the comment is internal/private
       * @returns {boolean} True if the comment was added successfully, false otherwise
       * @example
       * // Simple usage with just content
       * editor.commands.addComment('This needs review')
       *
       * // With options
       * editor.commands.addComment({
       *   content: 'Please clarify this section',
       *   author: 'Jane Doe',
       *   isInternal: true
       * })
       *
       * // To get the comment ID, listen to the commentsUpdate event
       * editor.on('commentsUpdate', (event) => {
       *   if (event.type === 'add') {
       *     console.log('New comment ID:', event.activeCommentId)
       *   }
       * })
       */
      addComment:
        (contentOrOptions) =>
        ({ tr, dispatch, editor }) => {
          // Validate that there is a text selection
          const { selection } = tr;
          const { $from, $to } = selection;

          if ($from.pos === $to.pos) {
            console.warn('addComment requires a text selection. Please select text before adding a comment.');
            return false;
          }

          // Handle string or options object
          let content, explicitCommentId, author, authorId, authorEmail, authorImage, isInternal;

          if (typeof contentOrOptions === 'string') {
            content = contentOrOptions;
          } else if (contentOrOptions && typeof contentOrOptions === 'object') {
            content = contentOrOptions.content;
            explicitCommentId = contentOrOptions.commentId;
            author = contentOrOptions.author;
            authorId = contentOrOptions.authorId;
            authorEmail = contentOrOptions.authorEmail;
            authorImage = contentOrOptions.authorImage;
            isInternal = contentOrOptions.isInternal;
          }

          // Generate a unique comment ID
          const commentId = explicitCommentId ?? uuidv4();
          const resolvedInternal = isInternal ?? false;

          // Get user defaults from editor config
          const configUser = editor.options?.user || {};

          // Add the comment mark to the selection
          tr.setMeta(CommentsPluginKey, { event: 'add' });
          tr.addMark(
            $from.pos,
            $to.pos,
            editor.schema.marks[CommentMarkName].create({
              commentId,
              internal: resolvedInternal,
            }),
          );

          if (dispatch) dispatch(tr);

          // Build and emit the comment payload
          const commentPayload = normalizeCommentEventPayload({
            conversation: {
              commentId,
              isInternal: resolvedInternal,
              commentText: content,
              creatorName: author ?? configUser.name,
              creatorId: authorId ?? configUser.id,
              creatorEmail: authorEmail ?? configUser.email,
              creatorImage: authorImage ?? configUser.image,
              createdTime: Date.now(),
            },
            editorOptions: editor.options,
            fallbackCommentId: commentId,
            fallbackInternal: resolvedInternal,
          });

          editor.emit('commentsUpdate', {
            type: comments_module_events.ADD,
            comment: commentPayload,
            activeCommentId: commentId,
          });

          return true;
        },

      /**
       * Add a reply to an existing comment or tracked change
       * @category Command
       * @param {Object} options - Reply options
       * @param {string} options.parentId - The ID of the parent comment or tracked change
       * @param {string} [options.content] - The reply content (text or HTML)
       * @param {string} [options.author] - Author name (defaults to user from editor config)
       * @param {string} [options.authorId] - Stable actor id (defaults to user from editor config)
       * @param {string} [options.authorEmail] - Author email (defaults to user from editor config)
       * @param {string} [options.authorImage] - Author image URL (defaults to user from editor config)
       * @returns {boolean} True if the reply was added successfully, false otherwise
       * @example
       * editor.commands.addCommentReply({
       *   parentId: 'comment-123',
       *   content: 'I agree with this suggestion'
       * })
       */
      addCommentReply:
        (options = {}) =>
        ({ editor }) => {
          const {
            parentId,
            content,
            author,
            authorId,
            authorEmail,
            authorImage,
            commentId: explicitCommentId,
          } = options;

          if (!parentId) {
            console.warn('addCommentReply requires a parentId');
            return false;
          }

          const commentId = explicitCommentId ?? uuidv4();
          const configUser = editor.options?.user || {};

          const commentPayload = normalizeCommentEventPayload({
            conversation: {
              commentId,
              parentCommentId: parentId,
              commentText: content,
              creatorName: author ?? configUser.name,
              creatorId: authorId ?? configUser.id,
              creatorEmail: authorEmail ?? configUser.email,
              creatorImage: authorImage ?? configUser.image,
              createdTime: Date.now(),
            },
            editorOptions: editor.options,
            fallbackCommentId: commentId,
            fallbackInternal: false,
          });

          editor.emit('commentsUpdate', {
            type: comments_module_events.ADD,
            comment: commentPayload,
            activeCommentId: commentId,
          });

          return true;
        },

      /**
       * @private
       * Internal command to insert a comment mark at the current selection.
       * Use `addComment` for the public API.
       */
      insertComment:
        (conversation = {}) =>
        ({ tr, dispatch }) => {
          const { selection } = tr;
          const { $from, $to } = selection;
          const skipEmit = conversation?.skipEmit;
          const resolvedCommentId = conversation?.commentId ?? uuidv4();
          const resolvedInternal = conversation?.isInternal ?? false;

          tr.setMeta(CommentsPluginKey, { event: 'add' });
          tr.addMark(
            $from.pos,
            $to.pos,
            this.editor.schema.marks[CommentMarkName].create({
              commentId: resolvedCommentId,
              internal: resolvedInternal,
            }),
          );

          if (dispatch) dispatch(tr);

          const shouldEmit = !skipEmit && resolvedCommentId !== 'pending';
          if (shouldEmit) {
            const commentPayload = normalizeCommentEventPayload({
              conversation,
              editorOptions: this.editor.options,
              fallbackCommentId: resolvedCommentId,
              fallbackInternal: resolvedInternal,
            });

            const activeCommentId = commentPayload.commentId || commentPayload.importedId || null;

            const event = {
              type: comments_module_events.ADD,
              comment: commentPayload,
              ...(activeCommentId && { activeCommentId }),
            };

            this.editor.emit('commentsUpdate', event);
          }

          return true;
        },

      removeComment:
        ({ commentId, importedId }) =>
        ({ tr, dispatch, state }) => {
          tr.setMeta(CommentsPluginKey, { event: 'deleted' });
          return removeCommentsById({ commentId, importedId, state, tr, dispatch });
        },

      setActiveComment:
        ({ commentId }) =>
        ({ tr }) => {
          tr.setMeta(CommentsPluginKey, { type: 'setActiveComment', activeThreadId: commentId, forceUpdate: true });
          return true;
        },

      setCommentInternal:
        ({ commentId, importedId, isInternal }) =>
        ({ tr, dispatch, state }) => {
          const { doc } = state;
          const commentMarkType = this.editor.schema.marks[CommentMarkName];
          if (!commentMarkType) return false;
          const matchedSegments = [];

          tr.setMeta(CommentsPluginKey, { event: 'update' });
          doc.descendants((node, pos) => {
            if (!node.isInline) return;
            const { marks = [] } = node;
            marks
              .filter((mark) => mark.type.name === CommentMarkName)
              .forEach((commentMark) => {
                const { attrs } = commentMark;
                const wid = attrs.commentId;
                const importedWid = attrs.importedId;
                if (wid === commentId || (importedId && importedWid === importedId)) {
                  matchedSegments.push({
                    from: pos,
                    to: pos + node.nodeSize,
                    attrs,
                    mark: commentMark,
                  });
                }
              });
          });

          if (!matchedSegments.length) return false;

          matchedSegments.forEach(({ from, to, attrs, mark }) => {
            tr.removeMark(from, to, mark);
            tr.addMark(
              from,
              to,
              commentMarkType.create({
                ...attrs,
                commentId: attrs?.commentId ?? commentId,
                importedId: attrs?.importedId ?? importedId,
                internal: isInternal,
              }),
            );
          });

          tr.setMeta(CommentsPluginKey, { type: 'setCommentInternal' });
          dispatch(tr);
          return true;
        },

      resolveComment:
        ({ commentId, importedId }) =>
        ({ tr, dispatch, state }) => {
          tr.setMeta(CommentsPluginKey, { event: 'update' });
          return resolveCommentById({ commentId, importedId, state, tr, dispatch });
        },

      /**
       * Resolve a whole thread (root + replies) in ONE transaction so the
       * mark→node conversion for every comment in the thread forms a single
       * undo step (SD-3355). `comments` is `[{ commentId, importedId }]`.
       */
      resolveCommentThread:
        ({ comments } = {}) =>
        ({ tr, dispatch, state }) => {
          tr.setMeta(CommentsPluginKey, { event: 'update' });
          const converted = resolveCommentsInTr({ items: comments, state, tr });
          if (converted) dispatch(tr);
          return converted;
        },
      reopenComment:
        ({ commentId, importedId, internal }) =>
        ({ tr, dispatch, state }) => {
          tr.setMeta(CommentsPluginKey, { event: 'update' });
          return reopenCommentById({ commentId, importedId, internal, state, tr, dispatch });
        },
      editComment:
        ({ commentId, importedId, content, text }) =>
        ({ editor }) => {
          const nextCommentId = commentId ?? importedId;
          if (!nextCommentId) return false;

          const normalizedText = content ?? text ?? '';
          const payload = normalizeCommentEventPayload({
            conversation: {
              commentId: nextCommentId,
              importedId,
              commentText: normalizedText,
              updatedTime: Date.now(),
            },
            editorOptions: editor.options,
            fallbackCommentId: nextCommentId,
            fallbackInternal: false,
          });

          editor.emit('commentsUpdate', {
            type: comments_module_events.UPDATE,
            comment: payload,
            activeCommentId: nextCommentId,
          });

          return true;
        },
      moveComment:
        ({ commentId, from, to }) =>
        ({ tr, dispatch, state, editor }) => {
          if (!commentId) return false;
          if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
          if (from >= to) return false;

          const { doc } = state;
          if (from < 0 || to > doc.content.size) return false;
          const resolved = findRangeById(doc, commentId);
          if (!resolved) return false;

          const markType = editor.schema?.marks?.[CommentMarkName];
          if (!markType) return false;

          tr.setMeta(CommentsPluginKey, { event: 'update' });

          const segments = [];
          doc.descendants((node, pos) => {
            if (!node.isInline) return;
            const commentMark = node.marks?.find(
              (mark) =>
                mark.type.name === CommentMarkName &&
                (mark.attrs?.commentId === commentId || mark.attrs?.importedId === commentId),
            );
            if (!commentMark) return;
            segments.push({
              from: pos,
              to: pos + node.nodeSize,
              attrs: commentMark.attrs,
              mark: commentMark,
            });
          });

          if (segments.length > 0) {
            segments.forEach((segment) => {
              tr.removeMark(segment.from, segment.to, segment.mark);
            });

            const attrs = segments[0]?.attrs ?? { commentId };
            const mappedFrom = tr.mapping.map(from);
            const mappedTo = tr.mapping.map(to);
            tr.addMark(mappedFrom, mappedTo, markType.create(attrs));
            if (dispatch) dispatch(tr);
            return true;
          }

          const startType = editor.schema?.nodes?.commentRangeStart;
          const endType = editor.schema?.nodes?.commentRangeEnd;
          if (!startType || !endType) return false;

          let startPos = null;
          let endPos = null;
          let startAttrs = { 'w:id': commentId };
          doc.descendants((node, pos) => {
            if (node.type.name === 'commentRangeStart' && node.attrs?.['w:id'] === commentId) {
              startPos = pos;
              startAttrs = { ...node.attrs };
            }
            if (node.type.name === 'commentRangeEnd' && node.attrs?.['w:id'] === commentId) {
              endPos = pos;
            }
          });

          if (startPos == null || endPos == null) return false;

          const toDelete = [startPos, endPos].sort((a, b) => b - a);
          toDelete.forEach((pos) => {
            tr.delete(pos, pos + 1);
          });

          const mappedFrom = tr.mapping.map(from);
          const mappedTo = tr.mapping.map(to);
          tr.insert(mappedTo, endType.create({ 'w:id': commentId }));
          tr.insert(mappedFrom, startType.create({ ...startAttrs, 'w:id': commentId }));
          if (dispatch) dispatch(tr);
          return true;
        },
      setCursorById:
        (id, options = {}) =>
        ({ state, editor }) => {
          const { from } = findRangeById(state.doc, id) || {};
          if (from != null) {
            const tr = state.tr;
            tr.setSelection(TextSelection.create(state.doc, from));
            if (options.activeCommentId) {
              tr.setMeta(CommentsPluginKey, {
                type: 'setActiveComment',
                activeThreadId: options.activeCommentId,
                forceUpdate: true,
              });
            } else if (options.preferredActiveThreadId) {
              tr.setMeta(CommentsPluginKey, {
                type: 'setCursorById',
                preferredActiveThreadId: options.preferredActiveThreadId,
              });
            }
            // Skip view.focus() when activating from the sidebar (activeCommentId set).
            // Focusing the hidden PM view can trigger a DOM selection sync transaction
            // that overwrites the activeThreadId via position-based detection.
            if (!options.activeCommentId && editor.view && typeof editor.view.focus === 'function') {
              editor.view.focus();
            }
            return true;
          }
          return false;
        },
    };
  },

  addPmPlugins() {
    const editor = this.editor;
    const isHeadless = editor.options.isHeadless;
    let shouldUpdate = true;
    let pendingSelectedNotification = null;

    const pluginSpec = {
      key: CommentsPluginKey,

      state: {
        init() {
          const highlightColors = editor.options.comments?.highlightColors || {};
          return {
            activeThreadId: null,
            externalColor: highlightColors.external ?? '#B1124B',
            internalColor: highlightColors.internal ?? '#078383',
            decorations: DecorationSet.empty,
            allCommentPositions: {},
            allCommentIds: [],
            trackedChanges: {},
          };
        },

        apply(tr, pluginState, _, newEditorState) {
          const meta = tr.getMeta(CommentsPluginKey);
          const { type } = meta || {};

          if (type === 'force' || type === 'forceTrackChanges') shouldUpdate = true;

          if (type === 'setActiveComment') {
            shouldUpdate = true;
            const previousActiveThreadId = pluginState.activeThreadId;
            const newActiveThreadId = meta.activeThreadId;

            // Emit commentsUpdate event when active comment changes (e.g., from comment bubble click)
            // Defer emission to after transaction completes to avoid dispatching during apply()
            if (previousActiveThreadId !== newActiveThreadId) {
              const activeCommentId = newActiveThreadId ?? null;
              const update = {
                type: comments_module_events.SELECTED,
                activeCommentId,
              };
              clearTimeout(pendingSelectedNotification);
              pendingSelectedNotification = setTimeout(() => {
                pendingSelectedNotification = null;
                if (editor.isDestroyed) return;

                const editorState = editor.state;
                if (!editorState) return;

                const currentActiveCommentId = CommentsPluginKey.getState(editorState)?.activeThreadId ?? null;
                // A deferred SELECTED(id) may only publish while id is still the active plugin state.
                if (currentActiveCommentId !== activeCommentId) return;

                editor.emit('commentsUpdate', update);
              }, 0);
            }

            pluginState.activeThreadId = newActiveThreadId;
            return {
              ...pluginState,
              activeThreadId: newActiveThreadId,
            };
          }

          if (meta && meta.decorations) {
            return {
              ...pluginState,
              decorations: meta.decorations,
              allCommentPositions: meta.allCommentPositions,
            };
          }

          // If this is a tracked change transaction, handle separately
          const trackedChangeMeta = tr.getMeta(TrackChangesBasePluginKey);
          const currentTrackedChanges = pluginState.trackedChanges;
          if (trackedChangeMeta) {
            pluginState.trackedChanges = handleTrackedChangeTransaction(
              trackedChangeMeta,
              currentTrackedChanges,
              newEditorState,
              editor,
            );
          }

          // Check for changes in the actively selected comment
          if (!tr.docChanged && tr.selectionSet) {
            const { selection } = tr;

            let currentActiveThread = getActiveCommentId(newEditorState.doc, selection);
            if (
              meta?.type === 'setCursorById' &&
              meta.preferredActiveThreadId &&
              selectionContainsThread(newEditorState.doc, selection, meta.preferredActiveThreadId)
            ) {
              currentActiveThread = meta.preferredActiveThreadId;
            }

            const previousSelectionId = pluginState.activeThreadId;
            // getActiveCommentId returns undefined for any non-collapsed selection
            // (its first line is `if ($from.pos !== $to.pos) return;`), and that
            // undefined gets coerced to null below, which would emit
            // commentsUpdate({activeCommentId: null}) and clear an active comment.
            // For tracked-change comments, presentation.navigateTo dispatches a
            // collapsed cursor placement immediately followed by a non-collapsed
            // NodeSelection on the SDT wrapper. That second tx would otherwise
            // overwrite the just-activated comment, the host's commentsUpdate
            // listener would re-assert it, and the loop would flicker forever
            // (issue #2861). Treat "undefined from non-collapsed" as "no
            // information" rather than "no active comment".
            const isNonCollapsedClear =
              currentActiveThread == null && selection && selection.$from.pos !== selection.$to.pos;
            if (previousSelectionId !== currentActiveThread && !isNonCollapsedClear) {
              // Update both the plugin state and the local variable
              pluginState.activeThreadId = currentActiveThread;
              const update = {
                type: comments_module_events.SELECTED,
                activeCommentId: currentActiveThread ? currentActiveThread : null,
              };

              shouldUpdate = true;
              editor.emit('commentsUpdate', update);
            }
          }

          return { ...pluginState };
        },
      },
    };

    // In headless mode, skip DOM-dependent props and view — only state tracking is needed.
    if (!isHeadless) {
      pluginSpec.props = {
        decorations(state) {
          return this.getState(state).decorations;
        },
      };

      pluginSpec.view = () => {
        let prevDoc = null;
        let prevActiveThreadId = null;
        let prevAllCommentPositions = {};
        let hasEverEmitted = false;

        return {
          update(view) {
            const { state } = view;
            const { doc, tr } = state;
            const pluginState = CommentsPluginKey.getState(state);
            const currentActiveThreadId = pluginState.activeThreadId;
            const layoutEngineActive = Boolean(editor.presentationEditor);

            const meta = tr.getMeta(CommentsPluginKey);
            if (meta?.type === 'setActiveComment' || meta?.forceUpdate) {
              shouldUpdate = true;
            }

            const docChanged = !prevDoc || !prevDoc.eq(doc);
            if (docChanged) shouldUpdate = true;

            const activeThreadChanged = prevActiveThreadId !== currentActiveThreadId;
            if (activeThreadChanged) {
              shouldUpdate = true;
              prevActiveThreadId = currentActiveThreadId;
            }

            // If only active thread changed after first render, reuse cached positions
            const isInitialLoad = prevDoc === null;
            const onlyActiveThreadChanged = !isInitialLoad && !docChanged && activeThreadChanged;

            if (!shouldUpdate) return;
            prevDoc = doc;
            shouldUpdate = false;

            if (layoutEngineActive) return;

            const decorations = [];
            // Always rebuild positions fresh from the current document to avoid stale PM offsets
            const allCommentPositions = {};
            doc.descendants((node, pos) => {
              const { marks = [] } = node;
              const commentMarks = marks.filter((mark) => mark.type.name === CommentMarkName);

              let hasActive = false;
              commentMarks.forEach((commentMark) => {
                const { attrs } = commentMark;
                const threadId = attrs.commentId || attrs.importedId;

                if (!onlyActiveThreadChanged) {
                  let currentBounds;
                  try {
                    currentBounds = view.coordsAtPos(pos);
                  } catch {
                    currentBounds = null;
                  }

                  if (currentBounds) {
                    updatePosition({
                      allCommentPositions,
                      threadId,
                      pos,
                      currentBounds,
                      node,
                    });
                  }
                }

                const isInternal = attrs.internal;
                if (!hasActive) hasActive = currentActiveThreadId === threadId;

                // Get the color based on current activeThreadId
                let color = getHighlightColor({
                  activeThreadId: currentActiveThreadId,
                  threadId,
                  isInternal,
                  editor,
                });

                const deco = Decoration.inline(pos, pos + node.nodeSize, {
                  style: `background-color: ${color};`,
                  'data-thread-id': threadId,
                  class: 'sd-editor-comment-highlight',
                });

                // Ignore inner marks if we need to show an outer active one
                if (hasActive && currentActiveThreadId !== threadId) return;
                decorations.push(deco);
              });

              const trackedChangeMark = findTrackedMark({
                doc,
                from: pos,
                to: pos + node.nodeSize,
              });

              if (trackedChangeMark) {
                if (!onlyActiveThreadChanged) {
                  let currentBounds;
                  try {
                    currentBounds = view.coordsAtPos(pos);
                  } catch {
                    currentBounds = null;
                  }
                  const { id } = trackedChangeMark.mark.attrs;
                  if (currentBounds) {
                    updatePosition({
                      allCommentPositions,
                      threadId: id,
                      pos,
                      currentBounds,
                      node,
                    });
                  }
                }

                // Add decoration for tracked changes when activated
                const isActiveTrackedChange = currentActiveThreadId === trackedChangeMark.mark.attrs.id;
                if (isActiveTrackedChange) {
                  const trackedChangeDeco = Decoration.inline(pos, pos + node.nodeSize, {
                    style: `border-width: 2px;`,
                    'data-thread-id': trackedChangeMark.mark.attrs.id,
                    class: 'sd-editor-tracked-change-highlight',
                  });

                  decorations.push(trackedChangeDeco);
                }
              }
            });

            const decorationSet = DecorationSet.create(doc, decorations);

            // Compare new decorations with the old state to avoid infinite loop
            const oldDecorations = pluginState.decorations;

            // We only dispatch if something actually changed
            const same = oldDecorations.eq(decorationSet);
            if (!same) {
              const tr = state.tr.setMeta(CommentsPluginKey, {
                decorations: decorationSet,
                allCommentPositions,
                forceUpdate: true,
              });
              // Dispatch the transaction to update pluginState
              view.dispatch(tr);
            }

            // Only emit comment-positions if they changed
            if (!onlyActiveThreadChanged) {
              const positionsChanged = hasPositionsChanged(prevAllCommentPositions, allCommentPositions);
              const hasComments = Object.keys(allCommentPositions).length > 0;
              // Emit positions if they changed OR if this is the first emission with comments present.
              // This ensures positions are emitted on initial load even when only the active thread changes.
              const shouldEmitPositions = positionsChanged || (!hasEverEmitted && hasComments);

              if (shouldEmitPositions) {
                prevAllCommentPositions = allCommentPositions;
                hasEverEmitted = true;
                editor.emit('comment-positions', { allCommentPositions });
              }
            }
          },
        };
      };
    }

    return [new Plugin(pluginSpec)];
  },
});

/**
 * Compares two comment position objects to determine if they have changed.
 * Uses shallow comparison of position coordinates for efficiency.
 * @param {Object} prevPositions - Previous comment positions object
 * @param {Object} currPositions - Current comment positions object
 * @returns {boolean} True if positions have changed, false otherwise
 */
const hasPositionsChanged = (prevPositions, currPositions) => {
  const prevKeys = Object.keys(prevPositions);
  const currKeys = Object.keys(currPositions);

  if (prevKeys.length !== currKeys.length) return true;

  for (const key of currKeys) {
    const prev = prevPositions[key];
    const curr = currPositions[key];

    if (!prev || !prev.bounds || !curr.bounds) {
      return true;
    }

    if (prev.bounds.top !== curr.bounds.top || prev.bounds.left !== curr.bounds.left) {
      return true;
    }
  }

  return false;
};

/**
 * This is run when a new selection is set (tr.selectionSet) to return the active comment ID, if any
 * If there are multiple, only return the first one
 *
 * @param {Object} doc The current document
 * @param {Selection} selection The current selection
 * @returns {String | null} The active comment ID, if any
 */
const getActiveCommentId = (doc, selection) => {
  if (!selection) return;
  const { $from, $to } = selection;

  // We only need to check for active comment ID if the selection is empty
  if ($from.pos !== $to.pos) return;

  const nodeAtPos = doc.nodeAt($from.pos);
  if (!nodeAtPos) return;

  // Check for tracked change mark (we'll use this as fallback if no comment found)
  const trackedChangeMark = findTrackedMark({
    doc,
    from: $from.pos,
    to: $to.pos,
  });

  // Check for comment nodes first - comments take precedence over tracked changes
  // This ensures that when cursor is on text that has both TC and comment, the comment is selected
  // Collect all comment marks at the cursor position along with their ranges
  const commentRanges = new Map(); // commentId -> { start, end }

  // First pass: find all comment ranges in the document
  doc.descendants((node, pos) => {
    const { marks = [] } = node;
    const commentMarks = marks.filter((mark) => mark.type.name === CommentMarkName);

    commentMarks.forEach((mark) => {
      const commentId = mark.attrs.commentId || mark.attrs.importedId;
      if (!commentId) return;

      const existing = commentRanges.get(commentId);
      const end = pos + node.nodeSize;

      if (!existing) {
        commentRanges.set(commentId, { start: pos, end });
      } else {
        // Extend the range if this node extends it
        commentRanges.set(commentId, {
          start: Math.min(existing.start, pos),
          end: Math.max(existing.end, end),
        });
      }
    });
  });

  // Find which comments contain the cursor position
  const containingComments = [];
  commentRanges.forEach((range, commentId) => {
    if ($from.pos >= range.start && $from.pos < range.end) {
      containingComments.push({
        commentId,
        start: range.start,
        end: range.end,
        size: range.end - range.start,
      });
    }
  });

  if (containingComments.length === 0) {
    // No comments found, fall back to tracked change if present
    if (trackedChangeMark) {
      return trackedChangeMark.mark.attrs.id;
    }
    return null;
  }

  // Return the innermost comment (smallest range)
  // For nested comments, the inner one has the smallest size
  containingComments.sort((a, b) => a.size - b.size);
  return containingComments[0].commentId;
};

const selectionContainsThread = (doc, selection, threadId) => {
  if (!selection || !threadId) return false;
  const { $from, $to } = selection;
  if ($from.pos !== $to.pos) return false;

  const range = findRangeById(doc, threadId);
  if (!range) return false;

  return $from.pos >= range.from && $from.pos < range.to;
};

const findTrackedMark = ({
  doc,
  from,
  to,
  offset = 1, // To get non-inclusive marks.
}) => {
  const startPos = Math.max(from - offset, 0);
  const endPos = Math.min(to + offset, doc.content.size);

  let markFound;

  doc.nodesBetween(startPos, endPos, (node, pos) => {
    if (!node || node?.nodeSize === undefined) {
      return;
    }

    const mark = node.marks.find((mark) => TRACK_CHANGE_MARKS.includes(mark.type.name));

    if (mark && !markFound) {
      markFound = {
        from: pos,
        to: pos + node.nodeSize,
        mark,
      };
    }
  });

  return markFound;
};

const handleTrackedChangeTransaction = (trackedChangeMeta, trackedChanges, newEditorState, editor) => {
  const { insertedMark, deletionMark, formatMark, deletionNodes, emitCommentEvent = true } = trackedChangeMeta;

  if (!insertedMark && !deletionMark && !formatMark) {
    return;
  }

  const newTrackedChanges = { ...trackedChanges };
  const insertedId = insertedMark?.attrs?.id ?? null;
  const deletionId = deletionMark?.attrs?.id ?? null;
  const formatId = formatMark?.attrs?.id ?? null;
  const primaryId = insertedId || deletionId || formatId;

  if (!primaryId) {
    return trackedChanges;
  }

  const registerTrackedChangeId = (changeId, patch) => {
    if (!changeId) return false;

    const existing = newTrackedChanges[changeId];
    if (existing) {
      Object.assign(existing, patch);
      return false;
    }

    newTrackedChanges[changeId] = { ...patch };
    return true;
  };

  const trackedChangesForIdCache = new Map();
  const getTrackedChangesForId = (changeId) => {
    if (!changeId) return [];
    if (!trackedChangesForIdCache.has(changeId)) {
      trackedChangesForIdCache.set(changeId, getTrackChanges(newEditorState, changeId));
    }
    return trackedChangesForIdCache.get(changeId);
  };

  const buildTrackedChangePayload = ({ event, marks, nodes, deletionNodes = [] }) => {
    if (!marks.insertedMark && !marks.deletionMark && !marks.formatMark) {
      return null;
    }

    const trackedMarkId =
      marks.insertedMark?.attrs?.id ?? marks.deletionMark?.attrs?.id ?? marks.formatMark?.attrs?.id ?? null;
    if (!trackedMarkId) {
      return null;
    }

    return createOrUpdateTrackedChangeComment({
      documentId: editor.options.documentId,
      event,
      marks,
      deletionNodes,
      nodes,
      newEditorState,
      trackedChangesForId: getTrackedChangesForId(trackedMarkId),
    });
  };

  const { step } = trackedChangeMeta;
  let nodes = step?.slice?.content?.content || [];

  // Track format has no nodes, we need to find the node
  if (!nodes.length) {
    newEditorState.doc.descendants((node) => {
      const hasFormatMark = node.marks.find((mark) => mark.type.name === TrackFormatMarkName);
      if (hasFormatMark) {
        nodes = [node];
        return false;
      }
    });
  }

  const hasLiveTrackedChange = (changeId) => getTrackedChangesForId(changeId).length > 0;
  const hasCandidateNodes = nodes.length > 0 || Boolean(deletionNodes?.length) || hasLiveTrackedChange(primaryId);
  const hasIndependentReplacementIds =
    Boolean(insertedMark && deletionMark) && Boolean(insertedId) && Boolean(deletionId) && insertedId !== deletionId;

  if (hasIndependentReplacementIds) {
    const isNewInsertion = registerTrackedChangeId(insertedId, { insertion: insertedId });
    const isNewDeletion = registerTrackedChangeId(deletionId, { deletion: deletionId });
    const hasInsertionCandidateNodes = nodes.length > 0 || hasLiveTrackedChange(insertedId);
    const hasDeletionCandidateNodes = Boolean(deletionNodes?.length) || hasLiveTrackedChange(deletionId);

    const insertionPayload = hasInsertionCandidateNodes
      ? buildTrackedChangePayload({
          event: isNewInsertion ? 'add' : 'update',
          marks: {
            insertedMark,
            deletionMark: null,
            formatMark: null,
          },
          deletionNodes: [],
          nodes,
        })
      : null;

    const deletionPayload =
      deletionMark && hasDeletionCandidateNodes
        ? buildTrackedChangePayload({
            event: isNewDeletion ? 'add' : 'update',
            marks: {
              insertedMark: null,
              deletionMark,
              formatMark: null,
            },
            deletionNodes,
            nodes: [],
          })
        : null;

    if (emitCommentEvent && insertionPayload) editor.emit('commentsUpdate', insertionPayload);
    if (emitCommentEvent && deletionPayload) editor.emit('commentsUpdate', deletionPayload);
    return newTrackedChanges;
  }

  // Maintain a map of tracked changes with their inserted/deleted ids.
  const isNewChange = registerTrackedChangeId(primaryId, {
    ...(insertedMark ? { insertion: primaryId } : {}),
    ...(deletionMark ? { deletion: deletionId } : {}),
    ...(formatMark ? { format: formatId } : {}),
  });

  const emitParams = hasCandidateNodes
    ? buildTrackedChangePayload({
        event: isNewChange ? 'add' : 'update',
        marks: {
          insertedMark,
          deletionMark,
          formatMark,
        },
        deletionNodes,
        nodes,
      })
    : null;

  if (emitParams && emitCommentEvent) editor.emit('commentsUpdate', emitParams);

  return newTrackedChanges;
};

const normalizeFormatAttrsForCommentText = (attrs = {}, nodes) => {
  const before = Array.isArray(attrs.before) ? attrs.before : [];
  const after = Array.isArray(attrs.after) ? attrs.after : [];
  const beforeTextStyle = before.find((mark) => mark?.type === 'textStyle');

  if (!beforeTextStyle) {
    return {
      ...attrs,
      before,
      after,
    };
  }

  const afterTextStyleIndex = after.findIndex((mark) => mark?.type === 'textStyle');
  const wasTextStyleRemoved = nodes.some((node) => {
    const hasTextStyleMark = node.marks.find((mark) => mark.type.name === 'textStyle');
    return !hasTextStyleMark;
  });

  if (afterTextStyleIndex === -1) {
    if (wasTextStyleRemoved) {
      return {
        ...attrs,
        before,
        after,
      };
    } else {
      return {
        ...attrs,
        before,
        after: [
          ...after,
          {
            type: 'textStyle',
            attrs: {
              ...beforeTextStyle.attrs,
            },
          },
        ],
      };
    }
  }

  const mergedAfter = [...after];
  mergedAfter[afterTextStyleIndex] = {
    ...mergedAfter[afterTextStyleIndex],
    attrs: {
      ...(beforeTextStyle.attrs || {}),
      ...(mergedAfter[afterTextStyleIndex].attrs || {}),
    },
  };

  return {
    ...attrs,
    before,
    after: mergedAfter,
  };
};

const getTrackedChangeText = ({ nodes, mark, trackedChangeType, isReplacement }) => {
  let trackedChangeText = '';
  let deletionText = '';
  let trackedChangeDisplayType = null;

  // Tab atoms have no `.text`; surface as '\t' (SD-3376).
  const nodeTrackedText = (node) => (node?.type?.name === 'tab' ? '\t' : node?.text || node?.textContent || '');

  // Extract deletion text first
  if (trackedChangeType === TrackDeleteMarkName || isReplacement) {
    deletionText = nodes.reduce((acc, node) => {
      const hasDeleteMark = node.marks.find((nodeMark) => nodeMark.type.name === TrackDeleteMarkName);
      if (!hasDeleteMark) return acc;
      acc += nodeTrackedText(node);
      return acc;
    }, '');
  }

  if (trackedChangeType === TrackInsertMarkName || isReplacement) {
    trackedChangeText = nodes.reduce((acc, node) => {
      const hasInsertMark = node.marks.find((nodeMark) => nodeMark.type.name === TrackInsertMarkName);
      if (!hasInsertMark) return acc;
      acc += nodeTrackedText(node);
      return acc;
    }, '');
  }

  // If this is a format change, let's get the string of what changes were made
  if (trackedChangeType === TrackFormatMarkName) {
    const normalizedFormatAttrs = normalizeFormatAttrsForCommentText(mark.attrs, nodes);
    const trackedFormatDisplay = resolveTrackedFormatDisplay({
      attrs: normalizedFormatAttrs,
      nodes,
    });

    if (trackedFormatDisplay) {
      trackedChangeText = trackedFormatDisplay.trackedChangeText;
      trackedChangeDisplayType = trackedFormatDisplay.trackedChangeDisplayType;
    } else {
      trackedChangeText = translateFormatChangesToEnglish(normalizedFormatAttrs);
    }
  }

  return {
    deletionText,
    trackedChangeText,
    trackedChangeDisplayType,
  };
};

const createOrUpdateTrackedChangeComment = ({
  event,
  marks,
  deletionNodes,
  nodes,
  newEditorState,
  documentId,
  trackedChangesForId,
}) => {
  const node = nodes[0];
  // Use pre-computed tracked changes when available (batch import path),
  // otherwise scan the document (real-time edit path).
  const fallbackTrackedMark = marks.insertedMark || marks.deletionMark || marks.formatMark;
  if (!fallbackTrackedMark) {
    return;
  }

  const fallbackTrackedMarkId = fallbackTrackedMark.attrs?.id;
  const trackedChangesWithId = trackedChangesForId || getTrackChanges(newEditorState, fallbackTrackedMarkId);
  const liveFormatMark = trackedChangesWithId.find(({ mark }) => mark.type.name === TrackFormatMarkName)?.mark ?? null;
  const trackedMark = marks.insertedMark || marks.deletionMark || liveFormatMark || marks.formatMark;
  const { type, attrs } = trackedMark;

  const { name: trackedChangeType } = type;
  const { author, authorId, authorEmail, authorImage, date, importedAuthor } = attrs;
  const id = attrs.id;

  const insertedMarkId = marks.insertedMark?.attrs?.id ?? null;
  const deletionMarkId = marks.deletionMark?.attrs?.id ?? null;
  let isReplacement = Boolean(insertedMarkId && deletionMarkId && insertedMarkId === deletionMarkId);

  // Fallback: check the document for both mark types under the same ID
  // (covers edge cases where transaction meta only carries one mark)
  if (!isReplacement) {
    const hasInsertMark = trackedChangesWithId.some(({ mark }) => mark.type.name === TrackInsertMarkName);
    const hasDeleteMark = trackedChangesWithId.some(({ mark }) => mark.type.name === TrackDeleteMarkName);
    isReplacement = hasInsertMark && hasDeleteMark;
  }

  // Collect nodes from the tracked changes found
  // We need to get the actual nodes at those positions
  const nodesWithMark = [];
  trackedChangesWithId.forEach(({ from, to }) => {
    newEditorState.doc.nodesBetween(from, to, (node) => {
      // Text and tab nodes only.
      if (node.isText || node.type.name === 'tab') {
        // Check if this node has the mark (it should, since getTrackChanges found it)
        const hasMatchingMark = node.marks?.some((m) => TRACK_CHANGE_MARKS.includes(m.type.name) && m.attrs.id === id);
        if (hasMatchingMark) {
          // Check if we already have this node (by reference, not by content)
          const alreadyAdded = nodesWithMark.some((n) => n === node);
          if (!alreadyAdded) {
            nodesWithMark.push(node);
          }
        }
      }
    });
  });

  let nodesToUse;
  if (isReplacement) {
    // For replacements, prefer nodes found in the document to avoid duplicating text
    // when step.slice/deletionNodes include overlapping content.
    const hasInsertNode = nodesWithMark.some((node) =>
      node.marks.find((nodeMark) => nodeMark.type.name === TrackInsertMarkName),
    );
    const hasDeleteNode = nodesWithMark.some((node) =>
      node.marks.find((nodeMark) => nodeMark.type.name === TrackDeleteMarkName),
    );

    const fallbackNodes = [
      ...(!hasInsertNode && nodes?.length ? nodes : []),
      ...(!hasDeleteNode && deletionNodes?.length ? deletionNodes : []),
    ];
    nodesToUse = Array.from(new Set([...nodesWithMark, ...fallbackNodes]));
  } else {
    // For non-replacements, use nodes found in document or fall back to step nodes
    nodesToUse = nodesWithMark.length ? nodesWithMark : node ? [node] : [];
  }

  if (!nodesToUse.length) {
    return;
  }

  const { deletionText, trackedChangeText, trackedChangeDisplayType } = getTrackedChangeText({
    nodes: nodesToUse,
    mark: trackedMark,
    trackedChangeType,
    isReplacement,
    deletionNodes,
  });

  if (!deletionText && !trackedChangeText) {
    return;
  }

  const params = {
    event: comments_module_events.ADD,
    type: 'trackedChange',
    documentId,
    changeId: id,
    trackedChangeType: isReplacement ? 'both' : trackedChangeType,
    trackedChangeText,
    trackedChangeDisplayType,
    deletedText: isReplacement || marks.deletionMark ? deletionText : null,
    author,
    ...(authorId && { authorId }),
    authorEmail,
    ...(authorImage && { authorImage }),
    date,
    ...(importedAuthor && {
      importedAuthor: {
        name: importedAuthor,
      },
    }),
  };

  if (event === 'add') params.event = comments_module_events.ADD;
  else if (event === 'update') params.event = comments_module_events.UPDATE;

  return params;
};

function findRangeById(doc, id) {
  let from = null,
    to = null;
  doc.descendants((node, pos) => {
    const trackedMark = node.marks.find((m) => TRACK_CHANGE_MARKS.includes(m.type.name) && m.attrs.id === id);
    if (trackedMark) {
      if (from === null || pos < from) from = pos;
      if (to === null || pos + node.nodeSize > to) to = pos + node.nodeSize;
    }
    const commentMark = node.marks.find(
      (m) => m.type.name === CommentMarkName && (m.attrs.commentId === id || m.attrs.importedId === id),
    );
    if (commentMark) {
      if (from === null || pos < from) from = pos;
      if (to === null || pos + node.nodeSize > to) to = pos + node.nodeSize;
    }
    // For resolved comments: check commentRangeStart/End nodes (marks are removed when resolved)
    if (node.type.name === 'commentRangeStart' && node.attrs['w:id'] === id) {
      from = pos;
    }
    if (node.type.name === 'commentRangeEnd' && node.attrs['w:id'] === id) {
      to = pos;
    }
  });
  return from !== null && to !== null ? { from, to } : null;
}

export { createOrUpdateTrackedChangeComment };

export const __test__ = {
  getActiveCommentId,
  selectionContainsThread,
  findTrackedMark,
  handleTrackedChangeTransaction,
  getTrackedChangeText,
  createOrUpdateTrackedChangeComment,
  findRangeById,
};
