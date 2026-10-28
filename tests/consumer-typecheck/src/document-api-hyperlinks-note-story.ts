import type { BrowserDocumentApi, DocumentApi } from 'superdoc/ui';

declare const doc: DocumentApi;
declare const browserDoc: BrowserDocumentApi;

const footnoteStory = {
  kind: 'story',
  storyType: 'footnote',
  noteId: '1',
} as const;

const listQuery: Parameters<DocumentApi['hyperlinks']['list']>[0] = {
  in: footnoteStory,
  within: { kind: 'block', nodeType: 'paragraph', nodeId: 'F0000001', story: footnoteStory },
};

const listed = doc.hyperlinks.list(listQuery);
const listedStory = listed.items[0]?.address.story;
if (listedStory?.storyType === 'footnote') {
  const noteId: string = listedStory.noteId;
  void noteId;
}

const wrapped = doc.hyperlinks.wrap({
  target: { kind: 'text', blockId: 'F0000001', range: { start: 4, end: 10 }, story: footnoteStory },
  link: { destination: { href: 'https://example.org/citation' } },
});
if (wrapped.success) {
  const wrappedStory = wrapped.hyperlink.story;
  void wrappedStory;
}

type BrowserListed = Awaited<ReturnType<BrowserDocumentApi['hyperlinks']['list']>>;
declare const browserListed: BrowserListed;
const browserStory = browserListed.items[0]?.address.story;

browserDoc.hyperlinks.list({ in: footnoteStory });

void listedStory;
void browserStory;
