import type { DocumentApi } from 'superdoc/ui';

declare const doc: DocumentApi;
const fragment: NonNullable<Parameters<DocumentApi['clipboard']['insert']>[0]['fragment']> = {
  kind: 'superdoc.clipboard.fragment',
  version: 'v2.2',
  blocks: [
    {
      kind: 'paragraph',
      runs: [{ text: 'VALUE', styleRef: 'MyValue', marks: { color: 'auto', shading: 'FFFF00' } }],
      inlines: [{ kind: 'text', text: 'VALUE', styleRef: 'MyValue', marks: { color: 'auto', shading: 'FFFF00' } }],
    },
  ],
};
const result: ReturnType<DocumentApi['clipboard']['insert']> = doc.clipboard.insert({ fragment });
const parsed = doc.clipboard.parse({ items: [{ type: 'text/plain', kind: 'string', data: 'VALUE' }] });
if (parsed.success) {
  const sourceContext: { documentEpoch: string; digest: string } | null | undefined = parsed.plan.sourceStyleContext;
  void sourceContext;
  for (const block of parsed.plan.fragment.blocks) {
    if (block.kind !== 'paragraph') continue;
    for (const run of block.runs) {
      const styleRef: string | undefined = run.styleRef;
      const shading: string | undefined = run.marks?.shading;
      void shading;
      void styleRef;
    }
    for (const inline of block.inlines ?? []) {
      if (inline.kind !== 'text') continue;
      const styleRef: string | undefined = inline.styleRef;
      void styleRef;
    }
  }
}
void result;
