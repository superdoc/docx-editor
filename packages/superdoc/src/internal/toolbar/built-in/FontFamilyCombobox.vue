<script setup lang="ts">
import type { PropType } from 'vue';
import ToolbarComboBox from './ToolbarComboBox.vue';
import type { ComboBoxCommand, ComboBoxItem, ComboBoxTabOut } from './ToolbarComboBox.vue';
import { normalizeCustomFontFamily } from './font-typeahead.js';

const props = defineProps({
  item: {
    type: Object as PropType<ComboBoxItem>,
    required: true,
  },
  uiFontFamily: {
    type: String,
    default: 'Arial, Helvetica, sans-serif',
  },
});

// Re-emit (rather than rely on attribute fallthrough) so this wrapper's own
// emitted-event surface stays intact for `item`-driven consumers and tests.
const emit = defineEmits<{
  command: [payload: ComboBoxCommand];
  'item-clicked': [];
  'tab-out': [event: ComboBoxTabOut];
  'editor-handoff': [];
}>();
</script>

<template>
  <ToolbarComboBox
    :item="props.item"
    :ui-font-family="props.uiFontFamily"
    :show-preview="true"
    :normalize-value="normalizeCustomFontFamily"
    @command="emit('command', $event)"
    @item-clicked="emit('item-clicked')"
    @tab-out="emit('tab-out', $event)"
    @editor-handoff="emit('editor-handoff')"
  />
</template>
