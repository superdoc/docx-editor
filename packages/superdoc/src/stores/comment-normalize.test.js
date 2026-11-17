import { describe, it, expect } from 'vitest';
import { normalizeCommentForEditor, getRichTextSupportedNodeNames } from './comment-normalize.js';

// Synthetic rich-text extension set (shape mirrors real Node/Mark extensions, which
// carry `.type` and `.name`). Kept local so this unit test stays pure and independent
// of the super-editor/font-system import chain.
const richTextExtensions = [
  { type: 'node', name: 'doc' },
  { type: 'node', name: 'paragraph' },
  { type: 'node', name: 'text' },
  { type: 'node', name: 'mention' },
  { type: 'mark', name: 'bold' },
  { type: 'mark', name: 'textStyle' },
  { type: 'extension', name: 'history' },
];
const getRichTextExtensions = () => richTextExtensions;

const collectTypes = (nodes) => {
  const types = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    types.push(node.type);
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };
  walk(nodes);
  return types;
};

// Mirrors the issue's minimal shape: an invisible bookmark pair around visible text.
const bookmarkParagraph = () => ({
  type: 'paragraph',
  content: [
    { type: 'run', content: [{ type: 'text', text: 'Before mention ' }] },
    { type: 'bookmarkStart', attrs: { id: '42', name: '_mention' } },
    { type: 'run', content: [{ type: 'text', text: '@Person' }] },
    { type: 'bookmarkEnd', attrs: { id: '42' } },
  ],
});

describe('getRichTextSupportedNodeNames', () => {
  it('derives node names from `.type === "node"` extensions and excludes bookmarks/marks', () => {
    const names = getRichTextSupportedNodeNames(getRichTextExtensions());
    expect(names.has('paragraph')).toBe(true);
    expect(names.has('text')).toBe(true);
    expect(names.has('mention')).toBe(true);
    // Bookmarks and marks are not registered as rich-text nodes.
    expect(names.has('bookmarkStart')).toBe(false);
    expect(names.has('bookmarkEnd')).toBe(false);
    expect(names.has('bold')).toBe(false);
  });

  it('returns an empty set for empty/invalid input', () => {
    expect(getRichTextSupportedNodeNames().size).toBe(0);
    expect(getRichTextSupportedNodeNames(null).size).toBe(0);
    expect(getRichTextSupportedNodeNames([{ type: 'mark', name: 'bold' }]).size).toBe(0);
  });
});

describe('normalizeCommentForEditor', () => {
  const supported = getRichTextSupportedNodeNames(getRichTextExtensions());

  it('drops bookmark boundary nodes while preserving visible text', () => {
    const result = normalizeCommentForEditor([bookmarkParagraph()], supported);
    const types = collectTypes(result);
    expect(types).not.toContain('bookmarkStart');
    expect(types).not.toContain('bookmarkEnd');

    const paragraph = result[0];
    expect(paragraph.type).toBe('paragraph');
    const text = paragraph.content.map((n) => n.text).join('');
    expect(text).toBe('Before mention @Person');
  });

  it('unwraps an unsupported node, keeping its inline children', () => {
    const node = {
      type: 'paragraph',
      content: [
        {
          type: 'someUnknownWrapper',
          content: [{ type: 'text', text: 'kept text' }],
        },
      ],
    };
    const [paragraph] = normalizeCommentForEditor([node], supported);
    expect(collectTypes(paragraph)).not.toContain('someUnknownWrapper');
    expect(paragraph.content).toEqual([{ type: 'text', text: 'kept text' }]);
  });

  it('drops an unsupported leaf node entirely', () => {
    const node = {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'a' },
        { type: 'someUnknownLeaf', attrs: { x: 1 } },
        { type: 'text', text: 'b' },
      ],
    };
    const [paragraph] = normalizeCommentForEditor([node], supported);
    expect(paragraph.content).toEqual([
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
    ]);
  });

  it('maps unsupported visible whitespace leaves (line breaks, tabs) to text', () => {
    const node = {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'One' },
        { type: 'lineBreak' },
        { type: 'text', text: 'Two' },
        { type: 'tab' },
        { type: 'text', text: 'Three' },
      ],
    };
    const [paragraph] = normalizeCommentForEditor([node], supported);
    expect(collectTypes(paragraph)).not.toContain('lineBreak');
    expect(collectTypes(paragraph)).not.toContain('tab');
    expect(paragraph.content.map((n) => n.text).join('')).toBe('One\nTwo\tThree');
  });

  it('passes supported nodes through and strips font attrs from textStyle marks', () => {
    const node = {
      type: 'paragraph',
      content: [
        {
          type: 'run',
          content: [
            {
              type: 'text',
              text: 'styled',
              marks: [{ type: 'textStyle', attrs: { fontSize: '12pt', color: '#f00' } }],
            },
          ],
        },
      ],
    };
    const [paragraph] = normalizeCommentForEditor([node], supported);
    expect(paragraph.type).toBe('paragraph');
    const [text] = paragraph.content;
    expect(text).toMatchObject({ type: 'text', text: 'styled' });
    expect(text.marks[0].attrs).toEqual({ color: '#f00' });
    expect(text.marks[0].attrs).not.toHaveProperty('fontSize');
  });

  it('falls back to stripping only bookmark nodes when the supported set is empty', () => {
    const result = normalizeCommentForEditor([bookmarkParagraph()], new Set());
    const types = collectTypes(result);
    // Bookmarks always stripped...
    expect(types).not.toContain('bookmarkStart');
    expect(types).not.toContain('bookmarkEnd');
    // ...but supported/other nodes are not aggressively removed in fallback mode.
    expect(types).toContain('paragraph');
    const text = result[0].content.map((n) => n.text).join('');
    expect(text).toBe('Before mention @Person');
  });
});
