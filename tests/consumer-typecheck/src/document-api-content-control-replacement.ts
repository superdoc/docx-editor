import type { BrowserDocumentApi, DocumentApi } from 'superdoc/ui';

declare const doc: DocumentApi;
declare const browserDoc: BrowserDocumentApi;

const input: Parameters<DocumentApi['contentControls']['replaceContent']>[0] = {
  target: { kind: 'block', nodeType: 'sdt', nodeId: '2001' },
  format: 'ooxml',
  content:
    '<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:r><w:t>Replacement</w:t></w:r></w:p>',
};
const result: ReturnType<DocumentApi['contentControls']['replaceContent']> = doc.contentControls.replaceContent(input);
if (result.success) {
  const id: string = result.contentControl.nodeId;
  void id;
}
const browserInput: Parameters<BrowserDocumentApi['contentControls']['replaceContent']>[0] = input;
const browserResult: ReturnType<BrowserDocumentApi['contentControls']['replaceContent']> =
  browserDoc.contentControls.replaceContent(browserInput);
void browserResult;

// @ts-expect-error OOXML is supported by replacement, not by append.
doc.contentControls.appendContent({ ...input, format: 'ooxml' });
