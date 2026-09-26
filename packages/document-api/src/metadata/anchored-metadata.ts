import type { MutationOptions } from '../write/write.js';
import { normalizeMutationOptions } from '../write/write.js';
import { DocumentApiValidationError } from '../errors.js';
import { isSelectionTarget } from '../validation/selection-target-validator.js';
import { isTextTarget } from '../validation-primitives.js';
import { validateStoryLocator } from '../validation/story-validator.js';
import type {
  AnchoredMetadataAttachInput,
  AnchoredMetadataAttachResult,
  AnchoredMetadataGetInput,
  AnchoredMetadataInfo,
  AnchoredMetadataListInput,
  AnchoredMetadataListResult,
  AnchoredMetadataMutationResult,
  AnchoredMetadataRemoveInput,
  AnchoredMetadataResolveInfo,
  AnchoredMetadataResolveInput,
  AnchoredMetadataUpdateInput,
} from './anchored-metadata.types.js';

// ---------------------------------------------------------------------------
// Adapter / API interface
// ---------------------------------------------------------------------------

/**
 * Anchored-metadata operations. Composition over `customXml.parts.*` and
 * `contentControls.*`.
 *
 * An entry pairs a hidden inline SDT (the anchor) with a JSON payload in a
 * namespaced Custom XML Data Storage Part. The SDT's `w:tag` carries the
 * stable id linking the two.
 *
 * v1 storage model: one Storage Part per namespace, entries collected
 * inside a `<refs xmlns="namespace">` envelope, payload serialized as
 * escaped JSON inside `<ref id="..." encoding="json">…</ref>`.
 *
 * Consumers who need a different anchor (block-level, image, table cell)
 * or a different storage shape can fall back to `customXml.parts.*` and
 * `contentControls.*` directly.
 */
export interface AnchoredMetadataApi {
  attach(input: AnchoredMetadataAttachInput, options?: MutationOptions): AnchoredMetadataAttachResult;
  list(query?: AnchoredMetadataListInput): AnchoredMetadataListResult;
  get(input: AnchoredMetadataGetInput): AnchoredMetadataInfo | null;
  update(input: AnchoredMetadataUpdateInput, options?: MutationOptions): AnchoredMetadataMutationResult;
  remove(input: AnchoredMetadataRemoveInput, options?: MutationOptions): AnchoredMetadataMutationResult;
  resolve(input: AnchoredMetadataResolveInput): AnchoredMetadataResolveInfo | null;
}

export type AnchoredMetadataAdapter = AnchoredMetadataApi;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateId(id: unknown, operationName: string): asserts id is string {
  if (typeof id !== 'string' || id.length === 0) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${operationName} requires a non-empty 'id' string.`, {
      idType: typeof id,
    });
  }
}

function validateContentControlId(id: unknown, operationName: string): void {
  if (id !== undefined && (typeof id !== 'string' || id.length === 0)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operationName} requires a non-empty 'contentControlId' string when provided.`,
    );
  }
}

function validateNamespace(namespace: unknown, operationName: string): asserts namespace is string {
  if (typeof namespace !== 'string' || namespace.length === 0) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${operationName} requires a non-empty 'namespace' string.`, {
      namespaceType: typeof namespace,
    });
  }
}

/**
 * Payload must be JSON-serializable. We probe via `JSON.stringify`: if it
 * throws (cycle) or returns `undefined` (raw `undefined` or a function /
 * symbol at the top), the payload is rejected. Nested `undefined` /
 * function / symbol values become `null` per `JSON.stringify` rules and
 * are accepted — same semantics customers get when they serialize
 * themselves.
 */
function validatePayload(payload: unknown, operationName: string): void {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(payload);
  } catch (err) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operationName} 'payload' must be JSON-serializable (no cycles, no BigInt).`,
      { error: err instanceof Error ? err.message : String(err) },
    );
  }
  if (serialized === undefined) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operationName} 'payload' must be a JSON-serializable value (was undefined / function / symbol).`,
    );
  }
}

/**
 * Anchor target: either a same-paragraph `SelectionTarget` (both endpoints
 * `kind: 'text'`, same `blockId` — the original v1 shape) or a multi-segment
 * `TextTarget` (one segment per paragraph, in document order) for a range
 * that spans multiple paragraphs. Rejects nodeEdge endpoints. Deeper
 * structural checks (contiguity, table-cell/section boundaries) happen in
 * the adapter, which has access to the document structure.
 */
function validateAnchorTarget(target: unknown, operationName: string): void {
  if (isTextTarget(target)) return;
  if (!isSelectionTarget(target)) {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `${operationName} requires a 'target' SelectionTarget or TextTarget describing the anchor range.`,
      { target },
    );
  }
  if (target.start.kind !== 'text' || target.end.kind !== 'text') {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `${operationName} requires a text-range target. nodeEdge anchors are not supported.`,
      { startKind: target.start.kind, endKind: target.end.kind },
    );
  }
  if (target.start.blockId !== target.end.blockId) {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `${operationName} target spans multiple paragraphs but was given as a SelectionTarget. ` +
        `Pass a TextTarget with one segment per paragraph instead.`,
      { startBlockId: target.start.blockId, endBlockId: target.end.blockId },
    );
  }
}

/**
 * `within` shares the same target shapes as the anchor target: a
 * same-paragraph `SelectionTarget`, or a multi-segment `TextTarget` for a
 * multi-paragraph filter range. nodeEdge endpoints are rejected.
 */
function validateWithin(within: unknown, operationName: string): void {
  if (isTextTarget(within)) return;
  if (!isSelectionTarget(within)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operationName} 'within' must be a SelectionTarget or TextTarget when provided.`,
      { within },
    );
  }
  if (within.start.kind !== 'text' || within.end.kind !== 'text') {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operationName} 'within' must be a text-range target (no nodeEdge endpoints).`,
      { startKind: within.start.kind, endKind: within.end.kind },
    );
  }
  if (within.start.blockId !== within.end.blockId) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operationName} 'within' spans multiple paragraphs but was given as a SelectionTarget. ` +
        `Pass a TextTarget with one segment per paragraph instead.`,
      { startBlockId: within.start.blockId, endBlockId: within.end.blockId },
    );
  }
}

// ---------------------------------------------------------------------------
// Execute wrappers
// ---------------------------------------------------------------------------

export function executeAnchoredMetadataAttach(
  adapter: AnchoredMetadataAdapter,
  input: AnchoredMetadataAttachInput,
  options?: MutationOptions,
): AnchoredMetadataAttachResult {
  validateAnchorTarget(input.target, 'metadata.attach');
  validateNamespace(input.namespace, 'metadata.attach');
  validatePayload(input.payload, 'metadata.attach');
  if (input.id !== undefined) {
    validateId(input.id, 'metadata.attach');
  }
  return adapter.attach(input, normalizeMutationOptions(options));
}

export function executeAnchoredMetadataList(
  adapter: AnchoredMetadataAdapter,
  query?: AnchoredMetadataListInput,
): AnchoredMetadataListResult {
  if (query?.namespace !== undefined && typeof query.namespace !== 'string') {
    throw new DocumentApiValidationError('INVALID_INPUT', `metadata.list 'namespace' must be a string when provided.`);
  }
  if (query?.within !== undefined) {
    validateWithin(query.within, 'metadata.list');
  }
  if (query?.resolvedOnly !== undefined && typeof query.resolvedOnly !== 'boolean') {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `metadata.list 'resolvedOnly' must be a boolean when provided.`,
    );
  }
  return adapter.list(query);
}

export function executeAnchoredMetadataGet(
  adapter: AnchoredMetadataAdapter,
  input: AnchoredMetadataGetInput,
): AnchoredMetadataInfo | null {
  validateId(input.id, 'metadata.get');
  validateContentControlId(input.contentControlId, 'metadata.get');
  if (input.contentControlId !== undefined) {
    if (input.story === undefined) return null;
    validateStoryLocator(input.story, 'metadata.get.story');
    if (input.story.storyType !== 'body') return null;
  }
  return adapter.get(input);
}

export function executeAnchoredMetadataUpdate(
  adapter: AnchoredMetadataAdapter,
  input: AnchoredMetadataUpdateInput,
  options?: MutationOptions,
): AnchoredMetadataMutationResult {
  validateId(input.id, 'metadata.update');
  validatePayload(input.payload, 'metadata.update');
  return adapter.update(input, normalizeMutationOptions(options));
}

export function executeAnchoredMetadataRemove(
  adapter: AnchoredMetadataAdapter,
  input: AnchoredMetadataRemoveInput,
  options?: MutationOptions,
): AnchoredMetadataMutationResult {
  validateId(input.id, 'metadata.remove');
  return adapter.remove(input, normalizeMutationOptions(options));
}

export function executeAnchoredMetadataResolve(
  adapter: AnchoredMetadataAdapter,
  input: AnchoredMetadataResolveInput,
): AnchoredMetadataResolveInfo | null {
  validateId(input.id, 'metadata.resolve');
  validateContentControlId(input.contentControlId, 'metadata.resolve');
  if (input.contentControlId !== undefined) {
    if (input.story === undefined) return null;
    validateStoryLocator(input.story, 'metadata.resolve.story');
    if (input.story.storyType !== 'body') return null;
  }
  return adapter.resolve(input);
}
