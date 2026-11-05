import { describe, it, expect, beforeEach } from 'vite-plus/test';
import { renderTableCell, getCellSegmentCount } from './renderTableCell.js';
import { getCellLines } from '@superdoc/layout-engine';
import type {
  ParagraphBlock,
  ParagraphMeasure,
  TableCell,
  TableCellMeasure,
  TableBlock,
  TableMeasure,
  SdtMetadata,
  ImageBlock,
  DrawingBlock,
  DrawingMeasure,
} from '@superdoc/contracts';

describe('renderTableCell', () => {
  let doc: Document;

  beforeEach(() => {
    doc = document.implementation.createHTMLDocument('table-cell');
  });

  const expectCssColor = (actual: string, expectedHex: string): void => {
    const normalizedActual = actual.replace(/\s+/g, '').toLowerCase();
    let normalizedHex = expectedHex.toLowerCase();
    if (!normalizedHex.startsWith('#')) {
      normalizedHex = `#${normalizedHex}`;
    }
    if (normalizedHex.length === 4) {
      normalizedHex = `#${normalizedHex[1]}${normalizedHex[1]}${normalizedHex[2]}${normalizedHex[2]}${normalizedHex[3]}${normalizedHex[3]}`;
    }
    const r = Number.parseInt(normalizedHex.slice(1, 3), 16);
    const g = Number.parseInt(normalizedHex.slice(3, 5), 16);
    const b = Number.parseInt(normalizedHex.slice(5, 7), 16);
    const rgb = `rgb(${r},${g},${b})`;
    expect([normalizedHex, rgb]).toContain(normalizedActual);
  };

  const getParagraphBorderLayer = (paraWrapper: HTMLElement): HTMLElement => {
    const layer = paraWrapper.querySelector<HTMLElement>('.superdoc-paragraph-border');
    expect(layer).toBeTruthy();
    return layer!;
  };

  const getParagraphShadingLayer = (paraWrapper: HTMLElement): HTMLElement => {
    const layer = paraWrapper.querySelector<HTMLElement>('.superdoc-paragraph-shading');
    expect(layer).toBeTruthy();
    return layer!;
  };

  const paragraphBlock: ParagraphBlock = {
    kind: 'paragraph',
    id: 'para-1',
    runs: [{ text: '1', fontFamily: 'Arial', fontSize: 16 }],
  };

  const paragraphMeasure: ParagraphMeasure = {
    kind: 'paragraph',
    lines: [
      {
        fromRun: 0,
        fromChar: 0,
        toRun: 0,
        toChar: 1,
        width: 10,
        ascent: 12,
        descent: 4,
        lineHeight: 20,
      },
    ],
    totalHeight: 20,
  };

  const baseCellMeasure: TableCellMeasure = {
    blocks: [paragraphMeasure],
    width: 80,
    height: 20,
    gridColumnStart: 0,
    colSpan: 1,
    rowSpan: 1,
  };

  const baseCell: TableCell = {
    id: 'cell-1-1',
    blocks: [paragraphBlock],
    attrs: {},
  };

  const createBaseDeps = () => ({
    doc,
    x: 0,
    y: 0,
    rowHeight: 40,
    borders: undefined,
    useDefaultBorder: false,
    context: { sectionIndex: 0, pageIndex: 0, columnIndex: 0 },
    renderLine: (_block, _line, _ctx, _lineIndex, _isLastLine) => doc.createElement('div'),
    applySdtDataset: () => {
      // noop for tests
    },
  });

  it.each(['top', 'center', 'bottom'] as const)(
    'SD-6124 unclips vector ink while retaining an ordinary flow viewport aligned %s',
    (verticalAlign) => {
      const drawing: DrawingBlock = {
        kind: 'drawing',
        id: 'overlay',
        drawingKind: 'vectorShape',
        shapeKind: 'line',
        geometry: { width: 5, height: 166, rotation: 0 },
        anchor: { isAnchored: true, layoutInCell: true, offsetV: -75, offsetH: 12, vRelativeFrom: 'paragraph' },
        wrap: { type: 'None' },
        attrs: { anchorParagraphId: paragraphBlock.id },
      };
      const result = renderTableCell({
        ...createBaseDeps(),
        rowHeight: 50,
        isRtl: true,
        cell: {
          ...baseCell,
          blocks: [paragraphBlock, drawing],
          attrs: {
            verticalAlign,
            padding: { top: 3, bottom: 7, left: 5, right: 9 },
          },
        },
        cellMeasure: {
          ...baseCellMeasure,
          height: 30,
          blocks: [paragraphMeasure, { kind: 'drawing', width: 5, height: 166 }],
        },
        renderLine: () => {
          const line = doc.createElement('div');
          line.textContent = 'Clipped flow';
          return line;
        },
        renderDrawingContent: () => {
          const shape = doc.createElement('div');
          shape.className = 'shape';
          shape.style.overflow = 'hidden';
          return shape;
        },
      });
      expect(result.cellElement.style.overflow).toBe('visible');
      expect(result.cellElement.style.paddingLeft).toBe('9px');
      const drawingElement = result.cellElement.querySelector<HTMLElement>('[data-block-id="overlay"]')!;
      expect(drawingElement.style.left).toBe('12px');
      expect(drawingElement.style.top).toBe(
        `${-75 + (verticalAlign === 'center' ? 10 : verticalAlign === 'bottom' ? 20 : 0)}px`,
      );
      expect(drawingElement.querySelector<HTMLElement>('.superdoc-table-drawing')!.style.overflow).toBe('visible');
      expect(drawingElement.querySelector<HTMLElement>('.shape')!.style.overflow).toBe('visible');
      const flowViewport = result.cellElement.querySelector<HTMLElement>('.superdoc-table-cell-flow-viewport')!;
      expect(flowViewport.style.overflow).toBe('hidden');
      expect(flowViewport.textContent).toBe('Clipped flow');
      expect(flowViewport.contains(drawingElement)).toBe(false);
    },
  );

  it.each([false, true])('SD-6124 keeps a positive filled rectangle clipped with decorative line=%s', (hasLine) => {
    const rectangle: DrawingBlock = {
      kind: 'drawing',
      id: 'rectangle',
      drawingKind: 'vectorShape',
      shapeKind: 'rect',
      fillColor: '#0060FF',
      geometry: { width: 192, height: 48 },
      anchor: { isAnchored: true, layoutInCell: true, vRelativeFrom: 'paragraph', offsetV: 27 },
      wrap: { type: 'None' },
      attrs: { anchorParagraphId: paragraphBlock.id },
    };
    const line: DrawingBlock = {
      ...rectangle,
      id: 'line',
      shapeKind: 'line',
      anchor: { ...rectangle.anchor, offsetV: -75 },
    };
    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      cell: { ...baseCell, blocks: [paragraphBlock, rectangle, ...(hasLine ? [line] : [])] },
      cellMeasure: {
        ...baseCellMeasure,
        blocks: [
          paragraphMeasure,
          { kind: 'drawing', width: 192, height: 48 },
          ...(hasLine ? [{ kind: 'drawing' as const, width: 192, height: 48 }] : []),
        ],
      },
      renderDrawingContent: () => doc.createElement('div'),
    });
    const element = cellElement.querySelector<HTMLElement>('[data-block-id="rectangle"]')!;
    expect(element.querySelector<HTMLElement>('.superdoc-table-drawing')!.style.overflow).toBe('hidden');
    expect(element.parentElement!.closest<HTMLElement>('[style*="overflow: hidden"]')).not.toBeNull();
    expect(cellElement.querySelector('.superdoc-table-cell-flow-viewport') !== null).toBe(hasLine);
  });

  for (const direction of ['btLr', 'tbRl'] as const) {
    it.each([false, true])(
      `SD-6124 retains physical clipping for ${direction} with asymmetric padding and vector=%s`,
      (hasVector) => {
        const vector: DrawingBlock = {
          kind: 'drawing',
          id: 'vertical-vector',
          drawingKind: 'vectorShape',
          shapeKind: 'line',
          geometry: { width: 40, height: 40 },
          anchor: { isAnchored: true, layoutInCell: true, vRelativeFrom: 'paragraph', offsetV: -75 },
          wrap: { type: 'None' },
          attrs: { anchorParagraphId: paragraphBlock.id },
        };
        const { cellElement } = renderTableCell({
          ...createBaseDeps(),
          rowHeight: 80,
          cell: {
            ...baseCell,
            blocks: hasVector ? [paragraphBlock, vector] : [paragraphBlock],
            attrs: { padding: { left: 13, right: 3, top: 7, bottom: 19 } },
          },
          cellMeasure: {
            ...baseCellMeasure,
            width: 120,
            height: 200,
            verticalText: { direction, inlineSize: 54, blockSize: 104 },
            blocks: hasVector ? [paragraphMeasure, { kind: 'drawing', width: 40, height: 40 }] : [paragraphMeasure],
          },
          renderDrawingContent: () => doc.createElement('div'),
        });
        expect(cellElement.style.overflow).toBe('hidden');
        expect(cellElement.querySelector('.superdoc-table-cell-flow-viewport')).toBeNull();
        const content = cellElement.firstElementChild as HTMLElement;
        expect(content.style.width).toBe('54px');
        expect(content.style.height).toBe('104px');
        expect(content.style.transform).toBe(
          direction === 'btLr' ? 'translate(0, 54px) rotate(-90deg)' : 'translate(104px, 0) rotate(90deg)',
        );
        const drawing = cellElement.querySelector<HTMLElement>('.superdoc-table-drawing');
        if (hasVector) expect(drawing!.style.overflow).toBe('hidden');
        else expect(drawing).toBeNull();
      },
    );
  }

  for (const otherKind of ['raster', 'text-bearing drawing'] as const) {
    for (const vectorFirst of [true, false]) {
      it.each([
        { vectorZ: 1, otherZ: 1, vectorBehind: false, otherBehind: false },
        { vectorZ: 3, otherZ: 1, vectorBehind: false, otherBehind: false },
        { vectorZ: 1, otherZ: 3, vectorBehind: false, otherBehind: false },
        { vectorZ: 1, otherZ: 1, vectorBehind: true, otherBehind: true },
        { vectorZ: 3, otherZ: 1, vectorBehind: true, otherBehind: false },
        { vectorZ: 1, otherZ: 3, vectorBehind: false, otherBehind: true },
      ])(`SD-6124 preserves anchor source order with ${otherKind}, vectorFirst=${vectorFirst}, %j`, (layers) => {
        const vector: DrawingBlock = {
          kind: 'drawing',
          id: 'vector',
          drawingKind: 'vectorShape',
          shapeKind: 'line',
          geometry: { width: 40, height: 40 },
          anchor: { isAnchored: true, offsetV: 20, offsetH: 20, behindDoc: layers.vectorBehind },
          wrap: { type: 'None' },
          zIndex: layers.vectorZ,
        };
        const other: ImageBlock | DrawingBlock =
          otherKind === 'raster'
            ? {
                kind: 'image',
                id: 'other',
                src: 'data:image/png;base64,iVBORw0KGgo=',
                width: 40,
                height: 40,
                anchor: { ...vector.anchor, behindDoc: layers.otherBehind },
                wrap: { type: 'None' },
                zIndex: layers.otherZ,
              }
            : {
                ...vector,
                id: 'other',
                anchor: { ...vector.anchor, behindDoc: layers.otherBehind },
                zIndex: layers.otherZ,
                textContent: { parts: [{ text: 'Shape text' }] },
              };
        const objects = vectorFirst ? [vector, other] : [other, vector];
        const { cellElement } = renderTableCell({
          ...createBaseDeps(),
          cell: { ...baseCell, blocks: [paragraphBlock, ...objects] },
          cellMeasure: {
            ...baseCellMeasure,
            blocks: [paragraphMeasure, ...objects.map((block) => ({ kind: block.kind, width: 40, height: 40 }))],
          },
        });
        const wrappers = objects.map((block) =>
          cellElement.querySelector<HTMLElement>(`[data-block-id="${block.id}"], [data-sd-block-id="${block.id}"]`)!,
        );
        expect(wrappers[0].compareDocumentPosition(wrappers[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        const vectorWrapper = wrappers[vectorFirst ? 0 : 1];
        const otherWrapper = wrappers[vectorFirst ? 1 : 0];
        expect(vectorWrapper.style.zIndex).toBe(String(layers.vectorBehind ? 0 : layers.vectorZ));
        expect(otherWrapper.style.zIndex).toBe(String(layers.otherBehind ? 0 : layers.otherZ));
        expect(vectorWrapper.closest('.superdoc-table-cell-flow-viewport')).toBeNull();
        expect(otherWrapper.closest<HTMLElement>('[style*="overflow: hidden"]')).not.toBeNull();
      });
    }
  }

  it('SD-6124 retains the SDT chrome overflow exception alongside a vector overlay', () => {
    const paragraph: ParagraphBlock = {
      ...paragraphBlock,
      attrs: { sdt: { type: 'documentSection', id: 'section', title: 'Section' } },
    };
    const drawing: DrawingBlock = {
      kind: 'drawing',
      id: 'overlay',
      drawingKind: 'vectorShape',
      shapeKind: 'line',
      geometry: { width: 5, height: 166, rotation: 0 },
      anchor: { isAnchored: true, vRelativeFrom: 'paragraph', offsetV: -75 },
      wrap: { type: 'None' },
      attrs: { anchorParagraphId: paragraph.id },
    };
    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      cell: { ...baseCell, blocks: [paragraph, drawing] },
      cellMeasure: { ...baseCellMeasure, blocks: [paragraphMeasure, { kind: 'drawing', width: 5, height: 166 }] },
    });
    expect(cellElement.style.overflow).toBe('visible');
    expect(cellElement.querySelector<HTMLElement>('.superdoc-table-cell-flow-viewport')!.style.overflow).toBe(
      'visible',
    );
  });

  it('SD-6124 does not paint an overlay on a slice without its anchor paragraph', () => {
    const drawing: DrawingBlock = {
      kind: 'drawing',
      id: 'overlay',
      drawingKind: 'vectorShape',
      shapeKind: 'line',
      geometry: { width: 5, height: 166, rotation: 0 },
      anchor: { isAnchored: true, offsetV: -75, vRelativeFrom: 'paragraph' },
      wrap: { type: 'None' },
      attrs: { anchorParagraphId: paragraphBlock.id },
    };
    const result = renderTableCell({
      ...createBaseDeps(),
      fromLine: 1,
      toLine: 2,
      cell: { ...baseCell, blocks: [paragraphBlock, drawing] },
      cellMeasure: { ...baseCellMeasure, blocks: [paragraphMeasure, { kind: 'drawing', width: 5, height: 166 }] },
    });
    expect(result.cellElement.querySelector('[data-block-id="overlay"]')).toBeNull();
    expect(result.cellElement.style.overflow).toBe('hidden');
  });

  it('uses an end-of-cell mark for the final paragraph in a table cell', () => {
    const secondParagraphBlock: ParagraphBlock = {
      kind: 'paragraph',
      id: 'para-2',
      runs: [{ text: '2', fontFamily: 'Arial', fontSize: 16 }],
    };
    const secondParagraphMeasure: ParagraphMeasure = {
      ...paragraphMeasure,
      totalHeight: 20,
    };

    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      cellMeasure: {
        ...baseCellMeasure,
        blocks: [paragraphMeasure, secondParagraphMeasure],
      },
      cell: {
        ...baseCell,
        blocks: [paragraphBlock, secondParagraphBlock],
      },
      renderLine: () => {
        const line = doc.createElement('div');
        const mark = doc.createElement('span');
        mark.classList.add('superdoc-formatting-paragraph-mark');
        mark.textContent = '¶';
        line.appendChild(mark);
        return line;
      },
    });

    const marks = cellElement.querySelectorAll<HTMLElement>('.superdoc-formatting-paragraph-mark');
    expect(marks).toHaveLength(2);
    expect(marks[0].textContent).toBe('¶');
    expect(marks[0].classList.contains('superdoc-formatting-cell-mark')).toBe(false);
    expect(marks[1].textContent).toBe('¤');
    expect(marks[1].classList.contains('superdoc-formatting-cell-mark')).toBe(true);
  });

  it('preserves named furniture context for paragraph runs inside a cell', () => {
    const seenContexts: Array<{ section: string; storyKind: string | undefined; storyId: string | undefined }> = [];
    renderTableCell({
      ...createBaseDeps(),
      cellMeasure: baseCellMeasure,
      cell: baseCell,
      context: {
        pageNumber: 2,
        totalPages: 4,
        section: 'footer',
        story: { kind: 'footer', id: 'rIdFooter' },
      },
      renderLine: (_block, _line, context) => {
        seenContexts.push({
          section: context.section,
          storyKind: context.story?.kind,
          storyId: context.story?.id,
        });
        return doc.createElement('div');
      },
    });

    expect(seenContexts).toEqual([{ section: 'footer', storyKind: 'footer', storyId: 'rIdFooter' }]);
  });

  it('centers content when verticalAlign is center', () => {
    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      cellMeasure: baseCellMeasure,
      cell: { ...baseCell, attrs: { verticalAlign: 'center' } },
    });

    // Content is now a child of cellElement
    const contentElement = cellElement.firstElementChild as HTMLElement;
    expect(contentElement).toBeTruthy();
    expect(contentElement?.style.justifyContent).toBe('center');
  });

  it('bottom-aligns content when verticalAlign is bottom', () => {
    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      cellMeasure: baseCellMeasure,
      cell: { ...baseCell, attrs: { verticalAlign: 'bottom' } },
    });

    // Content is now a child of cellElement
    const contentElement = cellElement.firstElementChild as HTMLElement;
    expect(contentElement).toBeTruthy();
    expect(contentElement?.style.justifyContent).toBe('flex-end');
  });

  it('applies padding directly to cell element', () => {
    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      cellMeasure: baseCellMeasure,
      cell: baseCell,
    });

    // Default padding is top: 0, left: 4, right: 4, bottom: 0
    expect(cellElement.style.paddingTop).toBe('0px');
    expect(cellElement.style.paddingLeft).toBe('4px');
    expect(cellElement.style.paddingRight).toBe('4px');
    expect(cellElement.style.paddingBottom).toBe('0px');
  });

  it('content fills cell with 100% width and height', () => {
    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      cellMeasure: baseCellMeasure,
      cell: baseCell,
    });

    // Content is now a child of cellElement
    const contentElement = cellElement.firstElementChild as HTMLElement;
    expect(contentElement?.style.width).toBe('100%');
    expect(contentElement?.style.height).toBe('100%');
  });

  it('cell uses overflow hidden to clip content', () => {
    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      cellMeasure: baseCellMeasure,
      cell: baseCell,
    });

    expect(cellElement.style.overflow).toBe('hidden');
  });

  it('renders image blocks inside table cells', () => {
    const imageBlock: ImageBlock = {
      kind: 'image',
      id: 'img-1',
      src: 'data:image/png;base64,AAA',
      imageId: '337',
    };
    const imageMeasure = {
      kind: 'image' as const,
      width: 50,
      height: 40,
    };

    const cellMeasure: TableCellMeasure = {
      blocks: [imageMeasure],
      width: 80,
      height: 40,
      gridColumnStart: 0,
      colSpan: 1,
      rowSpan: 1,
    };

    const cell: TableCell = {
      id: 'cell-with-image',
      blocks: [imageBlock],
      attrs: {},
    };

    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      cellMeasure,
      cell,
    });

    const imgEl = cellElement.querySelector('img.superdoc-table-image') as HTMLImageElement | null;
    expect(imgEl).toBeTruthy();
    expect(imgEl?.parentElement?.style.height).toBe('40px');
    expect(imgEl?.parentElement?.classList.contains('superdoc-image-fragment')).toBe(true);
    expect(imgEl?.parentElement?.getAttribute('data-sd-block-id')).toBe('img-1');
    expect(imgEl?.parentElement?.getAttribute('data-sd-image-id')).toBe('337');
  });

  it('forces flowing image blocks to block display inside table cells', () => {
    const imageBlock: ImageBlock = {
      kind: 'image',
      id: 'img-inline-display',
      src: 'data:image/png;base64,AAA',
      display: 'inline',
    };

    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      cellMeasure: {
        blocks: [{ kind: 'image' as const, width: 50, height: 40 }],
        width: 80,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      },
      cell: { id: 'cell-inline-display-image', blocks: [imageBlock], attrs: {} },
    });

    const imgEl = cellElement.querySelector('img.superdoc-table-image') as HTMLImageElement | null;
    expect(imgEl?.style.display).toBe('block');
  });

  it('applies top-level clipPath to flowing image blocks inside table cells', () => {
    const imageBlock = {
      kind: 'image',
      id: 'img-clipped-flow',
      src: 'data:image/png;base64,AAA',
      clipPath: 'inset(10% 20% 30% 40%)',
    } as ImageBlock;

    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      cellMeasure: {
        blocks: [{ kind: 'image' as const, width: 50, height: 40 }],
        width: 80,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      },
      cell: { id: 'cell-clipped-flow', blocks: [imageBlock], attrs: {} },
    });

    const imgEl = cellElement.querySelector('img.superdoc-table-image') as HTMLImageElement | null;
    expect(imgEl?.style.clipPath).toBe('inset(10% 20% 30% 40%)');
    expect(imgEl?.parentElement?.style.overflow).toBe('hidden');
  });

  it('applies filter styles to flowing image blocks inside table cells', () => {
    const imageBlock: ImageBlock = {
      kind: 'image',
      id: 'img-filtered-flow',
      src: 'data:image/png;base64,AAA',
      grayscale: true,
      gain: 2,
    };

    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      cellMeasure: {
        blocks: [{ kind: 'image' as const, width: 50, height: 40 }],
        width: 80,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      },
      cell: { id: 'cell-filtered-flow', blocks: [imageBlock], attrs: {} },
    });

    const imgEl = cellElement.querySelector('img.superdoc-table-image') as HTMLImageElement | null;
    expect(imgEl?.style.filter).toContain('grayscale(100%)');
    expect(imgEl?.style.filter).toContain('contrast(2)');
  });

  it('wraps flowing image blocks with hyperlinks inside table cells', () => {
    const imageBlock: ImageBlock = {
      kind: 'image',
      id: 'img-linked-flow',
      src: 'data:image/png;base64,AAA',
      hyperlink: { url: 'https://example.com/image', tooltip: 'Open image' },
    };

    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      cellMeasure: {
        blocks: [{ kind: 'image' as const, width: 50, height: 40 }],
        width: 80,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      },
      cell: { id: 'cell-linked-flow', blocks: [imageBlock], attrs: {} },
    });

    const anchor = cellElement.querySelector('a.superdoc-link') as HTMLAnchorElement | null;
    expect(anchor).toBeTruthy();
    expect(anchor?.href).toBe('https://example.com/image');
    expect(anchor?.querySelector('img.superdoc-table-image')).toBeTruthy();
  });

  it('absolutely positions anchored image blocks inside table cells', () => {
    const precedingPara: ParagraphBlock = {
      kind: 'paragraph',
      id: 'para-before-anchor',
      runs: [{ text: 'Before', fontFamily: 'Arial', fontSize: 16 }],
    };

    const para: ParagraphBlock = {
      kind: 'paragraph',
      id: 'para-anchor',
      runs: [{ text: 'Anchor', fontFamily: 'Arial', fontSize: 16 }],
    };

    const anchoredImage: ImageBlock = {
      kind: 'image',
      id: 'img-anchored',
      src: 'data:image/png;base64,AAA',
      imageId: '334',
      anchor: { isAnchored: true, alignH: 'left', offsetH: 10, vRelativeFrom: 'paragraph', offsetV: 5 },
      wrap: { type: 'None' },
      attrs: { anchorParagraphId: 'para-anchor' },
    };

    const cellMeasure: TableCellMeasure = {
      blocks: [
        paragraphMeasure,
        paragraphMeasure,
        {
          kind: 'image' as const,
          width: 20,
          height: 10,
        },
      ],
      width: 80,
      height: 50,
      gridColumnStart: 0,
      colSpan: 1,
      rowSpan: 1,
    };

    const cell: TableCell = {
      id: 'cell-with-anchored-image',
      blocks: [precedingPara, para, anchoredImage],
      attrs: {},
    };

    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      cellMeasure,
      cell,
    });

    const imgEl = cellElement.querySelector('img.superdoc-table-image') as HTMLImageElement | null;
    expect(imgEl).toBeTruthy();
    expect(imgEl?.parentElement?.style.position).toBe('absolute');
    expect(imgEl?.parentElement?.style.left).toBe('10px');
    expect(imgEl?.parentElement?.style.top).toBe('25px');
    expect(imgEl?.parentElement?.classList.contains('superdoc-image-fragment')).toBe(true);
    expect(imgEl?.parentElement?.getAttribute('data-sd-block-id')).toBe('img-anchored');
    expect(imgEl?.parentElement?.getAttribute('data-sd-image-id')).toBe('334');
  });

  it('positions anchored image blocks after multiple preceding paragraphs', () => {
    const firstPara: ParagraphBlock = {
      kind: 'paragraph',
      id: 'para-before-anchor-1',
      runs: [{ text: 'One', fontFamily: 'Arial', fontSize: 16 }],
    };
    const secondPara: ParagraphBlock = {
      kind: 'paragraph',
      id: 'para-before-anchor-2',
      runs: [{ text: 'Two', fontFamily: 'Arial', fontSize: 16 }],
    };
    const anchorPara: ParagraphBlock = {
      kind: 'paragraph',
      id: 'para-anchor-multi',
      runs: [{ text: 'Anchor', fontFamily: 'Arial', fontSize: 16 }],
    };
    const firstMeasure: ParagraphMeasure = {
      kind: 'paragraph',
      lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 3, width: 10, ascent: 6, descent: 2, lineHeight: 8 }],
      totalHeight: 8,
    };
    const secondMeasure: ParagraphMeasure = {
      kind: 'paragraph',
      lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 3, width: 10, ascent: 9, descent: 3, lineHeight: 12 }],
      totalHeight: 12,
    };
    const anchoredImage: ImageBlock = {
      kind: 'image',
      id: 'img-anchored-multi',
      src: 'data:image/png;base64,AAA',
      anchor: { isAnchored: true, alignH: 'left', offsetH: 0, offsetV: 6 },
      wrap: { type: 'None' },
      attrs: { anchorParagraphId: 'para-anchor-multi' },
    };

    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      cellMeasure: {
        blocks: [firstMeasure, secondMeasure, paragraphMeasure, { kind: 'image' as const, width: 20, height: 10 }],
        width: 100,
        height: 60,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      },
      cell: { id: 'cell-anchored-multi', blocks: [firstPara, secondPara, anchorPara, anchoredImage], attrs: {} },
    });

    const imgEl = cellElement.querySelector('img.superdoc-table-image') as HTMLImageElement | null;
    expect(imgEl?.parentElement?.style.top).toBe('26px');
  });

  it('keeps anchored image top unchanged when the anchor paragraph is the first cell block', () => {
    const para: ParagraphBlock = {
      kind: 'paragraph',
      id: 'para-anchor-first',
      runs: [{ text: 'Anchor', fontFamily: 'Arial', fontSize: 16 }],
    };
    const anchoredImage: ImageBlock = {
      kind: 'image',
      id: 'img-anchored-first',
      src: 'data:image/png;base64,AAA',
      anchor: { isAnchored: true, alignH: 'left', offsetH: 0, vRelativeFrom: 'paragraph', offsetV: 5 },
      wrap: { type: 'None' },
      attrs: { anchorParagraphId: 'para-anchor-first' },
    };

    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      cellMeasure: {
        blocks: [paragraphMeasure, { kind: 'image' as const, width: 20, height: 10 }],
        width: 80,
        height: 30,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      },
      cell: { id: 'cell-anchored-first', blocks: [para, anchoredImage], attrs: {} },
    });

    const imgEl = cellElement.querySelector('img.superdoc-table-image') as HTMLImageElement | null;
    expect(imgEl?.parentElement?.style.top).toBe('5px');
  });

  it('falls back to offsetV when anchorParagraphId is missing or unresolvable', () => {
    const para: ParagraphBlock = {
      kind: 'paragraph',
      id: 'para-before-unresolved-anchor',
      runs: [{ text: 'Before', fontFamily: 'Arial', fontSize: 16 }],
    };
    const missingAnchorImage: ImageBlock = {
      kind: 'image',
      id: 'img-missing-anchor-id',
      src: 'data:image/png;base64,AAA',
      anchor: { isAnchored: true, alignH: 'left', offsetH: 0, vRelativeFrom: 'paragraph', offsetV: 7 },
      wrap: { type: 'None' },
    };
    const unresolvedAnchorImage: ImageBlock = {
      kind: 'image',
      id: 'img-unresolved-anchor-id',
      src: 'data:image/png;base64,AAA',
      anchor: { isAnchored: true, alignH: 'left', offsetH: 0, vRelativeFrom: 'paragraph', offsetV: 9 },
      wrap: { type: 'None' },
      attrs: { anchorParagraphId: 'para-does-not-exist' },
    };

    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      cellMeasure: {
        blocks: [
          paragraphMeasure,
          { kind: 'image' as const, width: 20, height: 10 },
          { kind: 'image' as const, width: 20, height: 10 },
        ],
        width: 80,
        height: 50,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      },
      cell: { id: 'cell-unresolved-anchor-id', blocks: [para, missingAnchorImage, unresolvedAnchorImage], attrs: {} },
    });

    const imageEls = Array.from(cellElement.querySelectorAll('img.superdoc-table-image')) as HTMLImageElement[];
    expect(imageEls).toHaveLength(2);
    expect(imageEls[0]?.parentElement?.style.top).toBe('7px');
    expect(imageEls[1]?.parentElement?.style.top).toBe('9px');
  });

  it('uses corrected anchored top for wrap exclusions in table cells', () => {
    const beforePara: ParagraphBlock = {
      kind: 'paragraph',
      id: 'para-before-wrap-anchor',
      runs: [{ text: 'Before', fontFamily: 'Arial', fontSize: 16 }],
    };
    const anchorPara: ParagraphBlock = {
      kind: 'paragraph',
      id: 'para-wrap-anchor',
      runs: [{ text: 'Anchor', fontFamily: 'Arial', fontSize: 16 }],
    };
    const anchoredImage: ImageBlock = {
      kind: 'image',
      id: 'img-wrap-corrected-top',
      src: 'data:image/png;base64,AAA',
      anchor: { isAnchored: true, alignH: 'left', offsetH: 0, vRelativeFrom: 'paragraph', offsetV: 0 },
      wrap: { type: 'Square', wrapText: 'bothSides' },
      attrs: { anchorParagraphId: 'para-wrap-anchor' },
    };

    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      cellMeasure: {
        blocks: [paragraphMeasure, paragraphMeasure, { kind: 'image' as const, width: 20, height: 10 }],
        width: 80,
        height: 50,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      },
      cell: { id: 'cell-wrap-corrected-top', blocks: [beforePara, anchorPara, anchoredImage], attrs: {} },
      renderLine: (block) => {
        const el = doc.createElement('div');
        el.dataset.blockId = block.id;
        return el;
      },
    });

    const imgEl = cellElement.querySelector('img.superdoc-table-image') as HTMLImageElement | null;
    const beforeLine = cellElement.querySelector('[data-block-id="para-before-wrap-anchor"]') as HTMLElement | null;
    const anchorLine = cellElement.querySelector('[data-block-id="para-wrap-anchor"]') as HTMLElement | null;
    expect(imgEl?.parentElement?.style.top).toBe('20px');
    expect(beforeLine?.style.marginLeft).toBe('');
    expect(anchorLine?.style.marginLeft).toBe('20px');
  });

  it('does not repeat anchored images on continuation slices where the anchor paragraph started earlier', () => {
    const splitPara: ParagraphBlock = {
      kind: 'paragraph',
      id: 'para-split-across-slices',
      runs: [{ text: 'Long anchor paragraph', fontFamily: 'Arial', fontSize: 16 }],
    };
    const splitParaMeasure: ParagraphMeasure = {
      kind: 'paragraph',
      lines: [
        { fromRun: 0, fromChar: 0, toRun: 0, toChar: 10, width: 10, ascent: 15, descent: 5, lineHeight: 20 },
        { fromRun: 0, fromChar: 10, toRun: 0, toChar: 21, width: 10, ascent: 15, descent: 5, lineHeight: 20 },
      ],
      totalHeight: 40,
    };
    const anchoredImage: ImageBlock = {
      kind: 'image',
      id: 'img-continuation-slice',
      src: 'data:image/png;base64,AAA',
      anchor: { isAnchored: true, alignH: 'left', offsetH: 0, vRelativeFrom: 'paragraph', offsetV: 5 },
      wrap: { type: 'None' },
      attrs: { anchorParagraphId: 'para-split-across-slices' },
    };

    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      cellMeasure: {
        blocks: [splitParaMeasure, { kind: 'image' as const, width: 20, height: 10 }],
        width: 80,
        height: 50,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      },
      cell: { id: 'cell-continuation-slice', blocks: [splitPara, anchoredImage], attrs: {} },
      fromLine: 1,
      toLine: 2,
    });

    expect(cellElement.querySelector('img.superdoc-table-image')).toBeNull();
  });

  it('anchors to the paragraph flow position before its own spacing-before, after preceding spacing-after', () => {
    const beforePara: ParagraphBlock = {
      kind: 'paragraph',
      id: 'para-with-space-after',
      runs: [{ text: 'Before', fontFamily: 'Arial', fontSize: 16 }],
      attrs: { spacing: { after: 7 } },
    };
    const anchorPara: ParagraphBlock = {
      kind: 'paragraph',
      id: 'para-with-space-before',
      runs: [{ text: 'Anchor', fontFamily: 'Arial', fontSize: 16 }],
      attrs: { spacing: { before: 12 } },
    };
    const anchoredImage: ImageBlock = {
      kind: 'image',
      id: 'img-spacing-semantics',
      src: 'data:image/png;base64,AAA',
      anchor: { isAnchored: true, alignH: 'left', offsetH: 0, vRelativeFrom: 'paragraph', offsetV: 5 },
      wrap: { type: 'None' },
      attrs: { anchorParagraphId: 'para-with-space-before' },
    };

    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      cellMeasure: {
        blocks: [paragraphMeasure, paragraphMeasure, { kind: 'image' as const, width: 20, height: 10 }],
        width: 80,
        height: 70,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      },
      cell: { id: 'cell-spacing-semantics', blocks: [beforePara, anchorPara, anchoredImage], attrs: {} },
    });

    const imgEl = cellElement.querySelector('img.superdoc-table-image') as HTMLImageElement | null;
    // 20 (preceding lines) + 7 (its spacing.after) + 5 (offsetV); the anchor paragraph's own
    // spacing.before must NOT shift the object (Word fixture: SpaceBefore moves text, not object).
    expect(imgEl?.parentElement?.style.top).toBe('32px');
  });

  it('shifts anchored objects by the vertical cell alignment offset', () => {
    const beforePara: ParagraphBlock = {
      kind: 'paragraph',
      id: 'para-before-valign',
      runs: [{ text: 'Before', fontFamily: 'Arial', fontSize: 16 }],
    };
    const anchorPara: ParagraphBlock = {
      kind: 'paragraph',
      id: 'para-valign-anchor',
      runs: [{ text: 'Anchor', fontFamily: 'Arial', fontSize: 16 }],
    };
    const anchoredImage: ImageBlock = {
      kind: 'image',
      id: 'img-valign-anchor',
      src: 'data:image/png;base64,AAA',
      anchor: { isAnchored: true, alignH: 'left', offsetH: 0, vRelativeFrom: 'paragraph', offsetV: 5 },
      wrap: { type: 'None' },
      attrs: { anchorParagraphId: 'para-valign-anchor' },
    };

    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      rowHeight: 60,
      cellMeasure: {
        blocks: [paragraphMeasure, paragraphMeasure, { kind: 'image' as const, width: 20, height: 10 }],
        width: 80,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      },
      cell: {
        id: 'cell-valign-anchor',
        blocks: [beforePara, anchorPara, anchoredImage],
        attrs: { verticalAlign: 'center' },
      },
    });

    const imgEl = cellElement.querySelector('img.superdoc-table-image') as HTMLImageElement | null;
    // paragraphY 20 + offsetV 5 + alignmentOffsetY (60 - 40)/2 = 10
    expect(imgEl?.parentElement?.style.top).toBe('35px');
  });

  it('uses the measured layoutInCell footprint when vertically aligning an anchored object', () => {
    const anchorPara: ParagraphBlock = {
      kind: 'paragraph',
      id: 'para-layout-in-cell-valign',
      runs: [{ text: 'Anchor', fontFamily: 'Arial', fontSize: 16 }],
    };
    const anchoredImage: ImageBlock = {
      kind: 'image',
      id: 'img-layout-in-cell-valign',
      src: 'data:image/png;base64,AAA',
      anchor: {
        isAnchored: true,
        layoutInCell: true,
        alignH: 'left',
        offsetH: 0,
        vRelativeFrom: 'paragraph',
        offsetV: 1,
      },
      wrap: { type: 'None' },
      attrs: { anchorParagraphId: 'para-layout-in-cell-valign' },
    };

    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      rowHeight: 60,
      cellMeasure: {
        blocks: [paragraphMeasure, { kind: 'image' as const, width: 20, height: 60 }],
        // The measuring layer reserves offsetV + object height for layoutInCell.
        width: 80,
        height: 61,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      },
      cell: {
        id: 'cell-layout-in-cell-valign',
        blocks: [anchorPara, anchoredImage],
        attrs: { verticalAlign: 'center' },
      },
    });

    const imgEl = cellElement.querySelector('img.superdoc-table-image') as HTMLImageElement | null;
    // The exact-height row has no spare vertical space once the measured floating
    // footprint is considered, so the authored paragraph-relative offset is preserved.
    expect(imgEl?.parentElement?.style.top).toBe('1px');
  });

  it('does not shift fallback anchors (page/margin base or missing anchor id) in vertically aligned cells', () => {
    const beforePara: ParagraphBlock = {
      kind: 'paragraph',
      id: 'para-before-fallback-valign',
      runs: [{ text: 'Before', fontFamily: 'Arial', fontSize: 16 }],
    };
    const anchorPara: ParagraphBlock = {
      kind: 'paragraph',
      id: 'para-fallback-valign',
      runs: [{ text: 'Anchor', fontFamily: 'Arial', fontSize: 16 }],
    };
    const marginImage: ImageBlock = {
      kind: 'image',
      id: 'img-fallback-valign-margin',
      src: 'data:image/png;base64,AAA',
      anchor: { isAnchored: true, alignH: 'left', offsetH: 0, vRelativeFrom: 'margin', offsetV: 4 },
      wrap: { type: 'None' },
      attrs: { anchorParagraphId: 'para-fallback-valign' },
    };
    const pageImage: ImageBlock = {
      kind: 'image',
      id: 'img-fallback-valign-page',
      src: 'data:image/png;base64,AAA',
      anchor: { isAnchored: true, alignH: 'left', offsetH: 0, vRelativeFrom: 'page', offsetV: 6 },
      wrap: { type: 'None' },
      attrs: { anchorParagraphId: 'para-fallback-valign' },
    };
    const missingIdImage: ImageBlock = {
      kind: 'image',
      id: 'img-fallback-valign-missing-id',
      src: 'data:image/png;base64,AAA',
      anchor: { isAnchored: true, alignH: 'left', offsetH: 0, vRelativeFrom: 'paragraph', offsetV: 8 },
      wrap: { type: 'None' },
    };

    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      rowHeight: 60,
      cellMeasure: {
        blocks: [
          paragraphMeasure,
          paragraphMeasure,
          { kind: 'image' as const, width: 20, height: 10 },
          { kind: 'image' as const, width: 20, height: 10 },
          { kind: 'image' as const, width: 20, height: 10 },
        ],
        width: 80,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      },
      cell: {
        id: 'cell-fallback-valign',
        blocks: [beforePara, anchorPara, marginImage, pageImage, missingIdImage],
        attrs: { verticalAlign: 'center' },
      },
    });

    const imageEls = Array.from(cellElement.querySelectorAll('img.superdoc-table-image')) as HTMLImageElement[];
    expect(imageEls).toHaveLength(3);
    // Fallback invariant: top stays offsetV, NOT shifted by the (60 - 40)/2 alignment offset.
    expect(imageEls[0]?.parentElement?.style.top).toBe('4px');
    expect(imageEls[1]?.parentElement?.style.top).toBe('6px');
    expect(imageEls[2]?.parentElement?.style.top).toBe('8px');
  });

  it('honors alignV center/bottom for paragraph-relative anchors like the body path', () => {
    const beforePara: ParagraphBlock = {
      kind: 'paragraph',
      id: 'para-before-alignv',
      runs: [{ text: 'Before', fontFamily: 'Arial', fontSize: 16 }],
    };
    const anchorPara: ParagraphBlock = {
      kind: 'paragraph',
      id: 'para-alignv-anchor',
      runs: [{ text: 'Anchor', fontFamily: 'Arial', fontSize: 16 }],
    };
    const bottomImage: ImageBlock = {
      kind: 'image',
      id: 'img-alignv-bottom',
      src: 'data:image/png;base64,AAA',
      anchor: {
        isAnchored: true,
        alignH: 'left',
        offsetH: 0,
        vRelativeFrom: 'paragraph',
        alignV: 'bottom',
        offsetV: 0,
      },
      wrap: { type: 'None' },
      attrs: { anchorParagraphId: 'para-alignv-anchor' },
    };
    const centerImage: ImageBlock = {
      kind: 'image',
      id: 'img-alignv-center',
      src: 'data:image/png;base64,AAA',
      anchor: {
        isAnchored: true,
        alignH: 'left',
        offsetH: 0,
        vRelativeFrom: 'paragraph',
        alignV: 'center',
        offsetV: 0,
      },
      wrap: { type: 'None' },
      attrs: { anchorParagraphId: 'para-alignv-anchor' },
    };

    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      cellMeasure: {
        blocks: [
          paragraphMeasure,
          paragraphMeasure,
          { kind: 'image' as const, width: 20, height: 10 },
          { kind: 'image' as const, width: 20, height: 10 },
        ],
        width: 80,
        height: 60,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      },
      cell: { id: 'cell-alignv-anchor', blocks: [beforePara, anchorPara, bottomImage, centerImage], attrs: {} },
    });

    const imageEls = Array.from(cellElement.querySelectorAll('img.superdoc-table-image')) as HTMLImageElement[];
    expect(imageEls).toHaveLength(2);
    // bottom: paragraphY 20 + firstLine 20 - objectHeight 10 = 30
    expect(imageEls[0]?.parentElement?.style.top).toBe('30px');
    // center: paragraphY 20 + (firstLine 20 - objectHeight 10) / 2 = 25
    expect(imageEls[1]?.parentElement?.style.top).toBe('25px');
  });

  it('skips anchored images whose anchor paragraph is outside the rendered split window', () => {
    const firstPara: ParagraphBlock = {
      kind: 'paragraph',
      id: 'para-in-window',
      runs: [{ text: 'Visible', fontFamily: 'Arial', fontSize: 16 }],
    };
    const anchorPara: ParagraphBlock = {
      kind: 'paragraph',
      id: 'para-outside-window',
      runs: [{ text: 'Anchor', fontFamily: 'Arial', fontSize: 16 }],
    };
    const anchoredImage: ImageBlock = {
      kind: 'image',
      id: 'img-outside-window',
      src: 'data:image/png;base64,AAA',
      anchor: { isAnchored: true, alignH: 'left', offsetH: 0, vRelativeFrom: 'paragraph', offsetV: 5 },
      wrap: { type: 'None' },
      attrs: { anchorParagraphId: 'para-outside-window' },
    };

    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      cellMeasure: {
        blocks: [paragraphMeasure, paragraphMeasure, { kind: 'image' as const, width: 20, height: 10 }],
        width: 80,
        height: 50,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      },
      cell: { id: 'cell-split-window', blocks: [firstPara, anchorPara, anchoredImage], attrs: {} },
      fromLine: 0,
      toLine: 1,
    });

    expect(cellElement.querySelector('img.superdoc-table-image')).toBeNull();
  });

  it('keeps top = offsetV for page- and margin-relative anchors regardless of the anchor paragraph', () => {
    const beforePara: ParagraphBlock = {
      kind: 'paragraph',
      id: 'para-before-nonparagraph-anchor',
      runs: [{ text: 'Before', fontFamily: 'Arial', fontSize: 16 }],
    };
    const anchorPara: ParagraphBlock = {
      kind: 'paragraph',
      id: 'para-nonparagraph-anchor',
      runs: [{ text: 'Anchor', fontFamily: 'Arial', fontSize: 16 }],
    };
    const marginImage: ImageBlock = {
      kind: 'image',
      id: 'img-margin-anchor',
      src: 'data:image/png;base64,AAA',
      anchor: { isAnchored: true, alignH: 'left', offsetH: 0, vRelativeFrom: 'margin', offsetV: 4 },
      wrap: { type: 'None' },
      attrs: { anchorParagraphId: 'para-nonparagraph-anchor' },
    };
    const pageImage: ImageBlock = {
      kind: 'image',
      id: 'img-page-anchor',
      src: 'data:image/png;base64,AAA',
      anchor: { isAnchored: true, alignH: 'left', offsetH: 0, vRelativeFrom: 'page', offsetV: 6 },
      wrap: { type: 'None' },
      attrs: { anchorParagraphId: 'para-nonparagraph-anchor' },
    };

    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      cellMeasure: {
        blocks: [
          paragraphMeasure,
          paragraphMeasure,
          { kind: 'image' as const, width: 20, height: 10 },
          { kind: 'image' as const, width: 20, height: 10 },
        ],
        width: 80,
        height: 60,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      },
      cell: { id: 'cell-nonparagraph-anchor', blocks: [beforePara, anchorPara, marginImage, pageImage], attrs: {} },
    });

    const imageEls = Array.from(cellElement.querySelectorAll('img.superdoc-table-image')) as HTMLImageElement[];
    expect(imageEls).toHaveLength(2);
    expect(imageEls[0]?.parentElement?.style.top).toBe('4px');
    expect(imageEls[1]?.parentElement?.style.top).toBe('6px');
  });

  it('applies top-level clipPath to anchored image blocks inside table cells', () => {
    const para: ParagraphBlock = {
      kind: 'paragraph',
      id: 'para-anchor-clip',
      runs: [{ text: 'Anchor', fontFamily: 'Arial', fontSize: 16 }],
    };
    const anchoredImage = {
      kind: 'image',
      id: 'img-clipped-anchor',
      src: 'data:image/png;base64,AAA',
      clipPath: 'inset(5% 10% 15% 20%)',
      anchor: { isAnchored: true, alignH: 'left', offsetH: 10, vRelativeFrom: 'paragraph', offsetV: 5 },
      wrap: { type: 'None' },
      attrs: { anchorParagraphId: 'para-anchor-clip' },
    } as ImageBlock;

    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      cellMeasure: {
        blocks: [paragraphMeasure, { kind: 'image' as const, width: 20, height: 10 }],
        width: 80,
        height: 30,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      },
      cell: { id: 'cell-clipped-anchor', blocks: [para, anchoredImage], attrs: {} },
    });

    const imgEl = cellElement.querySelector('img.superdoc-table-image') as HTMLImageElement | null;
    expect(imgEl?.style.clipPath).toBe('inset(5% 10% 15% 20%)');
    expect(imgEl?.parentElement?.style.overflow).toBe('hidden');
  });

  it('applies filter styles to anchored image blocks inside table cells', () => {
    const para: ParagraphBlock = {
      kind: 'paragraph',
      id: 'para-anchor-filter',
      runs: [{ text: 'Anchor', fontFamily: 'Arial', fontSize: 16 }],
    };
    const anchoredImage: ImageBlock = {
      kind: 'image',
      id: 'img-filtered-anchor',
      src: 'data:image/png;base64,AAA',
      grayscale: true,
      lum: { bright: 25000, contrast: -50000 },
      anchor: { isAnchored: true, alignH: 'left', offsetH: 10, vRelativeFrom: 'paragraph', offsetV: 5 },
      wrap: { type: 'None' },
      attrs: { anchorParagraphId: 'para-anchor-filter' },
    };

    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      cellMeasure: {
        blocks: [paragraphMeasure, { kind: 'image' as const, width: 20, height: 10 }],
        width: 80,
        height: 30,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      },
      cell: { id: 'cell-filtered-anchor', blocks: [para, anchoredImage], attrs: {} },
    });

    const imgEl = cellElement.querySelector('img.superdoc-table-image') as HTMLImageElement | null;
    expect(imgEl?.style.filter).toContain('grayscale(100%)');
    expect(imgEl?.style.filter).toContain('contrast(0.5)');
    expect(imgEl?.style.filter).toContain('brightness(1.25)');
  });

  it('wraps anchored image blocks with hyperlinks inside table cells', () => {
    const para: ParagraphBlock = {
      kind: 'paragraph',
      id: 'para-anchor-link',
      runs: [{ text: 'Anchor', fontFamily: 'Arial', fontSize: 16 }],
    };
    const anchoredImage: ImageBlock = {
      kind: 'image',
      id: 'img-linked-anchor',
      src: 'data:image/png;base64,AAA',
      hyperlink: { url: 'https://example.com/anchored-image' },
      anchor: { isAnchored: true, alignH: 'left', offsetH: 10, vRelativeFrom: 'paragraph', offsetV: 5 },
      wrap: { type: 'None' },
      attrs: { anchorParagraphId: 'para-anchor-link' },
    };

    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      cellMeasure: {
        blocks: [paragraphMeasure, { kind: 'image' as const, width: 20, height: 10 }],
        width: 80,
        height: 30,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      },
      cell: { id: 'cell-linked-anchor', blocks: [para, anchoredImage], attrs: {} },
    });

    const anchor = cellElement.querySelector('a.superdoc-link') as HTMLAnchorElement | null;
    expect(anchor).toBeTruthy();
    expect(anchor?.href).toBe('https://example.com/anchored-image');
    expect(anchor?.parentElement?.style.position).toBe('absolute');
    expect(anchor?.querySelector('img.superdoc-table-image')).toBeTruthy();
  });

  it('keeps partial-row segment indexing aligned when anchored blocks are between paragraphs', () => {
    const paraBefore: ParagraphBlock = {
      kind: 'paragraph',
      id: 'para-before-anchor',
      runs: [{ text: 'Before', fontFamily: 'Arial', fontSize: 16 }],
    };

    const paraAfter: ParagraphBlock = {
      kind: 'paragraph',
      id: 'para-after-anchor',
      runs: [{ text: 'After', fontFamily: 'Arial', fontSize: 16 }],
    };

    const anchoredImage: ImageBlock = {
      kind: 'image',
      id: 'img-between',
      src: 'data:image/png;base64,AAA',
      anchor: { isAnchored: true, alignH: 'left', offsetH: 0, vRelativeFrom: 'paragraph', offsetV: 0 },
      wrap: { type: 'None' },
      attrs: { anchorParagraphId: 'para-before-anchor' },
    };

    const cellMeasure: TableCellMeasure = {
      blocks: [
        paragraphMeasure,
        {
          kind: 'image' as const,
          width: 20,
          height: 10,
        },
        paragraphMeasure,
      ],
      width: 120,
      height: 60,
      gridColumnStart: 0,
      colSpan: 1,
      rowSpan: 1,
    };

    const cell: TableCell = {
      id: 'cell-partial-anchored-alignment',
      blocks: [paraBefore, anchoredImage, paraAfter],
      attrs: {},
    };

    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      cellMeasure,
      cell,
      fromLine: 2,
      toLine: 3,
      renderLine: (block) => {
        const line = doc.createElement('div');
        line.classList.add('segment-alignment-line');
        line.dataset.blockId = (block as ParagraphBlock).id;
        return line;
      },
    });

    const renderedLines = Array.from(cellElement.querySelectorAll('.segment-alignment-line')) as HTMLElement[];
    expect(renderedLines).toHaveLength(1);
    expect(renderedLines[0]?.dataset.blockId).toBe('para-after-anchor');
  });

  it('positions column-relative anchored images from the cell content box, ignoring table indent and cell offset', () => {
    const para: ParagraphBlock = {
      kind: 'paragraph',
      id: 'para-anchor',
      runs: [{ text: 'Anchor', fontFamily: 'Arial', fontSize: 16 }],
    };

    const anchoredImage: ImageBlock = {
      kind: 'image',
      id: 'img-anchored',
      src: 'data:image/png;base64,AAA',
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'column',
        alignH: 'left',
        offsetH: 100,
        vRelativeFrom: 'paragraph',
        offsetV: 0,
      },
      wrap: { type: 'None' },
      attrs: { anchorParagraphId: 'para-anchor' },
    };

    const cellMeasure: TableCellMeasure = {
      blocks: [
        paragraphMeasure,
        {
          kind: 'image' as const,
          width: 20,
          height: 10,
        },
      ],
      width: 120,
      height: 30,
      gridColumnStart: 0,
      colSpan: 1,
      rowSpan: 1,
    };

    const cell: TableCell = {
      id: 'cell-with-anchored-image',
      blocks: [para, anchoredImage],
      attrs: {},
    };

    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      x: 40,
      tableIndent: 20,
      cellMeasure,
      cell,
    });

    const imgEl = cellElement.querySelector('img.superdoc-table-image') as HTMLImageElement | null;
    expect(imgEl).toBeTruthy();
    // Word probes (SD-3626): offsetH is measured from the CELL CONTENT BOX; the previous
    // page-column conversion (subtracting cell x and table indent) shifted objects left.
    expect(imgEl?.parentElement?.style.left).toBe('100px');
  });

  it('clamps wrapping anchored objects to the cell content box, but not wrapNone', () => {
    const para: ParagraphBlock = {
      kind: 'paragraph',
      id: 'para-clamp-anchor',
      runs: [{ text: 'Anchor', fontFamily: 'Arial', fontSize: 16 }],
    };
    const squareOverflow: ImageBlock = {
      kind: 'image',
      id: 'img-clamp-square',
      src: 'data:image/png;base64,AAA',
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'column',
        alignH: 'left',
        offsetH: 70,
        vRelativeFrom: 'paragraph',
        offsetV: 0,
      },
      wrap: { type: 'Square', wrapText: 'bothSides' },
      attrs: { anchorParagraphId: 'para-clamp-anchor' },
    };
    const noneOverflow: ImageBlock = {
      kind: 'image',
      id: 'img-clamp-none',
      src: 'data:image/png;base64,AAA',
      anchor: {
        isAnchored: true,
        hRelativeFrom: 'column',
        alignH: 'left',
        offsetH: 70,
        vRelativeFrom: 'paragraph',
        offsetV: 5,
      },
      wrap: { type: 'None' },
      attrs: { anchorParagraphId: 'para-clamp-anchor' },
    };

    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      cellMeasure: {
        blocks: [
          paragraphMeasure,
          { kind: 'image' as const, width: 20, height: 10 },
          { kind: 'image' as const, width: 20, height: 10 },
        ],
        width: 80,
        height: 50,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      },
      cell: { id: 'cell-clamp', blocks: [para, squareOverflow, noneOverflow], attrs: {} },
    });

    const imageEls = Array.from(cellElement.querySelectorAll('img.superdoc-table-image')) as HTMLImageElement[];
    expect(imageEls).toHaveLength(2);
    // content width = 80 - default horizontal padding (4 + 4) = 72; object 20 wide at offset 70
    // overflows by 18. Word clamps wrapping objects (right edge = cell content edge): 72 - 20 = 52.
    expect(imageEls[0]?.parentElement?.style.left).toBe('52px');
    // wrapNone objects overflow freely (Word probe: no clamp).
    expect(imageEls[1]?.parentElement?.style.left).toBe('70px');
  });

  it('treats an omitted hRelativeFrom as column and clamps wrapping objects', () => {
    const para: ParagraphBlock = {
      kind: 'paragraph',
      id: 'para-default-rel',
      runs: [{ text: 'Anchor', fontFamily: 'Arial', fontSize: 16 }],
    };
    const image: ImageBlock = {
      kind: 'image',
      id: 'img-default-rel',
      src: 'data:image/png;base64,AAA',
      anchor: { isAnchored: true, alignH: 'left', offsetH: 70, vRelativeFrom: 'paragraph', offsetV: 0 },
      wrap: { type: 'Square', wrapText: 'bothSides' },
      attrs: { anchorParagraphId: 'para-default-rel' },
    };

    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      cellMeasure: {
        blocks: [paragraphMeasure, { kind: 'image' as const, width: 20, height: 10 }],
        width: 80,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      },
      cell: { id: 'cell-default-rel', blocks: [para, image], attrs: {} },
    });

    const imgEl = cellElement.querySelector('img.superdoc-table-image') as HTMLImageElement | null;
    // Same clamp as an explicit hRelativeFrom="column": 72 - 20 = 52.
    expect(imgEl?.parentElement?.style.left).toBe('52px');
  });

  it('absolutely positions anchored drawing blocks inside table cells', () => {
    const para: ParagraphBlock = {
      kind: 'paragraph',
      id: 'para-anchor',
      runs: [{ text: 'Anchor', fontFamily: 'Arial', fontSize: 16 }],
    };

    const anchoredDrawing: DrawingBlock = {
      kind: 'drawing',
      id: 'shape-anchored',
      drawingKind: 'vectorShape',
      geometry: { width: 10, height: 10 },
      anchor: { isAnchored: true, alignH: 'left', offsetH: 12, vRelativeFrom: 'paragraph', offsetV: 7 },
      wrap: { type: 'None' },
      attrs: { anchorParagraphId: 'para-anchor' },
    };

    const drawingMeasure: DrawingMeasure = {
      kind: 'drawing',
      drawingKind: 'vectorShape',
      width: 30,
      height: 15,
      scale: 1,
      naturalWidth: 30,
      naturalHeight: 15,
      geometry: { width: 10, height: 10 },
    };

    const cellMeasure: TableCellMeasure = {
      blocks: [paragraphMeasure, drawingMeasure],
      width: 80,
      height: 40,
      gridColumnStart: 0,
      colSpan: 1,
      rowSpan: 1,
    };

    const cell: TableCell = {
      id: 'cell-with-anchored-drawing',
      blocks: [para, anchoredDrawing],
      attrs: {},
    };

    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      cellMeasure,
      cell,
      renderDrawingContent: () => doc.createElement('div'),
    });

    const drawingWrapper = cellElement.querySelector('div.superdoc-table-drawing')?.parentElement as HTMLElement | null;
    expect(drawingWrapper).toBeTruthy();
    expect(drawingWrapper?.style.position).toBe('absolute');
    expect(drawingWrapper?.style.left).toBe('12px');
    expect(drawingWrapper?.style.top).toBe('7px');
    expect(drawingWrapper?.style.zIndex).toBe('1');
  });

  it('keeps behindDoc anchored drawings at the background z-index inside table cells', () => {
    const para: ParagraphBlock = {
      kind: 'paragraph',
      id: 'para-behind',
      runs: [{ text: 'Anchor', fontFamily: 'Arial', fontSize: 16 }],
    };
    const anchoredDrawing: DrawingBlock = {
      kind: 'drawing',
      id: 'shape-behind',
      drawingKind: 'vectorShape',
      geometry: { width: 10, height: 10 },
      // Some imported table drawings carry the effective posture only on the
      // wrap record. That legacy form must remain behind the cell paint too.
      anchor: { isAnchored: true, alignH: 'left', offsetH: 0, vRelativeFrom: 'paragraph', offsetV: 0 },
      wrap: { type: 'None', behindDoc: true },
      attrs: { anchorParagraphId: 'para-behind' },
    };
    const drawingMeasure: DrawingMeasure = {
      kind: 'drawing',
      drawingKind: 'vectorShape',
      width: 30,
      height: 15,
      scale: 1,
      naturalWidth: 30,
      naturalHeight: 15,
      geometry: { width: 10, height: 10 },
    };

    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      cellMeasure: {
        blocks: [paragraphMeasure, drawingMeasure],
        width: 80,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      },
      cell: { id: 'cell-behind', blocks: [para, anchoredDrawing], attrs: {} },
      renderDrawingContent: () => doc.createElement('div'),
    });

    const drawingWrapper = cellElement.querySelector('div.superdoc-table-drawing')?.parentElement as HTMLElement | null;
    expect(drawingWrapper?.style.zIndex).toBe('0');
  });

  it('pushes text away from wrapSquare anchored images in table cells', () => {
    const para: ParagraphBlock = {
      kind: 'paragraph',
      id: 'para-wrap',
      runs: [{ text: 'Wrapped text', fontFamily: 'Arial', fontSize: 16 }],
    };

    const anchoredImage: ImageBlock = {
      kind: 'image',
      id: 'img-wrap',
      src: 'data:image/png;base64,AAA',
      anchor: { isAnchored: true, alignH: 'left', offsetH: 0, vRelativeFrom: 'paragraph', offsetV: 0 },
      wrap: { type: 'Square', wrapText: 'bothSides' },
      attrs: { anchorParagraphId: 'para-wrap' },
    };

    const cellMeasure: TableCellMeasure = {
      blocks: [
        paragraphMeasure,
        {
          kind: 'image' as const,
          width: 20,
          height: 10,
        },
      ],
      width: 80,
      height: 30,
      gridColumnStart: 0,
      colSpan: 1,
      rowSpan: 1,
    };

    const cell: TableCell = {
      id: 'cell-with-wrap',
      blocks: [para, anchoredImage],
      attrs: {},
    };

    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      cellMeasure,
      cell,
      renderLine: (_block, _line, _ctx, lineIndex) => {
        const el = doc.createElement('div');
        el.id = `line-${lineIndex}`;
        return el;
      },
    });

    const lineEl = cellElement.querySelector('#line-0') as HTMLElement | null;
    expect(lineEl).toBeTruthy();

    // contentWidthPx = 80 - 4 - 4 = 72. Excluded segment is [0, 20], so largest available interval is [20, 72].
    expect(lineEl?.style.marginLeft).toBe('20px');
    expect(lineEl?.style.marginRight).toBe('0px');
  });

  it('pushes text away from wrapSquare anchored drawings in table cells', () => {
    const para: ParagraphBlock = {
      kind: 'paragraph',
      id: 'para-wrap-drawing',
      runs: [{ text: 'Wrapped text', fontFamily: 'Arial', fontSize: 16 }],
    };

    const anchoredDrawing: DrawingBlock = {
      kind: 'drawing',
      id: 'shape-wrap',
      drawingKind: 'vectorShape',
      geometry: { width: 10, height: 10 },
      anchor: { isAnchored: true, alignH: 'left', offsetH: 0, vRelativeFrom: 'paragraph', offsetV: 0 },
      wrap: { type: 'Square', wrapText: 'bothSides' },
      attrs: { anchorParagraphId: 'para-wrap-drawing' },
    };

    const drawingMeasure: DrawingMeasure = {
      kind: 'drawing',
      drawingKind: 'vectorShape',
      width: 20,
      height: 10,
      scale: 1,
      naturalWidth: 20,
      naturalHeight: 10,
      geometry: { width: 10, height: 10 },
    };

    const cellMeasure: TableCellMeasure = {
      blocks: [paragraphMeasure, drawingMeasure],
      width: 80,
      height: 30,
      gridColumnStart: 0,
      colSpan: 1,
      rowSpan: 1,
    };

    const cell: TableCell = {
      id: 'cell-with-wrap-drawing',
      blocks: [para, anchoredDrawing],
      attrs: {},
    };

    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      cellMeasure,
      cell,
      renderLine: (_block, _line, _ctx, lineIndex) => {
        const el = doc.createElement('div');
        el.id = `line-${lineIndex}`;
        return el;
      },
    });

    const lineEl = cellElement.querySelector('#line-0') as HTMLElement | null;
    expect(lineEl).toBeTruthy();
    expect(lineEl?.style.marginLeft).toBe('20px');
    expect(lineEl?.style.marginRight).toBe('0px');
  });

  it('does not apply wrapSquare margins when line already has padding', () => {
    const para: ParagraphBlock = {
      kind: 'paragraph',
      id: 'para-wrap-padding',
      runs: [{ text: 'Wrapped text', fontFamily: 'Arial', fontSize: 16 }],
      attrs: { indent: { left: 10 } },
    };

    const anchoredImage: ImageBlock = {
      kind: 'image',
      id: 'img-wrap-padding',
      src: 'data:image/png;base64,AAA',
      anchor: { isAnchored: true, alignH: 'left', offsetH: 0, vRelativeFrom: 'paragraph', offsetV: 0 },
      wrap: { type: 'Square', wrapText: 'bothSides' },
      attrs: { anchorParagraphId: 'para-wrap-padding' },
    };

    const cellMeasure: TableCellMeasure = {
      blocks: [
        paragraphMeasure,
        {
          kind: 'image' as const,
          width: 20,
          height: 10,
        },
      ],
      width: 80,
      height: 30,
      gridColumnStart: 0,
      colSpan: 1,
      rowSpan: 1,
    };

    const cell: TableCell = {
      id: 'cell-with-wrap-padding',
      blocks: [para, anchoredImage],
      attrs: {},
    };

    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      cellMeasure,
      cell,
      renderLine: (_block, _line, _ctx, lineIndex) => {
        const el = doc.createElement('div');
        el.id = `line-${lineIndex}`;
        return el;
      },
    });

    const lineEl = cellElement.querySelector('#line-0') as HTMLElement | null;
    expect(lineEl).toBeTruthy();
    expect(lineEl?.style.paddingLeft).toBe('10px');
    expect(lineEl?.style.marginLeft).toBe('');
    expect(lineEl?.style.width).toBe('');
  });

  it('passes list marker wrapper margins to captureLineSnapshot callbacks', () => {
    const para: ParagraphBlock = {
      kind: 'paragraph',
      id: 'para-wrap-marker',
      runs: [{ text: 'Wrapped list item', fontFamily: 'Arial', fontSize: 16 }],
      attrs: {
        wordLayout: {
          marker: {
            markerText: '1.',
            markerBoxWidthPx: 20,
            gutterWidthPx: 8,
            justification: 'left' as const,
            run: {
              fontFamily: 'Arial',
              fontSize: 14,
              bold: false,
              italic: false,
              color: '#000000',
            },
          },
          indentLeftPx: 30,
        },
      },
    };

    const paraMeasure: ParagraphMeasure = {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 16,
          width: 100,
          ascent: 12,
          descent: 4,
          lineHeight: 20,
        },
      ],
      totalHeight: 20,
      marker: {
        markerWidth: 20,
        gutterWidth: 8,
        indentLeft: 30,
      },
    };

    const anchoredImage: ImageBlock = {
      kind: 'image',
      id: 'img-wrap-marker',
      src: 'data:image/png;base64,AAA',
      anchor: { isAnchored: true, alignH: 'left', offsetH: 0, vRelativeFrom: 'paragraph', offsetV: 0 },
      wrap: { type: 'Square', wrapText: 'bothSides' },
      attrs: { anchorParagraphId: 'para-wrap-marker' },
    };

    const cellMeasure: TableCellMeasure = {
      blocks: [
        paraMeasure,
        {
          kind: 'image' as const,
          width: 20,
          height: 10,
        },
      ],
      width: 80,
      height: 30,
      gridColumnStart: 0,
      colSpan: 1,
      rowSpan: 1,
    };

    const cell: TableCell = {
      id: 'cell-with-wrap-marker',
      blocks: [para, anchoredImage],
      attrs: {},
    };

    const captured: Array<{ lineEl: HTMLElement; wrapperEl?: HTMLElement }> = [];

    renderTableCell({
      ...createBaseDeps(),
      cellMeasure,
      cell,
      renderLine: () => {
        const el = doc.createElement('div');
        el.classList.add('superdoc-line');
        return el;
      },
      captureLineSnapshot: (lineEl, _context, options) => {
        captured.push({ lineEl, wrapperEl: options?.wrapperEl });
      },
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.lineEl.classList.contains('superdoc-line')).toBe(true);
    // With inline marker approach, lineEl has paddingLeft from marker positioning.
    // applySquareWrapExclusionsToLines skips lines with existing padding, so no
    // wrapperEl and no margins are applied — this is correct because the marker
    // positioning already controls the line's horizontal layout.
    expect(captured[0]?.wrapperEl).toBeFalsy();
  });

  describe('spacing.after margin-bottom rendering', () => {
    it('should apply margin-bottom for spacing.after on paragraphs', () => {
      const para1: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-1',
        runs: [{ text: 'First paragraph', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { spacing: { after: 10 } },
      };

      const para2: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-2',
        runs: [{ text: 'Second paragraph', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { spacing: { after: 20 } },
      };

      const measure1: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 15,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const measure2: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 16,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const cellMeasure: TableCellMeasure = {
        blocks: [measure1, measure2],
        width: 120,
        height: 60,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-spacing',
        blocks: [para1, para2],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      expect(contentElement).toBeTruthy();

      // Get paragraph wrappers
      const paraWrappers = contentElement.children;
      expect(paraWrappers.length).toBe(2);

      const firstParaWrapper = paraWrappers[0] as HTMLElement;
      const secondParaWrapper = paraWrappers[1] as HTMLElement;

      // First paragraph should have margin-bottom, last paragraph should NOT
      // (last paragraph's spacing.after is absorbed by cell bottom padding)
      expect(firstParaWrapper.style.marginBottom).toBe('10px');
      expect(secondParaWrapper.style.marginBottom).toBe('');
    });

    it('should NOT apply spacing.after to the last paragraph', () => {
      const lastPara: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-last',
        runs: [{ text: 'Last paragraph', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { spacing: { after: 15 } },
      };

      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 14,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 120,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-last',
        blocks: [lastPara],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrapper = contentElement.firstElementChild as HTMLElement;

      // Last paragraph should NOT have margin-bottom applied
      // In Word, the last paragraph's spacing.after is absorbed by the cell's bottom padding
      expect(paraWrapper.style.marginBottom).toBe('');
    });

    it('should only apply margin-bottom when spacing.after > 0', () => {
      const para1: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-1',
        runs: [{ text: 'Zero spacing', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { spacing: { after: 0 } },
      };

      const para2: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-2',
        runs: [{ text: 'Negative spacing', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { spacing: { after: -5 } },
      };

      const para3: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-3',
        runs: [{ text: 'Positive spacing', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { spacing: { after: 10 } },
      };

      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 10,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const cellMeasure: TableCellMeasure = {
        blocks: [measure, measure, measure],
        width: 120,
        height: 80,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-conditional',
        blocks: [para1, para2, para3],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrappers = contentElement.children;

      const wrapper1 = paraWrappers[0] as HTMLElement;
      const wrapper2 = paraWrappers[1] as HTMLElement;
      const wrapper3 = paraWrappers[2] as HTMLElement;

      // Zero and negative spacing should not result in margin-bottom
      expect(wrapper1.style.marginBottom).toBe('');
      expect(wrapper2.style.marginBottom).toBe('');

      // Last paragraph's spacing.after is skipped (absorbed by cell bottom padding)
      expect(wrapper3.style.marginBottom).toBe('');
    });

    it('should handle paragraphs without spacing.after attribute', () => {
      const para: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-no-spacing',
        runs: [{ text: 'No spacing attr', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {},
      };

      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 15,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 120,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-no-attr',
        blocks: [para],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrapper = contentElement.firstElementChild as HTMLElement;

      // Should not have margin-bottom when no spacing.after
      expect(paraWrapper.style.marginBottom).toBe('');
    });

    it('should handle type safety for spacing.after', () => {
      const para1: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-1',
        runs: [{ text: 'Valid number', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { spacing: { after: 10 } },
      };

      const para2: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-2',
        runs: [{ text: 'Invalid type', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { spacing: { after: '15' as unknown as number } },
      };

      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 10,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const cellMeasure: TableCellMeasure = {
        blocks: [measure, measure],
        width: 120,
        height: 60,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-type-safety',
        blocks: [para1, para2],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrappers = contentElement.children;

      const wrapper1 = paraWrappers[0] as HTMLElement;
      const wrapper2 = paraWrappers[1] as HTMLElement;

      // Valid number should apply margin-bottom
      expect(wrapper1.style.marginBottom).toBe('10px');

      // Invalid type (string) should not apply margin-bottom
      expect(wrapper2.style.marginBottom).toBe('');
    });

    it('should only apply spacing when rendering entire block (not partial)', () => {
      const para: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-partial',
        runs: [{ text: 'Partial render test', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { spacing: { after: 15 } },
      };

      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 10,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
          {
            fromRun: 0,
            fromChar: 10,
            toRun: 0,
            toChar: 19,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 40,
      };

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 120,
        height: 60,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-partial',
        blocks: [para],
        attrs: {},
      };

      // Render only first line (partial)
      const { cellElement: partialCell } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
        fromLine: 0,
        toLine: 1,
      });

      const partialContent = partialCell.firstElementChild as HTMLElement;
      const partialWrapper = partialContent.firstElementChild as HTMLElement;

      // Partial render should NOT apply spacing.after
      expect(partialWrapper.style.marginBottom).toBe('');

      // Render entire block
      const { cellElement: fullCell } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const fullContent = fullCell.firstElementChild as HTMLElement;
      const fullWrapper = fullContent.firstElementChild as HTMLElement;

      // Full render of last paragraph should NOT apply spacing.after
      // (last paragraph's spacing.after is absorbed by cell bottom padding)
      expect(fullWrapper.style.marginBottom).toBe('');
    });
  });

  describe('spacing.before margin-top rendering', () => {
    it('applies margin-top only for positive spacing.before', () => {
      const para1: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-before-zero',
        runs: [{ text: 'Zero spacing', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { spacing: { before: 0 } },
      };

      const para2: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-before-negative',
        runs: [{ text: 'Negative spacing', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { spacing: { before: -6 } },
      };

      const para3: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-before-positive',
        runs: [{ text: 'Positive spacing', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { spacing: { before: 9 } },
      };

      const cellMeasure: TableCellMeasure = {
        blocks: [paragraphMeasure, paragraphMeasure, paragraphMeasure],
        width: 120,
        height: 80,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-spacing-before-conditional',
        blocks: [para1, para2, para3],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrappers = contentElement.children;

      expect((paraWrappers[0] as HTMLElement).style.marginTop).toBe('');
      expect((paraWrappers[1] as HTMLElement).style.marginTop).toBe('');
      expect((paraWrappers[2] as HTMLElement).style.marginTop).toBe('9px');
    });

    it('skips spacing.before for partial renders', () => {
      const para: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-before-partial',
        runs: [{ text: 'Partial render test', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { spacing: { before: 11 } },
      };

      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 10,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
          {
            fromRun: 0,
            fromChar: 10,
            toRun: 0,
            toChar: 19,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 40,
      };

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 120,
        height: 60,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-before-partial',
        blocks: [para],
        attrs: {},
      };

      const { cellElement: partialCell } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
        fromLine: 1,
        toLine: 2,
      });

      const partialWrapper = (partialCell.firstElementChild as HTMLElement).firstElementChild as HTMLElement;
      expect(partialWrapper.style.marginTop).toBe('');

      const { cellElement: fullCell } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const fullWrapper = (fullCell.firstElementChild as HTMLElement).firstElementChild as HTMLElement;
      expect(fullWrapper.style.marginTop).toBe('11px');
    });

    it('applies both margin-top and margin-bottom when paragraph has spacing.before and spacing.after', () => {
      const paraWithBoth: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-before-and-after',
        runs: [{ text: 'Both spacing', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { spacing: { before: 12, after: 18 } },
      };

      const secondPara: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-second',
        runs: [{ text: 'Second', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {},
      };

      const secondMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 7,
            width: 50,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const cellMeasure: TableCellMeasure = {
        blocks: [paragraphMeasure, secondMeasure],
        width: 120,
        height: 100,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-before-and-after',
        blocks: [paraWithBoth, secondPara],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const firstParaWrapper = contentElement.children[0] as HTMLElement;
      expect(firstParaWrapper.style.marginTop).toBe('12px');
      expect(firstParaWrapper.style.marginBottom).toBe('18px');
    });
  });

  describe('list marker rendering', () => {
    const createParagraphWithMarker = (markerText: string, markerWidth = 20, gutterWidth = 8, indentLeft = 30) => {
      const para: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-list',
        runs: [{ text: 'List item text', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {
          wordLayout: {
            marker: {
              markerText,
              markerBoxWidthPx: markerWidth,
              gutterWidthPx: gutterWidth,
              justification: 'left' as const,
              run: {
                fontFamily: 'Arial',
                fontSize: 14,
                bold: false,
                italic: false,
                color: '#000000',
              },
            },
            indentLeftPx: indentLeft,
          },
        },
      };

      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 14,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
        marker: {
          markerWidth,
          gutterWidth,
          indentLeft,
        },
      };

      return { para, measure };
    };

    it('should render bullet list marker with correct positioning', () => {
      const { para, measure } = createParagraphWithMarker('•');

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 120,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-bullet-list',
        blocks: [para],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrapper = contentElement.firstElementChild as HTMLElement;
      const lineEl = paraWrapper.firstElementChild as HTMLElement;

      // Marker is prepended inside lineEl (matches renderer.ts approach)
      const markerEl = lineEl.querySelector('.superdoc-paragraph-marker') as HTMLElement;
      expect(markerEl).toBeTruthy();
      expect(markerEl.textContent).toBe('•');
      // Left-justified markers stay inline (position: relative on container span)
      const markerContainer = markerEl.parentElement as HTMLElement;
      expect(markerContainer.style.position).toBe('relative');

      const tabEl = lineEl.querySelector('.superdoc-tab') as HTMLElement;
      expect(tabEl.classList.contains('superdoc-marker-suffix-tab')).toBe(true);
      expect(tabEl.style.fontSize).toBe('14px');
    });

    it('should render numbered list marker with correct text', () => {
      const { para, measure } = createParagraphWithMarker('1.');

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 120,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-numbered-list',
        blocks: [para],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrapper = contentElement.firstElementChild as HTMLElement;
      const lineEl = paraWrapper.firstElementChild as HTMLElement;
      const markerEl = lineEl.querySelector('.superdoc-paragraph-marker') as HTMLElement;

      expect(markerEl).toBeTruthy();
      expect(markerEl.textContent).toBe('1.');
    });

    it('should apply marker styling (font, color, bold, italic)', () => {
      const { para, measure } = createParagraphWithMarker('a)');
      if (para.attrs?.wordLayout?.marker) {
        para.attrs.wordLayout.marker.run = {
          fontFamily: 'Times New Roman',
          fontSize: 18,
          bold: true,
          italic: true,
          color: '#FF0000',
          letterSpacing: 2,
        };
      }

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 120,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-styled-marker',
        blocks: [para],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrapper = contentElement.firstElementChild as HTMLElement;
      const lineEl = paraWrapper.firstElementChild as HTMLElement;
      const markerEl = lineEl.querySelector('.superdoc-paragraph-marker') as HTMLElement;

      expect(markerEl.style.fontFamily).toBe('"Liberation Serif", serif');
      expect(markerEl.style.fontSize).toBe('18px');
      expect(markerEl.style.fontWeight).toBe('bold');
      expect(markerEl.style.fontStyle).toBe('italic');
      expectCssColor(markerEl.style.color, '#ff0000');
      expect(markerEl.style.letterSpacing).toBe('2px');
    });

    it('should handle marker justification (left, center, right)', () => {
      const testCases: Array<{
        justification: 'left' | 'center' | 'right';
        expectedPosition: string;
      }> = [
        // Left: marker container stays inline (position: relative)
        { justification: 'left', expectedPosition: 'relative' },
        // Center/right: marker container is absolutely positioned
        { justification: 'center', expectedPosition: 'absolute' },
        { justification: 'right', expectedPosition: 'absolute' },
      ];

      testCases.forEach(({ justification, expectedPosition }) => {
        const { para, measure } = createParagraphWithMarker('•');
        if (para.attrs?.wordLayout?.marker) {
          para.attrs.wordLayout.marker.justification = justification;
        }

        const cellMeasure: TableCellMeasure = {
          blocks: [measure],
          width: 120,
          height: 40,
          gridColumnStart: 0,
          colSpan: 1,
          rowSpan: 1,
        };

        const cell: TableCell = {
          id: `cell-marker-${justification}`,
          blocks: [para],
          attrs: {},
        };

        const { cellElement } = renderTableCell({
          ...createBaseDeps(),
          cellMeasure,
          cell,
        });

        const contentElement = cellElement.firstElementChild as HTMLElement;
        const paraWrapper = contentElement.firstElementChild as HTMLElement;
        const lineEl = paraWrapper.firstElementChild as HTMLElement;
        const markerEl = lineEl.querySelector('.superdoc-paragraph-marker') as HTMLElement;
        const markerContainer = markerEl.parentElement as HTMLElement;

        expect(markerContainer.style.position).toBe(expectedPosition);
      });
    });

    it('should apply proper indentation when marker is present', () => {
      const indentLeft = 50;
      const { para, measure } = createParagraphWithMarker('1.', 20, 8, indentLeft);

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 120,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-indented-marker',
        blocks: [para],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrapper = contentElement.firstElementChild as HTMLElement;
      const lineEl = paraWrapper.firstElementChild as HTMLElement;

      // Line paddingLeft should be set to the anchor point (indentLeft - hanging + firstLine).
      // With no hanging/firstLine, anchor = indentLeft.
      expect(lineEl.style.paddingLeft).toBe(`${indentLeft}px`);
    });

    it('should only render marker on first line of paragraph', () => {
      const { para, measure } = createParagraphWithMarker('•');

      // Add a second line
      const measureWith2Lines: ParagraphMeasure = {
        ...measure,
        lines: [
          ...(measure.lines ?? []),
          {
            fromRun: 0,
            fromChar: 14,
            toRun: 0,
            toChar: 28,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 40,
      };

      const cellMeasure: TableCellMeasure = {
        blocks: [measureWith2Lines],
        width: 120,
        height: 60,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-multiline-list',
        blocks: [para],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrapper = contentElement.firstElementChild as HTMLElement;

      // First child should be a line element with marker prepended inside
      const firstLine = paraWrapper.children[0] as HTMLElement;
      const firstMarker = firstLine.querySelector('.superdoc-paragraph-marker');
      expect(firstMarker).toBeTruthy();

      // Second child should be just a line element without marker
      const secondLine = paraWrapper.children[1] as HTMLElement;
      const secondMarker = secondLine.querySelector('.superdoc-paragraph-marker');
      expect(secondMarker).toBeNull();
    });

    it('should handle missing markerLayout gracefully', () => {
      const para: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-no-marker',
        runs: [{ text: 'Regular paragraph', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {},
      };

      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 17,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 120,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-no-marker',
        blocks: [para],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrapper = contentElement.firstElementChild as HTMLElement;
      const markerEl = paraWrapper.querySelector('.superdoc-paragraph-marker');

      expect(markerEl).toBeNull();
    });

    it('should handle paragraphs with markerLayout but zero markerWidth', () => {
      const { para, measure } = createParagraphWithMarker('', 0, 8, 30);

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 120,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-zero-width-marker',
        blocks: [para],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrapper = contentElement.firstElementChild as HTMLElement;
      const markerEl = paraWrapper.querySelector('.superdoc-paragraph-marker');

      // Marker should not be rendered when markerWidth is 0
      expect(markerEl).toBeNull();
    });

    it('should handle partial line rendering without marker on continuation', () => {
      const { para, measure } = createParagraphWithMarker('1.');

      const measureWith2Lines: ParagraphMeasure = {
        ...measure,
        lines: [
          ...(measure.lines ?? []),
          {
            fromRun: 0,
            fromChar: 14,
            toRun: 0,
            toChar: 28,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 40,
      };

      const cellMeasure: TableCellMeasure = {
        blocks: [measureWith2Lines],
        width: 120,
        height: 60,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-partial-render',
        blocks: [para],
        attrs: {},
      };

      // Render only the second line (skip first line with marker)
      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
        fromLine: 1,
        toLine: 2,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrapper = contentElement.firstElementChild as HTMLElement;
      const markerEl = paraWrapper.querySelector('.superdoc-paragraph-marker');

      // Marker should not be rendered when starting from line > 0
      expect(markerEl).toBeNull();
    });
  });

  describe('paragraph borders and shading (SD-1296)', () => {
    it('should apply paragraph borders to paraWrapper', () => {
      const para: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-with-borders',
        runs: [{ text: 'Text with border', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {
          borders: {
            top: { width: 2, style: 'solid', color: '#FF0000' },
            bottom: { width: 1, style: 'dashed', color: '#0000FF' },
            left: { width: 3, style: 'dotted', color: '#00FF00' },
            right: { width: 1, style: 'solid', color: '#000000' },
          },
        },
      };

      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 16,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 120,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-with-para-borders',
        blocks: [para],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrapper = contentElement.firstElementChild as HTMLElement;
      const borderLayer = getParagraphBorderLayer(paraWrapper);

      expect(borderLayer.style.boxSizing).toBe('border-box');
      expect(borderLayer.style.borderTopWidth).toBe('2px');
      expect(borderLayer.style.borderTopStyle).toBe('solid');
      expectCssColor(borderLayer.style.borderTopColor, '#ff0000');
      expect(borderLayer.style.borderBottomWidth).toBe('1px');
      expect(borderLayer.style.borderBottomStyle).toBe('dashed');
      expectCssColor(borderLayer.style.borderBottomColor, '#0000ff');
      expect(borderLayer.style.borderLeftWidth).toBe('3px');
      expect(borderLayer.style.borderLeftStyle).toBe('dotted');
      expectCssColor(borderLayer.style.borderLeftColor, '#00ff00');
      expect(borderLayer.style.borderRightWidth).toBe('1px');
      expect(borderLayer.style.borderRightStyle).toBe('solid');
      expectCssColor(borderLayer.style.borderRightColor, '#000000');
    });

    it('should apply paragraph shading (background) to paraWrapper', () => {
      const para: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-with-shading',
        runs: [{ text: 'Shaded text', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {
          shading: {
            fill: '#FFFF00',
          },
        },
      };

      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 11,
            width: 80,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 120,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-with-para-shading',
        blocks: [para],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrapper = contentElement.firstElementChild as HTMLElement;
      const shadingLayer = getParagraphShadingLayer(paraWrapper);

      expectCssColor(shadingLayer.style.backgroundColor, '#ffff00');
    });

    it('should apply both borders and shading to the same paragraph', () => {
      const para: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-both-styles',
        runs: [{ text: 'Styled paragraph', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {
          borders: {
            top: { width: 1, style: 'solid', color: '#333333' },
            bottom: { width: 1, style: 'solid', color: '#333333' },
          },
          shading: {
            fill: '#E0E0E0',
          },
        },
      };

      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 16,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 120,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-both-styles',
        blocks: [para],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrapper = contentElement.firstElementChild as HTMLElement;
      const borderLayer = getParagraphBorderLayer(paraWrapper);
      const shadingLayer = getParagraphShadingLayer(paraWrapper);

      expect(borderLayer.style.borderTopWidth).toBe('1px');
      expect(borderLayer.style.borderBottomWidth).toBe('1px');
      expectCssColor(shadingLayer.style.backgroundColor, '#e0e0e0');
    });

    it('should handle multiple paragraphs with different borders in same cell', () => {
      const para1: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-1',
        runs: [{ text: 'First paragraph', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {
          borders: {
            bottom: { width: 2, style: 'solid', color: '#FF0000' },
          },
        },
      };

      const para2: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-2',
        runs: [{ text: 'Second paragraph', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {
          borders: {
            top: { width: 1, style: 'dashed', color: '#0000FF' },
          },
        },
      };

      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 15,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const cellMeasure: TableCellMeasure = {
        blocks: [measure, measure],
        width: 120,
        height: 60,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-multi-para-borders',
        blocks: [para1, para2],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrappers = contentElement.children;

      // First paragraph has bottom border
      const wrapper1 = paraWrappers[0] as HTMLElement;
      const borderLayer1 = getParagraphBorderLayer(wrapper1);
      expect(borderLayer1.style.borderBottomWidth).toBe('2px');
      expectCssColor(borderLayer1.style.borderBottomColor, '#ff0000');

      // Second paragraph has top border
      const wrapper2 = paraWrappers[1] as HTMLElement;
      const borderLayer2 = getParagraphBorderLayer(wrapper2);
      expect(borderLayer2.style.borderTopWidth).toBe('1px');
      expect(borderLayer2.style.borderTopStyle).toBe('dashed');
      expectCssColor(borderLayer2.style.borderTopColor, '#0000ff');
    });

    it('should not apply borders when paragraph has no borders attribute', () => {
      const para: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-no-borders',
        runs: [{ text: 'No borders', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {},
      };

      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 10,
            width: 80,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 120,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-no-borders',
        blocks: [para],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrapper = contentElement.firstElementChild as HTMLElement;

      // No borders should be applied
      expect(paraWrapper.style.borderTopWidth).toBe('');
      expect(paraWrapper.style.borderBottomWidth).toBe('');
      expect(paraWrapper.style.borderLeftWidth).toBe('');
      expect(paraWrapper.style.borderRightWidth).toBe('');
    });

    it('should handle border style "none" correctly', () => {
      const para: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-border-none',
        runs: [{ text: 'Border none', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {
          borders: {
            top: { width: 1, style: 'none', color: '#000000' },
          },
        },
      };

      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 11,
            width: 80,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 120,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-border-none',
        blocks: [para],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrapper = contentElement.firstElementChild as HTMLElement;
      const borderLayer = getParagraphBorderLayer(paraWrapper);

      expect(borderLayer.style.borderTopStyle).toBe('none');
      expect(borderLayer.style.borderTopWidth).toBe('0px');
    });

    it('should handle zero width borders (width: 0)', () => {
      const para: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-zero-width',
        runs: [{ text: 'Zero width border', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {
          borders: {
            top: { width: 0, style: 'solid', color: '#FF0000' },
          },
        },
      };

      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 17,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 120,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-zero-width',
        blocks: [para],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrapper = contentElement.firstElementChild as HTMLElement;
      const borderLayer = getParagraphBorderLayer(paraWrapper);

      expect(borderLayer.style.borderTopWidth).toBe('0px');
      expect(borderLayer.style.borderTopStyle).toBe('solid');
      expectCssColor(borderLayer.style.borderTopColor, '#ff0000');
    });

    it('should clamp negative width borders to 0px', () => {
      const para: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-negative-width',
        runs: [{ text: 'Negative width border', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {
          borders: {
            left: { width: -5, style: 'solid', color: '#0000FF' },
          },
        },
      };

      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 21,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 120,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-negative-width',
        blocks: [para],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrapper = contentElement.firstElementChild as HTMLElement;
      const borderLayer = getParagraphBorderLayer(paraWrapper);

      expect(borderLayer.style.borderLeftWidth).toBe('0px');
      expect(borderLayer.style.borderLeftStyle).toBe('solid');
      expectCssColor(borderLayer.style.borderLeftColor, '#0000ff');
    });

    it('should default to 1px when width is undefined', () => {
      const para: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-undefined-width',
        runs: [{ text: 'Undefined width', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {
          borders: {
            bottom: { style: 'dashed', color: '#00FF00' } as ParagraphBlock['attrs']['borders']['bottom'],
          },
        },
      };

      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 15,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 120,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-undefined-width',
        blocks: [para],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrapper = contentElement.firstElementChild as HTMLElement;
      const borderLayer = getParagraphBorderLayer(paraWrapper);

      expect(borderLayer.style.borderBottomWidth).toBe('1px');
      expect(borderLayer.style.borderBottomStyle).toBe('dashed');
      expectCssColor(borderLayer.style.borderBottomColor, '#00ff00');
    });

    it('should only apply border to specified sides (e.g., only top)', () => {
      const para: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-top-only',
        runs: [{ text: 'Only top border', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {
          borders: {
            top: { width: 3, style: 'solid', color: '#FF00FF' },
          },
        },
      };

      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 15,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 120,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-top-only',
        blocks: [para],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrapper = contentElement.firstElementChild as HTMLElement;
      const borderLayer = getParagraphBorderLayer(paraWrapper);

      expect(borderLayer.style.borderTopWidth).toBe('3px');
      expect(borderLayer.style.borderTopStyle).toBe('solid');
      expectCssColor(borderLayer.style.borderTopColor, '#ff00ff');

      // Left, right, and bottom borders should remain unset
      expect(borderLayer.style.borderLeftWidth).toBe('');
      expect(borderLayer.style.borderRightWidth).toBe('');
      expect(borderLayer.style.borderBottomWidth).toBe('');
    });

    it('should handle empty shading object (shading: {})', () => {
      const para: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-empty-shading',
        runs: [{ text: 'Empty shading', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {
          shading: {},
        },
      };

      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 13,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 120,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-empty-shading',
        blocks: [para],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrapper = contentElement.firstElementChild as HTMLElement;

      // No background should be applied when shading object is empty (no fill property)
      expect(paraWrapper.style.backgroundColor).toBe('');
    });
  });

  describe('explicit segment positioning (SD-1472)', () => {
    /**
     * SD-1472: When segments have explicit x positions (from tabs), the indentation
     * should not be double-applied. The segments are already absolutely positioned,
     * so adding padding would shift them incorrectly, causing the first character
     * to be lost/hidden.
     */

    const createParagraphWithExplicitPositioning = (
      indent: { left?: number; hanging?: number; firstLine?: number; right?: number },
      segmentX?: number,
    ) => {
      const para: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-explicit-pos',
        runs: [{ text: 'A hello world text', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { indent },
      };

      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 18,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
            // When segmentX is provided, segments have explicit positioning (from tabs)
            segments: segmentX !== undefined ? [{ x: segmentX, width: 100 }] : undefined,
          },
        ],
        totalHeight: 20,
      };

      return { para, measure };
    };

    it('should not apply paddingLeft when segments have explicit x positions (prevents double indent)', () => {
      const { para, measure } = createParagraphWithExplicitPositioning(
        { left: 20, hanging: 30 },
        50, // Explicit x position from tab
      );

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 150,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-explicit-pos',
        blocks: [para],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrapper = contentElement.firstElementChild as HTMLElement;
      const lineEl = paraWrapper.firstElementChild as HTMLElement;

      // With explicit segment positioning, textIndent should be reset to 0
      // to prevent double-application of indentation
      expect(lineEl.style.textIndent).toBe('0px');
    });

    it('should apply adjusted padding for first line with explicit positioning and firstLineOffset', () => {
      const { para, measure } = createParagraphWithExplicitPositioning(
        { left: 20, hanging: 50, firstLine: 10 }, // firstLineOffset = 10 - 50 = -40
        30, // Explicit x position
      );

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 150,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-adjusted-padding',
        blocks: [para],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrapper = contentElement.firstElementChild as HTMLElement;
      const lineEl = paraWrapper.firstElementChild as HTMLElement;

      // adjustedPadding = effectiveLeftIndent (20) + firstLineOffset (-40) = -20
      // Since -20 <= 0, no paddingLeft should be applied
      expect(lineEl.style.paddingLeft).toBe('');
      expect(lineEl.style.textIndent).toBe('0px');
    });

    it('should apply positive adjusted padding when effectiveLeftIndent + firstLineOffset > 0', () => {
      const { para, measure } = createParagraphWithExplicitPositioning(
        { left: 50, hanging: 20, firstLine: 10 }, // firstLineOffset = 10 - 20 = -10
        30, // Explicit x position
      );

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 150,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-positive-adjusted',
        blocks: [para],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrapper = contentElement.firstElementChild as HTMLElement;
      const lineEl = paraWrapper.firstElementChild as HTMLElement;

      // adjustedPadding = effectiveLeftIndent (50) + firstLineOffset (-10) = 40
      expect(lineEl.style.paddingLeft).toBe('40px');
      expect(lineEl.style.textIndent).toBe('0px');
    });

    it('should clamp negative left indent to 0 when calculating adjusted padding', () => {
      const { para, measure } = createParagraphWithExplicitPositioning(
        { left: -15, hanging: 20, firstLine: 5 }, // firstLineOffset = 5 - 20 = -15
        30, // Explicit x position
      );

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 150,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-negative-left-clamped',
        blocks: [para],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrapper = contentElement.firstElementChild as HTMLElement;
      const lineEl = paraWrapper.firstElementChild as HTMLElement;

      // effectiveLeftIndent = max(0, -15) = 0
      // adjustedPadding = 0 + (-15) = -15 which is <= 0, so no padding
      expect(lineEl.style.paddingLeft).toBe('');
      expect(lineEl.style.textIndent).toBe('0px');
    });

    it('should apply normal indentation when segments do NOT have explicit positioning', () => {
      const { para, measure } = createParagraphWithExplicitPositioning(
        { left: 20, hanging: 30 },
        undefined, // No explicit x position
      );

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 150,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-no-explicit-pos',
        blocks: [para],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrapper = contentElement.firstElementChild as HTMLElement;
      const lineEl = paraWrapper.firstElementChild as HTMLElement;

      // Without explicit positioning, normal indent rules apply
      expect(lineEl.style.paddingLeft).toBe('20px');
      expect(lineEl.style.textIndent).toBe('-30px'); // firstLine(0) - hanging(30) = -30
    });

    it('should handle suppressFirstLineIndent flag', () => {
      const para: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-suppress',
        runs: [{ text: 'Suppressed indent', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {
          indent: { left: 20, hanging: 30, firstLine: 10 },
          suppressFirstLineIndent: true,
        },
      };

      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 17,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 150,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-suppress-indent',
        blocks: [para],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrapper = contentElement.firstElementChild as HTMLElement;
      const lineEl = paraWrapper.firstElementChild as HTMLElement;

      // When suppressFirstLineIndent is true, firstLineOffset should be 0
      // So textIndent should not be applied
      expect(lineEl.style.textIndent).toBe('');
      expect(lineEl.style.paddingLeft).toBe('20px');
    });

    it('should not apply list indent padding when segments have explicit positioning', () => {
      const para: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-list-explicit',
        runs: [{ text: 'List item with tabs', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {
          wordLayout: {
            marker: {
              markerText: '1.',
              markerBoxWidthPx: 20,
              gutterWidthPx: 8,
              justification: 'left' as const,
              run: { fontFamily: 'Arial', fontSize: 14 },
            },
            indentLeftPx: 40,
          },
        },
      };

      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 19,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
          {
            fromRun: 0,
            fromChar: 19,
            toRun: 0,
            toChar: 30,
            width: 80,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
            // Second line (continuation) has explicit positioning
            segments: [{ x: 40, width: 80 }],
          },
        ],
        totalHeight: 40,
        marker: { markerWidth: 20, gutterWidth: 8, indentLeft: 40 },
      };

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 150,
        height: 60,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-list-explicit-pos',
        blocks: [para],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrapper = contentElement.firstElementChild as HTMLElement;

      // Second line (continuation) should NOT have paddingLeft applied
      // because it has explicit segment positioning
      const secondLine = paraWrapper.children[1] as HTMLElement;
      expect(secondLine.style.paddingLeft).toBe('');
    });
  });

  describe('hanging indent (SD-1295)', () => {
    const createMultiLineParagraph = (indent: {
      left?: number;
      hanging?: number;
      firstLine?: number;
      right?: number;
    }) => {
      const para: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-hanging',
        runs: [{ text: 'First line text. Second line text that wraps.', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {
          indent,
        },
      };

      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 17,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
          {
            fromRun: 0,
            fromChar: 17,
            toRun: 0,
            toChar: 45,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 40,
      };

      return { para, measure };
    };

    it('should apply hanging indent: first line at left, body lines at left+hanging', () => {
      const { para, measure } = createMultiLineParagraph({
        left: 20,
        hanging: 30,
      });

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 150,
        height: 60,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-hanging',
        blocks: [para],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrapper = contentElement.firstElementChild as HTMLElement;
      const lines = paraWrapper.children;

      // First line: paddingLeft = left (20px), textIndent = firstLine - hanging = 0 - 30 = -30px
      const firstLine = lines[0] as HTMLElement;
      expect(firstLine.style.paddingLeft).toBe('20px');
      expect(firstLine.style.textIndent).toBe('-30px');

      // Body line: paddingLeft = left = 20px
      const bodyLine = lines[1] as HTMLElement;
      expect(bodyLine.style.paddingLeft).toBe('20px');
      expect(bodyLine.style.textIndent).toBe('');
    });

    it('should handle firstLine + hanging combination', () => {
      const { para, measure } = createMultiLineParagraph({
        left: 20,
        hanging: 30,
        firstLine: 10, // First line indent of 10
      });

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 150,
        height: 60,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-firstline-hanging',
        blocks: [para],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrapper = contentElement.firstElementChild as HTMLElement;
      const lines = paraWrapper.children;

      // First line: paddingLeft = left (20px), textIndent = firstLine - hanging = 10 - 30 = -20px
      const firstLine = lines[0] as HTMLElement;
      expect(firstLine.style.paddingLeft).toBe('20px');
      expect(firstLine.style.textIndent).toBe('-20px');

      // Body line: paddingLeft = left = 20px
      const bodyLine = lines[1] as HTMLElement;
      expect(bodyLine.style.paddingLeft).toBe('20px');
    });

    it('should handle left indent without hanging', () => {
      const { para, measure } = createMultiLineParagraph({
        left: 40,
      });

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 150,
        height: 60,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-left-only',
        blocks: [para],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrapper = contentElement.firstElementChild as HTMLElement;
      const lines = paraWrapper.children;

      // Both lines should have same left padding (no hanging effect)
      const firstLine = lines[0] as HTMLElement;
      expect(firstLine.style.paddingLeft).toBe('40px');
      expect(firstLine.style.textIndent).toBe('');

      const bodyLine = lines[1] as HTMLElement;
      expect(bodyLine.style.paddingLeft).toBe('40px');
    });

    it('should handle firstLine indent without hanging', () => {
      const { para, measure } = createMultiLineParagraph({
        left: 20,
        firstLine: 15,
      });

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 150,
        height: 60,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-firstline-only',
        blocks: [para],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrapper = contentElement.firstElementChild as HTMLElement;
      const lines = paraWrapper.children;

      // First line: paddingLeft = left (20px), textIndent = firstLine - hanging = 15 - 0 = 15px
      const firstLine = lines[0] as HTMLElement;
      expect(firstLine.style.paddingLeft).toBe('20px');
      expect(firstLine.style.textIndent).toBe('15px');

      // Body line: paddingLeft = left (20px), no hanging
      const bodyLine = lines[1] as HTMLElement;
      expect(bodyLine.style.paddingLeft).toBe('20px');
    });

    it('should apply right indent to all lines', () => {
      const { para, measure } = createMultiLineParagraph({
        left: 20,
        hanging: 30,
        right: 15,
      });

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 150,
        height: 60,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-right-indent',
        blocks: [para],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrapper = contentElement.firstElementChild as HTMLElement;
      const lines = paraWrapper.children;

      // Both lines should have right padding
      const firstLine = lines[0] as HTMLElement;
      expect(firstLine.style.paddingRight).toBe('15px');

      const bodyLine = lines[1] as HTMLElement;
      expect(bodyLine.style.paddingRight).toBe('15px');
    });

    it('should not apply textIndent when firstLineOffset is zero', () => {
      const { para, measure } = createMultiLineParagraph({
        left: 20,
        hanging: 0,
        firstLine: 0,
      });

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 150,
        height: 60,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-zero-offset',
        blocks: [para],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrapper = contentElement.firstElementChild as HTMLElement;
      const lines = paraWrapper.children;

      // First line should not have textIndent when offset is 0
      const firstLine = lines[0] as HTMLElement;
      expect(firstLine.style.textIndent).toBe('');
    });

    it('should handle partial rendering starting from body line', () => {
      const { para, measure } = createMultiLineParagraph({
        left: 20,
        hanging: 30,
      });

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 150,
        height: 60,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-partial',
        blocks: [para],
        attrs: {},
      };

      // Render only the second line (skip first line)
      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
        fromLine: 1,
        toLine: 2,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrapper = contentElement.firstElementChild as HTMLElement;
      const lines = paraWrapper.children;

      // When starting from line 1 (body line), it should get body line treatment
      // paddingLeft = left = 20px
      const renderedLine = lines[0] as HTMLElement;
      expect(renderedLine.style.paddingLeft).toBe('20px');
      expect(renderedLine.style.textIndent).toBe('');
    });

    it('should handle negative hanging indent', () => {
      const { para, measure } = createMultiLineParagraph({
        left: 40,
        hanging: -20,
      });

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 150,
        height: 60,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-negative-hanging',
        blocks: [para],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrapper = contentElement.firstElementChild as HTMLElement;
      const lines = paraWrapper.children;

      // First line: paddingLeft = left (40px), textIndent = firstLine - hanging = 0 - (-20) = 20px
      const firstLine = lines[0] as HTMLElement;
      expect(firstLine.style.paddingLeft).toBe('40px');
      expect(firstLine.style.textIndent).toBe('20px');

      // Body lines: negative hanging is ignored, only left indent applies
      // paddingLeft = left (40px) since hanging <= 0
      const bodyLine = lines[1] as HTMLElement;
      expect(bodyLine.style.paddingLeft).toBe('40px');
      expect(bodyLine.style.textIndent).toBe('');
    });

    it('should handle negative left indent', () => {
      const { para, measure } = createMultiLineParagraph({
        left: -15,
        hanging: 20,
      });

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 150,
        height: 60,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-negative-left',
        blocks: [para],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      const contentElement = cellElement.firstElementChild as HTMLElement;
      const paraWrapper = contentElement.firstElementChild as HTMLElement;
      const lines = paraWrapper.children;

      // First line: negative leftIndent means no paddingLeft is applied (leftIndent > 0 check fails)
      // textIndent = firstLine - hanging = 0 - 20 = -20px
      const firstLine = lines[0] as HTMLElement;
      expect(firstLine.style.paddingLeft).toBe('');
      expect(firstLine.style.textIndent).toBe('-20px');

      // Body lines: negative leftIndent + positive hanging
      // PaddingLeft not applied because left indent is negative
      const bodyLine = lines[1] as HTMLElement;
      expect(bodyLine.style.paddingLeft).toBe('');
      expect(bodyLine.style.textIndent).toBe('');
    });
  });

  describe('renderDrawingContent callback', () => {
    it('should render ShapeGroup drawing blocks via callback', () => {
      const shapeGroupBlock = {
        kind: 'drawing' as const,
        id: 'drawing-1',
        drawingKind: 'shapeGroup' as const,
        geometry: { width: 200, height: 150, rotation: 0, flipH: false, flipV: false },
        shapes: [
          {
            shapeType: 'image',
            attrs: {
              x: 0,
              y: 0,
              width: 100,
              height: 100,
              src: 'data:image/png;base64,test',
            },
          },
        ],
      };

      const drawingMeasure = {
        kind: 'drawing' as const,
        width: 200,
        height: 150,
      };

      const cellMeasure = {
        blocks: [drawingMeasure],
        width: 220,
        height: 170,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell = {
        id: 'cell-with-shapegroup',
        blocks: [shapeGroupBlock],
        attrs: {},
      };

      const mockRenderDrawingContent = (block: any): HTMLElement => {
        const div = doc.createElement('div');
        div.classList.add('mock-shapegroup');
        div.setAttribute('data-drawing-id', block.id);
        div.setAttribute('data-drawing-kind', block.drawingKind);
        return div;
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
        renderDrawingContent: mockRenderDrawingContent,
      });

      const shapeGroupEl = cellElement.querySelector('.mock-shapegroup') as HTMLElement;
      expect(shapeGroupEl).toBeTruthy();
      expect(shapeGroupEl.getAttribute('data-drawing-id')).toBe('drawing-1');
      expect(shapeGroupEl.getAttribute('data-drawing-kind')).toBe('shapeGroup');
      expect(shapeGroupEl.style.width).toBe('100%');
      expect(shapeGroupEl.style.height).toBe('100%');
    });

    it('should render VectorShape drawing blocks via callback', () => {
      const vectorShapeBlock = {
        kind: 'drawing' as const,
        id: 'drawing-2',
        drawingKind: 'vectorShape' as const,
        geometry: { width: 100, height: 100, rotation: 0, flipH: false, flipV: false },
        shapeKind: 'rect' as const,
      };

      const drawingMeasure = {
        kind: 'drawing' as const,
        width: 100,
        height: 100,
      };

      const cellMeasure = {
        blocks: [drawingMeasure],
        width: 120,
        height: 120,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell = {
        id: 'cell-with-vectorshape',
        blocks: [vectorShapeBlock],
        attrs: {},
      };

      const mockRenderDrawingContent = (block: any): HTMLElement => {
        const div = doc.createElement('div');
        div.classList.add('mock-vectorshape');
        div.setAttribute('data-shape-kind', block.shapeKind);
        return div;
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
        renderDrawingContent: mockRenderDrawingContent,
      });

      const vectorShapeEl = cellElement.querySelector('.mock-vectorshape') as HTMLElement;
      expect(vectorShapeEl).toBeTruthy();
      expect(vectorShapeEl.getAttribute('data-shape-kind')).toBe('rect');
      expect(vectorShapeEl.style.width).toBe('100%');
      expect(vectorShapeEl.style.height).toBe('100%');
    });

    it('should use placeholder fallback when callback is undefined', () => {
      const shapeGroupBlock = {
        kind: 'drawing' as const,
        id: 'drawing-3',
        drawingKind: 'shapeGroup' as const,
        geometry: { width: 200, height: 150, rotation: 0, flipH: false, flipV: false },
        shapes: [],
      };

      const drawingMeasure = {
        kind: 'drawing' as const,
        width: 200,
        height: 150,
      };

      const cellMeasure = {
        blocks: [drawingMeasure],
        width: 220,
        height: 170,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell = {
        id: 'cell-no-callback',
        blocks: [shapeGroupBlock],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
        // renderDrawingContent is undefined
      });

      // Should render placeholder with diagonal stripes pattern
      const drawingWrapper = cellElement.querySelector('.superdoc-table-drawing') as HTMLElement;
      expect(drawingWrapper).toBeTruthy();

      const placeholder = drawingWrapper.firstChild as HTMLElement;
      expect(placeholder).toBeTruthy();
      expect(placeholder.classList.contains('superdoc-drawing-placeholder')).toBe(true);
      expect(placeholder.style.border).toContain('dashed');
    });

    it('should pass correct DrawingBlock parameter to callback', () => {
      const shapeGroupBlock = {
        kind: 'drawing' as const,
        id: 'drawing-4',
        drawingKind: 'shapeGroup' as const,
        geometry: { width: 300, height: 200, rotation: 45, flipH: true, flipV: false },
        shapes: [{ shapeType: 'image', attrs: { x: 0, y: 0, width: 100, height: 100, src: 'test.png' } }],
      };

      const drawingMeasure = {
        kind: 'drawing' as const,
        width: 300,
        height: 200,
      };

      const cellMeasure = {
        blocks: [drawingMeasure],
        width: 320,
        height: 220,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell = {
        id: 'cell-verify-params',
        blocks: [shapeGroupBlock],
        attrs: {},
      };

      let capturedBlock: any = null;

      const mockRenderDrawingContent = (block: any): HTMLElement => {
        capturedBlock = block;
        return doc.createElement('div');
      };

      renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
        renderDrawingContent: mockRenderDrawingContent,
      });

      // Verify the callback received the correct block
      expect(capturedBlock).toBeTruthy();
      expect(capturedBlock.kind).toBe('drawing');
      expect(capturedBlock.id).toBe('drawing-4');
      expect(capturedBlock.drawingKind).toBe('shapeGroup');
      expect(capturedBlock.geometry.width).toBe(300);
      expect(capturedBlock.geometry.height).toBe(200);
      expect(capturedBlock.geometry.rotation).toBe(45);
      expect(capturedBlock.geometry.flipH).toBe(true);
      expect(capturedBlock.shapes.length).toBe(1);
    });

    it('should apply width and height styles to returned element', () => {
      const vectorShapeBlock = {
        kind: 'drawing' as const,
        id: 'drawing-5',
        drawingKind: 'vectorShape' as const,
        geometry: { width: 150, height: 100, rotation: 0, flipH: false, flipV: false },
        shapeKind: 'ellipse' as const,
      };

      const drawingMeasure = {
        kind: 'drawing' as const,
        width: 150,
        height: 100,
      };

      const cellMeasure = {
        blocks: [drawingMeasure],
        width: 170,
        height: 120,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell = {
        id: 'cell-verify-styles',
        blocks: [vectorShapeBlock],
        attrs: {},
      };

      const mockRenderDrawingContent = (block: any): HTMLElement => {
        const div = doc.createElement('div');
        div.classList.add('test-drawing-element');
        // Initially has no width/height styles
        return div;
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
        renderDrawingContent: mockRenderDrawingContent,
      });

      const drawingEl = cellElement.querySelector('.test-drawing-element') as HTMLElement;
      expect(drawingEl).toBeTruthy();

      // Verify that width and height styles were applied by renderTableCell
      expect(drawingEl.style.width).toBe('100%');
      expect(drawingEl.style.height).toBe('100%');
    });
  });

  describe('SDT container styling in cells', () => {
    it('should set overflow:visible when cell contains SDT container (structuredContent block)', () => {
      const para: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-sdt',
        runs: [{ text: 'SDT content', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {
          sdt: {
            type: 'structuredContent',
            scope: 'block',
            id: 'sdt-1',
            alias: 'Test Block',
          },
        },
      };

      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 11,
            width: 80,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 120,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-sdt-container',
        blocks: [para],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      // Cell should have overflow:visible to allow SDT labels to extend outside
      expect(cellElement.style.overflow).toBe('visible');
    });

    it('should set overflow:visible when cell contains documentSection SDT', () => {
      const para: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-doc-section',
        runs: [{ text: 'Section content', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {
          sdt: {
            type: 'documentSection',
            id: 'section-1',
            title: 'My Section',
          },
        },
      };

      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 15,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 120,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-doc-section',
        blocks: [para],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      expect(cellElement.style.overflow).toBe('visible');
    });

    it('should keep overflow:hidden when no SDT container is present', () => {
      const para: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-no-sdt',
        runs: [{ text: 'Regular paragraph', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {},
      };

      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 17,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 120,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-no-sdt',
        blocks: [para],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      // Cell should maintain default overflow:hidden
      expect(cellElement.style.overflow).toBe('hidden');
    });

    it('should not apply SDT container styling when block SDT key matches ancestor table SDT key', () => {
      const tableSdt: SdtMetadata = {
        type: 'structuredContent' as const,
        scope: 'block' as const,
        id: 'table-sdt',
        alias: 'Table Container',
      };
      const blockSdt: SdtMetadata = {
        type: 'structuredContent' as const,
        scope: 'block' as const,
        id: 'table-sdt',
        alias: 'Cell Container',
      };

      const para: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-same-sdt',
        runs: [{ text: 'Content in table SDT', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {
          sdt: blockSdt,
        },
      };

      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 20,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 120,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-table-sdt',
        blocks: [para],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
        ancestorContainerKey: 'structuredContent:table-sdt',
      });

      expect(cellElement.style.overflow).toBe('hidden');
      expect(cellElement.querySelector('.superdoc-structured-content-block')).toBeFalsy();
    });

    it('should not apply SDT container styling when id-less block SDT matches ancestor table SDT metadata', () => {
      const sharedSdt: SdtMetadata = {
        type: 'structuredContent' as const,
        scope: 'block' as const,
        alias: 'Table Container',
      };
      const para: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-same-idless-sdt',
        runs: [{ text: 'Content in id-less table SDT', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {
          sdt: sharedSdt,
        },
      };
      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 28,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure: {
          blocks: [measure],
          width: 120,
          height: 40,
          gridColumnStart: 0,
          colSpan: 1,
          rowSpan: 1,
        },
        cell: {
          id: 'cell-table-idless-sdt',
          blocks: [para],
          attrs: {},
        },
        ancestorContainerSdt: sharedSdt,
      });

      expect(cellElement.style.overflow).toBe('hidden');
      expect(cellElement.querySelector('.superdoc-structured-content-block')).toBeFalsy();
    });

    it('should keep overflow:hidden for inline scope structuredContent (not a block container)', () => {
      const para: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-inline-sdt',
        runs: [{ text: 'Inline SDT content', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {
          sdt: {
            type: 'structuredContent',
            scope: 'inline', // inline scope, not block
            id: 'inline-sdt-1',
            alias: 'Inline Field',
          },
        },
      };

      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 18,
            width: 100,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 120,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const cell: TableCell = {
        id: 'cell-inline-sdt',
        blocks: [para],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      // Inline SDTs don't get container styling, so overflow stays hidden
      expect(cellElement.style.overflow).toBe('hidden');
      expect(cellElement.querySelector('.superdoc-structured-content-block')).toBeFalsy();
      expect(cellElement.querySelector('.superdoc-structured-content__label')).toBeFalsy();
    });

    it('should set overflow:visible and render chrome when cell contains nested table SDT', () => {
      const nestedParagraph: ParagraphBlock = {
        kind: 'paragraph',
        id: 'nested-sdt-para',
        runs: [{ text: 'Nested', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {},
      };
      const nestedTable: TableBlock = {
        kind: 'table',
        id: 'nested-sdt-table',
        attrs: {
          sdt: {
            type: 'structuredContent',
            scope: 'block',
            id: 'nested-table-sdt',
            alias: 'Nested Table',
          },
        },
        rows: [
          {
            id: 'nested-row',
            cells: [
              {
                id: 'nested-cell',
                blocks: [nestedParagraph],
                attrs: {},
              },
            ],
          },
        ],
      };
      const nestedMeasure: TableMeasure = {
        kind: 'table',
        rows: [
          {
            height: 24,
            cells: [
              {
                width: 80,
                height: 24,
                gridColumnStart: 0,
                colSpan: 1,
                rowSpan: 1,
                blocks: [
                  {
                    kind: 'paragraph',
                    lines: [
                      {
                        fromRun: 0,
                        fromChar: 0,
                        toRun: 0,
                        toChar: 6,
                        width: 60,
                        ascent: 12,
                        descent: 4,
                        lineHeight: 20,
                      },
                    ],
                    totalHeight: 20,
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [80],
        totalWidth: 80,
        totalHeight: 24,
      };
      const cellMeasure: TableCellMeasure = {
        blocks: [nestedMeasure],
        width: 120,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };
      const cell: TableCell = {
        id: 'cell-nested-table-sdt',
        blocks: [nestedTable],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
      });

      expect(cellElement.style.overflow).toBe('visible');
      const tableChrome = cellElement.querySelector('[data-block-id="nested-sdt-table"]') as HTMLElement;
      expect(tableChrome?.classList.contains('superdoc-structured-content-block')).toBe(true);
      expect(tableChrome?.querySelector('.superdoc-structured-content__label')?.textContent).toBe('Nested Table');
    });

    it('omits the nested table SDT label but keeps the wrapper when chrome is none', () => {
      const nestedParagraph: ParagraphBlock = {
        kind: 'paragraph',
        id: 'nested-sdt-para-none',
        runs: [{ text: 'Nested', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {},
      };
      const nestedTable: TableBlock = {
        kind: 'table',
        id: 'nested-sdt-table-none',
        attrs: {
          sdt: {
            type: 'structuredContent',
            scope: 'block',
            id: 'nested-table-sdt-none',
            alias: 'Nested Table',
          },
        },
        rows: [
          {
            id: 'nested-row-none',
            cells: [
              {
                id: 'nested-cell-none',
                blocks: [nestedParagraph],
                attrs: {},
              },
            ],
          },
        ],
      };
      const nestedMeasure: TableMeasure = {
        kind: 'table',
        rows: [
          {
            height: 24,
            cells: [
              {
                width: 80,
                height: 24,
                gridColumnStart: 0,
                colSpan: 1,
                rowSpan: 1,
                blocks: [
                  {
                    kind: 'paragraph',
                    lines: [
                      {
                        fromRun: 0,
                        fromChar: 0,
                        toRun: 0,
                        toChar: 6,
                        width: 60,
                        ascent: 12,
                        descent: 4,
                        lineHeight: 20,
                      },
                    ],
                    totalHeight: 20,
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [80],
        totalWidth: 80,
        totalHeight: 24,
      };
      const cellMeasure: TableCellMeasure = {
        blocks: [nestedMeasure],
        width: 120,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };
      const cell: TableCell = {
        id: 'cell-nested-table-sdt-none',
        blocks: [nestedTable],
        attrs: {},
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
        chrome: 'none',
      });

      const tableChrome = cellElement.querySelector('[data-block-id="nested-sdt-table-none"]') as HTMLElement;
      // Wrapper survives so host/custom UI and the geometry APIs still resolve it...
      expect(tableChrome?.classList.contains('superdoc-structured-content-block')).toBe(true);
      // ...but the built-in label is not emitted under chrome: 'none'.
      expect(tableChrome?.querySelector('.superdoc-structured-content__label')).toBeFalsy();
    });

    it('should set overflow:visible when only rendered nested descendants have SDT chrome', () => {
      const descendantSdt: SdtMetadata = {
        type: 'structuredContent',
        scope: 'block',
        id: 'nested-descendant-sdt',
        alias: 'Nested Descendant',
      };
      const nestedParagraph: ParagraphBlock = {
        kind: 'paragraph',
        id: 'nested-descendant-sdt-para',
        runs: [{ text: 'Nested', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { sdt: descendantSdt },
      };
      const nestedTable: TableBlock = {
        kind: 'table',
        id: 'nested-table-with-descendant-sdt',
        rows: [
          {
            id: 'nested-descendant-row',
            cells: [
              {
                id: 'nested-descendant-cell',
                blocks: [nestedParagraph],
                attrs: {},
              },
            ],
          },
        ],
      };
      const nestedMeasure: TableMeasure = {
        kind: 'table',
        rows: [
          {
            height: 24,
            cells: [
              {
                width: 80,
                height: 24,
                gridColumnStart: 0,
                colSpan: 1,
                rowSpan: 1,
                blocks: [
                  {
                    kind: 'paragraph',
                    lines: [
                      {
                        fromRun: 0,
                        fromChar: 0,
                        toRun: 0,
                        toChar: 6,
                        width: 60,
                        ascent: 12,
                        descent: 4,
                        lineHeight: 20,
                      },
                    ],
                    totalHeight: 20,
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [80],
        totalWidth: 80,
        totalHeight: 24,
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure: {
          blocks: [nestedMeasure],
          width: 120,
          height: 40,
          gridColumnStart: 0,
          colSpan: 1,
          rowSpan: 1,
        },
        cell: {
          id: 'cell-nested-descendant-sdt',
          blocks: [nestedTable],
          attrs: {},
        },
      });

      expect(cellElement.style.overflow).toBe('visible');
      expect(cellElement.querySelector('.superdoc-structured-content__label')?.textContent).toBe('Nested Descendant');
    });

    it('should not apply nested table chrome when its SDT key matches the ancestor table SDT key', () => {
      const sharedSdt: SdtMetadata = {
        type: 'structuredContent',
        scope: 'block',
        id: 'ancestor-table-sdt',
        alias: 'Ancestor Table',
      };
      const nestedParagraph: ParagraphBlock = {
        kind: 'paragraph',
        id: 'nested-ancestor-sdt-para',
        runs: [{ text: 'Nested', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {},
      };
      const nestedTable: TableBlock = {
        kind: 'table',
        id: 'nested-ancestor-sdt-table',
        attrs: { sdt: sharedSdt },
        rows: [
          {
            id: 'nested-ancestor-row',
            cells: [
              {
                id: 'nested-ancestor-cell',
                blocks: [nestedParagraph],
                attrs: {},
              },
            ],
          },
        ],
      };
      const nestedMeasure: TableMeasure = {
        kind: 'table',
        rows: [
          {
            height: 24,
            cells: [
              {
                width: 80,
                height: 24,
                gridColumnStart: 0,
                colSpan: 1,
                rowSpan: 1,
                blocks: [
                  {
                    kind: 'paragraph',
                    lines: [
                      {
                        fromRun: 0,
                        fromChar: 0,
                        toRun: 0,
                        toChar: 6,
                        width: 60,
                        ascent: 12,
                        descent: 4,
                        lineHeight: 20,
                      },
                    ],
                    totalHeight: 20,
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [80],
        totalWidth: 80,
        totalHeight: 24,
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure: {
          blocks: [nestedMeasure],
          width: 120,
          height: 40,
          gridColumnStart: 0,
          colSpan: 1,
          rowSpan: 1,
        },
        cell: {
          id: 'cell-nested-ancestor-sdt-table',
          blocks: [nestedTable],
          attrs: {},
        },
        ancestorContainerKey: 'structuredContent:ancestor-table-sdt',
        ancestorContainerSdt: sharedSdt,
      });

      const tableElement = cellElement.querySelector('[data-block-id="nested-ancestor-sdt-table"]') as HTMLElement;
      expect(cellElement.style.overflow).toBe('hidden');
      expect(tableElement?.classList.contains('superdoc-structured-content-block')).toBe(false);
      expect(tableElement?.querySelector('.superdoc-structured-content__label')).toBeFalsy();
    });

    it('should preserve ancestor SDT suppression for paragraphs inside nested tables without table SDT', () => {
      const sharedSdt: SdtMetadata = {
        type: 'structuredContent',
        scope: 'block',
        id: 'outer-table-sdt',
        alias: 'Outer Table',
      };
      const nestedParagraph: ParagraphBlock = {
        kind: 'paragraph',
        id: 'nested-inherited-sdt-para',
        runs: [{ text: 'Nested', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { sdt: sharedSdt },
      };
      const nestedTable: TableBlock = {
        kind: 'table',
        id: 'nested-table-with-inherited-sdt-child',
        rows: [
          {
            id: 'nested-inherited-row',
            cells: [
              {
                id: 'nested-inherited-cell',
                blocks: [nestedParagraph],
                attrs: {},
              },
            ],
          },
        ],
      };
      const nestedMeasure: TableMeasure = {
        kind: 'table',
        rows: [
          {
            height: 24,
            cells: [
              {
                width: 80,
                height: 24,
                gridColumnStart: 0,
                colSpan: 1,
                rowSpan: 1,
                blocks: [
                  {
                    kind: 'paragraph',
                    lines: [
                      {
                        fromRun: 0,
                        fromChar: 0,
                        toRun: 0,
                        toChar: 6,
                        width: 60,
                        ascent: 12,
                        descent: 4,
                        lineHeight: 20,
                      },
                    ],
                    totalHeight: 20,
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [80],
        totalWidth: 80,
        totalHeight: 24,
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure: {
          blocks: [nestedMeasure],
          width: 120,
          height: 40,
          gridColumnStart: 0,
          colSpan: 1,
          rowSpan: 1,
        },
        cell: {
          id: 'cell-nested-table-inherited-sdt-child',
          blocks: [nestedTable],
          attrs: {},
        },
        ancestorContainerKey: 'structuredContent:outer-table-sdt',
        ancestorContainerSdt: sharedSdt,
      });

      expect(cellElement.querySelector('.superdoc-structured-content-block')).toBeFalsy();
      expect(cellElement.querySelector('.superdoc-structured-content__label')).toBeFalsy();
    });

    it('should allow overflow when a suppressed nested table contains distinct descendant SDT chrome', () => {
      const ancestorSdt: SdtMetadata = {
        type: 'structuredContent',
        scope: 'block',
        id: 'outer-table-sdt',
        alias: 'Outer Table',
      };
      const descendantSdt: SdtMetadata = {
        type: 'structuredContent',
        scope: 'block',
        id: 'descendant-sdt',
        alias: 'Descendant',
      };
      const nestedParagraph: ParagraphBlock = {
        kind: 'paragraph',
        id: 'nested-distinct-sdt-para',
        runs: [{ text: 'Nested', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { sdt: descendantSdt },
      };
      const nestedTable: TableBlock = {
        kind: 'table',
        id: 'nested-suppressed-table-with-distinct-child',
        attrs: { sdt: ancestorSdt },
        rows: [
          {
            id: 'nested-distinct-row',
            cells: [
              {
                id: 'nested-distinct-cell',
                blocks: [nestedParagraph],
                attrs: {},
              },
            ],
          },
        ],
      };
      const nestedMeasure: TableMeasure = {
        kind: 'table',
        rows: [
          {
            height: 24,
            cells: [
              {
                width: 80,
                height: 24,
                gridColumnStart: 0,
                colSpan: 1,
                rowSpan: 1,
                blocks: [
                  {
                    kind: 'paragraph',
                    lines: [
                      {
                        fromRun: 0,
                        fromChar: 0,
                        toRun: 0,
                        toChar: 6,
                        width: 60,
                        ascent: 12,
                        descent: 4,
                        lineHeight: 20,
                      },
                    ],
                    totalHeight: 20,
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [80],
        totalWidth: 80,
        totalHeight: 24,
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure: {
          blocks: [nestedMeasure],
          width: 120,
          height: 40,
          gridColumnStart: 0,
          colSpan: 1,
          rowSpan: 1,
        },
        cell: {
          id: 'cell-nested-distinct-sdt-child',
          blocks: [nestedTable],
          attrs: {},
        },
        ancestorContainerKey: 'structuredContent:outer-table-sdt',
        ancestorContainerSdt: ancestorSdt,
      });

      expect(cellElement.style.overflow).toBe('visible');
      expect(cellElement.querySelector('.superdoc-structured-content__label')?.textContent).toBe('Descendant');
    });

    it('should preserve outer ancestor suppression when a nested table has distinct SDT chrome', () => {
      const ancestorSdt: SdtMetadata = {
        type: 'structuredContent',
        scope: 'block',
        id: 'outer-table-sdt',
        alias: 'Outer Table',
      };
      const nestedTableSdt: SdtMetadata = {
        type: 'structuredContent',
        scope: 'block',
        id: 'nested-table-sdt',
        alias: 'Nested Table',
      };
      const nestedParagraph: ParagraphBlock = {
        kind: 'paragraph',
        id: 'nested-inherited-outer-sdt-para',
        runs: [{ text: 'Nested', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { containerSdt: ancestorSdt },
      };
      const nestedTable: TableBlock = {
        kind: 'table',
        id: 'nested-distinct-table-with-outer-child',
        attrs: { sdt: nestedTableSdt },
        rows: [
          {
            id: 'nested-outer-child-row',
            cells: [{ id: 'nested-outer-child-cell', blocks: [nestedParagraph], attrs: {} }],
          },
        ],
      };
      const nestedMeasure: TableMeasure = {
        kind: 'table',
        rows: [
          {
            height: 24,
            cells: [
              {
                width: 80,
                height: 24,
                gridColumnStart: 0,
                colSpan: 1,
                rowSpan: 1,
                blocks: [
                  {
                    kind: 'paragraph',
                    lines: [
                      {
                        fromRun: 0,
                        fromChar: 0,
                        toRun: 0,
                        toChar: 6,
                        width: 60,
                        ascent: 12,
                        descent: 4,
                        lineHeight: 20,
                      },
                    ],
                    totalHeight: 20,
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [80],
        totalWidth: 80,
        totalHeight: 24,
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure: {
          blocks: [nestedMeasure],
          width: 120,
          height: 40,
          gridColumnStart: 0,
          colSpan: 1,
          rowSpan: 1,
        },
        cell: {
          id: 'cell-nested-distinct-table-with-outer-child',
          blocks: [nestedTable],
          attrs: {},
        },
        ancestorContainerKey: 'structuredContent:outer-table-sdt',
        ancestorContainerSdt: ancestorSdt,
      });

      const labels = cellElement.querySelectorAll<HTMLElement>('.superdoc-structured-content__label');
      expect(labels).toHaveLength(1);
      expect(labels[0]?.textContent).toBe('Nested Table');
    });

    it('should keep overflow hidden when top-level SDT chrome is outside the rendered cell range', () => {
      const hiddenSdt: SdtMetadata = {
        type: 'structuredContent',
        scope: 'block',
        id: 'hidden-top-level-sdt',
        alias: 'Hidden',
      };
      const firstParagraph: ParagraphBlock = {
        kind: 'paragraph',
        id: 'visible-top-level-para',
        runs: [{ text: 'Visible', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {},
      };
      const secondParagraph: ParagraphBlock = {
        kind: 'paragraph',
        id: 'hidden-top-level-sdt-para',
        runs: [{ text: 'Hidden', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { sdt: hiddenSdt },
      };
      const paragraphMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 7,
            width: 60,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };
      let chromeNotifications = 0;

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure: {
          blocks: [paragraphMeasure, paragraphMeasure],
          width: 120,
          height: 20,
          gridColumnStart: 0,
          colSpan: 1,
          rowSpan: 1,
        },
        cell: {
          id: 'cell-partial-top-level-hidden-sdt',
          blocks: [firstParagraph, secondParagraph],
          attrs: {},
        },
        fromLine: 0,
        toLine: 1,
        onSdtContainerChrome: () => {
          chromeNotifications += 1;
        },
      });

      expect(cellElement.style.overflow).toBe('hidden');
      expect(cellElement.querySelector('.superdoc-structured-content__label')).toBeFalsy();
      expect(chromeNotifications).toBe(0);
    });

    it('should keep overflow hidden when descendant SDT chrome is outside the rendered nested table range', () => {
      const descendantSdt: SdtMetadata = {
        type: 'structuredContent',
        scope: 'block',
        id: 'unrendered-descendant-sdt',
        alias: 'Unrendered',
      };
      const firstParagraph: ParagraphBlock = {
        kind: 'paragraph',
        id: 'visible-nested-para',
        runs: [{ text: 'Visible', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {},
      };
      const secondParagraph: ParagraphBlock = {
        kind: 'paragraph',
        id: 'unrendered-nested-sdt-para',
        runs: [{ text: 'Hidden', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { sdt: descendantSdt },
      };
      const nestedTable: TableBlock = {
        kind: 'table',
        id: 'partial-nested-table-with-unrendered-sdt',
        rows: [
          {
            id: 'visible-nested-row',
            cells: [{ id: 'visible-nested-cell', blocks: [firstParagraph], attrs: {} }],
          },
          {
            id: 'unrendered-nested-row',
            cells: [{ id: 'unrendered-nested-cell', blocks: [secondParagraph], attrs: {} }],
          },
        ],
      };
      const paragraphMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 7,
            width: 60,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };
      const nestedMeasure: TableMeasure = {
        kind: 'table',
        rows: [
          {
            height: 20,
            cells: [
              {
                width: 80,
                height: 20,
                gridColumnStart: 0,
                colSpan: 1,
                rowSpan: 1,
                blocks: [paragraphMeasure],
              },
            ],
          },
          {
            height: 20,
            cells: [
              {
                width: 80,
                height: 20,
                gridColumnStart: 0,
                colSpan: 1,
                rowSpan: 1,
                blocks: [paragraphMeasure],
              },
            ],
          },
        ],
        columnWidths: [80],
        totalWidth: 80,
        totalHeight: 40,
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure: {
          blocks: [nestedMeasure],
          width: 120,
          height: 20,
          gridColumnStart: 0,
          colSpan: 1,
          rowSpan: 1,
        },
        cell: {
          id: 'cell-partial-nested-unrendered-sdt',
          blocks: [nestedTable],
          attrs: {},
        },
        fromLine: 0,
        toLine: 1,
      });

      expect(cellElement.style.overflow).toBe('hidden');
      expect(cellElement.querySelector('.superdoc-structured-content__label')).toBeFalsy();
    });

    it('should continue SDT boundaries across adjacent paragraph and nested table blocks', () => {
      const sharedSdt: SdtMetadata = {
        type: 'structuredContent',
        scope: 'block',
        id: 'shared-block-sdt',
        alias: 'Shared Block',
      };
      const paragraph: ParagraphBlock = {
        kind: 'paragraph',
        id: 'sdt-paragraph-before-table',
        runs: [{ text: 'Before', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { sdt: sharedSdt },
      };
      const nestedParagraph: ParagraphBlock = {
        kind: 'paragraph',
        id: 'nested-shared-sdt-para',
        runs: [{ text: 'Nested', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {},
      };
      const nestedTable: TableBlock = {
        kind: 'table',
        id: 'nested-shared-sdt-table',
        attrs: { sdt: sharedSdt },
        rows: [
          {
            id: 'nested-shared-row',
            cells: [
              {
                id: 'nested-shared-cell',
                blocks: [nestedParagraph],
                attrs: {},
              },
            ],
          },
        ],
      };
      const paragraphMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 6,
            width: 60,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };
      const nestedMeasure: TableMeasure = {
        kind: 'table',
        rows: [
          {
            height: 24,
            cells: [
              {
                width: 80,
                height: 24,
                gridColumnStart: 0,
                colSpan: 1,
                rowSpan: 1,
                blocks: [
                  {
                    kind: 'paragraph',
                    lines: [
                      {
                        fromRun: 0,
                        fromChar: 0,
                        toRun: 0,
                        toChar: 6,
                        width: 60,
                        ascent: 12,
                        descent: 4,
                        lineHeight: 20,
                      },
                    ],
                    totalHeight: 20,
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [80],
        totalWidth: 80,
        totalHeight: 24,
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure: {
          blocks: [paragraphMeasure, nestedMeasure],
          width: 120,
          height: 44,
          gridColumnStart: 0,
          colSpan: 1,
          rowSpan: 1,
        },
        cell: {
          id: 'cell-shared-sdt-paragraph-table',
          blocks: [paragraph, nestedTable],
          attrs: {},
        },
      });

      const chromeElements = cellElement.querySelectorAll<HTMLElement>('.superdoc-structured-content-block');
      const paragraphChrome = chromeElements[0];
      const tableChrome = cellElement.querySelector('[data-block-id="nested-shared-sdt-table"]') as HTMLElement;
      expect(chromeElements).toHaveLength(2);
      expect(paragraphChrome?.dataset.sdtContainerStart).toBe('true');
      expect(paragraphChrome?.dataset.sdtContainerEnd).toBe('false');
      expect(tableChrome?.dataset.sdtContainerStart).toBe('false');
      expect(tableChrome?.dataset.sdtContainerEnd).toBe('true');
      expect(tableChrome?.querySelector('.superdoc-structured-content__label')).toBeFalsy();
    });

    it('should not let media-only blocks consume SDT container start boundaries', () => {
      const sharedSdt: SdtMetadata = {
        type: 'structuredContent',
        scope: 'block',
        id: 'media-before-paragraph-sdt',
        alias: 'Media Container',
      };
      const imageBlock: ImageBlock = {
        kind: 'image',
        id: 'sdt-image-before-paragraph',
        src: 'data:image/png;base64,AAA',
        attrs: { sdt: sharedSdt },
      };
      const paragraph: ParagraphBlock = {
        kind: 'paragraph',
        id: 'sdt-paragraph-after-image',
        runs: [{ text: 'After image', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { sdt: sharedSdt },
      };
      const imageMeasure = {
        kind: 'image' as const,
        width: 40,
        height: 20,
      };
      const paragraphMeasure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 11,
            width: 70,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure: {
          blocks: [imageMeasure, paragraphMeasure],
          width: 120,
          height: 40,
          gridColumnStart: 0,
          colSpan: 1,
          rowSpan: 1,
        },
        cell: {
          id: 'cell-media-before-sdt-paragraph',
          blocks: [imageBlock, paragraph],
          attrs: {},
        },
      });

      const paragraphChrome = cellElement.querySelector<HTMLElement>('.superdoc-structured-content-block');
      expect(paragraphChrome?.dataset.sdtContainerStart).toBe('true');
      expect(paragraphChrome?.dataset.sdtContainerEnd).toBe('true');
      expect(paragraphChrome?.querySelector('.superdoc-structured-content__label')?.textContent).toBe(
        'Media Container',
      );
    });

    it('should continue SDT paragraph boundaries across split table-cell fragments', () => {
      const paragraphSdt: SdtMetadata = {
        type: 'structuredContent',
        scope: 'block',
        id: 'split-paragraph-sdt',
        alias: 'Split Paragraph',
      };
      const paragraph: ParagraphBlock = {
        kind: 'paragraph',
        id: 'split-sdt-paragraph',
        runs: [{ text: 'Split paragraph', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { sdt: paragraphSdt },
      };
      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 0,
            toChar: 5,
            width: 60,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
          {
            fromRun: 0,
            fromChar: 6,
            toRun: 0,
            toChar: 15,
            width: 80,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 40,
      };
      const cellMeasure: TableCellMeasure = {
        blocks: [measure],
        width: 120,
        height: 20,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };
      const cell: TableCell = {
        id: 'cell-split-sdt-paragraph',
        blocks: [paragraph],
        attrs: {},
      };

      const firstFragment = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
        fromLine: 0,
        toLine: 1,
      }).cellElement.querySelector<HTMLElement>('.superdoc-structured-content-block');
      const continuationFragment = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell,
        fromLine: 1,
        toLine: 2,
      }).cellElement.querySelector<HTMLElement>('.superdoc-structured-content-block');

      expect(firstFragment?.dataset.sdtContainerStart).toBe('true');
      expect(firstFragment?.dataset.sdtContainerEnd).toBe('false');
      expect(firstFragment?.querySelector('.superdoc-structured-content__label')?.textContent).toBe('Split Paragraph');
      expect(continuationFragment?.dataset.sdtContainerStart).toBe('false');
      expect(continuationFragment?.dataset.sdtContainerEnd).toBe('true');
      expect(continuationFragment?.querySelector('.superdoc-structured-content__label')).toBeFalsy();
    });

    it('should continue SDT boundaries across partial nested table renders', () => {
      const nestedTableSdt: SdtMetadata = {
        type: 'structuredContent',
        scope: 'block',
        id: 'partial-nested-table-sdt',
        alias: 'Partial Nested Table',
      };
      const nestedTable: TableBlock = {
        kind: 'table',
        id: 'partial-nested-table',
        attrs: { sdt: nestedTableSdt },
        rows: [
          {
            id: 'partial-nested-row-1',
            cells: [
              {
                id: 'partial-nested-cell-1',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'partial-nested-para-1',
                    runs: [{ text: 'One', fontFamily: 'Arial', fontSize: 16 }],
                  },
                ],
              },
            ],
          },
          {
            id: 'partial-nested-row-2',
            cells: [
              {
                id: 'partial-nested-cell-2',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'partial-nested-para-2',
                    runs: [{ text: 'Two', fontFamily: 'Arial', fontSize: 16 }],
                  },
                ],
              },
            ],
          },
        ],
      };
      const nestedMeasure: TableMeasure = {
        kind: 'table',
        rows: [
          {
            height: 20,
            cells: [
              {
                width: 80,
                height: 20,
                gridColumnStart: 0,
                colSpan: 1,
                rowSpan: 1,
                blocks: [
                  {
                    kind: 'paragraph',
                    lines: [
                      {
                        fromRun: 0,
                        fromChar: 0,
                        toRun: 0,
                        toChar: 3,
                        width: 30,
                        ascent: 12,
                        descent: 4,
                        lineHeight: 20,
                      },
                    ],
                    totalHeight: 20,
                  },
                ],
              },
            ],
          },
          {
            height: 20,
            cells: [
              {
                width: 80,
                height: 20,
                gridColumnStart: 0,
                colSpan: 1,
                rowSpan: 1,
                blocks: [
                  {
                    kind: 'paragraph',
                    lines: [
                      {
                        fromRun: 0,
                        fromChar: 0,
                        toRun: 0,
                        toChar: 3,
                        width: 30,
                        ascent: 12,
                        descent: 4,
                        lineHeight: 20,
                      },
                    ],
                    totalHeight: 20,
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [80],
        totalWidth: 80,
        totalHeight: 40,
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure: {
          blocks: [nestedMeasure],
          width: 120,
          height: 20,
          gridColumnStart: 0,
          colSpan: 1,
          rowSpan: 1,
        },
        cell: {
          id: 'cell-partial-nested-table-sdt',
          blocks: [nestedTable],
          attrs: {},
        },
        fromLine: 1,
        toLine: 2,
      });

      const tableChrome = cellElement.querySelector('[data-block-id="partial-nested-table"]') as HTMLElement;
      expect(tableChrome?.dataset.sdtContainerStart).toBe('false');
      expect(tableChrome?.dataset.sdtContainerEnd).toBe('true');
      expect(tableChrome?.querySelector('.superdoc-structured-content__label')).toBeFalsy();
    });
  });
});

/**
 * Sync test: renderer's getCellSegmentCount must agree with layout engine's getCellLines().length.
 *
 * These two systems must produce identical segment counts for every cell shape —
 * if they drift, pagination will render the wrong rows or skip content.
 */
describe('segment count sync: renderer vs layout engine', () => {
  const makeParagraph = (lineCount: number): ParagraphMeasure => ({
    kind: 'paragraph',
    lines: Array.from({ length: lineCount }, (_, i) => ({
      lineHeight: 20,
      width: 100,
      x: 0,
    })),
    indent: {} as ParagraphMeasure['indent'],
    height: lineCount * 20,
    width: 100,
  });

  const makeImage = (height: number) => ({
    kind: 'image' as const,
    width: 100,
    height,
    scale: 1,
  });

  it('simple paragraph cell', () => {
    const cell: TableCellMeasure = {
      blocks: [makeParagraph(5)],
      width: 200,
      height: 100,
    };
    expect(getCellSegmentCount(cell)).toBe(getCellLines(cell).length);
    expect(getCellSegmentCount(cell)).toBe(5);
  });

  it('legacy single-paragraph cell (no blocks array)', () => {
    const cell: TableCellMeasure = {
      paragraph: makeParagraph(3),
      width: 200,
      height: 60,
    };
    expect(getCellSegmentCount(cell)).toBe(getCellLines(cell).length);
    expect(getCellSegmentCount(cell)).toBe(3);
  });

  it('multi-block cell (paragraphs + image)', () => {
    const cell: TableCellMeasure = {
      blocks: [makeParagraph(2), makeImage(50), makeParagraph(3)],
      width: 200,
      height: 150,
    };
    expect(getCellSegmentCount(cell)).toBe(getCellLines(cell).length);
    // 2 lines + 1 image segment + 3 lines = 6
    expect(getCellSegmentCount(cell)).toBe(6);
  });

  it('cell with nested table (single level)', () => {
    const nestedTable: TableMeasure = {
      kind: 'table',
      rows: [
        { cells: [{ blocks: [makeParagraph(4)], width: 100, height: 80 }], height: 80 },
        { cells: [{ blocks: [makeParagraph(2)], width: 100, height: 40 }], height: 40 },
      ],
      columnWidths: [100],
      totalWidth: 100,
      totalHeight: 120,
    };
    const cell: TableCellMeasure = {
      blocks: [makeParagraph(1), nestedTable],
      width: 200,
      height: 140,
    };
    expect(getCellSegmentCount(cell)).toBe(getCellLines(cell).length);
    // 1 paragraph line + 1 (row1, no nested tables → single segment) + 1 (row2, same) = 3
    expect(getCellSegmentCount(cell)).toBe(3);
  });

  it('cell with deeply nested table (table-in-table)', () => {
    const innerTable: TableMeasure = {
      kind: 'table',
      rows: [{ cells: [{ blocks: [makeParagraph(3)], width: 80, height: 60 }], height: 60 }],
      columnWidths: [80],
      totalWidth: 80,
      totalHeight: 60,
    };
    const outerTable: TableMeasure = {
      kind: 'table',
      rows: [
        {
          cells: [{ blocks: [innerTable, makeParagraph(1)], width: 100, height: 80 }],
          height: 80,
        },
      ],
      columnWidths: [100],
      totalWidth: 100,
      totalHeight: 80,
    };
    const cell: TableCellMeasure = {
      blocks: [outerTable],
      width: 200,
      height: 80,
    };
    expect(getCellSegmentCount(cell)).toBe(getCellLines(cell).length);
    // outerTable has 1 row with nested table → expands recursively.
    // Tallest cell has: innerTable(1 row, no further nesting → 1 segment) + 1 paragraph line = 2
    // outerRow expands to 2 segments → cell total = 2
    expect(getCellSegmentCount(cell)).toBe(2);
  });

  it('empty cell', () => {
    const cell: TableCellMeasure = {
      blocks: [],
      width: 200,
      height: 0,
    };
    expect(getCellSegmentCount(cell)).toBe(getCellLines(cell).length);
    expect(getCellSegmentCount(cell)).toBe(0);
  });

  it('cell with triple-nested table (table-in-table-in-table, triggers recursive expansion)', () => {
    // Innermost table: 2 rows of simple paragraphs
    const innermostTable: TableMeasure = {
      kind: 'table',
      rows: [
        { cells: [{ blocks: [makeParagraph(2)], width: 60, height: 40 }], height: 40 },
        { cells: [{ blocks: [makeParagraph(3)], width: 60, height: 60 }], height: 60 },
      ],
      columnWidths: [60],
      totalWidth: 60,
      totalHeight: 100,
    };
    // Middle table: 1 row containing the innermost table (triggers expansion at this level)
    const middleTable: TableMeasure = {
      kind: 'table',
      rows: [
        {
          cells: [{ blocks: [innermostTable], width: 80, height: 100 }],
          height: 100,
        },
      ],
      columnWidths: [80],
      totalWidth: 80,
      totalHeight: 100,
    };
    // Outer table: 1 row containing the middle table (triggers expansion at outer level)
    const outerTable: TableMeasure = {
      kind: 'table',
      rows: [
        {
          cells: [{ blocks: [middleTable], width: 100, height: 100 }],
          height: 100,
        },
      ],
      columnWidths: [100],
      totalWidth: 100,
      totalHeight: 100,
    };
    const cell: TableCellMeasure = {
      blocks: [outerTable],
      width: 200,
      height: 100,
    };
    expect(getCellSegmentCount(cell)).toBe(getCellLines(cell).length);
    // Innermost: 2 rows, no further nesting → 1 segment each = 2 segments
    // Middle: 1 row with nested table → expands to tallest cell = 2 segments
    // Outer: 1 row with nested table → expands to tallest cell = 2 segments
    // Cell total = 2
    expect(getCellSegmentCount(cell)).toBe(2);
  });

  it('cell with zero-height image (should not count as segment)', () => {
    const cell: TableCellMeasure = {
      blocks: [makeParagraph(2), makeImage(0)],
      width: 200,
      height: 40,
    };
    expect(getCellSegmentCount(cell)).toBe(getCellLines(cell).length);
    // 2 lines + 0 (zero-height image skipped) = 2
    expect(getCellSegmentCount(cell)).toBe(2);
  });
});

describe('RTL cell padding swap', () => {
  let doc: Document;

  beforeEach(() => {
    doc = document.implementation.createHTMLDocument('table-cell-rtl');
  });

  const createBaseDeps = () => ({
    doc,
    x: 0,
    y: 0,
    rowHeight: 40,
    borders: undefined,
    useDefaultBorder: false,
    context: { sectionIndex: 0, pageIndex: 0, columnIndex: 0 },
    renderLine: () => doc.createElement('div'),
    applySdtDataset: () => {},
  });

  const cellMeasure: TableCellMeasure = {
    blocks: [
      {
        kind: 'paragraph' as const,
        lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 1, width: 10, ascent: 12, descent: 4, lineHeight: 20 }],
        totalHeight: 20,
      },
    ],
    width: 100,
    height: 20,
    gridColumnStart: 0,
    colSpan: 1,
    rowSpan: 1,
  };

  it('swaps asymmetric padding left↔right when isRtl is true', () => {
    const cell: TableCell = {
      id: 'rtl-cell' as unknown as import('@superdoc/contracts').BlockId,
      blocks: [{ kind: 'paragraph', id: 'p1', runs: [{ text: 'x', fontFamily: 'Arial', fontSize: 12 }] }],
      attrs: { padding: { top: 2, left: 3, right: 8, bottom: 2 } },
    };

    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      cellMeasure,
      cell,
      isRtl: true,
    });

    expect(cellElement.style.paddingLeft).toBe('8px');
    expect(cellElement.style.paddingRight).toBe('3px');
    expect(cellElement.style.paddingTop).toBe('2px');
    expect(cellElement.style.paddingBottom).toBe('2px');
  });

  it('does not swap padding when isRtl is false', () => {
    const cell: TableCell = {
      id: 'ltr-cell' as unknown as import('@superdoc/contracts').BlockId,
      blocks: [{ kind: 'paragraph', id: 'p1', runs: [{ text: 'x', fontFamily: 'Arial', fontSize: 12 }] }],
      attrs: { padding: { top: 2, left: 3, right: 8, bottom: 2 } },
    };

    const { cellElement } = renderTableCell({
      ...createBaseDeps(),
      cellMeasure,
      cell,
    });

    expect(cellElement.style.paddingLeft).toBe('3px');
    expect(cellElement.style.paddingRight).toBe('8px');
  });

  describe('v2 layout identity + source-anchor stamping', () => {
    // Self-contained fixtures (this describe is a sibling of the main suite).
    const localDoc = document.implementation.createHTMLDocument('table-cell-identity');
    const paragraphMeasure: ParagraphMeasure = {
      kind: 'paragraph',
      lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 1, width: 10, ascent: 12, descent: 4, lineHeight: 20 }],
      totalHeight: 20,
    };
    const baseCellMeasure: TableCellMeasure = {
      blocks: [paragraphMeasure],
      width: 80,
      height: 20,
      gridColumnStart: 0,
      colSpan: 1,
      rowSpan: 1,
    };
    const baseCell: TableCell = {
      id: 'cell-1-1' as unknown as import('@superdoc/contracts').BlockId,
      blocks: [{ kind: 'paragraph', id: 'para-1', runs: [{ text: '1', fontFamily: 'Arial', fontSize: 16 }] }],
      attrs: {},
    };
    const createBaseDeps = () => ({
      doc: localDoc,
      x: 0,
      y: 0,
      rowHeight: 40,
      borders: undefined,
      useDefaultBorder: false,
      context: { sectionIndex: 0, pageIndex: 0, columnIndex: 0 } as never,
      renderLine: () => localDoc.createElement('div'),
      applySdtDataset: () => {
        // noop for tests
      },
    });

    const anchoredParagraphBlock = (id: string, sourceNodeId: string): ParagraphBlock => ({
      kind: 'paragraph',
      id,
      runs: [{ text: 'Cell', fontFamily: 'Arial', fontSize: 16 }],
      sourceAnchor: { sourceNodeId },
    });

    /** First paragraph wrapper carrying the v2 layout identity dataset. */
    const firstIdentityWrapper = (cellElement: HTMLElement): HTMLElement => {
      const el = cellElement.querySelector<HTMLElement>('[data-layout-fragment-id]');
      expect(el).toBeTruthy();
      return el!;
    };

    it('stamps the cell paragraph wrapper with layout identity + source anchor', () => {
      const block = anchoredParagraphBlock('para-1', 'node-1');
      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure: baseCellMeasure,
        cell: { ...baseCell, blocks: [block] },
      });

      const wrapper = firstIdentityWrapper(cellElement);
      expect(wrapper.dataset.layoutFragmentId).toBe('body|para-1|para:0:1');
      expect(wrapper.dataset.layoutBlockRef).toBe('para-1');
      expect(wrapper.dataset.layoutStory).toBe('body');
      expect(wrapper.dataset.sourceAnchor).toBe(JSON.stringify(block.sourceAnchor));
      expect(wrapper.dataset.sourceNodeId).toBe('node-1');
    });

    it('does not stamp identity when the block has no sourceAnchor (v1 unchanged)', () => {
      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure: baseCellMeasure,
        cell: baseCell, // baseCell paragraph has no sourceAnchor
      });
      expect(cellElement.querySelector('[data-layout-fragment-id]')).toBeNull();
      expect(cellElement.querySelector('[data-source-anchor]')).toBeNull();
    });

    it('uses the body story for a body cell', () => {
      const block = anchoredParagraphBlock('para-body', 'node-body');
      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure: baseCellMeasure,
        cell: { ...baseCell, blocks: [block] },
      });
      expect(firstIdentityWrapper(cellElement).dataset.layoutStory).toBe('body');
    });

    it('uses the non-body story for a header/footer table cell when context.story is set', () => {
      const block = anchoredParagraphBlock('para-hdr', 'node-hdr');
      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        context: { sectionIndex: 0, pageIndex: 0, columnIndex: 0, story: { kind: 'header', id: 'rId4' } } as never,
        cellMeasure: baseCellMeasure,
        cell: { ...baseCell, blocks: [block] },
      });
      const wrapper = firstIdentityWrapper(cellElement);
      expect(wrapper.dataset.layoutStory).toBe('header:rId4');
      expect(wrapper.dataset.layoutFragmentId).toBe('header:rId4|para-hdr|para:0:1');
    });

    it('keeps the rendered line slice in the fragment identity for a split paragraph', () => {
      const block: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-split',
        runs: [{ text: 'Two line paragraph', fontFamily: 'Arial', fontSize: 16 }],
        sourceAnchor: { sourceNodeId: 'node-split' },
      };
      const measure: ParagraphMeasure = {
        kind: 'paragraph',
        lines: [
          { fromRun: 0, fromChar: 0, toRun: 0, toChar: 9, width: 80, ascent: 12, descent: 4, lineHeight: 20 },
          { fromRun: 0, fromChar: 9, toRun: 0, toChar: 18, width: 80, ascent: 12, descent: 4, lineHeight: 20 },
        ],
        totalHeight: 40,
      };
      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure: { ...baseCellMeasure, blocks: [measure], height: 40 },
        cell: { ...baseCell, blocks: [block] },
        fromLine: 1,
        toLine: 2,
      });
      // Rendering only the second visual line -> local slice [1, 2].
      expect(firstIdentityWrapper(cellElement).dataset.layoutFragmentId).toBe('body|para-split|para:1:2');
    });

    it('gives a nested table cell paragraph a distinct identity from the outer cell paragraph', () => {
      const outerPara = anchoredParagraphBlock('outer-para', 'node-outer');
      const innerPara = anchoredParagraphBlock('inner-para', 'node-inner');

      const nestedTable: TableBlock = {
        kind: 'table',
        id: 'nested-table',
        rows: [{ cells: [{ id: 'nested-cell', blocks: [innerPara], attrs: {} }] }],
        attrs: {},
      } as unknown as TableBlock;
      const nestedTableMeasure: TableMeasure = {
        kind: 'table',
        rows: [
          {
            height: 20,
            cells: [{ blocks: [paragraphMeasure], width: 60, height: 20, gridColumnStart: 0, colSpan: 1, rowSpan: 1 }],
          },
        ],
        columnWidths: [60],
        totalWidth: 60,
        height: 20,
      } as unknown as TableMeasure;

      const cellMeasure: TableCellMeasure = {
        blocks: [paragraphMeasure, nestedTableMeasure],
        width: 80,
        height: 40,
        gridColumnStart: 0,
        colSpan: 1,
        rowSpan: 1,
      };

      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        cellMeasure,
        cell: { ...baseCell, blocks: [outerPara, nestedTable] },
      });

      const ids = Array.from(cellElement.querySelectorAll<HTMLElement>('[data-layout-fragment-id]')).map(
        (el) => el.dataset.layoutFragmentId,
      );
      expect(ids).toContain('body|outer-para|para:0:1');
      expect(ids).toContain('body|inner-para|para:0:1');
      // The two identities are distinct.
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('keeps SDT datasets and source/layout datasets together on an SDT-wrapped cell paragraph', () => {
      const sdt = { id: 'sdt-1', tag: 'cell-control' } as unknown as SdtMetadata;
      const block: ParagraphBlock = {
        kind: 'paragraph',
        id: 'para-sdt',
        runs: [{ text: 'Controlled', fontFamily: 'Arial', fontSize: 16 }],
        sourceAnchor: { sourceNodeId: 'node-sdt' },
        attrs: { sdt },
      };
      const sdtCalls: Array<SdtMetadata | null | undefined> = [];
      const { cellElement } = renderTableCell({
        ...createBaseDeps(),
        applySdtDataset: (el, metadata) => {
          sdtCalls.push(metadata);
          if (el && metadata?.id) el.dataset.sdtId = metadata.id;
        },
        cellMeasure: baseCellMeasure,
        cell: { ...baseCell, blocks: [block] },
      });

      const wrapper = firstIdentityWrapper(cellElement);
      // Layout identity + source anchor are stamped...
      expect(wrapper.dataset.layoutFragmentId).toBe('body|para-sdt|para:0:1');
      expect(wrapper.dataset.sourceNodeId).toBe('node-sdt');
      // ...and the SDT dataset path still runs for the same paragraph.
      expect(sdtCalls.some((m) => m?.id === 'sdt-1')).toBe(true);
    });
  });
});
