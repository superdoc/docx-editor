<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import type { PropType } from 'vue';
import type {
  DirectSurfaceRequest,
  ExternalSurfaceRenderContext,
  SurfaceMode,
  SurfaceRequest,
} from '../../core/types/index.js';

const props = defineProps({
  surfaceId: { type: String, required: true },
  mode: { type: String as PropType<SurfaceMode>, required: true },
  request: { type: Object as PropType<SurfaceRequest>, required: true },
  render: { type: Function as PropType<NonNullable<DirectSurfaceRequest['render']>>, required: true },
  resolve: { type: Function as PropType<ExternalSurfaceRenderContext['resolve']>, required: true },
  close: { type: Function as PropType<ExternalSurfaceRenderContext['close']>, required: true },
});

const container = ref<HTMLElement | null>(null);
let destroyFn: (() => void) | null = null;

function mount() {
  cleanup();
  if (!container.value || !props.render) return;

  const result = props.render({
    container: container.value,
    surfaceId: props.surfaceId,
    mode: props.mode,
    request: props.request,
    resolve: props.resolve,
    close: props.close,
  });

  destroyFn = result?.destroy ?? null;
}

function cleanup() {
  if (typeof destroyFn === 'function') {
    destroyFn();
  }
  destroyFn = null;

  if (container.value) {
    container.value.innerHTML = '';
  }
}

onMounted(mount);
onBeforeUnmount(cleanup);

watch(
  () => props.surfaceId,
  () => {
    mount();
  },
);
</script>

<template>
  <div ref="container" class="sd-surface-external-mount" />
</template>

<style scoped>
.sd-surface-external-mount {
  width: 100%;
}
</style>
