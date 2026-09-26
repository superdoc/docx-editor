<script setup>
/**
 * SurfaceHost — mounted once as the last child of .superdoc.
 *
 * Reads the SurfaceManager's reactive state (activeDialog / activeFloating)
 * and renders the appropriate surface shell for each slot.
 *
 * Floating surfaces are clipped to the visible document viewport. Modal
 * dialogs are siblings of that clipped host so their backdrop covers the
 * browser viewport, including toolbars and surrounding application content.
 *
 * Floating Escape and outside-pointer-down handling live here (document-level)
 * because floating surfaces are non-modal — focus can be anywhere in the
 * SuperDoc UI. Dialog Escape is handled within SurfaceDialog's focus trap.
 */
import { inject, computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import SurfaceDialog from './SurfaceDialog.vue';
import SurfaceFloating from './SurfaceFloating.vue';

const props = defineProps({
  geometryTarget: { type: Object, default: null },
});

const surfaceManager = inject('surfaceManager', null);

const dialog = computed(() => surfaceManager?.activeDialog.value ?? null);
const floating = computed(() => surfaceManager?.activeFloating.value ?? null);
const hasAnySurface = computed(() => dialog.value != null || floating.value != null);

const hostRef = ref(null);
const floatingRef = ref(null);
const hostStyle = ref({});

// ---------------------------------------------------------------------------
// Viewport geometry — position:fixed host sized to the visible document area
// ---------------------------------------------------------------------------

/** CSS overflow values that create a clipping boundary. */
const CLIPPING_OVERFLOW = new Set(['hidden', 'scroll', 'auto', 'clip']);

/**
 * Collect ancestor elements that clip the target via overflow.
 * Used by both setupGeometry (to observe resizes) and computeVisibleRect
 * (to intersect bounding rects).
 */
function collectClippingAncestors(el) {
  const ancestors = [];
  let ancestor = el.parentElement;
  while (ancestor) {
    const style = getComputedStyle(ancestor);
    if (CLIPPING_OVERFLOW.has(style.overflowX) || CLIPPING_OVERFLOW.has(style.overflowY)) {
      ancestors.push(ancestor);
    }
    ancestor = ancestor.parentElement;
  }
  return ancestors;
}

/**
 * Compute the visible rect of an element by intersecting its bounding rect
 * with every clipping ancestor and the browser viewport.
 *
 * Accepts pre-collected clipping ancestors to avoid re-walking the DOM on
 * every scroll/resize tick.
 */
function computeVisibleRect(el, clippingAncestors) {
  let top = 0;
  let left = 0;
  let right = window.innerWidth;
  let bottom = window.innerHeight;

  // Intersect with each clipping ancestor
  for (const ancestor of clippingAncestors) {
    const ar = ancestor.getBoundingClientRect();
    const style = getComputedStyle(ancestor);
    if (CLIPPING_OVERFLOW.has(style.overflowX)) {
      left = Math.max(left, ar.left);
      right = Math.min(right, ar.right);
    }
    if (CLIPPING_OVERFLOW.has(style.overflowY)) {
      top = Math.max(top, ar.top);
      bottom = Math.min(bottom, ar.bottom);
    }
  }

  // Intersect with the element itself
  const r = el.getBoundingClientRect();
  top = Math.max(top, r.top);
  left = Math.max(left, r.left);
  right = Math.min(right, r.right);
  bottom = Math.min(bottom, r.bottom);

  return {
    top,
    left,
    width: Math.max(right - left, 0),
    height: Math.max(bottom - top, 0),
  };
}

let geometryTarget = null;
let clippingAncestors = [];
let rafId = 0;
let resizeObserver = null;

function updateHostRect() {
  if (!geometryTarget) return;
  const { top, left, width, height } = computeVisibleRect(geometryTarget, clippingAncestors);
  hostStyle.value = {
    position: 'fixed',
    top: `${top}px`,
    left: `${left}px`,
    width: `${width}px`,
    height: `${height}px`,
  };
}

function scheduleUpdate() {
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    updateHostRect();
  });
}

function setupGeometry() {
  geometryTarget = props.geometryTarget ?? null;
  if (!geometryTarget) return;

  clippingAncestors = collectClippingAncestors(geometryTarget);

  updateHostRect();
  window.addEventListener('scroll', scheduleUpdate, true);
  window.addEventListener('resize', scheduleUpdate);

  // Observe the target and every clipping ancestor for resize changes.
  // A split-pane drag or layout shift on any clipping ancestor changes
  // the visible rect without triggering scroll or window resize.
  resizeObserver = new ResizeObserver(scheduleUpdate);
  resizeObserver.observe(geometryTarget);
  for (const ancestor of clippingAncestors) {
    resizeObserver.observe(ancestor);
  }
}

function teardownGeometry() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  window.removeEventListener('scroll', scheduleUpdate, true);
  window.removeEventListener('resize', scheduleUpdate);
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  geometryTarget = null;
  clippingAncestors = [];
}

// Set up geometry when surfaces become active or the geometry target arrives.
// The hasAnySurface watcher handles open/close transitions.
// The geometryTarget watcher handles the case where openSurface() is called
// before the Vue runtime mounts — layers ref starts null and populates later.
watch(hasAnySurface, (active) => {
  if (active) {
    setupGeometry();
  } else {
    teardownGeometry();
  }
});

watch(
  () => props.geometryTarget,
  (target) => {
    if (target && hasAnySurface.value && !geometryTarget) {
      setupGeometry();
    }
  },
);

onMounted(() => {
  if (hasAnySurface.value) setupGeometry();
});

// ---------------------------------------------------------------------------
// Floating Escape — document-level listener active while a floating is open
// ---------------------------------------------------------------------------

function handleFloatingEscape(event) {
  const f = floating.value;
  if (!f || f.settled) return;

  // If a dialog is also open, its own keydown handler owns Escape
  if (dialog.value) return;

  if (event.key === 'Escape' && f.request.closeOnEscape !== false) {
    event.stopPropagation();
    surfaceManager.close(f.id);
  }
}

let escapeListenerAttached = false;

function attachEscapeListener() {
  if (escapeListenerAttached) return;
  document.addEventListener('keydown', handleFloatingEscape, true);
  escapeListenerAttached = true;
}

function detachEscapeListener() {
  if (!escapeListenerAttached) return;
  document.removeEventListener('keydown', handleFloatingEscape, true);
  escapeListenerAttached = false;
}

// ---------------------------------------------------------------------------
// Floating outside-pointer-down — closes floating on pointer outside shell
// ---------------------------------------------------------------------------

function handleOutsidePointerDown(event) {
  const f = floating.value;
  if (!f || f.settled) return;
  if (dialog.value) return;

  const rootEl = floatingRef.value?.rootEl;
  if (rootEl && !rootEl.contains(event.target)) {
    surfaceManager.close(f.id);
  }
}

let pointerListenerAttached = false;

function attachPointerListener() {
  if (pointerListenerAttached) return;
  document.addEventListener('pointerdown', handleOutsidePointerDown, true);
  pointerListenerAttached = true;
}

function detachPointerListener() {
  if (!pointerListenerAttached) return;
  document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
  pointerListenerAttached = false;
}

// ---------------------------------------------------------------------------
// Watchers — attach/detach listeners based on floating state
// ---------------------------------------------------------------------------

watch(
  floating,
  (f) => {
    if (f && !f.settled) {
      attachEscapeListener();
      if (f.request.floating?.closeOnOutsidePointerDown) {
        attachPointerListener();
      } else {
        detachPointerListener();
      }
    } else {
      detachEscapeListener();
      detachPointerListener();
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  teardownGeometry();
  detachEscapeListener();
  detachPointerListener();
});

// ---------------------------------------------------------------------------
// Close handler for dialog shell
// ---------------------------------------------------------------------------

function handleDialogClose() {
  const d = dialog.value;
  if (d && !d.settled) {
    surfaceManager.close(d.id);
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="hasAnySurface" ref="hostRef" class="sd-surface-host" :style="hostStyle">
      <!-- Floating renders below dialog in DOM order and z-index -->
      <SurfaceFloating v-if="floating" :key="floating.id" :surface="floating" ref="floatingRef" />
    </div>

    <SurfaceDialog
      v-if="dialog"
      :key="dialog.id"
      :surface="dialog"
      :scroll-lock-target="geometryTarget"
      @close="handleDialogClose"
    />
  </Teleport>
</template>

<style scoped>
.sd-surface-host {
  /* position/top/left/width/height set dynamically via :style binding */
  pointer-events: none;
  z-index: var(--sd-ui-surface-z-index, 100);
  overflow: hidden;
}

/* Re-enable pointer events on actual surface children */
.sd-surface-host > :deep(*) {
  pointer-events: auto;
}
</style>
