import { afterEach, describe, expect, it } from 'vite-plus/test';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import IconGrid from './IconGrid.vue';

const color = (value) => ({ label: value, icon: '', value, style: { backgroundColor: value } });
const icons = [[color('#000000'), color('#FF0000')]];

let wrapper;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe('IconGrid', () => {
  it('renders the droplet icon on the None option and emits none when clicked', async () => {
    wrapper = mount(IconGrid, { props: { icons, hasNoneIcon: true }, attachTo: document.body });

    const none = wrapper.find('.none-option');
    expect(none.find('.none-icon svg').exists()).toBe(true);
    await none.trigger('click');

    expect(wrapper.emitted('select')).toEqual([['none']]);
  });

  it('marks the active color with a check, matching case-insensitively', () => {
    wrapper = mount(IconGrid, { props: { icons, activeColor: ref('#ff0000') }, attachTo: document.body });

    const options = wrapper.findAll('.sd-option');
    expect(options[0].find('.sd-option__check').exists()).toBe(false);
    expect(options[1].find('.sd-option__check').exists()).toBe(true);
  });

  it('shows no check when there is no active color', () => {
    wrapper = mount(IconGrid, { props: { icons }, attachTo: document.body });

    expect(wrapper.find('.sd-option__check').exists()).toBe(false);
  });
});
