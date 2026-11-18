import type { BrowserDocumentApi } from 'superdoc/ui';
import type { SDMutationReceipt } from '@superdoc/document-api';

declare const doc: BrowserDocumentApi;

const input: Parameters<BrowserDocumentApi['insert']>[0] = {
  content: { kind: 'break', break: { type: 'page' } },
};
const pending: ReturnType<BrowserDocumentApi['insert']> = doc.insert(input);

async function insertAtCaret(): Promise<SDMutationReceipt> {
  const receipt: Awaited<ReturnType<BrowserDocumentApi['insert']>> = await pending;
  if (receipt.success) {
    const txId: string | undefined = receipt.txId;
    const revision: string | undefined = receipt.evaluatedRevision?.after;
    void txId;
    void revision;
  } else {
    const message: string | undefined = receipt.failure?.message;
    void message;
  }
  return receipt;
}

void doc.insert(input, { dryRun: true });
void doc.insert(input, { changeMode: 'direct' });
void insertAtCaret;
