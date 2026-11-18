import type { BrowserDocumentApi, DocumentApi } from 'superdoc/ui';

declare const doc: DocumentApi;
declare const browserDoc: BrowserDocumentApi;

type ListInput = Parameters<DocumentApi['footnotes']['list']>[0];
type GetInput = Parameters<DocumentApi['footnotes']['get']>[0];
type ListResult = ReturnType<DocumentApi['footnotes']['list']>;
type GetResult = ReturnType<DocumentApi['footnotes']['get']>;

const listInput: ListInput = { type: 'endnote', limit: 2, offset: 0 };
const getInput: GetInput = { target: { kind: 'entity', entityType: 'footnote', noteId: '1' } };
const notes: ListResult = doc.footnotes.list(listInput);
const note: GetResult = doc.footnotes.get(getInput);
const browserNotes: ReturnType<BrowserDocumentApi['footnotes']['list']> = browserDoc.footnotes.list(listInput);
const browserNote: ReturnType<BrowserDocumentApi['footnotes']['get']> = browserDoc.footnotes.get(getInput);
const listedBlock: string | undefined = notes.items[0]?.references?.[0]?.anchor.start.blockId;
const offset: number | undefined = note.references?.[0]?.anchor.start.offset;
const kind: 'inline' | undefined = note.references?.[0]?.kind;
void [browserNotes, browserNote, listedBlock, offset, kind];
