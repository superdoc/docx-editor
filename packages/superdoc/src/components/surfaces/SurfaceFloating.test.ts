import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { defineComponent, h, markRaw, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import SurfaceFloating from './SurfaceFloating.vue';

const TestContent = defineComponent({
  setup() {
    return () => h('input', { class: 'test-input' });
  },
});

function createFloatingSurface(floating) {
  return {
    id: 'float-1',
    request: {
      id: 'float-1',
      mode: 'floating',
      floating,
    },
    component: markRaw(TestContent),
    props: {},
    render: null,
    resolve: vi.fn(),
    close: vi.fn(),
  };
}

async function flushClamp() {
  await nextTick();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await nextTick();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SurfaceFloating', () => {
  it('autoFocus prefers a [data-sd-autofocus] element over the first focusable', async () => {
    const MarkedContent = defineComponent({
      setup() {
        return () => [
          h('button', { class: 'first-button', type: 'button' }, 'expander'),
          h('input', { class: 'marked-input', 'data-sd-autofocus': '' }),
        ];
      },
    });
    const surface = createFloatingSurface({ autoFocus: true });
    surface.component = markRaw(MarkedContent);
    const wrapper = mount(SurfaceFloating, {
      props: { surface },
      attachTo: document.body,
    });
    await flushClamp();
    expect(document.activeElement?.className).toBe('marked-input');
    wrapper.unmount();
  });

  it('clamps explicit left positioning inside the host bounds', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const wrapper = mount(SurfaceFloating, {
      attachTo: host,
      props: {
        surface: createFloatingSurface({
          top: 24,
          left: 290,
          width: 200,
        }),
      },
    });
    vi.spyOn(wrapper.element.parentElement, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      left: 0,
      right: 320,
      bottom: 240,
      width: 320,
      height: 240,
    });
    vi.spyOn(wrapper.element, 'getBoundingClientRect').mockReturnValue({
      top: 24,
      left: 290,
      right: 490,
      bottom: 104,
      width: 200,
      height: 80,
    });

    await flushClamp();

    expect(wrapper.element.style.left).toBe('112px');

    wrapper.unmount();
    host.remove();
  });

  it('reclamps explicit positioning when observed host bounds change', async () => {
    const observed = [];
    let observerCallback = null;
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      vi.fn(function ResizeObserver(callback) {
        observerCallback = callback;
        this.observe = vi.fn((element) => observed.push(element));
        this.disconnect = disconnect;
      }),
    );

    const host = document.createElement('div');
    document.body.appendChild(host);
    const wrapper = mount(SurfaceFloating, {
      attachTo: host,
      props: {
        surface: createFloatingSurface({
          top: 24,
          left: 290,
          width: 200,
        }),
      },
    });
    const hostRect = vi.spyOn(wrapper.element.parentElement, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      left: 0,
      right: 320,
      bottom: 240,
      width: 320,
      height: 240,
    });
    const floatingRect = vi.spyOn(wrapper.element, 'getBoundingClientRect').mockReturnValue({
      top: 24,
      left: 290,
      right: 490,
      bottom: 104,
      width: 200,
      height: 80,
    });

    await flushClamp();

    expect(wrapper.element.style.left).toBe('112px');
    expect(observed).toContain(wrapper.element.parentElement);
    expect(observed).toContain(wrapper.element);

    hostRect.mockReturnValue({
      top: 0,
      left: 0,
      right: 260,
      bottom: 240,
      width: 260,
      height: 240,
    });
    floatingRect.mockReturnValue({
      top: 24,
      left: 112,
      right: 312,
      bottom: 104,
      width: 200,
      height: 80,
    });

    observerCallback();
    await flushClamp();

    expect(wrapper.element.style.left).toBe('52px');

    wrapper.unmount();
    expect(disconnect).toHaveBeenCalled();
    host.remove();
  });
});
