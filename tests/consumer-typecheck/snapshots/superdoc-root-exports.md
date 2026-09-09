# superdoc root export inventory (SD-3212 PR A0)

Generated: 2026-09-08T17:10:47.590Z
Source: packed and installed `tests/consumer-typecheck/node_modules/superdoc`

## Counts

| Source | Path | Count |
|---|---|---|
| types.import | `./dist/superdoc/src/public/index.d.ts` | 271 |
| types.require | `./dist/superdoc/src/public/index.d.cts` | 271 |
| import | `./dist/superdoc.es.js` | 10 |
| require | `./dist/superdoc.cjs` | 10 |
| **union** |  | **271** |

## Divergences

- types.import only (not in types.require): 0
- types.require only (not in types.import): 0
- ESM only (not in CJS): 0
- CJS only (not in ESM): 0
- typed but no runtime export (phantom risk): 261
- runtime export but not typed (silent shadow on root): 0

### Type-only names (no runtime)

- `AwarenessState`
- `AwarenessUser`
- `BlockNavigationAddress`
- `BlocksListResult`
- `BookmarkAddress`
- `BookmarkInfo`
- `BorrowedSuperDocUI`
- `BuiltInCommandId`
- `CanPerformPermissionParams`
- `CollaborationConfig`
- `CommentAddress`
- `CommentInteractionConfig`
- `CommentInteractionLevel`
- `CommentsConfig`
- `CommentsLayout`
- `CommentsResponsiveConfig`
- `CommentsType`
- `Config`
- `ContentControlActiveChangePayload`
- `ContentControlClickPayload`
- `ContentControlRef`
- `ContentControlsConfig`
- `ContextMenuConfig`
- `ContextMenuContext`
- `ContextMenuItem`
- `ContextMenuOpenContext`
- `ContextMenuResolvedItem`
- `ContextMenuResolvedSection`
- `ContextMenuSection`
- `ContextMenuSelectContext`
- `ContextMenuSelectPayload`
- `ContextMenuSelectReadiness`
- `DiffApplyOperationReceipt`
- `DiffApplyResult`
- `DiffApplyReviewItem`
- `DirectSurfaceRequest`
- `DocRange`
- `Document`
- `DocumentApi`
- `DocumentCollaborationConfig`
- `DocumentDataSource`
- `DocumentMode`
- `DocumentProtectionState`
- `DocumentReplacementResult`
- `DocumentSource`
- `DocumentUploadSource`
- `EditorSurface`
- `EditorTransactionEvent`
- `EditorUpdateEvent`
- `EntityAddress`
- `ExportParams`
- `ExportType`
- `ExternalPopoverRenderContext`
- `ExternalSurfaceRenderContext`
- `FindReplaceConfig`
- `FindReplaceContext`
- `FindReplaceHandle`
- `FindReplaceRenderContext`
- `FindReplaceResolution`
- `FlowBlock`
- `FlowMode`
- `FontFamilyOption`
- `FontsChangedPayload`
- `FontsChangedSource`
- `FontsResolvedPayload`
- `HyperlinkActivationContext`
- `HyperlinkActivationHandler`
- `HyperlinkActivationResult`
- `HyperlinkRenderContext`
- `HyperlinkTarget`
- `HyperlinksConfig`
- `IntentSurfaceRequest`
- `InteractionConfig`
- `Layout`
- `LayoutEngineOptions`
- `LayoutFragment`
- `LayoutMetrics`
- `LayoutMode`
- `LayoutPage`
- `LinkPopoverConfig`
- `LinkPopoverContext`
- `LinkPopoverResolution`
- `LinkPopoverResolver`
- `Modules`
- `NavigableAddress`
- `PasswordPromptAttemptResult`
- `PasswordPromptConfig`
- `PasswordPromptContext`
- `PasswordPromptHandle`
- `PasswordPromptRenderContext`
- `PasswordPromptResolution`
- `PermissionResolver`
- `PermissionResolverParams`
- `ResolveRangeOutput`
- `ResolvedFindReplaceTexts`
- `ResolvedPasswordPromptTexts`
- `RulerConfig`
- `SdtRef`
- `SearchConfig`
- `SearchFloatingConfig`
- `SearchMatch`
- `SearchStrings`
- `SelectionHandle`
- `SelectionInfo`
- `StoryLocator`
- `StructuredDocumentSource`
- `SuperDocActiveEditorExtensions`
- `SuperDocActiveEditorExtensionsCommands`
- `SuperDocActiveEditorExtensionsDiagnostics`
- `SuperDocAnchor`
- `SuperDocAnchorApi`
- `SuperDocAnchorCollection`
- `SuperDocAnchorStatus`
- `SuperDocAnchorTarget`
- `SuperDocAwarenessUpdatePayload`
- `SuperDocCharRange`
- `SuperDocCommandApi`
- `SuperDocCommandExecuteContext`
- `SuperDocCommandState`
- `SuperDocCommandStateContext`
- `SuperDocCommentsListChangePayload`
- `SuperDocCommentsUpdatePayload`
- `SuperDocContentErrorPayload`
- `SuperDocDecoration`
- `SuperDocDecorationApi`
- `SuperDocDecorationContext`
- `SuperDocDecorationData`
- `SuperDocDecorationProvider`
- `SuperDocDiagnosticCode`
- `SuperDocDiagnosticStage`
- `SuperDocDisposableBag`
- `SuperDocDocumentModeChangePayload`
- `SuperDocEditorPayload`
- `SuperDocExceptionCollaborationPayload`
- `SuperDocExceptionDiagnosticPayload`
- `SuperDocExceptionEditorPayload`
- `SuperDocExceptionHyperlinkPayload`
- `SuperDocExceptionPayload`
- `SuperDocExceptionRestorePayload`
- `SuperDocExceptionStorePayload`
- `SuperDocExceptionToolbarPayload`
- `SuperDocExtension`
- `SuperDocExtensionActivateReturn`
- `SuperDocExtensionCapabilities`
- `SuperDocExtensionCommandHandle`
- `SuperDocExtensionCommandListEntry`
- `SuperDocExtensionCommandRegistration`
- `SuperDocExtensionCommandStateView`
- `SuperDocExtensionContext`
- `SuperDocExtensionDiagnostic`
- `SuperDocExtensionDiagnostics`
- `SuperDocExtensionDisposable`
- `SuperDocExtensionEventApi`
- `SuperDocExtensionPhase`
- `SuperDocExtensionSnapshot`
- `SuperDocExtensionStorage`
- `SuperDocFitWidthOptions`
- `SuperDocFontFace`
- `SuperDocFontFamily`
- `SuperDocFontsApi`
- `SuperDocFormattingMarksChangePayload`
- `SuperDocGuardedDoc`
- `SuperDocGuardedDocQuery`
- `SuperDocGuardedDocSelection`
- `SuperDocInlineBoxAppearance`
- `SuperDocInlineBoxLayout`
- `SuperDocInlineBoxOptions`
- `SuperDocLayoutEngineOptions`
- `SuperDocLockedPayload`
- `SuperDocMeasurementUnit`
- `SuperDocMeasurementUnitChangePayload`
- `SuperDocMutationAffect`
- `SuperDocMutationEvent`
- `SuperDocMutationFilter`
- `SuperDocMutationOrigin`
- `SuperDocPageCountKnownPayload`
- `SuperDocPageMarginsChangePayload`
- `SuperDocPaginationUpdatePayload`
- `SuperDocPaintEvent`
- `SuperDocReadyPayload`
- `SuperDocReceiptSuccess`
- `SuperDocSaveEvent`
- `SuperDocSelectionEvent`
- `SuperDocSelectionPoint`
- `SuperDocSelectionTarget`
- `SuperDocState`
- `SuperDocStoryLocator`
- `SuperDocTelemetryConfig`
- `SuperDocTextAddress`
- `SuperDocTextTarget`
- `SuperDocUI`
- `SuperDocViewportChangePayload`
- `SuperDocViewportMetrics`
- `SuperDocVisibleRange`
- `SuperDocVisualApi`
- `SuperDocVisualHandle`
- `SuperDocVisualOptions`
- `SuperDocVisualTarget`
- `SuperDocWorkerFailureDetail`
- `SuperDocZoomConfig`
- `SuperDocZoomMode`
- `SuperDocZoomPayload`
- `SuperDocZoomState`
- `SurfaceComponentProps`
- `SurfaceFloatingPlacement`
- `SurfaceHandle`
- `SurfaceMode`
- `SurfaceOutcome`
- `SurfaceRequest`
- `SurfaceResolution`
- `SurfaceResolver`
- `SurfacesConfig`
- `SurfacesModuleConfig`
- `TextAddress`
- `TextSegment`
- `TextTarget`
- `ThemeColors`
- `ThemeConfig`
- `ThemeResult`
- `ThemeVariableOverrides`
- `ToolbarCommandId`
- `ToolbarConfig`
- `ToolbarCustomButton`
- `ToolbarCustomButtonCommand`
- `ToolbarCustomButtonCommandId`
- `ToolbarCustomButtonConfig`
- `ToolbarCustomButtonContext`
- `ToolbarCustomButtonItem`
- `ToolbarCustomDropdownCommandId`
- `ToolbarCustomDropdownConfig`
- `ToolbarCustomDropdownItem`
- `ToolbarCustomDropdownOption`
- `ToolbarCustomItem`
- `ToolbarCustomItemSelectContext`
- `ToolbarCustomItemSelectHandler`
- `ToolbarCustomOption`
- `ToolbarCustomSeparatorConfig`
- `ToolbarCustomSeparatorItem`
- `ToolbarDropdownOption`
- `ToolbarFontOption`
- `ToolbarIconId`
- `ToolbarItemId`
- `ToolbarOptionalItemId`
- `ToolbarRegion`
- `ToolbarStringId`
- `TrackChangeAuthor`
- `TrackChangeHighlightColors`
- `TrackChangesAuthorColorsConfig`
- `TrackChangesModuleConfig`
- `TrackChangesSemanticColorsConfig`
- `TrackedChangeAddress`
- `TrackedChangeSemanticColorKey`
- `TrackedChangeSemanticColorResolverInput`
- `UIConfig`
- `UpgradeToCollaborationOptions`
- `User`
- `V2CollaborationConfig`
- `ViewOptions`
- `ViewingOptions`
- `ViewingTrackedChangesMode`
- `ViewingVisibilityConfig`

## Evidence table

| Name | dts | dcts | esm | cjs | fixtures | jsdoc | docs | examples | demos |
|---|---|---|---|---|---|---|---|---|---|
| `AwarenessState` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `AwarenessUser` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `BlankDOCX` | ✓ | ✓ | ✓ | ✓ | 1 |   | 1 | 2 | 0 |
| `BlockNavigationAddress` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `BlocksListResult` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `BookmarkAddress` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `BookmarkInfo` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `BorrowedSuperDocUI` | ✓ | ✓ |   |   | 2 |   | 1 | 0 | 0 |
| `BuiltInCommandId` | ✓ | ✓ |   |   | 2 |   | 1 | 0 | 0 |
| `CanPerformPermissionParams` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `CollaborationConfig` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `CommentAddress` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `CommentInteractionConfig` | ✓ | ✓ |   |   | 3 |   | 0 | 0 | 0 |
| `CommentInteractionLevel` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `CommentsConfig` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `CommentsLayout` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `CommentsResponsiveConfig` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `CommentsType` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `Config` | ✓ | ✓ |   |   | 31 |   | 7 | 3 | 0 |
| `ContentControlActiveChangePayload` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `ContentControlClickPayload` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `ContentControlRef` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `ContentControlsConfig` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `ContextMenuConfig` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `ContextMenuContext` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `ContextMenuItem` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `ContextMenuOpenContext` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `ContextMenuResolvedItem` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `ContextMenuResolvedSection` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `ContextMenuSection` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `ContextMenuSelectContext` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `ContextMenuSelectPayload` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `ContextMenuSelectReadiness` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `DOCX` | ✓ | ✓ | ✓ | ✓ | 1 |   | 353 | 73 | 0 |
| `DiffApplyOperationReceipt` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `DiffApplyResult` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `DiffApplyReviewItem` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `DirectSurfaceRequest` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `DocRange` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `Document` | ✓ | ✓ |   |   | 3 |   | 96 | 18 | 0 |
| `DocumentApi` | ✓ | ✓ |   |   | 3 |   | 2 | 0 | 0 |
| `DocumentCollaborationConfig` | ✓ | ✓ |   |   | 2 |   | 7 | 0 | 0 |
| `DocumentDataSource` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `DocumentMode` | ✓ | ✓ |   |   | 4 |   | 1 | 2 | 0 |
| `DocumentProtectionState` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `DocumentReplacementResult` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `DocumentSource` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `DocumentUploadSource` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `EditorSurface` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `EditorTransactionEvent` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `EditorUpdateEvent` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `EntityAddress` | ✓ | ✓ |   |   | 1 |   | 1 | 0 | 0 |
| `ExportParams` | ✓ | ✓ |   |   | 6 |   | 0 | 0 | 0 |
| `ExportType` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `ExternalPopoverRenderContext` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `ExternalSurfaceRenderContext` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `FindReplaceConfig` | ✓ | ✓ |   |   | 3 |   | 0 | 0 | 0 |
| `FindReplaceContext` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `FindReplaceHandle` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `FindReplaceRenderContext` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `FindReplaceResolution` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `FlowBlock` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `FlowMode` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `FontFamilyOption` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `FontsChangedPayload` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `FontsChangedSource` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `FontsResolvedPayload` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `HTML` | ✓ | ✓ | ✓ | ✓ | 1 |   | 51 | 0 | 0 |
| `HyperlinkActivationContext` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `HyperlinkActivationHandler` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `HyperlinkActivationResult` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `HyperlinkRenderContext` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `HyperlinkTarget` | ✓ | ✓ |   |   | 2 |   | 1 | 0 | 0 |
| `HyperlinksConfig` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `IntentSurfaceRequest` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `InteractionConfig` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `Layout` | ✓ | ✓ |   |   | 2 |   | 2 | 0 | 0 |
| `LayoutEngineOptions` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `LayoutFragment` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `LayoutMetrics` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `LayoutMode` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `LayoutPage` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `LinkPopoverConfig` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `LinkPopoverContext` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `LinkPopoverResolution` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `LinkPopoverResolver` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `Modules` | ✓ | ✓ |   |   | 3 |   | 0 | 0 | 0 |
| `NavigableAddress` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `PDF` | ✓ | ✓ | ✓ | ✓ | 1 |   | 3 | 0 | 0 |
| `PasswordPromptAttemptResult` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `PasswordPromptConfig` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `PasswordPromptContext` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `PasswordPromptHandle` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `PasswordPromptRenderContext` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `PasswordPromptResolution` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `PermissionResolver` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `PermissionResolverParams` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `ResolveRangeOutput` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `ResolvedFindReplaceTexts` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `ResolvedPasswordPromptTexts` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `RulerConfig` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `SdtRef` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `SearchConfig` | ✓ | ✓ |   |   | 3 |   | 0 | 0 | 0 |
| `SearchFloatingConfig` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `SearchMatch` | ✓ | ✓ |   |   | 3 |   | 0 | 0 | 0 |
| `SearchStrings` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `SelectionHandle` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SelectionInfo` | ✓ | ✓ |   |   | 1 |   | 1 | 0 | 0 |
| `StoryLocator` | ✓ | ✓ |   |   | 1 |   | 4 | 0 | 0 |
| `StructuredDocumentSource` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `SuperDoc` | ✓ | ✓ | ✓ | ✓ | 31 |   | 259 | 44 | 0 |
| `SuperDocActiveEditorExtensions` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocActiveEditorExtensionsCommands` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocActiveEditorExtensionsDiagnostics` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocAnchor` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocAnchorApi` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocAnchorCollection` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocAnchorStatus` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocAnchorTarget` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocAwarenessUpdatePayload` | ✓ | ✓ |   |   | 1 |   | 0 | 2 | 0 |
| `SuperDocCharRange` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocCommandApi` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocCommandExecuteContext` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocCommandState` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocCommandStateContext` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocCommentsListChangePayload` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `SuperDocCommentsUpdatePayload` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocContentErrorPayload` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `SuperDocDecoration` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocDecorationApi` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocDecorationContext` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocDecorationData` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocDecorationProvider` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocDiagnosticCode` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocDiagnosticStage` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocDisposableBag` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocDocumentModeChangePayload` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `SuperDocEditorPayload` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocExceptionCollaborationPayload` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `SuperDocExceptionDiagnosticPayload` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `SuperDocExceptionEditorPayload` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `SuperDocExceptionHyperlinkPayload` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `SuperDocExceptionPayload` | ✓ | ✓ |   |   | 3 |   | 0 | 0 | 0 |
| `SuperDocExceptionRestorePayload` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocExceptionStorePayload` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocExceptionToolbarPayload` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `SuperDocExtension` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `SuperDocExtensionActivateReturn` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocExtensionCapabilities` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocExtensionCommandHandle` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocExtensionCommandListEntry` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocExtensionCommandRegistration` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocExtensionCommandStateView` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocExtensionContext` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `SuperDocExtensionDiagnostic` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocExtensionDiagnostics` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocExtensionDisposable` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocExtensionEventApi` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocExtensionPhase` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocExtensionSnapshot` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocExtensionStorage` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocFitWidthOptions` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocFontFace` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocFontFamily` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocFontsApi` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocFormattingMarksChangePayload` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `SuperDocGuardedDoc` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocGuardedDocQuery` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocGuardedDocSelection` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocInlineBoxAppearance` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocInlineBoxLayout` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocInlineBoxOptions` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocLayoutEngineOptions` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `SuperDocLockedPayload` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocMeasurementUnit` | ✓ | ✓ |   |   | 3 |   | 0 | 0 | 0 |
| `SuperDocMeasurementUnitChangePayload` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocMutationAffect` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocMutationEvent` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocMutationFilter` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocMutationOrigin` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocPageCountKnownPayload` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `SuperDocPageMarginsChangePayload` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `SuperDocPaginationUpdatePayload` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `SuperDocPaintEvent` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocReadyPayload` | ✓ | ✓ |   |   | 3 |   | 0 | 0 | 0 |
| `SuperDocReceiptSuccess` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocSaveEvent` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocSelectionEvent` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocSelectionPoint` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocSelectionTarget` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocState` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `SuperDocStoryLocator` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocTelemetryConfig` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `SuperDocTextAddress` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocTextTarget` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocUI` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `SuperDocViewportChangePayload` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocViewportMetrics` | ✓ | ✓ |   |   | 3 |   | 0 | 0 | 0 |
| `SuperDocVisibleRange` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `SuperDocVisualApi` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `SuperDocVisualHandle` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `SuperDocVisualOptions` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `SuperDocVisualTarget` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `SuperDocWorkerFailureDetail` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `SuperDocZoomConfig` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocZoomMode` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SuperDocZoomPayload` | ✓ | ✓ |   |   | 2 |   | 2 | 0 | 0 |
| `SuperDocZoomState` | ✓ | ✓ |   |   | 3 |   | 0 | 0 | 0 |
| `SurfaceComponentProps` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SurfaceFloatingPlacement` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `SurfaceHandle` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `SurfaceMode` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SurfaceOutcome` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SurfaceRequest` | ✓ | ✓ |   |   | 3 |   | 0 | 0 | 0 |
| `SurfaceResolution` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SurfaceResolver` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `SurfacesConfig` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `SurfacesModuleConfig` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `TextAddress` | ✓ | ✓ |   |   | 1 |   | 9 | 0 | 0 |
| `TextSegment` | ✓ | ✓ |   |   | 1 |   | 1 | 0 | 0 |
| `TextTarget` | ✓ | ✓ |   |   | 1 |   | 13 | 0 | 0 |
| `ThemeColors` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `ThemeConfig` | ✓ | ✓ |   |   | 2 |   | 1 | 0 | 0 |
| `ThemeResult` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `ThemeVariableOverrides` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `ToolbarCommandId` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `ToolbarConfig` | ✓ | ✓ |   |   | 3 |   | 1 | 0 | 0 |
| `ToolbarCustomButton` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `ToolbarCustomButtonCommand` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `ToolbarCustomButtonCommandId` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `ToolbarCustomButtonConfig` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `ToolbarCustomButtonContext` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `ToolbarCustomButtonItem` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `ToolbarCustomDropdownCommandId` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `ToolbarCustomDropdownConfig` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `ToolbarCustomDropdownItem` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `ToolbarCustomDropdownOption` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `ToolbarCustomItem` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `ToolbarCustomItemSelectContext` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `ToolbarCustomItemSelectHandler` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `ToolbarCustomOption` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `ToolbarCustomSeparatorConfig` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `ToolbarCustomSeparatorItem` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `ToolbarDropdownOption` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `ToolbarFontOption` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `ToolbarIconId` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `ToolbarItemId` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `ToolbarOptionalItemId` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `ToolbarRegion` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `ToolbarStringId` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `TrackChangeAuthor` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `TrackChangeHighlightColors` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `TrackChangesAuthorColorsConfig` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `TrackChangesModuleConfig` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `TrackChangesSemanticColorsConfig` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `TrackedChangeAddress` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `TrackedChangeSemanticColorKey` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `TrackedChangeSemanticColorResolverInput` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `UIConfig` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `UpgradeToCollaborationOptions` | ✓ | ✓ |   |   | 3 |   | 0 | 0 | 0 |
| `User` | ✓ | ✓ |   |   | 1 |   | 2 | 0 | 0 |
| `V2CollaborationConfig` | ✓ | ✓ |   |   | 3 |   | 1 | 0 | 0 |
| `ViewOptions` | ✓ | ✓ |   |   | 1 |   | 0 | 0 | 0 |
| `ViewingOptions` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `ViewingTrackedChangesMode` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `ViewingVisibilityConfig` | ✓ | ✓ |   |   | 2 |   | 0 | 0 | 0 |
| `buildTheme` | ✓ | ✓ | ✓ | ✓ | 2 |   | 3 | 0 | 0 |
| `compareVersions` | ✓ | ✓ | ✓ | ✓ | 1 |   | 1 | 0 | 0 |
| `createTheme` | ✓ | ✓ | ✓ | ✓ | 2 |   | 5 | 0 | 0 |
| `defineSuperDocExtension` | ✓ | ✓ | ✓ | ✓ | 1 |   | 6 | 0 | 0 |
| `getFileObject` | ✓ | ✓ | ✓ | ✓ | 1 |   | 1 | 0 | 0 |
