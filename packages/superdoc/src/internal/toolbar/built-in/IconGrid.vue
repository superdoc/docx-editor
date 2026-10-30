<script setup lang="ts">
import type { PropType, Ref } from 'vue';
import IconGridRow from './IconGridRow.vue';
import type { ColorOption } from './IconGridRow.vue';
import DropIcon from '@superdoc/common/icons/droplet-slash.svg?raw';
const emit = defineEmits(['select', 'clickoutside']);
const props = defineProps({
  icons: {
    type: Array as PropType<ColorOption[][]>,
    required: true,
  },
  customIcons: {
    type: Array as PropType<ColorOption[][]>,
    required: false,
  },
  activeColor: {
    type: Object as PropType<Ref<string | null | undefined>>,
    required: false,
  },
  hasNoneIcon: {
    type: Boolean,
    required: false,
  },
});

const handleSelect = (option: string) => {
  emit('select', option);
};
</script>

<template>
  <div class="options-grid-wrap">
    <div
      v-if="hasNoneIcon"
      class="none-option"
      role="menuitem"
      aria-label="Clear color selection"
      @click="handleSelect('none')"
    >
      <span v-html="DropIcon" class="none-icon"></span>
      None
    </div>
    <div class="option-grid-ctn">
      <IconGridRow :icons="icons" :active-color="activeColor" @select="handleSelect" />

      <template v-if="customIcons?.flat().length">
        <span class="option-grid-ctn__subtitle">Custom colors</span>

        <IconGridRow :icons="customIcons" :active-color="activeColor" @select="handleSelect" />
      </template>
    </div>
  </div>
</template>

<style scoped>
.options-grid-wrap {
  padding: 5px;
  border-radius: var(--sd-ui-radius, 6px);
}
.none-option {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  color: var(--sd-ui-text, #47484a);

  &:hover {
    opacity: 0.65;
  }
}
.none-icon {
  width: 16px;
}
.option-grid-ctn {
  display: flex;
  flex-direction: column;
  background-color: var(--sd-ui-dropdown-bg, #ffffff);
  z-index: 3;
  box-sizing: border-box;
  &__subtitle {
    padding: 3px;
    font-size: var(--sd-ui-font-size-200, 12px);
    font-weight: 600;
  }
}

.option-grid-ctn :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
  fill: currentColor;
}
</style>
