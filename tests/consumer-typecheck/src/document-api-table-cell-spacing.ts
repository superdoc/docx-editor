import type { DocumentApi } from 'superdoc/ui';

declare const doc: DocumentApi;
declare const parsed: ReturnType<DocumentApi['clipboard']['parse']>;

const fragment: NonNullable<Parameters<DocumentApi['clipboard']['insert']>[0]['fragment']> = {
  kind: 'superdoc.clipboard.fragment',
  version: 'v2.1',
  blocks: [
    {
      kind: 'table',
      cellSpacingPt: 9,
      rows: [
        {
          cells: [
            {
              padding: { topPt: 3 },
              blocks: [{ kind: 'paragraph', runs: [{ text: 'Cell' }] }],
            },
          ],
        },
      ],
    },
  ],
};

doc.clipboard.insert({ fragment });
if (parsed.success) {
  for (const block of parsed.plan.fragment.blocks) {
    if (block.kind === 'table') {
      const spacing: number | undefined = block.cellSpacingPt;
      void spacing;
    }
  }
}
