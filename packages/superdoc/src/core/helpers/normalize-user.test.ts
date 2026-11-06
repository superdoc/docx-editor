import { describe, expect, it } from 'vite-plus/test';

import { DEFAULT_SUPERDOC_USER, normalizeSuperDocUser } from './normalize-user.js';

describe('normalizeSuperDocUser', () => {
  it('supplies a fresh non-empty author when public config omits user', () => {
    const first = normalizeSuperDocUser(undefined);
    const second = normalizeSuperDocUser(undefined);

    expect(first).toEqual(DEFAULT_SUPERDOC_USER);
    expect(first.name).toBe('Default SuperDoc user');
    expect(first).not.toBe(second);
  });

  it('preserves configured identity fields while filling omitted defaults', () => {
    expect(
      normalizeSuperDocUser({
        id: 'user-1',
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        image: 'avatar.png',
      }),
    ).toEqual({
      id: 'user-1',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      image: 'avatar.png',
    });
  });
});

it('validates and owns a configured comment identity', () => {
  const commentIdentity = { providerId: 'AD', userId: 'S::ada@example.test::opaque' };
  const normalized = normalizeSuperDocUser({ name: 'Ada', commentIdentity });
  commentIdentity.userId = 'mutated';
  expect(normalized.commentIdentity?.userId).toBe('S::ada@example.test::opaque');
  expect(() => normalizeSuperDocUser({ commentIdentity: { providerId: 'AD', userId: '\u0000' } })).toThrow(TypeError);
});
