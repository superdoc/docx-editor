import { describe, expect, it } from 'vite-plus/test';
import * as Y from 'yjs';
import { addYComment, deleteYComment, getCommentIndex, updateYComment } from './collaboration-comments';

const user = { name: 'Test User', email: 'test@example.com' };

const createCommentsDoc = () => {
  const ydoc = new Y.Doc();
  const yArray = ydoc.getArray<unknown>('comments');
  let transactions = 0;
  ydoc.on('afterTransaction', () => {
    transactions += 1;
  });
  return { ydoc, yArray, transactionCount: () => transactions };
};

describe('collaboration comment events without a comment object', () => {
  const operations = [
    ['addYComment', addYComment],
    ['updateYComment', updateYComment],
    ['deleteYComment', deleteYComment],
  ] as const;
  const nonObjectComments = [null, undefined, 'c1', 42, ['c1']];

  for (const [name, operation] of operations) {
    for (const comment of nonObjectComments) {
      it(`${name} rejects ${JSON.stringify(comment) ?? 'undefined'} and leaves the shared array untouched`, () => {
        const { ydoc, yArray, transactionCount } = createCommentsDoc();
        ydoc.transact(() => {
          yArray.push([new Y.Map<unknown>([['commentId', 'c1']])]);
        });
        const before = yArray.toJSON();
        const transactionsBefore = transactionCount();

        expect(() => operation(yArray, ydoc, { comment }, user)).toThrow(
          new TypeError('Collaboration comment events require a comment object'),
        );
        expect(yArray.toJSON()).toEqual(before);
        expect(transactionCount()).toBe(transactionsBefore);
      });
    }
  }
});

describe('collaboration comments with a non-object entry in the shared array', () => {
  const seedMixedArray = () => {
    const doc = createCommentsDoc();
    doc.ydoc.transact(() => {
      doc.yArray.push([
        new Y.Map<unknown>([
          ['commentId', 'c1'],
          ['text', 'first'],
        ]),
        null,
        'legacy',
        ['commentId', 'c2'],
        new Y.Map<unknown>([
          ['commentId', 'c2'],
          ['text', 'second'],
        ]),
      ]);
    });
    return doc;
  };

  it('getCommentIndex skips non-object entries', () => {
    const { yArray } = seedMixedArray();

    expect(getCommentIndex(yArray, { commentId: 'c2' })).toBe(4);
    expect(getCommentIndex(yArray, { commentId: 'missing' })).toBe(-1);
  });

  it('updateYComment replaces the matching comment after a non-object entry', () => {
    const { ydoc, yArray } = seedMixedArray();

    updateYComment(yArray, ydoc, { comment: { commentId: 'c2', text: 'edited' } }, user);

    expect(yArray.toJSON()).toEqual([
      { commentId: 'c1', text: 'first' },
      null,
      'legacy',
      ['commentId', 'c2'],
      { commentId: 'c2', text: 'edited' },
    ]);
  });

  it('deleteYComment removes the matching comment after a non-object entry', () => {
    const { ydoc, yArray } = seedMixedArray();

    deleteYComment(yArray, ydoc, { comment: { commentId: 'c2' } }, user);

    expect(yArray.toJSON()).toEqual([{ commentId: 'c1', text: 'first' }, null, 'legacy', ['commentId', 'c2']]);
  });
});
