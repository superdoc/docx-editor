import type { BrowserDocumentApi, DocumentApi } from 'superdoc/ui';

declare const doc: BrowserDocumentApi;
const input: Parameters<DocumentApi['create']['contentControl']>[0] = {
  kind: 'inline',
  at: {
    kind: 'selection',
    start: { kind: 'text', blockId: 'paragraph', offset: 7 },
    end: { kind: 'text', blockId: 'paragraph', offset: 12 },
  },
  content: '12,345',
  tag: 'linked-value',
  lockMode: 'contentLocked',
  inline: { fontFamily: 'Arial', fontSize: 11, bold: false, italic: true, underline: false, strike: false },
};
const result: ReturnType<BrowserDocumentApi['create']['contentControl']> = doc.create.contentControl(input);
void Promise.resolve(result).then((receipt) => {
  const success: boolean = receipt.success;
  void success;
});
