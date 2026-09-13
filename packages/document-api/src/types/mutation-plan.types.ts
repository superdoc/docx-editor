/**
 * Mutation plan types: core input model for the plan engine.
 *
 * All mutating behavior executes through `mutations.apply`. Every operation
 * that changes document state is a step dispatched by the plan engine.
 */

import type { BlockNodeAddress, BlockNodeType } from './base.js';
import type { TextAddress, TrackedChangeAddress, SelectionTarget, DeleteBehavior } from './address.js';
import type { TextSelector, NodeSelector } from './query.js';
import type { InsertStylePolicy, StylePolicy } from './style-policy.types.js';
import type { InlineRunPatch } from '../format/inline-run-patch.js';
import type { SDFragment } from './fragment.js';
import type { Placement, NestingPolicy } from './placement.js';
import type { AffectedRef } from './receipt.js';

// ---------------------------------------------------------------------------
// Universal targeting model
// ---------------------------------------------------------------------------

export type SelectWhere = {
  by: 'select';
  select: TextSelector | NodeSelector;
  within?: BlockNodeAddress;
  require: 'first' | 'exactlyOne' | 'all';
};

export type RefWhere = {
  by: 'ref';
  ref: string;
  within?: BlockNodeAddress;
};

export type TargetWhere = {
  by: 'target';
  target: SelectionTarget;
};

export type BlockWhere = {
  by: 'block';
  nodeType: BlockNodeType;
  nodeId: string;
};

export type StepWhere = SelectWhere | RefWhere | TargetWhere | BlockWhere;

export type AssertWhere = {
  by: 'select';
  select: TextSelector | NodeSelector;
  within?: BlockNodeAddress;
};

// ---------------------------------------------------------------------------
// Replacement content model
// ---------------------------------------------------------------------------

/**
 * A single replacement block for structured multi-paragraph replacements.
 * In this workstream, per-block inline style overrides are not supported;
 * step-level `style` policy applies uniformly to all replacement blocks.
 */
export type ReplacementBlock = {
  text: string;
};

/**
 * Replacement payload for text.rewrite steps.
 *
 * - `{ text }`: flat string. For single-block (range) targets, used as-is.
 *   For cross-block (span) targets, normalized via deterministic paragraph
 *   boundary detection (\n\n+).
 * - `{ blocks }`: structured multi-paragraph payload, authoritative when provided.
 *   Use this for explicit control over paragraph structure.
 *
 * Exactly one of `text` or `blocks` must be provided.
 */
export type ReplacementPayload =
  | { text: string; blocks?: undefined }
  | { text?: undefined; blocks: ReplacementBlock[] };

// ---------------------------------------------------------------------------
// Step types (first registered step family)
// ---------------------------------------------------------------------------

export type TextRewriteStep = {
  id: string;
  op: 'text.rewrite';
  where: StepWhere;
  args: {
    replacement: ReplacementPayload;
    /** Interpret positional `$1`…`$99` and `$&` tokens for regex matches. */
    replacementMode?: 'literal' | 'regex-template';
    /** Preserve the matched text's casing pattern instead of using replacement casing verbatim. */
    caseHandling?: 'exact' | 'preserve-match';
    /**
     * Style policy for the replacement text.
     * When omitted, defaults to preserve mode:
     *   inline: { mode: 'preserve', onNonUniform: 'majority' }
     *   paragraph: { mode: 'preserve' }
     */
    style?: StylePolicy;
  };
};

export type TextInsertStep = {
  id: string;
  op: 'text.insert';
  where: StepWhere;
  args: {
    position: 'before' | 'after';
    content: { text: string };
    style?: InsertStylePolicy;
  };
};

export type TextDeleteStep = {
  id: string;
  op: 'text.delete';
  where: StepWhere;
  args: {
    /** Controls block-edge expansion. Defaults to `'selection'`. */
    behavior?: DeleteBehavior;
  };
};

export type StyleApplyStep = {
  id: string;
  op: 'format.apply';
  where: StepWhere;
  args: {
    inline?: InlineRunPatch;
    alignment?: 'left' | 'center' | 'right' | 'justify';
    /** When "block", inline formatting expands to cover the entire parent textblock(s), not just the matched range. Default: "match". */
    scope?: 'match' | 'block';
  };
};

export type AssertStep = {
  id: string;
  op: 'assert';
  where: AssertWhere;
  args: {
    expectCount: number;
  };
};

export type StructuralInsertStep = {
  id: string;
  op: 'structural.insert';
  where: StepWhere;
  args: {
    content: SDFragment;
    placement?: Placement;
    nestingPolicy?: NestingPolicy;
  };
};

export type StructuralReplaceStep = {
  id: string;
  op: 'structural.replace';
  where: StepWhere;
  args: {
    content: SDFragment;
    nestingPolicy?: NestingPolicy;
  };
};

export type DomainStep = {
  id: string;
  op: string;
  where: StepWhere;
  args: Record<string, unknown>;
};

export type MutationStep =
  | TextRewriteStep
  | TextInsertStep
  | TextDeleteStep
  | StyleApplyStep
  | StructuralInsertStep
  | StructuralReplaceStep
  | AssertStep
  | DomainStep;

// ---------------------------------------------------------------------------
// Plan input
// ---------------------------------------------------------------------------

import type { ChangeMode } from '../write/write.js';
import type { StoryLocator } from './story.types.js';
export type { ChangeMode } from '../write/write.js';

export type MutationsApplyInput = {
  /** Target story for the mutation plan. Omit for body (backward compatible). */
  in?: StoryLocator;
  expectedRevision?: string;
  atomic: true;
  changeMode: ChangeMode;
  steps: MutationStep[];
};

export type MutationsPreviewInput = {
  /** Target story for the mutation preview. Omit for body (backward compatible). */
  in?: StoryLocator;
  expectedRevision?: string;
  atomic: true;
  changeMode: ChangeMode;
  steps: MutationStep[];
  /** Optional page over verbose resolved-target details. Defaults to the first 100 targets. */
  detail?: { offset?: number; limit?: number };
};

// ---------------------------------------------------------------------------
// Plan output: receipts
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Plan limits
// ---------------------------------------------------------------------------

/** Maximum number of steps per mutation plan. */
export const MAX_PLAN_STEPS = 200;

/**
 * @deprecated Historical compatibility metadata. Text replacement no longer
 * enforces this value; callers must not treat it as a supported target limit.
 */
export const MAX_PLAN_RESOLVED_TARGETS = 500;

// ---------------------------------------------------------------------------
// Plan output: receipts
// ---------------------------------------------------------------------------

export type StepEffect = 'changed' | 'noop' | 'error' | 'assert_passed' | 'assert_failed';

/** Resolution for a single-block (range) target. */
export type TextStepResolution = {
  target: TextAddress;
  range: { from: number; to: number };
  text: string;
};

/** Resolution for a cross-block (span) target. */
export type SpanStepResolution = {
  targets: TextAddress[];
  matchId: string;
  text: string;
};

/** Resolution for a selection-based target (may span multiple blocks). */
export type SelectionStepResolution = {
  selectionTarget: SelectionTarget;
  range: { from: number; to: number };
  text: string;
};

export type TextStepData = {
  domain: 'text';
  /** Exact number of targets selected from the step's input revision. */
  matchedCount: number;
  /** Exact number of targets whose content changed. */
  changedCount: number;
  /** Exact number of targets already equal to their requested replacement. */
  noopCount: number;
  /** Exact number of tracked-change identities authored by this step. */
  trackedChangeCount: number;
};

export type AssertStepData = {
  domain: 'assert';
  expectedCount: number;
  actualCount: number;
};

export type DomainStepData = { domain: 'command'; commandDispatched: boolean };

export type TableStepData = {
  domain: 'table';
  tableId: string;
  affectedRows?: string[];
  affectedCells?: string[];
  affectedColumns?: number[];
};

export type StructuralStepData = {
  domain: 'structural';
  insertedBlockIds?: string[];
};

export type StepOutcomeData = TextStepData | AssertStepData | DomainStepData | TableStepData | StructuralStepData;

export type StepOutcome = {
  stepId: string;
  op: string;
  effect: StepEffect;
  matchCount: number;
  trackedChangeIds?: string[];
  data: StepOutcomeData;
};

export type PlanReceipt = {
  success: true;
  revision: {
    before: string;
    after: string;
  };
  steps: StepOutcome[];
  trackedChanges?: TrackedChangeAddress[];
  /** Caller-held refs that no longer resolve after the plan. */
  invalidatedRefs?: AffectedRef[];
  timing: {
    totalMs: number;
  };
};

// ---------------------------------------------------------------------------
// Preview output
// ---------------------------------------------------------------------------

export type PreviewFailurePhase = 'compile' | 'execute' | 'assert';

export type PreviewFailure = {
  code: string;
  stepId: string;
  phase: PreviewFailurePhase;
  message: string;
  details?: unknown;
};

export type StepPreview = {
  stepId: string;
  op: string;
  /** Exact number of targets resolved for this step. */
  matchCount?: number;
  resolutions?: TextStepResolution[];
  detailPage?: { offset: number; limit: number; returned: number };
  spanResolutions?: SpanStepResolution[];
  selectionResolutions?: SelectionStepResolution[];
  style?: unknown;
};

export type MutationsPreviewOutput = {
  evaluatedRevision: string;
  steps: StepPreview[];
  valid: boolean;
  failures?: PreviewFailure[];
};

// ---------------------------------------------------------------------------
// Plan execution error
// ---------------------------------------------------------------------------

export type PlanExecutionError = {
  code: string;
  message: string;
  stepId?: string;
  details?: unknown;
};

// ---------------------------------------------------------------------------
// Revision guard options: canonical definitions in write/write.ts
// ---------------------------------------------------------------------------

export type { RevisionGuardOptions, MutationOptions, RichContentMutationOptions } from '../write/write.js';
