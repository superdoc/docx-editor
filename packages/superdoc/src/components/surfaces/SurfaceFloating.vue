<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import SurfaceExternalMount from './SurfaceExternalMount.vue';
import { FOCUSABLE_SELECTOR } from './focusable-selector.js';
import type { PropType } from 'vue';
import type { ActiveSurface } from '../../core/surface-manager.js';

const props = defineProps({
  surface: { type: Object as PropType<ActiveSurface>, required: true },
});

const floatingRef = ref<HTMLElement | null>(null);
defineExpose({ rootEl: floatingRef });
const clampedInsets = ref<Record<string, string>>({});

const titleId = computed(() => (props.surface.request.title ? `sd-surface-title-${props.surface.id}` : undefined));
const labelledBy = computed(() => titleId.value ?? props.surface.request.ariaLabelledBy ?? undefined);
const ariaLabel = computed(() => (labelledBy.value ? undefined : props.surface.request.ariaLabel));

// ---------------------------------------------------------------------------
// Positioning — explicit insets beat placement presets
// ---------------------------------------------------------------------------

const floatingOpts = computed(() => props.surface.request.floating ?? {});

const hasExplicitInsets = computed(() => {
  const o = floatingOpts.value;
  return o.top != null || o.right != null || o.bottom != null || o.left != null;
});

const floatingClasses = computed(() => {
  const classes = ['sd-surface-floating'];
  if (!hasExplicitInsets.value) {
    const placement = floatingOpts.value.placement ?? 'top-right';
    classes.push(`sd-surface-floating--${placement}`);
  }
  return classes;
});

/** Normalize a dimension value: numbers become pixel strings. */
function toPx(value: string | number | undefined) {
  if (value == null) return undefined;
  return typeof value === 'number' ? `${value}px` : value;
}

const floatingStyle = computed(() => {
  const o = floatingOpts.value;
  const style: Record<string, string | undefined> = {};

  // Explicit insets override placement classes
  if (o.top != null) style.top = toPx(o.top);
  if (o.right != null) style.right = toPx(o.right);
  if (o.bottom != null) style.bottom = toPx(o.bottom);
  if (o.left != null) style.left = toPx(o.left);

  // Dimensions
  if (o.width != null) style.width = toPx(o.width);
  if (o.maxWidth != null) style['max-width'] = toPx(o.maxWidth);
  if (o.maxHeight != null) style['max-height'] = toPx(o.maxHeight);

  return { ...style, ...clampedInsets.value };
});

async function clampToHostBounds() {
  clampedInsets.value = {};
  if (!hasExplicitInsets.value) return;

  await nextTick();
  await new Promise((resolve) => requestAnimationFrame(resolve));

  const rootEl = floatingRef.value;
  const hostEl = rootEl?.parentElement;
  if (!rootEl || !hostEl) return;

  const edgePadding = 8;
  const rootRect = rootEl.getBoundingClientRect();
  const hostRect = hostEl.getBoundingClientRect();
  const nextInsets: Record<string, string> = {};
  const o = floatingOpts.value;

  if (o.left != null && o.right == null) {
    const currentLeft = rootRect.left - hostRect.left;
    const maxLeft = Math.max(edgePadding, hostRect.width - rootRect.width - edgePadding);
    const nextLeft = Math.min(Math.max(currentLeft, edgePadding), maxLeft);
    if (nextLeft !== currentLeft) nextInsets.left = `${nextLeft}px`;
  }

  if (o.top != null && o.bottom == null) {
    const currentTop = rootRect.top - hostRect.top;
    const maxTop = Math.max(edgePadding, hostRect.height - rootRect.height - edgePadding);
    const nextTop = Math.min(Math.max(currentTop, edgePadding), maxTop);
    if (nextTop !== currentTop) nextInsets.top = `${nextTop}px`;
  }

  clampedInsets.value = nextInsets;
}

watch(floatingOpts, clampToHostBounds, { deep: true });

// ---------------------------------------------------------------------------
// Component props assembly
// ---------------------------------------------------------------------------

const shellProps = computed(() => ({
  surfaceId: props.surface.id,
  mode: 'floating',
  request: props.surface.request,
  resolve: props.surface.resolve,
  close: props.surface.close,
}));

const mergedComponentProps = computed(() => {
  const extra = props.surface.props ?? {};
  return { ...extra, ...shellProps.value };
});

// ---------------------------------------------------------------------------
// Focus management — capture, move, and restore
// ---------------------------------------------------------------------------

let previouslyFocusedElement: (Element & Partial<Pick<HTMLElement, 'focus'>>) | null = null;
let didTakeFocus = false;
let boundsResizeObserver: ResizeObserver | null = null;

onMounted(async () => {
  clampToHostBounds();
  window.addEventListener('resize', clampToHostBounds);
  if (typeof ResizeObserver !== 'undefined' && floatingRef.value?.parentElement) {
    boundsResizeObserver = new ResizeObserver(clampToHostBounds);
    boundsResizeObserver.observe(floatingRef.value.parentElement);
    boundsResizeObserver.observe(floatingRef.value);
  }
  if (floatingOpts.value.autoFocus === false) return;
  await nextTick();
  if (!floatingRef.value) return;
  // A surface can mark its preferred initial-focus element (e.g. the find
  // input) with `data-sd-autofocus`; otherwise the first focusable wins.
  const firstFocusable =
    floatingRef.value.querySelector<HTMLElement>('[data-sd-autofocus]') ??
    floatingRef.value.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
  if (firstFocusable) {
    previouslyFocusedElement = document.activeElement;
    firstFocusable.focus();
    didTakeFocus = true;
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', clampToHostBounds);
  boundsResizeObserver?.disconnect();
  boundsResizeObserver = null;
  if (didTakeFocus && previouslyFocusedElement && typeof previouslyFocusedElement.focus === 'function') {
    previouslyFocusedElement.focus();
  }
  previouslyFocusedElement = null;
  didTakeFocus = false;
});
</script>

<template>
  <div
    ref="floatingRef"
    :class="floatingClasses"
    :style="floatingStyle"
    role="dialog"
    :aria-labelledby="labelledBy"
    :aria-label="ariaLabel"
    data-editor-ui-surface
  >
    <div v-if="surface.request.title" :id="titleId" class="sd-surface-floating__title">
      {{ surface.request.title }}
    </div>

    <div class="sd-surface-floating__content">
      <!-- External renderer -->
      <SurfaceExternalMount
        v-if="surface.render"
        :surface-id="surface.id"
        mode="floating"
        :request="surface.request"
        :render="surface.render"
        :resolve="surface.resolve"
        :close="surface.close"
      />

      <!-- Vue component -->
      <component v-else-if="surface.component" :is="surface.component" v-bind="mergedComponentProps" />
    </div>
  </div>
</template>

<style scoped>
.sd-surface-floating {
  position: absolute;
  z-index: var(--sd-ui-surface-z-index, 100);
  width: var(--sd-ui-floating-width, 360px);
  max-width: var(--sd-ui-floating-max-width, 480px);
  max-height: var(--sd-ui-floating-max-height, min(60vh, calc(100% - 32px)));
  background: var(--sd-ui-surface-bg);
  border: 1px solid var(--sd-ui-surface-border);
  border-radius: var(--sd-ui-surface-radius);
  box-shadow: var(--sd-ui-surface-shadow);
  font-family: var(--sd-ui-font-family);
  color: var(--sd-ui-text);
  overflow-y: auto;
}

/* Placement presets — all use --sd-ui-floating-edge-offset */
.sd-surface-floating--top-right {
  top: var(--sd-ui-floating-edge-offset, 16px);
  right: var(--sd-ui-floating-edge-offset, 16px);
}

.sd-surface-floating--top-left {
  top: var(--sd-ui-floating-edge-offset, 16px);
  left: var(--sd-ui-floating-edge-offset, 16px);
}

.sd-surface-floating--bottom-right {
  bottom: var(--sd-ui-floating-edge-offset, 16px);
  right: var(--sd-ui-floating-edge-offset, 16px);
}

.sd-surface-floating--bottom-left {
  bottom: var(--sd-ui-floating-edge-offset, 16px);
  left: var(--sd-ui-floating-edge-offset, 16px);
}

.sd-surface-floating--top-center {
  top: var(--sd-ui-floating-edge-offset, 16px);
  left: 50%;
  transform: translateX(-50%);
}

.sd-surface-floating--bottom-center {
  bottom: var(--sd-ui-floating-edge-offset, 16px);
  left: 50%;
  transform: translateX(-50%);
}

.sd-surface-floating__title {
  padding: var(--sd-ui-surface-title-padding);
  font-size: var(--sd-ui-font-size-500, 15px);
  font-weight: 600;
  line-height: 1.4;
}

.sd-surface-floating__content {
  padding: var(--sd-ui-surface-content-padding);
}
</style>
