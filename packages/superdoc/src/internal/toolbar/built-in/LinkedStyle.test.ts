import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vite-plus/test';
import LinkedStyle from './LinkedStyle.vue';

describe('LinkedStyle', () => {
  it('renders catalogue preview CSS on style option labels', () => {
    const wrapper = mount(LinkedStyle, {
      props: {
        styles: [
          {
            id: 'Heading1',
            name: 'Heading 1',
            preview: {
              available: true,
              css: {
                fontFamily: 'Aptos Display',
                fontSize: '16pt',
                fontWeight: 'bold',
              },
            },
          },
        ],
      },
    });

    const option = wrapper.find('[data-item="btn-linkedStyles-option"]');
    expect(option.text()).toBe('Heading 1');
    expect(option.element.style.fontFamily).toContain('Aptos Display');
    expect(option.element.style.fontSize).toBe('16pt');
    expect(option.element.style.fontWeight).toBe('bold');

    wrapper.unmount();
  });

  it('emits update, not select, from a row\'s "Update to match selection" action', async () => {
    const heading = { id: 'Heading1', name: 'Heading 1' };
    const wrapper = mount(LinkedStyle, {
      props: { styles: [heading, { id: 'Title', name: 'Title' }], updateLabel: 'Update to match selection' },
    });

    const actions = wrapper.findAll('[data-item="btn-linkedStyles-update"]');
    expect(actions).toHaveLength(2);
    expect(actions[0].attributes('aria-label')).toBe('Update to match selection: Heading 1');

    await actions[0].trigger('click');
    await actions[0].trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('update')).toEqual([[heading]]);
    expect(wrapper.emitted('select')).toBeUndefined();

    await wrapper.find('[data-item="btn-linkedStyles-option"]').trigger('click');
    expect(wrapper.emitted('select')).toEqual([[heading]]);

    wrapper.unmount();
  });
});
