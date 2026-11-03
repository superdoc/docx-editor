import { describe, expect, it } from 'vite-plus/test';
import {
  buildTableCommandInput,
  readParagraphIndentationFromResult,
  type ResolvedTableContext,
} from './block-commands.js';

const context: ResolvedTableContext = {
  canMerge: true,
  tableNodeId: 't1',
  rowIndex: 2,
  columnIndex: 1,
  cellNodeId: 'c1',
  mergeRange: { start: { rowIndex: 0, columnIndex: 0 }, end: { rowIndex: 1, columnIndex: 1 } },
};

describe('buildTableCommandInput', () => {
  it('places row and column inserts on the requested side', () => {
    expect(buildTableCommandInput('insert-row-before', context)).toEqual({
      nodeId: 't1',
      rowIndex: 2,
      position: 'above',
    });
    expect(buildTableCommandInput('insert-row-after', context)).toEqual({
      nodeId: 't1',
      rowIndex: 2,
      position: 'below',
    });
    expect(buildTableCommandInput('insert-column-before', context)).toEqual({
      nodeId: 't1',
      columnIndex: 1,
      position: 'left',
    });
    expect(buildTableCommandInput('insert-column-after', context)).toEqual({
      nodeId: 't1',
      columnIndex: 1,
      position: 'right',
    });
  });

  it('merges the selected range, or the current cell when no range is selected', () => {
    expect(buildTableCommandInput('merge-cells', context)).toEqual({
      nodeId: 't1',
      start: { rowIndex: 0, columnIndex: 0 },
      end: { rowIndex: 1, columnIndex: 1 },
    });
    expect(buildTableCommandInput('merge-cells', { ...context, mergeRange: null })).toEqual({
      nodeId: 't1',
      start: { rowIndex: 2, columnIndex: 1 },
      end: { rowIndex: 2, columnIndex: 1 },
    });
  });

  it('refuses a merge the context cannot perform and a split without a cell', () => {
    expect(buildTableCommandInput('merge-cells', { ...context, canMerge: false })).toBeNull();
    expect(buildTableCommandInput('split-cell', { ...context, cellNodeId: null })).toBeNull();
  });

  it('splits the current cell in two and removes every border', () => {
    expect(buildTableCommandInput('split-cell', context)).toEqual({ nodeId: 'c1', rows: 1, columns: 2 });
    expect(buildTableCommandInput('remove-borders', context)).toEqual({
      nodeId: 't1',
      mode: 'applyTo',
      applyTo: 'all',
      border: null,
    });
  });
});

describe('readParagraphIndentationFromResult', () => {
  it('converts resolved points to twips and omits unset sides', () => {
    expect(
      readParagraphIndentationFromResult({
        node: { kind: 'paragraph', paragraph: { resolved: { indent: { left: 36 } } } },
      }),
    ).toEqual({
      left: 720,
    });
  });

  it('reads heading props and the logical start/end names', () => {
    expect(
      readParagraphIndentationFromResult({
        node: { kind: 'heading', heading: { props: { indent: { start: 18, end: 9, hanging: 18 } } } },
      }),
    ).toEqual({ left: 360, right: 180, hanging: 360 });
  });

  it('returns null for other node kinds and for empty indentation', () => {
    expect(readParagraphIndentationFromResult({ node: { kind: 'table' } })).toBeNull();
    expect(
      readParagraphIndentationFromResult({ node: { kind: 'paragraph', paragraph: { resolved: { indent: {} } } } }),
    ).toBeNull();
  });
});
