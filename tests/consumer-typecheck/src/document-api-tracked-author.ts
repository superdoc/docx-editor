import type { DocumentApi, BrowserDocumentApi } from 'superdoc/ui';
import type {
  RichContentMutationOptions,
  ReplaceMutationOptions,
  TrackedReplaceMutationOptions,
  TrackedRichContentMutationOptions,
} from '@superdoc/document-api';

declare const doc: DocumentApi;
declare const browserDoc: BrowserDocumentApi;

const author = { name: 'Automated Reviewer' };
const inserted = doc.insert({ value: 'Review', type: 'text' }, { changeMode: 'tracked', author });
const replaced = doc.replace({ ref: 'found-text', text: 'Review' }, { changeMode: 'tracked', author });
const deleted = doc.delete({ ref: 'found-text' }, { changeMode: 'tracked', author });
void [inserted, replaced, deleted];
void browserDoc.insert({ value: 'Review' }, { changeMode: 'tracked', author });
void doc.insert(
  { value: 'Review' },
  { changeMode: 'tracked', author, signal: new AbortController().signal, timeoutMs: 1_000 },
);
void browserDoc.insert(
  { value: 'Review' },
  { changeMode: 'tracked', author, signal: new AbortController().signal, timeoutMs: 1_000 },
);

const invokedInsert = doc.invoke({
  operationId: 'insert',
  input: { value: 'Review' },
  options: { changeMode: 'tracked', author },
});
const invokedReplace = doc.invoke({
  operationId: 'replace',
  input: { ref: 'found-text', text: 'Review' },
  options: { changeMode: 'tracked', author },
});
const invokedDelete = doc.invoke({
  operationId: 'delete',
  input: { ref: 'found-text' },
  options: { changeMode: 'tracked', author },
});
const typedInsertRequest: Parameters<typeof doc.invoke<'insert'>>[0] = {
  operationId: 'insert',
  input: { value: 'Review' },
  options: { changeMode: 'tracked', author },
};
const typedReplaceRequest: Parameters<typeof doc.invoke<'replace'>>[0] = {
  operationId: 'replace',
  input: { ref: 'found-text', text: 'Review' },
  options: { changeMode: 'tracked', author },
};
const invokedSuccesses: boolean[] = [invokedInsert.success, invokedReplace.success, invokedDelete.success];
void [typedInsertRequest, typedReplaceRequest, invokedSuccesses];

async function browserInvokeReceipts() {
  const insert = await browserDoc.invoke({
    operationId: 'insert',
    input: { value: 'Review' },
    options: { changeMode: 'tracked', author },
  });
  const replace = await browserDoc.invoke({
    operationId: 'replace',
    input: { ref: 'found-text', text: 'Review' },
    options: { changeMode: 'tracked', author },
  });
  const deletion = await browserDoc.invoke({
    operationId: 'delete',
    input: { ref: 'found-text' },
    options: { changeMode: 'tracked', author },
  });
  const text: string = await browserDoc.invoke({ operationId: 'getText', input: {} });
  const successes: boolean[] = [insert.success, replace.success, deletion.success];
  void [successes, text];
}
void browserInvokeReceipts;

doc.invoke<'insert'>({
  operationId: 'insert',
  input: { value: '<p>Review</p>', type: 'html' },
  options: { changeMode: 'tracked', author, date: '2026-05-01T12:00:00.000Z' },
});
const structuralInput: Parameters<DocumentApi['insert']>[0] = {
  content: { kind: 'paragraph', paragraph: { inlines: [] } },
};
void doc.invoke<'insert'>({ operationId: 'insert', input: structuralInput });
const authoredStructuralRequest = {
  operationId: 'insert' as const,
  input: structuralInput,
  options: { changeMode: 'tracked' as const, author },
};
doc.invoke<'insert'>(authoredStructuralRequest);
// @ts-expect-error An authored typed invocation cannot replace the complete body.
doc.invoke<'replace'>({
  operationId: 'replace',
  input: { target: { kind: 'story', storyType: 'body' }, text: 'Review' },
  options: { changeMode: 'tracked', author },
});
// @ts-expect-error An authored typed invocation cannot insert in direct mode.
doc.invoke<'insert'>({ operationId: 'insert', input: { value: 'Review' }, options: { changeMode: 'direct', author } });
const listInput: Parameters<DocumentApi['lists']['apply']>[0] = {
  target: { kind: 'block', nodeType: 'paragraph', nodeId: 'p1' },
  seed: 'bullet',
};
void doc.invoke<'lists.apply'>({ operationId: 'lists.apply', input: listInput, options: { changeMode: 'tracked' } });
doc.invoke<'lists.apply'>({
  operationId: 'lists.apply',
  input: listInput,
  options: {
    changeMode: 'tracked',
    author,
    date: '2026-05-01T12:00:00.000Z',
  },
});
browserDoc.invoke<'insert'>({
  operationId: 'insert',
  input: { value: '<p>Review</p>', type: 'html' },
  options: { changeMode: 'tracked', author },
});
browserDoc.invoke<'insert'>({
  operationId: 'insert',
  input: { value: '<p>Review</p>', type: 'html' },
  // @ts-expect-error Browser typed invocation cannot attribute a direct HTML insertion.
  options: { changeMode: 'direct', author },
});

doc.insert({ value: '<p>Review</p>', type: 'html' }, { changeMode: 'tracked', author });
doc.insert(structuralInput, { changeMode: 'tracked', author });
// @ts-expect-error A direct insertion cannot claim a per-call tracked author.
doc.insert({ value: 'Review' }, { changeMode: 'direct', author });
// @ts-expect-error An HTML insertion without tracked mode cannot claim a revision date.
doc.insert({ value: '<p>Review</p>', type: 'html' }, { date: '2026-05-01T12:00:00.000Z' });
// @ts-expect-error A direct structural insertion cannot claim a per-call tracked author.
doc.insert(structuralInput, { changeMode: 'direct', author });
// @ts-expect-error A list edit without tracked mode cannot claim a per-call tracked author.
doc.lists.apply(listInput, { author, expectedRevision: 'revision-1' });
doc.capabilities.check({
  operation: 'insert',
  input: { value: '<p>Review</p>', type: 'html' },
  options: { changeMode: 'tracked', author },
});
doc.capabilities.check({
  operation: 'insert',
  input: { value: '<p>Review</p>', type: 'html' },
  // @ts-expect-error A support check for a direct write cannot claim a per-call tracked author.
  options: { changeMode: 'direct', author },
});

interface ConsumerRichOptions extends TrackedRichContentMutationOptions {
  requestId?: string;
}
interface ConsumerReplaceOptions extends TrackedReplaceMutationOptions {
  requestId?: string;
}
interface ConsumerDirectRichOptions extends RichContentMutationOptions {
  requestId?: string;
}
interface ConsumerDirectReplaceOptions extends ReplaceMutationOptions {
  requestId?: string;
}
const date = '2026-05-01T12:00:00.000Z';
const richOptions: TrackedRichContentMutationOptions = { changeMode: 'tracked', author, date };
const replaceOptions: TrackedReplaceMutationOptions = { changeMode: 'tracked', author, date };
const extendedRichOptions: ConsumerRichOptions = { ...richOptions, requestId: 'insert-1' };
const extendedReplaceOptions: ConsumerReplaceOptions = { ...replaceOptions, requestId: 'replace-1' };
const directRichOptions: ConsumerDirectRichOptions = { changeMode: 'direct', requestId: 'insert-2' };
const directReplaceOptions: ConsumerDirectReplaceOptions = { changeMode: 'direct', requestId: 'replace-2' };
// @ts-expect-error Untracked rich options cannot carry a per-call author.
const directRichAuthor: RichContentMutationOptions = { changeMode: 'direct', author };
void doc.insert({ type: 'markdown', value: '**Review**' }, richOptions);
void doc.insert({ type: 'markdown', value: '**Review**' }, directRichOptions);
void browserDoc.insert(structuralInput, extendedRichOptions);
void doc.invoke<'insert'>({ operationId: 'insert', input: structuralInput, options: richOptions });
const richReplacement = { ref: 'found-text', type: 'html' as const, value: '<p>Review</p>' };
void doc.replace(richReplacement, replaceOptions);
void doc.replace(richReplacement, directReplaceOptions);
void browserDoc.replace(richReplacement, extendedReplaceOptions);
void browserDoc.invoke<'replace'>({ operationId: 'replace', input: richReplacement, options: replaceOptions });
// @ts-expect-error A direct rich replacement cannot claim a per-call tracked author.
doc.replace(richReplacement, { changeMode: 'direct', author });
// @ts-expect-error A tracked replacement of the complete body cannot claim a per-call author.
doc.replace({ target: { kind: 'story', storyType: 'body' }, text: 'Review' }, { changeMode: 'tracked', author });
void directRichAuthor;
const authoredPlan = { atomic: true, changeMode: 'tracked', steps: [], author } satisfies Parameters<
  typeof doc.mutations.apply
>[0];
const planReceipt = doc.mutations.apply(authoredPlan, { signal: new AbortController().signal });
const browserPlanReceipt: typeof planReceipt = Promise.resolve(browserDoc.mutations.apply(authoredPlan));
const planPreview = doc.mutations.preview(authoredPlan);
const browserPlanPreview: typeof planPreview = Promise.resolve(browserDoc.mutations.preview(authoredPlan));
void browserDoc.invoke({ operationId: 'mutations.apply', input: authoredPlan });
void doc.invoke({ operationId: 'mutations.preview', input: authoredPlan });
void planReceipt.then((receipt) => {
  const success: boolean = receipt.success;
  const revision: string = receipt.revision.after;
  return { success, revision };
});
void planPreview.then((preview) => {
  const valid: boolean = preview.valid;
  return valid;
});
type DirectPlan = Extract<Parameters<typeof doc.mutations.apply>[0], { changeMode: 'direct' }>;
const directPlanRejectsAuthor: Exclude<DirectPlan['author'], undefined> extends never ? true : false = true;
void [browserPlanReceipt, browserPlanPreview, directPlanRejectsAuthor];
