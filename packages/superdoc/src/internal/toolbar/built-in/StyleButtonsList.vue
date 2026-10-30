<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { PropType } from 'vue';
import { useHighContrastMode } from '../../../composables/use-high-contrast-mode';

const { isHighContrastMode } = useHighContrastMode();
const emit = defineEmits(['select']);

interface StyleButton {
  key: string;
  icon: string;
  ariaLabel: string;
}

const props = defineProps({
  buttons: {
    type: Array as PropType<StyleButton[]>,
    required: true,
  },
  selectedStyle: {
    type: String as PropType<string | null>,
    default: null,
  },
  iconSize: {
    type: Number,
    default: 25,
  },
});

const buttonRefs = ref<HTMLElement[]>([]);

const iconStyle = computed(() => ({
  width: `${props.iconSize}px`,
  height: `${props.iconSize}px`,
}));

const select = (key: string) => {
  emit('select', key);
};

const moveToNextButton = (index: number) => {
  if (index === buttonRefs.value.length - 1) return;
  const next = buttonRefs.value[index + 1];
  if (next) {
    next.setAttribute('tabindex', '0');
    next.focus();
  }
};

const moveToPreviousButton = (index: number) => {
  if (index === 0) return;
  const prev = buttonRefs.value[index - 1];
  if (prev) {
    prev.setAttribute('tabindex', '0');
    prev.focus();
  }
};

const handleKeyDown = (e: KeyboardEvent, index: number) => {
  switch (e.key) {
    case 'ArrowLeft':
      moveToPreviousButton(index);
      break;
    case 'ArrowRight':
      moveToNextButton(index);
      break;
    case 'Enter':
      select(props.buttons[index].key);
      break;
    default:
      break;
  }
};

onMounted(() => {
  const first = buttonRefs.value[0];
  if (first) {
    first.setAttribute('tabindex', '0');
    first.focus();
  }
});
</script>

<template>
  <div class="style-buttons-list" :class="{ 'high-contrast': isHighContrastMode }">
    <div
      v-for="(button, index) in props.buttons"
      :key="button.key"
      class="sd-button-icon"
      :class="{ 'sd-selected': props.selectedStyle === button.key }"
      :style="iconStyle"
      @click="select(button.key)"
      v-html="button.icon"
      role="menuitem"
      :aria-label="button.ariaLabel"
      ref="buttonRefs"
      @keydown.prevent="(event) => handleKeyDown(event, index)"
    ></div>
  </div>
</template>

<style scoped>
.style-buttons-list {
  display: flex;
  justify-content: space-between;
  width: 100%;
  padding: 8px;
  box-sizing: border-box;

  .sd-button-icon {
    cursor: pointer;
    padding: 5px;
    font-size: var(--sd-ui-font-size-600, 16px);
    color: var(--sd-ui-dropdown-text, #47484a);
    border-radius: var(--sd-ui-dropdown-option-radius, 3px);
    display: flex;
    justify-content: center;
    align-items: center;
    box-sizing: border-box;

    &:hover {
      background-color: var(--sd-ui-dropdown-hover-bg, #d8dee5);
      color: var(--sd-ui-dropdown-hover-text, #47484a);
    }

    :deep(svg) {
      width: 100%;
      height: 100%;
      display: block;
      fill: currentColor;
    }

    &.sd-selected {
      background-color: var(--sd-ui-dropdown-active-bg, #d8dee5);
      color: var(--sd-ui-dropdown-selected-text, #47484a);
    }
  }

  &.high-contrast {
    .sd-button-icon {
      &:hover,
      &.sd-selected {
        background-color: #000;
        color: #fff;
      }
    }
  }
}
</style>
