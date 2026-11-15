import { DocumentApiValidationError } from '../errors.js';
import type {
  HistoryGroupHandle,
  HistoryEndGroupInput,
  HistoryEndGroupResult,
  HistoryState,
  HistoryActionResult,
} from './history.types.js';

/**
 * Engine-specific adapter for history operations.
 */
export interface HistoryAdapter {
  beginGroup?(): HistoryGroupHandle;
  endGroup?(input: HistoryEndGroupInput): HistoryEndGroupResult;
  get(): HistoryState;
  undo(): HistoryActionResult;
  redo(): HistoryActionResult;
}

/**
 * Public API shape for the history namespace on DocumentApi.
 */
export interface HistoryApi {
  beginGroup(): HistoryGroupHandle;
  endGroup(input: HistoryEndGroupInput): HistoryEndGroupResult;
  get(): HistoryState;
  undo(): HistoryActionResult;
  redo(): HistoryActionResult;
}

/**
 * Reads undo/redo history state from the underlying adapter.
 *
 * @param adapter - Engine-specific history adapter.
 * @returns Current history state snapshot.
 */
export function executeHistoryGet(adapter: HistoryAdapter): HistoryState {
  return adapter.get();
}

/**
 * Executes an undo action via the underlying adapter.
 *
 * @param adapter - Engine-specific history adapter.
 * @returns Undo action result with noop + revision metadata.
 */
export function executeHistoryUndo(adapter: HistoryAdapter): HistoryActionResult {
  return adapter.undo();
}

/**
 * Executes a redo action via the underlying adapter.
 *
 * @param adapter - Engine-specific history adapter.
 * @returns Redo action result with noop + revision metadata.
 */
export function executeHistoryRedo(adapter: HistoryAdapter): HistoryActionResult {
  return adapter.redo();
}

export function validateHistoryEndGroupInput(input: HistoryEndGroupInput): void {
  if (
    typeof input !== 'object' ||
    input === null ||
    Array.isArray(input) ||
    typeof input.groupId !== 'string' ||
    !input.groupId.trim() ||
    Object.keys(input).some((key) => key !== 'groupId')
  ) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'history.endGroup requires a non-empty groupId.');
  }
}

export function executeHistoryBeginGroup(adapter: HistoryAdapter): HistoryGroupHandle {
  if (!adapter.beginGroup)
    throw new DocumentApiValidationError('CAPABILITY_UNAVAILABLE', 'History grouping is unavailable in this host.');
  return adapter.beginGroup();
}

export function executeHistoryEndGroup(adapter: HistoryAdapter, input: HistoryEndGroupInput): HistoryEndGroupResult {
  validateHistoryEndGroupInput(input);
  if (!adapter.endGroup)
    throw new DocumentApiValidationError('CAPABILITY_UNAVAILABLE', 'History grouping is unavailable in this host.');
  return adapter.endGroup(input);
}
