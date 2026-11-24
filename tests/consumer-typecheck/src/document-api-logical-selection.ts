import type { BrowserDocumentApi, SelectionInfo } from 'superdoc/ui';

declare const doc: BrowserDocumentApi;

const input: Parameters<BrowserDocumentApi['selection']['current']>[0] = { includeLogicalChanges: true };
const selected: ReturnType<BrowserDocumentApi['selection']['current']> = doc.selection.current(input);
void Promise.resolve(selected).then((selection) => {
  const active: string[] = selection.activeChangeIds;
  const logical: SelectionInfo['logicalChangeIds'] = selection.logicalChangeIds;
  if (logical?.length) {
    void doc.trackChanges.decide({ decision: 'accept', target: { kind: 'ids', ids: logical } });
  }
  void active;
});
