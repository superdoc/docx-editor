<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useAttrs, watch } from 'vue';
import type { CSSProperties, PropType } from 'vue';

defineOptions({
  inheritAttrs: false,
});

const props = defineProps({
  trigger: {
    type: String,
    default: 'hover',
  },
  delay: {
    type: Number,
    default: 100,
  },
  duration: {
    type: Number,
    default: 100,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  contentStyle: {
    type: Object as PropType<CSSProperties>,
    default: () => ({}),
  },
});

const attrs = useAttrs();

// Word-style auto-dismiss: a shown tooltip hides itself after this delay even
// while the pointer stays over the trigger or content.
const AUTO_HIDE_DELAY = 2500;

const isOpen = ref(false);
const triggerRef = ref<HTMLSpanElement | null>(null);
const contentRef = ref<HTMLDivElement | null>(null);
const position = ref({ top: '0px', left: '0px', below: false });

let closeTimeout: number | null = null;
let openTimeout: number | null = null;
let autoHideTimeout: number | null = null;

const mergedContentClass = computed(() => [
  'sd-tooltip-content',
  position.value.below && 'sd-tooltip-below',
  attrs.class,
]);
const contentStyle = computed(() => ({
  ...props.contentStyle,
  ...((attrs.style as CSSProperties | undefined) || {}),
  position: 'fixed',
  top: position.value.top,
  left: position.value.left,
  zIndex: 2100,
  transformOrigin: position.value.below ? 'top center' : 'bottom center',
}));

const clearCloseTimeout = () => {
  if (closeTimeout) {
    window.clearTimeout(closeTimeout);
    closeTimeout = null;
  }
};

const clearOpenTimeout = () => {
  if (openTimeout) {
    window.clearTimeout(openTimeout);
    openTimeout = null;
  }
};

const clearAutoHideTimeout = () => {
  if (autoHideTimeout) {
    window.clearTimeout(autoHideTimeout);
    autoHideTimeout = null;
  }
};

const startAutoHide = () => {
  clearAutoHideTimeout();
  autoHideTimeout = window.setTimeout(() => {
    autoHideTimeout = null;
    close();
  }, AUTO_HIDE_DELAY);
};

const updatePosition = () => {
  if (!triggerRef.value || !contentRef.value) return;

  const triggerRect = triggerRef.value.getBoundingClientRect();
  const contentWidth = contentRef.value.offsetWidth;
  const contentHeight = contentRef.value.offsetHeight;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const gutter = 8;

  let left = triggerRect.left + triggerRect.width / 2 - contentWidth / 2;
  left = Math.max(gutter, Math.min(left, viewportWidth - contentWidth - gutter));

  const aboveTop = triggerRect.top - contentHeight - 10;
  const below = aboveTop < gutter;
  const preferredTop = below ? triggerRect.bottom + 10 : aboveTop;
  const top = Math.max(gutter, Math.min(preferredTop, viewportHeight - contentHeight - gutter));

  position.value = {
    top: `${top}px`,
    left: `${left}px`,
    below,
  };
};

const open = async () => {
  if (props.disabled) return;
  clearCloseTimeout();
  clearOpenTimeout();
  if (isOpen.value) return;
  isOpen.value = true;
  startAutoHide();
  await nextTick();
  updatePosition();
};

const close = () => {
  clearOpenTimeout();
  clearCloseTimeout();
  clearAutoHideTimeout();
  if (!isOpen.value) return;
  isOpen.value = false;
};

const openWithDelay = () => {
  clearCloseTimeout();
  clearOpenTimeout();
  if (isOpen.value) return;
  if (props.delay === 0) {
    void open();
    return;
  }
  openTimeout = window.setTimeout(() => {
    openTimeout = null;
    void open();
  }, props.delay);
};

const closeWithDelay = () => {
  clearOpenTimeout();
  clearCloseTimeout();
  if (!isOpen.value) return;
  if (props.duration === 0) {
    close();
    return;
  }
  closeTimeout = window.setTimeout(() => {
    closeTimeout = null;
    close();
  }, props.duration);
};

const handleTriggerMouseEnter = () => {
  if (props.trigger !== 'hover') return;
  openWithDelay();
};

const handleTriggerMouseLeave = () => {
  if (props.trigger !== 'hover') return;
  closeWithDelay();
};

const handleContentMouseEnter = () => {
  clearOpenTimeout();
  clearCloseTimeout();
};
const handleContentMouseLeave = () => {
  closeWithDelay();
};

const handleEscape = (event: KeyboardEvent) => {
  if (event.key === 'Escape') close();
};

const handleTriggerKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter' || event.key === ' ') close();
};

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) close();
  },
);

watch(isOpen, (openState) => {
  if (openState) {
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    document.addEventListener('keydown', handleEscape, true);
  } else {
    window.removeEventListener('resize', updatePosition);
    window.removeEventListener('scroll', updatePosition, true);
    document.removeEventListener('keydown', handleEscape, true);
  }
});

onBeforeUnmount(() => {
  clearOpenTimeout();
  clearCloseTimeout();
  clearAutoHideTimeout();
  window.removeEventListener('resize', updatePosition);
  window.removeEventListener('scroll', updatePosition, true);
  document.removeEventListener('keydown', handleEscape, true);
});
</script>

<template>
  <span
    ref="triggerRef"
    class="sd-tooltip-trigger"
    @mouseenter="handleTriggerMouseEnter"
    @mouseleave="handleTriggerMouseLeave"
    @focusin="handleTriggerMouseEnter"
    @focusout="handleTriggerMouseLeave"
    @click.capture="close"
    @keydown.capture="handleTriggerKeydown"
  >
    <slot name="trigger" />
  </span>

  <Teleport to="body">
    <!-- Remove closed tooltips immediately so they cannot cover or intercept dropdown options. -->
    <Transition name="fade-in-scale-up-transition" :css="isOpen">
      <div
        v-if="isOpen && !disabled"
        ref="contentRef"
        :class="mergedContentClass"
        :style="contentStyle"
        @mouseenter="handleContentMouseEnter"
        @mouseleave="handleContentMouseLeave"
      >
        <span class="sd-tooltip-arrow" aria-hidden="true" />
        <slot />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.sd-tooltip-trigger {
  display: inline-flex;
}

.sd-tooltip-content {
  background-color: var(--sd-ui-tooltip-bg, #262626);
  color: var(--sd-ui-tooltip-text, #fff);
  font-size: var(--sd-ui-font-size-400, 14px);
  line-height: 1.3;
  border-radius: var(--sd-ui-tooltip-radius, 6px);
  padding: 8px 14px;
  box-shadow: var(--sd-ui-tooltip-shadow, 0 3px 12px rgba(0, 0, 0, 0.28));
  pointer-events: auto;
  white-space: nowrap;
}

.sd-tooltip-arrow {
  position: absolute;
  left: 50%;
  bottom: -5px;
  width: 10px;
  height: 10px;
  background-color: var(--sd-ui-tooltip-bg, #262626);
  transform: translateX(-50%) rotate(45deg);
}

.sd-tooltip-below .sd-tooltip-arrow {
  top: -5px;
  bottom: auto;
}

.fade-in-scale-up-transition-enter-active {
  transition:
    opacity 0.2s cubic-bezier(0, 0, 0.2, 1),
    transform 0.2s cubic-bezier(0, 0, 0.2, 1);
}

.fade-in-scale-up-transition-enter-from {
  opacity: 0;
  transform: scale(0.9);
}

.fade-in-scale-up-transition-enter-to {
  opacity: 1;
  transform: scale(1);
}
</style>
