import type { DocumentApi } from 'superdoc/ui';

declare const doc: DocumentApi;
type Input = Parameters<DocumentApi['tables']['sort']>[0];
type Result = ReturnType<DocumentApi['tables']['sort']>;
type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const keys: Input['keys'] = [{ columnIndex: 0, direction: 'ascending', type: 'text' }];
const automatic: Input = { nodeId: 'table', keys };
const allRows: Input = { nodeId: 'table', keys, skipHeaderRows: 0 };
const twoHeaders: Input = { nodeId: 'table', keys, skipHeaderRows: 2 };
const result: Result = doc.tables.sort(twoHeaders);
const optionalCount: Assert<Equal<Input['skipHeaderRows'], number | undefined>> = true;
const discriminant: Assert<Equal<Result['success'], boolean>> = true;
const successKeys: Assert<
  Equal<keyof Extract<Result, { success: true }>, 'success' | 'appliedChangeMode' | 'table' | 'trackedChangeRefs'>
> = true;
const failureKeys: Assert<Equal<keyof Extract<Result, { success: false }>, 'success' | 'failure'>> = true;

if (result.success) {
  const mode: 'direct' | 'tracked' | undefined = result.appliedChangeMode;
  const kind: 'block' | undefined = result.table?.kind;
  const nodeType: 'table' | undefined = result.table?.nodeType;
  const nodeId: string | undefined = result.table?.nodeId;
  const refs: Array<{ kind: 'entity'; entityType: 'trackedChange'; entityId: string }> | undefined =
    result.trackedChangeRefs;
  void [mode, kind, nodeType, nodeId, refs];
} else {
  const code: string = result.failure.code;
  const message: string = result.failure.message;
  const details: unknown = result.failure.details;
  void [code, message, details];
}
void [automatic, allRows, optionalCount, discriminant, successKeys, failureKeys];
