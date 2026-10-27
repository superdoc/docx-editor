<script setup>
import { ref, onMounted, nextTick, watch } from 'vue';
import { toolbarIcons } from './toolbarIcons.js';

/**
 * Built-in linked-styles (quick format) dropdown list.
 *
 * Consumes the v2 `superdoc/ui` style catalogue quick-gallery items
 * (`StyleCatalogItem`: `id`, `name`, optional `preview.css`, visibility), passed
 * in via the `styles` array. Selecting a style emits the catalogue item; the
 * toolbar controller normalizes it to a style id and routes the apply through
 * the shared `linked-style` command (`styles.paragraph.setStyle`). Each row also
 * carries an "Update to match selection" action that emits `update` with the
 * item; the toolbar routes it through `ui.styles.updateToMatchSelection`. The rendered
 * control stays faithful to the legacy DOM contract
 * (`data-item="btn-linkedStyles-option"`, keyboard navigation) and makes no
 * v1-only shape assumptions.
 */
const emit = defineEmits(['select', 'update']);
const styleRefs = ref([]);
const props = defineProps({
  styles: {
    type: Array,
    default: () => [],
  },
  selectedOption: {
    type: String,
    default: null,
  },
  updateLabel: {
    type: String,
    default: 'Update to match selection',
  },
});

const select = (style) => {
  emit('select', style);
};

const update = (style) => {
  emit('update', style);
};

const moveToNextStyle = (index) => {
  if (index === styleRefs.value.length - 1) return;
  const nextItem = styleRefs.value[index + 1];
  nextItem.setAttribute('tabindex', '0');
  nextItem.focus();
};

const moveToPreviousStyle = (index) => {
  if (index === 0) return;
  const previousItem = styleRefs.value[index - 1];
  previousItem.setAttribute('tabindex', '0');
  previousItem.focus();
};

const handleKeyDown = (event, index, style) => {
  switch (event.key) {
    case 'ArrowDown':
      moveToNextStyle(index);
      break;
    case 'ArrowUp':
      moveToPreviousStyle(index);
      break;
    case 'Enter':
      event.preventDefault();
      select(style);
      break;
    default:
      break;
  }
};

const styleLabel = (style) => style?.name ?? style?.id ?? '';

// Optional resolved preview tokens from the v2 catalogue item
// (`StyleCatalogItem.preview.css`). Absent on documents/passes without preview
// resolution, in which case the option renders with default styling.
const previewStyle = (style) => {
  const css = style?.preview?.css;
  return css && typeof css === 'object' ? css : undefined;
};

const focusFirstStyle = () => {
  if (styleRefs.value[0]) {
    styleRefs.value[0].setAttribute('tabindex', '0');
    styleRefs.value[0].focus();
  }
};

onMounted(focusFirstStyle);

watch(
  () => props.styles.length,
  async (length, previousLength) => {
    if (length === 0 || previousLength !== 0) return;
    await nextTick();
    focusFirstStyle();
  },
);
</script>

<template>
  <div class="linked-style-buttons" data-editor-ui-surface>
    <div
      v-for="(style, index) in props.styles"
      :key="style.id ?? index"
      class="style-item"
      @click="select(style)"
      @keydown="(event) => handleKeyDown(event, index, style)"
      :class="{ selected: selectedOption === style.id }"
      :aria-label="`Linked style - ${style.id ?? styleLabel(style)}`"
      ref="styleRefs"
    >
      <div class="style-name" data-item="btn-linkedStyles-option" :style="previewStyle(style)">
        {{ styleLabel(style) }}
      </div>
      <button
        type="button"
        class="style-update"
        data-item="btn-linkedStyles-update"
        :title="props.updateLabel"
        :aria-label="`${props.updateLabel}: ${styleLabel(style)}`"
        @click.stop="update(style)"
        @keydown.stop
      >
        <span class="style-update-icon" v-html="toolbarIcons.paintbrush" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.style-item {
  position: relative;
}

.style-name {
  /* Room on the right for the row's update action. */
  padding: 16px 36px 16px 10px;
  color: var(--sd-ui-dropdown-text, #47484a);
}

.style-update {
  position: absolute;
  top: 50%;
  right: 6px;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--sd-ui-dropdown-text, #47484a);
  cursor: pointer;
  opacity: 0;
}

.style-item:hover .style-update,
.style-item:focus-within .style-update,
.style-item.selected .style-update {
  opacity: 1;
}

.style-update-icon {
  display: flex;
  width: 12px;
  height: 12px;
}

.style-update-icon :deep(svg) {
  width: 100%;
  height: 100%;
  fill: currentColor;
}

.style-update:hover,
.style-update:focus-visible {
  background-color: var(--sd-ui-dropdown-bg, #fff);
}

.style-name:hover {
  background-color: var(--sd-ui-dropdown-hover-bg, #d8dee5);
  color: var(--sd-ui-dropdown-hover-text, #47484a);
}

.linked-style-buttons {
  display: flex;
  flex-direction: column;
  width: 100%;
  box-sizing: border-box;
  max-height: 400px;
  width: 200px;
  padding: 0;
  margin: 0;
  overflow: auto;
}
</style>
