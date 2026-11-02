import { DOCUMENT_EDITOR_SELECTION_SOURCE } from '../../helpers/selection-source.js';

export type PendingSelectionHost =
  | {
      activeEditor?: {
        options?: { documentId?: unknown } | null;
        doc?: { selection?: { current?: () => unknown } | null } | null;
      } | null;
    }
  | null
  | undefined;

export type PendingActiveSelection = { source?: unknown; documentId?: unknown } | null | undefined;

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  (typeof value === 'object' || typeof value === 'function') &&
  value !== null &&
  'then' in value &&
  typeof value.then === 'function';

export const getPendingSelectionSnapshot = (
  superdoc: PendingSelectionHost,
  activeSelection: PendingActiveSelection,
): unknown => {
  if (activeSelection?.source !== DOCUMENT_EDITOR_SELECTION_SOURCE) return null;

  const selectionDocumentId = activeSelection?.documentId ?? null;
  const editorDocumentId = superdoc?.activeEditor?.options?.documentId ?? null;
  if (!selectionDocumentId || !editorDocumentId || selectionDocumentId !== editorDocumentId) {
    return null;
  }

  let currentSelection: (() => unknown) | undefined;
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
