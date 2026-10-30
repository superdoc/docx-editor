/**
 * Replace operation: replaces content at a contiguous document selection.
 *
 * Mutually exclusive input shapes:
 * - Text replacement (`text` field): routes through SelectionMutationAdapter.
 * - Rich HTML/Markdown replacement (`value` field): routes through WriteAdapter.replaceStructured.
 * - Structural replacement (`content` field): routes through WriteAdapter.replaceStructured.
 * - Native OOXML (`value`/`capture`) and retained restoration (`snapshotId`): share the structured writer.
 *
 * Text replacement accepts `SelectionTarget` or `ref`. Rich and structural
 * replacements also accept `BlockNodeAddress`.
 */

import { isOoxmlContentSource, validateOoxmlContentSource } from '../selection/selection.js';
import type { OoxmlContentSource } from '../selection/selection.types.js';
import type { RichContentMutationOptions, TextMutationOptions } from '../write/write.js';
import type { SelectionTarget } from '../types/address.js';
import type { SDMutationReceipt } from '../types/sd-contract.js';
import type { SDReplaceInput } from '../types/structural-input.js';
import type { SDFragment } from '../types/fragment.js';
import type { BodyStoryLocator, StoryLocator } from '../types/story.types.js';
import type { BlockNodeAddress } from '../types/base.js';
import type { NestingPolicy } from '../types/placement.js';
import type { SelectionMutationAdapter } from '../selection-mutation.js';
import type { WriteAdapter } from '../write/write.js';
import {
  normalizeMutationOptions,
  normalizeRichMutationOptions,
  normalizeTextMutationOptions,
} from '../write/write.js';
import { DocumentApiValidationError } from '../errors.js';
import { isBlockNodeAddress, assertNoUnknownFields, validateNestingPolicyValue } from '../validation-primitives.js';
import { isRecord } from '../object-guards.js';
import { isSelectionTarget } from '../validation/selection-target-validator.js';
import { validateDocumentFragment } from '../validation/fragment-validator.js';
import { validateStoryLocator } from '../validation/story-validator.js';
import { textReceiptToSDReceipt } from '../receipt-bridge.js';

// Text replacement input (new shape)

export const TEXT_REPLACEMENT_GRANULARITIES = ['word', 'phrase', 'range'] as const;

export type TextReplacementGranularity = (typeof TEXT_REPLACEMENT_GRANULARITIES)[number];

export function isTextReplacementGranularity(value: unknown): value is TextReplacementGranularity {
  return (TEXT_REPLACEMENT_GRANULARITIES as readonly unknown[]).includes(value);
}

export function isSingleParagraphVisibleTextSelection(target: unknown): target is SelectionTarget {
  return (
    isSelectionTarget(target) &&
    target.start.kind === 'text' &&
    target.end.kind === 'text' &&
    target.start.blockId === target.end.blockId &&
    target.coordinateSpace !== 'tracked'
  );
}

/** Text replacement input: uses SelectionTarget / ref, or the complete main body. */
export type TextReplaceInput =
  | {
      target: SelectionTarget;
      ref?: never;
      text: string;
      /** Require this exact selected text before replacing a single-paragraph text selection. */
      expectedText?: string;
      replacementGranularity?: TextReplacementGranularity;
      /** Target a specific document story (body, header, footer, footnote, endnote). */
      in?: StoryLocator;
    }
  | {
      ref: string;
      target?: never;
      text: string;
      expectedText?: never;
      replacementGranularity?: never;
      in?: StoryLocator;
    }
  | {
      target: BodyStoryLocator;
      text: string;
      expectedText?: never;
      replacementGranularity?: never;
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
 * Discrimination: `text`, typed `value`, `content`, portable `capture`, or retained `snapshotId`.
 */
export type NativeOoxmlReplaceInput = OoxmlContentSource & {
  target: SelectionTarget | BlockNodeAddress;
  in?: StoryLocator;
  nestingPolicy?: NestingPolicy;
};
export type SnapshotReplaceInput = { target: BlockNodeAddress; snapshotId: string; in?: never };
export type ParagraphTextReplaceInput = { target: BlockNodeAddress; text: string; in?: never };
export interface ReplaceMutationOptions extends RichContentMutationOptions {
  /**
   * Replace one paragraph's contents, retaining its identity and exact paragraph properties.
   * Plain text newlines (LF, CRLF, or CR) become inline line breaks; tabs become inline tabs.
   */
  replaceMode?: 'contents';
  /** Compare the addressed paragraph with an unchanged retained snapshot before committing. */
  expectedSnapshotId?: string;
}
type ReplaceExecutionOptions =
  | ReplaceMutationOptions
  | (TextMutationOptions & { replaceMode?: never; expectedSnapshotId?: never });
export type ReplaceInput =
  | TextReplaceInput
  | RichContentReplaceInput
  | SDReplaceInput
  | NativeOoxmlReplaceInput
  | SnapshotReplaceInput
  | ParagraphTextReplaceInput;

// ---------------------------------------------------------------------------
// Allowlists
// ---------------------------------------------------------------------------

const TEXT_REPLACE_ALLOWED_KEYS = new Set(['text', 'target', 'ref', 'in', 'expectedText', 'replacementGranularity']);
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

function validateTargetLocator(input: Record<string, unknown>, operation: string, contents = false): void {
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

  if (
    hasTarget &&
    !isSelectionTarget(input.target) &&
    !isBodyReplaceTarget(input.target) &&
    !(contents && isBlockNodeAddress(input.target))
  ) {
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

export function validateReplaceInput(input: unknown, options?: ReplaceExecutionOptions): asserts input is ReplaceInput {
  if (!isRecord(input)) {
    throw new DocumentApiValidationError('INVALID_TARGET', 'Replace input must be a non-null object.');
  }

  if (options?.replaceMode !== undefined && options.replaceMode !== 'contents')
    throw new DocumentApiValidationError('INVALID_INPUT', 'replaceMode must be contents when provided.');
  if (
    options?.expectedSnapshotId !== undefined &&
    (options.replaceMode !== 'contents' ||
      typeof options.expectedSnapshotId !== 'string' ||
      !options.expectedSnapshotId)
  )
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      'expectedSnapshotId requires contents mode and a nonempty handle.',
    );
  if (
    options?.replaceMode === 'contents' &&
    (!isBlockNodeAddress(input.target) ||
      !['paragraph', 'heading', 'listItem'].includes(input.target.nodeType) ||
      input.ref !== undefined ||
      input.in !== undefined)
  )
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      'Contents replacement requires an explicit paragraph, heading, or listItem block.',
    );
  if (input.snapshotId !== undefined) {
    assertNoUnknownFields(input, new Set(['target', 'snapshotId']), 'replace');
    if (
      options?.replaceMode !== 'contents' ||
      !options.expectedSnapshotId ||
      typeof input.snapshotId !== 'string' ||
      !input.snapshotId
    )
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        'Snapshot restore requires contents mode and expectedSnapshotId.',
      );
    return;
  }
  if (isOoxmlContentSource(input)) {
    assertNoUnknownFields(
      input,
      new Set([
        'target',
        'in',
        'nestingPolicy',
        ...('capture' in input ? ['capture'] : ['value', 'type', 'namespaces', 'dependencies', 'sourcePartUri']),
      ]),
      'replace',
    );
    if (!isBlockNodeAddress(input.target) && !isSelectionTarget(input.target))
      throw new DocumentApiValidationError('INVALID_TARGET', 'Native replace requires a block or selection target.');
    validateStoryLocator(input.in, 'in');
    validateNestingPolicyValue(input.nestingPolicy);
    validateOoxmlContentSource(input);
    return;
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
    validateTextReplaceInput(input, options?.replaceMode === 'contents');
    if (input.replacementGranularity !== undefined && options?.changeMode !== 'tracked') {
      throw new DocumentApiValidationError('INVALID_INPUT', 'replacementGranularity requires changeMode: "tracked".');
    }
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
function validateTextReplaceInput(input: Record<string, unknown>, contents = false): void {
  if ('nestingPolicy' in input && input.nestingPolicy !== undefined) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      '"nestingPolicy" is only valid with structural content input, not with "text".',
      { field: 'nestingPolicy' },
    );
  }

  assertNoUnknownFields(input, TEXT_REPLACE_ALLOWED_KEYS, 'replace', 'doc.replace');
  validateTargetLocator(input, 'replace', contents);
  validateBodyReplaceShape(input);

  if (input.replacementGranularity !== undefined) {
    if (
      !isTextReplacementGranularity(input.replacementGranularity) ||
      !isSingleParagraphVisibleTextSelection(input.target)
    ) {
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        'replacementGranularity must be word, phrase, or range and requires an explicit single-paragraph text selection in visible coordinates.',
        { field: 'replacementGranularity' },
      );
    }
  }

  if (input.expectedText !== undefined) {
    const target = input.target;
    if (
      typeof input.expectedText !== 'string' ||
      !isSelectionTarget(target) ||
      target.start.kind !== 'text' ||
      target.end.kind !== 'text' ||
      target.start.blockId !== target.end.blockId
    ) {
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        'expectedText requires a string and an explicit single-paragraph text selection.',
        { field: 'expectedText' },
      );
    }
  }

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
  options?: ReplaceExecutionOptions,
): SDMutationReceipt {
  validateReplaceInput(input, options);
  if (
    (options?.replaceMode === 'contents' && !writeAdapter.supportsParagraphContents) ||
    (isOoxmlContentSource(input) && !writeAdapter.supportsNativeOoxml)
  )
    throw new DocumentApiValidationError(
      'CAPABILITY_UNAVAILABLE',
      'This runtime does not support the requested contents/native replacement.',
    );
  if (options?.replaceMode === 'contents' || isOoxmlContentSource(input)) {
    return writeAdapter.replaceStructured(input, {
      ...normalizeRichMutationOptions(options, isRichContentReplaceInput(input) ? 'replace' : undefined),
      ...(options?.replaceMode ? { replaceMode: options.replaceMode } : {}),
      ...(options?.expectedSnapshotId ? { expectedSnapshotId: options.expectedSnapshotId } : {}),
    });
  }

  // Structural content path: returns SDMutationReceipt directly
  if (isStructuralReplaceInput(input)) {
    return writeAdapter.replaceStructured(input, normalizeRichMutationOptions(options));
  }
  if (isRichContentReplaceInput(input)) {
    return writeAdapter.replaceStructured(input, normalizeRichMutationOptions(options, 'replace'));
  }

  // Text replacement path: route through SelectionMutationAdapter
  const textInput = input as TextReplaceInput;
  if (isBodyReplaceTarget(textInput.target)) {
    return writeAdapter.replaceStructured(textInput, normalizeMutationOptions(options));
  }
  const request = textInput.target
    ? {
        kind: 'replace' as const,
        target: textInput.target,
        text: textInput.text,
        in: textInput.in,
        ...(textInput.expectedText !== undefined ? { expectedText: textInput.expectedText } : {}),
        ...(textInput.replacementGranularity !== undefined
          ? { replacementGranularity: textInput.replacementGranularity }
          : {}),
      }
    : { kind: 'replace' as const, ref: textInput.ref!, text: textInput.text, in: textInput.in };
  const textReceipt = selectionAdapter.execute(request, normalizeTextMutationOptions(options));
  return textReceiptToSDReceipt(textReceipt);
}
