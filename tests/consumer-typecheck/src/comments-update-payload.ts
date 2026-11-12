import type { Config, SelectionInfo, SuperDoc, SuperDocCommentsUpdatePayload } from 'superdoc';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type AssertEqual<A, B> = Equal<A, B> extends true ? true : never;
type Change = NonNullable<SuperDocCommentsUpdatePayload['changes']>[number];
type Comment = NonNullable<SuperDocCommentsUpdatePayload['comment']>;
type PendingSelection = NonNullable<SuperDocCommentsUpdatePayload['pendingSelection']>;
type CommentCapture = Parameters<SuperDoc['ui']['comments']['createFromCapture']>[0];

const _callbackParam: AssertEqual<
  Parameters<NonNullable<Config['onCommentsUpdate']>>[0],
  SuperDocCommentsUpdatePayload
> = true;
const _callbackReturn: AssertEqual<ReturnType<NonNullable<Config['onCommentsUpdate']>>, void> = true;
const _commentNullable: AssertEqual<null extends SuperDocCommentsUpdatePayload['comment'] ? true : false, true> = true;
const _commentId: AssertEqual<Comment['commentId'], string | undefined> = true;
const _rejected: AssertEqual<SuperDocCommentsUpdatePayload['rejected'], true | undefined> = true;
const _committed: AssertEqual<SuperDocCommentsUpdatePayload['committed'], true | undefined> = true;
const _reason: AssertEqual<SuperDocCommentsUpdatePayload['reason'], string | undefined> = true;
const _code: AssertEqual<SuperDocCommentsUpdatePayload['code'], string | undefined> = true;
const _detail: AssertEqual<SuperDocCommentsUpdatePayload['detail'], unknown> = true;
const _changeCommentId: AssertEqual<Change['commentId'], string | undefined> = true;
const _changeFileId: AssertEqual<Change['fileId'], string | null | undefined> = true;
const _changeValue: AssertEqual<Change['value'], string | boolean | null | undefined> = true;
const _changePreviousValue: AssertEqual<Change['previousValue'], boolean | undefined> = true;
const _pendingSelection: AssertEqual<PendingSelection, SelectionInfo> = true;
const _pendingSelectionCapture: AssertEqual<PendingSelection extends CommentCapture ? true : false, true> = true;

const config = {
  selector: '#editor',
  onCommentsUpdate(payload) {
    if (payload.rejected) {
      const reason: string | undefined = payload.reason;
      const reachedDocument: boolean = payload.committed === true;
      const code: string | undefined = payload.code;
      const detail: unknown = payload.detail;
      void [reason, reachedDocument, code, detail];
    }
    const commentId: string | undefined = payload.comment?.commentId;
    for (const change of payload.changes ?? []) {
      if (change.key === 'deleted') {
        const removedId: string | undefined = change.commentId;
        void removedId;
      }
      if (change.key === 'text' && typeof change.value === 'string') {
        const text: string = change.value;
        void text;
      }
    }
    void commentId;
  },
} satisfies Config;

function legacyConsumer(payload: SuperDocCommentsUpdatePayload) {
  const type: string = payload.type;
  const commentId = payload.comment?.commentId;
  if (payload.comment) {
    const comment: Comment = payload.comment;
    void comment;
  }
  for (const change of payload.changes ?? []) {
    const key: string = change.key;
    const removedId = change.commentId;
    const fileId = change.fileId;
    void [key, removedId, fileId];
  }
  void [type, commentId, payload.pendingSelection];
}

function legacyStrictReads(payload: SuperDocCommentsUpdatePayload) {
  // @ts-expect-error `comment` can be `null` when a created comment cannot be read back.
  const comment: Comment | undefined = payload.comment;
  for (const change of payload.changes ?? []) {
    // @ts-expect-error Only deletion entries carry `commentId`; text, isInternal and reopen entries do not.
    const commentId: string = change.commentId;
    void commentId;
  }
  void comment;
}

const oldShape: SuperDocCommentsUpdatePayload = {
  type: 'deleted',
  comment: { commentId: 'c1' },
  changes: [{ key: 'deleted', commentId: 'c1', fileId: 'doc-1' }],
};

const rejectedShape: SuperDocCommentsUpdatePayload = {
  type: 'update',
  rejected: true,
  reason: 'receipt-failure',
  code: 'TARGET_NOT_FOUND',
  detail: 'comment c1 is gone',
  committed: true,
  comment: null,
  changes: [
    { key: 'text', value: 'Revised' },
    { key: 'isInternal', value: false, previousValue: true },
    { key: 'resolvedTime', value: null },
  ],
};

// @ts-expect-error `rejected` is only ever `true` when present.
const notRejected: SuperDocCommentsUpdatePayload = { type: 'update', rejected: false };

// @ts-expect-error A text change carries the new text as a string.
const badText: SuperDocCommentsUpdatePayload = { type: 'update', changes: [{ key: 'text', value: 3 }] };

declare const superdoc: SuperDoc;
superdoc.on('comments-update', (payload) => {
  const exact: AssertEqual<typeof payload, SuperDocCommentsUpdatePayload> = true;
  void exact;
  if (payload.type === 'pending' && payload.pendingSelection) {
    superdoc.ui.comments.createFromCapture(payload.pendingSelection, { text: 'Needs review' });
  }
});

void [
  _callbackParam,
  _callbackReturn,
  _commentNullable,
  _commentId,
  _rejected,
  _committed,
  _reason,
  _code,
  _detail,
  _changeCommentId,
  _changeFileId,
  _changeValue,
  _changePreviousValue,
  _pendingSelection,
  _pendingSelectionCapture,
  config,
  legacyConsumer,
  legacyStrictReads,
  oldShape,
  rejectedShape,
  notRejected,
  badText,
];
