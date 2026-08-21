import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';

// Mock the extension helpers so the component can mount without a real editor.
vi.mock('@extensions/linked-styles/index.js', () => ({
  getQuickFormatList: () => [
    { id: 'Normal', definition: { attrs: { name: 'Normal' }, styles: {} } },
    { id: 'Heading1', definition: { attrs: { name: 'Heading 1' }, styles: {} } },
  ],
  generateLinkedStyleString: () => '',
}));

import LinkedStyle from './LinkedStyle.vue';

describe('LinkedStyle dropdown', () => {
  let wrapper;
  beforeEach(() => {
    wrapper = mount(LinkedStyle, { props: { editor: {}, selectedOption: 'Normal' } });
  });

  it('emits "select" with the style when a row name is clicked', async () => {
    await wrapper.findAll('.style-name')[1].trigger('click');
    const events = wrapper.emitted('select');
    expect(events).toBeTruthy();
    expect(events[0][0].id).toBe('Heading1');
  });

  it('emits "update" with the style when the row update action is clicked', async () => {
    const updateBtn = wrapper.findAll('[data-item="btn-linkedStyles-update"]')[1];
    expect(updateBtn.exists()).toBe(true);
    await updateBtn.trigger('click');
    const events = wrapper.emitted('update');
    expect(events).toBeTruthy();
    expect(events[0][0].id).toBe('Heading1');
    // Clicking update must NOT also apply the style.
    expect(wrapper.emitted('select')).toBeFalsy();
  });
});
