// Keep pointer actions from moving browser focus out of the editor. Inputs are
// exempt because they need native focus for typing and cursor placement.
export const preventEditorFocusTransfer = (event) => {
  const target = event?.target;
  if (!(target instanceof Element)) return;
  if (target.closest('input, textarea, [contenteditable="true"]')) return;
  event.preventDefault();
};

// Shared by any toolbar dropdown whose popover takes real DOM focus (color swatches,
// table-size grid, ...): after a selection is made, the editable surface must get
// keyboard focus back, or the popover's removal leaves focus on body/nowhere and
// keystrokes stop reaching the editor until the user clicks back in.
export const refocusEditorSurface = (superToolbar, preferredEditor) => {
  if (typeof preferredEditor?.focus === 'function') {
    preferredEditor.focus();
    return;
  }
  // Prefer THIS toolbar's active-editor focus handle: a document-wide textbox
  // query would return the first editor on the page and could focus the wrong
  // one when several SuperDocs are mounted.
  const focusHandle = superToolbar?.superdoc?.focus ?? superToolbar?.activeEditor?.focus;
  if (typeof focusHandle === 'function') {
    focusHandle.call(superToolbar?.superdoc ?? superToolbar?.activeEditor, { preventScroll: true });
    return;
  }
  // Last resort: scan the document (single-editor pages / custom labels).
  const editor = document.querySelector('[role="textbox"][aria-label*="SuperDoc body"], .ProseMirror');
  if (editor instanceof HTMLElement) editor.focus({ preventScroll: true });
};
