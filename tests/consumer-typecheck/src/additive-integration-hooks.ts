import {
  SuperDoc,
  DocumentLoadError,
  type DocumentLoadOptions,
  type PageMetricsHandle,
  type PageMetricsSnapshot,
} from 'superdoc';
import type { BrowserDocumentApi, DocumentApi, SuperDocUI, ViewportGetRectsResult, CommentInfo } from 'superdoc/ui';

declare const editor: SuperDoc;
declare const ui: SuperDocUI;
declare const doc: DocumentApi;
declare const browser: BrowserDocumentApi;
declare const metrics: PageMetricsHandle;
declare const comment: CommentInfo;
const load: DocumentLoadOptions = { timeoutMs: 1000, signal: new AbortController().signal };
const instance = new SuperDoc({ selector: '#editor', document: { url: '/example.docx', load } });
const snapshot: PageMetricsSnapshot = metrics.getSnapshot();
const stopMetrics: () => void = metrics.subscribe((next) => {
  const scale: number = next.zoom.scale;
  void scale;
});
const accepted: boolean = metrics.scrollToPage(0);
const page: number | null = metrics.pageIndexForBodyTarget({ paraId: 'ABCDEF01' });
const reveal = metrics.revealBodyTarget({ paraId: 'ABCDEF01' });
void reveal.then((result) => {
  const status: 'revealed' | 'rejected' = result.status;
  void status;
});
const optionalFacade: PageMetricsHandle | null | undefined = editor.activeEditor?.pageMetrics;
const geometry: Promise<ViewportGetRectsResult> = ui.viewport.getRects({ targets: [], signal: load.signal });
const onHistory = (event: { history: { undoDepth: number; redoDepth: number } }) => {
  const depth: number = event.history.undoDepth;
  void depth;
};
editor.on('history-change', onHistory);
editor.off('history-change', onHistory);
const paraId: string | undefined = comment.paraId;
const durableId: string | undefined = comment.durableId;
const options = {
  changeMode: 'tracked' as const,
  author: { name: 'Reviewer' },
  date: '2025-02-03T04:05:06Z',
  changeTag: 'request-1',
};
const inserted = doc.insert({ value: 'Review' }, options);
const tag: string | undefined = inserted.changeTag;
const replaced = doc.replace({ ref: 'selection', text: 'Review' }, options);
const formatted = doc.format.bold({ ref: 'selection' }, options);
void browser.format.bold({ ref: 'selection' }, options);
void doc.delete({ ref: 'selection' }, { changeMode: 'tracked', date: options.date });
// @ts-expect-error Dates are supported only on tracked writes.
doc.insert({ value: 'Review' }, { changeMode: 'direct', date: options.date });
// @ts-expect-error Read-only source identity must not be assigned by an application.
comment.paraId = 'invented';
const error = new DocumentLoadError('DOCUMENT_LOAD_TIMEOUT');
const code: 'DOCUMENT_LOAD_TIMEOUT' | 'DOCUMENT_LOAD_CANCELLED' = error.code;
void [
  instance,
  snapshot,
  stopMetrics,
  accepted,
  page,
  optionalFacade,
  geometry,
  paraId,
  durableId,
  tag,
  replaced,
  formatted,
  code,
];
