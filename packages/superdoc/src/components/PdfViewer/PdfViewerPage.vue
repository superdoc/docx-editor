<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { PropType } from 'vue';
import type { PageViewport, RenderTask } from 'pdfjs-dist';
import { OUTPUT_SCALE, PDF_TO_CSS_UNITS } from '../../core/pdf/helpers/constants';
import type { PdfViewerConfig, PdfViewerPageData } from './pdf-viewer-types';

const emit = defineEmits([
  'page-rendered',
  'page-error',
  'text-layer-rendered',
  'text-layer-error',
  'selection-raw',
  'bypass-selection',
]);

const props = defineProps({
  config: {
    type: Object as PropType<PdfViewerConfig>,
    required: true,
  },
  page: {
    type: Object as PropType<PdfViewerPageData>,
    required: true,
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
    default: OUTPUT_SCALE,
  },
  documentEl: {
    type: Object as PropType<HTMLElement | null>,
    default: null,
  },
});

const viewport = shallowRef<PageViewport>(createInitialViewport());
const pageRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const textLayerRef = ref<HTMLDivElement | null>(null);

let renderTask: RenderTask | null = null;

const pageIdx = computed(() => props.pages.findIndex((page) => page.pageId === props.page.pageId));
const pageNumber = computed(() => {
  if (pageIdx.value === -1) return 0;
  return pageIdx.value + 1;
});

function getSelectedTextBoundingBox(container: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  const rects = range.getClientRects();
  if (!rects.length) return null;

  const containerRect = container.getBoundingClientRect();
  const scale = props.scale ?? 1;
  const firstRect = rects[0];
  let boundingBox = {
    top: firstRect.top,
    left: firstRect.left,
    bottom: firstRect.bottom,
    right: firstRect.right,
  };

  for (let i = 1; i < rects.length; i += 1) {
    const rect = rects[i];
    if (rect.width === 0 || rect.height === 0) {
      continue;
    }
    boundingBox.top = Math.min(boundingBox.top, rect.top);
    boundingBox.left = Math.min(boundingBox.left, rect.left);
    boundingBox.bottom = Math.max(boundingBox.bottom, rect.bottom);
    boundingBox.right = Math.max(boundingBox.right, rect.right);
  }

  return {
    top: (boundingBox.top - containerRect.top) / scale + container.scrollTop,
    left: (boundingBox.left - containerRect.left) / scale + container.scrollLeft,
    bottom: (boundingBox.bottom - containerRect.top) / scale + container.scrollTop,
    right: (boundingBox.right - containerRect.left) / scale + container.scrollLeft,
  };
}

const pageSize = computed(() => {
  let { width, height } = viewport.value;
  [width, height] = [width, height].map((dim) => Math.ceil(dim));
  return { width, height };
});

const canvasAttrs = computed(() => {
  const { width, height } = pageSize.value;
  return { width, height };
});

const pageStyle = computed(() => {
  const { width: widthPt, height: heightPt } = getPagePtSize();
  const scaleFactor = getScaleFactor();
  return {
    '--scale-factor': `${scaleFactor}`,
    width: `calc(var(--scale-factor) * ${widthPt}px)`,
    height: `calc(var(--scale-factor) * ${heightPt}px)`,
  };
});

function onMouseUp() {
  const selection = window.getSelection();
  if (!selection || selection.toString().length === 0) return;
  const container = props.documentEl ?? pageRef.value;
  if (!container) return;
  const bounds = getSelectedTextBoundingBox(container);
  if (!bounds) return;
  emit('selection-raw', {
    selectionBounds: bounds,
    documentId: props.page.documentId,
    page: pageNumber.value,
    source: 'pdf',
  });
}

function onMouseDown(event: MouseEvent) {
  if (!event?.target) return;
  if (!(event.target instanceof Element) || event.target.tagName !== 'SPAN') {
    emit('bypass-selection', event);
  }
}

function getPagePtSize() {
  const factor = PDF_TO_CSS_UNITS * props.outputScale;
  let { width, height } = viewport.value;
  width = width / factor;
  height = height / factor;
  [width, height] = [width, height].map((dim) => Math.ceil(dim));
  return { width, height };
}

function getPageSize() {
  const { width: widthPt, height: heightPt } = getPagePtSize();
  const scaleFactor = getScaleFactor();
  return {
    width: widthPt * scaleFactor,
    height: heightPt * scaleFactor,
  };
}

function getScaleFactor() {
  return (props.scale ?? 1) * PDF_TO_CSS_UNITS;
}

function createInitialViewport() {
  const { pdfjsPage } = props.page;
  return pdfjsPage.getViewport({ scale: PDF_TO_CSS_UNITS * props.outputScale });
}

async function renderPage() {
  if (renderTask) return;

  const canvasElem = canvasRef.value;
  if (!canvasElem || !viewport.value) return;

  const renderContext = { canvas: canvasElem, viewport: viewport.value };

  try {
    const { pdfjsPage } = props.page;
    renderTask = pdfjsPage.render(renderContext);
    await renderTask.promise;

    const size = getPageSize();
    const originalPt = getPagePtSize();

    const payload = {
      page: props.page,
      documentId: props.page.documentId,
      pageIndex: pageIdx.value,
      pageNumber: pageNumber.value,
      width: size.width,
      height: size.height,
      originalWidth: originalPt.width * PDF_TO_CSS_UNITS,
      originalHeight: originalPt.height * PDF_TO_CSS_UNITS,
    };

    emit('page-rendered', payload);
  } catch (e) {
    destroyRenderTask();
    emit('page-error', props.page);
  }
}

async function renderTextLayer() {
  if (!props.hasTextLayer) return;

  const container = textLayerRef.value;
  if (!container) return;

  container.innerHTML = '';

  const TextLayer = props.config?.pdfLib?.TextLayer;
  if (!TextLayer) return;

  try {
    const scale = (props.scale ?? 1) * PDF_TO_CSS_UNITS;
    const textViewport = props.page.pdfjsPage.getViewport({ scale });
    const textContent = await props.page.pdfjsPage.getTextContent();

    const textLayer = new TextLayer({
      textContentSource: textContent,
      container,
      viewport: textViewport,
    });

    await textLayer.render();
    emit('text-layer-rendered', props.page);
  } catch (e) {
    emit('text-layer-error', props.page);
    console.error(e);
  }
}

async function render() {
  await renderPage();
  await renderTextLayer();
}

function destroyPage(page: PdfViewerPageData) {
  if (page?.pdfjsPage) page.pdfjsPage.cleanup();
  destroyRenderTask();
}

function destroyRenderTask() {
  if (!renderTask) return;
  renderTask.cancel();
  renderTask = null;
}

watch(
  () => props.scale,
  () => {
    renderTextLayer();
  },
);

onMounted(() => {
  render();
});

onBeforeUnmount(() => {
  destroyPage(props.page);
});
</script>

<template>
  <div
    class="sd-pdf-viewer-page"
    :data-page-id="page.pageId"
    :data-page-number="pageNumber"
    :style="pageStyle"
    data-pdf-page
    ref="pageRef"
    @mousedown="onMouseDown"
    @mouseup="onMouseUp"
  >
    <div class="sd-pdf-viewer-page__canvas-wrapper">
      <canvas class="sd-pdf-viewer-page__canvas" v-bind="canvasAttrs" ref="canvasRef"> </canvas>
    </div>
    <div class="sd-pdf-viewer-page__text-layer" v-if="hasTextLayer" ref="textLayerRef"></div>
  </div>
</template>

<style scoped>
.sd-pdf-viewer-page {
  --user-unit: 1;
  --total-scale-factor: calc(var(--scale-factor) * var(--user-unit));
  --scale-round-x: 1px;
  --scale-round-y: 1px;

  width: 816px;
  height: 1056px;
  /* margin: 1px auto -8px; */
  position: relative;
  overflow: visible;
  /* border: 9px solid transparent; */
  background-clip: content-box;
  background-color: #fff;
  box-sizing: content-box;
  margin: 0 0 calc(var(--scale-factor) * 10px);
}

.sd-pdf-viewer-page:last-child {
  margin: 0;
}

.sd-pdf-viewer-page__canvas-wrapper {
  overflow: hidden;
  width: 100%;
  height: 100%;
}

.sd-pdf-viewer-page__canvas {
  position: absolute;
  top: 0;
  left: 0;
  display: block;
  margin: 0;
  width: 100%;
  height: 100%;
  contain: content;
}
</style>

<style>
/* Text layer style */
.sd-pdf-viewer-page__text-layer {
  --csstools-color-scheme--light: initial;
  color-scheme: only light;

  position: absolute;
  text-align: initial;
  inset: 0;
  overflow: clip;
  opacity: 1;
  line-height: 1;
  -webkit-text-size-adjust: none;
  -moz-text-size-adjust: none;
  text-size-adjust: none;
  forced-color-adjust: none;
  transform-origin: 0 0;
  caret-color: CanvasText;
  z-index: 0;
}

.sd-pdf-viewer-page__text-layer.highlighting {
  touch-action: none;
}

.sd-pdf-viewer-page__text-layer :is(span, br) {
  color: transparent;
  position: absolute;
  white-space: pre;
  cursor: text;
  transform-origin: 0% 0%;
}

.sd-pdf-viewer-page__text-layer {
  --min-font-size: 1;
  --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
  --min-font-size-inv: calc(1 / var(--min-font-size));
}

.sd-pdf-viewer-page__text-layer > :not(.markedContent),
.sd-pdf-viewer-page__text-layer .markedContent span:not(.markedContent) {
  z-index: 1;

  --font-height: 0;
  font-size: calc(var(--text-scale-factor) * var(--font-height));

  --scale-x: 1;
  --rotate: 0deg;
  transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
}

.sd-pdf-viewer-page__text-layer .markedContent {
  display: contents;
}

.sd-pdf-viewer-page__text-layer span[role='img'] {
  -webkit-user-select: none;
  -moz-user-select: none;
  user-select: none;
  cursor: default;
}

.sd-pdf-viewer-page__text-layer .highlight {
  --highlight-bg-color: rgb(180 0 170 / 0.25);
  --highlight-selected-bg-color: rgb(0 100 0 / 0.25);
  --highlight-backdrop-filter: none;
  --highlight-selected-backdrop-filter: none;
}

@media screen and (forced-colors: active) {
  .sd-pdf-viewer-page__text-layer.highlight {
    --highlight-bg-color: transparent;
    --highlight-selected-bg-color: transparent;
    --highlight-backdrop-filter: var(--hcm-highlight-filter);
    --highlight-selected-backdrop-filter: var(--hcm-highlight-selected-filter);
  }
}

.sd-pdf-viewer-page__text-layer .highlight {
  margin: -1px;
  padding: 1px;
  background-color: var(--highlight-bg-color);
  -webkit-backdrop-filter: var(--highlight-backdrop-filter);
  backdrop-filter: var(--highlight-backdrop-filter);
  border-radius: 4px;
}

.appended:is(.sd-pdf-viewer-page__text-layer .highlight) {
  position: initial;
}

.begin:is(.sd-pdf-viewer-page__text-layer .highlight) {
  border-radius: 4px 0 0 4px;
}

.end:is(.sd-pdf-viewer-page__text-layer .highlight) {
  border-radius: 0 4px 4px 0;
}

.middle:is(.sd-pdf-viewer-page__text-layer .highlight) {
  border-radius: 0;
}

.selected:is(.sd-pdf-viewer-page__text-layer .highlight) {
  background-color: var(--highlight-selected-bg-color);
  -webkit-backdrop-filter: var(--highlight-selected-backdrop-filter);
  backdrop-filter: var(--highlight-selected-backdrop-filter);
}

.sd-pdf-viewer-page__text-layer ::-moz-selection {
  background: rgba(0 0 255 / 0.25);
  background: color-mix(in srgb, AccentColor, transparent 75%);
}

.sd-pdf-viewer-page__text-layer ::selection {
  background: rgba(0 0 255 / 0.25);
  background: color-mix(in srgb, AccentColor, transparent 75%);
}

.sd-pdf-viewer-page__text-layer br::-moz-selection {
  background: transparent;
}

.sd-pdf-viewer-page__text-layer br::selection {
  background: transparent;
}

.sd-pdf-viewer-page__text-layer .endOfContent {
  display: block;
  position: absolute;
  inset: 100% 0 0;
  z-index: 0;
  cursor: default;
  -webkit-user-select: none;
  -moz-user-select: none;
  user-select: none;
}

.textLayer.selecting .endOfContent {
  top: 0;
}
</style>
