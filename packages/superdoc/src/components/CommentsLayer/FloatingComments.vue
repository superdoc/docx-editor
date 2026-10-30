<script lang="ts">
// Module-level cache — survives component remounts caused by hasInitializedLocations toggle
const _heightsCache: Record<string, number> = {};
</script>

<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { ref, computed, nextTick, watch, onMounted, onBeforeUnmount } from 'vue';
import type { PropType, Ref } from 'vue';
import { useCommentsStore } from '../../stores/comments-store';
import { useSuperdocStore } from '../../stores/superdoc-store';
import type { Document as SuperDocDocument } from '../../core/types/index.js';
import CommentDialog from './CommentDialog.vue';
import { isFiniteNumber } from '../../helpers/is-finite-number.js';
import type useComment from './use-comment';
import {
  normalizeFloatingAnchorTop,
  resolveRemovedReviewCardContinuityTarget,
  resolveOffscreenFloatingCardTop,
  shouldMountFloatingCommentDialog,
} from './floating-comment-positioning.js';

type FloatingComment = ReturnType<typeof useComment>;

type PositionEntry = {
  pageIndex?: number | null;
  bounds?: { top?: number; bottom?: number } | null;
};

type FloatingInstance = {
  id: string;
  comment: FloatingComment;
  positionKey?: string | null;
  positionEntry?: PositionEntry | null;
  pageIndex?: number | null;
  isPrimary?: boolean;
  mount?: boolean;
};

type ReviewCoordinate = {
  documentEpoch: string;
  mountId: string;
  commitSequence: number;
  reviewVersion: number;
};

type ReviewInstance = {
  id: string;
  rowId: string;
  threadId: string;
  pageIndex: number | null;
  positionKey: string | null;
  positionEntry: PositionEntry | null;
  anchorTop: number;
  anchorBottom: number;
  top: number;
  height: number;
  isPrimary: boolean;
  isOffscreenReviewCard: boolean;
  mount: boolean;
};

type CommittedInstance = ReviewInstance & { comment: FloatingComment; rowVersion: number };

type DecisionContinuityRequest = ReviewCoordinate & {
  removedInstanceId: string;
  removedRowVersion: number;
  targetInstanceId: string;
  targetRowVersion: number;
  top: number;
};

type WorkerDecisionContinuity = {
  documentId: string;
  documentMode: string;
  request: DecisionContinuityRequest;
};

type ViewportRange = { top: number; bottom: number };

type ReviewViewport = ViewportRange & {
  width: number;
  scale: number;
  stageOffsetX: number;
  stageOffsetY: number;
};

type ReviewContextInput = {
  decisionContinuity: DecisionContinuityRequest | null;
  activeThreadId: string | null;
  activeInstanceId: string | null;
  editingRowId: string | null;
  retainedThreadIds: string[];
  visibility: { comments: boolean; trackedChanges: boolean };
  viewport: ReviewViewport;
  pending: { anchorTop: number | null; height: number } | null;
  measurements: { instanceId: string; rowVersion: number; height: number; fontRevision?: number }[];
};

type ReviewPresentation = {
  instances: ReviewInstance[];
  rowVersions: Record<string, number | undefined>;
  coordinate?: ReviewCoordinate | null;
  fontRevision?: number;
  readPaintOrigin?: () => { left: number; top: number } | null;
  readFontRevision?: () => number;
  updateContext: (input: ReviewContextInput, readViewport?: () => ReviewViewport | null) => void;
};

type FloatingCommentsStore = {
  clearInstantSidebarAlignment: () => void;
  committedReviewPresentations: Record<string, ReviewPresentation | undefined>;
  commentsList: FloatingComment[];
  getFloatingCommentInstances: FloatingInstance[];
  belongsToDocument: (
    comment: FloatingComment,
    activeDocumentId: string,
    options: { allowSingleDocumentMismatch: boolean },
  ) => boolean;
  getComment: (id: string) => unknown;
  viewingVisibility: { documentMode: string; commentsVisible: boolean; trackChangesVisible: boolean };
};

type FloatingCommentsStoreRefs = {
  activeComment: Ref<string | null>;
  activeFloatingCommentInstanceId: Ref<string | null>;
  editorCommentPositions: Ref<Record<string, PositionEntry | undefined>>;
  pendingComment: Ref<FloatingComment | null>;
  editingCommentId: Ref<string | null>;
  instantSidebarAlignmentTargetY: Ref<number | null>;
  instantSidebarAlignmentThreadId: Ref<string | null>;
  instantSidebarAlignmentInstanceId: Ref<string | null>;
};

type FloatingPosition = {
  id: string;
  threadId?: string;
  pageIndex?: number | null;
  anchorTop: number;
  anchorBottom: number;
  hasAnchorGeometry: boolean;
  top: number;
  height: number;
  isOffscreenReviewCard?: boolean;
  commentRef: FloatingComment;
  instanceRef?: FloatingInstance | CommittedInstance;
};

type GeometryBearingInstance = {
  id: string;
  threadId: string;
  instance: FloatingInstance;
  top: number;
  anchorBottom: number;
};

type DialogReadyPayload = {
  commentId?: string | null;
  elementRef?: { readonly value: Element | null } | null;
};

type ContinuityAnchor = { key: string; targetClientY: number };

type DirectDecisionContinuity = { removedKey: string; targetKey: string; targetClientY: number; applied: boolean };

const ESTIMATED_HEIGHT = 110;
const OBSERVER_MARGIN = 600;
const SCROLL_OWNER_OVERFLOW_VALUES = new Set(['auto', 'scroll', 'hidden', 'clip']);

// Layout algorithm: positions comments in a single column with collision avoidance.
// When a comment is active it pins at its anchor; neighbors push up/down to avoid overlap.
// Earlier neighbors may clip above the viewport; the selected anchor stays fixed.
const resolveCollisions = (positions: FloatingPosition[], activeIndex: number, gap: number) => {
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
    type: Object as PropType<SuperDocDocument>,
    required: true,
  },
  parent: {
    type: Object as PropType<HTMLElement>,
    required: true,
  },
});

const superdocStore = useSuperdocStore();
const piniaCommentsStore = useCommentsStore();
const commentsStore: FloatingCommentsStore = piniaCommentsStore;
const { clearInstantSidebarAlignment } = commentsStore;

const commentsStoreRefs: FloatingCommentsStoreRefs = storeToRefs(piniaCommentsStore);
const {
  activeComment,
  activeFloatingCommentInstanceId,
  editorCommentPositions,
  pendingComment,
  editingCommentId,
  instantSidebarAlignmentTargetY,
  instantSidebarAlignmentThreadId,
  instantSidebarAlignmentInstanceId,
} = commentsStoreRefs;
const { activeZoom } = storeToRefs(superdocStore);

// Access the Pinia getter directly instead of storeToRefs(). In this component
// the getter-backed ref can lag behind the live store array during rapid
// tracked-change updates, which collapses the virtualized sidebar to a stale subset.
// Instances are scoped to the document this FloatingComments instance renders so
// a multi-document session (e.g. a PDF plus a DOCX) does not paint another
// document's comment cards into the wrong lane.
const committedPresentation = computed(
  () => commentsStore.committedReviewPresentations?.[String(props.currentDocument?.id)] ?? null,
);
const committedInstances = computed(() => {
  const presentation = committedPresentation.value;
  if (!presentation) return null;
  const rows = new Map(
    commentsStore.commentsList
      .filter((row) => String(row.fileId) === String(props.currentDocument?.id))
      .map((row) => [String(row.commentId), row]),
  );
  return presentation.instances.flatMap((instance) => {
    const comment = instance.rowId === 'pending' ? pendingComment.value : rows.get(instance.rowId);
    return comment ? [{ ...instance, comment, rowVersion: presentation.rowVersions[instance.rowId] ?? 0 }] : [];
  });
});
const floatingCommentInstances = computed(() => {
  if (committedInstances.value) return committedInstances.value.filter((instance) => instance.rowId !== 'pending');
  const currentFloatingCommentInstances = commentsStore.getFloatingCommentInstances;
  if (!Array.isArray(currentFloatingCommentInstances)) return [];
  const documentId = props.currentDocument?.id;
  if (documentId == null) return currentFloatingCommentInstances;
  return currentFloatingCommentInstances.filter((instance) =>
    commentsStore.belongsToDocument(instance.comment, String(documentId), { allowSingleDocumentMismatch: true }),
  );
});

const floatingCommentsContainer = ref<HTMLElement | null>(null);
const commentsRenderKey = ref(0);
const sidebarOffsetY = ref(0);
const disableInstantLayoutTransitions = ref(false);
const directDecisionContinuityTargetId = ref<string | null>(null);
const workerDecisionContinuity = ref<WorkerDecisionContinuity | null>(null);
const viewportRevision = ref(0);

const isPendingThread = (commentOrId: FloatingComment | string | null) => {
  const pendingId = pendingComment.value?.commentId;
  if (!pendingId) return false;
  if (typeof commentOrId === 'object') return commentOrId?.commentId === pendingId;
  return commentOrId === pendingId || commentOrId === 'pending';
};

const getThreadId = (comment: FloatingComment | null | undefined) => {
  return comment?.commentId ?? comment?.importedId ?? null;
};

const floatingInstanceIndex = computed(() => {
  const byId = new Map<string, FloatingInstance>();
  const byThreadId = new Map<string, FloatingInstance[]>();
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

const findPrimaryInstanceIdForThread = (threadId: string | null) => {
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

const resolveFloatingInstanceId = (threadId: string | null, preferredInstanceId: string | null = null) => {
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

const toFinitePdfCoordinate = (value: unknown) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

// Heights: measured (actual) or estimated. Seeded from module-level cache to
// survive remounts triggered by hasInitializedLocations toggle in SuperDoc.vue.
const measuredHeights = ref<Record<string, number>>({ ..._heightsCache });
const measuredFontRevisions = ref<Record<string, number | undefined>>({});

// Set of comment IDs that are near the viewport (should mount CommentDialog)
const visibleIds = ref(new Set<string>());

// Refs for placeholder elements keyed by comment ID
const placeholderRefs = ref<Record<string, HTMLElement | undefined>>({});

let observer: IntersectionObserver | null = null;
// Track which DOM elements are currently being observed (avoids disconnect/re-observe cycle)
const observedElements = new Set<HTMLElement>();
let viewportFrame: number | null = null;
const refreshViewportWindow = () => {
  if (viewportFrame != null) return;
  viewportFrame = requestAnimationFrame(() => {
    viewportFrame = null;
    viewportRevision.value += 1;
  });
};

// Compute anchor position for a floating comment instance.
const getAnchorTop = (instance: FloatingInstance) => {
  if (props.currentDocument.type === 'application/pdf') {
    const zoom = (activeZoom.value ?? 100) / 100;
    const top = toFinitePdfCoordinate(instance?.comment?.selection?.selectionBounds?.top);
    return top == null ? null : top * zoom;
  }

  return instance?.positionEntry?.bounds?.top;
};

const getAnchorBottom = (instance: FloatingInstance, anchorTop: number) => {
  if (props.currentDocument.type === 'application/pdf') {
    const zoom = (activeZoom.value ?? 100) / 100;
    const bottom = toFinitePdfCoordinate(instance?.comment?.selection?.selectionBounds?.bottom);
    return bottom != null ? bottom * zoom : anchorTop;
  }

  const bottom = instance?.positionEntry?.bounds?.bottom;
  return isFiniteNumber(bottom) ? bottom : anchorTop;
};

// Geometry changes are less frequent than scroll events. Cache the small set
// of geometry-bearing rows so viewport refreshes never rescan the complete
// logical tracked-change catalog.
const geometryBearingInstances = computed(() => {
  const positioned: GeometryBearingInstance[] = [];
  for (const instance of floatingCommentInstances.value) {
    const id = instance?.id;
    const threadId = getThreadId(instance?.comment);
    const anchorTop = getAnchorTop(instance);
    if (id == null || threadId == null || !isFiniteNumber(anchorTop)) continue;
    const top = normalizeFloatingAnchorTop(anchorTop);
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

const shouldRenderDialog = (position: FloatingPosition) => {
  return shouldMountFloatingCommentDialog({
    id: position?.id,
    visibleIds: committedPresentation.value
      ? new Set(allPositions.value.filter((item) => item.instanceRef?.mount).map((item) => item.id))
      : visibleIds.value,
    activeCommentInstanceId: activeCommentInstanceId.value,
  });
};

const getFloatingViewportRange = (): ViewportRange | null => {
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
  if (committedInstances.value)
    return committedInstances.value.map((instance) => ({
      id: instance.id,
      threadId: instance.threadId,
      pageIndex: instance.pageIndex,
      anchorTop: instance.anchorTop,
      anchorBottom: instance.anchorBottom,
      top: instance.top,
      height: instance.height,
      hasAnchorGeometry: instance.positionEntry != null || instance.rowId === 'pending',
      isOffscreenReviewCard: instance.isOffscreenReviewCard,
      commentRef: instance.comment,
      instanceRef: instance,
    }));
  const positionedInstances = geometryBearingInstances.value;
  const hasPending = pendingComment.value && pendingComment.value.fileId === props.currentDocument.id;
  if (!positionedInstances.length && !floatingCommentInstances.value.length && !hasPending) return [];

  const positions: FloatingPosition[] = [];
  const viewportRange = getFloatingViewportRange() ?? {
    top: 0,
    bottom: Math.max(0, props.parent?.clientHeight || window.innerHeight || 0),
  };
  const renderTop = viewportRange.top - OBSERVER_MARGIN;
  const renderBottom = viewportRange.bottom + OBSERVER_MARGIN;
  const activeKey = hasPending ? 'pending' : activeCommentInstanceId.value;
  const positionIds = new Set<string>();
  const pushPosition = ({
    id,
    threadId,
    instance,
    top,
    anchorBottom,
    hasAnchorGeometry,
  }: GeometryBearingInstance & { hasAnchorGeometry: boolean }) => {
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

  const transitionalInstances: FloatingInstance[] = [];
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
        commentRef: pendingComment.value!,
      });
    }
  }

  positions.sort((a, b) => a.anchorTop - b.anchorTop);

  // Review cards whose anchors are outside the viewport remain in
  // the bounded output, but they cannot participate in visible-card collision
  // layout. Otherwise they advance the collision cursor and are then restored
  // offscreen, leaving downstream visible cards displaced by rows that no
  // longer occupy those packed positions.
  const collisionPositions = [];
  for (const position of positions) {
    const offscreenTop = position.hasAnchorGeometry
      ? resolveOffscreenFloatingCardTop({
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

const readReviewViewport = (): ReviewViewport | null => {
  const presentation = committedPresentation.value,
    container = floatingCommentsContainer.value;
  if (!presentation || !container) return null;
  viewportRevision.value;
  const viewport = getFloatingViewportRange();
  if (!viewport) return null;
  const rail = container.getBoundingClientRect();
  // A contained document can scroll without moving the outer layers or rail.
  // Worker anchors start at the attached paint root, not those outer layers.
  const stage =
    typeof presentation.readPaintOrigin === 'function'
      ? presentation.readPaintOrigin()
      : props.parent?.getBoundingClientRect?.();
  if (!stage || !Number.isFinite(stage.left) || !Number.isFinite(stage.top)) return null;
  return {
    ...viewport,
    width: Math.max(1, rail.width),
    scale: 1,
    stageOffsetX: stage.left - rail.left,
    stageOffsetY: stage.top - rail.top,
  };
};
const measuredReviewContext = computed((): ReviewContextInput | null => {
  const presentation = committedPresentation.value;
  const viewport = readReviewViewport();
  if (!presentation || !viewport) return null;
  const instances = committedInstances.value ?? [];
  const captured = workerDecisionContinuity.value;
  const coordinate = presentation.coordinate;
  const target = captured && instances.find((instance) => instance.id === captured.request.targetInstanceId);
  const ownsContinuity =
    captured &&
    coordinate &&
    target &&
    captured.documentId === String(props.currentDocument.id) &&
    captured.documentMode === commentsStore.viewingVisibility?.documentMode &&
    coordinate.documentEpoch === captured.request.documentEpoch &&
    coordinate.mountId === captured.request.mountId &&
    coordinate.commitSequence >= captured.request.commitSequence &&
    coordinate.commitSequence <= captured.request.commitSequence + 1 &&
    target.rowVersion === captured.request.targetRowVersion;
  return {
    decisionContinuity: ownsContinuity ? { ...captured.request } : null,
    activeThreadId: activeComment.value == null ? null : String(activeComment.value),
    activeInstanceId: activeCommentInstanceId.value == null ? null : String(activeCommentInstanceId.value),
    editingRowId: editingCommentId.value == null ? null : String(editingCommentId.value),
    retainedThreadIds: [],
    visibility: {
      comments:
        commentsStore.viewingVisibility?.documentMode !== 'viewing' ||
        commentsStore.viewingVisibility?.commentsVisible === true,
      trackedChanges:
        commentsStore.viewingVisibility?.documentMode !== 'viewing' ||
        commentsStore.viewingVisibility?.trackChangesVisible === true,
    },
    viewport,
    pending:
      pendingComment.value?.fileId === props.currentDocument.id && getPendingAnchorTop() != null
        ? { anchorTop: getPendingAnchorTop(), height: measuredHeights.value.pending || ESTIMATED_HEIGHT }
        : null,
    measurements: instances
      .filter((instance) => measuredHeights.value[instance.id] > 0)
      .map((instance) => ({
        instanceId: instance.id,
        rowVersion: instance.rowVersion,
        height: measuredHeights.value[instance.id],
        fontRevision: measuredFontRevisions.value[instance.id],
      })),
  };
});
watch(
  measuredReviewContext,
  (input) => {
    if (input) committedPresentation.value?.updateContext(input, readReviewViewport);
  },
  { immediate: true },
);

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
        const id = (entry.target as HTMLElement).dataset.commentId;
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
const storeHeight = (key: string, height: number) => {
  if (height <= 0) return;
  const fontRevision = committedPresentation.value?.readFontRevision?.();
  if (height === measuredHeights.value[key] && fontRevision === measuredFontRevisions.value[key]) return;
  _heightsCache[key] = height;
  measuredFontRevisions.value = { ...measuredFontRevisions.value, [key]: fontRevision };
  measuredHeights.value = { ...measuredHeights.value, [key]: height };
};

const remeasureAfterFontChange = () => {
  measuredFontRevisions.value = {};
  nextTick(() => {
    for (const [key, placeholder] of Object.entries(placeholderRefs.value)) {
      const dialog = placeholder?.querySelector('.comments-dialog');
      if (dialog) storeHeight(key, dialog.getBoundingClientRect().height);
    }
  });
};

watch(
  () => committedPresentation.value?.fontRevision,
  (revision) => {
    if (revision != null) remeasureAfterFontChange();
  },
);

// When a CommentDialog mounts and reports its size, record the measured height.
const handleDialog = (dialog: DialogReadyPayload | null | undefined) => {
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
const handleResize = (position: FloatingPosition) => {
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

const setInstantLayoutTransitionsDisabled = (disabled: boolean) => {
  if (!disabled && directDecisionContinuityTargetId.value != null) return;
  disableInstantLayoutTransitions.value = disabled;
};

const alignCommentKeyToClientY = (key: string, targetY: number, onComplete?: (didAlign: boolean) => void) => {
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
const setPlaceholderRef = (id: string, el: HTMLElement | null) => {
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
let remeasureTimers: ReturnType<typeof setTimeout>[] = [];
let scrollTimer: ReturnType<typeof setTimeout> | null = null;
// A decision removes the active row before clearing activeComment. Keep one
// surviving row as a visual anchor so subsequent list reconciliation cannot
// translate the entire review rail back to its unshifted origin.
let renderedPositionOrder: string[] = [];
let sidebarContinuityAnchor: ContinuityAnchor | null = null;
let continuityAlignmentScheduled = false;
let continuityAlignmentGeneration = 0;
let continuityTransitionFrame: number | null = null;
let activeLayoutContinuityFrame: number | null = null;
let directDecisionContinuity: DirectDecisionContinuity | null = null;
let directDecisionSourceId: string | null = null;
let ownerScrollContinuityResetFrame: number | null = null;
const ownerScrollTargets = new Set<EventTarget>();

const releaseDirectDecisionContinuity = () => {
  directDecisionContinuity = null;
  directDecisionSourceId = null;
  directDecisionContinuityTargetId.value = null;
  workerDecisionContinuity.value = null;
  setInstantLayoutTransitionsDisabled(false);
};

watch(
  [
    () => props.currentDocument?.id,
    () => committedPresentation.value?.coordinate?.documentEpoch,
    () => committedPresentation.value?.coordinate?.mountId,
    () => commentsStore.viewingVisibility?.documentMode,
  ],
  () => releaseDirectDecisionContinuity(),
);

const releaseDirectDecisionContinuityForUnrelatedPointer = (event: PointerEvent) => {
  if (!directDecisionContinuity) return;
  const target = event?.target instanceof Element ? event.target : null;
  const actionElement = target?.closest?.('[data-comment-action]');
  const action = actionElement?.getAttribute?.('data-comment-action');
  const continuesReviewSequence =
    (action === 'resolve' || action === 'reject') && floatingCommentsContainer.value?.contains?.(actionElement ?? null);
  if (!continuesReviewSequence) {
    releaseDirectDecisionContinuity();
  }
};

const clearDeferredRemeasureTimers = () => {
  remeasureTimers.forEach(clearTimeout);
  remeasureTimers = [];
};

const remeasureCommentKeys = (keys: readonly (string | null | undefined)[]) => {
  for (const key of keys.filter((candidate): candidate is string => Boolean(candidate))) {
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
const scheduleDeferredRemeasure = (
  keysOrGetter: readonly (string | null | undefined)[] | (() => readonly (string | null | undefined)[]),
) => {
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

const applyInstantSidebarAlignment = (key: string, targetY: number) => {
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

// Contained roots are siblings of the sidebar. Capture only their scrolls,
// including roots replaced on document reload; nested editor controls do not
// own document geometry or release review-action continuity.
const handleDocumentScroll = (event: Event) => {
  if (event.target instanceof Element && event.target.matches('.superdoc__sub-document')) {
    handleOwnerScroll();
  }
};

const registerOwnerScrollListeners = () => {
  const addTarget = (target: EventTarget | null | undefined) => {
    if (!target?.addEventListener || ownerScrollTargets.has(target)) return;
    target.addEventListener('scroll', handleOwnerScroll, { passive: true });
    ownerScrollTargets.add(target);
  };

  // `parent` is not necessarily the element that owns scrolling. Hosts often
  // place SuperDoc inside an outer overflow container, so subscribe to the
  // clipping ancestors that can move this rail as well as the page viewport.
  addTarget(props.parent);
  props.parent?.addEventListener?.('scroll', handleDocumentScroll, { passive: true, capture: true });
  for (let ancestor = floatingCommentsContainer.value?.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (SCROLL_OWNER_OVERFLOW_VALUES.has(window.getComputedStyle(ancestor).overflowY)) {
      addTarget(ancestor);
    }
  }
  addTarget(window);
};

const unregisterOwnerScrollListeners = () => {
  props.parent?.removeEventListener?.('scroll', handleDocumentScroll, true);
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

    const { key, targetClientY } = sidebarContinuityAnchor!;
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

const preserveSidebarContinuityAfterRemoval = (removedKey: string, currentIds: ReadonlySet<string>) => {
  const targetKey = resolveRemovedReviewCardContinuityTarget({
    previousIds: renderedPositionOrder,
    currentIds,
    removedId: removedKey,
  });
  const targetElement = targetKey ? placeholderRefs.value[targetKey] : null;
  const targetClientY = targetElement?.getBoundingClientRect?.().top;

  if (!targetKey || !isFiniteNumber(targetClientY)) {
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
const prepareSidebarContinuityForDirectDecision = (event: MouseEvent) => {
  const eventTarget = event?.target instanceof Element ? event.target : null;
  const actionElement = eventTarget?.closest?.('[data-comment-action]');
  const action = actionElement?.getAttribute?.('data-comment-action');
  if (!actionElement || (action !== 'resolve' && action !== 'reject')) return;

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
  if (!targetKey || !isFiniteNumber(targetClientY)) return;

  directDecisionContinuity = { removedKey, targetKey, targetClientY, applied: false };
  directDecisionSourceId = removedKey;
  directDecisionContinuityTargetId.value = targetKey;
  setInstantLayoutTransitionsDisabled(true);
  const presentation = committedPresentation.value;
  const coordinate = presentation?.coordinate;
  const removed = committedInstances.value?.find((instance) => instance.id === removedKey);
  const target = committedInstances.value?.find((instance) => instance.id === targetKey);
  const origin = presentation?.readPaintOrigin?.();
  if (
    coordinate &&
    typeof coordinate.documentEpoch === 'string' &&
    coordinate.documentEpoch &&
    typeof coordinate.mountId === 'string' &&
    coordinate.mountId &&
    Number.isSafeInteger(coordinate.commitSequence) &&
    coordinate.commitSequence >= 0 &&
    Number.isSafeInteger(coordinate.reviewVersion) &&
    coordinate.reviewVersion > 0 &&
    removed &&
    target &&
    Number.isSafeInteger(removed.rowVersion) &&
    removed.rowVersion > 0 &&
    Number.isSafeInteger(target.rowVersion) &&
    target.rowVersion > 0 &&
    origin &&
    Number.isFinite(origin.left) &&
    Number.isFinite(origin.top)
  ) {
    workerDecisionContinuity.value = {
      documentId: String(props.currentDocument.id),
      documentMode: commentsStore.viewingVisibility?.documentMode,
      request: {
        ...coordinate,
        removedInstanceId: removedKey,
        removedRowVersion: removed.rowVersion,
        targetInstanceId: targetKey,
        targetRowVersion: target.rowVersion,
        top: targetClientY - floatingCommentsContainer.value!.getBoundingClientRect().top,
      },
    };
    // Capture precedes the action's async mutation, so its source-owned worker
    // context must be ordered before that decision rather than a later watcher.
    const input = measuredReviewContext.value;
    if (input) presentation.updateContext(input);
  }
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
    if (!activeKey || !requestKey || activeKey !== requestKey || !isFiniteNumber(targetY)) return;
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
let prevPositionIds = new Set<string>();
let prevActiveInstanceId: string | null = null;
let prevActiveAnchorTop: number | null = null;
let prevActiveLayoutTop: number | null = null;

// Re-observe when positions change; clean up stale heights and remeasure on add/remove
watch(allPositions, (positions) => {
  const activePosition = activeCommentInstanceId.value
    ? positions.find((position) => position.id === activeCommentInstanceId.value)
    : null;
  const activeAnchorTop = isFiniteNumber(activePosition?.anchorTop) ? activePosition.anchorTop : null;
  const sameActiveInstance = activeCommentInstanceId.value === prevActiveInstanceId;
  const activeAnchorMoved =
    sameActiveInstance &&
    activeAnchorTop != null &&
    prevActiveAnchorTop != null &&
    Math.abs(activeAnchorTop - prevActiveAnchorTop) > 1;
  const activeLayoutTop = isFiniteNumber(activePosition?.top) ? activePosition.top : null;
  const activeLayoutMoved =
    sameActiveInstance &&
    activeLayoutTop != null &&
    prevActiveLayoutTop != null &&
    Math.abs(activeLayoutTop - prevActiveLayoutTop) > 1;
  if (activeAnchorMoved && sidebarOffsetY.value !== 0 && !Number.isFinite(instantSidebarAlignmentTargetY.value)) {
    sidebarOffsetY.value = 0;
    setInstantLayoutTransitionsDisabled(false);
  } else if (
    activeLayoutMoved &&
    sidebarOffsetY.value !== 0 &&
    !Number.isFinite(instantSidebarAlignmentTargetY.value) &&
    !sidebarContinuityAnchor
  ) {
    // Preserve a translated active row when windowed geometry changes its
    // offscreen placement without moving the same instance's anchor.
    setInstantLayoutTransitionsDisabled(true);
    sidebarOffsetY.value += prevActiveLayoutTop! - activeLayoutTop;
    if (activeLayoutContinuityFrame != null) cancelAnimationFrame(activeLayoutContinuityFrame);
    activeLayoutContinuityFrame = requestAnimationFrame(() => {
      activeLayoutContinuityFrame = null;
      if (!sidebarContinuityAnchor && !Number.isFinite(instantSidebarAlignmentTargetY.value)) {
        setInstantLayoutTransitionsDisabled(false);
      }
    });
  }
  prevActiveInstanceId = activeCommentInstanceId.value;
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
    const cleaned: Record<string, number> = {};
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
  document.fonts?.addEventListener('loadingdone', remeasureAfterFontChange);
  document.fonts?.addEventListener('loadingerror', remeasureAfterFontChange);
  setupObserver();
  registerOwnerScrollListeners();
  window.addEventListener('resize', refreshViewportWindow, { passive: true });
  document.addEventListener('pointerdown', releaseDirectDecisionContinuityForUnrelatedPointer, true);
  nextTick(observePlaceholders);
});

onBeforeUnmount(() => {
  document.fonts?.removeEventListener('loadingdone', remeasureAfterFontChange);
  document.fonts?.removeEventListener('loadingerror', remeasureAfterFontChange);
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
      '--sd-ui-comments-transition': committedPresentation ? 'none' : undefined,
      transition: committedPresentation || disableInstantLayoutTransitions ? 'none' : undefined,
    }"
  >
    <div
      class="sidebar-container"
      :style="{
        transform: `translateY(${committedPresentation ? 0 : sidebarOffsetY}px)`,
        transition: committedPresentation || disableInstantLayoutTransitions ? 'none' : undefined,
      }"
    >
      <!-- Only the bounded viewport window owns placeholders and dialogs. -->
      <div
        v-for="pos in allPositions"
        :key="pos.id"
        :ref="(el) => setPlaceholderRef(pos.id, el as HTMLElement | null)"
        :data-comment-id="pos.id"
        :data-comment-instance-id="pos.id"
        :data-comment-thread-id="pos.threadId"
        :data-comment-position-key="pos.instanceRef?.positionKey ?? ''"
        :data-comment-page-index="pos.pageIndex ?? ''"
        :class="{
          'is-direct-decision-continuity-target': pos.id === directDecisionContinuityTargetId,
        }"
        :style="{
          // Only the legacy translated rail needs compensation for excluded rows.
          top: (pos.isOffscreenReviewCard && !committedPresentation ? pos.top - sidebarOffsetY : pos.top) + 'px',
          height: pos.height + 'px',
          transition: committedPresentation || disableInstantLayoutTransitions ? 'none' : undefined,
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
          :floating-page-index="pos.pageIndex ?? undefined"
          :floating-position-entry="pos.instanceRef?.positionEntry ?? undefined"
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
