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

  it.each([
    ['an event handler on an image', '<p>a<img src="x" onerror="probe()">b</p>', '<p>ab</p>'],
    [
      'an event handler on an allowed element',
      '<p onclick="probe()"><b onmouseover="probe()">x</b></p>',
      '<p><b>x</b></p>',
    ],
    ['a script element', '<p>a<script>probe()</script>b</p>', '<p>ab</p>'],
    ['a style element', '<p>a<style>p{}</style>b</p>', '<p>ab</p>'],
    ['an inline frame', '<p>a<iframe srcdoc="<p>x</p>"></iframe>b</p>', '<p>ab</p>'],
    ['an object element', '<p>a<object data="x"></object>b</p>', '<p>ab</p>'],
    ['an embed element', '<p>a<embed src="x">b</p>', '<p>ab</p>'],
    ['an SVG load handler', '<p>a<svg onload="probe()"><circle r="1"></circle></svg>b</p>', '<p>ab</p>'],
    ['MathML content', '<p>a<math><mi>x</mi></math>b</p>', '<p>ab</p>'],
    ['a form and a button', '<form action="x"><button formaction="y">go</button></form>', 'go'],
    ['an unknown element', '<p><marquee>moving</marquee></p>', '<p>moving</p>'],
    ['a style attribute', '<p style="background:url(x)">x</p>', '<p>x</p>'],
    ['a data URL link', '<a href="data:text/html,x">data</a>', 'data'],
    ['a template element', '<p>a<template><img src="x" onerror="probe()"></template>b</p>', '<p>ab</p>'],
  ])('removes %s', (_name, input, expected) => {
    expect(renderCommentHtml(input)).toBe(expected);
  });

  it('keeps supported rich text, line breaks, and mention spans', () => {
    const input =
      '<p><strong>s</strong><em>e</em><u>u</u><s>x</s><br>' +
      '<span data-type="mention" name="Ada Example" email="ada@example.com">@Ada Example</span></p>';
    expect(renderCommentHtml(input)).toBe(input);
  });

  it.each([
    ['divs', '<div>First line</div><div>Second line</div>'],
    ['list items', '<ul><li>one</li><li>two</li></ul><ol><li>three</li></ol>'],
    ['headings and quotes', '<h2>Title</h2><blockquote>quoted</blockquote>'],
    ['table cells', '<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>'],
  ])('keeps the block boundaries of %s', (_name, input) => {
    expect(renderCommentHtml(input)).toBe(input);
  });

  it('strips attributes from structural elements', () => {
    expect(renderCommentHtml('<div class="x" style="position:fixed"><ul onclick="probe()"><li>a</li></ul></div>')).toBe(
      '<div><ul><li>a</li></ul></div>',
    );
  });

  it('keeps entity-encoded markup as literal text', () => {
    const input = '<p>&lt;img src="x" onerror="probe()"&gt; a &amp; b</p>';
    expect(renderCommentHtml(input)).toBe(input);
  });
});
