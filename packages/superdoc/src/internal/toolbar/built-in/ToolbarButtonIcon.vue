<script setup lang="ts">
import { computed } from 'vue';
import type { PropType } from 'vue';

const props = defineProps({
  name: {
    type: String,
    required: true,
  },
  color: {
    type: String as PropType<string | null>,
    default: null,
  },
  icon: {
    type: String as PropType<string | null>,
    default: null,
  },
});

const getBarColor = computed(() => {
  if (props.name === 'color') return { backgroundColor: props.color || '#111111' };
  if (props.name === 'highlight') return { backgroundColor: props.color || '#D6D6D6' };
});

const hasColorBar = computed(() => {
  return ['color', 'highlight'].includes(props.name);
});
</script>

<template>
  <div class="sd-toolbar-icon">
    <div class="sd-toolbar-icon__icon" :class="[`sd-toolbar-icon__icon--${props.name}`]" v-html="icon"></div>
    <div class="color-bar" v-if="hasColorBar" :style="getBarColor"></div>
  </div>
</template>

<style scoped>
.sd-toolbar-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.sd-toolbar-icon__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  height: 16px;
  &--highlight {
    width: 16px;
    margin-left: 3px;
    margin-bottom: 1px;
  }
}

.sd-toolbar-icon__icon :deep(svg) {
  width: auto; /* needed for safari */
  /* A definite height sizes viewBox-only icons from their aspect ratio. Without
     it they collapse to 0x0 in the wrapped overflow menu. */
  height: 16px;
  max-height: 16px;
}

.sd-toolbar-icon__icon--color :deep(svg) {
  max-height: 14px;
  margin-top: -3px;
}

.color-bar {
  border-radius: 4px;
  position: absolute;
  z-index: 5;
  height: 4px;
  left: 50%;
  bottom: 6px;
  transform: translateX(-50%);
  width: 16px;
}
</style>
