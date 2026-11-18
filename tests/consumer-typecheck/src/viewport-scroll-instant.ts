import type { DocumentApi } from '@superdoc/document-api';
import type { ScrollIntoViewInput, ScrollIntoViewOutput, SuperDocUI } from 'superdoc/ui';

declare const ui: SuperDocUI;

const input: ScrollIntoViewInput = {
  target: { kind: 'text', blockId: 'paragraph-1', range: { start: 0, end: 1 } },
  block: 'center',
  behavior: 'instant',
};

const result: Promise<ScrollIntoViewOutput> = ui.viewport.scrollIntoView(input);

// @ts-expect-error Only the published scroll behavior values are accepted.
ui.viewport.scrollIntoView({ ...input, behavior: 'immediate' });

void result;

declare const documentApi: DocumentApi;
const note = documentApi.footnotes.get({
  target: { kind: 'entity', entityType: 'footnote', noteId: '1', noteType: 'endnote' },
});
const noteNavigation: Promise<ScrollIntoViewOutput> = ui.viewport.scrollIntoView({
  target: note.address,
  behavior: 'instant',
});
const noteFamily: 'footnote' | 'endnote' | undefined = note.address.noteType;
void [noteNavigation, noteFamily];
