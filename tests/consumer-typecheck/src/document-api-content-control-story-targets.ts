import type { BrowserDocumentApi, DocumentApi } from 'superdoc/ui';

declare const doc: DocumentApi;
declare const browserDoc: BrowserDocumentApi;

const headerStory = {
  kind: 'story',
  storyType: 'headerFooterPart',
  refId: 'rId7',
} as const;

const getInput: Parameters<DocumentApi['contentControls']['get']>[0] = {
  target: {
    kind: 'block',
    nodeType: 'sdt',
    nodeId: '642929878',
    story: headerStory,
  },
};

const syncControl = doc.contentControls.get(getInput);
const syncStory = syncControl.target.story;
if (syncStory?.storyType === 'headerFooterPart') {
  const syncRefId: string = syncStory.refId;
  void syncRefId;
}

type BrowserControl = Awaited<ReturnType<BrowserDocumentApi['contentControls']['get']>>;
declare const browserControl: BrowserControl;
const browserStory = browserControl.target.story;
if (browserStory?.storyType === 'headerFooterPart') {
  const browserRefId: string = browserStory.refId;
  void browserRefId;
}

browserDoc.contentControls.get(getInput);

void syncStory;
void browserStory;
