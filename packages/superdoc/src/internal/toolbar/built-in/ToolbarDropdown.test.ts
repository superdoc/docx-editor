import { afterEach, expect, it } from 'vite-plus/test';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import ToolbarDropdown from './ToolbarDropdown.vue';
let wrapper;
afterEach(() => {
  wrapper?.unmount();
  document.body.replaceChildren();
});
it('carries the toolbar owner into teleported palette content', async () => {
  wrapper = mount(ToolbarDropdown, {
    props: { show: true, options: [{ key: 'red', label: 'Red' }] },
    attachTo: document.body,
    global: { provide: { sdToolbarOwnerId: 'palette-editor-owner' } },
  });
  await nextTick();
  const menu = document.querySelector('.toolbar-dropdown-menu');
  expect(menu?.dataset.superdocUiOwner).toBe('palette-editor-owner');
  expect(menu?.textContent).toContain('Red');
});

const focusedLabelOnOpen = async (options) => {
  wrapper = mount(ToolbarDropdown, { props: { show: true, options }, attachTo: document.body });
  await flushPromises();
  return document.activeElement?.textContent;
};

it('focuses the option whose object class sets sd-selected to a truthy value', async () => {
  const focused = await focusedLabelOnOpen([
    { key: 'missing', label: 'Missing', class: { other: true } },
    { key: 'falsy', label: 'Falsy', class: { 'sd-selected': false } },
    { key: 'selected', label: 'Selected', props: { class: { 'sd-selected': true } } },
  ]);
  expect(focused).toBe('Selected');
});

it('focuses the option whose array class contains a selected object', async () => {
  const focused = await focusedLabelOnOpen([
    { key: 'plain', label: 'Plain' },
    { key: 'selected', label: 'Selected', class: ['foo', { 'sd-selected': true }] },
  ]);
  expect(focused).toBe('Selected');
});
