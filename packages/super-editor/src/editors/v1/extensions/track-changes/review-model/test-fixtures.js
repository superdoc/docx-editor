// @ts-check
/**
 * Test fixture helpers for the review graph.
 *
 * Plan: v1-3220 / phase0-002 ("Tests"). These helpers exist so unit tests
 * can build tracked mark configurations against a real PM
 * schema without each test re-inventing the boilerplate.
 *
 * Not exported from the public package surface — they are internal test
 * affordances. The eventual cross-feature fixture corpus owned by
 * overlap fixture coverage lives under `extensions/track-changes/fixtures/`.
 */

import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { TrackInsertMarkName, TrackDeleteMarkName, TrackFormatMarkName } from '../constants.js';

/** @type {Record<string, import('prosemirror-model').NodeSpec>} */
const NODES = {
  doc: { content: 'block+' },
  paragraph: {
    content: 'inline*',
    group: 'block',
    // paragraphProperties carries a tracked w:pPrChange record on the node attr
    // (numbering/alignment revisions) — mirrors the production paragraph node so
    // the pPrChange enumerator can find one in tests. markTrackChange carries
    // the paragraph MARK's own tracked deletion (w:pPr/w:rPr/w:del) so
    // whole-block deletion decisions can be exercised here too.
    attrs: { paragraphProperties: { default: null }, markTrackChange: { default: null } },
    parseDOM: [{ tag: 'p' }],
    toDOM: () => ['p', 0],
  },
  // Minimal table family for structural (whole-table) tracked-change tests.
  table: {
    content: 'tableRow+',
    group: 'block',
    isolating: true,
    parseDOM: [{ tag: 'table' }],
    toDOM: () => ['table', ['tbody', 0]],
  },
  tableRow: {
    content: 'tableCell+',
    attrs: { trackChange: { default: null } },
    parseDOM: [{ tag: 'tr' }],
    toDOM: () => ['tr', 0],
  },
  tableCell: {
    content: 'block+',
    isolating: true,
    parseDOM: [{ tag: 'td' }],
    toDOM: () => ['td', 0],
  },
  text: { group: 'inline' },
  // Production-shaped tab node (non-leaf atom) for excerpt tests (SD-3376).
  tab: {
    inline: true,
    atom: true,
    group: 'inline',
    content: 'inline*',
    parseDOM: [{ tag: 'span.sd-editor-tab' }],
    toDOM: () => ['span', { class: 'sd-editor-tab' }, 0],
  },
  noBreakHyphen: {
    inline: true,
    atom: true,
    group: 'inline',
    leafText: () => '\u2011',
    parseDOM: [{ tag: 'span.sd-no-break-hyphen' }],
    toDOM: () => ['span', { class: 'sd-no-break-hyphen' }, '\u2011'],
  },
  genericLeaf: {
    inline: true,
    atom: true,
    group: 'inline',
    parseDOM: [{ tag: 'span.sd-generic-leaf' }],
    toDOM: () => ['span', { class: 'sd-generic-leaf' }],
  },
};

const MARK_DEFS_WITH_GRAPH_ATTRS = {
  id: { default: '' },
  author: { default: '' },
  authorId: { default: '' },
  authorEmail: { default: '' },
  authorImage: { default: '' },
  date: { default: '' },
  sourceId: { default: '' },
  importedAuthor: { default: '' },
  revisionGroupId: { default: '' },
  splitFromId: { default: '' },
  changeType: { default: '' },
  replacementGroupId: { default: '' },
  replacementSideId: { default: '' },
  overlapParentId: { default: '' },
  sourceIds: { default: null },
  origin: { default: '' },
};

const MARKS = {
  [TrackInsertMarkName]: {
    inclusive: false,
    attrs: MARK_DEFS_WITH_GRAPH_ATTRS,
  },
  [TrackDeleteMarkName]: {
    inclusive: false,
    attrs: MARK_DEFS_WITH_GRAPH_ATTRS,
  },
  [TrackFormatMarkName]: {
    inclusive: false,
    attrs: {
      ...MARK_DEFS_WITH_GRAPH_ATTRS,
      before: { default: [] },
      after: { default: [] },
    },
  },
};

/**
 * A minimal PM schema sufficient for review-graph unit tests. Mirrors the
 * tracked-change mark shape used in production; consumers needing a richer
 * schema can use `initTestEditor` from the package tests helpers instead.
 */
export const createReviewGraphTestSchema = () => new Schema({ nodes: NODES, marks: MARKS });

/**
 * @typedef {Object} TextSpanSpec
 * @property {string} text
 * @property {Array<{ markType: 'trackInsert'|'trackDelete'|'trackFormat', attrs: Record<string, unknown> }>} [marks]
 */

/**
 * Build an EditorState containing one paragraph composed of the given
 * tracked text spans. Positions inside the resulting doc are stable and
 * documented:
 *
 *   pos 0           = before doc
 *   pos 1           = inside paragraph, before first inline content
 *   pos 1 + offset  = inside paragraph at character offset
 *
 * @param {{ schema: Schema, spans: TextSpanSpec[] }} input
 * @returns {{ state: EditorState, schema: Schema, paragraphStart: number }}
 */
export const stateFromTrackedSpans = ({ schema, spans }) => {
  const inlineNodes = spans.map(({ text, marks = [] }) => {
    const pmMarks = marks.map(({ markType, attrs }) => schema.marks[markType].create(attrs));
    return schema.text(text, pmMarks);
  });

  const paragraph = schema.nodes.paragraph.create({}, inlineNodes);
  const doc = schema.nodes.doc.create({}, [paragraph]);
  const state = EditorState.create({ schema, doc });
  return { state, schema, paragraphStart: 1 };
};

/**
 * Build an EditorState with a leading paragraph, a single-row table whose row
 * carries a structural `trackChange` attr, and a trailing paragraph. Mirrors
 * the imported shape of the Word whole-table insert/delete fixtures.
 *
 * @param {{
 *   schema: Schema,
 *   trackChange: { type: 'rowInsert'|'rowDelete', id: string, [k: string]: unknown },
 *   rowCount?: number,
 *   cellText?: string,
 *   cellParagraphAttrs?: Record<string, unknown>,
 * }} input
 * @returns {{ state: EditorState, schema: Schema, tablePos: number }}
 */
export const stateWithTrackedTable = ({
  schema,
  trackChange,
  rowCount = 1,
  cellText = 'Cell',
  cellParagraphAttrs = {},
}) => {
  const makeRow = () => {
    const cellParagraph = schema.nodes.paragraph.create(cellParagraphAttrs, [schema.text(cellText)]);
    const cell = schema.nodes.tableCell.create({}, [cellParagraph]);
    return schema.nodes.tableRow.create({ trackChange }, [cell]);
  };
  const rows = Array.from({ length: rowCount }, makeRow);
  const table = schema.nodes.table.create({}, rows);
  const before = schema.nodes.paragraph.create({}, [schema.text('Before.')]);
  const after = schema.nodes.paragraph.create({}, [schema.text('After.')]);
  const doc = schema.nodes.doc.create({}, [before, table, after]);
  const state = EditorState.create({ schema, doc });
  // before paragraph = "Before." → nodeSize 9 (pos 0..8 inclusive open/close).
  const tablePos = before.nodeSize;
  return { state, schema, tablePos };
};

/**
 * Build a doc with a table whose rows carry per-row `trackChange` attrs (or
 * `null`). Mirrors a real Word whole-table insert where each row gets a
 * DISTINCT `w:id`, and supports partial / mixed-side / untracked-row shapes.
 *
 * @param {{
 *   schema: Schema,
 *   rowTrackChanges: Array<Record<string, unknown> | null>,
 *   cellText?: string,
 *   trailing?: boolean,
 * }} input
 * @returns {{ state: EditorState, schema: Schema, tablePos: number }}
 */
export const stateWithPerRowTrackedTable = ({ schema, rowTrackChanges, cellText = 'Cell', trailing = true }) => {
  const rows = rowTrackChanges.map((trackChange) => {
    const cellParagraph = schema.nodes.paragraph.create({}, [schema.text(cellText)]);
    const cell = schema.nodes.tableCell.create({}, [cellParagraph]);
    return schema.nodes.tableRow.create({ trackChange: trackChange ?? null }, [cell]);
  });
  const table = schema.nodes.table.create({}, rows);
  const before = schema.nodes.paragraph.create({}, [schema.text('Before.')]);
  const children = trailing
    ? [before, table, schema.nodes.paragraph.create({}, [schema.text('After.')])]
    : [before, table];
  const doc = schema.nodes.doc.create({}, children);
  const state = EditorState.create({ schema, doc });
  const tablePos = before.nodeSize;
  return { state, schema, tablePos };
};

/**
 * Build a doc with two independent tracked tables, optionally sharing the same
 * Word revision id, so identity/table-scoping can be exercised.
 *
 * @param {{
 *   schema: Schema,
 *   first: Record<string, unknown>,
 *   second: Record<string, unknown>,
 * }} input
 * @returns {{ state: EditorState, schema: Schema, firstTablePos: number, secondTablePos: number }}
 */
export const stateWithTwoTrackedTables = ({ schema, first, second }) => {
  const makeTable = (trackChange) => {
    const cellParagraph = schema.nodes.paragraph.create({}, [schema.text('Cell')]);
    const cell = schema.nodes.tableCell.create({}, [cellParagraph]);
    const row = schema.nodes.tableRow.create({ trackChange }, [cell]);
    return schema.nodes.table.create({}, [row]);
  };
  const before = schema.nodes.paragraph.create({}, [schema.text('Before.')]);
  const mid = schema.nodes.paragraph.create({}, [schema.text('Middle.')]);
  const after = schema.nodes.paragraph.create({}, [schema.text('After.')]);
  const t1 = makeTable(first);
  const t2 = makeTable(second);
  const doc = schema.nodes.doc.create({}, [before, t1, mid, t2, after]);
  const state = EditorState.create({ schema, doc });
  const firstTablePos = before.nodeSize;
  const secondTablePos = before.nodeSize + t1.nodeSize + mid.nodeSize;
  return { state, schema, firstTablePos, secondTablePos };
};

/**
 * Build a tracked-mark attrs blob with sensible defaults so test
 * declarations stay short.
 *
 * @param {Partial<Record<string, unknown>> & { id: string }} attrs
 * @returns {Record<string, unknown>}
 */
export const markAttrs = (attrs) => ({
  id: '',
  author: '',
  authorId: '',
  authorEmail: '',
  authorImage: '',
  date: '',
  sourceId: '',
  importedAuthor: '',
  revisionGroupId: '',
  splitFromId: '',
  changeType: '',
  replacementGroupId: '',
  replacementSideId: '',
  overlapParentId: '',
  sourceIds: null,
  origin: '',
  ...attrs,
});
