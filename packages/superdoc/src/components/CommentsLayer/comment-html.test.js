import { describe, expect, it } from 'vitest';
import { sanitizeCommentHtml } from './comment-html.js';

const LINK_ATTRS = 'target="_blank" rel="noopener noreferrer"';

describe('sanitizeCommentHtml', () => {
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
    ['a template element', '<p>a<template><img src="x" onerror="probe()"></template>b</p>', '<p>ab</p>'],
    ['a javascript link', '<a href="javascript:probe()">bad <b>x</b></a>', 'bad <b>x</b>'],
    ['a data link', '<a href="data:text/html,x">data</a>', 'data'],
    ['a class outside mentions', '<p class="x">x</p>', '<p>x</p>'],
  ])('removes %s', (_name, input, expected) => {
    expect(sanitizeCommentHtml(input)).toBe(expected);
  });

  it('keeps v1 rich-text formatting', () => {
    const input =
      '<h2>Title</h2><p style="text-align: center;"><strong>s</strong><em>e</em><u>u</u><s>x</s><br>' +
      '<span style="color: rgb(255, 0, 0); font-size: 14pt; font-family: Arial;">styled</span><mark>hi</mark></p>' +
      '<table><tbody><tr><td colspan="2">cell</td></tr></tbody></table>';
    expect(sanitizeCommentHtml(input)).toBe(
      '<h2>Title</h2><p style="text-align: center"><strong>s</strong><em>e</em><u>u</u><s>x</s><br>' +
        '<span style="color: rgb(255, 0, 0); font-family: Arial; font-size: 14pt">styled</span><mark>hi</mark></p>' +
        '<table><tbody><tr><td colspan="2">cell</td></tr></tbody></table>',
    );
  });

  it('keeps mention spans with their identity', () => {
    const input =
      '<p><span data-type="mention" name="Ada Example" email="ada@example.com" class="sd-editor-mention" aria-label="Mention node">@Ada Example</span></p>';
    expect(sanitizeCommentHtml(input)).toBe(input);
  });

  it('keeps safe links and opens them in a new tab', () => {
    expect(sanitizeCommentHtml('<a href="https://ok.io/p">ok</a>')).toBe(
      `<a href="https://ok.io/p" ${LINK_ATTRS}>ok</a>`,
    );
    expect(sanitizeCommentHtml('<a href="mailto:x@y.z">mail</a>')).toBe(
      `<a href="mailto:x@y.z" ${LINK_ATTRS}>mail</a>`,
    );
  });

  it('keeps in-document anchors and sms links that the v1 link mark emits', () => {
    expect(sanitizeCommentHtml('<a href="#section-2">jump</a>')).toBe('<a href="#section-2">jump</a>');
    expect(sanitizeCommentHtml('<a href="#2026-summary">summary</a>')).toBe('<a href="#2026-summary">summary</a>');
    expect(sanitizeCommentHtml('<a href="#_Toc.1">toc</a>')).toBe('<a href="#_Toc.1">toc</a>');
    expect(sanitizeCommentHtml('<a href="sms:+15551234">text me</a>')).toBe(
      `<a href="sms:+15551234" ${LINK_ATTRS}>text me</a>`,
    );
  });

  it.each([
    ['an anchor with markup characters', '<a href="#a&quot;onclick">x</a>'],
    ['an empty anchor', '<a href="#">x</a>'],
    ['an anchor with a colon', '<a href="#http:evil">x</a>'],
    ['an anchor with a space', '<a href="#bad name">x</a>'],
    ['a relative path', '<a href="/admin">x</a>'],
  ])('unwraps %s', (_name, input) => {
    expect(sanitizeCommentHtml(input)).toBe('x');
  });

  it('keeps the pixel width and cover crop that the v1 image node emits', () => {
    expect(
      sanitizeCommentHtml('<img src="https://ok.io/a.png" style="width: 120px; height: auto; position: fixed;">'),
    ).toBe('<img src="https://ok.io/a.png" style="width: 120px; height: auto">');
    expect(
      sanitizeCommentHtml(
        '<img src="https://ok.io/a.png" style="width: 120px; height: 80px; object-fit: cover; object-position: left top;">',
      ),
    ).toBe(
      '<img src="https://ok.io/a.png" style="width: 120px; height: 80px; object-fit: cover; object-position: left top">',
    );
  });

  it('keeps layout sizes off elements other than images', () => {
    expect(sanitizeCommentHtml('<span style="width: 9999px; height: 9999px; color: red;">x</span>')).toBe(
      '<span style="color: red">x</span>',
    );
    expect(sanitizeCommentHtml('<img src="https://ok.io/a.png" style="width: 100vw;">')).toBe(
      '<img src="https://ok.io/a.png">',
    );
  });

  it('drops style properties outside the allowlist and values that load resources', () => {
    expect(
      sanitizeCommentHtml(
        '<span style="color: red; position: fixed; background-image: url(x); background-color: blue;">x</span>',
      ),
    ).toBe('<span style="color: red; background-color: blue">x</span>');
    expect(sanitizeCommentHtml('<span style="position: fixed; top: 0;">x</span>')).toBe('<span>x</span>');
  });

  it('keeps images from web and raster data sources without handlers', () => {
    expect(sanitizeCommentHtml('<p><img src="https://ok.io/a.png" alt="a" width="10" onload="probe()"></p>')).toBe(
      '<p><img src="https://ok.io/a.png" alt="a" width="10"></p>',
    );
    const raster = '<img src="data:image/png;base64,iVBORw0KGgo=">';
    expect(sanitizeCommentHtml(raster)).toBe(raster);
  });

  it.each([
    ['a relative source', '<p>a<img src="x.png">b</p>'],
    ['a javascript source', '<p>a<img src="javascript:probe()">b</p>'],
    ['an SVG data source', '<p>a<img src="data:image/svg+xml;base64,PHN2Zz4=">b</p>'],
    ['a missing source', '<p>a<img>b</p>'],
  ])('drops images with %s', (_name, input) => {
    expect(sanitizeCommentHtml(input)).toBe('<p>ab</p>');
  });

  it('keeps entity-encoded markup as literal text', () => {
    const input = '<p>&lt;img src="x" onerror="probe()"&gt; a &amp; b</p>';
    expect(sanitizeCommentHtml(input)).toBe(input);
  });

  it.each([null, undefined, 42, {}, ''])('returns an empty string for %s', (input) => {
    expect(sanitizeCommentHtml(input)).toBe('');
  });
});
