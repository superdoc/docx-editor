import type { BrowserDocumentApi } from 'superdoc/ui';
import type { SDRowProps } from '@superdoc/document-api';

declare const doc: BrowserDocumentApi;

const authoredRows: SDRowProps[] = [{ repeatHeader: true }, { repeatHeader: false }, {}];
const setEnabled: Parameters<BrowserDocumentApi['tables']['setRowOptions']>[0] = {
  nodeId: 'table-id',
  rowIndex: 0,
  repeatHeader: true,
};
const setDisabled: Parameters<BrowserDocumentApi['tables']['setRowOptions']>[0] = {
  nodeId: 'table-id',
  rowIndex: 0,
  repeatHeader: false,
};
const setUnchanged: Parameters<BrowserDocumentApi['tables']['setRowOptions']>[0] = {
  nodeId: 'table-id',
  rowIndex: 0,
};

async function readRepeatHeader() {
  const document = await doc.get({});
  const found = await doc.find({ select: { type: 'node', nodeType: 'table' } });
  const values: (boolean | undefined)[] = [];
  for (const node of [...document.body, ...found.items.map((item) => item.node)]) {
    if (node.kind === 'table') values.push(node.table.rows[0]?.props?.repeatHeader);
  }
  return values;
}

void [authoredRows, setEnabled, setDisabled, setUnchanged, readRepeatHeader];
