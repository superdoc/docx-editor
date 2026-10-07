import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { renderTableRow } from './renderTableRow.js';

const renderTableCellMock = vi.fn(() => ({ cellElement: document.createElement('div') }));

const makeParagraph = (trackedChangesMode?: string, trackedChangesEnabled?: boolean) => ({
  kind: 'paragraph',
  id: 'p1',
  runs: [],
  attrs: { trackedChangesMode, trackedChangesEnabled },
});

vi.mock('./renderTableCell.js', () => ({
  renderTableCell: (args: unknown) => renderTableCellMock(args),
}));

describe('renderTableRow', () => {
  let doc: Document;
  let container: HTMLElement;

  beforeEach(() => {
    doc = document.implementation.createHTMLDocument('table-row');
    container = doc.createElement('div');
    renderTableCellMock.mockClear();
  });

  const createDeps = (overrides: Record<string, unknown> = {}) => ({
    doc,
    container,
    rowIndex: 3,
    y: 0,
    rowMeasure: {
      height: 20,
      cells: [{ width: 100, height: 20, gridColumnStart: 0, colSpan: 1, rowSpan: 1 }],
    },
    row: {
      id: 'row-1',
      cells: [{ id: 'cell-1', blocks: [{ kind: 'paragraph', id: 'p1', runs: [] }] }],
    },
    totalRows: 10,
    tableBorders: {
      top: { style: 'single', width: 1, color: '#000000' },
      bottom: { style: 'single', width: 1, color: '#000000' },
      left: { style: 'single', width: 1, color: '#000000' },
      right: { style: 'single', width: 1, color: '#000000' },
      insideH: { style: 'single', width: 1, color: '#111111' },
      insideV: { style: 'single', width: 1, color: '#222222' },
    },
    columnWidths: [100],
    allRowHeights: [20, 20, 20, 20, 20, 20, 20, 20, 20, 20],
    tableIndent: 0,
    context: { sectionIndex: 0, pageIndex: 0, columnIndex: 0 },
    renderLine: () => doc.createElement('div'),
    applySdtDataset: () => {},
    cellSpacingPx: 6,
    ...overrides,
  });

  const getRenderedCellCall = (): { borders?: { top?: unknown; right?: unknown; bottom?: unknown; left?: unknown } } =>
    renderTableCellMock.mock.calls[0][0] as {
      borders?: { top?: unknown; right?: unknown; bottom?: unknown; left?: unknown };
    };

  it('carries a diagonal-only cell border through row resolution into paint', () => {
    const tl2br = { style: 'single', width: 4 / 3, color: '#000080' };
    renderTableRow(
      createDeps({
        tableBorders: undefined,
        row: { id: 'row-1', cells: [{ id: 'cell-1', attrs: { borders: { tl2br } }, blocks: [] }] },
      }) as never,
    );

    expect((renderTableCellMock.mock.calls[0][0] as { borders: { tl2br: unknown } }).borders.tl2br).toEqual(tl2br);
    expect(container.querySelector('[data-side="tl2br"]')).not.toBeNull();
  });

  it('keeps table top, insideH, and bottom borders when RTL cells define only diagonals', () => {
    const outer = { style: 'single' as const, width: 2 / 3, color: '#000000' };
    const redDivider = { style: 'single' as const, width: 4, color: '#FF0000' };
    const diagonal = { style: 'single' as const, width: 2 / 3, color: '#000000' };
    const tableBorders = { top: outer, bottom: outer, insideH: redDivider };
    const rowMeasure = { height: 20, cells: [{ width: 100, height: 20, gridColumnStart: 0, colSpan: 1, rowSpan: 1 }] };
    const firstRow = {
      id: 'first',
      cells: [{ id: 'a', attrs: { borders: { tl2br: diagonal, tr2bl: diagonal } }, blocks: [] }],
    };
    const secondRow = {
      id: 'second',
      cells: [{ id: 'b', attrs: { borders: { tl2br: diagonal, tr2bl: diagonal } }, blocks: [] }],
    };

    renderTableRow(
      createDeps({
        rowIndex: 0,
        totalRows: 2,
        cellSpacingPx: 0,
        isRtl: true,
        tableBorders,
        rowMeasure,
        row: firstRow,
        nextRow: secondRow,
        nextRowMeasure: rowMeasure,
      }) as never,
    );
    expect(getRenderedCellCall().borders?.top).toEqual(outer);

    renderTableCellMock.mockClear();
    renderTableRow(
      createDeps({
        rowIndex: 1,
        totalRows: 2,
        cellSpacingPx: 0,
        isRtl: true,
        tableBorders,
        rowMeasure,
        row: secondRow,
        prevRow: firstRow,
        prevRowMeasure: rowMeasure,
      }) as never,
    );
    expect(getRenderedCellCall().borders?.top).toEqual(redDivider);
    expect(getRenderedCellCall().borders?.bottom).toEqual(outer);
  });

  it('does not draw insideH on top edge for continuation fragments with cell spacing', () => {
    renderTableRow(createDeps({ continuesFromPrev: true }) as never);

    expect(renderTableCellMock).toHaveBeenCalledTimes(1);
    const call = getRenderedCellCall();
    expect(call.borders?.top).toBeUndefined();
    expect(call.borders?.bottom).toBeDefined();
  });

  it('does not draw insideH on bottom edge before continuation with cell spacing', () => {
    renderTableRow(createDeps({ continuesOnNext: true }) as never);

    expect(renderTableCellMock).toHaveBeenCalledTimes(1);
    const call = getRenderedCellCall();
    expect(call.borders?.top).toBeDefined();
    expect(call.borders?.bottom).toBeUndefined();
  });

  it('applies the table right border to a merged cell that spans the final column in collapsed mode', () => {
    renderTableRow(
      createDeps({
        rowIndex: 0,
        totalRows: 5,
        cellSpacingPx: 0,
        columnWidths: [100, 100],
        rowMeasure: {
          height: 20,
          cells: [{ width: 200, height: 20, gridColumnStart: 0, colSpan: 2, rowSpan: 1 }],
        },
      }) as never,
    );

    expect(renderTableCellMock).toHaveBeenCalledTimes(1);
    const call = getRenderedCellCall();
    expect(call.borders?.right).toBeDefined();
    expect(call.borders?.left).toBeDefined();
  });

  it('falls back to the table right border when an explicit-border cell spans the final column', () => {
    renderTableRow(
      createDeps({
        rowIndex: 0,
        totalRows: 5,
        cellSpacingPx: 0,
        columnWidths: [100, 100],
        rowMeasure: {
          height: 20,
          cells: [{ width: 200, height: 20, gridColumnStart: 0, colSpan: 2, rowSpan: 1 }],
        },
        row: {
          id: 'row-1',
          cells: [
            {
              id: 'cell-1',
              attrs: {
                borders: {
                  top: { style: 'single', width: 2, color: '#123456' },
                },
              },
              blocks: [{ kind: 'paragraph', id: 'p1', runs: [] }],
            },
          ],
        },
      }) as never,
    );

    expect(renderTableCellMock).toHaveBeenCalledTimes(1);
    const call = getRenderedCellCall();
    expect(call.borders?.top).toBeDefined();
    expect(call.borders?.right).toBeDefined();
  });

  // SD-3028: a tblPrEx override on the row BELOW that suppresses the shared horizontal edge
  // (insideH none/nil) means the lower cell — which owns that interior edge in the single-owner
  // model — won't draw it. When the upper row's border comes from the table/style (no cell
  // tcBorder for the neighbor path to pick up), the grid bottom would be dropped. §17.4.66
  // (present beats none) requires the upper row to close the grid by drawing its own insideH.
  const collapsedStyleRow = (overrides: Record<string, unknown> = {}) =>
    createDeps({
      rowIndex: 0,
      totalRows: 6,
      cellSpacingPx: 0,
      ...overrides,
    });
  const noneBorder = { none: true };
  const allNoneOverride = {
    id: 'row-next',
    attrs: {
      borders: {
        top: noneBorder,
        bottom: noneBorder,
        left: noneBorder,
        right: noneBorder,
        insideH: noneBorder,
        insideV: noneBorder,
      },
    },
    cells: [{ id: 'cell-next', blocks: [{ kind: 'paragraph', id: 'pn', runs: [] }] }],
  };

  it('closes the grid by drawing its own bottom when the next row suppresses the shared edge (tblPrEx none)', () => {
    renderTableRow(collapsedStyleRow({ nextRow: allNoneOverride }) as never);

    expect(renderTableCellMock).toHaveBeenCalledTimes(1);
    const call = getRenderedCellCall();
    expect(call.borders?.bottom).toBeDefined();
    expect((call.borders?.bottom as { style?: string })?.style).toBe('single');
  });

  it('does not draw an interior bottom when the next row has no override (lower cell owns it, no doubling)', () => {
    renderTableRow(collapsedStyleRow() as never);

    expect(renderTableCellMock).toHaveBeenCalledTimes(1);
    const call = getRenderedCellCall();
    expect(call.borders?.bottom).toBeUndefined();
  });

  it('does not draw an interior bottom when the next row override keeps a present shared edge', () => {
    renderTableRow(
      collapsedStyleRow({
        nextRow: {
          id: 'row-next',
          attrs: { borders: { insideH: { style: 'single', width: 1, color: '#D9D9D9' } } },
          cells: [{ id: 'cell-next', blocks: [{ kind: 'paragraph', id: 'pn', runs: [] }] }],
        },
      }) as never,
    );

    expect(renderTableCellMock).toHaveBeenCalledTimes(1);
    const call = getRenderedCellCall();
    expect(call.borders?.bottom).toBeUndefined();
  });

  it('draws its own interior right border when the right neighbor is borderless (asymmetric, no doubling)', () => {
    renderTableRow(
      createDeps({
        rowIndex: 0,
        totalRows: 1,
        cellSpacingPx: 0,
        columnWidths: [100, 100],
        rowMeasure: {
          height: 20,
          cells: [
            { width: 100, height: 20, gridColumnStart: 0, colSpan: 1, rowSpan: 1 },
            { width: 100, height: 20, gridColumnStart: 1, colSpan: 1, rowSpan: 1 },
          ],
        },
        row: {
          id: 'row-1',
          cells: [
            {
              id: 'cell-1',
              attrs: {
                borders: {
                  top: { style: 'single', width: 2, color: '#123456' },
                  right: { style: 'single', width: 2, color: '#123456' },
                  bottom: { style: 'single', width: 2, color: '#123456' },
                  left: { style: 'single', width: 2, color: '#123456' },
                },
              },
              blocks: [{ kind: 'paragraph', id: 'p1', runs: [] }],
            },
            {
              id: 'cell-2',
              blocks: [{ kind: 'paragraph', id: 'p2', runs: [] }],
            },
          ],
        },
      }) as never,
    );

    expect(renderTableCellMock).toHaveBeenCalledTimes(2);
    const firstCall = renderTableCellMock.mock.calls[0][0] as { borders?: { right?: unknown; left?: unknown } };
    const secondCall = renderTableCellMock.mock.calls[1][0] as { borders?: { left?: unknown } };

    // Asymmetric edge: only cell-1 declares a right border (cell-2 is borderless), so cell-1
    // owns and paints it on itself; cell-2 does NOT redraw the shared edge, so it's drawn once.
    expect(firstCall.borders?.right).toBeDefined();
    expect(firstCall.borders?.left).toBeDefined();
    expect(secondCall.borders?.left).toBeUndefined();
  });

  // SD-3028: "some borders" tables set a cell's shared vertical edge to w:val="nil" on BOTH
  // sides to remove a divider, while the table style (TableGrid) defines insideV. The explicit
  // nil on both cells must suppress the divider (§17.4.66); it must NOT fall back to insideV.
  const twoCellRow = (cell0Borders: unknown, cell1Borders: unknown) =>
    createDeps({
      rowIndex: 0,
      totalRows: 1,
      cellSpacingPx: 0,
      columnWidths: [100, 100],
      rowMeasure: {
        height: 20,
        cells: [
          { width: 100, height: 20, gridColumnStart: 0, colSpan: 1, rowSpan: 1 },
          { width: 100, height: 20, gridColumnStart: 1, colSpan: 1, rowSpan: 1 },
        ],
      },
      row: {
        id: 'row-1',
        cells: [
          { id: 'cell-1', attrs: { borders: cell0Borders }, blocks: [{ kind: 'paragraph', id: 'p1', runs: [] }] },
          { id: 'cell-2', attrs: { borders: cell1Borders }, blocks: [{ kind: 'paragraph', id: 'p2', runs: [] }] },
        ],
      },
    });
  const noneSpec = { style: 'none' as const, width: 0 };
  const bottomOnly = {
    top: noneSpec,
    right: noneSpec,
    bottom: { style: 'single' as const, width: 1, color: '#000000' },
    left: noneSpec,
  };

  it('suppresses an interior vertical divider when BOTH adjacent cells set the shared edge to nil', () => {
    renderTableRow(twoCellRow(bottomOnly, bottomOnly) as never);

    expect(renderTableCellMock).toHaveBeenCalledTimes(2);
    const secondCall = renderTableCellMock.mock.calls[1][0] as { borders?: { left?: unknown } };
    expect(secondCall.borders?.left).toBeUndefined();
  });

  it('still inherits the table insideV divider when only ONE side is explicitly nil (the other is unset)', () => {
    // cell-2 left = nil, cell-1 right = unset (inherits insideV, present) -> §17.4.66 present wins.
    renderTableRow(twoCellRow({ bottom: { style: 'single', width: 1, color: '#000000' } }, bottomOnly) as never);

    expect(renderTableCellMock).toHaveBeenCalledTimes(2);
    const secondCall = renderTableCellMock.mock.calls[1][0] as { borders?: { left?: unknown } };
    expect(secondCall.borders?.left).toBeDefined();
  });

  it('keeps a uniform double-border rectangle on one cell so its corners can join', () => {
    const redDouble = { style: 'double' as const, width: 2, color: '#C00000' };
    const ring = { top: redDouble, right: redDouble, bottom: redDouble, left: redDouble };
    renderTableRow(
      createDeps({
        rowIndex: 1,
        totalRows: 3,
        cellSpacingPx: 0,
        columnWidths: [100, 100],
        rowMeasure: {
          height: 20,
          cells: [
            { width: 100, height: 20, gridColumnStart: 0, colSpan: 1, rowSpan: 1 },
            { width: 100, height: 20, gridColumnStart: 1, colSpan: 1, rowSpan: 1 },
          ],
        },
        row: {
          id: 'row-1',
          cells: [
            { id: 'cell-1', attrs: { borders: ring }, blocks: [{ kind: 'paragraph', id: 'p1', runs: [] }] },
            {
              id: 'cell-2',
              attrs: { borders: { left: redDouble } },
              blocks: [{ kind: 'paragraph', id: 'p2', runs: [] }],
            },
          ],
        },
      }) as never,
    );

    const firstCall = renderTableCellMock.mock.calls[0][0] as { borders?: typeof ring };
    const secondCall = renderTableCellMock.mock.calls[1][0] as { borders?: typeof ring };
    expect(firstCall.borders).toMatchObject(ring);
    expect(secondCall.borders?.left).toBeUndefined();
  });

  it('defers a mirrored top edge to the complete double-border cell above', () => {
    const redDouble = { style: 'double' as const, width: 2, color: '#C00000' };
    const ring = { top: redDouble, right: redDouble, bottom: redDouble, left: redDouble };
    renderTableRow(
      createDeps({
        rowIndex: 1,
        totalRows: 3,
        cellSpacingPx: 0,
        prevRowMeasure: {
          height: 20,
          cells: [{ width: 100, height: 20, gridColumnStart: 0, colSpan: 1, rowSpan: 1 }],
        },
        prevRow: {
          id: 'row-0',
          cells: [{ id: 'cell-0', attrs: { borders: ring }, blocks: [{ kind: 'paragraph', id: 'p0', runs: [] }] }],
        },
        row: {
          id: 'row-1',
          cells: [
            {
              id: 'cell-1',
              attrs: { borders: { top: redDouble } },
              blocks: [{ kind: 'paragraph', id: 'p1', runs: [] }],
            },
          ],
        },
      }) as never,
    );

    expect(getRenderedCellCall().borders?.top).toBeUndefined();
  });

  // SD-1797: a single row's measure only lists cells that START in it, so on a w:vMerge
  // (rowspan) continuation row the columns held by a cell spanning from above look empty.
  // `rowOccupiedRightCol` / `nextRowOccupiedRightCol` count that occupancy so the single-owner
  // edge ownership doesn't misfire (a leftmost cell drawing a right border, or a covered column
  // mistaken for a gridAfter gap) and double the shared edge.
  const sparseRow = (overrides: Record<string, unknown> = {}) =>
    createDeps({
      rowIndex: 2,
      totalRows: 6,
      cellSpacingPx: 0,
      columnWidths: [100, 100, 100, 100],
      rowMeasure: { height: 20, cells: [{ width: 100, height: 20, gridColumnStart: 0, colSpan: 1, rowSpan: 1 }] },
      row: { id: 'row-x', cells: [{ id: 'c', blocks: [{ kind: 'paragraph', id: 'p', runs: [] }] }] },
      ...overrides,
    });

  it('does not draw a right border on a leftmost cell of a rowspan-continuation row', () => {
    // Columns 1-3 are covered by a vMerge cell spanning from above (rowOccupiedRightCol = 4),
    // so this leftmost cell is NOT the rightmost column and must not draw insideV as its right.
    renderTableRow(sparseRow({ rowOccupiedRightCol: 4 }) as never);

    const call = getRenderedCellCall();
    expect(call.borders?.right).toBeUndefined();
    expect(call.borders?.left).toBeDefined();
  });

  it('does not treat a rowspan-covered column below a spanning cell as a gridAfter gap', () => {
    // A cell spanning all 4 columns; the row below is fully covered (occupancy 4) -> no gap,
    // so the spanning cell does NOT draw its own bottom (the cell below owns the shared edge).
    renderTableRow(
      sparseRow({
        rowMeasure: { height: 20, cells: [{ width: 400, height: 20, gridColumnStart: 0, colSpan: 4, rowSpan: 1 }] },
        nextRowOccupiedRightCol: 4,
      }) as never,
    );

    const call = getRenderedCellCall();
    expect(call.borders?.bottom).toBeUndefined();
  });

  it('still treats a genuine gridAfter gap as a bottom boundary (SD-3345 preserved)', () => {
    // The cell spans all 4 columns but the row below only reaches column 2 (real gridAfter gap),
    // so the spanning cell must draw its own bottom across the uncovered span.
    renderTableRow(
      sparseRow({
        rowMeasure: { height: 20, cells: [{ width: 400, height: 20, gridColumnStart: 0, colSpan: 4, rowSpan: 1 }] },
        nextRowOccupiedRightCol: 2,
      }) as never,
    );

    const call = getRenderedCellCall();
    expect(call.borders?.bottom).toBeDefined();
  });

  it('does not paint interior bottom border for explicit cell borders in collapsed mode on non-final row', () => {
    const explicit = {
      top: { style: 'single' as const, width: 2, color: '#123456' },
      right: { style: 'single' as const, width: 2, color: '#123456' },
      bottom: { style: 'single' as const, width: 2, color: '#123456' },
      left: { style: 'single' as const, width: 2, color: '#123456' },
    };
    renderTableRow(
      createDeps({
        rowIndex: 2,
        totalRows: 5,
        cellSpacingPx: 0,
        columnWidths: [100],
        rowMeasure: {
          height: 20,
          cells: [{ width: 100, height: 20, gridColumnStart: 0, colSpan: 1, rowSpan: 1 }],
        },
        row: {
          id: 'row-1',
          cells: [
            {
              id: 'cell-1',
              attrs: { borders: explicit },
              blocks: [{ kind: 'paragraph', id: 'p1', runs: [] }],
            },
          ],
        },
      }) as never,
    );

    expect(renderTableCellMock).toHaveBeenCalledTimes(1);
    const call = getRenderedCellCall();
    expect(call.borders?.bottom).toBeUndefined();
    expect(call.borders?.top).toBeDefined();
  });

  it('applies the table bottom border to a rowspan cell that reaches the final row', () => {
    renderTableRow(
      createDeps({
        rowIndex: 3,
        totalRows: 5,
        cellSpacingPx: 0,
        columnWidths: [100, 100],
        rowMeasure: {
          height: 20,
          cells: [{ width: 100, height: 20, gridColumnStart: 1, colSpan: 1, rowSpan: 2 }],
        },
      }) as never,
    );

    expect(renderTableCellMock).toHaveBeenCalledTimes(1);
    const call = getRenderedCellCall();
    expect(call.borders?.bottom).toBeDefined();
  });

  describe('row-level border override (w:tblPrEx)', () => {
    const D9 = { style: 'single' as const, width: 1, color: '#D9D9D9' };
    const rowBorderOverride = { top: D9, right: D9, bottom: D9, left: D9, insideH: D9, insideV: D9 };

    it('applies the row border override over the table borders for that row', () => {
      renderTableRow(
        createDeps({
          rowIndex: 0,
          totalRows: 1,
          cellSpacingPx: 0,
          columnWidths: [100],
          rowMeasure: {
            height: 20,
            cells: [{ width: 100, height: 20, gridColumnStart: 0, colSpan: 1, rowSpan: 1 }],
          },
          row: {
            id: 'row-1',
            cells: [{ id: 'cell-1', blocks: [{ kind: 'paragraph', id: 'p1', runs: [] }] }],
            attrs: { borders: rowBorderOverride },
          },
        }) as never,
      );

      const call = getRenderedCellCall();
      // Single cell touches all edges; the row override (#D9D9D9) wins over the
      // default table borders (#000000) on every side.
      expect(call.borders?.top).toEqual(D9);
      expect(call.borders?.right).toEqual(D9);
      expect(call.borders?.bottom).toEqual(D9);
      expect(call.borders?.left).toEqual(D9);
    });

    it('draws the row override even when the table borders are explicitly none (FWC form rows)', () => {
      const none = { none: true as const };
      renderTableRow(
        createDeps({
          rowIndex: 1,
          totalRows: 3,
          cellSpacingPx: 0,
          columnWidths: [100],
          tableBorders: { top: none, right: none, bottom: none, left: none, insideH: none, insideV: none },
          rowMeasure: {
            height: 20,
            cells: [{ width: 100, height: 20, gridColumnStart: 0, colSpan: 1, rowSpan: 1 }],
          },
          row: {
            id: 'row-1',
            cells: [{ id: 'cell-1', blocks: [{ kind: 'paragraph', id: 'p1', runs: [] }] }],
            attrs: { borders: rowBorderOverride },
          },
        }) as never,
      );

      const call = getRenderedCellCall();
      // Table says borderless, but this row's tblPrEx draws #D9D9D9. Top is an
      // interior edge (row 1 of 3) → resolves from the override's insideH.
      expect(call.borders?.top).toEqual(D9);
      expect(call.borders?.left).toEqual(D9);
    });

    it('leaves table borders unchanged for a row without an override (callout row)', () => {
      renderTableRow(
        createDeps({
          rowIndex: 0,
          totalRows: 1,
          cellSpacingPx: 0,
          columnWidths: [100],
          rowMeasure: {
            height: 20,
            cells: [{ width: 100, height: 20, gridColumnStart: 0, colSpan: 1, rowSpan: 1 }],
          },
          row: {
            id: 'row-1',
            cells: [{ id: 'cell-1', blocks: [{ kind: 'paragraph', id: 'p1', runs: [] }] }],
            // no attrs.borders — falls through to the table borders
          },
        }) as never,
      );

      const call = getRenderedCellCall();
      // Regression guard: absent a row override, the cell still paints the table
      // border (#000000), not the #D9D9D9 override from the other tests.
      expect(call.borders?.top).toEqual({ style: 'single', width: 1, color: '#000000' });
    });
  });

  describe('trailing gridAfter columns (w:gridAfter)', () => {
    it('draws the right border on the rightmost real cell when gridAfter pads the grid', () => {
      // FWC form pattern: two content columns + one trailing gridAfter spacer column.
      // The rightmost real cell (col 1) does not reach totalCols (3), but it is the
      // row's right edge, so it must own the table/row right border (Word behaviour).
      renderTableRow(
        createDeps({
          rowIndex: 0,
          totalRows: 1,
          cellSpacingPx: 0,
          columnWidths: [100, 100, 20], // col 2 is the empty gridAfter spacer
          rowMeasure: {
            height: 20,
            cells: [
              { width: 100, height: 20, gridColumnStart: 0, colSpan: 1, rowSpan: 1 },
              { width: 100, height: 20, gridColumnStart: 1, colSpan: 1, rowSpan: 1 },
            ],
          },
          row: {
            id: 'row-1',
            cells: [
              { id: 'c0', blocks: [{ kind: 'paragraph', id: 'p0', runs: [] }] },
              { id: 'c1', blocks: [{ kind: 'paragraph', id: 'p1', runs: [] }] },
            ],
          },
        }) as never,
      );

      expect(renderTableCellMock).toHaveBeenCalledTimes(2);
      const rightCell = renderTableCellMock.mock.calls[1][0] as { borders?: { right?: unknown } };
      // The default table borders include a single right border; the rightmost
      // real cell now owns it despite the trailing gridAfter column.
      expect(rightCell.borders?.right).toBeDefined();
    });
  });

  describe('collapsed cell-border conflict resolution (ECMA-376 §17.4.66, SD-3345)', () => {
    const B = { style: 'single' as const, width: 1.333, color: '#BDD7EE' };
    const allSides = { top: B, right: B, bottom: B, left: B };

    it('gives the shared edge below a double ring to a higher-weight dot-dash border', () => {
      const double = { style: 'double' as const, width: 1, color: '#1F3864' };
      const dotDash = { style: 'dotDash' as const, width: 1, color: '#E55A2A' };
      const measure = { height: 20, cells: [{ width: 100, height: 20, gridColumnStart: 0, colSpan: 1, rowSpan: 1 }] };
      const upper = {
        id: 'upper',
        cells: [
          {
            id: 'double',
            attrs: { borders: { top: double, right: double, bottom: double, left: double } },
            blocks: [],
          },
        ],
      };
      const lower = { id: 'lower', cells: [{ id: 'dot-dash', attrs: { borders: { top: dotDash } }, blocks: [] }] };

      renderTableRow(
        createDeps({
          rowIndex: 0,
          totalRows: 2,
          cellSpacingPx: 0,
          tableBorders: undefined,
          rowMeasure: measure,
          row: upper,
          nextRow: lower,
          nextRowMeasure: measure,
        }) as never,
      );
      expect(getRenderedCellCall().borders?.bottom).toBeUndefined();

      renderTableCellMock.mockClear();
      renderTableRow(
        createDeps({
          rowIndex: 1,
          totalRows: 2,
          cellSpacingPx: 0,
          tableBorders: undefined,
          rowMeasure: measure,
          row: lower,
          prevRow: upper,
          prevRowMeasure: measure,
        }) as never,
      );
      expect(getRenderedCellCall().borders?.top).toEqual(dotDash);
    });

    it('keeps an authored dashSmallGap top above E.2 P when the preceding cell has a single bottom', () => {
      const single = { style: 'single' as const, width: 2 / 3, color: '#000000' };
      const smallGap = { style: 'dashSmallGap' as const, width: 2 / 3, color: '#000000' };
      const measure = { height: 20, cells: [{ width: 100, height: 20, gridColumnStart: 0, colSpan: 1, rowSpan: 1 }] };
      const upper = { id: 'previous', cells: [{ id: 'P-above', attrs: { borders: { bottom: single } }, blocks: [] }] };
      const lower = { id: 'E.2', cells: [{ id: 'P', attrs: { borders: { top: smallGap } }, blocks: [] }] };
      renderTableRow(
        createDeps({
          rowIndex: 1,
          totalRows: 3,
          cellSpacingPx: 0,
          tableBorders: undefined,
          rowMeasure: measure,
          row: lower,
          prevRow: upper,
          prevRowMeasure: measure,
        }) as never,
      );
      expect(getRenderedCellCall().borders?.top).toEqual(smallGap);
    });

    it('resolves a merged double-ring bottom across both lower cells', () => {
      const double = { style: 'double' as const, width: 1, color: '#1F3864' };
      const dotDash = { style: 'dotDash' as const, width: 1, color: '#E55A2A' };
      const single = { style: 'single' as const, width: 1, color: '#000000' };
      const upperMeasure = {
        height: 20,
        cells: [{ width: 200, height: 20, gridColumnStart: 0, colSpan: 2, rowSpan: 1 }],
      };
      const lowerMeasure = {
        height: 20,
        cells: [
          { width: 100, height: 20, gridColumnStart: 0, colSpan: 1, rowSpan: 1 },
          { width: 100, height: 20, gridColumnStart: 1, colSpan: 1, rowSpan: 1 },
        ],
      };
      const upper = {
        id: 'upper',
        cells: [
          { id: 'ring', attrs: { borders: { top: double, right: double, bottom: double, left: double } }, blocks: [] },
        ],
      };
      const lower = {
        id: 'lower',
        cells: [
          { id: 'strong', attrs: { borders: { top: dotDash } }, blocks: [] },
          { id: 'weak', attrs: { borders: { top: single } }, blocks: [] },
        ],
      };

      renderTableRow(
        createDeps({
          rowIndex: 0,
          totalRows: 2,
          cellSpacingPx: 0,
          tableBorders: undefined,
          columnWidths: [100, 100],
          rowMeasure: upperMeasure,
          row: upper,
          nextRow: lower,
          nextRowMeasure: lowerMeasure,
        }) as never,
      );
      expect(getRenderedCellCall().borders?.bottom).toBeUndefined();

      renderTableCellMock.mockClear();
      renderTableRow(
        createDeps({
          rowIndex: 1,
          totalRows: 2,
          cellSpacingPx: 0,
          tableBorders: undefined,
          columnWidths: [100, 100],
          rowMeasure: lowerMeasure,
          row: lower,
          prevRow: upper,
          prevRowMeasure: upperMeasure,
        }) as never,
      );
      expect((renderTableCellMock.mock.calls[0][0] as { borders: { top: unknown } }).borders.top).toEqual(dotDash);
      expect((renderTableCellMock.mock.calls[1][0] as { borders: { top: unknown } }).borders.top).toEqual(double);
    });

    it('draws a shared interior vertical edge once (no doubling) for adjacent cells with identical borders', () => {
      // The M&A checklist case: no table-level borders, every cell has all 4 sides.
      renderTableRow(
        createDeps({
          rowIndex: 0,
          totalRows: 2,
          cellSpacingPx: 0,
          columnWidths: [100, 100],
          tableBorders: undefined,
          rowMeasure: {
            height: 20,
            cells: [
              { width: 100, height: 20, gridColumnStart: 0, colSpan: 1, rowSpan: 1 },
              { width: 100, height: 20, gridColumnStart: 1, colSpan: 1, rowSpan: 1 },
            ],
          },
          row: {
            id: 'r',
            cells: [
              { id: 'c0', attrs: { borders: allSides }, blocks: [{ kind: 'paragraph', id: 'p0', runs: [] }] },
              { id: 'c1', attrs: { borders: allSides }, blocks: [{ kind: 'paragraph', id: 'p1', runs: [] }] },
            ],
          },
        }) as never,
      );
      const left = renderTableCellMock.mock.calls[0][0] as { borders?: { right?: unknown } };
      const right = renderTableCellMock.mock.calls[1][0] as { borders?: { left?: unknown } };
      // Single-owner: the left cell's interior RIGHT is suppressed; the right cell draws
      // the shared edge as its LEFT (the §17.4.66 winner). So the edge is drawn exactly once.
      expect(left.borders?.right).toBeUndefined();
      expect(right.borders?.left).toBeDefined();
    });

    it('keeps BOTH side borders on a cell whose neighbors are borderless (SD-3345 RTL start/end)', () => {
      // The RTL tcBorders fixture in logical space: the first cell declares left (start) AND
      // right (end) borders; the other cells are borderless. Both must stay on that cell —
      // after the downstream RTL swap they become visual-right (start) and visual-left (end),
      // not move onto a borderless neighbor. (Regression: single-owner used to delegate the
      // interior right, dropping the cell's own end border.)
      const start = { style: 'single' as const, width: 2, color: '#FF0000' };
      const end = { style: 'single' as const, width: 2, color: '#0000FF' };
      renderTableRow(
        createDeps({
          rowIndex: 0,
          totalRows: 1,
          cellSpacingPx: 0,
          columnWidths: [100, 100, 100],
          tableBorders: undefined,
          rowMeasure: {
            height: 20,
            cells: [
              { width: 100, height: 20, gridColumnStart: 0, colSpan: 1, rowSpan: 1 },
              { width: 100, height: 20, gridColumnStart: 1, colSpan: 1, rowSpan: 1 },
              { width: 100, height: 20, gridColumnStart: 2, colSpan: 1, rowSpan: 1 },
            ],
          },
          row: {
            id: 'r',
            cells: [
              {
                id: 'c0',
                attrs: { borders: { left: start, right: end } },
                blocks: [{ kind: 'paragraph', id: 'p0', runs: [] }],
              },
              { id: 'c1', attrs: {}, blocks: [{ kind: 'paragraph', id: 'p1', runs: [] }] },
              { id: 'c2', attrs: {}, blocks: [{ kind: 'paragraph', id: 'p2', runs: [] }] },
            ],
          },
        }) as never,
      );
      const c0 = renderTableCellMock.mock.calls[0][0] as { borders?: { left?: unknown; right?: unknown } };
      expect(c0.borders?.left).toMatchObject({ color: '#FF0000' });
      expect(c0.borders?.right).toMatchObject({ color: '#0000FF' });
    });

    it('keeps the above cell bottom border when this cell has no top (asymmetric → no dropped line)', () => {
      // The it1007 regression case: header has a bottom border, the body cell below has no top.
      const black = { style: 'single' as const, width: 1, color: '#000000' };
      renderTableRow(
        createDeps({
          rowIndex: 1,
          totalRows: 2,
          cellSpacingPx: 0,
          columnWidths: [100],
          tableBorders: undefined,
          rowMeasure: { height: 20, cells: [{ width: 100, height: 20, gridColumnStart: 0, colSpan: 1, rowSpan: 1 }] },
          row: {
            id: 'r1',
            // body cell: borders on left/right/bottom but NOT top
            cells: [
              {
                id: 'cb',
                attrs: { borders: { left: black, right: black, bottom: black } },
                blocks: [{ kind: 'paragraph', id: 'pb', runs: [] }],
              },
            ],
          },
          prevRow: {
            id: 'r0',
            cells: [
              {
                id: 'ch',
                attrs: { borders: { top: black, left: black, right: black, bottom: black } },
                blocks: [{ kind: 'paragraph', id: 'ph', runs: [] }],
              },
            ],
          },
          prevRowMeasure: {
            height: 20,
            cells: [{ width: 100, height: 20, gridColumnStart: 0, colSpan: 1, rowSpan: 1 }],
          },
        }) as never,
      );
      const cell = renderTableCellMock.mock.calls[0][0] as { borders?: { top?: unknown } };
      // This cell has no top border, but the cell above has a bottom border → §17.4.66
      // rule 1 keeps the present border, drawn here as this cell's top.
      expect(cell.borders?.top).toMatchObject({ style: 'single', color: '#000000' });
    });

    it('paints the above cell bottom border on a fully BORDERLESS row below it (SD-2969 clause-header)', () => {
      // The SD-2969 case: a clause-header row has top+bottom borders; the row directly
      // below it has NO border attribute at all. Single-owner gives the shared edge to
      // the lower cell, so without the §17.4.66 fallback the header's bottom border is
      // dropped entirely (the cell above suppressed its own bottom, the borderless cell
      // below never drew it).
      const black = { style: 'single' as const, width: 1, color: '#000000' };
      renderTableRow(
        createDeps({
          rowIndex: 1,
          totalRows: 2,
          cellSpacingPx: 0,
          columnWidths: [100],
          tableBorders: undefined,
          rowMeasure: { height: 8, cells: [{ width: 100, height: 8, gridColumnStart: 0, colSpan: 1, rowSpan: 1 }] },
          row: {
            id: 'r1',
            // borderless cell: no `borders` attribute at all
            cells: [{ id: 'cs', attrs: {}, blocks: [{ kind: 'paragraph', id: 'ps', runs: [] }] }],
          },
          prevRow: {
            id: 'r0',
            cells: [
              {
                id: 'ch',
                attrs: { borders: { top: black, left: black, right: black, bottom: black } },
                blocks: [{ kind: 'paragraph', id: 'ph', runs: [] }],
              },
            ],
          },
          prevRowMeasure: {
            height: 20,
            cells: [{ width: 100, height: 20, gridColumnStart: 0, colSpan: 1, rowSpan: 1 }],
          },
        }) as never,
      );
      const cell = renderTableCellMock.mock.calls[0][0] as { borders?: { top?: unknown } };
      expect(cell.borders?.top).toMatchObject({ style: 'single', color: '#000000' });
    });

    it('draws its own bottom border when the next row leaves a gridAfter gap under it (SD-3345 callout corner)', () => {
      // SD-3345 23_notification: the callout cell spans the full grid (gridSpan), but the
      // row below has a gridAfter so its real cells do not reach the callout's rightmost
      // column. Single-owner would defer the callout's bottom to the row below, which then
      // stops short of the right edge → a gap at the bottom-right corner. The callout must
      // draw its own bottom across the uncovered span instead.
      const blue = { style: 'single' as const, width: 1, color: '#342D8C' };
      renderTableRow(
        createDeps({
          rowIndex: 0,
          totalRows: 2,
          cellSpacingPx: 0,
          columnWidths: [100, 100],
          tableBorders: undefined,
          // full-width callout cell (spans both columns)
          rowMeasure: { height: 20, cells: [{ width: 200, height: 20, gridColumnStart: 0, colSpan: 2, rowSpan: 1 }] },
          row: {
            id: 'r0',
            cells: [
              {
                id: 'callout',
                attrs: { borders: { top: blue, left: blue, right: blue, bottom: blue } },
                blocks: [{ kind: 'paragraph', id: 'p0', runs: [] }],
              },
            ],
          },
          // next row covers only col0 (col1 is a gridAfter spacer → not a real cell)
          nextRowMeasure: {
            height: 20,
            cells: [{ width: 100, height: 20, gridColumnStart: 0, colSpan: 1, rowSpan: 1 }],
          },
        }) as never,
      );
      const cell = renderTableCellMock.mock.calls[0][0] as { borders?: { bottom?: unknown } };
      expect(cell.borders?.bottom).toMatchObject({ style: 'single', color: '#342D8C' });
    });

    it('suppresses this row top border when the cell above spans past it (gridAfter) so the edge is drawn once', () => {
      // The companion to the case above: when the spanning cell owns the shared bottom edge,
      // the narrower row below must NOT also draw its top, or the two adjacent cell divs stack
      // into a doubled line (this painter has no border-collapse). (SD-3345 callout)
      const blue = { style: 'single' as const, width: 1, color: '#342D8C' };
      renderTableRow(
        createDeps({
          rowIndex: 1,
          totalRows: 2,
          cellSpacingPx: 0,
          columnWidths: [100, 100],
          tableBorders: undefined,
          // this row covers only col0 (col1 is its gridAfter spacer)
          rowMeasure: { height: 20, cells: [{ width: 100, height: 20, gridColumnStart: 0, colSpan: 1, rowSpan: 1 }] },
          row: {
            id: 'r1',
            cells: [{ id: 'opt', attrs: {}, blocks: [{ kind: 'paragraph', id: 'po', runs: [] }] }],
          },
          // the cell above spans BOTH columns and has a bottom border (it owns the shared edge)
          prevRow: {
            id: 'r0',
            cells: [
              {
                id: 'callout',
                attrs: { borders: { top: blue, left: blue, right: blue, bottom: blue } },
                blocks: [{ kind: 'paragraph', id: 'p0', runs: [] }],
              },
            ],
          },
          prevRowMeasure: {
            height: 20,
            cells: [{ width: 200, height: 20, gridColumnStart: 0, colSpan: 2, rowSpan: 1 }],
          },
        }) as never,
      );
      const cell = renderTableCellMock.mock.calls[0][0] as { borders?: { top?: unknown } } | undefined;
      expect(cell?.borders?.top).toBeUndefined();
    });
  });

  describe('RTL table (isRtl)', () => {
    it('mirrors cell x positions so first logical column is on the right', () => {
      renderTableRow(
        createDeps({
          isRtl: true,
          rowIndex: 0,
          totalRows: 1,
          cellSpacingPx: 0,
          columnWidths: [100, 150, 200],
          rowMeasure: {
            height: 20,
            cells: [
              { width: 100, height: 20, gridColumnStart: 0, colSpan: 1, rowSpan: 1 },
              { width: 150, height: 20, gridColumnStart: 1, colSpan: 1, rowSpan: 1 },
              { width: 200, height: 20, gridColumnStart: 2, colSpan: 1, rowSpan: 1 },
            ],
          },
          row: {
            id: 'row-1',
            cells: [
              { id: 'c1', blocks: [] },
              { id: 'c2', blocks: [] },
              { id: 'c3', blocks: [] },
            ],
          },
        }) as never,
      );

      expect(renderTableCellMock).toHaveBeenCalledTimes(3);
      const calls = renderTableCellMock.mock.calls.map((c: unknown[]) => c[0] as { x: number; cellWidth: number });
      // Total = 100+150+200 = 450. Col 0 (w=100): x = 450-0-100 = 350
      expect(calls[0].x).toBe(350);
      // Col 1 (w=150): x = 450-100-150 = 200
      expect(calls[1].x).toBe(200);
      // Col 2 (w=200): x = 450-250-200 = 0
      expect(calls[2].x).toBe(0);
    });

    it('passes isRtl to renderTableCell', () => {
      renderTableRow(
        createDeps({
          isRtl: true,
          cellSpacingPx: 0,
          columnWidths: [100],
          rowMeasure: {
            height: 20,
            cells: [{ width: 100, height: 20, gridColumnStart: 0, colSpan: 1, rowSpan: 1 }],
          },
        }) as never,
      );

      const call = renderTableCellMock.mock.calls[0][0] as { isRtl: boolean };
      expect(call.isRtl).toBe(true);
    });

    it('swaps resolved border left↔right for RTL cells', () => {
      renderTableRow(
        createDeps({
          isRtl: true,
          rowIndex: 0,
          totalRows: 1,
          cellSpacingPx: 0,
          columnWidths: [100],
          tableBorders: {
            top: { style: 'single', width: 1, color: '#000000' },
            bottom: { style: 'single', width: 1, color: '#000000' },
            left: { style: 'single', width: 3, color: '#0000FF' },
            right: { style: 'single', width: 0.5, color: '#FF0000' },
          },
          rowMeasure: {
            height: 20,
            cells: [{ width: 100, height: 20, gridColumnStart: 0, colSpan: 1, rowSpan: 1 }],
          },
        }) as never,
      );

      const call = getRenderedCellCall();
      // Single cell touches both edges. Resolver: left=table.left(blue), right=table.right(red).
      // After RTL swap: CSS left=red, CSS right=blue
      expect(call.borders?.right).toEqual({ style: 'single', width: 3, color: '#0000FF' });
      expect(call.borders?.left).toEqual({ style: 'single', width: 0.5, color: '#FF0000' });
    });

    it('mirrors correctly with non-zero cellSpacing and colspan', () => {
      renderTableRow(
        createDeps({
          isRtl: true,
          rowIndex: 0,
          totalRows: 1,
          cellSpacingPx: 4,
          columnWidths: [100, 100, 100],
          rowMeasure: {
            height: 20,
            cells: [
              { width: 200, height: 20, gridColumnStart: 0, colSpan: 2, rowSpan: 1 },
              { width: 100, height: 20, gridColumnStart: 2, colSpan: 1, rowSpan: 1 },
            ],
          },
          row: {
            id: 'row-1',
            cells: [
              { id: 'c1', blocks: [] },
              { id: 'c2', blocks: [] },
            ],
          },
        }) as never,
      );

      expect(renderTableCellMock).toHaveBeenCalledTimes(2);
      const calls = renderTableCellMock.mock.calls.map((c: unknown[]) => c[0] as { x: number; cellWidth: number });
      // totalWidth = 4 + 100 + 4 + 100 + 4 + 100 + 4 = 316
      // Col 0 (colspan=2, w=200): ltrX = 4, rtlX = 316 - 4 - 200 = 112
      expect(calls[0].x).toBe(112);
      // Col 2 (w=100): ltrX = 4+100+4+100+4 = 212, rtlX = 316 - 212 - 100 = 4
      expect(calls[1].x).toBe(4);
    });
  });

  describe('structural row tracked changes', () => {
    const trackedRowDeps = (
      kind: 'insert' | 'delete',
      mode: string,
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> =>
      createDeps({
        rowIndex: 0,
        totalRows: 1,
        cellSpacingPx: 0,
        columnWidths: [100, 100],
        rowMeasure: {
          height: 20,
          cells: [
            { width: 100, height: 20, gridColumnStart: 0, colSpan: 1, rowSpan: 1 },
            { width: 100, height: 20, gridColumnStart: 1, colSpan: 1, rowSpan: 1 },
          ],
        },
        row: {
          id: 'row-1',
          attrs: {
            trackedChange: { kind, id: `row-tc-${kind}`, author: 'Alice', color: '#abcdef' },
          },
          cells: [
            { id: 'c1', blocks: [makeParagraph(mode, true)] },
            { id: 'c2', blocks: [makeParagraph(mode, true)] },
          ],
        },
        ...overrides,
      });

    it('adds the insert class + author-color vars to every cell element of an inserted row', () => {
      renderTableRow(trackedRowDeps('insert', 'review') as never);

      const cells = Array.from(container.children) as HTMLElement[];
      expect(cells).toHaveLength(2);
      for (const cell of cells) {
        expect(cell.classList.contains('track-insert-dec')).toBe(true);
        expect(cell.classList.contains('highlighted')).toBe(true);
        expect(cell.classList.contains('track-row-cell-dec')).toBe(true);
        expect(cell.style.getPropertyValue('--sd-tracked-changes-insert-border')).toBe('#abcdef');
        expect(cell.dataset.trackChangeKind).toBe('insert');
        expect(cell.dataset.trackChangeStructural).toBe('row');
      }
    });

    it('stamps row-level semantic metadata and leaves paint to the CSS category variables', () => {
      renderTableRow(
        trackedRowDeps('insert', 'review', {
          row: {
            id: 'row-1',
            attrs: {
              trackedChange: {
                kind: 'insert',
                id: 'row-tc-ins',
                author: 'Alice',
                color: '#abcdef',
                semanticColorKey: 'table-row-insertion',
                type: 'structural',
                subtype: 'table-row-insertion',
                targetKind: 'row',
              },
            },
            cells: [
              { id: 'c1', blocks: [makeParagraph('review', true)] },
              { id: 'c2', blocks: [makeParagraph('review', true)] },
            ],
          },
        }) as never,
      );

      const cells = Array.from(container.children) as HTMLElement[];
      expect(cells).toHaveLength(2);
      for (const cell of cells) {
        expect(cell.classList.contains('table-row-insertion')).toBe(true);
        expect(cell.dataset.trackChangeSemanticColorKey).toBe('table-row-insertion');
        expect(cell.dataset.trackChangeTargetKind).toBe('row');
        expect(cell.dataset.trackChangeAuthorColor).toBe('#abcdef');
        // CSS-only category: the stylesheet rules keyed on the semantic
        // dataset own the color (`--sd-tracked-changes-table-row-insertion-*`).
        // No inline variable may be stamped — an inline var would beat any
        // host `:root` CSS override.
        expect(cell.style.getPropertyValue('--sd-tracked-changes-insert-border')).toBe('');
        expect(cell.style.getPropertyValue('--sd-tracked-changes-insert-background-focused')).toBe('');
        expect(cell.style.getPropertyValue('--sd-tracked-changes-semantic-color')).toBe('');
      }
    });

    it('stamps table-level semantic metadata through the row carrier without inline color vars', () => {
      renderTableRow(
        trackedRowDeps('delete', 'review', {
          row: {
            id: 'row-1',
            attrs: {
              trackedChange: {
                kind: 'delete',
                id: 'table-tc-del',
                color: '#abcdef',
                semanticColorKey: 'table-deletion',
                type: 'structural',
                subtype: 'table-deletion',
                targetKind: 'table',
              },
            },
            cells: [
              { id: 'c1', blocks: [makeParagraph('review', true)] },
              { id: 'c2', blocks: [makeParagraph('review', true)] },
            ],
          },
        }) as never,
      );

      const cells = Array.from(container.children) as HTMLElement[];
      expect(cells).toHaveLength(2);
      for (const cell of cells) {
        expect(cell.classList.contains('table-deletion')).toBe(true);
        expect(cell.dataset.trackChangeId).toBe('table-tc-del');
        expect(cell.dataset.trackChangeSemanticColorKey).toBe('table-deletion');
        expect(cell.dataset.trackChangeTargetKind).toBe('table');
        // CSS-only category: no inline delete-family vars, even from the
        // author color — `--sd-tracked-changes-table-deletion-*` owns paint.
        expect(cell.style.getPropertyValue('--sd-tracked-changes-delete-border')).toBe('');
        expect(cell.style.getPropertyValue('--sd-tracked-changes-delete-text')).toBe('');
      }
    });

    it('keeps the row-category class when overlapping cell metadata overwrites the semantic dataset', () => {
      renderTableRow(
        trackedRowDeps('insert', 'review', {
          row: {
            id: 'row-1',
            attrs: {
              trackedChange: {
                kind: 'insert',
                id: 'row-tc-ins',
                author: 'Alice',
                semanticColorKey: 'table-row-insertion',
                type: 'structural',
                subtype: 'table-row-insertion',
                targetKind: 'row',
              },
            },
            cells: [
              {
                id: 'c1',
                attrs: {
                  trackedChange: {
                    kind: 'insert',
                    id: 'cell-tc-ins',
                    author: 'Alice',
                    semanticColorKey: 'table-cell-insertion',
                    type: 'structural',
                    subtype: 'table-cell-insertion',
                    targetKind: 'cell',
                  },
                },
                blocks: [makeParagraph('review', true)],
              },
              { id: 'c2', blocks: [makeParagraph('review', true)] },
            ],
          },
        }) as never,
      );

      const cells = Array.from(container.children) as HTMLElement[];
      expect(cells).toHaveLength(2);
      const overlapped = cells[0]!;
      // The single-valued semantic dataset is overwritten by the cell key —
      // which is exactly why the CSS-only category rules key on the CLASS:
      // classes accumulate, so the row category paint (and any host
      // `--sd-tracked-changes-table-row-insertion-*` override) still applies.
      expect(overlapped.dataset.trackChangeSemanticColorKey).toBe('table-cell-insertion');
      expect(overlapped.classList.contains('table-row-insertion')).toBe(true);
      expect(overlapped.classList.contains('table-cell-insertion')).toBe(true);
      // Row precedence: the same-kind cell change must not stamp inline
      // insert-family vars over the CSS-owned row category paint.
      expect(overlapped.style.getPropertyValue('--sd-tracked-changes-insert-border')).toBe('');
      // The non-overlapped cell keeps plain row-carrier metadata.
      expect(cells[1]!.dataset.trackChangeSemanticColorKey).toBe('table-row-insertion');
      expect(cells[1]!.classList.contains('table-row-insertion')).toBe(true);
    });

    it('adds the delete class + author-color vars to every cell element of a deleted row', () => {
      renderTableRow(trackedRowDeps('delete', 'review') as never);

      const cells = Array.from(container.children) as HTMLElement[];
      expect(cells).toHaveLength(2);
      for (const cell of cells) {
        expect(cell.classList.contains('track-delete-dec')).toBe(true);
        expect(cell.classList.contains('highlighted')).toBe(true);
        expect(cell.style.getPropertyValue('--sd-tracked-changes-delete-text')).toBe('#abcdef');
      }
    });

    it("hides an inserted row in 'original' mode (cells get the hidden modifier)", () => {
      renderTableRow(trackedRowDeps('insert', 'original') as never);

      const cells = Array.from(container.children) as HTMLElement[];
      for (const cell of cells) {
        expect(cell.classList.contains('track-insert-dec')).toBe(true);
        expect(cell.classList.contains('hidden')).toBe(true);
        expect(cell.classList.contains('highlighted')).toBe(false);
      }
    });

    it("hides a deleted row in 'final' mode (cells get the hidden modifier)", () => {
      renderTableRow(trackedRowDeps('delete', 'final') as never);

      const cells = Array.from(container.children) as HTMLElement[];
      for (const cell of cells) {
        expect(cell.classList.contains('track-delete-dec')).toBe(true);
        expect(cell.classList.contains('hidden')).toBe(true);
      }
    });

    it('leaves cells of an untracked row undecorated', () => {
      renderTableRow(createDeps() as never);

      const cells = Array.from(container.children) as HTMLElement[];
      for (const cell of cells) {
        expect(cell.classList.contains('track-insert-dec')).toBe(false);
        expect(cell.classList.contains('track-delete-dec')).toBe(false);
        expect(cell.classList.contains('track-row-cell-dec')).toBe(false);
      }
    });
  });

  describe('structural cell tracked changes (SD-3481)', () => {
    const trackedCellDeps = (
      cellMeta: Record<string, unknown>,
      mode: string,
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> =>
      createDeps({
        rowIndex: 0,
        totalRows: 1,
        cellSpacingPx: 0,
        columnWidths: [100, 100],
        rowMeasure: {
          height: 20,
          cells: [
            { width: 100, height: 20, gridColumnStart: 0, colSpan: 1, rowSpan: 1 },
            { width: 100, height: 20, gridColumnStart: 1, colSpan: 1, rowSpan: 1 },
          ],
        },
        row: {
          id: 'row-1',
          cells: [
            { id: 'c1', attrs: { trackedChange: cellMeta }, blocks: [makeParagraph(mode, true)] },
            { id: 'c2', blocks: [makeParagraph(mode, true)] },
          ],
        },
        ...overrides,
      });

    it('paints an inserted cell with the cell marker class, broad class, semantic vars and datasets', () => {
      renderTableRow(
        trackedCellDeps(
          {
            kind: 'insert',
            id: 'cell-tc-ins',
            author: 'Bob',
            color: '#abcdef',
            semanticColorKey: 'table-cell-insertion',
            semanticColor: '#1f6feb',
          },
          'review',
        ) as never,
      );

      const cells = Array.from(container.children) as HTMLElement[];
      expect(cells).toHaveLength(2);
      const [tracked, untracked] = cells;

      expect(tracked.classList.contains('track-insert-dec')).toBe(true);
      expect(tracked.classList.contains('track-cell-dec')).toBe(true);
      expect(tracked.classList.contains('highlighted')).toBe(true);
      expect(tracked.classList.contains('table-cell-insertion')).toBe(true);
      // Cell-level marker only — never the row marker.
      expect(tracked.classList.contains('track-row-cell-dec')).toBe(false);
      // Cell-structural semantic categories own their visual variable.
      expect(tracked.style.getPropertyValue('--sd-tracked-changes-insert-border')).toBe('#1f6feb');
      expect(tracked.style.getPropertyValue('--sd-tracked-changes-insert-background-focused')).toBe('#1f6feb44');
      expect(tracked.dataset.trackChangeKind).toBe('insert');
      expect(tracked.dataset.trackChangeStructural).toBe('cell');
      expect(tracked.dataset.trackChangeSemanticColorKey).toBe('table-cell-insertion');
      expect(tracked.dataset.trackChangeSemanticColor).toBe('#1f6feb');
      // Author color preserved, not repurposed.
      expect(tracked.dataset.trackChangeAuthorColor).toBe('#abcdef');

      expect(untracked.classList.contains('track-insert-dec')).toBe(false);
      expect(untracked.classList.contains('track-cell-dec')).toBe(false);
    });

    it('paints a deleted cell with the delete class, marker, and semantic delete vars', () => {
      renderTableRow(
        trackedCellDeps(
          {
            kind: 'delete',
            id: 'cell-tc-del',
            author: 'Bob',
            color: '#abcdef',
            semanticColorKey: 'table-cell-deletion',
            semanticColor: '#cb0e47',
          },
          'review',
        ) as never,
      );

      const tracked = container.children[0] as HTMLElement;
      expect(tracked.classList.contains('track-delete-dec')).toBe(true);
      expect(tracked.classList.contains('track-cell-dec')).toBe(true);
      expect(tracked.classList.contains('table-cell-deletion')).toBe(true);
      expect(tracked.style.getPropertyValue('--sd-tracked-changes-delete-border')).toBe('#cb0e47');
      expect(tracked.style.getPropertyValue('--sd-tracked-changes-delete-text')).toBe('#cb0e47');
      expect(tracked.dataset.trackChangeStructural).toBe('cell');
      expect(tracked.dataset.trackChangeSemanticColorKey).toBe('table-cell-deletion');
    });

    it('paints a cell-merge through the format variable family with subtype/target/anchor metadata', () => {
      renderTableRow(
        trackedCellDeps(
          {
            kind: 'format',
            id: 'cell-tc-merge',
            author: 'Bob',
            color: '#abcdef',
            semanticColorKey: 'cell-merge',
            semanticColor: '#d4a72c',
            type: 'cellMerge',
            subtype: 'cell-merge',
            targetKind: 'cell',
            semanticAnchorScope: 'direct',
          },
          'review',
        ) as never,
      );

      const tracked = container.children[0] as HTMLElement;
      expect(tracked.classList.contains('track-format-dec')).toBe(true);
      expect(tracked.classList.contains('track-cell-dec')).toBe(true);
      expect(tracked.classList.contains('cell-merge')).toBe(true);
      expect(tracked.style.getPropertyValue('--sd-tracked-changes-format-border')).toBe('#d4a72c');
      expect(tracked.dataset.trackChangeSemanticColorKey).toBe('cell-merge');
      expect(tracked.dataset.trackChangeType).toBe('cellMerge');
      expect(tracked.dataset.trackChangeSubtype).toBe('cell-merge');
      expect(tracked.dataset.trackChangeTargetKind).toBe('cell');
      expect(tracked.dataset.trackChangeSemanticAnchorScope).toBe('direct');
    });

    it('paints a cell-split through the format variable family carrying affected-range anchor metadata', () => {
      renderTableRow(
        trackedCellDeps(
          {
            kind: 'format',
            id: 'cell-tc-split',
            semanticColorKey: 'cell-split',
            semanticColor: '#f4964f',
            subtype: 'cell-split',
            targetKind: 'cell',
            semanticAnchorScope: 'affected-range',
          },
          'review',
        ) as never,
      );

      const tracked = container.children[0] as HTMLElement;
      expect(tracked.classList.contains('track-format-dec')).toBe(true);
      expect(tracked.classList.contains('cell-split')).toBe(true);
      expect(tracked.style.getPropertyValue('--sd-tracked-changes-format-border')).toBe('#f4964f');
      expect(tracked.style.getPropertyValue('--sd-tracked-changes-format-background-focused')).toBe('#f4964f44');
      expect(tracked.dataset.trackChangeSemanticColorKey).toBe('cell-split');
      expect(tracked.dataset.trackChangeSemanticAnchorScope).toBe('affected-range');
    });

    it('suppresses cell-level painting when tracked changes are off', () => {
      renderTableRow(
        trackedCellDeps(
          {
            kind: 'insert',
            id: 'cell-tc-off',
            semanticColorKey: 'table-cell-insertion',
            semanticColor: '#1f6feb',
          },
          'off',
        ) as never,
      );

      const tracked = container.children[0] as HTMLElement;
      expect(tracked.classList.contains('track-insert-dec')).toBe(false);
      expect(tracked.classList.contains('track-cell-dec')).toBe(false);
      expect(tracked.classList.contains('table-cell-insertion')).toBe(false);
      expect(tracked.style.getPropertyValue('--sd-tracked-changes-insert-border')).toBe('');
    });

    it('keeps both structural markers and gives the row precedence on shared datasets when both exist', () => {
      renderTableRow(
        trackedCellDeps(
          {
            kind: 'insert',
            id: 'cell-tc-ins',
            author: 'Bob',
            color: '#abcdef',
            semanticColorKey: 'table-cell-insertion',
            semanticColor: '#1f6feb',
          },
          'review',
          {
            row: {
              id: 'row-1',
              attrs: {
                trackedChange: { kind: 'insert', id: 'row-tc-ins', author: 'Alice', color: '#fedcba' },
              },
              cells: [
                {
                  id: 'c1',
                  attrs: {
                    trackedChange: {
                      kind: 'insert',
                      id: 'cell-tc-ins',
                      author: 'Bob',
                      color: '#abcdef',
                      semanticColorKey: 'table-cell-insertion',
                      semanticColor: '#1f6feb',
                    },
                  },
                  blocks: [makeParagraph('review', true)],
                },
                { id: 'c2', blocks: [makeParagraph('review', true)] },
              ],
            },
          },
        ) as never,
      );

      const tracked = container.children[0] as HTMLElement;
      // Neither structural marker is dropped.
      expect(tracked.classList.contains('track-row-cell-dec')).toBe(true);
      expect(tracked.classList.contains('track-cell-dec')).toBe(true);
      expect(tracked.classList.contains('table-cell-insertion')).toBe(true);
      // Row precedence on the shared single-value datasets.
      expect(tracked.dataset.trackChangeId).toBe('row-tc-ins');
      expect(tracked.dataset.trackChangeStructural).toBe('row cell');
      expect(tracked.dataset.trackChangeAuthorColor).toBe('#fedcba');
      // Row keeps ownership of the color variable family (cell does not clobber it).
      expect(tracked.style.getPropertyValue('--sd-tracked-changes-insert-border')).toBe('#fedcba');
      // Cell-level semantic datasets are still stamped (namespaced, no collision).
      expect(tracked.dataset.trackChangeSemanticColorKey).toBe('table-cell-insertion');
      expect(tracked.dataset.trackChangeSemanticColor).toBe('#1f6feb');
    });

    it('preserves row vars while stamping independent cell vars when row and cell kinds differ', () => {
      renderTableRow(
        trackedCellDeps(
          {
            kind: 'format',
            id: 'cell-tc-merge',
            author: 'Bob',
            color: '#abcdef',
            semanticColorKey: 'cell-merge',
            semanticColor: '#d4a72c',
          },
          'review',
          {
            row: {
              id: 'row-1',
              attrs: {
                trackedChange: { kind: 'insert', id: 'row-tc-ins', author: 'Alice', color: '#fedcba' },
              },
              cells: [
                {
                  id: 'c1',
                  attrs: {
                    trackedChange: {
                      kind: 'format',
                      id: 'cell-tc-merge',
                      author: 'Bob',
                      color: '#abcdef',
                      semanticColorKey: 'cell-merge',
                      semanticColor: '#d4a72c',
                    },
                  },
                  blocks: [makeParagraph('review', true)],
                },
                { id: 'c2', blocks: [makeParagraph('review', true)] },
              ],
            },
          },
        ) as never,
      );

      const tracked = container.children[0] as HTMLElement;
      expect(tracked.classList.contains('track-row-cell-dec')).toBe(true);
      expect(tracked.classList.contains('track-cell-dec')).toBe(true);
      expect(tracked.classList.contains('track-insert-dec')).toBe(true);
      expect(tracked.classList.contains('track-format-dec')).toBe(true);
      expect(tracked.classList.contains('cell-merge')).toBe(true);
      // Row keeps ownership of shared row datasets and the insert variable family.
      expect(tracked.dataset.trackChangeId).toBe('row-tc-ins');
      expect(tracked.dataset.trackChangeAuthorColor).toBe('#fedcba');
      expect(tracked.style.getPropertyValue('--sd-tracked-changes-insert-border')).toBe('#fedcba');
      // Different cell kind gets its independent semantic variable family.
      expect(tracked.style.getPropertyValue('--sd-tracked-changes-format-border')).toBe('#d4a72c');
      expect(tracked.style.getPropertyValue('--sd-tracked-changes-format-background-focused')).toBe('#d4a72c44');
      expect(tracked.dataset.trackChangeSemanticColorKey).toBe('cell-merge');
      expect(tracked.dataset.trackChangeSemanticColor).toBe('#d4a72c');
    });
  });
});
