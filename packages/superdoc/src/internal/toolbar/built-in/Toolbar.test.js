import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import Toolbar from './Toolbar.vue';
import { useToolbarItem } from './use-toolbar-item.js';

let wrapper;
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.useRealTimers();
  document.body.innerHTML = '';
});

function mountToolbar({ overflowBelow = 0 } = {}) {
  let width = 1200;
  const listeners = new Map();
  const item = useToolbarItem({
    type: 'button',
    name: 'watermark',
    defaultLabel: 'Watermark',
    attributes: { ariaLabel: 'Watermark' },
  });
  const overflow = useToolbarItem({
    type: 'overflow',
    name: 'overflow',
    defaultLabel: 'Overflow items',
    attributes: { ariaLabel: 'Overflow items' },
  });
  const toolbar = {
    config: { toolbarGroups: ['left', 'center'] },
    get overflowItems() {
      return width < overflowBelow ? [item] : [];
    },
    getToolbarItemByGroup: (group) => (group === 'center' ? [width < overflowBelow ? overflow : item] : []),
    getAvailableWidth: () => width,
    onToolbarResize: vi.fn(),
    on: (event, listener) => listeners.set(event, listener),
    off: (event) => listeners.delete(event),
  };
  wrapper = mount(Toolbar, {
    attachTo: document.body,
    global: { config: { globalProperties: { $toolbar: toolbar } } },
  });
  return {
    toolbar,
    setWidth: (value) => {
      width = value;
    },
    emit: (event) => listeners.get(event)?.(),
  };
}

describe('Toolbar responsive layout', () => {
  it('preserves mounted focus targets when duplicate resize notifications report the same width', async () => {
    vi.useFakeTimers();
    const { toolbar, setWidth, emit } = mountToolbar();
    setWidth(320);
    window.dispatchEvent(new Event('resize'));
    await nextTick();
    await nextTick();
    const opener = wrapper.get('[aria-label="Watermark"]').element;
    opener.focus();

    window.dispatchEvent(new Event('resize'));
    await vi.advanceTimersByTimeAsync(300);
    await nextTick();

    expect(opener.isConnected).toBe(true);
    expect(document.activeElement).toBe(opener);
    expect(toolbar.onToolbarResize).toHaveBeenCalledOnce();

    setWidth(768);
    window.dispatchEvent(new Event('resize'));
    await vi.advanceTimersByTimeAsync(300);
    await nextTick();
    expect(toolbar.onToolbarResize).toHaveBeenCalledTimes(2);
    expect(opener.isConnected).toBe(false);

    const resizedButton = wrapper.get('[aria-label="Watermark"]').element;
    expect(wrapper.get('.superdoc-toolbar-group-side').element.style.minWidth).toBe('auto');
    setWidth(1366);
    emit('toolbar-items-changed');
    await nextTick();
    expect(resizedButton.isConnected).toBe(false);
    expect(wrapper.get('.superdoc-toolbar-group-side').element.style.minWidth).toBe('120px');
  });

  it.each(['resize', 'items'])('keeps the currently focused control after a %s rebuild', async (source) => {
    const { setWidth, emit } = mountToolbar();
    const original = wrapper.get('[aria-label="Watermark"]').element;
    original.focus();
    if (source === 'resize') {
      setWidth(768);
      window.dispatchEvent(new Event('resize'));
    } else {
      emit('toolbar-items-changed');
    }
    await nextTick();
    await nextTick();
    expect(original.isConnected).toBe(false);
    expect(document.activeElement).toBe(wrapper.get('[aria-label="Watermark"]').element);
  });

  it('moves focus to its own overflow trigger when the focused control moves into overflow', async () => {
    const { setWidth } = mountToolbar({ overflowBelow: 600 });
    wrapper.get('[aria-label="Watermark"]').element.focus();
    setWidth(320);
    window.dispatchEvent(new Event('resize'));
    await nextTick();
    await nextTick();
    expect(document.activeElement).toBe(wrapper.get('[aria-label="Overflow items"]').element);
  });

  it.each(['before', 'during'])('does not take focus from an external dialog focused %s rebuilding', async (timing) => {
    const { setWidth } = mountToolbar();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const close = document.createElement('button');
    close.textContent = 'Close dialog';
    dialog.append(close);
    document.body.append(dialog);
    wrapper.get('[aria-label="Watermark"]').element.focus();
    if (timing === 'before') close.focus();
    setWidth(768);
    window.dispatchEvent(new Event('resize'));
    if (timing === 'during') close.focus();
    await nextTick();
    await nextTick();
    expect(document.activeElement).toBe(close);
  });

  it('cancels queued resize work when the toolbar unmounts', async () => {
    vi.useFakeTimers();
    const { toolbar, setWidth } = mountToolbar();
    setWidth(768);
    window.dispatchEvent(new Event('resize'));
    await nextTick();
    setWidth(320);
    window.dispatchEvent(new Event('resize'));
    wrapper.unmount();
    wrapper = null;
    await vi.advanceTimersByTimeAsync(300);
    expect(toolbar.onToolbarResize).toHaveBeenCalledOnce();
  });
});
