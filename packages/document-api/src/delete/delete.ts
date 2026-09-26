/**
 * Delete operation: removes content at a contiguous document selection.
 *
 * Accepts either an explicit `SelectionTarget` or a mutation-ready `ref`
 * string from discovery APIs (`query.match`, `find`).
 */

import type { SelectionTarget, DeleteBehavior, TargetLocator } from '../types/address.js';
import type { TextMutationReceipt } from '../types/receipt.js';
import type { MutationOptions } from '../types/mutation-plan.types.js';
import type { StoryLocator } from '../types/story.types.js';
import type { SelectionMutationAdapter } from '../selection-mutation.js';
import { normalizeMutationOptions } from '../write/write.js';
import { DocumentApiValidationError } from '../errors.js';
import { isRecord, assertNoUnknownFields } from '../validation-primitives.js';
import { isSelectionTarget } from '../validation/selection-target-validator.js';
import { validateStoryLocator } from '../validation/story-validator.js';

// ---------------------------------------------------------------------------
// Public input type
// ---------------------------------------------------------------------------

export type DeleteInput = TargetLocator & {
  /** Explicit selection target. Exactly one of `target` or `ref` is required. */
  target?: SelectionTarget;
  /** Mutation-ready ref from `query.match` or `find`. */
  ref?: string;
  /**
   * Delete behavior mode.
   * - `'selection'` (default): expand to block edges when boundary blocks are fully covered.
   * - `'exact'`: delete only the exact resolved range.
   */
  behavior?: DeleteBehavior;
  /** Target a specific document story (body, header, footer, footnote, endnote). */
  in?: StoryLocator;
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const DELETE_INPUT_ALLOWED_KEYS = new Set(['target', 'ref', 'behavior', 'in']);
const VALID_BEHAVIORS: ReadonlySet<string> = new Set(['selection', 'exact']);

function validateDeleteInput(input: unknown): asserts input is DeleteInput {
  if (!isRecord(input)) {
    throw new DocumentApiValidationError('INVALID_TARGET', 'Delete input must be a non-null object.');
  }

  assertNoUnknownFields(input, DELETE_INPUT_ALLOWED_KEYS, 'delete', 'doc.delete');
  validateStoryLocator(input.in, 'in');

  const { target, ref, behavior } = input;

  // Exactly one of target or ref
  const hasTarget = target !== undefined;
  const hasRef = ref !== undefined;

  if (hasTarget && hasRef) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      'Delete input must provide either "target" or "ref", not both.',
      { fields: ['target', 'ref'] },
    );
  }

  if (!hasTarget && !hasRef) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'Delete input must provide either "target" or "ref".', {
      fields: ['target', 'ref'],
    });
  }

  if (hasTarget && !isSelectionTarget(target)) {
    throw new DocumentApiValidationError('INVALID_TARGET', 'target must be a SelectionTarget object.', {
      field: 'target',
      value: target,
    });
  }

  if (hasRef && (typeof ref !== 'string' || ref === '')) {
    throw new DocumentApiValidationError('INVALID_TARGET', 'ref must be a non-empty string.', {
      field: 'ref',
      value: ref,
    });
  }

  if (behavior !== undefined && !VALID_BEHAVIORS.has(behavior as string)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `behavior must be "selection" or "exact", got "${String(behavior)}".`,
      { field: 'behavior', value: behavior },
    );
  }
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export function executeDelete(
  adapter: SelectionMutationAdapter,
  input: DeleteInput,
  options?: MutationOptions,
): TextMutationReceipt {
  validateDeleteInput(input);
  const request = input.target
    ? { kind: 'delete' as const, target: input.target, behavior: input.behavior ?? 'selection', in: input.in }
    : { kind: 'delete' as const, ref: input.ref!, behavior: input.behavior ?? 'selection', in: input.in };

  return adapter.execute(request, normalizeMutationOptions(options));
}
