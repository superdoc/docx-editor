import { describe, expect, it } from 'vite-plus/test';
import { renderCommentHtml } from './comment-urls.js';

const LINK_ATTRS = 'target="_blank" rel="noopener noreferrer"';

describe('renderCommentHtml', () => {
  it.each([
    ['see https://example.com/a).', `see <a href="https://example.com/a" ${LINK_ATTRS}>https://example.com/a</a>).`],
    [
      '(https://example.com/a_(b))',
      `(<a href="https://example.com/a_(b)" ${LINK_ATTRS}>https://example.com/a_(b)</a>)`,
    ],
    [
      'list: https://a.b/c, https://d.e/f; done',
      `list: <a href="https://a.b/c" ${LINK_ATTRS}>https://a.b/c</a>, <a href="https://d.e/f" ${LINK_ATTRS}>https://d.e/f</a>; done`,
    ],
    ['[https://br.io/x]', `[<a href="https://br.io/x" ${LINK_ATTRS}>https://br.io/x</a>]`],
    [
      '<p>one <b>https://bold.io</b></p>',
      `<p>one <b><a href="https://bold.io" ${LINK_ATTRS}>https://bold.io</a></b></p>`,
    ],
  ])('links the bare URL in %s', (input, expected) => {
    expect(renderCommentHtml(input)).toBe(expected);
  });

  it.each([
    ['<a href="mailto:x@y.z">mail</a>', `<a href="mailto:x@y.z" ${LINK_ATTRS}>mail</a>`],
    ['<a href="tel:+15551234">call</a>', `<a href="tel:+15551234" ${LINK_ATTRS}>call</a>`],
    ['<a href="https://ok.io/p">ok</a>', `<a href="https://ok.io/p" ${LINK_ATTRS}>ok</a>`],
  ])('keeps the supported link %s', (input, expected) => {
    expect(renderCommentHtml(input)).toBe(expected);
  });

  it.each([
    ['<a href="javascript:alert(1)">bad <b>x</b></a>', 'bad <b>x</b>'],
    ['<a>plain <i>y</i></a>', 'plain <i>y</i>'],
    ['<a href="">empty</a>', 'empty'],
    ['<a href="#top">top</a>', 'top'],
  ])('unwraps the unsupported link %s and keeps its children', (input, expected) => {
    expect(renderCommentHtml(input)).toBe(expected);
  });

  it('leaves URLs inside code and pre untouched', () => {
    const input = '<code>https://c.d/e</code> and <pre>https://p.q</pre>';
    expect(renderCommentHtml(input)).toBe(input);
  });

  it.each([null, undefined, 42, {}])('returns an empty string for the non-string %s', (input) => {
    expect(renderCommentHtml(input)).toBe('');
  });
});
