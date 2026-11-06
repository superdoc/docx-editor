import type { Editor } from '../../core/Editor.js';
import type {
  CommentInfo,
  CommentStatus,
  CommentTrackedChangeLink,
  StoryLocator,
  TextTarget,
  TrackChangeType,
} from '@superdoc/document-api';
export { buildCommentJsonFromText } from '../../utils/comment-content.js';
import { buildCommentJsonFromText } from '../../utils/comment-content.js';

const FALLBACK_STORE_KEY = '__documentApiComments';
const DELETED_COMMENT_SNAPSHOT_KEY = '__documentApiDeletedCommentSnapshots';

export interface CommentEntityRecord {
  commentId?: string;
  importedId?: string;
  parentCommentId?: string;
  commentText?: string;
  commentJSON?: unknown;
  elements?: unknown;
  isInternal?: boolean;
  isDone?: boolean;
  resolvedTime?: number | null;
  resolvedByEmail?: string | null;
  resolvedByName?: string | null;
  creatorIdentity?: { providerId: string; userId: string } | null;
  wordAuthorName?: string;
  creatorName?: string;
  creatorEmail?: string;
  creatorImage?: string;
  createdTime?: number;
  trackedChange?: boolean;
  trackedChangeParentId?: string | null;
  trackedChangeType?: TrackChangeType | null;
  trackedChangeDisplayType?: string | null;
  trackedChangeStory?: StoryLocator | null;
  trackedChangeStoryKind?: string | null;
  trackedChangeStoryLabel?: string | null;
  trackedChangeAnchorKey?: string | null;
  trackedChangeText?: string | null;
  deletedText?: string | null;
  [key: string]: unknown;
}

type ConverterWithComments = {
  comments?: CommentEntityRecord[];
};

type EditorWithCommentStorage = Editor & {
  converter?: ConverterWithComments;
  storage?: Record<string, unknown>;
};

function ensureFallbackStore(editor: EditorWithCommentStorage): CommentEntityRecord[] {
  const storage = ensureEditorStorage(editor);

  if (!Array.isArray(storage[FALLBACK_STORE_KEY])) {
    storage[FALLBACK_STORE_KEY] = [];
  }

  return storage[FALLBACK_STORE_KEY] as CommentEntityRecord[];
}

function ensureEditorStorage(editor: EditorWithCommentStorage): Record<string, unknown> {
  if (!editor.storage) {
    (editor as unknown as Record<string, unknown>).storage = {};
  }
  return editor.storage as Record<string, unknown>;
}

function getDeletedCommentSnapshotStore(editor: Editor): Map<string, CommentEntityRecord> {
  const storage = ensureEditorStorage(editor as EditorWithCommentStorage);
  const existing = storage[DELETED_COMMENT_SNAPSHOT_KEY];
  if (existing instanceof Map) {
    return existing as Map<string, CommentEntityRecord>;
  }
  const created = new Map<string, CommentEntityRecord>();
  storage[DELETED_COMMENT_SNAPSHOT_KEY] = created;
  return created;
}

export function getCommentEntityStore(editor: Editor): CommentEntityRecord[] {
  const mutableEditor = editor as EditorWithCommentStorage;
  const converter = mutableEditor.converter as ConverterWithComments | undefined;

  if (converter) {
    if (!Array.isArray(converter.comments)) {
      converter.comments = [];
    }
    return converter.comments as CommentEntityRecord[];
  }

  return ensureFallbackStore(mutableEditor);
}

export function findCommentEntity(store: CommentEntityRecord[], commentId: string): CommentEntityRecord | undefined {
  return store.find((entry) => entry.commentId === commentId || entry.importedId === commentId);
}

export function upsertCommentEntity(
  store: CommentEntityRecord[],
  commentId: string,
  patch: Partial<CommentEntityRecord>,
): CommentEntityRecord {
  const existing = findCommentEntity(store, commentId);
  if (existing) {
    const resolvedId =
      typeof existing.commentId === 'string' && existing.commentId.length > 0 ? existing.commentId : commentId;
    Object.assign(existing, patch, { commentId: resolvedId });
    return existing;
  }

  const created: CommentEntityRecord = {
    ...patch,
    commentId,
  };
  store.push(created);
  return created;
}

export function removeCommentEntityTree(store: CommentEntityRecord[], commentId: string): CommentEntityRecord[] {
  const root = findCommentEntity(store, commentId);
  if (!root || typeof root.commentId !== 'string' || root.commentId.length === 0) return [];

  const removeIds = new Set<string>([root.commentId]);
  let changed = true;

  while (changed) {
    changed = false;
    for (const entry of store) {
      if (typeof entry.commentId !== 'string' || entry.commentId.length === 0) continue;
      if (typeof entry.parentCommentId !== 'string' || entry.parentCommentId.length === 0) continue;
      if (removeIds.has(entry.parentCommentId) && !removeIds.has(entry.commentId)) {
        removeIds.add(entry.commentId);
        changed = true;
      }
    }
  }

  const removed = store.filter((entry) => typeof entry.commentId === 'string' && removeIds.has(entry.commentId));
  const kept = store.filter((entry) => !(typeof entry.commentId === 'string' && removeIds.has(entry.commentId)));

  store.splice(0, store.length, ...kept);
  return removed;
}

function commentEntityIdentity(entry: CommentEntityRecord | undefined): string | undefined {
  return toNonEmptyString(entry?.commentId) ?? toNonEmptyString(entry?.importedId);
}

export function stashRemovedCommentEntities(editor: Editor, removed: ReadonlyArray<CommentEntityRecord>): void {
  if (removed.length === 0) return;
  const snapshots = getDeletedCommentSnapshotStore(editor);
  for (const entry of removed) {
    const identity = commentEntityIdentity(entry);
    if (!identity) continue;
    snapshots.set(identity, { ...entry });
  }
}

export function restoreStashedCommentEntityTree(editor: Editor, rootCommentId: string): CommentEntityRecord[] {
  const snapshots = getDeletedCommentSnapshotStore(editor);
  const store = getCommentEntityStore(editor);
  const root = Array.from(snapshots.values()).find(
    (entry) =>
      toNonEmptyString(entry.commentId) === rootCommentId || toNonEmptyString(entry.importedId) === rootCommentId,
  );
  if (!root) return [];

  const restoreIds = new Set<string>();
  const rootIdentity = commentEntityIdentity(root);
  if (!rootIdentity) return [];
  restoreIds.add(rootIdentity);

  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of snapshots.values()) {
      const identity = commentEntityIdentity(entry);
      if (!identity || restoreIds.has(identity)) continue;
      const parentId = toNonEmptyString(entry.parentCommentId);
      if (!parentId || !restoreIds.has(parentId)) continue;
      restoreIds.add(identity);
      changed = true;
    }
  }

  const restored: CommentEntityRecord[] = [];
  for (const identity of restoreIds) {
    const snapshot = snapshots.get(identity);
    if (!snapshot) continue;
    upsertCommentEntity(store, identity, { ...snapshot });
    snapshots.delete(identity);
    restored.push(snapshot);
  }

  return restored;
}

function isDanglingOpenRootComment(entry: CommentEntityRecord, anchoredIds: ReadonlySet<string>): boolean {
  const commentId = toNonEmptyString(entry.commentId);
  const importedId = toNonEmptyString(entry.importedId);
  if (!commentId) return false;
  if (toNonEmptyString(entry.parentCommentId)) return false;
  if (isCommentResolved(entry)) return false;
  if (entry.trackedChange === true || toNonEmptyString(entry.trackedChangeParentId)) return false;
  if (anchoredIds.has(commentId)) return false;
  if (importedId && anchoredIds.has(importedId)) return false;
  return true;
}

export function reconcileCommentEntityStoreWithAnchors(
  editor: Editor,
  anchoredCommentIds: Iterable<string>,
): { restored: CommentEntityRecord[]; removed: CommentEntityRecord[] } {
  const anchoredIds = new Set(
    Array.from(anchoredCommentIds, (value) => toNonEmptyString(value)).filter((value): value is string => !!value),
  );

  const restored: CommentEntityRecord[] = [];
  for (const anchoredId of anchoredIds) {
    restored.push(...restoreStashedCommentEntityTree(editor, anchoredId));
  }

  const store = getCommentEntityStore(editor);
  const removed: CommentEntityRecord[] = [];
  const prunedRootIds = new Set<string>();

  for (const entry of [...store]) {
    const commentId = toNonEmptyString(entry.commentId);
    if (!commentId || prunedRootIds.has(commentId)) continue;
    if (!isDanglingOpenRootComment(entry, anchoredIds)) continue;

    const removedTree = removeCommentEntityTree(store, commentId);
    if (!removedTree.length) continue;

    stashRemovedCommentEntities(editor, removedTree);
    removed.push(...removedTree);
    prunedRootIds.add(commentId);
  }

  return { restored, removed };
}

function collectTextFragments(value: unknown, sink: string[]): void {
  if (!value) return;

  if (typeof value === 'string') {
    if (value.length > 0) sink.push(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectTextFragments(item, sink);
    return;
  }

  if (typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (typeof record.text === 'string' && record.text.length > 0) sink.push(record.text);

  if (record.content) collectTextFragments(record.content, sink);
  if (record.elements) collectTextFragments(record.elements, sink);
  if (record.nodes) collectTextFragments(record.nodes, sink);
}

function hasOwnProperty(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function hasCommentBodyPayload(raw: Record<string, unknown>): boolean {
  return (
    hasOwnProperty(raw, 'commentText') ||
    hasOwnProperty(raw, 'text') ||
    hasOwnProperty(raw, 'commentJSON') ||
    hasOwnProperty(raw, 'elements')
  );
}

function isSyntheticTrackedChangeProjection(raw: Record<string, unknown>): boolean {
  if (raw.trackedChange !== true) return false;

  // Tracked-change projection rows share the comments Y.Array, but they are
  // not user-authored comment entities. Linked user comments on tracked
  // content also carry `trackedChange: true`, so only skip rows that lack any
  // actual comment body payload or thread metadata.
  return !hasCommentBodyPayload(raw) && !hasOwnProperty(raw, 'parentCommentId');
}

export function extractCommentText(entry: CommentEntityRecord): string | undefined {
  if (typeof entry.commentText === 'string') return entry.commentText;

  const fragments: string[] = [];
  if (entry.commentJSON) collectTextFragments(entry.commentJSON, fragments);
  if (entry.elements) collectTextFragments(entry.elements, fragments);

  if (!fragments.length) return undefined;
  return fragments.join('').trim();
}

export function isCommentResolved(entry: CommentEntityRecord): boolean {
  return Boolean(entry.isDone || entry.resolvedTime);
}

/**
 * Sync remote comment metadata from a collaboration channel (e.g. the Yjs
 * `ydoc.getArray('comments')` used by browser SuperDoc clients) into the
 * editor's CommentEntityStore.
 *
 * Without this sync, the headless SDK only sees PM-anchor-derived fields
 * (id, target, anchoredText, status) for browser-authored comments — the
 * Y.Array metadata (text, creatorName, creatorEmail, createdTime) never
 * reaches `doc.comments.list()`. See SD-3214.
 *
 * Behavior:
 *   - Each entry with a `commentId` is upserted into the store. Existing
 *     entries are merged (collaborator-authored fields override locally
 *     captured ones; missing fields are left alone).
 *   - Synthetic tracked-change projection rows are skipped — those belong to
 *     the tracked-changes domain, not the comments store. Linked user
 *     comments on tracked content are still synced.
 *   - When `options.previouslySynced` is provided, any id present in the
 *     prior set but absent from the current entries is treated as a remote
 *     deletion and pruned via `removeCommentEntityTree`. Locally-authored
 *     entries that were never collab-synced are left alone.
 *   - Returns the set of commentIds observed during the sync. Callers should
 *     pass this back as `previouslySynced` on the next call to detect
 *     subsequent remote deletions.
 */
export function syncCommentEntitiesFromCollaboration(
  editor: Editor,
  entries: ReadonlyArray<Record<string, unknown>>,
  options: { previouslySynced?: ReadonlySet<string> } = {},
): Set<string> {
  const store = getCommentEntityStore(editor);
  const seen = new Set<string>();

  // Pre-pass: collect every id (commentId AND importedId) that exists in the
  // current upstream array, then transitively drop entries whose
  // `parentCommentId` is missing from the set. `deleteYComment` on the
  // browser side removes only the parent index from Y.Array — replies (and
  // replies-of-replies) linger upstream until the browser flushes them. A
  // single-pass filter handles A→B (B skipped when A is gone) but breaks on
  // A→B→C: B would be skipped, yet B's id is still in `upstreamIds`, so C
  // survives and dangles as an orphan whose chain leads nowhere. The
  // fixed-point loop below removes orphan ids from the set until stable, so
  // any depth of orphan chain collapses in one go.
  const upstreamIds = new Set<string>();
  const validEntries: Array<Record<string, unknown>> = [];
  for (const raw of entries) {
    if (!raw || typeof raw !== 'object') continue;
    if (isSyntheticTrackedChangeProjection(raw)) continue;
    const cid = toNonEmptyString(raw.commentId);
    const iid = toNonEmptyString(raw.importedId);
    if (cid) upstreamIds.add(cid);
    if (iid) upstreamIds.add(iid);
    validEntries.push(raw);
  }

  // Iteratively drop orphan ids until the set is stable. Each pass removes
  // entries whose declared parent is no longer represented in `upstreamIds`;
  // the next pass then re-evaluates entries that were transitively orphaned
  // by the previous removal. Worst-case cost is O(depth × validEntries),
  // bounded by document size — Y.Array of comments is small in practice.
  let changed = true;
  while (changed) {
    changed = false;
    for (const raw of validEntries) {
      const parentRef = toNonEmptyString(raw.parentCommentId);
      if (!parentRef) continue;
      if (upstreamIds.has(parentRef)) continue;
      const cid = toNonEmptyString(raw.commentId);
      const iid = toNonEmptyString(raw.importedId);
      if (cid && upstreamIds.delete(cid)) changed = true;
      if (iid && upstreamIds.delete(iid)) changed = true;
    }
  }

  for (const raw of validEntries) {
    const commentId = toNonEmptyString(raw.commentId) ?? toNonEmptyString(raw.importedId);
    if (!commentId) continue;

    // After the fixed-point pass, an entry is an orphan iff its own id was
    // dropped from `upstreamIds`. Skip it so the prune step can cascade-
    // delete the local record without `seen` re-marking the orphan as live.
    if (!upstreamIds.has(commentId)) continue;

    seen.add(commentId);

    const patch: Partial<CommentEntityRecord> = {};
    // Identity fields
    if (typeof raw.importedId === 'string') patch.importedId = raw.importedId;
    if (typeof raw.parentCommentId === 'string') patch.parentCommentId = raw.parentCommentId;
    if (raw.trackedChangeParentId === null) patch.trackedChangeParentId = null;
    if (typeof raw.trackedChangeParentId === 'string') patch.trackedChangeParentId = raw.trackedChangeParentId;
    // Body
    const commentText =
      typeof raw.commentText === 'string' ? raw.commentText : typeof raw.text === 'string' ? raw.text : undefined;
    if (commentText !== undefined) patch.commentText = commentText;
    if (raw.commentJSON !== undefined) patch.commentJSON = raw.commentJSON;
    if (raw.elements !== undefined) patch.elements = raw.elements;
    // Authoring metadata
    if (raw.creatorIdentity !== undefined) {
      patch.creatorIdentity =
        raw.creatorIdentity === null
          ? null
          : { ...(raw.creatorIdentity as NonNullable<CommentEntityRecord['creatorIdentity']>) };
    }
    if (typeof raw.wordAuthorName === 'string') patch.wordAuthorName = raw.wordAuthorName;
    if (typeof raw.creatorName === 'string') patch.creatorName = raw.creatorName;
    if (typeof raw.creatorEmail === 'string') patch.creatorEmail = raw.creatorEmail;
    if (typeof raw.creatorImage === 'string') patch.creatorImage = raw.creatorImage;
    if (typeof raw.createdTime === 'number') patch.createdTime = raw.createdTime;
    // Tracked-change linkage
    if (typeof raw.trackedChange === 'boolean') patch.trackedChange = raw.trackedChange;
    const normalizedTrackedChangeType = normalizeTrackedChangeType(raw.trackedChangeType);
    if (normalizedTrackedChangeType !== undefined) patch.trackedChangeType = normalizedTrackedChangeType;
    if (raw.trackedChangeType === null) patch.trackedChangeType = null;
    if (typeof raw.trackedChangeDisplayType === 'string') patch.trackedChangeDisplayType = raw.trackedChangeDisplayType;
    if (raw.trackedChangeDisplayType === null) patch.trackedChangeDisplayType = null;
    if (raw.trackedChangeStory === null) patch.trackedChangeStory = null;
    if (raw.trackedChangeStory && typeof raw.trackedChangeStory === 'object') {
      patch.trackedChangeStory = raw.trackedChangeStory as StoryLocator;
    }
    if (typeof raw.trackedChangeStoryKind === 'string') patch.trackedChangeStoryKind = raw.trackedChangeStoryKind;
    if (raw.trackedChangeStoryKind === null) patch.trackedChangeStoryKind = null;
    if (typeof raw.trackedChangeStoryLabel === 'string') patch.trackedChangeStoryLabel = raw.trackedChangeStoryLabel;
    if (raw.trackedChangeStoryLabel === null) patch.trackedChangeStoryLabel = null;
    if (typeof raw.trackedChangeAnchorKey === 'string') patch.trackedChangeAnchorKey = raw.trackedChangeAnchorKey;
    if (raw.trackedChangeAnchorKey === null) patch.trackedChangeAnchorKey = null;
    if (typeof raw.trackedChangeText === 'string') patch.trackedChangeText = raw.trackedChangeText;
    if (raw.trackedChangeText === null) patch.trackedChangeText = null;
    if (typeof raw.deletedText === 'string') patch.deletedText = raw.deletedText;
    if (raw.deletedText === null) patch.deletedText = null;
    // Status
    if (typeof raw.isInternal === 'boolean') patch.isInternal = raw.isInternal;
    if (typeof raw.isDone === 'boolean') patch.isDone = raw.isDone;
    if (typeof raw.resolvedTime === 'number') patch.resolvedTime = raw.resolvedTime;
    if (raw.resolvedTime === null) patch.resolvedTime = null;
    if (typeof raw.resolvedByEmail === 'string') patch.resolvedByEmail = raw.resolvedByEmail;
    if (typeof raw.resolvedByName === 'string') patch.resolvedByName = raw.resolvedByName;

    upsertCommentEntity(store, commentId, patch);
  }

  // Prune entries previously known to come from collab sync but now absent
  // from the upstream Y.Array. Locally-authored entries that were never in
  // `previouslySynced` are intentionally left alone.
  if (options.previouslySynced) {
    for (const priorId of options.previouslySynced) {
      if (!seen.has(priorId)) {
        removeCommentEntityTree(store, priorId);
      }
    }
  }

  return seen;
}

/** Local helper: trim+narrow a value to a non-empty string. */
function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeTrackedChangeType(value: unknown): TrackChangeType | undefined {
  switch (toNonEmptyString(value)) {
    case 'insert':
    case 'trackInsert':
      return 'insert';
    case 'delete':
    case 'trackDelete':
      return 'delete';
    case 'replacement':
    case 'both':
      return 'replacement';
    case 'format':
    case 'trackFormat':
      return 'format';
    default:
      return undefined;
  }
}

function normalizeTrackedChangeLink(
  link: CommentTrackedChangeLink | null | undefined,
): CommentTrackedChangeLink | null | undefined {
  if (!link) return link;
  return {
    ...link,
    trackedChangeType: normalizeTrackedChangeType(link.trackedChangeType),
  };
}

export function toCommentInfo(
  entry: CommentEntityRecord,
  options: {
    target?: TextTarget;
    status?: CommentStatus;
    anchoredText?: string;
    trackedChangeLink?: CommentTrackedChangeLink | null;
  } = {},
): CommentInfo {
  const resolvedId = typeof entry.commentId === 'string' ? entry.commentId : String(entry.importedId ?? '');
  const status = options.status ?? (isCommentResolved(entry) ? 'resolved' : 'open');
  const trackedChangeId = toNonEmptyString(entry.trackedChangeParentId) ?? resolvedId;
  const trackedChangeLink: CommentTrackedChangeLink | null | undefined =
    options.trackedChangeLink !== undefined
      ? normalizeTrackedChangeLink(options.trackedChangeLink)
      : entry.trackedChange === true ||
          entry.trackedChangeType != null ||
          entry.trackedChangeAnchorKey != null ||
          entry.trackedChangeText != null ||
          entry.deletedText != null
        ? {
            trackedChange: true,
            trackedChangeId,
            trackedChangeType: normalizeTrackedChangeType(entry.trackedChangeType),
            trackedChangeDisplayType: entry.trackedChangeDisplayType ?? null,
            trackedChangeStory: entry.trackedChangeStory ?? null,
            trackedChangeAnchorKey: entry.trackedChangeAnchorKey ?? null,
            trackedChangeText: entry.trackedChangeText ?? null,
            deletedText: entry.deletedText ?? null,
          }
        : null;

  return {
    address: {
      kind: 'entity',
      entityType: 'comment',
      entityId: resolvedId,
    },
    commentId: resolvedId,
    importedId: typeof entry.importedId === 'string' ? entry.importedId : undefined,
    parentCommentId: typeof entry.parentCommentId === 'string' ? entry.parentCommentId : undefined,
    text: extractCommentText(entry),
    isInternal: typeof entry.isInternal === 'boolean' ? entry.isInternal : undefined,
    status,
    target: options.target,
    anchoredText: options.anchoredText,
    createdTime: typeof entry.createdTime === 'number' ? entry.createdTime : undefined,
    creatorName: typeof entry.creatorName === 'string' ? entry.creatorName : undefined,
    creatorEmail: typeof entry.creatorEmail === 'string' ? entry.creatorEmail : undefined,
    trackedChange: trackedChangeLink?.trackedChange === true ? true : undefined,
    trackedChangeType: trackedChangeLink?.trackedChangeType,
    trackedChangeDisplayType: trackedChangeLink?.trackedChangeDisplayType ?? undefined,
    trackedChangeStory: trackedChangeLink?.trackedChangeStory ?? undefined,
    trackedChangeAnchorKey: trackedChangeLink?.trackedChangeAnchorKey ?? undefined,
    trackedChangeText: trackedChangeLink?.trackedChangeText ?? undefined,
    deletedText: trackedChangeLink?.deletedText ?? undefined,
    trackedChangeLink,
  };
}
