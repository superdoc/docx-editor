import { afterEach, describe, expect, it } from 'vite-plus/test';
import { mount } from '@vue/test-utils';
import TableGrid from './TableGrid.vue';

let wrapper;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

const cell = (cols, rows) => wrapper.find(`[data-cols="${cols}"][data-rows="${rows}"]`);

describe('TableGrid', () => {
  it('highlights every cell up to the hovered row and column', async () => {
    wrapper = mount(TableGrid, { attachTo: document.body });

    await cell(3, 2).trigger('mouseover');

    const selected = wrapper
      .findAll('.sd-selected')
      .map((item) => [item.attributes('data-cols'), item.attributes('data-rows')]);
    expect(selected).toEqual([
      ['1', '1'],
      ['2', '1'],
      ['3', '1'],
      ['1', '2'],
      ['2', '2'],
      ['3', '2'],
    ]);
  });

  it('emits select with the clicked size', async () => {
    wrapper = mount(TableGrid, { attachTo: document.body });

    await cell(4, 3).trigger('click');

    expect(wrapper.emitted('select')).toEqual([[{ cols: 4, rows: 3 }]]);
  });
});
