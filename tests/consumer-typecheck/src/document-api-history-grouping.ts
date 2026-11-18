import type {
  BrowserDocumentApi,
  DocumentApi,
  HistoryGroupHandle,
  HistoryEndGroupInput,
  HistoryEndGroupResult,
  OperationInput,
  OperationOutput,
} from 'superdoc/ui';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
type BeginParameters = Assert<Equal<Parameters<DocumentApi['history']['beginGroup']>, []>>;
type BeginReturn = Assert<Equal<ReturnType<DocumentApi['history']['beginGroup']>, HistoryGroupHandle>>;
type EndParameters = Assert<Equal<Parameters<DocumentApi['history']['endGroup']>, [input: HistoryEndGroupInput]>>;
type EndReturn = Assert<Equal<ReturnType<DocumentApi['history']['endGroup']>, HistoryEndGroupResult>>;
type BrowserEndInput = Assert<
  Equal<Parameters<BrowserDocumentApi['history']['endGroup']>, [input: HistoryEndGroupInput]>
>;
type BrowserBeginReturn = Assert<
  Equal<Awaited<ReturnType<BrowserDocumentApi['history']['beginGroup']>>, HistoryGroupHandle>
>;
type BrowserEndReturn = Assert<
  Equal<Awaited<ReturnType<BrowserDocumentApi['history']['endGroup']>>, HistoryEndGroupResult>
>;
type BeginInvokeInput = Assert<Equal<OperationInput<'history.beginGroup'>, undefined>>;
type EndInvokeInput = Assert<Equal<OperationInput<'history.endGroup'>, HistoryEndGroupInput>>;
type BeginInvokeOutput = Assert<Equal<OperationOutput<'history.beginGroup'>, HistoryGroupHandle>>;
type EndInvokeOutput = Assert<Equal<OperationOutput<'history.endGroup'>, HistoryEndGroupResult>>;
type MissingTokenRejected = Assert<Equal<{} extends HistoryEndGroupInput ? true : false, false>>;
type WrongTokenRejected = Assert<Equal<{ groupId: number } extends HistoryEndGroupInput ? true : false, false>>;

declare const doc: DocumentApi;
declare const browser: BrowserDocumentApi;
const group: HistoryGroupHandle = doc.history.beginGroup();
const result: HistoryEndGroupResult = doc.history.endGroup(group);
const invoked: HistoryGroupHandle = doc.invoke({ operationId: 'history.beginGroup', input: undefined });
const ended: HistoryEndGroupResult = doc.invoke({ operationId: 'history.endGroup', input: invoked });
async function compoundAction() {
  const handle: HistoryGroupHandle = await browser.history.beginGroup();
  try {
    await browser.getText({});
  } finally {
    const closed: HistoryEndGroupResult = await browser.history.endGroup(handle);
    const token: string = closed.groupId;
    const didClose: boolean = closed.closed;
    void [token, didClose];
  }
}
export type HistoryGroupingContract = [
  BeginParameters,
  BeginReturn,
  EndParameters,
  EndReturn,
  BrowserEndInput,
  BrowserBeginReturn,
  BrowserEndReturn,
  BeginInvokeInput,
  EndInvokeInput,
  BeginInvokeOutput,
  EndInvokeOutput,
  MissingTokenRejected,
  WrongTokenRejected,
];
void [result, ended, compoundAction];
