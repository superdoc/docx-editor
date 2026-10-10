// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { FlowBlock, Measure, ParagraphBlock, ParagraphMeasure } from '@superdoc/contracts';
import { resolveLayout } from '@superdoc/layout-resolved';
import { createDomPainter } from '@superdoc/painter-dom';
import { incrementalLayout, measureCache } from '../src/incrementalLayout.js';
import { remeasureParagraph } from '../src/remeasure.js';
import { findCharacterAtX, measureCharacterX } from '../src/text-measurement.js';

const options = { pageSize: { w: 300, h: 400 }, margins: { top: 20, right: 20, bottom: 20, left: 20 } };
const paragraph = (): ParagraphBlock => ({
  kind: 'paragraph',
  id: 'tab-paragraph',
  runs: [
    { kind: 'text', text: 'a', fontFamily: 'Arial', fontSize: 12, pmStart: 1, pmEnd: 2 },
    {
      kind: 'tab',
      text: '\t',
      fontFamily: 'Arial',
      fontSize: 12,
      pmStart: 2,
      pmEnd: 3,
      underline: { style: 'single', color: '#000000' },
    },
  ],
});
const paragraphMeasure = (): ParagraphMeasure => ({
  kind: 'paragraph',
  totalHeight: 12,
  lines: [
    {
      fromRun: 0,
      fromChar: 0,
      toRun: 1,
      toChar: 1,
      width: 45,
      ascent: 9,
      descent: 3,
      lineHeight: 12,
      tabWidths: { 1: 37 },
      segments: [{ runIndex: 0, fromChar: 0, toChar: 1, width: 8, x: 0 }],
    },
  ],
});
const input = (nested: boolean): FlowBlock =>
  nested
    ? {
        kind: 'table',
        id: 'tab-table',
        columnWidths: [120],
        rows: [{ id: 'row', cells: [{ id: 'cell', blocks: [paragraph()] }] }],
      }
    : paragraph();
const getParagraph = (block: FlowBlock): ParagraphBlock =>
  block.kind === 'paragraph'
    ? block
    : ((block as Extract<FlowBlock, { kind: 'table' }>).rows[0]!.cells[0]!.blocks![0] as ParagraphBlock);
const freeze = (value: object): void => {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
  Object.freeze(value);
};

describe('incrementalLayout immutable measured tabs', () => {
  beforeEach(() => measureCache.clear());

  it('paints a remeasured frozen trailing tab and its underline from line-owned widths', async () => {
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'frozen-trailing-tab',
      runs: [{ kind: 'tab', text: '\t', fontFamily: 'Arial', fontSize: 12, underline: { style: 'single' } }],
      attrs: { tabs: [{ pos: 720, val: 'start' }] },
    };
    freeze(block);
    const blocks = [block];
    const result = await incrementalLayout([], null, blocks, options, async () => remeasureParagraph(block, 260));
    const resolvedLayout = resolveLayout({
      layout: result.layout,
      blocks,
      measures: result.measures,
      flowMode: 'semantic',
    });
    const mount = document.createElement('div');
    const painter = createDomPainter({ flowMode: 'semantic' });
    painter.paint({ resolvedLayout }, mount);

    expect(mount.querySelector<HTMLElement>('.superdoc-tab')?.style.width).toBe('48px');
    expect(mount.querySelector<HTMLElement>('.superdoc-tab')?.style.borderBottom).toContain('solid');
    const line = (result.measures[0] as ParagraphMeasure).lines[0]!;
    expect(measureCharacterX(block, line, 1)).toBe(48);
    expect(findCharacterAtX(block, line, 40, 0).charOffset).toBe(1);
    expect(block.runs[0]).not.toHaveProperty('width');
    painter.dispose();
  });

  it.each([
    ['paragraph previous measure', false, true],
    ['paragraph cache hit', false, false],
    ['nested table previous measure', true, true],
    ['nested table cache hit', true, false],
  ] as const)('preserves cold resolved and painted geometry for %s', async (_name, nested, reusePrevious) => {
    const measure = vi.fn(async (block: FlowBlock): Promise<Measure> => {
      const run = getParagraph(block).runs[1]!;
      if (run.kind === 'tab' && Object.isExtensible(run)) run.width = 37;
      return block.kind === 'paragraph'
        ? paragraphMeasure()
        : {
            kind: 'table',
            columnWidths: [120],
            totalWidth: 120,
            totalHeight: 12,
            rows: [
              { height: 12, cells: [{ width: 120, height: 12, gridColumnStart: 0, blocks: [paragraphMeasure()] }] },
            ],
          };
    });
    const previous = [input(nested)];
    const cold = await incrementalLayout([], null, previous, options, measure);
    const next = [input(nested)];
    freeze(next);
    const cached = await incrementalLayout(
      reusePrevious ? previous : [],
      reusePrevious ? cold.layout : null,
      next,
      options,
      measure,
      undefined,
      reusePrevious ? cold.measures : undefined,
    );
    expect(measure).toHaveBeenCalledTimes(1);
    expect(getParagraph(next[0]!).runs[1]).not.toHaveProperty('width');
    expect(cached.layout).toEqual(cold.layout);
    const resolve = (result: typeof cold, blocks: FlowBlock[]) =>
      resolveLayout({
        layout: result.layout,
        blocks,
        measures: result.measures,
        flowMode: 'semantic',
      });
    const reference = resolve(cold, previous);
    const current = resolve(cached, next);
    expect(current.pages.map((page) => page.items.map((item) => item.version))).toEqual(
      reference.pages.map((page) => page.items.map((item) => item.version)),
    );
    const paint = (resolvedLayout: typeof reference) => {
      const mount = document.createElement('div');
      const painter = createDomPainter({ flowMode: 'semantic' });
      painter.paint({ resolvedLayout }, mount);
      const tabs = [...mount.querySelectorAll<HTMLElement>('.superdoc-tab')].map((tab) => ({
        width: tab.style.width,
        left: tab.style.left,
        border: tab.style.borderBottom,
      }));
      const underlines = [...mount.querySelectorAll<HTMLElement>('.superdoc-underline-overlay')].map((mark) => ({
        width: mark.style.width,
        left: mark.style.left,
        border: mark.style.borderTop,
      }));
      painter.dispose();
      return { tabs, underlines };
    };
    const expected = paint(reference);
    expect(expected.tabs).toHaveLength(1);
    expect(expected.tabs[0]!.width).toBe('37px');
    expect(expected.underlines).toHaveLength(1);
    expect(expected.underlines[0]!.width).toBe('37px');
    expect(paint(current)).toEqual(expected);
  });
});
