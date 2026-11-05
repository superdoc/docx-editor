import type { DocumentApi } from 'superdoc/ui';

declare const doc: DocumentApi;

const keep: Parameters<DocumentApi['format']['paragraph']['setKeepOptions']>[0] = {
  target: { kind: 'block', nodeType: 'paragraph', nodeId: 'target' },
  keepNext: null,
  keepLines: false,
  widowControl: null,
};
const flow: Parameters<DocumentApi['format']['paragraph']['setFlowOptions']>[0] = {
  target: keep.target,
  contextualSpacing: null,
  pageBreakBefore: false,
};
const keepResult: ReturnType<DocumentApi['format']['paragraph']['setKeepOptions']> =
  doc.format.paragraph.setKeepOptions(keep);
const flowResult: ReturnType<DocumentApi['format']['paragraph']['setFlowOptions']> =
  doc.format.paragraph.setFlowOptions(flow);
void keepResult;
void flowResult;
