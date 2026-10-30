<script setup>
import { ref, computed, watch, markRaw } from 'vue';
import { floor } from '../../core/pdf/helpers/floor';
import { readFileAsArrayBuffer } from '../../core/pdf/helpers/read-file';
import { OUTPUT_SCALE } from '../../core/pdf/helpers/constants';
import { isFiniteNumber } from '../../helpers/is-finite-number.js';
import { PDFAdapterFactory, createPDFConfig } from '../../core/pdf/pdf-adapter';
import PdfViewerDocument from './PdfViewerDocument.vue';

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
    type: Object,
    required: true,
  },
  file: {
    type: Object,
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

const pdfConfig = createPDFConfig({
  pdfLib: markRaw(props.config.pdfLib),
  workerSrc: props.config.workerSrc,
  setWorker: props.config.setWorker,
});

const pdfAdapter = PDFAdapterFactory.create(pdfConfig);

const rootRef = ref(null);
const documentRef = ref(null);

const pdf = ref(null);
const pages = ref([]);
// Zoom scale, seeded from the host's initial zoom (rounded the same way
// updateScale rounds) so the first render already matches getZoom().
const scale = ref(isFiniteNumber(props.initialScale) && props.initialScale > 0 ? floor(props.initialScale, 2) : 1);
const totalPages = ref(0);
const renderedPages = ref(0);

const hasTextLayer = computed(() => props.config?.textLayer === true);
const outputScale = computed(() => props.config?.outputScale ?? OUTPUT_SCALE);

function onPageRendered(payload) {
  const page = payload?.page;
  if (page) page.pageIsRendered = true;
  checkDocumentReady();
  emit('page-rendered', payload);
}

function onSelectionRaw(payload) {
  emit('selection-raw', payload);
}

function onBypassSelection(event) {
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

function updatePages(nextPages) {
  pages.value = nextPages;
  totalPages.value = nextPages.length;
  renderedPages.value = 0;
}

function updateScale(nextScale) {
  const roundedScale = floor(nextScale, 2);
  scale.value = roundedScale;
}

defineExpose({
  updateScale,
});

async function getDocument(file) {
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

    const mapPages = (pdfjsPage) => {
      return {
        documentId: pdf.value.documentId,
        pageId: generatePageId(pdf.value.documentId, pdfjsPage.pageNumber),
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

function generateDocumentId(fileName) {
  return `pdf-${fileName.replace(/\W/g, '')}-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

function generatePageId(documentId, pageNumber) {
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
