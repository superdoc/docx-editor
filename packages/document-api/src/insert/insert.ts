import {
  executeWrite,
  normalizeMutationOptions,
  type RichContentMutationOptions,
  type WriteAdapter,
} from '../write/write.js';
import type { SelectionTarget, TargetLocator, SDMutationReceipt } from '../types/index.js';
import type { SDInsertInput } from '../types/structural-input.js';
import type { SDFragment } from '../types/fragment.js';
import type { StoryLocator } from '../types/story.types.js';
import { type BlockNodeAddress } from '../types/base.js';
import { PLACEMENT_VALUES, type Placement } from '../types/placement.js';
import { DocumentApiValidationError } from '../errors.js';
import {
  isRecord,
  isBlockNodeAddress,
  assertNoUnknownFields,
  validateNestingPolicyValue,
} from '../validation-primitives.js';
import { isSelectionTarget } from '../validation/selection-target-validator.js';
import { validateDocumentFragment } from '../validation/fragment-validator.js';
import { validateStoryLocator } from '../validation/story-validator.js';
import { textReceiptToSDReceipt } from '../receipt-bridge.js';
import type { SelectionMutationAdapter } from '../selection-mutation.js';

// ---------------------------------------------------------------------------
// Text insert input shape (uses SelectionTarget/ref)
// ---------------------------------------------------------------------------

/** Content format for the text insert operation payload. */
export type InsertContentType = 'text' | 'markdown' | 'html';

type OptionalInsertLocator = TargetLocator | { target?: undefined; ref?: undefined };

/** Text-based input for the insert operation. */
export type TextInsertInput = OptionalInsertLocator & {
  /** Optional insertion target (SelectionTarget). When omitted, inserts at the end of the document. */
  target?: SelectionTarget;
  /** Optional mutation ref returned by a prior find/query. Mutually exclusive with target. */
  ref?: string;
  /** The content to insert. Interpreted according to {@link TextInsertInput.type}. */
  value: string;
  /** Content format. Defaults to `'text'` when omitted. */
  type?: InsertContentType;
  /** Target a specific document story (body, header, footer, footnote, endnote). */
  in?: StoryLocator;
};

/**
 * Type-safe input for markdown/html inserts with block-level positioning.
 * Accepts BlockNodeAddress targets and placement (routed through the structural insert path).
 */
export type RichContentInsertInput = {
  target?: SelectionTarget | BlockNodeAddress;
  ref?: string;
  value: string;
  type: 'markdown' | 'html';
  placement?: Placement;
  in?: StoryLocator;
};

/** @deprecated Use {@link TextInsertInput} instead. */
export type LegacyInsertInput = TextInsertInput;

// ---------------------------------------------------------------------------
// Discriminated union: text string shape OR structural SDFragment shape
// ---------------------------------------------------------------------------

/**
 * Input payload for the `doc.insert` operation.
 *
 * Discrimination: presence of `content` (structural) vs `value` (text string).
 * These are mutually exclusive: providing both is an error.
 */
export type InsertInput = TextInsertInput | RichContentInsertInput | SDInsertInput;

export function isRichContentInsertInput(input: InsertInput): input is RichContentInsertInput {
  return 'value' in input && (input.type === 'html' || input.type === 'markdown');
}

// ---------------------------------------------------------------------------
// Allowlists for strict field validation
// ---------------------------------------------------------------------------

const TEXT_INSERT_ALLOWED_KEYS = new Set(['value', 'type', 'target', 'ref', 'in', 'placement']);
const STRUCTURAL_INSERT_ALLOWED_KEYS = new Set(['content', 'target', 'placement', 'nestingPolicy', 'in']);
const MISPLACED_INSERT_OPTION_EXAMPLES = new Map([
  ['changeMode', 'doc.insert({ value: "text" }, { changeMode: "tracked" })'],
  ['dryRun', 'doc.insert({ value: "text" }, { dryRun: true })'],
]);
const VALID_INSERT_TYPES: ReadonlySet<string> = new Set(['text', 'markdown', 'html']);

// ---------------------------------------------------------------------------
// Shape discrimination
// ---------------------------------------------------------------------------

/** Returns true when the input uses the structural SDFragment shape. */
export function isStructuralInsertInput(input: InsertInput): input is SDInsertInput {
  return 'content' in input && input.content !== undefined;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validates InsertInput as either text or structural shape.
 *
 * Validation order:
 * 0. Input shape guard (must be non-null plain object)
 * 1. Union conflict detection (mutually exclusive discriminants)
 * 2. Shape-specific field and type validation
 */
export function validateInsertInput(input: unknown): asserts input is InsertInput {
  if (!isRecord(input)) {
    throw new DocumentApiValidationError('INVALID_TARGET', 'Insert input must be a non-null object.');
  }

  const hasValue = 'value' in input && input.value !== undefined;
  const hasContent = 'content' in input && input.content !== undefined;

  // Union conflict rule 1: both discriminants present
  if (hasValue && hasContent) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      'Insert input must provide either "value" (text) or "content" (structural), not both.',
      { fields: ['value', 'content'] },
    );
  }

  // Union conflict rule 2: neither discriminant present
  if (!hasValue && !hasContent) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      'Insert input must provide either "value" (text string) or "content" (SDFragment).',
      { fields: ['value', 'content'] },
    );
  }

  validateStoryLocator(input.in, 'in');

  if (hasContent) {
    validateStructuralInsertInput(input);
  } else {
    validateTextInsertInput(input);
  }
}

/** Validates the text-based insert input shape. */
function validateTextInsertInput(input: Record<string, unknown>): void {
  const contentType = typeof input.type === 'string' ? input.type : 'text';
  const isRichContent = contentType === 'markdown' || contentType === 'html';

  // Union conflict rule 4: structural-only fields with text shape
  // placement is allowed for markdown/html since they route through the structural path
  if ('placement' in input && input.placement !== undefined && !isRichContent) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      '"placement" is only valid with structural content input or markdown/html inserts, not with plain "value".',
      { field: 'placement' },
    );
  }
  if ('nestingPolicy' in input && input.nestingPolicy !== undefined) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      '"nestingPolicy" is only valid with structural content input, not with "value".',
      { field: 'nestingPolicy' },
    );
  }

  assertNoUnknownFields(input, TEXT_INSERT_ALLOWED_KEYS, 'insert', MISPLACED_INSERT_OPTION_EXAMPLES);

  // Validate placement value when provided for markdown/html
  if (isRichContent && 'placement' in input && input.placement !== undefined) {
    if (typeof input.placement !== 'string' || !PLACEMENT_VALUES.has(input.placement)) {
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        `placement must be one of: before, after, insideStart, insideEnd. Got "${String(input.placement)}".`,
        { field: 'placement', value: input.placement },
      );
    }
  }

  const { target, ref, value, type } = input;

  // Mutual exclusivity: target and ref
  if (target !== undefined && ref !== undefined) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      'Insert input must provide either "target" or "ref", not both.',
      { fields: ['target', 'ref'] },
    );
  }

  if (target !== undefined) {
    // Markdown/html inserts accept BlockNodeAddress targets (with optional placement)
    // since they route through the structural insert path and produce block-level content.
    if (isRichContent) {
      if (!isSelectionTarget(target) && !isBlockNodeAddress(target)) {
        throw new DocumentApiValidationError(
          'INVALID_TARGET',
          'target must be a SelectionTarget or BlockNodeAddress for markdown/html inserts.',
          { field: 'target', value: target },
        );
      }
    } else if (!isSelectionTarget(target)) {
      throw new DocumentApiValidationError('INVALID_TARGET', 'target must be a SelectionTarget object.', {
        field: 'target',
        value: target,
      });
    }
  }

  if (ref !== undefined && (typeof ref !== 'string' || ref === '')) {
    throw new DocumentApiValidationError('INVALID_TARGET', 'ref must be a non-empty string.', {
      field: 'ref',
      value: ref,
    });
  }

  if (typeof value !== 'string') {
    throw new DocumentApiValidationError('INVALID_TARGET', `value must be a string, got ${typeof value}.`, {
      field: 'value',
      value,
    });
  }

  if (type !== undefined && (typeof type !== 'string' || !VALID_INSERT_TYPES.has(type))) {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `type must be one of: text, markdown, html. Got "${type}".`,
      { field: 'type', value: type },
    );
  }
}

/** Validates the structural SDFragment insert input shape. */
function validateStructuralInsertInput(input: Record<string, unknown>): void {
  // Union conflict rule 3: text-only "type" field with structural content
  if ('type' in input && input.type !== undefined) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      '"type" field is only valid with legacy string input ("value"), not with structural "content".',
      { field: 'type' },
    );
  }

  assertNoUnknownFields(input, STRUCTURAL_INSERT_ALLOWED_KEYS, 'insert', MISPLACED_INSERT_OPTION_EXAMPLES);

  const { target, content, placement, nestingPolicy } = input;

  if (target !== undefined && !isBlockNodeAddress(target)) {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      'target must be a BlockNodeAddress ({ kind: "block", nodeType, nodeId }).',
      {
        field: 'target',
        value: target,
      },
    );
  }

  if (placement !== undefined && (typeof placement !== 'string' || !PLACEMENT_VALUES.has(placement))) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `placement must be one of: before, after, insideStart, insideEnd. Got "${String(placement)}".`,
      { field: 'placement', value: placement },
    );
  }

  validateNestingPolicyValue(nestingPolicy);
  validateDocumentFragment(content as SDFragment);
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/**
 * Executes an insert operation, routing to the appropriate adapter path.
 *
 * - Text inserts with `target` or `ref` route through the SelectionMutationAdapter.
 * - Structural inserts (SDFragment) and non-text content types route through WriteAdapter.
 * - Text inserts without a locator append at the document end via WriteAdapter.
 *
 * @param selectionAdapter - Adapter for target/ref-based text mutations.
 * @param writeAdapter - Adapter for structural and untargeted writes.
 * @param input - Insert payload (text string or structural SDFragment).
 * @param options - Optional mutation options (changeMode, dryRun, expectedRevision).
 * @returns Receipt indicating success/failure and mutation metadata.
 */
export function executeInsert(
  selectionAdapter: SelectionMutationAdapter,
  writeAdapter: WriteAdapter,
  input: InsertInput,
  options?: RichContentMutationOptions,
): SDMutationReceipt {
  validateInsertInput(input);

  // Structural content path: returns SDMutationReceipt directly
  if (isStructuralInsertInput(input)) {
    return writeAdapter.insertStructured(input, normalizeMutationOptions(options));
  }

  // Text string path
  const { value } = input;
  const contentType = input.type ?? 'text';

  // For non-text content types, delegate to the adapter's structured insert path.
  if (contentType !== 'text') {
    return writeAdapter.insertStructured(input, normalizeMutationOptions(options, 'insert'));
  }

  // Text path with target/ref → route through SelectionMutationAdapter
  const { target, ref, in: storyIn } = input as TextInsertInput;
  if (target || ref) {
    const request = target
      ? { kind: 'insert' as const, target, text: value, ...(storyIn ? { in: storyIn } : {}) }
      : { kind: 'insert' as const, ref: ref!, text: value, ...(storyIn ? { in: storyIn } : {}) };
    const textReceipt = selectionAdapter.execute(request, normalizeMutationOptions(options));
    return textReceiptToSDReceipt(textReceipt);
  }

  // Text path without target/ref → target-less insert at document end
  const request = { kind: 'insert' as const, text: value, ...(storyIn ? { in: storyIn } : {}) };
  const textReceipt = executeWrite(writeAdapter, request, options);
  return textReceiptToSDReceipt(textReceipt);
}
