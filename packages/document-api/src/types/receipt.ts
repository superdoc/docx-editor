import type {
  BlockNavigationAddress,
  EntityAddress,
  SelectionTarget,
  TextAddress,
  TrackedChangeAddress,
} from './address.js';
import type { BlockNodeAddress } from './base.js';
import type { BookmarkAddress } from '../bookmarks/bookmarks.types.js';
import type { StoryLocator } from './story.types.js';
import type { ChangeMode } from '../write/write.js';
export type ReceiptInsert = TrackedChangeAddress;
export type ReceiptEntity = EntityAddress;
export type AffectedRef = TextAddress | BookmarkAddress | EntityAddress | BlockNavigationAddress;
export type AffectedRefRemapping = {
  from: AffectedRef;
  to: AffectedRef;
};
export type ReceiptFailureCode =
  | 'NO_OP'
  | 'INVALID_TARGET'
  | 'TARGET_NOT_FOUND'
  | 'CAPABILITY_UNAVAILABLE'
  | 'PERMISSION_DENIED'
  | 'STALE_REVISION'
  | 'REVISION_MISMATCH'
  | 'CHECK_MISMATCH'
  | 'MATCH_NOT_FOUND'
  | 'AMBIGUOUS_MATCH'
  | 'STYLE_CONFLICT'
  | 'PRECONDITION_FAILED'
  | 'COMMENT_CASCADE_PARTIAL'
  | 'INVALID_INPUT'
  | 'CROSS_BLOCK_MATCH'
  | 'SPAN_FRAGMENTED'
  | 'TARGET_MOVED'
  | 'PLAN_CONFLICT_OVERLAP'
  | 'INVALID_STEP_COMBINATION'
  | 'REVISION_CHANGED_SINCE_COMPILE'
  | 'INVALID_INSERTION_CONTEXT'
  | 'DOCUMENT_IDENTITY_CONFLICT'
  | 'UNSUPPORTED_ENVIRONMENT'
  | 'INTERNAL_ERROR'
  | 'PAGE_NUMBERS_NOT_MATERIALIZED'
  // Lists-specific failure codes (SD-1272)
  | 'INCOMPATIBLE_DEFINITIONS'
  | 'NO_COMPATIBLE_PREVIOUS'
  | 'ALREADY_CONTINUOUS'
  | 'NO_PREVIOUS_LIST'
  | 'NO_ADJACENT_SEQUENCE'
  | 'ALREADY_SAME_SEQUENCE'
  | 'LEVEL_OUT_OF_RANGE'
  // SD-1973 formatting failure codes
  | 'LEVEL_NOT_FOUND'
  // Structural content failure codes
  | 'INVALID_NESTING'
  | 'INVALID_PLACEMENT'
  | 'EMPTY_FRAGMENT'
  | 'INVALID_FRAGMENT'
  // SDM/1 structural failure codes
  | 'INVALID_PAYLOAD'
  | 'CAPABILITY_UNSUPPORTED'
  | 'ADDRESS_STALE'
  | 'DUPLICATE_ID'
  | 'INVALID_CONTEXT'
  | 'RAW_MODE_REQUIRED'
  | 'PRESERVE_ONLY_VIOLATION'
  // SD-2070 content controls failure codes
  | 'LOCK_VIOLATION'
  | 'TYPE_MISMATCH'
  // SD-3247 templates.apply receipt failure codes
  | 'UNSUPPORTED_SOURCE'
  | 'INVALID_PACKAGE'
  | 'UNSUPPORTED_TEMPLATE_CONTENT';
/** Known refusals for a text range whose underlying context is identified. */
export type TextRangeRejectionReason =
  | 'text-range-in-sdt'
  | 'text-range-in-field'
  | 'text-range-in-unsupported-tracked-wrapper';

/** Content-control creation keeps its existing top-level failure code. */
export type ContentControlCreationRejectionReason =
  | 'content-control-unsupported-inline-structure'
  | 'content-control-shared-run-boundary';

export type DocumentApiRejectionReason = TextRangeRejectionReason | ContentControlCreationRejectionReason;

export interface DocumentApiRejectionDetails extends Record<string, unknown> {
  reason: DocumentApiRejectionReason;
}

/** Read a known failure.details.reason without assuming every failure has one. */
export function getDocumentApiRejectionReason(details: unknown): DocumentApiRejectionReason | undefined {
  if (typeof details !== 'object' || details === null || !('reason' in details)) return undefined;
  switch (details.reason) {
    case 'text-range-in-sdt':
    case 'text-range-in-field':
    case 'text-range-in-unsupported-tracked-wrapper':
    case 'content-control-unsupported-inline-structure':
    case 'content-control-shared-run-boundary':
      return details.reason;
    default:
      return undefined;
  }
}

export type ReceiptFailure = {
  code: ReceiptFailureCode;
  message: string;
  details?: unknown;
};

export type ReviewWarningFeature = 'comments' | 'trackedChanges';
export type ReviewWarning = {
  /** Stable warning code (e.g. `comments-export-non-exact`). */
  code: string;
  /** Human-readable message for diagnostics and consumer logs. */
  message: string;
  /** Which review feature produced this warning. */
  feature: ReviewWarningFeature;
  /** Severity locked to `warning` so this lane never carries failures or info noise. */
  severity: 'warning';
  /** Public id of the affected review object, when known. */
  affectedObjectId?: string;
  /** Package part URI the warning concerns, when known. */
  affectedPartUri?: string;
  /**
   * Whether export / save can proceed despite the warning. `true` means
   * the receipt still represents a successful operation; `false` means the
   * caller should treat this as a soft block (the kernel surfaced the
   * warning before raising `Receipt.failure`).
   */
  canProceed: boolean;
};
/**
 * A per-story descriptor of how visible text was shifted by an
 * operation. Callers maintain their own held-ref state by applying these
 * deltas:
 *
 * `atChar` is story-absolute. When `blockId` and `atCharInBlock` are both
 * present, they identify the same shift in block-local visible coordinates.
 * Consumers that store block-local ranges must fail closed when that pair is
 * absent rather than interpreting `atChar` as a block offset.
 *
 * Without `replacedLength`, negative `delta` describes a deletion and positive
 * `delta` describes an insertion (e.g. when a `<w:del>` is rejected and its content is restored
 * to the visible flow).
 *
 * When `replacedLength` is present, this is one atomic replacement, including
 * equal-length replacements (`delta: 0`). Apply entries in array order.
 */
export interface TextRangeShift {
  /** The story whose text was shifted. */
  story: StoryLocator;
  /** Character offset in the story's flattened text where the shift begins. */
  atChar: number;
  /** Block containing the shift, when the producer can prove one. */
  blockId?: string;
  /** Visible character offset within `blockId`, paired with `blockId`. */
  atCharInBlock?: number;
  /** Net change in characters. Negative for deletions, positive for insertions. */
  delta: number;
  /** Exact replaced span length at the shift origin; replacement length is this plus delta. */
  replacedLength?: number;
}
/**
 * Exact physical-text splice in paragraph-local tracked coordinates (including
 * pending deleted text). Entries are applied in array order. An empty array
 * proves that physical text did not move; omission makes no such guarantee.
 */
export interface TrackedTextRangeShift {
  story: StoryLocator;
  blockId: string;
  atCharInBlock: number;
  delta: number;
}

// ---------------------------------------------------------------------------
// Created-content effects
//
// `resolution.target` is the resolved mutation target / insertion point. It is
// NOT the newly created visible content — for a collapsed insert it stays a
// collapsed point at the insertion site. Callers that need the span of content
// a mutation CREATED (e.g. to anchor a citation / comment to inserted text)
// read it from `effects` instead. This keeps `resolution.target` semantics
// stable across insert / replace / delete / format while still exposing the
// post-mutation created spans.
// ---------------------------------------------------------------------------

/** A visible text span created by a mutation (e.g. `doc.insert`). */
export interface TextMutationEffect {
  kind: 'insertedText';
  /** Transient source fragment path that produced this created span. */
  sourcePath?: readonly (string | number)[];
  /**
   * Block-absolute address of the created span. `range.start` is the base
   * offset within the target block (nonzero when text was appended into a
   * non-empty paragraph), so callers can shift phrase-relative offsets.
   */
  target: TextAddress;
  /** Selection target covering the created span, for selection-consuming APIs. */
  selectionTarget: SelectionTarget;
  /** The visible text that was created. */
  text: string;
}

/** A block created by a structural mutation (e.g. paragraph/heading insert). */
export interface BlockMutationEffect {
  kind: 'insertedBlock';
  /** Transient source fragment path that produced this created block. */
  sourcePath?: readonly (string | number)[];
  /** Address of the created block. */
  target: BlockNodeAddress;
  /**
   * The created block's visible text span, when the inserted text is known and
   * simple enough to address. Omitted for rich content where an exact text
   * span is not currently available.
   */
  insertedText?: TextMutationEffect;
}

/**
 * Post-mutation created-content lane. Additive and operation-agnostic: insert
 * populates `insertedText` (and `insertedBlocks` for structural inserts);
 * future mutations can populate the same lane without changing
 * `resolution.target`.
 */
export interface ReceiptEffects {
  /** Visible text spans created by the mutation, in document order. */
  insertedText?: TextMutationEffect[];
  /** Blocks created by the mutation, in document order. */
  insertedBlocks?: BlockMutationEffect[];
}

export type ReceiptSuccess = {
  /** Caller correlation for this commit. Never replayed as the original edit on Undo/Redo. */
  changeTag?: string;
  /** Original forward transaction identity for exact anchor restoration during history replay. */
  history?: { txId: string; direction: 'undo' | 'redo'; txIds?: string[] };
  /** Temporary-preview lifecycle and caller tag, also delivered through mutation events. */
  temporary?: import('./temporary-mutation.js').TemporaryMutationMetadata;
  success: true;
  /** Whether a successful request changed the document; false represents a no-op commit. */
  changed?: boolean;
  /** Tracked changes authored by this mutation. */
  trackedChangeRefs?: ReceiptInsert[];
  /** Number of tracked changes authored by this mutation. */
  trackedChangeCount?: number;
  /**
   * Mode in which this call's document content was committed. An edit folded
   * into the author's existing insertion is tracked; auxiliary style and
   * numbering definition writes do not change the content mode. Omitted for
   * dry runs, no-ops, and operations that do not author reviewable content.
   */
  appliedChangeMode?: ChangeMode;
  /**
   * Convenience id for operations that create exactly one primary durable entity.
   * Generic consumers should prefer `inserted`; this field exists for simple
   * create-and-follow-up flows such as `comments.create` → `comments.patch`.
   */
  id?: string;
  /** Entities created by the operation and safe for callers to hold. */
  inserted?: ReceiptEntity[];
  /** Entities whose content or metadata changed but whose identity survived. */
  updated?: ReceiptEntity[];
  /** Entities removed by the operation. */
  removed?: ReceiptEntity[];
  /** Caller-held refs that no longer resolve after the operation. */
  invalidatedRefs?: AffectedRef[];
  /** Caller-held refs whose identity survived at a different address. */
  remappedRefs?: AffectedRefRemapping[];
  /** Stories whose content revision changed because of the operation. */
  affectedStories?: StoryLocator[];
  /**
   * Text-range shifts produced by the operation. Optional.
   * Undefined for ops that don't change visible text (most comment ops).
   * Populated by tracked-change accept/reject operations that delete or
   * restore visible content. See {@link TextRangeShift}.
   */
  textRangeShifts?: TextRangeShift[];
  /** Exact shifts for tracked-coordinate targets, independent of visible text. */
  trackedTextRangeShifts?: TrackedTextRangeShift[];
  /**
   * Transaction id of the successful commit. Optional and
   * additive — engines that lack a per-tx identity omit it. v2 populates
   * this for every successful mutation so callers can wire the receipt to
   * their own history bookkeeping (undo / redo correlation, audit logs).
   */
  txId?: string;
  /**
   * Review foundation: allowed non-exact mappings or
   * non-load-bearing degradations the spec permits. See {@link ReviewWarning}.
   * Forbidden semantic loss MUST surface as `Receipt.failure`, not here.
   * The first real emitter is comment export.
   */
  warnings?: ReviewWarning[];
  /**
   * Post-mutation created-content spans (inserted visible text / blocks).
   * Distinct from `resolution.target`, which is the resolved mutation target /
   * insertion point. See {@link ReceiptEffects}.
   */
  effects?: ReceiptEffects;
};
export type ReceiptFailureResult = {
  success: false;
  failure: ReceiptFailure;
};
export type Receipt = ReceiptSuccess | ReceiptFailureResult;
export type TextMutationRange = {
  from: number;
  to: number;
};
export type TextMutationResolution = {
  /**
   * Requested input target from the caller, when provided.
   * For insert-without-target calls this is omitted.
   */
  requestedTarget?: TextAddress;
  /**
   * Effective target used by the adapter after canonical resolution.
   * For cross-block selections this reflects the first block only -
   * use {@link selectionTarget} for the full resolved range.
   */
  target: TextAddress;
  /**
   * Engine-resolved absolute document range for the effective target.
   */
  range: TextMutationRange;
  /**
   * Snapshot of text currently covered by the resolved range.
   * Empty for collapsed insert targets.
   */
  text: string;
  /**
   * Full selection target for cross-block mutations.
   * Present when the resolved range spans more than one block.
   * Single-block mutations omit this field.
   */
  selectionTarget?: SelectionTarget;
};
export type TextMutationReceipt =
  | (ReceiptSuccess & {
      resolution: TextMutationResolution;
      /** Per-edit tracked-change results for atomic multi-edit mutations. */
      trackedChangeOutcomes?: { editIndex: number; trackedChangeCount: number; trackedChangeRefs: ReceiptInsert[] }[];
    })
  | (ReceiptFailureResult & { resolution: TextMutationResolution });
