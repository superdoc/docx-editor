<script setup lang="ts">
import { computed, ref, unref } from 'vue';
import type { PropType } from 'vue';
import ToolbarButton from './ToolbarButton.vue';
import ButtonGroup from './ButtonGroup.vue';
import type { ToolbarGroupCommand, ToolbarGroupItem } from './ButtonGroup.vue';
import ToolbarDropdown from './ToolbarDropdown.vue';
import { preventEditorFocusTransfer } from './toolbar-focus-helpers.js';

const emit = defineEmits<{
  buttonClick: [item: ToolbarGroupItem];
  close: [];
  command: [payload: ToolbarGroupCommand];
}>();

const props = defineProps({
  toolbarItem: {
    type: Object as PropType<ToolbarGroupItem>,
    required: true,
  },
  overflowItems: {
    type: Array as PropType<ToolbarGroupItem[]>,
    required: true,
  },
  uiFontFamily: {
    type: String,
    default: 'Arial, Helvetica, sans-serif',
  },
});

const dropdown = ref<InstanceType<typeof ToolbarDropdown> | null>(null);
const isOverflowMenuOpened = computed(() => props.toolbarItem.expand.value);
const hasOpenDropdown = computed(() =>
  props.overflowItems.some((item) => item.type === 'dropdown' && unref(item.expand)),
);

const overflowToolbarItem = computed(() => ({
  ...props.toolbarItem,
  active: isOverflowMenuOpened.value,
}));

const setOverflowMenuOpen = (open: boolean) => {
  if (open === isOverflowMenuOpened.value) return;
  if (open) {
    emit('buttonClick', props.toolbarItem);
    return;
  }
  emit('close');
};

const handleCommand = ({ item, argument, option }: ToolbarGroupCommand) => {
  if (item.name.value === 'watermark') {
    // The dialog must restore a mounted trigger after the overflow item disappears.
    emit('close');
    dropdown.value?.focusTrigger();
  }
  emit('command', { item, argument, option });
};
</script>

<template>
  <ToolbarDropdown
    ref="dropdown"
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
      <ToolbarButton :toolbar-item="overflowToolbarItem" :allow-enter-propagation="true" />
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
