import { describe, expect, it } from 'vite-plus/test';
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
 *
 * These evaluate that template expression against the item's live attributes
 * rather than mounting the component, so they pin the data the template reads,
 * not the rendered DOM. That is the layer the bug lived at: the original item
 * configuration already declared a correct label, and asserting the config
 * would not have caught it being destroyed at runtime.
 */
describe('built-in toolbar — link accessible name', () => {
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

  /**
   * The template expression `ToolbarButton.vue` puts in the item's live region.
   * Evaluated here against the item's attributes rather than a mounted component.
   */
  const announced = (item) => `${item.attributes.value?.ariaLabel} ${item.active?.value ? 'selected' : 'unset'}`;

  it('announces a real name before any interaction', () => {
    const link = findLink();
    expect(link.attributes.value.ariaLabel).toBe('Link dropdown');
    expect(announced(link)).not.toContain('undefined');
  });

  it('keeps the name when activated with an href', () => {
    const link = findLink();
    link.onActivate({ href: 'https://example.com' });
    expect(link.attributes.value.ariaLabel).toBe('Link dropdown');
    expect(link.attributes.value.href).toBe('https://example.com');
    expect(announced(link)).not.toContain('undefined');
  });

  it('keeps the name when activated without an href', () => {
    const link = findLink();
    link.onActivate({});
    expect(link.attributes.value.ariaLabel).toBe('Link dropdown');
    expect(link.attributes.value.href).toBeUndefined();
    expect(announced(link)).not.toContain('undefined');
  });

  it('keeps the name across deactivation — the toolbar sync path that broke it', () => {
    const link = findLink();
    link.onActivate({ href: 'https://example.com' });
    link.onDeactivate();
    expect(link.attributes.value.ariaLabel).toBe('Link dropdown');
    // The href must still clear; preserving the label must not pin a stale link.
    expect(link.attributes.value.href).toBeUndefined();
    expect(announced(link)).toBe('Link dropdown unset');
  });

  // The handlers must carry the whole attributes object forward, not re-list the
  // keys they know about. A sentinel stands in for any attribute added later:
  // if the handlers ever go back to rebuilding the object, this fails while the
  // `ariaLabel` assertions above would still pass.
  it('preserves attributes it was never told about', () => {
    const link = findLink();
    link.attributes.value = { ...link.attributes.value, dataTestSentinel: 'keep-me' };

    link.onActivate({ href: 'https://example.com' });
    expect(link.attributes.value.dataTestSentinel, 'activation must not drop unrelated attributes').toBe('keep-me');
    expect(link.attributes.value.href).toBe('https://example.com');

    link.onDeactivate();
    expect(link.attributes.value.dataTestSentinel, 'deactivation must not drop unrelated attributes').toBe('keep-me');
    expect(link.attributes.value.ariaLabel).toBe('Link dropdown');
    expect(link.attributes.value.href).toBeUndefined();
  });

  it('survives repeated toolbar state syncs', () => {
    const link = findLink();
    for (let i = 0; i < 5; i += 1) {
      link.onActivate({ href: `https://example.com/${i}` });
      link.onDeactivate();
    }
    expect(announced(link)).toBe('Link dropdown unset');
  });
});
