/**
 * Public types for the snapshot-based document diff contract.
 *
 * These types are engine-agnostic wrappers around opaque engine payloads.
 * The `payload` field in both DiffSnapshot and DiffPayload is engine-owned
 * and must not be inspected by consumers.
 */

import type { TrackedChangeAddress } from '../types/address.js';
import type { StoryLocator } from '../types/story.types.js';
import type { TrackChangeNavigationTarget } from '../types/track-changes.types.js';

// ---------------------------------------------------------------------------
// Engine identification
// ---------------------------------------------------------------------------

/** Identifier for the engine adapter that produced the opaque payload. */
export type DiffEngineId = 'superdoc-v2';

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

/** Declares which document components are included in a snapshot or diff. */
export interface DiffCoverage {
  body: true;
  comments: boolean;
  styles: boolean;
  numbering: boolean;
  headerFooters: boolean;
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

/** Versioned, fingerprinted snapshot of a document's diffable state. */
export interface DiffSnapshot {
  version: 'sd-diff-snapshot/v1' | 'sd-diff-snapshot/v2';
  engine: DiffEngineId;
  fingerprint: string;
  coverage: DiffCoverage;
  /** Opaque engine-owned snapshot data. Do not inspect or modify. */
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Diff result types
// ---------------------------------------------------------------------------

/** Coarse change summary for a diff payload. */
export interface DiffSummary {
  hasChanges: boolean;
  changedComponents: Array<'body' | 'comments' | 'styles' | 'numbering' | 'headerFooters' | 'parts'>;
  body: { hasChanges: boolean };
  comments: { hasChanges: boolean };
  styles: { hasChanges: boolean };
  numbering: { hasChanges: boolean };
  headerFooters: { hasChanges: boolean };
  parts: { hasChanges: boolean };
}

/** Stable reason code for a compare-time apply blocker. */
export type DiffApplyEligibilityBlockerCode =
  | 'family-apply-lane-unavailable'
  | 'header-footer-physical-lifecycle-unsafe'
  | 'header-footer-tracked-lifecycle-unsupported'
  | 'comment-replay-unsafe'
  | 'comment-anchor-marker-semantics-unsafe'
  | 'styles-replay-unsafe'
  | 'numbering-replay-unsafe'
  | 'section-reference-replay-unsafe'
  | 'structural-paragraph-unsupported';

/** A known reason that the complete diff cannot be applied in one change mode. */
export interface DiffApplyEligibilityBlocker {
  code: DiffApplyEligibilityBlockerCode;
  message: string;
  families?: string[];
}

/** Compare-time apply posture for one change mode. */
export interface DiffApplyModeEligibility {
  status: 'candidate' | 'blocked';
  blockers: DiffApplyEligibilityBlocker[];
}

/** Compare-time apply posture for each supported change mode. */
export interface DiffApplyEligibility {
  direct: DiffApplyModeEligibility;
  tracked: DiffApplyModeEligibility;
}

/** Versioned diff payload describing changes from a base to a target document. */
export interface DiffPayload {
  version: 'sd-diff-payload/v1' | 'sd-diff-payload/v2';
  engine: DiffEngineId;
  baseFingerprint: string;
  targetFingerprint: string;
  coverage: DiffCoverage;
  summary: DiffSummary;
  /** Known compare-time blockers by apply mode. Candidate status is not a live apply guarantee. */
  applyEligibility?: DiffApplyEligibility;
  /** Opaque engine-owned diff data. Do not inspect or modify. */
  payload: Record<string, unknown>;
}

export interface DiffApplyReviewItem {
  id: string;
  story: StoryLocator;
  address: TrackedChangeAddress;
  navigationTarget?: TrackChangeNavigationTarget;
}

export type DiffApplyOperationReceipt =
  | {
      operationId: string;
      disposition: 'review-created';
      reviewItems: [DiffApplyReviewItem, ...DiffApplyReviewItem[]];
    }
  | {
      operationId: string;
      disposition: 'applied-directly';
      reviewItems: [];
    };

export interface DiffApplyResult {
  appliedOperations: number;
  operationReceipts: DiffApplyOperationReceipt[];
  baseFingerprint: string;
  targetFingerprint: string;
  coverage: DiffCoverage;
  summary: DiffSummary;
  diagnostics: string[];
}

// ---------------------------------------------------------------------------
// Operation inputs
// ---------------------------------------------------------------------------

/** Input for `diff.compare`. */
export interface DiffCompareInput {
  targetSnapshot: DiffSnapshot;
}

/** Input for `diff.apply`. */
export interface DiffApplyInput {
  diff: DiffPayload;
}

// ---------------------------------------------------------------------------
// Change mode (re-exported for convenience)
// ---------------------------------------------------------------------------

/** How body content changes are applied. */
export type DiffChangeMode = 'direct' | 'tracked';

/** Options for `diff.apply`. Omitted `changeMode` applies story content directly. */
export interface DiffApplyOptions {
  changeMode?: DiffChangeMode;
}
