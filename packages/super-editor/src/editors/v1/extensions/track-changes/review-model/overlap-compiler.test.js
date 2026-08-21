// @ts-check
import { describe, expect, it } from 'vitest';
import { Slice, Fragment } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { TrackInsertMarkName, TrackDeleteMarkName, TrackFormatMarkName } from '../constants.js';
import { compileTrackedEdit } from './overlap-compiler.js';
import {
  makeTextInsertIntent,
  makeTextDeleteIntent,
  makeTextReplaceIntent,
  makeFormatIntent,
  sliceFromText,
} from './edit-intent.js';
import { createReviewGraphTestSchema, markAttrs, stateFromTrackedSpans } from './test-fixtures.js';
import { buildReviewGraph, CanonicalChangeType, SegmentSide } from './review-graph.js';

// The review-graph test schema does not carry bold/italic/etc. mark types.
// For format tests we extend the standard fixture schema with a `bold` mark.
import { Schema } from 'prosemirror-model';

const ALICE = { name: 'Alice', email: 'alice@example.com' };
const BOB = { name: 'Bob', email: 'bob@example.com' };
const NO_EMAIL = { name: 'Anon', email: '' };
const SAME_EMAIL_ALICE = { id: 'alice-id', name: 'Alice', email: 'shared@example.com' };
const SAME_EMAIL_BOB = { id: 'bob-id', name: 'Bob', email: 'shared@example.com' };

const FIXED_DATE = '2026-05-21T00:00:00.000Z';

const schema = createReviewGraphTestSchema();
const createReviewGraphRunTestSchema = () => {
  const baseSchema = createReviewGraphTestSchema();
  return new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: {
        content: 'inline*',
        group: 'block',
        parseDOM: [{ tag: 'p' }],
        toDOM: () => ['p', 0],
      },
      run: {
        content: 'text*',
        group: 'inline',
        inline: true,
        selectable: false,
        parseDOM: [{ tag: 'span[data-run]' }],
        toDOM: () => ['span', { 'data-run': '1' }, 0],
      },
      text: { group: 'inline' },
    },
    marks: baseSchema.spec.marks.toObject(),
  });
};

const insertMark = (attrs) => ({ markType: TrackInsertMarkName, attrs: markAttrs(attrs) });
const deleteMark = (attrs) => ({ markType: TrackDeleteMarkName, attrs: markAttrs(attrs) });

const runCompile = ({ state, intent, replacements = 'paired' }) =>
  compileTrackedEdit({
    state,
    tr: state.tr,
    intent,
    replacements,
  });

const textOf = (tr) => tr.doc.textContent;

describe('overlap-compiler: text-insert fresh content', () => {
  it('marks live-content insertion with a new logical id', () => {
    const { state } = stateFromTrackedSpans({ schema, spans: [{ text: 'hello' }] });
    const intent = makeTextInsertIntent({
      at: 3,
      content: sliceFromText(schema, 'X'),
      user: ALICE,
      date: FIXED_DATE,
      source: 'native',
    });
    const result = runCompile({ state, intent });
    expect(result.ok).toBe(true);
    expect(textOf(result.tr)).toBe('heXllo');
    const graph = buildReviewGraph({ state: { doc: result.tr.doc } });
    expect(graph.changes.size).toBe(1);
    const change = Array.from(graph.changes.values())[0];
    expect(change.type).toBe(CanonicalChangeType.Insertion);
    expect(change.authorEmail).toBe(ALICE.email);
    expect(result.createdChangeIds).toHaveLength(1);
  });

  it('honors a provided logical id hint for document-api inserts', () => {
    const providedId = 'api-insert-1';
    const { state } = stateFromTrackedSpans({ schema, spans: [{ text: 'hello' }] });
    const intent = makeTextInsertIntent({
      at: 3,
      content: sliceFromText(schema, 'X'),
      user: ALICE,
      date: FIXED_DATE,
      source: 'document-api',
      replacementGroupHint: providedId,
    });
    const result = runCompile({ state, intent });
    expect(result.ok).toBe(true);
    const graph = buildReviewGraph({ state: { doc: result.tr.doc } });
    expect(graph.changes.get(providedId)).toBeDefined();
    expect(result.createdChangeIds).toEqual([providedId]);
  });
});

describe('overlap-compiler: same-user own-insertion refinement (SD-486-adjacent / refinement matrix row)', () => {
  it('extends the same logical id when inserting inside own insertion', () => {
    const id = 'ins-alice';
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [
        { text: 'Hi ' },
        {
          text: 'world',
          marks: [
            insertMark({
              id,
              author: ALICE.name,
              authorEmail: ALICE.email,
              date: FIXED_DATE,
              changeType: CanonicalChangeType.Insertion,
            }),
          ],
        },
      ],
    });
    // Insert "great " at position 5 — inside "world" (after "wo").
    const intent = makeTextInsertIntent({
      at: 6,
      content: sliceFromText(schema, 'great '),
      user: ALICE,
      date: FIXED_DATE,
      source: 'native',
    });
    const result = runCompile({ state, intent });
    expect(result.ok).toBe(true);
    expect(textOf(result.tr)).toBe('Hi wogreat rld');
    const graph = buildReviewGraph({ state: { doc: result.tr.doc } });
    // Still one logical change with one id — id of the existing insertion.
    expect(graph.changes.size).toBe(1);
    expect(graph.changes.get(id)).toBeDefined();
    expect(result.updatedChangeIds).toContain(id);
  });

  it('refines own insertion when caret sits at the right edge', () => {
    const id = 'ins-alice';
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [
        { text: 'Hi ' },
        { text: 'world', marks: [insertMark({ id, authorEmail: ALICE.email, date: FIXED_DATE })] },
      ],
    });
    // Right edge of "world" is position 9. Insert "!" → refine same id.
    const intent = makeTextInsertIntent({
      at: 9,
      content: sliceFromText(schema, '!'),
      user: ALICE,
      date: FIXED_DATE,
      source: 'native',
    });
    const result = runCompile({ state, intent });
    expect(result.ok).toBe(true);
    expect(textOf(result.tr)).toBe('Hi world!');
    const graph = buildReviewGraph({ state: { doc: result.tr.doc } });
    expect(graph.changes.size).toBe(1);
    expect(graph.changes.get(id)).toBeDefined();
  });

  it('refines own insertion across an empty run-wrapper position gap', () => {
    const runSchema = createReviewGraphRunTestSchema();
    const id = 'ins-alice';
    const mark = runSchema.marks[TrackInsertMarkName].create(
      markAttrs({ id, authorEmail: ALICE.email, date: FIXED_DATE }),
    );
    const run = runSchema.nodes.run.create({}, [runSchema.text('a', [mark])]);
    const doc = runSchema.nodes.doc.create({}, [runSchema.nodes.paragraph.create({}, [run])]);
    const state = EditorState.create({ schema: runSchema, doc });

    let trackedTextEnd = null;
    let runEnd = null;
    doc.descendants((node, pos) => {
      if (node.isText && node.text === 'a') trackedTextEnd = pos + node.nodeSize;
      if (node.type.name === 'run') runEnd = pos + node.nodeSize;
    });
    expect(runEnd).toBeGreaterThan(trackedTextEnd);

    const intent = makeTextInsertIntent({
      at: runEnd,
      content: sliceFromText(runSchema, 'b'),
      user: ALICE,
      date: FIXED_DATE,
      source: 'native',
    });
    const result = runCompile({ state, intent });
    expect(result.ok).toBe(true);
    expect(result.createdChangeIds).toHaveLength(0);
    expect(result.updatedChangeIds).toContain(id);

    const graph = buildReviewGraph({ state: { doc: result.tr.doc } });
    expect(graph.changes.size).toBe(1);
    expect(
      graph.changes
        .get(id)
        ?.insertedSegments.map((segment) => segment.text)
        .join(''),
    ).toBe('ab');
  });

  it('does not refine own insertion across live text', () => {
    const runSchema = createReviewGraphRunTestSchema();
    const id = 'ins-alice';
    const mark = runSchema.marks[TrackInsertMarkName].create(
      markAttrs({ id, authorEmail: ALICE.email, date: FIXED_DATE }),
    );
    const run = runSchema.nodes.run.create({}, [runSchema.text('a', [mark])]);
    const liveText = runSchema.text('x');
    const doc = runSchema.nodes.doc.create({}, [runSchema.nodes.paragraph.create({}, [run, liveText])]);
    const state = EditorState.create({ schema: runSchema, doc });

    let liveTextEnd = null;
    doc.descendants((node, pos) => {
      if (node.isText && node.text === 'x') liveTextEnd = pos + node.nodeSize;
    });

    const intent = makeTextInsertIntent({
      at: liveTextEnd,
      content: sliceFromText(runSchema, 'b'),
      user: ALICE,
      date: FIXED_DATE,
      source: 'native',
    });
    const result = runCompile({ state, intent });
    expect(result.ok).toBe(true);
    expect(result.createdChangeIds).toHaveLength(1);
    expect(result.updatedChangeIds).not.toContain(id);

    const graph = buildReviewGraph({ state: { doc: result.tr.doc } });
    expect(graph.changes.size).toBe(2);
  });

  it('replaces inside own insertion while preserving the existing insertion id', () => {
    const id = 'ins-alice';
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [
        { text: 'Hi ' },
        { text: 'world', marks: [insertMark({ id, authorEmail: ALICE.email, date: FIXED_DATE })] },
      ],
    });
    const intent = makeTextReplaceIntent({
      from: 5,
      to: 7,
      content: sliceFromText(schema, 'AR'),
      replacements: 'paired',
      user: ALICE,
      date: FIXED_DATE,
      source: 'native',
    });
    const result = runCompile({ state, intent });
    expect(result.ok).toBe(true);
    expect(textOf(result.tr)).toBe('Hi wARld');
    const graph = buildReviewGraph({ state: { doc: result.tr.doc } });
    expect(graph.changes.size).toBe(1);
    const change = graph.changes.get(id);
    expect(change).toBeDefined();
    expect(change.type).toBe(CanonicalChangeType.Insertion);
    expect(result.updatedChangeIds).toContain(id);
  });

  it('refines own anonymous-default-user insertion when replacing inside it (SD-3352)', () => {
    // Replace-path counterpart of the SD-3352 delete tests: an anonymous
    // session selecting text inside its own pending insertion and typing must
    // refine that insertion in place — one logical change with the same id —
    // not collapse the delete half while nesting the replacement text as a
    // different-user child insertion under the user's own suggestion.
    const parentId = 'ins-default-user';
    const anonDefaultUser = { name: 'Default SuperDoc user', email: '' };
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [
        {
          text: 'ABCHELLOXYZ',
          marks: [
            insertMark({ id: parentId, author: anonDefaultUser.name, authorEmail: '', sourceId: '', date: FIXED_DATE }),
          ],
        },
      ],
    });
    // Replace "HELLO" at [4, 9) — wholly inside the pending insertion.
    const intent = makeTextReplaceIntent({
      from: 4,
      to: 9,
      content: sliceFromText(schema, 'Q'),
      replacements: 'paired',
      user: anonDefaultUser,
      date: FIXED_DATE,
      source: 'native',
    });
    const result = runCompile({ state, intent });
    expect(result.ok).toBe(true);
    expect(textOf(result.tr)).toBe('ABCQXYZ');

    const graph = buildReviewGraph({ state: { doc: result.tr.doc } });
    expect(graph.changes.size).toBe(1);
    const parent = graph.changes.get(parentId);
    expect(parent).toBeDefined();
    expect(parent.type).toBe(CanonicalChangeType.Insertion);
    expect(parent.insertedSegments.map((segment) => segment.text).join('')).toBe('ABCQXYZ');
    expect(parent.insertedSegments.every((segment) => !segment.attrs.overlapParentId)).toBe(true);
    expect(result.updatedChangeIds).toContain(parentId);
  });

  it('replacement spanning own anonymous insertion and live text pairs like an identified user (SD-3352)', () => {
    // Partial overlap goes through getReplacementParentId rather than the
    // fully-covering refinement path. The user's own (by the permissive
    // anonymous gate) insertion must not be classified as a different-user
    // overlap parent: the result is an ordinary paired replacement — the
    // covered insertion slice collapses, the live slice gets the paired
    // deletion — exactly what an identified user gets.
    const parentId = 'ins-default-user';
    const anonDefaultUser = { name: 'Default SuperDoc user', email: '' };
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [
        {
          text: 'NEW',
          marks: [
            insertMark({ id: parentId, author: anonDefaultUser.name, authorEmail: '', sourceId: '', date: FIXED_DATE }),
          ],
        },
        { text: 'live' },
      ],
    });
    // Replace "EWli" at [2, 6): spans the insertion tail and live text head.
    const intent = makeTextReplaceIntent({
      from: 2,
      to: 6,
      content: sliceFromText(schema, 'Q'),
      replacements: 'paired',
      user: anonDefaultUser,
      date: FIXED_DATE,
      source: 'native',
    });
    const result = runCompile({ state, intent });
    expect(result.ok).toBe(true);

    const graph = buildReviewGraph({ state: { doc: result.tr.doc } });
    // Two logical changes: the refined parent insertion ("N") and one paired
    // replacement ("li" -> "Q"). No change is nested under the parent.
    expect(graph.changes.size).toBe(2);
    const parent = graph.changes.get(parentId);
    expect(parent).toBeDefined();
    expect(parent.type).toBe(CanonicalChangeType.Insertion);
    expect(parent.insertedSegments.map((segment) => segment.text).join('')).toBe('N');

    const replacement = Array.from(graph.changes.values()).find((change) => change.id !== parentId);
    expect(replacement).toBeDefined();
    expect(replacement.type).toBe(CanonicalChangeType.Replacement);
    expect(replacement.deletedSegments.map((segment) => segment.text).join('')).toBe('li');
    expect(replacement.insertedSegments.map((segment) => segment.text).join('')).toBe('Q');
    expect(replacement.insertedSegments.every((segment) => !segment.attrs.overlapParentId)).toBe(true);
    expect(replacement.deletedSegments.every((segment) => !segment.attrs.overlapParentId)).toBe(true);
  });
});

describe('overlap-compiler: keystroke deletion coalescing excludes structured changes (PR #3610)', () => {
  it('a plain deletion adjacent to a same-user replacement does NOT fold into the replacement id', () => {
    // "ab": replace "b" -> "X" (paired), then Backspace-delete the adjacent
    // live "a". The deletion must be its own logical change, not merged into
    // the replacement's id (which would corrupt the replacement's accept/reject).
    const { state } = stateFromTrackedSpans({ schema, spans: [{ text: 'ab' }] });

    const afterReplace = runCompile({
      state,
      intent: makeTextReplaceIntent({
        from: 2,
        to: 3,
        content: sliceFromText(schema, 'X'),
        replacements: 'paired',
        user: ALICE,
        date: FIXED_DATE,
        source: 'native',
      }),
    });
    expect(afterReplace.ok).toBe(true);

    const afterDelete = runCompile({
      state: state.apply(afterReplace.tr),
      intent: makeTextDeleteIntent({ from: 1, to: 2, user: ALICE, date: FIXED_DATE, source: 'native' }),
    });
    expect(afterDelete.ok).toBe(true);

    const graph = buildReviewGraph({ state: { doc: afterDelete.tr.doc } });
    const changes = Array.from(graph.changes.values());
    // Two distinct logical changes: the replacement and the standalone deletion.
    // The pre-fix coalescing folded the deletion into the replacement id (size 1).
    expect(graph.changes.size).toBe(2);
    expect(changes.some((c) => c.type === CanonicalChangeType.Replacement)).toBe(true);
    expect(changes.some((c) => c.type === CanonicalChangeType.Deletion)).toBe(true);
  });
});

describe('overlap-compiler: different-user child insertion inside other-user insertion', () => {
  it('mints a child id with overlapParentId set to the parent insertion id', () => {
    const parentId = 'ins-bob';
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [
        { text: 'Hi ' },
        { text: 'world', marks: [insertMark({ id: parentId, authorEmail: BOB.email, date: FIXED_DATE })] },
      ],
    });
    // Alice inserts "X" at position 6 inside Bob's insertion.
    const intent = makeTextInsertIntent({
      at: 6,
      content: sliceFromText(schema, 'X'),
      user: ALICE,
      date: FIXED_DATE,
      source: 'native',
    });
    const result = runCompile({ state, intent });
    expect(result.ok).toBe(true);
    expect(textOf(result.tr)).toBe('Hi woXrld');
    const graph = buildReviewGraph({ state: { doc: result.tr.doc } });
    // Two logical changes now: parent and child.
    expect(graph.changes.size).toBe(2);
    const childChange = Array.from(graph.changes.values()).find((c) => c.id !== parentId);
    expect(childChange).toBeDefined();
    expect(childChange.insertedSegments[0].attrs.overlapParentId).toBe(parentId);
    expect(childChange.authorEmail).toBe(ALICE.email);
  });

  it('continues the same child change across contiguous typing inside the parent insertion', () => {
    const parentId = 'ins-bob';
    const { state: initialState } = stateFromTrackedSpans({
      schema,
      spans: [
        { text: 'Hi ' },
        { text: 'world', marks: [insertMark({ id: parentId, authorEmail: BOB.email, date: FIXED_DATE })] },
      ],
    });

    const first = runCompile({
      state: initialState,
      intent: makeTextInsertIntent({
        at: 6,
        content: sliceFromText(schema, 'X'),
        user: ALICE,
        date: FIXED_DATE,
        source: 'native',
      }),
    });
    expect(first.ok).toBe(true);
    const childId = first.createdChangeIds[0];

    const secondState = EditorState.create({ schema, doc: first.tr.doc });
    const second = runCompile({
      state: secondState,
      intent: makeTextInsertIntent({
        at: first.selection.pos,
        content: sliceFromText(schema, 'Y'),
        user: ALICE,
        date: FIXED_DATE,
        source: 'native',
      }),
    });
    expect(second.ok).toBe(true);

    const thirdState = EditorState.create({ schema, doc: second.tr.doc });
    const third = runCompile({
      state: thirdState,
      intent: makeTextInsertIntent({
        at: second.selection.pos,
        content: sliceFromText(schema, 'Z'),
        user: ALICE,
        date: FIXED_DATE,
        source: 'native',
      }),
    });
    expect(third.ok).toBe(true);
    expect(textOf(third.tr)).toBe('Hi woXYZrld');

    expect(second.createdChangeIds).toEqual([]);
    expect(second.updatedChangeIds).toEqual([childId]);
    expect(third.createdChangeIds).toEqual([]);
    expect(third.updatedChangeIds).toEqual([childId]);

    const graph = buildReviewGraph({ state: { doc: third.tr.doc } });
    expect(graph.changes.size).toBe(2);
    const childChange = Array.from(graph.changes.values()).find((change) => change.id === childId);
    expect(childChange).toBeDefined();
    expect(childChange.authorEmail).toBe(ALICE.email);
    expect(childChange.insertedSegments[0].attrs.overlapParentId).toBe(parentId);
    expect(childChange.insertedSegments.map((segment) => segment.text).join('')).toBe('XYZ');
  });
});

describe('overlap-compiler: text-insert at exact location inside other-user deletion (SD-3210)', () => {
  it('places child insertion at the cursor offset, not at end of deletion span', () => {
    const parentId = 'del-bob';
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [
        { text: 'Hi ' },
        { text: 'gone', marks: [deleteMark({ id: parentId, authorEmail: BOB.email, date: FIXED_DATE })] },
        { text: ' rest' },
      ],
    });
    // Alice's cursor lands at position 5 (between "g" and "o").
    const intent = makeTextInsertIntent({
      at: 5,
      content: sliceFromText(schema, 'INS'),
      user: ALICE,
      date: FIXED_DATE,
      source: 'native',
    });
    const result = runCompile({ state, intent });
    expect(result.ok).toBe(true);
    // Inserted exactly between the original "g" and "o" of the deleted run.
    expect(textOf(result.tr)).toBe('Hi gINSone rest');
    const graph = buildReviewGraph({ state: { doc: result.tr.doc } });
    const insertion = Array.from(graph.changes.values()).find((c) => c.type === CanonicalChangeType.Insertion);
    expect(insertion).toBeDefined();
    expect(insertion.insertedSegments[0].attrs.overlapParentId).toBe(parentId);
  });
});

describe('overlap-compiler: text-replace inside own deletion (SD-2335)', () => {
  it('preserves the original deletion and creates insertion at the edit point', () => {
    const delId = 'del-alice';
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [
        { text: 'pre ' },
        { text: 'old', marks: [deleteMark({ id: delId, authorEmail: ALICE.email, date: FIXED_DATE })] },
        { text: ' post' },
      ],
    });
    // Alice "types" "new" while her selection covers her own deletion of "old".
    const intent = makeTextReplaceIntent({
      from: 5,
      to: 8,
      content: sliceFromText(schema, 'new'),
      replacements: 'paired',
      user: ALICE,
      date: FIXED_DATE,
      source: 'native',
    });
    const result = runCompile({ state, intent });
    expect(result.ok).toBe(true);
    // Insertion appears at the edit point; original deletion preserved.
    expect(textOf(result.tr)).toBe('pre newold post');
    const graph = buildReviewGraph({ state: { doc: result.tr.doc } });
    // One deletion (preserved) plus one new insertion = two logical changes.
    expect(graph.changes.size).toBe(2);
    const insertion = Array.from(graph.changes.values()).find((c) => c.type === CanonicalChangeType.Insertion);
    const deletion = Array.from(graph.changes.values()).find((c) => c.type === CanonicalChangeType.Deletion);
    expect(insertion).toBeDefined();
    expect(deletion).toBeDefined();
    expect(deletion.id).toBe(delId);
  });
});

describe('overlap-compiler: text-delete', () => {
  it('marks live text as tracked deletion', () => {
    const { state } = stateFromTrackedSpans({ schema, spans: [{ text: 'hello world' }] });
    const intent = makeTextDeleteIntent({ from: 7, to: 12, user: ALICE, date: FIXED_DATE, source: 'native' });
    const result = runCompile({ state, intent });
    expect(result.ok).toBe(true);
    expect(textOf(result.tr)).toBe('hello world');
    const graph = buildReviewGraph({ state: { doc: result.tr.doc } });
    expect(graph.changes.size).toBe(1);
    const change = Array.from(graph.changes.values())[0];
    expect(change.type).toBe(CanonicalChangeType.Deletion);
  });

  it('honors a provided logical id hint for document-api deletions', () => {
    const providedId = 'api-delete-1';
    const { state } = stateFromTrackedSpans({ schema, spans: [{ text: 'hello world' }] });
    const intent = makeTextDeleteIntent({
      from: 7,
      to: 12,
      user: ALICE,
      date: FIXED_DATE,
      source: 'document-api',
      replacementGroupHint: providedId,
    });
    const result = runCompile({ state, intent });
    expect(result.ok).toBe(true);
    const graph = buildReviewGraph({ state: { doc: result.tr.doc } });
    expect(graph.changes.get(providedId)).toBeDefined();
    expect(result.createdChangeIds).toEqual([providedId]);
  });

  it('collapses own insertion when deleting it', () => {
    const id = 'ins-alice';
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [
        { text: 'Hi ' },
        { text: 'new', marks: [insertMark({ id, authorEmail: ALICE.email, date: FIXED_DATE })] },
        { text: ' world' },
      ],
    });
    // Alice deletes her own insertion "new" at [4, 7].
    const intent = makeTextDeleteIntent({ from: 4, to: 7, user: ALICE, date: FIXED_DATE, source: 'native' });
    const result = runCompile({ state, intent });
    expect(result.ok).toBe(true);
    expect(textOf(result.tr)).toBe('Hi  world');
    const graph = buildReviewGraph({ state: { doc: result.tr.doc } });
    expect(graph.changes.size).toBe(0);
    expect(result.removedChangeIds).toEqual([id]);
  });

  it('creates child deletion inside other-user insertion', () => {
    const parentId = 'ins-bob';
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [
        { text: 'Hi ' },
        { text: 'world', marks: [insertMark({ id: parentId, authorEmail: BOB.email, date: FIXED_DATE })] },
      ],
    });
    // Alice deletes "or" inside Bob's insertion.
    const intent = makeTextDeleteIntent({ from: 5, to: 7, user: ALICE, date: FIXED_DATE, source: 'native' });
    const result = runCompile({ state, intent });
    expect(result.ok).toBe(true);
    expect(textOf(result.tr)).toBe('Hi world');
    const graph = buildReviewGraph({ state: { doc: result.tr.doc } });
    const aliceChange = Array.from(graph.changes.values()).find((c) => c.authorEmail === ALICE.email);
    expect(aliceChange).toBeDefined();
    expect(aliceChange.type).toBe(CanonicalChangeType.Deletion);
    expect(aliceChange.deletedSegments[0].attrs.overlapParentId).toBe(parentId);
  });

  it('treats same-email different-id collaborators as different users', () => {
    const parentId = 'ins-shared';
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [
        { text: 'Hi ' },
        {
          text: 'world',
          marks: [
            insertMark({
              id: parentId,
              author: SAME_EMAIL_ALICE.name,
              authorId: SAME_EMAIL_ALICE.id,
              authorEmail: SAME_EMAIL_ALICE.email,
              date: FIXED_DATE,
            }),
          ],
        },
      ],
    });

    const intent = makeTextDeleteIntent({
      from: 5,
      to: 7,
      user: SAME_EMAIL_BOB,
      date: FIXED_DATE,
      source: 'native',
    });
    const result = runCompile({ state, intent });

    expect(result.ok).toBe(true);
    expect(textOf(result.tr)).toBe('Hi world');
    const graph = buildReviewGraph({ state: { doc: result.tr.doc } });
    const bobChange = Array.from(graph.changes.values()).find((c) => c.authorId === SAME_EMAIL_BOB.id);
    expect(bobChange).toBeDefined();
    expect(bobChange.type).toBe(CanonicalChangeType.Deletion);
    expect(bobChange.deletedSegments[0].attrs.overlapParentId).toBe(parentId);
  });

  it('protects named no-email insertion as different-user state when deleting inside it', () => {
    const parentId = 'ins-alice-no-email';
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [
        {
          text: 'lazy ',
          marks: [
            insertMark({
              id: parentId,
              author: '',
              importedAuthor: 'Alice Reviewer (imported)',
              authorEmail: '',
              date: FIXED_DATE,
            }),
          ],
        },
      ],
    });
    const intent = makeTextDeleteIntent({
      from: 1,
      to: 5,
      user: { name: 'CLI', email: '' },
      date: FIXED_DATE,
      source: 'document-api',
    });
    const result = runCompile({ state, intent });
    expect(result.ok).toBe(true);
    expect(textOf(result.tr)).toBe('lazy ');

    const graph = buildReviewGraph({ state: { doc: result.tr.doc } });
    expect(graph.changes.size).toBe(2);
    const parent = graph.changes.get(parentId);
    expect(parent).toBeDefined();
    expect(parent.type).toBe(CanonicalChangeType.Insertion);
    const child = Array.from(graph.changes.values()).find((change) => change.id !== parentId);
    expect(child).toBeDefined();
    expect(child.type).toBe(CanonicalChangeType.Deletion);
    expect(child.deletedSegments[0].text).toBe('lazy');
    expect(child.deletedSegments[0].attrs.overlapParentId).toBe(parentId);
  });

  it('collapses truly unattributed no-email insertion when deleting it', () => {
    const parentId = 'ins-unattributed';
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [
        {
          text: 'draft',
          marks: [insertMark({ id: parentId, author: '', authorEmail: '', sourceId: '1', date: FIXED_DATE })],
        },
      ],
    });
    const intent = makeTextDeleteIntent({ from: 1, to: 6, user: BOB, date: FIXED_DATE, source: 'document-api' });
    const result = runCompile({ state, intent });
    expect(result.ok).toBe(true);
    expect(textOf(result.tr)).toBe('');
    const graph = buildReviewGraph({ state: { doc: result.tr.doc } });
    expect(graph.changes.size).toBe(0);
    expect(result.removedChangeIds).toEqual([parentId]);
  });

  it('refines own anonymous-default-user insertion when deleting inside it (SD-3352)', () => {
    // Integrators that pass no `user` run as the anonymous default identity
    // (display name only, no id/email). Deleting inside your own pending
    // insertion in the same session must refine the insertion in place — not
    // mint an overlapping different-user child deletion. Word overlap case
    // 11_same_insert_delete_inside_control is the oracle: one refined w:ins.
    const parentId = 'ins-default-user';
    const anonDefaultUser = { name: 'Default SuperDoc user', email: '' };
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [
        {
          text: 'ABCHELLOXYZ',
          marks: [
            insertMark({ id: parentId, author: anonDefaultUser.name, authorEmail: '', sourceId: '', date: FIXED_DATE }),
          ],
        },
      ],
    });
    // Delete "HELLO" at [4, 9) — wholly inside the pending insertion.
    const intent = makeTextDeleteIntent({
      from: 4,
      to: 9,
      user: anonDefaultUser,
      date: FIXED_DATE,
      source: 'native',
    });
    const result = runCompile({ state, intent });
    expect(result.ok).toBe(true);
    expect(textOf(result.tr)).toBe('ABCXYZ');

    const graph = buildReviewGraph({ state: { doc: result.tr.doc } });
    expect(graph.changes.size).toBe(1);
    const parent = graph.changes.get(parentId);
    expect(parent).toBeDefined();
    expect(parent.type).toBe(CanonicalChangeType.Insertion);
    expect(parent.insertedSegments.map((segment) => segment.text).join('')).toBe('ABCXYZ');
    expect(result.updatedChangeIds).toContain(parentId);
    expect(result.deletionMarks).toHaveLength(0);
  });

  it('collapses inside a live unattributed insertion when the current user is equally anonymous (SD-3352 gate unification)', () => {
    // Same permissive rule as typing (matchesSameUserRefinement): a truly
    // unattributed live insertion deleted by an equally anonymous session
    // refines in place. Before SD-3352 this minted a different-user child
    // deletion while typing into the very same insertion coalesced — the
    // delete path simply used the stricter gate. Named no-email authors stay
    // protected (see the named no-email test above).
    const parentId = 'ins-live-anonymous';
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [
        {
          text: 'live-review-comment',
          marks: [insertMark({ id: parentId, author: '', authorEmail: '', sourceId: '', date: FIXED_DATE })],
        },
      ],
    });
    const intent = makeTextDeleteIntent({
      from: 6,
      to: 12,
      user: { name: '', email: '' },
      date: FIXED_DATE,
      source: 'document-api',
    });
    const result = runCompile({ state, intent });
    expect(result.ok).toBe(true);
    expect(textOf(result.tr)).toBe('live--comment');

    const graph = buildReviewGraph({ state: { doc: result.tr.doc } });
    expect(graph.changes.size).toBe(1);
    const parent = graph.changes.get(parentId);
    expect(parent).toBeDefined();
    expect(parent.type).toBe(CanonicalChangeType.Insertion);
    expect(parent.insertedSegments.map((segment) => segment.text).join('')).toBe('live--comment');
    expect(result.updatedChangeIds).toContain(parentId);
  });

  it('no-ops when deleting inside own deletion', () => {
    const delId = 'del-alice';
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [
        { text: 'Hi ' },
        { text: 'gone', marks: [deleteMark({ id: delId, authorEmail: ALICE.email, date: FIXED_DATE })] },
      ],
    });
    const intent = makeTextDeleteIntent({ from: 4, to: 6, user: ALICE, date: FIXED_DATE, source: 'native' });
    const result = runCompile({ state, intent });
    expect(result.ok).toBe(true);
    const graph = buildReviewGraph({ state: { doc: result.tr.doc } });
    // Only the original deletion remains.
    expect(graph.changes.size).toBe(1);
    expect(Array.from(graph.changes.values())[0].id).toBe(delId);
  });

  it('preserves another user deletion when plain-deleting through it', () => {
    const delId = 'del-bob';
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [
        { text: 'Hi ' },
        { text: 'gone', marks: [deleteMark({ id: delId, authorEmail: BOB.email, date: FIXED_DATE })] },
        { text: ' live' },
      ],
    });
    const intent = makeTextDeleteIntent({ from: 4, to: 10, user: ALICE, date: FIXED_DATE, source: 'native' });
    const result = runCompile({ state, intent });
    expect(result.ok).toBe(true);

    const graph = buildReviewGraph({ state: { doc: result.tr.doc } });
    const deletedChanges = Array.from(graph.changes.values()).filter(
      (change) => change.type === CanonicalChangeType.Deletion,
    );
    expect(deletedChanges.map((change) => change.id).sort()).toEqual([delId, result.deletionMarks[0].attrs.id].sort());
    expect(
      graph.changes
        .get(delId)
        ?.deletedSegments.map((segment) => segment.text)
        .join(''),
    ).toBe('gone');
  });
});

describe('overlap-compiler: text-replace inside named no-email insertion', () => {
  it('preserves parent insertion and creates child insertion/deletion sides', () => {
    const parentId = 'ins-alice-no-email';
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [
        {
          text: 'lazy ',
          marks: [
            insertMark({
              id: parentId,
              author: '',
              importedAuthor: 'Alice Reviewer (imported)',
              authorEmail: '',
              date: FIXED_DATE,
            }),
          ],
        },
      ],
    });
    const intent = makeTextReplaceIntent({
      from: 1,
      to: 5,
      content: sliceFromText(schema, 'quickly'),
      replacements: 'paired',
      user: { name: 'CLI', email: '' },
      date: FIXED_DATE,
      source: 'document-api',
    });
    const result = runCompile({ state, intent });
    expect(result.ok).toBe(true);
    expect(textOf(result.tr)).toBe('quicklylazy ');

    const graph = buildReviewGraph({ state: { doc: result.tr.doc } });
    expect(graph.changes.size).toBe(3);
    const parent = graph.changes.get(parentId);
    expect(parent).toBeDefined();
    expect(parent.type).toBe(CanonicalChangeType.Insertion);

    const children = Array.from(graph.changes.values()).filter((change) => change.parent === parentId);
    expect(children).toHaveLength(2);
    const childDeletion = children.find((change) => change.type === CanonicalChangeType.Deletion);
    const childInsertion = children.find((change) => change.type === CanonicalChangeType.Insertion);
    expect(childDeletion).toBeDefined();
    expect(childInsertion).toBeDefined();
    expect(childDeletion.deletedSegments.map((segment) => segment.text).join('')).toBe('lazy');
    expect(childDeletion.deletedSegments.every((segment) => segment.attrs.overlapParentId === parentId)).toBe(true);
    expect(childInsertion.insertedSegments.map((segment) => segment.text).join('')).toBe('quickly');
    expect(childInsertion.insertedSegments.every((segment) => segment.attrs.overlapParentId === parentId)).toBe(true);
  });
});

describe('overlap-compiler: weak-identity routes through different-user path', () => {
  it('missing author email on parent insertion forces different-user behavior', () => {
    const parentId = 'ins-anon';
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [
        { text: 'Hi ' },
        { text: 'world', marks: [insertMark({ id: parentId, authorEmail: '', date: FIXED_DATE })] },
      ],
    });
    const intent = makeTextInsertIntent({
      at: 6,
      content: sliceFromText(schema, 'X'),
      user: ALICE,
      date: FIXED_DATE,
      source: 'native',
    });
    const result = runCompile({ state, intent });
    expect(result.ok).toBe(true);
    const graph = buildReviewGraph({ state: { doc: result.tr.doc } });
    // Two changes: weak-identity parent stays, Alice's child insertion is new.
    expect(graph.changes.size).toBe(2);
    const childChange = Array.from(graph.changes.values()).find((c) => c.id !== parentId);
    expect(childChange).toBeDefined();
    expect(childChange.insertedSegments[0].attrs.overlapParentId).toBe(parentId);
  });

  it('missing current-user email forces different-user behavior', () => {
    const parentId = 'ins-alice';
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [
        { text: 'Hi ' },
        { text: 'world', marks: [insertMark({ id: parentId, authorEmail: ALICE.email, date: FIXED_DATE })] },
      ],
    });
    // Current user has no email — should not refine ALICE's insertion.
    const intent = makeTextInsertIntent({
      at: 6,
      content: sliceFromText(schema, 'X'),
      user: NO_EMAIL,
      date: FIXED_DATE,
      source: 'native',
    });
    const result = runCompile({ state, intent });
    expect(result.ok).toBe(true);
    const graph = buildReviewGraph({ state: { doc: result.tr.doc } });
    // Parent + child = 2 changes.
    expect(graph.changes.size).toBe(2);
  });
});

describe('overlap-compiler: text-replace produces paired replacement metadata', () => {
  it('paired mode marks shared logical id across delete + insert', () => {
    const { state } = stateFromTrackedSpans({ schema, spans: [{ text: 'hello world' }] });
    const intent = makeTextReplaceIntent({
      from: 1,
      to: 6,
      content: sliceFromText(schema, 'HELLO'),
      replacements: 'paired',
      user: ALICE,
      date: FIXED_DATE,
      source: 'native',
    });
    const result = runCompile({ state, intent });
    expect(result.ok).toBe(true);
    const graph = buildReviewGraph({ state: { doc: result.tr.doc }, replacementsMode: 'paired' });
    // One logical change since paired.
    expect(graph.changes.size).toBe(1);
    const change = Array.from(graph.changes.values())[0];
    expect(change.type).toBe(CanonicalChangeType.Replacement);
    expect(change.replacement?.inserted.length).toBeGreaterThan(0);
    expect(change.replacement?.deleted.length).toBeGreaterThan(0);
  });

  it('keeps child insertion and deletion sides under an other-user insertion parent', () => {
    const parentId = 'ins-bob';
    const { state } = stateFromTrackedSpans({
      schema,
      spans: [
        { text: 'Hi ' },
        { text: 'world', marks: [insertMark({ id: parentId, authorEmail: BOB.email, date: FIXED_DATE })] },
      ],
    });
    const intent = makeTextReplaceIntent({
      from: 5,
      to: 7,
      content: sliceFromText(schema, 'AR'),
      replacements: 'paired',
      user: ALICE,
      date: FIXED_DATE,
      source: 'native',
    });
    const result = runCompile({ state, intent });
    expect(result.ok).toBe(true);
    const graph = buildReviewGraph({ state: { doc: result.tr.doc }, replacementsMode: 'paired' });
    const children = Array.from(graph.changes.values()).filter((change) => change.parent === parentId);
    expect(children).toHaveLength(2);
    const childDeletion = children.find((change) => change.type === CanonicalChangeType.Deletion);
    const childInsertion = children.find((change) => change.type === CanonicalChangeType.Insertion);
    expect(childDeletion).toBeDefined();
    expect(childInsertion).toBeDefined();
    expect(childDeletion.deletedSegments.map((segment) => segment.text).join('')).toBe('or');
    expect(childInsertion.insertedSegments.map((segment) => segment.text).join('')).toBe('AR');
    expect(
      [...childDeletion.segments, ...childInsertion.segments].every(
        (segment) => segment.attrs.overlapParentId === parentId,
      ),
    ).toBe(true);
  });

  it('honors a provided logical id hint for paired document-api replacements', () => {
    const providedId = 'api-replace-1';
    const { state } = stateFromTrackedSpans({ schema, spans: [{ text: 'hello world' }] });
    const intent = makeTextReplaceIntent({
      from: 1,
      to: 6,
      content: sliceFromText(schema, 'HELLO'),
      replacements: 'paired',
      user: ALICE,
      date: FIXED_DATE,
      source: 'document-api',
      replacementGroupHint: providedId,
    });
    const result = runCompile({ state, intent });
    expect(result.ok).toBe(true);
    const graph = buildReviewGraph({ state: { doc: result.tr.doc }, replacementsMode: 'paired' });
    const change = graph.changes.get(providedId);
    expect(change).toBeDefined();
    expect(change.type).toBe(CanonicalChangeType.Replacement);
    expect(result.createdChangeIds).toEqual([providedId]);
  });
});

describe('overlap-compiler: format folding (SD-486)', () => {
  // Build a richer schema that includes a bold mark for these tests.
  const schemaWithBold = (() => {
    const baseSchema = createReviewGraphTestSchema();
    return new Schema({
      nodes: baseSchema.spec.nodes,
      marks: {
        ...baseSchema.spec.marks.toObject(),
        bold: { parseDOM: [{ tag: 'strong' }], toDOM: () => ['strong'] },
      },
    });
  })();

  const makeBoldedDoc = (spans) => stateFromTrackedSpans({ schema: schemaWithBold, spans });

  it('folds bold into same-user own insertion without creating trackFormat', () => {
    const id = 'ins-alice';
    const { state } = makeBoldedDoc([
      { text: 'Hi ' },
      { text: 'world', marks: [insertMark({ id, authorEmail: ALICE.email, date: FIXED_DATE })] },
    ]);
    const boldMark = schemaWithBold.marks.bold.create();
    const intent = makeFormatIntent({
      kind: 'format-apply',
      from: 4,
      to: 9,
      mark: boldMark,
      user: ALICE,
      date: FIXED_DATE,
      source: 'native',
    });
    const result = runCompile({ state, intent });
    expect(result.ok).toBe(true);
    // No trackFormat created.
    expect(result.createdChangeIds).toHaveLength(0);
    // The inserted run should now carry bold.
    let hasBold = false;
    result.tr.doc.descendants((node) => {
      if (!node.isText) return;
      if (node.marks.some((m) => m.type.name === 'bold')) hasBold = true;
    });
    expect(hasBold).toBe(true);
  });

  it('folds same-user insertion formatting while tracking adjacent live text in the same operation', () => {
    const id = 'ins-alice';
    const { state } = makeBoldedDoc([
      { text: 'Hi ' },
      { text: 'world', marks: [insertMark({ id, authorEmail: ALICE.email, date: FIXED_DATE })] },
      { text: ' tail' },
    ]);
    const boldMark = schemaWithBold.marks.bold.create();
    const intent = makeFormatIntent({
      kind: 'format-apply',
      from: 4,
      to: 14,
      mark: boldMark,
      user: ALICE,
      date: FIXED_DATE,
      source: 'native',
    });
    const result = runCompile({ state, intent });
    expect(result.ok).toBe(true);
    expect(result.createdChangeIds).toHaveLength(1);
    expect(result.formatMarks).toHaveLength(1);

    let insertionHasBold = false;
    let insertionHasTrackFormat = false;
    let liveHasBold = false;
    let liveHasTrackFormat = false;
    result.tr.doc.descendants((node) => {
      if (!node.isText) return;
      if (node.text.includes('world')) {
        insertionHasBold = node.marks.some((m) => m.type.name === 'bold');
        insertionHasTrackFormat = node.marks.some((m) => m.type.name === TrackFormatMarkName);
      }
      if (node.text.includes(' tail')) {
        liveHasBold = node.marks.some((m) => m.type.name === 'bold');
        liveHasTrackFormat = node.marks.some((m) => m.type.name === TrackFormatMarkName);
      }
    });

    expect(insertionHasBold).toBe(true);
    expect(insertionHasTrackFormat).toBe(false);
    expect(liveHasBold).toBe(true);
    expect(liveHasTrackFormat).toBe(true);
  });

  it('creates a trackFormat over different-user inserted content', () => {
    const parentId = 'ins-bob';
    const { state } = makeBoldedDoc([
      { text: 'Hi ' },
      { text: 'world', marks: [insertMark({ id: parentId, authorEmail: BOB.email, date: FIXED_DATE })] },
    ]);
    const boldMark = schemaWithBold.marks.bold.create();
    const intent = makeFormatIntent({
      kind: 'format-apply',
      from: 4,
      to: 9,
      mark: boldMark,
      user: ALICE,
      date: FIXED_DATE,
      source: 'native',
    });
    const result = runCompile({ state, intent });
    expect(result.ok).toBe(true);
    expect(result.createdChangeIds).toHaveLength(1);
    expect(result.formatMarks).toHaveLength(1);
    expect(result.formatMarks[0].attrs.overlapParentId).toBe(parentId);
  });
});

describe('overlap-compiler: typed failures', () => {
  it('returns INVALID_TARGET for out-of-range insert', () => {
    const { state } = stateFromTrackedSpans({ schema, spans: [{ text: 'hello' }] });
    const intent = makeTextInsertIntent({
      at: 99,
      content: sliceFromText(schema, 'X'),
      user: ALICE,
      date: FIXED_DATE,
      source: 'native',
    });
    const result = runCompile({ state, intent });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('INVALID_TARGET');
  });

  it('returns INVALID_TARGET for empty text-insert content', () => {
    const { state } = stateFromTrackedSpans({ schema, spans: [{ text: 'hello' }] });
    const intent = {
      kind: 'text-insert',
      at: 1,
      content: Slice.empty,
      user: ALICE,
      date: FIXED_DATE,
      source: 'native',
    };
    const result = runCompile({ state, intent });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('INVALID_TARGET');
  });

  it('returns INVALID_TARGET for collapsed text-delete', () => {
    const { state } = stateFromTrackedSpans({ schema, spans: [{ text: 'hello' }] });
    const intent = makeTextDeleteIntent({ from: 2, to: 2, user: ALICE, date: FIXED_DATE, source: 'native' });
    const result = runCompile({ state, intent });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('INVALID_TARGET');
  });

  it('returns CAPABILITY_UNAVAILABLE for non-tracked format marks', () => {
    const baseSchema = createReviewGraphTestSchema();
    const augmented = new Schema({
      nodes: baseSchema.spec.nodes,
      marks: {
        ...baseSchema.spec.marks.toObject(),
        someStructural: { parseDOM: [], toDOM: () => ['x'] },
      },
    });
    const { state } = stateFromTrackedSpans({ schema: augmented, spans: [{ text: 'hello' }] });
    const intent = makeFormatIntent({
      kind: 'format-apply',
      from: 1,
      to: 4,
      mark: augmented.marks.someStructural.create(),
      user: ALICE,
      date: FIXED_DATE,
      source: 'native',
    });
    const result = compileTrackedEdit({ state, tr: state.tr, intent });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('CAPABILITY_UNAVAILABLE');
  });
});

describe('overlap-compiler: insertTrackedChange / document-api parity', () => {
  it('produces the same graph from document-api intent as from native', () => {
    const buildIntent = (source) =>
      makeTextInsertIntent({
        at: 3,
        content: sliceFromText(schema, 'X'),
        user: ALICE,
        date: FIXED_DATE,
        source,
      });
    const { state: nativeState } = stateFromTrackedSpans({ schema, spans: [{ text: 'hello' }] });
    const { state: apiState } = stateFromTrackedSpans({ schema, spans: [{ text: 'hello' }] });
    const nativeResult = runCompile({ state: nativeState, intent: buildIntent('native') });
    const apiResult = runCompile({ state: apiState, intent: buildIntent('document-api') });
    expect(nativeResult.ok).toBe(true);
    expect(apiResult.ok).toBe(true);
    expect(textOf(nativeResult.tr)).toBe(textOf(apiResult.tr));
    const nativeGraph = buildReviewGraph({ state: { doc: nativeResult.tr.doc } });
    const apiGraph = buildReviewGraph({ state: { doc: apiResult.tr.doc } });
    expect(nativeGraph.changes.size).toBe(apiGraph.changes.size);
  });
});
