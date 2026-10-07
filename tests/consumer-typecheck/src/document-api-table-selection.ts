import type { BrowserDocumentApi, SelectionInfo, SuperDocUI } from 'superdoc/ui';

declare const doc: BrowserDocumentApi;
declare const ui: SuperDocUI;

const input: Parameters<BrowserDocumentApi['selection']['current']>[0] = { includeText: true };
const result: Awaited<ReturnType<BrowserDocumentApi['selection']['current']>> = {} as SelectionInfo;
const metadata: SelectionInfo['tableSelection'] = result.tableSelection;
if (metadata) {
  const type: 'table' | 'cell' | 'cells' = metadata.type;
  const kind: 'tableCells' = metadata.kind;
  const tableId: string = metadata.tableId;
  const columnIndex: number = metadata.start.columnIndex;
  const cellIds: string[] = metadata.cells.map((cell) => cell.nodeId);
  void [type, kind, tableId, columnIndex, cellIds];
}
const contextMetadata: SelectionInfo['tableSelection'] = ui.viewport.contextAt({ x: 0, y: 0 }).selection.tableSelection;
void [doc.selection.current(input), contextMetadata];
