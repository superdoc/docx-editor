import { describe, expect, it } from 'vite-plus/test';
import { normalizeV2CommentDraftText } from './comment-draft-text.js';

describe('normalizeV2CommentDraftText', () => {
  it.each([
    ['null', null, ''],
    ['undefined', undefined, ''],
    ['empty string', '', ''],
    ['empty paragraph', '<p></p>', ''],
    ['number', 42, '42'],
  ])('reads %s as plain text', (_name, input, expected) => {
    expect(normalizeV2CommentDraftText(input)).toBe(expected);
  });

  it('decodes named entities case-insensitively', () => {
    expect(normalizeV2CommentDraftText('&amp;&lt;&gt;&quot;&apos;&nbsp;&AMP;')).toBe('&<>"\' &');
  });

  it('decodes decimal and hex code points', () => {
    expect(normalizeV2CommentDraftText('&#65;&#x42;&#x4A;&#128512;')).toBe('ABJ\u{1F600}');
  });

  it('keeps an uppercase hex marker undecoded', () => {
    expect(normalizeV2CommentDraftText('&#X43;')).toBe('&#X43;');
  });

  it('keeps entities it cannot decode', () => {
    expect(normalizeV2CommentDraftText('&#x110000;&#99999999;&unknown;&;&#;')).toBe(
      '&#x110000;&#99999999;&unknown;&;&#;',
    );
  });

  it('decodes entities once, after tags are removed', () => {
    expect(normalizeV2CommentDraftText('&amp;lt;b&amp;gt; &lt;b&gt;')).toBe('&lt;b&gt; <b>');
  });

  it('turns each block boundary run into one newline', () => {
    expect(normalizeV2CommentDraftText('<p>a</p><p>b</p>')).toBe('a\nb');
    expect(normalizeV2CommentDraftText('<li>a</li>\n  <li class="x">b</li>')).toBe('a\nb');
    expect(normalizeV2CommentDraftText('<h1>a</h1></div><blockquote><pre>b</pre></blockquote>')).toBe('a\nb');
  });

  it('turns every br form into a newline', () => {
    expect(normalizeV2CommentDraftText('a<br>b<BR/>c<br />d<br class="x">e')).toBe('a\nb\nc\nd\ne');
  });

  it('drops remaining tags and keeps text that only looks like a tag', () => {
    expect(normalizeV2CommentDraftText('<span data-x="1">a</span><o:p>b</o:p> 1 < 2 <3')).toBe('ab 1 < 2 <3');
  });
});
