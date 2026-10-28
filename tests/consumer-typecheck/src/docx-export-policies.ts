import type { ExportParams, SuperDoc } from 'superdoc';
import type { DocumentApi, BrowserDocumentApi } from 'superdoc/ui';

declare const superdoc: SuperDoc;
declare const doc: DocumentApi;
declare const browserDoc: BrowserDocumentApi;

const policies = { trackedChanges: 'review-preserving', comments: 'resolve', contentControls: 'flatten' } as const;
const options: ExportParams = { policies, triggerDownload: false };
const browserExport: ReturnType<SuperDoc['export']> = superdoc.export(options);
const documentExport = doc.export.toDocx({ policies });
const byteLength: number = documentExport.byteLength;
const bytes: string = documentExport.contentBase64;
const mode: 'review-preserving' | 'final' | 'original' = documentExport.mode;
const workerExport: ReturnType<BrowserDocumentApi['export']['toDocx']> = browserDoc.export.toDocx({ policies });
type Comments = NonNullable<NonNullable<ExportParams['policies']>['comments']>;
type Controls = NonNullable<NonNullable<ExportParams['policies']>['contentControls']>;
const excludesUnknownComments: 'banana' extends Comments ? never : true = true;
const excludesUnknownControls: 'remove' extends Controls ? never : true = true;
void [browserExport, byteLength, bytes, mode, workerExport, excludesUnknownComments, excludesUnknownControls];
