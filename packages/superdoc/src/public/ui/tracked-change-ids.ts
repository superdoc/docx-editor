import type { CommentInfo, SelectionSlice, TrackChangeInfo, TrackChangesItem } from './types.js';
import { readRecord, type LooseRecord } from './loose-record.js';
import type { SuperDocUIReason } from './reasons.js';
import { entityRowMatchesRequest, readEntityId, readEntityStory, storyLocatorSignature } from './entity-rows.js';
import { selectionStory } from './selection-targets.js';

export function identityText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export type TrackChangeAuthorship = Pick<TrackChangeInfo, 'author' | 'authorEmail'> & { authorId?: unknown };

export function trackedChangeOwnedByCurrentUser(
  change: TrackChangeAuthorship,
  currentUser: LooseRecord | null,
): boolean {
  const user = currentUser ?? {};
  const currentId = identityText(user.id).toLowerCase();
  const authorId = identityText(change.authorId).toLowerCase();
  if (currentId && authorId) return currentId === authorId;
  const currentEmail = identityText(user.email).toLowerCase();
  const authorEmail = identityText(change.authorEmail).toLowerCase();
  if (currentEmail && authorEmail) return currentEmail === authorEmail;
  if (currentId || currentEmail || authorId || authorEmail) return false;
  const authorName = identityText(change.author).replace(/\s+/g, ' ').toLowerCase();
  if (!authorName) return true;
  const currentName = identityText(user.name).replace(/\s+/g, ' ').toLowerCase();
  return Boolean(currentName && currentName === authorName);
}

export function readCollapsedHostTrackChangeId(snapshot: unknown): string | null {
  const record = readRecord(snapshot);
  if (!record) return null;
  const anchor = readRecord(record.anchor);
  const focus = readRecord(record.focus);
  const anchorVisual = readRecord(anchor?.visualCaret);
  const focusVisual = readRecord(focus?.visualCaret);
  const anchorId = anchorVisual?.trackChangeId;
  const focusId = focusVisual?.trackChangeId;
  return typeof anchorId === 'string' && anchorId.length > 0 && anchorId === focusId ? anchorId : null;
}

export function isNonCollapsedHostSelection(snapshot: unknown): boolean {
  const record = readRecord(snapshot);
  if (!record) return false;
  const anchor = readRecord(record.anchor);
  const focus = readRecord(record.focus);
  if (
    typeof anchor?.blockId !== 'string' ||
    !anchor.blockId ||
    typeof focus?.blockId !== 'string' ||
    !focus.blockId ||
    !Number.isFinite(anchor.blockOffset) ||
    !Number.isFinite(focus.blockOffset)
  )
    return false;
  return (
    anchor.blockId !== focus.blockId ||
    anchor.blockOffset !== focus.blockOffset ||
    (Number.isFinite(anchor.trackedBlockOffset) &&
      Number.isFinite(focus.trackedBlockOffset) &&
      anchor.trackedBlockOffset !== focus.trackedBlockOffset)
  );
}

export type SelectionTrackDecisionPlan =
  | { kind: 'ids'; ids: readonly string[] }
  | { kind: 'id'; id: string; story?: unknown }
  | {
      kind: 'range';
      target: LooseRecord;
      changeId: string | null;
      story?: unknown;
      permissionIds?: readonly string[];
    }
  | { kind: 'blocked'; reason: SuperDocUIReason }
  | { kind: 'unavailable' };

export interface TrackedChangeIdContext {
  toPublicId(rawId: string): string | null;
  aliasesFor(publicId: string): readonly string[];
}

export const trackedChangeIdContextCache = new WeakMap<readonly unknown[], TrackedChangeIdContext>();

export function readTrackChangeProvenanceIds(item: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: unknown): void => {
    if (typeof value === 'string' && value.length > 0 && !seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  };
  const scan = (rec: unknown): void => {
    const record = readRecord(rec);
    if (!record) return;
    const sourceIds = readRecord(record.sourceIds);
    if (sourceIds && typeof sourceIds === 'object') {
      push(sourceIds.wordIdInsert);
      push(sourceIds.wordIdDelete);
      if (Array.isArray(sourceIds.wordIdOther)) for (const w of sourceIds.wordIdOther) push(w);
    }
    const wordRevisionIds = readRecord(record.wordRevisionIds);
    if (wordRevisionIds && typeof wordRevisionIds === 'object') {
      push(wordRevisionIds.insert);
      push(wordRevisionIds.delete);
      push(wordRevisionIds.format);
    }
    const replacement = readRecord(record.replacement);
    if (replacement && typeof replacement === 'object') {
      for (const side of [replacement.inserted, replacement.deleted]) {
        const sideRecord = readRecord(side);
        push(sideRecord?.id);
        push(sideRecord?.wordId);
      }
    }
    const move = readRecord(record.move);
    if (move && typeof move === 'object') {
      for (const side of [move.source, move.destination]) {
        const sideRecord = readRecord(side);
        push(sideRecord?.id);
        push(sideRecord?.wordId);
      }
    }
  };
  scan(item);
  const change = readRecord(item)?.change;
  if (change && change !== item) scan(change);
  return out;
}

export function buildTrackedChangeIdContext(items: readonly unknown[]): TrackedChangeIdContext {
  const cached = trackedChangeIdContextCache.get(items);
  if (cached) return cached;
  const itemIds = new Set<string>();
  const canonicalByAlias = new Map<string, string>();
  for (const item of items) {
    const publicId = readEntityId(item);
    if (!publicId) continue;
    itemIds.add(publicId);
    for (const raw of readTrackChangeProvenanceIds(item)) {
      if (!canonicalByAlias.has(raw)) canonicalByAlias.set(raw, publicId);
      const prefixed = `imported:${raw}`;
      if (!canonicalByAlias.has(prefixed)) canonicalByAlias.set(prefixed, publicId);
    }
  }
  const context: TrackedChangeIdContext = {
    toPublicId(rawId) {
      if (itemIds.has(rawId)) return rawId;
      const canonical = canonicalByAlias.get(rawId);
      return canonical != null && itemIds.has(canonical) ? canonical : null;
    },
    aliasesFor(publicId) {
      const out: string[] = [publicId];
      for (const [alias, canonical] of canonicalByAlias) {
        if (canonical === publicId && alias !== publicId) out.push(alias);
      }
      return out;
    },
  };
  trackedChangeIdContextCache.set(items, context);
  return context;
}

export const storyScopedTrackedChangeIdContextCache = new WeakMap<
  readonly unknown[],
  Map<string, TrackedChangeIdContext>
>();

export const declaredBodyItemsCache = new WeakMap<readonly unknown[], readonly unknown[]>();

export function buildStoryScopedTrackedChangeIdContext(
  items: readonly unknown[],
  story: unknown,
): TrackedChangeIdContext {
  const signature = storyLocatorSignature(story);
  let byStory = storyScopedTrackedChangeIdContextCache.get(items);
  if (!byStory) {
    byStory = new Map();
    storyScopedTrackedChangeIdContextCache.set(items, byStory);
  }
  const cached = byStory.get(signature);
  if (cached) return cached;
  const scoped = items.filter((item) => storyLocatorSignature(readEntityStory(item)) === signature);
  const context = buildTrackedChangeIdContext(scoped);
  byStory.set(signature, context);
  return context;
}

export function isTextboxStory(story: unknown): boolean {
  return readRecord(story)?.storyType === 'textbox';
}

export function resolveStorylessCanonicalTrackedChangeId(
  items: readonly unknown[],
  selectionIds: readonly string[],
): string | null {
  const storyless = selectionIds.filter((id) =>
    items.some((item) => readEntityId(item) === id && readEntityStory(item) == null),
  );
  if (storyless.length === 0) return null;
  if (storyless.length === 1) return storyless[0];

  const seen = new Set<string>();
  for (const id of storyless) {
    const row = items.find((item) => readEntityId(item) === id);
    if (!row) continue;
    for (const raw of readTrackChangeProvenanceIds(row)) {
      if (seen.has(raw)) return null;
      seen.add(raw);
    }
  }
  return storyless[0];
}

export function declaredBodyItems(items: readonly unknown[]): readonly unknown[] {
  const cached = declaredBodyItemsCache.get(items);
  if (cached) return cached;
  const declared = items.filter((item) => readEntityStory(item) != null);
  const result = declared.length === items.length ? items : declared;
  declaredBodyItemsCache.set(items, result);
  return result;
}

export function resolveSelectionActiveChangeId(options: {
  selectionIds: readonly string[];
  publicIds?: readonly string[];
  selection: SelectionSlice;
  bodyItems: readonly unknown[];
  allStoryItems: readonly unknown[] | null;
}): string | null {
  const { selectionIds, publicIds, selection, bodyItems, allStoryItems } = options;
  if (selectionIds.length === 0) return null;

  const mapIds = (context: TrackedChangeIdContext): string | null => {
    for (const id of selectionIds) {
      const publicId = context.toPublicId(id);
      if (publicId) return publicId;
    }
    return null;
  };

  const story = selectionStory(selection);
  const isBodySelection = storyLocatorSignature(story) === storyLocatorSignature(null);

  if (allStoryItems) {
    const scopedItems = isBodySelection ? declaredBodyItems(allStoryItems) : allStoryItems;
    const scoped = buildStoryScopedTrackedChangeIdContext(scopedItems, story);
    const fromStory = mapIds(scoped);
    if (fromStory) return fromStory;
    const fromPublic = publicIds?.find((id) => scopedItems.some((item) => entityRowMatchesRequest(item, id, story)));
    if (fromPublic) return fromPublic;
    if (!isBodySelection) {
      return isTextboxStory(story) ? resolveStorylessCanonicalTrackedChangeId(allStoryItems, selectionIds) : null;
    }
    return mapIds(buildTrackedChangeIdContext(bodyItems));
  }

  if (isBodySelection) {
    return mapIds(buildTrackedChangeIdContext(bodyItems)) ?? selectionIds[0] ?? null;
  }

  return null;
}

export function resolveActiveCommentId(items: readonly CommentInfo[], commentId: string): string | null {
  const item = items.find((candidate) => readEntityId(candidate) === commentId || candidate.importedId === commentId);
  if (!item) return null;
  return item.rootCommentId ?? item.parentCommentId ?? readEntityId(item) ?? commentId;
}

export function trackChangesItemPayload(item: TrackChangesItem): TrackChangeInfo {
  return item.change && typeof item.change === 'object' ? item.change : item;
}
