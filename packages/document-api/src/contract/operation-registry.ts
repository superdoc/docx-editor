/**
 * Type projection for dynamic invocation.
 *
 * Operation identity and member paths come from `OPERATION_DEFINITIONS`; input,
 * options, and output types come from the corresponding `DocumentApiSurface`
 * method. This keeps direct methods and `invoke()` on one TypeScript contract.
 */
import type { DocumentApiSurface } from '../index.js';
import type { InsertInput } from '../insert/insert.js';
import type { ReplaceInput, TrackedReplaceMutationOptions } from '../replace/replace.js';
import type { BodyStoryLocator } from '../types/story.types.js';
import type { OperationCancellation } from '../write/operation-cancellation.js';
import type { TrackedRichContentMutationOptions } from '../write/write.js';
import { OPERATION_DEFINITIONS } from './operation-definitions.js';
import type { OperationId } from './types.js';

type ResolveMemberPath<T, Path extends string> = Path extends `${infer Head}.${infer Tail}`
  ? Head extends keyof T
    ? ResolveMemberPath<T[Head], Tail>
    : never
  : Path extends keyof T
    ? T[Path]
    : never;

type MethodArguments<T> = T extends (...args: infer Arguments) => unknown ? Arguments : never;
type MethodInput<T> = MethodArguments<T> extends readonly [] ? undefined : MethodArguments<T>[0];
type MethodOptions<T> = 2 extends MethodArguments<T>['length'] ? Exclude<MethodArguments<T>[1], undefined> : never;
type MethodReturn<T> = T extends (...args: never[]) => infer Output ? Output : never;

/**
 * Canonical type-level mapping used by `invoke()` and its dispatch table.
 * Promise-returning mutation-plan operations store their resolved payload so
 * `InvokeResult` can retain the established async call shape.
 */
export type OperationRegistry = {
  [Id in OperationId]: ResolveMemberPath<
    DocumentApiSurface,
    (typeof OPERATION_DEFINITIONS)[Id]['memberPath']
  > extends infer Method
    ? {
        input: MethodInput<Method>;
        options: MethodOptions<Method>;
        output: Id extends 'mutations.preview' | 'mutations.apply' | 'plan.execute' | 'format.paragraph.applyBatch'
          ? Awaited<MethodReturn<Method>>
          : MethodReturn<Method>;
      }
    : never;
};

type UnresolvedOperationIds = {
  [Id in OperationId]: ResolveMemberPath<DocumentApiSurface, (typeof OPERATION_DEFINITIONS)[Id]['memberPath']> extends (
    ...args: never[]
  ) => unknown
    ? never
    : Id;
}[OperationId];
type AssertNoUnresolvedOperations<_OperationId extends never> = void;
type _AllOperationPathsResolveToMethods = AssertNoUnresolvedOperations<UnresolvedOperationIds>;

type MethodInvokeRequest<T extends OperationId> = OperationRegistry[T]['options'] extends never
  ? {
      operationId: T;
      input: OperationRegistry[T]['input'];
      options?: never;
    }
  : {
      operationId: T;
      input: OperationRegistry[T]['input'];
      options?: OperationRegistry[T]['options'];
    };

// MethodArguments projects the last direct overload. Preserve the earlier
// attributed overload's input/options correlation so only tracked writes carry an author or date.
type AttributedInvokeRequest<T extends OperationId> = T extends 'insert'
  ? { operationId: T; input: InsertInput; options: TrackedRichContentMutationOptions & OperationCancellation }
  : T extends 'replace'
    ? {
        operationId: T;
        input: Exclude<ReplaceInput, { target: BodyStoryLocator; text: string }>;
        options: TrackedReplaceMutationOptions;
      }
    : never;

/** Typed invoke request narrowed by `operationId` and supported content shape. */
export type InvokeRequest<T extends OperationId> = MethodInvokeRequest<T> | AttributedInvokeRequest<T>;

/** Typed invoke result narrowed by `operationId`. */
export type InvokeResult<T extends OperationId> = T extends
  | 'mutations.preview'
  | 'mutations.apply'
  | 'format.paragraph.applyBatch'
  ? Promise<OperationRegistry[T]['output']>
  : T extends 'plan.execute'
    ? OperationRegistry[T]['output'] | Promise<OperationRegistry[T]['output']>
    : OperationRegistry[T]['output'];

export type OperationCall<T extends OperationId> =
  InvokeRequest<T> extends infer Request ? (Request extends unknown ? Omit<Request, 'operationId'> : never) : never;

export type OperationInput<T extends OperationId> = InvokeRequest<T>['input'];

export type OperationOptions<T extends OperationId> = Exclude<InvokeRequest<T>['options'], undefined>;

export type OperationOutput<T extends OperationId> = Awaited<InvokeResult<T>>;

/** Loose request for callers that resolve operation identity at runtime. */
export type DynamicInvokeRequest = {
  operationId: OperationId;
  input: unknown;
  options?: unknown;
};
