import type {
  CommentAddress,
  CommentStatus,
  SelectionTarget,
  StoryLocator,
  TextAddress,
  TextTarget,
} from '../types/index.js';
import type { DiscoveryOutput } from '../types/discovery.js';
import type { TrackChangeType } from '../types/track-changes.types.js';
export type { CommentStatus } from '../types/index.js';

export type CommentMetadataValue =
  | string
  | number
  | boolean
  | null
  | readonly CommentMetadataValue[]
  | { readonly [key: string]: CommentMetadataValue };

/** Caller-owned JSON metadata persisted with a comment. */
export type CommentMetadata = Readonly<Record<string, CommentMetadataValue>>;

/** Optional caller-owned identity and authorship for a newly-created comment. */
export interface CommentCreateAttributionInput {
  authorIdentity?: { providerId: string; userId: string } | null;
  /**
   * Durable document-scoped integration id, distinct from the Word-compatible
   * `commentId` returned by the operation. Must be unique when provided and no
   * longer than 1,024 Unicode characters.
   */
  externalId?: string;
  /** Author display name. Defaults to the configured session author. */
  author?: string;
  /** Stable actor id, matching the v1 `addComment` option. */
  authorId?: string;
  /** Author email, matching the v1 `addComment` option. */
  authorEmail?: string;
  /** Author image URL, matching the v1 `addComment` option. */
  authorImage?: string;
  /** Caller-owned JSON metadata persisted through DOCX save/reopen. */
  metadata?: CommentMetadata;
}

/**
 * Side of a tracked-change anchor that a comment is currently anchored on.
 * Derived on read; not stored in a persisted custom carrier.
 */
export type CommentTrackedChangeSide = 'inserted' | 'deleted' | 'source' | 'destination';
export type TrackedChangeCommentTargetSide = CommentTrackedChangeSide;
/**
 * Convenience target for `comments.create` and
 * `comments.patch({ target })` that references a logical tracked-change
 * id instead of a raw text range.
 */
export interface TrackedChangeCommentTarget {
  /**
   * Discriminator. Optional for compatibility with Labs runners that spell
   * the target as `{ trackedChangeId }` without an explicit `kind` field.
   */
  kind?: 'trackedChange';
  /** SuperDoc logical tracked-change id from `trackChanges.list/get`. */
  trackedChangeId: string;
  /** Which revision side to anchor the comment to. */
  side?: TrackedChangeCommentTargetSide;
  /** Optional story scope. */
  story?: StoryLocator;
}
/**
 * Labs/sdk-v2 shorthand for "anchor this comment to the first occurrence of
 * this text". Adapters normalize it to a concrete TextAddress/TextTarget
 * before mutation.
 */
export interface TextSearchCommentTarget {
  text: string;
  story?: StoryLocator;
}
export type CommentTarget =
  | TextAddress
  | TextTarget
  | SelectionTarget
  | TrackedChangeCommentTarget
  | TextSearchCommentTarget;
/**
 * Richer derived projection that exposes the linked tracked
 * change a comment is anchored to. Carries the canonical logical id, the
 * broad tracked-change type, the side of the link, and (where applicable)
 * the inserted/deleted text excerpts so consumers can render a "comment on
 * tracked change" affordance without an additional `trackChanges.get` call.
 *
 * Derived on read alongside the existing `trackedChangeParentId` /
 * `trackedChangeSide` fields. The legacy fields remain as compatibility
 * aliases (`trackedChangeParentId === trackedChangeLink.trackedChangeId`,
 * `trackedChangeSide === trackedChangeLink.side`).
 */
export interface CommentTrackedChangeLink {
  /** Discriminator — always `true` when the comment is linked. */
  trackedChange: true;
  /** Canonical SuperDoc logical id of the linked tracked change. */
  trackedChangeId: string;
  /** Broad type of the linked tracked change (insertion/deletion/replacement/...). */
  trackedChangeType: TrackChangeType;
  /** Side of the linked tracked change the comment anchor sits on. */
  side?: CommentTrackedChangeSide;
  /**
   * Visible-text excerpt of the side the comment anchors. For deletions and
   * deleted sides of a replacement this carries the deleted text; for
   * insertions and inserted sides of a replacement this carries the
   * inserted text. Omitted when no excerpt is available.
   */
  trackedChangeText?: string;
  /** Display-oriented tracked-change type label, when available. */
  trackedChangeDisplayType?: string | null;
  /** Story containing the linked tracked change, when available. */
  trackedChangeStory?: StoryLocator | null;
  /** Internal anchor key used by older projections, when available. */
  trackedChangeAnchorKey?: string | null;
  /** Inserted text for the linked tracked change, when available. */
  insertedText?: string;
  /** Deleted text for the linked tracked change, when available. */
  deletedText?: string;
}
export interface CommentInfo {
  address: CommentAddress;
  commentId: string;
  /** Word comment-body paragraph identity used for threading, not the annotated paragraph. */
  readonly paraId?: string;
  /** Word durable comment identity, when present in the source. */
  readonly durableId?: string;
  /**
   * Caller-owned integration id. This is distinct from the Word-compatible
   * {@link commentId} and survives save/reopen as a durable correlation key.
   */
  externalId?: string;
  /** Caller-owned JSON metadata persisted with the comment. */
  metadata?: CommentMetadata;
  /**
   * Logical tracked-change id that the comment anchor
   * currently maps wholly to, when the surviving anchor sits inside
   * exactly one active tracked change. Derived on read from the comment
   * anchor index plus the tracked-change catalog. Cleared when the
   * surviving anchor no longer maps wholly to one revision side.
   */
  trackedChangeParentId?: string;
  /**
   * Logical tracked-change id whose SuperDoc review conversation this
   * comment explicitly belongs to. Unlike {@link trackedChangeParentId},
   * this is persisted conversation provenance and is never inferred from
   * anchor overlap.
   */
  trackedChangeThreadParentId?: string;
  /** Which side of the tracked change the anchor sits on. */
  trackedChangeSide?: CommentTrackedChangeSide;
  /**
   * Richer linked tracked-change projection. When present, the
   * legacy `trackedChangeParentId` / `trackedChangeSide` fields mirror
   * `trackedChangeLink.trackedChangeId` / `trackedChangeLink.side`.
   */
  trackedChangeLink?: CommentTrackedChangeLink | null;
  /**
   * Compatibility aliases for consumers that predate `trackedChangeLink`.
   * `trackedChangeType` uses the legacy side vocabulary (`insert`,
   * `delete`, `format`) when there is a direct side equivalent, while the
   * nested `trackedChangeLink.trackedChangeType` remains the canonical v2
   * broad type.
   */
  trackedChange?: boolean;
  trackedChangeType?: TrackChangeType;
  trackedChangeDisplayType?: string | null;
  trackedChangeStory?: StoryLocator | null;
  trackedChangeAnchorKey?: string | null;
  trackedChangeText?: string;
  insertedText?: string;
  deletedText?: string;
  /**
   * Source `w:id` provenance when v2 had to repair the imported id to
   * mint a canonical, Word-compatible `commentId`. Per
   * `comments-spec.md` §13.2 / §13.4: present when the source id was
   * missing, malformed, duplicated, or non-Word-compatible. Omitted
   * when the source id was already a valid unique Word id and v2 kept
   * it unchanged.
   */
  importedId?: string;
  /**
   * Durable raw OOXML source identity: the comment's `w:id` exactly as it
   * appears in `comments.xml`. Unlike {@link importedId} (which is present
   * only when v2 had to repair the source id), `rawOoxmlId` is surfaced for
   * every catalog-backed comment so consumers always have an explicit handle
   * on the original Word id, even when the public `commentId` equals it on a
   * clean import (`comments-spec.md` §13.2 / §13.4). It survives save/reopen
   * because it is the literal id carried in the package bytes. Omitted only
   * for synthetic comments that never had a `comments.xml` carrier (e.g. the
   * live tracked-change review projection).
   */
  rawOoxmlId?: string;
  /**
   * Zero-based source occurrence among comments that share the same
   * {@link rawOoxmlId} in `comments.xml`. Present when the source package
   * contains duplicate raw OOXML ids and consumers need to distinguish which
   * duplicate marker occurrence this comment belongs to.
   */
  rawOoxmlOccurrenceIndex?: number;
  parentCommentId?: string;
  rootCommentId?: string;
  replyCount?: number;
  origin?: 'word' | 'google-docs' | 'superdoc' | 'custom' | 'unknown';
  imported?: boolean;
  text?: string;
  /** Legacy `sdcom:internal` compatibility flag. */
  isInternal?: boolean;
  status: CommentStatus;
  target?: TextTarget;
  anchoredText?: string;
  /**
   * Creation timestamp in milliseconds. Omitted when the source had no
   * `w:date` (`comments-spec.md` §3.1 / §13.2 — v2 MUST NOT fabricate).
   */
  createdTime?: number;
  creatorName?: string;
  creatorId?: string;
  creatorEmail?: string;
  creatorImage?: string;
}
export interface CommentsListQuery {
  includeResolved?: boolean;
  limit?: number;
  offset?: number;
  /**
   * Optional bounded review-window filter. Each id may be canonical or an
   * imported/source alias. Only matching visible threads are projected.
   */
  visibleCommentIds?: readonly string[];
  /** Include every reply belonging to a matched visible thread. */
  includeThreadReplies?: boolean;
}
/**
 * Domain fields for a comment discovery item (C2).
 *
 * These are the comment-specific fields carried alongside the standard
 * `id` and `handle` in each `DiscoveryItem<CommentDomain>`.
 */
export interface CommentDomain {
  address: CommentAddress;
  /** Canonical comment id alias returned by native runtimes. */
  commentId?: string;
  /** See {@link CommentInfo.paraId}. */
  readonly paraId?: string;
  /** See {@link CommentInfo.durableId}. */
  readonly durableId?: string;
  /** See {@link CommentInfo.externalId}. */
  externalId?: string;
  /** See {@link CommentInfo.metadata}. */
  metadata?: CommentMetadata;
  /** See {@link CommentInfo.importedId}. */
  importedId?: string;
  /** See {@link CommentInfo.rawOoxmlId}. */
  rawOoxmlId?: string;
  /** See {@link CommentInfo.rawOoxmlOccurrenceIndex}. */
  rawOoxmlOccurrenceIndex?: number;
  /** See {@link CommentInfo.trackedChangeParentId}. */
  trackedChangeParentId?: string;
  /** See {@link CommentInfo.trackedChangeThreadParentId}. */
  trackedChangeThreadParentId?: string;
  /** See {@link CommentInfo.trackedChangeSide}. */
  trackedChangeSide?: CommentTrackedChangeSide;
  /** See {@link CommentInfo.trackedChangeLink}. */
  trackedChangeLink?: CommentTrackedChangeLink | null;
  /** See {@link CommentInfo.trackedChange}. */
  trackedChange?: boolean;
  /** See {@link CommentInfo.trackedChangeType}. */
  trackedChangeType?: TrackChangeType;
  /** See {@link CommentInfo.trackedChangeDisplayType}. */
  trackedChangeDisplayType?: string | null;
  /** See {@link CommentInfo.trackedChangeStory}. */
  trackedChangeStory?: StoryLocator | null;
  /** See {@link CommentInfo.trackedChangeAnchorKey}. */
  trackedChangeAnchorKey?: string | null;
  /** See {@link CommentInfo.trackedChangeText}. */
  trackedChangeText?: string;
  /** See {@link CommentInfo.insertedText}. */
  insertedText?: string;
  /** See {@link CommentInfo.deletedText}. */
  deletedText?: string;
  parentCommentId?: string;
  rootCommentId?: string;
  replyCount?: number;
  origin?: 'word' | 'google-docs' | 'superdoc' | 'custom' | 'unknown';
  imported?: boolean;
  text?: string;
  /** @deprecated See {@link CommentInfo.isInternal}. Legacy compatibility residue; v2 omits it from projections. */
  isInternal?: boolean;
  status: CommentStatus;
  target?: TextTarget;
  anchoredText?: string;
  createdTime?: number;
  creatorName?: string;
  creatorId?: string;
  creatorEmail?: string;
  creatorImage?: string;
}
/**
 * Standardized discovery output for `comments.list`.
 */
export type CommentsListResult = DiscoveryOutput<CommentDomain>;
