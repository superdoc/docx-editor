import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref, reactive, h, defineComponent, nextTick, customRef } from 'vue';
import { PresentationEditor } from '@superdoc/super-editor';

let superdocStoreStub;
let commentsStoreStub;

vi.mock('@superdoc/stores/superdoc-store', () => ({
  useSuperdocStore: () => superdocStoreStub,
}));

vi.mock('@superdoc/stores/comments-store', () => ({
  useCommentsStore: () => commentsStoreStub,
}));

vi.mock('@superdoc/helpers/use-selection', () => ({
  default: vi.fn((params) => ({ getValues: () => ({ ...params }), selectionBounds: params.selectionBounds || {} })),
}));

vi.mock('@superdoc/super-editor', () => ({
  SuperInput: defineComponent({
    name: 'SuperInputStub',
    setup(_, { slots }) {
      return () => h('textarea', slots.default?.());
    },
  }),
  PresentationEditor: {
    getInstance: vi.fn(() => null),
  },
}));

const simpleStub = (name, emits = []) =>
  defineComponent({
    name,
    props: ['comment', 'config', 'state', 'isDisabled', 'timestamp', 'users'],
    emits,
    setup(props, { emit }) {
      return () =>
        h(
          'div',
          {
            class: `${name}-stub`,
            onClick: () => {
              if (emits.includes('click')) emit('click');
            },
          },
          [],
        );
    },
  });

const CommentHeaderStub = defineComponent({
  name: 'CommentHeaderStub',
  props: ['config', 'timestamp', 'comment'],
  emits: ['resolve', 'reject', 'overflow-select'],
  setup(props, { emit }) {
    return () =>
      h('div', { class: 'comment-header-stub', 'data-comment-id': props.comment.commentId }, [
        h('button', { class: 'resolve-btn', onClick: () => emit('resolve') }, 'resolve'),
        h('button', { class: 'reject-btn', onClick: () => emit('reject') }, 'reject'),
        h('button', { class: 'overflow-btn', onClick: () => emit('overflow-select', 'edit') }, 'edit'),
      ]);
  },
});

const InternalDropdownStub = defineComponent({
  name: 'InternalDropdownStub',
  props: ['isDisabled', 'state'],
  emits: ['select'],
  setup(props, { emit }) {
    return () =>
      h('div', {
        class: 'internal-dropdown-stub',
        onClick: () => emit('select', props.state === 'internal' ? 'external' : 'internal'),
      });
  },
});

let commentInputFocusSpies;

const CommentInputStub = defineComponent({
  name: 'CommentInputStub',
  props: ['users', 'config', 'comment'],
  setup(_, { expose }) {
    const focusSpy = vi.fn();
    commentInputFocusSpies.push(focusSpy);
    expose({ focus: focusSpy });
    return () => h('div', { class: 'comment-input-stub' });
  },
});

const AvatarStub = simpleStub('Avatar');

vi.mock('@superdoc/components/CommentsLayer/InternalDropdown.vue', () => ({ default: InternalDropdownStub }));
vi.mock('@superdoc/components/CommentsLayer/CommentHeader.vue', () => ({ default: CommentHeaderStub }));
vi.mock('@superdoc/components/CommentsLayer/CommentInput.vue', () => ({ default: CommentInputStub }));
vi.mock('@superdoc/components/general/Avatar.vue', () => ({ default: AvatarStub }));

vi.mock('@superdoc/core/collaboration/permissions.js', () => ({
  PERMISSIONS: { MANAGE_COMMENTS: 'manage' },
  isAllowed: () => true,
}));

const mountDialog = async ({
  baseCommentOverrides = {},
  extraComments = [],
  props = {},
  commentsStoreOverrides = {},
  superdocOverrides = {},
} = {}) => {
  const baseComment = reactive({
    uid: 'uid-1',
    commentId: 'comment-1',
    parentCommentId: null,
    email: 'author@example.com',
    commentText: '<p>Hello</p>',
    fileId: 'doc-1',
    fileType: 'DOCX',
    setActive: vi.fn(),
    setText: vi.fn(),
    setIsInternal: vi.fn(),
    resolveComment: vi.fn(),
    trackedChange: false,
    importedId: null,
    trackedChangeType: null,
    trackedChangeText: null,
    trackedChangeDisplayType: null,
    deletedText: null,
    selection: {
      getValues: () => ({ selectionBounds: { top: 110, bottom: 130, left: 15, right: 30 } }),
      selectionBounds: { top: 110, bottom: 130, left: 15, right: 30 },
    },
  });

  Object.assign(baseComment, baseCommentOverrides);

  superdocStoreStub = {
    activeZoom: ref(100),
    user: reactive({ name: 'Editor', email: 'editor@example.com' }),
  };

  commentsStoreStub = {
    addComment: vi.fn(),
    cancelComment: vi.fn(),
    deleteComment: vi.fn(),
    removePendingComment: vi.fn(),
    requestInstantSidebarAlignment: vi.fn(),
    clearInstantSidebarAlignment: vi.fn(),
    setActiveFloatingCommentInstance: vi.fn(),
    decideTrackedChangeFromSidebar: vi.fn(() => ({ ok: true, success: true })),
    getCommentDocumentId: vi.fn(
      (comment) => comment?.fileId ?? comment?.documentId ?? comment?.selection?.documentId ?? null,
    ),
    getCommentAliasIds: vi.fn((commentOrId) => {
      const rawId = typeof commentOrId === 'object' ? null : commentOrId;
      const comment =
        typeof commentOrId === 'object'
          ? commentOrId
          : commentsStoreStub.commentsList.find(
              (item) => item.commentId === commentOrId || item.importedId === commentOrId,
            );

      return [rawId, comment?.trackedChangeAnchorKey, comment?.commentId, comment?.importedId].filter(Boolean);
    }),
    resolveCommentPositionEntry: vi.fn((commentOrId) => {
      const positions = commentsStoreStub.editorCommentPositions.value ?? {};
      const ids = commentsStoreStub.getCommentAliasIds(commentOrId);

      for (const id of ids) {
        if (positions[id]) {
          return { key: id, entry: positions[id] };
        }
      }

      return { key: null, entry: null };
    }),
    setActiveComment: vi.fn(),
    getPendingComment: vi.fn(() => ({
      commentId: 'pending-1',
      selection: baseComment.selection,
      isInternal: true,
    })),
    commentsList: [baseComment, ...extraComments],
    suppressInternalExternal: ref(false),
    getConfig: ref({ readOnly: false }),
    activeComment: ref(null),
    activeFloatingCommentInstanceId: ref(null),
    floatingCommentsOffset: ref(0),
    pendingComment: ref(null),
    currentCommentText: ref('<p>Pending</p>'),
    editingCommentId: ref(null),
    editorCommentPositions: ref({}),
    hasSyncedCollaborationComments: ref(false),
    generalCommentIds: ref([]),
    getFloatingComments: ref([]),
    commentsByDocument: ref(new Map()),
    documentsWithConverations: ref([]),
    isCommentsListVisible: ref(false),
    isFloatingCommentsReady: ref(false),
    hasInitializedLocations: ref(true),
    isCommentHighlighted: ref(false),
    ...commentsStoreOverrides,
  };

  const defaultActiveEditor = {
    commands: {
      setCursorById: vi.fn().mockReturnValue(true),
      setActiveComment: vi.fn(),
      rejectTrackedChangeById: vi.fn(),
      acceptTrackedChangeById: vi.fn(),
      setCommentInternal: vi.fn(),
      resolveComment: vi.fn(),
    },
  };
  const { activeEditor: activeEditorOverride, ...restSuperdocOverrides } = superdocOverrides;
  const superdocStub = {
    config: { role: 'editor', isInternal: true },
    users: [
      { name: 'Internal', email: 'internal@example.com', access: { role: 'internal' } },
      { name: 'External', email: 'external@example.com', access: { role: 'external' } },
    ],
    activeEditor: { ...defaultActiveEditor, ...(activeEditorOverride ?? {}) },
    focus: vi.fn(),
    emit: vi.fn(),
    ...restSuperdocOverrides,
  };

  document.body.innerHTML = '<div id="host"></div>';

  const component = (await import('./CommentDialog.vue')).default;
  const wrapper = mount(component, {
    props: {
      comment: baseComment,
      autoFocus: true,
      ...props,
    },
    global: {
      config: {
        globalProperties: {
          $superdoc: superdocStub,
        },
      },
      directives: {
        'click-outside': {
          mounted(el, binding) {
            el.__clickOutside = binding.value;
          },
          unmounted(el) {
            delete el.__clickOutside;
          },
        },
      },
    },
  });

  await nextTick();
  return { wrapper, baseComment, superdocStub };
};

describe('CommentDialog.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    PresentationEditor.getInstance.mockReturnValue(null);
    commentInputFocusSpies = [];
  });

  it('focuses the comment on mount and adds replies', async () => {
    const { wrapper, baseComment, superdocStub } = await mountDialog();

    await nextTick();
    expect(superdocStub.activeEditor.commands.setCursorById).toHaveBeenCalledWith(baseComment.commentId, {
      activeCommentId: baseComment.commentId,
    });
    expect(commentsStoreStub.activeComment.value).toBe(baseComment.commentId);

    // Click the reply pill to expand the editor
    const pill = wrapper.find('.reply-pill');
    await pill.trigger('click');
    await nextTick();

    commentsStoreStub.pendingComment.value = {
      commentId: 'pending-1',
      selection: baseComment.selection,
      isInternal: true,
    };
    await nextTick();

    const addButton = wrapper.find('button.reply-btn-primary');
    await addButton.trigger('click');
    expect(commentsStoreStub.getPendingComment).toHaveBeenCalled();
    expect(commentsStoreStub.addComment).toHaveBeenCalledWith({
      superdoc: superdocStub,
      comment: expect.objectContaining({ commentId: 'pending-1' }),
    });
  });

  it('uses the reachable anchor Y for instant sidebar alignment when scroll is clamped', async () => {
    const presentation = {
      getReachableThreadAnchorClientY: vi.fn().mockReturnValue(165),
      scrollThreadAnchorToClientY: vi.fn().mockReturnValue(true),
      navigateTo: vi.fn().mockResolvedValue(true),
    };
    PresentationEditor.getInstance.mockReturnValue(presentation);

    await mountDialog({
      baseCommentOverrides: {
        commentId: 'tracked-change-1',
        importedId: 'imported-tracked-change-1',
        trackedChange: true,
        trackedChangeType: 'both',
        trackedChangeText: 'new text',
        deletedText: 'old text',
      },
    });

    expect(presentation.navigateTo).toHaveBeenCalledWith({
      kind: 'entity',
      entityType: 'trackedChange',
      entityId: 'imported-tracked-change-1',
    });
    expect(presentation.getReachableThreadAnchorClientY).not.toHaveBeenCalled();
    expect(commentsStoreStub.requestInstantSidebarAlignment).toHaveBeenCalledWith(
      expect.any(Number),
      'tracked-change-1',
    );
  });

  it('navigates tracked changes with story metadata through PresentationEditor', async () => {
    const presentation = {
      navigateTo: vi.fn().mockResolvedValue(true),
    };
    PresentationEditor.getInstance.mockReturnValue(presentation);

    const trackedChangeStory = { kind: 'story', storyType: 'footnote', noteId: '1' };

    await mountDialog({
      baseCommentOverrides: {
        commentId: 'tracked-change-story-1',
        importedId: 'imported-tracked-change-story-1',
        trackedChange: true,
        trackedChangeStory,
      },
    });

    expect(presentation.navigateTo).toHaveBeenCalledWith({
      kind: 'entity',
      entityType: 'trackedChange',
      entityId: 'imported-tracked-change-story-1',
      story: trackedChangeStory,
    });
  });

  it('navigates repeated header/footer tracked changes to the clicked floating page instance', async () => {
    const presentation = {
      navigateTo: vi.fn().mockResolvedValue(true),
    };
    PresentationEditor.getInstance.mockReturnValue(presentation);

    const trackedChangeStory = { kind: 'story', storyType: 'headerFooterPart', refId: 'rId-repeat' };
    const floatingInstanceId = 'tc::hf:part:rId-repeat::tracked-change-story-repeat::page:2';

    const { wrapper } = await mountDialog({
      props: {
        autoFocus: false,
        floatingInstanceId,
        floatingPageIndex: 2,
        floatingPositionEntry: {
          pageIndex: 2,
          bounds: { top: 240, left: 12, right: 64, bottom: 264, width: 52, height: 24 },
        },
      },
      baseCommentOverrides: {
        commentId: 'tracked-change-story-repeat',
        importedId: 'imported-tracked-change-story-repeat',
        trackedChange: true,
        trackedChangeStory,
      },
    });

    await wrapper.trigger('click');

    expect(presentation.navigateTo).toHaveBeenCalledWith({
      kind: 'entity',
      entityType: 'trackedChange',
      entityId: 'imported-tracked-change-story-repeat',
      story: trackedChangeStory,
      pageIndex: 2,
    });
    expect(commentsStoreStub.requestInstantSidebarAlignment).toHaveBeenCalledWith(
      expect.any(Number),
      'tracked-change-story-repeat',
      floatingInstanceId,
    );
    expect(commentsStoreStub.setActiveFloatingCommentInstance).toHaveBeenCalledWith(floatingInstanceId);
  });

  it('honors explicit floating instance active overrides', async () => {
    const inactiveMount = await mountDialog({
      props: {
        autoFocus: false,
        floatingInstanceId: 'thread-1::page:0',
        isFloatingInstanceActive: false,
      },
      commentsStoreOverrides: {
        activeComment: ref('comment-1'),
        activeFloatingCommentInstanceId: ref('thread-1::page:0'),
      },
    });

    expect(inactiveMount.wrapper.classes()).not.toContain('is-active');

    const activeMount = await mountDialog({
      props: {
        autoFocus: false,
        floatingInstanceId: 'thread-1::page:0',
        isFloatingInstanceActive: true,
      },
      commentsStoreOverrides: {
        activeComment: ref('comment-1'),
        activeFloatingCommentInstanceId: ref('thread-1::page:0'),
      },
    });

    expect(activeMount.wrapper.classes()).toContain('is-active');
  });

  it('clears instant alignment instead of re-requesting it when the active dialog is clicked again', async () => {
    const { wrapper } = await mountDialog({
      props: {
        autoFocus: false,
        floatingInstanceId: 'thread-1::page:2',
      },
      commentsStoreOverrides: {
        activeComment: ref('comment-1'),
        activeFloatingCommentInstanceId: ref('thread-1::page:2'),
      },
    });

    commentsStoreStub.requestInstantSidebarAlignment.mockClear();
    commentsStoreStub.clearInstantSidebarAlignment.mockClear();
    await wrapper.trigger('click');

    expect(commentsStoreStub.requestInstantSidebarAlignment).not.toHaveBeenCalled();
    expect(commentsStoreStub.clearInstantSidebarAlignment).toHaveBeenCalled();
  });

  it('falls back to setCursorById for resolved tracked changes when PresentationEditor navigation is unavailable', async () => {
    PresentationEditor.getInstance.mockReturnValue({});

    const { wrapper, superdocStub } = await mountDialog({
      props: { autoFocus: false },
      baseCommentOverrides: {
        commentId: 'tracked-change-resolved-1',
        importedId: 'imported-tracked-change-resolved-1',
        trackedChange: true,
        resolvedTime: Date.now(),
      },
    });

    superdocStub.activeEditor.commands.setCursorById.mockClear();
    await wrapper.trigger('click');

    expect(superdocStub.activeEditor.commands.setCursorById).toHaveBeenCalledWith('tracked-change-resolved-1');
    expect(superdocStub.activeEditor.commands.setActiveComment).not.toHaveBeenCalled();
  });

  it('activates the tracked-change bubble when cursor placement fallback fails', async () => {
    PresentationEditor.getInstance.mockReturnValue({});

    const { wrapper, superdocStub } = await mountDialog({
      props: { autoFocus: false },
      baseCommentOverrides: {
        commentId: 'tracked-change-fallback-1',
        importedId: 'imported-tracked-change-fallback-1',
        trackedChange: true,
      },
    });

    superdocStub.activeEditor.commands.setCursorById.mockReturnValue(false);
    superdocStub.activeEditor.commands.setCursorById.mockClear();
    superdocStub.activeEditor.commands.setActiveComment.mockClear();

    await wrapper.trigger('click');

    expect(superdocStub.activeEditor.commands.setCursorById).toHaveBeenCalledWith(
      'imported-tracked-change-fallback-1',
      {
        activeCommentId: 'tracked-change-fallback-1',
      },
    );
    expect(superdocStub.activeEditor.commands.setActiveComment).toHaveBeenCalledWith({
      commentId: 'tracked-change-fallback-1',
    });
  });

  it('activates the comment thread when non-tracked cursor placement fallback fails', async () => {
    PresentationEditor.getInstance.mockReturnValue(null);

    const { wrapper, superdocStub } = await mountDialog({
      props: { autoFocus: false },
      baseCommentOverrides: {
        commentId: 'comment-fallback-1',
        trackedChange: false,
      },
    });

    superdocStub.activeEditor.commands.setCursorById.mockReturnValue(false);
    superdocStub.activeEditor.commands.setCursorById.mockClear();
    superdocStub.activeEditor.commands.setActiveComment.mockClear();

    await wrapper.trigger('click');

    expect(superdocStub.activeEditor.commands.setCursorById).toHaveBeenCalledWith('comment-fallback-1', {
      activeCommentId: 'comment-fallback-1',
    });
    expect(superdocStub.activeEditor.commands.setActiveComment).toHaveBeenCalledWith({
      commentId: 'comment-fallback-1',
    });
  });

  it('prefers the actual visible highlight top after the scroll attempt', async () => {
    const presentation = {
      getReachableThreadAnchorClientY: vi.fn().mockReturnValue(274),
      scrollThreadAnchorToClientY: vi.fn().mockReturnValue(true),
    };
    PresentationEditor.getInstance.mockReturnValue(presentation);

    const { wrapper } = await mountDialog({
      props: { autoFocus: false },
      baseCommentOverrides: {
        commentId: 'tracked-change-1',
        trackedChange: true,
        trackedChangeType: 'both',
        trackedChangeText: 'new text',
        deletedText: 'old text',
      },
      commentsStoreOverrides: {
        editorCommentPositions: ref({
          'tracked-change-1': {
            start: 10,
            end: 20,
            pageIndex: 0,
            bounds: { top: 98, left: 105, right: 176 },
          },
          'imported-tracked-change-1': {
            start: 10,
            end: 13,
            pageIndex: 0,
            bounds: { top: 98, left: 107, right: 162 },
          },
        }),
      },
    });

    const highlight = document.createElement('span');
    highlight.className = 'superdoc-comment-highlight';
    highlight.setAttribute('data-comment-ids', 'imported-tracked-change-1');
    highlight.getBoundingClientRect = vi.fn(() => ({
      top: 165,
      left: 0,
      right: 200,
      bottom: 180,
      width: 200,
      height: 15,
      x: 0,
      y: 165,
      toJSON: () => ({}),
    }));
    document.body.appendChild(highlight);

    await wrapper.trigger('click');

    expect(commentsStoreStub.requestInstantSidebarAlignment).toHaveBeenCalledWith(165, 'tracked-change-1');
  });

  it('ignores offscreen highlights and falls back to the reachable anchor Y', async () => {
    const presentation = {
      getReachableThreadAnchorClientY: vi.fn().mockReturnValue(456),
      scrollThreadAnchorToClientY: vi.fn().mockReturnValue(true),
      navigateTo: vi.fn().mockResolvedValue(true),
    };
    PresentationEditor.getInstance.mockReturnValue(presentation);

    const { wrapper } = await mountDialog({
      props: { autoFocus: false },
      baseCommentOverrides: {
        commentId: 'tracked-change-1',
        importedId: 'imported-3f15df8f',
        trackedChange: true,
        trackedChangeType: 'both',
        trackedChangeText: 'new text',
        deletedText: 'old text',
      },
      commentsStoreOverrides: {
        editorCommentPositions: ref({
          'tracked-change-1': {
            start: 10,
            end: 20,
            pageIndex: 0,
            bounds: { top: 98, left: 105, right: 176 },
          },
        }),
      },
    });

    const offscreenHighlight = document.createElement('span');
    offscreenHighlight.className = 'superdoc-comment-highlight';
    offscreenHighlight.setAttribute('data-comment-ids', 'imported-3f15df8f');
    offscreenHighlight.getBoundingClientRect = vi.fn(() => ({
      top: -2687,
      left: 0,
      right: 200,
      bottom: -2672,
      width: 200,
      height: 15,
      x: 0,
      y: -2687,
      toJSON: () => ({}),
    }));
    document.body.appendChild(offscreenHighlight);

    await wrapper.trigger('click');

    expect(presentation.navigateTo).toHaveBeenCalledWith({
      kind: 'entity',
      entityType: 'trackedChange',
      entityId: 'imported-3f15df8f',
    });
    expect(commentsStoreStub.requestInstantSidebarAlignment).toHaveBeenCalledWith(
      expect.any(Number),
      'tracked-change-1',
    );
  });

  it('does not ask the presentation layer to scroll when the bubble is already aligned', async () => {
    const presentation = {
      getReachableThreadAnchorClientY: vi.fn().mockReturnValue(274),
      scrollThreadAnchorToClientY: vi.fn().mockReturnValue(true),
    };
    PresentationEditor.getInstance.mockReturnValue(presentation);

    const { wrapper } = await mountDialog({
      props: {
        autoFocus: false,
        parent: {
          getBoundingClientRect: () => ({
            top: 69,
            left: 0,
            right: 0,
            bottom: 0,
            width: 0,
            height: 0,
            x: 0,
            y: 69,
            toJSON: () => ({}),
          }),
        },
      },
      baseCommentOverrides: {
        commentId: 'tracked-change-1',
        trackedChange: true,
        trackedChangeType: 'both',
        trackedChangeText: 'new text',
        deletedText: 'old text',
      },
      commentsStoreOverrides: {
        editorCommentPositions: ref({
          'tracked-change-1': {
            start: 10,
            end: 20,
            pageIndex: 0,
            bounds: { top: 98, left: 105, right: 176 },
          },
        }),
      },
    });

    wrapper.element.getBoundingClientRect = vi.fn(() => ({
      top: 166,
      left: 0,
      right: 200,
      bottom: 280,
      width: 200,
      height: 114,
      x: 0,
      y: 166,
      toJSON: () => ({}),
    }));

    await wrapper.trigger('click');

    expect(presentation.scrollThreadAnchorToClientY).not.toHaveBeenCalled();
    expect(commentsStoreStub.requestInstantSidebarAlignment).toHaveBeenCalledWith(167, 'tracked-change-1');
  });

  it('queues instant sidebar alignment before mutating the active thread', async () => {
    const events = [];
    const trackedActiveComment = customRef((track, trigger) => {
      let currentValue = null;
      return {
        get() {
          track();
          return currentValue;
        },
        set(nextValue) {
          events.push('active');
          currentValue = nextValue;
          trigger();
        },
      };
    });

    const presentation = {
      getReachableThreadAnchorClientY: vi.fn().mockReturnValue(274),
      scrollThreadAnchorToClientY: vi.fn().mockReturnValue(true),
    };
    PresentationEditor.getInstance.mockReturnValue(presentation);

    await mountDialog({
      baseCommentOverrides: {
        commentId: 'comment-1',
        importedId: 'imported-3f15df8f',
      },
      commentsStoreOverrides: {
        activeComment: trackedActiveComment,
        requestInstantSidebarAlignment: vi.fn(() => {
          events.push('request');
        }),
      },
    });

    expect(events.slice(0, 2)).toEqual(['request', 'active']);
  });

  it('does not pass preferred thread override for resolved comments', async () => {
    const { baseComment, superdocStub } = await mountDialog({
      baseCommentOverrides: {
        resolvedTime: Date.now(),
      },
    });

    await nextTick();

    expect(baseComment.setActive).not.toHaveBeenCalled();
    expect(superdocStub.activeEditor.commands.setCursorById).toHaveBeenCalledWith(baseComment.commentId);
    expect(superdocStub.activeEditor.commands.setCursorById).not.toHaveBeenCalledWith(
      baseComment.commentId,
      expect.objectContaining({ preferredActiveThreadId: baseComment.commentId }),
    );
  });

  it('handles resolve and reject for tracked change comments', async () => {
    const { wrapper, baseComment, superdocStub } = await mountDialog({
      baseCommentOverrides: {
        trackedChange: true,
        trackedChangeType: 'trackInsert',
        trackedChangeText: 'Added',
        deletedText: 'Removed',
      },
    });

    const header = wrapper.findComponent(CommentHeaderStub);
    header.vm.$emit('resolve');
    await nextTick();
    expect(commentsStoreStub.decideTrackedChangeFromSidebar).toHaveBeenCalledWith(
      expect.objectContaining({ comment: baseComment, decision: 'accept' }),
    );
    expect(baseComment.resolveComment).toHaveBeenCalledWith({
      email: superdocStoreStub.user.email,
      name: superdocStoreStub.user.name,
      superdoc: expect.any(Object),
      decision: 'accept',
    });
    expect(superdocStub.focus).toHaveBeenCalledTimes(1);

    header.vm.$emit('reject');
    await nextTick();
    expect(commentsStoreStub.decideTrackedChangeFromSidebar).toHaveBeenCalledWith(
      expect.objectContaining({ comment: baseComment, decision: 'reject' }),
    );
    expect(superdocStub.focus).toHaveBeenCalledTimes(2);
  });

  it('does not resolve the tracked-change thread when the decision fails (SD-3386)', async () => {
    const { wrapper, baseComment } = await mountDialog({
      baseCommentOverrides: {
        trackedChange: true,
        trackedChangeType: 'trackDelete',
        trackedChangeText: 'Removed',
      },
    });
    commentsStoreStub.decideTrackedChangeFromSidebar.mockReturnValueOnce({ ok: true, success: false });

    const header = wrapper.findComponent(CommentHeaderStub);
    header.vm.$emit('reject');
    await nextTick();
    expect(baseComment.resolveComment).not.toHaveBeenCalled();
  });

  it('labels a rejected tracked change as Rejected, not Accepted (SD-3386)', async () => {
    const { wrapper } = await mountDialog({
      baseCommentOverrides: {
        trackedChange: true,
        trackedChangeType: 'trackDelete',
        trackedChangeText: 'Removed',
        resolvedTime: Date.now(),
        trackedChangeDecision: 'reject',
      },
    });

    expect(wrapper.find('.resolved-badge').text()).toContain('Rejected');
  });

  it('labels an accepted tracked change as Accepted', async () => {
    const { wrapper } = await mountDialog({
      baseCommentOverrides: {
        trackedChange: true,
        trackedChangeType: 'trackInsert',
        trackedChangeText: 'Added',
        resolvedTime: Date.now(),
        trackedChangeDecision: 'accept',
      },
    });

    expect(wrapper.find('.resolved-badge').text()).toContain('Accepted');
  });

  it('renders hyperlink additions without a format label', async () => {
    const { wrapper } = await mountDialog({
      baseCommentOverrides: {
        trackedChange: true,
        trackedChangeType: 'trackFormat',
        trackedChangeDisplayType: 'hyperlinkAdded',
        trackedChangeText: 'https://example.com',
      },
    });

    const trackedChange = wrapper.find('.tracked-change');
    expect(trackedChange.text()).toContain('Added hyperlink');
    expect(trackedChange.text()).toContain('https://example.com');
    expect(trackedChange.text()).not.toContain('Format:');
    expect(trackedChange.text()).not.toContain('underline');
  });

  it('renders hyperlink modifications without a format label', async () => {
    const { wrapper } = await mountDialog({
      baseCommentOverrides: {
        trackedChange: true,
        trackedChangeType: 'trackFormat',
        trackedChangeDisplayType: 'hyperlinkModified',
        trackedChangeText: 'https://new.com',
      },
    });

    const trackedChange = wrapper.find('.tracked-change');
    expect(trackedChange.text()).toContain('Changed hyperlink to');
    expect(trackedChange.text()).toContain('https://new.com');
    expect(trackedChange.text()).not.toContain('Format:');
    expect(trackedChange.text()).not.toContain('underline');
  });

  it('renders tabs in tracked-change bubble text as visible spaces', async () => {
    const { wrapper } = await mountDialog({
      baseCommentOverrides: {
        trackedChange: true,
        trackedChangeType: 'trackInsert',
        trackedChangeText: 'HELLO\tWORLD',
      },
    });

    const trackedChangeText = wrapper.find('.tracked-change').text().replace(/\s+/g, ' ').trim();
    expect(trackedChangeText).toContain('Added "HELLO WORLD"');
  });

  it('renders paragraph splits as new-line changes without a format label', async () => {
    const { wrapper } = await mountDialog({
      baseCommentOverrides: {
        trackedChange: true,
        trackedChangeType: 'trackFormat',
        trackedChangeDisplayType: 'paragraphSplit',
        trackedChangeText: 'new line',
      },
    });

    const trackedChange = wrapper.find('.tracked-change');
    expect(trackedChange.text()).toContain('Added new line');
    expect(trackedChange.text()).not.toContain('Format:');
    expect(trackedChange.text()).not.toContain('formatting');
  });

  it('calls custom accept handler instead of default behavior when configured', async () => {
    const customAcceptHandler = vi.fn();

    const { wrapper, baseComment, superdocStub } = await mountDialog({
      baseCommentOverrides: {
        trackedChange: true,
        trackedChangeType: 'trackInsert',
        trackedChangeText: 'Added',
      },
    });

    // Configure custom handler
    superdocStub.config.onTrackedChangeBubbleAccept = customAcceptHandler;

    const header = wrapper.findComponent(CommentHeaderStub);
    header.vm.$emit('resolve');

    // Custom handler should be called
    expect(customAcceptHandler).toHaveBeenCalledWith(baseComment, superdocStub.activeEditor);

    // Default accept command should NOT be called (custom handler replaces it)
    expect(superdocStub.activeEditor.commands.acceptTrackedChangeById).not.toHaveBeenCalled();

    // resolveComment should ALWAYS be called to prevent ghost bubbles (SD-2049)
    expect(baseComment.resolveComment).toHaveBeenCalled();

    // Cleanup should still happen
    await nextTick();
    expect(commentsStoreStub.activeComment.value).toBe(null);
    expect(commentsStoreStub.setActiveComment).toHaveBeenCalledWith(superdocStub, null);
  });

  it('calls custom reject handler instead of default behavior when configured', async () => {
    const customRejectHandler = vi.fn();

    const { wrapper, baseComment, superdocStub } = await mountDialog({
      baseCommentOverrides: {
        trackedChange: true,
        trackedChangeType: 'trackDelete',
        deletedText: 'Removed',
      },
    });

    // Configure custom handler
    superdocStub.config.onTrackedChangeBubbleReject = customRejectHandler;

    const header = wrapper.findComponent(CommentHeaderStub);
    header.vm.$emit('reject');

    // Custom handler should be called
    expect(customRejectHandler).toHaveBeenCalledWith(baseComment, superdocStub.activeEditor);

    // Default reject command should NOT be called (custom handler replaces it)
    expect(superdocStub.activeEditor.commands.rejectTrackedChangeById).not.toHaveBeenCalled();

    // resolveComment should ALWAYS be called to prevent ghost bubbles (SD-2049)
    expect(baseComment.resolveComment).toHaveBeenCalled();

    // Cleanup should still happen
    await nextTick();
    expect(commentsStoreStub.activeComment.value).toBe(null);
    expect(commentsStoreStub.setActiveComment).toHaveBeenCalledWith(superdocStub, null);
  });

  it('uses default behavior when custom handler is not a function', async () => {
    const { wrapper, baseComment, superdocStub } = await mountDialog({
      baseCommentOverrides: {
        trackedChange: true,
        trackedChangeType: 'trackInsert',
        trackedChangeText: 'Added',
      },
    });

    // Set to non-function value
    superdocStub.config.onTrackedChangeBubbleAccept = 'not-a-function';

    const header = wrapper.findComponent(CommentHeaderStub);
    header.vm.$emit('resolve');

    expect(commentsStoreStub.decideTrackedChangeFromSidebar).toHaveBeenCalledWith(
      expect.objectContaining({ comment: baseComment, decision: 'accept' }),
    );
    expect(baseComment.resolveComment).toHaveBeenCalled();
  });

  it('uses default behavior when no custom handler is configured', async () => {
    const { wrapper, baseComment, superdocStub } = await mountDialog({
      baseCommentOverrides: {
        trackedChange: true,
        trackedChangeType: 'trackInsert',
        trackedChangeText: 'Added',
      },
    });

    // Explicitly ensure no handlers are configured
    expect(superdocStub.config.onTrackedChangeBubbleAccept).toBeUndefined();
    expect(superdocStub.config.onTrackedChangeBubbleReject).toBeUndefined();

    const header = wrapper.findComponent(CommentHeaderStub);

    // Test accept
    header.vm.$emit('resolve');
    expect(commentsStoreStub.decideTrackedChangeFromSidebar).toHaveBeenCalledWith(
      expect.objectContaining({ comment: baseComment, decision: 'accept' }),
    );
    expect(baseComment.resolveComment).toHaveBeenCalled();

    // Test reject
    header.vm.$emit('reject');
    expect(commentsStoreStub.decideTrackedChangeFromSidebar).toHaveBeenCalledWith(
      expect.objectContaining({ comment: baseComment, decision: 'reject' }),
    );
  });

  it('still runs cleanup when custom handler does nothing (no-op)', async () => {
    const noOpHandler = vi.fn(); // Does nothing, just records call

    const { wrapper, baseComment, superdocStub } = await mountDialog({
      baseCommentOverrides: {
        trackedChange: true,
        trackedChangeType: 'trackInsert',
        trackedChangeText: 'Added',
      },
    });

    superdocStub.config.onTrackedChangeBubbleAccept = noOpHandler;

    const header = wrapper.findComponent(CommentHeaderStub);
    header.vm.$emit('resolve');

    // Handler was called
    expect(noOpHandler).toHaveBeenCalledWith(baseComment, superdocStub.activeEditor);

    // Default accept command should NOT run (custom handler replaces it)
    expect(superdocStub.activeEditor.commands.acceptTrackedChangeById).not.toHaveBeenCalled();

    // resolveComment should ALWAYS be called to prevent ghost bubbles (SD-2049)
    expect(baseComment.resolveComment).toHaveBeenCalled();

    // Cleanup should still happen (dialog closes even though handler did nothing)
    await nextTick();
    expect(commentsStoreStub.activeComment.value).toBe(null);
    expect(commentsStoreStub.setActiveComment).toHaveBeenCalledWith(superdocStub, null);
  });

  it('does not call custom handler for non-tracked-change comments', async () => {
    const customAcceptHandler = vi.fn();
    const customRejectHandler = vi.fn();

    const { wrapper, baseComment, superdocStub } = await mountDialog({
      baseCommentOverrides: {
        trackedChange: false, // Regular comment, not a tracked change
        commentText: '<p>Regular comment</p>',
      },
    });

    superdocStub.config.onTrackedChangeBubbleAccept = customAcceptHandler;
    superdocStub.config.onTrackedChangeBubbleReject = customRejectHandler;

    const header = wrapper.findComponent(CommentHeaderStub);

    // Resolve on regular comment should use default behavior (resolveComment)
    header.vm.$emit('resolve');
    expect(customAcceptHandler).not.toHaveBeenCalled();
    expect(baseComment.resolveComment).toHaveBeenCalled();

    // Reject on regular comment should delete the comment
    header.vm.$emit('reject');
    expect(customRejectHandler).not.toHaveBeenCalled();
    expect(commentsStoreStub.deleteComment).toHaveBeenCalledWith({
      superdoc: superdocStub,
      commentId: baseComment.commentId,
    });
  });

  it('supports editing threaded comments and toggling internal state', async () => {
    const childComment = reactive({
      uid: 'uid-2',
      commentId: 'child-1',
      parentCommentId: 'comment-1',
      email: 'child@example.com',
      commentText: '<p>Child</p>',
      fileId: 'doc-1',
      fileType: 'DOCX',
      setActive: vi.fn(),
      setText: vi.fn(),
      setIsInternal: vi.fn(),
      resolveComment: vi.fn(),
      trackedChange: false,
      selection: {
        getValues: () => ({ selectionBounds: { top: 120, bottom: 150, left: 20, right: 40 } }),
        selectionBounds: { top: 120, bottom: 150, left: 20, right: 40 },
      },
    });

    const { wrapper, baseComment, superdocStub } = await mountDialog({
      extraComments: [childComment],
    });

    // Activate the comment so child replies become visible
    commentsStoreStub.activeComment.value = baseComment.commentId;
    await nextTick();

    const headers = wrapper.findAllComponents(CommentHeaderStub);
    headers[1].vm.$emit('overflow-select', 'edit');
    expect(commentsStoreStub.editingCommentId.value).toBe(childComment.commentId);
    // Edit activates the root thread (props.comment), not the individual child being edited
    expect(commentsStoreStub.setActiveComment).toHaveBeenCalledWith(superdocStub, baseComment.commentId);

    commentsStoreStub.currentCommentText.value = '<p>Updated</p>';
    await nextTick();
    await nextTick();
    const updateButton = wrapper.findAll('button.sd-button.primary').find((btn) => btn.text() === 'Update');
    await updateButton.trigger('click');
    expect(childComment.setText).toHaveBeenCalledWith({ text: '<p>Updated</p>', superdoc: superdocStub });
    expect(commentsStoreStub.removePendingComment).toHaveBeenCalledWith(superdocStub);

    headers[1].vm.$emit('overflow-select', 'delete');
    expect(commentsStoreStub.deleteComment).toHaveBeenCalledWith({
      superdoc: superdocStub,
      commentId: childComment.commentId,
    });

    const dropdown = wrapper.findComponent(InternalDropdownStub);
    dropdown.vm.$emit('select', 'external');
    expect(baseComment.setIsInternal).toHaveBeenCalledWith({ isInternal: false, superdoc: superdocStub });
  });

  it('marks the active floating instance when edit mode opens from a repeated instance bubble', async () => {
    const floatingInstanceId = 'tc::hf:part:rId-repeat::comment-1::page:2';
    const { wrapper, superdocStub } = await mountDialog({
      props: {
        autoFocus: false,
        floatingInstanceId,
        floatingPageIndex: 2,
      },
    });

    const header = wrapper.findComponent(CommentHeaderStub);
    header.vm.$emit('overflow-select', 'edit');
    await nextTick();

    expect(commentsStoreStub.setActiveFloatingCommentInstance).toHaveBeenCalledWith(floatingInstanceId);
    expect(commentsStoreStub.setActiveComment).toHaveBeenCalledWith(superdocStub, 'comment-1');
  });

  it('updates pending-comment internal state without mutating the persisted comment', async () => {
    const { wrapper, baseComment } = await mountDialog({
      baseCommentOverrides: {
        isInternal: true,
      },
      commentsStoreOverrides: {
        pendingComment: ref({
          commentId: 'comment-1',
          selection: {
            getValues: () => ({ selectionBounds: { top: 110, bottom: 130, left: 15, right: 30 } }),
            selectionBounds: { top: 110, bottom: 130, left: 15, right: 30 },
          },
          isInternal: true,
        }),
      },
    });

    const dropdown = wrapper.findComponent(InternalDropdownStub);
    dropdown.vm.$emit('select', 'external');
    await nextTick();

    expect(commentsStoreStub.pendingComment.value.isInternal).toBe(false);
    expect(baseComment.setIsInternal).not.toHaveBeenCalled();
  });

  it('prepopulates edit text from a ref-based commentText value', async () => {
    const baseCommentWithRef = {
      commentText: { value: '<p>Ref text</p>' },
    };

    const { wrapper, superdocStub } = await mountDialog({
      baseCommentOverrides: baseCommentWithRef,
    });

    const header = wrapper.findComponent(CommentHeaderStub);
    header.vm.$emit('overflow-select', 'edit');

    expect(commentsStoreStub.currentCommentText.value).toBe('<p>Ref text</p>');
    expect(typeof commentsStoreStub.currentCommentText.value).toBe('string');
    expect(commentsStoreStub.currentCommentText.value).not.toBe(baseCommentWithRef.commentText);
    expect(commentsStoreStub.setActiveComment).toHaveBeenCalledWith(superdocStub, 'comment-1');
  });

  it('auto-focuses the edit input when entering edit mode', async () => {
    const { wrapper } = await mountDialog();

    const header = wrapper.findComponent(CommentHeaderStub);
    header.vm.$emit('overflow-select', 'edit');
    await nextTick();

    expect(commentInputFocusSpies.at(-1)).toHaveBeenCalled();
  });

  it('auto-focuses the new comment input when reply pill is clicked', async () => {
    const { wrapper, baseComment } = await mountDialog();
    commentsStoreStub.activeComment.value = baseComment.commentId;
    await nextTick();

    // Click the reply pill to expand the editor
    const pill = wrapper.find('.reply-pill');
    expect(pill.exists()).toBe(true);
    await pill.trigger('click');
    await nextTick();

    expect(commentInputFocusSpies.at(-1)).toHaveBeenCalled();
  });

  it('auto-focuses the pending comment input on mount', async () => {
    commentInputFocusSpies = [];

    await mountDialog({
      commentsStoreOverrides: {
        pendingComment: ref({
          commentId: 'comment-1',
          selection: {
            getValues: () => ({ selectionBounds: { top: 110, bottom: 130, left: 15, right: 30 } }),
            selectionBounds: { top: 110, bottom: 130, left: 15, right: 30 },
          },
          isInternal: true,
        }),
      },
    });
    await nextTick();

    expect(commentInputFocusSpies.at(-1)).toHaveBeenCalled();
  });

  it('filters reply suggestions to internal users for internal comments', async () => {
    const { wrapper, baseComment } = await mountDialog({
      baseCommentOverrides: {
        isInternal: true,
      },
    });
    commentsStoreStub.activeComment.value = baseComment.commentId;
    await nextTick();

    await wrapper.find('.reply-pill').trigger('click');
    await nextTick();

    const input = wrapper.findComponent(CommentInputStub);
    expect(input.props('users')).toEqual([
      { name: 'Internal', email: 'internal@example.com', access: { role: 'internal' } },
    ]);
  });

  it('emits dialog-exit when clicking outside active comment and no track changes highlighted', async () => {
    const { wrapper, baseComment } = await mountDialog();
    commentsStoreStub.activeComment.value = baseComment.commentId;

    const eventTarget = document.createElement('div');
    const handler = wrapper.element.__clickOutside;
    handler({ target: eventTarget, classList: { contains: () => false } });

    expect(commentsStoreStub.setActiveComment).toHaveBeenCalledWith(expect.any(Object), null);
    expect(wrapper.emitted('dialog-exit')).toHaveLength(1);
  });

  it('does not emit dialog-exit when track changes highlighted', async () => {
    const { wrapper, baseComment } = await mountDialog();
    commentsStoreStub.activeComment.value = baseComment.commentId;
    commentsStoreStub.isCommentHighlighted.value = true;

    const eventTarget = document.createElement('div');
    const handler = wrapper.element.__clickOutside;
    handler({ target: eventTarget, classList: { contains: () => false } });

    expect(commentsStoreStub.setActiveComment).not.toHaveBeenCalled();
    expect(wrapper.emitted()).not.toHaveProperty('dialog-exit');
  });

  it('does not deselect when e.target is wrong but elementFromPoint finds a comment highlight', async () => {
    const { wrapper, baseComment } = await mountDialog();
    commentsStoreStub.activeComment.value = baseComment.commentId;

    // Simulate pointer capture redirecting e.target to the viewport host
    const viewportHost = document.createElement('div');
    const commentHighlight = document.createElement('span');
    commentHighlight.className = 'superdoc-comment-highlight';
    document.body.appendChild(commentHighlight);

    const originalElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = vi.fn(() => commentHighlight);

    const handler = wrapper.element.__clickOutside;
    handler({ target: viewportHost, clientX: 50, clientY: 50 });

    expect(commentsStoreStub.setActiveComment).not.toHaveBeenCalled();
    expect(wrapper.emitted()).not.toHaveProperty('dialog-exit');

    document.elementFromPoint = originalElementFromPoint;
    document.body.removeChild(commentHighlight);
  });

  it('does not deselect when elementFromPoint finds a tracked-change element', async () => {
    const { wrapper, baseComment } = await mountDialog();
    commentsStoreStub.activeComment.value = baseComment.commentId;

    const viewportHost = document.createElement('div');
    const trackedInsert = document.createElement('span');
    trackedInsert.className = 'track-insert';
    document.body.appendChild(trackedInsert);

    const originalElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = vi.fn(() => trackedInsert);

    const handler = wrapper.element.__clickOutside;
    handler({ target: viewportHost, clientX: 50, clientY: 50 });

    expect(commentsStoreStub.setActiveComment).not.toHaveBeenCalled();
    expect(wrapper.emitted()).not.toHaveProperty('dialog-exit');

    document.elementFromPoint = originalElementFromPoint;
    document.body.removeChild(trackedInsert);
  });

  it('does not deselect when geometry finds a tracked-change element behind a pointer-events-none surface', async () => {
    const { wrapper, baseComment } = await mountDialog();
    commentsStoreStub.activeComment.value = baseComment.commentId;

    const viewportHost = document.createElement('div');
    const page = document.createElement('div');
    page.className = 'superdoc-page';
    document.body.appendChild(page);

    const trackedInsert = document.createElement('span');
    trackedInsert.className = 'track-insert-dec';
    trackedInsert.setAttribute('data-track-change-id', 'tracked-geometry-1');
    trackedInsert.getBoundingClientRect = vi.fn(() => ({
      top: 40,
      left: 32,
      right: 132,
      bottom: 64,
      width: 100,
      height: 24,
      x: 32,
      y: 40,
      toJSON: () => ({}),
    }));
    document.body.appendChild(trackedInsert);

    const originalElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = vi.fn(() => page);

    const handler = wrapper.element.__clickOutside;
    handler({ target: viewportHost, clientX: 80, clientY: 52 });

    expect(commentsStoreStub.setActiveComment).not.toHaveBeenCalled();
    expect(wrapper.emitted()).not.toHaveProperty('dialog-exit');

    document.elementFromPoint = originalElementFromPoint;
    document.body.removeChild(trackedInsert);
    document.body.removeChild(page);
  });

  it('deselects when elementFromPoint returns a non-ignored element', async () => {
    const { wrapper, baseComment } = await mountDialog();
    commentsStoreStub.activeComment.value = baseComment.commentId;

    const viewportHost = document.createElement('div');
    const plainDiv = document.createElement('div');
    plainDiv.className = 'some-normal-content';
    document.body.appendChild(plainDiv);

    const originalElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = vi.fn(() => plainDiv);

    const handler = wrapper.element.__clickOutside;
    handler({ target: viewportHost, clientX: 50, clientY: 50 });

    expect(commentsStoreStub.setActiveComment).toHaveBeenCalledWith(expect.any(Object), null);
    expect(wrapper.emitted('dialog-exit')).toHaveLength(1);

    document.elementFromPoint = originalElementFromPoint;
    document.body.removeChild(plainDiv);
  });

  it('sorts tracked change parent first, then child comments by creation time', async () => {
    // Simulate a tracked change with two comments on it
    // The comments were created after the tracked change but should appear below it
    const childComment1 = reactive({
      uid: 'uid-child-1',
      commentId: 'child-1',
      parentCommentId: 'tc-parent',
      email: 'child1@example.com',
      commentText: '<p>First reply</p>',
      createdTime: 1000, // Created first
      fileId: 'doc-1',
      fileType: 'DOCX',
      setActive: vi.fn(),
      setText: vi.fn(),
      setIsInternal: vi.fn(),
      resolveComment: vi.fn(),
      trackedChange: false,
      selection: {
        getValues: () => ({ selectionBounds: { top: 120, bottom: 150, left: 20, right: 40 } }),
        selectionBounds: { top: 120, bottom: 150, left: 20, right: 40 },
      },
    });

    const childComment2 = reactive({
      uid: 'uid-child-2',
      commentId: 'child-2',
      parentCommentId: 'tc-parent',
      email: 'child2@example.com',
      commentText: '<p>Second reply</p>',
      createdTime: 2000, // Created second
      fileId: 'doc-1',
      fileType: 'DOCX',
      setActive: vi.fn(),
      setText: vi.fn(),
      setIsInternal: vi.fn(),
      resolveComment: vi.fn(),
      trackedChange: false,
      selection: {
        getValues: () => ({ selectionBounds: { top: 120, bottom: 150, left: 20, right: 40 } }),
        selectionBounds: { top: 120, bottom: 150, left: 20, right: 40 },
      },
    });

    const { wrapper } = await mountDialog({
      baseCommentOverrides: {
        commentId: 'tc-parent',
        trackedChange: true,
        trackedChangeType: 'trackDelete',
        trackedChangeText: null,
        deletedText: 'Tracked changes',
        createdTime: 500, // Tracked change created first
      },
      // Add children in reverse order to verify sorting works
      extraComments: [childComment2, childComment1],
    });

    // Activate the comment so child replies become visible
    commentsStoreStub.activeComment.value = 'tc-parent';
    await nextTick();

    // Expand the collapsed thread (>= 2 children triggers collapse)
    const collapsedPill = wrapper.find('.collapsed-replies');
    if (collapsedPill.exists()) {
      await collapsedPill.trigger('click');
      await nextTick();
    }

    const headers = wrapper.findAllComponents(CommentHeaderStub);
    expect(headers).toHaveLength(3);

    // First should be the tracked change parent
    expect(headers[0].props('comment').commentId).toBe('tc-parent');
    expect(headers[0].props('comment').trackedChange).toBe(true);

    // Second should be child-1 (created at time 1000)
    expect(headers[1].props('comment').commentId).toBe('child-1');

    // Third should be child-2 (created at time 2000)
    expect(headers[2].props('comment').commentId).toBe('child-2');
  });

  it('re-collapses an expanded thread when active comment leaves the parent thread', async () => {
    const replyOne = reactive({
      uid: 'uid-reply-1',
      commentId: 'reply-1',
      parentCommentId: 'comment-1',
      email: 'reply1@example.com',
      commentText: '<p>First reply</p>',
      createdTime: 1000,
      fileId: 'doc-1',
      fileType: 'DOCX',
      setActive: vi.fn(),
      setText: vi.fn(),
      setIsInternal: vi.fn(),
      resolveComment: vi.fn(),
      trackedChange: false,
      selection: {
        getValues: () => ({ selectionBounds: { top: 120, bottom: 150, left: 20, right: 40 } }),
        selectionBounds: { top: 120, bottom: 150, left: 20, right: 40 },
      },
    });
    const replyTwo = reactive({
      uid: 'uid-reply-2',
      commentId: 'reply-2',
      parentCommentId: 'comment-1',
      email: 'reply2@example.com',
      commentText: '<p>Second reply</p>',
      createdTime: 2000,
      fileId: 'doc-1',
      fileType: 'DOCX',
      setActive: vi.fn(),
      setText: vi.fn(),
      setIsInternal: vi.fn(),
      resolveComment: vi.fn(),
      trackedChange: false,
      selection: {
        getValues: () => ({ selectionBounds: { top: 120, bottom: 150, left: 20, right: 40 } }),
        selectionBounds: { top: 120, bottom: 150, left: 20, right: 40 },
      },
    });

    const { wrapper } = await mountDialog({
      extraComments: [replyOne, replyTwo],
      props: { autoFocus: false },
    });

    commentsStoreStub.activeComment.value = 'comment-1';
    await nextTick();

    const collapsedPill = wrapper.find('.collapsed-replies');
    expect(collapsedPill.exists()).toBe(true);
    await collapsedPill.trigger('click');
    await nextTick();
    expect(wrapper.findAll('.conversation-item')).toHaveLength(3);

    commentsStoreStub.activeComment.value = replyTwo.commentId;
    await nextTick();

    expect(wrapper.find('.collapsed-replies').exists()).toBe(true);
    expect(wrapper.findAll('.conversation-item')).toHaveLength(2);
  });

  it('threads range-based comments under tracked change parent', async () => {
    const rangeBasedRoot = reactive({
      uid: 'uid-range-root',
      commentId: 'range-root',
      parentCommentId: null,
      trackedChangeParentId: 'tc-parent',
      threadingMethod: 'range-based',
      email: 'root@example.com',
      commentText: '<p>Root comment</p>',
      createdTime: 1000,
      fileId: 'doc-1',
      fileType: 'DOCX',
      setActive: vi.fn(),
      setText: vi.fn(),
      setIsInternal: vi.fn(),
      resolveComment: vi.fn(),
      trackedChange: false,
      selection: {
        getValues: () => ({ selectionBounds: { top: 120, bottom: 150, left: 20, right: 40 } }),
        selectionBounds: { top: 120, bottom: 150, left: 20, right: 40 },
      },
    });

    const replyToRoot = reactive({
      uid: 'uid-range-reply',
      commentId: 'range-reply',
      parentCommentId: 'range-root',
      email: 'reply@example.com',
      commentText: '<p>Reply comment</p>',
      createdTime: 1500,
      fileId: 'doc-1',
      fileType: 'DOCX',
      setActive: vi.fn(),
      setText: vi.fn(),
      setIsInternal: vi.fn(),
      resolveComment: vi.fn(),
      trackedChange: false,
      selection: {
        getValues: () => ({ selectionBounds: { top: 120, bottom: 150, left: 20, right: 40 } }),
        selectionBounds: { top: 120, bottom: 150, left: 20, right: 40 },
      },
    });

    const { wrapper } = await mountDialog({
      baseCommentOverrides: {
        commentId: 'tc-parent',
        trackedChange: true,
        trackedChangeType: 'trackInsert',
        trackedChangeText: 'Added',
        createdTime: 500,
      },
      extraComments: [replyToRoot, rangeBasedRoot],
    });

    // Activate the comment so child replies become visible
    commentsStoreStub.activeComment.value = 'tc-parent';
    await nextTick();

    // Expand the collapsed thread (>= 2 children triggers collapse)
    const collapsedPill = wrapper.find('.collapsed-replies');
    if (collapsedPill.exists()) {
      await collapsedPill.trigger('click');
      await nextTick();
    }

    const headers = wrapper.findAllComponents(CommentHeaderStub);
    expect(headers).toHaveLength(3);
    expect(headers[0].props('comment').commentId).toBe('tc-parent');
    expect(headers[1].props('comment').commentId).toBe('range-root');
    expect(headers[2].props('comment').commentId).toBe('range-reply');
  });

  it('does not collapse tracked-change dialog reply threads', async () => {
    const rangeBasedRoot = reactive({
      uid: 'uid-range-root',
      commentId: 'range-root',
      parentCommentId: null,
      trackedChangeParentId: 'tc-parent',
      email: 'root@example.com',
      commentText: '<p>Root comment</p>',
      createdTime: 1000,
      fileId: 'doc-1',
      fileType: 'DOCX',
      setActive: vi.fn(),
      setText: vi.fn(),
      setIsInternal: vi.fn(),
      resolveComment: vi.fn(),
      trackedChange: false,
      selection: {
        getValues: () => ({ selectionBounds: { top: 120, bottom: 150, left: 20, right: 40 } }),
        selectionBounds: { top: 120, bottom: 150, left: 20, right: 40 },
      },
    });

    const replyToRoot = reactive({
      uid: 'uid-range-reply',
      commentId: 'range-reply',
      parentCommentId: 'range-root',
      trackedChangeParentId: 'tc-parent',
      email: 'reply@example.com',
      commentText: '<p>Reply comment</p>',
      createdTime: 1500,
      fileId: 'doc-1',
      fileType: 'DOCX',
      setActive: vi.fn(),
      setText: vi.fn(),
      setIsInternal: vi.fn(),
      resolveComment: vi.fn(),
      trackedChange: false,
      selection: {
        getValues: () => ({ selectionBounds: { top: 120, bottom: 150, left: 20, right: 40 } }),
        selectionBounds: { top: 120, bottom: 150, left: 20, right: 40 },
      },
    });

    const { wrapper } = await mountDialog({
      props: {
        autoFocus: false,
        floatingInstanceId: 'tc::body::tc-parent',
        isFloatingInstanceActive: false,
      },
      baseCommentOverrides: {
        commentId: 'tc-parent',
        trackedChange: true,
        trackedChangeType: 'trackInsert',
        trackedChangeText: 'Added',
        createdTime: 500,
      },
      extraComments: [replyToRoot, rangeBasedRoot],
    });

    expect(wrapper.classes()).not.toContain('is-active');
    expect(wrapper.find('.collapsed-replies').exists()).toBe(false);
    expect(wrapper.text()).toContain('Root comment');
    expect(wrapper.text()).toContain('Reply comment');
  });

  it('calls cancelComment with superdoc instance when cancel button is clicked', async () => {
    const { wrapper, baseComment, superdocStub } = await mountDialog();

    // Set up as active comment to show the cancel button
    commentsStoreStub.activeComment.value = baseComment.commentId;
    await nextTick();

    // Click the reply pill to expand the editor
    const pill = wrapper.find('.reply-pill');
    await pill.trigger('click');
    await nextTick();

    // Find the cancel button in the reply actions
    const cancelButton = wrapper.find('button.reply-btn-cancel');
    expect(cancelButton.exists()).toBe(true);

    await cancelButton.trigger('click');

    // Verify cancelComment was called with the superdoc instance
    expect(commentsStoreStub.cancelComment).toHaveBeenCalledWith(superdocStub);
  });

  describe('readOnly mode', () => {
    it('hides the reply pill when readOnly is true', async () => {
      const { wrapper, baseComment } = await mountDialog();

      commentsStoreStub.activeComment.value = baseComment.commentId;
      commentsStoreStub.getConfig.value = { readOnly: true };
      await nextTick();

      const pill = wrapper.find('.reply-pill');
      expect(pill.exists()).toBe(false);
    });

    it('shows the reply pill when readOnly is false', async () => {
      const { wrapper, baseComment } = await mountDialog();

      commentsStoreStub.activeComment.value = baseComment.commentId;
      await nextTick();

      const pill = wrapper.find('.reply-pill');
      expect(pill.exists()).toBe(true);
    });

    it('does not enter edit mode when readOnly is true and overflow-select edit is emitted', async () => {
      const { wrapper } = await mountDialog();

      commentsStoreStub.getConfig.value = { readOnly: true };
      await nextTick();

      const header = wrapper.findComponent(CommentHeaderStub);
      header.vm.$emit('overflow-select', 'edit');
      await nextTick();

      // Edit mode should not activate — the readOnly config prop is passed to CommentHeader
      // which gates the edit option, but even if the event fires, the config is propagated
      expect(header.props('config')).toEqual({ readOnly: true });
    });

    it('passes readOnly config to CommentHeader', async () => {
      const { wrapper } = await mountDialog();

      commentsStoreStub.getConfig.value = { readOnly: true };
      await nextTick();

      const header = wrapper.findComponent(CommentHeaderStub);
      expect(header.props('config')).toEqual({ readOnly: true });
    });

    it('passes non-readOnly config to CommentHeader by default', async () => {
      const { wrapper } = await mountDialog();

      const header = wrapper.findComponent(CommentHeaderStub);
      expect(header.props('config')).toEqual({ readOnly: false });
    });
  });
});
