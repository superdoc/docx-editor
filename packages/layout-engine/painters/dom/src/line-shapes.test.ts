import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import type { DrawingBlock, Layout, Measure } from '@superdoc/contracts';
import { createTestPainter } from './_test-utils.js';
import { describeElement } from './test-utils/describe-element.js';

const RECORDINGS = './__snapshots__/line-shapes';

type ShapeInput = Pick<DrawingBlock, 'shapeKind' | 'strokeColor' | 'strokeWidth' | 'fillColor'> & {
  width: number;
  height: number;
};

let mount: HTMLElement;

beforeEach(() => {
  mount = document.createElement('div');
  document.body.append(mount);
});

afterEach(() => {
  mount.remove();
});

const paintShape = ({ width, height, ...style }: ShapeInput): Element => {
  const geometry = { width, height, rotation: 0, flipH: false, flipV: false };
  const block: DrawingBlock = { kind: 'drawing', id: 'shape', drawingKind: 'vectorShape', geometry, ...style };
  const measure: Measure = {
    kind: 'drawing',
    drawingKind: 'vectorShape',
    width,
    height,
    scale: 1,
    naturalWidth: width,
    naturalHeight: height,
    geometry,
  };
  const layout: Layout = {
    pageSize: { w: 600, h: 800 },
    pages: [
      {
        number: 1,
        fragments: [
          {
            kind: 'drawing',
            blockId: 'shape',
            drawingKind: 'vectorShape',
            x: 20,
            y: 20,
            width,
            height,
            geometry,
            scale: 1,
          },
        ],
      },
    ],
  };
  createTestPainter({ blocks: [block], measures: [measure] }).paint(layout, mount);
  const shape = mount.querySelector('.superdoc-vector-shape');
  if (!shape) throw new Error('vector shape was not painted');
  return shape;
};

describe('line shapes', () => {
  it.each<[string, ShapeInput]>([
    ['horizontal', { shapeKind: 'line', width: 400, height: 0, strokeColor: '#5b9bd5', strokeWidth: 2 }],
    ['vertical', { shapeKind: 'line', width: 0, height: 300, strokeColor: '#ff0000', strokeWidth: 3 }],
    ['diagonal', { shapeKind: 'line', width: 200, height: 200, strokeColor: '#00ff00', strokeWidth: 4 }],
    ['no-stroke', { shapeKind: 'line', width: 100, height: 0, strokeColor: null, strokeWidth: 1 }],
    ['default-stroke-color', { shapeKind: 'line', width: 100, height: 0, strokeWidth: 2 }],
    ['default-stroke-width', { shapeKind: 'line', width: 100, height: 50, strokeColor: '#5b9bd5' }],
    ['hairline-horizontal', { shapeKind: 'line', width: 100, height: 0, strokeColor: '#000000', strokeWidth: 0.5 }],
    ['hairline-diagonal', { shapeKind: 'line', width: 100, height: 50, strokeColor: '#000000', strokeWidth: 0.5 }],
    ['point', { shapeKind: 'line', width: 0, height: 0 }],
    [
      'straight-connector',
      { shapeKind: 'straightConnector1', width: 120, height: 0, strokeColor: '#5b9bd5', strokeWidth: 2 },
    ],
  ])('paints a %s line as one SVG line', async (name, input) => {
    const shape = paintShape(input);

    expect(shape.querySelectorAll('svg line')).toHaveLength(1);
    await expect(describeElement(shape)).toMatchFileSnapshot(`${RECORDINGS}/line-${name}.txt`);
  });
});

describe('dimension-sensitive preset arrows', () => {
  it.each<[string, ShapeInput]>([
    [
      'left-right-arrow-200x100',
      { shapeKind: 'leftRightArrow', width: 200, height: 100, fillColor: '#5b9bd5', strokeColor: null },
    ],
    [
      'left-right-arrow-100x100',
      { shapeKind: 'leftRightArrow', width: 100, height: 100, fillColor: '#5b9bd5', strokeColor: null },
    ],
    [
      'up-down-arrow-100x200',
      { shapeKind: 'upDownArrow', width: 100, height: 200, fillColor: '#5b9bd5', strokeColor: null },
    ],
  ])('paints %s from the shape geometry', async (name, input) => {
    const shape = paintShape(input);

    expect(shape.querySelector('svg')?.getAttribute('viewBox')).toBe(`0 0 ${input.width} ${input.height}`);
    await expect(describeElement(shape)).toMatchFileSnapshot(`${RECORDINGS}/${name}.txt`);
  });
});
