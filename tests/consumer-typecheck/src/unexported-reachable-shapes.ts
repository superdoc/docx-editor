import type { Config, EditorTransactionEvent, ViewOptions } from 'superdoc';
import type { CommentsListQuery } from 'superdoc/ui';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type Expect<Value extends true> = Value;

type _ViewLayout = Expect<Equal<NonNullable<ViewOptions['layout']>, 'print' | 'web'>>;
type _TransactionDocChanged = Expect<Equal<EditorTransactionEvent['transaction']['docChanged'], boolean | undefined>>;
type _TransactionDocSize = Expect<
  Equal<NonNullable<NonNullable<EditorTransactionEvent['transaction']['doc']>['content']>['size'], number | undefined>
>;
type _CommentsIncludeResolved = Expect<Equal<CommentsListQuery['includeResolved'], boolean | undefined>>;
type _CommentsLimit = Expect<Equal<CommentsListQuery['limit'], number | undefined>>;
type _CommentsVisibleIds = Expect<Equal<CommentsListQuery['visibleCommentIds'], readonly string[] | undefined>>;

const webView = { layout: 'web' } satisfies ViewOptions;
const printConfig = { selector: '#editor', viewOptions: { layout: 'print' } } satisfies Config;
const invalidView: ViewOptions = {
  // @ts-expect-error layout is 'print' or 'web'.
  layout: 'mobile',
};

const onTransaction = (event: EditorTransactionEvent): number | undefined => {
  const changed: boolean | undefined = event.transaction.docChanged;
  const size: number | undefined = event.transaction.doc?.content?.size;
  return changed ? size : undefined;
};

const commentsQuery = {
  includeResolved: true,
  limit: 10,
  visibleCommentIds: ['comment-1'],
} satisfies CommentsListQuery;
const invalidCommentsQuery: CommentsListQuery = {
  // @ts-expect-error limit is a number.
  limit: '10',
};

void [webView, printConfig, invalidView, onTransaction, commentsQuery, invalidCommentsQuery];
