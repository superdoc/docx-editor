import type { DocumentApi, BrowserDocumentApi } from 'superdoc/ui';

declare const doc: DocumentApi;
declare const browserDoc: BrowserDocumentApi;
const target = {
  kind: 'selection',
  start: { kind: 'text', blockId: 'clause', offset: 0 },
  end: { kind: 'text', blockId: 'clause', offset: 6 },
} as const;
async function temporaryReview() {
  const receipt = await doc.mutations.beginTemporary({
    tag: 'preview',
    onNativeEdit: 'cancel',
    operations: [
      { operation: 'replace', input: { target, text: 'Option' }, options: { changeMode: 'direct' } },
      { operation: 'insert', input: { value: 'Appendix', type: 'text' }, options: { changeMode: 'direct' } },
      {
        operation: 'trackChanges.decide',
        input: { decision: 'reject', target: { kind: 'id', id: 'revision' }, commentRetention: 'point' },
      },
      { operation: 'comments.create', input: { target, text: 'Explanation' } },
    ],
  });
  if (!receipt.success) return receipt.failure.code;
  const id: string = receipt.temporary.id;
  const tag: string = receipt.temporary.tag;
  const nativeEditPolicy: 'cancel' | 'preserve' | undefined = receipt.temporary.onNativeEdit;
  const cancellation: 'native-edit' | undefined = receipt.temporary.cancelledBy;
  void nativeEditPolicy;
  void cancellation;
  const revision: string = receipt.revision.after;
  await browserDoc.mutations.replaceTemporary({
    previewId: id,
    tag,
    onNativeEdit: 'cancel',
    expectedRevision: revision,
    operations: [{ operation: 'replace', input: { target, text: 'Second' }, options: { changeMode: 'tracked' } }],
  });
  await doc.mutations.rollbackTemporary({ previewId: id });
  await browserDoc.mutations.commitTemporary({ previewId: id });
  doc.mutations.beginTemporary({
    tag: 'invalid-policy',
    // @ts-expect-error Native interaction cannot silently commit a temporary choice.
    onNativeEdit: 'commit',
    operations: [{ operation: 'replace', input: { target, text: 'Option' } }],
  });
  doc.trackChanges.decide({
    decision: 'accept',
    target: { kind: 'ids', ids: ['revision'] },
    commentRetention: 'point',
  });
  // @ts-expect-error Native deletion remains the omission default; arbitrary retention policies are rejected.
  doc.trackChanges.decide({ decision: 'accept', target: { kind: 'id', id: 'revision' }, commentRetention: 'discard' });
}
void temporaryReview;

async function counterRedline() {
  const at = { kind: 'text', blockId: 'clause', offset: 0 } as const;
  await browserDoc.mutations.beginTemporary({
    tag: 'modify',
    operations: [
      { operation: 'trackChanges.decide', input: { decision: 'reject', target: { kind: 'id', id: 'revision' } } },
      {
        operation: 'insert',
        input: { target: { kind: 'selection', start: at, end: at }, value: 'within 30 days' },
        options: { changeMode: 'tracked', author: { name: 'Reviewer' } },
      },
      {
        id: 'ours',
        operation: 'insert',
        input: { target: { kind: 'selection', start: at, end: at }, value: 'within 30 days' },
        options: { changeMode: 'tracked', author: { name: 'Reviewer' } },
      },
      {
        operation: 'comments.create',
        input: { target: { kind: 'operationResult', operationId: 'ours' }, text: 'Why' },
      },
      {
        operation: 'replace',
        input: { target, text: 'Ours' },
        options: { changeMode: 'tracked', author: { name: 'Reviewer' } },
      },
    ],
  });
}
void counterRedline;

async function paragraphPreview() {
  const block = { kind: 'block', nodeType: 'paragraph', nodeId: 'clause' } as const;
  await browserDoc.mutations.beginTemporary({
    tag: 'paragraph',
    operations: [
      {
        operation: 'replace',
        input: { target: block, text: 'Preview' },
        options: { replaceMode: 'contents', expectedSnapshotId: 'retained' },
      },
    ],
  });
}
void paragraphPreview;

async function temporaryLimits() {
  await browserDoc.mutations.beginTemporary({
    tag: 'limits',
    operations: [
      // @ts-expect-error an author needs `changeMode: 'tracked'`
      { operation: 'insert', input: { value: 'x' }, options: { changeMode: 'direct', author: { name: 'Reviewer' } } },
      // @ts-expect-error temporary inserts are plain text, not HTML
      { operation: 'insert', input: { value: '<b>x</b>', type: 'html' } },
      // @ts-expect-error temporary replacements are plain text, not HTML
      { operation: 'replace', input: { target, content: '<b>x</b>', type: 'html' } },
      // @ts-expect-error only a comment can target an operation result
      { operation: 'replace', input: { target: { kind: 'operationResult', operationId: 'ours' }, text: 'x' } },
    ],
  });
}
void temporaryLimits;

import type {
  DocumentStoryLocator,
  TemporaryMutationOperation,
  TemporaryMutationReceipt,
  TrackChangesItem,
  ViewportGetRectTarget,
} from 'superdoc/ui';

declare const change: TrackChangesItem;
const story: DocumentStoryLocator | undefined = change.address.story;
const placed: ViewportGetRectTarget = change.address;
const step: TemporaryMutationOperation = {
  operation: 'trackChanges.decide',
  input: { decision: 'accept', target: { kind: 'id', id: change.id } },
};
async function namedTypes(): Promise<TemporaryMutationReceipt> {
  return browserDoc.mutations.beginTemporary({ tag: 'named', operations: [step] });
}
void story;
void placed;
void namedTypes;
