import { describe, it, expect, vi, beforeEach, afterEach } from 'vite-plus/test';
import { defineComponent, h, ref } from 'vue';
import { mount } from '@vue/test-utils';
import {
  DEFAULT_COMMENTS_MIN_GUTTER_PX,
  DEFAULT_COMMENTS_SIDEBAR_LANE_PX,
  DEFAULT_DOCUMENT_VISIBLE_MIN_WIDTH_PX,
} from '../helpers/comment-small-screen.js';
import { useCommentSmallScreen } from './use-comment-small-screen.js';

const setClientWidth = (el, value) => {
  Object.defineProperty(el, 'clientWidth', {
    configurable: true,
    get: () => value,
  });
};

const setRectWidth = (el, value) => {
  el.getBoundingClientRect = vi.fn(() => ({ width: value }));
};

describe('useCommentSmallScreen', () => {
  let root;
  let parent;
  let layers;
  let commentsModuleConfig;

  const mountComposable = () => {
    let api;
    const Harness = defineComponent({
      setup() {
        api = useCommentSmallScreen({ commentsModuleConfig, superdocRoot: ref(root), layers: ref(layers) });
        return () => h('div');
      },
    });
    const wrapper = mount(Harness);
    return { api, wrapper };
  };

  const createMockResizeObserver = () => {
    const instances = [];
    const Original = window.ResizeObserver;
    window.ResizeObserver = vi.fn(function ResizeObserverStub(cb) {
      const instance = {
        observe: vi.fn(),
        disconnect: vi.fn(),
        _cb: cb,
      };
      instances.push(instance);
      return instance;
    });
    return {
      instances,
      restore: () => {
        window.ResizeObserver = Original;
      },
    };
  };

  beforeEach(() => {
    document.body.innerHTML = '';

    parent = document.createElement('div');
    root = document.createElement('div');
    layers = document.createElement('div');

    root.appendChild(layers);
    parent.appendChild(root);
    document.body.appendChild(parent);

    setClientWidth(parent, 1200);
    setClientWidth(root, 1000);
    setClientWidth(layers, 816);

    commentsModuleConfig = ref({ layout: 'auto' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('forces sidebar layout', () => {
    commentsModuleConfig.value = { layout: 'sidebar' };
    const { api: state, wrapper } = mountComposable();

    state.recalculateCompactCommentsMode();

    expect(state.isCompactCommentsMode.value).toBe(false);
    expect(state.superdocContainerWidth.value).toBe(1200);
    wrapper.unmount();
  });

  it('forces inline layout', () => {
    commentsModuleConfig.value = { layout: 'inline' };
    const { api: state, wrapper } = mountComposable();

    state.recalculateCompactCommentsMode();

    expect(state.isCompactCommentsMode.value).toBe(true);
    expect(state.superdocContainerWidth.value).toBe(1200);
    wrapper.unmount();
  });

  it('uses the configured responsive breakpoint', () => {
    commentsModuleConfig.value = { layout: 'auto', responsive: { breakpoint: 1100 } };
    const { api: state, wrapper } = mountComposable();

    state.recalculateCompactCommentsMode();

    expect(state.superdocContainerWidth.value).toBe(1200);
    expect(state.isCompactCommentsMode.value).toBe(false);

    setClientWidth(parent, 900);
    state.recalculateCompactCommentsMode();
    expect(state.isCompactCommentsMode.value).toBe(true);
    wrapper.unmount();
  });

  it('uses measured document width formula when no explicit breakpoint', () => {
    commentsModuleConfig.value = { layout: 'auto' };
    const documentEl = document.createElement('div');
    documentEl.className = 'superdoc__document';
    root.appendChild(documentEl);
    setClientWidth(documentEl, 840);

    const { api: state, wrapper } = mountComposable();

    // required = docWidth + sidebar + gutter
    const required = 840 + DEFAULT_COMMENTS_SIDEBAR_LANE_PX + DEFAULT_COMMENTS_MIN_GUTTER_PX;
    setClientWidth(parent, required - 1);
    state.recalculateCompactCommentsMode();
    expect(state.isCompactCommentsMode.value).toBe(true);

    setClientWidth(parent, required + 1);
    state.recalculateCompactCommentsMode();
    expect(state.isCompactCommentsMode.value).toBe(false);
    wrapper.unmount();
  });

  it('falls back to default document width when document/layers width is unavailable', () => {
    commentsModuleConfig.value = { layout: 'auto' };
    setClientWidth(layers, 0);
    setRectWidth(layers, 0);

    const { api: state, wrapper } = mountComposable();

    const required =
      DEFAULT_DOCUMENT_VISIBLE_MIN_WIDTH_PX + DEFAULT_COMMENTS_SIDEBAR_LANE_PX + DEFAULT_COMMENTS_MIN_GUTTER_PX;
    setClientWidth(parent, required - 1);
    state.recalculateCompactCommentsMode();
    expect(state.isCompactCommentsMode.value).toBe(true);

    setClientWidth(parent, required + 1);
    state.recalculateCompactCommentsMode();
    expect(state.isCompactCommentsMode.value).toBe(false);
    wrapper.unmount();
  });

  it('uses the configured responsive target selector', () => {
    const shell = document.createElement('div');
    shell.id = 'measurement-shell';
    document.body.appendChild(shell);
    setClientWidth(shell, 777);

    commentsModuleConfig.value = {
      layout: 'sidebar',
      responsive: { target: '#measurement-shell' },
    };

    const { api: state, wrapper } = mountComposable();
    state.recalculateCompactCommentsMode();

    expect(state.superdocContainerWidth.value).toBe(777);
    wrapper.unmount();
  });

  it('uses a responsive target element without a selector lookup', () => {
    const shell = document.createElement('div');
    document.body.appendChild(shell);
    setClientWidth(shell, 888);

    commentsModuleConfig.value = {
      layout: 'sidebar',
      responsive: { target: shell },
    };

    const { api: state, wrapper } = mountComposable();
    state.recalculateCompactCommentsMode();

    expect(state.superdocContainerWidth.value).toBe(888);
    wrapper.unmount();
  });

  it('falls back to the nearest measurable ancestor for an invalid target selector', () => {
    commentsModuleConfig.value = {
      layout: 'sidebar',
      responsive: { target: '[' },
    };

    const { api: state, wrapper } = mountComposable();

    expect(() => state.recalculateCompactCommentsMode()).not.toThrow();
    expect(state.superdocContainerWidth.value).toBe(1200);
    wrapper.unmount();
  });

  it('falls back to rect width when clientWidth is zero', () => {
    const selectorTarget = document.createElement('div');
    selectorTarget.id = 'rect-only';
    document.body.appendChild(selectorTarget);
    setClientWidth(selectorTarget, 0);
    setRectWidth(selectorTarget, 654);

    commentsModuleConfig.value = {
      layout: 'sidebar',
      responsive: { target: '#rect-only' },
    };

    const { api: state, wrapper } = mountComposable();
    state.recalculateCompactCommentsMode();
    expect(state.superdocContainerWidth.value).toBe(654);
    wrapper.unmount();
  });

  it('falls back to layers width when document width is unavailable', () => {
    commentsModuleConfig.value = { layout: 'auto' };
    const documentEl = document.createElement('div');
    documentEl.className = 'superdoc__document';
    root.appendChild(documentEl);
    setClientWidth(documentEl, 0);
    setRectWidth(documentEl, 0);

    setClientWidth(layers, 700);

    const { api: state, wrapper } = mountComposable();
    const required = 700 + DEFAULT_COMMENTS_SIDEBAR_LANE_PX + DEFAULT_COMMENTS_MIN_GUTTER_PX;
    setClientWidth(parent, required - 1);
    state.recalculateCompactCommentsMode();
    expect(state.isCompactCommentsMode.value).toBe(true);
    wrapper.unmount();
  });

  it('calls recalculate from ResizeObserver callback', () => {
    const ro = createMockResizeObserver();
    const { api: state, wrapper } = mountComposable();

    state.ensureCompactMeasurementObserver();
    expect(ro.instances.length).toBeGreaterThan(0);
    expect(state.superdocContainerWidth.value).toBe(0);

    setClientWidth(parent, 432);
    ro.instances[0]._cb();

    expect(state.superdocContainerWidth.value).toBe(432);
    wrapper.unmount();
    ro.restore();
  });

  it('returns null measurement target when root is missing', () => {
    const detachedConfig = ref({ layout: 'auto' });
    let api;
    const Harness = defineComponent({
      setup() {
        api = useCommentSmallScreen({
          commentsModuleConfig: detachedConfig,
          superdocRoot: ref(null),
          layers: ref(null),
        });
        return () => h('div');
      },
    });
    const wrapper = mount(Harness);
    api.recalculateCompactCommentsMode();
    expect(api.superdocContainerWidth.value).toBe(0);
    wrapper.unmount();
  });

  it('does not throw when ResizeObserver is unavailable', () => {
    const originalResizeObserver = window.ResizeObserver;
    delete window.ResizeObserver;

    const { api: state, wrapper } = mountComposable();
    expect(() => state.ensureCompactMeasurementObserver()).not.toThrow();
    wrapper.unmount();

    window.ResizeObserver = originalResizeObserver;
  });

  it('disconnects ResizeObserver on unmount', () => {
    const disconnect = vi.fn();
    const observe = vi.fn();
    const originalResizeObserver = window.ResizeObserver;
    window.ResizeObserver = vi.fn(function ResizeObserverStub() {
      return { observe, disconnect };
    });

    const { api, wrapper } = mountComposable();
    api.ensureCompactMeasurementObserver();

    expect(observe).toHaveBeenCalled();
    wrapper.unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);

    window.ResizeObserver = originalResizeObserver;
  });

  // Regression coverage: while the v2 loading overlay is present, `.superdoc__layers`
  // (and `.superdoc__document`, being 100% of it) is forced to fill the container.
  // Once the overlay unmounts, that width settles to the real page size — a resize
  // of a descendant the container's own ResizeObserver never sees. These tests
  // assert recalculation follows that settling directly, without the container ever
  // resizing.
  it('re-evaluates when the layers element resizes on its own, with the container untouched', () => {
    commentsModuleConfig.value = { layout: 'auto' };
    setClientWidth(parent, 1890);
    setClientWidth(layers, 1890); // forced full-width, as while the loading overlay is present

    const ro = createMockResizeObserver();
    const { api: state, wrapper } = mountComposable();

    state.recalculateCompactCommentsMode();
    expect(state.isCompactCommentsMode.value).toBe(true); // required width (1890+320+24) > 1890

    const documentWidthObserver = ro.instances.find((instance) =>
      instance.observe.mock.calls.some(([el]) => el === layers),
    );
    expect(documentWidthObserver).toBeTruthy();

    // Container is untouched — only `layers` settles to its real (narrower) width,
    // as it does once the loading overlay unmounts.
    setClientWidth(layers, 816);
    documentWidthObserver._cb();

    expect(state.isCompactCommentsMode.value).toBe(false);
    wrapper.unmount();
    ro.restore();
  });

  it('re-evaluates when .superdoc__document resizes on its own, with the container untouched', () => {
    commentsModuleConfig.value = { layout: 'auto' };
    const documentEl = document.createElement('div');
    documentEl.className = 'superdoc__document';
    root.appendChild(documentEl);
    setClientWidth(parent, 1890);
    setClientWidth(documentEl, 1890);

    const ro = createMockResizeObserver();
    const { api: state, wrapper } = mountComposable();

    state.recalculateCompactCommentsMode();
    expect(state.isCompactCommentsMode.value).toBe(true);

    const documentWidthObserver = ro.instances.find((instance) =>
      instance.observe.mock.calls.some(([el]) => el === documentEl),
    );
    expect(documentWidthObserver).toBeTruthy();

    setClientWidth(documentEl, 816);
    documentWidthObserver._cb();

    expect(state.isCompactCommentsMode.value).toBe(false);
    wrapper.unmount();
    ro.restore();
  });
});
