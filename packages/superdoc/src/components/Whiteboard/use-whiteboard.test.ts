import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';
import { defineComponent, ref, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { useWhiteboard } from './use-whiteboard.js';

const PDF_TYPE = 'application/pdf';

const makeWhiteboardStub = () => {
  const handlers = new Map();
  const pageInstances = [];
  return {
    on: vi.fn((event, fn) => {
      handlers.set(event, fn);
    }),
    off: vi.fn(),
    setPageSize: vi.fn(),
    getPage: vi.fn((i) => pageInstances.find((p) => p.pageIndex === i)),
    getPages: vi.fn(() => pageInstances),
    // test helpers
    __emit(event, payload) {
      handlers.get(event)?.(payload);
    },
    __pages: pageInstances,
  };
};

const makePageInstance = (index) => ({
  pageIndex: index,
  size: null,
  setSize: vi.fn(function (s) {
    this.size = s;
  }),
});

const mountWithComposable = (inputs) => {
  let exposed;
  const TestComp = defineComponent({
    setup() {
      exposed = useWhiteboard(inputs);
      return () => h('div');
    },
  });
  const proxy = inputs.proxy;
  // Wire proxy.$superdoc to the computed $superdoc emitter
  const wrapper = mount(TestComp);
  return { wrapper, exposed: () => exposed, proxy };
};

describe('useWhiteboard', () => {
  let whiteboard;
  let emitSpy;
  let proxy;
  let layers;
  let documents;

  beforeEach(() => {
    whiteboard = makeWhiteboardStub();
    emitSpy = vi.fn();
    proxy = { $superdoc: { emit: emitSpy, whiteboard } };
    layers = ref({
      getBoundingClientRect: () => ({ top: 0, left: 0 }),
    });
    documents = ref([{ id: 'doc-1', type: PDF_TYPE }]);
  });

  it('initializes with defaults when whiteboard module is disabled', () => {
    const noWbProxy = { $superdoc: { emit: emitSpy } };
    const { exposed } = mountWithComposable({
      proxy: noWbProxy,
      layers,
      documents,
      modules: { whiteboard: false },
    });
    const res = exposed();
    expect(res.whiteboardEnabled.value).toBe(false);
    expect(res.whiteboardReady.value).toBe(false);
    expect(res.whiteboardPages.value).toEqual([]);
  });

  it('reads enabled from module config when provided', () => {
    const { exposed } = mountWithComposable({
      proxy,
      layers,
      documents,
      modules: { whiteboard: { enabled: true } },
    });
    expect(exposed().whiteboardEnabled.value).toBe(true);
  });

  it('subscribes to whiteboard events when whiteboard is present', () => {
    mountWithComposable({ proxy, layers, documents, modules: {} });
    expect(whiteboard.on).toHaveBeenCalledWith('change', expect.any(Function));
    expect(whiteboard.on).toHaveBeenCalledWith('setData', expect.any(Function));
    expect(whiteboard.on).toHaveBeenCalledWith('enabled', expect.any(Function));
    expect(whiteboard.on).toHaveBeenCalledWith('opacity', expect.any(Function));
    expect(whiteboard.on).toHaveBeenCalledWith('tool', expect.any(Function));
  });

  it('unsubscribes whiteboard events on unmount', () => {
    const { wrapper } = mountWithComposable({ proxy, layers, documents, modules: {} });
    wrapper.unmount();
    expect(whiteboard.off).toHaveBeenCalledWith('change', expect.any(Function));
    expect(whiteboard.off).toHaveBeenCalledWith('setData', expect.any(Function));
    expect(whiteboard.off).toHaveBeenCalledWith('enabled', expect.any(Function));
    expect(whiteboard.off).toHaveBeenCalledWith('opacity', expect.any(Function));
    expect(whiteboard.off).toHaveBeenCalledWith('tool', expect.any(Function));
  });

  describe('event re-emission', () => {
    it('re-emits "change" on $superdoc', () => {
      mountWithComposable({ proxy, layers, documents, modules: {} });
      whiteboard.__emit('change', { action: 'draw' });
      expect(emitSpy).toHaveBeenCalledWith('whiteboard:change', { action: 'draw' });
    });

    it('re-emits "enabled" on $superdoc and updates state', () => {
      const { exposed } = mountWithComposable({
        proxy,
        layers,
        documents,
        modules: {},
      });
      whiteboard.__emit('enabled', true);
      expect(emitSpy).toHaveBeenCalledWith('whiteboard:enabled', true);
      expect(exposed().whiteboardEnabled.value).toBe(true);
    });

    it('updates opacity from opacity event', () => {
      const { exposed } = mountWithComposable({
        proxy,
        layers,
        documents,
        modules: {},
      });
      whiteboard.__emit('opacity', 0.5);
      expect(exposed().whiteboardOpacity.value).toBe(0.5);
    });

    it('re-emits "tool" on $superdoc', () => {
      mountWithComposable({ proxy, layers, documents, modules: {} });
      whiteboard.__emit('tool', 'pen');
      expect(emitSpy).toHaveBeenCalledWith('whiteboard:tool', 'pen');
    });
  });

  describe('handleWhiteboardPageReady', () => {
    it('does nothing when payload is falsy', () => {
      const { exposed } = mountWithComposable({ proxy, layers, documents, modules: {} });
      exposed().handleWhiteboardPageReady(null);
      expect(whiteboard.setPageSize).not.toHaveBeenCalled();
    });

    it('records page sizes and refreshes page list for PDF documents', async () => {
      whiteboard.__pages.push(makePageInstance(0));
      const { exposed } = mountWithComposable({
        proxy,
        layers,
        documents,
        modules: {},
      });
      exposed().handleWhiteboardPageReady({
        pageIndex: 0,
        width: 200,
        height: 300,
        originalWidth: 100,
        originalHeight: 150,
      });
      expect(whiteboard.setPageSize).toHaveBeenCalledWith(0, {
        width: 200,
        height: 300,
        originalWidth: 100,
        originalHeight: 150,
      });
      expect(exposed().whiteboardPageSizes[0]).toEqual({
        width: 200,
        height: 300,
        originalWidth: 100,
        originalHeight: 150,
      });
      await nextTick();
      expect(exposed().whiteboardPages.value).toHaveLength(1);
    });

    it('never becomes ready when $superdoc has no whiteboard', async () => {
      const noWbProxy = { $superdoc: { emit: emitSpy } };
      const { exposed } = mountWithComposable({
        proxy: noWbProxy,
        layers,
        documents,
        modules: { whiteboard: { enabled: true } },
      });
      exposed().handleWhiteboardPageReady({ pageIndex: 0, width: 200, height: 300 });
      exposed().handleWhiteboardPageReady({ pageIndex: 1, width: 200, height: 300 });
      await nextTick();
      expect(exposed().whiteboardReady.value).toBe(false);
      expect(emitSpy).not.toHaveBeenCalledWith('whiteboard:ready', expect.anything());
    });

    it('skips PDF handling when no documents are available', () => {
      documents.value = [];
      const { exposed } = mountWithComposable({ proxy, layers, documents, modules: {} });
      exposed().handleWhiteboardPageReady({ pageIndex: 0, width: 10, height: 10 });
      expect(whiteboard.setPageSize).not.toHaveBeenCalled();
    });
  });

  describe('updateWhiteboardPageSizes', () => {
    it('is a no-op when documents is empty', () => {
      documents.value = [];
      const { exposed } = mountWithComposable({ proxy, layers, documents, modules: {} });
      expect(() => exposed().updateWhiteboardPageSizes()).not.toThrow();
    });
  });

  describe('updateWhiteboardPageOffsets', () => {
    it('is a no-op when layers ref is empty', () => {
      layers.value = null;
      const { exposed } = mountWithComposable({ proxy, layers, documents, modules: {} });
      expect(() => exposed().updateWhiteboardPageOffsets()).not.toThrow();
    });
  });
});
