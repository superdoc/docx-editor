import { describe, expect, it } from 'vite-plus/test';
import type { TableBlock } from '@superdoc/contracts';
import { buildAutoFitWorkingGridInput } from './autofit-normalize.js';

/**
 * Build a minimal runtime table block for normalization tests.
 *
 * @param overrides - Partial table block overrides for the scenario under test.
 * @returns Table block with stable defaults.
 */
function createTableBlock(overrides: Partial<TableBlock> = {}): TableBlock {
  return {
    kind: 'table',
    id: 'table-1',
    rows: [],
    attrs: {},
    columnWidths: [],
    ...overrides,
  };
}

describe('buildAutoFitWorkingGridInput', () => {
  it('normalizes a plain grid-backed table', () => {
    const block = createTableBlock({
      attrs: {
        tableLayout: 'fixed',
        tableWidth: { width: 320, type: 'px' },
      },
      columnWidths: [100, 220],
      rows: [
        {
          id: 'row-1',
          cells: [
            { id: 'cell-1', colSpan: 1 },
            { id: 'cell-2', colSpan: 1 },
          ],
        },
      ],
    });

    const result = buildAutoFitWorkingGridInput(block, { maxWidth: 600 });

    expect(result.layoutMode).toBe('fixed');
    expect(result.preferredTableWidth).toBe(320);
    expect(result.preferredColumnWidths).toEqual([100, 220]);
    expect(result.gridColumnCount).toBe(2);
    expect(result.rows[0].logicalColumnCount).toBe(2);
    expect(result.rows[0].cells).toEqual([
      { cellId: 'cell-1', startColumn: 0, span: 1, preferredWidth: undefined },
      { cellId: 'cell-2', startColumn: 1, span: 1, preferredWidth: undefined },
    ]);
  });

  it('marks complete fixed grids that already match tblW as authoritative', () => {
    const block = createTableBlock({
      attrs: {
        tableLayout: 'fixed',
        tableWidth: { width: 400, type: 'px' },
      },
      columnWidths: [57.53333333333333, 239.46666666666667, 103],
      rows: [
        {
          id: 'row-1',
          cells: [
            {
              id: 'cell-1',
              attrs: { tableCellProperties: { cellWidth: { value: 2880, type: 'dxa' } } },
            },
            {
              id: 'cell-2',
              attrs: { tableCellProperties: { cellWidth: { value: 1440, type: 'dxa' } } },
            },
            {
              id: 'cell-3',
              attrs: { tableCellProperties: { cellWidth: { value: 5760, type: 'dxa' } } },
            },
          ],
        },
      ],
    });

    const result = buildAutoFitWorkingGridInput(block, { maxWidth: 600 });

    expect(result.preserveAuthoredGrid).toBe(true);
  });

  it('ignores positive tblW auto placeholders for fixed-layout grids', () => {
    const normalize = (value: number) =>
      buildAutoFitWorkingGridInput(
        createTableBlock({
          attrs: {
            tableLayout: 'fixed',
            tableWidth: { value, type: 'auto' },
          },
          columnWidths: [333.6, 407.73333333333335],
          rows: [
            {
              id: 'row-1',
              cells: [{ id: 'cell-1' }, { id: 'cell-2' }],
            },
          ],
        }),
        { maxWidth: 800 },
      );

    expect(normalize(0)).toMatchObject({
      preferredTableWidth: undefined,
      preferredColumnWidths: [333.6, 407.73333333333335],
      gridColumnCount: 2,
    });
    expect(normalize(100)).toEqual(normalize(0));
    expect(normalize(7200)).toEqual(normalize(0));
  });

  it('marks complete fixed grids that are slightly under tblW as authoritative', () => {
    const block = createTableBlock({
      attrs: {
        tableLayout: 'fixed',
        tableWidth: { width: 386, type: 'px' },
      },
      columnWidths: [86.8, 56.667, 56.667, 56.667, 56.667, 56.667],
      rows: [
        {
          id: 'row-1',
          cells: [
            { id: 'cell-1' },
            { id: 'cell-2' },
            { id: 'cell-3' },
            { id: 'cell-4' },
            { id: 'cell-5' },
            { id: 'cell-6' },
          ],
        },
      ],
    });

    const result = buildAutoFitWorkingGridInput(block, { maxWidth: 386 });

    expect(result.preserveAuthoredGrid).toBe(true);
  });

  it('does not mark incomplete fixed grids as authoritative', () => {
    const block = createTableBlock({
      attrs: {
        tableLayout: 'fixed',
        tableWidth: { width: 400, type: 'px' },
      },
      columnWidths: [120, 180],
      rows: [
        {
          id: 'row-1',
          cells: [{ id: 'cell-1' }, { id: 'cell-2' }, { id: 'cell-3' }],
        },
      ],
    });

    const result = buildAutoFitWorkingGridInput(block, { maxWidth: 600 });

    expect(result.preserveAuthoredGrid).toBeUndefined();
    expect(result.gridColumnCount).toBe(3);
  });

  it('does not mark complete fixed grids far under tblW as authoritative', () => {
    const block = createTableBlock({
      attrs: {
        tableLayout: 'fixed',
        tableWidth: { width: 500, type: 'px' },
      },
      columnWidths: [120, 180],
      rows: [
        {
          id: 'row-1',
          cells: [{ id: 'cell-1' }, { id: 'cell-2' }],
        },
      ],
    });

    const result = buildAutoFitWorkingGridInput(block, { maxWidth: 600 });

    expect(result.preserveAuthoredGrid).toBeUndefined();
  });

  it('marks complete non-uniform tblW auto grids as preferred AutoFit geometry', () => {
    const block = createTableBlock({
      attrs: {
        tableWidth: { value: 0, type: 'auto' },
      },
      columnWidths: [290, 152],
      rows: [
        {
          id: 'row-1',
          cells: [{ id: 'cell-1' }, { id: 'cell-2' }],
        },
      ],
    });

    const result = buildAutoFitWorkingGridInput(block, { maxWidth: 600 });

    expect(result.layoutMode).toBe('autofit');
    expect(result.preferredTableWidth).toBeUndefined();
    expect(result.preserveAutoGrid).toBe(true);
  });

  it('preserves the explicit-auto versus omitted-width distinction for overwide authored grids', () => {
    const buildOverwideGridInput = (attrs: TableBlock['attrs']) =>
      buildAutoFitWorkingGridInput(
        createTableBlock({
          attrs,
          columnWidths: [300, 340],
          rows: [
            {
              id: 'row-1',
              cells: [{ id: 'cell-1' }, { id: 'cell-2' }],
            },
          ],
        }),
        { maxWidth: 500 },
      );

    const explicitAuto = buildOverwideGridInput({
      tableWidth: { value: 0, type: 'auto' },
    });
    const omittedWidth = buildOverwideGridInput({});

    expect(explicitAuto).toMatchObject({
      layoutMode: 'autofit',
      maxTableWidth: 500,
      preferredTableWidth: undefined,
      preferredColumnWidths: [300, 340],
      gridColumnCount: 2,
    });
    expect(omittedWidth).toMatchObject({
      layoutMode: 'autofit',
      maxTableWidth: 500,
      preferredTableWidth: undefined,
      preferredColumnWidths: [300, 340],
      gridColumnCount: 2,
    });
    expect(explicitAuto).not.toEqual(omittedWidth);
  });

  it('stabilizes a complete uniform tblW auto grid without redundant tcW metadata', () => {
    const block = createTableBlock({
      attrs: {
        tableWidth: { value: 0, type: 'auto' },
      },
      columnWidths: [156, 156, 156, 156],
      rows: [
        {
          id: 'row-1',
          cells: [{ id: 'cell-1' }, { id: 'cell-2' }, { id: 'cell-3' }, { id: 'cell-4' }],
        },
      ],
    });

    const result = buildAutoFitWorkingGridInput(block, { maxWidth: 624 });

    expect(result.preserveAutoGrid).toBeUndefined();
    expect(result.stableAutoGrid).toBe(true);
    expect(result.gridColumnCount).toBe(4);
  });

  it('preserves the SD-3817 complete uniform tblW auto grid with matching tcW widths', () => {
    const columnCount = 9;
    const rowCount = 20;
    const columnWidthTwips = 1360;
    const columnWidthPx = columnWidthTwips / 15;
    const block = createTableBlock({
      attrs: {
        tableWidth: { value: 0, type: 'auto' },
      },
      columnWidths: Array.from({ length: columnCount }, () => columnWidthPx),
      rows: Array.from({ length: rowCount }, (_, rowIndex) => ({
        id: `row-${rowIndex}`,
        attrs: rowIndex === 0 ? { tableRowProperties: { header: 1 } } : {},
        cells: Array.from({ length: columnCount }, (_, columnIndex) => ({
          id: `cell-${rowIndex}-${columnIndex}`,
          attrs: {
            tableCellProperties: {
              cellWidth: { value: columnWidthTwips, type: 'dxa' },
            },
          },
        })),
      })),
    });

    const result = buildAutoFitWorkingGridInput(block, { maxWidth: columnCount * columnWidthPx });

    expect(result).toMatchObject({
      layoutMode: 'autofit',
      preserveAutoGrid: true,
      stableAutoGrid: true,
      gridColumnCount: columnCount,
      preferredColumnWidths: Array.from({ length: columnCount }, () => columnWidthPx),
    });
    expect(result.rows).toHaveLength(rowCount);
    expect(result.rows.every((row) => row.logicalColumnCount === columnCount)).toBe(true);
  });

  it('stabilizes a fitting complete tblW auto grid even when tcW preferences conflict', () => {
    // Repro for TABLES-FIDELITY-AUTOFIT-COMPLETE-GRID-AUTO-WIDTH-001:
    // 4×2160 twip (=4×144px) authored grid + non-uniform cell tcW totals to 748.8px
    // but the table must stay anchored to the 576px authored-grid total.
    const block = createTableBlock({
      attrs: {
        tableWidth: { value: 0, type: 'auto' },
      },
      columnWidths: [144, 144, 144, 144],
      rows: [
        {
          id: 'row-1',
          cells: [
            { id: 'cell-1', attrs: { tableCellProperties: { cellWidth: { value: 3600, type: 'dxa' } } } },
            { id: 'cell-2', attrs: { tableCellProperties: { cellWidth: { value: 1152, type: 'dxa' } } } },
            { id: 'cell-3', attrs: { tableCellProperties: { cellWidth: { value: 2160, type: 'dxa' } } } },
            { id: 'cell-4', attrs: { tableCellProperties: { cellWidth: { value: 4320, type: 'dxa' } } } },
          ],
        },
        {
          id: 'row-2',
          cells: [
            { id: 'cell-5', attrs: { tableCellProperties: { cellWidth: { value: 2160, type: 'dxa' } } } },
            { id: 'cell-6', attrs: { tableCellProperties: { cellWidth: { value: 2160, type: 'dxa' } } } },
            { id: 'cell-7', attrs: { tableCellProperties: { cellWidth: { value: 2160, type: 'dxa' } } } },
            { id: 'cell-8', attrs: { tableCellProperties: { cellWidth: { value: 2160, type: 'dxa' } } } },
          ],
        },
      ],
    });

    const result = buildAutoFitWorkingGridInput(block, { maxWidth: 576 });

    expect(result.layoutMode).toBe('autofit');
    expect(result.preferredTableWidth).toBeUndefined();
    expect(result.preferredColumnWidths).toEqual([144, 144, 144, 144]);
    expect(result.preserveAutoGrid).toBeUndefined();
    expect(result.stableAutoGrid).toBe(true);
    expect(result).toMatchObject({ autoGridWidthBudget: 576 });
  });

  it('records a fitting non-uniform tblW auto grid as the AutoFit width budget when tcW preferences overflow it', () => {
    const block = createTableBlock({
      attrs: {
        tableWidth: { value: 0, type: 'auto' },
      },
      columnWidths: [180, 120, 276],
      rows: [
        {
          id: 'row-1',
          cells: [
            { id: 'cell-1', attrs: { tableCellProperties: { cellWidth: { value: 3600, type: 'dxa' } } } },
            { id: 'cell-2', attrs: { tableCellProperties: { cellWidth: { value: 2160, type: 'dxa' } } } },
            { id: 'cell-3', attrs: { tableCellProperties: { cellWidth: { value: 5400, type: 'dxa' } } } },
          ],
        },
      ],
    });

    const result = buildAutoFitWorkingGridInput(block, { maxWidth: 576 });

    expect(result.preserveAutoGrid).toBe(true);
    expect(result.preferredColumnWidths).toEqual([180, 120, 276]);
    expect(result).toMatchObject({ autoGridWidthBudget: 576 });
  });

  it('uses a smaller fully specified row tcW total over a conflicting non-uniform tblW auto grid budget', () => {
    const block = createTableBlock({
      attrs: {
        tableWidth: { value: 0, type: 'auto' },
      },
      columnWidths: [122.13333333333333, 90.06666666666666, 90.06666666666666, 164, 119.13333333333333],
      rows: [
        {
          id: 'row-1',
          cells: [
            {
              id: 'cell-1',
              colSpan: 5,
              attrs: { tableCellProperties: { cellWidth: { value: 8600, type: 'dxa' } } },
            },
          ],
        },
        {
          id: 'row-2',
          cells: [
            { id: 'cell-2', attrs: { tableCellProperties: { cellWidth: { value: 1832, type: 'dxa' } } } },
            { id: 'cell-3', attrs: { tableCellProperties: { cellWidth: { value: 1351, type: 'dxa' } } } },
            { id: 'cell-4', attrs: { tableCellProperties: { cellWidth: { value: 1351, type: 'dxa' } } } },
            { id: 'cell-5', attrs: { tableCellProperties: { cellWidth: { value: 2460, type: 'dxa' } } } },
            { id: 'cell-6', attrs: { tableCellProperties: { cellWidth: { value: 1606, type: 'dxa' } } } },
          ],
        },
      ],
    });

    const result = buildAutoFitWorkingGridInput(block, { maxWidth: 624 });

    expect(result.preserveAutoGrid).toBe(true);
    expect(result.preferredColumnWidths).toEqual([
      122.13333333333333, 90.06666666666666, 90.06666666666666, 164, 119.13333333333333,
    ]);
    expect(result.autoGridWidthBudget).toBeCloseTo(573.3333333333334, 6);
  });

  it('does not create an AutoFit grid budget from fallback widths when tblW and tblGrid are omitted', () => {
    // Repro for TABLES-FIDELITY-AUTOFIT-OMITTED-WIDTH-NO-USABLE-GRID-001:
    // tblGrid is empty in OOXML; layout-adapter falls back to PM colwidth scaled up
    // to the page-content width (624). The first-row cell tcW values sum to
    // 519px, so the runtime must not anchor to the [312, 312] fallback grid.
    const block = createTableBlock({
      attrs: {},
      columnWidths: [312, 312],
      rows: [
        {
          id: 'row-1',
          cells: [
            { id: 'cell-1', attrs: { tableCellProperties: { cellWidth: { value: 3885, type: 'dxa' } } } },
            { id: 'cell-2', attrs: { tableCellProperties: { cellWidth: { value: 3900, type: 'dxa' } } } },
          ],
        },
      ],
    });

    const result = buildAutoFitWorkingGridInput(block, { maxWidth: 624 });

    expect(result.preserveAutoGrid).toBeUndefined();
    expect(result.stableAutoGrid).toBeUndefined();
    expect(result.gridColumnCount).toBe(2);
    expect(result.preferredTableWidth).toBeUndefined();
    expect(result.preferredColumnWidths).toEqual([312, 312]);
    expect(result.autoGridWidthBudget).toBeUndefined();
  });

  it('does not mark incomplete tblW auto grids as preferred AutoFit geometry', () => {
    const block = createTableBlock({
      attrs: {
        tableWidth: { value: 0, type: 'auto' },
      },
      columnWidths: [290],
      rows: [
        {
          id: 'row-1',
          cells: [{ id: 'cell-1' }, { id: 'cell-2' }],
        },
      ],
    });

    const result = buildAutoFitWorkingGridInput(block, { maxWidth: 600 });

    expect(result.preserveAutoGrid).toBeUndefined();
    expect(result.stableAutoGrid).toBeUndefined();
    expect(result.gridColumnCount).toBe(2);
  });

  it('marks complete explicit tblW AutoFit grids that match tblW as preferred geometry', () => {
    const block = createTableBlock({
      attrs: {
        tableWidth: { width: 652.867, type: 'px' },
      },
      columnWidths: [95.867, 472.533, 84.467],
      rows: [
        {
          id: 'row-1',
          cells: [{ id: 'cell-1' }, { id: 'cell-2' }, { id: 'cell-3' }],
        },
      ],
    });

    const result = buildAutoFitWorkingGridInput(block, { maxWidth: 800 });

    expect(result.layoutMode).toBe('autofit');
    expect(result.preferredTableWidth).toBe(652.867);
    expect(result.preserveExplicitAutoGrid).toBe(true);
  });

  it('does not mark explicit tblW AutoFit grids when the grid does not match tblW', () => {
    const block = createTableBlock({
      attrs: {
        tableWidth: { width: 600, type: 'px' },
      },
      columnWidths: [95.867, 472.533, 84.467],
      rows: [
        {
          id: 'row-1',
          cells: [{ id: 'cell-1' }, { id: 'cell-2' }, { id: 'cell-3' }],
        },
      ],
    });

    const result = buildAutoFitWorkingGridInput(block, { maxWidth: 800 });

    expect(result.preserveExplicitAutoGrid).toBeUndefined();
  });

  it('marks uniform explicit tblW AutoFit grids as preferred geometry when they match tblW', () => {
    const block = createTableBlock({
      attrs: {
        tableWidth: { width: 624, type: 'px' },
      },
      columnWidths: [156, 156, 156, 156],
      rows: [
        {
          id: 'row-1',
          cells: [
            { id: 'cell-1', attrs: { tableCellProperties: { cellWidth: { value: 2340, type: 'dxa' } } } },
            { id: 'cell-2', attrs: { tableCellProperties: { cellWidth: { value: 2340, type: 'dxa' } } } },
            { id: 'cell-3', attrs: { tableCellProperties: { cellWidth: { value: 2340, type: 'dxa' } } } },
            { id: 'cell-4', attrs: { tableCellProperties: { cellWidth: { value: 2340, type: 'dxa' } } } },
          ],
        },
      ],
    });

    const result = buildAutoFitWorkingGridInput(block, { maxWidth: 624 });

    expect(result.preserveExplicitAutoGrid).toBe(true);
  });

  it('does not mark uniform explicit tblW AutoFit grids with auto cell widths as preferred geometry', () => {
    const block = createTableBlock({
      attrs: {
        tableWidth: { width: 624, type: 'px' },
      },
      columnWidths: [156, 156, 156, 156],
      rows: [
        {
          id: 'row-1',
          cells: [
            { id: 'cell-1', attrs: { tableCellProperties: { cellWidth: { value: 0, type: 'auto' } } } },
            { id: 'cell-2', attrs: { tableCellProperties: { cellWidth: { value: 0, type: 'auto' } } } },
            { id: 'cell-3', attrs: { tableCellProperties: { cellWidth: { value: 0, type: 'auto' } } } },
            { id: 'cell-4', attrs: { tableCellProperties: { cellWidth: { value: 0, type: 'auto' } } } },
          ],
        },
      ],
    });

    const result = buildAutoFitWorkingGridInput(block, { maxWidth: 624 });

    expect(result.preserveExplicitAutoGrid).toBeUndefined();
  });

  it('trims trailing unused placeholder grid columns', () => {
    const block = createTableBlock({
      attrs: {
        tableLayout: 'fixed',
        tableWidth: { width: 386, type: 'px' },
      },
      columnWidths: [86.8, 56.667, 56.667, 56.667, 56.667, 56.667, 0.4],
      rows: [
        {
          id: 'row-1',
          cells: [
            { id: 'cell-1' },
            { id: 'cell-2' },
            { id: 'cell-3' },
            { id: 'cell-4' },
            { id: 'cell-5' },
            { id: 'cell-6' },
          ],
        },
      ],
    });

    const result = buildAutoFitWorkingGridInput(block, { maxWidth: 386 });

    expect(result.preferredColumnWidths).toEqual([86.8, 56.667, 56.667, 56.667, 56.667, 56.667]);
    expect(result.gridColumnCount).toBe(6);
  });

  it('ignores near-zero gridAfter placeholder columns', () => {
    const block = createTableBlock({
      attrs: {
        tableLayout: 'fixed',
        tableWidth: { width: 386, type: 'px' },
      },
      columnWidths: [86.8, 56.667, 56.667, 56.667, 56.667, 56.667, 0.4],
      rows: [
        {
          id: 'row-1',
          attrs: {
            tableRowProperties: {
              gridAfter: 1,
              wAfter: { value: 8, type: 'dxa' },
            },
          },
          cells: [
            { id: 'cell-1' },
            { id: 'cell-2' },
            { id: 'cell-3' },
            { id: 'cell-4' },
            { id: 'cell-5' },
            { id: 'cell-6' },
          ],
        },
        {
          id: 'row-2',
          cells: [{ id: 'cell-full-span', colSpan: 7 }],
        },
      ],
    });

    const result = buildAutoFitWorkingGridInput(block, { maxWidth: 386 });

    expect(result.rows[0].skippedAfter).toEqual([]);
    expect(result.rows[1].cells[0].span).toBe(6);
    expect(result.preferredColumnWidths).toEqual([86.8, 56.667, 56.667, 56.667, 56.667, 56.667]);
    expect(result.gridColumnCount).toBe(6);
  });

  it('keeps substantive gridAfter columns', () => {
    const block = createTableBlock({
      attrs: {
        tableLayout: 'fixed',
        tableWidth: { width: 400, type: 'px' },
      },
      columnWidths: [100, 100, 40],
      rows: [
        {
          id: 'row-1',
          attrs: {
            tableRowProperties: {
              gridAfter: 1,
              wAfter: { value: 600, type: 'dxa' },
            },
          },
          cells: [{ id: 'cell-1' }, { id: 'cell-2' }],
        },
      ],
    });

    const result = buildAutoFitWorkingGridInput(block, { maxWidth: 400 });

    expect(result.rows[0].skippedAfter).toHaveLength(1);
    expect(result.preferredColumnWidths).toEqual([100, 100, 40]);
    expect(result.gridColumnCount).toBe(3);
  });

  it('keeps trailing unused authored grid columns when they are not placeholders', () => {
    const block = createTableBlock({
      attrs: {
        tableLayout: 'fixed',
        tableWidth: { width: 400, type: 'px' },
      },
      columnWidths: [100, 100, 40],
      rows: [
        {
          id: 'row-1',
          cells: [{ id: 'cell-1' }, { id: 'cell-2' }],
        },
      ],
    });

    const result = buildAutoFitWorkingGridInput(block, { maxWidth: 400 });

    expect(result.preferredColumnWidths).toEqual([100, 100, 40]);
    expect(result.gridColumnCount).toBe(3);
  });

  it('normalizes omitted tblLayout to autofit mode', () => {
    const block = createTableBlock({
      rows: [{ id: 'row-1', cells: [{ id: 'cell-1', colSpan: 1 }] }],
    });

    const result = buildAutoFitWorkingGridInput(block, { maxWidth: 600 });

    expect(result.layoutMode).toBe('autofit');
  });

  it('normalizes the OOXML auto literal to autofit mode', () => {
    const block = createTableBlock({
      attrs: {
        tableLayout: 'auto',
      },
      rows: [{ id: 'row-1', cells: [{ id: 'cell-1', colSpan: 1 }] }],
    });

    const result = buildAutoFitWorkingGridInput(block, { maxWidth: 600 });

    expect(result.layoutMode).toBe('autofit');
  });

  it('turns row skips into real logical columns', () => {
    const block = createTableBlock({
      rows: [
        {
          id: 'row-1',
          attrs: {
            tableRowProperties: {
              gridBefore: 1,
              gridAfter: 2,
            },
          },
          cells: [{ id: 'cell-1', colSpan: 1 }],
        },
      ],
    });

    const result = buildAutoFitWorkingGridInput(block, { maxWidth: 600 });

    expect(result.rows[0].skippedBefore).toHaveLength(1);
    expect(result.rows[0].skippedAfter).toHaveLength(2);
    expect(result.rows[0].skippedBefore).toEqual([
      { columnIndex: 0, preferredWidth: undefined, minContentWidth: 0, maxContentWidth: 0 },
    ]);
    expect(result.rows[0].skippedAfter).toEqual([
      { columnIndex: 2, preferredWidth: undefined, minContentWidth: 0, maxContentWidth: 0 },
      { columnIndex: 3, preferredWidth: undefined, minContentWidth: 0, maxContentWidth: 0 },
    ]);
    expect(result.rows[0].skippedColumns).toEqual([
      { columnIndex: 0, preferredWidth: undefined, minContentWidth: 0, maxContentWidth: 0 },
      { columnIndex: 2, preferredWidth: undefined, minContentWidth: 0, maxContentWidth: 0 },
      { columnIndex: 3, preferredWidth: undefined, minContentWidth: 0, maxContentWidth: 0 },
    ]);
    expect(result.rows[0].cells).toEqual([{ cellId: 'cell-1', startColumn: 1, span: 1, preferredWidth: undefined }]);
    expect(result.gridColumnCount).toBe(4);
  });

  it('preserves wBefore and wAfter as preferred-width skipped-column seeds', () => {
    const block = createTableBlock({
      rows: [
        {
          id: 'row-1',
          attrs: {
            tableRowProperties: {
              gridBefore: 2,
              gridAfter: 1,
              wBefore: { value: 300, type: 'dxa' },
              wAfter: { value: 100, type: 'dxa' },
            },
          },
          cells: [{ id: 'cell-1', colSpan: 1 }],
        },
      ],
    });

    const result = buildAutoFitWorkingGridInput(block, { maxWidth: 600 });

    expect(result.rows[0].skippedBefore).toEqual([
      { columnIndex: 0, preferredWidth: 10, minContentWidth: 0, maxContentWidth: 0 },
      { columnIndex: 1, preferredWidth: 10, minContentWidth: 0, maxContentWidth: 0 },
    ]);
    expect(result.rows[0].skippedAfter).toEqual([
      { columnIndex: 3, preferredWidth: 100 / 15, minContentWidth: 0, maxContentWidth: 0 },
    ]);
  });

  it('preserves colspan cells as span-aware inputs', () => {
    const block = createTableBlock({
      rows: [
        {
          id: 'row-1',
          cells: [{ id: 'cell-1', colSpan: 3 }],
        },
      ],
    });

    const result = buildAutoFitWorkingGridInput(block, { maxWidth: 600 });

    expect(result.rows[0].cells).toEqual([{ cellId: 'cell-1', startColumn: 0, span: 3, preferredWidth: undefined }]);
    expect(result.gridColumnCount).toBe(3);
  });

  it('preserves preferred cell width metadata', () => {
    const block = createTableBlock({
      attrs: {
        tableWidth: { value: 2500, type: 'pct' },
      },
      rows: [
        {
          id: 'row-1',
          cells: [
            {
              id: 'cell-1',
              colSpan: 1,
              attrs: {
                tableCellProperties: {
                  cellWidth: { value: 1500, type: 'dxa' },
                },
              },
            },
            {
              id: 'cell-2',
              colSpan: 1,
              attrs: {
                tableCellProperties: {
                  cellWidth: { value: 2500, type: 'pct' },
                },
              },
            },
          ],
        },
      ],
    });

    const result = buildAutoFitWorkingGridInput(block, { maxWidth: 600 });

    expect(result.preferredTableWidth).toBe(300);
    expect(result.rows[0].cells).toEqual([
      { cellId: 'cell-1', startColumn: 0, span: 1, preferredWidth: 100 },
      { cellId: 'cell-2', startColumn: 1, span: 1, preferredWidth: 150 },
    ]);
  });

  it('surfaces a grid extension requirement when spans exceed current grid width', () => {
    const block = createTableBlock({
      columnWidths: [120],
      rows: [
        {
          id: 'row-1',
          cells: [{ id: 'cell-1', colSpan: 3 }],
        },
      ],
    });

    const result = buildAutoFitWorkingGridInput(block, { maxWidth: 600 });

    expect(result.preferredColumnWidths).toEqual([120]);
    expect(result.gridColumnCount).toBe(3);
  });

  it('produces explicit logical placement for mixed skips and spans', () => {
    const block = createTableBlock({
      rows: [
        {
          id: 'row-1',
          attrs: {
            tableRowProperties: {
              gridBefore: 1,
              gridAfter: 1,
              wBefore: { value: 150, type: 'dxa' },
            },
          },
          cells: [
            { id: 'cell-1', colSpan: 2 },
            { id: 'cell-2', colSpan: 1 },
          ],
        },
      ],
    });

    const result = buildAutoFitWorkingGridInput(block, { maxWidth: 600 });

    expect(result.rows[0]).toMatchObject({
      logicalColumnCount: 5,
      skippedColumns: [
        { columnIndex: 0, preferredWidth: 10 },
        { columnIndex: 4, preferredWidth: undefined },
      ],
      cells: [
        { cellId: 'cell-1', startColumn: 1, span: 2, preferredWidth: undefined },
        { cellId: 'cell-2', startColumn: 3, span: 1, preferredWidth: undefined },
      ],
    });
  });

  it('skips columns occupied by active rowspans when placing later-row cells', () => {
    const block = createTableBlock({
      rows: [
        {
          id: 'row-1',
          cells: [
            { id: 'cell-1', colSpan: 1, rowSpan: 2 },
            { id: 'cell-2', colSpan: 1 },
          ],
        },
        {
          id: 'row-2',
          cells: [
            {
              id: 'cell-3',
              colSpan: 1,
              attrs: {
                tableCellProperties: {
                  cellWidth: { value: 1500, type: 'dxa' },
                },
              },
            },
          ],
        },
      ],
    });

    const result = buildAutoFitWorkingGridInput(block, { maxWidth: 600 });

    expect(result.rows[0].cells).toEqual([
      { cellId: 'cell-1', startColumn: 0, span: 1, preferredWidth: undefined },
      { cellId: 'cell-2', startColumn: 1, span: 1, preferredWidth: undefined },
    ]);
    expect(result.rows[1]).toMatchObject({
      logicalColumnCount: 2,
      cells: [{ cellId: 'cell-3', startColumn: 1, span: 1, preferredWidth: 100 }],
    });
    expect(result.gridColumnCount).toBe(2);
  });
});
