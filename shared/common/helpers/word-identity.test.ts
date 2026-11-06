import { describe, expect, it } from 'bun:test';
import { resolveCommentWordIdentity, snapshotWordIdentity } from './word-identity';

describe('Word provider identity input', () => {
  it('preserves opaque strings and snapshots without deriving generic app identity', () => {
    const identity = { providerId: ' unknown ', userId: 'S::synthetic@example.com::opaque😀' };
    expect(snapshotWordIdentity(identity)).toEqual(identity);
    expect(snapshotWordIdentity(identity)).not.toBe(identity);
    expect(snapshotWordIdentity(null)).toBeNull();
    expect(resolveCommentWordIdentity({ author: 'Other' }, { wordIdentity: identity })).toBeUndefined();
    expect(resolveCommentWordIdentity({ authorIdentity: null }, { wordIdentity: identity })).toBeNull();
  });
  it.each(
    [
      {},
      [],
      5,
      false,
      { providerId: 'AD' },
      { providerId: 'AD', userId: '' },
      { providerId: 'AD', userId: '\t' },
      { providerId: 'AD', userId: 'a\rb' },
      { providerId: 'AD', userId: '\u007f' },
      { providerId: 'AD', userId: '\uffff' },
    ].map((value) => ({ value })),
  )('rejects malformed explicit input %j', ({ value }) => {
    expect(() => snapshotWordIdentity(value)).toThrow(TypeError);
  });
});
