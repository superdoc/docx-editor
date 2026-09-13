import type { BrowserDocumentApi, DocumentApi } from 'superdoc/ui';

declare const doc: DocumentApi;
declare const browserDoc: BrowserDocumentApi;
type SearchInput = Parameters<DocumentApi['blocks']['findText']>[0];
type SearchResult = ReturnType<DocumentApi['blocks']['findText']>;

const input: SearchInput = { text: 'Definitions', limit: 1 };
const result: SearchResult = doc.blocks.findText(input);
const invoked: SearchResult = doc.invoke<'blocks.findText'>({ operationId: 'blocks.findText', input });
const browserResult: ReturnType<BrowserDocumentApi['blocks']['findText']> = browserDoc.blocks.findText(input);
const total: number = result.total;
const ordinal: number | undefined = result.matches[0]?.ordinal;
const nodeId: string | undefined = result.matches[0]?.nodeId;
const nodeType: string | undefined = result.matches[0]?.nodeType;
const preview: string | undefined = result.matches[0]?.preview;
const first: number | undefined = result.firstMatchOrdinal;
const scanned: number = result.scannedBlocks;
const truncated: boolean = result.truncated;
const revision: string = result.revision;
const scanError: string | undefined = result.scanError?.message;
// @ts-expect-error Search input requires a literal string.
doc.blocks.findText({ text: 1 });
// @ts-expect-error Block search does not accept occurrence-search patterns.
doc.blocks.findText({ pattern: 'Definitions' });
void [
  invoked,
  browserResult,
  total,
  ordinal,
  nodeId,
  nodeType,
  preview,
  first,
  scanned,
  truncated,
  revision,
  scanError,
];
