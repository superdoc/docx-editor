// @ts-check
/**
 * Overlap-aware tracked edit compiler.
 *
 * Single entry point used by tracked text mutation paths:
 *
 *   - `trackedTransaction` (native UI text steps)
 *   - `replaceStep` (text insert/delete/replace step rewrites)
 *   - `addMarkStep` / `removeMarkStep` (tracked run formatting)
 *   - `insertTrackedChange` (document-api tracked writes)
 *   - the existing backspace-to-text-delete `ReplaceAroundStep` conversion
 *   - document-api `write-adapter` and tracked plan-engine text rewrites
 *
 * Callers MUST treat `ok: false` as an abort and MUST NOT fall through to
 * applying the original untracked step.
 *
 * Compiler scope (this plan): text-insert, text-delete, text-replace, and
 * run-formatting intents. Other intents fail closed with
 * `CAPABILITY_UNAVAILABLE`.
 */

import { Slice, Fragment } from 'prosemirror-model';
import { ReplaceStep, Mapping } from 'prosemirror-transform';
import { v4 as uuidv4 } from 'uuid';
import { TrackInsertMarkName, TrackDeleteMarkName, TrackFormatMarkName, TrackedFormatMarkNames } from '../constants.js';
import { buildReviewGraph, CanonicalChangeType, SegmentSide } from './review-graph.js';
import { graphHasErrors } from './graph-invariants.js';
import {
  classifyOwnership,
  getCurrentUserIdentity,
  getChangeAuthorIdentity,
  isSameUserHighConfidence,
  matchesSameUserRefinement,
  shouldCollapseNoEmailInsertion,
} from './identity.js';
import { findMarkPosition } from '../trackChangesHelpers/documentHelpers.js';
import { markInsertion } from '../trackChangesHelpers/markInsertion.js';
import {
  createMarkSnapshot,
  getTypeName,
  hasMatchingMark,
  isTrackFormatNoOp,
  markSnapshotMatchesStepMark,
  upsertMarkSnapshotByType,
} from '../trackChangesHelpers/markSnapshotHelpers.js';
import { getLiveInlineMarksInRange } from '../trackChangesHelpers/getLiveInlineMarksInRange.js';

/**
 * @typedef {import('./edit-intent.js').TrackedEditIntent} TrackedEditIntent
 */

/**
 * @typedef {Object} SelectionHint
 * @property {'near'|'exact-text'} kind
 * @property {number} pos
 * @property {-1|1} [bias]
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
 * @typedef {Object} TrackedEditSuccess
 * @property {true} ok
 * @property {import('prosemirror-state').Transaction} tr
 * @property {string[]} createdChangeIds
 * @property {string[]} updatedChangeIds
 * @property {string[]} removedChangeIds
 * @property {Array<{ from: string, to: string }>} remappedChangeIds
 * @property {SelectionHint} [selection]
 * @property {GraphDiagnostic[]} [diagnostics]
 * @property {import('prosemirror-model').Mark | null} [insertedMark]
 * @property {import('prosemirror-model').Mark | null} [deletionMark]
 * @property {import('prosemirror-model').Mark[]} [deletionMarks]
 * @property {import('prosemirror-model').Mark[]} [formatMarks]
 * @property {number} [insertedFrom]
 * @property {number} [insertedTo]
 * @property {number} [deletedFrom]
 * @property {number} [deletedTo]
 * @property {import('prosemirror-model').Node[]} [insertedNodes]
 * @property {import('prosemirror-model').Node[]} [deletionNodes]
 * @property {import('prosemirror-transform').ReplaceStep | null} [insertedStep]
 */

/**
 * @typedef {Object} TrackedEditFailure
 * @property {false} ok
 * @property {'CAPABILITY_UNAVAILABLE'|'INVALID_TARGET'|'PRECONDITION_FAILED'} code
 * @property {string} message
 * @property {unknown} [details]
 */

/**
 * @typedef {TrackedEditSuccess | TrackedEditFailure} TrackedEditResult
 */

const SUPPORTED_KINDS = new Set(['text-insert', 'text-delete', 'text-replace', 'format-apply', 'format-remove']);
const EMPTY_STRUCTURAL_GAP_REFINEMENT_MAX_DISTANCE = 4;

/**
 * @typedef {false|'different-user'|'all'} ExistingDeletionReassignMode
 */

/**
 * Compile a tracked edit against an accumulated transaction.
 *
 * The compiler mutates `tr` in place. Callers MUST inspect `result.ok`
 * before dispatch; if `ok: false` the transaction has not been altered.
 *
 * @param {{
 *   state: import('prosemirror-state').EditorState,
 *   tr: import('prosemirror-state').Transaction,
 *   intent: TrackedEditIntent,
 *   replacements?: 'paired'|'independent',
 * }} input
 * @returns {TrackedEditResult}
 */
export const compileTrackedEdit = ({ state, tr, intent, replacements = 'paired' }) => {
  if (!intent || !SUPPORTED_KINDS.has(intent.kind)) {
    return failure('CAPABILITY_UNAVAILABLE', `Unsupported tracked edit kind ${intent?.kind ?? 'unknown'}.`);
  }

  const ctx = makeContext({ state, tr, intent, replacements });

  // Pre-validate the graph state before allowing the compiler to write.
  // graphHasErrors aborts the compile if the document is already in a state
  // that would corrupt downstream decisions.
  if (graphHasErrors(ctx.graph)) {
    return failure('PRECONDITION_FAILED', 'Tracked review graph has invariant errors before edit.', {
      diagnostics: ctx.graph.validate(),
    });
  }

  try {
    switch (intent.kind) {
      case 'text-insert':
        return compileTextInsert(ctx, intent);
      case 'text-delete':
        return compileTextDelete(ctx, intent);
      case 'text-replace':
        return compileTextReplace(ctx, intent);
      case 'format-apply':
      case 'format-remove':
        return compileFormat(ctx, intent);
      default:
        return failure('CAPABILITY_UNAVAILABLE', 'Unsupported tracked edit kind.');
    }
  } catch (error) {
    return failure('PRECONDITION_FAILED', /** @type {Error} */ (error).message ?? 'compile failed.', { error });
  }
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const makeContext = ({ state, tr, intent, replacements }) => {
  const schema = state.schema;
  const graph = buildReviewGraph({ state: { doc: tr.doc }, replacementsMode: replacements });
  const currentIdentity = getCurrentUserIdentity({ options: { user: intent.user } });
  return {
    state,
    tr,
    schema,
    graph,
    intent,
    replacements,
    currentIdentity,
    /** @type {string[]} */ createdChangeIds: [],
    /** @type {string[]} */ updatedChangeIds: [],
    /** @type {string[]} */ removedChangeIds: [],
    /** @type {Array<{from:string,to:string}>} */ remappedChangeIds: [],
    /** @type {GraphDiagnostic[]} */ diagnostics: [],
  };
};

/**
 * @param {'CAPABILITY_UNAVAILABLE'|'INVALID_TARGET'|'PRECONDITION_FAILED'} code
 * @param {string} message
 * @param {unknown} [details]
 * @returns {TrackedEditFailure}
 */
const failure = (code, message, details) => ({
  ok: false,
  code,
  message,
  ...(details !== undefined ? { details } : {}),
});

// ---------------------------------------------------------------------------
// Helpers — segments, ownership, marks
// ---------------------------------------------------------------------------

/**
 * Classify whether the segment is same-user-owned by the intent's user.
 *
 * @param {*} ctx
 * @param {*} segment
 * @returns {'same-user'|'different-user'}
 */
const classifySegment = (ctx, segment) => {
  const classification = classifyOwnership({
    currentUser: ctx.currentIdentity,
    change: getChangeAuthorIdentity(segment?.attrs ?? {}),
  });
  return isSameUserHighConfidence(classification) ? 'same-user' : 'different-user';
};

/**
 * Permissive same-user check for refinement (extending the current user's
 * own contiguous edit). Differs from the high-confidence `classifySegment`
 * gate used for overlap parent decisions: refinement is allowed when the
 * stored authorEmail matches the current user's normalized email — including
 * when both sides have no email at all (default unidentified user typing).
 *
 * Permission ownership still requires the high-confidence `classifySegment`
 * path; this helper answers "is this the same logical author for the purpose
 * of refining their own pending edit" — coalescing contiguous typing,
 * shrinking an own insertion on delete (SD-3352), and deciding that an own
 * insertion is not a different-user overlap parent for a replacement.
 *
 * @param {*} ctx
 * @param {*} segment
 * @returns {boolean}
 */
const isSameUserForRefinement = (ctx, segment) => {
  return matchesSameUserRefinement({
    currentUser: ctx.currentIdentity,
    change: getChangeAuthorIdentity(segment?.attrs ?? {}),
  });
};

const findSegmentAt = (ctx, pos) => {
  // Prefer the segment that covers `pos` strictly (pos in [from, to)). When
  // `pos` sits exactly at the right edge of a segment, also consider it as a
  // boundary for "still inside the same logical change" so we can refine.
  const hits = ctx.graph.overlapAt(pos);
  if (hits.length) return hits[0];
  // Boundary fallback: a segment that ends exactly at `pos` is still
  // adjacent. We do not extend into a segment that starts at `pos`,
  // because the cursor is on the live side.
  const left = ctx.graph.segments.find((s) => s.to === pos);
  if (left) return left;
  return null;
};

const findSegmentAcrossEmptyStructuralGap = (ctx, pos) => {
  let nearest = null;
  for (const segment of ctx.graph.segments) {
    if (segment.to >= pos) continue;
    const distance = pos - segment.to;
    if (distance > EMPTY_STRUCTURAL_GAP_REFINEMENT_MAX_DISTANCE) continue;
    if (!isEmptyStructuralGap(ctx, segment.to, pos)) continue;
    if (!nearest || segment.to > nearest.to) nearest = segment;
  }
  return nearest;
};

const findAdjacentInsertedSegment = (ctx, pos) => {
  const left = ctx.graph.segments.find(
    (segment) => segment.side === SegmentSide.Inserted && segment.to === pos && isSameUserForRefinement(ctx, segment),
  );
  if (left) return left;

  return (
    ctx.graph.segments.find(
      (segment) =>
        segment.side === SegmentSide.Inserted && segment.from === pos && isSameUserForRefinement(ctx, segment),
    ) ?? null
  );
};

/**
 * Find the current user's own unresolved tracked deletion adjacent to the
 * delete range [from, to], so contiguous keystroke deletions coalesce into one
 * logical change. A Backspace run leaves the caret at the left edge of the
 * prior deletion, so the next range's `to` meets that deletion's `from`
 * (right-adjacent); forward Delete extends the other way (left-adjacent).
 *
 * Adjacency is checked exactly first (contiguous within a single run), then
 * across a gap gated by `isCoalescibleDeletionGap`. Multi-run paragraphs —
 * e.g. Google Docs exports that split "Open comment " and "from Google Docs."
 * into separate runs — separate the prior deletion from this range by run
 * open/close tokens, and Google Docs additionally anchors comments with
 * zero-width marker nodes at those seams; without the gap-tolerant pass,
 * deleting the space at the seam would mint a new change. `isCoalescibleDeletionGap`
 * tolerates run boundaries AND zero-width review/anchor markers but still
 * requires no live text in the gap, so a live character between two deletions
 * splits them.
 *
 * This is analogous to the same-user insertion refinement in `compileTextInsert`
 * but intentionally MORE permissive: that path's `findSegmentAcrossEmptyStructuralGap`
 * rejects any inline leaf, so the insertion side still splits at comment-anchor
 * seams. TC-EDIT-018 covers "deleted or inserted", so the insertion side is a
 * known conformance gap to close in a follow-up — not a mirror of this logic.
 *
 * Known limitation (bridge case): when a single live character sits between two
 * of the user's own deletions, deleting it matches `exactLeft` first and reuses
 * the LEFT deletion's id; the right deletion is never consulted. Because span
 * merging joins only same-id spans, the result is two touching logical
 * deletions where Word shows one. This is strictly better than the
 * pre-coalescing behavior (which minted a third id) but short of TC-EDIT-018's
 * "one logical change"; bridging both sides under a single id (reassigning the
 * right deletion to the left id) is left as a future refinement.
 *
 * @param {*} ctx
 * @param {number} from
 * @param {number} to
 */
const findAdjacentDeletedSegment = (ctx, from, to) => {
  // Only coalesce into a PLAIN standalone deletion. A replacement's deleted
  // side (replacementGroupId set) or an overlap child (overlapParentId set) is
  // a structured change: reusing its id for an unrelated plain deletion would
  // write a deletion mark with empty/mismatched replacement metadata under that
  // id, widening or mis-typing the change and corrupting its accept/reject.
  const sameUserDeleted = (segment) =>
    segment.side === SegmentSide.Deleted &&
    !segment.attrs?.replacementGroupId &&
    !segment.attrs?.overlapParentId &&
    isSameUserForRefinement(ctx, segment);

  const exactLeft = ctx.graph.segments.find((segment) => sameUserDeleted(segment) && segment.to === from);
  if (exactLeft) return exactLeft;
  const exactRight = ctx.graph.segments.find((segment) => sameUserDeleted(segment) && segment.from === to);
  if (exactRight) return exactRight;

  let nearest = null;
  let nearestDistance = Infinity;
  for (const segment of ctx.graph.segments) {
    if (!sameUserDeleted(segment)) continue;
    if (segment.from > to) {
      const distance = segment.from - to;
      if (distance < nearestDistance && isCoalescibleDeletionGap(ctx, to, segment.from)) {
        nearest = segment;
        nearestDistance = distance;
      }
    } else if (segment.to < from) {
      const distance = from - segment.to;
      if (distance < nearestDistance && isCoalescibleDeletionGap(ctx, segment.to, from)) {
        nearest = segment;
        nearestDistance = distance;
      }
    }
  }
  return nearest;
};

const isEmptyStructuralGap = (ctx, from, to) => {
  if (to <= from) return false;
  if (!sharesTextblock(ctx.tr.doc, from, to)) return false;
  if (ctx.graph.segmentsInRange(from, to).length) return false;
  if (ctx.tr.doc.textBetween(from, to, '', '')) return false;

  let hasInlineLeaf = false;
  ctx.tr.doc.nodesBetween(from, to, (node, pos) => {
    if (pos < from || pos >= to) return;
    if (node.isInline && node.isLeaf) {
      hasInlineLeaf = true;
      return false;
    }
  });
  return !hasInlineLeaf;
};

/**
 * Zero-width review/anchor marker node types: inline ATOM nodes that occupy a
 * document position but render no visible content (comment range start/end,
 * comment reference, bookmark end, permission range start/end). A contiguous
 * visible-text deletion spans them, so they must not block deletion coalescing
 * — e.g. Google Docs anchors comments with inline marker nodes between runs.
 *
 * Membership rule: list an inline leaf here only if it is genuinely zero-width.
 * Deliberate non-members:
 *   - `bookmarkStart` is a content node (`content: 'inline*'`), not a leaf, so
 *     it never reaches the leaf check in `isCoalescibleDeletionGap`; any text it
 *     wraps is caught by the live-text guard. Listing it would be inert.
 *   - `fieldAnnotation` is an inline atom but renders real content (a field /
 *     form widget), so a deletion spanning one MUST split — it stays out.
 */
const ZERO_WIDTH_ANCHOR_NODE_NAMES = new Set([
  'commentRangeStart',
  'commentRangeEnd',
  'commentReference',
  'bookmarkEnd',
  'permStart',
  'permEnd',
]);

/**
 * Whether [from, to] separates two same-author tracked deletions that should
 * still coalesce: same textblock, no other tracked change in range, no live
 * text, and any inline-leaf nodes present are zero-width anchors (comment /
 * bookmark markers) — run-wrapper boundaries carry no inline leaf at all.
 * Strictly more permissive than `isEmptyStructuralGap`, which rejects any
 * inline leaf and so would split a deletion at a Google-Docs comment seam.
 *
 * @param {*} ctx
 * @param {number} from
 * @param {number} to
 */
const isCoalescibleDeletionGap = (ctx, from, to) => {
  if (to <= from) return false;
  if (!sharesTextblock(ctx.tr.doc, from, to)) return false;
  if (ctx.graph.segmentsInRange(from, to).length) return false;
  if (ctx.tr.doc.textBetween(from, to, '', '')) return false;

  let blocked = false;
  ctx.tr.doc.nodesBetween(from, to, (node, pos) => {
    if (pos < from || pos >= to) return;
    if (node.isInline && node.isLeaf && !ZERO_WIDTH_ANCHOR_NODE_NAMES.has(node.type.name)) {
      blocked = true;
      return false;
    }
  });
  return !blocked;
};

const sharesTextblock = (doc, from, to) => {
  const left = textblockStart(doc, from);
  const right = textblockStart(doc, to);
  return left !== null && left === right;
};

const textblockStart = (doc, pos) => {
  const resolved = doc.resolve(Math.max(0, Math.min(doc.content.size, pos)));
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    if (resolved.node(depth).isTextblock) return resolved.start(depth);
  }
  return null;
};

const segmentsInRange = (ctx, from, to) => ctx.graph.segmentsInRange(from, to);

const insertSchema = (ctx) => ctx.schema.marks[TrackInsertMarkName];
const deleteSchema = (ctx) => ctx.schema.marks[TrackDeleteMarkName];

const makeInsertMark = (ctx, { id, overlapParentId = '', replacementGroupId = '', replacementSideId = '' }) => {
  const attrs = {
    id,
    author: ctx.intent.user.name || '',
    authorId: ctx.intent.user.id || '',
    authorEmail: ctx.intent.user.email || '',
    authorImage: ctx.intent.user.image || '',
    date: ctx.intent.date,
    sourceId: '',
    importedAuthor: '',
    revisionGroupId: id,
    splitFromId: '',
    // When part of a paired replacement, both halves persist the canonical
    // `replacement` changeType so the graph projects one logical change.
    changeType: replacementGroupId ? CanonicalChangeType.Replacement : CanonicalChangeType.Insertion,
    replacementGroupId,
    replacementSideId,
    overlapParentId,
    sourceIds: null,
    origin: '',
  };
  return insertSchema(ctx).create(attrs);
};

const makeDeleteMark = (ctx, { id, overlapParentId = '', replacementGroupId = '', replacementSideId = '' }) => {
  const attrs = {
    id,
    author: ctx.intent.user.name || '',
    authorId: ctx.intent.user.id || '',
    authorEmail: ctx.intent.user.email || '',
    authorImage: ctx.intent.user.image || '',
    date: ctx.intent.date,
    sourceId: '',
    importedAuthor: '',
    revisionGroupId: id,
    splitFromId: '',
    changeType: replacementGroupId ? CanonicalChangeType.Replacement : CanonicalChangeType.Deletion,
    replacementGroupId,
    replacementSideId,
    overlapParentId,
    sourceIds: null,
    origin: '',
  };
  return deleteSchema(ctx).create(attrs);
};

/**
 * Strip every tracked insert/delete mark from a slice's text nodes. The
 * compiler always re-marks inserted content under its own logical id, so
 * leftover marks from the caller would shadow that decision.
 *
 * @param {import('prosemirror-model').Slice} slice
 * @param {*} schema
 */
const stripTrackedMarksFromSlice = (slice, schema) => {
  if (!slice || slice === Slice.empty) return slice;
  const trackedMarkNames = new Set([TrackInsertMarkName, TrackDeleteMarkName, TrackFormatMarkName]);
  const stripFragment = (fragment) => {
    /** @type {Array<import('prosemirror-model').Node>} */
    const children = [];
    for (let i = 0; i < fragment.childCount; i += 1) {
      const child = fragment.child(i);
      if (child.isText) {
        const filtered = child.marks.filter((mark) => !trackedMarkNames.has(mark.type.name));
        children.push(filtered.length === child.marks.length ? child : child.mark(filtered));
      } else if (child.content?.childCount) {
        children.push(child.copy(stripFragment(child.content)));
      } else {
        children.push(child);
      }
    }
    return Fragment.from(children);
  };
  return new Slice(stripFragment(slice.content), slice.openStart, slice.openEnd);
};

// ---------------------------------------------------------------------------
// text-insert
// ---------------------------------------------------------------------------

/**
 * @param {*} ctx
 * @param {TrackedEditIntent & { kind: 'text-insert' }} intent
 * @returns {TrackedEditResult}
 */
const compileTextInsert = (ctx, intent) => {
  const { at, content } = intent;
  const docSize = ctx.tr.doc.content.size;
  if (at < 0 || at > docSize) {
    return failure('INVALID_TARGET', `text-insert position ${at} out of range [0, ${docSize}].`);
  }

  const sanitizedSlice = stripTrackedMarksFromSlice(content ?? Slice.empty, ctx.schema);
  if (!sanitizedSlice.content.size) {
    return failure('INVALID_TARGET', 'text-insert requires non-empty content.');
  }

  // Resolve overlap context at the insertion point.
  const containing = findContainingSegment(ctx, at);
  const overlapParent = containing && containing.from < at && containing.to > at ? containing : null;
  const boundaryAdjacent =
    !overlapParent && containing && (containing.to === at || containing.from === at) ? containing : null;
  const emptyGapAdjacent = !overlapParent && !boundaryAdjacent ? findSegmentAcrossEmptyStructuralGap(ctx, at) : null;
  const exactAdjacentInserted = findAdjacentInsertedSegment(ctx, at);

  // Same-user refinement targets: own insertion that strictly contains `at`,
  // an own-insertion edge we are adjacent to, OR the same edge separated only
  // by run-wrapper position gaps. Refinement uses the
  // permissive `isSameUserForRefinement` check so contiguous typing by the
  // default unidentified user (no email) still coalesces into one id —
  // matching the legacy `findTrackedMarkBetween({ authorEmail: '' })`
  // behavior. Permission and overlap-parent decisions still go through the
  // high-confidence `classifySegment` gate.
  const refinementTarget = exactAdjacentInserted
    ? exactAdjacentInserted
    : overlapParent && overlapParent.side === SegmentSide.Inserted && isSameUserForRefinement(ctx, overlapParent)
      ? overlapParent
      : boundaryAdjacent &&
          boundaryAdjacent.side === SegmentSide.Inserted &&
          isSameUserForRefinement(ctx, boundaryAdjacent)
        ? boundaryAdjacent
        : emptyGapAdjacent &&
            emptyGapAdjacent.side === SegmentSide.Inserted &&
            isSameUserForRefinement(ctx, emptyGapAdjacent)
          ? emptyGapAdjacent
          : null;

  if (refinementTarget) {
    const refinedId = refinementTarget.changeId;
    const insertedMark = makeInsertMark(ctx, {
      id: refinedId,
      overlapParentId: refinementTarget.attrs.overlapParentId || '',
      replacementGroupId: refinementTarget.attrs.replacementGroupId || '',
      replacementSideId: refinementTarget.attrs.replacementSideId || '',
    });
    return applyInsert(ctx, at, sanitizedSlice, insertedMark, refinedId, { update: true });
  }

  // Different-user content (or any non-insertion parent): exact location,
  // create a child insertion. For different-user inserted parent the rule is
  // the same — refine semantically with a new id and `overlapParentId`.
  if (overlapParent) {
    const childId = intent.replacementGroupHint || uuidv4();
    const overlapParentId = overlapParent.changeId;
    const insertedMark = makeInsertMark(ctx, { id: childId, overlapParentId });
    return applyInsert(ctx, at, sanitizedSlice, insertedMark, childId, { create: true });
  }

  // No overlap — fresh insertion at the cursor.
  const newId = intent.replacementGroupHint || uuidv4();
  const insertedMark = makeInsertMark(ctx, { id: newId });
  return applyInsert(ctx, at, sanitizedSlice, insertedMark, newId, { create: true });
};

/**
 * @param {*} ctx
 * @param {number} at
 * @param {import('prosemirror-model').Slice} slice
 * @param {import('prosemirror-model').Mark} insertMark
 * @param {string} changeId
 * @param {{ update?: boolean, create?: boolean }} flags
 * @returns {TrackedEditResult}
 */
const applyInsert = (ctx, at, slice, insertMark, changeId, { update, create }) => {
  const beforeSize = ctx.tr.doc.content.size;
  try {
    ctx.tr.replaceRange(at, at, slice);
  } catch (error) {
    return failure('INVALID_TARGET', /** @type {Error} */ (error).message ?? 'replaceRange failed.');
  }
  const afterSize = ctx.tr.doc.content.size;
  if (afterSize === beforeSize) {
    return failure('INVALID_TARGET', 'text-insert did not change the document.');
  }

  const insertedFrom = at;
  const insertedTo = at + (afterSize - beforeSize);

  // Re-apply tracked-insert mark over the inserted range. The slice
  // contained no tracked marks (we stripped them), so this is the canonical
  // marking.
  ctx.tr.addMark(insertedFrom, insertedTo, insertMark);

  if (create) ctx.createdChangeIds.push(changeId);
  else if (update) ctx.updatedChangeIds.push(changeId);

  /** @type {Array<import('prosemirror-model').Node>} */
  const insertedNodes = [];
  ctx.tr.doc.nodesBetween(insertedFrom, insertedTo, (node) => {
    if (node.isInline) insertedNodes.push(node);
  });

  return {
    ok: true,
    tr: ctx.tr,
    createdChangeIds: ctx.createdChangeIds,
    updatedChangeIds: ctx.updatedChangeIds,
    removedChangeIds: ctx.removedChangeIds,
    remappedChangeIds: ctx.remappedChangeIds,
    selection: { kind: 'near', pos: insertedTo, bias: 1 },
    insertedMark: insertMark,
    insertedFrom,
    insertedTo,
    insertedNodes,
  };
};

// ---------------------------------------------------------------------------
// text-delete
// ---------------------------------------------------------------------------

/**
 * Delete one inline byte range, decomposed by graph segments.
 *
 * Behavior per segment:
 *   - own-insertion (covered/partial) → collapse: remove the inserted slice
 *   - other-insertion → child trackDelete with overlapParentId
 *   - existing deletion → no-op (plain delete preserves existing review ids)
 *   - live content → trackDelete mark
 *
 * @param {*} ctx
 * @param {import('./edit-intent.js').TrackedEditIntent & { kind: 'text-delete' }} intent
 * @returns {TrackedEditResult}
 */
const compileTextDelete = (ctx, intent) => {
  const docSize = ctx.tr.doc.content.size;
  if (intent.from < 0 || intent.to > docSize) {
    return failure('INVALID_TARGET', `text-delete range [${intent.from}, ${intent.to}] out of bounds.`);
  }
  if (intent.from === intent.to) {
    return failure('INVALID_TARGET', 'text-delete requires a non-empty range.');
  }

  // Coalesce contiguous same-user keystroke deletions. When this delete range
  // is immediately adjacent to the current user's own unresolved tracked
  // deletion, reuse that change's id so a run deleted character-by-character
  // (e.g. holding Backspace) surfaces as ONE logical tracked deletion rather
  // than one review object per keystroke — mirroring the same-user insertion
  // refinement in compileTextInsert (TC-EDIT-018). Replacement-driven deletes
  // keep their caller-provided pairing id; preserve-review-state edits never
  // fold into an existing change.
  //
  // Date semantics: the new run is marked with this edit's date while the
  // existing runs keep theirs, so one changeId can span runs with mixed dates
  // (the same as same-user insertion refinement, and as coalescing into an
  // imported older-session same-author deletion — both intentional). This does
  // not create ambiguity: the read model takes the change date from the first
  // segment (review-graph buildLogicalChange `primary = segments[0]`), and on
  // export mergeConsecutiveTrackedChanges joins the per-run w:del/w:ins wrappers
  // by w:id and keeps the first wrapper's attributes — so one logical deletion
  // exports as a single w:del with the first run's w:date, and the panel shows
  // that same date.
  const coalesceTarget =
    intent.replacementGroupHint || intent.preserveExistingReviewState
      ? null
      : findAdjacentDeletedSegment(ctx, intent.from, intent.to);
  const sharedDeletionId = intent.replacementGroupHint || coalesceTarget?.changeId || null;

  const result = applyTrackedDelete(ctx, intent.from, intent.to, {
    replacementGroupId: '',
    replacementSideId: '',
    sharedDeletionId,
    recordSharedDeletionId: Boolean(intent.replacementGroupHint),
    reassignExistingDeletions:
      intent.source !== 'native' && !intent.preserveExistingReviewState ? 'different-user' : false,
  });
  if (result.ok === false) return result;

  // Folding into an existing deletion is an update to that change, not a new
  // one. applyTrackedDelete suppresses the created-id record when a shared id
  // is supplied without recordSharedDeletionId, so surface it as updated here.
  if (coalesceTarget && !ctx.updatedChangeIds.includes(coalesceTarget.changeId)) {
    ctx.updatedChangeIds.push(coalesceTarget.changeId);
  }

  // Caret at original `from`: matches Word's behavior where the cursor sits
  // at the left edge of a tracked deletion.
  return {
    ok: true,
    tr: ctx.tr,
    createdChangeIds: ctx.createdChangeIds,
    updatedChangeIds: ctx.updatedChangeIds,
    removedChangeIds: ctx.removedChangeIds,
    remappedChangeIds: ctx.remappedChangeIds,
    selection: { kind: 'near', pos: intent.from, bias: -1 },
    deletionMark: result.deletionMarks[0] || null,
    deletionMarks: result.deletionMarks,
    deletionNodes: result.deletionNodes,
  };
};

/**
 * Apply tracked deletion semantics across [from, to], returning the marks
 * we wrote so callers (text-replace) can reuse the id.
 *
 * @param {*} ctx
 * @param {number} from
 * @param {number} to
 * @param {{ replacementGroupId: string, replacementSideId: string, sharedDeletionId: string | null, recordSharedDeletionId?: boolean, recordCollapsedIds?: boolean, reassignExistingDeletions?: ExistingDeletionReassignMode }} options
 * @returns {{ ok: true, deletionMarks: import('prosemirror-model').Mark[], deletionNodes: import('prosemirror-model').Node[], deletionId: string, mintedThisCall: boolean } | TrackedEditFailure}
 */
const applyTrackedDelete = (
  ctx,
  from,
  to,
  {
    replacementGroupId,
    replacementSideId,
    sharedDeletionId,
    recordSharedDeletionId = false,
    recordCollapsedIds = true,
    reassignExistingDeletions = false,
  },
) => {
  /** @type {Array<import('prosemirror-model').Mark>} */
  const deletionMarks = [];
  /** @type {Array<import('prosemirror-model').Node>} */
  const deletionNodes = [];
  // Walk inline leaf nodes and act per node. We never mutate while iterating
  // — collect operations first, then apply in reverse position order so
  // earlier positions remain stable.
  /** @type {Array<{ kind: 'collapse'|'mark-delete'|'reassign'|'noop', from: number, to: number, node?: import('prosemirror-model').Node, changeId?: string, parentId?: string, parentSide?: string, parentReplacementGroupId?: string, existingDeleteMarks?: Array<import('prosemirror-model').Mark> }>} */
  const ops = [];

  // Imported-insertion collapse rule (plan §4): no-email imported insertions
  // collapse only when they are truly unattributed, or when their no-email
  // display name matches the current user. Named different authors with no
  // email remain protected review state.
  const isImportedOwnInsertion = (mark) => {
    if (!mark) return false;
    return shouldCollapseNoEmailInsertion({
      currentUser: ctx.intent.user,
      insertionAttrs: mark.attrs,
    });
  };

  ctx.tr.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isInline || !node.isLeaf) return;
    if (node.type.name.includes('table')) return;
    const segFrom = Math.max(from, pos);
    const segTo = Math.min(to, pos + node.nodeSize);
    if (segFrom >= segTo) return;

    const insertMark = node.marks.find((m) => m.type.name === TrackInsertMarkName);
    const existingDelete = node.marks.find((m) => m.type.name === TrackDeleteMarkName);

    if (insertMark) {
      const segmentAtPos = ctx.graph.overlapAt(pos)[0] ?? null;
      const classification = classifyOwnership({
        currentUser: ctx.currentIdentity,
        change: getChangeAuthorIdentity(segmentAtPos?.attrs ?? insertMark.attrs),
      });
      const ownership = isSameUserHighConfidence(classification) ? 'same-user' : 'different-user';
      // Deleting inside your own pending insertion must shrink that insertion,
      // not stack a deletion on top of your own suggestion (SD-3352). Use the
      // same permissive same-author gate as typing, so this also holds for
      // users without an id/email (anonymous sessions).
      const sameUserForRefinement =
        ownership === 'same-user' || isSameUserForRefinement(ctx, segmentAtPos ?? { attrs: insertMark.attrs });
      const shouldCollapseOwnInsertion =
        !ctx.intent.preserveExistingReviewState && (sameUserForRefinement || isImportedOwnInsertion(insertMark));
      if (shouldCollapseOwnInsertion) {
        // Own insertion → collapse (remove proposed content).
        ops.push({ kind: 'collapse', from: segFrom, to: segTo, changeId: insertMark.attrs.id });
        return;
      }
      // Different-user inserted content → child trackDelete with overlapParentId.
      const parentId = insertMark.attrs.id;
      ops.push({
        kind: 'mark-delete',
        from: segFrom,
        to: segTo,
        node,
        parentId,
        parentSide: SegmentSide.Inserted,
      });
      return;
    }

    if (existingDelete) {
      const allExistingDeletes = node.marks.filter((m) => m.type.name === TrackDeleteMarkName);
      const deleteOwnership = classifyOwnership({
        currentUser: ctx.currentIdentity,
        change: getChangeAuthorIdentity(existingDelete.attrs),
      });
      const isDifferentUserDeletion = !isSameUserHighConfidence(deleteOwnership);
      const shouldReassignExistingDeletion =
        reassignExistingDeletions === 'all' ||
        (reassignExistingDeletions === 'different-user' && isDifferentUserDeletion);
      if (shouldReassignExistingDeletion) {
        ops.push({
          kind: 'reassign',
          from: segFrom,
          to: segTo,
          node,
          parentId: existingDelete.attrs.id || existingDelete.attrs.overlapParentId || '',
          existingDeleteMarks: allExistingDeletes,
        });
        return;
      }
      // Plain delete inside any existing deletion is already represented by
      // review state. Preserve the original mark ids and do not add a nested
      // delete unless the replacement path explicitly asked to reassign them.
      ops.push({ kind: 'noop', from: segFrom, to: segTo });
      return;
    }

    // Live content.
    ops.push({ kind: 'mark-delete', from: segFrom, to: segTo, node });
  });

  if (!ops.length) {
    return failure('CAPABILITY_UNAVAILABLE', `text-delete range [${from}, ${to}] has no inline text content to track.`);
  }

  // Apply in reverse so earlier positions stay stable for `collapse` ops.
  const sortedOps = [...ops].sort((a, b) => b.from - a.from);
  // Allocate a deletion id. For paired replacement, the caller provides one.
  const deletionId = sharedDeletionId ?? uuidv4();
  let mintedThisCall = false;
  const collapsedIds = new Set();

  for (const op of sortedOps) {
    if (op.kind === 'collapse') {
      try {
        ctx.tr.replaceRange(op.from, op.to, Slice.empty);
      } catch {
        // Defensive — if PM refuses the deletion, fail closed.
        return failure('INVALID_TARGET', `Cannot collapse own-insertion range [${op.from}, ${op.to}].`);
      }
      if (op.changeId) collapsedIds.add(op.changeId);
      continue;
    }
    if (op.kind === 'noop') continue;
    if (op.kind === 'reassign') {
      // Replacement over existing deletion: reassign deletion id to the new
      // deletion mark so the new replacement encloses the prior delete.
      const mark = makeDeleteMark(ctx, {
        id: deletionId,
        overlapParentId: op.parentId || '',
        replacementGroupId,
        replacementSideId,
      });
      try {
        for (const m of op.existingDeleteMarks ?? []) ctx.tr.removeMark(op.from, op.to, m);
        ctx.tr.addMark(op.from, op.to, mark);
        deletionMarks.push(mark);
        if (op.node) deletionNodes.push(op.node);
        if (!mintedThisCall) {
          if (!sharedDeletionId || recordSharedDeletionId) ctx.createdChangeIds.push(deletionId);
          mintedThisCall = true;
        }
      } catch (error) {
        return failure('INVALID_TARGET', /** @type {Error} */ (error).message ?? 'addMark failed.');
      }
      continue;
    }
    if (op.kind === 'mark-delete') {
      const mark = makeDeleteMark(ctx, {
        id: deletionId,
        overlapParentId: op.parentId || '',
        replacementGroupId,
        replacementSideId,
      });
      try {
        ctx.tr.addMark(op.from, op.to, mark);
        deletionMarks.push(mark);
        if (op.node) deletionNodes.push(op.node);
        if (!mintedThisCall) {
          if (!sharedDeletionId || recordSharedDeletionId) ctx.createdChangeIds.push(deletionId);
          mintedThisCall = true;
        }
      } catch (error) {
        return failure('INVALID_TARGET', /** @type {Error} */ (error).message ?? 'addMark failed.');
      }
    }
  }

  if (recordCollapsedIds && collapsedIds.size) {
    const finalGraph = buildReviewGraph({
      state: { doc: ctx.tr.doc },
      replacementsMode: ctx.replacements,
    });
    for (const id of collapsedIds) {
      if (finalGraph.changes.has(id)) ctx.updatedChangeIds.push(id);
      else ctx.removedChangeIds.push(id);
    }
  }

  return { ok: true, deletionMarks, deletionNodes, deletionId, mintedThisCall };
};

// ---------------------------------------------------------------------------
// text-replace
// ---------------------------------------------------------------------------

/**
 * @param {*} ctx
 * @param {TrackedEditIntent & { kind: 'text-replace' }} intent
 * @returns {TrackedEditResult}
 */
const compileTextReplace = (ctx, intent) => {
  const docSize = ctx.tr.doc.content.size;
  if (intent.from < 0 || intent.to > docSize) {
    return failure('INVALID_TARGET', `text-replace range [${intent.from}, ${intent.to}] out of bounds.`);
  }
  if (intent.from > intent.to) {
    return failure('INVALID_TARGET', 'text-replace `from` must be <= `to`.');
  }

  const sanitizedSlice = stripTrackedMarksFromSlice(intent.content ?? Slice.empty, ctx.schema);
  if (!sanitizedSlice.content.size && intent.from === intent.to) {
    return failure('INVALID_TARGET', 'text-replace requires a non-empty replacement or non-empty range.');
  }

  const segments = segmentsInRange(ctx, intent.from, intent.to);

  // Replacing text inside own insertion/replacement-inserted side refines
  // that inserted side. Rejecting the original insertion must still remove
  // all proposed content, including the replacement text.
  const ownInsertedTarget = getSingleFullyCoveringOwnInsertedSegment(ctx, segments, intent.from, intent.to);
  if (ownInsertedTarget && !intent.preserveExistingReviewState) {
    const deleteResult = applyTrackedDelete(ctx, intent.from, intent.to, {
      replacementGroupId: '',
      replacementSideId: '',
      sharedDeletionId: null,
      recordCollapsedIds: false,
    });
    if (deleteResult.ok === false) return deleteResult;

    if (!sanitizedSlice.content.size) {
      ctx.updatedChangeIds.push(ownInsertedTarget.changeId);
      return {
        ok: true,
        tr: ctx.tr,
        createdChangeIds: ctx.createdChangeIds,
        updatedChangeIds: ctx.updatedChangeIds,
        removedChangeIds: ctx.removedChangeIds,
        remappedChangeIds: ctx.remappedChangeIds,
        selection: { kind: 'near', pos: intent.from, bias: -1 },
      };
    }

    const insertMark = makeInsertMark(ctx, {
      id: ownInsertedTarget.changeId,
      overlapParentId: ownInsertedTarget.attrs.overlapParentId || '',
      replacementGroupId: ownInsertedTarget.attrs.replacementGroupId || '',
      replacementSideId: ownInsertedTarget.attrs.replacementSideId || '',
    });
    return applyInsert(
      ctx,
      clampToDocSize(ctx.tr.doc.content.size, intent.from),
      sanitizedSlice,
      insertMark,
      ownInsertedTarget.changeId,
      {
        update: true,
      },
    );
  }

  // SD-2335: replacing text inside own deletion preserves the deletion and
  // creates an insertion at the exact edit point. We detect this case by
  // looking at the segments in the original range before any mutation.
  const ownDeletionFullyCovers =
    segments.length > 0 &&
    segments.every(
      (s) =>
        s.side === SegmentSide.Deleted &&
        classifySegment(ctx, s) === 'same-user' &&
        s.from <= intent.from &&
        s.to >= intent.to,
    );

  if (ownDeletionFullyCovers && sanitizedSlice.content.size) {
    // Insertion at exact `from` — preserve original deletion as-is.
    const insertId = uuidv4();
    const insertMark = makeInsertMark(ctx, { id: insertId });
    return applyInsert(ctx, intent.from, sanitizedSlice, insertMark, insertId, { create: true });
  }

  // Different-user nested case: the replacement happens inside another author's
  // open review item. Each side must remain independently reviewable, so use
  // distinct ids and the exact edit location for the insertion.
  const replacementParentId = getReplacementParentId(ctx, segments);

  // Ordinary live replacement: use the proven "insert after deleted range"
  // algorithm so existing product behavior is preserved (paragraph order on
  // multi-paragraph replacements, SD-3044 shared-anchor rewrites,
  // accept-side text identity). The compiler is the single semantic center;
  // markInsertion / markDeletion are used as low-level primitives.
  return compileOrdinaryTextReplace(ctx, intent, sanitizedSlice, replacementParentId);
};

/**
 * Ordinary text replacement (no own-inserted refinement, no own-deletion
 * preservation). Mirrors the legacy `replaceStep` algorithm verbatim and is
 * the only ordinary-replacement implementation: there is no dual semantic
 * path. The compiler owns the decision tree; the legacy markInsertion /
 * markDeletion helpers are imported as low-level primitives.
 *
 * Order of operations:
 *   1. Optionally probe for an adjacent tracked-delete span (single-step
 *      user replace only; multi-step transactions don't probe).
 *   2. In a throwaway temp transaction, insert the original slice at the
 *      chosen position. Fall back to Slice.maxOpen on failure to make
 *      paste-into-textblock cases merge inline.
 *   3. Mark the inserted range with the insertion mark (refining same-user
 *      adjacent ids if present) in the temp tr.
 *   4. Extract the marked slice and apply it as a single condensed
 *      ReplaceStep on ctx.tr (so the tracked-transaction stays single-step).
 *   5. Run applyTrackedDelete on the original range to mark deletion (this
 *      may collapse own insertions, reassign existing deletions, etc.).
 *   6. Map insertedTo through the delete-induced mapping so the selection /
 *      meta still points after the inserted content.
 *
 * @param {*} ctx
 * @param {TrackedEditIntent & { kind: 'text-replace' }} intent
 * @param {import('prosemirror-model').Slice} sanitizedSlice
 * @param {string} replacementParentId
 * @returns {TrackedEditResult}
 */
const compileOrdinaryTextReplace = (ctx, intent, sanitizedSlice, replacementParentId) => {
  // In paired mode ordinary replacements share one id between insert/delete
  // sides. Nested replacements inside another author's pending change must
  // keep the child insertion and deletion as independently reviewable sides.
  const shouldPairReplacement = intent.replacements === 'paired' && !replacementParentId;
  const sharedId = shouldPairReplacement ? intent.replacementGroupHint || uuidv4() : null;
  const replacementGroupId = sharedId ?? '';

  // 1. Probe for adjacent tracked-delete span at intent.to - 1 (legacy
  //    behavior). Only applies for single-step user actions — plan-engine
  //    multi-step rewrites must not probe.
  let positionTo = replacementParentId ? intent.from : intent.to;
  if (intent.from !== intent.to && intent.probeForDeletionSpan) {
    const probePos = Math.max(intent.from, intent.to - 1);
    const deletionSpan = findMarkPosition(ctx.tr.doc, probePos, TrackDeleteMarkName);
    if (!replacementParentId && deletionSpan && deletionSpan.to > positionTo) positionTo = deletionSpan.to;
  }

  // 2. Build a temp insertion in a throwaway transaction so we can read the
  //    inserted positions and the marked slice. We then condense the result
  //    into a single ReplaceStep on ctx.tr.
  const baseParentIsTextblock = ctx.tr.doc.resolve(positionTo).parent?.isTextblock;
  const shouldPreferInlineInsertion = intent.from === intent.to && baseParentIsTextblock;

  const tryTempInsert = (slice) => {
    const tempTr = ctx.state.apply(ctx.tr).tr;
    const isEmptySlice = !slice || slice.content.size === 0;
    try {
      tempTr.replaceRange(positionTo, positionTo, slice ?? Slice.empty);
    } catch {
      return null;
    }
    if (!tempTr.docChanged && !isEmptySlice) return null;
    const insertedFrom = tempTr.mapping.map(positionTo, -1);
    const insertedTo = tempTr.mapping.map(positionTo, 1);
    if (insertedFrom === insertedTo) return { tempTr, insertedFrom, insertedTo };
    if (shouldPreferInlineInsertion && !tempTr.doc.resolve(insertedFrom).parent?.isTextblock) return null;
    return { tempTr, insertedFrom, insertedTo };
  };

  let insertion = null;
  if (sanitizedSlice.content.size) {
    const openSlice = Slice.maxOpen(sanitizedSlice.content, true);
    insertion = tryTempInsert(sanitizedSlice) || tryTempInsert(openSlice);
    if (!insertion) {
      return failure('CAPABILITY_UNAVAILABLE', 'replacement slice could not be inserted into the document.');
    }
  }

  /** @type {import('prosemirror-model').Mark | null} */
  let insertedMark = null;
  /** @type {import('prosemirror-model').Slice} */
  let trackedInsertedSlice = Slice.empty;
  /** @type {Array<import('prosemirror-model').Node>} */
  const insertedNodes = [];

  if (insertion && insertion.insertedFrom !== insertion.insertedTo) {
    const { tempTr, insertedFrom, insertedTo } = insertion;
    // Use the legacy markInsertion primitive so id reuse / refinement matches
    // existing behavior exactly for ordinary replacements. Nested replacements
    // force a fresh child insertion side under the parent.
    const forcedInsertId = sharedId || (replacementParentId ? uuidv4() : undefined);
    insertedMark = markInsertion({
      tr: tempTr,
      from: insertedFrom,
      to: insertedTo,
      user: ctx.intent.user,
      date: ctx.intent.date,
      id: forcedInsertId,
    });
    if (!insertedMark) {
      return failure('PRECONDITION_FAILED', 'Failed to create tracked insertion mark for replacement.');
    }
    if (replacementParentId || replacementGroupId) {
      const overlayMark = makeInsertMark(ctx, {
        id: insertedMark.attrs.id,
        overlapParentId: replacementParentId,
        replacementGroupId,
        replacementSideId: sharedId ? `${sharedId}#inserted` : '',
      });
      tempTr.removeMark(insertedFrom, insertedTo, insertedMark);
      tempTr.addMark(insertedFrom, insertedTo, overlayMark);
      insertedMark = overlayMark;
    }
    const insertId = /** @type {import('prosemirror-model').Mark} */ (insertedMark).attrs.id;
    if (!ctx.createdChangeIds.includes(insertId) && !ctx.updatedChangeIds.includes(insertId)) {
      ctx.createdChangeIds.push(insertId);
    }
    trackedInsertedSlice = tempTr.doc.slice(insertedFrom, insertedTo);
    tempTr.doc.nodesBetween(insertedFrom, insertedTo, (node) => {
      if (node.isInline) insertedNodes.push(node);
    });
  }

  // 3. Apply the condensed insertion step to ctx.tr.
  let insertedFromAbs = positionTo;
  let insertedToAbs = positionTo;
  let insertedLength = 0;
  /** @type {import('prosemirror-transform').ReplaceStep | null} */
  let condensedStep = null;
  if (trackedInsertedSlice && trackedInsertedSlice.content.size) {
    const stepIndexBeforeCondensed = ctx.tr.steps.length;
    condensedStep = new ReplaceStep(positionTo, positionTo, trackedInsertedSlice, false);
    if (ctx.tr.maybeStep(condensedStep).failed) {
      return failure('INVALID_TARGET', 'condensed insertion step failed to apply.');
    }
    // Record the actual inserted range using just the condensed step's map.
    const condensedMap = ctx.tr.steps[stepIndexBeforeCondensed].getMap();
    insertedFromAbs = condensedMap.map(positionTo, -1);
    insertedToAbs = condensedMap.map(positionTo, 1);
    insertedLength = insertedToAbs - insertedFromAbs;
  }

  // 4. Apply tracked delete on the original range. Ordinary replacements
  //    insert at or after intent.to, so the original range is stable. Nested
  //    replacements insert at intent.from; in that case remap the selected
  //    original text past the inserted child side before marking deletion.
  /** @type {Array<import('prosemirror-model').Mark>} */
  let deletionMarks = [];
  /** @type {Array<import('prosemirror-model').Node>} */
  let deletionNodes = [];
  /** @type {import('prosemirror-model').Mark | null} */
  let deletionMark = null;

  if (intent.from !== intent.to) {
    const stepsBefore = ctx.tr.steps.length;
    const deleteFrom = insertedLength > 0 && positionTo <= intent.from ? intent.from + insertedLength : intent.from;
    const deleteTo = insertedLength > 0 && positionTo <= intent.from ? intent.to + insertedLength : intent.to;
    const delResult = applyTrackedDelete(ctx, deleteFrom, deleteTo, {
      replacementGroupId,
      replacementSideId: sharedId ? `${sharedId}#deleted` : '',
      sharedDeletionId: sharedId,
      reassignExistingDeletions: sharedId || replacementParentId ? 'all' : false,
    });
    if (delResult.ok === false) return delResult;
    deletionMarks = delResult.deletionMarks;
    deletionMark = delResult.deletionMarks[0] || null;
    deletionNodes = delResult.deletionNodes;
    // Map inserted positions through delete steps so collapses don't strand
    // them past stale offsets.
    if (insertedLength > 0) {
      const delMapping = new Mapping();
      for (let i = stepsBefore; i < ctx.tr.steps.length; i += 1) {
        delMapping.appendMap(ctx.tr.steps[i].getMap());
      }
      insertedFromAbs = delMapping.map(insertedFromAbs, 1);
      insertedToAbs = delMapping.map(insertedToAbs, 1);
    }
  }

  /** @type {SelectionHint} */
  const selection =
    insertedLength > 0 ? { kind: 'near', pos: insertedToAbs, bias: 1 } : { kind: 'near', pos: intent.from, bias: -1 };

  return {
    ok: true,
    tr: ctx.tr,
    createdChangeIds: ctx.createdChangeIds,
    updatedChangeIds: ctx.updatedChangeIds,
    removedChangeIds: ctx.removedChangeIds,
    remappedChangeIds: ctx.remappedChangeIds,
    selection,
    insertedMark,
    insertedFrom: insertedFromAbs,
    insertedTo: insertedToAbs,
    insertedNodes,
    insertedStep: condensedStep,
    deletionMark,
    deletionMarks,
    deletionNodes,
  };
};

const clampToDocSize = (size, pos) => Math.max(0, Math.min(size, pos));

const getSingleFullyCoveringOwnInsertedSegment = (ctx, segments, from, to) => {
  if (!segments.length) return null;
  // Same permissive same-author gate as the delete half in applyTrackedDelete
  // (SD-3352): replacing text wholly inside your own pending insertion must
  // refine that insertion in place, including for anonymous sessions where the
  // high-confidence classification cannot confirm identity. Otherwise the
  // delete half collapses while the replacement text nests as a child
  // insertion under the user's own suggestion.
  const inserted = segments.filter(
    (s) => s.side === SegmentSide.Inserted && isSameUserForRefinement(ctx, s) && s.from <= from && s.to >= to,
  );
  if (inserted.length !== segments.length) return null;
  const [first] = inserted;
  if (!first) return null;
  return inserted.every((s) => s.changeId === first.changeId) ? first : null;
};

const getReplacementParentId = (ctx, segments) => {
  for (const segment of segments) {
    if (classifySegment(ctx, segment) !== 'different-user') continue;
    // An inserted segment that matches the permissive same-author refinement
    // gate (SD-3352, anonymous sessions) is the user's own pending content:
    // the delete half collapses it in applyTrackedDelete, so it must not be
    // classified as a different-user overlap parent for the inserted side.
    if (segment.side === SegmentSide.Inserted && isSameUserForRefinement(ctx, segment)) continue;
    if (segment.attrs?.overlapParentId) return segment.attrs.overlapParentId;
    return segment.changeId || '';
  }
  return '';
};

// ---------------------------------------------------------------------------
// format-apply / format-remove
// ---------------------------------------------------------------------------

/**
 * @param {*} ctx
 * @param {TrackedEditIntent & { kind: 'format-apply'|'format-remove' }} intent
 * @returns {TrackedEditResult}
 */
const compileFormat = (ctx, intent) => {
  if (!TrackedFormatMarkNames.includes(intent.mark.type.name)) {
    return failure('CAPABILITY_UNAVAILABLE', `Mark ${intent.mark.type.name} is not a tracked formatting mark.`);
  }

  const subranges = computeFormatLeafRanges(ctx, intent.from, intent.to);
  if (!subranges) return failure('CAPABILITY_UNAVAILABLE', 'format range crosses tracked-deleted content.');

  const trackFormatType = ctx.schema.marks[TrackFormatMarkName];
  const needsTrackFormat = subranges.some((range) => !range.fold);
  if (!trackFormatType && needsTrackFormat) {
    return failure('CAPABILITY_UNAVAILABLE', 'schema is missing trackFormat mark.');
  }

  /** @type {Array<import('prosemirror-model').Mark>} */
  const formatMarks = [];
  /** @type {string | null} */
  let sharedWid = null;

  for (const range of subranges) {
    if (range.fold) {
      if (intent.kind === 'format-apply') ctx.tr.addMark(range.from, range.to, intent.mark);
      else ctx.tr.removeMark(range.from, range.to, intent.mark);
      continue;
    }

    const result = applyTrackedFormatRange({
      ctx,
      intent,
      range,
      trackFormatType,
      sharedWid,
    });
    sharedWid = result.sharedWid;
    if (result.formatMark) {
      formatMarks.push(result.formatMark);
      if (!ctx.createdChangeIds.includes(result.formatMark.attrs.id)) {
        ctx.createdChangeIds.push(result.formatMark.attrs.id);
      }
    }
  }

  return {
    ok: true,
    tr: ctx.tr,
    createdChangeIds: ctx.createdChangeIds,
    updatedChangeIds: ctx.updatedChangeIds,
    removedChangeIds: ctx.removedChangeIds,
    remappedChangeIds: ctx.remappedChangeIds,
    formatMarks,
  };
};

/**
 * Collect leaf inline formatting ranges. Same-user inserted ranges fold the
 * live mark directly into the insertion; all other live/other-user inserted
 * ranges use the normal trackFormat snapshot model. Tracked-deleted content
 * fails closed because applying visual formatting there is not safely
 * representable as an independent review action.
 *
 * @returns {Array<{ from: number, to: number, fold: boolean, parentId?: string, node: import('prosemirror-model').Node }> | null}
 */
const computeFormatLeafRanges = (ctx, from, to) => {
  /** @type {Array<{ from: number, to: number, fold: boolean, parentId?: string, node: import('prosemirror-model').Node }>} */
  const ranges = [];
  let touchesDeletion = false;

  ctx.tr.doc.nodesBetween(from, to, (node, pos) => {
    if (touchesDeletion) return false;
    if (!node.isInline || node.type.name === 'run') return;

    const segFrom = Math.max(from, pos);
    const segTo = Math.min(to, pos + node.nodeSize);
    if (segFrom >= segTo) return;

    const deleteMark = node.marks.find((m) => m.type.name === TrackDeleteMarkName);
    if (deleteMark) {
      touchesDeletion = true;
      return false;
    }

    const insertMark = node.marks.find((m) => m.type.name === TrackInsertMarkName);
    if (insertMark) {
      const ownership = classifySegment(ctx, { attrs: insertMark.attrs });
      ranges.push({
        from: segFrom,
        to: segTo,
        fold: ownership === 'same-user',
        ...(ownership === 'same-user' ? {} : { parentId: insertMark.attrs.id }),
        node,
      });
      return;
    }

    ranges.push({ from: segFrom, to: segTo, fold: false, node });
  });

  if (touchesDeletion) return null;
  return ranges;
};

/**
 * Apply ordinary tracked formatting semantics for one leaf range, preserving
 * the previous snapshot behavior while allowing overlap-parent metadata when
 * formatting another user's inserted text.
 *
 * @param {{
 *   ctx: *,
 *   intent: TrackedEditIntent & { kind: 'format-apply'|'format-remove' },
 *   range: { from: number, to: number, parentId?: string, node: import('prosemirror-model').Node },
 *   trackFormatType: import('prosemirror-model').MarkType,
 *   sharedWid: string | null,
 * }} input
 * @returns {{ sharedWid: string | null, formatMark: import('prosemirror-model').Mark | null }}
 */
const applyTrackedFormatRange = ({ ctx, intent, range, trackFormatType, sharedWid }) => {
  if (intent.kind === 'format-apply') {
    return applyTrackedFormatAdd({ ctx, intent, range, trackFormatType, sharedWid });
  }
  return applyTrackedFormatRemove({ ctx, intent, range, trackFormatType, sharedWid });
};

const applyTrackedFormatAdd = ({ ctx, intent, range, trackFormatType, sharedWid }) => {
  const liveMarks = getLiveInlineMarksInRange({
    doc: ctx.tr.doc,
    from: range.from,
    to: range.to,
  });
  const existingChangeMark = liveMarks.find((mark) =>
    [TrackDeleteMarkName, TrackFormatMarkName].includes(mark.type.name),
  );
  const wid = existingChangeMark ? existingChangeMark.attrs.id : (sharedWid ?? uuidv4());

  ctx.tr.addMark(range.from, range.to, intent.mark);

  if (!hasMatchingMark(liveMarks, intent.mark)) {
    const formatChangeMark = liveMarks.find((mark) => mark.type.name === TrackFormatMarkName);
    let after = [];
    let before = [];

    if (formatChangeMark) {
      const beforeSnapshots = Array.isArray(formatChangeMark.attrs.before) ? formatChangeMark.attrs.before : [];
      const afterSnapshots = Array.isArray(formatChangeMark.attrs.after) ? formatChangeMark.attrs.after : [];
      const foundBefore = beforeSnapshots.find((mark) => markSnapshotMatchesStepMark(mark, intent.mark, true));

      if (foundBefore) {
        before = beforeSnapshots.filter((mark) => !markSnapshotMatchesStepMark(mark, intent.mark, true));
        after = afterSnapshots.filter((mark) => getTypeName(mark) !== intent.mark.type.name);
      } else {
        before = [...beforeSnapshots];
        after = upsertMarkSnapshotByType(afterSnapshots, {
          type: intent.mark.type.name,
          attrs: intent.mark.attrs,
        });
      }
    } else {
      const existingMarkOfSameType = liveMarks.find(
        (mark) =>
          mark.type.name === intent.mark.type.name &&
          ![TrackDeleteMarkName, TrackFormatMarkName].includes(mark.type.name),
      );
      before = existingMarkOfSameType
        ? [createMarkSnapshot(existingMarkOfSameType.type.name, existingMarkOfSameType.attrs)]
        : [];
      after = [createMarkSnapshot(intent.mark.type.name, intent.mark.attrs)];
    }

    if (isTrackFormatNoOp(before, after)) {
      if (formatChangeMark) ctx.tr.removeMark(range.from, range.to, formatChangeMark);
      return { sharedWid: wid, formatMark: null };
    }

    if (after.length || before.length) {
      const formatMark = createTrackFormatMark({
        ctx,
        trackFormatType,
        id: wid,
        before,
        after,
        parentId: range.parentId || '',
        existingFormatMark: formatChangeMark,
      });
      ctx.tr.addMark(range.from, range.to, formatMark);
      return { sharedWid: wid, formatMark };
    }

    if (formatChangeMark) ctx.tr.removeMark(range.from, range.to, formatChangeMark);
  }

  return { sharedWid: wid, formatMark: null };
};

const applyTrackedFormatRemove = ({ ctx, intent, range, trackFormatType, sharedWid }) => {
  const liveMarksBeforeRemove = getLiveInlineMarksInRange({
    doc: ctx.tr.doc,
    from: range.from,
    to: range.to,
  });
  ctx.tr.removeMark(range.from, range.to, intent.mark);

  if (!hasMatchingMark(liveMarksBeforeRemove, intent.mark)) {
    return { sharedWid, formatMark: null };
  }

  const formatChangeMark = liveMarksBeforeRemove.find((mark) => mark.type.name === TrackFormatMarkName);
  let after = [];
  let before = [];

  if (formatChangeMark) {
    const afterSnapshots = Array.isArray(formatChangeMark.attrs.after) ? formatChangeMark.attrs.after : [];
    const beforeSnapshots = Array.isArray(formatChangeMark.attrs.before) ? formatChangeMark.attrs.before : [];
    const foundAfter = afterSnapshots.find((mark) => markSnapshotMatchesStepMark(mark, intent.mark, true));

    if (foundAfter) {
      after = afterSnapshots.filter((mark) => !markSnapshotMatchesStepMark(mark, intent.mark, true));
      if (after.length === 0) {
        const remainingFormatMarks = liveMarksBeforeRemove.filter(
          (m) =>
            ![TrackDeleteMarkName, TrackFormatMarkName].includes(m.type.name) && m.type.name !== intent.mark.type.name,
        );
        const isNoop = beforeSnapshots.every((snapshot) =>
          remainingFormatMarks.some((m) => markSnapshotMatchesStepMark(snapshot, m, true)),
        );
        if (isNoop) {
          ctx.tr.removeMark(range.from, range.to, formatChangeMark);
          return { sharedWid: formatChangeMark.attrs.id || sharedWid, formatMark: null };
        }
      }
      before = [...beforeSnapshots];
    } else {
      after = [...afterSnapshots];
      before = upsertMarkSnapshotByType(beforeSnapshots, {
        type: intent.mark.type.name,
        attrs: intent.mark.attrs,
      });
    }
  } else {
    after = [];
    const existingMark = range.node.marks.find((mark) => mark.type === intent.mark.type);
    before = existingMark ? [createMarkSnapshot(intent.mark.type.name, existingMark.attrs)] : [];
  }

  if (after.length || before.length) {
    const wid = formatChangeMark ? formatChangeMark.attrs.id : (sharedWid ?? uuidv4());
    const formatMark = createTrackFormatMark({
      ctx,
      trackFormatType,
      id: wid,
      before,
      after,
      parentId: range.parentId || '',
      existingFormatMark: formatChangeMark,
    });
    ctx.tr.addMark(range.from, range.to, formatMark);
    return { sharedWid: wid, formatMark };
  }

  if (formatChangeMark) ctx.tr.removeMark(range.from, range.to, formatChangeMark);
  return { sharedWid: formatChangeMark?.attrs?.id || sharedWid, formatMark: null };
};

const createTrackFormatMark = ({ ctx, trackFormatType, id, before, after, parentId, existingFormatMark }) =>
  trackFormatType.create({
    id,
    sourceId: existingFormatMark?.attrs?.sourceId || '',
    author: ctx.intent.user.name || '',
    authorId: ctx.intent.user.id || '',
    authorEmail: ctx.intent.user.email || '',
    authorImage: ctx.intent.user.image || '',
    date: ctx.intent.date,
    before,
    after,
    importedAuthor: existingFormatMark?.attrs?.importedAuthor || '',
    revisionGroupId: existingFormatMark?.attrs?.revisionGroupId || id,
    splitFromId: existingFormatMark?.attrs?.splitFromId || '',
    changeType: CanonicalChangeType.Formatting,
    replacementGroupId: '',
    replacementSideId: '',
    overlapParentId: parentId || existingFormatMark?.attrs?.overlapParentId || '',
    sourceIds: existingFormatMark?.attrs?.sourceIds ?? null,
    origin: existingFormatMark?.attrs?.origin || '',
  });

/**
 * Find the segment that strictly contains `pos` if any. When no segment
 * strictly contains the position, returns the segment whose right edge is at
 * `pos` (for adjacent same-user refinement detection).
 */
const findContainingSegment = (ctx, pos) => findSegmentAt(ctx, pos);

// ---------------------------------------------------------------------------
// Diagnostics surfaced for telemetry/tests.
// ---------------------------------------------------------------------------

export const compilerInternalsForTest = { stripTrackedMarksFromSlice, classifySegment };
