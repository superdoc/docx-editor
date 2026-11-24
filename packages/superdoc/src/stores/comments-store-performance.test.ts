import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { createPinia, setActivePinia } from 'pinia';
import { computed, toRaw } from 'vue';
import useComment from '../components/CommentsLayer/use-comment.js';
import { makeV2CommentsAdapter, makeV2TrackedChangesAdapter } from '../test-support/v2-review-adapters.js';
import { useCommentsStore } from './comments-store.js';
import { useSuperdocStore } from './superdoc-store.js';
import type {
  V2CommentMutationOutcome,
  V2CommentSelectionCapture,
  V2CommentsAdapter,
  V2TrackedChangeCommentParams,
} from './helpers/v2-review-adapters.js';
import type { CommentPositionEntry } from './helpers/comment-identity.js';

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

function recordInteractionWork<Result>(run: () => Result) {
  const started: string[] = [];
  const ended = new Map<string, Record<string, unknown>>();
  const previous = Reflect.get(globalThis, '__superdocInteractionTrace');
  Reflect.set(globalThis, '__superdocInteractionTrace', {
    startSpan: (stage: string) => {
      started.push(stage);
      return { traceId: 'work-budget', spanId: stage };
    },
    endSpan: (span: { spanId: string }, meta: Record<string, unknown> | undefined) => {
      if (meta) ended.set(span.spanId, meta);
    },
  });
  try {
    const result = run();
    return {
      result,
      spans: (stage: string) => started.filter((entry) => entry === stage).length,
      work: (stage: string, field: string) => Number(ended.get(stage)?.[field] ?? Number.NaN),
    };
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, '__superdocInteractionTrace');
    else Reflect.set(globalThis, '__superdocInteractionTrace', previous);
  }
}

const ROW_UPDATE = 'store.trackedChanges.handleUpdate';
const BATCH_IDENTITY = 'store.trackedChanges.batchIdentity';

function trackedParams(id: string, text = id): V2TrackedChangeCommentParams {
  return {
    event: 'add',
    changeId: id,
    trackedChangeCanonicalId: id,
    trackedChangeText: text,
    trackedChangeType: 'insert',
    trackedChangeDisplayType: 'insert',
    trackedChangeAnchorKey: `tc::body::${id}`,
  };
}

function trackedPublication(
  rows: V2TrackedChangeCommentParams[],
  version: number,
  rowVersions?: Record<string, number>,
) {
  const ids = rows.map((row) => String(row.changeId));
  return {
    epoch: 'document',
    baseVersion: version - 1,
    version,
    coordinate: { documentEpoch: 'document', mountId: 'mount', commitSequence: version, reviewVersion: version },
    instances: ids.map((id, index) => ({ id, rowId: id, threadId: id, top: index * 20 + version })),
    rowVersions: rowVersions ?? Object.fromEntries(ids.map((id) => [id, 1])),
    threads: Object.fromEntries(ids.map((id) => [id, [id]])),
    groupOrder: { open: ids, resolved: [] },
  };
}

function applyPrepared(fixture: ReturnType<typeof createFixture>, overrides: Record<string, unknown>) {
  return fixture.store.applyReviewWindowFromV2({
    superdoc: fixture.superdoc,
    commentsAdapter: fixture.commentsAdapter,
    trackedChangesAdapter: fixture.trackedChangesAdapter,
    documentId: 'doc-1',
    commentItems: [],
    trackedChangeItems: [],
    trackedList: { complete: false, visibleWindowSource: 'visible-window' },
    patch: (callback: () => void) => fixture.store.$patch(callback),
    ...overrides,
  } as never);
}

function publishTracked(
  fixture: ReturnType<typeof createFixture>,
  rows: V2TrackedChangeCommentParams[],
  presentation: ReturnType<typeof trackedPublication>,
) {
  return applyPrepared(fixture, {
    trackedChangeItems: rows.map((row) => ({ id: row.changeId })),
    preparedReview: { comments: [], trackedChanges: rows, presentation },
  });
}

function publishFirst(fixture: ReturnType<typeof createFixture>, rows: V2TrackedChangeCommentParams[]) {
  const first = recordInteractionWork(() => publishTracked(fixture, rows, trackedPublication(rows, 1)));
  expect(first.result.ok).toBe(true);
  expect(first.spans(ROW_UPDATE)).toBeGreaterThan(0);
}

function trackedRow(commentId: string, overrides: Record<string, unknown> = {}) {
  return useComment({
    commentId,
    fileId: 'doc-1',
    trackedChange: true,
    trackedChangeText: commentId,
    trackedChangeType: 'insert',
    trackedChangeDisplayType: 'insert',
    trackedChangeAnchorKey: `tc::body::${commentId}`,
    commentText: '',
    ...overrides,
  });
}

function position(start: number, overrides: Partial<NonNullable<CommentPositionEntry>> = {}) {
  return { kind: 'trackedChange', storyKey: 'body', pageIndex: 0, start, end: start + 1, ...overrides };
}

function countEnumerations<Target extends object>(target: Target) {
  const counter = { enumerations: 0 };
  const proxy = new Proxy(target, {
    ownKeys(source) {
      counter.enumerations++;
      return Reflect.ownKeys(source);
    },
  });
  return { proxy, counter };
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

type Fields = Record<string, unknown>;
type RecordedState = Fields & { label: string; rows: Fields[]; liveRows: Fields[] };

function json(value: unknown) {
  return JSON.stringify(value) ?? 'undefined';
}

function rowFields(live: Fields, values: Fields) {
  const fields = new Map<string, string>();
  for (const key of Object.keys(live)) {
    if (key !== 'commentId') fields.set(key, json(live[key]));
  }
  for (const key of new Set([...Object.keys(live), ...Object.keys(values)])) {
    if (json(values[key]) !== json(live[key])) fields.set(`getValues.${key}`, json(values[key]));
  }
  return fields;
}

function rowsByKey(state: RecordedState) {
  const occurrences = new Map<string, number>();
  const rows = new Map<string, Map<string, string>>();
  state.liveRows.forEach((live, index) => {
    const id = String(live.commentId);
    const occurrence = (occurrences.get(id) ?? 0) + 1;
    occurrences.set(id, occurrence);
    rows.set(occurrence > 1 ? `${id}#${occurrence}` : id, rowFields(live, state.rows[index] ?? {}));
  });
  return rows;
}

function describeField(key: string, fields: Map<string, string>) {
  const text = fields.get(key);
  if (text !== undefined) return ` ${key}=${text}`;
  return key.startsWith('getValues.') ? ` ${key} matches live` : ` ${key}=undefined`;
}

function changedFields(fields: Map<string, string>, baseline: Map<string, string>) {
  return [...new Set([...baseline.keys(), ...fields.keys()])]
    .filter((key) => fields.get(key) !== baseline.get(key))
    .map((key) => describeField(key, fields))
    .join('');
}

function flatten(path: string, value: unknown, lines: Map<string, string>) {
  const entries = value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : [];
  if (!entries.length) lines.set(path, json(value));
  for (const [key, child] of entries) flatten(`${path}.${key}`, child, lines);
}

function recordSequence(fixture: ReturnType<typeof createFixture>, states: RecordedState[]) {
  const blank = useComment({ commentId: 'blank', fileId: 'doc-1', fileType: fixture.hostStore.documents[0]?.type });
  const blankFields = rowFields(JSON.parse(JSON.stringify(blank)), JSON.parse(JSON.stringify(blank.getValues())));
  const baseline = [
    'row fields not listed below match this blank row',
    ...[...blankFields.keys()].map((key) => ` ${describeField(key, blankFields)}`),
  ];
  let previous = new Map<string, string>();
  let previousRows = new Map<string, Map<string, string>>();
  const lastSeen = new Map<string, Map<string, string>>();
  const steps = states.map((state) => {
    const lines = new Map<string, string>();
    for (const [key, value] of Object.entries(state)) {
      if (key !== 'label' && key !== 'rows' && key !== 'liveRows') flatten(key, value, lines);
    }
    const rows = rowsByKey(state);
    lines.set('order', [...rows.keys()].join(' '));
    const changed = [...lines].filter(([path, text]) => previous.get(path) !== text);
    const removed = [...previous.keys()].filter((path) => !lines.has(path));
    const rowLines = [...rows].flatMap(([id, fields]) => {
      const seen = lastSeen.get(id);
      const delta = changedFields(fields, seen ?? blankFields);
      lastSeen.set(id, fields);
      if (!previousRows.has(id)) return [`  row ${id} ${seen ? 'returns' : 'added'}${delta}`];
      return delta ? [`  row ${id} changed${delta}`] : [];
    });
    const droppedRows = [...previousRows.keys()].filter((id) => !rows.has(id)).map((id) => `  row ${id} removed`);
    previous = lines;
    previousRows = rows;
    return [
      state.label,
      ...changed.map(([path, text]) => `  ${path}: ${text}`),
      ...removed.map((path) => `  ${path} removed`),
      ...rowLines,
      ...droppedRows,
    ];
  });
  return `${[baseline, ...steps].map((lines) => lines.join('\n')).join('\n\n')}\n`;
}

function runSequence(seed: number) {
  const fixture = createFixture();
  const random = randomGenerator(seed);
  const states: RecordedState[] = [];
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
    const label = `step ${step}: apply rows ${rows.map((row) => row.id).join(' ')}, comments ${comments.map((comment) => comment.commentId).join(' ') || 'none'}`;
    const result = fixture.apply(rows, comments);
    states.push({ label, ...snapshot(fixture, result) });
    if (step % 11 === 0) {
      fixture.store.setV2TrackedChangesAdapter(null);
      states.push({
        label: `${label} again without a tracked-changes adapter`,
        ...snapshot(fixture, fixture.apply(rows, comments)),
      });
      fixture.store.setV2TrackedChangesAdapter(fixture.trackedChangesAdapter);
    }
  }
  return recordSequence(fixture, states);
}

function runPreparedSequence(seed: number) {
  const fixture = createFixture();
  const random = randomGenerator(seed);
  const states: RecordedState[] = [];
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
    const label = `version ${version}: apply prepared rows ${rows.map((row) => row.id).join(' ')}`;
    states.push({ label, ...snapshot(fixture, apply()) });
    if (version % 8 === 0) {
      const stale = { ...presentation, coordinate: { ...presentation.coordinate } };
      states.push({
        label: `version ${version}: republish the same version with the catalog reused`,
        ...snapshot(
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
      });
    }
  }
  return recordSequence(fixture, states);
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

  it.each([3, 42, 777, 123456])('records the store state across seeded window sequence %i', async (seed) => {
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    await expect(runSequence(seed)).toMatchFileSnapshot(
      `./__snapshots__/comments-store-performance/window-sequence-${seed}.txt`,
    );
  });

  it.each([19, 411, 903])('records the store state across prepared window sequence %i', async (seed) => {
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    await expect(runPreparedSequence(seed)).toMatchFileSnapshot(
      `./__snapshots__/comments-store-performance/prepared-sequence-${seed}.txt`,
    );
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

  it('clears inherited mentions for empty text and still parses nonempty mentions', async () => {
    const fixture = createFixture();
    const parser = vi.spyOn(DOMParser.prototype, 'parseFromString');
    const empty = useComment({
      commentId: 'empty',
      fileId: 'doc-1',
      commentText: '',
      mentions: [{ name: 'Old', email: 'old@example.com' }],
    });
    await fixture.store.addHydratedComment({
      superdoc: fixture.superdoc as never,
      comment: empty,
      broadcastChanges: false,
    });
    expect(fixture.store.commentsList[0].mentions).toEqual([]);
    expect(parser).not.toHaveBeenCalled();

    const mentioned = useComment({
      commentId: 'mentioned',
      fileId: 'doc-1',
      commentText: '<span data-type="mention" name="New" email="new@example.com">New</span>',
    });
    await fixture.store.addHydratedComment({
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

  it('keeps rows matched after reordering and after an alias is added to a row', () => {
    const fixture = createFixture();
    const rows = [
      { id: 'first', excerpt: 'one' },
      { id: 'second', excerpt: 'two' },
    ];
    for (let i = 0; i < 4; i++) expect(fixture.apply(rows).ok).toBe(true);
    expect(fixture.store.commentsList.map((row) => row.commentId)).toEqual(['first', 'second']);

    fixture.store.commentsList.reverse();
    fixture.store.reconcileTrackedChangesFromV2({
      superdoc: fixture.superdoc as never,
      adapter: fixture.trackedChangesAdapter,
      documentId: 'doc-1',
      items: [],
      pruneStale: false,
    });
    expect(fixture.store.commentsList.map((row) => row.commentId)).toEqual(['second', 'first']);

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
    expect(fixture.store.commentsList).toHaveLength(2);
    expect(row?.trackedChangeText).toBe('updated');
  });

  it('isolates identity indexes during reentrant reconciliations', () => {
    const fixture = createFixture();
    const rows = [{ id: 'first', excerpt: 'one' }];
    for (let i = 0; i < 4; i++) expect(fixture.apply(rows).ok).toBe(true);
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
      endSpan: () => undefined,
    });
    try {
      reconcile();
      expect(fixture.store.commentsList.map((row) => row.commentId)).toEqual(['first']);
    } finally {
      if (previous === undefined) Reflect.deleteProperty(globalThis, '__superdocInteractionTrace');
      else Reflect.set(globalThis, '__superdocInteractionTrace', previous);
    }
  });

  it('keeps reconciling rows after a mapping error', () => {
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

    fixture.store.reconcileTrackedChangesFromV2({
      superdoc: fixture.superdoc as never,
      adapter: fixture.trackedChangesAdapter,
      documentId: 'doc-1',
      items: [{ id: 'first', excerpt: 'after the error' }],
      pruneStale: false,
    });
    expect(fixture.store.commentsList.map((row) => ({ id: row.commentId, text: row.trackedChangeText }))).toEqual([
      { id: 'first', text: 'after the error' },
    ]);
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

describe('comments store work budgets', () => {
  afterEach(() => vi.restoreAllMocks());

  it('enumerates registered position aliases at most once across 96 permission misses (SD-5650)', () => {
    const fixture = createFixture();
    const { proxy, counter } = countEnumerations(
      Object.fromEntries(
        Array.from({ length: 512 }, (_, index) => [
          `slot-${index}`,
          position(index, { key: `anchor-${index}`, threadId: `thread-${index}` }),
        ]),
      ),
    );
    fixture.store.editorCommentPositions = proxy;
    counter.enumerations = 0;

    expect(fixture.store.getComment('missing-first')).toBeNull();
    const firstLookup = counter.enumerations;
    expect(firstLookup).toBeGreaterThan(0);
    for (let index = 0; index < 96; index++) expect(fixture.store.getComment(`missing-${index}`)).toBeNull();

    expect(counter.enumerations).toBeLessThanOrEqual(firstLookup);
  });

  it('follows alias geometry changes without enumerating the positions again (SD-5650)', () => {
    const fixture = createFixture();
    fixture.store.commentsList = [trackedRow('row-a'), trackedRow('row-b')];
    const { proxy, counter } = countEnumerations({
      'tc::body::row-a': position(100),
      'tc::body::row-b': position(200),
      slot: position(100, { key: 'painted' }),
    });
    fixture.store.editorCommentPositions = proxy;
    counter.enumerations = 0;
    expect(fixture.store.getComment('painted')?.commentId).toBe('row-a');
    const firstLookup = counter.enumerations;
    expect(firstLookup).toBeGreaterThan(0);

    const slot = fixture.store.editorCommentPositions.slot;
    if (!slot) throw new Error('slot position missing');
    slot.start = 200;
    slot.end = 201;
    expect(fixture.store.getComment('painted')?.commentId).toBe('row-b');
    slot.storyKey = 'fn:1';
    expect(fixture.store.getComment('painted')).toBeNull();

    expect(counter.enumerations).toBeLessThanOrEqual(firstLookup);
  });

  it('reads the backing comment rows no further after the identity index is built (SD-5650)', () => {
    const fixture = createFixture();
    const reads = { count: 0 };
    const rows = Array.from({ length: 512 }, (_, index) =>
      useComment({ commentId: `comment-${index}`, importedId: `word-${index}`, fileId: 'doc-1', commentText: 'Body' }),
    );
    fixture.store.commentsList = new Proxy(rows, {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads.count++;
        return Reflect.get(target, key, receiver);
      },
    });
    expect(fixture.store.getComment('missing-first')).toBeNull();
    const last = fixture.store.commentsList[511];
    const warmed = reads.count;
    expect(warmed).toBeGreaterThan(0);

    for (let index = 0; index < 64; index++) {
      expect(fixture.store.getComment(`missing-${index}`)).toBeNull();
      expect(fixture.store.getComment('comment-511')).toBe(last);
      expect(fixture.store.getComment('word-511')).toBe(last);
    }
    last.commentText = 'Updated body';
    expect(fixture.store.getComment('comment-511')?.commentText).toBe('Updated body');

    expect(reads.count).toBeLessThanOrEqual(warmed);
  });

  it('indexes 1,300 retained tracked rows with identity work linear in the row count (SD-4039)', () => {
    const fixture = createFixture();
    const rowCount = 1_300;
    const ids = Array.from({ length: rowCount }, (_, index) => `tc-${index}`);
    const params = ids.map((id) => ({
      ...trackedParams(id, `updated ${id}`),
      documentId: 'doc-1',
      importedId: `imported-${id}`,
      trackedChangeCanonicalId: `canonical-${id}`,
    }));
    fixture.store.commentsList = [
      ...ids.map((id) => trackedRow(id, { importedId: `imported-${id}`, trackedChangeCanonicalId: `canonical-${id}` })),
      useComment({ commentId: 'ordinary-comment', fileId: 'doc-1', commentText: 'Thread body' }),
    ];

    const { work } = recordInteractionWork(() =>
      fixture.store.reconcileTrackedChangesFromV2({
        adapter: fixture.trackedChangesAdapter,
        documentId: 'doc-1',
        items: params,
        preparedParams: params,
        pruneStale: false,
      }),
    );

    expect(fixture.store.commentsList[rowCount - 1].trackedChangeText).toBe('updated tc-1299');
    expect(work(BATCH_IDENTITY, 'trackedRowsIndexed')).toBeLessThanOrEqual(rowCount);
    expect(work(BATCH_IDENTITY, 'candidateVisits')).toBeLessThanOrEqual(rowCount * 4);
    expect(work(BATCH_IDENTITY, 'incomingAliasLookups')).toBeLessThanOrEqual(rowCount * 6);
  });

  it.each([0, 1, 3])('reconciles at most the %s rows a continuous publication changed (#3859)', (changed) => {
    const fixture = createFixture();
    const ids = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
    const rows = ids.map((id) => trackedParams(id));
    publishFirst(fixture, rows);
    const nextRows = ids.map((id, index) => trackedParams(id, index < changed ? 'typed' : id));
    const rowVersions = Object.fromEntries(ids.map((id, index) => [id, index < changed ? 2 : 1]));

    const { result, spans } = recordInteractionWork(() =>
      publishTracked(fixture, nextRows, trackedPublication(nextRows, 2, rowVersions)),
    );

    expect(result.ok).toBe(true);
    expect(spans(ROW_UPDATE)).toBeLessThanOrEqual(changed);
  });

  it.each(['missing', 'resolved', 'type'])(
    'reconciles at most the one %s row when worker versions are unchanged (#3859)',
    (invalid) => {
      const fixture = createFixture();
      const rows = [trackedParams('first'), trackedParams('second')];
      publishFirst(fixture, rows);
      if (invalid === 'missing') fixture.store.commentsList.splice(1, 1);
      if (invalid === 'resolved') fixture.store.commentsList[1].resolvedTime = 123;
      if (invalid === 'type') fixture.store.commentsList[1].trackedChangeType = 'delete';

      const { result, spans } = recordInteractionWork(() => publishTracked(fixture, rows, trackedPublication(rows, 2)));

      expect(result.ok).toBe(true);
      expect(spans(ROW_UPDATE)).toBeGreaterThan(0);
      expect(spans(ROW_UPDATE)).toBeLessThanOrEqual(1);
    },
  );

  it('reconciles no retained row on a continuous refresh and only the incoming rows on a complete one (#3859)', () => {
    const fixture = createFixture();
    const rows = [trackedParams('first'), trackedParams('second')];
    publishFirst(fixture, rows);
    const next = trackedPublication(rows, 2);
    fixture.store.committedReviewPresentations = { 'doc-1': next } as never;
    const reconcile = (pruneStale: boolean) =>
      fixture.store.reconcileTrackedChangesFromV2({
        superdoc: fixture.superdoc as never,
        adapter: fixture.trackedChangesAdapter,
        documentId: 'doc-1',
        items: [],
        preparedParams: rows,
        preparedPresentation: next as never,
        previousPreparedPresentation: trackedPublication(rows, 1) as never,
        pruneStale,
      });

    expect(recordInteractionWork(() => reconcile(false)).spans(ROW_UPDATE)).toBe(0);
    fixture.store.commentsList.push(trackedRow('stale'), trackedRow('foreign', { fileId: 'doc-2' }));
    const complete = recordInteractionWork(() => reconcile(true)).spans(ROW_UPDATE);
    expect(complete).toBeGreaterThan(0);
    expect(complete).toBeLessThanOrEqual(rows.length);
  });

  it('reads each row alias list a constant number of times across a reverse thread closure (#3959)', () => {
    const fixture = createFixture();
    const aliasReads: number[] = [];
    const rows = Array.from({ length: 32 }, (_, index) => {
      const row = trackedRow(`chain-${index}`, index ? { parentCommentId: `chain-${index - 1}` } : {});
      aliasReads.push(0);
      Object.defineProperty(row, 'trackedChangePositionAliases', {
        configurable: true,
        get: () => {
          aliasReads[index]++;
          return [`source-${index}`];
        },
      });
      return row;
    }).reverse();
    fixture.store.commentsList = [...rows, trackedRow('stale')];
    aliasReads.fill(0);

    expect(
      applyPrepared(fixture, {
        requestedTrackedChangeIds: ['chain-0'],
        preparedReview: { comments: [], trackedChanges: [], presentation: trackedPublication([], 1) },
      }).ok,
    ).toBe(true);

    expect(fixture.store.commentsList).toHaveLength(32);
    expect(Math.min(...aliasReads)).toBeGreaterThan(0);
    expect(Math.max(...aliasReads)).toBeLessThanOrEqual(3);
  });

  it('reads a large alias group once and builds row aliases linearly while rejecting its collisions (#3959)', () => {
    const fixture = createFixture();
    const count = 40;
    const groupReads = { count: 0 };
    const aliases = Array.from({ length: 2000 }, (_, index) => `source-${index}`);
    const group = trackedRow('group', { trackedChangeCanonicalId: 'canonical-group' });
    Object.defineProperty(group, 'trackedChangePositionAliases', {
      configurable: true,
      get: () => {
        groupReads.count++;
        return aliases;
      },
    });
    const rows = Array.from({ length: count }, (_, index) =>
      trackedRow(`child-${index}`, {
        trackedChangeCanonicalId: `canonical-${index}`,
        trackedChangePositionAliases: [`source-${index}`],
      }),
    );
    fixture.store.commentsList = [group, ...rows];
    const params = rows.map((row, index) => ({
      ...trackedParams(String(row.commentId), `updated-${index}`),
      documentId: 'doc-1',
      trackedChangeCanonicalId: `canonical-${index}`,
      trackedChangePositionAliases: [`source-${index}`, `new-source-${index}`],
    }));

    const { work } = recordInteractionWork(() =>
      fixture.store.reconcileTrackedChangesFromV2({
        superdoc: fixture.superdoc as never,
        adapter: fixture.trackedChangesAdapter,
        documentId: 'doc-1',
        items: params,
        preparedParams: params,
        pruneStale: false,
      }),
    );

    expect(rows[count - 1].trackedChangeText).toBe(`updated-${count - 1}`);
    expect(groupReads.count).toBeLessThanOrEqual(1);
    expect(work(BATCH_IDENTITY, 'trackedRowsIndexed')).toBeLessThanOrEqual(count + 1);
    expect(work(BATCH_IDENTITY, 'rowAliasBuilds')).toBeLessThanOrEqual(count * 2 + 1);
  });

  it('copies no instances and reruns no subscriber for an unchanged catalog-aware host patch (#3774)', () => {
    const fixture = createFixture();
    const presentation = { ...trackedPublication([], 1), catalogVersion: 1, fontRevision: 1 };
    const preparedReview = { catalogVersion: 1, comments: [], trackedChanges: [], presentation };
    expect(applyPrepared(fixture, { preparedReview }).ok).toBe(true);
    const runs = { computed: 0, clones: 0 };
    const instances = computed(() => {
      runs.computed++;
      return fixture.store.committedReviewPresentations['doc-1']?.instances;
    });
    void instances.value;
    runs.computed = 0;
    const next = {
      ...presentation,
      unchanged: true,
      baseVersion: 1,
      version: 2,
      coordinate: { ...presentation.coordinate, reviewVersion: 2 },
    };
    Object.defineProperty(next, 'instances', {
      enumerable: true,
      get() {
        runs.clones++;
        return structuredClone([]);
      },
    });

    expect(
      applyPrepared(fixture, { preparedReview: { ...preparedReview, reuseCatalog: true, presentation: next } }).ok,
    ).toBe(true);
    void instances.value;

    expect(runs.computed).toBe(0);
    expect(runs.clones).toBe(0);
  });

  it('maps no catalog row for an acknowledged geometry-only update (#3774)', () => {
    const fixture = createFixture();
    const presentation = { ...trackedPublication([], 1), catalogVersion: 1 };
    const preparedReview = { catalogVersion: 1, comments: [], trackedChanges: [], presentation };
    expect(applyPrepared(fixture, { preparedReview }).ok).toBe(true);
    fixture.commentsAdapter.mapV2CommentToUseCommentInput.mockClear();
    fixture.trackedChangesAdapter.mapV2TrackedChangeToCommentParams.mockClear();
    const next = { ...presentation, coordinate: { ...presentation.coordinate, reviewVersion: 2 } };

    expect(
      applyPrepared(fixture, {
        commentItems: [{ commentId: 'comment-1', text: 'Comment one' }],
        trackedChangeItems: [{ id: 'tc-1', excerpt: 'Inserted text' }],
        preparedReview: { ...preparedReview, reuseCatalog: true, presentation: next },
      }),
    ).toMatchObject({ ok: true, geometryOnly: true });

    expect(fixture.commentsAdapter.mapV2CommentToUseCommentInput).not.toHaveBeenCalled();
    expect(fixture.trackedChangesAdapter.mapV2TrackedChangeToCommentParams).not.toHaveBeenCalled();
  });

  it('reruns no document-scoped computed for unrelated store changes (#5023)', () => {
    const fixture = createFixture();
    fixture.hostStore.documents = [{ id: 'doc-1' }] as typeof fixture.hostStore.documents;
    const runs = { fallback: 0, explicit: 0 };
    const fallbackScope = computed(() => {
      runs.fallback++;
      return fixture.store.belongsToDocument({}, 'doc-1');
    });
    const explicitScope = computed(() => {
      runs.explicit++;
      return fixture.store.belongsToDocument({ fileId: 'doc-1' }, 'doc-1');
    });
    void [fallbackScope.value, explicitScope.value];

    fixture.store.isCommentsListVisible = !fixture.store.isCommentsListVisible;
    fixture.hostStore.activeZoom = 150;
    void [fallbackScope.value, explicitScope.value];
    fixture.hostStore.documents = [
      ...fixture.hostStore.documents,
      { id: 'doc-2' },
    ] as typeof fixture.hostStore.documents;
    void [fallbackScope.value, explicitScope.value];

    expect(runs).toEqual({ fallback: 2, explicit: 1 });
  });
});
