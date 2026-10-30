import type { MutationOptions } from '../write/write.js';
import { normalizeMutationOptions } from '../write/write.js';
import { DocumentApiValidationError } from '../errors.js';
import { TABLE_COLOR_PATTERN as TABLE_BORDER_COLOR_PATTERN } from './color-formats.js';
import type {
  TablesApplyStyleInput,
  TablesSetBordersInput,
  TablesSetCellPaddingInput,
  TablesSetLayoutInput,
  TablesSetTableOptionsInput,
  TablesSortInput,
  TableBorderSpec,
  TableStyleOptionsPatch,
} from '../types/table-operations.types.js';
import { isRecord } from '../object-guards.js';

// ---------------------------------------------------------------------------
// Locator validation
// ---------------------------------------------------------------------------

type RowLocatorInput = { target?: unknown; nodeId?: unknown; rowIndex?: unknown };

/**
 * Validates that a table locator has exactly one of `target` or `nodeId`.
 *
 * This is the single validation function for all table operations.
 * Every table operation uses the same `target`/`nodeId` locator vocabulary.
 */
function validateTableLocator(input: { target?: unknown; nodeId?: unknown }, operationName: string): void {
  const hasTarget = input.target !== undefined;
  const hasNodeId = input.nodeId !== undefined;

  if (hasTarget && hasNodeId) {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `Cannot combine target with nodeId on ${operationName} request. Use exactly one locator mode.`,
      { fields: ['target', 'nodeId'] },
    );
  }

  if (!hasTarget && !hasNodeId) {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `${operationName} requires a target. Provide either target or nodeId.`,
    );
  }

  if (hasNodeId && typeof input.nodeId !== 'string') {
    throw new DocumentApiValidationError('INVALID_TARGET', `nodeId must be a string, got ${typeof input.nodeId}.`, {
      field: 'nodeId',
      value: input.nodeId,
    });
  }
}

function validateTablesSetLayoutInput(input: TablesSetLayoutInput): void {
  validateTableLocator(input, 'tables.setLayout');

  if (
    input.preferredWidthType !== undefined &&
    input.preferredWidthType !== 'dxa' &&
    input.preferredWidthType !== 'auto' &&
    input.preferredWidthType !== 'pct'
  ) {
    throw new DocumentApiValidationError(
      'INVALID_ARGUMENT',
      `tables.setLayout: preferredWidthType must be one of "dxa", "auto", or "pct"; received ${String(input.preferredWidthType)}.`,
      { field: 'preferredWidthType', value: input.preferredWidthType },
    );
  }

  if (input.preferredWidthType === 'auto' && input.preferredWidth !== undefined && input.preferredWidth !== 0) {
    throw new DocumentApiValidationError(
      'INVALID_ARGUMENT',
      'tables.setLayout: preferredWidth must be omitted or 0 when preferredWidthType is "auto".',
      { fields: ['preferredWidth', 'preferredWidthType'] },
    );
  }
}

/**
 * Validation options for the row locator.
 *
 * `allowAppendShorthand`: when true, a table-level locator (target/nodeId
 * pointing at a table) with NEITHER `rowIndex` NOR `position` is accepted —
 * the caller's adapter is expected to compute "below the last row". Used by
 * `tables.insertRow`. All other row ops require `rowIndex` when targeting a
 * table; pass this as `false` (the default) for them.
 */
interface RowLocatorOptions {
  allowAppendShorthand?: boolean;
}

function validateRowLocator(input: RowLocatorInput, operationName: string, options: RowLocatorOptions = {}): void {
  validateTableLocator(input, operationName);

  const hasPosition = (input as { position?: unknown }).position != null;
  const hasRowIndex = input.rowIndex != null;
  const isAppendShorthand = !!options.allowAppendShorthand && !hasRowIndex && !hasPosition;

  if (input.nodeId != null) {
    if (!hasRowIndex && !isAppendShorthand) {
      throw new DocumentApiValidationError(
        'INVALID_TARGET',
        `${operationName}: rowIndex is required when using nodeId for row operations. ` +
          `Use target to address a row directly, or pass nodeId + rowIndex to address a row within a table.`,
      );
    }
    return;
  }

  if (!isRecord(input.target) || input.target.kind !== 'block') return;

  if (input.target.nodeType === 'table' && !hasRowIndex && !isAppendShorthand) {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `${operationName}: rowIndex is required when target is a table.`,
    );
  }

  if (input.target.nodeType === 'tableRow' && hasRowIndex) {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `${operationName}: rowIndex must not be provided when target is a row node. ` +
        `Either pass a table target with rowIndex, or pass a row target without rowIndex.`,
    );
  }
}

type CellOrTableScopedCellLocatorInput = {
  target?: unknown;
  nodeId?: unknown;
  rowIndex?: unknown;
  columnIndex?: unknown;
};

/**
 * Returns `true` when the input carries non-`undefined` row + column coordinates,
 * meaning it can participate in table-scoped cell targeting.
 *
 * This is the validation-time check for coordinate presence. Adapter-level
 * resolution may still refine ambiguous `nodeId` handoffs by resolved node
 * type so payloads like `TableCellInfo` from `tables.getCells()` continue to
 * work as direct cell locators.
 */
export function hasTableScopedCellCoordinates(input: CellOrTableScopedCellLocatorInput): boolean {
  return input.rowIndex != null && input.columnIndex != null;
}

/**
 * Validates a mixed cell locator: either a direct cell locator (target/nodeId
 * pointing at a cell, no coordinates) or a table-scoped cell locator
 * (target/nodeId pointing at a table + rowIndex + columnIndex).
 *
 * Rejects:
 * - table target without both coordinates
 * - only one of rowIndex / columnIndex
 * - cell target plus coordinates
 */
function validateCellOrTableScopedCellLocator(input: CellOrTableScopedCellLocatorInput, operationName: string): void {
  validateTableLocator(input, operationName);

  const hasRowIndex = input.rowIndex != null;
  const hasColumnIndex = input.columnIndex != null;

  if (hasRowIndex !== hasColumnIndex) {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `${operationName}: both rowIndex and columnIndex are required when using table-scoped cell targeting. ` +
        `Provide both or neither.`,
      { fields: ['rowIndex', 'columnIndex'] },
    );
  }

  const hasCoordinates = hasTableScopedCellCoordinates(input);

  // When target is a block address, check that coordinates match the node type.
  if (isRecord(input.target) && input.target.kind === 'block') {
    if (input.target.nodeType === 'tableCell' && hasCoordinates) {
      throw new DocumentApiValidationError(
        'INVALID_TARGET',
        `${operationName}: rowIndex/columnIndex must not be provided when target is a cell node. ` +
          `Either pass a table target with coordinates, or pass a cell target without coordinates.`,
        { fields: ['rowIndex', 'columnIndex'] },
      );
    }

    if (input.target.nodeType === 'table' && !hasCoordinates) {
      throw new DocumentApiValidationError(
        'INVALID_TARGET',
        `${operationName}: rowIndex and columnIndex are required when target is a table.`,
        { fields: ['rowIndex', 'columnIndex'] },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// tables.split input normalization
// ---------------------------------------------------------------------------

/**
 * Normalizes legacy `atRowIndex` to canonical `rowIndex` for tables.split.
 *
 * Accepts either name, prefers `rowIndex` when both match, and rejects
 * conflicting dual-name input. Returns the input unchanged when only
 * `rowIndex` is present.
 */
export function normalizeTablesSplitInput<T extends { rowIndex?: number }>(input: T): T {
  const legacy = (input as Record<string, unknown>).atRowIndex;
  if (legacy === undefined) return input;

  if (input.rowIndex !== undefined && input.rowIndex !== legacy) {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      'tables.split: cannot provide both rowIndex and atRowIndex with different values.',
      { fields: ['rowIndex', 'atRowIndex'] },
    );
  }

  const { atRowIndex: _legacy, ...rest } = input as Record<string, unknown>;
  return { ...rest, rowIndex: legacy } as T;
}

// ---------------------------------------------------------------------------
// Typed execute helpers
// ---------------------------------------------------------------------------

/**
 * Execute a table operation that uses the standard locator (target/nodeId).
 * Validates the locator and normalizes MutationOptions.
 */
export function executeTableLocatorOp<TInput extends { target?: unknown; nodeId?: unknown }, TResult>(
  operationName: string,
  adapter: (input: TInput, options?: MutationOptions) => TResult,
  input: TInput,
  options?: MutationOptions,
): TResult {
  validateTableLocator(input, operationName);
  return adapter(input, normalizeMutationOptions(options));
}

export function executeTablesSetLayoutOp<TResult>(
  adapter: (input: TablesSetLayoutInput, options?: MutationOptions) => TResult,
  input: TablesSetLayoutInput,
  options?: MutationOptions,
): TResult {
  validateTablesSetLayoutInput(input);
  return adapter(input, normalizeMutationOptions(options));
}

export function executeTablesSortOp<TResult>(
  adapter: (input: TablesSortInput, options?: MutationOptions) => TResult,
  input: TablesSortInput,
  options?: MutationOptions,
): TResult {
  if (input.skipHeaderRows !== undefined && (!Number.isSafeInteger(input.skipHeaderRows) || input.skipHeaderRows < 0)) {
    throw new DocumentApiValidationError(
      'INVALID_ARGUMENT',
      'tables.sort: skipHeaderRows must be a nonnegative safe integer.',
      { field: 'skipHeaderRows', value: input.skipHeaderRows },
    );
  }
  return executeTableLocatorOp('tables.sort', adapter, input, options);
}

export function executeRowLocatorOp<TInput extends RowLocatorInput, TResult>(
  operationName: string,
  adapter: (input: TInput, options?: MutationOptions) => TResult,
  input: TInput,
  options?: MutationOptions,
  rowLocatorOptions?: RowLocatorOptions,
): TResult {
  validateRowLocator(input, operationName, rowLocatorOptions);
  return adapter(input, normalizeMutationOptions(options));
}

export function executeCellOrTableScopedCellLocatorOp<TInput extends CellOrTableScopedCellLocatorInput, TResult>(
  operationName: string,
  adapter: (input: TInput, options?: MutationOptions) => TResult,
  input: TInput,
  options?: MutationOptions,
): TResult {
  validateCellOrTableScopedCellLocator(input, operationName);
  return adapter(input, normalizeMutationOptions(options));
}

/**
 * Execute a document-level table mutation (no locator validation needed).
 * Only normalizes MutationOptions.
 */
export function executeDocumentLevelTableOp<TInput, TResult>(
  adapter: (input: TInput, options?: MutationOptions) => TResult,
  input: TInput,
  options?: MutationOptions,
): TResult {
  return adapter(input, normalizeMutationOptions(options));
}

// ---------------------------------------------------------------------------
// Convenience operation validation helpers
// ---------------------------------------------------------------------------

const VALID_STYLE_OPTION_FLAGS = new Set([
  'headerRow',
  'lastRow',
  'totalRow',
  'firstColumn',
  'lastColumn',
  'bandedRows',
  'bandedColumns',
]);

function validateStyleOptionsPatch(options: TableStyleOptionsPatch, operationName: string): void {
  const keys = Object.keys(options);
  for (const key of keys) {
    if (!VALID_STYLE_OPTION_FLAGS.has(key)) {
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        `${operationName}: unrecognized style option flag "${key}".`,
        { field: 'styleOptions', value: key },
      );
    }
    if (typeof options[key as keyof TableStyleOptionsPatch] !== 'boolean') {
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        `${operationName}: style option "${key}" must be a boolean.`,
        { field: `styleOptions.${key}` },
      );
    }
  }
}

function validateBorderSpec(spec: TableBorderSpec, fieldPath: string, operationName: string): void {
  if (typeof spec !== 'object' || spec === null) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operationName}: ${fieldPath} must be a border spec object.`,
    );
  }
  if (typeof spec.lineStyle !== 'string' || spec.lineStyle.length === 0) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operationName}: ${fieldPath}.lineStyle must be a non-empty string.`,
      {
        field: `${fieldPath}.lineStyle`,
      },
    );
  }
  if (typeof spec.lineWeightPt !== 'number' || !Number.isFinite(spec.lineWeightPt) || spec.lineWeightPt <= 0) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operationName}: ${fieldPath}.lineWeightPt must be a positive number.`,
      { field: `${fieldPath}.lineWeightPt` },
    );
  }
  if (typeof spec.color !== 'string' || spec.color.length === 0) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operationName}: ${fieldPath}.color must be a non-empty string.`,
      {
        field: `${fieldPath}.color`,
      },
    );
  }
  if (!TABLE_BORDER_COLOR_PATTERN.test(spec.color)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operationName}: ${fieldPath}.color must be a 6-digit hex color without "#" or "auto".`,
      {
        field: `${fieldPath}.color`,
      },
    );
  }
}

function validateBorderPatchEdge(
  value: TableBorderSpec | null | undefined,
  edgeName: string,
  operationName: string,
): void {
  if (value === undefined || value === null) return;
  validateBorderSpec(value, `edges.${edgeName}`, operationName);
}

// TABLE_BORDER_COLOR_PATTERN imported above from ./color-formats.js — single
// source of truth shared with the schema validator in contract/schemas.ts.

const VALID_APPLY_TO_VALUES = new Set([
  'all',
  'outside',
  'inside',
  'top',
  'bottom',
  'left',
  'right',
  'insideH',
  'insideV',
]);

const VALID_BORDER_EDGE_KEYS = new Set(['top', 'bottom', 'left', 'right', 'insideH', 'insideV']);

// ---------------------------------------------------------------------------
// Convenience operation execute wrappers
// ---------------------------------------------------------------------------

/**
 * Validate and execute `tables.applyStyle`.
 */
export function executeTablesApplyStyle<TResult>(
  operationName: string,
  adapter: (input: TablesApplyStyleInput, options?: MutationOptions) => TResult,
  input: TablesApplyStyleInput,
  options?: MutationOptions,
): TResult {
  validateTableLocator(input, operationName);

  const hasStyleId = input.styleId !== undefined;
  const hasOptions = input.styleOptions !== undefined;

  if (!hasStyleId && !hasOptions) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operationName} requires at least one of styleId or styleOptions.`,
    );
  }

  if (hasStyleId && typeof input.styleId !== 'string') {
    throw new DocumentApiValidationError('INVALID_INPUT', `${operationName}: styleId must be a string.`, {
      field: 'styleId',
    });
  }

  if (hasStyleId && input.styleId === '') {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operationName}: styleId must be a non-empty string. Use tables.clearStyle to remove a style.`,
      { field: 'styleId' },
    );
  }

  if (hasOptions) {
    if (typeof input.styleOptions !== 'object' || input.styleOptions === null || Array.isArray(input.styleOptions)) {
      throw new DocumentApiValidationError('INVALID_INPUT', `${operationName}: styleOptions must be a plain object.`, {
        field: 'styleOptions',
      });
    }
    const optionKeys = Object.keys(input.styleOptions);
    if (!hasStyleId && optionKeys.length === 0) {
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        `${operationName}: styleOptions must contain at least one flag when styleId is absent.`,
        { field: 'styleOptions' },
      );
    }
    if (optionKeys.length > 0) {
      validateStyleOptionsPatch(input.styleOptions!, operationName);
    }
  }

  return adapter(input, normalizeMutationOptions(options));
}

/**
 * Validate and execute `tables.setBorders`.
 */
export function executeTablesSetBorders<TResult>(
  operationName: string,
  adapter: (input: TablesSetBordersInput, options?: MutationOptions) => TResult,
  input: TablesSetBordersInput,
  options?: MutationOptions,
): TResult {
  validateTableLocator(input, operationName);

  if (!('mode' in input) || (input.mode !== 'applyTo' && input.mode !== 'edges')) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${operationName}: mode must be "applyTo" or "edges".`, {
      field: 'mode',
    });
  }

  if (input.mode === 'applyTo') {
    if (!VALID_APPLY_TO_VALUES.has(input.applyTo)) {
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        `${operationName}: applyTo must be one of: ${[...VALID_APPLY_TO_VALUES].join(', ')}.`,
        { field: 'applyTo' },
      );
    }
    if (input.border === undefined) {
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        `${operationName}: border is required when mode is "applyTo".`,
        { field: 'border' },
      );
    }
    if (input.border !== null) {
      validateBorderSpec(input.border, 'border', operationName);
    }
  }

  if (input.mode === 'edges') {
    if (!input.edges || typeof input.edges !== 'object') {
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        `${operationName}: edges is required when mode is "edges".`,
        { field: 'edges' },
      );
    }
    const edgeKeys = Object.keys(input.edges);
    const definedKeys = edgeKeys.filter(
      (k) => VALID_BORDER_EDGE_KEYS.has(k) && input.edges[k as keyof typeof input.edges] !== undefined,
    );
    if (definedKeys.length === 0) {
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        `${operationName}: edges must contain at least one defined edge.`,
        { field: 'edges' },
      );
    }
    for (const key of edgeKeys) {
      if (!VALID_BORDER_EDGE_KEYS.has(key)) {
        throw new DocumentApiValidationError('INVALID_INPUT', `${operationName}: unrecognized edge "${key}".`, {
          field: `edges.${key}`,
        });
      }
      validateBorderPatchEdge(input.edges[key as keyof typeof input.edges], key, operationName);
    }
  }

  return adapter(input, normalizeMutationOptions(options));
}

/**
 * Validate and execute `tables.setTableOptions`.
 */
export function executeTablesSetTableOptions<TResult>(
  operationName: string,
  adapter: (input: TablesSetTableOptionsInput, options?: MutationOptions) => TResult,
  input: TablesSetTableOptionsInput,
  options?: MutationOptions,
): TResult {
  validateTableLocator(input, operationName);

  const hasMargins = input.defaultCellMargins !== undefined;
  const hasSpacing = input.cellSpacingPt !== undefined;

  if (!hasMargins && !hasSpacing) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${operationName} requires at least one of defaultCellMargins or cellSpacingPt.`,
    );
  }

  if (hasMargins) {
    if (
      typeof input.defaultCellMargins !== 'object' ||
      input.defaultCellMargins === null ||
      Array.isArray(input.defaultCellMargins)
    ) {
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        `${operationName}: defaultCellMargins must be a plain object with topPt, rightPt, bottomPt, leftPt.`,
        { field: 'defaultCellMargins' },
      );
    }
    const m = input.defaultCellMargins;
    const sides = ['topPt', 'rightPt', 'bottomPt', 'leftPt'] as const;
    for (const side of sides) {
      if (typeof m[side] !== 'number' || !Number.isFinite(m[side]) || m[side] < 0) {
        throw new DocumentApiValidationError(
          'INVALID_INPUT',
          `${operationName}: defaultCellMargins.${side} must be a non-negative number.`,
          { field: `defaultCellMargins.${side}` },
        );
      }
    }
  }

  if (hasSpacing && input.cellSpacingPt !== null) {
    if (typeof input.cellSpacingPt !== 'number' || !Number.isFinite(input.cellSpacingPt) || input.cellSpacingPt < 0) {
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        `${operationName}: cellSpacingPt must be a non-negative number or null.`,
        { field: 'cellSpacingPt' },
      );
    }
  }

  return adapter(input, normalizeMutationOptions(options));
}

/**
 * Validate and execute `tables.setCellPadding`.
 *
 * Partial side updates are accepted and preserve omitted sides, but at least
 * one of `topPt`, `rightPt`, `bottomPt`, or `leftPt` must be present. An
 * all-omitted call is rejected so the direct typed API agrees with the schema's
 * any-of side requirement (and the adapter never authors an empty `w:tcMar`).
 */
export function executeTablesSetCellPadding<TResult>(
  operationName: string,
  adapter: (input: TablesSetCellPaddingInput, options?: MutationOptions) => TResult,
  input: TablesSetCellPaddingInput,
  options?: MutationOptions,
): TResult {
  validateTableLocator(input, operationName);

  const paddingSides = ['topPt', 'rightPt', 'bottomPt', 'leftPt'] as const;
  let hasAnySide = false;

  for (const side of paddingSides) {
    const value = input[side] as unknown;
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new DocumentApiValidationError(
        'INVALID_ARGUMENT',
        `${operationName}: ${side} must be a non-negative finite number.`,
        { field: side, value },
      );
    }
    hasAnySide = true;
  }

  if (!hasAnySide) {
    throw new DocumentApiValidationError(
      'INVALID_ARGUMENT',
      `${operationName} requires at least one of topPt, rightPt, bottomPt, or leftPt.`,
      { fields: ['topPt', 'rightPt', 'bottomPt', 'leftPt'] },
    );
  }

  return adapter(input, normalizeMutationOptions(options));
}
