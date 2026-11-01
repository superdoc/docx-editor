import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { mount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import FontFamilyCombobox from './FontFamilyCombobox.vue';

let wrapper;
const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');

const makeItem = (overrides = {}) => ({
  id: ref('font-family'),
  type: 'dropdown',
  name: ref('fontFamily'),
  command: 'setFontFamily',
  label: ref('Arial'),
  defaultLabel: ref('Arial'),
  selectedValue: ref('Arial'),
  disabled: ref(false),
  expand: ref(false),
  style: ref({ width: '116px' }),
  attributes: ref({ ariaLabel: 'Font family' }),
  nestedOptions: ref([
    {
      key: 'Arial',
      label: 'Arial',
      props: { style: { fontFamily: 'Liberation Sans, sans-serif' }, 'data-item': 'btn-fontFamily-option' },
    },
    {
      key: 'Courier New',
      label: 'Courier New',
      props: { style: { fontFamily: 'Liberation Mono, monospace' }, 'data-item': 'btn-fontFamily-option' },
    },
    {
      key: 'Times New Roman',
      label: 'Times New Roman',
      props: { style: { fontFamily: 'Liberation Serif, serif' }, 'data-item': 'btn-fontFamily-option' },
    },
  ]),
  ...overrides,
});

const mountCombobox = (item = makeItem()) => {
  wrapper = mount(FontFamilyCombobox, {
    props: { item, uiFontFamily: 'Inter, sans-serif' },
    global: { provide: { sdToolbarOwnerId: 'font-editor-owner' } },
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
  await wrapper.get('[data-item="btn-fontFamily-toggle"]').trigger('mousedown');
  await nextTick();
  await nextTick();
};

const dispatchKey = (el, key) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  return event;
};

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

describe('FontFamilyCombobox', () => {
  it('carries editor ownership into the teleported font listbox', async () => {
    mountCombobox();
    await openViaChevron();
    expect(document.querySelector('.sd-font-combobox__listbox')?.dataset.superdocUiOwner).toBe('font-editor-owner');
  });

  it('shows the applied font and labels the control', () => {
    const { input } = mountCombobox();

    expect(input.element.value).toBe('Arial');
    expect(input.attributes('aria-label')).toBe('Font family');
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
    expect(input.element.selectionEnd).toBe('Arial'.length);
  });

  it('opens the list and focuses the current option when the chevron is clicked', async () => {
    mockScrollIntoView();
    const { input } = mountCombobox();

    await openViaChevron();

    expect(document.body.querySelector('[role="listbox"]')).not.toBeNull();
    expect(input.attributes('aria-expanded')).toBe('true');

    const options = document.body.querySelectorAll('[role="option"]');
    expect(options).toHaveLength(3);
    expect(document.activeElement).toBe(options[0]);
    expect(document.body.querySelector('[aria-selected="true"]')?.textContent).toContain('Arial');
    expect(document.body.querySelector('.sd-active')?.textContent).toContain('Arial');
  });

  it('opens the list and moves focus into it on ArrowDown from the input', async () => {
    mockScrollIntoView();
    const { input } = mountCombobox();

    await input.trigger('focus');
    await input.trigger('keydown', { key: 'ArrowDown' });
    await nextTick();
    await nextTick();

    const options = document.body.querySelectorAll('[role="option"]');
    expect(options).toHaveLength(3);
    expect(document.activeElement).toBe(options[0]);
  });

  it('autocompletes a typed prefix to the matching font and selects the suffix', async () => {
    const { input } = mountCombobox();

    await input.trigger('focus');
    await input.setValue('cour');

    expect(input.element.value).toBe('Courier New');

    await input.trigger('keydown', { key: 'Enter' });

    const event = wrapper.emitted('command')?.[0]?.[0];
    expect(event.argument).toBe('Courier New');
    expect(event.item.command).toBe('setFontFamily');
  });

  it('preserves a custom typed family that is not in the list on Enter', async () => {
    const { input } = mountCombobox();

    await input.trigger('focus');
    await input.setValue('Brand Sans');
    await input.trigger('keydown', { key: 'Enter' });

    expect(wrapper.emitted('command')?.[0]?.[0]).toMatchObject({
      argument: 'Brand Sans',
      option: null,
    });
  });

  it('moves the highlight with arrows and applies the focused option on Enter from the list', async () => {
    mockScrollIntoView();
    mountCombobox();

    await openViaChevron();

    let options = document.body.querySelectorAll('[role="option"]');
    dispatchKey(options[0], 'ArrowDown');
    await nextTick();

    expect(document.body.querySelector('.sd-active')?.textContent).toContain('Courier New');
    options = document.body.querySelectorAll('[role="option"]');
    expect(document.activeElement).toBe(options[1]);

    dispatchKey(options[1], 'Enter');
    await nextTick();

    expect(wrapper.emitted('command')?.[0]?.[0].argument).toBe('Courier New');
    expect(wrapper.emitted('editor-handoff')).toHaveLength(1);
  });

  it('shows an option label but applies its font-family value', async () => {
    mockScrollIntoView();
    const item = makeItem({
      label: ref('Corporate Sans'),
      selectedValue: ref('Arial'),
      nestedOptions: ref([
        {
          key: 'Arial',
          value: 'Arial',
          label: 'Corporate Sans',
          props: { style: { fontFamily: 'Arial, sans-serif' }, 'data-item': 'btn-fontFamily-option' },
        },
      ]),
    });
    const { input } = mountCombobox(item);

    expect(input.element.value).toBe('Corporate Sans');
    await openViaChevron();
    const option = document.body.querySelector('[role="option"]');
    dispatchKey(option, 'Enter');
    await nextTick();

    expect(wrapper.emitted('command')?.[0]?.[0]).toMatchObject({
      argument: 'Arial',
      option: { value: 'Arial', label: 'Corporate Sans' },
    });
  });

  it('shows a blank field for a mixed (multi-font) selection', () => {
    const item = makeItem({ label: ref(''), selectedValue: ref('') });
    const { input } = mountCombobox(item);

    expect(input.element.value).toBe('');
    expect(document.body.querySelector('[aria-selected="true"]')).toBeNull();
  });

  it('applies an autocompleted font on Tab and delegates toolbar focus movement', async () => {
    const { input } = mountCombobox();

    await input.trigger('focus');
    await input.setValue('cour');
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    input.element.dispatchEvent(event);
    await nextTick();

    expect(event.defaultPrevented).toBe(true);
    expect(wrapper.emitted('command')?.[0]?.[0].argument).toBe('Courier New');
    expect(wrapper.emitted('tab-out')?.[0]?.[0]).toBe(event);
  });

  it('applies the focused option and emits tab-out from the open list', async () => {
    mockScrollIntoView();
    const { input } = mountCombobox();

    await openViaChevron();

    const option = document.body.querySelector('[role="option"]');
    const event = dispatchKey(option, 'Tab');
    await nextTick();

    expect(event.defaultPrevented).toBe(true);
    expect(wrapper.emitted('command')?.[0]?.[0].argument).toBe('Arial');
    const tabOut = wrapper.emitted('tab-out');
    expect(tabOut).toHaveLength(1);
    expect(tabOut[0][0].shiftKey).toBe(false);
    expect(tabOut[0][0].target).toBe(input.element);
  });

  it('hands off to the editor on Enter after applying a font', async () => {
    const { input } = mountCombobox();

    await input.trigger('focus');
    await input.setValue('cour');
    await input.trigger('keydown', { key: 'Enter' });

    expect(wrapper.emitted('editor-handoff')).toHaveLength(1);
  });

  it('restores the applied label on Escape without applying a command', async () => {
    const { input } = mountCombobox();

    await input.trigger('focus');
    await input.setValue('Brand Sans');
    expect(input.element.value).toBe('Brand Sans');

    await input.trigger('keydown', { key: 'Escape' });
    await nextTick();

    expect(input.element.value).toBe('Arial');
    expect(wrapper.emitted('command')).toBeUndefined();
  });

  it('closes the list and returns focus to the input on Escape from the list', async () => {
    mockScrollIntoView();
    const { input } = mountCombobox();

    await openViaChevron();

    const option = document.body.querySelector('[role="option"]');
    dispatchKey(option, 'Escape');
    await nextTick();
    await nextTick();

    expect(document.body.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(input.element);
    expect(wrapper.emitted('command')).toBeUndefined();
  });

  it('opens when the toolbar item expand flag is set by roving keyboard activation', async () => {
    const { item, input } = mountCombobox();

    item.expand.value = true;
    await nextTick();
    await nextTick();

    expect(document.body.querySelector('[role="listbox"]')).not.toBeNull();
    expect(input.attributes('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(input.element);
  });
});
