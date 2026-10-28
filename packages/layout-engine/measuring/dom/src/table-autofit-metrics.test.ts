import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { TableCell, ParagraphMeasure } from '@superdoc/contracts';
import type { TableBlock } from '@superdoc/contracts';
import { measureBlock } from './index.js';
import { buildAutoFitWorkingGridInput } from './autofit-normalize.js';
import { computeFixedTableColumnWidths } from './fixed-table-columns.js';
import {
  buildAutoFitTableResultCacheKey,
  buildTableCellContentMetricsCacheKey,
  clearTableAutoFitMeasurementCaches,
  measureTableAutoFitContentMetrics,
  measureTableCellContentMetrics,
} from './table-autofit-metrics.js';

describe('table-autofit-metrics', () => {
  beforeEach(() => {
    clearTableAutoFitMeasurementCaches();
  });

  it.each(['auto', 'none'] as const)(
    'uses Word kerning for a cold intrinsic canvas initialized to %s',
    async (initialKerning) => {
      vi.resetModules();
      const context = {
        font: '',
        fontKerning: initialKerning,
        measureText: vi.fn(function (this: { fontKerning: string }) {
          return { width: this.fontKerning === 'none' ? 20 : 16 };
        }),
      } as unknown as CanvasRenderingContext2D;
      const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
      try {
        const fresh = await import('./table-autofit-metrics.js');
        const cell: TableCell = {
          id: 'cold-kerning-cell',
          attrs: {
            padding: { left: 0, right: 0, top: 0, bottom: 0 },
          },
          blocks: [
            {
              id: 'cold-kerning-paragraph',
              kind: 'paragraph',
              runs: [{ text: 'AV', fontFamily: 'Arial', fontSize: 16 }],
            },
          ],
        };
        const metrics = await fresh.measureTableCellContentMetrics(cell, {
          maxWidth: 400,
          measureBlock: async () =>
            ({ kind: 'paragraph', lines: [{ width: 40 }], totalHeight: 20 }) as ParagraphMeasure,
        });
        expect(metrics).toEqual({ minWidthPx: 20, maxWidthPx: 40 });
        expect(context.fontKerning).toBe('none');
      } finally {
        getContext.mockRestore();
      }
    },
  );

  it('uses the widest unbreakable token for cell min width', async () => {
    const cell: TableCell = {
      id: 'cell-token',
      attrs: {
        padding: { left: 0, right: 0, top: 0, bottom: 0 },
      },
      blocks: [
        {
          kind: 'paragraph',
          id: 'para-token',
          runs: [{ text: 'Short SuperLongVINToken-12345 tiny', fontFamily: 'Arial', fontSize: 12 }],
        },
      ],
    };

    const longestTokenCell: TableCell = {
      id: 'cell-longest-token',
      attrs: {
        padding: { left: 0, right: 0, top: 0, bottom: 0 },
      },
      blocks: [
        {
          kind: 'paragraph',
          id: 'para-longest-token',
          runs: [{ text: 'SuperLongVINToken', fontFamily: 'Arial', fontSize: 12 }],
        },
      ],
    };

    const metrics = await measureTableCellContentMetrics(cell, { maxWidth: 400, measureBlock });
    const expected = await measureTableCellContentMetrics(longestTokenCell, { maxWidth: 400, measureBlock });

    expect(metrics.minWidthPx).toBeCloseTo(expected.maxWidthPx, 3);
    expect(metrics.maxWidthPx).toBeGreaterThan(metrics.minWidthPx);
  });

  it('reserves inline box edges in the intrinsic minimum width', async () => {
    const paragraph = {
      kind: 'paragraph' as const,
      id: 'inline-box-autofit-paragraph',
      runs: [{ text: 'citation', fontFamily: 'Arial', fontSize: 12 }],
    };
    const plain: TableCell = {
      id: 'plain-inline-box-cell',
      attrs: { padding: { left: 0, right: 0, top: 0, bottom: 0 } },
      blocks: [paragraph],
    };
    const boxed: TableCell = {
      ...plain,
      id: 'boxed-inline-box-cell',
      blocks: [
        {
          ...paragraph,
          inlineBoxes: [
            {
              id: 'citation',
              from: 0,
              to: 8,
              layout: {
                paddingInlineStart: 6,
                paddingInlineEnd: 8,
                paddingBlockStart: 0,
                paddingBlockEnd: 0,
                gapBefore: 2,
                gapAfter: 4,
                borderWidth: 1,
              },
              appearance: {},
            },
          ],
        },
      ],
    };

    const [plainMetrics, boxedMetrics] = await Promise.all([
      measureTableCellContentMetrics(plain, { maxWidth: 400, measureBlock }),
      measureTableCellContentMetrics(boxed, { maxWidth: 400, measureBlock }),
    ]);

    expect(boxedMetrics.minWidthPx - plainMetrics.minWidthPx).toBeCloseTo(22, 3);
    expect(boxedMetrics.maxWidthPx - plainMetrics.maxWidthPx).toBeCloseTo(22, 3);
  });

  it('does not combine box edges from separate intrinsic tokens', async () => {
    const layout = {
      paddingInlineStart: 6,
      paddingInlineEnd: 8,
      paddingBlockStart: 0,
      paddingBlockEnd: 0,
      gapBefore: 2,
      gapAfter: 4,
      borderWidth: 1,
    };
    const plain: TableCell = {
      id: 'plain-two-box-cell',
      attrs: { padding: { left: 0, right: 0, top: 0, bottom: 0 } },
      blocks: [{ kind: 'paragraph', id: 'plain-two-boxes', runs: [{ text: 'citation citation' }] }],
    };
    const boxed: TableCell = {
      ...plain,
      id: 'boxed-two-box-cell',
      blocks: [
        {
          kind: 'paragraph',
          id: 'boxed-two-boxes',
          runs: [{ text: 'citation citation' }],
          inlineBoxes: [
            { id: 'first', from: 0, to: 8, layout, appearance: {} },
            { id: 'second', from: 9, to: 17, layout, appearance: {} },
          ],
        },
      ],
    };

    const [plainMetrics, boxedMetrics] = await Promise.all([
      measureTableCellContentMetrics(plain, { maxWidth: 400, measureBlock }),
      measureTableCellContentMetrics(boxed, { maxWidth: 400, measureBlock }),
    ]);

    expect(boxedMetrics.minWidthPx - plainMetrics.minWidthPx).toBeCloseTo(22, 3);
    expect(boxedMetrics.maxWidthPx - plainMetrics.maxWidthPx).toBeCloseTo(44, 3);
  });

  it('treats CJK ideographs as breakable intrinsic-width units', async () => {
    const cjkCell: TableCell = {
      id: 'cell-cjk-clause',
      attrs: {
        padding: { left: 0, right: 0, top: 0, bottom: 0 },
      },
      blocks: [
        {
          kind: 'paragraph',
          id: 'para-cjk-clause',
          runs: [
            {
              text: '示例文本内容占位符样张测试用字符替换排版验证示例',
              fontFamily: 'Arial',
              fontSize: 12,
            },
          ],
        },
      ],
    };
    const singleIdeographCell: TableCell = {
      id: 'cell-cjk-single',
      attrs: {
        padding: { left: 0, right: 0, top: 0, bottom: 0 },
      },
      blocks: [
        {
          kind: 'paragraph',
          id: 'para-cjk-single',
          runs: [{ text: '示', fontFamily: 'Arial', fontSize: 12 }],
        },
      ],
    };

    const metrics = await measureTableCellContentMetrics(cjkCell, { maxWidth: 624, measureBlock });
    const singleIdeograph = await measureTableCellContentMetrics(singleIdeographCell, {
      maxWidth: 624,
      measureBlock,
    });

    expect(metrics.minWidthPx).toBeCloseTo(singleIdeograph.maxWidthPx, 3);
    expect(metrics.maxWidthPx).toBeGreaterThan(metrics.minWidthPx * 10);
  });

  it('preserves an explicit equal DOCX grid when the wider-looking cell is breakable CJK text', async () => {
    const preferredColumnWidth = 312;
    const cellWidth = { value: 4680, type: 'dxa' } as const;
    const table: TableBlock = {
      kind: 'table',
      id: 'sd-4064-equal-bilingual-grid',
      attrs: {
        tableWidth: { width: preferredColumnWidth * 2, type: 'px' },
      },
      columnWidths: [preferredColumnWidth, preferredColumnWidth],
      rows: [
        {
          id: 'row-header',
          cells: [
            {
              id: 'cell-header-en',
              attrs: { tableCellProperties: { cellWidth } },
              blocks: [
                {
                  kind: 'paragraph',
                  id: 'para-header-en',
                  runs: [{ text: 'LOREMIP', fontFamily: 'Arial', fontSize: 12 }],
                },
              ],
            },
            {
              id: 'cell-header-zh',
              attrs: { tableCellProperties: { cellWidth } },
              blocks: [
                {
                  kind: 'paragraph',
                  id: 'para-header-zh',
                  runs: [{ text: '示例', fontFamily: 'Arial', fontSize: 12 }],
                },
              ],
            },
          ],
        },
        {
          id: 'row-body',
          cells: [
            {
              id: 'cell-body-en',
              attrs: { tableCellProperties: { cellWidth } },
              blocks: [
                {
                  kind: 'paragraph',
                  id: 'para-body-en',
                  runs: [
                    {
                      text: 'Lorem ipsum dolor sit amet consectetur adipiscing elit.',
                      fontFamily: 'Arial',
                      fontSize: 12,
                    },
                  ],
                },
              ],
            },
            {
              id: 'cell-body-zh',
              attrs: { tableCellProperties: { cellWidth } },
              blocks: [
                {
                  kind: 'paragraph',
                  id: 'para-body-zh',
                  runs: [
                    {
                      text: '示例文本内容占位符样张测试用字符替换排版验证示例文本内容占位符样张测试用字符替换排版。',
                      fontFamily: 'Arial',
                      fontSize: 12,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const measure = await measureBlock(table, { maxWidth: preferredColumnWidth * 2 });

    expect(measure.kind).toBe('table');
    if (measure.kind !== 'table') throw new Error('expected table measure');
    expect(measure.columnWidths[0]).toBeCloseTo(preferredColumnWidth, 3);
    expect(measure.columnWidths[1]).toBeCloseTo(preferredColumnWidth, 3);
  });

  it('keeps non-breaking-space tokens together across adjacent styled runs', async () => {
    const splitRunCell: TableCell = {
      id: 'cell-nbsp-split-runs',
      attrs: {
        padding: { left: 0, right: 0, top: 0, bottom: 0 },
      },
      blocks: [
        {
          kind: 'paragraph',
          id: 'para-nbsp-split-runs',
          runs: [
            { text: 'EXHIBIT\u00a0\u201c', fontFamily: 'Arial', fontSize: 12 },
            { text: 'A', fontFamily: 'Arial', fontSize: 12 },
            { text: '\u201d', fontFamily: 'Arial', fontSize: 12 },
          ],
        },
      ],
    };

    const unsplitCell: TableCell = {
      id: 'cell-nbsp-unsplit',
      attrs: {
        padding: { left: 0, right: 0, top: 0, bottom: 0 },
      },
      blocks: [
        {
          kind: 'paragraph',
          id: 'para-nbsp-unsplit',
          runs: [{ text: 'EXHIBIT\u00a0\u201cA\u201d', fontFamily: 'Arial', fontSize: 12 }],
        },
      ],
    };

    const metrics = await measureTableCellContentMetrics(splitRunCell, { maxWidth: 400, measureBlock });
    const expected = await measureTableCellContentMetrics(unsplitCell, { maxWidth: 400, measureBlock });

    expect(metrics.minWidthPx).toBeCloseTo(expected.maxWidthPx, 3);
  });

  it('keeps quote-delimited hyperlink text together after a normal breakable space', async () => {
    const splitRunCell: TableCell = {
      id: 'cell-quote-split-runs',
      attrs: {
        padding: { left: 0, right: 0, top: 0, bottom: 0 },
      },
      blocks: [
        {
          kind: 'paragraph',
          id: 'para-quote-split-runs',
          runs: [
            { text: 'EXHIBIT \u201c', fontFamily: 'Arial', fontSize: 12 },
            { text: 'A', fontFamily: 'Arial', fontSize: 12 },
            { text: '\u201d', fontFamily: 'Arial', fontSize: 12 },
          ],
        },
      ],
    };

    const quoteTokenCell: TableCell = {
      id: 'cell-quote-token',
      attrs: {
        padding: { left: 0, right: 0, top: 0, bottom: 0 },
      },
      blocks: [
        {
          kind: 'paragraph',
          id: 'para-quote-token',
          runs: [{ text: '\u201cA\u201d', fontFamily: 'Arial', fontSize: 12 }],
        },
      ],
    };

    const fullPhraseCell: TableCell = {
      id: 'cell-quote-full-phrase',
      attrs: {
        padding: { left: 0, right: 0, top: 0, bottom: 0 },
      },
      blocks: [
        {
          kind: 'paragraph',
          id: 'para-quote-full-phrase',
          runs: [{ text: 'EXHIBIT \u201cA\u201d', fontFamily: 'Arial', fontSize: 12 }],
        },
      ],
    };

    const metrics = await measureTableCellContentMetrics(splitRunCell, { maxWidth: 400, measureBlock });
    const expected = await measureTableCellContentMetrics(quoteTokenCell, { maxWidth: 400, measureBlock });
    const fullPhrase = await measureTableCellContentMetrics(fullPhraseCell, { maxWidth: 400, measureBlock });

    expect(metrics.minWidthPx).toBeGreaterThanOrEqual(expected.maxWidthPx);
    expect(metrics.minWidthPx).toBeLessThan(fullPhrase.maxWidthPx);
  });

  it('keeps explicit line breaks when computing no-wrap max width', async () => {
    const wrappedCell: TableCell = {
      id: 'cell-breaks',
      attrs: {
        padding: { left: 0, right: 0, top: 0, bottom: 0 },
      },
      blocks: [
        {
          kind: 'paragraph',
          id: 'para-breaks',
          runs: [{ text: 'LongestLine\nTiny', fontFamily: 'Arial', fontSize: 12 }],
        },
      ],
    };

    const singleLineCell: TableCell = {
      id: 'cell-single-line',
      attrs: {
        padding: { left: 0, right: 0, top: 0, bottom: 0 },
      },
      blocks: [
        {
          kind: 'paragraph',
          id: 'para-single-line',
          runs: [{ text: 'LongestLine', fontFamily: 'Arial', fontSize: 12 }],
        },
      ],
    };

    const metrics = await measureTableCellContentMetrics(wrappedCell, { maxWidth: 400, measureBlock });
    const expected = await measureTableCellContentMetrics(singleLineCell, { maxWidth: 400, measureBlock });

    expect(metrics.maxWidthPx).toBeCloseTo(expected.maxWidthPx, 3);
  });

  it('takes the widest paragraph across multi-paragraph cells', async () => {
    const multiParagraphCell: TableCell = {
      id: 'cell-multi-paragraph',
      attrs: {
        padding: { left: 0, right: 0, top: 0, bottom: 0 },
      },
      blocks: [
        {
          kind: 'paragraph',
          id: 'para-short',
          runs: [{ text: 'Short', fontFamily: 'Arial', fontSize: 12 }],
        },
        {
          kind: 'paragraph',
          id: 'para-long',
          runs: [{ text: 'MuchMuchLongerParagraph', fontFamily: 'Arial', fontSize: 12 }],
        },
      ],
    };

    const widestParagraphCell: TableCell = {
      id: 'cell-widest-paragraph',
      attrs: {
        padding: { left: 0, right: 0, top: 0, bottom: 0 },
      },
      blocks: [
        {
          kind: 'paragraph',
          id: 'para-widest',
          runs: [{ text: 'MuchMuchLongerParagraph', fontFamily: 'Arial', fontSize: 12 }],
        },
      ],
    };

    const metrics = await measureTableCellContentMetrics(multiParagraphCell, { maxWidth: 400, measureBlock });
    const expected = await measureTableCellContentMetrics(widestParagraphCell, { maxWidth: 400, measureBlock });

    expect(metrics.minWidthPx).toBeCloseTo(expected.minWidthPx, 3);
    expect(metrics.maxWidthPx).toBeCloseTo(expected.maxWidthPx, 3);
  });

  it('treats vanished text as zero-width intrinsic content', async () => {
    const hiddenPrefixCell: TableCell = {
      id: 'cell-hidden-prefix',
      attrs: {
        padding: { left: 0, right: 0, top: 0, bottom: 0 },
      },
      blocks: [
        {
          kind: 'paragraph',
          id: 'para-hidden-prefix',
          runs: [
            { text: 'SuperLongHiddenToken', fontFamily: 'Arial', fontSize: 12, vanish: true },
            { text: 'Visible', fontFamily: 'Arial', fontSize: 12 },
          ],
        },
      ],
    };

    const visibleOnlyCell: TableCell = {
      id: 'cell-visible-only',
      attrs: {
        padding: { left: 0, right: 0, top: 0, bottom: 0 },
      },
      blocks: [
        {
          kind: 'paragraph',
          id: 'para-visible-only',
          runs: [{ text: 'Visible', fontFamily: 'Arial', fontSize: 12 }],
        },
      ],
    };

    const hiddenOnlyCell: TableCell = {
      id: 'cell-hidden-only',
      attrs: {
        padding: { left: 0, right: 0, top: 0, bottom: 0 },
      },
      blocks: [
        {
          kind: 'paragraph',
          id: 'para-hidden-only',
          runs: [{ text: 'SuperLongHiddenToken', fontFamily: 'Arial', fontSize: 12, vanish: true }],
        },
      ],
    };

    const hiddenPrefix = await measureTableCellContentMetrics(hiddenPrefixCell, { maxWidth: 400, measureBlock });
    const visibleOnly = await measureTableCellContentMetrics(visibleOnlyCell, { maxWidth: 400, measureBlock });
    const hiddenOnly = await measureTableCellContentMetrics(hiddenOnlyCell, { maxWidth: 400, measureBlock });

    expect(hiddenPrefix.minWidthPx).toBeCloseTo(visibleOnly.minWidthPx, 3);
    expect(hiddenPrefix.maxWidthPx).toBeCloseTo(visibleOnly.maxWidthPx, 3);
    expect(hiddenOnly).toEqual({ minWidthPx: 0, maxWidthPx: 0 });
  });

  it('treats control blocks inside cells as zero-width AutoFit content', async () => {
    const controlOnlyCell: TableCell = {
      id: 'cell-control-blocks',
      attrs: {
        padding: { left: 0, right: 0, top: 0, bottom: 0 },
      },
      blocks: [
        { kind: 'pageBreak', id: 'page-break-before', attrs: { source: 'pageBreakBefore' } },
        { kind: 'columnBreak', id: 'column-break' },
        { kind: 'sectionBreak', id: 'section-break', type: 'continuous', margins: {} },
      ],
    };

    const metrics = await measureTableCellContentMetrics(controlOnlyCell, { maxWidth: 400, measureBlock });

    expect(metrics).toEqual({ minWidthPx: 0, maxWidthPx: 0 });
  });

  it('ignores table-cell pageBreakBefore controls when measuring neighboring content', async () => {
    const cell: TableCell = {
      id: 'cell-page-break-before-content',
      attrs: {
        padding: { left: 0, right: 0, top: 0, bottom: 0 },
      },
      blocks: [
        { kind: 'pageBreak', id: 'page-break-before', attrs: { source: 'pageBreakBefore' } },
        {
          kind: 'paragraph',
          id: 'para-after-page-break-before',
          runs: [{ text: 'AfterBreak', fontFamily: 'Arial', fontSize: 12 }],
        },
      ],
    };
    const paragraphOnlyCell: TableCell = {
      id: 'cell-paragraph-only',
      attrs: {
        padding: { left: 0, right: 0, top: 0, bottom: 0 },
      },
      blocks: [
        {
          kind: 'paragraph',
          id: 'para-after-page-break-before',
          runs: [{ text: 'AfterBreak', fontFamily: 'Arial', fontSize: 12 }],
        },
      ],
    };

    const metrics = await measureTableCellContentMetrics(cell, { maxWidth: 400, measureBlock });
    const expected = await measureTableCellContentMetrics(paragraphOnlyCell, { maxWidth: 400, measureBlock });

    expect(metrics.minWidthPx).toBeCloseTo(expected.minWidthPx, 3);
    expect(metrics.maxWidthPx).toBeCloseTo(expected.maxWidthPx, 3);
  });

  it('treats image blocks as atomic min/max contributors and adds horizontal chrome', async () => {
    const cell: TableCell = {
      id: 'cell-image',
      attrs: {
        padding: { left: 5, right: 7, top: 0, bottom: 0 },
        borders: {
          left: { style: 'single', width: 2 },
          right: { style: 'single', width: 3 },
        },
      },
      blocks: [
        {
          kind: 'image',
          id: 'image-0',
          src: 'data:image/png;base64,abc',
          width: 120,
          height: 40,
        },
      ],
    };

    const metrics = await measureTableCellContentMetrics(cell, { maxWidth: 400, measureBlock });

    expect(metrics.minWidthPx).toBe(137);
    expect(metrics.maxWidthPx).toBe(137);
  });

  it('reserves the authored total width for OOXML double-border chrome', async () => {
    const cell: TableCell = {
      id: 'cell-double-border',
      attrs: {
        padding: { left: 0, right: 0, top: 0, bottom: 0 },
        borders: {
          left: { style: 'double', width: 2 / 3 },
          right: { style: 'double', width: 2 / 3 },
        },
      },
      blocks: [
        {
          kind: 'image',
          id: 'image-double-border',
          src: 'data:image/png;base64,abc',
          width: 120,
          height: 40,
        },
      ],
    };

    const metrics = await measureTableCellContentMetrics(cell, { maxWidth: 400, measureBlock });

    expect(metrics.minWidthPx).toBeCloseTo(120 + 4 / 3, 4);
    expect(metrics.maxWidthPx).toBeCloseTo(120 + 4 / 3, 4);
  });

  it('measures nested percentage tables against the containing cell width', async () => {
    const cell: TableCell = {
      id: 'cell-nested-table',
      attrs: {
        padding: { left: 0, right: 0, top: 0, bottom: 0 },
      },
      blocks: [
        {
          kind: 'table',
          id: 'nested-table',
          attrs: {
            tableWidth: { value: 2500, type: 'pct' },
          },
          columnWidths: [100],
          rows: [
            {
              id: 'nested-row-0',
              cells: [
                {
                  id: 'nested-cell-0-0',
                  blocks: [
                    {
                      kind: 'paragraph',
                      id: 'nested-para-0',
                      runs: [{ text: 'Nested', fontFamily: 'Arial', fontSize: 12 }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const metricsAt200 = await measureTableCellContentMetrics(cell, { maxWidth: 200, measureBlock });
    const metricsAt600 = await measureTableCellContentMetrics(cell, { maxWidth: 600, measureBlock });

    expect(metricsAt200.minWidthPx).toBe(100);
    expect(metricsAt200.maxWidthPx).toBe(100);
    expect(metricsAt600.minWidthPx).toBe(300);
    expect(metricsAt600.maxWidthPx).toBe(300);
  });

  it('treats non-breaking hyphenated text as a single unbreakable token', async () => {
    const cell: TableCell = {
      id: 'cell-nonbreaking-hyphen',
      attrs: {
        padding: { left: 0, right: 0, top: 0, bottom: 0 },
      },
      blocks: [
        {
          kind: 'paragraph',
          id: 'para-nonbreaking-hyphen',
          runs: [{ text: 'part\u2011number', fontFamily: 'Arial', fontSize: 12 }],
        },
      ],
    };

    const expectedCell: TableCell = {
      id: 'cell-nonbreaking-hyphen-expected',
      attrs: {
        padding: { left: 0, right: 0, top: 0, bottom: 0 },
      },
      blocks: [
        {
          kind: 'paragraph',
          id: 'para-nonbreaking-hyphen-expected',
          runs: [{ text: 'part\u2011number', fontFamily: 'Arial', fontSize: 12 }],
        },
      ],
    };

    const metrics = await measureTableCellContentMetrics(cell, { maxWidth: 400, measureBlock });
    const expected = await measureTableCellContentMetrics(expectedCell, { maxWidth: 400, measureBlock });

    expect(metrics.minWidthPx).toBeCloseTo(expected.maxWidthPx, 3);
  });

  it('reuses cached cell metrics and invalidates when cell content changes', async () => {
    const measuringSpy = vi.fn(measureBlock);

    const originalCell: TableCell = {
      id: 'cell-cache',
      blocks: [
        {
          kind: 'paragraph',
          id: 'para-cache',
          runs: [{ text: 'Original', fontFamily: 'Arial', fontSize: 12 }],
        },
      ],
    };

    const changedCell: TableCell = {
      id: 'cell-cache',
      blocks: [
        {
          kind: 'paragraph',
          id: 'para-cache',
          runs: [{ text: 'ChangedContent', fontFamily: 'Arial', fontSize: 12 }],
        },
      ],
    };

    const first = await measureTableCellContentMetrics(originalCell, { maxWidth: 400, measureBlock: measuringSpy });
    const second = await measureTableCellContentMetrics(originalCell, { maxWidth: 400, measureBlock: measuringSpy });
    const changed = await measureTableCellContentMetrics(changedCell, { maxWidth: 400, measureBlock: measuringSpy });

    expect(first).toEqual(second);
    expect(measuringSpy).toHaveBeenCalledTimes(2);
    expect(changed.maxWidthPx).toBeGreaterThan(first.maxWidthPx);
  });

  it('reuses intrinsic metrics across cell and paragraph identity-only differences', async () => {
    const measuringSpy = vi.fn(measureBlock);
    const first: TableCell = {
      id: 'CELL-A',
      blocks: [
        {
          kind: 'paragraph',
          id: 'PARAGRAPH-A',
          runs: [{ text: 'same geometry', fontFamily: 'Arial', fontSize: 12 }],
        },
      ],
    };
    const second: TableCell = {
      ...first,
      id: 'CELL-B',
      blocks: first.blocks?.map((block) => ({ ...block, id: 'PARAGRAPH-B' })),
    };

    const firstMetrics = await measureTableCellContentMetrics(first, {
      maxWidth: 400,
      measureBlock: measuringSpy,
      identityNeutralCache: true,
    });
    const secondMetrics = await measureTableCellContentMetrics(second, {
      maxWidth: 400,
      measureBlock: measuringSpy,
      identityNeutralCache: true,
    });

    expect(secondMetrics).toEqual(firstMetrics);
    expect(measuringSpy).toHaveBeenCalledTimes(1);
  });

  it('changes identity-sensitive keys only when strict cache mode is selected', () => {
    const first: TableCell = {
      id: 'CELL-A',
      blocks: [{ kind: 'paragraph', id: 'PARAGRAPH-A', runs: [{ text: 'same geometry' }] }],
    };
    const second: TableCell = {
      ...first,
      id: 'CELL-B',
      blocks: [{ kind: 'paragraph', id: 'PARAGRAPH-B', runs: [{ text: 'same geometry' }] }],
    };

    const strictFirst = buildTableCellContentMetricsCacheKey(first, { maxWidth: 400 });
    const strictSecond = buildTableCellContentMetricsCacheKey(second, { maxWidth: 400 });
    const contentFirst = buildTableCellContentMetricsCacheKey(first, {
      maxWidth: 400,
      identityNeutralCache: true,
    });
    const contentSecond = buildTableCellContentMetricsCacheKey(second, {
      maxWidth: 400,
      identityNeutralCache: true,
    });

    expect(strictFirst).not.toBe(strictSecond);
    expect(contentFirst).toBe(contentSecond);
  });

  it('changes cell content keys when only nested inline-box metrics or appearance change', () => {
    const cell = (paddingInlineStart: number, backgroundColor: string): TableCell => ({
      id: 'inline-box-cell',
      blocks: [
        {
          kind: 'paragraph',
          id: 'inline-box-paragraph',
          runs: [{ text: 'Citation' }],
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
              appearance: { backgroundColor },
            },
          ],
        },
      ],
    });
    const base = buildTableCellContentMetricsCacheKey(cell(4, '#eef2ff'), { maxWidth: 400 });

    expect(buildTableCellContentMetricsCacheKey(cell(8, '#eef2ff'), { maxWidth: 400 })).not.toBe(base);
    expect(buildTableCellContentMetricsCacheKey(cell(4, '#ffffff'), { maxWidth: 400 })).not.toBe(base);
    expect(buildTableCellContentMetricsCacheKey(cell(4, '#eef2ff'), { maxWidth: 400 })).toBe(base);
  });

  it('reuses cached cell metrics when only absolute source positions shift', async () => {
    const measuringSpy = vi.fn(measureBlock);
    const originalCell: TableCell = {
      id: 'cell-position-shift',
      sourceAnchor: {
        sourceNodeId: 'CELL0001',
        pmRange: { from: 100, to: 120 },
      },
      blocks: [
        {
          kind: 'paragraph',
          id: 'para-position-shift',
          sourceAnchor: {
            sourceNodeId: 'PARA0001',
            pmRange: { from: 101, to: 119 },
          },
          runs: [
            {
              text: 'Position-independent content',
              fontFamily: 'Arial',
              fontSize: 12,
              pmStart: 102,
              pmEnd: 130,
            },
          ],
        },
      ],
    };
    const shiftedCell: TableCell = {
      ...originalCell,
      sourceAnchor: {
        ...originalCell.sourceAnchor,
        pmRange: { from: 101, to: 121 },
      },
      blocks: originalCell.blocks?.map((block) =>
        block.kind === 'paragraph'
          ? {
              ...block,
              sourceAnchor: {
                ...block.sourceAnchor,
                pmRange: { from: 102, to: 120 },
              },
              runs: block.runs.map((run) => ({
                ...run,
                pmStart: (run.pmStart ?? 0) + 1,
                pmEnd: (run.pmEnd ?? 0) + 1,
              })),
            }
          : block,
      ),
    };

    const first = await measureTableCellContentMetrics(originalCell, { maxWidth: 400, measureBlock: measuringSpy });
    const shifted = await measureTableCellContentMetrics(shiftedCell, { maxWidth: 400, measureBlock: measuringSpy });

    expect(shifted).toEqual(first);
    expect(measuringSpy).toHaveBeenCalledTimes(1);
  });

  it('invalidates cached cell metrics when the available width changes', async () => {
    const measuringSpy = vi.fn(measureBlock);
    const cell: TableCell = {
      id: 'cell-cache-width',
      blocks: [
        {
          kind: 'paragraph',
          id: 'para-cache-width',
          runs: [{ text: 'Nested width-sensitive content', fontFamily: 'Arial', fontSize: 12 }],
        },
        {
          kind: 'table',
          id: 'nested-width-sensitive-table',
          attrs: {
            tableWidth: { value: 2500, type: 'pct' },
          },
          columnWidths: [100],
          rows: [
            {
              id: 'nested-width-sensitive-row',
              cells: [
                {
                  id: 'nested-width-sensitive-cell',
                  blocks: [
                    {
                      kind: 'paragraph',
                      id: 'nested-width-sensitive-para',
                      runs: [{ text: 'Nested', fontFamily: 'Arial', fontSize: 12 }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    await measureTableCellContentMetrics(cell, { maxWidth: 400, measureBlock: measuringSpy });
    await measureTableCellContentMetrics(cell, { maxWidth: 400, measureBlock: measuringSpy });
    await measureTableCellContentMetrics(cell, { maxWidth: 800, measureBlock: measuringSpy });

    expect(measuringSpy).toHaveBeenCalledTimes(4);
  });

  it('returns a stable row/cell-indexed metrics shape for normalized tables', async () => {
    const table: TableBlock = {
      kind: 'table',
      id: 'table-row-metrics',
      attrs: {
        tableWidth: { value: 400, type: 'px' },
      },
      columnWidths: [120, 120],
      rows: [
        {
          id: 'row-0',
          cells: [
            {
              id: 'cell-0-0',
              blocks: [
                {
                  kind: 'paragraph',
                  id: 'para-0-0',
                  runs: [{ text: 'Short', fontFamily: 'Arial', fontSize: 12 }],
                },
              ],
            },
            {
              id: 'cell-0-1',
              blocks: [
                {
                  kind: 'paragraph',
                  id: 'para-0-1',
                  runs: [{ text: 'Longer cell content', fontFamily: 'Arial', fontSize: 12 }],
                },
              ],
            },
          ],
        },
      ],
    };

    const workingInput = buildAutoFitWorkingGridInput(table, { maxWidth: 400 });
    const fixedLayout = computeFixedTableColumnWidths(workingInput);
    const metrics = await measureTableAutoFitContentMetrics(table, workingInput, fixedLayout, measureBlock);

    expect(metrics.rowMetrics).toHaveLength(1);
    expect(metrics.rowMetrics[0].rowIndex).toBe(0);
    expect(metrics.rowMetrics[0].cells.map((cell) => cell.cellIndex)).toEqual([0, 1]);
    expect(metrics.rowMetrics[0].cells[0].span).toBe(1);
    expect(metrics.rowMetrics[0].cells[1].span).toBe(1);
    expect(metrics.rows).toHaveLength(1);
    expect(metrics.rows[0].cells).toHaveLength(2);
    expect(metrics.cellMetricKeys).toHaveLength(2);
  });

  it('preserves nested percentage width measurement through the table-level metrics helper', async () => {
    const table: TableBlock = {
      kind: 'table',
      id: 'table-nested-pct-helper',
      attrs: {
        tableWidth: { value: 400, type: 'px' },
      },
      columnWidths: [200],
      rows: [
        {
          id: 'row-0',
          cells: [
            {
              id: 'cell-0-0',
              blocks: [
                {
                  kind: 'table',
                  id: 'nested-table-helper',
                  attrs: {
                    tableWidth: { value: 2500, type: 'pct' },
                  },
                  columnWidths: [100],
                  rows: [
                    {
                      id: 'nested-row-0',
                      cells: [
                        {
                          id: 'nested-cell-0-0',
                          blocks: [
                            {
                              kind: 'paragraph',
                              id: 'nested-para-helper',
                              runs: [{ text: 'Nested', fontFamily: 'Arial', fontSize: 12 }],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const workingInput = buildAutoFitWorkingGridInput(table, { maxWidth: 400 });
    const fixedLayout = computeFixedTableColumnWidths(workingInput);
    const fixedPassContentWidth = fixedLayout.totalWidth - 8;
    const metrics = await measureTableAutoFitContentMetrics(table, workingInput, fixedLayout, measureBlock);
    const directMetrics = await measureTableCellContentMetrics(table.rows[0].cells[0], {
      maxWidth: fixedPassContentWidth,
      measureBlock,
    });

    expect(fixedLayout.totalWidth).toBe(200);
    expect(metrics.rowMetrics[0].cells[0].minContentWidth).toBe(directMetrics.minWidthPx);
    expect(metrics.rowMetrics[0].cells[0].maxContentWidth).toBe(directMetrics.maxWidthPx);
    expect(metrics.rows[0].cells[0].minContentWidth).toBe(directMetrics.minWidthPx);
    expect(metrics.rows[0].cells[0].maxContentWidth).toBe(directMetrics.maxWidthPx);
  });

  it('uses the fixed-pass cell width basis for nested percentage tables when tblW is omitted', async () => {
    const table: TableBlock = {
      kind: 'table',
      id: 'table-nested-pct-fixed-basis',
      columnWidths: [120],
      rows: [
        {
          id: 'row-fixed-basis-0',
          cells: [
            {
              id: 'cell-fixed-basis-0-0',
              attrs: {
                padding: { left: 0, right: 0, top: 0, bottom: 0 },
              },
              blocks: [
                {
                  kind: 'table',
                  id: 'nested-table-fixed-basis',
                  attrs: {
                    tableWidth: { value: 2500, type: 'pct' },
                  },
                  columnWidths: [30],
                  rows: [
                    {
                      id: 'nested-row-fixed-basis-0',
                      cells: [
                        {
                          id: 'nested-cell-fixed-basis-0-0',
                          attrs: {
                            padding: { left: 0, right: 0, top: 0, bottom: 0 },
                          },
                          blocks: [
                            {
                              kind: 'paragraph',
                              id: 'nested-para-fixed-basis',
                              runs: [{ text: 'Nested', fontFamily: 'Arial', fontSize: 12 }],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const workingInput = buildAutoFitWorkingGridInput(table, { maxWidth: 400 });
    const fixedLayout = computeFixedTableColumnWidths(workingInput);
    const metrics = await measureTableAutoFitContentMetrics(table, workingInput, fixedLayout, measureBlock);
    const directFixedBasisMetrics = await measureTableCellContentMetrics(table.rows[0].cells[0], {
      maxWidth: fixedLayout.totalWidth,
      measureBlock,
    });
    const directPageBasisMetrics = await measureTableCellContentMetrics(table.rows[0].cells[0], {
      maxWidth: 400,
      measureBlock,
    });

    expect(workingInput.preferredTableWidth).toBeUndefined();
    expect(fixedLayout.totalWidth).toBe(120);
    expect(metrics.rowMetrics[0].cells[0].minContentWidth).toBe(directFixedBasisMetrics.minWidthPx);
    expect(metrics.rowMetrics[0].cells[0].maxContentWidth).toBe(directFixedBasisMetrics.maxWidthPx);
    expect(directPageBasisMetrics.maxWidthPx).toBeGreaterThanOrEqual(directFixedBasisMetrics.maxWidthPx);
  });

  it('changes the table-result cache key when row placement changes without cell metric changes', () => {
    const table: TableBlock = {
      kind: 'table',
      id: 'table-cache-key-placement',
      columnWidths: [100, 100, 100],
      rows: [
        {
          id: 'row-cache-key-0',
          cells: [
            {
              id: 'cell-cache-key-0-0',
              blocks: [
                {
                  kind: 'paragraph',
                  id: 'para-cache-key-0-0',
                  runs: [{ text: 'A', fontFamily: 'Arial', fontSize: 12 }],
                },
              ],
            },
            {
              id: 'cell-cache-key-0-1',
              blocks: [
                {
                  kind: 'paragraph',
                  id: 'para-cache-key-0-1',
                  runs: [{ text: 'B', fontFamily: 'Arial', fontSize: 12 }],
                },
              ],
            },
          ],
        },
      ],
    };

    const baseWorkingInput = buildAutoFitWorkingGridInput(table, { maxWidth: 400 });
    const shiftedWorkingInput = {
      ...baseWorkingInput,
      rows: [
        {
          ...baseWorkingInput.rows[0],
          logicalColumnCount: 3,
          skippedBefore: [{ columnIndex: 0, preferredWidth: undefined, minContentWidth: 0, maxContentWidth: 0 }],
          skippedColumns: [{ columnIndex: 0, preferredWidth: undefined, minContentWidth: 0, maxContentWidth: 0 }],
          cells: baseWorkingInput.rows[0].cells.map((cell) => ({
            ...cell,
            startColumn: cell.startColumn + 1,
          })),
        },
      ],
    };
    const baseFixedLayout = computeFixedTableColumnWidths(baseWorkingInput);
    const shiftedFixedLayout = computeFixedTableColumnWidths(shiftedWorkingInput);
    const cellMetricKeys = ['cell-a', 'cell-b'];

    const baseKey = buildAutoFitTableResultCacheKey(table, {
      maxWidth: 400,
      cellMetricKeys,
      workingInput: baseWorkingInput,
      fixedLayout: baseFixedLayout,
    });
    const shiftedKey = buildAutoFitTableResultCacheKey(table, {
      maxWidth: 400,
      cellMetricKeys,
      workingInput: shiftedWorkingInput,
      fixedLayout: shiftedFixedLayout,
    });

    expect(baseKey).not.toBe(shiftedKey);
  });
});

describe('small-caps table intrinsic width', () => {
  it('measures tokens in their painted variant', async () => {
    const prototype = Object.getPrototypeOf(document.createElement('canvas').getContext('2d'));
    const original = prototype.measureText;
    const spy = vi.spyOn(prototype, 'measureText').mockImplementation(function (text: string) {
      const metrics = original.call(this, text);
      metrics.width =
        text.length * 10 + (this.font.includes('small-caps') ? (text.match(/[a-z]/g)?.length ?? 0) * 5 : 0);
      return metrics;
    });
    const cell = (smallCaps: boolean): TableCell => ({
      id: 'small-caps-cell',
      attrs: { padding: { left: 0, right: 0, top: 0, bottom: 0 } },
      blocks: [
        {
          kind: 'paragraph',
          id: 'small-caps-cell-para',
          runs: [{ text: 'Test', fontFamily: 'Arial', fontSize: 16, smallCaps }],
        },
      ],
    });
    try {
      clearTableAutoFitMeasurementCaches();
      const plain = await measureTableCellContentMetrics(cell(false), { maxWidth: 400, measureBlock });
      const caps = await measureTableCellContentMetrics(cell(true), { maxWidth: 400, measureBlock });
      expect(caps.minWidthPx - plain.minWidthPx).toBe(15);
    } finally {
      spy.mockRestore();
      clearTableAutoFitMeasurementCaches();
    }
  });
});
