<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { PropType, Ref } from 'vue';
import { toolbarIcons } from './toolbarIcons.js';

export interface ColorOption {
  label: string;
  icon: string;
  value: string;
  style: Record<string, string>;
}

const emit = defineEmits(['select', 'clickoutside']);
const props = defineProps({
  icons: {
    type: Array as PropType<ColorOption[][]>,
    required: true,
  },
  activeColor: {
    type: Object as PropType<Ref<string | null | undefined>>,
    required: false,
  },
});

const isActive = computed(() => (option: ColorOption) => {
  const activeColor = props.activeColor?.value;
  if (!activeColor) return false;
  return activeColor.toUpperCase() === option.value;
});

const getCheckStyle = (color: string, optionIndex: number) => {
  const lightColors = ['#FFFFFF', '#FAFF09'];
  if (optionIndex === 5 || lightColors.includes(color)) return { color: '#000' };
  return { color: '#FFF' };
};

const handleClick = (option: ColorOption) => {
  emit('select', option.value);
};

const rowRefs = ref<HTMLElement[]>([]);
const iconRefs = ref<HTMLElement[]>([]);

const ROW_SIZE = 7;
onMounted(() => {
  const isMatrix = props.icons.every((row) => Array.isArray(row));
  if (!isMatrix) throw new Error('icon props must be 2d array');

  // Focus on the first icon
  const firstIcon = iconRefs.value[0];
  if (firstIcon) {
    firstIcon.setAttribute('tabindex', '0');
    firstIcon.focus({ preventScroll: true });
  }
});

const moveToNextIcon = (rowIndex: number, optionIndex: number) => {
  const iconIndex = ROW_SIZE * rowIndex + optionIndex + 1;
  const nextIcon = iconRefs.value[iconIndex];
  if (nextIcon) {
    nextIcon.setAttribute('tabindex', '0');
    nextIcon.focus({ preventScroll: true });
  }
};

const moveToPreviousIcon = (rowIndex: number, optionIndex: number) => {
  const iconIndex = ROW_SIZE * rowIndex + optionIndex - 1;
  const previousIcon = iconRefs.value[iconIndex];
  if (previousIcon) {
    previousIcon.setAttribute('tabindex', '0');
    previousIcon.focus({ preventScroll: true });
  }
};

const moveToNextRow = (rowIndex: number, optionIndex: number) => {
  const iconIndex = optionIndex + ROW_SIZE * (rowIndex + 1);
  const nextIcon = iconRefs.value[iconIndex];
  if (nextIcon) {
    nextIcon.setAttribute('tabindex', '0');
    nextIcon.focus({ preventScroll: true });
  }
};

const moveToPreviousRow = (rowIndex: number, optionIndex: number) => {
  const iconIndex = optionIndex + ROW_SIZE * (rowIndex - 1);
  const previousIcon = iconRefs.value[iconIndex];
  if (previousIcon) {
    previousIcon.setAttribute('tabindex', '0');
    previousIcon.focus({ preventScroll: true });
  }
};

const handleKeyDown = (event: KeyboardEvent, rowIndex: number, optionIndex: number, option: ColorOption) => {
  switch (event.key) {
    case 'ArrowRight':
      moveToNextIcon(rowIndex, optionIndex);
      break;
    case 'ArrowLeft':
      moveToPreviousIcon(rowIndex, optionIndex);
      break;
    case 'ArrowDown':
      moveToNextRow(rowIndex, optionIndex);
      break;
    case 'ArrowUp':
      moveToPreviousRow(rowIndex, optionIndex);
      break;
    case 'Enter':
      handleClick(option);
      break;
    case 'Escape':
      emit('clickoutside');
      break;
    default:
      break;
  }
};
</script>
<template>
  <div class="sd-option-row" v-for="(row, rowIndex) in icons" :key="rowIndex" role="group" ref="rowRefs">
    <div
      class="sd-option"
      v-for="(option, optionIndex) in row"
      :key="optionIndex"
      :aria-label="option.label"
      role="menuitem"
      ref="iconRefs"
      @click.stop.prevent="handleClick(option)"
      @keydown.prevent="(event) => handleKeyDown(event, rowIndex, optionIndex, option)"
    >
      <div class="sd-option__icon" v-html="option.icon" :style="option.style"></div>

      <div
        v-if="isActive(option)"
        class="sd-option__check"
        v-html="toolbarIcons.colorOptionCheck"
        :style="getCheckStyle(option.value, optionIndex)"
      ></div>
    </div>
  </div>
</template>

<style scoped>
.sd-option-row {
  display: flex;
  flex-direction: row;
}
.sd-option {
  border-radius: 50%;
  cursor: pointer;
  padding: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  box-sizing: border-box;
}

.sd-option:hover {
  background-color: var(--sd-ui-dropdown-hover-bg, #d8dee5);
}

.sd-option__icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.sd-option__check {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  position: absolute;
}
</style>
