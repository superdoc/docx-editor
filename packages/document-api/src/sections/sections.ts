import { DocumentApiValidationError } from '../errors.js';
import { normalizeMutationOptions, type MutationOptions } from '../write/write.js';
import { isRecord } from '../object-guards.js';
import type {
  DocumentMutationResult,
  SectionAddress,
  SectionMutationResult,
  SectionBreakType,
  SectionHeaderFooterKind,
  SectionHeaderFooterVariant,
  SectionDirection,
  SectionOrientation,
  SectionPageNumberingChapterSeparator,
  SectionPageNumberingFormat,
  SectionVerticalAlign,
  SectionsClearHeaderFooterRefInput,
  SectionsClearPageBordersInput,
  SectionsGetInput,
  SectionsListQuery,
  SectionsListResult,
  SectionsSetBreakTypeInput,
  SectionsSetColumnsInput,
  SectionsSetHeaderFooterMarginsInput,
  SectionsSetHeaderFooterRefInput,
  SectionsSetLineNumberingInput,
  SectionsSetLinkToPreviousInput,
  SectionsSetOddEvenHeadersFootersInput,
  SectionsSetPageBordersInput,
  SectionsSetPageMarginsInput,
  SectionsSetPageNumberingInput,
  SectionsSetPageSetupInput,
  SectionsSetSectionDirectionInput,
  SectionsSetTitlePageInput,
  SectionsSetVerticalAlignInput,
  SectionInfo,
  SectionTargetInput,
} from './sections.types.js';

export type {
  DocumentMutationResult,
  SectionAddress,
  SectionMutationResult,
  SectionBreakType,
  SectionHeaderFooterKind,
  SectionHeaderFooterVariant,
  SectionPageNumberingChapterSeparator,
  SectionsClearHeaderFooterRefInput,
  SectionsClearPageBordersInput,
  SectionsGetInput,
  SectionsListQuery,
  SectionsListResult,
  SectionsSetBreakTypeInput,
  SectionsSetColumnsInput,
  SectionsSetHeaderFooterMarginsInput,
  SectionsSetHeaderFooterRefInput,
  SectionsSetLineNumberingInput,
  SectionsSetLinkToPreviousInput,
  SectionsSetOddEvenHeadersFootersInput,
  SectionsSetPageBordersInput,
  SectionsSetPageMarginsInput,
  SectionsSetPageNumberingInput,
  SectionsSetPageSetupInput,
  SectionsSetSectionDirectionInput,
  SectionsSetTitlePageInput,
  SectionsSetVerticalAlignInput,
  SectionInfo,
  SectionTargetInput,
} from './sections.types.js';

const DEFAULT_SECTIONS_LIST_LIMIT = 250;

const SECTION_BREAK_TYPES: readonly SectionBreakType[] = ['continuous', 'nextPage', 'evenPage', 'oddPage'] as const;
const SECTION_ORIENTATIONS: readonly SectionOrientation[] = ['portrait', 'landscape'] as const;
const SECTION_VERTICAL_ALIGNS: readonly SectionVerticalAlign[] = ['top', 'center', 'bottom', 'both'] as const;
const SECTION_DIRECTIONS: readonly SectionDirection[] = ['ltr', 'rtl'] as const;
const HEADER_FOOTER_KINDS: readonly SectionHeaderFooterKind[] = ['header', 'footer'] as const;
const HEADER_FOOTER_VARIANTS: readonly SectionHeaderFooterVariant[] = ['default', 'first', 'even'] as const;
const LINE_NUMBER_RESTARTS = ['continuous', 'newPage', 'newSection'] as const;
export const PAGE_NUMBER_FORMATS: readonly SectionPageNumberingFormat[] = [
  'decimal',
  'lowerLetter',
  'upperLetter',
  'lowerRoman',
  'upperRoman',
  'numberInDash',
  // Word's Hebrew numerals: hebrew1 is gematria, hebrew2 counts the alphabet.
  'hebrew1',
  'hebrew2',
];
const PAGE_NUMBER_CHAPTER_SEPARATORS: readonly SectionPageNumberingChapterSeparator[] = [
  'hyphen',
  'period',
  'colon',
  'emDash',
  'enDash',
] as const;
const PAGE_BORDER_DISPLAYS = ['allPages', 'firstPage', 'notFirstPage'] as const;
const PAGE_BORDER_OFFSET_FROM_VALUES = ['page', 'text'] as const;
const PAGE_BORDER_Z_ORDER_VALUES = ['front', 'back'] as const;

function assertSectionAddress(value: unknown, fieldName: string): asserts value is SectionAddress {
  if (
    !isRecord(value) ||
    value.kind !== 'section' ||
    typeof value.sectionId !== 'string' ||
    value.sectionId.length === 0
  ) {
    throw new DocumentApiValidationError('INVALID_TARGET', `${fieldName} must be a section address.`, {
      field: fieldName,
      value,
    });
  }
}

function assertSectionTarget(input: unknown, operationName: string): asserts input is SectionTargetInput {
  if (!isRecord(input)) {
    throw new DocumentApiValidationError('INVALID_TARGET', `${operationName} input must be an object.`);
  }
  assertSectionAddress(input.target, `${operationName}.target`);
}

function assertBoolean(value: unknown, fieldName: string): asserts value is boolean {
  if (typeof value !== 'boolean') {
    throw new DocumentApiValidationError('INVALID_INPUT', `${fieldName} must be a boolean.`, {
      field: fieldName,
      value,
    });
  }
}

function assertString(value: unknown, fieldName: string): asserts value is string {
  if (typeof value !== 'string') {
    throw new DocumentApiValidationError('INVALID_INPUT', `${fieldName} must be a string.`, {
      field: fieldName,
      value,
    });
  }
}

function assertNonEmptyString(value: unknown, fieldName: string): asserts value is string {
  assertString(value, fieldName);
  if (value.trim().length === 0) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${fieldName} must be a non-empty string.`, {
      field: fieldName,
      value,
    });
  }
}

function assertPositiveInteger(value: unknown, fieldName: string): void {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${fieldName} must be a positive integer.`, {
      field: fieldName,
      value,
    });
  }
}

function assertNonNegativeNumber(value: unknown, fieldName: string, unit?: 'inches'): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${fieldName} must be a ${unit ? 'finite non-negative number in inches (1 inch = 1440 twips)' : 'non-negative number'}.`,
      {
        field: fieldName,
        value,
      },
    );
  }
}

function assertOneOf<T extends string>(value: unknown, fieldName: string, allowed: readonly T[]): asserts value is T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${fieldName} must be one of: ${allowed.join(', ')}.`, {
      field: fieldName,
      value,
      allowed,
    });
  }
}

function hasAnyDefined(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.some((key) => value[key] !== undefined);
}

function assertObject(value: unknown, fieldName: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${fieldName} must be an object.`, {
      field: fieldName,
      value,
    });
  }
}

function validateBorderSpec(value: unknown, fieldName: string): void {
  assertObject(value, fieldName);
  if (!hasAnyDefined(value, ['style', 'size', 'space', 'color', 'shadow', 'frame'])) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${fieldName} must include at least one of style, size, space, color, shadow, or frame.`,
      { field: fieldName, value },
    );
  }
  if (value.style !== undefined) assertString(value.style, `${fieldName}.style`);
  if (value.size !== undefined) assertNonNegativeNumber(value.size, `${fieldName}.size`);
  if (value.space !== undefined) assertNonNegativeNumber(value.space, `${fieldName}.space`);
  if (value.color !== undefined) assertString(value.color, `${fieldName}.color`);
  if (value.shadow !== undefined) assertBoolean(value.shadow, `${fieldName}.shadow`);
  if (value.frame !== undefined) assertBoolean(value.frame, `${fieldName}.frame`);
}

function validatePageBorders(value: unknown, fieldName: string): void {
  assertObject(value, fieldName);
  if (!hasAnyDefined(value, ['display', 'offsetFrom', 'zOrder', 'top', 'right', 'bottom', 'left'])) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${fieldName} requires at least one border field.`, {
      field: fieldName,
      value,
    });
  }

  if (value.display !== undefined) assertOneOf(value.display, `${fieldName}.display`, PAGE_BORDER_DISPLAYS);
  if (value.offsetFrom !== undefined) {
    assertOneOf(value.offsetFrom, `${fieldName}.offsetFrom`, PAGE_BORDER_OFFSET_FROM_VALUES);
  }
  if (value.zOrder !== undefined) assertOneOf(value.zOrder, `${fieldName}.zOrder`, PAGE_BORDER_Z_ORDER_VALUES);

  if (value.top !== undefined) validateBorderSpec(value.top, `${fieldName}.top`);
  if (value.right !== undefined) validateBorderSpec(value.right, `${fieldName}.right`);
  if (value.bottom !== undefined) validateBorderSpec(value.bottom, `${fieldName}.bottom`);
  if (value.left !== undefined) validateBorderSpec(value.left, `${fieldName}.left`);
}

function normalizeSectionsListQuery(query?: SectionsListQuery): Required<SectionsListQuery> {
  const limit = query?.limit ?? DEFAULT_SECTIONS_LIST_LIMIT;
  const offset = query?.offset ?? 0;

  if (!Number.isInteger(limit) || Number(limit) <= 0) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'sections.list limit must be a positive integer.', {
      field: 'limit',
      value: limit,
    });
  }

  if (!Number.isInteger(offset) || Number(offset) < 0) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'sections.list offset must be a non-negative integer.', {
      field: 'offset',
      value: offset,
    });
  }

  return { limit: Number(limit), offset: Number(offset) };
}

function validateHeaderFooterRefParams(
  operationName: string,
  kind: unknown,
  variant: unknown,
): asserts kind is SectionHeaderFooterKind & string {
  assertOneOf(kind, `${operationName}.kind`, HEADER_FOOTER_KINDS);
  assertOneOf(variant, `${operationName}.variant`, HEADER_FOOTER_VARIANTS);
}

export interface SectionsAdapter {
  list(query?: SectionsListQuery): SectionsListResult;
  get(input: SectionsGetInput): SectionInfo;
  setBreakType(input: SectionsSetBreakTypeInput, options?: MutationOptions): SectionMutationResult;
  setPageMargins(input: SectionsSetPageMarginsInput, options?: MutationOptions): SectionMutationResult;
  setHeaderFooterMargins(input: SectionsSetHeaderFooterMarginsInput, options?: MutationOptions): SectionMutationResult;
  setPageSetup(input: SectionsSetPageSetupInput, options?: MutationOptions): SectionMutationResult;
  setColumns(input: SectionsSetColumnsInput, options?: MutationOptions): SectionMutationResult;
  setLineNumbering(input: SectionsSetLineNumberingInput, options?: MutationOptions): SectionMutationResult;
  setPageNumbering(input: SectionsSetPageNumberingInput, options?: MutationOptions): SectionMutationResult;
  setTitlePage(input: SectionsSetTitlePageInput, options?: MutationOptions): SectionMutationResult;
  setOddEvenHeadersFooters(
    input: SectionsSetOddEvenHeadersFootersInput,
    options?: MutationOptions,
  ): DocumentMutationResult;
  setVerticalAlign(input: SectionsSetVerticalAlignInput, options?: MutationOptions): SectionMutationResult;
  setSectionDirection(input: SectionsSetSectionDirectionInput, options?: MutationOptions): SectionMutationResult;
  setHeaderFooterRef(input: SectionsSetHeaderFooterRefInput, options?: MutationOptions): SectionMutationResult;
  clearHeaderFooterRef(input: SectionsClearHeaderFooterRefInput, options?: MutationOptions): SectionMutationResult;
  setLinkToPrevious(input: SectionsSetLinkToPreviousInput, options?: MutationOptions): SectionMutationResult;
  setPageBorders(input: SectionsSetPageBordersInput, options?: MutationOptions): SectionMutationResult;
  clearPageBorders(input: SectionsClearPageBordersInput, options?: MutationOptions): SectionMutationResult;
}

export type SectionsApi = SectionsAdapter;

export function executeSectionsList(adapter: SectionsAdapter, query?: SectionsListQuery): SectionsListResult {
  return adapter.list(normalizeSectionsListQuery(query));
}

export function executeSectionsGet(adapter: SectionsAdapter, input: SectionsGetInput): SectionInfo {
  assertSectionAddress(input?.address, 'sections.get.address');
  return adapter.get(input);
}

export function executeSectionsSetBreakType(
  adapter: SectionsAdapter,
  input: SectionsSetBreakTypeInput,
  options?: MutationOptions,
): SectionMutationResult {
  assertSectionTarget(input, 'sections.setBreakType');
  assertOneOf(input.breakType, 'sections.setBreakType.breakType', SECTION_BREAK_TYPES);
  return adapter.setBreakType(input, normalizeMutationOptions(options));
}

export function executeSectionsSetPageMargins(
  adapter: SectionsAdapter,
  input: SectionsSetPageMarginsInput,
  options?: MutationOptions,
): SectionMutationResult {
  assertSectionTarget(input, 'sections.setPageMargins');
  if (!hasAnyDefined(input as unknown as Record<string, unknown>, ['top', 'right', 'bottom', 'left', 'gutter'])) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      'sections.setPageMargins requires at least one margin field.',
    );
  }

  if (input.top !== undefined) assertNonNegativeNumber(input.top, 'sections.setPageMargins.top', 'inches');
  if (input.right !== undefined) assertNonNegativeNumber(input.right, 'sections.setPageMargins.right', 'inches');
  if (input.bottom !== undefined) assertNonNegativeNumber(input.bottom, 'sections.setPageMargins.bottom', 'inches');
  if (input.left !== undefined) assertNonNegativeNumber(input.left, 'sections.setPageMargins.left', 'inches');
  if (input.gutter !== undefined) assertNonNegativeNumber(input.gutter, 'sections.setPageMargins.gutter', 'inches');

  return adapter.setPageMargins(input, normalizeMutationOptions(options));
}

export function executeSectionsSetHeaderFooterMargins(
  adapter: SectionsAdapter,
  input: SectionsSetHeaderFooterMarginsInput,
  options?: MutationOptions,
): SectionMutationResult {
  assertSectionTarget(input, 'sections.setHeaderFooterMargins');
  if (!hasAnyDefined(input as unknown as Record<string, unknown>, ['header', 'footer'])) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      'sections.setHeaderFooterMargins requires at least one margin field.',
    );
  }

  if (input.header !== undefined) assertNonNegativeNumber(input.header, 'sections.setHeaderFooterMargins.header');
  if (input.footer !== undefined) assertNonNegativeNumber(input.footer, 'sections.setHeaderFooterMargins.footer');

  return adapter.setHeaderFooterMargins(input, normalizeMutationOptions(options));
}

export function executeSectionsSetPageSetup(
  adapter: SectionsAdapter,
  input: SectionsSetPageSetupInput,
  options?: MutationOptions,
): SectionMutationResult {
  assertSectionTarget(input, 'sections.setPageSetup');
  if (!hasAnyDefined(input as unknown as Record<string, unknown>, ['width', 'height', 'orientation', 'paperSize'])) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'sections.setPageSetup requires at least one setup field.');
  }

  if (input.width !== undefined) assertNonNegativeNumber(input.width, 'sections.setPageSetup.width');
  if (input.height !== undefined) assertNonNegativeNumber(input.height, 'sections.setPageSetup.height');
  if (input.orientation !== undefined) {
    assertOneOf(input.orientation, 'sections.setPageSetup.orientation', SECTION_ORIENTATIONS);
  }
  if (input.paperSize !== undefined) assertNonEmptyString(input.paperSize, 'sections.setPageSetup.paperSize');

  return adapter.setPageSetup(input, normalizeMutationOptions(options));
}

export function executeSectionsSetColumns(
  adapter: SectionsAdapter,
  input: SectionsSetColumnsInput,
  options?: MutationOptions,
): SectionMutationResult {
  assertSectionTarget(input, 'sections.setColumns');
  if (!hasAnyDefined(input as unknown as Record<string, unknown>, ['count', 'gap', 'equalWidth'])) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'sections.setColumns requires at least one columns field.');
  }

  if (input.count !== undefined) assertPositiveInteger(input.count, 'sections.setColumns.count');
  if (input.gap !== undefined) assertNonNegativeNumber(input.gap, 'sections.setColumns.gap');
  if (input.equalWidth !== undefined) assertBoolean(input.equalWidth, 'sections.setColumns.equalWidth');

  return adapter.setColumns(input, normalizeMutationOptions(options));
}

export function executeSectionsSetLineNumbering(
  adapter: SectionsAdapter,
  input: SectionsSetLineNumberingInput,
  options?: MutationOptions,
): SectionMutationResult {
  assertSectionTarget(input, 'sections.setLineNumbering');
  assertBoolean(input.enabled, 'sections.setLineNumbering.enabled');

  if (input.countBy !== undefined) assertPositiveInteger(input.countBy, 'sections.setLineNumbering.countBy');
  if (input.start !== undefined) assertPositiveInteger(input.start, 'sections.setLineNumbering.start');
  if (input.distance !== undefined) assertNonNegativeNumber(input.distance, 'sections.setLineNumbering.distance');
  if (input.restart !== undefined) {
    assertOneOf(input.restart, 'sections.setLineNumbering.restart', LINE_NUMBER_RESTARTS);
  }

  return adapter.setLineNumbering(input, normalizeMutationOptions(options));
}

export function executeSectionsSetPageNumbering(
  adapter: SectionsAdapter,
  input: SectionsSetPageNumberingInput,
  options?: MutationOptions,
): SectionMutationResult {
  assertSectionTarget(input, 'sections.setPageNumbering');
  if (
    !hasAnyDefined(input as unknown as Record<string, unknown>, ['start', 'format', 'chapterStyle', 'chapterSeparator'])
  ) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      'sections.setPageNumbering requires at least one of start, format, chapterStyle, or chapterSeparator.',
    );
  }

  // null clears the start, so numbering continues from the previous section.
  if (input.start !== undefined && input.start !== null) {
    assertPositiveInteger(input.start, 'sections.setPageNumbering.start');
  }
  if (input.format !== undefined) {
    assertOneOf(input.format, 'sections.setPageNumbering.format', PAGE_NUMBER_FORMATS);
  }
  if (input.chapterStyle !== undefined) {
    assertPositiveInteger(input.chapterStyle, 'sections.setPageNumbering.chapterStyle');
  }
  if (input.chapterSeparator !== undefined) {
    assertOneOf(input.chapterSeparator, 'sections.setPageNumbering.chapterSeparator', PAGE_NUMBER_CHAPTER_SEPARATORS);
  }

  return adapter.setPageNumbering(input, normalizeMutationOptions(options));
}

export function executeSectionsSetTitlePage(
  adapter: SectionsAdapter,
  input: SectionsSetTitlePageInput,
  options?: MutationOptions,
): SectionMutationResult {
  assertSectionTarget(input, 'sections.setTitlePage');
  assertBoolean(input.enabled, 'sections.setTitlePage.enabled');
  return adapter.setTitlePage(input, normalizeMutationOptions(options));
}

export function executeSectionsSetOddEvenHeadersFooters(
  adapter: SectionsAdapter,
  input: SectionsSetOddEvenHeadersFootersInput,
  options?: MutationOptions,
): DocumentMutationResult {
  assertBoolean(input?.enabled, 'sections.setOddEvenHeadersFooters.enabled');
  return adapter.setOddEvenHeadersFooters(input, normalizeMutationOptions(options));
}

export function executeSectionsSetVerticalAlign(
  adapter: SectionsAdapter,
  input: SectionsSetVerticalAlignInput,
  options?: MutationOptions,
): SectionMutationResult {
  assertSectionTarget(input, 'sections.setVerticalAlign');
  assertOneOf(input.value, 'sections.setVerticalAlign.value', SECTION_VERTICAL_ALIGNS);
  return adapter.setVerticalAlign(input, normalizeMutationOptions(options));
}

export function executeSectionsSetSectionDirection(
  adapter: SectionsAdapter,
  input: SectionsSetSectionDirectionInput,
  options?: MutationOptions,
): SectionMutationResult {
  assertSectionTarget(input, 'sections.setSectionDirection');
  assertOneOf(input.direction, 'sections.setSectionDirection.direction', SECTION_DIRECTIONS);
  return adapter.setSectionDirection(input, normalizeMutationOptions(options));
}

export function executeSectionsSetHeaderFooterRef(
  adapter: SectionsAdapter,
  input: SectionsSetHeaderFooterRefInput,
  options?: MutationOptions,
): SectionMutationResult {
  assertSectionTarget(input, 'sections.setHeaderFooterRef');
  validateHeaderFooterRefParams('sections.setHeaderFooterRef', input.kind, input.variant);
  assertNonEmptyString(input.refId, 'sections.setHeaderFooterRef.refId');
  return adapter.setHeaderFooterRef(input, normalizeMutationOptions(options));
}

export function executeSectionsClearHeaderFooterRef(
  adapter: SectionsAdapter,
  input: SectionsClearHeaderFooterRefInput,
  options?: MutationOptions,
): SectionMutationResult {
  assertSectionTarget(input, 'sections.clearHeaderFooterRef');
  validateHeaderFooterRefParams('sections.clearHeaderFooterRef', input.kind, input.variant);
  return adapter.clearHeaderFooterRef(input, normalizeMutationOptions(options));
}

export function executeSectionsSetLinkToPrevious(
  adapter: SectionsAdapter,
  input: SectionsSetLinkToPreviousInput,
  options?: MutationOptions,
): SectionMutationResult {
  assertSectionTarget(input, 'sections.setLinkToPrevious');
  validateHeaderFooterRefParams('sections.setLinkToPrevious', input.kind, input.variant);
  assertBoolean(input.linked, 'sections.setLinkToPrevious.linked');
  return adapter.setLinkToPrevious(input, normalizeMutationOptions(options));
}

export function executeSectionsSetPageBorders(
  adapter: SectionsAdapter,
  input: SectionsSetPageBordersInput,
  options?: MutationOptions,
): SectionMutationResult {
  assertSectionTarget(input, 'sections.setPageBorders');
  validatePageBorders(input.borders, 'sections.setPageBorders.borders');

  return adapter.setPageBorders(input, normalizeMutationOptions(options));
}

export function executeSectionsClearPageBorders(
  adapter: SectionsAdapter,
  input: SectionsClearPageBordersInput,
  options?: MutationOptions,
): SectionMutationResult {
  assertSectionTarget(input, 'sections.clearPageBorders');
  return adapter.clearPageBorders(input, normalizeMutationOptions(options));
}
