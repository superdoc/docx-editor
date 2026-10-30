import type { DocumentApi } from '@superdoc/document-api';

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type ClearContentResult = ReturnType<DocumentApi['clearContent']>;
type Success = Extract<ClearContentResult, { success: true }>;
type _Status = Assert<Equal<Success['status'], 'NO_OP' | undefined>>;
type _RejectsOtherStatus = Assert<{ success: true; status: 'CHANGED' } extends Success ? false : true>;
type _ClosedKeys = Assert<'unexpected' extends keyof Success ? false : true>;

const noop: Success = { success: true, status: 'NO_OP' };
const legacy: Success = { success: true };
declare const doc: DocumentApi;
const options: Parameters<DocumentApi['clearContent']>[0] = {};
const result: ClearContentResult = doc.clearContent(options);
if (result.success) {
  const status: 'NO_OP' | undefined = result.status;
  void status;
}
void noop;
void legacy;
