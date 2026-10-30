import { describe, expect, it } from 'vite-plus/test';
import { reactive } from 'vue';
import {
  createCommentIdentity,
  trackedChangeThreadParentIdForComment,
  type CommentIdentityRow,
  type CommentPositions,
} from './comment-identity.js';

const trackedPosition = (start: number, overrides: Record<string, unknown> = {}) => ({
  kind: 'trackedChange',
  storyKey: 'body',
  pageIndex: 0,
  start,
  end: start + 1,
  ...overrides,
});

const identity = (
  comments: CommentIdentityRow[],
  positions: CommentPositions = {},
  reviewDirectory: CommentIdentityRow[] = [],
) =>
  createCommentIdentity({
    getComments: () => comments,
    getReviewDirectory: () => reviewDirectory,
    getPositions: () => positions,
  });

const rows = (): CommentIdentityRow[] => [
  { commentId: 'c1', importedId: 'w1' },
  { commentId: 'tc-1', importedId: '5', trackedChange: true, trackedChangeAnchorKey: 'tc::body::5' },
  { commentId: 'reply', parentCommentId: 'c1' },
];

const directory = (): CommentIdentityRow[] => [{ commentId: 'dir-1', importedId: 'w-dir' }];

const positions = (): CommentPositions => ({
  'tc::body::5': trackedPosition(10),
  c1: { kind: 'comment', storyKey: 'fn:2' },
  'imported:7': trackedPosition(20),
  w8: { kind: 'comment' },
});

type RowsVariant = [string, () => CommentIdentityRow[], (list: CommentIdentityRow[]) => CommentIdentityRow[]];

const rowVariants: RowsVariant[] = [
  ['plain rows', rows, (list) => list],
  ['reactive rows', () => reactive(rows()), (list) => reactive(list)],
];

describe.each(rowVariants)('createCommentIdentity getComment with %s', (_label, makeRows, wrap) => {
  it('finds comments by id, imported id, anchor key and imported position id', () => {
    const { getComment } = identity(makeRows(), positions(), directory());
    expect(getComment('c1')?.commentId).toBe('c1');
    expect(getComment('w1')?.commentId).toBe('c1');
    expect(getComment('tc::body::5')?.commentId).toBe('tc-1');
    expect(getComment('imported:5')?.commentId).toBe('tc-1');
    expect(getComment('w-dir')?.commentId).toBe('dir-1');
    expect(getComment(5)?.commentId).toBe('tc-1');
  });

  it('returns null for missing ids and empty queries', () => {
    const { getComment } = identity(makeRows(), positions(), directory());
    expect(getComment('nope')).toBeNull();
    expect(getComment(null)).toBeNull();
    expect(getComment(undefined)).toBeNull();
  });

  it('prefers a primary id over a colliding alias in the same list', () => {
    const { getComment } = identity(
      wrap([
        { commentId: 'tc-2', importedId: '2', trackedChange: true },
        { commentId: '2', importedId: 'real' },
      ]),
    );
    expect(getComment('2')?.importedId).toBe('real');
  });
});

describe('createCommentIdentity tracked-change position alias match', () => {
  const trackedRows = (): CommentIdentityRow[] => [
    { commentId: 'row-a', trackedChange: true, trackedChangeAnchorKey: 'tc::body::row-a' },
    { commentId: 'row-b', trackedChange: true, trackedChangeAnchorKey: 'tc::body::row-b' },
  ];

  it('matches a painted alias to the row with the same start and end', () => {
    const { getComment } = identity(trackedRows(), {
      'tc::body::row-a': trackedPosition(100),
      'tc::body::row-b': trackedPosition(200),
      slot: trackedPosition(200, { key: 'painted' }),
    });
    expect(getComment('painted')?.commentId).toBe('row-b');
  });

  it('matches by thread id as well as key', () => {
    const { getComment } = identity(trackedRows(), {
      'tc::body::row-a': trackedPosition(100),
      'tc::body::row-b': trackedPosition(200),
      slot: trackedPosition(100, { threadId: 'thread-7' }),
    });
    expect(getComment('thread-7')?.commentId).toBe('row-a');
  });

  it('matches overlapping bounds even when the offsets differ', () => {
    const { getComment } = identity(trackedRows(), {
      'tc::body::row-a': trackedPosition(100, { bounds: { left: 0, right: 10, top: 0, bottom: 10 } }),
      'tc::body::row-b': trackedPosition(200, { bounds: { left: 100, right: 110, top: 100, bottom: 110 } }),
      slot: trackedPosition(999, { key: 'painted', bounds: { left: 5, right: 15, top: 5, bottom: 15 } }),
    });
    expect(getComment('painted')?.commentId).toBe('row-a');
  });

  it('does not treat touching bounds as overlap', () => {
    const { getComment } = identity(trackedRows(), {
      'tc::body::row-a': trackedPosition(100, { bounds: { left: 0, right: 10, top: 0, bottom: 10 } }),
      'tc::body::row-b': trackedPosition(200),
      slot: trackedPosition(999, { key: 'painted', bounds: { left: 10, right: 20, top: 0, bottom: 10 } }),
    });
    expect(getComment('painted')).toBeNull();
  });

  it('refuses matches across pages, stories, non-tracked kinds and ambiguous rows', () => {
    const base = {
      'tc::body::row-a': trackedPosition(100),
      'tc::body::row-b': trackedPosition(200),
    };
    expect(
      identity(trackedRows(), { ...base, slot: trackedPosition(100, { key: 'p', pageIndex: 1 }) }).getComment('p'),
    ).toBeNull();
    expect(
      identity(trackedRows(), { ...base, slot: trackedPosition(100, { key: 'p', storyKey: 'fn:1' }) }).getComment('p'),
    ).toBeNull();
    expect(
      identity(trackedRows(), { ...base, slot: trackedPosition(100, { key: 'p', kind: 'comment' }) }).getComment('p'),
    ).toBeNull();
    expect(
      identity(trackedRows(), {
        'tc::body::row-a': trackedPosition(100),
        'tc::body::row-b': trackedPosition(100),
        slot: trackedPosition(100, { key: 'p' }),
      }).getComment('p'),
    ).toBeNull();
  });

  it('ignores rows that are not tracked changes', () => {
    const { getComment } = identity([{ commentId: 'row-a', trackedChangeAnchorKey: 'tc::body::row-a' }], {
      'tc::body::row-a': trackedPosition(100),
      slot: trackedPosition(100, { key: 'p' }),
    });
    expect(getComment('p')).toBeNull();
  });
});

describe('createCommentIdentity getThreadParent', () => {
  it('resolves a reply to its parent and a root to itself', () => {
    const comments = rows();
    const { getThreadParent } = identity(comments);
    expect(getThreadParent(comments[2])?.commentId).toBe('c1');
    expect(getThreadParent(comments[0])?.commentId).toBe('c1');
  });

  it('returns null for a reply whose parent is missing', () => {
    const { getThreadParent } = identity(rows());
    expect(getThreadParent({ commentId: 'orphan', parentCommentId: 'gone' })).toBeNull();
  });
});

describe('trackedChangeThreadParentIdForComment', () => {
  it('prefers the explicit thread parent id', () => {
    expect(trackedChangeThreadParentIdForComment({ trackedChangeThreadParentId: 'p1' })).toBe('p1');
  });

  it('returns null for a v2 synthetic tracked-change row', () => {
    expect(
      trackedChangeThreadParentIdForComment({
        trackedChange: true,
        trackedChangeAnchorKey: 'tc::body::1',
        trackedChangeParentId: 'x',
      }),
    ).toBeNull();
  });

  it('falls back to the legacy parent only with a legacy signal', () => {
    expect(trackedChangeThreadParentIdForComment({ trackedChangeParentId: 'tc-9', trackedChangeType: 'insert' })).toBe(
      'tc-9',
    );
    expect(trackedChangeThreadParentIdForComment({ trackedChangeParentId: 'tc-9' })).toBeNull();
    expect(trackedChangeThreadParentIdForComment(null)).toBeNull();
  });
});

describe('createCommentIdentity getCommentPositionKey', () => {
  it('resolves string ids through positions, then the comment, then the raw id', () => {
    const { getCommentPositionKey } = identity(rows(), positions(), directory());
    expect(getCommentPositionKey('c1')).toBe('c1');
    expect(getCommentPositionKey('tc-1')).toBe('tc::body::5');
    expect(getCommentPositionKey('w1')).toBe('c1');
    expect(getCommentPositionKey('w-dir')).toBe('dir-1');
    expect(getCommentPositionKey('unknown')).toBe('unknown');
    expect(getCommentPositionKey('')).toBeNull();
    expect(getCommentPositionKey(null)).toBeNull();
  });

  it('prefers the first key present in positions for a comment object', () => {
    const { getCommentPositionKey } = identity([], positions());
    expect(getCommentPositionKey({ commentId: 'c1', trackedChangeAnchorKey: 'tc::body::5' })).toBe('tc::body::5');
    expect(getCommentPositionKey({ commentId: 'c1', importedId: 'w8' })).toBe('c1');
    expect(getCommentPositionKey({ commentId: 'x', importedId: 'w8' })).toBe('w8');
    expect(getCommentPositionKey({ commentId: 'x', importedId: '7', trackedChange: true })).toBe('imported:7');
    expect(getCommentPositionKey({ commentId: 'x', importedId: '7' })).toBe('x');
    expect(
      identity([], { '7': { kind: 'comment' }, 'imported:7': { kind: 'comment' } }).getCommentPositionKey({
        importedId: '7',
        trackedChange: true,
      }),
    ).toBe('7');
  });

  it('falls back to anchor key, comment id, imported position id, then imported id', () => {
    const { getCommentPositionKey } = identity([], {});
    expect(getCommentPositionKey({ commentId: 'x', importedId: '9', trackedChangeAnchorKey: 'tc::body::9' })).toBe(
      'tc::body::9',
    );
    expect(getCommentPositionKey({ commentId: 'x', importedId: '9', trackedChange: true })).toBe('x');
    expect(getCommentPositionKey({ importedId: '9', trackedChange: true })).toBe('imported:9');
    expect(getCommentPositionKey({ importedId: '9' })).toBe('9');
    expect(getCommentPositionKey({})).toBeNull();
  });

  it('returns the raw field value rather than a normalized string', () => {
    expect(identity([], { '7': { kind: 'comment' } }).getCommentPositionKey({ commentId: 'x', importedId: 7 })).toBe(7);
    expect(identity([], {}).getCommentPositionKey({ commentId: 3 })).toBe(3);
    expect(identity([{ commentId: 4 }], { '4': { kind: 'comment' } }).getCommentPositionKey('4')).toBe('4');
    expect(identity([{ commentId: 4, importedId: 'w4' }], {}).getCommentPositionKey('w4')).toBe(4);
  });
});

describe('createCommentIdentity getCommentAliasIds', () => {
  it('returns no aliases for null and undefined', () => {
    const { getCommentAliasIds } = identity(rows(), positions());
    expect(getCommentAliasIds(null)).toEqual([]);
    expect(getCommentAliasIds(undefined)).toEqual([]);
  });

  it('lists the raw id first, then the position key and comment ids, without duplicates', () => {
    const { getCommentAliasIds } = identity(rows(), positions());
    expect(getCommentAliasIds('tc-1')).toEqual(['tc-1', 'tc::body::5', '5', 'imported:5']);
    expect(getCommentAliasIds(5)).toEqual(['5', 'tc::body::5', 'tc-1', 'imported:5']);
    expect(getCommentAliasIds('ghost')).toEqual(['ghost']);
  });

  it('expands tracked-change position aliases into story anchor keys', () => {
    const { getCommentAliasIds } = identity([], {});
    expect(
      getCommentAliasIds({
        commentId: 'tc-2',
        importedId: 3,
        trackedChange: true,
        trackedChangeAnchorKey: 'tc::fn:1::3',
        trackedChangePositionAliases: ['p1', 'tc::body::x', 'p1'],
      }),
    ).toEqual(['tc::fn:1::3', 'tc-2', '3', 'imported:3', 'tc::fn:1::p1', 'p1', 'tc::body::x']);
  });

  it('ignores position aliases on comments that are not tracked changes', () => {
    const { getCommentAliasIds } = identity([], positions());
    expect(getCommentAliasIds({ commentId: 'c1', importedId: 'w1', trackedChangePositionAliases: ['z'] })).toEqual([
      'c1',
      'w1',
    ]);
  });
});

describe('createCommentIdentity cached index freshness', () => {
  it('resolves comments and position aliases added after the first lookup caches both indexes', () => {
    const list = reactive<CommentIdentityRow[]>([{ commentId: 'c1', importedId: 'w1' }]);
    const live = reactive<CommentPositions>({ 'tc::body::9': trackedPosition(30) });
    const { getComment, getCommentPositionKey } = createCommentIdentity({
      getComments: () => list,
      getReviewDirectory: () => [],
      getPositions: () => live,
    });

    expect(getComment('c1')?.commentId).toBe('c1');
    expect(getComment('w2')).toBeNull();
    expect(getComment('painted')).toBeNull();

    list.push({ commentId: 'c2', importedId: 'w2', trackedChange: true, trackedChangeAnchorKey: 'tc::body::9' });
    live['slot-1'] = trackedPosition(30, { key: 'painted' });

    expect(getComment('w2')?.commentId).toBe('c2');
    expect(getComment('imported:w2')?.commentId).toBe('c2');
    expect(getComment('painted')?.commentId).toBe('c2');
    expect(getCommentPositionKey('c2')).toBe('tc::body::9');
  });
});

describe('createCommentIdentity resolveCommentPositionEntry', () => {
  it('returns the first alias with an entry in a compatible story', () => {
    const current = positions();
    const { resolveCommentPositionEntry } = identity(rows(), current);
    expect(resolveCommentPositionEntry('tc-1')).toEqual({ key: 'tc::body::5', entry: current['tc::body::5'] });
    expect(resolveCommentPositionEntry('tc-1', 'c1')).toEqual({ key: 'tc::body::5', entry: current['tc::body::5'] });
    expect(resolveCommentPositionEntry('c1', 'w8')).toEqual({ key: 'w8', entry: current.w8 });
    expect(resolveCommentPositionEntry('ghost')).toEqual({ key: null, entry: null });
  });
});
