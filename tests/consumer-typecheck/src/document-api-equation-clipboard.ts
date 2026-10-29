import type { DocumentApi } from 'superdoc/ui';

declare const doc: DocumentApi;
const receipt = doc.clipboard.insert({
  fragment: {
    kind: 'superdoc.clipboard.fragment',
    version: 'v2.2',
    blocks: [
      {
        kind: 'paragraph',
        runs: [],
        inlines: [
          {
            kind: 'math',
            omml: '<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:r><m:t>x</m:t></m:r></m:oMath>',
          },
        ],
      },
    ],
  },
});
const success: boolean = receipt.success;
void success;
const parsed = doc.clipboard.parse({ items: [{ type: 'text/html', kind: 'string', data: '' }] });
if (parsed.success) {
  for (const block of parsed.plan.fragment.blocks) {
    if (block.kind !== 'paragraph') continue;
    for (const inline of block.inlines ?? []) {
      if (inline.kind === 'math') {
        const omml: string = inline.omml;
        void omml;
      }
    }
  }
}
