import { afterEach, describe, expect, it } from 'vite-plus/test';
import { caretAt, documentSelection, rangeAcross } from './dom-selection.js';

afterEach(() => {
  documentSelection(null);
  document.body.replaceChildren();
});

function attachedText(value: string): Text {
  const text = document.createTextNode(value);
  document.body.append(text);
  return text;
}

describe('documentSelection', () => {
  it('returns the real document Selection holding a range across two text nodes', () => {
    const start = attachedText('start');
    const end = attachedText('end');

    const selection = documentSelection(rangeAcross(start, end));

    expect(selection).toBeInstanceOf(Selection);
    expect(selection).toBe(document.getSelection());
    expect(selection.rangeCount).toBe(1);
    expect(selection.isCollapsed).toBe(false);
    expect(selection.getRangeAt(0).startContainer).toBe(start);
    expect(selection.getRangeAt(0).endContainer).toBe(end);
  });

  it('holds a collapsed caret', () => {
    const selection = documentSelection(caretAt(attachedText('caret'), 2));

    expect(selection.rangeCount).toBe(1);
    expect(selection.isCollapsed).toBe(true);
    expect(selection.getRangeAt(0).startOffset).toBe(2);
  });

  it('clears every range when given null', () => {
    documentSelection(caretAt(attachedText('caret'), 1));

    const selection = documentSelection(null);

    expect(selection.rangeCount).toBe(0);
    expect(selection.isCollapsed).toBe(true);
  });

  it('throws when the range sits in nodes outside the document', () => {
    const detached = document.createTextNode('detached');
    const range = document.createRange();
    range.selectNodeContents(detached);

    expect(() => documentSelection(range)).toThrow('Attach the range nodes to the document first');
  });
});
