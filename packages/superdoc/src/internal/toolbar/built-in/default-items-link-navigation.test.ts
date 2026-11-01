import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { makeDefaultItems } from './default-items.js';
import { toolbarIcons } from './toolbarIcons.js';
import { toolbarTexts } from './toolbarTexts.js';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('built-in toolbar link navigation', () => {
  it('scrolls its viewport host to a named anchor', () => {
    const host = document.createElement('div');
    const anchor = document.createElement('a');
    anchor.setAttribute('name', 'section-one');
    host.appendChild(anchor);
    document.body.appendChild(host);

    Object.defineProperties(host, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, value: 120 },
    });
    host.getBoundingClientRect = () => ({ top: 100 });
    anchor.getBoundingClientRect = () => ({ top: 500 });
    host.scrollTo = vi.fn();
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => ({
      overflowY: element === host ? 'auto' : 'visible',
      scrollPaddingTop: '',
    }));

    const items = makeDefaultItems({
      superToolbar: { config: {}, ui: { viewport: { getHost: () => host } } },
      toolbarIcons,
      toolbarTexts,
    });
    const link = items.defaultItems.find((item) => item.name?.value === 'link');
    if (!link) throw new Error('expected a link item in the default toolbar items');

    link.activate({ href: '#section-one' });
    link.expand.value = true;
    expect(link.attributes.value.href).toBe('#section-one');
    expect(host.querySelector("a[name='section-one']")).toBe(anchor);
    const dropdown = link.nestedOptions.value.find((option) => option.key === 'linkDropdown').render();
    dropdown.children[0].props.goToAnchor();

    expect(host.scrollTo).toHaveBeenCalledWith({ top: 520, behavior: 'smooth' });
    expect(link.expand.value).toBe(false);
  });
});
