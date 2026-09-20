import type { BrowserDocumentApi, DocumentApi } from 'superdoc/ui';

declare const doc: DocumentApi;
declare const browserDoc: BrowserDocumentApi;

const options: Parameters<DocumentApi['clearContent']>[1] = {
  changeMode: 'tracked',
  dryRun: true,
  expectedRevision: 'revision-1',
};
const input: Parameters<DocumentApi['clearContent']>[0] = {};
const result: ReturnType<DocumentApi['clearContent']> = doc.clearContent(input, options);
const success: boolean = result.success;
void success;

const browserOptions: Parameters<BrowserDocumentApi['clearContent']>[1] = options;
const browserInput: Parameters<BrowserDocumentApi['clearContent']>[0] = input;
const browserResult: ReturnType<BrowserDocumentApi['clearContent']> = browserDoc.clearContent(
  browserInput,
  browserOptions,
);
void browserResult;

// @ts-expect-error Mutation modes are direct or tracked.
doc.clearContent({}, { changeMode: 'suggestion' });
