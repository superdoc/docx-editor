import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { createPinia, setActivePinia } from 'pinia';
import { toRaw } from 'vue';
import useComment from '../components/CommentsLayer/use-comment.js';
import { makeV2CommentsAdapter, makeV2TrackedChangesAdapter } from '../test-support/v2-review-adapters.js';
import { useCommentsStore } from './comments-store.js';
import { useSuperdocStore } from './superdoc-store.js';
import type {
  V2CommentMutationOutcome,
  V2CommentSelectionCapture,
  V2CommentsAdapter,
} from './helpers/v2-review-adapters.js';

type Row = {
  id: string;
  excerpt: string;
  aliases?: string[];
};

function createFixture() {
  setActivePinia(createPinia());
  const hostStore = useSuperdocStore();
  hostStore.documents = [
    { id: 'doc-1', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    { id: 'doc-2', type: 'application/pdf' },
  ] as typeof hostStore.documents;
  const store = useCommentsStore();
  const commentsAdapter = makeV2CommentsAdapter({
    documentId: 'doc-1',
    captureCurrentSelection: vi.fn<NonNullable<V2CommentsAdapter['captureCurrentSelection']>>(),
    mapV2CommentToUseCommentInput: vi.fn((input: unknown) => {
      const item = input as { commentId: string; text: string; parentCommentId?: string };
      return {
        commentId: item.commentId,
        fileId: 'doc-1',
        commentText: item.text,
        parentCommentId: item.parentCommentId,
      };
    }),
  });
  const trackedChangesAdapter = makeV2TrackedChangesAdapter({
    documentId: 'doc-1',
    mapV2TrackedChangeToCommentParams: vi.fn((input: unknown) => {
      const item = input as Row;
      return {
        event: 'add',
        changeId: item.id,
        trackedChangeCanonicalId: item.id,
        documentId: 'doc-1',
        trackedChangeText: item.excerpt,
        trackedChangeType: 'insert',
        trackedChangeDisplayType: 'insert',
        trackedChangeAnchorKey: `tc::body::${item.id}`,
        trackedChangePositionAliases: item.aliases ?? [],
      };
    }),
  });
  const superdoc = {
    activeEditor: { editorVersion: 2, documentId: 'doc-1' },
    config: { isInternal: true },
    emit: vi.fn(),
  };
  store.setV2CommentsAdapter(commentsAdapter);
  store.setV2TrackedChangesAdapter(trackedChangesAdapter);
  const apply = (rows: Row[], comments: { commentId: string; text: string; parentCommentId?: string }[] = []) =>
    store.applyReviewWindowFromV2({
      superdoc: superdoc as never,
      commentsAdapter,
      trackedChangesAdapter,
      documentId: 'doc-1',
      commentItems: comments,
      trackedChangeItems: rows,
      trackedList: { complete: false, visibleWindowSource: 'visible-window' },
      patch: (callback) => store.$patch(callback),
    });
  return { store, hostStore, superdoc, commentsAdapter, trackedChangesAdapter, apply };
}

function randomGenerator(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

function snapshot(fixture: ReturnType<typeof createFixture>, result: unknown) {
  return JSON.parse(
    JSON.stringify({
      result,
      rows: fixture.store.commentsList.map((row) => row.getValues()),
      liveRows: fixture.store.commentsList,
      active: fixture.store.activeComment,
      instance: fixture.store.activeFloatingCommentInstanceId,
      editing: fixture.store.editingCommentId,
      pending: fixture.store.pendingComment?.getValues() ?? null,
      text: fixture.store.currentCommentText,
      mentions: fixture.store.currentCommentMentions,
      selectionPosition: fixture.hostStore.selectionPosition,
      presentations: fixture.store.committedReviewPresentations,
      events: fixture.superdoc.emit.mock.calls,
    }),
  );
}

function runSequence(seed: number) {
  const fixture = createFixture();
  const random = randomGenerator(seed);
  const states = [];
  fixture.store.commentsList = [useComment({ commentId: 'foreign', fileId: 'doc-2', commentText: 'other' })];
  for (let step = 0; step < 40; step++) {
    const start = random() % 24;
    const count = 3 + (random() % 9);
    const rows = Array.from({ length: count }, (_, index) => {
      const id = `row-${(start + index) % 32}`;
      return { id, excerpt: `${id}-${random() % 4}`, aliases: random() % 3 === 0 ? [`alias-${id}`] : [] };
    });
    const comments = Array.from({ length: random() % 4 }, (_, index) => ({
      commentId: `comment-${(start + index) % 12}`,
      text: `text-${random() % 6}`,
      ...(index ? { parentCommentId: `comment-${start % 12}` } : {}),
    }));
    const currentRows = fixture.store.commentsList.filter((row) => row.fileId === 'doc-1');
    fixture.store.activeComment =
      currentRows.length && step % 4 === 0 ? (currentRows[random() % currentRows.length].commentId ?? null) : null;
    fixture.store.editingCommentId =
      currentRows.length && step % 7 === 0 ? (currentRows[random() % currentRows.length].commentId ?? null) : null;
    if (step % 9 === 0 && currentRows.length) {
      currentRows[random() % currentRows.length].trackedChangePositionAliases = [`manual-${step}`];
    }
    const result = fixture.apply(rows, comments);
    states.push(snapshot(fixture, result));
    if (step % 11 === 0) {
      fixture.store.setV2TrackedChangesAdapter(null);
      states.push(snapshot(fixture, fixture.apply(rows, comments)));
      fixture.store.setV2TrackedChangesAdapter(fixture.trackedChangesAdapter);
    }
  }
  return createHash('sha256').update(JSON.stringify(states)).digest('hex');
}

function runPreparedSequence(seed: number) {
  const fixture = createFixture();
  const random = randomGenerator(seed);
  const states = [];
  for (let version = 1; version <= 36; version++) {
    const start = random() % 15;
    const rows = Array.from({ length: 3 + (random() % 8) }, (_, index) => {
      const id = `prepared-${(start + index) % 20}`;
      return { id, excerpt: `${id}-${random() % 3}`, aliases: random() % 2 ? [`source-${id}`] : [] };
    });
    const params = rows.map((row) => fixture.trackedChangesAdapter.mapV2TrackedChangeToCommentParams(row));
    const presentation = {
      epoch: 'epoch-1',
      baseVersion: version - 1,
      version,
      catalogVersion: 1,
      coordinate: { documentEpoch: 'epoch-1', mountId: 'mount-1', reviewVersion: version, commitSequence: version },
      rowVersions: Object.fromEntries(rows.map((row) => [row.id, 1 + (random() % 3)])),
      instances: rows.map((row, index) => ({ id: row.id, rowId: row.id, threadId: row.id, top: index * 20 })),
      groupOrder: { open: rows.map((row) => row.id), resolved: [] },
    };
    const apply = (overrides: Record<string, unknown> = {}) =>
      fixture.store.applyReviewWindowFromV2({
        superdoc: fixture.superdoc as never,
        commentsAdapter: fixture.commentsAdapter,
        trackedChangesAdapter: fixture.trackedChangesAdapter,
        documentId: 'doc-1',
        commentItems: [],
        trackedChangeItems: rows,
        preparedReview: { comments: [], trackedChanges: params, presentation },
        trackedList: { complete: false, visibleWindowSource: 'visible-window' },
        patch: (callback: () => void) => fixture.store.$patch(callback),
        ...overrides,
      } as never);
    const existing = fixture.store.commentsList.filter((row) => row.trackedChange);
    fixture.store.activeComment =
      existing.length && version % 4 === 0 ? (existing[random() % existing.length].commentId ?? null) : null;
    if (version % 6 === 0 && existing.length) {
      existing[random() % existing.length].trackedChangePositionAliases.push(`manual-${version}`);
    }
    states.push(snapshot(fixture, apply()));
    if (version % 8 === 0) {
      const stale = { ...presentation, coordinate: { ...presentation.coordinate } };
      states.push(
        snapshot(
          fixture,
          apply({
            preparedReview: {
              comments: [],
              trackedChanges: params,
              presentation: stale,
              reuseCatalog: true,
              catalogVersion: 1,
            },
          }),
        ),
      );
    }
  }
  return createHash('sha256').update(JSON.stringify(states)).digest('hex');
}

function benchmark() {
  const samples = [];
  for (let trial = 0; trial < 8; trial++) {
    const fixture = createFixture();
    const rows = (batch: number) =>
      Array.from({ length: 600 }, (_, index) => ({ id: `${batch}-${index}`, excerpt: `text-${index}` }));
    fixture.apply(rows(0));
    const start = performance.now();
    const result = fixture.apply(rows(1));
    const duration = performance.now() - start;
    expect(result.ok).toBe(true);
    expect(fixture.store.commentsList).toHaveLength(600);
    if (trial >= 2) samples.push(duration);
    fixture.store.$dispose();
  }
  samples.sort((a, b) => a - b);
  return { median: (samples[2] + samples[3]) / 2, samples };
}

function benchmarkRetained() {
  const fixture = createFixture();
  const rows = Array.from({ length: 600 }, (_, index) => ({ id: `retained-${index}`, excerpt: `text-${index}` }));
  const samples = [];
  for (let trial = 0; trial < 10; trial++) {
    const start = performance.now();
    const result = fixture.apply(rows);
    const duration = performance.now() - start;
    expect(result.ok).toBe(true);
    if (trial >= 4) samples.push(duration);
  }
  samples.sort((a, b) => a - b);
  fixture.store.$dispose();
  return { median: (samples[2] + samples[3]) / 2, samples };
}

describe('review window store performance and equivalence', () => {
  afterEach(() => vi.restoreAllMocks());

  it('matches baseline snapshots across seeded window sequences', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    const hashes = [3, 42, 777, 123456].map(runSequence);
    if (process.env.P2_RECORD_EQUIVALENCE) console.info('P2_BASELINE_HASHES', JSON.stringify(hashes));
    expect(hashes).toEqual([
      '652ce2daeeafb0d28f74d9f339fa6302cc9722e93ab6f3018c364706ae1c54bd',
      '29e0cba7a7cb07db228d0c3e6401aecb1a5ea59cd4e9318053dc96b8d3c2bc83',
      '880420317af7e2581a678042a815dd9349e39c91723be7caf6e9d355cc776fe9',
      'aedd95ba5b55baa7d223167573bf884c73930070497cb74090838885748b6c40',
    ]);
  });

  it('matches baseline snapshots across prepared windows and stale publications', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    const hashes = [19, 411, 903].map(runPreparedSequence);
    if (process.env.P2_RECORD_EQUIVALENCE) console.info('P2_PREPARED_HASHES', JSON.stringify(hashes));
    expect(hashes).toEqual([
      '31ad3f203ca44c68b96574077a58951e38dcd330c9992df6cee1617e4b046dc3',
      '4ab7ad52d0e8bf1d1569ec51edc932f8831145d0f5c9dc96e2a249799a1164d3',
      '082700b0263ce760c353b19682db42a4c63c5714467075bd7083827d9c560982',
    ]);
  });

  it('retains a pending draft, selection and active row when new tracked rows arrive', () => {
    const fixture = createFixture();
    const draft = useComment({ commentId: 'draft', fileId: 'doc-1', commentText: '' });
    fixture.store.pendingComment = draft;
    fixture.store.activeComment = 'draft';
    fixture.store.activeFloatingCommentInstanceId = 'draft';
    fixture.store.currentCommentText = '<p>Unsent draft</p>';
    fixture.store.currentCommentMentions = [{ name: 'A', email: 'a@example.com' }];
    const selection = { source: 'editor', page: 1 };
    fixture.hostStore.selectionPosition = selection as typeof fixture.hostStore.selectionPosition;

    expect(fixture.apply([{ id: 'new', excerpt: 'added' }]).ok).toBe(true);
    expect(fixture.store.pendingComment).toBe(draft);
    expect(fixture.store.activeComment).toBe('draft');
    expect(fixture.store.activeFloatingCommentInstanceId).toBe('draft');
    expect(fixture.store.currentCommentText).toBe('<p>Unsent draft</p>');
    expect(fixture.store.currentCommentMentions).toEqual([{ name: 'A', email: 'a@example.com' }]);
    expect(fixture.hostStore.selectionPosition).toEqual(selection);
    expect(fixture.store.commentsList.find((row) => row.commentId === 'new')?.commentText).toBe('');
  });

  it('retains a reply draft when a tracked row arrives', () => {
    const fixture = createFixture();
    const row = useComment({ commentId: 'existing', fileId: 'doc-1', commentText: 'existing' });
    fixture.store.commentsList = [row];
    fixture.store.activeComment = 'existing';
    fixture.store.currentCommentText = '<p>Reply in progress</p>';
    fixture.store.currentCommentMentions = [{ name: 'A', email: 'a@example.com' }];

    expect(fixture.apply([{ id: 'new', excerpt: 'added' }]).ok).toBe(true);
    expect(fixture.store.activeComment).toBe('existing');
    expect(fixture.store.currentCommentText).toBe('<p>Reply in progress</p>');
    expect(fixture.store.currentCommentMentions).toEqual([{ name: 'A', email: 'a@example.com' }]);
    expect(fixture.store.commentsList.find((item) => item.commentId === 'new')?.commentText).toBe('');
  });

  it('keeps a null-id parent without parsing empty text', () => {
    const fixture = createFixture();
    const parent = useComment({ commentId: 'placeholder', fileId: 'doc-1', isInternal: true });
    parent.commentId = null as never;
    fixture.store.commentsList = [parent];
    const parser = vi.spyOn(DOMParser.prototype, 'parseFromString');

    expect(fixture.apply([{ id: 'new', excerpt: 'added' }]).ok).toBe(true);
    expect(fixture.store.commentsList.find((row) => row.commentId === 'new')?.isInternal).toBe(true);
    expect(parser).not.toHaveBeenCalled();
  });

  it('clears inherited mentions for empty text and still parses nonempty mentions', () => {
    const fixture = createFixture();
    const parser = vi.spyOn(DOMParser.prototype, 'parseFromString');
    const empty = useComment({
      commentId: 'empty',
      fileId: 'doc-1',
      commentText: '',
      mentions: [{ name: 'Old', email: 'old@example.com' }],
    });
    fixture.store.addHydratedComment({ superdoc: fixture.superdoc as never, comment: empty, broadcastChanges: false });
    expect(fixture.store.commentsList[0].mentions).toEqual([]);
    expect(parser).not.toHaveBeenCalled();

    const mentioned = useComment({
      commentId: 'mentioned',
      fileId: 'doc-1',
      commentText: '<span data-type="mention" name="New" email="new@example.com">New</span>',
    });
    fixture.store.addHydratedComment({
      superdoc: fixture.superdoc as never,
      comment: mentioned,
      broadcastChanges: false,
    });
    expect(fixture.store.commentsList[1].mentions).toEqual([{ name: 'New', email: 'new@example.com' }]);
    expect(parser).toHaveBeenCalledTimes(1);
  });

  it('keeps the submitted draft owned across a review window', async () => {
    const fixture = createFixture();
    let finish: (value: V2CommentMutationOutcome) => void = () => undefined;
    fixture.commentsAdapter.captureCurrentSelection = vi.fn(async () => ({ ok: true, target: { anchor: 1 } }));
    fixture.commentsAdapter.commitPendingComment = vi.fn(
      () =>
        new Promise<V2CommentMutationOutcome>((resolve) => {
          finish = resolve;
        }),
    );
    expect(await fixture.store.showAddComment(fixture.superdoc as never)).toMatchObject({ ok: true });
    fixture.store.currentCommentText = 'Submitted draft';
    const pending = fixture.store.pendingComment;
    const submission = fixture.store.addComment({ superdoc: fixture.superdoc as never, comment: pending! });

    expect(fixture.apply([{ id: 'new', excerpt: 'added' }]).ok).toBe(true);
    expect(fixture.store.pendingComment).toBe(pending);
    finish({ ok: true, items: [{ commentId: 'created', text: 'Submitted draft' }], createdCommentId: 'created' });
    expect(await submission).toMatchObject({ ok: true });
    expect(fixture.store.pendingComment).toBeNull();
    expect(fixture.store.activeComment).toBe('created');
  });

  it('still supersedes an unfinished selection capture when no draft exists', async () => {
    const fixture = createFixture();
    let finish: (value: V2CommentSelectionCapture) => void = () => undefined;
    fixture.commentsAdapter.captureCurrentSelection = vi.fn(
      () =>
        new Promise<V2CommentSelectionCapture>((resolve) => {
          finish = resolve;
        }),
    );
    const capture = fixture.store.showAddComment(fixture.superdoc as never);
    expect(fixture.apply([{ id: 'new', excerpt: 'added' }]).ok).toBe(true);
    finish({ ok: true, target: { anchor: 1 } });
    expect(await capture).toMatchObject({ ok: false, reason: 'pending-comment-superseded' });
    expect(fixture.store.pendingComment).toBeNull();
  });

  it('reuses the identity index only while row order and alias values remain current', () => {
    const fixture = createFixture();
    const rows = [
      { id: 'first', excerpt: 'one' },
      { id: 'second', excerpt: 'two' },
    ];
    const work: Record<string, unknown>[] = [];
    const previous = Reflect.get(globalThis, '__superdocInteractionTrace');
    Reflect.set(globalThis, '__superdocInteractionTrace', {
      startSpan: (stage: string) => ({ stage }),
      endSpan: (span: { stage: string }, meta: Record<string, unknown>) => {
        if (span.stage === 'store.trackedChanges.batchIdentity') work.push(meta);
      },
    });
    try {
      for (let i = 0; i < 4; i++) expect(fixture.apply(rows).ok).toBe(true);
      expect(work.at(-1)?.indexReused).toBe(1);

      fixture.store.commentsList.reverse();
      fixture.store.reconcileTrackedChangesFromV2({
        superdoc: fixture.superdoc as never,
        adapter: fixture.trackedChangesAdapter,
        documentId: 'doc-1',
        items: [],
        pruneStale: false,
      });
      expect(work.at(-1)?.indexReused).toBe(0);

      const row = fixture.store.commentsList.find((item) => item.commentId === 'first');
      expect(row).toBeDefined();
      toRaw(row!.trackedChangePositionAliases).push('new-source');
      fixture.store.reconcileTrackedChangesFromV2({
        superdoc: fixture.superdoc as never,
        adapter: fixture.trackedChangesAdapter,
        documentId: 'doc-1',
        items: [{ id: 'new-source', excerpt: 'updated' }],
        preparedParams: [
          {
            event: 'add',
            changeId: 'new-source',
            trackedChangeCanonicalId: 'first',
            documentId: 'doc-1',
            trackedChangeText: 'updated',
            trackedChangeType: 'insert',
            trackedChangeDisplayType: 'insert',
          },
        ],
        pruneStale: false,
      });
      expect(work.at(-1)?.indexReused).toBe(0);
      expect(fixture.store.commentsList).toHaveLength(2);
      expect(row?.trackedChangeText).toBe('updated');
    } finally {
      if (previous === undefined) Reflect.deleteProperty(globalThis, '__superdocInteractionTrace');
      else Reflect.set(globalThis, '__superdocInteractionTrace', previous);
    }
  });

  it('isolates identity indexes during reentrant reconciliations', () => {
    const fixture = createFixture();
    const rows = [{ id: 'first', excerpt: 'one' }];
    for (let i = 0; i < 4; i++) expect(fixture.apply(rows).ok).toBe(true);
    const work: Record<string, unknown>[] = [];
    const previous = Reflect.get(globalThis, '__superdocInteractionTrace');
    let nested = false;
    const reconcile = () =>
      fixture.store.reconcileTrackedChangesFromV2({
        superdoc: fixture.superdoc as never,
        adapter: fixture.trackedChangesAdapter,
        documentId: 'doc-1',
        items: [],
        pruneStale: false,
      });
    Reflect.set(globalThis, '__superdocInteractionTrace', {
      startSpan: (stage: string) => {
        if (stage === 'store.trackedChanges.batchIdentity' && !nested) {
          nested = true;
          reconcile();
        }
        return { stage };
      },
      endSpan: (span: { stage: string }, meta: Record<string, unknown>) => {
        if (span.stage === 'store.trackedChanges.batchIdentity') work.push(meta);
      },
    });
    try {
      reconcile();
      expect(work.map((entry) => entry.indexReused)).toEqual([0, 1]);
      expect(fixture.store.commentsList.map((row) => row.commentId)).toEqual(['first']);
    } finally {
      if (previous === undefined) Reflect.deleteProperty(globalThis, '__superdocInteractionTrace');
      else Reflect.set(globalThis, '__superdocInteractionTrace', previous);
    }
  });

  it('releases the identity index when mapping throws', () => {
    const fixture = createFixture();
    const rows = [{ id: 'first', excerpt: 'one' }];
    for (let i = 0; i < 4; i++) expect(fixture.apply(rows).ok).toBe(true);
    fixture.trackedChangesAdapter.mapV2TrackedChangeToCommentParams.mockImplementationOnce(() => {
      throw new Error('mapping failed');
    });
    expect(() =>
      fixture.store.reconcileTrackedChangesFromV2({
        superdoc: fixture.superdoc as never,
        adapter: fixture.trackedChangesAdapter,
        documentId: 'doc-1',
        items: rows,
        pruneStale: false,
      }),
    ).toThrow('mapping failed');
    const work: Record<string, unknown>[] = [];
    const previous = Reflect.get(globalThis, '__superdocInteractionTrace');
    Reflect.set(globalThis, '__superdocInteractionTrace', {
      startSpan: (stage: string) => ({ stage }),
      endSpan: (span: { stage: string }, meta: Record<string, unknown>) => {
        if (span.stage === 'store.trackedChanges.batchIdentity') work.push(meta);
      },
    });
    try {
      fixture.store.reconcileTrackedChangesFromV2({
        superdoc: fixture.superdoc as never,
        adapter: fixture.trackedChangesAdapter,
        documentId: 'doc-1',
        items: [],
        pruneStale: false,
      });
      expect(work.at(-1)?.indexReused).toBe(1);
    } finally {
      if (previous === undefined) Reflect.deleteProperty(globalThis, '__superdocInteractionTrace');
      else Reflect.set(globalThis, '__superdocInteractionTrace', previous);
    }
  });

  it.skipIf(!process.env.P2_STORE_BENCH)(
    'applies 600 new rows in at most half the baseline median',
    () => {
      const measured = benchmark();
      console.info('P2_STORE_BENCH', JSON.stringify(measured));
      console.info('P2_STORE_RETAINED_BENCH', JSON.stringify(benchmarkRetained()));
      if (process.env.P2_STORE_BASELINE_MS) {
        expect(measured.median).toBeLessThanOrEqual(Number(process.env.P2_STORE_BASELINE_MS) * 0.5);
      }
    },
    120000,
  );
});
