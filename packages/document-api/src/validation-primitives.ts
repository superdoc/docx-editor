/**
 * Low-level type-guard primitives shared across operation validators.
 *
 * This module contains ONLY primitive type checks and generic assertions.
 * Operation-specific truth tables, mode-exclusivity logic, and allowlists
 * stay local to each operation file.
 *
 * Internal: not exported from the package root.
 */

import type { BlockNodeAddress, TextAddress, TextTarget } from './types/index.js';
import { BLOCK_NODE_TYPES } from './types/base.js';
import { isStoryLocator } from './types/story.types.js';
import { TABLE_NESTING_POLICY_VALUES } from './types/placement.js';
import { DocumentApiValidationError } from './errors.js';

/**
 * Throws INVALID_TARGET if target is null or undefined.
 * Shared preamble for optional adapter namespace validators.
 */
export function assertTargetPresent(target: unknown, operationName: string): void {
  if (target === undefined || target === null) {
    throw new DocumentApiValidationError('INVALID_TARGET', `${operationName} requires a target.`);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

export function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

export function isTextAddress(value: unknown): value is TextAddress {
  if (!isRecord(value)) return false;
  if (value.kind !== 'text') return false;
  if (typeof value.blockId !== 'string') return false;

  const range = value.range;
  if (!isRecord(range)) return false;
  if (!isInteger(range.start) || !isInteger(range.end)) return false;
  return range.start <= range.end;
}

/**
 * Type guard for TextTarget: multi-segment text target used by read
 * operations and (since round 2 of the drop-in assessment) by
 * `comments.create` for selections that span multiple blocks.
 */
export function isTextTarget(value: unknown): value is TextTarget {
  if (!isRecord(value)) return false;
  if (value.kind !== 'text') return false;
  const segments = value.segments;
  if (
    value.coordinateSpace !== undefined &&
    value.coordinateSpace !== 'visible' &&
    value.coordinateSpace !== 'tracked'
  ) {
    return false;
  }
  if (!Array.isArray(segments) || segments.length === 0) return false;
  for (const seg of segments) {
    if (!isRecord(seg)) return false;
    if (typeof seg.blockId !== 'string') return false;
    const range = seg.range;
    if (!isRecord(range)) return false;
    if (!isInteger(range.start) || !isInteger(range.end)) return false;
    if (range.start > range.end) return false;
  }
  return true;
}

const BLOCK_NODE_TYPES_SET: ReadonlySet<string> = new Set(BLOCK_NODE_TYPES);

/** Type guard for BlockNodeAddress. Checks shape and nodeType membership. */
export function isBlockNodeAddress(value: unknown): value is BlockNodeAddress {
  if (!isRecord(value)) return false;
  if (value.kind !== 'block') return false;
  if (typeof value.nodeType !== 'string' || !BLOCK_NODE_TYPES_SET.has(value.nodeType)) return false;
  if (typeof value.nodeId !== 'string') return false;
  if (value.story !== undefined && !isStoryLocator(value.story)) return false;
  return true;
}

/**
 * Throws INVALID_INPUT if any key on the input object is not in the allowlist.
 * Unknown fields are a payload shape issue, not a locator problem.
 */
export function assertNoUnknownFields(
  input: Record<string, unknown>,
  allowlist: ReadonlySet<string>,
  operationName: string,
  misplacedOptionExamples?: ReadonlyMap<string, string> | string,
): void {
  for (const key of Object.keys(input)) {
    if (!allowlist.has(key)) {
      const optionExample =
        typeof misplacedOptionExamples === 'string'
          ? standardMutationOptionExample(misplacedOptionExamples, key)
          : misplacedOptionExamples?.get(key);
      const guidance = optionExample
        ? ` Pass "${key}" in the second options argument, for example: ${optionExample}.`
        : '';
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        `Unknown field "${key}" on ${operationName} input. Allowed fields: ${[...allowlist].join(', ')}.${guidance}`,
        { field: key },
      );
    }
  }
}

const MUTATION_OPTION_VALUES = new Map([
  ['changeMode', '"tracked"'],
  ['dryRun', 'true'],
]);

function standardMutationOptionExample(methodName: string, field: string): string | undefined {
  const value = MUTATION_OPTION_VALUES.get(field);
  if (!value) return undefined;
  return `${methodName}(input, { ${field}: ${value} })`;
}

const NESTING_POLICY_ALLOWED_KEYS: ReadonlySet<string> = new Set(['tables']);

/**
 * Validates a nestingPolicy value: must be an object with only known keys,
 * and the `tables` field (if present) must be a valid TableNestingPolicy value.
 *
 * Used by both insert and replace structural validators.
 */
export function validateNestingPolicyValue(value: unknown): void {
  if (value === undefined) return;

  if (!isRecord(value)) {
    throw new DocumentApiValidationError('INVALID_INPUT', `nestingPolicy must be an object, got ${typeof value}.`, {
      field: 'nestingPolicy',
      value,
    });
  }

  for (const key of Object.keys(value)) {
    if (!NESTING_POLICY_ALLOWED_KEYS.has(key)) {
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        `Unknown field "${key}" on nestingPolicy. Allowed fields: ${[...NESTING_POLICY_ALLOWED_KEYS].join(', ')}.`,
        { field: `nestingPolicy.${key}` },
      );
    }
  }

  if (
    value.tables !== undefined &&
    (typeof value.tables !== 'string' || !TABLE_NESTING_POLICY_VALUES.has(value.tables))
  ) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `nestingPolicy.tables must be one of: forbid, allow. Got "${String(value.tables)}".`,
      { field: 'nestingPolicy.tables', value: value.tables },
    );
  }
}
