<script setup lang="ts">
import { ref } from 'vue';
import type { PropType } from 'vue';
import PdfViewerPage from './PdfViewerPage.vue';
import type {
  PdfPageRenderedPayload,
  PdfSelectionRawPayload,
  PdfViewerConfig,
  PdfViewerDocumentData,
  PdfViewerPageData,
} from './pdf-viewer-types';

const emit = defineEmits(['page-focus', 'page-rendered', 'page-error', 'selection-raw', 'bypass-selection']);

const props = defineProps({
  config: {
    type: Object as PropType<PdfViewerConfig>,
    required: true,
  },
  pdf: {
    type: Object as PropType<PdfViewerDocumentData | null>,
  },
  pages: {
    type: Array as PropType<PdfViewerPageData[]>,
    required: true,
  },
  scale: {
    type: Number,
    required: true,
  },
  hasTextLayer: {
    type: Boolean,
    default: false,
  },
  outputScale: {
    type: Number,
  },
});

const documentRef = ref<HTMLDivElement | null>(null);
const documentWrapper = ref<HTMLDivElement | null>(null);

function onPageFocused(pageNumber: number) {
  emit('page-focus', pageNumber);
}

function onPageRendered(payload: PdfPageRenderedPayload) {
  emit('page-rendered', payload);
}

function onPageError(page: PdfViewerPageData) {
  emit('page-error', page);
}

function onSelectionRaw(payload: PdfSelectionRawPayload) {
  emit('selection-raw', payload);
}

function onBypassSelection(event: MouseEvent) {
  emit('bypass-selection', event);
}
</script>

<template>
  <div class="sd-pdf-viewer-document" ref="documentRef">
    <div class="sd-pdf-viewer-document__wrapper" ref="documentWrapper">
      <PdfViewerPage
        v-for="page in pages"
        :key="page.pageId"
        v-bind="{
          page,
          pages,
          scale,
          config,
          hasTextLayer,
          outputScale,
          documentEl: documentRef,
        }"
        @page-rendered="onPageRendered"
        @page-error="onPageError"
        @selection-raw="onSelectionRaw"
        @bypass-selection="onBypassSelection"
      >
      </PdfViewerPage>
    </div>
  </div>
</template>

<style scoped>
.sd-pdf-viewer-document {
  position: relative;
  width: 100%;
}

.sd-pdf-viewer-document__wrapper {
  width: 100%;
  padding-bottom: 10px;
}
</style>
