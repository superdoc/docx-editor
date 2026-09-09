/**
 * Consumer typecheck: every public type from superdoc must resolve to
 * a real interface, not collapse to `any`, and not be missing.
 *
 * Each `AssertNotAny<T>` resolves to `never` when T is `any`, so the
 * `const _real_X: AssertNotAny<X> = true` lines fail to compile if X
 * has collapsed. A missing export shows up as TS2305 on the import.
 *
 * SD-3213a (post root facade flip): this file is no longer auto-generated
 * from `packages/superdoc/src/index.js`'s typedef block — that file is no
 * longer the canonical source of truth for the root contract after the
 * SD-3212 PR C root types flip. The canonical root surface is now
 * `packages/superdoc/src/public/index.ts`, locked by
 * `tests/consumer-typecheck/snapshots/superdoc-root-exports.json` and
 * classified at `tests/consumer-typecheck/snapshots/superdoc-root-classification.json`.
 *
 * When a new TYPE-ONLY root export lands (inDts true, inEsm/inCjs false
 * in the classification), add a corresponding
 * `import { X } from 'superdoc';` + `const _real_X: AssertNotAny<X> = true;`
 * line below. The `check-all-public-types-fixture.mjs` gate derives the
 * expected assertion set from the classification artifact and fails CI
 * if any type-only export is missing here, so you cannot silently land a
 * new root type without any-collapse coverage. The SD-2842 matrix
 * scenarios then exercise this file to catch the actual any-collapses.
 */
import type {
  AwarenessState,
  AwarenessUser,
  BlockNavigationAddress,
  BlocksListResult,
  BookmarkAddress,
  BookmarkInfo,
  BorrowedSuperDocUI,
  CanPerformPermissionParams,
  CollaborationConfig,
  V2CollaborationConfig,
  CommentAddress,
  CommentInteractionConfig,
  CommentInteractionLevel,
  CommentsLayout,
  CommentsResponsiveConfig,
  CommentsType,
  Config,
  ContentControlActiveChangePayload,
  ContentControlClickPayload,
  ContentControlRef,
  ContextMenuConfig,
  ContextMenuContext,
  ContextMenuItem,
  ContextMenuOpenContext,
  ContextMenuResolvedItem,
  ContextMenuResolvedSection,
  ContextMenuSection,
  ContextMenuSelectContext,
  ContextMenuSelectPayload,
  ContextMenuSelectReadiness,
  DiffApplyOperationReceipt,
  DiffApplyResult,
  DiffApplyReviewItem,
  DirectSurfaceRequest,
  DocRange,
  Document,
  DocumentDataSource,
  DocumentCollaborationConfig,
  DocumentSource,
  DocumentUploadSource,
  DocumentApi,
  DocumentMode,
  DocumentReplacementResult,
  DocumentProtectionState,
  EntityAddress,
  EditorSurface,
  EditorTransactionEvent,
  EditorUpdateEvent,
  ExportParams,
  ExportType,
  ExternalPopoverRenderContext,
  ExternalSurfaceRenderContext,
  FindReplaceConfig,
  FindReplaceContext,
  FindReplaceHandle,
  FindReplaceRenderContext,
  FindReplaceResolution,
  FlowBlock,
  FlowMode,
  FontFamilyOption,
  FontResolutionRecord,
  FontsChangedPayload,
  FontsChangedSource,
  FontsConfig,
  FontsResolvedPayload,
  HyperlinkActivationContext,
  HyperlinkActivationHandler,
  HyperlinkActivationResult,
  HyperlinkRenderContext,
  HyperlinkTarget,
  HyperlinksConfig,
  IntentSurfaceRequest,
  Layout,
  LayoutEngineOptions,
  LayoutFragment,
  LayoutMetrics,
  LayoutMode,
  LayoutPage,
  CommentsConfig,
  ToolbarCustomButton,
  ToolbarCustomButtonCommandId,
  ToolbarConfig,
  ToolbarRegion,
  ToolbarItemId,
  ToolbarOptionalItemId,
  ToolbarIconId,
  ToolbarStringId,
  ToolbarCustomItem,
  ToolbarCustomButtonConfig,
  ToolbarCustomDropdownConfig,
  ToolbarCustomDropdownCommandId,
  ToolbarCustomSeparatorConfig,
  ToolbarCustomOption,
  ToolbarCustomItemSelectContext,
  ToolbarCustomItemSelectHandler,
  BuiltInCommandId,
  ToolbarCommandId,
  ToolbarCustomButtonContext,
  ToolbarCustomButtonCommand,
  ToolbarCustomButtonItem,
  ToolbarCustomDropdownItem,
  ToolbarCustomDropdownOption,
  ToolbarCustomSeparatorItem,
  ToolbarDropdownOption,
  ToolbarFontOption,
  TrackChangeHighlightColors,
  ContentControlsConfig,
  LinkPopoverConfig,
  LinkPopoverContext,
  LinkPopoverResolution,
  LinkPopoverResolver,
  Modules,
  NavigableAddress,
  PasswordPromptAttemptResult,
  PasswordPromptConfig,
  PasswordPromptContext,
  PasswordPromptHandle,
  PasswordPromptRenderContext,
  PasswordPromptResolution,
  PermissionResolver,
  PermissionResolverParams,
  ResolvedFindReplaceTexts,
  ResolvedPasswordPromptTexts,
  ResolveRangeOutput,
  RulerConfig,
  SdtRef,
  SearchConfig,
  SearchFloatingConfig,
  SearchMatch,
  SearchStrings,
  SelectionHandle,
  SelectionInfo,
  StoryLocator,
  SuperDocActiveEditorExtensions,
  SuperDocActiveEditorExtensionsCommands,
  SuperDocActiveEditorExtensionsDiagnostics,
  SuperDocAnchor,
  SuperDocAnchorApi,
  SuperDocAnchorCollection,
  SuperDocAnchorStatus,
  SuperDocAnchorTarget,
  SuperDocAwarenessUpdatePayload,
  SuperDocCharRange,
  SuperDocCommandApi,
  SuperDocCommandExecuteContext,
  SuperDocCommandState,
  SuperDocCommandStateContext,
  SuperDocCommentsListChangePayload,
  SuperDocCommentsUpdatePayload,
  SuperDocContentErrorPayload,
  SuperDocDecoration,
  SuperDocDecorationApi,
  SuperDocDecorationContext,
  SuperDocDecorationData,
  SuperDocDecorationProvider,
  SuperDocDiagnosticCode,
  SuperDocDiagnosticStage,
  SuperDocDisposableBag,
  SuperDocDocumentModeChangePayload,
  SuperDocEditorPayload,
  SuperDocExceptionDiagnosticPayload,
  SuperDocExceptionEditorPayload,
  SuperDocExceptionHyperlinkPayload,
  SuperDocExceptionToolbarPayload,
  SuperDocExceptionPayload,
  SuperDocExceptionCollaborationPayload,
  SuperDocExceptionRestorePayload,
  SuperDocExceptionStorePayload,
  SuperDocExtension,
  SuperDocExtensionActivateReturn,
  SuperDocExtensionCapabilities,
  SuperDocExtensionCommandHandle,
  SuperDocExtensionCommandListEntry,
  SuperDocExtensionCommandRegistration,
  SuperDocExtensionCommandStateView,
  SuperDocExtensionContext,
  SuperDocExtensionDiagnostic,
  SuperDocExtensionDiagnostics,
  SuperDocExtensionDisposable,
  SuperDocExtensionEventApi,
  SuperDocExtensionPhase,
  SuperDocExtensionSnapshot,
  SuperDocExtensionStorage,
  SuperDocFitWidthOptions,
  SuperDocFontFace,
  SuperDocFontFamily,
  SuperDocFontsApi,
  SuperDocFormattingMarksChangePayload,
  SuperDocGuardedDoc,
  SuperDocGuardedDocQuery,
  SuperDocGuardedDocSelection,
  SuperDocInlineBoxAppearance,
  SuperDocInlineBoxLayout,
  SuperDocInlineBoxOptions,
  SuperDocLayoutEngineOptions,
  SuperDocLockedPayload,
  SuperDocMeasurementUnit,
  SuperDocMeasurementUnitChangePayload,
  SuperDocPageCountKnownPayload,
  SuperDocPageMarginsChangePayload,
  SuperDocPaginationUpdatePayload,
  SuperDocMutationAffect,
  SuperDocMutationEvent,
  SuperDocMutationFilter,
  SuperDocMutationOrigin,
  SuperDocPaintEvent,
  SuperDocReadyPayload,
  SuperDocReceiptSuccess,
  SuperDocSaveEvent,
  SuperDocSelectionEvent,
  SuperDocSelectionPoint,
  SuperDocSelectionTarget,
  SuperDocState,
  SuperDocStoryLocator,
  SuperDocTelemetryConfig,
  SuperDocTextAddress,
  SuperDocTextTarget,
  SuperDocUI,
  SuperDocViewportChangePayload,
  SuperDocViewportMetrics,
  SuperDocVisibleRange,
  SuperDocVisualApi,
  SuperDocVisualHandle,
  SuperDocVisualOptions,
  SuperDocVisualTarget,
  SuperDocWorkerFailureDetail,
  SuperDocZoomConfig,
  SuperDocZoomMode,
  SuperDocZoomPayload,
  SuperDocZoomState,
  SurfaceComponentProps,
  SurfaceFloatingPlacement,
  SurfaceHandle,
  SurfaceMode,
  SurfaceOutcome,
  SurfaceRequest,
  SurfaceResolution,
  SurfaceResolver,
  StructuredDocumentSource,
  SurfacesModuleConfig,
  ThemeColors,
  ThemeConfig,
  ThemeResult,
  ThemeVariableOverrides,
  TextAddress,
  TextSegment,
  TextTarget,
  TrackChangeAuthor,
  TrackChangesAuthorColorsConfig,
  TrackChangesConfig,
  TrackChangesInteractionConfig,
  TrackChangesModuleConfig,
  TrackChangesReplacementMode,
  TrackChangesSemanticColorsConfig,
  TrackedChangeAddress,
  TrackedChangeSemanticColorKey,
  TrackedChangeSemanticColorResolverInput,
  InteractionConfig,
  SurfacesConfig,
  UIConfig,
  UpgradeToCollaborationOptions,
  User,
  ViewOptions,
  ViewingOptions,
  ViewingTrackedChangesMode,
  ViewingVisibilityConfig,
} from 'superdoc';

// Helper: IsAny<T> resolves to `true` when T is `any`, otherwise false.
type IsAny<T> = 0 extends 1 & T ? true : false;
type AssertNotAny<T> = IsAny<T> extends true ? never : true;

// One assertion per type. If T is `any`, AssertNotAny<T> is `never` and
// the line below fails to compile with "Type 'true' is not assignable
// to type 'never'". If T is real, it compiles silently.
const _real_AwarenessState: AssertNotAny<AwarenessState> = true;
const _real_AwarenessUser: AssertNotAny<AwarenessUser> = true;
const _real_BlockNavigationAddress: AssertNotAny<BlockNavigationAddress> = true;
const _real_BlocksListResult: AssertNotAny<BlocksListResult> = true;
const _real_BookmarkAddress: AssertNotAny<BookmarkAddress> = true;
const _real_BookmarkInfo: AssertNotAny<BookmarkInfo> = true;
const _real_BorrowedSuperDocUI: AssertNotAny<BorrowedSuperDocUI> = true;
const _real_CanPerformPermissionParams: AssertNotAny<CanPerformPermissionParams> = true;
const _real_CollaborationConfig: AssertNotAny<CollaborationConfig> = true;
const _real_V2CollaborationConfig: AssertNotAny<V2CollaborationConfig> = true;
const _real_CommentAddress: AssertNotAny<CommentAddress> = true;
const _real_CommentInteractionConfig: AssertNotAny<CommentInteractionConfig> = true;
const _real_CommentInteractionLevel: AssertNotAny<CommentInteractionLevel> = true;
const _real_CommentsLayout: AssertNotAny<CommentsLayout> = true;
const _real_CommentsResponsiveConfig: AssertNotAny<CommentsResponsiveConfig> = true;
const _real_CommentsType: AssertNotAny<CommentsType> = true;
const _real_Config: AssertNotAny<Config> = true;
const _real_ContentControlActiveChangePayload: AssertNotAny<ContentControlActiveChangePayload> = true;
const _real_ContentControlClickPayload: AssertNotAny<ContentControlClickPayload> = true;
const _real_ContentControlRef: AssertNotAny<ContentControlRef> = true;
const _real_ContextMenuConfig: AssertNotAny<ContextMenuConfig> = true;
const _real_ContextMenuContext: AssertNotAny<ContextMenuContext> = true;
const _real_ContextMenuItem: AssertNotAny<ContextMenuItem> = true;
const _real_ContextMenuOpenContext: AssertNotAny<ContextMenuOpenContext> = true;
const _real_ContextMenuResolvedItem: AssertNotAny<ContextMenuResolvedItem> = true;
const _real_ContextMenuResolvedSection: AssertNotAny<ContextMenuResolvedSection> = true;
const _real_ContextMenuSection: AssertNotAny<ContextMenuSection> = true;
const _real_ContextMenuSelectContext: AssertNotAny<ContextMenuSelectContext> = true;
const _real_ContextMenuSelectPayload: AssertNotAny<ContextMenuSelectPayload> = true;
const _real_ContextMenuSelectReadiness: AssertNotAny<ContextMenuSelectReadiness> = true;
const _real_DiffApplyOperationReceipt: AssertNotAny<DiffApplyOperationReceipt> = true;
const _real_DiffApplyResult: AssertNotAny<DiffApplyResult> = true;
const _real_DiffApplyReviewItem: AssertNotAny<DiffApplyReviewItem> = true;
const _real_DirectSurfaceRequest: AssertNotAny<DirectSurfaceRequest> = true;
const _real_DocRange: AssertNotAny<DocRange> = true;
const _real_Document: AssertNotAny<Document> = true;
const _real_DocumentDataSource: AssertNotAny<DocumentDataSource> = true;
const _real_DocumentCollaborationConfig: AssertNotAny<DocumentCollaborationConfig> = true;
const _real_DocumentSource: AssertNotAny<DocumentSource> = true;
const _real_DocumentUploadSource: AssertNotAny<DocumentUploadSource> = true;
const _real_DocumentApi: AssertNotAny<DocumentApi> = true;
const _real_DocumentMode: AssertNotAny<DocumentMode> = true;
const _real_DocumentReplacementResult: AssertNotAny<DocumentReplacementResult> = true;
const _real_DocumentProtectionState: AssertNotAny<DocumentProtectionState> = true;
const _real_EntityAddress: AssertNotAny<EntityAddress> = true;
const _real_EditorSurface: AssertNotAny<EditorSurface> = true;
const _real_EditorTransactionEvent: AssertNotAny<EditorTransactionEvent> = true;
const _real_EditorUpdateEvent: AssertNotAny<EditorUpdateEvent> = true;
const _real_ExportParams: AssertNotAny<ExportParams> = true;
const _real_ExportType: AssertNotAny<ExportType> = true;
const _real_ExternalPopoverRenderContext: AssertNotAny<ExternalPopoverRenderContext> = true;
const _real_ExternalSurfaceRenderContext: AssertNotAny<ExternalSurfaceRenderContext> = true;
const _real_FindReplaceConfig: AssertNotAny<FindReplaceConfig> = true;
const _real_FindReplaceContext: AssertNotAny<FindReplaceContext> = true;
const _real_FindReplaceHandle: AssertNotAny<FindReplaceHandle> = true;
const _real_FindReplaceRenderContext: AssertNotAny<FindReplaceRenderContext> = true;
const _real_FindReplaceResolution: AssertNotAny<FindReplaceResolution> = true;
const _real_FlowBlock: AssertNotAny<FlowBlock> = true;
const _real_FlowMode: AssertNotAny<FlowMode> = true;
const _real_FontFamilyOption: AssertNotAny<FontFamilyOption> = true;
const _real_FontResolutionRecord: AssertNotAny<FontResolutionRecord> = true;
const _real_FontsChangedPayload: AssertNotAny<FontsChangedPayload> = true;
const _real_FontsChangedSource: AssertNotAny<FontsChangedSource> = true;
const _real_FontsConfig: AssertNotAny<FontsConfig> = true;
const _real_FontsResolvedPayload: AssertNotAny<FontsResolvedPayload> = true;
const _real_HyperlinkActivationContext: AssertNotAny<HyperlinkActivationContext> = true;
const _real_HyperlinkActivationHandler: AssertNotAny<HyperlinkActivationHandler> = true;
const _real_HyperlinkActivationResult: AssertNotAny<HyperlinkActivationResult> = true;
const _real_HyperlinkRenderContext: AssertNotAny<HyperlinkRenderContext> = true;
const _real_HyperlinkTarget: AssertNotAny<HyperlinkTarget> = true;
const _real_HyperlinksConfig: AssertNotAny<HyperlinksConfig> = true;
const _real_IntentSurfaceRequest: AssertNotAny<IntentSurfaceRequest> = true;
const _real_Layout: AssertNotAny<Layout> = true;
const _real_LayoutEngineOptions: AssertNotAny<LayoutEngineOptions> = true;
const _real_LayoutFragment: AssertNotAny<LayoutFragment> = true;
const _real_LayoutMetrics: AssertNotAny<LayoutMetrics> = true;
const _real_LayoutMode: AssertNotAny<LayoutMode> = true;
const _real_LayoutPage: AssertNotAny<LayoutPage> = true;
const _real_CommentsConfig: AssertNotAny<CommentsConfig> = true;
const _real_ToolbarCustomButton: AssertNotAny<ToolbarCustomButton> = true;
const _real_ToolbarCustomButtonCommandId: AssertNotAny<ToolbarCustomButtonCommandId> = true;
const _real_ToolbarConfig: AssertNotAny<ToolbarConfig> = true;
const _real_ToolbarRegion: AssertNotAny<ToolbarRegion> = true;
const _real_ToolbarItemId: AssertNotAny<ToolbarItemId> = true;
const _real_ToolbarOptionalItemId: AssertNotAny<ToolbarOptionalItemId> = true;
const _real_ToolbarIconId: AssertNotAny<ToolbarIconId> = true;
const _real_ToolbarStringId: AssertNotAny<ToolbarStringId> = true;
const _real_ToolbarCustomItem: AssertNotAny<ToolbarCustomItem> = true;
const _real_ToolbarCustomButtonConfig: AssertNotAny<ToolbarCustomButtonConfig> = true;
const _real_ToolbarCustomDropdownConfig: AssertNotAny<ToolbarCustomDropdownConfig> = true;
const _real_ToolbarCustomDropdownCommandId: AssertNotAny<ToolbarCustomDropdownCommandId> = true;
const _real_ToolbarCustomSeparatorConfig: AssertNotAny<ToolbarCustomSeparatorConfig> = true;
const _real_ToolbarCustomOption: AssertNotAny<ToolbarCustomOption> = true;
const _real_ToolbarCustomItemSelectContext: AssertNotAny<ToolbarCustomItemSelectContext> = true;
const _real_ToolbarCustomItemSelectHandler: AssertNotAny<ToolbarCustomItemSelectHandler> = true;
const _real_BuiltInCommandId: AssertNotAny<BuiltInCommandId> = true;
const _real_ToolbarCommandId: AssertNotAny<ToolbarCommandId> = true;
const _real_ToolbarCustomButtonContext: AssertNotAny<ToolbarCustomButtonContext> = true;
const _real_ToolbarCustomButtonCommand: AssertNotAny<ToolbarCustomButtonCommand> = true;
const _real_ToolbarCustomButtonItem: AssertNotAny<ToolbarCustomButtonItem> = true;
const _real_ToolbarCustomDropdownItem: AssertNotAny<ToolbarCustomDropdownItem> = true;
const _real_ToolbarCustomDropdownOption: AssertNotAny<ToolbarCustomDropdownOption> = true;
const _real_ToolbarCustomSeparatorItem: AssertNotAny<ToolbarCustomSeparatorItem> = true;
const _real_ToolbarDropdownOption: AssertNotAny<ToolbarDropdownOption> = true;
const _real_ToolbarFontOption: AssertNotAny<ToolbarFontOption> = true;
const _real_TrackChangeHighlightColors: AssertNotAny<TrackChangeHighlightColors> = true;
const _real_ContentControlsConfig: AssertNotAny<ContentControlsConfig> = true;
const _real_LinkPopoverConfig: AssertNotAny<LinkPopoverConfig> = true;
const _real_LinkPopoverContext: AssertNotAny<LinkPopoverContext> = true;
const _real_LinkPopoverResolution: AssertNotAny<LinkPopoverResolution> = true;
const _real_LinkPopoverResolver: AssertNotAny<LinkPopoverResolver> = true;
const _real_Modules: AssertNotAny<Modules> = true;
const _real_NavigableAddress: AssertNotAny<NavigableAddress> = true;
const _real_PasswordPromptAttemptResult: AssertNotAny<PasswordPromptAttemptResult> = true;
const _real_PasswordPromptConfig: AssertNotAny<PasswordPromptConfig> = true;
const _real_PasswordPromptContext: AssertNotAny<PasswordPromptContext> = true;
const _real_PasswordPromptHandle: AssertNotAny<PasswordPromptHandle> = true;
const _real_PasswordPromptRenderContext: AssertNotAny<PasswordPromptRenderContext> = true;
const _real_PasswordPromptResolution: AssertNotAny<PasswordPromptResolution> = true;
const _real_PermissionResolver: AssertNotAny<PermissionResolver> = true;
const _real_PermissionResolverParams: AssertNotAny<PermissionResolverParams> = true;
const _real_ResolvedFindReplaceTexts: AssertNotAny<ResolvedFindReplaceTexts> = true;
const _real_ResolvedPasswordPromptTexts: AssertNotAny<ResolvedPasswordPromptTexts> = true;
const _real_ResolveRangeOutput: AssertNotAny<ResolveRangeOutput> = true;
const _real_RulerConfig: AssertNotAny<RulerConfig> = true;
const _real_SdtRef: AssertNotAny<SdtRef> = true;
const _real_SearchConfig: AssertNotAny<SearchConfig> = true;
const _real_SearchFloatingConfig: AssertNotAny<SearchFloatingConfig> = true;
const _real_SearchMatch: AssertNotAny<SearchMatch> = true;
const _real_SearchStrings: AssertNotAny<SearchStrings> = true;
const _real_SelectionHandle: AssertNotAny<SelectionHandle> = true;
const _real_SelectionInfo: AssertNotAny<SelectionInfo> = true;
const _real_StoryLocator: AssertNotAny<StoryLocator> = true;
const _real_SuperDocActiveEditorExtensions: AssertNotAny<SuperDocActiveEditorExtensions> = true;
const _real_SuperDocActiveEditorExtensionsCommands: AssertNotAny<SuperDocActiveEditorExtensionsCommands> = true;
const _real_SuperDocActiveEditorExtensionsDiagnostics: AssertNotAny<SuperDocActiveEditorExtensionsDiagnostics> = true;
const _real_SuperDocAnchor: AssertNotAny<SuperDocAnchor> = true;
const _real_SuperDocAnchorApi: AssertNotAny<SuperDocAnchorApi> = true;
const _real_SuperDocAnchorCollection: AssertNotAny<SuperDocAnchorCollection> = true;
const _real_SuperDocAnchorStatus: AssertNotAny<SuperDocAnchorStatus> = true;
const _real_SuperDocAnchorTarget: AssertNotAny<SuperDocAnchorTarget> = true;
const _real_SuperDocAwarenessUpdatePayload: AssertNotAny<SuperDocAwarenessUpdatePayload> = true;
const _real_SuperDocCharRange: AssertNotAny<SuperDocCharRange> = true;
const _real_SuperDocCommandApi: AssertNotAny<SuperDocCommandApi> = true;
const _real_SuperDocCommandExecuteContext: AssertNotAny<SuperDocCommandExecuteContext> = true;
const _real_SuperDocCommandState: AssertNotAny<SuperDocCommandState> = true;
const _real_SuperDocCommandStateContext: AssertNotAny<SuperDocCommandStateContext> = true;
const _real_SuperDocCommentsListChangePayload: AssertNotAny<SuperDocCommentsListChangePayload> = true;
const _real_SuperDocCommentsUpdatePayload: AssertNotAny<SuperDocCommentsUpdatePayload> = true;
const _real_SuperDocContentErrorPayload: AssertNotAny<SuperDocContentErrorPayload> = true;
const _real_SuperDocDecoration: AssertNotAny<SuperDocDecoration> = true;
const _real_SuperDocDecorationApi: AssertNotAny<SuperDocDecorationApi> = true;
const _real_SuperDocDecorationContext: AssertNotAny<SuperDocDecorationContext> = true;
const _real_SuperDocDecorationData: AssertNotAny<SuperDocDecorationData> = true;
const _real_SuperDocDecorationProvider: AssertNotAny<SuperDocDecorationProvider> = true;
const _real_SuperDocDiagnosticCode: AssertNotAny<SuperDocDiagnosticCode> = true;
const _real_SuperDocDiagnosticStage: AssertNotAny<SuperDocDiagnosticStage> = true;
const _real_SuperDocDisposableBag: AssertNotAny<SuperDocDisposableBag> = true;
const _real_SuperDocDocumentModeChangePayload: AssertNotAny<SuperDocDocumentModeChangePayload> = true;
const _real_SuperDocEditorPayload: AssertNotAny<SuperDocEditorPayload> = true;
const _real_SuperDocExceptionDiagnosticPayload: AssertNotAny<SuperDocExceptionDiagnosticPayload> = true;
const _real_SuperDocExceptionEditorPayload: AssertNotAny<SuperDocExceptionEditorPayload> = true;
const _real_SuperDocExceptionHyperlinkPayload: AssertNotAny<SuperDocExceptionHyperlinkPayload> = true;
const _real_SuperDocExceptionToolbarPayload: AssertNotAny<SuperDocExceptionToolbarPayload> = true;
const _real_SuperDocExceptionPayload: AssertNotAny<SuperDocExceptionPayload> = true;
const _real_SuperDocExceptionCollaborationPayload: AssertNotAny<SuperDocExceptionCollaborationPayload> = true;
const _real_SuperDocExceptionRestorePayload: AssertNotAny<SuperDocExceptionRestorePayload> = true;
const _real_SuperDocExceptionStorePayload: AssertNotAny<SuperDocExceptionStorePayload> = true;
const _real_SuperDocExtension: AssertNotAny<SuperDocExtension> = true;
const _real_SuperDocExtensionActivateReturn: AssertNotAny<SuperDocExtensionActivateReturn> = true;
const _real_SuperDocExtensionCapabilities: AssertNotAny<SuperDocExtensionCapabilities> = true;
const _real_SuperDocExtensionCommandHandle: AssertNotAny<SuperDocExtensionCommandHandle> = true;
const _real_SuperDocExtensionCommandListEntry: AssertNotAny<SuperDocExtensionCommandListEntry> = true;
const _real_SuperDocExtensionCommandRegistration: AssertNotAny<SuperDocExtensionCommandRegistration> = true;
const _real_SuperDocExtensionCommandStateView: AssertNotAny<SuperDocExtensionCommandStateView> = true;
const _real_SuperDocExtensionContext: AssertNotAny<SuperDocExtensionContext> = true;
const _real_SuperDocExtensionDiagnostic: AssertNotAny<SuperDocExtensionDiagnostic> = true;
const _real_SuperDocExtensionDiagnostics: AssertNotAny<SuperDocExtensionDiagnostics> = true;
const _real_SuperDocExtensionDisposable: AssertNotAny<SuperDocExtensionDisposable> = true;
const _real_SuperDocExtensionEventApi: AssertNotAny<SuperDocExtensionEventApi> = true;
const _real_SuperDocExtensionPhase: AssertNotAny<SuperDocExtensionPhase> = true;
const _real_SuperDocExtensionSnapshot: AssertNotAny<SuperDocExtensionSnapshot> = true;
const _real_SuperDocExtensionStorage: AssertNotAny<SuperDocExtensionStorage> = true;
const _real_SuperDocFitWidthOptions: AssertNotAny<SuperDocFitWidthOptions> = true;
const _real_SuperDocFontFace: AssertNotAny<SuperDocFontFace> = true;
const _real_SuperDocFontFamily: AssertNotAny<SuperDocFontFamily> = true;
const _real_SuperDocFontsApi: AssertNotAny<SuperDocFontsApi> = true;
const _real_SuperDocFormattingMarksChangePayload: AssertNotAny<SuperDocFormattingMarksChangePayload> = true;
const _real_SuperDocGuardedDoc: AssertNotAny<SuperDocGuardedDoc> = true;
const _real_SuperDocGuardedDocQuery: AssertNotAny<SuperDocGuardedDocQuery> = true;
const _real_SuperDocGuardedDocSelection: AssertNotAny<SuperDocGuardedDocSelection> = true;
const _real_SuperDocLayoutEngineOptions: AssertNotAny<SuperDocLayoutEngineOptions> = true;
const _real_SuperDocLockedPayload: AssertNotAny<SuperDocLockedPayload> = true;
const _real_SuperDocMeasurementUnit: AssertNotAny<SuperDocMeasurementUnit> = true;
const _real_SuperDocMeasurementUnitChangePayload: AssertNotAny<SuperDocMeasurementUnitChangePayload> = true;
const _real_SuperDocPageCountKnownPayload: AssertNotAny<SuperDocPageCountKnownPayload> = true;
const _real_SuperDocPageMarginsChangePayload: AssertNotAny<SuperDocPageMarginsChangePayload> = true;
const _real_SuperDocPaginationUpdatePayload: AssertNotAny<SuperDocPaginationUpdatePayload> = true;
const _real_SuperDocMutationAffect: AssertNotAny<SuperDocMutationAffect> = true;
const _real_SuperDocMutationEvent: AssertNotAny<SuperDocMutationEvent> = true;
const _real_SuperDocMutationFilter: AssertNotAny<SuperDocMutationFilter> = true;
const _real_SuperDocMutationOrigin: AssertNotAny<SuperDocMutationOrigin> = true;
const _real_SuperDocPaintEvent: AssertNotAny<SuperDocPaintEvent> = true;
const _real_SuperDocReadyPayload: AssertNotAny<SuperDocReadyPayload> = true;
const _real_SuperDocReceiptSuccess: AssertNotAny<SuperDocReceiptSuccess> = true;
const _real_SuperDocSaveEvent: AssertNotAny<SuperDocSaveEvent> = true;
const _real_SuperDocSelectionEvent: AssertNotAny<SuperDocSelectionEvent> = true;
const _real_SuperDocSelectionPoint: AssertNotAny<SuperDocSelectionPoint> = true;
const _real_SuperDocSelectionTarget: AssertNotAny<SuperDocSelectionTarget> = true;
const _real_SuperDocState: AssertNotAny<SuperDocState> = true;
const _real_SuperDocStoryLocator: AssertNotAny<SuperDocStoryLocator> = true;
const _real_SuperDocInlineBoxAppearance: AssertNotAny<SuperDocInlineBoxAppearance> = true;
const _real_SuperDocInlineBoxLayout: AssertNotAny<SuperDocInlineBoxLayout> = true;
const _real_SuperDocInlineBoxOptions: AssertNotAny<SuperDocInlineBoxOptions> = true;
const _real_SuperDocTelemetryConfig: AssertNotAny<SuperDocTelemetryConfig> = true;
const _real_SuperDocTextAddress: AssertNotAny<SuperDocTextAddress> = true;
const _real_SuperDocTextTarget: AssertNotAny<SuperDocTextTarget> = true;
const _real_SuperDocUI: AssertNotAny<SuperDocUI> = true;
const _real_SuperDocViewportChangePayload: AssertNotAny<SuperDocViewportChangePayload> = true;
const _real_SuperDocViewportMetrics: AssertNotAny<SuperDocViewportMetrics> = true;
const _real_SuperDocVisibleRange: AssertNotAny<SuperDocVisibleRange> = true;
const _real_SuperDocVisualApi: AssertNotAny<SuperDocVisualApi> = true;
const _real_SuperDocVisualHandle: AssertNotAny<SuperDocVisualHandle> = true;
const _real_SuperDocVisualOptions: AssertNotAny<SuperDocVisualOptions> = true;
const _real_SuperDocVisualTarget: AssertNotAny<SuperDocVisualTarget> = true;
const _real_SuperDocWorkerFailureDetail: AssertNotAny<SuperDocWorkerFailureDetail> = true;
const _real_SuperDocZoomConfig: AssertNotAny<SuperDocZoomConfig> = true;
const _real_SuperDocZoomMode: AssertNotAny<SuperDocZoomMode> = true;
const _real_SuperDocZoomPayload: AssertNotAny<SuperDocZoomPayload> = true;
const _real_SuperDocZoomState: AssertNotAny<SuperDocZoomState> = true;
const _real_SurfaceComponentProps: AssertNotAny<SurfaceComponentProps> = true;
const _real_SurfaceFloatingPlacement: AssertNotAny<SurfaceFloatingPlacement> = true;
const _real_SurfaceHandle: AssertNotAny<SurfaceHandle> = true;
const _real_SurfaceMode: AssertNotAny<SurfaceMode> = true;
const _real_SurfaceOutcome: AssertNotAny<SurfaceOutcome> = true;
const _real_SurfaceRequest: AssertNotAny<SurfaceRequest> = true;
const _real_SurfaceResolution: AssertNotAny<SurfaceResolution> = true;
const _real_SurfaceResolver: AssertNotAny<SurfaceResolver> = true;
const _real_StructuredDocumentSource: AssertNotAny<StructuredDocumentSource> = true;
const _real_SurfacesModuleConfig: AssertNotAny<SurfacesModuleConfig> = true;
const _real_ThemeColors: AssertNotAny<ThemeColors> = true;
const _real_ThemeConfig: AssertNotAny<ThemeConfig> = true;
const _real_ThemeResult: AssertNotAny<ThemeResult> = true;
const _real_ThemeVariableOverrides: AssertNotAny<ThemeVariableOverrides> = true;
const _real_TextAddress: AssertNotAny<TextAddress> = true;
const _real_TextSegment: AssertNotAny<TextSegment> = true;
const _real_TextTarget: AssertNotAny<TextTarget> = true;
const _real_TrackChangeAuthor: AssertNotAny<TrackChangeAuthor> = true;
const _real_TrackChangesAuthorColorsConfig: AssertNotAny<TrackChangesAuthorColorsConfig> = true;
const _real_TrackChangesConfig: AssertNotAny<TrackChangesConfig> = true;
const _real_TrackChangesInteractionConfig: AssertNotAny<TrackChangesInteractionConfig> = true;
const _real_TrackChangesModuleConfig: AssertNotAny<TrackChangesModuleConfig> = true;
const _real_TrackChangesReplacementMode: AssertNotAny<TrackChangesReplacementMode> = true;
const _real_TrackChangesSemanticColorsConfig: AssertNotAny<TrackChangesSemanticColorsConfig> = true;
const _real_TrackedChangeAddress: AssertNotAny<TrackedChangeAddress> = true;
const _real_TrackedChangeSemanticColorKey: AssertNotAny<TrackedChangeSemanticColorKey> = true;
const _real_TrackedChangeSemanticColorResolverInput: AssertNotAny<TrackedChangeSemanticColorResolverInput> = true;
const _real_InteractionConfig: AssertNotAny<InteractionConfig> = true;
const _real_SurfacesConfig: AssertNotAny<SurfacesConfig> = true;
const _real_UIConfig: AssertNotAny<UIConfig> = true;
const _real_UpgradeToCollaborationOptions: AssertNotAny<UpgradeToCollaborationOptions> = true;
const _real_User: AssertNotAny<User> = true;
const _real_ViewOptions: AssertNotAny<ViewOptions> = true;
const _real_ViewingOptions: AssertNotAny<ViewingOptions> = true;
const _real_ViewingTrackedChangesMode: AssertNotAny<ViewingTrackedChangesMode> = true;
const _real_ViewingVisibilityConfig: AssertNotAny<ViewingVisibilityConfig> = true;
