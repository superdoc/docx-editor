import { describe, it, expect, beforeEach, vi } from 'vite-plus/test';
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, reactive, toRaw } from 'vue';
import { PERMISSIONS } from '@superdoc/core/collaboration/permissions.js';

let commentsStoreStub;
let allowedPermissions;

vi.mock('@superdoc/stores/comments-store', () => ({
  useCommentsStore: () => commentsStoreStub,
}));

vi.mock('@superdoc/composables/useUiFontFamily.js', () => ({
  useUiFontFamily: () => ({ uiFontFamily: 'Test Sans' }),
}));

vi.mock('@superdoc/components/general/Avatar.vue', () => ({
  default: defineComponent({
    name: 'AvatarStub',
    props: ['user'],
    setup(props) {
      return () => h('div', { class: 'avatar-stub' }, props.user?.name ?? '');
    },
  }),
}));

vi.mock('./CommentsDropdown.vue', () => ({
  default: defineComponent({
    name: 'CommentsDropdownStub',
    props: ['options'],
    setup(props, { slots }) {
      return () =>
        h('div', { class: 'comments-dropdown-stub' }, [
          h('span', { class: 'options-labels' }, (props.options ?? []).map((option) => option.label).join(',')),
          slots.default?.(),
        ]);
    },
  }),
}));

import CommentHeader from './CommentHeader.vue';

const CREATED_TIME = 1767225600000;

const makeComment = (overrides = {}) => ({
  creatorId: 'alice-id',
  creatorEmail: 'shared@example.com',
  creatorName: 'Alice',
  createdTime: CREATED_TIME,
  resolvedTime: null,
  trackedChange: false,
  parentCommentId: null,
  trackedChangeParentId: null,
  origin: null,
  importedAuthor: null,
  getCommentUser: () => ({ id: 'alice-id', name: 'Alice', email: 'shared@example.com' }),
  ...overrides,
});

const mountHeader = ({ currentUser, comment, config = { readOnly: false }, interactionConfig, extraProps = {} }) => {
  const permissionResolver = vi.fn(({ permission }) => allowedPermissions.includes(permission));
  const superdoc = {
    interactionConfig,
    config: {
      role: 'editor',
      isInternal: false,
      user: currentUser,
      permissionResolver,
    },
  };
  const wrapper = mount(CommentHeader, {
    props: {
      config,
      comment,
      isActive: true,
      ...extraProps,
    },
    global: {
      config: {
        globalProperties: {
          $superdoc: superdoc,
        },
      },
    },
  });
  return { wrapper, permissionResolver, superdoc };
};

function record(value) {
  return JSON.stringify(value, (_key, field) => (typeof field === 'function' ? `[Function ${field.name}]` : field), 2);
}

const describePayloadField = (key, value, inputs) => {
  if (key === 'comment' && toRaw(value) === inputs.comment) return 'the comment prop';
  if (key === 'currentUser' && toRaw(value) === inputs.currentUser) return 'the configured user';
  if (key === 'superdoc' && toRaw(value) === inputs.superdoc) return 'the SuperDoc instance';
  return value;
};

const recordHeader = ({ currentUser, comment }) => {
  const { wrapper, permissionResolver, superdoc } = mountHeader({ currentUser, comment });
  const inputs = { comment, currentUser, superdoc };
  const resolverCalls = [];
  permissionResolver.mock.calls.forEach(([payload], index) => {
    const call = Object.fromEntries(
      Object.entries(payload).map(([key, value]) => [key, describePayloadField(key, value, inputs)]),
    );
    const entry = record({ ...call, returned: permissionResolver.mock.results[index].value });
    if (!resolverCalls.includes(entry)) resolverCalls.push(entry);
  });
  const actions = wrapper.findAll('[data-comment-action]').map((action) => action.attributes('data-comment-action'));
  const overflow = wrapper.find('.options-labels');
  return [
    `role: editor, isInternal: false, allowed permissions: ${allowedPermissions.join(', ')}`,
    `current user: ${record(currentUser)}`,
    `comment: ${record(comment)}`,
    '',
    `resolver calls:\n${resolverCalls.join('\n')}`,
    '',
    `actions: ${actions.join(', ') || '(none)'}`,
    `overflow options: ${overflow.exists() ? overflow.text() : '(none)'}`,
    '',
  ].join('\n');
};

describe('CommentHeader.vue', () => {
  beforeEach(() => {
    commentsStoreStub = {
      pendingComment: null,
    };
    allowedPermissions = [PERMISSIONS.COMMENTS_DELETE_OWN];
  });

  it('does not treat same-email different-id comments as own comments', async () => {
    const recording = recordHeader({
      currentUser: { id: 'bob-id', email: 'shared@example.com', name: 'Bob' },
      comment: makeComment(),
    });

    await expect(recording).toMatchFileSnapshot('./__snapshots__/CommentHeader/same-email-different-id.txt');
  });

  it('allows the anonymous default user to edit comments created in the same session', () => {
    const { wrapper } = mountHeader({
      currentUser: { id: null, email: null, name: 'Default SuperDoc user' },
      comment: makeComment({
        creatorId: null,
        creatorEmail: null,
        creatorName: 'Default SuperDoc user',
        getCommentUser: () => ({ id: null, name: 'Default SuperDoc user', email: null }),
      }),
    });

    expect(wrapper.find('.options-labels').text()).toContain('Edit');
  });

  it('keeps the imported tag for a different actor even when emails match', () => {
    const { wrapper } = mountHeader({
      currentUser: { id: 'bob-id', email: 'shared@example.com', name: 'Bob' },
      comment: makeComment({ origin: 'word' }),
    });

    expect(wrapper.find('.imported-tag').exists()).toBe(true);
  });

  it('does not show resolve for legacy tracked-change thread members', () => {
    allowedPermissions = Object.values(PERMISSIONS);
    const { wrapper } = mountHeader({
      currentUser: { id: 'alice-id', email: 'shared@example.com', name: 'Alice' },
      comment: makeComment({
        trackedChangeParentId: 'tc-1',
        trackedChangeType: 'insert',
      }),
      config: { readOnly: false, allowResolve: true },
    });

    expect(wrapper.find('[data-comment-action="resolve"]').exists()).toBe(false);
  });

  describe('read-only review actions (SD-3164)', () => {
    beforeEach(() => {
      allowedPermissions = Object.values(PERMISSIONS);
    });

    it.each([
      ['ordinary comment', makeComment()],
      ['tracked insertion', makeComment({ trackedChange: true, trackedChangeType: 'trackInsert' })],
      ['tracked deletion', makeComment({ trackedChange: true, trackedChangeType: 'trackDelete' })],
    ])('removes every mutation control for a read-only %s', (_label, comment) => {
      const { wrapper } = mountHeader({
        currentUser: { id: 'alice-id', email: 'shared@example.com', name: 'Alice' },
        comment,
        config: { readOnly: true, allowResolve: true },
      });

      expect(wrapper.find('[data-comment-action="resolve"]').exists()).toBe(false);
      expect(wrapper.find('[data-comment-action="reject"]').exists()).toBe(false);
      expect(wrapper.find('[data-comment-action="overflow"]').exists()).toBe(false);
      expect(wrapper.find('[data-comment-reopen]').exists()).toBe(false);
    });

    it('removes reopen for a resolved read-only comment', () => {
      const { wrapper } = mountHeader({
        currentUser: { id: 'alice-id', email: 'shared@example.com', name: 'Alice' },
        comment: makeComment({ resolvedTime: Date.now() }),
        config: { readOnly: true, allowResolve: true },
        extraProps: { reopenSupported: true },
      });

      expect(wrapper.find('[data-comment-reopen]').exists()).toBe(false);
    });

    it('keeps writable capability failures visible but disabled', () => {
      const { wrapper } = mountHeader({
        currentUser: { id: 'alice-id', email: 'shared@example.com', name: 'Alice' },
        comment: makeComment({ trackedChange: true }),
        config: { readOnly: false, allowResolve: true },
        extraProps: {
          resolveDisabledReason: 'review-surface-read-only',
          rejectDisabledReason: 'review-surface-read-only',
        },
      });

      const resolve = wrapper.find('[data-comment-action="resolve"]');
      const reject = wrapper.find('[data-comment-action="reject"]');
      expect(resolve.exists()).toBe(true);
      expect(reject.exists()).toBe(true);
      expect(resolve.attributes('aria-disabled')).toBe('true');
      expect(reject.attributes('aria-disabled')).toBe('true');
    });

    it('honors allowResolve for ordinary lifecycle actions without hiding unrelated writes', () => {
      const { wrapper } = mountHeader({
        currentUser: { id: 'alice-id', email: 'shared@example.com', name: 'Alice' },
        comment: makeComment(),
        config: { readOnly: false, allowResolve: false },
      });

      expect(wrapper.find('[data-comment-action="resolve"]').exists()).toBe(false);
      expect(wrapper.find('[data-comment-action="overflow"]').exists()).toBe(true);
      expect(wrapper.find('.options-labels').text()).toContain('Edit');
      expect(wrapper.find('.options-labels').text()).toContain('Delete');
    });

    it('does not apply allowResolve to tracked-change decisions', () => {
      const { wrapper } = mountHeader({
        currentUser: { id: 'alice-id', email: 'shared@example.com', name: 'Alice' },
        comment: makeComment({ trackedChange: true }),
        config: { readOnly: false, allowResolve: false },
      });

      expect(wrapper.find('[data-comment-action="resolve"]').exists()).toBe(true);
      expect(wrapper.find('[data-comment-action="reject"]').exists()).toBe(true);
    });

    it('keeps tracked-change decisions visible when comment capability is read-only', () => {
      const { wrapper } = mountHeader({
        currentUser: { id: 'alice-id', email: 'shared@example.com', name: 'Alice' },
        comment: makeComment({ trackedChange: true }),
        config: { readOnly: true, allowResolve: false },
        interactionConfig: {
          comments: { level: 'read', readOnly: true, allowResolve: false },
          trackedChanges: { allowDecisions: true },
        },
      });

      expect(wrapper.find('[data-comment-action="resolve"]').exists()).toBe(true);
      expect(wrapper.find('[data-comment-action="reject"]').exists()).toBe(true);
    });

    it('hides tracked-change decisions without hiding writable comment actions', () => {
      const { wrapper } = mountHeader({
        currentUser: { id: 'alice-id', email: 'shared@example.com', name: 'Alice' },
        comment: makeComment({ trackedChange: true }),
        config: { readOnly: false, allowResolve: true },
        interactionConfig: {
          comments: { level: 'resolve', readOnly: false, allowResolve: true },
          trackedChanges: { allowDecisions: false },
        },
      });

      expect(wrapper.find('[data-comment-action="resolve"]').exists()).toBe(false);
      expect(wrapper.find('[data-comment-action="reject"]').exists()).toBe(false);
    });

    it('removes an already-rendered action surface when config flips to read-only', async () => {
      const config = reactive({ readOnly: false, allowResolve: true });
      const { wrapper } = mountHeader({
        currentUser: { id: 'alice-id', email: 'shared@example.com', name: 'Alice' },
        comment: makeComment(),
        config,
      });
      expect(wrapper.find('[data-comment-action="overflow"]').exists()).toBe(true);

      config.readOnly = true;
      await nextTick();

      expect(wrapper.find('[data-comment-action="resolve"]').exists()).toBe(false);
      expect(wrapper.find('[data-comment-action="overflow"]').exists()).toBe(false);
    });
  });

  describe('tracked-change own vs other permissions (SD-3845)', () => {
    const mikeLegalPermissions = [PERMISSIONS.RESOLVE_OTHER, PERMISSIONS.REJECT_OTHER];

    const otherUserTrackedChange = () =>
      makeComment({
        trackedChange: true,
        trackedChangeType: 'trackInsert',
        creatorId: 'alice-id',
        creatorEmail: 'alice@mikelegal.test',
        creatorName: 'Alice',
        getCommentUser: () => ({ id: 'alice-id', name: 'Alice', email: 'alice@mikelegal.test' }),
      });

    const ownTrackedChange = () =>
      makeComment({
        trackedChange: true,
        trackedChangeType: 'trackInsert',
      });

    it('requests OTHER permissions and shows Accept and Reject for another user tracked change', async () => {
      allowedPermissions = mikeLegalPermissions;
      const recording = recordHeader({
        currentUser: { id: 'bob-id', email: 'bob@mikelegal.test', name: 'Bob' },
        comment: otherUserTrackedChange(),
      });

      await expect(recording).toMatchFileSnapshot('./__snapshots__/CommentHeader/other-tracked-change.txt');
    });

    it('hides Accept and Reject for the current user tracked change when OWN is denied', async () => {
      allowedPermissions = mikeLegalPermissions;
      const recording = recordHeader({
        currentUser: { id: 'alice-id', email: 'shared@example.com', name: 'Alice' },
        comment: ownTrackedChange(),
      });

      await expect(recording).toMatchFileSnapshot('./__snapshots__/CommentHeader/own-tracked-change-denied.txt');
    });

    it('hides Reject for another user tracked change when REJECT_OTHER is denied', async () => {
      allowedPermissions = [PERMISSIONS.RESOLVE_OTHER];
      const recording = recordHeader({
        currentUser: { id: 'bob-id', email: 'bob@mikelegal.test', name: 'Bob' },
        comment: otherUserTrackedChange(),
      });

      await expect(recording).toMatchFileSnapshot(
        './__snapshots__/CommentHeader/other-tracked-change-reject-denied.txt',
      );
    });

    it('classifies an unattributed tracked change as OWN when both sides lack id and email', async () => {
      allowedPermissions = mikeLegalPermissions;
      const recording = recordHeader({
        currentUser: { id: null, email: null, name: 'Alice' },
        comment: makeComment({
          trackedChange: true,
          trackedChangeType: 'trackInsert',
          creatorId: null,
          creatorEmail: null,
          creatorName: null,
          getCommentUser: () => ({ id: null, name: null, email: null }),
        }),
      });

      await expect(recording).toMatchFileSnapshot('./__snapshots__/CommentHeader/unattributed-tracked-change.txt');
    });

    it('classifies a name-only imported tracked change as OWN when names match', async () => {
      allowedPermissions = mikeLegalPermissions;
      const recording = recordHeader({
        currentUser: { id: null, email: null, name: 'Alice Owner' },
        comment: makeComment({
          trackedChange: true,
          trackedChangeType: 'trackInsert',
          creatorId: null,
          creatorEmail: null,
          creatorName: 'Alice Owner',
          origin: 'word',
          importedAuthor: { name: 'Alice Owner' },
          getCommentUser: () => ({ id: null, name: 'Alice Owner', email: null }),
        }),
      });

      await expect(recording).toMatchFileSnapshot(
        './__snapshots__/CommentHeader/name-only-imported-tracked-change.txt',
      );
    });
  });

  describe('when allowResolve is omitted from a writable config', () => {
    beforeEach(() => {
      allowedPermissions = [PERMISSIONS.RESOLVE_OWN, PERMISSIONS.RESOLVE_OTHER];
    });

    it('offers resolve and emits it on click', async () => {
      const { wrapper } = mountHeader({
        currentUser: { id: 'alice-id', email: 'shared@example.com', name: 'Alice' },
        comment: makeComment(),
        config: { readOnly: false },
      });

      const resolve = wrapper.find('[data-comment-action="resolve"]');
      expect(resolve.exists()).toBe(true);
      await resolve.trigger('click');
      expect(wrapper.emitted('resolve')).toHaveLength(1);
    });
  });

  describe('reopen affordance (row 864)', () => {
    beforeEach(() => {
      // Reopen reuses the resolve permission; allow it for these cases.
      allowedPermissions = [PERMISSIONS.RESOLVE_OWN, PERMISSIONS.RESOLVE_OTHER];
    });

    it('exposes a reopen action for a resolved root comment when v2 reopen is supported', () => {
      const { wrapper } = mountHeader({
        currentUser: { id: 'alice-id', email: 'shared@example.com', name: 'Alice' },
        comment: makeComment({ resolvedTime: Date.now() }),
        extraProps: { reopenSupported: true },
      });
      expect(wrapper.find('[data-comment-reopen]').exists()).toBe(true);
    });

    it('emits reopen when the affordance is clicked and not disabled', async () => {
      const { wrapper } = mountHeader({
        currentUser: { id: 'alice-id', email: 'shared@example.com', name: 'Alice' },
        comment: makeComment({ resolvedTime: Date.now() }),
        extraProps: { reopenSupported: true },
      });
      await wrapper.find('[data-comment-reopen]').trigger('click');
      expect(wrapper.emitted('reopen')).toBeTruthy();
    });

    it('does not show reopen for unresolved comments and keeps resolve/delete behavior', () => {
      const { wrapper } = mountHeader({
        currentUser: { id: 'alice-id', email: 'shared@example.com', name: 'Alice' },
        comment: makeComment({ resolvedTime: null }),
        extraProps: { reopenSupported: true },
      });
      expect(wrapper.find('[data-comment-reopen]').exists()).toBe(false);
      // Unresolved root comment still offers resolve.
      expect(wrapper.html()).toContain('overflow-menu');
    });

    it('does not show reopen when reopen is not supported (v1)', () => {
      const { wrapper } = mountHeader({
        currentUser: { id: 'alice-id', email: 'shared@example.com', name: 'Alice' },
        comment: makeComment({ resolvedTime: Date.now() }),
        extraProps: { reopenSupported: false },
      });
      expect(wrapper.find('[data-comment-reopen]').exists()).toBe(false);
    });

    it('does not show reopen for resolved replies', () => {
      const { wrapper } = mountHeader({
        currentUser: { id: 'alice-id', email: 'shared@example.com', name: 'Alice' },
        comment: makeComment({ resolvedTime: Date.now(), parentCommentId: 'root-1' }),
        extraProps: { reopenSupported: true },
      });
      expect(wrapper.find('[data-comment-reopen]').exists()).toBe(false);
    });

    it('does not show reopen for legacy tracked-change thread members', () => {
      const { wrapper } = mountHeader({
        currentUser: { id: 'alice-id', email: 'shared@example.com', name: 'Alice' },
        comment: makeComment({
          resolvedTime: Date.now(),
          trackedChangeParentId: 'tc-1',
          trackedChangeType: 'insert',
        }),
        extraProps: { reopenSupported: true },
      });
      expect(wrapper.find('[data-comment-reopen]').exists()).toBe(false);
    });

    it('renders reopen disabled and does not emit when a disabled reason is set', async () => {
      const { wrapper } = mountHeader({
        currentUser: { id: 'alice-id', email: 'shared@example.com', name: 'Alice' },
        comment: makeComment({ resolvedTime: Date.now() }),
        extraProps: { reopenSupported: true, reopenDisabledReason: 'author-required' },
      });
      const reopen = wrapper.find('[data-comment-reopen]');
      expect(reopen.exists()).toBe(true);
      expect(reopen.classes()).toContain('sd-is-disabled');
      await reopen.trigger('click');
      expect(wrapper.emitted('reopen')).toBeFalsy();
    });
  });
});
