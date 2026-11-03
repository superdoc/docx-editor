import type { Config, SuperDoc } from 'superdoc';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type AssertEqual<A, B> = Equal<A, B> extends true ? true : never;
type AcceptHandler = NonNullable<Config['onTrackedChangeBubbleAccept']>;
type RejectHandler = NonNullable<Config['onTrackedChangeBubbleReject']>;
type BubbleComment = Parameters<AcceptHandler>[0];
type BubbleEditor = Parameters<AcceptHandler>[1];

const _acceptOptional: AssertEqual<undefined extends Config['onTrackedChangeBubbleAccept'] ? true : false, true> = true;
const _rejectOptional: AssertEqual<undefined extends Config['onTrackedChangeBubbleReject'] ? true : false, true> = true;
const _sameSignature: AssertEqual<AcceptHandler, RejectHandler> = true;
const _arity: AssertEqual<Parameters<AcceptHandler>['length'], 2> = true;
const _return: AssertEqual<ReturnType<AcceptHandler>, void> = true;
const _commentId: AssertEqual<BubbleComment['commentId'], string | undefined> = true;
const _editorNullable: AssertEqual<null extends BubbleEditor ? true : false, true> = true;
const _editorIsActiveEditor: AssertEqual<NonNullable<BubbleEditor>, NonNullable<SuperDoc['activeEditor']>> = true;

const config = {
  selector: '#editor',
  onTrackedChangeBubbleAccept(comment, editor) {
    const commentId: string | undefined = comment.commentId;
    const documentApi = editor?.doc;
    void [commentId, documentApi];
  },
  onTrackedChangeBubbleReject: (comment) => {
    void comment.id;
  },
} satisfies Config;

const omitted = { selector: '#editor' } satisfies Config;

const wrongArgument = {
  selector: '#editor',
  // @ts-expect-error the bubble callback receives a comment, not a string id
  onTrackedChangeBubbleAccept: (commentId: string) => void commentId,
} satisfies Config;

void [
  _acceptOptional,
  _rejectOptional,
  _sameSignature,
  _arity,
  _return,
  _commentId,
  _editorNullable,
  _editorIsActiveEditor,
  config,
  omitted,
  wrongArgument,
];
