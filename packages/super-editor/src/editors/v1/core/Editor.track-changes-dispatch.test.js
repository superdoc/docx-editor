import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextSelection } from 'prosemirror-state';
import { Slice, Fragment } from 'prosemirror-model';
import { initTestEditor } from '@tests/helpers/helpers.js';
import { Editor } from '@core/Editor.js';
import { handleBackspace } from '@core/extensions/keymap.js';
import { CustomSelectionPluginKey } from '@core/selection-state.js';
import { getTrackChanges } from '@extensions/track-changes/trackChangesHelpers/getTrackChanges.js';
import { TrackDeleteMarkName, TrackInsertMarkName } from '@extensions/track-changes/constants.js';
import { TrackChangesBasePluginKey } from '@extensions/track-changes/plugins/trackChangesBasePlugin.js';

const ALICE = { name: 'Alice Reviewer', email: 'alice@example.com' };
const BOB = { name: 'Bob Reviewer', email: 'bob@example.com' };
const FIXED_DATE = '2026-05-21T00:00:00.000Z';
const FOREIGN_INSERT_ID = 'foreign-insert';
const FOREIGN_DELETE_ID = 'foreign-delete';
const DELETED_TEXT = 'please remove this sentence';
const INSERTED_TEXT = 'here is my new text, do you like it?';
const INSERTED_TAIL = 'do you like it?';
const INSERTED_TEXT_AFTER_DIRECT_DELETE = INSERTED_TEXT.replace(INSERTED_TAIL, '');
const DIRECT_INSERT_TEXT = 'MID';
const IMPORTED_TRACKED_INSERTION_TEXT = 'lazy ';
const IMPORTED_TRACKED_INSERTION_TEXT_AFTER_DIRECT_INSERT = 'laMIDzy ';
const TEST_PARAGRAPH_BLOCK_ID = 'test-paragraph-1';
const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const WORD_REPLACEMENT_FIXTURE = resolve(
  CURRENT_DIR,
  '../tests/data/behavior-fixtures/sd-1960-word-replacement-no-comments.docx',
);
const BASIC_TEXT_INSERTION_OPEN_FIXTURE = resolve(CURRENT_DIR, '../tests/data/basic-text-insertion-open.docx');

const findTextRange = (editor, text) => {
  let found = null;
  editor.state.doc.descendants((node, pos) => {
    if (found || !node.isText || !node.text) return;
    const index = node.text.indexOf(text);
    if (index === -1) return;
    found = { from: pos + index, to: pos + index + text.length };
    return false;
  });
  if (!found) throw new Error(`Text not found: ${text}`);
  return found;
};

const markEntries = (editor, markName) => {
  const entries = [];
  editor.state.doc.descendants((node) => {
    if (!node.isText || !node.text) return;
    for (const mark of node.marks ?? []) {
      if (mark.type?.name === markName) entries.push({ text: node.text, mark });
    }
  });
  return entries;
};

const textForMarkId = (editor, markName, id) =>
  markEntries(editor, markName)
    .filter(({ mark }) => mark.attrs?.id === id)
    .map(({ text }) => text)
    .join('');

const setDocumentWithTrackedInsertion = (editor, { author = ALICE, id = FOREIGN_INSERT_ID } = {}) => {
  const { schema } = editor;
  const insertMark = schema.marks[TrackInsertMarkName].create({
    id,
    author: author.name,
    authorEmail: author.email,
    date: FIXED_DATE,
  });
  const doc = schema.nodes.doc.create(
    {},
    schema.nodes.paragraph.create(
      { sdBlockId: TEST_PARAGRAPH_BLOCK_ID },
      schema.nodes.run.create({}, [
        schema.text('hello there '),
        schema.text(INSERTED_TEXT, [insertMark]),
        schema.text(' after'),
      ]),
    ),
  );

  editor.dispatch(
    editor.state.tr
      .replaceWith(0, editor.state.doc.content.size, doc.content)
      .setMeta('skipTrackChanges', true)
      .setMeta('inputType', 'test-setup'),
  );
};

const setDocumentWithSeparateRunTrackedInsertion = (
  editor,
  { author = ALICE, id = FOREIGN_INSERT_ID, sourceId = '' } = {},
) => {
  const { schema } = editor;
  const insertMark = schema.marks[TrackInsertMarkName].create({
    id,
    author: author.name,
    authorEmail: author.email,
    date: FIXED_DATE,
    sourceId,
  });
  const doc = schema.nodes.doc.create(
    {},
    schema.nodes.paragraph.create({ sdBlockId: TEST_PARAGRAPH_BLOCK_ID }, [
      schema.nodes.run.create({}, schema.text('The quick brown fox jumps over the ')),
      schema.nodes.run.create({}, schema.text(IMPORTED_TRACKED_INSERTION_TEXT, [insertMark])),
      schema.nodes.run.create({}, schema.text('dog.')),
    ]),
  );

  editor.dispatch(
    editor.state.tr
      .replaceWith(0, editor.state.doc.content.size, doc.content)
      .setMeta('skipTrackChanges', true)
      .setMeta('inputType', 'test-setup'),
  );
};

const setDocumentWithTrackedDeletion = (editor, { author = ALICE, id = FOREIGN_DELETE_ID } = {}) => {
  const { schema } = editor;
  const deleteMark = schema.marks[TrackDeleteMarkName].create({
    id,
    author: author.name,
    authorEmail: author.email,
    date: FIXED_DATE,
  });
  const doc = schema.nodes.doc.create(
    {},
    schema.nodes.paragraph.create(
      { sdBlockId: TEST_PARAGRAPH_BLOCK_ID },
      schema.nodes.run.create({}, [
        schema.text('hello there '),
        schema.text(DELETED_TEXT, [deleteMark]),
        schema.text(' after'),
      ]),
    ),
  );

  editor.dispatch(
    editor.state.tr
      .replaceWith(0, editor.state.doc.content.size, doc.content)
      .setMeta('skipTrackChanges', true)
      .setMeta('inputType', 'test-setup'),
  );
};

const firstBlockId = (editor) => editor.state.doc.firstChild?.attrs?.sdBlockId ?? TEST_PARAGRAPH_BLOCK_ID;

const findFirstNode = (editor, typeName) => {
  let found = null;
  editor.state.doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === typeName) {
      found = { node, pos };
      return false;
    }
    return undefined;
  });
  return found;
};
const deleteText = (editor, text) => {
  const { from, to } = findTextRange(editor, text);
  editor.dispatch(editor.state.tr.delete(from, to).setMeta('inputType', 'deleteContentBackward'));
};

const replaceText = (editor, text, replacement) => {
  const { from, to } = findTextRange(editor, text);
  editor.dispatch(editor.state.tr.insertText(replacement, from, to).setMeta('inputType', 'insertText'));
};

const getFirstMatchRef = (editor, pattern) => {
  const match = editor.doc.query.match({
    select: { type: 'text', pattern },
    require: 'first',
  });
  const ref = match?.items?.[0]?.handle?.ref;
  if (!ref) throw new Error(`Could not resolve ref for pattern "${pattern}"`);
  return ref;
};

describe('Editor dispatch tracked-change meta', () => {
  let editor;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
      editor = null;
    }
  });

  it('treats forceTrackChanges programmatic transactions as tracked even when global mode is off', () => {
    ({ editor } = initTestEditor({
      mode: 'text',
      content: '<p>Hello</p>',
      user: { name: 'Test', email: 'test@example.com' },
      useImmediateSetTimeout: false,
    }));

    const trackInsertMark = editor.schema?.marks?.[TrackInsertMarkName];
    expect(trackInsertMark).toBeDefined();

    const trackState = TrackChangesBasePluginKey.getState(editor.state);
    expect(trackState?.isTrackChangesActive ?? false).toBe(false);
    expect(getTrackChanges(editor.state)).toHaveLength(0);

    const tr = editor.state.tr
      .insertText('X', 1, 1)
      .setMeta('inputType', 'programmatic')
      .setMeta('forceTrackChanges', true);

    editor.dispatch(tr);

    const tracked = getTrackChanges(editor.state);
    expect(tracked.some((entry) => entry.mark.type.name === TrackInsertMarkName)).toBe(true);
  });

  it('skipTrackChanges overrides forceTrackChanges — no tracking applied', () => {
    ({ editor } = initTestEditor({
      mode: 'text',
      content: '<p>Hello</p>',
      user: { name: 'Test', email: 'test@example.com' },
      useImmediateSetTimeout: false,
    }));

    const trackState = TrackChangesBasePluginKey.getState(editor.state);
    expect(trackState?.isTrackChangesActive ?? false).toBe(false);

    const tr = editor.state.tr
      .insertText('X', 1, 1)
      .setMeta('inputType', 'programmatic')
      .setMeta('forceTrackChanges', true)
      .setMeta('skipTrackChanges', true);

    editor.dispatch(tr);

    const tracked = getTrackChanges(editor.state);
    expect(tracked).toHaveLength(0);
  });

  it('throws a clear error when forceTrackChanges is used without a configured user', () => {
    ({ editor } = initTestEditor({
      mode: 'text',
      content: '<p>Hello</p>',
      useImmediateSetTimeout: false,
    }));

    const tr = editor.state.tr
      .insertText('X', 1, 1)
      .setMeta('inputType', 'programmatic')
      .setMeta('forceTrackChanges', true);

    expect(() => editor.dispatch(tr)).toThrow(
      'forceTrackChanges requires a user to be configured on the editor instance.',
    );
  });

  it('global track-changes mode still produces tracked entities without forceTrackChanges', () => {
    ({ editor } = initTestEditor({
      mode: 'text',
      content: '<p>Hello</p>',
      user: { name: 'Test', email: 'test@example.com' },
      useImmediateSetTimeout: false,
    }));

    const enableTr = editor.state.tr.setMeta(TrackChangesBasePluginKey, {
      type: 'TRACK_CHANGES_ENABLE',
      value: true,
    });
    editor.dispatch(enableTr);

    const trackState = TrackChangesBasePluginKey.getState(editor.state);
    expect(trackState?.isTrackChangesActive).toBe(true);

    const tr = editor.state.tr.insertText('Y', 1, 1).setMeta('inputType', 'programmatic');

    editor.dispatch(tr);

    const tracked = getTrackChanges(editor.state);
    expect(tracked.some((entry) => entry.mark.type.name === TrackInsertMarkName)).toBe(true);
  });

  it('emits an add commentsUpdate when a native suggesting insert creates a tracked insertion', () => {
    ({ editor } = initTestEditor({
      mode: 'text',
      content: '<p>Hello</p>',
      user: { name: 'Test', email: 'test@example.com' },
      useImmediateSetTimeout: false,
    }));

    editor.setDocumentMode('suggesting');

    const emitSpy = vi.spyOn(editor, 'emit');
    const tr = editor.state.tr.insertText('Tracked ', 1, 1).setMeta('inputType', 'insertText');

    editor.dispatch(tr);

    const tracked = getTrackChanges(editor.state);
    expect(tracked.some((entry) => entry.mark.type.name === TrackInsertMarkName)).toBe(true);

    const addPayload = emitSpy.mock.calls.find(
      ([eventName, payload]) =>
        eventName === 'commentsUpdate' &&
        payload?.type === 'trackedChange' &&
        payload?.event === 'add' &&
        payload?.trackedChangeType === TrackInsertMarkName,
    )?.[1];

    expect(addPayload).toEqual(
      expect.objectContaining({
        trackedChangeText: expect.stringContaining('Tracked'),
        author: 'Test',
        authorEmail: 'test@example.com',
      }),
    );
  });

  it('tracks native replacement transactions that clear a toolbar-preserved selection', () => {
    ({ editor } = initTestEditor({
      mode: 'text',
      content: '<p>Replace target</p>',
      user: { name: 'Test', email: 'test@example.com' },
      useImmediateSetTimeout: false,
    }));

    editor.setDocumentMode('suggesting');

    const range = findTextRange(editor, 'Replace target');
    const preservedSelection = TextSelection.create(editor.state.doc, range.from, range.to);
    editor.dispatch(
      editor.state.tr.setMeta(CustomSelectionPluginKey, {
        focused: true,
        preservedSelection,
        showVisualSelection: true,
        skipFocusReset: false,
      }),
    );
    expect(CustomSelectionPluginKey.getState(editor.state)?.preservedSelection).not.toBeNull();

    editor.dispatch(
      editor.state.tr
        .insertText('Tracked text', range.from, range.to)
        .setMeta(CustomSelectionPluginKey, {
          focused: false,
          preservedSelection: null,
          showVisualSelection: false,
          skipFocusReset: false,
        })
        .setMeta('inputType', 'insertText'),
    );

    const insertedText = markEntries(editor, TrackInsertMarkName)
      .map(({ text }) => text)
      .join('');
    const deletedText = markEntries(editor, TrackDeleteMarkName)
      .map(({ text }) => text)
      .join('');

    expect(insertedText).toContain('Tracked text');
    expect(deletedText).toContain('Replace target');
    expect(getTrackChanges(editor.state).length).toBeGreaterThanOrEqual(1);
    expect(CustomSelectionPluginKey.getState(editor.state)?.preservedSelection).toBeNull();
  });

  it('normalizes modules.trackChanges.replacements for direct Editor.open callers', async () => {
    const opened = await Editor.open(undefined, {
      isHeadless: true,
      modules: { trackChanges: { replacements: 'independent' } },
    });

    try {
      expect(opened.options.trackedChanges?.replacements).toBe('independent');
    } finally {
      opened.destroy();
    }
  });

  it('uses modules.trackChanges.replacements during Word replacement import projection', async () => {
    const fixture = await readFile(WORD_REPLACEMENT_FIXTURE);
    const paired = await Editor.open(fixture, {
      isHeadless: true,
      modules: { trackChanges: { replacements: 'paired' } },
    });
    const independent = await Editor.open(fixture, {
      isHeadless: true,
      modules: { trackChanges: { replacements: 'independent' } },
    });

    try {
      const pairedItems = paired.doc.trackChanges.list().items;
      const independentItems = independent.doc.trackChanges.list().items;

      expect(pairedItems).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'replacement', grouping: 'replacement-pair' })]),
      );
      expect(independentItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'insert', grouping: 'standalone' }),
          expect.objectContaining({ type: 'delete', grouping: 'standalone' }),
        ]),
      );
      expect(independentItems.some((item) => item.grouping === 'replacement-pair')).toBe(false);
      expect(independentItems.length).toBeGreaterThan(pairedItems.length);
    } finally {
      paired.destroy();
      independent.destroy();
    }
  });

  it('mutates another user tracked insertion in place on direct delete while local track mode is off', () => {
    ({ editor } = initTestEditor({
      mode: 'text',
      content: '<p></p>',
      user: BOB,
      useImmediateSetTimeout: false,
    }));
    setDocumentWithTrackedInsertion(editor);

    const trackState = TrackChangesBasePluginKey.getState(editor.state);
    expect(trackState?.isTrackChangesActive ?? false).toBe(false);

    deleteText(editor, INSERTED_TAIL);

    expect(textForMarkId(editor, TrackInsertMarkName, FOREIGN_INSERT_ID)).toBe(INSERTED_TEXT_AFTER_DIRECT_DELETE);
    expect(markEntries(editor, TrackDeleteMarkName)).toHaveLength(0);
  });

  it('mutates an anonymous live tracked insertion in place on direct delete without a configured editor user', () => {
    ({ editor } = initTestEditor({
      mode: 'text',
      content: '<p></p>',
      useImmediateSetTimeout: false,
    }));
    setDocumentWithTrackedInsertion(editor, { author: { name: '', email: '' }, id: FOREIGN_INSERT_ID });

    const trackState = TrackChangesBasePluginKey.getState(editor.state);
    expect(trackState?.isTrackChangesActive ?? false).toBe(false);

    deleteText(editor, INSERTED_TAIL);

    expect(textForMarkId(editor, TrackInsertMarkName, FOREIGN_INSERT_ID)).toBe(INSERTED_TEXT_AFTER_DIRECT_DELETE);
    expect(markEntries(editor, TrackDeleteMarkName)).toHaveLength(0);
  });

  it('mutates an anonymous live tracked insertion in place from document-api direct delete', () => {
    ({ editor } = initTestEditor({
      mode: 'text',
      content: '<p></p>',
      useImmediateSetTimeout: false,
    }));
    setDocumentWithTrackedInsertion(editor, { author: { name: '', email: '' }, id: FOREIGN_INSERT_ID });

    const receipt = editor.doc.delete({ ref: getFirstMatchRef(editor, INSERTED_TAIL) }, { changeMode: 'direct' });

    expect(receipt.success).toBe(true);
    expect(textForMarkId(editor, TrackInsertMarkName, FOREIGN_INSERT_ID)).toBe(INSERTED_TEXT_AFTER_DIRECT_DELETE);
    expect(markEntries(editor, TrackDeleteMarkName)).toHaveLength(0);
  });

  it('mutates tracked insertion created by document-api insert from document-api direct delete', () => {
    ({ editor } = initTestEditor({
      mode: 'text',
      content: '<p></p>',
      user: { id: 'cli', name: 'CLI' },
      useImmediateSetTimeout: false,
    }));

    expect(editor.doc.trackChanges.list().total).toBe(0);
    expect(editor.doc.comments.list().total).toBe(0);

    const insertReceipt = editor.doc.insert({ value: 'live-review-comment' }, { changeMode: 'tracked' });
    expect(insertReceipt.success).toBe(true);

    const insertMark = markEntries(editor, TrackInsertMarkName).find(({ text }) => text === 'live-review-comment');
    expect(insertMark?.mark.attrs).toEqual(
      expect.objectContaining({
        author: 'CLI',
        authorId: 'cli',
        authorEmail: '',
      }),
    );

    const deleteReceipt = editor.doc.delete({ ref: getFirstMatchRef(editor, 'review') }, { changeMode: 'direct' });

    expect(deleteReceipt.success).toBe(true);
    expect(editor.state.doc.textContent).toContain('live--comment');

    expect(textForMarkId(editor, TrackInsertMarkName, insertMark?.mark.attrs.id)).toBe('live--comment');
    expect(markEntries(editor, TrackDeleteMarkName)).toHaveLength(0);

    const trackedChanges = editor.doc.trackChanges.list();
    expect(trackedChanges.total).toBe(1);
    expect(trackedChanges.items.map((item) => item.raw?.type ?? item.type)).toEqual(['insert']);

    const comments = editor.doc.comments.list();
    expect(comments.total).toBe(1);
    expect(comments.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ trackedChangeType: 'insert', trackedChangeText: 'live--comment' }),
      ]),
    );
  });

  it('protects another user tracked insertion from direct replace while local track mode is off', () => {
    ({ editor } = initTestEditor({
      mode: 'text',
      content: '<p></p>',
      user: BOB,
      useImmediateSetTimeout: false,
    }));
    setDocumentWithTrackedInsertion(editor);

    replaceText(editor, INSERTED_TAIL, 'yes');

    expect(editor.state.doc.textContent).toContain(INSERTED_TAIL);
    expect(editor.state.doc.textContent).toContain('yes');

    const childDeletion = markEntries(editor, TrackDeleteMarkName).find(({ text }) => text === INSERTED_TAIL);
    expect(childDeletion?.mark.attrs).toEqual(
      expect.objectContaining({
        authorEmail: BOB.email,
        overlapParentId: FOREIGN_INSERT_ID,
      }),
    );

    const childInsertion = markEntries(editor, TrackInsertMarkName).find(
      ({ text, mark }) => text === 'yes' && mark.attrs?.id !== FOREIGN_INSERT_ID,
    );
    expect(childInsertion?.mark.attrs).toEqual(
      expect.objectContaining({
        authorEmail: BOB.email,
        overlapParentId: FOREIGN_INSERT_ID,
      }),
    );
  });

  it('inserts plain text on direct insert inside another user tracked insertion while local track mode is off', () => {
    ({ editor } = initTestEditor({
      mode: 'text',
      content: '<p></p>',
      user: BOB,
      useImmediateSetTimeout: false,
    }));
    setDocumentWithTrackedInsertion(editor);

    const insertPos = findTextRange(editor, INSERTED_TEXT).from + 4;
    editor.dispatch(editor.state.tr.insertText('ZZ', insertPos).setMeta('inputType', 'insertText'));

    // Editing mode: the typed text stays plain and the existing suggestion is
    // simply split around it, so the foreign insertion never covers the new chars.
    expect(editor.state.doc.textContent).toContain('hereZZ is my new text, do you like it?');
    expect(textForMarkId(editor, TrackInsertMarkName, FOREIGN_INSERT_ID)).toBe(INSERTED_TEXT);
    expect(
      markEntries(editor, TrackInsertMarkName).filter(({ mark }) => mark.attrs?.id !== FOREIGN_INSERT_ID),
    ).toHaveLength(0);
    expect(markEntries(editor, TrackInsertMarkName).some(({ text }) => text.includes('ZZ'))).toBe(false);
    expect(markEntries(editor, TrackDeleteMarkName)).toHaveLength(0);
  });

  it('does not over-strip the existing suggestion on an open-slice paste inside another user tracked insertion while local track mode is off', () => {
    ({ editor } = initTestEditor({
      mode: 'text',
      content: '<p></p>',
      user: BOB,
      useImmediateSetTimeout: false,
    }));
    setDocumentWithTrackedInsertion(editor);

    // A genuinely open slice - the shape a multi-paragraph / rich-HTML paste produces -
    // has content.size > slice.size because of its open node boundaries (a slice of
    // inline text within one node would be closed, content.size === size). Paste it
    // collapsed strictly inside the foreign insertion. The mark cleanup must span only
    // the inserted size (slice.size); using content.size would overrun and strip
    // trackInsert from the suggestion text after the paste.
    const { schema } = editor;
    const openSlice = new Slice(
      Fragment.from(
        schema.nodes.paragraph.create({ sdBlockId: 'paste-src' }, schema.nodes.run.create({}, schema.text('PASTE'))),
      ),
      2,
      2,
    );
    expect(openSlice.content.size).toBeGreaterThan(openSlice.size);

    const insertPos = findTextRange(editor, INSERTED_TEXT).from + 4;
    editor.dispatch(
      editor.state.tr.replaceRange(insertPos, insertPos, openSlice).setMeta('inputType', 'insertFromPaste'),
    );

    // The paste landed at the cursor (after "here"); textContent joins blocks with no
    // separator, so this holds whether the open slice merges inline or splits a block.
    expect(editor.state.doc.textContent).toContain('herePASTE is my new text');

    // The whole original insertion stays tracked (split around the now-plain paste);
    // no characters after the paste point lost their trackInsert mark.
    expect(textForMarkId(editor, TrackInsertMarkName, FOREIGN_INSERT_ID)).toBe(INSERTED_TEXT);
    expect(markEntries(editor, TrackInsertMarkName).some(({ text }) => text.includes('PASTE'))).toBe(false);
  });

  it('preserves review marks carried by a pasted slice inside another user tracked insertion while local track mode is off', () => {
    ({ editor } = initTestEditor({
      mode: 'text',
      content: '<p></p>',
      user: BOB,
      useImmediateSetTimeout: false,
    }));
    setDocumentWithTrackedInsertion(editor);

    // Pasting a SuperDoc slice that already carries its own tracked-review marks
    // (a copied suggestion) into the interior of another suggestion must keep the
    // pasted marks. Only the ENCLOSING mark inherited from the neighbour is stripped;
    // a blanket strip-by-type would silently drop the pasted review metadata.
    const { schema } = editor;
    const pastedMark = schema.marks[TrackInsertMarkName].create({
      id: 'pasted-insert',
      author: 'Carol Author',
      authorEmail: 'carol@example.com',
      date: FIXED_DATE,
    });
    const openSlice = new Slice(
      Fragment.from(
        schema.nodes.paragraph.create(
          { sdBlockId: 'paste-src' },
          schema.nodes.run.create({}, schema.text('COPIED', [pastedMark])),
        ),
      ),
      2,
      2,
    );

    const insertPos = findTextRange(editor, INSERTED_TEXT).from + 4;
    editor.dispatch(
      editor.state.tr.replaceRange(insertPos, insertPos, openSlice).setMeta('inputType', 'insertFromPaste'),
    );

    // The pasted suggestion keeps its own review id (it is not the enclosing mark).
    expect(textForMarkId(editor, TrackInsertMarkName, 'pasted-insert')).toBe('COPIED');
    // The enclosing foreign insertion did not absorb the pasted text into its id.
    expect(textForMarkId(editor, TrackInsertMarkName, FOREIGN_INSERT_ID)).toBe(INSERTED_TEXT);
  });

  it('inserts plain text on direct insert inside another user tracked deletion while local track mode is off', () => {
    ({ editor } = initTestEditor({
      mode: 'text',
      content: '<p></p>',
      user: BOB,
      useImmediateSetTimeout: false,
    }));
    setDocumentWithTrackedDeletion(editor);

    const beforeTrackedChanges = editor.doc.trackChanges.list().items;
    expect(beforeTrackedChanges).toHaveLength(1);
    const beforeChangeId = beforeTrackedChanges[0].id;

    const insertPos = findTextRange(editor, DELETED_TEXT).from + 6;
    editor.dispatch(editor.state.tr.insertText('ZZ', insertPos).setMeta('inputType', 'insertText'));

    // The Slack bug: typing inside someone else's pending deletion must not join
    // the deletion (struck through) nor become a new tracked insert. The chars
    // stay plain and the deletion is preserved, split around them.
    expect(editor.state.doc.textContent).toContain('pleaseZZ remove this sentence');
    expect(textForMarkId(editor, TrackDeleteMarkName, FOREIGN_DELETE_ID)).toBe(DELETED_TEXT);
    expect(markEntries(editor, TrackDeleteMarkName).some(({ text }) => text.includes('ZZ'))).toBe(false);
    expect(markEntries(editor, TrackInsertMarkName)).toHaveLength(0);

    const afterTrackedChanges = editor.doc.trackChanges.list().items;
    expect(afterTrackedChanges).toHaveLength(1);
    expect(afterTrackedChanges[0].id).toBe(beforeChangeId);
  });

  it('inserts plain text on collapsed paste inside another user tracked deletion while local track mode is off', () => {
    ({ editor } = initTestEditor({
      mode: 'text',
      content: '<p></p>',
      user: BOB,
      useImmediateSetTimeout: false,
    }));
    setDocumentWithTrackedDeletion(editor);

    const beforeTrackedChanges = editor.doc.trackChanges.list().items;
    expect(beforeTrackedChanges).toHaveLength(1);

    // A paste with a collapsed selection arrives as a single collapsed ReplaceStep
    // carrying a slice (here a plain text node), the same shape the fix keys on.
    const insertPos = findTextRange(editor, DELETED_TEXT).from + 6;
    editor.dispatch(
      editor.state.tr.insert(insertPos, editor.schema.text('PASTED')).setMeta('inputType', 'insertFromPaste'),
    );

    expect(editor.state.doc.textContent).toContain('pleasePASTED remove this sentence');
    expect(markEntries(editor, TrackInsertMarkName)).toHaveLength(0);
    expect(markEntries(editor, TrackDeleteMarkName).some(({ text }) => text.includes('PASTED'))).toBe(false);
    expect(textForMarkId(editor, TrackDeleteMarkName, FOREIGN_DELETE_ID)).toBe(DELETED_TEXT);

    const afterTrackedChanges = editor.doc.trackChanges.list().items;
    expect(afterTrackedChanges).toHaveLength(1);
  });

  it('does not expand the existing insertion review item on direct insert inside another user tracked insertion', () => {
    ({ editor } = initTestEditor({
      mode: 'text',
      content: '<p></p>',
      user: BOB,
      useImmediateSetTimeout: false,
    }));
    setDocumentWithTrackedInsertion(editor);

    const emitSpy = vi.spyOn(editor, 'emit');
    const insertPos = findTextRange(editor, INSERTED_TEXT).from + 4;
    editor.dispatch(editor.state.tr.insertText('ZZ', insertPos).setMeta('inputType', 'insertText'));

    // The plain typed text is not part of any review item, so the existing
    // insertion comment keeps its original text and no new child item appears.
    expect(editor.doc.comments.list().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          trackedChangeType: 'insert',
          trackedChangeText: INSERTED_TEXT,
        }),
      ]),
    );
    expect(editor.doc.comments.list().items.some((item) => item.trackedChangeText?.includes('ZZ'))).toBe(false);

    const addChildInsertionEvent = emitSpy.mock.calls.find(
      ([eventName, payload]) =>
        eventName === 'commentsUpdate' &&
        payload?.type === 'trackedChange' &&
        payload?.event === 'add' &&
        payload?.trackedChangeType === TrackInsertMarkName &&
        payload?.trackedChangeText === 'ZZ',
    )?.[1];

    expect(addChildInsertionEvent).toBeUndefined();

    // No commentsUpdate event of any kind (add or update) should reference the
    // plain typed text - the suggestion was split around it, not mutated, so the
    // stale direct-insertion mutation event must be suppressed.
    const anyEventMentionsTypedText = emitSpy.mock.calls.some(
      ([eventName, payload]) =>
        eventName === 'commentsUpdate' &&
        typeof payload?.trackedChangeText === 'string' &&
        payload.trackedChangeText.includes('ZZ'),
    );
    expect(anyEventMentionsTypedText).toBe(false);
  });

  it('keeps a live tracked insertion intact and inserts plain text on direct insert inside it', () => {
    ({ editor } = initTestEditor({
      mode: 'text',
      content: '<p></p>',
      user: { id: 'cli', name: 'CLI' },
      useImmediateSetTimeout: false,
    }));

    const insertReceipt = editor.doc.insert({ value: 'live-review-comment' }, { changeMode: 'tracked' });
    expect(insertReceipt.success).toBe(true);

    const beforeTrackedChanges = editor.doc.trackChanges.list().items;
    const beforeComments = editor.doc.comments.list().items;

    expect(beforeTrackedChanges).toHaveLength(1);
    expect(beforeComments).toHaveLength(1);

    const beforeChangeId = beforeTrackedChanges[0].id;
    const beforeCommentId = beforeComments[0].commentId;

    const reviewStart = editor.state.doc.textContent.indexOf('review');
    expect(reviewStart).toBeGreaterThanOrEqual(0);
    const insertOffset = reviewStart + 2;

    const receipt = editor.doc.insert(
      {
        value: 'ZZ',
        target: {
          kind: 'selection',
          start: { kind: 'text', blockId: firstBlockId(editor), offset: insertOffset },
          end: { kind: 'text', blockId: firstBlockId(editor), offset: insertOffset },
        },
      },
      { changeMode: 'direct' },
    );

    expect(receipt.success).toBe(true);
    expect(editor.state.doc.textContent).toContain('live-reZZview-comment');

    const afterTrackedChanges = editor.doc.trackChanges.list().items;
    const afterComments = editor.doc.comments.list().items;

    // Direct insert stays plain: the suggestion is split around it, so its id,
    // linked comment, and text all stay exactly as before (no ZZ absorbed).
    expect(afterTrackedChanges).toHaveLength(1);
    expect(afterComments).toHaveLength(1);
    expect(afterTrackedChanges[0].id).toBe(beforeChangeId);
    expect(afterComments[0].commentId).toBe(beforeCommentId);
    expect(afterTrackedChanges[0].insertedText).toBe('live-review-comment');
    expect(afterComments[0].trackedChangeText).toBe('live-review-comment');
  });

  it('inserts plain text inside an imported-style separate-run tracked insertion from document-api direct insert', () => {
    ({ editor } = initTestEditor({
      mode: 'text',
      content: '<p></p>',
      user: BOB,
      useImmediateSetTimeout: false,
    }));
    setDocumentWithSeparateRunTrackedInsertion(editor, { sourceId: '11' });

    const beforeTrackedChanges = editor.doc.trackChanges.list().items;
    expect(beforeTrackedChanges).toHaveLength(1);
    const beforeChangeId = beforeTrackedChanges[0].id;

    const insertOffset = 'The quick brown fox jumps over the la'.length;
    const receipt = editor.doc.insert(
      {
        value: DIRECT_INSERT_TEXT,
        target: {
          kind: 'selection',
          start: { kind: 'text', blockId: firstBlockId(editor), offset: insertOffset },
          end: { kind: 'text', blockId: firstBlockId(editor), offset: insertOffset },
        },
      },
      { changeMode: 'direct' },
    );

    expect(receipt.success).toBe(true);
    // The imported suggestion is split around the plain text; its text and the
    // tracked change stay unchanged, and the new chars carry no review mark.
    expect(editor.state.doc.textContent).toContain(IMPORTED_TRACKED_INSERTION_TEXT_AFTER_DIRECT_INSERT);
    expect(textForMarkId(editor, TrackInsertMarkName, FOREIGN_INSERT_ID)).toBe(IMPORTED_TRACKED_INSERTION_TEXT);
    expect(markEntries(editor, TrackInsertMarkName).some(({ text }) => text.includes(DIRECT_INSERT_TEXT))).toBe(false);
    expect(markEntries(editor, TrackDeleteMarkName)).toHaveLength(0);

    const afterTrackedChanges = editor.doc.trackChanges.list().items;
    expect(afterTrackedChanges).toHaveLength(1);
    expect(afterTrackedChanges[0].id).toBe(beforeChangeId);
    expect(afterTrackedChanges[0].insertedText).toBe(IMPORTED_TRACKED_INSERTION_TEXT);
  });

  it('keeps imported tracked insertions intact and inserts plain text on document-api direct insert inside the imported text', async () => {
    const fixture = await readFile(BASIC_TEXT_INSERTION_OPEN_FIXTURE);
    editor = await Editor.open(fixture, {
      isHeadless: true,
      user: BOB,
    });

    const beforeTrackedChanges = editor.doc.trackChanges.list().items;
    expect(beforeTrackedChanges).toHaveLength(1);
    const beforeChangeId = beforeTrackedChanges[0].id;

    const match = editor.doc.query.match({
      select: { type: 'text', pattern: 'zy ', caseSensitive: true },
      require: 'first',
      includeNodes: true,
    });
    const targetStart = match?.items?.[0]?.target?.start;
    expect(targetStart).toBeDefined();

    const receipt = editor.doc.insert(
      {
        value: DIRECT_INSERT_TEXT,
        target: {
          kind: 'selection',
          start: targetStart,
          end: targetStart,
        },
      },
      { changeMode: 'direct' },
    );

    expect(receipt.success).toBe(true);
    // The plain text splits the imported suggestion without joining it, so the
    // tracked change keeps its id and original text.
    expect(editor.state.doc.textContent).toContain(IMPORTED_TRACKED_INSERTION_TEXT_AFTER_DIRECT_INSERT);
    expect(markEntries(editor, TrackInsertMarkName).some(({ text }) => text.includes(DIRECT_INSERT_TEXT))).toBe(false);
    const afterTrackedChanges = editor.doc.trackChanges.list().items;
    expect(afterTrackedChanges).toHaveLength(1);
    expect(afterTrackedChanges[0].id).toBe(beforeChangeId);
    expect(afterTrackedChanges[0].insertedText).toBe(IMPORTED_TRACKED_INSERTION_TEXT);
  });

  it('protects an imported-style separate-run tracked insertion from direct doc.replace', () => {
    ({ editor } = initTestEditor({
      mode: 'text',
      content: '<p></p>',
      user: BOB,
      useImmediateSetTimeout: false,
    }));
    setDocumentWithSeparateRunTrackedInsertion(editor);

    const receipt = editor.doc.replace(
      {
        ref: getFirstMatchRef(editor, 'lazy'),
        text: 'quickly',
      },
      { changeMode: 'direct' },
    );

    expect(receipt.success).toBe(true);
    expect(textForMarkId(editor, TrackInsertMarkName, FOREIGN_INSERT_ID)).toBe('lazy ');

    const childDeletion = markEntries(editor, TrackDeleteMarkName).find(({ text }) => text === 'lazy');
    expect(childDeletion?.mark.attrs).toEqual(
      expect.objectContaining({
        authorEmail: BOB.email,
        overlapParentId: FOREIGN_INSERT_ID,
      }),
    );

    const childInsertion = markEntries(editor, TrackInsertMarkName).find(
      ({ text, mark }) => text === 'quickly' && mark.attrs?.id !== FOREIGN_INSERT_ID,
    );
    expect(childInsertion?.mark.attrs).toEqual(
      expect.objectContaining({
        authorEmail: BOB.email,
        overlapParentId: FOREIGN_INSERT_ID,
      }),
    );
  });

  it('does not emit a child deletion review comment on direct delete inside a tracked insertion', () => {
    ({ editor } = initTestEditor({
      mode: 'text',
      content: '<p></p>',
      user: BOB,
      useImmediateSetTimeout: false,
    }));
    setDocumentWithTrackedInsertion(editor);

    const emitSpy = vi.spyOn(editor, 'emit');
    deleteText(editor, INSERTED_TAIL);

    const childDeletionEvent = emitSpy.mock.calls.find(
      ([eventName, payload]) =>
        eventName === 'commentsUpdate' &&
        payload?.type === 'trackedChange' &&
        payload?.event === 'add' &&
        payload?.trackedChangeType === TrackDeleteMarkName,
    )?.[1];

    expect(childDeletionEvent).toBeUndefined();
    expect(textForMarkId(editor, TrackInsertMarkName, FOREIGN_INSERT_ID)).toBe(INSERTED_TEXT_AFTER_DIRECT_DELETE);
    expect(editor.doc.comments.list().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          trackedChangeType: 'insert',
          trackedChangeText: INSERTED_TEXT_AFTER_DIRECT_DELETE,
        }),
      ]),
    );
  });

  it('still allows direct deletion of untracked plain text while local track mode is off', () => {
    ({ editor } = initTestEditor({
      mode: 'text',
      content: '<p>hello plain text</p>',
      user: BOB,
      useImmediateSetTimeout: false,
    }));

    deleteText(editor, 'plain ');

    expect(editor.state.doc.textContent).toBe('hello text');
    expect(markEntries(editor, TrackInsertMarkName)).toHaveLength(0);
    expect(markEntries(editor, TrackDeleteMarkName)).toHaveLength(0);
  });

  it('collapses the current user own insertion on direct delete without creating a child review item', () => {
    ({ editor } = initTestEditor({
      mode: 'text',
      content: '<p></p>',
      user: BOB,
      useImmediateSetTimeout: false,
    }));
    setDocumentWithTrackedInsertion(editor, { author: BOB, id: 'own-insert' });

    deleteText(editor, INSERTED_TEXT);

    expect(editor.state.doc.textContent).toBe('hello there  after');
    expect(markEntries(editor, TrackInsertMarkName).filter(({ mark }) => mark.attrs?.id === 'own-insert')).toHaveLength(
      0,
    );
    expect(markEntries(editor, TrackDeleteMarkName)).toHaveLength(0);
  });

  it('removes an own suggested tab on Backspace and keeps the caret ready for typing (SD-3376)', () => {
    ({ editor } = initTestEditor({
      mode: 'text',
      content: '<p>Hello</p>',
      user: { name: 'Test', email: 'test@example.com' },
      useImmediateSetTimeout: false,
    }));

    editor.setDocumentMode('suggesting');

    // Insert a tab at end of "Hello".
    const range = findTextRange(editor, 'Hello');
    editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, range.to)));
    editor.commands.insertTabNode();

    // Own tracked insertion.
    const insertedTab = findFirstNode(editor, 'tab');
    expect(insertedTab).not.toBeNull();
    expect(insertedTab.node.marks.some((mark) => mark.type.name === TrackInsertMarkName)).toBe(true);

    // Backspace should remove the tab (matching Word).
    const handled = handleBackspace(editor);
    expect(handled).toBe(true);
    expect(findFirstNode(editor, 'tab')).toBeNull();
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.doc.textBetween(0, editor.state.selection.from)).toBe('Hello');

    editor.dispatch(editor.state.tr.insertText('!').setMeta('inputType', 'insertText'));

    expect(editor.state.doc.textContent).toBe('Hello!');
    expect(editor.state.selection.from).toBe(findTextRange(editor, '!').to);
    expect(
      markEntries(editor, TrackInsertMarkName)
        .map(({ text }) => text)
        .join(''),
    ).toBe('!');
    expect(markEntries(editor, TrackDeleteMarkName)).toHaveLength(0);
  });

  it('preserves another user suggested tab as a child deletion on Backspace (SD-3376)', () => {
    ({ editor } = initTestEditor({
      mode: 'text',
      content: '<p>Hello</p>',
      user: ALICE,
      useImmediateSetTimeout: false,
    }));
    editor.setDocumentMode('suggesting');
    const range = findTextRange(editor, 'Hello');
    editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, range.to)));
    editor.commands.insertTabNode();

    const insertedTab = findFirstNode(editor, 'tab');
    const insertion = insertedTab.node.marks.find((mark) => mark.type.name === TrackInsertMarkName);
    expect(insertion.attrs.authorEmail).toBe(ALICE.email);

    editor.setOptions({ user: BOB });
    expect(handleBackspace(editor)).toBe(true);

    const deletedTab = findFirstNode(editor, 'tab');
    expect(deletedTab).not.toBeNull();
    expect(deletedTab.node.marks.find((mark) => mark.type.name === TrackInsertMarkName)).toEqual(insertion);
    const deletion = deletedTab.node.marks.find((mark) => mark.type.name === TrackDeleteMarkName);
    expect(deletion?.attrs).toEqual(
      expect.objectContaining({ authorEmail: BOB.email, overlapParentId: insertion.attrs.id }),
    );
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.from).toBeLessThanOrEqual(deletedTab.pos);

    editor.dispatch(editor.state.tr.insertText('!').setMeta('inputType', 'insertText'));

    expect(editor.state.doc.textContent).toBe('Hello!');
    expect(findTextRange(editor, '!').to).toBeLessThanOrEqual(findFirstNode(editor, 'tab').pos);
    expect(markEntries(editor, TrackInsertMarkName)).toEqual([
      expect.objectContaining({
        text: '!',
        mark: expect.objectContaining({ attrs: expect.objectContaining({ authorEmail: BOB.email }) }),
      }),
    ]);
    expect(findFirstNode(editor, 'tab').node.marks).toEqual(expect.arrayContaining([insertion, deletion]));
  });
});
