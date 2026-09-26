import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import ButtonGroup from './ButtonGroup.vue';
import { useToolbarItem } from './use-toolbar-item.js';
import { TOOLBAR_FONTS, TOOLBAR_FONT_SIZES } from './constants.js';

let wrapper;

const makeFontControls = () => {
  const fontFamily = useToolbarItem({
    type: 'dropdown',
    name: 'fontFamily',
    command: 'setFontFamily',
    label: 'Arial',
    defaultLabel: 'Arial',
    hasCaret: true,
    hasInlineTextInput: true,
    inlineTextInputVisible: true,
    isWide: true,
    attributes: { ariaLabel: 'Font family' },
    options: TOOLBAR_FONTS,
  });
  const separator = useToolbarItem({ type: 'separator', name: 'separator', isNarrow: true });
  const fontSize = useToolbarItem({
    type: 'dropdown',
    name: 'fontSize',
    command: 'setFontSize',
    label: '12',
    defaultLabel: '12',
    hasCaret: true,
    hasInlineTextInput: true,
    inlineTextInputVisible: true,
    isWide: true,
    attributes: { ariaLabel: 'Font size' },
    options: TOOLBAR_FONT_SIZES,
  });
  return [fontFamily, separator, fontSize];
};

const mountGroup = (toolbarItems) => {
  wrapper = mount(ButtonGroup, {
    props: { toolbarItems, overflowItems: [], position: 'center' },
    attachTo: document.body,
    global: {
      config: {
        globalProperties: {
          $toolbar: { toolbarItems, overflowItems: [] },
        },
      },
    },
  });
  return wrapper;
};

const mountOverflowGroup = (attachTo = document.body, additionalItems = []) => {
  const overflow = useToolbarItem({
    type: 'overflow',
    name: 'overflow',
    attributes: { ariaLabel: 'Overflow items' },
  });
  const bold = useToolbarItem({
    type: 'button',
    name: 'bold',
    command: 'bold',
    defaultLabel: 'Bold',
    attributes: { ariaLabel: 'Bold' },
  });
  const zoom = useToolbarItem({
    type: 'dropdown',
    name: 'zoom',
    command: 'setZoom',
    label: '100%',
    defaultLabel: '100%',
    hasCaret: true,
    attributes: { ariaLabel: 'Zoom' },
    options: [{ label: '125%', key: 1.25, props: { 'data-item': 'btn-zoom-option' } }],
  });
  const toolbarItems = [overflow];
  const overflowItems = [bold, zoom, ...additionalItems];
  const emitCommand = vi.fn();

  wrapper = mount(ButtonGroup, {
    props: { toolbarItems, overflowItems, position: 'right', onCommand: emitCommand },
    attachTo,
    global: {
      config: {
        globalProperties: {
          $toolbar: { emitCommand, toolbarItems, overflowItems },
        },
      },
    },
  });
  return { emitCommand, wrapper };
};

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
  document.body.innerHTML = '';
});

describe('ButtonGroup button activation', () => {
  it('consumes Enter when opening a surface so its newly focused button is not activated', () => {
    const item = useToolbarItem({
      type: 'button',
      name: 'watermark',
      defaultLabel: 'Watermark',
      attributes: { ariaLabel: 'Watermark' },
    });
    mountGroup([item]);
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    wrapper.get('[aria-label="Watermark"]').element.dispatchEvent(event);

    expect(wrapper.emitted('command')).toEqual([[{ item }]]);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('ButtonGroup font-family combobox wiring', () => {
  it('renders the editable combobox for the font-family item', () => {
    mountGroup(makeFontControls());

    const combobox = document.body.querySelector('[data-item="btn-fontFamily"] input[role="combobox"]');
    expect(combobox).not.toBeNull();
    expect(combobox?.getAttribute('aria-label')).toBe('Font family');
  });

  it('renders the editable combobox for the font-size item', () => {
    mountGroup(makeFontControls());

    const combobox = document.body.querySelector('[data-item="btn-fontSize"] input[role="combobox"]');
    expect(combobox).not.toBeNull();
    expect(combobox?.getAttribute('aria-label')).toBe('Font size');
  });

  it('moves focus from the font-family combobox to the font-size field on Tab', async () => {
    mountGroup(makeFontControls());

    const combobox = wrapper.get('[data-item="btn-fontFamily"] input[role="combobox"]');
    combobox.element.focus();
    await combobox.trigger('keydown', { key: 'Tab' });
    await nextTick();

    const fontSizeInput = document.getElementById('inlineTextInput-fontSize');
    expect(fontSizeInput).not.toBeNull();
    expect(document.activeElement).toBe(fontSizeInput);
  });

  it('moves focus from the font-size field back to the font-family combobox on Shift+Tab', async () => {
    mountGroup(makeFontControls());

    const fontSizeInput = document.getElementById('inlineTextInput-fontSize');
    fontSizeInput.focus();
    fontSizeInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
    );
    await nextTick();
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const combobox = document.getElementById('inlineTextInput-fontFamily');
    expect(combobox).not.toBeNull();
    expect(document.activeElement).toBe(combobox);
  });

  it('moves focus from the font-size combobox to the editor on Tab (Word chain end)', async () => {
    const editor = document.createElement('div');
    editor.className = 'ProseMirror';
    editor.tabIndex = -1;
    document.body.appendChild(editor);

    mountGroup(makeFontControls());

    const fontSizeInput = document.getElementById('inlineTextInput-fontSize');
    fontSizeInput.focus();
    fontSizeInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    await nextTick();

    expect(document.activeElement).toBe(editor);
    editor.remove();
  });
});

describe('ButtonGroup overflow menu', () => {
  it('closes overflow and focuses its durable trigger before opening the Watermark dialog', async () => {
    const watermark = useToolbarItem({
      type: 'button',
      name: 'watermark',
      defaultLabel: 'Watermark',
      attributes: { ariaLabel: 'Watermark' },
    });
    const { emitCommand } = mountOverflowGroup(document.body, [watermark]);
    const trigger = wrapper.get('[aria-label="Overflow items"]');
    await trigger.trigger('click');
    await nextTick();
    const button = document.body.querySelector('[aria-label="Watermark"]');
    button.focus();
    let focusAtCommand;
    emitCommand.mockImplementation(() => {
      focusAtCommand = document.activeElement;
    });

    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await nextTick();

    expect(emitCommand).toHaveBeenCalledOnce();
    expect(focusAtCommand).toBe(trigger.element);
    expect(document.body.querySelector('.sd-toolbar-overflow-menu')).toBeNull();
  });

  it('keeps pointer actions from taking focus away from the editor', async () => {
    const editor = document.createElement('div');
    editor.tabIndex = -1;
    document.body.appendChild(editor);
    editor.focus();

    mountOverflowGroup();
    await wrapper.get('[aria-label="Overflow items"]').trigger('click');
    await nextTick();

    const bold = document.body.querySelector('[aria-label="Bold"]');
    const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });

    expect(bold.dispatchEvent(mouseDown)).toBe(false);
    expect(mouseDown.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(editor);
  });

  it('renders the menu outside the toolbar host so clipping containers cannot hide it', async () => {
    mountOverflowGroup();

    await wrapper.get('[aria-label="Overflow items"]').trigger('click');
    await nextTick();

    const menu = document.body.querySelector('.sd-toolbar-overflow-menu');
    expect(menu).not.toBeNull();
    expect(wrapper.element.contains(menu)).toBe(false);
    expect(menu.style.position).toBe('fixed');
  });

  it('keeps the menu inside the browser fullscreen element', async () => {
    const fullscreenRoot = document.createElement('section');
    document.body.append(fullscreenRoot);
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: fullscreenRoot });

    const overflow = useToolbarItem({
      type: 'overflow',
      name: 'overflow',
      attributes: { ariaLabel: 'Overflow items' },
    });
    const bold = useToolbarItem({
      type: 'button',
      name: 'bold',
      command: 'bold',
      defaultLabel: 'Bold',
      attributes: { ariaLabel: 'Bold' },
    });
    const toolbarItems = [overflow];
    const overflowItems = [bold];

    wrapper = mount(ButtonGroup, {
      props: { toolbarItems, overflowItems, position: 'right' },
      attachTo: fullscreenRoot,
      global: {
        config: {
          globalProperties: {
            $toolbar: { emitCommand: vi.fn(), toolbarItems, overflowItems },
          },
        },
      },
    });

    await wrapper.get('[aria-label="Overflow items"]').trigger('click');
    await nextTick();

    const menu = fullscreenRoot.querySelector('.sd-toolbar-overflow-menu');
    expect(menu).not.toBeNull();
    expect(wrapper.element.contains(menu)).toBe(false);
  });

  it('moves an open menu when the browser enters and exits fullscreen', async () => {
    const fullscreenRoot = document.createElement('section');
    document.body.append(fullscreenRoot);
    mountOverflowGroup(fullscreenRoot);

    await wrapper.get('[aria-label="Overflow items"]').trigger('click');
    await nextTick();
    const menu = document.body.querySelector('.sd-toolbar-overflow-menu');
    expect(menu).not.toBeNull();
    expect(fullscreenRoot.contains(menu)).toBe(false);

    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: fullscreenRoot });
    document.dispatchEvent(new Event('fullscreenchange'));
    await nextTick();
    await nextTick();

    expect(fullscreenRoot.contains(menu)).toBe(true);

    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
    document.dispatchEvent(new Event('fullscreenchange'));
    await nextTick();
    await nextTick();

    expect(fullscreenRoot.contains(menu)).toBe(false);
  });

  it('keeps teleported controls interactive and closes the menu with Escape', async () => {
    const { emitCommand } = mountOverflowGroup();
    const trigger = wrapper.get('[aria-label="Overflow items"]');

    await trigger.trigger('keydown', { key: 'Enter' });
    await nextTick();
    const bold = document.body.querySelector('[aria-label="Bold"]');
    expect(bold).not.toBeNull();
    bold.click();
    await nextTick();

    expect(emitCommand).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await nextTick();

    expect(document.body.querySelector('.sd-toolbar-overflow-menu')).toBeNull();
  });

  it('keeps nested dropdown controls usable inside the overflow panel', async () => {
    const { emitCommand } = mountOverflowGroup();

    await wrapper.get('[aria-label="Overflow items"]').trigger('click');
    await nextTick();

    const zoom = document.body.querySelector('[aria-label="Zoom"]');
    zoom.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    zoom.click();
    await nextTick();

    expect(document.body.querySelector('.sd-toolbar-overflow-menu')).not.toBeNull();
    const zoom125 = document.body.querySelector('[data-item="btn-zoom-option"]');
    expect(zoom125).not.toBeNull();

    zoom125.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    zoom125.click();
    await nextTick();

    expect(emitCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        argument: '125%',
        option: expect.objectContaining({ label: '125%', key: 1.25 }),
      }),
    );
    expect(document.body.querySelector('.sd-toolbar-overflow-menu')).not.toBeNull();
  });
});
