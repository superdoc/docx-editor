import { describe, it, expect, vi, afterEach } from 'vite-plus/test';
import { defineComponent, h, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { DOCX } from '@superdoc/common';
import { EventEmitter } from '../core/EventEmitter.js';
import { useViewportFit } from './use-viewport-fit.js';

const createSuperdoc = (fitWidth) => {
  const superdoc = new EventEmitter();
  superdoc.config = { zoom: { fitWidth } };
  superdoc.activeEditor = null;
  vi.spyOn(superdoc, 'emit');
  return superdoc;
};

const createDocument = (pageWidthInches) => {
  const editor = { getPageStyles: () => ({ pageSize: { width: pageWidthInches.value } }) };
  return { type: DOCX, getEditor: () => editor };
};

const emitted = (superdoc, name) => superdoc.emit.mock.calls.filter(([event]) => event === name).map(([, p]) => p);

const mounted = [];

const mountViewportFit = ({ fitWidth, ready = true, containerWidth = 0 } = {}) => {
  const pageWidthInches = ref(8.5);
  const superdoc = createSuperdoc(fitWidth);
  const state = {
    superdoc,
    pageWidthInches,
    superdocContainerWidth: ref(containerWidth),
    isReady: ref(ready),
    activeZoom: ref(100),
    zoomMode: ref('manual'),
    viewportMetrics: ref(null),
    showCommentsSidebar: ref(false),
    rightSidebarRef: ref(null),
    superdocRoot: ref(document.createElement('div')),
    documents: ref([createDocument(pageWidthInches)]),
  };
  const Harness = defineComponent({
    setup() {
      useViewportFit({
        getSuperdoc: () => superdoc,
        superdocContainerWidth: state.superdocContainerWidth,
        isReady: state.isReady,
        activeZoom: state.activeZoom,
        zoomMode: state.zoomMode,
        viewportMetrics: state.viewportMetrics,
        showCommentsSidebar: state.showCommentsSidebar,
        rightSidebarRef: state.rightSidebarRef,
        superdocRoot: state.superdocRoot,
        documents: state.documents,
      });
      return () => h('div');
    },
  });
  const wrapper = mount(Harness);
  mounted.push(wrapper);
  return { ...state, wrapper };
};

const settle = async () => {
  await nextTick();
  await nextTick();
};

describe('useViewportFit wiring', () => {
  afterEach(() => {
    while (mounted.length) mounted.pop().unmount();
    vi.restoreAllMocks();
  });

  it('stores the metrics and emits viewport-change when the container width changes', async () => {
    const state = mountViewportFit();

    state.superdocContainerWidth.value = 1000;
    await settle();

    expect(state.viewportMetrics.value).toEqual({ availableWidth: 1000, documentWidth: 816, fitZoom: 123 });
    expect(Object.isFrozen(state.viewportMetrics.value)).toBe(true);
    expect(emitted(state.superdoc, 'viewport-change')).toEqual([
      { availableWidth: 1000, documentWidth: 816, fitZoom: 123 },
    ]);
  });

  it('refreshes stored metrics without re-emitting when the fit does not change', async () => {
    const state = mountViewportFit();
    state.superdocContainerWidth.value = 1000;
    await settle();

    state.superdocContainerWidth.value = 1001;
    await settle();
    state.superdocContainerWidth.value = 1000;
    await settle();
    state.superdocContainerWidth.value = 1001;
    await settle();

    expect(state.viewportMetrics.value).toEqual({ availableWidth: 1001, documentWidth: 816, fitZoom: 123 });
    expect(emitted(state.superdoc, 'viewport-change')).toHaveLength(1);

    state.superdocContainerWidth.value = 600;
    await settle();

    expect(emitted(state.superdoc, 'viewport-change')).toEqual([
      { availableWidth: 1000, documentWidth: 816, fitZoom: 123 },
      { availableWidth: 600, documentWidth: 816, fitZoom: 74 },
    ]);
  });

  it('evaluates once the store becomes ready', async () => {
    const state = mountViewportFit({ ready: false, containerWidth: 1000 });
    expect(state.viewportMetrics.value).toBeNull();

    state.isReady.value = true;
    await settle();

    expect(state.viewportMetrics.value).toEqual({ availableWidth: 1000, documentWidth: 816, fitZoom: 123 });
  });

  it('applies the clamped fit when the mode becomes fit-width, and not before', async () => {
    const state = mountViewportFit({ fitWidth: { min: 35, max: 100 } });
    state.superdocContainerWidth.value = 600;
    await settle();
    expect(state.activeZoom.value).toBe(100);
    expect(emitted(state.superdoc, 'zoomChange')).toEqual([]);

    state.zoomMode.value = 'fit-width';
    await settle();

    expect(state.activeZoom.value).toBe(74);
    expect(emitted(state.superdoc, 'zoomChange')).toEqual([{ zoom: 74, mode: 'fit-width' }]);

    state.superdocContainerWidth.value = 1200;
    await settle();

    expect(state.activeZoom.value).toBe(100);
    expect(emitted(state.superdoc, 'zoomChange')).toEqual([
      { zoom: 74, mode: 'fit-width' },
      { zoom: 100, mode: 'fit-width' },
    ]);
  });

  it('subtracts the visible comments sidebar from the available width', async () => {
    const state = mountViewportFit();
    const sidebar = document.createElement('div');
    Object.defineProperty(sidebar, 'offsetWidth', { configurable: true, get: () => 320 });
    state.rightSidebarRef.value = sidebar;
    state.superdocContainerWidth.value = 1000;
    await settle();

    state.showCommentsSidebar.value = true;
    await settle();

    expect(state.viewportMetrics.value).toEqual({ availableWidth: 680, documentWidth: 816, fitZoom: 83 });
  });

  it('re-measures on pagination-update and stops listening after unmount', async () => {
    const state = mountViewportFit();
    state.superdocContainerWidth.value = 1000;
    await settle();

    state.pageWidthInches.value = 11;
    state.superdoc.emit('pagination-update', {});
    await settle();

    expect(state.viewportMetrics.value).toEqual({ availableWidth: 1000, documentWidth: 1056, fitZoom: 95 });

    state.wrapper.unmount();
    mounted.splice(mounted.indexOf(state.wrapper), 1);
    state.pageWidthInches.value = 8.5;
    state.superdoc.emit('pagination-update', {});
    await settle();

    expect(state.viewportMetrics.value).toEqual({ availableWidth: 1000, documentWidth: 1056, fitZoom: 95 });
  });
});
