import type { OperationId } from '../contract/types.js';
import type {
  AffectedRef,
  AffectedRefRemapping,
  ReceiptEntity,
  TextRangeShift,
  TrackedTextRangeShift,
} from '../types/receipt.js';
import type { StoryLocator } from '../types/story.types.js';
/**
 * Snapshot of the editor's undo/redo history state.
 */
export interface HistoryState {
  /** Number of undo steps available. */
  undoDepth: number;
  /** Number of redo steps available. */
  redoDepth: number;
  /** Whether undo is possible (shorthand for undoDepth > 0). */
  canUndo: boolean;
  /** Whether redo is possible (shorthand for redoDepth > 0). */
  canRedo: boolean;
  /**
   * Operation IDs that bypass PM history (out-of-band mutations).
   * Their effects cannot be undone via history.undo.
   */
  historyUnsafeOperations: readonly OperationId[];
}
/** Machine-readable reason for a history no-op. */
export type HistoryNoopReason =
  | 'EMPTY_UNDO_STACK'
  | 'EMPTY_REDO_STACK'
  | 'NO_EFFECT'
  | 'no-undo-available'
  | 'no-redo-available'
  | 'history-entry-missing'
  | 'apply-rejected';
/**
 * Status of a history action under the collaborative undo contract
 * Existing single-user callers may ignore this and read
 * `noop` / `reason`; collaboration-aware callers receive a richer
 * lifecycle classification.
 */
export type SDHistoryStatus = 'applied' | 'noop' | 'rejected' | 'partial' | 'repaired';
/**
 * Collaboration metadata attached to a `HistoryActionResult` when the
 * undo/redo was evaluated under the collaborative undo policy. Optional;
 * absent in non-collaborative sessions and on v1 adapters.
 */
export interface SDHistoryCollaborationMeta {
  readonly mode: 'session-local' | 'single-shard' | 'journaled-multi-shard';
  readonly undoGroupId?: string;
  readonly opId?: string;
  readonly affectedShards?: ReadonlyArray<string>;
}
/**
 * Result of a history.undo or history.redo action.
 * Mirrors PlanReceipt's revision shape for consistency.
 *
 * The shape also carries three optional collaboration fields:
 * `status`, `diagnosticCode`, and `collaboration`. v1 leaves them
 * undefined; collaborative v2 sessions populate them so callers can react
 * to fail-closed inverse safety checks.
 */
export interface HistoryActionResult {
  /** True if the action had no effect (empty stack). */
  noop: boolean;
  /** Machine-readable reason when noop is true. */
  reason?: HistoryNoopReason;
  /** Revision bookends matching PlanReceipt.revision shape. */
  revision: {
    before: string;
    after: string;
  };
  /** Entities created by this history action. v2: redo of insert; v1: undefined. */
  inserted?: ReceiptEntity[];
  /** Entities updated by this history action. */
  updated?: ReceiptEntity[];
  /** Entities removed by this history action. v2: undo of insert; v1: undefined. */
  removed?: ReceiptEntity[];
  /** Refs the action made dead handles (e.g. comment ids that no longer exist). */
  invalidatedRefs?: AffectedRef[];
  /** Refs whose identity moved as a result of the action. */
  remappedRefs?: AffectedRefRemapping[];
  /** Stories whose revision advanced as a result of the action. */
  affectedStories?: StoryLocator[];
  /**
   * Text-range shifts produced by the undone/redone action.
   * Optional. v1 adapters leave it undefined; v2 surfaces shifts when an
   * undone or redone transaction changed visible text.
   */
  textRangeShifts?: TextRangeShift[];
  /** Exact block-local physical-text shifts, including deleted revision text. */
  trackedTextRangeShifts?: TrackedTextRangeShift[];
  /** Original forward transaction identity; absent on older adapters and no-op results. */
  history?: { txId: string; direction: 'undo' | 'redo'; txIds?: string[] };
  /**
   * Collaborative undo status. v1 callers may ignore this.
   */
  status?: SDHistoryStatus;
  /**
   * Machine-readable diagnostic when status is `rejected`,
   * `partial`, or `repaired`. Carries the `COLLAB_V2_UNDO_*` codes from the
   * collaboration runtime.
   */
  diagnosticCode?: string;
  /**
   * Collaboration metadata for the undone/redone op.
   * Present only for collaborative v2 sessions.
   */
  collaboration?: SDHistoryCollaborationMeta;
}
