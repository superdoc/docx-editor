/**
 * Consumer typecheck: the `superdoc/ui/vue` bindings resolve from the package
 * path and expose the provider/composable shapes a custom Vue UI drives. The
 * controller they publish is the borrowed shape (no `destroy`), command state
 * is the typed `CommandState` (not `any`), and a command id may be reactive.
 */
import {
  provideSuperDocUI,
  useSetSuperDoc,
  useClearSuperDoc,
  useSuperDocCommand,
  useSuperDocSlice,
  useSuperDocSearch,
  useSuperDocUI,
} from 'superdoc/ui/vue';
import type { SuperDocHost, SuperDocUIBinding, UseSuperDocCommandResult } from 'superdoc/ui/vue';
import type { CommandId, CommandState, SearchSnapshot, SuperDocUIState } from 'superdoc/ui';
import type { FindReplaceHandle } from 'superdoc';
import type { ComputedRef, MaybeRefOrGetter, ShallowRef } from 'vue';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type AssertEqual<A, B> = Equal<A, B> extends true ? true : never;

// Provider: no parameters, returns the binding it provided.
const _provideParams: AssertEqual<Parameters<typeof provideSuperDocUI>, []> = true;
const _provideReturns: AssertEqual<ReturnType<typeof provideSuperDocUI>, SuperDocUIBinding> = true;

// The bind function takes a host and returns nothing.
const _setterShape: AssertEqual<ReturnType<typeof useSetSuperDoc>, (superdoc: SuperDocHost) => void> = true;
// The unbind function requires the host it is unbinding, so a consumer cannot
// express "clear whatever is bound" and race a newer editor.
const _clearShape: AssertEqual<ReturnType<typeof useClearSuperDoc>, (expectedHost: SuperDocHost) => boolean> = true;

// The published controller ref is the borrowed shape: `destroy` is absent, so
// consumer teardown is a compile error rather than a runtime incident.
type PublishedUi = NonNullable<ReturnType<typeof useSuperDocUI>['value']>;
const _noDestroy: AssertEqual<'destroy' extends keyof PublishedUi ? true : false, false> = true;

// Command state is exposed as Vue refs beside execution methods, and the id
// parameter accepts a plain or reactive command id.
const _commandReturns: AssertEqual<ReturnType<typeof useSuperDocCommand>, UseSuperDocCommandResult> = true;
const _commandParams: AssertEqual<Parameters<typeof useSuperDocCommand>, [id: MaybeRefOrGetter<CommandId>]> = true;
const _commandState: AssertEqual<UseSuperDocCommandResult['state'], Readonly<ShallowRef<CommandState>>> = true;
const _commandEnabled: AssertEqual<UseSuperDocCommandResult['enabled'], Readonly<ComputedRef<boolean>>> = true;

// The built-in find/replace handle reports Replace and Replace all separately:
// a truncated session keeps the active match replaceable but not every match.
const _findReplaceCanReplace: AssertEqual<FindReplaceHandle['canReplace'], ComputedRef<boolean>> = true;
const _findReplaceCanReplaceAll: AssertEqual<FindReplaceHandle['canReplaceAll'], ComputedRef<boolean> | undefined> =
  true;

// The generic slice composable accepts a raw `ui.select(...)` subscribable and
// returns a ref of the selected slice type.
declare const _binding: SuperDocUIBinding;
const _mode = useSuperDocSlice((ui) => ui.select((state: SuperDocUIState) => state.documentMode), null);
const _modeShape: AssertEqual<typeof _mode, Readonly<ShallowRef<SuperDocUIState['documentMode'] | null>>> = true;
const _searchShape: AssertEqual<ReturnType<typeof useSuperDocSearch>, Readonly<ShallowRef<SearchSnapshot>>> = true;
const _searchParams: AssertEqual<Parameters<typeof useSuperDocSearch>, []> = true;

void _searchParams;
void _provideParams;
void _provideReturns;
void _setterShape;
void _clearShape;
void _noDestroy;
void _commandReturns;
void _commandParams;
void _commandState;
void _commandEnabled;
void _findReplaceCanReplace;
void _findReplaceCanReplaceAll;
void _binding;
void _modeShape;
void _searchShape;
