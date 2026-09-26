/**
 * Replace operation: replaces content at a contiguous document selection.
 *
 * Three mutually exclusive shapes:
 * - Text replacement (`text` field): routes through SelectionMutationAdapter.
 * - Rich HTML/Markdown replacement (`value` field): routes through WriteAdapter.replaceStructured.
 * - Structural replacement (`content` field): routes through WriteAdapter.replaceStructured.
 *
 * Text replacement accepts `SelectionTarget` or `ref`. Rich and structural
 * replacements also accept `BlockNodeAddress`.
 */

import type { RichContentMutationOptions } from '../write/write.js';
import type { SelectionTarget, TargetLocator } from '../types/address.js';
import type { SDMutationReceipt } from '../types/sd-contract.js';
import type { SDReplaceInput } from '../types/structural-input.js';
import type { SDFragment } from '../types/fragment.js';
import type { BodyStoryLocator, StoryLocator } from '../types/story.types.js';
import type { BlockNodeAddress } from '../types/base.js';
import type { NestingPolicy } from '../types/placement.js';
import type { SelectionMutationAdapter } from '../selection-mutation.js';
import type { WriteAdapter } from '../write/write.js';
import { normalizeMutationOptions } from '../write/write.js';
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

// ---------------------------------------------------------------------------
// Text replacement input (new shape)
// ---------------------------------------------------------------------------

/** Text replacement input: uses SelectionTarget / ref, or the complete main body. */
export type TextReplaceInput =
  | (TargetLocator & {
      target?: SelectionTarget;
      ref?: string;
      text: string;
      /** Target a specific document story (body, header, footer, footnote, endnote). */
      in?: StoryLocator;
    })
  | {
      target: BodyStoryLocator;
      text: string;
      ref?: never;
      in?: never;
    };

/** HTML or Markdown replacement input for conversion and structured application. */
export type RichContentReplaceInput =
  | {
      value: string;
      type: 'html' | 'markdown';
      target?: SelectionTarget | BlockNodeAddress;
      ref?: string;
      in?: StoryLocator;
      nestingPolicy?: NestingPolicy;
    }
  | {
      value: string;
      type: 'html' | 'markdown';
      target: BodyStoryLocator;
      ref?: never;
      in?: never;
      nestingPolicy?: never;
    };

// ---------------------------------------------------------------------------
// Discriminated union: text, rich string, or structural SDFragment shape
// ---------------------------------------------------------------------------

/**
 * Input payload for the `doc.replace` operation.
 *
 * Discrimination: `text` (plain), `value` (HTML/Markdown), or `content` (SDFragment).
 */
export type ReplaceInput = TextReplaceInput | RichContentReplaceInput | SDReplaceInput;

// ---------------------------------------------------------------------------
// Allowlists
// ---------------------------------------------------------------------------

const TEXT_REPLACE_ALLOWED_KEYS = new Set(['text', 'target', 'ref', 'in']);
const STRUCTURAL_REPLACE_ALLOWED_KEYS = new Set(['content', 'target', 'ref', 'nestingPolicy', 'in']);
const RICH_REPLACE_ALLOWED_KEYS = new Set(['value', 'type', 'target', 'ref', 'nestingPolicy', 'in']);
const RICH_REPLACE_TYPES = new Set(['html', 'markdown']);

// ---------------------------------------------------------------------------
// Shape discrimination
// ---------------------------------------------------------------------------

/** Returns true when the input uses the structural SDFragment shape. */
export function isStructuralReplaceInput(input: ReplaceInput): input is SDReplaceInput {
  return 'content' in input && input.content !== undefined;
}

export function isRichContentReplaceInput(input: ReplaceInput): input is RichContentReplaceInput {
  return 'value' in input && input.value !== undefined;
}

// ---------------------------------------------------------------------------
// Shared target validation for text path
// ---------------------------------------------------------------------------

function validateTargetLocator(input: Record<string, unknown>, operation: string): void {
  const hasTarget = input.target !== undefined;
  const hasRef = input.ref !== undefined;

  if (hasTarget && hasRef) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operation} input must provide either "target" or "ref", not both.`,
      { fields: ['target', 'ref'] },
    );
  }

  if (!hasTarget && !hasRef) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${operation} requires a target or ref.`, {
      fields: ['target', 'ref'],
    });
  }

  if (hasTarget && !isSelectionTarget(input.target) && !isBodyReplaceTarget(input.target)) {
    throw new DocumentApiValidationError('INVALID_TARGET', 'target must be a SelectionTarget or body StoryLocator.', {
      field: 'target',
      value: input.target,
    });
  }

  if (hasRef && (typeof input.ref !== 'string' || input.ref === '')) {
    throw new DocumentApiValidationError('INVALID_TARGET', 'ref must be a non-empty string.', {
      field: 'ref',
      value: input.ref,
    });
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateReplaceInput(input: unknown): asserts input is ReplaceInput {
  if (!isRecord(input)) {
    throw new DocumentApiValidationError('INVALID_TARGET', 'Replace input must be a non-null object.');
  }

  const hasText = 'text' in input && input.text !== undefined;
  const hasContent = 'content' in input && input.content !== undefined;
  const hasValue = 'value' in input && input.value !== undefined;
  const suppliedShapes = Number(hasText) + Number(hasContent) + Number(hasValue);

  if (suppliedShapes > 1) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      'Replace input must provide exactly one of "text", "content", or "value".',
      { fields: ['text', 'content', 'value'] },
    );
  }

  if (suppliedShapes === 0) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      'Replace input must provide exactly one of "text", "content", or "value".',
      { fields: ['text', 'content', 'value'] },
    );
  }

  validateStoryLocator(input.in, 'in');

  if (hasContent) {
    validateStructuralReplaceInput(input);
  } else if (hasValue) {
    validateRichContentReplaceInput(input);
  } else {
    validateTextReplaceInput(input);
  }
}

function validateRichContentReplaceInput(input: Record<string, unknown>): void {
  assertNoUnknownFields(input, RICH_REPLACE_ALLOWED_KEYS, 'replace', 'doc.replace');

  const { target, ref: refValue, value, type, nestingPolicy } = input;
  const hasTarget = target !== undefined;
  const hasRef = refValue !== undefined;

  if (hasTarget === hasRef) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'Rich replace requires exactly one of "target" or "ref".', {
      fields: ['target', 'ref'],
    });
  }
  if (hasTarget && !isSelectionTarget(target) && !isBlockNodeAddress(target) && !isBodyReplaceTarget(target)) {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      'target must be a SelectionTarget or BlockNodeAddress, or body StoryLocator.',
      {
        field: 'target',
        value: target,
      },
    );
  }
  if (hasRef && (typeof refValue !== 'string' || refValue === '')) {
    throw new DocumentApiValidationError('INVALID_TARGET', 'ref must be a non-empty string.', {
      field: 'ref',
      value: refValue,
    });
  }
  if (typeof value !== 'string') {
    throw new DocumentApiValidationError('INVALID_INPUT', `value must be a string, got ${typeof value}.`, {
      field: 'value',
      value,
    });
  }
  if (typeof type !== 'string' || !RICH_REPLACE_TYPES.has(type)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `type must be one of: html, markdown. Got "${String(type)}".`,
      { field: 'type', value: type },
    );
  }

  validateNestingPolicyValue(nestingPolicy);
  validateBodyReplaceShape(input);
}

/** Validates the text replacement path (SelectionTarget / ref + text). */
function validateTextReplaceInput(input: Record<string, unknown>): void {
  if ('nestingPolicy' in input && input.nestingPolicy !== undefined) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      '"nestingPolicy" is only valid with structural content input, not with "text".',
      { field: 'nestingPolicy' },
    );
  }

  assertNoUnknownFields(input, TEXT_REPLACE_ALLOWED_KEYS, 'replace', 'doc.replace');
  validateTargetLocator(input, 'replace');
  validateBodyReplaceShape(input);

  if (typeof input.text !== 'string') {
    throw new DocumentApiValidationError('INVALID_TARGET', `text must be a string, got ${typeof input.text}.`, {
      field: 'text',
      value: input.text,
    });
  }
}

/** Validates structural SDFragment replace input. */
function validateStructuralReplaceInput(input: Record<string, unknown>): void {
  assertNoUnknownFields(input, STRUCTURAL_REPLACE_ALLOWED_KEYS, 'replace', 'doc.replace');

  const { target, ref: refValue, content, nestingPolicy } = input;
  const hasTarget = target !== undefined;
  const hasRef = refValue !== undefined;

  if (hasTarget && hasRef) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      'Structural replace must provide either "target" or "ref", not both.',
      { fields: ['target', 'ref'] },
    );
  }

  if (!hasTarget && !hasRef) {
    throw new DocumentApiValidationError('INVALID_TARGET', 'Structural replace requires a target or ref.', {
      fields: ['target', 'ref'],
    });
  }

  if (hasTarget && !isBlockNodeAddress(target) && !isSelectionTarget(target) && !isBodyReplaceTarget(target)) {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      'target must be a BlockNodeAddress, SelectionTarget, or body StoryLocator.',
      {
        field: 'target',
        value: target,
      },
    );
  }

  if (hasRef && typeof refValue !== 'string') {
    throw new DocumentApiValidationError('INVALID_TARGET', 'ref must be a string.', {
      field: 'ref',
      value: refValue,
    });
  }

  validateNestingPolicyValue(nestingPolicy);
  validateBodyReplaceShape(input);
  validateDocumentFragment(content as SDFragment);
}

function isBodyReplaceTarget(value: unknown): value is BodyStoryLocator {
  return (
    isRecord(value) &&
    value.kind === 'story' &&
    value.storyType === 'body' &&
    Object.keys(value).every((key) => key === 'kind' || key === 'storyType')
  );
}

function validateBodyReplaceShape(input: Record<string, unknown>): void {
  if (!isBodyReplaceTarget(input.target)) return;
  const conflicts = ['ref', 'in', 'nestingPolicy'].filter((field) => input[field] !== undefined);
  if (conflicts.length > 0) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      'Whole-body replace does not accept "ref", "in", or "nestingPolicy".',
      { fields: ['target', ...conflicts] },
    );
  }
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export function executeReplace(
  selectionAdapter: SelectionMutationAdapter,
  writeAdapter: WriteAdapter,
  input: ReplaceInput,
  options?: RichContentMutationOptions,
): SDMutationReceipt {
  validateReplaceInput(input);

  // Structural content path: returns SDMutationReceipt directly
  if (isStructuralReplaceInput(input)) {
    return writeAdapter.replaceStructured(input, normalizeMutationOptions(options));
  }
  if (isRichContentReplaceInput(input)) {
    return writeAdapter.replaceStructured(input, normalizeMutationOptions(options, 'replace'));
  }

  // Text replacement path: route through SelectionMutationAdapter
  const textInput = input;
  if (isBodyReplaceTarget(textInput.target)) {
    return writeAdapter.replaceStructured(textInput, normalizeMutationOptions(options));
  }
  const request = textInput.target
    ? { kind: 'replace' as const, target: textInput.target, text: textInput.text, in: textInput.in }
    : { kind: 'replace' as const, ref: textInput.ref!, text: textInput.text, in: textInput.in };
  const textReceipt = selectionAdapter.execute(request, normalizeMutationOptions(options));
  return textReceiptToSDReceipt(textReceipt);
}
