<script setup lang="ts">
import { ref, computed, watch, markRaw } from 'vue';
import type { PropType } from 'vue';
import type { PDFPageProxy } from 'pdfjs-dist';
import { floor } from '../../core/pdf/helpers/floor';
import { readFileAsArrayBuffer } from '../../core/pdf/helpers/read-file';
import { OUTPUT_SCALE } from '../../core/pdf/helpers/constants';
import { isFiniteNumber } from '../../helpers/is-finite-number.js';
import { PDFAdapterFactory, createPDFConfig } from '../../core/pdf/pdf-adapter';
import PdfViewerDocument from './PdfViewerDocument.vue';
import type {
  PdfPageRenderedPayload,
  PdfSelectionRawPayload,
  PdfViewerConfig,
  PdfViewerDocumentData,
  PdfViewerPageData,
} from './pdf-viewer-types';

const emit = defineEmits([
  'page-rendered',
  'pages-loaded',
  'document-loaded',
  'document-ready',
  'document-error',
  'selection-raw',
  'bypass-selection',
]);

const props = defineProps({
  config: {
    type: Object as PropType<PdfViewerConfig>,
    required: true,
  },
  file: {
    type: Object as PropType<Blob | null>,
    required: true,
  },
  fileId: {
    type: String,
  },
  /**
   * Zoom scale to render the first paint at (1 = 100%). The host seeds
   * this from `config.zoom.initial` so a PDF never flashes 100% before
   * a watcher catches up; later changes still arrive via updateScale().
   */
  initialScale: {
    type: Number,
    default: 1,
  },
});

function requirePdfLib(config: PdfViewerConfig) {
  const { pdfLib } = config;
  if (!pdfLib) throw new TypeError('PdfViewer requires modules.pdf.pdfLib');
  return markRaw(pdfLib);
}

const pdfConfig = createPDFConfig({
  pdfLib: requirePdfLib(props.config),
  workerSrc: props.config.workerSrc,
  setWorker: props.config.setWorker,
});

const pdfAdapter = PDFAdapterFactory.create(pdfConfig);

const rootRef = ref<HTMLDivElement | null>(null);
const documentRef = ref<InstanceType<typeof PdfViewerDocument> | null>(null);

const pdf = ref<PdfViewerDocumentData | null>(null);
const pages = ref<PdfViewerPageData[]>([]);
// Zoom scale, seeded from the host's initial zoom (rounded the same way
// updateScale rounds) so the first render already matches getZoom().
const scale = ref(isFiniteNumber(props.initialScale) && props.initialScale > 0 ? floor(props.initialScale, 2) : 1);
const totalPages = ref(0);
const renderedPages = ref(0);

const hasTextLayer = computed(() => props.config?.textLayer === true);
const outputScale = computed(() => props.config?.outputScale ?? OUTPUT_SCALE);

function onPageRendered(payload: PdfPageRenderedPayload) {
  const page = payload?.page;
  if (page) page.pageIsRendered = true;
  checkDocumentReady();
  emit('page-rendered', payload);
}

function onSelectionRaw(payload: PdfSelectionRawPayload) {
  emit('selection-raw', payload);
}

function onBypassSelection(event: MouseEvent) {
  emit('bypass-selection', event);
}

function checkDocumentReady() {
  if (totalPages.value <= 0) return;
  renderedPages.value += 1;
  if (renderedPages.value >= totalPages.value) {
    emit('document-ready', {
      documentId: pdf.value?.documentId,
      viewerContainer: rootRef.value,
    });
  }
}

function updatePages(nextPages: PdfViewerPageData[]) {
  pages.value = nextPages;
  totalPages.value = nextPages.length;
  renderedPages.value = 0;
}

function updateScale(nextScale: number) {
  const roundedScale = floor(nextScale, 2);
  scale.value = roundedScale;
}

defineExpose({
  updateScale,
});

async function getDocument(file: Blob | null) {
  if (!file) return;

  try {
    const result = await readFileAsArrayBuffer(file);
    const documentId = props.fileId || generateDocumentId('document');
    const pdfjsDocument = await pdfAdapter.getDocument(result);

    pdf.value = {
      documentId,
      pdfjsDocument: markRaw(pdfjsDocument),
    };

    emit('document-loaded', file);
  } catch (e) {
    emit('document-error', e);
    console.error(e);
  }
}

async function getPages() {
  if (!pdf.value) return;

  const { pdfjsDocument } = pdf.value;
  const firstPageNum = 1;
  const lastPageNum = pdfjsDocument.numPages;

  try {
    const pdfjsPages = await pdfAdapter.getPages(pdfjsDocument, firstPageNum, lastPageNum);

    const mapPages = (pdfjsPage: PDFPageProxy): PdfViewerPageData => {
      const currentPdf = pdf.value;
      if (!currentPdf) throw new TypeError('PdfViewer has no document to map pages for');
      return {
        documentId: currentPdf.documentId,
        pageId: generatePageId(currentPdf.documentId, pdfjsPage.pageNumber),
        pageNumber: pdfjsPage.pageNumber,
        pageIsRendered: false,
        pdfjsPage: markRaw(pdfjsPage),
      };
    };
    const pages = pdfjsPages.map(mapPages);

    updatePages(pages);
    emit('pages-loaded', pages);
  } catch (e) {
    emit('document-error', e);
    console.error(e);
  }
}

function resetValues() {
  pages.value = [];
  scale.value = 1;
}

function generateDocumentId(fileName: string) {
  return `pdf-${fileName.replace(/\W/g, '')}-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

function generatePageId(documentId: string, pageNumber: number) {
  return `${documentId}-page-${pageNumber}`;
}

watch(
  () => props.file,
  (file) => {
    getDocument(file);
  },
  { immediate: true },
);

watch(pdf, (nextPdf, oldPdf) => {
  if (!nextPdf) return;
  if (oldPdf) resetValues();
  getPages();
});
</script>

<template>
  <div class="sd-pdf-viewer" ref="rootRef">
    <div class="sd-pdf-viewer__main">
      <PdfViewerDocument
        v-bind="{
          pdf,
          pages,
          scale,
          config,
          hasTextLayer,
          outputScale,
        }"
        @page-rendered="onPageRendered"
        @selection-raw="onSelectionRaw"
        @bypass-selection="onBypassSelection"
        ref="documentRef"
      >
      </PdfViewerDocument>
    </div>
  </div>
</template>

<style scoped>
.sd-pdf-viewer {
  width: 100%;
  position: relative;
}

.sd-pdf-viewer__main {
  width: 100%;
}
</style>
