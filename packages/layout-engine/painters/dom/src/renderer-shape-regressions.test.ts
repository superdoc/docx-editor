import { describe, it, expect, beforeEach, afterEach, vi } from 'vite-plus/test';
import { createTestPainter as createDomPainter } from './_test-utils.js';
import type { DrawingGeometry, FlowBlock, Layout, Measure, SolidFillWithAlpha } from '@superdoc/contracts';

type DrawingFlowBlock = Extract<FlowBlock, { kind: 'drawing' }>;

function createDrawingFixtures(block: DrawingFlowBlock): { blocks: FlowBlock[]; measures: Measure[]; layout: Layout } {
  const geometry = block.geometry;
  const measure: Measure = {
    kind: 'drawing',
    drawingKind: block.drawingKind,
    width: geometry.width,
    height: geometry.height,
    scale: 1,
    naturalWidth: geometry.width,
    naturalHeight: geometry.height,
    geometry,
    groupTransform: block.drawingKind === 'shapeGroup' ? block.groupTransform : undefined,
  };

  const layout: Layout = {
    pageSize: { w: 600, h: 800 },
    pages: [
      {
        number: 1,
        fragments: [
          {
            kind: 'drawing',
            blockId: block.id,
            drawingKind: block.drawingKind,
            x: 20,
            y: 20,
            width: geometry.width,
            height: geometry.height,
            geometry,
            scale: 1,
            isAnchored: false,
          },
        ],
      },
    ],
  };

  return {
    blocks: [block],
    measures: [measure],
    layout,
  };
}

describe('DomPainter shape regressions', () => {
  let mount: HTMLElement;

  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  afterEach(() => {
    mount.remove();
  });

  it('prefers custom geometry paths over preset lookups when both are present', () => {
    const geometry: DrawingGeometry = { width: 120, height: 120, rotation: 0, flipH: false, flipV: false };
    const customPath = 'M 0 100 L 50 0 L 100 100 Z';

    const drawingBlock: DrawingFlowBlock = {
      kind: 'drawing',
      id: 'custom-over-preset',
      drawingKind: 'vectorShape',
      geometry,
      shapeKind: 'rect',
      customGeometry: {
        paths: [{ d: customPath, w: 100, h: 100 }],
      },
      fillColor: '#0EA5E9',
      strokeColor: '#0F172A',
      strokeWidth: 1,
    };

    const { blocks, measures, layout } = createDrawingFixtures(drawingBlock);
    const painter = createDomPainter({ blocks, measures });
    painter.paint(layout, mount);

    const renderedPath = mount.querySelector(`.superdoc-vector-shape svg path[d="${customPath}"]`);
    expect(renderedPath).toBeTruthy();
  });

  it('clips a stretched picture fill through the authored preset geometry', () => {
    const geometry: DrawingGeometry = { width: 230, height: 230, rotation: 0, flipH: false, flipV: false };
    const drawingBlock: DrawingFlowBlock = {
      kind: 'drawing',
      id: 'sd-658-picture-filled-ellipse',
      drawingKind: 'vectorShape',
      geometry,
      shapeKind: 'ellipse',
      imageFill: {
        src: 'data:image/jpeg;base64,DOCTOR',
        mode: 'stretch',
        sourceRect: { left: 15000, top: 5000, right: 10000, bottom: 0 },
        rotateWithShape: true,
      },
      strokeColor: '#5B9BD5',
      strokeWidth: 6.67,
    };

    const { blocks, measures, layout } = createDrawingFixtures(drawingBlock);
    const painter = createDomPainter({ blocks, measures });
    painter.paint(layout, mount);

    const ellipse = mount.querySelector(
      '.superdoc-vector-shape svg > path, .superdoc-vector-shape svg > ellipse',
    ) as SVGElement | null;
    const image = mount.querySelector('.superdoc-vector-shape svg defs pattern image') as SVGImageElement | null;
    expect(ellipse?.getAttribute('fill')).toMatch(/^url\(#superdoc-shape-image-fill-/);
    expect(image?.getAttribute('href')).toBe('data:image/jpeg;base64,DOCTOR');
    expect(Number(image?.getAttribute('x'))).toBeCloseTo(-0.2);
    expect(Number(image?.getAttribute('y'))).toBeCloseTo(-0.05263157894736842);
    expect(Number(image?.getAttribute('width'))).toBeCloseTo(1.3333333333333333);
    expect(Number(image?.getAttribute('height'))).toBeCloseTo(1.0526315789473684);
    expect(image?.getAttribute('preserveAspectRatio')).toBe('none');
  });

  it('tiles a picture fill from its scaled, centered DrawingML tile rectangle', () => {
    const geometry: DrawingGeometry = { width: 230, height: 230, rotation: 0, flipH: false, flipV: false };
    const drawingBlock: DrawingFlowBlock = {
      kind: 'drawing',
      id: 'sd-658-tiled-ellipse',
      drawingKind: 'vectorShape',
      geometry,
      shapeKind: 'ellipse',
      imageFill: {
        src: 'data:image/jpeg;base64,DOCTOR',
        mode: 'tile',
        tile: { scaleX: 50000, scaleY: 50000, flip: 'none', alignment: 'ctr' },
      },
      strokeColor: '#5B9BD5',
      strokeWidth: 6.67,
    };

    const { blocks, measures, layout } = createDrawingFixtures(drawingBlock);
    const painter = createDomPainter({ blocks, measures });
    painter.paint(layout, mount);

    const pattern = mount.querySelector('.superdoc-vector-shape svg defs pattern') as SVGPatternElement | null;
    const image = pattern?.querySelector('image');
    expect(pattern?.getAttribute('x')).toBe('0.25');
    expect(pattern?.getAttribute('y')).toBe('0.25');
    expect(pattern?.getAttribute('width')).toBe('0.5');
    expect(pattern?.getAttribute('height')).toBe('0.5');
    expect(image?.getAttribute('x')).toBe('0');
    expect(image?.getAttribute('y')).toBe('0');
    expect(image?.getAttribute('width')).toBe('0.5');
    expect(image?.getAttribute('height')).toBe('0.5');
  });

  it('keeps custom-geometry object fills paintable for solidWithAlpha fills', () => {
    const geometry: DrawingGeometry = { width: 120, height: 120, rotation: 0, flipH: false, flipV: false };
    const alphaFill: SolidFillWithAlpha = { type: 'solidWithAlpha', color: '#22C55E', alpha: 0.4 };

    const drawingBlock: DrawingFlowBlock = {
      kind: 'drawing',
      id: 'custom-geometry-solid-alpha',
      drawingKind: 'vectorShape',
      geometry,
      customGeometry: {
        paths: [{ d: 'M 0 0 L 100 0 L 100 100 L 0 100 Z', w: 100, h: 100 }],
      },
      fillColor: alphaFill,
      strokeColor: null,
    };

    const { blocks, measures, layout } = createDrawingFixtures(drawingBlock);
    const painter = createDomPainter({ blocks, measures });
    painter.paint(layout, mount);

    const path = mount.querySelector('.superdoc-vector-shape svg path') as SVGPathElement | null;
    expect(path).toBeTruthy();
    expect(path?.getAttribute('fill')).toBe(alphaFill.color);
    expect(path?.getAttribute('fill-opacity')).toBe(String(alphaFill.alpha));
    expect(path?.hasAttribute('stroke')).toBe(false);
  });

  it("paints Word's default textbox hairline when the adapter resolves an authored zero-width line", () => {
    const drawingBlock: DrawingFlowBlock = {
      kind: 'drawing',
      id: 'word-default-textbox-hairline',
      drawingKind: 'textboxShape',
      geometry: { width: 144, height: 48, rotation: 0, flipH: false, flipV: false },
      shapeKind: 'rect',
      fillColor: '#FFFFFF',
      strokeColor: '#000000',
      strokeWidth: 1,
      contentBlocks: [
        {
          kind: 'paragraph',
          id: 'word-default-textbox-hairline-paragraph',
          runs: [{ text: 'Just text in a text box' }],
        },
      ],
    };

    const { blocks, measures, layout } = createDrawingFixtures(drawingBlock);
    const painter = createDomPainter({ blocks, measures });
    painter.paint(layout, mount);

    const outline = mount.querySelector('.superdoc-textbox-shape svg [stroke]') as SVGElement | null;
    expect(outline?.getAttribute('stroke')).toBe('#000000');
    expect(outline?.getAttribute('stroke-width')).toBe('1');
  });

  it('paints a zero-height footer connector at its full stroke weight inside effect extents', () => {
    const drawingBlock: DrawingFlowBlock = {
      kind: 'drawing',
      id: 'footer-connector',
      drawingKind: 'vectorShape',
      geometry: { width: 700, height: 7, rotation: 0, flipH: false, flipV: false },
      effectExtent: { left: 0, top: 2, right: 5, bottom: 4 },
      shapeKind: 'line',
      strokeColor: '#7CE0D3',
      strokeWidth: 6,
      strokeLineCap: 'butt',
      attrs: {
        inlineBackgroundColor: '#E6E6E6',
        sourceExtent: { width: 695, height: 0 },
      },
    };

    const { blocks, measures, layout } = createDrawingFixtures(drawingBlock);
    const painter = createDomPainter({ blocks, measures });
    painter.paint(layout, mount);

    const line = mount.querySelector('.superdoc-vector-shape svg line') as SVGLineElement | null;
    const svg = line?.ownerSVGElement;
    const content = svg?.parentElement as HTMLElement | null;
    expect(line?.getAttribute('x1')).toBe('0');
    expect(line?.getAttribute('x2')).toBe('695');
    expect(line?.getAttribute('y1')).toBe('0.5');
    expect(line?.getAttribute('y2')).toBe('0.5');
    expect(line?.getAttribute('stroke-width')).toBe('6');
    expect(line?.getAttribute('stroke-linecap')).toBe('butt');
    expect(svg?.getAttribute('preserveAspectRatio')).toBe('none');
    expect(line?.getAttribute('vector-effect')).toBe('non-scaling-stroke');
    expect(svg?.style.getPropertyValue('--superdoc-authored-stroke-color')).toBe('#7CE0D3');
    expect(svg?.style.getPropertyValue('--superdoc-inactive-stroke-color')).toBe('#BEF0E9');
    expect(svg?.style.overflow).toBe('visible');
    expect(content?.style.left).toBe('0px');
    expect(content?.style.top).toBe('2px');
    expect(content?.style.width).toBe('695px');
    expect(content?.style.height).toBe('1px');
    const fragment = mount.querySelector('.superdoc-drawing-fragment') as HTMLElement | null;
    const runBackground = fragment?.querySelector('.superdoc-inline-run-background') as HTMLElement | null;
    expect(fragment?.style.backgroundColor).toBe('');
    expect(fragment?.style.overflow).toBe('visible');
    expect(fragment?.style.width).toBe('700px');
    expect(fragment?.style.height).toBe('7px');
    expect(fragment?.classList.contains('superdoc-has-inline-run-background')).toBe(true);
    expect(runBackground?.style.backgroundColor).toBe('#E6E6E6');
    expect(runBackground?.style.left).toBe('0px');
    expect(runBackground?.style.top).toBe('0.5px');
    expect(runBackground?.style.width).toBe('700px');
    expect(runBackground?.style.height).toBe('6px');
  });

  it.each(['header', 'footer'] as const)('refreshes the %s shading marker when retained decorations change', (kind) => {
    const shaded: DrawingFlowBlock = {
      kind: 'drawing',
      id: 'shaded-line',
      drawingKind: 'vectorShape',
      geometry: { width: 100, height: 1, rotation: 0, flipH: false, flipV: false },
      shapeKind: 'line',
      strokeColor: '#7CE0D3',
      strokeWidth: 1,
      attrs: { inlineBackgroundColor: '#E6E6E6', sourceExtent: { width: 100, height: 0 } },
    };
    const plain: DrawingFlowBlock = { ...shaded, id: 'plain-line', attrs: undefined };
    const first = createDrawingFixtures(shaded);
    const second = createDrawingFixtures(plain);
    let fragments = first.layout.pages[0].fragments;
    const provider = () => ({ fragments, height: 20, offset: 0 });
    const painter = createDomPainter({
      blocks: [...first.blocks, ...second.blocks],
      measures: [...first.measures, ...second.measures],
      ...(kind === 'header' ? { headerProvider: provider } : { footerProvider: provider }),
    });
    const body: Layout = { ...first.layout, pages: [{ number: 1, fragments: [] }] };
    painter.paint(body, mount);
    const container = mount.querySelector(`[data-sd-headerfooter-kind="${kind}"]`)!;
    expect(container.querySelector('.superdoc-inline-run-background')).not.toBeNull();
    expect(container.classList.contains('superdoc-has-inline-run-background')).toBe(true);
    fragments = second.layout.pages[0].fragments;
    painter.setProviders(kind === 'header' ? provider : undefined, kind === 'footer' ? provider : undefined);
    painter.paint(body, mount);
    expect(mount.querySelector(`[data-sd-headerfooter-kind="${kind}"]`)).toBe(container);
    expect(container.querySelector('.superdoc-inline-run-background')).toBeNull();
    expect(container.classList.contains('superdoc-has-inline-run-background')).toBe(false);
  });

  it('does not inverse-scale shape-group text when child geometry is already pre-scaled', () => {
    const geometry: DrawingGeometry = { width: 200, height: 100, rotation: 0, flipH: false, flipV: false };

    const drawingBlock: DrawingFlowBlock = {
      kind: 'drawing',
      id: 'shape-group-text-no-inverse-scale',
      drawingKind: 'shapeGroup',
      geometry,
      groupTransform: {
        width: 200,
        height: 100,
        childWidth: 100,
        childHeight: 50,
      },
      shapes: [
        {
          shapeType: 'vectorShape',
          attrs: {
            x: 0,
            y: 0,
            width: 200,
            height: 100,
            kind: 'rect',
            fillColor: '#E2E8F0',
            textAlign: 'left',
            textContent: {
              parts: [{ text: 'Grouped text' }],
            },
          },
        },
      ],
    };

    const { blocks, measures, layout } = createDrawingFixtures(drawingBlock);
    const painter = createDomPainter({ blocks, measures });
    painter.paint(layout, mount);

    const textOverlay = mount.querySelector(
      '.superdoc-shape-group .superdoc-vector-shape div[style*="display: flex"]',
    ) as HTMLElement | null;
    expect(textOverlay).toBeTruthy();
    expect(textOverlay?.style.transform).toBe('');
    expect(textOverlay?.style.width).toBe('100%');
    expect(textOverlay?.style.height).toBe('100%');
    expect(textOverlay?.style.lineHeight).toBe('normal');
  });

  it('paints zero-axis VML group lines through a physical one-pixel viewport', () => {
    const geometry: DrawingGeometry = { width: 200, height: 100, rotation: 0, flipH: false, flipV: false };
    const drawingBlock: DrawingFlowBlock = {
      kind: 'drawing',
      id: 'shape-group-zero-axis-lines',
      drawingKind: 'shapeGroup',
      geometry,
      groupTransform: { width: 200, height: 100, childWidth: 200, childHeight: 100 },
      shapes: [
        {
          shapeType: 'vectorShape',
          attrs: {
            x: 10,
            y: 20,
            width: 160,
            height: 0,
            kind: 'line',
            fillColor: null,
            strokeColor: '#000000',
            strokeWidth: 0.56,
          },
        },
        {
          shapeType: 'vectorShape',
          attrs: {
            x: 30,
            y: 10,
            width: 0,
            height: 70,
            kind: 'line',
            fillColor: null,
            strokeColor: '#000000',
            strokeWidth: 0.56,
          },
        },
      ],
    };

    const { blocks, measures, layout } = createDrawingFixtures(drawingBlock);
    const painter = createDomPainter({ blocks, measures });
    painter.paint(layout, mount);

    const children = mount.querySelectorAll<HTMLElement>('.superdoc-shape-group__child');
    const lines = mount.querySelectorAll<SVGLineElement>('.superdoc-shape-group svg line');
    const svgs = mount.querySelectorAll<SVGSVGElement>('.superdoc-shape-group svg');
    expect(children[0]?.style.height).toBe('1px');
    expect(children[1]?.style.width).toBe('1px');
    expect(svgs[0]?.getAttribute('height')).toBe('100%');
    expect(svgs[1]?.getAttribute('width')).toBe('100%');
    expect(lines[0]?.getAttribute('y1')).toBe('0.5');
    expect(lines[0]?.getAttribute('y2')).toBe('0.5');
    expect(lines[1]?.getAttribute('x1')).toBe('0.5');
    expect(lines[1]?.getAttribute('x2')).toBe('0.5');
    expect(lines[0]?.getAttribute('shape-rendering')).toBe('crispEdges');
    expect(lines[1]?.getAttribute('shape-rendering')).toBe('crispEdges');
    expect(lines[0]?.getAttribute('stroke-width')).toBe('1');
    expect(lines[1]?.getAttribute('stroke-width')).toBe('1');
  });

  it('preserves authored paragraph geometry in flattened shape-group text', () => {
    const geometry: DrawingGeometry = { width: 200, height: 100, rotation: 0, flipH: false, flipV: false };
    const drawingBlock: DrawingFlowBlock = {
      kind: 'drawing',
      id: 'shape-group-paragraph-geometry',
      drawingKind: 'shapeGroup',
      geometry,
      groupTransform: { width: 200, height: 100, childWidth: 200, childHeight: 100 },
      shapes: [
        {
          shapeType: 'vectorShape',
          attrs: {
            x: 0,
            y: 0,
            width: 200,
            height: 100,
            kind: 'rect',
            fillColor: null,
            strokeColor: null,
            textAlign: 'left',
            textContent: {
              parts: [
                {
                  text: 'First',
                  formatting: { fontSize: 8, letterSpacing: -0.1 },
                  paragraphProperties: { spacingBefore: 2, leftIndent: 3 },
                },
                { text: '', isLineBreak: true },
                {
                  text: 'Second',
                  paragraphProperties: {
                    horizontalAlign: 'right',
                    spacingBefore: 3.2,
                    line: 1.25,
                    lineUnit: 'multiplier',
                    firstLineIndent: -1,
                  },
                },
              ],
            },
          },
        },
      ],
    };

    const { blocks, measures, layout } = createDrawingFixtures(drawingBlock);
    const painter = createDomPainter({ blocks, measures });
    painter.paint(layout, mount);

    const paragraphs = mount.querySelectorAll(
      '.superdoc-shape-group .superdoc-vector-shape div[style*="font-size"] > div',
    );
    const first = paragraphs[0] as HTMLElement | undefined;
    const second = paragraphs[1] as HTMLElement | undefined;
    expect(first?.style.marginTop).toBe('2px');
    expect(first?.style.paddingLeft).toBe('3px');
    expect(second?.style.textAlign).toBe('right');
    expect(second?.style.marginTop).toBe('3.2px');
    expect(second?.style.lineHeight).toBe('1.25');
    expect(second?.style.textIndent).toBe('-1px');
    const firstRun = first?.querySelector('span') as HTMLElement | null;
    expect(firstRun?.style.letterSpacing).toBe('-0.1px');
  });

  it('allows wrap-none shape text to paint past its authored box', () => {
    const geometry: DrawingGeometry = { width: 80, height: 40, rotation: 0, flipH: false, flipV: false };
    const drawingBlock: DrawingFlowBlock = {
      kind: 'drawing',
      id: 'shape-text-wrap-none',
      drawingKind: 'vectorShape',
      geometry,
      shapeKind: 'rect',
      fillColor: null,
      strokeColor: null,
      textAlign: 'left',
      textLayout: { wrap: 'none', horizontalOverflow: 'overflow', verticalOverflow: 'overflow' },
      textContent: {
        parts: [{ text: 'This text is wider than the shape', formatting: { fontSize: 14 } }],
      },
    };

    const { blocks, measures, layout } = createDrawingFixtures(drawingBlock);
    const painter = createDomPainter({ blocks, measures });
    painter.paint(layout, mount);

    const shape = mount.querySelector('.superdoc-vector-shape') as HTMLElement | null;
    const overlay = shape?.querySelector('div[style*="white-space"]') as HTMLElement | null;
    const paragraph = overlay?.querySelector('div') as HTMLElement | null;
    expect(shape?.style.overflow).toBe('visible');
    expect(overlay?.style.whiteSpace).toBe('nowrap');
    expect(paragraph?.style.whiteSpace).toBe('nowrap');
  });

  it('rotates and fits top-level WordArt textboxes with the shared drawing wrapper', () => {
    const geometry: DrawingGeometry = { width: 240, height: 80, rotation: 320, flipH: false, flipV: false };

    const drawingBlock: DrawingFlowBlock = {
      kind: 'drawing',
      id: 'wordart-rotation',
      drawingKind: 'vectorShape',
      geometry,
      shapeKind: 'rect',
      fillColor: null,
      strokeColor: null,
      textAlign: 'center',
      textContent: {
        parts: [
          {
            text: 'AUTE',
            formatting: {
              fontFamily: 'Arial',
              fontSize: 24,
              color: 'C0C0C0',
            },
          },
        ],
      },
      attrs: { isWordArt: true, isTextBox: true },
    };

    const { blocks, measures, layout } = createDrawingFixtures(drawingBlock);
    const painter = createDomPainter({ blocks, measures });
    painter.paint(layout, mount);

    const drawingInner = mount.querySelector('.superdoc-drawing-inner') as HTMLElement | null;
    const wordArtSvg = mount.querySelector('.superdoc-wordart-text') as SVGSVGElement | null;
    const wordArtText = mount.querySelector('.superdoc-wordart-text text') as SVGTextElement | null;

    expect(drawingInner).toBeTruthy();
    expect(drawingInner?.style.transform).toContain('rotate(320deg)');
    expect(wordArtSvg).toBeTruthy();
    expect(wordArtText).toBeTruthy();
    expect(wordArtText?.textContent).toContain('AUTE');
    expect(wordArtText?.getAttribute('textLength')).toBe('240');
    expect(wordArtText?.getAttribute('lengthAdjust')).toBe('spacingAndGlyphs');
    expect(wordArtText?.getAttribute('font-size')).toBe('24');
    expect(wordArtText?.querySelector('tspan')?.getAttribute('font-size')).toBe('24');
  });

  it('renders authored preset text warps without relying on the legacy isWordArt hint', () => {
    const geometry: DrawingGeometry = { width: 240, height: 80, rotation: 0, flipH: false, flipV: false };
    const drawingBlock: DrawingFlowBlock = {
      kind: 'drawing',
      id: 'wordart-authored-warp',
      drawingKind: 'vectorShape',
      geometry,
      shapeKind: 'rect',
      fillColor: null,
      strokeColor: null,
      textAlign: 'center',
      textWarp: { preset: 'textArchUp', adjustments: [{ name: 'adj', formula: 'val 18000' }] },
      textContent: {
        parts: [
          {
            text: 'ARCHED',
            formatting: {
              fontFamily: 'Arial',
              fontSize: 30,
              color: '4472C4',
              textEffects: {
                fill: { type: 'solidWithAlpha', color: '#4472C4', alpha: 0.8 },
                outline: { width: 1, fill: '#112233' },
                glow: { radius: 3, color: { color: '#E97132', alpha: 0.5 } },
                shadow: { blurRadius: 2, distance: 3, direction: 90, color: { color: '#000000' } },
                reflection: {
                  blurRadius: 0,
                  distance: 1,
                  direction: 90,
                  startAlpha: 0.5,
                  startPosition: 0,
                  endAlpha: 0.003,
                  endPosition: 0.355,
                  scaleX: 1,
                  scaleY: -1,
                },
              },
            },
          },
        ],
      },
    };

    const { blocks, measures, layout } = createDrawingFixtures(drawingBlock);
    const painter = createDomPainter({ blocks, measures });
    painter.paint(layout, mount);

    const wordArtSvg = mount.querySelector('.superdoc-wordart-text') as SVGSVGElement | null;
    const path = wordArtSvg?.querySelector('defs path');
    const sourceText = wordArtSvg?.querySelector('text:not([aria-hidden="true"])');
    const textPath = sourceText?.querySelector('textPath');
    const tspan = textPath?.querySelector('tspan') as SVGTSpanElement | null;
    const reflection = wordArtSvg?.querySelector('g[data-superdoc-wordart-reflection]') as SVGGElement | null;
    const reflectedText = reflection?.querySelector('text[aria-hidden="true"]') as SVGTextElement | null;
    const reflectionMask = wordArtSvg?.querySelector('mask[id^="superdoc-wordart-reflection-mask-"]');
    const reflectionMaskRect = reflectionMask?.querySelector('rect');
    const reflectionStops = wordArtSvg?.querySelectorAll(
      'linearGradient[id^="superdoc-wordart-reflection-gradient-"] stop',
    );

    expect(wordArtSvg?.dataset.superdocWordartWarp).toBe('textArchUp');
    expect(wordArtSvg?.dataset.superdocWordartWarpFidelity).toBe('spec-baseline');
    expect(path?.getAttribute('d')).toMatch(/^M /);
    expect(textPath?.getAttribute('href')).toBe(`#${path?.getAttribute('id')}`);
    expect(textPath?.textContent).toBe('ARCHED');
    expect(textPath?.getAttribute('textLength')).toBeNull();
    expect(textPath?.getAttribute('lengthAdjust')).toBeNull();
    expect(sourceText?.getAttribute('font-size')).toBe('30');
    expect(tspan?.getAttribute('font-size')).toBe('30');
    expect(tspan?.getAttribute('fill')).toBe('#4472C4');
    expect(tspan?.getAttribute('fill-opacity')).toBe('0.8');
    expect(tspan?.getAttribute('stroke')).toBe('#112233');
    expect(tspan?.style.filter).toContain('drop-shadow');
    expect(tspan?.dataset.superdocWordartReflection).toBe('source');
    expect(reflectedText?.getAttribute('transform')).toContain('scale(1 -1)');
    expect(reflection?.getAttribute('mask')).toMatch(/^url\(#superdoc-wordart-reflection-mask-/);
    expect(reflectionMask?.getAttribute('maskUnits')).toBe('userSpaceOnUse');
    expect(reflectionMask?.getAttribute('x')).toBe(reflectionMaskRect?.getAttribute('x'));
    expect(reflectionMask?.getAttribute('y')).toBe(reflectionMaskRect?.getAttribute('y'));
    expect(reflectionMask?.getAttribute('width')).toBe(reflectionMaskRect?.getAttribute('width'));
    expect(reflectionMask?.getAttribute('height')).toBe(reflectionMaskRect?.getAttribute('height'));
    expect(reflectionStops).toHaveLength(2);
    expect(reflectionStops?.[1]?.getAttribute('offset')).toBe('35.5%');
    expect(reflectionStops?.[1]?.getAttribute('stop-opacity')).toBe('0.003');
    expect(reflection?.dataset.superdocWordartReflection).toBe('painted');
    expect(wordArtSvg?.dataset.superdocWordartReflection).toBe('painted');
  });

  it('keeps baseline WordArt on one path when rectangular textbox measurement wraps it', () => {
    const text = 'Word Art that inserts as object';
    const drawingBlock: DrawingFlowBlock = {
      kind: 'drawing',
      id: 'wordart-baseline-measured-wrap',
      drawingKind: 'vectorShape',
      geometry: { width: 240, height: 80, rotation: 0, flipH: false, flipV: false },
      shapeKind: 'rect',
      fillColor: null,
      strokeColor: null,
      textAlign: 'center',
      textWarp: { preset: 'textArchUp' },
      textContent: {
        parts: [{ text, formatting: { fontFamily: 'Arial', fontSize: 24 } }],
      },
    };

    const { blocks, measures, layout } = createDrawingFixtures(drawingBlock);
    Object.assign(layout.pages[0].fragments[0], {
      contentMeasures: [
        {
          kind: 'paragraph',
          lines: [
            {
              fromRun: 0,
              fromChar: 0,
              toRun: 0,
              toChar: 24,
              width: 180,
              ascent: 20,
              descent: 5,
              lineHeight: 30,
            },
            {
              fromRun: 0,
              fromChar: 24,
              toRun: 0,
              toChar: text.length,
              width: 60,
              ascent: 20,
              descent: 5,
              lineHeight: 30,
            },
          ],
          totalHeight: 60,
        },
      ],
    });
    const painter = createDomPainter({ blocks, measures });
    painter.paint(layout, mount);

    const sourceText = mount.querySelectorAll('.superdoc-wordart-text text:not([aria-hidden="true"])');
    const textPaths = mount.querySelectorAll('.superdoc-wordart-text textPath');
    expect(sourceText).toHaveLength(1);
    expect(textPaths).toHaveLength(1);
    expect(textPaths[0]?.textContent).toBe(text);
    expect(Number(textPaths[0]?.getAttribute('textLength'))).toBeGreaterThan(0);
    expect(textPaths[0]?.getAttribute('lengthAdjust')).toBe('spacingAndGlyphs');
  });

  it('maps closed baseline WordArt from the em square instead of browser font leading', () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      font: '',
      measureText: (value: string) => ({
        width: value.length * 12,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: value.length * 12,
        actualBoundingBoxAscent: 20,
        actualBoundingBoxDescent: 5,
        fontBoundingBoxAscent: 30,
        fontBoundingBoxDescent: 10,
      }),
    } as unknown as CanvasRenderingContext2D);
    const drawingBlock: DrawingFlowBlock = {
      kind: 'drawing',
      id: 'wordart-closed-baseline-em-square',
      drawingKind: 'vectorShape',
      geometry: { width: 240, height: 80, rotation: 0, flipH: false, flipV: false },
      shapeKind: 'rect',
      fillColor: null,
      strokeColor: null,
      textAlign: 'center',
      textWarp: { preset: 'textCircle' },
      textContent: {
        parts: [{ text: 'CIRCLE', formatting: { fontFamily: 'Arial', fontSize: 24 } }],
      },
    };

    try {
      const { blocks, measures, layout } = createDrawingFixtures(drawingBlock);
      const painter = createDomPainter({ blocks, measures });
      painter.paint(layout, mount);
    } finally {
      getContext.mockRestore();
    }

    const pathData = mount.querySelector('.superdoc-wordart-text defs path')?.getAttribute('d') ?? '';
    const coordinates = Array.from(pathData.matchAll(/[ML]\s+(-?[\d.]+)\s+(-?[\d.]+)/g));
    const yValues = coordinates.map((match) => Number(match[2]));
    expect(yValues.length).toBeGreaterThan(2);
    expect(Math.max(...yValues) - Math.min(...yValues)).toBeCloseTo(24, 4);
  });

  it('maps boundary-constrained textButton lines to successive adjacent baseline bands', () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      font: '',
      measureText: (value: string) => ({
        width: value.length * 12,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: value.length * 12,
        actualBoundingBoxAscent: 20,
        actualBoundingBoxDescent: 5,
      }),
    } as unknown as CanvasRenderingContext2D);
    const text = 'Word Art that inserts as object';
    const drawingBlock: DrawingFlowBlock = {
      kind: 'drawing',
      id: 'wordart-single-band-envelope-measured-wrap',
      drawingKind: 'textboxShape',
      geometry: { width: 240, height: 80, rotation: 0, flipH: false, flipV: false },
      shapeKind: 'rect',
      fillColor: null,
      strokeColor: null,
      textAlign: 'center',
      textWarp: { preset: 'textButton' },
      textContent: {
        parts: [{ text, formatting: { fontFamily: 'Arial', fontSize: 24 } }],
      },
      contentBlocks: [],
    };

    const { blocks, measures, layout } = createDrawingFixtures(drawingBlock);
    Object.assign(layout.pages[0].fragments[0], {
      contentMeasures: [
        {
          kind: 'paragraph',
          lines: [
            {
              fromRun: 0,
              fromChar: 0,
              toRun: 0,
              toChar: 24,
              width: 180,
              ascent: 20,
              descent: 5,
              lineHeight: 30,
            },
            {
              fromRun: 0,
              fromChar: 24,
              toRun: 0,
              toChar: text.length,
              width: 60,
              ascent: 20,
              descent: 5,
              lineHeight: 30,
            },
          ],
          totalHeight: 60,
        },
      ],
    });
    try {
      createDomPainter({ blocks, measures }).paint(layout, mount);
    } finally {
      getContext.mockRestore();
    }

    const wordArt = mount.querySelector('.superdoc-wordart-text') as SVGSVGElement | null;
    const paths = mount.querySelectorAll('.superdoc-wordart-text defs path');
    const textPaths = mount.querySelectorAll('.superdoc-wordart-text textPath');
    expect(wordArt?.dataset.superdocWordartWarpFidelity).toBe('spec-baseline');
    expect(paths).toHaveLength(2);
    expect(paths[0]?.getAttribute('d')).not.toBe(paths[1]?.getAttribute('d'));
    expect(textPaths).toHaveLength(2);
    expect(textPaths[0]?.textContent).toBe(text.slice(0, 24));
    expect(textPaths[1]?.textContent).toBe(text.slice(24));
  });

  it('places textButtonPour lines on successive bands and preserves natural width on its center shelf', () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      font: '',
      measureText: (value: string) => ({
        width: value.length * 12,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: value.length * 12,
        actualBoundingBoxAscent: 20,
        actualBoundingBoxDescent: 5,
      }),
    } as unknown as CanvasRenderingContext2D);
    const text = 'Word Art that inserts as object';
    const drawingBlock: DrawingFlowBlock = {
      kind: 'drawing',
      id: 'wordart-multi-band-envelope',
      drawingKind: 'textboxShape',
      geometry: { width: 240, height: 80, rotation: 0, flipH: false, flipV: false },
      shapeKind: 'rect',
      fillColor: null,
      strokeColor: null,
      textAlign: 'center',
      textWarp: { preset: 'textButtonPour' },
      textContent: {
        parts: [{ text, formatting: { fontFamily: 'Arial', fontSize: 24 } }],
      },
      contentBlocks: [],
    };

    const { blocks, measures, layout } = createDrawingFixtures(drawingBlock);
    Object.assign(layout.pages[0].fragments[0], {
      contentMeasures: [
        {
          kind: 'paragraph',
          lines: [
            {
              fromRun: 0,
              fromChar: 0,
              toRun: 0,
              toChar: 24,
              width: 180,
              ascent: 20,
              descent: 5,
              lineHeight: 30,
            },
            {
              fromRun: 0,
              fromChar: 24,
              toRun: 0,
              toChar: text.length,
              width: 60,
              ascent: 20,
              descent: 5,
              lineHeight: 30,
            },
          ],
          totalHeight: 60,
        },
      ],
    });
    try {
      createDomPainter({ blocks, measures }).paint(layout, mount);
    } finally {
      getContext.mockRestore();
    }

    const envelope = mount.querySelector('.superdoc-wordart-envelope-mesh') as SVGGElement | null;
    const sourceGroups = mount.querySelectorAll('defs g[id^="superdoc-wordart-mesh-source-"]');
    const sourceTexts = mount.querySelectorAll(
      '.superdoc-wordart-text defs g[id^="superdoc-wordart-mesh-source-"] text',
    );
    const bands = envelope?.querySelectorAll(':scope > .superdoc-wordart-envelope-mesh');
    const shelfTriangle = bands?.[1]?.querySelector('g[transform^="matrix("]');
    const shelfMatrix = shelfTriangle
      ?.getAttribute('transform')
      ?.slice('matrix('.length, -1)
      .trim()
      .split(/[ ,]+/)
      .map(Number);
    expect(envelope?.dataset.superdocWordartEnvelopeBands).toBe('2');
    expect(sourceGroups).toHaveLength(2);
    expect(sourceTexts).toHaveLength(2);
    expect(sourceTexts[0]?.textContent).toBe(text.slice(0, 24));
    expect(sourceTexts[1]?.textContent).toBe(text.slice(24));
    expect(shelfMatrix?.[0]).toBeCloseTo(1, 5);
    expect(shelfMatrix?.[1]).toBeCloseTo(0, 5);
    expect(shelfMatrix?.[2]).toBeCloseTo(0, 5);
  });

  it('maps Deflate/Inflate lines to successive authored boundary pairs', () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      font: '',
      measureText: (value: string) => ({
        width: value.length * 12,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: value.length * 12,
        actualBoundingBoxAscent: 20,
        actualBoundingBoxDescent: 5,
        fontBoundingBoxAscent: 22,
        fontBoundingBoxDescent: 6,
      }),
    } as unknown as CanvasRenderingContext2D);
    const text = 'Word Art that inserts as object';
    const drawingBlock: DrawingFlowBlock = {
      kind: 'drawing',
      id: 'wordart-shared-body-envelope',
      drawingKind: 'textboxShape',
      geometry: { width: 240, height: 80, rotation: 0, flipH: false, flipV: false },
      shapeKind: 'rect',
      fillColor: null,
      strokeColor: null,
      textAlign: 'center',
      textWarp: { preset: 'textDeflateInflate' },
      textContent: { parts: [{ text, formatting: { fontFamily: 'Arial', fontSize: 24 } }] },
      contentBlocks: [],
    };

    const { blocks, measures, layout } = createDrawingFixtures(drawingBlock);
    Object.assign(layout.pages[0].fragments[0], {
      contentMeasures: [
        {
          kind: 'paragraph',
          lines: [
            { fromRun: 0, fromChar: 0, toRun: 0, toChar: 24, width: 180, ascent: 20, descent: 5, lineHeight: 30 },
            {
              fromRun: 0,
              fromChar: 24,
              toRun: 0,
              toChar: text.length,
              width: 60,
              ascent: 20,
              descent: 5,
              lineHeight: 30,
            },
          ],
          totalHeight: 60,
        },
      ],
    });
    try {
      createDomPainter({ blocks, measures }).paint(layout, mount);
    } finally {
      getContext.mockRestore();
    }

    const envelope = mount.querySelector('.superdoc-wordart-envelope-mesh') as SVGGElement | null;
    const sourceGroups = mount.querySelectorAll('defs g[id^="superdoc-wordart-mesh-source-"]');
    expect(envelope?.dataset.superdocWordartEnvelopeBands).toBe('2');
    expect(sourceGroups).toHaveLength(2);
    expect(sourceGroups[0]?.querySelector('text')?.textContent).toBe(text.slice(0, 24));
    expect(sourceGroups[1]?.querySelector('text')?.textContent).toBe(text.slice(24));
  });

  it('treats textStop as an authored envelope warp rather than a flat text control', () => {
    const drawingBlock: DrawingFlowBlock = {
      kind: 'drawing',
      id: 'wordart-text-stop',
      drawingKind: 'vectorShape',
      geometry: { width: 240, height: 80, rotation: 0, flipH: false, flipV: false },
      shapeKind: 'rect',
      fillColor: null,
      strokeColor: null,
      textAlign: 'center',
      textWarp: { preset: 'textStop' },
      textContent: { parts: [{ text: 'STOP', formatting: { fontSize: 24 } }] },
    };

    const { blocks, measures, layout } = createDrawingFixtures(drawingBlock);
    createDomPainter({ blocks, measures }).paint(layout, mount);

    const wordArtSvg = mount.querySelector('.superdoc-wordart-text') as SVGSVGElement | null;
    expect(wordArtSvg?.dataset.superdocWordartWarp).toBe('textStop');
    expect(wordArtSvg?.dataset.superdocWordartWarpFidelity).toBe('spec-envelope-affine');
    expect(wordArtSvg?.querySelector('textPath')).toBeNull();
    const envelope = wordArtSvg?.querySelector('.superdoc-wordart-envelope');
    expect(envelope?.textContent).toBe('STOP');
    expect(envelope?.querySelectorAll('text')).toHaveLength(4);
    expect(envelope?.querySelector('text')?.getAttribute('transform')).toMatch(/^matrix\(/);
  });

  it('normalizes envelope warps to the tight glyph rectangle while retaining authored spaces', () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      font: '',
      measureText: () => ({
        width: 50,
        actualBoundingBoxLeft: 2,
        actualBoundingBoxRight: 45,
        actualBoundingBoxAscent: 12,
        actualBoundingBoxDescent: 3,
        fontBoundingBoxAscent: 20,
        fontBoundingBoxDescent: 5,
      }),
    } as unknown as CanvasRenderingContext2D);
    const drawingBlock: DrawingFlowBlock = {
      kind: 'drawing',
      id: 'wordart-tight-envelope-source',
      drawingKind: 'vectorShape',
      geometry: { width: 240, height: 80, rotation: 0, flipH: false, flipV: false },
      shapeKind: 'rect',
      fillColor: null,
      strokeColor: null,
      textAlign: 'left',
      textWarp: { preset: 'textTriangle' },
      textContent: { parts: [{ text: 'AB ', formatting: { fontSize: 24 } }] },
    };

    try {
      const { blocks, measures, layout } = createDrawingFixtures(drawingBlock);
      createDomPainter({ blocks, measures }).paint(layout, mount);
    } finally {
      getContext.mockRestore();
    }

    const wordArtSvg = mount.querySelector('.superdoc-wordart-text') as SVGSVGElement | null;
    const sourceText = wordArtSvg?.querySelector('defs g[id^="superdoc-wordart-mesh-source-"] text');
    expect(wordArtSvg?.dataset.superdocWordartWarpFidelity).toBe('spec-envelope-mesh');
    // The left overhang begins the tight source rectangle at -2, so the SVG
    // baseline origin moves right by 2. The trailing space still extends the
    // source width to its full 50px advance, as required by ECMA-376.
    expect(sourceText?.getAttribute('x')).toBe('2');
    expect(sourceText?.getAttribute('y')).toBe('12');
  });

  it('retains font line-box advance between lines before tightening an envelope source block', () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      font: '',
      measureText: (text: string) => ({
        width: text.length * 10,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: text.length * 10,
        actualBoundingBoxAscent: 12,
        actualBoundingBoxDescent: 3,
        fontBoundingBoxAscent: 20,
        fontBoundingBoxDescent: 5,
      }),
    } as unknown as CanvasRenderingContext2D);
    const drawingBlock: DrawingFlowBlock = {
      kind: 'drawing',
      id: 'wordart-multiline-envelope-leading',
      drawingKind: 'vectorShape',
      geometry: { width: 240, height: 80, rotation: 0, flipH: false, flipV: false },
      shapeKind: 'rect',
      fillColor: null,
      strokeColor: null,
      textAlign: 'center',
      textWarp: { preset: 'textArchDownPour' },
      textContent: {
        parts: [
          { text: 'FIRST', formatting: { fontSize: 24 } },
          { text: '', isLineBreak: true },
          { text: 'SECOND', formatting: { fontSize: 24 } },
        ],
      },
    };

    try {
      const { blocks, measures, layout } = createDrawingFixtures(drawingBlock);
      createDomPainter({ blocks, measures }).paint(layout, mount);
    } finally {
      getContext.mockRestore();
    }

    const sourceTexts = mount.querySelectorAll(
      '.superdoc-wordart-text defs g[id^="superdoc-wordart-mesh-source-"] text',
    );
    expect(sourceTexts).toHaveLength(2);
    expect(sourceTexts[0]?.getAttribute('y')).toBe('12');
    // The second baseline advances by the 20px ascent + 5px descent font
    // line box. Advancing by the 12px + 3px visible ink would yield 27.
    expect(sourceTexts[1]?.getAttribute('y')).toBe('37');
  });

  it('composes a shared envelope shadow once around the warped silhouette', () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      font: '',
      measureText: (text: string) => ({
        width: text.length * 10,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: text.length * 10,
        actualBoundingBoxAscent: 12,
        actualBoundingBoxDescent: 3,
        fontBoundingBoxAscent: 20,
        fontBoundingBoxDescent: 5,
      }),
    } as unknown as CanvasRenderingContext2D);
    const sharedShadow = {
      blurRadius: 2,
      distance: 3,
      direction: 90,
      color: { color: '#000000' },
    };
    const drawingBlock: DrawingFlowBlock = {
      kind: 'drawing',
      id: 'wordart-envelope-post-warp-shadow',
      drawingKind: 'vectorShape',
      geometry: { width: 240, height: 100, rotation: 0, flipH: false, flipV: false },
      shapeKind: 'rect',
      fillColor: null,
      strokeColor: null,
      textAlign: 'center',
      textWarp: { preset: 'textArchDownPour' },
      textContent: {
        parts: [
          { text: 'WARPED', formatting: { fontSize: 24, textEffects: { shadow: sharedShadow } } },
          { text: '', isLineBreak: true },
          { text: 'TEXT', formatting: { fontSize: 24, textEffects: { shadow: sharedShadow } } },
        ],
      },
    };

    try {
      const { blocks, measures, layout } = createDrawingFixtures(drawingBlock);
      createDomPainter({ blocks, measures }).paint(layout, mount);
    } finally {
      getContext.mockRestore();
    }

    const mesh = mount.querySelector('.superdoc-wordart-envelope-mesh') as SVGGElement | null;
    const sourceParts = mount.querySelectorAll<SVGTextContentElement>(
      'defs g[id^="superdoc-wordart-mesh-source-"] [data-superdoc-wordart-part-index]',
    );
    expect(mesh?.style.filter).toContain('drop-shadow');
    expect(mesh?.dataset.superdocWordartEffectComposition).toBe('post-warp');
    expect(Array.from(sourceParts).every((part) => part.style.filter === '')).toBe(true);
  });

  it('keeps mixed envelope effects scoped to their authored runs', () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      font: '',
      measureText: (text: string) => ({
        width: text.length * 10,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: text.length * 10,
        actualBoundingBoxAscent: 12,
        actualBoundingBoxDescent: 3,
        fontBoundingBoxAscent: 20,
        fontBoundingBoxDescent: 5,
      }),
    } as unknown as CanvasRenderingContext2D);
    const drawingBlock: DrawingFlowBlock = {
      kind: 'drawing',
      id: 'wordart-envelope-mixed-effects',
      drawingKind: 'vectorShape',
      geometry: { width: 240, height: 100, rotation: 0, flipH: false, flipV: false },
      shapeKind: 'rect',
      fillColor: null,
      strokeColor: null,
      textAlign: 'center',
      textWarp: { preset: 'textArchDownPour' },
      textContent: {
        parts: [
          {
            text: 'SHADOW',
            formatting: {
              fontSize: 24,
              textEffects: {
                shadow: {
                  blurRadius: 2,
                  distance: 3,
                  direction: 90,
                  color: { color: '#000000' },
                },
              },
            },
          },
          { text: '', isLineBreak: true },
          { text: 'PLAIN', formatting: { fontSize: 24 } },
        ],
      },
    };

    try {
      const { blocks, measures, layout } = createDrawingFixtures(drawingBlock);
      createDomPainter({ blocks, measures }).paint(layout, mount);
    } finally {
      getContext.mockRestore();
    }

    const mesh = mount.querySelector('.superdoc-wordart-envelope-mesh') as SVGGElement | null;
    const sourceParts = mount.querySelectorAll<SVGTextContentElement>(
      'defs g[id^="superdoc-wordart-mesh-source-"] [data-superdoc-wordart-part-index]',
    );
    expect(mesh?.style.filter).toBe('');
    expect(mesh?.dataset.superdocWordartEffectComposition).toBeUndefined();
    expect(sourceParts[0]?.style.filter).toContain('drop-shadow');
    expect(sourceParts[1]?.style.filter).toBe('');
  });
});
