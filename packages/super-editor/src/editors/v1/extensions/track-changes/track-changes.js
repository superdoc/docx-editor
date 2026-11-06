// @ts-check
import { Extension } from '@core/Extension.js';
import { TrackDeleteMarkName, TrackInsertMarkName, TrackFormatMarkName } from './constants.js';
import { TrackChangesBasePlugin, TrackChangesBasePluginKey } from './plugins/index.js';
import { getTrackChanges } from './trackChangesHelpers/getTrackChanges.js';
import { collectTrackedChanges } from './permission-helpers.js';
import { CommentsPluginKey } from '../comment/comments-plugin.js';
import { hasExpandedSelection } from '@utils/selectionUtils.js';
import { compileTrackedEdit } from './review-model/overlap-compiler.js';
import {
  makeTextInsertIntent,
  makeTextDeleteIntent,
  makeTextReplaceIntent,
  sliceFromText,
} from './review-model/edit-intent.js';
import { decideTrackedChanges, buildDecisionBubbleEvents } from './review-model/decision-engine.js';
import { snapshotWordIdentity } from '@superdoc/common/helpers/word-identity';

/**
 * @typedef {{ code: string, message: string, details?: unknown }} TrackChangesFailure
 * @typedef {{
 *   lastCompilerFailure: TrackChangesFailure | null,
 *   lastDecisionFailure: TrackChangesFailure | null,
 *   lastDecisionReceipt: unknown,
 * }} TrackChangesStorage
 */

/**
 * @param {unknown} editor
 * @returns {TrackChangesStorage | null}
 */
const getTrackChangesStorage = (editor) => {
  const storage = /** @type {{ storage?: { trackChanges?: unknown } } | null | undefined} */ (editor)?.storage
    ?.trackChanges;
  if (!storage || typeof storage !== 'object') return null;
  return /** @type {TrackChangesStorage} */ (storage);
};

/**
 * Reads the `replacements` mode from editor.options.trackedChanges.
 * Defaults to `'paired'` when unset; anything other than the exact
 * `'independent'` string is treated as paired to be defensive.
 */
const readReplacementsMode = (editor) =>
  editor?.options?.trackedChanges?.replacements === 'independent' ? 'independent' : 'paired';

/**
 * Runs the atomic decision engine, dispatches the resulting transaction, and
 * emits bubble lifecycle events from the decision receipt.
 */
const dispatchReviewDecision = ({ editor, state, dispatch, decision, target }) => {
  const trackChangesStorage = getTrackChangesStorage(editor);
  if (trackChangesStorage) {
    trackChangesStorage.lastDecisionFailure = null;
    trackChangesStorage.lastDecisionReceipt = null;
  }
  const result = decideTrackedChanges({
    state,
    editor,
    decision,
    target,
    replacements: readReplacementsMode(editor),
  });
  if (result.ok === false) {
    // Fail closed (do NOT mutate) for hard errors. NO_OP and
    // CAPABILITY_UNAVAILABLE return `false` so toolbar wrappers can decide
    // how to surface the result.
    if (trackChangesStorage) {
      trackChangesStorage.lastDecisionFailure = {
        code: result.code,
        message: result.message,
        details: result.details,
      };
    }
    return { applied: false, failure: result };
  }
  if (trackChangesStorage) {
    trackChangesStorage.lastDecisionReceipt = result.receipt ?? null;
  }
  if (dispatch) {
    // Compute the post-dispatch state locally so we can derive update events
    // for partial decisions (where a change has remaining tracked text on the
    // doc). Then dispatch the real transaction.
    const nextState = state.apply(result.tr);
    dispatch(result.tr);

    if (editor?.emit) {
      const documentId = editor.options?.documentId;
      // Partial decisions retire the original id and mint successor fragments
      // (splitFromId === originalId). For each retired id, decide whether to
      // emit `resolve` (no successors remain) or `update` (successors keep
      // the logical change alive with refreshed text).
      const resolveEvents = buildDecisionBubbleEvents({ result, editor });
      for (const event of resolveEvents) {
        const successorsPresent = collectRemainingForLogicalId({
          state: nextState,
          originalId: event.changeId,
        }).some(({ mark }) => mark.attrs?.splitFromId === event.changeId);
        if (successorsPresent) continue;
        // Carry the decision so resolved bubbles can report accepted vs
        // rejected instead of assuming every resolution was an accept.
        editor.emit('commentsUpdate', { ...event, decision });
      }

      const touched =
        result.touchedChangeIds instanceof Set ? result.touchedChangeIds : new Set(result.touchedChangeIds || []);
      const emittedFor = new Set();
      for (const changeId of touched) {
        if (emittedFor.has(changeId)) continue;
        // Skip ids that are successor fragments of another touched id (we
        // emit one update for the logical original id).
        if (
          Array.from(touched).some(
            (other) => other !== changeId && isSuccessorOf({ state: nextState, id: changeId, originalId: other }),
          )
        ) {
          continue;
        }
        const remaining = collectRemainingForLogicalId({ state: nextState, originalId: changeId });
        if (!remaining.length) continue;
        const payload = buildPartialUpdatePayload({
          state: nextState,
          documentId,
          originalId: changeId,
          remaining,
        });
        if (payload) {
          editor.emit('commentsUpdate', payload);
          emittedFor.add(changeId);
        }
      }

      const deletedCommentIds = new Set((result.receipt?.deletedComments ?? []).map(({ id }) => id).filter(Boolean));
      const detachedCommentIds = new Set(
        (result.receipt?.detachedComments ?? []).map(({ id }) => id).filter((id) => id && !deletedCommentIds.has(id)),
      );

      for (const commentId of deletedCommentIds) {
        editor.emit('commentsUpdate', buildDeletedCommentPayload({ commentId, documentId }));
      }
      for (const commentId of detachedCommentIds) {
        editor.emit('commentsUpdate', buildDetachedCommentUpdatePayload({ commentId, documentId }));
      }
    }
  }
  return { applied: true, result };
};

/**
 * Collect tracked-change marks that represent the logical original id, either
 * directly (mark.attrs.id === originalId) or via successor fragments
 * (mark.attrs.splitFromId === originalId).
 *
 * @param {{ state: import('prosemirror-state').EditorState, originalId: string }} options
 * @returns {import('./trackChangesHelpers/types.js').TrackedMarkRange[]}
 */
const collectRemainingForLogicalId = ({ state, originalId }) => {
  const all = getTrackChanges(state);
  return all.filter(({ mark }) => mark.attrs?.id === originalId || mark.attrs?.splitFromId === originalId);
};

const isSuccessorOf = ({ state, id, originalId }) => {
  const all = getTrackChanges(state);
  return all.some(({ mark }) => mark.attrs?.id === id && mark.attrs?.splitFromId === originalId);
};

/**
 * Build a comments-plugin-shaped `update` payload from the remaining
 * tracked-change marks for a logical original id. Aggregates inserted /
 * deleted text across all surviving successor fragments and uses the original
 * id as the changeId so existing bubble threads remain addressable.
 */
const buildPartialUpdatePayload = ({ state, documentId, originalId, remaining }) => {
  let insertedMark = null;
  let deletionMark = null;
  let formatMark = null;
  for (const entry of remaining) {
    if (!insertedMark && entry.mark.type.name === TrackInsertMarkName) insertedMark = entry.mark;
    if (!deletionMark && entry.mark.type.name === TrackDeleteMarkName) deletionMark = entry.mark;
    if (!formatMark && entry.mark.type.name === TrackFormatMarkName) formatMark = entry.mark;
  }
  const anchorMark = insertedMark || deletionMark || formatMark;
  if (!anchorMark) return null;

  const insertedText = remaining
    .filter(({ mark }) => mark.type.name === TrackInsertMarkName)
    .map(({ node }) => node?.text || node?.textContent || '')
    .join('');
  const deletedText = remaining
    .filter(({ mark }) => mark.type.name === TrackDeleteMarkName)
    .map(({ node }) => node?.text || node?.textContent || '')
    .join('');

  const trackedChangeType = insertedMark
    ? TrackInsertMarkName
    : deletionMark
      ? TrackDeleteMarkName
      : TrackFormatMarkName;
  const isReplacement = Boolean(insertedMark && deletionMark);
  const { author, authorId, authorEmail, authorImage, date, importedAuthor } = anchorMark.attrs;

  return {
    event: 'update',
    type: 'trackedChange',
    documentId,
    changeId: originalId,
    trackedChangeType: isReplacement ? 'both' : trackedChangeType,
    trackedChangeText: trackedChangeType === TrackDeleteMarkName ? deletedText : insertedText,
    trackedChangeDisplayType: null,
    deletedText: isReplacement || deletionMark ? deletedText : null,
    author,
    ...(authorId && { authorId }),
    authorEmail,
    ...(authorImage && { authorImage }),
    date,
    ...(importedAuthor && { importedAuthor: { name: importedAuthor } }),
  };
};

const buildDetachedCommentUpdatePayload = ({ commentId, documentId }) => ({
  type: 'update',
  comment: {
    commentId,
    documentId,
    fileId: documentId ?? null,
    trackedChange: false,
    trackedChangeParentId: null,
    trackedChangeType: null,
    trackedChangeDisplayType: null,
    trackedChangeText: null,
    trackedChangeStory: null,
    trackedChangeStoryKind: null,
    trackedChangeStoryLabel: null,
    trackedChangeAnchorKey: null,
    deletedText: null,
  },
});

const buildDeletedCommentPayload = ({ commentId, documentId }) => ({
  type: 'deleted',
  comment: {
    commentId,
    documentId,
    fileId: documentId ?? null,
  },
});

export const TrackChanges = Extension.create({
  name: 'trackChanges',

  addStorage() {
    return {
      lastCompilerFailure: null,
      lastDecisionFailure: null,
      lastDecisionReceipt: null,
    };
  },

  addCommands() {
    return {
      acceptTrackedChangesBetween:
        (from, to) =>
        ({ state, dispatch, editor }) => {
          const reviewDecision = dispatchReviewDecision({
            editor,
            state,
            dispatch,
            decision: 'accept',
            target: { kind: 'range', from, to },
          });
          return reviewDecision.applied;
        },

      rejectTrackedChangesBetween:
        (from, to) =>
        ({ state, dispatch, editor }) => {
          const reviewDecision = dispatchReviewDecision({
            editor,
            state,
            dispatch,
            decision: 'reject',
            target: { kind: 'range', from, to },
          });
          return reviewDecision.applied;
        },

      acceptTrackedChange:
        ({ trackedChange }) =>
        ({ commands }) => {
          const { start: from, end: to } = trackedChange;
          return commands.acceptTrackedChangesBetween(from, to);
        },

      acceptTrackedChangeBySelection:
        () =>
        ({ state, commands }) => {
          const { from, to } = state.selection;
          return commands.acceptTrackedChangesBetween(from, to);
        },

      acceptTrackedChangeFromToolbar:
        () =>
        ({ state, commands, editor }) => {
          return resolveTrackedChangeAction({
            action: 'accept',
            state,
            commands,
            editor,
            ...getTrackedChangeResolutionContext({
              state,
              trackedChangeId: CommentsPluginKey.getState(state)?.activeThreadId,
            }),
          });
        },

      acceptTrackedChangeFromContextMenu:
        ({ from = null, to = null, trackedChangeId = null } = {}) =>
        ({ state, commands, editor }) => {
          return resolveTrackedChangeAction({
            action: 'accept',
            state,
            commands,
            editor,
            selection:
              Number.isFinite(from) && Number.isFinite(to)
                ? {
                    from,
                    to,
                  }
                : null,
            ...getTrackedChangeResolutionContext({ state, trackedChangeId }),
          });
        },

      acceptTrackedChangeById:
        (id, options = {}) =>
        ({ state, dispatch, editor }) => {
          const reviewDecision = dispatchReviewDecision({
            editor,
            state,
            dispatch,
            decision: 'accept',
            target: { kind: 'id', id, ...(options.side ? { side: options.side } : {}) },
          });
          return reviewDecision.applied;
        },

      acceptAllTrackedChanges:
        () =>
        ({ state, dispatch, editor }) => {
          const reviewDecision = dispatchReviewDecision({
            editor,
            state,
            dispatch,
            decision: 'accept',
            target: { kind: 'all' },
          });
          return reviewDecision.applied;
        },

      rejectTrackedChangeById:
        (id, options = {}) =>
        ({ state, dispatch, editor }) => {
          const reviewDecision = dispatchReviewDecision({
            editor,
            state,
            dispatch,
            decision: 'reject',
            target: { kind: 'id', id, ...(options.side ? { side: options.side } : {}) },
          });
          return reviewDecision.applied;
        },

      rejectTrackedChange:
        ({ trackedChange }) =>
        ({ commands }) => {
          const { start: from, end: to } = trackedChange;
          return commands.rejectTrackedChangesBetween(from, to);
        },

      rejectTrackedChangeOnSelection:
        () =>
        ({ state, commands }) => {
          const { from, to } = state.selection;
          return commands.rejectTrackedChangesBetween(from, to);
        },

      rejectTrackedChangeFromToolbar:
        () =>
        ({ state, commands, editor }) => {
          return resolveTrackedChangeAction({
            action: 'reject',
            state,
            commands,
            editor,
            ...getTrackedChangeResolutionContext({
              state,
              trackedChangeId: CommentsPluginKey.getState(state)?.activeThreadId,
            }),
          });
        },

      rejectTrackedChangeFromContextMenu:
        ({ from = null, to = null, trackedChangeId = null } = {}) =>
        ({ state, commands, editor }) => {
          return resolveTrackedChangeAction({
            action: 'reject',
            state,
            commands,
            editor,
            selection:
              Number.isFinite(from) && Number.isFinite(to)
                ? {
                    from,
                    to,
                  }
                : null,
            ...getTrackedChangeResolutionContext({ state, trackedChangeId }),
          });
        },

      rejectAllTrackedChanges:
        () =>
        ({ state, dispatch, editor }) => {
          const reviewDecision = dispatchReviewDecision({
            editor,
            state,
            dispatch,
            decision: 'reject',
            target: { kind: 'all' },
          });
          return reviewDecision.applied;
        },

      insertTrackedChange:
        (options = {}) =>
        ({ state, dispatch, editor }) => {
          const {
            from = state.selection.from,
            to = state.selection.to,
            text = '',
            id,
            user,
            comment,
            addToHistory = true,
            emitCommentEvent = true,
          } = options;

          // Validate bounds to prevent RangeError
          const docSize = state.doc.content.size;
          if (from < 0 || to > docSize || from > to) {
            console.warn('insertTrackedChange: invalid range', { from, to, docSize });
            return false;
          }

          // Check if there's actually a change to make
          const originalText = state.doc.textBetween(from, to, '', '');
          if (originalText === text) {
            return false;
          }

          if (!dispatch) {
            return true;
          }

          const resolvedUser = { ...(user ?? editor?.options?.user ?? {}) };
          // Validate and snapshot an attached comment's account before the tracked edit mutates state.
          if (comment?.trim()) resolvedUser.wordIdentity = snapshotWordIdentity(resolvedUser.wordIdentity);

          // Warn if user info is missing - marks will have undefined author
          if (!resolvedUser.name && !resolvedUser.email) {
            console.warn('insertTrackedChange: no user name/email provided, track change will have undefined author');
          }
          const date = new Date().toISOString();

          return dispatchCompiledInsertTrackedChange({
            editor,
            state,
            dispatch,
            from,
            to,
            text,
            resolvedUser,
            date,
            providedId: id,
            comment,
            addToHistory,
            emitCommentEvent,
          });
        },

      toggleTrackChanges:
        () =>
        ({ state }) => {
          const trackChangeState = TrackChangesBasePluginKey.getState(state);
          if (trackChangeState === undefined) return false;
          state.tr.setMeta(TrackChangesBasePluginKey, {
            type: 'TRACK_CHANGES_ENABLE',
            value: !trackChangeState.isTrackChangesActive,
          });
          return true;
        },

      enableTrackChanges:
        () =>
        ({ state }) => {
          state.tr.setMeta(TrackChangesBasePluginKey, {
            type: 'TRACK_CHANGES_ENABLE',
            value: true,
          });
          return true;
        },

      disableTrackChanges:
        () =>
        ({ state }) => {
          state.tr.setMeta(TrackChangesBasePluginKey, {
            type: 'TRACK_CHANGES_ENABLE',
            value: false,
          });
          return true;
        },

      toggleTrackChangesShowOriginal:
        () =>
        ({ state }) => {
          const trackChangeState = TrackChangesBasePluginKey.getState(state);
          if (trackChangeState === undefined) return false;
          state.tr.setMeta(TrackChangesBasePluginKey, {
            type: 'SHOW_ONLY_ORIGINAL',
            value: !trackChangeState.onlyOriginalShown,
          });
          return true;
        },

      enableTrackChangesShowOriginal:
        () =>
        ({ state }) => {
          state.tr.setMeta(TrackChangesBasePluginKey, {
            type: 'SHOW_ONLY_ORIGINAL',
            value: true,
          });
          return true;
        },

      disableTrackChangesShowOriginal:
        () =>
        ({ state }) => {
          state.tr.setMeta(TrackChangesBasePluginKey, {
            type: 'SHOW_ONLY_ORIGINAL',
            value: false,
          });
          return true;
        },

      toggleTrackChangesShowFinal:
        () =>
        ({ state }) => {
          const trackChangeState = TrackChangesBasePluginKey.getState(state);
          if (trackChangeState === undefined) return false;
          state.tr.setMeta(TrackChangesBasePluginKey, {
            type: 'SHOW_ONLY_MODIFIED',
            value: !trackChangeState.onlyModifiedShown,
          });
          return true;
        },

      enableTrackChangesShowFinal:
        () =>
        ({ state }) => {
          state.tr.setMeta(TrackChangesBasePluginKey, {
            type: 'SHOW_ONLY_MODIFIED',
            value: true,
          });
          return true;
        },
    };
  },

  addPmPlugins() {
    return [TrackChangesBasePlugin()];
  },
});

const getTrackedChangeActionSelection = ({ state, editor }) => {
  const currentSelection = state?.selection;
  if (hasExpandedSelection(currentSelection)) {
    return currentSelection;
  }

  const preservedSelection = editor?.options?.preservedSelection ?? editor?.options?.lastSelection;
  if (hasExpandedSelection(preservedSelection)) {
    return preservedSelection;
  }

  return currentSelection;
};

const getTrackedChangeResolutionContext = ({ state, trackedChangeId = null }) => {
  const commentsPluginState = CommentsPluginKey.getState(state);
  const resolvedTrackedChangeId = trackedChangeId ?? commentsPluginState?.activeThreadId ?? null;
  const hasTrackedChangeInCache = Boolean(
    resolvedTrackedChangeId && commentsPluginState?.trackedChanges?.[resolvedTrackedChangeId],
  );
  const hasTrackedChangeInDocument = Boolean(
    resolvedTrackedChangeId && getChangesByIdToResolve(state, resolvedTrackedChangeId)?.length,
  );

  return {
    trackedChangeId: resolvedTrackedChangeId,
    hasKnownTrackedChangeId: hasTrackedChangeInCache || hasTrackedChangeInDocument,
  };
};

const selectionTouchesTrackedChange = ({ state, trackedChangeId, selection = state?.selection }) => {
  if (!selection) {
    return false;
  }

  if (!trackedChangeId) {
    return (
      collectTrackedChanges({
        state,
        from: selection.from,
        to: selection.to,
      }).length > 0
    );
  }

  return collectTrackedChanges({
    state,
    from: selection.from,
    to: selection.to,
  }).some((change) => change.id === trackedChangeId);
};

const resolveTrackedChangeAction = ({
  action,
  state,
  commands,
  editor,
  trackedChangeId = null,
  hasKnownTrackedChangeId = false,
  selection = null,
}) => {
  const targetSelection = selection ?? getTrackedChangeActionSelection({ state, editor });
  const betweenCommand =
    action === 'accept' ? commands.acceptTrackedChangesBetween : commands.rejectTrackedChangesBetween;
  const byIdCommand = action === 'accept' ? commands.acceptTrackedChangeById : commands.rejectTrackedChangeById;
  const selectionCommand =
    action === 'accept' ? commands.acceptTrackedChangeBySelection : commands.rejectTrackedChangeOnSelection;
  const shouldUseSelection =
    hasExpandedSelection(targetSelection) &&
    selectionTouchesTrackedChange({
      state,
      trackedChangeId,
      selection: targetSelection,
    });

  // An explicit text selection takes precedence over the active bubble/thread
  // so partial accept/reject resolves exactly what the user highlighted.
  if (shouldUseSelection) {
    return betweenCommand(targetSelection.from, targetSelection.to);
  }

  if (trackedChangeId && hasKnownTrackedChangeId) {
    return byIdCommand(trackedChangeId);
  }

  return hasExpandedSelection(targetSelection)
    ? betweenCommand(targetSelection.from, targetSelection.to)
    : selectionCommand();
};

const getChangesByIdToResolve = (state, id) => {
  const trackedChanges = getTrackChanges(state);
  const changeIndex = trackedChanges.findIndex(({ mark }) => mark.attrs.id === id);
  if (changeIndex === -1) return;

  const matchingChange = trackedChanges[changeIndex];
  const matchingId = matchingChange.mark.attrs.id;

  // The neighbor walk collects every adjacent segment that shares the same id.
  // This catches:
  //   - A single logical mark split across multiple segments (e.g. because
  //     surrounding text marks differ) — always correct to resolve together.
  //   - The paired opposite-type mark when replacements='paired' (shared id).
  // In 'independent' mode, the ins/del halves have distinct ids so the walk
  // stops at the revision boundary naturally — no special casing needed here.

  const linkedBefore = [];
  const linkedAfter = [];

  const collectDirection = (direction, collection) => {
    let currentIndex = changeIndex;
    let currentChange = matchingChange;

    while (true) {
      const neighborIndex = currentIndex + direction;
      const neighbor = trackedChanges[neighborIndex];

      if (!neighbor) {
        break;
      }

      const sharesId = neighbor.mark.attrs.id === matchingId;
      if (!sharesId) {
        break;
      }

      collection.push(neighbor);

      currentIndex = neighborIndex;
      currentChange = neighbor;
    }
  };

  collectDirection(-1, linkedBefore);
  collectDirection(1, linkedAfter);

  return [matchingChange, ...linkedAfter, ...linkedBefore];
};

/**
 * Routes the document-api tracked text mutation through the shared overlap
 * compiler so native and document-api semantics agree.
 *
 * @param {{
 *   editor: import('../../core/Editor.ts').Editor,
 *   state: import('prosemirror-state').EditorState,
 *   dispatch: (tr: import('prosemirror-state').Transaction) => void,
 *   from: number,
 *   to: number,
 *   text: string,
 *   resolvedUser: object,
 *   date: string,
 *   providedId?: string,
 *   comment?: string,
 *   addToHistory: boolean,
 *   emitCommentEvent: boolean,
 * }} options
 */
const dispatchCompiledInsertTrackedChange = ({
  editor,
  state,
  dispatch,
  from,
  to,
  text,
  resolvedUser,
  date,
  providedId,
  comment,
  addToHistory,
  emitCommentEvent,
}) => {
  const replacements = readReplacementsMode(editor);
  const tr = state.tr;
  const schema = state.schema;
  const trackChangesStorage = getTrackChangesStorage(editor);
  if (trackChangesStorage) {
    trackChangesStorage.lastCompilerFailure = null;
  }
  const activeMarks = state.storedMarks ?? state.doc.resolve(from).marks();
  let intent;
  try {
    if (from === to && text) {
      intent = makeTextInsertIntent({
        at: from,
        content: sliceFromText(schema, text, activeMarks),
        user: resolvedUser,
        date,
        source: 'document-api',
        replacementGroupHint: providedId,
      });
    } else if (from !== to && !text) {
      intent = makeTextDeleteIntent({
        from,
        to,
        user: resolvedUser,
        date,
        source: 'document-api',
        replacementGroupHint: providedId,
      });
    } else if (from !== to && text) {
      intent = makeTextReplaceIntent({
        from,
        to,
        content: sliceFromText(schema, text, activeMarks),
        replacements,
        user: resolvedUser,
        date,
        source: 'document-api',
        replacementGroupHint: providedId,
      });
    } else {
      return false;
    }
  } catch (error) {
    console.warn('insertTrackedChange: could not build intent', error);
    return false;
  }

  const result = compileTrackedEdit({
    state,
    tr,
    intent,
    replacements,
  });

  if (result.ok === false) {
    if (trackChangesStorage) {
      trackChangesStorage.lastCompilerFailure = {
        code: result.code,
        message: result.message,
        details: result.details,
      };
    }
    return false;
  }
  if (!dispatch) {
    return true;
  }

  // Build real metadata for the comments plugin from the compiler result so
  // the bubble pipeline can derive the inserted/deleted text immediately
  // without re-scanning the doc.
  const insertedNodes = result.insertedNodes ?? [];
  const deletionNodes = result.deletionNodes ?? [];
  const meta = {
    insertedMark: result.insertedMark || null,
    deletionMark: result.deletionMark || result.deletionMarks?.[0] || null,
    deletionNodes,
    step: result.insertedStep
      ? result.insertedStep
      : result.insertedMark
        ? { slice: { content: { content: insertedNodes } } }
        : null,
    emitCommentEvent,
  };
  tr.setMeta(TrackChangesBasePluginKey, meta);
  tr.setMeta(CommentsPluginKey, { type: 'force' });
  tr.setMeta('skipTrackChanges', true);
  if (!addToHistory) {
    tr.setMeta('addToHistory', false);
  }

  dispatch(tr);

  // Compute a public-facing change id for the comment thread: prefer the
  // explicit id the caller provided; otherwise the first created/updated
  // change id from the compiler receipt.
  const changeId = providedId || result.createdChangeIds?.[0] || result.updatedChangeIds?.[0] || null;
  if (comment?.trim() && changeId && editor.commands?.addCommentReply) {
    editor.commands.addCommentReply({
      parentId: changeId,
      content: comment,
      author: resolvedUser.name,
      authorId: resolvedUser.id,
      authorEmail: resolvedUser.email,
      authorImage: resolvedUser.image,
      authorIdentity: resolvedUser.wordIdentity,
    });
  }

  return true;
};
