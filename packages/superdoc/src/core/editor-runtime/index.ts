// Internal SuperDoc editor-runtime contract barrel.
//
// This is the internal entry point shared shell code imports to talk to a
// mounted editor through the runtime boundary. It is NOT part of the public
// `superdoc` SDK surface. See `types.ts` for the boundary rules and the
// The concrete editor implementations plug into this contract through adapters.

export type {
  // identity + lifecycle
  EditorRuntimeId,
  EditorRuntimeDocumentMode,
  EditorRuntimeUser,
  EditorRuntimeState,
  // the runtime
  EditorRuntime,
  EditorRuntimeSnapshot,
  // capabilities
  EditorRuntimeCapabilities,
  // commands + results
  EditorRuntimeCommand,
  EditorRuntimeCommandKind,
  EditorRuntimeCommandResult,
  EditorRuntimeRejectionCode,
  // reads + snapshots
  EditorRuntimeSelectionSnapshot,
  EditorRuntimeFindSessionSnapshot,
  EditorRuntimeToolbarState,
  EditorRuntimeLayoutSnapshot,
  // positions
  EditorRuntimePositionToken,
  // options + targets
  EditorRuntimeFocusOptions,
  EditorRuntimeExportOptions,
  EditorRuntimeNavigationTarget,
  // events
  EditorRuntimeEvent,
  EditorRuntimeListener,
  EditorRuntimeUnsubscribe,
} from './types.js';
