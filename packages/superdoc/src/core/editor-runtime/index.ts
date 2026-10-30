// Internal SuperDoc editor-runtime contract barrel.
//
// This is the internal entry point shared shell code imports to talk to a
// mounted editor through the runtime boundary. It is NOT part of the public
// `superdoc` SDK surface. See `types.ts` for the boundary rules and the
// The concrete editor implementations plug into this contract through adapters.

export type {
  // identity + lifecycle
  EditorRuntimeKind,
  EditorRuntimeId,
  EditorRuntimeDocumentMode,
  EditorRuntimeUser,
  EditorRuntimeState,
  // the runtime
  EditorRuntime,
  EditorRuntimeSnapshot,
  // capabilities
  EditorRuntimeCapabilities,
  RuntimeLifecycleCapabilities,
  RuntimeSelectionCapabilities,
  RuntimeCommandCapabilities,
  RuntimeFindReplaceCapabilities,
  RuntimeAiCapabilities,
  RuntimeCommentCapabilities,
  RuntimeTrackedChangeCapabilities,
  RuntimeToolbarCapabilities,
  RuntimeLayoutCapabilities,
  RuntimeZoomCapabilities,
  RuntimeNavigationCapabilities,
  RuntimePersistenceCapabilities,
  // commands + results
  EditorRuntimeCommand,
  EditorRuntimeCommandKind,
  EditorRuntimeCommandResult,
  EditorRuntimeRejectionCode,
  EditorRuntimeNoopReason,
  // reads + snapshots
  EditorRuntimeSelectionSnapshot,
  EditorRuntimeFindSessionSnapshot,
  EditorRuntimeToolbarState,
  EditorRuntimeLayoutSnapshot,
  // positions
  EditorRuntimePositionToken,
  // options + targets
  EditorRuntimeFocusOptions,
  EditorRuntimeSaveOptions,
  EditorRuntimeExportOptions,
  EditorRuntimeNavigationTarget,
  // events
  EditorRuntimeEvent,
  EditorRuntimeListener,
  EditorRuntimeUnsubscribe,
  // neutral JSON helpers
  RuntimeJsonPrimitive,
  RuntimeJsonValue,
  RuntimeJsonObject,
} from './types.js';
