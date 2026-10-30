import type { RichContentInsertInput } from '../insert/insert.js';
import type { RichContentReplaceInput, ReplaceMutationOptions } from '../replace/replace.js';
import type { ChangeMode, TrackedAttribution } from '../write/write.js';
import { normalizeRichMutationOptions } from '../write/write.js';
import type {
  ProjectHtmlInput,
  ProjectMarkdownInput,
  SDContentProjectionResult,
  SDProjectionReviewMode,
  SDResolvedProjectionScope,
} from '../types/content-projection.js';
import type { SDFragment } from '../types/fragment.js';
import type {
  SDError,
  SDHtmlMarkdownOutcome,
  SDMutationConversionReport,
  SDMutationReceipt,
} from '../types/sd-contract.js';
import type { StoryLocator } from '../types/story.types.js';
import { DocumentApiValidationError } from '../errors.js';
import { validateInsertInput } from '../insert/insert.js';
import { validateReplaceInput } from '../replace/replace.js';
import { validateOptionalBoolean, validateProjectionReadInput } from '../content-projection/validation.js';
import { assertNoUnknownFields } from '../validation-primitives.js';
import { isRecord } from '../object-guards.js';

export interface SDHtmlMarkdownCheckGuard {
  version: 'sd-html-markdown-check/1';
  operation: 'insert' | 'replace';
  evaluatedRevision: string;
  requestSha256: string;
  analysisSha256: string;
}

export type SDHtmlMarkdownSupportCheckInput =
  | { operation: 'insert'; input: RichContentInsertInput; options?: { changeMode?: ChangeMode } & TrackedAttribution }
  | {
      operation: 'replace';
      input: RichContentReplaceInput;
      options?: Pick<ReplaceMutationOptions, 'changeMode' | 'replaceMode' | 'expectedSnapshotId'> & TrackedAttribution;
    }
  | { operation: 'projectHtml'; input?: ProjectHtmlInput }
  | { operation: 'projectMarkdown'; input?: ProjectMarkdownInput };

interface SDHtmlMarkdownCheckCommon {
  operation: SDHtmlMarkdownSupportCheckInput['operation'];
  format: 'html' | 'markdown';
  supported: boolean;
  outcome: SDHtmlMarkdownOutcome;
  evaluatedRevision: string;
  failure?: SDError;
}

export interface SDHtmlMarkdownWriteCheckResult extends SDHtmlMarkdownCheckCommon {
  operation: 'insert' | 'replace';
  wouldChange: boolean;
  conversion: SDMutationConversionReport;
  plan?: {
    fragment: SDFragment;
    resolution: NonNullable<SDMutationReceipt['resolution']>;
    changeMode: ChangeMode;
    atomic: true;
  };
  guard?: SDHtmlMarkdownCheckGuard;
}

export interface SDHtmlMarkdownProjectionCheckResult extends SDHtmlMarkdownCheckCommon {
  operation: 'projectHtml' | 'projectMarkdown';
  plan?: {
    reviewMode: SDProjectionReviewMode;
    story: StoryLocator;
    scope: SDResolvedProjectionScope;
    includeSourceMap: boolean;
  };
  projection?: SDContentProjectionResult<'html' | 'markdown'>;
}

export type SDHtmlMarkdownSupportCheckResult = SDHtmlMarkdownWriteCheckResult | SDHtmlMarkdownProjectionCheckResult;

const CHECK_OPERATIONS = new Set(['insert', 'replace', 'projectHtml', 'projectMarkdown']);
const WRITE_REQUEST_FIELDS = new Set(['operation', 'input', 'options']);
const PROJECTION_REQUEST_FIELDS = new Set(['operation', 'input']);
const WRITE_OPTION_FIELDS = new Set(['changeMode', 'author', 'date']);
const PROJECTION_FIELDS = new Set(['in', 'reviewMode', 'scope', 'includeSourceMap']);

export function validateSDHtmlMarkdownSupportCheckInput(
  input: unknown,
): asserts input is SDHtmlMarkdownSupportCheckInput {
  if (!isRecord(input)) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'capabilities.check input must be an object.');
  }
  if (typeof input.operation !== 'string' || !CHECK_OPERATIONS.has(input.operation)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      'capabilities.check operation must be insert, replace, projectHtml, or projectMarkdown.',
      { field: 'operation', value: input.operation },
    );
  }
  if (input.operation === 'insert' || input.operation === 'replace') {
    assertNoUnknownFields(input, WRITE_REQUEST_FIELDS, 'capabilities.check');
    if (input.operation === 'insert') validateInsertInput(input.input);
    else validateReplaceInput(input.input, input.options as ReplaceMutationOptions | undefined);
    const richInput: unknown = input.input;
    const rich =
      isRecord(richInput) &&
      typeof richInput.value === 'string' &&
      (richInput.type === 'html' || richInput.type === 'markdown');
    if (!rich) {
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        `capabilities.check ${input.operation} accepts only HTML or Markdown rich input.`,
      );
    }
    if (input.options !== undefined) {
      if (!isRecord(input.options)) {
        throw new DocumentApiValidationError('INVALID_INPUT', 'capabilities.check options must be an object.');
      }
      assertNoUnknownFields(
        input.options,
        input.operation === 'replace'
          ? new Set(['changeMode', 'replaceMode', 'expectedSnapshotId', 'author', 'date'])
          : WRITE_OPTION_FIELDS,
        'capabilities.check options',
      );
      normalizeRichMutationOptions(input.options);
    }
    return;
  }
  assertNoUnknownFields(input, PROJECTION_REQUEST_FIELDS, 'capabilities.check');
  if (input.input === null) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `capabilities.check ${input.operation} input must be an object when provided.`,
    );
  }
  const projectionInput = (input.input === undefined ? {} : input.input) as ProjectHtmlInput | ProjectMarkdownInput;
  validateProjectionReadInput(projectionInput, input.operation, PROJECTION_FIELDS);
  validateOptionalBoolean(projectionInput.includeSourceMap, 'includeSourceMap', input.operation);
}
