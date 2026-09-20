/** Runtime dispatch for the generic invoke API. */
import { OPERATION_DEFINITIONS } from '../contract/operation-definitions.js';
import type { OperationRegistry } from '../contract/operation-registry.js';
import { OPERATION_IDS, type OperationId } from '../contract/types.js';
import type { DocumentApi } from '../index.js';

type DispatchOutput<K extends OperationId> = K extends 'mutations.preview' | 'mutations.apply'
  ? Promise<OperationRegistry[K]['output']>
  : K extends 'plan.execute'
    ? OperationRegistry[K]['output'] | Promise<OperationRegistry[K]['output']>
    : OperationRegistry[K]['output'];

type TypedDispatchHandler<K extends OperationId> = OperationRegistry[K]['options'] extends never
  ? (input: OperationRegistry[K]['input']) => DispatchOutput<K>
  : (input: OperationRegistry[K]['input'], options?: OperationRegistry[K]['options']) => DispatchOutput<K>;

export type TypedDispatchTable = {
  [K in OperationId]: TypedDispatchHandler<K>;
};

type RuntimeMethod = (input?: unknown, options?: unknown) => unknown;
type RuntimeObject = Record<string, unknown>;

function resolveMember(api: DocumentApi, memberPath: string): { owner: RuntimeObject; method: RuntimeMethod } {
  const segments = memberPath.split('.');
  let owner = api as unknown as RuntimeObject;

  for (const segment of segments.slice(0, -1)) {
    const next = owner[segment];
    if ((typeof next !== 'object' && typeof next !== 'function') || next === null) {
      throw new Error(`Document API operation member path is unavailable: ${memberPath}`);
    }
    owner = next as RuntimeObject;
  }

  const method = owner[segments[segments.length - 1]!];
  if (typeof method !== 'function') {
    throw new Error(`Document API operation member path is not callable: ${memberPath}`);
  }

  return { owner, method: method as RuntimeMethod };
}

/**
 * Builds the generic invoke dispatch from the same operation definitions that
 * publish operation IDs and direct API member paths.
 */
export function buildDispatchTable(api: DocumentApi): TypedDispatchTable {
  return Object.fromEntries(
    OPERATION_IDS.map((operationId) => {
      const { owner, method } = resolveMember(api, OPERATION_DEFINITIONS[operationId].memberPath);
      return [operationId, (input: unknown, options?: unknown) => method.call(owner, input, options)];
    }),
  ) as TypedDispatchTable;
}
