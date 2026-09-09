/**
 * SuperDoc public facade: `superdoc/ui` entry.
 *
 * v2-native browser-only UI controller. This entry exposes
 * `createSuperDocUI`, the controller's slice/handle types, and the public
 * Document API shapes the controller surfaces.
 *
 * v2 NOTE: this is NOT the v1 re-export. `superdoc@2` removed the v1 editor
 * package, so this facade routes through the local, self-contained v2 UI
 * controller under `./ui/**`. The controller is a thin layer over the public
 * v2 active-editor facade (`superdoc.activeEditor`), its read-only-guarded
 * browser Document API (`activeEditor.doc`, async-capable in browser), and
 * SuperDoc events — no v1 editor command/state/view/chain surface and no
 * private v2 runtime packages are imported. SDK/headless document automation
 * remains synchronous on its own surface.
 *
 * Rules for this file:
 *   - AIDEV-NOTE: Named exports only. No `export *`.
 *   - AIDEV-NOTE: Re-export source MUST stay the local `./ui/**` v2-native
 *     controller. Do NOT re-introduce the v1 editor UI subpath — that surface
 *     was removed in `superdoc@2` and `check-private-core.cjs` forbids any v1
 *     editor artifact in the emitted package.
 *   - AIDEV-NOTE: `verify-public-facade-emit.cjs` parses this file and verifies
 *     the emitted declarations expose exactly these named exports.
 */

export { createSuperDocUI } from './ui/create-super-doc-ui.js';
export { shallowEqual } from './ui/equality.js';
export { BUILT_IN_COMMAND_IDS } from './ui/commands.js';

export type {
  // Reactive substrate
  EqualityFn,
  SelectorFn,
  Subscribable,
  // Controller
  SuperDocUI,
  BorrowedSuperDocUI,
  SuperDocUIOptions,
  SuperDocUIState,
  SuperDocUIScope,
  SuperDocLike,
  SuperDocEditorLike,
  // Command surface
  CommandHandle,
  CommandState,
  CommandExecutionResult,
  WorkflowReceipt,
  WorkflowActionResult,
  WorkflowScrollResult,
  SelectionRestoreResult,
  SuperDocUIReason,
  CommandId,
  CommandsHandle,
  ContextMenuItem,
  ContextMenuHandle,
  SearchController,
  SearchHandle,
  SearchQueryOptions,
  // The argument a custom command receives. Exported so the callback can be
  // extracted into a named function or stored in a typed variable; without it
  // the only way to annotate one is to leave it inline and rely on contextual
  // typing. `CustomCommandRegistration` names it in both `execute` and
  // `getState`, so a consumer implementing that interface is required to name a
  // type they could not import.
  CustomCommandContext,
  CustomCommandHandle,
  CustomCommandHandleState,
  CustomCommandRegistration,
  CustomCommandRegistrationResult,
  MetadataHandle,
  // Handles
  SelectionHandle,
  ToolbarHandle,
  BuiltInCommandId,
  ToolbarCommandId,
  CommentsHandle,
  TrackChangesHandle,
  ContentControlsHandle,
  ContentControlFocusResult,
  ContentControlHighlightResult,
  FontsHandle,
  ZoomHandle,
  DocumentHandle,
  ViewportHandle,
  StylesHandle,
  ActiveParagraphStyle,
  // Slices
  SliceStatus,
  SelectionSlice,
  SelectionCapture,
  CommentAnchorCapture,
  ToolbarSnapshotSlice,
  CommentsSlice,
  TrackChangesSlice,
  ContentControlsSlice,
  FontsSlice,
  ZoomSlice,
  DocumentSlice,
  StylesSlice,
  SearchSnapshot,
  SearchSlice,
  // Style catalogue shapes (re-surfaced from @superdoc/document-api)
  StyleCatalogView,
  StyleCatalogItemType,
  StyleCatalogFilterType,
  StyleProvenance,
  StyleCatalogItemVisibility,
  StyleCatalogItemUsage,
  StyleCatalogItemPreview,
  StyleCatalogItem,
  StyleCatalogDefaults,
  StyleCatalogDiagnostic,
  StyleCatalogSourceStatus,
  StylesGetCatalogInput,
  StylesGetCatalogResult,
  // Item / option shapes
  CommentInfo,
  CommentsListQuery,
  TrackChangeInfo,
  TrackChangePointHit,
  TrackChangesItem,
  FontFamilyOption,
  FontSizeOption,
  // Addresses
  CommentAddress,
  TrackedChangeAddress,
  ContentControlViewportAddress,
  ViewportEntityAddress,
  ViewportEntityHit,
  ViewportContext,
  // Viewport geometry
  ViewportRect,
  ViewportGetRectInput,
  ViewportRectResult,
  // Re-surfaced public Document API shapes. `BrowserDocumentApi` is what the
  // controller hands back on `CustomCommandContext.doc`, so a consumer writing
  // a custom command needs to be able to name it. `PartialBrowserDocumentApi`
  // is the input side: what a duck-typed host may supply as `activeEditor.doc`.
  // `DocumentApi` is the synchronous SDK counterpart.
  BrowserDocumentApi,
  PartialBrowserDocumentApi,
  DocumentApi,
  Receipt,
  SelectionInfo,
  SelectionTarget,
  SelectionPoint,
  TextTarget,
  TextAddress,
  ScrollIntoViewInput,
  ScrollIntoViewOutput,
  EntityAddress,
  CommentsListResult,
  TrackChangesListResult,
  ContentControlsListResult,
  ContentControlInfo,
  RichContentInsertInput,
  SDHtmlMarkdownSupportCheckResult,
} from './ui/types.js';
