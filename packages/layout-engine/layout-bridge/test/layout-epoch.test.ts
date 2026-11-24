/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import type { FlowBlock, Layout, Measure } from '@superdoc/contracts';

import { clickToPosition } from '../src/index.ts';

describe('clickToPosition layout epoch resolution', () => {
  const layout: Layout = {
    pageSize: { w: 500, h: 500 },
    pages: [{ number: 1, fragments: [] }],
  };
  const blocks: FlowBlock[] = [];
  const measures: Measure[] = [];

  let originalElementsFromPoint: ((x: number, y: number) => Element[]) | undefined;

  afterEach(() => {
    if (originalElementsFromPoint) {
      Object.defineProperty(document, 'elementsFromPoint', {
        configurable: true,
        value: originalElementsFromPoint,
      });
      originalElementsFromPoint = undefined;
    } else {
      delete (document as unknown as { elementsFromPoint?: unknown }).elementsFromPoint;
    }
  });

  it('uses the newest layout epoch from the DOM hit chain', () => {
    const container = document.createElement('div');
    const page = document.createElement('div');
    page.className = 'superdoc-page';
    page.dataset.pageIndex = '0';
    page.dataset.layoutEpoch = '8';
    const fragment = document.createElement('div');
    fragment.className = 'superdoc-fragment';
    fragment.dataset.pmStart = '10';
    fragment.dataset.pmEnd = '15';
    const line = document.createElement('div');
    line.className = 'superdoc-line';
    line.dataset.pmStart = '10';
    line.dataset.pmEnd = '15';
    line.dataset.layoutEpoch = '0';
    const run = document.createElement('span');
    run.dataset.pmStart = '10';
    run.dataset.pmEnd = '15';
    run.textContent = 'Hello';
    line.appendChild(run);
    fragment.appendChild(line);
    page.appendChild(fragment);
    container.appendChild(page);
    document.body.appendChild(container);

    originalElementsFromPoint = document.elementsFromPoint;
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [run, line, fragment, page]),
    });

    const result = clickToPosition(layout, blocks, measures, { x: 1, y: 1 }, container, 1, 1);
    expect(result?.layoutEpoch).toBe(8);

    document.body.removeChild(container);
  });
});
