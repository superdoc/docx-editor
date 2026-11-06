import { normalizeCommentIdentity } from '@superdoc/document-api';
import type { SuperDoc, User, Config } from 'superdoc';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type AssertEqual<A, B> = Equal<A, B> extends true ? true : never;

declare const sd: SuperDoc;

const _paramsOk: AssertEqual<Parameters<SuperDoc['setUser']>, [user: User]> = true;

const _returnOk: AssertEqual<ReturnType<SuperDoc['setUser']>, Promise<void>> = true;

const _switched: Promise<void> = sd.setUser({ id: 'u-2', name: 'Ada Lovelace', email: 'ada@example.com' });
void _switched;

// @ts-expect-error setUser requires a user.
void sd.setUser();

void [_paramsOk, _returnOk];

const _pair: AssertEqual<User['commentIdentity'], { providerId: string; userId: string } | null | undefined> = true;
const _bound: Promise<void> = sd.setUser({
  name: 'Ada',
  commentIdentity: { providerId: 'AD', userId: 'S::ada@example.test::opaque' },
});
const _unbound: Promise<void> = sd.setUser({ name: 'Ada', commentIdentity: null });
type PartialPairRejected = { providerId: string } extends NonNullable<User['commentIdentity']> ? false : true;
const _partialRejected: PartialPairRejected = true;
void [_pair, _bound, _unbound, _partialRejected];

const _configured: Pick<Config, 'user'> = {
  user: { name: 'Ada', commentIdentity: { providerId: 'AD', userId: 'opaque' } },
};
void _configured;

const _normalizedPair: AssertEqual<
  ReturnType<typeof normalizeCommentIdentity>,
  NonNullable<User['commentIdentity']> | null
> = true;
const _normalizedIdentity: User['commentIdentity'] = normalizeCommentIdentity({ providerId: 'AD', userId: 'opaque' });
void [_normalizedPair, _normalizedIdentity];
