/**
 * Engine-agnostic paragraphs domain module.
 *
 * Defines the adapter interface, validation, and execute* functions
 * for all `format.paragraph.*` / `styles.paragraph.*` operations.
 */

import { normalizeMutationOptions, type MutationOptions } from '../write/write.js';
import { DocumentApiValidationError } from '../errors.js';
import { isRecord, assertNoUnknownFields } from '../validation-primitives.js';
import { validateStoryLocator } from '../validation/story-validator.js';
import type {
  ParagraphTarget,
  ParagraphMutationResult,
  ParagraphsSetStyleInput,
  ParagraphSemanticStyleRole,
  ParagraphsSetStyleRefInput,
  ParagraphsClearStyleInput,
  ParagraphsResetDirectFormattingInput,
  ParagraphsSetAlignmentInput,
  ParagraphsClearAlignmentInput,
  ParagraphsSetIndentationInput,
  ParagraphsClearIndentationInput,
  ParagraphsSetSpacingInput,
  ParagraphsClearSpacingInput,
  ParagraphsSetKeepOptionsInput,
  ParagraphsSetOutlineLevelInput,
  ParagraphsSetFlowOptionsInput,
  ParagraphsSetTabStopInput,
  ParagraphsClearTabStopInput,
  ParagraphsClearAllTabStopsInput,
  ParagraphsSetBorderInput,
  ParagraphsClearBorderInput,
  ParagraphsSetShadingInput,
  ParagraphsClearShadingInput,
  ParagraphsSetMarkRunPropsInput,
  ParagraphsSetDirectionInput,
  ParagraphsClearDirectionInput,
  ParagraphsSetNumberingInput,
} from './paragraphs.types.js';
import {
  PARAGRAPH_ALIGNMENTS,
  TAB_STOP_ALIGNMENTS,
  TAB_STOP_LEADERS,
  BORDER_SIDES,
  CLEAR_BORDER_SIDES,
  LINE_RULES,
  PARAGRAPH_DIRECTIONS,
  ALIGNMENT_POLICIES,
} from './paragraphs.types.js';

function assertNoUnknownParagraphFields(
  input: Record<string, unknown>,
  allowlist: ReadonlySet<string>,
  operationName: string,
): void {
  assertNoUnknownFields(input, allowlist, operationName, `doc.${operationName}`);
}

// Re-export types
export type {
  ParagraphTarget,
  ParagraphBlockType,
  ParagraphMutationResult,
  ParagraphMutationSuccess,
  ParagraphMutationFailure,
  MutationResolution,
  ParagraphAlignment,
  TabStopAlignment,
  TabStopLeader,
  BorderSide,
  ClearBorderSide,
  LineRule,
  ParagraphsSetStyleInput,
  ParagraphSemanticStyleRole,
  ParagraphsSetStyleRefInput,
  ParagraphsClearStyleInput,
  ParagraphsResetDirectFormattingInput,
  ParagraphsSetAlignmentInput,
  ParagraphsClearAlignmentInput,
  ParagraphsSetIndentationInput,
  ParagraphsClearIndentationInput,
  ParagraphsSetSpacingInput,
  ParagraphsClearSpacingInput,
  ParagraphsSetKeepOptionsInput,
  ParagraphsSetOutlineLevelInput,
  ParagraphsSetFlowOptionsInput,
  ParagraphsSetTabStopInput,
  ParagraphsClearTabStopInput,
  ParagraphsClearAllTabStopsInput,
  ParagraphsSetBorderInput,
  ParagraphsClearBorderInput,
  ParagraphsSetShadingInput,
  ParagraphsClearShadingInput,
  ParagraphsSetMarkRunPropsInput,
  ParagraphsSetDirectionInput,
  ParagraphsClearDirectionInput,
  ParagraphsSetNumberingInput,
  ParagraphDirection,
  AlignmentPolicy,
} from './paragraphs.types.js';
export {
  PARAGRAPH_ALIGNMENTS,
  TAB_STOP_ALIGNMENTS,
  TAB_STOP_LEADERS,
  BORDER_SIDES,
  CLEAR_BORDER_SIDES,
  LINE_RULES,
  PARAGRAPH_DIRECTIONS,
  ALIGNMENT_POLICIES,
} from './paragraphs.types.js';

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

export interface ParagraphsAdapter {
  setStyle(input: ParagraphsSetStyleInput, options?: MutationOptions): ParagraphMutationResult;
  setStyleRef(input: ParagraphsSetStyleRefInput, options?: MutationOptions): ParagraphMutationResult;
  clearStyle(input: ParagraphsClearStyleInput, options?: MutationOptions): ParagraphMutationResult;
  resetDirectFormatting(
    input: ParagraphsResetDirectFormattingInput,
    options?: MutationOptions,
  ): ParagraphMutationResult;
  setAlignment(input: ParagraphsSetAlignmentInput, options?: MutationOptions): ParagraphMutationResult;
  clearAlignment(input: ParagraphsClearAlignmentInput, options?: MutationOptions): ParagraphMutationResult;
  setIndentation(input: ParagraphsSetIndentationInput, options?: MutationOptions): ParagraphMutationResult;
  clearIndentation(input: ParagraphsClearIndentationInput, options?: MutationOptions): ParagraphMutationResult;
  setSpacing(input: ParagraphsSetSpacingInput, options?: MutationOptions): ParagraphMutationResult;
  clearSpacing(input: ParagraphsClearSpacingInput, options?: MutationOptions): ParagraphMutationResult;
  setKeepOptions(input: ParagraphsSetKeepOptionsInput, options?: MutationOptions): ParagraphMutationResult;
  setOutlineLevel(input: ParagraphsSetOutlineLevelInput, options?: MutationOptions): ParagraphMutationResult;
  setFlowOptions(input: ParagraphsSetFlowOptionsInput, options?: MutationOptions): ParagraphMutationResult;
  setTabStop(input: ParagraphsSetTabStopInput, options?: MutationOptions): ParagraphMutationResult;
  clearTabStop(input: ParagraphsClearTabStopInput, options?: MutationOptions): ParagraphMutationResult;
  clearAllTabStops(input: ParagraphsClearAllTabStopsInput, options?: MutationOptions): ParagraphMutationResult;
  setBorder(input: ParagraphsSetBorderInput, options?: MutationOptions): ParagraphMutationResult;
  clearBorder(input: ParagraphsClearBorderInput, options?: MutationOptions): ParagraphMutationResult;
  setShading(input: ParagraphsSetShadingInput, options?: MutationOptions): ParagraphMutationResult;
  clearShading(input: ParagraphsClearShadingInput, options?: MutationOptions): ParagraphMutationResult;
  setMarkRunProps?(input: ParagraphsSetMarkRunPropsInput, options?: MutationOptions): ParagraphMutationResult;
  setDirection(input: ParagraphsSetDirectionInput, options?: MutationOptions): ParagraphMutationResult;
  clearDirection(input: ParagraphsClearDirectionInput, options?: MutationOptions): ParagraphMutationResult;
  setNumbering(input: ParagraphsSetNumberingInput, options?: MutationOptions): ParagraphMutationResult;
}

/** Public API surface for `format.paragraph.*`: direct paragraph formatting. */
export interface ParagraphFormatApi {
  resetDirectFormatting(
    input: ParagraphsResetDirectFormattingInput,
    options?: MutationOptions,
  ): ParagraphMutationResult;
  setAlignment(input: ParagraphsSetAlignmentInput, options?: MutationOptions): ParagraphMutationResult;
  clearAlignment(input: ParagraphsClearAlignmentInput, options?: MutationOptions): ParagraphMutationResult;
  setIndentation(input: ParagraphsSetIndentationInput, options?: MutationOptions): ParagraphMutationResult;
  clearIndentation(input: ParagraphsClearIndentationInput, options?: MutationOptions): ParagraphMutationResult;
  setSpacing(input: ParagraphsSetSpacingInput, options?: MutationOptions): ParagraphMutationResult;
  clearSpacing(input: ParagraphsClearSpacingInput, options?: MutationOptions): ParagraphMutationResult;
  setKeepOptions(input: ParagraphsSetKeepOptionsInput, options?: MutationOptions): ParagraphMutationResult;
  setOutlineLevel(input: ParagraphsSetOutlineLevelInput, options?: MutationOptions): ParagraphMutationResult;
  setFlowOptions(input: ParagraphsSetFlowOptionsInput, options?: MutationOptions): ParagraphMutationResult;
  setTabStop(input: ParagraphsSetTabStopInput, options?: MutationOptions): ParagraphMutationResult;
  clearTabStop(input: ParagraphsClearTabStopInput, options?: MutationOptions): ParagraphMutationResult;
  clearAllTabStops(input: ParagraphsClearAllTabStopsInput, options?: MutationOptions): ParagraphMutationResult;
  setBorder(input: ParagraphsSetBorderInput, options?: MutationOptions): ParagraphMutationResult;
  clearBorder(input: ParagraphsClearBorderInput, options?: MutationOptions): ParagraphMutationResult;
  setShading(input: ParagraphsSetShadingInput, options?: MutationOptions): ParagraphMutationResult;
  clearShading(input: ParagraphsClearShadingInput, options?: MutationOptions): ParagraphMutationResult;
  setMarkRunProps(input: ParagraphsSetMarkRunPropsInput, options?: MutationOptions): ParagraphMutationResult;
  setDirection(input: ParagraphsSetDirectionInput, options?: MutationOptions): ParagraphMutationResult;
  clearDirection(input: ParagraphsClearDirectionInput, options?: MutationOptions): ParagraphMutationResult;
  setNumbering(input: ParagraphsSetNumberingInput, options?: MutationOptions): ParagraphMutationResult;
}

/** Public API surface for `styles.paragraph.*`: Word-like paragraph style application operations. */
export interface ParagraphStylesApi {
  setStyle(input: ParagraphsSetStyleInput, options?: MutationOptions): ParagraphMutationResult;
  setStyleRef(input: ParagraphsSetStyleRefInput, options?: MutationOptions): ParagraphMutationResult;
  clearStyle(input: ParagraphsClearStyleInput, options?: MutationOptions): ParagraphMutationResult;
}

// ---------------------------------------------------------------------------
// Shared validation
// ---------------------------------------------------------------------------

const PARAGRAPH_BLOCK_TYPES = new Set(['paragraph', 'heading', 'listItem']);

function assertParagraphTarget(input: unknown, operation: string): asserts input is { target: ParagraphTarget } {
  if (!isRecord(input)) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${operation} input must be a non-null object.`);
  }
  const { target } = input;
  if (target === undefined || target === null) {
    throw new DocumentApiValidationError('INVALID_TARGET', `${operation} requires a target.`);
  }
  if (!isRecord(target)) {
    throw new DocumentApiValidationError('INVALID_TARGET', `${operation} target must be an object.`, {
      field: 'target',
    });
  }
  if (target.kind !== 'block') {
    throw new DocumentApiValidationError('INVALID_TARGET', `${operation} target.kind must be 'block'.`, {
      field: 'target.kind',
      value: target.kind,
    });
  }
  if (typeof target.nodeType !== 'string' || !PARAGRAPH_BLOCK_TYPES.has(target.nodeType)) {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `${operation} target.nodeType must be 'paragraph', 'heading', or 'listItem'.`,
      { field: 'target.nodeType', value: target.nodeType },
    );
  }
  if (typeof target.nodeId !== 'string' || target.nodeId.length === 0) {
    throw new DocumentApiValidationError('INVALID_TARGET', `${operation} target.nodeId must be a non-empty string.`, {
      field: 'target.nodeId',
      value: target.nodeId,
    });
  }
  validateStoryLocator(target.story, 'target.story');
}

function assertStrictBoolean(value: unknown, fieldName: string, operation: string): asserts value is boolean {
  if (value !== true && value !== false) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operation} ${fieldName} must be true or false, got ${JSON.stringify(value)}.`,
      { field: fieldName, value },
    );
  }
}

function assertNonNegativeInteger(value: unknown, fieldName: string, operation: string): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operation} ${fieldName} must be a non-negative integer, got ${JSON.stringify(value)}.`,
      { field: fieldName, value },
    );
  }
}

function assertInteger(value: unknown, fieldName: string, operation: string): void {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operation} ${fieldName} must be an integer, got ${JSON.stringify(value)}.`,
      { field: fieldName, value },
    );
  }
}

function assertPositiveInteger(value: unknown, fieldName: string, operation: string): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operation} ${fieldName} must be a positive integer, got ${JSON.stringify(value)}.`,
      { field: fieldName, value },
    );
  }
}

function assertOneOf<T extends string>(
  value: unknown,
  fieldName: string,
  allowed: readonly T[],
  operation: string,
): asserts value is T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operation} ${fieldName} must be one of: ${allowed.join(', ')}. Got ${JSON.stringify(value)}.`,
      { field: fieldName, value },
    );
  }
}

function assertNonEmptyString(value: unknown, fieldName: string, operation: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operation} ${fieldName} must be a non-empty string, got ${JSON.stringify(value)}.`,
      { field: fieldName, value },
    );
  }
}

function assertFiniteNumber(value: unknown, fieldName: string, operation: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operation} ${fieldName} must be a finite number, got ${JSON.stringify(value)}.`,
      { field: fieldName, value },
    );
  }
}

function assertNonEmptyObject(
  value: unknown,
  fieldName: string,
  operation: string,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${operation} ${fieldName} must be an object.`, {
      field: fieldName,
      value,
    });
  }
  if (Object.keys(value).length === 0) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${operation} ${fieldName} must not be empty.`, {
      field: fieldName,
    });
  }
}

/** Rejects if a patch input has zero patchable fields beyond `target`. */
function assertNotEmptyPatch(input: Record<string, unknown>, patchKeys: readonly string[], operation: string): void {
  const hasPatchField = patchKeys.some((key) => input[key] !== undefined);
  if (!hasPatchField) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operation} requires at least one of: ${patchKeys.join(', ')}.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Per-operation allowed keys
// ---------------------------------------------------------------------------

const SET_STYLE_KEYS = new Set(['target', 'styleId', 'role']);
const SET_STYLE_REF_KEYS = new Set(['target', 'styleId']);
const CLEAR_STYLE_KEYS = new Set(['target']);
const RESET_DIRECT_FORMATTING_KEYS = new Set(['target']);
const SET_ALIGNMENT_KEYS = new Set(['target', 'alignment']);
const CLEAR_ALIGNMENT_KEYS = new Set(['target']);
const SET_INDENTATION_KEYS = new Set(['target', 'left', 'right', 'firstLine', 'hanging']);
const CLEAR_INDENTATION_KEYS = new Set(['target']);
const SET_SPACING_KEYS = new Set(['target', 'before', 'after', 'line', 'lineRule']);
const CLEAR_SPACING_KEYS = new Set(['target']);
const SET_KEEP_OPTIONS_KEYS = new Set(['target', 'keepNext', 'keepLines', 'widowControl']);
const SET_OUTLINE_LEVEL_KEYS = new Set(['target', 'outlineLevel']);
const SET_FLOW_OPTIONS_KEYS = new Set([
  'target',
  'contextualSpacing',
  'pageBreakBefore',
  'suppressAutoHyphens',
  'autoSpaceDE',
  'autoSpaceDN',
  'adjustRightInd',
  'snapToGrid',
]);
const SET_TAB_STOP_KEYS = new Set(['target', 'position', 'alignment', 'leader']);
const CLEAR_TAB_STOP_KEYS = new Set(['target', 'position']);
const CLEAR_ALL_TAB_STOPS_KEYS = new Set(['target']);
const SET_BORDER_KEYS = new Set(['target', 'side', 'style', 'color', 'size', 'space']);
const CLEAR_BORDER_KEYS = new Set(['target', 'side']);
const SET_SHADING_KEYS = new Set(['target', 'fill', 'color', 'pattern']);
const CLEAR_SHADING_KEYS = new Set(['target']);
const SET_MARK_RUN_PROPS_KEYS = new Set(['target', 'markRunProps']);
const MARK_RUN_PROPS_FIELD_KEYS = new Set([
  'fontSizeCs',
  'specVanish',
  'fontSize',
  'fonts',
  'fontFamily',
  'lang',
  'color',
  'highlight',
  'shading',
  'cs',
  'rtl',
  'bold',
  'boldCs',
  'italic',
  'italicCs',
  'underline',
  'strikethrough',
  'doubleStrikethrough',
  'caps',
  'smallCaps',
  'outline',
  'shadow',
  'emboss',
  'imprint',
  'verticalAlign',
  'characterSpacing',
  'characterScale',
  'kern',
  'baselineShift',
  'fitTextWidth',
  'vanish',
  'webHidden',
  'border',
  'textEffect',
]);
const MARK_RUN_COLOR_REF_KEYS = new Set(['model', 'value', 'theme', 'tint', 'shade']);
const MARK_RUN_FONTS_KEYS = new Set([
  'ascii',
  'hAnsi',
  'eastAsia',
  'cs',
  'asciiTheme',
  'hAnsiTheme',
  'eastAsiaTheme',
  'csTheme',
  'hint',
]);
const MARK_RUN_LANG_KEYS = new Set(['val', 'eastAsia', 'bidi']);
const MARK_RUN_UNDERLINE_KEYS = new Set(['style', 'color']);
const MARK_RUN_SHADING_KEYS = new Set(['fill', 'color', 'pattern']);
const MARK_RUN_BORDER_KEYS = new Set(['style', 'width', 'space', 'color', 'frame', 'shadow']);
const MARK_RUN_COLOR_MODE_VALUES = ['rgb', 'theme', 'auto'] as const;
const MARK_RUN_VERTICAL_ALIGN_VALUES = ['baseline', 'superscript', 'subscript'] as const;
const SET_DIRECTION_KEYS = new Set(['target', 'direction', 'alignmentPolicy']);
const SET_NUMBERING_KEYS = new Set(['target', 'numId', 'level']);
const CLEAR_DIRECTION_KEYS = new Set(['target']);

// ---------------------------------------------------------------------------
// Per-operation validators
// ---------------------------------------------------------------------------

function validateSetStyle(input: unknown): asserts input is ParagraphsSetStyleInput {
  assertParagraphTarget(input, 'styles.paragraph.setStyle');
  assertNoUnknownParagraphFields(input as Record<string, unknown>, SET_STYLE_KEYS, 'styles.paragraph.setStyle');
  const record = input as Record<string, unknown>;
  if ((record.styleId === undefined) === (record.role === undefined)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      'styles.paragraph.setStyle requires exactly one of styleId or role.',
    );
  }
  if (record.styleId !== undefined) {
    assertNonEmptyString(record.styleId, 'styleId', 'styles.paragraph.setStyle');
    return;
  }

  assertParagraphSemanticStyleRole(record.role);
}

function assertParagraphSemanticStyleRole(value: unknown): asserts value is ParagraphSemanticStyleRole {
  const op = 'styles.paragraph.setStyle';
  if (!isRecord(value)) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${op} role must be an object.`);
  }
  const kind = value.kind;
  if (kind === 'heading') {
    assertNoUnknownFields(value, new Set(['kind', 'level']), op);
    if (typeof value.level !== 'number' || !Number.isInteger(value.level) || value.level < 1 || value.level > 9) {
      throw new DocumentApiValidationError('INVALID_INPUT', `${op} heading role level must be an integer from 1 to 9.`);
    }
    return;
  }
  assertNoUnknownFields(value, new Set(['kind']), op);
  assertOneOf(kind, 'role.kind', ['defaultParagraph', 'title', 'subtitle'] as const, op);
}

function validateSetStyleRef(input: unknown): asserts input is ParagraphsSetStyleRefInput {
  assertParagraphTarget(input, 'styles.paragraph.setStyleRef');
  assertNoUnknownParagraphFields(input as Record<string, unknown>, SET_STYLE_REF_KEYS, 'styles.paragraph.setStyleRef');
  assertNonEmptyString((input as Record<string, unknown>).styleId, 'styleId', 'styles.paragraph.setStyleRef');
}

function validateClearStyle(input: unknown): asserts input is ParagraphsClearStyleInput {
  assertParagraphTarget(input, 'styles.paragraph.clearStyle');
  assertNoUnknownParagraphFields(input as Record<string, unknown>, CLEAR_STYLE_KEYS, 'styles.paragraph.clearStyle');
}

function validateResetDirectFormatting(input: unknown): asserts input is ParagraphsResetDirectFormattingInput {
  assertParagraphTarget(input, 'format.paragraph.resetDirectFormatting');
  assertNoUnknownParagraphFields(
    input as Record<string, unknown>,
    RESET_DIRECT_FORMATTING_KEYS,
    'format.paragraph.resetDirectFormatting',
  );
}

function validateSetAlignment(input: unknown): asserts input is ParagraphsSetAlignmentInput {
  assertParagraphTarget(input, 'format.paragraph.setAlignment');
  assertNoUnknownParagraphFields(input as Record<string, unknown>, SET_ALIGNMENT_KEYS, 'format.paragraph.setAlignment');
  const rec = input as Record<string, unknown>;
  if (rec.alignment === undefined) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'format.paragraph.setAlignment requires an alignment field.');
  }
  assertOneOf(rec.alignment, 'alignment', PARAGRAPH_ALIGNMENTS, 'format.paragraph.setAlignment');
}

function validateClearAlignment(input: unknown): asserts input is ParagraphsClearAlignmentInput {
  assertParagraphTarget(input, 'format.paragraph.clearAlignment');
  assertNoUnknownParagraphFields(
    input as Record<string, unknown>,
    CLEAR_ALIGNMENT_KEYS,
    'format.paragraph.clearAlignment',
  );
}

function validateSetIndentation(input: unknown): asserts input is ParagraphsSetIndentationInput {
  const op = 'format.paragraph.setIndentation';
  assertParagraphTarget(input, op);
  assertNoUnknownParagraphFields(input as Record<string, unknown>, SET_INDENTATION_KEYS, op);
  const rec = input as Record<string, unknown>;
  assertNotEmptyPatch(rec, ['left', 'right', 'firstLine', 'hanging'], op);

  if (rec.left !== undefined) assertInteger(rec.left, 'left', op);
  if (rec.right !== undefined) assertInteger(rec.right, 'right', op);
  if (rec.firstLine !== undefined) assertNonNegativeInteger(rec.firstLine, 'firstLine', op);
  if (rec.hanging !== undefined) assertNonNegativeInteger(rec.hanging, 'hanging', op);

  if (rec.firstLine !== undefined && rec.hanging !== undefined) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${op}: firstLine and hanging are mutually exclusive.`, {
      field: 'firstLine,hanging',
    });
  }
}

function validateClearIndentation(input: unknown): asserts input is ParagraphsClearIndentationInput {
  assertParagraphTarget(input, 'format.paragraph.clearIndentation');
  assertNoUnknownParagraphFields(
    input as Record<string, unknown>,
    CLEAR_INDENTATION_KEYS,
    'format.paragraph.clearIndentation',
  );
}

function validateSetSpacing(input: unknown): asserts input is ParagraphsSetSpacingInput {
  const op = 'format.paragraph.setSpacing';
  assertParagraphTarget(input, op);
  assertNoUnknownParagraphFields(input as Record<string, unknown>, SET_SPACING_KEYS, op);
  const rec = input as Record<string, unknown>;
  assertNotEmptyPatch(rec, ['before', 'after', 'line', 'lineRule'], op);

  if (rec.before !== undefined) assertNonNegativeInteger(rec.before, 'before', op);
  if (rec.after !== undefined) assertNonNegativeInteger(rec.after, 'after', op);
  if (rec.line !== undefined) {
    assertPositiveInteger(rec.line, 'line', op);
    if (rec.lineRule === undefined) {
      throw new DocumentApiValidationError('INVALID_INPUT', `${op}: lineRule is required when line is provided.`);
    }
  }
  if (rec.lineRule !== undefined) {
    assertOneOf(rec.lineRule, 'lineRule', LINE_RULES, op);
  }
}

function validateClearSpacing(input: unknown): asserts input is ParagraphsClearSpacingInput {
  assertParagraphTarget(input, 'format.paragraph.clearSpacing');
  assertNoUnknownParagraphFields(input as Record<string, unknown>, CLEAR_SPACING_KEYS, 'format.paragraph.clearSpacing');
}

function validateSetKeepOptions(input: unknown): asserts input is ParagraphsSetKeepOptionsInput {
  const op = 'format.paragraph.setKeepOptions';
  assertParagraphTarget(input, op);
  assertNoUnknownParagraphFields(input as Record<string, unknown>, SET_KEEP_OPTIONS_KEYS, op);
  const rec = input as Record<string, unknown>;
  assertNotEmptyPatch(rec, ['keepNext', 'keepLines', 'widowControl'], op);

  if (rec.keepNext !== undefined) assertStrictBoolean(rec.keepNext, 'keepNext', op);
  if (rec.keepLines !== undefined) assertStrictBoolean(rec.keepLines, 'keepLines', op);
  if (rec.widowControl !== undefined) assertStrictBoolean(rec.widowControl, 'widowControl', op);
}

function validateSetOutlineLevel(input: unknown): asserts input is ParagraphsSetOutlineLevelInput {
  const op = 'format.paragraph.setOutlineLevel';
  assertParagraphTarget(input, op);
  assertNoUnknownParagraphFields(input as Record<string, unknown>, SET_OUTLINE_LEVEL_KEYS, op);
  const rec = input as Record<string, unknown>;
  if (rec.outlineLevel === undefined) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${op} requires an outlineLevel field.`);
  }
  if (rec.outlineLevel !== null) {
    if (
      typeof rec.outlineLevel !== 'number' ||
      !Number.isInteger(rec.outlineLevel) ||
      rec.outlineLevel < 0 ||
      rec.outlineLevel > 9
    ) {
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        `${op} outlineLevel must be an integer 0–9, or null. Got ${JSON.stringify(rec.outlineLevel)}.`,
        { field: 'outlineLevel', value: rec.outlineLevel },
      );
    }
  }
}

function validateSetFlowOptions(input: unknown): asserts input is ParagraphsSetFlowOptionsInput {
  const op = 'format.paragraph.setFlowOptions';
  assertParagraphTarget(input, op);
  assertNoUnknownParagraphFields(input as Record<string, unknown>, SET_FLOW_OPTIONS_KEYS, op);
  const rec = input as Record<string, unknown>;
  assertNotEmptyPatch(
    rec,
    [
      'contextualSpacing',
      'pageBreakBefore',
      'suppressAutoHyphens',
      'autoSpaceDE',
      'autoSpaceDN',
      'adjustRightInd',
      'snapToGrid',
    ],
    op,
  );

  if (rec.contextualSpacing !== undefined) assertStrictBoolean(rec.contextualSpacing, 'contextualSpacing', op);
  if (rec.pageBreakBefore !== undefined) assertStrictBoolean(rec.pageBreakBefore, 'pageBreakBefore', op);
  if (rec.suppressAutoHyphens !== undefined) assertStrictBoolean(rec.suppressAutoHyphens, 'suppressAutoHyphens', op);
  if (rec.autoSpaceDE !== undefined) assertStrictBoolean(rec.autoSpaceDE, 'autoSpaceDE', op);
  if (rec.autoSpaceDN !== undefined) assertStrictBoolean(rec.autoSpaceDN, 'autoSpaceDN', op);
  if (rec.adjustRightInd !== undefined) assertStrictBoolean(rec.adjustRightInd, 'adjustRightInd', op);
  if (rec.snapToGrid !== undefined) assertStrictBoolean(rec.snapToGrid, 'snapToGrid', op);
}

function validateSetTabStop(input: unknown): asserts input is ParagraphsSetTabStopInput {
  const op = 'format.paragraph.setTabStop';
  assertParagraphTarget(input, op);
  assertNoUnknownParagraphFields(input as Record<string, unknown>, SET_TAB_STOP_KEYS, op);
  const rec = input as Record<string, unknown>;

  if (rec.position === undefined) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${op} requires a position field.`);
  }
  assertInteger(rec.position, 'position', op);

  if (rec.alignment === undefined) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${op} requires an alignment field.`);
  }
  assertOneOf(rec.alignment, 'alignment', TAB_STOP_ALIGNMENTS, op);

  if (rec.leader !== undefined) {
    assertOneOf(rec.leader, 'leader', TAB_STOP_LEADERS, op);
  }
}

function validateClearTabStop(input: unknown): asserts input is ParagraphsClearTabStopInput {
  const op = 'format.paragraph.clearTabStop';
  assertParagraphTarget(input, op);
  assertNoUnknownParagraphFields(input as Record<string, unknown>, CLEAR_TAB_STOP_KEYS, op);
  const rec = input as Record<string, unknown>;
  if (rec.position === undefined) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${op} requires a position field.`);
  }
  assertInteger(rec.position, 'position', op);
}

function validateClearAllTabStops(input: unknown): asserts input is ParagraphsClearAllTabStopsInput {
  assertParagraphTarget(input, 'format.paragraph.clearAllTabStops');
  assertNoUnknownParagraphFields(
    input as Record<string, unknown>,
    CLEAR_ALL_TAB_STOPS_KEYS,
    'format.paragraph.clearAllTabStops',
  );
}

function validateSetBorder(input: unknown): asserts input is ParagraphsSetBorderInput {
  const op = 'format.paragraph.setBorder';
  assertParagraphTarget(input, op);
  assertNoUnknownParagraphFields(input as Record<string, unknown>, SET_BORDER_KEYS, op);
  const rec = input as Record<string, unknown>;

  if (rec.side === undefined) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${op} requires a side field.`);
  }
  assertOneOf(rec.side, 'side', BORDER_SIDES, op);

  if (rec.style === undefined) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${op} requires a style field.`);
  }
  assertNonEmptyString(rec.style, 'style', op);

  if (rec.color !== undefined) assertNonEmptyString(rec.color, 'color', op);
  if (rec.size !== undefined) assertNonNegativeInteger(rec.size, 'size', op);
  if (rec.space !== undefined) assertNonNegativeInteger(rec.space, 'space', op);
}

function validateClearBorder(input: unknown): asserts input is ParagraphsClearBorderInput {
  const op = 'format.paragraph.clearBorder';
  assertParagraphTarget(input, op);
  assertNoUnknownParagraphFields(input as Record<string, unknown>, CLEAR_BORDER_KEYS, op);
  const rec = input as Record<string, unknown>;
  if (rec.side === undefined) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${op} requires a side field.`);
  }
  assertOneOf(rec.side, 'side', CLEAR_BORDER_SIDES, op);
}

function validateSetShading(input: unknown): asserts input is ParagraphsSetShadingInput {
  const op = 'format.paragraph.setShading';
  assertParagraphTarget(input, op);
  assertNoUnknownParagraphFields(input as Record<string, unknown>, SET_SHADING_KEYS, op);
  const rec = input as Record<string, unknown>;
  assertNotEmptyPatch(rec, ['fill', 'color', 'pattern'], op);

  if (rec.fill !== undefined) assertNonEmptyString(rec.fill, 'fill', op);
  if (rec.color !== undefined) assertNonEmptyString(rec.color, 'color', op);
  if (rec.pattern !== undefined) assertNonEmptyString(rec.pattern, 'pattern', op);
}

function validateClearShading(input: unknown): asserts input is ParagraphsClearShadingInput {
  assertParagraphTarget(input, 'format.paragraph.clearShading');
  assertNoUnknownParagraphFields(input as Record<string, unknown>, CLEAR_SHADING_KEYS, 'format.paragraph.clearShading');
}

function validateMarkRunColorRef(value: unknown, fieldName: string, operation: string): void {
  assertNonEmptyObject(value, fieldName, operation);
  assertNoUnknownFields(value, MARK_RUN_COLOR_REF_KEYS, `${operation} ${fieldName}`);
  if (value.model === undefined) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${operation} ${fieldName}.model is required.`, {
      field: `${fieldName}.model`,
    });
  }
  assertOneOf(value.model, `${fieldName}.model`, MARK_RUN_COLOR_MODE_VALUES, operation);
  if (value.model === 'rgb') {
    if (value.theme !== undefined || value.tint !== undefined || value.shade !== undefined) {
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        `${operation} ${fieldName} rgb colors may only set model and value.`,
        { field: fieldName, value },
      );
    }
    assertNonEmptyString(value.value, `${fieldName}.value`, operation);
    return;
  }
  if (value.model === 'theme') {
    if (value.value !== undefined) {
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        `${operation} ${fieldName} theme colors may not set value.`,
        { field: `${fieldName}.value`, value: value.value },
      );
    }
    assertNonEmptyString(value.theme, `${fieldName}.theme`, operation);
    if (value.tint !== undefined) assertInteger(value.tint, `${fieldName}.tint`, operation);
    if (value.shade !== undefined) assertInteger(value.shade, `${fieldName}.shade`, operation);
    return;
  }
  if (value.value !== undefined || value.theme !== undefined || value.tint !== undefined || value.shade !== undefined) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${operation} ${fieldName} auto colors may only set model.`, {
      field: fieldName,
      value,
    });
  }
}

function validateMarkRunFonts(value: unknown, fieldName: string, operation: string): void {
  assertNonEmptyObject(value, fieldName, operation);
  assertNoUnknownFields(value, MARK_RUN_FONTS_KEYS, `${operation} ${fieldName}`);
  for (const [key, nestedValue] of Object.entries(value)) {
    assertNonEmptyString(nestedValue, `${fieldName}.${key}`, operation);
  }
}

function validateMarkRunLanguages(value: unknown, fieldName: string, operation: string): void {
  assertNonEmptyObject(value, fieldName, operation);
  assertNoUnknownFields(value, MARK_RUN_LANG_KEYS, `${operation} ${fieldName}`);
  for (const [key, nestedValue] of Object.entries(value)) {
    assertNonEmptyString(nestedValue, `${fieldName}.${key}`, operation);
  }
}

function validateMarkRunUnderline(value: unknown, fieldName: string, operation: string): void {
  assertNonEmptyObject(value, fieldName, operation);
  assertNoUnknownFields(value, MARK_RUN_UNDERLINE_KEYS, `${operation} ${fieldName}`);
  if (value.style !== undefined) assertNonEmptyString(value.style, `${fieldName}.style`, operation);
  if (value.color !== undefined) validateMarkRunColorRef(value.color, `${fieldName}.color`, operation);
}

function validateMarkRunShading(value: unknown, fieldName: string, operation: string): void {
  assertNonEmptyObject(value, fieldName, operation);
  assertNoUnknownFields(value, MARK_RUN_SHADING_KEYS, `${operation} ${fieldName}`);
  if (value.fill !== undefined) validateMarkRunColorRef(value.fill, `${fieldName}.fill`, operation);
  if (value.color !== undefined) validateMarkRunColorRef(value.color, `${fieldName}.color`, operation);
  if (value.pattern !== undefined) assertNonEmptyString(value.pattern, `${fieldName}.pattern`, operation);
}

function validateMarkRunBorder(value: unknown, fieldName: string, operation: string): void {
  assertNonEmptyObject(value, fieldName, operation);
  assertNoUnknownFields(value, MARK_RUN_BORDER_KEYS, `${operation} ${fieldName}`);
  if (value.style !== undefined) assertNonEmptyString(value.style, `${fieldName}.style`, operation);
  if (value.width !== undefined) assertFiniteNumber(value.width, `${fieldName}.width`, operation);
  if (value.space !== undefined) assertFiniteNumber(value.space, `${fieldName}.space`, operation);
  if (value.color !== undefined) validateMarkRunColorRef(value.color, `${fieldName}.color`, operation);
  if (value.frame !== undefined) assertStrictBoolean(value.frame, `${fieldName}.frame`, operation);
  if (value.shadow !== undefined) assertStrictBoolean(value.shadow, `${fieldName}.shadow`, operation);
}

function validateMarkRunPropValue(key: string, value: unknown, operation: string): void {
  const fieldName = `markRunProps.${key}`;
  if (value === undefined) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${operation} ${fieldName} must not be undefined.`, {
      field: fieldName,
    });
  }

  switch (key) {
    case 'fonts':
      validateMarkRunFonts(value, fieldName, operation);
      return;
    case 'lang':
      validateMarkRunLanguages(value, fieldName, operation);
      return;
    case 'color':
      validateMarkRunColorRef(value, fieldName, operation);
      return;
    case 'underline':
      validateMarkRunUnderline(value, fieldName, operation);
      return;
    case 'shading':
      validateMarkRunShading(value, fieldName, operation);
      return;
    case 'border':
      validateMarkRunBorder(value, fieldName, operation);
      return;
    case 'fontFamily':
    case 'highlight':
    case 'textEffect':
      assertNonEmptyString(value, fieldName, operation);
      return;
    case 'fontSize':
    case 'fontSizeCs':
    case 'characterSpacing':
    case 'characterScale':
    case 'kern':
    case 'baselineShift':
    case 'fitTextWidth':
      assertFiniteNumber(value, fieldName, operation);
      return;
    case 'verticalAlign':
      assertOneOf(value, fieldName, MARK_RUN_VERTICAL_ALIGN_VALUES, operation);
      return;
    case 'cs':
    case 'rtl':
    case 'bold':
    case 'boldCs':
    case 'italic':
    case 'italicCs':
    case 'strikethrough':
    case 'doubleStrikethrough':
    case 'caps':
    case 'smallCaps':
    case 'outline':
    case 'shadow':
    case 'emboss':
    case 'imprint':
    case 'vanish':
    case 'webHidden':
    case 'specVanish':
      assertStrictBoolean(value, fieldName, operation);
      return;
    default:
      throw new DocumentApiValidationError('INVALID_INPUT', `${operation} does not support ${fieldName}.`, {
        field: fieldName,
      });
  }
}

function validateSetMarkRunProps(input: unknown): asserts input is ParagraphsSetMarkRunPropsInput {
  const op = 'format.paragraph.setMarkRunProps';
  assertParagraphTarget(input, op);
  assertNoUnknownParagraphFields(input as Record<string, unknown>, SET_MARK_RUN_PROPS_KEYS, op);
  const rec = input as Record<string, unknown>;
  if (rec.markRunProps === undefined) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${op} requires a markRunProps field.`);
  }
  if (!isRecord(rec.markRunProps)) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${op} markRunProps must be an object.`, {
      field: 'markRunProps',
      value: rec.markRunProps,
    });
  }
  if (Object.keys(rec.markRunProps).length === 0) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${op} markRunProps must declare at least one run property.`,
      { field: 'markRunProps' },
    );
  }
  assertNoUnknownFields(rec.markRunProps, MARK_RUN_PROPS_FIELD_KEYS, `${op} markRunProps`);
  for (const [key, value] of Object.entries(rec.markRunProps)) {
    validateMarkRunPropValue(key, value, op);
  }
}

function validateSetDirection(input: unknown): asserts input is ParagraphsSetDirectionInput {
  const op = 'format.paragraph.setDirection';
  assertParagraphTarget(input, op);
  assertNoUnknownParagraphFields(input as Record<string, unknown>, SET_DIRECTION_KEYS, op);
  const rec = input as Record<string, unknown>;
  if (rec.direction === undefined) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${op} requires a direction field.`);
  }
  assertOneOf(rec.direction, 'direction', PARAGRAPH_DIRECTIONS, op);
  if (rec.alignmentPolicy !== undefined) {
    assertOneOf(rec.alignmentPolicy, 'alignmentPolicy', ALIGNMENT_POLICIES, op);
  }
}

function validateClearDirection(input: unknown): asserts input is ParagraphsClearDirectionInput {
  assertParagraphTarget(input, 'format.paragraph.clearDirection');
  assertNoUnknownParagraphFields(
    input as Record<string, unknown>,
    CLEAR_DIRECTION_KEYS,
    'format.paragraph.clearDirection',
  );
}

function validateSetNumbering(input: unknown): asserts input is ParagraphsSetNumberingInput {
  const op = 'format.paragraph.setNumbering';
  assertParagraphTarget(input, op);
  assertNoUnknownParagraphFields(input as Record<string, unknown>, SET_NUMBERING_KEYS, op);
  const rec = input as Record<string, unknown>;
  if (rec.numId === undefined) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${op} requires a numId field.`);
  }
  if (typeof rec.numId !== 'number' || !Number.isInteger(rec.numId) || rec.numId < 1) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${op} numId must be a positive integer (numId 0 is the no-numbering sentinel). Got ${JSON.stringify(rec.numId)}.`,
      { field: 'numId', value: rec.numId },
    );
  }
  if (rec.level !== undefined) {
    if (typeof rec.level !== 'number' || !Number.isInteger(rec.level) || rec.level < 0 || rec.level > 8) {
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        `${op} level must be an integer 0-8. Got ${JSON.stringify(rec.level)}.`,
        { field: 'level', value: rec.level },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Execute functions: validate then delegate
// ---------------------------------------------------------------------------

export function executeParagraphsSetStyle(
  adapter: ParagraphsAdapter,
  input: ParagraphsSetStyleInput,
  options?: MutationOptions,
): ParagraphMutationResult {
  validateSetStyle(input);
  return adapter.setStyle(input, normalizeMutationOptions(options));
}

export function executeParagraphsSetStyleRef(
  adapter: ParagraphsAdapter,
  input: ParagraphsSetStyleRefInput,
  options?: MutationOptions,
): ParagraphMutationResult {
  validateSetStyleRef(input);
  return adapter.setStyleRef(input, normalizeMutationOptions(options));
}

export function executeParagraphsClearStyle(
  adapter: ParagraphsAdapter,
  input: ParagraphsClearStyleInput,
  options?: MutationOptions,
): ParagraphMutationResult {
  validateClearStyle(input);
  return adapter.clearStyle(input, normalizeMutationOptions(options));
}

export function executeParagraphsResetDirectFormatting(
  adapter: ParagraphsAdapter,
  input: ParagraphsResetDirectFormattingInput,
  options?: MutationOptions,
): ParagraphMutationResult {
  validateResetDirectFormatting(input);
  return adapter.resetDirectFormatting(input, normalizeMutationOptions(options));
}

export function executeParagraphsSetAlignment(
  adapter: ParagraphsAdapter,
  input: ParagraphsSetAlignmentInput,
  options?: MutationOptions,
): ParagraphMutationResult {
  validateSetAlignment(input);
  return adapter.setAlignment(input, normalizeMutationOptions(options));
}

export function executeParagraphsClearAlignment(
  adapter: ParagraphsAdapter,
  input: ParagraphsClearAlignmentInput,
  options?: MutationOptions,
): ParagraphMutationResult {
  validateClearAlignment(input);
  return adapter.clearAlignment(input, normalizeMutationOptions(options));
}

export function executeParagraphsSetIndentation(
  adapter: ParagraphsAdapter,
  input: ParagraphsSetIndentationInput,
  options?: MutationOptions,
): ParagraphMutationResult {
  validateSetIndentation(input);
  return adapter.setIndentation(input, normalizeMutationOptions(options));
}

export function executeParagraphsClearIndentation(
  adapter: ParagraphsAdapter,
  input: ParagraphsClearIndentationInput,
  options?: MutationOptions,
): ParagraphMutationResult {
  validateClearIndentation(input);
  return adapter.clearIndentation(input, normalizeMutationOptions(options));
}

export function executeParagraphsSetSpacing(
  adapter: ParagraphsAdapter,
  input: ParagraphsSetSpacingInput,
  options?: MutationOptions,
): ParagraphMutationResult {
  validateSetSpacing(input);
  return adapter.setSpacing(input, normalizeMutationOptions(options));
}

export function executeParagraphsClearSpacing(
  adapter: ParagraphsAdapter,
  input: ParagraphsClearSpacingInput,
  options?: MutationOptions,
): ParagraphMutationResult {
  validateClearSpacing(input);
  return adapter.clearSpacing(input, normalizeMutationOptions(options));
}

export function executeParagraphsSetKeepOptions(
  adapter: ParagraphsAdapter,
  input: ParagraphsSetKeepOptionsInput,
  options?: MutationOptions,
): ParagraphMutationResult {
  validateSetKeepOptions(input);
  return adapter.setKeepOptions(input, normalizeMutationOptions(options));
}

export function executeParagraphsSetOutlineLevel(
  adapter: ParagraphsAdapter,
  input: ParagraphsSetOutlineLevelInput,
  options?: MutationOptions,
): ParagraphMutationResult {
  validateSetOutlineLevel(input);
  return adapter.setOutlineLevel(input, normalizeMutationOptions(options));
}

export function executeParagraphsSetFlowOptions(
  adapter: ParagraphsAdapter,
  input: ParagraphsSetFlowOptionsInput,
  options?: MutationOptions,
): ParagraphMutationResult {
  validateSetFlowOptions(input);
  return adapter.setFlowOptions(input, normalizeMutationOptions(options));
}

export function executeParagraphsSetTabStop(
  adapter: ParagraphsAdapter,
  input: ParagraphsSetTabStopInput,
  options?: MutationOptions,
): ParagraphMutationResult {
  validateSetTabStop(input);
  return adapter.setTabStop(input, normalizeMutationOptions(options));
}

export function executeParagraphsClearTabStop(
  adapter: ParagraphsAdapter,
  input: ParagraphsClearTabStopInput,
  options?: MutationOptions,
): ParagraphMutationResult {
  validateClearTabStop(input);
  return adapter.clearTabStop(input, normalizeMutationOptions(options));
}

export function executeParagraphsClearAllTabStops(
  adapter: ParagraphsAdapter,
  input: ParagraphsClearAllTabStopsInput,
  options?: MutationOptions,
): ParagraphMutationResult {
  validateClearAllTabStops(input);
  return adapter.clearAllTabStops(input, normalizeMutationOptions(options));
}

export function executeParagraphsSetBorder(
  adapter: ParagraphsAdapter,
  input: ParagraphsSetBorderInput,
  options?: MutationOptions,
): ParagraphMutationResult {
  validateSetBorder(input);
  return adapter.setBorder(input, normalizeMutationOptions(options));
}

export function executeParagraphsClearBorder(
  adapter: ParagraphsAdapter,
  input: ParagraphsClearBorderInput,
  options?: MutationOptions,
): ParagraphMutationResult {
  validateClearBorder(input);
  return adapter.clearBorder(input, normalizeMutationOptions(options));
}

export function executeParagraphsSetShading(
  adapter: ParagraphsAdapter,
  input: ParagraphsSetShadingInput,
  options?: MutationOptions,
): ParagraphMutationResult {
  validateSetShading(input);
  return adapter.setShading(input, normalizeMutationOptions(options));
}

export function executeParagraphsClearShading(
  adapter: ParagraphsAdapter,
  input: ParagraphsClearShadingInput,
  options?: MutationOptions,
): ParagraphMutationResult {
  validateClearShading(input);
  return adapter.clearShading(input, normalizeMutationOptions(options));
}

export function executeParagraphsSetMarkRunProps(
  adapter: ParagraphsAdapter,
  input: ParagraphsSetMarkRunPropsInput,
  options?: MutationOptions,
): ParagraphMutationResult {
  validateSetMarkRunProps(input);
  if (!adapter.setMarkRunProps) {
    return {
      success: false,
      failure: {
        code: 'CAPABILITY_UNAVAILABLE',
        message:
          'format.paragraph.setMarkRunProps is not available. The host engine has not provided an adapter for this capability.',
        details: { operation: 'format.paragraph.setMarkRunProps' },
      },
    };
  }
  return adapter.setMarkRunProps(input, normalizeMutationOptions(options));
}

export function executeParagraphsSetDirection(
  adapter: ParagraphsAdapter,
  input: ParagraphsSetDirectionInput,
  options?: MutationOptions,
): ParagraphMutationResult {
  validateSetDirection(input);
  return adapter.setDirection(input, normalizeMutationOptions(options));
}

export function executeParagraphsClearDirection(
  adapter: ParagraphsAdapter,
  input: ParagraphsClearDirectionInput,
  options?: MutationOptions,
): ParagraphMutationResult {
  validateClearDirection(input);
  return adapter.clearDirection(input, normalizeMutationOptions(options));
}

export function executeParagraphsSetNumbering(
  adapter: ParagraphsAdapter,
  input: ParagraphsSetNumberingInput,
  options?: MutationOptions,
): ParagraphMutationResult {
  validateSetNumbering(input);
  return adapter.setNumbering(input, normalizeMutationOptions(options));
}
