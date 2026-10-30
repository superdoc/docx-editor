import type { MutationOptions } from '../write/write.js';
import { normalizeMutationOptions } from '../write/write.js';
import { DocumentApiValidationError } from '../errors.js';
import { isInteger } from '../validation-primitives.js';
import { isRecord } from '../object-guards.js';
import { BLOCK_NODE_TYPES } from '../types/base.js';
import {
  LIST_KINDS,
  LIST_INSERT_POSITIONS,
  JOIN_DIRECTIONS,
  MUTATION_SCOPES,
  LEVEL_ALIGNMENTS,
  TRAILING_CHARACTERS,
  LIST_PRESET_IDS,
} from './lists.types.js';
import type {
  ListInsertInput,
  ListsGetInput,
  ListsInsertResult,
  ListsListQuery,
  ListsListResult,
  ListsMutateItemResult,
  ListTargetInput,
  ListItemInfo,
  ListsCreateInput,
  ListsCreateResult,
  ListsAttachInput,
  ListsDetachInput,
  ListsDetachResult,
  ListsDeleteInput,
  ListsDeleteResult,
  ListsJoinInput,
  ListsJoinResult,
  ListsCanJoinInput,
  ListsCanJoinResult,
  ListsSeparateInput,
  ListsSeparateResult,
  ListsMergeInput,
  ListsMergeResult,
  ListsSplitInput,
  ListsSplitResult,
  ListsSetLevelInput,
  ListsSetValueInput,
  ListsContinuePreviousInput,
  ListsCanContinuePreviousInput,
  ListsCanContinuePreviousResult,
  ListsSetLevelRestartInput,
  ListsConvertToTextInput,
  ListsConvertToTextResult,
  ListsApplyTemplateInput,
  ListsApplyPresetInput,
  ListsCaptureTemplateInput,
  ListsCaptureTemplateResult,
  ListsSetLevelNumberingInput,
  ListsSetLevelBulletInput,
  ListsSetLevelPictureBulletInput,
  ListsSetLevelAlignmentInput,
  ListsSetLevelIndentsInput,
  ListsSetLevelTrailingCharacterInput,
  ListsSetLevelMarkerFontInput,
  ListsClearLevelOverridesInput,
  ListsSetTypeInput,
  ListsGetStyleInput,
  ListsGetStyleResult,
  ListsApplyStyleInput,
  ListsRestartAtInput,
  ListsSetLevelNumberStyleInput,
  ListsSetLevelTextInput,
  ListsSetLevelStartInput,
  ListsSetLevelLayoutInput,
  ListsGetStateInput,
  ListsGetStateResult,
  ListsApplyInput,
  ListsContinueV2Input,
  ListsRestartV2Input,
  ListsRemoveV2Input,
} from './lists.types.js';
export type {
  ListInsertInput,
  ListsGetInput,
  ListsInsertResult,
  ListsListQuery,
  ListsListResult,
  ListsMutateItemResult,
  ListTargetInput,
  ListItemInfo,
  ListsCreateInput,
  ListsCreateResult,
  ListsAttachInput,
  ListsDetachInput,
  ListsDetachResult,
  ListsDeleteInput,
  ListsDeleteResult,
  ListsJoinInput,
  ListsJoinResult,
  ListsCanJoinInput,
  ListsCanJoinResult,
  ListsSeparateInput,
  ListsSeparateResult,
  ListsMergeInput,
  ListsMergeResult,
  ListsSplitInput,
  ListsSplitResult,
  ListsSetLevelInput,
  ListsSetValueInput,
  ListsContinuePreviousInput,
  ListsCanContinuePreviousInput,
  ListsCanContinuePreviousResult,
  ListsSetLevelRestartInput,
  ListsConvertToTextInput,
  ListsConvertToTextResult,
  ListsApplyTemplateInput,
  ListsApplyPresetInput,
  ListsCaptureTemplateInput,
  ListsCaptureTemplateResult,
  ListsSetLevelNumberingInput,
  ListsSetLevelBulletInput,
  ListsSetLevelPictureBulletInput,
  ListsSetLevelAlignmentInput,
  ListsSetLevelIndentsInput,
  ListsSetLevelTrailingCharacterInput,
  ListsSetLevelMarkerFontInput,
  ListsClearLevelOverridesInput,
  ListsSetTypeInput,
  ListsGetStyleInput,
  ListsGetStyleResult,
  ListsApplyStyleInput,
  ListsRestartAtInput,
  ListsSetLevelNumberStyleInput,
  ListsSetLevelTextInput,
  ListsSetLevelStartInput,
  ListsSetLevelLayoutInput,
  ListsBlockTarget,
  ListsGetStateInput,
  ListsGetStateResult,
  ListsApplyInput,
  ListsContinueV2Input,
  ListsRestartV2Input,
  ListsRemoveV2Input,
} from './lists.types.js';
// ---------------------------------------------------------------------------
// Validation enum sets
// ---------------------------------------------------------------------------
const VALID_BLOCK_NODE_TYPES: ReadonlySet<string> = new Set(BLOCK_NODE_TYPES);
const VALID_LIST_KINDS: ReadonlySet<string> = new Set(LIST_KINDS);
const VALID_INSERT_POSITIONS: ReadonlySet<string> = new Set(LIST_INSERT_POSITIONS);
const VALID_JOIN_DIRECTIONS: ReadonlySet<string> = new Set(JOIN_DIRECTIONS);
const VALID_MUTATION_SCOPES: ReadonlySet<string> = new Set(MUTATION_SCOPES);
const VALID_LEVEL_ALIGNMENTS: ReadonlySet<string> = new Set(LEVEL_ALIGNMENTS);
const VALID_TRAILING_CHARACTERS: ReadonlySet<string> = new Set(TRAILING_CHARACTERS);
const VALID_LIST_PRESETS: ReadonlySet<string> = new Set(LIST_PRESET_IDS);
const VALID_CONTINUITY_VALUES: ReadonlySet<string> = new Set(['preserve', 'none']);
// ---------------------------------------------------------------------------
// Shared validators
// ---------------------------------------------------------------------------
function validateListInput(input: unknown, operationName: string): asserts input is Record<string, unknown> {
  if (!isRecord(input)) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${operationName} input must be a non-null object.`);
  }
}
/**
 * Validates a ListItemAddress shape at the given field name.
 * Strict: nodeType must be 'listItem'.
 */
function validateListItemAddress(value: unknown, field: string, operationName: string): void {
  if (value === undefined || value === null) {
    throw new DocumentApiValidationError('INVALID_TARGET', `${operationName} requires a ${field}.`);
  }
  if (!isRecord(value)) {
    throw new DocumentApiValidationError('INVALID_TARGET', `${operationName} ${field} must be an object.`, {
      field,
      value,
    });
  }
  const t = value as Record<string, unknown>;
  if (t.kind !== 'block') {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `${operationName} ${field}.kind must be 'block', got "${String(t.kind)}".`,
      { field: `${field}.kind`, value: t.kind },
    );
  }
  if (t.nodeType !== 'listItem') {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `${operationName} ${field}.nodeType must be 'listItem', got "${String(t.nodeType)}".`,
      { field: `${field}.nodeType`, value: t.nodeType },
    );
  }
  if (typeof t.nodeId !== 'string' || t.nodeId === '') {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `${operationName} ${field}.nodeId must be a non-empty string.`,
      { field: `${field}.nodeId`, value: t.nodeId },
    );
  }
}
/** Convenience: validates input.target as a ListItemAddress. */
function validateListItemTarget(input: { target?: unknown }, operationName: string): void {
  validateListItemAddress(input.target, 'target', operationName);
}
/**
 * Validates a BlockAddress shape: { kind: 'block', nodeType: 'paragraph', nodeId: string }.
 * In the lists namespace, BlockAddress always means a paragraph block.
 */
function validateBlockAddress(value: unknown, field: string, operationName: string): void {
  if (!isRecord(value)) {
    throw new DocumentApiValidationError('INVALID_TARGET', `${operationName} ${field} must be an object.`, {
      field,
      value,
    });
  }
  const v = value as Record<string, unknown>;
  if (v.kind !== 'block') {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `${operationName} ${field}.kind must be 'block', got "${String(v.kind)}".`,
      { field: `${field}.kind`, value: v.kind },
    );
  }
  if (v.nodeType !== 'paragraph') {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `${operationName} ${field}.nodeType must be 'paragraph', got "${String(v.nodeType)}".`,
      { field: `${field}.nodeType`, value: v.nodeType },
    );
  }
  if (typeof v.nodeId !== 'string' || v.nodeId === '') {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `${operationName} ${field}.nodeId must be a non-empty string.`,
      { field: `${field}.nodeId`, value: v.nodeId },
    );
  }
}
/**
 * Validates BlockAddress | BlockRange target shape.
 */
function validateBlockAddressOrRange(value: unknown, field: string, operationName: string): void {
  if (!isRecord(value)) {
    throw new DocumentApiValidationError('INVALID_TARGET', `${operationName} ${field} must be an object.`, {
      field,
      value,
    });
  }
  const v = value as Record<string, unknown>;
  if (v.from !== undefined) {
    // BlockRange
    validateBlockAddress(v.from, `${field}.from`, operationName);
    validateBlockAddress(v.to, `${field}.to`, operationName);
  } else {
    // BlockAddress
    validateBlockAddress(value, field, operationName);
  }
}
function requireLevel(value: unknown, operationName: string): void {
  if (!isInteger(value) || (value as number) < 0) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operationName} level must be a non-negative integer, got ${JSON.stringify(value)}.`,
      { field: 'level', value },
    );
  }
}
function requireEnum(value: unknown, field: string, validSet: ReadonlySet<string>, operationName: string): void {
  if (!validSet.has(value as string)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operationName} ${field} must be one of: ${[...validSet].join(', ')}. Got ${JSON.stringify(value)}.`,
      { field, value },
    );
  }
}
function optionalBoolean(value: unknown, field: string, operationName: string): void {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operationName} ${field} must be a boolean if provided, got ${typeof value}.`,
      { field, value },
    );
  }
}
function optionalNumber(value: unknown, field: string, operationName: string): void {
  if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value as number))) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operationName} ${field} must be a number if provided, got ${typeof value}.`,
      { field, value },
    );
  }
}
function optionalInteger(value: unknown, field: string, operationName: string): void {
  if (value !== undefined && !isInteger(value)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operationName} ${field} must be an integer if provided, got ${JSON.stringify(value)}.`,
      { field, value },
    );
  }
}
function optionalLevelsArray(value: unknown, field: string, operationName: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${operationName} ${field} must be an array if provided.`, {
      field,
      value,
    });
  }
  for (let i = 0; i < value.length; i++) {
    if (!isInteger(value[i]) || (value[i] as number) < 0) {
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        `${operationName} ${field}[${i}] must be a non-negative integer.`,
        { field: `${field}[${i}]`, value: value[i] },
      );
    }
  }
}
function validateCustomFormat(numFmt: unknown, customFormat: unknown, field: string, operationName: string): void {
  if (customFormat === undefined) return;
  if ((numFmt !== undefined && numFmt !== 'custom') || typeof customFormat !== 'string' || customFormat.length === 0) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operationName} ${field} requires numFmt custom and a non-empty format string.`,
      { field, value: customFormat },
    );
  }
}
function validateListLevelTemplate(entry: unknown, path: string, operationName: string): void {
  if (!isRecord(entry)) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${operationName} ${path} must be an object.`, {
      field: path,
      value: entry,
    });
  }
  const e = entry as Record<string, unknown>;
  if (!isInteger(e.level) || (e.level as number) < 0) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operationName} ${path}.level must be a non-negative integer.`,
      { field: `${path}.level`, value: e.level },
    );
  }
  if (e.numFmt !== undefined && typeof e.numFmt !== 'string') {
    throw new DocumentApiValidationError('INVALID_INPUT', `${operationName} ${path}.numFmt must be a string.`, {
      field: `${path}.numFmt`,
      value: e.numFmt,
    });
  }
  validateCustomFormat(e.numFmt, e.customFormat, `${path}.customFormat`, operationName);
  if (e.lvlText !== undefined && typeof e.lvlText !== 'string') {
    throw new DocumentApiValidationError('INVALID_INPUT', `${operationName} ${path}.lvlText must be a string.`, {
      field: `${path}.lvlText`,
      value: e.lvlText,
    });
  }
  optionalInteger(e.start, `${path}.start`, operationName);
  if (e.lvlRestart !== undefined && (!isInteger(e.lvlRestart) || (e.lvlRestart as number) < 0)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operationName} ${path}.lvlRestart must be a non-negative integer.`,
      { field: `${path}.lvlRestart`, value: e.lvlRestart },
    );
  }
  if (e.alignment !== undefined) {
    requireEnum(e.alignment, `${path}.alignment`, VALID_LEVEL_ALIGNMENTS, operationName);
  }
  if (e.trailingCharacter !== undefined) {
    requireEnum(e.trailingCharacter, `${path}.trailingCharacter`, VALID_TRAILING_CHARACTERS, operationName);
  }
  if (e.markerFont !== undefined && typeof e.markerFont !== 'string') {
    throw new DocumentApiValidationError('INVALID_INPUT', `${operationName} ${path}.markerFont must be a string.`, {
      field: `${path}.markerFont`,
      value: e.markerFont,
    });
  }
  optionalInteger(e.pictureBulletId, `${path}.pictureBulletId`, operationName);
  // tabStopAt allows number | null
  if (e.tabStopAt !== undefined && e.tabStopAt !== null) {
    optionalNumber(e.tabStopAt, `${path}.tabStopAt`, operationName);
  }
  if (e.indents !== undefined) {
    if (!isRecord(e.indents)) {
      throw new DocumentApiValidationError('INVALID_INPUT', `${operationName} ${path}.indents must be an object.`, {
        field: `${path}.indents`,
        value: e.indents,
      });
    }
    const ind = e.indents as Record<string, unknown>;
    optionalNumber(ind.left, `${path}.indents.left`, operationName);
    optionalNumber(ind.hanging, `${path}.indents.hanging`, operationName);
    optionalNumber(ind.firstLine, `${path}.indents.firstLine`, operationName);
  }
}
function validateListTemplate(value: unknown, field: string, operationName: string): void {
  if (!isRecord(value)) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${operationName} ${field} must be an object.`, {
      field,
      value,
    });
  }
  const t = value as Record<string, unknown>;
  if (t.version !== 1) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operationName} ${field}.version must be 1, got ${JSON.stringify(t.version)}.`,
      { field: `${field}.version`, value: t.version },
    );
  }
  if (!Array.isArray(t.levels)) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${operationName} ${field}.levels must be an array.`, {
      field: `${field}.levels`,
      value: t.levels,
    });
  }
  for (let i = 0; i < (t.levels as unknown[]).length; i++) {
    validateListLevelTemplate((t.levels as unknown[])[i], `${field}.levels[${i}]`, operationName);
  }
}
const VALID_SEQUENCE_MODES: ReadonlySet<string> = new Set(['new', 'continuePrevious']);
function validateListsCreateFields(raw: Record<string, unknown>): void {
  const op = 'lists.create';
  if (raw.kind !== undefined) {
    requireEnum(raw.kind, 'kind', VALID_LIST_KINDS, op);
  }
  if (raw.level !== undefined) {
    if (!isInteger(raw.level) || (raw.level as number) < 0) {
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        `${op} level must be a non-negative integer, got ${JSON.stringify(raw.level)}.`,
        { field: 'level', value: raw.level },
      );
    }
  }
  // Validate sequence
  if (raw.sequence !== undefined) {
    if (!isRecord(raw.sequence)) {
      throw new DocumentApiValidationError('INVALID_INPUT', `${op} sequence must be an object.`, {
        field: 'sequence',
        value: raw.sequence,
      });
    }
    const seq = raw.sequence as Record<string, unknown>;
    requireEnum(seq.mode, 'sequence.mode', VALID_SEQUENCE_MODES, op);
    if (seq.mode === 'continuePrevious') {
      // Union rule: continuePrevious forbids preset, style, and startAt
      if (raw.preset !== undefined) {
        throw new DocumentApiValidationError(
          'INVALID_INPUT',
          `${op} preset must not be provided when sequence.mode is 'continuePrevious'.`,
          { field: 'preset' },
        );
      }
      if (raw.style !== undefined) {
        throw new DocumentApiValidationError(
          'INVALID_INPUT',
          `${op} style must not be provided when sequence.mode is 'continuePrevious'.`,
          { field: 'style' },
        );
      }
      if (seq.startAt !== undefined) {
        throw new DocumentApiValidationError(
          'INVALID_INPUT',
          `${op} sequence.startAt must not be provided when sequence.mode is 'continuePrevious'.`,
          { field: 'sequence.startAt' },
        );
      }
    }
    if (seq.mode === 'new') {
      optionalInteger(seq.startAt, 'sequence.startAt', op);
    }
  }
  // Validate preset
  if (raw.preset !== undefined) {
    requireEnum(raw.preset, 'preset', VALID_LIST_PRESETS, op);
  }
  // Validate style
  if (raw.style !== undefined) {
    validateListTemplate(raw.style, 'style', op);
  }
}
// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------
export interface ListsAdapter {
  // Discovery
  list(query?: ListsListQuery): ListsListResult;
  get(input: ListsGetInput): ListItemInfo;
  // Kept operations
  insert(input: ListInsertInput, options?: MutationOptions): ListsInsertResult;
  indent(input: ListTargetInput, options?: MutationOptions): ListsMutateItemResult;
  outdent(input: ListTargetInput, options?: MutationOptions): ListsMutateItemResult;
  // SD-1272 operations
  create(input: ListsCreateInput, options?: MutationOptions): ListsCreateResult;
  attach(input: ListsAttachInput, options?: MutationOptions): ListsMutateItemResult;
  detach(input: ListsDetachInput, options?: MutationOptions): ListsDetachResult;
  delete(input: ListsDeleteInput, options?: MutationOptions): ListsDeleteResult;
  join(input: ListsJoinInput, options?: MutationOptions): ListsJoinResult;
  canJoin(input: ListsCanJoinInput): ListsCanJoinResult;
  separate(input: ListsSeparateInput, options?: MutationOptions): ListsSeparateResult;
  merge(input: ListsMergeInput, options?: MutationOptions): ListsMergeResult;
  split(input: ListsSplitInput, options?: MutationOptions): ListsSplitResult;
  setLevel(input: ListsSetLevelInput, options?: MutationOptions): ListsMutateItemResult;
  setValue(input: ListsSetValueInput, options?: MutationOptions): ListsMutateItemResult;
  continuePrevious(input: ListsContinuePreviousInput, options?: MutationOptions): ListsMutateItemResult;
  canContinuePrevious(input: ListsCanContinuePreviousInput): ListsCanContinuePreviousResult;
  setLevelRestart(input: ListsSetLevelRestartInput, options?: MutationOptions): ListsMutateItemResult;
  convertToText(input: ListsConvertToTextInput, options?: MutationOptions): ListsConvertToTextResult;
  // SD-1973 formatting operations
  applyTemplate(input: ListsApplyTemplateInput, options?: MutationOptions): ListsMutateItemResult;
  applyPreset(input: ListsApplyPresetInput, options?: MutationOptions): ListsMutateItemResult;
  captureTemplate(input: ListsCaptureTemplateInput): ListsCaptureTemplateResult;
  setLevelNumbering(input: ListsSetLevelNumberingInput, options?: MutationOptions): ListsMutateItemResult;
  setLevelBullet(input: ListsSetLevelBulletInput, options?: MutationOptions): ListsMutateItemResult;
  setLevelPictureBullet(input: ListsSetLevelPictureBulletInput, options?: MutationOptions): ListsMutateItemResult;
  setLevelAlignment(input: ListsSetLevelAlignmentInput, options?: MutationOptions): ListsMutateItemResult;
  setLevelIndents(input: ListsSetLevelIndentsInput, options?: MutationOptions): ListsMutateItemResult;
  setLevelTrailingCharacter(
    input: ListsSetLevelTrailingCharacterInput,
    options?: MutationOptions,
  ): ListsMutateItemResult;
  setLevelMarkerFont(input: ListsSetLevelMarkerFontInput, options?: MutationOptions): ListsMutateItemResult;
  clearLevelOverrides(input: ListsClearLevelOverridesInput, options?: MutationOptions): ListsMutateItemResult;
  // SD-2052 compound operation
  setType(input: ListsSetTypeInput, options?: MutationOptions): ListsMutateItemResult;
  // SD-2025 user-facing operations
  getStyle(input: ListsGetStyleInput): ListsGetStyleResult;
  applyStyle(input: ListsApplyStyleInput, options?: MutationOptions): ListsMutateItemResult;
  restartAt(input: ListsRestartAtInput, options?: MutationOptions): ListsMutateItemResult;
  setLevelNumberStyle(input: ListsSetLevelNumberStyleInput, options?: MutationOptions): ListsMutateItemResult;
  setLevelText(input: ListsSetLevelTextInput, options?: MutationOptions): ListsMutateItemResult;
  setLevelStart(input: ListsSetLevelStartInput, options?: MutationOptions): ListsMutateItemResult;
  setLevelLayout(input: ListsSetLevelLayoutInput, options?: MutationOptions): ListsMutateItemResult;
  // v2 numbering-aware list operations.
  getState?(input: ListsGetStateInput): ListsGetStateResult;
  apply?(input: ListsApplyInput, options?: MutationOptions): ListsMutateItemResult;
  continue?(input: ListsContinueV2Input, options?: MutationOptions): ListsMutateItemResult;
  restart?(input: ListsRestartV2Input, options?: MutationOptions): ListsMutateItemResult;
  remove?(input: ListsRemoveV2Input, options?: MutationOptions): ListsMutateItemResult;
}
export interface ListsApi extends ListsAdapter {
  getState(input: ListsGetStateInput): ListsGetStateResult;
  apply(input: ListsApplyInput, options?: MutationOptions): ListsMutateItemResult;
  continue(input: ListsContinueV2Input, options?: MutationOptions): ListsMutateItemResult;
  restart(input: ListsRestartV2Input, options?: MutationOptions): ListsMutateItemResult;
  remove(input: ListsRemoveV2Input, options?: MutationOptions): ListsMutateItemResult;
}
// ---------------------------------------------------------------------------
// Execute wrappers: discovery
// ---------------------------------------------------------------------------
export function executeListsList(adapter: ListsAdapter, query?: ListsListQuery): ListsListResult {
  if (query !== undefined) {
    if (!isRecord(query as unknown)) {
      throw new DocumentApiValidationError('INVALID_INPUT', 'lists.list query must be an object if provided.');
    }
    const q = query as Record<string, unknown>;
    if (q.kind !== undefined) {
      requireEnum(q.kind, 'kind', VALID_LIST_KINDS, 'lists.list');
    }
    optionalInteger(q.level, 'level', 'lists.list');
    optionalInteger(q.limit, 'limit', 'lists.list');
    optionalInteger(q.offset, 'offset', 'lists.list');
    optionalInteger(q.ordinal, 'ordinal', 'lists.list');
    if (q.within !== undefined) {
      if (!isRecord(q.within)) {
        throw new DocumentApiValidationError('INVALID_INPUT', 'lists.list within must be an object.', {
          field: 'within',
          value: q.within,
        });
      }
      const w = q.within as Record<string, unknown>;
      if (w.kind !== 'block') {
        throw new DocumentApiValidationError(
          'INVALID_INPUT',
          `lists.list within.kind must be 'block', got "${String(w.kind)}".`,
          { field: 'within.kind', value: w.kind },
        );
      }
      if (!VALID_BLOCK_NODE_TYPES.has(w.nodeType as string)) {
        throw new DocumentApiValidationError(
          'INVALID_INPUT',
          `lists.list within.nodeType must be a valid BlockNodeType, got ${JSON.stringify(w.nodeType)}.`,
          { field: 'within.nodeType', value: w.nodeType },
        );
      }
      if (typeof w.nodeId !== 'string' || w.nodeId === '') {
        throw new DocumentApiValidationError('INVALID_INPUT', 'lists.list within.nodeId must be a non-empty string.', {
          field: 'within.nodeId',
          value: w.nodeId,
        });
      }
    }
  }
  return adapter.list(query);
}
export function executeListsGet(adapter: ListsAdapter, input: ListsGetInput): ListItemInfo {
  validateListInput(input, 'lists.get');
  validateListItemAddress(input.address, 'address', 'lists.get');
  return adapter.get(input);
}
// ---------------------------------------------------------------------------
// Execute wrappers: kept operations
// ---------------------------------------------------------------------------
export function executeListsInsert(
  adapter: ListsAdapter,
  input: ListInsertInput,
  options?: MutationOptions,
): ListsInsertResult {
  validateListItemTarget(input, 'lists.insert');
  if (input.inheritFrom !== undefined) {
    validateListItemTarget({ target: input.inheritFrom }, 'lists.insert inheritFrom');
  }
  requireEnum(input.position, 'position', VALID_INSERT_POSITIONS, 'lists.insert');
  if (input.text !== undefined && typeof input.text !== 'string') {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `lists.insert text must be a string if provided, got ${typeof input.text}.`,
      {
        field: 'text',
        value: input.text,
      },
    );
  }
  return adapter.insert(input, normalizeMutationOptions(options));
}
export function executeListsIndent(
  adapter: ListsAdapter,
  input: ListTargetInput,
  options?: MutationOptions,
): ListsMutateItemResult {
  validateListItemTarget(input, 'lists.indent');
  return adapter.indent(input, normalizeMutationOptions(options));
}
export function executeListsOutdent(
  adapter: ListsAdapter,
  input: ListTargetInput,
  options?: MutationOptions,
): ListsMutateItemResult {
  validateListItemTarget(input, 'lists.outdent');
  return adapter.outdent(input, normalizeMutationOptions(options));
}
// ---------------------------------------------------------------------------
// Execute wrappers: SD-1272 operations
// ---------------------------------------------------------------------------
const VALID_LIST_CREATE_MODES: ReadonlySet<string> = new Set(['empty', 'fromParagraphs']);
export function executeListsCreate(
  adapter: ListsAdapter,
  input: ListsCreateInput,
  options?: MutationOptions,
): ListsCreateResult {
  validateListInput(input, 'lists.create');
  const raw = input as Record<string, unknown>;
  if (!VALID_LIST_CREATE_MODES.has(raw.mode as string)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `lists.create mode must be "empty" or "fromParagraphs", got ${JSON.stringify(raw.mode)}.`,
      { field: 'mode', value: raw.mode },
    );
  }
  if (raw.mode === 'empty') {
    validateBlockAddress(raw.at, 'at', 'lists.create');
  }
  if (raw.mode === 'fromParagraphs') {
    if (raw.target === undefined || raw.target === null) {
      throw new DocumentApiValidationError(
        'INVALID_TARGET',
        'lists.create with mode "fromParagraphs" requires a target.',
        { field: 'target' },
      );
    }
    validateBlockAddressOrRange(raw.target, 'target', 'lists.create');
  }
  validateListsCreateFields(raw);
  return adapter.create(input, normalizeMutationOptions(options));
}
export function executeListsAttach(
  adapter: ListsAdapter,
  input: ListsAttachInput,
  options?: MutationOptions,
): ListsMutateItemResult {
  validateListInput(input, 'lists.attach');
  validateBlockAddressOrRange(input.target, 'target', 'lists.attach');
  validateListItemAddress(input.attachTo, 'attachTo', 'lists.attach');
  optionalInteger(input.level, 'level', 'lists.attach');
  return adapter.attach(input, normalizeMutationOptions(options));
}
export function executeListsDetach(
  adapter: ListsAdapter,
  input: ListsDetachInput,
  options?: MutationOptions,
): ListsDetachResult {
  validateListItemTarget(input, 'lists.detach');
  return adapter.detach(input, normalizeMutationOptions(options));
}
export function executeListsDelete(
  adapter: ListsAdapter,
  input: ListsDeleteInput,
  options?: MutationOptions,
): ListsDeleteResult {
  validateListItemTarget(input, 'lists.delete');
  return adapter.delete(input, normalizeMutationOptions(options));
}
export function executeListsJoin(
  adapter: ListsAdapter,
  input: ListsJoinInput,
  options?: MutationOptions,
): ListsJoinResult {
  validateListItemTarget(input, 'lists.join');
  requireEnum(input.direction, 'direction', VALID_JOIN_DIRECTIONS, 'lists.join');
  return adapter.join(input, normalizeMutationOptions(options));
}
export function executeListsCanJoin(adapter: ListsAdapter, input: ListsCanJoinInput): ListsCanJoinResult {
  validateListItemTarget(input, 'lists.canJoin');
  requireEnum(input.direction, 'direction', VALID_JOIN_DIRECTIONS, 'lists.canJoin');
  return adapter.canJoin(input);
}
export function executeListsSeparate(
  adapter: ListsAdapter,
  input: ListsSeparateInput,
  options?: MutationOptions,
): ListsSeparateResult {
  validateListItemTarget(input, 'lists.separate');
  optionalBoolean(input.copyOverrides, 'copyOverrides', 'lists.separate');
  return adapter.separate(input, normalizeMutationOptions(options));
}
export function executeListsMerge(
  adapter: ListsAdapter,
  input: ListsMergeInput,
  options?: MutationOptions,
): ListsMergeResult {
  validateListItemTarget(input, 'lists.merge');
  requireEnum(input.direction, 'direction', VALID_JOIN_DIRECTIONS, 'lists.merge');
  return adapter.merge(input, normalizeMutationOptions(options));
}
export function executeListsSplit(
  adapter: ListsAdapter,
  input: ListsSplitInput,
  options?: MutationOptions,
): ListsSplitResult {
  validateListItemTarget(input, 'lists.split');
  optionalBoolean(input.restartNumbering, 'restartNumbering', 'lists.split');
  return adapter.split(input, normalizeMutationOptions(options));
}
export function executeListsSetLevel(
  adapter: ListsAdapter,
  input: ListsSetLevelInput,
  options?: MutationOptions,
): ListsMutateItemResult {
  validateListItemTarget(input, 'lists.setLevel');
  requireLevel(input.level, 'lists.setLevel');
  return adapter.setLevel(input, normalizeMutationOptions(options));
}
export function executeListsSetValue(
  adapter: ListsAdapter,
  input: ListsSetValueInput,
  options?: MutationOptions,
): ListsMutateItemResult {
  validateListItemTarget(input, 'lists.setValue');
  if (input.value !== null && !isInteger(input.value)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `lists.setValue value must be an integer or null, got ${JSON.stringify(input.value)}.`,
      { field: 'value', value: input.value },
    );
  }
  return adapter.setValue(input, normalizeMutationOptions(options));
}
export function executeListsContinuePrevious(
  adapter: ListsAdapter,
  input: ListsContinuePreviousInput,
  options?: MutationOptions,
): ListsMutateItemResult {
  validateListItemTarget(input, 'lists.continuePrevious');
  return adapter.continuePrevious(input, normalizeMutationOptions(options));
}
export function executeListsCanContinuePrevious(
  adapter: ListsAdapter,
  input: ListsCanContinuePreviousInput,
): ListsCanContinuePreviousResult {
  validateListItemTarget(input, 'lists.canContinuePrevious');
  return adapter.canContinuePrevious(input);
}
export function executeListsSetLevelRestart(
  adapter: ListsAdapter,
  input: ListsSetLevelRestartInput,
  options?: MutationOptions,
): ListsMutateItemResult {
  validateListItemTarget(input, 'lists.setLevelRestart');
  requireLevel(input.level, 'lists.setLevelRestart');
  if (input.restartAfterLevel !== null && !isInteger(input.restartAfterLevel)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `lists.setLevelRestart restartAfterLevel must be an integer or null.`,
      { field: 'restartAfterLevel', value: input.restartAfterLevel },
    );
  }
  if (input.scope !== undefined) {
    requireEnum(input.scope, 'scope', VALID_MUTATION_SCOPES, 'lists.setLevelRestart');
  }
  return adapter.setLevelRestart(input, normalizeMutationOptions(options));
}
export function executeListsConvertToText(
  adapter: ListsAdapter,
  input: ListsConvertToTextInput,
  options?: MutationOptions,
): ListsConvertToTextResult {
  validateListItemTarget(input, 'lists.convertToText');
  optionalBoolean(input.includeMarker, 'includeMarker', 'lists.convertToText');
  return adapter.convertToText(input, normalizeMutationOptions(options));
}
// ---------------------------------------------------------------------------
// Execute wrappers: SD-1973 formatting operations
// ---------------------------------------------------------------------------
export function executeListsApplyTemplate(
  adapter: ListsAdapter,
  input: ListsApplyTemplateInput,
  options?: MutationOptions,
): ListsMutateItemResult {
  validateListItemTarget(input, 'lists.applyTemplate');
  validateListTemplate(input.template, 'template', 'lists.applyTemplate');
  optionalLevelsArray(input.levels, 'levels', 'lists.applyTemplate');
  return adapter.applyTemplate(input, normalizeMutationOptions(options));
}
export function executeListsApplyPreset(
  adapter: ListsAdapter,
  input: ListsApplyPresetInput,
  options?: MutationOptions,
): ListsMutateItemResult {
  validateListItemTarget(input, 'lists.applyPreset');
  requireEnum(input.preset, 'preset', VALID_LIST_PRESETS, 'lists.applyPreset');
  optionalLevelsArray(input.levels, 'levels', 'lists.applyPreset');
  return adapter.applyPreset(input, normalizeMutationOptions(options));
}
export function executeListsCaptureTemplate(
  adapter: ListsAdapter,
  input: ListsCaptureTemplateInput,
): ListsCaptureTemplateResult {
  validateListItemTarget(input, 'lists.captureTemplate');
  optionalLevelsArray(input.levels, 'levels', 'lists.captureTemplate');
  return adapter.captureTemplate(input);
}
export function executeListsSetLevelNumbering(
  adapter: ListsAdapter,
  input: ListsSetLevelNumberingInput,
  options?: MutationOptions,
): ListsMutateItemResult {
  validateListItemTarget(input, 'lists.setLevelNumbering');
  requireLevel(input.level, 'lists.setLevelNumbering');
  if (typeof input.numFmt !== 'string') {
    throw new DocumentApiValidationError('INVALID_INPUT', 'lists.setLevelNumbering numFmt must be a string.', {
      field: 'numFmt',
      value: input.numFmt,
    });
  }
  if (typeof input.lvlText !== 'string') {
    throw new DocumentApiValidationError('INVALID_INPUT', 'lists.setLevelNumbering lvlText must be a string.', {
      field: 'lvlText',
      value: input.lvlText,
    });
  }
  optionalInteger(input.start, 'start', 'lists.setLevelNumbering');
  validateCustomFormat(input.numFmt, input.customFormat, 'customFormat', 'lists.setLevelNumbering');
  optionalBoolean(input.isLgl, 'isLgl', 'lists.setLevelNumbering');
  return adapter.setLevelNumbering(input, normalizeMutationOptions(options));
}
export function executeListsSetLevelBullet(
  adapter: ListsAdapter,
  input: ListsSetLevelBulletInput,
  options?: MutationOptions,
): ListsMutateItemResult {
  validateListItemTarget(input, 'lists.setLevelBullet');
  requireLevel(input.level, 'lists.setLevelBullet');
  if (typeof input.markerText !== 'string') {
    throw new DocumentApiValidationError('INVALID_INPUT', 'lists.setLevelBullet markerText must be a string.', {
      field: 'markerText',
      value: input.markerText,
    });
  }
  return adapter.setLevelBullet(input, normalizeMutationOptions(options));
}
export function executeListsSetLevelPictureBullet(
  adapter: ListsAdapter,
  input: ListsSetLevelPictureBulletInput,
  options?: MutationOptions,
): ListsMutateItemResult {
  validateListItemTarget(input, 'lists.setLevelPictureBullet');
  requireLevel(input.level, 'lists.setLevelPictureBullet');
  if (!isInteger(input.pictureBulletId)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      'lists.setLevelPictureBullet pictureBulletId must be an integer.',
      { field: 'pictureBulletId', value: input.pictureBulletId },
    );
  }
  return adapter.setLevelPictureBullet(input, normalizeMutationOptions(options));
}
export function executeListsSetLevelAlignment(
  adapter: ListsAdapter,
  input: ListsSetLevelAlignmentInput,
  options?: MutationOptions,
): ListsMutateItemResult {
  validateListItemTarget(input, 'lists.setLevelAlignment');
  requireLevel(input.level, 'lists.setLevelAlignment');
  requireEnum(input.alignment, 'alignment', VALID_LEVEL_ALIGNMENTS, 'lists.setLevelAlignment');
  return adapter.setLevelAlignment(input, normalizeMutationOptions(options));
}
export function executeListsSetLevelIndents(
  adapter: ListsAdapter,
  input: ListsSetLevelIndentsInput,
  options?: MutationOptions,
): ListsMutateItemResult {
  validateListItemTarget(input, 'lists.setLevelIndents');
  requireLevel(input.level, 'lists.setLevelIndents');
  optionalNumber(input.left, 'left', 'lists.setLevelIndents');
  optionalNumber(input.hanging, 'hanging', 'lists.setLevelIndents');
  optionalNumber(input.firstLine, 'firstLine', 'lists.setLevelIndents');
  return adapter.setLevelIndents(input, normalizeMutationOptions(options));
}
export function executeListsSetLevelTrailingCharacter(
  adapter: ListsAdapter,
  input: ListsSetLevelTrailingCharacterInput,
  options?: MutationOptions,
): ListsMutateItemResult {
  validateListItemTarget(input, 'lists.setLevelTrailingCharacter');
  requireLevel(input.level, 'lists.setLevelTrailingCharacter');
  requireEnum(
    input.trailingCharacter,
    'trailingCharacter',
    VALID_TRAILING_CHARACTERS,
    'lists.setLevelTrailingCharacter',
  );
  return adapter.setLevelTrailingCharacter(input, normalizeMutationOptions(options));
}
export function executeListsSetLevelMarkerFont(
  adapter: ListsAdapter,
  input: ListsSetLevelMarkerFontInput,
  options?: MutationOptions,
): ListsMutateItemResult {
  validateListItemTarget(input, 'lists.setLevelMarkerFont');
  requireLevel(input.level, 'lists.setLevelMarkerFont');
  if (typeof input.fontFamily !== 'string') {
    throw new DocumentApiValidationError('INVALID_INPUT', 'lists.setLevelMarkerFont fontFamily must be a string.', {
      field: 'fontFamily',
      value: input.fontFamily,
    });
  }
  return adapter.setLevelMarkerFont(input, normalizeMutationOptions(options));
}
export function executeListsClearLevelOverrides(
  adapter: ListsAdapter,
  input: ListsClearLevelOverridesInput,
  options?: MutationOptions,
): ListsMutateItemResult {
  validateListItemTarget(input, 'lists.clearLevelOverrides');
  requireLevel(input.level, 'lists.clearLevelOverrides');
  return adapter.clearLevelOverrides(input, normalizeMutationOptions(options));
}
export function executeListsSetType(
  adapter: ListsAdapter,
  input: ListsSetTypeInput,
  options?: MutationOptions,
): ListsMutateItemResult {
  validateListItemTarget(input, 'lists.setType');
  requireEnum(input.kind, 'kind', VALID_LIST_KINDS, 'lists.setType');
  if (input.continuity !== undefined) {
    requireEnum(input.continuity, 'continuity', VALID_CONTINUITY_VALUES, 'lists.setType');
  }
  return adapter.setType(input, normalizeMutationOptions(options));
}
// ---------------------------------------------------------------------------
// Execute wrappers: SD-2025 user-facing operations
// ---------------------------------------------------------------------------
export function executeListsGetStyle(adapter: ListsAdapter, input: ListsGetStyleInput): ListsGetStyleResult {
  validateListItemTarget(input, 'lists.getStyle');
  optionalLevelsArray(input.levels, 'levels', 'lists.getStyle');
  return adapter.getStyle(input);
}
export function executeListsApplyStyle(
  adapter: ListsAdapter,
  input: ListsApplyStyleInput,
  options?: MutationOptions,
): ListsMutateItemResult {
  validateListItemTarget(input, 'lists.applyStyle');
  validateListTemplate(input.style, 'style', 'lists.applyStyle');
  optionalLevelsArray(input.levels, 'levels', 'lists.applyStyle');
  return adapter.applyStyle(input, normalizeMutationOptions(options));
}
export function executeListsRestartAt(
  adapter: ListsAdapter,
  input: ListsRestartAtInput,
  options?: MutationOptions,
): ListsMutateItemResult {
  validateListItemTarget(input, 'lists.restartAt');
  if (!isInteger(input.startAt)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `lists.restartAt startAt must be an integer, got ${JSON.stringify(input.startAt)}.`,
      { field: 'startAt', value: input.startAt },
    );
  }
  return adapter.restartAt(input, normalizeMutationOptions(options));
}
export function executeListsSetLevelNumberStyle(
  adapter: ListsAdapter,
  input: ListsSetLevelNumberStyleInput,
  options?: MutationOptions,
): ListsMutateItemResult {
  validateListItemTarget(input, 'lists.setLevelNumberStyle');
  requireLevel(input.level, 'lists.setLevelNumberStyle');
  if (typeof input.numberStyle !== 'string') {
    throw new DocumentApiValidationError('INVALID_INPUT', 'lists.setLevelNumberStyle numberStyle must be a string.', {
      field: 'numberStyle',
      value: input.numberStyle,
    });
  }
  return adapter.setLevelNumberStyle(input, normalizeMutationOptions(options));
}
export function executeListsSetLevelText(
  adapter: ListsAdapter,
  input: ListsSetLevelTextInput,
  options?: MutationOptions,
): ListsMutateItemResult {
  validateListItemTarget(input, 'lists.setLevelText');
  requireLevel(input.level, 'lists.setLevelText');
  if (typeof input.text !== 'string') {
    throw new DocumentApiValidationError('INVALID_INPUT', 'lists.setLevelText text must be a string.', {
      field: 'text',
      value: input.text,
    });
  }
  return adapter.setLevelText(input, normalizeMutationOptions(options));
}
export function executeListsSetLevelStart(
  adapter: ListsAdapter,
  input: ListsSetLevelStartInput,
  options?: MutationOptions,
): ListsMutateItemResult {
  validateListItemTarget(input, 'lists.setLevelStart');
  requireLevel(input.level, 'lists.setLevelStart');
  if (!isInteger(input.startAt)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `lists.setLevelStart startAt must be an integer, got ${JSON.stringify(input.startAt)}.`,
      { field: 'startAt', value: input.startAt },
    );
  }
  return adapter.setLevelStart(input, normalizeMutationOptions(options));
}
export function executeListsSetLevelLayout(
  adapter: ListsAdapter,
  input: ListsSetLevelLayoutInput,
  options?: MutationOptions,
): ListsMutateItemResult {
  validateListItemTarget(input, 'lists.setLevelLayout');
  requireLevel(input.level, 'lists.setLevelLayout');
  if (!isRecord(input.layout)) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'lists.setLevelLayout layout must be an object.', {
      field: 'layout',
      value: input.layout,
    });
  }
  const layout = input.layout as Record<string, unknown>;
  if (layout.alignment !== undefined) {
    requireEnum(layout.alignment, 'layout.alignment', VALID_LEVEL_ALIGNMENTS, 'lists.setLevelLayout');
  }
  if (layout.followCharacter !== undefined) {
    requireEnum(layout.followCharacter, 'layout.followCharacter', VALID_TRAILING_CHARACTERS, 'lists.setLevelLayout');
  }
  optionalNumber(layout.alignedAt, 'layout.alignedAt', 'lists.setLevelLayout');
  optionalNumber(layout.textIndentAt, 'layout.textIndentAt', 'lists.setLevelLayout');
  // tabStopAt allows null (to clear) or number
  if (layout.tabStopAt !== undefined && layout.tabStopAt !== null) {
    optionalNumber(layout.tabStopAt, 'layout.tabStopAt', 'lists.setLevelLayout');
  }
  return adapter.setLevelLayout(input, normalizeMutationOptions(options));
}
// ---------------------------------------------------------------------------
// Execute wrappers: v2 operations
// ---------------------------------------------------------------------------
const VALID_V2_LIST_BLOCK_NODE_TYPES: ReadonlySet<string> = new Set(['paragraph', 'listItem']);
function validateV2BlockTarget(value: unknown, field: string, operationName: string): void {
  if (!isRecord(value)) {
    throw new DocumentApiValidationError('INVALID_TARGET', `${operationName} ${field} must be an object.`, {
      field,
      value,
    });
  }
  const v = value as Record<string, unknown>;
  if (v.kind !== 'block') {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `${operationName} ${field}.kind must be 'block', got "${String(v.kind)}".`,
      { field: `${field}.kind`, value: v.kind },
    );
  }
  if (typeof v.nodeType !== 'string' || !VALID_V2_LIST_BLOCK_NODE_TYPES.has(v.nodeType)) {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `${operationName} ${field}.nodeType must be 'paragraph' or 'listItem', got "${String(v.nodeType)}".`,
      { field: `${field}.nodeType`, value: v.nodeType },
    );
  }
  if (typeof v.nodeId !== 'string' || v.nodeId === '') {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `${operationName} ${field}.nodeId must be a non-empty string.`,
      { field: `${field}.nodeId`, value: v.nodeId },
    );
  }
}
function unavailableListsResult<TResult extends ListsGetStateResult | ListsMutateItemResult>(
  operationName: string,
): TResult {
  return {
    success: false,
    failure: {
      code: 'CAPABILITY_UNAVAILABLE',
      message: `${operationName} is not available. The host engine has not provided an adapter for this capability.`,
      details: { operation: operationName },
    },
  } as TResult;
}
export function executeListsGetState(adapter: ListsAdapter, input: ListsGetStateInput): ListsGetStateResult {
  validateListInput(input, 'lists.getState');
  validateV2BlockTarget(input.target, 'target', 'lists.getState');
  if (!adapter.getState) return unavailableListsResult<ListsGetStateResult>('lists.getState');
  return adapter.getState(input);
}
export function executeListsApply(
  adapter: ListsAdapter,
  input: ListsApplyInput,
  options?: MutationOptions,
): ListsMutateItemResult {
  validateListInput(input, 'lists.apply');
  validateV2BlockTarget(input.target, 'target', 'lists.apply');
  requireEnum(input.seed, 'seed', VALID_LIST_KINDS, 'lists.apply');
  if (input.reuseNumId !== undefined && typeof input.reuseNumId !== 'string') {
    throw new DocumentApiValidationError('INVALID_INPUT', 'lists.apply reuseNumId must be a string when provided.', {
      field: 'reuseNumId',
      value: input.reuseNumId,
    });
  }
  optionalInteger(input.ilvl, 'ilvl', 'lists.apply');
  if (!adapter.apply) return unavailableListsResult<ListsMutateItemResult>('lists.apply');
  return adapter.apply(input, normalizeMutationOptions(options));
}
export function executeListsContinueV2(
  adapter: ListsAdapter,
  input: ListsContinueV2Input,
  options?: MutationOptions,
): ListsMutateItemResult {
  validateListInput(input, 'lists.continue');
  validateV2BlockTarget(input.target, 'target', 'lists.continue');
  if (!adapter.continue) return unavailableListsResult<ListsMutateItemResult>('lists.continue');
  return adapter.continue(input, normalizeMutationOptions(options));
}
export function executeListsRestartV2(
  adapter: ListsAdapter,
  input: ListsRestartV2Input,
  options?: MutationOptions,
): ListsMutateItemResult {
  validateListInput(input, 'lists.restart');
  validateV2BlockTarget(input.target, 'target', 'lists.restart');
  optionalInteger(input.startAt, 'startAt', 'lists.restart');
  if (!adapter.restart) return unavailableListsResult<ListsMutateItemResult>('lists.restart');
  return adapter.restart(input, normalizeMutationOptions(options));
}
export function executeListsRemoveV2(
  adapter: ListsAdapter,
  input: ListsRemoveV2Input,
  options?: MutationOptions,
): ListsMutateItemResult {
  validateListInput(input, 'lists.remove');
  validateV2BlockTarget(input.target, 'target', 'lists.remove');
  if (!adapter.remove) return unavailableListsResult<ListsMutateItemResult>('lists.remove');
  return adapter.remove(input, normalizeMutationOptions(options));
}
