import type { BrowserDocumentApi, DocumentApi, SelectionTarget } from 'superdoc/ui';

declare const doc: DocumentApi;
declare const browserDoc: BrowserDocumentApi;

const selection: SelectionTarget = {
  kind: 'selection',
  start: { kind: 'text', blockId: 'first-paragraph', offset: 0 },
  end: { kind: 'nodeEdge', node: { kind: 'block', nodeType: 'paragraph', nodeId: 'second-paragraph' }, edge: 'after' },
};

const bounded = doc.tables.convertFromText({ target: selection, delimiter: 'tab' });
const legacy = doc.tables.convertFromText({ nodeId: 'first-paragraph', delimiter: 'comma' });
const browserBounded = browserDoc.tables.convertFromText({ target: selection, delimiter: 'paragraph' });

void [bounded.success, legacy.success, browserBounded];
