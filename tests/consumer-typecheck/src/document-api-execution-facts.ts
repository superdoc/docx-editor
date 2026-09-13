import type { DocumentApi } from 'superdoc/ui';
declare const document: DocumentApi;
const page = document.blocks.list({
  nodeIds: ['body-paragraph'],
  textSearch: { terms: ['Alpha', 'Beta'], match: 'all', caseSensitive: false },
  offset: 0,
  limit: 1,
  includeText: true,
});
page.revision satisfies string;
page.total satisfies number;
page.blocks[0]?.text satisfies string | null | undefined;
const cells = document.tables.getCells({ nodeId: 'table', rowIndex: 0, columnIndex: 0 });
cells.cells[0]?.firstParagraphNodeId satisfies string | undefined;
// @ts-expect-error Match policy is a closed set.
document.blocks.list({ textSearch: { terms: ['Alpha'], match: 'fuzzy' } });
