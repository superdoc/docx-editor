import type { TextTarget, TrackedChangeAddress } from './address.js';
import type { DiscoveryOutput } from './discovery.js';
import type { StoryLocator } from './story.types.js';
/**
 * Canonical v2 tracked-change broad-type vocabulary.
 *
 * Public adapters MUST emit one of these values. Existing v1 emitters and
 * tests still produce the legacy `insert` / `delete` / `format` strings; both
 * sets are accepted by {@link TrackChangeType} during the vocabulary
 * legacy strings are documented compatibility aliases only — new code must
 * emit the canonical vocabulary.
 */
export type TrackChangeBroadType = 'insertion' | 'deletion' | 'replacement' | 'formatting' | 'move' | 'structural';
/**
 * Legacy aliases retained during the vocabulary migration. Do not introduce new
 * call sites that emit these values; prefer {@link TrackChangeBroadType}.
 */
export type LegacyTrackChangeType = 'insert' | 'delete' | 'format';
/**
 * Tracked-change broad type accepted by the public API. The v2 logical
 * projection emits {@link TrackChangeBroadType}; legacy v1 emitters may still
 * produce {@link LegacyTrackChangeType}. Filters accept either spelling.
 */
export type TrackChangeType = TrackChangeBroadType | LegacyTrackChangeType;
/**
 * Optional semantic subtype string. Spec §3 lists a required subtype
 * vocabulary; the current model covers text revisions (`text-insertion`,
 * `text-deletion`, `text-replacement`). Other subtypes are emitted once
 * later phases land their structural/formatting/move work.
 */
export type TrackChangeSubtype = string;
/**
 * Lifecycle state per spec §3. Open tracked changes are the only ones
 * returned by `trackChanges.list` / `trackChanges.get`. The read model
 * always emits `open`; accepted/rejected resolution is applied through
 * 003.
 */
export type TrackChangeState = 'open' | 'accepted' | 'rejected';
/**
 * Raw imported Word OOXML revision IDs (`w:id`) from the source document
 * when available.
 *
 * @deprecated Provenance metadata only. Prefer {@link TrackChangeSourceIds}
 * for new code. Retained as a compatibility alias surfacing the prior
 * legacy shape: an insertion fragment surfaces `insert`, a deletion
 * surfaces `delete`, a formatting revision surfaces `format`, and a grouped
 * replacement may surface both text sides.
 */
export interface TrackChangeWordRevisionIds {
  /** Raw imported Word OOXML revision ID (`w:id`) from a `<w:ins>` element when present. */
  insert?: string;
  /** Raw imported Word OOXML revision ID (`w:id`) from a `<w:del>` element when present. */
  delete?: string;
  /** Raw imported Word OOXML revision ID (`w:id`) from a `<w:rPrChange>` element when present. */
  format?: string;
}
/**
 * Canonical multi-side source provenance per spec §3 / §4. Each value is
 * raw, source-format identity (Word `w:id`, `w:rsidR` / `w:rsidDel`, future
 * platform ids). They are not the canonical SuperDoc logical id and MUST
 * NOT be returned as the primary identifier.
 */
export interface TrackChangeSourceIds {
  /** Word `w:id` value from the insertion side of this logical change. */
  wordIdInsert?: string;
  /** Word `w:id` value from the deletion side of this logical change. */
  wordIdDelete?: string;
  /** Word `w:id` values from other wrappers (e.g. rPrChange, moveFrom/moveTo). */
  wordIdOther?: readonly string[];
  /** Word revision-save ids (`w:rsidR` / `w:rsidDel`) seen on contributing wrappers. */
  rsids?: readonly string[];
}
/**
 * Per-side metadata returned for replacement changes in `grouped` mode. The
 * `id` values are stable SuperDoc-internal side ids so callers (e.g. decide
 * decide range targeting) can address either side without re-reading OOXML.
 */
export interface TrackChangeReplacementSides {
  inserted: TrackChangeReplacementSide | null;
  deleted: TrackChangeReplacementSide | null;
}
export interface TrackChangeReplacementSide {
  /** SuperDoc-internal side id (stable across a session for the same fragment). */
  id: string;
  /** Visible text excerpt on this side. */
  excerpt: string;
  /** Raw Word `w:id` for this side, when known. */
  wordId?: string;
}
/**
 * Tracked formatting subtype vocabulary per `tracked-changes-spec.md` §6.
 * Covers run, paragraph, list, table, row, cell, section, and content-control
 * formatting revisions, plus image/drawing property revisions.
 */
export type TrackChangeFormattingSubtype =
  | 'run'
  | 'paragraph'
  | 'list'
  | 'table'
  | 'row'
  | 'cell'
  | 'section'
  | 'content-control'
  | 'image';
/**
 * Coarse logical object a formatting revision applies to. Paragraph/list
 * formatting-on-structural-target changes (indentation, line height, list
 * level/style/membership) keep broad type `formatting`; this names the object
 * the formatting targets so callers can route UI labels and later decisions
 * without inferring it from raw OOXML.
 */
export type TrackChangeFormattingTargetKind =
  | 'run'
  | 'paragraph'
  | 'list-item'
  | 'table'
  | 'row'
  | 'cell'
  | 'section'
  | 'content-control';
/**
 * Fine-grained formatting-on-target semantic subtype. A richer detail string
 * than {@link TrackChangeFormattingSubtype}; the broad subtype field stays the
 * compatibility value while this names the specific formatting change
 * (paragraph indentation vs line height vs style; list style vs level vs
 * numbering vs add/remove membership). Open vocabulary so later plans can add
 * subtypes without a breaking change.
 */
export type TrackChangeFormattingSemanticSubtype = string;
/**
 * Per-side metadata for tracked moves. `id` is the SuperDoc-
 * internal side id, `excerpt` is a visible-text preview, and `wordId` carries
 * the raw Word `w:id` from the `w:moveFrom` / `w:moveTo` wrapper. Mirrors
 * the shape of {@link TrackChangeReplacementSide} for symmetry.
 */
export interface TrackChangeMoveSide {
  /** SuperDoc-internal side id (stable across a session for the same fragment). */
  id: string;
  /** Visible-text excerpt for this side. */
  excerpt: string;
  /** Raw Word `w:id` on this side, when known. */
  wordId?: string;
}
/**
 * Paired source / destination metadata for tracked moves
 * (spec §5). `pairId` is the SuperDoc logical pair identity reconstructed
 * from Word move range markers and adjacency. `null` sides describe a
 * source/destination half whose mate could not be paired.
 */
export interface TrackChangeMoveSides {
  /** Move-from side (source content / location). */
  source: TrackChangeMoveSide | null;
  /** Move-to side (destination content / location). */
  destination: TrackChangeMoveSide | null;
  /** Logical pair identity when both sides are reliably paired. */
  pairId?: string;
}
/**
 * Logical move target projection. Text-level paired moves
 * surface concrete source/destination text targets; future structural move
 * support may widen these lanes beyond text.
 */
export interface TrackChangeMoveTarget {
  kind: 'move';
  address: TrackedChangeAddress;
  source: TextTarget | null;
  destination: TextTarget | null;
}
/**
 * Semantic list-delta classification vocabulary for tracked list formatting
 * changes (tracked-changes spec `TC-LIST-004`). Each member of a formatting
 * review object is classified by diffing the live paragraph properties
 * against the `pPrChange` snapshot, restricted to list-relevant properties.
 */
export type TrackChangeListDeltaKind =
  | 'list-add'
  | 'list-remove'
  | 'list-level'
  | 'list-style'
  | 'list-restart'
  | 'indent'
  | 'other-format';
/**
 * Resolved visual style kind for one side of a list delta, derived from the
 * numbering model's `numFmt` at the effective level. `null` when the side has
 * no list membership or its numbering definition cannot be resolved
 * (fail-closed: never guessed).
 */
export type TrackChangeListStyleKind = 'bullet' | 'number' | 'letter' | 'roman' | 'other';
/** One side (before/after) of a member list delta. */
export interface TrackChangeListDeltaSide {
  /** Explicit `numPr` element present in the property block on this side. */
  hasNumPr: boolean;
  /** Effective list membership numId; non-positive numIds normalize to null. */
  numId: string | null;
  /** Explicit `ilvl` value; null when the source omitted it (effective level 0). */
  ilvl: number | null;
  /** Resolved visual style kind via the numbering model; null when unresolvable. */
  styleKind: TrackChangeListStyleKind | null;
}
/**
 * Structured semantic delta for one member of a (possibly grouped) tracked
 * list formatting change. Facts only — presentation copy is derived by
 * consumers.
 */
export interface TrackChangeListMemberDelta {
  kind: TrackChangeListDeltaKind;
  from: TrackChangeListDeltaSide;
  to: TrackChangeListDeltaSide;
  /** Direction of a `list-level` change. */
  levelDirection?: 'indent' | 'outdent';
  /** Restart value for a `list-restart` change (numbering-model derived). */
  restartAt?: number;
}
/** Group roll-up of the member list deltas. */
export interface TrackChangeListDeltaSummary {
  /** The single kind shared by every member, or null for mixed groups. */
  uniformKind: TrackChangeListDeltaKind | null;
  /** Non-zero member counts per delta kind. */
  counts: Partial<Record<TrackChangeListDeltaKind, number>>;
}
/**
 * Semantic snapshot for one side of a tracked formatting revision.
 * `xml` carries the raw OOXML preserved by import / native creation;
 * `properties` exposes a subtype-aware key→value view for the most commonly
 * tracked properties so callers can render the delta without an OOXML parser.
 */
export interface TrackChangeFormattingSnapshot {
  /** Raw OOXML for the property block on this side. */
  xml: string;
  /** Subtype-aware semantic property map. */
  properties: Record<string, unknown>;
}
/**
 * Logical structural target classes required by the tracked-changes spec's
 * first-class structural descriptor contract ("Semantic Type vs UI Label vs
 * OOXML Carrier"). The target remains a logical document object, not raw OOXML
 * storage detail. The vocabulary now covers the full structural surface
 * (list items, images/drawings, fields, content controls, section breaks,
 * footnotes/endnotes, and non-body note stories) so structural revisions on
 * those objects are addressable instead of failing closed at the target lane.
 */
export type TrackChangeStructuralTargetKind =
  | 'paragraph'
  | 'paragraph-mark'
  | 'list-item'
  | 'table'
  | 'row'
  | 'column'
  | 'cell'
  | 'image'
  | 'drawing'
  | 'field'
  | 'content-control'
  | 'section-break'
  | 'footnote'
  | 'endnote'
  | 'note-story';
/**
 * Structural operation for the first-class structural descriptor. A structural
 * revision changes the reviewable identity/topology of a document object;
 * property-only revisions keep broad type `formatting`.
 */
export type TrackChangeStructuralOperation =
  | 'insert'
  | 'delete'
  | 'replace'
  | 'split'
  | 'merge'
  | 'move'
  | 'story-edit';
/** Granularity of a structural revision per the descriptor contract. */
export type TrackChangeStructuralGranularity = 'whole-object' | 'range' | 'story-part';
/**
 * Decision policy per the descriptor contract. `unsupported-fail-closed`
 * requires a partial decision to fail closed rather than mutate.
 */
export type TrackChangeStructuralDecisionPolicy =
  | 'atomic'
  | 'range-divisible'
  | 'child-addressable'
  | 'unsupported-fail-closed';
/**
 * OOXML carrier inventory: the revision wrapper / property-change element names
 * a structural or formatting change relies on (e.g. `w:ins`, `w:del`,
 * `w:tblPrChange`, `w:cellIns`). Proof asserts these survive a no-op export.
 */
export type OoxmlCarrierInventory = readonly string[];
/**
 * Semantic snapshot for one side of a structural tracked change.
 * `xml` is the raw OOXML snapshot needed to restore/apply the relevant
 * structure; `state` distinguishes structural absence (e.g. insertion
 * before-state) from a present structural shape.
 */
export interface TrackChangeStructuralSnapshot {
  /** Which structural object/boundary this snapshot describes. */
  targetKind: TrackChangeStructuralTargetKind;
  /** Semantic structural subtype driving accept/reject. */
  structuralKind: TrackChangeSubtype;
  /** Whether the targeted structure exists on this side of the change. */
  state: 'present' | 'absent';
  /** Raw OOXML snapshot for this side when the structure is present. */
  xml: string | null;
  /** Raw marker / wrapper XML preserved from the source when relevant. */
  markerXml?: string;
  /** Wrapped inner XML for block-level structural wrappers when available. */
  innerXml?: string;
}
/**
 * Whole-object child-ownership policy for a structural revision. When Word
 * encodes contained inline edits under the same revision wrapper, the
 * structural change owns them (`subsumed`) rather than surfacing them as
 * separate review items, unless the subtype is explicitly child-addressable.
 */
export interface TrackChangeStructuralChildOwnership {
  /** Whether contained inline changes are owned by this structural change. */
  ownsContainedInlineChanges: boolean;
  /** Logical ids of the owned contained inline changes. */
  childChangeIds: readonly string[];
  /** Whether owned children are hidden (`subsumed`) or independently decidable. */
  duplicateDisplayPolicy: 'subsumed' | 'child-addressable';
}
/**
 * First-class structural descriptor (spec "Structural descriptor shape").
 * Exposed alongside {@link TrackChangeInfo.before}/`after` so a caller can
 * inspect and decide a structural revision programmatically without parsing
 * OOXML: it carries the operation, granularity, decision policy, affected
 * stories, and the OOXML carrier inventory that must survive export.
 */
export interface TrackChangeStructuralDescriptor {
  /** Topology operation the revision performs. */
  operation: TrackChangeStructuralOperation;
  /** Whether the change is whole-object, range-divisible, or story-part scoped. */
  granularity: TrackChangeStructuralGranularity;
  /** How partial accept/reject must behave; drives fail-closed safety. */
  decisionPolicy: TrackChangeStructuralDecisionPolicy;
  /** Structural state needed to reject the change. */
  before: TrackChangeStructuralSnapshot;
  /** Structural state needed to accept the change. */
  after: TrackChangeStructuralSnapshot;
  /** Stories touched by the change beyond the primary anchor (notes, parts). */
  affectedStories: readonly StoryLocator[];
  /** Raw source provenance ids contributing to this structural change. */
  sourceIds: TrackChangeSourceIds;
  /** OOXML carrier element names that must survive a no-op export. */
  exportCarrier: OoxmlCarrierInventory;
  /** Whole-object child-ownership policy when the change contains inline edits. */
  childOwnership?: TrackChangeStructuralChildOwnership;
}
/**
 * Logical target description per spec §3. The model ships `text`,
 * `replacement`, and `formatting` target kinds;
 * structural target kinds land under the same field as they arrive.
 */
export type TrackChangeTarget =
  | {
      kind: 'text';
      address: TrackedChangeAddress;
    }
  | {
      kind: 'replacement';
      address: TrackedChangeAddress;
    }
  | {
      kind: 'formatting';
      address: TrackedChangeAddress;
      /** Which property class the revision affects. */
      subtype: TrackChangeFormattingSubtype;
      /**
       * Coarse logical object the formatting change targets (paragraph,
       * list-item, run, …). Lets consumers treat list/paragraph property
       * changes as target-aware formatting without a structural descriptor.
       */
      targetKind?: TrackChangeFormattingTargetKind;
      /** Fine-grained formatting-on-target subtype (e.g. `paragraph-indentation`, `list-formatting-level`). */
      semanticSubtype?: TrackChangeFormattingSemanticSubtype;
      /** Property keys that changed between the before/after snapshots. */
      changedKeys?: readonly string[];
      /** OOXML carrier element names backing this formatting change. */
      carriers?: OoxmlCarrierInventory;
    }
  | {
      kind: 'structural';
      address: TrackedChangeAddress;
      /** Which structural object/boundary the change targets. */
      targetKind: TrackChangeStructuralTargetKind;
      /**
       * More specific semantic kind when the structural target has one. For
       * field targets this is the Word field classification (for example,
       * `hyperlink`, `page`, or `ref`).
       */
      semanticSubtype?: string;
    }
  | TrackChangeMoveTarget;
/**
 * Semantic before/after snapshot. Shape depends on `type` / `subtype`.
 * Text revisions emit visible text snapshots; tracked property changes
 * add formatting snapshots.
 */
export interface TrackChangeSnapshot {
  /** Visible text snapshot, when the affected revision is text-shaped. */
  text?: string;
  /** Formatting snapshot, when the affected revision is property-shaped. */
  formatting?: TrackChangeFormattingSnapshot;
  /** Structural snapshot, when the affected revision is structure-shaped. */
  structural?: TrackChangeStructuralSnapshot;
}
/**
 * Source-platform provenance per spec §3. Imported Word DOCX revisions
 * surface as `word`; v2 native edits surface `superdoc`.
 */
export type TrackChangeProvenanceOrigin = 'word' | 'google-docs' | 'superdoc' | 'custom' | 'unknown';
export type TrackChangeSourcePlatform = TrackChangeProvenanceOrigin;
/**
 * Public semantic grouping for a tracked change. A grouped replacement is one
 * logical public item representing both the deleted and inserted Word
 * revision wrappers.
 */
export type TrackChangeGrouping = 'standalone' | 'replacement-pair' | 'unknown';
/**
 * How the public logical id was canonicalized from source revision data.
 */
export type TrackChangeCanonicalizationKind =
  | 'single-word-revision'
  | 'paired-word-revision'
  | 'generated-runtime-id'
  | 'unknown';
/**
 * Flat navigation address summary for semantic snapshots.
 */
export type TrackChangeAddressKind = 'entity' | 'story-entity' | 'unknown';
/**
 * Relationship a tracked change has to its overlap group.
 *
 *   • `parent`     — the change is the parent surface of an overlap (e.g.
 *                    Word's outer insertion that flanks a child deletion).
 *   • `child`      — the change is a follow-up nested inside another
 *                    author's revision shape.
 *   • `standalone` — no overlap relationship; surface omitted by default.
 */
export type TrackChangeOverlapRelationship = 'parent' | 'child' | 'standalone';
/**
 * One visual layer in an overlap group. `type` mirrors the
 * canonical broad-type vocabulary so renderers can paint each layer with
 * the same style they use for non-overlap revisions.
 */
export interface TrackChangeOverlapLayer {
  /** SuperDoc logical id of the contributing tracked change. */
  id: string;
  /** Broad type of the layer (canonical v2 spelling). */
  type: TrackChangeType;
  /** Layer relationship to the parent overlap surface. */
  relationship: TrackChangeOverlapRelationship;
}
/**
 * Overlap metadata projected onto a tracked change. The
 * parent surface carries the layer list and the preferred context-target
 * pointer. Child changes carry a minimal payload (`relationship: 'child'`
 * plus the parent layer reference) so consumers can route comments / UI
 * back to the parent group.
 */
export interface TrackChangeOverlapInfo {
  /**
   * Ordered visual layers backing this overlap. The parent layer is index
   * 0; children follow in deterministic order (deletions before insertions,
   * then document order, then logical id).
   */
  visualLayers?: readonly TrackChangeOverlapLayer[];
  /**
   * Preferred context-target id for parent surfaces. Points to the first
   * child deletion when one exists, otherwise the first child, otherwise
   * absent.
   */
  preferredContextTargetId?: string;
  /** Mirror of the chosen layer for `preferredContextTargetId`. */
  preferredContextTarget?: TrackChangeOverlapLayer;
  /** Relationship of this change to the overlap group. */
  relationship?: TrackChangeOverlapRelationship;
  /**
   * For child layers, the parent's logical id. Lets consumers walk back
   * to the parent surface without re-running the overlap projection.
   */
  parentId?: string;
}
export interface TrackChangeLinkedComments {
  count: number;
  commentIds?: readonly string[];
}
export type TrackChangeMoveDirection = 'up' | 'down';
export interface TrackChangeImagePreview {
  /** Browser-renderable preview source for the image side represented by this change. */
  src: string;
  /** MIME type of the media part used in {@link src}. */
  contentType: string;
  /** Which revision side the preview represents. */
  role: 'deleted' | 'inserted' | 'before' | 'after';
  /** Source media part URI, when the preview came from an internal DOCX part. */
  partUri?: string;
  /** Owner-part-scoped relationship id used to resolve the media part. */
  relationshipId?: string;
  /** Intended display width in CSS pixels, when the source drawing extent is known. */
  width?: number;
  /** Intended display height in CSS pixels, when the source drawing extent is known. */
  height?: number;
  /** Accessible label for clients that render the preview. */
  alt?: string;
}
/**
 * Authoritative block address for review navigation. Consumers use this
 * instead of interpreting the shape-specific {@link TrackChangeTarget}
 * union. `role` records which semantic carrier supplied the address.
 */
export interface TrackChangeNavigationTarget {
  kind: 'block';
  story: StoryLocator;
  blockId: string;
  role: 'primary' | 'move-source' | 'move-destination' | 'formatting-carrier' | 'structural-carrier';
}
export interface TrackChangeCustomAttribute {
  /** Source-qualified attribute name, preserving the prefix used by the carrier. */
  name: string;
  /** Resolved extension namespace URI. */
  namespaceUri: string;
  /** Attribute local name without its namespace prefix. */
  localName: string;
  /** Decoded XML attribute value. */
  value: string;
}
export interface TrackChangeInfo {
  address: TrackedChangeAddress;
  /** Stable SuperDoc logical tracked-change id (spec §3 / §4). */
  id: string;
  type: TrackChangeType;
  /** Semantic subtype string (spec §3, required-subtype matrix). */
  subtype?: TrackChangeSubtype;
  /** Lifecycle state. The read model always emits `open`. */
  state?: TrackChangeState;
  /** Logical target description. */
  target?: TrackChangeTarget;
  /** Stable story/block address for focus and virtualized materialization. */
  navigationTarget?: TrackChangeNavigationTarget;
  /** Semantic before-state needed to reject the change. */
  before?: TrackChangeSnapshot;
  /** Semantic after-state needed to accept the change. */
  after?: TrackChangeSnapshot;
  /**
   * First-class structural descriptor for `structural` / `move` changes
   * (spec "Structural descriptor shape"). Present once the runtime ships the
   * richer boundary payload; absent for changes that only carry the legacy
   * `before`/`after` snapshot. A null descriptor on a structural change is an
   * explicit closure gap, not authoritative closure.
   */
  structuralDescriptor?: TrackChangeStructuralDescriptor;
  /**
   * Canonical multi-side source provenance (spec §3 / §4). New consumers
   * MUST read provenance from this field. `wordRevisionIds` is preserved
   * as a compatibility alias only.
   */
  sourceIds?: TrackChangeSourceIds;
  /**
   * @deprecated Use {@link sourceIds}. Compatibility alias retained during
   * the vocabulary migration; populated alongside `sourceIds` for existing
   * consumers that read this field. Will be removed in a later cleanup.
   */
  wordRevisionIds?: TrackChangeWordRevisionIds;
  /** Stable revision-group id (spec §3, fragment lineage). */
  revisionGroupId?: string;
  /** Set to the retired source id when this change is a partial-split fragment; otherwise `null`. */
  splitFromId?: string | null;
  /** Replacement side metadata (`grouped` mode replacements only). */
  replacement?: TrackChangeReplacementSides;
  /** Move side metadata for paired tracked moves. */
  move?: TrackChangeMoveSides;
  /** Direction of a paired move in document order, when source/destination order is known. */
  moveDirection?: TrackChangeMoveDirection;
  author?: string;
  authorEmail?: string;
  authorImage?: string;
  /** Author initials (spec §3 required field, when provided by the source). */
  initials?: string;
  date?: string;
  /**
   * Story locator the change lives in (spec §3 part/story). Body remains
   * the default and is also represented inline on `address.story`.
   */
  storyLocator?: StoryLocator;
  /** Originating platform of the imported revision when known. */
  sourcePlatform?: TrackChangeSourcePlatform;
  /** Flat semantic grouping used by public requirement snapshots. */
  grouping?: TrackChangeGrouping;
  /** Partner logical id when the change is represented as one side of a pair; otherwise `null`. */
  pairedWithChangeId?: string | null;
  /** Inserted visible text for text insertions/replacements when available. */
  insertedText?: string | null;
  /** Deleted visible text for text deletions/replacements when available. */
  deletedText?: string | null;
  /** Human-readable formatting delta summary for formatting changes; otherwise `null`. */
  formattingDeltaSummary?: string | null;
  /**
   * Structured per-member list semantic deltas for tracked list formatting
   * changes (spec `TC-LIST-003`/`TC-LIST-004`). Index-aligned with the
   * grouped members (length 1 for single-carrier changes); absent for
   * non-list-formatting changes.
   */
  listDeltas?: readonly TrackChangeListMemberDelta[];
  /** Group roll-up of {@link listDeltas}; present iff `listDeltas` is. */
  listDeltaSummary?: TrackChangeListDeltaSummary;
  /**
   * Structural list-membership fact for paragraph-mark structural changes:
   * true iff the target paragraph's live properties carry direct effective
   * list membership; false when inspected and not a list item; absent when
   * the target paragraph was not inspected.
   */
  targetIsListItem?: boolean;
  /**
   * Stable presentation fact on the merge-owner deletion change (the change
   * owning a suppressed merge-companion property revision, spec
   * `TC-LIST-005`).
   */
  listActionKind?: 'merge-items';
  /** Originating platform alias for consumers that read flat provenance fields. */
  origin?: TrackChangeSourcePlatform;
  /** Whether the change came from an imported source revision wrapper. */
  imported?: boolean;
  /** How the public id was derived from source revision data. */
  canonicalizationKind?: TrackChangeCanonicalizationKind;
  /** Flat address summary for list/get semantic snapshots. */
  addressKind?: TrackChangeAddressKind;
  /** Whether `trackChanges.get({ id })` can resolve this public list id. */
  resolvableById?: boolean;
  /** Comments whose anchor is wholly associated with this tracked change. */
  linkedComments?: TrackChangeLinkedComments;
  /** Visual preview for image-backed tracked changes when an internal browser-renderable image part is available. */
  imagePreview?: TrackChangeImagePreview;
  excerpt?: string;
  /**
   * Overlap relationship metadata for Word-shape overlapping
   * tracked changes. Absent when the change is standalone.
   */
  overlap?: TrackChangeOverlapInfo;
  /**
   * Unknown extension attributes attached to contributing OOXML revision carriers.
   * Exact duplicates are removed in document order; conflicting values are retained.
   */
  readonly customAttributes?: readonly TrackChangeCustomAttribute[];
}
export interface TrackChangesListQuery {
  limit?: number;
  offset?: number;
  /**
   * Filter by tracked-change broad type. Accepts the canonical spec
   * vocabulary (`insertion` / `deletion` / `replacement` / ...) and the
   * legacy `insert` / `delete` / `format` aliases during migration.
   */
  type?: TrackChangeType;
  /**
   * Story scope.
   * - `undefined` (default): body only (backward compatible).
   * - A {@link StoryLocator}: only that story.
   * - `'all'`: flat list across body + every revision-capable non-body story.
   */
  in?: StoryLocator | TrackChangesInAll;
}
/**
 * Scope marker used by {@link TrackChangesListQuery.in} to request changes
 * across every revision-capable story (body + headers + footers + footnotes +
 * endnotes). Equivalent to a multi-story aggregate list.
 */
export const TRACK_CHANGES_IN_ALL = 'all' as const;
export type TrackChangesInAll = typeof TRACK_CHANGES_IN_ALL;
/**
 * Compact list-projection fields.
 * `trackChanges.list` MAY omit the richer `target` / `before` / `after`
 * payloads carried by {@link TrackChangeInfo}; callers wanting full detail
 * call `trackChanges.get`.
 */
export interface TrackChangeDomain {
  address: TrackedChangeAddress;
  type: TrackChangeType;
  /** Semantic subtype string. */
  subtype?: TrackChangeSubtype;
  /** Lifecycle state. */
  state?: TrackChangeState;
  /** Logical target summary for list consumers when the compact projection can provide it safely. */
  target?: TrackChangeTarget;
  /** Stable story/block address for focus and virtualized materialization. */
  navigationTarget?: TrackChangeNavigationTarget;
  /** Move side metadata for paired tracked moves. */
  move?: TrackChangeMoveSides;
  /** Direction of a paired move in document order, when source/destination order is known. */
  moveDirection?: TrackChangeMoveDirection;
  /**
   * First-class structural descriptor for structural / move changes when the
   * compact list projection can derive the full before/after boundary safely.
   */
  structuralDescriptor?: TrackChangeStructuralDescriptor;
  /** Stable revision-group id. */
  revisionGroupId?: string;
  /** Set to the retired source id when this list item is a partial-split fragment; otherwise `null`. */
  splitFromId?: string | null;
  /**
   * Canonical multi-side source provenance. Compact list projection MAY
   * surface this so callers can correlate ids back to source OOXML.
   */
  sourceIds?: TrackChangeSourceIds;
  /**
   * @deprecated Use {@link sourceIds}. Compatibility alias only.
   */
  wordRevisionIds?: TrackChangeWordRevisionIds;
  author?: string;
  authorEmail?: string;
  authorImage?: string;
  /** Author initials. */
  initials?: string;
  date?: string;
  excerpt?: string;
  /** Story locator for the change (body omitted for backward compat). */
  storyLocator?: StoryLocator;
  /** Flat semantic grouping used by public requirement snapshots. */
  grouping?: TrackChangeGrouping;
  /** Partner logical id when the change is represented as one side of a pair; otherwise `null`. */
  pairedWithChangeId?: string | null;
  /** Inserted visible text for text insertions/replacements when available. */
  insertedText?: string | null;
  /** Deleted visible text for text deletions/replacements when available. */
  deletedText?: string | null;
  /** Human-readable formatting delta summary for formatting changes; otherwise `null`. */
  formattingDeltaSummary?: string | null;
  /**
   * Structured per-member list semantic deltas for tracked list formatting
   * changes (spec `TC-LIST-003`/`TC-LIST-004`). Index-aligned with the
   * grouped members (length 1 for single-carrier changes); absent for
   * non-list-formatting changes.
   */
  listDeltas?: readonly TrackChangeListMemberDelta[];
  /** Group roll-up of {@link listDeltas}; present iff `listDeltas` is. */
  listDeltaSummary?: TrackChangeListDeltaSummary;
  /**
   * Structural list-membership fact for paragraph-mark structural changes:
   * true iff the target paragraph's live properties carry direct effective
   * list membership; false when inspected and not a list item; absent when
   * the target paragraph was not inspected.
   */
  targetIsListItem?: boolean;
  /**
   * Stable presentation fact on the merge-owner deletion change (the change
   * owning a suppressed merge-companion property revision, spec
   * `TC-LIST-005`).
   */
  listActionKind?: 'merge-items';
  /** Originating platform alias for consumers that read flat provenance fields. */
  origin?: TrackChangeSourcePlatform;
  /** Whether the change came from an imported source revision wrapper. */
  imported?: boolean;
  /** How the public id was derived from source revision data. */
  canonicalizationKind?: TrackChangeCanonicalizationKind;
  /** Flat address summary for list/get semantic snapshots. */
  addressKind?: TrackChangeAddressKind;
  /** Whether `trackChanges.get({ id })` can resolve this public list id. */
  resolvableById?: boolean;
  /** Comments whose anchor is wholly associated with this tracked change. */
  linkedComments?: TrackChangeLinkedComments;
  /** Visual preview for image-backed tracked changes when an internal browser-renderable image part is available. */
  imagePreview?: TrackChangeImagePreview;
  /**
   * Overlap relationship metadata for list consumers. When
   * present, `visualLayers` lets a list-only client render the overlap
   * stack without an extra `trackChanges.get` round trip.
   */
  overlap?: TrackChangeOverlapInfo;
  /** Unknown extension attributes attached to the contributing OOXML revision carriers. */
  readonly customAttributes?: readonly TrackChangeCustomAttribute[];
}
/**
 * Standardized discovery output for `trackChanges.list`.
 */
export type TrackChangesListResult = DiscoveryOutput<TrackChangeDomain>;
