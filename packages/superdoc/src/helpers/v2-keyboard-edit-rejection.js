import { createV2MutationRejectionCause, createV2MutationRejectionNotificationGate } from './v2-mutation-exception.js';

const EDIT_INPUT_KINDS = new Set([
  'keydown',
  'beforeinput',
  'compositionend',
  'cut',
  'paste',
  'drop',
  'pointerup',
  'programmatic',
]);
const EDIT_COMMAND_KINDS = new Set([
  'insert-text',
  'replace-text',
  'delete-backward',
  'delete-forward',
  'plain-text-paste',
  'clipboard-paste',
  'image-delete',
  'image-drop',
  'image-paste',
  'image-move',
  'sdt-move',
  'structural:enter-split-paragraph',
  'structural:enter-insert-paragraph-before',
  'structural:enter-insert-paragraph-after',
  'structural:enter-list-outdent',
  'structural:enter-list-exit',
  'structural:shift-enter-line-break',
  'structural:mod-enter-page-break',
  'structural:backspace-boundary-merge-with-previous',
  'structural:delete-boundary-merge-with-next',
  'structural:list-indent',
  'structural:list-outdent',
  'tab:paragraph-insert-tab',
  'tab:list-indent-range',
  'tab:list-outdent-range',
  'tab:table-append-row',
]);
const EDIT_INPUT_WITHOUT_COMMAND_KINDS = new Set(['beforeinput', 'compositionend', 'cut', 'paste', 'drop']);
const EDIT_FAILURE_SOURCES = new Set(['shell', 'receipt']);

export const V2_EDIT_REJECTED_CODE = 'edit-rejected';
export const V2_EDIT_REJECTED_MESSAGE = 'This edit couldn’t be completed. Adjust the selection and try again.';

export function isV2KeyboardEditRejection(event) {
  return Boolean(
    event &&
    event.type === 'mutation:rejected' &&
    event.origin === 'document-surface' &&
    EDIT_FAILURE_SOURCES.has(event.failureSource) &&
    EDIT_INPUT_KINDS.has(event.inputKind) &&
    (EDIT_COMMAND_KINDS.has(event.editableCommandKind) ||
      (event.editableCommandKind == null && EDIT_INPUT_WITHOUT_COMMAND_KINDS.has(event.inputKind))),
  );
}

export function createV2KeyboardEditRejectionException(documentId, event) {
  return {
    error: new Error(V2_EDIT_REJECTED_MESSAGE, { cause: createV2MutationRejectionCause(event) }),
    code: V2_EDIT_REJECTED_CODE,
    editor: null,
    ...(typeof documentId === 'string' && documentId.length > 0 ? { documentId } : {}),
  };
}

export function createV2KeyboardEditRejectionNotificationGate() {
  return createV2MutationRejectionNotificationGate(isV2KeyboardEditRejection);
}
