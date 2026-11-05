import type { BrowserDocumentApi, DocumentApi } from 'superdoc/ui';

declare const doc: DocumentApi;
declare const browserDoc: BrowserDocumentApi;

const nodeInput: Parameters<DocumentApi['tables']['getProperties']>[0] = { nodeId: 'table-1' };
const targetInput: Parameters<DocumentApi['tables']['getProperties']>[0] = {
  target: { kind: 'block', nodeType: 'table', nodeId: 'table-1' },
};
const result: ReturnType<DocumentApi['tables']['getProperties']> = doc.tables.getProperties(nodeInput);
const browserInput: Parameters<BrowserDocumentApi['tables']['getProperties']>[0] = targetInput;
const browserResult: Awaited<ReturnType<BrowserDocumentApi['tables']['getProperties']>> =
  await browserDoc.tables.getProperties(browserInput);

for (const properties of [result, browserResult]) {
  const rows: Array<{ rowIndex: number; heightPt?: number; heightRule?: 'atLeast' | 'exact' | 'auto' }> | undefined =
    properties.rows;
  const columns: Array<{ columnIndex: number; widthPt?: number }> | undefined = properties.columns;
  const heightPt: number | undefined = rows?.[0]?.heightPt;
  const rule: 'atLeast' | 'exact' | 'auto' | undefined = rows?.[0]?.heightRule;
  const widthPt: number | undefined = columns?.[0]?.widthPt;
  void [heightPt, rule, widthPt];
}

const rowInput: Parameters<DocumentApi['tables']['setRowHeight']>[0] = {
  nodeId: nodeInput.nodeId,
  rowIndex: 0,
  heightPt: 42,
  rule: 'atLeast',
};
const columnInput: Parameters<DocumentApi['tables']['setColumnWidth']>[0] = {
  nodeId: nodeInput.nodeId,
  columnIndex: 0,
  widthPt: 123,
};
doc.tables.setRowHeight(rowInput);
doc.tables.setColumnWidth(columnInput);
void doc.tables.getProperties(targetInput);
