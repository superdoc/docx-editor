/**
 * Selection-based mutation adapter: the single execution interface for
 * `delete`, `replace` (text path), `insert` (target/ref path), and `format.apply` in the new
 * SelectionTarget / ref model.
 *
 * This replaces the WriteAdapter for delete/replace, handles ref/selection-based
 * text insertion, and replaces the legacy format adapter for format.apply.
 * All four request kinds route through the plan engine.
 */

import type { SelectionTarget, DeleteBehavior, TargetLocator } from './types/address.js';
import type { TextMutationReceipt } from './types/receipt.js';
import type { MutationOptions } from './types/mutation-plan.types.js';
import type { InlineRunPatch } from './format/inline-run-patch.js';
import type { StoryLocator } from './types/story.types.js';

// ---------------------------------------------------------------------------
// Adapter request types
// ---------------------------------------------------------------------------

export type SelectionDeleteRequest = TargetLocator & {
  kind: 'delete';
  target?: SelectionTarget;
  ref?: string;
  behavior: DeleteBehavior;
  /** Story locator threaded from the operation input's `in` field. */
  in?: StoryLocator;
};

export type SelectionReplaceRequest = TargetLocator & {
  kind: 'replace';
  target?: SelectionTarget;
  ref?: string;
  text: string;
  /** Exact selected-text precondition for an explicit single-paragraph selection. */
  expectedText?: string;
  /** Story locator threaded from the operation input's `in` field. */
  in?: StoryLocator;
};

export type SelectionInsertRequest = TargetLocator & {
  kind: 'insert';
  target?: SelectionTarget;
  ref?: string;
  text: string;
  /** Story locator threaded from the operation input's `in` field. */
  in?: StoryLocator;
};

export type SelectionFormatRequest = TargetLocator & {
  kind: 'format';
  target?: SelectionTarget;
  ref?: string;
  inline: InlineRunPatch;
  /** Story locator threaded from the operation input's `in` field. */
  in?: StoryLocator;
};

export type SelectionMutationRequest =
  | SelectionDeleteRequest
  | SelectionReplaceRequest
  | SelectionInsertRequest
  | SelectionFormatRequest;

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

/**
 * Adapter that the plan engine implements for selection-based mutations.
 * Delete, replace-text, insert-with-locator, and format.apply go through this
 * single interface.
 */
export interface SelectionMutationAdapter {
  execute(request: SelectionMutationRequest, options?: MutationOptions): TextMutationReceipt;
}
