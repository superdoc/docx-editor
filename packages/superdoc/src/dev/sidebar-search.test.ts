import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import SidebarSearch from './components/sidebar/SidebarSearch.vue';
import { setDevEditor } from './dev-session';
import type { HyperlinksListResult, QueryMatchOutput } from '@superdoc/document-api';

const matchOutput: QueryMatchOutput = {
  evaluatedRevision: 'r1',
  total: 1,
  page: { limit: 100, offset: 0, returned: 1 },
  meta: { effectiveResolved: true },
  items: [
    {
      id: 'match-1',
      handle: { ref: 'match-1', refStability: 'ephemeral', targetKind: 'text' },
      matchKind: 'node',
      address: { kind: 'block', nodeId: 'p1', nodeType: 'paragraph' },
      blocks: [],
    },
  ],
};

const linkOutput: HyperlinksListResult = {
  evaluatedRevision: 'r1',
  total: 1,
  page: { limit: 1000, offset: 0, returned: 1 },
  items: [
    {
      id: 'link-1',
      handle: { ref: 'link-1', refStability: 'ephemeral', targetKind: 'node' },
      text: 'Jump to target',
      properties: { anchor: 'target' },
      address: {
        kind: 'inline',
        nodeType: 'hyperlink',
        anchor: { start: { blockId: 'p2', offset: 0 }, end: { blockId: 'p2', offset: 14 } },
      },
    },
  ],
};

function installEditor(resolve: <T>(value: T) => T | Promise<T>) {
  setDevEditor({
    doc: {
      query: { match: () => resolve(matchOutput) },
      hyperlinks: { list: () => resolve(linkOutput) },
    },
  });
}

afterEach(() => {
  setDevEditor(null);
});

describe('SidebarSearch', () => {
  it.each([
    ['a promise', <T>(value: T) => Promise.resolve(value)],
    ['a plain value', <T>(value: T) => value],
  ])('lists search results and links when the Document API returns %s', async (_label, resolve) => {
    installEditor(resolve);
    const wrapper = mount(SidebarSearch);

    await wrapper.find('#dev-sidebar-search').setValue('alpha');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Search')!
      .trigger('click');
    await vi.waitFor(() => expect(wrapper.findAll('.dev-sidebar__result')).toHaveLength(1));

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Find links')!
      .trigger('click');
    await vi.waitFor(() => expect(wrapper.findAll('.dev-sidebar__result')).toHaveLength(2));
    expect(wrapper.text()).toContain('#target');
    expect(wrapper.text()).not.toContain('No links found.');

    wrapper.unmount();
  });
});
