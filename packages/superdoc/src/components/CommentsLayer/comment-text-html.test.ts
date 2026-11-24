import { describe, expect, it } from 'vite-plus/test';
import { commentBodyAsHtml, commentTextToHtml, isBlankCommentBody } from './comment-text-html.js';
import { renderCommentHtml } from './comment-urls.js';
import useComment from './use-comment.js';

const ACTIVE_MARKUP = '<img src="x" onerror="probe()"><svg onload="probe()"></svg>';

const renderReplicatedRow = (row: Record<string, unknown>) =>
  renderCommentHtml(commentBodyAsHtml(useComment({ commentId: 'peer-row', ...JSON.parse(JSON.stringify(row)) })));

describe('replicated comment rows', () => {
  it('sanitizes a peer row that arrives without a format', () => {
    const rendered = renderReplicatedRow({ commentText: `<p><b>kept</b>${ACTIVE_MARKUP}</p>` });
    expect(rendered).toBe('<p><b>kept</b></p>');
  });

  it('escapes a peer row that declares plain text', () => {
    const rendered = renderReplicatedRow({ commentText: ACTIVE_MARKUP, commentFormat: 'text' });
    expect(rendered).toBe(`<p>${ACTIVE_MARKUP.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`);
  });

  it('sanitizes a peer row that declares an unknown format', () => {
    const rendered = renderReplicatedRow({ commentText: `<p>${ACTIVE_MARKUP}x</p>`, commentFormat: 'markup' });
    expect(rendered).toBe('<p>x</p>');
  });
});

describe('commentTextToHtml', () => {
  it('escapes markup-shaped text and keeps line breaks', () => {
    expect(commentTextToHtml('<b>x</b> & "q"\r\nnext')).toBe('<p>&lt;b&gt;x&lt;/b&gt; &amp; &quot;q&quot;<br>next</p>');
  });

  it('keeps entity-looking text literal instead of decoding it', () => {
    expect(commentTextToHtml('&amp;lt;')).toBe('<p>&amp;amp;lt;</p>');
  });

  it.each([null, undefined, ''])('returns an empty paragraph for %s', (value) => {
    expect(commentTextToHtml(value)).toBe('<p></p>');
  });
});

describe('isBlankCommentBody', () => {
  it.each(['<TODO>', '<p></p>', '&nbsp;'])('treats the plain text %s as content', (commentText) => {
    expect(isBlankCommentBody({ commentText, commentFormat: 'text' })).toBe(false);
  });

  it.each(['', '  \n'])('treats whitespace-only plain text %j as blank', (commentText) => {
    expect(isBlankCommentBody({ commentText, commentFormat: 'text' })).toBe(true);
  });

  it.each(['<p></p>', '<p>&nbsp;</p>', ''])('treats the HTML body %j as blank', (commentText) => {
    expect(isBlankCommentBody({ commentText })).toBe(true);
  });

  it('treats an HTML body with text as content', () => {
    expect(isBlankCommentBody({ commentText: '<p>x</p>', commentFormat: 'html' })).toBe(false);
  });

  it('treats a missing body as blank', () => {
    expect(isBlankCommentBody({})).toBe(true);
  });
});

describe('commentBodyAsHtml', () => {
  it('escapes plain-text comment bodies', () => {
    expect(commentBodyAsHtml({ commentText: '<img src=x>', commentFormat: 'text' })).toBe('<p>&lt;img src=x&gt;</p>');
  });

  it('passes HTML comment bodies through for the sanitizing renderer', () => {
    expect(commentBodyAsHtml({ commentText: '<p><b>x</b></p>', commentFormat: 'html' })).toBe('<p><b>x</b></p>');
    expect(commentBodyAsHtml({ commentText: '<p><b>x</b></p>' })).toBe('<p><b>x</b></p>');
  });
});
