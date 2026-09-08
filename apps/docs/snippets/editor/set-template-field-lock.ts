import type { BrowserDocumentApi, ContentControlInfo } from 'superdoc/ui';

export async function setTemplateFieldLock(
  doc: BrowserDocumentApi,
  tag: string,
  lockMode: ContentControlInfo['lockMode'],
) {
  const { items } = await doc.contentControls.selectByTag({ tag });

  if (items.length !== 1) {
    throw new Error(`Expected one content control tagged "${tag}", found ${items.length}.`);
  }

  return doc.contentControls.setLockMode({
    target: items[0].target,
    lockMode,
  });
}
