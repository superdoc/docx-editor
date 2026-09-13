import { describe, it, expect, beforeAll, vi } from 'vite-plus/test';
import { clearMeasurementCache, clearTextMeasurementCaches, configureMeasurement, measureBlock } from './index.js';
import type {
  FlowBlock,
  ParagraphMeasure,
  ImageMeasure,
  Measure,
  DrawingMeasure,
  DrawingBlock,
  TableBlock,
  TableMeasure,
  Run,
  TabRun,
  TextRun,
  InlineBoxSpan,
  CellBorders,
} from '@superdoc/contracts';
import { EMPTY_SDT_PLACEHOLDER_TEXT, expandRunsForInlineNewlines, calculateJustifySpacing } from '@superdoc/contracts';
import { resolvePhysicalFamily } from '@superdoc/font-system';

const expectParagraphMeasure = (measure: Measure): ParagraphMeasure => {
  expect(measure.kind).toBe('paragraph');
  return measure as ParagraphMeasure;
};

const extractLineText = (block: FlowBlock, line: ParagraphMeasure['lines'][number]): string => {
  if (block.kind !== 'paragraph') return '';
  const runs = (block as FlowBlock).runs || [];
  const parts: string[] = [];
  for (let runIndex = line.fromRun; runIndex <= line.toRun; runIndex++) {
    const run = runs[runIndex] as { text?: string };
    if (!run || typeof run.text !== 'string') continue;
    const start = runIndex === line.fromRun ? line.fromChar : 0;
    const end = runIndex === line.toRun ? line.toChar : run.text.length;
    parts.push(run.text.slice(start, end));
  }
  return parts.join('');
};

const extractSegmentText = (block: FlowBlock, line: ParagraphMeasure['lines'][number]): string[] => {
  if (block.kind !== 'paragraph') return [];
  const runs = expandRunsForInlineNewlines(block.runs);
  return (line.segments ?? []).map((segment) => {
    const run = runs[segment.runIndex];
    return run && 'text' in run ? run.text.slice(segment.fromChar, segment.toChar) : '';
  });
};

const expectImageMeasure = (measure: Measure): ImageMeasure => {
  expect(measure.kind).toBe('image');
  return measure as ImageMeasure;
};

const expectDrawingMeasure = (measure: Measure): DrawingMeasure => {
  expect(measure.kind).toBe('drawing');
  return measure as DrawingMeasure;
};

const createOverwideGridTable = (attrs: TableBlock['attrs'] = {}): TableBlock => ({
  kind: 'table',
  id: 'overwide-grid-table',
  attrs,
  rows: [
    {
      id: 'row-0',
      cells: [
        {
          id: 'cell-0-0',
          blocks: [
            {
              kind: 'paragraph',
              id: 'para-0',
              runs: [{ text: 'A', fontFamily: 'Arial', fontSize: 12 }],
            },
          ],
        },
        {
          id: 'cell-0-1',
          blocks: [
            {
              kind: 'paragraph',
              id: 'para-1',
              runs: [{ text: 'B', fontFamily: 'Arial', fontSize: 12 }],
            },
          ],
        },
      ],
    },
  ],
  columnWidths: [320, 320],
});

describe('measureBlock', () => {
  // Ensure we're in a jsdom environment
  beforeAll(() => {
    expect(typeof document).toBe('object');
    expect(typeof document.createElement).toBe('function');
  });

  describe('basic measurement', () => {
    it('offers a measurement failure only to the exact block owner', async () => {
      const sourceError = new Error('measurement-source-failure');
      const ownedError = new Error('measurement-owned-failure');
      const block = {
        kind: 'paragraph',
        id: 'owned-measurement-block',
        get runs(): never {
          throw sourceError;
        },
        attrs: {},
      } as unknown as FlowBlock;
      const owner = vi.fn(() => ownedError);
      const constraints = { maxWidth: 1000, maxHeight: 1000 } as Record<PropertyKey, unknown>;
      Object.defineProperty(constraints, Symbol.for('superdoc.v2.render-diagnostic.measurement-owner'), {
        value: owner,
      });

      await expect(measureBlock(block, constraints as never)).rejects.toBe(ownedError);
      expect(owner).toHaveBeenCalledTimes(1);
      expect(owner).toHaveBeenCalledWith(block.id, sourceError);
    });

    it('preserves the exact nested textbox block owner', async () => {
      const sourceError = new Error('nested-textbox-measurement-source-failure');
      const ownedError = new Error('nested-textbox-measurement-owned-failure');
      const nestedBlock = {
        kind: 'paragraph',
        id: 'nested-textbox-block',
        get runs(): never {
          throw sourceError;
        },
        attrs: {},
      } as unknown as FlowBlock;
      const drawing: DrawingBlock = {
        kind: 'drawing',
        id: 'textbox-carrier',
        drawingKind: 'textboxShape',
        geometry: { width: 240, height: 60, rotation: 0 },
        contentBlocks: [nestedBlock as never],
      };
      const owner = vi.fn(() => ownedError);
      const constraints = { maxWidth: 1000, maxHeight: 1000 } as Record<PropertyKey, unknown>;
      Object.defineProperty(constraints, Symbol.for('superdoc.v2.render-diagnostic.measurement-owner'), {
        value: owner,
      });

      await expect(measureBlock(drawing, constraints as never)).rejects.toBe(ownedError);
      expect(owner).toHaveBeenCalledTimes(1);
      expect(owner).toHaveBeenCalledWith(nestedBlock.id, sourceError);
    });

    it('preserves the nested textbox owner through a table cell', async () => {
      const sourceError = new Error('table-textbox-measurement-source-failure');
      const ownedError = new Error('table-textbox-measurement-owned-failure');
      const nestedBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'table-nested-textbox-block',
        runs: [
          {
            text: 'NESTED_TABLE_TEXTBOX_THROW',
            fontFamily: 'NestedTableOwnerFault',
            fontSize: 12,
          },
        ],
      };
      const drawing: DrawingBlock = {
        kind: 'drawing',
        id: 'table-textbox-carrier',
        drawingKind: 'textboxShape',
        geometry: { width: 240, height: 60, rotation: 0 },
        contentBlocks: [nestedBlock as never],
      };
      const table: FlowBlock = {
        kind: 'table',
        id: 'table-textbox-owner',
        columnWidths: [240],
        rows: [
          {
            id: 'table-textbox-row',
            cells: [{ id: 'table-textbox-cell', blocks: [drawing] }],
          },
        ],
      };
      const owner = vi.fn(() => ownedError);
      const constraints = { maxWidth: 1000, maxHeight: 1000 } as Record<PropertyKey, unknown>;
      Object.defineProperty(constraints, Symbol.for('superdoc.v2.render-diagnostic.measurement-owner'), {
        value: owner,
      });
      clearTextMeasurementCaches();
      let thrown: unknown;
      try {
        await measureBlock(table, constraints as never, {
          fontSignature: 'nested-table-owner-test',
          resolvePhysical(fontFamily, face) {
            if (fontFamily === 'NestedTableOwnerFault') throw sourceError;
            return resolvePhysicalFamily(fontFamily, face);
          },
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBe(ownedError);
      expect(owner).toHaveBeenCalledTimes(1);
      expect(owner).toHaveBeenCalledWith(nestedBlock.id, sourceError);
    });

    it('lets the enclosing table own a declined cell measurement failure', async () => {
      const sourceError = new Error('ordinary-table-cell-source-failure');
      const ownedError = new Error('ordinary-table-owned-failure');
      const cellBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'ordinary-table-cell-block',
        runs: [
          {
            text: 'ORDINARY_TABLE_CELL_THROW',
            fontFamily: 'OrdinaryTableCellFault',
            fontSize: 12,
          },
        ],
      };
      const cellDrawing: DrawingBlock = {
        kind: 'drawing',
        id: 'ordinary-table-cell-drawing',
        drawingKind: 'textboxShape',
        geometry: { width: 240, height: 60, rotation: 0 },
        contentBlocks: [cellBlock as never],
      };
      const table: FlowBlock = {
        kind: 'table',
        id: 'ordinary-table-owner',
        columnWidths: [240],
        rows: [
          {
            id: 'ordinary-table-row',
            cells: [{ id: 'ordinary-table-cell', blocks: [cellDrawing] }],
          },
        ],
      };
      const owner = vi.fn((blockId: string, error: unknown) => (blockId === table.id ? ownedError : error));
      const constraints = { maxWidth: 1000, maxHeight: 1000 } as Record<PropertyKey, unknown>;
      Object.defineProperty(constraints, Symbol.for('superdoc.v2.render-diagnostic.measurement-owner'), {
        value: owner,
      });
      clearTextMeasurementCaches();

      let thrown: unknown;
      try {
        await measureBlock(table, constraints as never, {
          fontSignature: 'ordinary-table-owner-test',
          resolvePhysical(fontFamily, face) {
            if (fontFamily === 'OrdinaryTableCellFault') throw sourceError;
            return resolvePhysicalFamily(fontFamily, face);
          },
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBe(ownedError);
      expect(owner.mock.calls).toEqual([
        [cellBlock.id, sourceError],
        [cellDrawing.id, sourceError],
        [table.id, sourceError],
      ]);
    });

    it('measures a simple single-line block', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: '0-paragraph',
        runs: [
          {
            text: 'Hello',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));

      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0]).toMatchObject({
        fromRun: 0,
        fromChar: 0,
        toRun: 0,
      });
      expect(measure.lines[0].width).toBeGreaterThan(0);
      // Ascent/descent now use actual font metrics from Canvas API instead of
      // hardcoded 0.8/0.2 approximations. This prevents text clipping.
      // Values vary by font, so we check for reasonable ranges.
      expect(measure.lines[0].ascent).toBeGreaterThan(0);
      expect(measure.lines[0].ascent).toBeLessThan(16 * 1.2); // Should be reasonable for 16px font
      expect(measure.lines[0].descent).toBeGreaterThan(0);
      expect(measure.lines[0].descent).toBeLessThan(16 * 0.5);
      // lineHeight should be at least ascent + descent (+ safety margin)
      expect(measure.lines[0].lineHeight).toBeGreaterThanOrEqual(measure.lines[0].ascent + measure.lines[0].descent);
      expect(measure.totalHeight).toBe(measure.lines[0].lineHeight);
    });

    it('resolves one repeated physical font face once per paragraph', async () => {
      const resolvePhysical = vi.fn((family: string) => family);
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'repeated-physical-face',
        runs: Array.from({ length: 12 }, (_, index) => ({
          text: `segment ${index} `,
          fontFamily: 'Arial',
          fontSize: index % 2 === 0 ? 16 : 18,
        })),
        attrs: {},
      };

      const measure = expectParagraphMeasure(
        await measureBlock(block, 1000, { resolvePhysical, fontSignature: 'repeated-face' }),
      );

      expect(measure.lines.length).toBeGreaterThan(0);
      expect(resolvePhysical).toHaveBeenCalledTimes(1);
    });

    it('keeps distinct physical font faces separate', async () => {
      const resolvePhysical = vi.fn((family: string) => family);
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'distinct-physical-faces',
        runs: [
          { text: 'regular ', fontFamily: 'Arial', fontSize: 16 },
          { text: 'bold ', fontFamily: 'Arial', fontSize: 16, bold: true },
          { text: 'italic ', fontFamily: 'Arial', fontSize: 16, italic: true },
          { text: 'other', fontFamily: 'Times New Roman', fontSize: 16 },
        ],
        attrs: {},
      };

      await measureBlock(block, 1000, { resolvePhysical, fontSignature: 'distinct-faces' });

      expect(resolvePhysical).toHaveBeenCalledTimes(4);
    });

    it('preserves omitted font flags across paragraph-local font-info reuse', async () => {
      const explicitThenOmitted: FlowBlock = {
        kind: 'paragraph',
        id: 'explicit-then-omitted-font-flags',
        runs: [
          { text: 'explicit', fontFamily: 'Arial', fontSize: 16, bold: false, italic: false },
          { kind: 'lineBreak' },
          { text: 'omitted', fontFamily: 'Arial', fontSize: 16 },
        ],
        attrs: {},
      };
      const omittedThenExplicit: FlowBlock = {
        kind: 'paragraph',
        id: 'omitted-then-explicit-font-flags',
        runs: [
          { text: 'omitted', fontFamily: 'Arial', fontSize: 16 },
          { kind: 'lineBreak' },
          { text: 'explicit', fontFamily: 'Arial', fontSize: 16, bold: false, italic: false },
        ],
        attrs: {},
      };

      const explicitThenOmittedMeasure = expectParagraphMeasure(await measureBlock(explicitThenOmitted, 1000));
      const omittedThenExplicitMeasure = expectParagraphMeasure(await measureBlock(omittedThenExplicit, 1000));
      const maxFontInfo = (line: ParagraphMeasure['lines'][number]) =>
        (line as ParagraphMeasure['lines'][number] & { maxFontInfo?: Pick<TextRun, 'bold' | 'italic'> }).maxFontInfo;

      expect(explicitThenOmittedMeasure.lines).toHaveLength(2);
      expect(maxFontInfo(explicitThenOmittedMeasure.lines[0])).toMatchObject({ bold: false, italic: false });
      expect(maxFontInfo(explicitThenOmittedMeasure.lines[1])?.bold).toBeUndefined();
      expect(maxFontInfo(explicitThenOmittedMeasure.lines[1])?.italic).toBeUndefined();
      expect(omittedThenExplicitMeasure.lines).toHaveLength(2);
      expect(maxFontInfo(omittedThenExplicitMeasure.lines[0])?.bold).toBeUndefined();
      expect(maxFontInfo(omittedThenExplicitMeasure.lines[0])?.italic).toBeUndefined();
      expect(maxFontInfo(omittedThenExplicitMeasure.lines[1])).toMatchObject({ bold: false, italic: false });
    });

    it('does not count empty text runs as justification spaces', async () => {
      const visibleRuns = [
        {
          text: '1. Confidential Information. In connection with ',
          fontFamily: 'Arial',
          fontSize: 16,
        },
      ];
      const withoutEmptyRuns: FlowBlock = {
        kind: 'paragraph',
        id: 'without-empty-runs',
        runs: visibleRuns,
        attrs: { alignment: 'justify' },
      };
      const withEmptyRuns: FlowBlock = {
        kind: 'paragraph',
        id: 'with-empty-runs',
        runs: [
          { text: '', fontFamily: 'Arial', fontSize: 16 },
          { text: '', fontFamily: 'Arial', fontSize: 16 },
          { text: '', fontFamily: 'Arial', fontSize: 16 },
          ...visibleRuns,
        ],
        attrs: { alignment: 'justify' },
      };

      const baseMeasure = expectParagraphMeasure(await measureBlock(withoutEmptyRuns, 1000));
      const emptyPrefixMeasure = expectParagraphMeasure(await measureBlock(withEmptyRuns, 1000));

      expect(emptyPrefixMeasure.lines).toHaveLength(1);
      expect(emptyPrefixMeasure.lines[0].width).toBeCloseTo(baseMeasure.lines[0].width, 3);
      expect(emptyPrefixMeasure.lines[0].spaceCount).toBe(baseMeasure.lines[0].spaceCount);
      expect(emptyPrefixMeasure.lines[0].segments).toEqual([
        {
          runIndex: 3,
          fromChar: 0,
          toChar: visibleRuns[0].text.length,
          width: expect.any(Number),
        },
      ]);
    });

    it('counts a non-breaking space embedded inside a word the same as a literal space', async () => {
      // NBSP stays embedded inside one `word` token (segment.split(' ') only splits on
      // U+0020), but CSS word-spacing stretches/compresses U+00A0 identically to
      // U+0020 (confirmed empirically across Chromium/Firefox/WebKit), so spaceCount
      // must count it the same way or a justified line under-counts its own
      // stretch points and bleeds past the right margin.
      const withNbsp: FlowBlock = {
        kind: 'paragraph',
        id: 'embedded-nbsp',
        runs: [{ text: '10 km travelled', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { alignment: 'justify' },
      };
      const withSpaceControl: FlowBlock = {
        kind: 'paragraph',
        id: 'embedded-space-control',
        runs: [{ text: '10 km travelled', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { alignment: 'justify' },
      };

      const nbspMeasure = expectParagraphMeasure(await measureBlock(withNbsp, 1000));
      const spaceMeasure = expectParagraphMeasure(await measureBlock(withSpaceControl, 1000));

      expect(nbspMeasure.lines).toHaveLength(1);
      expect(spaceMeasure.lines).toHaveLength(1);
      expect(nbspMeasure.lines[0].spaceCount).toBe(spaceMeasure.lines[0].spaceCount);
    });

    it('counts NBSP even when it is the only whitespace-like character on the line', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'nbsp-only-whitespace',
        runs: [{ text: 'alpha bravo charlie', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { alignment: 'justify' },
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));

      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0].spaceCount).toBe(2);
    });

    it('counts NBSP at a run boundary the same as when embedded inside one run', async () => {
      const splitAcrossRuns: FlowBlock = {
        kind: 'paragraph',
        id: 'nbsp-run-boundary-split',
        runs: [
          { text: '10', fontFamily: 'Arial', fontSize: 16 },
          { text: ' ', fontFamily: 'Arial', fontSize: 16 },
          { text: 'km', fontFamily: 'Arial', fontSize: 16 },
        ],
        attrs: { alignment: 'justify' },
      };
      const unsplitRun: FlowBlock = {
        kind: 'paragraph',
        id: 'nbsp-run-boundary-unsplit',
        runs: [{ text: '10 km', fontFamily: 'Arial', fontSize: 16 }],
        attrs: { alignment: 'justify' },
      };

      const splitMeasure = expectParagraphMeasure(await measureBlock(splitAcrossRuns, 1000));
      const unsplitMeasure = expectParagraphMeasure(await measureBlock(unsplitRun, 1000));

      expect(splitMeasure.lines).toHaveLength(1);
      expect(splitMeasure.lines[0].spaceCount).toBe(1);
      expect(splitMeasure.lines[0].spaceCount).toBe(unsplitMeasure.lines[0].spaceCount);
      expect(splitMeasure.lines[0].width).toBeCloseTo(unsplitMeasure.lines[0].width, 3);
    });

    it('counts NBSP inside a hyphen-break prefix, but not inside the un-committed remainder', async () => {
      // Deterministic 10px-per-char mock (same technique as the existing
      // 'wraps after a hyphen-minus without dropping the hyphen' test below),
      // extended to also cover NBSP so its width is predictable too.
      const contextPrototype = Object.getPrototypeOf(document.createElement('canvas').getContext('2d'));
      const originalMeasureText = contextPrototype.measureText;
      const measureTextSpy = vi.spyOn(contextPrototype, 'measureText').mockImplementation(function (text: string) {
        if (/^[a-z  -]+$/i.test(text)) {
          const width = text.length * 10;
          return {
            width,
            actualBoundingBoxLeft: 0,
            actualBoundingBoxRight: width,
            actualBoundingBoxAscent: 8,
            actualBoundingBoxDescent: 2,
          } as TextMetrics;
        }
        return originalMeasureText.call(this, text);
      });
      // Word is "twenty -one": NBSP sits BEFORE the hyphen, so the committed
      // prefix "twenty -" (breakableHyphenEnd) includes it; the un-committed
      // remainder "one" (reprocessed as its own word next iteration) does not.
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'hyphen-break-nbsp',
        runs: [{ text: 'alpha twenty -one omega', fontFamily: 'Arial', fontSize: 12 }],
      };

      try {
        clearMeasurementCache();
        const measure = expectParagraphMeasure(await measureBlock(block, 140.5));

        expect(extractLineText(block, measure.lines[0])).toBe('alpha twenty -');
        // 1 delimiter space ("alpha" | "twenty -one") + 1 NBSP inside the
        // committed prefix "twenty -".
        expect(measure.lines[0].spaceCount).toBe(2);
        expect(extractLineText(block, measure.lines[1]).trim()).toBe('one omega');
      } finally {
        measureTextSpy.mockRestore();
        clearMeasurementCache();
      }
    });

    it('counts NBSP inside a word committed without its trailing delimiter space', async () => {
      // Deterministic 10px-per-char mock, extended to cover NBSP.
      const contextPrototype = Object.getPrototypeOf(document.createElement('canvas').getContext('2d'));
      const originalMeasureText = contextPrototype.measureText;
      const measureTextSpy = vi.spyOn(contextPrototype, 'measureText').mockImplementation(function (text: string) {
        if (/^[a-z  ]+$/i.test(text)) {
          const width = text.length * 10;
          return {
            width,
            actualBoundingBoxLeft: 0,
            actualBoundingBoxRight: width,
            actualBoundingBoxAscent: 8,
            actualBoundingBoxDescent: 2,
          } as TextMetrics;
        }
        return originalMeasureText.call(this, text);
      });
      // At width 125: "alpha " (60px) + "bcd ef" (60px) = 120px fits, but adding
      // the trailing delimiter space (+10px = 130px) does not -- forces the
      // "word fits, delimiter doesn't" commit-and-close branch (no hyphen involved).
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'no-delimiter-commit-nbsp',
        attrs: { alignment: 'justify' },
        runs: [{ text: 'alpha bcd ef ghi', fontFamily: 'Arial', fontSize: 12 }],
      };

      try {
        clearMeasurementCache();
        const measure = expectParagraphMeasure(await measureBlock(block, 125));

        expect(extractLineText(block, measure.lines[0])).toBe('alpha bcd ef');
        // 1 delimiter space ("alpha" | "bcd ef") + 1 NBSP inside "bcd ef".
        expect(measure.lines[0].spaceCount).toBe(2);
        expect(extractLineText(block, measure.lines[1]).trim()).toBe('ghi');

        // Mechanism-level check, not just a count comparison: the painted width
        // the browser will actually produce (naturalWidth/width plus every
        // counted space -- ASCII or NBSP -- stretched by spacingPerSpace) must
        // land on availableWidth, which is the real bug this fix closes.
        const line = measure.lines[0];
        const lineWidth = line.naturalWidth ?? line.width;
        const availableWidth = line.maxWidth ?? line.width;
        const spacingPerSpace = calculateJustifySpacing({
          lineWidth,
          availableWidth,
          spaceCount: line.spaceCount ?? 0,
          shouldJustify: true,
        });
        expect(lineWidth + spacingPerSpace * (line.spaceCount ?? 0)).toBeCloseTo(availableWidth, 3);
      } finally {
        measureTextSpy.mockRestore();
        clearMeasurementCache();
      }
    });

    it('keeps empty-only paragraphs measurable without phantom spaces', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'empty-only-runs',
        runs: [
          { text: '', fontFamily: 'Arial', fontSize: 16 },
          { text: '', fontFamily: 'Arial', fontSize: 16 },
        ],
        attrs: {},
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));

      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0].width).toBe(0);
      expect(measure.lines[0].spaceCount).toBeUndefined();
      expect(measure.lines[0].segments).toEqual([]);
      expect(measure.totalHeight).toBeGreaterThan(0);
    });

    it('keeps vanished text addressable without contributing width or visible line metrics', async () => {
      const visibleBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'visible-small-run',
        runs: [{ text: 'Visible', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {},
      };
      const hiddenPrefixBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'hidden-prefix-run',
        runs: [
          { text: 'Hidden ', fontFamily: 'Arial', fontSize: 48, vanish: true },
          { text: 'Visible', fontFamily: 'Arial', fontSize: 12 },
        ],
        attrs: {},
      };

      const visibleMeasure = expectParagraphMeasure(await measureBlock(visibleBlock, 1000));
      const hiddenPrefixMeasure = expectParagraphMeasure(await measureBlock(hiddenPrefixBlock, 1000));

      expect(hiddenPrefixMeasure.lines).toHaveLength(1);
      expect(hiddenPrefixMeasure.lines[0].width).toBeCloseTo(visibleMeasure.lines[0].width, 3);
      expect(hiddenPrefixMeasure.lines[0].lineHeight).toBeCloseTo(visibleMeasure.lines[0].lineHeight, 3);
      expect(hiddenPrefixMeasure.lines[0].segments).toEqual([
        { runIndex: 0, fromChar: 0, toChar: 7, width: 0 },
        { runIndex: 1, fromChar: 0, toChar: 7, width: expect.any(Number) },
      ]);
    });

    it('keeps vanished tabs addressable without advancing visible content', async () => {
      const hiddenTab: TabRun = {
        kind: 'tab',
        text: '\t',
        fontFamily: 'Arial',
        fontSize: 48,
        vanish: true,
      };
      Object.freeze(hiddenTab);
      const visibleBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'visible-small-run',
        runs: [{ text: 'Visible', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {},
      };
      const hiddenTabPrefixBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'hidden-tab-prefix-run',
        runs: [hiddenTab, { text: 'Visible', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {},
      };

      const visibleMeasure = expectParagraphMeasure(await measureBlock(visibleBlock, 1000));
      const hiddenTabPrefixMeasure = expectParagraphMeasure(await measureBlock(hiddenTabPrefixBlock, 1000));

      expect(hiddenTabPrefixMeasure.lines).toHaveLength(1);
      expect(hiddenTabPrefixMeasure.lines[0].width).toBeCloseTo(visibleMeasure.lines[0].width, 3);
      expect(hiddenTabPrefixMeasure.lines[0].lineHeight).toBeCloseTo(visibleMeasure.lines[0].lineHeight, 3);
      expect(hiddenTabPrefixMeasure.lines[0].segments).toEqual([
        { runIndex: 0, fromChar: 0, toChar: 1, width: 0 },
        { runIndex: 1, fromChar: 0, toChar: 7, width: expect.any(Number) },
      ]);
      expect(hiddenTabPrefixMeasure.lines[0].tabWidths?.[0]).toBe(0);
      expect(hiddenTab).not.toHaveProperty('width');
    });

    it('does not let vanished text inflate a following visible tab line', async () => {
      const visibleTabBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'visible-tab-run',
        runs: [{ kind: 'tab', text: '\t', fontFamily: 'Arial', fontSize: 12 } as TabRun],
        attrs: {},
      };
      const hiddenBeforeTabBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'hidden-before-tab-run',
        runs: [
          { text: 'Hidden', fontFamily: 'Arial', fontSize: 72, vanish: true },
          { kind: 'tab', text: '\t', fontFamily: 'Arial', fontSize: 12 } as TabRun,
        ],
        attrs: {},
      };

      const visibleTabMeasure = expectParagraphMeasure(await measureBlock(visibleTabBlock, 1000));
      const hiddenBeforeTabMeasure = expectParagraphMeasure(await measureBlock(hiddenBeforeTabBlock, 1000));

      expect(hiddenBeforeTabMeasure.lines).toHaveLength(1);
      expect(hiddenBeforeTabMeasure.lines[0].width).toBeCloseTo(visibleTabMeasure.lines[0].width, 3);
      expect(hiddenBeforeTabMeasure.lines[0].lineHeight).toBeCloseTo(visibleTabMeasure.lines[0].lineHeight, 3);
      expect(hiddenBeforeTabMeasure.lines[0].segments).toEqual([{ runIndex: 0, fromChar: 0, toChar: 6, width: 0 }]);
      expect(hiddenBeforeTabMeasure.lines[0].tabWidths?.[1]).toBeGreaterThan(0);
    });

    it('keeps vanished-only paragraphs structurally measurable', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'hidden-only-run',
        runs: [{ text: 'Hidden', fontFamily: 'Arial', fontSize: 16, vanish: true }],
        attrs: {},
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));

      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0].width).toBe(0);
      expect(measure.lines[0].segments).toEqual([{ runIndex: 0, fromChar: 0, toChar: 6, width: 0 }]);
      expect(measure.totalHeight).toBeGreaterThan(0);
    });

    it('uses explicit multiplier line spacing for empty paragraphs', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'empty-explicit-line-spacing',
        runs: [{ text: '', fontFamily: 'Times New Roman', fontSize: 16 }],
        attrs: { spacing: { after: 16, line: 1, lineUnit: 'multiplier', lineRule: 'auto' } },
      };
      const referenceBlock: FlowBlock = {
        ...block,
        id: 'visible-explicit-line-spacing',
        runs: [{ text: 'x', fontFamily: 'Times New Roman', fontSize: 16 }],
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));
      const referenceMeasure = expectParagraphMeasure(await measureBlock(referenceBlock, 1000));

      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0].lineHeight).toBeCloseTo(referenceMeasure.lines[0].lineHeight, 3);
      expect(measure.totalHeight).toBeCloseTo(referenceMeasure.totalHeight, 3);
    });

    it('matches the Word mutation-derived Arial pitch for empty body paragraphs', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'empty-footer-line',
        runs: [{ text: '', fontFamily: 'Liberation Sans, sans-serif', fontSize: 14.666666666666666 }],
        attrs: { spacing: { line: 1.15, lineUnit: 'multiplier', lineRule: 'auto' } },
      };
      const fontContext = { resolvePhysical: (family: string) => family, fontSignature: 'sd-1331-probe' };

      const defaultMeasure = expectParagraphMeasure(await measureBlock(block, 1000, fontContext));
      const bodyMeasure = expectParagraphMeasure(
        await measureBlock(block, { maxWidth: 1000, emptyParagraphLineMetrics: 'body' }, fontContext),
      );
      const footerMeasure = expectParagraphMeasure(
        await measureBlock(block, { maxWidth: 1000, emptyParagraphLineMetrics: 'headerFooter' }, fontContext),
      );
      expect(bodyMeasure.lines[0].lineHeight).toBeCloseTo(19.397, 3);
      expect(defaultMeasure.lines[0].lineHeight).toBeCloseTo(19.397, 3);
      expect(footerMeasure.lines[0].lineHeight).toBeCloseTo(19.397, 3);
    });

    it('does not let skipped empty runs inflate visible line height', async () => {
      const visibleBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'visible-small-run',
        runs: [{ text: 'visible', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {},
      };
      const emptyPrefixBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'empty-large-prefix-run',
        runs: [
          { text: '', fontFamily: 'Arial', fontSize: 48 },
          { text: 'visible', fontFamily: 'Arial', fontSize: 12 },
        ],
        attrs: {},
      };

      const visibleMeasure = expectParagraphMeasure(await measureBlock(visibleBlock, 1000));
      const emptyPrefixMeasure = expectParagraphMeasure(await measureBlock(emptyPrefixBlock, 1000));

      expect(emptyPrefixMeasure.lines[0].lineHeight).toBeCloseTo(visibleMeasure.lines[0].lineHeight, 3);
    });

    it('does not let bookmark marker runs inflate visible line height', async () => {
      const visibleBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'footer-visible-run',
        runs: [{ text: '30695.10', fontFamily: 'Calibri', fontSize: 14.666666666666666 }],
        attrs: { spacing: { after: 0, line: 1, lineUnit: 'multiplier', lineRule: 'auto' } },
      };
      const bookmarkWrappedBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'footer-bookmark-wrapped-run',
        runs: [
          {
            text: '\u200B',
            fontFamily: 'Times New Roman',
            fontSize: 16,
            dataAttrs: { 'data-bookmark-marker': 'start', 'data-bookmark-id': '0' },
          },
          { text: '30695.10', fontFamily: 'Calibri', fontSize: 14.666666666666666 },
          {
            text: '\u200B',
            fontFamily: 'Times New Roman',
            fontSize: 16,
            dataAttrs: { 'data-bookmark-marker': 'end', 'data-bookmark-id': '0' },
          },
        ],
        attrs: { spacing: { after: 0, line: 1, lineUnit: 'multiplier', lineRule: 'auto' } },
      };

      const visibleMeasure = expectParagraphMeasure(await measureBlock(visibleBlock, 1000));
      const bookmarkWrappedMeasure = expectParagraphMeasure(await measureBlock(bookmarkWrappedBlock, 1000));

      expect(bookmarkWrappedMeasure.lines[0].lineHeight).toBeCloseTo(visibleMeasure.lines[0].lineHeight, 3);
      expect(bookmarkWrappedMeasure.totalHeight).toBeCloseTo(visibleMeasure.totalHeight, 3);
    });

    it('ignores bookmark marker runs when they would otherwise change wrapped line breaks', async () => {
      const visibleBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'footnote-visible-wrap',
        runs: [
          {
            text: 'If Alternative 1 (arbitration) is being used for dispute resolution, the jury trial waiver language should always be included. If Alternative 2 (court) is being used for dispute resolution, then this provision is optional.',
            fontFamily: 'Times New Roman',
            fontSize: 13.333333333333332,
          },
        ],
        attrs: {
          spacing: { after: 4, line: 1, lineUnit: 'multiplier', lineRule: 'auto' },
          tabs: [{ val: 'start', pos: 360 }],
        },
      };
      const bookmarkWrappedBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'footnote-bookmark-wrap',
        runs: [
          {
            text: '\u200B',
            fontFamily: 'Times New Roman',
            fontSize: 13.333333333333332,
            dataAttrs: { 'data-bookmark-marker': 'start', 'data-bookmark-id': '172' },
          },
          {
            text: 'If Alternative 1 (arbitration) is being used for dispute resolution, the jury trial waiver language should always be included. If Alternative 2 (court) is being used for dispute resolution, then this provision is optional',
            fontFamily: 'Times New Roman',
            fontSize: 13.333333333333332,
          },
          {
            text: '.',
            fontFamily: 'Times New Roman',
            fontSize: 13.333333333333332,
          },
          {
            text: '\u200B',
            fontFamily: 'Times New Roman',
            fontSize: 13.333333333333332,
            dataAttrs: { 'data-bookmark-marker': 'end', 'data-bookmark-id': '172' },
          },
        ],
        attrs: visibleBlock.attrs,
      };

      const visibleMeasure = expectParagraphMeasure(await measureBlock(visibleBlock, 624));
      const bookmarkWrappedMeasure = expectParagraphMeasure(await measureBlock(bookmarkWrappedBlock, 624));

      expect(bookmarkWrappedMeasure.lines).toHaveLength(visibleMeasure.lines.length);
      expect(bookmarkWrappedMeasure.totalHeight).toBeCloseTo(visibleMeasure.totalHeight, 3);
    });

    it('ignores bookmark marker runs inside visible bookmarked headings when wrapping', async () => {
      const attrs = {
        styleId: 'Heading2',
        alignment: 'justify' as const,
        spacing: { before: 16, after: 0, line: 1, lineUnit: 'multiplier' as const, lineRule: 'auto' as const },
        indent: { left: 0, firstLine: 48 },
        headingLevel: 2,
        tabs: [{ val: 'start' as const, pos: 1440 }],
        wordLayout: {
          indentLeftPx: 0,
          hangingPx: 0,
          firstLinePx: 48,
          tabsPx: [],
          textStartPx: 66,
          marker: {
            markerText: '1.1',
            markerBoxWidthPx: 18,
            markerX: 48,
            textStartX: 66,
            gutterWidthPx: 8,
            justification: 'left' as const,
            suffix: 'tab' as const,
            run: {
              fontFamily: 'Times New Roman',
              fontSize: 14.666666666666666,
              bold: false,
              italic: false,
              lang: 'en-US',
            },
          },
          defaultTabIntervalPx: 720,
          firstLineIndentMode: true,
        },
      };
      const visibleBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'heading-visible-wrap',
        runs: [
          {
            text: 'Performance. The Company shall have performed and complied with all covenants, agreements, obligations and conditions contained in this Agreement that are required to be performed or complied with by the Company in all respects on or before the Initial Closing [and, as to any subsequent Closing, in all material respects on or before such subsequent Closing].',
            fontFamily: 'Times New Roman',
            fontSize: 14.666666666666666,
          },
        ],
        attrs,
      };
      const bookmarkWrappedBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'heading-bookmark-wrap',
        runs: [
          {
            text: '\u200B',
            fontFamily: 'Times New Roman',
            fontSize: 14.666666666666666,
            dataAttrs: { 'data-bookmark-marker': 'start', 'data-bookmark-id': '131' },
          },
          {
            text: '\u200B',
            fontFamily: 'Times New Roman',
            fontSize: 14.666666666666666,
            dataAttrs: { 'data-bookmark-marker': 'start', 'data-bookmark-id': '132' },
          },
          {
            text: 'Performance',
            fontFamily: 'Times New Roman',
            fontSize: 14.666666666666666,
            underline: { style: 'single' },
          },
          {
            text: '\u200B',
            fontFamily: 'Times New Roman',
            fontSize: 14.666666666666666,
            underline: {},
            dataAttrs: { 'data-bookmark-marker': 'end', 'data-bookmark-id': '131' },
          },
          {
            text: '.',
            fontFamily: 'Times New Roman',
            fontSize: 14.666666666666666,
          },
          {
            text: ' The Company shall have performed and complied with all covenants, agreements, obligations and conditions contained in this Agreement that are required to be performed or complied with by the Company in all respects on or before the Initial Closing [and, as to any subsequent Closing, in all material respects on or before such subsequent Closing].',
            fontFamily: 'Times New Roman',
            fontSize: 14.666666666666666,
          },
          {
            text: '\u200B',
            fontFamily: 'Times New Roman',
            fontSize: 14.666666666666666,
            dataAttrs: { 'data-bookmark-marker': 'start', 'data-bookmark-id': '133' },
          },
          {
            text: '\u200B',
            fontFamily: 'Times New Roman',
            fontSize: 14.666666666666666,
            dataAttrs: { 'data-bookmark-marker': 'end', 'data-bookmark-id': '130' },
          },
          {
            text: '\u200B',
            fontFamily: 'Times New Roman',
            fontSize: 14.666666666666666,
            dataAttrs: { 'data-bookmark-marker': 'end', 'data-bookmark-id': '132' },
          },
        ],
        attrs,
      };

      const visibleMeasure = expectParagraphMeasure(await measureBlock(visibleBlock, 624));
      const bookmarkWrappedMeasure = expectParagraphMeasure(await measureBlock(bookmarkWrappedBlock, 624));

      expect(bookmarkWrappedMeasure.lines).toHaveLength(visibleMeasure.lines.length);
      expect(bookmarkWrappedMeasure.totalHeight).toBeCloseTo(visibleMeasure.totalHeight, 3);
    });

    it('uses the paragraph fallback font for empty lines with only bookmark marker text', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'empty-line-with-bookmark-marker',
        runs: [
          { text: '', fontFamily: 'Times New Roman', fontSize: 16 },
          {
            text: '\u200B',
            fontFamily: 'Times New Roman',
            fontSize: 14.666666666666666,
            dataAttrs: { 'data-bookmark-marker': 'end', 'data-bookmark-id': '42' },
          },
        ],
        attrs: { spacing: { after: 16, line: 1, lineUnit: 'multiplier', lineRule: 'auto' } },
      };
      const referenceBlock: FlowBlock = {
        ...block,
        id: 'empty-line-without-bookmark-marker',
        runs: [{ text: '', fontFamily: 'Times New Roman', fontSize: 16 }],
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));
      const referenceMeasure = expectParagraphMeasure(await measureBlock(referenceBlock, 1000));

      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0].lineHeight).toBeCloseTo(referenceMeasure.lines[0].lineHeight, 3);
      expect(measure.totalHeight).toBeCloseTo(referenceMeasure.totalHeight, 3);
    });

    it('uses empty-paragraph metrics for bookmark-carrier-only lines with fractional spacing', async () => {
      configureMeasurement({
        mode: 'deterministic',
        fonts: { deterministicFamily: 'Noto Sans', fallbackStack: ['Noto Sans', 'Arial', 'sans-serif'] },
      });
      try {
        const emptyVisibleBlock: FlowBlock = {
          kind: 'paragraph',
          id: 'empty-visible-line-fractional-spacing',
          runs: [{ text: '', fontFamily: 'Calibri', fontSize: 14.666666666666666 }],
          attrs: {
            spacing: { after: 0, line: 1, lineUnit: 'multiplier', lineRule: 'auto' },
            tabs: [
              { val: 'start', pos: 5529 },
              { val: 'end', pos: 8875 },
            ],
          },
        };
        const bookmarkCarrierBlock: FlowBlock = {
          kind: 'paragraph',
          id: 'bookmark-carrier-only-line-fractional-spacing',
          runs: [
            { text: '', fontFamily: 'Calibri', fontSize: 14.666666666666666 },
            {
              text: '\u200B',
              fontFamily: 'Calibri',
              fontSize: 12,
              dataAttrs: { 'data-bookmark-marker': 'start', 'data-bookmark-id': '1', 'data-bookmark-name': 'Options' },
            },
            {
              text: '\u200B',
              fontFamily: 'Calibri',
              fontSize: 12,
              dataAttrs: { 'data-bookmark-marker': 'end', 'data-bookmark-id': '1' },
            },
            {
              text: '\u200B',
              fontFamily: 'Calibri',
              fontSize: 12,
              dataAttrs: { 'data-bookmark-marker': 'end', 'data-bookmark-id': '0' },
            },
          ],
          attrs: {
            spacing: { after: 0, line: 1, lineUnit: 'multiplier', lineRule: 'auto' },
            tabs: [
              { val: 'start', pos: 5529 },
              { val: 'end', pos: 8875 },
            ],
          },
        };

        const emptyVisibleMeasure = expectParagraphMeasure(await measureBlock(emptyVisibleBlock, 1000));
        const bookmarkCarrierMeasure = expectParagraphMeasure(await measureBlock(bookmarkCarrierBlock, 1000));

        expect(emptyVisibleMeasure.lines[0].lineHeight).toBeCloseTo(16.9, 3);
        expect(bookmarkCarrierMeasure.lines[0].lineHeight).toBeCloseTo(emptyVisibleMeasure.lines[0].lineHeight, 3);
        expect(bookmarkCarrierMeasure.totalHeight).toBeCloseTo(emptyVisibleMeasure.totalHeight, 3);
      } finally {
        configureMeasurement({ mode: 'browser' });
      }
    });

    it('ignores bookmark marker runs when selecting fallback metrics for a leading-tab line', async () => {
      const attrs = {
        spacing: { line: 1, lineUnit: 'multiplier' as const },
        tabs: [
          { val: 'center' as const, pos: 4680 },
          { val: 'right' as const, pos: 9360 },
        ],
      };
      const withBookmarkMarker: FlowBlock = {
        kind: 'paragraph',
        id: 'bookmark-leading-tab',
        runs: [
          {
            text: '\u200B',
            fontFamily: 'Arial',
            fontSize: 13.33,
            dataAttrs: { 'data-bookmark-marker': 'start', 'data-bookmark-id': '180' },
          },
          { kind: 'tab', text: '\t', fontFamily: 'Arial', fontSize: 13.33 },
          { text: '21871', fontFamily: 'Arial', fontSize: 12 },
        ],
        attrs,
      };
      const withoutBookmarkMarker: FlowBlock = {
        kind: 'paragraph',
        id: 'plain-leading-tab',
        runs: [
          { kind: 'tab', text: '\t', fontFamily: 'Arial', fontSize: 13.33 },
          { text: '21871', fontFamily: 'Arial', fontSize: 12 },
        ],
        attrs,
      };

      const markerMeasure = expectParagraphMeasure(await measureBlock(withBookmarkMarker, 636));
      const referenceMeasure = expectParagraphMeasure(await measureBlock(withoutBookmarkMarker, 636));

      expect(markerMeasure.lines).toHaveLength(1);
      expect(markerMeasure.lines[0].lineHeight).toBeCloseTo(referenceMeasure.lines[0].lineHeight, 3);
    });

    // SD-3330: a line containing only tabs must be measured at the run's font size,
    // not the 12px fallback, so it has the same height as a text line in the same
    // paragraph font. Without this, tab-only lines render shorter than text lines.
    it('measures a tab-only line at the run font size, not the 12px default', async () => {
      const textBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'text',
        runs: [{ text: 'x', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {},
      };
      const tabBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'tab',
        runs: [{ kind: 'tab', text: '\t', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {},
      };

      const textMeasure = expectParagraphMeasure(await measureBlock(textBlock, 1000));
      const tabMeasure = expectParagraphMeasure(await measureBlock(tabBlock, 1000));

      // The tab-only line height matches the text line (both 16px), not 12px × 1.15.
      expect(tabMeasure.lines[0].lineHeight).toBeCloseTo(textMeasure.lines[0].lineHeight, 1);
      expect(tabMeasure.lines[0].lineHeight).toBeGreaterThan(16);
    });

    it('falls back safely when a structural tab has no text for embedded metric coverage', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'tab-without-text',
        runs: [{ kind: 'tab', fontFamily: 'Embedded Structural', fontSize: 16 } as unknown as TabRun],
        attrs: {},
      };
      const fallbackMeasure = expectParagraphMeasure(await measureBlock(block, 1000));
      const resolvedTexts: string[] = [];

      const embeddedMeasure = expectParagraphMeasure(
        await measureBlock(block, 1000, {
          fontSignature: 'embedded-structural:1',
          resolvePhysical: () => '__embedded_structural',
          resolveNaturalLineMultiplier: (_family, _face, text) => {
            resolvedTexts.push(text);
            return text.length > 0 ? 1.4 : undefined;
          },
        }),
      );

      expect(resolvedTexts).toEqual(['']);
      expect(embeddedMeasure.lines[0].lineHeight).toBeCloseTo(fallbackMeasure.lines[0].lineHeight, 6);
    });

    // SD-3347: line.tabWidths must be populated alongside run.width so the painter can read the
    // measured tab width even after FlowBlock re-projection creates fresh run objects
    // (cache hit → run.width never re-set → painter would fall back to 48px without tabWidths).
    // Keyed by block.runs index (not pmStart) so the entry survives upstream edits that shift
    // PM positions without changing paragraph content or formatting.
    it('stores measured tab width in line.tabWidths keyed by block.runs index', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'sig-line-tabwidths',
        runs: [
          {
            kind: 'tab' as const,
            text: '\t' as const,
            fontFamily: 'Arial',
            fontSize: 12,
          },
        ],
        attrs: {
          tabs: [{ val: 'start' as const, pos: 2880 }],
        },
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 500));
      const line = measure.lines[0];

      expect(line.tabWidths).toBeDefined();
      // The tab is at block.runs[0], so tabWidths key is 0.
      expect(typeof line.tabWidths![0]).toBe('number');
      // tabWidths entry must match the tab's contribution to line.width
      expect(line.tabWidths![0]).toBeCloseTo(line.width, 1);
    });

    it('stores correct tabWidths keys for a paragraph with text then tab', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'sig-line-text-then-tab',
        runs: [
          { text: 'Email:', fontFamily: 'Arial', fontSize: 12 },
          { kind: 'tab' as const, text: '\t' as const, fontFamily: 'Arial', fontSize: 12 },
        ],
        attrs: {
          tabs: [{ val: 'start' as const, pos: 5760 }],
        },
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 800));
      const line = measure.lines[0];

      expect(line.tabWidths).toBeDefined();
      // Tab is at block.runs[1], so tabWidths key must be 1, not 0.
      expect(line.tabWidths![1]).toBeGreaterThan(0);
      expect(line.tabWidths![0]).toBeUndefined();
    });

    it('breaks lines when text exceeds maxWidth', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: '0-paragraph',
        runs: [
          {
            text: 'This is a long paragraph that should break into multiple lines',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      // Use a narrow width to force line breaks
      const measure = expectParagraphMeasure(await measureBlock(block, 100));

      expect(measure.lines.length).toBeGreaterThan(1);
      // totalHeight should equal sum of all line heights (which now use actual font metrics)
      const expectedHeight = measure.lines.reduce((sum, line) => sum + line.lineHeight, 0);
      expect(measure.totalHeight).toBe(expectedHeight);

      // All lines except maybe the last should be near maxWidth
      for (let i = 0; i < measure.lines.length - 1; i++) {
        expect(measure.lines[i].width).toBeLessThanOrEqual(100);
      }
    });

    it('keeps measured newline-expanded run indexes aligned with the painter', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'redline-newline-paragraph',
        runs: [
          {
            text: '[______]',
            fontFamily: 'Times New Roman',
            fontSize: 14.67,
          },
          {
            text: 'Review Heading:\n\nLOREM IPSUM DOLOR SIT AMET CONSECTETUR ADIPISCING ELIT SED DO EIUSMOD TEMPOR INCIDIDUNT UT LABORE ET DOLORE MAGNA ALIQUA:',
            fontFamily: 'Times New Roman',
            fontSize: 14.67,
          },
        ],
        attrs: { indent: { left: 1.5333333333333332 } },
      };
      const expandedRuns = expandRunsForInlineNewlines((block as { runs: Run[] }).runs);
      const expandedLineText = (line: ParagraphMeasure['lines'][number]): string => {
        const parts: string[] = [];
        for (let runIndex = line.fromRun; runIndex <= line.toRun; runIndex += 1) {
          const run = expandedRuns[runIndex] as { text?: string } | undefined;
          if (!run || typeof run.text !== 'string') continue;
          const start = runIndex === line.fromRun ? line.fromChar : 0;
          const end = runIndex === line.toRun ? line.toChar : run.text.length;
          parts.push(run.text.slice(start, end));
        }
        return parts.join('');
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 601.333));
      const lineTexts = measure.lines.map(expandedLineText);

      for (const line of measure.lines) {
        expect(line.fromRun).toBeLessThan(expandedRuns.length);
        expect(line.toRun).toBeLessThan(expandedRuns.length);
        for (const segment of line.segments ?? []) {
          expect(segment.runIndex).toBeLessThan(expandedRuns.length);
        }
      }
      expect(lineTexts).toContain('[______]Review Heading:');
      expect(lineTexts.some((text) => text.startsWith('LOREM IPSUM'))).toBe(true);
      expect(lineTexts.some((text) => text.endsWith('MAGNA ALIQUA:'))).toBe(true);
      expect(lineTexts.join('')).toContain(
        'LOREM IPSUM DOLOR SIT AMET CONSECTETUR ADIPISCING ELIT SED DO EIUSMOD TEMPOR INCIDIDUNT UT LABORE ET DOLORE MAGNA ALIQUA:',
      );
    });

    it('falls back when text runs are missing font size', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: '0-paragraph',
        runs: [
          // Intentionally omitting fontSize to test fallback behavior
          {
            text: 'Hello',
            fontFamily: 'Arial',
          } as unknown as TextRun,
        ],
        attrs: {},
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));

      expect(Number.isFinite(measure.lines[0].lineHeight)).toBe(true);
      expect(measure.lines[0].lineHeight).toBeGreaterThan(0);
      expect(measure.lines[0].width).toBeGreaterThan(0);
    });

    it('measures default superscript lines from the original base font size', async () => {
      const baseBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'base-superscript-line-height',
        runs: [
          {
            text: '1',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      const superscriptBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'superscript-line-height',
        runs: [
          {
            text: '1',
            fontFamily: 'Arial',
            fontSize: 16 * 0.65,
            vertAlign: 'superscript',
          },
        ],
        attrs: {},
      };

      const baseMeasure = expectParagraphMeasure(await measureBlock(baseBlock, 1000));
      const superscriptMeasure = expectParagraphMeasure(await measureBlock(superscriptBlock, 1000));

      expect(superscriptMeasure.lines).toHaveLength(1);
      expect(superscriptMeasure.lines[0].ascent).toBeCloseTo(baseMeasure.lines[0].ascent, 3);
      expect(superscriptMeasure.lines[0].descent).toBeCloseTo(baseMeasure.lines[0].descent, 3);
      expect(superscriptMeasure.lines[0].lineHeight).toBeCloseTo(baseMeasure.lines[0].lineHeight, 3);
    });

    it('does not unscale custom baselineShift runs during line measurement', async () => {
      const baseBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'base-baseline-shift-line-height',
        runs: [
          {
            text: 'shifted',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      const shiftedBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'baseline-shift-line-height',
        runs: [
          {
            text: 'shifted',
            fontFamily: 'Arial',
            fontSize: 16,
            vertAlign: 'superscript',
            baselineShift: 3,
          },
        ],
        attrs: {},
      };

      const baseMeasure = expectParagraphMeasure(await measureBlock(baseBlock, 1000));
      const shiftedMeasure = expectParagraphMeasure(await measureBlock(shiftedBlock, 1000));

      expect(shiftedMeasure.lines).toHaveLength(1);
      expect(shiftedMeasure.lines[0].ascent).toBeCloseTo(baseMeasure.lines[0].ascent, 3);
      expect(shiftedMeasure.lines[0].descent).toBeCloseTo(baseMeasure.lines[0].descent, 3);
      expect(shiftedMeasure.lines[0].lineHeight).toBeCloseTo(baseMeasure.lines[0].lineHeight, 3);
    });

    it('treats zero baselineShift as identity during superscript measurement', async () => {
      const baseBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'base-zero-baseline-shift-line-height',
        runs: [
          {
            text: '1',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      const superscriptWithZeroShiftBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'zero-baseline-shift-line-height',
        runs: [
          {
            text: '1',
            fontFamily: 'Arial',
            fontSize: 16 * 0.65,
            vertAlign: 'superscript',
            baselineShift: 0,
          },
        ],
        attrs: {},
      };

      const baseMeasure = expectParagraphMeasure(await measureBlock(baseBlock, 1000));
      const superscriptMeasure = expectParagraphMeasure(await measureBlock(superscriptWithZeroShiftBlock, 1000));

      expect(superscriptMeasure.lines[0].ascent).toBeCloseTo(baseMeasure.lines[0].ascent, 3);
      expect(superscriptMeasure.lines[0].descent).toBeCloseTo(baseMeasure.lines[0].descent, 3);
      expect(superscriptMeasure.lines[0].lineHeight).toBeCloseTo(baseMeasure.lines[0].lineHeight, 3);
    });

    it('uses content width for wordLayout list first lines with standard hanging indent', async () => {
      // Standard hanging indent pattern: marker is positioned in the hanging area (left of text),
      // NOT inline with text. The marker doesn't consume horizontal space on the first line.
      const maxWidth = 200;
      const indentLeft = 32;
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'wordlayout-list',
        runs: [
          {
            text: 'List item text that should wrap correctly even with a hanging indent marker present',
            fontFamily: 'Times New Roman',
            fontSize: 16,
          },
        ],
        attrs: {
          indent: { left: indentLeft, hanging: indentLeft },
          wordLayout: {
            indentLeftPx: indentLeft,
            // Note: firstLineIndentMode is NOT set, so this is standard hanging indent
            marker: {
              markerText: '1.',
              markerBoxWidthPx: 20,
              gutterWidthPx: 12,
              run: {
                fontFamily: 'Times New Roman',
                fontSize: 16,
                bold: false,
                italic: false,
                letterSpacing: 0,
              },
            },
          },
        },
      };

      const measure = expectParagraphMeasure(await measureBlock(block, maxWidth));
      // For standard hanging indent, the marker is in the hanging area (doesn't take in-flow space).
      // First line available width = maxWidth - indentLeft (same as subsequent lines).
      expect(measure.lines[0].maxWidth).toBe(maxWidth - indentLeft);
    });

    it('uses textStartPx for wordLayout list first lines when textStartPx > indentLeft', async () => {
      const maxWidth = 200;
      const textStartPx = 100; // Where text actually starts (after marker + tab)
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'wordlayout-list-firstline',
        runs: [
          {
            text: 'List item text should wrap based on textStartPx when marker occupies space',
            fontFamily: 'Times New Roman',
            fontSize: 16,
          },
        ],
        attrs: {
          indent: { left: 0, firstLine: 48 },
          wordLayout: {
            indentLeftPx: 0,
            textStartPx,
            marker: {
              markerText: '(a)',
              markerBoxWidthPx: 24,
              gutterWidthPx: 8,
              run: {
                fontFamily: 'Times New Roman',
                fontSize: 16,
                bold: false,
                italic: false,
                letterSpacing: 0,
              },
            },
          },
        },
      };

      const measure = expectParagraphMeasure(await measureBlock(block, maxWidth));
      // When textStartPx > indentLeft, available width = maxWidth - textStartPx
      expect(measure.lines[0].maxWidth).toBe(maxWidth - textStartPx);
    });

    it('uses resolved list text start when an explicit suffix tab lands before indentLeft', async () => {
      const maxWidth = 200;
      const resolvedTextStartPx = 42;
      const indentLeft = 90;
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'wordlayout-list-suffix-tab-before-indent',
        runs: [
          {
            text: 'List item text should budget the first line from the rendered suffix tab',
            fontFamily: 'Times New Roman',
            fontSize: 16,
          },
        ],
        attrs: {
          indent: { left: indentLeft, hanging: 66 },
          wordLayout: {
            indentLeftPx: indentLeft,
            textStartPx: indentLeft,
            tabsPx: [resolvedTextStartPx],
            marker: {
              markerText: '•',
              glyphWidthPx: 6,
              markerBoxWidthPx: 66,
              gutterWidthPx: 8,
              suffix: 'tab',
              run: {
                fontFamily: 'Times New Roman',
                fontSize: 16,
                bold: false,
                italic: false,
                letterSpacing: 0,
              },
            },
          },
        },
      };

      const measure = expectParagraphMeasure(await measureBlock(block, maxWidth));

      expect(measure.lines[0].maxWidth).toBe(maxWidth - resolvedTextStartPx);
    });

    it('uses shared resolver output when only marker.textStartX exists in standard mode', async () => {
      const maxWidth = 200;
      const textStartX = 96; // First-line text start after marker + tab
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'wordlayout-list-textStartX',
        runs: [
          {
            text: 'List item text should wrap based on marker.textStartX when textStartPx is missing',
            fontFamily: 'Times New Roman',
            fontSize: 16,
          },
        ],
        attrs: {
          indent: { left: 0, firstLine: 48 },
          wordLayout: {
            indentLeftPx: 0,
            // Intentionally omit top-level textStartPx to simulate partial/legacy producers.
            marker: {
              markerText: '(a)',
              markerBoxWidthPx: 24,
              gutterWidthPx: 8,
              textStartX,
              run: {
                fontFamily: 'Times New Roman',
                fontSize: 16,
                bold: false,
                italic: false,
                letterSpacing: 0,
              },
            },
          },
        },
      };

      const measure = expectParagraphMeasure(await measureBlock(block, maxWidth));
      // Standard mode resolution is governed by resolveListTextStartPx (Step 8),
      // which computes text start from indent/marker geometry when textStartPx is absent.
      // Marker overflows hanging space, so advances to next default tab stop (96px).
      expect(measure.lines[0].maxWidth).toBe(104);
    });

    it('uses rendered first-line tab stop over stale textStart targets when both exist', async () => {
      const maxWidth = 240;
      const topLevelTextStart = 160;
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'wordlayout-list-resolved-precedence',
        runs: [
          {
            text: 'List item should size first-line width from shared resolver output',
            fontFamily: 'Times New Roman',
            fontSize: 16,
          },
        ],
        attrs: {
          indent: { left: 0, firstLine: 48 },
          wordLayout: {
            firstLineIndentMode: true,
            textStartPx: topLevelTextStart,
            marker: {
              markerText: '(a)',
              glyphWidthPx: 20,
              markerX: 48,
              markerBoxWidthPx: 24,
              gutterWidthPx: 8,
              textStartX: 112,
              run: {
                fontFamily: 'Times New Roman',
                fontSize: 16,
                bold: false,
                italic: false,
                letterSpacing: 0,
              },
            },
          },
        },
      };

      const measure = expectParagraphMeasure(await measureBlock(block, maxWidth));
      expect(measure.lines[0].maxWidth).toBe(maxWidth - 96);
    });

    it('measures first-line list tabs from the rendered tab stop for justified text', async () => {
      const maxWidth = 624;
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'sd-3426-first-line-list-tab',
        runs: [
          {
            text: 'Commencement Date IF LANDLORD MANAGED BUILDOUT Tract D inline retail only The earlier of date',
            fontFamily: 'Arial',
            fontSize: 12,
          },
        ],
        attrs: {
          alignment: 'justify',
          indent: { left: 0, firstLine: 48 },
          wordLayout: {
            indentLeftPx: 0,
            firstLineIndentMode: true,
            marker: {
              markerText: '(h)',
              glyphWidthPx: 18.65625,
              markerX: 48,
              textStartX: 66,
              gutterWidthPx: 8,
              justification: 'left',
              suffix: 'tab',
              run: {
                fontFamily: 'Arial',
                fontSize: 12,
                bold: false,
                italic: false,
                letterSpacing: 0,
              },
            },
          },
        },
      };

      const measure = expectParagraphMeasure(await measureBlock(block, maxWidth));
      expect(measure.lines[0].maxWidth).toBeCloseTo(maxWidth - 96, 5);
    });

    it('expands first-line width for hanging indents on non-list paragraphs', async () => {
      const maxWidth = 400;
      const indentLeft = 48;
      const hanging = 24;
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'hanging-indent-non-list',
        runs: [
          {
            text: 'This paragraph uses a hanging indent with enough text to wrap onto multiple lines for testing.',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {
          indent: { left: indentLeft, hanging },
        },
      };

      const measure = expectParagraphMeasure(await measureBlock(block, maxWidth));
      expect(measure.lines.length).toBeGreaterThan(1);

      const contentWidth = maxWidth - indentLeft;
      expect(measure.lines[0].maxWidth).toBe(contentWidth + hanging);
      expect(measure.lines[1].maxWidth).toBe(contentWidth);
    });

    it('measures empty block correctly', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: '0-paragraph',
        runs: [
          {
            text: '',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 200));

      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0].width).toBeGreaterThanOrEqual(0);
      expect(measure.lines[0].lineHeight).toBeGreaterThanOrEqual(16);
      expect(measure.lines[0].lineHeight).toBeLessThanOrEqual(16 * 1.15);
      expect(measure.totalHeight).toBeGreaterThan(0);
    });

    it('preserves marker measurements for empty list paragraphs', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'empty-list',
        runs: [
          {
            text: '',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {
          indent: { left: 0, hanging: 18 },
          wordLayout: {
            indentLeftPx: 0,
            marker: {
              markerText: '1.',
              gutterWidthPx: 8,
              run: {
                fontFamily: 'Arial',
                fontSize: 16,
                bold: false,
                italic: false,
                letterSpacing: 0,
              },
            },
          },
        },
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 200));

      expect(measure.lines).toHaveLength(1);
      expect(measure.marker).toBeDefined();
      expect(measure.marker?.markerWidth).toBeGreaterThan(0);
      expect(measure.marker?.markerTextWidth).toBeGreaterThan(0);
    });

    it('composes the list marker font into the first line envelope only', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'symbol-marker-line-envelope',
        runs: [
          {
            text: 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda',
            fontFamily: 'Times New Roman',
            fontSize: 44 / 3,
          },
        ],
        attrs: {
          indent: { left: 120, hanging: 24 },
          wordLayout: {
            indentLeftPx: 120,
            hangingPx: 24,
            textStartPx: 120,
            marker: {
              markerText: '•',
              markerBoxWidthPx: 24,
              markerX: 96,
              textStartX: 120,
              gutterWidthPx: 8,
              justification: 'left',
              suffix: 'tab',
              run: {
                fontFamily: 'Symbol',
                fontSize: 44 / 3,
                bold: false,
                italic: false,
                letterSpacing: 0,
              },
            },
          },
        },
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 260));

      expect(measure.lines.length).toBeGreaterThan(1);
      expect(measure.lines[0].lineHeight).toBeGreaterThan(measure.lines[1].lineHeight);
      expect(measure.lines[0].lineHeight).toBeCloseTo(17.92, 1);
      expect(measure.lines[1].lineHeight).toBeCloseTo((44 / 3) * 1.15, 1);
    });

    it('creates a new line for explicit lineBreak runs', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: '0-paragraph',
        runs: [
          {
            text: 'Heading text',
            fontFamily: 'Arial',
            fontSize: 16,
          },
          { kind: 'lineBreak' },
        ],
        attrs: {},
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 500));

      expect(measure.lines).toHaveLength(2);
      expect(measure.lines[0].width).toBeGreaterThan(0);
      expect(measure.lines[1].width).toBe(0);
      expect(measure.totalHeight).toBeCloseTo(measure.lines[0].lineHeight + measure.lines[1].lineHeight, 5);
    });

    it('places following text on the next line after a lineBreak run', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: '0-paragraph',
        runs: [
          {
            text: 'Line one',
            fontFamily: 'Arial',
            fontSize: 14,
          },
          { kind: 'lineBreak' },
          {
            text: 'Line two',
            fontFamily: 'Arial',
            fontSize: 14,
          },
        ],
        attrs: {},
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 500));

      expect(measure.lines).toHaveLength(2);
      expect(measure.lines[0].width).toBeGreaterThan(0);
      expect(measure.lines[1].width).toBeGreaterThan(0);
      expect(measure.lines[1].fromRun).toBe(2);
      expect(measure.lines[1].toRun).toBe(2);
    });

    it('creates an empty line for leading lineBreak at start of paragraph', async () => {
      // Regression test: DOCX documents can have <w:br/> at the start of a paragraph
      // (e.g., signature blocks with blank lines before "By:" text). These leading
      // line breaks must create an empty line, not be silently dropped.
      const block: FlowBlock = {
        kind: 'paragraph',
        id: '0-paragraph',
        runs: [
          { kind: 'lineBreak' },
          {
            text: 'By: ___________________________',
            fontFamily: 'Arial',
            fontSize: 14,
          },
        ],
        attrs: {},
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 500));

      // Should have 2 lines: an empty line from the leading lineBreak, then the text
      expect(measure.lines).toHaveLength(2);
      expect(measure.lines[0].width).toBe(0); // Empty line from leading lineBreak
      expect(measure.lines[1].width).toBeGreaterThan(0); // "By: ___" text
    });

    it('handles multiple leading lineBreaks at start of paragraph', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: '0-paragraph',
        runs: [
          { kind: 'lineBreak' },
          { kind: 'lineBreak' },
          {
            text: 'Content after two breaks',
            fontFamily: 'Arial',
            fontSize: 14,
          },
        ],
        attrs: {},
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 500));

      // Should have 3 lines: two empty lines, then text
      expect(measure.lines).toHaveLength(3);
      expect(measure.lines[0].width).toBe(0);
      expect(measure.lines[1].width).toBe(0);
      expect(measure.lines[2].width).toBeGreaterThan(0);
    });

    it('uses the first text run font size for leading lineBreak height', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: '0-paragraph',
        runs: [
          { kind: 'lineBreak' },
          {
            text: 'Heading text',
            fontFamily: 'Arial',
            fontSize: 24,
          },
        ],
        attrs: {},
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 500));

      expect(measure.lines).toHaveLength(2);
      expect(measure.lines[0].lineHeight).toBeCloseTo(measure.lines[1].lineHeight, 3);
    });
  });

  describe('multi-run blocks', () => {
    it('measures blocks with multiple runs', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: '0-paragraph',
        runs: [
          {
            text: 'Hello ',
            fontFamily: 'Arial',
            fontSize: 16,
          },
          {
            text: 'world',
            fontFamily: 'Arial',
            fontSize: 16,
            bold: true,
          },
        ],
        attrs: {},
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));

      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0].fromRun).toBe(0);
      expect(measure.lines[0].toRun).toBeGreaterThanOrEqual(0);
      expect(measure.totalHeight).toBeGreaterThan(0);
    });

    it('breaks across multiple runs correctly', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: '0-paragraph',
        runs: [
          {
            text: 'This is ',
            fontFamily: 'Arial',
            fontSize: 16,
          },
          {
            text: 'a very long text ',
            fontFamily: 'Arial',
            fontSize: 16,
            bold: true,
          },
          {
            text: 'that spans multiple runs',
            fontFamily: 'Arial',
            fontSize: 16,
            italic: true,
          },
        ],
        attrs: {},
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 150));

      expect(measure.lines.length).toBeGreaterThan(1);
      // Lines should reference the correct run indices
      measure.lines.forEach((line) => {
        expect(line.fromRun).toBeGreaterThanOrEqual(0);
        expect(line.toRun).toBeLessThanOrEqual(2);
        expect(line.toRun).toBeGreaterThanOrEqual(line.fromRun);
      });
    });

    it('measures empty inline SDT placeholders using the visible placeholder text width', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'empty-inline-sdt',
        runs: [
          {
            kind: 'text',
            text: '',
            fontFamily: 'Arial',
            fontSize: 16,
            pmStart: 10,
            pmEnd: 10,
            visualPlaceholder: 'emptyInlineSdt',
            sdt: { type: 'structuredContent', scope: 'inline', id: 'sdt-empty' },
          },
        ],
        attrs: {},
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));

      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0]).toMatchObject({ fromRun: 0, fromChar: 0, toRun: 0, toChar: 0 });
      expect(measure.lines[0].width).toBeGreaterThan(8);
      expect(measure.lines[0].segments).toHaveLength(1);
      expect(measure.lines[0].segments[0]).toMatchObject({ runIndex: 0, fromChar: 0, toChar: 0 });
      expect(measure.lines[0].segments[0].width).toBe(measure.lines[0].width);
    });

    it('applies textTransform when measuring empty SDT placeholder text', async () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      expect(ctx).not.toBeNull();
      ctx!.font = `16px ${resolvePhysicalFamily('Arial')}`;
      const transformedPlaceholderText = EMPTY_SDT_PLACEHOLDER_TEXT.toUpperCase();
      const transformedWidth = ctx!.measureText(transformedPlaceholderText).width;
      const untransformedWidth = ctx!.measureText(EMPTY_SDT_PLACEHOLDER_TEXT).width;
      expect(transformedWidth).not.toBeCloseTo(untransformedWidth, 2);

      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'empty-inline-sdt-uppercase',
        runs: [
          {
            kind: 'text',
            text: '',
            fontFamily: 'Arial',
            fontSize: 16,
            textTransform: 'uppercase',
            visualPlaceholder: 'emptyInlineSdt',
            sdt: { type: 'structuredContent', scope: 'inline', id: 'sdt-empty-uppercase' },
          },
        ],
        attrs: {},
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));

      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0].width).toBeCloseTo(transformedWidth, 2);
    });
  });

  describe('advanced styling', () => {
    it('accounts for letter spacing in measured width', async () => {
      const baseBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'letters',
        runs: [{ text: 'Spacing test', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {},
      };

      const spacedBlock: FlowBlock = {
        ...baseBlock,
        id: 'letters-spaced',
        runs: [{ ...baseBlock.runs[0], letterSpacing: 2 }],
      };

      const baseMeasure = expectParagraphMeasure(await measureBlock(baseBlock, 400));
      const spacedMeasure = expectParagraphMeasure(await measureBlock(spacedBlock, 400));

      expect(spacedMeasure.lines[0].width).toBeGreaterThan(baseMeasure.lines[0].width);
    });

    it('uses horizontal glyph scaling for width and line breaking', async () => {
      const text = 'dated February 2025';
      const baseBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'unscaled-width',
        runs: [{ text, fontFamily: 'Arial', fontSize: 16 }],
        attrs: {},
      };
      const natural = expectParagraphMeasure(await measureBlock(baseBlock, 1000));
      const scaledBlock: FlowBlock = {
        ...baseBlock,
        id: 'scaled-width',
        runs: [{ ...baseBlock.runs[0], horizontalScale: 0.9 }],
      };
      const scaledNatural = expectParagraphMeasure(await measureBlock(scaledBlock, 1000));
      const widthBetween = natural.lines[0].width * 0.95;
      const unscaledWrapped = expectParagraphMeasure(await measureBlock(baseBlock, widthBetween));
      const scaledFits = expectParagraphMeasure(await measureBlock(scaledBlock, widthBetween));

      expect(scaledNatural.lines[0].width).toBeCloseTo(natural.lines[0].width * 0.9, 2);
      expect(unscaledWrapped.lines.length).toBeGreaterThan(1);
      expect(scaledFits.lines).toHaveLength(1);
    });

    it('reduces available width when paragraph indent is set', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'indented',
        runs: [
          {
            text: 'This is a long paragraph that should wrap to multiple lines when indented.',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {
          indent: { left: 40, right: 20, firstLine: 30 },
        },
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 400));
      const effectiveWidth = 400 - 40 - 20 - 30;
      expect(measure.lines[0].width).toBeLessThanOrEqual(effectiveWidth + 5);
    });

    it('aligns runs using decimal tab stops when defined', async () => {
      const decimalBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'decimal-tab',
        runs: [
          {
            text: 'Price:\t12.99',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {
          tabs: [{ pos: 72, align: 'decimal' }],
        },
      };

      const leftBlock: FlowBlock = {
        ...decimalBlock,
        id: 'left-tab',
        attrs: {
          tabs: [{ pos: 72, align: 'left' }],
        },
      };

      const decimalMeasure = expectParagraphMeasure(await measureBlock(decimalBlock, 400));
      const leftMeasure = expectParagraphMeasure(await measureBlock(leftBlock, 400));

      expect(decimalMeasure.lines[0].width).toBeLessThanOrEqual(leftMeasure.lines[0].width);
    });

    it('respects locale-specific decimal separators', async () => {
      const decimalBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'decimal-tab-comma',
        runs: [
          {
            text: 'Total:	12,75',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {
          tabs: [{ pos: 72, align: 'decimal' }],
          decimalSeparator: ',',
        },
      };

      const controlBlock: FlowBlock = {
        ...decimalBlock,
        id: 'decimal-tab-left-control',
        attrs: {
          tabs: [{ pos: 72, align: 'left' }],
        },
      };

      const decimalMeasure = expectParagraphMeasure(await measureBlock(decimalBlock, 400));
      const controlMeasure = expectParagraphMeasure(await measureBlock(controlBlock, 400));

      expect(decimalMeasure.lines[0].width).toBeLessThanOrEqual(controlMeasure.lines[0].width);
    });

    it('centers the segment after a center tab stop', async () => {
      const centerBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'center-tab',
        runs: [{ text: 'Title\tCentered', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {
          // Using legacy shape for brevity; engine path normalizes internally
          tabs: [{ pos: 100, align: 'center' }],
        },
      };

      const leftBlock: FlowBlock = {
        ...centerBlock,
        id: 'center-tab-left',
        attrs: { tabs: [{ pos: 100, align: 'left' }] },
      };

      const centerMeasure = expectParagraphMeasure(await measureBlock(centerBlock, 400));
      const leftMeasure = expectParagraphMeasure(await measureBlock(leftBlock, 400));

      // Center alignment should not exceed left-aligned width for the same stop
      expect(centerMeasure.lines[0].width).toBeLessThanOrEqual(leftMeasure.lines[0].width);
      expect(centerMeasure.lines[0].width).toBeGreaterThan(0);
    });

    it('right-aligns the segment after an end tab stop', async () => {
      const endBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'end-tab',
        runs: [{ text: 'Total\t123.45', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {
          tabs: [{ pos: 120, align: 'right' }],
        },
      };

      const leftBlock: FlowBlock = {
        ...endBlock,
        id: 'end-tab-left',
        attrs: { tabs: [{ pos: 120, align: 'left' }] },
      };

      const endMeasure = expectParagraphMeasure(await measureBlock(endBlock, 400));
      const leftMeasure = expectParagraphMeasure(await measureBlock(leftBlock, 400));

      // End alignment places text so its right edge hits the stop; width should be reasonable
      expect(endMeasure.lines[0].width).toBeLessThanOrEqual(leftMeasure.lines[0].width);
      expect(endMeasure.lines[0].width).toBeGreaterThan(0);
    });

    it('defaults to period (.) when decimalSeparator not specified', async () => {
      const decimalBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'decimal-tab-default',
        runs: [
          {
            text: 'Price:	99.99',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {
          tabs: [{ pos: 72, align: 'decimal' }],
          // decimalSeparator not specified - should default to '.'
        },
      };

      const controlBlock: FlowBlock = {
        ...decimalBlock,
        id: 'decimal-tab-left-control',
        attrs: {
          tabs: [{ pos: 72, align: 'left' }],
        },
      };

      const decimalMeasure = expectParagraphMeasure(await measureBlock(decimalBlock, 400));
      const controlMeasure = expectParagraphMeasure(await measureBlock(controlBlock, 400));

      // With decimal alignment on '.', the text should align properly
      expect(decimalMeasure.lines[0].width).toBeLessThanOrEqual(controlMeasure.lines[0].width);
      expect(decimalMeasure.lines[0].width).toBeGreaterThan(0);
    });

    it('falls back to tab position when decimal separator is absent', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'decimal-missing',
        runs: [
          {
            text: 'Total:\tValue',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {
          tabs: [{ pos: 60, align: 'decimal' }],
        },
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 400));
      expect(measure.lines[0].width).toBeGreaterThan(0);
    });

    it('right-aligns multiple runs after an end tab stop as a group', async () => {
      // This tests the "Page 1 of 2" footer scenario where multiple runs follow a right-aligned tab.
      // All content after the tab should be treated as a unit for alignment purposes,
      // matching Microsoft Word's behavior.
      const multiRunBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'multi-run-end-tab',
        runs: [
          { kind: 'tab' } as Run,
          { text: 'Page ', fontFamily: 'Arial', fontSize: 12 },
          { text: '1', fontFamily: 'Arial', fontSize: 12, bold: true },
          { text: ' of ', fontFamily: 'Arial', fontSize: 12 },
          { text: '2', fontFamily: 'Arial', fontSize: 12, bold: true },
        ],
        attrs: {
          tabs: [{ pos: 300, val: 'end' }],
        },
      };

      // Single run version for comparison
      const singleRunBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'single-run-end-tab',
        runs: [{ kind: 'tab' } as Run, { text: 'Page 1 of 2', fontFamily: 'Arial', fontSize: 12 }],
        attrs: {
          tabs: [{ pos: 300, val: 'end' }],
        },
      };

      const multiRunMeasure = expectParagraphMeasure(await measureBlock(multiRunBlock, 400));
      const singleRunMeasure = expectParagraphMeasure(await measureBlock(singleRunBlock, 400));

      // Both should fit on a single line
      expect(multiRunMeasure.lines).toHaveLength(1);
      expect(singleRunMeasure.lines).toHaveLength(1);

      // The line widths should be approximately equal (both end at the tab stop)
      // The multi-run version should NOT wrap due to improper segment-by-segment alignment
      expect(multiRunMeasure.lines[0].width).toBeCloseTo(singleRunMeasure.lines[0].width, 0);

      // The first segment after the tab should have an explicit x position
      const multiRunSegments = multiRunMeasure.lines[0].segments;
      expect(multiRunSegments).toBeDefined();
      expect(multiRunSegments!.length).toBeGreaterThan(1);

      // Find the first text segment (after the tab run at index 0)
      const firstTextSegment = multiRunSegments!.find((s) => s.runIndex > 0);
      expect(firstTextSegment).toBeDefined();
      expect(firstTextSegment!.x).toBeDefined();
      // The x position should be less than the tab stop (content is right-aligned)
      expect(firstTextSegment!.x).toBeLessThan(300);
    });

    it('positions leading spaces correctly in tab alignment groups', async () => {
      // Regression test: leading spaces in runs after a tab must advance the X position.
      // Bug: " of " run's leading space was positioned but didn't update activeTabGroup.currentX,
      // causing "of " to overlap with the space at the same X position.
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'space-positioning-test',
        runs: [
          { kind: 'tab' } as Run,
          { text: 'A', fontFamily: 'Arial', fontSize: 12 },
          { text: ' B', fontFamily: 'Arial', fontSize: 12 }, // Leading space before B
        ],
        attrs: {
          tabs: [{ pos: 200, val: 'end' }],
        },
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 300));
      expect(measure.lines).toHaveLength(1);

      const segments = measure.lines[0].segments!;
      // Should have: tab segment, "A" segment, " " (space) segment, "B" segment
      // Find segments by content
      const textSegments = segments.filter((s) => s.runIndex > 0);
      expect(textSegments.length).toBeGreaterThanOrEqual(3); // A, space, B (at minimum)

      // All text segments should have explicit X positions (in tab alignment group)
      for (const seg of textSegments) {
        expect(seg.x).toBeDefined();
      }

      // Verify segments don't overlap: each segment's X should be >= previous segment's X + width
      for (let i = 1; i < textSegments.length; i++) {
        const prev = textSegments[i - 1];
        const curr = textSegments[i];
        // Current X should be at or after previous segment ends
        expect(curr.x).toBeGreaterThanOrEqual(prev.x! + prev.width - 0.5); // Allow small rounding tolerance
      }
    });

    it('converts spacing multipliers using the font natural-line height', async () => {
      const fontSize = 16;
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'spaced',
        runs: [
          {
            text: 'Line height test',
            fontFamily: 'Arial',
            fontSize,
          },
        ],
        attrs: {
          spacing: { line: 1.5, lineUnit: 'multiplier', lineRule: 'auto' },
        },
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 400));
      expect(measure.lines[0].lineHeight).toBeCloseTo(1.5 * 1.15 * fontSize, 1);
    });

    it('keeps Calibri line metrics when Carlito is the physical substitute', async () => {
      const fontSize = 12;
      const canvasContext = {
        font: '',
        fontKerning: 'auto',
        measureText: vi.fn((text: string) => ({
          width: text.length * 6,
          actualBoundingBoxAscent: 9,
          actualBoundingBoxDescent: 2,
        })),
      } as unknown as CanvasRenderingContext2D;
      const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(canvasContext);
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'calibri-through-carlito-line-height',
        runs: [{ text: 'Order form text', fontFamily: 'Calibri, sans-serif', fontSize }],
        attrs: {
          spacing: { line: 216 / 240, lineUnit: 'multiplier', lineRule: 'auto' },
        },
      };

      clearTextMeasurementCaches();
      try {
        const measure = expectParagraphMeasure(
          await measureBlock(block, 400, {
            fontSignature: 'calibri-through-carlito',
            resolvePhysical: () => 'Carlito, sans-serif',
          }),
        );

        expect(canvasContext.font).toBe('12px Carlito, sans-serif');
        expect(measure.lines[0].lineHeight).toBeCloseTo(fontSize * 1.219 * (216 / 240), 4);
      } finally {
        getContext.mockRestore();
        clearTextMeasurementCaches();
      }
    });

    it('applies higher auto multipliers to the baseline line height', async () => {
      const fontSize = 16;
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'double-spaced',
        runs: [
          {
            text: 'Double spaced text',
            fontFamily: 'Arial',
            fontSize,
          },
        ],
        attrs: {
          spacing: { line: 2, lineUnit: 'multiplier', lineRule: 'auto' },
        },
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 400));
      expect(measure.lines[0].lineHeight).toBeCloseTo(2 * 1.15 * fontSize, 1);
    });

    it('applies large auto values as multipliers', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'absolute-spacing',
        runs: [
          {
            text: 'Absolute spacing',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {
          spacing: { line: 42, lineUnit: 'multiplier', lineRule: 'auto' },
        },
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 400));
      expect(measure.lines[0].lineHeight).toBeCloseTo(42 * 1.15 * 16, 1);
    });

    it('does not clamp line height for very small fonts', async () => {
      const smallFontSize = 8; // Very small font
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'small-font',
        runs: [
          {
            text: 'Tiny text',
            fontFamily: 'Arial',
            fontSize: smallFontSize,
          },
        ],
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 400));
      const expectedLineHeight = smallFontSize * 1.15; // 8 * 1.15 = 9.2px
      expect(measure.lines[0].lineHeight).toBeCloseTo(expectedLineHeight, 1);
      expect(measure.lines[0].lineHeight).toBeLessThan(16);
    });

    it('uses the frozen-main 1.15 baseline for normal fonts when spacing is absent', async () => {
      const fontSize = 20;
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'normal-font',
        runs: [
          {
            text: 'Normal text',
            fontFamily: 'Arial',
            fontSize,
          },
        ],
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 400));
      const expectedLineHeight = fontSize * 1.15; // 20 * 1.15 = 23px
      expect(measure.lines[0].lineHeight).toBeCloseTo(expectedLineHeight, 1);
    });

    it('uses the measured Word natural line pitch for Nunito Sans', async () => {
      const fontSize = 44 / 3;
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'nunito-word-line-pitch',
        runs: [{ text: 'Employee Share Option Scheme', fontFamily: 'Nunito Sans, sans-serif', fontSize }],
        attrs: {
          spacing: { line: 1, lineUnit: 'multiplier', lineRule: 'auto' },
        },
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 400));
      expect(measure.lines[0].lineHeight).toBeCloseTo(20.16, 3);
    });

    it('uses deterministic metrics from the exact embedded face context', async () => {
      const fontSize = 12;
      const multiplier = 2581 / 2048;
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'embedded-natural-line-pitch',
        runs: [{ text: 'Embedded Helvetica Neue', fontFamily: 'Helvetica Neue', fontSize }],
      };

      const measure = expectParagraphMeasure(
        await measureBlock(block, 400, {
          fontSignature: 'embedded:1',
          resolvePhysical: () => '__embedded_Helvetica_Neue',
          resolveNaturalLineMultiplier: (_family, face) => (face.weight === '400' ? multiplier : undefined),
        }),
      );
      expect(measure.lines[0].lineHeight).toBeCloseTo(fontSize * multiplier, 6);
    });

    it('bypasses 1.15 base with exact lineRule', async () => {
      const fontSize = 16;
      const exactHeight = 30;
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'exact-height',
        runs: [
          {
            text: 'Exact line height',
            fontFamily: 'Arial',
            fontSize,
          },
        ],
        attrs: {
          spacing: { line: exactHeight, lineRule: 'exact' },
        },
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 400));
      // With lineRule: 'exact', should use the exact value, not the 1.15 base
      expect(measure.lines[0].lineHeight).toBeCloseTo(exactHeight, 1);
    });

    it('uses max of base and specified value with atLeast lineRule', async () => {
      const fontSize = 16;
      const atLeastHeight = 12; // Less than base (16 * 1.15 = 18.4)
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'at-least-height',
        runs: [
          {
            text: 'At least line height',
            fontFamily: 'Arial',
            fontSize,
          },
        ],
        attrs: {
          spacing: { line: atLeastHeight, lineRule: 'atLeast' },
        },
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 400));
      // With lineRule: 'atLeast', should use max of base (18.4) and specified (12)
      const baseLineHeight = fontSize * 1.15; // 18.4
      expect(measure.lines[0].lineHeight).toBeCloseTo(baseLineHeight, 1);
    });

    it('ensures line height is never smaller than glyph bounds to prevent clipping', async () => {
      // This test verifies the clamp: Math.max(fontSize * 1.15, ascent + descent)
      // For any font, line height must be >= ascent + descent to prevent glyph overlap
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'clamp-test',
        runs: [
          {
            text: 'Test clipping prevention',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 400));
      const glyphBounds = measure.lines[0].ascent + measure.lines[0].descent;
      // Line height must always accommodate the full glyph bounds
      expect(measure.lines[0].lineHeight).toBeGreaterThanOrEqual(glyphBounds);
    });

    it('measures list blocks and returns marker widths and indents', async () => {
      const listBlock: FlowBlock = {
        kind: 'list',
        id: 'list-1',
        listType: 'number',
        items: [
          {
            id: 'item-1',
            marker: { kind: 'number', text: '1.', level: 0, order: 1 },
            paragraph: {
              kind: 'paragraph',
              id: 'para-1',
              runs: [{ text: 'First', fontFamily: 'Arial', fontSize: 16 }],
              attrs: { indent: { left: 24, hanging: 18 } },
            },
          },
          {
            id: 'item-2',
            marker: { kind: 'number', text: '2.', level: 0, order: 2 },
            paragraph: {
              kind: 'paragraph',
              id: 'para-2',
              runs: [{ text: 'Second', fontFamily: 'Arial', fontSize: 16 }],
              attrs: { indent: { left: 24, hanging: 18 } },
            },
          },
        ],
      };

      const measure = await measureBlock(listBlock, 400);
      expect(measure.kind).toBe('list');
      if (measure.kind !== 'list') throw new Error('expected list measure');
      expect(measure.items).toHaveLength(2);
      expect(measure.items[0].markerWidth).toBeGreaterThan(0);
      expect(measure.items[0].markerTextWidth).toBeGreaterThan(0);
      expect(measure.items[0].indentLeft).toBe(24);
      expect(measure.totalHeight).toBeGreaterThan(0);
    });
  });

  describe('typography metrics', () => {
    it('calculates correct metrics for standard font size', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: '0-paragraph',
        runs: [
          {
            text: 'Test',
            fontFamily: 'Arial',
            fontSize: 20,
          },
        ],
        attrs: {},
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));

      // Typography metrics now use actual Canvas API measurements instead of hardcoded ratios
      // This prevents text clipping for fonts with non-standard ascent/descent ratios
      expect(measure.lines[0].ascent).toBeGreaterThan(0);
      expect(measure.lines[0].ascent).toBeLessThan(20 * 1.2); // Reasonable for 20px font
      expect(measure.lines[0].descent).toBeGreaterThan(0);
      expect(measure.lines[0].descent).toBeLessThan(20 * 0.5);
      // lineHeight should be at least ascent + descent
      expect(measure.lines[0].lineHeight).toBeGreaterThanOrEqual(measure.lines[0].ascent + measure.lines[0].descent);
    });

    it('uses the largest fontSize in a line for metrics', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: '0-paragraph',
        runs: [
          {
            text: 'Small ',
            fontFamily: 'Arial',
            fontSize: 12,
          },
          {
            text: 'Large',
            fontFamily: 'Arial',
            fontSize: 24,
          },
        ],
        attrs: {},
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));

      // Should use the larger font size (24) for line metrics
      // With actual font metrics, lineHeight is based on actual glyph bounds, not fontSize
      expect(measure.lines[0].lineHeight).toBeGreaterThan(20); // Should be based on 24px font
      expect(measure.lines[0].ascent).toBeGreaterThan(16); // Should reflect larger font
    });

    it('combines same-size run metrics without depending on run order', async () => {
      const makeSingleRunBlock = (fontFamily: string): FlowBlock => ({
        kind: 'paragraph',
        id: fontFamily,
        runs: [{ text: 'Single face', fontFamily, fontSize: 16 }],
        attrs: {},
      });
      const makeMixedBlock = (timesFirst: boolean): FlowBlock => ({
        kind: 'paragraph',
        id: timesFirst ? 'times-first' : 'arial-first',
        runs: timesFirst
          ? [
              { text: 'Times ', fontFamily: 'Times New Roman', fontSize: 16 },
              { text: 'Arial', fontFamily: 'Arial', fontSize: 16 },
            ]
          : [
              { text: 'Arial ', fontFamily: 'Arial', fontSize: 16 },
              { text: 'Times', fontFamily: 'Times New Roman', fontSize: 16 },
            ],
        attrs: {},
      });

      const times = expectParagraphMeasure(await measureBlock(makeSingleRunBlock('Times New Roman'), 1000)).lines[0];
      const arial = expectParagraphMeasure(await measureBlock(makeSingleRunBlock('Arial'), 1000)).lines[0];
      const timesFirst = expectParagraphMeasure(await measureBlock(makeMixedBlock(true), 1000)).lines[0];
      const arialFirst = expectParagraphMeasure(await measureBlock(makeMixedBlock(false), 1000)).lines[0];
      const expectedAscent = Math.max(times.ascent, arial.ascent);
      const expectedDescent = Math.max(times.descent, arial.descent);

      expect(timesFirst.ascent).toBe(expectedAscent);
      expect(timesFirst.descent).toBe(expectedDescent);
      expect(arialFirst.ascent).toBe(expectedAscent);
      expect(arialFirst.descent).toBe(expectedDescent);
      expect(timesFirst.lineHeight).toBe(arialFirst.lineHeight);
    });
  });

  describe('styling variations', () => {
    it('measures bold text correctly', async () => {
      const plainBlock: FlowBlock = {
        kind: 'paragraph',
        id: '0-paragraph',
        runs: [
          {
            text: 'Hello world',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      const boldBlock: FlowBlock = {
        kind: 'paragraph',
        id: '1-paragraph',
        runs: [
          {
            text: 'Hello world',
            fontFamily: 'Arial',
            fontSize: 16,
            bold: true,
          },
        ],
        attrs: {},
      };

      const plainMeasure = expectParagraphMeasure(await measureBlock(plainBlock, 1000));
      const boldMeasure = expectParagraphMeasure(await measureBlock(boldBlock, 1000));

      // Bold text should generally be wider
      expect(boldMeasure.lines[0].width).toBeGreaterThan(plainMeasure.lines[0].width);
    });

    it('measures italic text correctly', async () => {
      const plainBlock: FlowBlock = {
        kind: 'paragraph',
        id: '0-paragraph',
        runs: [
          {
            text: 'Hello world',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      const italicBlock: FlowBlock = {
        kind: 'paragraph',
        id: '1-paragraph',
        runs: [
          {
            text: 'Hello world',
            fontFamily: 'Arial',
            fontSize: 16,
            italic: true,
          },
        ],
        attrs: {},
      };

      const plainMeasure = expectParagraphMeasure(await measureBlock(plainBlock, 1000));
      const italicMeasure = expectParagraphMeasure(await measureBlock(italicBlock, 1000));

      // Both should have width > 0
      expect(italicMeasure.lines[0].width).toBeGreaterThan(0);
      expect(plainMeasure.lines[0].width).toBeGreaterThan(0);
    });
  });

  describe('edge cases', () => {
    it('handles block with empty runs array', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: '0-paragraph',
        runs: [],
        attrs: {},
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 200));

      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0].width).toBe(0);
      expect(measure.totalHeight).toBeGreaterThan(0);
    });

    it('handles very narrow maxWidth', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: '0-paragraph',
        runs: [
          {
            text: 'Test',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      // Even with narrow width, should produce valid measure
      const measure = expectParagraphMeasure(await measureBlock(block, 10));

      expect(measure.lines.length).toBeGreaterThanOrEqual(1);
      expect(measure.totalHeight).toBeGreaterThan(0);
    });

    it('handles single long word exceeding maxWidth by breaking mid-word', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: '0-paragraph',
        runs: [
          {
            text: 'Supercalifragilisticexpialidocious',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 100));

      // Should break the word across multiple lines, with each line fitting within maxWidth
      expect(measure.lines.length).toBeGreaterThan(1);
      // Each line (except possibly the last) should fit within maxWidth
      for (let i = 0; i < measure.lines.length - 1; i++) {
        expect(measure.lines[i].width).toBeLessThanOrEqual(100);
      }
      // All lines together should contain the full word
      const totalChars = measure.lines.reduce((sum, line) => sum + (line.toChar - line.fromChar), 0);
      expect(totalChars).toBe('Supercalifragilisticexpialidocious'.length);
    });
  });

  describe('mid-word breaking for table cells', () => {
    it('breaks a long word into multiple lines that fit within narrow maxWidth', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'mid-word-test-1',
        runs: [
          {
            text: 'Antidisestablishmentarianism',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      // Use a narrow maxWidth to force breaking
      const measure = expectParagraphMeasure(await measureBlock(block, 80));

      // Should break into multiple lines
      expect(measure.lines.length).toBeGreaterThan(1);

      // Each line should fit within maxWidth (with some tolerance for the last line)
      for (let i = 0; i < measure.lines.length - 1; i++) {
        expect(measure.lines[i].width).toBeLessThanOrEqual(80 + 1); // +1 for floating point
      }
    });

    it('preserves correct character positions when breaking mid-word', async () => {
      const word = 'HelloWorld';
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'mid-word-test-2',
        runs: [
          {
            text: word,
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      // Use very narrow width to force multiple breaks
      const measure = expectParagraphMeasure(await measureBlock(block, 40));

      // Verify character continuity - each line should pick up where the last left off
      let lastChar = 0;
      for (const line of measure.lines) {
        expect(line.fromChar).toBe(lastChar);
        expect(line.toChar).toBeGreaterThan(line.fromChar);
        lastChar = line.toChar;
      }

      // All characters should be accounted for
      expect(lastChar).toBe(word.length);
    });

    it('finishes existing line content before breaking a long word', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'mid-word-test-3',
        runs: [
          {
            text: 'Hi Supercalifragilisticexpialidocious',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 100));

      // First line should contain "Hi " before the long word breaks
      expect(measure.lines.length).toBeGreaterThan(1);

      // The first line should have content from "Hi " or be part of the broken word
      // Total chars should equal the full text length
      const totalChars = measure.lines.reduce((sum, line) => sum + (line.toChar - line.fromChar), 0);
      expect(totalChars).toBe('Hi Supercalifragilisticexpialidocious'.length);
    });

    it('handles words that fit exactly without unnecessary breaking', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'mid-word-test-4',
        runs: [
          {
            text: 'Hello',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      // First measure to get the exact width
      const initialMeasure = expectParagraphMeasure(await measureBlock(block, 1000));
      const exactWidth = initialMeasure.lines[0].width;

      // Now measure with maxWidth equal to text width - should NOT break
      const exactMeasure = expectParagraphMeasure(await measureBlock(block, exactWidth));
      expect(exactMeasure.lines).toHaveLength(1);
    });

    it('handles very narrow cells with at least one character per line', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'mid-word-test-5',
        runs: [
          {
            text: 'ABC',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      // Use extremely narrow width (1px) - should still render each character
      const measure = expectParagraphMeasure(await measureBlock(block, 1));

      // Should have at least 1 character per line
      for (const line of measure.lines) {
        expect(line.toChar - line.fromChar).toBeGreaterThanOrEqual(1);
      }

      // All characters should be present
      const totalChars = measure.lines.reduce((sum, line) => sum + (line.toChar - line.fromChar), 0);
      expect(totalChars).toBe(3);
    });
  });

  describe('deterministic behavior', () => {
    it('produces consistent results for the same input', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: '0-paragraph',
        runs: [
          {
            text: 'Consistent measurement test',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      const measure1 = expectParagraphMeasure(await measureBlock(block, 200));
      const measure2 = expectParagraphMeasure(await measureBlock(block, 200));

      expect(measure1.lines.length).toBe(measure2.lines.length);
      expect(measure1.totalHeight).toBe(measure2.totalHeight);
      expect(measure1.lines[0].width).toBe(measure2.lines[0].width);
    });
  });

  describe('tab measurement', () => {
    it('measures a simple tab with default tab stops', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: '0-paragraph',
        runs: [
          {
            text: 'Before',
            fontFamily: 'Arial',
            fontSize: 16,
          },
          {
            kind: 'tab',
            text: '\t',
            pmStart: 6,
            pmEnd: 7,
          },
          {
            text: 'After',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));

      expect(measure.lines).toHaveLength(1);
      // Tab run should have computed width
      const tabRun = block.runs[1];
      expect(tabRun.kind).toBe('tab');
      if (tabRun.kind === 'tab') {
        expect(tabRun.width).toBeGreaterThan(0);
      }
    });

    it('measures tab with explicit tab stops', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: '0-paragraph',
        runs: [
          {
            text: 'Name',
            fontFamily: 'Arial',
            fontSize: 16,
          },
          {
            kind: 'tab',
            text: '\t',
            tabStops: [{ pos: 200, val: 'left' }],
            tabIndex: 0,
            pmStart: 4,
            pmEnd: 5,
          },
          {
            text: 'Value',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));

      expect(measure.lines).toHaveLength(1);
      const tabRun = block.runs[1];
      if (tabRun.kind === 'tab') {
        expect(tabRun.width).toBeGreaterThan(0);
        // Width should move text to position near 200px
        expect(tabRun.width).toBeLessThan(200);
      }
    });

    it('keeps explicit payment columns on the paragraph grid for hanging list markers', async () => {
      const twipsPerPx = 15;
      const indentLeft = 1417 / twipsPerPx;
      const euroStop = 7943 / twipsPerPx;
      const atStop = 9026 / twipsPerPx;
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'sd-3744-hanging-list-explicit-tabs',
        runs: [
          { text: 'de huurprijs', fontFamily: 'Arial', fontSize: 16 },
          { kind: 'tab', text: '\t', tabIndex: 0 },
          { text: '€', fontFamily: 'Arial', fontSize: 16 },
          { kind: 'tab', text: '\t', tabIndex: 1 },
          { text: '@', fontFamily: 'Arial', fontSize: 16 },
        ],
        attrs: {
          alignment: 'justify',
          indent: { left: indentLeft, hanging: 347 / twipsPerPx },
          tabs: [
            { pos: 1417, val: 'start' },
            { pos: 7943, val: 'start' },
            { pos: 9026, val: 'start' },
          ],
          wordLayout: {
            indentLeftPx: indentLeft,
            hangingPx: 347 / twipsPerPx,
            tabsPx: [indentLeft, euroStop, atStop],
            textStartPx: indentLeft,
            marker: {
              markerText: '•',
              markerBoxWidthPx: 347 / twipsPerPx,
              markerX: (1417 - 347) / twipsPerPx,
              textStartX: indentLeft,
              gutterWidthPx: 8,
              justification: 'left',
              suffix: 'tab',
              run: { fontFamily: 'Symbol', fontSize: 14 },
            },
          },
        },
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 800));
      const euroSegment = measure.lines[0].segments?.find((segment) => segment.runIndex === 2);
      const atSegment = measure.lines[0].segments?.find((segment) => segment.runIndex === 4);

      expect((euroSegment?.x ?? Number.NaN) + indentLeft).toBeCloseTo(euroStop, 5);
      expect((atSegment?.x ?? Number.NaN) + indentLeft).toBeCloseTo(atStop, 5);
    });

    it('keeps literal-tab segment coordinates aligned with authored run boundaries', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'sd-3886-literal-tab-run-boundary',
        runs: [
          { text: '1.2\tName. ', fontFamily: 'Arial', fontSize: 16, bold: true },
          { text: 'Body', fontFamily: 'Arial', fontSize: 16 },
        ],
        attrs: { tabs: [{ pos: 480, val: 'start' }] },
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));
      const paintedSegments = extractSegmentText(block, measure.lines[0]);

      expect(paintedSegments.join('')).toBe('1.2Name. Body');
      expect(paintedSegments.at(-1)).toBe('Body');
      expect(measure.lines[0]).toMatchObject({ fromRun: 0, fromChar: 0, toRun: 1, toChar: 4 });
    });

    it.each([
      { label: 'at the start', literal: '\tName', visibleRanges: [[1, 5]] },
      { label: 'at the end', literal: 'Name\t', visibleRanges: [[0, 4]] },
      {
        label: 'multiple times',
        literal: 'A\tB\tC',
        visibleRanges: [
          [0, 1],
          [2, 3],
          [4, 5],
        ],
      },
      {
        label: 'consecutively',
        literal: 'A\t\tB',
        visibleRanges: [
          [0, 1],
          [3, 4],
        ],
      },
    ])('preserves source coordinates when a literal tab occurs $label', async ({ label, literal, visibleRanges }) => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: `literal-tab-${label.replaceAll(' ', '-')}`,
        runs: [
          {
            text: literal,
            fontFamily: 'Arial',
            fontSize: 16,
            bold: true,
            pmStart: 100,
            pmEnd: 100 + literal.length,
          },
          {
            text: 'Tail',
            fontFamily: 'Arial',
            fontSize: 16,
            pmStart: 100 + literal.length,
            pmEnd: 104 + literal.length,
          },
        ],
        attrs: {
          tabs: [
            { pos: 480, val: 'start' },
            { pos: 960, val: 'start' },
          ],
        },
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));
      const line = measure.lines[0];
      const literalSegments = line.segments?.filter((segment) => segment.runIndex === 0) ?? [];
      const tailSegment = line.segments?.at(-1);

      expect(measure.lines).toHaveLength(1);
      expect(extractSegmentText(block, line).join('')).toBe(`${literal.replaceAll('\t', '')}Tail`);
      expect(literalSegments.map(({ fromChar, toChar }) => [fromChar, toChar])).toEqual(visibleRanges);
      expect(tailSegment).toMatchObject({ runIndex: 1, fromChar: 0, toChar: 4 });
      expect(line).toMatchObject({ fromRun: 0, fromChar: 0, toRun: 1, toChar: 4 });
    });

    it('keeps literal-tab coordinates aligned across wrapping and an adjacent run', async () => {
      const body = 'BodyTextThatWrapsAcrossSeveralLines';
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'literal-tab-wrapping',
        runs: [
          { text: '1.2\tHeading', fontFamily: 'Arial', fontSize: 16, bold: true },
          { text: body, fontFamily: 'Arial', fontSize: 16 },
        ],
        attrs: { tabs: [{ pos: 480, val: 'start' }] },
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 110));
      const paintedText = measure.lines.flatMap((line) => extractSegmentText(block, line)).join('');

      expect(measure.lines.length).toBeGreaterThan(1);
      expect(paintedText).toBe(`1.2Heading${body}`);
      expect(paintedText.match(/1\.2/g)).toHaveLength(1);
      expect(measure.lines.flatMap((line) => line.segments ?? []).some((segment) => segment.runIndex === 1)).toBe(true);
    });

    it('composes literal-tab remapping with inline-newline expansion', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'literal-tab-inline-newline',
        runs: [
          { text: 'First\n1.2\tHeading', fontFamily: 'Arial', fontSize: 16, bold: true },
          { text: 'Body', fontFamily: 'Arial', fontSize: 16 },
        ],
        attrs: { tabs: [{ pos: 480, val: 'start' }] },
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));
      const paintedLines = measure.lines.map((line) => extractSegmentText(block, line).join(''));

      expect(paintedLines).toEqual(['First', '1.2HeadingBody']);
      expect(paintedLines.join('').match(/1\.2/g)).toHaveLength(1);
      expect(measure.lines[1].segments?.at(-1)).toMatchObject({ runIndex: 3, fromChar: 0, toChar: 4 });
    });

    it('preserves authored run indexes when bookmark markers surround a literal tab', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'literal-tab-bookmark-markers',
        runs: [
          {
            text: '\u200B',
            fontFamily: 'Arial',
            fontSize: 16,
            dataAttrs: { 'data-bookmark-marker': 'start', 'data-bookmark-id': '3886' },
          },
          { text: '1.2\tHeading', fontFamily: 'Arial', fontSize: 16, bold: true },
          {
            text: '\u200B',
            fontFamily: 'Arial',
            fontSize: 16,
            dataAttrs: { 'data-bookmark-marker': 'end', 'data-bookmark-id': '3886' },
          },
          { text: 'Body', fontFamily: 'Arial', fontSize: 16 },
        ],
        attrs: { tabs: [{ pos: 480, val: 'start' }] },
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));
      const line = measure.lines[0];

      expect(extractSegmentText(block, line).join('')).toBe('1.2HeadingBody');
      expect(line.segments?.filter((segment) => segment.runIndex === 1).map((segment) => segment.fromChar)).toEqual([
        0, 4,
      ]);
      expect(line.segments?.at(-1)).toMatchObject({ runIndex: 3, fromChar: 0, toChar: 4 });
    });

    it.each([
      { val: 'start' as const },
      { val: 'center' as const },
      { val: 'end' as const, leader: 'dot' as const },
      { val: 'decimal' as const },
    ])('matches canonical tab geometry for a $val-aligned tab stop', async ({ val, leader }) => {
      const attrs = { tabs: [{ pos: 2400, val, ...(leader ? { leader } : {}) }] };
      const literalBlock: FlowBlock = {
        kind: 'paragraph',
        id: `literal-${val}-tab`,
        runs: [{ text: 'Label\t12.34', fontFamily: 'Arial', fontSize: 16 }],
        attrs,
      };
      const canonicalBlock: FlowBlock = {
        kind: 'paragraph',
        id: `canonical-${val}-tab`,
        runs: [
          { text: 'Label', fontFamily: 'Arial', fontSize: 16 },
          { kind: 'tab', text: '\t', tabIndex: 0 },
          { text: '12.34', fontFamily: 'Arial', fontSize: 16 },
        ],
        attrs,
      };

      const [literalMeasure, canonicalMeasure] = await Promise.all([
        measureBlock(literalBlock, 400).then(expectParagraphMeasure),
        measureBlock(canonicalBlock, 400).then(expectParagraphMeasure),
      ]);
      const literalValue = literalMeasure.lines[0].segments?.find(
        (segment) =>
          extractSegmentText(literalBlock, { ...literalMeasure.lines[0], segments: [segment] })[0] === '12.34',
      );
      const canonicalValue = canonicalMeasure.lines[0].segments?.find((segment) => segment.runIndex === 2);

      expect(extractSegmentText(literalBlock, literalMeasure.lines[0]).join('')).toBe('Label12.34');
      expect(literalValue?.x).toBeCloseTo(canonicalValue?.x ?? Number.NaN, 3);
      expect(literalMeasure.lines[0].width).toBeCloseTo(canonicalMeasure.lines[0].width, 3);
      if (leader) {
        expect(literalMeasure.lines[0].leaders?.[0]).toMatchObject({ style: leader });
        expect(literalMeasure.lines[0].leaders?.[0]?.from).toBeCloseTo(
          canonicalMeasure.lines[0].leaders?.[0]?.from ?? Number.NaN,
          3,
        );
        expect(literalMeasure.lines[0].leaders?.[0]?.to).toBeCloseTo(
          canonicalMeasure.lines[0].leaders?.[0]?.to ?? Number.NaN,
          3,
        );
      }
    });

    it('keeps a Word-authored tabbed suffix on the line when it is within the subpixel tolerance', async () => {
      // SD-4125 manual, section 566: the explicit stop is measured from the
      // column edge, while the text begins at the paragraph indent. The final
      // glyph lands ~0.06px inside the available width. Word keeps this as one
      // line; treating the 0.5px tolerance as reserved space creates a false
      // wrap that compounds across continuous multi-column sections.
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'near-edge-explicit-tab',
        runs: [
          {
            kind: 'text',
            text: '00',
            fontFamily: 'Arial',
            fontSize: 8,
            horizontalScale: 1.05,
            letterSpacing: -1 / 3,
          },
          {
            kind: 'tab',
            text: '\t',
            fontFamily: 'Arial',
            fontSize: 8,
            tabIndex: 0,
          },
          {
            kind: 'text',
            text: '0',
            fontFamily: 'Arial',
            fontSize: 8,
            horizontalScale: 1.05,
            letterSpacing: -2 / 3,
          },
        ],
        attrs: {
          indent: { left: 344 / 15 },
          tabs: [{ val: 'start', pos: 787 }],
          tabIntervalTwips: 720,
        },
      };

      clearMeasurementCache();
      const measure = expectParagraphMeasure(await measureBlock(block, 858 / 15));

      expect(measure.lines).toHaveLength(1);
      expect(extractLineText(block, measure.lines[0])).toBe('00\t0');
    });

    it('uses the hanging-indent body text start as the first default tab target', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'manual-numbering-hanging-tab',
        runs: [
          { text: '1.', fontFamily: 'Arial', fontSize: 16 },
          { kind: 'tab', text: '\t', tabIndex: 0, pmStart: 2, pmEnd: 3 },
          { text: 'The quick brown fox', fontFamily: 'Arial', fontSize: 16 },
        ],
        attrs: {
          indent: { left: 100, hanging: 60 },
          alignment: 'justify',
        },
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 500));
      expect(measure.lines).toHaveLength(1);

      const firstLine = measure.lines[0];
      const textSegment = firstLine.segments?.find((segment) => segment.runIndex === 2);
      expect(firstLine.hasExplicitTabStops).toBeUndefined();
      expect(textSegment?.x).toBeDefined();
      // First line starts at left - hanging (40px), so a segment x of 60px
      // lands the post-tab text exactly at the body indent (100px).
      expect(Math.round((textSegment?.x ?? 0) + 40)).toBe(100);
      expect(block.runs[1].kind).toBe('tab');
      if (block.runs[1].kind === 'tab') {
        expect(block.runs[1].width).toBeGreaterThan(0);
        expect(block.runs[1].width).toBeLessThan(60);
      }
    });

    it('aligns trailing tabs to explicit right stops with dot leaders (TOC regression)', async () => {
      const rightStopTwips = 10593;
      const rightStopPx = rightStopTwips * (96 / 1440); // ~706px
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'toc-paragraph',
        runs: [
          { text: '1.', fontFamily: 'Arial', fontSize: 13.333 },
          { kind: 'tab', text: '\t', tabIndex: 0, pmStart: 2, pmEnd: 3 },
          { text: 'Generalities', fontFamily: 'Arial', fontSize: 13.333 },
          { kind: 'tab', text: '\t', tabIndex: 1, pmStart: 15, pmEnd: 16 },
          { text: '5', fontFamily: 'Arial', fontSize: 13.333 },
        ],
        attrs: {
          indent: { left: 30, right: 0, firstLine: 0, hanging: 30 },
          tabs: [{ val: 'end', leader: 'dot', pos: rightStopTwips }],
        },
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 800));
      expect(measure.lines).toHaveLength(1);
      const line = measure.lines[0];
      expect(line.hasExplicitTabStops).toBe(true);
      expect(line.leaders).toBeDefined();
      expect(line.leaders?.[0]?.style).toBe('dot');
      // Leader must end right before the page number — within ~20px of the right stop
      // (page number "5" is a few px wide, not 100+ px wide).
      expect(line.leaders?.[0]?.to).toBeLessThanOrEqual(rightStopPx);
      expect(line.leaders?.[0]?.to).toBeGreaterThan(rightStopPx - 20);
      // Leader must start AFTER the title text, not at "1." — proves the first tab
      // fell on the default 0.5" grid, not on the end stop.
      expect(line.leaders?.[0]?.from).toBeGreaterThan(100);
      const trailingTab = block.runs[3];
      if (trailingTab.kind === 'tab') {
        expect(trailingTab.width).toBeGreaterThan(50);
      }
    });

    it('compensates start tabs on body lines for negative-left paragraphs with hanging indents', async () => {
      const leftIndentPx = -40;
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'negative-left-hanging-body-tab',
        runs: [
          { text: 'First', fontFamily: 'Arial', fontSize: 16 },
          { kind: 'lineBreak' },
          { kind: 'tab', text: '\t', tabIndex: 0 },
          { text: 'Body', fontFamily: 'Arial', fontSize: 16 },
        ],
        attrs: {
          indent: { left: leftIndentPx, hanging: 20 },
        },
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 200));

      expect(measure.lines).toHaveLength(2);
      const tabRun = block.runs[2];
      if (tabRun.kind === 'tab') {
        expect(tabRun.width).toBeCloseTo(Math.abs(leftIndentPx), 1);
      }

      const textSegment = measure.lines[1].segments?.find((segment) => segment.runIndex === 3);
      expect(textSegment?.x).toBeCloseTo(Math.abs(leftIndentPx) * 2, 1);
      expect(textSegment?.precedingTabEndX).toBeCloseTo(Math.abs(leftIndentPx), 1);
      expect((textSegment?.x ?? 0) + leftIndentPx).toBeCloseTo(Math.abs(leftIndentPx), 1);
    });

    it('preserves compensated tab geometry when the following text starts with a space', async () => {
      const leftIndentPx = -40;
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'negative-left-hanging-body-tab-leading-space',
        runs: [
          { text: 'First', fontFamily: 'Arial', fontSize: 16 },
          { kind: 'lineBreak' },
          { kind: 'tab', text: '\t', tabIndex: 0 },
          { text: ' Body', fontFamily: 'Arial', fontSize: 16 },
        ],
        attrs: {
          indent: { left: leftIndentPx, hanging: 20 },
        },
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 200));

      expect(measure.lines).toHaveLength(2);
      const leadingSpaceSegment = measure.lines[1].segments?.find(
        (segment) => segment.runIndex === 3 && segment.fromChar === 0 && segment.toChar === 1,
      );

      expect(leadingSpaceSegment?.x).toBeCloseTo(Math.abs(leftIndentPx) * 2, 1);
      expect(leadingSpaceSegment?.precedingTabEndX).toBeCloseTo(Math.abs(leftIndentPx), 1);
      expect((leadingSpaceSegment?.x ?? 0) + leftIndentPx).toBeCloseTo(Math.abs(leftIndentPx), 1);
    });

    it('clears compensated tab geometry when the first following word wraps', async () => {
      const leftIndentPx = -40;
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'negative-left-stale-tab-end-after-wrap',
        runs: [
          { text: 'First', fontFamily: 'Arial', fontSize: 16 },
          { kind: 'lineBreak' },
          { kind: 'tab', text: '\t', tabIndex: 0 },
          { text: 'Supercalifragilistic', fontFamily: 'Arial', fontSize: 16 },
          { kind: 'tab', text: '\t', tabIndex: 1 },
          { text: '9', fontFamily: 'Arial', fontSize: 16 },
        ],
        attrs: {
          indent: { left: leftIndentPx, hanging: 20 },
          tabs: [{ pos: 180 * 15, val: 'end', leader: 'dot' }],
        },
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 120));
      const wrappedWordSegment = measure.lines
        .flatMap((line) => line.segments ?? [])
        .find((segment) => segment.runIndex === 3);
      const rightAlignedSegment = measure.lines
        .flatMap((line) => line.segments ?? [])
        .find((segment) => segment.runIndex === 5);

      expect(wrappedWordSegment?.x).toBeUndefined();
      expect(wrappedWordSegment?.precedingTabEndX).toBeUndefined();
      expect(rightAlignedSegment?.x).toBeDefined();
      expect(rightAlignedSegment?.precedingTabEndX).toBeUndefined();
    });

    it('clears compensated tab geometry when the first following word char-splits', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'negative-left-stale-tab-end-after-char-split',
        runs: [
          { text: 'First', fontFamily: 'Arial', fontSize: 16 },
          { kind: 'lineBreak' },
          { kind: 'tab', text: '\t', tabIndex: 0 },
          { text: 'SupercalifragilisticexpialidociousVeryLong', fontFamily: 'Arial', fontSize: 16 },
          { kind: 'tab', text: '\t', tabIndex: 1 },
          { text: 'Z', fontFamily: 'Arial', fontSize: 16 },
        ],
        attrs: {
          indent: { left: -40, hanging: 20 },
          tabs: [{ pos: 200 * 15, val: 'end', leader: 'dot' }],
        },
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 120));
      const rightAlignedSegment = measure.lines
        .flatMap((line) => line.segments ?? [])
        .find((segment) => segment.runIndex === 5);

      expect(rightAlignedSegment?.x).toBeDefined();
      expect(rightAlignedSegment?.precedingTabEndX).toBeUndefined();
    });

    it('clears compensated tab geometry when the first following space wraps', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'negative-left-stale-tab-end-after-leading-space-wrap',
        runs: [
          { text: 'First', fontFamily: 'Arial', fontSize: 16 },
          { kind: 'lineBreak' },
          { kind: 'tab', text: '\t', tabIndex: 0 },
          { text: ' ', fontFamily: 'Arial', fontSize: 16 },
          { kind: 'tab', text: '\t', tabIndex: 1 },
          { text: 'Z', fontFamily: 'Arial', fontSize: 16 },
        ],
        attrs: {
          indent: { left: -40, hanging: 20 },
          tabs: [{ pos: 200 * 15, val: 'end', leader: 'dot' }],
        },
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 42));
      const rightAlignedSegment = measure.lines
        .flatMap((line) => line.segments ?? [])
        .find((segment) => segment.runIndex === 5);

      expect(rightAlignedSegment?.x).toBeDefined();
      expect(rightAlignedSegment?.precedingTabEndX).toBeUndefined();
    });

    it('does not compensate positive explicit start stops in negative-left paragraphs', async () => {
      const leftIndentPx = -24;
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'negative-left-positive-start-tabs',
        runs: [
          { text: 'AAAA', fontFamily: 'Arial', fontSize: 16 },
          ...Array.from({ length: 7 }, () => ({ kind: 'tab' as const, text: '\t' })),
          { text: 'Company', fontFamily: 'Arial', fontSize: 16 },
        ],
        attrs: {
          indent: { left: leftIndentPx },
          tabs: [48, 96, 144, 192, 240, 288, 336].map((pos) => ({ pos: pos * 15, val: 'start' })),
        },
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 600));
      const textSegment = measure.lines[0].segments?.find((segment) => segment.runIndex === 8);

      expect(textSegment?.x).toBeCloseTo(360, 1);
      expect(textSegment?.precedingTabEndX).toBeUndefined();
      expect((textSegment?.x ?? 0) + leftIndentPx).toBeCloseTo(336, 1);
    });

    it('maps three trailing tabs to two explicit alignment stops (asymmetric case)', async () => {
      const centerStopTwips = 5000;
      const endStopTwips = 10000;
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'asymmetric-tabs',
        runs: [
          { text: 'A', fontFamily: 'Arial', fontSize: 13.333 },
          { kind: 'tab', text: '\t', tabIndex: 0, pmStart: 1, pmEnd: 2 },
          { text: 'B', fontFamily: 'Arial', fontSize: 13.333 },
          { kind: 'tab', text: '\t', tabIndex: 1, pmStart: 3, pmEnd: 4 },
          { text: 'C', fontFamily: 'Arial', fontSize: 13.333 },
          { kind: 'tab', text: '\t', tabIndex: 2, pmStart: 5, pmEnd: 6 },
          { text: 'D', fontFamily: 'Arial', fontSize: 13.333 },
        ],
        attrs: {
          indent: { left: 0, right: 0, firstLine: 0, hanging: 0 },
          tabs: [
            { val: 'center', pos: centerStopTwips },
            { val: 'end', pos: endStopTwips },
          ],
        },
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 800));
      expect(measure.lines).toHaveLength(1);
      // Three tabs, two alignment stops: last two tabs bind to center + end.
      // The first tab must NOT bind to either alignment stop — it should fall on the
      // default grid. The last tab ends near the end stop position.
      const lineWidth = measure.lines[0].width;
      const endStopPx = endStopTwips * (96 / 1440);
      expect(lineWidth).toBeCloseTo(endStopPx, 0);
    });

    it('handles multiple tabs in a row', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: '0-paragraph',
        runs: [
          {
            text: 'A',
            fontFamily: 'Arial',
            fontSize: 16,
          },
          {
            kind: 'tab',
            text: '\t',
            pmStart: 1,
            pmEnd: 2,
          },
          {
            kind: 'tab',
            text: '\t',
            pmStart: 2,
            pmEnd: 3,
          },
          {
            text: 'B',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));

      expect(measure.lines).toHaveLength(1);
      // Both tabs should have computed widths
      const tab1 = block.runs[1];
      const tab2 = block.runs[2];
      if (tab1.kind === 'tab' && tab2.kind === 'tab') {
        expect(tab1.width).toBeGreaterThan(0);
        expect(tab2.width).toBeGreaterThan(0);
      }
    });

    it('breaks line before tab if it would exceed maxWidth', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: '0-paragraph',
        runs: [
          {
            text: 'This is a long text',
            fontFamily: 'Arial',
            fontSize: 16,
          },
          {
            kind: 'tab',
            text: '\t',
            tabStops: [{ pos: 200, val: 'left' }],
            pmStart: 19,
            pmEnd: 20,
          },
          {
            text: 'After tab',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      // Use narrow width to force line break
      const measure = expectParagraphMeasure(await measureBlock(block, 150));

      // Should break into multiple lines
      expect(measure.lines.length).toBeGreaterThanOrEqual(2);
    });

    it('keeps tab on same line when it fits', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: '0-paragraph',
        runs: [
          {
            text: 'A',
            fontFamily: 'Arial',
            fontSize: 16,
          },
          {
            kind: 'tab',
            text: '\t',
            pmStart: 1,
            pmEnd: 2,
          },
          {
            text: 'B',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));

      // Should fit on one line
      expect(measure.lines).toHaveLength(1);
      expect(measure.lines[0].fromRun).toBe(0);
      expect(measure.lines[0].toRun).toBeGreaterThanOrEqual(2);
    });

    it('handles tab with leader style', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: '0-paragraph',
        runs: [
          {
            text: 'Chapter 1',
            fontFamily: 'Arial',
            fontSize: 16,
          },
          {
            kind: 'tab',
            text: '\t',
            tabStops: [{ pos: 300, val: 'right', leader: 'dot' }],
            leader: 'dot',
            pmStart: 9,
            pmEnd: 10,
          },
          {
            text: '42',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));

      expect(measure.lines).toHaveLength(1);
      const tabRun = block.runs[1];
      if (tabRun.kind === 'tab') {
        expect(tabRun.width).toBeGreaterThan(0);
        expect(tabRun.leader).toBe('dot');
      }
    });

    it.each([
      { label: 'TabRun without indent', indentLeft: 0, useInlineTab: false },
      { label: 'TabRun with indent', indentLeft: 36, useInlineTab: false },
      { label: 'inline tab without indent', indentLeft: 0, useInlineTab: true },
      { label: 'inline tab with indent', indentLeft: 36, useInlineTab: true },
    ])('positions leader from/to correctly for right-aligned tab $label', async ({ indentLeft, useInlineTab }) => {
      const textBlock: FlowBlock = {
        kind: 'paragraph',
        id: '0-paragraph',
        runs: [{ text: 'Chapter 1', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {},
      };
      const pageNumBlock: FlowBlock = {
        kind: 'paragraph',
        id: '1-paragraph',
        runs: [{ text: '42', fontFamily: 'Arial', fontSize: 16 }],
        attrs: {},
      };

      const runs = useInlineTab
        ? [{ text: 'Chapter 1\t42', fontFamily: 'Arial', fontSize: 16 }]
        : [
            { text: 'Chapter 1', fontFamily: 'Arial', fontSize: 16 },
            { kind: 'tab', leader: 'dot', text: '\t', pmStart: 9, pmEnd: 10 },
            { text: '42', fontFamily: 'Arial', fontSize: 16 },
          ];

      const block: FlowBlock = {
        kind: 'paragraph',
        id: '2-paragraph',
        runs,
        attrs: {
          tabs: [{ pos: 4500, val: 'end', leader: 'dot' }],
          ...(indentLeft > 0 && { indent: { left: indentLeft } }),
        },
      };

      const textMeasure = expectParagraphMeasure(await measureBlock(textBlock, 1000));
      const textWidth = textMeasure.lines[0].width;
      const pageNumMeasure = expectParagraphMeasure(await measureBlock(pageNumBlock, 1000));
      const pageNumWidth = pageNumMeasure.lines[0].width;

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));
      expect(measure.lines).toHaveLength(1);

      const leaders = measure.lines[0].leaders;
      expect(leaders).toHaveLength(1);

      const leader = leaders![0];
      expect(leader.from).toBeCloseTo(textWidth + indentLeft, 0);
      expect(leader.to).toBeCloseTo(300 - pageNumWidth, 0);
    });

    it('emits leaders on both lines when a paragraph contains a <w:br/> between tab groups (sd-1480)', async () => {
      // Repro for sd-1480-two-col-tab-positions: a single paragraph with right-aligned
      // dot-leader tab stop and a soft line break. The tabs/pPr applies per line, so
      // BOTH lines must emit a dot leader.
      const rightStopTwips = 4306;
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'multiline-leader',
        runs: [
          { text: 'Page', fontFamily: 'Arial', fontSize: 13.333 },
          { kind: 'tab', text: '\t', tabIndex: 0, pmStart: 4, pmEnd: 5 },
          { text: '2', fontFamily: 'Arial', fontSize: 13.333 },
          { kind: 'lineBreak' },
          { text: 'Page', fontFamily: 'Arial', fontSize: 13.333 },
          { kind: 'tab', text: '\t', tabIndex: 1, pmStart: 11, pmEnd: 12 },
          { text: '5', fontFamily: 'Arial', fontSize: 13.333 },
        ],
        attrs: {
          tabs: [{ pos: rightStopTwips, val: 'end', leader: 'dot' }],
        },
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 800));
      expect(measure.lines.length).toBeGreaterThanOrEqual(2);

      const line1 = measure.lines[0];
      const line2 = measure.lines[1];

      expect(line1.leaders, 'line 1 should have a dot leader').toBeDefined();
      expect(line1.leaders).toHaveLength(1);
      expect(line1.leaders?.[0]?.style).toBe('dot');

      expect(line2.leaders, 'line 2 should have a dot leader').toBeDefined();
      expect(line2.leaders).toHaveLength(1);
      expect(line2.leaders?.[0]?.style).toBe('dot');
    });

    it('preserves trailing spaces after tabs when line breaks', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: '0-paragraph',
        runs: [
          {
            text: 'Before',
            fontFamily: 'Arial',
            fontSize: 16,
          },
          {
            kind: 'tab',
            text: '\t',
            pmStart: 6,
            pmEnd: 7,
          },
          {
            text: 'Word Next',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      // Use narrow width to force line break after "Word "
      const measure = expectParagraphMeasure(await measureBlock(block, 100));

      // Should have multiple lines due to narrow width
      expect(measure.lines.length).toBeGreaterThan(1);

      // Find the line containing "Word " (the text after the tab)
      const lineWithWord = measure.lines.find((line) => {
        return line.segments?.some((seg) => {
          const run = block.runs[seg.runIndex];
          return run.kind !== 'tab' && 'text' in run && run.text.includes('Word');
        });
      });

      expect(lineWithWord).toBeDefined();

      if (lineWithWord) {
        // The segment should include the trailing space after "Word"
        const wordSegment = lineWithWord.segments?.find((seg) => {
          const run = block.runs[seg.runIndex];
          return run.kind !== 'tab' && 'text' in run && run.text.includes('Word');
        });

        expect(wordSegment).toBeDefined();

        if (wordSegment) {
          const run = block.runs[wordSegment.runIndex];
          if (run.kind !== 'tab' && 'text' in run) {
            const segmentText = run.text.substring(wordSegment.fromChar, wordSegment.toChar);
            // If a word-level break split "Word Next", the first segment should
            // include the trailing space ("Word ").  If the whole run fits on one
            // line the segment covers the full text — both are valid outcomes
            // depending on font metrics.
            expect(segmentText === 'Word ' || segmentText === 'Word Next').toBe(true);
          }
        }
      }
    });

    it('uses surrounding text font size for tab line height, not hardcoded 12', async () => {
      // Regression: tab runs previously hardcoded maxFontSize=12, producing
      // wrong line heights when the surrounding text used a larger font.
      const largeFontBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'tab-font-size-large',
        runs: [
          { text: 'Hello', fontFamily: 'Arial', fontSize: 24 },
          { kind: 'tab', text: '\t', pmStart: 5, pmEnd: 6 },
          { text: 'World', fontFamily: 'Arial', fontSize: 24 },
        ],
        attrs: {},
      };

      const smallFontBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'tab-font-size-small',
        runs: [
          { text: 'Hello', fontFamily: 'Arial', fontSize: 10 },
          { kind: 'tab', text: '\t', pmStart: 5, pmEnd: 6 },
          { text: 'World', fontFamily: 'Arial', fontSize: 10 },
        ],
        attrs: {},
      };

      const largeMeasure = expectParagraphMeasure(await measureBlock(largeFontBlock, 1000));
      const smallMeasure = expectParagraphMeasure(await measureBlock(smallFontBlock, 1000));

      expect(largeMeasure.lines).toHaveLength(1);
      expect(smallMeasure.lines).toHaveLength(1);

      // The large-font paragraph must have a taller line than the small-font one.
      // With the old hardcoded 12, both could collapse to similar heights.
      expect(largeMeasure.lines[0].lineHeight).toBeGreaterThan(smallMeasure.lines[0].lineHeight);
    });

    it('uses fallback font size when tab is the first run (no preceding text)', async () => {
      // When a tab starts a paragraph, lastFontSize should fall back to the
      // first text run's font size, not a hardcoded default.
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'tab-first-run',
        runs: [
          { kind: 'tab', text: '\t', pmStart: 0, pmEnd: 1 },
          { text: 'After tab', fontFamily: 'Arial', fontSize: 20 },
        ],
        attrs: {},
      };

      const refBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'no-tab-ref',
        runs: [{ text: 'After tab', fontFamily: 'Arial', fontSize: 20 }],
        attrs: {},
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));
      const refMeasure = expectParagraphMeasure(await measureBlock(refBlock, 1000));

      expect(measure.lines).toHaveLength(1);
      // Line height should match or exceed the reference (same font size drives both)
      expect(measure.lines[0].lineHeight).toBeGreaterThanOrEqual(refMeasure.lines[0].lineHeight);
    });

    it('tab-only line inherits font size from following text run', async () => {
      // A line that contains only a tab should derive its height from the
      // paragraph's font size context, not from a hardcoded 12pt.
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'tab-only-line',
        runs: [{ kind: 'tab', text: '\t', pmStart: 0, pmEnd: 1 }],
        attrs: {
          // paragraph-level font size hint via a nearby run
        },
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));

      expect(measure.lines).toHaveLength(1);
      // With the fallback font size (default 12 when no runs present),
      // the line should still have a reasonable height
      expect(measure.lines[0].lineHeight).toBeGreaterThan(0);
      expect(measure.lines[0].maxFontSize).toBeGreaterThan(0);
    });
  });

  describe('space-only runs', () => {
    it('counts width contributed by runs that contain only spaces', async () => {
      const baseRun = { fontFamily: 'Arial', fontSize: 16 };

      const combinedBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'space-between-runs',
        runs: [
          { ...baseRun, text: 'This' },
          { ...baseRun, text: ' ' }, // space in its own run
          { ...baseRun, text: 'CONFIDENTIALITY', bold: true },
        ],
        attrs: {},
      };

      const measureCombined = expectParagraphMeasure(await measureBlock(combinedBlock, 1000));
      expect(measureCombined.lines).toHaveLength(1);
      expect(measureCombined.lines[0].segments?.map((s) => s.runIndex)).toEqual([0, 1, 2]);

      const measureThis = expectParagraphMeasure(
        await measureBlock(
          { kind: 'paragraph', id: 'space-this', runs: [{ ...baseRun, text: 'This' }], attrs: {} },
          1000,
        ),
      );
      const measureSpace = expectParagraphMeasure(
        await measureBlock(
          { kind: 'paragraph', id: 'space-space', runs: [{ ...baseRun, text: ' ' }], attrs: {} },
          1000,
        ),
      );
      const measureConf = expectParagraphMeasure(
        await measureBlock(
          {
            kind: 'paragraph',
            id: 'space-conf',
            runs: [{ ...baseRun, text: 'CONFIDENTIALITY', bold: true }],
            attrs: {},
          },
          1000,
        ),
      );

      const expectedWidth = measureThis.lines[0].width + measureSpace.lines[0].width + measureConf.lines[0].width;

      expect(measureCombined.lines[0].width).toBeCloseTo(expectedWidth, 0);
    });
  });

  describe('explicit X positioning for tab-aligned text', () => {
    /**
     * These tests verify the bug fix for explicit segment X positioning.
     * The fix ensures that only the FIRST word after a tab gets explicit X coordinates,
     * not all subsequent words in the segment. This prevents incorrect text positioning.
     */

    it('sets explicit X only for first word after a tab', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'tab-explicit-x',
        runs: [
          {
            text: 'Before',
            fontFamily: 'Arial',
            fontSize: 16,
          },
          {
            kind: 'tab',
            text: '\t',
            tabStops: [{ pos: 200, val: 'left' }],
            pmStart: 6,
            pmEnd: 7,
          },
          {
            text: 'First Second Third',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));

      expect(measure.lines).toHaveLength(1);
      const line = measure.lines[0];

      // Line should have segments due to tab alignment
      expect(line.segments).toBeDefined();
      expect(line.segments!.length).toBeGreaterThan(0);

      // Find segment(s) for the text after the tab (run index 2)
      const afterTabSegments = line.segments!.filter((seg) => seg.runIndex === 2);
      expect(afterTabSegments.length).toBeGreaterThan(0);

      // First segment after tab should have explicit X
      const firstSegment = afterTabSegments[0];
      expect(firstSegment.x).toBeDefined();
      expect(firstSegment.x).toBeGreaterThan(0);

      // If there are multiple words, subsequent segments should NOT have explicit X
      // (they should be merged or have undefined X)
      if (afterTabSegments.length > 1) {
        for (let i = 1; i < afterTabSegments.length; i++) {
          expect(afterTabSegments[i].x).toBeUndefined();
        }
      }
    });

    it('handles multiple words after tab without explicit X on subsequent words', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'multi-word-after-tab',
        runs: [
          {
            text: 'Label',
            fontFamily: 'Arial',
            fontSize: 16,
          },
          {
            kind: 'tab',
            text: '\t',
            tabStops: [{ pos: 150, val: 'left' }],
            pmStart: 5,
            pmEnd: 6,
          },
          {
            text: 'Word1 Word2 Word3 Word4',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));

      expect(measure.lines).toHaveLength(1);
      const line = measure.lines[0];
      expect(line.segments).toBeDefined();

      const afterTabSegments = line.segments!.filter((seg) => seg.runIndex === 2);

      // First word after tab gets explicit X
      const firstWord = afterTabSegments.find((seg) => seg.fromChar === 0);
      expect(firstWord).toBeDefined();
      expect(firstWord!.x).toBeDefined();

      // Subsequent words should not have explicit X
      const subsequentWords = afterTabSegments.filter((seg) => seg.fromChar > 0);
      subsequentWords.forEach((seg) => {
        expect(seg.x).toBeUndefined();
      });
    });

    it('sets explicit X for first word after each tab in multiple tab scenario', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'multiple-tabs',
        runs: [
          {
            text: 'A',
            fontFamily: 'Arial',
            fontSize: 16,
          },
          {
            kind: 'tab',
            text: '\t',
            tabStops: [{ pos: 100, val: 'left' }],
            pmStart: 1,
            pmEnd: 2,
          },
          {
            text: 'First Second',
            fontFamily: 'Arial',
            fontSize: 16,
          },
          {
            kind: 'tab',
            text: '\t',
            tabStops: [{ pos: 300, val: 'left' }],
            pmStart: 14,
            pmEnd: 15,
          },
          {
            text: 'Third Fourth',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));

      expect(measure.lines).toHaveLength(1);
      const line = measure.lines[0];
      expect(line.segments).toBeDefined();

      // After first tab (run 2)
      const afterFirstTab = line.segments!.filter((seg) => seg.runIndex === 2);
      const firstAfterTab1 = afterFirstTab.find((seg) => seg.fromChar === 0);
      expect(firstAfterTab1).toBeDefined();
      expect(firstAfterTab1!.x).toBeDefined();

      // After second tab (run 4)
      const afterSecondTab = line.segments!.filter((seg) => seg.runIndex === 4);
      const firstAfterTab2 = afterSecondTab.find((seg) => seg.fromChar === 0);
      expect(firstAfterTab2).toBeDefined();
      expect(firstAfterTab2!.x).toBeDefined();

      // Subsequent words in each segment should not have explicit X
      const laterWordsTab1 = afterFirstTab.filter((seg) => seg.fromChar > 0);
      laterWordsTab1.forEach((seg) => {
        expect(seg.x).toBeUndefined();
      });

      const laterWordsTab2 = afterSecondTab.filter((seg) => seg.fromChar > 0);
      laterWordsTab2.forEach((seg) => {
        expect(seg.x).toBeUndefined();
      });
    });

    it('does not set explicit X for words before tabs', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'before-tab',
        runs: [
          {
            text: 'Multiple Words Before Tab',
            fontFamily: 'Arial',
            fontSize: 16,
          },
          {
            kind: 'tab',
            text: '\t',
            tabStops: [{ pos: 200, val: 'left' }],
            pmStart: 25,
            pmEnd: 26,
          },
          {
            text: 'After',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));

      expect(measure.lines).toHaveLength(1);
      const line = measure.lines[0];
      expect(line.segments).toBeDefined();

      // Words before tab should not have explicit X
      const beforeTabSegments = line.segments!.filter((seg) => seg.runIndex === 0);
      beforeTabSegments.forEach((seg) => {
        expect(seg.x).toBeUndefined();
      });

      // First word after tab should have explicit X
      const afterTabSegments = line.segments!.filter((seg) => seg.runIndex === 2);
      const firstAfterTab = afterTabSegments[0];
      expect(firstAfterTab.x).toBeDefined();
    });

    it('handles center-aligned tabs with explicit X only on first word', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'center-tab-explicit-x',
        runs: [
          {
            text: 'Left',
            fontFamily: 'Arial',
            fontSize: 16,
          },
          {
            kind: 'tab',
            text: '\t',
            tabStops: [{ pos: 200, val: 'center' }],
            pmStart: 4,
            pmEnd: 5,
          },
          {
            text: 'Centered Text',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));

      expect(measure.lines).toHaveLength(1);
      const line = measure.lines[0];
      expect(line.segments).toBeDefined();

      const afterTabSegments = line.segments!.filter((seg) => seg.runIndex === 2);
      expect(afterTabSegments.length).toBeGreaterThan(0);

      // First segment after center tab should have explicit X
      const firstSegment = afterTabSegments[0];
      expect(firstSegment.x).toBeDefined();
    });

    it('handles right-aligned tabs with explicit X only on first word', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'right-tab-explicit-x',
        runs: [
          {
            text: 'Left',
            fontFamily: 'Arial',
            fontSize: 16,
          },
          {
            kind: 'tab',
            text: '\t',
            tabStops: [{ pos: 300, val: 'right' }],
            pmStart: 4,
            pmEnd: 5,
          },
          {
            text: 'Right Aligned Text',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));

      expect(measure.lines).toHaveLength(1);
      const line = measure.lines[0];
      expect(line.segments).toBeDefined();

      const afterTabSegments = line.segments!.filter((seg) => seg.runIndex === 2);
      expect(afterTabSegments.length).toBeGreaterThan(0);

      // First segment after right tab should have explicit X
      const firstSegment = afterTabSegments[0];
      expect(firstSegment.x).toBeDefined();
    });
  });

  describe('letter spacing', () => {
    it('includes letterSpacing in width calculations', async () => {
      const blockNoSpacing: FlowBlock = {
        kind: 'paragraph',
        id: '0-paragraph',
        runs: [
          {
            text: 'Hello',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      const blockWithSpacing: FlowBlock = {
        kind: 'paragraph',
        id: '1-paragraph',
        runs: [
          {
            text: 'Hello',
            fontFamily: 'Arial',
            fontSize: 16,
            letterSpacing: 2,
          },
        ],
        attrs: {},
      };

      const measureNoSpacing = expectParagraphMeasure(await measureBlock(blockNoSpacing, 1000));
      const measureWithSpacing = expectParagraphMeasure(await measureBlock(blockWithSpacing, 1000));

      // "Hello" has 5 characters = 4 gaps × 2px = 8px extra width
      const expectedExtraWidth = 8;
      expect(measureWithSpacing.lines[0].width).toBeCloseTo(
        measureNoSpacing.lines[0].width + expectedExtraWidth,
        0, // Allow 1px tolerance for floating-point precision
      );
    });

    it('includes boundary spacing when appending to non-empty line', async () => {
      // Test that "Hello World" with letterSpacing = 2 includes all gaps:
      // - 4 gaps in "Hello" = 8px
      // - 1 boundary gap between "o" and " " = 2px
      // - 5 gaps in " World" = 10px
      // Total: 20px of letter spacing
      const block: FlowBlock = {
        kind: 'paragraph',
        id: '0-paragraph',
        runs: [
          {
            text: 'Hello World',
            fontFamily: 'Arial',
            fontSize: 16,
            letterSpacing: 2,
          },
        ],
        attrs: {},
      };

      const blockNoSpacing: FlowBlock = {
        kind: 'paragraph',
        id: '1-paragraph',
        runs: [
          {
            text: 'Hello World',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      const measureSpacing = expectParagraphMeasure(await measureBlock(block, 1000));
      const measureNoSpacing = expectParagraphMeasure(await measureBlock(blockNoSpacing, 1000));

      // "Hello World" has 11 characters = 10 gaps × 2px = 20px extra
      const expectedExtraWidth = 20;
      expect(measureSpacing.lines[0].width).toBeCloseTo(
        measureNoSpacing.lines[0].width + expectedExtraWidth,
        0, // Allow 1px tolerance for floating-point precision
      );
    });

    it('causes earlier line breaks when letterSpacing increases width', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: '0-paragraph',
        runs: [
          {
            text: 'This is a long paragraph that should break',
            fontFamily: 'Arial',
            fontSize: 16,
            letterSpacing: 3,
          },
        ],
        attrs: {},
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 150));

      // With letter spacing, should break into more lines
      expect(measure.lines.length).toBeGreaterThan(1);
    });

    it('handles letterSpacing with single character correctly', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: '0-paragraph',
        runs: [
          {
            text: 'A',
            fontFamily: 'Arial',
            fontSize: 16,
            letterSpacing: 5,
          },
        ],
        attrs: {},
      };

      const blockNoSpacing: FlowBlock = {
        kind: 'paragraph',
        id: '1-paragraph',
        runs: [
          {
            text: 'A',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      const measureSpacing = expectParagraphMeasure(await measureBlock(block, 1000));
      const measureNoSpacing = expectParagraphMeasure(await measureBlock(blockNoSpacing, 1000));

      // Single character has 0 gaps, so letterSpacing adds nothing
      expect(measureSpacing.lines[0].width).toBeCloseTo(measureNoSpacing.lines[0].width, 1);
    });
  });

  describe('overflow protection', () => {
    it('does not character-break a borderline single word because of tiny measurement overflow', async () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      expect(ctx).not.toBeNull();
      const contextPrototype = Object.getPrototypeOf(ctx) as CanvasRenderingContext2D;
      const originalMeasureText = contextPrototype.measureText;
      const widthMap = new Map<string, number>([
        ['Terms', 48.9],
        ['Term', 39.125],
        ['Ter', 30],
        ['Te', 20],
        ['T', 10],
        ['s', 8.8984375],
        ['1.', 13.34375],
      ]);
      const measureTextSpy = vi.spyOn(contextPrototype, 'measureText').mockImplementation(function (text: string) {
        const mappedWidth = widthMap.get(text);
        if (mappedWidth != null) {
          return {
            width: mappedWidth,
            actualBoundingBoxLeft: 0,
            actualBoundingBoxRight: mappedWidth,
            actualBoundingBoxAscent: 12,
            actualBoundingBoxDescent: 4,
          } as TextMetrics;
        }
        return originalMeasureText.call(this, text);
      });

      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'borderline-overflow-list-item',
        runs: [
          {
            text: 'Terms',
            fontFamily: 'Arial, sans-serif',
            fontSize: 16,
            bold: true,
            letterSpacing: -0.13333333333333333,
          },
        ],
        attrs: {
          styleId: 'ListParagraph',
          indent: { left: 24, hanging: 23.933333333333334 },
          wordLayout: {
            indentLeftPx: 24,
            hangingPx: 23.933333333333334,
            textStartPx: 24,
            marker: {
              markerText: '1.',
              markerBoxWidthPx: 23.933333333333334,
              textStartX: 24,
              gutterWidthPx: 8,
              suffix: 'tab',
              run: {
                fontFamily: 'Arial, sans-serif',
                fontSize: 16,
                bold: true,
              },
            },
          },
        },
      };

      try {
        const measure = expectParagraphMeasure(await measureBlock(block, 72.26666666666667));
        expect(measure.lines).toHaveLength(1);
        expect(extractLineText(block, measure.lines[0])).toBe('Terms');
      } finally {
        measureTextSpy.mockRestore();
      }
    });

    it('keeps justified line packed by allowing small space flex (Word parity case)', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'justify-word-parity',
        runs: [
          {
            text: 'Por este instrumento particular, de um lado a empresa ',
            fontFamily: 'Times New Roman',
            fontSize: 12,
          },
          {
            text: 'EMPRESA',
            fontFamily: 'Times New Roman',
            fontSize: 12,
            bold: true,
          },
          {
            text: ' ABC',
            fontFamily: 'Times New Roman',
            fontSize: 12,
            bold: true,
          },
          {
            text: ', pessoa jurídica de direito privado, inscrita no CNPJ sob n. XXXXXXXX com sede à Av. Presidente Juscelino Kubitschek, N° 2041, 22° Andar, Torre D, no Bairro Vila Nova Conceição na Cidade de São Paulo – SP – CEP 04.543-011, neste ato representado por seu representante legal',
            fontFamily: 'Times New Roman',
            fontSize: 12,
          },
          {
            text: ' FULANO DE TAL',
            fontFamily: 'Times New Roman',
            fontSize: 12,
            bold: true,
          },
        ],
        attrs: { alignment: 'justify' },
      };

      // Page width 12240 twips (8.5in) minus margins 1701/1134 twips ≈ 627px content width at 96dpi
      const measure = expectParagraphMeasure(await measureBlock(block, 627));
      const lineTexts = measure.lines.map((line) => extractLineText(block, line));
      const representadoIndex = lineTexts.findIndex((text) => text.includes('representado'));

      expect(representadoIndex).toBeGreaterThanOrEqual(0);
      const windowText = [lineTexts[representadoIndex], lineTexts[representadoIndex + 1] ?? '']
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      expect(windowText).toContain('neste ato representado por seu representante legal');
    });

    it('calibrates Aptos glyph advances without scaling its spaces', async () => {
      const contextPrototype = Object.getPrototypeOf(document.createElement('canvas').getContext('2d'));
      const originalMeasureText = contextPrototype.measureText;
      const measureTextSpy = vi.spyOn(contextPrototype, 'measureText').mockImplementation(function (text: string) {
        if (text === 'abc' || text === 'def' || text === ' ') {
          const width = text === ' ' ? 10 : 30;
          return {
            width,
            actualBoundingBoxLeft: 0,
            actualBoundingBoxRight: width,
            actualBoundingBoxAscent: 8,
            actualBoundingBoxDescent: 2,
          } as TextMetrics;
        }
        return originalMeasureText.call(this, text);
      });
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'aptos-word-width-calibration',
        runs: [{ text: 'abc def', fontFamily: 'Aptos, sans-serif', fontSize: 12 }],
      };

      try {
        clearMeasurementCache();
        const measure = expectParagraphMeasure(await measureBlock(block, 200));

        expect(measure.lines[0].width).toBeCloseTo(30 * 1.0016 * 2 + 10, 5);
      } finally {
        measureTextSpy.mockRestore();
        clearMeasurementCache();
      }
    });

    it('limits justified space compression to the Word-compatible bound', async () => {
      const contextPrototype = Object.getPrototypeOf(document.createElement('canvas').getContext('2d'));
      const originalMeasureText = contextPrototype.measureText;
      const measureTextSpy = vi.spyOn(contextPrototype, 'measureText').mockImplementation(function (text: string) {
        if (text === 'aa' || text === 'cc' || text === 'bbbbbbbbbb' || text === ' ') {
          const width = text === 'bbbbbbbbbb' ? 100 : 10;
          return {
            width,
            actualBoundingBoxLeft: 0,
            actualBoundingBoxRight: width,
            actualBoundingBoxAscent: 8,
            actualBoundingBoxDescent: 2,
          } as TextMetrics;
        }
        return originalMeasureText.call(this, text);
      });
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'justify-compression-bound',
        runs: [{ text: 'aa aa bbbbbbbbbb cc', fontFamily: 'Arial', fontSize: 12 }],
        attrs: { alignment: 'justify' },
      };

      try {
        clearMeasurementCache();
        const withinBound = expectParagraphMeasure(await measureBlock(block, 136));
        const beyondBound = expectParagraphMeasure(await measureBlock(block, 130));

        expect(extractLineText(block, withinBound.lines[0]).trim()).toBe('aa aa bbbbbbbbbb');
        expect(extractLineText(block, beyondBound.lines[0]).trim()).toBe('aa aa');
      } finally {
        measureTextSpy.mockRestore();
        clearMeasurementCache();
      }
    });

    it('uses the tighter Helvetica compression boundary evidenced by Word', async () => {
      const contextPrototype = Object.getPrototypeOf(document.createElement('canvas').getContext('2d'));
      const originalMeasureText = contextPrototype.measureText;
      const measureTextSpy = vi.spyOn(contextPrototype, 'measureText').mockImplementation(function (text: string) {
        if (text === 'aa' || text === 'cc' || text === ' ') {
          const width = text === 'cc' ? 20 : 10;
          return {
            width,
            actualBoundingBoxLeft: 0,
            actualBoundingBoxRight: width,
            actualBoundingBoxAscent: 8,
            actualBoundingBoxDescent: 2,
          } as TextMetrics;
        }
        return originalMeasureText.call(this, text);
      });
      const makeBlock = (fontFamily: string): FlowBlock => ({
        kind: 'paragraph',
        id: `justify-${fontFamily}`,
        runs: [{ text: 'aa aa cc', fontFamily, fontSize: 12 }],
        attrs: { alignment: 'justify' },
      });

      try {
        clearMeasurementCache();
        const defaultMeasure = expectParagraphMeasure(await measureBlock(makeBlock('Times New Roman'), 55.4));
        clearMeasurementCache();
        const helveticaMeasure = expectParagraphMeasure(await measureBlock(makeBlock('Helvetica'), 55.4));

        expect(extractLineText(makeBlock('Times New Roman'), defaultMeasure.lines[0]).trim()).toBe('aa aa cc');
        expect(extractLineText(makeBlock('Helvetica'), helveticaMeasure.lines[0]).trim()).toBe('aa aa');
      } finally {
        measureTextSpy.mockRestore();
        clearMeasurementCache();
      }
    });

    it('applies Word Helvetica candidate bounds to zero-indent numbering and terminal-tab soft breaks', async () => {
      const contextPrototype = Object.getPrototypeOf(document.createElement('canvas').getContext('2d'));
      const originalMeasureText = contextPrototype.measureText;
      const measureTextSpy = vi.spyOn(contextPrototype, 'measureText').mockImplementation(function (text: string) {
        if (text === 'aa' || text === ' ' || text === '1.') {
          const width = text === '1.' ? 12 : 10;
          return {
            width,
            actualBoundingBoxLeft: 0,
            actualBoundingBoxRight: width,
            actualBoundingBoxAscent: 8,
            actualBoundingBoxDescent: 2,
          } as TextMetrics;
        }
        if (text === 'cc') {
          return {
            width: 20,
            actualBoundingBoxLeft: 0,
            actualBoundingBoxRight: 20,
            actualBoundingBoxAscent: 8,
            actualBoundingBoxDescent: 2,
          } as TextMetrics;
        }
        return originalMeasureText.call(this, text);
      });
      const text = 'aa aa aa aa aa aa aa cc';
      const tightWidth = 152.3;
      const numberingTextStart = 18.933333333333334;
      const ordinary: FlowBlock = {
        kind: 'paragraph',
        id: 'helvetica-ordinary-candidate',
        runs: [{ text, fontFamily: 'Helvetica', fontSize: 12 }],
        attrs: { alignment: 'justify' },
      };
      const zeroIndentNumbering: FlowBlock = {
        kind: 'paragraph',
        id: 'helvetica-numbering-candidate',
        runs: [{ text, fontFamily: 'Helvetica', fontSize: 12 }],
        attrs: {
          alignment: 'justify',
          wordLayout: {
            indentLeftPx: 0,
            hangingPx: 18,
            firstLinePx: 0,
            tabsPx: [numberingTextStart],
            textStartPx: 0,
            marker: {
              markerText: '1.',
              markerBoxWidthPx: 18,
              markerX: -18,
              textStartX: 0,
              gutterWidthPx: 8,
              justification: 'left',
              suffix: 'tab',
              run: { fontFamily: 'Helvetica', fontSize: 12 },
            },
          },
        },
      };
      const terminalTabBreak: FlowBlock = {
        kind: 'paragraph',
        id: 'helvetica-terminal-tab-candidate',
        runs: [
          { text, fontFamily: 'Helvetica', fontSize: 12 },
          { kind: 'tab', text: '\t', fontFamily: 'Helvetica', fontSize: 12 } as TabRun,
          { kind: 'lineBreak', fontFamily: 'Helvetica', fontSize: 12 },
        ],
        attrs: { alignment: 'justify' },
      };

      try {
        clearMeasurementCache();
        const ordinaryMeasure = expectParagraphMeasure(await measureBlock(ordinary, tightWidth));
        clearMeasurementCache();
        const numberingMeasure = expectParagraphMeasure(
          await measureBlock(zeroIndentNumbering, tightWidth + numberingTextStart),
        );
        clearMeasurementCache();
        const terminalAcceptMeasure = expectParagraphMeasure(await measureBlock(terminalTabBreak, 152.9));
        clearMeasurementCache();
        const terminalRejectMeasure = expectParagraphMeasure(await measureBlock(terminalTabBreak, tightWidth));

        expect(extractLineText(ordinary, ordinaryMeasure.lines[0]).trim()).toBe(text);
        expect(extractLineText(zeroIndentNumbering, numberingMeasure.lines[0]).trim()).toBe('aa aa aa aa aa aa aa');
        expect(extractLineText(terminalTabBreak, terminalAcceptMeasure.lines[0]).trim()).toBe(text);
        expect(extractLineText(terminalTabBreak, terminalRejectMeasure.lines[0]).trim()).toBe('aa aa aa aa aa aa aa');
      } finally {
        measureTextSpy.mockRestore();
        clearMeasurementCache();
      }
    });

    it('does not pull a mostly-overflowing candidate back across a tab stop', async () => {
      const contextPrototype = Object.getPrototypeOf(document.createElement('canvas').getContext('2d'));
      const originalMeasureText = contextPrototype.measureText;
      const measureTextSpy = vi.spyOn(contextPrototype, 'measureText').mockImplementation(function (text: string) {
        if (text === 'aa' || text === ' ') {
          return {
            width: 10,
            actualBoundingBoxLeft: 0,
            actualBoundingBoxRight: 10,
            actualBoundingBoxAscent: 8,
            actualBoundingBoxDescent: 2,
          } as TextMetrics;
        }
        return originalMeasureText.call(this, text);
      });
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'justify-tab-compression',
        runs: [
          { kind: 'tab', text: '\t', fontFamily: 'Arial', fontSize: 12 } as TabRun,
          { text: 'aa aa aa aa', fontFamily: 'Arial', fontSize: 12 },
        ],
        attrs: { alignment: 'justify' },
      };

      try {
        clearMeasurementCache();
        const measure = expectParagraphMeasure(await measureBlock(block, 112));

        expect(measure.lines).toHaveLength(2);
        expect(extractLineText(block, measure.lines[0])).not.toContain('aa aa aa aa');
      } finally {
        measureTextSpy.mockRestore();
        clearMeasurementCache();
      }
    });

    it('wraps after a hyphen-minus without dropping the hyphen', async () => {
      const contextPrototype = Object.getPrototypeOf(document.createElement('canvas').getContext('2d'));
      const originalMeasureText = contextPrototype.measureText;
      const measureTextSpy = vi.spyOn(contextPrototype, 'measureText').mockImplementation(function (text: string) {
        if (/^[a-z -]+$/i.test(text)) {
          const width = text.length * 10;
          return {
            width,
            actualBoundingBoxLeft: 0,
            actualBoundingBoxRight: width,
            actualBoundingBoxAscent: 8,
            actualBoundingBoxDescent: 2,
          } as TextMetrics;
        }
        return originalMeasureText.call(this, text);
      });
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'hyphen-wrap',
        runs: [{ text: 'alpha twenty-one omega', fontFamily: 'Arial', fontSize: 12 }],
      };

      try {
        clearMeasurementCache();
        const measure = expectParagraphMeasure(await measureBlock(block, 130.5));

        expect(extractLineText(block, measure.lines[0]).trim()).toBe('alpha twenty-');
        expect(extractLineText(block, measure.lines[1]).trim()).toBe('one omega');
      } finally {
        measureTextSpy.mockRestore();
        clearMeasurementCache();
      }
    });

    it('preserves leading spaces in runs (xml:space="preserve" case)', async () => {
      // When a run starts with a space (common in DOCX with xml:space="preserve"),
      // the space should be included in the line width, not dropped.
      // This tests the fix for segments like " Headquarters:" where split(' ') produces ['', 'Headquarters:']
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'leading-space-test',
        runs: [
          {
            text: 'Location',
            fontFamily: 'Arial',
            fontSize: 12,
          },
          {
            text: ' ',
            fontFamily: 'Arial',
            fontSize: 12,
          },
          {
            text: 'of',
            fontFamily: 'Arial',
            fontSize: 12,
          },
          {
            text: ' Headquarters:',
            fontFamily: 'Arial',
            fontSize: 12,
          },
        ],
        attrs: {},
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 500));
      const lineText = extractLineText(block, measure.lines[0]);

      // The extracted text should include all spaces
      expect(lineText).toBe('Location of Headquarters:');

      // Also verify there's a space between 'of' and 'Headquarters'
      expect(lineText).toContain('of Headquarters');
    });

    it('preserves multiple consecutive spaces from split', async () => {
      // Test consecutive spaces which produce multiple empty strings from split(' ')
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'consecutive-spaces-test',
        runs: [
          {
            text: 'Hello  World', // Two spaces between Hello and World
            fontFamily: 'Arial',
            fontSize: 12,
          },
        ],
        attrs: {},
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 500));
      const lineText = extractLineText(block, measure.lines[0]);

      // Both spaces should be preserved
      expect(lineText).toBe('Hello  World');
    });

    it('prevents line width from exceeding maxWidth after appending segment with trailing space', async () => {
      // This test verifies the post-append overflow guard
      // Scenario: Word fits without space, but word+space exceeds maxWidth
      const block: FlowBlock = {
        kind: 'paragraph',
        id: '0-paragraph',
        runs: [
          {
            text: 'WWWWW XXXXX', // Wide characters to trigger overflow
            fontFamily: 'Arial',
            fontSize: 20,
            bold: true,
          },
        ],
        attrs: {},
      };

      // Measure first word to get its width
      const firstWordBlock: FlowBlock = {
        kind: 'paragraph',
        id: '1-paragraph',
        runs: [
          {
            text: 'WWWWW',
            fontFamily: 'Arial',
            fontSize: 20,
            bold: true,
          },
        ],
        attrs: {},
      };

      const firstWordMeasure = expectParagraphMeasure(await measureBlock(firstWordBlock, 1000));
      const firstWordWidth = firstWordMeasure.lines[0].width;

      // Set maxWidth just barely larger than first word (without space)
      // The post-append guard should prevent overflow when space is added
      const measure = expectParagraphMeasure(await measureBlock(block, firstWordWidth + 3));

      // All lines must respect maxWidth
      for (const line of measure.lines) {
        expect(line.width).toBeLessThanOrEqual(firstWordWidth + 3);
      }

      // Should have wrapped to multiple lines
      expect(measure.lines.length).toBeGreaterThan(1);
    });

    it('handles bounding box width for italic text with overhang', async () => {
      // Italic text can have glyphs that extend beyond advance width
      // Bounding box measurement should account for this
      const italicBlock: FlowBlock = {
        kind: 'paragraph',
        id: '0-paragraph',
        runs: [
          {
            text: 'flying', // 'f' and 'y' have overhang in italic
            fontFamily: 'Arial',
            fontSize: 16,
            italic: true,
          },
        ],
        attrs: {},
      };

      const normalBlock: FlowBlock = {
        kind: 'paragraph',
        id: '1-paragraph',
        runs: [
          {
            text: 'flying',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      const italicMeasure = expectParagraphMeasure(await measureBlock(italicBlock, 1000));
      const normalMeasure = expectParagraphMeasure(await measureBlock(normalBlock, 1000));

      // Italic should have measurable width (may be wider or similar to normal)
      expect(italicMeasure.lines[0].width).toBeGreaterThan(0);
      expect(normalMeasure.lines[0].width).toBeGreaterThan(0);

      // The key is that bounding box prevents clipping
      // Both should fit within their measured widths without visual overflow
      expect(italicMeasure.lines[0].width).toBeGreaterThanOrEqual(normalMeasure.lines[0].width * 0.8);
    });
  });

  describe('trailing space behavior', () => {
    it('does not count trailing space toward maxWidth fit check', async () => {
      // Create a scenario where a word + space would exceed maxWidth,
      // but the word alone fits exactly
      const block: FlowBlock = {
        kind: 'paragraph',
        id: '0-paragraph',
        runs: [
          {
            text: 'Word1 Word2 Word3',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      // Measure to find the width of "Word1"
      const word1Block: FlowBlock = {
        kind: 'paragraph',
        id: '1-paragraph',
        runs: [
          {
            text: 'Word1',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      const word1Measure = expectParagraphMeasure(await measureBlock(word1Block, 1000));
      const word1Width = word1Measure.lines[0].width;

      // Set maxWidth slightly larger than word1Width
      // "Word1 " should fit on first line even though it includes a space,
      // because trailing spaces don't count in the fit check
      const measure = expectParagraphMeasure(await measureBlock(block, word1Width + 2));

      // Should have multiple lines since "Word2" won't fit on the first line
      expect(measure.lines.length).toBeGreaterThan(1);

      // First line should end after "Word1" (5 characters)
      // Note: Trailing space is trimmed from line width
      expect(measure.lines[0].toChar).toBe(5);
    });

    it('includes space width when mid-line', async () => {
      const blockNoSpace: FlowBlock = {
        kind: 'paragraph',
        id: '0-paragraph',
        runs: [
          {
            text: 'HelloWorld',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      const blockWithSpace: FlowBlock = {
        kind: 'paragraph',
        id: '1-paragraph',
        runs: [
          {
            text: 'Hello World',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      const measureNoSpace = expectParagraphMeasure(await measureBlock(blockNoSpace, 1000));
      const measureWithSpace = expectParagraphMeasure(await measureBlock(blockWithSpace, 1000));

      // "Hello World" should be wider than "HelloWorld" due to space
      expect(measureWithSpace.lines[0].width).toBeGreaterThan(measureNoSpace.lines[0].width);
    });
  });

  describe('inline image baseline alignment', () => {
    const inlineImageSrc = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/';

    it('emits baseline alignment for a tiny inline image that fits the text line', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'glyph-image',
        runs: [
          { text: '1.', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 2 },
          { kind: 'image', src: inlineImageSrc, width: 11, height: 10, pmStart: 2, pmEnd: 3 },
          { text: ' Title', fontFamily: 'Arial', fontSize: 16, pmStart: 3, pmEnd: 9 },
        ],
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));
      const line = measure.lines[0];
      expect(line.inlineImageAlignments).toEqual([{ runIndex: 1, verticalAlign: 'baseline' }]);
      // Glyph image must not expand the text-derived line height.
      expect(line.lineHeight).toBeGreaterThan(10);
    });

    it('keeps a tall inline image top-aligned (no baseline entry, line expands)', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'tall-image',
        runs: [
          { text: 'Before ', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 7 },
          { kind: 'image', src: inlineImageSrc, width: 40, height: 40, pmStart: 7, pmEnd: 8 },
        ],
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));
      const line = measure.lines[0];
      expect(line.inlineImageAlignments).toBeUndefined();
      // Line-expanding behaviour preserved: lineHeight grows to the image height.
      expect(line.lineHeight).toBe(40);
    });

    it('measures the visual bounds of a rotated inline image', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'rotated-image',
        runs: [
          {
            kind: 'image',
            src: inlineImageSrc,
            width: 80,
            height: 40,
            rotation: 270,
            pmStart: 0,
            pmEnd: 1,
          },
        ],
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));
      expect(measure.lines[0].width).toBeCloseTo(40);
      expect(measure.lines[0].lineHeight).toBeCloseTo(80);
    });

    it('lets an explicit source verticalAlign win over the measured default', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'explicit-image',
        runs: [
          { text: '1.', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 2 },
          { kind: 'image', src: inlineImageSrc, width: 11, height: 10, verticalAlign: 'top', pmStart: 2, pmEnd: 3 },
        ],
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));
      expect(measure.lines[0].inlineImageAlignments).toBeUndefined();
    });

    it('keeps an image with authored vertical margins top-aligned', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'margin-image',
        runs: [
          { text: 'x', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 1 },
          { kind: 'image', src: inlineImageSrc, width: 11, height: 10, distTop: 4, pmStart: 1, pmEnd: 2 },
        ],
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));
      expect(measure.lines[0].inlineImageAlignments).toBeUndefined();
    });

    it('requires positive image dimensions before emitting baseline alignment', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'zero-width-image',
        runs: [
          { text: 'x', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 1 },
          { kind: 'image', src: inlineImageSrc, width: 0, height: 10, pmStart: 1, pmEnd: 2 },
        ],
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));
      expect(measure.lines[0].inlineImageAlignments).toBeUndefined();
    });

    it('does not emit baseline for an image-only paragraph without owning-run typography', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'image-only',
        runs: [{ kind: 'image', src: inlineImageSrc, width: 11, height: 10, pmStart: 0, pmEnd: 1 }],
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));
      expect(measure.lines[0].inlineImageAlignments).toBeUndefined();
    });

    it('composes a small image-only run against its owning OOXML run baseline', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'image-only-with-run-typography',
        runs: [
          {
            kind: 'image',
            src: inlineImageSrc,
            width: 624,
            height: 3,
            fontFamily: 'Times New Roman',
            fontSize: 52 / 3,
            pmStart: 0,
            pmEnd: 1,
          },
        ],
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));
      const line = measure.lines[0];
      expect(line.inlineImageAlignments).toEqual([{ runIndex: 0, verticalAlign: 'baseline' }]);
      expect(line.lineHeight).toBeGreaterThan(3);
    });

    it('resolves the equal-height boundary deterministically (within tolerance -> baseline, beyond -> top)', async () => {
      // fontSize 16 with no explicit spacing -> text line height = 16 * 1.15 = 18.4px.
      // Tolerance is 0.5px, so 18px fits (baseline) and 20px does not (top).
      const atBoundary: FlowBlock = {
        kind: 'paragraph',
        id: 'boundary-fit',
        runs: [
          { text: 'x', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 1 },
          { kind: 'image', src: inlineImageSrc, width: 11, height: 18, pmStart: 1, pmEnd: 2 },
        ],
      };
      const justOver: FlowBlock = {
        kind: 'paragraph',
        id: 'boundary-over',
        runs: [
          { text: 'x', fontFamily: 'Arial', fontSize: 16, pmStart: 0, pmEnd: 1 },
          { kind: 'image', src: inlineImageSrc, width: 11, height: 20, pmStart: 1, pmEnd: 2 },
        ],
      };

      const fit = expectParagraphMeasure(await measureBlock(atBoundary, 1000));
      expect(fit.lines[0].inlineImageAlignments).toEqual([{ runIndex: 1, verticalAlign: 'baseline' }]);

      const over = expectParagraphMeasure(await measureBlock(justOver, 1000));
      expect(over.lines[0].inlineImageAlignments).toBeUndefined();
    });

    it('treats a bookmark-marker-only line as text-less (no baseline)', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'bookmark-image',
        runs: [
          {
            text: '',
            fontFamily: 'Arial',
            fontSize: 16,
            dataAttrs: { 'data-bookmark-marker': 'start' },
            pmStart: 0,
            pmEnd: 0,
          },
          { kind: 'image', src: inlineImageSrc, width: 11, height: 10, pmStart: 0, pmEnd: 1 },
        ],
      };

      const measure = expectParagraphMeasure(await measureBlock(block, 1000));
      expect(measure.lines[0].inlineImageAlignments).toBeUndefined();
    });
  });

  describe('image measurement', () => {
    it('reports intrinsic size when within constraints', async () => {
      const block: FlowBlock = {
        kind: 'image',
        id: 'img-0',
        src: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/',
        width: 200,
        height: 100,
      };

      const measure = expectImageMeasure(await measureBlock(block, { maxWidth: 400, maxHeight: 400 }));
      expect(measure.width).toBe(200);
      expect(measure.height).toBe(100);
    });

    it('scales width proportionally when exceeding maxWidth', async () => {
      const block: FlowBlock = {
        kind: 'image',
        id: 'img-1',
        src: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/',
        width: 800,
        height: 400,
      };

      const measure = expectImageMeasure(await measureBlock(block, { maxWidth: 400 }));
      expect(measure.width).toBe(400);
      expect(measure.height).toBe(200);
    });

    it('bypasses maxWidth for page-relative anchored images', async () => {
      const block: FlowBlock = {
        kind: 'image',
        id: 'img-page-anchor',
        src: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/',
        width: 800,
        height: 400,
        anchor: {
          isAnchored: true,
          hRelativeFrom: 'page',
        },
      };

      const measure = expectImageMeasure(await measureBlock(block, { maxWidth: 200, maxHeight: 400 }));
      expect(measure.width).toBe(800);
      expect(measure.height).toBe(400);
    });

    it('bypasses maxWidth for margin-relative anchored images', async () => {
      const block: FlowBlock = {
        kind: 'image',
        id: 'img-margin-anchor',
        src: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/',
        width: 640,
        height: 320,
        anchor: {
          isAnchored: true,
          hRelativeFrom: 'margin',
        },
      };

      const measure = expectImageMeasure(await measureBlock(block, { maxWidth: 150, maxHeight: 400 }));
      expect(measure.width).toBe(640);
      expect(measure.height).toBe(320);
    });

    it('preserves authored width for anchored column-relative images', async () => {
      const block: FlowBlock = {
        kind: 'image',
        id: 'img-floating-column-anchor',
        src: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/',
        width: 630,
        height: 130,
        anchor: {
          isAnchored: true,
          hRelativeFrom: 'column',
        },
        wrap: { type: 'Square' },
      };

      const measure = expectImageMeasure(await measureBlock(block, { maxWidth: 176, maxHeight: 864 }));
      expect(measure.width).toBe(630);
      expect(measure.height).toBe(130);
    });

    it('respects maxHeight constraints', async () => {
      const block: FlowBlock = {
        kind: 'image',
        id: 'img-2',
        src: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/',
        width: 400,
        height: 800,
      };

      const measure = expectImageMeasure(await measureBlock(block, { maxWidth: 600, maxHeight: 300 }));
      expect(Math.round(measure.height)).toBe(300);
      expect(measure.width).toBeCloseTo(150);
    });

    describe('floating drawing constraints', () => {
      it('bypasses maxHeight when anchored image has offsetV < 0', async () => {
        const block: FlowBlock = {
          kind: 'image',
          id: 'img-negative-offset',
          src: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/',
          width: 200,
          height: 100,
          anchor: {
            isAnchored: true,
            offsetV: -24,
          },
        };

        // maxHeight is 50, but bypass should allow full 100px height
        const measure = expectImageMeasure(await measureBlock(block, { maxWidth: 400, maxHeight: 50 }));
        expect(measure.width).toBe(200);
        expect(measure.height).toBe(100);
      });

      it('bypasses maxHeight when anchored image has margin.top < 0', async () => {
        const block: FlowBlock = {
          kind: 'image',
          id: 'img-negative-margin',
          src: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/',
          width: 200,
          height: 100,
          anchor: {
            isAnchored: true,
          },
          margin: {
            top: -24,
          },
        };

        // maxHeight is 50, but bypass should allow full 100px height
        const measure = expectImageMeasure(await measureBlock(block, { maxWidth: 400, maxHeight: 50 }));
        expect(measure.width).toBe(200);
        expect(measure.height).toBe(100);
      });

      it('does NOT bypass maxHeight when anchored image has offsetV === 0', async () => {
        const block: FlowBlock = {
          kind: 'image',
          id: 'img-zero-offset',
          src: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/',
          width: 200,
          height: 100,
          anchor: {
            isAnchored: true,
            offsetV: 0,
          },
        };

        // maxHeight is 50, should scale down since no negative offset
        const measure = expectImageMeasure(await measureBlock(block, { maxWidth: 400, maxHeight: 50 }));
        expect(measure.height).toBe(50);
        expect(measure.width).toBe(100);
      });

      it('does NOT bypass maxHeight when image is not anchored', async () => {
        const block: FlowBlock = {
          kind: 'image',
          id: 'img-not-anchored',
          src: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/',
          width: 200,
          height: 100,
          anchor: {
            isAnchored: false,
          },
          margin: {
            top: -24,
          },
        };

        // maxHeight is 50, should scale down since not anchored
        const measure = expectImageMeasure(await measureBlock(block, { maxWidth: 400, maxHeight: 50 }));
        expect(measure.height).toBe(50);
        expect(measure.width).toBe(100);
      });

      it('bypasses maxHeight when objectFit is set to cover', async () => {
        const block: FlowBlock = {
          kind: 'image',
          id: 'img-cover-fit',
          src: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/',
          width: 200,
          height: 100,
          objectFit: 'cover',
        };

        // objectFit: cover should render at exact dimensions, CSS handles content scaling/clipping
        const measure = expectImageMeasure(await measureBlock(block, { maxWidth: 500, maxHeight: 40 }));
        expect(measure.width).toBe(200);
        expect(measure.height).toBe(100);
      });
    });
  });

  describe('drawing measurement', () => {
    it('measures textbox content with canonical font metrics', async () => {
      const block: DrawingBlock = {
        kind: 'drawing',
        id: 'textbox-with-content',
        drawingKind: 'textboxShape',
        geometry: { width: 240, height: 60, rotation: 0 },
        textInsets: { top: 2, right: 4, bottom: 2, left: 4 },
        contentBlocks: [
          {
            kind: 'paragraph',
            id: 'textbox-paragraph',
            runs: [{ text: 'Underlined header', fontFamily: 'Arial', fontSize: 14, underline: {} }],
            attrs: {},
          },
        ],
      };

      const measure = expectDrawingMeasure(await measureBlock(block, { maxWidth: 500 }));
      expect(measure.contentMeasures).toHaveLength(1);
      expect(measure.contentMeasures?.[0].lines).toHaveLength(1);
      expect(measure.contentMeasures?.[0].lines[0].ascent).toBeGreaterThan(0);
      expect(measure.contentMeasures?.[0].lines[0].descent).toBeGreaterThan(0);
    });

    it('keeps wrap-none textbox paragraphs on authored lines while square wrapping remains bounded', async () => {
      const createTextbox = (wrap: 'none' | 'square'): DrawingBlock => ({
        kind: 'drawing',
        id: `textbox-wrap-${wrap}`,
        drawingKind: 'textboxShape',
        geometry: { width: 80, height: 80, rotation: 0 },
        textInsets: { top: 0, right: 0, bottom: 0, left: 0 },
        textLayout: { wrap, horizontalOverflow: 'overflow' },
        contentBlocks: [
          {
            kind: 'paragraph',
            id: `textbox-wrap-${wrap}-paragraph`,
            runs: [
              {
                text: 'This authored WordArt line is deliberately wider than its shape',
                fontFamily: 'Arial',
                fontSize: 20,
              },
            ],
          },
        ],
      });

      const unwrapped = expectDrawingMeasure(await measureBlock(createTextbox('none'), { maxWidth: 500 }));
      const wrapped = expectDrawingMeasure(await measureBlock(createTextbox('square'), { maxWidth: 500 }));

      expect(unwrapped.contentMeasures?.[0].lines).toHaveLength(1);
      expect(wrapped.contentMeasures?.[0].lines.length ?? 0).toBeGreaterThan(1);
    });

    it('grows a wrap-none auto-fit shape up to the available boundary before wrapping', async () => {
      const block: DrawingBlock = {
        kind: 'drawing',
        id: 'autofit-wrap-none-boundary',
        drawingKind: 'textboxShape',
        geometry: { width: 80, height: 80, rotation: 0 },
        autoFit: true,
        textInsets: { top: 0, right: 4, bottom: 0, left: 4 },
        textLayout: { wrap: 'none', horizontalOverflow: 'overflow' },
        contentBlocks: [
          {
            kind: 'paragraph',
            id: 'autofit-wrap-none-boundary-paragraph',
            runs: [
              {
                text: 'A deliberately long WordArt line that must reach its boundary',
                fontFamily: 'Arial',
                fontSize: 20,
              },
            ],
          },
        ],
      };

      const measure = expectDrawingMeasure(await measureBlock(block, { maxWidth: 200 }));

      expect(measure.geometry.width).toBe(200);
      expect(measure.contentMeasures?.[0].lines.length ?? 0).toBeGreaterThan(1);
    });

    it('keeps a baseline-warp auto-fit shape on one logical line while growing its frame', async () => {
      const block: DrawingBlock = {
        kind: 'drawing',
        id: 'autofit-baseline-warp',
        drawingKind: 'textboxShape',
        geometry: { width: 80, height: 80, rotation: 0 },
        autoFit: true,
        textInsets: { top: 0, right: 4, bottom: 0, left: 4 },
        textLayout: { wrap: 'none', horizontalOverflow: 'overflow' },
        textWarp: { preset: 'textArchUp' },
        contentBlocks: [
          {
            kind: 'paragraph',
            id: 'autofit-baseline-warp-paragraph',
            runs: [
              {
                text: 'A deliberately long WordArt baseline that must not wrap',
                fontFamily: 'Arial',
                fontSize: 20,
              },
            ],
          },
        ],
      };

      const measure = expectDrawingMeasure(await measureBlock(block, { maxWidth: 200 }));

      expect(measure.geometry.width).toBe(200);
      expect(measure.contentMeasures?.[0].lines).toHaveLength(1);
      expect(measure.geometry.height).toBe(measure.contentMeasures?.[0].totalHeight);
    });

    it('sizes short baseline-warp auto-fit shapes to their natural unwrapped advance', async () => {
      const block: DrawingBlock = {
        kind: 'drawing',
        id: 'autofit-short-baseline-warp',
        drawingKind: 'textboxShape',
        geometry: { width: 80, height: 80, rotation: 0 },
        autoFit: true,
        textInsets: { top: 0, right: 4, bottom: 0, left: 4 },
        textLayout: { wrap: 'none', horizontalOverflow: 'overflow' },
        textWarp: { preset: 'textArchUp' },
        contentBlocks: [
          {
            kind: 'paragraph',
            id: 'autofit-short-baseline-warp-paragraph',
            runs: [{ text: 'Arc', fontFamily: 'Arial', fontSize: 20 }],
          },
        ],
      };

      const measure = expectDrawingMeasure(await measureBlock(block, { maxWidth: 200 }));
      const paragraph = measure.contentMeasures?.[0];

      expect(paragraph?.kind).toBe('paragraph');
      if (paragraph?.kind !== 'paragraph') throw new Error('expected paragraph measure');
      expect(paragraph.lines).toHaveLength(1);
      expect(measure.geometry.width).toBeCloseTo(paragraph.lines[0].width + 8);
      expect(measure.geometry.width).toBeLessThan(200);
    });

    it('sizes short single-band envelope auto-fit shapes to their natural advance', async () => {
      const block: DrawingBlock = {
        kind: 'drawing',
        id: 'autofit-short-single-band-envelope',
        drawingKind: 'textboxShape',
        geometry: { width: 80, height: 80, rotation: 0 },
        autoFit: true,
        textInsets: { top: 0, right: 4, bottom: 0, left: 4 },
        textLayout: { wrap: 'none', horizontalOverflow: 'overflow' },
        textWarp: { preset: 'textButton' },
        contentBlocks: [
          {
            kind: 'paragraph',
            id: 'autofit-short-single-band-envelope-paragraph',
            runs: [{ text: 'Word Art', fontFamily: 'Arial', fontSize: 20 }],
          },
        ],
      };

      const measure = expectDrawingMeasure(await measureBlock(block, { maxWidth: 200 }));
      const paragraph = measure.contentMeasures?.[0];

      expect(paragraph?.kind).toBe('paragraph');
      if (paragraph?.kind !== 'paragraph') throw new Error('expected paragraph measure');
      expect(paragraph.lines).toHaveLength(1);
      expect(measure.geometry.width).toBeCloseTo(paragraph.lines[0].width + 8);
      expect(measure.geometry.width).toBeLessThan(200);
    });

    it('caps long textButton auto-fit shapes without recomposing the logical baseline', async () => {
      const block: DrawingBlock = {
        kind: 'drawing',
        id: 'autofit-long-single-band-envelope',
        drawingKind: 'textboxShape',
        geometry: { width: 80, height: 80, rotation: 0 },
        autoFit: true,
        textInsets: { top: 0, right: 4, bottom: 0, left: 4 },
        textLayout: { wrap: 'none', horizontalOverflow: 'overflow' },
        textWarp: { preset: 'textButton' },
        contentBlocks: [
          {
            kind: 'paragraph',
            id: 'autofit-long-single-band-envelope-paragraph',
            runs: [
              {
                text: 'Word Art that inserts as object and keeps extending beyond the available width',
                fontFamily: 'Arial',
                fontSize: 20,
              },
            ],
          },
        ],
      };

      const measure = expectDrawingMeasure(await measureBlock(block, { maxWidth: 200 }));

      expect(measure.geometry.width).toBeLessThanOrEqual(200);
      expect(measure.geometry.width).toBeGreaterThan(190);
      expect(measure.contentMeasures?.[0].lines).toHaveLength(1);
    });

    it('measures textbox tables with canonical auto, atLeast, and exact row-height semantics', async () => {
      const measureVariant = async (rule: 'auto' | 'atLeast' | 'exact', value: number) => {
        const block: DrawingBlock = {
          kind: 'drawing',
          id: `textbox-table-${rule}`,
          drawingKind: 'textboxShape',
          geometry: { width: 120, height: 20, rotation: 0 },
          textInsets: { top: 0, right: 0, bottom: 0, left: 0 },
          contentBlocks: [
            {
              kind: 'table',
              id: `textbox-table-content-${rule}`,
              columnWidths: [120],
              rows: [
                {
                  id: `textbox-table-row-${rule}`,
                  attrs: { rowHeight: { rule, value } },
                  cells: [
                    {
                      id: `textbox-table-cell-${rule}`,
                      blocks: [
                        {
                          kind: 'paragraph',
                          id: `textbox-table-paragraph-${rule}`,
                          runs: [{ text: 'Table content', fontFamily: 'Arial', fontSize: 12 }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        };
        return expectDrawingMeasure(await measureBlock(block, { maxWidth: 500 }));
      };

      const auto = await measureVariant('auto', 100);
      const atLeast = await measureVariant('atLeast', 40);
      const exact = await measureVariant('exact', 4);
      const autoTable = auto.contentMeasures?.[0];
      const atLeastTable = atLeast.contentMeasures?.[0];
      const exactTable = exact.contentMeasures?.[0];

      expect(autoTable?.kind).toBe('table');
      expect(atLeastTable?.kind).toBe('table');
      expect(exactTable?.kind).toBe('table');
      if (autoTable?.kind !== 'table' || atLeastTable?.kind !== 'table' || exactTable?.kind !== 'table') {
        throw new Error('expected nested table measures');
      }
      expect(autoTable.rows[0]?.height).toBeLessThan(100);
      expect(atLeastTable.rows[0]?.height).toBe(40);
      expect(exactTable.rows[0]?.height).toBe(4);
      expect(auto.height).toBe(20);
      expect(atLeast.height).toBe(20);
      expect(exact.height).toBe(20);
    });

    it('shrinks an auto-fit textbox to its measured text, paragraph spacing, and insets', async () => {
      const block = {
        kind: 'drawing',
        id: 'autofit-textbox',
        drawingKind: 'textboxShape',
        geometry: { width: 120, height: 147, rotation: 0 },
        autoFit: true,
        textInsets: { top: 4.8, right: 9.6, bottom: 4.8, left: 9.6 },
        contentBlocks: [
          {
            kind: 'paragraph',
            id: 'autofit-textbox-paragraph',
            runs: [{ text: 'Contract “ACC”', fontFamily: 'Aptos', fontSize: 44 / 3 }],
            attrs: {
              spacing: { after: 32 / 3, line: 259 / 240, lineUnit: 'multiplier', lineRule: 'auto' },
            },
          },
        ],
      } as unknown as DrawingBlock;

      const measure = expectDrawingMeasure(await measureBlock(block, { maxWidth: 500 }));
      const contentHeight = measure.contentMeasures?.[0]?.totalHeight ?? 0;
      expect(measure.geometry.height).toBeCloseTo(contentHeight + 32 / 3 + 9.6, 6);
      expect(measure.height).toBeCloseTo(measure.geometry.height, 6);
      expect(measure.height).toBeLessThan(147);
    });

    it('keeps frozen textbox tab runs immutable while returning their measured widths', async () => {
      const tabRun: TabRun = {
        kind: 'tab',
        text: '\t',
        fontFamily: 'Arial',
        fontSize: 12,
        underline: {},
      };
      const block: DrawingBlock = {
        kind: 'drawing',
        id: 'frozen-textbox-tab',
        drawingKind: 'textboxShape',
        geometry: { width: 240, height: 60, rotation: 0 },
        contentBlocks: [
          {
            kind: 'paragraph',
            id: 'frozen-textbox-tab-paragraph',
            runs: [tabRun],
            attrs: { tabs: [{ val: 'start', pos: 1440 }] },
          },
        ],
      };
      Object.freeze(tabRun);
      Object.freeze(block.contentBlocks[0]!.runs);
      Object.freeze(block.contentBlocks[0]!);
      Object.freeze(block.contentBlocks);
      Object.freeze(block);

      const measure = expectDrawingMeasure(await measureBlock(block, { maxWidth: 500 }));

      expect(measure.contentMeasures?.[0].lines[0].tabWidths?.[0]).toBeGreaterThan(0);
      expect(tabRun).not.toHaveProperty('width');
      expect(Object.isFrozen(tabRun)).toBe(true);
    });

    it('honors rotated geometry', async () => {
      const block: DrawingBlock = {
        kind: 'drawing',
        id: 'drawing-0',
        drawingKind: 'vectorShape',
        geometry: {
          width: 120,
          height: 60,
          rotation: 90,
        },
      };

      const measure = expectDrawingMeasure(await measureBlock(block, { maxWidth: 500 }));
      expect(measure.width).toBeCloseTo(60);
      expect(measure.height).toBeCloseTo(120);
      expect(measure.scale).toBe(1);
    });

    it('resolves full-width drawings using maxWidth constraints and indents', async () => {
      const block: DrawingBlock = {
        kind: 'drawing',
        id: 'drawing-full-width',
        drawingKind: 'vectorShape',
        geometry: {
          width: 1,
          height: 2,
          rotation: 0,
          flipH: false,
          flipV: false,
        },
        attrs: {
          isFullWidth: true,
          hrIndentLeft: -20,
          hrIndentRight: 10,
        },
      };

      const measure = expectDrawingMeasure(await measureBlock(block, { maxWidth: 300, maxHeight: 20 }));
      expect(measure.width).toBe(310);
      expect(measure.height).toBe(2);
      expect(measure.geometry.width).toBe(310);
    });

    it('scales proportionally when exceeding constraints', async () => {
      const block: DrawingBlock = {
        kind: 'drawing',
        id: 'drawing-1',
        drawingKind: 'vectorShape',
        geometry: {
          width: 400,
          height: 200,
          rotation: 0,
        },
      };

      const measure = expectDrawingMeasure(await measureBlock(block, { maxWidth: 200, maxHeight: 150 }));
      expect(measure.width).toBeCloseTo(200);
      expect(measure.height).toBeCloseTo(100);
      expect(measure.scale).toBeCloseTo(0.5);
    });

    it('normalizes rotation within geometry', async () => {
      const block: DrawingBlock = {
        kind: 'drawing',
        id: 'drawing-rot',
        drawingKind: 'vectorShape',
        geometry: {
          width: 50,
          height: 20,
          rotation: -450,
        },
      };

      const measure = expectDrawingMeasure(await measureBlock(block, { maxWidth: 200 }));
      expect(measure.geometry.rotation).toBe(270);
    });

    it('uses the projected outer geometry when an effectExtent-bearing shape is rotated', async () => {
      const block: DrawingBlock = {
        kind: 'drawing',
        id: 'drawing-effect-extent',
        drawingKind: 'vectorShape',
        geometry: {
          width: 57.5,
          height: 21,
          rotation: 270,
        },
        effectExtent: {
          left: 0,
          top: 0.5,
          right: 2.5,
          bottom: 4.5,
        },
      };

      const measure = expectDrawingMeasure(await measureBlock(block, { maxWidth: 500 }));
      expect(measure.geometry.width).toBeCloseTo(57.5, 3);
      expect(measure.geometry.height).toBeCloseTo(21, 3);
      expect(measure.width).toBeCloseTo(21, 3);
      expect(measure.height).toBeCloseTo(57.5, 3);
      expect(measure.naturalWidth).toBeCloseTo(21, 3);
      expect(measure.naturalHeight).toBeCloseTo(57.5, 3);
    });

    it('does not shrink an inline connector when only its effect extent exceeds the text constraint', async () => {
      const block: DrawingBlock = {
        kind: 'drawing',
        id: 'footer-connector',
        drawingKind: 'vectorShape',
        shapeKind: 'line',
        geometry: { width: 700, height: 8, rotation: 0 },
        effectExtent: { left: 0, top: 3, right: 5, bottom: 4 },
        strokeColor: '#7CE0D3',
        strokeWidth: 6,
        strokeLineCap: 'butt',
      };

      const measure = expectDrawingMeasure(await measureBlock(block, { maxWidth: 697, maxHeight: 100 }));
      expect(measure.width).toBe(700);
      expect(measure.height).toBe(8);
      expect(measure.scale).toBe(1);
    });

    describe('negative positioning bypass logic', () => {
      it('bypasses maxHeight when anchored drawing has offsetV < 0', async () => {
        const block: DrawingBlock = {
          kind: 'drawing',
          id: 'drawing-negative-offset',
          drawingKind: 'vectorShape',
          geometry: {
            width: 100,
            height: 200,
            rotation: 0,
          },
          anchor: {
            isAnchored: true,
            offsetV: -50,
          },
        };

        const measure = expectDrawingMeasure(await measureBlock(block, { maxWidth: 500, maxHeight: 100 }));
        // Should NOT scale height due to negative offsetV bypass
        expect(measure.height).toBe(200);
        expect(measure.width).toBe(100);
        expect(measure.scale).toBe(1);
      });

      it('bypasses maxHeight when anchored drawing has margin.top < 0', async () => {
        const block: DrawingBlock = {
          kind: 'drawing',
          id: 'drawing-negative-margin',
          drawingKind: 'vectorShape',
          geometry: {
            width: 100,
            height: 200,
            rotation: 0,
          },
          anchor: {
            isAnchored: true,
            offsetV: 0,
          },
          margin: {
            top: -30,
          },
        };

        const measure = expectDrawingMeasure(await measureBlock(block, { maxWidth: 500, maxHeight: 100 }));
        // Should NOT scale height due to negative margin.top bypass
        expect(measure.height).toBe(200);
        expect(measure.width).toBe(100);
        expect(measure.scale).toBe(1);
      });

      it('preserves page-sized anchored drawings when the story band is shorter', async () => {
        const block: DrawingBlock = {
          kind: 'drawing',
          id: 'page-sized-header-group',
          drawingKind: 'shapeGroup',
          geometry: {
            width: 793.7,
            height: 1122.5,
            rotation: 0,
          },
          anchor: {
            isAnchored: true,
            hRelativeFrom: 'page',
            vRelativeFrom: 'page',
            offsetV: 0,
          },
        };

        const measure = expectDrawingMeasure(await measureBlock(block, { maxWidth: 593.2, maxHeight: 839 }));
        expect(measure.width).toBeCloseTo(793.7);
        expect(measure.height).toBeCloseTo(1122.5);
        expect(measure.scale).toBe(1);
      });

      it('does NOT bypass maxHeight when non-anchored drawing has negative margin', async () => {
        const block: DrawingBlock = {
          kind: 'drawing',
          id: 'drawing-not-anchored',
          drawingKind: 'vectorShape',
          geometry: {
            width: 100,
            height: 200,
            rotation: 0,
          },
          anchor: {
            isAnchored: false,
          },
          margin: {
            top: -30,
          },
        };

        const measure = expectDrawingMeasure(await measureBlock(block, { maxWidth: 500, maxHeight: 100 }));
        // Should scale height because drawing is not anchored
        expect(measure.height).toBe(100);
        expect(measure.width).toBe(50);
        expect(measure.scale).toBe(0.5);
      });

      it('preserves anchored drawing dimensions with positive offsets', async () => {
        const block: DrawingBlock = {
          kind: 'drawing',
          id: 'drawing-positive-offset',
          drawingKind: 'vectorShape',
          geometry: {
            width: 100,
            height: 200,
            rotation: 0,
          },
          anchor: {
            isAnchored: true,
            offsetV: 10,
          },
          margin: {
            top: 5,
          },
        };

        const measure = expectDrawingMeasure(await measureBlock(block, { maxWidth: 500, maxHeight: 100 }));
        expect(measure.height).toBe(200);
        expect(measure.width).toBe(100);
        expect(measure.scale).toBe(1);
      });

      it('bypasses maxHeight when one of offsetV or margin.top is negative (OR condition)', async () => {
        const block: DrawingBlock = {
          kind: 'drawing',
          id: 'drawing-mixed-offsets',
          drawingKind: 'vectorShape',
          geometry: {
            width: 100,
            height: 200,
            rotation: 0,
          },
          anchor: {
            isAnchored: true,
            offsetV: 10,
          },
          margin: {
            top: -20,
          },
        };

        const measure = expectDrawingMeasure(await measureBlock(block, { maxWidth: 500, maxHeight: 100 }));
        // Should NOT scale height because margin.top is negative (OR condition)
        expect(measure.height).toBe(200);
        expect(measure.width).toBe(100);
        expect(measure.scale).toBe(1);
      });

      it('bypasses maxHeight when offsetV is negative even with positive margin.top', async () => {
        const block: DrawingBlock = {
          kind: 'drawing',
          id: 'drawing-negative-offsetV-positive-margin',
          drawingKind: 'vectorShape',
          geometry: {
            width: 100,
            height: 200,
            rotation: 0,
          },
          anchor: {
            isAnchored: true,
            offsetV: -15,
          },
          margin: {
            top: 25,
          },
        };

        const measure = expectDrawingMeasure(await measureBlock(block, { maxWidth: 500, maxHeight: 100 }));
        // Should NOT scale height because offsetV is negative (OR condition)
        expect(measure.height).toBe(200);
        expect(measure.width).toBe(100);
        expect(measure.scale).toBe(1);
      });
    });
  });

  describe('table measurement with column widths', () => {
    it('reserves the authored total width for separate double table borders', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'table-double-border-width',
        attrs: {
          borderCollapse: 'separate',
          borders: {
            top: { style: 'double', width: 2 / 3 },
            right: { style: 'double', width: 2 / 3 },
            bottom: { style: 'double', width: 2 / 3 },
            left: { style: 'double', width: 2 / 3 },
          },
        },
        rows: [
          {
            id: 'row-double-border-width',
            cells: [
              {
                id: 'cell-double-border-width',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'paragraph-double-border-width',
                    runs: [{ text: 'A', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [100],
      };

      const measure = await measureBlock(block, { maxWidth: 600 });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');
      expect(measure.tableBorderWidths).toEqual({
        top: 2 / 3,
        right: 2 / 3,
        bottom: 2 / 3,
        left: 2 / 3,
      });
      expect(measure.totalWidth).toBeCloseTo(100 + 4 / 3, 4);
    });

    it('includes explicit cell border chrome in automatic row height', async () => {
      const createTable = (borders?: CellBorders): FlowBlock => ({
        kind: 'table',
        id: borders ? 'table-bordered-cell' : 'table-borderless-cell',
        rows: [
          {
            id: 'row',
            cells: [
              {
                id: 'cell',
                attrs: borders ? { borders } : undefined,
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'paragraph',
                    runs: [{ text: 'Cell text', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [100],
      });
      const doubleRing: CellBorders = {
        top: { style: 'double', width: 3 },
        right: { style: 'double', width: 3 },
        bottom: { style: 'double', width: 3 },
        left: { style: 'double', width: 3 },
      };

      const borderless = await measureBlock(createTable(), { maxWidth: 600 });
      const bordered = await measureBlock(createTable(doubleRing), { maxWidth: 600 });

      expect(borderless.kind).toBe('table');
      expect(bordered.kind).toBe('table');
      if (borderless.kind !== 'table' || bordered.kind !== 'table') throw new Error('expected table measures');
      expect(bordered.rows[0]?.height).toBeCloseTo((borderless.rows[0]?.height ?? 0) + 6, 4);
      expect(bordered.rows[0]?.cells[0]?.height).toBeCloseTo((borderless.rows[0]?.cells[0]?.height ?? 0) + 6, 4);
    });

    it('adds the owned collapsed border to an authored atLeast row height', async () => {
      const border = { style: 'single' as const, width: 1, color: '#000000' };
      const block: FlowBlock = {
        kind: 'table',
        id: 'table-at-least-height-with-collapsed-grid',
        attrs: {
          borders: {
            top: border,
            right: border,
            bottom: border,
            left: border,
            insideH: border,
            insideV: border,
          },
        },
        columnWidths: [100],
        rows: [0, 1].map((rowIndex) => ({
          id: `row-${rowIndex}`,
          attrs: { rowHeight: { rule: 'atLeast', value: 40 } },
          cells: [
            {
              id: `cell-${rowIndex}`,
              blocks: [{ kind: 'paragraph', id: `paragraph-${rowIndex}`, runs: [] }],
            },
          ],
        })),
      };

      const measure = await measureBlock(block, { maxWidth: 600 });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');
      expect(measure.rows.map((row) => row.height)).toEqual([41, 41]);
      expect(measure.totalHeight).toBe(82);
    });

    it('adds vertical cell padding outside an authored atLeast row height', async () => {
      const borderWidth = 2 / 3;
      const verticalPadding = 3.8;
      const block: FlowBlock = {
        kind: 'table',
        id: 'table-at-least-height-with-cell-padding',
        attrs: {
          borders: {
            top: { style: 'single', width: borderWidth },
            right: { style: 'single', width: borderWidth },
            bottom: { style: 'single', width: borderWidth },
            left: { style: 'single', width: borderWidth },
            insideH: { style: 'single', width: borderWidth },
            insideV: { style: 'single', width: borderWidth },
          },
        },
        columnWidths: [450.2],
        rows: [
          {
            id: 'first-name-row',
            attrs: { rowHeight: { rule: 'atLeast', value: 19.6 } },
            cells: [
              {
                id: 'first-name-cell',
                attrs: {
                  padding: { top: verticalPadding, right: 7.2, bottom: verticalPadding, left: 7.2 },
                },
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'first-name-paragraph',
                    runs: [{ text: 'First name', fontFamily: 'Calibri, sans-serif', fontSize: 12 }],
                  },
                ],
              },
            ],
          },
        ],
      };

      const measure = await measureBlock(
        block,
        { maxWidth: 600 },
        {
          fontSignature: 'template-data-table-row',
          resolvePhysical: () => 'Carlito, sans-serif',
        },
      );

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');
      expect(measure.rows[0]?.height).toBeCloseTo(19.6 + verticalPadding * 2 + borderWidth, 4);
    });

    it('uses provided column widths from w:tblGrid', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'table-0',
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'A', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
                paragraph: {
                  kind: 'paragraph',
                  id: 'para-0',
                  runs: [{ text: 'A', fontFamily: 'Arial', fontSize: 12 }],
                },
              },
              {
                id: 'cell-0-1',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-1',
                    runs: [{ text: 'B', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
                paragraph: {
                  kind: 'paragraph',
                  id: 'para-1',
                  runs: [{ text: 'B', fontFamily: 'Arial', fontSize: 12 }],
                },
              },
              {
                id: 'cell-0-2',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-2',
                    runs: [{ text: 'C', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
                paragraph: {
                  kind: 'paragraph',
                  id: 'para-2',
                  runs: [{ text: 'C', fontFamily: 'Arial', fontSize: 12 }],
                },
              },
            ],
          },
        ],
        columnWidths: [100, 150, 200], // Specific widths from OOXML
      };

      const measure = await measureBlock(block, { maxWidth: 600 });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');
      // AutoFit uses authored grid widths as the fixed-pass baseline, but the
      // final runtime vector may still rebalance them based on content.
      expect(measure.columnWidths).toHaveLength(3);
      expect(measure.columnWidths[0]).toBeGreaterThan(0);
      expect(measure.columnWidths[1]).toBeGreaterThan(measure.columnWidths[0]);
      expect(measure.columnWidths[2]).toBeGreaterThan(measure.columnWidths[1]);
      expect(measure.totalWidth).toBe(450);
    });

    it('keeps tblW auto tables with a fitting authored grid within that grid budget despite wider tcW preferences', async () => {
      const paragraph = (id: string, text: string): FlowBlock => ({
        kind: 'paragraph',
        id,
        runs: [{ text, fontFamily: 'Arial', fontSize: 12 }],
      });
      const cell = (id: string, text: string, width: number) => ({
        id,
        blocks: [paragraph(`${id}-paragraph`, text)],
        attrs: {
          tableCellProperties: {
            cellWidth: { value: width, type: 'dxa' },
          },
        },
      });
      const block: FlowBlock = {
        kind: 'table',
        id: 'table-autofit-grid-budget',
        attrs: {
          tableWidth: { value: 0, type: 'auto' },
        },
        rows: [
          {
            id: 'row-0',
            cells: [
              cell('cell-0-0', 'Title', 3600),
              cell('cell-0-1', 'Year', 1152),
              cell('cell-0-2', 'Genre', 2160),
              cell('cell-0-3', 'Notes', 4320),
            ],
          },
          {
            id: 'row-1',
            cells: [
              cell('cell-1-0', 'A', 2160),
              cell('cell-1-1', 'B', 2160),
              cell('cell-1-2', 'C', 2160),
              cell('cell-1-3', 'D', 2160),
            ],
          },
        ],
        columnWidths: [144, 144, 144, 144],
      };

      const measure = await measureBlock(block, { maxWidth: 576 });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');
      expect(measure.columnWidths).toHaveLength(4);
      expect(measure.totalWidth).toBeLessThanOrEqual(576);
      expect(measure.columnWidths[0]).toBeGreaterThan(measure.columnWidths[1]);
      expect(measure.columnWidths[3]).toBeGreaterThan(measure.columnWidths[2]);
    });

    it('does not stretch missing-grid AutoFit tables to fallback content width', async () => {
      const paragraph = (id: string, text: string): FlowBlock => ({
        kind: 'paragraph',
        id,
        runs: [{ text, fontFamily: 'Times New Roman', fontSize: 12 }],
      });
      const cell = (id: string, text: string, width: number) => ({
        id,
        blocks: [paragraph(`${id}-paragraph`, text)],
        attrs: {
          tableCellProperties: {
            cellWidth: { value: width, type: 'dxa' },
          },
        },
      });
      const block: FlowBlock = {
        kind: 'table',
        id: 'table-autofit-missing-grid',
        attrs: {},
        rows: [
          {
            id: 'row-0',
            cells: [
              cell('cell-0-0', '', 3885),
              cell('cell-0-1', 'Lets see how Word Reacts seems liek we are...', 3900),
            ],
          },
          {
            id: 'row-1',
            cells: [cell('cell-1-0', 'Lets go ..', 3885), cell('cell-1-1', '', 3900)],
          },
        ],
        columnWidths: [312, 312],
      };

      const measure = await measureBlock(block, { maxWidth: 624 });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');
      expect(measure.columnWidths).toHaveLength(2);
      expect(measure.totalWidth).toBeCloseTo(519, 3);
    });

    it('scales column widths proportionally when exceeding available width', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'table-1',
        attrs: {
          tableWidth: { value: 5000, type: 'pct' },
        },
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'A', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
                paragraph: {
                  kind: 'paragraph',
                  id: 'para-0',
                  runs: [{ text: 'A', fontFamily: 'Arial', fontSize: 12 }],
                },
              },
              {
                id: 'cell-0-1',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-1',
                    runs: [{ text: 'B', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
                paragraph: {
                  kind: 'paragraph',
                  id: 'para-1',
                  runs: [{ text: 'B', fontFamily: 'Arial', fontSize: 12 }],
                },
              },
            ],
          },
        ],
        columnWidths: [400, 400], // Total 800px, but pct width should rescale to current column
      };

      const measure = await measureBlock(block, { maxWidth: 600 });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');
      // Percentage width should rescale to the current column width: 400 * (600/800) = 300
      expect(measure.columnWidths[0]).toBe(300);
      expect(measure.columnWidths[1]).toBe(300);
      expect(measure.totalWidth).toBe(600);
    });

    it('uses content-driven widths when no authored column widths exist', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'table-2',
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'A', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
                paragraph: {
                  kind: 'paragraph',
                  id: 'para-0',
                  runs: [{ text: 'A', fontFamily: 'Arial', fontSize: 12 }],
                },
              },
              {
                id: 'cell-0-1',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-1',
                    runs: [{ text: 'B', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
                paragraph: {
                  kind: 'paragraph',
                  id: 'para-1',
                  runs: [{ text: 'B', fontFamily: 'Arial', fontSize: 12 }],
                },
              },
              {
                id: 'cell-0-2',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-2',
                    runs: [{ text: 'C', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
                paragraph: {
                  kind: 'paragraph',
                  id: 'para-2',
                  runs: [{ text: 'C', fontFamily: 'Arial', fontSize: 12 }],
                },
              },
            ],
          },
        ],
        // No columnWidths provided
      };

      const measure = await measureBlock(block, { maxWidth: 600 });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');
      expect(measure.columnWidths).toHaveLength(3);
      measure.columnWidths.forEach((width) => {
        expect(width).toBeGreaterThan(0);
      });
      expect(Math.abs(measure.columnWidths[0] - measure.columnWidths[1])).toBeLessThan(1);
    });

    it('preserves authored widths and synthesizes runtime widths for missing logical columns', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'table-3',
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'A', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
                paragraph: {
                  kind: 'paragraph',
                  id: 'para-0',
                  runs: [{ text: 'A', fontFamily: 'Arial', fontSize: 12 }],
                },
              },
              {
                id: 'cell-0-1',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-1',
                    runs: [{ text: 'B', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
                paragraph: {
                  kind: 'paragraph',
                  id: 'para-1',
                  runs: [{ text: 'B', fontFamily: 'Arial', fontSize: 12 }],
                },
              },
              {
                id: 'cell-0-2',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-2',
                    runs: [{ text: 'C', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
                paragraph: {
                  kind: 'paragraph',
                  id: 'para-2',
                  runs: [{ text: 'C', fontFamily: 'Arial', fontSize: 12 }],
                },
              },
            ],
          },
        ],
        columnWidths: [100, 150], // Only 2 widths, but 3 columns
      };

      const measure = await measureBlock(block, { maxWidth: 600 });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');
      expect(measure.columnWidths).toHaveLength(3);
      expect(measure.columnWidths[0]).toBeGreaterThan(0);
      expect(measure.columnWidths[1]).toBeGreaterThan(measure.columnWidths[0]);
      expect(measure.columnWidths[2]).toBeGreaterThan(0);
      expect(measure.totalWidth).toBeCloseTo(
        measure.columnWidths.reduce((sum, width) => sum + width, 0),
        3,
      );
    });

    it('preserves authored logical columns even when rows use fewer physical cells', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'table-4',
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'A', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
                paragraph: {
                  kind: 'paragraph',
                  id: 'para-0',
                  runs: [{ text: 'A', fontFamily: 'Arial', fontSize: 12 }],
                },
              },
              {
                id: 'cell-0-1',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-1',
                    runs: [{ text: 'B', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
                paragraph: {
                  kind: 'paragraph',
                  id: 'para-1',
                  runs: [{ text: 'B', fontFamily: 'Arial', fontSize: 12 }],
                },
              },
            ],
          },
        ],
        columnWidths: [100, 150, 200, 250], // 4 widths, but only 2 columns
      };

      const measure = await measureBlock(block, { maxWidth: 600 });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');
      expect(measure.columnWidths).toHaveLength(4);
      expect(measure.columnWidths.reduce((sum, width) => sum + width, 0)).toBe(600);
    });
  });

  describe('multi-paragraph cell support', () => {
    it('measures cell with multiple paragraphs and accumulates height', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'multi-para-table',
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'First paragraph', fontFamily: 'Arial', fontSize: 12 }],
                    attrs: {},
                  },
                  {
                    kind: 'paragraph',
                    id: 'para-1',
                    runs: [{ text: 'Second paragraph', fontFamily: 'Arial', fontSize: 12 }],
                    attrs: {},
                  },
                  {
                    kind: 'paragraph',
                    id: 'para-2',
                    runs: [{ text: 'Third paragraph', fontFamily: 'Arial', fontSize: 12 }],
                    attrs: {},
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [200],
      };

      const measure = await measureBlock(block, { maxWidth: 600 });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      const cellMeasure = measure.rows[0].cells[0];
      expect(cellMeasure.blocks).toHaveLength(3);

      // Each paragraph should be measured
      expect(cellMeasure.blocks[0].kind).toBe('paragraph');
      expect(cellMeasure.blocks[1].kind).toBe('paragraph');
      expect(cellMeasure.blocks[2].kind).toBe('paragraph');

      // Heights should accumulate (3 paragraphs)
      const para1Height = cellMeasure.blocks[0].totalHeight;
      const para2Height = cellMeasure.blocks[1].totalHeight;
      const para3Height = cellMeasure.blocks[2].totalHeight;
      const totalContentHeight = para1Height + para2Height + para3Height;

      expect(cellMeasure.height).toBe(totalContentHeight);
    });

    it('measures cell with empty blocks array', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'empty-blocks-table',
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [],
              },
            ],
          },
        ],
        columnWidths: [200],
      };

      const measure = await measureBlock(block, { maxWidth: 600 });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      const cellMeasure = measure.rows[0].cells[0];
      expect(cellMeasure.blocks).toHaveLength(0);
      expect(cellMeasure.height).toBe(0);
    });

    it('maintains backward compatibility with legacy paragraph field', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'legacy-paragraph-table',
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                paragraph: {
                  kind: 'paragraph',
                  id: 'para-0',
                  runs: [{ text: 'Legacy paragraph', fontFamily: 'Arial', fontSize: 12 }],
                  attrs: {},
                },
              },
            ],
          },
        ],
        columnWidths: [200],
      };

      const measure = await measureBlock(block, { maxWidth: 600 });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      const cellMeasure = measure.rows[0].cells[0];

      // Should have blocks array from paragraph fallback
      expect(cellMeasure.blocks).toHaveLength(1);
      expect(cellMeasure.blocks[0].kind).toBe('paragraph');

      // Should also have paragraph field for backward compatibility
      expect(cellMeasure.paragraph).toBeDefined();
      expect(cellMeasure.paragraph?.kind).toBe('paragraph');
    });

    it('calculates height correctly including padding for multi-block cells', async () => {
      const customPadding = { top: 10, bottom: 20, left: 5, right: 5 };
      const block: FlowBlock = {
        kind: 'table',
        id: 'padding-table',
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'Paragraph with custom padding', fontFamily: 'Arial', fontSize: 12 }],
                    attrs: {},
                  },
                  {
                    kind: 'paragraph',
                    id: 'para-1',
                    runs: [{ text: 'Second paragraph', fontFamily: 'Arial', fontSize: 12 }],
                    attrs: {},
                  },
                ],
                attrs: {
                  padding: customPadding,
                },
              },
            ],
          },
        ],
        columnWidths: [200],
      };

      const measure = await measureBlock(block, { maxWidth: 600 });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      const cellMeasure = measure.rows[0].cells[0];
      const para1Height = cellMeasure.blocks[0].totalHeight;
      const para2Height = cellMeasure.blocks[1].totalHeight;
      const totalContentHeight = para1Height + para2Height;
      const expectedHeight = totalContentHeight + customPadding.top + customPadding.bottom;

      expect(cellMeasure.height).toBe(expectedHeight);
    });

    it('handles cells with both blocks and paragraph fields (prefers blocks)', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'both-fields-table',
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-in-blocks',
                    runs: [{ text: 'From blocks array', fontFamily: 'Arial', fontSize: 12 }],
                    attrs: {},
                  },
                ],
                paragraph: {
                  kind: 'paragraph',
                  id: 'para-legacy',
                  runs: [{ text: 'From paragraph field', fontFamily: 'Arial', fontSize: 12 }],
                  attrs: {},
                },
              },
            ],
          },
        ],
        columnWidths: [200],
      };

      const measure = await measureBlock(block, { maxWidth: 600 });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      const cellMeasure = measure.rows[0].cells[0];

      // Should use blocks array (not paragraph field)
      expect(cellMeasure.blocks).toHaveLength(1);
      expect((cellMeasure.blocks[0] as any).lines?.[0]).toBeDefined();
    });
  });

  describe('autofit tables with colspan should not truncate grid columns', () => {
    const makeCell = (id: string) => ({
      id,
      blocks: [
        {
          kind: 'paragraph' as const,
          id: `para-${id}`,
          runs: [{ text: 'Text', fontFamily: 'Arial', fontSize: 12 }],
        },
      ],
    });

    it('preserves all 4 grid columns when max physical cells is 3 but colspans sum to 4', async () => {
      // Reproduces SD-1797: table with 4-column grid where no row has 4 physical cells.
      // Row patterns: 2 cells (span 3+1), 3 cells (span 1+2+1)
      // maxCellCount must be 4 (from colspan sums), not 3 (from physical cell count)
      const block: FlowBlock = {
        kind: 'table',
        id: 'autofit-colspan-table',
        rows: [
          {
            id: 'row-0',
            cells: [
              { ...makeCell('c-0-0'), colSpan: 3 },
              { ...makeCell('c-0-1'), colSpan: 1 },
            ],
          },
          {
            id: 'row-1',
            cells: [
              { ...makeCell('c-1-0'), colSpan: 1 },
              { ...makeCell('c-1-1'), colSpan: 2 },
              { ...makeCell('c-1-2'), colSpan: 1 },
            ],
          },
        ],
        columnWidths: [172, 13, 128, 310], // 4 grid columns from w:tblGrid
      };

      const measure = await measureBlock(block, { maxWidth: 800 });
      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      // All 4 logical columns must survive normalization and runtime AutoFit.
      expect(measure.columnWidths).toHaveLength(4);
      expect(measure.columnWidths[0]).toBeGreaterThan(0);
      expect(measure.columnWidths[1]).toBeGreaterThan(0);
      expect(measure.columnWidths[2]).toBeGreaterThan(0);
      expect(measure.columnWidths[3]).toBeGreaterThan(measure.columnWidths[2]);
      expect(measure.totalWidth).toBe(measure.columnWidths.reduce((sum, width) => sum + width, 0));

      // Row 0: 2 cells spanning 3+1 = both cells measured
      expect(measure.rows[0].cells).toHaveLength(2);

      // Row 1: 3 cells spanning 1+2+1 = all 3 cells measured
      expect(measure.rows[1].cells).toHaveLength(3);
    });

    it('does not drop rightmost cell when colspan exhausts truncated grid', async () => {
      // 4-column grid, rows with span patterns [2,2] and [3,1]
      // Without the fix, grid gets truncated to 2 columns (max physical cells = 2),
      // and the second cell in span [3,1] rows is dropped
      const block: FlowBlock = {
        kind: 'table',
        id: 'autofit-colspan-table-2',
        rows: [
          {
            id: 'row-0',
            cells: [
              { ...makeCell('c-0-0'), colSpan: 2 },
              { ...makeCell('c-0-1'), colSpan: 2 },
            ],
          },
          {
            id: 'row-1',
            cells: [
              { ...makeCell('c-1-0'), colSpan: 3 },
              { ...makeCell('c-1-1'), colSpan: 1 },
            ],
          },
        ],
        columnWidths: [100, 50, 100, 300], // 4 grid columns
      };

      const measure = await measureBlock(block, { maxWidth: 800 });
      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      // Grid should not be truncated
      expect(measure.columnWidths).toHaveLength(4);

      // Both cells in each row must be present
      expect(measure.rows[0].cells).toHaveLength(2);
      expect(measure.rows[1].cells).toHaveLength(2);

      // Cell widths should still be derived from the preserved logical runtime
      // columns, even though AutoFit may rebalance the final vector.
      expect(measure.rows[0].cells[0].width).toBeCloseTo(measure.columnWidths[0] + measure.columnWidths[1], 3);
      expect(measure.rows[0].cells[1].width).toBeCloseTo(measure.columnWidths[2] + measure.columnWidths[3], 3);
      expect(measure.rows[1].cells[0].width).toBeCloseTo(
        measure.columnWidths[0] + measure.columnWidths[1] + measure.columnWidths[2],
        3,
      );
      expect(measure.rows[1].cells[1].width).toBeCloseTo(measure.columnWidths[3], 3);
    });

    it('handles single-cell full-span row correctly', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'autofit-fullspan-table',
        rows: [
          {
            id: 'row-0',
            cells: [{ ...makeCell('c-0-0'), colSpan: 4 }],
          },
          {
            id: 'row-1',
            cells: [
              { ...makeCell('c-1-0'), colSpan: 1 },
              { ...makeCell('c-1-1'), colSpan: 2 },
              { ...makeCell('c-1-2'), colSpan: 1 },
            ],
          },
        ],
        columnWidths: [100, 50, 100, 300],
      };

      const measure = await measureBlock(block, { maxWidth: 800 });
      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      expect(measure.columnWidths).toHaveLength(4);

      // Full-span row: 1 cell spanning all 4 columns (auto-layout preserves widths)
      expect(measure.rows[0].cells).toHaveLength(1);
      expect(measure.rows[0].cells[0].width).toBe(550); // 100+50+100+300

      // 3-cell row: all cells present
      expect(measure.rows[1].cells).toHaveLength(3);
    });
  });

  describe('scaleColumnWidths behavior', () => {
    it('scales column widths proportionally when exceeding target', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'scale-test-1',
        attrs: {
          tableWidth: { value: 5000, type: 'pct' },
        },
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'A', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
              {
                id: 'cell-0-1',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-1',
                    runs: [{ text: 'B', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
              {
                id: 'cell-0-2',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-2',
                    runs: [{ text: 'C', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [100, 200, 100], // Total 400px, ratio 1:2:1
      };

      const measure = await measureBlock(block, { maxWidth: 300 });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      // Percentage width should scale from 400px to 300px maintaining 1:2:1 ratio
      // 100 * (300/400) = 75, 200 * (300/400) = 150
      expect(measure.columnWidths.reduce((sum, width) => sum + width, 0)).toBe(300);
      expect(Math.abs(measure.columnWidths[0] - measure.columnWidths[2])).toBeLessThanOrEqual(2);
      expect(measure.columnWidths[1]).toBeGreaterThan(measure.columnWidths[0]);
      expect(measure.totalWidth).toBe(300);
    });

    it('does not scale when widths are within target', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'scale-test-2',
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'A', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
              {
                id: 'cell-0-1',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-1',
                    runs: [{ text: 'B', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [50, 50], // Total 100px
      };

      const measure = await measureBlock(block, { maxWidth: 200 });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      // Auto layout preserves explicit widths (no scale-up)
      expect(measure.columnWidths).toEqual([50, 50]);
      expect(measure.totalWidth).toBe(100);
    });

    it('produces exact sum after rounding adjustment', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'scale-test-3',
        attrs: {
          tableWidth: { value: 5000, type: 'pct' },
        },
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'A', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
              {
                id: 'cell-0-1',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-1',
                    runs: [{ text: 'B', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
              {
                id: 'cell-0-2',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-2',
                    runs: [{ text: 'C', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [34, 33, 34], // Total 101px - exceeds target to trigger scaling
      };

      const measure = await measureBlock(block, { maxWidth: 100 });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      // Sum should be exactly 100 after rounding adjustment
      const sum = measure.columnWidths.reduce((a, b) => a + b, 0);
      expect(sum).toBe(100);
      expect(measure.totalWidth).toBe(100);
    });

    it('handles empty array gracefully', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'scale-test-4',
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'A', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [], // Empty array
      };

      const measure = await measureBlock(block, { maxWidth: 200 });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      expect(measure.columnWidths).toHaveLength(1);
      expect(measure.columnWidths[0]).toBeGreaterThan(0);
    });

    it('enforces minimum width of 1px per column', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'scale-test-5',
        attrs: {
          tableWidth: { value: 5000, type: 'pct' },
        },
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'A', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
              {
                id: 'cell-0-1',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-1',
                    runs: [{ text: 'B', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
              {
                id: 'cell-0-2',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-2',
                    runs: [{ text: 'C', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
              {
                id: 'cell-0-3',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-3',
                    runs: [{ text: 'D', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [1000, 1000, 1000, 1000], // Very wide, will scale down dramatically
      };

      const measure = await measureBlock(block, { maxWidth: 10 });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      // Each column should be at least 1px
      measure.columnWidths.forEach((width) => {
        expect(width).toBeGreaterThanOrEqual(1);
      });
      expect(measure.totalWidth).toBeGreaterThan(0);
    });
  });

  describe('WIDTH_FUDGE_PX tolerance behavior', () => {
    it('allows text to fit within 0.5px tolerance without breaking line', async () => {
      // Create a simple test with a single word to verify tolerance behavior
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'fudge-test-1',
        runs: [
          {
            text: 'Word',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      // Measure first to get actual width
      const initialMeasure = expectParagraphMeasure(await measureBlock(block, 1000));
      const textWidth = initialMeasure.lines[0].width;

      // Now measure with maxWidth equal to text width
      // The WIDTH_FUDGE_PX tolerance should allow it to still fit
      const constrainedMeasure = expectParagraphMeasure(await measureBlock(block, textWidth));

      expect(constrainedMeasure.lines).toHaveLength(1);
      expect(constrainedMeasure.lines[0].width).toBeCloseTo(textWidth, 1);
    });

    it('breaks line when width exceeds tolerance', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'fudge-test-2',
        runs: [
          {
            text: 'Word1 Word2 Word3',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      // Measure to get the width of "Word1 "
      const word1Block: FlowBlock = {
        kind: 'paragraph',
        id: 'word1-measure',
        runs: [
          {
            text: 'Word1 ',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      const word1Measure = expectParagraphMeasure(await measureBlock(word1Block, 1000));
      const word1Width = word1Measure.lines[0].width;

      // Set maxWidth to word1Width + small amount that's still less than adding Word2
      // This should force "Word2 Word3" to wrap to next line
      const tightMeasure = expectParagraphMeasure(await measureBlock(block, word1Width + 5));

      // Should break into multiple lines
      expect(tightMeasure.lines.length).toBeGreaterThan(1);
    });

    it('prevents premature line breaks with floating-point measurement variations', async () => {
      // Test that the tolerance absorbs minor measurement differences
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'fudge-test-3',
        runs: [
          {
            text: 'A',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      // Measure the single character
      const charMeasure = expectParagraphMeasure(await measureBlock(block, 1000));
      const charWidth = charMeasure.lines[0].width;

      // Set maxWidth to exactly the measured width
      // Without WIDTH_FUDGE_PX, floating-point rounding could cause unwanted breaks
      const exactMeasure = expectParagraphMeasure(await measureBlock(block, charWidth));

      // Should still fit on one line
      expect(exactMeasure.lines).toHaveLength(1);
    });

    it('applies tolerance consistently for word boundaries', async () => {
      // Test demonstrates that WIDTH_FUDGE_PX prevents unnecessary line breaks
      // when measured width is very close to maxWidth
      const singleWordBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'fudge-test-4a',
        runs: [
          {
            text: 'LongWordHere',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      // Measure a single long word
      const wordMeasure = expectParagraphMeasure(await measureBlock(singleWordBlock, 1000));
      const wordWidth = wordMeasure.lines[0].width;

      // Set maxWidth to exactly the word width
      // The WIDTH_FUDGE_PX tolerance allows it to fit without forcing a break
      const exactFitMeasure = expectParagraphMeasure(await measureBlock(singleWordBlock, wordWidth));
      expect(exactFitMeasure.lines).toHaveLength(1);

      // Now create a two-word scenario where first word + space fits
      const twoWordBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'fudge-test-4b',
        runs: [
          {
            text: 'Word1 Word2',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      // Measure just "Word1 " to know where the break should occur
      const firstWordBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'fudge-test-4c',
        runs: [
          {
            text: 'Word1 ',
            fontFamily: 'Arial',
            fontSize: 16,
          },
        ],
        attrs: {},
      };

      const firstWordMeasure = expectParagraphMeasure(await measureBlock(firstWordBlock, 1000));
      const firstWordWidth = firstWordMeasure.lines[0].width;

      // Set maxWidth to just after first word - should force second word to new line
      const breakMeasure = expectParagraphMeasure(await measureBlock(twoWordBlock, firstWordWidth + 2));
      expect(breakMeasure.lines.length).toBeGreaterThan(1);
    });

    it('accepts sub-pixel run-boundary rounding on a mixed-format non-justified line', async () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'mixed-run-fudge',
        runs: [
          { text: 'DELIVERABLES:', fontFamily: 'Aptos', fontSize: 13.333, bold: true },
          { text: ' ', fontFamily: 'Aptos', fontSize: 13.333, bold: true },
          { text: 'Consultant services', fontFamily: 'Aptos', fontSize: 13.333 },
        ],
        attrs: {},
      };

      const unconstrained = expectParagraphMeasure(await measureBlock(block, 1000));
      expect(unconstrained.lines).toHaveLength(1);

      const withinWordRunRounding = expectParagraphMeasure(
        await measureBlock(block, unconstrained.lines[0].width - 0.25),
      );

      expect(withinWordRunRounding.lines).toHaveLength(1);
    });
  });

  describe('table width semantics (SD-1239, SD-4458)', () => {
    it('scales column widths to 100% of available width when tableWidth type is pct with value 5000', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'pct-table-100',
        attrs: {
          tableWidth: { value: 5000, type: 'pct' }, // 5000 = 100%
        },
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'A', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
              {
                id: 'cell-0-1',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-1',
                    runs: [{ text: 'B', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [100, 100], // Original: 200px total
      };

      const measure = await measureBlock(block, { maxWidth: 600 });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      // With 100% width (5000), should scale to full 600px available width
      // Original 200px → 600px means 3x scale: 100 * 3 = 300 each
      expect(measure.totalWidth).toBe(600);
      expect(measure.columnWidths[0]).toBe(300);
      expect(measure.columnWidths[1]).toBe(300);
    });

    it('preserves explicit widths wider than the content column', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'explicit-wide-table',
        attrs: {
          tableWidth: { width: 700, type: 'px' },
        },
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'A', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
              {
                id: 'cell-0-1',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-1',
                    runs: [{ text: 'B', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [200, 200],
      };

      const measure = await measureBlock(block, { maxWidth: 500 });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      expect(measure.totalWidth).toBe(700);
      expect(measure.columnWidths[0]).toBe(350);
      expect(measure.columnWidths[1]).toBe(350);
    });

    it('scales column widths to 50% of available width when tableWidth type is pct with value 2500', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'pct-table-50',
        attrs: {
          tableWidth: { value: 2500, type: 'pct' }, // 2500 = 50%
        },
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'A', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
              {
                id: 'cell-0-1',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-1',
                    runs: [{ text: 'B', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [100, 100], // Original: 200px total
      };

      const measure = await measureBlock(block, { maxWidth: 600 });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      // With 50% width (2500), should scale to 300px (half of 600px available)
      // Original 200px → 300px means 1.5x scale: 100 * 1.5 = 150 each
      expect(measure.totalWidth).toBe(300);
      expect(measure.columnWidths[0]).toBe(150);
      expect(measure.columnWidths[1]).toBe(150);
    });

    it('constrains an explicit tblW auto grid to the content column', async () => {
      const measure = await measureBlock(createOverwideGridTable({ tableWidth: { value: 0, type: 'auto' } }), {
        maxWidth: 500,
      });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      expect(measure.totalWidth).toBe(500);
      expect(measure.columnWidths).toEqual([250, 250]);
    });

    it('preserves an intentionally overwide imported grid when tblW is omitted', async () => {
      const measure = await measureBlock(createOverwideGridTable(), { maxWidth: 500 });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      expect(measure.totalWidth).toBe(640);
      expect(measure.columnWidths).toEqual([320, 320]);
    });

    it('preserves fixed-layout grid widths wider than the column when tableWidth is absent', async () => {
      // Quiet behavior pinned: with `tableLayout: 'fixed'` and no `tableWidth` attr,
      // the imported grid widths pass through even when they exceed the available column.
      // Previously, the measure would have scaled them down to fit `maxWidth`.
      const block: FlowBlock = {
        kind: 'table',
        id: 'fixed-no-width',
        attrs: {
          tableLayout: 'fixed',
        },
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'A', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
              {
                id: 'cell-0-1',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-1',
                    runs: [{ text: 'B', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [400, 400],
      };

      const measure = await measureBlock(block, { maxWidth: 500 });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      expect(measure.totalWidth).toBe(800);
      expect(measure.columnWidths).toEqual([400, 400]);
    });

    it('handles percentage width with width property instead of value', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'pct-table-width-prop',
        attrs: {
          tableWidth: { width: 2500, type: 'pct' }, // Using width property
        },
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'A', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [100], // Original: 100px
      };

      const measure = await measureBlock(block, { maxWidth: 400 });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      // With 50% width, should scale to 200px (half of 400px)
      expect(measure.totalWidth).toBe(200);
      expect(measure.columnWidths[0]).toBe(200);
    });

    it('caps percentage width at maxWidth when percentage exceeds available space', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'pct-table-capped',
        attrs: {
          tableWidth: { value: 5000, type: 'pct' }, // 100%
        },
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'A', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [800], // Original: 800px, already > maxWidth
      };

      const measure = await measureBlock(block, { maxWidth: 400 });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      // Even at 100%, should not exceed maxWidth of 400px
      expect(measure.totalWidth).toBe(400);
    });

    it('maintains column width ratios when scaling to percentage width', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'pct-table-ratios',
        attrs: {
          tableWidth: { value: 5000, type: 'pct' }, // 100%
        },
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'A', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
              {
                id: 'cell-0-1',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-1',
                    runs: [{ text: 'B', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
              {
                id: 'cell-0-2',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-2',
                    runs: [{ text: 'C', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [50, 100, 50], // 1:2:1 ratio, 200px total
      };

      const measure = await measureBlock(block, { maxWidth: 400 });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      // AutoFit honors the preferred table width target, but the final runtime
      // vector may rebalance away from the authored 1:2:1 ratio.
      expect(measure.totalWidth).toBe(400);
      expect(measure.columnWidths).toHaveLength(3);
      expect(measure.columnWidths[0]).toBeGreaterThan(0);
      expect(measure.columnWidths[1]).toBeGreaterThan(measure.columnWidths[0]);
      expect(measure.columnWidths[1]).toBeGreaterThan(measure.columnWidths[2]);
      expect(measure.columnWidths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(400, 3);
    });

    it('handles explicit pixel width (type: px)', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'px-table',
        attrs: {
          tableWidth: { width: 300, type: 'px' },
        },
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'A', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
              {
                id: 'cell-0-1',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-1',
                    runs: [{ text: 'B', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [100, 100], // Original: 200px
      };

      const measure = await measureBlock(block, { maxWidth: 600 });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      // Explicit 300px width should scale columns from 200px to 300px
      expect(measure.totalWidth).toBe(300);
      expect(measure.columnWidths[0]).toBe(150);
      expect(measure.columnWidths[1]).toBe(150);
    });

    it('ignores zero percentage value', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'pct-table-zero',
        attrs: {
          tableWidth: { value: 0, type: 'pct' }, // 0 = invalid
        },
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'A', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [100],
      };

      const measure = await measureBlock(block, { maxWidth: 600 });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      // Zero percentage is invalid - auto layout preserves column widths
      expect(measure.totalWidth).toBe(100);
      expect(measure.columnWidths[0]).toBe(100);
    });

    it('ignores negative percentage value', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'pct-table-negative',
        attrs: {
          tableWidth: { value: -2500, type: 'pct' }, // Negative = invalid
        },
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'A', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [150],
      };

      const measure = await measureBlock(block, { maxWidth: 600 });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      // Negative percentage is invalid - auto layout preserves column widths
      expect(measure.totalWidth).toBe(150);
      expect(measure.columnWidths[0]).toBe(150);
    });

    it('ignores NaN percentage value', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'pct-table-nan',
        attrs: {
          tableWidth: { value: NaN, type: 'pct' }, // NaN = invalid
        },
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'A', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [200],
      };

      const measure = await measureBlock(block, { maxWidth: 600 });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      // NaN is invalid - auto layout preserves column widths
      expect(measure.totalWidth).toBe(200);
      expect(measure.columnWidths[0]).toBe(200);
    });

    it('ignores Infinity percentage value', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'pct-table-infinity',
        attrs: {
          tableWidth: { value: Infinity, type: 'pct' }, // Infinity = invalid
        },
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'A', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [175],
      };

      const measure = await measureBlock(block, { maxWidth: 600 });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      // Infinity is invalid - auto layout preserves column widths
      expect(measure.totalWidth).toBe(175);
      expect(measure.columnWidths[0]).toBe(175);
    });

    it('ignores tableWidth with missing both width and value properties', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'pct-table-missing-props',
        attrs: {
          tableWidth: { type: 'pct' }, // Missing value/width = invalid
        },
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'A', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [120],
      };

      const measure = await measureBlock(block, { maxWidth: 600 });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      // Missing value is invalid - auto layout preserves column widths
      expect(measure.totalWidth).toBe(120);
      expect(measure.columnWidths[0]).toBe(120);
    });

    it('ignores tableWidth when type is pixel with invalid value', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'px-table-nan',
        attrs: {
          tableWidth: { width: NaN, type: 'pixel' }, // NaN pixel width = invalid
        },
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'A', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [130],
      };

      const measure = await measureBlock(block, { maxWidth: 600 });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      // NaN pixel width is invalid - auto layout preserves column widths
      expect(measure.totalWidth).toBe(130);
      expect(measure.columnWidths[0]).toBe(130);
    });

    it('handles missing tableWidth property entirely', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'table-no-width',
        attrs: {}, // No tableWidth property at all
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'A', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [140],
      };

      const measure = await measureBlock(block, { maxWidth: 600 });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      // No tableWidth - auto layout preserves column widths
      expect(measure.totalWidth).toBe(140);
      expect(measure.columnWidths[0]).toBe(140);
    });

    it('does NOT scale up column widths for fixed layout tables with explicit width', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'fixed-layout-no-scale-up',
        attrs: {
          tableLayout: 'fixed',
          tableWidth: { width: 600, type: 'px' }, // Explicit 600px width
        },
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'A', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
              {
                id: 'cell-0-1',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-1',
                    runs: [{ text: 'B', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [100, 100], // Original: 200px total, explicit width is 600px
      };

      const measure = await measureBlock(block, { maxWidth: 800 });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      // Fixed layout now uses the shared fixed baseline and does not scale up to
      // an explicit table width unless row/cell requests force a larger total.
      expect(measure.totalWidth).toBe(200);
      expect(measure.columnWidths[0]).toBe(100);
      expect(measure.columnWidths[1]).toBe(100);
    });

    it('scales DOWN column widths for fixed layout tables when exceeding target width', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'fixed-layout-scale-down',
        attrs: {
          tableLayout: 'fixed',
          tableWidth: { width: 300, type: 'px' }, // Explicit 300px width
        },
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'A', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
              {
                id: 'cell-0-1',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-1',
                    runs: [{ text: 'B', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [300, 300], // Original: 600px total, exceeds explicit width of 300px
      };

      const measure = await measureBlock(block, { maxWidth: 800 });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      // Fixed layout SHOULD scale down when columns exceed the explicit width
      expect(measure.totalWidth).toBe(300);
      expect(measure.columnWidths[0]).toBe(150);
      expect(measure.columnWidths[1]).toBe(150);
    });

    it('scales up column widths for auto layout tables with explicit pixel width', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'auto-layout-scale-up',
        attrs: {
          // No tableLayout means auto layout
          tableWidth: { width: 400, type: 'px' }, // Explicit 400px width
        },
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'A', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
              {
                id: 'cell-0-1',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-1',
                    runs: [{ text: 'B', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [100, 100], // Original: 200px total
      };

      const measure = await measureBlock(block, { maxWidth: 800 });

      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      // Auto layout with explicit width SHOULD scale up to fill the explicit width
      expect(measure.totalWidth).toBe(400);
      expect(measure.columnWidths[0]).toBe(200);
      expect(measure.columnWidths[1]).toBe(200);
    });
  });

  describe('table cell measurement with spacing.after', () => {
    it('should add spacing.after to content height for non-last paragraphs', async () => {
      const table: FlowBlock = {
        kind: 'table',
        id: 'table-spacing',
        attrs: {},
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                attrs: {},
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'First paragraph', fontFamily: 'Arial', fontSize: 16 }],
                    attrs: { spacing: { after: 10 } },
                  },
                  {
                    kind: 'paragraph',
                    id: 'para-1',
                    runs: [{ text: 'Last paragraph', fontFamily: 'Arial', fontSize: 16 }],
                    attrs: { spacing: { after: 20 } },
                  },
                ],
              },
            ],
          },
        ],
      };

      const measure = await measureBlock(table, 1000);
      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      const cellMeasure = measure.rows[0].cells[0];
      const block0Measure = cellMeasure.blocks[0];
      const block1Measure = cellMeasure.blocks[1];

      // Content height should include first paragraph's spacing.after.
      // The last paragraph contributes max(0, spacing.after - paddingBottom).
      // With default paddingBottom=0 in this fixture, the full last spacing is included.
      // First paragraph: height + 10px spacing
      // Last paragraph: height + 20px spacing
      expect(block0Measure.kind).toBe('paragraph');
      expect(block1Measure.kind).toBe('paragraph');

      const para0Height = block0Measure.kind === 'paragraph' ? block0Measure.totalHeight : 0;
      const para1Height = block1Measure.kind === 'paragraph' ? block1Measure.totalHeight : 0;

      // Cell height includes: para0Height + 10 + para1Height + 20
      const expectedCellHeight = para0Height + 10 + para1Height + 20;
      expect(cellMeasure.height).toBe(expectedCellHeight);
    });

    it('should only add spacing when greater than 0', async () => {
      const table: FlowBlock = {
        kind: 'table',
        id: 'table-zero-spacing',
        attrs: {},
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                attrs: {},
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'Zero spacing', fontFamily: 'Arial', fontSize: 16 }],
                    attrs: { spacing: { after: 0 } },
                  },
                  {
                    kind: 'paragraph',
                    id: 'para-1',
                    runs: [{ text: 'Negative spacing', fontFamily: 'Arial', fontSize: 16 }],
                    attrs: { spacing: { after: -5 } },
                  },
                  {
                    kind: 'paragraph',
                    id: 'para-2',
                    runs: [{ text: 'Positive spacing', fontFamily: 'Arial', fontSize: 16 }],
                    attrs: { spacing: { after: 15 } },
                  },
                ],
              },
            ],
          },
        ],
      };

      const measure = await measureBlock(table, 1000);
      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      const cellMeasure = measure.rows[0].cells[0];
      const block0 = cellMeasure.blocks[0];
      const block1 = cellMeasure.blocks[1];
      const block2 = cellMeasure.blocks[2];

      const para0Height = block0.kind === 'paragraph' ? block0.totalHeight : 0;
      const para1Height = block1.kind === 'paragraph' ? block1.totalHeight : 0;
      const para2Height = block2.kind === 'paragraph' ? block2.totalHeight : 0;

      // Only positive spacing should be added.
      // Zero and negative spacing should not be added.
      // para-2 is the last paragraph, so it contributes max(0, 15 - paddingBottom).
      // paddingBottom is 0 in this fixture, so +15 is included.
      // Cell height = para0 + para1 + para2 + 15
      const expectedCellHeight = para0Height + para1Height + para2Height + 15;
      expect(cellMeasure.height).toBe(expectedCellHeight);
    });

    it('should handle cells without spacing.after', async () => {
      const table: FlowBlock = {
        kind: 'table',
        id: 'table-no-spacing',
        attrs: {},
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                attrs: {},
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'No spacing', fontFamily: 'Arial', fontSize: 16 }],
                    attrs: {},
                  },
                ],
              },
            ],
          },
        ],
      };

      const measure = await measureBlock(table, 1000);
      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      const cellMeasure = measure.rows[0].cells[0];
      const block0 = cellMeasure.blocks[0];

      const paraHeight = block0.kind === 'paragraph' ? block0.totalHeight : 0;

      // Cell height should just be paragraph height (no spacing.after)
      const expectedCellHeight = paraHeight;
      expect(cellMeasure.height).toBe(expectedCellHeight);
    });

    it('should not include anchored images in table cell height', async () => {
      const table: FlowBlock = {
        kind: 'table',
        id: 'table-anchored-image',
        attrs: {},
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                attrs: {},
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'Anchor', fontFamily: 'Arial', fontSize: 16 }],
                  },
                  {
                    kind: 'image',
                    id: 'img-0',
                    src: 'data:image/png;base64,AAA',
                    anchor: { isAnchored: true, vRelativeFrom: 'paragraph', offsetV: 5 },
                    wrap: { type: 'None' },
                    attrs: { anchorParagraphId: 'para-0' },
                  },
                ],
              },
            ],
          },
        ],
      };

      const measure = await measureBlock(table, 1000);
      expect(measure.kind).toBe('table');
      const cellMeasure = measure.rows[0].cells[0];
      const paraMeasure = cellMeasure.blocks[0];

      expect(paraMeasure.kind).toBe('paragraph');
      const paraHeight = paraMeasure.kind === 'paragraph' ? paraMeasure.totalHeight : 0;

      // Anchored image is out-of-flow: it should not increase cell height.
      const expectedCellHeight = paraHeight;
      expect(cellMeasure.height).toBe(expectedCellHeight);
    });

    it('expands a table cell for an anchored object with layoutInCell enabled', async () => {
      const table: FlowBlock = {
        kind: 'table',
        id: 'table-layout-in-cell-image',
        attrs: {},
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                attrs: {},
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'Anchor', fontFamily: 'Arial', fontSize: 16 }],
                  },
                  {
                    kind: 'image',
                    id: 'img-0',
                    src: 'data:image/png;base64,AAA',
                    width: 20,
                    height: 40,
                    anchor: { isAnchored: true, layoutInCell: true, vRelativeFrom: 'paragraph', offsetV: 5 },
                    wrap: { type: 'None', distTop: 3, distBottom: 4 },
                    attrs: { anchorParagraphId: 'para-0' },
                  },
                ],
              },
            ],
          },
        ],
      };

      const measure = await measureBlock(table, 1000);
      expect(measure.kind).toBe('table');
      const cellMeasure = measure.rows[0].cells[0];
      expect(cellMeasure.height).toBe(5 + 40 + 3 + 4);
    });

    it('should handle type safety for spacing.after', async () => {
      const table: FlowBlock = {
        kind: 'table',
        id: 'table-type-safety',
        attrs: {},
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                attrs: {},
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'Valid number', fontFamily: 'Arial', fontSize: 16 }],
                    attrs: { spacing: { after: 10 } },
                  },
                  {
                    kind: 'paragraph',
                    id: 'para-1',
                    runs: [{ text: 'Invalid string', fontFamily: 'Arial', fontSize: 16 }],
                    attrs: { spacing: { after: '10' as unknown as number } },
                  },
                  {
                    kind: 'paragraph',
                    id: 'para-2',
                    runs: [{ text: 'Undefined', fontFamily: 'Arial', fontSize: 16 }],
                    attrs: { spacing: { after: undefined } },
                  },
                ],
              },
            ],
          },
        ],
      };

      const measure = await measureBlock(table, 1000);
      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      const cellMeasure = measure.rows[0].cells[0];
      const block0 = cellMeasure.blocks[0];
      const block1 = cellMeasure.blocks[1];
      const block2 = cellMeasure.blocks[2];

      const para0Height = block0.kind === 'paragraph' ? block0.totalHeight : 0;
      const para1Height = block1.kind === 'paragraph' ? block1.totalHeight : 0;
      const para2Height = block2.kind === 'paragraph' ? block2.totalHeight : 0;

      // Only the valid number should add spacing
      // Cell height = para0 + 10 (valid spacing) + para1 + para2
      const expectedCellHeight = para0Height + 10 + para1Height + para2Height;
      expect(cellMeasure.height).toBe(expectedCellHeight);
    });

    it('should handle mixed block types with spacing', async () => {
      const table: FlowBlock = {
        kind: 'table',
        id: 'table-mixed-blocks',
        attrs: {},
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                attrs: {},
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'Paragraph with spacing', fontFamily: 'Arial', fontSize: 16 }],
                    attrs: { spacing: { after: 10 } },
                  },
                  {
                    kind: 'image',
                    id: 'img-0',
                    src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
                    width: 100,
                    height: 100,
                  },
                  {
                    kind: 'paragraph',
                    id: 'para-1',
                    runs: [{ text: 'Another paragraph', fontFamily: 'Arial', fontSize: 16 }],
                    attrs: { spacing: { after: 5 } },
                  },
                ],
              },
            ],
          },
        ],
      };

      const measure = await measureBlock(table, 1000);
      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      const cellMeasure = measure.rows[0].cells[0];

      // Should handle mixed block types correctly
      // Non-last paragraphs should have spacing.after applied, image should not
      // Last paragraph contributes max(0, spacing.after - paddingBottom).
      // paddingBottom is 0 in this fixture.
      expect(cellMeasure.blocks).toHaveLength(3);
      expect(cellMeasure.blocks[0].kind).toBe('paragraph');
      expect(cellMeasure.blocks[1].kind).toBe('image');
      expect(cellMeasure.blocks[2].kind).toBe('paragraph');

      const block0 = cellMeasure.blocks[0];
      const block1 = cellMeasure.blocks[1];
      const block2 = cellMeasure.blocks[2];

      const para0Height = block0.kind === 'paragraph' ? block0.totalHeight : 0;
      const imageHeight = block1.kind === 'image' ? block1.height : 0;
      const para1Height = block2.kind === 'paragraph' ? block2.totalHeight : 0;

      // Cell height = para0 + 10 + image + para1 + 5
      const expectedCellHeight = para0Height + 10 + imageHeight + para1Height + 5;
      expect(cellMeasure.height).toBe(expectedCellHeight);
    });
  });

  describe('table cell measurement with spacing.before', () => {
    it('should add spacing.before to content height for each paragraph', async () => {
      const table: FlowBlock = {
        kind: 'table',
        id: 'table-spacing-before',
        attrs: {},
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                attrs: {},
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'First paragraph', fontFamily: 'Arial', fontSize: 16 }],
                    attrs: { spacing: { before: 10 } },
                  },
                  {
                    kind: 'paragraph',
                    id: 'para-1',
                    runs: [{ text: 'Second paragraph', fontFamily: 'Arial', fontSize: 16 }],
                    attrs: { spacing: { before: 20 } },
                  },
                ],
              },
            ],
          },
        ],
      };

      const measure = await measureBlock(table, 1000);
      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      const cellMeasure = measure.rows[0].cells[0];
      const block0Measure = cellMeasure.blocks[0];
      const block1Measure = cellMeasure.blocks[1];

      expect(block0Measure.kind).toBe('paragraph');
      expect(block1Measure.kind).toBe('paragraph');

      const para0Height = block0Measure.kind === 'paragraph' ? block0Measure.totalHeight : 0;
      const para1Height = block1Measure.kind === 'paragraph' ? block1Measure.totalHeight : 0;

      // Cell height includes: 10 (spacing.before para-0) + para0Height + 20 (spacing.before para-1) + para1Height
      const expectedCellHeight = 10 + para0Height + 20 + para1Height;
      expect(cellMeasure.height).toBe(expectedCellHeight);
    });

    it('should only add positive spacing.before', async () => {
      const table: FlowBlock = {
        kind: 'table',
        id: 'table-spacing-before-zero',
        attrs: {},
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                attrs: {},
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'With before', fontFamily: 'Arial', fontSize: 16 }],
                    attrs: { spacing: { before: 12 } },
                  },
                  {
                    kind: 'paragraph',
                    id: 'para-1',
                    runs: [{ text: 'Zero before', fontFamily: 'Arial', fontSize: 16 }],
                    attrs: { spacing: { before: 0 } },
                  },
                  {
                    kind: 'paragraph',
                    id: 'para-2',
                    runs: [{ text: 'Negative before', fontFamily: 'Arial', fontSize: 16 }],
                    attrs: { spacing: { before: -5 } },
                  },
                ],
              },
            ],
          },
        ],
      };

      const measure = await measureBlock(table, 1000);
      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      const cellMeasure = measure.rows[0].cells[0];
      const block0 = cellMeasure.blocks[0];
      const block1 = cellMeasure.blocks[1];
      const block2 = cellMeasure.blocks[2];

      const para0Height = block0.kind === 'paragraph' ? block0.totalHeight : 0;
      const para1Height = block1.kind === 'paragraph' ? block1.totalHeight : 0;
      const para2Height = block2.kind === 'paragraph' ? block2.totalHeight : 0;

      // Only positive spacing.before (12) is added; 0 and negative are ignored
      const expectedCellHeight = 12 + para0Height + para1Height + para2Height;
      expect(cellMeasure.height).toBe(expectedCellHeight);
    });

    it('should absorb first paragraph spacing.before into cell paddingTop (Word semantics)', async () => {
      // Word absorbs the first paragraph's spacing.before into the cell's top padding,
      // same as last paragraph's spacing.after and paddingBottom. Only the excess is added.
      const paddingTop = 10;
      const paddingBottom = 0;
      const table: FlowBlock = {
        kind: 'table',
        id: 'table-spacing-before-absorbed',
        attrs: {},
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                attrs: { padding: { top: paddingTop, left: 4, right: 4, bottom: paddingBottom } },
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'First in cell', fontFamily: 'Arial', fontSize: 16 }],
                    attrs: { spacing: { before: 10 } }, // same as paddingTop → excess 0
                  },
                  {
                    kind: 'paragraph',
                    id: 'para-1',
                    runs: [{ text: 'Second in cell', fontFamily: 'Arial', fontSize: 16 }],
                    attrs: { spacing: { before: 20 } }, // not first → full 20
                  },
                ],
              },
            ],
          },
        ],
      };

      const measure = await measureBlock(table, 1000);
      expect(measure.kind).toBe('table');
      if (measure.kind !== 'table') throw new Error('expected table measure');

      const cellMeasure = measure.rows[0].cells[0];
      const block0 = cellMeasure.blocks[0];
      const block1 = cellMeasure.blocks[1];

      const para0Height = block0.kind === 'paragraph' ? block0.totalHeight : 0;
      const para1Height = block1.kind === 'paragraph' ? block1.totalHeight : 0;

      // First para: spacing.before 10, paddingTop 10 → excess 0. Second para: full 20.
      // Cell height = paddingTop + 0 + para0Height + 20 + para1Height + paddingBottom
      const expectedCellHeight = paddingTop + 0 + para0Height + 20 + para1Height + paddingBottom;
      expect(cellMeasure.height).toBe(expectedCellHeight);
    });
  });

  describe('table column count with rowspan', () => {
    it('should preserve all grid columns when rows have fewer physical cells due to rowspan', async () => {
      // Simulates PCI table structure: 4 grid columns, but some rows have only 2-3 physical cells
      // because rowspan cells from above occupy grid slots.
      const table: FlowBlock = {
        kind: 'table',
        id: 'table-rowspan-cols',
        attrs: {},
        columnWidths: [170, 15, 130, 310], // 4 grid columns, sum = 625
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                colSpan: 2,
                attrs: {},
                blocks: [{ kind: 'paragraph', id: 'p-0-0', runs: [{ text: 'A', fontFamily: 'Arial', fontSize: 12 }] }],
              },
              {
                id: 'cell-0-1',
                colSpan: 2,
                attrs: {},
                blocks: [{ kind: 'paragraph', id: 'p-0-1', runs: [{ text: 'B', fontFamily: 'Arial', fontSize: 12 }] }],
              },
            ],
          },
          {
            id: 'row-1',
            cells: [
              {
                id: 'cell-1-0',
                colSpan: 1,
                rowSpan: 2,
                attrs: {},
                blocks: [{ kind: 'paragraph', id: 'p-1-0', runs: [{ text: 'C', fontFamily: 'Arial', fontSize: 12 }] }],
              },
              {
                id: 'cell-1-1',
                colSpan: 2,
                attrs: {},
                blocks: [{ kind: 'paragraph', id: 'p-1-1', runs: [{ text: 'D', fontFamily: 'Arial', fontSize: 12 }] }],
              },
              {
                id: 'cell-1-2',
                colSpan: 1,
                attrs: {},
                blocks: [{ kind: 'paragraph', id: 'p-1-2', runs: [{ text: 'E', fontFamily: 'Arial', fontSize: 12 }] }],
              },
            ],
          },
          {
            // Row 2: only 2 physical cells because col 0 is occupied by row-1 rowSpan=2
            id: 'row-2',
            cells: [
              {
                id: 'cell-2-0',
                colSpan: 2,
                attrs: {},
                blocks: [{ kind: 'paragraph', id: 'p-2-0', runs: [{ text: 'F', fontFamily: 'Arial', fontSize: 12 }] }],
              },
              {
                id: 'cell-2-1',
                colSpan: 1,
                attrs: {},
                blocks: [{ kind: 'paragraph', id: 'p-2-1', runs: [{ text: 'G', fontFamily: 'Arial', fontSize: 12 }] }],
              },
            ],
          },
        ],
      };

      const measure = await measureBlock(table, 625);
      expect(measure.kind).toBe('table');
      const tableMeasure = measure as TableMeasure;

      // All 4 grid columns must be preserved (not truncated to 3 based on max physical cell count)
      expect(tableMeasure.columnWidths).toHaveLength(4);
      expect(tableMeasure.columnWidths[0]).toBeGreaterThan(0);
      expect(tableMeasure.columnWidths[1]).toBeGreaterThan(0);
      expect(tableMeasure.columnWidths[2]).toBeGreaterThan(0);
      expect(tableMeasure.columnWidths[3]).toBeGreaterThan(tableMeasure.columnWidths[2]);
      expect(tableMeasure.columnWidths[2]).toBeGreaterThan(tableMeasure.columnWidths[1]);

      // Total width should match page width
      const totalWidth = tableMeasure.columnWidths.reduce((a: number, b: number) => a + b, 0);
      expect(totalWidth).toBe(625);
    });
  });

  describe('AutoFit table layout (ECMA-376 §17.18.87)', () => {
    it('expands columns to fit content when grid widths are smaller than content (IT-679)', async () => {
      // Simulates the placeholder-grid regression: tiny grid widths
      // with a small percentage table width. AutoFit should expand columns to fit content.
      const block: FlowBlock = {
        kind: 'table',
        id: 'autofit-expand',
        attrs: {
          tableWidth: { value: 100, type: 'pct' }, // 100/5000 = 2% → ~12px
        },
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'Role', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
              {
                id: 'cell-0-1',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-1',
                    runs: [{ text: 'Name', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [7, 7], // Tiny placeholder grid widths (~100 twips converted to px)
      };

      const measure = await measureBlock(block, { maxWidth: 624 });

      expect(measure.kind).toBe('table');
      const tableMeasure = measure as TableMeasure;

      // AutoFit should expand columns beyond the tiny grid widths to fit content
      expect(tableMeasure.columnWidths[0]).toBeGreaterThan(7);
      expect(tableMeasure.columnWidths[1]).toBeGreaterThan(7);
      // Total should be much larger than the original 14px
      const total = tableMeasure.columnWidths.reduce((a: number, b: number) => a + b, 0);
      expect(total).toBeGreaterThan(14);
    });

    it('caps table width at page width when content is very wide', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'autofit-cap',
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'VeryLongContentThatExceedsAvailableWidth', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
              {
                id: 'cell-0-1',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-1',
                    runs: [{ text: 'AnotherVeryLongContentStringHere', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [5, 5], // Tiny grid widths
      };

      const measure = await measureBlock(block, { maxWidth: 300 });

      expect(measure.kind).toBe('table');
      const tableMeasure = measure as TableMeasure;

      // Total should equal exactly maxWidth (normalization adjusts last column)
      const total = tableMeasure.columnWidths.reduce((a: number, b: number) => a + b, 0);
      expect(total).toBe(300);
      // But columns should still be expanded beyond their original 5px
      expect(tableMeasure.columnWidths[0]).toBeGreaterThan(5);
      expect(tableMeasure.columnWidths[1]).toBeGreaterThan(5);
    });

    it('does not apply AutoFit to fixed layout tables', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'fixed-no-autofit',
        attrs: {
          tableLayout: 'fixed',
          tableWidth: { width: 200, type: 'px' },
        },
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'WideContent', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
              {
                id: 'cell-0-1',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-1',
                    runs: [{ text: 'MoreWideContent', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [50, 50], // Small grid widths
      };

      const measure = await measureBlock(block, { maxWidth: 600 });

      expect(measure.kind).toBe('table');
      const tableMeasure = measure as TableMeasure;

      // Fixed layout ignores AutoFit content expansion and keeps the fixed-pass
      // baseline because the explicit table width is larger than the authored grid.
      expect(tableMeasure.columnWidths[0]).toBe(50);
      expect(tableMeasure.columnWidths[1]).toBe(50);
      expect(tableMeasure.totalWidth).toBe(100);
    });

    it('honors fixed-layout skipped columns when measuring cell placement', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'fixed-skipped-columns',
        attrs: {
          tableLayout: 'fixed',
        },
        columnWidths: [40, 120],
        rows: [
          {
            id: 'row-0',
            attrs: {
              tableRowProperties: {
                gridBefore: 1,
                wBefore: { value: 600, type: 'dxa' },
              },
            },
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'After skip', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
            ],
          },
        ],
      };

      const measure = await measureBlock(block, { maxWidth: 600 });

      expect(measure.kind).toBe('table');
      const tableMeasure = measure as TableMeasure;

      expect(tableMeasure.columnWidths).toEqual([40, 120]);
      expect(tableMeasure.rows[0].cells[0].gridColumnStart).toBe(1);
      expect(tableMeasure.rows[0].cells[0].width).toBe(120);
    });

    it('preserves proportional column widths when content exceeds page width', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'autofit-proportional',
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [{ text: 'Short', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
              {
                id: 'cell-0-1',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-1',
                    runs: [{ text: 'AVeryMuchLongerPieceOfContent', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [3, 3], // Tiny grid widths
      };

      const measure = await measureBlock(block, { maxWidth: 200 });

      expect(measure.kind).toBe('table');
      const tableMeasure = measure as TableMeasure;

      // The wider content column should get a proportionally larger share
      expect(tableMeasure.columnWidths[1]).toBeGreaterThan(tableMeasure.columnWidths[0]);
    });

    it('runs AutoFit for ordinary non-fixed tables even when grid widths look reasonable', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'autofit-reasonable-grid',
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [
                      {
                        text: 'VeryWideUnbreakableContentThatShouldForceTheColumnToGrowWellPastThePreferredGrid',
                        fontFamily: 'Arial',
                        fontSize: 12,
                      },
                    ],
                  },
                ],
              },
              {
                id: 'cell-0-1',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-1',
                    runs: [{ text: 'Short', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [200, 200],
      };

      const measure = await measureBlock(block, { maxWidth: 600 });

      expect(measure.kind).toBe('table');
      const tableMeasure = measure as TableMeasure;

      expect(tableMeasure.columnWidths[0]).toBeGreaterThan(tableMeasure.columnWidths[1]);
      expect(tableMeasure.columnWidths[0]).toBeGreaterThan(200);
      expect(tableMeasure.totalWidth).toBe(
        tableMeasure.columnWidths.reduce((sum: number, width: number) => sum + width, 0),
      );
    });

    it('treats omitted tblLayout as AutoFit on ordinary equal-grid tables', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'autofit-omitted-layout',
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [
                      {
                        text: 'VIN1234567890123456789012345',
                        fontFamily: 'Arial',
                        fontSize: 12,
                      },
                    ],
                  },
                ],
              },
              {
                id: 'cell-0-1',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-1',
                    runs: [{ text: 'YEAR', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [120, 120],
      };

      const measure = await measureBlock(block, { maxWidth: 500 });

      expect(measure.kind).toBe('table');
      const tableMeasure = measure as TableMeasure;

      expect(tableMeasure.columnWidths[0]).toBeGreaterThan(tableMeasure.columnWidths[1]);
      expect(tableMeasure.totalWidth).toBe(
        tableMeasure.columnWidths.reduce((sum: number, width: number) => sum + width, 0),
      );
    });

    it('treats literal auto tblLayout as AutoFit on ordinary equal-grid tables', async () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'autofit-auto-layout',
        attrs: {
          tableLayout: 'auto',
        },
        rows: [
          {
            id: 'row-0',
            cells: [
              {
                id: 'cell-0-0',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-0',
                    runs: [
                      {
                        text: 'VIN1234567890123456789012345',
                        fontFamily: 'Arial',
                        fontSize: 12,
                      },
                    ],
                  },
                ],
              },
              {
                id: 'cell-0-1',
                blocks: [
                  {
                    kind: 'paragraph',
                    id: 'para-1',
                    runs: [{ text: 'YEAR', fontFamily: 'Arial', fontSize: 12 }],
                  },
                ],
              },
            ],
          },
        ],
        columnWidths: [120, 120],
      };

      const measure = await measureBlock(block, { maxWidth: 500 });

      expect(measure.kind).toBe('table');
      const tableMeasure = measure as TableMeasure;

      expect(tableMeasure.columnWidths[0]).toBeGreaterThan(tableMeasure.columnWidths[1]);
      expect(tableMeasure.totalWidth).toBe(
        tableMeasure.columnWidths.reduce((sum: number, width: number) => sum + width, 0),
      );
    });
  });
});

describe('inline box measurement', () => {
  const box = (from: number, to: number): InlineBoxSpan => ({
    id: 'citation',
    from,
    to,
    layout: {
      paddingInlineStart: 6,
      paddingInlineEnd: 8,
      paddingBlockStart: 3,
      paddingBlockEnd: 5,
      gapBefore: 2,
      gapAfter: 4,
      borderWidth: 1,
    },
    appearance: { backgroundColor: '#fff2a8', borderStyle: 'solid' },
  });

  const boxedParagraph = (): FlowBlock => ({
    kind: 'paragraph',
    id: 'boxed-paragraph',
    runs: [{ text: 'alpha beta', fontFamily: 'Arial', fontSize: 16 }],
    inlineBoxes: [box(6, 10)],
  });

  it('keeps an exact fit and wraps when the measured box is one pixel over', async () => {
    let exactWidth = 0;
    for (let width = 20; width <= 300; width += 1) {
      const candidate = expectParagraphMeasure(await measureBlock(boxedParagraph(), width));
      if (candidate.lines.length === 1) {
        exactWidth = width;
        break;
      }
    }
    expect(exactWidth).toBeGreaterThan(0);

    const exact = expectParagraphMeasure(await measureBlock(boxedParagraph(), exactWidth));
    const onePixelOver = expectParagraphMeasure(await measureBlock(boxedParagraph(), exactWidth - 1));

    expect(exact.lines).toHaveLength(1);
    expect(exact.lines[0]!.width).toBeLessThanOrEqual(exactWidth);
    expect(onePixelOver.lines.length).toBeGreaterThan(1);
    expect(onePixelOver.lines.every((line) => line.width <= exactWidth - 1)).toBe(true);
  });

  it('releases a line edge budget when the box moves to the next line', async () => {
    const prefix = 'alpha beta cc ';
    const text = `${prefix}x`;
    const block: FlowBlock = {
      kind: 'paragraph',
      id: 'moved-box-budget',
      runs: [{ text, fontFamily: 'Arial', fontSize: 16 }],
      inlineBoxes: [
        {
          ...box(prefix.length, text.length),
          layout: {
            ...box(prefix.length, text.length).layout,
            paddingInlineStart: 24,
            paddingInlineEnd: 24,
          },
        },
      ],
    };
    const prefixBlock: FlowBlock = {
      ...block,
      id: 'moved-box-budget-prefix',
      runs: [{ text: prefix, fontFamily: 'Arial', fontSize: 16 }],
      inlineBoxes: undefined,
    };
    const plainBlock: FlowBlock = { ...block, id: 'moved-box-budget-plain', inlineBoxes: undefined };

    let matchingMeasure: ParagraphMeasure | undefined;
    let matchingWidth = 0;
    for (let width = 20; width <= 300; width += 1) {
      const [prefixMeasure, plainMeasure, boxedMeasure] = await Promise.all([
        measureBlock(prefixBlock, width).then(expectParagraphMeasure),
        measureBlock(plainBlock, width).then(expectParagraphMeasure),
        measureBlock(block, width).then(expectParagraphMeasure),
      ]);
      if (
        prefixMeasure.lines.length === 1 &&
        plainMeasure.lines.length === 1 &&
        boxedMeasure.lines[1]?.inlineBoxes?.length
      ) {
        matchingMeasure = boxedMeasure;
        matchingWidth = width;
        break;
      }
    }

    expect(matchingMeasure).toBeDefined();
    expect(matchingMeasure!.lines[0]!.toChar).toBe(prefix.length);
    expect(matchingMeasure!.lines.every((line) => line.width <= matchingWidth)).toBe(true);
  });

  it('does not reserve a late inline box edge on preceding lines after cycle cleanup', async () => {
    const maxWidth = 61;
    const block: FlowBlock = {
      kind: 'paragraph',
      id: 'late-box-cycle-cleanup',
      runs: [
        {
          text: 'xxxx xx xxxxx xxxxxxx xxxx xxxx xxxxxxx xxxxxxx xx xxxxx xxxxx xxxxxxx xxxx xx xxx xxxxxx xxxxxx xx xxxxxxx xxxxxx xx',
          fontFamily: 'Arial',
          fontSize: 16,
        },
      ],
      inlineBoxes: [
        {
          ...box(73, 76),
          layout: {
            ...box(73, 76).layout,
            paddingInlineStart: 9,
            paddingInlineEnd: 13,
            gapBefore: 0,
            gapAfter: 6,
            borderWidth: 0,
          },
        },
      ],
    };
    const plainBlock: FlowBlock = { ...block, id: 'late-box-cycle-cleanup-plain', inlineBoxes: undefined };

    const [plainMeasure, boxedMeasure] = await Promise.all([
      measureBlock(plainBlock, maxWidth).then(expectParagraphMeasure),
      measureBlock(block, maxWidth).then(expectParagraphMeasure),
    ]);

    expect(boxedMeasure.lines[0]!.toChar).toBe(plainMeasure.lines[0]!.toChar);
    expect(boxedMeasure.lines.every((line) => line.width <= (line.maxWidth ?? maxWidth))).toBe(true);
  });

  it('relocates fallback budgets when cleanup moves an inline box to another line', async () => {
    const maxWidth = 37;
    const block: FlowBlock = {
      kind: 'paragraph',
      id: 'relocated-fallback-budget',
      runs: [
        {
          text: 'xxxxxxxx xxxxxx xxxx xxxxxxx xxxx xxxxxxxx',
          fontFamily: 'Arial',
          fontSize: 16,
        },
      ],
      inlineBoxes: [
        {
          ...box(19, 34),
          layout: {
            ...box(19, 34).layout,
            paddingInlineStart: 1,
            paddingInlineEnd: 5,
            gapBefore: 2,
            gapAfter: 3,
            borderWidth: 0,
          },
        },
      ],
    };
    const plainBlock: FlowBlock = { ...block, id: 'relocated-fallback-budget-plain', inlineBoxes: undefined };

    const [plainMeasure, boxedMeasure] = await Promise.all([
      measureBlock(plainBlock, maxWidth).then(expectParagraphMeasure),
      measureBlock(block, maxWidth).then(expectParagraphMeasure),
    ]);
    const boxedLineIndex = boxedMeasure.lines.findIndex((line) => line.inlineBoxes?.length);
    const unrelatedLineCount = Math.max(0, boxedLineIndex - 1);

    expect(boxedLineIndex).toBeGreaterThan(0);
    expect(
      boxedMeasure.lines.slice(0, unrelatedLineCount).map(({ fromChar, toChar }) => ({ fromChar, toChar })),
    ).toEqual(plainMeasure.lines.slice(0, unrelatedLineCount).map(({ fromChar, toChar }) => ({ fromChar, toChar })));
    expect(boxedMeasure.lines.every((line) => line.width <= (line.maxWidth ?? maxWidth))).toBe(true);
  });

  it('reserves every inline box edge when adjacent boxes share a line', async () => {
    const maxWidth = 64;
    const block: FlowBlock = {
      kind: 'paragraph',
      id: 'adjacent-box-budgets',
      runs: [{ text: 'xxxx xxxxxx xxxxxx xxxxxx xx x', fontFamily: 'Arial', fontSize: 16 }],
      inlineBoxes: [
        {
          ...box(1, 8),
          id: 'first-citation',
          layout: {
            ...box(1, 8).layout,
            paddingInlineStart: 7,
            paddingInlineEnd: 0,
            gapBefore: 1,
            gapAfter: 4,
            borderWidth: 0,
          },
        },
        {
          ...box(8, 10),
          id: 'second-citation',
          layout: {
            ...box(8, 10).layout,
            paddingInlineStart: 3,
            paddingInlineEnd: 2,
            gapBefore: 0,
            gapAfter: 4,
            borderWidth: 1,
          },
        },
      ],
    };

    const measure = expectParagraphMeasure(await measureBlock(block, maxWidth));

    expect(measure.lines.every((line) => line.width <= maxWidth)).toBe(true);
  });

  it('keeps adjacent inline box edges within the measured line width', async () => {
    const maxWidth = 40;
    const block: FlowBlock = {
      kind: 'paragraph',
      id: 'adjacent-box-final-width',
      runs: [{ text: 'prefix xxxxx x', fontFamily: 'Arial', fontSize: 16 }],
      inlineBoxes: [
        {
          ...box(7, 12),
          id: 'first-citation',
          layout: {
            ...box(7, 12).layout,
            paddingInlineStart: 8,
            paddingInlineEnd: 4,
            paddingBlockStart: 1,
            paddingBlockEnd: 1,
            gapBefore: 0,
            gapAfter: 4,
            borderWidth: 0,
          },
        },
        {
          ...box(12, 13),
          id: 'second-citation',
          layout: {
            ...box(12, 13).layout,
            paddingInlineStart: 4,
            paddingInlineEnd: 1,
            paddingBlockStart: 1,
            paddingBlockEnd: 1,
            gapBefore: 1,
            gapAfter: 3,
            borderWidth: 1,
          },
        },
      ],
    };

    const measure = expectParagraphMeasure(await measureBlock(block, maxWidth));

    expect(measure.lines.every((line) => line.width <= maxWidth)).toBe(true);
  });

  it('keeps inline box edges within the indented line width', async () => {
    const maxWidth = 70;
    const effectiveWidth = 30;
    const block: FlowBlock = {
      kind: 'paragraph',
      id: 'indented-inline-box',
      runs: [{ text: 'alpha beta gamma delta epsilon', fontFamily: 'Arial', fontSize: 12 }],
      attrs: { indent: { left: 30, right: 10 } },
      inlineBoxes: [
        {
          ...box(6, 16),
          layout: {
            ...box(6, 16).layout,
            paddingInlineStart: 8,
            paddingInlineEnd: 8,
            gapBefore: 4,
            gapAfter: 4,
            borderWidth: 1,
          },
        },
      ],
    };

    const measure = expectParagraphMeasure(await measureBlock(block, maxWidth));

    expect(measure.lines.filter((line) => line.inlineBoxes?.length).length).toBeGreaterThan(1);
    expect(measure.lines.every((line) => line.width <= effectiveWidth)).toBe(true);
  });

  it('emits exact fragment edges without changing text ascent or descent', async () => {
    const plain = { ...boxedParagraph(), inlineBoxes: undefined };
    const [plainMeasure, boxedMeasure] = await Promise.all([
      measureBlock(plain, 1000).then(expectParagraphMeasure),
      measureBlock(boxedParagraph(), 1000).then(expectParagraphMeasure),
    ]);
    const line = boxedMeasure.lines[0]!;
    const lineBox = line.inlineBoxes?.[0];

    expect(lineBox).toMatchObject({ from: 6, to: 10, startsRange: true, endsRange: true, top: 0 });
    expect(lineBox!.x + lineBox!.width + lineBox!.style.gapAfter).toBeCloseTo(line.width);
    expect(line.ascent).toBe(plainMeasure.lines[0]!.ascent);
    expect(line.descent).toBe(plainMeasure.lines[0]!.descent);
    expect(line.lineHeight - plainMeasure.lines[0]!.lineHeight).toBe(10);
  });

  it('preserves each box height when boxes have different vertical chrome', async () => {
    const block: FlowBlock = {
      kind: 'paragraph',
      id: 'different-box-heights',
      runs: [{ text: 'alpha beta gamma', fontFamily: 'Arial', fontSize: 16 }],
      inlineBoxes: [
        box(0, 5),
        {
          ...box(6, 10),
          id: 'compact-citation',
          layout: {
            ...box(6, 10).layout,
            paddingBlockStart: 1,
            paddingBlockEnd: 1,
          },
        },
      ],
    };
    const plainBlock = { ...block, inlineBoxes: undefined };
    const [plainMeasure, boxedMeasure] = await Promise.all([
      measureBlock(plainBlock, 1000).then(expectParagraphMeasure),
      measureBlock(block, 1000).then(expectParagraphMeasure),
    ]);
    const baseLineHeight = plainMeasure.lines[0]!.lineHeight;
    const line = boxedMeasure.lines[0]!;

    expect(line.lineHeight).toBe(baseLineHeight + 10);
    expect(line.inlineBoxes?.map((lineBox) => lineBox.height)).toEqual([baseLineHeight + 10, baseLineHeight + 4]);
  });

  it('preserves a mid-run boundary as a segment edge beside atomic content', async () => {
    const block: FlowBlock = {
      kind: 'paragraph',
      id: 'boundary-segments',
      runs: [
        { text: 'prefix ', fontFamily: 'Arial', fontSize: 16 },
        { text: 'boxed suffix', fontFamily: 'Arial', fontSize: 16 },
        { kind: 'image', src: 'image.png', width: 10, height: 10 },
      ],
      inlineBoxes: [box(9, 12)],
    };

    const measure = expectParagraphMeasure(await measureBlock(block, 1000));
    const runSegments = measure.lines[0]!.segments!.filter((segment) => segment.runIndex === 1);

    expect(runSegments.some((segment) => segment.toChar === 2)).toBe(true);
    expect(runSegments.some((segment) => segment.fromChar === 2 && segment.toChar === 5)).toBe(true);
    expect(runSegments.some((segment) => segment.fromChar === 5)).toBe(true);
  });

  it('positions box geometry after a tab stop in line coordinates', async () => {
    const block: FlowBlock = {
      kind: 'paragraph',
      id: 'tabbed-box',
      runs: [{ kind: 'tab' }, { text: 'boxed suffix', fontFamily: 'Arial', fontSize: 16 }],
      inlineBoxes: [box(1, 6)],
    };

    const measure = expectParagraphMeasure(await measureBlock(block, 1000));
    const line = measure.lines[0]!;
    const firstTextSegment = line.segments?.find((segment) => segment.runIndex === 1);

    expect(firstTextSegment?.x).toBeGreaterThan(0);
    expect(line.inlineBoxes?.[0]?.x).toBeGreaterThanOrEqual(firstTextSegment!.x!);
  });

  it('keeps integer-authored geometry deterministic without rounding it through layout mode', async () => {
    configureMeasurement({ mode: 'deterministic' });
    try {
      const first = expectParagraphMeasure(await measureBlock(boxedParagraph(), 180));
      const second = expectParagraphMeasure(await measureBlock(boxedParagraph(), 180));
      expect(second.lines).toEqual(first.lines);
      expect(first.lines[0]!.inlineBoxes?.[0]!.style).toMatchObject({
        paddingInlineStart: 6,
        paddingInlineEnd: 8,
        paddingBlockStart: 3,
        paddingBlockEnd: 5,
        gapBefore: 2,
        gapAfter: 4,
        borderWidth: 1,
      });
    } finally {
      configureMeasurement({ mode: 'browser' });
    }
  });
});
