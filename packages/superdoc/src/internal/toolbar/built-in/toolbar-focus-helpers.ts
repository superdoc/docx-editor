type FocusOptions = { preventScroll?: boolean };

type FocusTarget = { focus?: unknown };

type RefocusToolbar = {
  superdoc?: FocusTarget | null;
  activeEditor?: FocusTarget | null;
};

export const preventEditorFocusTransfer = (event: Pick<Event, 'target' | 'preventDefault'>) => {
  const target = event?.target;
  if (!(target instanceof Element)) return;
  if (target.closest('input, textarea, [contenteditable="true"]')) return;
  event.preventDefault();
};

export const refocusEditorSurface = (
  superToolbar: RefocusToolbar | null | undefined,
  preferredEditor?: FocusTarget | null,
) => {
  if (typeof preferredEditor?.focus === 'function') {
    preferredEditor.focus();
    return;
  }
  const focusHandle = superToolbar?.superdoc?.focus ?? superToolbar?.activeEditor?.focus;
  if (typeof focusHandle === 'function') {
    const focusOptions: FocusOptions = { preventScroll: true };
    focusHandle.call(superToolbar?.superdoc ?? superToolbar?.activeEditor, focusOptions);
    return;
  }
  const editor = document.querySelector('[role="textbox"][aria-label*="SuperDoc body"], .ProseMirror');
  if (editor instanceof HTMLElement) editor.focus({ preventScroll: true });
};
