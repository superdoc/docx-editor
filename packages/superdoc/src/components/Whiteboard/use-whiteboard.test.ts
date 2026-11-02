import { describe, it, expect, expectTypeOf, vi, beforeEach, type Mock } from 'vite-plus/test';
import { defineComponent, ref, h, nextTick, type Ref } from 'vue';
import { mount } from '@vue/test-utils';
import type { SuperDocComponentProxy } from '../../composables/use-superdoc-instance.js';
import type { Document, Modules } from '../../core/types/index.js';
import type { Whiteboard, WhiteboardPageSize } from '../../core/whiteboard/Whiteboard';
import type { WhiteboardPage } from '../../core/whiteboard/WhiteboardPage';
import { useWhiteboard, type UseWhiteboardOptions } from './use-whiteboard.js';

const PDF_TYPE = 'application/pdf';

type PageInstance = {
  pageIndex: number;
  size: WhiteboardPageSize | null;
  setSize: Mock<(s: WhiteboardPageSize) => void>;
};

type WhiteboardHandler = (payload: unknown) => void;

const makeWhiteboardStub = () => {
  const handlers = new Map<string, WhiteboardHandler>();
  const pageInstances: PageInstance[] = [];
  return {
    on: vi.fn((event: string, fn: WhiteboardHandler) => {
      handlers.set(event, fn);
    }),
    off: vi.fn(),
    setPageSize: vi.fn(),
    getPage: vi.fn((i: number) => pageInstances.find((p) => p.pageIndex === i)),
    getPages: vi.fn(() => pageInstances),
    // test helpers
    __emit(event: string, payload: unknown) {
      handlers.get(event)?.(payload);
    },
    __pages: pageInstances,
  };
};

type WhiteboardStub = ReturnType<typeof makeWhiteboardStub>;

type ComposableInputs = UseWhiteboardOptions<WhiteboardStub>;

const makePageInstance = (index: number): PageInstance => ({
  pageIndex: index,
  size: null,
  setSize: vi.fn(function (this: PageInstance, s: WhiteboardPageSize) {
    this.size = s;
  }),
});

const mountWithComposable = (inputs: ComposableInputs) => {
  let exposed: ReturnType<typeof useWhiteboard<WhiteboardStub>> | undefined;
  const TestComp = defineComponent({
    setup() {
      exposed = useWhiteboard(inputs);
      return () => h('div');
    },
  });
  const proxy = inputs.proxy;
  // Wire proxy.$superdoc to the computed $superdoc emitter
  const wrapper = mount(TestComp);
  return { wrapper, exposed: () => exposed!, proxy };
};

type SuperDocShellInputs = {
  proxy: SuperDocComponentProxy;
  layers: Ref<HTMLDivElement | null>;
  documents: Ref<Document[]>;
  modules: Modules;
};

const useWhiteboardFromSuperDoc = (inputs: SuperDocShellInputs) => useWhiteboard(inputs);

describe('useWhiteboard', () => {
  it('returns the real Whiteboard and WhiteboardPage types to the SuperDoc shell', () => {
    type ShellResult = ReturnType<typeof useWhiteboardFromSuperDoc>;
    expectTypeOf<ShellResult['whiteboard']>().toEqualTypeOf<Whiteboard | null | undefined>();
    expectTypeOf<ShellResult['whiteboardPages']['value']>().toEqualTypeOf<WhiteboardPage[]>();
  });

  let whiteboard: WhiteboardStub;
  let emitSpy: Mock<(name: string, ...args: unknown[]) => void>;
  let proxy: ComposableInputs['proxy'];
  let layers: ComposableInputs['layers'];
  let documents: Ref<Array<{ id: string; type: string }>>;

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
