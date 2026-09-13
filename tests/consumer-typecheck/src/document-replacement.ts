import type { DocumentReplacementResult, SuperDoc } from 'superdoc';
import type { DocumentHandle, DocumentReplacementResult as UiResult } from 'superdoc/ui';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
type Source = File | Blob | ArrayBuffer | Uint8Array;
type RootInput = Assert<Equal<Parameters<SuperDoc['replaceDocument']>, [Source]>>;
type RootOutput = Assert<Equal<ReturnType<SuperDoc['replaceDocument']>, Promise<DocumentReplacementResult>>>;
type UiInput = Assert<Equal<Parameters<DocumentHandle['replaceDocument']>, [Source]>>;
type UiOutput = Assert<Equal<ReturnType<DocumentHandle['replaceDocument']>, Promise<DocumentReplacementResult>>>;
type SharedResult = Assert<Equal<UiResult, DocumentReplacementResult>>;

declare const superdoc: SuperDoc;
async function replace(source: Source): Promise<void> {
  const result = await superdoc.replaceDocument(source);
  if (!result.ok) {
    const reason: string | undefined = result.reason;
    void reason;
  }
  // @ts-expect-error Host mount objects are not part of the public result.
  result.mount;
  // @ts-expect-error Callers use ok, not internal host lifecycle state.
  result.state;
}
// @ts-expect-error Fetch URLs into a Blob before replacing mounted content.
superdoc.replaceDocument('/next.docx');
void replace;
export type ReplacementContracts = [RootInput, RootOutput, UiInput, UiOutput, SharedResult];
