import type { SuperDoc, User } from 'superdoc';

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
