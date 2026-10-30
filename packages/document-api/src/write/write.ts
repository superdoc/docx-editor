import type { TextMutationReceipt, SDMutationReceipt } from '../types/index.js';
import type { InsertInput } from '../insert/insert.js';
import type { ReplaceMutationOptions, ReplaceInput } from '../replace/replace.js';
import type { StoryLocator } from '../types/story.types.js';
import { DocumentApiValidationError } from '../errors.js';
import type { SDHtmlMarkdownCheckGuard } from '../capabilities/html-markdown-support.js';
import { assertNoUnknownFields } from '../validation-primitives.js';
import { isRecord } from '../object-guards.js';

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
  /** Caller correlation for this operation only; echoed only on committed receipts, never persisted. */
  changeTag?: string;
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
  author?: never;
  date?: never;
  /** Guard returned by `doc.capabilities.check` for an exact rich write. */
  supportCheck?: SDHtmlMarkdownCheckGuard;
}

/** Display-only attribution for one tracked plain-text or inline-format mutation. */
export interface TrackedTextMutationOptions extends MutationOptions {
  changeMode: 'tracked';
  author?: { name: string };
  /** ISO 8601 UTC revision timestamp. Omitted values use the transaction time. */
  date?: string;
}

export type TextMutationOptions = MutationOptions | TrackedTextMutationOptions;

export function normalizeTextMutationOptions(
  options?: RichContentMutationOptions | TextMutationOptions,
): RichContentMutationOptions | TrackedTextMutationOptions {
  const { author, date, ...mutationOptions } = (options ?? {}) as MutationOptions & {
    author?: unknown;
    date?: unknown;
  };
  const normalized = normalizeMutationOptions(mutationOptions);
  if (!options || (author === undefined && date === undefined)) return normalized;
  if (
    options.changeMode !== 'tracked' ||
    (author !== undefined &&
      (!isRecord(author) ||
        Object.keys(author).some((key) => key !== 'name') ||
        typeof author.name !== 'string' ||
        author.name.trim().length === 0))
  ) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      'author/date require changeMode: "tracked"; author must contain only a non-empty name.',
    );
  }
  let revisionDate: string | undefined;
  if (date !== undefined) {
    if (
      typeof date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 19) !== date.slice(0, 19)
    ) {
      throw new DocumentApiValidationError('INVALID_INPUT', 'date must be a valid ISO 8601 UTC timestamp.');
    }
    revisionDate = new Date(date).toISOString();
  }
  return {
    ...normalized,
    changeMode: 'tracked',
    ...(isRecord(author) ? { author: { name: author.name as string } } : {}),
    ...(revisionDate ? { date: revisionDate } : {}),
  };
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
  readonly supportsParagraphContents?: boolean;
  readonly supportsNativeOoxml?: boolean;
  write(request: InsertWriteRequest, options?: TextMutationOptions): TextMutationReceipt;
  /** Structured insert for SDFragment or markdown/html content. Returns SDMutationReceipt. */
  insertStructured(input: InsertInput, options?: RichContentMutationOptions): SDMutationReceipt;
  /** Structured replace for SDFragment or markdown/html content. Returns SDMutationReceipt. */
  replaceStructured(input: ReplaceInput, options?: ReplaceMutationOptions): SDMutationReceipt;
}

export function normalizeMutationOptions(
  options?: MutationOptions | RichContentMutationOptions,
  supportCheckOperation?: 'insert' | 'replace',
): RichContentMutationOptions {
  if (
    options &&
    typeof options === 'object' &&
    ((options as { author?: unknown }).author !== undefined || (options as { date?: unknown }).date !== undefined)
  ) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      'author/date are supported only for tracked plain-text doc.insert, doc.delete, doc.replace, inline format and doc.lists calls.',
    );
  }
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
  const tableCellSelection = (
    options as { tableCellSelection?: { anchorBlockId?: unknown; focusBlockId?: unknown } } | undefined
  )?.tableCellSelection;
  return {
    expectedRevision: options?.expectedRevision,
    changeMode: options?.changeMode ?? 'direct',
    dryRun: options?.dryRun ?? false,
    ...(supportCheck ? { supportCheck } : {}),
    ...(offsetSpace === 'selection' || offsetSpace === 'kernel' ? ({ offsetSpace } as object) : {}),
    ...(typeof tableCellSelection?.anchorBlockId === 'string' && typeof tableCellSelection?.focusBlockId === 'string'
      ? {
          tableCellSelection: {
            anchorBlockId: tableCellSelection.anchorBlockId,
            focusBlockId: tableCellSelection.focusBlockId,
          },
        }
      : {}),
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
  options?: TextMutationOptions,
): TextMutationReceipt {
  return adapter.write(request, normalizeTextMutationOptions(options));
}
