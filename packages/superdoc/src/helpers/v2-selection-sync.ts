// Helpers for the v2 DOM-selection sync pass that mirrors selection state into
// the create-comment affordance. Extracted from SuperDoc.vue so the clear vs.
// preserve decision is unit-testable in isolation.

type V2SelectionPoint = { blockId?: unknown; blockOffset?: unknown };

type V2RangeSnapshotInput = { anchor?: V2SelectionPoint | null; focus?: V2SelectionPoint | null };

/**
 * A logical v2 selection snapshot represents a non-empty range when its anchor
 * and focus point at different block positions. Mirrors the range check the v2
 * shell uses when it emits `v2-selection-changed`.
 */
export const isV2RangeSnapshot = (snapshot: V2RangeSnapshotInput | null | undefined): boolean =>
  Boolean(
    snapshot?.anchor &&
    snapshot?.focus &&
    (snapshot.anchor.blockId !== snapshot.focus.blockId || snapshot.anchor.blockOffset !== snapshot.focus.blockOffset),
  );

/**
 * Detect a real browser text selection whose endpoints are outside the active
 * v2 mount. Editable host selections can have no native DOM range, so an
 * absent range must not count as an outside selection.
 */
export const hasOutsideV2DomRangeSelection = (
  selection: Selection | null | undefined,
  root: Node | null | undefined,
): boolean => {
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
 */
export const shouldPreserveHostV2Selection = (
  documentMode: string | null | undefined,
  hostSnapshot: V2RangeSnapshotInput | null | undefined,
): boolean => {
  if (documentMode !== 'editing' && documentMode !== 'suggesting') return false;
  return isV2RangeSnapshot(hostSnapshot);
};

/**
 * A V2 paint can briefly have no DOM anchor while a selected control is being
 * rebuilt. Keep an already-positioned comment affordance during that gap when
 * the host still owns a range; otherwise the button unmounts and remounts on
 * consecutive paint frames, making it blink and intercepting its own click.
 */
export const shouldRetainV2FloatingSelection = (
  hasHostRange: boolean,
  selectionPosition: { source?: unknown } | null | undefined,
): boolean => hasHostRange === true && selectionPosition?.source === 'document-editor';
