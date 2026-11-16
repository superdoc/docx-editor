import type { BrowserDocumentApi, DocumentApi } from 'superdoc/ui';

declare const doc: BrowserDocumentApi;
declare const syncDoc: DocumentApi;
declare const kind: 'block' | 'inline';

const trackedHeaderControl = doc.create.contentControl(
  {
    kind: 'inline',
    controlType: 'text',
    tag: 'client.legalName',
    content: 'Acme Products, Inc.',
    at: {
      kind: 'selection',
      story: { kind: 'story', storyType: 'headerFooterPart', refId: 'rId7' },
      start: { kind: 'text', blockId: 'header-p1', offset: 0 },
      end: { kind: 'text', blockId: 'header-p1', offset: 0 },
    },
  },
  { changeMode: 'tracked' },
);

void Promise.resolve(trackedHeaderControl).then((result) => {
  if (!result.success) return;
  const affectedStoryKind: 'story' | undefined = result.affectedStories?.[0]?.kind;
  const trackedStoryKind: 'story' | undefined = result.trackedChangeRefs?.[0]?.story?.kind;
  void affectedStoryKind;
  void trackedStoryKind;
});

doc.create.contentControl({ kind, content: 'Plain text for either field shape' });

const listBoundaryInput: Parameters<DocumentApi['create']['contentControl']>[0] = {
  kind: 'block',
  tag: 'agreement.requirements',
  at: {
    kind: 'selection',
    start: {
      kind: 'nodeEdge',
      node: { kind: 'block', nodeType: 'listItem', nodeId: 'requirement-1' },
      edge: 'before',
    },
    end: {
      kind: 'nodeEdge',
      node: { kind: 'block', nodeType: 'paragraph', nodeId: 'approval' },
      edge: 'after',
    },
  },
};
const listBoundaryResult = syncDoc.create.contentControl(listBoundaryInput);
if (listBoundaryResult.success) {
  const createdControlId: string = listBoundaryResult.contentControl.nodeId;
  void createdControlId;
}
const browserListBoundaryResult: ReturnType<BrowserDocumentApi['create']['contentControl']> =
  doc.create.contentControl(listBoundaryInput);
void browserListBoundaryResult;

doc.create.contentControl({
  kind: 'block',
  controlType: 'richText',
  tag: 'agreement.confidentiality',
  html: '<p>Confidentiality clause</p>',
});

// @ts-expect-error Structured HTML content requires a block content control.
doc.create.contentControl({ kind: 'inline', html: '<p>Invalid inline block</p>' });

// @ts-expect-error A content control accepts only one initial content format.
doc.create.contentControl({ kind: 'block', content: 'Text', html: '<p>HTML</p>' });

// @ts-expect-error A content control accepts only one initial content format.
doc.create.contentControl({ kind: 'block', content: 'Text', json: { type: 'paragraph' } });

// @ts-expect-error A content control accepts only one initial content format.
doc.create.contentControl({ kind: 'block', html: '<p>HTML</p>', json: { type: 'paragraph' } });

// @ts-expect-error Structured JSON content requires a block content control.
doc.create.contentControl({ kind: 'inline', json: { type: 'paragraph' } });

// @ts-expect-error Choose a selection or an existing content-control target, not both.
doc.create.contentControl({
  kind: 'inline',
  at: {
    kind: 'selection',
    start: { kind: 'text', blockId: 'p1', offset: 0 },
    end: { kind: 'text', blockId: 'p1', offset: 4 },
  },
  target: { kind: 'inline', nodeType: 'sdt', nodeId: 'field-1' },
});

const wrapInput: Parameters<DocumentApi['contentControls']['wrap']>[0] = {
  kind: 'inline',
  controlType: 'dropDownList',
  lockMode: 'contentLocked',
  tag: 'agreement.choice',
  target: { kind: 'inline', nodeType: 'sdt', nodeId: 'field-1' },
};
const wrapResult = syncDoc.contentControls.wrap(wrapInput);
if (wrapResult.success) {
  const wrappedControlId: string = wrapResult.contentControl.nodeId;
  void wrappedControlId;
}
