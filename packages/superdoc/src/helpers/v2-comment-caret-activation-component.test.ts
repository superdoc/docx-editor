import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { defineComponent, h, nextTick, ref } from 'vue';
import { EventEmitter } from 'eventemitter3';
import { DOCX } from '@superdoc/common';
import type { SelectionInfo } from '@superdoc/document-api';
import { useSuperdocStore } from '../stores/superdoc-store.js';
import { useCommentsStore, type CommentsStoreEditor } from '../stores/comments-store.js';
import { normalizeUiConfig } from '../core/config/normalize-ui-config.js';
import { globalPropertiesWith } from '../test-support/global-properties.js';
import { fixedCommentsLayout } from '../test-support/comments-layout.js';
import { makeV2CommentsAdapter } from '../test-support/v2-review-adapters.js';
import useComment from '../components/CommentsLayer/use-comment.js';
import CommentDialog from '../components/CommentsLayer/CommentDialog.vue';
import SuperDoc from '../SuperDoc.vue';

vi.mock('../core/v2-integration/v2-integration.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/v2-integration/v2-integration.js')>();
  return {
    ...actual,
    createDefaultV2Integration: () => ({
      ...actual.createStubV2Integration(),
      EditorComponent: defineComponent({
        name: 'CommentCaretFixture',
        emits: ['v2-selection-changed'],
        setup: () => () => h('textarea', { 'aria-label': 'Document input' }),
      }),
    }),
  };
});

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  vi.unstubAllGlobals();
});

const selectionInfo = (ids: string[], activeChangeIds: string[] = [], offset = 7): SelectionInfo => ({
  empty: true,
  target: { kind: 'text', segments: [{ blockId: 'paragraph', range: { start: offset, end: offset } }] },
  activeCommentIds: ids,
  activeChangeIds,
  activeMarks: [],
});

const deferredSelection = () => {
  let complete: (value: SelectionInfo) => void = () => {};
  const promise = new Promise<SelectionInfo>((resolve) => {
    complete = resolve;
  });
  return { promise, complete: (value: SelectionInfo) => complete(value) };
};

async function mountFixtureForMode(documentMode: string, additionalRows: ReturnType<typeof useComment>[] = []) {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  const pinia = createPinia();
  const store = useSuperdocStore(pinia);
  const comments = useCommentsStore(pinia);
  store.documents = [
    {
      id: 'doc-a',
      type: DOCX,
      data: new Blob([]),
      getEditor: () => null,
      getDocumentRuntime: () => null,
      isReady: false,
      pageContainers: [],
    },
  ];
  store.user = { id: 'author', name: 'Fixture Author', email: 'author@example.test', image: null };
  const config = { modules: { comments: {} }, documentMode };
  Object.assign(store.modules, config.modules);
  const current = vi.fn<() => Promise<SelectionInfo>>().mockResolvedValue(selectionInfo([]));
  const focusComment = vi.fn(async () => ({ ok: true }));
  const setActiveComment = vi.fn();
  const setSelection = vi.fn();
  const focus = vi.fn();
  const adapter = makeV2CommentsAdapter({
    documentId: 'doc-a',
    focusComment,
    setActiveComment,
    getCapabilityState: () => ({ canWrite: true }),
    captureCurrentSelection: async () => ({ ok: true, target: selectionInfo([]).target }),
  });
  const superdoc = Object.assign(new EventEmitter(), {
    config,
    ...fixedCommentsLayout(),
    uiConfig: normalizeUiConfig(config),
    activeEditor: {
      editorVersion: 2,
      documentId: 'doc-a',
      options: { documentId: 'doc-a' },
      doc: { selection: { current } },
      authoring: { setSelectionTarget: setSelection },
      v2Comments: adapter,
    } satisfies CommentsStoreEditor,
    user: store.user,
    users: [],
    colors: [],
    focus,
    canPerformPermission: () => true,
    broadcastSidebarToggle() {},
    setActiveEditor() {},
  });
  const inputFocus = vi.fn();
  const CommentInput = defineComponent({
    setup(_, { expose }) {
      const input = ref<HTMLTextAreaElement | null>(null);
      expose({
        focus: () => {
          inputFocus();
          input.value?.focus();
        },
      });
      return () => h('textarea', { ref: input, 'aria-label': 'Reply input' });
    },
  });
  const global = {
    plugins: [pinia],
    config: { globalProperties: globalPropertiesWith({ $superdoc: superdoc }) },
    stubs: { SurfaceHost: true, FloatingComments: true, CommentDialog: true },
  };
  const shell = mount(SuperDoc, { attachTo: document.body, global });
  mounted.push(shell);
  await flushPromises();
  superdoc.emit('active-editor-change');
  const rows = [
    ...['a', 'b'].map((id) =>
      useComment({
        commentId: `thread-${id}`,
        importedId: id,
        fileId: 'doc-a',
        commentText: `Fixture ${id}`,
        creatorName: 'Fixture Reviewer',
        creatorEmail: 'reviewer@example.test',
      }),
    ),
    ...additionalRows,
  ];
  comments.commentsList = rows;
  const dialogs = rows.map((comment) =>
    mount(CommentDialog, {
      attachTo: document.body,
      props: { comment },
      global: {
        ...global,
        directives: { 'click-outside': {} },
        stubs: {
          CommentHeader: true,
          CommentInput,
          InternalDropdown: true,
          Avatar: true,
        },
      },
    }),
  );
  mounted.push(...dialogs);
  await flushPromises();
  const editor = shell.findComponent({ name: 'CommentCaretFixture' });
  const input = shell.get<HTMLTextAreaElement>('textarea');
  input.element.focus();
  const emitSelection = (hasRangeSelection = false) => editor.vm.$emit('v2-selection-changed', { hasRangeSelection });
  const move = async (ids: string[], activeChangeIds: string[] = [], offset = 7) => {
    current.mockResolvedValue(selectionInfo(ids, activeChangeIds, offset));
    emitSelection();
    await flushPromises();
    await nextTick();
  };
  return {
    shell,
    dialogs,
    rows,
    comments,
    current,
    superdoc,
    input,
    inputFocus,
    focusComment,
    setActiveComment,
    setSelection,
    focus,
    emitSelection,
    move,
    store,
    adapter,
  };
}

describe.each(['editing', 'suggesting'])('v2 ordinary comment caret activation in %s mode', (documentMode) => {
  const mountFixture = (additionalRows: ReturnType<typeof useComment>[] = []) =>
    mountFixtureForMode(documentMode, additionalRows);

  it.each(['tracked-overlap', 'canonical-overlap', 'position-overlap'])(
    'preserves an explicit tracked card covered by %s until the caret leaves that change',
    async (changeId) => {
      const tracked = useComment({
        commentId: 'tracked-overlap',
        trackedChangeCanonicalId: 'canonical-overlap',
        trackedChangePositionAliases: ['position-overlap'],
        trackedChange: true,
        trackedChangeType: 'insert',
        trackedChangeText: 'XYZ',
        fileId: 'doc-a',
        creatorName: 'Fixture Reviewer',
        creatorEmail: 'reviewer@example.test',
      });
      const fixture = await mountFixture([tracked]);
      fixture.comments.setActiveComment(fixture.superdoc, 'tracked-overlap');
      await flushPromises();
      fixture.input.element.focus();
      fixture.setActiveComment.mockClear();
      const dialog = fixture.dialogs[2];
      if (!dialog) throw new Error('Missing tracked fixture dialog');
      for (const offset of [10, 9]) {
        await fixture.move(['a'], [changeId], offset);
        expect.soft(fixture.comments.activeComment).toBe('tracked-overlap');
        expect.soft(fixture.comments.isActiveCommentFromCaret).toBe(false);
        expect.soft(dialog.classes()).toContain('is-active');
        expect.soft(fixture.dialogs[0]?.classes()).not.toContain('is-active');
        expect.soft(document.activeElement).toBe(fixture.input.element);
        expect.soft(fixture.dialogs.every((card) => !card.find('.reply-expanded, textarea').exists())).toBe(true);
      }
      await fixture.move(['a'], ['different-change'], 7);
      expect(fixture.comments.activeComment).toBe('thread-a');
      expect(fixture.comments.isActiveCommentFromCaret).toBe(true);
      expect(dialog.classes()).not.toContain('is-active');
      expect(fixture.dialogs[0]?.classes()).toContain('is-active');
      expect(document.activeElement).toBe(fixture.input.element);
      expect(fixture.dialogs.every((card) => !card.find('.reply-pill, .reply-expanded, textarea').exists())).toBe(true);
      for (const spy of [
        fixture.inputFocus,
        fixture.focusComment,
        fixture.setActiveComment,
        fixture.setSelection,
        fixture.focus,
      ]) {
        expect(spy).not.toHaveBeenCalled();
      }
    },
  );

  it('allows ordinary activation in a tracked overlap without an explicit tracked choice', async () => {
    const fixture = await mountFixture([
      useComment({ commentId: 'tracked-overlap', trackedChange: true, fileId: 'doc-a' }),
    ]);
    await fixture.move(['a'], ['tracked-overlap']);
    expect(fixture.comments.activeComment).toBe('thread-a');
    expect(fixture.comments.isActiveCommentFromCaret).toBe(true);
    expect(fixture.dialogs[0]?.classes()).toContain('is-active');
    await fixture.move(['b'], ['tracked-overlap']);
    expect(fixture.comments.activeComment).toBe('thread-b');
  });

  it('preserves a hydrated tracked choice from the review directory', async () => {
    const tracked = useComment({ commentId: 'tracked-overlap', trackedChange: true, fileId: 'doc-a' });
    const fixture = await mountFixture([tracked]);
    fixture.comments.commentsList = fixture.rows.filter((row) => !row.trackedChange);
    fixture.comments.reviewDirectoryList = [tracked];
    fixture.comments.setActiveComment(fixture.superdoc, 'tracked-overlap');
    await fixture.move(['a'], ['tracked-overlap']);
    expect(fixture.comments.activeComment).toBe('tracked-overlap');
    await fixture.move(['a']);
    expect(fixture.comments.activeComment).toBe('thread-a');
  });

  it('does not retain a tracked choice belonging to another document', async () => {
    const fixture = await mountFixture([
      useComment({ commentId: 'tracked-overlap', trackedChange: true, fileId: 'doc-b' }),
    ]);
    fixture.comments.setActiveComment(fixture.superdoc, 'tracked-overlap');
    await fixture.move(['a'], ['tracked-overlap']);
    expect(fixture.comments.activeComment).toBe('thread-a');
  });

  it.each([
    ['a', 'b'],
    ['b', 'a'],
  ])('follows %s to %s and outside without opening a composer or moving focus', async (first, second) => {
    const fixture = await mountFixture();
    for (const id of [first, first, second]) {
      await fixture.move([id]);
      expect.soft(fixture.comments.activeComment).toBe(`thread-${id}`);
      expect.soft(fixture.dialogs.filter((dialog) => dialog.classes().includes('is-active'))).toHaveLength(1);
      expect
        .soft(fixture.dialogs.find((dialog) => dialog.text().includes(`Fixture ${id}`))?.classes())
        .toContain('is-active');
      expect
        .soft(fixture.dialogs.every((dialog) => !dialog.find('.reply-pill, .reply-expanded, textarea').exists()))
        .toBe(true);
      expect.soft(document.activeElement).toBe(fixture.input.element);
    }
    await fixture.move([]);
    expect(fixture.comments.activeComment).toBeNull();
    expect(fixture.dialogs.every((dialog) => !dialog.classes().includes('is-active'))).toBe(true);
    for (const spy of [
      fixture.inputFocus,
      fixture.focusComment,
      fixture.setActiveComment,
      fixture.setSelection,
      fixture.focus,
    ]) {
      expect(spy).not.toHaveBeenCalled();
    }
    expect(fixture.current).toHaveBeenCalledTimes(4);
  });

  it('opens the passive same card explicitly, preserves its reply draft, and allows a new comment', async () => {
    const fixture = await mountFixture();
    await fixture.move(['a']);
    const dialog = fixture.dialogs.find((candidate) => candidate.text().includes('Fixture a'));
    expect(dialog).toBeDefined();
    if (!dialog) throw new Error('Missing fixture dialog');
    const pending = deferredSelection();
    fixture.current.mockReturnValueOnce(pending.promise);
    fixture.emitSelection();
    await dialog.trigger('click');
    await flushPromises();
    expect(fixture.focusComment).toHaveBeenCalledOnce();
    expect(dialog.find('.reply-pill').exists()).toBe(true);
    await fixture.move(['a']);
    expect(dialog.find('.reply-pill').exists()).toBe(true);
    await dialog.get('.reply-pill').trigger('click');
    await flushPromises();
    expect(fixture.inputFocus).toHaveBeenCalled();
    const composer = dialog.get('textarea').element;
    fixture.comments.currentCommentText = '<p>Fabricated reply</p>';
    fixture.comments.currentCommentMentions = [{ name: 'Fixture Reviewer', email: 'reviewer@example.test' }];
    pending.complete(selectionInfo(['b']));
    await flushPromises();
    await fixture.move(['b']);
    expect(fixture.comments.activeComment).toBe('thread-a');
    expect(fixture.comments.currentCommentText).toBe('<p>Fabricated reply</p>');
    expect(fixture.comments.currentCommentMentions).toEqual([
      { name: 'Fixture Reviewer', email: 'reviewer@example.test' },
    ]);
    expect(document.activeElement).toBe(composer);
    await dialog.get('.reply-btn-cancel').trigger('click');
    expect(await fixture.comments.showAddComment(fixture.superdoc)).toEqual({ ok: true });
    expect(fixture.comments.pendingComment).not.toBeNull();
    expect(fixture.comments.isActiveCommentFromCaret).toBe(false);
  });

  it('retains an empty explicit reply composer during navigation', async () => {
    const fixture = await mountFixture();
    const dialog = fixture.dialogs[0];
    if (!dialog) throw new Error('Missing fixture dialog');
    await dialog.trigger('click');
    await flushPromises();
    await dialog.get('.reply-pill').trigger('click');
    await fixture.move(['b']);
    expect(fixture.comments.activeComment).toBe('thread-a');
    expect(dialog.find('.reply-expanded').exists()).toBe(true);
    dialog.unmount();
    await flushPromises();
    expect(fixture.comments.replyingCommentId).toBeNull();
    await fixture.move(['b']);
    expect(fixture.comments.activeComment).toBe('thread-b');
  });

  it('lets the latest selection win and retains the active thread among overlapping aliases', async () => {
    const fixture = await mountFixture();
    const older = deferredSelection();
    fixture.current.mockReturnValueOnce(older.promise);
    fixture.emitSelection();
    await fixture.move(['b']);
    older.complete(selectionInfo(['a']));
    await flushPromises();
    expect(fixture.comments.activeComment).toBe('thread-b');
    await fixture.move(['a', 'thread-b']);
    expect(fixture.comments.activeComment).toBe('thread-b');
  });

  it.each(['empty', 'other'])('does not let a delayed %s result replace explicit selection', async (result) => {
    const fixture = await mountFixture();
    await fixture.move(['a']);
    const pending = deferredSelection();
    fixture.current.mockReturnValueOnce(pending.promise);
    fixture.emitSelection();
    fixture.comments.setActiveComment(fixture.superdoc, 'thread-a');
    pending.complete(selectionInfo(result === 'empty' ? [] : ['b']));
    await flushPromises();
    expect(fixture.comments.activeComment).toBe('thread-a');
    expect(fixture.comments.isActiveCommentFromCaret).toBe(false);
    expect(fixture.dialogs[0]?.find('.reply-pill').exists()).toBe(true);
  });

  it.each(['pending', 'edit'])('preserves a newer %s draft and mentions', async (kind) => {
    const fixture = await mountFixture();
    fixture.comments.setActiveComment(fixture.superdoc, 'thread-a');
    const pending = deferredSelection();
    fixture.current.mockReturnValueOnce(pending.promise);
    fixture.emitSelection();
    if (kind === 'pending') {
      expect(await fixture.comments.showAddComment(fixture.superdoc)).toEqual({ ok: true });
    } else fixture.comments.editingCommentId = 'thread-a';
    fixture.comments.currentCommentText = '<p>Preserved draft</p>';
    fixture.comments.currentCommentMentions = [{ name: 'Fixture Reviewer', email: 'reviewer@example.test' }];
    const draft = fixture.comments.pendingComment;
    const active = fixture.comments.activeComment;
    pending.complete(selectionInfo(['b']));
    await flushPromises();
    await fixture.move([]);
    expect(fixture.comments.activeComment).toBe(active);
    expect(fixture.comments.pendingComment).toBe(draft);
    expect(fixture.comments.editingCommentId).toBe(kind === 'edit' ? 'thread-a' : null);
    expect(fixture.comments.currentCommentText).toBe('<p>Preserved draft</p>');
    expect(fixture.comments.currentCommentMentions).toEqual([
      { name: 'Fixture Reviewer', email: 'reviewer@example.test' },
    ]);
  });

  it.each(['document', 'mode', 'unmount'])('rejects a stale selection after %s lifecycle changes', async (kind) => {
    const fixture = await mountFixture();
    const pending = deferredSelection();
    fixture.current.mockReturnValueOnce(pending.promise);
    fixture.emitSelection();
    if (kind === 'document') {
      const editor = fixture.superdoc.activeEditor;
      fixture.superdoc.activeEditor = { ...editor, documentId: 'doc-b', options: { documentId: 'doc-b' } };
      fixture.superdoc.emit('active-editor-change');
      fixture.superdoc.activeEditor = editor;
      fixture.superdoc.emit('active-editor-change');
    } else if (kind === 'mode') {
      fixture.superdoc.config.documentMode = 'viewing';
      fixture.superdoc.emit('document-mode-change');
      fixture.superdoc.config.documentMode = 'editing';
      fixture.superdoc.emit('document-mode-change');
    } else fixture.shell.unmount();
    pending.complete(selectionInfo(['a']));
    await flushPromises();
    expect(fixture.comments.activeComment).toBeNull();
  });

  it('uses only eligible document-scoped ordinary rows when aliases collide', async () => {
    const fixture = await mountFixture();
    fixture.comments.commentsList = [
      useComment({ commentId: 'other-doc', importedId: 'a', fileId: 'doc-b' }),
      useComment({ commentId: 'resolved', importedId: 'resolved', fileId: 'doc-a', resolvedTime: 1 }),
      useComment({ commentId: 'tracked', importedId: 'tracked', fileId: 'doc-a', trackedChange: true }),
      ...fixture.rows,
    ];
    await fixture.move(['a']);
    expect(fixture.comments.activeComment).toBe('thread-a');
    await fixture.move(['resolved', 'tracked', 'missing']);
    expect(fixture.comments.activeComment).toBeNull();
    fixture.superdoc.activeEditor = {
      ...fixture.superdoc.activeEditor,
      documentId: 'doc-b',
      options: { documentId: 'doc-b' },
    };
    fixture.superdoc.emit('active-editor-change');
    await fixture.move(['a']);
    expect(fixture.comments.activeComment).toBe('other-doc');
  });

  it('rejects an old caret read after a range and clears passive state for unsupported selection', async () => {
    const fixture = await mountFixture();
    const pending = deferredSelection();
    fixture.current.mockReturnValueOnce(pending.promise);
    fixture.emitSelection();
    fixture.emitSelection(true);
    pending.complete(selectionInfo(['a']));
    await flushPromises();
    expect(fixture.comments.activeComment).toBeNull();
    await fixture.move(['a']);
    fixture.emitSelection(true);
    await flushPromises();
    expect(fixture.comments.activeComment).toBeNull();
    await fixture.move(['a']);
    fixture.current.mockResolvedValue({ ...selectionInfo(['b']), target: null });
    fixture.emitSelection();
    await flushPromises();
    expect(fixture.comments.activeComment).toBeNull();
    fixture.current.mockResolvedValue({ ...selectionInfo(['b']), empty: false });
    fixture.emitSelection();
    await flushPromises();
    expect(fixture.comments.activeComment).toBeNull();
  });

  it('preserves an explicit card on empty coverage and ignores rejected reads', async () => {
    const fixture = await mountFixture();
    fixture.comments.setActiveComment(fixture.superdoc, 'thread-b');
    await fixture.move([]);
    expect(fixture.comments.activeComment).toBe('thread-b');
    fixture.current.mockRejectedValueOnce(new Error('Fixture selection unavailable'));
    fixture.emitSelection();
    await flushPromises();
    expect(fixture.comments.activeComment).toBe('thread-b');
    expect(fixture.comments.isActiveCommentFromCaret).toBe(false);
  });

  it('rejects a pending caret selection when the mode becomes viewing', async () => {
    const fixture = await mountFixture();
    const pending = deferredSelection();
    fixture.current.mockReturnValueOnce(pending.promise);
    fixture.emitSelection();
    fixture.superdoc.config.documentMode = 'viewing';
    pending.complete(selectionInfo(['a']));
    await flushPromises();
    expect(fixture.comments.activeComment).toBeNull();
  });

  it('keeps hidden ordinary threads and viewing mode out of passive activation', async () => {
    const fixture = await mountFixture();
    fixture.comments.setViewingVisibility({ documentMode: 'viewing', commentsVisible: false });
    await fixture.move(['a']);
    expect(fixture.comments.activeComment).toBeNull();
    fixture.current.mockClear();
    fixture.superdoc.config.documentMode = 'viewing';
    await fixture.move(['a']);
    expect(fixture.current).not.toHaveBeenCalled();
    expect(fixture.comments.activeComment).toBeNull();
  });
});
