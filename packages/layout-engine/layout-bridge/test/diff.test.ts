import { describe, it, expect } from 'vite-plus/test';
import type { ImageRun, ParagraphBlock, TableBlock, VectorShapeDrawing } from '@superdoc/contracts';
import { computeDirtyRegions } from '../src/diff';

const block = (id: string, text: string) => ({
  kind: 'paragraph' as const,
  id,
  runs: [{ text, fontFamily: 'Arial', fontSize: 16 }],
});

const imageRun = (src: string, width: number, height: number): ImageRun => ({
  kind: 'image',
  src,
  width,
  height,
});

const paragraphWithRuns = (id: string, runs: ParagraphBlock['runs']) => ({
  kind: 'paragraph' as const,
  id,
  runs,
});

const inlineBoxParagraph = (paddingInlineStart = 4, backgroundColor = '#eef2ff'): ParagraphBlock => ({
  ...block('inline-box-diff', 'Citation'),
  inlineBoxes: [
    {
      id: 'citation',
      from: 0,
      to: 8,
      layout: {
        paddingInlineStart,
        paddingInlineEnd: 4,
        paddingBlockStart: 1,
        paddingBlockEnd: 1,
        gapBefore: 1,
        gapAfter: 1,
        borderWidth: 1,
      },
      appearance: { backgroundColor, borderStyle: 'solid' },
    },
  ],
});

const drawing = (overrides?: Partial<VectorShapeDrawing>): VectorShapeDrawing => ({
  kind: 'drawing',
  id: 'drawing-0',
  drawingKind: 'vectorShape',
  geometry: { width: 60, height: 40, rotation: 0, flipH: false, flipV: false },
  margin: undefined,
  padding: undefined,
  anchor: { isAnchored: true, hRelativeFrom: 'page', vRelativeFrom: 'page', offsetH: 10, offsetV: 20 },
  wrap: { type: 'Square', distTop: 4, distBottom: 4, distLeft: 4, distRight: 4 },
  zIndex: 1,
  drawingContentId: 'shape-1',
  attrs: { pmStart: 100, pmEnd: 101 },
  shapeKind: 'rect',
  fillColor: '#f00',
  strokeColor: '#000',
  strokeWidth: 2,
  ...overrides,
});

const table = (text = 'Table text', overrides?: Partial<TableBlock>): TableBlock => ({
  kind: 'table',
  id: 'table-0',
  rows: [
    {
      id: 'row-0',
      cells: [
        {
          id: 'cell-0',
          blocks: [block('table-p', text)],
          attrs: { padding: { top: 2, right: 3, bottom: 4, left: 5 } },
        },
      ],
    },
  ],
  columnWidths: [120],
  ...overrides,
});

describe('computeDirtyRegions', () => {
  it('detects no changes', () => {
    const prev = [block('0-paragraph', 'Hello')];
    const next = [block('0-paragraph', 'Hello')];
    const result = computeDirtyRegions(prev, next);
    expect(result.firstDirtyIndex).toBe(next.length);
    expect(result.deletedBlockIds).toHaveLength(0);
    expect(result.insertedBlockIds).toHaveLength(0);
  });

  it('detects changed block', () => {
    const prev = [block('0-paragraph', 'Hello'), block('10-paragraph', 'World')];
    const next = [block('0-paragraph', 'Hello'), block('10-paragraph', 'World!')];
    const result = computeDirtyRegions(prev, next);
    expect(result.firstDirtyIndex).toBe(1);
    expect(result.lastStableIndex).toBe(0);
  });

  it('detects inline-box metric and appearance changes while retaining unrelated blocks', () => {
    const stable = block('stable', 'Unrelated');
    const metric = computeDirtyRegions([stable, inlineBoxParagraph()], [stable, inlineBoxParagraph(8)]);
    const appearance = computeDirtyRegions([stable, inlineBoxParagraph()], [stable, inlineBoxParagraph(4, '#ffffff')]);
    const identical = computeDirtyRegions([stable, inlineBoxParagraph()], [stable, inlineBoxParagraph()]);

    expect(metric.firstDirtyIndex).toBe(1);
    expect(metric.stableBlockIds).toContain('stable');
    expect(appearance.firstDirtyIndex).toBe(1);
    expect(identical.firstDirtyIndex).toBe(2);
  });

  it('detects insertion', () => {
    const prev = [block('0-paragraph', 'Hello')];
    const next = [block('0-paragraph', 'Hello'), block('20-paragraph', 'New')];
    const result = computeDirtyRegions(prev, next);
    expect(result.insertedBlockIds).toContain('20-paragraph');
    expect(result.firstDirtyIndex).toBe(1);
  });

  it('detects deletion', () => {
    const prev = [block('0-paragraph', 'Hello'), block('20-paragraph', 'Remove me')];
    const next = [block('0-paragraph', 'Hello')];
    const result = computeDirtyRegions(prev, next);
    expect(result.deletedBlockIds).toContain('20-paragraph');
  });

  it('detects fontSize changes', () => {
    const prev = [
      {
        kind: 'paragraph' as const,
        id: '0-paragraph',
        runs: [{ text: 'Hello', fontFamily: 'Arial', fontSize: 12 }],
      },
    ];
    const next = [
      {
        kind: 'paragraph' as const,
        id: '0-paragraph',
        runs: [{ text: 'Hello', fontFamily: 'Arial', fontSize: 24 }],
      },
    ];
    const result = computeDirtyRegions(prev, next);
    expect(result.firstDirtyIndex).toBe(0);
  });

  it('detects fontFamily changes', () => {
    const prev = [
      {
        kind: 'paragraph' as const,
        id: '0-paragraph',
        runs: [{ text: 'Hello', fontFamily: 'Arial', fontSize: 12 }],
      },
    ];
    const next = [
      {
        kind: 'paragraph' as const,
        id: '0-paragraph',
        runs: [{ text: 'Hello', fontFamily: 'Times New Roman', fontSize: 12 }],
      },
    ];
    const result = computeDirtyRegions(prev, next);
    expect(result.firstDirtyIndex).toBe(0);
  });

  it('detects underline changes', () => {
    const prev = [
      {
        kind: 'paragraph' as const,
        id: '0-paragraph',
        runs: [{ text: 'Hello', fontFamily: 'Arial', fontSize: 12, underline: { style: 'single' as const } }],
      },
    ];
    const next = [
      {
        kind: 'paragraph' as const,
        id: '0-paragraph',
        runs: [{ text: 'Hello', fontFamily: 'Arial', fontSize: 12 }],
      },
    ];
    const result = computeDirtyRegions(prev, next);
    expect(result.firstDirtyIndex).toBe(0);
  });

  it('detects hyperlink changes', () => {
    const prev = [
      {
        kind: 'paragraph' as const,
        id: '0-paragraph',
        runs: [
          {
            text: 'Hello',
            fontFamily: 'Arial',
            fontSize: 12,
            link: { href: 'https://example.com' } as any,
          },
        ],
      },
    ];
    const next = [
      {
        kind: 'paragraph' as const,
        id: '0-paragraph',
        runs: [{ text: 'Hello', fontFamily: 'Arial', fontSize: 12 }],
      },
    ];
    const result = computeDirtyRegions(prev, next);
    expect(result.firstDirtyIndex).toBe(0);
  });

  it('treats identical fontSize and fontFamily as stable', () => {
    const prev = [
      {
        kind: 'paragraph' as const,
        id: '0-paragraph',
        runs: [{ text: 'Hello', fontFamily: 'Arial', fontSize: 14, bold: true }],
      },
    ];
    const next = [
      {
        kind: 'paragraph' as const,
        id: '0-paragraph',
        runs: [{ text: 'Hello', fontFamily: 'Arial', fontSize: 14, bold: true }],
      },
    ];
    const result = computeDirtyRegions(prev, next);
    expect(result.firstDirtyIndex).toBe(next.length);
  });

  it('detects fontSize change from undefined to defined', () => {
    const prev = [
      {
        kind: 'paragraph' as const,
        id: '0-paragraph',
        runs: [{ text: 'Hello' }],
      },
    ];
    const next = [
      {
        kind: 'paragraph' as const,
        id: '0-paragraph',
        runs: [{ text: 'Hello', fontSize: 16 }],
      },
    ];
    const result = computeDirtyRegions(prev, next);
    expect(result.firstDirtyIndex).toBe(0);
  });

  it('detects inline image height changes inside paragraphs', () => {
    const prev = [paragraphWithRuns('0-paragraph', [imageRun('img.png', 100, 50)])];
    const next = [paragraphWithRuns('0-paragraph', [imageRun('img.png', 100, 60)])];
    const result = computeDirtyRegions(prev, next);
    expect(result.firstDirtyIndex).toBe(0);
    expect(result.stableBlockIds.has('0-paragraph')).toBe(false);
  });

  it('detects inline image width changes inside paragraphs', () => {
    const prev = [paragraphWithRuns('0-paragraph', [imageRun('img.png', 100, 50)])];
    const next = [paragraphWithRuns('0-paragraph', [imageRun('img.png', 120, 50)])];
    const result = computeDirtyRegions(prev, next);
    expect(result.firstDirtyIndex).toBe(0);
    expect(result.stableBlockIds.has('0-paragraph')).toBe(false);
  });

  it('treats identical inline image dimensions as stable', () => {
    const prev = [paragraphWithRuns('0-paragraph', [imageRun('img.png', 100, 50)])];
    const next = [paragraphWithRuns('0-paragraph', [imageRun('img.png', 100, 50)])];
    const result = computeDirtyRegions(prev, next);
    expect(result.firstDirtyIndex).toBe(next.length);
    expect(result.stableBlockIds.has('0-paragraph')).toBe(true);
  });

  it('detects textboxShape content changes as dirty', () => {
    const prev = [
      drawing({
        drawingKind: 'textboxShape',
        textContent: { parts: [{ text: 'Alpha', fontFamily: 'Arial', fontSize: 16 }] },
        contentBlocks: [
          {
            kind: 'paragraph',
            id: 'textbox-para-1',
            runs: [{ text: 'Alpha', fontFamily: 'Arial', fontSize: 16 }],
          },
        ],
      }),
    ];
    const next = [
      drawing({
        drawingKind: 'textboxShape',
        textContent: { parts: [{ text: 'Beta', fontFamily: 'Arial', fontSize: 16 }] },
        contentBlocks: [
          {
            kind: 'paragraph',
            id: 'textbox-para-1',
            runs: [{ text: 'Beta', fontFamily: 'Arial', fontSize: 16 }],
          },
        ],
      }),
    ];

    const result = computeDirtyRegions(prev, next);
    expect(result.firstDirtyIndex).toBe(0);
    expect(result.stableBlockIds.has('drawing-0')).toBe(false);
  });

  it.each([
    ['src', { src: 'other.png' }],
    ['alt', { alt: 'Diagram' }],
    ['title', { title: 'Title' }],
    ['clipPath', { clipPath: 'inset(1px)' }],
    ['distTop', { distTop: 1 }],
    ['distBottom', { distBottom: 2 }],
    ['distLeft', { distLeft: 3 }],
    ['distRight', { distRight: 4 }],
    ['verticalAlign', { verticalAlign: 'top' as const }],
    ['rotation', { rotation: 90 }],
    ['flipH', { flipH: true }],
    ['flipV', { flipV: true }],
    ['gain', { gain: '50000' }],
    ['blacklevel', { blacklevel: '20000' }],
    ['grayscale', { grayscale: true }],
    ['lum', { lum: { bright: 10000, contrast: -10000 } }],
    ['hyperlink', { hyperlink: { url: 'https://example.com', tooltip: 'Example' } }],
    ['dataAttrs', { dataAttrs: { 'data-example': '1' } }],
  ] satisfies Array<[string, Partial<ImageRun>]>)(
    'detects inline image %s changes inside paragraphs',
    (_field, overrides) => {
      const prev = [paragraphWithRuns('0-paragraph', [imageRun('img.png', 100, 50)])];
      const next = [paragraphWithRuns('0-paragraph', [{ ...imageRun('img.png', 100, 50), ...overrides }])];

      const result = computeDirtyRegions(prev, next);

      expect(result.firstDirtyIndex).toBe(0);
      expect(result.stableBlockIds.has('0-paragraph')).toBe(false);
    },
  );

  it('detects inline image SDT metadata changes inside paragraphs', () => {
    const prev = [paragraphWithRuns('0-paragraph', [imageRun('img.png', 100, 50)])];
    const next = [
      paragraphWithRuns('0-paragraph', [
        {
          ...imageRun('img.png', 100, 50),
          sdt: {
            type: 'structuredContent',
            scope: 'inline',
            id: 'image-sdt',
            lockMode: 'contentLocked',
          },
        },
      ]),
    ];

    const result = computeDirtyRegions(prev, next);

    expect(result.firstDirtyIndex).toBe(0);
    expect(result.stableBlockIds.has('0-paragraph')).toBe(false);
  });

  it('detects inline image resize in mixed text and image paragraphs', () => {
    const prev = [
      paragraphWithRuns('0-paragraph', [
        { text: 'Before ', fontFamily: 'Arial', fontSize: 16 },
        imageRun('img.png', 100, 50),
        { text: ' after', fontFamily: 'Arial', fontSize: 16 },
      ]),
    ];
    const next = [
      paragraphWithRuns('0-paragraph', [
        { text: 'Before ', fontFamily: 'Arial', fontSize: 16 },
        imageRun('img.png', 100, 60),
        { text: ' after', fontFamily: 'Arial', fontSize: 16 },
      ]),
    ];
    const result = computeDirtyRegions(prev, next);
    expect(result.firstDirtyIndex).toBe(0);
    expect(result.stableBlockIds.has('0-paragraph')).toBe(false);
  });

  it('detects changes to later inline image runs', () => {
    const prev = [paragraphWithRuns('0-paragraph', [imageRun('img1.png', 100, 50), imageRun('img2.png', 80, 40)])];
    const next = [paragraphWithRuns('0-paragraph', [imageRun('img1.png', 100, 50), imageRun('img2.png', 80, 60)])];
    const result = computeDirtyRegions(prev, next);
    expect(result.firstDirtyIndex).toBe(0);
    expect(result.stableBlockIds.has('0-paragraph')).toBe(false);
  });

  it('treats unchanged drawing blocks as stable', () => {
    const prev = [drawing()];
    const next = [drawing()];
    const result = computeDirtyRegions(prev, next);
    expect(result.firstDirtyIndex).toBe(next.length);
  });

  it('detects drawing geometry changes', () => {
    const prev = [drawing()];
    const next = [
      drawing({
        id: 'drawing-0',
        geometry: { width: 60, height: 40, rotation: 45, flipH: false, flipV: false },
      }),
    ];
    const result = computeDirtyRegions(prev, next);
    expect(result.firstDirtyIndex).toBe(0);
  });

  it('detects drawing style changes', () => {
    const prev = [drawing()];
    const next = [
      drawing({
        id: 'drawing-0',
        fillColor: '#0f0',
      }),
    ];
    const result = computeDirtyRegions(prev, next);
    expect(result.firstDirtyIndex).toBe(0);
  });

  it('treats structurally identical table blocks as stable', () => {
    const result = computeDirtyRegions([table()], [table()]);

    expect(result.firstDirtyIndex).toBe(1);
    expect(result.changedBlockIds).toEqual([]);
    expect(result.stableBlockIds.has('table-0')).toBe(true);
  });

  it('ignores PM-only shifts inside an otherwise unchanged table', () => {
    const previous = table();
    const next = table();
    const paragraph = next.rows[0]!.cells[0]!.blocks![0];
    if (paragraph.kind !== 'paragraph') throw new Error('expected paragraph');
    paragraph.runs[0] = { ...paragraph.runs[0]!, pmStart: 101, pmEnd: 111 };

    const result = computeDirtyRegions([previous], [next]);

    expect(result.firstDirtyIndex).toBe(1);
    expect(result.stableBlockIds.has('table-0')).toBe(true);
  });

  it('detects table-cell content and table geometry changes', () => {
    const contentResult = computeDirtyRegions([table()], [table('Changed')]);
    const geometryResult = computeDirtyRegions([table()], [table('Table text', { columnWidths: [180] })]);

    expect(contentResult.changedBlockIds).toEqual(['table-0']);
    expect(geometryResult.changedBlockIds).toEqual(['table-0']);
  });

  // ============================================================================
  // Paragraph Attribute Change Detection Tests
  // These tests verify that changes to paragraph-level attributes trigger
  // proper cache invalidation (the fix for alignment toolbar commands not
  // updating immediately).
  // ============================================================================

  describe('paragraph attribute changes', () => {
    const paragraphWithAttrs = (id: string, text: string, attrs: Record<string, unknown> = {}) => ({
      kind: 'paragraph' as const,
      id,
      runs: [{ text, fontFamily: 'Arial', fontSize: 16 }],
      attrs,
    });

    describe('alignment changes', () => {
      it('detects alignment change from left to center', () => {
        const prev = [paragraphWithAttrs('p1', 'Hello', { alignment: 'left' })];
        const next = [paragraphWithAttrs('p1', 'Hello', { alignment: 'center' })];
        const result = computeDirtyRegions(prev, next);
        expect(result.firstDirtyIndex).toBe(0);
      });

      it('detects alignment change from undefined to center', () => {
        const prev = [paragraphWithAttrs('p1', 'Hello', {})];
        const next = [paragraphWithAttrs('p1', 'Hello', { alignment: 'center' })];
        const result = computeDirtyRegions(prev, next);
        expect(result.firstDirtyIndex).toBe(0);
      });

      it('detects alignment change from center to right', () => {
        const prev = [paragraphWithAttrs('p1', 'Hello', { alignment: 'center' })];
        const next = [paragraphWithAttrs('p1', 'Hello', { alignment: 'right' })];
        const result = computeDirtyRegions(prev, next);
        expect(result.firstDirtyIndex).toBe(0);
      });

      it('detects alignment change from right to justify', () => {
        const prev = [paragraphWithAttrs('p1', 'Hello', { alignment: 'right' })];
        const next = [paragraphWithAttrs('p1', 'Hello', { alignment: 'justify' })];
        const result = computeDirtyRegions(prev, next);
        expect(result.firstDirtyIndex).toBe(0);
      });

      it('treats identical alignment as stable', () => {
        const prev = [paragraphWithAttrs('p1', 'Hello', { alignment: 'center' })];
        const next = [paragraphWithAttrs('p1', 'Hello', { alignment: 'center' })];
        const result = computeDirtyRegions(prev, next);
        expect(result.firstDirtyIndex).toBe(next.length);
      });
    });

    describe('spacing changes', () => {
      it('detects spacing.before change', () => {
        const prev = [paragraphWithAttrs('p1', 'Hello', { spacing: { before: 100 } })];
        const next = [paragraphWithAttrs('p1', 'Hello', { spacing: { before: 200 } })];
        const result = computeDirtyRegions(prev, next);
        expect(result.firstDirtyIndex).toBe(0);
      });

      it('detects spacing.after change', () => {
        const prev = [paragraphWithAttrs('p1', 'Hello', { spacing: { after: 100 } })];
        const next = [paragraphWithAttrs('p1', 'Hello', { spacing: { after: 200 } })];
        const result = computeDirtyRegions(prev, next);
        expect(result.firstDirtyIndex).toBe(0);
      });

      it('detects spacing.line change', () => {
        const prev = [paragraphWithAttrs('p1', 'Hello', { spacing: { line: 240 } })];
        const next = [paragraphWithAttrs('p1', 'Hello', { spacing: { line: 360 } })];
        const result = computeDirtyRegions(prev, next);
        expect(result.firstDirtyIndex).toBe(0);
      });

      it('detects spacing.lineRule change', () => {
        const prev = [paragraphWithAttrs('p1', 'Hello', { spacing: { lineRule: 'auto' } })];
        const next = [paragraphWithAttrs('p1', 'Hello', { spacing: { lineRule: 'exact' } })];
        const result = computeDirtyRegions(prev, next);
        expect(result.firstDirtyIndex).toBe(0);
      });

      it('treats identical spacing as stable', () => {
        const prev = [paragraphWithAttrs('p1', 'Hello', { spacing: { before: 100, after: 100, line: 240 } })];
        const next = [paragraphWithAttrs('p1', 'Hello', { spacing: { before: 100, after: 100, line: 240 } })];
        const result = computeDirtyRegions(prev, next);
        expect(result.firstDirtyIndex).toBe(next.length);
      });
    });

    describe('indent changes', () => {
      it('detects indent.left change', () => {
        const prev = [paragraphWithAttrs('p1', 'Hello', { indent: { left: 720 } })];
        const next = [paragraphWithAttrs('p1', 'Hello', { indent: { left: 1440 } })];
        const result = computeDirtyRegions(prev, next);
        expect(result.firstDirtyIndex).toBe(0);
      });

      it('detects indent.right change', () => {
        const prev = [paragraphWithAttrs('p1', 'Hello', { indent: { right: 0 } })];
        const next = [paragraphWithAttrs('p1', 'Hello', { indent: { right: 720 } })];
        const result = computeDirtyRegions(prev, next);
        expect(result.firstDirtyIndex).toBe(0);
      });

      it('detects indent.firstLine change', () => {
        const prev = [paragraphWithAttrs('p1', 'Hello', { indent: { firstLine: 0 } })];
        const next = [paragraphWithAttrs('p1', 'Hello', { indent: { firstLine: 720 } })];
        const result = computeDirtyRegions(prev, next);
        expect(result.firstDirtyIndex).toBe(0);
      });

      it('detects indent.hanging change', () => {
        const prev = [paragraphWithAttrs('p1', 'Hello', { indent: { hanging: 0 } })];
        const next = [paragraphWithAttrs('p1', 'Hello', { indent: { hanging: 360 } })];
        const result = computeDirtyRegions(prev, next);
        expect(result.firstDirtyIndex).toBe(0);
      });

      it('treats identical indent as stable', () => {
        const prev = [paragraphWithAttrs('p1', 'Hello', { indent: { left: 720, firstLine: 360 } })];
        const next = [paragraphWithAttrs('p1', 'Hello', { indent: { left: 720, firstLine: 360 } })];
        const result = computeDirtyRegions(prev, next);
        expect(result.firstDirtyIndex).toBe(next.length);
      });
    });

    describe('border changes', () => {
      it('detects border.top change', () => {
        const prev = [paragraphWithAttrs('p1', 'Hello', { borders: { top: { style: 'solid', width: 1 } } })];
        const next = [paragraphWithAttrs('p1', 'Hello', { borders: { top: { style: 'solid', width: 2 } } })];
        const result = computeDirtyRegions(prev, next);
        expect(result.firstDirtyIndex).toBe(0);
      });

      it('detects border color change', () => {
        const prev = [paragraphWithAttrs('p1', 'Hello', { borders: { bottom: { style: 'solid', color: '#000' } } })];
        const next = [paragraphWithAttrs('p1', 'Hello', { borders: { bottom: { style: 'solid', color: '#f00' } } })];
        const result = computeDirtyRegions(prev, next);
        expect(result.firstDirtyIndex).toBe(0);
      });

      it('detects border style change', () => {
        const prev = [paragraphWithAttrs('p1', 'Hello', { borders: { left: { style: 'solid' } } })];
        const next = [paragraphWithAttrs('p1', 'Hello', { borders: { left: { style: 'dashed' } } })];
        const result = computeDirtyRegions(prev, next);
        expect(result.firstDirtyIndex).toBe(0);
      });

      it('treats identical borders as stable', () => {
        const prev = [
          paragraphWithAttrs('p1', 'Hello', { borders: { top: { style: 'solid', width: 1, color: '#000' } } }),
        ];
        const next = [
          paragraphWithAttrs('p1', 'Hello', { borders: { top: { style: 'solid', width: 1, color: '#000' } } }),
        ];
        const result = computeDirtyRegions(prev, next);
        expect(result.firstDirtyIndex).toBe(next.length);
      });
    });

    describe('shading changes', () => {
      it('detects shading.fill change', () => {
        const prev = [paragraphWithAttrs('p1', 'Hello', { shading: { fill: '#fff' } })];
        const next = [paragraphWithAttrs('p1', 'Hello', { shading: { fill: '#ff0' } })];
        const result = computeDirtyRegions(prev, next);
        expect(result.firstDirtyIndex).toBe(0);
      });

      it('detects shading addition', () => {
        const prev = [paragraphWithAttrs('p1', 'Hello', {})];
        const next = [paragraphWithAttrs('p1', 'Hello', { shading: { fill: '#f0f0f0' } })];
        const result = computeDirtyRegions(prev, next);
        expect(result.firstDirtyIndex).toBe(0);
      });

      it('treats identical shading as stable', () => {
        const prev = [paragraphWithAttrs('p1', 'Hello', { shading: { fill: '#f0f0f0', color: '#000' } })];
        const next = [paragraphWithAttrs('p1', 'Hello', { shading: { fill: '#f0f0f0', color: '#000' } })];
        const result = computeDirtyRegions(prev, next);
        expect(result.firstDirtyIndex).toBe(next.length);
      });
    });

    describe('tab stop changes', () => {
      it('detects tab stop addition', () => {
        const prev = [paragraphWithAttrs('p1', 'Hello', { tabs: [] })];
        const next = [paragraphWithAttrs('p1', 'Hello', { tabs: [{ val: 'center', pos: 4320 }] })];
        const result = computeDirtyRegions(prev, next);
        expect(result.firstDirtyIndex).toBe(0);
      });

      it('detects tab stop position change', () => {
        const prev = [paragraphWithAttrs('p1', 'Hello', { tabs: [{ val: 'start', pos: 720 }] })];
        const next = [paragraphWithAttrs('p1', 'Hello', { tabs: [{ val: 'start', pos: 1440 }] })];
        const result = computeDirtyRegions(prev, next);
        expect(result.firstDirtyIndex).toBe(0);
      });

      it('detects tab stop type change', () => {
        const prev = [paragraphWithAttrs('p1', 'Hello', { tabs: [{ val: 'start', pos: 720 }] })];
        const next = [paragraphWithAttrs('p1', 'Hello', { tabs: [{ val: 'center', pos: 720 }] })];
        const result = computeDirtyRegions(prev, next);
        expect(result.firstDirtyIndex).toBe(0);
      });

      it('detects tab stop leader change', () => {
        const prev = [paragraphWithAttrs('p1', 'Hello', { tabs: [{ val: 'end', pos: 8640, leader: 'none' }] })];
        const next = [paragraphWithAttrs('p1', 'Hello', { tabs: [{ val: 'end', pos: 8640, leader: 'dot' }] })];
        const result = computeDirtyRegions(prev, next);
        expect(result.firstDirtyIndex).toBe(0);
      });

      it('treats identical tabs as stable', () => {
        const prev = [paragraphWithAttrs('p1', 'Hello', { tabs: [{ val: 'center', pos: 4320, leader: 'dot' }] })];
        const next = [paragraphWithAttrs('p1', 'Hello', { tabs: [{ val: 'center', pos: 4320, leader: 'dot' }] })];
        const result = computeDirtyRegions(prev, next);
        expect(result.firstDirtyIndex).toBe(next.length);
      });
    });

    describe('other paragraph attribute changes', () => {
      it('detects direction change', () => {
        const prev = [
          paragraphWithAttrs('p1', 'Hello', {
            directionContext: { inlineDirection: 'ltr', writingMode: 'horizontal-tb' },
          }),
        ];
        const next = [
          paragraphWithAttrs('p1', 'Hello', {
            directionContext: { inlineDirection: 'rtl', writingMode: 'horizontal-tb' },
          }),
        ];
        const result = computeDirtyRegions(prev, next);
        expect(result.firstDirtyIndex).toBe(0);
      });

      it('detects keepNext change', () => {
        const prev = [paragraphWithAttrs('p1', 'Hello', { keepNext: false })];
        const next = [paragraphWithAttrs('p1', 'Hello', { keepNext: true })];
        const result = computeDirtyRegions(prev, next);
        expect(result.firstDirtyIndex).toBe(0);
      });

      it('detects keepLines change', () => {
        const prev = [paragraphWithAttrs('p1', 'Hello', { keepLines: false })];
        const next = [paragraphWithAttrs('p1', 'Hello', { keepLines: true })];
        const result = computeDirtyRegions(prev, next);
        expect(result.firstDirtyIndex).toBe(0);
      });

      it('detects floatAlignment change', () => {
        const prev = [paragraphWithAttrs('p1', 'Hello', { floatAlignment: 'left' })];
        const next = [paragraphWithAttrs('p1', 'Hello', { floatAlignment: 'center' })];
        const result = computeDirtyRegions(prev, next);
        expect(result.firstDirtyIndex).toBe(0);
      });

      it('detects contextualSpacing change', () => {
        const prev = [paragraphWithAttrs('p1', 'Hello', { contextualSpacing: false })];
        const next = [paragraphWithAttrs('p1', 'Hello', { contextualSpacing: true })];
        const result = computeDirtyRegions(prev, next);
        expect(result.firstDirtyIndex).toBe(0);
      });
    });

    describe('combined attribute changes', () => {
      it('detects multiple attribute changes at once', () => {
        const prev = [paragraphWithAttrs('p1', 'Hello', { alignment: 'left', spacing: { before: 100 } })];
        const next = [paragraphWithAttrs('p1', 'Hello', { alignment: 'center', spacing: { before: 200 } })];
        const result = computeDirtyRegions(prev, next);
        expect(result.firstDirtyIndex).toBe(0);
      });

      it('treats complex identical paragraphs as stable', () => {
        const complexAttrs = {
          alignment: 'justify' as const,
          spacing: { before: 100, after: 100, line: 276, lineRule: 'auto' as const },
          indent: { left: 720, right: 0, firstLine: 360 },
          borders: {
            top: { style: 'solid' as const, width: 1, color: '#000' },
            bottom: { style: 'solid' as const, width: 1, color: '#000' },
          },
          shading: { fill: '#f0f0f0' },
          tabs: [
            { val: 'center' as const, pos: 4320 },
            { val: 'end' as const, pos: 8640, leader: 'dot' as const },
          ],
          keepNext: true,
          directionContext: { inlineDirection: 'ltr' as const, writingMode: 'horizontal-tb' as const },
        };
        const prev = [paragraphWithAttrs('p1', 'Hello', complexAttrs)];
        const next = [paragraphWithAttrs('p1', 'Hello', complexAttrs)];
        const result = computeDirtyRegions(prev, next);
        expect(result.firstDirtyIndex).toBe(next.length);
      });
    });

    describe('non-visual attributes (should not trigger invalidation)', () => {
      it('ignores sdt metadata changes', () => {
        const prev = [paragraphWithAttrs('p1', 'Hello', { sdt: { id: '1', tag: 'field1' } })];
        const next = [paragraphWithAttrs('p1', 'Hello', { sdt: { id: '2', tag: 'field2' } })];
        const result = computeDirtyRegions(prev, next);
        // sdt is non-visual metadata, should not trigger invalidation
        expect(result.firstDirtyIndex).toBe(next.length);
      });

      it('ignores wordLayout changes (computed output)', () => {
        const prev = [paragraphWithAttrs('p1', 'Hello', { wordLayout: { lines: 1 } })];
        const next = [paragraphWithAttrs('p1', 'Hello', { wordLayout: { lines: 2 } })];
        const result = computeDirtyRegions(prev, next);
        // wordLayout is computed output, should not trigger invalidation
        expect(result.firstDirtyIndex).toBe(next.length);
      });

      it('ignores styleId changes (resolved before FlowBlock)', () => {
        const prev = [paragraphWithAttrs('p1', 'Hello', { styleId: 'Heading1' })];
        const next = [paragraphWithAttrs('p1', 'Hello', { styleId: 'Heading2' })];
        const result = computeDirtyRegions(prev, next);
        // styleId is resolved before FlowBlock, should not trigger invalidation
        expect(result.firstDirtyIndex).toBe(next.length);
      });
    });
  });
});

describe('small-caps dirty regions', () => {
  it('marks a paragraph dirty when only small caps changes', () => {
    const plain: ParagraphBlock = {
      kind: 'paragraph',
      id: 'small-caps-diff',
      runs: [{ text: 'Test ', fontFamily: 'Arial', fontSize: 16 }],
    };
    const caps: ParagraphBlock = {
      ...plain,
      runs: [{ text: 'Test ', fontFamily: 'Arial', fontSize: 16, smallCaps: true }],
    };
    expect(computeDirtyRegions([plain], [caps]).firstDirtyIndex).toBe(0);
  });
});
