<script setup lang="ts">
import { computed } from 'vue';
import type { PropType } from 'vue';
import type { WhiteboardPage as WhiteboardPageModel } from '../../core/whiteboard/WhiteboardPage';
import WhiteboardPage from './WhiteboardPage.vue';
import type { WhiteboardDropTarget, WhiteboardPageOffset, WhiteboardPageSize } from './whiteboard-types';

const props = defineProps({
  whiteboard: {
    type: Object as PropType<WhiteboardDropTarget>,
    required: true,
  },
  pages: {
    type: Array as PropType<WhiteboardPageModel[]>,
    default: () => [],
  },
  pageSizes: {
    type: Object as PropType<Record<number, WhiteboardPageSize>>,
    default: () => ({}),
  },
  pageOffsets: {
    type: Object as PropType<Record<number, WhiteboardPageOffset>>,
    default: () => ({}),
  },
  enabled: {
    type: Boolean,
    default: true,
  },
  /**
   * Pointer ownership flag, separate from `enabled` (which controls show + Konva
   * interactivity). When the whiteboard surface overlays a PDF, the host passes
   * `interactive` so a visible-but-inert whiteboard layer never swallows PDF text
   * selection or PDF comment selection. Defaults to `enabled` to preserve the
   * legacy single-flag behavior when a host does not provide an explicit value.
   */
  interactive: {
    type: Boolean as PropType<boolean | null>,
    default: null,
  },
  opacity: {
    type: Number,
    default: 1,
  },
});

// Whether the layer captures pointer events. Falls back to `enabled` when the
// host does not pass an explicit `interactive` flag.
const pointerActive = computed(() => (props.interactive == null ? props.enabled : props.interactive));
</script>

<template>
  <div
    class="whiteboard-layer"
    aria-hidden="true"
    :style="{ opacity: opacity, pointerEvents: pointerActive ? 'auto' : 'none' }"
  >
    <WhiteboardPage
      v-for="page in pages"
      :key="page.pageIndex"
      :page="page"
      :page-size="pageSizes?.[page.pageIndex]"
      :page-offset="pageOffsets?.[page.pageIndex]"
      :whiteboard="whiteboard"
      :enabled="enabled"
    />
  </div>
</template>

<style scoped>
.whiteboard-layer {
  position: absolute;
  inset: 0;
  /* Base state is pointer-inert; the inline `pointerEvents` binding (driven by
     `pointerActive`) is the single source of truth for pointer ownership. */
  pointer-events: none;
}
</style>
