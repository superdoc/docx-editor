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
  SelectionInfo,
  SelectionReleaseSnapshotInput,
  SelectionReleaseSnapshotResult,
  OoxmlContentSource,
} from './selection.types.js';
import { DocumentApiValidationError } from '../errors.js';
import { assertNoUnknownFields } from '../validation-primitives.js';
import { isRecord } from '../object-guards.js';
import { isSelectionTarget } from '../validation/selection-target-validator.js';

export type {
  SelectionCurrentInput,
  SelectionExtractOoxmlInput,
  SelectionExtractOoxmlResult,
  SelectionOoxmlDependency,
  SelectionTableCellsTarget,
  TableSelectionInfo,
  SelectionInfo,
  SelectionReleaseSnapshotInput,
  SelectionReleaseSnapshotResult,
  OoxmlContentSource,
} from './selection.types.js';

/**
 * Engine-specific adapter for the selection API.
 */
export interface SelectionAdapter {
  readonly supportsRetainedOoxml?: boolean;
  /** Read the editor's current selection. */
  current(input: SelectionCurrentInput): SelectionInfo;
  extractOoxml(input: SelectionExtractOoxmlInput): SelectionExtractOoxmlResult;
  releaseSnapshot?(input: SelectionReleaseSnapshotInput): SelectionReleaseSnapshotResult;
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
  /** Release an exact restoration handle without changing document or history. */
  releaseSnapshot(input: SelectionReleaseSnapshotInput): SelectionReleaseSnapshotResult;
}

export function executeSelectionExtractOoxml(
  adapter: SelectionAdapter,
  input: SelectionExtractOoxmlInput,
): SelectionExtractOoxmlResult {
  if (!isRecord(input)) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'selection.extractOoxml input must be an object.');
  }
  assertNoUnknownFields(input, new Set(['at', 'selection', 'retain']), 'selection.extractOoxml');
  if (input.retain !== undefined && typeof input.retain !== 'boolean') {
    throw new DocumentApiValidationError('INVALID_INPUT', 'retain must be a boolean.');
  }
  if (input.retain && !adapter.supportsRetainedOoxml)
    throw new DocumentApiValidationError(
      'CAPABILITY_UNAVAILABLE',
      'Exact selection retention is unavailable in this runtime.',
    );
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
      (input.at.selectionMode !== undefined && input.at.selectionMode !== 'cells') ||
      (input.at.isRectangular !== undefined && input.at.isRectangular !== true) ||
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

const SELECTION_CURRENT_ALLOWED_KEYS = new Set(['includeText', 'includeLogicalChanges']);

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
  if (input.includeLogicalChanges !== undefined && typeof input.includeLogicalChanges !== 'boolean') {
    throw new DocumentApiValidationError('INVALID_INPUT', 'includeLogicalChanges must be a boolean.', {
      field: 'includeLogicalChanges',
      value: input.includeLogicalChanges,
    });
  }
}

export function executeSelectionCurrent(adapter: SelectionAdapter, input?: SelectionCurrentInput): SelectionInfo {
  validateSelectionCurrentInput(input);
  const result = adapter.current(input ?? {});
  if (input?.includeLogicalChanges && result.logicalChangeIds === undefined) {
    throw new DocumentApiValidationError(
      'CAPABILITY_UNAVAILABLE',
      'The current selection host does not provide a complete logical change inventory.',
    );
  }
  return result;
}

export function executeSelectionReleaseSnapshot(
  adapter: SelectionAdapter,
  input: SelectionReleaseSnapshotInput,
): SelectionReleaseSnapshotResult {
  if (!isRecord(input)) throw new DocumentApiValidationError('INVALID_INPUT', 'Snapshot input must be an object.');
  assertNoUnknownFields(input, new Set(['snapshotId']), 'selection.releaseSnapshot');
  if (typeof input.snapshotId !== 'string' || !input.snapshotId)
    throw new DocumentApiValidationError('INVALID_INPUT', 'snapshotId must be a nonempty string.');
  if (!adapter.releaseSnapshot)
    throw new DocumentApiValidationError('CAPABILITY_UNAVAILABLE', 'Snapshot retention is unavailable.');
  return adapter.releaseSnapshot(input);
}

export function isOoxmlContentSource<T>(input: T): input is T & OoxmlContentSource {
  return isRecord(input) && (input.type === 'ooxml' || input.capture !== undefined);
}

export function validateOoxmlContentSource(input: Record<string, unknown>): void {
  const capture = input.capture;
  const source = capture === undefined ? input : capture;
  if (!isRecord(source)) throw new DocumentApiValidationError('INVALID_INPUT', 'capture must be an OOXML manifest.');
  if (
    capture !== undefined &&
    (source.formatVersion !== 1 ||
      !isRecord(source.fragment) ||
      !isRecord(source.source) ||
      typeof source.source.partUri !== 'string' ||
      !['inline', 'blocks', 'table'].includes(String(source.fragment.placement)))
  )
    throw new DocumentApiValidationError('INVALID_INPUT', 'capture must be a version 1 selection OOXML manifest.');
  const xml = capture === undefined ? source.value : (source.fragment as Record<string, unknown>).xml;
  const namespaces =
    capture === undefined ? source.namespaces : (source.fragment as Record<string, unknown>).namespaces;
  if (
    typeof xml !== 'string' ||
    !isRecord(namespaces) ||
    Object.entries(namespaces).some(
      ([p, u]) =>
        (p !== '' && !/^[A-Za-z_][\w.-]*$/.test(p)) ||
        typeof u !== 'string' ||
        !u ||
        p === 'xmlns' ||
        (p === 'xml' && u !== 'http://www.w3.org/XML/1998/namespace'),
    )
  )
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      'Native OOXML requires string XML and valid namespace bindings.',
    );
  if (
    source.dependencies !== undefined &&
    (!Array.isArray(source.dependencies) ||
      source.dependencies.some(
        (d) =>
          !isRecord(d) ||
          typeof d.sourcePartUri !== 'string' ||
          typeof d.relationshipId !== 'string' ||
          !d.relationshipId ||
          typeof d.relationshipType !== 'string' ||
          !d.relationshipType ||
          typeof d.target !== 'string' ||
          !['Internal', 'External'].includes(String(d.targetMode)) ||
          (d.contentType !== null && typeof d.contentType !== 'string') ||
          (d.dataBase64 !== undefined && typeof d.dataBase64 !== 'string'),
      ))
  )
    throw new DocumentApiValidationError('INVALID_INPUT', 'Invalid OOXML dependency manifest.');
  if (capture === undefined && source.sourcePartUri !== undefined && typeof source.sourcePartUri !== 'string')
    throw new DocumentApiValidationError('INVALID_INPUT', 'sourcePartUri must be a string.');
}
