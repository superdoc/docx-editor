import type { Node as ProseMirrorNode } from 'prosemirror-model';
import type { Editor } from '../../core/Editor.js';
import type {
  StoryLocator,
  TrackChangeOverlapInfo,
  TrackChangeOverlapLayer,
  TrackChangeWordRevisionIds,
  TrackedChangeAddress,
} from '@superdoc/document-api';
import {
  TrackDeleteMarkName,
  TrackFormatMarkName,
  TrackInsertMarkName,
} from '../../extensions/track-changes/constants.js';
import { getTrackChanges } from '../../extensions/track-changes/trackChangesHelpers/getTrackChanges.js';
import { enumerateStructuralRowChanges } from '../../extensions/track-changes/trackChangesHelpers/structuralRowChanges.js';
import { enumeratePprChanges } from '../../extensions/track-changes/trackChangesHelpers/pprChanges.js';
import {
  projectInternalTrackChangeType,
  type InternalTrackChangeSubtype,
  type InternalTrackChangeType,
} from './tracked-change-type-utils.js';
import { normalizeExcerpt, toNonEmptyString } from './value-utils.js';
import { textBetweenWithTabs } from './text-with-tabs.js';
import { resolveStoryRuntime } from '../story-runtime/resolve-story-runtime.js';
import { buildStoryKey, BODY_STORY_KEY } from '../story-runtime/story-key.js';
import type { TrackedChangeRuntimeRef } from './tracked-change-runtime-ref.js';

type RawTrackedMark = {
  mark: {
    type: { name: string };
    attrs?: Record<string, unknown>;
  };
  node?: ProseMirrorNode;
  from: number;
  to: number;
};

export type GroupedTrackedChange = {
  rawId: string;
  commandRawId?: string;
  id: string;
  from: number;
  to: number;
  hasInsert: boolean;
  hasDelete: boolean;
  hasFormat: boolean;
  attrs: Record<string, unknown>;
  excerpt?: string;
  wordRevisionIds?: TrackChangeWordRevisionIds;
  overlap?: TrackChangeOverlapInfo;
  /** Set for whole-object structural revisions (e.g. whole-table insert/delete). */
  structural?: { side: 'insertion' | 'deletion'; subtype: InternalTrackChangeSubtype };
};

export type TrackedChangeNavigationSelection = { from: number; to: number };

export type TrackedChangeProjectedSide = 'inserted' | 'deleted';

type ChangeTypeInput = Pick<GroupedTrackedChange, 'hasInsert' | 'hasDelete' | 'hasFormat' | 'structural'>;
type GroupedTrackedChangeDraft = Omit<GroupedTrackedChange, 'id' | 'excerpt'> & {
  excerptParts: string[];
  /**
   * Half-open `[from, to)` ranges already counted toward `excerptParts`. One
   * tracked change can carry more than one mark of the same group over
   * overlapping ranges — e.g. an imported format change whose run-level mark
   * (`[2, 9)`) and paragraph-level mark (`[1, 10)`) both describe the same
   * "Format " text, with {@link getTrackChanges} yielding one entry per mark.
   * Without this guard the overlapping spans concatenate their text twice
   * ("Format Format "), which both misrepresents the excerpt and breaks
   * downstream text-based element location. Skip a span whose range overlaps
   * one already counted so each region of text contributes once.
   */
  excerptRanges: Array<[number, number]>;
};

/** True when two half-open `[from, to)` ranges share any position. */
function rangesOverlap(a: readonly [number, number], b: readonly [number, number]): boolean {
  return a[0] < b[1] && b[0] < a[1];
}
type InternalTrackChangeOverlapLayer = TrackChangeOverlapLayer & {
  rawId?: string;
  commandRawId?: string;
};

function getRawTrackedMarks(editor: Editor): RawTrackedMark[] {
  try {
    const marks = getTrackChanges(editor.state) as RawTrackedMark[];
    return Array.isArray(marks) ? marks : [];
  } catch {
    return [];
  }
}

/**
 * Returns the stable public id for one grouped tracked change.
 *
 * Track-change ids must survive in-place refinement of the same logical change
 * (for example direct editing inside an open insertion). The grouped raw id is
 * already the stable logical identity:
 * - native changes → raw mark id
 * - imported Word changes → source-wrapper key (`word:trackInsert:1`, etc.)
 *
 * Using the raw group key keeps the public id stable while still allowing the
 * canonical-id map to collapse paired replacement aliases at the API edge.
 */
function deriveTrackedChangeId(change: Omit<GroupedTrackedChange, 'id'>): string {
  return change.rawId;
}

export function resolveTrackedChangeType(change: ChangeTypeInput): InternalTrackChangeType {
  if (change.structural) return 'structural';
  if (change.hasFormat) return 'format';
  if (change.hasInsert && change.hasDelete) return 'replacement';
  if (change.hasDelete) return 'delete';
  return 'insert';
}

const groupedCache = new WeakMap<Editor, { doc: ProseMirrorNode; grouped: GroupedTrackedChange[] }>();
type ReplacementsMode = 'paired' | 'independent';

function readReplacementsMode(editor: Editor): ReplacementsMode {
  return editor?.options?.trackedChanges?.replacements === 'independent' ? 'independent' : 'paired';
}

function mergeWordRevisionId(
  target: TrackChangeWordRevisionIds | undefined,
  key: keyof TrackChangeWordRevisionIds,
  value: string | undefined,
): TrackChangeWordRevisionIds | undefined {
  if (!value) return target;

  if (!target) {
    return { [key]: value };
  }

  if (!target[key]) {
    target[key] = value;
  }

  return target;
}

function getWordRevisionIdKey(markType: string): keyof TrackChangeWordRevisionIds | null {
  if (markType === TrackInsertMarkName) return 'insert';
  if (markType === TrackDeleteMarkName) return 'delete';
  if (markType === TrackFormatMarkName) return 'format';
  return null;
}

function getTrackedChangeGroupKey(
  attrs: Readonly<Record<string, unknown>>,
  markType: string,
  fallbackId: string,
): string {
  const sourceId = toNonEmptyString(attrs.sourceId);
  return sourceId ? `word:${markType}:${sourceId}` : fallbackId;
}

/**
 * Word often splits one logical insertion/deletion into several adjacent
 * `<w:ins>`/`<w:del>` XML elements purely due to run-boundary mechanics (a
 * formatting change, a `w:noBreakHyphen` atom starting a new run, ...).
 * `trackedChangeIdMapper.js`'s same-type chaining already assigns the whole
 * chain one shared mark `id` on import — but `getTrackedChangeGroupKey`
 * above keys primarily on `sourceId` (kept distinct per run for export round-
 * trip fidelity), so the main grouping loop still produces one draft per
 * original Word run. This pass folds those same-`id`, same-pure-type drafts
 * back into one entry so the review UI shows one card per Word revision.
 *
 * Deliberately excluded: replacement pairs (one pure-insert draft + one
 * pure-delete draft sharing an `id`) must NOT be merged here — they are
 * intentionally shown as two cards (delete-strike + insert-underline).
 * Restricting to homogeneous single-type drafts (`hasInsert` XOR
 * `hasDelete`, never `hasFormat`) keeps replacement pairs untouched, since
 * they fall under different chain-key prefixes below. Native marks (no
 * `sourceId`) are skipped entirely — they already group correctly by `id`
 * alone via the main loop.
 *
 * Trust boundary: this pass does not independently re-verify positional
 * contiguity via `segmentsByRawId` — it trusts that the importer only ever
 * assigns a shared `id` to genuinely contiguous/bridged chains. It is a
 * normalization layer over that upstream decision, not a second adjacency
 * check; if the importer ever mis-assigns a shared id, this pass will
 * faithfully widen that mistake in the UI. Note that a mis-assigned shared
 * `id` can corrupt more than this pass's merge: the main loop above also
 * sets `commandRawId: id` per draft, and two entries that wrongly share an
 * `id` (e.g. a same-type chain fused into an unrelated opposite-type
 * replacement) would carry the same `commandRawId` even without ever
 * reaching this pass — see `trackedChangeIdMapper.js`'s `canPair`/`canChain`
 * guards, which exist specifically to prevent that upstream.
 *
 * Known limitation (deferred): the merged entry's `attrs`/`wordRevisionIds`
 * retain only the first-seen draft's `sourceId`, not every original run's.
 * Doesn't affect the reported bug or export (export reads `sourceId` off
 * the live PM mark directly, not from this resolver).
 */
function coalesceSameTypeImportedChains(
  byRawId: Map<string, GroupedTrackedChangeDraft>,
  segmentsByRawId: Map<string, Array<{ from: number; to: number }>>,
): void {
  const canonicalKeyByChain = new Map<string, string>();

  for (const [groupKey, draft] of byRawId) {
    const id = toNonEmptyString(draft.attrs.id);
    const sourceId = toNonEmptyString(draft.attrs.sourceId);
    if (!id || !sourceId) continue;

    const isPureInsert = draft.hasInsert && !draft.hasDelete && !draft.hasFormat;
    const isPureDelete = draft.hasDelete && !draft.hasInsert && !draft.hasFormat;
    if (!isPureInsert && !isPureDelete) continue;

    const chainKey = `${isPureInsert ? TrackInsertMarkName : TrackDeleteMarkName}:${id}`;
    const canonicalKey = canonicalKeyByChain.get(chainKey);
    if (!canonicalKey) {
      canonicalKeyByChain.set(chainKey, groupKey);
      continue;
    }
    if (canonicalKey === groupKey) continue;

    const canonical = byRawId.get(canonicalKey);
    if (!canonical) continue;

    canonical.from = Math.min(canonical.from, draft.from);
    canonical.to = Math.max(canonical.to, draft.to);
    for (let i = 0; i < draft.excerptParts.length; i += 1) {
      const range = draft.excerptRanges[i];
      if (!canonical.excerptRanges.some((counted) => rangesOverlap(counted, range))) {
        canonical.excerptRanges.push(range);
        canonical.excerptParts.push(draft.excerptParts[i]);
      }
    }
    if (draft.wordRevisionIds) {
      for (const key of Object.keys(draft.wordRevisionIds) as Array<keyof TrackChangeWordRevisionIds>) {
        canonical.wordRevisionIds = mergeWordRevisionId(canonical.wordRevisionIds, key, draft.wordRevisionIds[key]);
      }
    }

    const canonicalSegments = segmentsByRawId.get(canonicalKey) ?? [];
    const draftSegments = segmentsByRawId.get(groupKey) ?? [];
    segmentsByRawId.set(canonicalKey, canonicalSegments.concat(draftSegments));
    segmentsByRawId.delete(groupKey);

    byRawId.delete(groupKey);
  }
}

function isTrackedMarkName(markType: string | undefined): boolean {
  return markType === TrackInsertMarkName || markType === TrackDeleteMarkName || markType === TrackFormatMarkName;
}

function getTrackedChangeAliasCandidates(change: GroupedTrackedChange): string[] {
  const candidates = [
    change.rawId,
    change.commandRawId,
    change.id,
    toNonEmptyString(change.attrs.id),
    toNonEmptyString(change.attrs.replacementGroupId),
    toNonEmptyString(change.attrs.sourceId),
  ];
  return Array.from(new Set(candidates.filter((value): value is string => Boolean(value))));
}

function replacementPairKey(change: GroupedTrackedChange): string | null {
  if (change.hasInsert === change.hasDelete) return null;
  const replacementGroupId = toNonEmptyString(change.attrs.replacementGroupId);
  if (replacementGroupId) return `group:${replacementGroupId}`;
  if (change.commandRawId) return `command:${change.commandRawId}`;
  return null;
}

function buildPublicTrackedChangeIdMap(
  grouped: ReadonlyArray<GroupedTrackedChange>,
  replacements: ReplacementsMode,
): Map<GroupedTrackedChange, string> {
  const publicIdByChange = new Map<GroupedTrackedChange, string>();

  if (replacements === 'paired') {
    const byPairKey = new Map<string, GroupedTrackedChange[]>();
    for (const change of grouped) {
      if (change.hasInsert && change.hasDelete) continue;
      const key = replacementPairKey(change);
      if (!key) continue;
      const bucket = byPairKey.get(key) ?? [];
      bucket.push(change);
      byPairKey.set(key, bucket);
    }

    for (const group of byPairKey.values()) {
      const inserted = group.find((change) => change.hasInsert && !change.hasDelete);
      const deleted = group.find((change) => change.hasDelete && !change.hasInsert);
      if (!inserted || !deleted) continue;
      publicIdByChange.set(inserted, inserted.id);
      publicIdByChange.set(deleted, inserted.id);
    }
  }

  for (const change of grouped) {
    if (!publicIdByChange.has(change)) {
      publicIdByChange.set(change, change.id);
    }
  }

  return publicIdByChange;
}

function layerFromChange(
  change: GroupedTrackedChange,
  relationship: TrackChangeOverlapLayer['relationship'],
): InternalTrackChangeOverlapLayer {
  const type = resolveTrackedChangeType(change);
  return {
    id: change.id,
    rawId: change.rawId,
    commandRawId: change.commandRawId,
    type: projectInternalTrackChangeType(type, change.structural),
    relationship,
  };
}

function compareOverlapChildren(a: GroupedTrackedChange, b: GroupedTrackedChange): number {
  const aType = projectInternalTrackChangeType(resolveTrackedChangeType(a), a.structural);
  const bType = projectInternalTrackChangeType(resolveTrackedChangeType(b), b.structural);
  if (aType !== bType) {
    if (aType === 'delete') return -1;
    if (bType === 'delete') return 1;
  }
  if (a.from !== b.from) return a.from - b.from;
  return a.id.localeCompare(b.id);
}

function attachOverlapMetadata(grouped: GroupedTrackedChange[]): void {
  if (grouped.length < 2) return;

  const byAlias = new Map<string, GroupedTrackedChange>();
  for (const change of grouped) {
    for (const alias of getTrackedChangeAliasCandidates(change)) {
      if (!byAlias.has(alias)) byAlias.set(alias, change);
    }
  }

  const childrenByParent = new Map<GroupedTrackedChange, GroupedTrackedChange[]>();
  for (const child of grouped) {
    const parentRef = toNonEmptyString(child.attrs.overlapParentId);
    if (!parentRef) continue;
    const parent = byAlias.get(parentRef);
    if (!parent || parent === child) continue;
    const children = childrenByParent.get(parent) ?? [];
    children.push(child);
    childrenByParent.set(parent, children);
  }

  for (const [parent, children] of childrenByParent.entries()) {
    const orderedChildren = children.slice().sort(compareOverlapChildren);
    const visualLayers = [
      layerFromChange(parent, 'parent'),
      ...orderedChildren.map((child) => layerFromChange(child, 'child')),
    ];
    const preferredContextTarget =
      visualLayers.find((layer) => layer.relationship === 'child' && layer.type === 'delete') ??
      visualLayers.find((layer) => layer.relationship === 'child');

    parent.overlap = {
      visualLayers,
      ...(preferredContextTarget
        ? {
            preferredContextTargetId: preferredContextTarget.id,
            preferredContextTarget,
          }
        : {}),
    };
  }
}

export function getTrackedChangeMarkAlias(mark: {
  readonly type: { readonly name: string };
  readonly attrs?: Readonly<Record<string, unknown>>;
}): string | null {
  const markType = mark.type.name;
  if (!isTrackedMarkName(markType)) return null;
  const attrs = mark.attrs ?? {};
  const id = toNonEmptyString(attrs.id);
  if (!id) return null;
  return getTrackedChangeGroupKey(attrs, markType, id);
}

function hasChildTrackedMarkOnNode(item: RawTrackedMark, parentId: string): boolean {
  if (!parentId) return false;
  const marks = Array.isArray(item.node?.marks) ? item.node.marks : [];
  return marks.some((mark) => {
    const markType = mark?.type?.name;
    if (!isTrackedMarkName(markType)) return false;
    return toNonEmptyString(mark?.attrs?.overlapParentId) === parentId;
  });
}

function getTrackedMarkText(editor: Editor, item: RawTrackedMark): string {
  const nodeText = item.node?.text;
  if (typeof nodeText === 'string') return nodeText;
  // Tab nodes: use tab-aware extraction; PM textBetween drops them (SD-3376).
  return textBetweenWithTabs(editor.state.doc, item.from, item.to, ' ', '\ufffc');
}

function rawMarkMatchesChange(mark: RawTrackedMark, change: GroupedTrackedChange): boolean {
  return trackedMarkMatchesChange(mark.mark, change);
}

function trackedMarkMatchesChange(
  mark: { type: { name: string }; attrs?: Record<string, unknown> },
  change: GroupedTrackedChange,
): boolean {
  const attrs = mark.attrs ?? {};
  const rawId = toNonEmptyString(attrs.id);
  if (!rawId) return false;

  const markType = mark.type.name;
  const groupKey = getTrackedChangeGroupKey(attrs, markType, rawId);
  return groupKey === change.rawId || groupKey === change.id || rawId === change.commandRawId || rawId === change.id;
}

function findMarkedTextNodeNavigationSelection(
  editor: Editor,
  change: GroupedTrackedChange,
): TrackedChangeNavigationSelection | null {
  let multiCharacterSelection: TrackedChangeNavigationSelection | null = null;
  let singleCharacterSelection: TrackedChangeNavigationSelection | null = null;

  try {
    editor.state.doc.nodesBetween(change.from, change.to, (node, pos) => {
      if (multiCharacterSelection) return false;
      if (!node.isText) return true;
      const marks = Array.isArray(node.marks) ? node.marks : [];
      if (!marks.some((mark) => trackedMarkMatchesChange(mark, change))) return false;

      const textLength = typeof node.text === 'string' ? node.text.length : node.nodeSize;
      if (textLength > 1) {
        const caret = pos + 1;
        multiCharacterSelection = { from: caret, to: caret };
        return false;
      }
      if (!singleCharacterSelection && textLength > 0) {
        singleCharacterSelection = { from: pos, to: pos + textLength };
      }
      return false;
    });
  } catch {
    return null;
  }

  return multiCharacterSelection ?? singleCharacterSelection;
}

/**
 * Resolve a tracked-change navigation target to a text-backed PM selection.
 *
 * Generic comment/thread cursor placement can land on an unstable outer wrapper,
 * which may jump outside the text-backed change. Track-change navigation can do
 * better because the resolver owns the raw mark ranges:
 * - multi-character text changes use a collapsed caret inside the first text
 *   node rather than at the tracked-change boundary;
 * - one-character changes use the marked range itself, since there is no stable
 *   interior collapsed caret;
 * - structural revisions return `null` so callers can use rendered-element
 *   fallback.
 */
export function resolveTrackedChangeNavigationSelection(
  editor: Editor,
  id: string,
): TrackedChangeNavigationSelection | null {
  const change = resolveTrackedChange(editor, id);
  if (!change || change.structural) return null;

  const markedTextSelection = findMarkedTextNodeNavigationSelection(editor, change);
  if (markedTextSelection) return markedTextSelection;

  const matchingMarks = getRawTrackedMarks(editor)
    .filter((mark) => rawMarkMatchesChange(mark, change))
    .filter((mark) => Number.isFinite(mark.from) && Number.isFinite(mark.to) && mark.to > mark.from)
    .sort((a, b) => {
      if (a.from !== b.from) return a.from - b.from;
      return a.to - b.to;
    });

  const multiCharacterMark = matchingMarks.find((mark) => mark.to - mark.from > 1);
  if (multiCharacterMark) {
    const pos = multiCharacterMark.from + 1;
    return { from: pos, to: pos };
  }

  const singleCharacterMark = matchingMarks[0];
  if (singleCharacterMark) {
    return { from: singleCharacterMark.from, to: singleCharacterMark.to };
  }

  if (change.to > change.from) {
    if (change.to - change.from > 1) {
      const pos = change.from + 1;
      return { from: pos, to: pos };
    }
    return { from: change.from, to: change.to };
  }

  return null;
}

export function groupTrackedChanges(editor: Editor): GroupedTrackedChange[] {
  const currentDoc = editor.state.doc;
  const cached = groupedCache.get(editor);
  if (cached && cached.doc === currentDoc) return cached.grouped;

  const marks = getRawTrackedMarks(editor);
  const byRawId = new Map<string, GroupedTrackedChangeDraft>();
  // Every underlying mark range per grouped id (not just the min/max envelope).
  // A single revision id can have disjoint segments (Word reuses ids across the
  // document), so whole-table subsumption below must test each segment, not the
  // collapsed `from`/`to`.
  const segmentsByRawId = new Map<string, Array<{ from: number; to: number }>>();

  for (const item of marks) {
    const attrs = item.mark?.attrs ?? {};
    const id = toNonEmptyString(attrs.id);
    if (!id) continue;

    const markType = item.mark.type.name;
    const groupKey = getTrackedChangeGroupKey(attrs, markType, id);
    const existing = byRawId.get(groupKey);
    const nextHasInsert = markType === TrackInsertMarkName;
    const nextHasDelete = markType === TrackDeleteMarkName;
    const nextHasFormat = markType === TrackFormatMarkName;
    const wordRevisionId = toNonEmptyString(attrs.sourceId);
    const wordRevisionIdKey = getWordRevisionIdKey(markType);
    const contributesToExcerpt = !wordRevisionId || !hasChildTrackedMarkOnNode(item, id);
    const excerptText = contributesToExcerpt ? getTrackedMarkText(editor, item) : '';
    const range: [number, number] = [item.from, item.to];

    const priorSegments = segmentsByRawId.get(groupKey);
    if (priorSegments) priorSegments.push({ from: item.from, to: item.to });
    else segmentsByRawId.set(groupKey, [{ from: item.from, to: item.to }]);

    if (!existing) {
      byRawId.set(groupKey, {
        rawId: groupKey,
        commandRawId: id,
        from: item.from,
        to: item.to,
        hasInsert: nextHasInsert,
        hasDelete: nextHasDelete,
        hasFormat: nextHasFormat,
        attrs: { ...attrs },
        excerptParts: excerptText ? [excerptText] : [],
        excerptRanges: excerptText ? [range] : [],
        wordRevisionIds: wordRevisionIdKey
          ? mergeWordRevisionId(undefined, wordRevisionIdKey, wordRevisionId ?? undefined)
          : undefined,
      });
      continue;
    }

    existing.from = Math.min(existing.from, item.from);
    existing.to = Math.max(existing.to, item.to);
    existing.hasInsert = existing.hasInsert || nextHasInsert;
    existing.hasDelete = existing.hasDelete || nextHasDelete;
    existing.hasFormat = existing.hasFormat || nextHasFormat;
    if (Object.keys(existing.attrs).length === 0 && Object.keys(attrs).length > 0) {
      existing.attrs = { ...attrs };
    }
    if (excerptText && !existing.excerptRanges.some((counted) => rangesOverlap(counted, range))) {
      existing.excerptRanges.push(range);
      existing.excerptParts.push(excerptText);
    }
    if (wordRevisionIdKey) {
      existing.wordRevisionIds = mergeWordRevisionId(
        existing.wordRevisionIds,
        wordRevisionIdKey,
        wordRevisionId ?? undefined,
      );
    }
  }

  coalesceSameTypeImportedChains(byRawId, segmentsByRawId);

  const grouped = Array.from(byRawId.values())
    .map(({ excerptParts, excerptRanges: _excerptRanges, ...change }) => {
      const hasWordSourceId = Boolean(toNonEmptyString(change.attrs.sourceId));
      const rawExcerpt = excerptParts.join('');
      const withExcerpt = {
        ...change,
        excerpt: excerptParts.length > 0 ? rawExcerpt : hasWordSourceId ? '' : undefined,
      };
      return {
        ...withExcerpt,
        id: deriveTrackedChangeId(withExcerpt),
      };
    })
    .sort((a, b) => {
      if (a.from !== b.from) return a.from - b.from;
      return a.id.localeCompare(b.id);
    });
  attachOverlapMetadata(grouped);

  // Whole-object structural revisions (e.g. whole-table insert/delete) live on
  // node attrs, not marks, so they are enumerated separately and appended as
  // their own grouped changes. Their `id` is the shared Word revision id; the
  // accept/reject command routes by id through the review graph which owns the
  // node-level mutation plan.
  const structuralChanges = enumerateStructuralRowChanges(editor.state);

  // Inline content inside a decidable whole-table structural change is OWNED by
  // that change — a whole inserted/deleted table is ONE logical change, not the
  // structural change plus a separate review item per tracked cell run. Native
  // authoring (markInsertion/markDeletion on cell text) and imported-with-text
  // tables both leave such inline marks, so drop the inline grouped entries
  // whose content lives inside a whole-table range before the structural change
  // is appended. Only decidable whole-table ranges suppress; a partial/
  // undecidable structural shape is not one logical change, so its inline marks
  // stay as their own items. Mirrors the comments-store range suppression
  // (`isInlineRangeInsideTrackedTable`): an inline change is owned only when
  // EVERY one of its segments sits inside some whole-table range. Testing each
  // segment (not the collapsed `from`/`to` envelope) matters when one revision
  // id has disjoint marks across two tracked tables — the envelope would span
  // the gap between them, yet every segment is table-owned. A segment that
  // straddles a table edge is (correctly) not owned, so the change stays.
  const wholeTableRanges = structuralChanges
    .filter((structural) => structural.decidable && structural.wholeTable)
    .map((structural) => ({ from: structural.tableFrom, to: structural.tableTo }));
  if (wholeTableRanges.length > 0) {
    const segmentInsideSomeTable = (segment: { from: number; to: number }) =>
      wholeTableRanges.some((range) => segment.from >= range.from && segment.to <= range.to);
    for (let i = grouped.length - 1; i >= 0; i -= 1) {
      const change = grouped[i];
      const segments = segmentsByRawId.get(change.rawId) ?? [{ from: change.from, to: change.to }];
      const ownedByTable = segments.every(segmentInsideSomeTable);
      if (ownedByTable) grouped.splice(i, 1);
    }
  }

  for (const structural of structuralChanges) {
    const excerpt = normalizeExcerpt(editor.state.doc.textBetween(structural.tableFrom, structural.tableTo, ' ', '￼'));
    // Public id must be stable across import → export → reopen. The logical
    // `structural.id` is a fresh UUID minted on each import, so derive the
    // public/raw id from the Word revision id (mirrors inline `word:<mark>:<id>`
    // grouping). `commandRawId` keeps the logical id the review graph keys by,
    // so accept/reject still routes to the right structural change.
    const stableRawId = structural.sourceId ? `word:structural:${structural.sourceId}` : structural.id;
    grouped.push({
      rawId: stableRawId,
      commandRawId: structural.id,
      id: stableRawId,
      from: structural.tableFrom,
      to: structural.tableTo,
      hasInsert: false,
      hasDelete: false,
      hasFormat: false,
      structural: { side: structural.side, subtype: structural.subtype },
      attrs: {
        id: structural.id,
        sourceId: structural.sourceId || undefined,
        author: structural.author || undefined,
        authorEmail: structural.authorEmail || undefined,
        authorImage: structural.authorImage || undefined,
        date: structural.date || undefined,
        importedAuthor: structural.importedAuthor || undefined,
        origin: structural.sourceId ? 'word' : undefined,
        revisionGroupId: structural.revisionGroupId || undefined,
      },
      excerpt,
      wordRevisionIds: structural.sourceId
        ? structural.side === 'insertion'
          ? { insert: structural.sourceId }
          : { delete: structural.sourceId }
        : undefined,
    });
  }

  // Paragraph-property revisions (w:pPrChange: tracked numbering / alignment)
  // also live on node attrs, not marks, so they are enumerated separately and
  // appended as their own decidable formatting changes. The record id
  // (`paragraphProperties.change.id`) is stored on the node, so it is stable
  // within the session and doubles as the public id and the command id the
  // review graph keys by.
  const pprChanges = enumeratePprChanges(editor.state);
  for (const ppr of pprChanges) {
    const excerpt = normalizeExcerpt(editor.state.doc.textBetween(ppr.from, ppr.to, ' ', '￼'));
    grouped.push({
      rawId: ppr.id,
      commandRawId: ppr.id,
      id: ppr.id,
      from: ppr.from,
      to: ppr.to,
      hasInsert: false,
      hasDelete: false,
      hasFormat: true,
      attrs: {
        id: ppr.id,
        author: ppr.author || undefined,
        authorEmail: ppr.authorEmail || undefined,
        authorImage: ppr.authorImage || undefined,
        date: ppr.date || undefined,
      },
      excerpt,
    });
  }

  grouped.sort((a, b) => {
    if (a.from !== b.from) return a.from - b.from;
    return a.id.localeCompare(b.id);
  });

  groupedCache.set(editor, { doc: currentDoc, grouped });
  return grouped;
}

export function resolveTrackedChange(editor: Editor, id: string): GroupedTrackedChange | null {
  const { baseId } = splitProjectedTrackedChangeId(id);
  const grouped = groupTrackedChanges(editor);
  return grouped.find((item) => item.id === baseId) ?? null;
}

export function toCanonicalTrackedChangeId(editor: Editor, rawId: string): string | null {
  const { baseId, side } = splitProjectedTrackedChangeId(rawId);
  const canonical = buildTrackedChangeCanonicalIdMap(editor).get(baseId) ?? null;
  if (!canonical) return null;
  return side ? `${canonical}#${side}` : canonical;
}

export function buildTrackedChangeCanonicalIdMap(editor: Editor): Map<string, string> {
  const grouped = groupTrackedChanges(editor);
  const publicIdByChange = buildPublicTrackedChangeIdMap(grouped, readReplacementsMode(editor));
  const map = new Map<string, string>();
  for (const change of grouped) {
    const publicId = publicIdByChange.get(change) ?? change.id;
    map.set(change.rawId, publicId);
    map.set(change.id, publicId);
    if (change.commandRawId) map.set(change.commandRawId, publicId);
    const replacementGroupId = toNonEmptyString(change.attrs.replacementGroupId);
    if (replacementGroupId) map.set(replacementGroupId, publicId);
    map.set(publicId, publicId);
    map.set(`${publicId}#inserted`, publicId);
    map.set(`${publicId}#deleted`, publicId);
  }
  return map;
}

export function splitProjectedTrackedChangeId(value: string): {
  baseId: string;
  side: TrackedChangeProjectedSide | null;
} {
  if (value.endsWith('#inserted')) {
    return { baseId: value.slice(0, -'#inserted'.length), side: 'inserted' };
  }
  if (value.endsWith('#deleted')) {
    return { baseId: value.slice(0, -'#deleted'.length), side: 'deleted' };
  }
  return { baseId: value, side: null };
}

// ---------------------------------------------------------------------------
// Story-aware resolution
// ---------------------------------------------------------------------------

/**
 * Resolves a tracked-change identity across stories.
 *
 * Accepts either:
 * - A bare canonical id string (body back-compat), OR
 * - A public {@link TrackedChangeAddress} (with optional `story`).
 *
 * Returns the grouped change AND the story editor that owns it, so callers
 * can apply mutations (accept/reject) against the correct runtime without
 * re-resolving.
 */
export interface ResolvedStoryTrackedChange {
  /** The owning story editor (body host editor OR a story runtime editor). */
  editor: Editor;
  /** Public story locator. */
  story: StoryLocator;
  /** Internal runtime ref. */
  runtimeRef: TrackedChangeRuntimeRef;
  /** The grouped change in the owning editor. */
  change: GroupedTrackedChange;
  /** Optional commit callback — present for non-body runtimes. */
  commit?: (hostEditor: Editor) => void;
}

type TrackedChangeLookupInput = string | TrackedChangeAddress;

function toAddress(input: TrackedChangeLookupInput): TrackedChangeAddress {
  if (typeof input === 'string') {
    return { kind: 'entity', entityType: 'trackedChange', entityId: input };
  }
  return input;
}

/**
 * Resolves a tracked-change id/address to the owning story editor and the
 * grouped change within it.
 *
 * For body addresses (no `story` field) this is an O(n) search against the
 * host editor's grouped marks — same as the legacy body-only resolver.
 *
 * For non-body addresses it resolves the correct story runtime, then performs
 * the lookup within that editor's state.
 *
 * Returns `null` if the address resolves to no matching tracked change.
 */
export function resolveTrackedChangeInStory(
  hostEditor: Editor,
  input: TrackedChangeLookupInput,
): ResolvedStoryTrackedChange | null {
  const address = toAddress(input);
  const entityId = address.entityId;

  const story: StoryLocator = address.story ?? { kind: 'story', storyType: 'body' };
  const storyKey = address.story ? buildStoryKey(address.story) : BODY_STORY_KEY;

  if (storyKey === BODY_STORY_KEY) {
    const match = findMatchingChange(hostEditor, entityId);
    if (!match) return null;
    return {
      editor: hostEditor,
      story,
      runtimeRef: { storyKey: BODY_STORY_KEY, rawId: match.rawId },
      change: match,
    };
  }

  let runtime;
  try {
    runtime = resolveStoryRuntime(hostEditor, story);
  } catch {
    return null;
  }

  const match = findMatchingChange(runtime.editor, entityId);
  if (!match) return null;
  return {
    editor: runtime.editor,
    story: runtime.locator,
    runtimeRef: { storyKey: runtime.storyKey, rawId: match.rawId },
    change: match,
    commit: runtime.commit,
  };
}

/**
 * Lookup helper — accepts both the canonical id and the raw mark id to
 * tolerate callers that stored whichever was convenient at the time.
 */
function findMatchingChange(editor: Editor, id: string): GroupedTrackedChange | null {
  const { baseId } = splitProjectedTrackedChangeId(id);
  const grouped = groupTrackedChanges(editor);
  return grouped.find((item) => item.id === baseId || item.rawId === baseId || item.commandRawId === baseId) ?? null;
}
