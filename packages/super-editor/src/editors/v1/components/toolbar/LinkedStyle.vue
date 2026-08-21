<script setup>
import { computed, ref, onMounted } from 'vue';
import { toolbarIcons } from './toolbarIcons.js';
import { generateLinkedStyleString, getQuickFormatList } from '@extensions/linked-styles/index.js';

const emit = defineEmits(['select', 'update']);
const styleRefs = ref([]);
const props = defineProps({
  editor: {
    type: Object,
    required: true,
  },
  selectedOption: {
    type: String,
  },
});

const select = (style) => {
  emit('select', style);
};

const update = (style) => {
  emit('update', style);
};

const moveToNextStyle = (index) => {
  if (index === styleRefs.value.length - 1) {
    return;
  }
  const nextItem = styleRefs.value[index + 1];
  nextItem.setAttribute('tabindex', '0');
  nextItem.focus();
};

const moveToPreviousStyle = (index) => {
  if (index === 0) {
    return;
  }
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
onMounted(() => {
  // Focus on the first style item
  styleRefs.value[0].setAttribute('tabindex', '0');
  styleRefs.value[0].focus();
});
</script>

<template>
  <div class="linked-style-buttons" v-if="props.editor" data-editor-ui-surface>
    <div
      v-for="(style, index) in getQuickFormatList(editor)"
      class="style-item"
      @click="select(style)"
      @keydown="(event) => handleKeyDown(event, index, style)"
      :class="{ selected: selectedOption === style.id }"
      :aria-label="`Linked style - ${style.id}`"
      ref="styleRefs"
    >
      <div
        class="style-name"
        :style="generateLinkedStyleString(style, null, null, false)"
        data-item="btn-linkedStyles-option"
      >
        {{ style.definition.attrs.name }}
      </div>
      <button
        type="button"
        class="style-update"
        :title="`Update ${style.definition.attrs.name} to match selection`"
        :aria-label="`Update ${style.definition.attrs.name} to match selection`"
        data-item="btn-linkedStyles-update"
        @click.stop="update(style)"
      >
        ✎
      </button>
    </div>
  </div>
</template>

<style scoped>
.style-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.style-name {
  flex: 1;
  min-width: 0;
  padding: 16px 10px;
  color: var(--sd-ui-dropdown-text, #47484a);
}

.style-item:hover {
  background-color: var(--sd-ui-dropdown-hover-bg, #d8dee5);
}

.style-name:hover {
  background-color: var(--sd-ui-dropdown-hover-bg, #d8dee5);
  color: var(--sd-ui-dropdown-hover-text, #47484a);
}

.style-update {
  flex-shrink: 0;
  margin-right: 8px;
  padding: 4px 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--sd-ui-dropdown-text, #47484a);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  visibility: hidden;
}

.style-item:hover .style-update,
.style-update:focus {
  visibility: visible;
}

.style-update:hover {
  background-color: var(--sd-ui-active-bg, #c3cdd8);
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
