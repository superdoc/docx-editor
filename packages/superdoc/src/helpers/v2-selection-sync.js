// Helpers for the v2 DOM-selection sync pass that mirrors selection state into
// the create-comment affordance. Extracted from SuperDoc.vue so the clear vs.
// preserve decision is unit-testable in isolation.

/**
 * A logical v2 selection snapshot represents a non-empty range when its anchor
 * and focus point at different block positions. Mirrors the range check the v2
 * shell uses when it emits `v2-selection-changed`.
 *
 * @param {{ anchor?: { blockId?: unknown, blockOffset?: unknown }, focus?: { blockId?: unknown, blockOffset?: unknown } } | null | undefined} snapshot
 * @returns {boolean}
 */
export const isV2RangeSnapshot = (snapshot) =>
  Boolean(
    snapshot?.anchor &&
    snapshot?.focus &&
    (snapshot.anchor.blockId !== snapshot.focus.blockId || snapshot.anchor.blockOffset !== snapshot.focus.blockOffset),
  );

/**
 * Detect a real browser text selection whose endpoints are outside the active
 * v2 mount. Editable host selections can have no native DOM range, so an
 * absent range must not count as an outside selection.
 *
 * @param {Selection | null | undefined} selection
 * @param {Node | null | undefined} root
 * @returns {boolean}
 */
export const hasOutsideV2DomRangeSelection = (selection, root) => {
  if (!selection || selection.rangeCount < 1 || selection.isCollapsed || !root) return false;
  const range = selection.getRangeAt(0);
  return !root.contains(range.startContainer) && !root.contains(range.endContainer);
};

/**
 * Decide whether the DOM-selection sync pass should keep the affordance driven
 * by the v2 host's logical selection instead of clearing it.
 *
 * In editable modes the host owns pointer text selection, so native DOM ranges
 * may be absent or stale. In that case the pointerup sync must defer to the
 * host snapshot rather than clobber the selection the host just published.
 * Only editable modes use the host snapshot. Viewing mode keeps native DOM
 * selection, and unknown modes should not preserve stale host state.
 *
 * @param {string | null | undefined} documentMode
 * @param {unknown} hostSnapshot
 * @returns {boolean}
 */
export const shouldPreserveHostV2Selection = (documentMode, hostSnapshot) => {
  if (documentMode !== 'editing' && documentMode !== 'suggesting') return false;
  return isV2RangeSnapshot(hostSnapshot);
};

/**
 * A V2 paint can briefly have no DOM anchor while a selected control is being
 * rebuilt. Keep an already-positioned comment affordance during that gap when
 * the host still owns a range; otherwise the button unmounts and remounts on
 * consecutive paint frames, making it blink and intercepting its own click.
 *
 * @param {boolean} hasHostRange
 * @param {{ source?: unknown } | null | undefined} selectionPosition
 * @returns {boolean}
 */
export const shouldRetainV2FloatingSelection = (hasHostRange, selectionPosition) =>
  hasHostRange === true && selectionPosition?.source === 'document-editor';
