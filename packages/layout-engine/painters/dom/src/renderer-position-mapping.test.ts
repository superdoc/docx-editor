import { afterEach, describe, expect, it } from 'vite-plus/test';
import type { Layout, Measure, ParagraphBlock } from '@superdoc/contracts';
import { createTestPainter } from './_test-utils.js';

const BEFORE_EDIT_ID = 'body-paragraph-0';
const AFTER_EDIT_ID = 'body-paragraph-1';
const NOTE_ID = 'footnote-1-paragraph';

const paragraph = (id: string, pmStart: number): ParagraphBlock => ({
  kind: 'paragraph',
  id,
  runs: [{ text: 'Hello', fontFamily: 'Arial', fontSize: 12, pmStart, pmEnd: pmStart + 5 }],
});

const measure: Measure = {
  kind: 'paragraph',
  lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 5, width: 40, ascent: 8, descent: 2, lineHeight: 10 }],
  totalHeight: 10,
};
const measures = [measure, measure, measure];

type Positions = { beforeEdit: number; afterEdit: number; note: number };

const blocks = ({ beforeEdit, afterEdit, note }: Positions) => [
  paragraph(BEFORE_EDIT_ID, beforeEdit),
  paragraph(AFTER_EDIT_ID, afterEdit),
  paragraph(NOTE_ID, note),
];

const fragment = (blockId: string, y: number, pmStart: number) =>
  ({ kind: 'para', blockId, fromLine: 0, toLine: 1, x: 20, y, width: 320, pmStart, pmEnd: pmStart + 5 }) as const;

const layout = ({ beforeEdit, afterEdit, note }: Positions): Layout => ({
  pageSize: { w: 400, h: 500 },
  pages: [
    {
      number: 1,
      fragments: [
        fragment(BEFORE_EDIT_ID, 20, beforeEdit),
        fragment(AFTER_EDIT_ID, 40, afterEdit),
        fragment(NOTE_ID, 400, note),
      ],
    },
  ],
});

const insertTwoAtTen = { map: (pos: number) => (pos >= 10 ? pos + 2 : pos), maps: [{}] };

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const paintedPositions = (mount: HTMLElement, blockId: string): string[] => {
  const fragmentEl = mount.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`);
  if (!fragmentEl) return [];
  return [fragmentEl, ...fragmentEl.querySelectorAll<HTMLElement>('[data-pm-start], [data-pm-end]')].map(
    (el) => `${el.tagName.toLowerCase()} ${el.dataset.pmStart}-${el.dataset.pmEnd}`,
  );
};

const paintBeforeAndAfterEdit = () => {
  const mount = document.createElement('div');
  document.body.append(mount);
  const before: Positions = { beforeEdit: 0, afterEdit: 25, note: 8 };
  const after: Positions = { beforeEdit: 0, afterEdit: 27, note: 8 };
  const painter = createTestPainter({ flowMode: 'semantic', blocks: blocks(before), measures });
  cleanups.push(() => {
    painter.dispose();
    mount.remove();
  });
  painter.paint(layout(before), mount);
  const paintedBefore = new Map(
    [BEFORE_EDIT_ID, AFTER_EDIT_ID, NOTE_ID].map((id) => [id, mount.querySelector(`[data-block-id="${id}"]`)]),
  );
  painter.setData(blocks(after), measures);
  painter.paint(layout(after), mount, insertTwoAtTen);
  const reused = (id: string) => paintedBefore.get(id) === mount.querySelector(`[data-block-id="${id}"]`);
  return { mount, reused };
};

describe('DomPainter paint with a body transaction mapping', () => {
  it('remaps reused body fragments after the edit and leaves earlier ones alone', () => {
    const { mount, reused } = paintBeforeAndAfterEdit();

    expect(reused(BEFORE_EDIT_ID)).toBe(true);
    expect(reused(AFTER_EDIT_ID)).toBe(true);
    expect(paintedPositions(mount, BEFORE_EDIT_ID)).toEqual(['div 0-5', 'div 0-5', 'span 0-5']);
    expect(paintedPositions(mount, AFTER_EDIT_ID)).toEqual(['div 27-32', 'div 27-32', 'span 27-32']);
  });

  it('does not remap footnote fragments with body transaction mappings', () => {
    const { mount, reused } = paintBeforeAndAfterEdit();

    expect(reused(NOTE_ID)).toBe(true);
    expect(paintedPositions(mount, NOTE_ID)).toEqual(['div 8-13', 'div 8-13', 'span 8-13']);
  });
});
