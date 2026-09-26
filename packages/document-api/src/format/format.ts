/**
 * Format operations: inline style application on contiguous document selections.
 *
 * All format operations now accept `SelectionTarget` or `ref` instead of `TextAddress`.
 * They route through the `SelectionMutationAdapter` (backed by the plan engine).
 */

import type { MutationOptions } from '../types/mutation-plan.types.js';
import { normalizeMutationOptions } from '../write/write.js';
import type { SelectionTarget, TargetLocator } from '../types/address.js';
import type { TextMutationReceipt } from '../types/receipt.js';
import type { StoryLocator } from '../types/story.types.js';
import type { SelectionMutationAdapter } from '../selection-mutation.js';
import { DocumentApiValidationError } from '../errors.js';
import { isRecord, assertNoUnknownFields } from '../validation-primitives.js';
import { isSelectionTarget } from '../validation/selection-target-validator.js';
import { validateStoryLocator } from '../validation/story-validator.js';
import type { InlineRunPatch, InlineRunPatchKey } from './inline-run-patch.js';
import { INLINE_PROPERTY_BY_KEY, validateInlineRunPatch } from './inline-run-patch.js';

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

/** Input payload for `format.bold`. */
export type FormatBoldInput = FormatInlineAliasInput<'bold'>;

/** Input payload for `format.italic`. */
export type FormatItalicInput = FormatInlineAliasInput<'italic'>;

/** Input payload for `format.underline`. */
export type FormatUnderlineInput = FormatInlineAliasInput<'underline'>;

/** Input payload for `format.strikethrough`. */
export type FormatStrikethroughInput = FormatInlineAliasInput<'strike'>;

/**
 * Keys where `value` may be omitted: booleans (defaults to `true`) and
 * `underline` (defaults to `true` for simple on/off).
 */
type ImplicitTrueKey =
  | {
      [K in InlineRunPatchKey]: InlineRunPatch[K] extends boolean | null | undefined ? K : never;
    }[InlineRunPatchKey]
  | 'underline';

/**
 * Input payload for direct per-property aliases (`format.<inlineKey>`).
 *
 * `value` is optional only for boolean-like keys (including `underline`), where
 * omission defaults to `true` for ergonomic "turn on" calls.
 */
export type FormatInlineAliasInput<K extends InlineRunPatchKey> = K extends ImplicitTrueKey
  ? TargetLocator & { target?: SelectionTarget; ref?: string; in?: StoryLocator; value?: InlineRunPatch[K] }
  : TargetLocator & { target?: SelectionTarget; ref?: string; in?: StoryLocator; value: InlineRunPatch[K] };

/**
 * Input payload for `format.apply`.
 *
 * Accepts either `target` (SelectionTarget) or `ref` (string): exactly one required.
 */
export type StyleApplyInput = TargetLocator & {
  target?: SelectionTarget;
  ref?: string;
  inline: InlineRunPatch;
  /** Target a specific document story (body, header, footer, footnote, endnote). */
  in?: StoryLocator;
};

/**
 * Legacy root-level alias input for `doc.formatRange(...)`.
 *
 * Kept for SDK compatibility while routing through the canonical
 * `format.apply` implementation.
 */
export type FormatRangeInput = TargetLocator & {
  target?: SelectionTarget;
  ref?: string;
  properties: InlineRunPatch;
  /** Target a specific document story (body, header, footer, footnote, endnote). */
  in?: StoryLocator;
  changeMode?: MutationOptions['changeMode'];
  dryRun?: boolean;
  expectedRevision?: string;
};

/**
 * Named alias for MutationOptions on format.apply.
 *
 * Exists as a distinct type so the styles system can add style-specific
 * options (e.g. scope, priority) without changing the public API shape.
 */
export type StyleApplyOptions = MutationOptions;

// ---------------------------------------------------------------------------
// Public API surface
// ---------------------------------------------------------------------------

/** Direct alias methods (`format.<inlineKey>`) that route to `format.apply`. */
export type FormatInlineAliasApi = {
  [K in InlineRunPatchKey]: (input: FormatInlineAliasInput<K>, options?: MutationOptions) => TextMutationReceipt;
};

/** Public helper surface exposed on `DocumentApi.format`. */
export interface FormatApi extends FormatInlineAliasApi {
  strikethrough(input: FormatStrikethroughInput, options?: MutationOptions): TextMutationReceipt;
  apply(input: StyleApplyInput, options?: MutationOptions): TextMutationReceipt;
}

// ---------------------------------------------------------------------------
// Shared target validation
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
    throw new DocumentApiValidationError('INVALID_INPUT', `${operation} input must provide either "target" or "ref".`, {
      fields: ['target', 'ref'],
    });
  }

  if (hasTarget && !isSelectionTarget(input.target)) {
    throw new DocumentApiValidationError('INVALID_TARGET', 'target must be a SelectionTarget object.', {
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
// format.apply: validation and execution
// ---------------------------------------------------------------------------

const STYLE_APPLY_INPUT_ALLOWED_KEYS = new Set(['target', 'ref', 'inline', 'in']);

function validateStyleApplyInput(input: unknown): asserts input is StyleApplyInput {
  if (!isRecord(input)) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'format.apply input must be a non-null object.');
  }

  assertNoUnknownFields(input, STYLE_APPLY_INPUT_ALLOWED_KEYS, 'format.apply', 'doc.format.apply');
  validateStoryLocator(input.in, 'in');
  validateTargetLocator(input, 'format.apply');

  if (input.inline === undefined || input.inline === null) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'format.apply requires an inline object.');
  }

  validateInlineRunPatch(input.inline);
}

/**
 * Executes `format.apply` via the selection mutation adapter (plan engine).
 */
export function executeStyleApply(
  adapter: SelectionMutationAdapter,
  input: StyleApplyInput,
  options?: MutationOptions,
): TextMutationReceipt {
  validateStyleApplyInput(input);
  const request = input.target
    ? { kind: 'format' as const, target: input.target, inline: input.inline, in: input.in }
    : { kind: 'format' as const, ref: input.ref!, inline: input.inline, in: input.in };

  return adapter.execute(request, normalizeMutationOptions(options));
}

// ---------------------------------------------------------------------------
// format.<inlineKey> aliases: normalize to format.apply payloads
// ---------------------------------------------------------------------------

const INLINE_ALIAS_INPUT_ALLOWED_KEYS = new Set(['target', 'ref', 'value', 'in']);

function acceptsImplicitTrue(key: InlineRunPatchKey): boolean {
  return INLINE_PROPERTY_BY_KEY[key].type === 'boolean' || key === 'underline';
}

function normalizeInlineAliasValue<K extends InlineRunPatchKey>(
  key: K,
  value: InlineRunPatch[K] | undefined,
): InlineRunPatch[K] {
  if (value !== undefined) return value;
  if (acceptsImplicitTrue(key)) {
    return true as InlineRunPatch[K];
  }
  throw new DocumentApiValidationError('INVALID_INPUT', `format.${key} requires a value field.`);
}

function validateInlineAliasInput<K extends InlineRunPatchKey>(
  key: K,
  input: unknown,
): asserts input is FormatInlineAliasInput<K> {
  const operation = `format.${key}`;
  const candidate = isRecord(input) ? input : {};
  assertNoUnknownFields(candidate, INLINE_ALIAS_INPUT_ALLOWED_KEYS, operation, `doc.${operation}`);
  validateStoryLocator(candidate.in, 'in');
  validateTargetLocator(candidate, operation);
}

/**
 * Executes a direct alias operation (`format.<inlineKey>`) by translating it
 * into a single-key `format.apply` payload.
 */
export function executeInlineAlias<K extends InlineRunPatchKey>(
  adapter: SelectionMutationAdapter,
  key: K,
  input: FormatInlineAliasInput<K>,
  options?: MutationOptions,
): TextMutationReceipt {
  validateInlineAliasInput(key, input);
  const value = normalizeInlineAliasValue(key, (input as { value?: InlineRunPatch[K] }).value);
  const inline = { [key]: value } as InlineRunPatch;
  validateInlineRunPatch(inline);
  const request = input.target
    ? { kind: 'format' as const, target: input.target, inline, in: input.in }
    : { kind: 'format' as const, ref: input.ref!, inline, in: input.in };

  return adapter.execute(request, normalizeMutationOptions(options));
}
