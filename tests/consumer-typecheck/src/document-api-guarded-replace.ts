import type { DocumentApi, BrowserDocumentApi } from 'superdoc/ui';

declare const doc: DocumentApi;
declare const browserDoc: BrowserDocumentApi;

const target = {
  kind: 'selection',
  coordinateSpace: 'tracked',
  start: { kind: 'text', blockId: 'footer-paragraph', offset: 9 },
  end: { kind: 'text', blockId: 'footer-paragraph', offset: 17 },
} as const;

doc.replace({ target, text: 'Filled', expectedText: '{{code}}' }, { expectedRevision: 'revision' });
void browserDoc.replace({ target, text: 'Filled', expectedText: '{{code}}' }, { dryRun: true });
// @ts-expect-error The text guard requires an explicit selection, not a search ref.
doc.replace({ ref: 'search-ref', text: 'Filled', expectedText: '{{code}}' });
// @ts-expect-error Complete body replacement does not support this guard.
doc.replace({ target: { kind: 'story', storyType: 'body' }, text: 'Filled', expectedText: '{{code}}' });
