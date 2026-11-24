import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { defineComponent, h, reactive, shallowRef } from 'vue';
import { EventEmitter } from 'eventemitter3';
import { DOCX } from '@superdoc/common';
import type { CommentsListResult, SelectionInfo, TrackChangesListResult } from '@superdoc/document-api';
import { useSuperdocStore } from '../stores/superdoc-store.js';
import { useCommentsStore } from '../stores/comments-store.js';
import { normalizeUiConfig } from '../core/config/normalize-ui-config.js';
import type { CommentsLayoutState } from '../core/types/index.js';
import { createSuperDocUI } from '../public/ui/create-super-doc-ui.js';
import SuperDoc from '../SuperDoc.vue';

vi.mock('../core/v2-integration/v2-integration.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/v2-integration/v2-integration.js')>();
  return {
    ...actual,
    createDefaultV2Integration: () => ({
      ...actual.createStubV2Integration(),
      EditorComponent: defineComponent({
        name: 'SetActiveFixtureEditor',
        emits: ['v2-host-event', 'v2-selection-changed', 'v2-render-cleared', 'v2-editor-ready'],
        setup: () => () => h('div', { 'data-native-mount': '' }),
      }),
    }),
  };
});

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const emptySelection: SelectionInfo = {
  empty: true,
  target: null,
  selectionTarget: null,
  activeMarks: [],
  activeCommentIds: [],
  activeChangeIds: [],
};

const commentRows: CommentsListResult = {
  evaluatedRevision: 'r1',
  total: 1,
  items: [
    {
      id: 'thread-a',
      handle: { ref: 'comment:thread-a', refStability: 'stable', targetKind: 'comment' },
      address: { kind: 'entity', entityType: 'comment', entityId: 'thread-a' },
      status: 'open',
    },
  ],
  page: { limit: 1, offset: 0, returned: 1 },
};
const noTrackedChanges: TrackChangesListResult = {
  evaluatedRevision: 'r1',
  total: 0,
  items: [],
  page: { limit: 0, offset: 0, returned: 0 },
};

type ReviewTarget = { entityType: string; entityId: string; origin: string } | null;

async function mountShellWithController() {
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
  const config = {
    documents: [],
    modules: { comments: {} },
    ui: { comments: { layout: 'inline' as const } },
    documentMode,
  };

  let hostTarget: ReviewTarget = null;
  let forwardHostEvent: (event: Record<string, unknown>) => void = () => undefined;
  const publishHostTarget = (next: ReviewTarget) => {
    const previous = hostTarget;
    hostTarget = next;
    forwardHostEvent({ type: 'reviewTarget:changed', previous, next, reason: 'panel-focus' });
  };
  const review = {
    getActiveReviewTarget: () => hostTarget,
    setActiveReviewTarget: (next: ReviewTarget) => {
      publishHostTarget(next);
      return null;
    },
    clearActiveReviewTarget: () => publishHostTarget(null),
  };

  const activeEditor = {
    editorVersion: 2,
    documentId: 'doc-a',
    options: { documentId: 'doc-a' },
    host: { getHandles: () => ({ review, layout: { generation: 1 } }) },
    doc: {
      comments: { list: () => commentRows },
      trackChanges: { list: () => noTrackedChanges },
      selection: { current: (): SelectionInfo => emptySelection },
    },
    mount: { container: document.createElement('div') },
    commands: {},
    focus: () => undefined,
  };
  const commentsLayout = shallowRef<CommentsLayoutState>({ requested: 'inline', effective: 'inline' });
  const superdoc = Object.assign(new EventEmitter(), {
    config,
    uiConfig: reactive(normalizeUiConfig(config)),
    getCommentsLayout: () => commentsLayout.value,
    setCommentsLayout: () => undefined,
    activeEditor,
    setActiveEditor: () => undefined,
    user: { name: 'Fixture author' },
    users: [],
    colors: [],
    broadcastSidebarToggle: () => undefined,
    broadcastEditorCreate: () => undefined,
    registerEditorRuntime: () => undefined,
    unregisterEditorRuntime: () => undefined,
    setActiveRuntime: () => undefined,
  });

  const comments = useCommentsStore(pinia);
  comments.init({
    comments: [
      {
        commentId: 'thread-a',
        fileId: 'doc-a',
        creatorName: 'Fabricated Reviewer',
        commentText: '<p>Fabricated review</p>',
      },
      { commentId: 'thread-b', fileId: 'doc-a', commentText: '<p>Other review</p>' },
    ],
  });

  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { get: () => 900 });
  document.body.appendChild(container);
  const wrapper = mount(SuperDoc, {
    attachTo: container,
    global: {
      plugins: [pinia],
      config: { globalProperties: { $superdoc: superdoc, $pinia: pinia } },
      stubs: { SurfaceHost: true, FloatingComments: true },
    },
  });
  const editor = wrapper.findComponent({ name: 'SetActiveFixtureEditor' });
  forwardHostEvent = (event) => editor.vm.$emit('v2-host-event', event);
  await flushPromises();

  const ui = createSuperDocUI({ superdoc });
  cleanups.push(() => {
    ui.destroy();
    wrapper.unmount();
    container.remove();
  });
  const card = () => wrapper.find('.comments-dialog[data-comment-thread-id="thread-a"]');
  const nativeMount = wrapper.get('[data-native-mount]').element;
  return { ui, comments, card, nativeMount, hostTarget: () => hostTarget, publishHostTarget };
}

describe('ui.comments.setActive and the built-in comment card', () => {
  it('activates the built-in card for the comment setActive accepted', async () => {
    const { ui, comments, card, hostTarget } = await mountShellWithController();

    expect(ui.comments.getSnapshot()).toMatchObject({ listStatus: 'ready', activeId: null });
    expect(ui.comments.getSnapshot().items.map((item) => item.id)).toEqual(['thread-a']);
    expect(comments.activeComment).toBeNull();
    expect(card().exists()).toBe(false);

    expect(ui.comments.setActive('thread-a')).toBe(true);
    await flushPromises();
    expect(ui.comments.getSnapshot().activeId).toBe('thread-a');
    expect(hostTarget()).toMatchObject({ entityType: 'comment', entityId: 'thread-a', origin: 'api' });

    expect(comments.activeComment).toBe('thread-a');
    expect(card().classes()).toContain('is-active');
  });

  it('clears the built-in card, the controller focus and the host target on setActive(null)', async () => {
    const { ui, comments, card, hostTarget } = await mountShellWithController();
    expect(ui.comments.setActive('thread-a')).toBe(true);
    await flushPromises();

    expect(ui.comments.setActive(null)).toBe(true);
    await flushPromises();
    expect(ui.comments.getSnapshot().activeId).toBeNull();
    expect(hostTarget()).toBeNull();
    expect(comments.activeComment).toBeNull();
    expect(card().exists()).toBe(false);
  });

  it('still ignores a panel-origin echo from the built-in panel', async () => {
    const { comments, card, publishHostTarget } = await mountShellWithController();

    publishHostTarget({ entityType: 'comment', entityId: 'thread-a', origin: 'panel' });
    await flushPromises();

    expect(comments.activeComment).toBeNull();
    expect(card().exists()).toBe(false);
  });

  it('activates the built-in card when setActive runs from a context-menu handler', async () => {
    const { ui, comments, card, nativeMount } = await mountShellWithController();

    nativeMount.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(ui.comments.setActive('thread-a')).toBe(true);
    await flushPromises();

    expect(comments.activeComment).toBe('thread-a');
    expect(card().classes()).toContain('is-active');
  });

  it('retires the API-opened card when a panel target replaces it', async () => {
    const { ui, comments, publishHostTarget } = await mountShellWithController();
    expect(ui.comments.setActive('thread-a')).toBe(true);
    await flushPromises();

    publishHostTarget({ entityType: 'trackedChange', entityId: 'tc-1', origin: 'panel' });
    await flushPromises();

    expect(comments.activeComment).toBeNull();
  });

  it('keeps the card the built-in panel selected when its target replaces an API focus', async () => {
    const { ui, comments, publishHostTarget } = await mountShellWithController();
    expect(ui.comments.setActive('thread-a')).toBe(true);
    await flushPromises();

    comments.setActiveComment(null, 'thread-b');
    publishHostTarget({ entityType: 'comment', entityId: 'thread-b', origin: 'panel' });
    await flushPromises();

    expect(comments.activeComment).toBe('thread-b');
  });

  it('clears a card the built-in panel opened on setActive(null)', async () => {
    const { ui, comments, card, hostTarget, publishHostTarget } = await mountShellWithController();
    comments.setActiveComment(null, 'thread-a');
    publishHostTarget({ entityType: 'comment', entityId: 'thread-a', origin: 'panel' });
    await flushPromises();
    expect(card().classes()).toContain('is-active');

    expect(ui.comments.setActive(null)).toBe(true);
    await flushPromises();

    expect(hostTarget()).toBeNull();
    expect(comments.activeComment).toBeNull();
    expect(card().exists()).toBe(false);
  });
});
