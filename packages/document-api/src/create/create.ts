import type { MutationOptions } from '../write/write.js';
import { normalizeMutationOptions } from '../write/write.js';
import type {
  CreateParagraphInput,
  CreateParagraphResult,
  ParagraphCreateLocation,
  CreateHeadingInput,
  CreateHeadingResult,
  HeadingCreateLocation,
} from '../types/create.types.js';
import type { CreateTableInput, CreateTableResult, TableCreateLocation } from '../types/table-operations.types.js';
import type {
  CreateSectionBreakInput,
  CreateSectionBreakResult,
  SectionBreakCreateLocation,
  SectionBreakRepresentation,
  SectionBreakType,
} from '../sections/sections.types.js';
import type { CreateTableOfContentsInput, CreateTableOfContentsResult, TocCreateLocation } from '../toc/toc.types.js';
import type { CreateImageInput, CreateImageResult } from '../images/images.types.js';
import type {
  CreateContentControlInput,
  ContentControlMutationResult,
} from '../content-controls/content-controls.types.js';
import { DocumentApiValidationError } from '../errors.js';
import { isRecord, isInteger } from '../validation-primitives.js';
import { validateStoryLocator } from '../validation/story-validator.js';

const VALID_HEADING_LEVELS: ReadonlySet<number> = new Set([1, 2, 3, 4, 5, 6]);

export interface CreateApi {
  paragraph(input: CreateParagraphInput, options?: MutationOptions): CreateParagraphResult;
  heading(input: CreateHeadingInput, options?: MutationOptions): CreateHeadingResult;
  table(input: CreateTableInput, options?: MutationOptions): CreateTableResult;
  sectionBreak(input: CreateSectionBreakInput, options?: MutationOptions): CreateSectionBreakResult;
  tableOfContents(input: CreateTableOfContentsInput, options?: MutationOptions): CreateTableOfContentsResult;
  image(input: CreateImageInput, options?: MutationOptions): CreateImageResult;
  contentControl(input: CreateContentControlInput, options?: MutationOptions): ContentControlMutationResult;
}

export type CreateAdapter = CreateApi;

/**
 * Validates target-only create locations (paragraph, heading, section break)
 * when `before`/`after` is used.
 * These operations require `at.target` and do not accept `at.nodeId`.
 */
function validateTargetOnlyCreateLocation(
  at: ParagraphCreateLocation | HeadingCreateLocation | SectionBreakCreateLocation,
  operationName: string,
): void {
  if (at.kind !== 'before' && at.kind !== 'after') return;

  const loc = at as { kind: string; target?: unknown; nodeId?: unknown };
  if (loc.nodeId !== undefined) {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `${operationName} does not support at.nodeId. Use at.target for before/after placement.`,
      { field: 'at.nodeId' },
    );
  }

  if (loc.target === undefined) {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `${operationName} with at.kind="${at.kind}" requires at.target.`,
      { field: 'at.target' },
    );
  }

  if (isRecord(loc.target) && 'story' in loc.target) {
    validateStoryLocator((loc.target as { story?: unknown }).story, 'at.target.story');
  }
}

/**
 * Validates create locations that support either `at.target` or `at.nodeId`
 * when `before`/`after` is used.
 */
function validateTargetOrNodeIdCreateLocation(at: TableCreateLocation, operationName: string): void {
  if (at.kind === 'inParagraph') {
    const loc = at as { target?: unknown; offset?: unknown; coordinateSpace?: unknown };
    if (loc.target === undefined) {
      throw new DocumentApiValidationError(
        'INVALID_TARGET',
        `${operationName} with at.kind="inParagraph" requires at.target.`,
        { field: 'at.target' },
      );
    }
    if (typeof loc.offset !== 'number' || !Number.isInteger(loc.offset) || loc.offset < 0) {
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        `${operationName} with at.kind="inParagraph" requires a non-negative integer at.offset.`,
        { field: 'at.offset', value: loc.offset },
      );
    }
    if (loc.coordinateSpace !== undefined && loc.coordinateSpace !== 'visible' && loc.coordinateSpace !== 'tracked') {
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        `${operationName} with at.kind="inParagraph" requires at.coordinateSpace to be "visible" or "tracked".`,
        { field: 'at.coordinateSpace', value: loc.coordinateSpace },
      );
    }
    if (isRecord(loc.target) && 'story' in loc.target) {
      validateStoryLocator((loc.target as { story?: unknown }).story, 'at.target.story');
    }
    return;
  }

  if (at.kind !== 'before' && at.kind !== 'after') return;

  const loc = at as { kind: string; target?: unknown; nodeId?: unknown };
  const hasTarget = loc.target !== undefined;
  const hasNodeId = loc.nodeId !== undefined;

  if (hasTarget && hasNodeId) {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `Cannot combine at.target and at.nodeId for ${operationName}. Use exactly one locator mode.`,
      { fields: ['at.target', 'at.nodeId'] },
    );
  }

  if (!hasTarget && !hasNodeId) {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `${operationName} with at.kind="${at.kind}" requires at.target or at.nodeId.`,
      { fields: ['at.target', 'at.nodeId'] },
    );
  }

  if (hasTarget && isRecord(loc.target) && 'story' in loc.target) {
    validateStoryLocator((loc.target as { story?: unknown }).story, 'at.target.story');
  }
}

/**
 * All create-location union types share `{ kind: 'documentEnd' }` as a member,
 * so we use that as the common base constraint. The generic preserves the
 * concrete location type at each call site.
 */
type CreateLocation = { kind: string };

/**
 * Normalises an optional create-location to a concrete value (defaulting to
 * `{ kind: 'documentEnd' }`) and runs the caller-supplied validation against it.
 */
function normalizeCreateLocation<T extends CreateLocation>(location: T | undefined, validate: (loc: T) => void): T {
  const normalized = (location ?? { kind: 'documentEnd' }) as T;
  validate(normalized);
  return normalized;
}

const SECTION_BREAK_TYPES: readonly SectionBreakType[] = ['continuous', 'nextPage', 'evenPage', 'oddPage'] as const;
const SECTION_BREAK_REPRESENTATIONS: readonly SectionBreakRepresentation[] = [
  'asNewParagraph',
  'attachToPreviousParagraph',
] as const;

/**
 * Shape-validates an optional `styleId` input: undefined or a non-empty
 * string. Whether the style id actually exists in the document cannot be
 * checked here (no session/document access at this layer) — that check
 * happens in the adapter and surfaces as `INVALID_INPUT` /
 * `style-reference-not-found` without mutating the document.
 */
function validateStyleId(value: unknown, operationName: string): void {
  if (value === undefined) return;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operationName} styleId must be a non-empty string when provided.`,
      { field: 'styleId', value },
    );
  }
}

function validateMarginValue(field: string, value: unknown): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${field} must be a non-negative number.`, {
      field,
      value,
    });
  }
}

function validateCreateSectionBreakInput(input: CreateSectionBreakInput): void {
  if (input.representation !== undefined && !SECTION_BREAK_REPRESENTATIONS.includes(input.representation)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `create.sectionBreak representation must be one of: ${SECTION_BREAK_REPRESENTATIONS.join(', ')}.`,
      { field: 'representation', value: input.representation },
    );
  }

  if (input.breakType !== undefined && !SECTION_BREAK_TYPES.includes(input.breakType)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `create.sectionBreak breakType must be one of: ${SECTION_BREAK_TYPES.join(', ')}.`,
      { field: 'breakType', value: input.breakType },
    );
  }

  if (input.pageMargins) {
    const { top, right, bottom, left, gutter } = input.pageMargins;
    if (top !== undefined) validateMarginValue('pageMargins.top', top);
    if (right !== undefined) validateMarginValue('pageMargins.right', right);
    if (bottom !== undefined) validateMarginValue('pageMargins.bottom', bottom);
    if (left !== undefined) validateMarginValue('pageMargins.left', left);
    if (gutter !== undefined) validateMarginValue('pageMargins.gutter', gutter);
  }

  if (input.headerFooterMargins) {
    const { header, footer } = input.headerFooterMargins;
    if (header !== undefined) validateMarginValue('headerFooterMargins.header', header);
    if (footer !== undefined) validateMarginValue('headerFooterMargins.footer', footer);
  }
}

export function normalizeCreateParagraphInput(input: CreateParagraphInput): CreateParagraphInput {
  return {
    in: input.in,
    at: normalizeCreateLocation<ParagraphCreateLocation>(input.at, () => {}),
    text: input.text ?? '',
    ...(input.in ? { in: input.in } : {}),
    ...(input.styleId ? { styleId: input.styleId } : {}),
  };
}

export function executeCreateParagraph(
  adapter: CreateAdapter,
  input: CreateParagraphInput,
  options?: MutationOptions,
): CreateParagraphResult {
  if (!isRecord(input as unknown)) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'create.paragraph input must be a non-null object.');
  }
  validateStoryLocator(input.in, 'in');
  validateStyleId(input.styleId, 'create.paragraph');
  const at = normalizeCreateLocation<ParagraphCreateLocation>(input.at, (loc) =>
    validateTargetOnlyCreateLocation(loc, 'create.paragraph'),
  );
  const normalized: CreateParagraphInput = {
    at,
    text: input.text ?? '',
    ...(input.in ? { in: input.in } : {}),
    ...(input.styleId ? { styleId: input.styleId } : {}),
  };
  return adapter.paragraph(normalized, normalizeMutationOptions(options));
}

export function normalizeCreateHeadingInput(input: CreateHeadingInput): CreateHeadingInput {
  return {
    in: input.in,
    level: input.level,
    at: normalizeCreateLocation<HeadingCreateLocation>(input.at, () => {}),
    text: input.text ?? '',
    ...(input.in ? { in: input.in } : {}),
    ...(input.styleId ? { styleId: input.styleId } : {}),
  };
}

export function executeCreateHeading(
  adapter: CreateAdapter,
  input: CreateHeadingInput,
  options?: MutationOptions,
): CreateHeadingResult {
  if (!isRecord(input as unknown)) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'create.heading input must be a non-null object.');
  }
  validateStoryLocator(input.in, 'in');
  if (!isInteger(input.level) || !VALID_HEADING_LEVELS.has(input.level as number)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `create.heading level must be an integer 1–6, got ${JSON.stringify(input.level)}.`,
      { field: 'level', value: input.level },
    );
  }
  validateStyleId(input.styleId, 'create.heading');
  const at = normalizeCreateLocation<HeadingCreateLocation>(input.at, (loc) =>
    validateTargetOnlyCreateLocation(loc, 'create.heading'),
  );
  const normalized: CreateHeadingInput = {
    level: input.level,
    at,
    text: input.text ?? '',
    ...(input.in ? { in: input.in } : {}),
    ...(input.styleId ? { styleId: input.styleId } : {}),
  };
  return adapter.heading(normalized, normalizeMutationOptions(options));
}

export function normalizeCreateTableInput(input: CreateTableInput): CreateTableInput {
  return {
    rows: input.rows,
    columns: input.columns,
    at: normalizeCreateLocation<TableCreateLocation>(input.at, () => {}),
  };
}

export function executeCreateTable(
  adapter: CreateAdapter,
  input: CreateTableInput,
  options?: MutationOptions,
): CreateTableResult {
  if (!isRecord(input as unknown)) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'create.table input must be a non-null object.');
  }
  if (!isInteger(input.rows) || (input.rows as number) < 1) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `create.table rows must be a positive integer, got ${JSON.stringify(input.rows)}.`,
      { field: 'rows', value: input.rows },
    );
  }
  if (!isInteger(input.columns) || (input.columns as number) < 1) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `create.table columns must be a positive integer, got ${JSON.stringify(input.columns)}.`,
      { field: 'columns', value: input.columns },
    );
  }
  const at = normalizeCreateLocation<TableCreateLocation>(input.at, (loc) =>
    validateTargetOrNodeIdCreateLocation(loc, 'create.table'),
  );
  const normalized: CreateTableInput = { rows: input.rows, columns: input.columns, at };
  return adapter.table(normalized, normalizeMutationOptions(options));
}

export function normalizeCreateSectionBreakInput(input: CreateSectionBreakInput): CreateSectionBreakInput {
  return {
    at: normalizeCreateLocation<SectionBreakCreateLocation>(input.at, () => {}),
    representation: input.representation ?? 'asNewParagraph',
    breakType: input.breakType,
    pageMargins: input.pageMargins,
    headerFooterMargins: input.headerFooterMargins,
  };
}

export function executeCreateSectionBreak(
  adapter: CreateAdapter,
  input: CreateSectionBreakInput,
  options?: MutationOptions,
): CreateSectionBreakResult {
  const at = normalizeCreateLocation<SectionBreakCreateLocation>(input.at, (loc) =>
    validateTargetOnlyCreateLocation(loc, 'create.sectionBreak'),
  );
  const normalized: CreateSectionBreakInput = {
    at,
    representation: input.representation ?? 'asNewParagraph',
    breakType: input.breakType,
    pageMargins: input.pageMargins,
    headerFooterMargins: input.headerFooterMargins,
  };
  validateCreateSectionBreakInput(normalized);
  return adapter.sectionBreak(normalized, normalizeMutationOptions(options));
}

export function normalizeCreateTableOfContentsInput(input: CreateTableOfContentsInput): CreateTableOfContentsInput {
  return {
    at: normalizeCreateLocation<TocCreateLocation>(input.at, () => {}),
    instruction: input.instruction,
    config: input.config,
  };
}

function validateCreateTableOfContentsInput(input: CreateTableOfContentsInput): void {
  if (input.instruction === undefined) {
    return;
  }
  if (typeof input.instruction !== 'string' || input.instruction.trim().length === 0) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      'create.tableOfContents instruction must be a non-empty string when provided.',
      { field: 'instruction', value: input.instruction },
    );
  }
  if (!/^\s*TOC\b/i.test(input.instruction)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      'create.tableOfContents instruction must be a raw TOC field instruction beginning with TOC.',
      { field: 'instruction', value: input.instruction },
    );
  }
}

export function executeCreateTableOfContents(
  adapter: CreateAdapter,
  input: CreateTableOfContentsInput,
  options?: MutationOptions,
): CreateTableOfContentsResult {
  const at = normalizeCreateLocation<TocCreateLocation>(input.at, (loc) => {
    // TocCreateLocation only supports the `target` form, not the legacy `nodeId` form.
    // Reject `nodeId` explicitly when callers send untyped payloads.
    if ((loc.kind === 'before' || loc.kind === 'after') && 'nodeId' in loc) {
      throw new DocumentApiValidationError(
        'INVALID_TARGET',
        'create.tableOfContents requires at.target for before/after positioning. The nodeId form is not supported.',
        { fields: ['at.nodeId'] },
      );
    }
    validateTargetOnlyCreateLocation(loc, 'create.tableOfContents');
  });
  const normalized: CreateTableOfContentsInput = { at, instruction: input.instruction, config: input.config };
  validateCreateTableOfContentsInput(normalized);
  return adapter.tableOfContents(normalized, normalizeMutationOptions(options));
}
