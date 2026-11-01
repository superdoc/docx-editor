import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { preventEditorFocusTransfer, refocusEditorSurface } from './toolbar-focus-helpers.js';

describe('preventEditorFocusTransfer', () => {
  it('keeps native focus behavior for text inputs', () => {
    const input = document.createElement('input');
    const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    input.addEventListener('mousedown', preventEditorFocusTransfer);

    expect(input.dispatchEvent(mouseDown)).toBe(true);
    expect(mouseDown.defaultPrevented).toBe(false);
  });
});

describe('refocusEditorSurface', () => {
  let popoverControl;
  let editorEl;

  afterEach(() => {
    popoverControl?.remove();
    editorEl?.remove();
    popoverControl = null;
    editorEl = null;
  });

  it('moves focus from a focused popover control back onto the editable surface', () => {
    // Simulates a toolbar dropdown popover (e.g. the table-size grid) that took
    // real DOM focus for its own keyboard navigation before a selection was made.
    popoverControl = document.createElement('div');
    popoverControl.setAttribute('tabindex', '0');
    document.body.appendChild(popoverControl);
    popoverControl.focus();
    expect(document.activeElement).toBe(popoverControl);

    editorEl = document.createElement('div');
    editorEl.setAttribute('tabindex', '0');
    document.body.appendChild(editorEl);

    const superToolbar = { activeEditor: { focus: () => editorEl.focus() } };

    // Popover close removes the control, matching the real dropdown-close flow.
    popoverControl.remove();

    refocusEditorSurface(superToolbar);

    expect(document.activeElement).toBe(editorEl);
  });

  it('focuses a preferred editor instead of the toolbar active editor', () => {
    const toolbarFocus = vi.fn();
    const preferredFocus = vi.fn();

    refocusEditorSurface({ activeEditor: { focus: toolbarFocus } }, { focus: preferredFocus });

    expect(preferredFocus).toHaveBeenCalledOnce();
    expect(toolbarFocus).not.toHaveBeenCalled();
  });

  it('calls the focus handle with preventScroll: true so refocus never jumps the page', () => {
    // Regression guard: a color/highlight swatch selection refocuses the editor after
    // the popover closes, and an unguarded focus() lets the browser scroll-into-view
    // even though the surface never left the viewport.
    const focus = vi.fn();
    const superToolbar = { superdoc: { focus } };

    refocusEditorSurface(superToolbar);

    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('falls back to querying the document when no toolbar focus handle is available', () => {
    editorEl = document.createElement('div');
    editorEl.setAttribute('role', 'textbox');
    editorEl.setAttribute('aria-label', 'SuperDoc body');
    editorEl.setAttribute('tabindex', '0');
    document.body.appendChild(editorEl);

    refocusEditorSurface({});

    expect(document.activeElement).toBe(editorEl);
  });
});
