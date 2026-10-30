import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { flushPromises, mount } from '@vue/test-utils';
import AIWriter from './AIWriter.vue';

let wrapper;

const respondWith = (payload) =>
  vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  }));

const submit = async (doc, handleClose = vi.fn()) => {
  wrapper = mount(AIWriter, { props: { doc, handleClose }, attachTo: document.body });
  await wrapper.find('textarea').setValue('write a greeting');
  await wrapper.find('form').trigger('submit');
  await flushPromises();
  return handleClose;
};

beforeEach(() => {
  vi.stubGlobal('fetch', respondWith({ custom_prompt: [{ value: 'Hello there' }] }));
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.unstubAllGlobals();
});

describe('AIWriter', () => {
  it('inserts the first custom_prompt value and closes on a successful receipt', async () => {
    const doc = { insert: vi.fn(() => ({ success: true })) };

    const handleClose = await submit(doc);

    expect(doc.insert).toHaveBeenCalledWith({ value: 'Hello there', type: 'text' });
    expect(handleClose).toHaveBeenCalledOnce();
  });

  it('closes when the receipt is empty', async () => {
    const handleClose = await submit({ insert: vi.fn(() => undefined) });

    expect(handleClose).toHaveBeenCalledOnce();
  });

  it.each([{ success: false }, { ok: false }])(
    'shows an error and stays open when the receipt is %o',
    async (receipt) => {
      const handleClose = await submit({ insert: vi.fn(() => receipt) });

      expect(handleClose).not.toHaveBeenCalled();
      expect(wrapper.find('[role="alert"]').text()).toBe('Unable to insert generated text.');
    },
  );
});
