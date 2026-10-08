import type { BrowserDocumentApi, DocumentApi } from 'superdoc/ui';

declare const doc: DocumentApi;
declare const browserDoc: BrowserDocumentApi;

const input: Parameters<DocumentApi['contentControls']['delete']>[0] = {
  target: { kind: 'block', nodeType: 'sdt', nodeId: '2001' },
  overrideDeletionLock: true,
};
const result: ReturnType<DocumentApi['contentControls']['delete']> = doc.contentControls.delete(input);
if (result.success) {
  const id: string = result.contentControl.nodeId;
  void id;
}
const browserInput: Parameters<BrowserDocumentApi['contentControls']['delete']>[0] = input;
const browserResult: ReturnType<BrowserDocumentApi['contentControls']['delete']> =
  browserDoc.contentControls.delete(browserInput);
Promise.resolve(browserResult).then((receipt) => {
  if (receipt.success) {
    const id: string = receipt.contentControl.nodeId;
    void id;
  }
});

doc.contentControls.delete({ ...input, overrideDeletionLock: false });
// @ts-expect-error The deletion override requires an explicit boolean.
doc.contentControls.delete({ ...input, overrideDeletionLock: 'yes' });
