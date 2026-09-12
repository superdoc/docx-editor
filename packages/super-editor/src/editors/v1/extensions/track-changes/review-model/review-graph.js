// @ts-check
/**
 * TrackedReviewGraph builder.
 *
 * Plan: v1-3220 / phase0-002 ("Graph Types").
 *
 * The graph is rebuilt from the current PM document whenever a tracked-change
 * operation needs semantic answers. It MUST be fully reconstructible from
 * marks; the cache below is an optional memoization layer keyed by editor +
 * doc identity that callers may discard at any time.
 *
 * Boundaries (phase0-001 "Non-Negotiable Boundaries"):
 * - the graph layer must not import document-api adapters, converter
 *   translators, comments UI, or PresentationEditor.
 * - consumers may call the graph; the graph remains below those adapters.
 */

import { TrackInsertMarkName, TrackDeleteMarkName, TrackFormatMarkName } from '../constants.js';
import { enumerateTrackedMarkSpans } from './segment-index.js';
import {
  CanonicalChangeType,
  ChangeSubtype,
  SegmentSide,
  readTrackedAttrs,
  normalizedAttrsEqual,
  subtypeFromChangeType,
  deterministicJson,
} from './mark-metadata.js';
import { BODY_STORY, buildStoryKey } from './story-locator.js';
import { enumerateStructuralRowChanges } from '../trackChangesHelpers/structuralRowChanges.js';
import { enumeratePprChanges } from '../trackChangesHelpers/pprChanges.js';
import { enumerateParagraphMarkDeletions } from '../trackChangesHelpers/paragraphMarkChanges.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} TrackedMarkRun
 * @property {number} from
 * @property {number} to
 * @property {import('prosemirror-model').Mark} mark
 */

/**
 * @typedef {Object} TrackedSegment
 * @property {string} segmentId
 * @property {string} changeId
 * @property {string} markType
 * @property {string} side             'inserted' | 'deleted' | 'formatting'.
 * @property {number} from
 * @property {number} to
 * @property {string} text
 * @property {import('prosemirror-model').Mark} mark
 * @property {Array<TrackedMarkRun>} markRuns
 * @property {import('./mark-metadata.js').NormalizedTrackedAttrs} attrs
 * @property {string} parentId
 * @property {string} parentSide
 * @property {'parent'|'child'|'standalone'} overlapRole
 * @property {boolean} [structural] True for a whole-table structural segment (no inline mark).
 * @property {boolean} [pprChange] True for a paragraph-property (w:pPrChange) segment (no inline mark).
 * @property {boolean} [paragraphMarkChange] True for a paragraph-mark deletion (w:pPr/w:rPr/w:del) segment on a block
 *   whose runs carry no mark of their own (no inline mark).
 * @property {Array<number>} [nodePath] optional diagnostics nodePath.
 */

/**
 * @typedef {Object} LogicalReplacementProjection
 * @property {string} groupId
 * @property {Array<TrackedSegment>} inserted
 * @property {Array<TrackedSegment>} deleted
 * @property {string} insertedSideId
 * @property {string} deletedSideId
 */

/**
 * @typedef {Object} LogicalTrackedChange
 * @property {string} id
 * @property {string} type
 * @property {string} subtype
 * @property {'open'} state
 * @property {Array<TrackedSegment>} segments
 * @property {Array<TrackedSegment>} coverageSegments
 * @property {Array<TrackedSegment>} insertedSegments
 * @property {Array<TrackedSegment>} deletedSegments
 * @property {Array<TrackedSegment>} formattingSegments
 * @property {LogicalReplacementProjection | null} replacement
 * @property {string} author
 * @property {string} authorId
 * @property {string} authorEmail
 * @property {string} authorImage
 * @property {string} date
 * @property {Record<string, unknown>} sourceIds
 * @property {string} revisionGroupId
 * @property {string} splitFromId
 * @property {string} sourcePlatform
 * @property {import('./story-locator.js').StoryLocator} story
 * @property {string|null} parent
 * @property {Array<string>} children
 * @property {Array<unknown>} before
 * @property {Array<unknown>} after
 * @property {string} excerpt
 */

/**
 * @typedef {Object} GraphDiagnostic
 * @property {string} code
 * @property {'info'|'warning'|'error'} severity
 * @property {string} message
 * @property {string[]} [changeIds]
 * @property {unknown} [details]
 */

/**
 * @typedef {Object} TrackedReviewGraph
 * @property {Map<string, LogicalTrackedChange>} changes
 * @property {Array<TrackedSegment>} segments
 * @property {Map<string, TrackedSegment>} bySegmentId
 * @property {Map<string, Array<string>>} byRevisionGroupId
 * @property {Map<string, Array<string>>} byReplacementGroupId
 * @property {Map<string, Array<string>>} byParentId
 * @property {import('./story-locator.js').StoryLocator} story
 * @property {(pos: number) => Array<TrackedSegment>} overlapAt
 * @property {(from: number, to: number) => Array<TrackedSegment>} segmentsInRange
 * @property {(from: number, to: number) => Array<LogicalTrackedChange>} changesInRange
 * @property {() => Array<GraphDiagnostic>} validate
 */

/**
 * Build (or fetch a cached) graph for one story editor.
 *
 * @param {{
 *   state: import('prosemirror-state').EditorState | { doc?: import('prosemirror-model').Node },
 *   story?: import('./story-locator.js').StoryLocator,
 *   replacementsMode?: 'paired'|'independent',
 * }} input
 * @returns {TrackedReviewGraph}
 */
export const buildReviewGraph = ({ state, story = BODY_STORY, replacementsMode = 'paired' }) => {
  const spans = enumerateTrackedMarkSpans(state);
  const structuralChanges = enumerateStructuralRowChanges(state);
  const pprChanges = enumeratePprChanges(state);
  const paragraphMarkChanges = enumerateParagraphMarkDeletions(state);
  return buildGraphFromSpans({
    spans,
    structuralChanges,
    pprChanges,
    paragraphMarkChanges,
    doc: state?.doc ?? null,
    story,
    replacementsMode,
  });
};

// ---------------------------------------------------------------------------
// Memoization
// ---------------------------------------------------------------------------

const graphCache = new WeakMap();
const NULL_DOC_KEY = '__nullDoc__';

/**
 * Memoized graph build keyed on editor identity + doc identity + story key.
 * The cache is discardable; callers can call `buildReviewGraph` directly.
 *
 * @param {{
 *   editor: object,
 *   state?: import('prosemirror-state').EditorState | { doc?: import('prosemirror-model').Node },
 *   story?: import('./story-locator.js').StoryLocator,
 *   replacementsMode?: 'paired'|'independent',
 * }} input
 * @returns {TrackedReviewGraph}
 */
export const getOrBuildReviewGraph = ({ editor, state, story = BODY_STORY, replacementsMode = 'paired' }) => {
  const effectiveState = state ?? /** @type {*} */ (editor)?.state ?? null;
  const storyKey = buildStoryKey(story);
  const doc = effectiveState?.doc ?? null;
  const docKey = doc ?? NULL_DOC_KEY;
  const cacheKey = `${storyKey}|${replacementsMode}`;

  let perEditor = graphCache.get(editor);
  if (!perEditor) {
    perEditor = new Map();
    graphCache.set(editor, perEditor);
  }

  const cached = perEditor.get(cacheKey);
  if (cached && cached.docKey === docKey) {
    return cached.graph;
  }

  const graph = buildReviewGraph({ state: effectiveState ?? { doc: null }, story, replacementsMode });
  perEditor.set(cacheKey, { docKey, graph });
  return graph;
};

/**
 * Discard any cached graphs for an editor. Tests and consumers can call this
 * to prove the graph is always reconstructible from marks.
 *
 * @param {object} editor
 */
export const invalidateReviewGraphCache = (editor) => {
  graphCache.delete(editor);
};

// ---------------------------------------------------------------------------
// Internal builder
// ---------------------------------------------------------------------------

const buildGraphFromSpans = ({
  spans,
  structuralChanges = [],
  pprChanges = [],
  paragraphMarkChanges = [],
  doc,
  story,
  replacementsMode,
}) => {
  /** @type {Array<{ attrs: import('./mark-metadata.js').NormalizedTrackedAttrs, span: import('./segment-index.js').TrackedMarkSpan }>} */
  const normalized = spans.map((span) => ({
    attrs: readTrackedAttrs(span.mark, span.mark.type.name),
    span,
  }));

  // 1. Merge adjacent equivalent mark spans into TrackedSegments.
  const mergedSegments = mergeAdjacentSpans(normalized);
  hydrateSegmentText({ segments: mergedSegments, doc });

  // 2. Compute side ownership per logical id, then derive replacement
  //    groupings (paired) when the same id has both inserted and deleted
  //    segments, or when explicit replacementGroupId metadata says so.
  const segmentsByChangeId = groupBy(mergedSegments, (s) => s.changeId);

  // 3. Build the LogicalTrackedChange map. This pass also normalizes
  //    `changeType` so a paired id with both inserted and deleted segments
  //    projects as `replacement` even if the legacy marks omit changeType.
  const changes = new Map();
  const byRevisionGroupId = new Map();
  const byReplacementGroupId = new Map();
  const byParentId = new Map();

  for (const [changeId, segs] of segmentsByChangeId) {
    const logical = buildLogicalChange({ changeId, segments: segs, doc, story, replacementsMode });
    changes.set(changeId, logical);

    appendToMap(byRevisionGroupId, logical.revisionGroupId, changeId);

    if (logical.replacement) {
      appendToMap(byReplacementGroupId, logical.replacement.groupId, changeId);
    }
    // Also index by any explicit replacementGroupId from segment attrs.
    for (const seg of segs) {
      if (seg.attrs.replacementGroupId) {
        appendToMap(byReplacementGroupId, seg.attrs.replacementGroupId, changeId);
      }
    }
  }

  // 4. Resolve parent/child relationships and stamp `overlapRole`/`parentSide`.
  for (const [id, logical] of changes) {
    let resolvedParentId = '';
    for (const seg of logical.segments) {
      const parentId = seg.attrs.overlapParentId;
      if (!parentId || parentId === id) continue;
      const parentLogical = changes.get(parentId);
      seg.parentId = parentId;
      seg.parentSide = parentLogical
        ? parentLogical.type === CanonicalChangeType.Replacement
          ? ''
          : (parentLogical.segments[0]?.side ?? '')
        : '';
      seg.overlapRole = 'child';
      if (!resolvedParentId) resolvedParentId = parentId;
      appendToMap(byParentId, parentId, id);
    }
    if (resolvedParentId) logical.parent = resolvedParentId;
  }

  // 5. Fill children arrays.
  for (const [parentId, childIds] of byParentId) {
    const parent = changes.get(parentId);
    if (parent) {
      parent.children = unique(childIds);
      const childCoverageSegments = parent.children
        .flatMap((childId) => changes.get(childId)?.segments ?? [])
        .filter((seg) => shouldContributeToParentCoverage(seg));
      parent.coverageSegments = uniqueSegments([...parent.coverageSegments, ...childCoverageSegments]);
    }
  }

  // 6. Build segment-id index.
  const bySegmentId = new Map();
  for (const segs of segmentsByChangeId.values()) {
    for (const seg of segs) bySegmentId.set(seg.segmentId, seg);
  }

  // 6b. Structural row changes (whole-table insert/delete). These do not come
  //     from marks — they live on `tableRow.attrs.trackChange` — so they are
  //     projected into LogicalTrackedChange entries with synthetic segments
  //     covering the table range. The decision engine reads `change.structural`
  //     to apply node-level accept/reject.
  //
  //     Identity is TABLE-SCOPED. Real Word docs assign a distinct `w:id` per
  //     row, and two separate tracked tables in one document can even share a
  //     Word id. Keying the `changes` map purely on the Word revision id would
  //     collapse/drop one of them. We therefore store each structural change
  //     under an internal `structural:<tablePos>:<side>` key (unique per table)
  //     and ALSO register the stable PUBLIC id as an alias so list/get/decide
  //     can route by the public id. The public alias is first-wins so a
  //     pathological id collision never overwrites a previously-seen table.
  for (const structural of structuralChanges) {
    const logical = buildStructuralLogicalChange({ structural, doc, story });
    if (!logical) continue;
    const internalKey = `structural:${structural.tablePos}:${structural.side}`;
    if (changes.has(internalKey)) continue;
    changes.set(internalKey, logical);
    // Public-id alias (Word w:id or table-derived id). Only register when it is
    // a distinct key and not already owned by another change.
    if (logical.id && logical.id !== internalKey && !changes.has(logical.id)) {
      changes.set(logical.id, logical);
    }
    for (const seg of logical.segments) bySegmentId.set(seg.segmentId, seg);
    mergedSegments.push(...logical.segments);
    appendToMap(byRevisionGroupId, logical.revisionGroupId, logical.id);
  }

  // 6c. Paragraph-property changes (w:pPrChange: tracked numbering / alignment).
  //     Like structural row changes these live on node attrs
  //     (`paragraphProperties.change`), not marks, so they are projected here
  //     into a decidable formatting change. Keyed by block position so two
  //     paragraphs never collide, with the record id as the public alias.
  //
  //     Deliberately NON-POSITIONAL: the synthetic segment spans the whole
  //     block, so adding it to `mergedSegments` (→ graph.segments) or
  //     `bySegmentId` would let text-range decides, overlap queries, and
  //     comment-detach ranges collateral-hit it (it is not real text content).
  //     pPr changes are resolved only via the `changes` map (id/all →
  //     planPprDecision), so the segment stays on the logical change alone.
  for (const ppr of pprChanges) {
    const logical = buildPprLogicalChange({ ppr, doc, story });
    if (!logical) continue;
    const internalKey = `pprchange:${ppr.from}`;
    if (changes.has(internalKey)) continue;
    changes.set(internalKey, logical);
    if (logical.id && logical.id !== internalKey && !changes.has(logical.id)) {
      changes.set(logical.id, logical);
    }
    appendToMap(byRevisionGroupId, logical.revisionGroupId, logical.id);
  }

  // 6d. Paragraph-mark deletions (w:pPr/w:rPr/w:del) that the inline pass did
  //     NOT already claim. When the deleted block had content, its runs carry
  //     `trackDelete` under the same id, so the change already exists and the
  //     mark rides along with it — projecting again would duplicate it. An
  //     EMPTY block has no runs, so this is the only pass that can surface it;
  //     without it the deletion is invisible and the empty item survives.
  //
  //     Non-positional for the same reason as pPr changes: the synthetic
  //     segment spans the whole block and is not real text content, so it
  //     stays off `mergedSegments` / `bySegmentId` and is resolved only
  //     through the `changes` map.
  for (const mark of paragraphMarkChanges) {
    if (changes.has(mark.id)) continue;
    const logical = buildParagraphMarkLogicalChange({ mark, doc, story });
    if (!logical) continue;
    const internalKey = `paragraphmark:${mark.from}`;
    if (changes.has(internalKey)) continue;
    changes.set(internalKey, logical);
    if (logical.id && logical.id !== internalKey && !changes.has(logical.id)) {
      changes.set(logical.id, logical);
    }
    appendToMap(byRevisionGroupId, logical.revisionGroupId, logical.id);
  }

  // 7. Flat ordered segment list (kept in document order for range queries).
  const segments = mergedSegments.slice().sort((a, b) => a.from - b.from || a.to - b.to);

  /** @type {TrackedReviewGraph} */
  const graph = {
    changes,
    segments,
    bySegmentId,
    byRevisionGroupId,
    byReplacementGroupId,
    byParentId,
    story,
    overlapAt: (pos) => segments.filter((seg) => pos >= seg.from && pos < seg.to),
    segmentsInRange: (from, to) => {
      if (from > to) [from, to] = [to, from];
      return segments.filter((seg) => seg.to > from && seg.from < to);
    },
    changesInRange: (from, to) => {
      const ids = new Set();
      for (const seg of segments) {
        if (seg.to <= from || seg.from >= to) continue;
        ids.add(seg.changeId);
      }
      return Array.from(ids)
        .map((id) => changes.get(id))
        .filter(Boolean);
    },
    validate: () => validateGraph(graph),
  };

  Object.defineProperty(graph, 'replacementsMode', {
    value: replacementsMode,
    enumerable: false,
  });

  return graph;
};

// ---------------------------------------------------------------------------
// Mark span merge
// ---------------------------------------------------------------------------

const mergeAdjacentSpans = (normalized) => {
  // Spans come from inline node traversal; sort by `from` then `to` to be
  // safe in case of zero-width quirks. Stability is preserved by the
  // secondary key.
  const sorted = [...normalized].sort((a, b) => {
    if (a.span.from !== b.span.from) return a.span.from - b.span.from;
    return a.span.to - b.span.to;
  });

  /** @type {Array<TrackedSegment>} */
  const merged = [];
  // Track per-change stable ordinal for deterministic segment ids.
  const ordinalByChange = new Map();

  for (const { attrs, span } of sorted) {
    const last = merged.length ? merged[merged.length - 1] : null;
    const canMerge =
      last &&
      last.changeId === attrs.id &&
      last.markType === attrs.markType &&
      last.to === span.from &&
      normalizedAttrsEqual(last.attrs, attrs);

    if (canMerge) {
      last.to = span.to;
      last.markRuns.push({ from: span.from, to: span.to, mark: span.mark });
      continue;
    }

    const ordinal = ordinalByChange.get(attrs.id) ?? 0;
    ordinalByChange.set(attrs.id, ordinal + 1);

    const side = attrs.side || sideFromMarkNameSafe(attrs.markType);
    const segmentId = makeSegmentId(attrs.id, side, span.from, span.to, ordinal);

    /** @type {TrackedSegment} */
    const seg = {
      segmentId,
      changeId: attrs.id,
      markType: attrs.markType,
      side,
      from: span.from,
      to: span.to,
      text: '',
      mark: span.mark,
      markRuns: [{ from: span.from, to: span.to, mark: span.mark }],
      attrs,
      parentId: attrs.overlapParentId || '',
      parentSide: '',
      overlapRole: attrs.overlapParentId ? 'child' : 'standalone',
    };
    merged.push(seg);
  }

  return merged;
};

const textForInlineLeaf = (node, leafFallback) => {
  const leafText = node.type?.spec?.leafText;
  if (typeof leafText === 'function') return leafText(node);
  if (typeof leafText === 'string') return leafText;
  return leafFallback;
};

/**
 * Tab-aware `textBetween`. The tab schema is non-leaf, so PM never emits '\t'.
 * Duplicated from document-api `text-with-tabs.ts` (graph layer boundary).
 *
 * @param {*} doc
 * @param {number} from
 * @param {number} to
 * @param {string} blockSeparator
 * @param {string} leafFallback
 * @returns {string}
 */
const textBetweenWithTabs = (doc, from, to, blockSeparator, leafFallback) => {
  if (!doc || typeof doc.nodesBetween !== 'function') {
    if (doc && typeof doc.textBetween === 'function') {
      return doc.textBetween(from, to, blockSeparator, leafFallback);
    }
    return '';
  }

  let out = '';
  doc.nodesBetween(from, to, (node, pos) => {
    if (pos >= to || !node) return false;
    if (node.type?.name === 'tab') {
      out += '\t';
      return false;
    }
    if (node.isText) {
      const start = Math.max(from, pos) - pos;
      const end = Math.min(to, pos + node.nodeSize) - pos;
      out += (node.text ?? '').slice(start, end);
      return false;
    }
    if (node.isLeaf && !node.isText) {
      out += textForInlineLeaf(node, leafFallback);
      return false;
    }
    if (node.isBlock && out && blockSeparator) {
      out += blockSeparator;
    }
    return true;
  });
  return out;
};

const hydrateSegmentText = ({ segments, doc }) => {
  if (!doc) return;
  for (const seg of segments) {
    try {
      seg.text = textBetweenWithTabs(doc, seg.from, seg.to, ' ', '￼');
    } catch {
      seg.text = '';
    }
  }
};

const shouldContributeToParentCoverage = (childSegment) => {
  // A child insertion inside a parent revision is newly proposed content and
  // should not extend the parent's original coverage. Child deletion and
  // formatting segments, however, may carry text that still belongs to the
  // parent's logical saved structure after same-type overlap decomposition.
  return childSegment.side !== SegmentSide.Inserted;
};

const sideFromMarkNameSafe = (markName) => {
  if (markName === TrackInsertMarkName) return SegmentSide.Inserted;
  if (markName === TrackDeleteMarkName) return SegmentSide.Deleted;
  if (markName === TrackFormatMarkName) return SegmentSide.Formatting;
  return '';
};

const makeSegmentId = (changeId, side, from, to, ordinal) => `${changeId}:${side}:${from}:${to}:${ordinal}`;

// ---------------------------------------------------------------------------
// Logical change projection
// ---------------------------------------------------------------------------

const buildLogicalChange = ({ changeId, segments, doc, story, replacementsMode }) => {
  const inserted = segments.filter((s) => s.side === SegmentSide.Inserted);
  const deleted = segments.filter((s) => s.side === SegmentSide.Deleted);
  const formatting = segments.filter((s) => s.side === SegmentSide.Formatting);

  // Determine canonical change type.
  // - an *explicitly persisted* changeType attr on any segment wins. The
  //   inferred changeType from readTrackedAttrs is NOT used here, because
  //   inferred values reflect mark type only — they would shadow the paired
  //   ins+del replacement detection below.
  // - paired (default): both inserted and deleted under one id => replacement.
  // - independent: keep separate sides as separate logical changes — but the
  //   builder still groups by id, so independent-mode replacements must
  //   already have been minted with distinct ids by the compiler. If we see
  //   both sides under one id in independent mode, we still project as
  //   replacement (defensive — better than silently dropping a side).
  const explicitType = segments.find((s) => s.attrs.explicitChangeType)?.attrs.explicitChangeType ?? '';

  let type;
  if (explicitType) {
    type = explicitType;
  } else if (inserted.length && deleted.length) {
    type = CanonicalChangeType.Replacement;
  } else if (inserted.length) {
    type = CanonicalChangeType.Insertion;
  } else if (deleted.length) {
    type = CanonicalChangeType.Deletion;
  } else if (formatting.length) {
    type = CanonicalChangeType.Formatting;
  } else {
    type = '';
  }

  // A replacement needs BOTH sides. Editor-created replacements persist an
  // explicit changeType:"replacement" (+ replacementGroupId) on each half, so
  // after one side is resolved (side-targeted accept/reject) the survivor still
  // reports type "replacement" with an empty side. Downgrade it to the plain
  // insertion/deletion it now is — otherwise the decision engine fails with
  // "replacement missing inserted or deleted side" on accept/reject-all.
  if (type === CanonicalChangeType.Replacement && !(inserted.length && deleted.length)) {
    if (inserted.length) type = CanonicalChangeType.Insertion;
    else if (deleted.length) type = CanonicalChangeType.Deletion;
  }

  const subtype = subtypeFromChangeType(type) ?? '';
  const primary = segments[0]?.attrs ?? null;

  /** @type {LogicalReplacementProjection | null} */
  let replacement = null;
  if (type === CanonicalChangeType.Replacement) {
    const insertedSideId = inserted[0]?.attrs.replacementSideId || `${changeId}#inserted`;
    const deletedSideId = deleted[0]?.attrs.replacementSideId || `${changeId}#deleted`;
    const explicitGroupId = segments.find((s) => s.attrs.replacementGroupId)?.attrs.replacementGroupId ?? '';
    replacement = {
      groupId: explicitGroupId || changeId,
      inserted,
      deleted,
      insertedSideId,
      deletedSideId,
    };
  }

  // Aggregate sourceIds across segments (e.g. paired replacement carries
  // wordIdInsert + wordIdDelete). Deterministic merge order: sort by side
  // then segment ordinal so output is stable across rebuilds.
  const aggregatedSourceIds = aggregateSourceIds(segments);

  const sourcePlatform = derivePlatform(segments, primary);

  // before/after carriers from trackFormat segments — kept as raw arrays so
  // downstream decision/export code can interpret them.
  const before = formatting.length ? /** @type {*} */ (formatting[0]?.mark?.attrs?.before ?? []) : [];
  const after = formatting.length ? /** @type {*} */ (formatting[0]?.mark?.attrs?.after ?? []) : [];

  // Coverage segments: by default the segments themselves cover the logical
  // change. Child segments inside a parent deletion are tracked here so
  // accept/reject can use coverage rather than only parent-owned persisted
  // segments. The compiler in plan 003 will write explicit coverage; the
  // graph layer just exposes the structure.
  const coverageSegments = [...segments];

  const excerpt = doc ? extractExcerpt(doc, segments) : '';

  /** @type {LogicalTrackedChange} */
  const logical = {
    id: changeId,
    type,
    subtype,
    state: 'open',
    segments,
    coverageSegments,
    insertedSegments: inserted,
    deletedSegments: deleted,
    formattingSegments: formatting,
    replacement,
    author: primary?.author ?? '',
    authorId: primary?.authorId ?? '',
    authorEmail: primary?.authorEmail ?? '',
    authorImage: primary?.authorImage ?? '',
    date: primary?.date ?? '',
    sourceIds: aggregatedSourceIds,
    revisionGroupId: primary?.revisionGroupId || changeId,
    splitFromId: primary?.splitFromId ?? '',
    sourcePlatform,
    story,
    parent: null,
    children: [],
    before,
    after,
    excerpt,
  };

  // replacementsMode is informational here; the compiler (plan 003) uses it
  // when minting new replacement ids. The graph stores it on the change for
  // observability/tests.
  Object.defineProperty(logical, 'replacementsMode', {
    value: replacementsMode,
    enumerable: false,
  });

  return logical;
};

/**
 * Project a structural row change (whole-table insert/delete) into a
 * LogicalTrackedChange. The segments are synthetic and cover the whole table
 * so range/all targeting and coverage checks treat the table atomically.
 *
 * @param {{
 *   structural: import('../trackChangesHelpers/structuralRowChanges.js').StructuralChange,
 *   doc: import('prosemirror-model').Node | null,
 *   story: import('./story-locator.js').StoryLocator,
 * }} input
 * @returns {LogicalTrackedChange | null}
 */
const buildStructuralLogicalChange = ({ structural, doc, story }) => {
  const side = structural.side === 'insertion' ? SegmentSide.Inserted : SegmentSide.Deleted;
  const from = structural.tableFrom;
  const to = structural.tableTo;
  if (!(from < to)) return null;

  /** @type {import('./mark-metadata.js').NormalizedTrackedAttrs} */
  const attrs = {
    id: structural.id,
    revisionGroupId: structural.revisionGroupId,
    splitFromId: '',
    changeType: CanonicalChangeType.Structural,
    replacementGroupId: '',
    replacementSideId: '',
    overlapParentId: '',
    sourceIds: structural.sourceId ? { wordIdStructural: structural.sourceId } : {},
    sourceId: structural.sourceId,
    importedAuthor: structural.importedAuthor,
    origin: structural.sourceId ? 'word' : '',
    author: structural.author,
    authorId: '',
    authorEmail: structural.authorEmail,
    authorImage: structural.authorImage,
    date: structural.date,
    markType: '',
    side,
    subtype: structural.subtype,
    explicitChangeType: CanonicalChangeType.Structural,
    hasReviewMetadata: true,
  };

  /** @type {TrackedSegment} */
  const segment = {
    segmentId: `${structural.id}:structural:${from}:${to}:0`,
    changeId: structural.id,
    markType: '',
    side,
    from,
    to,
    text: '',
    mark: /** @type {*} */ (null),
    markRuns: [],
    attrs,
    parentId: '',
    parentSide: '',
    overlapRole: 'standalone',
    structural: true,
  };
  if (doc) {
    try {
      segment.text = textBetweenWithTabs(doc, from, to, ' ', '￼');
    } catch {
      segment.text = '';
    }
  }

  const segments = [segment];
  /** @type {LogicalTrackedChange} */
  const logical = {
    id: structural.id,
    type: CanonicalChangeType.Structural,
    subtype: structural.subtype,
    state: 'open',
    segments,
    coverageSegments: [...segments],
    insertedSegments: side === SegmentSide.Inserted ? [...segments] : [],
    deletedSegments: side === SegmentSide.Deleted ? [...segments] : [],
    formattingSegments: [],
    replacement: null,
    author: structural.author,
    authorId: '',
    authorEmail: structural.authorEmail,
    authorImage: structural.authorImage,
    date: structural.date,
    sourceIds: attrs.sourceIds,
    revisionGroupId: structural.revisionGroupId,
    splitFromId: '',
    sourcePlatform: structural.sourceId ? 'word' : '',
    story,
    parent: null,
    children: [],
    before: [],
    after: [],
    excerpt: segment.text.length > 200 ? `${segment.text.slice(0, 200)}…` : segment.text,
  };
  // Structural-specific payload the decision engine reads to apply node-level
  // accept/reject. Non-enumerable so it never leaks into deterministic JSON or
  // contract projections that iterate own keys.
  Object.defineProperty(logical, 'structural', {
    value: structural,
    enumerable: false,
  });

  return logical;
};

/**
 * Project a paragraph-property change (w:pPrChange: tracked numbering /
 * alignment) into a decidable formatting change. Mirrors
 * {@link buildStructuralLogicalChange}: the change lives on node attrs, not a
 * mark, so it carries a synthetic segment covering the block and a
 * non-enumerable `pprChange` payload the decision engine reads to accept (drop
 * the record, keep the new properties) or reject (restore the former ones).
 *
 * @param {{
 *   ppr: import('../trackChangesHelpers/pprChanges.js').PprChange,
 *   doc: import('prosemirror-model').Node | null,
 *   story: import('./story-locator.js').StoryLocator,
 * }} input
 * @returns {LogicalTrackedChange | null}
 */
const buildPprLogicalChange = ({ ppr, doc, story }) => {
  const from = ppr.from;
  const to = ppr.to;
  if (!(from < to)) return null;
  const side = SegmentSide.Formatting;

  /** @type {import('./mark-metadata.js').NormalizedTrackedAttrs} */
  const attrs = {
    id: ppr.id,
    revisionGroupId: ppr.id,
    splitFromId: '',
    changeType: CanonicalChangeType.Formatting,
    replacementGroupId: '',
    replacementSideId: '',
    overlapParentId: '',
    sourceIds: {},
    sourceId: '',
    importedAuthor: '',
    origin: '',
    author: ppr.author,
    authorId: '',
    authorEmail: ppr.authorEmail,
    authorImage: ppr.authorImage,
    date: ppr.date,
    markType: '',
    side,
    subtype: ppr.subtype,
    explicitChangeType: CanonicalChangeType.Formatting,
    hasReviewMetadata: true,
  };

  /** @type {TrackedSegment} */
  const segment = {
    segmentId: `${ppr.id}:pprchange:${from}:${to}:0`,
    changeId: ppr.id,
    markType: '',
    side,
    from,
    to,
    text: '',
    mark: /** @type {*} */ (null),
    markRuns: [],
    attrs,
    parentId: '',
    parentSide: '',
    overlapRole: 'standalone',
    // Attr-based (no inline mark), like structural segments. Overlap grouping is
    // driven by `overlapParentId` (standalone here), so the block-spanning range
    // never nests inline changes that happen to sit inside the same paragraph.
    pprChange: true,
  };
  if (doc) {
    try {
      segment.text = doc.textBetween(from, to, ' ', '￼');
    } catch {
      segment.text = '';
    }
  }

  const segments = [segment];
  /** @type {LogicalTrackedChange} */
  const logical = {
    id: ppr.id,
    type: CanonicalChangeType.Formatting,
    subtype: ppr.subtype,
    state: 'open',
    segments,
    coverageSegments: [...segments],
    insertedSegments: [],
    deletedSegments: [],
    formattingSegments: [...segments],
    replacement: null,
    author: ppr.author,
    authorId: '',
    authorEmail: ppr.authorEmail,
    authorImage: ppr.authorImage,
    date: ppr.date,
    sourceIds: {},
    revisionGroupId: ppr.id,
    splitFromId: '',
    sourcePlatform: '',
    story,
    parent: null,
    children: [],
    before: [],
    after: [],
    excerpt: segment.text.length > 200 ? `${segment.text.slice(0, 200)}…` : segment.text,
  };
  // Payload the decision engine reads to apply node-level accept/reject.
  // Non-enumerable so it never leaks into deterministic JSON or contract
  // projections that iterate own keys.
  Object.defineProperty(logical, 'pprChange', {
    value: ppr,
    enumerable: false,
  });

  return logical;
};

/**
 * Project a standalone paragraph-mark deletion (an emptied block whose runs
 * carry no mark of their own) into a decidable Deletion change.
 *
 * Typed Deletion, not Structural: accepting removes the block the same way the
 * content case does, and the decision engine resolves it through the same
 * `collapseParagraphMark` / `clearParagraphMark` ops.
 *
 * @param {{
 *   mark: import('../trackChangesHelpers/paragraphMarkChanges.js').ParagraphMarkChange,
 *   doc: import('prosemirror-model').Node | null,
 *   story: import('./story-locator.js').StoryLocator,
 * }} input
 * @returns {LogicalTrackedChange | null}
 */
const buildParagraphMarkLogicalChange = ({ mark, doc, story }) => {
  const from = mark.from;
  const to = mark.to;
  if (!(from < to)) return null;
  const side = SegmentSide.Deleted;

  /** @type {import('./mark-metadata.js').NormalizedTrackedAttrs} */
  const attrs = {
    id: mark.id,
    revisionGroupId: mark.id,
    splitFromId: '',
    changeType: CanonicalChangeType.Deletion,
    replacementGroupId: '',
    replacementSideId: '',
    overlapParentId: '',
    sourceIds: {},
    sourceId: '',
    importedAuthor: '',
    origin: '',
    author: mark.author,
    authorId: '',
    authorEmail: mark.authorEmail,
    authorImage: mark.authorImage,
    date: mark.date,
    markType: '',
    side,
    subtype: mark.subtype,
    explicitChangeType: CanonicalChangeType.Deletion,
    hasReviewMetadata: true,
  };

  /** @type {TrackedSegment} */
  const segment = {
    segmentId: `${mark.id}:paragraphmark:${from}:${to}:0`,
    changeId: mark.id,
    markType: '',
    side,
    from,
    to,
    text: '',
    mark: /** @type {*} */ (null),
    markRuns: [],
    attrs,
    parentId: '',
    parentSide: '',
    overlapRole: 'standalone',
    // Attr-based, like the structural and pPr segments: the block-spanning
    // range is not real text content, so it must not nest inline changes or
    // be hit by text-range decides.
    paragraphMarkChange: true,
  };

  const segments = [segment];
  /** @type {LogicalTrackedChange} */
  const logical = {
    id: mark.id,
    type: CanonicalChangeType.Deletion,
    subtype: mark.subtype,
    state: 'open',
    segments,
    coverageSegments: [...segments],
    insertedSegments: [],
    deletedSegments: [...segments],
    formattingSegments: [],
    replacement: null,
    author: mark.author,
    authorId: '',
    authorEmail: mark.authorEmail,
    authorImage: mark.authorImage,
    date: mark.date,
    sourceIds: {},
    revisionGroupId: mark.id,
    splitFromId: '',
    sourcePlatform: '',
    story,
    parent: null,
    children: [],
    before: [],
    after: [],
    excerpt: '',
  };
  // Payload the decision engine reads. Non-enumerable so it never leaks into
  // deterministic JSON or contract projections that iterate own keys.
  Object.defineProperty(logical, 'paragraphMarkChange', {
    value: mark,
    enumerable: false,
  });

  return logical;
};

const aggregateSourceIds = (segments) => {
  /** @type {Record<string, unknown>} */
  const out = {};
  // Sort by side then by ordinal-in-id to be deterministic.
  const sorted = [...segments].sort((a, b) => {
    if (a.side !== b.side) return a.side < b.side ? -1 : 1;
    return a.from - b.from;
  });
  for (const seg of sorted) {
    for (const [k, v] of Object.entries(seg.attrs.sourceIds || {})) {
      if (v == null || v === '') continue;
      if (out[k] == null) out[k] = v;
    }
  }
  return out;
};

const derivePlatform = (segments, primary) => {
  if (primary?.origin) return primary.origin;
  // Heuristic: a sourceIds object with wordId* hints at a Word import.
  const sourceIds = primary?.sourceIds || {};
  if (sourceIds.wordIdInsert || sourceIds.wordIdDelete || sourceIds.wordIdFormat) return 'word';
  if (primary?.sourceId) return 'word';
  return '';
};

const extractExcerpt = (doc, segments) => {
  if (!segments.length || !doc) return '';
  // Use first inserted segment's range as the canonical excerpt source;
  // fall back to first segment if there is no inserted side.
  const target = segments.find((s) => s.side === SegmentSide.Inserted) ?? segments[0];
  try {
    const text = textBetweenWithTabs(doc, target.from, target.to, ' ', '￼');
    return text.length > 200 ? `${text.slice(0, 200)}…` : text;
  } catch {
    return '';
  }
};

// ---------------------------------------------------------------------------
// Validation / invariants
// ---------------------------------------------------------------------------

/**
 * Run all graph invariants from phase0-002 "Graph Invariants".
 *
 * Severity:
 * - `error`: hard invariant violation. Decision/compiler paths must abort.
 * - `warning`: structural anomaly that the graph still represents (e.g.
 *   replacement with empty deleted side mid-transaction).
 * - `info`: telemetry only.
 *
 * @param {TrackedReviewGraph} graph
 * @returns {Array<GraphDiagnostic>}
 */
export const validateGraph = (graph) => {
  /** @type {GraphDiagnostic[]} */
  const diagnostics = [];

  // 1. Every tracked mark has an id.
  for (const seg of graph.segments) {
    if (!seg.changeId) {
      diagnostics.push({
        code: 'INV_MARK_MISSING_ID',
        severity: 'error',
        message: 'tracked mark span lacks an id',
        details: { from: seg.from, to: seg.to, markType: seg.markType },
      });
    }
  }

  for (const [id, change] of graph.changes) {
    // 2. Every open logical change has at least one segment.
    if (!change.segments.length) {
      diagnostics.push({
        code: 'INV_OPEN_CHANGE_NO_SEGMENTS',
        severity: 'error',
        message: 'logical change has no segments',
        changeIds: [id],
      });
      continue;
    }

    // 3. Every segment range is non-empty.
    for (const seg of change.segments) {
      if (seg.from >= seg.to) {
        diagnostics.push({
          code: 'INV_EMPTY_SEGMENT_RANGE',
          severity: 'error',
          message: 'tracked segment has an empty range',
          changeIds: [id],
          details: { segmentId: seg.segmentId, from: seg.from, to: seg.to },
        });
      }
    }

    // 4. Replacement has at least one inserted and one deleted side.
    if (change.type === CanonicalChangeType.Replacement) {
      if (!change.insertedSegments.length || !change.deletedSegments.length) {
        diagnostics.push({
          code: 'INV_REPLACEMENT_MISSING_SIDE',
          severity: 'warning',
          message: 'replacement is missing one side',
          changeIds: [id],
          details: {
            inserted: change.insertedSegments.length,
            deleted: change.deletedSegments.length,
          },
        });
      }
      // 5. Replacement side metadata matches the logical change.
      if (
        change.replacement &&
        change.replacement.groupId !== id &&
        !graph.byReplacementGroupId.has(change.replacement.groupId)
      ) {
        diagnostics.push({
          code: 'INV_REPLACEMENT_GROUP_MISMATCH',
          severity: 'warning',
          message: 'replacementGroupId not indexed',
          changeIds: [id],
        });
      }
    }

    // 6. splitFromId never equals id.
    if (change.splitFromId && change.splitFromId === id) {
      diagnostics.push({
        code: 'INV_SPLIT_FROM_SELF',
        severity: 'error',
        message: 'splitFromId equals own id',
        changeIds: [id],
      });
    }

    // 7. overlapParentId points to an existing parent.
    for (const seg of change.segments) {
      if (seg.attrs.overlapParentId && !graph.changes.has(seg.attrs.overlapParentId)) {
        diagnostics.push({
          code: 'INV_CHILD_MISSING_PARENT',
          severity: 'warning',
          message: 'segment references a missing overlap parent',
          changeIds: [id],
          details: { segmentId: seg.segmentId, parentId: seg.attrs.overlapParentId },
        });
      }
    }

    // 9. revisionGroupId is stable across fragments.
    const revisionGroups = unique(change.segments.map((s) => s.attrs.revisionGroupId || id));
    if (revisionGroups.length > 1) {
      diagnostics.push({
        code: 'INV_REVISION_GROUP_INCONSISTENT',
        severity: 'warning',
        message: 'segments of one logical change reference multiple revisionGroupIds',
        changeIds: [id],
        details: { revisionGroups },
      });
    }

    // 11. Derived fields match persisted mark type.
    for (const seg of change.segments) {
      const expectedSide = sideFromMarkNameSafe(seg.markType);
      if (expectedSide && seg.side !== expectedSide) {
        diagnostics.push({
          code: 'INV_SIDE_DERIVATION_MISMATCH',
          severity: 'error',
          message: 'segment side does not match mark type',
          changeIds: [id],
          details: { segmentId: seg.segmentId, side: seg.side, markType: seg.markType },
        });
      }
    }
  }

  // 8. Same-type overlap on one character — checked by scanning for two
  // segments of the same side+markType covering an identical [from,to].
  // The merge pass already collapses adjacent same-id, same-attrs segments,
  // so any remaining same-type stacked segment is an integrity error.
  const segmentsByPosition = new Map();
  for (const seg of graph.segments) {
    const key = `${seg.markType}:${seg.from}:${seg.to}`;
    if (segmentsByPosition.has(key)) {
      diagnostics.push({
        code: 'INV_SAME_TYPE_OVERLAP',
        severity: 'error',
        message: 'same-type tracked marks occupy identical range',
        changeIds: [seg.changeId, segmentsByPosition.get(key).changeId],
        details: { range: { from: seg.from, to: seg.to }, markType: seg.markType },
      });
    } else {
      segmentsByPosition.set(key, seg);
    }
  }

  return diagnostics;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const groupBy = (arr, fn) => {
  /** @type {Map<string, Array<*>>} */
  const out = new Map();
  for (const item of arr) {
    const key = fn(item);
    const list = out.get(key);
    if (list) list.push(item);
    else out.set(key, [item]);
  }
  return out;
};

const appendToMap = (map, key, value) => {
  const list = map.get(key);
  if (list) {
    if (!list.includes(value)) list.push(value);
  } else {
    map.set(key, [value]);
  }
};

const unique = (arr) => Array.from(new Set(arr));

const uniqueSegments = (segments) => {
  const seen = new Set();
  const out = [];
  for (const seg of segments) {
    if (seen.has(seg.segmentId)) continue;
    seen.add(seg.segmentId);
    out.push(seg);
  }
  out.sort((a, b) => {
    if (a.from !== b.from) return a.from - b.from;
    if (a.to !== b.to) return a.to - b.to;
    return a.segmentId.localeCompare(b.segmentId);
  });
  return out;
};

// ---------------------------------------------------------------------------
// Public helpers used by future consumers (plan 003/004)
// ---------------------------------------------------------------------------

/**
 * Deterministic signature for a logical change that downstream code can use
 * to detect graph-equivalent rebuilds (e.g. collaboration replay). Stable
 * across PM position drift because it includes the revisionGroupId and side
 * counts but not absolute positions.
 *
 * @param {LogicalTrackedChange} change
 * @returns {string}
 */
export const signatureOf = (change) => {
  return deterministicJson({
    id: change.id,
    type: change.type,
    revisionGroupId: change.revisionGroupId,
    inserted: change.insertedSegments.length,
    deleted: change.deletedSegments.length,
    formatting: change.formattingSegments.length,
    children: change.children,
    sourceIds: change.sourceIds,
  });
};

export { CanonicalChangeType, ChangeSubtype, SegmentSide };
