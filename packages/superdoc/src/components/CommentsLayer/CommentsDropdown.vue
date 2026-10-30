<script setup lang="ts">
import { computed, defineComponent, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { CSSProperties, PropType, VNodeChild } from 'vue';

type CommentsDropdownOption = {
  key: string;
  label: string;
  disabled?: boolean;
  iconString?: string;
  icon?: VNodeChild | ((option: CommentsDropdownOption) => VNodeChild);
};

const props = defineProps({
  options: {
    type: Array as PropType<readonly CommentsDropdownOption[]>,
    default: () => [],
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

const emit = defineEmits(['select']);

const isOpen = ref(false);
const triggerRef = ref<HTMLElement | null>(null);
const menuRef = ref<HTMLElement | null>(null);
const menuPosition = ref({ top: '0px', left: '0px' });

const menuStyle = computed<CSSProperties>(() => ({
  ...props.contentStyle,
  position: 'fixed',
  top: menuPosition.value.top,
  left: menuPosition.value.left,
  zIndex: 1200,
}));

const setOpen = (value: boolean) => {
  if (props.disabled && value) return;
  isOpen.value = value;
};

const toggle = () => {
  if (props.disabled) return;
  setOpen(!isOpen.value);
};

const close = () => {
  if (!isOpen.value) return;
  setOpen(false);
};

const updateMenuPosition = () => {
  if (!triggerRef.value) return;
  const rect = triggerRef.value.getBoundingClientRect();
  const menuWidth = menuRef.value?.offsetWidth ?? 0;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const gutter = 8;

  let left = rect.left;
  const maxLeft = Math.max(gutter, viewportWidth - menuWidth - gutter);
  left = Math.min(Math.max(gutter, left), maxLeft);

  menuPosition.value = {
    top: `${rect.bottom + 4}px`,
    left: `${left}px`,
  };
};

const handleTriggerClick = (event: MouseEvent) => {
  event.stopPropagation();
  toggle();
};

const onOptionClick = (option: CommentsDropdownOption) => {
  if (option?.disabled) return;
  emit('select', option?.key, option);
  close();
};

const hasIcon = (option: CommentsDropdownOption) => Boolean(option?.iconString) || Boolean(option?.icon);

const renderIcon = (option: CommentsDropdownOption): VNodeChild => {
  if (option?.iconString) return option.iconString;
  if (typeof option?.icon === 'function') return option.icon(option);
  return option?.icon || null;
};

const OptionIcon = defineComponent({
  name: 'CommentsDropdownOptionIcon',
  props: {
    option: {
      type: Object as PropType<CommentsDropdownOption>,
      required: true,
    },
  },
  setup(componentProps) {
    return () => renderIcon(componentProps.option);
  },
});

const handlePointerDown = (event: PointerEvent) => {
  if (!isOpen.value) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const insideTrigger = triggerRef.value?.contains(target);
  const insideMenu = menuRef.value?.contains(target);
  if (insideTrigger || insideMenu) return;
  close();
};

const handleEscape = (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return;
  close();
};

watch(isOpen, async (open) => {
  if (!open) return;
  await nextTick();
  updateMenuPosition();
});

watch(isOpen, (open) => {
  if (open) {
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleEscape, true);
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
  } else {
    document.removeEventListener('pointerdown', handlePointerDown, true);
    document.removeEventListener('keydown', handleEscape, true);
    window.removeEventListener('resize', updateMenuPosition);
    window.removeEventListener('scroll', updateMenuPosition, true);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handlePointerDown, true);
  document.removeEventListener('keydown', handleEscape, true);
  window.removeEventListener('resize', updateMenuPosition);
  window.removeEventListener('scroll', updateMenuPosition, true);
});
</script>

<template>
  <div class="comments-dropdown">
    <div ref="triggerRef" class="comments-dropdown__trigger" @click="handleTriggerClick">
      <slot />
    </div>

    <Teleport to="body">
      <div v-if="isOpen" ref="menuRef" class="comments-dropdown__menu" :style="menuStyle">
        <div
          v-for="option in options"
          :key="option.key"
          class="comments-dropdown__option"
          :class="{ 'sd-disabled': option.disabled }"
          @click="onOptionClick(option)"
        >
          <span v-if="hasIcon(option)" class="comments-dropdown__option-icon">
            <span v-if="option.iconString" v-html="option.iconString"></span>
            <OptionIcon v-else :option="option" />
          </span>
          <span class="comments-dropdown__option-label">{{ option.label }}</span>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.comments-dropdown {
  display: inline-flex;
}

.comments-dropdown__trigger {
  display: inline-flex;
}

.comments-dropdown__menu {
  min-width: 120px;
  border-radius: 8px;
  border: 1px solid var(--sd-ui-comments-dropdown-border, #dbdbdb);
  background: var(--sd-ui-comments-dropdown-bg, #fff);
  box-shadow: var(--sd-ui-comments-dropdown-shadow, 0 8px 24px rgba(0, 0, 0, 0.12));
  padding: 4px;
  box-sizing: border-box;
}

.comments-dropdown__option {
  font-size: var(--sd-ui-comments-option-size, 14px);
  color: var(--sd-ui-comments-option-text, #212121);
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  box-sizing: border-box;
}

.comments-dropdown__option:hover {
  background-color: var(--sd-ui-comments-option-hover-bg, #f3f3f5);
  color: var(--sd-ui-comments-option-hover-text, #212121);
}

.comments-dropdown__option.sd-disabled {
  opacity: 0.5;
  pointer-events: none;
}

.comments-dropdown__option-icon {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  flex-shrink: 0;
  width: 16px;
  height: 16px;
}

.comments-dropdown__option-icon :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
  fill: currentColor;
}
</style>
