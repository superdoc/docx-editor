import { afterEach, describe, expect, it } from 'vite-plus/test';
import { mount } from '@vue/test-utils';
import DocumentMode from './DocumentMode.vue';

const options = [
  { label: 'Editing', value: 'editing', icon: '', description: 'Edit directly' },
  { label: 'Suggesting', value: 'suggesting', icon: '', description: 'Edits become suggestions' },
];

let wrapper;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe('DocumentMode', () => {
  it('emits select with the option focused when Enter is pressed', async () => {
    wrapper = mount(DocumentMode, { props: { options }, attachTo: document.body });
    const [, suggesting] = wrapper.findAll('[role="menuitem"]');

    await suggesting.trigger('keydown', { key: 'Enter' });

    expect(wrapper.emitted('select')).toEqual([[options[1]]]);
  });
});
