import { describe, expect, it } from 'vite-plus/test';
import {
  createDroppedCommentIdMap,
  getBodyTrackedChangeIdentityIds,
  groupBodyTrackedChangeCommentsByIdentity,
  mergeDuplicateBodyTrackedChangeComments,
} from './tracked-change-compaction.js';
import type { CompactableTrackedChangeRow } from './tracked-change-compaction.js';

const groupIds = (groups: Map<number, CompactableTrackedChangeRow[]>) =>
  [...groups].map(([root, rows]) => [root, rows.map((row) => row.commentId)]);

describe('getBodyTrackedChangeIdentityIds', () => {
  it('uses only the comment id when the row has a canonical id', () => {
    expect(
      getBodyTrackedChangeIdentityIds({
        commentId: 'tc-1',
        trackedChangeCanonicalId: 'canonical-1',
        importedId: '7',
        trackedChangeAnchorKey: 'tc::body::7',
        trackedChangePositionAliases: ['7'],
      }),
    ).toEqual(['tc-1']);
  });

  it('adds the imported id, anchor key, and normalized aliases for a legacy row', () => {
    expect(
      getBodyTrackedChangeIdentityIds({
        commentId: 5,
        importedId: 7,
        trackedChangeAnchorKey: 'tc::body::7',
        trackedChangePositionAliases: [8, '8', null, 'p-9'],
      }),
    ).toEqual(['5', '7', 'tc::body::7', '8', 'p-9']);
  });

  it('skips missing and empty ids', () => {
    expect(
      getBodyTrackedChangeIdentityIds({
        commentId: null,
        importedId: '',
        trackedChangeAnchorKey: undefined,
        trackedChangePositionAliases: 'not-a-list',
      }),
    ).toEqual([]);
  });
});

describe('groupBodyTrackedChangeCommentsByIdentity', () => {
  it('joins canonical rows only on their comment id', () => {
    const groups = groupBodyTrackedChangeCommentsByIdentity([
      { commentId: 'move-from', trackedChangeCanonicalId: 'move-1', importedId: '1' },
      { commentId: 'move-to', trackedChangeCanonicalId: 'move-1', importedId: '1' },
      { commentId: 'move-from', trackedChangeCanonicalId: 'move-1' },
    ]);
    expect(groupIds(groups)).toEqual([
      [0, ['move-from', 'move-from']],
      [1, ['move-to']],
    ]);
  });

  it('puts a transitive group under its earliest row and keeps source order inside it', () => {
    const groups = groupBodyTrackedChangeCommentsByIdentity([
      { commentId: 'a' },
      { commentId: 'b', trackedChangePositionAliases: ['shared-cd'] },
      { commentId: 'c', importedId: 'shared-cd' },
      { commentId: 'd', trackedChangePositionAliases: ['c', 'a'] },
      { commentId: 'e' },
    ]);
    expect(groupIds(groups)).toEqual([
      [0, ['a', 'b', 'c', 'd']],
      [4, ['e']],
    ]);
  });

  it('keeps rows without any id in their own groups', () => {
    const groups = groupBodyTrackedChangeCommentsByIdentity([{ commentId: null }, { commentId: undefined }]);
    expect(groupIds(groups)).toEqual([
      [0, [null]],
      [1, [undefined]],
    ]);
  });
});

describe('mergeDuplicateBodyTrackedChangeComments', () => {
  it('maps each duplicate to the first row of its group and leaves single-row groups alone', () => {
    const survivor = { commentId: 'a' };
    const duplicate = { commentId: 'b' };
    const single = { commentId: 'c', trackedChangePositionAliases: ['x', 'x'] };
    const duplicates = mergeDuplicateBodyTrackedChangeComments(
      new Map([
        [0, [survivor, duplicate]],
        [2, [single]],
      ]),
    );
    expect([...duplicates]).toEqual([[duplicate, survivor]]);
    expect(duplicates.get(duplicate)).toBe(survivor);
    expect(single.trackedChangePositionAliases).toEqual(['x', 'x']);
  });

  it('carries the first resolved duplicate onto an open survivor in place', () => {
    const survivor: CompactableTrackedChangeRow = { commentId: 'a', resolvedTime: null };
    mergeDuplicateBodyTrackedChangeComments(
      new Map([
        [
          0,
          [
            survivor,
            { commentId: 'b' },
            {
              commentId: 'c',
              resolvedTime: 10,
              resolvedById: 'u-1',
              resolvedByEmail: 'one@example.com',
              resolvedByName: 'One',
              trackedChangeDecision: 'accept',
            },
            { commentId: 'd', resolvedTime: 20, resolvedById: 'u-2', trackedChangeDecision: 'reject' },
          ],
        ],
      ]),
    );
    expect(survivor).toMatchObject({
      resolvedTime: 10,
      resolvedById: 'u-1',
      resolvedByEmail: 'one@example.com',
      resolvedByName: 'One',
      trackedChangeDecision: 'accept',
    });
  });

  it('keeps the resolution of an already resolved survivor', () => {
    const survivor: CompactableTrackedChangeRow = { commentId: 'a', resolvedTime: 5, resolvedById: 'u-0' };
    mergeDuplicateBodyTrackedChangeComments(
      new Map([[0, [survivor, { commentId: 'b', resolvedTime: 10, resolvedById: 'u-1' }]]]),
    );
    expect(survivor).toMatchObject({ resolvedTime: 5, resolvedById: 'u-0' });
  });

  it('adds every duplicate id to the survivor aliases, normalized and without repeats', () => {
    const survivor = { commentId: 'a', trackedChangePositionAliases: ['p-1', 2] };
    mergeDuplicateBodyTrackedChangeComments(
      new Map([
        [
          0,
          [
            survivor,
            {
              commentId: 'b',
              importedId: 2,
              trackedChangeCanonicalId: 'canonical-b',
              trackedChangePositionAliases: ['p-1'],
            },
            { commentId: 3, importedId: null, trackedChangePositionAliases: ['p-4'] },
          ],
        ],
      ]),
    );
    expect(survivor.trackedChangePositionAliases).toEqual(['p-1', '2', 'b', 'canonical-b', '3', 'p-4']);
  });
});

describe('createDroppedCommentIdMap', () => {
  it('maps each dropped comment id to its survivor id and skips rows without ids', () => {
    const survivor = { commentId: 1 };
    const map = createDroppedCommentIdMap(
      new Map<CompactableTrackedChangeRow, CompactableTrackedChangeRow>([
        [{ commentId: 'b' }, survivor],
        [{ commentId: null }, survivor],
        [{ commentId: 'c' }, { commentId: undefined }],
        [{ commentId: 4 }, survivor],
      ]),
    );
    expect([...map]).toEqual([
      ['b', '1'],
      ['4', '1'],
    ]);
  });
});
