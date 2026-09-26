<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import SurfaceExternalMount from './SurfaceExternalMount.vue';
import { FOCUSABLE_SELECTOR } from './focusable-selector.js';

const props = defineProps({
  surface: { type: Object, required: true },
  scrollLockTarget: { type: Object, default: null },
});

const emit = defineEmits(['close']);

const dialogRef = ref(null);
const titleId = computed(() => (props.surface.request.title ? `sd-surface-title-${props.surface.id}` : undefined));
// Precedence: title (via aria-labelledby to shell title) → ariaLabelledBy → ariaLabel
const labelledBy = computed(() => titleId.value ?? props.surface.request.ariaLabelledBy ?? undefined);
const ariaLabel = computed(() => (labelledBy.value ? undefined : props.surface.request.ariaLabel));

// ---------------------------------------------------------------------------
// Focus management
// ---------------------------------------------------------------------------

let previouslyFocusedElement = null;

function trapFocus(event) {
  if (!dialogRef.value) return;
  const focusable = dialogRef.value.querySelectorAll(FOCUSABLE_SELECTOR);
  if (focusable.length === 0) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function setInitialFocus() {
  if (!dialogRef.value) return;
  const firstFocusable = dialogRef.value.querySelector(FOCUSABLE_SELECTOR);
  if (firstFocusable) {
    firstFocusable.focus();
  } else {
    dialogRef.value.focus();
  }
}

// ---------------------------------------------------------------------------
// Scroll lock
// ---------------------------------------------------------------------------

let scrollLockTarget = null;
let originalOverflow = '';

function lockScroll() {
  // Best-effort scroll lock on the actual scroll container (.superdoc__layers),
  // not the flex root (.superdoc). The viewport-aware fixed host is the primary
  // correctness mechanism — this just prevents distracting scroll behind the backdrop.
  if (props.scrollLockTarget) {
    scrollLockTarget = props.scrollLockTarget;
  } else {
    const superdocRoot = dialogRef.value?.closest('.superdoc');
    scrollLockTarget = superdocRoot?.querySelector('.superdoc__layers') ?? superdocRoot;
  }
  if (!scrollLockTarget) return;
  originalOverflow = scrollLockTarget.style.overflow;
  scrollLockTarget.style.overflow = 'hidden';
}

function unlockScroll() {
  if (!scrollLockTarget) return;
  scrollLockTarget.style.overflow = originalOverflow;
  scrollLockTarget = null;
  originalOverflow = '';
}

// ---------------------------------------------------------------------------
// Keyboard & backdrop
// ---------------------------------------------------------------------------

function handleKeydown(event) {
  if (event.key === 'Tab') {
    trapFocus(event);
    return;
  }
  if (event.key === 'Escape' && props.surface.request.closeOnEscape !== false) {
    event.stopPropagation();
    emit('close');
  }
}

function handleBackdropClick(event) {
  if (event.target !== event.currentTarget) return;
  // Mousedown must not steal focus from the dialog or its restored opener.
  event.preventDefault();
  if (props.surface.request.closeOnBackdrop !== false) emit('close');
}

// ---------------------------------------------------------------------------
// Component props assembly
// ---------------------------------------------------------------------------

const shellProps = computed(() => ({
  surfaceId: props.surface.id,
  mode: 'dialog',
  request: props.surface.request,
  resolve: props.surface.resolve,
  close: props.surface.close,
}));

const mergedComponentProps = computed(() => {
  const extra = props.surface.props ?? {};
  // Reserved shell props always win
  return { ...extra, ...shellProps.value };
});

// ---------------------------------------------------------------------------
// Styling
// ---------------------------------------------------------------------------

const maxWidth = computed(() => {
  const reqMax = props.surface.request.dialog?.maxWidth;
  if (reqMax != null) return typeof reqMax === 'number' ? `${reqMax}px` : reqMax;
  return undefined; // falls back to CSS variable default
});

const cardStyle = computed(() => {
  const style = {};
  if (maxWidth.value) style['max-width'] = maxWidth.value;
  return style;
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

onMounted(async () => {
  previouslyFocusedElement = document.activeElement;
  lockScroll();
  await nextTick();
  setInitialFocus();
});

watch(
  () => props.scrollLockTarget,
  (target, previousTarget) => {
    if (target === previousTarget) return;
    unlockScroll();
    lockScroll();
  },
);

onBeforeUnmount(() => {
  unlockScroll();
  if (previouslyFocusedElement && typeof previouslyFocusedElement.focus === 'function') {
    previouslyFocusedElement.focus();
  }
  previouslyFocusedElement = null;
});
</script>

<template>
  <div class="sd-surface-dialog-backdrop" @mousedown.self="handleBackdropClick" @keydown="handleKeydown">
    <div
      ref="dialogRef"
      class="sd-surface-dialog"
      :style="cardStyle"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="labelledBy"
      :aria-label="ariaLabel"
      tabindex="-1"
    >
      <div v-if="surface.request.title" :id="titleId" class="sd-surface-dialog__title">
        {{ surface.request.title }}
      </div>

      <div class="sd-surface-dialog__content">
        <!-- External renderer -->
        <SurfaceExternalMount
          v-if="surface.render"
          :surface-id="surface.id"
          mode="dialog"
          :request="surface.request"
          :render="surface.render"
          :resolve="surface.resolve"
          :close="surface.close"
        />

        <!-- Vue component -->
        <component v-else-if="surface.component" :is="surface.component" v-bind="mergedComponentProps" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.sd-surface-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--sd-ui-dialog-z-index, 2147483001);
  box-sizing: border-box;
  padding: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--sd-ui-dialog-backdrop, rgba(18, 24, 38, 0.32));
}

.sd-surface-dialog {
  box-sizing: border-box;
  min-width: 0;
  background: var(--sd-ui-surface-bg);
  border: 1px solid var(--sd-ui-surface-border);
  border-radius: var(--sd-ui-surface-radius);
  box-shadow: var(--sd-ui-surface-shadow);
  max-width: var(--sd-ui-dialog-max-width, 480px);
  width: 100%;
  max-height: 100%;
  overflow-y: auto;
  outline: none;
  font-family: var(--sd-ui-font-family);
  color: var(--sd-ui-text);
}

.sd-surface-dialog__title {
  padding: var(--sd-ui-surface-title-padding);
  font-size: var(--sd-ui-font-size-500, 15px);
  font-weight: 600;
  line-height: 1.4;
}

.sd-surface-dialog__content {
  padding: var(--sd-ui-surface-content-padding);
}

/* Built-in dialogs share chrome while their components own fields and actions. */
.sd-surface-dialog:has(.sd-dialog-content) {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.sd-surface-dialog__content:has(> .sd-dialog-content) {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0;
}
.sd-surface-dialog :deep(.sd-dialog-content) {
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: calc(100dvh - 34px);
}
.sd-surface-dialog :deep(.sd-dialog-header) {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--sd-ui-surface-border, #e4e7ec);
}
.sd-surface-dialog :deep(.sd-dialog-header h2) {
  margin: 0;
  font-size: 18px;
  font-weight: 650;
  letter-spacing: -0.01em;
}
.sd-surface-dialog :deep(.sd-dialog-close) {
  display: grid;
  flex: none;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--sd-ui-text-muted, #525866);
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
}
.sd-surface-dialog :deep(.sd-dialog-close:hover) {
  background: var(--sd-ui-hover-bg, #f2f4f7);
}
.sd-surface-dialog :deep(.sd-dialog-footer) {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 16px;
  border-top: 1px solid var(--sd-ui-surface-border, #eaecf0);
  background: var(--sd-ui-surface-bg, #fff);
}
.sd-surface-dialog :deep(.sd-dialog-footer button) {
  min-width: 72px;
  min-height: 32px;
  padding: 7px 12px;
  border-radius: 6px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.sd-surface-dialog :deep(.sd-dialog-secondary) {
  border: 1px solid var(--sd-ui-surface-border, #cfd4dc);
  background: var(--sd-ui-surface-bg, #fff);
  color: var(--sd-ui-text, #344054);
}
.sd-surface-dialog :deep(.sd-dialog-primary) {
  border: 1px solid var(--sd-ui-action, #3367d6);
  background: var(--sd-ui-action, #3367d6);
  color: var(--sd-ui-action-text, #fff);
}
.sd-surface-dialog :deep(.sd-dialog-footer button:disabled) {
  cursor: not-allowed;
  opacity: 0.55;
}
</style>
