/**
 * Shared ownership registry for the ambient (no-focus) Cmd/Ctrl+F shortcut.
 *
 * Several SuperDoc instances can be mounted on one page, and each registers a
 * document-level capture listener for the find shortcut. When focus is inside
 * an instance that instance handles the shortcut, but when focus is on <body>
 * (fresh page load, clicks on page chrome) every instance would otherwise
 * consider itself eligible — and `stopPropagation()` cannot suppress sibling
 * listeners already registered on the same node, so multiple find bars would
 * open. This registry elects a single ambient owner: the most recently mounted
 * or interacted-with instance.
 */

let currentOwner: unknown = null;

/**
 * Make `owner` the ambient find-shortcut owner. Call on mount and on user
 * interaction (pointerdown / focusin inside the instance) so "the SuperDoc the
 * user last touched" wins the ambient shortcut.
 */
export function claimFindShortcut(owner: unknown): void {
  if (owner != null) currentOwner = owner;
}

/**
 * Clear ownership if `owner` currently holds it. Call on unmount.
 */
export function releaseFindShortcut(owner: unknown): void {
  if (currentOwner === owner) currentOwner = null;
}

/**
 * Whether `owner` may handle the ambient (no-focus) find shortcut. With no
 * claimed owner any instance may handle it (single-instance pages), relying on
 * the `defaultPrevented` check in {@link shouldHandleFindShortcut} to keep the
 * shortcut single-fire.
 */
export function ownsAmbientFindShortcut(owner: unknown): boolean {
  return currentOwner === null || currentOwner === owner;
}

/**
 * Decide whether one SuperDoc instance's capture listener should handle a
 * find-shortcut keydown. `defaultPrevented` covers the cross-instance race
 * directly: the first instance to act marks the event, and sibling capture
 * listeners on the same node skip it.
 */
export function shouldHandleFindShortcut(
  event: KeyboardEvent,
  { focusInside, owner }: { focusInside: boolean; owner: unknown },
): boolean {
  if (event.defaultPrevented) return false;
  if (focusInside) return true;
  const active = document.activeElement;
  const ambientFocus = !active || active === document.body || active === document.documentElement;
  return ambientFocus && ownsAmbientFindShortcut(owner);
}
