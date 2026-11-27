import { readParagraphLeftIndent } from './paragraph-indentation.js';
import { describe, expect, it } from 'vite-plus/test';
import { buildTableCommandInput, type ResolvedTableContext } from './block-commands.js';

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
      keepAllContent: true,
    });
    expect(buildTableCommandInput('merge-cells', { ...context, mergeRange: null })).toEqual({
      nodeId: 't1',
      start: { rowIndex: 2, columnIndex: 1 },
      end: { rowIndex: 2, columnIndex: 1 },
      keepAllContent: true,
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

describe('readParagraphLeftIndent', () => {
  it('converts resolved leading points to twips', () => {
    expect(
      readParagraphLeftIndent({
        node: { kind: 'paragraph', paragraph: { resolved: { indent: { left: 36 } } } },
      }),
    ).toBe(720);
  });

  it('reads heading props and the logical start name', () => {
    expect(
      readParagraphLeftIndent({
        node: { kind: 'heading', heading: { props: { indent: { start: 18, end: 9, hanging: 18 } } } },
      }),
    ).toBe(360);
  });

  it.each([
    [{ start: 72 }, { left: 36, start: 72 }, 1440],
    [{ left: 72 }, { left: 36, start: 72 }, 1440],
    [{ left: 72 }, { left: 72, start: 36 }, 1440],
    [{ start: 0 }, { left: 36, start: 0 }, 0],
    [{ start: -45 }, { left: 36, start: -45 }, -900],
  ])('uses the direct edge to disambiguate resolved aliases %o', (direct, resolved, left) => {
    expect(
      readParagraphLeftIndent({
        node: { kind: 'paragraph', paragraph: { props: { indent: direct }, resolved: { indent: resolved } } },
      }),
    ).toBe(left);
  });

  it('returns null for other node kinds and for empty indentation', () => {
    expect(readParagraphLeftIndent({ node: { kind: 'table' } })).toBeNull();
    expect(
      readParagraphLeftIndent({ node: { kind: 'paragraph', paragraph: { resolved: { indent: {} } } } }),
    ).toBeNull();
  });
});
