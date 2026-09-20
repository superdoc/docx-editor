import type { CommandCatalog, CommandStaticMetadata, OperationId } from './types.js';
import { OPERATION_IDS, projectFromDefinitions } from './operation-definitions.js';

export const COMMAND_CATALOG: CommandCatalog = projectFromDefinitions((_id, entry) => entry.metadata);

/** Operation IDs whose catalog entry has `mutates: true`. */
export const MUTATING_OPERATION_IDS = OPERATION_IDS.filter((operationId) => COMMAND_CATALOG[operationId].mutates);

/** Maps each operation to its human-readable description. */
export const OPERATION_DESCRIPTION_MAP: Record<OperationId, string> = projectFromDefinitions(
  (_id, entry) => entry.description,
);

/** Maps each operation to whether it requires an open document to execute. */
export const OPERATION_REQUIRES_DOCUMENT_CONTEXT_MAP: Record<OperationId, boolean> = projectFromDefinitions(
  (_id, entry) => entry.requiresDocumentContext,
);

/** Maps each operation to whether it may execute as an entry inside plan.execute. */
export const OPERATION_BATCHABLE_MAP: Record<OperationId, boolean> = projectFromDefinitions(
  (_id, entry) => entry.batchable !== false,
);

/** Transport aliases keyed by operation, external field, then canonical input field. */
export const OPERATION_INPUT_ALIAS_MAP: Readonly<Partial<Record<OperationId, Readonly<Record<string, string>>>>> =
  projectFromDefinitions((_id, entry) => entry.inputAliases) as Partial<
    Record<OperationId, Readonly<Record<string, string>>>
  >;

/** Maps each operation to its expected-result description. */
export const OPERATION_EXPECTED_RESULT_MAP: Record<OperationId, string> = projectFromDefinitions(
  (_id, entry) => entry.expectedResult,
);

/**
 * Returns the static metadata for a given operation.
 *
 * @param operationId - A known operation identifier from the command catalog.
 * @returns The compile-time metadata describing idempotency, failure codes, throw policy, etc.
 */
export function getCommandMetadata(operationId: keyof typeof COMMAND_CATALOG): CommandStaticMetadata {
  return COMMAND_CATALOG[operationId];
}
