import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import PageNumberMenu from './PageNumberMenu.vue';

const ENABLED = { enabled: true, disabled: false };
const DISABLED = { enabled: false, disabled: true, reason: 'context-unavailable' };
const NUMBERED_FOOTER = {
  section: { kind: 'section', sectionId: 'section-0' },
  placements: [{ kind: 'footer', alignment: 'right', parts: [{ kind: 'headerFooterPart', refId: 'rId7' }] }],
  showOnFirstPage: true,
  titlePage: false,
  format: 'decimal',
  start: null,
};

function mountMenu(props = {}) {
  const applyPageNumbers = vi.fn(async () => ({ success: true }));
  const removePageNumbers = vi.fn(async () => ({ success: true }));
  const insertAtCursor = vi.fn(async () => ({ success: true }));
  const close = vi.fn();
  const wrapper = mount(PageNumberMenu, {
    attachTo: document.body,
    props: {
      pageNumbersState: ENABLED,
      atCursorState: DISABLED,
      loadCurrent: async () => null,
      applyPageNumbers,
      removePageNumbers,
      insertAtCursor,
      close,
      ...props,
    },
  });
  return { wrapper, applyPageNumbers, removePageNumbers, insertAtCursor, close };
}

const selectedTile = (wrapper) => wrapper.get('[role="radio"][aria-checked="true"]');
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('PageNumberMenu', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('starts at the bottom right with the first page numbered and offers to add numbers', async () => {
    const { wrapper } = mountMenu();
    await flush();

    const tile = selectedTile(wrapper);
    expect(tile.attributes('aria-label')).toBe('Bottom of page, right');
    expect(document.activeElement).toBe(tile.element);
    expect(wrapper.get('[data-sd-page-number-first-page]').element.checked).toBe(true);
    expect(wrapper.get('[data-sd-page-number-format]').element.value).toBe('decimal');
    expect(wrapper.get('[data-sd-page-number-restart]').element.checked).toBe(false);
    expect(wrapper.get('[data-sd-page-number-start]').element.disabled).toBe(true);
    expect(wrapper.get('[data-sd-page-number-add]').text()).toBe('Add page numbers');
    expect(wrapper.find('[data-sd-page-number-remove]').exists()).toBe(false);
    expect(wrapper.findAll('[role="radio"]').filter((radio) => radio.attributes('tabindex') === '0')).toHaveLength(1);
  });

  it('restores the last choice made in this session when the section has no numbers', async () => {
    const { wrapper } = mountMenu({ initialChoice: { position: 'top', alignment: 'left', showOnFirstPage: false } });
    await flush();

    expect(selectedTile(wrapper).attributes('aria-label')).toBe('Top of page, left');
    expect(wrapper.get('[data-sd-page-number-first-page]').element.checked).toBe(false);
  });

  it('shows the section numbers it finds and offers to apply or remove them', async () => {
    const { wrapper } = mountMenu({
      initialChoice: { position: 'bottom', alignment: 'left' },
      loadCurrent: async () => ({
        ...NUMBERED_FOOTER,
        placements: [{ kind: 'header', alignment: 'center', parts: [] }],
        showOnFirstPage: false,
        format: 'lowerRoman',
        start: 5,
      }),
    });
    await flush();
    await flush();

    expect(selectedTile(wrapper).attributes('aria-label')).toBe('Top of page, center');
    expect(wrapper.get('[data-sd-page-number-first-page]').element.checked).toBe(false);
    expect(wrapper.get('[data-sd-page-number-format]').element.value).toBe('lowerRoman');
    expect(wrapper.get('[data-sd-page-number-restart]').element.checked).toBe(true);
    expect(wrapper.get('[data-sd-page-number-start]').element.value).toBe('5');
    expect(wrapper.get('[data-sd-page-number-add]').text()).toBe('Apply');
    expect(wrapper.find('[data-sd-page-number-remove]').exists()).toBe(true);
  });

  it('keeps a choice the user made before the section numbers loaded', async () => {
    let resolveLoad;
    const { wrapper } = mountMenu({ loadCurrent: () => new Promise((resolve) => (resolveLoad = resolve)) });
    await flush();

    await wrapper.get('[data-position="top"][data-alignment="left"]').trigger('click');
    resolveLoad(NUMBERED_FOOTER);
    await flush();
    await flush();

    expect(selectedTile(wrapper).attributes('aria-label')).toBe('Top of page, left');
    expect(wrapper.get('[data-sd-page-number-add]').text()).toBe('Apply');
  });

  it('waits for the section numbers before applying a commit made while they load', async () => {
    let resolveLoad;
    const { wrapper, applyPageNumbers } = mountMenu({
      loadCurrent: () => new Promise((resolve) => (resolveLoad = resolve)),
    });
    await flush();

    await wrapper.get('[data-position="bottom"][data-alignment="center"]').trigger('click');
    await wrapper.get('[data-sd-page-number-add]').trigger('click');
    await flush();
    expect(applyPageNumbers).not.toHaveBeenCalled();

    resolveLoad(NUMBERED_FOOTER);
    await flush();
    await flush();

    expect(applyPageNumbers).toHaveBeenCalledWith({ position: 'bottom', alignment: 'center' });
  });

  it('shows no tile selected for a number placed with tabs, and applies without realigning it', async () => {
    const { wrapper, applyPageNumbers } = mountMenu({
      loadCurrent: async () => ({ ...NUMBERED_FOOTER, placements: [{ kind: 'footer', alignment: null, parts: [] }] }),
    });
    await flush();
    await flush();

    expect(wrapper.find('[role="radio"][aria-checked="true"]').exists()).toBe(false);
    expect(wrapper.get('[data-position="bottom"][data-alignment="left"]').attributes('tabindex')).toBe('0');
    await wrapper.get('[data-sd-page-number-add]').trigger('click');
    await flush();

    expect(applyPageNumbers).toHaveBeenCalledWith({ position: 'bottom' });
  });

  it('moves the selection with arrow keys and adds with Enter', async () => {
    const { wrapper, applyPageNumbers, close } = mountMenu();
    await flush();

    await selectedTile(wrapper).trigger('keydown', { key: 'ArrowUp' });
    await selectedTile(wrapper).trigger('keydown', { key: 'ArrowLeft' });
    await flush();
    expect(selectedTile(wrapper).attributes('aria-label')).toBe('Top of page, center');
    expect(document.activeElement).toBe(selectedTile(wrapper).element);

    await selectedTile(wrapper).trigger('keydown', { key: 'Enter' });
    await flush();

    expect(applyPageNumbers).toHaveBeenCalledWith({ position: 'top', alignment: 'center', showOnFirstPage: true });
    expect(close).toHaveBeenCalledWith({
      action: 'apply',
      choice: { position: 'top', alignment: 'center', showOnFirstPage: true },
    });
  });

  it('jumps to the row ends with Home and End and ignores other keys', async () => {
    const { wrapper, applyPageNumbers } = mountMenu();
    await flush();

    await selectedTile(wrapper).trigger('keydown', { key: 'Home' });
    expect(selectedTile(wrapper).attributes('aria-label')).toBe('Bottom of page, left');
    await selectedTile(wrapper).trigger('keydown', { key: 'End' });
    expect(selectedTile(wrapper).attributes('aria-label')).toBe('Bottom of page, right');
    await selectedTile(wrapper).trigger('keydown', { key: 'a' });
    expect(selectedTile(wrapper).attributes('aria-label')).toBe('Bottom of page, right');
    expect(applyPageNumbers).not.toHaveBeenCalled();
  });

  it('sends only what changed when the section already has numbers', async () => {
    const { wrapper, applyPageNumbers } = mountMenu({ loadCurrent: async () => NUMBERED_FOOTER });
    await flush();
    await flush();

    await wrapper.get('[data-position="bottom"][data-alignment="center"]').trigger('click');
    await wrapper.get('[data-sd-page-number-add]').trigger('click');
    await flush();

    expect(applyPageNumbers).toHaveBeenCalledWith({ position: 'bottom', alignment: 'center' });
  });

  it('sends the number style and start, and null to continue numbering', async () => {
    const { wrapper, applyPageNumbers } = mountMenu({ loadCurrent: async () => ({ ...NUMBERED_FOOTER, start: 4 }) });
    await flush();
    await flush();

    await wrapper.get('[data-sd-page-number-format]').setValue('upperRoman');
    await wrapper.get('[data-sd-page-number-start]').setValue('7');
    await wrapper.get('[data-sd-page-number-add]').trigger('click');
    await flush();
    expect(applyPageNumbers).toHaveBeenLastCalledWith({ position: 'bottom', format: 'upperRoman', start: 7 });

    await wrapper.get('[data-sd-page-number-restart]').setValue(false);
    await wrapper.get('[data-sd-page-number-add]').trigger('click');
    await flush();
    expect(applyPageNumbers).toHaveBeenLastCalledWith({ position: 'bottom', format: 'upperRoman', start: null });
  });

  it('removes the section numbers and reports where they were', async () => {
    const { wrapper, removePageNumbers, close } = mountMenu({ loadCurrent: async () => NUMBERED_FOOTER });
    await flush();
    await flush();

    await wrapper.get('[data-sd-page-number-remove]').trigger('click');
    await flush();

    expect(removePageNumbers).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith({ action: 'remove', kinds: ['footer'] });
  });

  it('stays open and explains a number that shares its line with other text', async () => {
    const { wrapper, applyPageNumbers, close } = mountMenu({ loadCurrent: async () => NUMBERED_FOOTER });
    applyPageNumbers.mockResolvedValueOnce({
      success: false,
      failure: { code: 'PRECONDITION_FAILED', details: { reason: 'page-number-has-content', kind: 'footer' } },
    });
    await flush();
    await flush();

    await wrapper.get('[data-position="top"][data-alignment="right"]').trigger('click');
    await wrapper.get('[data-sd-page-number-add]').trigger('click');
    await flush();

    expect(close).not.toHaveBeenCalled();
    expect(wrapper.get('[role="alert"]').text()).toBe(
      'A page number shares its line with other text. Edit the footer directly to change it.',
    );
  });

  it('closes when the controller settles a command as true', async () => {
    const { wrapper, applyPageNumbers, close } = mountMenu();
    applyPageNumbers.mockResolvedValueOnce(true);
    await flush();

    await wrapper.get('[data-sd-page-number-add]').trigger('click');
    await flush();

    expect(close).toHaveBeenCalledWith({
      action: 'apply',
      choice: { position: 'bottom', alignment: 'right', showOnFirstPage: true },
    });
  });

  it('explains a section that already has page numbers, and a failed remove', async () => {
    const { wrapper, applyPageNumbers, removePageNumbers, close } = mountMenu({
      loadCurrent: async () => NUMBERED_FOOTER,
    });
    applyPageNumbers.mockResolvedValueOnce({
      success: false,
      failure: { code: 'PRECONDITION_FAILED', details: { reason: 'page-number-exists' } },
    });
    removePageNumbers.mockResolvedValueOnce({ success: false, failure: { code: 'NO_OP', details: 'none' } });
    await flush();
    await flush();

    await wrapper.get('[data-position="top"][data-alignment="right"]').trigger('click');
    await wrapper.get('[data-sd-page-number-add]').trigger('click');
    await flush();
    expect(wrapper.get('[role="alert"]').text()).toBe('This section already has page numbers.');

    await wrapper.get('[data-sd-page-number-remove]').trigger('click');
    await flush();
    expect(wrapper.get('[role="alert"]').text()).toBe('Page numbers couldn’t be removed. Try again.');
    expect(close).not.toHaveBeenCalled();
  });

  it('stays open with a retry message when adding fails', async () => {
    const { wrapper, applyPageNumbers, close } = mountMenu();
    applyPageNumbers.mockResolvedValueOnce(false);
    await flush();

    await wrapper.get('[data-sd-page-number-add]').trigger('click');
    await flush();

    expect(close).not.toHaveBeenCalled();
    expect(wrapper.get('[role="alert"]').text()).toBe('Page numbers couldn’t be added. Try again.');
  });

  it('explains why numbering is unavailable while suggesting and still inserts at the cursor', async () => {
    const { wrapper, applyPageNumbers, insertAtCursor, close } = mountMenu({
      pageNumbersState: { enabled: false, disabled: true, reason: 'operation-unavailable' },
      atCursorState: ENABLED,
      suggesting: true,
      loadCurrent: async () => NUMBERED_FOOTER,
    });
    await flush();
    await flush();

    expect(wrapper.get('[data-sd-page-number-add]').element.disabled).toBe(true);
    expect(wrapper.get('[data-sd-page-number-remove]').element.disabled).toBe(true);
    expect(wrapper.get('[data-sd-page-number-first-page]').element.disabled).toBe(true);
    expect(wrapper.get('[data-sd-page-number-format]').element.disabled).toBe(true);
    expect(wrapper.get('[role="status"]').text()).toContain('Switch to Editing');
    await wrapper.get('[data-sd-page-number-add]').trigger('click');
    expect(applyPageNumbers).not.toHaveBeenCalled();

    await wrapper.get('[data-sd-page-number-at-cursor]').trigger('click');
    await flush();

    expect(insertAtCursor).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith({ action: 'cursor' });
  });

  it('starts the cursor insert before handing focus back to the editor', async () => {
    const order = [];
    const { wrapper } = mountMenu({
      atCursorState: ENABLED,
      insertAtCursor: () => {
        order.push('insert');
        return Promise.resolve({ success: true });
      },
      close: () => order.push('close'),
    });

    await wrapper.get('[data-sd-page-number-at-cursor]').trigger('click');

    expect(order).toEqual(['insert', 'close']);
  });

  it('tells a user with text selected in a header or footer to place a cursor instead', () => {
    const inBody = mountMenu();
    expect(inBody.wrapper.get('[data-sd-page-number-at-cursor]').text()).toContain(
      'Click into a header or footer first',
    );

    const withRange = mountMenu({ inHeaderFooter: true });
    expect(withRange.wrapper.get('[data-sd-page-number-at-cursor]').element.disabled).toBe(true);
    expect(withRange.wrapper.get('[data-sd-page-number-at-cursor]').text()).toContain(
      'Place the cursor without selecting text',
    );
  });

  it('ignores a second commit while the first is pending', async () => {
    let finish;
    const { wrapper, applyPageNumbers } = mountMenu();
    applyPageNumbers.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    await flush();

    await wrapper.get('[data-sd-page-number-add]').trigger('click');
    await wrapper.get('[data-sd-page-number-add]').trigger('click');
    finish({ success: true });
    await flush();

    expect(applyPageNumbers).toHaveBeenCalledTimes(1);
  });
});
