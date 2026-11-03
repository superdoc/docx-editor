import { DocumentApiValidationError } from '../errors.js';
import { normalizeMutationOptions, type MutationOptions } from '../write/write.js';
import { isRecord } from '../object-guards.js';
import type { SectionAddress, SectionMutationResult } from '../sections/sections.types.js';
import type {
  HeaderFooterKind,
  HeaderFooterVariant,
  HeaderFooterSlotAddress,
  HeaderFooterPartAddress,
  HeaderFooterSlotEntry,
  HeaderFooterResolveResult,
  HeaderFootersListQuery,
  HeaderFootersListResult,
  HeaderFootersGetInput,
  HeaderFootersResolveInput,
  HeaderFootersRefsSetInput,
  HeaderFootersRefsClearInput,
  HeaderFootersRefsSetLinkedToPreviousInput,
  HeaderFootersPartsListQuery,
  HeaderFootersPartsListResult,
  HeaderFootersPartsCreateInput,
  HeaderFootersPartsDeleteInput,
  HeaderFooterPartsMutationResult,
  HeaderFooterPageNumberAlignment,
  HeaderFootersPageNumbersInsertInput,
  HeaderFooterPageNumbersInsertResult,
  HeaderFootersPageNumbersSetInput,
  HeaderFooterPageNumbersSetResult,
  HeaderFootersPageNumbersRemoveInput,
  HeaderFooterPageNumbersRemoveResult,
  HeaderFootersPageNumbersGetInput,
  HeaderFooterPageNumbersInfo,
} from './header-footers.types.js';
import { PAGE_NUMBER_FORMATS } from '../sections/sections.js';

export type {
  HeaderFooterKind,
  HeaderFooterVariant,
  HeaderFooterSlotAddress,
  HeaderFooterPartAddress,
  HeaderFooterSlotEntry,
  HeaderFooterResolveResult,
  HeaderFooterPartEntry,
  HeaderFootersListQuery,
  HeaderFootersListResult,
  HeaderFootersGetInput,
  HeaderFootersResolveInput,
  HeaderFootersRefsSetInput,
  HeaderFootersRefsClearInput,
  HeaderFootersRefsSetLinkedToPreviousInput,
  HeaderFootersPartsListQuery,
  HeaderFootersPartsListResult,
  HeaderFootersPartsCreateInput,
  HeaderFootersPartsDeleteInput,
  HeaderFooterPartsMutationResult,
  HeaderFooterRefsMutationResult,
  HeaderFooterRefsMutationSuccessResult,
  HeaderFooterRefsMutationFailureResult,
  HeaderFooterPartsMutationSuccessResult,
  HeaderFooterPartsMutationFailureResult,
  HeaderFooterPageNumberAlignment,
  HeaderFootersPageNumbersInsertInput,
  HeaderFooterPageNumbersInsertResult,
  HeaderFooterPageNumbersInsertSuccessResult,
  HeaderFooterPageNumbersInsertFailureResult,
  HeaderFootersPageNumbersNumberingInput,
  HeaderFootersPageNumbersSetInput,
  HeaderFooterPageNumbersSetResult,
  HeaderFootersPageNumbersRemoveInput,
  HeaderFooterPageNumbersRemoveResult,
  HeaderFooterPageNumbersRemoveSuccessResult,
  HeaderFootersPageNumbersGetInput,
  HeaderFooterPageNumberPlacement,
  HeaderFooterPageNumbersInfo,
} from './header-footers.types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HEADER_FOOTER_KINDS: readonly HeaderFooterKind[] = ['header', 'footer'] as const;
const HEADER_FOOTER_VARIANTS: readonly HeaderFooterVariant[] = ['default', 'first', 'even'] as const;
const PAGE_NUMBER_ALIGNMENTS: readonly HeaderFooterPageNumberAlignment[] = ['left', 'center', 'right'] as const;

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

export interface HeaderFootersAdapter {
  list(query?: HeaderFootersListQuery): HeaderFootersListResult;
  get(input: HeaderFootersGetInput): HeaderFooterSlotEntry;
  resolve(input: HeaderFootersResolveInput): HeaderFooterResolveResult;
  refs: {
    set(input: HeaderFootersRefsSetInput, options?: MutationOptions): SectionMutationResult;
    clear(input: HeaderFootersRefsClearInput, options?: MutationOptions): SectionMutationResult;
    setLinkedToPrevious(
      input: HeaderFootersRefsSetLinkedToPreviousInput,
      options?: MutationOptions,
    ): SectionMutationResult;
  };
  parts: {
    list(query?: HeaderFootersPartsListQuery): HeaderFootersPartsListResult;
    create(input: HeaderFootersPartsCreateInput, options?: MutationOptions): HeaderFooterPartsMutationResult;
    delete(input: HeaderFootersPartsDeleteInput, options?: MutationOptions): HeaderFooterPartsMutationResult;
  };
  /** Optional: adapters without page-number support fail closed with CAPABILITY_UNAVAILABLE. */
  pageNumbers?: {
    get(input: HeaderFootersPageNumbersGetInput): HeaderFooterPageNumbersInfo;
    insert(input: HeaderFootersPageNumbersInsertInput, options?: MutationOptions): HeaderFooterPageNumbersInsertResult;
    set(input: HeaderFootersPageNumbersSetInput, options?: MutationOptions): HeaderFooterPageNumbersSetResult;
    remove(input: HeaderFootersPageNumbersRemoveInput, options?: MutationOptions): HeaderFooterPageNumbersRemoveResult;
  };
}

export type HeaderFootersApi = Omit<HeaderFootersAdapter, 'pageNumbers'> & {
  pageNumbers: NonNullable<HeaderFootersAdapter['pageNumbers']>;
};

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function assertOneOf<T extends string>(value: unknown, fieldName: string, allowed: readonly T[]): asserts value is T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${fieldName} must be one of: ${allowed.join(', ')}.`, {
      field: fieldName,
      value,
      allowed,
    });
  }
}

function assertNonEmptyString(value: unknown, fieldName: string): asserts value is string {
  if (typeof value !== 'string') {
    throw new DocumentApiValidationError('INVALID_INPUT', `${fieldName} must be a string.`, {
      field: fieldName,
      value,
    });
  }
  if (value.trim().length === 0) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${fieldName} must be a non-empty string.`, {
      field: fieldName,
      value,
    });
  }
}

function assertBoolean(value: unknown, fieldName: string): asserts value is boolean {
  if (typeof value !== 'boolean') {
    throw new DocumentApiValidationError('INVALID_INPUT', `${fieldName} must be a boolean.`, {
      field: fieldName,
      value,
    });
  }
}

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

export function assertHeaderFooterSlotTarget(
  input: unknown,
  operationName: string,
): asserts input is { target: HeaderFooterSlotAddress } {
  if (!isRecord(input)) {
    throw new DocumentApiValidationError('INVALID_TARGET', `${operationName} input must be an object.`);
  }

  const target = input.target;
  if (!isRecord(target) || target.kind !== 'headerFooterSlot') {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `${operationName}.target must be a headerFooterSlot address.`,
      { field: `${operationName}.target`, value: target },
    );
  }

  assertSectionAddress(target.section, `${operationName}.target.section`);
  assertOneOf(target.headerFooterKind, `${operationName}.target.headerFooterKind`, HEADER_FOOTER_KINDS);
  assertOneOf(target.variant, `${operationName}.target.variant`, HEADER_FOOTER_VARIANTS);
}

export function assertHeaderFooterPartTarget(
  input: unknown,
  operationName: string,
): asserts input is { target: HeaderFooterPartAddress } {
  if (!isRecord(input)) {
    throw new DocumentApiValidationError('INVALID_TARGET', `${operationName} input must be an object.`);
  }

  const target = input.target;
  if (!isRecord(target) || target.kind !== 'headerFooterPart') {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `${operationName}.target must be a headerFooterPart address.`,
      { field: `${operationName}.target`, value: target },
    );
  }

  assertNonEmptyString(target.refId, `${operationName}.target.refId`);
}

// ---------------------------------------------------------------------------
// Execute wrappers
// ---------------------------------------------------------------------------

export function executeHeaderFootersList(
  adapter: HeaderFootersAdapter,
  query?: HeaderFootersListQuery,
): HeaderFootersListResult {
  if (query?.kind !== undefined) {
    assertOneOf(query.kind, 'headerFooters.list.kind', HEADER_FOOTER_KINDS);
  }
  if (query?.section !== undefined) {
    assertSectionAddress(query.section, 'headerFooters.list.section');
  }
  return adapter.list(query);
}

export function executeHeaderFootersGet(
  adapter: HeaderFootersAdapter,
  input: HeaderFootersGetInput,
): HeaderFooterSlotEntry {
  assertHeaderFooterSlotTarget(input, 'headerFooters.get');
  return adapter.get(input);
}

export function executeHeaderFootersResolve(
  adapter: HeaderFootersAdapter,
  input: HeaderFootersResolveInput,
): HeaderFooterResolveResult {
  assertHeaderFooterSlotTarget(input, 'headerFooters.resolve');
  return adapter.resolve(input);
}

export function executeHeaderFootersRefsSet(
  adapter: HeaderFootersAdapter,
  input: HeaderFootersRefsSetInput,
  options?: MutationOptions,
): SectionMutationResult {
  assertHeaderFooterSlotTarget(input, 'headerFooters.refs.set');
  assertNonEmptyString(input.refId, 'headerFooters.refs.set.refId');
  return adapter.refs.set(input, normalizeMutationOptions(options));
}

export function executeHeaderFootersRefsClear(
  adapter: HeaderFootersAdapter,
  input: HeaderFootersRefsClearInput,
  options?: MutationOptions,
): SectionMutationResult {
  assertHeaderFooterSlotTarget(input, 'headerFooters.refs.clear');
  return adapter.refs.clear(input, normalizeMutationOptions(options));
}

export function executeHeaderFootersRefsSetLinkedToPrevious(
  adapter: HeaderFootersAdapter,
  input: HeaderFootersRefsSetLinkedToPreviousInput,
  options?: MutationOptions,
): SectionMutationResult {
  assertHeaderFooterSlotTarget(input, 'headerFooters.refs.setLinkedToPrevious');
  assertBoolean(input.linked, 'headerFooters.refs.setLinkedToPrevious.linked');
  return adapter.refs.setLinkedToPrevious(input, normalizeMutationOptions(options));
}

export function executeHeaderFootersPartsList(
  adapter: HeaderFootersAdapter,
  query?: HeaderFootersPartsListQuery,
): HeaderFootersPartsListResult {
  if (query?.kind !== undefined) {
    assertOneOf(query.kind, 'headerFooters.parts.list.kind', HEADER_FOOTER_KINDS);
  }
  return adapter.parts.list(query);
}

export function executeHeaderFootersPartsCreate(
  adapter: HeaderFootersAdapter,
  input: HeaderFootersPartsCreateInput,
  options?: MutationOptions,
): HeaderFooterPartsMutationResult {
  assertOneOf(input?.kind, 'headerFooters.parts.create.kind', HEADER_FOOTER_KINDS);
  if (input.sourceRefId !== undefined) {
    assertNonEmptyString(input.sourceRefId, 'headerFooters.parts.create.sourceRefId');
  }
  return adapter.parts.create(input, normalizeMutationOptions(options));
}

export function executeHeaderFootersPartsDelete(
  adapter: HeaderFootersAdapter,
  input: HeaderFootersPartsDeleteInput,
  options?: MutationOptions,
): HeaderFooterPartsMutationResult {
  assertHeaderFooterPartTarget(input, 'headerFooters.parts.delete');
  return adapter.parts.delete(input, normalizeMutationOptions(options));
}

function requirePageNumbers(
  adapter: HeaderFootersAdapter,
  operation: string,
): NonNullable<HeaderFootersAdapter['pageNumbers']> {
  if (!adapter.pageNumbers) {
    throw new DocumentApiValidationError('CAPABILITY_UNAVAILABLE', `${operation} is not available for this document.`);
  }
  return adapter.pageNumbers;
}

function assertPageNumbersInput(input: unknown, operation: string): asserts input is { section: SectionAddress } {
  if (!isRecord(input)) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${operation} input must be an object.`);
  }
  assertSectionAddress(input.section, `${operation}.section`);
}

function assertPageNumbersPlacement(
  input: HeaderFootersPageNumbersInsertInput | HeaderFootersPageNumbersSetInput,
  operation: string,
): void {
  assertOneOf(input.kind, `${operation}.kind`, HEADER_FOOTER_KINDS);
  if (input.alignment !== undefined) {
    assertOneOf(input.alignment, `${operation}.alignment`, PAGE_NUMBER_ALIGNMENTS);
  }
  if (input.showOnFirstPage !== undefined) {
    assertBoolean(input.showOnFirstPage, `${operation}.showOnFirstPage`);
  }
  if (input.format !== undefined) {
    assertOneOf(input.format, `${operation}.format`, PAGE_NUMBER_FORMATS);
  }
  if (input.start !== undefined && input.start !== null) {
    if (typeof input.start !== 'number' || !Number.isInteger(input.start) || input.start < 0) {
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        `${operation}.start must be a non-negative integer or null.`,
        { field: `${operation}.start`, value: input.start },
      );
    }
  }
}

export function executeHeaderFootersPageNumbersGet(
  adapter: HeaderFootersAdapter,
  input: HeaderFootersPageNumbersGetInput,
): HeaderFooterPageNumbersInfo {
  assertPageNumbersInput(input, 'headerFooters.pageNumbers.get');
  return requirePageNumbers(adapter, 'headerFooters.pageNumbers.get').get(input);
}

export function executeHeaderFootersPageNumbersInsert(
  adapter: HeaderFootersAdapter,
  input: HeaderFootersPageNumbersInsertInput,
  options?: MutationOptions,
): HeaderFooterPageNumbersInsertResult {
  assertPageNumbersInput(input, 'headerFooters.pageNumbers.insert');
  assertPageNumbersPlacement(input, 'headerFooters.pageNumbers.insert');
  return requirePageNumbers(adapter, 'headerFooters.pageNumbers.insert').insert(
    input,
    normalizeMutationOptions(options),
  );
}

export function executeHeaderFootersPageNumbersSet(
  adapter: HeaderFootersAdapter,
  input: HeaderFootersPageNumbersSetInput,
  options?: MutationOptions,
): HeaderFooterPageNumbersSetResult {
  assertPageNumbersInput(input, 'headerFooters.pageNumbers.set');
  assertPageNumbersPlacement(input, 'headerFooters.pageNumbers.set');
  return requirePageNumbers(adapter, 'headerFooters.pageNumbers.set').set(input, normalizeMutationOptions(options));
}

export function executeHeaderFootersPageNumbersRemove(
  adapter: HeaderFootersAdapter,
  input: HeaderFootersPageNumbersRemoveInput,
  options?: MutationOptions,
): HeaderFooterPageNumbersRemoveResult {
  assertPageNumbersInput(input, 'headerFooters.pageNumbers.remove');
  if (input.kind !== undefined) {
    assertOneOf(input.kind, 'headerFooters.pageNumbers.remove.kind', HEADER_FOOTER_KINDS);
  }
  return requirePageNumbers(adapter, 'headerFooters.pageNumbers.remove').remove(
    input,
    normalizeMutationOptions(options),
  );
}
