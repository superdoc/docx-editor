import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { TrackDeleteMarkName, TrackFormatMarkName, TrackInsertMarkName } from '../constants.js';
import {
  buildReviewGraph,
  getOrBuildReviewGraph,
  invalidateReviewGraphCache,
  CanonicalChangeType,
  SegmentSide,
  signatureOf,
} from './review-graph.js';
import { runGraphInvariants, graphHasErrors } from './graph-invariants.js';
import { BODY_STORY } from './story-locator.js';
import { createReviewGraphTestSchema, markAttrs, stateFromTrackedSpans } from './test-fixtures.js';

const schema = createReviewGraphTestSchema();

const ALICE = { name: 'Alice', email: 'alice@example.com' };
const BOB = { name: 'Bob', email: 'bob@example.com' };

const insertMark = (attrs) => ({ markType: TrackInsertMarkName, attrs: markAttrs(attrs) });
const deleteMark = (attrs) => ({ markType: TrackDeleteMarkName, attrs: markAttrs(attrs) });
const formatMark = (attrs) => ({ markType: TrackFormatMarkName, attrs: markAttrs(attrs) });

describe('review-graph: legacy mark inference', () => {
  it('builds an insertion logical change from a legacy trackInsert mark', () => {
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [
        { text: 'Hello, ', marks: [] },
        {
          text: 'world',
          marks: [insertMark({ id: 'c1', author: ALICE.name, authorEmail: ALICE.email, date: '2026-01-01' })],
        },
      ],
    });
    const graph = buildReviewGraph({ state, story: BODY_STORY });
    expect(graph.changes.size).toBe(1);
    const change = graph.changes.get('c1');
    expect(change.type).toBe(CanonicalChangeType.Insertion);
    expect(change.subtype).toBe('text-insertion');
    expect(change.segments).toHaveLength(1);
    expect(change.insertedSegments[0].text).toBe('world');
    expect(change.excerpt).toBe('world');
    expect(change.replacement).toBeNull();
    expect(change.author).toBe('Alice');
    expect(change.authorEmail).toBe(ALICE.email);
    expect(change.revisionGroupId).toBe('c1');
    expect(graph.validate()).toEqual([]);
  });

  it('builds a deletion logical change from a legacy trackDelete mark', () => {
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [
        { text: 'Hello, ', marks: [] },
        { text: 'world', marks: [deleteMark({ id: 'c2', author: ALICE.name, authorEmail: ALICE.email })] },
      ],
    });
    const graph = buildReviewGraph({ state });
    const change = graph.changes.get('c2');
    expect(change.type).toBe(CanonicalChangeType.Deletion);
    expect(change.subtype).toBe('text-deletion');
    expect(change.deletedSegments).toHaveLength(1);
    expect(change.insertedSegments).toHaveLength(0);
  });

  it('projects paired ins+del sharing one id as one replacement', () => {
    const sharedId = 'rep1';
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [
        { text: 'old', marks: [deleteMark({ id: sharedId, authorEmail: ALICE.email })] },
        { text: 'new', marks: [insertMark({ id: sharedId, authorEmail: ALICE.email })] },
      ],
    });
    const graph = buildReviewGraph({ state, replacementsMode: 'paired' });
    expect(graph.changes.size).toBe(1);
    const change = graph.changes.get(sharedId);
    expect(change.type).toBe(CanonicalChangeType.Replacement);
    expect(change.subtype).toBe('text-replacement');
    expect(change.replacement).not.toBeNull();
    expect(change.replacement.inserted).toHaveLength(1);
    expect(change.replacement.deleted).toHaveLength(1);
    expect(change.replacement.groupId).toBe(sharedId);
    expect(change.replacement.insertedSideId).toBe(`${sharedId}#inserted`);
    expect(change.replacement.deletedSideId).toBe(`${sharedId}#deleted`);
  });

  it('keeps ins+del under distinct ids as two logical changes (independent mode shape)', () => {
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [
        { text: 'old', marks: [deleteMark({ id: 'd1' })] },
        { text: 'new', marks: [insertMark({ id: 'i1' })] },
      ],
    });
    const graph = buildReviewGraph({ state, replacementsMode: 'independent' });
    expect(graph.changes.size).toBe(2);
    expect(graph.changes.get('d1').type).toBe(CanonicalChangeType.Deletion);
    expect(graph.changes.get('i1').type).toBe(CanonicalChangeType.Insertion);
  });
});

describe('review-graph: multi-segment changes', () => {
  it('merges adjacent equivalent insertion spans into one segment', () => {
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [
        { text: 'aa', marks: [insertMark({ id: 'i1' })] },
        { text: 'bb', marks: [insertMark({ id: 'i1' })] },
      ],
    });
    const graph = buildReviewGraph({ state });
    const change = graph.changes.get('i1');
    expect(change.segments).toHaveLength(1);
    expect(change.segments[0].to - change.segments[0].from).toBe(4);
  });

  it('keeps two same-id parent deletion segments when split by a child', () => {
    const parent = 'p1';
    const child = 'c1';
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [
        { text: 'ab', marks: [deleteMark({ id: parent, authorEmail: ALICE.email })] },
        {
          text: 'cd',
          marks: [
            deleteMark({
              id: child,
              authorEmail: BOB.email,
              overlapParentId: parent,
            }),
          ],
        },
        { text: 'ef', marks: [deleteMark({ id: parent, authorEmail: ALICE.email })] },
      ],
    });
    const graph = buildReviewGraph({ state });
    const parentChange = graph.changes.get(parent);
    expect(parentChange.segments).toHaveLength(2);
    expect(parentChange.coverageSegments.map((seg) => seg.text)).toEqual(['ab', 'cd', 'ef']);
    expect(parentChange.type).toBe(CanonicalChangeType.Deletion);
    expect(parentChange.children).toEqual([child]);

    const childChange = graph.changes.get(child);
    expect(childChange.parent).toBe(parent);
    expect(childChange.segments[0].overlapRole).toBe('child');
  });
});

describe('review-graph: child overlap relationships', () => {
  it('tracks child insertion inside a parent deletion via overlapParentId', () => {
    const parent = 'pd1';
    const child = 'ci1';
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [
        { text: 'abc', marks: [deleteMark({ id: parent })] },
        { text: 'new', marks: [insertMark({ id: child, overlapParentId: parent })] },
        { text: 'def', marks: [deleteMark({ id: parent })] },
      ],
    });
    const graph = buildReviewGraph({ state });
    expect(graph.byParentId.get(parent)).toEqual([child]);
    expect(graph.changes.get(child).parent).toBe(parent);
    expect(graph.changes.get(parent).children).toEqual([child]);
  });

  it('tracks child deletion inside a parent insertion', () => {
    const parent = 'pi1';
    const child = 'cd1';
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [
        { text: 'abc', marks: [insertMark({ id: parent, authorEmail: ALICE.email })] },
        { text: 'mid', marks: [deleteMark({ id: child, authorEmail: BOB.email, overlapParentId: parent })] },
        { text: 'def', marks: [insertMark({ id: parent, authorEmail: ALICE.email })] },
      ],
    });
    const graph = buildReviewGraph({ state });
    expect(graph.changes.get(child).parent).toBe(parent);
    expect(graph.changes.get(parent).children).toEqual([child]);
  });
});

describe('review-graph: source-id projection', () => {
  it('folds legacy sourceId into sourceIds with the mark-side-specific key', () => {
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [{ text: 'ins', marks: [insertMark({ id: 's1', sourceId: 'wid-42' })] }],
    });
    const graph = buildReviewGraph({ state });
    expect(graph.changes.get('s1').sourceIds).toEqual({ wordIdInsert: 'wid-42' });
  });

  it('aggregates inserted and deleted sourceIds onto one replacement', () => {
    const sharedId = 'r1';
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [
        { text: 'old', marks: [deleteMark({ id: sharedId, sourceId: 'del-7' })] },
        { text: 'new', marks: [insertMark({ id: sharedId, sourceId: 'ins-9' })] },
      ],
    });
    const graph = buildReviewGraph({ state });
    expect(graph.changes.get(sharedId).sourceIds).toEqual({ wordIdDelete: 'del-7', wordIdInsert: 'ins-9' });
  });
});

describe('review-graph: invariants', () => {
  it('reports no diagnostics on a clean document', () => {
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [{ text: 'hi', marks: [insertMark({ id: 'ok1' })] }],
    });
    const graph = buildReviewGraph({ state });
    const result = runGraphInvariants(graph);
    expect(result.errors).toEqual([]);
    expect(graphHasErrors(graph)).toBe(false);
  });

  it('detects splitFromId === id as an error', () => {
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [{ text: 'x', marks: [insertMark({ id: 'bad', splitFromId: 'bad' })] }],
    });
    const graph = buildReviewGraph({ state });
    const errors = runGraphInvariants(graph).errors;
    expect(errors.some((d) => d.code === 'INV_SPLIT_FROM_SELF')).toBe(true);
    expect(graphHasErrors(graph)).toBe(true);
  });

  it('reports tracked marks without ids instead of dropping them before validation', () => {
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [{ text: 'x', marks: [{ markType: TrackInsertMarkName, attrs: { authorEmail: ALICE.email } }] }],
    });
    const graph = buildReviewGraph({ state });
    const errors = runGraphInvariants(graph).errors;
    expect(errors.some((d) => d.code === 'INV_MARK_MISSING_ID')).toBe(true);
    expect(graph.segments).toHaveLength(1);
  });

  it('warns when child references a missing parent', () => {
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [{ text: 'hi', marks: [insertMark({ id: 'orphan', overlapParentId: 'ghost' })] }],
    });
    const graph = buildReviewGraph({ state });
    const warnings = runGraphInvariants(graph).warnings;
    expect(warnings.some((d) => d.code === 'INV_CHILD_MISSING_PARENT')).toBe(true);
  });

  it('downgrades a one-sided "replacement" (side-reject survivor) to a plain insertion — no missing-side warning', () => {
    // Editor-created replacements persist changeType:"replacement" on each half.
    // After one side is resolved, the survivor still reports that type with one
    // empty side. The classifier downgrades it to the plain insertion it now is,
    // so it resolves normally (accept/reject) instead of being flagged as a
    // malformed one-sided replacement that the decision engine then rejects.
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [{ text: 'incomplete', marks: [insertMark({ id: 'r2', changeType: CanonicalChangeType.Replacement })] }],
    });
    const graph = buildReviewGraph({ state });
    const change = graph.changes.get('r2');
    expect(change.type, 'downgraded to insertion').toBe(CanonicalChangeType.Insertion);
    expect(change.replacement, 'no replacement projection').toBeNull();
    expect(change.insertedSegments).toHaveLength(1);
    expect(change.deletedSegments).toHaveLength(0);
    const warnings = runGraphInvariants(graph).warnings;
    expect(warnings.some((d) => d.code === 'INV_REPLACEMENT_MISSING_SIDE')).toBe(false);
  });
});

describe('review-graph: mixed legacy + overlap metadata', () => {
  it('builds correctly when one segment carries explicit metadata and another does not', () => {
    const sharedId = 'mixed';
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [
        // Legacy insertion, no overlap attrs.
        { text: 'aa', marks: [insertMark({ id: sharedId })] },
        // Same-id segment with explicit overlap metadata.
        {
          text: 'bb',
          marks: [
            insertMark({
              id: sharedId,
              revisionGroupId: sharedId,
              changeType: CanonicalChangeType.Insertion,
            }),
          ],
        },
      ],
    });
    const graph = buildReviewGraph({ state });
    const change = graph.changes.get(sharedId);
    // Mixed metadata should still produce one logical change.
    expect(change.type).toBe(CanonicalChangeType.Insertion);
    expect(change.segments.length).toBeGreaterThanOrEqual(1);
    // No revisionGroupId inconsistency: both segments resolve to sharedId.
    const warns = runGraphInvariants(graph).warnings.filter((d) => d.code === 'INV_REVISION_GROUP_INCONSISTENT');
    expect(warns).toEqual([]);
  });
});

describe('review-graph: attr normalization for adjacent merge', () => {
  it('merges adjacent identical attrs even when one omits default fields', () => {
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [
        { text: 'aa', marks: [insertMark({ id: 'n1', authorEmail: ALICE.email })] },
        {
          text: 'bb',
          marks: [
            insertMark({
              id: 'n1',
              authorEmail: ALICE.email,
              revisionGroupId: 'n1',
              splitFromId: '',
              changeType: CanonicalChangeType.Insertion,
            }),
          ],
        },
      ],
    });
    const graph = buildReviewGraph({ state });
    const change = graph.changes.get('n1');
    expect(change.segments).toHaveLength(1);
  });
});

describe('review-graph: story scope', () => {
  it('carries the story locator on every logical change', () => {
    const story = { kind: 'story', storyType: 'footnote', noteId: 'fn1' };
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [{ text: 'note', marks: [insertMark({ id: 's-fn1' })] }],
    });
    const graph = buildReviewGraph({ state, story });
    expect(graph.story).toBe(story);
    expect(graph.changes.get('s-fn1').story).toBe(story);
  });
});

describe('review-graph: caching', () => {
  it('returns the same graph instance for the same doc identity', () => {
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [{ text: 'x', marks: [insertMark({ id: 'c1' })] }],
    });
    const editor = { state };
    const a = getOrBuildReviewGraph({ editor, state });
    const b = getOrBuildReviewGraph({ editor, state });
    expect(a).toBe(b);
  });

  it('rebuilds after invalidate', () => {
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [{ text: 'x', marks: [insertMark({ id: 'c1' })] }],
    });
    const editor = { state };
    const a = getOrBuildReviewGraph({ editor, state });
    invalidateReviewGraphCache(editor);
    const b = getOrBuildReviewGraph({ editor, state });
    expect(a).not.toBe(b);
  });
});

describe('review-graph: signature', () => {
  it('produces deterministic JSON across rebuilds', () => {
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [{ text: 'x', marks: [insertMark({ id: 'sig1' })] }],
    });
    const g1 = buildReviewGraph({ state });
    const g2 = buildReviewGraph({ state });
    expect(signatureOf(g1.changes.get('sig1'))).toBe(signatureOf(g2.changes.get('sig1')));
  });
});

describe('review-graph: range and overlap queries', () => {
  it('overlapAt finds segments covering a position', () => {
    const { state, paragraphStart } = stateFromTrackedSpans({
      schema,
      spans: [
        { text: 'hello ', marks: [] },
        { text: 'world', marks: [insertMark({ id: 'q1' })] },
      ],
    });
    // 'world' starts at paragraphStart + 'hello '.length = 1 + 6 = 7.
    const graph = buildReviewGraph({ state });
    const at = graph.overlapAt(paragraphStart + 7);
    expect(at).toHaveLength(1);
    expect(at[0].changeId).toBe('q1');
  });
  it('segmentsInRange returns intersecting segments', () => {
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [
        { text: 'hello ', marks: [] },
        { text: 'world', marks: [insertMark({ id: 'q2' })] },
      ],
    });
    const graph = buildReviewGraph({ state });
    expect(graph.segmentsInRange(0, 100).length).toBe(1);
    expect(graph.segmentsInRange(0, 1).length).toBe(0);
  });
});

describe('review-graph: tracked inline serialization (SD-3376)', () => {
  it('emits a literal tab in segment text and excerpt for a tracked tab', () => {
    const mark = (attrs) => schema.marks[TrackInsertMarkName].create(markAttrs(attrs));
    const insertAttrs = { id: 't1', author: ALICE.name, authorEmail: ALICE.email, date: '2026-01-01' };
    const tab = schema.nodes.tab.create({}, null, [mark(insertAttrs)]);
    const paragraph = schema.nodes.paragraph.create({}, [
      schema.text('A', [mark(insertAttrs)]),
      tab,
      schema.text('B', [mark(insertAttrs)]),
    ]);
    const doc = schema.nodes.doc.create({}, [paragraph]);
    const state = EditorState.create({ schema, doc });

    const graph = buildReviewGraph({ state });
    const change = graph.changes.get('t1');
    expect(change.type).toBe(CanonicalChangeType.Insertion);
    const text = change.insertedSegments.map((seg) => seg.text).join('');
    expect(text).toBe('A\tB');
    expect(change.excerpt).toBe('A\tB');
  });

  it('emits leafText in segment text and excerpt for a tracked noBreakHyphen', () => {
    const mark = (attrs) => schema.marks[TrackInsertMarkName].create(markAttrs(attrs));
    const insertAttrs = { id: 'h1', author: ALICE.name, authorEmail: ALICE.email, date: '2026-01-01' };
    const noBreakHyphen = schema.nodes.noBreakHyphen.create({}, null, [mark(insertAttrs)]);
    const paragraph = schema.nodes.paragraph.create({}, [
      schema.text('A', [mark(insertAttrs)]),
      noBreakHyphen,
      schema.text('B', [mark(insertAttrs)]),
    ]);
    const doc = schema.nodes.doc.create({}, [paragraph]);
    const state = EditorState.create({ schema, doc });

    const graph = buildReviewGraph({ state });
    const change = graph.changes.get('h1');
    expect(change.type).toBe(CanonicalChangeType.Insertion);
    const text = change.insertedSegments.map((seg) => seg.text).join('');
    expect(text).toBe('A\u2011B');
    expect(change.excerpt).toBe('A\u2011B');
  });

  it('keeps the fallback placeholder for tracked inline leaves without leafText', () => {
    const mark = (attrs) => schema.marks[TrackInsertMarkName].create(markAttrs(attrs));
    const insertAttrs = { id: 'g1', author: ALICE.name, authorEmail: ALICE.email, date: '2026-01-01' };
    const genericLeaf = schema.nodes.genericLeaf.create({}, null, [mark(insertAttrs)]);
    const paragraph = schema.nodes.paragraph.create({}, [
      schema.text('A', [mark(insertAttrs)]),
      genericLeaf,
      schema.text('B', [mark(insertAttrs)]),
    ]);
    const doc = schema.nodes.doc.create({}, [paragraph]);
    const state = EditorState.create({ schema, doc });

    const graph = buildReviewGraph({ state });
    const change = graph.changes.get('g1');
    expect(change.type).toBe(CanonicalChangeType.Insertion);
    const text = change.insertedSegments.map((seg) => seg.text).join('');
    expect(text).toBe('A\uFFFcB');
    expect(change.excerpt).toBe('A\uFFFcB');
  });
});
