/**
 * Command kinds whose committed mutations belong to the sustained typing
 * cadence class (insert / replace / plain paste / Backspace / Delete).
 *
 * The SuperDoc shell debounces per-keystroke review-row hydration for these
 * kinds instead of refreshing comments + tracked changes on every commit —
 * hydrating immediately per keystroke was a measured worker-read storm during
 * typing and backspace bursts. The `text.*` aliases cover integrations that
 * forward Document API style command ids rather than editable-input kinds.
 */
const V2_TYPING_COMMAND_KINDS: ReadonlySet<unknown> = new Set([
  'insert-text',
  'replace-text',
  'plain-text-paste',
  'delete-backward',
  'delete-forward',
  'text.insert',
  'text.replace',
  'text.pastePlain',
  'text.deleteBackward',
  'text.deleteForward',
  // Structural keyboard commits ride the same sustained cadence: Enter
  // splits/inserts, Shift+Enter line breaks, and Backspace/Delete boundary
  // merges (`structural:*` from the host/editable-input structural path,
  // `backspace:*` from the backspace controller, `structural.enter` from the
  // host dispatch seam).
  'structural.enter',
  'structural:enter-split-paragraph',
  'structural:enter-insert-paragraph-before',
  'structural:enter-insert-paragraph-after',
  'structural:shift-enter-line-break',
  'structural:backspace-boundary-merge-with-previous',
  'structural:delete-boundary-merge-with-next',
  'backspace:boundary-merge-with-previous',
  'backspace:list-remove',
  'backspace:list-outdent',
]);

/**
 * True when a forwarded v2 host event is a committed editable-input mutation
 * of the sustained-typing class, i.e. review-row hydration for it should be
 * debounced rather than fired immediately.
 *
 * Events without a forwarded `editableCommandKind` (programmatic Document API
 * mutations, history commits, unclassified structural commands) return false
 * so they keep hydrating immediately.
 */
export const isV2EditableTextMutationEvent = (
  event: { type?: unknown; origin?: unknown; editableCommandKind?: unknown } | null | undefined,
): boolean => {
  if (event?.type !== 'mutation:committed' || event.origin !== 'command') return false;
  return V2_TYPING_COMMAND_KINDS.has(event.editableCommandKind);
};
