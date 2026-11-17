import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { defineComponent, h, nextTick, reactive, shallowRef, watch } from 'vue';
import { EventEmitter } from 'eventemitter3';
import { DOCX } from '@superdoc/common';
import type { SelectionInfo } from '@superdoc/document-api';
import { useSuperdocStore } from '../stores/superdoc-store.js';
import { useCommentsStore } from '../stores/comments-store.js';
import { normalizeUiConfig } from '../core/config/normalize-ui-config.js';
import type { CommentsLayout, CommentsLayoutState, EffectiveCommentsLayout } from '../core/types/index.js';
import { registerCommentsLayoutBridge } from './comment-small-screen.js';
import type { V2SidebarReviewTarget } from './v2-review-target-sidebar-sync.js';
import SuperDoc from '../SuperDoc.vue';
import useComment from '../components/CommentsLayer/use-comment.js';

vi.mock('../core/v2-integration/v2-integration.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/v2-integration/v2-integration.js')>();
  return {
    ...actual,
    createDefaultV2Integration: () => ({
      ...actual.createStubV2Integration(),
      EditorComponent: defineComponent({
        name: 'InlineDismissalFixture',
        emits: ['v2-host-event', 'v2-selection-changed', 'v2-render-cleared', 'v2-editor-ready'],
        setup: () => () =>
          h('div', { 'data-native-mount': '', tabindex: 0 }, [
            h('textarea', { 'data-document-input': '', 'data-v2-ime-host': 'true' }),
            h('textarea', { 'data-foreign-input': '' }),
          ]),
      }),
    }),
  };
});

const mounted: VueWrapper[] = [];
const containers: HTMLElement[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  for (const container of containers.splice(0)) container.remove();
  vi.restoreAllMocks();
});

const caret = (offset = 16, activeCommentIds: string[] = []): SelectionInfo => ({
  empty: true,
  target: { kind: 'text', segments: [{ blockId: 'paragraph-a', range: { start: offset, end: offset } }] },
  selectionTarget: {
    kind: 'selection',
    start: { kind: 'text', blockId: 'paragraph-a', offset },
    end: { kind: 'text', blockId: 'paragraph-a', offset },
  },
  activeMarks: [],
  activeCommentIds,
  activeChangeIds: [],
});
const insertion = (overrides: Record<string, unknown> = {}) => ({
  type: 'mutation:committed',
  origin: 'command',
  cause: 'user',
  editableCommandKind: 'insert-text',
  receipt: { success: true, txId: 'fixture-insertion' },
  ...overrides,
});
const deferredSelection = () => {
  let complete: (value: unknown) => void = vi.fn();
  let reject: (reason: Error) => void = vi.fn();
  const promise = new Promise<unknown>((resolve, rejectPromise) => {
    complete = resolve;
    reject = rejectPromise;
  });
  return { promise, complete: (value: unknown) => complete(value), reject: (reason: Error) => reject(reason) };
};
const remoteChange = () => ({ type: 'collaboration:remote-changed', remoteGeneration: 1, reviewChanged: false });
const selectionSignal = (offset: number) => ({
  hasRangeSelection: false,
  snapshot: {
    anchor: { blockId: 'paragraph-a', blockOffset: offset },
    focus: { blockId: 'paragraph-a', blockOffset: offset },
  },
});

const reviewTargetSource = () => {
  const listeners = new Set<(target: V2SidebarReviewTarget | null) => void>();
  return {
    subscribeActiveReviewTarget(listener: (target: V2SidebarReviewTarget | null) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish(target: V2SidebarReviewTarget | null) {
      for (const listener of listeners) listener(target);
    },
    listenerCount: () => listeners.size,
  };
};

async function mountShell(layout: CommentsLayout = 'inline', width = 900) {
  const pinia = createPinia();
  const store = useSuperdocStore(pinia);
  store.documents = [
    {
      id: 'doc-a',
      type: DOCX,
      data: new Blob(),
      isReady: false,
      pageContainers: [],
      getEditor: () => null,
      getDocumentRuntime: () => null,
    },
  ];
  Object.assign(store.modules, { comments: {} });
  const documentMode = 'editing' as const;
  const editorVersion = 2 as const;
  const config = {
    documents: [],
    modules: { comments: {} },
    ui: { comments: { layout } },
    documentMode,
  };
  const current = vi.fn<(_input?: unknown) => unknown>(() => caret());
  const caretCurrent = vi.fn<() => unknown>(() => caret());
  const focus = vi.fn();
  const setSelectionTarget = vi.fn<(_input: unknown) => Promise<unknown>>(async () => ({ ok: true }));
  const documentMutation = vi.fn();
  const clearReview = vi.fn();
  const activeEditor = {
    editorVersion,
    documentId: 'doc-a',
    options: { documentId: 'doc-a' },
    doc: {
      selection: { current: (input?: unknown) => (input === undefined ? caretCurrent() : current(input)) },
      comments: { delete: documentMutation, resolve: documentMutation, create: documentMutation },
      text: { insert: documentMutation },
    },
    authoring: { setSelectionTarget, setSelectionByText: setSelectionTarget },
    mount: { container: document.createElement('div') },
    commands: { setActiveComment: clearReview },
    focus,
  };
  const commentsLayout = shallowRef<CommentsLayoutState>({
    requested: layout,
    effective: layout === 'inline' ? 'inline' : 'sidebar',
  });
  let layoutResolver: ((layout: CommentsLayout) => EffectiveCommentsLayout) | null = null;
  const superdoc = Object.assign(new EventEmitter(), {
    config,
    uiConfig: reactive(normalizeUiConfig(config)),
    getCommentsLayout: () => commentsLayout.value,
    setCommentsLayout(requested: CommentsLayout) {
      const effective =
        requested === 'auto' ? (layoutResolver?.(requested) ?? commentsLayout.value.effective) : requested;
      if (requested === commentsLayout.value.requested && effective === commentsLayout.value.effective) return;
      commentsLayout.value = Object.freeze({ requested, effective });
      superdoc.emit('comments-layout-change', commentsLayout.value);
    },
    activeEditor,
    setActiveEditor: vi.fn(),
    user: { name: 'Fixture author' },
    users: [],
    colors: [],
    broadcastSidebarToggle: vi.fn(),
    broadcastEditorCreate: vi.fn(),
    registerEditorRuntime: vi.fn<(_runtime: { getLegacyEditorProjection: () => unknown }) => void>(),
    unregisterEditorRuntime: vi.fn(),
    setActiveRuntime: vi.fn(),
  });
  registerCommentsLayoutBridge(superdoc, {
    setResolver(resolver) {
      layoutResolver = resolver;
      if (resolver) superdoc.setCommentsLayout(commentsLayout.value.requested);
    },
    setEffective(effective) {
      if (commentsLayout.value.requested !== 'auto' || commentsLayout.value.effective === effective) return;
      commentsLayout.value = Object.freeze({ requested: 'auto', effective });
      superdoc.emit('comments-layout-change', commentsLayout.value);
    },
  });
  superdoc.setActiveEditor.mockImplementation((editor) => Object.assign(superdoc, { activeEditor: editor }));
  superdoc.registerEditorRuntime.mockImplementation((runtime) => {
    Object.assign(superdoc, { activeEditor: runtime.getLegacyEditorProjection() });
  });
  const comments = useCommentsStore(pinia);
  comments.init({
    comments: [
      {
        commentId: 'thread-a',
        importedId: '17',
        fileId: 'doc-a',
        creatorName: 'Fabricated Reviewer',
        commentText: '<p>Fabricated review</p>',
      },
      { commentId: 'thread-b', importedId: '18', fileId: 'doc-a', commentText: '<p>Other review</p>' },
      {
        commentId: 'reply-a',
        importedId: '19',
        parentCommentId: 'thread-a',
        fileId: 'doc-a',
        commentText: '<p>Reply</p>',
      },
    ],
  });
  const container = document.createElement('div');
  let containerWidth = width;
  Object.defineProperty(container, 'clientWidth', { get: () => containerWidth });
  document.body.appendChild(container);
  containers.push(container);
  const wrapper = mount(SuperDoc, {
    attachTo: container,
    global: {
      plugins: [pinia],
      config: { globalProperties: { $superdoc: superdoc, $pinia: pinia } },
      stubs: {
        SurfaceHost: true,
        FloatingComments: true,
        CommentDialog: defineComponent({
          props: ['comment', 'parent'],
          setup: () => () => h('textarea', { 'data-reply-input': '' }),
        }),
      },
    },
  });
  mounted.push(wrapper);
  activeEditor.mount.container = wrapper.get<HTMLDivElement>('[data-native-mount]').element;
  await flushPromises();
  superdoc.emit('active-editor-change');
  comments.setActiveComment(null, 'thread-a');
  await flushPromises();
  clearReview.mockClear();
  expect(superdoc.getCommentsLayout()).toEqual({
    requested: layout,
    effective: layout === 'auto' ? (width < 1160 ? 'inline' : 'sidebar') : layout,
  });
  const editor = wrapper.findComponent({ name: 'InlineDismissalFixture' });
  const emit = (event: Record<string, unknown> = insertion()) => editor.vm.$emit('v2-host-event', event);
  const navigate = () => editor.vm.$emit('v2-selection-changed', { hasRangeSelection: false });
  const input = wrapper.get<HTMLTextAreaElement>('[data-document-input]').element;
  const keydown = (init: KeyboardEventInit, target: EventTarget = input) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true }));
  const installAuthoring = async (
    match: (_input: unknown) => Promise<unknown> = async () => ({ items: [{ target: caret(10).selectionTarget }] }),
    trackedChangesAdapter?: ReturnType<typeof reviewTargetSource>,
  ) => {
    const applying = deferredSelection();
    const apply = vi.fn(() => applying.promise);
    editor.vm.$emit('v2-editor-ready', {
      documentId: 'doc-a',
      host: {
        getHandles: () => ({ editing: { selectionTargets: { apply } } }),
        getSnapshot: () => ({ state: 'editing-ready', documentMode: 'editing' }),
        subscribe: () => () => {},
        getPageMetricsSnapshot: () => ({ pages: [], zoom: { percent: 100 } }),
      },
      documentApi: {
        ...activeEditor.doc,
        query: { match },
      },
      mount: activeEditor.mount,
      trackedChangesAdapter,
    });
    await flushPromises();
    return { applying, apply };
  };
  const cardVisible = () => wrapper.find('.superdoc__compact-comment-popover').exists();
  return {
    wrapper,
    editor,
    superdoc,
    store,
    comments,
    current,
    caretCurrent,
    focus,
    setSelectionTarget,
    documentMutation,
    clearReview,
    emit,
    navigate,
    input,
    keydown,
    installAuthoring,
    async resize(nextWidth: number) {
      containerWidth = nextWidth;
      window.dispatchEvent(new Event('resize'));
      await flushPromises();
    },
    cardVisible,
  };
}

describe('inline existing comment dismissal after native document typing', () => {
  it.each(['inline', 'auto'] satisfies ('inline' | 'auto')[])(
    'dismisses an outside card with effective %s presentation',
    async (layout) => {
      const fixture = await mountShell(layout);
      expect(fixture.cardVisible()).toBe(true);
      fixture.emit();
      await flushPromises();
      expect(fixture.comments.activeComment).toBeNull();
      expect(fixture.cardVisible()).toBe(false);
      expect(fixture.current).toHaveBeenCalledExactlyOnceWith({ includeText: false });
    },
  );

  it('keeps navigation alone unchanged and dismisses when typing follows outside navigation', async () => {
    const fixture = await mountShell();
    fixture.navigate();
    await flushPromises();
    expect(fixture.cardVisible()).toBe(true);
    expect(fixture.current).not.toHaveBeenCalled();
    fixture.emit();
    await flushPromises();
    expect(fixture.cardVisible()).toBe(false);
  });

  it('keeps a dismissed card closed when the pending caret activation later returns its old thread', async () => {
    const fixture = await mountShell();
    const membership = deferredSelection();
    const activation = deferredSelection();
    fixture.current.mockReturnValue(membership.promise);
    fixture.caretCurrent.mockReturnValue(activation.promise);
    fixture.emit();
    fixture.navigate();
    expect(fixture.current).toHaveBeenCalledExactlyOnceWith({ includeText: false });
    expect(fixture.caretCurrent).toHaveBeenCalledExactlyOnceWith();
    membership.complete(caret(13));
    await flushPromises();
    expect(fixture.cardVisible()).toBe(false);
    activation.complete(caret(10, ['17']));
    await flushPromises();
    expect(fixture.comments.activeComment).toBeNull();
    expect(fixture.cardVisible()).toBe(false);
    expect(fixture.documentMutation).not.toHaveBeenCalled();
  });

  it.each([
    ['interior', 10],
    ['touching start', 7],
    ['touching end', 12],
  ])('retains the active thread for canonical %s membership', async (_name, offset) => {
    const fixture = await mountShell();
    fixture.current.mockReturnValue(caret(Number(offset), ['thread-a']));
    fixture.emit();
    await flushPromises();
    expect(fixture.cardVisible()).toBe(true);
    expect(fixture.comments.activeComment).toBe('thread-a');
  });

  it('matches imported aliases and retains overlapping membership in the active thread', async () => {
    const fixture = await mountShell();
    fixture.current.mockReturnValue(caret(12, ['thread-b', '17', '19']));
    fixture.emit();
    await flushPromises();
    expect(fixture.comments.activeComment).toBe('thread-a');
    expect(fixture.cardVisible()).toBe(true);
  });

  it('matches a reply alias to its root thread', async () => {
    const fixture = await mountShell();
    fixture.current.mockReturnValue(caret(12, ['19']));
    fixture.emit();
    await flushPromises();
    expect(fixture.comments.activeComment).toBe('thread-a');
  });

  it('dismisses the previous thread when only a neighboring thread is touched', async () => {
    const fixture = await mountShell();
    fixture.current.mockReturnValue(caret(16, ['18']));
    fixture.emit();
    await flushPromises();
    expect(fixture.comments.activeComment).toBeNull();
    expect(fixture.cardVisible()).toBe(false);
  });

  it('preserves document focus, caret, comment models and content, and allows reopening', async () => {
    const fixture = await mountShell();
    const input = fixture.wrapper.get<HTMLTextAreaElement>('[data-document-input]').element;
    input.value = 'Before BRAVO xyz after.';
    input.focus();
    input.setSelectionRange(16, 16);
    const original = fixture.comments.commentsList.map((comment) => comment.getValues());
    const models = [...fixture.comments.commentsList];
    const focus = vi.spyOn(input, 'focus');
    fixture.emit();
    await flushPromises();
    expect(fixture.cardVisible()).toBe(false);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('Before BRAVO xyz after.');
    expect([input.selectionStart, input.selectionEnd]).toEqual([16, 16]);
    expect(focus).not.toHaveBeenCalled();
    expect(fixture.focus).not.toHaveBeenCalled();
    expect(fixture.setSelectionTarget).not.toHaveBeenCalled();
    expect(fixture.documentMutation).not.toHaveBeenCalled();
    expect(fixture.comments.commentsList.map((comment) => comment.getValues())).toEqual(original);
    expect(fixture.comments.commentsList).toEqual(models);
    fixture.emit({ type: 'reviewTarget:changed', next: { entityType: 'comment', entityId: '17', origin: 'document' } });
    await flushPromises();
    expect(fixture.comments.activeComment).toBe('thread-a');
    expect(fixture.cardVisible()).toBe(true);
  });

  it.each([
    ['sidebar', 900],
    ['auto', 1600],
  ] satisfies ['sidebar' | 'auto', number][])(
    'preserves %s sidebar policy without ready geometry',
    async (layout, width) => {
      const fixture = await mountShell(layout, width);
      fixture.emit();
      await flushPromises();
      expect(fixture.comments.activeComment).toBe('thread-a');
      expect(fixture.current).not.toHaveBeenCalled();
    },
  );

  it.each(['pending', 'reply', 'disabled', 'tracked-change', 'pdf', 'other-document'])(
    'preserves %s presentation',
    async (kind) => {
      const fixture = await mountShell();
      const comment = fixture.comments.getComment('thread-a');
      if (!comment) throw new Error('Missing fabricated comment');
      if (kind === 'pending')
        fixture.comments.pendingComment = reactive(useComment({ commentId: 'draft-a', fileId: 'doc-a' }));
      if (kind === 'reply') fixture.wrapper.get<HTMLTextAreaElement>('[data-reply-input]').element.focus();
      if (kind === 'disabled') fixture.store.modules.comments = false;
      if (kind === 'tracked-change') comment.trackedChange = true;
      if (kind === 'pdf') comment.selection.source = 'pdf';
      if (kind === 'other-document') fixture.superdoc.activeEditor.options.documentId = 'doc-b';
      await nextTick();
      fixture.emit();
      await flushPromises();
      expect(fixture.comments.activeComment).toBe('thread-a');
      expect(fixture.current).not.toHaveBeenCalled();
      if (kind === 'pending') expect(fixture.comments.pendingComment?.commentId).toBe('draft-a');
    },
  );

  it.each([
    { dryRun: true },
    { cause: 'preview' },
    { cause: 'api' },
    { origin: 'extension' },
    { origin: 'history' },
    { origin: 'remote' },
    { editableCommandKind: 'delete-backward' },
    { editableCommandKind: 'comment-update' },
    { type: 'mutation:rejected' },
    { receipt: { success: true, changed: false } },
    { receipt: { success: true, noop: true } },
    { receipt: { success: true, status: 'NO_OP' } },
    { receipt: { success: false } },
    { receipt: { ok: false } },
    { result: { noop: true } },
  ])('ignores nonqualifying input %j', async (event) => {
    const fixture = await mountShell();
    fixture.emit(insertion(event));
    await flushPromises();
    expect(fixture.cardVisible()).toBe(true);
    expect(fixture.current).not.toHaveBeenCalled();
  });

  it.each([
    null,
    undefined,
    { empty: true, activeCommentIds: [] },
    { ...caret(), target: null, selectionTarget: null },
    { ...caret(), empty: false },
    { ...caret(), activeCommentIds: undefined },
    { ...caret(), activeCommentIds: [42] },
    { ...caret(), selectionTarget: { kind: 'selection', start: { kind: 'text' }, end: { kind: 'text' } } },
    {
      ...caret(),
      selectionTarget: null,
      target: { kind: 'text', segments: [{ blockId: 'p', range: { start: 2, end: 5 } }] },
    },
    { ...caret(), target: { kind: 'text', segments: [] }, selectionTarget: null },
  ])('keeps a card for an unavailable or non-caret selection %j', async (selection) => {
    const fixture = await mountShell();
    fixture.current.mockReturnValue(selection);
    fixture.emit();
    await flushPromises();
    expect(fixture.cardVisible()).toBe(true);
  });

  it('uses a collapsed text target when the optional selection envelope is unavailable', async () => {
    const fixture = await mountShell();
    fixture.current.mockReturnValue({ ...caret(), selectionTarget: null });
    fixture.emit();
    await flushPromises();
    expect(fixture.cardVisible()).toBe(false);
  });

  it.each(['throw', 'reject'])('keeps the card when selection reads %s', async (mode) => {
    const fixture = await mountShell();
    fixture.current.mockImplementation(() => {
      if (mode === 'throw') throw new Error('Selection unavailable');
      return Promise.reject(new Error('Selection unavailable'));
    });
    fixture.emit();
    await flushPromises();
    expect(fixture.cardVisible()).toBe(true);
  });

  it('accepts a promised post-insertion selection', async () => {
    const fixture = await mountShell();
    fixture.current.mockResolvedValue(caret());
    fixture.emit();
    await flushPromises();
    expect(fixture.cardVisible()).toBe(false);
  });

  it.each([
    ['inline', false, 'fallback'],
    ['auto', false, 'fallback'],
    ['inline', true, 'fallback'],
    ['auto', true, 'fallback'],
    ['inline', false, 'sync'],
    ['auto', false, 'sync'],
    ['inline', true, 'sync'],
    ['auto', true, 'sync'],
  ] satisfies ['inline' | 'auto', boolean, 'sync' | 'fallback'][])(
    'keeps the first insertion read in %s layout when the caret clears the review target=%s through %s',
    async (layout, clearsReviewTarget, path) => {
      const fixture = await mountShell(layout);
      if (path === 'sync') await fixture.installAuthoring(undefined, reviewTargetSource());
      const original = fixture.comments.commentsList.map((comment) => comment.getValues());
      const pending = deferredSelection();
      const input = fixture.wrapper.get<HTMLTextAreaElement>('[data-document-input]').element;
      input.value = 'Before BRAVOx';
      input.focus();
      input.setSelectionRange(13, 13);
      fixture.current.mockReturnValue(pending.promise);
      fixture.emit();
      expect(fixture.current).toHaveBeenCalledExactlyOnceWith({ includeText: false });
      fixture.emit({
        type: 'history:changed',
        state: { undoDepth: 1, redoDepth: 0, canUndo: true, canRedo: false },
      });
      fixture.editor.vm.$emit('v2-selection-changed', {
        hasRangeSelection: false,
        snapshot: {
          anchor: { blockId: 'paragraph-a', blockOffset: 13 },
          focus: { blockId: 'paragraph-a', blockOffset: 13 },
        },
      });
      if (clearsReviewTarget)
        fixture.emit({
          type: 'reviewTarget:changed',
          previous: { entityType: 'comment', entityId: '17', origin: 'document' },
          next: null,
          reason: 'caret-move',
        });
      await flushPromises();
      expect(fixture.cardVisible()).toBe(true);
      pending.complete(caret(13));
      await flushPromises();
      expect(fixture.comments.activeComment).toBeNull();
      expect(fixture.cardVisible()).toBe(false);
      expect(fixture.current).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(input);
      expect(input.value).toBe('Before BRAVOx');
      expect([input.selectionStart, input.selectionEnd]).toEqual([13, 13]);
      expect(fixture.documentMutation).not.toHaveBeenCalled();
      expect(fixture.comments.commentsList.map((comment) => comment.getValues())).toEqual(original);
    },
  );

  it.each(['undo', 'redo'])('retires a pending insertion read after a genuine %s commit', async (direction) => {
    const fixture = await mountShell();
    const pending = deferredSelection();
    fixture.current.mockReturnValue(pending.promise);
    fixture.emit();
    fixture.emit({
      type: 'mutation:committed',
      origin: 'history',
      direction,
      receipt: { success: true, txId: 'fixture-history' },
    });
    pending.complete(caret());
    await flushPromises();
    expect(fixture.comments.activeComment).toBe('thread-a');
    expect(fixture.cardVisible()).toBe(true);
    expect(fixture.current).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])(
    'handles a selection signal before the slow membership read when matching=%s',
    async (matching) => {
      const fixture = await mountShell();
      const pending = deferredSelection();
      fixture.current.mockReturnValueOnce(pending.promise).mockReturnValue(caret(10, ['17']));
      fixture.emit();
      fixture.editor.vm.$emit('v2-selection-changed', {
        hasRangeSelection: false,
        snapshot: {
          anchor: { blockId: 'paragraph-a', blockOffset: matching ? 16 : 10 },
          focus: { blockId: 'paragraph-a', blockOffset: matching ? 16 : 10 },
        },
      });
      pending.complete(caret());
      await flushPromises();
      expect(fixture.cardVisible()).toBe(!matching);
      expect(fixture.current).toHaveBeenCalledTimes(matching ? 1 : 2);
    },
  );

  it('handles the observed native ordering: mutation, promised membership, then delayed selection signal', async () => {
    const fixture = await mountShell();
    fixture.current.mockResolvedValue(caret());
    fixture.emit();
    await flushPromises();
    fixture.navigate();
    await flushPromises();
    expect(fixture.cardVisible()).toBe(false);
  });

  it.each(['Shift', 'Control', 'Alt', 'Meta'])(
    'keeps a pending insertion read when only the %s modifier is pressed',
    async (key) => {
      const fixture = await mountShell();
      const pending = deferredSelection();
      fixture.current.mockReturnValue(pending.promise);
      fixture.emit();
      document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      pending.complete(caret(13));
      await flushPromises();
      expect(fixture.comments.activeComment).toBeNull();
      expect(fixture.cardVisible()).toBe(false);
      expect(fixture.current).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    { key: 'ArrowLeft' },
    { key: 'ArrowLeft', shiftKey: true },
    { key: 'Home' },
    { key: 'End' },
    { key: 'PageUp' },
    { key: 'PageDown' },
    { key: 'a', metaKey: true },
    { key: 'a', ctrlKey: true },
    { key: 'Tab' },
    { key: 'z', metaKey: true },
    { key: 'z', ctrlKey: true, shiftKey: true },
  ])('retires a pending read on navigation or shortcut %j before its selection signal arrives', async (key) => {
    const fixture = await mountShell();
    fixture.input.focus();
    const pending = deferredSelection();
    fixture.current.mockReturnValue(pending.promise);
    fixture.emit();
    fixture.keydown(key);
    pending.complete(caret());
    await flushPromises();
    expect(fixture.cardVisible()).toBe(true);
  });

  it('does not read or dismiss a comment scoped to another document', async () => {
    const fixture = await mountShell();
    fixture.comments.init({
      comments: [{ commentId: 'thread-a', fileId: 'doc-b', commentText: '<p>Other document</p>' }],
    });
    await nextTick();
    fixture.emit();
    await flushPromises();
    expect(fixture.comments.activeComment).toBe('thread-a');
    expect(fixture.current).not.toHaveBeenCalled();
  });

  it.each([
    'switch',
    'reopen',
    'navigation',
    'layout',
    'editor',
    'document',
    'draft',
    'reply',
    'render-clear',
    'unmount',
  ])('ignores a delayed outside read after %s changes ownership', async (change) => {
    const fixture = await mountShell();
    const pending = deferredSelection();
    fixture.current.mockReturnValue(pending.promise);
    fixture.emit();
    await nextTick();
    if (change === 'switch') fixture.comments.setActiveComment(null, 'thread-b');
    if (change === 'reopen') {
      fixture.comments.setActiveComment(null, null);
      fixture.comments.setActiveComment(null, 'thread-a');
    }
    if (change === 'navigation') {
      fixture.keydown({ key: 'ArrowLeft' });
      fixture.navigate();
    }
    if (change === 'layout') fixture.superdoc.setCommentsLayout('sidebar');
    if (change === 'editor') fixture.superdoc.activeEditor = { ...fixture.superdoc.activeEditor };
    if (change === 'document') fixture.superdoc.activeEditor.documentId = 'doc-b';
    if (change === 'draft')
      fixture.comments.pendingComment = reactive(useComment({ commentId: 'draft-a', fileId: 'doc-a' }));
    if (change === 'reply') fixture.wrapper.get<HTMLTextAreaElement>('[data-reply-input]').element.focus();
    if (change === 'render-clear') fixture.editor.vm.$emit('v2-render-cleared', { documentId: 'doc-a' });
    if (change === 'unmount') fixture.wrapper.unmount();
    await nextTick();
    fixture.clearReview.mockClear();
    pending.complete(caret());
    await flushPromises();
    expect(fixture.comments.activeComment).toBe(change === 'switch' ? 'thread-b' : 'thread-a');
    expect(fixture.clearReview).not.toHaveBeenCalled();
  });

  it('ignores a superseded typing read and lets the latest insertion decide', async () => {
    const fixture = await mountShell();
    const first = deferredSelection();
    const latest = deferredSelection();
    fixture.current.mockReturnValueOnce(first.promise).mockReturnValueOnce(latest.promise);
    fixture.emit();
    fixture.emit();
    first.complete(caret());
    latest.complete(caret(10, ['17']));
    await flushPromises();
    expect(fixture.comments.activeComment).toBe('thread-a');
    expect(fixture.cardVisible()).toBe(true);
  });
});

describe('semantic typing intent and membership freshness', () => {
  it.each([
    ['MacIntel', { key: 'Backspace' }, true],
    ['MacIntel', { key: 'Delete' }, true],
    ['MacIntel', { key: 'Backspace', altKey: true }, true],
    ['MacIntel', { key: 'Delete', altKey: true }, true],
    ['MacIntel', { key: 'Backspace', metaKey: true }, true],
    ['MacIntel', { key: 'Enter' }, true],
    ['MacIntel', { key: 'Enter', shiftKey: true }, true],
    ['MacIntel', { key: 'Enter', metaKey: true }, true],
    ['Linux x86_64', { key: 'Backspace', ctrlKey: true }, true],
    ['Linux x86_64', { key: 'Delete', ctrlKey: true }, true],
    ['MacIntel', { key: 'Backspace', ctrlKey: true }, false],
    ['MacIntel', { key: 'Backspace', shiftKey: true }, false],
    ['MacIntel', { key: 'Delete', metaKey: true }, false],
    ['Linux x86_64', { key: 'Backspace', altKey: true }, false],
    ['Linux x86_64', { key: 'Delete', shiftKey: true }, false],
    ['Linux x86_64', { key: 'Backspace', metaKey: true }, false],
  ] satisfies [string, KeyboardEventInit, boolean][])(
    'fences only admitted native editing on %s %j before commit when admitted=%s',
    async (platform, key, admitted) => {
      vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue(platform);
      const fixture = await mountShell();
      fixture.input.value = 'Before BRAVOx';
      fixture.input.focus();
      fixture.input.setSelectionRange(13, 13);
      const old = deferredSelection();
      fixture.current.mockReturnValueOnce(old.promise).mockReturnValue(caret(12, ['17']));
      fixture.emit();
      fixture.keydown(key);
      if (admitted && key.key === 'Backspace') {
        fixture.input.value = 'Before BRAVO';
        fixture.input.setSelectionRange(12, 12);
      }
      old.complete(caret(13));
      await flushPromises();
      expect(fixture.cardVisible()).toBe(admitted);
      expect(fixture.current).toHaveBeenCalledTimes(1);
      expect(fixture.documentMutation).not.toHaveBeenCalled();
      expect(fixture.setSelectionTarget).not.toHaveBeenCalled();
      if (admitted && key.key === 'Backspace') {
        expect(fixture.input.value).toBe('Before BRAVO');
        expect([fixture.input.selectionStart, fixture.input.selectionEnd]).toEqual([12, 12]);
      }
    },
  );

  it.each([
    ['inline', 'CapsLock'],
    ['auto', 'CapsLock'],
    ['inline', 'NumLock'],
    ['inline', 'F1'],
  ] satisfies ['inline' | 'auto', string][])(
    'preserves outside typing through a nonmoving %s %s key',
    async (layout, key) => {
      const fixture = await mountShell(layout);
      fixture.input.value = 'Before BRAVOx';
      fixture.input.focus();
      fixture.input.setSelectionRange(13, 13);
      const pending = deferredSelection();
      fixture.current.mockReturnValue(pending.promise);
      fixture.emit();
      fixture.keydown({ key });
      pending.complete(caret(13));
      await flushPromises();
      expect(fixture.cardVisible()).toBe(false);
      expect(fixture.current).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(fixture.input);
      expect(fixture.input.value).toBe('Before BRAVOx');
      expect([fixture.input.selectionStart, fixture.input.selectionEnd]).toEqual([13, 13]);
      expect(fixture.documentMutation).not.toHaveBeenCalled();
    },
  );

  it.each(['inline', 'auto'] satisfies ('inline' | 'auto')[])(
    'refreshes %s membership after unrelated remote changes without overlapping reads',
    async (layout) => {
      const fixture = await mountShell(layout);
      const old = deferredSelection();
      const fresh = deferredSelection();
      fixture.current.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
      fixture.emit();
      fixture.emit(remoteChange());
      fixture.emit(remoteChange());
      expect(fixture.current).toHaveBeenCalledTimes(1);
      old.complete(caret(13));
      await flushPromises();
      expect(fixture.cardVisible()).toBe(true);
      expect(fixture.current).toHaveBeenCalledTimes(2);
      fresh.complete(caret(13));
      await flushPromises();
      expect(fixture.cardVisible()).toBe(false);
      expect(fixture.current).toHaveBeenNthCalledWith(2, { includeText: false });
    },
  );

  it.each([true, false])('uses fresh membership at unchanged coordinates when it now touches=%s', async (touches) => {
    const fixture = await mountShell();
    const old = deferredSelection();
    fixture.current.mockReturnValueOnce(old.promise).mockReturnValue(caret(13, touches ? ['17'] : []));
    fixture.emit();
    fixture.emit(remoteChange());
    old.complete(caret(13, touches ? [] : ['17']));
    await flushPromises();
    expect(fixture.current).toHaveBeenCalledTimes(2);
    expect(fixture.cardVisible()).toBe(touches);
    fixture.emit(remoteChange());
    await flushPromises();
    expect(fixture.current).toHaveBeenCalledTimes(2);
  });

  it.each(['before replacement', 'during replacement'])(
    'refreshes originless remapped selection arriving %s',
    async (ordering) => {
      const fixture = await mountShell();
      const old = deferredSelection();
      const fresh = deferredSelection();
      fixture.current.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise).mockReturnValue(caret(14));
      fixture.emit();
      fixture.emit(remoteChange());
      if (ordering === 'before replacement') fixture.editor.vm.$emit('v2-selection-changed', selectionSignal(14));
      old.complete(caret(13, ['17']));
      await flushPromises();
      expect(fixture.current).toHaveBeenCalledTimes(2);
      if (ordering === 'during replacement') fixture.editor.vm.$emit('v2-selection-changed', selectionSignal(14));
      fresh.complete(caret(ordering === 'during replacement' ? 13 : 14));
      await flushPromises();
      expect(fixture.cardVisible()).toBe(false);
      expect(fixture.current).toHaveBeenCalledTimes(ordering === 'during replacement' ? 3 : 2);
    },
  );

  it('coalesces another remote burst during the replacement into one further read', async () => {
    const fixture = await mountShell();
    const old = deferredSelection();
    const next = deferredSelection();
    const final = deferredSelection();
    fixture.current
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(next.promise)
      .mockReturnValueOnce(final.promise);
    fixture.emit();
    fixture.emit(remoteChange());
    old.complete(caret());
    await flushPromises();
    fixture.emit(remoteChange());
    fixture.emit(remoteChange());
    expect(fixture.current).toHaveBeenCalledTimes(2);
    next.complete(caret());
    await flushPromises();
    expect(fixture.current).toHaveBeenCalledTimes(3);
    expect(fixture.cardVisible()).toBe(true);
    final.complete(caret());
    await flushPromises();
    expect(fixture.cardVisible()).toBe(false);
  });

  describe.each(['sync', 'fallback'])('mounted review target %s composition', (path) => {
    it.each(['user-click', 'panel-focus', 'history', 'dispose'])(
      'retires a pending insertion after %s without rereading',
      async (reason) => {
        const fixture = await mountShell();
        if (path === 'sync') await fixture.installAuthoring(undefined, reviewTargetSource());
        const original = fixture.comments.commentsList.map((comment) => comment.getValues());
        const pending = deferredSelection();
        fixture.input.value = 'Before BRAVOx';
        fixture.input.focus();
        fixture.input.setSelectionRange(13, 13);
        fixture.current.mockReturnValue(pending.promise);
        fixture.emit();
        fixture.emit({
          type: 'reviewTarget:changed',
          next: { entityType: 'comment', entityId: '17', origin: 'document' },
          reason,
        });
        pending.complete(caret(13));
        await flushPromises();
        expect(fixture.comments.activeComment).toBe('thread-a');
        expect(fixture.cardVisible()).toBe(true);
        expect(fixture.current).toHaveBeenCalledTimes(1);
        expect(document.activeElement).toBe(fixture.input);
        expect(fixture.input.value).toBe('Before BRAVOx');
        expect([fixture.input.selectionStart, fixture.input.selectionEnd]).toEqual([13, 13]);
        expect(fixture.documentMutation).not.toHaveBeenCalled();
        expect(fixture.comments.commentsList.map((comment) => comment.getValues())).toEqual(original);
      },
    );

    it.each(['receipt-invalidate', 'receipt-remap'])(
      'refreshes derived review data after %s without retiring typing',
      async (reason) => {
        const fixture = await mountShell();
        if (path === 'sync') await fixture.installAuthoring(undefined, reviewTargetSource());
        const original = fixture.comments.commentsList.map((comment) => comment.getValues());
        const old = deferredSelection();
        const fresh = deferredSelection();
        fixture.input.value = 'Before BRAVOx';
        fixture.input.focus();
        fixture.input.setSelectionRange(13, 13);
        fixture.current.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
        fixture.emit();
        fixture.emit({ type: 'reviewTarget:changed', next: null, reason });
        old.complete(caret(10, ['17']));
        await flushPromises();
        expect(fixture.current).toHaveBeenCalledTimes(2);
        expect(fixture.cardVisible()).toBe(true);
        fresh.complete(caret(13));
        await flushPromises();
        expect(fixture.current).toHaveBeenCalledTimes(2);
        expect(fixture.cardVisible()).toBe(false);
        expect(fixture.comments.activeComment).toBeNull();
        expect(document.activeElement).toBe(fixture.input);
        expect(fixture.input.value).toBe('Before BRAVOx');
        expect([fixture.input.selectionStart, fixture.input.selectionEnd]).toEqual([13, 13]);
        expect(fixture.documentMutation).not.toHaveBeenCalled();
        expect(fixture.comments.commentsList.map((comment) => comment.getValues())).toEqual(original);
      },
    );
  });

  it('joins mounted move-side events and listener updates and removes replaced subscriptions', async () => {
    const fixture = await mountShell();
    const source = reviewTargetSource();
    await fixture.installAuthoring(undefined, source);
    expect(source.listenerCount()).toBe(1);
    const move = 'tc|body|move|fabricated-pair';
    const from = `${move}::move-from`;
    const to = `${move}::move-to`;
    fixture.comments.init({
      comments: [from, to].map((commentId) => ({
        commentId,
        fileId: 'doc-a',
        trackedChange: true,
        trackedChangeCanonicalId: move,
        commentText: '<p>Fabricated move</p>',
      })),
    });
    const activations: (string | null)[] = [];
    const stop = watch(
      () => fixture.comments.activeComment,
      (id) => activations.push(id),
      { flush: 'sync' },
    );
    const target = { entityType: 'trackedChange', entityId: move, origin: 'document' };
    source.publish({ ...target, paintedEntityId: from });
    expect(activations).toEqual([]);
    fixture.emit({ type: 'reviewTarget:changed', next: target, reason: 'user-click' });
    expect(fixture.comments.activeComment).toBe(from);
    source.publish({ ...target, paintedEntityId: to });
    expect(fixture.comments.activeComment).toBe(to);
    source.publish({ ...target, paintedEntityId: from });
    expect(fixture.comments.activeComment).toBe(from);
    expect(activations).toEqual([from, to, from]);
    source.publish({ ...target, origin: 'panel', paintedEntityId: to });
    fixture.emit({ type: 'reviewTarget:changed', next: { ...target, origin: 'panel' }, reason: 'panel-focus' });
    expect(activations).toEqual([from, to, from]);
    const replacement = reviewTargetSource();
    await fixture.installAuthoring(undefined, replacement);
    expect(source.listenerCount()).toBe(0);
    expect(replacement.listenerCount()).toBe(1);
    source.publish({ ...target, paintedEntityId: to });
    expect(activations).toEqual([from, to, from]);
    fixture.wrapper.unmount();
    expect(replacement.listenerCount()).toBe(0);
    expect(fixture.documentMutation).not.toHaveBeenCalled();
    stop();
  });

  it('retires a held outside read when measured auto layout changes from inline to sidebar', async () => {
    const resizeNotifications = new Set<() => void>();
    vi.spyOn(window, 'ResizeObserver').mockImplementation(function (callback) {
      const notify = () => callback([], observer);
      const observer = {
        observe: () => resizeNotifications.add(notify),
        unobserve: () => {},
        disconnect: () => resizeNotifications.delete(notify),
      };
      return observer;
    });
    const fixture = await mountShell('auto', 900);
    const pending = deferredSelection();
    const original = fixture.comments.commentsList.map((comment) => comment.getValues());
    fixture.input.value = 'Before BRAVOx';
    fixture.input.focus();
    fixture.input.setSelectionRange(13, 13);
    fixture.current.mockReturnValue(pending.promise);
    fixture.emit();
    await fixture.resize(1600);
    expect(resizeNotifications.size).toBeGreaterThan(0);
    for (const notify of resizeNotifications) notify();
    await flushPromises();
    expect(fixture.superdoc.getCommentsLayout()).toEqual({ requested: 'auto', effective: 'sidebar' });
    pending.complete(caret(13));
    await flushPromises();
    expect(fixture.comments.activeComment).toBe('thread-a');
    expect(fixture.clearReview).not.toHaveBeenCalled();
    expect(fixture.current).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(fixture.input);
    expect(fixture.input.value).toBe('Before BRAVOx');
    expect([fixture.input.selectionStart, fixture.input.selectionEnd]).toEqual([13, 13]);
    expect(fixture.documentMutation).not.toHaveBeenCalled();
    expect(fixture.comments.commentsList.map((comment) => comment.getValues())).toEqual(original);
  });

  it.each([
    { type: 'mutation:rejected' },
    insertion({ receipt: { success: false } }),
    insertion({ receipt: { ok: false } }),
    insertion({ receipt: { success: true, changed: false } }),
    insertion({ receipt: { success: true, status: 'NO_OP' } }),
    insertion({ result: { noop: true } }),
    insertion({ dryRun: true }),
    insertion({ cause: 'preview' }),
    { type: 'history:changed', state: { undoDepth: 1, redoDepth: 0 } },
    { type: 'render:progress' },
  ])('ignores a notification without a new changed action %j', async (event) => {
    const fixture = await mountShell();
    const pending = deferredSelection();
    fixture.current.mockReturnValue(pending.promise);
    fixture.emit();
    fixture.emit(event);
    pending.complete(caret());
    await flushPromises();
    expect(fixture.cardVisible()).toBe(false);
    expect(fixture.current).toHaveBeenCalledTimes(1);
  });

  it.each(['remote', 'mutation', 'review', 'replacement'])(
    'ignores a foreign document %s while reconciling this document',
    async (kind) => {
      const fixture = await mountShell();
      const documentA = fixture.store.documents[0];
      if (!documentA) throw new Error('Missing fabricated document');
      fixture.store.documents.push({ ...documentA, id: 'doc-b' });
      await flushPromises();
      const pending = deferredSelection();
      fixture.current.mockReturnValue(pending.promise);
      fixture.emit();
      const foreign = fixture.wrapper.findAllComponents({ name: 'InlineDismissalFixture' })[1];
      if (!foreign) throw new Error('Missing foreign document surface');
      const event =
        kind === 'remote'
          ? remoteChange()
          : kind === 'mutation'
            ? insertion({ editableCommandKind: 'delete-backward' })
            : kind === 'review'
              ? { type: 'reviewTarget:changed', next: null, reason: 'panel-focus' }
              : { type: 'collaboration:document-replaced' };
      foreign.vm.$emit('v2-host-event', event);
      pending.complete(caret());
      await flushPromises();
      expect(fixture.cardVisible()).toBe(false);
      expect(fixture.current).toHaveBeenCalledTimes(1);
    },
  );

  it('services a dirty rejected response and terminates on a current rejected response', async () => {
    const fixture = await mountShell();
    const old = deferredSelection();
    fixture.current.mockReturnValueOnce(old.promise).mockRejectedValue(new Error('Fresh selection unavailable'));
    fixture.emit();
    fixture.emit(remoteChange());
    old.reject(new Error('Old selection unavailable'));
    await flushPromises();
    expect(fixture.current).toHaveBeenCalledTimes(2);
    expect(fixture.cardVisible()).toBe(true);
    await flushPromises();
    expect(fixture.current).toHaveBeenCalledTimes(2);
  });

  it('queues synchronous invalidation instead of recursively reading', async () => {
    const fixture = await mountShell();
    let depth = 0;
    let maximumDepth = 0;
    fixture.current.mockImplementation(() => {
      depth++;
      maximumDepth = Math.max(maximumDepth, depth);
      if (fixture.current.mock.calls.length === 1) fixture.emit(remoteChange());
      depth--;
      return caret();
    });
    fixture.emit();
    await flushPromises();
    expect(fixture.current).toHaveBeenCalledTimes(2);
    expect(maximumDepth).toBe(1);
    expect(fixture.cardVisible()).toBe(false);
  });

  it.each(['navigation', 'reopen', 'undo', 'unmount', 'editor-roundtrip', 'document-replaced'])(
    'never restarts a dirty intent retired by %s',
    async (action) => {
      const fixture = await mountShell();
      const old = deferredSelection();
      fixture.current.mockReturnValue(old.promise);
      fixture.emit();
      fixture.emit(remoteChange());
      if (action === 'navigation') fixture.keydown({ key: 'ArrowLeft' });
      if (action === 'reopen')
        fixture.emit({
          type: 'reviewTarget:changed',
          next: { entityType: 'comment', entityId: '17', origin: 'document' },
          reason: 'user-click',
        });
      if (action === 'undo') fixture.emit(insertion({ origin: 'history', direction: 'undo' }));
      if (action === 'unmount') fixture.wrapper.unmount();
      if (action === 'editor-roundtrip') {
        const original = fixture.superdoc.activeEditor;
        fixture.superdoc.activeEditor = { ...original };
        fixture.superdoc.emit('active-editor-change');
        fixture.superdoc.activeEditor = original;
        fixture.superdoc.emit('active-editor-change');
      }
      if (action === 'document-replaced') fixture.emit({ type: 'collaboration:document-replaced' });
      old.complete(caret());
      await flushPromises();
      expect(fixture.current).toHaveBeenCalledTimes(1);
      expect(fixture.comments.activeComment).toBe('thread-a');
    },
  );

  it.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ])('only newest typing decides with oldFirst=%s and latestTouches=%s', async (oldFirst, latestTouches) => {
    const fixture = await mountShell();
    const old = deferredSelection();
    const latest = deferredSelection();
    fixture.current.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    fixture.emit();
    fixture.emit(remoteChange());
    fixture.emit();
    if (oldFirst) old.complete(caret(13, latestTouches ? [] : ['17']));
    latest.complete(caret(13, latestTouches ? ['17'] : []));
    await flushPromises();
    if (!oldFirst) old.complete(caret(13, latestTouches ? [] : ['17']));
    await flushPromises();
    expect(fixture.cardVisible()).toBe(latestTouches);
    expect(fixture.current).toHaveBeenCalledTimes(2);
  });

  it('does not run an already queued refresh after navigation retires it', async () => {
    const fixture = await mountShell();
    const old = deferredSelection();
    fixture.current.mockReturnValue(old.promise);
    fixture.emit();
    fixture.emit(remoteChange());
    old.complete(caret());
    await Promise.resolve();
    fixture.keydown({ key: 'ArrowLeft' });
    await flushPromises();
    expect(fixture.current).toHaveBeenCalledTimes(1);
    expect(fixture.cardVisible()).toBe(true);
  });

  it.each([{ editableCommandKind: 'delete-backward' }, { origin: 'extension' }, { cause: 'api' }])(
    'retires pending typing for an actual later changed action %j',
    async (event) => {
      const fixture = await mountShell();
      const old = deferredSelection();
      fixture.current.mockReturnValue(old.promise);
      fixture.emit();
      fixture.emit(insertion(event));
      old.complete(caret());
      await flushPromises();
      expect(fixture.current).toHaveBeenCalledTimes(1);
      expect(fixture.cardVisible()).toBe(true);
    },
  );

  it.each([
    { key: 'ArrowLeft', isComposing: true },
    { key: 'Backspace', isComposing: true },
    { key: 'Enter', isComposing: true },
    { key: 'ArrowLeft', keyCode: 229 },
    { key: 'Dead' },
    { key: 'f', metaKey: true },
    { key: 'f', ctrlKey: true },
  ])('preserves typing for native-ineligible or unavailable shortcut %j', async (init) => {
    const fixture = await mountShell();
    const old = deferredSelection();
    fixture.current.mockReturnValue(old.promise);
    fixture.emit();
    fixture.keydown(init);
    old.complete(caret());
    await flushPromises();
    expect(fixture.cardVisible()).toBe(false);
  });

  it.each(['foreign', 'document', 'prevented'])(
    'ignores navigation keys on %s surfaces or already prevented events',
    async (kind) => {
      const fixture = await mountShell();
      const old = deferredSelection();
      fixture.current.mockReturnValue(old.promise);
      fixture.emit();
      const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
      if (kind === 'prevented') event.preventDefault();
      const target =
        kind === 'foreign'
          ? fixture.wrapper.get('[data-foreign-input]').element
          : kind === 'document'
            ? document
            : fixture.input;
      target.dispatchEvent(event);
      old.complete(caret());
      await flushPromises();
      expect(fixture.cardVisible()).toBe(false);
    },
  );

  it('recognizes navigation on the native mount container', async () => {
    const fixture = await mountShell();
    const old = deferredSelection();
    fixture.current.mockReturnValue(old.promise);
    fixture.emit();
    fixture.keydown({ key: 'ArrowRight' }, fixture.superdoc.activeEditor.mount.container);
    old.complete(caret());
    await flushPromises();
    expect(fixture.cardVisible()).toBe(true);
  });

  it.each(['inline', 'auto'] satisfies ('inline' | 'auto')[])(
    'retires typing before a held text query resolves in %s presentation',
    async (layout) => {
      const fixture = await mountShell(layout);
      const query = deferredSelection();
      const match = vi.fn(() => query.promise);
      const { applying, apply } = await fixture.installAuthoring(match);
      const old = deferredSelection();
      fixture.current.mockReturnValue(old.promise);
      fixture.input.value = 'Before BRAVOx';
      fixture.input.focus();
      fixture.input.setSelectionRange(13, 13);
      const models = [...fixture.comments.commentsList];
      const original = models.map((comment) => comment.getValues());
      const focus = vi.spyOn(fixture.input, 'focus');
      const completed = vi.fn();
      fixture.emit();
      const selection = fixture.superdoc.activeEditor.authoring
        .setSelectionByText({ text: 'BRAVO', collapse: 'end', focus: false })
        .then((result) => {
          completed(result);
          return result;
        });
      await flushPromises();
      expect(match).toHaveBeenCalledExactlyOnceWith({ select: { type: 'text', pattern: 'BRAVO' }, limit: 1 });
      expect(apply).not.toHaveBeenCalled();
      old.complete(caret(13));
      await flushPromises();
      expect(completed).not.toHaveBeenCalled();
      expect(apply).not.toHaveBeenCalled();
      expect(fixture.comments.activeComment).toBe('thread-a');
      expect(fixture.cardVisible()).toBe(true);
      expect(document.activeElement).toBe(fixture.input);
      expect(fixture.input.value).toBe('Before BRAVOx');
      expect([fixture.input.selectionStart, fixture.input.selectionEnd]).toEqual([13, 13]);
      const target = {
        kind: 'selection',
        start: { kind: 'text', blockId: 'paragraph-a', offset: 7 },
        end: { kind: 'text', blockId: 'paragraph-a', offset: 12 },
      };
      query.complete({ items: [{ target }], total: 1 });
      await flushPromises();
      expect(apply).toHaveBeenCalledExactlyOnceWith(caret(12).selectionTarget);
      expect(completed).not.toHaveBeenCalled();
      fixture.input.setSelectionRange(12, 12);
      applying.complete({ ok: true, mode: 'collapsed' });
      expect(await selection).toEqual({
        ok: true,
        mode: 'collapsed',
        text: 'BRAVO',
        occurrence: 0,
        target,
      });
      fixture.editor.vm.$emit('v2-selection-changed', selectionSignal(12));
      await flushPromises();
      expect(fixture.comments.activeComment).toBe('thread-a');
      expect(fixture.cardVisible()).toBe(true);
      expect(document.activeElement).toBe(fixture.input);
      expect(fixture.input.value).toBe('Before BRAVOx');
      expect([fixture.input.selectionStart, fixture.input.selectionEnd]).toEqual([12, 12]);
      expect(fixture.comments.commentsList).toEqual(models);
      expect(fixture.comments.commentsList.map((comment) => comment.getValues())).toEqual(original);
      expect(fixture.current).toHaveBeenCalledExactlyOnceWith({ includeText: false });
      expect(focus).not.toHaveBeenCalled();
      expect(fixture.focus).not.toHaveBeenCalled();
      expect(fixture.documentMutation).not.toHaveBeenCalled();
      expect(fixture.clearReview).not.toHaveBeenCalled();
    },
  );

  it.each(['setSelectionTarget', 'setSelectionByText'] satisfies ('setSelectionTarget' | 'setSelectionByText')[])(
    'retires before explicit %s completes or emits a selection signal',
    async (method) => {
      const fixture = await mountShell();
      const { applying, apply } = await fixture.installAuthoring();
      const old = deferredSelection();
      fixture.current.mockReturnValue(old.promise);
      fixture.emit();
      const selection = fixture.superdoc.activeEditor.authoring[method]({
        target: caret(10).selectionTarget,
        text: 'BRAVO',
        focus: false,
      });
      await flushPromises();
      expect(apply).toHaveBeenCalledTimes(1);
      old.complete(caret());
      await flushPromises();
      expect(fixture.cardVisible()).toBe(true);
      applying.complete({ ok: true, mode: 'collapsed' });
      await selection;
    },
  );
});
