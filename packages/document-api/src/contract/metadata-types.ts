/**
 * Shared leaf types for operation metadata.
 *
 * This file is the bottom of the contract import DAG: it imports only
 * from `../types/receipt.js` and has no contract-internal dependencies.
 */

import type { ReceiptFailureCode } from '../types/receipt.js';

export const OPERATION_IDEMPOTENCY_VALUES = ['idempotent', 'conditional', 'non-idempotent'] as const;
export type OperationIdempotency = (typeof OPERATION_IDEMPOTENCY_VALUES)[number];

export const OPERATION_TRACKED_SUPPORT_VALUES = ['always', 'conditional', 'never'] as const;
export type OperationTrackedSupport = (typeof OPERATION_TRACKED_SUPPORT_VALUES)[number];

export const PRE_APPLY_THROW_CODES = [
  'TARGET_NOT_FOUND',
  'CAPABILITY_UNAVAILABLE',
  'INVALID_TARGET',
  'AMBIGUOUS_TARGET',
  'REVISION_MISMATCH',
  'MATCH_NOT_FOUND',
  'AMBIGUOUS_MATCH',
  'STYLE_CONFLICT',
  'PRECONDITION_FAILED',
  'INVALID_INPUT',
  'CROSS_BLOCK_MATCH',
  'SPAN_FRAGMENTED',
  'TARGET_MOVED',
  'PLAN_CONFLICT_OVERLAP',
  'INVALID_STEP_COMBINATION',
  'REVISION_CHANGED_SINCE_COMPILE',
  'INVALID_INSERTION_CONTEXT',
  'DOCUMENT_IDENTITY_CONFLICT',
  'INTERNAL_ERROR',
  // SDM/1 structural throw codes
  'ADDRESS_STALE',
  'DUPLICATE_ID',
  'INVALID_CONTEXT',
  'RAW_MODE_REQUIRED',
  'PRESERVE_ONLY_VIOLATION',
  'CAPABILITY_UNSUPPORTED',
  // SD-2070 content controls throw codes
  'LOCK_VIOLATION',
  'TYPE_MISMATCH',
  // Story-scoped throw codes
  'STORY_NOT_FOUND',
  'STORY_MISMATCH',
  'STORY_NOT_SUPPORTED',
  'CROSS_STORY_PLAN',
  'MATERIALIZATION_FAILED',
] as const;

export type PreApplyThrowCode = (typeof PRE_APPLY_THROW_CODES)[number];

export interface CommandThrowPolicy {
  preApply: readonly PreApplyThrowCode[];
  postApplyForbidden: true;
}

export interface CommandStaticMetadata {
  mutates: boolean;
  idempotency: OperationIdempotency;
  supportsDryRun: boolean;
  /** Canonical tracked-mode eligibility. Legacy boolean fields below are derived from this value. */
  trackedSupport: OperationTrackedSupport;
  /** @deprecated Use `trackedSupport === 'always'`. */
  supportsTrackedMode: boolean;
  /**
   * Tracked mode is permitted for *some* targets of this operation but cannot
   * be promised statically, because whether it applies depends on the document
   * state at the target — not on the operation itself.
   *
   * Set this only when `supportsTrackedMode` is `false`. It does not advertise
   * tracked support: capability reporting still reports `tracked: false`,
   * because the operation cannot guarantee a reviewable revision. What it does
   * is stop transports from rejecting a tracked call on static metadata alone,
   * so the engine adapter gets to resolve the target and make the real
   * decision — succeeding where the context allows it and otherwise failing
   * closed with `CAPABILITY_UNAVAILABLE`, exactly as an unsupported operation
   * would.
   *
   * Without this, an adapter-level contextual allowance is unreachable from
   * any transport that gates on the contract (see `tables.setCellText`).
   */
  /** @deprecated Use `trackedSupport === 'conditional'`. */
  supportsConditionalTrackedMode?: boolean;
  possibleFailureCodes: readonly ReceiptFailureCode[];
  throws: CommandThrowPolicy;
  deterministicTargetResolution: boolean;
  remediationHints?: readonly string[];
  /** When true, this operation bypasses PM transaction history (out-of-band XML mutation). */
  historyUnsafe?: boolean;
  /**
   * When true, the operation's successful/receipt-returning path resolves a
   * Promise and callers must `await` it. Synchronous `throws.preApply` guards
   * still throw before the Promise is created. Defaults to `false` (the
   * operation returns its receipt synchronously).
   */
  returnsPromise?: boolean;
  /** When true, the operation result follows the Receipt success/failure envelope. */
  returnsReceipt?: boolean;
}
