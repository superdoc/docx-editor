import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { mount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import FontSizeCombobox from './FontSizeCombobox.vue';
import { TOOLBAR_FONT_SIZES } from './constants.js';

let wrapper;
const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');

const makeItem = (overrides = {}) => ({
  id: ref('font-size'),
  type: 'dropdown',
  name: ref('fontSize'),
  command: 'setFontSize',
  label: ref('12'),
  defaultLabel: ref('12'),
  selectedValue: ref('12pt'),
  disabled: ref(false),
  expand: ref(false),
  style: ref({ width: '56px' }),
  attributes: ref({ ariaLabel: 'Font size' }),
  nestedOptions: ref(TOOLBAR_FONT_SIZES),
  ...overrides,
});

const mountCombobox = (item = makeItem()) => {
  wrapper = mount(FontSizeCombobox, {
    props: { item, uiFontFamily: 'Inter, sans-serif' },
    attachTo: document.body,
  });
  return { item, input: wrapper.get('input') };
};

const mockScrollIntoView = () => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
};

const openViaChevron = async () => {
  await wrapper.get('[data-item="btn-fontSize-toggle"]').trigger('mousedown');
  await nextTick();
  await nextTick();
};

const optionByLabel = (labelText) =>
  [...document.body.querySelectorAll('[role="option"]')].find((el) => el.textContent.trim() === labelText);

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
  if (originalScrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView);
  } else {
    delete HTMLElement.prototype.scrollIntoView;
  }
  vi.restoreAllMocks();
});

describe('FontSizeCombobox', () => {
  it('shows the applied size and labels the control', () => {
    const { input } = mountCombobox();

    expect(input.element.value).toBe('12');
    expect(input.attributes('aria-label')).toBe('Font size');
    expect(input.attributes('role')).toBe('combobox');
  });

  it('opens the list and focuses the field for typing when the input is clicked (SD-3652)', async () => {
    const { input } = mountCombobox();
    const focusSpy = vi.spyOn(input.element, 'focus');

    await input.trigger('mousedown');
    await nextTick();

    // Clicking anywhere in the field opens the dropdown (parity with v1 SD-3453),
    // not only the chevron, while still focusing the field for typeahead.
    expect(document.body.querySelector('[role="listbox"]')).not.toBeNull();
    expect(input.attributes('aria-expanded')).toBe('true');
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.activeElement).toBe(input.element);
    expect(input.element.selectionStart).toBe(0);
    expect(input.element.selectionEnd).toBe('12'.length);
  });

  it('opens the preset list and focuses + highlights the current size on chevron click', async () => {
    mockScrollIntoView();
    const { input } = mountCombobox();

    await openViaChevron();

    expect(document.body.querySelector('[role="listbox"]')).not.toBeNull();
    expect(input.attributes('aria-expanded')).toBe('true');

    const options = document.body.querySelectorAll('[role="option"]');
    expect(options).toHaveLength(TOOLBAR_FONT_SIZES.length);
    expect(document.activeElement?.textContent).toContain('12');
    expect(document.body.querySelector('[aria-selected="true"]')?.textContent).toContain('12');
    expect(document.body.querySelector('.sd-selected')?.textContent).toContain('12');
  });

  it('applies a typed size on Enter via setFontSize and hands off to the editor', async () => {
    const { input } = mountCombobox();

    await input.trigger('focus');
    await input.setValue('13');
    expect(input.element.value).toBe('13');

    await input.trigger('keydown', { key: 'Enter' });

    const event = wrapper.emitted('command')?.[0]?.[0];
    expect(event.argument).toBe('13');
    expect(event.item.command).toBe('setFontSize');
    expect(wrapper.emitted('editor-handoff')).toHaveLength(1);
  });

  it('applies a preset size when an option is selected', async () => {
    mockScrollIntoView();
    mountCombobox();

    await openViaChevron();

    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    optionByLabel('24').dispatchEvent(event);
    await nextTick();

    expect(event.defaultPrevented).toBe(true);
    expect(wrapper.emitted('command')?.[0]?.[0].argument).toBe('24');
    expect(wrapper.emitted('editor-handoff')).toHaveLength(1);
  });

  it('shows a blank field for a mixed (multi-size) selection', () => {
    const item = makeItem({ label: ref(''), selectedValue: ref('') });
    const { input } = mountCombobox(item);

    expect(input.element.value).toBe('');
    expect(document.body.querySelector('[aria-selected="true"]')).toBeNull();
  });
});
