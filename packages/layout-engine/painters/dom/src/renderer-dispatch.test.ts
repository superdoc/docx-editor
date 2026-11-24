/**
 * Fragment dispatch coverage tests.
 *
 * Paints one fragment of each kind and checks the painted root and content
 * that kind's renderer produces.
 */

import { describe, it, expect, beforeEach } from 'vite-plus/test';
import { createTestPainter as createDomPainter } from './_test-utils.js';
import type { FlowBlock, Measure, Layout } from '@superdoc/contracts';

// ---------------------------------------------------------------------------
// Minimal fixtures per fragment kind
// ---------------------------------------------------------------------------

function paragraphFixtures() {
  const block: FlowBlock = {
    kind: 'paragraph',
    id: 'para-dispatch',
    runs: [{ text: 'Hello', fontFamily: 'Arial', fontSize: 12, pmStart: 1, pmEnd: 6 }],
  };
  const measure: Measure = {
    kind: 'paragraph',
    lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 5, width: 50, ascent: 10, descent: 4, lineHeight: 16 }],
    totalHeight: 16,
  };
  const layout: Layout = {
    pageSize: { w: 400, h: 500 },
    pages: [
      {
        number: 1,
        fragments: [
          {
            kind: 'para',
            blockId: 'para-dispatch',
            fromLine: 0,
            toLine: 1,
            x: 0,
            y: 0,
            width: 300,
            pmStart: 1,
            pmEnd: 6,
          },
        ],
      },
    ],
  };
  return { blocks: [block], measures: [measure], layout };
}

function imageFixtures() {
  const block: FlowBlock = {
    kind: 'image',
    id: 'img-dispatch',
    src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
    attrs: { pmStart: 1, pmEnd: 2 },
  };
  const measure: Measure = {
    kind: 'image',
    width: 100,
    height: 80,
    scale: 1,
    naturalWidth: 100,
    naturalHeight: 80,
  };
  const layout: Layout = {
    pageSize: { w: 400, h: 500 },
    pages: [
      {
        number: 1,
        fragments: [
          {
            kind: 'image',
            blockId: 'img-dispatch',
            x: 0,
            y: 0,
            width: 100,
            height: 80,
            pmStart: 1,
            pmEnd: 2,
          },
        ],
      },
    ],
  };
  return { blocks: [block], measures: [measure], layout };
}

function drawingFixtures() {
  const block: FlowBlock = {
    kind: 'drawing',
    id: 'drawing-dispatch',
    drawingKind: 'vectorShape',
    geometry: { width: 60, height: 40, rotation: 0, flipH: false, flipV: false },
    attrs: { pmStart: 1, pmEnd: 2 },
  };
  const measure: Measure = {
    kind: 'drawing',
    drawingKind: 'vectorShape',
    width: 60,
    height: 40,
    scale: 1,
    naturalWidth: 60,
    naturalHeight: 40,
    geometry: { width: 60, height: 40, rotation: 0, flipH: false, flipV: false },
  };
  const layout: Layout = {
    pageSize: { w: 400, h: 500 },
    pages: [
      {
        number: 1,
        fragments: [
          {
            kind: 'drawing',
            blockId: 'drawing-dispatch',
            drawingKind: 'vectorShape',
            x: 0,
            y: 0,
            width: 60,
            height: 40,
            geometry: { width: 60, height: 40, rotation: 0, flipH: false, flipV: false },
            scale: 1,
            pmStart: 1,
            pmEnd: 2,
          },
        ],
      },
    ],
  };
  return { blocks: [block], measures: [measure], layout };
}

function chartDrawingFixtures() {
  const block: FlowBlock = {
    kind: 'drawing',
    id: 'chart-dispatch',
    drawingKind: 'chart',
    geometry: { width: 400, height: 300, rotation: 0, flipH: false, flipV: false },
    chartData: {
      chartType: 'barChart',
      barDirection: 'col',
      series: [{ name: 'Series 1', categories: ['A', 'B'], values: [10, 20] }],
    },
    attrs: { pmStart: 1, pmEnd: 2 },
  };
  const measure: Measure = {
    kind: 'drawing',
    drawingKind: 'chart',
    width: 400,
    height: 300,
    scale: 1,
    naturalWidth: 400,
    naturalHeight: 300,
    geometry: { width: 400, height: 300, rotation: 0, flipH: false, flipV: false },
  };
  const layout: Layout = {
    pageSize: { w: 800, h: 600 },
    pages: [
      {
        number: 1,
        fragments: [
          {
            kind: 'drawing',
            blockId: 'chart-dispatch',
            drawingKind: 'chart',
            x: 0,
            y: 0,
            width: 400,
            height: 300,
            geometry: { width: 400, height: 300, rotation: 0, flipH: false, flipV: false },
            scale: 1,
            pmStart: 1,
            pmEnd: 2,
          },
        ],
      },
    ],
  };
  return { blocks: [block], measures: [measure], layout };
}

function tableFixtures() {
  const block: FlowBlock = {
    kind: 'table',
    id: 'table-dispatch',
    rows: [
      {
        id: 'row-0',
        cells: [
          {
            id: 'cell-0',
            blocks: [
              {
                kind: 'paragraph',
                id: 'table-para-dispatch',
                runs: [{ text: 'Cell', fontFamily: 'Arial', fontSize: 12, pmStart: 1, pmEnd: 5 }],
              },
            ],
            attrs: {},
          },
        ],
      },
    ],
  };
  const measure: Measure = {
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
  const layout: Layout = {
    pageSize: { w: 400, h: 500 },
    pages: [
      {
        number: 1,
        fragments: [
          {
            kind: 'table',
            blockId: 'table-dispatch',
            fromRow: 0,
            toRow: 1,
            x: 0,
            y: 0,
            width: 120,
            height: 24,
          },
        ],
      },
    ],
  };
  return { blocks: [block], measures: [measure], layout };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('renderFragment dispatch', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
  });

  it.each([
    { name: 'para', fixtures: paragraphFixtures, rootClass: 'superdoc-fragment', content: '.superdoc-line' },
    { name: 'image', fixtures: imageFixtures, rootClass: 'superdoc-fragment superdoc-image-fragment', content: 'img' },
    {
      name: 'drawing',
      fixtures: drawingFixtures,
      rootClass: 'superdoc-fragment superdoc-drawing-fragment',
      content: '.superdoc-drawing-inner > .superdoc-vector-shape',
    },
    {
      name: 'chart drawing',
      fixtures: chartDrawingFixtures,
      rootClass: 'superdoc-fragment superdoc-drawing-fragment',
      content: '.superdoc-drawing-inner > .superdoc-chart > svg',
    },
    {
      name: 'table',
      fixtures: tableFixtures,
      rootClass: 'superdoc-fragment superdoc-table-fragment',
      content: '[data-superdoc-table-row-role="body"] .superdoc-line',
    },
  ])('paints a $name fragment with its own renderer', ({ fixtures, rootClass, content }) => {
    const { blocks, measures, layout } = fixtures();
    const painter = createDomPainter({ blocks, measures });
    painter.paint(layout, container);
    const fragments = container.querySelectorAll('.superdoc-page > .superdoc-fragment');
    expect(fragments).toHaveLength(1);
    expect(fragments[0]!.className).toBe(rootClass);
    expect(fragments[0]!.querySelector(content)).not.toBeNull();
  });

  it('throws for unknown fragment kind', () => {
    const { blocks, measures } = paragraphFixtures();
    const layout: Layout = {
      pageSize: { w: 400, h: 500 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'unknown' as any,
              blockId: 'para-dispatch',
              x: 0,
              y: 0,
              width: 100,
            } as any,
          ],
        },
      ],
    };
    const painter = createDomPainter({ blocks, measures });
    expect(() => painter.paint(layout, container)).toThrow('unsupported fragment kind');
  });
});
