/** Consumer typecheck for the permission-resolver callback and both config spellings. */
import type { Config, Modules, PermissionResolver, PermissionResolverParams } from 'superdoc';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type AssertEqual<A, B> = Equal<A, B> extends true ? true : never;

type ParamOf<F extends ((...args: any) => any) | undefined> = Parameters<NonNullable<F>>[0];

const _topLevelResolverParamsOk: AssertEqual<ParamOf<Config['permissionResolver']>, PermissionResolverParams> = true;
const _topLevelResolverTypeOk: AssertEqual<NonNullable<Config['permissionResolver']>, PermissionResolver> = true;

type CommentsModule = Exclude<NonNullable<Modules['comments']>, false>;
const _commentsResolverParamsOk: AssertEqual<
  ParamOf<CommentsModule['permissionResolver']>,
  PermissionResolverParams
> = true;
const _commentsResolverTypeOk: AssertEqual<
  NonNullable<CommentsModule['permissionResolver']>,
  PermissionResolver
> = true;

const sample: PermissionResolverParams = {
  permission: 'RESOLVE_OWN',
  role: 'editor',
  isInternal: true,
  defaultDecision: true,
  comment: { id: 'c-1' },
  trackedChange: { id: 'tc-1' },
  currentUser: { name: 'A', email: 'a@x.com' },
  superdoc: null,
};
void sample;

const _resolver: PermissionResolver = (params) => params.defaultDecision;
void _resolver;

void [_topLevelResolverParamsOk, _topLevelResolverTypeOk, _commentsResolverParamsOk, _commentsResolverTypeOk];
