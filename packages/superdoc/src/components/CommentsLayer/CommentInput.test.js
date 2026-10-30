import { beforeEach, describe, expect, it } from 'vite-plus/test';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import CommentInputSource from './CommentInput.vue?raw';
import CommentInput from './CommentInput.vue';
import { useCommentsStore } from '../../stores/comments-store.js';

describe('CommentInput.vue', () => {
  let commentsStore;

  const mountInput = (users = []) =>
    mount(CommentInput, {
      props: {
        users,
        config: { readOnly: false },
        includeHeader: false,
        comment: {},
      },
    });

  beforeEach(() => {
    setActivePinia(createPinia());
    commentsStore = useCommentsStore();
    commentsStore.currentCommentText = '';
    commentsStore.currentCommentMentions = [];
  });

  it('renders the native composer as a compact non-resizable field', () => {
    const wrapper = mountInput();
    const textarea = wrapper.find('textarea.superdoc-field');

    expect(textarea.exists()).toBe(true);
    expect(textarea.attributes('rows')).toBe('1');
    expect(CommentInputSource).toContain('resize: none;');
    expect(CommentInputSource).toContain('min-height: 28px;');
  });

  it('round-trips textarea text through the rich HTML comment draft', async () => {
    commentsStore.currentCommentText = '<p>Existing</p>';
    const wrapper = mountInput();
    const textarea = wrapper.find('textarea.superdoc-field');

    expect(textarea.element.value).toBe('Existing');

    await textarea.setValue('Line one\nLine two');

    expect(commentsStore.currentCommentText).toBe('<p>Line one<br>Line two</p>');
  });

  it('keeps trailing breaks and spaces in the live draft', async () => {
    const wrapper = mountInput();
    const textarea = wrapper.find('textarea.superdoc-field');
    for (const value of ['first ', 'first \n', 'first \n\n\n', 'first \n\n\nlast <&>']) {
      await textarea.setValue(value);
      expect(textarea.element.value).toBe(value);
    }
  });

  it('reopens imported paragraph and empty-paragraph structure without losing breaks', async () => {
    commentsStore.currentCommentText = '<p>first <strong>line</strong><br>continued</p><p></p><p>last &amp; line</p>';
    const wrapper = mountInput();
    expect(wrapper.find('textarea').element.value).toBe('first line\ncontinued\n\nlast & line');
  });

  it('stores configured user selections as structured mention identities', async () => {
    const wrapper = mountInput([{ id: 'u1', name: 'Internal Reviewer', email: 'internal@example.com' }]);
    const textarea = wrapper.find('textarea.superdoc-field');

    await textarea.setValue('@Int');
    await wrapper.get('[data-sd-comment-mention-option="u1"]').trigger('mousedown');

    expect(commentsStore.currentCommentText).toBe('<p>@Internal Reviewer</p>');
    expect(commentsStore.currentCommentMentions).toEqual([
      { id: 'u1', name: 'Internal Reviewer', email: 'internal@example.com' },
    ]);
  });

  it('finds the mention at the caret instead of the end of the draft', async () => {
    const wrapper = mountInput([{ id: 'u1', name: 'Internal Reviewer', email: 'internal@example.com' }]);
    const textarea = wrapper.find('textarea.superdoc-field');

    await textarea.setValue('@Int tail');
    expect(wrapper.find('[data-sd-comment-mention-option="u1"]').exists()).toBe(false);

    textarea.element.setSelectionRange(4, 4);
    await textarea.trigger('input');

    expect(wrapper.find('[data-sd-comment-mention-option="u1"]').exists()).toBe(true);
  });

  it('selects eligible users from the keyboard and excludes viewers', async () => {
    const wrapper = mountInput([
      { id: 'viewer', name: 'Read Only', email: 'viewer@example.com', role: 'viewer' },
      { id: 'external', name: 'External Reviewer', email: 'external@example.com' },
    ]);
    const textarea = wrapper.find('textarea.superdoc-field');

    await textarea.setValue('@');

    expect(wrapper.findAll('[role="option"]').map((option) => option.text())).toEqual([
      'External Reviewerexternal@example.com',
    ]);

    await textarea.trigger('keydown', { key: 'Enter' });

    expect(commentsStore.currentCommentText).toBe('<p>@External Reviewer</p>');
    expect(commentsStore.currentCommentMentions).toEqual([
      { id: 'external', name: 'External Reviewer', email: 'external@example.com' },
    ]);
  });
});
