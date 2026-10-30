/**
 * The browser shape of the Document API facade (`superdoc.activeEditor.doc`).
 *
 * A leaf module on purpose. Two unrelated type surfaces need this shape — the
 * package's public contract types (`core/types`) and the self-contained
 * `superdoc/ui` controller types — and `core/types` imports the `SuperDoc`
 * class type. Defining it here keeps `superdoc/ui` from pulling that class into
 * its declaration graph, and keeps the mapped type written once rather than
 * once per consumer. Its only dependency is `@superdoc/document-api`.
 */

import type {
  DocumentApi,
  DynamicInvokeRequest,
  InsertInput,
  InvokeRequest,
  InvokeResult,
  OperationId,
  OperationCancellation,
  ReplaceInput,
  TrackedReplaceMutationOptions,
  TrackedRichContentMutationOptions,
} from '@superdoc/document-api';

type MaybePromise<T> = T | Promise<T>;

type BrowserDocumentApiObject<T> = {
  [K in keyof T]: BrowserDocumentApiValue<T[K]>;
};

type BrowserDocumentApiValue<T> = T extends (...args: infer Args) => infer Return
  ? ((...args: Args) => MaybePromise<Awaited<Return>>) & BrowserDocumentApiObject<T>
  : T extends object
    ? BrowserDocumentApiObject<T>
    : T;

/**
 * Browser V2 active-editor Document API facade (`superdoc.activeEditor.doc`).
 * In the browser this surface is intentionally async-capable: callers must
 * tolerate promise-returning reads/writes, including the default
 * worker-backed runtime. SDK/headless callers should continue using the
 * synchronous `@superdoc/document-api` surface directly.
 */
export type BrowserDocumentApi = Omit<BrowserDocumentApiObject<DocumentApi>, 'invoke'> & {
  invoke<T extends OperationId>(request: InvokeRequest<T>): MaybePromise<Awaited<InvokeResult<T>>>;
  invoke(request: DynamicInvokeRequest): unknown;
  insert(
    input: InsertInput,
    options: TrackedRichContentMutationOptions & OperationCancellation,
  ): MaybePromise<Awaited<ReturnType<DocumentApi['insert']>>>;
  replace(
    input: Exclude<ReplaceInput, { target: { kind: 'story'; storyType: 'body' }; text: string }>,
    options: TrackedReplaceMutationOptions,
  ): MaybePromise<Awaited<ReturnType<DocumentApi['replace']>>>;
};

/**
 * Every operation optional, at any depth.
 *
 * A callable member keeps its call signature *and* its properties, mirroring
 * what {@link BrowserDocumentApiValue} does. Parts of the Document API are both:
 * `capabilities` is callable and carries `get()`, so reconstructing only the call
 * signature would make `doc.capabilities.get()` a type error on a value that
 * supports it at runtime.
 *
 * Intersected rather than unioned with the property bag. A union would let a
 * non-callable object stand in for a callable member, which also makes the
 * member type unenforceable: `{ comments: { list: 42 } }` satisfies a
 * props-only alternative and the type stops catching wrong operations at all.
 */
type DeepPartial<T> = T extends (...args: infer Args) => infer Return
  ? ((...args: Args) => Return) & { [K in keyof T]?: DeepPartial<T[K]> }
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/**
 * What a *host* may supply as `activeEditor.doc`.
 *
 * A host is duck-typed: a custom adapter or a test stub is expected to carry
 * only the operations it actually implements, and the controller resolves
 * operations defensively at runtime rather than assuming any of them exist.
 * Requiring the whole surface here would reject exactly the partial hosts the
 * contract is documented to accept.
 *
 * `CustomCommandContext.doc` uses this same partial type, because that value is
 * the host's own object passed straight through. It can promise no more than the
 * host contract does. {@link BrowserDocumentApi}, the complete facade, is the
 * type of `activeEditor.doc` on a real `Editor`.
 *
 * Partial, not permissive: the operations a host does declare are still
 * checked, so a typo or a wrong member type fails instead of passing as
 * `any`.
 */
export type PartialBrowserDocumentApi = DeepPartial<BrowserDocumentApi>;
