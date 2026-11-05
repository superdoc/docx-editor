import { computed, nextTick, onBeforeUnmount, reactive, ref, shallowRef, markRaw } from 'vue';
import type { Ref } from 'vue';
import { PDF } from '@superdoc/common';
import type { EventEmitter } from '../../core/EventEmitter';
import type { Document, Modules } from '../../core/types/index.js';
import type {
  Whiteboard,
  WhiteboardData,
  WhiteboardEventMap,
  WhiteboardPageSize,
} from '../../core/whiteboard/Whiteboard';
import type { WhiteboardPage } from '../../core/whiteboard/WhiteboardPage';
import type { PdfPageRenderedPayload } from '../PdfViewer/pdf-viewer-types';
import type { WhiteboardPageOffset } from './whiteboard-types';

type WhiteboardDocument = Pick<Document, 'id' | 'type'>;

type WhiteboardPageReadyPayload = Pick<PdfPageRenderedPayload, 'pageIndex' | 'width' | 'height'> &
  Partial<Pick<PdfPageRenderedPayload, 'originalWidth' | 'originalHeight'>>;

type Bounds = Pick<DOMRect, 'top' | 'left'>;

type WhiteboardLayerElement = { getBoundingClientRect(): Bounds };

type WhiteboardPageSource = Pick<WhiteboardPage, 'pageIndex' | 'size' | 'setSize'>;

type WhiteboardSource = Pick<Whiteboard, 'on' | 'off' | 'setPageSize'> & {
  getPage(...args: Parameters<Whiteboard['getPage']>): WhiteboardPageSource | undefined;
  getPages(): WhiteboardPageSource[];
};

type WhiteboardSourcePage<Board extends WhiteboardSource> = ReturnType<Board['getPages']>[number];

type WhiteboardHostEvents<Board extends WhiteboardSource> = {
  'whiteboard:ready': [{ whiteboard: Board }];
  'whiteboard:change': WhiteboardEventMap['change'];
  'whiteboard:enabled': WhiteboardEventMap['enabled'];
  'whiteboard:tool': WhiteboardEventMap['tool'];
};

export type UseWhiteboardOptions<Board extends WhiteboardSource> = {
  proxy: {
    $superdoc: Pick<EventEmitter<WhiteboardHostEvents<Board>>, 'emit'> & { whiteboard?: Board | null };
  };
  layers: Ref<WhiteboardLayerElement | null>;
  documents: Ref<WhiteboardDocument[]>;
  modules: Modules;
};

type Options<Board extends WhiteboardSource> = UseWhiteboardOptions<Board>;

export const useWhiteboard = <B extends WhiteboardSource>({ proxy, layers, documents, modules }: Options<B>) => {
  const whiteboardModuleConfig = computed(() => {
    const config = modules.whiteboard;
    if (config === false || config == null) return null;
    return config;
  });

  const superdoc = proxy.$superdoc;
  const whiteboard = superdoc.whiteboard;

  // NOTE: whiteboardPages holds class instances; keep them raw to avoid Vue proxying.
  const whiteboardPages = shallowRef<WhiteboardSourcePage<B>[]>([]);
  const whiteboardPageSizes = reactive<Record<number, WhiteboardPageSize>>({});
  const whiteboardPageOffsets = reactive<Record<number, WhiteboardPageOffset>>({});

  const whiteboardReady = ref(false);
  const whiteboardReadyPages = ref(0);
  const whiteboardTotalPages = ref(0);

  const whiteboardOpacity = ref(1);
  const whiteboardEnabled = ref(whiteboardModuleConfig.value?.enabled ?? false);

  const checkWhiteboardReady = () => {
    if (whiteboardReady.value) return;
    whiteboardReadyPages.value += 1;
    const total = whiteboardTotalPages.value || whiteboardPages.value.length;
    if (whiteboard && total && whiteboardReadyPages.value >= total) {
      whiteboardReady.value = true;
      superdoc.emit('whiteboard:ready', { whiteboard });
    }
  };

  const handleWhiteboardPageReady = (payload: WhiteboardPageReadyPayload | null | undefined) => {
    if (!payload) return;
    const doc = documents.value?.[0];
    if (!doc) return;
    if (doc.type === PDF) {
      handleWhiteboardPDFPageReady(payload);
    }
  };

  const handleWhiteboardPDFPageReady = (payload: WhiteboardPageReadyPayload) => {
    const { pageIndex, width, height, originalWidth, originalHeight } = payload;
    const size = { width, height, originalWidth, originalHeight };
    whiteboard?.setPageSize(pageIndex, size);
    whiteboardPageSizes[pageIndex] = size;
    const existingPage = whiteboard?.getPage(pageIndex);
    if (existingPage) {
      existingPage.setSize(size);
    }
    if (whiteboard) {
      whiteboardPages.value = whiteboard
        .getPages()
        .sort((a, b) => a.pageIndex - b.pageIndex)
        .map((page) => markRaw(page));
      whiteboardTotalPages.value = whiteboardPages.value.length;
    }
    void nextTick(() => {
      updateWhiteboardPageOffsets();
      checkWhiteboardReady();
    });
  };

  const handleWhiteboardChange = (data: WhiteboardData) => {
    superdoc.emit('whiteboard:change', data);
  };

  const handleWhiteboardSetData = (pages: WhiteboardSourcePage<B>[]) => {
    pages.forEach((page) => {
      const size = whiteboardPageSizes[page.pageIndex];
      if (size) page.setSize(size);
    });
    whiteboardPages.value = pages.map((page) => markRaw(page));
    whiteboardTotalPages.value = whiteboardPages.value.length;
    void nextTick(() => updateWhiteboardPageOffsets());
  };

  const handleWhiteboardEnabled = (enabled: boolean) => {
    whiteboardEnabled.value = enabled;
    superdoc.emit('whiteboard:enabled', enabled);
  };

  const handleWhiteboardOpacity = (opacity: number) => {
    whiteboardOpacity.value = opacity;
  };

  const handleWhiteboardTool = (tool: string) => {
    superdoc.emit('whiteboard:tool', tool);
  };

  const updateWhiteboardPageSizes = () => {
    const doc = documents.value?.[0];
    if (!doc) return;
    if (doc.type === PDF) {
      updateWhiteboardPDFPageSizes({ doc });
    }
  };

  const updateWhiteboardPDFPageSizes = ({ doc }: { doc: WhiteboardDocument }) => {
    whiteboardPages.value.forEach((page) => {
      const pageId = `${doc.id}-page-${page.pageIndex + 1}`;
      const pageEl = document.querySelector(`[data-page-id="${pageId}"]`);
      if (!pageEl) return;
      const pageBounds = pageEl.getBoundingClientRect();
      const existingSize: Partial<WhiteboardPageSize> = whiteboardPageSizes[page.pageIndex] || {};
      const originalWidth = existingSize.originalWidth ?? page.size?.originalWidth ?? pageBounds.width;
      const originalHeight = existingSize.originalHeight ?? page.size?.originalHeight ?? pageBounds.height;
      const size = {
        width: pageBounds.width,
        height: pageBounds.height,
        originalWidth,
        originalHeight,
      };
      whiteboardPageSizes[page.pageIndex] = size;
      page.setSize(size);
    });
  };

  // NOTE: Coordinates are currently absolute (not normalized to page size).
  const updateWhiteboardPageOffsets = () => {
    const layerBounds = layers.value?.getBoundingClientRect?.();
    if (!layerBounds) return;
    const doc = documents.value?.[0];
    if (!doc) return;
    if (doc.type === PDF) {
      updateWhiteboardPDFPageOffsets({ doc, layerBounds });
    }
  };

  const updateWhiteboardPDFPageOffsets = ({ doc, layerBounds }: { doc: WhiteboardDocument; layerBounds: Bounds }) => {
    whiteboardPages.value.forEach((page) => {
      const pageId = `${doc.id}-page-${page.pageIndex + 1}`;
      const pageEl = document.querySelector(`[data-page-id="${pageId}"]`);
      if (!pageEl) return;
      const pageBounds = pageEl.getBoundingClientRect();
      whiteboardPageOffsets[page.pageIndex] = {
        top: pageBounds.top - layerBounds.top,
        left: pageBounds.left - layerBounds.left,
      };
    });
  };

  if (whiteboard) {
    whiteboard.on('change', handleWhiteboardChange);
    whiteboard.on('setData', handleWhiteboardSetData);
    whiteboard.on('enabled', handleWhiteboardEnabled);
    whiteboard.on('opacity', handleWhiteboardOpacity);
    whiteboard.on('tool', handleWhiteboardTool);
  }

  onBeforeUnmount(() => {
    if (!whiteboard) return;
    whiteboard.off('change', handleWhiteboardChange);
    whiteboard.off('setData', handleWhiteboardSetData);
    whiteboard.off('opacity', handleWhiteboardOpacity);
    whiteboard.off('enabled', handleWhiteboardEnabled);
    whiteboard.off('tool', handleWhiteboardTool);
  });

  return {
    whiteboard,
    whiteboardModuleConfig,
    whiteboardPages,
    whiteboardPageSizes,
    whiteboardPageOffsets,
    whiteboardEnabled,
    whiteboardOpacity,
    whiteboardReady,
    handleWhiteboardPageReady,
    updateWhiteboardPageSizes,
    updateWhiteboardPageOffsets,
  };
};
