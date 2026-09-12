import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Editor } from '../../core/Editor.js';
import {
  TrackDeleteMarkName,
  TrackFormatMarkName,
  TrackInsertMarkName,
} from '../../extensions/track-changes/constants.js';
import { getTrackChanges } from '../../extensions/track-changes/trackChangesHelpers/getTrackChanges.js';
import { enumerateStructuralRowChanges } from '../../extensions/track-changes/trackChangesHelpers/structuralRowChanges.js';
import {
  buildTrackedChangeCanonicalIdMap,
  groupTrackedChanges,
  resolveTrackedChange,
  resolveTrackedChangeNavigationSelection,
  resolveTrackedChangeType,
  toCanonicalTrackedChangeId,
} from './tracked-change-resolver.js';

vi.mock('../../extensions/track-changes/trackChangesHelpers/getTrackChanges.js', () => ({
  getTrackChanges: vi.fn(),
}));

vi.mock('../../extensions/track-changes/trackChangesHelpers/structuralRowChanges.js', () => ({
  enumerateStructuralRowChanges: vi.fn(() => []),
}));

function makeEditor(options: Record<string, unknown> = { trackedChanges: {} }): Editor {
  return {
    options,
    state: {
      doc: {
        content: { size: 100 },
        textBetween: vi.fn((_from: number, _to: number) => 'excerpt'),
      },
    },
  } as unknown as Editor;
}

function makeTrackMark(typeName: string, id: string, attrs: Record<string, unknown> = {}) {
  return {
    mark: {
      type: { name: typeName },
      attrs: { id, ...attrs },
    },
  };
}

describe('resolveTrackedChangeType', () => {
  it('returns insert when hasInsert is true', () => {
    expect(resolveTrackedChangeType({ hasInsert: true, hasDelete: false, hasFormat: false })).toBe('insert');
  });

  it('returns delete when only hasDelete is true', () => {
    expect(resolveTrackedChangeType({ hasInsert: false, hasDelete: true, hasFormat: false })).toBe('delete');
  });

  it('returns format when hasFormat is true', () => {
    expect(resolveTrackedChangeType({ hasInsert: false, hasDelete: false, hasFormat: true })).toBe('format');
  });

  it('returns format over insert/delete when hasFormat is true', () => {
    expect(resolveTrackedChangeType({ hasInsert: true, hasDelete: true, hasFormat: true })).toBe('format');
  });

  it('returns replacement when both hasInsert and hasDelete are true (no format)', () => {
    expect(resolveTrackedChangeType({ hasInsert: true, hasDelete: true, hasFormat: false })).toBe('replacement');
  });

  it('keeps whole-table revisions structural internally', () => {
    expect(
      resolveTrackedChangeType({
        hasInsert: false,
        hasDelete: false,
        hasFormat: false,
        structural: { side: 'insertion', subtype: 'table-insert' },
      }),
    ).toBe('structural');
  });
});

describe('groupTrackedChanges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('groups imported Word marks by source wrapper', () => {
    vi.mocked(getTrackChanges).mockReturnValue([
      { ...makeTrackMark(TrackInsertMarkName, 'tc-1', { sourceId: '11' }), from: 1, to: 5 },
      { ...makeTrackMark(TrackDeleteMarkName, 'tc-1', { sourceId: '10' }), from: 5, to: 10 },
    ] as never);

    const editor = makeEditor();
    const grouped = groupTrackedChanges(editor);

    expect(grouped).toHaveLength(2);
    expect(grouped[0]?.rawId).toBe(`word:${TrackInsertMarkName}:11`);
    expect(grouped[0]?.id).toBe(`word:${TrackInsertMarkName}:11`);
    expect(grouped[0]?.commandRawId).toBe('tc-1');
    expect(grouped[0]?.hasInsert).toBe(true);
    expect(grouped[0]?.hasDelete).toBe(false);
    expect(grouped[0]?.wordRevisionIds).toEqual({ insert: '11' });
    expect(grouped[1]?.rawId).toBe(`word:${TrackDeleteMarkName}:10`);
    expect(grouped[1]?.id).toBe(`word:${TrackDeleteMarkName}:10`);
    expect(grouped[1]?.commandRawId).toBe('tc-1');
    expect(grouped[1]?.hasInsert).toBe(false);
    expect(grouped[1]?.hasDelete).toBe(true);
    expect(grouped[1]?.wordRevisionIds).toEqual({ delete: '10' });
  });

  it('groups native marks by raw id', () => {
    vi.mocked(getTrackChanges).mockReturnValue([
      { ...makeTrackMark(TrackInsertMarkName, 'tc-1'), from: 1, to: 5 },
      { ...makeTrackMark(TrackDeleteMarkName, 'tc-1'), from: 5, to: 10 },
    ] as never);

    const grouped = groupTrackedChanges(makeEditor());

    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.rawId).toBe('tc-1');
    expect(grouped[0]?.id).toBe('tc-1');
    expect(grouped[0]?.from).toBe(1);
    expect(grouped[0]?.to).toBe(10);
    expect(grouped[0]?.hasInsert).toBe(true);
    expect(grouped[0]?.hasDelete).toBe(true);
  });

  it('keeps separate entries for different raw ids', () => {
    vi.mocked(getTrackChanges).mockReturnValue([
      { ...makeTrackMark(TrackInsertMarkName, 'tc-1'), from: 1, to: 5 },
      { ...makeTrackMark(TrackDeleteMarkName, 'tc-2'), from: 6, to: 10 },
    ] as never);

    const grouped = groupTrackedChanges(makeEditor());
    expect(grouped).toHaveLength(2);
  });

  it('keeps stable ids tied to the logical grouped raw id', () => {
    vi.mocked(getTrackChanges).mockReturnValue([
      { ...makeTrackMark(TrackInsertMarkName, 'tc-1', { author: 'Ada' }), from: 2, to: 5 },
    ] as never);

    const editor = makeEditor();
    const first = groupTrackedChanges(editor);
    // Force cache invalidation by changing doc reference
    (editor.state as { doc: unknown }).doc = {
      ...editor.state.doc,
      textBetween: vi.fn(() => 'excerpt'),
    };
    const second = groupTrackedChanges(editor);

    expect(first[0]?.id).toBe('tc-1');
    expect(second[0]?.id).toBe('tc-1');
  });

  it('caches results by document reference', () => {
    vi.mocked(getTrackChanges).mockReturnValue([
      { ...makeTrackMark(TrackInsertMarkName, 'tc-1'), from: 1, to: 5 },
    ] as never);

    const editor = makeEditor();
    const first = groupTrackedChanges(editor);
    const second = groupTrackedChanges(editor);

    expect(first).toBe(second);
    expect(vi.mocked(getTrackChanges)).toHaveBeenCalledTimes(1);
  });

  it('returns empty array when no tracked marks exist', () => {
    vi.mocked(getTrackChanges).mockReturnValue([] as never);
    expect(groupTrackedChanges(makeEditor())).toEqual([]);
  });

  it('skips marks without an id', () => {
    vi.mocked(getTrackChanges).mockReturnValue([
      { mark: { type: { name: TrackInsertMarkName }, attrs: {} }, from: 1, to: 5 },
    ] as never);

    expect(groupTrackedChanges(makeEditor())).toEqual([]);
  });

  it('detects format marks', () => {
    vi.mocked(getTrackChanges).mockReturnValue([
      { ...makeTrackMark(TrackFormatMarkName, 'tc-1', { sourceId: '22' }), from: 1, to: 5 },
    ] as never);

    const grouped = groupTrackedChanges(makeEditor());
    expect(grouped[0]?.hasFormat).toBe(true);
    expect(grouped[0]?.hasInsert).toBe(false);
    expect(grouped[0]?.hasDelete).toBe(false);
    expect(grouped[0]?.wordRevisionIds).toEqual({ format: '22' });
  });

  it('serializes a tracked tab node as a literal tab in the excerpt (SD-3376)', () => {
    const insert = makeTrackMark(TrackInsertMarkName, 'tab-1', { author: 'Ada' });
    // Tab has no `.text`; excerpt uses tab-aware extraction.
    const tabNode = { type: { name: 'tab' }, marks: [insert.mark] };
    vi.mocked(getTrackChanges).mockReturnValue([{ ...insert, node: tabNode, from: 2, to: 3 }] as never);

    const editor = makeEditor();
    const doc = editor.state.doc as unknown as {
      textBetween: (from: number, to: number, sep: string, leaf: string) => string;
      nodesBetween: (from: number, to: number, cb: (node: unknown, pos: number) => unknown) => void;
    };
    // PM textBetween omits non-leaf tabs.
    doc.textBetween = vi.fn(() => '');
    doc.nodesBetween = (_from, _to, cb) => {
      cb({ type: { name: 'tab' }, isText: false }, 2);
    };

    const grouped = groupTrackedChanges(editor);
    expect(grouped[0]?.excerpt).toBe('\t');
  });

  it('preserves empty parent Word wrappers when the only text belongs to a child deletion', () => {
    const parent = makeTrackMark(TrackInsertMarkName, 'parent', { sourceId: '2', author: 'Missy Fox' });
    const child = makeTrackMark(TrackDeleteMarkName, 'child', {
      sourceId: '3',
      author: 'Vivienne Salisbury',
      overlapParentId: 'parent',
    });
    const node = { text: 'XYZ', marks: [parent.mark, child.mark] };
    vi.mocked(getTrackChanges).mockReturnValue([
      { ...parent, node, from: 1, to: 4 },
      { ...child, node, from: 1, to: 4 },
    ] as never);

    const grouped = groupTrackedChanges(makeEditor());
    const parentChange = grouped.find((change) => change.wordRevisionIds?.insert === '2');
    const childChange = grouped.find((change) => change.wordRevisionIds?.delete === '3');

    expect(parentChange?.excerpt).toBe('');
    expect(childChange?.excerpt).toBe('XYZ');
  });

  it('keeps live parent insertion text when a child deletion overlaps it', () => {
    const parent = makeTrackMark(TrackInsertMarkName, 'parent', { author: 'Live Author' });
    const child = makeTrackMark(TrackDeleteMarkName, 'child', {
      author: 'Second Author',
      overlapParentId: 'parent',
    });
    const node = { text: 'review', marks: [parent.mark, child.mark] };
    vi.mocked(getTrackChanges).mockReturnValue([
      { ...parent, node, from: 1, to: 7 },
      { ...child, node, from: 1, to: 7 },
    ] as never);

    const grouped = groupTrackedChanges(makeEditor());
    const parentChange = grouped.find((change) => change.rawId === 'parent');
    const childChange = grouped.find((change) => change.rawId === 'child');

    expect(parentChange?.excerpt).toBe('review');
    expect(childChange?.excerpt).toBe('review');
  });

  it('attaches overlap visual layers to the parent insertion with child deletion as the context target', () => {
    const parent = makeTrackMark(TrackInsertMarkName, 'parent-overlap', { author: 'Insert Author' });
    const child = makeTrackMark(TrackDeleteMarkName, 'child-overlap', {
      author: 'Delete Author',
      overlapParentId: 'parent-overlap',
    });
    const node = { text: 'review', marks: [parent.mark, child.mark] };
    vi.mocked(getTrackChanges).mockReturnValue([
      { ...child, node, from: 1, to: 7 },
      { ...parent, node, from: 1, to: 7 },
    ] as never);

    const grouped = groupTrackedChanges(makeEditor());
    const parentChange = grouped.find((change) => change.rawId === 'parent-overlap');
    const childChange = grouped.find((change) => change.rawId === 'child-overlap');

    expect(parentChange).toBeDefined();
    expect(childChange).toBeDefined();
    expect(parentChange!.overlap?.visualLayers).toEqual([
      {
        id: parentChange!.id,
        rawId: 'parent-overlap',
        commandRawId: 'parent-overlap',
        type: 'insert',
        relationship: 'parent',
      },
      {
        id: childChange!.id,
        rawId: 'child-overlap',
        commandRawId: 'child-overlap',
        type: 'delete',
        relationship: 'child',
      },
    ]);
    expect(parentChange!.overlap?.preferredContextTargetId).toBe(childChange!.id);
    expect(parentChange!.overlap?.preferredContextTarget).toEqual({
      id: childChange!.id,
      rawId: 'child-overlap',
      commandRawId: 'child-overlap',
      type: 'delete',
      relationship: 'child',
    });
    expect(childChange!.overlap).toBeUndefined();
  });

  it('preserves significant Word revision whitespace in explicit excerpts', () => {
    const mark = makeTrackMark(TrackDeleteMarkName, 'delete-with-space', { sourceId: '4' });
    vi.mocked(getTrackChanges).mockReturnValue([
      { ...mark, node: { text: 'O ', marks: [mark.mark] }, from: 1, to: 3 },
    ] as never);

    const grouped = groupTrackedChanges(makeEditor());
    expect(grouped[0]?.excerpt).toBe('O ');
  });

  it('does not duplicate excerpt text for overlapping imported format marks', () => {
    const mark = makeTrackMark(TrackFormatMarkName, 'format', { sourceId: '1' });
    vi.mocked(getTrackChanges).mockReturnValue([
      { ...mark, node: { text: 'Format ', marks: [mark.mark] }, from: 2, to: 9 },
      { ...mark, from: 1, to: 10 },
    ] as never);

    const editor = makeEditor();
    vi.mocked(editor.state.doc.textBetween).mockReturnValue('Format ');

    const grouped = groupTrackedChanges(editor);

    expect(grouped[0]?.rawId).toBe(`word:${TrackFormatMarkName}:1`);
    expect(grouped[0]?.excerpt).toBe('Format ');
  });

  it('sorts results by from position', () => {
    vi.mocked(getTrackChanges).mockReturnValue([
      { ...makeTrackMark(TrackInsertMarkName, 'tc-2'), from: 10, to: 15 },
      { ...makeTrackMark(TrackDeleteMarkName, 'tc-1'), from: 1, to: 5 },
    ] as never);

    const grouped = groupTrackedChanges(makeEditor());
    expect(grouped[0]?.from).toBeLessThan(grouped[1]?.from ?? 0);
  });

  // A whole inserted/deleted table is ONE logical change. Inline cell marks
  // inside its range (native authoring stamps these, and imported-with-text
  // tables carry them) must be subsumed by the structural change, not returned
  // as separate review items.
  const wholeTableInsert = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 'logical-1',
      side: 'insertion',
      subtype: 'table-insert',
      tableFrom: 10,
      tableTo: 40,
      tablePos: 10,
      wholeTable: true,
      decidable: true,
      rows: [],
      author: 'Alice',
      sourceId: '7',
      ...overrides,
    }) as never;

  it('subsumes inline cell marks inside a decidable whole-table change', () => {
    const cell = makeTrackMark(TrackInsertMarkName, 'inline-cell', { author: 'Alice' });
    vi.mocked(getTrackChanges).mockReturnValue([
      { ...cell, node: { text: 'Hi', marks: [cell.mark] }, from: 20, to: 25 },
    ] as never);
    vi.mocked(enumerateStructuralRowChanges).mockReturnValueOnce([wholeTableInsert()]);

    const grouped = groupTrackedChanges(makeEditor());

    // Only the structural change remains; the inline cell mark is owned by it.
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.id).toBe('word:structural:7');
    expect(grouped.find((change) => change.rawId === 'inline-cell')).toBeUndefined();
  });

  it('does NOT subsume an inline change outside the whole-table range', () => {
    const outside = makeTrackMark(TrackInsertMarkName, 'inline-outside', { author: 'Alice' });
    vi.mocked(getTrackChanges).mockReturnValue([
      { ...outside, node: { text: 'Out', marks: [outside.mark] }, from: 50, to: 55 },
    ] as never);
    vi.mocked(enumerateStructuralRowChanges).mockReturnValueOnce([wholeTableInsert()]);

    const grouped = groupTrackedChanges(makeEditor());

    // The structural change AND the unrelated inline change both surface.
    expect(grouped.find((change) => change.id === 'word:structural:7')).toBeDefined();
    expect(grouped.find((change) => change.rawId === 'inline-outside')).toBeDefined();
  });

  it('does NOT subsume inline marks for a NON-decidable (partial) structural shape', () => {
    const cell = makeTrackMark(TrackInsertMarkName, 'inline-partial', { author: 'Alice' });
    vi.mocked(getTrackChanges).mockReturnValue([
      { ...cell, node: { text: 'Hi', marks: [cell.mark] }, from: 20, to: 25 },
    ] as never);
    // Partial / undecidable structural shape is not one logical change.
    vi.mocked(enumerateStructuralRowChanges).mockReturnValueOnce([
      wholeTableInsert({ wholeTable: false, decidable: false }),
    ]);

    const grouped = groupTrackedChanges(makeEditor());
    expect(grouped.find((change) => change.rawId === 'inline-partial')).toBeDefined();
  });

  it('subsumes a single revision id whose disjoint segments each sit in a different whole table', () => {
    // One imported id reused across two tables: marks at [20,25] (table A 10-40)
    // and [70,75] (table B 60-90). The collapsed envelope [20,75] spans the gap
    // between the tables, so an envelope-only check would wrongly keep it — the
    // per-segment rule correctly subsumes it (every segment is table-owned).
    const shared = makeTrackMark(TrackInsertMarkName, 'shared-across-tables', { author: 'Alice' });
    vi.mocked(getTrackChanges).mockReturnValue([
      { ...shared, node: { text: 'A', marks: [shared.mark] }, from: 20, to: 25 },
      { ...shared, node: { text: 'B', marks: [shared.mark] }, from: 70, to: 75 },
    ] as never);
    vi.mocked(enumerateStructuralRowChanges).mockReturnValueOnce([
      wholeTableInsert({ id: 'logical-a', sourceId: '7', tableFrom: 10, tableTo: 40, tablePos: 10 }),
      wholeTableInsert({ id: 'logical-b', sourceId: '8', tableFrom: 60, tableTo: 90, tablePos: 60 }),
    ]);

    const grouped = groupTrackedChanges(makeEditor());
    expect(grouped.find((change) => change.rawId === 'shared-across-tables')).toBeUndefined();
    // Both structural tables survive.
    expect(grouped.filter((change) => change.id?.startsWith('word:structural:'))).toHaveLength(2);
  });

  it('does NOT subsume an inline change whose segment straddles a table edge', () => {
    // Segment [35,45] crosses the table's right edge (table 10-40): it is not
    // wholly inside any whole-table range, so the change is kept.
    const straddle = makeTrackMark(TrackInsertMarkName, 'edge-straddle', { author: 'Alice' });
    vi.mocked(getTrackChanges).mockReturnValue([
      { ...straddle, node: { text: 'edge', marks: [straddle.mark] }, from: 35, to: 45 },
    ] as never);
    vi.mocked(enumerateStructuralRowChanges).mockReturnValueOnce([wholeTableInsert()]);

    const grouped = groupTrackedChanges(makeEditor());
    expect(grouped.find((change) => change.rawId === 'edge-straddle')).toBeDefined();
  });
});

describe('groupTrackedChanges: coalescing same-type imported chains', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('merges same-id, same-pure-type imported drafts that differ only by sourceId', () => {
    // Mirrors the noBreakHyphen-split repro: the importer's same-type
    // chaining already gives these three marks one shared `id`, but each
    // still carries its own original `sourceId` (Word's per-run w:id).
    vi.mocked(getTrackChanges).mockReturnValue([
      { ...makeTrackMark(TrackInsertMarkName, 'shared-uuid', { sourceId: '1' }), from: 1, to: 5 },
      { ...makeTrackMark(TrackInsertMarkName, 'shared-uuid', { sourceId: '2' }), from: 5, to: 10 },
      { ...makeTrackMark(TrackInsertMarkName, 'shared-uuid', { sourceId: '3' }), from: 10, to: 15 },
    ] as never);

    const grouped = groupTrackedChanges(makeEditor());

    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.from).toBe(1);
    expect(grouped[0]?.to).toBe(15);
    expect(grouped[0]?.hasInsert).toBe(true);
    expect(grouped[0]?.hasDelete).toBe(false);
  });

  it('does not merge across unrelated ids even when both chains are pure inserts', () => {
    vi.mocked(getTrackChanges).mockReturnValue([
      { ...makeTrackMark(TrackInsertMarkName, 'chain-a', { sourceId: '1' }), from: 1, to: 5 },
      { ...makeTrackMark(TrackInsertMarkName, 'chain-a', { sourceId: '2' }), from: 5, to: 10 },
      { ...makeTrackMark(TrackInsertMarkName, 'chain-b', { sourceId: '9' }), from: 20, to: 25 },
    ] as never);

    const grouped = groupTrackedChanges(makeEditor());

    expect(grouped).toHaveLength(2);
  });

  it('does not merge a replacement pair sharing an id (opposite pure types)', () => {
    // Regression guard for the coalescing pass specifically: a Word
    // replacement (one pure-insert + one pure-delete draft sharing an `id`)
    // must keep rendering as two cards.
    vi.mocked(getTrackChanges).mockReturnValue([
      { ...makeTrackMark(TrackInsertMarkName, 'shared-uuid', { sourceId: '11' }), from: 1, to: 5 },
      { ...makeTrackMark(TrackDeleteMarkName, 'shared-uuid', { sourceId: '10' }), from: 5, to: 10 },
    ] as never);

    const grouped = groupTrackedChanges(makeEditor());

    expect(grouped).toHaveLength(2);
  });

  it('does not touch native marks (no sourceId) sharing an id', () => {
    vi.mocked(getTrackChanges).mockReturnValue([
      { ...makeTrackMark(TrackInsertMarkName, 'tc-1'), from: 1, to: 5 },
      { ...makeTrackMark(TrackInsertMarkName, 'tc-1'), from: 5, to: 10 },
    ] as never);

    const grouped = groupTrackedChanges(makeEditor());

    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.rawId).toBe('tc-1');
  });
});

describe('resolveTrackedChange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('finds a grouped change by canonical id', () => {
    vi.mocked(getTrackChanges).mockReturnValue([
      { ...makeTrackMark(TrackInsertMarkName, 'tc-1'), from: 1, to: 5 },
    ] as never);

    const editor = makeEditor();
    const grouped = groupTrackedChanges(editor);
    const id = grouped[0]?.id;
    expect(id).toBeDefined();

    const resolved = resolveTrackedChange(editor, id!);
    expect(resolved?.rawId).toBe('tc-1');
  });

  it('returns null for unknown ids', () => {
    vi.mocked(getTrackChanges).mockReturnValue([] as never);
    expect(resolveTrackedChange(makeEditor(), 'unknown')).toBeNull();
  });
});

describe('resolveTrackedChangeNavigationSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prefers the matching text node in the document over raw mark ranges', () => {
    const mark = makeTrackMark(TrackInsertMarkName, 'command-1', { sourceId: '132' });
    vi.mocked(getTrackChanges).mockReturnValue([
      { ...mark, node: { text: 'fallback', marks: [mark.mark] }, from: 1847, to: 1853 },
    ] as never);
    const editor = makeEditor();
    const nodesBetween = vi.fn((_from: number, _to: number, callback: (node: unknown, pos: number) => void) => {
      callback({ isText: true, text: 'Buying', marks: [mark.mark] }, 1847);
    });
    (editor.state.doc as unknown as { nodesBetween: typeof nodesBetween }).nodesBetween = nodesBetween;

    expect(resolveTrackedChangeNavigationSelection(editor, `word:${TrackInsertMarkName}:132`)).toEqual({
      from: 1848,
      to: 1848,
    });
    expect(nodesBetween).toHaveBeenCalledWith(1847, 1853, expect.any(Function));
  });

  it('chooses the requested adjacent Word revision instead of a neighboring boundary mark', () => {
    const first = makeTrackMark(TrackInsertMarkName, 'command-1', { sourceId: '132' });
    const second = makeTrackMark(TrackInsertMarkName, 'command-2', { sourceId: '133' });
    vi.mocked(getTrackChanges).mockReturnValue([
      { ...first, node: { text: 'Buy', marks: [first.mark] }, from: 10, to: 13 },
      { ...second, node: { text: 'ing', marks: [second.mark] }, from: 13, to: 16 },
    ] as never);
    const editor = makeEditor();
    (editor.state.doc as unknown as { nodesBetween: unknown }).nodesBetween = vi.fn(
      (_from: number, _to: number, callback: (node: unknown, pos: number) => boolean | void) => {
        callback({ isText: true, text: 'Buy', marks: [first.mark] }, 10);
        callback({ isText: true, text: 'ing', marks: [second.mark] }, 13);
      },
    );

    expect(resolveTrackedChangeNavigationSelection(editor, `word:${TrackInsertMarkName}:133`)).toEqual({
      from: 14,
      to: 14,
    });
  });

  it('chooses the requested overlapping child revision when parent and child share text', () => {
    const parent = makeTrackMark(TrackInsertMarkName, 'parent-overlap', { sourceId: '132' });
    const child = makeTrackMark(TrackDeleteMarkName, 'child-overlap', {
      sourceId: '133',
      overlapParentId: 'parent-overlap',
    });
    const node = { text: 'review', marks: [parent.mark, child.mark] };
    vi.mocked(getTrackChanges).mockReturnValue([
      { ...parent, node, from: 20, to: 26 },
      { ...child, node, from: 20, to: 26 },
    ] as never);
    const editor = makeEditor();
    (editor.state.doc as unknown as { nodesBetween: unknown }).nodesBetween = vi.fn(
      (_from: number, _to: number, callback: (node: unknown, pos: number) => boolean | void) => {
        callback(node, 20);
      },
    );

    expect(resolveTrackedChangeNavigationSelection(editor, `word:${TrackDeleteMarkName}:133`)).toEqual({
      from: 21,
      to: 21,
    });
  });

  it('uses an interior collapsed caret for multi-character text changes', () => {
    const mark = makeTrackMark(TrackInsertMarkName, 'tc-1', { sourceId: '132' });
    vi.mocked(getTrackChanges).mockReturnValue([
      { ...mark, node: { text: 'review', marks: [mark.mark] }, from: 1847, to: 1853 },
    ] as never);

    expect(resolveTrackedChangeNavigationSelection(makeEditor(), `word:${TrackInsertMarkName}:132`)).toEqual({
      from: 1848,
      to: 1848,
    });
  });

  it('falls back to the raw mark range when no document text node matches', () => {
    const mark = makeTrackMark(TrackInsertMarkName, 'tc-1', { sourceId: '132' });
    vi.mocked(getTrackChanges).mockReturnValue([{ ...mark, from: 1847, to: 1853 }] as never);
    const editor = makeEditor();
    (editor.state.doc as unknown as { nodesBetween: unknown }).nodesBetween = vi.fn();

    expect(resolveTrackedChangeNavigationSelection(editor, `word:${TrackInsertMarkName}:132`)).toEqual({
      from: 1848,
      to: 1848,
    });
  });

  it('uses a non-empty text selection for one-character text changes', () => {
    const mark = makeTrackMark(TrackInsertMarkName, 'tc-1');
    vi.mocked(getTrackChanges).mockReturnValue([
      { ...mark, node: { text: 'x', marks: [mark.mark] }, from: 10, to: 11 },
    ] as never);

    expect(resolveTrackedChangeNavigationSelection(makeEditor(), 'tc-1')).toEqual({ from: 10, to: 11 });
  });

  it('returns null for structural changes so rendered-element fallback can handle them', () => {
    vi.mocked(getTrackChanges).mockReturnValue([] as never);
    vi.mocked(enumerateStructuralRowChanges).mockReturnValueOnce([
      {
        id: 'logical-1',
        side: 'insertion',
        subtype: 'table-insert',
        tableFrom: 10,
        tableTo: 40,
        tablePos: 10,
        wholeTable: true,
        decidable: true,
        rows: [],
        author: 'Alice',
        sourceId: '7',
      },
    ] as never);

    expect(resolveTrackedChangeNavigationSelection(makeEditor(), 'word:structural:7')).toBeNull();
  });
});

describe('toCanonicalTrackedChangeId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps a raw id to its canonical stable id', () => {
    vi.mocked(getTrackChanges).mockReturnValue([
      { ...makeTrackMark(TrackInsertMarkName, 'tc-1'), from: 1, to: 5 },
    ] as never);

    const editor = makeEditor();
    const canonical = toCanonicalTrackedChangeId(editor, 'tc-1');
    expect(typeof canonical).toBe('string');
    expect(canonical).toBe('tc-1');
  });

  it('returns null for unknown raw ids', () => {
    vi.mocked(getTrackChanges).mockReturnValue([] as never);
    expect(toCanonicalTrackedChangeId(makeEditor(), 'missing')).toBeNull();
  });
});

describe('buildTrackedChangeCanonicalIdMap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps both raw id and canonical id to canonical id', () => {
    vi.mocked(getTrackChanges).mockReturnValue([
      { ...makeTrackMark(TrackInsertMarkName, 'tc-1'), from: 1, to: 5 },
    ] as never);

    const editor = makeEditor();
    const map = buildTrackedChangeCanonicalIdMap(editor);
    const grouped = groupTrackedChanges(editor);
    const canonicalId = grouped[0]?.id;

    expect(map.get('tc-1')).toBe(canonicalId);
    expect(map.get(canonicalId!)).toBe(canonicalId);
  });

  it('does not map shared Word command ids as unique span aliases', () => {
    vi.mocked(getTrackChanges).mockReturnValue([
      { ...makeTrackMark(TrackInsertMarkName, 'tc-1', { sourceId: '11' }), from: 1, to: 5 },
      { ...makeTrackMark(TrackDeleteMarkName, 'tc-1', { sourceId: '10' }), from: 5, to: 10 },
    ] as never);

    const editor = makeEditor();
    const map = buildTrackedChangeCanonicalIdMap(editor);
    const grouped = groupTrackedChanges(editor);
    const insertChange = grouped.find((change) => change.rawId === `word:${TrackInsertMarkName}:11`);
    const deleteChange = grouped.find((change) => change.rawId === `word:${TrackDeleteMarkName}:10`);

    expect(insertChange).toBeDefined();
    expect(deleteChange).toBeDefined();
    expect(map.get(`word:${TrackInsertMarkName}:11`)).toBe(insertChange!.id);
    expect(map.get(`word:${TrackDeleteMarkName}:10`)).toBe(insertChange!.id);
    expect(map.get('tc-1')).toBe(insertChange!.id);
  });

  it('keeps split replacement aliases separate in independent mode', () => {
    vi.mocked(getTrackChanges).mockReturnValue([
      { ...makeTrackMark(TrackInsertMarkName, 'tc-1', { sourceId: '11' }), from: 1, to: 5 },
      { ...makeTrackMark(TrackDeleteMarkName, 'tc-1', { sourceId: '10' }), from: 5, to: 10 },
    ] as never);

    const editor = makeEditor({ trackedChanges: { replacements: 'independent' } });
    const map = buildTrackedChangeCanonicalIdMap(editor);
    const grouped = groupTrackedChanges(editor);
    const insertChange = grouped.find((change) => change.rawId === `word:${TrackInsertMarkName}:11`);
    const deleteChange = grouped.find((change) => change.rawId === `word:${TrackDeleteMarkName}:10`);

    expect(insertChange).toBeDefined();
    expect(deleteChange).toBeDefined();
    expect(map.get(`word:${TrackInsertMarkName}:11`)).toBe(insertChange!.id);
    expect(map.get(`word:${TrackDeleteMarkName}:10`)).toBe(deleteChange!.id);
    expect(map.get('tc-1')).toBe(deleteChange!.id);
  });

  it('returns empty map when no tracked changes exist', () => {
    vi.mocked(getTrackChanges).mockReturnValue([] as never);
    expect(buildTrackedChangeCanonicalIdMap(makeEditor()).size).toBe(0);
  });
});
