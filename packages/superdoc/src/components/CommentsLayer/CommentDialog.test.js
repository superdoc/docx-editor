import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import CommentDialogSource from './CommentDialog.vue?raw';
import CommentDialog from './CommentDialog.vue';
import useComment from './use-comment.js';
import { useCommentsStore } from '../../stores/comments-store.js';
import { useSuperdocStore } from '../../stores/superdoc-store.js';

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const COMMENT_DIALOG_SOURCE = CommentDialogSource;
const ONE_BY_ONE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+KD0aVQAAAABJRU5ErkJggg==';

describe('CommentDialog', () => {
  let commentsStore;
  let superdocStore;
  let superdocStub;

  const mountDialog = (comment, stubs = {}) =>
    mount(CommentDialog, {
      attachTo: document.body,
      props: { comment },
      global: {
        config: {
          globalProperties: {
            $superdoc: superdocStub,
          },
        },
        directives: {
          'click-outside': {},
        },
        stubs: {
          CommentHeader: true,
          CommentInput: true,
          InternalDropdown: true,
          Avatar: true,
          ...stubs,
        },
      },
    });

  beforeEach(() => {
    setActivePinia(createPinia());
    commentsStore = useCommentsStore();
    superdocStore = useSuperdocStore();
    superdocStore.documents = [{ id: 'doc-1', type: DOCX_TYPE }];
    superdocStore.user = { id: 'user-1', email: 'user@example.com', name: 'User', image: null };
    superdocStub = {
      activeEditor: {
        editorVersion: 1,
        commands: {
          setCursorById: vi.fn(),
          setActiveComment: vi.fn(),
          resolveComment: vi.fn(),
        },
      },
      users: [],
      emit: vi.fn(),
      focus: vi.fn(),
      canPerformPermission: vi.fn(() => true),
      config: {
        role: 'editor',
        isInternal: false,
        user: superdocStore.user,
      },
    };
  });

  describe('posted comment URLs', () => {
    it('renders a long closing-delimiter suffix promptly while preserving the comment', () => {
      const target = 'https://example.test/a_(b)';
      const text = target + ')'.repeat(30_000);
      const comment = useComment({ commentId: 'long-url', fileId: 'doc-1', commentText: text });
      commentsStore.commentsList = [comment];
      const start = performance.now();
      const wrapper = mountDialog(comment);
      const elapsedMs = performance.now() - start;
      try {
        expect(wrapper.find('.comment a').attributes('href')).toBe(target);
        expect(wrapper.find('.comment').text()).toBe(text);
        expect(comment.commentText).toBe(text);
        expect(elapsedMs).toBeLessThan(1_000);
      } finally {
        wrapper.unmount();
      }
    });

    it('renders a web URL without changing stored rich text', () => {
      const text = '<p>Read <strong>this</strong>: https://example.com/a?x=1&amp;y=2.</p>';
      const comment = useComment({ commentId: 'url', fileId: 'doc-1', commentText: text });
      commentsStore.commentsList = [comment];
      const wrapper = mountDialog(comment);
      try {
        const link = wrapper.find('.comment a');
        expect(link.attributes('href')).toBe('https://example.com/a?x=1&y=2');
        expect(link.attributes('target')).toBe('_blank');
        expect(link.attributes('rel')).toBe('noopener noreferrer');
        expect(wrapper.find('.comment strong').text()).toBe('this');
        expect(wrapper.find('.comment').text()).toBe('Read this: https://example.com/a?x=1&y=2.');
        expect(comment.commentText).toBe(text);
      } finally {
        wrapper.unmount();
      }
    });

    it('keeps existing web links single and removes unsupported link actions', () => {
      const comment = useComment({
        commentId: 'existing-urls',
        fileId: 'doc-1',
        commentText:
          '<p><a href="https://example.com">Existing web link</a> <a href="mailto:review@example.test">Email</a> <a href="javascript:alert(1)">Unsafe text</a></p>',
      });
      commentsStore.commentsList = [comment];
      const wrapper = mountDialog(comment);
      try {
        expect(wrapper.findAll('.comment a')).toHaveLength(2);
        expect(wrapper.find('.comment a[href="mailto:review@example.test"]').text()).toBe('Email');
        expect(wrapper.find('.comment a').attributes('target')).toBe('_blank');
        expect(wrapper.find('.comment a').attributes('rel')).toBe('noopener noreferrer');
        expect(wrapper.find('.comment').text()).toBe('Existing web link Email Unsafe text');
      } finally {
        wrapper.unmount();
      }
    });

    it('allows the native action when a posted comment link is clicked', () => {
      const comment = useComment({
        commentId: 'native-link',
        fileId: 'doc-1',
        commentText: '<p><a href="https://example.com">Existing web link</a></p>',
      });
      commentsStore.commentsList = [comment];
      const wrapper = mountDialog(comment);
      try {
        const click = new MouseEvent('click', { bubbles: true, cancelable: true });
        let defaultPreventedByDialog;
        wrapper.element.addEventListener(
          'click',
          (event) => {
            defaultPreventedByDialog = event.defaultPrevented;
            // Observe the component first, then keep the DOM test from navigating.
            event.preventDefault();
          },
          { once: true },
        );
        wrapper.find('.comment a').element.dispatchEvent(click);
        expect(defaultPreventedByDialog).toBe(false);
      } finally {
        wrapper.unmount();
      }
    });
  });

  describe('read-only mutation defense (SD-3164)', () => {
    it('rejects stale tracked-change resolve/reject events before the store', async () => {
      commentsStore.init({ readOnly: true });
      superdocStub.activeEditor.editorVersion = 2;
      superdocStub.activeEditor.v2TrackedChanges = {
        getCapabilityState: vi.fn(() => ({ canDecide: true })),
      };
      const comment = useComment({
        commentId: 'tc-read-only',
        fileId: 'doc-1',
        commentText: '',
        trackedChange: true,
      });
      commentsStore.commentsList = [comment];
      const decide = vi.spyOn(commentsStore, 'decideTrackedChangeFromSidebar');

      const wrapper = mountDialog(comment);
      try {
        const header = wrapper.findComponent({ name: 'CommentHeader' });
        header.vm.$emit('resolve');
        header.vm.$emit('reject');
        await flushPromises();

        expect(decide).not.toHaveBeenCalled();
        expect(superdocStub.focus).not.toHaveBeenCalled();
      } finally {
        wrapper.unmount();
      }
    });

    it('keeps tracked-change decisions independent from read-only comments', async () => {
      commentsStore.init({ readOnly: true, allowResolve: false });
      superdocStub.interactionConfig = {
        comments: { level: 'read', readOnly: true, allowResolve: false },
        trackedChanges: { allowDecisions: true },
      };
      superdocStub.activeEditor.editorVersion = 2;
      superdocStub.activeEditor.v2TrackedChanges = {
        getCapabilityState: vi.fn(() => ({ canDecide: true })),
      };
      const comment = useComment({
        commentId: 'tc-comments-read-only',
        fileId: 'doc-1',
        commentText: '',
        trackedChange: true,
      });
      commentsStore.commentsList = [comment];
      const decide = vi.spyOn(commentsStore, 'decideTrackedChangeFromSidebar').mockResolvedValue({ ok: true });

      const wrapper = mountDialog(comment);
      try {
        const header = wrapper.findComponent({ name: 'CommentHeader' });
        header.vm.$emit('resolve');
        header.vm.$emit('reject');
        await flushPromises();

        expect(decide).toHaveBeenCalledTimes(2);
      } finally {
        wrapper.unmount();
      }
    });

    it.each([
      ['resolve', 'accept'],
      ['reject', 'reject'],
    ])('awaits a v1 tracked-change %s before reconciling its row', async (eventName, decision) => {
      commentsStore.init({ readOnly: true, allowResolve: false });
      superdocStub.commentsStore = commentsStore;
      superdocStub.interactionConfig = {
        comments: { level: 'read', readOnly: true, allowResolve: false },
        trackedChanges: { allowDecisions: true },
      };
      const comment = useComment({
        commentId: `tc-v1-${decision}`,
        fileId: 'doc-1',
        commentText: '',
        trackedChange: true,
      });
      commentsStore.commentsList = [comment];
      const decide = vi
        .spyOn(commentsStore, 'decideTrackedChangeFromSidebar')
        .mockResolvedValue({ ok: true, success: true });
      const resolve = vi.spyOn(comment, 'resolveComment');

      const wrapper = mountDialog(comment);
      try {
        wrapper.findComponent({ name: 'CommentHeader' }).vm.$emit(eventName);
        await flushPromises();

        expect(decide).toHaveBeenCalledWith({
          superdoc: superdocStub,
          comment,
          decision,
        });
        expect(resolve).toHaveBeenCalledWith(
          expect.objectContaining({
            decision,
            reconciliationToken: expect.any(Symbol),
          }),
        );
        expect(comment.resolvedTime).toEqual(expect.any(Number));
      } finally {
        wrapper.unmount();
      }
    });

    it('rejects stale ordinary resolve/reopen/delete/edit events before the store', async () => {
      commentsStore.init({ readOnly: true, allowResolve: true });
      superdocStub.activeEditor.editorVersion = 2;
      superdocStub.activeEditor.v2Comments = {
        getCapabilityState: vi.fn(() => ({ canWrite: true })),
      };
      const comment = useComment({
        commentId: 'comment-read-only',
        fileId: 'doc-1',
        commentText: 'Keep this comment',
      });
      commentsStore.commentsList = [comment];
      const resolve = vi.spyOn(commentsStore, 'resolveCommentV2');
      const reopen = vi.spyOn(commentsStore, 'reopenCommentV2');
      const remove = vi.spyOn(commentsStore, 'deleteComment');

      const wrapper = mountDialog(comment);
      try {
        const header = wrapper.findComponent({ name: 'CommentHeader' });
        header.vm.$emit('resolve');
        header.vm.$emit('reopen');
        header.vm.$emit('overflow-select', 'delete');
        header.vm.$emit('overflow-select', 'edit');
        await flushPromises();

        expect(resolve).not.toHaveBeenCalled();
        expect(reopen).not.toHaveBeenCalled();
        expect(remove).not.toHaveBeenCalled();
        expect(commentsStore.editingCommentId).toBeNull();
      } finally {
        wrapper.unmount();
      }
    });

    it('closes reply and edit surfaces when config flips to read-only', async () => {
      commentsStore.init({ readOnly: false, allowResolve: true });
      const comment = useComment({
        commentId: 'comment-config-flip',
        fileId: 'doc-1',
        commentText: 'Config flip comment',
      });
      commentsStore.commentsList = [comment];
      commentsStore.activeComment = comment.commentId;

      const wrapper = mountDialog(comment);
      try {
        await wrapper.find('.reply-pill').trigger('click');
        expect(wrapper.find('.reply-expanded').exists()).toBe(true);

        commentsStore.init({ readOnly: true });
        await flushPromises();

        expect(wrapper.find('.reply-pill').exists()).toBe(false);
        expect(wrapper.find('.reply-expanded').exists()).toBe(false);
        expect(commentsStore.editingCommentId).toBeNull();
      } finally {
        wrapper.unmount();
      }
    });

    it('closes an active edit surface when config flips to read-only', async () => {
      commentsStore.init({ readOnly: false, allowResolve: true });
      const comment = useComment({
        commentId: 'comment-edit-config-flip',
        fileId: 'doc-1',
        commentText: 'Editing before config flip',
      });
      commentsStore.commentsList = [comment];
      commentsStore.activeComment = comment.commentId;

      const wrapper = mountDialog(comment);
      try {
        wrapper.findComponent({ name: 'CommentHeader' }).vm.$emit('overflow-select', 'edit');
        await flushPromises();
        expect(commentsStore.editingCommentId).toBe(comment.commentId);
        expect(wrapper.find('.reply-expanded').exists()).toBe(true);

        commentsStore.init({ readOnly: true });
        await flushPromises();

        expect(commentsStore.editingCommentId).toBeNull();
        expect(wrapper.find('.reply-expanded').exists()).toBe(false);
      } finally {
        wrapper.unmount();
      }
    });

    it('hides the internal/external mutation control in read-only mode', () => {
      commentsStore.init({ readOnly: true });
      commentsStore.suppressInternalExternal = false;
      superdocStub.config.isInternal = true;
      const comment = useComment({
        commentId: 'comment-internal-read-only',
        fileId: 'doc-1',
        commentText: 'Internal comment',
        isInternal: true,
      });
      commentsStore.commentsList = [comment];

      const wrapper = mountDialog(comment);
      try {
        expect(wrapper.find('.existing-internal-input').exists()).toBe(false);
      } finally {
        wrapper.unmount();
      }
    });

    it('honors allowResolve in stale ordinary-comment handler events', async () => {
      commentsStore.init({ readOnly: false, allowResolve: false });
      superdocStub.activeEditor.editorVersion = 2;
      superdocStub.activeEditor.v2Comments = {
        getCapabilityState: vi.fn(() => ({ canWrite: true })),
      };
      const comment = useComment({ commentId: 'comment-no-resolve', fileId: 'doc-1', commentText: 'Open' });
      commentsStore.commentsList = [comment];
      const resolve = vi.spyOn(commentsStore, 'resolveCommentV2');

      const wrapper = mountDialog(comment);
      try {
        wrapper.findComponent({ name: 'CommentHeader' }).vm.$emit('resolve');
        await flushPromises();
        expect(resolve).not.toHaveBeenCalled();
      } finally {
        wrapper.unmount();
      }
    });
  });

  describe('v2 edit completion ownership', () => {
    const deferred = () => {
      let resolve;
      const promise = new Promise((done) => {
        resolve = done;
      });
      return { promise, resolve };
    };

    const prepare = () => {
      superdocStub.activeEditor.editorVersion = 2;
      superdocStub.activeEditor.v2Comments = {
        getCapabilityState: () => ({ canWrite: true }),
        setActiveComment: vi.fn(),
      };
      const root = useComment({ commentId: 'edit-root', fileId: 'doc-1', commentText: 'Root' });
      const reply = useComment({
        commentId: 'edit-reply',
        fileId: 'doc-1',
        parentCommentId: root.commentId,
        commentText: 'Reply',
      });
      commentsStore.commentsList = [root, reply];
      commentsStore.activeComment = root.commentId;
      const wrapper = mountDialog(root);
      const start = async (comment) => {
        wrapper
          .findAllComponents({ name: 'CommentHeader' })
          .find((header) => header.props('comment').commentId === comment.commentId)
          .vm.$emit('overflow-select', 'edit');
        await flushPromises();
      };
      return { root, reply, wrapper, start };
    };

    it.each(['reply', 'same comment reopened', 'another dialog'])(
      'keeps a newer %s edit when an old real outcome returns',
      async (next) => {
        const pending = deferred();
        const edit = vi.spyOn(commentsStore, 'editCommentV2').mockReturnValue(pending.promise);
        const { root, reply, wrapper, start } = prepare();
        let other;
        try {
          await start(root);
          commentsStore.currentCommentText = 'Submitted root';
          await wrapper.find('button.reply-btn-primary').trigger('click');
          expect(edit).toHaveBeenCalledWith({
            superdoc: superdocStub,
            commentId: root.commentId,
            text: 'Submitted root',
          });
          if (next === 'same comment reopened') {
            await wrapper.find('button.reply-btn-cancel').trigger('click');
            await start(root);
          } else if (next === 'another dialog') {
            other = mountDialog(root);
            other.findAllComponents({ name: 'CommentHeader' })[0].vm.$emit('overflow-select', 'edit');
            await flushPromises();
          } else {
            await start(reply);
          }
          const nextDraft = next === 'reply' ? 'New edit draft' : 'Submitted root';
          commentsStore.currentCommentText = nextDraft;
          pending.resolve({ ok: true });
          await flushPromises();
          expect(commentsStore.editingCommentId).toBe(next === 'reply' ? reply.commentId : root.commentId);
          expect(commentsStore.currentCommentText).toBe(nextDraft);
          expect((other ?? wrapper).find('.reply-expanded').exists()).toBe(true);
        } finally {
          other?.unmount();
          wrapper.unmount();
        }
      },
    );

    it.each(['editor replaced', 'document replaced', 'adapter replaced', 'dialog disposed'])(
      'keeps current composer state after the submitting %s',
      async (retirement) => {
        const pending = deferred();
        vi.spyOn(commentsStore, 'editCommentV2').mockReturnValue(pending.promise);
        const { root, wrapper, start } = prepare();
        try {
          await start(root);
          commentsStore.currentCommentText = 'Identical draft';
          await wrapper.find('button.reply-btn-primary').trigger('click');
          if (retirement === 'editor replaced') superdocStub.activeEditor = { ...superdocStub.activeEditor };
          else if (retirement === 'document replaced') superdocStub.activeEditor.doc = {};
          else if (retirement === 'adapter replaced')
            superdocStub.activeEditor.v2Comments = { ...superdocStub.activeEditor.v2Comments };
          else wrapper.unmount();
          pending.resolve({ ok: true });
          await flushPromises();
          expect(commentsStore.editingCommentId).toBe(root.commentId);
          expect(commentsStore.currentCommentText).toBe('Identical draft');
        } finally {
          if (retirement !== 'dialog disposed') wrapper.unmount();
        }
      },
    );

    it('keeps a later submission of the same edit when an earlier submission completes', async () => {
      const first = deferred();
      const second = deferred();
      const edit = vi
        .spyOn(commentsStore, 'editCommentV2')
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);
      const { root, wrapper, start } = prepare();
      try {
        await start(root);
        commentsStore.currentCommentText = 'Same submitted text';
        await wrapper.find('button.reply-btn-primary').trigger('click');
        await wrapper.find('button.reply-btn-primary').trigger('click');
        expect(edit).toHaveBeenCalledTimes(2);
        first.resolve({ ok: true });
        await flushPromises();
        expect(commentsStore.editingCommentId).toBe(root.commentId);
        expect(commentsStore.currentCommentText).toBe('Same submitted text');
        second.resolve({ ok: true });
        await flushPromises();
        expect(commentsStore.editingCommentId).toBeNull();
        expect(commentsStore.currentCommentText).toBe('');
      } finally {
        wrapper.unmount();
      }
    });

    it.each(['rejected', 'new draft', 'successful'])(
      'preserves the correct composer after a %s completion',
      async (result) => {
        const pending = deferred();
        vi.spyOn(commentsStore, 'editCommentV2').mockReturnValue(pending.promise);
        const { root, wrapper, start } = prepare();
        try {
          await start(root);
          commentsStore.currentCommentText = 'Submitted text';
          await wrapper.find('button.reply-btn-primary').trigger('click');
          if (result === 'new draft') commentsStore.currentCommentText = 'New draft';
          pending.resolve({ ok: result !== 'rejected' });
          await flushPromises();
          expect(commentsStore.editingCommentId).toBe(result === 'successful' ? null : root.commentId);
          expect(commentsStore.currentCommentText).toBe(
            result === 'successful' ? '' : result === 'new draft' ? 'New draft' : 'Submitted text',
          );
        } finally {
          wrapper.unmount();
        }
      },
    );
  });

  it.each([
    ['resolve', 'accept'],
    ['reject', 'reject'],
  ])('restores document focus after a committed v2 tracked-change %s', async (eventName, decision) => {
    superdocStub.activeEditor.editorVersion = 2;
    superdocStub.activeEditor.v2TrackedChanges = {
      getCapabilityState: vi.fn(() => ({ canDecide: true })),
    };
    const comment = useComment({
      commentId: `tc-${decision}`,
      fileId: 'doc-1',
      commentText: '',
      trackedChange: true,
    });
    commentsStore.commentsList = [comment];
    const decide = vi
      .spyOn(commentsStore, 'decideTrackedChangeFromSidebar')
      .mockResolvedValue({ ok: true, success: true });

    const wrapper = mountDialog(comment);
    try {
      wrapper.findComponent({ name: 'CommentHeader' }).vm.$emit(eventName);
      await flushPromises();

      expect(decide).toHaveBeenCalledWith({
        superdoc: superdocStub,
        comment,
        decision,
      });
      expect(superdocStub.focus).toHaveBeenCalledWith({ preventScroll: true });
    } finally {
      wrapper.unmount();
    }
  });

  it('keeps focus unchanged when the v2 tracked-change decision is rejected', async () => {
    superdocStub.activeEditor.editorVersion = 2;
    superdocStub.activeEditor.v2TrackedChanges = {
      getCapabilityState: vi.fn(() => ({ canDecide: true })),
    };
    const comment = useComment({
      commentId: 'tc-rejected',
      fileId: 'doc-1',
      commentText: '',
      trackedChange: true,
    });
    commentsStore.commentsList = [comment];
    vi.spyOn(commentsStore, 'decideTrackedChangeFromSidebar').mockResolvedValue({ ok: false, success: false });

    const wrapper = mountDialog(comment);
    try {
      wrapper.findComponent({ name: 'CommentHeader' }).vm.$emit('resolve');
      await flushPromises();

      expect(superdocStub.focus).not.toHaveBeenCalled();
    } finally {
      wrapper.unmount();
    }
  });

  it('shows a retryable alert when a tracked-change decision returns a stale-catalog failure', async () => {
    superdocStub.activeEditor.editorVersion = 2;
    superdocStub.activeEditor.v2TrackedChanges = {
      getCapabilityState: vi.fn(() => ({ canDecide: true })),
    };
    const comment = useComment({
      commentId: 'tc-stale-catalog',
      fileId: 'doc-1',
      commentText: '',
      trackedChange: true,
    });
    commentsStore.commentsList = [comment];
    vi.spyOn(commentsStore, 'decideTrackedChangeFromSidebar').mockResolvedValue({
      ok: false,
      success: false,
      reason: 'stale-catalog',
    });

    const wrapper = mountDialog(comment);
    try {
      wrapper.findComponent({ name: 'CommentHeader' }).vm.$emit('resolve');
      await flushPromises();

      const alert = wrapper.find('[role="alert"]');
      expect(alert.exists()).toBe(true);
      expect(alert.text()).toMatch(/stale|retry/i);
      expect(commentsStore.commentsList.map((row) => row.commentId)).toContain(comment.commentId);
      expect(superdocStub.focus).not.toHaveBeenCalled();
    } finally {
      wrapper.unmount();
    }
  });

  it.each([
    [
      'move-to',
      {
        trackedChangeText: 'moved destination',
        trackedChangeType: 'insert',
        trackedChangeDisplayType: 'insert',
        semanticColorKey: 'move-to',
        semanticColor: '#00853d',
      },
      '.tracked-change-text.is-inserted',
      '"moved destination"',
    ],
    [
      'move-from',
      {
        deletedText: 'moved source',
        trackedChangeType: 'delete',
        trackedChangeDisplayType: 'delete',
        semanticColorKey: 'move-from',
        semanticColor: '#00853d',
      },
      '.tracked-change-text.is-deleted',
      '"moved source"',
    ],
  ])(
    'renders the semantic hook and existing tracked-change variant for %s rows',
    (semanticColorKey, trackedChangeFields, selector, expectedText) => {
      const comment = useComment({
        commentId: `tc-${semanticColorKey}`,
        fileId: 'doc-1',
        commentText: '',
        trackedChange: true,
        ...trackedChangeFields,
      });
      commentsStore.commentsList = [comment];

      const wrapper = mountDialog(comment);
      try {
        const trackedChange = wrapper.find('.tracked-change');
        expect(trackedChange.attributes('data-track-change-semantic-color-key')).toBe(semanticColorKey);
        expect(wrapper.find(selector).text()).toBe(expectedText);
      } finally {
        wrapper.unmount();
      }
    },
  );

  it('declares move-specific review color rules in the component stylesheet', () => {
    expect(COMMENT_DIALOG_SOURCE).toContain(
      ".tracked-change[data-track-change-semantic-color-key='move-from'] .tracked-change-text.is-deleted",
    );
    expect(COMMENT_DIALOG_SOURCE).toContain('var(--sd-ui-comments-move-from-text, #00853d)');
    expect(COMMENT_DIALOG_SOURCE).toContain(
      ".tracked-change[data-track-change-semantic-color-key='move-to'] .tracked-change-text.is-inserted",
    );
    expect(COMMENT_DIALOG_SOURCE).toContain('var(--sd-ui-comments-move-to-text, #00853d)');
  });

  it('renders paragraph split tracked changes as added new line rows', () => {
    const comment = useComment({
      commentId: 'tc-paragraph-split',
      fileId: 'doc-1',
      commentText: '',
      trackedChange: true,
      trackedChangeText: '',
      trackedChangeType: 'trackInsert',
      trackedChangeDisplayType: 'paragraphSplit',
    });
    commentsStore.commentsList = [comment];

    const wrapper = mountDialog(comment);
    try {
      expect(wrapper.find('.tracked-change').text()).toBe('Added new line');
    } finally {
      wrapper.unmount();
    }
  });

  // TCS-LIST-005: a signed `trackedChangeLabel` replaces every hardcoded
  // variant copy; optional detail lines render under the summary; label-less
  // rows keep the legacy copy byte-identical.
  it('renders the signed trackedChangeLabel instead of the trackFormat "Format: " prefix', () => {
    const comment = useComment({
      commentId: 'tc-list-add',
      fileId: 'doc-1',
      commentText: '',
      trackedChange: true,
      trackedChangeText: '',
      trackedChangeType: 'trackFormat',
      trackedChangeDisplayType: 'format',
      trackedChangeLabel: 'Added 3 items to a list',
    });
    commentsStore.commentsList = [comment];

    const wrapper = mountDialog(comment);
    try {
      const trackedChange = wrapper.find('.tracked-change');
      expect(trackedChange.text()).toBe('Added 3 items to a list');
      expect(trackedChange.text()).not.toContain('Format:');
    } finally {
      wrapper.unmount();
    }
  });

  it('renders a small image preview for image tracked-change rows', () => {
    const comment = useComment({
      commentId: 'tc-image-delete',
      fileId: 'doc-1',
      commentText: '',
      trackedChange: true,
      trackedChangeText: '',
      trackedChangeType: 'trackDelete',
      trackedChangeDisplayType: 'tableDelete',
      trackedChangeLabel: 'Deleted image',
      trackedChangeImagePreview: {
        src: ONE_BY_ONE_PNG,
        contentType: 'image/png',
        role: 'deleted',
        width: 96,
        height: 96,
        alt: 'Deleted preview',
      },
    });
    commentsStore.commentsList = [comment];

    const wrapper = mountDialog(comment);
    try {
      expect(wrapper.find('.tracked-change').text()).toContain('Deleted image');
      const preview = wrapper.find('.tracked-change-image-preview');
      expect(preview.exists()).toBe(true);
      expect(preview.attributes('data-track-change-image-preview-role')).toBe('deleted');
      const image = wrapper.find('.tracked-change-image-preview__image');
      expect(image.attributes('src')).toBe(ONE_BY_ONE_PNG);
      expect(image.attributes('alt')).toBe('Deleted preview');
      expect(image.attributes('style')).toContain('width: 90px');
      expect(image.attributes('style')).toContain('height: 90px');
    } finally {
      wrapper.unmount();
    }
  });

  it('renders the signed label over the paragraphSplit copy for in-list splits', () => {
    const comment = useComment({
      commentId: 'tc-split-list',
      fileId: 'doc-1',
      commentText: '',
      trackedChange: true,
      trackedChangeText: '',
      trackedChangeType: 'trackInsert',
      trackedChangeDisplayType: 'paragraphSplit',
      trackedChangeLabel: 'Split list item',
    });
    commentsStore.commentsList = [comment];

    const wrapper = mountDialog(comment);
    try {
      expect(wrapper.find('.tracked-change').text()).toBe('Split list item');
    } finally {
      wrapper.unmount();
    }
  });

  it('renders the signed label over the deletion phrasing for merge rows', () => {
    const comment = useComment({
      commentId: 'tc-merge',
      fileId: 'doc-1',
      commentText: '',
      trackedChange: true,
      trackedChangeType: 'delete',
      trackedChangeDisplayType: 'delete',
      deletedText: 'second item',
      trackedChangeLabel: 'Merged list items',
    });
    commentsStore.commentsList = [comment];

    const wrapper = mountDialog(comment);
    try {
      const text = wrapper.find('.tracked-change').text();
      expect(text).toBe('Merged list items');
      expect(text).not.toContain('Deleted');
    } finally {
      wrapper.unmount();
    }
  });

  it('renders per-member detail lines under the heterogeneous summary label', () => {
    const comment = useComment({
      commentId: 'tc-mixed',
      fileId: 'doc-1',
      commentText: '',
      trackedChange: true,
      trackedChangeText: '',
      trackedChangeType: 'trackFormat',
      trackedChangeDisplayType: 'format',
      trackedChangeLabel: 'Changed list formatting (2 items)',
      trackedChangeDetailLines: [
        { excerpt: 'Second existing item', label: 'Changed list style' },
        { excerpt: 'New plain paragraph', label: 'Added to list' },
      ],
    });
    commentsStore.commentsList = [comment];

    const wrapper = mountDialog(comment);
    try {
      const lines = wrapper.findAll('.tracked-change-detail-line');
      expect(lines).toHaveLength(2);
      expect(lines[0].text()).toBe('"Second existing item" — Changed list style');
      expect(lines[1].text()).toBe('"New plain paragraph" — Added to list');
      expect(wrapper.find('.tracked-change').text()).toContain('Changed list formatting (2 items)');
    } finally {
      wrapper.unmount();
    }
  });

  it('shows a scrollable expanded state for overflowing tracked-change details', async () => {
    const scrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    const clientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        return this.classList?.contains('tracked-change') ? 120 : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return this.classList?.contains('tracked-change') ? 42 : 0;
      },
    });

    const comment = useComment({
      commentId: 'tc-row-details',
      fileId: 'doc-1',
      commentText: '',
      trackedChange: true,
      trackedChangeText: '',
      trackedChangeType: 'trackInsert',
      trackedChangeDisplayType: 'tableInsert',
      trackedChangeLabel: 'Added row',
      trackedChangeDetailLines: [
        { excerpt: 'First inserted cell text', label: 'Added text' },
        { excerpt: 'Second inserted cell text', label: 'Added text' },
        { excerpt: 'Third inserted cell text', label: 'Added text' },
        { excerpt: 'Fourth inserted cell text', label: 'Added text' },
      ],
    });
    commentsStore.commentsList = [comment];

    const wrapper = mountDialog(comment);
    try {
      await flushPromises();
      expect(wrapper.find('.show-more-toggle').text()).toBe('Show more');

      await wrapper.find('.show-more-toggle').trigger('click');
      expect(wrapper.find('.tracked-change').classes()).toContain('is-scrollable');
      expect(wrapper.find('.show-more-toggle').text()).toBe('Show less');
    } finally {
      wrapper.unmount();
      if (scrollHeightDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'scrollHeight', scrollHeightDescriptor);
      } else {
        delete HTMLElement.prototype.scrollHeight;
      }
      if (clientHeightDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeightDescriptor);
      } else {
        delete HTMLElement.prototype.clientHeight;
      }
    }
  });

  it('shows the truncation toggle when tracked-change details hydrate after mount', async () => {
    const scrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    const clientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        return this.querySelector?.('.tracked-change-detail-lines') ? 120 : 42;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return 42;
      },
    });

    const comment = useComment({
      commentId: 'tc-row-hydrates-details',
      fileId: 'doc-1',
      commentText: '',
      trackedChange: true,
      trackedChangeText: '',
      trackedChangeType: 'trackInsert',
      trackedChangeDisplayType: 'tableInsert',
      trackedChangeLabel: 'Added row',
    });
    commentsStore.commentsList = [comment];

    const wrapper = mountDialog(comment);
    try {
      await flushPromises();
      expect(wrapper.find('.show-more-toggle').exists()).toBe(false);

      commentsStore.commentsList[0].trackedChangeDetailLines = [
        { excerpt: 'First inserted cell text', label: 'Added text' },
        { excerpt: 'Second inserted cell text', label: 'Added text' },
        { excerpt: 'Third inserted cell text', label: 'Added text' },
        { excerpt: 'Fourth inserted cell text', label: 'Added text' },
      ];
      await flushPromises();

      expect(wrapper.find('.show-more-toggle').text()).toBe('Show more');
    } finally {
      wrapper.unmount();
      if (scrollHeightDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'scrollHeight', scrollHeightDescriptor);
      } else {
        delete HTMLElement.prototype.scrollHeight;
      }
      if (clientHeightDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeightDescriptor);
      } else {
        delete HTMLElement.prototype.clientHeight;
      }
    }
  });

  it('keeps label-less legacy variants byte-identical (trackFormat prefix and split copy unchanged)', () => {
    const formatComment = useComment({
      commentId: 'tc-fmt-legacy',
      fileId: 'doc-1',
      commentText: '',
      trackedChange: true,
      trackedChangeText: 'bold',
      trackedChangeType: 'trackFormat',
      trackedChangeDisplayType: 'format',
    });
    commentsStore.commentsList = [formatComment];
    const formatWrapper = mountDialog(formatComment);
    try {
      expect(formatWrapper.find('.tracked-change').text()).toBe('Format: bold');
      expect(formatWrapper.find('.tracked-change-detail-lines').exists()).toBe(false);
    } finally {
      formatWrapper.unmount();
    }
  });

  it.each([true, false])(
    'refreshes v2 review controls when saving finishes without changing the adapter or document mode (tracked: %s)',
    async (tracked) => {
      let snapshot = { state: 'saving' };
      const listeners = new Set();
      const unsubscribe = vi.fn((listener) => listeners.delete(listener));
      superdocStub.activeEditor.editorVersion = 2;
      superdocStub.activeEditor.host = {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => unsubscribe(listener);
        },
      };
      superdocStub.activeEditor.v2TrackedChanges = {
        getCapabilityState: () => ({
          canDecide: snapshot.state === 'editing-ready',
          reason: snapshot.state === 'editing-ready' ? null : `host-state:${snapshot.state}`,
        }),
      };
      superdocStub.activeEditor.v2Comments = {
        getCapabilityState: () => ({
          canWrite: snapshot.state === 'editing-ready',
          reason: snapshot.state === 'editing-ready' ? null : `host-state:${snapshot.state}`,
        }),
      };
      const trackedChange = useComment({
        commentId: 'tc-save-completion',
        fileId: 'doc-1',
        commentText: '',
        trackedChange: tracked,
        trackedChangeType: 'insert',
        trackedChangeDisplayType: 'insert',
        trackedChangeText: 'saved revision',
      });
      commentsStore.commentsList = [trackedChange];
      const wrapper = mountDialog(trackedChange);
      try {
        const header = wrapper.findComponent({ name: 'CommentHeader' });
        expect(header.props('resolveDisabledReason')).toBe('host-state:saving');
        expect(header.props('rejectDisabledReason')).toBe('host-state:saving');

        snapshot = { state: 'editing-ready' };
        for (const listener of listeners) listener(snapshot);
        await flushPromises();
        expect(header.props('resolveDisabledReason')).toBeNull();
        expect(header.props('rejectDisabledReason')).toBeNull();

        snapshot = { state: 'saving' };
        for (const listener of listeners) listener(snapshot);
        await flushPromises();
        expect(header.props('resolveDisabledReason')).toBe('host-state:saving');
        expect(header.props('rejectDisabledReason')).toBe('host-state:saving');
      } finally {
        wrapper.unmount();
      }
      expect(unsubscribe).toHaveBeenCalledOnce();
      expect(listeners.size).toBe(0);
    },
  );

  it('releases the previous v2 host subscription when the active editor is replaced or cleared', async () => {
    const events = new Map();
    superdocStub.on = vi.fn((name, listener) => events.set(name, listener));
    superdocStub.off = vi.fn((name, listener) => {
      if (events.get(name) === listener) events.delete(name);
    });
    const previousUnsubscribe = vi.fn();
    const nextUnsubscribe = vi.fn();
    superdocStub.activeEditor = {
      editorVersion: 2,
      host: { subscribe: vi.fn(() => previousUnsubscribe) },
      v2TrackedChanges: { getCapabilityState: () => ({ canDecide: false, reason: 'host-state:saving' }) },
    };
    const comment = useComment({ commentId: 'tc-host-replacement', fileId: 'doc-1', trackedChange: true });
    commentsStore.commentsList = [comment];
    const wrapper = mountDialog(comment);
    try {
      const header = wrapper.findComponent({ name: 'CommentHeader' });
      expect(header.props('rejectDisabledReason')).toBe('host-state:saving');
      const nextHost = { subscribe: vi.fn(() => nextUnsubscribe) };
      superdocStub.activeEditor = {
        editorVersion: 2,
        host: nextHost,
        v2TrackedChanges: { getCapabilityState: () => ({ canDecide: true, reason: null }) },
      };
      events.get('active-editor-change')();
      await flushPromises();
      expect(previousUnsubscribe).toHaveBeenCalledOnce();
      expect(nextHost.subscribe).toHaveBeenCalledOnce();
      expect(header.props('rejectDisabledReason')).toBeNull();

      superdocStub.activeEditor = { editorVersion: 1 };
      events.get('active-editor-change')();
      await flushPromises();
      expect(nextUnsubscribe).toHaveBeenCalledOnce();
      superdocStub.activeEditor = null;
      events.get('active-editor-change')();
      await flushPromises();
    } finally {
      wrapper.unmount();
    }
    expect(events.size).toBe(0);
    expect(previousUnsubscribe).toHaveBeenCalledOnce();
    expect(nextUnsubscribe).toHaveBeenCalledOnce();
  });

  it('reactively disables v2 tracked-change decisions when document mode switches to viewing', async () => {
    superdocStub.activeEditor.editorVersion = 2;
    superdocStub.activeEditor.v2TrackedChanges = {
      getCapabilityState: vi.fn(() => ({ canDecide: true })),
    };
    const trackedChange = useComment({
      commentId: 'tc-viewing-mode',
      fileId: 'doc-1',
      commentText: '',
      trackedChange: true,
      trackedChangeType: 'insert',
      trackedChangeDisplayType: 'insert',
      trackedChangeText: 'viewing mode revision',
    });
    commentsStore.commentsList = [trackedChange];
    commentsStore.setViewingVisibility({
      documentMode: 'editing',
      commentsVisible: true,
      trackChangesVisible: true,
    });

    const wrapper = mountDialog(trackedChange);
    try {
      const header = wrapper.findComponent({ name: 'CommentHeader' });
      expect(header.props('resolveDisabledReason')).toBeNull();
      expect(header.props('rejectDisabledReason')).toBeNull();

      commentsStore.setViewingVisibility({ documentMode: 'viewing' });
      await flushPromises();

      expect(header.props('resolveDisabledReason')).toBe('review-surface-read-only');
      expect(header.props('rejectDisabledReason')).toBe('review-surface-read-only');
    } finally {
      wrapper.unmount();
    }
  });

  it('focuses a linked tracked-change carrier from an ordinary v2 comment while keeping the comment active', async () => {
    const focusComment = vi.fn().mockResolvedValue({ ok: true });
    const focusTrackedChange = vi.fn().mockResolvedValue({ ok: true });
    superdocStub.activeEditor.editorVersion = 2;
    superdocStub.activeEditor.v2Comments = { focusComment };
    superdocStub.activeEditor.v2TrackedChanges = { focusTrackedChange };
    const comment = useComment({
      commentId: 'comment-linked-to-change',
      fileId: 'doc-1',
      commentText: 'Linked comment',
      trackedChangeParentId: 'canonical-change-id',
    });
    commentsStore.commentsList = [comment];

    const wrapper = mountDialog(comment);
    try {
      await wrapper.find('.comments-dialog').trigger('click');
      await flushPromises();

      expect(focusTrackedChange).toHaveBeenCalledWith('canonical-change-id');
      expect(focusComment).not.toHaveBeenCalled();
      expect(commentsStore.activeComment).toBe('comment-linked-to-change');
    } finally {
      wrapper.unmount();
    }
  });

  it('routes a resolved linked ordinary v2 comment through resolved-comment focus suppression', async () => {
    const focusComment = vi.fn().mockResolvedValue({ ok: false, reason: 'resolved-comment' });
    const focusTrackedChange = vi.fn().mockResolvedValue({ ok: true });
    superdocStub.activeEditor.editorVersion = 2;
    superdocStub.activeEditor.v2Comments = { focusComment };
    superdocStub.activeEditor.v2TrackedChanges = { focusTrackedChange };
    const comment = useComment({
      commentId: 'resolved-comment-linked-to-change',
      fileId: 'doc-1',
      commentText: 'Resolved linked comment',
      trackedChangeParentId: 'canonical-change-id',
      resolvedTime: Date.now(),
    });
    commentsStore.commentsList = [comment];

    const wrapper = mountDialog(comment);
    try {
      await wrapper.find('.comments-dialog').trigger('click');
      await flushPromises();

      expect(focusComment).toHaveBeenCalledWith(comment);
      expect(focusTrackedChange).not.toHaveBeenCalled();
      expect(commentsStore.activeComment).not.toBe('resolved-comment-linked-to-change');
    } finally {
      wrapper.unmount();
    }
  });

  it('preserves the tracked-change story when focusing from a linked ordinary v2 comment', async () => {
    const focusComment = vi.fn().mockResolvedValue({ ok: true });
    const focusTrackedChange = vi.fn().mockResolvedValue({ ok: true });
    superdocStub.activeEditor.editorVersion = 2;
    superdocStub.activeEditor.v2Comments = { focusComment };
    superdocStub.activeEditor.v2TrackedChanges = { focusTrackedChange };
    const trackedChange = useComment({
      commentId: 'footnote-change-id',
      fileId: 'doc-1',
      trackedChange: true,
      trackedChangeStory: { kind: 'story', storyType: 'footnote', noteId: '1' },
      trackedChangeAnchorKey: 'tc::fn:1::footnote-change-id',
    });
    const comment = useComment({
      commentId: 'comment-linked-to-footnote-change',
      fileId: 'doc-1',
      commentText: 'Linked footnote comment',
      trackedChangeParentId: 'footnote-change-id',
    });
    commentsStore.commentsList = [trackedChange, comment];

    const wrapper = mountDialog(comment);
    try {
      await wrapper.find('.comments-dialog').trigger('click');
      await flushPromises();

      expect(focusTrackedChange).toHaveBeenCalledWith(trackedChange);
      expect(focusComment).not.toHaveBeenCalled();
      expect(commentsStore.activeComment).toBe('comment-linked-to-footnote-change');
    } finally {
      wrapper.unmount();
    }
  });

  it('falls back to focusing an ordinary v2 comment when its linked tracked-change carrier is unavailable', async () => {
    const focusComment = vi.fn().mockResolvedValue({ ok: true });
    const focusTrackedChange = vi.fn().mockResolvedValue({ ok: false, reason: 'tracked-change-anchor-not-found' });
    superdocStub.activeEditor.editorVersion = 2;
    superdocStub.activeEditor.v2Comments = { focusComment };
    superdocStub.activeEditor.v2TrackedChanges = { focusTrackedChange };
    const comment = useComment({
      commentId: 'comment-with-hidden-change',
      fileId: 'doc-1',
      commentText: 'Comment with hidden change',
      trackedChangeParentId: 'hidden-change-id',
    });
    commentsStore.commentsList = [comment];

    const wrapper = mountDialog(comment);
    try {
      await wrapper.find('.comments-dialog').trigger('click');
      await flushPromises();

      expect(focusTrackedChange).toHaveBeenCalledWith('hidden-change-id');
      expect(focusComment).toHaveBeenCalledWith(comment);
      expect(commentsStore.activeComment).toBe('comment-with-hidden-change');
    } finally {
      wrapper.unmount();
    }
  });

  it('focuses an unlinked ordinary v2 comment through the comments adapter', async () => {
    const focusComment = vi.fn().mockResolvedValue({ ok: true });
    const focusTrackedChange = vi.fn().mockResolvedValue({ ok: true });
    superdocStub.activeEditor.editorVersion = 2;
    superdocStub.activeEditor.v2Comments = { focusComment };
    superdocStub.activeEditor.v2TrackedChanges = { focusTrackedChange };
    const comment = useComment({
      commentId: 'comment-without-change',
      fileId: 'doc-1',
      commentText: 'Unlinked comment',
    });
    commentsStore.commentsList = [comment];

    const wrapper = mountDialog(comment);
    try {
      await wrapper.find('.comments-dialog').trigger('click');
      await flushPromises();

      expect(focusComment).toHaveBeenCalledWith(comment);
      expect(focusTrackedChange).not.toHaveBeenCalled();
      expect(commentsStore.activeComment).toBe('comment-without-change');
    } finally {
      wrapper.unmount();
    }
  });

  describe('v2 comment write permissions (SD-6050)', () => {
    const prepare = (documentMode, { canWrite = true, readOnly = false } = {}) => {
      commentsStore.init({ readOnly, allowResolve: false });
      commentsStore.setViewingVisibility({ documentMode, commentsVisible: true, trackChangesVisible: true });
      superdocStub.interactionConfig = {
        comments: { level: readOnly ? 'read' : 'write', readOnly, allowResolve: false },
        trackedChanges: { allowDecisions: false },
      };
      superdocStub.activeEditor.editorVersion = 2;
      superdocStub.activeEditor.v2Comments = {
        getCapabilityState: vi.fn(() => ({ canWrite, reason: canWrite ? null : 'host-state:saving' })),
        setActiveComment: vi.fn(),
        focusComment: vi.fn().mockResolvedValue({ ok: true }),
      };
      const comment = useComment({
        commentId: 'comment-owner',
        creatorId: superdocStore.user.id,
        creatorEmail: superdocStore.user.email,
        fileId: 'doc-1',
        commentText: 'Original owner comment',
      });
      commentsStore.commentsList = [comment];
      commentsStore.activeComment = comment.commentId;
      return comment;
    };

    const selectOverflow = async (wrapper, label) => {
      await wrapper.find('[data-comment-action="overflow"] .comments-dropdown__trigger').trigger('click');
      const option = [...document.querySelectorAll('.comments-dropdown__option')].find(
        (element) => element.textContent.trim() === label,
      );
      expect(option).toBeDefined();
      option.click();
      await flushPromises();
    };

    it.each(['editing', 'viewing'])('submits one reply to the existing thread in %s mode', async (mode) => {
      const comment = prepare(mode);
      const reply = vi.spyOn(commentsStore, 'replyCommentV2').mockResolvedValue({ ok: true });
      const wrapper = mountDialog(comment, { CommentHeader: false });
      try {
        expect(wrapper.find('[data-comment-action="resolve"]').exists()).toBe(false);
        await wrapper.find('.reply-pill').trigger('click');
        expect(wrapper.find('.reply-expanded').exists()).toBe(true);
        commentsStore.currentCommentText = '<p>Owner reply</p>';
        await flushPromises();
        await wrapper.find('button.reply-btn-primary').trigger('click');
        await flushPromises();
        expect(reply).toHaveBeenCalledExactlyOnceWith({
          superdoc: superdocStub,
          parentCommentId: comment.commentId,
          text: '<p>Owner reply</p>',
        });
      } finally {
        wrapper.unmount();
      }
    });

    it.each(['editing', 'viewing'])('edits the own comment through its menu in %s mode', async (mode) => {
      const comment = prepare(mode);
      const edit = vi.spyOn(commentsStore, 'editCommentV2').mockResolvedValue({ ok: true });
      const wrapper = mountDialog(comment, { CommentHeader: false });
      try {
        await selectOverflow(wrapper, 'Edit');
        expect(commentsStore.editingCommentId).toBe(comment.commentId);
        commentsStore.currentCommentText = '<p>Corrected owner comment</p>';
        await flushPromises();
        await wrapper.find('button.reply-btn-primary').trigger('click');
        await flushPromises();
        expect(edit).toHaveBeenCalledExactlyOnceWith({
          superdoc: superdocStub,
          commentId: comment.commentId,
          text: '<p>Corrected owner comment</p>',
        });
        expect(commentsStore.editingCommentId).toBeNull();
      } finally {
        wrapper.unmount();
      }
    });

    it('shows a refusal for an edit while retaining the draft', async () => {
      const comment = prepare('editing');
      vi.spyOn(commentsStore, 'editCommentV2').mockResolvedValue({ ok: false, code: 'PERMISSION_DENIED' });
      const wrapper = mountDialog(comment, { CommentHeader: false });
      try {
        await selectOverflow(wrapper, 'Edit');
        commentsStore.currentCommentText = '<p>Unsaved edit</p>';
        await flushPromises();
        await wrapper.find('button.reply-btn-primary').trigger('click');
        await flushPromises();
        expect(wrapper.find('[role="alert"]').text()).toContain('you do not have permission');
        expect(commentsStore.currentCommentText).toBe('<p>Unsaved edit</p>');
        expect(commentsStore.editingCommentId).toBe(comment.commentId);
      } finally {
        wrapper.unmount();
      }
    });

    it('shows a refusal when resolving fails', async () => {
      const comment = prepare('editing');
      commentsStore.init({ readOnly: false, allowResolve: true });
      superdocStub.interactionConfig.comments.allowResolve = true;
      vi.spyOn(commentsStore, 'resolveCommentV2').mockResolvedValue({ ok: false, code: 'PERMISSION_DENIED' });
      const wrapper = mountDialog(comment);
      try {
        wrapper.findComponent({ name: 'CommentHeader' }).vm.$emit('resolve');
        await flushPromises();
        expect(wrapper.find('[role="alert"]').text()).toContain('you do not have permission');
      } finally {
        wrapper.unmount();
      }
    });

    it('shows a refusal when deletion fails', async () => {
      const comment = prepare('editing');
      vi.spyOn(commentsStore, 'deleteComment').mockResolvedValue({ ok: false, code: 'PERMISSION_DENIED' });
      const wrapper = mountDialog(comment, { CommentHeader: false });
      try {
        await selectOverflow(wrapper, 'Delete');
        await flushPromises();
        expect(wrapper.find('[role="alert"]').text()).toContain('you do not have permission');
      } finally {
        wrapper.unmount();
      }
    });

    it.each(['editing', 'viewing'])('deletes the own comment through its menu in %s mode', async (mode) => {
      const comment = prepare(mode);
      const remove = vi.spyOn(commentsStore, 'deleteComment').mockResolvedValue({ ok: true });
      const wrapper = mountDialog(comment, { CommentHeader: false });
      try {
        await selectOverflow(wrapper, 'Delete');
        expect(remove).toHaveBeenCalledExactlyOnceWith({ superdoc: superdocStub, commentId: comment.commentId });
      } finally {
        wrapper.unmount();
      }
    });

    it('keeps a permitted reply available when switching to viewing mode', async () => {
      const comment = prepare('editing');
      const wrapper = mountDialog(comment);
      try {
        commentsStore.setViewingVisibility({ documentMode: 'viewing' });
        await flushPromises();
        expect(wrapper.find('.reply-pill').attributes('disabled')).toBeUndefined();
        await wrapper.find('.reply-pill').trigger('click');
        expect(wrapper.find('.reply-expanded').exists()).toBe(true);
      } finally {
        wrapper.unmount();
      }
    });

    it.each([
      { role: 'suggester', options: [] },
      { role: 'editor', options: ['Delete'] },
    ])('preserves $role permissions on another author’s viewing-mode comment', async ({ role, options }) => {
      const comment = prepare('viewing');
      comment.creatorId = 'other-user';
      comment.creatorEmail = 'other@example.com';
      comment.creatorName = superdocStore.user.name;
      superdocStub.config.role = role;
      const edit = vi.spyOn(commentsStore, 'editCommentV2');
      const remove = vi.spyOn(commentsStore, 'deleteComment');
      const wrapper = mountDialog(comment, { CommentHeader: false });
      try {
        const replyPill = wrapper.find('.reply-pill');
        expect(replyPill.attributes('disabled')).toBeUndefined();
        const overflow = wrapper.find('[data-comment-action="overflow"]');
        expect(overflow.exists()).toBe(options.length > 0);
        if (options.length > 0) {
          await overflow.find('.comments-dropdown__trigger').trigger('click');
          expect(
            [...document.querySelectorAll('.comments-dropdown__option')].map((option) => option.textContent.trim()),
          ).toEqual(options);
        }
        await replyPill.trigger('click');
        expect(wrapper.find('.reply-expanded').exists()).toBe(true);
        expect(commentsStore.editingCommentId).toBeNull();
        expect(edit).not.toHaveBeenCalled();
        expect(remove).not.toHaveBeenCalled();
      } finally {
        wrapper.unmount();
      }
    });

    it('keeps host-denied replies and own-comment overflow unavailable in viewing mode', async () => {
      const comment = prepare('viewing', { canWrite: false });
      const wrapper = mountDialog(comment, { CommentHeader: false });
      try {
        const replyPill = wrapper.find('.reply-pill');
        expect(replyPill.attributes('disabled')).toBeDefined();
        expect(replyPill.attributes('data-disabled-reason')).toBe('host-state:saving');
        await replyPill.trigger('click');
        expect(wrapper.find('.reply-expanded').exists()).toBe(false);
        expect(wrapper.find('[data-comment-action="overflow"]').exists()).toBe(false);
      } finally {
        wrapper.unmount();
      }
    });

    it('keeps read-level comment actions unavailable in viewing mode', async () => {
      const comment = prepare('viewing', { readOnly: true });
      const remove = vi.spyOn(commentsStore, 'deleteComment');
      const wrapper = mountDialog(comment, { CommentHeader: false });
      try {
        expect(wrapper.find('.reply-pill').exists()).toBe(false);
        expect(wrapper.find('[data-comment-action="overflow"]').exists()).toBe(false);
        const header = wrapper.findComponent({ name: 'CommentHeader' });
        header.vm.$emit('overflow-select', 'edit');
        header.vm.$emit('overflow-select', 'delete');
        await flushPromises();
        expect(commentsStore.editingCommentId).toBeNull();
        expect(remove).not.toHaveBeenCalled();
      } finally {
        wrapper.unmount();
      }
    });

    it.each([true, false])('honors the pending viewing-mode creation capability: %s', async (canCreate) => {
      const comment = prepare('viewing');
      commentsStore.pendingComment = comment;
      commentsStore.currentCommentText = '<p>New viewing-mode comment</p>';
      const capability = superdocStub.activeEditor.v2Comments.getCapabilityState.mockImplementation((command) => ({
        canWrite: command === 'comments.createFromSelection' && canCreate,
        reason: canCreate ? null : 'host-state:saving',
      }));
      const add = vi.spyOn(commentsStore, 'addComment').mockResolvedValue({ ok: true });
      const wrapper = mountDialog(comment);
      try {
        await wrapper.find('button.reply-btn-primary').trigger('click');
        await flushPromises();
        expect(capability).toHaveBeenCalledWith('comments.createFromSelection');
        expect(add).toHaveBeenCalledTimes(canCreate ? 1 : 0);
      } finally {
        wrapper.unmount();
      }
    });
  });

  it('coalesces rapid v2 reply clicks while the first submission is pending (SD-3867)', async () => {
    superdocStub.activeEditor.editorVersion = 2;
    superdocStub.activeEditor.v2Comments = {
      getCapabilityState: vi.fn(() => ({ canWrite: true })),
    };
    const comment = useComment({
      commentId: 'comment-delayed-reply',
      fileId: 'doc-1',
      commentText: 'Delayed reply parent',
    });
    commentsStore.commentsList = [comment];
    commentsStore.activeComment = comment.commentId;
    commentsStore.currentCommentText = '<p>one delayed reply</p>';

    let settleReply;
    const pendingReply = new Promise((resolve) => {
      settleReply = resolve;
    });
    const replyCommentV2 = vi.spyOn(commentsStore, 'replyCommentV2').mockReturnValue(pendingReply);

    const wrapper = mountDialog(comment);
    try {
      await wrapper.find('.reply-pill').trigger('click');
      const replyButton = wrapper.find('button.reply-btn-primary');

      await replyButton.trigger('click');
      await replyButton.trigger('click');
      await replyButton.trigger('click');

      expect(replyCommentV2).toHaveBeenCalledTimes(1);
      expect(replyButton.attributes('disabled')).toBeDefined();

      settleReply({ ok: true });
      await flushPromises();
      expect(wrapper.find('.reply-expanded').exists()).toBe(false);
    } finally {
      settleReply?.({ ok: true });
      wrapper.unmount();
    }
  });

  it.each([
    ['PERMISSION_DENIED', 'you do not have permission'],
    ['INTERNAL_ERROR', 'Try again or cancel'],
  ])('explains a refused v2 reply and clears feedback when retried or canceled (%s)', async (code, message) => {
    superdocStub.activeEditor.editorVersion = 2;
    superdocStub.activeEditor.v2Comments = {
      getCapabilityState: vi.fn(() => ({ canWrite: true })),
    };
    const comment = useComment({ commentId: 'reply-denied', fileId: 'doc-1', commentText: 'Parent' });
    commentsStore.commentsList = [comment];
    commentsStore.activeComment = comment.commentId;
    commentsStore.currentCommentText = '<p>Keep my reply</p>';
    let settleRetry;
    const retry = new Promise((resolve) => {
      settleRetry = resolve;
    });
    vi.spyOn(commentsStore, 'replyCommentV2')
      .mockResolvedValueOnce({ ok: false, code })
      .mockReturnValueOnce(retry)
      .mockResolvedValue({ ok: false, code });
    const wrapper = mountDialog(comment);
    try {
      await wrapper.find('.reply-pill').trigger('click');
      await wrapper.find('button.reply-btn-primary').trigger('click');
      await flushPromises();
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
      expect(wrapper.find('[role="alert"]').text()).toContain(message);
      expect(commentsStore.currentCommentText).toBe('<p>Keep my reply</p>');
      expect(wrapper.find('.reply-expanded').exists()).toBe(true);
      await wrapper.find('button.reply-btn-primary').trigger('click');
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
      settleRetry({ ok: true });
      await flushPromises();
      expect(wrapper.find('.reply-expanded').exists()).toBe(false);
      expect(commentsStore.currentCommentText).toBe('');
      await wrapper.find('.reply-pill').trigger('click');
      commentsStore.currentCommentText = '<p>Another reply</p>';
      await flushPromises();
      await wrapper.find('button.reply-btn-primary').trigger('click');
      await flushPromises();
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
      await wrapper.find('button.reply-btn-cancel').trigger('click');
      await wrapper.find('.reply-pill').trigger('click');
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    } finally {
      settleRetry?.({ ok: true });
      wrapper.unmount();
    }
  });

  it('coalesces rapid new-comment clicks while the first submission is pending', async () => {
    superdocStub.activeEditor.editorVersion = 2;
    superdocStub.activeEditor.v2Comments = {
      getCapabilityState: vi.fn(() => ({ canWrite: true })),
    };
    const pendingDraft = useComment({
      commentId: 'pending-new-comment-delayed',
      fileId: 'doc-1',
      commentText: '',
    });
    commentsStore.pendingComment = pendingDraft;
    commentsStore.currentCommentText = '<p>one delayed new comment</p>';

    let settleAdd;
    const pendingAdd = new Promise((resolve) => {
      settleAdd = resolve;
    });
    const addComment = vi.spyOn(commentsStore, 'addComment').mockReturnValue(pendingAdd);

    const wrapper = mountDialog(pendingDraft);
    try {
      const submitButton = wrapper.find('button.reply-btn-primary');

      await submitButton.trigger('click');
      await submitButton.trigger('click');
      await submitButton.trigger('click');

      expect(addComment).toHaveBeenCalledTimes(1);
      expect(submitButton.attributes('disabled')).toBeDefined();

      settleAdd({ ok: true });
      await flushPromises();
      expect(submitButton.attributes('disabled')).toBeUndefined();
    } finally {
      settleAdd?.({ ok: true });
      wrapper.unmount();
    }
  });

  it('shows a permission refusal without discarding the pending new-comment draft', async () => {
    superdocStub.activeEditor.editorVersion = 2;
    superdocStub.activeEditor.v2Comments = {
      getCapabilityState: vi.fn(() => ({ canWrite: true })),
    };
    const pendingDraft = useComment({
      commentId: 'pending-new-comment-denied',
      fileId: 'doc-1',
      commentText: '',
    });
    commentsStore.pendingComment = pendingDraft;
    commentsStore.currentCommentText = '<p>Keep my draft</p>';
    vi.spyOn(commentsStore, 'addComment').mockResolvedValue({
      ok: false,
      reason: 'receipt-failure',
      code: 'PERMISSION_DENIED',
      detail: 'document-mode-read-only',
    });
    const wrapper = mountDialog(pendingDraft);
    try {
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
      await wrapper.find('button.reply-btn-primary').trigger('click');
      await flushPromises();
      expect(wrapper.find('[role="alert"]').text()).toContain('document or connection is read-only');
      expect(commentsStore.currentCommentText).toBe('<p>Keep my draft</p>');
      expect(commentsStore.pendingComment).not.toBeNull();
      expect(wrapper.find('button.reply-btn-primary').attributes('disabled')).toBeUndefined();
    } finally {
      wrapper.unmount();
    }
  });

  it('clears the new-comment submitting flag even when addComment throws synchronously', async () => {
    superdocStub.activeEditor.editorVersion = 2;
    superdocStub.activeEditor.v2Comments = {
      getCapabilityState: vi.fn(() => ({ canWrite: true })),
    };
    const pendingDraft = useComment({
      commentId: 'pending-new-comment-throws',
      fileId: 'doc-1',
      commentText: '',
    });
    commentsStore.pendingComment = pendingDraft;
    commentsStore.currentCommentText = '<p>a new comment that fails</p>';

    const addComment = vi.spyOn(commentsStore, 'addComment').mockImplementation(() => {
      throw new Error('boom');
    });

    const wrapper = mountDialog(pendingDraft);
    try {
      const submitButton = wrapper.find('button.reply-btn-primary');

      await submitButton.trigger('click');
      await flushPromises();

      expect(addComment).toHaveBeenCalledTimes(1);
      expect(submitButton.attributes('disabled')).toBeUndefined();

      await submitButton.trigger('click');
      await flushPromises();
      expect(addComment).toHaveBeenCalledTimes(2);
    } finally {
      wrapper.unmount();
    }
  });

  it('creates a v2 comment anchored to the tracked change when an unrelated pending comment exists', async () => {
    superdocStub.activeEditor.editorVersion = 2;
    superdocStub.activeEditor.v2Comments = {};
    const trackedChangeCanonicalId = 'tc|main%3A%2Fword%2Fdocument.xml|del|coalesced|0';
    const trackedChangeStory = { kind: 'story', storyType: 'body' };
    const trackedChange = useComment({
      commentId:
        'tc|main%3A%2Fword%2Fdocument.xml|del|sd%3Amain%3A%2Fword%2Fdocument.xml%7Cdel%7CSuperdoc%20User%7C2024-12-20T04%3A20%3A00Z%7C0%7CwId%3A0',
      importedId: '0',
      trackedChangeCanonicalId,
      trackedChangeStory,
      fileId: 'doc-1',
      commentText: '',
      trackedChange: true,
      trackedChangeType: 'delete',
      trackedChangeDisplayType: 'delete',
      deletedText: ' DOCX',
    });
    commentsStore.commentsList = [trackedChange];
    commentsStore.activeComment = trackedChange.commentId;
    commentsStore.pendingComment = useComment({
      commentId: 'pending-new-comment',
      fileId: 'doc-1',
      commentText: '',
    });
    commentsStore.currentCommentText = '<p>tracked-change sidecar reply proof</p>';
    commentsStore.currentCommentMentions = [
      { id: 'reviewer-1', name: 'Internal Reviewer', email: 'reviewer@example.com' },
    ];
    const replyCommentV2 = vi.spyOn(commentsStore, 'replyCommentV2').mockResolvedValue({ ok: true });
    const addComment = vi.spyOn(commentsStore, 'addComment').mockResolvedValue({ ok: true });

    const wrapper = mountDialog(trackedChange);
    try {
      await wrapper.find('.reply-pill').trigger('click');
      await wrapper.find('button.reply-btn-primary').trigger('click');
      await flushPromises();

      expect(replyCommentV2).toHaveBeenCalledTimes(1);
      expect(replyCommentV2).toHaveBeenCalledWith({
        superdoc: superdocStub,
        parentCommentId: trackedChangeCanonicalId,
        text: '<p>tracked-change sidecar reply proof</p>',
        mentions: [{ id: 'reviewer-1', name: 'Internal Reviewer', email: 'reviewer@example.com' }],
        trackedChangeTarget: {
          kind: 'trackedChange',
          trackedChangeId: trackedChangeCanonicalId,
          story: trackedChangeStory,
        },
      });
      expect(addComment).not.toHaveBeenCalled();
    } finally {
      wrapper.unmount();
    }
  });

  it('keeps ordinary v2 replies addressed to the visible comment root id', async () => {
    superdocStub.activeEditor.editorVersion = 2;
    superdocStub.activeEditor.v2Comments = {};
    const comment = useComment({
      commentId: 'comment-root',
      importedId: 'imported-docx-id',
      fileId: 'doc-1',
      commentText: '<p>Root comment</p>',
    });
    commentsStore.commentsList = [comment];
    commentsStore.activeComment = comment.commentId;
    commentsStore.currentCommentText = '<p>ordinary reply</p>';
    const replyCommentV2 = vi.spyOn(commentsStore, 'replyCommentV2').mockResolvedValue({ ok: true });
    const addComment = vi.spyOn(commentsStore, 'addComment').mockResolvedValue({ ok: true });

    const wrapper = mountDialog(comment);
    try {
      await wrapper.find('.reply-pill').trigger('click');
      await wrapper.find('button.reply-btn-primary').trigger('click');
      await flushPromises();

      expect(replyCommentV2).toHaveBeenCalledTimes(1);
      expect(replyCommentV2).toHaveBeenCalledWith({
        superdoc: superdocStub,
        parentCommentId: 'comment-root',
        text: '<p>ordinary reply</p>',
      });
      expect(addComment).not.toHaveBeenCalled();
    } finally {
      wrapper.unmount();
    }
  });
});
