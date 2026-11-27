import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import { createTestPainter as createDomPainter } from './_test-utils.js';
import type { FlowBlock, Layout, Measure, TextRun } from '@superdoc/contracts';

const tableBlock = (underline: TextRun['underline']): FlowBlock => ({
  kind: 'table',
  id: 'underline-table',
  rows: [
    {
      id: 'row-0',
      cells: [
        {
          id: 'cell-0',
          attrs: {},
          blocks: [
            {
              kind: 'paragraph',
              id: 'underline-cell-paragraph',
              runs: [{ text: 'Cell', fontFamily: 'Arial', fontSize: 12, pmStart: 1, pmEnd: 5, underline }],
            },
          ],
        },
      ],
    },
  ],
});

const tableMeasure: Measure = {
  kind: 'table',
  rows: [
    {
      height: 24,
      cells: [
        {
          width: 120,
          height: 24,
          gridColumnStart: 0,
          blocks: [
            {
              kind: 'paragraph',
              lines: [
                { fromRun: 0, fromChar: 0, toRun: 0, toChar: 4, width: 40, ascent: 10, descent: 4, lineHeight: 16 },
              ],
              totalHeight: 16,
            },
          ],
        },
      ],
    },
  ],
  columnWidths: [120],
  totalWidth: 120,
  totalHeight: 24,
};

const tableLayout: Layout = {
  pageSize: { w: 400, h: 500 },
  pages: [
    {
      number: 1,
      fragments: [
        { kind: 'table', blockId: 'underline-table', fromRow: 0, toRow: 1, x: 0, y: 0, width: 120, height: 24 },
      ],
    },
  ],
};

describe('DomPainter table run underline repaint', () => {
  let mount: HTMLElement;

  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  afterEach(() => {
    mount.remove();
  });

  const paintedUnderline = () => {
    const run = mount.querySelector<HTMLElement>('.superdoc-table-fragment .superdoc-text-run')!;
    return {
      line: run.style.textDecorationLine,
      style: run.style.textDecorationStyle,
      color: run.style.textDecorationColor,
    };
  };

  it.each([
    { change: 'style', next: { style: 'wavy', color: '#00FF00' }, painted: { style: 'wavy', color: '#00FF00' } },
    { change: 'color', next: { style: 'dashed', color: '#FF0000' }, painted: { style: 'dashed', color: '#FF0000' } },
  ] as const)('repaints a table cell when only the run underline $change changes', ({ next, painted }) => {
    const painter = createDomPainter({
      blocks: [tableBlock({ style: 'dashed', color: '#00FF00' })],
      measures: [tableMeasure],
    });
    painter.paint(tableLayout, mount);
    expect(paintedUnderline()).toEqual({ line: 'underline', style: 'dashed', color: '#00FF00' });

    painter.setData?.([tableBlock(next)], [tableMeasure]);
    painter.paint(tableLayout, mount);
    expect(paintedUnderline()).toEqual({ line: 'underline', ...painted });
  });

  it('repaints a table cell when the run underline is removed', () => {
    const painter = createDomPainter({
      blocks: [tableBlock({ style: 'dashed', color: '#00FF00' })],
      measures: [tableMeasure],
    });
    painter.paint(tableLayout, mount);

    painter.setData?.([tableBlock(undefined)], [tableMeasure]);
    painter.paint(tableLayout, mount);
    expect(paintedUnderline().line).toBe('');
  });
});
