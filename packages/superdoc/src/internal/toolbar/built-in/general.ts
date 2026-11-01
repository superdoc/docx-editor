/**
 * Minimal DOM helpers for the built-in toolbar shell.
 *
 * The v1 toolbar's `helpers/general.js` also exported a converter-backed
 * paragraph-font-family fallback; that path depended on private v1 editor
 * internals (`@core/super-converter`) and is intentionally dropped on V2, where
 * font-family active state comes from the shared command controller snapshot.
 */

/**
 * Resolve a toolbar mount target from a selector string or element id.
 */
export const findElementBySelector = (selector: string | HTMLElement | null | undefined): HTMLElement | null => {
  if (!selector) return null;
  if (typeof selector !== 'string') {
    return selector instanceof HTMLElement ? selector : null;
  }
  if (selector.startsWith('#') || selector.startsWith('.')) {
    return document.querySelector(selector);
  }
  return document.getElementById(selector);
};
