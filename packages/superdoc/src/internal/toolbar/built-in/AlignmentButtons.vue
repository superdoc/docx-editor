<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useHighContrastMode } from '../../../composables/use-high-contrast-mode';

import { toolbarIcons } from './toolbarIcons.js';

const { isHighContrastMode } = useHighContrastMode();
const emit = defineEmits(['select']);

const alignmentButtonsRefs = ref<HTMLElement[]>([]);
const alignmentButtons = [
  {
    key: 'left',
    ariaLabel: 'Align left',
    icon: toolbarIcons.alignLeft,
  },
  {
    key: 'center',
    ariaLabel: 'Align center',
    icon: toolbarIcons.alignCenter,
  },
  {
    key: 'right',
    ariaLabel: 'Align right',
    icon: toolbarIcons.alignRight,
  },
  {
    key: 'justify',
    ariaLabel: 'Justify',
    icon: toolbarIcons.alignJustify,
  },
];
const select = (alignment: string) => {
  emit('select', alignment);
};

const moveToNextButton = (index: number) => {
  if (index === alignmentButtonsRefs.value.length - 1) return;
  const nextButton = alignmentButtonsRefs.value[index + 1];
  if (nextButton) {
    nextButton.setAttribute('tabindex', '0');
    nextButton.focus();
  }
};

const moveToPreviousButton = (index: number) => {
  if (index === 0) return;
  const previousButton = alignmentButtonsRefs.value[index - 1];
  if (previousButton) {
    previousButton.setAttribute('tabindex', '0');
    previousButton.focus();
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
      select(alignmentButtons[index].key);
      break;
    default:
      break;
  }
};
onMounted(() => {
  // Focus on the first button
  const firstButton = alignmentButtonsRefs.value[0];
  if (firstButton) {
    firstButton.setAttribute('tabindex', '0');
    firstButton.focus();
  }
});
</script>

<template>
  <div class="alignment-buttons" :class="{ 'high-contrast': isHighContrastMode }">
    <div
      v-for="(button, index) in alignmentButtons"
      :key="button.key"
      class="sd-button-icon"
      @click="select(button.key)"
      v-html="button.icon"
      data-item="btn-textAlign-option"
      role="menuitem"
      :aria-label="button.ariaLabel"
      ref="alignmentButtonsRefs"
      @keydown.prevent="(event) => handleKeyDown(event, index)"
    ></div>
  </div>
</template>

<style scoped>
.alignment-buttons {
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
    width: 25px;
    height: 25px;
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
  }

  &.high-contrast {
    .sd-button-icon {
      &:hover {
        background-color: #000;
        color: #fff;
      }
    }
  }
}
</style>
