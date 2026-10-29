import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vite-plus/test';
import TableActions from './TableActions.vue';

const OPTIONS = [
  { label: 'Merge cells', command: 'mergeCells', icon: '<svg />', props: { ariaLabel: 'Merge cells' } },
  { label: 'Fix tables', command: 'fixTables', icon: '<svg />', disabled: true, props: { ariaLabel: 'Fix tables' } },
];

function findOption(wrapper: ReturnType<typeof mount>, label: string) {
  return wrapper.findAll('[role="menuitem"]').find((item) => item.text().includes(label));
}

describe('TableActions', () => {
  it('renders a disabled option as disabled and ignores clicks on it', async () => {
    const wrapper = mount(TableActions, { props: { options: OPTIONS } });
    const fixTables = findOption(wrapper, 'Fix tables');

    expect(fixTables.classes()).toContain('sd-disabled');
    expect(fixTables.attributes('aria-disabled')).toBe('true');

    await fixTables.trigger('click');
    expect(wrapper.emitted('select')).toBeUndefined();
  });

  it('keeps enabled options clickable', async () => {
    const wrapper = mount(TableActions, { props: { options: OPTIONS } });
    const mergeCells = findOption(wrapper, 'Merge cells');

    expect(mergeCells.classes()).not.toContain('sd-disabled');
    expect(mergeCells.attributes('aria-disabled')).toBeUndefined();

    await mergeCells.trigger('click');
    expect(wrapper.emitted('select')).toEqual([[{ command: 'mergeCells' }]]);
  });
});
