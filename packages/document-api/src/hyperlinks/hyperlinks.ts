import type { MutationOptions } from '../write/write.js';
import { normalizeMutationOptions } from '../write/write.js';
import { DocumentApiValidationError } from '../errors.js';
import { isTextAddress } from '../validation-primitives.js';
import { isRecord } from '../object-guards.js';
import { validateStoryLocator } from '../validation/story-validator.js';
import type {
  HyperlinkTarget,
  HyperlinksListQuery,
  HyperlinksListResult,
  HyperlinksGetInput,
  HyperlinkInfo,
  HyperlinksWrapInput,
  HyperlinkMutationResult,
  HyperlinksInsertInput,
  HyperlinksPatchInput,
  HyperlinksRemoveInput,
  HyperlinkPatch,
  HyperlinkSpec,
} from './hyperlinks.types.js';

// ---------------------------------------------------------------------------
// Adapter / API interfaces
// ---------------------------------------------------------------------------

export interface HyperlinksApi {
  list(query?: HyperlinksListQuery): HyperlinksListResult;
  get(input: HyperlinksGetInput): HyperlinkInfo;
  wrap(input: HyperlinksWrapInput, options?: MutationOptions): HyperlinkMutationResult;
  insert(input: HyperlinksInsertInput, options?: MutationOptions): HyperlinkMutationResult;
  patch(input: HyperlinksPatchInput, options?: MutationOptions): HyperlinkMutationResult;
  remove(input: HyperlinksRemoveInput, options?: MutationOptions): HyperlinkMutationResult;
}

export type HyperlinksAdapter = HyperlinksApi;

// ---------------------------------------------------------------------------
// Target validation helpers
// ---------------------------------------------------------------------------

function isHyperlinkTarget(value: unknown): value is HyperlinkTarget {
  if (!isRecord(value)) return false;
  if (value.kind !== 'inline' || value.nodeType !== 'hyperlink') return false;
  const anchor = value.anchor;
  if (!isRecord(anchor)) return false;
  const start = anchor.start;
  const end = anchor.end;
  if (!isRecord(start) || !isRecord(end)) return false;
  return (
    typeof start.blockId === 'string' &&
    typeof start.offset === 'number' &&
    typeof end.blockId === 'string' &&
    typeof end.offset === 'number'
  );
}

function validateHyperlinkTarget(target: unknown, operationName: string): asserts target is HyperlinkTarget {
  if (target === undefined || target === null) {
    throw new DocumentApiValidationError('INVALID_TARGET', `${operationName} requires a target.`);
  }
  if (!isHyperlinkTarget(target)) {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `${operationName} target must be a HyperlinkTarget with kind 'inline', nodeType 'hyperlink', and a valid anchor.`,
      { target },
    );
  }
}

// ---------------------------------------------------------------------------
// Destination validation
// ---------------------------------------------------------------------------

function validateDestination(
  destination: unknown,
  operationName: string,
): asserts destination is { href?: string; anchor?: string; docLocation?: string } {
  if (!isRecord(destination)) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${operationName} requires a destination object.`);
  }
  const hasHref = typeof destination.href === 'string' && destination.href.length > 0;
  const hasAnchor = typeof destination.anchor === 'string' && destination.anchor.length > 0;
  if (!hasHref && !hasAnchor) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operationName} destination must have at least one of 'href' or 'anchor'.`,
    );
  }
}

function validateHyperlinkSpec(link: unknown, operationName: string): asserts link is HyperlinkSpec {
  if (!isRecord(link)) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${operationName} requires a link specification object.`);
  }
  validateDestination(link.destination, operationName);
}

// ---------------------------------------------------------------------------
// Patch validation
// ---------------------------------------------------------------------------

const PATCH_FIELDS = new Set(['href', 'anchor', 'docLocation', 'tooltip', 'target', 'rel']);

function validatePatch(patch: unknown, operationName: string): asserts patch is HyperlinkPatch {
  if (!isRecord(patch)) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${operationName} requires a patch object.`);
  }
  // Check for unknown fields
  for (const key of Object.keys(patch)) {
    if (!PATCH_FIELDS.has(key)) {
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        `Unknown field "${key}" on ${operationName} patch. Allowed: ${[...PATCH_FIELDS].join(', ')}.`,
        { field: key },
      );
    }
  }
  // Ensure at least one field is set (not undefined)
  const hasField = Object.keys(patch).some((k) => patch[k] !== undefined);
  if (!hasField) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${operationName} patch must set at least one field.`);
  }
  // Validate field types: each must be string, null, or undefined
  for (const key of PATCH_FIELDS) {
    const val = patch[key];
    if (val !== undefined && val !== null && typeof val !== 'string') {
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        `${operationName} patch.${key} must be a string, null, or omitted.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Execute wrappers
// ---------------------------------------------------------------------------

export function executeHyperlinksList(adapter: HyperlinksAdapter, query?: HyperlinksListQuery): HyperlinksListResult {
  if (query?.in !== undefined) {
    validateStoryLocator(query.in, 'hyperlinks.list.in');
  }
  const result = { ...adapter.list(query) } as HyperlinksListResult & { stories?: unknown };
  // Adapter-only story catalogs belong to the host surface, outside discovery.
  delete result.stories;
  return result;
}

export function executeHyperlinksGet(adapter: HyperlinksAdapter, input: HyperlinksGetInput): HyperlinkInfo {
  validateHyperlinkTarget(input.target, 'hyperlinks.get');
  return adapter.get(input);
}

export function executeHyperlinksWrap(
  adapter: HyperlinksAdapter,
  input: HyperlinksWrapInput,
  options?: MutationOptions,
): HyperlinkMutationResult {
  if (!isTextAddress(input.target)) {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      "hyperlinks.wrap requires a valid TextAddress target with kind 'text', blockId, and range.",
    );
  }
  if (input.target.range.start === input.target.range.end) {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      'hyperlinks.wrap requires a non-collapsed range (start !== end).',
    );
  }
  validateHyperlinkSpec(input.link, 'hyperlinks.wrap');
  return adapter.wrap(input, normalizeMutationOptions(options));
}

export function executeHyperlinksInsert(
  adapter: HyperlinksAdapter,
  input: HyperlinksInsertInput,
  options?: MutationOptions,
): HyperlinkMutationResult {
  if (typeof input.text !== 'string' || input.text.length === 0) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'hyperlinks.insert requires a non-empty text string.');
  }
  if (input.target !== undefined) {
    if (!isTextAddress(input.target)) {
      throw new DocumentApiValidationError(
        'INVALID_TARGET',
        "hyperlinks.insert target (if provided) must be a valid TextAddress with kind 'text', blockId, and range.",
      );
    }
    if (input.target.range.start !== input.target.range.end) {
      throw new DocumentApiValidationError(
        'INVALID_TARGET',
        'hyperlinks.insert target must be a collapsed range (start === end) indicating the insertion point.',
      );
    }
  }
  validateHyperlinkSpec(input.link, 'hyperlinks.insert');
  return adapter.insert(input, normalizeMutationOptions(options));
}

export function executeHyperlinksPatch(
  adapter: HyperlinksAdapter,
  input: HyperlinksPatchInput,
  options?: MutationOptions,
): HyperlinkMutationResult {
  validateHyperlinkTarget(input.target, 'hyperlinks.patch');
  validatePatch(input.patch, 'hyperlinks.patch');
  return adapter.patch(input, normalizeMutationOptions(options));
}

export function executeHyperlinksRemove(
  adapter: HyperlinksAdapter,
  input: HyperlinksRemoveInput,
  options?: MutationOptions,
): HyperlinkMutationResult {
  validateHyperlinkTarget(input.target, 'hyperlinks.remove');
  if (input.mode !== undefined && input.mode !== 'unwrap' && input.mode !== 'deleteText') {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `hyperlinks.remove mode must be 'unwrap' or 'deleteText', got '${String(input.mode)}'.`,
    );
  }
  return adapter.remove(input, normalizeMutationOptions(options));
}
