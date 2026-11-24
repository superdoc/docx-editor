import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { defineComponent, h, nextTick } from 'vue';
import { EventEmitter } from 'eventemitter3';
import { DOCX } from '@superdoc/common';
import { useSuperdocStore } from '../stores/superdoc-store.js';
import { useCommentsStore } from '../stores/comments-store.js';
import { normalizeUiConfig } from '../core/config/normalize-ui-config.js';
import SuperDoc from '../SuperDoc.vue';
import { fixedCommentsLayout } from '../test-support/comments-layout.js';
import { globalPropertiesWith } from '../test-support/global-properties.js';
import { makeV2CommentsAdapter, makeV2TrackedChangesAdapter } from '../test-support/v2-review-adapters.js';

interface ReviewContext {
  documentId: string;
  commentsAdapter: unknown;
  trackedChangesAdapter: unknown;
  resolveReviewWindow: (input: unknown) => unknown;
}

const engine = vi.hoisted(() => ({
  log: [] as string[],
  publisher: { payload: null as unknown, epoch: null as number | null },
}));

vi.mock('../core/v2-integration/v2-integration.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/v2-integration/v2-integration.js')>();
  const text = (value: unknown) => JSON.stringify(value);
  return {
    ...actual,
    createDefaultV2Integration: () => ({
      ...actual.createStubV2Integration(),
      EditorComponent: defineComponent({
        name: 'ReviewWiringFixture',
        props: ['options', 'documentId'],
        emits: ['v2-editor-ready', 'v2-host-event', 'v2-render', 'v2-render-cleared'],
        setup: () => () => h('div'),
      }),
      createGeometryPublisher: (options: { setGeometryAvailable?: (value: boolean) => void }) => ({
        async publish(payload: { epoch?: number } | null, publishOptions?: { reason?: string }) {
          engine.log.push(`publisher.publish epoch=${payload?.epoch} reason=${publishOptions?.reason ?? 'none'}`);
          engine.publisher.payload = payload;
          engine.publisher.epoch = payload?.epoch ?? null;
          options.setGeometryAvailable?.(payload != null);
        },
        async recollect() {
          engine.log.push('publisher.recollect');
        },
        noteCommittedPageWindow(window: { commitSequence?: number }) {
          engine.log.push(`publisher.noteCommittedPageWindow commit=${window?.commitSequence}`);
        },
        getLastPayload: () => engine.publisher.payload,
        getLastEpoch: () => engine.publisher.epoch,
        reset() {
          engine.publisher.payload = null;
          engine.publisher.epoch = null;
        },
      }),
      createReviewWindowController: (options: {
        applyReviewWindow?: ((context: ReviewContext, result: unknown) => unknown) | null;
      }) => {
        let context: ReviewContext | null = null;
        const readWindow = async () => {
          if (!context) return;
          const current = context;
          const result = await current.resolveReviewWindow({ documentId: current.documentId });
          const applied = options.applyReviewWindow?.(current, result);
          engine.log.push(`controller applied the window: ${text(applied)}`);
        };
        return {
          setContext(next: ReviewContext | null) {
            context = next;
            engine.log.push(
              next
                ? `controller.setContext document=${next.documentId} comments=${next.commentsAdapter != null} trackedChanges=${next.trackedChangesAdapter != null}`
                : 'controller.setContext null',
            );
          },
          onCommittedPagePaint(commit: Record<string, unknown>) {
            engine.log.push(`controller.onCommittedPagePaint ${text(commit)}`);
            return readWindow();
          },
          refreshCommittedWindow(reason: string) {
            engine.log.push(`controller.refreshCommittedWindow ${text(reason)}`);
            return readWindow();
          },
          invalidate(reason: string) {
            engine.log.push(`controller.invalidate ${text(reason)}`);
          },
          beginMutation(fact: unknown) {
            engine.log.push(`controller.beginMutation ${text(fact)}`);
          },
          settleMutation(token: string, settlement: unknown) {
            engine.log.push(`controller.settleMutation ${text(token)} ${text(settlement)}`);
          },
          reset(reason: string) {
            engine.log.push(`controller.reset ${text(reason)}`);
          },
          getSnapshot: () => null,
          subscribe: () => () => undefined,
          getDiagnostics: () => null,
        };
      },
    }),
  };
});

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  engine.log = [];
  engine.publisher = { payload: null, epoch: null };
  vi.unstubAllGlobals();
});

interface ReviewState {
  comments: { commentId: string; text: string }[];
  trackedChanges: { id: string; excerpt: string }[];
}

const entity = (entityType: string, entityId: string) => ({ kind: 'entity', entityType, entityId });

async function mountReviewShell({ commentsModule = true } = {}) {
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const pinia = createPinia();
  const store = useSuperdocStore(pinia);
  store.documents = [
    {
      id: 'doc-a',
      type: DOCX,
      data: new Blob([]),
      isReady: false,
      pageContainers: [],
      getEditor: () => null,
      getDocumentRuntime: () => null,
    },
  ];
  const modules = commentsModule ? { comments: {} } : { comments: false as const };
  const config = { modules, documentMode: 'editing', telemetry: { enabled: false } };
  Object.assign(store.modules, modules);
  const superdoc = Object.assign(new EventEmitter(), {
    config,
    ...fixedCommentsLayout(),
    uiConfig: normalizeUiConfig(config),
    activeEditor: { editorVersion: 2, documentId: 'doc-a' },
    user: { name: 'Reviewer' },
    users: [],
    colors: [],
    broadcastSidebarToggle() {},
    broadcastEditorCreate() {},
    setActiveEditor(editor: { editorVersion: number; documentId: string }) {
      superdoc.activeEditor = editor;
    },
    registerEditorRuntime(runtime: { getLegacyEditorProjection: () => { editorVersion: number; documentId: string } }) {
      superdoc.activeEditor = runtime.getLegacyEditorProjection();
    },
    unregisterEditorRuntime() {},
    setActiveRuntime() {},
  });
  superdoc.on('comments-update', (event: { type?: string; comment?: { commentId?: string } }) => {
    engine.log.push(`comments-update ${event.type} ${event.comment?.commentId ?? ''}`.trimEnd());
  });
  const wrapper = mount(SuperDoc, {
    global: {
      plugins: [pinia],
      config: { globalProperties: globalPropertiesWith({ $superdoc: superdoc }) },
      stubs: { SurfaceHost: true, FloatingComments: true, CommentDialog: true },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  superdoc.emit('active-editor-change');
  await nextTick();

  const review: ReviewState = { comments: [], trackedChanges: [] };
  const commentsAdapter = makeV2CommentsAdapter({
    documentId: 'doc-a',
    mapV2CommentToUseCommentInput: (item: { commentId: string; text: string }) => ({
      commentId: item.commentId,
      fileId: 'doc-a',
      commentText: item.text,
    }),
  });
  const trackedChangesAdapter = makeV2TrackedChangesAdapter({
    documentId: 'doc-a',
    listTrackedChanges: (input: unknown) => {
      engine.log.push(`trackedChangesAdapter.listTrackedChanges ${JSON.stringify(input ?? null)}`);
      return Promise.resolve({ ok: true, items: [] });
    },
    getTrackedChange: (input: unknown) => {
      engine.log.push(`trackedChangesAdapter.getTrackedChange ${JSON.stringify(input ?? null)}`);
      return Promise.resolve(null);
    },
    mapV2TrackedChangeToCommentParams: (item: { id: string; excerpt: string }) => ({
      event: 'add',
      changeId: item.id,
      documentId: 'doc-a',
      trackedChangeText: item.excerpt,
      trackedChangeType: 'insert',
      trackedChangeDisplayType: 'insert',
      trackedChangeAnchorKey: `tc::body::${item.id}`,
    }),
  });
  let renderEpoch = 0;
  const stage = document.createElement('div');
  stage.dataset.superdocV2DocumentId = 'doc-a';
  const editorMount = { container: stage, getRenderEpoch: () => renderEpoch };
  const editor = wrapper.findComponent({ name: 'ReviewWiringFixture' });
  editor.vm.$emit('v2-editor-ready', {
    documentId: 'doc-a',
    host: {
      resolveReviewWindow(input: unknown) {
        engine.log.push(`host.resolveReviewWindow ${JSON.stringify(input)}`);
        return {
          comments: { items: review.comments.map((item) => ({ ...item })) },
          trackedChanges: { items: review.trackedChanges.map((item) => ({ ...item })) },
        };
      },
      getHandles: () => ({ trackChanges: { moveFragmentWordIds: () => [] } }),
      getSnapshot: () => ({ state: 'editing-ready', documentMode: 'editing' }),
      subscribe: () => () => {},
      getPageMetricsSnapshot: () => ({ pages: [], zoom: { percent: 100 } }),
    },
    mount: editorMount,
    commentsAdapter,
    trackedChangesAdapter,
    documentApi: {},
  });

  const comments = useCommentsStore(pinia);
  const settle = async () => {
    for (let turn = 0; turn < 10; turn++) {
      await flushPromises();
      if (!frames.size) break;
      for (const [id, callback] of [...frames]) {
        frames.delete(id);
        callback(0);
      }
    }
    await flushPromises();
  };
  const rows = () =>
    comments.commentsList
      .map((row) =>
        row.trackedChange
          ? `tracked change ${row.commentId}: ${row.trackedChangeText}`
          : `comment ${row.commentId}: ${row.commentText}`,
      )
      .join('\n') || '(none)';

  const transcript: string[] = [];
  const step = async (title: string, run: () => void) => {
    engine.log = [];
    run();
    await settle();
    transcript.push(`## ${title}`, ...engine.log, 'sidebar rows:', rows(), '');
  };
  await settle();
  transcript.push('## editor ready', ...engine.log, '');

  return {
    review,
    comments,
    step,
    transcript: () => transcript.join('\n'),
    hostEvent: (event: Record<string, unknown>) => editor.vm.$emit('v2-host-event', event),
    paint: () => {
      renderEpoch += 1;
      editor.vm.$emit('v2-render', {
        documentId: 'doc-a',
        epoch: renderEpoch,
        mountContainer: stage,
        mount: editorMount,
      });
    },
    commitPageWindow: (commitSequence: number) =>
      editor.props('options').onReviewWindowCommitted({ commitSequence, pageIndices: [0] }),
    changeDocumentMode: () => superdoc.emit('document-mode-change'),
    clearRender: () => editor.vm.$emit('v2-render-cleared', { documentId: 'doc-a' }),
  };
}

const allResolvedFact = {
  schemaVersion: 1,
  targetKind: 'all',
  decision: 'accept',
  catalogRevision: 'catalog-7',
  sourceCoverageRevision: 'coverage-7',
  logicalTargetCount: 2,
  physicalCarrierCount: 2,
  remainingLogicalCount: 0,
  txId: 'tx-accept-all',
  documentEpoch: 'document-1',
  commitSequence: 9,
  packagePreviousRevision: 'package-7',
  packageNextRevision: 'package-8',
};

describe('mounted v2 review mutation wiring', () => {
  it('refreshes the review sidebar after each kind of document and review change', async () => {
    const shell = await mountReviewShell();
    shell.review.comments.push({ commentId: 'comment-1', text: 'Check this clause' });
    shell.review.trackedChanges.push({ id: 'change-1', excerpt: 'inserted words' });

    await shell.step('first paint commits its page window', () => {
      shell.paint();
      shell.commitPageWindow(1);
    });
    await shell.step('typing commits without review effects', () => {
      shell.hostEvent({ type: 'mutation:committed', origin: 'command', receipt: { success: true } });
    });
    await shell.step('review mutation starts', () => {
      shell.hostEvent({ type: 'review-mutation:started', reviewMutation: { token: 'mutation-1' } });
    });
    await shell.step('review mutation commits and repaints', () => {
      shell.review.comments.splice(0);
      shell.review.trackedChanges.splice(0);
      shell.hostEvent({
        type: 'mutation:committed',
        origin: 'command',
        reviewMutation: { token: 'mutation-1' },
        receipt: {
          success: true,
          removed: [entity('trackedChange', 'change-1')],
          invalidatedRefs: [entity('comment', 'comment-1')],
        },
      });
      shell.paint();
    });
    await shell.step('a collaborator adds a tracked change', () => {
      shell.review.trackedChanges.push({ id: 'change-2', excerpt: 'remote words' });
      shell.hostEvent({ type: 'collaboration:remote-changed', remoteGeneration: 1, reviewChanged: true });
    });
    await shell.step('a collaborator edits text without review changes', () => {
      shell.review.trackedChanges.push({ id: 'change-3', excerpt: 'not read yet' });
      shell.hostEvent({ type: 'collaboration:remote-changed', remoteGeneration: 2, reviewChanged: false });
    });
    await shell.step('undo', () => {
      shell.hostEvent({ type: 'mutation:committed', origin: 'history', direction: 'undo', result: {} });
    });
    await shell.step('redo', () => {
      shell.hostEvent({ type: 'mutation:committed', origin: 'history', direction: 'redo', result: {} });
    });
    await shell.step('review metadata commits without a paint', () => {
      shell.hostEvent({
        type: 'mutation:committed',
        origin: 'command',
        reviewSidecarOnly: true,
        receipt: { success: true },
      });
    });
    await shell.step('document mode changes', () => {
      shell.changeDocumentMode();
    });
    await shell.step('a review mutation is rejected', () => {
      shell.hostEvent({ type: 'review-mutation:started', reviewMutation: { token: 'mutation-2' } });
      shell.hostEvent({ type: 'mutation:rejected', reviewMutation: { token: 'mutation-2' }, reason: 'locked' });
    });
    await shell.step('a review mutation is aborted', () => {
      shell.hostEvent({ type: 'review-mutation:started', reviewMutation: { token: 'mutation-3' } });
      shell.hostEvent({ type: 'review-mutation:aborted', reviewMutation: { token: 'mutation-3' } });
    });
    await shell.step('accept all resolves every tracked change', () => {
      shell.review.trackedChanges.splice(0);
      shell.hostEvent({ type: 'review-mutation:started', reviewMutation: { token: 'mutation-4' } });
      shell.hostEvent({
        type: 'mutation:committed',
        origin: 'command',
        reviewMutation: { token: 'mutation-4' },
        receipt: { success: true, txId: 'tx-accept-all' },
        trackedChangeAllResolved: allResolvedFact,
      });
    });
    await shell.step('the render is cleared', () => {
      shell.clearRender();
    });

    await expect(shell.transcript()).toMatchFileSnapshot(
      './__snapshots__/v2-review-mutation-wiring/editing-session.txt',
    );
  });

  it('keeps the review window for custom UI when the built-in comments module is off', async () => {
    const shell = await mountReviewShell({ commentsModule: false });
    shell.review.trackedChanges.push({ id: 'change-1', excerpt: 'inserted words' });

    await shell.step('a collaborator adds a tracked change', () => {
      shell.hostEvent({ type: 'collaboration:remote-changed', remoteGeneration: 1, reviewChanged: true });
    });
    await shell.step('accept all resolves every tracked change', () => {
      shell.review.trackedChanges.splice(0);
      shell.hostEvent({ type: 'review-mutation:started', reviewMutation: { token: 'mutation-1' } });
      shell.hostEvent({
        type: 'mutation:committed',
        origin: 'command',
        reviewMutation: { token: 'mutation-1' },
        receipt: { success: true, txId: 'tx-accept-all' },
        trackedChangeAllResolved: allResolvedFact,
      });
    });

    await expect(shell.transcript()).toMatchFileSnapshot(
      './__snapshots__/v2-review-mutation-wiring/comments-module-off.txt',
    );
  });

  it('releases the review-mutation token when tracked-row reconciliation fails', async () => {
    const shell = await mountReviewShell();
    shell.comments.reconcileTrackedChangeMutationFromV2 = async () => {
      throw new Error('reconciliation failed');
    };

    await shell.step('review mutation commits while reconciliation fails', () => {
      shell.hostEvent({ type: 'review-mutation:started', reviewMutation: { token: 'mutation-1' } });
      shell.hostEvent({
        type: 'mutation:committed',
        origin: 'command',
        reviewMutation: { token: 'mutation-1' },
        receipt: { success: true, removed: [entity('trackedChange', 'change-1')] },
      });
    });

    await expect(shell.transcript()).toMatchFileSnapshot(
      './__snapshots__/v2-review-mutation-wiring/reconciliation-fails.txt',
    );
  });
});
