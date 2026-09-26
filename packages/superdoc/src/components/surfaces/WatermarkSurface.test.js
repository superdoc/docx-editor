import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import WatermarkSurface from './WatermarkSurface.vue';

const wrappers = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.unstubAllGlobals();
});

function createSurface(overrides = {}) {
  let state = {
    phase: 'editing',
    draft: {
      kind: 'text',
      geometryKind: 'text',
      text: 'DRAFT',
      fontFamily: 'Calibri',
      fontSize: 'auto',
      bold: false,
      italic: false,
      color: '#C0C0C0',
      transparency: 50,
      orientation: 'diagonal',
      scalePercent: 'auto',
      washout: true,
      lockAspectRatio: true,
      pictureName: '',
      customPlacement: false,
      customOrientation: false,
      customSize: false,
    },
    sections: [
      { id: 'section-1', label: 'Section 1' },
      { id: 'section-2', label: 'Section 2' },
    ],
    sectionId: null,
    variant: 'all',
    items: [],
    selectedIds: [],
    fonts: [{ value: 'Calibri', label: 'Calibri' }],
    dirty: false,
    canApply: false,
    error: null,
    stale: false,
    readonlyReason: null,
    impact: 'Applies to the entire document.',
    impactDetails: [],
    preview: null,
    ...overrides,
  };
  const listeners = new Set();
  function update(patch) {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener(state));
  }
  const model = {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    patchDraft: vi.fn((patch) => update({ draft: { ...state.draft, ...patch }, dirty: true, canApply: true })),
    setScope: vi.fn((sectionId, variant) => update({ sectionId, variant })),
    selectWatermarks: vi.fn((selectedIds) => update({ selectedIds })),
    apply: vi.fn(async () => {}),
    reload: vi.fn(async () => {}),
  };
  const close = vi.fn();
  const wrapper = mount(WatermarkSurface, { props: { model, close, surfaceId: 'watermark-test' } });
  wrappers.push(wrapper);
  return { wrapper, model, close, update, state: () => state, listeners };
}

const control = (wrapper, name) => wrapper.get(`[aria-label="${name}"]`);
const button = (wrapper, text) => wrapper.findAll('button').find((item) => item.text() === text);

describe('WatermarkSurface', () => {
  it('keeps all affected locations available behind a concise expandable summary', () => {
    const { wrapper } = createSurface({
      impactDetails: Array.from({ length: 20 }, (_, index) => `Section ${index + 1}, default pages`),
    });
    const details = wrapper.get('details');
    expect(details.get('summary').text()).toBe('View 20 affected locations');
    expect(details.attributes('open')).toBeUndefined();
    expect(details.findAll('li')).toHaveLength(20);
    expect(details.findAll('li')[19].text()).toBe('Section 20, default pages');
  });
  it('edits a local text draft without applying and renders only the active type controls', async () => {
    const { wrapper, model, state } = createSurface();
    await control(wrapper, 'Watermark text').setValue('PRIVATE');
    expect(state().draft.text).toBe('PRIVATE');
    expect(model.apply).not.toHaveBeenCalled();
    expect(wrapper.find('input[type="file"]').exists()).toBe(false);
    await wrapper.get('input[value="picture"]').setValue();
    expect(wrapper.find('[aria-label="Watermark text"]').exists()).toBe(false);
    expect(wrapper.get('input[type="file"]').attributes('accept')).toContain('image/png');
  });

  it('keeps numeric transparency and the slider synchronized through the draft', async () => {
    const { wrapper, state } = createSurface();
    await control(wrapper, 'Transparency percentage').setValue(35);
    expect(state().draft.transparency).toBe(35);
    expect(control(wrapper, 'Transparency').element.value).toBe('35');
  });

  it('permits imported fractional transparency without blocking form submission', async () => {
    const { wrapper, update, state } = createSurface();
    update({ draft: { ...state().draft, transparency: 66.7 } });
    await nextTick();
    expect(control(wrapper, 'Transparency percentage').element.value).toBe('66.7');
    expect(control(wrapper, 'Transparency percentage').element.checkValidity()).toBe(true);
  });

  it('shows the selected orientation when only the watermark offset is custom', () => {
    const { wrapper, update, state } = createSurface();
    update({ draft: { ...state().draft, customPlacement: true, customOrientation: false } });
    return nextTick().then(() => {
      expect(wrapper.get('input[value="diagonal"]').element.checked).toBe(true);
    });
  });

  it('shows orientation controls for a picture without misrepresenting a custom rotation', async () => {
    const { wrapper, update, state } = createSurface();
    update({ draft: { ...state().draft, kind: 'picture', customPlacement: true, customOrientation: true } });
    await nextTick();
    expect(wrapper.get('input[value="horizontal"]').element.checked).toBe(false);
    expect(wrapper.get('input[value="diagonal"]').element.checked).toBe(false);
  });

  it('preserves auto sizing while allowing an explicit font size', async () => {
    const { wrapper, state } = createSurface();
    await control(wrapper, 'Font size').setValue('42');
    expect(state().draft.fontSize).toBe(42);
    await control(wrapper, 'Font size').setValue('Auto');
    expect(state().draft.fontSize).toBe('auto');
  });

  it('changes explicit scope without applying document changes', async () => {
    const { wrapper, model, state } = createSurface();
    await control(wrapper, 'Apply to').setValue('section-2');
    await control(wrapper, 'Page type').setValue('first');
    expect(state().sectionId).toBe('section-2');
    expect(state().variant).toBe('first');
    expect(model.apply).not.toHaveBeenCalled();
  });

  it('requires explicit selection for multiple watermark owners', async () => {
    const { wrapper, state } = createSurface({
      items: [
        { id: 'one', label: 'DRAFT', locations: 'Section 1, default' },
        { id: 'two', label: 'Picture', locations: 'Section 2, first' },
      ],
    });
    await wrapper.get('input[value="two"]').setValue(true);
    expect(state().selectedIds).toEqual(['two']);
    expect(wrapper.text()).toContain('Section 2, first');
  });

  it('shows conflicts and delegates reload without losing the displayed draft', async () => {
    const { wrapper, model } = createSurface({ stale: true, error: 'The document changed.' });
    expect(wrapper.get('[role="alert"]').text()).toContain('The document changed.');
    expect(control(wrapper, 'Watermark text').element.value).toBe('DRAFT');
    await button(wrapper, 'Review latest state').trigger('click');
    expect(model.reload).toHaveBeenCalledOnce();
    expect(button(wrapper, 'Apply watermark').attributes('disabled')).toBeDefined();
  });

  it('keeps the draft and reports an unexpected model rejection without closing', async () => {
    const { wrapper, model, close } = createSurface();
    await control(wrapper, 'Watermark text').setValue('PRIVATE');
    model.apply.mockRejectedValueOnce(new Error('Unexpected failure'));

    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(model.apply).toHaveBeenCalledOnce();
    expect(wrapper.get('[role="alert"]').text()).toContain('The watermark could not be applied. Try again.');
    expect(control(wrapper, 'Watermark text').element.value).toBe('PRIVATE');
    expect(close).not.toHaveBeenCalled();
  });

  it('leaves Cancel enabled during Apply and does not dispatch a second mutation', async () => {
    const { wrapper, close, model } = createSurface({ phase: 'applying', canApply: true });
    expect(button(wrapper, 'Applying…').attributes('disabled')).toBeDefined();
    await button(wrapper, 'Cancel').trigger('click');
    expect(close).toHaveBeenCalledWith('user-cancelled');
    expect(model.apply).not.toHaveBeenCalled();
  });

  it('keeps the header close action available during Apply', async () => {
    const { wrapper, close } = createSurface({ phase: 'applying' });
    expect(wrapper.get('h2').text()).toBe('Watermark');
    await control(wrapper, 'Close watermark dialog').trigger('click');
    expect(close).toHaveBeenCalledWith('user-cancelled');
  });

  it('prepares a supported local file without applying and permits the same file again', async () => {
    const { wrapper, model, state } = createSurface();
    await wrapper.get('input[value="picture"]').setValue();
    const input = wrapper.get('input[type="file"]');
    Object.defineProperty(input.element, 'files', { value: [new File(['image'], 'logo.png', { type: 'image/png' })] });
    await input.trigger('change');
    await vi.waitFor(() => expect(state().draft.src).toBe('data:image/png;base64,aW1hZ2U='));
    expect(state().draft.pictureName).toBe('logo.png');
    expect(input.element.value).toBe('');
    expect(model.apply).not.toHaveBeenCalled();
  });

  it('preserves the prior picture after unsupported input or picker cancellation', async () => {
    const { wrapper, state } = createSurface();
    await wrapper.get('input[value="picture"]').setValue();
    const input = wrapper.get('input[type="file"]');
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [new File(['bad'], 'image.svg', { type: 'image/svg+xml' })],
    });
    await input.trigger('change');
    expect(wrapper.get('[role="alert"]').text()).toContain('PNG or JPEG');
    expect(state().draft.src).toBeUndefined();
    Object.defineProperty(input.element, 'files', { value: [] });
    await input.trigger('change');
    expect(state().draft.src).toBeUndefined();
  });

  it('discards file completion after closing and unsubscribes when unmounted', async () => {
    let reader;
    vi.stubGlobal(
      'FileReader',
      class {
        result = 'data:image/png;base64,aW1hZ2U=';
        constructor() {
          reader = this;
        }
        readAsDataURL() {}
      },
    );
    const { wrapper, model, listeners } = createSurface();
    await wrapper.get('input[value="picture"]').setValue();
    const input = wrapper.get('input[type="file"]');
    Object.defineProperty(input.element, 'files', { value: [new File(['image'], 'logo.png', { type: 'image/png' })] });
    await input.trigger('change');
    await button(wrapper, 'Cancel').trigger('click');
    wrapper.unmount();
    reader.onload();
    await flushPromises();
    await nextTick();
    expect(model.patchDraft.mock.calls).toEqual([[{ kind: 'picture' }]]);
    expect(listeners.size).toBe(0);
  });

  it('keeps inspection available in readonly mode while disabling draft changes', () => {
    const { wrapper } = createSurface({ readonlyReason: 'This document is read-only.' });
    expect(wrapper.text()).toContain('This document is read-only.');
    expect(control(wrapper, 'Watermark text').element.closest('fieldset').disabled).toBe(true);
    expect(control(wrapper, 'Apply to').element.closest('fieldset').disabled).toBe(false);
    expect(button(wrapper, 'Cancel').attributes('disabled')).toBeUndefined();
  });

  it('renders a refreshed preview without calculating watermark geometry in the view', async () => {
    const { wrapper, update } = createSurface();
    update({ preview: { url: 'data:image/png;base64,preview', width: 612, height: 792 } });
    await nextTick();
    const preview = wrapper.get('img[alt="Watermark on a sample page"]');
    expect(preview.attributes('src')).toBe('data:image/png;base64,preview');
    expect(preview.attributes('width')).toBe('612');
    expect(preview.attributes('height')).toBe('792');
  });

  it('applies exactly when the valid draft is submitted', async () => {
    const { wrapper, model } = createSurface({ dirty: true, canApply: true });
    await wrapper.get('form').trigger('submit');
    expect(model.apply).toHaveBeenCalledOnce();
  });

  it('discards a pending picture read when the selected watermark changes', async () => {
    let reader;
    vi.stubGlobal(
      'FileReader',
      class {
        result = 'data:image/png;base64,aW1hZ2U=';
        constructor() {
          reader = this;
        }
        readAsDataURL() {}
      },
    );
    const { wrapper, update, state } = createSurface();
    await wrapper.get('input[value="picture"]').setValue();
    const input = wrapper.get('input[type="file"]');
    Object.defineProperty(input.element, 'files', { value: [new File(['image'], 'logo.png', { type: 'image/png' })] });
    await input.trigger('change');
    update({ selectedIds: ['different-watermark'] });
    await nextTick();
    reader.onload();
    await flushPromises();
    expect(state().draft.src).toBeUndefined();
  });

  it('keeps preparing the picture when an unrelated preview update arrives', async () => {
    let reader;
    vi.stubGlobal(
      'FileReader',
      class {
        result = 'data:image/png;base64,aW1hZ2U=';
        constructor() {
          reader = this;
        }
        readAsDataURL() {}
      },
    );
    const { wrapper, update, state } = createSurface();
    await wrapper.get('input[value="picture"]').setValue();
    const input = wrapper.get('input[type="file"]');
    Object.defineProperty(input.element, 'files', { value: [new File(['image'], 'logo.png', { type: 'image/png' })] });
    await input.trigger('change');
    update({ phase: 'editing' });
    await nextTick();
    reader.onload();
    await flushPromises();
    expect(state().draft.src).toBe('data:image/png;base64,aW1hZ2U=');
  });
});
