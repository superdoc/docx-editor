/**
 * Content Controls API: interface, adapter, and execute functions.
 *
 * Each public method delegates to an `execute*` function that validates input
 * before calling the adapter. The adapter is implemented by the engine layer.
 */

import type { MutationOptions } from '../write/write.js';
import { DocumentApiValidationError } from '../errors.js';
import { isRecord, isInteger } from '../validation-primitives.js';
import { validateDocumentFragment } from '../validation/fragment-validator.js';
import { isSelectionTarget } from '../validation/selection-target-validator.js';
import { validateStoryLocator } from '../validation/story-validator.js';
import { LOCK_MODES, CONTENT_CONTROL_TYPES, CONTENT_CONTROL_APPEARANCES } from './content-controls.types.js';
import type { NodeKind } from '../types/base.js';
import { NODE_KINDS } from '../types/base.js';
import type {
  ContentControlInfo,
  ContentControlMutationResult,
  ContentControlsListResult,
  ContentControlsListQuery,
  ContentControlsGetInput,
  ContentControlsListInRangeInput,
  ContentControlsSelectByTagInput,
  ContentControlsSelectByTitleInput,
  ContentControlsListChildrenInput,
  ContentControlsGetParentInput,
  ContentControlsWrapInput,
  ContentControlsUnwrapInput,
  ContentControlsDeleteInput,
  ContentControlsCopyInput,
  ContentControlsMoveInput,
  ContentControlsPatchInput,
  ContentControlsSetLockModeInput,
  ContentControlsSetTypeInput,
  ContentControlsGetContentInput,
  ContentControlsGetContentResult,
  ContentControlsReplaceContentInput,
  ContentControlsClearContentInput,
  ContentControlsAppendContentInput,
  ContentControlsPrependContentInput,
  ContentControlsInsertBeforeInput,
  ContentControlsInsertAfterInput,
  ContentControlsGetBindingInput,
  ContentControlBinding,
  ContentControlsSetBindingInput,
  ContentControlsClearBindingInput,
  ContentControlsGetRawPropertiesInput,
  ContentControlsGetRawPropertiesResult,
  ContentControlsPatchRawPropertiesInput,
  ContentControlsValidateWordCompatibilityInput,
  ContentControlsValidateWordCompatibilityResult,
  ContentControlsNormalizeWordCompatibilityInput,
  ContentControlsNormalizeTagPayloadInput,
  ContentControlsTextSetMultilineInput,
  ContentControlsTextSetValueInput,
  ContentControlsTextClearValueInput,
  ContentControlsDateSetValueInput,
  ContentControlsDateClearValueInput,
  ContentControlsDateSetDisplayFormatInput,
  ContentControlsDateSetDisplayLocaleInput,
  ContentControlsDateSetStorageFormatInput,
  ContentControlsDateSetCalendarInput,
  ContentControlsCheckboxGetStateInput,
  ContentControlsCheckboxGetStateResult,
  ContentControlsCheckboxSetStateInput,
  ContentControlsCheckboxToggleInput,
  ContentControlsCheckboxSetSymbolPairInput,
  ContentControlsChoiceListGetItemsInput,
  ContentControlsChoiceListGetItemsResult,
  ContentControlsChoiceListSetItemsInput,
  ContentControlsChoiceListSetSelectedInput,
  ContentControlsRepeatingSectionListItemsInput,
  ContentControlsRepeatingSectionListItemsResult,
  ContentControlsRepeatingSectionInsertItemBeforeInput,
  ContentControlsRepeatingSectionInsertItemAfterInput,
  ContentControlsRepeatingSectionCloneItemInput,
  ContentControlsRepeatingSectionDeleteItemInput,
  ContentControlsRepeatingSectionSetAllowInsertDeleteInput,
  ContentControlsGroupWrapInput,
  ContentControlsGroupUngroupInput,
  ContentControlTarget,
  CreateContentControlInput,
} from './content-controls.types.js';

// ---------------------------------------------------------------------------
// Public API interface
// ---------------------------------------------------------------------------

export interface ContentControlsTextApi {
  setMultiline(input: ContentControlsTextSetMultilineInput, options?: MutationOptions): ContentControlMutationResult;
  setValue(input: ContentControlsTextSetValueInput, options?: MutationOptions): ContentControlMutationResult;
  clearValue(input: ContentControlsTextClearValueInput, options?: MutationOptions): ContentControlMutationResult;
}

export interface ContentControlsDateApi {
  setValue(input: ContentControlsDateSetValueInput, options?: MutationOptions): ContentControlMutationResult;
  clearValue(input: ContentControlsDateClearValueInput, options?: MutationOptions): ContentControlMutationResult;
  setDisplayFormat(
    input: ContentControlsDateSetDisplayFormatInput,
    options?: MutationOptions,
  ): ContentControlMutationResult;
  setDisplayLocale(
    input: ContentControlsDateSetDisplayLocaleInput,
    options?: MutationOptions,
  ): ContentControlMutationResult;
  setStorageFormat(
    input: ContentControlsDateSetStorageFormatInput,
    options?: MutationOptions,
  ): ContentControlMutationResult;
  setCalendar(input: ContentControlsDateSetCalendarInput, options?: MutationOptions): ContentControlMutationResult;
}

export interface ContentControlsCheckboxApi {
  getState(input: ContentControlsCheckboxGetStateInput): ContentControlsCheckboxGetStateResult;
  setState(input: ContentControlsCheckboxSetStateInput, options?: MutationOptions): ContentControlMutationResult;
  toggle(input: ContentControlsCheckboxToggleInput, options?: MutationOptions): ContentControlMutationResult;
  setSymbolPair(
    input: ContentControlsCheckboxSetSymbolPairInput,
    options?: MutationOptions,
  ): ContentControlMutationResult;
}

export interface ContentControlsChoiceListApi {
  getItems(input: ContentControlsChoiceListGetItemsInput): ContentControlsChoiceListGetItemsResult;
  setItems(input: ContentControlsChoiceListSetItemsInput, options?: MutationOptions): ContentControlMutationResult;
  setSelected(
    input: ContentControlsChoiceListSetSelectedInput,
    options?: MutationOptions,
  ): ContentControlMutationResult;
}

export interface ContentControlsRepeatingSectionApi {
  listItems(input: ContentControlsRepeatingSectionListItemsInput): ContentControlsRepeatingSectionListItemsResult;
  insertItemBefore(
    input: ContentControlsRepeatingSectionInsertItemBeforeInput,
    options?: MutationOptions,
  ): ContentControlMutationResult;
  insertItemAfter(
    input: ContentControlsRepeatingSectionInsertItemAfterInput,
    options?: MutationOptions,
  ): ContentControlMutationResult;
  cloneItem(
    input: ContentControlsRepeatingSectionCloneItemInput,
    options?: MutationOptions,
  ): ContentControlMutationResult;
  deleteItem(
    input: ContentControlsRepeatingSectionDeleteItemInput,
    options?: MutationOptions,
  ): ContentControlMutationResult;
  setAllowInsertDelete(
    input: ContentControlsRepeatingSectionSetAllowInsertDeleteInput,
    options?: MutationOptions,
  ): ContentControlMutationResult;
}

export interface ContentControlsGroupApi {
  wrap(input: ContentControlsGroupWrapInput, options?: MutationOptions): ContentControlMutationResult;
  ungroup(input: ContentControlsGroupUngroupInput, options?: MutationOptions): ContentControlMutationResult;
}

export interface ContentControlsApi {
  // A. Core CRUD + Discovery
  list(query?: ContentControlsListQuery): ContentControlsListResult;
  get(input: ContentControlsGetInput): ContentControlInfo;
  listInRange(input: ContentControlsListInRangeInput): ContentControlsListResult;
  selectByTag(input: ContentControlsSelectByTagInput): ContentControlsListResult;
  selectByTitle(input: ContentControlsSelectByTitleInput): ContentControlsListResult;
  listChildren(input: ContentControlsListChildrenInput): ContentControlsListResult;
  getParent(input: ContentControlsGetParentInput): ContentControlInfo | null;
  wrap(input: ContentControlsWrapInput, options?: MutationOptions): ContentControlMutationResult;
  unwrap(input: ContentControlsUnwrapInput, options?: MutationOptions): ContentControlMutationResult;
  delete(input: ContentControlsDeleteInput, options?: MutationOptions): ContentControlMutationResult;
  copy(input: ContentControlsCopyInput, options?: MutationOptions): ContentControlMutationResult;
  move(input: ContentControlsMoveInput, options?: MutationOptions): ContentControlMutationResult;
  patch(input: ContentControlsPatchInput, options?: MutationOptions): ContentControlMutationResult;
  setLockMode(input: ContentControlsSetLockModeInput, options?: MutationOptions): ContentControlMutationResult;
  setType(input: ContentControlsSetTypeInput, options?: MutationOptions): ContentControlMutationResult;
  getContent(input: ContentControlsGetContentInput): ContentControlsGetContentResult;
  replaceContent(input: ContentControlsReplaceContentInput, options?: MutationOptions): ContentControlMutationResult;
  clearContent(input: ContentControlsClearContentInput, options?: MutationOptions): ContentControlMutationResult;
  appendContent(input: ContentControlsAppendContentInput, options?: MutationOptions): ContentControlMutationResult;
  prependContent(input: ContentControlsPrependContentInput, options?: MutationOptions): ContentControlMutationResult;
  insertBefore(input: ContentControlsInsertBeforeInput, options?: MutationOptions): ContentControlMutationResult;
  insertAfter(input: ContentControlsInsertAfterInput, options?: MutationOptions): ContentControlMutationResult;

  // B. Data Binding + Raw/Compatibility
  getBinding(input: ContentControlsGetBindingInput): ContentControlBinding | null;
  setBinding(input: ContentControlsSetBindingInput, options?: MutationOptions): ContentControlMutationResult;
  clearBinding(input: ContentControlsClearBindingInput, options?: MutationOptions): ContentControlMutationResult;
  getRawProperties(input: ContentControlsGetRawPropertiesInput): ContentControlsGetRawPropertiesResult;
  patchRawProperties(
    input: ContentControlsPatchRawPropertiesInput,
    options?: MutationOptions,
  ): ContentControlMutationResult;
  validateWordCompatibility(
    input: ContentControlsValidateWordCompatibilityInput,
  ): ContentControlsValidateWordCompatibilityResult;
  normalizeWordCompatibility(
    input: ContentControlsNormalizeWordCompatibilityInput,
    options?: MutationOptions,
  ): ContentControlMutationResult;
  normalizeTagPayload(
    input: ContentControlsNormalizeTagPayloadInput,
    options?: MutationOptions,
  ): ContentControlMutationResult;

  // C. Typed Controls (nested sub-APIs)
  text: ContentControlsTextApi;
  date: ContentControlsDateApi;
  checkbox: ContentControlsCheckboxApi;
  choiceList: ContentControlsChoiceListApi;

  // D. Repeating Section + Group (nested sub-APIs)
  repeatingSection: ContentControlsRepeatingSectionApi;
  group: ContentControlsGroupApi;
}

// ---------------------------------------------------------------------------
// Adapter interface: implemented by the engine layer
// ---------------------------------------------------------------------------

export type ContentControlsAdapter = ContentControlsApi;

// ---------------------------------------------------------------------------
// Shared validation helpers
// ---------------------------------------------------------------------------

const VALID_NODE_KINDS: ReadonlySet<string> = new Set(NODE_KINDS);
const VALID_LOCK_MODES: ReadonlySet<string> = new Set(LOCK_MODES);
const VALID_CC_TYPES: ReadonlySet<string> = new Set(CONTENT_CONTROL_TYPES);
const VALID_CC_APPEARANCES: ReadonlySet<string> = new Set(CONTENT_CONTROL_APPEARANCES);
const VALID_CONTENT_FORMATS: ReadonlySet<string> = new Set(['text', 'html']);

function validateCCInput(input: unknown, operationName: string): asserts input is Record<string, unknown> {
  if (!isRecord(input)) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${operationName} input must be a non-null object.`);
  }
}

function validateCCTarget(target: unknown, operationName: string): asserts target is ContentControlTarget {
  if (!isRecord(target)) {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `${operationName} requires a valid target with { kind, nodeType: 'sdt', nodeId }.`,
      { field: 'target', value: target },
    );
  }
  if (!VALID_NODE_KINDS.has(target.kind as string)) {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `${operationName} target.kind must be 'block' or 'inline', got "${String(target.kind)}".`,
      { field: 'target.kind', value: target.kind },
    );
  }
  if (target.nodeType !== 'sdt') {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `${operationName} target.nodeType must be 'sdt', got "${String(target.nodeType)}".`,
      { field: 'target.nodeType', value: target.nodeType },
    );
  }
  if (typeof target.nodeId !== 'string' || target.nodeId === '') {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `${operationName} target.nodeId must be a non-empty string.`,
      { field: 'target.nodeId', value: target.nodeId },
    );
  }
  validateStoryLocator(target.story, `${operationName}.target.story`);
}

function validateCCMoveDestination(destination: unknown): void {
  if (!isRecord(destination)) {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      "contentControls.move (destination) requires a valid destination: an SDT target, { kind: 'documentStart' }, { kind: 'documentEnd' }, { kind: 'before', target }, or { kind: 'after', target }.",
      { field: 'destination', value: destination },
    );
  }
  if (destination.kind === 'documentStart' || destination.kind === 'documentEnd') return;
  if (destination.kind === 'before' || destination.kind === 'after') {
    validateCCTarget(destination.target, `contentControls.move (destination.${destination.kind})`);
    return;
  }
  if (destination.kind === 'inParagraph') {
    const target = destination.target;
    if (!isRecord(target) || typeof target.nodeId !== 'string' || target.nodeId === '') {
      throw new DocumentApiValidationError(
        'INVALID_TARGET',
        'contentControls.move (destination.inParagraph) requires a target with a non-empty nodeId.',
        { field: 'destination.target', value: target },
      );
    }
    if (
      destination.offset !== undefined &&
      (typeof destination.offset !== 'number' || !Number.isInteger(destination.offset) || destination.offset < 0)
    ) {
      throw new DocumentApiValidationError(
        'INVALID_TARGET',
        'contentControls.move (destination.inParagraph) offset must be a non-negative integer.',
        { field: 'destination.offset', value: destination.offset },
      );
    }
    return;
  }
  validateCCTarget(destination, 'contentControls.move (destination)');
}

function requireString(value: unknown, field: string, operationName: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${operationName} ${field} must be a non-empty string.`, {
      field,
      value,
    });
  }
}

function requireBoolean(value: unknown, field: string, operationName: string): void {
  if (typeof value !== 'boolean') {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operationName} ${field} must be a boolean, got ${typeof value}.`,
      { field, value },
    );
  }
}

function requireIndex(value: unknown, field: string, operationName: string): void {
  if (!isInteger(value) || (value as number) < 0) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${operationName} ${field} must be a non-negative integer.`, {
      field,
      value,
    });
  }
}

function requireNodeKind(value: unknown, field: string, operationName: string): asserts value is NodeKind {
  if (!VALID_NODE_KINDS.has(value as string)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operationName} ${field} must be 'block' or 'inline', got "${String(value)}".`,
      { field, value },
    );
  }
}

function validateContentFormat(value: unknown, field: string, operationName: string): void {
  if (value !== undefined && !VALID_CONTENT_FORMATS.has(value as string)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operationName} ${field} must be 'text' or 'html', got "${String(value)}".`,
      { field, value },
    );
  }
}

function validateContentPayload(input: { content?: unknown; format?: unknown }, operationName: string): void {
  if (typeof input.content !== 'string') {
    throw new DocumentApiValidationError('INVALID_INPUT', `${operationName} content must be a string.`, {
      field: 'content',
      value: input.content,
    });
  }
  if (!(operationName === 'contentControls.replaceContent' && input.format === 'ooxml')) {
    validateContentFormat(input.format, 'format', operationName);
  }
}

function validateSymbol(value: unknown, field: string, operationName: string): void {
  if (!isRecord(value) || typeof value.font !== 'string' || typeof value.char !== 'string') {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operationName} ${field} must be { font: string, char: string }.`,
      { field, value },
    );
  }
}

// ---------------------------------------------------------------------------
// Execute functions: validation + delegation
// ---------------------------------------------------------------------------

export function executeContentControlsList(
  adapter: ContentControlsAdapter,
  query?: ContentControlsListQuery,
): ContentControlsListResult {
  if (query !== undefined && !isRecord(query)) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'contentControls.list query must be an object if provided.');
  }
  return adapter.list(query);
}

export function executeContentControlsGet(
  adapter: ContentControlsAdapter,
  input: ContentControlsGetInput,
): ContentControlInfo {
  validateCCInput(input, 'contentControls.get');
  validateCCTarget(input.target, 'contentControls.get');
  return adapter.get(input);
}

export function executeContentControlsListInRange(
  adapter: ContentControlsAdapter,
  input: ContentControlsListInRangeInput,
): ContentControlsListResult {
  validateCCInput(input, 'contentControls.listInRange');
  requireString(input.startBlockId, 'startBlockId', 'contentControls.listInRange');
  requireString(input.endBlockId, 'endBlockId', 'contentControls.listInRange');
  return adapter.listInRange(input);
}

export function executeContentControlsSelectByTag(
  adapter: ContentControlsAdapter,
  input: ContentControlsSelectByTagInput,
): ContentControlsListResult {
  validateCCInput(input, 'contentControls.selectByTag');
  requireString(input.tag, 'tag', 'contentControls.selectByTag');
  return adapter.selectByTag(input);
}

export function executeContentControlsSelectByTitle(
  adapter: ContentControlsAdapter,
  input: ContentControlsSelectByTitleInput,
): ContentControlsListResult {
  validateCCInput(input, 'contentControls.selectByTitle');
  requireString(input.title, 'title', 'contentControls.selectByTitle');
  return adapter.selectByTitle(input);
}

export function executeContentControlsListChildren(
  adapter: ContentControlsAdapter,
  input: ContentControlsListChildrenInput,
): ContentControlsListResult {
  validateCCInput(input, 'contentControls.listChildren');
  validateCCTarget(input.target, 'contentControls.listChildren');
  return adapter.listChildren(input);
}

export function executeContentControlsGetParent(
  adapter: ContentControlsAdapter,
  input: ContentControlsGetParentInput,
): ContentControlInfo | null {
  validateCCInput(input, 'contentControls.getParent');
  validateCCTarget(input.target, 'contentControls.getParent');
  return adapter.getParent(input);
}

export function executeContentControlsWrap(
  adapter: ContentControlsAdapter,
  input: ContentControlsWrapInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.wrap');
  requireNodeKind(input.kind, 'kind', 'contentControls.wrap');
  validateCCTarget(input.target, 'contentControls.wrap');
  return adapter.wrap(input, options);
}

export function executeContentControlsUnwrap(
  adapter: ContentControlsAdapter,
  input: ContentControlsUnwrapInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.unwrap');
  validateCCTarget(input.target, 'contentControls.unwrap');
  return adapter.unwrap(input, options);
}

export function executeContentControlsDelete(
  adapter: ContentControlsAdapter,
  input: ContentControlsDeleteInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.delete');
  validateCCTarget(input.target, 'contentControls.delete');
  return adapter.delete(input, options);
}

export function executeContentControlsCopy(
  adapter: ContentControlsAdapter,
  input: ContentControlsCopyInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.copy');
  validateCCTarget(input.target, 'contentControls.copy');
  validateCCTarget(input.destination, 'contentControls.copy (destination)');
  return adapter.copy(input, options);
}

export function executeContentControlsMove(
  adapter: ContentControlsAdapter,
  input: ContentControlsMoveInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.move');
  validateCCTarget(input.target, 'contentControls.move');
  validateCCMoveDestination(input.destination);
  return adapter.move(input, options);
}

export function executeContentControlsPatch(
  adapter: ContentControlsAdapter,
  input: ContentControlsPatchInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.patch');
  validateCCTarget(input.target, 'contentControls.patch');
  if (
    input.appearance !== undefined &&
    input.appearance !== null &&
    !VALID_CC_APPEARANCES.has(input.appearance as string)
  ) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `contentControls.patch appearance must be one of: ${[...VALID_CC_APPEARANCES].join(', ')}.`,
      { field: 'appearance', value: input.appearance },
    );
  }
  if (input.showingPlaceholder !== undefined && typeof input.showingPlaceholder !== 'boolean') {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `contentControls.patch showingPlaceholder must be a boolean, got ${typeof input.showingPlaceholder}.`,
      { field: 'showingPlaceholder', value: input.showingPlaceholder },
    );
  }
  if (input.temporary !== undefined && typeof input.temporary !== 'boolean') {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `contentControls.patch temporary must be a boolean, got ${typeof input.temporary}.`,
      { field: 'temporary', value: input.temporary },
    );
  }
  if (input.tabIndex !== undefined && input.tabIndex !== null && !isInteger(input.tabIndex)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `contentControls.patch tabIndex must be an integer or null, got ${typeof input.tabIndex}.`,
      { field: 'tabIndex', value: input.tabIndex },
    );
  }
  return adapter.patch(input, options);
}

export function executeContentControlsSetLockMode(
  adapter: ContentControlsAdapter,
  input: ContentControlsSetLockModeInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.setLockMode');
  validateCCTarget(input.target, 'contentControls.setLockMode');
  if (!VALID_LOCK_MODES.has(input.lockMode as string)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `contentControls.setLockMode lockMode must be one of: ${[...VALID_LOCK_MODES].join(', ')}.`,
      { field: 'lockMode', value: input.lockMode },
    );
  }
  return adapter.setLockMode(input, options);
}

export function executeContentControlsSetType(
  adapter: ContentControlsAdapter,
  input: ContentControlsSetTypeInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.setType');
  validateCCTarget(input.target, 'contentControls.setType');
  if (!VALID_CC_TYPES.has(input.controlType as string)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `contentControls.setType controlType must be one of: ${[...VALID_CC_TYPES].join(', ')}.`,
      { field: 'controlType', value: input.controlType },
    );
  }
  return adapter.setType(input, options);
}

export function executeContentControlsGetContent(
  adapter: ContentControlsAdapter,
  input: ContentControlsGetContentInput,
): ContentControlsGetContentResult {
  validateCCInput(input, 'contentControls.getContent');
  validateCCTarget(input.target, 'contentControls.getContent');
  return adapter.getContent(input);
}

export function executeContentControlsReplaceContent(
  adapter: ContentControlsAdapter,
  input: ContentControlsReplaceContentInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.replaceContent');
  validateCCTarget(input.target, 'contentControls.replaceContent');
  validateContentPayload(input, 'contentControls.replaceContent');
  return adapter.replaceContent(input, options);
}

export function executeContentControlsClearContent(
  adapter: ContentControlsAdapter,
  input: ContentControlsClearContentInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.clearContent');
  validateCCTarget(input.target, 'contentControls.clearContent');
  return adapter.clearContent(input, options);
}

export function executeContentControlsAppendContent(
  adapter: ContentControlsAdapter,
  input: ContentControlsAppendContentInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.appendContent');
  validateCCTarget(input.target, 'contentControls.appendContent');
  validateContentPayload(input, 'contentControls.appendContent');
  return adapter.appendContent(input, options);
}

export function executeContentControlsPrependContent(
  adapter: ContentControlsAdapter,
  input: ContentControlsPrependContentInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.prependContent');
  validateCCTarget(input.target, 'contentControls.prependContent');
  validateContentPayload(input, 'contentControls.prependContent');
  return adapter.prependContent(input, options);
}

export function executeContentControlsInsertBefore(
  adapter: ContentControlsAdapter,
  input: ContentControlsInsertBeforeInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.insertBefore');
  validateCCTarget(input.target, 'contentControls.insertBefore');
  validateContentPayload(input, 'contentControls.insertBefore');
  return adapter.insertBefore(input, options);
}

export function executeContentControlsInsertAfter(
  adapter: ContentControlsAdapter,
  input: ContentControlsInsertAfterInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.insertAfter');
  validateCCTarget(input.target, 'contentControls.insertAfter');
  validateContentPayload(input, 'contentControls.insertAfter');
  return adapter.insertAfter(input, options);
}

export function executeContentControlsGetBinding(
  adapter: ContentControlsAdapter,
  input: ContentControlsGetBindingInput,
): ContentControlBinding | null {
  validateCCInput(input, 'contentControls.getBinding');
  validateCCTarget(input.target, 'contentControls.getBinding');
  return adapter.getBinding(input);
}

export function executeContentControlsSetBinding(
  adapter: ContentControlsAdapter,
  input: ContentControlsSetBindingInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.setBinding');
  validateCCTarget(input.target, 'contentControls.setBinding');
  requireString(input.storeItemId, 'storeItemId', 'contentControls.setBinding');
  requireString(input.xpath, 'xpath', 'contentControls.setBinding');
  return adapter.setBinding(input, options);
}

export function executeContentControlsClearBinding(
  adapter: ContentControlsAdapter,
  input: ContentControlsClearBindingInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.clearBinding');
  validateCCTarget(input.target, 'contentControls.clearBinding');
  return adapter.clearBinding(input, options);
}

export function executeContentControlsGetRawProperties(
  adapter: ContentControlsAdapter,
  input: ContentControlsGetRawPropertiesInput,
): ContentControlsGetRawPropertiesResult {
  validateCCInput(input, 'contentControls.getRawProperties');
  validateCCTarget(input.target, 'contentControls.getRawProperties');
  return adapter.getRawProperties(input);
}

const VALID_RAW_PATCH_OPS: ReadonlySet<string> = new Set(['set', 'remove', 'setAttr', 'removeAttr']);

export function executeContentControlsPatchRawProperties(
  adapter: ContentControlsAdapter,
  input: ContentControlsPatchRawPropertiesInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.patchRawProperties');
  validateCCTarget(input.target, 'contentControls.patchRawProperties');
  if (!Array.isArray(input.patches)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      'contentControls.patchRawProperties patches must be an array.',
      { field: 'patches', value: input.patches },
    );
  }
  for (let i = 0; i < input.patches.length; i++) {
    const patch = input.patches[i];
    if (!isRecord(patch)) {
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        `contentControls.patchRawProperties patches[${i}] must be an object.`,
        { field: `patches[${i}]`, value: patch },
      );
    }
    if (!VALID_RAW_PATCH_OPS.has(patch.op as string)) {
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        `contentControls.patchRawProperties patches[${i}].op must be one of: ${[...VALID_RAW_PATCH_OPS].join(', ')}.`,
        { field: `patches[${i}].op`, value: patch.op },
      );
    }
    if (typeof patch.name !== 'string' || patch.name === '') {
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        `contentControls.patchRawProperties patches[${i}].name must be a non-empty string.`,
        { field: `patches[${i}].name`, value: patch.name },
      );
    }
  }
  return adapter.patchRawProperties(input, options);
}

export function executeContentControlsValidateWordCompatibility(
  adapter: ContentControlsAdapter,
  input: ContentControlsValidateWordCompatibilityInput,
): ContentControlsValidateWordCompatibilityResult {
  validateCCInput(input, 'contentControls.validateWordCompatibility');
  validateCCTarget(input.target, 'contentControls.validateWordCompatibility');
  return adapter.validateWordCompatibility(input);
}

export function executeContentControlsNormalizeWordCompatibility(
  adapter: ContentControlsAdapter,
  input: ContentControlsNormalizeWordCompatibilityInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.normalizeWordCompatibility');
  validateCCTarget(input.target, 'contentControls.normalizeWordCompatibility');
  return adapter.normalizeWordCompatibility(input, options);
}

export function executeContentControlsNormalizeTagPayload(
  adapter: ContentControlsAdapter,
  input: ContentControlsNormalizeTagPayloadInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.normalizeTagPayload');
  validateCCTarget(input.target, 'contentControls.normalizeTagPayload');
  return adapter.normalizeTagPayload(input, options);
}

// Typed controls: Text
export function executeContentControlsTextSetMultiline(
  adapter: ContentControlsAdapter,
  input: ContentControlsTextSetMultilineInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.text.setMultiline');
  validateCCTarget(input.target, 'contentControls.text.setMultiline');
  requireBoolean(input.multiline, 'multiline', 'contentControls.text.setMultiline');
  return adapter.text.setMultiline(input, options);
}

export function executeContentControlsTextSetValue(
  adapter: ContentControlsAdapter,
  input: ContentControlsTextSetValueInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.text.setValue');
  validateCCTarget(input.target, 'contentControls.text.setValue');
  if (typeof input.value !== 'string') {
    throw new DocumentApiValidationError('INVALID_INPUT', `contentControls.text.setValue value must be a string.`, {
      field: 'value',
      value: input.value,
    });
  }
  return adapter.text.setValue(input, options);
}

export function executeContentControlsTextClearValue(
  adapter: ContentControlsAdapter,
  input: ContentControlsTextClearValueInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.text.clearValue');
  validateCCTarget(input.target, 'contentControls.text.clearValue');
  return adapter.text.clearValue(input, options);
}

// Typed controls: Date
export function executeContentControlsDateSetValue(
  adapter: ContentControlsAdapter,
  input: ContentControlsDateSetValueInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.date.setValue');
  validateCCTarget(input.target, 'contentControls.date.setValue');
  if (typeof input.value !== 'string') {
    throw new DocumentApiValidationError('INVALID_INPUT', `contentControls.date.setValue value must be a string.`, {
      field: 'value',
      value: input.value,
    });
  }
  return adapter.date.setValue(input, options);
}

export function executeContentControlsDateClearValue(
  adapter: ContentControlsAdapter,
  input: ContentControlsDateClearValueInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.date.clearValue');
  validateCCTarget(input.target, 'contentControls.date.clearValue');
  return adapter.date.clearValue(input, options);
}

export function executeContentControlsDateSetDisplayFormat(
  adapter: ContentControlsAdapter,
  input: ContentControlsDateSetDisplayFormatInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.date.setDisplayFormat');
  validateCCTarget(input.target, 'contentControls.date.setDisplayFormat');
  requireString(input.format, 'format', 'contentControls.date.setDisplayFormat');
  return adapter.date.setDisplayFormat(input, options);
}

export function executeContentControlsDateSetDisplayLocale(
  adapter: ContentControlsAdapter,
  input: ContentControlsDateSetDisplayLocaleInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.date.setDisplayLocale');
  validateCCTarget(input.target, 'contentControls.date.setDisplayLocale');
  requireString(input.locale, 'locale', 'contentControls.date.setDisplayLocale');
  return adapter.date.setDisplayLocale(input, options);
}

export function executeContentControlsDateSetStorageFormat(
  adapter: ContentControlsAdapter,
  input: ContentControlsDateSetStorageFormatInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.date.setStorageFormat');
  validateCCTarget(input.target, 'contentControls.date.setStorageFormat');
  requireString(input.format, 'format', 'contentControls.date.setStorageFormat');
  return adapter.date.setStorageFormat(input, options);
}

export function executeContentControlsDateSetCalendar(
  adapter: ContentControlsAdapter,
  input: ContentControlsDateSetCalendarInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.date.setCalendar');
  validateCCTarget(input.target, 'contentControls.date.setCalendar');
  requireString(input.calendar, 'calendar', 'contentControls.date.setCalendar');
  return adapter.date.setCalendar(input, options);
}

// Typed controls: Checkbox
export function executeContentControlsCheckboxGetState(
  adapter: ContentControlsAdapter,
  input: ContentControlsCheckboxGetStateInput,
): ContentControlsCheckboxGetStateResult {
  validateCCInput(input, 'contentControls.checkbox.getState');
  validateCCTarget(input.target, 'contentControls.checkbox.getState');
  return adapter.checkbox.getState(input);
}

export function executeContentControlsCheckboxSetState(
  adapter: ContentControlsAdapter,
  input: ContentControlsCheckboxSetStateInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.checkbox.setState');
  validateCCTarget(input.target, 'contentControls.checkbox.setState');
  requireBoolean(input.checked, 'checked', 'contentControls.checkbox.setState');
  return adapter.checkbox.setState(input, options);
}

export function executeContentControlsCheckboxToggle(
  adapter: ContentControlsAdapter,
  input: ContentControlsCheckboxToggleInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.checkbox.toggle');
  validateCCTarget(input.target, 'contentControls.checkbox.toggle');
  return adapter.checkbox.toggle(input, options);
}

export function executeContentControlsCheckboxSetSymbolPair(
  adapter: ContentControlsAdapter,
  input: ContentControlsCheckboxSetSymbolPairInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.checkbox.setSymbolPair');
  validateCCTarget(input.target, 'contentControls.checkbox.setSymbolPair');
  validateSymbol(input.checkedSymbol, 'checkedSymbol', 'contentControls.checkbox.setSymbolPair');
  validateSymbol(input.uncheckedSymbol, 'uncheckedSymbol', 'contentControls.checkbox.setSymbolPair');
  return adapter.checkbox.setSymbolPair(input, options);
}

// Typed controls: Choice List
export function executeContentControlsChoiceListGetItems(
  adapter: ContentControlsAdapter,
  input: ContentControlsChoiceListGetItemsInput,
): ContentControlsChoiceListGetItemsResult {
  validateCCInput(input, 'contentControls.choiceList.getItems');
  validateCCTarget(input.target, 'contentControls.choiceList.getItems');
  return adapter.choiceList.getItems(input);
}

export function executeContentControlsChoiceListSetItems(
  adapter: ContentControlsAdapter,
  input: ContentControlsChoiceListSetItemsInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.choiceList.setItems');
  validateCCTarget(input.target, 'contentControls.choiceList.setItems');
  if (!Array.isArray(input.items)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      'contentControls.choiceList.setItems items must be an array.',
      { field: 'items', value: input.items },
    );
  }
  for (let i = 0; i < input.items.length; i++) {
    const item = input.items[i];
    if (!isRecord(item) || typeof item.displayText !== 'string' || typeof item.value !== 'string') {
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        `contentControls.choiceList.setItems items[${i}] must be { displayText: string, value: string }.`,
        { field: `items[${i}]`, value: item },
      );
    }
  }
  return adapter.choiceList.setItems(input, options);
}

export function executeContentControlsChoiceListSetSelected(
  adapter: ContentControlsAdapter,
  input: ContentControlsChoiceListSetSelectedInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.choiceList.setSelected');
  validateCCTarget(input.target, 'contentControls.choiceList.setSelected');
  if (typeof input.value !== 'string') {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      'contentControls.choiceList.setSelected value must be a string.',
      { field: 'value', value: input.value },
    );
  }
  return adapter.choiceList.setSelected(input, options);
}

// Typed controls: Repeating Section
export function executeContentControlsRepeatingSectionListItems(
  adapter: ContentControlsAdapter,
  input: ContentControlsRepeatingSectionListItemsInput,
): ContentControlsRepeatingSectionListItemsResult {
  validateCCInput(input, 'contentControls.repeatingSection.listItems');
  validateCCTarget(input.target, 'contentControls.repeatingSection.listItems');
  return adapter.repeatingSection.listItems(input);
}

export function executeContentControlsRepeatingSectionInsertItemBefore(
  adapter: ContentControlsAdapter,
  input: ContentControlsRepeatingSectionInsertItemBeforeInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.repeatingSection.insertItemBefore');
  validateCCTarget(input.target, 'contentControls.repeatingSection.insertItemBefore');
  requireIndex(input.index, 'index', 'contentControls.repeatingSection.insertItemBefore');
  return adapter.repeatingSection.insertItemBefore(input, options);
}

export function executeContentControlsRepeatingSectionInsertItemAfter(
  adapter: ContentControlsAdapter,
  input: ContentControlsRepeatingSectionInsertItemAfterInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.repeatingSection.insertItemAfter');
  validateCCTarget(input.target, 'contentControls.repeatingSection.insertItemAfter');
  requireIndex(input.index, 'index', 'contentControls.repeatingSection.insertItemAfter');
  return adapter.repeatingSection.insertItemAfter(input, options);
}

export function executeContentControlsRepeatingSectionCloneItem(
  adapter: ContentControlsAdapter,
  input: ContentControlsRepeatingSectionCloneItemInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.repeatingSection.cloneItem');
  validateCCTarget(input.target, 'contentControls.repeatingSection.cloneItem');
  requireIndex(input.index, 'index', 'contentControls.repeatingSection.cloneItem');
  return adapter.repeatingSection.cloneItem(input, options);
}

export function executeContentControlsRepeatingSectionDeleteItem(
  adapter: ContentControlsAdapter,
  input: ContentControlsRepeatingSectionDeleteItemInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.repeatingSection.deleteItem');
  validateCCTarget(input.target, 'contentControls.repeatingSection.deleteItem');
  requireIndex(input.index, 'index', 'contentControls.repeatingSection.deleteItem');
  return adapter.repeatingSection.deleteItem(input, options);
}

export function executeContentControlsRepeatingSectionSetAllowInsertDelete(
  adapter: ContentControlsAdapter,
  input: ContentControlsRepeatingSectionSetAllowInsertDeleteInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.repeatingSection.setAllowInsertDelete');
  validateCCTarget(input.target, 'contentControls.repeatingSection.setAllowInsertDelete');
  requireBoolean(input.allow, 'allow', 'contentControls.repeatingSection.setAllowInsertDelete');
  return adapter.repeatingSection.setAllowInsertDelete(input, options);
}

// Typed controls: Group
export function executeContentControlsGroupWrap(
  adapter: ContentControlsAdapter,
  input: ContentControlsGroupWrapInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.group.wrap');
  validateCCTarget(input.target, 'contentControls.group.wrap');
  return adapter.group.wrap(input, options);
}

export function executeContentControlsGroupUngroup(
  adapter: ContentControlsAdapter,
  input: ContentControlsGroupUngroupInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'contentControls.group.ungroup');
  validateCCTarget(input.target, 'contentControls.group.ungroup');
  return adapter.group.ungroup(input, options);
}

// Create (lives under create.* namespace, not contentControls.*)
export function executeCreateContentControl(
  adapter: ContentControlsCreateAdapter,
  input: CreateContentControlInput,
  options?: MutationOptions,
): ContentControlMutationResult {
  validateCCInput(input, 'create.contentControl');
  requireNodeKind(input.kind, 'kind', 'create.contentControl');
  if (input.controlType !== undefined && !VALID_CC_TYPES.has(input.controlType as string)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `create.contentControl controlType must be one of: ${[...VALID_CC_TYPES].join(', ')}.`,
      { field: 'controlType', value: input.controlType },
    );
  }
  if (input.lockMode !== undefined && !VALID_LOCK_MODES.has(input.lockMode as string)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `create.contentControl lockMode must be one of: ${[...VALID_LOCK_MODES].join(', ')}.`,
      { field: 'lockMode', value: input.lockMode },
    );
  }
  if (input.at !== undefined && input.target !== undefined) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `create.contentControl: "at" and "target" are mutually exclusive: provide one or neither.`,
      { field: 'at' },
    );
  }
  if (input.target !== undefined) {
    validateCCTarget(input.target, 'create.contentControl');
  }
  if (input.at !== undefined && !isSelectionTarget(input.at)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `create.contentControl: "at" must be a valid SelectionTarget with kind "selection", start, and end.`,
      { field: 'at', value: input.at },
    );
  }
  if (input.content !== undefined && typeof input.content !== 'string') {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `create.contentControl content must be a string, got ${typeof input.content}.`,
      { field: 'content', value: input.content },
    );
  }
  if (input.html !== undefined && typeof input.html !== 'string') {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `create.contentControl html must be a string, got ${typeof input.html}.`,
      { field: 'html', value: input.html },
    );
  }
  if (input.content !== undefined && input.html !== undefined) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `create.contentControl content and html are mutually exclusive.`,
      { fields: ['content', 'html'] },
    );
  }
  if (input.content !== undefined && input.json !== undefined) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `create.contentControl content and json are mutually exclusive.`,
      { fields: ['content', 'json'] },
    );
  }
  if (input.html !== undefined && input.json !== undefined) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `create.contentControl html and json are mutually exclusive.`,
      { fields: ['html', 'json'] },
    );
  }
  if ((input.html !== undefined || input.json !== undefined) && input.kind !== 'block') {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `create.contentControl html/json presets are supported only for block content controls.`,
      { field: 'kind', value: input.kind },
    );
  }
  if (input.json !== undefined) {
    try {
      validateDocumentFragment(input.json);
    } catch (error) {
      if (error instanceof DocumentApiValidationError) throw error;
      throw new DocumentApiValidationError(
        'INVALID_PAYLOAD',
        `create.contentControl json must be a valid document fragment.`,
        { field: 'json', value: input.json },
      );
    }
  }
  return adapter.create(input, options);
}

/** Adapter extension for create.contentControl. */
export interface ContentControlsCreateAdapter {
  create(input: CreateContentControlInput, options?: MutationOptions): ContentControlMutationResult;
}
