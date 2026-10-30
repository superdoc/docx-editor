<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue';
import type { CSSProperties } from 'vue';
import { superdocIcons } from '../../icons.js';
import { useUiFontFamily } from '../../composables/useUiFontFamily.js';
import CommentsDropdown from './CommentsDropdown.vue';

const emit = defineEmits(['select']);
const props = defineProps({
  state: {
    type: String,
    required: false,
  },
  isDisabled: {
    type: Boolean,
    default: false,
  },
});

const { uiFontFamily } = useUiFontFamily();

const options = [
  {
    label: 'Internal',
    key: 'internal',
    iconString: superdocIcons.internal,
    backgroundColor: 'var(--sd-ui-comments-internal-bg, #CDE6E6)',
  },
  {
    label: 'External',
    key: 'external',
    iconString: superdocIcons.external,
    backgroundColor: 'var(--sd-ui-comments-external-bg, #F5CFDA)',
  },
];

const getState = computed(() => {
  return options.find((o) => o.key === activeState.value)?.label;
});

const getStyle = computed(() => {
  if (!props.state) return {};

  const activeOption = options.find((o) => o.key === activeState.value);
  if (!activeOption) return {};

  const style: CSSProperties = { backgroundColor: activeOption.backgroundColor };

  if (props.isDisabled) {
    style.opacity = 0.5;
    style.cursor = 'default';
  }
  return style;
});

const handleSelect = (key: string | undefined, suppressEmit = false) => {
  activeState.value = key;
  activeIcon.value = options.find((o) => o.key === key)?.iconString;

  if (suppressEmit) return;
  emit('select', key);
};

const activeState = ref(props.state);
const activeIcon = ref<string | null | undefined>(null);

watch(
  () => props.state,
  (newVal) => {
    handleSelect(newVal);
  },
);

onMounted(() => {
  handleSelect(props.state, true);
});
</script>

<template>
  <div class="sd-internal-dropdown" :style="getStyle" data-sd-part="dropdown-trigger">
    <CommentsDropdown
      :options="options"
      @select="handleSelect($event)"
      :disabled="isDisabled"
      :content-style="{ fontFamily: uiFontFamily }"
    >
      <div class="sd-comment-option">
        <div class="sd-active-icon" v-html="activeIcon"></div>
        <div class="sd-option-state">{{ getState }}</div>
        <div class="sd-dropdown-caret" v-html="superdocIcons.caretDown"></div>
      </div>
    </CommentsDropdown>
  </div>
</template>

<style scoped>
.sd-comment-option {
  display: flex;
  align-items: center;
  font-size: 11px;
}
.sd-comment-option i {
  font-size: 11px;
}
.sd-option-state {
  margin: 0 7px;
}

.sd-active-icon {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  flex-shrink: 0;
  width: 16px;
  height: 16px;
}

.sd-active-icon :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
  fill: currentColor;
}

.sd-dropdown-caret {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  flex-shrink: 0;
  width: 10px;
  height: 16px;
}

.sd-dropdown-caret :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
  fill: currentColor;
}

.sd-internal-dropdown {
  transition: all 250ms ease;
  display: inline-flex;
  cursor: pointer;
  border-radius: 50px;
  padding: 2px 8px;
}
.sd-internal-dropdown:hover {
  background-color: #f3f3f5;
}
</style>
