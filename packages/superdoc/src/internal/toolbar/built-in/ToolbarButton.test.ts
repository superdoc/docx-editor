import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vite-plus/test';
import ToolbarButton from './ToolbarButton.vue';
import { useToolbarItem } from './use-toolbar-item.js';

describe('ToolbarButton', () => {
  it('draws no inline min-width when the item has no style, even if the parent passes minWidth', () => {
    const toolbarItem = useToolbarItem({ type: 'button', name: 'bold', icon: '<svg />' });
    const wrapper = mount(ToolbarButton, {
      props: { toolbarItem },
      attrs: { minWidth: '99px' },
    });

    const root = wrapper.find('[data-sd-part="toolbar-item"]').element;
    expect(root instanceof HTMLElement && root.style.minWidth).toBe('');

    wrapper.unmount();
  });

  it("draws the item's own style on the root", () => {
    const toolbarItem = useToolbarItem({
      type: 'button',
      name: 'fontSize',
      defaultLabel: '12',
      style: { width: '71px', minWidth: '71px' },
    });
    const wrapper = mount(ToolbarButton, { props: { toolbarItem } });

    const root = wrapper.find('[data-sd-part="toolbar-item"]').element;
    expect(root instanceof HTMLElement && root.style.width).toBe('71px');
    expect(root instanceof HTMLElement && root.style.minWidth).toBe('71px');

    wrapper.unmount();
  });
});
