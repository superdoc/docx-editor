<script setup>
import { computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, useSlots, watch } from 'vue';

const props = defineProps({
  options: {
    type: Array,
    default: () => [],
  },
  show: {
    type: Boolean,
    required: true,
  },
  placement: {
    type: String,
    default: 'bottom-start',
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  contentStyle: {
    type: Object,
    default: () => ({}),
  },
  menuProps: {
    type: Function,
    default: null,
  },
  nodeProps: {
    type: Function,
    default: null,
  },
  closeOnEscape: {
    type: Boolean,
    default: true,
  },
  hasOpenChild: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['update:show', 'select']);
const slots = useSlots();

const triggerRef = ref(null);
const menuRef = ref(null);
const menuPosition = ref({ top: '0px', left: '0px', maxHeight: 'none' });
const optionRefs = ref([]);
const keyboardIndex = ref(-1);

const isOpen = computed(() => Boolean(props.show));
const fullscreenRoot = ref(document.fullscreenElement);
const teleportTarget = computed(() => (isOpen.value && fullscreenRoot.value ? fullscreenRoot.value : document.body));
const hasRenderOptions = computed(() => props.options.some((option) => option?.type === 'render'));
const hasCustomMenu = computed(() => Boolean(slots.menu));

const computedMenuProps = computed(() => {
  if (typeof props.menuProps !== 'function') return {};
  return props.menuProps() || {};
});

const computedMenuAttrs = computed(() => {
  const { class: _class, style: _style, ...rest } = computedMenuProps.value;
  return rest;
});

const mergedMenuClass = computed(() => {
  const fromProps = computedMenuProps.value.class;
  const onlyRenderOptions =
    hasCustomMenu.value ||
    (props.options.length > 0 && props.options.every((option) => option && option.type === 'render'));
  return ['toolbar-dropdown-menu', fromProps, { 'toolbar-dropdown-menu--render-only': onlyRenderOptions }];
});

const mergedMenuStyle = computed(() => {
  const fromProps = computedMenuProps.value.style || {};
  return { ...props.contentStyle, ...fromProps };
});

const menuStyle = computed(() => {
  return {
    ...mergedMenuStyle.value,
    position: 'fixed',
    top: menuPosition.value.top,
    left: menuPosition.value.left,
    maxHeight: menuPosition.value.maxHeight,
    zIndex: 2000,
  };
});

const setOpen = (value) => {
  emit('update:show', value);
};

const close = () => {
  if (!isOpen.value) return;
  setOpen(false);
};

const updateMenuPosition = () => {
  if (!triggerRef.value) return;
  const rect = triggerRef.value.getBoundingClientRect();
  const menuEl = menuRef.value;
  const menuWidth = menuEl?.offsetWidth ?? 0;
  const menuHeight = menuEl?.scrollHeight ?? menuEl?.offsetHeight ?? 0;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const gutter = 8;
  const gap = 4;
  const belowTop = rect.bottom + gap;
  const aboveBottom = rect.top - gap;
  const availableBelow = Math.max(0, viewportHeight - belowTop - gutter);
  const availableAbove = Math.max(0, aboveBottom - gutter);
  const openAbove = availableBelow < menuHeight && availableAbove > availableBelow;
  const maxHeight = openAbove ? availableAbove : availableBelow;
  const menuRenderHeight = menuHeight ? Math.min(menuHeight, maxHeight) : maxHeight;
  const top = openAbove ? Math.max(gutter, aboveBottom - menuRenderHeight) : belowTop;
  let left = rect.left;

  if (props.placement === 'bottom-end') {
    left = rect.right - menuWidth;
  }

  // Prevent horizontal overflow outside viewport.
  const maxLeft = Math.max(gutter, viewportWidth - menuWidth - gutter);
  left = Math.min(Math.max(gutter, left), maxLeft);

  menuPosition.value = {
    top: `${top}px`,
    left: `${left}px`,
    maxHeight: `${maxHeight}px`,
  };
};

const handleFullscreenChange = async () => {
  fullscreenRoot.value = document.fullscreenElement;
  if (!isOpen.value) return;
  await nextTick();
  updateMenuPosition();
};

const onTriggerClick = () => {
  if (props.disabled) return;
  setOpen(!isOpen.value);
};

const getNodeProps = (option) => {
  if (typeof props.nodeProps !== 'function') return {};
  return props.nodeProps(option) || {};
};

const onOptionClick = (option) => {
  if (option?.disabled) return;
  if (option?.type === 'render') return;
  emit('select', option?.key, option);
  close();
};

const isRenderOption = (option) => option?.type === 'render';
const isOptionNavigable = (option) => !option?.disabled && option?.type !== 'render';
const hasIcon = (option) => typeof option?.icon === 'function' || Boolean(option?.icon);
const renderIcon = (option) => {
  if (typeof option?.icon === 'function') return option.icon(option);
  return option?.icon || null;
};

const classHasSelected = (value) => {
  if (!value) return false;
  if (typeof value === 'string') {
    return value.split(/\s+/).includes('sd-selected');
  }
  if (Array.isArray(value)) {
    return value.some(classHasSelected);
  }
  if (typeof value === 'object') {
    return Boolean(value['sd-selected']);
  }
  return false;
};

const isOptionSelected = (option) => {
  return classHasSelected(option?.props?.class) || classHasSelected(option?.class);
};

const getNavigableIndexes = () => {
  return props.options.map((option, index) => (isOptionNavigable(option) ? index : -1)).filter((index) => index >= 0);
};

const getInitialKeyboardIndex = () => {
  const selectedIndex = props.options.findIndex((option) => isOptionNavigable(option) && isOptionSelected(option));
  if (selectedIndex >= 0) return selectedIndex;
  return getNavigableIndexes()[0] ?? -1;
};

const setOptionRef = (el, index) => {
  if (!el) {
    delete optionRefs.value[index];
    return;
  }
  optionRefs.value[index] = el;
};

const focusKeyboardIndex = () => {
  optionRefs.value.forEach((el, index) => {
    if (!el) return;
    el.setAttribute('tabindex', index === keyboardIndex.value ? '0' : '-1');
  });

  const target = optionRefs.value[keyboardIndex.value];
  if (target && typeof target.focus === 'function') {
    target.focus();
    target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }
};

const moveKeyboardIndex = (direction) => {
  const navigableIndexes = getNavigableIndexes();
  if (!navigableIndexes.length) {
    keyboardIndex.value = -1;
    return;
  }

  const currentPosition = navigableIndexes.indexOf(keyboardIndex.value);
  if (currentPosition < 0) {
    keyboardIndex.value = direction > 0 ? navigableIndexes[0] : navigableIndexes[navigableIndexes.length - 1];
    return;
  }

  const nextPosition = (currentPosition + direction + navigableIndexes.length) % navigableIndexes.length;
  keyboardIndex.value = navigableIndexes[nextPosition];
};

const selectKeyboardOption = () => {
  let option = props.options[keyboardIndex.value];
  if (!isOptionNavigable(option)) {
    const firstIndex = getNavigableIndexes()[0];
    option = firstIndex === undefined ? null : props.options[firstIndex];
  }
  if (!option) return;
  onOptionClick(option);
};

const RenderOption = defineComponent({
  name: 'ToolbarDropdownRenderOption',
  props: {
    option: {
      type: Object,
      required: true,
    },
  },
  setup(componentProps) {
    return () => {
      if (typeof componentProps.option.render !== 'function') return null;
      return componentProps.option.render();
    };
  },
});

const OptionIcon = defineComponent({
  name: 'ToolbarDropdownOptionIcon',
  props: {
    option: {
      type: Object,
      required: true,
    },
  },
  setup(componentProps) {
    return () => {
      const icon = renderIcon(componentProps.option);
      return typeof icon === 'string' ? h('span', { innerHTML: icon }) : icon;
    };
  },
});

const handlePointerDown = (event) => {
  if (!isOpen.value) return;

  const target = event.target;
  if (!(target instanceof Element)) return;

  const insideTrigger = triggerRef.value?.contains(target);
  const insideMenu = menuRef.value?.contains(target);
  if (insideTrigger || insideMenu) return;

  // A nested dropdown is teleported beside its parent menu rather than inside
  // it. While a child is open, treat toolbar dropdown menus as one overlay tree
  // so selecting a nested option does not close its parent first.
  if (props.hasOpenChild && target.closest('[data-sd-part="dropdown-menu"]')) return;

  close();
};

const TRIGGER_FOCUS_SELECTOR =
  'button, [href], input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';
const triggerFocusTargetRef = ref(null);
const rememberTriggerFocusTarget = () => {
  const trigger = triggerRef.value;
  const active = document.activeElement;

  // Dropdown options are teleported to <body> and receive focus while open.
  // Remember the opener before focus moves so Escape can restore it later.
  if (trigger && active instanceof HTMLElement && trigger.contains(active)) {
    triggerFocusTargetRef.value = active;
    return;
  }

  triggerFocusTargetRef.value = trigger?.matches?.(TRIGGER_FOCUS_SELECTOR)
    ? trigger
    : trigger?.querySelector(TRIGGER_FOCUS_SELECTOR);
};

const focusTrigger = () => {
  const remembered = triggerFocusTargetRef.value;
  if (remembered instanceof HTMLElement && document.contains(remembered)) {
    remembered.focus();
    return;
  }

  const trigger = triggerRef.value;
  if (!trigger) return;

  const fallback = trigger.matches?.(TRIGGER_FOCUS_SELECTOR) ? trigger : trigger.querySelector(TRIGGER_FOCUS_SELECTOR);

  if (fallback instanceof HTMLElement) {
    fallback.focus();
    return;
  }

  trigger.setAttribute('tabindex', '-1');
  trigger.focus();
};

defineExpose({ focusTrigger });

const handleKeyDown = (event) => {
  if (!isOpen.value) return;

  const { key } = event;
  const supportedKeys = ['Escape', 'ArrowDown', 'ArrowUp', 'Enter'];
  if (!supportedKeys.includes(key)) return;

  if (key === 'Escape') {
    if (!props.closeOnEscape) return;
    event.preventDefault();
    close();
    nextTick(() => {
      // Wait one frame so the focused teleported option is gone before restoring focus.
      requestAnimationFrame(focusTrigger);
    });
    return;
  }

  if (hasRenderOptions.value || hasCustomMenu.value) return;

  event.preventDefault();

  if (key === 'ArrowDown') {
    moveKeyboardIndex(1);
    focusKeyboardIndex();
    return;
  }

  if (key === 'ArrowUp') {
    moveKeyboardIndex(-1);
    focusKeyboardIndex();
    return;
  }

  if (key === 'Enter') {
    selectKeyboardOption();
  }
};

watch(
  isOpen,
  async (open) => {
    if (!open) {
      keyboardIndex.value = -1;
      optionRefs.value = [];
      return;
    }

    rememberTriggerFocusTarget();
    await nextTick();
    updateMenuPosition();

    if (hasRenderOptions.value || hasCustomMenu.value) return;

    keyboardIndex.value = getInitialKeyboardIndex();
    await nextTick();
    focusKeyboardIndex();
  },
  { immediate: true },
);

watch(
  isOpen,
  (open) => {
    if (open) {
      document.addEventListener('pointerdown', handlePointerDown, true);
      document.addEventListener('keydown', handleKeyDown, true);
      window.addEventListener('resize', updateMenuPosition);
      window.addEventListener('scroll', updateMenuPosition, true);
    } else {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    }
  },
  { immediate: true },
);

onMounted(() => {
  document.addEventListener('fullscreenchange', handleFullscreenChange);
});

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', handleFullscreenChange);
  document.removeEventListener('pointerdown', handlePointerDown, true);
  document.removeEventListener('keydown', handleKeyDown, true);
  window.removeEventListener('resize', updateMenuPosition);
  window.removeEventListener('scroll', updateMenuPosition, true);
});
</script>

<template>
  <div class="toolbar-dropdown">
    <div ref="triggerRef" class="toolbar-dropdown-trigger" data-sd-part="dropdown-trigger" @click="onTriggerClick">
      <slot name="trigger" />
    </div>

    <Teleport :to="teleportTarget">
      <Transition name="fade-in-scale-up-transition">
        <div
          v-if="isOpen"
          ref="menuRef"
          data-sd-part="dropdown-menu"
          :class="mergedMenuClass"
          :style="menuStyle"
          v-bind="computedMenuAttrs"
        >
          <slot v-if="hasCustomMenu" name="menu" />
          <div
            v-for="(option, index) in hasCustomMenu ? [] : options"
            :key="option.key"
            :ref="(el) => setOptionRef(el, index)"
            class="toolbar-dropdown-option"
            :class="[
              option.class,
              option.props?.class,
              { 'sd-disabled': option.disabled, 'sd-render': isRenderOption(option) },
            ]"
            tabindex="-1"
            @click="onOptionClick(option)"
            v-bind="{ ...option.props, ...getNodeProps(option) }"
          >
            <RenderOption v-if="isRenderOption(option)" :option="option" />
            <template v-else>
              <span v-if="hasIcon(option)" class="toolbar-dropdown-option__icon">
                <OptionIcon :option="option" />
              </span>
              <span class="toolbar-dropdown-option__label">{{ option.label }}</span>
            </template>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.toolbar-dropdown {
  display: inline-flex;
}

.toolbar-dropdown-trigger {
  display: inline-flex;
}

.toolbar-dropdown-menu {
  min-width: 80px;
  padding: 4px;
  border-radius: var(--sd-ui-radius, 6px);
  background: var(--sd-ui-dropdown-bg, #fff);
  border: 1px solid var(--sd-ui-dropdown-border, #e4e6eb);
  box-shadow: var(--sd-ui-dropdown-shadow, 0 8px 24px rgba(0, 0, 0, 0.16));
  box-sizing: border-box;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.toolbar-dropdown-menu.toolbar-dropdown-menu--render-only {
  padding: 0;
}

.toolbar-dropdown-option {
  min-height: 34px;
  display: flex;
  align-items: center;
  padding: 0 10px;
  border-radius: var(--sd-ui-dropdown-option-radius, 3px);
  cursor: pointer;
  font-size: var(--sd-ui-font-size-400, 14px);
  color: var(--sd-ui-dropdown-text, #47484a);
  transition: background-color 0.2s ease-out;
  box-sizing: border-box;
}

.toolbar-dropdown-option__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  min-width: 14px;
  height: 14px;
  margin-right: 6px;
}

.toolbar-dropdown-option__icon :deep(.dropdown-select-icon) {
  display: flex;
  width: 12px;
  height: 12px;
}

.toolbar-dropdown-option:hover {
  background: var(--sd-ui-dropdown-hover-bg, #d8dee5);
  color: var(--sd-ui-dropdown-hover-text, #47484a);
}

.toolbar-dropdown-option.sd-selected {
  background: var(--sd-ui-dropdown-active-bg, #d8dee5);
  color: var(--sd-ui-dropdown-selected-text, #47484a);
}

.toolbar-dropdown-menu.high-contrast .toolbar-dropdown-option:not(.sd-render):hover {
  background: #000;
  color: #fff;
}

.toolbar-dropdown-menu.high-contrast .toolbar-dropdown-option:not(.sd-render).sd-selected {
  background: #000;
  color: #fff;
}

.toolbar-dropdown-option.sd-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.toolbar-dropdown-option.sd-render {
  padding: 0;
  cursor: default;
  background: transparent;
  color: inherit;
}

.toolbar-dropdown-option.sd-render:hover,
.toolbar-dropdown-option.sd-render.sd-selected {
  background: transparent;
  color: inherit;
}

.fade-in-scale-up-transition-enter-active,
.fade-in-scale-up-transition-leave-active {
  transform-origin: top left;
}

.fade-in-scale-up-transition-enter-active {
  transition:
    opacity 0.2s cubic-bezier(0, 0, 0.2, 1),
    transform 0.2s cubic-bezier(0, 0, 0.2, 1);
}

.fade-in-scale-up-transition-leave-active {
  transition:
    opacity 0.2s cubic-bezier(0.4, 0, 1, 1),
    transform 0.2s cubic-bezier(0.4, 0, 1, 1);
}

.fade-in-scale-up-transition-enter-from,
.fade-in-scale-up-transition-leave-to {
  opacity: 0;
  transform: scale(0.9);
}

.fade-in-scale-up-transition-leave-from,
.fade-in-scale-up-transition-enter-to {
  opacity: 1;
  transform: scale(1);
}
</style>
