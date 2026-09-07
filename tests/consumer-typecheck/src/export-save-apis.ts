/**
 * Consumer typecheck: export and save public APIs on `SuperDoc`.
 *
 * Locks the `export`, `exportEditorsToDOCX`, and `save` contracts
 * against the emitted `.d.ts` with strict identity equality. A future
 * migration that narrows or widens any of these signatures will fail
 * the obligation diff rather than slipping past CI.
 *
 * Source tightenings landed alongside this fixture (treated as a
 * contract audit, per the surface-rewrite plan):
 *
 *   - `exportEditorsToDOCX` previously inferred `Promise<(Blob | null)[]>`
 *     because the runtime `filter(Boolean)` did not narrow in TS.
 *     Replaced with a type-predicate filter
 *     (`(file): file is Blob => file != null`) so the public contract
 *     matches the runtime guarantee: every entry in the array is a
 *     non-null Blob.
 *
 *   - `save` previously inferred `Promise<void[]>` because it returned
 *     the result of `Promise.all([this.#triggerCollaborationSaves()])`.
 *     The array shape was incidental - the consumer contract is "wait
 *     until saves flush", not "receive an array". Declared
 *     `Promise<void>` explicitly and discarded the array.
 *
 * `export` was already clean: it always resolves to a `Blob`
 * (`createDownload` returns the input Blob; the no-download branches
 * return the Blob directly).
 *
 * Drained obligations (5):
 *   - export:parameters / export:returns
 *   - exportEditorsToDOCX:parameters / exportEditorsToDOCX:returns
 *   - save:returns
 */
import type { ExportParams, SuperDoc } from 'superdoc';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type AssertEqual<A, B> = Equal<A, B> extends true ? true : never;

declare const sd: SuperDoc;

// ─── export ─────────────────────────────────────────────────────────
// Builds DOCX blobs (delegating to exportEditorsToDOCX), optionally
// zips with any additional files, and either triggers a browser
// download or returns the Blob.
const _exportParamsOk: AssertEqual<Parameters<SuperDoc['export']>, [params?: ExportParams]> = true;
const _exportReturnOk: AssertEqual<ReturnType<SuperDoc['export']>, Promise<Blob>> = true;
const _exportedBlob: Promise<Blob> = sd.export({ commentsType: 'external', triggerDownload: false });
void _exportedBlob;

// ─── exportEditorsToDOCX ────────────────────────────────────────────
// Inline options shape (the source param is not aliased to a named
// public type). The return is the post-tightening Promise<Blob[]>.
type ExportEditorsOpts = {
  commentsType?: string;
  isFinalDoc?: boolean;
  fieldsHighlightColor?: string | null;
};
const _exportEditorsParamsOk: AssertEqual<
  Parameters<SuperDoc['exportEditorsToDOCX']>,
  [options?: ExportEditorsOpts]
> = true;
const _exportEditorsReturnOk: AssertEqual<ReturnType<SuperDoc['exportEditorsToDOCX']>, Promise<Blob[]>> = true;
const _docxBlobs: Promise<Blob[]> = sd.exportEditorsToDOCX({ commentsType: 'external', isFinalDoc: false });
void _docxBlobs;

// ─── save ───────────────────────────────────────────────────────────
// Awaits editor saves without returning serialized bytes.
const _saveReturnOk: AssertEqual<ReturnType<SuperDoc['save']>, Promise<void>> = true;
const _saved: Promise<void> = sd.save();
void _saved;

void [_exportParamsOk, _exportReturnOk, _exportEditorsParamsOk, _exportEditorsReturnOk, _saveReturnOk];
