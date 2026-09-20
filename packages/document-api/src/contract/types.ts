export {
  OPERATION_IDEMPOTENCY_VALUES,
  type OperationIdempotency,
  OPERATION_TRACKED_SUPPORT_VALUES,
  type OperationTrackedSupport,
  PRE_APPLY_THROW_CODES,
  type PreApplyThrowCode,
  type CommandThrowPolicy,
  type CommandStaticMetadata,
} from './metadata-types.js';

export {
  type OperationId,
  OPERATION_IDS,
  SINGLETON_OPERATION_IDS,
  NAMESPACED_OPERATION_IDS,
} from './operation-definitions.js';

import type { OperationId } from './operation-definitions.js';
import { OPERATION_IDS } from './operation-definitions.js';
import type { CommandStaticMetadata } from './metadata-types.js';

export const CONTRACT_VERSION = '0.1.0';

export const JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';

export type CommandCatalog = {
  readonly [K in OperationId]: CommandStaticMetadata;
};

const OPERATION_ID_FORMAT = /^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*){0,2}$/;

/**
 * Checks whether a string matches the syntactic format of an operation ID
 * (`camelCase`, `namespace.camelCase`, or `group.subgroup.camelCase`).
 *
 * @param operationId - The string to validate.
 * @returns `true` if the string matches the expected format.
 */
export function isValidOperationIdFormat(operationId: string): boolean {
  return OPERATION_ID_FORMAT.test(operationId);
}

/**
 * Type-guard that narrows a string to the {@link OperationId} union.
 *
 * @param operationId - The string to check.
 * @returns `true` if the string is a known operation ID.
 */
export function isOperationId(operationId: string): operationId is OperationId {
  return (OPERATION_IDS as readonly string[]).includes(operationId);
}

/**
 * Asserts that a string is a valid, known {@link OperationId}.
 *
 * @param operationId - The string to assert.
 * @throws {Error} If the string is not a recognised operation ID.
 */
export function assertOperationId(operationId: string): asserts operationId is OperationId {
  if (!isValidOperationIdFormat(operationId) || !isOperationId(operationId)) {
    throw new Error(`Unknown operationId "${operationId}".`);
  }
}
