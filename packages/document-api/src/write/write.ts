import type { TextMutationReceipt, SDMutationReceipt } from '../types/index.js';
import type { InsertInput } from '../insert/insert.js';
import type { ReplaceInput } from '../replace/replace.js';
import type { StoryLocator } from '../types/story.types.js';
import { DocumentApiValidationError } from '../errors.js';
import type { SDHtmlMarkdownCheckGuard } from '../capabilities/html-markdown-support.js';
import { assertNoUnknownFields, isRecord } from '../validation-primitives.js';

export type ChangeMode = 'direct' | 'tracked';

/** The canonical set of accepted `changeMode` values. */
const CHANGE_MODE_VALUES: ReadonlySet<string> = new Set<ChangeMode>(['direct', 'tracked']);

/**
 * Shared semantic validation for the `changeMode` mutation option.
 *
 * Error-code policy (v2-tracked-change-decision-error-contract plan, WS3):
 *   - A `changeMode` value of the wrong type is a malformed shape and surfaces
 *     `VALIDATION_ERROR`, including dynamic calls without upstream schema validation.
 *   - A `changeMode` *string* outside the accepted enum is a semantic option
 *     error and fails closed with `INVALID_INPUT`, not the generic
 *     `VALIDATION_ERROR`. This keeps semantic option failures distinct from
 *     structural schema failures across every mutation API that accepts
 *     `changeMode`.
 */
export function validateChangeMode(value: unknown): void {
  if (value === undefined) return;
  if (typeof value !== 'string') {
    throw new DocumentApiValidationError('VALIDATION_ERROR', 'changeMode must be a string.', {
      field: 'changeMode',
      value,
    });
  }
  if (CHANGE_MODE_VALUES.has(value)) return;
  throw new DocumentApiValidationError('INVALID_INPUT', `changeMode must be one of: direct, tracked. Got "${value}".`, {
    field: 'changeMode',
    value,
  });
}

/**
 * Subset of MutationOptions that provides only revision guarding.
 *
 * Used by operations that don't participate in the plan engine (comments,
 * clearContent, trackChanges.decide) where changeMode and dryRun are not
 * applicable.
 */
export interface RevisionGuardOptions {
  /** When provided, the engine rejects with REVISION_MISMATCH if the document has advanced past this revision. */
  expectedRevision?: string;
}

export interface MutationOptions extends RevisionGuardOptions {
  /**
   * Controls whether mutation applies directly or as a tracked change.
   * Defaults to `direct`.
   */
  changeMode?: ChangeMode;
  /**
   * When true, adapters validate and resolve the operation but must not mutate state.
   * Defaults to `false`.
   */
  dryRun?: boolean;
}

export interface RichContentMutationOptions extends MutationOptions {
  /** Guard returned by `doc.capabilities.check` for an exact rich write. */
  supportCheck?: SDHtmlMarkdownCheckGuard;
}

/**
 * Text insertion request: target-less insert at document end.
 *
 * Targeted inserts now route through `SelectionMutationAdapter`. This
 * request type only handles the no-target fallback (append to document end).
 */
export type InsertWriteRequest = {
  kind: 'insert';
  text: string;
  /** Target a specific document story (body, header, footer, footnote, endnote). */
  in?: StoryLocator;
};

/**
 * Alias for `InsertWriteRequest`. Retained because adapter utilities and
 * plan wrappers still reference this name.
 */
export type WriteRequest = InsertWriteRequest;

/**
 * Adapter interface for write operations. After the selection-first delete
 * cutover, only `insert` routes through `write()`. Delete and replace use
 * `SelectionMutationAdapter` instead.
 */
export interface WriteAdapter {
  write(request: InsertWriteRequest, options?: MutationOptions): TextMutationReceipt;
  /** Structured insert for SDFragment or markdown/html content. Returns SDMutationReceipt. */
  insertStructured(input: InsertInput, options?: RichContentMutationOptions): SDMutationReceipt;
  /** Structured replace for SDFragment or markdown/html content. Returns SDMutationReceipt. */
  replaceStructured(input: ReplaceInput, options?: RichContentMutationOptions): SDMutationReceipt;
}

export function normalizeMutationOptions(
  options?: MutationOptions | RichContentMutationOptions,
  supportCheckOperation?: 'insert' | 'replace',
): RichContentMutationOptions {
  validateChangeMode(options?.changeMode);
  const supportCheck = (options as RichContentMutationOptions | undefined)?.supportCheck;
  if (supportCheck !== undefined) {
    if (!supportCheckOperation) {
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        'supportCheck is valid only for HTML or Markdown insert and replace requests.',
      );
    }
    validateSupportCheckGuard(supportCheck, supportCheckOperation);
    if (options?.dryRun) {
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        'supportCheck cannot be combined with dryRun; capabilities.check is already non-mutating.',
      );
    }
  }
  // `offsetSpace` is a PRIVATE V2 adapter extension (browser editable
  // selections count an inline object as one caret position). It is not part
  // of the public MutationOptions contract; normalization forwards it opaquely
  // so internal callers that cast it in do not lose it at the dispatch seam.
  const offsetSpace = (options as { offsetSpace?: unknown } | undefined)?.offsetSpace;
  return {
    expectedRevision: options?.expectedRevision,
    changeMode: options?.changeMode ?? 'direct',
    dryRun: options?.dryRun ?? false,
    ...(supportCheck ? { supportCheck } : {}),
    ...(offsetSpace === 'selection' || offsetSpace === 'kernel' ? ({ offsetSpace } as object) : {}),
  };
}

function validateSupportCheckGuard(value: unknown, operation: 'insert' | 'replace'): void {
  if (!isRecord(value)) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'supportCheck must be a support-check guard object.');
  }
  assertNoUnknownFields(
    value,
    new Set(['version', 'operation', 'evaluatedRevision', 'requestSha256', 'analysisSha256']),
    'supportCheck',
  );
  const digest = /^[0-9a-f]{64}$/u;
  if (
    value.version !== 'sd-html-markdown-check/1' ||
    value.operation !== operation ||
    typeof value.evaluatedRevision !== 'string' ||
    typeof value.requestSha256 !== 'string' ||
    !digest.test(value.requestSha256) ||
    typeof value.analysisSha256 !== 'string' ||
    !digest.test(value.analysisSha256)
  ) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `supportCheck must be a valid ${operation} guard returned by capabilities.check.`,
    );
  }
}

export function executeWrite(
  adapter: WriteAdapter,
  request: InsertWriteRequest,
  options?: MutationOptions,
): TextMutationReceipt {
  return adapter.write(request, normalizeMutationOptions(options));
}
