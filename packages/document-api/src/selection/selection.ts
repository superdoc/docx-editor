/**
 * `selection.current` operation: reads the editor's current selection
 * and projects it into the Document API's text-address model.
 *
 * This is the primitive consumers use to build custom comments UIs,
 * floating toolbars, mention popovers, etc., without reaching into
 * ProseMirror internals.
 */

import type {
  SelectionCurrentInput,
  SelectionExtractOoxmlInput,
  SelectionExtractOoxmlResult,
  SelectionOoxmlDependency,
  SelectionTableCellsTarget,
  SelectionInfo,
} from './selection.types.js';
import { DocumentApiValidationError } from '../errors.js';
import { isRecord, assertNoUnknownFields } from '../validation-primitives.js';
import { isSelectionTarget } from '../validation/selection-target-validator.js';

export type {
  SelectionCurrentInput,
  SelectionExtractOoxmlInput,
  SelectionExtractOoxmlResult,
  SelectionOoxmlDependency,
  SelectionTableCellsTarget,
  TableSelectionInfo,
  SelectionInfo,
} from './selection.types.js';

/**
 * Engine-specific adapter for the selection API.
 */
export interface SelectionAdapter {
  /** Read the editor's current selection. */
  current(input: SelectionCurrentInput): SelectionInfo;
  extractOoxml(input: SelectionExtractOoxmlInput): SelectionExtractOoxmlResult;
}

/**
 * Public selection API exposed on `editor.doc.selection`.
 */
export interface SelectionApi {
  /**
   * Read the editor's current selection as a portable {@link SelectionInfo}.
   *
   * Use to drive custom UIs (toolbars, sidebars, popovers) without
   * reaching into ProseMirror internals. For comment-target construction,
   * pass the resulting `target` directly to `comments.create`.
   */
  current(input?: SelectionCurrentInput): SelectionInfo;
  /** Capture the addressed selected OOXML and its package dependencies. */
  extractOoxml(input: SelectionExtractOoxmlInput): SelectionExtractOoxmlResult;
}

export function executeSelectionExtractOoxml(
  adapter: SelectionAdapter,
  input: SelectionExtractOoxmlInput,
): SelectionExtractOoxmlResult {
  if (!isRecord(input)) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'selection.extractOoxml input must be an object.');
  }
  assertNoUnknownFields(input, new Set(['at', 'selection']), 'selection.extractOoxml');
  if (input.selection === 'current' && input.at === undefined) {
    return adapter.extractOoxml(input as SelectionExtractOoxmlInput);
  }
  if (
    input.selection !== undefined ||
    !input.at ||
    typeof input.at !== 'object' ||
    (input.at.kind !== 'selection' && input.at.kind !== 'tableCells')
  ) {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      'selection.extractOoxml requires a selection or table-cells target.',
    );
  }
  if (input.at.kind === 'tableCells') {
    const validPoint = (point: unknown): boolean =>
      isRecord(point) &&
      Number.isSafeInteger(point.rowIndex) &&
      (point.rowIndex as number) >= 0 &&
      Number.isSafeInteger(point.columnIndex) &&
      (point.columnIndex as number) >= 0;
    if (
      typeof input.at.tableId !== 'string' ||
      !input.at.tableId ||
      !validPoint(input.at.start) ||
      !validPoint(input.at.end)
    ) {
      throw new DocumentApiValidationError(
        'INVALID_TARGET',
        'Table selection requires a table ID and nonnegative cell coordinates.',
      );
    }
    return adapter.extractOoxml(input as unknown as SelectionExtractOoxmlInput);
  }
  if (!isSelectionTarget(input.at)) {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      'Selection endpoints must be valid text or node-edge points.',
    );
  }
  return adapter.extractOoxml(input as unknown as SelectionExtractOoxmlInput);
}

const SELECTION_CURRENT_ALLOWED_KEYS = new Set(['includeText']);

function validateSelectionCurrentInput(input: unknown): asserts input is SelectionCurrentInput {
  if (input === undefined) return;
  if (!isRecord(input)) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'selection.current input must be a non-null object.');
  }
  assertNoUnknownFields(input, SELECTION_CURRENT_ALLOWED_KEYS, 'selection.current');
  if (input.includeText !== undefined && typeof input.includeText !== 'boolean') {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `includeText must be a boolean, got ${typeof input.includeText}.`,
      { field: 'includeText', value: input.includeText },
    );
  }
}

export function executeSelectionCurrent(adapter: SelectionAdapter, input?: SelectionCurrentInput): SelectionInfo {
  validateSelectionCurrentInput(input);
  return adapter.current(input ?? {});
}
