import type { SuperDoc } from 'superdoc';

declare const superdoc: SuperDoc;

// Keep both public inputs callable after BrowserDocumentApi maps synchronous
// Document API methods to their async-capable browser equivalents.
if (superdoc.activeEditor?.doc) {
  void superdoc.activeEditor.doc.query.match({
    select: { type: 'text', pattern: 'Confidential Information' },
    require: 'exactlyOne',
  });

  void superdoc.activeEditor.doc.query.match({ type: 'text', pattern: 'Confidential Information' });

  const last = superdoc.activeEditor.doc.query.match({
    select: { type: 'text', pattern: 'Confidential Information' },
    require: 'last',
  });
  void Promise.resolve(last).then((result) => {
    const revision: string = result.evaluatedRevision;
    const offset: number = result.page.offset;
    const ref: string | undefined = result.items[0]?.handle.ref;
    void [revision, offset, ref];
  });
}

async function clearListedFooter() {
  const doc = superdoc.activeEditor?.doc;
  if (!doc) return;
  const { items } = await doc.headerFooters.list({});
  const slot = items.find((item) => item.kind === 'footer' && item.variant === 'default' && item.refId);
  if (!slot) return;
  return doc.headerFooters.refs.clear({
    target: { kind: 'headerFooterSlot', section: slot.section, headerFooterKind: slot.kind, variant: slot.variant },
  });
}
void clearListedFooter;
