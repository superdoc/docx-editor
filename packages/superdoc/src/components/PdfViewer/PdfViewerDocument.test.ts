import { describe, it, expect, vi } from 'vite-plus/test';
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

vi.mock('./PdfViewerPage.vue', () => ({
  default: defineComponent({
    name: 'PdfViewerPageStub',
    props: ['page', 'pages', 'scale', 'config', 'hasTextLayer', 'outputScale', 'documentEl'],
    emits: ['page-rendered', 'page-error', 'selection-raw', 'bypass-selection'],
    setup(props, { emit }) {
      return () =>
        h(
          'div',
          {
            class: 'pdf-viewer-page-stub',
            'data-page-id': props.page.pageId,
            onClick: () => emit('page-rendered', { pageId: props.page.pageId }),
            onMouseup: () => emit('selection-raw', { pageId: props.page.pageId }),
            onMousedown: () => emit('bypass-selection', { pageId: props.page.pageId }),
            onContextmenu: () => emit('page-error', props.page),
          },
          [],
        );
    },
  }),
}));

import PdfViewerDocument from './PdfViewerDocument.vue';

const mountDocument = (props = {}) =>
  mount(PdfViewerDocument, {
    props: {
      config: { pdfLib: {} },
      pages: [],
      scale: 1,
      ...props,
    },
  });

describe('PdfViewerDocument.vue', () => {
  it('renders a wrapper with no pages when pages array is empty', () => {
    const wrapper = mountDocument();
    expect(wrapper.find('.sd-pdf-viewer-document').exists()).toBe(true);
    expect(wrapper.findAll('.pdf-viewer-page-stub')).toHaveLength(0);
  });

  it('renders one page stub per page', () => {
    const wrapper = mountDocument({
      pages: [{ pageId: 'p-1' }, { pageId: 'p-2' }, { pageId: 'p-3' }],
    });
    expect(wrapper.findAll('.pdf-viewer-page-stub')).toHaveLength(3);
  });

  it('forwards page-rendered events from child pages', async () => {
    const wrapper = mountDocument({ pages: [{ pageId: 'p-1' }] });
    await wrapper.find('.pdf-viewer-page-stub').trigger('click');
    expect(wrapper.emitted('page-rendered')).toBeTruthy();
    expect(wrapper.emitted('page-rendered')[0][0]).toEqual({ pageId: 'p-1' });
  });

  it('forwards selection-raw events from child pages', async () => {
    const wrapper = mountDocument({ pages: [{ pageId: 'p-1' }] });
    await wrapper.find('.pdf-viewer-page-stub').trigger('mouseup');
    expect(wrapper.emitted('selection-raw')).toBeTruthy();
  });

  it('forwards bypass-selection events from child pages', async () => {
    const wrapper = mountDocument({ pages: [{ pageId: 'p-1' }] });
    await wrapper.find('.pdf-viewer-page-stub').trigger('mousedown');
    expect(wrapper.emitted('bypass-selection')).toBeTruthy();
  });

  it('forwards page-error events from child pages', async () => {
    const wrapper = mountDocument({ pages: [{ pageId: 'p-1' }] });
    await wrapper.find('.pdf-viewer-page-stub').trigger('contextmenu');
    expect(wrapper.emitted('page-error')).toBeTruthy();
  });
});
