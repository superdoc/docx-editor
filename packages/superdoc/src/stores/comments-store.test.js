import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { createPinia, setActivePinia } from 'pinia';
import { isProxy, reactive } from 'vue';
import { useCommentsStore } from './comments-store.js';
import { useSuperdocStore } from './superdoc-store.js';
import useComment from '../components/CommentsLayer/use-comment.js';

const ONE_BY_ONE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+KD0aVQAAAABJRU5ErkJggg==';

function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeResolvedRow(overrides = {}) {
  return {
    commentId: 'c1',
    fileId: 'doc-1',
    commentText: 'Thread body',
    resolvedTime: 1234,
    resolvedByEmail: 'reviewer@example.com',
    resolvedByName: 'Reviewer',
    ...overrides,
  };
}

function makeOpenRow(overrides = {}) {
  return {
    commentId: 'c1',
    fileId: 'doc-1',
    commentText: 'Thread body',
    resolvedTime: null,
    resolvedByEmail: null,
    resolvedByName: null,
    ...overrides,
  };
}

function makeAdapter(items, outcomeExtras = {}) {
  return {
    documentId: 'doc-1',
    resolve: vi.fn(async () => ({ ok: true, items, ...outcomeExtras })),
    reopen: vi.fn(async () => ({ ok: true, items, ...outcomeExtras })),
    mapV2CommentToUseCommentInput: vi.fn((item) => item),
  };
}

function makeSuperdoc(adapter) {
  return {
    activeEditor: {
      editorVersion: 2,
      v2Comments: adapter,
    },
    emit: vi.fn(),
  };
}

function makeTrackedChangesAdapter(result) {
  return {
    documentId: 'doc-1',
    listTrackedChanges: vi.fn(async () => result),
    mapV2TrackedChangeToCommentParams: vi.fn((item) => ({
      event: 'omit',
      changeId: item?.id,
      reason: 'test-omitted-row',
    })),
  };
}

function makeTrackedChangeRow(overrides = {}) {
  const commentId = overrides.commentId ?? 'tc-old';
  return useComment({
    commentId,
    fileId: 'doc-1',
    trackedChange: true,
    trackedChangeText: 'old tracked change',
    trackedChangeType: 'insert',
    trackedChangeDisplayType: 'insert',
    trackedChangeAnchorKey: overrides.trackedChangeAnchorKey ?? `tc::body::${commentId}`,
    commentText: '',
    ...overrides,
  });
}

function compactTrackedChangeRows(store, rows) {
  store.commentsList = rows;
  const adapter = {
    documentId: 'doc-1',
    mapV2TrackedChangeToCommentParams: vi.fn(),
  };
  store.setV2TrackedChangesAdapter(adapter);
  store.reconcileTrackedChangesFromV2({
    superdoc: { config: { isInternal: true }, emit: vi.fn() },
    adapter,
    documentId: 'doc-1',
    items: [],
    pruneStale: false,
  });
}

describe('comments-store read-only mutation policy (SD-3164)', () => {
  let store;
  let superdoc;
  let commentsAdapter;
  let trackedChangesAdapter;

  beforeEach(() => {
    setActivePinia(createPinia());
    const superdocStore = useSuperdocStore();
    superdocStore.documents = [
      { id: 'doc-1', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    ];
    store = useCommentsStore();
    store.init({ readOnly: true });
    commentsAdapter = {
      documentId: 'doc-1',
      reply: vi.fn(),
      edit: vi.fn(),
      delete: vi.fn(),
      resolve: vi.fn(),
      reopen: vi.fn(),
      commitPendingComment: vi.fn(),
    };
    trackedChangesAdapter = {
      accept: vi.fn(),
      reject: vi.fn(),
    };
    superdoc = {
      activeEditor: {
        editorVersion: 2,
        v2Comments: commentsAdapter,
        v2TrackedChanges: trackedChangesAdapter,
      },
      emit: vi.fn(),
      config: { isInternal: false },
    };
    store.setV2CommentsAdapter(commentsAdapter);
    store.setV2TrackedChangesAdapter(trackedChangesAdapter);
    store.commentsList = [useComment(makeOpenRow())];
  });

  it('rejects every comment mutation before calling an adapter or emitting an event', async () => {
    const draft = useComment({ fileId: 'doc-1', commentText: 'new comment' });
    const outcomes = [
      store.addComment({ superdoc, comment: draft }),
      await store.deleteComment({ superdoc, commentId: 'c1' }),
      await store.replyCommentV2({ superdoc, parentCommentId: 'c1', text: 'reply' }),
      await store.editCommentV2({ superdoc, commentId: 'c1', text: 'updated' }),
      await store.resolveCommentV2({ superdoc, commentId: 'c1' }),
      await store.reopenCommentV2({ superdoc, commentId: 'c1' }),
    ];

    expect(outcomes).toEqual(outcomes.map(() => ({ ok: false, reason: 'read-only-document' })));
    expect(store.commentsList).toHaveLength(1);
    expect(store.commentsList[0].commentText).toBe('Thread body');
    Object.values(commentsAdapter)
      .filter((value) => vi.isMockFunction(value))
      .forEach((spy) => expect(spy).not.toHaveBeenCalled());
    expect(superdoc.emit).not.toHaveBeenCalled();
  });

  it.each(['accept', 'reject'])('rejects tracked-change %s before the decision adapter', async (decision) => {
    const trackedComment = makeTrackedChangeRow();
    store.commentsList = [trackedComment];

    const outcome = await store.decideTrackedChangeFromSidebar({ superdoc, comment: trackedComment, decision });

    expect(outcome).toEqual({ ok: false, reason: 'read-only-document' });
    expect(trackedChangesAdapter.accept).not.toHaveBeenCalled();
    expect(trackedChangesAdapter.reject).not.toHaveBeenCalled();
    expect(superdoc.emit).not.toHaveBeenCalled();
  });

  it('allows tracked-change decisions independently from read-only comments', async () => {
    const trackedComment = makeTrackedChangeRow();
    store.commentsList = [trackedComment];
    superdoc.interactionConfig = {
      comments: { level: 'read', readOnly: true, allowResolve: false },
      trackedChanges: { allowDecisions: true },
    };

    await store.decideTrackedChangeFromSidebar({ superdoc, comment: trackedComment, decision: 'accept' });

    expect(trackedChangesAdapter.accept).toHaveBeenCalledWith(trackedComment);
  });

  it('resolves linked comments after an allowed decision removes their tracked text', async () => {
    const trackedComment = makeTrackedChangeRow({
      commentId: 'tc-deletion',
      trackedChangeType: 'delete',
      trackedChangeDisplayType: 'delete',
    });
    const linkedComment = useComment({
      commentId: 'linked-comment',
      fileId: 'doc-1',
      commentText: 'Linked to deleted text',
      trackedChangeParentId: trackedComment.commentId,
      trackedChangeThreadParentId: trackedComment.commentId,
    });
    store.commentsList = [linkedComment, trackedComment];
    superdoc.commentsStore = store;
    superdoc.interactionConfig = {
      comments: { level: 'read', readOnly: true, allowResolve: false },
      trackedChanges: { allowDecisions: true },
    };
    superdoc.activeEditor.documentId = 'doc-1';
    trackedChangesAdapter.documentId = 'doc-1';
    trackedChangesAdapter.accept.mockResolvedValue({
      ok: true,
      receipt: { success: true },
      decidedId: trackedComment.commentId,
      documentId: 'doc-1',
    });

    const outcome = await store.decideTrackedChangeFromSidebar({
      superdoc,
      comment: trackedComment,
      decision: 'accept',
    });

    expect(outcome).toMatchObject({ ok: true, success: true });
    expect(linkedComment.resolvedTime).toEqual(expect.any(Number));
  });

  it('blocks tracked-change decisions independently from writable comments', async () => {
    store.init({ readOnly: false, allowResolve: true });
    const trackedComment = makeTrackedChangeRow();
    store.commentsList = [trackedComment];
    superdoc.interactionConfig = {
      comments: { level: 'resolve', readOnly: false, allowResolve: true },
      trackedChanges: { allowDecisions: false },
    };

    const outcome = await store.decideTrackedChangeFromSidebar({
      superdoc,
      comment: trackedComment,
      decision: 'accept',
    });

    expect(outcome).toEqual({ ok: false, reason: 'tracked-change-decisions-disabled' });
    expect(trackedChangesAdapter.accept).not.toHaveBeenCalled();
  });

  it('applies canonical tracked-change resolution received while read-only', () => {
    const trackedComment = makeTrackedChangeRow();
    store.commentsList = [trackedComment];

    store.handleTrackedChangeUpdate({
      superdoc,
      broadcastChanges: false,
      params: {
        event: 'resolve',
        changeId: trackedComment.commentId,
        documentId: trackedComment.fileId,
        decision: 'accept',
        resolvedById: 'remote-reviewer',
        resolvedByEmail: 'remote@example.com',
        resolvedByName: 'Remote Reviewer',
      },
    });

    expect(trackedComment.resolvedTime).toEqual(expect.any(Number));
    expect(trackedComment.resolvedById).toBe('remote-reviewer');
    expect(trackedComment.trackedChangeDecision).toBe('accept');
    expect(trackedChangesAdapter.accept).not.toHaveBeenCalled();
    expect(trackedChangesAdapter.reject).not.toHaveBeenCalled();
  });

  it('rejects caller-controlled hydration flags on the public addComment mutation', () => {
    const imported = useComment({
      commentId: 'imported-1',
      fileId: 'doc-1',
      commentText: 'Imported review note',
      origin: 'word',
    });
    const hydrationSuperdoc = { activeEditor: null, emit: vi.fn(), config: { isInternal: false } };

    const outcome = store.addComment({
      superdoc: hydrationSuperdoc,
      comment: imported,
      isHydration: true,
    });

    expect(outcome).toEqual({ ok: false, reason: 'read-only-document' });
    expect(store.commentsList.map((comment) => comment.commentId)).not.toContain('imported-1');
    expect(hydrationSuperdoc.emit).not.toHaveBeenCalled();
  });

  it('still hydrates imported rows through the store-owned reconciliation path', () => {
    const imported = useComment({
      commentId: 'imported-1',
      fileId: 'doc-1',
      commentText: 'Imported review note',
      origin: 'word',
    });
    const hydrationSuperdoc = { activeEditor: null, emit: vi.fn(), config: { isInternal: false } };

    const outcome = store.addHydratedComment({
      superdoc: hydrationSuperdoc,
      comment: imported,
      broadcastChanges: false,
    });

    expect(outcome).toMatchObject({ ok: true });
    expect(store.commentsList.map((comment) => comment.commentId)).toContain('imported-1');
    expect(hydrationSuperdoc.emit).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (typeof window !== 'undefined') {
    delete window.__labsSuperDocV2BenchmarkDebug;
  }
});

describe('comments-store v2 tracked-change comments', () => {
  let store;

  beforeEach(() => {
    setActivePinia(createPinia());
    const superdocStore = useSuperdocStore();
    superdocStore.documents = [
      { id: 'doc-1', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    ];
    store = useCommentsStore();
  });

  it('creates the first root at the canonical tracked-change target after reply reports TARGET_NOT_FOUND', async () => {
    const trackedChangeId = 'tc|main%3A%2Fword%2Fdocument.xml|del|coalesced|2|4';
    const reviewRowId = 'tc|main%3A%2Fword%2Fdocument.xml|del|source%7CwId%3A4';
    const story = reactive({ kind: 'story', storyType: 'body' });
    const createdItem = {
      id: '0',
      text: 'reply on <deletion>',
      status: 'open',
      trackedChangeParentId: trackedChangeId,
      trackedChangeThreadParentId: trackedChangeId,
      trackedChangeSide: 'deleted',
    };
    const adapter = {
      documentId: 'doc-1',
      reply: vi.fn(async () => ({
        ok: false,
        reason: 'receipt-failure',
        code: 'TARGET_NOT_FOUND',
      })),
      commitPendingComment: vi.fn(async () => ({
        ok: true,
        items: [createdItem],
        complete: false,
        visibleWindowSource: 'mutation-targets',
        mutationPath: 'document-api',
      })),
      mapV2CommentToUseCommentInput: vi.fn((item) => ({
        commentId: item.id,
        fileId: 'doc-1',
        commentText: item.text,
        resolvedTime: null,
        trackedChangeParentId: item.trackedChangeParentId,
        trackedChangeThreadParentId: item.trackedChangeThreadParentId,
        trackedChangeSide: item.trackedChangeSide,
      })),
    };
    const superdoc = makeSuperdoc(adapter);
    store.setV2CommentsAdapter(adapter);
    store.commentsList = [
      makeTrackedChangeRow({
        commentId: reviewRowId,
        importedId: '4',
        trackedChangeCanonicalId: trackedChangeId,
      }),
    ];

    const trackedChangeTarget = { kind: 'trackedChange', trackedChangeId, story };
    const mentions = [{ id: 'reviewer-1', name: 'Internal Reviewer', email: 'reviewer@example.com' }];
    const result = await store.replyCommentV2({
      superdoc,
      parentCommentId: trackedChangeId,
      trackedChangeTarget,
      text: '<p>reply on &lt;deletion&gt;</p>',
      mentions,
    });

    expect(adapter.reply).toHaveBeenCalledWith({
      parentCommentId: trackedChangeId,
      text: 'reply on <deletion>',
      mentions,
    });
    expect(adapter.commitPendingComment).toHaveBeenCalledWith({
      text: 'reply on <deletion>',
      target: trackedChangeTarget,
      mentions,
    });
    expect(isProxy(adapter.commitPendingComment.mock.calls[0][0].target.story)).toBe(false);
    expect(result).toMatchObject({ ok: true, mutationPath: 'document-api' });
    expect(store.commentsList).toEqual([
      expect.objectContaining({ commentId: reviewRowId, trackedChange: true }),
      expect.objectContaining({
        commentId: '0',
        trackedChangeThreadParentId: trackedChangeId,
      }),
    ]);
    expect(superdoc.emit).toHaveBeenCalledWith(
      'comments-update',
      expect.objectContaining({
        type: store.COMMENT_EVENTS.ADD,
        comment: expect.objectContaining({ commentId: '0' }),
      }),
    );
    expect(store.getTrackedChangeThread(store.commentsList[0]).map((comment) => comment.commentId)).toEqual([
      reviewRowId,
      '0',
    ]);
    expect(store.getGroupedComments.parentComments.map((comment) => comment.commentId)).toEqual([reviewRowId]);
  });

  it('replies through the canonical tracked-change id when an anchored root already exists', async () => {
    const trackedChangeId = 'tc|main%3A%2Fword%2Fdocument.xml|del|coalesced|2|4';
    const replyItem = {
      id: '1',
      parentCommentId: '0',
      text: 'second note',
      status: 'open',
      trackedChangeThreadParentId: trackedChangeId,
      trackedChangeSide: 'deleted',
    };
    const adapter = {
      documentId: 'doc-1',
      reply: vi.fn(async () => ({
        ok: true,
        items: [replyItem],
        complete: false,
        mutationPath: 'document-api',
      })),
      commitPendingComment: vi.fn(),
      mapV2CommentToUseCommentInput: vi.fn((item) => ({
        commentId: item.id,
        parentCommentId: item.parentCommentId,
        fileId: 'doc-1',
        commentText: item.text,
        resolvedTime: null,
        trackedChangeThreadParentId: item.trackedChangeThreadParentId,
        trackedChangeSide: item.trackedChangeSide,
      })),
    };
    const superdoc = makeSuperdoc(adapter);
    store.setV2CommentsAdapter(adapter);

    const result = await store.replyCommentV2({
      superdoc,
      parentCommentId: trackedChangeId,
      trackedChangeTarget: { kind: 'trackedChange', trackedChangeId },
      text: 'second note',
    });

    expect(result).toMatchObject({ ok: true });
    expect(adapter.reply).toHaveBeenCalledWith({ parentCommentId: trackedChangeId, text: 'second note' });
    expect(adapter.commitPendingComment).not.toHaveBeenCalled();
  });

  it('does not create another root when canonical tracked-change reply is ambiguous', async () => {
    const trackedChangeId = 'tc|main%3A%2Fword%2Fdocument.xml|del|coalesced|2|4';
    const adapter = {
      documentId: 'doc-1',
      reply: vi.fn(async () => ({
        ok: false,
        reason: 'receipt-failure',
        code: 'AMBIGUOUS_MATCH',
      })),
      commitPendingComment: vi.fn(),
    };
    const superdoc = makeSuperdoc(adapter);
    store.setV2CommentsAdapter(adapter);

    const result = await store.replyCommentV2({
      superdoc,
      parentCommentId: trackedChangeId,
      trackedChangeTarget: { kind: 'trackedChange', trackedChangeId },
      text: 'must not create another root',
    });

    expect(result).toMatchObject({ ok: false, code: 'AMBIGUOUS_MATCH' });
    expect(adapter.commitPendingComment).not.toHaveBeenCalled();
  });
});

describe('comments-store allowResolve policy', () => {
  let store;
  let superdoc;
  let commentsAdapter;

  beforeEach(() => {
    setActivePinia(createPinia());
    const superdocStore = useSuperdocStore();
    superdocStore.documents = [
      { id: 'doc-1', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    ];
    store = useCommentsStore();
    store.init({ allowResolve: false });
    commentsAdapter = {
      documentId: 'doc-1',
      resolve: vi.fn(),
      reopen: vi.fn(),
      list: vi.fn(async () => []),
    };
    superdoc = {
      activeEditor: { options: { ydoc: null }, v2Comments: commentsAdapter },
      emit: vi.fn(),
      config: { isInternal: false },
    };
    store.setV2CommentsAdapter(commentsAdapter);
    store.commentsList = [useComment(makeOpenRow())];
  });

  it('refuses resolve and reopen before reaching the adapter', async () => {
    // The built-in dialog and header already hide the affordance, but a custom
    // comment UI drives these mutations directly. Enforcing the policy only in
    // the components would let it through.
    const resolved = await store.resolveCommentV2({ superdoc, commentId: 'c1' });
    const reopened = await store.reopenCommentV2({ superdoc, commentId: 'c1' });

    expect(resolved).toEqual({ ok: false, reason: 'resolve-disabled' });
    expect(reopened).toEqual({ ok: false, reason: 'resolve-disabled' });
    expect(commentsAdapter.resolve).not.toHaveBeenCalled();
    expect(commentsAdapter.reopen).not.toHaveBeenCalled();
    expect(superdoc.emit).not.toHaveBeenCalled();
  });
});

describe('comments-store open tracked-change presence', () => {
  let store;

  beforeEach(() => {
    setActivePinia(createPinia());
    store = useCommentsStore();
  });

  it('keeps an open tracked change globally signaled when its mounted position clears', () => {
    store.commentsList = [makeTrackedChangeRow({ commentId: 'tc-1' })];
    store.editorCommentPositions = { 'tc-1': { bounds: { top: 1, bottom: 2 } } };

    expect(store.hasOpenTrackedChanges).toBe(true);
    expect(store.getFloatingComments).toHaveLength(1);

    store.clearEditorCommentPositions();

    expect(store.hasOpenTrackedChanges).toBe(true);
    expect(store.getFloatingComments).toHaveLength(1);
  });

  it.each(['resolved', 'removed'])('turns false when the final tracked change is %s', (state) => {
    store.commentsList = [makeTrackedChangeRow({ commentId: 'tc-1' })];
    expect(store.hasOpenTrackedChanges).toBe(true);

    if (state === 'resolved') store.commentsList[0].resolvedTime = Date.now();
    else store.commentsList = [];

    expect(store.hasOpenTrackedChanges).toBe(false);
  });

  it('does not signal an ordinary offscreen comment', () => {
    store.commentsList = [useComment(makeOpenRow())];
    store.editorCommentPositions = {};

    expect(store.hasOpenTrackedChanges).toBe(false);
  });

  it('resolves a canonical tracked-change row from its first-paint RSID geometry alias', () => {
    const row = makeTrackedChangeRow({
      commentId: 'tc-canonical-delete',
      importedId: '2',
      trackedChangePositionAliases: ['00000029'],
    });
    store.commentsList = [row];
    store.editorCommentPositions = {
      '00000029': {
        key: '00000029',
        threadId: '00000029',
        kind: 'trackedChange',
        storyKey: 'body',
        bounds: { top: 10, bottom: 30, left: 0, right: 100 },
        rects: [{ top: 10, bottom: 30, left: 0, right: 100 }],
      },
    };

    expect(store.getCommentAliasIds(row)).toContain('00000029');
    expect(store.getFloatingCommentInstances).toEqual([
      expect.objectContaining({
        id: 'tc-canonical-delete',
        positionKey: '00000029',
        comment: row,
      }),
    ]);
  });

  it('resolves shared RSID geometry within each tracked-change story', () => {
    const bodyRow = makeTrackedChangeRow({
      commentId: 'tc-body-delete',
      trackedChangeAnchorKey: 'tc::body::tc-body-delete',
      trackedChangeStory: { kind: 'story', storyType: 'body' },
      trackedChangePositionAliases: ['00000029'],
    });
    const headerRow = makeTrackedChangeRow({
      commentId: 'tc-header-delete',
      trackedChangeAnchorKey: 'tc::hf:rId-header::tc-header-delete',
      trackedChangeStory: { kind: 'story', storyType: 'headerFooterPart', refId: 'rId-header' },
      trackedChangePositionAliases: ['00000029'],
    });
    const bodyPosition = {
      key: '00000029',
      threadId: '00000029',
      kind: 'trackedChange',
      storyKey: 'body',
      bounds: { top: 10, bottom: 30, left: 0, right: 100 },
      rects: [{ top: 10, bottom: 30, left: 0, right: 100 }],
    };
    const headerPosition = {
      key: 'tc::hf:rId-header::00000029',
      threadId: '00000029',
      kind: 'trackedChange',
      storyKey: 'hf:rId-header',
      bounds: { top: 110, bottom: 130, left: 0, right: 100 },
      rects: [{ top: 110, bottom: 130, left: 0, right: 100 }],
    };
    store.commentsList = [bodyRow, headerRow];
    store.editorCommentPositions = {
      '00000029': bodyPosition,
      'tc::hf:rId-header::00000029': headerPosition,
    };

    expect(store.resolveCommentPositionEntry(bodyRow)).toEqual({ key: '00000029', entry: bodyPosition });
    expect(store.resolveCommentPositionEntry(headerRow)).toEqual({
      key: 'tc::hf:rId-header::00000029',
      entry: headerPosition,
    });

    store.editorCommentPositions = { '00000029': bodyPosition };
    expect(store.resolveCommentPositionEntry(headerRow)).toEqual({ key: null, entry: null });
  });

  it('does not publish a non-body raw alias position under a body tracked-change row', () => {
    const bodyRow = makeTrackedChangeRow({
      commentId: 'tc-body-delete',
      trackedChangeAnchorKey: 'tc::body::tc-body-delete',
      trackedChangeStory: { kind: 'story', storyType: 'body' },
      trackedChangePositionAliases: ['00000029'],
    });
    const headerPosition = {
      key: '00000029',
      threadId: '00000029',
      kind: 'trackedChange',
      storyKey: 'hf:rId-header',
      bounds: { top: 110, bottom: 130, left: 0, right: 100 },
      rects: [{ top: 110, bottom: 130, left: 0, right: 100 }],
    };
    store.commentsList = [bodyRow];

    store.handleEditorLocationsUpdate({
      'tc::hf:rId-header::00000029': headerPosition,
    });

    expect(store.editorCommentPositions['00000029']).toStrictEqual(headerPosition);
    expect(store.editorCommentPositions['tc-body-delete']).toBeUndefined();
    expect(store.editorCommentPositions['tc::body::tc-body-delete']).toBeUndefined();
    expect(store.editorCommentPositions['tc::body::00000029']).toBeUndefined();
    expect(store.resolveCommentPositionEntry(bodyRow)).toEqual({ key: null, entry: null });
  });

  it('normalizes legacy header story keys when resolving an RSID geometry alias', () => {
    const headerRow = makeTrackedChangeRow({
      commentId: 'tc-header-delete',
      trackedChangeAnchorKey: 'tc::hf:part:rId-header::tc-header-delete',
      trackedChangePositionAliases: ['00000029'],
    });
    const bodyPosition = {
      key: '00000029',
      threadId: '00000029',
      kind: 'trackedChange',
      storyKey: 'body',
      bounds: { top: 10, bottom: 30, left: 0, right: 100 },
      rects: [{ top: 10, bottom: 30, left: 0, right: 100 }],
    };
    const headerPosition = {
      key: 'tc::hf:rId-header::00000029',
      threadId: '00000029',
      kind: 'trackedChange',
      storyKey: 'hf:rId-header',
      bounds: { top: 110, bottom: 130, left: 0, right: 100 },
      rects: [{ top: 110, bottom: 130, left: 0, right: 100 }],
    };
    store.commentsList = [headerRow];
    store.editorCommentPositions = {
      '00000029': bodyPosition,
      'tc::hf:rId-header::00000029': headerPosition,
    };

    expect(store.resolveCommentPositionEntry(headerRow)).toEqual({
      key: 'tc::hf:rId-header::00000029',
      entry: headerPosition,
    });
  });
});

describe('comments-store v2 reopen mutation', () => {
  let store;

  beforeEach(() => {
    setActivePinia(createPinia());
    store = useCommentsStore();
  });

  it('returns success only after the refreshed v2 list confirms the thread is open', async () => {
    const adapter = makeAdapter([
      {
        commentId: 'c1',
        fileId: 'doc-1',
        commentText: 'Thread body',
        resolvedTime: null,
      },
    ]);
    const superdoc = makeSuperdoc(adapter);
    store.commentsList = [makeResolvedRow()];
    store.setV2CommentsAdapter(adapter);

    const result = await store.reopenCommentV2({ superdoc, commentId: 'c1' });

    expect(result.ok).toBe(true);
    expect(store.commentsList[0].resolvedTime).toBeNull();
    expect(superdoc.emit).toHaveBeenCalledWith(
      'comments-update',
      expect.objectContaining({
        type: store.COMMENT_EVENTS.UPDATE,
        comment: expect.objectContaining({ commentId: 'c1', resolvedTime: null }),
        changes: [{ key: 'resolvedTime', value: null }],
      }),
    );
  });

  it('fails instead of reporting success when the reopened thread is missing from the refreshed v2 list', async () => {
    const adapter = makeAdapter([]);
    const superdoc = makeSuperdoc(adapter);
    store.commentsList = [makeResolvedRow()];
    store.setV2CommentsAdapter(adapter);

    const result = await store.reopenCommentV2({ superdoc, commentId: 'c1' });

    expect(result).toMatchObject({
      ok: false,
      committed: true,
      reason: 'v2-reopen-refresh-missing',
    });
    expect(store.commentsList).toEqual([expect.objectContaining({ commentId: 'c1', resolvedTime: 1234 })]);
    expect(superdoc.emit).toHaveBeenCalledWith(
      'comments-update',
      expect.objectContaining({
        rejected: true,
        committed: true,
        reason: 'v2-reopen-refresh-missing',
      }),
    );
  });

  it('fails instead of reporting success when the refreshed v2 list still marks the thread resolved', async () => {
    const adapter = makeAdapter([
      {
        commentId: 'c1',
        fileId: 'doc-1',
        commentText: 'Thread body',
        resolvedTime: 5678,
      },
    ]);
    const superdoc = makeSuperdoc(adapter);
    store.commentsList = [makeResolvedRow()];
    store.setV2CommentsAdapter(adapter);

    const result = await store.reopenCommentV2({ superdoc, commentId: 'c1' });

    expect(result).toMatchObject({
      ok: false,
      committed: true,
      reason: 'v2-reopen-refresh-still-resolved',
    });
    expect(store.commentsList).toEqual([expect.objectContaining({ commentId: 'c1', resolvedTime: 1234 })]);
    expect(superdoc.emit).toHaveBeenCalledWith(
      'comments-update',
      expect.objectContaining({
        rejected: true,
        committed: true,
        reason: 'v2-reopen-refresh-still-resolved',
      }),
    );
  });

  it('fails without reconciling when resolve refresh reports an open root with resolved replies', async () => {
    const adapter = makeAdapter([
      {
        commentId: 'c1',
        fileId: 'doc-1',
        commentText: 'Thread body',
        resolvedTime: null,
      },
      {
        commentId: 'c2',
        parentCommentId: 'c1',
        fileId: 'doc-1',
        commentText: 'Reply body',
        resolvedTime: 5678,
      },
    ]);
    const superdoc = makeSuperdoc(adapter);
    store.commentsList = [
      makeOpenRow(),
      makeOpenRow({ commentId: 'c2', parentCommentId: 'c1', commentText: 'Reply body' }),
    ];
    store.setV2CommentsAdapter(adapter);

    const result = await store.resolveCommentV2({ superdoc, commentId: 'c1' });

    expect(result).toMatchObject({
      ok: false,
      committed: true,
      reason: 'v2-resolve-refresh-split-thread',
    });
    expect(store.commentsList).toEqual([
      expect.objectContaining({ commentId: 'c1', resolvedTime: null }),
      expect.objectContaining({ commentId: 'c2', resolvedTime: null }),
    ]);
    expect(superdoc.emit).toHaveBeenCalledWith(
      'comments-update',
      expect.objectContaining({
        rejected: true,
        committed: true,
        reason: 'v2-resolve-refresh-split-thread',
      }),
    );
  });

  it('does not let legacy position sync clear the resolved root after a coherent v2 resolve refresh', async () => {
    const adapter = makeAdapter([
      {
        commentId: 'c1',
        fileId: 'doc-1',
        commentText: 'Thread body',
        resolvedTime: 1111,
      },
      {
        commentId: 'c2',
        parentCommentId: 'c1',
        fileId: 'doc-1',
        commentText: 'Reply body',
        resolvedTime: 2222,
      },
    ]);
    const superdoc = makeSuperdoc(adapter);
    store.commentsList = [
      makeOpenRow(),
      makeOpenRow({ commentId: 'c2', parentCommentId: 'c1', commentText: 'Reply body' }),
    ];
    store.editorCommentPositions = { c1: { bounds: { top: 1, bottom: 2 } } };
    store.setV2CommentsAdapter(adapter);

    const result = await store.resolveCommentV2({ superdoc, commentId: 'c1' });
    store.syncResolvedCommentsWithDocument();

    expect(result.ok).toBe(true);
    expect(store.commentsList).toEqual([
      expect.objectContaining({ commentId: 'c1', resolvedTime: 1111 }),
      expect.objectContaining({ commentId: 'c2', resolvedTime: 2222 }),
    ]);
  });

  it('applies a successful resolve receipt to the local thread without waiting for readback items', async () => {
    const adapter = makeAdapter([], {
      complete: false,
      visibleWindowSource: 'mutation-receipt',
      threadLifecycle: { commentId: 'c1', status: 'resolved' },
      mutationPath: 'document-api',
    });
    const superdoc = makeSuperdoc(adapter);
    store.commentsList = [
      makeOpenRow(),
      makeOpenRow({ commentId: 'c2', parentCommentId: 'c1', commentText: 'Reply body' }),
      makeOpenRow({ commentId: 'c-unrelated', commentText: 'Keep this thread' }),
    ];
    store.setV2CommentsAdapter(adapter);

    const result = await store.resolveCommentV2({ superdoc, commentId: 'c1' });

    expect(result).toMatchObject({
      ok: true,
      complete: false,
      visibleWindowSource: 'mutation-receipt',
      mutationPath: 'document-api',
    });
    expect(store.commentsList).toEqual([
      expect.objectContaining({ commentId: 'c1', resolvedTime: expect.any(Number) }),
      expect.objectContaining({ commentId: 'c2', resolvedTime: expect.any(Number) }),
      expect.objectContaining({ commentId: 'c-unrelated', resolvedTime: null }),
    ]);
    expect(adapter.mapV2CommentToUseCommentInput).not.toHaveBeenCalled();
  });

  it('applies a successful reopen receipt to the local thread without waiting for readback items', async () => {
    const adapter = makeAdapter([], {
      complete: false,
      visibleWindowSource: 'mutation-receipt',
      threadLifecycle: { commentId: 'c1', status: 'open' },
    });
    const superdoc = makeSuperdoc(adapter);
    store.commentsList = [
      makeResolvedRow(),
      makeResolvedRow({ commentId: 'c2', parentCommentId: 'c1', commentText: 'Reply body' }),
    ];
    store.setV2CommentsAdapter(adapter);

    const result = await store.reopenCommentV2({ superdoc, commentId: 'c1' });

    expect(result).toMatchObject({
      ok: true,
      complete: false,
      visibleWindowSource: 'mutation-receipt',
    });
    expect(store.commentsList).toEqual([
      expect.objectContaining({ commentId: 'c1', resolvedTime: null }),
      expect.objectContaining({ commentId: 'c2', resolvedTime: null }),
    ]);
    expect(adapter.mapV2CommentToUseCommentInput).not.toHaveBeenCalled();
  });

  it('merges a bounded resolve result without pruning unrelated hydrated comments', async () => {
    const adapter = makeAdapter([makeResolvedRow({ resolvedTime: 1111 })], {
      complete: false,
      visibleWindowSource: 'mutation-targets',
    });
    const superdoc = makeSuperdoc(adapter);
    store.commentsList = [makeOpenRow(), makeOpenRow({ commentId: 'c-unrelated', commentText: 'Keep this thread' })];
    store.setV2CommentsAdapter(adapter);

    const result = await store.resolveCommentV2({ superdoc, commentId: 'c1' });

    expect(result.ok).toBe(true);
    expect(store.commentsList).toEqual([
      expect.objectContaining({ commentId: 'c1', resolvedTime: 1111 }),
      expect.objectContaining({ commentId: 'c-unrelated', commentText: 'Keep this thread' }),
    ]);
  });

  it('removes only the receipt-addressed comment thread after a v2 delete', async () => {
    const adapter = makeAdapter([]);
    adapter.delete = vi.fn(async () => ({
      ok: true,
      items: [],
      complete: false,
      visibleWindowSource: 'mutation-receipt',
      removedCommentIds: ['c1'],
      mutationPath: 'document-api',
    }));
    const superdoc = makeSuperdoc(adapter);
    store.commentsList = [
      useComment(makeOpenRow()),
      useComment(makeOpenRow({ commentId: 'c2', parentCommentId: 'c1', commentText: 'Reply' })),
      useComment(makeOpenRow({ commentId: 'c-unrelated', commentText: 'Keep this thread' })),
    ];
    store.activeComment = 'c2';
    store.setV2CommentsAdapter(adapter);

    const result = await store.deleteComment({ commentId: 'c1', superdoc });

    expect(result).toEqual({ ok: true });
    expect(adapter.delete).toHaveBeenCalledWith({ commentId: 'c1' });
    expect(store.commentsList.map((row) => row.commentId)).toEqual(['c-unrelated']);
    expect(store.activeComment).toBeNull();
    expect(adapter.mapV2CommentToUseCommentInput).not.toHaveBeenCalled();
  });
});

describe('comments-store imported tracked-change bootstrap lifecycle', () => {
  let store;
  let superdocStore;

  const makeEditor = (documentId, { onStateRead = null, throwOnStateRead = false } = {}) => {
    const transaction = { setMeta: vi.fn() };
    const state = { tr: transaction };
    const view = {
      dispatch: vi.fn(),
      isDestroyed: false,
    };
    Object.defineProperty(view, 'state', {
      configurable: true,
      get: vi.fn(() => {
        onStateRead?.();
        if (throwOnStateRead) throw new Error('view was destroyed');
        return state;
      }),
    });
    const editor = {
      options: { documentId },
      view,
    };
    return { editor, state, transaction, view };
  };

  const makeDocument = (documentId, getEditor) => ({
    id: documentId,
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    getEditor,
  });

  const processImport = (editor, documentId, replacedFile = false) =>
    store.processLoadedDocxComments({
      superdoc: { emit: vi.fn() },
      editor,
      comments: [],
      documentId,
      replacedFile,
    });

  beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    store = useCommentsStore();
    superdocStore = useSuperdocStore();
  });

  afterEach(() => {
    store.cancelImportedTrackedChangeBootstrap();
  });

  it('does not read or mutate a destroyed editor when the deferred bootstrap flushes', async () => {
    const mounted = makeEditor('doc-1');
    superdocStore.documents = [makeDocument('doc-1', () => mounted.editor)];
    store.commentsList = [makeOpenRow()];

    await processImport(mounted.editor, 'doc-1');
    mounted.editor.view = null;

    expect(() => vi.runAllTimers()).not.toThrow();
    expect(Object.getOwnPropertyDescriptor(mounted.view, 'state').get).not.toHaveBeenCalled();
    expect(mounted.view.dispatch).not.toHaveBeenCalled();
    expect(store.commentsList).toEqual([expect.objectContaining({ commentId: 'c1' })]);
  });

  it('bootstraps a live editor once from one captured state snapshot', async () => {
    const mounted = makeEditor('doc-1');
    superdocStore.documents = [makeDocument('doc-1', () => mounted.editor)];

    await processImport(mounted.editor, 'doc-1');
    vi.runAllTimers();

    const stateGetter = Object.getOwnPropertyDescriptor(mounted.view, 'state').get;
    expect(stateGetter).toHaveBeenCalledTimes(1);
    expect(mounted.transaction.setMeta).toHaveBeenCalledTimes(1);
    expect(mounted.view.dispatch).toHaveBeenCalledWith(mounted.transaction);
    expect(store.cancelImportedTrackedChangeBootstrap('doc-1')).toBe(0);
  });

  it('invalidates the old generation when a replacement reuses the document id', async () => {
    const first = makeEditor('doc-1');
    const replacement = makeEditor('doc-1');
    let currentEditor = first.editor;
    superdocStore.documents = [makeDocument('doc-1', () => currentEditor)];

    await processImport(first.editor, 'doc-1');
    currentEditor = replacement.editor;
    await processImport(replacement.editor, 'doc-1', true);
    vi.runAllTimers();

    expect(first.view.dispatch).not.toHaveBeenCalled();
    expect(replacement.view.dispatch).toHaveBeenCalledTimes(1);
  });

  it('deduplicates repeated schedules for one document and keeps the newest editor', async () => {
    const first = makeEditor('doc-1');
    const second = makeEditor('doc-1');
    let currentEditor = first.editor;
    superdocStore.documents = [makeDocument('doc-1', () => currentEditor)];

    await processImport(first.editor, 'doc-1');
    currentEditor = second.editor;
    await processImport(second.editor, 'doc-1');
    vi.runAllTimers();

    expect(first.view.dispatch).not.toHaveBeenCalled();
    expect(second.view.dispatch).toHaveBeenCalledTimes(1);
  });

  it('cancels pending work when the document is removed even if it has no comment rows', async () => {
    const mounted = makeEditor('doc-1');
    superdocStore.documents = [makeDocument('doc-1', () => mounted.editor)];

    await processImport(mounted.editor, 'doc-1');
    store.removeCommentsForDocument('doc-1');
    vi.runAllTimers();

    expect(mounted.view.dispatch).not.toHaveBeenCalled();
  });

  it('cancels one document without invalidating another document bootstrap', async () => {
    const first = makeEditor('doc-1');
    const second = makeEditor('doc-2');
    superdocStore.documents = [makeDocument('doc-1', () => first.editor), makeDocument('doc-2', () => second.editor)];

    await processImport(first.editor, 'doc-1');
    await processImport(second.editor, 'doc-2');
    expect(store.cancelImportedTrackedChangeBootstrap('doc-1')).toBe(1);
    vi.runAllTimers();

    expect(first.view.dispatch).not.toHaveBeenCalled();
    expect(second.view.dispatch).toHaveBeenCalledTimes(1);
  });

  it('fails closed for malformed editors and throwing view-state getters', async () => {
    const throwing = makeEditor('doc-1', { throwOnStateRead: true });
    superdocStore.documents = [makeDocument('doc-1', () => throwing.editor)];

    await processImport(throwing.editor, 'doc-1');

    expect(() => vi.runAllTimers()).not.toThrow();
    expect(throwing.view.dispatch).not.toHaveBeenCalled();
  });

  it('drops its task token when the document is no longer mounted', async () => {
    const mounted = makeEditor('doc-1');
    superdocStore.documents = [];

    await processImport(mounted.editor, 'doc-1');
    vi.runAllTimers();

    expect(mounted.view.dispatch).not.toHaveBeenCalled();
    expect(store.cancelImportedTrackedChangeBootstrap('doc-1')).toBe(0);
  });

  it('does not bootstrap after the mounted document releases its editor', async () => {
    const mounted = makeEditor('doc-1');
    superdocStore.documents = [makeDocument('doc-1', () => null)];

    await processImport(mounted.editor, 'doc-1');
    vi.runAllTimers();

    expect(Object.getOwnPropertyDescriptor(mounted.view, 'state').get).not.toHaveBeenCalled();
    expect(mounted.view.dispatch).not.toHaveBeenCalled();
    expect(store.cancelImportedTrackedChangeBootstrap('doc-1')).toBe(0);
  });

  it('rechecks its generation when teardown happens during snapshot capture', async () => {
    const mounted = makeEditor('doc-1', {
      onStateRead: () => store.cancelImportedTrackedChangeBootstrap('doc-1'),
    });
    superdocStore.documents = [makeDocument('doc-1', () => mounted.editor)];

    await processImport(mounted.editor, 'doc-1');
    vi.runAllTimers();

    expect(mounted.view.dispatch).not.toHaveBeenCalled();
    expect(store.cancelImportedTrackedChangeBootstrap('doc-1')).toBe(0);
  });
});

describe('comments-store v2 tracked-change hydration', () => {
  let store;
  let superdocStore;

  beforeEach(() => {
    setActivePinia(createPinia());
    superdocStore = useSuperdocStore();
    superdocStore.documents = [
      { id: 'doc-1', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    ];
    store = useCommentsStore();
  });

  it('normalizes and refreshes tracked-change position aliases on a canonical row', async () => {
    let aliases = ['00000029', '00000029', null];
    const adapter = {
      documentId: 'doc-1',
      listTrackedChanges: vi.fn(async () => ({ ok: true, complete: true, items: [{ id: 'tc-canonical-delete' }] })),
      mapV2TrackedChangeToCommentParams: vi.fn((item) => ({
        event: 'add',
        changeId: item.id,
        importedId: '2',
        documentId: 'doc-1',
        trackedChangeText: 'this is text',
        trackedChangeType: 'delete',
        trackedChangeDisplayType: 'delete',
        trackedChangeAnchorKey: `tc::body::${item.id}`,
        trackedChangePositionAliases: aliases,
      })),
    };
    const superdoc = {
      config: { isInternal: true },
      emit: vi.fn(),
      activeEditor: { options: { documentId: 'doc-1' } },
    };
    store.setV2TrackedChangesAdapter(adapter);

    store.reconcileTrackedChangesFromV2({
      superdoc,
      adapter,
      documentId: 'doc-1',
      items: [{ id: 'tc-canonical-delete' }],
      pruneStale: false,
    });
    expect(store.commentsList[0].trackedChangePositionAliases).toEqual(['00000029']);

    aliases = ['00000030'];
    store.reconcileTrackedChangesFromV2({
      superdoc,
      adapter,
      documentId: 'doc-1',
      items: [{ id: 'tc-canonical-delete' }],
      pruneStale: false,
    });
    expect(store.commentsList[0].trackedChangePositionAliases).toEqual(['00000030']);
    expect(store.commentsList[0].getValues().trackedChangePositionAliases).toEqual(['00000030']);
  });

  it('compacts duplicate body tracked-change rows during reconciliation', () => {
    const identity = {
      commentId: 'tc-rewrite',
      importedId: '1',
      trackedChangeCanonicalId: 'tc-rewrite',
      trackedChangeAnchorKey: 'tc::body::tc-rewrite',
      trackedChangePositionAliases: ['1', '2', '00000002'],
      trackedChangeStory: { kind: 'story', storyType: 'body' },
      trackedChangeStoryKind: 'body',
      trackedChangeText: 'meanings',
      trackedChangeType: 'both',
      trackedChangeDisplayType: 'both',
    };
    store.commentsList = [makeTrackedChangeRow(identity), makeTrackedChangeRow(identity)];
    const adapter = {
      documentId: 'doc-1',
      mapV2TrackedChangeToCommentParams: vi.fn(() => ({
        event: 'add',
        changeId: 'tc-rewrite',
        importedId: '1',
        documentId: 'doc-1',
        trackedChangeCanonicalId: 'tc-rewrite',
        trackedChangeAnchorKey: 'tc::body::tc-rewrite',
        trackedChangePositionAliases: ['1', '2', '00000002'],
        trackedChangeStory: { kind: 'story', storyType: 'body' },
        trackedChangeText: 'meanings',
        trackedChangeType: 'both',
        trackedChangeDisplayType: 'both',
      })),
    };
    store.setV2TrackedChangesAdapter(adapter);

    store.reconcileTrackedChangesFromV2({
      superdoc: { config: { isInternal: true }, emit: vi.fn() },
      adapter,
      documentId: 'doc-1',
      items: [{ id: 'tc-rewrite' }],
      pruneStale: false,
    });

    expect(store.commentsList).toHaveLength(1);
  });

  it('keeps the live rewrite row when compacting an earlier leftover then pruning', () => {
    const liveId = 'tc|main%3A%2Fword%2Fdocument.xml|replacement|00000004%7CwId%3A2|00000004%7CwId%3A1';
    store.commentsList = [
      makeTrackedChangeRow({
        commentId: 'tc-old',
        importedId: '1',
        trackedChangeAnchorKey: 'tc::body::tc-old',
      }),
      makeTrackedChangeRow({
        commentId: liveId,
        importedId: '1',
        trackedChangeCanonicalId: liveId,
        trackedChangeAnchorKey: `tc::body::${liveId}`,
        trackedChangePositionAliases: ['1', '2', '00000004'],
      }),
    ];
    const adapter = {
      documentId: 'doc-1',
      mapV2TrackedChangeToCommentParams: vi.fn(() => ({
        event: 'add',
        changeId: liveId,
        importedId: '1',
        documentId: 'doc-1',
        trackedChangeCanonicalId: liveId,
        trackedChangeAnchorKey: `tc::body::${liveId}`,
        trackedChangePositionAliases: ['1', '2', '00000004'],
        trackedChangeText: 'meanings',
        trackedChangeType: 'both',
        trackedChangeDisplayType: 'both',
      })),
    };
    store.setV2TrackedChangesAdapter(adapter);

    store.reconcileTrackedChangesFromV2({
      superdoc: { config: { isInternal: true }, emit: vi.fn() },
      adapter,
      documentId: 'doc-1',
      items: [{ id: liveId }],
      pruneStale: true,
    });

    const trackedRows = store.commentsList.filter((comment) => comment.trackedChange);
    expect(trackedRows).toHaveLength(1);
    expect(trackedRows[0].commentId).toBe(liveId);
    expect(trackedRows[0].trackedChangeAnchorKey).toBe(`tc::body::${liveId}`);
  });

  it('compacts duplicate body rows that share a production tracked-change id', () => {
    const commentId = 'tc|main%3A%2Fword%2Fdocument.xml|replacement|00000002%7CwId%3A2|00000002%7CwId%3A1';
    const identity = {
      commentId,
      importedId: '1',
      trackedChangeCanonicalId: commentId,
      trackedChangeAnchorKey: `tc::body::${commentId}`,
      trackedChangePositionAliases: ['1', '2', '00000002'],
      trackedChangeStory: { kind: 'story', storyType: 'body' },
      trackedChangeStoryKind: 'body',
      trackedChangeText: 'meanings',
      trackedChangeType: 'both',
      trackedChangeDisplayType: 'both',
    };
    store.commentsList = [makeTrackedChangeRow(identity), makeTrackedChangeRow(identity)];
    const adapter = {
      documentId: 'doc-1',
      mapV2TrackedChangeToCommentParams: vi.fn(() => ({
        event: 'add',
        changeId: commentId,
        importedId: '1',
        documentId: 'doc-1',
        trackedChangeCanonicalId: commentId,
        trackedChangeAnchorKey: `tc::body::${commentId}`,
        trackedChangePositionAliases: ['1', '2', '00000002'],
        trackedChangeStory: { kind: 'story', storyType: 'body' },
        trackedChangeText: 'meanings',
        trackedChangeType: 'both',
        trackedChangeDisplayType: 'both',
      })),
    };
    store.setV2TrackedChangesAdapter(adapter);

    store.reconcileTrackedChangesFromV2({
      superdoc: { config: { isInternal: true }, emit: vi.fn() },
      adapter,
      documentId: 'doc-1',
      items: [{ id: commentId }],
      pruneStale: false,
    });

    expect(store.commentsList).toHaveLength(1);
    expect(store.commentsList[0].commentId).toBe(commentId);
  });

  it('does not steal selection from a Word comment whose id collides with a tracked-change alias', () => {
    const commentId = 'tc|main%3A%2Fword%2Fdocument.xml|replacement|00000002%7CwId%3A2|00000002%7CwId%3A1';
    const identity = {
      commentId,
      importedId: '1',
      trackedChangeCanonicalId: commentId,
      trackedChangeAnchorKey: `tc::body::${commentId}`,
      trackedChangePositionAliases: ['1', '2', '00000002'],
      trackedChangeStory: { kind: 'story', storyType: 'body' },
      trackedChangeStoryKind: 'body',
      trackedChangeText: 'meanings',
      trackedChangeType: 'both',
      trackedChangeDisplayType: 'both',
    };
    store.commentsList = [
      useComment(makeOpenRow({ commentId: '2', commentText: 'real comment' })),
      makeTrackedChangeRow(identity),
      makeTrackedChangeRow(identity),
    ];
    store.activeComment = '2';
    store.activeFloatingCommentInstanceId = '2';
    const adapter = {
      documentId: 'doc-1',
      mapV2TrackedChangeToCommentParams: vi.fn(() => ({
        event: 'add',
        changeId: commentId,
        importedId: '1',
        documentId: 'doc-1',
        trackedChangeCanonicalId: commentId,
        trackedChangeAnchorKey: `tc::body::${commentId}`,
        trackedChangePositionAliases: ['1', '2', '00000002'],
        trackedChangeStory: { kind: 'story', storyType: 'body' },
        trackedChangeText: 'meanings',
        trackedChangeType: 'both',
        trackedChangeDisplayType: 'both',
      })),
    };
    store.setV2TrackedChangesAdapter(adapter);

    store.reconcileTrackedChangesFromV2({
      superdoc: { config: { isInternal: true }, emit: vi.fn() },
      adapter,
      documentId: 'doc-1',
      items: [{ id: commentId }],
      pruneStale: false,
    });

    expect(store.commentsList.map((comment) => comment.commentId)).toEqual(['2', commentId]);
    expect(store.activeComment).toBe('2');
    expect(store.activeFloatingCommentInstanceId).toBe('2');
    expect(store.getComment('2')?.commentText).toBe('real comment');
  });

  it('rewires thread parents and selection when compact drops a distinct commentId', () => {
    store.commentsList = [
      makeTrackedChangeRow({ commentId: 'tc-first', importedId: 'shared-imported' }),
      makeTrackedChangeRow({ commentId: 'tc-second', importedId: 'shared-imported' }),
      useComment({
        commentId: 'reply-1',
        fileId: 'doc-1',
        commentText: 'thread reply',
        parentCommentId: 'tc-second',
        threadingParentCommentId: 'tc-second',
        trackedChangeParentId: 'tc-second',
        trackedChangeThreadParentId: 'tc-second',
      }),
    ];
    store.activeComment = 'tc-second';
    store.activeFloatingCommentInstanceId = 'tc-second';
    const adapter = {
      documentId: 'doc-1',
      mapV2TrackedChangeToCommentParams: vi.fn(() => ({
        event: 'add',
        changeId: 'tc-first',
        importedId: 'shared-imported',
        documentId: 'doc-1',
        trackedChangeText: 'meanings',
        trackedChangeType: 'both',
        trackedChangeDisplayType: 'both',
      })),
    };
    store.setV2TrackedChangesAdapter(adapter);

    store.reconcileTrackedChangesFromV2({
      superdoc: { config: { isInternal: true }, emit: vi.fn() },
      adapter,
      documentId: 'doc-1',
      items: [{ id: 'tc-first' }],
      pruneStale: false,
    });

    expect(store.commentsList.map((comment) => comment.commentId)).toEqual(['tc-first', 'reply-1']);
    expect(store.activeComment).toBe('tc-first');
    expect(store.activeFloatingCommentInstanceId).toBe('tc-first');
    const reply = store.commentsList.find((comment) => comment.commentId === 'reply-1');
    expect(reply).toMatchObject({
      parentCommentId: 'tc-first',
      threadingParentCommentId: 'tc-first',
      trackedChangeParentId: 'tc-first',
      trackedChangeThreadParentId: 'tc-first',
    });
    expect(reply?.getValues()).toMatchObject({
      parentCommentId: 'tc-first',
      threadingParentCommentId: 'tc-first',
      trackedChangeParentId: 'tc-first',
      trackedChangeThreadParentId: 'tc-first',
    });
  });

  it('keeps synthetic move-side identities separate from shared canonical aliases', () => {
    compactTrackedChangeRows(store, [
      makeTrackedChangeRow({
        commentId: 'move-from',
        importedId: 'shared-imported',
        trackedChangeCanonicalId: 'move',
        trackedChangePositionAliases: ['shared-position'],
      }),
      makeTrackedChangeRow({
        commentId: 'move-to',
        importedId: 'shared-imported',
        trackedChangeCanonicalId: 'move',
        trackedChangePositionAliases: ['shared-position'],
      }),
    ]);

    expect(store.commentsList.map((comment) => comment.commentId)).toEqual(['move-from', 'move-to']);
  });

  it('compacts transitive tracked-change identity groups into the earliest row', () => {
    compactTrackedChangeRows(store, [
      makeTrackedChangeRow({ commentId: 'tc-first', importedId: 'identity-a' }),
      makeTrackedChangeRow({
        commentId: 'tc-second',
        importedId: 'identity-a',
        trackedChangePositionAliases: ['identity-b'],
      }),
      makeTrackedChangeRow({ commentId: 'tc-third', trackedChangePositionAliases: ['identity-b'] }),
    ]);

    expect(store.commentsList).toHaveLength(1);
    expect(store.commentsList[0].commentId).toBe('tc-first');
    expect(store.commentsList[0].trackedChangePositionAliases).toEqual(
      expect.arrayContaining(['tc-second', 'tc-third', 'identity-b']),
    );
  });

  it('normalizes merged aliases before removing duplicate rows', () => {
    compactTrackedChangeRows(store, [
      makeTrackedChangeRow({
        commentId: 'tc-first',
        importedId: 'shared-imported',
        trackedChangePositionAliases: ['shared-position', 'shared-position'],
      }),
      makeTrackedChangeRow({
        commentId: 'tc-second',
        importedId: 'shared-imported',
        trackedChangePositionAliases: ['shared-position', 'second-position'],
      }),
    ]);

    expect(store.commentsList[0].trackedChangePositionAliases).toEqual([
      'shared-position',
      'tc-second',
      'shared-imported',
      'second-position',
    ]);
  });

  it('keeps resolved lifecycle metadata when compacting a duplicate', () => {
    const resolvedAt = 1_700_000_000_000;
    compactTrackedChangeRows(store, [
      makeTrackedChangeRow({ commentId: 'tc-first', importedId: 'shared-imported' }),
      makeTrackedChangeRow({
        commentId: 'tc-second',
        importedId: 'shared-imported',
        resolvedTime: resolvedAt,
        resolvedById: 'reviewer-1',
        resolvedByEmail: 'reviewer@example.com',
        resolvedByName: 'Reviewer',
        trackedChangeDecision: 'accept',
      }),
    ]);

    expect(store.commentsList).toHaveLength(1);
    expect(store.commentsList[0]).toMatchObject({
      commentId: 'tc-first',
      resolvedTime: resolvedAt,
      resolvedById: 'reviewer-1',
      resolvedByEmail: 'reviewer@example.com',
      resolvedByName: 'Reviewer',
      trackedChangeDecision: 'accept',
    });
  });

  it('does not broadcast UPDATE for a resolved duplicate dropped during prune compact', () => {
    const resolvedAt = 1_700_000_000_000;
    store.commentsList = [
      makeTrackedChangeRow({
        commentId: 'tc-first',
        importedId: 'shared-imported',
        trackedChangeCanonicalId: 'tc-first',
        resolvedTime: resolvedAt,
        resolvedById: 'reviewer-1',
        resolvedByEmail: 'reviewer@example.com',
        resolvedByName: 'Reviewer',
      }),
      makeTrackedChangeRow({
        commentId: 'tc-second',
        importedId: 'shared-imported',
        trackedChangeCanonicalId: 'tc-second',
        resolvedTime: resolvedAt,
        resolvedById: 'reviewer-1',
        resolvedByEmail: 'reviewer@example.com',
        resolvedByName: 'Reviewer',
      }),
    ];
    const emit = vi.fn();
    const superdoc = {
      config: { isInternal: true, modules: {} },
      isCollaborative: false,
      emit,
      user: { id: 'reviewer-1', email: 'reviewer@example.com', name: 'Reviewer' },
    };
    const editorState = {
      tr: {
        setMeta: vi.fn(function setMeta() {
          return this;
        }),
      },
    };
    const editor = {
      options: { documentId: 'doc-1' },
      isDestroyed: false,
      view: {
        state: editorState,
        isDestroyed: false,
        dispatch: vi.fn(),
      },
      state: editorState,
    };

    for (const commentId of ['tc-first', 'tc-second']) {
      store.handleTrackedChangeUpdate({
        superdoc,
        documentState: null,
        broadcastChanges: false,
        params: {
          event: 'update',
          changeId: commentId,
          documentId: 'doc-1',
          trackedChangeText: 'meanings',
          trackedChangeType: 'both',
          trackedChangeDisplayType: 'both',
        },
      });
    }
    expect(store.commentsList).toHaveLength(2);
    expect(store.commentsList.every((comment) => comment.resolvedTime == null)).toBe(true);

    emit.mockClear();
    store.syncTrackedChangeComments({ superdoc, editor, broadcastChanges: true });

    expect(store.commentsList).toHaveLength(1);
    expect(store.commentsList[0].commentId).toBe('tc-first');
    expect(store.commentsList[0].resolvedTime).toBe(resolvedAt);

    const updateEvents = emit.mock.calls
      .filter(([type]) => type === 'comments-update')
      .map(([, event]) => event)
      .filter((event) => event?.type === store.COMMENT_EVENTS.UPDATE);
    expect(updateEvents).toHaveLength(1);
    expect(updateEvents[0].comment.commentId).toBe('tc-first');
    expect(updateEvents.some((event) => event.comment?.commentId === 'tc-second')).toBe(false);
  });

  for (const { label, sharedIdentity } of [
    { label: 'imported id', sharedIdentity: { importedId: 'shared-imported' } },
    { label: 'anchor key', sharedIdentity: { trackedChangeAnchorKey: 'tc::body::shared-anchor' } },
    { label: 'position alias', sharedIdentity: { trackedChangePositionAliases: ['shared-position'] } },
  ]) {
    it(`compacts body tracked-change rows that share a ${label}`, () => {
      store.commentsList = [
        makeTrackedChangeRow({ commentId: 'tc-first', ...sharedIdentity }),
        makeTrackedChangeRow({ commentId: 'tc-second', ...sharedIdentity }),
      ];
      const adapter = {
        documentId: 'doc-1',
        mapV2TrackedChangeToCommentParams: vi.fn(() => ({
          event: 'add',
          changeId: 'tc-first',
          documentId: 'doc-1',
          trackedChangeText: 'meanings',
          trackedChangeType: 'both',
          trackedChangeDisplayType: 'both',
          ...sharedIdentity,
        })),
      };
      store.setV2TrackedChangesAdapter(adapter);

      store.reconcileTrackedChangesFromV2({
        superdoc: { config: { isInternal: true }, emit: vi.fn() },
        adapter,
        documentId: 'doc-1',
        items: [{ id: 'tc-first' }],
        pruneStale: false,
      });

      expect(store.commentsList).toHaveLength(1);
      expect(store.commentsList[0].trackedChangePositionAliases).toEqual(expect.arrayContaining(['tc-second']));
    });
  }

  it.each(['accept', 'reject'])(
    'removes only the compacted survivor on sidebar %s and leaves other rows',
    async (decision) => {
      store.commentsList = [
        useComment(makeOpenRow({ commentId: 'ordinary-comment', commentText: 'keep' })),
        makeTrackedChangeRow({ commentId: 'tc-first', importedId: 'shared-imported' }),
        makeTrackedChangeRow({ commentId: 'tc-second', importedId: 'shared-imported' }),
      ];
      const hydrateAdapter = {
        documentId: 'doc-1',
        mapV2TrackedChangeToCommentParams: vi.fn(() => ({
          event: 'add',
          changeId: 'tc-first',
          importedId: 'shared-imported',
          documentId: 'doc-1',
          trackedChangeText: 'meanings',
          trackedChangeType: 'both',
          trackedChangeDisplayType: 'both',
        })),
      };
      store.setV2TrackedChangesAdapter(hydrateAdapter);
      store.reconcileTrackedChangesFromV2({
        superdoc: { config: { isInternal: true }, emit: vi.fn() },
        adapter: hydrateAdapter,
        documentId: 'doc-1',
        items: [{ id: 'tc-first' }],
        pruneStale: false,
      });

      const survivor = store.commentsList.find((comment) => comment.trackedChange);
      expect(store.commentsList.map((comment) => comment.commentId)).toEqual(['ordinary-comment', 'tc-first']);
      expect(survivor?.trackedChangePositionAliases).toEqual(expect.arrayContaining(['tc-second']));

      const commentsAdapter = {
        documentId: 'doc-1',
        refresh: vi.fn(async () => ({ ok: true, items: [] })),
        mapV2CommentToUseCommentInput: vi.fn((item) => item),
      };
      const trackedChangesAdapter = {
        documentId: 'doc-1',
        accept: vi.fn(async () => ({
          ok: true,
          receipt: { success: true },
          decidedId: 'tc-first',
          documentId: 'doc-1',
        })),
        reject: vi.fn(async () => ({
          ok: true,
          receipt: { success: true },
          decidedId: 'tc-first',
          documentId: 'doc-1',
        })),
        listTrackedChanges: vi.fn(async () => ({ ok: true, complete: true, items: [] })),
        mapV2TrackedChangeToCommentParams: vi.fn(() => null),
        clearActiveTrackedChangeTargetIfMatches: vi.fn(),
      };
      const superdoc = {
        activeEditor: {
          editorVersion: 2,
          documentId: 'doc-1',
          v2Comments: commentsAdapter,
          v2TrackedChanges: trackedChangesAdapter,
        },
        emit: vi.fn(),
      };
      store.setV2CommentsAdapter(commentsAdapter);
      store.setV2TrackedChangesAdapter(trackedChangesAdapter);

      const result = await store.decideTrackedChangeFromSidebar({ superdoc, comment: survivor, decision });

      expect(result).toMatchObject({ ok: true, success: true });
      expect(trackedChangesAdapter[decision]).toHaveBeenCalledTimes(1);
      expect(trackedChangesAdapter[decision]).toHaveBeenCalledWith(survivor);
      expect(trackedChangesAdapter[decision === 'accept' ? 'reject' : 'accept']).not.toHaveBeenCalled();
      expect(store.commentsList.map((comment) => comment.commentId)).toEqual(['ordinary-comment']);
    },
  );

  it('does not merge tracked-change rows from different stories when they share a position alias', async () => {
    const items = [
      {
        id: 'tc-body-delete',
        text: 'body text',
        anchorKey: 'tc::body::tc-body-delete',
        story: { kind: 'story', storyType: 'body' },
      },
      {
        id: 'tc-header-delete',
        text: 'header text',
        anchorKey: 'tc::hf:rId-header::tc-header-delete',
        story: { kind: 'story', storyType: 'headerFooterPart', refId: 'rId-header' },
      },
    ];
    const adapter = {
      documentId: 'doc-1',
      listTrackedChanges: vi.fn(async () => ({ ok: true, complete: true, items })),
      mapV2TrackedChangeToCommentParams: vi.fn((item) => ({
        event: 'add',
        changeId: item.id,
        documentId: 'doc-1',
        trackedChangeText: item.text,
        trackedChangeType: 'delete',
        trackedChangeDisplayType: 'delete',
        trackedChangeAnchorKey: item.anchorKey,
        trackedChangeStory: item.story,
        trackedChangePositionAliases: ['00000029'],
      })),
    };
    const superdoc = {
      config: { isInternal: true },
      emit: vi.fn(),
      activeEditor: { options: { documentId: 'doc-1' } },
    };
    store.setV2TrackedChangesAdapter(adapter);

    store.reconcileTrackedChangesFromV2({ superdoc, adapter, documentId: 'doc-1', items, pruneStale: false });

    expect(store.commentsList).toHaveLength(2);
    expect(store.commentsList.map((comment) => comment.commentId)).toEqual(['tc-body-delete', 'tc-header-delete']);
    expect(store.commentsList.map((comment) => comment.trackedChangeAnchorKey)).toEqual([
      'tc::body::tc-body-delete',
      'tc::hf:rId-header::tc-header-delete',
    ]);
    expect(store.commentsList.map((comment) => comment.trackedChangeText)).toEqual(['body text', 'header text']);
  });

  it('reconciles 1,300 tracked rows through one batch identity index', async () => {
    const rowCount = 1_300;
    const items = Array.from({ length: rowCount }, (_, index) => ({
      id: `tc-${index}`,
      importedId: `imported-${index}`,
      canonicalId: `canonical-${index}`,
      anchorKey: `tc::body::tc-${index}`,
    }));
    const adapter = {
      documentId: 'doc-1',
      listTrackedChanges: vi.fn(async () => ({
        ok: true,
        complete: true,
        sourceCoverageComplete: true,
        items,
      })),
      mapV2TrackedChangeToCommentParams: vi.fn((item) => ({
        event: 'add',
        changeId: item.id,
        importedId: item.importedId,
        documentId: 'doc-1',
        trackedChangeText: `updated ${item.id}`,
        trackedChangeType: 'insert',
        trackedChangeDisplayType: 'insert',
        trackedChangeCanonicalId: item.canonicalId,
        trackedChangeAnchorKey: item.anchorKey,
      })),
    };
    const ordinaryComment = useComment(makeOpenRow({ commentId: 'ordinary-comment' }));
    store.commentsList = [
      ...items.map((item) =>
        makeTrackedChangeRow({
          commentId: item.id,
          importedId: item.importedId,
          trackedChangeCanonicalId: item.canonicalId,
          trackedChangeAnchorKey: item.anchorKey,
        }),
      ),
      ordinaryComment,
    ];
    store.setV2TrackedChangesAdapter(adapter);
    let batchWork = null;
    const previousTrace = globalThis.__superdocInteractionTrace;
    globalThis.__superdocInteractionTrace = {
      startSpan: (stage) => ({ traceId: 'batch-test', spanId: stage }),
      endSpan: (span, meta) => {
        if (span?.spanId === 'store.trackedChanges.batchIdentity') batchWork = meta;
      },
    };

    try {
      store.reconcileTrackedChangesFromV2({ adapter, documentId: 'doc-1', items, pruneStale: false });
    } finally {
      if (previousTrace === undefined) delete globalThis.__superdocInteractionTrace;
      else globalThis.__superdocInteractionTrace = previousTrace;
    }

    expect(store.commentsList).toHaveLength(rowCount + 1);
    expect(store.commentsList[0].trackedChangeText).toBe('updated tc-0');
    expect(store.commentsList[rowCount - 1].trackedChangeText).toBe('updated tc-1299');
    expect(store.commentsList).toContain(ordinaryComment);
    expect(batchWork).toMatchObject({
      trackedRowsIndexed: rowCount,
      invalidatedIdMembershipChecks: 0,
      candidateVisits: rowCount * 4,
    });
    expect(batchWork.incomingAliasLookups).toBeLessThanOrEqual(rowCount * 6);
  });

  it('does not acknowledge all-resolved reconciliation without a document scope', async () => {
    const adapter = {
      documentId: null,
      mapV2TrackedChangeToCommentParams: vi.fn(),
    };
    store.setV2TrackedChangesAdapter(adapter);
    store.commentsList = [makeTrackedChangeRow()];

    await expect(
      store.reconcileTrackedChangeMutationFromV2({
        adapter,
        allResolved: { logicalTargetCount: 1, physicalCarrierCount: 1 },
      }),
    ).resolves.toEqual({ ok: false, reason: 'document-id-missing' });
    expect(store.commentsList).toHaveLength(1);
  });

  it('leaves receipt upserts to the next committed review window without reading', async () => {
    const adapter = {
      documentId: 'doc-1',
      listTrackedChanges: vi.fn(),
      getTrackedChange: vi.fn(async () => ({ ok: true, items: [{ id: 'tc-1', excerpt: 'new text' }] })),
      mapV2TrackedChangeToCommentParams: vi.fn((item) => ({
        event: 'add',
        changeId: item.id,
        documentId: 'doc-1',
        trackedChangeText: item.excerpt,
        trackedChangeType: 'insert',
        trackedChangeDisplayType: 'insert',
        trackedChangeAnchorKey: `tc::body::${item.id}`,
      })),
    };
    const superdoc = {
      config: { isInternal: true },
      emit: vi.fn(),
      activeEditor: { documentId: 'doc-1', v2TrackedChanges: adapter },
    };
    store.commentsList = [makeTrackedChangeRow({ commentId: 'tc-1', trackedChangeText: 'old text' })];
    store.setV2TrackedChangesAdapter(adapter);

    const result = await store.reconcileTrackedChangeMutationFromV2({
      superdoc,
      adapter,
      documentId: 'doc-1',
      upsertIds: new Set(['tc-1']),
    });

    expect(result).toMatchObject({ ok: true, items: [], resolvedIds: [], unresolvedIds: ['tc-1'] });
    expect(adapter.getTrackedChange).not.toHaveBeenCalled();
    expect(adapter.listTrackedChanges).not.toHaveBeenCalled();
    expect(store.commentsList[0].trackedChangeText).toBe('old text');
  });

  it('keeps a receipt identity unresolved when its narrow read succeeds before the row is observable', async () => {
    const adapter = {
      documentId: 'doc-1',
      getTrackedChange: vi.fn(async () => ({ ok: true, items: [] })),
      mapV2TrackedChangeToCommentParams: vi.fn(),
    };
    const superdoc = {
      activeEditor: { documentId: 'doc-1', v2TrackedChanges: adapter },
      emit: vi.fn(),
    };
    store.setV2TrackedChangesAdapter(adapter);

    await expect(
      store.reconcileTrackedChangeMutationFromV2({
        superdoc,
        adapter,
        documentId: 'doc-1',
        upsertIds: new Set(['tc-1']),
      }),
    ).resolves.toMatchObject({
      ok: true,
      items: [],
      resolvedIds: [],
      unresolvedIds: ['tc-1'],
    });
  });

  it('does not merge a row returned for a different receipt identity', async () => {
    const adapter = {
      documentId: 'doc-1',
      getTrackedChange: vi.fn(async () => ({ ok: true, items: [{ id: 'tc-other', excerpt: 'wrong row' }] })),
      mapV2TrackedChangeToCommentParams: vi.fn(),
    };
    const superdoc = {
      activeEditor: { documentId: 'doc-1', v2TrackedChanges: adapter },
      emit: vi.fn(),
    };
    store.setV2TrackedChangesAdapter(adapter);

    const result = await store.reconcileTrackedChangeMutationFromV2({
      superdoc,
      adapter,
      documentId: 'doc-1',
      upsertIds: new Set(['tc-1']),
    });

    expect(result).toMatchObject({ ok: true, items: [], resolvedIds: [], unresolvedIds: ['tc-1'] });
    expect(adapter.getTrackedChange).not.toHaveBeenCalled();
    expect(adapter.mapV2TrackedChangeToCommentParams).not.toHaveBeenCalled();
  });

  it('does not project a new formatting row before the committed window arrives', async () => {
    const adapter = {
      documentId: 'doc-1',
      listTrackedChanges: vi.fn(),
      getTrackedChange: vi.fn(async () => ({
        ok: true,
        items: [
          {
            id: 'tc-format-1',
            type: 'formatting',
            subtype: 'run-formatting',
            formattingDeltaSummary: 'run formatting revision: font: none -> Arial',
          },
        ],
      })),
      mapV2TrackedChangeToCommentParams: vi.fn((item) => ({
        event: 'add',
        changeId: item.id,
        documentId: 'doc-1',
        trackedChangeText: 'font family Arial',
        trackedChangeType: 'trackFormat',
        trackedChangeDisplayType: 'format',
        trackedChangeLabel: 'Format: Font (Default) Arial',
        trackedChangeAnchorKey: `tc::body::${item.id}`,
      })),
    };
    const superdoc = {
      config: { isInternal: true },
      emit: vi.fn(),
      activeEditor: { documentId: 'doc-1', v2TrackedChanges: adapter },
    };
    store.setV2TrackedChangesAdapter(adapter);

    const result = await store.reconcileTrackedChangeMutationFromV2({
      superdoc,
      adapter,
      documentId: 'doc-1',
      upsertIds: new Set(['tc-format-1']),
    });

    expect(result).toMatchObject({ ok: true, items: [], resolvedIds: [], unresolvedIds: ['tc-format-1'] });
    expect(adapter.getTrackedChange).not.toHaveBeenCalled();
    expect(adapter.listTrackedChanges).not.toHaveBeenCalled();
    expect(store.commentsList).toHaveLength(0);
  });

  it('does not enumerate grouped delete aliases from a receipt', async () => {
    const adapter = {
      documentId: 'doc-1',
      listTrackedChanges: vi.fn(),
      getTrackedChange: vi.fn(async () => ({
        ok: true,
        items: [
          {
            id: 'tc-delete-group',
            type: 'deletion',
            text: 'deleted across carriers',
            trackedChangePositionAliases: ['tc-delete-child-a', 'tc-delete-child-b'],
          },
        ],
      })),
      mapV2TrackedChangeToCommentParams: vi.fn((item) => ({
        event: 'add',
        changeId: item.id,
        documentId: 'doc-1',
        trackedChangeText: item.text,
        trackedChangeType: 'delete',
        trackedChangeDisplayType: 'delete',
        trackedChangeLabel: 'Deleted',
        trackedChangeAnchorKey: `tc::body::${item.id}`,
        trackedChangePositionAliases: ['tc-delete-child-a', 'tc-delete-child-b'],
      })),
    };
    const superdoc = {
      config: { isInternal: true },
      emit: vi.fn(),
      activeEditor: { documentId: 'doc-1', v2TrackedChanges: adapter },
    };
    store.setV2TrackedChangesAdapter(adapter);

    const result = await store.reconcileTrackedChangeMutationFromV2({
      superdoc,
      adapter,
      documentId: 'doc-1',
      upsertIds: new Set(['tc-delete-child-a', 'tc-delete-child-b']),
    });

    expect(result).toMatchObject({
      ok: true,
      items: [],
      resolvedIds: [],
      unresolvedIds: ['tc-delete-child-a', 'tc-delete-child-b'],
    });
    expect(adapter.getTrackedChange).not.toHaveBeenCalled();
    expect(adapter.listTrackedChanges).not.toHaveBeenCalled();
    expect(store.commentsList).toHaveLength(0);
  });

  it('keeps repeated receipt upserts pending without issuing narrow reads', async () => {
    const getTrackedChange = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        items: [
          {
            id: 'tc-delete-child-a',
            revisionGroupId: 'tc-delete-child-a',
            type: 'deletion',
            authorEmail: 'ada@example.com',
            deletedText: 'A',
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        items: [
          {
            id: 'tc-delete-group',
            type: 'deletion',
            authorEmail: 'ada@example.com',
            deletedText: 'AB',
            trackedChangeCanonicalId: 'tc-delete-group',
            trackedChangePositionAliases: ['tc-delete-child-a', 'tc-delete-child-b'],
          },
        ],
      });
    const adapter = {
      documentId: 'doc-1',
      listTrackedChanges: vi.fn(),
      getTrackedChange,
      mapV2TrackedChangeToCommentParams: vi.fn((item) => ({
        event: 'add',
        changeId: item.id,
        documentId: 'doc-1',
        trackedChangeText: '',
        trackedChangeType: 'delete',
        trackedChangeDisplayType: 'delete',
        trackedChangeCanonicalId: item.trackedChangeCanonicalId,
        deletedText: item.deletedText,
        trackedChangeAnchorKey: `tc::body::${item.id}`,
        trackedChangePositionAliases: item.trackedChangePositionAliases,
      })),
    };
    const superdoc = {
      config: { isInternal: true },
      emit: vi.fn(),
      activeEditor: { documentId: 'doc-1', v2TrackedChanges: adapter },
    };
    store.setV2TrackedChangesAdapter(adapter);

    await store.reconcileTrackedChangeMutationFromV2({
      superdoc,
      adapter,
      documentId: 'doc-1',
      upsertIds: new Set(['tc-delete-child-a']),
    });
    await store.reconcileTrackedChangeMutationFromV2({
      superdoc,
      adapter,
      documentId: 'doc-1',
      upsertIds: new Set(['tc-delete-child-b']),
    });

    expect(getTrackedChange).not.toHaveBeenCalled();
    expect(store.commentsList).toHaveLength(0);
  });

  it('keeps last-known tracked-change geometry across a carrier-less Enter publish', () => {
    const bounds = { top: 42, left: 10, right: 110, bottom: 62, width: 100, height: 20 };
    store.commentsList = [
      makeTrackedChangeRow({
        commentId: 'tc-1',
        trackedChangeAnchorKey: 'tc::body::tc-1',
      }),
    ];

    store.handleEditorLocationsUpdate({
      'tc-1': {
        threadId: 'tc-1',
        key: 'tc::body::tc-1',
        storyKey: 'body',
        kind: 'trackedChange',
        bounds,
        pageIndex: 0,
      },
    });
    expect(store.editorCommentPositions['tc-1']?.bounds).toEqual(bounds);

    // Structural remount publish with no carriers yet — bubble must stay put
    // only when the publisher marks this as a transient annotation restamp.
    store.handleEditorLocationsUpdate({}, { retainMissingTrackedChangeGeometry: true });
    expect(store.editorCommentPositions['tc-1']?.bounds).toEqual(bounds);
    expect(store.editorCommentPositions['tc::body::tc-1']?.bounds).toEqual(bounds);

    const instances = store.getFloatingCommentInstances;
    expect(instances).toHaveLength(1);
    expect(instances[0].positionEntry?.bounds).toEqual(bounds);
  });

  it('retains first-line TC geometry when only the painted raw id was published', () => {
    const bounds = { top: 18, left: 4, right: 40, bottom: 30, width: 36, height: 12 };
    store.commentsList = [
      makeTrackedChangeRow({
        commentId: 'tc-first',
        trackedChangeAnchorKey: null,
      }),
    ];

    store.handleEditorLocationsUpdate({
      'tc-first': {
        threadId: 'tc-first',
        key: 'tc-first',
        storyKey: 'body',
        kind: 'trackedChange',
        bounds,
        pageIndex: 0,
      },
    });

    store.handleEditorLocationsUpdate({}, { retainMissingTrackedChangeGeometry: true });
    expect(store.editorCommentPositions['tc-first']?.bounds).toEqual(bounds);
    expect(store.getFloatingCommentInstances[0]?.positionEntry?.bounds).toEqual(bounds);
  });

  it('clears stale tracked-change geometry on ordinary missing-carrier updates without dropping the row', () => {
    const bounds = { top: 42, left: 10, right: 110, bottom: 62, width: 100, height: 20 };
    store.commentsList = [
      makeTrackedChangeRow({
        commentId: 'tc-1',
        trackedChangeAnchorKey: 'tc::body::tc-1',
      }),
    ];

    store.handleEditorLocationsUpdate({
      'tc-1': {
        threadId: 'tc-1',
        key: 'tc::body::tc-1',
        storyKey: 'body',
        kind: 'trackedChange',
        bounds,
        pageIndex: 0,
      },
    });
    expect(store.editorCommentPositions['tc-1']?.bounds).toEqual(bounds);

    store.handleEditorLocationsUpdate({});
    expect(store.editorCommentPositions['tc-1']).toBeUndefined();
    expect(store.editorCommentPositions['tc::body::tc-1']).toBeUndefined();
    expect(store.getFloatingComments.map((comment) => comment.commentId)).toContain('tc-1');
    expect(store.getFloatingCommentInstances[0]?.positionEntry).toBeNull();
  });

  it('only retains missing tracked-change geometry for the requested restamp ids', () => {
    const firstBounds = { top: 42, left: 10, right: 110, bottom: 62, width: 100, height: 20 };
    const secondBounds = { top: 142, left: 10, right: 110, bottom: 162, width: 100, height: 20 };
    store.commentsList = [
      makeTrackedChangeRow({
        commentId: 'tc-1',
        trackedChangeAnchorKey: 'tc::body::tc-1',
      }),
      makeTrackedChangeRow({
        commentId: 'tc-2',
        trackedChangeAnchorKey: 'tc::body::tc-2',
      }),
    ];

    store.handleEditorLocationsUpdate({
      'tc-1': {
        threadId: 'tc-1',
        key: 'tc::body::tc-1',
        storyKey: 'body',
        kind: 'trackedChange',
        bounds: firstBounds,
        pageIndex: 0,
      },
      'tc-2': {
        threadId: 'tc-2',
        key: 'tc::body::tc-2',
        storyKey: 'body',
        kind: 'trackedChange',
        bounds: secondBounds,
        pageIndex: 0,
      },
    });

    store.handleEditorLocationsUpdate(
      {},
      {
        retainMissingTrackedChangeGeometry: true,
        retainedTrackedChangeIds: ['tc-1'],
      },
    );
    expect(store.editorCommentPositions['tc-1']?.bounds).toEqual(firstBounds);
    expect(store.editorCommentPositions['tc::body::tc-1']?.bounds).toEqual(firstBounds);
    expect(store.editorCommentPositions['tc-2']).toBeUndefined();
    expect(store.editorCommentPositions['tc::body::tc-2']).toBeUndefined();
  });

  it('drops receipt-addressed removed rows before any async refresh', async () => {
    const adapter = makeTrackedChangesAdapter({ ok: true, items: [] });
    adapter.getTrackedChange = vi.fn();
    const superdoc = {
      config: { isInternal: true },
      activeEditor: { documentId: 'doc-1', v2TrackedChanges: adapter },
      emit: vi.fn(),
    };
    store.commentsList = [makeTrackedChangeRow({ commentId: 'tc-1' })];
    store.setV2TrackedChangesAdapter(adapter);

    const pending = store.reconcileTrackedChangeMutationFromV2({
      superdoc,
      adapter,
      documentId: 'doc-1',
      removedIds: new Set(['tc-1']),
    });

    expect(store.commentsList).toHaveLength(0);
    await expect(pending).resolves.toMatchObject({ ok: true, items: [] });
    expect(adapter.getTrackedChange).not.toHaveBeenCalled();
  });

  it('remaps a live tracked-change identity in place so the comments list never drops the row', () => {
    const bounds = { top: 24, left: 0, right: 40, bottom: 40, width: 40, height: 16 };
    store.commentsList = [
      makeTrackedChangeRow({
        commentId: 'tc-old',
        trackedChangeAnchorKey: 'tc::body::tc-old',
      }),
      useComment({
        commentId: 'reply-1',
        fileId: 'doc-1',
        commentText: 'thread reply',
        parentCommentId: 'tc-old',
        threadingParentCommentId: 'tc-old',
        trackedChangeParentId: 'tc-old',
        trackedChangeThreadParentId: 'tc-old',
      }),
    ];
    store.handleEditorLocationsUpdate({
      'tc-old': {
        threadId: 'tc-old',
        key: 'tc::body::tc-old',
        storyKey: 'body',
        kind: 'trackedChange',
        bounds,
        pageIndex: 0,
      },
    });
    store.activeComment = 'tc-old';

    store.remapTrackedChangeIdentities([{ from: 'tc-old', to: 'tc-new' }], { documentId: 'doc-1' });

    expect(store.commentsList).toHaveLength(2);
    const remapped = store.commentsList.find((comment) => comment.commentId === 'tc-new');
    const reply = store.commentsList.find((comment) => comment.commentId === 'reply-1');
    expect(remapped?.trackedChangeAnchorKey).toBe('tc::body::tc-new');
    expect(store.activeComment).toBe('tc-new');
    expect(store.editorCommentPositions['tc-new']?.bounds).toEqual(bounds);
    expect(reply?.parentCommentId).toBe('tc-new');
    expect(reply?.threadingParentCommentId).toBe('tc-new');
    expect(reply?.trackedChangeParentId).toBe('tc-new');
    expect(reply?.trackedChangeThreadParentId).toBe('tc-new');
    expect(remapped?.getValues()).toMatchObject({ commentId: 'tc-new' });
    expect(reply?.getValues()).toMatchObject({
      commentId: 'reply-1',
      parentCommentId: 'tc-new',
      threadingParentCommentId: 'tc-new',
      trackedChangeParentId: 'tc-new',
      trackedChangeThreadParentId: 'tc-new',
    });
    expect(store.getFloatingComments.map((comment) => comment.commentId)).toEqual(['tc-new']);
  });

  it('advances repeated grouped remaps from one stable source without dropping geometry', () => {
    const sourceId = 'tc-source';
    const firstGroupId = 'tc-group-first';
    const secondGroupId = 'tc-group-second';
    const firstBounds = { top: 24, left: 0, right: 40, bottom: 40, width: 40, height: 16 };
    const secondBounds = { top: 48, left: 0, right: 72, bottom: 64, width: 72, height: 16 };
    store.commentsList = [
      makeTrackedChangeRow({
        commentId: sourceId,
        importedId: '1',
        trackedChangeCanonicalId: sourceId,
        trackedChangeAnchorKey: `tc::body::${sourceId}`,
        trackedChangePositionAliases: ['1'],
      }),
      useComment({
        commentId: 'reply-1',
        fileId: 'doc-1',
        commentText: 'thread reply',
        parentCommentId: sourceId,
        trackedChangeThreadParentId: sourceId,
      }),
    ];
    store.handleEditorLocationsUpdate({
      [sourceId]: {
        threadId: sourceId,
        key: `tc::body::${sourceId}`,
        storyKey: 'body',
        kind: 'trackedChange',
        bounds: firstBounds,
        pageIndex: 0,
      },
    });

    store.remapTrackedChangeIdentities([{ from: sourceId, to: firstGroupId }], { documentId: 'doc-1' });
    store.handleEditorLocationsUpdate({
      [firstGroupId]: {
        threadId: firstGroupId,
        key: `tc::body::${firstGroupId}`,
        storyKey: 'body',
        kind: 'trackedChange',
        bounds: secondBounds,
        pageIndex: 0,
      },
    });
    store.activeComment = firstGroupId;
    store.activeFloatingCommentInstanceId = firstGroupId;

    // The next receipt still originates from sourceId even though the live row
    // already carries firstGroupId.
    store.remapTrackedChangeIdentities([{ from: sourceId, to: secondGroupId }], { documentId: 'doc-1' });

    const remapped = store.commentsList.find((comment) => comment.trackedChange);
    const reply = store.commentsList.find((comment) => comment.commentId === 'reply-1');
    expect(remapped).toMatchObject({
      commentId: secondGroupId,
      trackedChangeCanonicalId: secondGroupId,
      trackedChangeAnchorKey: `tc::body::${secondGroupId}`,
    });
    expect(remapped.trackedChangePositionAliases).toEqual(expect.arrayContaining(['1', sourceId]));
    expect(reply).toMatchObject({ parentCommentId: secondGroupId, trackedChangeThreadParentId: secondGroupId });
    expect(store.activeComment).toBe(secondGroupId);
    expect(store.activeFloatingCommentInstanceId).toBe(secondGroupId);
    expect(store.editorCommentPositions[secondGroupId]?.bounds).toEqual(secondBounds);
    expect(store.getFloatingCommentInstances[0]).toMatchObject({ id: secondGroupId });
  });

  it.each(['hf:rId-header', 'hf:part:rId-footer', 'fn:1', 'en:2', 'textbox:box-1'])(
    'preserves %s tracked-change anchor story when remapping a live row',
    (storyKey) => {
      const bounds = { top: 24, left: 0, right: 40, bottom: 40, width: 40, height: 16 };
      const fromAnchor = `tc::${storyKey}::tc-old`;
      const toAnchor = `tc::${storyKey}::tc-new`;
      store.commentsList = [
        makeTrackedChangeRow({
          commentId: 'tc-old',
          trackedChangeAnchorKey: fromAnchor,
        }),
      ];
      store.handleEditorLocationsUpdate({
        [fromAnchor]: {
          threadId: 'tc-old',
          key: fromAnchor,
          storyKey,
          kind: 'trackedChange',
          bounds,
          pageIndex: 0,
        },
      });

      store.remapTrackedChangeIdentities([{ from: 'tc-old', to: 'tc-new' }], { documentId: 'doc-1' });

      const remapped = store.commentsList.find((comment) => comment.commentId === 'tc-new');
      expect(remapped?.trackedChangeAnchorKey).toBe(toAnchor);
      expect(store.editorCommentPositions[toAnchor]?.bounds).toEqual(bounds);
      expect(store.editorCommentPositions['tc::body::tc-new']).toBeUndefined();
    },
  );

  it('prefers story-scoped geometry when remapping a tracked-change id shared with the body story', () => {
    const bodyBounds = { top: 12, left: 0, right: 40, bottom: 28, width: 40, height: 16 };
    const headerBounds = { top: 96, left: 8, right: 64, bottom: 112, width: 56, height: 16 };
    const fromAnchor = 'tc::hf:rId-header::tc-shared';
    const toAnchor = 'tc::hf:rId-header::tc-remapped';
    store.commentsList = [
      makeTrackedChangeRow({
        commentId: 'tc-shared',
        trackedChangeAnchorKey: fromAnchor,
      }),
    ];
    store.handleEditorLocationsUpdate({
      'tc-shared': {
        threadId: 'tc-shared',
        key: 'tc-shared',
        storyKey: 'body',
        kind: 'trackedChange',
        bounds: bodyBounds,
        pageIndex: 0,
      },
      [fromAnchor]: {
        threadId: 'tc-shared',
        key: fromAnchor,
        storyKey: 'hf:rId-header',
        kind: 'trackedChange',
        bounds: headerBounds,
        pageIndex: 0,
      },
    });

    store.remapTrackedChangeIdentities([{ from: 'tc-shared', to: 'tc-remapped' }], { documentId: 'doc-1' });

    expect(store.editorCommentPositions[toAnchor]?.bounds).toEqual(headerBounds);
    expect(store.editorCommentPositions['tc-remapped']?.bounds).toEqual(headerBounds);
    expect(store.editorCommentPositions['tc-remapped']?.bounds).not.toEqual(bodyBounds);
  });

  it('scopes identity remaps to the emitting document when the same fromId exists elsewhere', () => {
    superdocStore.documents = [
      { id: 'doc-1', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      { id: 'doc-2', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    ];
    store.commentsList = [
      makeTrackedChangeRow({
        commentId: 'tc-shared',
        fileId: 'doc-1',
        trackedChangeAnchorKey: 'tc::body::tc-shared',
      }),
      makeTrackedChangeRow({
        commentId: 'tc-shared',
        fileId: 'doc-2',
        trackedChangeAnchorKey: 'tc::body::tc-shared',
        trackedChangeText: 'other document tracked change',
      }),
    ];

    store.remapTrackedChangeIdentities([{ from: 'tc-shared', to: 'tc-shared-remapped' }], { documentId: 'doc-1' });

    expect(store.commentsList.map((comment) => `${comment.fileId}:${comment.commentId}`).sort()).toEqual([
      'doc-1:tc-shared-remapped',
      'doc-2:tc-shared',
    ]);
  });

  it('applies mixed receipt removals and leaves replacement rows to the next window', async () => {
    const adapter = {
      documentId: 'doc-1',
      listTrackedChanges: vi.fn(),
      getTrackedChange: vi.fn(async () => ({
        ok: true,
        items: [
          {
            id: 'tc-format-group',
            type: 'formatting',
            subtype: 'paragraph-formatting',
            formattingDeltaSummary: 'paragraph formatting revision',
          },
        ],
      })),
      mapV2TrackedChangeToCommentParams: vi.fn((item) => ({
        event: 'add',
        changeId: item.id,
        documentId: 'doc-1',
        trackedChangeText: 'paragraph formatting',
        trackedChangeType: 'trackFormat',
        trackedChangeDisplayType: 'format',
        trackedChangeLabel: 'Formatted: Paragraph',
        trackedChangeAnchorKey: `tc::body::${item.id}`,
      })),
    };
    const superdoc = {
      config: { isInternal: true },
      activeEditor: { documentId: 'doc-1', v2TrackedChanges: adapter },
      emit: vi.fn(),
    };
    store.commentsList = [
      makeTrackedChangeRow({
        commentId: 'tc-format-child',
        trackedChangeText: 'old paragraph formatting',
      }),
    ];
    store.setV2TrackedChangesAdapter(adapter);

    const result = await store.reconcileTrackedChangeMutationFromV2({
      superdoc,
      adapter,
      documentId: 'doc-1',
      removedIds: new Set(['tc-format-child']),
      upsertIds: new Set(['tc-format-group']),
    });

    expect(result).toMatchObject({
      ok: true,
      items: [],
      unresolvedIds: ['tc-format-group'],
      removedIds: ['tc-format-child'],
    });
    expect(adapter.getTrackedChange).not.toHaveBeenCalled();
    expect(adapter.listTrackedChanges).not.toHaveBeenCalled();
    expect(store.commentsList).toHaveLength(0);
  });

  it('preserves semantic move color metadata on hydrated tracked-change rows', async () => {
    const adapter = {
      documentId: 'doc-1',
      listTrackedChanges: vi.fn(async () => ({
        ok: true,
        complete: true,
        items: [{ id: 'tc-move' }],
      })),
      mapV2TrackedChangeToCommentParams: vi.fn((item) => ({
        event: 'add',
        changeId: item?.id,
        documentId: 'doc-1',
        trackedChangeText: 'moved destination',
        trackedChangeType: 'insert',
        trackedChangeDisplayType: 'insert',
        trackedChangeAnchorKey: `tc::body::${item?.id}`,
        semanticColorKey: 'move-to',
        semanticColor: '#00853d',
      })),
    };
    const superdoc = {
      config: { isInternal: true },
      emit: vi.fn(),
      activeEditor: { options: { documentId: 'doc-1' } },
    };
    store.setV2TrackedChangesAdapter(adapter);

    store.reconcileTrackedChangesFromV2({
      superdoc,
      adapter,
      documentId: 'doc-1',
      items: [{ id: 'tc-move' }],
      pruneStale: false,
    });

    expect(store.commentsList).toHaveLength(1);
    expect(store.commentsList[0].getValues()).toMatchObject({
      commentId: 'tc-move',
      semanticColorKey: 'move-to',
      semanticColor: '#00853d',
    });
  });

  it('keeps paired move-side rows distinct when they share one canonical geometry anchor', async () => {
    const canonicalId = 'tc|move|1%7C101';
    const canonicalAnchorKey = `tc::body::${canonicalId}`;
    const adapter = {
      documentId: 'doc-1',
      listTrackedChanges: vi.fn(async () => ({
        ok: true,
        complete: true,
        items: [
          { id: `${canonicalId}::move-from`, subtype: 'move-from' },
          { id: `${canonicalId}::move-to`, subtype: 'move-to' },
        ],
      })),
      mapV2TrackedChangeToCommentParams: vi.fn((item) => ({
        event: 'add',
        changeId: item.id,
        trackedChangeCanonicalId: canonicalId,
        documentId: 'doc-1',
        trackedChangeText: item.subtype === 'move-to' ? 'moved destination' : '',
        deletedText: item.subtype === 'move-from' ? 'moved source' : null,
        trackedChangeType: item.subtype === 'move-to' ? 'insert' : 'delete',
        trackedChangeDisplayType: item.subtype === 'move-to' ? 'insert' : 'delete',
        trackedChangeLabel: item.subtype === 'move-to' ? 'Moved (insertion)' : 'Moved up: moved source',
        trackedChangeAnchorKey: canonicalAnchorKey,
        importedId: '1',
        semanticColorKey: item.subtype,
      })),
    };
    const superdoc = {
      config: { isInternal: true },
      emit: vi.fn(),
      activeEditor: { options: { documentId: 'doc-1' } },
    };
    store.setV2TrackedChangesAdapter(adapter);

    store.reconcileTrackedChangesFromV2({
      superdoc,
      adapter,
      documentId: 'doc-1',
      items: [
        { id: `${canonicalId}::move-from`, subtype: 'move-from' },
        { id: `${canonicalId}::move-to`, subtype: 'move-to' },
      ],
      pruneStale: false,
    });

    expect(store.commentsList).toHaveLength(2);
    expect(store.commentsList.map((comment) => comment.commentId).sort()).toEqual([
      `${canonicalId}::move-from`,
      `${canonicalId}::move-to`,
    ]);
    expect(store.commentsList.map((comment) => comment.trackedChangeAnchorKey)).toEqual([
      canonicalAnchorKey,
      canonicalAnchorKey,
    ]);
    expect(store.commentsList.map((comment) => comment.trackedChangeLabel).sort()).toEqual([
      'Moved (insertion)',
      'Moved up: moved source',
    ]);
  });

  it('keeps tracked-change move-side rows as sidebar parents even when parent aliases are present', () => {
    const canonicalId = 'tc|move|1%7C101';
    store.commentsList = [
      makeTrackedChangeRow({
        commentId: `${canonicalId}::move-to`,
        trackedChangeCanonicalId: canonicalId,
        trackedChangeParentId: canonicalId,
        trackedChangeThreadParentId: canonicalId,
        trackedChangeAnchorKey: `tc::body::${canonicalId}::move-to`,
        trackedChangeText: 'moved destination',
        trackedChangeLabel: 'Moved (insertion)',
        semanticColorKey: 'move-to',
      }),
      makeTrackedChangeRow({
        commentId: `${canonicalId}::move-from`,
        trackedChangeCanonicalId: canonicalId,
        trackedChangeParentId: canonicalId,
        trackedChangeThreadParentId: canonicalId,
        trackedChangeAnchorKey: `tc::body::${canonicalId}::move-from`,
        trackedChangeText: '',
        deletedText: 'moved source',
        trackedChangeLabel: 'Moved down: moved source',
        semanticColorKey: 'move-from',
      }),
    ];

    expect(store.getGroupedComments.parentComments.map((comment) => comment.commentId).sort()).toEqual([
      `${canonicalId}::move-from`,
      `${canonicalId}::move-to`,
    ]);
  });

  it('shows comments created from each move side inside that visible review card', () => {
    const canonicalId = 'tc|move|1%7C101';
    const moveTo = makeTrackedChangeRow({
      commentId: `${canonicalId}::move-to`,
      trackedChangeCanonicalId: canonicalId,
      semanticColorKey: 'move-to',
    });
    const moveFrom = makeTrackedChangeRow({
      commentId: `${canonicalId}::move-from`,
      trackedChangeCanonicalId: canonicalId,
      semanticColorKey: 'move-from',
    });
    const sourceRoot = useComment({
      commentId: 'source-root',
      fileId: 'doc-1',
      commentText: 'Source note',
      trackedChangeThreadParentId: canonicalId,
      trackedChangeSide: 'source',
    });
    const destinationRoot = useComment({
      commentId: 'destination-root',
      fileId: 'doc-1',
      commentText: 'Destination note',
      trackedChangeThreadParentId: canonicalId,
      trackedChangeSide: 'destination',
    });
    store.commentsList = [moveTo, moveFrom, sourceRoot, destinationRoot];

    expect(store.getGroupedComments.parentComments.map((comment) => comment.commentId).sort()).toEqual([
      moveFrom.commentId,
      moveTo.commentId,
    ]);
    expect(store.getTrackedChangeThread(moveFrom).map((comment) => comment.commentId)).toEqual([
      moveFrom.commentId,
      sourceRoot.commentId,
    ]);
    expect(store.getTrackedChangeThread(moveTo).map((comment) => comment.commentId)).toEqual([
      moveTo.commentId,
      destinationRoot.commentId,
    ]);
  });

  // TCS-LIST-005: the signed list vocabulary fields survive from adapter
  // params through the comment model to the serialized payload, and re-adds
  // with identical detail lines do not mark the row changed.
  it('preserves trackedChangeLabel, detail lines, image previews, and custom attributes on hydrated rows', async () => {
    const detailLines = [
      { excerpt: 'Second existing item', label: 'Changed list style' },
      { excerpt: 'New plain paragraph', label: 'Added to list' },
    ];
    const customAttributes = [
      {
        name: 'ext:changeCategory',
        namespaceUri: 'https://example.test/ns/edit',
        localName: 'changeCategory',
        value: 'formatting',
      },
    ];
    let includeCustomAttributes = true;
    const adapter = {
      documentId: 'doc-1',
      listTrackedChanges: vi.fn(async () => ({
        ok: true,
        complete: true,
        items: [{ id: 'tc-mixed' }],
      })),
      mapV2TrackedChangeToCommentParams: vi.fn((item) => ({
        event: 'add',
        changeId: item?.id,
        documentId: 'doc-1',
        trackedChangeText: '',
        trackedChangeType: 'trackFormat',
        trackedChangeDisplayType: 'format',
        trackedChangeAnchorKey: `tc::body::${item?.id}`,
        trackedChangeLabel: 'Changed list formatting (2 items)',
        trackedChangeDetailLines: detailLines.map((line) => ({ ...line })),
        trackedChangeImagePreview: {
          src: ONE_BY_ONE_PNG,
          contentType: 'image/png',
          role: 'deleted',
          width: 96,
          height: 96,
          alt: 'Deleted preview',
        },
        ...(includeCustomAttributes
          ? { customAttributes: customAttributes.map((attribute) => ({ ...attribute })) }
          : {}),
      })),
    };
    const superdoc = {
      config: { isInternal: true },
      emit: vi.fn(),
      activeEditor: { options: { documentId: 'doc-1' } },
    };
    store.setV2TrackedChangesAdapter(adapter);

    store.reconcileTrackedChangesFromV2({
      superdoc,
      adapter,
      documentId: 'doc-1',
      items: [{ id: 'tc-mixed' }],
      pruneStale: false,
    });

    expect(store.commentsList).toHaveLength(1);
    expect(store.commentsList[0].getValues()).toMatchObject({
      commentId: 'tc-mixed',
      trackedChangeLabel: 'Changed list formatting (2 items)',
      trackedChangeDetailLines: detailLines,
      trackedChangeImagePreview: {
        src: ONE_BY_ONE_PNG,
        contentType: 'image/png',
        role: 'deleted',
        width: 96,
        height: 96,
        alt: 'Deleted preview',
      },
      customAttributes,
    });

    // Re-hydrating the same row with freshly built (but equal) detail-line
    // arrays must not rebroadcast an update.
    superdoc.emit.mockClear();
    store.reconcileTrackedChangesFromV2({
      superdoc,
      adapter,
      documentId: 'doc-1',
      items: [{ id: 'tc-mixed' }],
      pruneStale: false,
    });
    const updateEvents = superdoc.emit.mock.calls.filter(([name]) => name === 'comments-update');
    expect(updateEvents).toHaveLength(0);
    expect(store.commentsList[0].getValues().trackedChangeDetailLines).toEqual(detailLines);

    includeCustomAttributes = false;
    store.reconcileTrackedChangesFromV2({
      superdoc,
      adapter,
      documentId: 'doc-1',
      items: [{ id: 'tc-mixed' }],
      pruneStale: false,
    });
    expect(store.commentsList[0].getValues().customAttributes).toEqual(customAttributes);
  });

  it('leaves label-less hydrated rows without signed vocabulary fields', async () => {
    const adapter = {
      documentId: 'doc-1',
      listTrackedChanges: vi.fn(async () => ({
        ok: true,
        complete: true,
        items: [{ id: 'tc-legacy' }],
      })),
      mapV2TrackedChangeToCommentParams: vi.fn((item) => ({
        event: 'add',
        changeId: item?.id,
        documentId: 'doc-1',
        trackedChangeText: 'bold',
        trackedChangeType: 'trackFormat',
        trackedChangeDisplayType: 'format',
        trackedChangeAnchorKey: `tc::body::${item?.id}`,
      })),
    };
    const superdoc = {
      config: { isInternal: true },
      emit: vi.fn(),
      activeEditor: { options: { documentId: 'doc-1' } },
    };
    store.setV2TrackedChangesAdapter(adapter);

    store.reconcileTrackedChangesFromV2({
      superdoc,
      adapter,
      documentId: 'doc-1',
      items: [{ id: 'tc-legacy' }],
      pruneStale: false,
    });

    expect(store.commentsList).toHaveLength(1);
    const values = store.commentsList[0].getValues();
    expect(values.trackedChangeLabel).toBeNull();
    expect(values.trackedChangeDetailLines).toBeNull();
  });

  it('threads V2 replies under a dropped tracked-change sidecar root back to the visible tracked-change row', () => {
    const items = [
      {
        commentId: '0',
        fileId: 'doc-1',
        parentCommentId: null,
        trackedChangeParentId: 'tc-1',
        trackedChangeThreadParentId: 'tc-1',
        commentText: '',
      },
      {
        commentId: '6',
        fileId: 'doc-1',
        parentCommentId: '0',
        trackedChangeParentId: 'tc-1',
        trackedChangeThreadParentId: 'tc-1',
        commentText: 'Reply saved under the hidden root',
      },
    ];
    const adapter = makeAdapter(items);
    const superdoc = makeSuperdoc(adapter);
    store.commentsList = [makeTrackedChangeRow({ commentId: 'tc-1' })];
    store.setV2CommentsAdapter(adapter);

    store.reconcileCommentsFromV2({ superdoc, adapter, documentId: 'doc-1', items });

    expect(store.commentsList.map((comment) => comment.commentId).sort()).toEqual(['6', 'tc-1']);
    const reply = store.commentsList.find((comment) => comment.commentId === '6');
    expect(reply.parentCommentId).toBe('0');
    expect(reply.trackedChangeParentId).toBe('tc-1');
    expect(reply.trackedChangeThreadParentId).toBe('tc-1');
    expect(reply.threadingParentCommentId).toBe('tc-1');
  });

  it('keeps a spatial-only V2 comment as a standalone grouped row', () => {
    const items = [
      {
        commentId: 'word-comment',
        fileId: 'doc-1',
        trackedChangeParentId: 'tc-1',
        commentText: 'Standalone Word comment',
      },
    ];
    const adapter = makeAdapter(items);
    const superdoc = makeSuperdoc(adapter);
    store.commentsList = [makeTrackedChangeRow({ commentId: 'tc-1' })];
    store.setV2CommentsAdapter(adapter);

    store.reconcileCommentsFromV2({ superdoc, adapter, documentId: 'doc-1', items });

    const parentIds = store.getGroupedComments.parentComments.map((comment) => comment.commentId).sort();
    expect(parentIds).toEqual(['tc-1', 'word-comment']);
    const standalone = store.commentsList.find((comment) => comment.commentId === 'word-comment');
    expect(standalone.trackedChangeParentId).toBe('tc-1');
    expect(standalone.trackedChangeThreadParentId).toBeUndefined();
  });

  it('threads legacy tracked-change comments using trackedChangeParentId fallback', () => {
    const legacyComment = useComment({
      commentId: 'legacy-comment',
      fileId: 'doc-1',
      parentCommentId: null,
      trackedChangeParentId: 'tc-1',
      trackedChangeType: 'insert',
      commentText: 'Legacy tracked-change reply',
    });
    store.commentsList = [makeTrackedChangeRow({ commentId: 'tc-1' }), legacyComment];

    const parentIds = store.getGroupedComments.parentComments.map((comment) => comment.commentId).sort();
    expect(parentIds).toEqual(['tc-1']);
  });

  it('keeps a linked comment visible as a normal comment immediately after accepting an insertion', async () => {
    vi.useFakeTimers();
    let releaseCanonicalPaint;
    const canonicalPaint = new Promise((resolve) => {
      releaseCanonicalPaint = resolve;
    });
    const whenPainted = vi.fn(() => canonicalPaint);
    const commentsAdapter = {
      documentId: 'doc-1',
      refresh: vi.fn(async () => ({
        ok: true,
        items: [
          {
            commentId: '0',
            fileId: 'doc-1',
            text: 'here is a thread',
            status: 'open',
          },
        ],
      })),
      mapV2CommentToUseCommentInput: vi.fn((item) => ({
        commentId: item.commentId,
        fileId: item.fileId,
        commentText: item.text,
        resolvedTime: null,
      })),
    };
    const trackedChangesAdapter = {
      documentId: 'doc-1',
      accept: vi.fn(async () => ({
        ok: true,
        receipt: { success: true, txId: 'tx-sidebar-decision' },
        decidedId: 'tc-1',
        documentId: 'doc-1',
      })),
      reject: vi.fn(),
      listTrackedChanges: vi.fn(async () => ({
        ok: true,
        complete: true,
        sourceCoverageComplete: true,
        items: [],
      })),
      mapV2TrackedChangeToCommentParams: vi.fn(() => null),
      clearActiveTrackedChangeTargetIfMatches: vi.fn(),
    };
    const superdoc = {
      activeEditor: {
        editorVersion: 2,
        documentId: 'doc-1',
        documentMutationReadiness: { whenPainted },
        v2Comments: commentsAdapter,
        v2TrackedChanges: trackedChangesAdapter,
      },
      emit: vi.fn(),
    };
    const linkedComment = useComment({
      commentId: '0',
      fileId: 'doc-1',
      commentText: 'here is a thread',
      trackedChangeParentId: 'tc-1',
      trackedChangeSide: 'inserted',
      resolvedTime: null,
    });
    const trackedRow = makeTrackedChangeRow({
      commentId: 'tc-1',
      trackedChangeText: 'new text',
      trackedChangeType: 'insert',
      trackedChangeDisplayType: 'insert',
      trackedChangeAnchorKey: 'tc::body::tc-1',
    });
    store.commentsList = [linkedComment, trackedRow];
    store.setV2CommentsAdapter(commentsAdapter);
    store.setV2TrackedChangesAdapter(trackedChangesAdapter);

    const decisionPromise = store.decideTrackedChangeFromSidebar({
      superdoc,
      comment: trackedRow,
      decision: 'accept',
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(whenPainted).toHaveBeenCalledWith(expect.objectContaining({ txId: 'tx-sidebar-decision' }));
    expect(trackedChangesAdapter.clearActiveTrackedChangeTargetIfMatches).toHaveBeenCalledWith('tc-1');
    expect(store.commentsList).toHaveLength(2);

    releaseCanonicalPaint();
    await vi.advanceTimersByTimeAsync(250);
    const result = await decisionPromise;

    expect(result).toMatchObject({ ok: true, success: true });
    expect(trackedChangesAdapter.accept).toHaveBeenCalledWith(trackedRow);
    expect(trackedChangesAdapter.listTrackedChanges).not.toHaveBeenCalled();
    expect(commentsAdapter.refresh).not.toHaveBeenCalled();
    expect(store.commentsList).toHaveLength(1);
    expect(store.commentsList[0]).toMatchObject({
      commentId: '0',
      commentText: 'here is a thread',
      resolvedTime: null,
    });
    expect(store.commentsList[0].trackedChangeParentId).toBeUndefined();
    expect(store.commentsList[0].trackedChangeSide).toBeUndefined();

    await vi.runOnlyPendingTimersAsync();
    expect(trackedChangesAdapter.listTrackedChanges).not.toHaveBeenCalled();
    expect(commentsAdapter.refresh).not.toHaveBeenCalled();
  });

  it('does not launch a full background reconcile while reliable receipt-local decisions continue', async () => {
    vi.useFakeTimers();
    const commentsAdapter = {
      documentId: 'doc-1',
      refresh: vi.fn(async () => ({ ok: true, items: [] })),
      mapV2CommentToUseCommentInput: vi.fn((item) => item),
    };
    const trackedChangesAdapter = {
      documentId: 'doc-1',
      accept: vi.fn(async (comment) => ({
        ok: true,
        receipt: { success: true, txId: `tx-${comment.commentId}` },
        decidedId: comment.commentId,
        documentId: 'doc-1',
      })),
      reject: vi.fn(),
      listTrackedChanges: vi.fn(async () => ({
        ok: true,
        complete: true,
        sourceCoverageComplete: true,
        items: [],
      })),
      mapV2TrackedChangeToCommentParams: vi.fn(() => null),
      clearActiveTrackedChangeTargetIfMatches: vi.fn(),
    };
    const superdoc = {
      activeEditor: {
        editorVersion: 2,
        documentId: 'doc-1',
        v2Comments: commentsAdapter,
        v2TrackedChanges: trackedChangesAdapter,
      },
      emit: vi.fn(),
    };
    const firstTrackedRow = makeTrackedChangeRow({
      commentId: 'tc-1',
      trackedChangeAnchorKey: 'tc::body::tc-1',
    });
    const secondTrackedRow = makeTrackedChangeRow({
      commentId: 'tc-2',
      trackedChangeAnchorKey: 'tc::body::tc-2',
    });
    store.commentsList = [firstTrackedRow, secondTrackedRow];
    store.setV2CommentsAdapter(commentsAdapter);
    store.setV2TrackedChangesAdapter(trackedChangesAdapter);

    const firstResult = await store.decideTrackedChangeFromSidebar({
      superdoc,
      comment: firstTrackedRow,
      decision: 'accept',
    });
    await vi.advanceTimersByTimeAsync(2_000);
    const secondResult = await store.decideTrackedChangeFromSidebar({
      superdoc,
      comment: secondTrackedRow,
      decision: 'accept',
    });

    expect(firstResult).toMatchObject({ ok: true, success: true });
    expect(secondResult).toMatchObject({ ok: true, success: true });
    expect(store.commentsList).toHaveLength(0);

    await vi.runOnlyPendingTimersAsync();
    expect(trackedChangesAdapter.listTrackedChanges).not.toHaveBeenCalled();
    expect(commentsAdapter.refresh).not.toHaveBeenCalled();
  });

  it('does not clear an unrelated active comment when pruning a decided tracked-change row', async () => {
    vi.useFakeTimers();
    const commentsAdapter = {
      documentId: 'doc-1',
      refresh: vi.fn(async () => ({ ok: true, items: [] })),
      mapV2CommentToUseCommentInput: vi.fn((item) => item),
    };
    const trackedChangesAdapter = {
      documentId: 'doc-1',
      accept: vi.fn(async () => ({ ok: true, receipt: { success: true }, decidedId: 'tc-1', documentId: 'doc-1' })),
      reject: vi.fn(),
      listTrackedChanges: vi.fn(async () => ({
        ok: true,
        complete: true,
        sourceCoverageComplete: true,
        items: [],
      })),
      mapV2TrackedChangeToCommentParams: vi.fn(() => null),
      clearActiveTrackedChangeTargetIfMatches: vi.fn(),
    };
    const superdoc = {
      activeEditor: {
        editorVersion: 2,
        documentId: 'doc-1',
        v2Comments: commentsAdapter,
        v2TrackedChanges: trackedChangesAdapter,
      },
      emit: vi.fn(),
    };
    const ordinaryComment = useComment({
      commentId: 'ordinary-comment',
      fileId: 'doc-1',
      commentText: 'keep selected',
      resolvedTime: null,
    });
    const trackedRow = makeTrackedChangeRow({
      commentId: 'tc-1',
      trackedChangeAnchorKey: 'tc::body::tc-1',
    });
    store.commentsList = [ordinaryComment, trackedRow];
    store.activeComment = 'ordinary-comment';
    store.setV2CommentsAdapter(commentsAdapter);
    store.setV2TrackedChangesAdapter(trackedChangesAdapter);

    const result = await store.decideTrackedChangeFromSidebar({
      superdoc,
      comment: trackedRow,
      decision: 'accept',
    });

    expect(result).toMatchObject({ ok: true, success: true });
    expect(store.commentsList.map((comment) => comment.commentId)).toEqual(['ordinary-comment']);
    expect(store.activeComment).toBe('ordinary-comment');

    await vi.runOnlyPendingTimersAsync();
  });

  it('uses the clicked row identity when a committed decision omits receipt ids', async () => {
    vi.useFakeTimers();
    const commentsAdapter = {
      documentId: 'doc-1',
      refresh: vi.fn(async () => ({ ok: true, items: [] })),
      mapV2CommentToUseCommentInput: vi.fn((item) => item),
    };
    const trackedChangesAdapter = {
      documentId: 'doc-1',
      accept: vi.fn(async () => ({ ok: true, receipt: { success: true } })),
      reject: vi.fn(),
      listTrackedChanges: vi.fn(async () => ({
        ok: true,
        complete: true,
        sourceCoverageComplete: true,
        items: [],
      })),
      mapV2TrackedChangeToCommentParams: vi.fn(() => null),
      clearActiveTrackedChangeTargetIfMatches: vi.fn(),
    };
    const superdoc = {
      activeEditor: {
        editorVersion: 2,
        documentId: 'doc-1',
        v2Comments: commentsAdapter,
        v2TrackedChanges: trackedChangesAdapter,
      },
      emit: vi.fn(),
    };
    const trackedRow = makeTrackedChangeRow({
      commentId: 'tc-1',
      trackedChangeAnchorKey: 'tc::body::tc-1',
    });
    store.commentsList = [trackedRow];
    store.setV2CommentsAdapter(commentsAdapter);
    store.setV2TrackedChangesAdapter(trackedChangesAdapter);

    const result = await store.decideTrackedChangeFromSidebar({
      superdoc,
      comment: trackedRow,
      decision: 'accept',
    });

    expect(result).toMatchObject({ ok: true, success: true });
    expect(trackedChangesAdapter.listTrackedChanges).not.toHaveBeenCalled();
    expect(commentsAdapter.refresh).not.toHaveBeenCalled();
    expect(store.commentsList).toHaveLength(0);
  });
});

describe('comments-store getComment id resolution', () => {
  let store;

  beforeEach(() => {
    setActivePinia(createPinia());
    const superdocStore = useSuperdocStore();
    superdocStore.documents = [
      { id: 'doc-1', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    ];
    store = useCommentsStore();
  });

  // Real Word comment ids and tracked-change rows' raw OOXML `w:id` (exposed
  // as `importedId`) are independent numbering sequences that can collide on
  // the same small integer (e.g. comment "2" and a tracked-change insert with
  // w:id="2" elsewhere in the same document). `getComment` must resolve the
  // real comment, never the unrelated tracked-change row, regardless of which
  // one happens to appear first in `commentsList`.
  it('resolves a real comment over a colliding tracked-change importedId, even when the tracked-change row sorts first', () => {
    const trackedChangeRow = makeTrackedChangeRow({
      commentId: 'tc|main:document.xml|ins|wId:2',
      importedId: '2',
      trackedChangeText: '8 months',
    });
    const realComment = useComment(makeOpenRow({ commentId: '2', commentText: 'We should have a 1 month cushion...' }));
    // Tracked-change row intentionally placed BEFORE the real comment: this
    // is the exact array order that reproduced the misattribution bug (the
    // old `.find()` matched importedId=='2' on the tracked-change row before
    // ever reaching the real comment's commentId=='2').
    store.commentsList = [trackedChangeRow, realComment];

    const resolved = store.getComment('2');

    expect(resolved.commentId).toBe('2');
    expect(resolved.trackedChange).not.toBe(true);
    expect(resolved.commentText).toBe('We should have a 1 month cushion...');
  });

  it('still resolves a tracked-change row by importedId when there is no commentId collision', () => {
    const trackedChangeRow = makeTrackedChangeRow({
      commentId: 'tc|main:document.xml|ins|wId:7',
      importedId: '7',
      trackedChangeText: 'no collision here',
    });
    store.commentsList = [trackedChangeRow];

    expect(store.getComment('7')).toBe(trackedChangeRow);
  });

  it('keeps commentsList precedence when reviewDirectoryList contains a colliding alias', () => {
    const trackedChangeRow = makeTrackedChangeRow({
      commentId: 'tc|main:document.xml|ins|wId:2',
      importedId: '2',
      trackedChangeText: 'directory collision',
    });
    const realComment = useComment(makeOpenRow({ commentId: '2', commentText: 'Live sidebar comment' }));

    store.commentsList = [realComment];
    store.reviewDirectoryList = [trackedChangeRow];

    const resolved = store.getComment('2');

    expect(resolved).toBe(realComment);
    expect(resolved.commentId).toBe('2');
    expect(resolved.trackedChange).not.toBe(true);
  });
});

describe('comments-store cut comment invalidation', () => {
  let store;
  let superdoc;

  beforeEach(() => {
    setActivePinia(createPinia());
    const superdocStore = useSuperdocStore();
    superdocStore.documents = [
      { id: 'doc-1', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    ];
    store = useCommentsStore();
    superdoc = { emit: vi.fn() };
  });

  it('drops the source comment and its replies when a cut receipt invalidates it', () => {
    store.commentsList = [
      useComment({ commentId: '0', fileId: 'doc-1', commentText: 'Source review comment' }),
      useComment({
        commentId: '1',
        fileId: 'doc-1',
        parentCommentId: '0',
        commentText: 'Reply',
      }),
      makeTrackedChangeRow({ commentId: 'tc-1' }),
    ];
    store.activeComment = '0';

    const result = store.dropCommentsFromMutationImpact({
      superdoc,
      documentId: 'doc-1',
      removedIds: new Set(['0']),
    });

    expect(result.ok).toBe(true);
    expect(store.commentsList.map((row) => row.commentId).sort()).toEqual(['tc-1']);
    expect(store.activeComment).toBeNull();
    expect(superdoc.emit).toHaveBeenCalledWith('comments-update', expect.objectContaining({ type: 'deleted' }));
  });

  it('does not drop tracked-change rows that share a numeric Word id', () => {
    store.commentsList = [
      useComment({ commentId: '0', fileId: 'doc-1', commentText: 'Source review comment' }),
      makeTrackedChangeRow({ commentId: '0' }),
    ];

    store.dropCommentsFromMutationImpact({
      superdoc,
      documentId: 'doc-1',
      removedIds: new Set(['0']),
    });

    expect(store.commentsList.map((row) => row.commentId)).toEqual(['0']);
    expect(store.commentsList[0].trackedChange).toBe(true);
  });

  it('drops a sidebar row whose imported Word id was invalidated', () => {
    store.commentsList = [
      useComment({
        commentId: 'uuid-comment',
        importedId: '0',
        fileId: 'doc-1',
        commentText: 'Source review comment',
      }),
      useComment({
        commentId: 'uuid-reply',
        importedId: '1',
        fileId: 'doc-1',
        parentCommentId: 'uuid-comment',
        commentText: 'Reply',
      }),
    ];
    store.activeComment = 'uuid-comment';

    const result = store.dropCommentsFromMutationImpact({
      superdoc,
      documentId: 'doc-1',
      removedIds: new Set(['0']),
    });

    expect(result.ok).toBe(true);
    expect(store.commentsList).toEqual([]);
    expect(store.activeComment).toBeNull();
  });

  it('leaves a neighbouring comment in the sidebar when only one identity is invalidated', () => {
    store.commentsList = [
      useComment({ commentId: '0', fileId: 'doc-1', commentText: 'Source review comment' }),
      useComment({ commentId: '1', fileId: 'doc-1', commentText: 'Neighbour review comment' }),
    ];
    store.activeComment = '0';

    const result = store.dropCommentsFromMutationImpact({
      superdoc,
      documentId: 'doc-1',
      removedIds: new Set(['0']),
    });

    expect(result.ok).toBe(true);
    expect(store.commentsList.map((row) => row.commentId)).toEqual(['1']);
    expect(store.activeComment).toBeNull();
  });
});

describe('comments-store committed review-window apply', () => {
  let store;
  let superdoc;
  let commentsAdapter;
  let trackedChangesAdapter;

  beforeEach(() => {
    setActivePinia(createPinia());
    const superdocStore = useSuperdocStore();
    superdocStore.documents = [
      { id: 'doc-1', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      { id: 'doc-2', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    ];
    store = useCommentsStore();
    commentsAdapter = {
      documentId: 'doc-1',
      mapV2CommentToUseCommentInput: vi.fn((item) => ({
        commentId: item.commentId,
        fileId: 'doc-1',
        parentCommentId: item.parentCommentId ?? null,
        trackedChangeParentId: item.trackedChangeParentId,
        trackedChangeThreadParentId: item.trackedChangeThreadParentId,
        commentText: item.text ?? '',
        resolvedTime: null,
      })),
    };
    trackedChangesAdapter = {
      documentId: 'doc-1',
      mapV2TrackedChangeToCommentParams: vi.fn((item) => ({
        event: 'add',
        changeId: item.id,
        documentId: 'doc-1',
        trackedChangeText: item.excerpt,
        trackedChangeType: 'insert',
        trackedChangeDisplayType: 'insert',
        trackedChangeAnchorKey: `tc::body::${item.id}`,
      })),
    };
    superdoc = {
      activeEditor: { editorVersion: 2, documentId: 'doc-1' },
      config: { isInternal: true },
      emit: vi.fn(),
    };
    store.setV2CommentsAdapter(commentsAdapter);
    store.setV2TrackedChangesAdapter(trackedChangesAdapter);
  });

  function apply(overrides = {}) {
    return store.applyReviewWindowFromV2({
      superdoc,
      commentsAdapter,
      trackedChangesAdapter,
      documentId: 'doc-1',
      commentItems: [{ commentId: 'comment-1', text: 'Comment one' }],
      trackedChangeItems: [{ id: 'tc-1', excerpt: 'Inserted text' }],
      trackedList: { complete: false, visibleWindowSource: 'visible-window' },
      patch: (callback) => store.$patch(callback),
      ...overrides,
    });
  }

  it('publishes tracked and comment rows in one Pinia patch with no intermediate family state', () => {
    const notifications = [];
    store.$subscribe(
      () => {
        notifications.push(
          store.commentsList.map((row) => ({
            id: row.commentId,
            tracked: row.trackedChange === true,
            text: row.commentText || row.trackedChangeText,
          })),
        );
      },
      { flush: 'sync' },
    );

    const result = apply();

    expect(result).toEqual({ ok: true, commentItems: 1, trackedItems: 1 });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'tc-1', tracked: true }),
        expect.objectContaining({ id: 'comment-1', tracked: false, text: 'Comment one' }),
      ]),
    );
  });

  it('keeps body and header rows separate when Word reuses one imported revision id', () => {
    const bodyStory = { kind: 'story', storyType: 'body' };
    const headerStory = { kind: 'story', storyType: 'headerFooterPart', refId: 'rId8' };
    trackedChangesAdapter.mapV2TrackedChangeToCommentParams.mockImplementation((item) => {
      const storyKey = item.story.storyType === 'body' ? 'body' : `hf:${item.story.refId}`;
      return {
        event: 'add',
        changeId: item.id,
        documentId: 'doc-1',
        trackedChangeText: item.excerpt,
        trackedChangeType: 'insert',
        trackedChangeDisplayType: 'insert',
        trackedChangeStory: item.story,
        trackedChangeStoryKind: item.story.storyType === 'body' ? 'body' : 'headerFooter',
        trackedChangeAnchorKey: `tc::${storyKey}::${item.id}`,
        importedId: '101',
      };
    });

    const result = apply({
      commentItems: [],
      trackedChangeItems: [
        { id: 'body-canonical', excerpt: 'BODY_TC_SHARED', story: bodyStory },
        { id: 'header-canonical', excerpt: 'HDR_TC_ALPHA', story: headerStory },
      ],
    });

    expect(result).toMatchObject({ ok: true, trackedItems: 2 });
    const rows = store.commentsList.filter((row) => row.trackedChange);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.trackedChangeText).sort()).toEqual(['BODY_TC_SHARED', 'HDR_TC_ALPHA']);
    expect(rows.map((row) => row.trackedChangeStory)).toEqual(expect.arrayContaining([bodyStory, headerStory]));
  });

  it('bounds rows to the committed window while retaining an active pin and other documents', () => {
    store.commentsList = [
      makeTrackedChangeRow({ commentId: 'tc-offscreen' }),
      makeTrackedChangeRow({ commentId: 'tc-stale' }),
      useComment({ commentId: 'stale-comment', fileId: 'doc-1', commentText: 'stale' }),
      useComment({ commentId: 'other-comment', fileId: 'doc-2', commentText: 'other' }),
    ];
    store.activeComment = 'tc-offscreen';

    expect(apply().ok).toBe(true);

    expect(store.commentsList.map((row) => row.commentId)).toEqual(
      expect.arrayContaining(['tc-offscreen', 'tc-1', 'comment-1', 'other-comment']),
    );
    expect(store.commentsList.map((row) => row.commentId)).not.toContain('tc-stale');
    expect(store.commentsList.map((row) => row.commentId)).not.toContain('stale-comment');
  });

  it('keeps presentation size proportional to the window plus interaction pins', () => {
    store.commentsList = Array.from({ length: 500 }, (_, index) =>
      makeTrackedChangeRow({ commentId: `tc-offscreen-${index}` }),
    );
    store.activeComment = 'tc-offscreen-217';

    expect(apply().ok).toBe(true);

    const documentRows = store.commentsList.filter((row) => row.fileId === 'doc-1' || row.documentId === 'doc-1');
    expect(documentRows.map((row) => row.commentId).sort()).toEqual(['comment-1', 'tc-1', 'tc-offscreen-217'].sort());
  });

  it('seeds the lean catalog and partial-merges only the currently painted comment threads', () => {
    const fullCatalog = [
      { commentId: 'visible-root', text: 'Visible' },
      { commentId: 'offscreen-root', text: 'Offscreen' },
    ];
    commentsAdapter.seedReviewCatalog = vi.fn(() => ({ ok: true }));
    commentsAdapter.selectVisibleReviewComments = vi.fn(() => ({
      ok: true,
      items: [fullCatalog[0]],
      unresolvedIds: [],
      visibleWindowSource: 'review-catalog',
    }));
    store.commentsList = [useComment({ commentId: 'offscreen-existing', fileId: 'doc-1', commentText: 'Keep me' })];

    const result = apply({
      commentItems: fullCatalog,
      sourceCoverageRevision: 'source-1',
      evaluatedRevision: 'revision-1',
    });

    expect(result).toMatchObject({ ok: true, commentItems: 1 });
    expect(commentsAdapter.seedReviewCatalog).toHaveBeenCalledWith(fullCatalog, {
      sourceCoverageRevision: 'source-1',
      evaluatedRevision: 'revision-1',
    });
    expect(store.commentsList.map((row) => row.commentId)).toEqual(expect.arrayContaining(['visible-root', 'tc-1']));
    expect(store.commentsList.map((row) => row.commentId)).not.toContain('offscreen-existing');
    expect(store.commentsList.map((row) => row.commentId)).not.toContain('offscreen-root');
  });

  it('keeps existing rows when a bounded snapshot resolves only part of its comment window', () => {
    commentsAdapter.seedReviewCatalog = vi.fn(() => ({ ok: true }));
    commentsAdapter.selectVisibleReviewComments = vi.fn(() => ({
      ok: true,
      items: [],
      unresolvedIds: ['comment-missing'],
      visibleWindowSource: 'review-catalog',
    }));
    store.commentsList = [useComment({ commentId: 'comment-missing', fileId: 'doc-1', commentText: 'Keep me' })];

    const result = apply({ unresolvedCommentIds: ['comment-missing'], requestedCommentIds: ['comment-missing'] });

    expect(result).toMatchObject({ ok: true, commentItems: 1 });
    expect(store.commentsList.map((row) => row.commentId)).toEqual(
      expect.arrayContaining(['comment-missing', 'comment-1', 'tc-1']),
    );
  });

  it('clears stale tracked-change provenance when a bounded window returns a retargeted comment', () => {
    const trackedRow = makeTrackedChangeRow({ commentId: 'tc-1', trackedChangeCanonicalId: 'tc-1' });
    const root = useComment({
      commentId: 'comment-1',
      fileId: 'doc-1',
      commentText: 'Comment one',
      trackedChangeParentId: 'tc-1',
      trackedChangeThreadParentId: 'tc-1',
      trackedChangeSide: 'inserted',
    });
    store.commentsList = [trackedRow, root];

    expect(apply().ok).toBe(true);

    const reconciledRoot = store.commentsList.find((row) => row.commentId === 'comment-1');
    const reconciledTrackedRow = store.commentsList.find((row) => row.commentId === 'tc-1');
    expect(reconciledRoot.trackedChangeParentId).toBeUndefined();
    expect(reconciledRoot.trackedChangeThreadParentId).toBeUndefined();
    expect(reconciledRoot.trackedChangeSide).toBeUndefined();
    expect(store.getGroupedComments.parentComments.map((row) => row.commentId).sort()).toEqual(['comment-1', 'tc-1']);
    expect(store.getTrackedChangeThread(reconciledTrackedRow).map((row) => row.commentId)).toEqual(['tc-1']);
  });

  it('rejects stale adapters, document mismatch, and mapper failure before patching', () => {
    const patch = vi.fn();
    const staleComments = { ...commentsAdapter };
    expect(apply({ commentsAdapter: staleComments, patch })).toMatchObject({
      ok: false,
      reason: 'comments-adapter-stale',
    });
    const staleTracked = { ...trackedChangesAdapter };
    expect(apply({ trackedChangesAdapter: staleTracked, patch })).toMatchObject({
      ok: false,
      reason: 'tracked-changes-adapter-stale',
    });
    expect(apply({ documentId: 'wrong-doc', patch })).toMatchObject({ ok: false, reason: 'document-mismatch' });

    commentsAdapter.mapV2CommentToUseCommentInput.mockImplementationOnce(() => {
      throw new Error('mapping failed');
    });
    expect(apply({ patch })).toMatchObject({ ok: false, reason: 'mapper-failed' });
    expect(patch).not.toHaveBeenCalled();
    expect(store.commentsList).toHaveLength(0);
  });
});

describe('comments-store v2 pending document comments', () => {
  let store;
  let superdocStore;

  beforeEach(() => {
    setActivePinia(createPinia());
    superdocStore = useSuperdocStore();
    superdocStore.documents = [
      { id: 'doc-1', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    ];
    store = useCommentsStore();
  });

  it('submits a pending comment with the target captured when the card was opened', async () => {
    const target = {
      kind: 'text',
      segments: [{ story: { kind: 'story', storyType: 'body' }, blockId: 'captured', start: 0, end: 4 }],
    };
    const submittedTargets = [];
    const adapter = {
      documentId: 'doc-1',
      getCapabilityState: vi.fn(() => ({ canWrite: true, reason: null })),
      captureCurrentSelection: vi.fn(async () => ({ ok: true, target })),
      setActiveComment: vi.fn(async () => ({ ok: true })),
      commitPendingComment: vi.fn(async (input) => {
        submittedTargets.push(input.target);
        return {
          ok: true,
          items: [
            {
              commentId: 'c-created',
              fileId: 'doc-1',
              commentText: '<p>Captured target comment</p>',
            },
          ],
        };
      }),
      mapV2CommentToUseCommentInput: vi.fn((item) => item),
    };
    const superdoc = makeSuperdoc(adapter);
    superdoc.config = { isInternal: true };
    store.setV2CommentsAdapter(adapter);

    const pendingResult = await store.showAddComment(superdoc);
    expect(pendingResult).toEqual({ ok: true });
    expect(adapter.captureCurrentSelection).toHaveBeenCalledTimes(1);

    store.currentCommentText = '<p>Captured &lt;b&gt;target&lt;/b&gt; comment</p>';
    store.currentCommentMentions = [{ id: 'u1', name: 'Internal Reviewer', email: 'internal@example.com' }];
    const result = await store.addComment({ superdoc, comment: store.pendingComment });

    expect(adapter.commitPendingComment).toHaveBeenCalledWith({
      text: 'Captured <b>target</b> comment',
      target,
      mentions: [{ id: 'u1', name: 'Internal Reviewer', email: 'internal@example.com' }],
    });
    expect(submittedTargets[0]).toBe(target);
    expect(result.ok).toBe(true);
    expect(store.pendingComment).toBeNull();
    expect(store.currentCommentMentions).toEqual([]);
    expect(adapter.setActiveComment).toHaveBeenCalledWith('c-created');
    expect(store.activeComment).toBe('c-created');
    expect(store.activeFloatingCommentInstanceId).toBe('c-created');
    expect(store.commentsList.map((comment) => comment.commentId)).toEqual(['c-created']);
  });

  it('submits reply mentions and exposes them in the successful update event', async () => {
    const mentions = [{ id: 'u1', name: 'Internal Reviewer', email: 'internal@example.com' }];
    const items = [
      { commentId: 'c1', fileId: 'doc-1', commentText: 'Root', mentions: [] },
      { commentId: 'c2', parentCommentId: 'c1', fileId: 'doc-1', commentText: '@Internal Reviewer', mentions },
    ];
    const adapter = {
      documentId: 'doc-1',
      reply: vi.fn(async () => ({ ok: true, items })),
      mapV2CommentToUseCommentInput: vi.fn((item) => item),
    };
    const superdoc = makeSuperdoc(adapter);
    store.setV2CommentsAdapter(adapter);
    store.commentsList = [useComment(items[0])];

    const result = await store.replyCommentV2({
      superdoc,
      parentCommentId: 'c1',
      text: '@Internal Reviewer',
      mentions,
    });

    expect(adapter.reply).toHaveBeenCalledWith({
      parentCommentId: 'c1',
      text: '@Internal Reviewer',
      mentions,
    });
    expect(result.ok).toBe(true);
    expect(superdoc.emit).toHaveBeenCalledWith(
      'comments-update',
      expect.objectContaining({
        type: 'add',
        comment: expect.objectContaining({ commentId: 'c2', mentions }),
      }),
    );
  });

  it('reconciles a context-menu create and emits its structured mention event', async () => {
    const mentions = [{ id: 'u1', name: 'Internal Reviewer', email: 'internal@example.com' }];
    const detail = {
      id: 'c-created',
      text: '@Internal Reviewer',
      status: 'open',
      metadata: { mentions },
    };
    const adapter = {
      documentId: 'doc-1',
      mapV2CommentToUseCommentInput: vi.fn((item) => ({
        commentId: item.id,
        fileId: 'doc-1',
        commentText: item.text,
        mentions: item.metadata?.mentions ?? [],
      })),
    };
    const superdoc = makeSuperdoc(adapter);
    superdoc.activeEditor.doc = {
      comments: { get: vi.fn(async () => detail) },
    };
    store.setV2CommentsAdapter(adapter);

    const result = await store.announceV2CommentCreated({
      superdoc,
      commentId: 'c-created',
    });

    expect(result).toMatchObject({ ok: true });
    expect(superdoc.activeEditor.doc.comments.get).toHaveBeenCalledWith({
      commentId: 'c-created',
    });
    expect(store.commentsList[0]?.mentions).toEqual(mentions);
    expect(superdoc.emit).toHaveBeenCalledWith(
      'comments-update',
      expect.objectContaining({
        type: 'add',
        comment: expect.objectContaining({ commentId: 'c-created', mentions }),
      }),
    );
  });

  it('hands off the active floating row to the created comment for non-v2 pending submit', () => {
    const pendingDraft = useComment({
      commentId: 'pending-new-comment',
      fileId: 'doc-1',
      commentText: '',
      selection: {
        source: 'editor',
      },
    });
    const createdComment = useComment({
      commentId: 'c-created-sync',
      fileId: 'doc-1',
      commentText: 'Created from pending draft',
    });
    const superdoc = {
      activeEditor: {
        editorVersion: 1,
        commands: {
          insertComment: vi.fn(),
          removeComment: vi.fn(),
        },
      },
      emit: vi.fn(),
      config: { isInternal: true },
    };

    store.pendingComment = pendingDraft;
    store.currentCommentText = '<p>Created from pending draft</p>';

    const result = store.addComment({ superdoc, comment: createdComment, broadcastChanges: false });

    expect(result).toMatchObject({ ok: true });
    expect(store.pendingComment).toBeNull();
    expect(store.activeComment).toBe('c-created-sync');
    expect(store.activeFloatingCommentInstanceId).toBe('c-created-sync');
    expect(store.commentsList.map((comment) => comment.commentId)).toEqual(['c-created-sync']);
    expect(superdoc.activeEditor.commands.removeComment).toHaveBeenCalledWith({ commentId: 'pending' });
  });
});

describe('comments-store PDF comment selection bounds (SD-3497)', () => {
  let store;
  let superdocStore;

  beforeEach(() => {
    setActivePinia(createPinia());
    superdocStore = useSuperdocStore();
    superdocStore.documents = [{ id: 'pdf-doc', type: 'application/pdf' }];
    store = useCommentsStore();
  });

  it('preserves PDF selection source, page, and bounds through comment submit', () => {
    const comment = useComment({
      fileId: 'pdf-doc',
      fileType: 'application/pdf',
      commentText: 'PDF proof comment',
      selection: {
        source: 'pdf',
        page: 2,
        documentId: 'pdf-doc',
        selectionBounds: { top: 120, left: 40, right: 180, bottom: 150 },
      },
    });
    const superdoc = { activeEditor: null, emit: vi.fn(), config: { isInternal: true } };

    store.addComment({ superdoc, comment, broadcastChanges: false });

    expect(store.commentsList).toHaveLength(1);
    const row = store.commentsList[0].getValues();
    expect(row.selection.source).toBe('pdf');
    expect(row.selection.page).toBe(2);
    expect(row.selection.selectionBounds).toMatchObject({ top: 120, left: 40, right: 180, bottom: 150 });
  });

  it('surfaces the submitted PDF comment through getFloatingComments with bounds intact', () => {
    const comment = useComment({
      fileId: 'pdf-doc',
      fileType: 'application/pdf',
      commentText: 'PDF floating comment',
      selection: {
        source: 'pdf',
        page: 1,
        documentId: 'pdf-doc',
        selectionBounds: { top: 64, left: 12, right: 96, bottom: 90 },
      },
    });
    const superdoc = { activeEditor: null, emit: vi.fn(), config: { isInternal: true } };

    store.addComment({ superdoc, comment, broadcastChanges: false });

    const floating = store.getFloatingComments;
    expect(floating).toHaveLength(1);
    expect(floating[0].selection.source).toBe('pdf');
    expect(floating[0].selection.selectionBounds).toMatchObject({ top: 64, left: 12, right: 96, bottom: 90 });
  });
});
