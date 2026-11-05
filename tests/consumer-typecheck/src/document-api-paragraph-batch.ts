import type { DocumentApi } from 'superdoc';
import type { BrowserDocumentApi, SuperDocUI } from 'superdoc/ui';

declare const doc: DocumentApi;
declare const ui: SuperDocUI;
declare const browserDoc: BrowserDocumentApi;

type Input = Parameters<DocumentApi['format']['paragraph']['applyBatch']>[0];
type Result = Awaited<ReturnType<DocumentApi['format']['paragraph']['applyBatch']>>;
type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Operation = Input['operations'][number];
type _RejectNested = Assert<Equal<Extract<Operation, { operationId: 'plan.execute' }>, never>>;
type _RejectInline = Assert<Equal<Extract<Operation, { operationId: 'format.apply' }>, never>>;
type _RejectInvalidUnit = Assert<
  Equal<
    { operationId: 'format.paragraph.setSpacing'; input: { lineRule: 'pixels'; line: 2 } } extends Operation
      ? true
      : false,
    false
  >
>;
type _NoActionTargets = Assert<Equal<'target' extends keyof Operation['input'] ? true : false, false>>;

const input: Input = {
  targets: [
    { kind: 'block', nodeType: 'paragraph', nodeId: 'paragraph-a', story: { kind: 'story', storyType: 'body' } },
  ],
  operations: [
    { operationId: 'styles.paragraph.setStyleRef', input: { styleId: 'Heading1' } },
    { operationId: 'format.paragraph.clearSpacing', input: {} },
    { operationId: 'format.paragraph.setSpacing', input: { before: 120, line: 360, lineRule: 'auto' } },
    { operationId: 'format.paragraph.setKeepOptions', input: { keepLines: null, keepNext: false } },
    { operationId: 'format.paragraph.setBorder', input: { side: 'bottom', style: 'single', color: 'FF0000', size: 8 } },
    { operationId: 'format.paragraph.setTabStop', input: { position: 1440, alignment: 'right', leader: 'dot' } },
    { operationId: 'format.paragraph.setMarkRunProps', input: { markRunProps: { bold: true } } },
  ],
};
const browserResult = browserDoc.format.paragraph.applyBatch(input);
type _BrowserResultParity = Assert<Equal<typeof browserResult, Result | Promise<Result>>>;
const normalizedBrowserResult: Promise<Result> = Promise.resolve(browserResult);
void normalizedBrowserResult;
const direct: Promise<Result> = doc.format.paragraph.applyBatch(input, { expectedRevision: '1', changeMode: 'direct' });
const invoked = doc.invoke({ operationId: 'format.paragraph.applyBatch', input, options: { changeMode: 'tracked' } });
type _DirectInvokeParity = Assert<Equal<Awaited<typeof invoked>, Result>>;
type _PromiseParity = Assert<Equal<typeof invoked, typeof direct>>;
async function consume() {
  const result = await direct;
  if (result.success) {
    const id: string = result.resolution.targets[0].nodeId;
    const mode: 'direct' | 'tracked' | undefined = result.appliedChangeMode;
    const refs = result.trackedChangeRefs;
    void [id, mode, refs];
  } else {
    const code: string = result.failure.code;
    const details: unknown = result.failure.details;
    void [code, details];
  }
  return ui.commands.get('copy-format').getState();
}
void consume;
