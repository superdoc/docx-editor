import type { User } from '../../core/types/EditorConfig.js';
import { snapshotWordIdentity } from '@superdoc/common/helpers/word-identity';
/**
 * Comments convenience wrappers — bridge comments operations to the plan
 * engine's revision management and execution path.
 *
 * Read operations (list, get, goTo) are pure queries or non-mutating navigation.
 * Mutating operations (add, edit, reply, move, resolve, reopen, remove, setInternal, setActive)
 * delegate to editor commands with plan-engine revision tracking.
 */

import type { Editor } from '../../core/Editor.js';
import type {
  AddCommentInput,
  CommentTarget,
  CommentInfo,
  CommentTrackedChangeLink,
  CommentsAdapter,
  CommentsCreateReceipt,
  CommentsListQuery,
  CommentsListResult,
  EditCommentInput,
  GetCommentInput,
  GoToCommentInput,
  MoveCommentInput,
  Receipt,
  RemoveCommentInput,
  ReopenCommentInput,
  ReplyToCommentInput,
  ResolveCommentInput,
  RevisionGuardOptions,
  SelectionTarget,
  StoryLocator,
  SetCommentActiveInput,
  SetCommentInternalInput,
  TextSegment,
  TextTarget,
  TrackChangeType,
} from '@superdoc/document-api';
import { buildResolvedHandle, buildDiscoveryItem, buildDiscoveryResult } from '@superdoc/document-api';
import { TextSelection } from 'prosemirror-state';
import { v4 as uuidv4 } from 'uuid';
import { DocumentApiAdapterError } from '../errors.js';
import { requireEditorCommand } from '../helpers/mutation-helpers.js';
import { clearIndexCache, getBlockIndex } from '../helpers/index-cache.js';
import { checkRevision, getRevision, incrementRevision } from './revision-tracker.js';
import { resolveTextTarget, paginate, validatePaginationInput } from '../helpers/adapter-utils.js';
import { executeDomainCommand } from './plan-wrappers.js';
import { getCachedProjectedTrackedChangeSnapshot, projectSnapshots } from './track-changes-wrappers.js';
import {
  buildCommentJsonFromText,
  extractCommentText,
  type CommentEntityRecord,
  findCommentEntity,
  getCommentEntityStore,
  isCommentResolved,
  removeCommentEntityTree,
  restoreStashedCommentEntityTree,
  stashRemovedCommentEntities,
  toCommentInfo,
  upsertCommentEntity,
} from '../helpers/comment-entity-store.js';
import { listCommentAnchors, resolveCommentAnchorsById } from '../helpers/comment-target-resolver.js';
import { normalizeExcerpt, toNonEmptyString } from '../helpers/value-utils.js';
import { getTrackedChangeIndex } from '../tracked-changes/tracked-change-index.js';
import type { TrackedChangeSnapshot } from '../tracked-changes/tracked-change-snapshot.js';
import { resolveSelectionTarget } from '../helpers/selection-target-resolver.js';
import { resolveTrackedChangeInStory } from '../helpers/tracked-change-resolver.js';
import { projectInternalTrackChangeType } from '../helpers/tracked-change-type-utils.js';
import { BODY_STORY_KEY, buildStoryKey } from '../story-runtime/story-key.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type EditorUserIdentity = User;

type TrackedChangeCommentInfo = CommentInfo & {
  story?: StoryLocator;
  trackedChange?: boolean;
  trackedChangeType?: TrackChangeType;
  trackedChangeDisplayType?: string | null;
  trackedChangeStory?: StoryLocator | null;
  trackedChangeAnchorKey?: string;
  trackedChangeText?: string;
  deletedText?: string | null;
  trackedChangeLink?: CommentTrackedChangeLink | null;
};

function toCommentAddress(commentId: string): { kind: 'entity'; entityType: 'comment'; entityId: string } {
  return {
    kind: 'entity',
    entityType: 'comment',
    entityId: commentId,
  };
}

function toNotFoundError(input: unknown): DocumentApiAdapterError {
  return new DocumentApiAdapterError('TARGET_NOT_FOUND', 'Comment target could not be resolved.', {
    target: input,
  });
}

/**
 * Check whether a payload carries a complete TextAddress. The
 * document-api input validator accepts a payload if it satisfies either
 * `isTextAddress` or `isTextTarget`; neither validator rejects extra
 * fields, so a full hybrid payload (`{ kind: 'text', blockId, range,
 * segments }`) passes both. A complete TextAddress is more specific and
 * takes precedence over `segments`.
 */
function isTextAddressShape(
  target: unknown,
): target is { kind: 'text'; blockId: string; range: { start: number; end: number } } {
  if (!target || typeof target !== 'object') return false;
  const t = target as { kind?: unknown; blockId?: unknown; range?: unknown };
  if (t.kind !== 'text') return false;
  if (typeof t.blockId !== 'string') return false;
  return isTextRangeShape(t.range);
}

function isTextRangeShape(range: unknown): range is { start: number; end: number } {
  if (!range || typeof range !== 'object') return false;
  const r = range as { start?: unknown; end?: unknown };
  return Number.isInteger(r.start) && Number.isInteger(r.end) && (r.start as number) <= (r.end as number);
}

function isTextSegmentShape(segment: unknown): segment is TextSegment {
  if (!segment || typeof segment !== 'object') return false;
  const seg = segment as { blockId?: unknown; range?: unknown };
  return typeof seg.blockId === 'string' && isTextRangeShape(seg.range);
}

/**
 * Check whether a payload should be routed through the multi-segment
 * TextTarget branch. Extra partial TextAddress fields are ignored here:
 * a stray `blockId` without `range`, or `range` without `blockId`, is
 * not enough to override a valid `segments` payload.
 */
function isTextTargetShape(target: unknown): target is TextTarget {
  if (!target || typeof target !== 'object') return false;
  const t = target as { kind?: unknown; segments?: unknown };
  if (t.kind !== 'text') return false;
  if (!Array.isArray(t.segments) || t.segments.length === 0) return false;
  if (!t.segments.every(isTextSegmentShape)) return false;
  return true;
}

/**
 * Normalize the text-addressable comment target shapes into an array of
 * segments. For TextAddress, the result is a single-entry array.
 */
function targetToSegments(target: CommentTarget): TextSegment[] | null {
  if (isTextAddressShape(target)) return [{ blockId: target.blockId, range: target.range }];
  if (isTextTargetShape(target)) return [...target.segments];
  return null;
}

function isTrackedChangeCommentTargetShape(
  target: unknown,
): target is { trackedChangeId: string; story?: StoryLocator } {
  if (!target || typeof target !== 'object') return false;
  const value = target as { kind?: unknown; trackedChangeId?: unknown };
  if (value.kind !== undefined && value.kind !== 'trackedChange') return false;
  return typeof value.trackedChangeId === 'string' && value.trackedChangeId.length > 0;
}

function trackedChangeDisplayType(snapshot: TrackedChangeSnapshot): string | null {
  if (snapshot.type !== 'structural') return null;
  return snapshot.subtype === 'table-delete' ? 'tableDelete' : 'tableInsert';
}

function publicTrackedChangeType(snapshot: TrackedChangeSnapshot): TrackChangeType {
  return projectInternalTrackChangeType(snapshot.type, { subtype: snapshot.subtype });
}

function buildTrackedChangeLink(snapshot: TrackedChangeSnapshot): CommentTrackedChangeLink {
  const { trackedChangeText, deletedText } = trackedChangeTextFields(snapshot);
  return {
    trackedChange: true,
    trackedChangeId: snapshot.address.entityId,
    trackedChangeType: publicTrackedChangeType(snapshot),
    trackedChangeDisplayType: trackedChangeDisplayType(snapshot),
    trackedChangeStory: snapshot.story,
    trackedChangeAnchorKey: snapshot.anchorKey,
    trackedChangeText,
    deletedText,
  };
}

function getTrackedChangeThreadingId(snapshot: TrackedChangeSnapshot): string | null {
  return snapshot.commandRawId ?? snapshot.runtimeRef.rawId ?? snapshot.address.entityId ?? null;
}

function trackedChangeSnapshotAliases(snapshot: TrackedChangeSnapshot): string[] {
  return Array.from(
    new Set(
      [
        snapshot.address.entityId,
        snapshot.runtimeRef.rawId,
        snapshot.commandRawId,
        snapshot.replacementGroupId,
        snapshot.replacementSideId,
        snapshot.anchorKey,
      ].filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  );
}

function overlapsTrackedChangeRange(snapshot: TrackedChangeSnapshot, from: number, to: number): boolean {
  if (from === to) {
    return snapshot.range.from <= from && snapshot.range.to >= to;
  }
  return snapshot.range.from < to && snapshot.range.to > from;
}

function trackedChangeTypePriority(type: TrackChangeType): number {
  if (type === 'delete') return 0;
  if (type === 'format') return 1;
  return 2;
}

function choosePreferredTrackedChangeSnapshot(
  snapshots: ReadonlyArray<TrackedChangeSnapshot>,
  preferredId?: string,
): TrackedChangeSnapshot | null {
  if (snapshots.length === 0) return null;

  const preferred = preferredId ? String(preferredId) : null;
  const ordered = [...snapshots].sort((left, right) => {
    const leftMatchesPreferred = preferred
      ? trackedChangeSnapshotAliases(left).some((alias) => alias === preferred)
      : false;
    const rightMatchesPreferred = preferred
      ? trackedChangeSnapshotAliases(right).some((alias) => alias === preferred)
      : false;
    if (leftMatchesPreferred !== rightMatchesPreferred) {
      return leftMatchesPreferred ? -1 : 1;
    }

    const leftLength = Math.max(0, left.range.to - left.range.from);
    const rightLength = Math.max(0, right.range.to - right.range.from);
    if (leftLength !== rightLength) return leftLength - rightLength;

    const typeDelta =
      trackedChangeTypePriority(publicTrackedChangeType(left)) -
      trackedChangeTypePriority(publicTrackedChangeType(right));
    if (typeDelta !== 0) return typeDelta;

    if (left.range.from !== right.range.from) return left.range.from - right.range.from;
    return left.address.entityId.localeCompare(right.address.entityId);
  });

  return ordered[0] ?? null;
}

function inferTrackedChangeSnapshotForRange(
  editor: Editor,
  from: number,
  to: number,
  preferredId?: string,
): TrackedChangeSnapshot | null {
  let snapshots: ReadonlyArray<TrackedChangeSnapshot>;
  try {
    snapshots = getTrackedChangeIndex(editor).getAll();
  } catch {
    return null;
  }

  const overlapping = snapshots.filter((snapshot) => overlapsTrackedChangeRange(snapshot, from, to));
  return choosePreferredTrackedChangeSnapshot(overlapping, preferredId);
}

function assignTrackedChangeLink(info: TrackedChangeCommentInfo, link: CommentTrackedChangeLink | null): void {
  if (!link) {
    delete info.trackedChange;
    delete info.trackedChangeType;
    delete info.trackedChangeDisplayType;
    delete info.trackedChangeStory;
    delete info.trackedChangeAnchorKey;
    delete info.trackedChangeText;
    delete info.deletedText;
    info.trackedChangeLink = null;
    return;
  }

  info.trackedChange = true;
  info.trackedChangeType = link.trackedChangeType;
  info.trackedChangeDisplayType = link.trackedChangeDisplayType ?? undefined;
  info.trackedChangeStory = link.trackedChangeStory ?? undefined;
  info.trackedChangeAnchorKey = link.trackedChangeAnchorKey ?? undefined;
  info.trackedChangeText = link.trackedChangeText ?? undefined;
  info.deletedText = link.deletedText ?? undefined;
  info.trackedChangeLink = link;
}

function listCommentAnchorsSafe(editor: Editor): ReturnType<typeof listCommentAnchors> {
  try {
    return listCommentAnchors(editor);
  } catch {
    return [];
  }
}

/**
 * SD-3214: emit the canonical `commentsUpdate` event from Document-API
 * wrappers for engine commands that don't emit themselves (resolveComment,
 * reopenComment, removeComment). This lets downstream subscribers — the
 * headless collaboration bridge, the browser's onCommentsUpdate callback
 * pipeline, and the user's `onCommentsUpdate` config hook — react to
 * `editor.doc.comments.*` mutations symmetrically with how `addComment`
 * and `editComment` already broadcast.
 *
 * Browser side stays unaffected for the manual commentsStore path (which
 * calls `editor.commands.removeComment` directly), because that path
 * never goes through these wrappers.
 */
function emitCommentLifecycleUpdate(
  editor: Editor,
  type: 'deleted' | 'update' | 'resolved',
  comment: Record<string, unknown>,
): void {
  const emitter = (editor as unknown as { emit?: (event: string, payload: unknown) => void }).emit;
  if (typeof emitter !== 'function') return;
  emitter.call(editor, 'commentsUpdate', { type, comment });
}

function emitCommentAdd(editor: Editor, comment: Record<string, unknown>, activeCommentId?: string): void {
  const emitter = (editor as unknown as { emit?: (event: string, payload: unknown) => void }).emit;
  if (typeof emitter !== 'function') return;
  emitter.call(editor, 'commentsUpdate', {
    type: 'add',
    comment,
    ...(activeCommentId ? { activeCommentId } : {}),
  });
}

function applyTextSelection(editor: Editor, from: number, to: number): boolean {
  const setTextSelection = editor.commands?.setTextSelection;
  if (typeof setTextSelection === 'function') {
    if (setTextSelection({ from, to }) === true) return true;
  }

  if (editor.state?.tr && typeof editor.dispatch === 'function') {
    try {
      const tr = editor.state.tr
        .setSelection(TextSelection.create(editor.state.doc, from, to))
        .setMeta('inputType', 'programmatic');
      editor.dispatch(tr);
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

function resolveCommentIdentity(
  editor: Editor,
  commentId: string,
): {
  commentId: string;
  importedId?: string;
  anchors: ReturnType<typeof resolveCommentAnchorsById>;
} {
  const store = getCommentEntityStore(editor);
  const record = findCommentEntity(store, commentId);
  const canonicalCommentIdFromRecord = toNonEmptyString(record?.commentId);
  const importedIdFromRecord = toNonEmptyString(record?.importedId);

  const anchorCandidates = [
    ...resolveCommentAnchorsById(editor, commentId),
    ...(canonicalCommentIdFromRecord && canonicalCommentIdFromRecord !== commentId
      ? resolveCommentAnchorsById(editor, canonicalCommentIdFromRecord)
      : []),
    ...(importedIdFromRecord &&
    importedIdFromRecord !== commentId &&
    importedIdFromRecord !== canonicalCommentIdFromRecord
      ? resolveCommentAnchorsById(editor, importedIdFromRecord)
      : []),
  ];

  const seen = new Set<string>();
  const anchors = anchorCandidates.filter((anchor) => {
    const key = `${anchor.commentId}|${anchor.importedId ?? ''}|${anchor.pos}|${anchor.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const canonicalCommentId = canonicalCommentIdFromRecord ?? anchors[0]?.commentId;

  if (!canonicalCommentId) {
    throw toNotFoundError({ commentId });
  }

  const importedId = importedIdFromRecord ?? anchors[0]?.importedId;

  return {
    commentId: canonicalCommentId,
    importedId,
    anchors,
  };
}

/**
 * A canonicalized anchor with merged same-block overlapping/adjacent ranges.
 * Carries both block-relative segment data (for TextTarget output) and
 * absolute PM positions (for text extraction).
 */
type CanonicalAnchor = {
  blockId: string;
  range: { start: number; end: number };
  pos: number;
  end: number;
};

type CanonicalAnchorMap = Map<string, CanonicalAnchor[]>;

/**
 * Merges same-block adjacent/overlapping anchors into canonical segments.
 *
 * Anchors MUST be pre-sorted in document order (by pos, then end).
 * Two same-block anchors merge when `next.range.start <= current.range.end`
 * (covers both overlap and adjacency). Cross-block anchors are always kept
 * as separate segments.
 */
function canonicalizeAnchors(sorted: ReturnType<typeof listCommentAnchors>): CanonicalAnchor[] {
  if (sorted.length === 0) return [];

  const result: CanonicalAnchor[] = [];
  let current: CanonicalAnchor = {
    blockId: sorted[0].target.blockId,
    range: { start: sorted[0].target.range.start, end: sorted[0].target.range.end },
    pos: sorted[0].pos,
    end: sorted[0].end,
  };

  for (let i = 1; i < sorted.length; i++) {
    const anchor = sorted[i];
    const sameBlock = anchor.target.blockId === current.blockId;
    const overlapsOrAdjacent = anchor.target.range.start <= current.range.end;

    if (sameBlock && overlapsOrAdjacent) {
      current.range.end = Math.max(current.range.end, anchor.target.range.end);
      current.end = Math.max(current.end, anchor.end);
    } else {
      result.push(current);
      current = {
        blockId: anchor.target.blockId,
        range: { start: anchor.target.range.start, end: anchor.target.range.end },
        pos: anchor.pos,
        end: anchor.end,
      };
    }
  }

  result.push(current);
  return result;
}

/**
 * Extracts and normalizes text for a single canonical anchor span.
 * Strips object-replacement characters (\ufffc) emitted for atom nodes
 * (e.g. commentRangeStart/commentRangeEnd).
 */
function extractSegmentText(editor: Editor, pos: number, end: number): string | undefined {
  try {
    const raw = editor.state.doc.textBetween(pos, end, ' ', '\ufffc');
    const cleaned = raw.replace(/\ufffc/g, '').trim();
    return cleaned.length > 0 ? cleaned : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Builds anchoredText from canonicalized anchors, joining segment texts
 * with spaces and normalizing the combined result.
 */
function buildAnchoredText(editor: Editor, canonical: CanonicalAnchor[]): string | undefined {
  const parts: string[] = [];
  for (const anchor of canonical) {
    const text = extractSegmentText(editor, anchor.pos, anchor.end);
    if (text) parts.push(text);
  }
  return parts.length > 0 ? normalizeExcerpt(parts.join(' ')) : undefined;
}

/**
 * Converts canonicalized anchors into a TextTarget with segments
 * in document order.
 */
function buildTextTarget(canonical: CanonicalAnchor[]): TextTarget | undefined {
  if (canonical.length === 0) return undefined;

  const segments: TextSegment[] = canonical.map((a) => ({
    blockId: a.blockId,
    range: { start: a.range.start, end: a.range.end },
  }));

  return { kind: 'text', segments: segments as [TextSegment, ...TextSegment[]] };
}

/**
 * Groups all comment anchors by commentId, then merges anchor data (target,
 * anchoredText, status) into the corresponding CommentInfo records.
 *
 * Unlike the single-anchor approach, this collects ALL anchors per comment
 * into a multi-segment TextTarget, preserving cross-block and discontinuous
 * anchor fidelity.
 */
function mergeAnchorData(
  editor: Editor,
  infosById: Map<string, CommentInfo>,
  anchors: ReturnType<typeof listCommentAnchors>,
): CanonicalAnchorMap {
  const grouped = new Map<string, typeof anchors>();
  const canonicalByCommentId: CanonicalAnchorMap = new Map();
  for (const anchor of anchors) {
    const group = grouped.get(anchor.commentId) ?? [];
    group.push(anchor);
    grouped.set(anchor.commentId, group);
  }

  for (const [commentId, commentAnchors] of grouped.entries()) {
    const sorted = [...commentAnchors].sort((a, b) => (a.pos === b.pos ? a.end - b.end : a.pos - b.pos));
    const firstAnchor = sorted[0];
    const status = sorted.every((anchor) => anchor.status === 'resolved') ? 'resolved' : 'open';
    const canonical = canonicalizeAnchors(sorted);
    canonicalByCommentId.set(commentId, canonical);
    const target = buildTextTarget(canonical);
    const anchoredText = buildAnchoredText(editor, canonical);
    const existing = infosById.get(commentId);

    if (existing) {
      if (!existing.target && target) existing.target = target;
      if (!existing.importedId && firstAnchor.importedId) existing.importedId = firstAnchor.importedId;
      if (existing.isInternal == null && firstAnchor.isInternal != null) existing.isInternal = firstAnchor.isInternal;
      if (status === 'open') existing.status = 'open';
      if (existing.anchoredText == null && anchoredText != null) existing.anchoredText = anchoredText;
      continue;
    }

    infosById.set(
      commentId,
      toCommentInfo(
        {
          commentId,
          importedId: firstAnchor.importedId,
          isInternal: firstAnchor.isInternal,
          isDone: status === 'resolved',
        },
        {
          target,
          status,
          anchoredText,
        },
      ),
    );
  }

  return canonicalByCommentId;
}

function parseCreatedTime(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function trackedChangeTextFields(
  snapshot: TrackedChangeSnapshot,
): Pick<TrackedChangeCommentInfo, 'trackedChangeText' | 'deletedText'> {
  const excerpt = snapshot.excerpt ?? '';
  if (publicTrackedChangeType(snapshot) === 'delete') {
    return { trackedChangeText: '', deletedText: excerpt };
  }
  return { trackedChangeText: excerpt, deletedText: null };
}

function toTrackedChangeCommentInfo(snapshot: TrackedChangeSnapshot): TrackedChangeCommentInfo | null {
  const commentId = toNonEmptyString(snapshot.address.entityId);
  if (!commentId) return null;

  const { trackedChangeText, deletedText } = trackedChangeTextFields(snapshot);
  const trackedChangeLink = buildTrackedChangeLink(snapshot);

  return {
    address: toCommentAddress(commentId),
    commentId,
    text: trackedChangeText || deletedText || undefined,
    status: 'open',
    creatorName: snapshot.author,
    creatorEmail: snapshot.authorEmail,
    createdTime: parseCreatedTime(snapshot.date),
    anchoredText: snapshot.excerpt,
    story: snapshot.story,
    trackedChange: true,
    trackedChangeType: publicTrackedChangeType(snapshot),
    trackedChangeDisplayType: trackedChangeDisplayType(snapshot),
    trackedChangeStory: snapshot.story,
    trackedChangeAnchorKey: snapshot.anchorKey,
    trackedChangeText,
    deletedText,
    trackedChangeLink,
  };
}

function mergeTrackedChangeCommentInfos(editor: Editor, infosById: Map<string, TrackedChangeCommentInfo>): void {
  let trackedChanges: ReadonlyArray<TrackedChangeSnapshot>;
  try {
    trackedChanges = getTrackedChangeIndex(editor).getAll();
  } catch {
    return;
  }

  for (const snapshot of trackedChanges) {
    const trackedChangeComment = toTrackedChangeCommentInfo(snapshot);
    if (!trackedChangeComment) continue;

    const existing = infosById.get(trackedChangeComment.commentId);
    if (!existing) {
      if (snapshot.wordRevisionIds) continue;
      infosById.set(trackedChangeComment.commentId, trackedChangeComment);
      continue;
    }

    Object.assign(existing, {
      story: trackedChangeComment.story,
      trackedChange: true,
      trackedChangeType: trackedChangeComment.trackedChangeType,
      trackedChangeStory: trackedChangeComment.trackedChangeStory,
      trackedChangeAnchorKey: trackedChangeComment.trackedChangeAnchorKey,
      trackedChangeText: trackedChangeComment.trackedChangeText,
      deletedText: trackedChangeComment.deletedText,
      anchoredText: existing.anchoredText ?? trackedChangeComment.anchoredText,
      creatorName: existing.creatorName ?? trackedChangeComment.creatorName,
      creatorEmail: existing.creatorEmail ?? trackedChangeComment.creatorEmail,
      createdTime: existing.createdTime ?? trackedChangeComment.createdTime,
      trackedChangeLink: trackedChangeComment.trackedChangeLink,
    });
  }
}

function buildCommentInfos(editor: Editor): TrackedChangeCommentInfo[] {
  const anchors = listCommentAnchorsSafe(editor);
  const anchoredCommentIds = Array.from(new Set(anchors.map((anchor) => anchor.commentId)));
  for (const commentId of anchoredCommentIds) {
    restoreStashedCommentEntityTree(editor, commentId);
  }

  const store = getCommentEntityStore(editor);
  const infosById = new Map<string, TrackedChangeCommentInfo>();

  for (const entry of store) {
    const commentId = toNonEmptyString(entry.commentId) ?? toNonEmptyString(entry.importedId) ?? null;
    if (!commentId) continue;
    infosById.set(commentId, toCommentInfo({ ...entry, commentId }));
  }

  const canonicalByCommentId = mergeAnchorData(editor, infosById, anchors);
  mergeTrackedChangeCommentInfos(editor, infosById);

  for (const [commentId, canonical] of canonicalByCommentId.entries()) {
    const info = infosById.get(commentId);
    if (!info || canonical.length === 0) continue;

    const from = canonical[0]?.pos ?? 0;
    const to = canonical[canonical.length - 1]?.end ?? from;
    const preferredTrackedChangeId = toNonEmptyString(findCommentEntity(store, commentId)?.trackedChangeParentId);
    const snapshot = inferTrackedChangeSnapshotForRange(editor, from, to, preferredTrackedChangeId);
    assignTrackedChangeLink(info, snapshot ? buildTrackedChangeLink(snapshot) : null);
  }

  // Inherit target + anchoredText from nearest anchored ancestor for replies.
  // Walks up the parent chain so deep threads resolve regardless of iteration order.
  for (const info of infosById.values()) {
    if ((info.target != null && info.anchoredText != null && info.trackedChangeLink != null) || !info.parentCommentId)
      continue;
    const visited = new Set<string>();
    let cursor: CommentInfo | undefined = info;
    while (cursor?.parentCommentId && !visited.has(cursor.parentCommentId)) {
      visited.add(cursor.parentCommentId);
      const ancestor = infosById.get(cursor.parentCommentId);
      if (ancestor?.target != null) {
        if (info.target == null) info.target = ancestor.target;
        if (info.anchoredText == null && ancestor.anchoredText != null) info.anchoredText = ancestor.anchoredText;
        if (info.trackedChangeLink == null && ancestor.trackedChangeLink != null) {
          assignTrackedChangeLink(info, ancestor.trackedChangeLink);
        }
        break;
      }
      cursor = ancestor;
    }
  }

  const infos = Array.from(infosById.values());
  infos.sort((left, right) => {
    const leftCreated = left.createdTime ?? 0;
    const rightCreated = right.createdTime ?? 0;
    if (leftCreated !== rightCreated) return leftCreated - rightCreated;

    const leftStart = left.target?.segments[0]?.range.start ?? Number.MAX_SAFE_INTEGER;
    const rightStart = right.target?.segments[0]?.range.start ?? Number.MAX_SAFE_INTEGER;
    if (leftStart !== rightStart) return leftStart - rightStart;

    return left.commentId.localeCompare(right.commentId);
  });

  return infos;
}

type ResolvedCommentTarget = {
  from: number;
  to: number;
  trackedChangeSnapshot: TrackedChangeSnapshot | null;
};

type CommentTargetResolution =
  | { ok: true; value: ResolvedCommentTarget }
  | { ok: false; failure: Extract<Receipt, { success: false }>['failure'] };

function validateCommentTargetSegmentOrder(
  editor: Editor,
  segments: readonly TextSegment[],
): { ok: true } | { ok: false; reason: 'document-order' | 'contiguous-blocks' } {
  const orderedCandidates = [...getBlockIndex(editor).candidates].sort((left, right) => left.pos - right.pos);
  const orderByBlockId = new Map<string, number>();

  for (let i = 0; i < orderedCandidates.length; i += 1) {
    const candidate = orderedCandidates[i];
    if (!orderByBlockId.has(candidate.nodeId)) {
      orderByBlockId.set(candidate.nodeId, i);
    }
  }

  let lastOrder = -1;
  for (const segment of segments) {
    const currentOrder = orderByBlockId.get(segment.blockId);
    if (currentOrder === undefined || currentOrder <= lastOrder) {
      return { ok: false, reason: 'document-order' };
    }
    if (lastOrder >= 0 && currentOrder !== lastOrder + 1) {
      return { ok: false, reason: 'contiguous-blocks' };
    }
    lastOrder = currentOrder;
  }

  return { ok: true };
}

function buildTrackedChangeEntityFields(snapshot: TrackedChangeSnapshot | null): Record<string, unknown> {
  if (!snapshot) {
    return {
      trackedChange: false,
      trackedChangeParentId: null,
      trackedChangeType: null,
      trackedChangeDisplayType: null,
      trackedChangeStory: null,
      trackedChangeStoryKind: null,
      trackedChangeStoryLabel: null,
      trackedChangeAnchorKey: null,
      trackedChangeText: null,
      deletedText: null,
    };
  }

  const link = buildTrackedChangeLink(snapshot);
  return {
    trackedChange: true,
    trackedChangeParentId: getTrackedChangeThreadingId(snapshot),
    trackedChangeType: link.trackedChangeType ?? null,
    trackedChangeDisplayType: link.trackedChangeDisplayType ?? null,
    trackedChangeStory: link.trackedChangeStory ?? null,
    trackedChangeStoryKind: snapshot.storyKind,
    trackedChangeStoryLabel: snapshot.storyLabel,
    trackedChangeAnchorKey: link.trackedChangeAnchorKey ?? null,
    trackedChangeText: link.trackedChangeText ?? null,
    deletedText: link.deletedText ?? null,
  };
}

function hasTrackedChangeEntityFields(record: CommentEntityRecord | undefined): boolean {
  return Boolean(
    record &&
      (record.trackedChange === true ||
        record.trackedChangeParentId != null ||
        record.trackedChangeType != null ||
        record.trackedChangeAnchorKey != null ||
        record.trackedChangeText != null ||
        record.deletedText != null),
  );
}

function buildTrackedChangeEntityFieldsFromRecord(
  record: CommentEntityRecord | undefined,
): Record<string, unknown> | null {
  if (!hasTrackedChangeEntityFields(record)) return null;
  return {
    trackedChange: record?.trackedChange === true,
    trackedChangeParentId: record?.trackedChangeParentId ?? null,
    trackedChangeType: record?.trackedChangeType ?? null,
    trackedChangeDisplayType: record?.trackedChangeDisplayType ?? null,
    trackedChangeStory: record?.trackedChangeStory ?? null,
    trackedChangeStoryKind: record?.trackedChangeStoryKind ?? null,
    trackedChangeStoryLabel: record?.trackedChangeStoryLabel ?? null,
    trackedChangeAnchorKey: record?.trackedChangeAnchorKey ?? null,
    trackedChangeText: record?.trackedChangeText ?? null,
    deletedText: record?.deletedText ?? null,
  };
}

function buildCommentLifecyclePayload(record: CommentEntityRecord): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    commentId: record.commentId,
  };

  if (record.importedId !== undefined) payload.importedId = record.importedId;
  if (record.parentCommentId !== undefined) payload.parentCommentId = record.parentCommentId;
  if (record.commentText !== undefined) {
    payload.commentText = record.commentText;
    payload.text = record.commentText;
  }
  if (record.commentJSON !== undefined) payload.commentJSON = record.commentJSON;
  if (record.creatorIdentity !== undefined) payload.creatorIdentity = record.creatorIdentity;
  if (record.wordAuthorName !== undefined) payload.wordAuthorName = record.wordAuthorName;
  if (record.creatorName !== undefined) payload.creatorName = record.creatorName;
  if (record.creatorEmail !== undefined) payload.creatorEmail = record.creatorEmail;
  if (record.creatorImage !== undefined) payload.creatorImage = record.creatorImage;
  if (record.createdTime !== undefined) payload.createdTime = record.createdTime;
  if (record.isInternal !== undefined) payload.isInternal = record.isInternal;
  if (record.isDone !== undefined) payload.isDone = record.isDone;
  if (record.resolvedTime !== undefined) payload.resolvedTime = record.resolvedTime;
  if (record.fileId !== undefined) payload.fileId = record.fileId;
  if (record.documentId !== undefined) payload.documentId = record.documentId;
  if (record.trackedChange !== undefined) payload.trackedChange = record.trackedChange;
  if (record.trackedChangeParentId !== undefined) payload.trackedChangeParentId = record.trackedChangeParentId;
  if (record.trackedChangeType !== undefined) payload.trackedChangeType = record.trackedChangeType;
  if (record.trackedChangeDisplayType !== undefined) payload.trackedChangeDisplayType = record.trackedChangeDisplayType;
  if (record.trackedChangeStory !== undefined) payload.trackedChangeStory = record.trackedChangeStory;
  if (record.trackedChangeStoryKind !== undefined) payload.trackedChangeStoryKind = record.trackedChangeStoryKind;
  if (record.trackedChangeStoryLabel !== undefined) payload.trackedChangeStoryLabel = record.trackedChangeStoryLabel;
  if (record.trackedChangeAnchorKey !== undefined) payload.trackedChangeAnchorKey = record.trackedChangeAnchorKey;
  if (record.trackedChangeText !== undefined) payload.trackedChangeText = record.trackedChangeText;
  if (record.deletedText !== undefined) payload.deletedText = record.deletedText;

  return payload;
}

function findTrackedChangeSnapshotByAlias(editor: Editor, alias: string): TrackedChangeSnapshot | null {
  try {
    const index = getTrackedChangeIndex(editor);
    const bodyStory: StoryLocator = { kind: 'story', storyType: 'body' };
    const bodySnapshots =
      typeof index.get === 'function' ? Array.from(index.get(bodyStory)) : ([] as TrackedChangeSnapshot[]);
    const candidateSets =
      bodySnapshots.length > 0 ? [bodySnapshots, Array.from(index.getAll())] : [Array.from(index.getAll())];

    for (const snapshots of candidateSets) {
      const matching = snapshots.filter((snapshot) =>
        trackedChangeSnapshotAliases(snapshot).some((value) => value === alias),
      );
      const directMatch = choosePreferredTrackedChangeSnapshot(matching, alias);
      if (directMatch) return directMatch;

      const projectedMatch = projectSnapshots(snapshots).find((row) => row.info.id === alias);
      if (projectedMatch) return projectedMatch.snapshot;
    }

    return getCachedProjectedTrackedChangeSnapshot(editor, alias);
  } catch {
    return null;
  }
}

function resolveCommentTrackedChangeSnapshot(editor: Editor, commentId: string): TrackedChangeSnapshot | null {
  const store = getCommentEntityStore(editor);
  const record = findCommentEntity(store, commentId);
  const preferredId = toNonEmptyString(record?.trackedChangeParentId);
  if (preferredId) {
    const direct = findTrackedChangeSnapshotByAlias(editor, preferredId);
    if (direct) return direct;
  }

  const info = buildCommentInfos(editor).find(
    (candidate) => candidate.commentId === commentId || candidate.importedId === commentId,
  );
  if (!info?.target) return null;

  const resolved = resolveCommentTarget(editor, info.target);
  if (!resolved.ok) return null;
  return resolved.value.trackedChangeSnapshot;
}

function resolveCommentTarget(editor: Editor, target: CommentTarget): CommentTargetResolution {
  if (isTrackedChangeCommentTargetShape(target)) {
    const resolved = resolveTrackedChangeInStory(editor, {
      kind: 'entity',
      entityType: 'trackedChange',
      entityId: target.trackedChangeId,
      ...(target.story ? { story: target.story } : {}),
    });
    const indexedSnapshot = resolved ? null : findTrackedChangeSnapshotByAlias(editor, target.trackedChangeId);
    if (!resolved && !indexedSnapshot) {
      throw new DocumentApiAdapterError('TARGET_NOT_FOUND', 'Comment target could not be resolved.', {
        target,
      });
    }
    if (resolved && resolved.editor !== editor) {
      return {
        ok: false,
        failure: {
          code: 'INVALID_TARGET',
          message: 'Comment tracked-change targets outside the active story are not supported on this editor handle.',
          details: { target },
        },
      };
    }
    if (indexedSnapshot && buildStoryKey(indexedSnapshot.story) !== BODY_STORY_KEY) {
      return {
        ok: false,
        failure: {
          code: 'INVALID_TARGET',
          message: 'Comment tracked-change targets outside the active story are not supported on this editor handle.',
          details: { target },
        },
      };
    }

    const from = resolved?.change.from ?? indexedSnapshot!.range.from;
    const to = resolved?.change.to ?? indexedSnapshot!.range.to;
    if (from === to) {
      return {
        ok: false,
        failure: {
          code: 'INVALID_TARGET',
          message: 'Comment target range must be non-collapsed.',
          details: { target },
        },
      };
    }
    const trackedChangeSnapshot =
      indexedSnapshot ?? inferTrackedChangeSnapshotForRange(editor, from, to, target.trackedChangeId);
    return {
      ok: true,
      value: {
        from,
        to,
        trackedChangeSnapshot,
      },
    };
  }

  if ((target as SelectionTarget | undefined)?.kind === 'selection') {
    const resolved = resolveSelectionTarget(editor, target as SelectionTarget);
    if (resolved.absFrom === resolved.absTo) {
      return {
        ok: false,
        failure: {
          code: 'INVALID_TARGET',
          message: 'Comment target range must be non-collapsed.',
          details: { target },
        },
      };
    }
    return {
      ok: true,
      value: {
        from: resolved.absFrom,
        to: resolved.absTo,
        trackedChangeSnapshot: inferTrackedChangeSnapshotForRange(editor, resolved.absFrom, resolved.absTo),
      },
    };
  }

  const segments = targetToSegments(target);
  if (!segments) {
    return {
      ok: false,
      failure: {
        code: 'INVALID_TARGET',
        message: 'Comment target must be a TextAddress, TextTarget, SelectionTarget, or tracked-change target.',
        details: { target },
      },
    };
  }

  for (const seg of segments) {
    if (seg.range.start === seg.range.end) {
      return {
        ok: false,
        failure: {
          code: 'INVALID_TARGET',
          message: 'Comment target range must be non-collapsed.',
          details: { target },
        },
      };
    }
  }

  const resolvedSegments = segments.map((seg) =>
    resolveTextTarget(editor, { kind: 'text', blockId: seg.blockId, range: seg.range }),
  );
  if (resolvedSegments.some((r) => r === null)) {
    throw new DocumentApiAdapterError('TARGET_NOT_FOUND', 'Comment target could not be resolved.', {
      target,
    });
  }

  if (segments.length > 1) {
    const segmentOrder = validateCommentTargetSegmentOrder(editor, segments);
    if (segmentOrder.ok === false) {
      return {
        ok: false,
        failure: {
          code: 'INVALID_TARGET',
          message:
            segmentOrder.reason === 'document-order'
              ? 'Comment target segments must be in document order.'
              : 'Comment target segments must cover contiguous blocks in document order.',
          details: { target },
        },
      };
    }
  }

  for (let i = 1; i < resolvedSegments.length; i += 1) {
    const prev = resolvedSegments[i - 1]!;
    const curr = resolvedSegments[i]!;
    if (prev.to > curr.from) {
      return {
        ok: false,
        failure: {
          code: 'INVALID_TARGET',
          message: 'Comment target segments must be in document order.',
          details: { target },
        },
      };
    }
  }

  const firstResolved = resolvedSegments[0]!;
  const lastResolved = resolvedSegments[resolvedSegments.length - 1]!;
  if (firstResolved.from === lastResolved.to) {
    return {
      ok: false,
      failure: { code: 'INVALID_TARGET', message: 'Comment target range must be non-collapsed.', details: { target } },
    };
  }

  return {
    ok: true,
    value: {
      from: firstResolved.from,
      to: lastResolved.to,
      trackedChangeSnapshot: inferTrackedChangeSnapshotForRange(editor, firstResolved.from, lastResolved.to),
    },
  };
}

// ---------------------------------------------------------------------------
// Mutation handlers
// ---------------------------------------------------------------------------

function addCommentHandler(
  editor: Editor,
  input: AddCommentInput,
  options?: RevisionGuardOptions,
): CommentsCreateReceipt {
  // The target can be either a single-block TextAddress or a multi-segment
  // TextTarget. For a TextTarget, resolve each segment and require the
  // segments to walk contiguous blocks in document order. The resulting
  // comment span intentionally covers the full PM range between the first
  // and last segment, matching SelectionTarget / Word-style multi-block
  // anchors even when the boundary blocks contribute unselected text.
  const target = input.target;
  if (!target) {
    return {
      success: false,
      failure: {
        code: 'INVALID_TARGET',
        message: 'Comment target is required.',
      },
    };
  }
  const resolvedTarget = resolveCommentTarget(editor, target);
  if (resolvedTarget.ok === false) {
    return { success: false, failure: resolvedTarget.failure };
  }

  const creatorIdentity = snapshotWordIdentity(editor.options?.user?.wordIdentity);
  requireEditorCommand(editor.commands?.addComment, 'comments.create (addComment)');

  if (!applyTextSelection(editor, resolvedTarget.value.from, resolvedTarget.value.to)) {
    return {
      success: false,
      failure: {
        code: 'INVALID_TARGET',
        message: 'Comment target selection could not be applied.',
        details: { target: input.target },
      },
    };
  }

  const commentId = uuidv4();
  let trackedPayload: Record<string, unknown> | null = null;

  const receipt = executeDomainCommand(
    editor,
    () => {
      const addComment = requireEditorCommand(editor.commands?.addComment, 'comments.create (addComment)');
      const didInsert = addComment({ content: input.text, isInternal: false, commentId }) === true;
      if (didInsert) {
        clearIndexCache(editor);
        const store = getCommentEntityStore(editor);
        const now = Date.now();
        const user = (editor.options?.user ?? {}) as EditorUserIdentity;
        upsertCommentEntity(store, commentId, {
          commentId,
          commentText: input.text,
          commentJSON: buildCommentJsonFromText(input.text),
          parentCommentId: undefined,
          createdTime: now,
          creatorId: user.id,
          creatorIdentity,
          creatorName: user.name,
          creatorEmail: user.email ?? undefined,
          creatorImage: user.image ?? undefined,
          isDone: false,
          isInternal: false,
          fileId: editor.options?.documentId,
          documentId: editor.options?.documentId,
          ...buildTrackedChangeEntityFields(resolvedTarget.value.trackedChangeSnapshot),
        });
        const stored = findCommentEntity(store, commentId);
        if (stored) {
          trackedPayload = buildCommentLifecyclePayload(stored);
        }
      }
      return didInsert;
    },
    { expectedRevision: options?.expectedRevision },
  );

  if (receipt.steps[0]?.effect !== 'changed') {
    return {
      success: false,
      failure: { code: 'NO_OP', message: 'Comment insertion produced no change.' },
    };
  }

  if (trackedPayload && resolvedTarget.value.trackedChangeSnapshot) {
    emitCommentLifecycleUpdate(editor, 'update', trackedPayload);
  }

  return { success: true, id: commentId, inserted: [toCommentAddress(commentId)] };
}

function editCommentHandler(editor: Editor, input: EditCommentInput, options?: RevisionGuardOptions): Receipt {
  const editComment = requireEditorCommand(editor.commands?.editComment, 'comments.patch (editComment)');

  const store = getCommentEntityStore(editor);
  const identity = resolveCommentIdentity(editor, input.commentId);
  const existing = findCommentEntity(store, identity.commentId);
  const existingText = existing ? extractCommentText(existing) : undefined;
  if (existingText === input.text) {
    return {
      success: false,
      failure: { code: 'NO_OP', message: 'Comment edit produced no change.' },
    };
  }

  const receipt = executeDomainCommand(
    editor,
    () => {
      const didEdit = editComment({
        commentId: identity.commentId,
        importedId: identity.importedId,
        content: input.text,
      });
      if (didEdit) {
        upsertCommentEntity(store, identity.commentId, {
          commentText: input.text,
          commentJSON: buildCommentJsonFromText(input.text),
          importedId: identity.importedId,
        });
      }
      return Boolean(didEdit);
    },
    { expectedRevision: options?.expectedRevision },
  );

  if (receipt.steps[0]?.effect !== 'changed') {
    return {
      success: false,
      failure: { code: 'NO_OP', message: 'Comment edit produced no change.' },
    };
  }

  return { success: true, updated: [toCommentAddress(identity.commentId)] };
}

function replyToCommentHandler(
  editor: Editor,
  input: ReplyToCommentInput,
  options?: RevisionGuardOptions,
): CommentsCreateReceipt {
  const addCommentReply = requireEditorCommand(editor.commands?.addCommentReply, 'comments.create (addCommentReply)');

  if (!input.parentCommentId) {
    return {
      success: false,
      failure: {
        code: 'INVALID_TARGET',
        message: 'Reply target requires a non-empty parent comment id.',
      },
    };
  }

  const parentIdentity = resolveCommentIdentity(editor, input.parentCommentId);
  const store = getCommentEntityStore(editor);
  const parentRecord = findCommentEntity(store, parentIdentity.commentId);
  const inheritedTrackedFields =
    buildTrackedChangeEntityFieldsFromRecord(parentRecord) ??
    buildTrackedChangeEntityFields(resolveCommentTrackedChangeSnapshot(editor, parentIdentity.commentId));
  const creatorIdentity = snapshotWordIdentity(editor.options?.user?.wordIdentity);
  const replyId = uuidv4();
  let trackedPayload: Record<string, unknown> | null = null;

  const receipt = executeDomainCommand(
    editor,
    () => {
      const didReply = addCommentReply({
        parentId: parentIdentity.commentId,
        content: input.text,
        commentId: replyId,
      });
      if (didReply) {
        const now = Date.now();
        const user = (editor.options?.user ?? {}) as EditorUserIdentity;
        upsertCommentEntity(store, replyId, {
          commentId: replyId,
          parentCommentId: parentIdentity.commentId,
          commentText: input.text,
          commentJSON: buildCommentJsonFromText(input.text),
          createdTime: now,
          creatorId: user.id,
          creatorIdentity,
          creatorName: user.name,
          creatorEmail: user.email ?? undefined,
          creatorImage: user.image ?? undefined,
          isDone: false,
          isInternal: false,
          fileId: editor.options?.documentId,
          documentId: editor.options?.documentId,
          ...(inheritedTrackedFields ?? {}),
        });
        const stored = findCommentEntity(store, replyId);
        if (stored) {
          trackedPayload = buildCommentLifecyclePayload(stored);
        }
      }
      return Boolean(didReply);
    },
    { expectedRevision: options?.expectedRevision },
  );

  if (receipt.steps[0]?.effect !== 'changed') {
    return {
      success: false,
      failure: { code: 'INVALID_TARGET', message: 'Comment reply could not be applied.' },
    };
  }

  if (trackedPayload && inheritedTrackedFields) {
    emitCommentLifecycleUpdate(editor, 'update', trackedPayload);
  }

  // A threaded reply lives only in the comment entity store — the underlying
  // ProseMirror transaction is not `docChanged`, so the transaction-driven
  // revision tracker never advances. A reply IS caller-visible exported
  // content (it adds a w:comment to comments.xml + threading in
  // commentsExtended.xml), so bump the revision explicitly. Without this the
  // CLI host's `mutated = revisionBefore !== revisionAfter` gate reads false
  // and the working document is never re-exported, silently dropping the reply.
  incrementRevision(editor);

  return { success: true, id: replyId, inserted: [toCommentAddress(replyId)] };
}

function moveCommentHandler(editor: Editor, input: MoveCommentInput, options?: RevisionGuardOptions): Receipt {
  const moveComment = requireEditorCommand(editor.commands?.moveComment, 'comments.patch (moveComment)');

  const resolvedTarget = resolveCommentTarget(editor, input.target);
  if (resolvedTarget.ok === false) {
    return { success: false, failure: resolvedTarget.failure };
  }

  const store = getCommentEntityStore(editor);
  const identity = resolveCommentIdentity(editor, input.commentId);
  if (!identity.anchors.length) {
    return {
      success: false,
      failure: { code: 'INVALID_TARGET', message: 'Comment cannot be moved because it has no resolvable anchor.' },
    };
  }

  if (identity.anchors.length > 1) {
    return {
      success: false,
      failure: {
        code: 'INVALID_TARGET',
        message: 'Comment move target is ambiguous for comments with multiple anchors.',
      },
    };
  }

  const currentAnchor = identity.anchors[0];
  if (
    currentAnchor &&
    currentAnchor.pos === resolvedTarget.value.from &&
    currentAnchor.end === resolvedTarget.value.to
  ) {
    return {
      success: false,
      failure: { code: 'NO_OP', message: 'Comment move produced no change.' },
    };
  }

  let trackedPayload: Record<string, unknown> | null = null;
  const receipt = executeDomainCommand(
    editor,
    () => {
      const didMove = Boolean(
        moveComment({ commentId: identity.commentId, from: resolvedTarget.value.from, to: resolvedTarget.value.to }),
      );
      if (didMove) {
        upsertCommentEntity(store, identity.commentId, {
          importedId: identity.importedId,
          ...buildTrackedChangeEntityFields(resolvedTarget.value.trackedChangeSnapshot),
        });
        const stored = findCommentEntity(store, identity.commentId);
        if (stored) {
          trackedPayload = buildCommentLifecyclePayload(stored);
        }
      }
      return didMove;
    },
    { expectedRevision: options?.expectedRevision },
  );

  if (receipt.steps[0]?.effect !== 'changed') {
    return {
      success: false,
      failure: { code: 'NO_OP', message: 'Comment move produced no change.' },
    };
  }

  if (trackedPayload) {
    emitCommentLifecycleUpdate(editor, 'update', trackedPayload);
  }

  return { success: true, updated: [toCommentAddress(identity.commentId)] };
}

function resolveCommentHandler(editor: Editor, input: ResolveCommentInput, options?: RevisionGuardOptions): Receipt {
  const resolveComment = requireEditorCommand(editor.commands?.resolveComment, 'comments.patch (resolveComment)');

  const store = getCommentEntityStore(editor);
  const identity = resolveCommentIdentity(editor, input.commentId);
  const existing = findCommentEntity(store, identity.commentId);
  const alreadyResolved =
    (existing ? isCommentResolved(existing) : false) ||
    (identity.anchors.length > 0 && identity.anchors.every((a) => a.status === 'resolved'));
  if (alreadyResolved) {
    return {
      success: false,
      failure: { code: 'NO_OP', message: 'Comment is already resolved.' },
    };
  }

  let resolvedTimestamp: number | null = null;

  const receipt = executeDomainCommand(
    editor,
    () => {
      const didResolve = resolveComment({
        commentId: identity.commentId,
        importedId: identity.importedId,
      });
      if (didResolve) {
        resolvedTimestamp = Date.now();
        upsertCommentEntity(store, identity.commentId, {
          importedId: identity.importedId,
          isDone: true,
          resolvedTime: resolvedTimestamp,
        });
      }
      return Boolean(didResolve);
    },
    { expectedRevision: options?.expectedRevision },
  );

  if (receipt.steps[0]?.effect !== 'changed') {
    return {
      success: false,
      failure: { code: 'NO_OP', message: 'Comment resolve produced no change.' },
    };
  }

  // SD-3214: the resolveComment engine command sets `tr.setMeta(CommentsPluginKey, { event: 'update' })`
  // but does not emit `commentsUpdate`. The browser commentsStore handles its own resolve flow by
  // emitting `comments-update` manually + writing to Y.Array. Document-API consumers (CLI, MCP) need
  // the wrapper to fire the canonical event so the headless bridge can propagate to Y.Array via its
  // existing `'update'` / `'resolved'` handler.
  emitCommentLifecycleUpdate(editor, 'resolved', {
    commentId: identity.commentId,
    importedId: identity.importedId,
    isDone: true,
    resolvedTime: resolvedTimestamp,
  });

  return { success: true, updated: [toCommentAddress(identity.commentId)] };
}

function reopenCommentHandler(editor: Editor, input: ReopenCommentInput, options?: RevisionGuardOptions): Receipt {
  const reopenComment = requireEditorCommand(editor.commands?.reopenComment, 'comments.patch (reopenComment)');

  const store = getCommentEntityStore(editor);
  const identity = resolveCommentIdentity(editor, input.commentId);
  const existing = findCommentEntity(store, identity.commentId);
  // Idempotent on the no-op path: reopening an already-active comment
  // (no anchor nodes in the doc, entity store doesn't show resolved)
  // returns NO_OP rather than running a command that would fail
  // silently.
  const isAnchored = identity.anchors.length > 0;
  const isResolvedInStore = existing ? isCommentResolved(existing) : false;
  const isResolvedInDoc = isAnchored && identity.anchors.every((a) => a.status === 'resolved');
  if (!isResolvedInStore && !isResolvedInDoc) {
    return {
      success: false,
      failure: { code: 'NO_OP', message: 'Comment is already active.' },
    };
  }

  // Recover the original `internal` flag from the entity store when
  // present; the engine helper falls back to the value stamped on
  // `commentRangeStart` when this is undefined, so a runtime-resolved
  // comment with no entity record still round-trips correctly.
  const storedInternal = (existing as { isInternal?: unknown } | undefined)?.isInternal;
  const internalOverride = typeof storedInternal === 'boolean' ? storedInternal : undefined;

  const receipt = executeDomainCommand(
    editor,
    () => {
      const didReopen = reopenComment({
        commentId: identity.commentId,
        importedId: identity.importedId,
        internal: internalOverride,
      });
      if (didReopen) {
        // Clear the resolved markers in the entity store so subsequent
        // `comments.list()` reflects the reopen. `resolvedTime` is
        // dropped explicitly because `upsertCommentEntity` merges
        // partials and would otherwise leave the prior timestamp in
        // place.
        upsertCommentEntity(store, identity.commentId, {
          importedId: identity.importedId,
          isDone: false,
          resolvedTime: null,
        });
      }
      return Boolean(didReopen);
    },
    { expectedRevision: options?.expectedRevision },
  );

  if (receipt.steps[0]?.effect !== 'changed') {
    return {
      success: false,
      failure: { code: 'NO_OP', message: 'Comment reopen produced no change.' },
    };
  }

  // SD-3214: reopenComment doesn't emit either — surface a canonical
  // 'update' event so the bridge can mirror the cleared resolved markers
  // into Y.Array.
  emitCommentLifecycleUpdate(editor, 'update', {
    commentId: identity.commentId,
    importedId: identity.importedId,
    isDone: false,
    resolvedTime: null,
  });

  return { success: true, updated: [toCommentAddress(identity.commentId)] };
}

function removeCommentHandler(editor: Editor, input: RemoveCommentInput, options?: RevisionGuardOptions): Receipt {
  const removeComment = requireEditorCommand(editor.commands?.removeComment, 'comments.remove (removeComment)');

  const store = getCommentEntityStore(editor);
  const identity = resolveCommentIdentity(editor, input.commentId);

  let didRemove = false;
  let removedRecords: ReturnType<typeof removeCommentEntityTree> = [];

  const receipt = executeDomainCommand(
    editor,
    () => {
      didRemove = removeComment({ commentId: identity.commentId, importedId: identity.importedId }) === true;
      removedRecords = removeCommentEntityTree(store, identity.commentId);
      stashRemovedCommentEntities(editor, removedRecords);
      return didRemove || removedRecords.length > 0;
    },
    { expectedRevision: options?.expectedRevision },
  );

  if (receipt.steps[0]?.effect !== 'changed') {
    return {
      success: false,
      failure: { code: 'NO_OP', message: 'Comment remove produced no change.' },
    };
  }

  const removedIds = new Set<string>();
  for (const record of removedRecords) {
    const removedId = toNonEmptyString(record.commentId);
    if (removedId) {
      removedIds.add(removedId);
    }
  }
  if (!removedIds.size && didRemove) {
    removedIds.add(identity.commentId);
  }

  // SD-3214: removeComment engine command sets `tr.setMeta` but doesn't emit
  // `commentsUpdate`. Emit here so the headless bridge propagates the delete
  // to Y.Array (and the browser's existing DELETED branch refreshes its Vue
  // list). Emits per removed id so thread-reply cascades reach subscribers.
  for (const removedId of removedIds) {
    emitCommentLifecycleUpdate(editor, 'deleted', {
      commentId: removedId,
      importedId: removedId === identity.commentId ? identity.importedId : undefined,
    });
  }

  return {
    success: true,
    removed: Array.from(removedIds).map((id) => toCommentAddress(id)),
  };
}

function setCommentInternalHandler(
  editor: Editor,
  input: SetCommentInternalInput,
  options?: RevisionGuardOptions,
): Receipt {
  const setCommentInternal = requireEditorCommand(
    editor.commands?.setCommentInternal,
    'comments.setInternal (setCommentInternal)',
  );

  const store = getCommentEntityStore(editor);
  const identity = resolveCommentIdentity(editor, input.commentId);
  const existing = findCommentEntity(store, identity.commentId);
  const currentInternal =
    (typeof existing?.isInternal === 'boolean' ? existing.isInternal : undefined) ?? identity.anchors[0]?.isInternal;

  if (typeof currentInternal === 'boolean' && currentInternal === input.isInternal) {
    return {
      success: false,
      failure: { code: 'NO_OP', message: 'Comment internal state is already set to the requested value.' },
    };
  }

  const hasOpenAnchor = identity.anchors.some((anchor) => anchor.status === 'open');

  const receipt = executeDomainCommand(
    editor,
    () => {
      if (hasOpenAnchor) {
        const didApply = setCommentInternal({
          commentId: identity.commentId,
          importedId: identity.importedId,
          isInternal: input.isInternal,
        });
        if (!didApply) return false;
      }
      upsertCommentEntity(store, identity.commentId, {
        importedId: identity.importedId,
        isInternal: input.isInternal,
      });
      return true;
    },
    { expectedRevision: options?.expectedRevision },
  );

  if (receipt.steps[0]?.effect !== 'changed') {
    return {
      success: false,
      failure: {
        code: 'INVALID_TARGET',
        message: 'Comment internal state could not be updated on the current anchor.',
      },
    };
  }

  return { success: true, updated: [toCommentAddress(identity.commentId)] };
}

function setCommentActiveHandler(
  editor: Editor,
  input: SetCommentActiveInput,
  options?: RevisionGuardOptions,
): Receipt {
  const setActiveComment = requireEditorCommand(
    editor.commands?.setActiveComment,
    'comments.setActive (setActiveComment)',
  );

  let resolvedCommentId: string | null = null;
  if (input.commentId != null) {
    resolvedCommentId = resolveCommentIdentity(editor, input.commentId).commentId;
  }

  const receipt = executeDomainCommand(editor, () => Boolean(setActiveComment({ commentId: resolvedCommentId })), {
    expectedRevision: options?.expectedRevision,
  });

  if (receipt.steps[0]?.effect !== 'changed') {
    return {
      success: false,
      failure: {
        code: 'INVALID_TARGET',
        message: 'Active comment could not be updated.',
      },
    };
  }

  return {
    success: true,
    updated: resolvedCommentId ? [toCommentAddress(resolvedCommentId)] : undefined,
  };
}

// ---------------------------------------------------------------------------
// Read handlers
// ---------------------------------------------------------------------------

function goToCommentHandler(editor: Editor, input: GoToCommentInput): Receipt {
  const setCursorById = requireEditorCommand(editor.commands?.setCursorById, 'comments.goTo (setCursorById)');

  const identity = resolveCommentIdentity(editor, input.commentId);
  let didSetCursor = setCursorById(identity.commentId);
  if (!didSetCursor && identity.importedId && identity.importedId !== identity.commentId) {
    didSetCursor = setCursorById(identity.importedId);
  }
  if (!didSetCursor) {
    throw toNotFoundError({ commentId: identity.commentId });
  }

  return {
    success: true,
    updated: [toCommentAddress(identity.commentId)],
  };
}

function getCommentHandler(editor: Editor, input: GetCommentInput): CommentInfo {
  const comments = buildCommentInfos(editor);
  const found = comments.find(
    (comment) => comment.commentId === input.commentId || comment.importedId === input.commentId,
  );
  if (!found) {
    throw toNotFoundError({ commentId: input.commentId });
  }
  return found;
}

function listCommentsHandler(editor: Editor, query?: CommentsListQuery): CommentsListResult {
  validatePaginationInput(query?.offset, query?.limit);

  const comments = buildCommentInfos(editor);
  const includeResolved = query?.includeResolved ?? true;
  const filtered = includeResolved ? comments : comments.filter((comment) => comment.status !== 'resolved');
  const evaluatedRevision = getRevision(editor);

  const paged = paginate(filtered, query?.offset, query?.limit);

  const items = paged.items.map((comment) => {
    const handle = buildResolvedHandle(`comment:${comment.commentId}`, 'stable', 'comment');
    const {
      importedId,
      parentCommentId,
      text,
      isInternal,
      status,
      target,
      anchoredText,
      createdTime,
      creatorName,
      creatorEmail,
      address,
      story,
      trackedChange,
      trackedChangeType,
      trackedChangeDisplayType,
      trackedChangeStory,
      trackedChangeAnchorKey,
      trackedChangeText,
      deletedText,
      trackedChangeLink,
    } = comment;
    return buildDiscoveryItem(comment.commentId, handle, {
      address,
      importedId,
      parentCommentId,
      text,
      isInternal,
      status,
      target,
      anchoredText,
      createdTime,
      creatorName,
      creatorEmail,
      story,
      trackedChange,
      trackedChangeType,
      trackedChangeDisplayType,
      trackedChangeStory,
      trackedChangeAnchorKey,
      trackedChangeText,
      deletedText,
      trackedChangeLink,
    });
  });

  return buildDiscoveryResult({
    evaluatedRevision,
    total: paged.total,
    items,
    page: { limit: query?.limit ?? paged.total, offset: query?.offset ?? 0, returned: items.length },
  });
}

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

export function createCommentsWrapper(editor: Editor): CommentsAdapter {
  return {
    add: (input: AddCommentInput, options?: RevisionGuardOptions) => addCommentHandler(editor, input, options),
    edit: (input: EditCommentInput, options?: RevisionGuardOptions) => editCommentHandler(editor, input, options),
    reply: (input: ReplyToCommentInput, options?: RevisionGuardOptions) =>
      replyToCommentHandler(editor, input, options),
    move: (input: MoveCommentInput, options?: RevisionGuardOptions) => moveCommentHandler(editor, input, options),
    resolve: (input: ResolveCommentInput, options?: RevisionGuardOptions) =>
      resolveCommentHandler(editor, input, options),
    reopen: (input: ReopenCommentInput, options?: RevisionGuardOptions) => reopenCommentHandler(editor, input, options),
    remove: (input: RemoveCommentInput, options?: RevisionGuardOptions) => removeCommentHandler(editor, input, options),
    setInternal: (input: SetCommentInternalInput, options?: RevisionGuardOptions) =>
      setCommentInternalHandler(editor, input, options),
    setActive: (input: SetCommentActiveInput, options?: RevisionGuardOptions) =>
      setCommentActiveHandler(editor, input, options),
    goTo: (input: GoToCommentInput) => goToCommentHandler(editor, input),
    get: (input: GetCommentInput) => getCommentHandler(editor, input),
    list: (query?: CommentsListQuery) => listCommentsHandler(editor, query),
  };
}
