import type { BrowserDocumentApi, DocumentApi } from 'superdoc/ui';

declare const doc: DocumentApi;
declare const browserDoc: BrowserDocumentApi;

const input: Parameters<DocumentApi['getNodeById']>[0] = {
  nodeId: '30000001',
  story: { kind: 'story', storyType: 'headerFooterPart', refId: 'rId7' },
};
const browserInput: Parameters<BrowserDocumentApi['getNodeById']>[0] = input;
const result: ReturnType<DocumentApi['getNodeById']> = doc.getNodeById(input);
if (result.address.kind === 'block') {
  const nodeId: string = result.address.nodeId;
  void nodeId;
}
const story = result.address.story;
if (story?.storyType === 'headerFooterPart') {
  const refId: string = story.refId;
  void refId;
}

async function readInBrowser() {
  const browserResult: Awaited<ReturnType<BrowserDocumentApi['getNodeById']>> =
    await browserDoc.getNodeById(browserInput);
  if (browserResult.address.kind === 'block') {
    const browserNodeId: string = browserResult.address.nodeId;
    void browserNodeId;
  }
  const browserStory = browserResult.address.story;
  if (browserStory?.storyType === 'headerFooterPart') {
    const refId: string = browserStory.refId;
    void refId;
  }
}

void readInBrowser;
