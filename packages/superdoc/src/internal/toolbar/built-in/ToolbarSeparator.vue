<script setup lang="ts">
import { useHighContrastMode } from '../../../composables/use-high-contrast-mode';
const emit = defineEmits(['command']);
const props = defineProps({
  active: {
    type: Boolean,
    default: false,
  },
});

const { isHighContrastMode } = useHighContrastMode();

const getSeparatorColor = () => {
  if (isHighContrastMode.value) {
    return '#000';
  }
  return 'var(--sd-ui-border, #dbdbdb)';
};
</script>

<template>
  <div class="toolbar-separator" role="separator" aria-label="Toolbar separator">
    <div class="separator-inner" :style="{ backgroundColor: getSeparatorColor() }"></div>
  </div>
</template>

<style scoped>
.toolbar-separator {
  height: var(--sd-ui-toolbar-height, 32px);
  border-radius: var(--sd-ui-radius, 6px);
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--sd-ui-border, #dbdbdb);
  transition: all 0.2s ease-out;
  user-select: none;
  overflow: hidden;
}
.toolbar-separator .separator-inner {
  width: 1.5px;
  height: 20px;
}
</style>
