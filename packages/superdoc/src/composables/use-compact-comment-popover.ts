import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';
import { PDF } from '@superdoc/common';
import { COMPACT_ANCHOR_SELECTOR } from '../helpers/comment-small-screen.js';
import { isFiniteNumber } from '../helpers/is-finite-number.js';
import type { RuntimeDocument } from '../core/types/index.js';

type CompactComment = {
  commentId?: unknown;
  importedId?: unknown;
  selection?: { source?: unknown } | null;
};

type CompactSelectionPosition = { top?: unknown; bottom?: unknown; source?: unknown };

type CommentPositionLookup = (commentOrId: unknown) => {
  entry: { bounds?: { top?: unknown; bottom?: unknown } | null } | null;
};

type ClickAnchor = {
  x: number | null;
  y: number | null;
  ts: number;
  anchorRect: { left: number; right: number; top: number; bottom: number } | null;
};

type PopoverStyle = { top: string; left?: string; right: string };

interface UseCompactCommentPopoverOptions {
  activeComment: Readonly<Ref<unknown>>;
  pendingComment: Readonly<Ref<CompactComment | null | undefined>>;
  activeCompactComment: Readonly<Ref<CompactComment | null | undefined>>;
  showCommentsSidebar: Readonly<Ref<unknown>>;
  selectionPosition: Readonly<Ref<CompactSelectionPosition | null | undefined>>;
  activeZoom: Readonly<Ref<number | null | undefined>>;
  superdocRoot: Readonly<Ref<HTMLElement | null>>;
  layers: Readonly<Ref<HTMLElement | null>>;
  documents: Readonly<Ref<readonly Pick<RuntimeDocument, 'type'>[] | null | undefined>>;
  resolveCommentPositionEntry: CommentPositionLookup;
  clearActiveComment: () => void;
  clearPendingComment: () => void;
}

type AnchorRect = Pick<DOMRect, 'top' | 'bottom' | 'left' | 'width' | 'height'>;

const POPOVER_WIDTH_PX = 320;
const SAFE_MARGIN_PX = 12;
const MIN_BOTTOM_SPACE_PX = 220;
const ANCHOR_TOP_OFFSET_PX = 16;
const INTERACTION_ANCHOR_TTL_MS = 500;

const COMMENT_HIGHLIGHT_SELECTOR = '.superdoc-comment-highlight[data-comment-ids]';
const COMMENT_HIGHLIGHT_DATA_ATTR = 'data-comment-ids';
const PDF_COMMENT_ANCHOR_SELECTOR = '.sd-comment-anchor';

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);
const toNumber = (value: unknown): number => Number(value);

const getCommentAnchorId = (comment: CompactComment | null | undefined): unknown =>
  comment?.commentId ?? comment?.importedId ?? null;

const parseCommentIds = (value: string | null): string[] =>
  String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

// Click anchor from pointerdown tracking: returns { x, y } in clientX/clientY space if within TTL.
const resolveInteractionAnchor = (lastClickAnchor: Ref<ClickAnchor>): { x: number; y: number } | null => {
  const anchor = lastClickAnchor?.value;
  if (!anchor) return null;
  const ts = toNumber(anchor.ts);
  if (!isFiniteNumber(ts) || Date.now() - ts > INTERACTION_ANCHOR_TTL_MS) return null;
  const x = toNumber(anchor.x);
  const rectBottom = toNumber(anchor.anchorRect?.bottom);
  const y = isFiniteNumber(rectBottom) ? rectBottom : toNumber(anchor.y);
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  return { x, y };
};

// DOM fallback: find the first highlight/TC span for the comment and return its bounding rect.
const resolveInlineHighlightAnchorRect = ({
  rootEl,
  comment,
  pendingComment,
}: {
  rootEl: HTMLElement;
  comment: CompactComment;
  pendingComment: UseCompactCommentPopoverOptions['pendingComment'];
}): DOMRect | null => {
  const isPending = Boolean(pendingComment?.value && comment?.commentId === pendingComment.value?.commentId);
  if (isPending) {
    const nodes = rootEl.querySelectorAll(COMMENT_HIGHLIGHT_SELECTOR);
    for (const node of Array.from(nodes)) {
      if (!parseCommentIds(node.getAttribute(COMMENT_HIGHLIGHT_DATA_ATTR)).includes('pending')) continue;
      if (typeof node.getBoundingClientRect !== 'function') continue;
      return node.getBoundingClientRect();
    }
  }

  const anchorId = getCommentAnchorId(comment);
  if (!anchorId) return null;
  const safeId = String(anchorId);

  const highlightNodes = rootEl.querySelectorAll(COMMENT_HIGHLIGHT_SELECTOR);
  for (const node of Array.from(highlightNodes)) {
    if (!parseCommentIds(node.getAttribute(COMMENT_HIGHLIGHT_DATA_ATTR)).includes(safeId)) continue;
    if (typeof node.getBoundingClientRect !== 'function') continue;
    return node.getBoundingClientRect();
  }

  const tcNode = rootEl.querySelector(`[data-track-change-id="${safeId}"]`);
  if (tcNode && typeof tcNode.getBoundingClientRect === 'function') return tcNode.getBoundingClientRect();

  return null;
};

// Primary anchor source: stored layout bounds for the active comment thread.
const resolveEntryAnchorBottom = (
  resolveCommentPositionEntry: CommentPositionLookup,
  comment: CompactComment,
): number => {
  const { entry } = resolveCommentPositionEntry(getCommentAnchorId(comment));
  const boundsBottom = toNumber(entry?.bounds?.bottom);
  if (isFiniteNumber(boundsBottom)) return boundsBottom;
  return toNumber(entry?.bounds?.top);
};

// Allow DOM-anchor fallback only in PDF-related contexts.
const isPdfContextForAnchorLookup = ({
  selectionPosition,
  comment,
  pendingComment,
}: Pick<UseCompactCommentPopoverOptions, 'selectionPosition' | 'pendingComment'> & {
  comment: CompactComment;
}): boolean =>
  selectionPosition.value?.source === 'pdf' ||
  comment?.selection?.source === 'pdf' ||
  pendingComment.value?.selection?.source === 'pdf';

// PDF fallback when stored bounds are missing: read anchor position from DOM.
const resolvePdfDomAnchorBottom = ({
  rootEl,
  layersRect,
  comment,
}: {
  rootEl: HTMLElement;
  layersRect: AnchorRect;
  comment: CompactComment;
}): number => {
  const anchorId = getCommentAnchorId(comment);
  if (anchorId == null) return NaN;
  const anchorElement = rootEl.querySelector(`${PDF_COMMENT_ANCHOR_SELECTOR}[data-id="${String(anchorId)}"]`);
  if (!anchorElement || typeof anchorElement.getBoundingClientRect !== 'function') return NaN;
  const anchorRect = anchorElement.getBoundingClientRect();
  return toNumber(anchorRect.bottom) - toNumber(layersRect.top);
};

// Pending-comment fallback: derive anchor position from current selection coordinates.
const resolvePendingSelectionAnchorBottom = ({
  comment,
  pendingComment,
  selectionPosition,
  activeZoom,
}: Pick<UseCompactCommentPopoverOptions, 'pendingComment' | 'selectionPosition' | 'activeZoom'> & {
  comment: CompactComment;
}): number => {
  if (!pendingComment.value || comment?.commentId !== pendingComment.value?.commentId) return NaN;
  const selectedBottom = toNumber(selectionPosition.value?.bottom);
  if (isFiniteNumber(selectedBottom)) {
    const isPdf = selectionPosition.value?.source === 'pdf';
    const zoom = isPdf ? (activeZoom.value ?? 100) / 100 : 1;
    return selectedBottom * zoom;
  }
  const selectedTop = toNumber(selectionPosition.value?.top);
  if (!isFiniteNumber(selectedTop)) return NaN;
  const isPdf = selectionPosition.value?.source === 'pdf';
  const zoom = isPdf ? (activeZoom.value ?? 100) / 100 : 1;
  return selectedTop * zoom;
};

const toPopoverStyle = ({ top, left }: { top: number; left: number }): PopoverStyle => ({
  top: `${Math.round(top)}px`,
  left: `${Math.round(left)}px`,
  right: 'auto',
});

// Keep the popover inside the superdoc viewport with safe margins.
const resolvePopoverPosition = ({
  rootRect,
  layersRect,
  anchorBottom,
  anchorClientX = NaN,
}: {
  rootRect: AnchorRect;
  layersRect: AnchorRect;
  anchorBottom: number;
  anchorClientX?: number;
}): { top: number; left: number } => {
  const idealTop = layersRect.top - rootRect.top + anchorBottom + ANCHOR_TOP_OFFSET_PX;
  const maxTop = Math.max(SAFE_MARGIN_PX, rootRect.height - MIN_BOTTOM_SPACE_PX);
  const top = clamp(idealTop, SAFE_MARGIN_PX, maxTop);

  const maxLeft = Math.max(SAFE_MARGIN_PX, rootRect.width - POPOVER_WIDTH_PX - SAFE_MARGIN_PX);
  let left: number;
  if (isFiniteNumber(anchorClientX)) {
    left = clamp(anchorClientX - rootRect.left + SAFE_MARGIN_PX, SAFE_MARGIN_PX, maxLeft);
  } else {
    const rightCandidate = rootRect.width - (layersRect.left - rootRect.left + layersRect.width) + SAFE_MARGIN_PX;
    left = clamp(rootRect.width - rightCandidate - POPOVER_WIDTH_PX, SAFE_MARGIN_PX, maxLeft);
  }

  return { top, left };
};

export function useCompactCommentPopover({
  activeComment,
  pendingComment,
  activeCompactComment,
  showCommentsSidebar,
  selectionPosition,
  activeZoom,
  superdocRoot,
  layers,
  documents,
  resolveCommentPositionEntry,
  clearActiveComment,
  clearPendingComment,
}: UseCompactCommentPopoverOptions) {
  const fallback: PopoverStyle = {
    top: '12px',
    right: '12px',
  };
  const compactPopoverLayoutTick = ref(0);
  const lastClickAnchor = ref<ClickAnchor>({ x: null, y: null, ts: 0, anchorRect: null });

  let compactPopoverRafId: number | null = null;
  let compactPopoverReturnFocusEl: HTMLElement | null = null;

  const resetClickAnchor = () => {
    lastClickAnchor.value = { x: null, y: null, ts: 0, anchorRect: null };
  };

  const clearCompactPopoverIfPdfClickedOutside = (
    root: HTMLElement,
    target: Node | null,
    anchorElement: Element | null,
  ): boolean => {
    const isPdfDocument = documents.value?.some((doc) => doc.type === PDF);
    if (!isPdfDocument) return false;
    const compactPopoverEl = root.querySelector('.superdoc__compact-comment-popover');
    if (!activeCompactComment.value || !compactPopoverEl || compactPopoverEl.contains(target) || anchorElement) {
      return false;
    }
    if (pendingComment.value) {
      clearPendingComment();
      clearActiveComment();
    } else {
      clearActiveComment();
    }
    resetClickAnchor();
    return true;
  };

  const trackCompactPopoverClickAnchor = (e: PointerEvent): void => {
    const root = superdocRoot.value;
    const target = e.target instanceof Node ? e.target : null;
    if (!root || !layers.value?.contains(target)) return;

    const elementsAtPoint =
      typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(e.clientX, e.clientY) : [];

    const anchorElement =
      elementsAtPoint
        .find((node) => node?.nodeType === 1 && root.contains(node) && node.closest(COMPACT_ANCHOR_SELECTOR))
        ?.closest(COMPACT_ANCHOR_SELECTOR) ??
      (target instanceof Element ? target.closest(COMPACT_ANCHOR_SELECTOR) : null);

    if (clearCompactPopoverIfPdfClickedOutside(root, target, anchorElement)) return;

    if (e.button !== 0 || e.pointerType !== 'mouse') return;

    const anchorRect =
      anchorElement && typeof anchorElement.getBoundingClientRect === 'function'
        ? anchorElement.getBoundingClientRect()
        : null;
    if (!anchorRect) return;

    lastClickAnchor.value = {
      x: e.clientX,
      y: anchorRect.bottom,
      ts: Date.now(),
      anchorRect: { left: anchorRect.left, right: anchorRect.right, top: anchorRect.top, bottom: anchorRect.bottom },
    };
  };

  const compactCommentPopoverStyle = computed((): PopoverStyle => {
    void compactPopoverLayoutTick.value;

    const comment = activeCompactComment.value;
    if (!comment) return fallback;

    const rootEl = superdocRoot.value;
    const layersEl = layers.value;
    if (!rootEl || !layersEl) return fallback;

    const rootRect = rootEl.getBoundingClientRect();
    const layersRect = layersEl.getBoundingClientRect();

    // 1. Click anchor (most accurate — where user actually clicked).
    const interactionAnchor = resolveInteractionAnchor(lastClickAnchor);
    // 2. DOM highlight rect (keyboard/API fallback — first span of the comment/TC).
    const inlineRect = !interactionAnchor
      ? resolveInlineHighlightAnchorRect({ rootEl, comment, pendingComment })
      : null;

    let anchorBottom = NaN;
    let anchorClientX = NaN;

    if (interactionAnchor) {
      anchorBottom = interactionAnchor.y - layersRect.top;
      anchorClientX = interactionAnchor.x;
    } else if (inlineRect) {
      anchorBottom = inlineRect.bottom - layersRect.top;
      anchorClientX = inlineRect.left;
    } else {
      // 3. Stored layout bounds.
      anchorBottom = resolveEntryAnchorBottom(resolveCommentPositionEntry, comment);
    }

    // 4. PDF DOM anchor fallback.
    if (!isFiniteNumber(anchorBottom) && isPdfContextForAnchorLookup({ selectionPosition, comment, pendingComment })) {
      anchorBottom = resolvePdfDomAnchorBottom({ rootEl, layersRect, comment });
    }

    // 5. Pending selection fallback.
    if (!isFiniteNumber(anchorBottom)) {
      anchorBottom = resolvePendingSelectionAnchorBottom({
        comment,
        pendingComment,
        selectionPosition,
        activeZoom,
      });
    }

    if (!isFiniteNumber(anchorBottom)) return fallback;

    const position = resolvePopoverPosition({ rootRect, layersRect, anchorBottom, anchorClientX });
    return toPopoverStyle(position);
  });

  watch(
    [activeComment, pendingComment, selectionPosition, activeZoom, showCommentsSidebar, lastClickAnchor],
    () => {
      const requestAnimationFrameFn = typeof window !== 'undefined' ? window.requestAnimationFrame : null;
      const cancelAnimationFrameFn = typeof window !== 'undefined' ? window.cancelAnimationFrame : null;
      if (compactPopoverRafId != null) {
        cancelAnimationFrameFn?.(compactPopoverRafId);
      }
      if (!requestAnimationFrameFn) return;
      compactPopoverRafId = requestAnimationFrameFn(() => {
        compactPopoverLayoutTick.value += 1;
        compactPopoverRafId = null;
      });
    },
    { deep: false },
  );

  watch(
    activeCompactComment,
    (current, previous) => {
      if (!previous && current) {
        const activeEl = document.activeElement;
        if (activeEl instanceof HTMLElement) {
          compactPopoverReturnFocusEl = activeEl;
        }
      }
    },
    { deep: false },
  );

  watch(pendingComment, (current, previous) => {
    if (!previous && current) resetClickAnchor();
  });

  onMounted(() => {
    document.addEventListener('pointerdown', trackCompactPopoverClickAnchor, true);
  });

  onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', trackCompactPopoverClickAnchor, true);
    const cancelAnimationFrameFn = typeof window !== 'undefined' ? window.cancelAnimationFrame : null;
    if (compactPopoverRafId != null) {
      cancelAnimationFrameFn?.(compactPopoverRafId);
      compactPopoverRafId = null;
    }
    compactPopoverReturnFocusEl = null;
  });

  const closeCompactCommentPopover = () => {
    if (!activeCompactComment.value) return;
    if (pendingComment.value) {
      clearPendingComment();
      clearActiveComment();
    } else {
      clearActiveComment();
    }
    if (compactPopoverReturnFocusEl && typeof compactPopoverReturnFocusEl.focus === 'function') {
      compactPopoverReturnFocusEl.focus();
    }
    compactPopoverReturnFocusEl = null;
  };

  return {
    compactCommentPopoverStyle,
    closeCompactCommentPopover,
    resetClickAnchor,
  };
}
