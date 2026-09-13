import { afterEach, describe, expect, it } from 'vite-plus/test';
import type { Layout, Measure, ParagraphBlock } from '@superdoc/contracts';
import { createTestPainter } from './_test-utils.js';

const NOTE_ID = 'footnote-1-paragraph';
const block: ParagraphBlock = {
  kind: 'paragraph',
  id: NOTE_ID,
  runs: [{ text: 'Footnote text', fontFamily: 'Arial', fontSize: 12 }],
};
const measure: Measure = {
  kind: 'paragraph',
  lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 13, width: 80, ascent: 8, descent: 2, lineHeight: 10 }],
  totalHeight: 10,
};

function layout(y: number, pmStart: number, continuesOnNext = false): Layout {
  return {
    pageSize: { w: 400, h: 500 },
    pages: [
      {
        number: 1,
        fragments: [
          {
            kind: 'para',
            blockId: 'body-paragraph',
            fromLine: 0,
            toLine: 1,
            x: 20,
            y,
            width: 320,
            pmStart: 0,
            pmEnd: 13,
          },
          {
            kind: 'para',
            blockId: NOTE_ID,
            fromLine: 0,
            toLine: 1,
            x: 20,
            y: 400,
            width: 320,
            pmStart,
            pmEnd: pmStart + 13,
            continuesOnNext,
          },
        ],
      },
    ],
  };
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function mountFootnote() {
  const mount = document.createElement('div');
  document.body.append(mount);
  const painter = createTestPainter({
    blocks: [{ ...block, id: 'body-paragraph' }, block],
    measures: [measure, measure],
  });
  cleanups.push(() => {
    painter.dispose();
    mount.remove();
  });
  painter.paint(layout(100, 10), mount);
  const fragment = mount.querySelector<HTMLElement>(`[data-block-id="${NOTE_ID}"]`)!;
  expect(fragment).not.toBeNull();
  expect(fragment.getAttribute('contenteditable')).toBe('false');
  return { mount, painter, fragment };
}

describe('footnote editability during retained painting', () => {
  it('updates retained geometry and positions without resetting native editability', () => {
    const { mount, painter, fragment } = mountFootnote();
    const observer = new MutationObserver(() => {});
    observer.observe(fragment, { attributes: true, attributeFilter: ['contenteditable'], attributeOldValue: true });
    cleanups.push(() => observer.disconnect());

    painter.paint(layout(80, 20), mount);

    expect(mount.querySelector(`[data-block-id="${NOTE_ID}"]`)).toBe(fragment);
    expect(fragment.style.top).toBe('400px');
    expect((mount.querySelector('[data-block-id="body-paragraph"]') as HTMLElement).style.top).toBe('80px');
    expect(fragment.dataset.pmStart).toBe('20');
    expect(fragment.dataset.pmEnd).toBe('33');
    expect(fragment.dataset.continuesOnNext).toBeUndefined();
    expect(fragment.textContent).toBe('Footnote text');
    expect(fragment.getAttribute('contenteditable')).toBe('false');
    expect(observer.takeRecords()).toEqual([]);

    painter.paint(layout(60, 30), mount);
    expect(fragment.dataset.pmStart).toBe('30');
    expect(fragment.dataset.continuesOnNext).toBeUndefined();
    expect(observer.takeRecords()).toEqual([]);
  });

  it.each([null, 'true', 'plaintext-only'])('restores read-only state when the live attribute is %s', (value) => {
    const { mount, painter, fragment } = mountFootnote();
    if (value == null) fragment.removeAttribute('contenteditable');
    else fragment.setAttribute('contenteditable', value);

    painter.paint(layout(80, 20), mount);

    expect(mount.querySelector(`[data-block-id="${NOTE_ID}"]`)).toBe(fragment);
    expect(fragment.getAttribute('contenteditable')).toBe('false');
    expect(fragment.dataset.pmStart).toBe('20');
  });
});
