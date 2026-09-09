/**
 * SuperDoc public facade: root entry.
 *
 * The v2 branch exposes a single root package surface plus CSS assets. V1
 * editor, converter, zipper, toolbar, and UI compatibility subpaths are not
 * part of superdoc@2.
 *
 * Rules for this file:
 *   - AIDEV-NOTE: Named exports only. No `export *` (the postbuild gate
 *     parses this file and rejects wildcards). This source export list
 *     IS the facade contract; `verify-public-facade-emit.cjs` derives
 *     the expected names from this file and asserts the emitted .d.ts /
 *     .d.cts match. Changing the surface here also updates the
 *     classification artifact in the same PR; skipping that fails the
 *     consumer-typecheck snapshot.
 */

// The common package is workspace-private. Source imports stay readable here;
// ensure-types.cjs strips and inlines the emitted declarations so consumers
// never resolve @superdoc/common from the packed package.
import { DOCX, PDF, HTML, getFileObject, compareVersions } from '@superdoc/common';
// @ts-expect-error Vite resolves DOCX asset URL imports; plain tsc does not.
import BlankDOCXAsset from '@superdoc/common/data/blank.docx?url';
/** URL to the blank DOCX template. */
export const BlankDOCX: string = BlankDOCXAsset;
export { DOCX, PDF, HTML, getFileObject, compareVersions };

// Source: ./core/SuperDoc.ts. The `.js` import specifier is intentional
// for ESM output and resolves to the .ts source during TypeScript builds.
export { SuperDoc } from '../core/SuperDoc.js';

// Source: ./core/theme/create-theme.ts
export { buildTheme } from '../core/theme/create-theme.js';
export { createTheme } from '../core/theme/create-theme.js';
export type { ThemeColors, ThemeConfig, ThemeResult, ThemeVariableOverrides } from '../core/theme/create-theme.js';

// Type source: ./core/types/index.js
export type { AwarenessState } from '../core/types/index.js';
export type { AwarenessUser } from '../core/types/index.js';
export type { BlockNavigationAddress } from '../core/types/index.js';
export type { BlocksListResult } from '@superdoc/document-api';
export type { BookmarkAddress } from '../core/types/index.js';
export type { BookmarkInfo } from '@superdoc/document-api';
export type { CanPerformPermissionParams } from '../core/types/index.js';
export type { CollaborationConfig } from '../core/types/index.js';
export type { CommentAddress } from '../core/types/index.js';
export type { CommentsType } from '../core/types/index.js';
export type { Config } from '../core/types/index.js';
export type { DirectSurfaceRequest } from '../core/types/index.js';
export type { DocRange } from '../core/types/index.js';
export type { Document } from '../core/types/index.js';
export type { DocumentCollaborationConfig } from '../core/types/index.js';
export type { DocumentDataSource } from '../core/types/index.js';
export type { DocumentSource } from '../core/types/index.js';
export type { DocumentUploadSource } from '../core/types/index.js';
export type { StructuredDocumentSource } from '../core/types/index.js';
export type { DocumentApi } from '@superdoc/document-api';
export type { DiffApplyOperationReceipt, DiffApplyResult, DiffApplyReviewItem } from '@superdoc/document-api';
export type { DocumentMode } from '../core/types/index.js';
export type { DocumentProtectionState } from '@superdoc/document-api';
export type { EntityAddress } from '@superdoc/document-api';
export type { EditorSurface } from '../core/types/index.js';
export type { EditorTransactionEvent } from '../core/types/index.js';
export type { EditorUpdateEvent } from '../core/types/index.js';
export type { ExportParams } from '../core/types/index.js';
export type { ExportType } from '../core/types/index.js';
export type { ExternalPopoverRenderContext } from '../core/types/index.js';
export type { HyperlinkActivationContext } from '../core/types/index.js';
export type { HyperlinkActivationHandler } from '../core/types/index.js';
export type { HyperlinkActivationResult } from '../core/types/index.js';
export type { HyperlinkRenderContext } from '../core/types/index.js';
export type { HyperlinkTarget } from '@superdoc/document-api';
export type { HyperlinksConfig } from '../core/types/index.js';
export type { ExternalSurfaceRenderContext } from '../core/types/index.js';
export type { FindReplaceContext } from '../core/types/index.js';
export type { FindReplaceHandle } from '../core/types/index.js';
export type { FindReplaceRenderContext } from '../core/types/index.js';
export type { FindReplaceResolution } from '../core/types/index.js';
export type {
  FontResolutionRecord,
  FontsChangedPayload,
  FontsChangedSource,
  FontsConfig,
  FontsResolvedPayload,
} from '../core/types/index.js';
export type { IntentSurfaceRequest } from '../core/types/index.js';
export type { Modules } from '../core/types/index.js';
export type { NavigableAddress } from '../core/types/index.js';
export type { PasswordPromptAttemptResult } from '../core/types/index.js';
export type { PasswordPromptConfig } from '../core/types/index.js';
export type { PasswordPromptContext } from '../core/types/index.js';
export type { PasswordPromptHandle } from '../core/types/index.js';
export type { PasswordPromptRenderContext } from '../core/types/index.js';
export type { PasswordPromptResolution } from '../core/types/index.js';
export type { PermissionResolver } from '../core/types/index.js';
export type { PermissionResolverParams } from '../core/types/index.js';
export type { ResolvedFindReplaceTexts } from '../core/types/index.js';
export type { ResolvedPasswordPromptTexts } from '../core/types/index.js';
export type { ResolveRangeOutput } from '@superdoc/document-api';
export type { ContentControlActiveChangePayload } from '../core/types/index.js';
export type { ContentControlClickPayload } from '../core/types/index.js';
export type { ContentControlRef } from '../core/types/index.js';
export type { SdtRef } from '../core/types/index.js';
export type { SearchMatch } from '../core/types/index.js';
export type { SelectionHandle } from './ui/types.js';
export type { SelectionInfo } from '@superdoc/document-api';
export type { StoryLocator } from '../core/types/index.js';
export type { SuperDocAwarenessUpdatePayload } from '../core/types/index.js';
export type { SuperDocCommentsListChangePayload } from '../core/types/index.js';
export type { SuperDocCommentsUpdatePayload } from '../core/types/index.js';
export type { SuperDocContentErrorPayload } from '../core/types/index.js';
export type { SuperDocDiagnosticCode } from '../core/types/index.js';
export type { SuperDocDiagnosticStage } from '../core/types/index.js';
export type { SuperDocDocumentModeChangePayload } from '../core/types/index.js';
export type { DocumentReplacementResult } from './document-replacement.js';
export type { SuperDocEditorPayload } from '../core/types/index.js';
export type { SuperDocExceptionDiagnosticPayload } from '../core/types/index.js';
export type { SuperDocExceptionEditorPayload } from '../core/types/index.js';
export type { SuperDocWorkerFailureDetail } from '../core/types/index.js';
export type { SuperDocExceptionHyperlinkPayload } from '../core/types/index.js';
export type { SuperDocExceptionToolbarPayload } from '../core/types/index.js';
export type { SuperDocExceptionPayload } from '../core/types/index.js';
export type { SuperDocExceptionCollaborationPayload } from '../core/types/index.js';
export type { SuperDocExceptionRestorePayload } from '../core/types/index.js';
export type { SuperDocExceptionStorePayload } from '../core/types/index.js';
export type { SuperDocFitWidthOptions } from '../core/types/index.js';
export type { SuperDocFontsApi, SuperDocFontFamily, SuperDocFontFace } from '../core/types/index.js';
export type { SuperDocFormattingMarksChangePayload } from '../core/types/index.js';
export type { SuperDocLayoutEngineOptions } from '../core/types/index.js';
export type { SuperDocLayoutEngineOptions as LayoutEngineOptions } from '../core/types/index.js';
export type { FlowBlock, FlowMode, Layout, Fragment as LayoutFragment, Page as LayoutPage } from '@superdoc/contracts';
export type { LayoutMetrics } from '@superdoc/layout-bridge';
export type { LayoutMode } from '@superdoc/painter-dom';
export type {
  CommentInteractionConfig,
  CommentsConfig,
  CommentsLayout,
  CommentsResponsiveConfig,
  TrackChangesInteractionConfig,
} from '../core/types/index.js';
export type { TrackChangeHighlightColors } from '../core/types/index.js';
export type { ContentControlsConfig } from '../core/types/index.js';
export type { RulerConfig } from '../core/types/index.js';
export type { FontFamilyOption } from './ui/types.js';
export type { ToolbarConfig } from '../core/types/index.js';
export type { SearchConfig, SearchFloatingConfig, SearchStrings } from '../core/types/index.js';
export type { ToolbarRegion } from '../core/types/index.js';
export type { ToolbarItemId } from '../core/types/index.js';
export type { ToolbarOptionalItemId } from '../core/types/index.js';
export type { ToolbarIconId } from '../core/types/index.js';
export type { ToolbarStringId } from '../core/types/index.js';
export type { ToolbarCustomItem } from '../core/types/index.js';
export type { ToolbarCustomButtonCommandId } from '../core/types/index.js';
export type { ToolbarCustomDropdownCommandId } from '../core/types/index.js';
export type { ToolbarCustomButtonConfig } from '../core/types/index.js';
export type { ToolbarCustomDropdownConfig } from '../core/types/index.js';
export type { ToolbarCustomSeparatorConfig } from '../core/types/index.js';
export type { ToolbarCustomOption } from '../core/types/index.js';
export type { ToolbarCustomItemSelectContext } from '../core/types/index.js';
export type { ToolbarCustomItemSelectHandler } from '../core/types/index.js';
export type { ToolbarCustomButton } from '../core/types/index.js';
export type { ToolbarCustomButtonCommand } from '../core/types/index.js';
export type { ToolbarCustomButtonContext } from '../core/types/index.js';
export type { ToolbarCustomButtonItem } from '../core/types/index.js';
export type { ToolbarCustomDropdownItem } from '../core/types/index.js';
export type { ToolbarCustomDropdownOption } from '../core/types/index.js';
export type { ToolbarCustomSeparatorItem } from '../core/types/index.js';
export type { ToolbarDropdownOption } from '../core/types/index.js';
export type { ToolbarFontOption } from '../core/types/index.js';
export type { LinkPopoverConfig } from '../core/types/index.js';
export type { LinkPopoverContext } from '../core/types/index.js';
export type { LinkPopoverResolution } from '../core/types/index.js';
export type { LinkPopoverResolver } from '../core/types/index.js';
export type { SuperDocLockedPayload } from '../core/types/index.js';
export type { SuperDocMeasurementUnit } from '../core/types/index.js';
export type { SuperDocMeasurementUnitChangePayload } from '../core/types/index.js';
export type { SuperDocPageCountKnownPayload } from '../core/types/index.js';
export type { SuperDocPageMarginsChangePayload } from '../core/types/index.js';
export type { SuperDocPaginationUpdatePayload } from '../core/types/index.js';
export type { SuperDocReadyPayload } from '../core/types/index.js';
export type { SuperDocState } from '../core/types/index.js';
export type { SuperDocTelemetryConfig } from '../core/types/index.js';
// `BorrowedSuperDocUI` is the type of `SuperDoc.ui`: the controller minus
// `destroy()`, because the instance owns teardown. `SuperDocUI` is the owned
// form returned by `createSuperDocUI()`. Both are exported here so the instance
// property resolves from the root entry alone; `superdoc/ui` remains the home of
// the controller factory and the rest of its type graph.
export type { BorrowedSuperDocUI } from './ui/types.js';
export type { SuperDocUI } from './ui/types.js';
export type { BuiltInCommandId, ToolbarCommandId } from './ui/types.js';
export type { SuperDocViewportChangePayload } from '../core/types/index.js';
export type { SuperDocViewportMetrics } from '../core/types/index.js';
export type { SuperDocZoomConfig } from '../core/types/index.js';
export type { SuperDocZoomMode } from '../core/types/index.js';
export type { SuperDocZoomPayload } from '../core/types/index.js';
export type { SuperDocZoomState } from '../core/types/index.js';
export type { SurfaceComponentProps } from '../core/types/index.js';
export type { SurfaceFloatingPlacement } from '../core/types/index.js';
export type { SurfaceHandle } from '../core/types/index.js';
export type { SurfaceMode } from '../core/types/index.js';
export type { SurfaceOutcome } from '../core/types/index.js';
export type { SurfaceRequest } from '../core/types/index.js';
export type { SurfaceResolution } from '../core/types/index.js';
export type { SurfaceResolver } from '../core/types/index.js';
export type { SurfacesModuleConfig } from '../core/types/index.js';
export type { TextAddress } from '@superdoc/document-api';
export type { TextSegment } from '@superdoc/document-api';
export type { TextTarget } from '@superdoc/document-api';
export type { TrackChangeAuthor } from '../core/types/index.js';
export type { TrackChangesAuthorColorsConfig } from '../core/types/index.js';
export type { TrackChangesConfig } from '../core/types/index.js';
export type { TrackChangesModuleConfig } from '../core/types/index.js';
export type { TrackChangesReplacementMode } from '../core/types/index.js';
export type { TrackChangesSemanticColorsConfig } from '../core/types/index.js';
export type { TrackedChangeSemanticColorKey } from '../core/types/index.js';
export type { TrackedChangeSemanticColorResolverInput } from '../core/types/index.js';
export type { TrackedChangeAddress } from '../core/types/index.js';
export type { CommentInteractionLevel } from '../core/types/index.js';
export type { InteractionConfig } from '../core/types/index.js';
export type { SurfacesConfig } from '../core/types/index.js';
export type { UIConfig } from '../core/types/index.js';
export type { UpgradeToCollaborationOptions } from '../core/types/index.js';
export type { V2CollaborationConfig } from '../core/types/index.js';
export type { User } from '../core/types/index.js';
export type { ViewOptions } from '../core/types/index.js';
export type { ViewingOptions } from '../core/types/index.js';
export type { ViewingTrackedChangesMode } from '../core/types/index.js';
export type { ViewingVisibilityConfig } from '../core/types/index.js';

// Source: ./core/extensions — v2 SuperDoc extension authoring API.
export { defineSuperDocExtension } from '../core/extensions/index.js';
export type { SuperDocActiveEditorExtensions } from '../core/extensions/index.js';
export type { SuperDocActiveEditorExtensionsCommands } from '../core/extensions/index.js';
export type { SuperDocActiveEditorExtensionsDiagnostics } from '../core/extensions/index.js';
export type { SuperDocAnchor } from '../core/extensions/index.js';
export type { SuperDocAnchorApi } from '../core/extensions/index.js';
export type { SuperDocAnchorCollection } from '../core/extensions/index.js';
export type { SuperDocAnchorStatus } from '../core/extensions/index.js';
export type { SuperDocAnchorTarget } from '../core/extensions/index.js';
export type { SuperDocCharRange } from '../core/extensions/index.js';
export type { SuperDocCommandApi } from '../core/extensions/index.js';
export type { SuperDocCommandExecuteContext } from '../core/extensions/index.js';
export type { SuperDocCommandState } from '../core/extensions/index.js';
export type { SuperDocCommandStateContext } from '../core/extensions/index.js';
export type { SuperDocDecoration } from '../core/extensions/index.js';
export type { SuperDocDecorationApi } from '../core/extensions/index.js';
export type { SuperDocDecorationContext } from '../core/extensions/index.js';
export type { SuperDocDecorationData } from '../core/extensions/index.js';
export type { SuperDocDecorationProvider } from '../core/extensions/index.js';
export type { SuperDocDisposableBag } from '../core/extensions/index.js';
export type { SuperDocExtension } from '../core/extensions/index.js';
export type { SuperDocExtensionActivateReturn } from '../core/extensions/index.js';
export type { SuperDocExtensionCapabilities } from '../core/extensions/index.js';
export type { SuperDocExtensionCommandHandle } from '../core/extensions/index.js';
export type { SuperDocExtensionCommandListEntry } from '../core/extensions/index.js';
export type { SuperDocExtensionCommandRegistration } from '../core/extensions/index.js';
export type { SuperDocExtensionCommandStateView } from '../core/extensions/index.js';
export type { SuperDocExtensionContext } from '../core/extensions/index.js';
export type { SuperDocExtensionDiagnostic } from '../core/extensions/index.js';
export type { SuperDocExtensionDiagnostics } from '../core/extensions/index.js';
export type { SuperDocExtensionDisposable } from '../core/extensions/index.js';
export type { SuperDocExtensionEventApi } from '../core/extensions/index.js';
export type { SuperDocExtensionPhase } from '../core/extensions/index.js';
export type { SuperDocExtensionSnapshot } from '../core/extensions/index.js';
export type { SuperDocExtensionStorage } from '../core/extensions/index.js';
export type { SuperDocGuardedDoc } from '../core/extensions/index.js';
export type { SuperDocGuardedDocQuery } from '../core/extensions/index.js';
export type { SuperDocGuardedDocSelection } from '../core/extensions/index.js';
export type { SuperDocInlineBoxAppearance } from '../core/extensions/index.js';
export type { SuperDocInlineBoxLayout } from '../core/extensions/index.js';
export type { SuperDocInlineBoxOptions } from '../core/extensions/index.js';
export type { SuperDocMutationAffect } from '../core/extensions/index.js';
export type { SuperDocMutationEvent } from '../core/extensions/index.js';
export type { SuperDocMutationFilter } from '../core/extensions/index.js';
export type { SuperDocMutationOrigin } from '../core/extensions/index.js';
export type { SuperDocPaintEvent } from '../core/extensions/index.js';
export type { SuperDocReceiptSuccess } from '../core/extensions/index.js';
export type { SuperDocSaveEvent } from '../core/extensions/index.js';
export type { SuperDocSelectionEvent } from '../core/extensions/index.js';
export type { SuperDocSelectionPoint } from '../core/extensions/index.js';
export type { SuperDocSelectionTarget } from '../core/extensions/index.js';
export type { SuperDocStoryLocator } from '../core/extensions/index.js';
export type { SuperDocTextAddress } from '../core/extensions/index.js';
export type { SuperDocTextTarget } from '../core/extensions/index.js';
export type { SuperDocVisibleRange } from '../core/extensions/index.js';
export type { SuperDocVisualApi } from '../core/extensions/index.js';
export type { SuperDocVisualHandle } from '../core/extensions/index.js';
export type { SuperDocVisualOptions } from '../core/extensions/index.js';
export type { SuperDocVisualTarget } from '../core/extensions/index.js';

// `compareVersions`, `DOCX`, `getFileObject`, `HTML`, `PDF` and `BlankDOCX`
// from `@superdoc/common` are handled at the top of this file
// (import-then-export pattern; see comment there for rationale).

// Type source: ./core/types/index.js
export type { ContextMenuConfig } from '../core/types/index.js';
export type { ContextMenuContext } from '../core/types/index.js';
export type { ContextMenuItem } from '../core/types/index.js';
export type { ContextMenuOpenContext } from '../core/types/index.js';
export type { ContextMenuResolvedItem } from '../core/types/index.js';
export type { ContextMenuResolvedSection } from '../core/types/index.js';
export type { ContextMenuSection } from '../core/types/index.js';
export type { ContextMenuSelectContext } from '../core/types/index.js';
export type { ContextMenuSelectPayload } from '../core/types/index.js';
export type { ContextMenuSelectReadiness } from '../core/types/index.js';
export type { FindReplaceConfig } from '../core/types/index.js';

// BlankDOCX is handled via the import-then-export pattern at the top of this file.
