import { describe, expect, it } from 'vite-plus/test';
import { groupCommittedComments, groupComments, hasOpenTrackedChange } from './comment-grouping.js';
import type { GroupableComment } from './comment-grouping.js';

const everyRow = () => true;
const ids = (rows: readonly GroupableComment[]) => rows.map((row) => row.commentId);

describe('groupComments', () => {
  it('keeps parents and drops their replies', () => {
    const grouped = groupComments(
      [
        { commentId: 'c1', createdTime: 2 },
        { commentId: 'r1', parentCommentId: 'c1', createdTime: 3 },
        { commentId: 'c0', createdTime: 1 },
      ],
      everyRow,
    );
    expect(ids(grouped.parentComments)).toEqual(['c0', 'c1']);
    expect(ids(grouped.resolvedComments)).toEqual([]);
  });

  it('puts every resolved row in the resolved group, replies included', () => {
    const grouped = groupComments(
      [
        { commentId: 'c1', createdTime: 1 },
        { commentId: 'r2', parentCommentId: 'c2', createdTime: 6, resolvedTime: 9 },
        { commentId: 'c2', createdTime: 5, resolvedTime: 9 },
        { commentId: 'r1', parentCommentId: 'c1', createdTime: 2 },
      ],
      everyRow,
    );
    expect(ids(grouped.parentComments)).toEqual(['c1']);
    expect(ids(grouped.resolvedComments)).toEqual(['c2', 'r2']);
  });

  it('orders by created time, treats a missing time as zero, and keeps ties in source order', () => {
    const grouped = groupComments(
      [
        { commentId: 'b', createdTime: 3 },
        { commentId: 'a' },
        { commentId: 'c', createdTime: 1 },
        { commentId: 'd', createdTime: null },
        { commentId: 'e', createdTime: -1 },
      ],
      everyRow,
    );
    expect(ids(grouped.parentComments)).toEqual(['e', 'a', 'd', 'c', 'b']);
  });

  it('treats a tracked change as a parent and drops a comment threaded under it', () => {
    const grouped = groupComments(
      [
        { commentId: 'tc-1', trackedChange: true, parentCommentId: 'elsewhere', createdTime: 1 },
        { commentId: 'x', threadingParentCommentId: 'tc-1', createdTime: 2 },
        { commentId: 'y', trackedChangeThreadParentId: 'tc-1', createdTime: 3 },
        { commentId: 'z', trackedChangeThreadParentId: 'tc-missing', createdTime: 4 },
      ],
      everyRow,
    );
    expect(ids(grouped.parentComments)).toEqual(['tc-1', 'z']);
  });

  it('skips rows the visibility predicate hides', () => {
    const grouped = groupComments(
      [
        { commentId: 'tc-1', trackedChange: true, createdTime: 1 },
        { commentId: 'c1', createdTime: 2 },
        { commentId: 'c2', createdTime: 3, resolvedTime: 4 },
      ],
      (row) => row.trackedChange === true,
    );
    expect(ids(grouped.parentComments)).toEqual(['tc-1']);
    expect(ids(grouped.resolvedComments)).toEqual([]);
  });

  it('returns copies of open parents and the original resolved rows', () => {
    const open = { commentId: 'c1', createdTime: 1 };
    const resolved = { commentId: 'c2', createdTime: 2, resolvedTime: 3 };
    const grouped = groupComments([open, resolved], everyRow);
    expect(grouped.parentComments[0]).toEqual(open);
    expect(grouped.parentComments[0]).not.toBe(open);
    expect(grouped.resolvedComments[0]).toBe(resolved);
  });
});

describe('groupCommittedComments', () => {
  it('groups like groupComments when no document has a committed presentation', () => {
    const grouped = groupCommittedComments(
      [
        { commentId: 'b', fileId: 'doc-1', createdTime: 2 },
        { commentId: 'a', fileId: 'doc-1', createdTime: 1 },
        { commentId: 'r', fileId: 'doc-1', createdTime: 0, resolvedTime: 1 },
      ],
      {},
      everyRow,
    );
    expect(ids(grouped.parentComments)).toEqual(['a', 'b']);
    expect(ids(grouped.resolvedComments)).toEqual(['r']);
  });

  it('follows the committed order for a presented document and appends it after the other documents', () => {
    const presented = { commentId: 'b', fileId: 'doc-2', createdTime: 1 };
    const grouped = groupCommittedComments(
      [
        { commentId: 'b', fileId: 'doc-1', createdTime: 5 },
        { commentId: 'a', fileId: 'doc-2', createdTime: 2 },
        presented,
        { commentId: 7, fileId: 'doc-2', createdTime: 3 },
        { commentId: 'z', fileId: 'doc-2', createdTime: 4 },
        { commentId: 'unlisted', fileId: 'doc-2', createdTime: 0 },
        { commentId: 'c', fileId: 'doc-1', createdTime: 4 },
      ],
      { 'doc-2': { groupOrder: { open: ['a', 'missing', 7, 'b'], resolved: ['z'] } } },
      everyRow,
    );
    expect(grouped.parentComments.map((row) => [row.fileId, row.commentId])).toEqual([
      ['doc-1', 'c'],
      ['doc-1', 'b'],
      ['doc-2', 'a'],
      ['doc-2', 7],
      ['doc-2', 'b'],
    ]);
    expect(grouped.resolvedComments.map((row) => [row.fileId, row.commentId])).toEqual([['doc-2', 'z']]);
    expect(grouped.parentComments[4]).toBe(presented);
  });

  it('skips committed rows the visibility predicate hides', () => {
    const grouped = groupCommittedComments(
      [
        { commentId: 'c1', fileId: 'doc-1', createdTime: 1 },
        { commentId: 'tc-1', fileId: 'doc-1', trackedChange: true, createdTime: 2 },
      ],
      { 'doc-1': { groupOrder: { open: ['c1', 'tc-1'], resolved: [] } } },
      (row) => row.trackedChange === true,
    );
    expect(ids(grouped.parentComments)).toEqual(['tc-1']);
  });
});

describe('hasOpenTrackedChange', () => {
  it('is true only when an open parent is a tracked change', () => {
    expect(
      hasOpenTrackedChange(groupComments([{ commentId: 'tc-1', trackedChange: true }, { commentId: 'c1' }], everyRow)),
    ).toBe(true);
    expect(hasOpenTrackedChange(groupComments([{ commentId: 'c1' }], everyRow))).toBe(false);
    expect(
      hasOpenTrackedChange(groupComments([{ commentId: 'tc-1', trackedChange: true, resolvedTime: 1 }], everyRow)),
    ).toBe(false);
  });
});
