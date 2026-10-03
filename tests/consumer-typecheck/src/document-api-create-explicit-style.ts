import type { DocumentApi } from 'superdoc/ui';

declare const doc: DocumentApi;

const paragraphInput: Parameters<DocumentApi['create']['paragraph']>[0] = {
  at: { kind: 'documentEnd' },
  text: 'Explicit style paragraph',
  styleId: 'BodyText',
};

const headingInput: Parameters<DocumentApi['create']['heading']>[0] = {
  level: 2,
  at: { kind: 'documentEnd' },
  text: 'Explicit style heading',
  styleId: 'Title',
};

const paragraphResult: ReturnType<DocumentApi['create']['paragraph']> = doc.create.paragraph(paragraphInput);
const headingResult: ReturnType<DocumentApi['create']['heading']> = doc.create.heading(headingInput);

// styleId is optional — omitting it keeps existing callers valid.
doc.create.paragraph({ at: { kind: 'documentEnd' }, text: 'Default style' });
doc.create.heading({ level: 1, at: { kind: 'documentEnd' }, text: 'Default heading style' });

// @ts-expect-error styleId must be a string when provided.
doc.create.paragraph({ at: { kind: 'documentEnd' }, styleId: 123 });
// @ts-expect-error styleId must be a string when provided.
doc.create.heading({ level: 1, at: { kind: 'documentEnd' }, styleId: 123 });

void paragraphResult;
void headingResult;
