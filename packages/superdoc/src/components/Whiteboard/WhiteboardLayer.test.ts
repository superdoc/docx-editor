import { describe, it, expect, vi } from 'vite-plus/test';
import { mount } from '@vue/test-utils';
import WhiteboardLayer from './WhiteboardLayer.vue';

const makePage = (pageIndex) => ({
  pageIndex,
  size: { width: 100, height: 120 },
  mount: vi.fn(),
  resize: vi.fn(),
  destroy: vi.fn(),
  setSize: vi.fn(),
  setTool: vi.fn(),
  setEnabled: vi.fn(),
  addText: vi.fn(),
  addImage: vi.fn(),
});

const makeWhiteboard = () => ({
  getTool: () => 'select',
  getType: () => [],
});

const mountLayer = (props = {}) =>
  mount(WhiteboardLayer, {
    props: {
      whiteboard: makeWhiteboard(),
      pages: [makePage(0), makePage(1)],
      pageSizes: { 0: { width: 100, height: 120 }, 1: { width: 100, height: 120 } },
      pageOffsets: {},
      ...props,
    },
  });

describe('WhiteboardLayer', () => {
  it('mounts a .whiteboard-layer with one .whiteboard-page per page model', () => {
    const wrapper = mountLayer();
    expect(wrapper.find('.whiteboard-layer').exists()).toBe(true);
    expect(wrapper.findAll('.whiteboard-page')).toHaveLength(2);
  });

  it('stays pointer-inert when disabled so PDF selection is not blocked', () => {
    const wrapper = mountLayer({ enabled: false });
    expect(wrapper.find('.whiteboard-layer').attributes('style')).toContain('pointer-events: none');
  });

  it('falls back to enabled for pointer ownership when interactive is not provided', () => {
    const enabled = mountLayer({ enabled: true });
    expect(enabled.find('.whiteboard-layer').attributes('style')).toContain('pointer-events: auto');
  });

  it('captures pointer events when interactive is true', () => {
    const wrapper = mountLayer({ enabled: true, interactive: true });
    expect(wrapper.find('.whiteboard-layer').attributes('style')).toContain('pointer-events: auto');
  });

  it('stays pointer-inert when enabled but interactive is false', () => {
    const wrapper = mountLayer({ enabled: true, interactive: false });
    expect(wrapper.find('.whiteboard-layer').attributes('style')).toContain('pointer-events: none');
  });

  it('mounts each whiteboard page onto its Konva container', () => {
    const pages = [makePage(0), makePage(1)];
    mountLayer({ pages });
    expect(pages[0].mount).toHaveBeenCalledTimes(1);
    expect(pages[1].mount).toHaveBeenCalledTimes(1);
  });
});
