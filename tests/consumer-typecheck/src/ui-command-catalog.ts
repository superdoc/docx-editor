/**
 * Consumer typecheck: `superdoc/ui` exposes autocomplete-friendly command
 * ids, live state, and command handles without preventing application ids.
 */
import { createSuperDocUI, BUILT_IN_COMMAND_IDS } from 'superdoc/ui';
import type {
  SuperDocUI,
  SuperDocLike,
  CommandsHandle,
  CommandHandle,
  CommandState,
  CommandExecutionResult,
  CommandId,
  ToolbarHandle,
  SuperDocUIReason,
  SearchSnapshot,
} from 'superdoc/ui';
import { useSuperDocCommand, useSuperDocSearch, useSuperDocToolbar } from 'superdoc/ui/react';
import type { UseSuperDocCommandResult } from 'superdoc/ui/react';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type AssertEqual<A, B> = Equal<A, B> extends true ? true : never;

// The canonical starter ids are present as a value catalog.
const _bold: string = BUILT_IN_COMMAND_IDS.bold;
const _acceptAll: string = BUILT_IN_COMMAND_IDS.acceptAllChanges;
void _bold;
void _acceptAll;

declare const ui: SuperDocUI;
const commands: CommandsHandle = ui.commands;
const builtInCommandId: CommandId = 'document-mode';
const applicationCommandId: string = 'app.save-document';
const _commandIdAcceptsString: CommandId = applicationCommandId;

// has / get / execute / ids are the catalog access surface.
const _has: AssertEqual<ReturnType<CommandsHandle['has']>, boolean> = true;
const _ids: AssertEqual<CommandsHandle['ids'], readonly CommandId[]> = true;
const _getParams: AssertEqual<Parameters<CommandsHandle['get']>, [id: CommandId]> = true;
const _execute: AssertEqual<ReturnType<CommandsHandle['execute']>, CommandExecutionResult> = true;
const _executeAsync: AssertEqual<ReturnType<CommandsHandle['executeAsync']>, Promise<CommandExecutionResult>> = true;
void commands.has('zoom');
void commands.execute('font-size', '12pt');
void commands.executeAsync('font-size', '12pt');
void commands.execute('track-changes-accept-selection');
void commands.get(builtInCommandId);
void commands.has(applicationCommandId);
void commands.get(applicationCommandId);
void commands.execute(applicationCommandId);
void commands.executeAsync(applicationCommandId);

// A command handle exposes typed state, including the stable disabled reason.
const handle: CommandHandle = commands.get('document-mode');
const state: CommandState = handle.getState();
// Reasons are usually taxonomy members, but v2 edit-command snapshots pass
// their own strings (e.g. 'history-empty') through verbatim — the public type
// deliberately admits them while keeping taxonomy completion.
const _reason: SuperDocUIReason | (string & {}) | undefined = state.reason;
const _supported: boolean = state.supported;
const _enabled: boolean = state.enabled;
const _handleExecute: AssertEqual<ReturnType<CommandHandle['execute']>, CommandExecutionResult> = true;
const _handleExecuteAsync: AssertEqual<
  ReturnType<CommandHandle['executeAsync']>,
  Promise<CommandExecutionResult>
> = true;
void _reason;
void _supported;
void _enabled;
void handle.execute({ mode: 'editing' });
void handle.executeAsync({ mode: 'editing' });

// Toolbar handle executes by id too.
const toolbar: ToolbarHandle = ui.toolbar;
const _toolbarExecute: AssertEqual<ReturnType<ToolbarHandle['execute']>, CommandExecutionResult> = true;
const _toolbarExecuteAsync: AssertEqual<
  ReturnType<ToolbarHandle['executeAsync']>,
  Promise<CommandExecutionResult>
> = true;
void toolbar.execute('zoom-fit-width');
void toolbar.executeAsync('zoom-fit-width');

// React bindings resolve the same command/toolbar state types.
function _reactProbe(): void {
  const _commandParams: AssertEqual<Parameters<typeof useSuperDocCommand>, [id: CommandId]> = true;
  const cmdState: UseSuperDocCommandResult = useSuperDocCommand('bold');
  void useSuperDocCommand(applicationCommandId);
  void _commandParams;
  void cmdState.reason;
  const immediate: CommandExecutionResult = cmdState.execute();
  const settled: Promise<CommandExecutionResult> = cmdState.executeAsync();
  void immediate;
  void settled;
  void useSuperDocToolbar().commands;
  const search: SearchSnapshot = useSuperDocSearch();
  void search.canReplace;
  // Required on the snapshot every consumer surface returns; optional only on
  // the deprecated SearchSlice so old implementations keep compiling.
  const _canReplaceAll: AssertEqual<SearchSnapshot['canReplaceAll'], boolean> = true;
  void _canReplaceAll;
  // The hook takes no arguments; an added required parameter must fail here.
  const _searchParams: AssertEqual<Parameters<typeof useSuperDocSearch>, []> = true;
  void _searchParams;
}
void _reactProbe;

// The controller factory accepts a structural host.
declare const host: SuperDocLike;
void (() => createSuperDocUI({ superdoc: host }));

void [
  _has,
  _ids,
  _commandIdAcceptsString,
  _getParams,
  _execute,
  _executeAsync,
  _handleExecute,
  _handleExecuteAsync,
  _toolbarExecute,
  _toolbarExecuteAsync,
];
