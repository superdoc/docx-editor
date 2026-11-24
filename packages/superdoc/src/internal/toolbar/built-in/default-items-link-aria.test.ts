import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import ToolbarButton from './ToolbarButton.vue';
import { makeDefaultItems } from './default-items.js';
import { toolbarIcons } from './toolbarIcons.js';
import { toolbarTexts } from './toolbarTexts.js';

/**
 * The Link control's accessible name survives its own state changes.
 *
 * `attributes` mixes the transient `href` with the item's static configuration,
 * `ariaLabel` among it. The activate/deactivate handlers used to replace that
 * object wholesale to record an href, which dropped the label. Because the
 * toolbar calls `deactivate()` on every state sync, the control lost its
 * accessible name on the first refresh and never recovered: `ToolbarButton.vue`
 * renders `` `${attributes.ariaLabel} ${active ? 'selected' : 'unset'}` `` into
 * an `aria-live` region, so screen readers announced "undefined unset".
 */
describe('built-in toolbar — link accessible name', () => {
  const mounted: Array<{ unmount: () => void }> = [];
  afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
  });

  const findLink = () => {
    const items = makeDefaultItems({
      superToolbar: { config: {}, ui: {} },
      toolbarIcons,
      toolbarTexts,
    });
    const link = items.defaultItems.find((item) => item.name?.value === 'link');
    if (!link) throw new Error('expected a link item in the default toolbar items');
    return link;
  };

  const mountLink = (link) => {
    const wrapper = mount(ToolbarButton, { props: { toolbarItem: link } });
    mounted.push(wrapper);
    return async () => {
      await nextTick();
      const root = wrapper.find('[data-sd-part="toolbar-item"]');
      return { name: root.attributes('aria-label'), live: wrapper.find('[aria-live="polite"]').text() };
    };
  };

  it('announces a real name before any interaction', async () => {
    const link = findLink();
    const announced = mountLink(link);
    expect(link.attributes.value.ariaLabel).toBe('Link dropdown');
    expect(await announced()).toEqual({ name: 'Link dropdown', live: 'Link dropdown unset' });
  });

  it('keeps the name when activated with an href', async () => {
    const link = findLink();
    const announced = mountLink(link);
    link.activate({ href: 'https://example.com' });
    expect(link.attributes.value.ariaLabel).toBe('Link dropdown');
    expect(link.attributes.value.href).toBe('https://example.com');
    expect(await announced()).toEqual({ name: 'Link dropdown', live: 'Link dropdown selected' });
  });

  it('keeps the name when activated without an href', async () => {
    const link = findLink();
    const announced = mountLink(link);
    link.activate({});
    expect(link.attributes.value.ariaLabel).toBe('Link dropdown');
    expect(link.attributes.value.href).toBeUndefined();
    expect(await announced()).toEqual({ name: 'Link dropdown', live: 'Link dropdown selected' });
  });

  it('keeps the name across deactivation — the toolbar sync path that broke it', async () => {
    const link = findLink();
    const announced = mountLink(link);
    link.activate({ href: 'https://example.com' });
    link.deactivate();
    expect(link.attributes.value.ariaLabel).toBe('Link dropdown');
    // The href must still clear; preserving the label must not pin a stale link.
    expect(link.attributes.value.href).toBeUndefined();
    expect(await announced()).toEqual({ name: 'Link dropdown', live: 'Link dropdown unset' });
  });

  // The handlers must carry the whole attributes object forward, not re-list the
  // keys they know about. A sentinel stands in for any attribute added later:
  // if the handlers ever go back to rebuilding the object, this fails while the
  // `ariaLabel` assertions above would still pass.
  it('preserves attributes it was never told about', () => {
    const link = findLink();
    link.attributes.value = { ...link.attributes.value, dataTestSentinel: 'keep-me' };

    link.activate({ href: 'https://example.com' });
    expect(link.attributes.value.dataTestSentinel, 'activation must not drop unrelated attributes').toBe('keep-me');
    expect(link.attributes.value.href).toBe('https://example.com');

    link.deactivate();
    expect(link.attributes.value.dataTestSentinel, 'deactivation must not drop unrelated attributes').toBe('keep-me');
    expect(link.attributes.value.ariaLabel).toBe('Link dropdown');
    expect(link.attributes.value.href).toBeUndefined();
  });

  it('survives repeated toolbar state syncs', async () => {
    const link = findLink();
    const announced = mountLink(link);
    for (let i = 0; i < 5; i += 1) {
      link.activate({ href: `https://example.com/${i}` });
      expect(await announced()).toEqual({ name: 'Link dropdown', live: 'Link dropdown selected' });
      link.deactivate();
      expect(await announced()).toEqual({ name: 'Link dropdown', live: 'Link dropdown unset' });
    }
  });
});
