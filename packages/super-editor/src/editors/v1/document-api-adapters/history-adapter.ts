import type { HistoryAdapter, HistoryState, HistoryActionResult, OperationId } from '@superdoc/document-api';
import { OPERATION_IDS, COMMAND_CATALOG } from '@superdoc/document-api';
import type { Editor } from '../core/Editor.js';
import { getRevision } from './plan-engine/revision-tracker.js';
import { DocumentApiAdapterError } from './errors.js';
import { readEditorHistorySnapshot, type DocumentHistoryState } from '../core/presentation-editor/history/index.js';
import { reconcileCommentEntityStoreWithAnchors, type CommentEntityRecord } from './helpers/comment-entity-store.js';
import { listCommentAnchors } from './helpers/comment-target-resolver.js';

/**
 * Minimal PresentationEditor surface the history adapter needs.
 *
 * The root document API is assembled from the body editor. When that editor
 * belongs to a PresentationEditor, history must route through the presentation
 * layer so body/header/footer/note undo stays aligned with the visible UI.
 */
type RootPresentationHistoryOwner = {
  editor: Editor;
  getHistoryState: () => DocumentHistoryState;
  undo: () => boolean;
  redo: () => boolean;
};

function getRootPresentationHistoryOwner(editor: Editor): RootPresentationHistoryOwner | null {
  const withPresentation = editor as Editor & {
    presentationEditor?: RootPresentationHistoryOwner | null;
    _presentationEditor?: RootPresentationHistoryOwner | null;
  };
  const presentationEditor = withPresentation.presentationEditor ?? withPresentation._presentationEditor ?? null;
  if (!presentationEditor) return null;
  if (presentationEditor.editor !== editor) return null;
  return presentationEditor;
}

/** Cached list of history-unsafe operation IDs, computed once from the catalog. */
const HISTORY_UNSAFE_OPS: readonly OperationId[] = OPERATION_IDS.filter(
  (id) => COMMAND_CATALOG[id].historyUnsafe === true,
);

/**
 * Read the current undo/redo depths for this adapter target.
 *
 * Root editor adapters proxy through PresentationEditor so the document API
 * exposes the same history state the visible UI does. Sub-editor adapters stay
 * intentionally surface-scoped.
 */
function readHistoryDepths(editor: Editor): { undoDepth: number; redoDepth: number } {
  const presentationOwner = getRootPresentationHistoryOwner(editor);
  if (presentationOwner) {
    const state = presentationOwner.getHistoryState();
    return { undoDepth: state.undoDepth, redoDepth: state.redoDepth };
  }
  return readEditorHistorySnapshot(editor);
}

function runHistoryCommand(editor: Editor, action: 'undo' | 'redo'): boolean {
  const presentationOwner = getRootPresentationHistoryOwner(editor);
  if (presentationOwner) {
    return action === 'undo' ? presentationOwner.undo() : presentationOwner.redo();
  }

  const command = editor.commands?.[action];
  if (typeof command !== 'function') {
    throw new DocumentApiAdapterError('CAPABILITY_UNAVAILABLE', `history.${action} command is not available.`, {
      reason: 'missing_command',
    });
  }

  return Boolean(command());
}

function buildAnchoredCommentIdSet(editor: Editor): Set<string> {
  const ids = new Set<string>();
  try {
    for (const anchor of listCommentAnchors(editor)) {
      if (typeof anchor.commentId === 'string' && anchor.commentId.length > 0) ids.add(anchor.commentId);
      if (typeof anchor.importedId === 'string' && anchor.importedId.length > 0) ids.add(anchor.importedId);
    }
  } catch {
    return ids;
  }
  return ids;
}

function buildCommentLifecyclePayload(record: CommentEntityRecord): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    commentId: record.commentId,
  };

  if (record.importedId !== undefined) payload.importedId = record.importedId;
  if (record.parentCommentId !== undefined) payload.parentCommentId = record.parentCommentId;
  if (record.commentText !== undefined) {
    payload.commentText = record.commentText;
    payload.text = record.commentText;
  }
  if (record.commentJSON !== undefined) payload.commentJSON = record.commentJSON;
  if (record.creatorIdentity !== undefined) payload.creatorIdentity = record.creatorIdentity;
  if (record.wordAuthorName !== undefined) payload.wordAuthorName = record.wordAuthorName;
  if (record.creatorName !== undefined) payload.creatorName = record.creatorName;
  if (record.creatorEmail !== undefined) payload.creatorEmail = record.creatorEmail;
  if (record.creatorImage !== undefined) payload.creatorImage = record.creatorImage;
  if (record.createdTime !== undefined) payload.createdTime = record.createdTime;
  if (record.isInternal !== undefined) payload.isInternal = record.isInternal;
  if (record.isDone !== undefined) payload.isDone = record.isDone;
  if (record.resolvedTime !== undefined) payload.resolvedTime = record.resolvedTime;
  if (record.fileId !== undefined) payload.fileId = record.fileId;
  if (record.documentId !== undefined) payload.documentId = record.documentId;

  return payload;
}

function emitCommentLifecycleEvents(
  editor: Editor,
  type: 'add' | 'deleted',
  records: ReadonlyArray<CommentEntityRecord>,
): void {
  const emitter = (editor as Editor & { emit?: (event: string, payload: Record<string, unknown>) => void }).emit;
  if (typeof emitter !== 'function') return;

  for (const record of records) {
    emitter.call(editor, 'commentsUpdate', {
      type,
      comment: buildCommentLifecyclePayload(record),
    });
  }
}

function reconcileCommentHistorySideEffects(editor: Editor): void {
  const anchorIds = buildAnchoredCommentIdSet(editor);
  const { restored, removed } = reconcileCommentEntityStoreWithAnchors(editor, anchorIds);
  if (removed.length > 0) emitCommentLifecycleEvents(editor, 'deleted', removed);
  if (restored.length > 0) emitCommentLifecycleEvents(editor, 'add', restored);
}

export function createHistoryAdapter(editor: Editor): HistoryAdapter {
  return {
    get(): HistoryState {
      const { undoDepth: ud, redoDepth: rd } = readHistoryDepths(editor);
      return {
        undoDepth: ud,
        redoDepth: rd,
        canUndo: ud > 0,
        canRedo: rd > 0,
        historyUnsafeOperations: HISTORY_UNSAFE_OPS,
      };
    },

    undo(): HistoryActionResult {
      const revBefore = getRevision(editor);
      const depth = readHistoryDepths(editor).undoDepth;
      if (depth === 0) {
        return { noop: true, reason: 'EMPTY_UNDO_STACK', revision: { before: revBefore, after: revBefore } };
      }
      const success = runHistoryCommand(editor, 'undo');
      if (success) reconcileCommentHistorySideEffects(editor);
      const revAfter = getRevision(editor);
      return {
        noop: !success,
        reason: success ? undefined : 'NO_EFFECT',
        revision: { before: revBefore, after: revAfter },
      };
    },

    redo(): HistoryActionResult {
      const revBefore = getRevision(editor);
      const depth = readHistoryDepths(editor).redoDepth;
      if (depth === 0) {
        return { noop: true, reason: 'EMPTY_REDO_STACK', revision: { before: revBefore, after: revBefore } };
      }
      const success = runHistoryCommand(editor, 'redo');
      if (success) reconcileCommentHistorySideEffects(editor);
      const revAfter = getRevision(editor);
      return {
        noop: !success,
        reason: success ? undefined : 'NO_EFFECT',
        revision: { before: revBefore, after: revAfter },
      };
    },
  };
}
