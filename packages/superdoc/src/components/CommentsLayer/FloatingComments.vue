<script>
// Module-level cache — survives component remounts caused by hasInitializedLocations toggle
const _heightsCache = {};
</script>

<script setup>
import { storeToRefs } from 'pinia';
import { ref, computed, nextTick, watch, onMounted, onBeforeUnmount } from 'vue';
import { useCommentsStore } from '@superdoc/stores/comments-store';
import { useSuperdocStore } from '@superdoc/stores/superdoc-store';
import CommentDialog from '@superdoc/components/CommentsLayer/CommentDialog.vue';
import {
  normalizeFloatingAnchorTop,
  resolveRemovedReviewCardContinuityTarget,
  resolvePersistentReviewCardTop,
  shouldMountFloatingCommentDialog,
} from './floating-comment-positioning.js';

const ESTIMATED_HEIGHT = 110;
const OBSERVER_MARGIN = 600;
const SCROLL_OWNER_OVERFLOW_VALUES = new Set(['auto', 'scroll', 'hidden', 'clip']);

// Layout algorithm: positions comments in a single column with collision avoidance.
// When a comment is active it pins at its anchor; neighbors push up/down to avoid overlap.
// If upward push produces negative tops, everything shifts down to stay on screen.
const resolveCollisions = (positions, activeIndex, gap) => {
  if (activeIndex >= 0) {
    positions[activeIndex].top = positions[activeIndex].anchorTop;

    // Below: push down from the active comment
    let cursor = positions[activeIndex].top + positions[activeIndex].height + gap;
    for (let i = activeIndex + 1; i < positions.length; i++) {
      positions[i].top = Math.max(positions[i].anchorTop, cursor);
      cursor = positions[i].top + positions[i].height + gap;
    }

    // Above: push up from the active comment
    cursor = positions[activeIndex].top - gap;
    for (let i = activeIndex - 1; i >= 0; i--) {
      const bottomEdge = cursor - positions[i].height;
      positions[i].top = Math.min(positions[i].anchorTop, bottomEdge);
      cursor = positions[i].top - gap;
    }

    // Floor: if upward push produced negative tops, shift everything down
    const minTop = Math.min(...positions.map((p) => p.top));
    if (minTop < 0) {
      const shift = Math.abs(minTop);
      for (const p of positions) p.top += shift;
    }
  } else {
    // No active comment: simple top-to-bottom collision avoidance
    for (let i = 1; i < positions.length; i++) {
      const prev = positions[i - 1];
      const minTop = prev.top + prev.height + gap;
      if (positions[i].top < minTop) {
        positions[i].top = minTop;
      }
    }
  }
};

const props = defineProps({
  currentDocument: {
    type: Object,
    required: true,
  },
  parent: {
    type: Object,
    required: true,
  },
});

const superdocStore = useSuperdocStore();
const commentsStore = useCommentsStore();
const { clearInstantSidebarAlignment } = commentsStore;

const {
  activeComment,
  activeFloatingCommentInstanceId,
  editorCommentPositions,
  pendingComment,
  editingCommentId,
  instantSidebarAlignmentTargetY,
  instantSidebarAlignmentThreadId,
  instantSidebarAlignmentInstanceId,
} = storeToRefs(commentsStore);
const { activeZoom } = storeToRefs(superdocStore);

// Access the Pinia getter directly instead of storeToRefs(). In this component
// the getter-backed ref can lag behind the live store array during rapid
// tracked-change updates, which collapses the virtualized sidebar to a stale subset.
// Instances are scoped to the document this FloatingComments instance renders so
// a multi-document session (e.g. a PDF plus a DOCX) does not paint another
// document's comment cards into the wrong lane.
const floatingCommentInstances = computed(() => {
  const currentFloatingCommentInstances = commentsStore.getFloatingCommentInstances;
  if (!Array.isArray(currentFloatingCommentInstances)) return [];
  const documentId = props.currentDocument?.id;
  if (documentId == null) return currentFloatingCommentInstances;
  return currentFloatingCommentInstances.filter((instance) =>
    commentsStore.belongsToDocument(instance.comment, String(documentId), { allowSingleDocumentMismatch: true }),
  );
});

const floatingCommentsContainer = ref(null);
const commentsRenderKey = ref(0);
const sidebarOffsetY = ref(0);
const disableInstantLayoutTransitions = ref(false);
const directDecisionContinuityTargetId = ref(null);
const viewportRevision = ref(0);

const isPendingThread = (commentOrId) => {
  const pendingId = pendingComment.value?.commentId;
  if (!pendingId) return false;
  if (typeof commentOrId === 'object') return commentOrId?.commentId === pendingId;
  return commentOrId === pendingId || commentOrId === 'pending';
};

const getThreadId = (comment) => {
  return comment?.commentId ?? comment?.importedId ?? null;
};

const floatingInstanceIndex = computed(() => {
  const byId = new Map();
  const byThreadId = new Map();
  for (const instance of floatingCommentInstances.value) {
    if (instance?.id != null) byId.set(String(instance.id), instance);
    const threadId = getThreadId(instance?.comment);
    if (threadId == null) continue;
    const key = String(threadId);
    const threadInstances = byThreadId.get(key) ?? [];
    threadInstances.push(instance);
    byThreadId.set(key, threadInstances);
  }
  return { byId, byThreadId };
});

const findPrimaryInstanceIdForThread = (threadId) => {
  if (threadId == null) {
    return null;
  }

  const normalizedThreadId = String(threadId);
  const matchingInstances = floatingInstanceIndex.value.byThreadId.get(normalizedThreadId) ?? [];
  if (!matchingInstances.length) {
    return null;
  }

  return matchingInstances.find((instance) => instance.isPrimary)?.id ?? matchingInstances[0]?.id ?? null;
};

const resolveFloatingInstanceId = (threadId, preferredInstanceId = null) => {
  if (threadId == null) {
    return null;
  }

  const normalizedThreadId = String(threadId);
  const matchingInstances = floatingInstanceIndex.value.byThreadId.get(normalizedThreadId) ?? [];
  if (!matchingInstances.length) {
    return null;
  }

  if (preferredInstanceId != null) {
    const preferredInstance = matchingInstances.find((instance) => String(instance.id) === String(preferredInstanceId));
    if (preferredInstance) {
      return preferredInstance.id;
    }
  }

  return matchingInstances.find((instance) => instance.isPrimary)?.id ?? matchingInstances[0]?.id ?? null;
};

const activeCommentInstanceId = computed(() => {
  if (!activeComment.value) return null;
  return resolveFloatingInstanceId(activeComment.value, activeFloatingCommentInstanceId.value);
});

const toFinitePdfCoordinate = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

// Heights: measured (actual) or estimated. Seeded from module-level cache to
// survive remounts triggered by hasInitializedLocations toggle in SuperDoc.vue.
const measuredHeights = ref({ ..._heightsCache });

// Set of comment IDs that are near the viewport (should mount CommentDialog)
const visibleIds = ref(new Set());

// Refs for placeholder elements keyed by comment ID
const placeholderRefs = ref({});

let observer = null;
// Track which DOM elements are currently being observed (avoids disconnect/re-observe cycle)
const observedElements = new Set();
let viewportFrame = null;
const refreshViewportWindow = () => {
  if (viewportFrame != null) return;
  viewportFrame = requestAnimationFrame(() => {
    viewportFrame = null;
    viewportRevision.value += 1;
  });
};

// Compute anchor position for a floating comment instance.
const getAnchorTop = (instance) => {
  if (props.currentDocument.type === 'application/pdf') {
    const zoom = (activeZoom.value ?? 100) / 100;
    const top = toFinitePdfCoordinate(instance?.comment?.selection?.selectionBounds?.top);
    return top == null ? null : top * zoom;
  }

  return instance?.positionEntry?.bounds?.top;
};

const getAnchorBottom = (instance, anchorTop) => {
  if (props.currentDocument.type === 'application/pdf') {
    const zoom = (activeZoom.value ?? 100) / 100;
    const bottom = toFinitePdfCoordinate(instance?.comment?.selection?.selectionBounds?.bottom);
    return bottom != null ? bottom * zoom : anchorTop;
  }

  const bottom = instance?.positionEntry?.bounds?.bottom;
  return Number.isFinite(bottom) ? bottom : anchorTop;
};

// Geometry changes are less frequent than scroll events. Cache the small set
// of geometry-bearing rows so viewport refreshes never rescan the complete
// logical tracked-change catalog.
const geometryBearingInstances = computed(() => {
  const positioned = [];
  for (const instance of floatingCommentInstances.value) {
    const id = instance?.id;
    const threadId = getThreadId(instance?.comment);
    const anchorTop = getAnchorTop(instance);
    if (id == null || threadId == null || !Number.isFinite(anchorTop)) continue;
    const top = normalizeFloatingAnchorTop(anchorTop, instance.comment);
    positioned.push({
      id,
      threadId,
      instance,
      top,
      anchorBottom: getAnchorBottom(instance, top),
    });
  }
  return positioned;
});

// Compute anchor position for the pending (new) comment.
// For editor docs, uses the 'pending' mark position from editorCommentPositions.
// For PDF docs, falls back to selection bounds (same as getAnchorTop).
const getPendingAnchorTop = () => {
  const positionEntry = editorCommentPositions.value['pending'];
  if (typeof positionEntry?.bounds?.top === 'number' && !isNaN(positionEntry.bounds.top)) {
    return positionEntry.bounds.top;
  }

  const zoom = props.currentDocument.type === 'application/pdf' ? (activeZoom.value ?? 100) / 100 : 1;
  const top = toFinitePdfCoordinate(pendingComment.value?.selection?.selectionBounds?.top);
  return top == null ? null : top * zoom;
};

const shouldRenderDialog = (position) => {
  return shouldMountFloatingCommentDialog({
    id: position?.id,
    visibleIds: visibleIds.value,
    activeCommentInstanceId: activeCommentInstanceId.value,
    comment: position?.commentRef,
  });
};

const getFloatingViewportRange = () => {
  const container = floatingCommentsContainer.value;
  if (!container) {
    return null;
  }

  const containerRect = container.getBoundingClientRect();
  if (!Number.isFinite(containerRect.top) || !Number.isFinite(window.innerHeight)) {
    return null;
  }

  let visibleClientTop = 0;
  let visibleClientBottom = window.innerHeight;
  for (let ancestor = container.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const overflowY = window.getComputedStyle(ancestor).overflowY;
    if (!['auto', 'scroll', 'hidden', 'clip'].includes(overflowY)) continue;
    const ancestorRect = ancestor.getBoundingClientRect();
    if (!Number.isFinite(ancestorRect.top) || !Number.isFinite(ancestorRect.bottom)) continue;
    visibleClientTop = Math.max(visibleClientTop, ancestorRect.top);
    visibleClientBottom = Math.min(visibleClientBottom, ancestorRect.bottom);
  }
  if (visibleClientBottom <= visibleClientTop) return null;

  // In the ordinary layout, the document layers define the visible vertical
  // extent. During a deep outer scroll they move offscreen with the sidebar;
  // intersect only when they actually overlap the client clip, otherwise the
  // outer scroll viewport is the authoritative range for both row filtering
  // and geometry-free transitional placement.
  const parentRect = props.parent?.getBoundingClientRect?.();
  if (parentRect && Number.isFinite(parentRect.top) && Number.isFinite(parentRect.bottom)) {
    const intersectedTop = Math.max(visibleClientTop, parentRect.top);
    const intersectedBottom = Math.min(visibleClientBottom, parentRect.bottom);
    if (intersectedBottom > intersectedTop) {
      visibleClientTop = intersectedTop;
      visibleClientBottom = intersectedBottom;
    }
  }

  return {
    top: visibleClientTop - containerRect.top,
    bottom: visibleClientBottom - containerRect.top,
  };
};

const instantAlignmentInstanceKey = computed(() => {
  if (!instantSidebarAlignmentThreadId.value) {
    return null;
  }

  return resolveFloatingInstanceId(instantSidebarAlignmentThreadId.value, instantSidebarAlignmentInstanceId.value);
});

// Pre-compute all positions with collision avoidance
const allPositions = computed(() => {
  viewportRevision.value;
  const positionedInstances = geometryBearingInstances.value;
  const hasPending = pendingComment.value && pendingComment.value.fileId === props.currentDocument.id;
  if (!positionedInstances.length && !floatingCommentInstances.value.length && !hasPending) return [];

  const positions = [];
  const viewportRange = getFloatingViewportRange() ?? {
    top: 0,
    bottom: Math.max(0, props.parent?.clientHeight || window.innerHeight || 0),
  };
  const renderTop = viewportRange.top - OBSERVER_MARGIN;
  const renderBottom = viewportRange.bottom + OBSERVER_MARGIN;
  const activeKey = hasPending ? 'pending' : activeCommentInstanceId.value;
  const positionIds = new Set();
  const pushPosition = ({ id, threadId, instance, top, anchorBottom, hasAnchorGeometry }) => {
    const key = String(id);
    if (positionIds.has(key)) return;
    positionIds.add(key);
    positions.push({
      id,
      threadId,
      pageIndex: instance?.pageIndex ?? null,
      anchorTop: top,
      anchorBottom,
      hasAnchorGeometry,
      top,
      height: measuredHeights.value[id] || ESTIMATED_HEIGHT,
      commentRef: instance.comment,
      instanceRef: instance,
    });
  };

  for (const positioned of positionedInstances) {
    const { id, threadId, instance, top, anchorBottom } = positioned;
    const isActive = activeKey != null && String(id) === String(activeKey);
    const isEditing = editingCommentId.value != null && String(threadId) === String(editingCommentId.value);
    if (!isActive && !isEditing && (anchorBottom < renderTop || top > renderBottom)) continue;
    pushPosition({
      id,
      threadId,
      instance,
      top,
      anchorBottom,
      hasAnchorGeometry: true,
    });
  }

  const transitionalInstances = [];
  if (activeKey && activeKey !== 'pending') {
    const activeInstance = floatingInstanceIndex.value.byId.get(String(activeKey));
    if (activeInstance) transitionalInstances.push(activeInstance);
  }
  if (editingCommentId.value != null) {
    const editingInstances = floatingInstanceIndex.value.byThreadId.get(String(editingCommentId.value)) ?? [];
    const editingInstance = editingInstances.find((instance) => instance.isPrimary) ?? editingInstances[0];
    if (editingInstance) transitionalInstances.push(editingInstance);
  }
  for (const instance of transitionalInstances) {
    const id = instance.id;
    const threadId = getThreadId(instance.comment);
    if (id == null || threadId == null || positionIds.has(String(id))) continue;
    pushPosition({
      id,
      threadId,
      instance,
      top: viewportRange.top,
      anchorBottom: viewportRange.top,
      hasAnchorGeometry: false,
    });
  }

  // Include pending (new) comment in the layout
  if (hasPending) {
    const pendingTop = getPendingAnchorTop();
    if (typeof pendingTop === 'number' && !isNaN(pendingTop)) {
      positions.push({
        id: 'pending',
        anchorTop: pendingTop,
        anchorBottom: pendingTop,
        hasAnchorGeometry: true,
        top: pendingTop,
        height: measuredHeights.value['pending'] || ESTIMATED_HEIGHT,
        commentRef: pendingComment.value,
      });
    }
  }

  positions.sort((a, b) => a.anchorTop - b.anchorTop);

  // Persistent review cards whose anchors are outside the viewport remain in
  // the bounded output, but they cannot participate in visible-card collision
  // layout. Otherwise they advance the collision cursor and are then restored
  // offscreen, leaving downstream visible cards displaced by rows that no
  // longer occupy those packed positions.
  const collisionPositions = [];
  for (const position of positions) {
    const offscreenTop = position.hasAnchorGeometry
      ? resolvePersistentReviewCardTop({
          comment: position.commentRef,
          anchorTop: position.anchorTop,
          anchorBottom: position.anchorBottom,
          cardHeight: position.height,
          viewportTop: viewportRange.top,
          viewportBottom: viewportRange.bottom,
        })
      : null;
    if (offscreenTop == null) {
      collisionPositions.push(position);
    } else {
      position.top = offscreenTop;
      position.isOffscreenReviewCard = true;
    }
  }

  // Pending comment is always treated as active for collision avoidance
  const activeIndex = activeKey ? collisionPositions.findIndex((p) => p.id === activeKey) : -1;
  resolveCollisions(collisionPositions, activeIndex, 15);
  return positions;
});

// The page surface, not review-card stacking, owns document height. Cards are
// absolutely positioned and clipped/materialized by the bounded render window.
const wrapperMinHeight = computed(() => {
  viewportRevision.value;
  return Math.max(0, props.parent?.clientHeight || 0, props.parent?.scrollHeight || 0);
});

// Set up IntersectionObserver to track which placeholders are near the viewport
const setupObserver = () => {
  if (observer) observer.disconnect();

  observer = new IntersectionObserver(
    (entries) => {
      const newVisible = new Set(visibleIds.value);
      for (const entry of entries) {
        const id = entry.target.dataset.commentId;
        if (!id) continue;
        if (entry.isIntersecting) {
          newVisible.add(id);
        } else {
          newVisible.delete(id);
        }
      }
      visibleIds.value = newVisible;
    },
    {
      rootMargin: `${OBSERVER_MARGIN}px 0px ${OBSERVER_MARGIN}px 0px`,
    },
  );
};

// Observe/unobserve placeholder elements when positions change.
// Uses differential observation to avoid disconnect() which cancels pending callbacks
// and causes a gap where visibleIds is stale (comments flash in/out).
const observePlaceholders = () => {
  if (!observer) return;

  const currentElements = new Set();
  for (const pos of allPositions.value) {
    const el = placeholderRefs.value[pos.id];
    if (!el) continue;
    currentElements.add(el);
    if (!observedElements.has(el)) {
      observer.observe(el);
      observedElements.add(el);
    }
  }

  // Unobserve elements that are no longer in allPositions
  for (const el of observedElements) {
    if (!currentElements.has(el)) {
      observer.unobserve(el);
      observedElements.delete(el);
    }
  }
};

// Store a measured height for a comment key. Deduplicates the update logic
// shared between initial mount (handleDialog) and active-state remeasure.
const storeHeight = (key, height) => {
  if (height <= 0 || height === measuredHeights.value[key]) return;
  _heightsCache[key] = height;
  measuredHeights.value = { ...measuredHeights.value, [key]: height };
};

// When a CommentDialog mounts and reports its size, record the measured height.
const handleDialog = (dialog) => {
  if (!dialog) return;
  const { elementRef, commentId: instanceId } = dialog;
  if (!elementRef) return;

  nextTick(() => {
    const bounds = elementRef.value?.getBoundingClientRect();
    if (!bounds || bounds.height <= 0) return;
    if (instanceId) storeHeight(instanceId, bounds.height);
  });
};

// Re-measure a specific comment dialog when it signals a resize (e.g. text truncation toggle)
const handleResize = (position) => {
  const key = position?.id;
  if (!key) return;
  nextTick(() => {
    const el = placeholderRefs.value[key];
    if (!el) return;
    const dialog = el.querySelector('.comments-dialog');
    if (!dialog) return;
    storeHeight(key, dialog.getBoundingClientRect().height);

    const isActiveInstance = key === activeCommentInstanceId.value;
    const isPending = key === 'pending';
    const isEditingThread =
      !!editingCommentId.value &&
      !!activeComment.value &&
      position?.threadId != null &&
      String(position.threadId) === String(activeComment.value);
    if (!isActiveInstance && !isPending && !isEditingThread) return;

    // Reflow nearby cards after size changes of the active/pending/editing thread.
    // Avoid force-snapping to anchor here because it can over-shift the whole lane
    // near viewport boundaries and make bottom clipping more frequent.
    remeasureCommentKeys(allPositions.value.map((pos) => pos.id));
    scheduleDeferredRemeasure(() => allPositions.value.map((pos) => pos.id));
  });
};

const setInstantLayoutTransitionsDisabled = (disabled) => {
  if (!disabled && directDecisionContinuityTargetId.value != null) return;
  disableInstantLayoutTransitions.value = disabled;
};

const alignCommentKeyToClientY = (key, targetY, onComplete) => {
  if (!Number.isFinite(targetY)) {
    onComplete?.(false);
    return;
  }
  const el = placeholderRefs.value[key];
  if (!el) {
    onComplete?.(false);
    return;
  }

  const currentTop = el.getBoundingClientRect().top;
  sidebarOffsetY.value += targetY - currentTop;
  onComplete?.(true);
};

// Store placeholder ref by comment ID
const setPlaceholderRef = (id, el) => {
  if (el) {
    placeholderRefs.value[id] = el;
    if (observer && !observedElements.has(el)) {
      observer.observe(el);
      observedElements.add(el);
    }
  } else {
    const prev = placeholderRefs.value[id];
    if (prev && observer) {
      observer.unobserve(prev);
      observedElements.delete(prev);
    }
    delete placeholderRefs.value[id];
  }
};

// Timer IDs for cancellation on rapid active-comment switching
let remeasureTimers = [];
let scrollTimer = null;
// A decision removes the active row before clearing activeComment. Keep one
// surviving row as a visual anchor so subsequent list reconciliation cannot
// translate the entire review rail back to its unshifted origin.
let renderedPositionOrder = [];
let sidebarContinuityAnchor = null;
let continuityAlignmentScheduled = false;
let continuityAlignmentGeneration = 0;
let continuityTransitionFrame = null;
let activeLayoutContinuityFrame = null;
let directDecisionContinuity = null;
let directDecisionSourceId = null;
let ownerScrollContinuityResetFrame = null;
const ownerScrollTargets = new Set();

const releaseDirectDecisionContinuity = () => {
  directDecisionContinuity = null;
  directDecisionSourceId = null;
  directDecisionContinuityTargetId.value = null;
  setInstantLayoutTransitionsDisabled(false);
};

const releaseDirectDecisionContinuityForUnrelatedPointer = (event) => {
  if (!directDecisionContinuity) return;
  const target = event?.target instanceof Element ? event.target : null;
  const actionElement = target?.closest?.('[data-comment-action]');
  const action = actionElement?.getAttribute?.('data-comment-action');
  const continuesReviewSequence =
    (action === 'resolve' || action === 'reject') && floatingCommentsContainer.value?.contains?.(actionElement);
  if (!continuesReviewSequence) {
    releaseDirectDecisionContinuity();
  }
};

const clearDeferredRemeasureTimers = () => {
  remeasureTimers.forEach(clearTimeout);
  remeasureTimers = [];
};

const remeasureCommentKeys = (keys) => {
  for (const key of keys.filter(Boolean)) {
    const el = placeholderRefs.value[key];
    if (!el) continue;
    const dialog = el.querySelector('.comments-dialog');
    if (!dialog) continue;
    storeHeight(key, dialog.getBoundingClientRect().height);
  }
};

// 50ms: after Vue nextTick + browser rAF settle the initial DOM change.
// 350ms: after .comment-placeholder transition (300ms ease) completes.
const REMEASURE_AFTER_DOM_SETTLE_MS = 50;
const REMEASURE_AFTER_PLACEHOLDER_TRANSITION_MS = 350;

/**
 * Cancels any pending delayed remeasure passes, then schedules two remeasure runs.
 * Pass an array of keys, or a getter so keys are resolved when each timeout fires
 * (e.g. when `allPositions` may have changed).
 */
const scheduleDeferredRemeasure = (keysOrGetter) => {
  clearDeferredRemeasureTimers();
  const resolveKeys = typeof keysOrGetter === 'function' ? keysOrGetter : () => keysOrGetter;
  remeasureTimers.push(setTimeout(() => remeasureCommentKeys(resolveKeys()), REMEASURE_AFTER_DOM_SETTLE_MS));
  remeasureTimers.push(
    setTimeout(() => remeasureCommentKeys(resolveKeys()), REMEASURE_AFTER_PLACEHOLDER_TRANSITION_MS),
  );
};

const finishInstantSidebarAlignment = () => {
  clearInstantSidebarAlignment();
  requestAnimationFrame(() => {
    setInstantLayoutTransitionsDisabled(false);
  });
};

const applyInstantSidebarAlignment = (key, targetY) => {
  if (!key || !Number.isFinite(targetY)) return;

  setInstantLayoutTransitionsDisabled(true);
  nextTick(() => {
    remeasureCommentKeys([key]);
    alignCommentKeyToClientY(key, targetY, () => {
      finishInstantSidebarAlignment();
    });
  });
};

const clearSidebarContinuityAnchor = () => {
  sidebarContinuityAnchor = null;
  continuityAlignmentGeneration += 1;
  if (continuityTransitionFrame != null) {
    cancelAnimationFrame(continuityTransitionFrame);
    continuityTransitionFrame = null;
  }
  setInstantLayoutTransitionsDisabled(false);
};

const releaseDecisionContinuityForOwnerScroll = () => {
  if (!directDecisionContinuity && !sidebarContinuityAnchor) return;

  releaseDirectDecisionContinuity();
  clearSidebarContinuityAnchor();

  // The continuity transform is screen-space state used only to keep the next
  // review action stationary after a decision. Once the document owner moves,
  // restore document-space ownership before the next paint. This is an O(1)
  // state reset and deliberately performs no layout reads on the scroll path.
  setInstantLayoutTransitionsDisabled(true);
  sidebarOffsetY.value = 0;
  if (ownerScrollContinuityResetFrame != null) cancelAnimationFrame(ownerScrollContinuityResetFrame);
  ownerScrollContinuityResetFrame = requestAnimationFrame(() => {
    ownerScrollContinuityResetFrame = null;
    if (!directDecisionContinuity && !sidebarContinuityAnchor) {
      setInstantLayoutTransitionsDisabled(false);
    }
  });
};

const handleOwnerScroll = () => {
  releaseDecisionContinuityForOwnerScroll();
  refreshViewportWindow();
};

const registerOwnerScrollListeners = () => {
  const addTarget = (target) => {
    if (!target?.addEventListener || ownerScrollTargets.has(target)) return;
    target.addEventListener('scroll', handleOwnerScroll, { passive: true });
    ownerScrollTargets.add(target);
  };

  // `parent` is not necessarily the element that owns scrolling. Hosts often
  // place SuperDoc inside an outer overflow container, so subscribe to the
  // clipping ancestors that can move this rail as well as the page viewport.
  addTarget(props.parent);
  for (let ancestor = floatingCommentsContainer.value?.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (SCROLL_OWNER_OVERFLOW_VALUES.has(window.getComputedStyle(ancestor).overflowY)) {
      addTarget(ancestor);
    }
  }
  addTarget(window);
};

const unregisterOwnerScrollListeners = () => {
  for (const target of ownerScrollTargets) {
    target.removeEventListener?.('scroll', handleOwnerScroll);
  }
  ownerScrollTargets.clear();
};

const scheduleSidebarContinuityAlignment = () => {
  if (!sidebarContinuityAnchor || continuityAlignmentScheduled) return;

  continuityAlignmentScheduled = true;
  const generation = continuityAlignmentGeneration;
  if (continuityTransitionFrame != null) {
    cancelAnimationFrame(continuityTransitionFrame);
    continuityTransitionFrame = null;
  }
  setInstantLayoutTransitionsDisabled(true);

  nextTick(() => {
    continuityAlignmentScheduled = false;
    if (generation !== continuityAlignmentGeneration) {
      scheduleSidebarContinuityAlignment();
      return;
    }

    const { key, targetClientY } = sidebarContinuityAnchor;
    remeasureCommentKeys([key]);
    alignCommentKeyToClientY(key, targetClientY, (didAlign) => {
      if (generation !== continuityAlignmentGeneration) return;
      if (!didAlign) {
        setInstantLayoutTransitionsDisabled(false);
        return;
      }
      continuityTransitionFrame = requestAnimationFrame(() => {
        continuityTransitionFrame = null;
        if (generation === continuityAlignmentGeneration) {
          setInstantLayoutTransitionsDisabled(false);
        }
      });
    });
  });
};

const preserveSidebarContinuityAfterRemoval = (removedKey, currentIds) => {
  const targetKey = resolveRemovedReviewCardContinuityTarget({
    previousIds: renderedPositionOrder,
    currentIds,
    removedId: removedKey,
  });
  const targetElement = targetKey ? placeholderRefs.value[targetKey] : null;
  const targetClientY = targetElement?.getBoundingClientRect?.().top;

  if (!targetKey || !Number.isFinite(targetClientY)) {
    clearSidebarContinuityAnchor();
    return false;
  }

  sidebarContinuityAnchor = { key: targetKey, targetClientY };
  continuityAlignmentGeneration += 1;
  scheduleSidebarContinuityAlignment();
  return true;
};

// A direct accept/reject click stops propagation before the card becomes
// active. Capture the next card's client position before the async decision
// removes the clicked row so the same continuity path used by active-card
// decisions can keep the next visible action target stationary (SD-3855).
const prepareSidebarContinuityForDirectDecision = (event) => {
  const actionElement = event?.target?.closest?.('[data-comment-action]');
  const action = actionElement?.getAttribute?.('data-comment-action');
  if (action !== 'resolve' && action !== 'reject') return;

  // The pointer already reached this action, so any previous target no longer
  // needs its temporary hit area. A disabled action must not arm new state.
  releaseDirectDecisionContinuity();
  if (actionElement.getAttribute?.('aria-disabled') === 'true') return;

  const removedElement = actionElement.closest?.('[data-comment-id]');
  const removedKey = removedElement?.getAttribute?.('data-comment-id');
  if (!removedKey || String(activeCommentInstanceId.value ?? '') === String(removedKey)) return;

  const previousIds = allPositions.value
    .filter((position) => position.commentRef?.trackedChange)
    .map((position, index) => ({
      id: position.id,
      index,
      top: position.top,
    }))
    .filter((position) => Number.isFinite(position.top))
    .sort((left, right) => left.top - right.top || left.index - right.index)
    .map((position) => position.id);
  const targetKey = resolveRemovedReviewCardContinuityTarget({
    previousIds,
    currentIds: new Set(previousIds),
    removedId: removedKey,
  });
  const targetElement = targetKey ? placeholderRefs.value[targetKey] : null;
  const targetClientY = targetElement?.getBoundingClientRect?.().top;
  if (!targetKey || !Number.isFinite(targetClientY)) return;

  directDecisionContinuity = { removedKey, targetKey, targetClientY, applied: false };
  directDecisionSourceId = removedKey;
  directDecisionContinuityTargetId.value = targetKey;
  setInstantLayoutTransitionsDisabled(true);
};

// Re-measure when active comment changes. The active dialog expands (reply input, thread)
// and the previously active one collapses — both change height.
watch(activeCommentInstanceId, (newKey, oldKey) => {
  clearDeferredRemeasureTimers();
  const directDecisionOwnsTransition =
    directDecisionContinuity != null &&
    directDecisionSourceId != null &&
    [newKey, oldKey].some((key) => key != null && String(key) === String(directDecisionSourceId));
  if (!directDecisionOwnsTransition) {
    directDecisionSourceId = null;
    if (newKey) {
      releaseDirectDecisionContinuity();
      clearSidebarContinuityAnchor();
    } else if (oldKey) {
      const currentIds = new Set(allPositions.value.map((position) => position.id));
      if (!currentIds.has(oldKey)) {
        preserveSidebarContinuityAfterRemoval(oldKey, currentIds);
      } else {
        clearSidebarContinuityAnchor();
      }
    }
  }

  const keysToRemeasure = [newKey, oldKey];
  const hasPendingInstantAlignment =
    newKey && newKey === instantAlignmentInstanceKey.value && Number.isFinite(instantSidebarAlignmentTargetY.value);

  nextTick(() => {
    if (hasPendingInstantAlignment) {
      remeasureCommentKeys(keysToRemeasure);
      return;
    }

    scheduleDeferredRemeasure(keysToRemeasure);
  });
});

watch(
  [activeCommentInstanceId, instantAlignmentInstanceKey, instantSidebarAlignmentTargetY],
  ([activeKey, requestKey, targetY]) => {
    if (!activeKey || !requestKey || activeKey !== requestKey || !Number.isFinite(targetY)) return;
    applyInstantSidebarAlignment(activeKey, targetY);
  },
);

// Re-measure when editing state changes. Entering/exiting edit mode changes
// the dialog height (CommentInput + action buttons vs static text).
// We remeasure all visible dialogs because the editing comment's parent dialog
// might not be the activeComment (e.g., dropdown interaction deactivated it).
watch(editingCommentId, () => {
  clearDeferredRemeasureTimers();

  nextTick(() => {
    scheduleDeferredRemeasure(() => allPositions.value.map((pos) => pos.id));
  });
});

// Align the active comment bubble with the same on-screen Y position as its
// document anchor by translating the inner sidebar layer.
watch(activeComment, () => {
  if (scrollTimer) clearTimeout(scrollTimer);

  if (!activeComment.value) {
    clearInstantSidebarAlignment();
    if (sidebarContinuityAnchor) {
      scheduleSidebarContinuityAlignment();
      return;
    }
    setInstantLayoutTransitionsDisabled(false);
    sidebarOffsetY.value = 0;
    return;
  }
  const comment = isPendingThread(activeComment.value)
    ? pendingComment.value
    : commentsStore.getComment(activeComment.value);
  if (!comment) return;
  const key = isPendingThread(activeComment.value) ? 'pending' : activeCommentInstanceId.value;
  if (!key) return;
  const instantAlignment =
    key === instantAlignmentInstanceKey.value && Number.isFinite(instantSidebarAlignmentTargetY.value);
  if (instantAlignment) {
    setInstantLayoutTransitionsDisabled(true);
    return;
  }

  nextTick(() => {
    const applyAlignment = () => {
      const el = placeholderRefs.value[key];
      if (!el) return;
      const parentRect = props.parent?.getBoundingClientRect?.();
      if (!parentRect) return;

      const activePosition = allPositions.value.find((position) => position.id === key);
      const anchorTop = key === 'pending' ? getPendingAnchorTop() : activePosition?.anchorTop;
      if (typeof anchorTop !== 'number' || isNaN(anchorTop)) return;

      const currentTop = el.getBoundingClientRect().top;
      const desiredTop = parentRect.top + anchorTop;
      sidebarOffsetY.value += desiredTop - currentTop;
    };

    // 400ms: wait for .comment-placeholder CSS transition (300ms) + buffer
    scrollTimer = setTimeout(applyAlignment, 400);
  });
});

// PDF zoom change: reset measurements
watch(activeZoom, () => {
  if (props.currentDocument.type === 'application/pdf') {
    for (const k in _heightsCache) delete _heightsCache[k];
    measuredHeights.value = {};
    commentsRenderKey.value += 1;
  }
});

// Track positioned IDs so we can detect additions/removals
let prevPositionIds = new Set();
let prevActiveAnchorTop = null;
let prevActiveLayoutTop = null;

// Re-observe when positions change; clean up stale heights and remeasure on add/remove
watch(allPositions, (positions) => {
  const activePosition = activeCommentInstanceId.value
    ? positions.find((position) => position.id === activeCommentInstanceId.value)
    : null;
  const activeAnchorTop =
    typeof activePosition?.anchorTop === 'number' && Number.isFinite(activePosition.anchorTop)
      ? activePosition.anchorTop
      : null;
  const activeAnchorMoved =
    activeAnchorTop != null && prevActiveAnchorTop != null && Math.abs(activeAnchorTop - prevActiveAnchorTop) > 1;
  const activeLayoutTop =
    typeof activePosition?.top === 'number' && Number.isFinite(activePosition.top) ? activePosition.top : null;
  const activeLayoutMoved =
    activeLayoutTop != null && prevActiveLayoutTop != null && Math.abs(activeLayoutTop - prevActiveLayoutTop) > 1;
  if (activeAnchorMoved && sidebarOffsetY.value !== 0 && !Number.isFinite(instantSidebarAlignmentTargetY.value)) {
    sidebarOffsetY.value = 0;
    setInstantLayoutTransitionsDisabled(false);
  } else if (
    activeLayoutMoved &&
    sidebarOffsetY.value !== 0 &&
    !Number.isFinite(instantSidebarAlignmentTargetY.value) &&
    !sidebarContinuityAnchor
  ) {
    // Windowed geometry can add or remove offscreen comment positions while
    // the active anchor itself stays put. Collision-floor normalization then
    // changes the active placeholder's document-space top. Preserve its
    // client-space position by applying the inverse delta to the translated
    // rail; otherwise the one-shot activation offset becomes stale and sends
    // an already-visible card offscreen.
    setInstantLayoutTransitionsDisabled(true);
    sidebarOffsetY.value += prevActiveLayoutTop - activeLayoutTop;
    if (activeLayoutContinuityFrame != null) cancelAnimationFrame(activeLayoutContinuityFrame);
    activeLayoutContinuityFrame = requestAnimationFrame(() => {
      activeLayoutContinuityFrame = null;
      if (!sidebarContinuityAnchor && !Number.isFinite(instantSidebarAlignmentTargetY.value)) {
        setInstantLayoutTransitionsDisabled(false);
      }
    });
  }
  prevActiveAnchorTop = activeAnchorTop;
  prevActiveLayoutTop = activeLayoutTop;

  const positionOrder = positions.map((position) => position.id);
  const currentIds = new Set(positionOrder);

  if (
    directDecisionContinuity &&
    !directDecisionContinuity.applied &&
    !currentIds.has(directDecisionContinuity.removedKey)
  ) {
    const { targetKey, targetClientY } = directDecisionContinuity;
    directDecisionContinuity.applied = true;
    if (currentIds.has(targetKey) && Number.isFinite(targetClientY)) {
      sidebarContinuityAnchor = { key: targetKey, targetClientY };
      continuityAlignmentGeneration += 1;
      scheduleSidebarContinuityAlignment();
    } else {
      releaseDirectDecisionContinuity();
    }
  }

  if (directDecisionContinuity?.applied && !currentIds.has(directDecisionContinuity.targetKey)) {
    releaseDirectDecisionContinuity();
  }

  if (sidebarContinuityAnchor && !currentIds.has(sidebarContinuityAnchor.key)) {
    const removedContinuityKey = sidebarContinuityAnchor.key;
    if (!preserveSidebarContinuityAfterRemoval(removedContinuityKey, currentIds)) {
      setInstantLayoutTransitionsDisabled(false);
      sidebarOffsetY.value = 0;
    }
  }

  // Eagerly add new IDs near the viewport so they render immediately.
  // The IntersectionObserver will asynchronously confirm/prune them.
  // Without this, comments flash blank on initial load because the observer
  // callback hasn't fired yet. We scope to nearby IDs to avoid mounting
  // every dialog at once on documents with 100+ comments.
  const newVisible = new Set(visibleIds.value);
  let visibilityChanged = false;

  let nearbyTop = -Infinity;
  let nearbyBottom = Infinity;
  const container = floatingCommentsContainer.value;
  if (container) {
    const rect = container.getBoundingClientRect();
    nearbyTop = -rect.top - OBSERVER_MARGIN;
    nearbyBottom = -rect.top + window.innerHeight + OBSERVER_MARGIN;
  }

  const positionById = new Map(positions.map((p) => [p.id, p]));
  for (const id of currentIds) {
    if (!newVisible.has(id)) {
      const pos = positionById.get(id);
      if (!pos || (pos.top >= nearbyTop && pos.top <= nearbyBottom)) {
        newVisible.add(id);
        visibilityChanged = true;
      }
    }
  }
  // Remove IDs no longer in allPositions
  for (const id of newVisible) {
    if (!currentIds.has(id)) {
      newVisible.delete(id);
      visibilityChanged = true;
    }
  }
  if (visibilityChanged) {
    visibleIds.value = newVisible;
  }

  // Clean up cached heights for removed comments
  for (const id of prevPositionIds) {
    if (!currentIds.has(id)) {
      delete _heightsCache[id];
    }
  }

  // If the set of IDs changed (comment added, deleted, or resolved), remeasure
  // remaining comments — their heights may have changed (e.g. parent card after
  // a child reply was deleted becomes shorter).
  const setChanged = prevPositionIds.size !== currentIds.size || [...prevPositionIds].some((id) => !currentIds.has(id));
  const orderChanged =
    renderedPositionOrder.length !== positionOrder.length ||
    renderedPositionOrder.some((id, index) => id !== positionOrder[index]);
  if (setChanged) {
    // Remove stale heights so allPositions recomputes with ESTIMATED_HEIGHT
    // for the next cycle, then measure actual heights after DOM settles.
    const cleaned = {};
    for (const id of currentIds) {
      if (_heightsCache[id]) cleaned[id] = _heightsCache[id];
    }
    measuredHeights.value = cleaned;

    nextTick(() => {
      for (const pos of positions) {
        const el = placeholderRefs.value[pos.id];
        if (!el) continue;
        const dialog = el.querySelector('.comments-dialog');
        if (!dialog) continue;
        storeHeight(pos.id, dialog.getBoundingClientRect().height);
      }
    });
  }

  if (sidebarContinuityAnchor && (setChanged || orderChanged)) {
    scheduleSidebarContinuityAlignment();
  }

  prevPositionIds = currentIds;
  nextTick(() => {
    renderedPositionOrder = positionOrder;
    observePlaceholders();
  });
});

onMounted(() => {
  setupObserver();
  registerOwnerScrollListeners();
  window.addEventListener('resize', refreshViewportWindow, { passive: true });
  document.addEventListener('pointerdown', releaseDirectDecisionContinuityForUnrelatedPointer, true);
  nextTick(observePlaceholders);
});

onBeforeUnmount(() => {
  clearDeferredRemeasureTimers();
  if (scrollTimer) clearTimeout(scrollTimer);
  releaseDirectDecisionContinuity();
  clearSidebarContinuityAnchor();
  if (activeLayoutContinuityFrame != null) {
    cancelAnimationFrame(activeLayoutContinuityFrame);
    activeLayoutContinuityFrame = null;
  }
  if (ownerScrollContinuityResetFrame != null) {
    cancelAnimationFrame(ownerScrollContinuityResetFrame);
    ownerScrollContinuityResetFrame = null;
  }
  unregisterOwnerScrollListeners();
  window.removeEventListener('resize', refreshViewportWindow);
  document.removeEventListener('pointerdown', releaseDirectDecisionContinuityForUnrelatedPointer, true);
  if (viewportFrame != null) {
    cancelAnimationFrame(viewportFrame);
    viewportFrame = null;
  }
  if (observer) {
    observer.disconnect();
    observer = null;
    observedElements.clear();
  }
  // NOTE: Do NOT clear _heightsCache here. The module-level cache is designed to
  // survive remounts caused by hasInitializedLocations toggle in SuperDoc.vue.
  // Clearing it causes flickering because every remount starts with estimated heights.
});
</script>

<template>
  <div
    class="section-wrapper"
    ref="floatingCommentsContainer"
    @click.capture="prepareSidebarContinuityForDirectDecision"
    :style="{
      minHeight: wrapperMinHeight + 'px',
      transition: disableInstantLayoutTransitions ? 'none' : undefined,
    }"
  >
    <div
      class="sidebar-container"
      :style="{
        transform: `translateY(${sidebarOffsetY}px)`,
        transition: disableInstantLayoutTransitions ? 'none' : undefined,
      }"
    >
      <!-- Only the bounded viewport window owns placeholders and dialogs. -->
      <div
        v-for="pos in allPositions"
        :key="pos.id"
        :ref="(el) => setPlaceholderRef(pos.id, el)"
        :data-comment-id="pos.id"
        :data-comment-instance-id="pos.id"
        :data-comment-thread-id="pos.threadId"
        :data-comment-position-key="pos.instanceRef?.positionKey ?? ''"
        :data-comment-page-index="pos.pageIndex ?? ''"
        :class="{
          'is-direct-decision-continuity-target': pos.id === directDecisionContinuityTargetId,
        }"
        :style="{
          // Excluded rows must stay outside the viewport when the active rail moves.
          top: (pos.isOffscreenReviewCard ? pos.top - sidebarOffsetY : pos.top) + 'px',
          height: pos.height + 'px',
          transition: disableInstantLayoutTransitions ? 'none' : undefined,
        }"
        class="comment-placeholder"
      >
        <!-- Only mount the heavy CommentDialog when near the viewport -->
        <CommentDialog
          v-if="shouldRenderDialog(pos)"
          :key="pos.id + commentsRenderKey"
          @ready="handleDialog"
          @resize="handleResize(pos)"
          class="floating-comment"
          :parent="parent"
          :comment="pos.commentRef"
          :floating-instance-id="pos.id"
          :floating-page-index="pos.pageIndex"
          :floating-position-entry="pos.instanceRef?.positionEntry ?? null"
          :is-floating-instance-active="pos.id === activeCommentInstanceId"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.comment-placeholder {
  position: absolute;
  width: 300px;
  transition: top 0.3s ease;
}

.comment-placeholder.is-direct-decision-continuity-target :deep(.overflow-menu) {
  opacity: 1;
  pointer-events: auto;
}

.floating-comment {
  position: relative;
  display: block;
  min-width: 300px;
}

.sidebar-container {
  position: absolute;
  width: 300px;
  min-height: 300px;
  transition: transform 0.3s ease;
  will-change: transform;
}

.section-wrapper {
  position: relative;
  min-height: 100%;
  width: 300px;
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  /* SD-2034: smooth min-height changes to prevent scrollbar flash */
  transition: min-height 0.5s ease-out;
}
</style>
