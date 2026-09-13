<script setup>
import { computed, unref } from 'vue';
import ToolbarButton from './ToolbarButton.vue';
import ButtonGroup from './ButtonGroup.vue';
import ToolbarDropdown from './ToolbarDropdown.vue';
import { preventEditorFocusTransfer } from './toolbar-focus-helpers.js';

const emit = defineEmits(['buttonClick', 'close', 'command']);

const props = defineProps({
  toolbarItem: {
    type: Object,
    required: true,
  },
  overflowItems: {
    type: Array,
    required: true,
  },
  uiFontFamily: {
    type: String,
    default: 'Arial, Helvetica, sans-serif',
  },
});

const isOverflowMenuOpened = computed(() => props.toolbarItem.expand.value);
const hasOpenDropdown = computed(() =>
  props.overflowItems.some((item) => item.type === 'dropdown' && unref(item.expand)),
);

const overflowToolbarItem = computed(() => ({
  ...props.toolbarItem,
  active: isOverflowMenuOpened.value,
}));

const setOverflowMenuOpen = (open) => {
  if (open === isOverflowMenuOpened.value) return;
  if (open) {
    emit('buttonClick', props.toolbarItem);
    return;
  }
  emit('close');
};

const handleCommand = ({ item, argument, option }) => {
  emit('command', { item, argument, option });
};
</script>

<template>
  <ToolbarDropdown
    class="overflow-menu"
    :close-on-escape="!hasOpenDropdown"
    :has-open-child="hasOpenDropdown"
    :content-style="{ width: '200px', padding: '4px 8px', fontFamily: props.uiFontFamily }"
    :options="[]"
    placement="bottom-end"
    :show="isOverflowMenuOpened"
    @update:show="setOverflowMenuOpen"
    :menu-props="() => ({ role: 'group', class: ['overflow-menu_items', 'sd-toolbar-overflow-menu'] })"
  >
    <template #trigger>
      <ToolbarButton :toolbar-item="overflowToolbarItem" />
    </template>
    <template #menu>
      <ButtonGroup
        class="superdoc-toolbar-overflow"
        :toolbar-items="overflowItems"
        :ui-font-family="props.uiFontFamily"
        from-overflow
        @mousedown="preventEditorFocusTransfer"
        @command="handleCommand"
      />
    </template>
  </ToolbarDropdown>
</template>

<style lang="postcss" scoped>
.superdoc-toolbar-overflow {
  min-width: auto !important;
  max-width: 200px;
  flex-wrap: wrap;
}
</style>
