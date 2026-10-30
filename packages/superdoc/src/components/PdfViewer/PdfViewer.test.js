import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';

let adapterGetDocument;
let adapterGetPages;

vi.mock('../../core/pdf/pdf-adapter', () => ({
  createPDFConfig: (cfg) => ({ adapter: 'pdfjs', ...cfg }),
  PDFAdapterFactory: {
    create: () => ({
      getDocument: (...args) => adapterGetDocument(...args),
      getPages: (...args) => adapterGetPages(...args),
    }),
  },
}));

vi.mock('../../core/pdf/helpers/read-file', () => ({
  readFileAsArrayBuffer: vi.fn(async (file) => file?.buffer ?? new ArrayBuffer(8)),
}));

vi.mock('./PdfViewerDocument.vue', () => ({
  default: defineComponent({
    name: 'PdfViewerDocumentStub',
    props: ['pdf', 'pages', 'scale', 'config', 'hasTextLayer', 'outputScale'],
    emits: ['page-rendered', 'selection-raw', 'bypass-selection'],
    setup(props, { emit }) {
      return () =>
        h('div', {
          class: 'pdf-document-stub',
          'data-num-pages': props.pages?.length ?? 0,
          'data-scale': props.scale,
          onPageRendered: () => emit('page-rendered', { page: props.pages?.[0] }),
        });
    },
  }),
}));

import PdfViewer from './PdfViewer.vue';

const makeFile = (name = 'doc.pdf') => {
  const file = { name, buffer: new ArrayBuffer(8) };
  return file;
};

const mountViewer = (propsOverrides = {}) =>
  mount(PdfViewer, {
    props: {
      config: { pdfLib: { version: '4.0.0' }, workerSrc: '/w.js', setWorker: false },
      file: makeFile(),
      ...propsOverrides,
    },
  });

describe('PdfViewer.vue', () => {
  beforeEach(() => {
    adapterGetDocument = vi.fn(async () => ({
      documentId: 'doc-1',
      numPages: 2,
    }));
    adapterGetPages = vi.fn(async () => [
      { pageNumber: 1, documentId: 'doc-1' },
      { pageNumber: 2, documentId: 'doc-1' },
    ]);
  });

  it('renders the root container with the document stub', () => {
    const wrapper = mountViewer();
    expect(wrapper.find('.sd-pdf-viewer').exists()).toBe(true);
    expect(wrapper.find('.pdf-document-stub').exists()).toBe(true);
  });

  it('loads the document and emits document-loaded', async () => {
    const wrapper = mountViewer();
    await flushPromises();
    expect(wrapper.emitted('document-loaded')).toBeTruthy();
    expect(adapterGetDocument).toHaveBeenCalledTimes(1);
  });

  it('loads pages and emits pages-loaded', async () => {
    const wrapper = mountViewer();
    await flushPromises();
    const pagesLoaded = wrapper.emitted('pages-loaded');
    expect(pagesLoaded).toBeTruthy();
    expect(pagesLoaded[0][0]).toHaveLength(2);
    expect(wrapper.find('.pdf-document-stub').attributes('data-num-pages')).toBe('2');
  });

  it('emits document-error when adapter.getDocument throws', async () => {
    adapterGetDocument = vi.fn(async () => {
      throw new Error('load failed');
    });
    // silence console.error from error path
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const wrapper = mountViewer();
    await flushPromises();
    expect(wrapper.emitted('document-error')).toBeTruthy();
    errSpy.mockRestore();
  });

  it('emits document-error when adapter.getPages throws', async () => {
    adapterGetPages = vi.fn(async () => {
      throw new Error('pages failed');
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const wrapper = mountViewer();
    await flushPromises();
    expect(wrapper.emitted('document-error')).toBeTruthy();
    errSpy.mockRestore();
  });

  it('does not call adapter when file prop is falsy', async () => {
    mount(PdfViewer, {
      props: {
        config: { pdfLib: {} },
        file: null,
      },
    });
    await flushPromises();
    expect(adapterGetDocument).not.toHaveBeenCalled();
  });

  it('throws a named error when the config has no pdfLib', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => mount(PdfViewer, { props: { config: {}, file: null } })).toThrow(
      new TypeError('PdfViewer requires modules.pdf.pdfLib'),
    );
    warnSpy.mockRestore();
  });

  it('updateScale rounds to 2 decimals and is callable via exposed API', async () => {
    const wrapper = mountViewer();
    await flushPromises();
    wrapper.vm.updateScale(1.2345);
    await nextTick();
    expect(wrapper.find('.pdf-document-stub').attributes('data-scale')).toBe('1.23');
  });

  it('uses fileId when provided', async () => {
    const wrapper = mountViewer({ fileId: 'custom-id' });
    await flushPromises();
    // documentId is internal, but we can confirm through pages-loaded payload
    const pagesLoaded = wrapper.emitted('pages-loaded')[0][0];
    expect(pagesLoaded[0].documentId).toBe('custom-id');
  });

  it('emits document-ready after all pages are rendered', async () => {
    const wrapper = mountViewer();
    await flushPromises();
    // Simulate each page reporting rendered
    const doc = wrapper.findComponent({ name: 'PdfViewerDocumentStub' });
    doc.vm.$emit('page-rendered', { page: { pdfjsPage: {} } });
    doc.vm.$emit('page-rendered', { page: { pdfjsPage: {} } });
    await nextTick();
    expect(wrapper.emitted('document-ready')).toBeTruthy();
  });
});
