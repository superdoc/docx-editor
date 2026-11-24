import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { createPinia, setActivePinia } from 'pinia';
import { vClickOutside } from '@superdoc/common';
import { flushPromises, mount } from '@vue/test-utils';
import { h, ref } from 'vue';
import CommentDialogSource from './CommentDialog.vue?raw';
import CommentDialog from './CommentDialog.vue';
import CommentsList from './commentsList/commentsList.vue';
import useComment from './use-comment.js';
import { useCommentsStore } from '../../stores/comments-store.js';
import { useSuperdocStore } from '../../stores/superdoc-store.js';
import { makeV2CommentsAdapter, makeV2TrackedChangesAdapter } from '../../test-support/v2-review-adapters.js';
import { getSuperDocUiOwnerId } from '../../core/superdoc-ui-owner.js';

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const COMMENT_DIALOG_SOURCE = CommentDialogSource;
const ONE_BY_ONE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+KD0aVQAAAABJRU5ErkJggg==';

describe('CommentDialog', () => {
  let commentsStore;
  let superdocStore;
  let superdocStub;

  const mountComments = (component, props = {}, stubs = {}, directives = { 'click-outside': {} }) =>
    mount(component, {
      attachTo: document.body,
      props,
      global: {
        config: {
          globalProperties: {
            $superdoc: superdocStub,
          },
        },
        directives,
        stubs: {
          CommentHeader: true,
          CommentInput: true,
          InternalDropdown: true,
          Avatar: true,
          ...stubs,
        },
      },
    });

  const mountDialog = (comment, stubs = {}, directives) => mountComments(CommentDialog, { comment }, stubs, directives);

  const RECORDED_AT = Date.UTC(2026, 10, 19, 12, 0, 0);
  const COMMENT_ADAPTER_METHODS = [
    'setActiveComment',
    'commitPendingComment',
    'reply',
    'edit',
    'resolve',
    'reopen',
    'delete',
  ];
  const TRACKED_CHANGE_ADAPTER_METHODS = ['accept', 'reject'];

  const record = (value: unknown) =>
    JSON.stringify(value, (_key, field: unknown) => (field === undefined ? '<undefined>' : field), 2);

  const isUnset = (value: unknown) =>
    value === null ||
    value === undefined ||
    value === '' ||
    value === false ||
    (Array.isArray(value) && value.length === 0);

  const setFields = (value: object) => Object.fromEntries(Object.entries(value).filter(([, field]) => !isUnset(field)));

  const describeAdapterInput = (input: unknown) =>
    input && typeof input === 'object' && 'getValues' in input
      ? { row: { commentId: input.commentId, trackedChangeCanonicalId: input.trackedChangeCanonicalId } }
      : input;

  const installReviewAdapters = ({ comments = {}, trackedChanges = {}, canWrite = () => true } = {}) => {
    const calls: string[] = [];
    const logged = (name: string, respond = () => ({ ok: true })) =>
      vi.fn(async (input: unknown) => {
        calls.push(`${name} ${JSON.stringify(describeAdapterInput(input) ?? null)}`);
        return respond(input);
      });
    const commentsAdapter = makeV2CommentsAdapter({
      getCapabilityState: (command) => ({
        canWrite: canWrite(command),
        reason: canWrite(command) ? null : 'host-state:saving',
      }),
      mapV2CommentToUseCommentInput: (item) => item,
      ...Object.fromEntries(
        COMMENT_ADAPTER_METHODS.map((method) => [method, logged(`comments.${method}`, comments[method])]),
      ),
    });
    const trackedChangesAdapter = makeV2TrackedChangesAdapter({
      getCapabilityState: () => ({ canDecide: true }),
      ...Object.fromEntries(
        TRACKED_CHANGE_ADAPTER_METHODS.map((method) => [
          method,
          logged(`trackedChanges.${method}`, trackedChanges[method]),
        ]),
      ),
    });
    superdocStub.user = superdocStore.user;
    superdocStub.activeEditor.editorVersion = 2;
    superdocStub.activeEditor.v2Comments = commentsAdapter;
    superdocStub.activeEditor.v2TrackedChanges = trackedChangesAdapter;
    commentsStore.setV2CommentsAdapter(commentsAdapter);
    commentsStore.setV2TrackedChangesAdapter(trackedChangesAdapter);
    return { calls, commentsAdapter, trackedChangesAdapter };
  };

  const commentsUpdateEvents = () =>
    superdocStub.emit.mock.calls
      .filter(([name]) => name === 'comments-update')
      .map(([, event]) => setFields({ ...event, ...(event.comment ? { comment: setFields(event.comment) } : {}) }));

  const storeState = () => ({
    activeComment: commentsStore.activeComment,
    editingCommentId: commentsStore.editingCommentId,
    draft: commentsStore.currentCommentText,
    pendingComment: commentsStore.pendingComment?.commentId ?? null,
    rows: commentsStore.commentsList.map((row) =>
      setFields({
        commentId: row.commentId,
        parentCommentId: row.parentCommentId,
        commentText: row.commentText,
        mentions: row.mentions,
        trackedChange: row.trackedChange,
        trackedChangeCanonicalId: row.trackedChangeCanonicalId,
        trackedChangeThreadParentId: row.trackedChangeThreadParentId,
        trackedChangeSide: row.trackedChangeSide,
        trackedChangeDecision: row.trackedChangeDecision,
        resolvedTime: row.resolvedTime,
        resolvedById: row.resolvedById,
        resolvedByEmail: row.resolvedByEmail,
        resolvedByName: row.resolvedByName,
      }),
    ),
  });

  const renderDialog = (wrapper) => {
    const root = wrapper.find('.comments-dialog');
    if (!root.exists()) return '(not rendered)';
    const states = ['is-active', 'is-resolved'].filter((name) => root.classes().includes(name));
    const lines = [`classes: ${states.join(' ') || '(none)'}`];
    const badge = root.find('.resolved-badge');
    if (badge.exists()) lines.push(`badge: ${badge.text()}`);
    if (root.find('.new-comment-input-wrapper').exists()) lines.push('new comment composer');
    for (const item of root.findAll('.conversation-item')) {
      const id = item.findComponent({ name: 'CommentHeader' }).props('comment').commentId;
      const body = item.find('.reply-expanded').exists()
        ? 'editing'
        : item.find('.tracked-change').exists()
          ? `tracked change: ${item.find('.tracked-change').text()}`
          : `comment: ${item.find('.comment').text()}`;
      lines.push(`${id}: ${body}`);
    }
    for (const alert of root.findAll('[role="alert"]')) lines.push(`alert: ${alert.text()}`);
    const pill = root.find('.reply-pill');
    const composer = root.element.querySelector(':scope > .reply-expanded');
    if (pill.exists()) {
      lines.push(
        pill.attributes('disabled') === undefined
          ? 'reply pill'
          : `reply pill disabled: ${pill.attributes('data-disabled-reason')}`,
      );
    } else if (composer) {
      lines.push(
        `reply composer, Reply ${composer.querySelector('.reply-btn-primary')?.disabled ? 'disabled' : 'enabled'}`,
      );
    }
    return lines.join('\n');
  };

  const startRecording = ({ calls, wrapper }) => {
    const before = ['before:', '', 'store:', record(storeState()), '', 'dialog:', renderDialog(wrapper)];
    const firstCall = calls.length;
    const firstEvent = commentsUpdateEvents().length;
    const firstFocus = superdocStub.focus.mock.calls.length;
    return (action: string, during: string[] = []) => {
      const actionCalls = calls.slice(firstCall);
      return [
        ...before,
        '',
        `action: ${action}`,
        ...(during.length ? ['', ...during] : []),
        '',
        'document calls:',
        ...(actionCalls.length ? actionCalls : ['(none)']),
        '',
        'comments-update events:',
        record(commentsUpdateEvents().slice(firstEvent)),
        '',
        `superdoc.focus calls: ${record(superdocStub.focus.mock.calls.slice(firstFocus))}`,
        '',
        'after:',
        '',
        'store:',
        record(storeState()),
        '',
        'dialog:',
        renderDialog(wrapper),
        '',
      ].join('\n');
    };
  };

  const pinClock = () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(RECORDED_AT);
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  const expectRecording = (recording: string, name: string) =>
    expect(recording).toMatchFileSnapshot(`./__snapshots__/CommentDialog/${name}.txt`);

  type DocumentComment = { commentId: string; fileId: string; commentText: string; parentCommentId?: string };
  type HeldWrite = {
    method: 'reply' | 'edit' | 'commitPendingComment';
    input: { commentId?: string; parentCommentId?: string; text: string };
    settle: (outcome: unknown) => void;
  };

  const makeHeldCommentDocument = (initial: DocumentComment[]) => {
    let items = initial.map((item) => ({ ...item }));
    let created = 0;
    const held: HeldWrite[] = [];
    const rootOf = (commentId?: string) =>
      items.find((item) => item.commentId === commentId)?.parentCommentId ?? commentId;
    const targetedThread = (commentId?: string) => {
      const root = rootOf(commentId);
      return {
        items: items.filter((item) => item.commentId === root || item.parentCommentId === root),
        complete: false,
      };
    };
    const apply = {
      reply: ({ parentCommentId, text }: HeldWrite['input']) => {
        const commentId = `reply-${++created}`;
        items = [...items, { commentId, parentCommentId, fileId: 'doc-1', commentText: text }];
        return { ok: true, createdCommentId: commentId, ...targetedThread(commentId) };
      },
      edit: ({ commentId, text }: HeldWrite['input']) => {
        items = items.map((item) => (item.commentId === commentId ? { ...item, commentText: text } : item));
        return { ok: true, ...targetedThread(commentId) };
      },
      commitPendingComment: ({ text }: HeldWrite['input']) => {
        const commentId = `comment-${++created}`;
        items = [...items, { commentId, fileId: 'doc-1', commentText: text }];
        return { ok: true, createdCommentId: commentId, ...targetedThread(commentId) };
      },
    };
    const hold = (method: HeldWrite['method']) => (input: HeldWrite['input']) =>
      new Promise((settle) => {
        held.push({ method, input, settle });
      });
    const take = (index: number) => {
      const write = held[index];
      if (!write) throw new Error(`No document write #${index} is waiting`);
      return write;
    };
    return {
      comments: { reply: hold('reply'), edit: hold('edit'), commitPendingComment: hold('commitPendingComment') },
      commit: (index = 0) => {
        const write = take(index);
        write.settle(apply[write.method](write.input));
      },
      refuse: (index: number, refusal: { code: string; detail?: string }) =>
        take(index).settle({ ok: false, ...refusal }),
      settleAll: () => held.forEach((write) => write.settle({ ok: true })),
    };
  };

  const timelineState = () => {
    const { rows, ...state } = storeState();
    return { ...state, draftMentions: commentsStore.currentCommentMentions, rows };
  };

  const renderComposerDialog = (wrapper) => {
    const buttons = wrapper
      .findAll('button.reply-btn-primary')
      .map((button) => `${button.text()} ${button.attributes('disabled') === undefined ? 'enabled' : 'disabled'}`);
    return [renderDialog(wrapper), `buttons: ${buttons.join(', ') || '(none)'}`].join('\n');
  };

  const startTimeline = ({ calls, dialogs }: { calls: string[]; dialogs: () => Record<string, unknown> }) => {
    const lines: string[] = [];
    let seenCalls = calls.length;
    let seenEvents = commentsUpdateEvents().length;
    const step = (label: string) => {
      const stepCalls = calls.slice(seenCalls);
      const events = commentsUpdateEvents().slice(seenEvents);
      seenCalls = calls.length;
      seenEvents += events.length;
      lines.push(`step: ${label}`, '', 'document calls:', ...(stepCalls.length ? stepCalls : ['(none)']), '');
      if (events.length) lines.push('comments-update events:', record(events), '');
      lines.push('store:', record(timelineState()), '');
      for (const [name, wrapper] of Object.entries(dialogs())) {
        lines.push(`${name} dialog:`, renderComposerDialog(wrapper), '');
      }
      lines.push('---', '');
    };
    return { step, recording: () => lines.join('\n') };
  };

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

  it.each(
    ['edit', 'reply'].flatMap((kind) => ['success', 'rejection', 'new draft'].map((result) => ({ kind, result }))),
  )('records $kind ownership after layout relocates its dialog ($result)', async ({ kind, result }) => {
    pinClock();
    const rootInput = { commentId: 'layout-root', fileId: 'doc-1', commentText: 'Original' };
    const document = makeHeldCommentDocument([rootInput]);
    const { calls } = installReviewAdapters({ comments: document.comments });
    const root = useComment(rootInput);
    commentsStore.commentsList = [root];
    commentsStore.activeComment = root.commentId;
    const dialogs: Record<string, ReturnType<typeof mountDialog>> = { original: mountDialog(root) };
    const timeline = startTimeline({ calls, dialogs: () => dialogs });
    const submitLabel = kind === 'edit' ? 'Update' : 'Reply';
    try {
      if (kind === 'edit') {
        dialogs.original.findComponent({ name: 'CommentHeader' }).vm.$emit('overflow-select', 'edit');
        await flushPromises();
      } else await dialogs.original.find('.reply-pill').trigger('click');
      commentsStore.currentCommentText = 'Submitted during layout switch';
      await flushPromises();
      await dialogs.original.find('button.reply-btn-primary').trigger('click');
      timeline.step(`open the ${kind} composer, type "Submitted during layout switch", click ${submitLabel}`);
      dialogs.original.unmount();
      delete dialogs.original;
      dialogs.relocated = mountDialog(root);
      await flushPromises();
      timeline.step('layout moves the thread into a new dialog while the document holds the write');
      if (result === 'new draft') {
        commentsStore.currentCommentText = 'Newer unsaved draft';
        await flushPromises();
        timeline.step('type "Newer unsaved draft"');
      }
      if (result === 'rejection') document.refuse(0, { code: 'INTERNAL_ERROR' });
      else document.commit(0);
      await flushPromises();
      timeline.step(result === 'rejection' ? 'the document refuses the write' : 'the document commits the write');
      if (result === 'rejection') {
        await dialogs.relocated.find('button.reply-btn-primary').trigger('click');
        document.commit(1);
        await flushPromises();
        timeline.step(`click ${submitLabel} again; the document commits it`);
      }
      await expectRecording(timeline.recording(), `relocated-${kind}-${result.replace(' ', '-')}`);
    } finally {
      document.settleAll();
      Object.values(dialogs).forEach((wrapper) => wrapper.unmount());
    }
  });

  it.each(
    [
      { operation: 'reply', identity: 'thread', relocate: false },
      { operation: 'reply', identity: 'thread', relocate: true },
      { operation: 'reply', identity: 'file', relocate: true },
      { operation: 'edit', identity: 'thread', relocate: true },
      { operation: 'edit', identity: 'file', relocate: true },
    ].flatMap((scenario) => [true, false].map((ok) => ({ ...scenario, ok }))),
  )(
    'SD-6028 isolates a $operation recipient $identity after relocation=$relocate success=$ok',
    async ({ operation, identity, relocate, ok }) => {
      const firstInput = { commentId: 'recipient-x', fileId: 'doc-1', commentText: 'Thread X' };
      const secondInput = {
        commentId: identity === 'thread' ? 'recipient-y' : firstInput.commentId,
        fileId: identity === 'file' ? 'doc-2' : firstInput.fileId,
        commentText: 'Thread Y',
      };
      const document = makeHeldCommentDocument(identity === 'thread' ? [firstInput, secondInput] : [firstInput]);
      const { calls } = installReviewAdapters({ comments: document.comments });
      const first = useComment(firstInput);
      const second = useComment(secondInput);
      commentsStore.commentsList = [first, second];
      commentsStore.activeComment = first.commentId;
      const layout = ref(relocate ? 'sidebar' : 'inline');
      const active = ref(first);
      const Parent = {
        setup: () => () =>
          h('div', [
            layout.value === 'sidebar'
              ? h(CommentDialog, { key: 'sidebar', comment: first, isFloatingInstanceActive: true })
              : null,
            layout.value === 'inline' ? h(CommentDialog, { comment: active.value }) : null,
          ]),
      };
      const wrapper = mountComments(Parent);
      try {
        const original = wrapper.findComponent(CommentDialog);
        if (operation === 'reply') await original.find('.reply-pill').trigger('click');
        else {
          original.findComponent({ name: 'CommentHeader' }).vm.$emit('overflow-select', 'edit');
          await flushPromises();
        }
        commentsStore.currentCommentText = 'Pending reply from X';
        await flushPromises();
        await original.find('button.reply-btn-primary').trigger('click');
        expect(calls.filter((call) => !call.startsWith('comments.setActiveComment '))).toEqual([
          operation === 'reply'
            ? 'comments.reply {"parentCommentId":"recipient-x","text":"Pending reply from X"}'
            : 'comments.edit {"commentId":"recipient-x","text":"Pending reply from X"}',
        ]);
        if (relocate) {
          layout.value = 'inline';
          await flushPromises();
          expect(wrapper.findComponent(CommentDialog).element).not.toBe(original.element);
        }
        const receivingElement = wrapper.findComponent(CommentDialog).element;
        commentsStore.activeComment = second.commentId;
        active.value = second;
        await flushPromises();
        const receiver = wrapper.findComponent(CommentDialog);
        expect(receiver.element).toBe(receivingElement);
        expect(receiver.props('comment').commentText).toBe('Thread Y');
        const read = () => ({
          draft: commentsStore.currentCommentText,
          mentions: [...commentsStore.currentCommentMentions],
          editingCommentId: commentsStore.editingCommentId,
          expanded: receiver.find('.reply-expanded').exists(),
          alert: receiver.find('[role="alert"]').exists(),
          buttons: receiver.findAll('button.reply-btn-primary').map((button) => button.attributes('disabled')),
        });
        const before = read();
        if (ok) document.commit(0);
        else document.refuse(0, { code: 'INTERNAL_ERROR' });
        await flushPromises();
        expect(read()).toEqual(before);
        expect(commentsStore.currentCommentText).toBe('Pending reply from X');
      } finally {
        document.settleAll();
        wrapper.unmount();
      }
    },
  );

  it.each(['sd-comments-layout-control', 'sd-toolbar-overflow-trigger', 'option'])(
    'keeps the active thread for its own layout control (%s), but not another editor',
    (kind) => {
      const comment = useComment({ commentId: 'layout-thread', fileId: 'doc-1', commentText: 'Review' });
      commentsStore.commentsList = [comment];
      commentsStore.activeComment = comment.commentId;
      const wrapper = mountDialog(comment, {}, { 'click-outside': vClickOutside });
      const toolbar = document.createElement('div');
      const owner = getSuperDocUiOwnerId(superdocStub);
      if (!owner) throw new Error('Missing toolbar owner');
      toolbar.setAttribute('data-superdoc-ui-owner', owner);
      const control = document.createElement('button');
      if (kind === 'option') control.setAttribute('data-sd-comments-layout-option', '');
      else control.className = kind;
      toolbar.append(control);
      document.body.append(toolbar);
      const originalElementFromPoint = document.elementFromPoint;
      document.elementFromPoint = () => control;
      try {
        control.click();
        expect(commentsStore.activeComment).toBe(comment.commentId);
        toolbar.setAttribute('data-superdoc-ui-owner', 'different-editor');
        control.click();
        expect(commentsStore.activeComment).toBeNull();
      } finally {
        wrapper.unmount();
        toolbar.remove();
        if (originalElementFromPoint) document.elementFromPoint = originalElementFromPoint;
        else delete document.elementFromPoint;
      }
    },
  );

  it.each(['comment-tool', 'other-tool', 'outside'])(
    'keeps cancellation scoped to the activating comment tool or an actual %s click',
    async (surface) => {
      let finishCapture;
      const capture = new Promise((resolve) => {
        finishCapture = resolve;
      });
      const target = { kind: 'text', segments: [{ blockId: 'paragraph', start: 6, end: 12 }] };
      const { calls, commentsAdapter: adapter } = installReviewAdapters();
      adapter.captureCurrentSelection = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, target })
        .mockImplementationOnce(() => capture);
      superdocStub.activeEditor.options = { documentId: 'doc-1' };
      superdocStub.config.documentMode = 'editing';
      expect(await commentsStore.showAddComment(superdocStub)).toEqual({ ok: true });
      const firstId = commentsStore.pendingComment.commentId;
      commentsStore.currentCommentText = '<p>First draft</p>';
      const wrapper = mountDialog(commentsStore.pendingComment, {}, { 'click-outside': vClickOutside });
      const tool = document.createElement('div');
      tool.className = 'superdoc__tools';
      const action = document.createElement('div');
      action.dataset.id = 'is-tool';
      const icon = document.createElement('span');
      action.append(icon);
      const otherAction = document.createElement('div');
      otherAction.dataset.id = 'other-tool';
      tool.append(action, otherAction);
      document.body.append(tool);
      const outside = document.createElement('button');
      document.body.append(outside);
      const clicked = surface === 'comment-tool' ? icon : surface === 'other-tool' ? otherAction : outside;
      const originalElementFromPoint = document.elementFromPoint;
      document.elementFromPoint = () => clicked;
      try {
        const next = commentsStore.showAddComment(superdocStub);
        expect(adapter.captureCurrentSelection).toHaveBeenCalledTimes(2);
        clicked.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 800, clientY: 10 }));
        finishCapture({ ok: true, target });
        expect(await next).toEqual(
          surface === 'comment-tool' ? { ok: true } : { ok: false, reason: 'pending-comment-superseded' },
        );
        expect(calls).toEqual([]);
        if (surface === 'comment-tool') {
          expect(commentsStore.pendingComment.commentId).not.toBe(firstId);
          expect(commentsStore.activeComment).toBe(commentsStore.pendingComment.commentId);
        } else {
          expect(commentsStore.currentCommentText).toBe('');
          expect(commentsStore.pendingComment).toBeNull();
          expect(commentsStore.activeComment).toBeNull();
        }
      } finally {
        wrapper.unmount();
        tool.remove();
        outside.remove();
        if (originalElementFromPoint) document.elementFromPoint = originalElementFromPoint;
        else delete document.elementFromPoint;
      }
    },
  );

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
    const snapshot = (wrapper) => ({ store: storeState(), dialog: renderDialog(wrapper) });

    it('ignores stale tracked-change resolve/reject events', async () => {
      commentsStore.init({ readOnly: true });
      const { calls } = installReviewAdapters();
      const comment = useComment({
        commentId: 'tc-read-only',
        fileId: 'doc-1',
        commentText: '',
        trackedChange: true,
      });
      commentsStore.commentsList = [comment];

      const wrapper = mountDialog(comment);
      try {
        const before = snapshot(wrapper);
        const header = wrapper.findComponent({ name: 'CommentHeader' });
        header.vm.$emit('resolve');
        header.vm.$emit('reject');
        await flushPromises();

        expect(calls).toEqual([]);
        expect(commentsUpdateEvents()).toEqual([]);
        expect(superdocStub.focus).not.toHaveBeenCalled();
        expect(snapshot(wrapper)).toEqual(before);
      } finally {
        wrapper.unmount();
      }
    });

    it.each([
      ['resolve', 'accept'],
      ['reject', 'reject'],
    ])('records a tracked-change %s while comments are read-only', async (eventName, decision) => {
      pinClock();
      commentsStore.init({ readOnly: true, allowResolve: false });
      superdocStub.interactionConfig = {
        comments: { level: 'read', readOnly: true, allowResolve: false },
        trackedChanges: { allowDecisions: true },
      };
      const { calls } = installReviewAdapters();
      const comment = useComment({
        commentId: 'tc-comments-read-only',
        fileId: 'doc-1',
        commentText: '',
        trackedChange: true,
      });
      commentsStore.commentsList = [comment];

      const wrapper = mountDialog(comment);
      try {
        const finish = startRecording({ calls, wrapper });
        wrapper.findComponent({ name: 'CommentHeader' }).vm.$emit(eventName);
        await flushPromises();
        await expectRecording(
          finish(`header emits ${eventName}`),
          `${decision}-tracked-change-with-read-only-comments`,
        );
      } finally {
        wrapper.unmount();
      }
    });

    it.each([
      ['resolve', 'accept'],
      ['reject', 'reject'],
    ])('records a v1 tracked-change %s that waits for the Document API decision', async (eventName, decision) => {
      pinClock();
      commentsStore.init({ readOnly: true, allowResolve: false });
      superdocStub.commentsStore = commentsStore;
      superdocStub.interactionConfig = {
        comments: { level: 'read', readOnly: true, allowResolve: false },
        trackedChanges: { allowDecisions: true },
      };
      const calls: string[] = [];
      let settle: (receipt: { success: boolean }) => void = () => {
        throw new Error('The Document API decision was not requested');
      };
      superdocStub.activeEditor.doc = {
        trackChanges: {
          decide: vi.fn((input) => {
            calls.push(`doc.trackChanges.decide ${JSON.stringify(input)}`);
            return new Promise((resolve) => {
              settle = resolve;
            });
          }),
        },
      };
      const comment = useComment({
        commentId: 'tc-v1-inserted-words',
        fileId: 'doc-1',
        commentText: '',
        trackedChange: true,
        trackedChangeType: 'trackInsert',
        trackedChangeDisplayType: 'insert',
        trackedChangeText: 'inserted words',
      });
      commentsStore.commentsList = [comment];

      const wrapper = mountDialog(comment);
      try {
        const finish = startRecording({ calls, wrapper });
        wrapper.findComponent({ name: 'CommentHeader' }).vm.$emit(eventName);
        await flushPromises();
        const whilePending = ['store while the decision is pending:', record(storeState())];
        settle({ success: true });
        await flushPromises();
        await expectRecording(
          finish(`header emits ${eventName}; the decision then succeeds`, whilePending),
          `v1-${decision}-tracked-change`,
        );
      } finally {
        wrapper.unmount();
      }
    });

    it('ignores stale ordinary resolve/reopen/delete/edit events', async () => {
      commentsStore.init({ readOnly: true, allowResolve: true });
      const { calls } = installReviewAdapters();
      const comment = useComment({
        commentId: 'comment-read-only',
        fileId: 'doc-1',
        commentText: 'Keep this comment',
      });
      commentsStore.commentsList = [comment];

      const wrapper = mountDialog(comment);
      try {
        const before = snapshot(wrapper);
        const header = wrapper.findComponent({ name: 'CommentHeader' });
        header.vm.$emit('resolve');
        header.vm.$emit('reopen');
        header.vm.$emit('overflow-select', 'delete');
        header.vm.$emit('overflow-select', 'edit');
        await flushPromises();

        expect(calls).toEqual([]);
        expect(commentsUpdateEvents()).toEqual([]);
        expect(snapshot(wrapper)).toEqual(before);
      } finally {
        wrapper.unmount();
      }
    });

    it.each([
      [true, false, 1],
      [false, true, 2],
    ])(
      'with readOnly %s, renders the reply section: %s, with %i separators in a two-comment thread',
      async (readOnly, rendered, separatorCount) => {
        commentsStore.init({ readOnly, allowResolve: true });
        const comment = useComment({
          commentId: `comment-input-${readOnly}`,
          fileId: 'doc-1',
          commentText: 'Parent comment',
        });
        const reply = useComment({
          commentId: `comment-input-reply-${readOnly}`,
          fileId: 'doc-1',
          parentCommentId: comment.commentId,
          commentText: 'Reply',
        });
        commentsStore.commentsList = [comment, reply];
        commentsStore.activeComment = comment.commentId;

        const wrapper = mountDialog(comment);
        try {
          await flushPromises();
          expect(wrapper.find('.reply-pill').exists()).toBe(rendered);
          expect(wrapper.findAll('.comment-separator')).toHaveLength(separatorCount);
        } finally {
          wrapper.unmount();
        }
      },
    );

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

    it('prefills the edit composer with the comment text and a copy of its mentions', async () => {
      commentsStore.init({ readOnly: false, allowResolve: true });
      const mentions = [{ name: 'Other', email: 'other@example.test' }];
      const comment = useComment({
        commentId: 'comment-edit-prefill',
        fileId: 'doc-1',
        commentText: '<p>Needs a citation</p>',
        mentions,
      });
      commentsStore.commentsList = [comment];
      commentsStore.activeComment = comment.commentId;

      const wrapper = mountDialog(comment);
      try {
        wrapper.findComponent({ name: 'CommentHeader' }).vm.$emit('overflow-select', 'edit');
        await flushPromises();

        expect(commentsStore.editingCommentId).toBe(comment.commentId);
        expect(commentsStore.currentCommentText).toBe('<p>Needs a citation</p>');
        expect(commentsStore.currentCommentMentions).toEqual(mentions);
        expect(commentsStore.currentCommentMentions).not.toBe(comment.mentions);
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
      const { calls } = installReviewAdapters();
      const comment = useComment({ commentId: 'comment-no-resolve', fileId: 'doc-1', commentText: 'Open' });
      commentsStore.commentsList = [comment];

      const wrapper = mountDialog(comment);
      try {
        const before = snapshot(wrapper);
        wrapper.findComponent({ name: 'CommentHeader' }).vm.$emit('resolve');
        await flushPromises();
        expect(calls).toEqual([]);
        expect(commentsUpdateEvents()).toEqual([]);
        expect(snapshot(wrapper)).toEqual(before);
      } finally {
        wrapper.unmount();
      }
    });
  });

  describe('when allowResolve is omitted from the comments config', () => {
    const prepare = (overrides = {}) => {
      commentsStore.init({ readOnly: false });
      delete commentsStore.getConfig.allowResolve;
      const adapters = installReviewAdapters({
        comments: {
          resolve: ({ commentId }) => ({ ok: true, threadLifecycle: { commentId, status: 'resolved' } }),
          reopen: ({ commentId }) => ({ ok: true, threadLifecycle: { commentId, status: 'open' } }),
        },
      });
      const comment = useComment({
        commentId: 'comment-allow-resolve-omitted',
        fileId: 'doc-1',
        commentText: 'Open',
        ...overrides,
      });
      const reply = useComment({
        commentId: 'reply-allow-resolve-omitted',
        parentCommentId: comment.commentId,
        fileId: 'doc-1',
        commentText: 'Reply in the same thread',
        ...overrides,
      });
      commentsStore.commentsList = [comment, reply];
      commentsStore.activeComment = comment.commentId;
      return { comment, ...adapters };
    };

    it.each([
      { name: 'resolve-open-thread', event: 'resolve', overrides: {} },
      { name: 'reopen-resolved-thread', event: 'reopen', overrides: { resolvedTime: RECORDED_AT - 60_000 } },
    ])('records $event of the thread', async ({ name, event, overrides }) => {
      pinClock();
      const { comment, calls } = prepare(overrides);
      expect(commentsStore.getConfig).not.toHaveProperty('allowResolve');

      const wrapper = mountDialog(comment);
      try {
        const finish = startRecording({ calls, wrapper });
        wrapper.findComponent({ name: 'CommentHeader' }).vm.$emit(event);
        await flushPromises();
        await expectRecording(finish(`header emits ${event}`), name);
      } finally {
        wrapper.unmount();
      }
    });
  });

  describe('v2 edit completion ownership', () => {
    const editCall = (text: string) => `comments.edit {"commentId":"edit-root","text":"${text}"}`;

    const prepare = () => {
      const rootInput = { commentId: 'edit-root', fileId: 'doc-1', commentText: 'Root' };
      const replyInput = {
        commentId: 'edit-reply',
        fileId: 'doc-1',
        parentCommentId: 'edit-root',
        commentText: 'Reply',
      };
      const document = makeHeldCommentDocument([rootInput, replyInput]);
      const { calls } = installReviewAdapters({ comments: document.comments });
      const writes = () => calls.filter((call) => !call.startsWith('comments.setActiveComment '));
      const root = useComment(rootInput);
      const reply = useComment(replyInput);
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
      return { root, reply, wrapper, start, document, calls, writes };
    };

    it.each(['reply', 'same comment reopened', 'another dialog'])(
      'keeps a newer %s edit when an old real outcome returns',
      async (next) => {
        const { root, reply, wrapper, start, document, writes } = prepare();
        let other;
        try {
          await start(root);
          commentsStore.currentCommentText = 'Submitted root';
          await wrapper.find('button.reply-btn-primary').trigger('click');
          expect(writes()).toEqual([editCall('Submitted root')]);
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
          document.commit(0);
          await flushPromises();
          expect(commentsStore.editingCommentId).toBe(next === 'reply' ? reply.commentId : root.commentId);
          expect(commentsStore.currentCommentText).toBe(nextDraft);
          expect((other ?? wrapper).find('.reply-expanded').exists()).toBe(true);
          expect(commentsStore.getComment(root.commentId).commentText).toBe('Submitted root');
        } finally {
          document.settleAll();
          other?.unmount();
          wrapper.unmount();
        }
      },
    );

    it.each(['editor replaced', 'document replaced', 'adapter replaced', 'dialog disposed'])(
      'keeps current composer state after the submitting %s',
      async (retirement) => {
        const { root, wrapper, start, document, writes } = prepare();
        try {
          await start(root);
          commentsStore.currentCommentText = 'Identical draft';
          await wrapper.find('button.reply-btn-primary').trigger('click');
          expect(writes()).toEqual([editCall('Identical draft')]);
          if (retirement === 'editor replaced') superdocStub.activeEditor = { ...superdocStub.activeEditor };
          else if (retirement === 'document replaced') superdocStub.activeEditor.doc = {};
          else if (retirement === 'adapter replaced')
            superdocStub.activeEditor.v2Comments = { ...superdocStub.activeEditor.v2Comments };
          else wrapper.unmount();
          document.commit(0);
          await flushPromises();
          expect(commentsStore.editingCommentId).toBe(root.commentId);
          expect(commentsStore.currentCommentText).toBe('Identical draft');
        } finally {
          document.settleAll();
          if (retirement !== 'dialog disposed') wrapper.unmount();
        }
      },
    );

    it.each(['same thread', 'different thread', 'different file'])(
      'completes a reconciled edit only for the %s',
      async (replacement) => {
        const { root, wrapper, start, document } = prepare();
        try {
          await start(root);
          commentsStore.currentCommentText = 'Saved text';
          await wrapper.find('button.reply-btn-primary').trigger('click');
          const refreshed = useComment({
            commentId: replacement === 'different thread' ? 'another-root' : root.commentId,
            fileId: replacement === 'different file' ? 'doc-2' : root.fileId,
            commentText: 'Saved text',
          });
          expect(refreshed).not.toBe(root);
          await wrapper.setProps({ comment: refreshed });
          document.commit(0);
          await flushPromises();
          expect(commentsStore.editingCommentId).toBe(replacement === 'same thread' ? null : root.commentId);
          expect(commentsStore.currentCommentText).toBe(replacement === 'same thread' ? '' : 'Saved text');
        } finally {
          document.settleAll();
          wrapper.unmount();
        }
      },
    );

    it('records a later submission of the same edit outliving an earlier one', async () => {
      pinClock();
      const { root, wrapper, start, document, calls } = prepare();
      const timeline = startTimeline({ calls, dialogs: () => ({ thread: wrapper }) });
      try {
        await start(root);
        commentsStore.currentCommentText = 'Same submitted text';
        await flushPromises();
        timeline.step('choose Edit on the root comment and type "Same submitted text"');
        await wrapper.find('button.reply-btn-primary').trigger('click');
        await wrapper.find('button.reply-btn-primary').trigger('click');
        timeline.step('click Update twice');
        document.commit(0);
        await flushPromises();
        timeline.step('the document commits the first write');
        document.commit(1);
        await flushPromises();
        timeline.step('the document commits the second write');
        await expectRecording(timeline.recording(), 'edit-submitted-twice');
      } finally {
        document.settleAll();
        wrapper.unmount();
      }
    });

    it.each(['rejected', 'new draft', 'successful'])(
      'records the edit composer after a %s completion',
      async (result) => {
        pinClock();
        const { root, wrapper, start, document, calls } = prepare();
        const timeline = startTimeline({ calls, dialogs: () => ({ thread: wrapper }) });
        try {
          await start(root);
          commentsStore.currentCommentText = 'Submitted text';
          await wrapper.find('button.reply-btn-primary').trigger('click');
          timeline.step('choose Edit on the root comment, type "Submitted text", click Update');
          if (result === 'new draft') {
            commentsStore.currentCommentText = 'New draft';
            await flushPromises();
            timeline.step('type "New draft"');
          }
          if (result === 'rejected') document.refuse(0, { code: 'INTERNAL_ERROR' });
          else document.commit(0);
          await flushPromises();
          timeline.step(result === 'rejected' ? 'the document refuses the edit' : 'the document commits the edit');
          await expectRecording(timeline.recording(), `edit-completes-${result.replace(' ', '-')}`);
        } finally {
          document.settleAll();
          wrapper.unmount();
        }
      },
    );
  });

  const prepareTrackedChangeDecision = ({ commentId, trackedChanges = {} }) => {
    const adapters = installReviewAdapters({ trackedChanges });
    const comment = useComment({
      commentId,
      fileId: 'doc-1',
      commentText: '',
      trackedChange: true,
      trackedChangeType: 'trackInsert',
      trackedChangeDisplayType: 'insert',
      trackedChangeText: 'inserted words',
    });
    commentsStore.commentsList = [comment];
    commentsStore.activeComment = comment.commentId;
    return { comment, ...adapters };
  };

  it.each([
    ['resolve', 'accept'],
    ['reject', 'reject'],
  ])('records a committed v2 tracked-change %s', async (eventName, decision) => {
    pinClock();
    const { comment, calls } = prepareTrackedChangeDecision({ commentId: 'tc-inserted-words' });

    const wrapper = mountDialog(comment);
    try {
      const finish = startRecording({ calls, wrapper });
      wrapper.findComponent({ name: 'CommentHeader' }).vm.$emit(eventName);
      await flushPromises();
      await expectRecording(finish(`header emits ${eventName}`), `${decision}-tracked-change`);
    } finally {
      wrapper.unmount();
    }
  });

  describe.each([
    ['resolve', 'onTrackedChangeBubbleAccept'],
    ['reject', 'onTrackedChangeBubbleReject'],
  ])('v2 tracked-change %s lifecycle', (eventName, callbackName) => {
    it.each([
      'row removed',
      'app removed',
      'app replaced',
      'editor closed',
      'editor replaced',
      'owner changed before receipt',
    ])('restores focus only for the original live owner: %s', async (transition) => {
      let transitionOwner = () => {};
      const decide = () => {
        if (transition === 'owner changed before receipt') transitionOwner();
        return { ok: true };
      };
      const { comment, calls } = prepareTrackedChangeDecision({
        commentId: `tc-lifecycle-${eventName}`,
        trackedChanges: { accept: decide, reject: decide },
      });
      commentsStore.activeComment = null;
      const originalEditor = superdocStub.activeEditor;
      const replacementApp = { ...superdocStub, focus: vi.fn() };
      const wrapper = mountDialog(comment);
      const globalProperties = wrapper.vm.$.appContext.config.globalProperties;
      transitionOwner = () => {
        if (transition === 'row removed') wrapper.unmount();
        if (transition === 'app removed') delete globalProperties.$superdoc;
        if (transition === 'app replaced') globalProperties.$superdoc = replacementApp;
        if (transition === 'editor closed') superdocStub.activeEditor = null;
        if (transition === 'editor replaced' || transition === 'owner changed before receipt') {
          superdocStub.activeEditor = { ...originalEditor };
        }
      };
      const customHandler = vi.fn(() => {
        if (transition !== 'owner changed before receipt') transitionOwner();
      });
      superdocStub.config[callbackName] = customHandler;
      try {
        wrapper.findComponent({ name: 'CommentHeader' }).vm.$emit(eventName);
        await flushPromises();
        const clearedActiveComment = calls.filter((call) => call.startsWith('comments.setActiveComment '));
        if (transition === 'row removed') {
          expect(superdocStub.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
          expect(clearedActiveComment).toEqual(['comments.setActiveComment null']);
        } else {
          expect(superdocStub.focus).not.toHaveBeenCalled();
          expect(clearedActiveComment).toEqual([]);
        }
        expect(replacementApp.focus).not.toHaveBeenCalled();
        if (transition === 'owner changed before receipt') expect(customHandler).not.toHaveBeenCalled();
        else expect(customHandler).toHaveBeenCalledExactlyOnceWith(comment, originalEditor);
      } finally {
        globalProperties.$superdoc = superdocStub;
        if (transition !== 'row removed') wrapper.unmount();
      }
    });
  });

  it('keeps focus unchanged when the v2 tracked-change decision is rejected', async () => {
    const { comment } = prepareTrackedChangeDecision({
      commentId: 'tc-rejected',
      trackedChanges: { accept: () => ({ ok: false }) },
    });

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
    const { comment } = prepareTrackedChangeDecision({
      commentId: 'tc-stale-catalog',
      trackedChanges: { accept: () => ({ ok: false, reason: 'stale-catalog' }) },
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
    const ownerInput = () => ({
      commentId: 'comment-owner',
      creatorId: superdocStore.user.id,
      creatorEmail: superdocStore.user.email,
      fileId: 'doc-1',
      commentText: 'Original owner comment',
    });

    const engine = {
      reply: ({ parentCommentId, text }) => ({
        ok: true,
        createdCommentId: 'owner-reply',
        items: [
          ownerInput(),
          {
            commentId: 'owner-reply',
            parentCommentId,
            creatorId: superdocStore.user.id,
            creatorEmail: superdocStore.user.email,
            fileId: 'doc-1',
            commentText: text,
          },
        ],
      }),
      edit: ({ commentId, text }) => ({ ok: true, items: [{ ...ownerInput(), commentId, commentText: text }] }),
      delete: ({ commentId }) => ({ ok: true, removedCommentIds: [commentId] }),
    };

    const prepare = (documentMode, { canWrite = true, readOnly = false, comments = engine } = {}) => {
      commentsStore.init({ readOnly, allowResolve: false });
      commentsStore.setViewingVisibility({ documentMode, commentsVisible: true, trackChangesVisible: true });
      superdocStub.interactionConfig = {
        comments: { level: readOnly ? 'read' : 'write', readOnly, allowResolve: false },
        trackedChanges: { allowDecisions: false },
      };
      const adapters = installReviewAdapters({
        comments,
        canWrite: typeof canWrite === 'function' ? canWrite : () => canWrite,
      });
      adapters.commentsAdapter.focusComment = vi.fn().mockResolvedValue({ ok: true });
      const comment = useComment(ownerInput());
      commentsStore.commentsList = [comment];
      commentsStore.activeComment = comment.commentId;
      return { comment, ...adapters };
    };

    const mutationCalls = (calls: string[]) => calls.filter((call) => !call.startsWith('comments.setActiveComment '));

    const selectOverflow = async (wrapper, label, row = 0) => {
      await wrapper.findAll('[data-comment-action="overflow"] .comments-dropdown__trigger')[row].trigger('click');
      const option = [...document.querySelectorAll('.comments-dropdown__option')].find(
        (element) => element.textContent.trim() === label,
      );
      expect(option).toBeDefined();
      option.click();
      await flushPromises();
    };

    it.each(['editing', 'viewing'])('records one reply to the existing thread in %s mode', async (mode) => {
      pinClock();
      const { comment, calls } = prepare(mode);
      const wrapper = mountDialog(comment, { CommentHeader: false });
      try {
        expect(wrapper.find('[data-comment-action="resolve"]').exists()).toBe(false);
        const finish = startRecording({ calls, wrapper });
        await wrapper.find('.reply-pill').trigger('click');
        commentsStore.currentCommentText = '<p>Owner reply</p>';
        await flushPromises();
        await wrapper.find('button.reply-btn-primary').trigger('click');
        await flushPromises();
        await expectRecording(
          finish('open the reply composer, type "<p>Owner reply</p>", click Reply'),
          `reply-to-thread-${mode}`,
        );
      } finally {
        wrapper.unmount();
      }
    });

    it.each([
      ['move-from', 'move-1'],
      ['move-to', 'move-1'],
      ['insert', 'insert-1'],
    ])('records the first reply on a tracked %s card', async (semanticColorKey, trackedChangeCanonicalId) => {
      pinClock();
      const { calls } = prepare('editing', {
        comments: {
          reply: () => ({ ok: false, code: 'TARGET_NOT_FOUND' }),
          commitPendingComment: ({ text, target }) => ({
            ok: true,
            createdCommentId: 'tracked-change-reply',
            items: [
              {
                commentId: 'tracked-change-reply',
                trackedChangeThreadParentId: target.trackedChangeId,
                trackedChangeSide: target.side,
                fileId: 'doc-1',
                commentText: text,
              },
            ],
          }),
        },
      });
      const comment = useComment({
        commentId: `tc-${semanticColorKey}`,
        trackedChange: true,
        trackedChangeCanonicalId,
        semanticColorKey,
        fileId: 'doc-1',
      });
      commentsStore.commentsList = [comment];
      commentsStore.activeComment = comment.commentId;
      const wrapper = mountDialog(comment, { CommentHeader: false });
      try {
        const finish = startRecording({ calls, wrapper });
        await wrapper.find('.reply-pill').trigger('click');
        commentsStore.currentCommentText = '<p>Tracked change reply</p>';
        await flushPromises();
        await wrapper.find('button.reply-btn-primary').trigger('click');
        await flushPromises();
        await expectRecording(
          finish('open the reply composer, type "<p>Tracked change reply</p>", click Reply'),
          `reply-on-tracked-${semanticColorKey}`,
        );
      } finally {
        wrapper.unmount();
      }
    });

    it.each(['editing', 'viewing'])('records an edit of the own comment through its menu in %s mode', async (mode) => {
      pinClock();
      const { comment, calls } = prepare(mode);
      const wrapper = mountDialog(comment, { CommentHeader: false });
      try {
        const finish = startRecording({ calls, wrapper });
        await selectOverflow(wrapper, 'Edit');
        commentsStore.currentCommentText = '<p>Corrected owner comment</p>';
        await flushPromises();
        await wrapper.find('button.reply-btn-primary').trigger('click');
        await flushPromises();
        await expectRecording(
          finish('choose Edit in the comment menu, type "<p>Corrected owner comment</p>", click Update'),
          `edit-own-comment-${mode}`,
        );
      } finally {
        wrapper.unmount();
      }
    });

    it('shows a refusal for an edit while retaining the draft', async () => {
      const { comment } = prepare('editing', {
        comments: { ...engine, edit: () => ({ ok: false, code: 'PERMISSION_DENIED' }) },
      });
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
      const { comment } = prepare('editing', {
        comments: { ...engine, resolve: () => ({ ok: false, code: 'PERMISSION_DENIED' }) },
      });
      commentsStore.init({ readOnly: false, allowResolve: true });
      superdocStub.interactionConfig.comments.allowResolve = true;
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
      const { comment } = prepare('editing', {
        comments: { ...engine, delete: () => ({ ok: false, code: 'PERMISSION_DENIED' }) },
      });
      const wrapper = mountDialog(comment, { CommentHeader: false });
      try {
        await selectOverflow(wrapper, 'Delete');
        await flushPromises();
        expect(wrapper.find('[role="alert"]').text()).toContain('you do not have permission');
      } finally {
        wrapper.unmount();
      }
    });

    it.each(['editing', 'viewing'])('records deleting the own reply through its menu in %s mode', async (mode) => {
      pinClock();
      const { comment, calls } = prepare(mode);
      commentsStore.commentsList.push(
        useComment({
          commentId: 'owner-reply',
          parentCommentId: comment.commentId,
          creatorId: superdocStore.user.id,
          creatorEmail: superdocStore.user.email,
          fileId: 'doc-1',
          commentText: 'Reply to delete',
        }),
      );
      const wrapper = mountDialog(comment, { CommentHeader: false });
      try {
        const finish = startRecording({ calls, wrapper });
        await selectOverflow(wrapper, 'Delete', 1);
        await expectRecording(finish('choose Delete in the reply menu'), `delete-own-reply-${mode}`);
      } finally {
        wrapper.unmount();
      }
    });

    it('keeps a permitted reply available when switching to viewing mode', async () => {
      const { comment } = prepare('editing');
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
      const { comment, calls } = prepare('viewing');
      comment.creatorId = 'other-user';
      comment.creatorEmail = 'other@example.com';
      comment.creatorName = superdocStore.user.name;
      superdocStub.config.role = role;
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
        expect(mutationCalls(calls)).toEqual([]);
      } finally {
        wrapper.unmount();
      }
    });

    it('keeps host-denied replies and own-comment overflow unavailable in viewing mode', async () => {
      const { comment } = prepare('viewing', { canWrite: false });
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
      const { comment, calls } = prepare('viewing', { readOnly: true });
      const wrapper = mountDialog(comment, { CommentHeader: false });
      try {
        expect(wrapper.find('.reply-pill').exists()).toBe(false);
        expect(wrapper.find('[data-comment-action="overflow"]').exists()).toBe(false);
        const header = wrapper.findComponent({ name: 'CommentHeader' });
        header.vm.$emit('overflow-select', 'edit');
        header.vm.$emit('overflow-select', 'delete');
        await flushPromises();
        expect(commentsStore.editingCommentId).toBeNull();
        expect(mutationCalls(calls)).toEqual([]);
      } finally {
        wrapper.unmount();
      }
    });

    it.each([
      ['allowed', true],
      ['denied', false],
    ])('records the pending viewing-mode comment when the host has creation %s', async (name, canCreate) => {
      pinClock();
      const { calls } = prepare('viewing', {
        canWrite: (command) => command === 'comments.createFromSelection' && canCreate,
        comments: {
          commitPendingComment: ({ text }) => ({
            ok: true,
            createdCommentId: 'viewing-mode-comment',
            items: [ownerInput(), { commentId: 'viewing-mode-comment', fileId: 'doc-1', commentText: text }],
          }),
        },
      });
      const draft = useComment({ commentId: 'pending-viewing-mode-comment', fileId: 'doc-1', commentText: '' });
      commentsStore.pendingComment = draft;
      commentsStore.activeComment = draft.commentId;
      commentsStore.currentCommentText = '<p>New viewing-mode comment</p>';
      const wrapper = mountDialog(draft);
      try {
        const finish = startRecording({ calls, wrapper });
        await wrapper.find('button.reply-btn-primary').trigger('click');
        await flushPromises();
        await expectRecording(finish('click Comment on the pending comment'), `create-pending-comment-${name}`);
      } finally {
        wrapper.unmount();
      }
    });
  });

  it('records rapid v2 reply clicks coalescing into one write (SD-3867)', async () => {
    pinClock();
    const parentInput = { commentId: 'comment-delayed-reply', fileId: 'doc-1', commentText: 'Delayed reply parent' };
    const document = makeHeldCommentDocument([parentInput]);
    const { calls } = installReviewAdapters({ comments: document.comments });
    const comment = useComment(parentInput);
    commentsStore.commentsList = [comment];
    commentsStore.activeComment = comment.commentId;
    commentsStore.currentCommentText = '<p>one delayed reply</p>';

    const wrapper = mountDialog(comment);
    const timeline = startTimeline({ calls, dialogs: () => ({ thread: wrapper }) });
    try {
      await wrapper.find('.reply-pill').trigger('click');
      const replyButton = wrapper.find('button.reply-btn-primary');
      await replyButton.trigger('click');
      await replyButton.trigger('click');
      await replyButton.trigger('click');
      timeline.step('open the reply composer holding "<p>one delayed reply</p>", click Reply three times');
      document.commit(0);
      await flushPromises();
      timeline.step('the document commits the reply');
      await expectRecording(timeline.recording(), 'reply-clicked-three-times');
    } finally {
      document.settleAll();
      wrapper.unmount();
    }
  });

  it.each(['fallback grouping', 'active directory'])(
    'closes an unchanged successful reply after %s rehydrates its parent row',
    async (source) => {
      const root = {
        commentId: '1',
        importedId: '1',
        fileId: 'doc-1',
        commentText: 'Legacy parent',
      };
      const child = {
        commentId: '2',
        fileId: 'doc-1',
        parentCommentId: '1',
        commentText: 'Submitted reply',
      };
      let settle;
      const completion = new Promise((resolve) => {
        settle = resolve;
      });
      const adapter = makeV2CommentsAdapter({
        documentId: 'doc-1',
        getCapabilityState: () => ({ canWrite: true }),
        reply: vi.fn(() => completion),
        mapV2CommentToUseCommentInput: (item) => item,
      });
      superdocStub.activeEditor.editorVersion = 2;
      superdocStub.activeEditor.v2Comments = adapter;
      superdocStub.activeEditor.v2TrackedChanges = makeV2TrackedChangesAdapter({
        mapV2TrackedChangeToCommentParams: (item) => item,
      });
      commentsStore.setV2CommentsAdapter(adapter);
      commentsStore.commentsList = [useComment(root)];
      commentsStore.activeComment = root.commentId;
      const publishDirectory = (items) =>
        commentsStore.setReviewDirectoryFromV2({
          superdoc: superdocStub,
          commentItems: items,
        });
      if (source === 'active directory') {
        commentsStore.isReviewDirectoryActive = true;
        expect(publishDirectory([root]).ok).toBe(true);
      }

      const wrapper = mountComments(CommentsList);
      const dialog = wrapper.findComponent(CommentDialog);
      const parentRow = dialog.props('comment');
      try {
        await dialog.find('.reply-pill').trigger('click');
        commentsStore.currentCommentText = child.commentText;
        await flushPromises();
        await dialog.find('button.reply-btn-primary').trigger('click');
        expect(adapter.reply).toHaveBeenCalledWith({
          parentCommentId: '1',
          text: child.commentText,
        });
        if (source === 'active directory') expect(publishDirectory([root, child]).ok).toBe(true);

        settle({ ok: true, items: [root, child] });
        await flushPromises();

        expect(commentsStore.commentsList.map((row) => [row.commentId, row.parentCommentId, row.commentText])).toEqual([
          ['1', undefined, 'Legacy parent'],
          ['2', '1', 'Submitted reply'],
        ]);
        expect(wrapper.findComponent(CommentDialog).element).toBe(dialog.element);
        expect(dialog.props('comment')).not.toBe(parentRow);
        expect(dialog.props('comment').commentId).toBe(root.commentId);
        expect(commentsStore.currentCommentText).toBe('');
        expect(dialog.find('.reply-expanded').exists()).toBe(false);
      } finally {
        settle({ ok: true, items: [root, child] });
        wrapper.unmount();
      }
    },
  );

  it.each(['pending root', 'another reply', 'edit', 'same reply reopened'])(
    'preserves a newer %s when a delayed legacy reply succeeds',
    async (next) => {
      const rootInput = { commentId: '1', importedId: '1', fileId: 'doc-1', commentText: 'Legacy parent' };
      const otherInput = { commentId: '2', fileId: 'doc-1', commentText: 'Other parent' };
      const document = makeHeldCommentDocument(next === 'another reply' ? [rootInput, otherInput] : [rootInput]);
      const { calls } = installReviewAdapters({ comments: document.comments });
      const writes = () => calls.filter((call) => !call.startsWith('comments.setActiveComment '));
      const root = useComment(rootInput);
      commentsStore.commentsList = [root];
      commentsStore.activeComment = root.commentId;
      const wrapper = mountDialog(root);
      let other;
      try {
        await wrapper.find('.reply-pill').trigger('click');
        commentsStore.currentCommentText = 'Identical draft';
        await flushPromises();
        await wrapper.find('button.reply-btn-primary').trigger('click');
        expect(writes()).toEqual(['comments.reply {"parentCommentId":"1","text":"Identical draft"}']);
        if (next === 'pending root') {
          const draft = useComment({ commentId: 'new-root', fileId: 'doc-1', commentText: '' });
          commentsStore.pendingComment = draft;
          commentsStore.activeComment = draft.commentId;
          await flushPromises();
          other = mountDialog(draft);
        } else if (next === 'another reply') {
          const parent = useComment(otherInput);
          commentsStore.commentsList.push(parent);
          commentsStore.activeComment = parent.commentId;
          await flushPromises();
          other = mountDialog(parent);
          await other.find('.reply-pill').trigger('click');
        } else if (next === 'edit') {
          wrapper.findComponent({ name: 'CommentHeader' }).vm.$emit('overflow-select', 'edit');
          await flushPromises();
        } else {
          await wrapper.find('button.reply-btn-cancel').trigger('click');
          await wrapper.find('.reply-pill').trigger('click');
        }
        commentsStore.currentCommentText = 'Identical draft';
        commentsStore.currentCommentMentions = [{ id: 'user-2', email: 'other@example.test' }];
        const draft = commentsStore.pendingComment;
        const active = commentsStore.activeComment;
        const editing = commentsStore.editingCommentId;

        document.commit(0);
        await flushPromises();

        expect(commentsStore.currentCommentText).toBe('Identical draft');
        expect(commentsStore.currentCommentMentions).toEqual([{ id: 'user-2', email: 'other@example.test' }]);
        expect(commentsStore.pendingComment).toBe(draft);
        expect(commentsStore.activeComment).toBe(active);
        expect(commentsStore.editingCommentId).toBe(editing);
        expect((other ?? wrapper).find('button.reply-btn-primary').exists()).toBe(true);
        expect(
          commentsStore.commentsList
            .filter((row) => row.parentCommentId === '1')
            .map((row) => [row.commentId, row.commentText]),
        ).toEqual([['reply-1', 'Identical draft']]);
      } finally {
        document.settleAll();
        other?.unmount();
        wrapper.unmount();
      }
    },
  );
  it.each([
    ['PERMISSION_DENIED', 'permission-denied'],
    ['INTERNAL_ERROR', 'internal-error'],
  ])('records a refused v2 reply and its feedback through retry and cancel (%s)', async (code, name) => {
    pinClock();
    const parentInput = { commentId: 'reply-denied', fileId: 'doc-1', commentText: 'Parent' };
    const document = makeHeldCommentDocument([parentInput]);
    const { calls } = installReviewAdapters({ comments: document.comments });
    const comment = useComment(parentInput);
    commentsStore.commentsList = [comment];
    commentsStore.activeComment = comment.commentId;
    commentsStore.currentCommentText = '<p>Keep my reply</p>';
    const wrapper = mountDialog(comment);
    const timeline = startTimeline({ calls, dialogs: () => ({ thread: wrapper }) });
    try {
      await wrapper.find('.reply-pill').trigger('click');
      await wrapper.find('button.reply-btn-primary').trigger('click');
      document.refuse(0, { code });
      await flushPromises();
      timeline.step(
        `open the reply composer holding "<p>Keep my reply</p>", click Reply; the document refuses (${code})`,
      );
      await wrapper.find('button.reply-btn-primary').trigger('click');
      timeline.step('click Reply again while the document holds the write');
      document.commit(1);
      await flushPromises();
      timeline.step('the document commits the retried reply');
      await wrapper.find('.reply-pill').trigger('click');
      commentsStore.currentCommentText = '<p>Another reply</p>';
      await flushPromises();
      await wrapper.find('button.reply-btn-primary').trigger('click');
      document.refuse(2, { code });
      await flushPromises();
      timeline.step(
        `open the reply composer, type "<p>Another reply</p>", click Reply; the document refuses (${code})`,
      );
      await wrapper.find('button.reply-btn-cancel').trigger('click');
      await wrapper.find('.reply-pill').trigger('click');
      timeline.step('click Cancel, then open the reply composer again');
      await expectRecording(timeline.recording(), `reply-refused-${name}`);
    } finally {
      document.settleAll();
      wrapper.unmount();
    }
  });

  const preparePendingComment = (commentId: string, draft: string, comments = {}) => {
    const adapters = installReviewAdapters({ comments });
    const pendingDraft = useComment({ commentId, fileId: 'doc-1', commentText: '' });
    commentsStore.pendingComment = pendingDraft;
    commentsStore.activeComment = pendingDraft.commentId;
    commentsStore.currentCommentText = draft;
    return { pendingDraft, ...adapters };
  };

  it('records rapid new-comment clicks coalescing into one write', async () => {
    pinClock();
    const document = makeHeldCommentDocument([]);
    const { pendingDraft, calls } = preparePendingComment(
      'pending-new-comment-delayed',
      '<p>one delayed new comment</p>',
      document.comments,
    );
    const wrapper = mountDialog(pendingDraft);
    const timeline = startTimeline({ calls, dialogs: () => ({ pending: wrapper }) });
    try {
      const submitButton = wrapper.find('button.reply-btn-primary');
      await submitButton.trigger('click');
      await submitButton.trigger('click');
      await submitButton.trigger('click');
      timeline.step('click Comment three times on the pending comment');
      document.commit(0);
      await flushPromises();
      timeline.step('the document commits the comment');
      await expectRecording(timeline.recording(), 'new-comment-clicked-three-times');
    } finally {
      document.settleAll();
      wrapper.unmount();
    }
  });

  it('records a refused new comment keeping its pending draft', async () => {
    pinClock();
    const document = makeHeldCommentDocument([]);
    const { pendingDraft, calls } = preparePendingComment(
      'pending-new-comment-denied',
      '<p>Keep my draft</p>',
      document.comments,
    );
    const wrapper = mountDialog(pendingDraft);
    const timeline = startTimeline({ calls, dialogs: () => ({ pending: wrapper }) });
    try {
      timeline.step('the pending comment holds "<p>Keep my draft</p>"');
      await wrapper.find('button.reply-btn-primary').trigger('click');
      timeline.step('click Comment');
      document.refuse(0, { code: 'PERMISSION_DENIED', detail: 'document-mode-read-only' });
      await flushPromises();
      timeline.step('the document refuses the comment (PERMISSION_DENIED, document-mode-read-only)');
      await expectRecording(timeline.recording(), 'new-comment-refused');
    } finally {
      document.settleAll();
      wrapper.unmount();
    }
  });

  it('keeps the new-comment draft retryable when the document throws on commit', async () => {
    const { pendingDraft, calls } = preparePendingComment(
      'pending-new-comment-throws',
      '<p>a new comment that fails</p>',
      {
        commitPendingComment: () => {
          throw new Error('boom');
        },
      },
    );
    const wrapper = mountDialog(pendingDraft);
    try {
      const submitButton = wrapper.find('button.reply-btn-primary');
      await submitButton.trigger('click');
      await flushPromises();
      expect(wrapper.find('[role="alert"]').text()).toBe(
        'Your comment could not be saved. Your draft is still here. Try again or cancel.',
      );
      expect(commentsStore.currentCommentText).toBe('<p>a new comment that fails</p>');
      expect(commentsStore.pendingComment).toBe(pendingDraft);
      expect(submitButton.attributes('disabled')).toBeUndefined();

      await submitButton.trigger('click');
      await flushPromises();
      expect(calls.filter((call) => call.startsWith('comments.commitPendingComment '))).toHaveLength(2);
    } finally {
      wrapper.unmount();
    }
  });

  it('reports a v1 editor command that throws while committing a new comment', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    superdocStub.activeEditor.commands.insertComment = vi.fn(() => {
      throw new Error('editor destroyed');
    });
    const pendingDraft = useComment({ commentId: 'pending-v1-comment-throws', fileId: 'doc-1', commentText: '' });
    commentsStore.pendingComment = pendingDraft;
    commentsStore.activeComment = pendingDraft.commentId;
    commentsStore.currentCommentText = '<p>v1 comment</p>';
    const wrapper = mountDialog(pendingDraft);
    try {
      await wrapper.find('button.reply-btn-primary').trigger('click');
      await flushPromises();
      expect(superdocStub.activeEditor.commands.insertComment).toHaveBeenCalledTimes(1);
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
      expect(consoleError).toHaveBeenCalledWith('[SuperDoc] addComment failed', expect.any(Error));
      expect(commentsStore.pendingComment).toBeNull();
      expect(commentsStore.commentsList.map((row) => row.commentText)).toEqual(['<p>v1 comment</p>']);
    } finally {
      consoleError.mockRestore();
      wrapper.unmount();
    }
  });

  it('records a reply anchored to the tracked change when an unrelated pending comment exists', async () => {
    pinClock();
    const trackedChangeCanonicalId = 'tc|main%3A%2Fword%2Fdocument.xml|del|coalesced|0';
    const trackedChangeStory = { kind: 'story', storyType: 'body' };
    const { calls } = installReviewAdapters({
      comments: {
        reply: () => ({ ok: false, code: 'TARGET_NOT_FOUND' }),
        commitPendingComment: ({ text, target, mentions }) => ({
          ok: true,
          createdCommentId: 'tracked-change-sidecar-reply',
          items: [
            {
              commentId: 'tracked-change-sidecar-reply',
              trackedChangeThreadParentId: target.trackedChangeId,
              fileId: 'doc-1',
              commentText: text,
              mentions,
            },
          ],
        }),
      },
    });
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

    const wrapper = mountDialog(trackedChange);
    try {
      const finish = startRecording({ calls, wrapper });
      await wrapper.find('.reply-pill').trigger('click');
      await wrapper.find('button.reply-btn-primary').trigger('click');
      await flushPromises();
      await expectRecording(
        finish('open the reply composer and click Reply'),
        'reply-on-tracked-change-with-unrelated-pending-comment',
      );
    } finally {
      wrapper.unmount();
    }
  });

  it('records an ordinary v2 reply addressed to the visible comment root id', async () => {
    pinClock();
    const rootInput = {
      commentId: 'comment-root',
      importedId: 'imported-docx-id',
      fileId: 'doc-1',
      commentText: '<p>Root comment</p>',
    };
    const { calls } = installReviewAdapters({
      comments: {
        reply: ({ parentCommentId, text }) => ({
          ok: true,
          createdCommentId: 'ordinary-reply',
          items: [rootInput, { commentId: 'ordinary-reply', parentCommentId, fileId: 'doc-1', commentText: text }],
        }),
      },
    });
    const comment = useComment(rootInput);
    commentsStore.commentsList = [comment];
    commentsStore.activeComment = comment.commentId;
    commentsStore.currentCommentText = '<p>ordinary reply</p>';

    const wrapper = mountDialog(comment);
    try {
      const finish = startRecording({ calls, wrapper });
      await wrapper.find('.reply-pill').trigger('click');
      await wrapper.find('button.reply-btn-primary').trigger('click');
      await flushPromises();
      await expectRecording(finish('open the reply composer and click Reply'), 'reply-addressed-to-visible-root-id');
    } finally {
      wrapper.unmount();
    }
  });
});
