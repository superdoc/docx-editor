import type { BrowserDocumentApi, DocumentApi } from 'superdoc/ui';

type Comments = DocumentApi['comments'];
type BrowserComments = BrowserDocumentApi['comments'];
type CommentLookup = Parameters<Comments['get']>[0];
type CommentListOptions = NonNullable<Parameters<Comments['list']>[0]>;
type ListedComment = Awaited<ReturnType<Comments['list']>>['items'][number];

declare const doc: BrowserDocumentApi;

export async function readCommentResolution(commentId: string) {
  const lookup: CommentLookup = { commentId };
  const options: CommentListOptions = { includeResolved: true };
  const comment: Awaited<ReturnType<BrowserComments['get']>> = await doc.comments.get(lookup);
  const listed: readonly ListedComment[] = (await doc.comments.list(options)).items;
  const time: number | undefined = comment.resolvedTime ?? listed[0]?.resolvedTime;
  const id: string | undefined = comment.resolvedById ?? listed[0]?.resolvedById;
  const name: string | undefined = comment.resolvedByName ?? listed[0]?.resolvedByName;
  const email: string | undefined = comment.resolvedByEmail ?? listed[0]?.resolvedByEmail;
  const receipt = await doc.comments.patch({ commentId, status: 'resolved' });
  const receiptTime: number | undefined = receipt.success ? receipt.resolvedTime : undefined;
  const receiptId: string | undefined = receipt.success ? receipt.resolvedById : undefined;
  return { time, id, name, email, receiptTime, receiptId };
}
