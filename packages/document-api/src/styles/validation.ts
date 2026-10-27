/**
 * Validation functions for `styles.apply` input.
 *
 * Walks the ValueSchema AST recursively: one function handles all depths.
 * Imports only from registry.ts.
 */

import { DocumentApiValidationError } from '../errors.js';
import { isRecord } from '../object-guards.js';
import type { ValueSchema, StylesChannel, StylesScope } from './registry.js';
import { ALLOWED_KEYS_BY_CHANNEL, EXCLUDED_KEYS_BY_SCOPE, SCOPE_LABEL, getPropertyDefinition } from './registry.js';

/**
 * Error-detail code per scope. `docDefaults` keeps the code it has always
 * emitted; callers switching on it must not have to learn a new one because a
 * second scope appeared.
 */
const EXCLUSION_REASON_CODE: Record<StylesScope, string> = {
  docDefaults: 'excluded_docdefaults_key',
  style: 'excluded_style_key',
};

// ---------------------------------------------------------------------------
// Recursive ValueSchema validation
// ---------------------------------------------------------------------------

/**
 * Validates a value against a ValueSchema AST node.
 *
 * @param path - Dot-delimited path for error messages (e.g. "patch.borders.top.size")
 * @param value - The value to validate
 * @param schema - The schema to validate against
 */
export function validateValue(path: string, value: unknown, schema: ValueSchema): void {
  switch (schema.kind) {
    case 'boolean':
      if (typeof value !== 'boolean') {
        throw new DocumentApiValidationError('INVALID_INPUT', `${path} must be a boolean, got ${typeof value}.`, {
          field: path,
          value,
        });
      }
      return;

    case 'integer': {
      if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
        throw new DocumentApiValidationError(
          'INVALID_INPUT',
          `${path} must be a finite integer, got ${JSON.stringify(value)}.`,
          { field: path, value },
        );
      }
      if (schema.min !== undefined && value < schema.min) {
        throw new DocumentApiValidationError('INVALID_INPUT', `${path} must be >= ${schema.min}, got ${value}.`, {
          field: path,
          value,
        });
      }
      if (schema.max !== undefined && value > schema.max) {
        throw new DocumentApiValidationError('INVALID_INPUT', `${path} must be <= ${schema.max}, got ${value}.`, {
          field: path,
          value,
        });
      }
      return;
    }

    case 'enum':
      if (typeof value !== 'string' || !schema.values.includes(value)) {
        throw new DocumentApiValidationError(
          'INVALID_INPUT',
          `${path} must be one of: ${schema.values.join(', ')}. Got ${JSON.stringify(value)}.`,
          { field: path, value },
        );
      }
      return;

    case 'string':
      if (typeof value !== 'string' || value.length === 0) {
        throw new DocumentApiValidationError(
          'INVALID_INPUT',
          `${path} must be a non-empty string, got ${JSON.stringify(value)}.`,
          { field: path, value },
        );
      }
      return;

    case 'object':
      validateObjectValue(path, value, schema.children);
      return;

    case 'array':
      validateArrayValue(path, value, schema.item);
      return;
  }
}

function validateObjectValue(path: string, value: unknown, children: Record<string, ValueSchema>): void {
  if (!isRecord(value)) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${path} must be a non-null object, got ${typeof value}.`, {
      field: path,
      value,
    });
  }

  const allowedKeys = new Set(Object.keys(children));
  const keys = Object.keys(value);

  if (keys.length === 0) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${path} must include at least one property.`, {
      field: path,
    });
  }

  for (const key of keys) {
    if (!allowedKeys.has(key)) {
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        `Unknown key "${key}" on ${path}. Allowed keys: ${[...allowedKeys].join(', ')}.`,
        { field: path, key },
      );
    }
    validateValue(`${path}.${key}`, value[key], children[key]);
  }
}

function validateArrayValue(path: string, value: unknown, itemSchema: ValueSchema): void {
  if (!Array.isArray(value)) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${path} must be an array, got ${typeof value}.`, {
      field: path,
      value,
    });
  }

  // Empty arrays are legal (e.g. tabStops: [] means "clear all")
  for (let i = 0; i < value.length; i++) {
    validateValue(`${path}[${i}]`, value[i], itemSchema);
  }
}

// ---------------------------------------------------------------------------
// Top-level input / options validation
// ---------------------------------------------------------------------------

export type StylesApplyInputShape =
  | { target: { scope: 'docDefaults'; channel: StylesChannel }; patch: Record<string, unknown> }
  | { target: { scope: 'style'; styleId: string; channel: 'run' }; patch: Record<string, unknown> };

const INPUT_ALLOWED_KEYS = new Set(['target', 'patch']);
const TARGET_ALLOWED_KEYS_BY_SCOPE: Record<StylesScope, ReadonlySet<string>> = {
  docDefaults: new Set(['scope', 'channel']),
  style: new Set(['scope', 'styleId', 'channel']),
};
const OPTIONS_ALLOWED_KEYS = new Set(['dryRun', 'expectedRevision']);
const VALID_CHANNELS = new Set<string>(['run', 'paragraph']);

export function validateStylesApplyInput(input: unknown): asserts input is StylesApplyInputShape {
  if (!isRecord(input)) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'styles.apply input must be a non-null object.');
  }

  assertNoUnknownFields(input, INPUT_ALLOWED_KEYS);

  // --- Target ---
  const { target, patch } = input;

  if (target === undefined || target === null) {
    throw new DocumentApiValidationError('INVALID_TARGET', 'styles.apply requires a target object.');
  }
  if (!isRecord(target)) {
    throw new DocumentApiValidationError('INVALID_TARGET', 'target must be a non-null object.', {
      field: 'target',
      value: target,
    });
  }

  if (target.scope !== 'docDefaults' && target.scope !== 'style') {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `target.scope must be "docDefaults" or "style", got ${JSON.stringify(target.scope)}.`,
      { field: 'target.scope', value: target.scope },
    );
  }
  const scope = target.scope as StylesScope;

  assertNoUnknownFields(target, TARGET_ALLOWED_KEYS_BY_SCOPE[scope], 'target');

  if (!VALID_CHANNELS.has(target.channel as string)) {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `target.channel must be "run" or "paragraph", got ${JSON.stringify(target.channel)}.`,
      { field: 'target.channel', value: target.channel },
    );
  }
  if (scope === 'style') {
    if (typeof target.styleId !== 'string' || target.styleId.length === 0) {
      throw new DocumentApiValidationError(
        'INVALID_TARGET',
        `target.styleId must be a non-empty string, got ${JSON.stringify(target.styleId)}.`,
        { field: 'target.styleId', value: target.styleId },
      );
    }
    if (target.channel !== 'run') {
      throw new DocumentApiValidationError(
        'INVALID_TARGET',
        `target.channel must be "run" for scope "style"; redefining a style's paragraph properties is not supported yet.`,
        { field: 'target.channel', value: target.channel },
      );
    }
  }

  const channel = target.channel as StylesChannel;

  // --- Patch ---
  if (patch === undefined || patch === null) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'styles.apply requires a patch object.');
  }
  if (!isRecord(patch)) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'patch must be a non-null object.', {
      field: 'patch',
      value: patch,
    });
  }

  const patchKeys = Object.keys(patch);
  if (patchKeys.length === 0) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'patch must include at least one property.');
  }

  validatePatchObject(patch, channel, scope, 'patch', { allowNull: scope === 'style' });
}

export function validateStylesApplyOptions(options: unknown): void {
  if (options === undefined || options === null) return;

  if (!isRecord(options)) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'styles.apply options must be a non-null object.');
  }

  for (const key of Object.keys(options)) {
    if (!OPTIONS_ALLOWED_KEYS.has(key)) {
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        `Unknown options key "${key}". Allowed keys: ${[...OPTIONS_ALLOWED_KEYS].join(', ')}.`,
        { field: 'options', key },
      );
    }
  }

  if (options.dryRun !== undefined && typeof options.dryRun !== 'boolean') {
    throw new DocumentApiValidationError('INVALID_INPUT', 'options.dryRun must be a boolean.', {
      field: 'options.dryRun',
      value: options.dryRun,
    });
  }

  if (options.expectedRevision !== undefined && typeof options.expectedRevision !== 'string') {
    throw new DocumentApiValidationError('INVALID_INPUT', 'options.expectedRevision must be a string.', {
      field: 'options.expectedRevision',
      value: options.expectedRevision,
    });
  }
}

// ---------------------------------------------------------------------------
// Patch key classification
// ---------------------------------------------------------------------------

/** Discriminated union returned by `classifyPatchKey`. */
export type PatchKeyClassification =
  | { status: 'valid' }
  | { status: 'excluded'; reason: string }
  | { status: 'cross_channel'; ownerChannel: StylesChannel }
  | { status: 'unknown' };

/**
 * Classifies a patch key relative to a given channel.
 *
 * Returns a discriminated union so callers can switch on `status` instead of
 * nesting conditionals across excluded-key maps, allowed-key sets, and
 * cross-channel lookups.
 */
export function classifyPatchKey(
  key: string,
  channel: StylesChannel,
  scope: StylesScope = 'docDefaults',
): PatchKeyClassification {
  const excluded = EXCLUDED_KEYS_BY_SCOPE[scope];

  // 1. Excluded on the requested channel
  const excludedReason = excluded[channel].get(key);
  if (excludedReason !== undefined) {
    return { status: 'excluded', reason: excludedReason };
  }

  // 2. Valid for the requested channel
  if (ALLOWED_KEYS_BY_CHANNEL[channel].has(key)) {
    return { status: 'valid' };
  }

  // 3. Belongs to the other channel — and is reachable there in this scope.
  //    The scope test is what keeps the ordering honest: `highlight` is a run
  //    property, but in docDefaults it is excluded from the run channel too, so
  //    "you sent a run property to the paragraph channel" would be the wrong
  //    answer. It is excluded outright, and step 4 says so with a reason.
  const otherChannel: StylesChannel = channel === 'run' ? 'paragraph' : 'run';
  if (ALLOWED_KEYS_BY_CHANNEL[otherChannel].has(key) && !excluded[otherChannel].has(key)) {
    return { status: 'cross_channel', ownerChannel: otherChannel };
  }

  // 4. Excluded on the other channel (still an exclusion, not "unknown")
  const otherExcludedReason = excluded[otherChannel].get(key);
  if (otherExcludedReason !== undefined) {
    return { status: 'excluded', reason: otherExcludedReason };
  }

  // 5. Not in any registry
  return { status: 'unknown' };
}

export function validatePatchObject(
  patch: Record<string, unknown>,
  channel: StylesChannel,
  scope: StylesScope,
  field: string,
  options: { allowNull?: boolean } = {},
): void {
  const allowedKeys = [...ALLOWED_KEYS_BY_CHANNEL[channel]].filter(
    (key) => !EXCLUDED_KEYS_BY_SCOPE[scope][channel].has(key),
  );

  for (const key of Object.keys(patch)) {
    const classification = classifyPatchKey(key, channel, scope);

    switch (classification.status) {
      case 'valid':
        break;

      case 'excluded':
        throw new DocumentApiValidationError(
          'INVALID_INPUT',
          `${field} key '${key}' is not valid in ${SCOPE_LABEL[scope]} (${classification.reason}). This is an intentional restriction per MS-OI29500.`,
          { field, key, reason: EXCLUSION_REASON_CODE[scope] },
        );

      case 'cross_channel':
        throw new DocumentApiValidationError(
          'INVALID_INPUT',
          `Unknown ${field} key "${key}" for channel "${channel}". "${key}" is a ${classification.ownerChannel}-channel property. Allowed keys: ${allowedKeys.join(', ')}.`,
          { field, key },
        );

      case 'unknown':
        throw new DocumentApiValidationError(
          'INVALID_INPUT',
          `Unknown ${field} key "${key}" for channel "${channel}". Allowed keys: ${allowedKeys.join(', ')}.`,
          { field, key },
        );
    }

    if (patch[key] === null && options.allowNull) continue;
    const def = getPropertyDefinition(key, channel);
    if (def) validateValue(`${field}.${key}`, patch[key], def.schema);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function assertNoUnknownFields(obj: Record<string, unknown>, allowlist: ReadonlySet<string>, prefix?: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowlist.has(key)) {
      const location = prefix ? `${prefix}.${key}` : key;
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        `Unknown field "${location}" on styles.apply input. Allowed fields: ${[...allowlist].join(', ')}.`,
        { field: location },
      );
    }
  }
}
