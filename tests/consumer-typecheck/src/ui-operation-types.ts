import type {
  BrowserDocumentApi,
  OperationCall,
  OperationId,
  OperationInput,
  OperationOptions,
  OperationOutput,
} from 'superdoc/ui';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

type CommentsCreateInput = Assert<
  Equal<OperationInput<'comments.create'>, Parameters<BrowserDocumentApi['comments']['create']>[0]>
>;
type DecideInput = Assert<
  Equal<OperationInput<'trackChanges.decide'>, Parameters<BrowserDocumentApi['trackChanges']['decide']>[0]>
>;
type BeginTemporaryInput = Assert<
  Equal<OperationInput<'mutations.beginTemporary'>, Parameters<BrowserDocumentApi['mutations']['beginTemporary']>[0]>
>;
type CommentsCreateOutput = Assert<
  Equal<OperationOutput<'comments.create'>, Awaited<ReturnType<BrowserDocumentApi['comments']['create']>>>
>;
type ApplyOutput = Assert<
  Equal<OperationOutput<'mutations.apply'>, Awaited<ReturnType<BrowserDocumentApi['mutations']['apply']>>>
>;
type NoOptions = Assert<Equal<OperationOptions<'comments.list'>, never>>;
type Ids = Assert<Equal<Extract<OperationId, 'insert' | 'comments.create'>, 'insert' | 'comments.create'>>;

declare const doc: BrowserDocumentApi;

const ours = {
  input: { value: 'within 30 days' },
  options: { changeMode: 'tracked', author: { name: 'Reviewer' } },
} satisfies OperationCall<'insert'>;
void doc.insert(ours.input, ours.options);

const replacement = {
  input: {
    target: {
      kind: 'selection',
      start: { kind: 'text', blockId: 'p1', offset: 0 },
      end: { kind: 'text', blockId: 'p1', offset: 4 },
    },
    text: 'net 45',
  },
  options: { changeMode: 'tracked', author: { name: 'Reviewer' } },
} satisfies OperationCall<'replace'>;
void doc.replace(replacement.input, replacement.options);

// @ts-expect-error an author attributes plain text only, not rich content
const richWithAuthor: OperationCall<'insert'> = {
  input: { value: '<b>x</b>', type: 'html' },
  options: { changeMode: 'tracked', author: { name: 'Reviewer' } },
};
void richWithAuthor;

const comment: OperationInput<'comments.create'> = {
  text: 'Why?',
  target: { kind: 'trackedChange', trackedChangeId: 'tc-1' },
};
void Promise.resolve(doc.comments.create(comment)).then((receipt: OperationOutput<'comments.create'>) => receipt);

export type {
  CommentsCreateInput,
  DecideInput,
  BeginTemporaryInput,
  CommentsCreateOutput,
  ApplyOutput,
  NoOptions,
  Ids,
};
