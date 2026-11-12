import { DOCUMENT_EDITOR_SELECTION_SOURCE } from '../../helpers/selection-source.js';

export type PendingSelectionHost<Snapshot = unknown> =
  | {
      activeEditor?: {
        options?: { documentId?: unknown } | null;
        doc?: { selection?: { current?: () => Snapshot | PromiseLike<Snapshot> } | null } | null;
      } | null;
    }
  | null
  | undefined;

export type PendingActiveSelection = { source?: unknown; documentId?: unknown } | null | undefined;

const isThenable = <Snapshot>(value: Snapshot | PromiseLike<Snapshot>): value is PromiseLike<Snapshot> =>
  (typeof value === 'object' || typeof value === 'function') &&
  value !== null &&
  'then' in value &&
  typeof value.then === 'function';

export const getPendingSelectionSnapshot = <Snapshot>(
  superdoc: PendingSelectionHost<Snapshot>,
  activeSelection: PendingActiveSelection,
): Snapshot | Promise<Snapshot | null> | null => {
  if (activeSelection?.source !== DOCUMENT_EDITOR_SELECTION_SOURCE) return null;

  const selectionDocumentId = activeSelection?.documentId ?? null;
  const editorDocumentId = superdoc?.activeEditor?.options?.documentId ?? null;
  if (!selectionDocumentId || !editorDocumentId || selectionDocumentId !== editorDocumentId) {
    return null;
  }

  let currentSelection: (() => Snapshot | PromiseLike<Snapshot>) | undefined;
  try {
    currentSelection = superdoc?.activeEditor?.doc?.selection?.current;
  } catch {
    return null;
  }

  if (typeof currentSelection !== 'function') return null;

  try {
    const snapshot = currentSelection();
    return isThenable(snapshot) ? Promise.resolve(snapshot).catch(() => null) : snapshot;
  } catch {
    return null;
  }
};
