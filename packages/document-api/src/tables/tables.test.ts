import { describe, expect, it, mock } from 'bun:test';
import {
  executeRowLocatorOp,
  executeTablesApplyStyle,
  executeTablesSetBorders,
  executeTablesSetTableOptions,
  executeTablesSortOp,
  normalizeTablesSplitInput,
} from './tables.js';
import { DocumentApiValidationError } from '../errors.js';
import type { TablesSortInput } from '../types/table-operations.types.js';

const MOCK_ADAPTER = mock(() => ({ success: true }));
const nodeId = 'table-1';

describe('executeTablesSortOp', () => {
  const keys: TablesSortInput['keys'] = [{ columnIndex: 0, direction: 'ascending', type: 'text' }];

  for (const skipHeaderRows of [undefined, 0, 2, Number.MAX_SAFE_INTEGER]) {
    it(`forwards skipHeaderRows ${String(skipHeaderRows)} and normalized mutation options`, () => {
      const adapter = mock(() => ({ success: true }));
      const input = { nodeId, keys, skipHeaderRows };
      expect(executeTablesSortOp(adapter, input, { dryRun: true })).toEqual({ success: true });
      expect(adapter).toHaveBeenCalledWith(input, { changeMode: 'direct', dryRun: true });
    });
  }

  for (const skipHeaderRows of [-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '2', null, true]) {
    it(`rejects invalid skipHeaderRows ${String(skipHeaderRows)} before the adapter`, () => {
      const adapter = mock(() => ({ success: true }));
      const input = { nodeId, keys, skipHeaderRows } as unknown as Parameters<typeof executeTablesSortOp>[1];
      expect(() => executeTablesSortOp(adapter, input)).toThrow(DocumentApiValidationError);
      try {
        executeTablesSortOp(adapter, input);
      } catch (error) {
        expect(error).toMatchObject({ code: 'INVALID_ARGUMENT', message: expect.stringContaining('skipHeaderRows') });
      }
      expect(adapter).not.toHaveBeenCalled();
    });
  }

  it('retains locator validation and existing empty-key forwarding', () => {
    const adapter = mock(() => ({ success: false }));
    expect(() => executeTablesSortOp(adapter, { keys })).toThrow('requires a target');
    expect(adapter).not.toHaveBeenCalled();
    const input = { nodeId, keys: [] } as unknown as Parameters<typeof executeTablesSortOp>[1];
    expect(executeTablesSortOp(adapter, input)).toEqual({ success: false });
    expect(adapter).toHaveBeenCalledWith(input, { changeMode: 'direct', dryRun: false, expectedRevision: undefined });
  });
});

describe('normalizeTablesSplitInput', () => {
  it('passes through canonical rowIndex unchanged', () => {
    const input = { nodeId: 'table-1', rowIndex: 2 };
    expect(normalizeTablesSplitInput(input)).toEqual(input);
  });

  it('maps legacy atRowIndex to rowIndex', () => {
    const input = { nodeId: 'table-1', atRowIndex: 3 };
    const result = normalizeTablesSplitInput(input);
    expect(result).toEqual({ nodeId: 'table-1', rowIndex: 3 });
    expect(result).not.toHaveProperty('atRowIndex');
  });

  it('accepts both when values match (prefers rowIndex)', () => {
    const input = { nodeId: 'table-1', rowIndex: 1, atRowIndex: 1 };
    const result = normalizeTablesSplitInput(input);
    expect(result).toEqual({ nodeId: 'table-1', rowIndex: 1 });
    expect(result).not.toHaveProperty('atRowIndex');
  });

  it('rejects conflicting rowIndex and atRowIndex', () => {
    const input = { nodeId: 'table-1', rowIndex: 1, atRowIndex: 2 };
    expect(() => normalizeTablesSplitInput(input)).toThrow(
      'tables.split: cannot provide both rowIndex and atRowIndex with different values.',
    );
  });

  it('preserves all other input fields', () => {
    const input = { nodeId: 'table-1', atRowIndex: 1, target: undefined };
    const result = normalizeTablesSplitInput(input);
    expect(result.nodeId).toBe('table-1');
    expect(result.rowIndex).toBe(1);
  });
});

describe('executeTablesApplyStyle validation', () => {
  it('rejects when neither styleId nor styleOptions is provided', () => {
    expect(() => executeTablesApplyStyle('tables.applyStyle', MOCK_ADAPTER, { nodeId } as any)).toThrow(
      DocumentApiValidationError,
    );
  });

  it('rejects empty string styleId', () => {
    expect(() => executeTablesApplyStyle('tables.applyStyle', MOCK_ADAPTER, { nodeId, styleId: '' } as any)).toThrow(
      'non-empty string',
    );
  });

  it('rejects empty styleOptions when styleId is absent', () => {
    expect(() =>
      executeTablesApplyStyle('tables.applyStyle', MOCK_ADAPTER, { nodeId, styleOptions: {} } as any),
    ).toThrow('at least one flag');
  });

  it('allows empty styleOptions when styleId is present', () => {
    expect(() =>
      executeTablesApplyStyle('tables.applyStyle', MOCK_ADAPTER, { nodeId, styleId: 'X', styleOptions: {} } as any),
    ).not.toThrow();
  });

  it('rejects unknown styleOptions keys', () => {
    expect(() =>
      executeTablesApplyStyle('tables.applyStyle', MOCK_ADAPTER, {
        nodeId,
        styleOptions: { unknownFlag: true },
      } as any),
    ).toThrow('unrecognized');
  });

  it('rejects styleOptions: null with INVALID_INPUT', () => {
    expect(() =>
      executeTablesApplyStyle('tables.applyStyle', MOCK_ADAPTER, { nodeId, styleOptions: null } as any),
    ).toThrow('plain object');
  });

  it('rejects styleOptions: true with INVALID_INPUT', () => {
    expect(() =>
      executeTablesApplyStyle('tables.applyStyle', MOCK_ADAPTER, { nodeId, styleOptions: true } as any),
    ).toThrow('plain object');
  });

  it('rejects styleOptions: 5 with INVALID_INPUT', () => {
    expect(() =>
      executeTablesApplyStyle('tables.applyStyle', MOCK_ADAPTER, { nodeId, styleOptions: 5 } as any),
    ).toThrow('plain object');
  });

  it('accepts valid styleId and styleOptions', () => {
    expect(() =>
      executeTablesApplyStyle('tables.applyStyle', MOCK_ADAPTER, {
        nodeId,
        styleId: 'TableGrid',
        styleOptions: { headerRow: true, bandedRows: false },
      } as any),
    ).not.toThrow();
  });
});

describe('executeTablesSetBorders validation', () => {
  it('rejects missing mode', () => {
    expect(() => executeTablesSetBorders('tables.setBorders', MOCK_ADAPTER, { nodeId } as any)).toThrow('mode');
  });

  it('rejects invalid applyTo value', () => {
    expect(() =>
      executeTablesSetBorders('tables.setBorders', MOCK_ADAPTER, {
        nodeId,
        mode: 'applyTo',
        applyTo: 'diagonal',
        border: null,
      } as any),
    ).toThrow('applyTo');
  });

  it('rejects applyTo mode without border field', () => {
    expect(() =>
      executeTablesSetBorders('tables.setBorders', MOCK_ADAPTER, {
        nodeId,
        mode: 'applyTo',
        applyTo: 'all',
      } as any),
    ).toThrow('border is required');
  });

  it('rejects lineWeightPt: 0 in border spec', () => {
    expect(() =>
      executeTablesSetBorders('tables.setBorders', MOCK_ADAPTER, {
        nodeId,
        mode: 'applyTo',
        applyTo: 'all',
        border: { lineStyle: 'single', lineWeightPt: 0, color: '000000' },
      } as any),
    ).toThrow('positive');
  });

  it('rejects empty lineStyle string', () => {
    expect(() =>
      executeTablesSetBorders('tables.setBorders', MOCK_ADAPTER, {
        nodeId,
        mode: 'applyTo',
        applyTo: 'all',
        border: { lineStyle: '', lineWeightPt: 1, color: '000000' },
      } as any),
    ).toThrow('non-empty string');
  });

  it('rejects empty color string', () => {
    expect(() =>
      executeTablesSetBorders('tables.setBorders', MOCK_ADAPTER, {
        nodeId,
        mode: 'applyTo',
        applyTo: 'all',
        border: { lineStyle: 'single', lineWeightPt: 1, color: '' },
      } as any),
    ).toThrow('non-empty string');
  });

  it('rejects non-hex color strings', () => {
    expect(() =>
      executeTablesSetBorders('tables.setBorders', MOCK_ADAPTER, {
        nodeId,
        mode: 'applyTo',
        applyTo: 'all',
        border: { lineStyle: 'single', lineWeightPt: 1, color: 'red' },
      } as any),
    ).toThrow('6-digit hex color');
  });

  it('rejects edges mode with empty edges object', () => {
    expect(() =>
      executeTablesSetBorders('tables.setBorders', MOCK_ADAPTER, {
        nodeId,
        mode: 'edges',
        edges: {},
      } as any),
    ).toThrow('at least one');
  });

  it('rejects invalid nested border spec in edges mode', () => {
    expect(() =>
      executeTablesSetBorders('tables.setBorders', MOCK_ADAPTER, {
        nodeId,
        mode: 'edges',
        edges: { top: { lineStyle: 'single', lineWeightPt: 1 } }, // missing color
      } as any),
    ).toThrow('color');
  });

  it('accepts valid applyTo mode with null border', () => {
    expect(() =>
      executeTablesSetBorders('tables.setBorders', MOCK_ADAPTER, {
        nodeId,
        mode: 'applyTo',
        applyTo: 'all',
        border: null,
      } as any),
    ).not.toThrow();
  });

  it('accepts color: auto', () => {
    expect(() =>
      executeTablesSetBorders('tables.setBorders', MOCK_ADAPTER, {
        nodeId,
        mode: 'applyTo',
        applyTo: 'all',
        border: { lineStyle: 'single', lineWeightPt: 1, color: 'auto' },
      } as any),
    ).not.toThrow();
  });

  it('accepts valid edges mode', () => {
    expect(() =>
      executeTablesSetBorders('tables.setBorders', MOCK_ADAPTER, {
        nodeId,
        mode: 'edges',
        edges: {
          top: { lineStyle: 'single', lineWeightPt: 1, color: '000000' },
          insideH: null,
        },
      } as any),
    ).not.toThrow();
  });
});

describe('executeTablesSetTableOptions validation', () => {
  it('rejects when neither margins nor spacing is provided', () => {
    expect(() => executeTablesSetTableOptions('tables.setTableOptions', MOCK_ADAPTER, { nodeId } as any)).toThrow(
      'at least one',
    );
  });

  it('rejects defaultCellMargins: null with INVALID_INPUT', () => {
    expect(() =>
      executeTablesSetTableOptions('tables.setTableOptions', MOCK_ADAPTER, {
        nodeId,
        defaultCellMargins: null,
      } as any),
    ).toThrow('plain object');
  });

  it('rejects defaultCellMargins: true with INVALID_INPUT', () => {
    expect(() =>
      executeTablesSetTableOptions('tables.setTableOptions', MOCK_ADAPTER, {
        nodeId,
        defaultCellMargins: true,
      } as any),
    ).toThrow('plain object');
  });

  it('rejects negative margin value', () => {
    expect(() =>
      executeTablesSetTableOptions('tables.setTableOptions', MOCK_ADAPTER, {
        nodeId,
        defaultCellMargins: { topPt: -1, rightPt: 0, bottomPt: 0, leftPt: 0 },
      } as any),
    ).toThrow('non-negative');
  });

  it('rejects negative cellSpacingPt', () => {
    expect(() =>
      executeTablesSetTableOptions('tables.setTableOptions', MOCK_ADAPTER, {
        nodeId,
        cellSpacingPt: -1,
      } as any),
    ).toThrow('non-negative');
  });

  it('accepts cellSpacingPt: 0', () => {
    expect(() =>
      executeTablesSetTableOptions('tables.setTableOptions', MOCK_ADAPTER, {
        nodeId,
        cellSpacingPt: 0,
      } as any),
    ).not.toThrow();
  });

  it('accepts cellSpacingPt: null', () => {
    expect(() =>
      executeTablesSetTableOptions('tables.setTableOptions', MOCK_ADAPTER, {
        nodeId,
        cellSpacingPt: null,
      } as any),
    ).not.toThrow();
  });

  it('accepts valid margins and spacing', () => {
    expect(() =>
      executeTablesSetTableOptions('tables.setTableOptions', MOCK_ADAPTER, {
        nodeId,
        defaultCellMargins: { topPt: 6, rightPt: 6, bottomPt: 6, leftPt: 6 },
        cellSpacingPt: 2,
      } as any),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// SD-2540 — review fixes (validator regressions)
// ---------------------------------------------------------------------------

describe('row-locator append-at-end shorthand (allowAppendShorthand flag)', () => {
  it('accepts {nodeId} alone when allowAppendShorthand: true', () => {
    expect(() =>
      executeRowLocatorOp('tables.insertRow', MOCK_ADAPTER, { nodeId } as any, undefined, {
        allowAppendShorthand: true,
      }),
    ).not.toThrow();
  });

  it('accepts table-level target alone when allowAppendShorthand: true', () => {
    expect(() =>
      executeRowLocatorOp(
        'tables.insertRow',
        MOCK_ADAPTER,
        { target: { kind: 'block', nodeType: 'table', nodeId } } as any,
        undefined,
        { allowAppendShorthand: true },
      ),
    ).not.toThrow();
  });

  it('rejects {nodeId} alone when allowAppendShorthand is omitted (default strict)', () => {
    expect(() => executeRowLocatorOp('tables.deleteRow', MOCK_ADAPTER, { nodeId } as any)).toThrow(
      DocumentApiValidationError,
    );
  });

  it('rejects {nodeId} + position without rowIndex even with allowAppendShorthand', () => {
    expect(() =>
      executeRowLocatorOp('tables.insertRow', MOCK_ADAPTER, { nodeId, position: 'above' } as any, undefined, {
        allowAppendShorthand: true,
      }),
    ).toThrow(DocumentApiValidationError);
  });
});

describe('setBorders color validator: loose hex forms', () => {
  const baseInput = (color: string) => ({
    nodeId,
    mode: 'applyTo',
    applyTo: 'all',
    border: { lineStyle: 'single', lineWeightPt: 1, color },
  });

  it('accepts canonical 6-digit hex without #', () => {
    expect(() => executeTablesSetBorders('tables.setBorders', MOCK_ADAPTER, baseInput('000000') as any)).not.toThrow();
  });

  it('accepts #-prefixed 6-digit hex', () => {
    expect(() => executeTablesSetBorders('tables.setBorders', MOCK_ADAPTER, baseInput('#000000') as any)).not.toThrow();
  });

  it('accepts 3-digit shorthand without #', () => {
    expect(() => executeTablesSetBorders('tables.setBorders', MOCK_ADAPTER, baseInput('abc') as any)).not.toThrow();
  });

  it('accepts #-prefixed 3-digit shorthand', () => {
    expect(() => executeTablesSetBorders('tables.setBorders', MOCK_ADAPTER, baseInput('#abc') as any)).not.toThrow();
  });

  it('still rejects invalid hex strings', () => {
    expect(() => executeTablesSetBorders('tables.setBorders', MOCK_ADAPTER, baseInput('xyzzzz') as any)).toThrow(
      DocumentApiValidationError,
    );
  });

  it('still rejects 4-digit non-hex', () => {
    expect(() => executeTablesSetBorders('tables.setBorders', MOCK_ADAPTER, baseInput('abcd') as any)).toThrow(
      DocumentApiValidationError,
    );
  });
});
