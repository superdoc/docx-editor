import { describe, it, expect, vi, beforeEach, afterEach } from 'vite-plus/test';
import { mount } from '@vue/test-utils';
import { shallowRef, defineComponent, h, nextTick } from 'vue';
import SurfaceHost from './SurfaceHost.vue';
import SurfaceDialog from './SurfaceDialog.vue';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal SurfaceManager stub that exposes the same reactive refs */
function createManagerStub() {
  const activeDialog = shallowRef(null);
  const activeFloating = shallowRef(null);
  return {
    activeDialog,
    activeFloating,
    close: vi.fn((id) => {
      if (activeDialog.value?.id === id) {
        activeDialog.value.settle({ status: 'closed' });
        activeDialog.value = null;
      }
      if (activeFloating.value?.id === id) {
        activeFloating.value.settle({ status: 'closed' });
        activeFloating.value = null;
      }
    }),
  };
}

const TestContent = defineComponent({
  props: ['surfaceId', 'mode', 'request', 'resolve', 'close'],
  setup(props) {
    return () => h('div', { class: 'test-content' }, `Surface ${props.surfaceId}`);
  },
});

function createSurface(overrides = {}) {
  let settled = false;
  return {
    id: 'test-1',
    mode: 'dialog',
    request: {
      id: 'test-1',
      mode: 'dialog',
      title: 'Test Title',
      closeOnEscape: true,
      closeOnBackdrop: true,
    },
    component: TestContent,
    props: {},
    render: null,
    resolve: vi.fn(),
    close: vi.fn(),
    settle: vi.fn(() => {
      settled = true;
    }),
    get settled() {
      return settled;
    },
    ...overrides,
  };
}

function mountHost(managerStub) {
  return mount(SurfaceHost, {
    global: {
      provide: {
        surfaceManager: managerStub,
      },
      stubs: {
        teleport: true,
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SurfaceHost', () => {
  let manager;

  beforeEach(() => {
    manager = createManagerStub();
  });

  it('renders nothing when no surfaces are active', () => {
    const wrapper = mountHost(manager);
    expect(wrapper.find('.sd-surface-host').exists()).toBe(false);
  });

  it('renders a dialog when activeDialog is set', async () => {
    manager.activeDialog.value = createSurface({ mode: 'dialog' });
    const wrapper = mountHost(manager);
    await nextTick();

    expect(wrapper.find('.sd-surface-host').exists()).toBe(true);
    expect(wrapper.find('.sd-surface-dialog-backdrop').exists()).toBe(true);
  });

  it.each([true, false])('prevents backdrop focus loss with closeOnBackdrop=%s', async (closeOnBackdrop) => {
    const surface = createSurface();
    surface.request.closeOnBackdrop = closeOnBackdrop;
    manager.activeDialog.value = surface;
    const wrapper = mountHost(manager);
    await nextTick();

    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    wrapper.find('.sd-surface-dialog-backdrop').element.dispatchEvent(event);
    await nextTick();

    expect(event.defaultPrevented).toBe(true);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(!closeOnBackdrop);
    wrapper.unmount();
  });

  it('renders a floating when activeFloating is set', async () => {
    manager.activeFloating.value = createSurface({
      id: 'float-1',
      mode: 'floating',
      request: {
        id: 'float-1',
        mode: 'floating',
        closeOnEscape: true,
        floating: { placement: 'top-right' },
      },
    });
    const wrapper = mountHost(manager);
    await nextTick();

    expect(wrapper.find('.sd-surface-floating').exists()).toBe(true);
  });

  it('renders both dialog and floating simultaneously', async () => {
    manager.activeDialog.value = createSurface({ mode: 'dialog' });
    manager.activeFloating.value = createSurface({
      id: 'float-1',
      mode: 'floating',
      request: {
        id: 'float-1',
        mode: 'floating',
        closeOnEscape: true,
        floating: { placement: 'top-right' },
      },
    });
    const wrapper = mountHost(manager);
    await nextTick();

    expect(wrapper.find('.sd-surface-dialog-backdrop').exists()).toBe(true);
    expect(wrapper.find('.sd-surface-floating').exists()).toBe(true);
  });

  it('dialog renders with correct ARIA attributes', async () => {
    manager.activeDialog.value = createSurface({ mode: 'dialog' });
    const wrapper = mountHost(manager);
    await nextTick();

    const dialog = wrapper.find('[role="dialog"]');
    expect(dialog.exists()).toBe(true);
    expect(dialog.attributes('aria-modal')).toBe('true');
    expect(dialog.attributes('aria-labelledby')).toBe('sd-surface-title-test-1');
  });

  it('floating renders with role="dialog" (no aria-modal)', async () => {
    manager.activeFloating.value = createSurface({
      id: 'float-1',
      mode: 'floating',
      request: {
        id: 'float-1',
        mode: 'floating',
        title: 'Floating Title',
        closeOnEscape: true,
        floating: { placement: 'top-right' },
      },
    });
    const wrapper = mountHost(manager);
    await nextTick();

    const floating = wrapper.find('.sd-surface-floating[role="dialog"]');
    expect(floating.exists()).toBe(true);
    expect(floating.attributes('aria-modal')).toBeUndefined();
    expect(floating.attributes('aria-labelledby')).toBe('sd-surface-title-float-1');
  });

  it('floating uses aria-label when no title is provided but ariaLabel is set', async () => {
    manager.activeFloating.value = createSurface({
      id: 'float-1',
      mode: 'floating',
      request: {
        id: 'float-1',
        mode: 'floating',
        closeOnEscape: true,
        ariaLabel: 'Floating Label',
        floating: { placement: 'top-right' },
      },
    });
    const wrapper = mountHost(manager);
    await nextTick();

    const floating = wrapper.find('.sd-surface-floating[role="dialog"]');
    expect(floating.exists()).toBe(true);
    expect(floating.attributes('aria-label')).toBe('Floating Label');
    expect(floating.attributes('aria-labelledby')).toBeUndefined();
  });

  it('dialog title renders when provided', async () => {
    manager.activeDialog.value = createSurface();
    const wrapper = mountHost(manager);
    await nextTick();

    const title = wrapper.find('.sd-surface-dialog__title');
    expect(title.exists()).toBe(true);
    expect(title.text()).toBe('Test Title');
  });

  it('dialog title is absent when not provided', async () => {
    manager.activeDialog.value = createSurface({
      request: { id: 'test-1', mode: 'dialog', closeOnEscape: true, closeOnBackdrop: true },
    });
    const wrapper = mountHost(manager);
    await nextTick();

    expect(wrapper.find('.sd-surface-dialog__title').exists()).toBe(false);
  });

  it('dialog uses aria-label when no title is provided but ariaLabel is set', async () => {
    manager.activeDialog.value = createSurface({
      request: {
        id: 'test-1',
        mode: 'dialog',
        closeOnEscape: true,
        closeOnBackdrop: true,
        ariaLabel: 'Password Required',
      },
    });
    const wrapper = mountHost(manager);
    await nextTick();

    const dialog = wrapper.find('[role="dialog"]');
    expect(dialog.exists()).toBe(true);
    expect(dialog.attributes('aria-label')).toBe('Password Required');
    expect(dialog.attributes('aria-labelledby')).toBeUndefined();
  });

  it('dialog uses ariaLabelledBy when set (takes precedence over ariaLabel)', async () => {
    manager.activeDialog.value = createSurface({
      request: {
        id: 'test-1',
        mode: 'dialog',
        closeOnEscape: true,
        closeOnBackdrop: true,
        ariaLabelledBy: 'my-heading-id',
        ariaLabel: 'should-be-ignored',
      },
    });
    const wrapper = mountHost(manager);
    await nextTick();

    const dialog = wrapper.find('[role="dialog"]');
    expect(dialog.attributes('aria-labelledby')).toBe('my-heading-id');
    expect(dialog.attributes('aria-label')).toBeUndefined();
  });

  it('renders custom Vue component content inside dialog', async () => {
    manager.activeDialog.value = createSurface();
    const wrapper = mountHost(manager);
    await nextTick();

    expect(wrapper.find('.test-content').exists()).toBe(true);
    expect(wrapper.find('.test-content').text()).toContain('Surface test-1');
  });

  it('floating uses placement class', async () => {
    manager.activeFloating.value = createSurface({
      id: 'float-1',
      mode: 'floating',
      request: {
        id: 'float-1',
        mode: 'floating',
        closeOnEscape: true,
        floating: { placement: 'top-left' },
      },
    });
    const wrapper = mountHost(manager);
    await nextTick();

    expect(wrapper.find('.sd-surface-floating--top-left').exists()).toBe(true);
  });

  describe('floating Escape — document-level listener', () => {
    afterEach(() => {
      // Clean up any leftover document listeners by unmounting
    });

    it('closes floating on Escape via document-level listener', async () => {
      manager.activeFloating.value = createSurface({
        id: 'float-1',
        mode: 'floating',
        request: {
          id: 'float-1',
          mode: 'floating',
          closeOnEscape: true,
          floating: { placement: 'top-right' },
        },
      });
      const wrapper = mountHost(manager);
      await nextTick();

      // Simulate Escape at the document level (not inside the floating)
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      document.dispatchEvent(event);

      expect(manager.close).toHaveBeenCalledWith('float-1');
      wrapper.unmount();
    });

    it('does not close floating on Escape when closeOnEscape is false', async () => {
      manager.activeFloating.value = createSurface({
        id: 'float-1',
        mode: 'floating',
        request: {
          id: 'float-1',
          mode: 'floating',
          closeOnEscape: false,
          floating: { placement: 'top-right' },
        },
      });
      const wrapper = mountHost(manager);
      await nextTick();

      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      document.dispatchEvent(event);

      expect(manager.close).not.toHaveBeenCalled();
      wrapper.unmount();
    });

    it('does not close floating on Escape when a dialog is also open', async () => {
      manager.activeDialog.value = createSurface({ mode: 'dialog' });
      manager.activeFloating.value = createSurface({
        id: 'float-1',
        mode: 'floating',
        request: {
          id: 'float-1',
          mode: 'floating',
          closeOnEscape: true,
          floating: { placement: 'top-right' },
        },
      });
      const wrapper = mountHost(manager);
      await nextTick();

      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      document.dispatchEvent(event);

      // Floating Escape is suppressed when dialog is open — dialog owns Escape
      expect(manager.close).not.toHaveBeenCalled();
      wrapper.unmount();
    });

    it('cleans up document listener when floating is removed', async () => {
      manager.activeFloating.value = createSurface({
        id: 'float-1',
        mode: 'floating',
        request: {
          id: 'float-1',
          mode: 'floating',
          closeOnEscape: true,
          floating: { placement: 'top-right' },
        },
      });
      const wrapper = mountHost(manager);
      await nextTick();

      // Remove the floating
      manager.activeFloating.value = null;
      await nextTick();

      // Escape should not call close
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      document.dispatchEvent(event);

      expect(manager.close).not.toHaveBeenCalled();
      wrapper.unmount();
    });
  });

  describe('floating outside-pointer-down', () => {
    it('closes floating when closeOnOutsidePointerDown is true and pointer is outside', async () => {
      manager.activeFloating.value = createSurface({
        id: 'float-1',
        mode: 'floating',
        request: {
          id: 'float-1',
          mode: 'floating',
          closeOnEscape: true,
          floating: { placement: 'top-right', closeOnOutsidePointerDown: true },
        },
      });
      const wrapper = mountHost(manager);
      await nextTick();

      // Pointer down outside the floating surface
      const event = new PointerEvent('pointerdown', { bubbles: true });
      document.dispatchEvent(event);

      expect(manager.close).toHaveBeenCalledWith('float-1');
      wrapper.unmount();
    });

    it('does not close floating when closeOnOutsidePointerDown is false (default)', async () => {
      manager.activeFloating.value = createSurface({
        id: 'float-1',
        mode: 'floating',
        request: {
          id: 'float-1',
          mode: 'floating',
          closeOnEscape: true,
          floating: { placement: 'top-right' },
        },
      });
      const wrapper = mountHost(manager);
      await nextTick();

      // Pointer down outside — but closeOnOutsidePointerDown defaults to false
      const event = new PointerEvent('pointerdown', { bubbles: true });
      document.dispatchEvent(event);

      expect(manager.close).not.toHaveBeenCalled();
      wrapper.unmount();
    });

    it('does not close floating on outside pointer when a dialog is also open', async () => {
      manager.activeDialog.value = createSurface({ mode: 'dialog' });
      manager.activeFloating.value = createSurface({
        id: 'float-1',
        mode: 'floating',
        request: {
          id: 'float-1',
          mode: 'floating',
          closeOnEscape: true,
          floating: { placement: 'top-right', closeOnOutsidePointerDown: true },
        },
      });
      const wrapper = mountHost(manager);
      await nextTick();

      const event = new PointerEvent('pointerdown', { bubbles: true });
      document.dispatchEvent(event);

      // Outside-pointer-down is suppressed when dialog is open
      expect(manager.close).not.toHaveBeenCalled();
      wrapper.unmount();
    });
  });

  describe('SurfaceExternalMount rendering', () => {
    it('calls render function with correct context for dialog', async () => {
      const renderFn = vi.fn((ctx) => {
        ctx.container.textContent = 'External content';
        return { destroy: vi.fn() };
      });

      manager.activeDialog.value = createSurface({
        component: null,
        render: renderFn,
      });
      const wrapper = mountHost(manager);
      await nextTick();

      expect(renderFn).toHaveBeenCalledTimes(1);
      const ctx = renderFn.mock.calls[0][0];
      expect(ctx.container).toBeInstanceOf(HTMLElement);
      expect(ctx.surfaceId).toBe('test-1');
      expect(ctx.mode).toBe('dialog');
      expect(typeof ctx.resolve).toBe('function');
      expect(typeof ctx.close).toBe('function');
      wrapper.unmount();
    });

    it('destroys an external floating renderer when the surface closes', async () => {
      const destroy = vi.fn();
      const renderFn = vi.fn(() => ({ destroy }));

      manager.activeFloating.value = createSurface({
        id: 'float-1',
        mode: 'floating',
        request: {
          id: 'float-1',
          mode: 'floating',
          closeOnEscape: true,
          floating: { placement: 'top-right' },
        },
        component: null,
        render: renderFn,
      });
      const wrapper = mountHost(manager);
      await nextTick();

      manager.close('float-1');
      await nextTick();

      expect(destroy).toHaveBeenCalledTimes(1);
      wrapper.unmount();
    });
  });

  describe('viewport-aware geometry', () => {
    // Create a .superdoc > .superdoc__layers structure and pass the layers
    // element as the geometryTarget prop (mirrors what SuperDoc.vue does).
    function mountHostInSuperdoc(managerStub) {
      const superdocRoot = document.createElement('div');
      superdocRoot.className = 'superdoc';
      const layers = document.createElement('div');
      layers.className = 'superdoc__layers';
      superdocRoot.appendChild(layers);
      document.body.appendChild(superdocRoot);

      const wrapper = mount(SurfaceHost, {
        props: { geometryTarget: layers },
        global: {
          provide: { surfaceManager: managerStub },
          stubs: { teleport: true },
        },
      });
      return { wrapper, superdocRoot, layers };
    }

    afterEach(() => {
      document.querySelectorAll('.superdoc').forEach((el) => el.remove());
    });

    /** Flush enough ticks for Vue reactivity + flush:'post' watcher to settle */
    async function flushGeometry() {
      await nextTick();
      await nextTick();
      await nextTick();
    }

    it('applies fixed position style to host element when surface is active', async () => {
      manager.activeDialog.value = createSurface({ mode: 'dialog' });
      const { wrapper } = mountHostInSuperdoc(manager);
      await flushGeometry();

      const host = wrapper.find('.sd-surface-host');
      expect(host.exists()).toBe(true);
      // JSDOM returns zero rects, so style has position:fixed with 0px values
      expect(host.element.style.position).toBe('fixed');
      wrapper.unmount();
    });

    it('recomputes geometry and locks dialog scroll when geometryTarget arrives after mount', async () => {
      const superdocRoot = document.createElement('div');
      superdocRoot.className = 'superdoc';
      document.body.appendChild(superdocRoot);

      const layers = document.createElement('div');
      layers.className = 'superdoc__layers';
      superdocRoot.appendChild(layers);

      manager.activeDialog.value = createSurface({ mode: 'dialog' });

      const wrapper = mount(SurfaceHost, {
        props: { geometryTarget: null },
        attachTo: superdocRoot,
        global: {
          provide: { surfaceManager: manager },
        },
      });

      await flushGeometry();

      const teleportedHostBefore = document.body.querySelector('.sd-surface-host');
      expect(teleportedHostBefore).not.toBeNull();
      expect(teleportedHostBefore?.style.position).toBe('');
      expect(layers.style.overflow).toBe('');

      await wrapper.setProps({ geometryTarget: layers });
      await flushGeometry();

      const teleportedHostAfter = document.body.querySelector('.sd-surface-host');
      expect(teleportedHostAfter?.style.position).toBe('fixed');
      expect(layers.style.overflow).toBe('hidden');
      expect(wrapper.findComponent(SurfaceDialog).props('scrollLockTarget')).toBe(layers);

      wrapper.unmount();

      expect(layers.style.overflow).toBe('');
      superdocRoot.remove();
    });

    it('attaches scroll and resize listeners when surface activates', async () => {
      const addSpy = vi.spyOn(window, 'addEventListener');
      manager.activeDialog.value = createSurface({ mode: 'dialog' });
      const { wrapper } = mountHostInSuperdoc(manager);
      await flushGeometry();

      const scrollCall = addSpy.mock.calls.find(([event, , capture]) => event === 'scroll' && capture === true);
      const resizeCall = addSpy.mock.calls.find(([event]) => event === 'resize');

      expect(scrollCall).toBeDefined();
      expect(resizeCall).toBeDefined();

      addSpy.mockRestore();
      wrapper.unmount();
    });

    it('detaches listeners when all surfaces are removed', async () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener');
      manager.activeDialog.value = createSurface({ mode: 'dialog' });
      const { wrapper } = mountHostInSuperdoc(manager);
      await flushGeometry();

      // Remove the surface
      manager.activeDialog.value = null;
      await flushGeometry();

      const scrollCall = removeSpy.mock.calls.find(([event, , capture]) => event === 'scroll' && capture === true);
      const resizeCall = removeSpy.mock.calls.find(([event]) => event === 'resize');

      expect(scrollCall).toBeDefined();
      expect(resizeCall).toBeDefined();

      removeSpy.mockRestore();
      wrapper.unmount();
    });

    it('cleans up listeners on unmount', async () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener');
      manager.activeDialog.value = createSurface({ mode: 'dialog' });
      const { wrapper } = mountHostInSuperdoc(manager);
      await flushGeometry();

      wrapper.unmount();

      const scrollCall = removeSpy.mock.calls.find(([event, , capture]) => event === 'scroll' && capture === true);
      expect(scrollCall).toBeDefined();

      removeSpy.mockRestore();
    });

    it('resolves .superdoc__layers as geometry target over .superdoc', async () => {
      manager.activeDialog.value = createSurface({ mode: 'dialog' });
      const { wrapper, superdocRoot } = mountHostInSuperdoc(manager);
      await flushGeometry();

      // The host should measure .superdoc__layers, not .superdoc itself.
      // We verify by checking the style is set (meaning a target was found).
      const host = wrapper.find('.sd-surface-host');
      expect(host.element.style.position).toBe('fixed');
      // Confirm layers exists as expected
      expect(superdocRoot.querySelector('.superdoc__layers')).not.toBeNull();

      wrapper.unmount();
    });

    it('clips to a scrollable overflow ancestor, not just the browser viewport', async () => {
      // Build: scrollableWrapper(overflow:auto, 300px tall) > .superdoc > .superdoc__layers
      const scrollWrapper = document.createElement('div');
      scrollWrapper.style.overflow = 'auto';
      document.body.appendChild(scrollWrapper);

      const superdocRoot = document.createElement('div');
      superdocRoot.className = 'superdoc';
      scrollWrapper.appendChild(superdocRoot);

      const layers = document.createElement('div');
      layers.className = 'superdoc__layers';
      superdocRoot.appendChild(layers);

      // Mock getComputedStyle so the ancestor walk detects the clipping overflow.
      // JSDOM's getComputedStyle doesn't resolve inline styles to overflowX/overflowY.
      const origGetComputedStyle = window.getComputedStyle;
      vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => {
        const real = origGetComputedStyle(el);
        if (el === scrollWrapper) {
          return { ...real, overflowX: 'auto', overflowY: 'auto' };
        }
        return real;
      });

      // Mock getBoundingClientRect:
      // - scrollWrapper clips to 0..300 vertically, 0..800 horizontally
      // - layers extends from -100..600 (partially scrolled above wrapper)
      vi.spyOn(scrollWrapper, 'getBoundingClientRect').mockReturnValue({
        top: 0,
        left: 0,
        right: 800,
        bottom: 300,
        width: 800,
        height: 300,
      });
      vi.spyOn(layers, 'getBoundingClientRect').mockReturnValue({
        top: -100,
        left: 0,
        right: 800,
        bottom: 600,
        width: 800,
        height: 700,
      });

      // Mock window dimensions
      const origInnerWidth = window.innerWidth;
      const origInnerHeight = window.innerHeight;
      Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });

      manager.activeDialog.value = createSurface({ mode: 'dialog' });
      const wrapper = mount(SurfaceHost, {
        props: { geometryTarget: layers },
        global: {
          provide: { surfaceManager: manager },
          stubs: { teleport: true },
        },
      });
      await flushGeometry();

      const host = wrapper.find('.sd-surface-host');
      expect(host.element.style.position).toBe('fixed');
      // The host should be clipped by the scroll wrapper:
      // top = max(layers.top=-100, wrapper.top=0, viewport=0) = 0
      // bottom = min(layers.bottom=600, wrapper.bottom=300, viewport=768) = 300
      // So height = 300, not 600 or 700
      expect(host.element.style.top).toBe('0px');
      expect(host.element.style.height).toBe('300px');
      expect(host.element.style.width).toBe('800px');

      // Restore
      Object.defineProperty(window, 'innerWidth', { value: origInnerWidth, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: origInnerHeight, configurable: true });
      wrapper.unmount();
      scrollWrapper.remove();
    });
  });
});
