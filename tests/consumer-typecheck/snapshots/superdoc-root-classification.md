# SD-3212 A1 — root classification

Generated: derived from superdoc-root-classification.json (aligned with current root export inventory)
Input: tests/consumer-typecheck/snapshots/superdoc-root-classification.json (276 names)

## Summary

| Bucket | Count |
|---|---|
| supported-root | 273 |
| legacy-root | 3 |
| move-to-subpath | 0 |
| internal-candidate | 0 |
| NEEDS-REVIEW | 0 |
| **total** | **276** |

Confidence: high=228, medium=48, low=0, needs-review=0.

## supported-root (273)

| Name | Confidence | Source | Rationale |
|---|---|---|---|
| `AwarenessState` | medium | collab | Collaboration/awareness type defined in core/types/index.ts. Customer-facing for collab-provider integrations (e.g., AwarenessState types the documented onAwarenessUpdate callback). |
| `AwarenessUser` | medium | collab | Collaboration/awareness type defined in core/types/index.ts. Extends User with an optional `color` field for consumer-supplied awareness color; typed on Config.user so the runtime override in SuperDoc#assignUserColor() is consumer-typable. |
| `BlockNavigationAddress` | high | doc-api | Document API navigation/address/selection type. Promoted into the root facade by SD-3185. |
| `BlocksListResult` | high | doc-api | Document API result type returned by activeEditor.doc.blocks.list(); useful for consumers typing block-listing workflows from the root package. |
| `BookmarkAddress` | high | doc-api | Document API navigation/address/selection type. Promoted into the root facade by SD-3185. |
| `BookmarkInfo` | high | doc-api | Document API result type returned by activeEditor.doc.bookmarks.get(); useful for consumers typing bookmark workflows from the root package. |
| `BorrowedSuperDocUI` | high | surface | Public type of SuperDoc.ui. Omits destroy because the SuperDoc instance owns controller teardown. |
| `BuiltInCommandId` | high | toolbar-config | Exact ids for commands built into the SuperDoc UI controller. Gives consumers autocomplete and a closed type when they do not use registered application commands. |
| `CanPerformPermissionParams` | high | config-supported | Configuration type for a supported feature. Input shape for SuperDoc#canPerformPermission, promoted from an anonymous inline parameter to a named public type so consumers get IDE help and the contract is stable across migrations. |
| `CollaborationConfig` | medium | config-supported | Configuration type for a supported feature. |
| `CommentAddress` | high | doc-api | Document API navigation/address/selection type. Promoted into the root facade by SD-3185. |
| `CommentInteractionConfig` | high | config-supported | Named client-side comment action policy accepted by InteractionConfig.comments. |
| `CommentInteractionLevel` | high | config-supported | Canonical comment-interaction policy level used by InteractionConfig.comments and exported for consumers configuring custom comment UI. |
| `CommentsConfig` | high | config-supported | Canonical comments presentation config type. Public extension surface for ui.comments; interaction policy lives on interaction.comments. |
| `CommentsLayout` | high | config-supported | Layout values accepted by the built-in comments UI configuration. |
| `CommentsResponsiveConfig` | high | config-supported | Named width-source and breakpoint options used by the automatic comments layout. |
| `CommentsType` | medium | comments-track | Comments/track-changes type used by Document API consumers. |
| `Config` | medium | config-supported | Configuration type for a supported feature. |
| `ContentControlActiveChangePayload` | high | config-supported | Payload for Config.onContentControlActiveChange. Customer-facing content-control callback type exported from src/public/index.ts. |
| `ContentControlClickPayload` | high | config-supported | Payload for Config.onContentControlClick. Customer-facing content-control callback type exported from src/public/index.ts. |
| `ContentControlRef` | high | config-supported | Canonical content-control reference used by public interaction callback payloads. |
| `ContentControlsConfig` | high | config-supported | Deprecated object form retained for v2 source compatibility; use boolean ui.contentControls. |
| `ContextMenuConfig` | high | context-menu | Canonical configuration for the built-in context menu, including application sections, visibility and availability predicates, and final-section transforms. |
| `ContextMenuItem` | high | context-menu | Canonical application item definition accepted by ContextMenuConfig.sections. |
| `ContextMenuOpenContext` | high | context-menu | Runtime-truthful editor snapshot passed to context-menu visibility, availability, and final-section callbacks. |
| `ContextMenuResolvedItem` | high | context-menu | Resolved menu item supplied to ContextMenuConfig.menuProvider after SuperDoc evaluates availability. |
| `ContextMenuResolvedSection` | high | context-menu | Resolved menu section accepted and returned by ContextMenuConfig.menuProvider. |
| `ContextMenuSection` | high | context-menu | Canonical section definition accepted by ContextMenuConfig.sections. |
| `ContextMenuSelectContext` | high | context-menu | The menu context handed to ContextMenuItem.onSelect. Supported root: part of the documented v2 replacement for the deprecated action callback. |
| `ContextMenuSelectPayload` | high | context-menu | Argument type of ContextMenuItem.onSelect. Supported root: a consumer extracting the handler into a typed function needs it by name. |
| `ContextMenuSelectReadiness` | high | context-menu | Repaint coordination carried on the onSelect document result. Supported root: reachable from ContextMenuSelectPayload. |
| `DOCX` | high | locked | Content-format constant. Heavily documented (133 doc mentions). Customer-facing. |
| `DiffApplyOperationReceipt` | high | doc-api | Document API receipt returned for one applied diff operation. |
| `DiffApplyResult` | high | doc-api | Document API result returned after applying a diff. |
| `DiffApplyReviewItem` | high | doc-api | Document API review item returned when a diff produces tracked changes. |
| `DirectSurfaceRequest` | medium | surface | Headless Surface API type. Public extension surface for custom UI integrations. |
| `DocRange` | medium | core | Customer-facing core API type or runtime export. Type-reachable through documented config / callback / event / method surfaces; runtime exports are documented utilities. |
| `Document` | high | core | Customer-facing core API type or runtime export. Consumer-supplied document descriptor used in Config.documents and now SuperDocState.documents; the public counterpart to the internal RuntimeDocument (which carries runtime-only fields and stays internal). |
| `DocumentApi` | high | doc-api | Customer-facing Document API handle type exposed through activeEditor.doc and used by public examples that type programmatic document operations from the root package. |
| `DocumentCollaborationConfig` | high | config-supported | Shared-document connection settings accepted by Document.collaboration and upgradeToCollaboration. |
| `DocumentDataSource` | high | config-supported | File and byte inputs accepted by Document.data and structured Config.document sources. |
| `DocumentMode` | medium | core | Customer-facing core API type or runtime export. Type-reachable through documented config / callback / event / method surfaces; runtime exports are documented utilities. |
| `DocumentProtectionState` | high | doc-api | Document API result type returned by activeEditor.doc.protection.get(); useful for consumers typing document-protection workflows from the root package. |
| `DocumentReplacementResult` | high | core | Confirmed replacement outcome shared by root and UI document methods without exposing host internals. |
| `DocumentSource` | high | config-supported | Canonical input accepted by Config.document, covering URL, file, byte, uploader, and structured sources. |
| `DocumentUploadSource` | high | config-supported | Compatibility shape for common uploader wrappers accepted by document normalization. |
| `EditorSurface` | medium | surface | Headless Surface API type. Public extension surface for custom UI integrations. |
| `EditorTransactionEvent` | medium | core | Customer-facing core API type or runtime export. Type-reachable through documented config / callback / event / method surfaces; runtime exports are documented utilities. |
| `EditorUpdateEvent` | medium | core | Customer-facing core API type or runtime export. Type-reachable through documented config / callback / event / method surfaces; runtime exports are documented utilities. |
| `EntityAddress` | high | doc-api | Document API entity navigation/address type for comments and tracked changes; used by receipts, navigation, and superdoc/ui viewport surfaces. |
| `ExportParams` | medium | core | Customer-facing core API type or runtime export. Type-reachable through documented config / callback / event / method surfaces; runtime exports are documented utilities. |
| `ExportType` | medium | core | Customer-facing core API type or runtime export. Type-reachable through documented config / callback / event / method surfaces; runtime exports are documented utilities. |
| `ExternalPopoverRenderContext` | high | hyperlinks | Deprecated alias retained for v2 source compatibility; use HyperlinkRenderContext. |
| `ExternalSurfaceRenderContext` | medium | surface | Headless Surface API type. Public extension surface for custom UI integrations. |
| `FindReplaceContext` | medium | find-replace | FindReplace surface API type. Public. |
| `FindReplaceHandle` | medium | find-replace | FindReplace surface API type. Public. |
| `FindReplaceRenderContext` | medium | find-replace | FindReplace surface API type. Public. |
| `FindReplaceResolution` | medium | find-replace | FindReplace surface API type. Public. |
| `FlowBlock` | high | layout-engine | Current shared layout-engine input contract exported from @superdoc/contracts and consumed by the v2 layout adapter, v2 host, layout bridge, and layout-engine tests. Useful for consumers typing custom layout projections and layout-engine integrations. |
| `FlowMode` | high | layout-engine | Current layout flow-mode union exported from @superdoc/contracts and used by Config.layoutEngineOptions.flowMode and the v2 layout runtime to select paginated versus semantic flow. |
| `FontFamilyOption` | high | font-system | Typed row accepted by ui.toolbar.fontOptions and returned by superdoc.fonts.getFontFamilyOptions(). |
| `FontResolutionRecord` | high | font-system | One typed result row returned by superdoc.fonts.getReport() and delivered through font report callbacks. |
| `FontsChangedPayload` | high | font-system | Payload passed to Config.onFontsChanged, superdoc.fonts.onReport(), and the fonts-changed event. |
| `FontsChangedSource` | high | font-system | Closed reason union carried by FontsChangedPayload.source so font-report handlers get autocomplete and exhaustive narrowing. |
| `FontsConfig` | high | font-system | Canonical startup configuration type for document font providers and bundled font assets. |
| `FontsResolvedPayload` | high | font-system | Initial font report passed to the deprecated Config.onFontsResolved callback and fonts-resolved event. |
| `HTML` | high | locked | Content-format constant. Heavily used (85 docs, 204 demos). Customer-facing. |
| `HyperlinkActivationContext` | high | hyperlinks | Context for the canonical top-level hyperlink activation handler. |
| `HyperlinkActivationHandler` | high | hyperlinks | Canonical callback for controlling hyperlink activation behavior. |
| `HyperlinkActivationResult` | high | hyperlinks | Canonical result union for default, suppressed, and application-owned hyperlink behavior. |
| `HyperlinkRenderContext` | high | hyperlinks | Framework-agnostic render context for application-owned hyperlink UI. |
| `HyperlinkTarget` | high | doc-api | Canonical Document API address returned by hyperlink activation and accepted by hyperlink read and write operations. |
| `HyperlinksConfig` | high | hyperlinks | Canonical top-level configuration for hyperlink activation behavior. |
| `IntentSurfaceRequest` | medium | surface | Headless Surface API type. Public extension surface for custom UI integrations. |
| `InteractionConfig` | high | config | Top-level configuration type split out of modules. Customer-facing. |
| `Layout` | high | layout-engine | Current shared layout output contract exported from @superdoc/contracts and consumed by the v2 render surface, layout bridge, painter, and layout-engine tests. Useful for consumers typing layout inspection and render integrations. |
| `LayoutEngineOptions` | high | layout-engine | Backwards-compatible public type alias to the current v2 SuperDocLayoutEngineOptions contract for Config.layoutEngineOptions. This preserves the useful customer-facing name without restoring the old PresentationEditor implementation. |
| `LayoutFragment` | high | layout-engine | Public alias of the current @superdoc/contracts Fragment layout contract. v2 layout and hit-testing code use this fragment shape for page render geometry and text mapping. |
| `LayoutMetrics` | high | layout-bridge | Current layout-bridge instrumentation metrics contract with timing fields for measurement, pagination, token resolution, and header/footer layout. Useful for consumers typing layout performance diagnostics. |
| `LayoutMode` | high | layout-painter | Current @superdoc/painter-dom layout display mode union (vertical, horizontal, book). This remains part of the page rendering/display layer used by v2. |
| `LayoutPage` | high | layout-engine | Public alias of the current @superdoc/contracts Page layout contract. v2 layout output and render surfaces use this page shape for pagination, geometry, and hit-testing workflows. |
| `LinkPopoverConfig` | high | link-popover | Deprecated alias retained for v2 source compatibility; use HyperlinksConfig. |
| `LinkPopoverContext` | high | link-popover | Deprecated alias retained for v2 source compatibility; use HyperlinkActivationContext. |
| `LinkPopoverResolution` | high | link-popover | Deprecated alias retained for v2 source compatibility; use HyperlinkActivationResult. |
| `LinkPopoverResolver` | high | link-popover | Deprecated alias retained for v2 source compatibility; use HyperlinkActivationHandler. |
| `Modules` | medium | core | Customer-facing core API type or runtime export. Type-reachable through documented config / callback / event / method surfaces; runtime exports are documented utilities. |
| `NavigableAddress` | high | doc-api | Document API navigation/address/selection type. Promoted into the root facade by SD-3185. |
| `PDF` | high | locked | Content-format constant. Customer-facing import/export selector. |
| `PasswordPromptAttemptResult` | medium | password-prompt | PasswordPrompt surface API type. Public. |
| `PasswordPromptConfig` | medium | password-prompt | PasswordPrompt surface API type. Public. |
| `PasswordPromptContext` | medium | password-prompt | PasswordPrompt surface API type. Public. |
| `PasswordPromptHandle` | medium | password-prompt | PasswordPrompt surface API type. Public. |
| `PasswordPromptRenderContext` | medium | password-prompt | PasswordPrompt surface API type. Public. |
| `PasswordPromptResolution` | medium | password-prompt | PasswordPrompt surface API type. Public. |
| `PermissionResolver` | high | config-supported | Callback type used by Config.permissionResolver and the deprecated Modules.comments.permissionResolver field. |
| `PermissionResolverParams` | high | config-supported | Payload passed to PermissionResolver callbacks. |
| `ResolveRangeOutput` | high | doc-api | Document API ranges.resolve result type implemented by the v2 range resolver adapter; useful for consumers typing range handles, targets, and preview metadata from the root package. |
| `ResolvedFindReplaceTexts` | medium | find-replace | FindReplace surface API type. Public. |
| `ResolvedPasswordPromptTexts` | medium | password-prompt | PasswordPrompt surface API type. Public. |
| `RulerConfig` | high | config-supported | Canonical startup options for the built-in Ruler surface. |
| `SdtRef` | high | config-supported | Deprecated alias retained for v2 source compatibility; use ContentControlRef. |
| `SearchConfig` | high | config-supported | Canonical startup options for the built-in Search surface. |
| `SearchFloatingConfig` | high | config-supported | Position and focus options used by SearchConfig. |
| `SearchMatch` | medium | core | Customer-facing core API type or runtime export. Type-reachable through documented config / callback / event / method surfaces; runtime exports are documented utilities. |
| `SearchStrings` | high | config-supported | Typed string overrides used by SearchConfig. |
| `SelectionHandle` | high | ui-controller | v2-native superdoc/ui selection handle type with current/capture/restore/anchor-rect methods; the supported migration path for deferred selection UI flows. |
| `SelectionInfo` | high | doc-api | Document API selection result returned by doc.selection.current(); v2 host and adapter expose the shape for selection-aware custom UI, comments, and extension workflows. |
| `StoryLocator` | high | doc-api | Document API navigation/address/selection type. Promoted into the root facade by SD-3185. |
| `StructuredDocumentSource` | high | config-supported | Metadata-bearing document source used for names, passwords, and v2 collaboration. |
| `SuperDoc` | medium | core | Customer-facing core API type or runtime export. Type-reachable through documented config / callback / event / method surfaces; runtime exports are documented utilities. |
| `SuperDocActiveEditorExtensions` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocActiveEditorExtensionsCommands` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocActiveEditorExtensionsDiagnostics` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocAnchor` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocAnchorApi` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocAnchorCollection` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocAnchorStatus` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocAnchorTarget` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocAwarenessUpdatePayload` | high | core | Payload emitted with the awareness-update event and passed to Config.onAwarenessUpdate; promoted to a named public type so callback signatures stop using inline shapes. |
| `SuperDocCharRange` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocCommandApi` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocCommandExecuteContext` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocCommandState` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocCommandStateContext` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocCommentsListChangePayload` | high | core | Payload passed to Config.onCommentsListChange and emitted with comments-list-change. |
| `SuperDocCommentsUpdatePayload` | high | core | Payload emitted with the comments-update event and passed to Config.onCommentsUpdate; promoted to a named public type so callback signatures stop using inline shapes. |
| `SuperDocContentErrorPayload` | high | core | Enriched document error passed to Config.onContentError, including the editor, document ID, and original source. |
| `SuperDocDecoration` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocDecorationApi` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocDecorationContext` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocDecorationData` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocDecorationProvider` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocDiagnosticCode` | high | diagnostics | Stable public diagnostic taxonomy code carried on SuperDocExceptionDiagnosticPayload.diagnosticCode. SuperDoc Diagnostics MVP. |
| `SuperDocDiagnosticStage` | high | diagnostics | Document-processing pipeline stage a diagnostic was raised from, carried on SuperDocExceptionDiagnosticPayload.diagnosticStage. SuperDoc Diagnostics MVP. |
| `SuperDocDisposableBag` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocDocumentModeChangePayload` | high | core | Payload emitted with document-mode-change after role restrictions are applied. |
| `SuperDocEditorPayload` | high | core | Wrapper payload emitted with editorBeforeCreate / editorCreate / collaboration-ready events; promoted to a named public type so callback signatures match the runtime wrapper instead of a bare Editor. |
| `SuperDocExceptionCollaborationPayload` | high | collab | Typed onException payload for collaboration connection failures, narrowed by collaborationReason. |
| `SuperDocExceptionDiagnosticPayload` | high | diagnostics | Member of the SuperDocExceptionPayload union; structured diagnostic translated from an internal v2-kernel diagnostic. Narrowed by 'diagnosticCode' in payload. SuperDoc Diagnostics MVP. |
| `SuperDocExceptionEditorPayload` | high | locked | Member of the SuperDocExceptionPayload union; named so consumers can discriminate the editor-lifecycle shape. SD-673 Phase 4D. |
| `SuperDocExceptionHyperlinkPayload` | high | hyperlinks | Exception payload for application hyperlink activation and rendering failures, narrowed by source. |
| `SuperDocExceptionPayload` | high | locked | Public Config.onException callback parameter. Consumers narrow the runtime producer by stage, code, itemName, or source. |
| `SuperDocExceptionRestorePayload` | high | locked | Member of the SuperDocExceptionPayload union; named so consumers can discriminate the restore-failure shape. SD-673 Phase 4D. |
| `SuperDocExceptionStorePayload` | high | locked | Member of the SuperDocExceptionPayload union; named so consumers can discriminate the store-init shape via `'stage' in payload`. SD-673 Phase 4D. |
| `SuperDocExceptionToolbarPayload` | high | core | Exception payload raised by the built-in toolbar, including a custom entry that could not be built. Narrowed by 'itemName' in payload. |
| `SuperDocExtension` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocExtensionActivateReturn` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocExtensionCapabilities` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocExtensionCommandHandle` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocExtensionCommandListEntry` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocExtensionCommandRegistration` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocExtensionCommandStateView` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocExtensionContext` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocExtensionDiagnostic` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocExtensionDiagnostics` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocExtensionDisposable` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocExtensionEventApi` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocExtensionPhase` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocExtensionSnapshot` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocExtensionStorage` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocFitWidthOptions` | high | core | Bounds and padding for the fit-width zoom policy (Config.zoom.fitWidth); named so consumers can type fit policies outside the inline config literal. |
| `SuperDocFontFace` | high | locked | Public font-face shape for superdoc.fonts.add (URL source + optional weight/style). |
| `SuperDocFontFamily` | high | locked | Public font-family shape for superdoc.fonts.add (family name + faces). |
| `SuperDocFontsApi` | high | locked | Return type of the public superdoc.fonts read + write surface (getReport/getMissingFonts/getDocumentFonts/onReport + map/unmap/add/preload). |
| `SuperDocFormattingMarksChangePayload` | high | core | Payload emitted with formatting-marks-change after nonprinting marks are shown or hidden. |
| `SuperDocGuardedDoc` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocGuardedDocQuery` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocGuardedDocSelection` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocLayoutEngineOptions` | high | locked | Types Config.layoutEngineOptions at core/types/index.ts:1350,1505. Documented Config field. |
| `SuperDocLockedPayload` | high | core | Payload emitted with the locked event and passed to Config.onLocked; promoted to a named public type so the lockedBy: User | null contract is consumer-typable. |
| `SuperDocMeasurementUnit` | high | core | Measurement unit for rulers and measurement fields ('in' | 'cm'). Consumer-facing: typed on Config.measurementUnit and on the getMeasurementUnit() / setMeasurementUnit() public methods. |
| `SuperDocMeasurementUnitChangePayload` | high | core | Payload emitted with the measurement-unit-change event when setMeasurementUnit() runs; promoted to a named public type for consistency with the other event payloads (e.g. SuperDocZoomPayload). |
| `SuperDocMutationAffect` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocMutationEvent` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocMutationFilter` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocMutationOrigin` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocPageCountKnownPayload` | high | core | Payload passed to the experimental Config.onPageCountKnown callback when pagination reports a changed page count. |
| `SuperDocPageMarginsChangePayload` | high | core | Payload emitted after a ruler drag changes a section's page margins and passed to Config.onPageMarginsChange. |
| `SuperDocPaginationUpdatePayload` | high | core | Payload passed to Config.onPaginationUpdate and emitted after a pagination layout pass. |
| `SuperDocPaintEvent` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocReadyPayload` | high | core | Payload emitted with the ready event and passed to Config.onReady; promoted to a named public type for consistency with the other event payloads. |
| `SuperDocReceiptSuccess` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocSaveEvent` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocSelectionEvent` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocSelectionPoint` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocSelectionTarget` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocState` | high | core | Public return shape of the SuperDoc#state getter; introduced to replace an inline anonymous return that leaked the internal RuntimeDocument type. Exposes `documents` as Document[] (the public view). |
| `SuperDocStoryLocator` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocTelemetryConfig` | high | locked | Backs Config.telemetry (enabled/endpoint/metadata/licenseKey). |
| `SuperDocTextAddress` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocTextTarget` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocUI` | high | ui-controller | Type of the `SuperDoc.ui` instance property: the SuperDoc-owned UI controller. Promoted to the root facade so `editor.ui` resolves from the root entry alone; the factory and the rest of the controller type graph stay on the `superdoc/ui` subpath. |
| `SuperDocViewportChangePayload` | high | core | Payload emitted with the viewport-change event and passed to Config.onViewportChange; named so custom fit-to-width consumers can type handlers. |
| `SuperDocViewportMetrics` | high | core | Return type of getViewportMetrics(); alias of the viewport-change payload so reads and events share one shape. |
| `SuperDocVisibleRange` | high | core | v2 SuperDoc extension authoring API (defineSuperDocExtension contract). Customer-facing public type exported from src/public/index.ts; reachable through Config.extensions and the activeEditor.extensions facet. |
| `SuperDocInlineBoxAppearance` | high | extensions | Paint-only appearance tokens accepted by ctx.visuals.inlineBox(). Public extension-authoring type defined in core/extensions/types.ts. |
| `SuperDocInlineBoxLayout` | high | extensions | Layout-affecting integer geometry accepted by ctx.visuals.inlineBox(). Public extension-authoring type defined in core/extensions/types.ts. |
| `SuperDocInlineBoxOptions` | high | extensions | Options for the layout-aware ctx.visuals.inlineBox() API. Public extension-authoring type defined in core/extensions/types.ts. |
| `SuperDocVisualApi` | high | extensions | Easy visual authoring layer exposed as ctx.visuals on the v2 extension context (highlight/decorate). Public extension-authoring type defined in core/extensions/types.ts. |
| `SuperDocVisualHandle` | high | extensions | Handle returned by ctx.visuals.highlight/decorate (replace/add/clear/invalidate/dispose). Public extension-authoring type defined in core/extensions/types.ts. |
| `SuperDocVisualOptions` | high | extensions | Options for ctx.visuals.highlight/decorate (className/data/scope). Public extension-authoring type defined in core/extensions/types.ts. |
| `SuperDocVisualTarget` | high | extensions | Target accepted by SuperDocVisualHandle.replace/add (anchor, Document API target, or per-target override). Public extension-authoring type defined in core/extensions/types.ts. |
| `SuperDocWorkerFailureDetail` | high | worker-diagnostics | Structured browser-worker boot and transport failure detail exposed on SuperDocExceptionEditorPayload so consumers can diagnose the phase and typed reason without parsing error text. |
| `SuperDocZoomConfig` | high | core | Config.zoom domain object (initial + fitToContainer); named so consumers can build zoom configuration values with a public type. |
| `SuperDocZoomMode` | high | core | Closed zoom mode union (manual | fit-width) used by Config.zoom.mode, setZoomMode, and the zoomChange payload. |
| `SuperDocZoomPayload` | high | core | Payload emitted with the zoomChange event and passed to Config.onZoomChange; promoted from an internal interface when the config callback made it consumer-facing. |
| `SuperDocZoomState` | high | core | Return type of getZoomState(); snapshot of mode, value, fit zoom, and effective bounds for zoom UI. |
| `SurfaceComponentProps` | medium | surface | Headless Surface API type. Public extension surface for custom UI integrations. |
| `SurfaceFloatingPlacement` | medium | surface | Headless Surface API type. Public extension surface for custom UI integrations. |
| `SurfaceHandle` | medium | surface | Headless Surface API type. Public extension surface for custom UI integrations. |
| `SurfaceMode` | medium | surface | Headless Surface API type. Public extension surface for custom UI integrations. |
| `SurfaceOutcome` | medium | surface | Headless Surface API type. Public extension surface for custom UI integrations. |
| `SurfaceRequest` | medium | surface | Headless Surface API type. Public extension surface for custom UI integrations. |
| `SurfaceResolution` | medium | surface | Headless Surface API type. Public extension surface for custom UI integrations. |
| `SurfaceResolver` | medium | surface | Headless Surface API type. Public extension surface for custom UI integrations. |
| `SurfacesConfig` | high | config | Top-level configuration type split out of modules. Customer-facing. |
| `SurfacesModuleConfig` | medium | surface | Headless Surface API type. Public extension surface for custom UI integrations. |
| `TextAddress` | high | doc-api | Document API text target accepted by v2 comments, formatting, insertion, and replace-style operations; resolved and validated by the v2 Document API adapter. |
| `TextSegment` | high | doc-api | Document API text-range segment used inside TextTarget.segments; needed for consumers typing multi-segment text targets from the root package. |
| `TextTarget` | high | doc-api | Document API range target used by v2 comments, tracked-change decisions, fields, and selection flows; resolved by the v2 Document API adapter. |
| `ThemeColors` | high | theme | Semantic color configuration accepted by createTheme() and buildTheme(); exported so consumers can type reusable palettes directly. |
| `ThemeConfig` | high | theme | Public input contract for createTheme() and buildTheme(); exported so theme objects retain autocomplete when declared outside a call. |
| `ThemeResult` | high | theme | Public return shape of buildTheme(), containing the generated class name and CSS for consumer-managed style injection. |
| `ThemeVariableOverrides` | high | theme | Typed component-level theme override map that preserves autocomplete and rejects keys outside the SuperDoc --sd-* variable namespace. |
| `ToolbarCommandId` | high | toolbar-config | Command id accepted by the runtime toolbar handle, including application ids registered through ui.commands.register(). |
| `ToolbarConfig` | high | toolbar-config | Named startup configuration for the built-in toolbar under ui.toolbar. Lets consumers assemble and validate a readonly toolbar config outside the root Config object. |
| `ToolbarCustomButton` | high | toolbar-custom-buttons | Deprecated union accepted by ui.toolbar.customButtons. Kept for existing v2 integrations; use ToolbarCustomItem. |
| `ToolbarCustomButtonCommand` | high | toolbar-custom-buttons | Deprecated action type accepted by ui.toolbar.customButtons. Kept for existing v2 integrations. |
| `ToolbarCustomButtonCommandId` | high | toolbar-config | Payload-free built-in commands accepted by canonical custom toolbar buttons. |
| `ToolbarCustomButtonConfig` | high | toolbar-config | Canonical custom toolbar button definition using id, region, size, and either command or onSelect. |
| `ToolbarCustomButtonContext` | high | toolbar-custom-buttons | Deprecated callback context for ui.toolbar.customButtons. Kept for existing v2 integrations. |
| `ToolbarCustomButtonItem` | high | toolbar-custom-buttons | Deprecated button shape accepted by ui.toolbar.customButtons. Kept for existing v2 integrations. |
| `ToolbarCustomDropdownConfig` | high | toolbar-config | Canonical custom toolbar dropdown definition with typed options and selection behavior. |
| `ToolbarCustomDropdownCommandId` | high | toolbar-config | Built-in commands accepted by canonical custom toolbar dropdowns with string or number values. |
| `ToolbarCustomDropdownItem` | high | toolbar-custom-buttons | Deprecated dropdown shape accepted by ui.toolbar.customButtons. Kept for existing v2 integrations. |
| `ToolbarCustomDropdownOption` | high | toolbar-custom-buttons | Deprecated dropdown row accepted by ui.toolbar.customButtons. Kept for existing v2 integrations. |
| `ToolbarCustomItem` | high | toolbar-config | Canonical union accepted by ui.toolbar.customItems for buttons, dropdowns, and separators. |
| `ToolbarCustomItemSelectContext` | high | toolbar-config | Public context passed to a canonical custom toolbar item's onSelect callback without exposing the internal reactive item. |
| `ToolbarCustomItemSelectHandler` | high | toolbar-config | Named callback type for canonical custom toolbar selection behavior. |
| `ToolbarCustomOption` | high | toolbar-config | Canonical option definition for a custom toolbar dropdown, with stable id, label, and optional value. |
| `ToolbarCustomSeparatorConfig` | high | toolbar-config | Canonical custom toolbar separator definition. |
| `ToolbarCustomSeparatorItem` | high | toolbar-custom-buttons | Deprecated separator shape accepted by ui.toolbar.customButtons. Kept for existing v2 integrations. |
| `ToolbarDropdownOption` | high | toolbar-custom-buttons | Deprecated dropdown row passed to callbacks from ui.toolbar.customButtons. Kept for existing v2 integrations. |
| `ToolbarFontOption` | high | toolbar-config | Deprecated row accepted by ui.toolbar.fonts. Kept for existing v2 integrations; use FontFamilyOption. |
| `ToolbarIconId` | high | toolbar-config | Exact public keys accepted by ui.toolbar.icons. |
| `ToolbarItemId` | high | toolbar-config | Exact built-in control ids accepted by ui.toolbar.items, with canonical kebab-case names. |
| `ToolbarOptionalItemId` | high | toolbar-config | Exact opt-in control ids accepted by ui.toolbar.includeItems. |
| `ToolbarRegion` | high | toolbar-config | The left, center, and right regions rendered by the built-in toolbar. |
| `ToolbarStringId` | high | toolbar-config | Exact public keys accepted by ui.toolbar.strings. |
| `TrackChangeAuthor` | high | locked | Structured author identity passed to trackChanges.authorColors.resolve. |
| `TrackChangeHighlightColors` | high | config-supported | Tracked-change highlight color shape, referenced by CommentsConfig for both the base and active states. |
| `TrackChangesAuthorColorsConfig` | high | config-supported | Per-author color overrides accepted by the canonical trackChanges.authorColors configuration. |
| `TrackChangesConfig` | high | config-supported | Canonical configuration for grouped or separate replacement review and tracked-change color overrides. |
| `TrackChangesInteractionConfig` | high | config-supported | Named client-side tracked-change decision policy accepted by InteractionConfig.trackedChanges. |
| `TrackChangesModuleConfig` | high | locked | Deprecated modules.trackChanges configuration retained for v2 compatibility; use Config.trackChanges. |
| `TrackChangesReplacementMode` | high | config-supported | Grouped or separate review behavior accepted by trackChanges.replacementMode. |
| `TrackChangesSemanticColorsConfig` | high | config-supported | Semantic color overrides accepted by the canonical trackChanges.semanticColors configuration. |
| `TrackedChangeAddress` | high | doc-api | Document API navigation/address/selection type. Promoted into the root facade by SD-3185. |
| `TrackedChangeSemanticColorKey` | high | locked | Semantic key union used by trackChanges.semanticColors overrides and resolver input. Named so consumers can type supported tracked-change color keys. |
| `TrackedChangeSemanticColorResolverInput` | high | locked | Resolver input passed to trackChanges.semanticColors.resolve. Named so consumers can type semantic color resolver callbacks. |
| `UIConfig` | high | config | Built-in UI configuration type for Config.ui. Customer-facing: names which built-in surfaces SuperDoc renders. |
| `UpgradeToCollaborationOptions` | medium | core | Customer-facing core API type or runtime export. Type-reachable through documented config / callback / event / method surfaces; runtime exports are documented utilities. |
| `User` | high | config-supported | Customer-facing user identity type used by v2 config, collaboration/awareness, shared-user management, and locking methods. |
| `V2CollaborationConfig` | medium | config-supported | Configuration type for SuperDoc v2's document-level single-doc y-websocket collaboration handoff. |
| `ViewOptions` | high | config-supported | Customer-facing view configuration type; Config.viewOptions.layout drives v2 print/web layout behavior. |
| `ViewingOptions` | high | config-supported | Canonical viewing-mode display options used by Config.viewing and SuperDoc#setViewingOptions(). |
| `ViewingTrackedChangesMode` | high | config-supported | Public original, markup, and final projection choices used by ViewingOptions.trackedChanges. |
| `ViewingVisibilityConfig` | medium | core | Customer-facing core API type or runtime export. Type-reachable through documented config / callback / event / method surfaces; runtime exports are documented utilities. |
| `buildTheme` | medium | core | Customer-facing core API type or runtime export. Type-reachable through documented config / callback / event / method surfaces; runtime exports are documented utilities. |
| `compareVersions` | medium | core | Customer-facing core API type or runtime export. Type-reachable through documented config / callback / event / method surfaces; runtime exports are documented utilities. |
| `createTheme` | medium | core | Customer-facing core API type or runtime export. Type-reachable through documented config / callback / event / method surfaces; runtime exports are documented utilities. |
| `defineSuperDocExtension` | high | core | v2 SuperDoc extension factory/validation helper. Documented runtime export used to author extensions passed to Config.extensions. |
| `getFileObject` | medium | core | Customer-facing core API type or runtime export. Type-reachable through documented config / callback / event / method surfaces; runtime exports are documented utilities. |

## legacy-root (3)

| Name | Confidence | Source | Rationale |
|---|---|---|---|
| `BlankDOCX` | high | locked | Runtime-exported empty-DOCX builder. Used internally and possibly in demos; not a supported public concept. |
| `ContextMenuContext` | medium | context-menu | ContextMenu component-side type. Paired with the ContextMenu component (legacy-root). |
| `FindReplaceConfig` | medium | config-legacy | Configuration type for a feature with legacy surface (paired with a legacy component or older API). |

## move-to-subpath (0)

| Name | Confidence | Source | Rationale |
|---|---|---|---|

## internal-candidate (0)

| Name | Confidence | Source | Rationale |
|---|---|---|---|

## NEEDS-REVIEW (0)

| Name | Confidence | Source | Rationale |
|---|---|---|---|

## Presence matrix

| Name | dts | dcts | esm | cjs |
|---|---|---|---|---|
| `AwarenessState` | ✓ | ✓ |   |   |
| `AwarenessUser` | ✓ | ✓ |   |   |
| `BlankDOCX` | ✓ | ✓ | ✓ | ✓ |
| `BlockNavigationAddress` | ✓ | ✓ |   |   |
| `BlocksListResult` | ✓ | ✓ |   |   |
| `BookmarkAddress` | ✓ | ✓ |   |   |
| `BookmarkInfo` | ✓ | ✓ |   |   |
| `BorrowedSuperDocUI` | ✓ | ✓ |   |   |
| `BuiltInCommandId` | ✓ | ✓ |   |   |
| `CanPerformPermissionParams` | ✓ | ✓ |   |   |
| `CollaborationConfig` | ✓ | ✓ |   |   |
| `CommentAddress` | ✓ | ✓ |   |   |
| `CommentInteractionConfig` | ✓ | ✓ |   |   |
| `CommentInteractionLevel` | ✓ | ✓ |   |   |
| `CommentsConfig` | ✓ | ✓ |   |   |
| `CommentsLayout` | ✓ | ✓ |   |   |
| `CommentsResponsiveConfig` | ✓ | ✓ |   |   |
| `CommentsType` | ✓ | ✓ |   |   |
| `Config` | ✓ | ✓ |   |   |
| `ContentControlActiveChangePayload` | ✓ | ✓ |   |   |
| `ContentControlClickPayload` | ✓ | ✓ |   |   |
| `ContentControlsConfig` | ✓ | ✓ |   |   |
| `ContextMenuConfig` | ✓ | ✓ |   |   |
| `ContextMenuContext` | ✓ | ✓ |   |   |
| `ContextMenuItem` | ✓ | ✓ |   |   |
| `ContextMenuOpenContext` | ✓ | ✓ |   |   |
| `ContextMenuResolvedItem` | ✓ | ✓ |   |   |
| `ContextMenuResolvedSection` | ✓ | ✓ |   |   |
| `ContextMenuSection` | ✓ | ✓ |   |   |
| `ContextMenuSelectContext` | ✓ | ✓ |   |   |
| `ContextMenuSelectPayload` | ✓ | ✓ |   |   |
| `ContextMenuSelectReadiness` | ✓ | ✓ |   |   |
| `DOCX` | ✓ | ✓ | ✓ | ✓ |
| `DiffApplyOperationReceipt` | ✓ | ✓ |   |   |
| `DiffApplyResult` | ✓ | ✓ |   |   |
| `DiffApplyReviewItem` | ✓ | ✓ |   |   |
| `DirectSurfaceRequest` | ✓ | ✓ |   |   |
| `DocRange` | ✓ | ✓ |   |   |
| `Document` | ✓ | ✓ |   |   |
| `DocumentApi` | ✓ | ✓ |   |   |
| `DocumentCollaborationConfig` | ✓ | ✓ |   |   |
| `DocumentDataSource` | ✓ | ✓ |   |   |
| `DocumentMode` | ✓ | ✓ |   |   |
| `DocumentProtectionState` | ✓ | ✓ |   |   |
| `DocumentReplacementResult` | ✓ | ✓ |   |   |
| `DocumentSource` | ✓ | ✓ |   |   |
| `DocumentUploadSource` | ✓ | ✓ |   |   |
| `EditorSurface` | ✓ | ✓ |   |   |
| `EditorTransactionEvent` | ✓ | ✓ |   |   |
| `EditorUpdateEvent` | ✓ | ✓ |   |   |
| `EntityAddress` | ✓ | ✓ |   |   |
| `ExportParams` | ✓ | ✓ |   |   |
| `ExportType` | ✓ | ✓ |   |   |
| `ExternalPopoverRenderContext` | ✓ | ✓ |   |   |
| `ExternalSurfaceRenderContext` | ✓ | ✓ |   |   |
| `FindReplaceConfig` | ✓ | ✓ |   |   |
| `FindReplaceContext` | ✓ | ✓ |   |   |
| `FindReplaceHandle` | ✓ | ✓ |   |   |
| `FindReplaceRenderContext` | ✓ | ✓ |   |   |
| `FindReplaceResolution` | ✓ | ✓ |   |   |
| `FlowBlock` | ✓ | ✓ |   |   |
| `FlowMode` | ✓ | ✓ |   |   |
| `FontFamilyOption` | ✓ | ✓ |   |   |
| `FontResolutionRecord` | ✓ | ✓ |   |   |
| `FontsChangedPayload` | ✓ | ✓ |   |   |
| `FontsChangedSource` | ✓ | ✓ |   |   |
| `FontsConfig` | ✓ | ✓ |   |   |
| `FontsResolvedPayload` | ✓ | ✓ |   |   |
| `HTML` | ✓ | ✓ | ✓ | ✓ |
| `HyperlinkActivationContext` | ✓ | ✓ |   |   |
| `HyperlinkActivationHandler` | ✓ | ✓ |   |   |
| `HyperlinkActivationResult` | ✓ | ✓ |   |   |
| `HyperlinkRenderContext` | ✓ | ✓ |   |   |
| `HyperlinkTarget` | ✓ | ✓ |   |   |
| `HyperlinksConfig` | ✓ | ✓ |   |   |
| `IntentSurfaceRequest` | ✓ | ✓ |   |   |
| `InteractionConfig` | ✓ | ✓ |   |   |
| `Layout` | ✓ | ✓ |   |   |
| `LayoutEngineOptions` | ✓ | ✓ |   |   |
| `LayoutFragment` | ✓ | ✓ |   |   |
| `LayoutMetrics` | ✓ | ✓ |   |   |
| `LayoutMode` | ✓ | ✓ |   |   |
| `LayoutPage` | ✓ | ✓ |   |   |
| `LinkPopoverConfig` | ✓ | ✓ |   |   |
| `LinkPopoverContext` | ✓ | ✓ |   |   |
| `LinkPopoverResolution` | ✓ | ✓ |   |   |
| `LinkPopoverResolver` | ✓ | ✓ |   |   |
| `Modules` | ✓ | ✓ |   |   |
| `NavigableAddress` | ✓ | ✓ |   |   |
| `PDF` | ✓ | ✓ | ✓ | ✓ |
| `PasswordPromptAttemptResult` | ✓ | ✓ |   |   |
| `PasswordPromptConfig` | ✓ | ✓ |   |   |
| `PasswordPromptContext` | ✓ | ✓ |   |   |
| `PasswordPromptHandle` | ✓ | ✓ |   |   |
| `PasswordPromptRenderContext` | ✓ | ✓ |   |   |
| `PasswordPromptResolution` | ✓ | ✓ |   |   |
| `PermissionResolver` | ✓ | ✓ |   |   |
| `PermissionResolverParams` | ✓ | ✓ |   |   |
| `ResolveRangeOutput` | ✓ | ✓ |   |   |
| `ResolvedFindReplaceTexts` | ✓ | ✓ |   |   |
| `ResolvedPasswordPromptTexts` | ✓ | ✓ |   |   |
| `RulerConfig` | ✓ | ✓ |   |   |
| `SdtRef` | ✓ | ✓ |   |   |
| `SearchConfig` | ✓ | ✓ |   |   |
| `SearchFloatingConfig` | ✓ | ✓ |   |   |
| `SearchMatch` | ✓ | ✓ |   |   |
| `SearchStrings` | ✓ | ✓ |   |   |
| `SelectionHandle` | ✓ | ✓ |   |   |
| `SelectionInfo` | ✓ | ✓ |   |   |
| `StoryLocator` | ✓ | ✓ |   |   |
| `StructuredDocumentSource` | ✓ | ✓ |   |   |
| `SuperDoc` | ✓ | ✓ | ✓ | ✓ |
| `SuperDocActiveEditorExtensions` | ✓ | ✓ |   |   |
| `SuperDocActiveEditorExtensionsCommands` | ✓ | ✓ |   |   |
| `SuperDocActiveEditorExtensionsDiagnostics` | ✓ | ✓ |   |   |
| `SuperDocAnchor` | ✓ | ✓ |   |   |
| `SuperDocAnchorApi` | ✓ | ✓ |   |   |
| `SuperDocAnchorCollection` | ✓ | ✓ |   |   |
| `SuperDocAnchorStatus` | ✓ | ✓ |   |   |
| `SuperDocAnchorTarget` | ✓ | ✓ |   |   |
| `SuperDocAwarenessUpdatePayload` | ✓ | ✓ |   |   |
| `SuperDocCharRange` | ✓ | ✓ |   |   |
| `SuperDocCommandApi` | ✓ | ✓ |   |   |
| `SuperDocCommandExecuteContext` | ✓ | ✓ |   |   |
| `SuperDocCommandState` | ✓ | ✓ |   |   |
| `SuperDocCommandStateContext` | ✓ | ✓ |   |   |
| `SuperDocCommentsListChangePayload` | ✓ | ✓ |   |   |
| `SuperDocCommentsUpdatePayload` | ✓ | ✓ |   |   |
| `SuperDocContentErrorPayload` | ✓ | ✓ |   |   |
| `SuperDocDecoration` | ✓ | ✓ |   |   |
| `SuperDocDecorationApi` | ✓ | ✓ |   |   |
| `SuperDocDecorationContext` | ✓ | ✓ |   |   |
| `SuperDocDecorationData` | ✓ | ✓ |   |   |
| `SuperDocDecorationProvider` | ✓ | ✓ |   |   |
| `SuperDocDiagnosticCode` | ✓ | ✓ |   |   |
| `SuperDocDiagnosticStage` | ✓ | ✓ |   |   |
| `SuperDocDisposableBag` | ✓ | ✓ |   |   |
| `SuperDocDocumentModeChangePayload` | ✓ | ✓ |   |   |
| `SuperDocEditorPayload` | ✓ | ✓ |   |   |
| `SuperDocExceptionCollaborationPayload` | ✓ | ✓ |   |   |
| `SuperDocExceptionDiagnosticPayload` | ✓ | ✓ |   |   |
| `SuperDocExceptionEditorPayload` | ✓ | ✓ |   |   |
| `SuperDocExceptionHyperlinkPayload` | ✓ | ✓ |   |   |
| `SuperDocExceptionPayload` | ✓ | ✓ |   |   |
| `SuperDocExceptionRestorePayload` | ✓ | ✓ |   |   |
| `SuperDocExceptionStorePayload` | ✓ | ✓ |   |   |
| `SuperDocExceptionToolbarPayload` | ✓ | ✓ |   |   |
| `SuperDocExtension` | ✓ | ✓ |   |   |
| `SuperDocExtensionActivateReturn` | ✓ | ✓ |   |   |
| `SuperDocExtensionCapabilities` | ✓ | ✓ |   |   |
| `SuperDocExtensionCommandHandle` | ✓ | ✓ |   |   |
| `SuperDocExtensionCommandListEntry` | ✓ | ✓ |   |   |
| `SuperDocExtensionCommandRegistration` | ✓ | ✓ |   |   |
| `SuperDocExtensionCommandStateView` | ✓ | ✓ |   |   |
| `SuperDocExtensionContext` | ✓ | ✓ |   |   |
| `SuperDocExtensionDiagnostic` | ✓ | ✓ |   |   |
| `SuperDocExtensionDiagnostics` | ✓ | ✓ |   |   |
| `SuperDocExtensionDisposable` | ✓ | ✓ |   |   |
| `SuperDocExtensionEventApi` | ✓ | ✓ |   |   |
| `SuperDocExtensionPhase` | ✓ | ✓ |   |   |
| `SuperDocExtensionSnapshot` | ✓ | ✓ |   |   |
| `SuperDocExtensionStorage` | ✓ | ✓ |   |   |
| `SuperDocFitWidthOptions` | ✓ | ✓ |   |   |
| `SuperDocFontFace` | ✓ | ✓ |   |   |
| `SuperDocFontFamily` | ✓ | ✓ |   |   |
| `SuperDocFontsApi` | ✓ | ✓ |   |   |
| `SuperDocFormattingMarksChangePayload` | ✓ | ✓ |   |   |
| `SuperDocGuardedDoc` | ✓ | ✓ |   |   |
| `SuperDocGuardedDocQuery` | ✓ | ✓ |   |   |
| `SuperDocGuardedDocSelection` | ✓ | ✓ |   |   |
| `SuperDocLayoutEngineOptions` | ✓ | ✓ |   |   |
| `SuperDocLockedPayload` | ✓ | ✓ |   |   |
| `SuperDocMeasurementUnit` | ✓ | ✓ |   |   |
| `SuperDocMeasurementUnitChangePayload` | ✓ | ✓ |   |   |
| `SuperDocMutationAffect` | ✓ | ✓ |   |   |
| `SuperDocMutationEvent` | ✓ | ✓ |   |   |
| `SuperDocMutationFilter` | ✓ | ✓ |   |   |
| `SuperDocMutationOrigin` | ✓ | ✓ |   |   |
| `SuperDocPageCountKnownPayload` | ✓ | ✓ |   |   |
| `SuperDocPageMarginsChangePayload` | ✓ | ✓ |   |   |
| `SuperDocPaginationUpdatePayload` | ✓ | ✓ |   |   |
| `SuperDocPaintEvent` | ✓ | ✓ |   |   |
| `SuperDocReadyPayload` | ✓ | ✓ |   |   |
| `SuperDocReceiptSuccess` | ✓ | ✓ |   |   |
| `SuperDocSaveEvent` | ✓ | ✓ |   |   |
| `SuperDocSelectionEvent` | ✓ | ✓ |   |   |
| `SuperDocSelectionPoint` | ✓ | ✓ |   |   |
| `SuperDocSelectionTarget` | ✓ | ✓ |   |   |
| `SuperDocState` | ✓ | ✓ |   |   |
| `SuperDocStoryLocator` | ✓ | ✓ |   |   |
| `SuperDocTelemetryConfig` | ✓ | ✓ |   |   |
| `SuperDocTextAddress` | ✓ | ✓ |   |   |
| `SuperDocTextTarget` | ✓ | ✓ |   |   |
| `SuperDocUI` | ✓ | ✓ |   |   |
| `SuperDocViewportChangePayload` | ✓ | ✓ |   |   |
| `SuperDocViewportMetrics` | ✓ | ✓ |   |   |
| `SuperDocVisibleRange` | ✓ | ✓ |   |   |
| `SuperDocInlineBoxAppearance` | ✓ | ✓ |   |   |
| `SuperDocInlineBoxLayout` | ✓ | ✓ |   |   |
| `SuperDocInlineBoxOptions` | ✓ | ✓ |   |   |
| `SuperDocVisualApi` | ✓ | ✓ |   |   |
| `SuperDocVisualHandle` | ✓ | ✓ |   |   |
| `SuperDocVisualOptions` | ✓ | ✓ |   |   |
| `SuperDocVisualTarget` | ✓ | ✓ |   |   |
| `SuperDocWorkerFailureDetail` | ✓ | ✓ |   |   |
| `SuperDocZoomConfig` | ✓ | ✓ |   |   |
| `SuperDocZoomMode` | ✓ | ✓ |   |   |
| `SuperDocZoomPayload` | ✓ | ✓ |   |   |
| `SuperDocZoomState` | ✓ | ✓ |   |   |
| `SurfaceComponentProps` | ✓ | ✓ |   |   |
| `SurfaceFloatingPlacement` | ✓ | ✓ |   |   |
| `SurfaceHandle` | ✓ | ✓ |   |   |
| `SurfaceMode` | ✓ | ✓ |   |   |
| `SurfaceOutcome` | ✓ | ✓ |   |   |
| `SurfaceRequest` | ✓ | ✓ |   |   |
| `SurfaceResolution` | ✓ | ✓ |   |   |
| `SurfaceResolver` | ✓ | ✓ |   |   |
| `SurfacesConfig` | ✓ | ✓ |   |   |
| `SurfacesModuleConfig` | ✓ | ✓ |   |   |
| `TextAddress` | ✓ | ✓ |   |   |
| `TextSegment` | ✓ | ✓ |   |   |
| `TextTarget` | ✓ | ✓ |   |   |
| `ThemeColors` | ✓ | ✓ |   |   |
| `ThemeConfig` | ✓ | ✓ |   |   |
| `ThemeResult` | ✓ | ✓ |   |   |
| `ThemeVariableOverrides` | ✓ | ✓ |   |   |
| `ToolbarCommandId` | ✓ | ✓ |   |   |
| `ToolbarConfig` | ✓ | ✓ |   |   |
| `ToolbarCustomButton` | ✓ | ✓ |   |   |
| `ToolbarCustomButtonCommand` | ✓ | ✓ |   |   |
| `ToolbarCustomButtonCommandId` | ✓ | ✓ |   |   |
| `ToolbarCustomButtonConfig` | ✓ | ✓ |   |   |
| `ToolbarCustomButtonContext` | ✓ | ✓ |   |   |
| `ToolbarCustomButtonItem` | ✓ | ✓ |   |   |
| `ToolbarCustomDropdownConfig` | ✓ | ✓ |   |   |
| `ToolbarCustomDropdownCommandId` | ✓ | ✓ |   |   |
| `ToolbarCustomDropdownItem` | ✓ | ✓ |   |   |
| `ToolbarCustomDropdownOption` | ✓ | ✓ |   |   |
| `ToolbarCustomItem` | ✓ | ✓ |   |   |
| `ToolbarCustomItemSelectContext` | ✓ | ✓ |   |   |
| `ToolbarCustomItemSelectHandler` | ✓ | ✓ |   |   |
| `ToolbarCustomOption` | ✓ | ✓ |   |   |
| `ToolbarCustomSeparatorConfig` | ✓ | ✓ |   |   |
| `ToolbarCustomSeparatorItem` | ✓ | ✓ |   |   |
| `ToolbarDropdownOption` | ✓ | ✓ |   |   |
| `ToolbarFontOption` | ✓ | ✓ |   |   |
| `ToolbarIconId` | ✓ | ✓ |   |   |
| `ToolbarItemId` | ✓ | ✓ |   |   |
| `ToolbarOptionalItemId` | ✓ | ✓ |   |   |
| `ToolbarRegion` | ✓ | ✓ |   |   |
| `ToolbarStringId` | ✓ | ✓ |   |   |
| `TrackChangeAuthor` | ✓ | ✓ |   |   |
| `TrackChangeHighlightColors` | ✓ | ✓ |   |   |
| `TrackChangesAuthorColorsConfig` | ✓ | ✓ |   |   |
| `TrackChangesConfig` | ✓ | ✓ |   |   |
| `TrackChangesInteractionConfig` | ✓ | ✓ |   |   |
| `TrackChangesModuleConfig` | ✓ | ✓ |   |   |
| `TrackChangesReplacementMode` | ✓ | ✓ |   |   |
| `TrackChangesSemanticColorsConfig` | ✓ | ✓ |   |   |
| `TrackedChangeAddress` | ✓ | ✓ |   |   |
| `TrackedChangeSemanticColorKey` | ✓ | ✓ |   |   |
| `TrackedChangeSemanticColorResolverInput` | ✓ | ✓ |   |   |
| `UIConfig` | ✓ | ✓ |   |   |
| `UpgradeToCollaborationOptions` | ✓ | ✓ |   |   |
| `User` | ✓ | ✓ |   |   |
| `V2CollaborationConfig` | ✓ | ✓ |   |   |
| `ViewOptions` | ✓ | ✓ |   |   |
| `ViewingOptions` | ✓ | ✓ |   |   |
| `ViewingTrackedChangesMode` | ✓ | ✓ |   |   |
| `ViewingVisibilityConfig` | ✓ | ✓ |   |   |
| `buildTheme` | ✓ | ✓ | ✓ | ✓ |
| `compareVersions` | ✓ | ✓ | ✓ | ✓ |
| `createTheme` | ✓ | ✓ | ✓ | ✓ |
| `defineSuperDocExtension` | ✓ | ✓ | ✓ | ✓ |
| `getFileObject` | ✓ | ✓ | ✓ | ✓ |
