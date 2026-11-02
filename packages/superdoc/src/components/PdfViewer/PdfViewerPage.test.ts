import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';
import { mount, flushPromises } from '@vue/test-utils';
import PdfViewerPage from './PdfViewerPage.vue';

const makePdfjsPage = (overrides = {}) => {
  const renderTaskPromise = Promise.resolve();
  return {
    getViewport: vi.fn(({ scale }) => ({ width: 800 * scale, height: 1000 * scale })),
    render: vi.fn(() => ({ promise: renderTaskPromise, cancel: vi.fn() })),
    getTextContent: vi.fn(async () => ({ items: [] })),
    cleanup: vi.fn(),
    ...overrides,
  };
};

const makePage = (overrides = {}) => ({
  pageId: 'p-1',
  documentId: 'doc-1',
  pageNumber: 1,
  pdfjsPage: makePdfjsPage(),
  ...overrides,
});

const mountPage = (propsOverrides = {}) => {
  const page = propsOverrides.page ?? makePage();
  return mount(PdfViewerPage, {
    props: {
      config: { pdfLib: {} },
      page,
      pages: [page],
      scale: 1,
      ...propsOverrides,
    },
    attachTo: document.body,
  });
};

describe('PdfViewerPage.vue', () => {
  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      clearRect: vi.fn(),
    }));
  });

  it('renders a page wrapper with the correct data attributes', () => {
    const page = makePage({ pageId: 'p-3', pageNumber: 3 });
    const wrapper = mountPage({ page, pages: [makePage({ pageId: 'p-1' }), makePage({ pageId: 'p-2' }), page] });
    const el = wrapper.find('.sd-pdf-viewer-page');
    expect(el.attributes('data-page-id')).toBe('p-3');
    expect(el.attributes('data-page-number')).toBe('3');
  });

  it('calls getViewport with the expected scale on mount', () => {
    const page = makePage();
    mountPage({ page });
    expect(page.pdfjsPage.getViewport).toHaveBeenCalled();
  });

  it('emits page-rendered after render resolves', async () => {
    const page = makePage();
    const wrapper = mountPage({ page });
    await flushPromises();
    const events = wrapper.emitted('page-rendered');
    expect(events).toBeTruthy();
    const payload = events[0][0];
    expect(payload.documentId).toBe('doc-1');
    expect(payload.pageNumber).toBe(1);
    expect(payload.pageIndex).toBe(0);
    expect(page.pdfjsPage.render).toHaveBeenCalled();
  });

  it('emits page-error when render rejects', async () => {
    const page = makePage({
      pdfjsPage: makePdfjsPage({
        render: vi.fn(() => ({
          promise: Promise.reject(new Error('render failed')),
          cancel: vi.fn(),
        })),
      }),
    });
    const wrapper = mountPage({ page });
    await flushPromises();
    expect(wrapper.emitted('page-error')).toBeTruthy();
  });

  it('does not render text layer when hasTextLayer is false', async () => {
    const page = makePage();
    const wrapper = mountPage({ page, hasTextLayer: false });
    await flushPromises();
    expect(wrapper.find('.sd-pdf-viewer-page__text-layer').exists()).toBe(false);
    expect(page.pdfjsPage.getTextContent).not.toHaveBeenCalled();
  });

  it('renders text layer node when hasTextLayer is true', async () => {
    const TextLayerInstances = [];
    const TextLayer = vi.fn(function (opts) {
      TextLayerInstances.push(opts);
      this.render = vi.fn(async () => {});
    });
    const page = makePage();
    const wrapper = mountPage({
      page,
      hasTextLayer: true,
      config: { pdfLib: { TextLayer } },
    });
    await flushPromises();
    expect(wrapper.find('.sd-pdf-viewer-page__text-layer').exists()).toBe(true);
    expect(TextLayer).toHaveBeenCalled();
    expect(page.pdfjsPage.getTextContent).toHaveBeenCalled();
  });

  it('emits text-layer-error when getTextContent fails', async () => {
    const page = makePage({
      pdfjsPage: makePdfjsPage({
        getTextContent: vi.fn(async () => {
          throw new Error('text failed');
        }),
      }),
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const wrapper = mountPage({
      page,
      hasTextLayer: true,
      config: { pdfLib: { TextLayer: function () {} } },
    });
    await flushPromises();
    expect(wrapper.emitted('text-layer-error')).toBeTruthy();
    errSpy.mockRestore();
  });

  it('skips text layer render if pdfLib.TextLayer is missing', async () => {
    const page = makePage();
    const wrapper = mountPage({
      page,
      hasTextLayer: true,
      config: { pdfLib: {} },
    });
    await flushPromises();
    expect(wrapper.emitted('text-layer-rendered')).toBeFalsy();
  });

  it('emits bypass-selection when mousedown target is not a SPAN', async () => {
    const wrapper = mountPage();
    await flushPromises();
    const el = wrapper.find('.sd-pdf-viewer-page');
    await el.trigger('mousedown');
    expect(wrapper.emitted('bypass-selection')).toBeTruthy();
  });

  it('calls pdfjsPage.cleanup on unmount', async () => {
    const page = makePage();
    const wrapper = mountPage({ page });
    await flushPromises();
    wrapper.unmount();
    expect(page.pdfjsPage.cleanup).toHaveBeenCalled();
  });

  it('pageNumber falls back to 0 when page is not in pages array', () => {
    const orphan = makePage({ pageId: 'orphan' });
    const wrapper = mount(PdfViewerPage, {
      props: {
        config: { pdfLib: {} },
        page: orphan,
        pages: [makePage({ pageId: 'other' })],
        scale: 1,
      },
    });
    expect(wrapper.find('.sd-pdf-viewer-page').attributes('data-page-number')).toBe('0');
  });
});
