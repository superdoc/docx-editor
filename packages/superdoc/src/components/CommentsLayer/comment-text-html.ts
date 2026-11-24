import type { CommentFormat } from './comment-params.js';

export const escapeCommentHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const commentTextToHtml = (value: unknown): string => {
  const normalized = String(value ?? '').replace(/\r\n/g, '\n');
  if (!normalized) return '<p></p>';
  return `<p>${escapeCommentHtml(normalized).replace(/\n/g, '<br>')}</p>`;
};

export const isBlankCommentBody = (comment: { commentText?: unknown; commentFormat?: CommentFormat }): boolean => {
  if (typeof comment.commentText !== 'string') return true;
  const visibleText =
    comment.commentFormat === 'text'
      ? comment.commentText
      : comment.commentText.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ');
  return visibleText.trim().length === 0;
};

export const commentBodyAsHtml = (comment: { commentText?: unknown; commentFormat?: CommentFormat }): string =>
  comment.commentFormat === 'text' ? commentTextToHtml(comment.commentText) : String(comment.commentText ?? '');
