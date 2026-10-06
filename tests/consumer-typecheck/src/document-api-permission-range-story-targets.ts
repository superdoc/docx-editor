import type { BrowserDocumentApi, DocumentApi } from 'superdoc/ui';

declare const doc: DocumentApi;
declare const browserDoc: BrowserDocumentApi;

const footerStory = {
  kind: 'story',
  storyType: 'headerFooterPart',
  refId: 'rId7',
} as const;

const createInput: Parameters<DocumentApi['permissionRanges']['create']>[0] = {
  target: {
    kind: 'selection',
    start: { kind: 'text', blockId: '00000150', offset: 24, story: footerStory },
    end: { kind: 'text', blockId: '00000150', offset: 41, story: footerStory },
  },
  principal: { kind: 'everyone' },
};

const syncResult = doc.permissionRanges.create(createInput);
if (syncResult.success) {
  const syncStory = syncResult.range.story;
  if (syncStory?.storyType === 'headerFooterPart') {
    const syncRefId: string = syncStory.refId;
    void syncRefId;
  }
  void syncStory;
}

type BrowserResult = Awaited<ReturnType<BrowserDocumentApi['permissionRanges']['create']>>;
declare const browserResult: BrowserResult;
if (browserResult.success) {
  const browserStory = browserResult.range.story;
  if (browserStory?.storyType === 'headerFooterPart') {
    const browserRefId: string = browserStory.refId;
    void browserRefId;
  }
  void browserStory;
}

browserDoc.permissionRanges.create(createInput);
