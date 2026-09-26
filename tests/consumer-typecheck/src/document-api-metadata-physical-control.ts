import type { BrowserDocumentApi, DocumentApi } from 'superdoc/ui';

declare const doc: DocumentApi;
declare const browserDoc: BrowserDocumentApi;

const story = { kind: 'story', storyType: 'body' } as const;
const record = doc.metadata.get({ id: 'customer-entry', contentControlId: '4001', story });
const resolved = doc.metadata.resolve({ id: 'customer-entry', contentControlId: '4001', story });
const browserRecord = browserDoc.metadata.get({ id: 'customer-entry', contentControlId: '4001', story });
const browserResolved = browserDoc.metadata.resolve({ id: 'customer-entry', contentControlId: '4001', story });

const payload: unknown = record?.payload;
const target: unknown = resolved?.target;
void [payload, target, browserRecord, browserResolved];
