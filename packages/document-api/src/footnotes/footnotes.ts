import type { MutationOptions } from '../write/write.js';
import { normalizeMutationOptions } from '../write/write.js';
import { DocumentApiValidationError } from '../errors.js';
import { assertNoUnknownFields, assertTargetPresent } from '../validation-primitives.js';
import { isRecord } from '../object-guards.js';
import { validateDocumentFragment } from '../validation/fragment-validator.js';
import type {
  FootnoteAddress,
  FootnoteGetInput,
  FootnoteInfo,
  FootnoteInsertInput,
  FootnoteUpdateInput,
  FootnoteRemoveInput,
  FootnoteConfigureInput,
  FootnoteMutationResult,
  FootnoteConfigResult,
  FootnoteListInput,
  FootnotesListResult,
} from './footnotes.types.js';

// ---------------------------------------------------------------------------
// Adapter / API interfaces
// ---------------------------------------------------------------------------

export interface FootnotesApi {
  list(query?: FootnoteListInput): FootnotesListResult;
  get(input: FootnoteGetInput): FootnoteInfo;
  insert(input: FootnoteInsertInput, options?: MutationOptions): FootnoteMutationResult;
  update(input: FootnoteUpdateInput, options?: MutationOptions): FootnoteMutationResult;
  remove(input: FootnoteRemoveInput, options?: MutationOptions): FootnoteMutationResult;
  configure(input: FootnoteConfigureInput, options?: MutationOptions): FootnoteConfigResult;
}

export type FootnotesAdapter = FootnotesApi;

// ---------------------------------------------------------------------------
// Target validation
// ---------------------------------------------------------------------------

function validateFootnoteTarget(target: unknown, operationName: string): asserts target is FootnoteAddress {
  assertTargetPresent(target, operationName);

  const t = target as Record<string, unknown>;
  if (
    t.kind !== 'entity' ||
    t.entityType !== 'footnote' ||
    typeof t.noteId !== 'string' ||
    (t.noteType !== undefined && t.noteType !== 'footnote' && t.noteType !== 'endnote')
  ) {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `${operationName} target must be a FootnoteAddress with kind 'entity', entityType 'footnote', a string noteId, and optional noteType 'footnote' or 'endnote'.`,
      { target },
    );
  }
}

function isStructuredBody(body: unknown): boolean {
  if (Array.isArray(body)) {
    return body.length > 0 && body.every((node) => node != null && typeof node === 'object');
  }
  return body != null && typeof body === 'object';
}

/**
 * Footnote/endnote stories can only represent paragraph and heading content
 * nodes. A structurally well-formed fragment node whose kind falls outside that
 * set (for example a `table`) is not malformed input — it is content that
 * cannot be represented as note OOXML. That case must surface the canonical
 * `INVALID_FRAGMENT` failure (mirroring the note-body encoder) rather than the
 * generic `INVALID_INPUT` used for structurally malformed input.
 */
const NOTE_SUPPORTED_CONTENT_NODE_KINDS: ReadonlySet<string> = new Set(['paragraph', 'heading']);

function assertNoteRepresentableContentKinds(operationName: string, fieldName: string, body: unknown): void {
  const nodes = Array.isArray(body) ? body : [body];
  for (const node of nodes) {
    if (node == null || typeof node !== 'object') continue;
    const kind = (node as Record<string, unknown>).kind;
    if (typeof kind === 'string' && kind.length > 0 && !NOTE_SUPPORTED_CONTENT_NODE_KINDS.has(kind)) {
      throw new DocumentApiValidationError(
        'INVALID_FRAGMENT',
        `${operationName} ${fieldName}: unsupported content node kind "${kind}" (only paragraph/heading are supported).`,
        { field: fieldName, kind },
      );
    }
  }
}

function validateStructuredBody(operationName: string, fieldName: string, body: unknown): void {
  if (!isStructuredBody(body)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operationName} ${fieldName} must be a content node or array of content nodes.`,
    );
  }

  assertNoteRepresentableContentKinds(operationName, fieldName, body);

  try {
    validateDocumentFragment(body);
  } catch (error) {
    if (!(error instanceof DocumentApiValidationError)) {
      throw error;
    }
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operationName} ${fieldName} must be a valid structured note fragment: ${error.message}`,
      {
        field: fieldName,
        causeCode: error.code,
        causeDetails: error.details,
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Execute wrappers
// ---------------------------------------------------------------------------

export function executeFootnotesList(adapter: FootnotesAdapter, query?: FootnoteListInput): FootnotesListResult {
  return adapter.list(query);
}

export function executeFootnotesGet(adapter: FootnotesAdapter, input: FootnoteGetInput): FootnoteInfo {
  validateFootnoteTarget(input.target, 'footnotes.get');
  return adapter.get(input);
}

export function executeFootnotesInsert(
  adapter: FootnotesAdapter,
  input: FootnoteInsertInput,
  options?: MutationOptions,
): FootnoteMutationResult {
  if (!isRecord(input)) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'footnotes.insert requires an input object.');
  }
  assertNoUnknownFields(input, new Set(['at', 'type', 'content', 'body']), 'footnotes.insert', 'doc.footnotes.insert');
  if (!input.type || (input.type !== 'footnote' && input.type !== 'endnote')) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      "footnotes.insert requires a type of 'footnote' or 'endnote'.",
    );
  }
  const hasContent = (input as { content?: unknown }).content !== undefined;
  const hasBody = (input as { body?: unknown }).body !== undefined;
  if (hasContent && hasBody) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      'footnotes.insert accepts either a content string or a structured body, not both.',
    );
  }
  if (!hasContent && !hasBody) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      'footnotes.insert requires a content string or a structured body.',
    );
  }
  if (hasContent && typeof (input as { content?: unknown }).content !== 'string') {
    throw new DocumentApiValidationError('INVALID_INPUT', 'footnotes.insert requires a content string.');
  }
  if (hasBody) {
    validateStructuredBody('footnotes.insert', 'body', (input as { body?: unknown }).body);
  }
  return adapter.insert(input, normalizeMutationOptions(options));
}

export function executeFootnotesUpdate(
  adapter: FootnotesAdapter,
  input: FootnoteUpdateInput,
  options?: MutationOptions,
): FootnoteMutationResult {
  validateFootnoteTarget(input.target, 'footnotes.update');
  const patch = input.patch ?? {};
  const hasContent = patch.content !== undefined;
  const hasBody = patch.body !== undefined;
  if (hasContent && hasBody) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      'footnotes.update patch accepts either content or body, not both.',
    );
  }
  if (hasContent && typeof patch.content !== 'string') {
    throw new DocumentApiValidationError('INVALID_INPUT', 'footnotes.update patch.content must be a string.');
  }
  if (hasBody) {
    validateStructuredBody('footnotes.update', 'patch.body', patch.body);
  }
  return adapter.update(input, normalizeMutationOptions(options));
}

export function executeFootnotesRemove(
  adapter: FootnotesAdapter,
  input: FootnoteRemoveInput,
  options?: MutationOptions,
): FootnoteMutationResult {
  validateFootnoteTarget(input.target, 'footnotes.remove');
  return adapter.remove(input, normalizeMutationOptions(options));
}

export function executeFootnotesConfigure(
  adapter: FootnotesAdapter,
  input: FootnoteConfigureInput,
  options?: MutationOptions,
): FootnoteConfigResult {
  if (!input.type || (input.type !== 'footnote' && input.type !== 'endnote')) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      "footnotes.configure requires a type of 'footnote' or 'endnote'.",
    );
  }
  return adapter.configure(input, normalizeMutationOptions(options));
}
