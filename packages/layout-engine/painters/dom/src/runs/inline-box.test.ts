import { describe, expect, it } from 'vitest';
import type { Line, LineInlineBox, ParagraphBlock } from '@superdoc/contracts';
import { paintInlineBoxes, splitInlineBoxRuns } from './inline-box.js';

const makeBox = (overrides: Partial<LineInlineBox> = {}): LineInlineBox => ({
  id: 'provider:box-1',
  from: 1,
  to: 5,
  x: 10,
  width: 52,
  top: 0,
  height: 26,
  startsRange: true,
  endsRange: true,
  style: {
    paddingInlineStart: 3,
    paddingInlineEnd: 4,
    paddingBlockStart: 2,
    paddingBlockEnd: 2,
    gapBefore: 5,
    gapAfter: 6,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#123456',
    borderRadius: 7,
    backgroundColor: '#abcdef',
    color: '#101010',
  },
  className: 'citation-pill selected',
  data: { source: 'citation' },
  cursor: 'pointer',
  ...overrides,
});

const appendTextLeaf = (line: HTMLElement, text: string, pmStart: number): HTMLElement => {
  const leaf = document.createElement('span');
  const from = line.textContent?.length ?? 0;
  leaf.className = 'superdoc-text-run';
  leaf.dataset.pmStart = String(pmStart);
  leaf.dataset.pmEnd = String(pmStart + text.length);
  leaf.setAttribute('data-superdoc-inline-box-from', String(from));
  leaf.setAttribute('data-superdoc-inline-box-to', String(from + text.length));
  leaf.textContent = text;
  line.appendChild(leaf);
  return leaf;
};

describe('paintInlineBoxes', () => {
  it('styles canonical leaves without replacing text or PM metadata', () => {
    const line = document.createElement('div');
    const first = appendTextLeaf(line, 'abc', 10);
    const second = appendTextLeaf(line, 'def', 13);

    paintInlineBoxes([makeBox()], line);

    expect(line.textContent).toBe('abcdef');
    expect(line.querySelectorAll('.superdoc-text-run')).toHaveLength(2);
    expect(first.dataset.pmStart).toBe('10');
    expect(second.dataset.pmEnd).toBe('16');
    expect(first.getAttribute('data-superdoc-inline-box-from')).toBeNull();
    expect(first.getAttribute('data-superdoc-inline-box-id')).toBe('provider:box-1');
    expect(second.getAttribute('data-superdoc-inline-box-id')).toBe('provider:box-1');
    expect(first.style.paddingInlineStart).toBe('3px');
    expect(first.style.paddingInlineEnd).toBe('0px');
    expect(second.style.paddingInlineStart).toBe('0px');
    expect(second.style.paddingInlineEnd).toBe('4px');
    expect(first.style.boxSizing).toBe('border-box');
    expect(first.style.height).toBe('26px');
    expect(first.style.lineHeight).toBe('20px');
    expect(first.style.marginInlineStart).toBe('5px');
    expect(second.style.marginInlineEnd).toBe('6px');
    expect(first.style.borderInlineStart).toContain('1px dashed');
    expect(second.style.borderInlineEnd).toContain('1px dashed');
    expect(first.style.backgroundColor).not.toBe('');
    expect(first.classList.contains('citation-pill')).toBe(true);
    expect(first.classList.contains('selected')).toBe(true);
    expect(first.getAttribute('data-superdoc-ext-source')).toBe('citation');
    expect(first.style.cursor).toBe('pointer');
    expect(first.style.zIndex).toBe('');
    expect(line.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it('preserves a typography-specific inline line height', () => {
    const line = document.createElement('div');
    const leaf = appendTextLeaf(line, 'boxed', 0);
    leaf.style.lineHeight = '17px';

    paintInlineBoxes([makeBox({ from: 0, to: 5 })], line);

    expect(leaf.style.height).toBe('26px');
    expect(leaf.style.lineHeight).toBe('17px');
  });

  it('writes an arbitrary id as inert attribute data', () => {
    const line = document.createElement('div');
    const leaf = appendTextLeaf(line, 'boxed', 0);
    const id = '"><img src=x onerror=alert(1)>';

    paintInlineBoxes([makeBox({ id, from: 0, to: 5 })], line);

    expect(leaf.getAttribute('data-superdoc-inline-box-id')).toBe(id);
    expect(line.querySelector('img')).toBeNull();
  });

  it('paints an RTL line, and writes the same logical edges as an LTR one', () => {
    // The painter used to bail on RTL because it wrote physical left/right
    // edges. Logical edges make the two calls identical: the browser resolves
    // `inline-start` against the line's own direction, which the renderer
    // already sets (`el.dir`).
    const rtl = document.createElement('div');
    rtl.dir = 'rtl';
    const rtlLeaf = appendTextLeaf(rtl, 'boxed', 0);
    const ltr = document.createElement('div');
    const ltrLeaf = appendTextLeaf(ltr, 'boxed', 0);

    paintInlineBoxes([makeBox({ from: 0, to: 5 })], rtl);
    paintInlineBoxes([makeBox({ from: 0, to: 5 })], ltr);

    expect(rtlLeaf.getAttribute('data-superdoc-inline-box-id')).toBe('provider:box-1');
    expect(rtlLeaf.style.paddingInlineStart).toBe('3px');
    expect(rtlLeaf.style.paddingInlineEnd).toBe('4px');
    expect(rtlLeaf.getAttribute('style')).toBe(ltrLeaf.getAttribute('style'));
  });

  it('never writes a physical inline edge — those are what broke RTL', () => {
    // A guard, not a duplicate: reintroducing `paddingLeft` anywhere in
    // `applyInlineBoxStyle` would keep every other assertion green while
    // silently pinning the box to the wrong side of an RTL line.
    const line = document.createElement('div');
    const leaf = appendTextLeaf(line, 'boxed', 0);

    paintInlineBoxes([makeBox({ from: 0, to: 5 })], line);

    for (const property of [
      'padding-left',
      'padding-right',
      'margin-left',
      'margin-right',
      'border-left',
      'border-right',
    ]) {
      expect(leaf.getAttribute('style')).not.toContain(property);
    }
  });

  it('preserves canonical run color and highlight when the box does not override them', () => {
    const line = document.createElement('div');
    const leaf = appendTextLeaf(line, 'boxed', 0);
    leaf.style.color = '#ff0000';
    leaf.style.backgroundColor = 'yellow';
    const box = makeBox({
      from: 0,
      to: 5,
      style: { ...makeBox().style, color: undefined, backgroundColor: undefined },
    });

    paintInlineBoxes([box], line);

    expect(leaf.style.color).toBe('#ff0000');
    expect(leaf.style.backgroundColor).toBe('yellow');
  });
});

describe('splitInlineBoxRuns', () => {
  it('preserves atomic runs and marks text slices in visible-text coordinates', () => {
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'tabbed-box',
      attrs: {},
      runs: [
        { kind: 'tab', text: '\t', width: 40, fontSize: 16 },
        { kind: 'text', text: 'abcdefghij', fontFamily: 'Arial', fontSize: 16, pmStart: 20, pmEnd: 30 },
      ],
    };
    const line: Line = {
      fromRun: 0,
      fromChar: 0,
      toRun: 1,
      toChar: 10,
      width: 120,
      maxWidth: 200,
      ascent: 12,
      descent: 4,
      lineHeight: 22,
      segments: [
        { runIndex: 1, fromChar: 0, toChar: 5, width: 40 },
        { runIndex: 1, fromChar: 5, toChar: 10, width: 40 },
      ],
      inlineBoxes: [makeBox({ from: 6, to: 11 })],
    };

    const runs = splitInlineBoxRuns(block, line);

    expect(runs?.map((run) => run.kind)).toEqual(['tab', 'text', 'text']);
    expect(runs?.filter((run) => run.kind === 'text').map((run) => run.text)).toEqual(['abcde', 'fghij']);
    expect(runs?.[1]?.dataAttrs).toMatchObject({
      'data-superdoc-inline-box-from': '1',
      'data-superdoc-inline-box-to': '6',
    });
    expect(runs?.[2]?.dataAttrs).toMatchObject({
      'data-superdoc-inline-box-from': '6',
      'data-superdoc-inline-box-to': '11',
    });
  });
});
