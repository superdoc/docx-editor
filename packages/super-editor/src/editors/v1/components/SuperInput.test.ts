import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';

const EditorConstructor = vi.hoisted(() => {
  return vi.fn(function (options) {
    this.options = options;
    this.view = { focus: vi.fn() };
    this.state = { doc: { content: { size: 5 } } };
    this.commands = { setTextSelection: vi.fn() };
    this.destroy = vi.fn();
  });
});

vi.mock('@superdoc/super-editor', () => ({
  Editor: EditorConstructor,
}));

vi.mock('@extensions/index.js', () => ({
  getRichTextExtensions: () => [],
  Placeholder: { options: { placeholder: '' } },
}));

import SuperInput from './SuperInput.vue';

const Wrapper = defineComponent({
  name: 'SuperInputWrapper',
  setup() {
    return () =>
      h('div', {}, [h(SuperInput, { modelValue: '<p>First</p>' }), h(SuperInput, { modelValue: '<p>Second</p>' })]);
  },
});

describe('SuperInput.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the local content element for each instance', async () => {
    mount(Wrapper);
    await nextTick();

    expect(EditorConstructor).toHaveBeenCalledTimes(2);

    const firstOptions = EditorConstructor.mock.calls[0][0];
    const secondOptions = EditorConstructor.mock.calls[1][0];

    expect(firstOptions.content).toBeTruthy();
    expect(secondOptions.content).toBeTruthy();
    expect(typeof firstOptions.content).toBe('string');
    expect(typeof secondOptions.content).toBe('string');

    expect(firstOptions.content).toContain('First');
    expect(secondOptions.content).toContain('Second');
    expect(secondOptions.content).not.toContain('First');
  });

  it('moves cursor to the end on focus', async () => {
    const wrapper = mount(SuperInput, { props: { modelValue: '<p>Hello</p>' } });
    await nextTick();

    wrapper.vm.focus();
    const editorInstance = EditorConstructor.mock.results[0].value;
    expect(editorInstance.commands.setTextSelection).toHaveBeenCalledWith({ from: 5, to: 5 });
  });

  it('does not force cursor to end when wrapper is clicked', async () => {
    const wrapper = mount(SuperInput, { props: { modelValue: '<p>Hello</p>' } });
    await nextTick();

    await wrapper.trigger('click');

    const editorInstance = EditorConstructor.mock.results[0].value;
    expect(editorInstance.view.focus).toHaveBeenCalledTimes(1);
    expect(editorInstance.commands.setTextSelection).not.toHaveBeenCalled();
  });

  it('hands stored HTML only to the editor and never inserts it into the live DOM', async () => {
    const storedHtml = '<p>Hello<img src="x" onerror="probe()"></p>';
    const wrapper = mount(SuperInput, { props: { modelValue: storedHtml } });
    await nextTick();

    expect(EditorConstructor.mock.calls[0][0].content).toBe(storedHtml);
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.html()).not.toContain('onerror');
  });
});
