/**
 * Snapshot adapter that works for both PM-history-backed and Yjs-backed editors.
 *
 * The backend type is determined from the editor's current options whenever
 * a snapshot is read. This allows an adapter created for a local editor to
 * switch to Yjs history after `upgradeToCollaboration()` attaches a provider
 * and ydoc in place.
 */

import { undoDepth, redoDepth } from 'prosemirror-history';
import { yUndoPluginKey } from 'y-prosemirror';
import type { Editor } from '../../Editor.js';
import { runEditorUndo, runEditorRedo } from '../../../extensions/history/history.js';
import type { HistorySnapshotAdapter, ParticipantHistoryChangeKind, ParticipantHistorySnapshot } from './types.js';

type EditorWithCollab = Editor & {
  options: Editor['options'] & {
    collaborationProvider?: unknown;
    ydoc?: unknown;
  };
};

const isYjsBacked = (editor: Editor): boolean => {
  const opts = (editor as EditorWithCollab).options;
  return Boolean(opts?.collaborationProvider && opts?.ydoc);
};

const readYjsDepths = (editor: Editor): ParticipantHistorySnapshot => {
  if (!editor.state) return { undoDepth: 0, redoDepth: 0 };
  const pluginState = yUndoPluginKey.getState(editor.state);
  const manager = pluginState?.undoManager;
  return {
    undoDepth: manager?.undoStack?.length ?? 0,
    redoDepth: manager?.redoStack?.length ?? 0,
  };
};

const readPmDepths = (editor: Editor): ParticipantHistorySnapshot => {
  if (!editor.state) return { undoDepth: 0, redoDepth: 0 };
  try {
    return {
      undoDepth: undoDepth(editor.state),
      redoDepth: redoDepth(editor.state),
    };
  } catch {
    return { undoDepth: 0, redoDepth: 0 };
  }
};

/**
 * Read the current local undo/redo depths for any editor surface.
 *
 * This is the single shared depth reader for:
 * - the unified-history coordinator's participant adapters
 * - PresentationEditor's legacy fallback history state
 * - document-api / toolbar history surfaces that need raw editor depths
 */
export const readEditorHistorySnapshot = (editor: Editor): ParticipantHistorySnapshot => {
  return isYjsBacked(editor) ? readYjsDepths(editor) : readPmDepths(editor);
};

/**
 * Adapter that wraps a single editor (body, header, footer, note, …) and
 * exposes a uniform snapshot/undo/redo surface for the coordinator.
 */
export class EditorHistorySnapshotAdapter implements HistorySnapshotAdapter {
  readonly #editor: Editor;
  #pendingChangeKind: ParticipantHistoryChangeKind = 'unknown';

  constructor(editor: Editor) {
    this.#editor = editor;
  }

  getSnapshot(): ParticipantHistorySnapshot {
    if (isYjsBacked(this.#editor)) {
      return readYjsDepths(this.#editor);
    }
    return readPmDepths(this.#editor);
  }

  undo(): boolean {
    return Boolean(runEditorUndo(this.#editor));
  }

  redo(): boolean {
    return Boolean(runEditorRedo(this.#editor));
  }

  consumePendingChangeKind(): ParticipantHistoryChangeKind {
    const changeKind = this.#pendingChangeKind;
    this.#pendingChangeKind = 'unknown';
    return changeKind;
  }

  /**
   * Subscribe to history-relevant changes on this editor.
   *
   * We listen to the `transaction` event because both PM's history plugin and
   * Yjs's `yUndoPlugin` update their stacks synchronously within the
   * transaction that triggered them — reading depths in the handler sees the
   * post-change values.
   */
  subscribe(onChange: () => void): () => void {
    const editor = this.#editor as Editor & {
      on?: (
        event: string,
        handler: (payload?: { transaction?: { docChanged?: boolean; getMeta?: (key: string) => unknown } }) => void,
      ) => void;
      off?: (
        event: string,
        handler: (payload?: { transaction?: { docChanged?: boolean; getMeta?: (key: string) => unknown } }) => void,
      ) => void;
    };
    if (!editor.on || !editor.off) return () => {};
    const handleTransaction = (payload?: {
      transaction?: {
        docChanged?: boolean;
        getMeta?: (key: string) => unknown;
      };
    }) => {
      this.#pendingChangeKind = classifyTransaction(payload?.transaction);
      onChange();
    };
    editor.on('transaction', handleTransaction);
    return () => editor.off?.('transaction', handleTransaction);
  }
}

const classifyTransaction = (transaction?: {
  docChanged?: boolean;
  getMeta?: (key: string) => unknown;
}): ParticipantHistoryChangeKind => {
  const inputType = transaction?.getMeta?.('inputType');
  if (inputType === 'historyUndo') return 'undo';
  if (inputType === 'historyRedo') return 'redo';
  if (transaction?.docChanged && transaction.getMeta?.('addToHistory') !== false) {
    return 'edit';
  }
  return 'unknown';
};
