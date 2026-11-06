/**
 * Consumer typecheck: the v2 custom-UI reason taxonomy resolves from the
 * canonical `superdoc/ui` package surface, and `CommandState.reason` is typed
 * as the stable `SuperDocUIReason` union — not free-form `string`, not `any`.
 *
 * This is the migration-only custom-UI posture (Workstream 0/2): there is no
 * `superdoc/headless-toolbar*` import path; custom UI uses `superdoc/ui`.
 */
import { createSuperDocUI, BUILT_IN_COMMAND_IDS } from 'superdoc/ui';
import type { CommandState, SuperDocUIReason } from 'superdoc/ui';

type IsAny<T> = 0 extends 1 & T ? true : false;
type AssertNotAny<T> = IsAny<T> extends true ? never : true;

// SuperDocUIReason resolves to a real union, not `any`.
const _real_SuperDocUIReason: AssertNotAny<SuperDocUIReason> = true;
void _real_SuperDocUIReason;

// CommandState.reason is usually the stable reason union, widened to admit
// verbatim host strings (see types.ts); taxonomy members remain assignable.
const _reason: SuperDocUIReason | (string & {}) | undefined = undefined as CommandState['reason'];
void _reason;

// Representative stable members are assignable.
const _unsupported: SuperDocUIReason = 'command-unsupported';
const _readonly: SuperDocUIReason = 'document-readonly';
const _trackedChangeDecisionsDisabled: SuperDocUIReason = 'tracked-change-decisions-disabled';
const _notReady: SuperDocUIReason = 'not-ready';
const _permissionDenied: SuperDocUIReason = 'permission-denied';
void _unsupported;
void _readonly;
void _trackedChangeDecisionsDisabled;
void _notReady;
void _permissionDenied;
const _deletedTextFormatting: SuperDocUIReason = 'deleted-text-formatting-unsupported';
void _deletedTextFormatting;

// Canonical runtime entry points still resolve from `superdoc/ui`.
void createSuperDocUI;
void BUILT_IN_COMMAND_IDS;
