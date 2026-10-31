import type { BrowserDocumentApi, DocumentApi } from 'superdoc/ui';

declare const doc: DocumentApi;
declare const browserDoc: BrowserDocumentApi;

const input: Parameters<DocumentApi['plan']['execute']>[0] = {
  atomic: true,
  entries: [
    {
      operationId: 'contentControls.replaceContent',
      input: {
        target: { kind: 'block', nodeType: 'sdt', nodeId: '2001' },
        content: 'Updated',
        overrideContentLock: true,
      },
    },
  ],
};
const result: ReturnType<DocumentApi['plan']['execute']> = doc.plan.execute(input);
const browserResult: ReturnType<BrowserDocumentApi['plan']['execute']> = browserDoc.plan.execute(input);
void result;
void browserResult;
// @ts-expect-error Atomic execution requires an explicit true opt-in.
doc.plan.execute({ ...input, atomic: 'yes' });

async function inspectAtomicReceipt() {
  const receipt = await doc.plan.execute(input);
  const receipts: Array<{ entryIndex: number; operationId: string }> = receipt.receipts;
  const captures: Record<string, unknown> = receipt.captures;
  void receipts;
  void captures;
}
void inspectAtomicReceipt;

import { selectedContentControls } from './docs-snippets/editor__selected-content-controls.js';
const selected: Promise<import('superdoc/ui').ContentControlInfo[]> = selectedContentControls(browserDoc);
void selected;
