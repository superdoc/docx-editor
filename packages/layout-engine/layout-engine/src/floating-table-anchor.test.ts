import { describe, expect, it } from 'vite-plus/test';
import type { FlowBlock, Measure, TableBlock, TableMeasure } from '@superdoc/contracts';
import { isAnchoredTableFullWidth, resolveFloatingTableAnchorResolution } from './floating-table-anchor.js';

describe('floating-table-anchor', () => {
  const makeParaMeasure = (height: number) => ({
    kind: 'paragraph' as const,
    lines: [
      {
        fromRun: 0,
        fromChar: 0,
        toRun: 0,
        toChar: 0,
        width: 100,
        ascent: height * 0.8,
        descent: height * 0.2,
        lineHeight: height,
      },
    ],
    totalHeight: height,
  });

  const makeFloatingTable = (id: string, offsetV: number, wrap?: TableBlock['wrap']): TableBlock => ({
    kind: 'table',
    id,
    rows: [
      {
        id: `${id}-row`,
        cells: [{ id: `${id}-cell`, paragraph: { kind: 'paragraph', id: `${id}-p`, runs: [] } }],
      },
    ],
    anchor: { isAnchored: true, vRelativeFrom: 'paragraph', offsetV },
    wrap: wrap ?? { type: 'None' },
  });

  describe('isAnchoredTableFullWidth', () => {
    it('uses wrap distances from the document instead of a fixed slack constant', () => {
      const block = makeFloatingTable('exhibit', 0, {
        type: 'Square',
        distLeft: 12,
        distRight: 12,
      });
      const measure = {
        kind: 'table',
        rows: [],
        columnWidths: [30, 618],
        totalWidth: 647.8,
        totalHeight: 612,
      } as TableMeasure;

      expect(isAnchoredTableFullWidth(block, measure, 672)).toBe(true);
    });

    it('ignores None-wrap distances when checking whether an anchored table is full width', () => {
      const block = makeFloatingTable('overlay', 0, {
        type: 'None',
        distLeft: 12,
        distRight: 12,
      });
      const measure = {
        kind: 'table',
        rows: [],
        columnWidths: [30, 618],
        totalWidth: 647.8,
        totalHeight: 612,
      } as TableMeasure;

      expect(isAnchoredTableFullWidth(block, measure, 672)).toBe(false);
    });

    it('does not treat narrow form fields as full width', () => {
      const block = makeFloatingTable('field', 3.8);
      const measure = {
        kind: 'table',
        rows: [],
        columnWidths: [100],
        totalWidth: 100,
        totalHeight: 14,
      } as TableMeasure;

      expect(isAnchoredTableFullWidth(block, measure, 468)).toBe(false);
    });

    it('keeps page-bottom-aligned 100% tables on the floating path', () => {
      const block = makeFloatingTable('bottom-pct', 0, { type: 'Square' });
      block.anchor = { isAnchored: true, vRelativeFrom: 'page', alignV: 'bottom' };
      block.attrs = { tableWidth: { width: 5000, type: 'pct' } };
      const measure = {
        kind: 'table',
        rows: [],
        columnWidths: [640],
        totalWidth: 640,
        totalHeight: 100,
      } as TableMeasure;

      expect(isAnchoredTableFullWidth(block, measure, 672)).toBe(false);
    });

    it('treats 100% pct tableWidth as full width when measured width is under the ratio threshold', () => {
      const block = makeFloatingTable('exhibit-pct', 0, { type: 'Square' });
      block.attrs = { tableWidth: { width: 5000, type: 'pct' } };
      const measure = {
        kind: 'table',
        rows: [],
        columnWidths: [640],
        totalWidth: 640,
        totalHeight: 100,
      } as TableMeasure;

      // Measured width + slack stays below columnWidth * 0.99 without the pct shortcut.
      expect(640 + 0.5 < 672 * 0.99).toBe(true);
      expect(isAnchoredTableFullWidth(block, measure, 672)).toBe(true);
    });
  });

  describe('resolveFloatingTableAnchorResolution', () => {
    const paragraphIndexById = new Map<string, number>();

    it('does not mark lineScopedOnAnchor for empty anchor paragraphs (square table after paragraph box)', () => {
      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'para-1', runs: [] },
        makeFloatingTable('table-98', 0, { type: 'Square' }),
      ];
      const measures: Measure[] = [
        makeParaMeasure(20),
        { kind: 'table', rows: [], columnWidths: [490], totalWidth: 490, totalHeight: 40 } as TableMeasure,
      ];

      const resolution = resolveFloatingTableAnchorResolution(
        blocks,
        measures,
        blocks.length,
        1,
        blocks[1] as TableBlock,
        new Map(),
      );

      expect(resolution?.paragraphIndex).toBe(0);
      expect(resolution?.lineScopedOnAnchor).toBe(false);
    });

    it('prefers explicit anchorParagraphId from import', () => {
      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'spacer', runs: [] },
        makeFloatingTable('wrap-table', 0.07),
        { kind: 'paragraph', id: 'wrap-text', runs: [{ text: 'Text to right of the table' }] },
      ];
      blocks[1].attrs = { anchorParagraphId: 'wrap-text' };
      paragraphIndexById.set('wrap-text', 2);

      const measures: Measure[] = [
        makeParaMeasure(18),
        { kind: 'table', rows: [], columnWidths: [100], totalWidth: 100, totalHeight: 14 } as TableMeasure,
        makeParaMeasure(22),
      ];

      const resolution = resolveFloatingTableAnchorResolution(
        blocks,
        measures,
        blocks.length,
        1,
        blocks[1] as TableBlock,
        paragraphIndexById,
      );
      expect(resolution).toEqual({ paragraphIndex: 2, offsetV: 0.07, lineScopedOnAnchor: true });
    });

    it('anchors a line-scoped field beside a label after empty spacers (notification AUD$ field)', () => {
      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'spacer-1', runs: [] },
        { kind: 'paragraph', id: 'spacer-2', runs: [] },
        makeFloatingTable('aud-field', 0.27),
        { kind: 'paragraph', id: 'aud-label', runs: [{ text: 'AUD$ ' }] },
      ];
      const measures: Measure[] = [
        makeParaMeasure(12),
        makeParaMeasure(12),
        { kind: 'table', rows: [], columnWidths: [100], totalWidth: 100, totalHeight: 30 } as TableMeasure,
        makeParaMeasure(17),
      ];

      const resolution = resolveFloatingTableAnchorResolution(
        blocks,
        measures,
        blocks.length,
        2,
        blocks[2] as TableBlock,
        new Map(),
      );

      expect(resolution).toEqual({ paragraphIndex: 3, offsetV: 0.27, lineScopedOnAnchor: true });
    });

    it('uses paragraph totalHeight when the first measured line height is zero', () => {
      const blocks: FlowBlock[] = [
        makeFloatingTable('field', 15),
        { kind: 'paragraph', id: 'label', runs: [{ text: 'Label' }] },
      ];
      const paragraphMeasure = makeParaMeasure(20);
      paragraphMeasure.lines[0].lineHeight = 0;
      const measures: Measure[] = [
        { kind: 'table', rows: [], columnWidths: [100], totalWidth: 100, totalHeight: 30 } as TableMeasure,
        paragraphMeasure,
      ];

      const resolution = resolveFloatingTableAnchorResolution(
        blocks,
        measures,
        blocks.length,
        0,
        blocks[0] as TableBlock,
        new Map(),
      );

      expect(resolution?.lineScopedOnAnchor).toBe(true);
    });

    it('does not mark lineScopedOnAnchor for page-relative anchors', () => {
      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'label', runs: [{ text: 'Label' }] },
        {
          ...makeFloatingTable('page-field', 0.27),
          anchor: { isAnchored: true, vRelativeFrom: 'page', offsetV: 0.27 },
        },
      ];
      const measures: Measure[] = [
        makeParaMeasure(17),
        { kind: 'table', rows: [], columnWidths: [100], totalWidth: 100, totalHeight: 30 } as TableMeasure,
      ];

      const resolution = resolveFloatingTableAnchorResolution(
        blocks,
        measures,
        blocks.length,
        1,
        blocks[1] as TableBlock,
        new Map(),
      );

      expect(resolution?.lineScopedOnAnchor).toBe(false);
    });

    it('anchors to the next regular paragraph and preserves a large tblpY', () => {
      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'info', runs: [{ text: 'Long body copy.' }] },
        makeFloatingTable('field-1', 3.8),
        { kind: 'paragraph', id: 'yes-1', runs: [{ text: 'Yes' }] },
        { kind: 'paragraph', id: 'no-1', runs: [{ text: 'No' }] },
        makeFloatingTable('field-2', 56),
        { kind: 'paragraph', id: 'heading', runs: [{ text: 'Next question heading text.' }] },
        { kind: 'paragraph', id: 'yes-2', runs: [{ text: 'Yes – Please specify the assistance required' }] },
      ];
      const measures: Measure[] = [
        makeParaMeasure(67),
        { kind: 'table', rows: [], columnWidths: [100], totalWidth: 100, totalHeight: 14 } as TableMeasure,
        makeParaMeasure(17),
        makeParaMeasure(17),
        { kind: 'table', rows: [], columnWidths: [100], totalWidth: 100, totalHeight: 14 } as TableMeasure,
        makeParaMeasure(36),
        makeParaMeasure(17),
      ];

      const resolution = resolveFloatingTableAnchorResolution(
        blocks,
        measures,
        blocks.length,
        4,
        blocks[4] as TableBlock,
        new Map(),
      );

      expect(resolution?.paragraphIndex).toBe(5);
      expect(resolution?.offsetV).toBe(56);
      expect(resolution?.lineScopedOnAnchor).toBe(false);
    });

    it('anchors the Form F3 hearing-loop field to the following heading with the raw offset', () => {
      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'info', runs: [{ text: 'Long body copy.' }] },
        makeFloatingTable('field-1', 3.8),
        { kind: 'paragraph', id: 'yes-prev', runs: [{ text: '☐ Yes – Specify language' }] },
        { kind: 'paragraph', id: 'no-prev', runs: [{ text: '☐ No' }] },
        makeFloatingTable('field-2', 56.27),
        {
          kind: 'paragraph',
          id: 'heading',
          runs: [
            {
              text: 'Does the employer require any special assistance at the hearing or conference (eg a hearing loop)?',
            },
          ],
        },
        { kind: 'paragraph', id: 'yes-2', runs: [{ text: '☐ Yes – Please specify the assistance required' }] },
        { kind: 'paragraph', id: 'no-2', runs: [{ text: '☐ No' }] },
      ];
      const measures: Measure[] = [
        makeParaMeasure(67),
        { kind: 'table', rows: [], columnWidths: [100], totalWidth: 100, totalHeight: 14 } as TableMeasure,
        makeParaMeasure(16.866666666666664),
        makeParaMeasure(16.866666666666664),
        { kind: 'table', rows: [], columnWidths: [100], totalWidth: 100, totalHeight: 14 } as TableMeasure,
        makeParaMeasure(36.96875),
        makeParaMeasure(16.866666666666664),
        makeParaMeasure(16.866666666666664),
      ];

      const resolution = resolveFloatingTableAnchorResolution(
        blocks,
        measures,
        blocks.length,
        4,
        blocks[4] as TableBlock,
        new Map(),
      );

      expect(resolution?.paragraphIndex).toBe(5);
      expect(resolution?.offsetV).toBe(56.27);
      expect(resolution?.lineScopedOnAnchor).toBe(false);
    });

    it('uses an empty following paragraph as an anchor', () => {
      const blocks: FlowBlock[] = [makeFloatingTable('field', 8), { kind: 'paragraph', id: 'empty', runs: [] }];
      const measures: Measure[] = [
        { kind: 'table', rows: [], columnWidths: [100], totalWidth: 100, totalHeight: 14 } as TableMeasure,
        makeParaMeasure(17),
      ];

      const resolution = resolveFloatingTableAnchorResolution(
        blocks,
        measures,
        blocks.length,
        0,
        blocks[0] as TableBlock,
        new Map(),
      );

      expect(resolution).toEqual({ paragraphIndex: 1, offsetV: 8, lineScopedOnAnchor: false });
    });

    it('uses an overlay-framed paragraph as the following authored anchor', () => {
      const blocks: FlowBlock[] = [
        makeFloatingTable('field', 8),
        { kind: 'paragraph', id: 'frame', runs: [{ text: 'Positioned frame' }], attrs: { frame: { wrap: 'none' } } },
        { kind: 'paragraph', id: 'regular', runs: [{ text: 'Regular paragraph' }] },
      ];
      const measures: Measure[] = [
        { kind: 'table', rows: [], columnWidths: [100], totalWidth: 100, totalHeight: 14 } as TableMeasure,
        makeParaMeasure(17),
        makeParaMeasure(17),
      ];

      const resolution = resolveFloatingTableAnchorResolution(
        blocks,
        measures,
        blocks.length,
        0,
        blocks[0] as TableBlock,
        new Map(),
      );

      expect(resolution?.paragraphIndex).toBe(1);
      expect(resolution?.offsetV).toBe(8);
    });

    it('skips an invisible paragraph that only carries a forced section break', () => {
      const blocks: FlowBlock[] = [
        makeFloatingTable('field', 8),
        { kind: 'paragraph', id: 'marker', runs: [], attrs: { sectPrMarker: true } },
        { kind: 'sectionBreak', id: 'break', type: 'nextPage' },
        { kind: 'paragraph', id: 'regular', runs: [{ text: 'Regular paragraph' }] },
      ];
      const measures: Measure[] = [
        { kind: 'table', rows: [], columnWidths: [100], totalWidth: 100, totalHeight: 14 } as TableMeasure,
        makeParaMeasure(0),
        { kind: 'sectionBreak' },
        makeParaMeasure(17),
      ];

      const resolution = resolveFloatingTableAnchorResolution(
        blocks,
        measures,
        blocks.length,
        0,
        blocks[0] as TableBlock,
        new Map(),
      );

      expect(resolution?.paragraphIndex).toBe(3);
    });

    it('skips an empty paragraph omitted between a page break and section break', () => {
      const blocks: FlowBlock[] = [
        makeFloatingTable('field', 8),
        { kind: 'pageBreak', id: 'page-break' },
        { kind: 'paragraph', id: 'boundary-empty', runs: [] },
        { kind: 'sectionBreak', id: 'section-break', type: 'continuous' },
        { kind: 'paragraph', id: 'regular', runs: [{ text: 'Regular paragraph' }] },
      ];
      const measures: Measure[] = [
        { kind: 'table', rows: [], columnWidths: [100], totalWidth: 100, totalHeight: 14 } as TableMeasure,
        { kind: 'pageBreak' },
        makeParaMeasure(17),
        { kind: 'sectionBreak' },
        makeParaMeasure(17),
      ];

      const resolution = resolveFloatingTableAnchorResolution(
        blocks,
        measures,
        blocks.length,
        0,
        blocks[0] as TableBlock,
        new Map(),
      );

      expect(resolution?.paragraphIndex).toBe(4);
    });

    it('allows a reviewable section marker to remain the anchor paragraph', () => {
      const blocks: FlowBlock[] = [
        makeFloatingTable('field', 8),
        { kind: 'pageBreak', id: 'page-break' },
        {
          kind: 'paragraph',
          id: 'reviewable-marker',
          runs: [],
          attrs: {
            sectPrMarker: true,
            paragraphMarkTrackedChange: {
              id: 'change',
              kind: 'insert',
              type: 'structural',
              targetKind: 'section-break',
            },
          },
        },
        { kind: 'sectionBreak', id: 'section-break', type: 'nextPage' },
      ];
      const measures: Measure[] = [
        { kind: 'table', rows: [], columnWidths: [100], totalWidth: 100, totalHeight: 14 } as TableMeasure,
        { kind: 'pageBreak' },
        makeParaMeasure(17),
        { kind: 'sectionBreak' },
      ];

      const resolution = resolveFloatingTableAnchorResolution(
        blocks,
        measures,
        blocks.length,
        0,
        blocks[0] as TableBlock,
        new Map(),
      );

      expect(resolution?.paragraphIndex).toBe(2);
    });

    it('preserves an explicit framed paragraph anchor', () => {
      const blocks: FlowBlock[] = [
        makeFloatingTable('field', 8),
        { kind: 'paragraph', id: 'near-table', runs: [{ text: 'Near table' }] },
        { kind: 'paragraph', id: 'explicit-frame', runs: [], attrs: { frame: { wrap: 'around' } } },
        { kind: 'paragraph', id: 'after-explicit', runs: [{ text: 'After explicit anchor' }] },
      ];
      (blocks[0] as TableBlock).attrs = { anchorParagraphId: 'explicit-frame' };
      const measures: Measure[] = [
        { kind: 'table', rows: [], columnWidths: [100], totalWidth: 100, totalHeight: 14 } as TableMeasure,
        makeParaMeasure(17),
        makeParaMeasure(17),
        makeParaMeasure(17),
      ];

      const resolution = resolveFloatingTableAnchorResolution(
        blocks,
        measures,
        blocks.length,
        0,
        blocks[0] as TableBlock,
        new Map([['explicit-frame', 2]]),
      );

      expect(resolution?.paragraphIndex).toBe(2);
    });

    it('preserves page-relative placement context with an explicit framed anchor', () => {
      const blocks: FlowBlock[] = [
        makeFloatingTable('field', 8),
        { kind: 'paragraph', id: 'near-table', runs: [{ text: 'Near table' }] },
        { kind: 'paragraph', id: 'explicit-frame', runs: [], attrs: { frame: { wrap: 'around' } } },
        { kind: 'paragraph', id: 'after-explicit', runs: [{ text: 'After explicit anchor' }] },
      ];
      const table = blocks[0] as TableBlock;
      table.attrs = { anchorParagraphId: 'explicit-frame' };
      table.anchor = { ...table.anchor!, vRelativeFrom: 'page' };
      const measures: Measure[] = [
        { kind: 'table', rows: [], columnWidths: [100], totalWidth: 100, totalHeight: 14 } as TableMeasure,
        makeParaMeasure(17),
        makeParaMeasure(17),
        makeParaMeasure(17),
      ];

      const resolution = resolveFloatingTableAnchorResolution(
        blocks,
        measures,
        blocks.length,
        0,
        table,
        new Map([['explicit-frame', 2]]),
      );

      expect(resolution).toEqual({ paragraphIndex: 2, offsetV: 8, lineScopedOnAnchor: false });
    });

    it('preserves a negative tblpY', () => {
      const blocks: FlowBlock[] = [
        makeFloatingTable('field', -12),
        { kind: 'paragraph', id: 'regular', runs: [{ text: 'Regular paragraph' }] },
      ];
      const measures: Measure[] = [
        { kind: 'table', rows: [], columnWidths: [100], totalWidth: 100, totalHeight: 14 } as TableMeasure,
        makeParaMeasure(17),
      ];

      const resolution = resolveFloatingTableAnchorResolution(
        blocks,
        measures,
        blocks.length,
        0,
        blocks[0] as TableBlock,
        new Map(),
      );

      expect(resolution).toEqual({ paragraphIndex: 1, offsetV: -12, lineScopedOnAnchor: false });
    });

    it('uses the preceding paragraph text bottom for a negative text-relative page-positioned table', () => {
      const table = makeFloatingTable('field', -12);
      table.anchor = { ...table.anchor!, hRelativeFrom: 'page' };
      table.wrap = { type: 'Square' };
      const blocks: FlowBlock[] = [
        { kind: 'paragraph', id: 'before-table', runs: [{ text: 'Anchor candidate before table' }] },
        table,
        { kind: 'paragraph', id: 'after-table', runs: [{ text: 'Anchor candidate after table' }] },
      ];
      const measures: Measure[] = [
        makeParaMeasure(17),
        { kind: 'table', rows: [], columnWidths: [100], totalWidth: 100, totalHeight: 14 } as TableMeasure,
        makeParaMeasure(17),
      ];

      const resolution = resolveFloatingTableAnchorResolution(blocks, measures, blocks.length, 1, table, new Map());

      expect(resolution).toEqual({ paragraphIndex: 0, offsetV: 5, lineScopedOnAnchor: false });
    });
  });
});
