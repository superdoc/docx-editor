/**
 * Engine-agnostic Document API surface.
 */
import { DocumentApiValidationError } from './errors.js';
export * from './types/index.js';
export * from './contract/index.js';
export * from './capabilities/capabilities.js';
export * from './capabilities/html-markdown-support.js';
export * from './inline-semantics/index.js';
export type { HistoryAdapter, HistoryApi } from './history/history.js';
export { executeHistoryGet, executeHistoryUndo, executeHistoryRedo } from './history/history.js';
export type { DiffAdapter, DiffApi } from './diff/diff.js';
export * from './diff/diff.types.js';
export type { ExportAdapter, ExportApi } from './export/export.js';
export * from './export/export.types.js';
export type {
  SelectionMutationAdapter,
  SelectionMutationRequest,
  SelectionInsertRequest,
} from './selection-mutation.js';
export type {
  RangeAnchor,
  DocumentEdgeAnchor,
  PointAnchor,
  RefBoundaryAnchor,
  ResolveRangeInput,
  ResolveRangeOutput,
  RangeBlockPreview,
  RangePreview,
  RangeResolverAdapter,
  ScrollIntoViewInput,
  ScrollIntoViewOutput,
} from './ranges/index.js';
export { executeResolveRange } from './ranges/index.js';
export type { SelectionApi, SelectionAdapter, SelectionCurrentInput, SelectionInfo } from './selection/selection.js';
export { executeSelectionCurrent } from './selection/selection.js';
export type { HeaderFootersAdapter, HeaderFootersApi } from './header-footers/header-footers.js';
export * from './header-footers/header-footers.types.js';
export type { ClearContentAdapter, ClearContentInput } from './clear-content/clear-content.js';
export type {
  MarkdownToFragmentInput,
  MarkdownToFragmentAdapter,
} from './markdown-to-fragment/markdown-to-fragment.js';
export { executeMarkdownToFragment } from './markdown-to-fragment/markdown-to-fragment.js';
export type { HtmlToFragmentInput, HtmlToFragmentAdapter } from './html-to-fragment/html-to-fragment.js';
export { executeHtmlToFragment } from './html-to-fragment/html-to-fragment.js';
export type { ProjectHtmlAdapter } from './project-html/project-html.js';
export { executeProjectHtml } from './project-html/project-html.js';
export type { ProjectMarkdownAdapter } from './project-markdown/project-markdown.js';
export { executeProjectMarkdown } from './project-markdown/project-markdown.js';
export type {
  HistoryState,
  HistoryActionResult,
  HistoryNoopReason,
  SDHistoryStatus,
  SDHistoryCollaborationMeta,
} from './history/history.types.js';
import type {
  CreateParagraphInput,
  CreateParagraphResult,
  DocumentDefaults,
  DocumentInfo,
  DocumentStyles,
  DocumentStyleInfo,
  MutationsApplyInput,
  MutationsPreviewInput,
  MutationsPreviewOutput,
  NodeAddress,
  NodeInfo,
  PlanReceipt,
  Query,
  QueryMatchInput,
  QueryMatchOutput,
  TextSelector,
  NodeSelector,
  FindOutput,
  Receipt,
  Selector,
  TextMutationReceipt,
  SDMutationReceipt,
  TrackChangeInfo,
  TrackChangesListResult,
  ExtractResult,
} from './types/index.js';
import type {
  CommentInfo,
  CommentTarget,
  CommentsListQuery,
  CommentsListResult,
  CommentTrackedChangeLink,
  TrackedChangeCommentTarget,
} from './comments/comments.types.js';
import type {
  CommentsAdapter,
  CommentsCreateReceipt,
  CommentsApi,
  CommentsCreateInput,
  CommentsPatchInput,
  CommentsDeleteInput,
  GetCommentInput,
} from './comments/comments.js';
import {
  executeCommentsCreate,
  executeCommentsPatch,
  executeCommentsDelete,
  executeGetComment,
  executeListComments,
} from './comments/comments.js';
import type { DeleteInput } from './delete/delete.js';
import { executeFind, type FindAdapter } from './find/find.js';
import type { SDFindInput, SDFindResult, SDGetInput, SDNodeResult } from './types/sd-envelope.js';
import type {
  FormatApi,
  FormatRangeInput,
  FormatInlineAliasApi,
  FormatInlineAliasInput,
  FormatStrikethroughInput,
  StyleApplyInput,
} from './format/format.js';
import { executeStyleApply, executeInlineAlias } from './format/format.js';
import { INLINE_PROPERTY_REGISTRY, type InlineRunPatchKey } from './format/inline-run-patch.js';
import type {
  StylesAdapter,
  StylesApi,
  StylesApplyInput,
  StylesApplyOptions,
  StylesApplyReceipt,
  StylesGetCatalogInput,
  StylesGetCatalogResult,
} from './styles/index.js';
import { executeStylesApply, executeStylesGetCatalog } from './styles/index.js';
import type {
  TemplatesAdapter,
  TemplatesApi,
  TemplatesApplyInput,
  TemplatesApplyOptions,
  TemplatesApplyReceipt,
} from './templates/index.js';
import { executeTemplatesApply } from './templates/index.js';
import type { GetNodeAdapter, GetNodeByIdInput } from './get-node/get-node.js';
import { executeGetNode, executeGetNodeById } from './get-node/get-node.js';
import { executeGet, type GetAdapter } from './get/get.js';
import type { SDDocument } from './types/fragment.js';
import { executeGetText, type GetTextAdapter, type GetTextInput } from './get-text/get-text.js';
import { executeGetMarkdown, type GetMarkdownAdapter, type GetMarkdownInput } from './get-markdown/get-markdown.js';
import { executeGetHtml, type GetHtmlAdapter, type GetHtmlInput } from './get-html/get-html.js';
import { executeProjectHtml, type ProjectHtmlAdapter } from './project-html/project-html.js';
import { executeProjectMarkdown, type ProjectMarkdownAdapter } from './project-markdown/project-markdown.js';
import type { ProjectHtmlInput, ProjectMarkdownInput, SDContentProjectionResult } from './types/content-projection.js';
import { validateStoryLocator } from './validation/story-validator.js';
import {
  executeMarkdownToFragment,
  type MarkdownToFragmentAdapter,
  type MarkdownToFragmentInput,
} from './markdown-to-fragment/markdown-to-fragment.js';
import {
  executeHtmlToFragment,
  type HtmlToFragmentAdapter,
  type HtmlToFragmentInput,
} from './html-to-fragment/html-to-fragment.js';
import type { SDHtmlToFragmentResult, SDMarkdownToFragmentResult } from './types/sd-contract.js';
import { executeInfo, type InfoAdapter, type InfoInput } from './info/info.js';
import { executeExtract, type ExtractAdapter, type ExtractInput } from './extract/extract.js';
import {
  executeClearContent,
  type ClearContentAdapter,
  type ClearContentInput,
} from './clear-content/clear-content.js';
import type { InsertInput } from './insert/insert.js';
import { executeDelete } from './delete/delete.js';
import { executeResolveRange } from './ranges/resolve.js';
import type { RangeResolverAdapter, ResolveRangeInput, ResolveRangeOutput } from './ranges/ranges.types.js';
import { executeSelectionCurrent } from './selection/selection.js';
import type { SelectionApi, SelectionAdapter, SelectionCurrentInput, SelectionInfo } from './selection/selection.js';
import { executeInsert } from './insert/insert.js';
import type { ListsAdapter, ListsApi } from './lists/lists.js';
import type {
  ListItemInfo,
  ListInsertInput,
  ListsGetInput,
  ListsInsertResult,
  ListsListQuery,
  ListsListResult,
  ListsMutateItemResult,
  ListTargetInput,
  ListsCreateInput,
  ListsCreateResult,
  ListsAttachInput,
  ListsDetachInput,
  ListsDetachResult,
  ListsDeleteInput,
  ListsDeleteResult,
  ListsJoinInput,
  ListsJoinResult,
  ListsCanJoinInput,
  ListsCanJoinResult,
  ListsSeparateInput,
  ListsSeparateResult,
  ListsMergeInput,
  ListsMergeResult,
  ListsSplitInput,
  ListsSplitResult,
  ListsSetLevelInput,
  ListsSetValueInput,
  ListsContinuePreviousInput,
  ListsCanContinuePreviousInput,
  ListsCanContinuePreviousResult,
  ListsSetLevelRestartInput,
  ListsConvertToTextInput,
  ListsConvertToTextResult,
  ListsApplyTemplateInput,
  ListsApplyPresetInput,
  ListsCaptureTemplateInput,
  ListsCaptureTemplateResult,
  ListsSetLevelNumberingInput,
  ListsSetLevelBulletInput,
  ListsSetLevelPictureBulletInput,
  ListsSetLevelAlignmentInput,
  ListsSetLevelIndentsInput,
  ListsSetLevelTrailingCharacterInput,
  ListsSetLevelMarkerFontInput,
  ListsClearLevelOverridesInput,
  ListsSetTypeInput,
  ListsGetStyleInput,
  ListsGetStyleResult,
  ListsApplyStyleInput,
  ListsRestartAtInput,
  ListsSetLevelNumberStyleInput,
  ListsSetLevelTextInput,
  ListsSetLevelStartInput,
  ListsSetLevelLayoutInput,
  ListsGetStateInput,
  ListsGetStateResult,
  ListsApplyInput,
  ListsContinueV2Input,
  ListsRestartV2Input,
  ListsRemoveV2Input,
} from './lists/lists.types.js';
import {
  executeListsGet,
  executeListsIndent,
  executeListsInsert,
  executeListsList,
  executeListsOutdent,
  executeListsCreate,
  executeListsAttach,
  executeListsDetach,
  executeListsDelete,
  executeListsJoin,
  executeListsCanJoin,
  executeListsSeparate,
  executeListsMerge,
  executeListsSplit,
  executeListsSetLevel,
  executeListsSetValue,
  executeListsContinuePrevious,
  executeListsCanContinuePrevious,
  executeListsSetLevelRestart,
  executeListsConvertToText,
  executeListsApplyTemplate,
  executeListsApplyPreset,
  executeListsCaptureTemplate,
  executeListsSetLevelNumbering,
  executeListsSetLevelBullet,
  executeListsSetLevelPictureBullet,
  executeListsSetLevelAlignment,
  executeListsSetLevelIndents,
  executeListsSetLevelTrailingCharacter,
  executeListsSetLevelMarkerFont,
  executeListsClearLevelOverrides,
  executeListsSetType,
  executeListsGetStyle,
  executeListsApplyStyle,
  executeListsRestartAt,
  executeListsSetLevelNumberStyle,
  executeListsSetLevelText,
  executeListsSetLevelStart,
  executeListsSetLevelLayout,
  executeListsGetState,
  executeListsApply,
  executeListsContinueV2,
  executeListsRestartV2,
  executeListsRemoveV2,
} from './lists/lists.js';
import { executeReplace, type ReplaceInput } from './replace/replace.js';
import type { CreateAdapter, CreateApi } from './create/create.js';
import {
  executeCreateParagraph,
  executeCreateHeading,
  executeCreateTable,
  executeCreateSectionBreak,
  executeCreateTableOfContents,
} from './create/create.js';
import type { BlocksAdapter, BlocksApi } from './blocks/blocks.js';
import { executeBlocksFindText } from './blocks/find-text.js';
import {
  executeBlocksList,
  executeBlocksDelete,
  executeBlocksDeleteRange,
  executeBlocksSplit,
  executeBlocksMerge,
  executeBlocksMove,
} from './blocks/blocks.js';
import type {
  BlocksDeleteInput,
  BlocksDeleteResult,
  BlocksListInput,
  BlocksListResult,
  BlocksFindTextInput,
  BlocksFindTextResult,
  BlocksDeleteRangeInput,
  BlocksDeleteRangeResult,
} from './types/blocks.types.js';
import type { CreateHeadingInput, CreateHeadingResult } from './types/create.types.js';
import type {
  CreateTableInput,
  CreateTableResult,
  TableLocator,
  TableMutationResult,
  TablesConvertFromTextInput,
  TablesMoveInput,
  TablesSplitInput,
  TablesConvertToTextInput,
  TablesSetLayoutInput,
  TablesInsertRowInput,
  TablesDeleteRowInput,
  TablesMoveRowInput,
  TablesSetRowHeightInput,
  TablesDistributeRowsInput,
  TablesSetRowOptionsInput,
  TablesInsertColumnInput,
  TablesDeleteColumnInput,
  TablesMoveColumnInput,
  TablesSetColumnWidthInput,
  TablesDistributeColumnsInput,
  TablesInsertCellInput,
  TablesDeleteCellInput,
  TablesMergeCellsInput,
  TablesUnmergeCellsInput,
  TablesSplitCellInput,
  TablesSetCellPropertiesInput,
  TablesSetCellTextInput,
  TablesSortInput,
  TablesSetAltTextInput,
  TablesSetStyleInput,
  TablesClearStyleInput,
  TablesSetStyleOptionInput,
  TablesSetBorderInput,
  TablesClearBorderInput,
  TablesApplyBorderPresetInput,
  TablesSetShadingInput,
  TablesClearShadingInput,
  TablesSetTablePaddingInput,
  TablesSetCellPaddingInput,
  TablesSetCellSpacingInput,
  TablesClearCellSpacingInput,
  TablesApplyStyleInput,
  TablesSetBordersInput,
  TablesSetTableOptionsInput,
  TablesApplyPresetInput,
  TablesGetInput,
  TablesGetOutput,
  TablesGetCellsInput,
  TablesGetCellsOutput,
  TablesGetPropertiesInput,
  TablesGetPropertiesOutput,
  TablesGetStylesInput,
  TablesGetStylesOutput,
  TablesSetDefaultStyleInput,
  TablesClearDefaultStyleInput,
} from './types/table-operations.types.js';
import type {
  TrackChangesAdapter,
  TrackChangesApi,
  TrackChangesGetInput,
  TrackChangesListInput,
  ReviewDecideInput,
} from './track-changes/track-changes.js';
import {
  executeTrackChangesGet,
  executeTrackChangesList,
  executeTrackChangesDecide,
} from './track-changes/track-changes.js';
export {
  executeTrackChangesGet,
  executeTrackChangesList,
  executeTrackChangesDecide,
} from './track-changes/track-changes.js';
import type { MutationOptions, RevisionGuardOptions, RichContentMutationOptions, WriteAdapter } from './write/write.js';
import type { SelectionMutationAdapter } from './selection-mutation.js';
import {
  executeCapabilities,
  executeCapabilitiesCheck,
  type CapabilitiesAdapter,
  type DocumentApiCapabilities,
} from './capabilities/capabilities.js';
import type {
  SDHtmlMarkdownSupportCheckInput,
  SDHtmlMarkdownSupportCheckResult,
} from './capabilities/html-markdown-support.js';
import type { OperationId } from './contract/types.js';
import type { DynamicInvokeRequest, InvokeRequest, InvokeResult } from './contract/operation-registry.js';
import { buildDispatchTable } from './invoke/invoke.js';
import { createPlanApi, type PlanApi, type PlanExecuteResult } from './plan/plan.js';
export {
  createPlanApi,
  type PlanApi,
  type PlanExecuteInput,
  type PlanExecuteEntry,
  type PlanExecuteEntryExpect,
  type PlanExecuteResult,
  type PlanEntryReceipt,
  type PlanEntryReceiptStatus,
  type PlanExecuteFailure,
  type PlanCaptureRefMarker,
  type PlanProjectTextOffsetMarker,
} from './plan/plan.js';
import type { HistoryAdapter, HistoryApi } from './history/history.js';
import type { HistoryState, HistoryActionResult } from './history/history.types.js';
import { executeHistoryGet, executeHistoryUndo, executeHistoryRedo } from './history/history.js';
import type { DiffAdapter, DiffApi } from './diff/diff.js';
import { executeDiffCapture, executeDiffCompare, executeDiffApply } from './diff/diff.js';
import type {
  DiffSnapshot,
  DiffPayload,
  DiffApplyResult,
  DiffCompareInput,
  DiffApplyInput,
  DiffApplyOptions,
  DiffApplyOperationReceipt,
  DiffApplyReviewItem,
} from './diff/diff.types.js';
export type {
  DiffSnapshot,
  DiffPayload,
  DiffApplyResult,
  DiffCompareInput,
  DiffApplyInput,
  DiffApplyOptions,
  DiffApplyOperationReceipt,
  DiffApplyReviewItem,
} from './diff/diff.types.js';
import type { ExportAdapter, ExportApi } from './export/export.js';
import { executeExportToDocx } from './export/export.js';
import type { ExportToDocxInput, ExportToDocxResult } from './export/export.types.js';
import {
  executeTableLocatorOp,
  executeTablesSetLayoutOp,
  executeRowLocatorOp,
  executeCellOrTableScopedCellLocatorOp,
  executeDocumentLevelTableOp,
  normalizeTablesSplitInput,
  executeTablesApplyStyle,
  executeTablesSetBorders,
  executeTablesSetCellPadding,
  executeTablesSetTableOptions,
} from './tables/tables.js';
import type {
  ParagraphsAdapter,
  ParagraphFormatApi,
  ParagraphStylesApi,
  ParagraphsSetStyleInput,
  ParagraphSemanticStyleRole,
  ParagraphsSetStyleRefInput,
  ParagraphsClearStyleInput,
  ParagraphsResetDirectFormattingInput,
  ParagraphsSetAlignmentInput,
  ParagraphsClearAlignmentInput,
  ParagraphsSetIndentationInput,
  ParagraphsClearIndentationInput,
  ParagraphsSetSpacingInput,
  ParagraphsClearSpacingInput,
  ParagraphsSetKeepOptionsInput,
  ParagraphsSetOutlineLevelInput,
  ParagraphsSetFlowOptionsInput,
  ParagraphsSetTabStopInput,
  ParagraphsClearTabStopInput,
  ParagraphsClearAllTabStopsInput,
  ParagraphsSetBorderInput,
  ParagraphsClearBorderInput,
  ParagraphsSetShadingInput,
  ParagraphsClearShadingInput,
  ParagraphsSetMarkRunPropsInput,
  ParagraphsSetDirectionInput,
  ParagraphsClearDirectionInput,
  ParagraphsSetNumberingInput,
  ParagraphMutationResult,
} from './paragraphs/paragraphs.js';
import {
  executeParagraphsSetStyle,
  executeParagraphsSetStyleRef,
  executeParagraphsClearStyle,
  executeParagraphsResetDirectFormatting,
  executeParagraphsSetAlignment,
  executeParagraphsClearAlignment,
  executeParagraphsSetIndentation,
  executeParagraphsClearIndentation,
  executeParagraphsSetSpacing,
  executeParagraphsClearSpacing,
  executeParagraphsSetKeepOptions,
  executeParagraphsSetOutlineLevel,
  executeParagraphsSetFlowOptions,
  executeParagraphsSetTabStop,
  executeParagraphsClearTabStop,
  executeParagraphsClearAllTabStops,
  executeParagraphsSetBorder,
  executeParagraphsClearBorder,
  executeParagraphsSetShading,
  executeParagraphsClearShading,
  executeParagraphsSetMarkRunProps,
  executeParagraphsSetDirection,
  executeParagraphsClearDirection,
  executeParagraphsSetNumbering,
} from './paragraphs/paragraphs.js';
import type { SectionsAdapter, SectionsApi } from './sections/sections.js';
import type {
  HeaderFootersAdapter,
  HeaderFootersApi,
  HeaderFootersListQuery,
  HeaderFootersListResult,
  HeaderFootersGetInput,
  HeaderFooterSlotEntry,
  HeaderFootersResolveInput,
  HeaderFooterResolveResult,
  HeaderFootersRefsSetInput,
  HeaderFootersRefsClearInput,
  HeaderFootersRefsSetLinkedToPreviousInput,
  HeaderFootersPartsListQuery,
  HeaderFootersPartsListResult,
  HeaderFootersPartsCreateInput,
  HeaderFootersPartsDeleteInput,
  HeaderFooterPartsMutationResult,
} from './header-footers/header-footers.js';
import {
  executeHeaderFootersList,
  executeHeaderFootersGet,
  executeHeaderFootersResolve,
  executeHeaderFootersRefsSet,
  executeHeaderFootersRefsClear,
  executeHeaderFootersRefsSetLinkedToPrevious,
  executeHeaderFootersPartsList,
  executeHeaderFootersPartsCreate,
  executeHeaderFootersPartsDelete,
} from './header-footers/header-footers.js';
import type {
  CreateSectionBreakInput,
  CreateSectionBreakResult,
  DocumentMutationResult,
  SectionInfo,
  SectionsClearHeaderFooterRefInput,
  SectionsClearPageBordersInput,
  SectionsGetInput,
  SectionsListQuery,
  SectionsListResult,
  SectionsSetBreakTypeInput,
  SectionsSetColumnsInput,
  SectionsSetHeaderFooterMarginsInput,
  SectionsSetHeaderFooterRefInput,
  SectionsSetLineNumberingInput,
  SectionsSetLinkToPreviousInput,
  SectionsSetOddEvenHeadersFootersInput,
  SectionsSetPageBordersInput,
  SectionsSetPageMarginsInput,
  SectionsSetPageNumberingInput,
  SectionsSetPageSetupInput,
  SectionsSetSectionDirectionInput,
  SectionsSetTitlePageInput,
  SectionsSetVerticalAlignInput,
  SectionMutationResult,
} from './sections/sections.types.js';
import {
  executeSectionsClearHeaderFooterRef,
  executeSectionsClearPageBorders,
  executeSectionsGet,
  executeSectionsList,
  executeSectionsSetBreakType,
  executeSectionsSetColumns,
  executeSectionsSetHeaderFooterMargins,
  executeSectionsSetHeaderFooterRef,
  executeSectionsSetLineNumbering,
  executeSectionsSetLinkToPrevious,
  executeSectionsSetOddEvenHeadersFooters,
  executeSectionsSetPageBorders,
  executeSectionsSetPageMargins,
  executeSectionsSetPageNumbering,
  executeSectionsSetPageSetup,
  executeSectionsSetSectionDirection,
  executeSectionsSetTitlePage,
  executeSectionsSetVerticalAlign,
} from './sections/sections.js';
import type { ImagesAdapter, ImagesApi, CreateImageAdapter } from './images/images.js';
import {
  executeImagesList,
  executeImagesGet,
  executeImagesDelete,
  executeImagesMove,
  executeImagesConvertToInline,
  executeImagesConvertToFloating,
  executeImagesSetSize,
  executeImagesSetWrapType,
  executeImagesSetWrapSide,
  executeImagesSetWrapDistances,
  executeImagesSetPosition,
  executeImagesSetAnchorOptions,
  executeImagesSetZOrder,
  executeCreateImage,
  executeImagesScale,
  executeImagesSetLockAspectRatio,
  executeImagesRotate,
  executeImagesFlip,
  executeImagesCrop,
  executeImagesResetCrop,
  executeImagesReplaceSource,
  executeImagesSetAltText,
  executeImagesSetDecorative,
  executeImagesSetName,
  executeImagesSetHyperlink,
  executeImagesInsertCaption,
  executeImagesUpdateCaption,
  executeImagesRemoveCaption,
} from './images/images.js';
import type {
  CreateImageInput,
  CreateImageResult,
  ImagesListInput,
  ImagesListResult,
  ImagesGetInput,
  ImageSummary,
  ImagesDeleteInput,
  ImagesMutationResult,
  MoveImageInput,
  ConvertToInlineInput,
  ConvertToFloatingInput,
  SetSizeInput,
  SetWrapTypeInput,
  SetWrapSideInput,
  SetWrapDistancesInput,
  SetPositionInput,
  SetAnchorOptionsInput,
  SetZOrderInput,
  ScaleInput,
  SetLockAspectRatioInput,
  RotateInput,
  FlipInput,
  CropInput,
  ResetCropInput,
  ReplaceSourceInput,
  SetAltTextInput,
  SetDecorativeInput,
  SetNameInput,
  SetHyperlinkInput,
  InsertCaptionInput,
  UpdateCaptionInput,
  RemoveCaptionInput,
} from './images/images.types.js';
import type { TocApi, TocAdapter } from './toc/toc.js';
import {
  executeTocList,
  executeTocGet,
  executeTocConfigure,
  executeTocUpdate,
  executeTocRemove,
  executeTocMarkEntry,
  executeTocUnmarkEntry,
  executeTocListEntries,
  executeTocGetEntry,
  executeTocEditEntry,
} from './toc/toc.js';
import type {
  CreateTableOfContentsInput,
  CreateTableOfContentsResult,
  TocGetInput,
  TocInfo,
  TocConfigureInput,
  TocUpdateInput,
  TocRemoveInput,
  TocMutationResult,
  TocListQuery,
  TocListResult,
  TocMarkEntryInput,
  TocUnmarkEntryInput,
  TocListEntriesQuery,
  TocListEntriesResult,
  TocGetEntryInput,
  TocEntryInfo,
  TocEditEntryInput,
  TocEntryMutationResult,
} from './toc/toc.types.js';
import type { HyperlinksApi, HyperlinksAdapter } from './hyperlinks/hyperlinks.js';
import {
  executeHyperlinksList,
  executeHyperlinksGet,
  executeHyperlinksWrap,
  executeHyperlinksInsert,
  executeHyperlinksPatch,
  executeHyperlinksRemove,
} from './hyperlinks/hyperlinks.js';
import type {
  ContentControlsApi,
  ContentControlsAdapter,
  ContentControlsCreateAdapter,
} from './content-controls/content-controls.js';
import type {
  CreateContentControlInput,
  ContentControlMutationResult,
} from './content-controls/content-controls.types.js';
import {
  executeContentControlsList,
  executeContentControlsGet,
  executeContentControlsListInRange,
  executeContentControlsSelectByTag,
  executeContentControlsSelectByTitle,
  executeContentControlsListChildren,
  executeContentControlsGetParent,
  executeContentControlsWrap,
  executeContentControlsUnwrap,
  executeContentControlsDelete,
  executeContentControlsCopy,
  executeContentControlsMove,
  executeContentControlsPatch,
  executeContentControlsSetLockMode,
  executeContentControlsSetType,
  executeContentControlsGetContent,
  executeContentControlsReplaceContent,
  executeContentControlsClearContent,
  executeContentControlsAppendContent,
  executeContentControlsPrependContent,
  executeContentControlsInsertBefore,
  executeContentControlsInsertAfter,
  executeContentControlsGetBinding,
  executeContentControlsSetBinding,
  executeContentControlsClearBinding,
  executeContentControlsGetRawProperties,
  executeContentControlsPatchRawProperties,
  executeContentControlsValidateWordCompatibility,
  executeContentControlsNormalizeWordCompatibility,
  executeContentControlsNormalizeTagPayload,
  executeContentControlsTextSetMultiline,
  executeContentControlsTextSetValue,
  executeContentControlsTextClearValue,
  executeContentControlsDateSetValue,
  executeContentControlsDateClearValue,
  executeContentControlsDateSetDisplayFormat,
  executeContentControlsDateSetDisplayLocale,
  executeContentControlsDateSetStorageFormat,
  executeContentControlsDateSetCalendar,
  executeContentControlsCheckboxGetState,
  executeContentControlsCheckboxSetState,
  executeContentControlsCheckboxToggle,
  executeContentControlsCheckboxSetSymbolPair,
  executeContentControlsChoiceListGetItems,
  executeContentControlsChoiceListSetItems,
  executeContentControlsChoiceListSetSelected,
  executeContentControlsRepeatingSectionListItems,
  executeContentControlsRepeatingSectionInsertItemBefore,
  executeContentControlsRepeatingSectionInsertItemAfter,
  executeContentControlsRepeatingSectionCloneItem,
  executeContentControlsRepeatingSectionDeleteItem,
  executeContentControlsRepeatingSectionSetAllowInsertDelete,
  executeContentControlsGroupWrap,
  executeContentControlsGroupUngroup,
  executeCreateContentControl,
} from './content-controls/content-controls.js';
import type {
  HyperlinksListQuery,
  HyperlinksListResult,
  HyperlinksGetInput,
  HyperlinkInfo,
  HyperlinksWrapInput,
  HyperlinksInsertInput,
  HyperlinksPatchInput,
  HyperlinksRemoveInput,
  HyperlinkMutationResult,
} from './hyperlinks/hyperlinks.types.js';
import type { BookmarksApi, BookmarksAdapter } from './bookmarks/bookmarks.js';
import {
  executeBookmarksList,
  executeBookmarksGet,
  executeBookmarksInsert,
  executeBookmarksRename,
  executeBookmarksRemove,
} from './bookmarks/bookmarks.js';
import type {
  BookmarkListInput,
  BookmarksListResult,
  BookmarkGetInput,
  BookmarkInfo,
  BookmarkInsertInput,
  BookmarkRenameInput,
  BookmarkRemoveInput,
  BookmarkMutationResult,
} from './bookmarks/bookmarks.types.js';
import type { CustomXmlApi, CustomXmlAdapter } from './customXml/customXml.js';
import {
  executeCustomXmlPartsList,
  executeCustomXmlPartsGet,
  executeCustomXmlPartsCreate,
  executeCustomXmlPartsPatch,
  executeCustomXmlPartsRemove,
} from './customXml/customXml.js';
import type {
  CustomXmlPartsListInput,
  CustomXmlPartsListResult,
  CustomXmlPartsGetInput,
  CustomXmlPartInfo,
  CustomXmlPartsCreateInput,
  CustomXmlPartsCreateResult,
  CustomXmlPartsPatchInput,
  CustomXmlPartsRemoveInput,
  CustomXmlPartsMutationResult,
} from './customXml/customXml.types.js';
import {
  executeAnchoredMetadataAttach,
  executeAnchoredMetadataList,
  executeAnchoredMetadataGet,
  executeAnchoredMetadataUpdate,
  executeAnchoredMetadataRemove,
  executeAnchoredMetadataResolve,
} from './metadata/anchored-metadata.js';
import type { AnchoredMetadataApi, AnchoredMetadataAdapter } from './metadata/anchored-metadata.js';
import type {
  AnchoredMetadataAttachInput,
  AnchoredMetadataAttachResult,
  AnchoredMetadataListInput,
  AnchoredMetadataListResult,
  AnchoredMetadataGetInput,
  AnchoredMetadataInfo,
  AnchoredMetadataUpdateInput,
  AnchoredMetadataRemoveInput,
  AnchoredMetadataResolveInput,
  AnchoredMetadataMutationResult,
  AnchoredMetadataResolveInfo,
} from './metadata/anchored-metadata.types.js';
import type { ProtectionApi, ProtectionAdapter } from './protection/protection.js';
import {
  executeProtectionGet,
  executeSetEditingRestriction,
  executeClearEditingRestriction,
} from './protection/protection.js';
import type {
  DocumentProtectionState,
  SetEditingRestrictionInput,
  ClearEditingRestrictionInput,
  ProtectionMutationResult,
  ProtectionGetInput,
} from './protection/protection.types.js';
import type { PermissionRangesApi, PermissionRangesAdapter } from './permission-ranges/permission-ranges.js';
import {
  executePermissionRangesList,
  executePermissionRangesGet,
  executePermissionRangesCreate,
  executePermissionRangesRemove,
  executePermissionRangesUpdatePrincipal,
} from './permission-ranges/permission-ranges.js';
import type {
  PermissionRangesListInput,
  PermissionRangesListResult,
  PermissionRangesGetInput,
  PermissionRangeInfo,
  PermissionRangesCreateInput,
  PermissionRangesRemoveInput,
  PermissionRangesUpdatePrincipalInput,
  PermissionRangeMutationResult,
  PermissionRangeRemoveResult,
} from './permission-ranges/permission-ranges.types.js';
import type { FootnotesApi, FootnotesAdapter } from './footnotes/footnotes.js';
import {
  executeFootnotesList,
  executeFootnotesGet,
  executeFootnotesInsert,
  executeFootnotesUpdate,
  executeFootnotesRemove,
  executeFootnotesConfigure,
} from './footnotes/footnotes.js';
import type {
  FootnoteListInput,
  FootnotesListResult,
  FootnoteGetInput,
  FootnoteInfo,
  FootnoteInsertInput,
  FootnoteUpdateInput,
  FootnoteRemoveInput,
  FootnoteMutationResult,
  FootnoteConfigureInput,
  FootnoteConfigResult,
} from './footnotes/footnotes.types.js';
import type { ClipboardApi, ClipboardAdapter } from './clipboard/clipboard.js';
import {
  executeClipboardParse,
  executeClipboardInsert,
  executeClipboardSerializeSelection,
} from './clipboard/clipboard.js';
import type {
  ClipboardInsertInput,
  ClipboardInsertResult,
  ClipboardParseOptions,
  ClipboardParseResult,
  ClipboardPayload,
  ClipboardSerializeInput,
  ClipboardSerializeResult,
} from './types/clipboard.js';
import type { CrossRefsApi, CrossRefsAdapter } from './cross-refs/cross-refs.js';
import {
  executeCrossRefsList,
  executeCrossRefsGet,
  executeCrossRefsInsert,
  executeCrossRefsRebuild,
  executeCrossRefsRemove,
} from './cross-refs/cross-refs.js';
import type {
  CrossRefListInput,
  CrossRefsListResult,
  CrossRefGetInput,
  CrossRefInfo,
  CrossRefInsertInput,
  CrossRefRebuildInput,
  CrossRefRemoveInput,
  CrossRefMutationResult,
} from './cross-refs/cross-refs.types.js';
import type { IndexApi, IndexAdapter } from './index/index.js';
import {
  executeIndexList,
  executeIndexGet,
  executeIndexInsert,
  executeIndexConfigure,
  executeIndexRebuild,
  executeIndexRemove,
  executeIndexEntryList,
  executeIndexEntryGet,
  executeIndexEntryInsert,
  executeIndexEntryUpdate,
  executeIndexEntryRemove,
} from './index/index.js';
import type {
  IndexListInput,
  IndexListResult,
  IndexGetInput,
  IndexInfo,
  IndexInsertInput,
  IndexConfigureInput,
  IndexRebuildInput,
  IndexRemoveInput,
  IndexMutationResult,
  IndexEntryListInput,
  IndexEntryListResult,
  IndexEntryGetInput,
  IndexEntryInfo,
  IndexEntryInsertInput,
  IndexEntryUpdateInput,
  IndexEntryRemoveInput,
  IndexEntryMutationResult,
} from './index/index.types.js';
import type { CaptionsApi, CaptionsAdapter } from './captions/captions.js';
import {
  executeCaptionsList,
  executeCaptionsGet,
  executeCaptionsInsert,
  executeCaptionsUpdate,
  executeCaptionsRemove,
  executeCaptionsConfigure,
} from './captions/captions.js';
import type {
  CaptionListInput,
  CaptionsListResult,
  CaptionGetInput,
  CaptionInfo,
  CaptionInsertInput,
  CaptionUpdateInput,
  CaptionRemoveInput,
  CaptionMutationResult,
  CaptionConfigureInput,
  CaptionConfigResult,
} from './captions/captions.types.js';
import type { FieldsApi, FieldsAdapter } from './fields/fields.js';
import {
  executeFieldsList,
  executeFieldsGet,
  executeFieldsInsert,
  executeFieldsRebuild,
  executeFieldsRemove,
} from './fields/fields.js';
import type {
  FieldListInput,
  FieldsListResult,
  FieldGetInput,
  FieldInfo,
  FieldInsertInput,
  FieldRebuildInput,
  FieldRemoveInput,
  FieldMutationResult,
} from './fields/fields.types.js';
import type { CitationsApi, CitationsAdapter } from './citations/citations.js';
import {
  executeCitationsList,
  executeCitationsGet,
  executeCitationsInsert,
  executeCitationsUpdate,
  executeCitationsRemove,
  executeCitationSourcesList,
  executeCitationSourcesGet,
  executeCitationSourcesInsert,
  executeCitationSourcesUpdate,
  executeCitationSourcesRemove,
  executeBibliographyGet,
  executeBibliographyInsert,
  executeBibliographyRebuild,
  executeBibliographyConfigure,
  executeBibliographyRemove,
} from './citations/citations.js';
import type {
  CitationListInput,
  CitationsListResult,
  CitationGetInput,
  CitationInfo,
  CitationInsertInput,
  CitationUpdateInput,
  CitationRemoveInput,
  CitationMutationResult,
  CitationSourceListInput,
  CitationSourcesListResult,
  CitationSourceGetInput,
  CitationSourceInfo,
  CitationSourceInsertInput,
  CitationSourceUpdateInput,
  CitationSourceRemoveInput,
  CitationSourceMutationResult,
  BibliographyGetInput,
  BibliographyInfo,
  BibliographyInsertInput,
  BibliographyRebuildInput,
  BibliographyConfigureInput,
  BibliographyRemoveInput,
  BibliographyMutationResult,
} from './citations/citations.types.js';
import type { AuthoritiesApi, AuthoritiesAdapter } from './authorities/authorities.js';
import {
  executeAuthoritiesList,
  executeAuthoritiesGet,
  executeAuthoritiesInsert,
  executeAuthoritiesConfigure,
  executeAuthoritiesRebuild,
  executeAuthoritiesRemove,
  executeAuthorityEntriesList,
  executeAuthorityEntriesGet,
  executeAuthorityEntriesInsert,
  executeAuthorityEntriesUpdate,
  executeAuthorityEntriesRemove,
} from './authorities/authorities.js';
import type {
  AuthoritiesListInput,
  AuthoritiesListResult,
  AuthoritiesGetInput,
  AuthoritiesInfo,
  AuthoritiesInsertInput,
  AuthoritiesConfigureInput,
  AuthoritiesRebuildInput,
  AuthoritiesRemoveInput,
  AuthoritiesMutationResult,
  AuthorityEntryListInput,
  AuthorityEntryListResult,
  AuthorityEntryGetInput,
  AuthorityEntryInfo,
  AuthorityEntryInsertInput,
  AuthorityEntryUpdateInput,
  AuthorityEntryRemoveInput,
  AuthorityEntryMutationResult,
} from './authorities/authorities.types.js';
export type { GetAdapter } from './get/get.js';
export type { FindAdapter, FindOptions } from './find/find.js';
export type { GetNodeAdapter, GetNodeByIdInput } from './get-node/get-node.js';
export type { GetTextAdapter, GetTextInput } from './get-text/get-text.js';
export type { GetMarkdownAdapter, GetMarkdownInput } from './get-markdown/get-markdown.js';
export type { GetHtmlAdapter, GetHtmlInput } from './get-html/get-html.js';
export type { InfoAdapter, InfoInput } from './info/info.js';
export type { ExtractAdapter, ExtractInput } from './extract/extract.js';
export type { WriteAdapter, WriteRequest, RichContentMutationOptions } from './write/write.js';
export type {
  FormatInlineAliasApi,
  FormatInlineAliasInput,
  FormatBoldInput,
  FormatItalicInput,
  FormatRangeInput,
  FormatUnderlineInput,
  FormatStrikethroughInput,
  StyleApplyInput,
  StyleApplyOptions,
} from './format/format.js';
export type {
  InlineRunPatch,
  InlineRunPatchKey,
  InlinePropertyStorage,
  InlinePropertyType,
  InlinePropertyCarrier,
  InlinePropertyRegistryEntry,
  UnderlinePatch,
  ShadingPatch,
  BorderPatch,
  FitTextPatch,
  LangPatch,
  RFontsPatch,
  EastAsianLayoutPatch,
  StylisticSetPatch,
} from './format/inline-run-patch.js';
export {
  INLINE_PROPERTY_REGISTRY,
  INLINE_PROPERTY_KEY_SET,
  INLINE_PROPERTY_BY_KEY,
  INLINE_PROPERTY_KEYS_BY_STORAGE,
  validateInlineRunPatch,
  buildInlineRunPatchSchema,
} from './format/inline-run-patch.js';
export {
  PROPERTY_REGISTRY,
  EXCLUDED_KEYS,
  ALLOWED_KEYS_BY_CHANNEL,
  getPropertyDefinition,
  toJsonSchema,
  buildPatchSchema,
  buildStateSchema,
} from './styles/index.js';
export type {
  ValueSchema,
  MergeStrategy,
  PropertyDefinition,
  StylesAdapter,
  StylesApplyInput,
  StylesApplyRunInput,
  StylesApplyParagraphInput,
  StylesApplyOptions,
  StylesApplyReceipt,
  StylesBooleanState,
  StylesNumberState,
  StylesEnumState,
  StylesObjectState,
  StylesArrayState,
  StylesStateMap,
  StylesChannel,
  StylesRunPatch,
  StylesParagraphPatch,
  StylesTargetResolution,
  StylesApplyReceiptSuccess,
  StylesApplyReceiptFailure,
  NormalizedStylesApplyOptions,
  StyleCatalogView,
  StyleCatalogItemType,
  StyleCatalogFilterType,
  StyleProvenance,
  StyleCatalogDiagnosticSeverity,
  StyleSourcePartStatus,
  StyleCatalogUsageStatus,
  StyleCatalogPreviewStatus,
  StyleCatalogViewStatus,
  StyleCatalogItemVisibility,
  StyleCatalogItemUsage,
  StyleCatalogItemPreview,
  StyleCatalogItem,
  StyleCatalogDefaults,
  StyleCatalogDiagnostic,
  StyleCatalogSourceStatus,
  StylesGetCatalogInput,
  StylesGetCatalogResult,
  StylesGetCatalogAdapter,
} from './styles/index.js';
export {
  STYLE_CATALOG_VIEWS,
  STYLE_CATALOG_FILTER_TYPES,
  executeStylesGetCatalog,
  validateStylesGetCatalogInput,
} from './styles/index.js';
export type {
  TemplatesAdapter,
  TemplatesApi,
  TemplatesApplyInput,
  TemplatesApplyOptions,
  TemplatesApplySource,
  TemplatesApplySourcePath,
  TemplatesApplySourceBase64,
  TemplateBodyPolicy,
  TemplateScope,
  NormalizedTemplatesApplyOptions,
  TemplateScopeReport,
  TemplateSkipReason,
  TemplateScopeSkip,
  TemplateUnsupportedItem,
  TemplateChangeKind,
  TemplateChangedPart,
  TemplateIdMapping,
  TemplateApplyWarning,
  TemplatesApplySourceInfo,
  TemplatesApplyReceiptSuccess,
  TemplatesApplyFailureCode,
  TemplatesApplyReceiptFailure,
  TemplatesApplyReceipt,
} from './templates/index.js';
export { executeTemplatesApply } from './templates/index.js';
export type { CreateAdapter, CreateApi } from './create/create.js';
export {
  executeCreateParagraph,
  executeCreateHeading,
  executeCreateTable,
  executeCreateSectionBreak,
  executeCreateTableOfContents,
} from './create/create.js';
export type {
  TrackChangesAdapter,
  TrackChangesApi,
  TrackChangesGetInput,
  TrackChangesListInput,
  TrackChangesAcceptInput,
  TrackChangesRejectInput,
  TrackChangesAcceptAllInput,
  TrackChangesRejectAllInput,
  TrackChangesRangeInput,
  ReviewDecideInput,
  ReviewDecideRangeInput,
  ReviewDecideTarget,
  LegacyReviewDecideTarget,
  ReviewDecisionTarget,
} from './track-changes/track-changes.js';
export { validateReviewDecideInput } from './track-changes/track-changes.js';
export type { BlocksAdapter } from './blocks/blocks.js';
export type { ImagesAdapter, ImagesApi, CreateImageAdapter } from './images/images.js';
export type {
  ImageAddress,
  ImageCreateLocation,
  ImageSummary,
  ImageWrapDistances,
  ImagePositionInput,
  ImageAnchorOptionsInput,
  ImageZOrderInput,
  CreateImageInput,
  CreateImageResult,
  ImagesListInput,
  ImagesListResult,
  ImagesGetInput,
  ImagesDeleteInput,
  ImagesMutationResult,
  ImagesMutationSuccessResult,
  ImagesMutationFailureResult,
  MoveImageInput,
  ConvertToInlineInput,
  ConvertToFloatingInput,
  SetSizeInput,
  SetWrapTypeInput,
  SetWrapSideInput,
  SetWrapDistancesInput,
  SetPositionInput,
  SetAnchorOptionsInput,
  SetZOrderInput,
  ScaleInput,
  SetLockAspectRatioInput,
  RotateInput,
  FlipInput,
  CropInput,
  ResetCropInput,
  ReplaceSourceInput,
  SetAltTextInput,
  SetDecorativeInput,
  SetNameInput,
  SetHyperlinkInput,
  InsertCaptionInput,
  UpdateCaptionInput,
  RemoveCaptionInput,
} from './images/images.types.js';
export type { TocApi, TocAdapter } from './toc/toc.js';
export type { BookmarksApi, BookmarksAdapter } from './bookmarks/bookmarks.js';
export type {
  CustomXmlApi,
  CustomXmlAdapter,
  CustomXmlPartsApi,
  CustomXmlPartsAdapter,
} from './customXml/customXml.js';
export type { AnchoredMetadataApi, AnchoredMetadataAdapter } from './metadata/anchored-metadata.js';
export type { ProtectionApi, ProtectionAdapter } from './protection/protection.js';
export * from './protection/protection.types.js';
export type { PermissionRangesApi, PermissionRangesAdapter } from './permission-ranges/permission-ranges.js';
export type * from './permission-ranges/permission-ranges.types.js';
export type { FootnotesApi, FootnotesAdapter } from './footnotes/footnotes.js';
export type { ClipboardApi, ClipboardAdapter } from './clipboard/clipboard.js';
export {
  executeClipboardParse,
  executeClipboardInsert,
  executeClipboardSerializeSelection,
} from './clipboard/clipboard.js';
// Clipboard types are already re-exported via `./types/index.js` above; a
// second `export * from './types/clipboard.js'` duplicates every name.
export type { CrossRefsApi, CrossRefsAdapter } from './cross-refs/cross-refs.js';
export type { IndexApi, IndexAdapter } from './index/index.js';
export type { CaptionsApi, CaptionsAdapter } from './captions/captions.js';
export type { FieldsApi, FieldsAdapter } from './fields/fields.js';
export type { CitationsApi, CitationsAdapter } from './citations/citations.js';
export type { AuthoritiesApi, AuthoritiesAdapter } from './authorities/authorities.js';
export type {
  TocAddress,
  TocSourceConfig,
  TocDisplayConfig,
  TocPreservedSwitches,
  TocConfigurePatch,
  TocSwitchConfig,
  TocDomain,
  TocListQuery,
  TocListResult,
  TocGetInput,
  TocInfo,
  TocConfigureInput,
  TocUpdateInput,
  TocRemoveInput,
  TocMutationResult,
  TocMutationSuccess,
  TocMutationFailure,
  TocCreateLocation,
  CreateTableOfContentsInput,
  CreateTableOfContentsResult,
  CreateTableOfContentsSuccess,
  CreateTableOfContentsFailure,
  // TC entry types
  TocEntryAddress,
  TocEntryInsertionTarget,
  TocMarkEntryInput,
  TocUnmarkEntryInput,
  TocListEntriesQuery,
  TocListEntriesResult,
  TocGetEntryInput,
  TocEntryInfo,
  TocEditEntryInput,
  TocEntryMutationResult,
  TocEntryMutationSuccess,
  TocEntryMutationFailure,
  TocEntryDomain,
  TocEntryProperties,
} from './toc/toc.types.js';
export type { HyperlinksApi, HyperlinksAdapter } from './hyperlinks/hyperlinks.js';
export type {
  ContentControlsApi,
  ContentControlsAdapter,
  ContentControlsCreateAdapter,
} from './content-controls/content-controls.js';
export type {
  ContentControlMutationResult,
  ContentControlMutationSuccess,
  ContentControlMutationFailure,
  ContentControlsListResult,
  ContentControlsListQuery,
  ContentControlTarget,
  ContentControlType,
  ContentControlProperties,
  ContentControlBinding,
  ContentControlSymbol,
  ContentControlListItem,
  ContentControlAppearance,
  LockMode,
  CreateContentControlInput,
  ContentControlsGetInput,
  ContentControlsWrapInput,
  ContentControlsUnwrapInput,
  ContentControlsDeleteInput,
  ContentControlsCopyInput,
  ContentControlsMoveInput,
  ContentControlsPatchInput,
  ContentControlsSetLockModeInput,
  ContentControlsSetTypeInput,
  ContentControlsGetContentInput,
  ContentControlsGetContentResult,
  ContentControlsReplaceContentInput,
  ContentControlsClearContentInput,
  ContentControlsAppendContentInput,
  ContentControlsPrependContentInput,
  ContentControlsInsertBeforeInput,
  ContentControlsInsertAfterInput,
  ContentControlsGetBindingInput,
  ContentControlsSetBindingInput,
  ContentControlsClearBindingInput,
  ContentControlsGetRawPropertiesInput,
  ContentControlsGetRawPropertiesResult,
  ContentControlsPatchRawPropertiesInput,
  RawPatchOp,
  ContentControlsValidateWordCompatibilityInput,
  ContentControlsValidateWordCompatibilityResult,
  WordCompatibilityDiagnostic,
  ContentControlsNormalizeWordCompatibilityInput,
  ContentControlsNormalizeTagPayloadInput,
  ContentControlsListInRangeInput,
  ContentControlsSelectByTagInput,
  ContentControlsSelectByTitleInput,
  ContentControlsListChildrenInput,
  ContentControlsGetParentInput,
  ContentControlsTextSetMultilineInput,
  ContentControlsTextSetValueInput,
  ContentControlsTextClearValueInput,
  ContentControlsDateSetValueInput,
  ContentControlsDateClearValueInput,
  ContentControlsDateSetDisplayFormatInput,
  ContentControlsDateSetDisplayLocaleInput,
  ContentControlsDateSetStorageFormatInput,
  ContentControlsDateSetCalendarInput,
  ContentControlsCheckboxGetStateInput,
  ContentControlsCheckboxGetStateResult,
  ContentControlsCheckboxSetStateInput,
  ContentControlsCheckboxToggleInput,
  ContentControlsCheckboxSetSymbolPairInput,
  ContentControlsChoiceListGetItemsInput,
  ContentControlsChoiceListGetItemsResult,
  ContentControlsChoiceListSetItemsInput,
  ContentControlsChoiceListSetSelectedInput,
  ContentControlsRepeatingSectionListItemsInput,
  ContentControlsRepeatingSectionListItemsResult,
  ContentControlsRepeatingSectionInsertItemBeforeInput,
  ContentControlsRepeatingSectionInsertItemAfterInput,
  ContentControlsRepeatingSectionCloneItemInput,
  ContentControlsRepeatingSectionDeleteItemInput,
  ContentControlsRepeatingSectionSetAllowInsertDeleteInput,
  ContentControlsGroupWrapInput,
  ContentControlsGroupUngroupInput,
  ContentControlsPaginationOptions,
  TextControlProperties,
  DateControlProperties,
  CheckboxControlProperties,
  ChoiceControlProperties,
  RepeatingSectionControlProperties,
} from './content-controls/content-controls.types.js';
export {
  CONTENT_CONTROL_TYPES,
  LOCK_MODES,
  CONTENT_CONTROL_APPEARANCES,
} from './content-controls/content-controls.types.js';
export type {
  HyperlinkTarget,
  HyperlinkDestination,
  HyperlinkSpec,
  HyperlinkPatch,
  HyperlinkReadProperties,
  HyperlinkDomain,
  HyperlinkInfo,
  HyperlinkMutationResult,
  HyperlinkMutationSuccess,
  HyperlinkMutationFailure,
  HyperlinksListResult,
  HyperlinksListQuery,
  HyperlinksGetInput,
  HyperlinksWrapInput,
  HyperlinksInsertInput,
  HyperlinksPatchInput,
  HyperlinksRemoveInput,
} from './hyperlinks/hyperlinks.types.js';
export type * from './bookmarks/bookmarks.types.js';
export type * from './customXml/customXml.types.js';
export type * from './metadata/anchored-metadata.types.js';
export type * from './footnotes/footnotes.types.js';
export type * from './cross-refs/cross-refs.types.js';
export type * from './index/index.types.js';
export type * from './captions/captions.types.js';
export type * from './fields/fields.types.js';
export type * from './citations/citations.types.js';
export type * from './authorities/authorities.types.js';
export type { ListsAdapter } from './lists/lists.js';
export type { SectionsAdapter } from './sections/sections.js';
export type { ParagraphsAdapter, ParagraphFormatApi, ParagraphStylesApi } from './paragraphs/paragraphs.js';
export type {
  ParagraphTarget,
  ParagraphBlockType,
  ParagraphMutationResult,
  ParagraphMutationSuccess,
  ParagraphMutationFailure,
  MutationResolution,
  ParagraphAlignment,
  TabStopAlignment,
  TabStopLeader,
  BorderSide,
  ClearBorderSide,
  LineRule,
  ParagraphsSetStyleInput,
  ParagraphSemanticStyleRole,
  ParagraphsSetStyleRefInput,
  ParagraphsClearStyleInput,
  ParagraphsResetDirectFormattingInput,
  ParagraphsSetAlignmentInput,
  ParagraphsClearAlignmentInput,
  ParagraphsSetIndentationInput,
  ParagraphsClearIndentationInput,
  ParagraphsSetSpacingInput,
  ParagraphsClearSpacingInput,
  ParagraphsSetKeepOptionsInput,
  ParagraphsSetOutlineLevelInput,
  ParagraphsSetFlowOptionsInput,
  ParagraphsSetTabStopInput,
  ParagraphsClearTabStopInput,
  ParagraphsClearAllTabStopsInput,
  ParagraphsSetBorderInput,
  ParagraphsClearBorderInput,
  ParagraphsSetShadingInput,
  ParagraphsClearShadingInput,
  ParagraphsSetMarkRunPropsInput,
  ParagraphsSetDirectionInput,
  ParagraphsClearDirectionInput,
  ParagraphsSetNumberingInput,
  ParagraphDirection,
  AlignmentPolicy,
} from './paragraphs/paragraphs.js';
export {
  PARAGRAPH_ALIGNMENTS,
  TAB_STOP_ALIGNMENTS,
  TAB_STOP_LEADERS,
  BORDER_SIDES,
  CLEAR_BORDER_SIDES,
  LINE_RULES,
  PARAGRAPH_DIRECTIONS,
  ALIGNMENT_POLICIES,
} from './paragraphs/paragraphs.js';
export type {
  BlockAddress,
  BlockRange,
  CanContinueReason,
  CanJoinReason,
  JoinDirection,
  ListInsertInput,
  ListItemAddress,
  ListItemInfo,
  ListKind,
  ListsAttachInput,
  ListsCanContinuePreviousInput,
  ListsCanContinuePreviousResult,
  ListsCanJoinInput,
  ListsCanJoinResult,
  ListsConvertToTextInput,
  ListsConvertToTextResult,
  ListsContinuePreviousInput,
  ListsCreateInput,
  ListsCreateResult,
  ListsDetachInput,
  ListsDetachResult,
  ListsDeleteInput,
  ListsDeleteResult,
  ListsFailureCode,
  ListsGetInput,
  ListsInsertResult,
  ListsJoinInput,
  ListsJoinResult,
  ListsListQuery,
  ListsListResult,
  ListsMutateItemResult,
  ListsSeparateInput,
  ListsSeparateResult,
  ListsMergeInput,
  ListsMergeResult,
  ListsSplitInput,
  ListsSplitResult,
  ListsSetLevelInput,
  ListsSetLevelRestartInput,
  ListsSetValueInput,
  ListTargetInput,
  MutationScope,
  LevelAlignment,
  TrailingCharacter,
  ListPresetId,
  ListPresetMarker,
  ListLevelTemplate,
  ListTemplate,
  ListsApplyTemplateInput,
  ListsApplyPresetInput,
  ListsCaptureTemplateInput,
  ListsCaptureTemplateResult,
  ListsCaptureTemplateSuccessResult,
  ListsSetLevelNumberingInput,
  ListsSetLevelBulletInput,
  ListsSetLevelPictureBulletInput,
  ListsSetLevelAlignmentInput,
  ListsSetLevelIndentsInput,
  ListsSetLevelTrailingCharacterInput,
  ListsSetLevelMarkerFontInput,
  ListsClearLevelOverridesInput,
  ListsSetTypeInput,
  ListStyle,
  ListLevelStyle,
  ListLevelLayout,
  ListsGetStyleInput,
  ListsGetStyleResult,
  ListsGetStyleSuccessResult,
  ListsApplyStyleInput,
  ListsRestartAtInput,
  ListsSetLevelNumberStyleInput,
  ListsSetLevelTextInput,
  ListsSetLevelStartInput,
  ListsSetLevelLayoutInput,
  ListsGetStateInput,
  ListsGetStateResult,
  ListsApplyInput,
  ListsContinueV2Input,
  ListsRestartV2Input,
  ListsRemoveV2Input,
} from './lists/lists.types.js';
export {
  LIST_KINDS,
  LIST_INSERT_POSITIONS,
  JOIN_DIRECTIONS,
  MUTATION_SCOPES,
  LEVEL_ALIGNMENTS,
  TRAILING_CHARACTERS,
  LIST_PRESET_IDS,
  LIST_PRESET_MARKERS,
} from './lists/lists.types.js';
export type {
  CreateSectionBreakInput,
  CreateSectionBreakResult,
  DocumentMutationResult,
  SectionAddress,
  SectionBorderSpec,
  SectionBreakCreateLocation,
  SectionBreakRepresentation,
  SectionBreakType,
  SectionColumns,
  SectionDirection,
  SectionDomain,
  SectionHeaderFooterKind,
  SectionHeaderFooterMargins,
  SectionHeaderFooterRefs,
  SectionHeaderFooterVariant,
  SectionInfo,
  SectionLineNumbering,
  SectionLineNumberRestart,
  SectionMutationResult,
  SectionOrientation,
  SectionPageBorders,
  SectionPageMargins,
  SectionPageNumbering,
  SectionPageNumberingChapterSeparator,
  SectionPageNumberingFormat,
  SectionPageSetup,
  SectionRangeDomain,
  SectionTargetInput,
  SectionVerticalAlign,
  SectionsClearHeaderFooterRefInput,
  SectionsClearPageBordersInput,
  SectionsGetInput,
  SectionsListQuery,
  SectionsListResult,
  SectionsSetBreakTypeInput,
  SectionsSetColumnsInput,
  SectionsSetHeaderFooterMarginsInput,
  SectionsSetHeaderFooterRefInput,
  SectionsSetLineNumberingInput,
  SectionsSetLinkToPreviousInput,
  SectionsSetOddEvenHeadersFootersInput,
  SectionsSetPageBordersInput,
  SectionsSetPageMarginsInput,
  SectionsSetPageNumberingInput,
  SectionsSetPageSetupInput,
  SectionsSetSectionDirectionInput,
  SectionsSetTitlePageInput,
  SectionsSetVerticalAlignInput,
} from './sections/sections.types.js';
export type {
  CommentsCreateReceipt,
  CommentsCreateInput,
  CommentCreateAttributionInput,
  CommentsPatchInput,
  CommentsDeleteInput,
  CommentsAdapter,
  CommentsApi,
  GetCommentInput,
  // Tracked-change comment target convenience.
  TrackedChangeCommentTarget,
  TrackedChangeCommentTargetSide,
  TextSearchCommentTarget,
  // Legacy input types: exported for internal adapter use, not part of the contract.
  AddCommentInput,
  EditCommentInput,
  ReplyToCommentInput,
  MoveCommentInput,
  ResolveCommentInput,
  ReopenCommentInput,
  RemoveCommentInput,
  SetCommentInternalInput,
  GoToCommentInput,
  SetCommentActiveInput,
} from './comments/comments.js';
export {
  executeCommentsCreate,
  executeCommentsPatch,
  executeCommentsDelete,
  executeGetComment,
  executeListComments,
} from './comments/comments.js';
export type {
  CommentInfo,
  CommentDomain,
  CommentMetadata,
  CommentMetadataValue,
  CommentsListQuery,
  CommentsListResult,
  CommentTrackedChangeSide,
  CommentTrackedChangeLink,
  CommentTarget,
} from './comments/comments.types.js';
export type { BlocksApi } from './blocks/blocks.js';
export { executeBlocksFindText } from './blocks/find-text.js';
export {
  executeBlocksList,
  executeBlocksDelete,
  executeBlocksDeleteRange,
  executeBlocksSplit,
  executeBlocksMerge,
  executeBlocksMove,
} from './blocks/blocks.js';
// v2 list operation execute wrappers + v1 indent / outdent.
export {
  executeListsIndent,
  executeListsOutdent,
  executeListsGetState,
  executeListsApply,
  executeListsContinueV2,
  executeListsRestartV2,
  executeListsRemoveV2,
} from './lists/lists.js';
export { DocumentApiValidationError } from './errors.js';
export { textReceiptToSDReceipt, buildStructuralReceipt } from './receipt-bridge.js';
export type { MutationReceiptBridgeContext, StructuralReceiptParams } from './receipt-bridge.js';
export { isBlockNodeAddress } from './validation-primitives.js';
export type {
  InsertInput,
  InsertContentType,
  TextInsertInput,
  RichContentInsertInput,
  LegacyInsertInput,
} from './insert/insert.js';
export { isStructuralInsertInput } from './insert/insert.js';
export type { ReplaceInput, TextReplaceInput, RichContentReplaceInput } from './replace/replace.js';
export { executeReplace, isStructuralReplaceInput, isRichContentReplaceInput } from './replace/replace.js';
export { executeFind } from './find/find.js';
export { validateDocumentFragment, validateSDFragment } from './validation/fragment-validator.js';
export type { DeleteInput } from './delete/delete.js';
export interface TablesApi {
  convertFromText(input: TablesConvertFromTextInput, options?: MutationOptions): TableMutationResult;
  delete(input: TableLocator, options?: MutationOptions): TableMutationResult;
  clearContents(input: TableLocator, options?: MutationOptions): TableMutationResult;
  move(input: TablesMoveInput, options?: MutationOptions): TableMutationResult;
  split(input: TablesSplitInput, options?: MutationOptions): TableMutationResult;
  convertToText(input: TablesConvertToTextInput, options?: MutationOptions): TableMutationResult;
  setLayout(input: TablesSetLayoutInput, options?: MutationOptions): TableMutationResult;
  insertRow(input: TablesInsertRowInput, options?: MutationOptions): TableMutationResult;
  deleteRow(input: TablesDeleteRowInput, options?: MutationOptions): TableMutationResult;
  moveRow(input: TablesMoveRowInput, options?: MutationOptions): TableMutationResult;
  setRowHeight(input: TablesSetRowHeightInput, options?: MutationOptions): TableMutationResult;
  distributeRows(input: TablesDistributeRowsInput, options?: MutationOptions): TableMutationResult;
  setRowOptions(input: TablesSetRowOptionsInput, options?: MutationOptions): TableMutationResult;
  insertColumn(input: TablesInsertColumnInput, options?: MutationOptions): TableMutationResult;
  deleteColumn(input: TablesDeleteColumnInput, options?: MutationOptions): TableMutationResult;
  moveColumn(input: TablesMoveColumnInput, options?: MutationOptions): TableMutationResult;
  setColumnWidth(input: TablesSetColumnWidthInput, options?: MutationOptions): TableMutationResult;
  distributeColumns(input: TablesDistributeColumnsInput, options?: MutationOptions): TableMutationResult;
  insertCell(input: TablesInsertCellInput, options?: MutationOptions): TableMutationResult;
  deleteCell(input: TablesDeleteCellInput, options?: MutationOptions): TableMutationResult;
  mergeCells(input: TablesMergeCellsInput, options?: MutationOptions): TableMutationResult;
  unmergeCells(input: TablesUnmergeCellsInput, options?: MutationOptions): TableMutationResult;
  splitCell(input: TablesSplitCellInput, options?: MutationOptions): TableMutationResult;
  setCellProperties(input: TablesSetCellPropertiesInput, options?: MutationOptions): TableMutationResult;
  setCellText(input: TablesSetCellTextInput, options?: MutationOptions): TableMutationResult;
  sort(input: TablesSortInput, options?: MutationOptions): TableMutationResult;
  setAltText(input: TablesSetAltTextInput, options?: MutationOptions): TableMutationResult;
  setStyle(input: TablesSetStyleInput, options?: MutationOptions): TableMutationResult;
  clearStyle(input: TablesClearStyleInput, options?: MutationOptions): TableMutationResult;
  setStyleOption(input: TablesSetStyleOptionInput, options?: MutationOptions): TableMutationResult;
  setBorder(input: TablesSetBorderInput, options?: MutationOptions): TableMutationResult;
  clearBorder(input: TablesClearBorderInput, options?: MutationOptions): TableMutationResult;
  applyBorderPreset(input: TablesApplyBorderPresetInput, options?: MutationOptions): TableMutationResult;
  setShading(input: TablesSetShadingInput, options?: MutationOptions): TableMutationResult;
  clearShading(input: TablesClearShadingInput, options?: MutationOptions): TableMutationResult;
  setTablePadding(input: TablesSetTablePaddingInput, options?: MutationOptions): TableMutationResult;
  setCellPadding(input: TablesSetCellPaddingInput, options?: MutationOptions): TableMutationResult;
  setCellSpacing(input: TablesSetCellSpacingInput, options?: MutationOptions): TableMutationResult;
  clearCellSpacing(input: TablesClearCellSpacingInput, options?: MutationOptions): TableMutationResult;
  applyStyle(input: TablesApplyStyleInput, options?: MutationOptions): TableMutationResult;
  setBorders(input: TablesSetBordersInput, options?: MutationOptions): TableMutationResult;
  setTableOptions(input: TablesSetTableOptionsInput, options?: MutationOptions): TableMutationResult;
  applyPreset(input: TablesApplyPresetInput, options?: MutationOptions): TableMutationResult;
  get(input: TablesGetInput): TablesGetOutput;
  getCells(input: TablesGetCellsInput): TablesGetCellsOutput;
  getProperties(input: TablesGetPropertiesInput): TablesGetPropertiesOutput;
  getStyles(input?: TablesGetStylesInput): TablesGetStylesOutput;
  setDefaultStyle(input: TablesSetDefaultStyleInput, options?: MutationOptions): DocumentMutationResult;
  clearDefaultStyle(input?: TablesClearDefaultStyleInput, options?: MutationOptions): DocumentMutationResult;
}
export type TablesAdapter = Omit<TablesApi, 'moveRow' | 'moveColumn'> & {
  moveRow?: TablesApi['moveRow'];
  moveColumn?: TablesApi['moveColumn'];
};
/**
 * Callable capability accessor returned by `createDocumentApi`.
 *
 * Can be invoked directly (`capabilities()`) or via the `.get()` alias.
 */
export interface CapabilitiesApi {
  (): DocumentApiCapabilities;
  get(): DocumentApiCapabilities;
  check(input: SDHtmlMarkdownSupportCheckInput): Promise<SDHtmlMarkdownSupportCheckResult>;
}
export interface QueryApi {
  /** Accepts canonical nested input or a selector shorthand normalized to `{ select: ... }` internally. */
  match(input: QueryMatchInput | TextSelector | NodeSelector): QueryMatchOutput;
}
export interface MutationsApi {
  preview(input: MutationsPreviewInput): Promise<MutationsPreviewOutput>;
  apply(input: MutationsApplyInput): Promise<PlanReceipt>;
}
export interface RangesApi {
  resolve(input: ResolveRangeInput): ResolveRangeOutput;
}
export interface RangesAdapter {
  resolve(input: ResolveRangeInput): ResolveRangeOutput;
}
export interface QueryAdapter {
  match(input: QueryMatchInput): QueryMatchOutput;
}
export interface MutationsAdapter {
  preview(input: MutationsPreviewInput): Promise<MutationsPreviewOutput>;
  apply(input: MutationsApplyInput): Promise<PlanReceipt>;
}
/**
 * The Document API interface for querying and inspecting document nodes.
 */
export interface DocumentApi {
  /**
   * Read the full document as an SDDocument structure.
   * @param input - Get input with optional read options.
   * @returns An SDDocument with body content projected into SDM/1 canonical shapes.
   */
  get(input: SDGetInput): SDDocument;
  /**
   * Find nodes in the document matching an SDFindInput.
   * @param input - The find input with selector, pagination, and scope.
   * @returns An SDFindResult with matching SDNodeResult items.
   */
  find(input: SDFindInput): SDFindResult;
  /**
   * Get a node by its address as an SDNodeResult.
   * @param address - The node address to resolve.
   * @returns SDNodeResult with the projected node and its address.
   */
  getNode(address: NodeAddress): SDNodeResult;
  /**
   * Get a block node by its ID as an SDNodeResult.
   * @param input - The node-id input payload.
   * @returns SDNodeResult with the projected node and its address.
   */
  getNodeById(input: GetNodeByIdInput): SDNodeResult;
  /**
   * Return the full document text content.
   */
  getText(input: GetTextInput): string;
  /**
   * Return the full document content as a Markdown string.
   */
  getMarkdown(input: GetMarkdownInput): string;
  /**
   * Return the full document content as an HTML string.
   */
  getHtml(input: GetHtmlInput): string;
  projectHtml(input: ProjectHtmlInput): Promise<SDContentProjectionResult<'html'>>;
  projectMarkdown(input: ProjectMarkdownInput): Promise<SDContentProjectionResult<'markdown'>>;
  /**
   * Convert a Markdown string into an SDM/1 structural fragment.
   */
  markdownToFragment(input: MarkdownToFragmentInput): SDMarkdownToFragmentResult;
  /**
   * Convert an HTML string into an SDM/1 structural fragment.
   */
  htmlToFragment(input: HtmlToFragmentInput): SDHtmlToFragmentResult;
  /**
   * Return document summary info including document counts and capabilities.
   */
  info(input: InfoInput): DocumentInfo;
  /**
   * Extract all document content with stable IDs for RAG pipelines.
   * Returns blocks with full text, comments, and tracked changes.
   */
  extract(input: ExtractInput): ExtractResult;
  /**
   * Clear all document body content, leaving a single empty paragraph.
   */
  clearContent(input: ClearContentInput, options?: RevisionGuardOptions): Receipt;
  /**
   * Comment operations.
   */
  comments: CommentsApi;
  /**
   * Insert content at a target location.
   * If target is omitted, inserts at the end of the document.
   */
  insert(input: InsertInput, options?: RichContentMutationOptions): SDMutationReceipt;
  /**
   * Replace text at a target range.
   */
  replace(input: ReplaceInput, options?: RichContentMutationOptions): SDMutationReceipt;
  /**
   * Delete text at a target range.
   */
  delete(input: DeleteInput, options?: MutationOptions): TextMutationReceipt;
  /**
   * Formatting operations (inline and paragraph direct formatting).
   */
  format: FormatApi & { paragraph: ParagraphFormatApi };
  /**
   * Legacy root-level alias for inline range formatting.
   *
   * Routes to {@link DocumentApi.format.apply}.
   */
  formatRange(input: FormatRangeInput, options?: MutationOptions): TextMutationReceipt;
  /**
   * Stylesheet operations (docDefaults, style definitions, paragraph style references).
   */
  styles: StylesApi & { paragraph: ParagraphStylesApi };
  /**
   * Template/substrate operations (apply detected DOCX substrate from a source package).
   */
  templates: TemplatesApi;
  /**
   * Tracked-change operations (list, get, decide).
   */
  trackChanges: TrackChangesApi;
  /**
   * Block-level structural operations (list, delete, delete-range).
   */
  blocks: BlocksApi;
  /**
   * Structural creation operations.
   */
  create: CreateApi;
  /**
   * List item operations.
   */
  lists: ListsApi;
  /**
   * Section structure and page setup operations.
   */
  sections: SectionsApi;
  /**
   * Table operations.
   */
  tables: TablesApi;
  /**
   * Table of contents operations.
   */
  toc: TocApi;
  /**
   * Image lifecycle and placement operations.
   */
  images: ImagesApi;
  /**
   * Hyperlink discovery, creation, and metadata management.
   */
  hyperlinks: HyperlinksApi;
  /**
   * Header/footer structure, references, and part lifecycle operations.
   */
  headerFooters: HeaderFootersApi;
  /**
   * Content control (SDT) discovery, mutation, and typed-control operations.
   */
  contentControls: ContentControlsApi;
  /**
   * Bookmark operations.
   */
  bookmarks: BookmarksApi;
  /**
   * Footnote and endnote operations.
   */
  footnotes: FootnotesApi;
  /**
   * Clipboard parse, insert, and selection serialization operations.
   */
  clipboard: ClipboardApi;
  /**
   * Cross-reference field operations.
   */
  crossRefs: CrossRefsApi;
  /**
   * Index (INDEX field) and XE entry operations.
   */
  index: IndexApi;
  /**
   * Caption paragraph operations.
   */
  captions: CaptionsApi;
  /**
   * Raw field operations.
   */
  fields: FieldsApi;
  /**
   * Citation, source, and bibliography operations.
   */
  citations: CitationsApi;
  /**
   * Table of authorities and TA entry operations.
   */
  authorities: AuthoritiesApi;
  /**
   * Selector-based query with cardinality contracts for mutation targeting.
   */
  query: QueryApi;
  /**
   * Deterministic range construction from explicit document anchors.
   */
  ranges: RangesApi;
  /**
   * Read the editor's current selection as a portable SelectionInfo.
   * Primitive for custom UIs (toolbars, sidebars, popovers).
   */
  selection: SelectionApi;
  /**
   * Mutation plan engine: preview and apply atomic mutation plans.
   */
  mutations: MutationsApi;
  /**
   * Throughput-oriented batch executor with stepwise operation semantics.
   */
  plan: PlanApi<PlanExecuteResult | Promise<PlanExecuteResult>>;
  /**
   * Snapshot-based document comparison and replay.
   */
  diff: DiffApi;
  /**
   * Modeful DOCX export (review-preserving / final / original) with a
   * structured degradation report.
   */
  export: ExportApi;
  /**
   * History operations (undo/redo) scoped to the active editor instance.
   * Session-scoped: reflects the runtime undo/redo stack, not persistent state.
   */
  history: HistoryApi;
  /**
   * Document-level protection state and editing restriction operations.
   */
  protection: ProtectionApi;
  /**
   * Permission range exception operations for protected documents.
   */
  permissionRanges: PermissionRangesApi;
  /**
   * Custom XML Data Storage Part operations (ECMA-376 §15.2.5, §15.2.6).
   * Read and write raw custom XML parts in the OOXML package.
   */
  customXml: CustomXmlApi;
  /**
   * Anchored metadata — attach a JSON payload to a span of text and read
   * it back across DOCX round-trips. Backed by hidden inline content
   * controls and namespaced Custom XML Data Storage Parts; consumers see
   * one operation set.
   */
  metadata: AnchoredMetadataApi;
  /**
   * Runtime capability introspection.
   *
   * Callable directly (`capabilities()`) or via `.get()`.
   */
  capabilities: CapabilitiesApi;
  /**
   * Dynamically dispatch any operation by its operation ID.
   *
   * For TypeScript consumers, the return type narrows based on the operationId.
   * For dynamic callers (AI agents, automation), accepts {@link DynamicInvokeRequest}
   * with `unknown` input. Invalid inputs produce adapter-level errors.
   *
   * @param request - Operation envelope with operationId, input, and optional options.
   * @returns The operation-specific result payload from the dispatched handler.
   * @throws {Error} When operationId is unknown.
   */
  invoke<T extends OperationId>(request: InvokeRequest<T>): InvokeResult<T>;
  invoke(request: DynamicInvokeRequest): unknown;
}
export interface DocumentApiAdapters {
  get: GetAdapter;
  find: FindAdapter;
  getNode: GetNodeAdapter;
  getText: GetTextAdapter;
  getMarkdown: GetMarkdownAdapter;
  getHtml: GetHtmlAdapter;
  projectHtml?: ProjectHtmlAdapter;
  projectMarkdown?: ProjectMarkdownAdapter;
  markdownToFragment: MarkdownToFragmentAdapter;
  htmlToFragment?: HtmlToFragmentAdapter;
  info: InfoAdapter;
  extract: ExtractAdapter;
  clearContent: ClearContentAdapter;
  capabilities: CapabilitiesAdapter;
  comments: CommentsAdapter;
  write: WriteAdapter;
  selectionMutation: SelectionMutationAdapter;
  styles: StylesAdapter;
  templates: TemplatesAdapter;
  trackChanges: TrackChangesAdapter;
  create: CreateAdapter;
  blocks: BlocksAdapter;
  lists: ListsAdapter;
  sections: SectionsAdapter;
  paragraphs: ParagraphsAdapter;
  tables: TablesAdapter;
  toc: TocAdapter;
  images: ImagesAdapter & CreateImageAdapter;
  hyperlinks: HyperlinksAdapter;
  headerFooters: HeaderFootersAdapter;
  contentControls: ContentControlsAdapter & ContentControlsCreateAdapter;
  bookmarks?: BookmarksAdapter;
  footnotes?: FootnotesAdapter;
  clipboard?: ClipboardAdapter;
  crossRefs?: CrossRefsAdapter;
  index?: IndexAdapter;
  captions?: CaptionsAdapter;
  fields?: FieldsAdapter;
  citations?: CitationsAdapter;
  authorities?: AuthoritiesAdapter;
  ranges: RangesAdapter;
  /**
   * Optional: when omitted, `editor.doc.selection.*` throws
   * `SELECTION_ADAPTER_UNAVAILABLE`. All first-party engines register one;
   * external consumers constructing an adapter bag manually should only
   * need this if they invoke selection operations.
   */
  selection?: SelectionAdapter;
  query: QueryAdapter;
  mutations: MutationsAdapter;
  diff: DiffAdapter;
  /** Modeful DOCX export. Optional; gated when the engine does not provide it. */
  export?: ExportAdapter;
  history: HistoryAdapter;
  protection: ProtectionAdapter;
  permissionRanges: PermissionRangesAdapter;
  /** Custom XML Data Storage Part operations. Optional; not all engines support custom XML. */
  customXml?: CustomXmlAdapter;
  /**
   * Anchored-metadata operations (metadata.*). Optional; not all engines
   * support attaching JSON metadata to anchored spans.
   */
  metadata?: AnchoredMetadataAdapter;
}
/**
 * Creates a Document API instance from the provided adapters.
 *
 * @param adapters - Engine-specific adapters (find, getNode, comments, write, format, trackChanges, create, lists, tables).
 * @returns A {@link DocumentApi} instance.
 *
 * @example
 * ```ts
 * const api = createDocumentApi(adapters);
 *
 * const match = api.query.match({
 *   select: { type: 'node', nodeType: 'heading' },
 *   require: 'first',
 * });
 *
 * const address = match.items?.[0]?.address;
 * if (address) {
 *   const nodeResult = api.getNode(address);
 *   console.log(nodeResult.node.kind);
 * }
 * ```
 */
/**
 * Validates and normalizes query.match input: accepts canonical QueryMatchInput
 * or a flat TextSelector/NodeSelector shorthand.
 */
function executeQueryMatch(
  adapter: { match(input: QueryMatchInput): QueryMatchOutput },
  input: QueryMatchInput | TextSelector | NodeSelector,
): QueryMatchOutput {
  if (!input || typeof input !== 'object') {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      'query.match requires a QueryMatchInput or selector object.',
      { value: input },
    );
  }
  const rawInput = input as Record<string, unknown> &
    Partial<QueryMatchInput> &
    Partial<TextSelector> &
    Partial<NodeSelector>;
  const isFlatNodeShorthand =
    rawInput.type === 'node' ||
    (rawInput.type === undefined && (rawInput.nodeType !== undefined || rawInput.kind !== undefined));
  const normalized: QueryMatchInput =
    'select' in input
      ? input
      : rawInput.type === 'text'
        ? {
            select: {
              type: 'text',
              pattern: rawInput.pattern as string,
              ...(rawInput.mode !== undefined ? { mode: rawInput.mode as TextSelector['mode'] } : {}),
              ...(rawInput.caseSensitive !== undefined ? { caseSensitive: rawInput.caseSensitive as boolean } : {}),
              ...(rawInput.wholeWord !== undefined ? { wholeWord: rawInput.wholeWord as boolean } : {}),
            },
            ...(rawInput.within !== undefined ? { within: rawInput.within as QueryMatchInput['within'] } : {}),
            ...(rawInput.in !== undefined ? { in: rawInput.in as QueryMatchInput['in'] } : {}),
            ...(rawInput.require !== undefined ? { require: rawInput.require as QueryMatchInput['require'] } : {}),
            ...(rawInput.includeNodes !== undefined ? { includeNodes: rawInput.includeNodes as boolean } : {}),
            ...(rawInput.limit !== undefined ? { limit: rawInput.limit as number } : {}),
            ...(rawInput.offset !== undefined ? { offset: rawInput.offset as number } : {}),
          }
        : isFlatNodeShorthand
          ? {
              select: {
                type: 'node',
                ...(rawInput.nodeType !== undefined ? { nodeType: rawInput.nodeType as NodeSelector['nodeType'] } : {}),
                ...(rawInput.kind !== undefined ? { kind: rawInput.kind as NodeSelector['kind'] } : {}),
              },
              ...(rawInput.within !== undefined ? { within: rawInput.within as QueryMatchInput['within'] } : {}),
              ...(rawInput.in !== undefined ? { in: rawInput.in as QueryMatchInput['in'] } : {}),
              ...(rawInput.require !== undefined ? { require: rawInput.require as QueryMatchInput['require'] } : {}),
              ...(rawInput.mode !== undefined ? { mode: rawInput.mode as QueryMatchInput['mode'] } : {}),
              ...(rawInput.includeNodes !== undefined ? { includeNodes: rawInput.includeNodes as boolean } : {}),
              ...(rawInput.limit !== undefined ? { limit: rawInput.limit as number } : {}),
              ...(rawInput.offset !== undefined ? { offset: rawInput.offset as number } : {}),
            }
          : { select: input };
  validateStoryLocator(normalized.in, 'in');
  return adapter.match(normalized);
}
function requireAdapter<T>(adapter: T | undefined, namespace: string): T {
  if (!adapter) {
    throw new DocumentApiValidationError(
      'CAPABILITY_UNAVAILABLE',
      `The '${namespace}' namespace is not available. The host engine has not provided an adapter for this capability.`,
    );
  }
  return adapter;
}
function unavailableTableMutationResult(operationName: string): TableMutationResult {
  return {
    success: false,
    failure: {
      code: 'CAPABILITY_UNAVAILABLE',
      message: `${operationName} is not available. The host engine has not provided an adapter for this capability.`,
      details: { operation: operationName },
    },
  };
}
function buildFormatInlineAliasApi(adapter: SelectionMutationAdapter): FormatInlineAliasApi {
  return Object.fromEntries(
    INLINE_PROPERTY_REGISTRY.map((entry) => {
      const key = entry.key as InlineRunPatchKey;
      const handler = (input: FormatInlineAliasInput<typeof key>, options?: MutationOptions) =>
        executeInlineAlias(adapter, key, input, options);
      return [key, handler];
    }),
  ) as FormatInlineAliasApi;
}
/** Namespace prefixes whose operations are gated on optional adapter presence. */
const ADAPTER_GATED_PREFIXES = [
  'bookmarks',
  'footnotes',
  'clipboard',
  'crossRefs',
  'index',
  'captions',
  'fields',
  'citations',
  'authorities',
  'export',
] as const;
export function createDocumentApi(adapters: DocumentApiAdapters): DocumentApi {
  const rawCapFn = () => executeCapabilities(adapters.capabilities);
  const capFn = (): DocumentApiCapabilities => {
    const caps = rawCapFn();
    // Gate operations on adapter presence: mark unavailable when namespace adapter is missing.
    for (const ns of ADAPTER_GATED_PREFIXES) {
      if (adapters[ns]) continue;
      const prefix = `${ns}.`;
      for (const opId of Object.keys(caps.operations)) {
        if (!opId.startsWith(prefix)) continue;
        const cap = caps.operations[opId as OperationId];
        cap.available = false;
        cap.tracked = false;
        cap.dryRun = false;
        cap.reasons = [...(cap.reasons ?? []), 'NAMESPACE_UNAVAILABLE'];
      }
    }
    return caps;
  };
  const capabilities: CapabilitiesApi = Object.assign(capFn, {
    get: capFn,
    check: (input: SDHtmlMarkdownSupportCheckInput) => executeCapabilitiesCheck(adapters.capabilities, input),
  });
  const inlineAliasApi = buildFormatInlineAliasApi(adapters.selectionMutation);
  const api: DocumentApi = {
    get(input: SDGetInput): SDDocument {
      return executeGet(adapters.get, input);
    },
    find(input: SDFindInput): SDFindResult {
      return executeFind(adapters.find, input);
    },
    getNode(address: NodeAddress): SDNodeResult {
      return executeGetNode(adapters.getNode, address);
    },
    getNodeById(input: GetNodeByIdInput): SDNodeResult {
      return executeGetNodeById(adapters.getNode, input);
    },
    getText(input: GetTextInput): string {
      return executeGetText(adapters.getText, input);
    },
    getMarkdown(input: GetMarkdownInput): string {
      return executeGetMarkdown(adapters.getMarkdown, input);
    },
    getHtml(input: GetHtmlInput): string {
      return executeGetHtml(adapters.getHtml, input);
    },
    projectHtml(input: ProjectHtmlInput): Promise<SDContentProjectionResult<'html'>> {
      return executeProjectHtml(adapters.projectHtml, input);
    },
    projectMarkdown(input: ProjectMarkdownInput): Promise<SDContentProjectionResult<'markdown'>> {
      return executeProjectMarkdown(adapters.projectMarkdown, input);
    },
    markdownToFragment(input: MarkdownToFragmentInput): SDMarkdownToFragmentResult {
      return executeMarkdownToFragment(adapters.markdownToFragment, input);
    },
    htmlToFragment(input: HtmlToFragmentInput): SDHtmlToFragmentResult {
      return executeHtmlToFragment(adapters.htmlToFragment, input);
    },
    info(input: InfoInput): DocumentInfo {
      return executeInfo(adapters.info, input);
    },
    extract(input: ExtractInput): ExtractResult {
      return executeExtract(adapters.extract, input);
    },
    clearContent(input: ClearContentInput, options?: RevisionGuardOptions): Receipt {
      return executeClearContent(adapters.clearContent, input, options);
    },
    comments: {
      create(input: CommentsCreateInput, options?: RevisionGuardOptions): CommentsCreateReceipt {
        return executeCommentsCreate(adapters.comments, input, options);
      },
      patch(input: CommentsPatchInput, options?: RevisionGuardOptions): Receipt {
        return executeCommentsPatch(adapters.comments, input, options);
      },
      delete(input: CommentsDeleteInput, options?: RevisionGuardOptions): Receipt {
        return executeCommentsDelete(adapters.comments, input, options);
      },
      get(input: GetCommentInput): CommentInfo {
        return executeGetComment(adapters.comments, input);
      },
      list(query?: CommentsListQuery): CommentsListResult {
        return executeListComments(adapters.comments, query);
      },
    },
    insert(input: InsertInput, options?: RichContentMutationOptions): SDMutationReceipt {
      return executeInsert(adapters.selectionMutation, adapters.write, input, options);
    },
    replace(input: ReplaceInput, options?: RichContentMutationOptions): SDMutationReceipt {
      return executeReplace(adapters.selectionMutation, adapters.write, input, options);
    },
    delete(input: DeleteInput, options?: MutationOptions): TextMutationReceipt {
      return executeDelete(adapters.selectionMutation, input, options);
    },
    formatRange(input: FormatRangeInput, options?: MutationOptions): TextMutationReceipt {
      const raw = input as unknown;
      if (!raw || typeof raw !== 'object') {
        return executeStyleApply(adapters.selectionMutation, raw as StyleApplyInput, options);
      }
      const { properties, changeMode, dryRun, expectedRevision, ...rest } = raw as FormatRangeInput;
      const styleInput: StyleApplyInput =
        typeof rest.ref === 'string'
          ? { ref: rest.ref, inline: properties, ...(rest.in ? { in: rest.in } : {}) }
          : { target: rest.target, inline: properties, ...(rest.in ? { in: rest.in } : {}) };
      return executeStyleApply(adapters.selectionMutation, styleInput, {
        expectedRevision: expectedRevision ?? options?.expectedRevision,
        changeMode: changeMode ?? options?.changeMode,
        dryRun: dryRun ?? options?.dryRun,
      });
    },
    format: {
      ...inlineAliasApi,
      strikethrough(input: FormatStrikethroughInput, options?: MutationOptions): TextMutationReceipt {
        return executeInlineAlias(adapters.selectionMutation, 'strike', input, options);
      },
      apply(input: StyleApplyInput, options?: MutationOptions): TextMutationReceipt {
        return executeStyleApply(adapters.selectionMutation, input, options);
      },
      paragraph: {
        resetDirectFormatting(
          input: ParagraphsResetDirectFormattingInput,
          options?: MutationOptions,
        ): ParagraphMutationResult {
          return executeParagraphsResetDirectFormatting(adapters.paragraphs, input, options);
        },
        setAlignment(input: ParagraphsSetAlignmentInput, options?: MutationOptions): ParagraphMutationResult {
          return executeParagraphsSetAlignment(adapters.paragraphs, input, options);
        },
        clearAlignment(input: ParagraphsClearAlignmentInput, options?: MutationOptions): ParagraphMutationResult {
          return executeParagraphsClearAlignment(adapters.paragraphs, input, options);
        },
        setIndentation(input: ParagraphsSetIndentationInput, options?: MutationOptions): ParagraphMutationResult {
          return executeParagraphsSetIndentation(adapters.paragraphs, input, options);
        },
        clearIndentation(input: ParagraphsClearIndentationInput, options?: MutationOptions): ParagraphMutationResult {
          return executeParagraphsClearIndentation(adapters.paragraphs, input, options);
        },
        setSpacing(input: ParagraphsSetSpacingInput, options?: MutationOptions): ParagraphMutationResult {
          return executeParagraphsSetSpacing(adapters.paragraphs, input, options);
        },
        clearSpacing(input: ParagraphsClearSpacingInput, options?: MutationOptions): ParagraphMutationResult {
          return executeParagraphsClearSpacing(adapters.paragraphs, input, options);
        },
        setKeepOptions(input: ParagraphsSetKeepOptionsInput, options?: MutationOptions): ParagraphMutationResult {
          return executeParagraphsSetKeepOptions(adapters.paragraphs, input, options);
        },
        setOutlineLevel(input: ParagraphsSetOutlineLevelInput, options?: MutationOptions): ParagraphMutationResult {
          return executeParagraphsSetOutlineLevel(adapters.paragraphs, input, options);
        },
        setFlowOptions(input: ParagraphsSetFlowOptionsInput, options?: MutationOptions): ParagraphMutationResult {
          return executeParagraphsSetFlowOptions(adapters.paragraphs, input, options);
        },
        setTabStop(input: ParagraphsSetTabStopInput, options?: MutationOptions): ParagraphMutationResult {
          return executeParagraphsSetTabStop(adapters.paragraphs, input, options);
        },
        clearTabStop(input: ParagraphsClearTabStopInput, options?: MutationOptions): ParagraphMutationResult {
          return executeParagraphsClearTabStop(adapters.paragraphs, input, options);
        },
        clearAllTabStops(input: ParagraphsClearAllTabStopsInput, options?: MutationOptions): ParagraphMutationResult {
          return executeParagraphsClearAllTabStops(adapters.paragraphs, input, options);
        },
        setBorder(input: ParagraphsSetBorderInput, options?: MutationOptions): ParagraphMutationResult {
          return executeParagraphsSetBorder(adapters.paragraphs, input, options);
        },
        clearBorder(input: ParagraphsClearBorderInput, options?: MutationOptions): ParagraphMutationResult {
          return executeParagraphsClearBorder(adapters.paragraphs, input, options);
        },
        setShading(input: ParagraphsSetShadingInput, options?: MutationOptions): ParagraphMutationResult {
          return executeParagraphsSetShading(adapters.paragraphs, input, options);
        },
        clearShading(input: ParagraphsClearShadingInput, options?: MutationOptions): ParagraphMutationResult {
          return executeParagraphsClearShading(adapters.paragraphs, input, options);
        },
        setMarkRunProps(input: ParagraphsSetMarkRunPropsInput, options?: MutationOptions): ParagraphMutationResult {
          return executeParagraphsSetMarkRunProps(adapters.paragraphs, input, options);
        },
        setDirection(input: ParagraphsSetDirectionInput, options?: MutationOptions): ParagraphMutationResult {
          return executeParagraphsSetDirection(adapters.paragraphs, input, options);
        },
        clearDirection(input: ParagraphsClearDirectionInput, options?: MutationOptions): ParagraphMutationResult {
          return executeParagraphsClearDirection(adapters.paragraphs, input, options);
        },
        setNumbering(input: ParagraphsSetNumberingInput, options?: MutationOptions): ParagraphMutationResult {
          return executeParagraphsSetNumbering(adapters.paragraphs, input, options);
        },
      },
    },
    styles: {
      apply(input: StylesApplyInput, options?: StylesApplyOptions): StylesApplyReceipt {
        return executeStylesApply(adapters.styles, input, options);
      },
      getCatalog(input?: StylesGetCatalogInput): StylesGetCatalogResult {
        return executeStylesGetCatalog(adapters.styles, input);
      },
      paragraph: {
        setStyle(input: ParagraphsSetStyleInput, options?: MutationOptions): ParagraphMutationResult {
          return executeParagraphsSetStyle(adapters.paragraphs, input, options);
        },
        setStyleRef(input: ParagraphsSetStyleRefInput, options?: MutationOptions): ParagraphMutationResult {
          return executeParagraphsSetStyleRef(adapters.paragraphs, input, options);
        },
        clearStyle(input: ParagraphsClearStyleInput, options?: MutationOptions): ParagraphMutationResult {
          return executeParagraphsClearStyle(adapters.paragraphs, input, options);
        },
      },
    },
    templates: {
      apply(input: TemplatesApplyInput, options?: TemplatesApplyOptions): Promise<TemplatesApplyReceipt> {
        return executeTemplatesApply(adapters.templates, input, options);
      },
    },
    trackChanges: {
      list(input?: TrackChangesListInput): TrackChangesListResult {
        return executeTrackChangesList(adapters.trackChanges, input);
      },
      get(input: TrackChangesGetInput): TrackChangeInfo {
        return executeTrackChangesGet(adapters.trackChanges, input);
      },
      decide(input: ReviewDecideInput, options?: RevisionGuardOptions): Receipt {
        return executeTrackChangesDecide(adapters.trackChanges, input, options);
      },
    },
    blocks: {
      findText(input: BlocksFindTextInput): BlocksFindTextResult {
        return executeBlocksFindText(adapters.blocks, input);
      },
      list(input?: BlocksListInput): BlocksListResult {
        return executeBlocksList(adapters.blocks, input);
      },
      delete(input: BlocksDeleteInput, options?: MutationOptions): BlocksDeleteResult {
        return executeBlocksDelete(adapters.blocks, input, options);
      },
      deleteRange(input: BlocksDeleteRangeInput, options?: MutationOptions): BlocksDeleteRangeResult {
        return executeBlocksDeleteRange(adapters.blocks, input, options);
      },
      split(input, options) {
        return executeBlocksSplit(adapters.blocks, input, options);
      },
      merge(input, options) {
        return executeBlocksMerge(adapters.blocks, input, options);
      },
      move(input, options) {
        return executeBlocksMove(adapters.blocks, input, options);
      },
    },
    create: {
      paragraph(input: CreateParagraphInput, options?: MutationOptions): CreateParagraphResult {
        return executeCreateParagraph(adapters.create, input, options);
      },
      heading(input: CreateHeadingInput, options?: MutationOptions): CreateHeadingResult {
        return executeCreateHeading(adapters.create, input, options);
      },
      table(input: CreateTableInput, options?: MutationOptions): CreateTableResult {
        return executeCreateTable(adapters.create, input, options);
      },
      sectionBreak(input: CreateSectionBreakInput, options?: MutationOptions): CreateSectionBreakResult {
        return executeCreateSectionBreak(adapters.create, input, options);
      },
      tableOfContents(input: CreateTableOfContentsInput, options?: MutationOptions): CreateTableOfContentsResult {
        return executeCreateTableOfContents(adapters.create, input, options);
      },
      image(input: CreateImageInput, options?: MutationOptions): CreateImageResult {
        return executeCreateImage(adapters.images, input, options);
      },
      contentControl(input: CreateContentControlInput, options?: MutationOptions): ContentControlMutationResult {
        return executeCreateContentControl(adapters.contentControls, input, options);
      },
    },
    capabilities,
    images: {
      list(input?: ImagesListInput): ImagesListResult {
        return executeImagesList(adapters.images, input);
      },
      get(input: ImagesGetInput): ImageSummary {
        return executeImagesGet(adapters.images, input);
      },
      delete(input: ImagesDeleteInput, options?: MutationOptions): ImagesMutationResult {
        return executeImagesDelete(adapters.images, input, options);
      },
      move(input: MoveImageInput, options?: MutationOptions): ImagesMutationResult {
        return executeImagesMove(adapters.images, input, options);
      },
      convertToInline(input: ConvertToInlineInput, options?: MutationOptions): ImagesMutationResult {
        return executeImagesConvertToInline(adapters.images, input, options);
      },
      convertToFloating(input: ConvertToFloatingInput, options?: MutationOptions): ImagesMutationResult {
        return executeImagesConvertToFloating(adapters.images, input, options);
      },
      setSize(input: SetSizeInput, options?: MutationOptions): ImagesMutationResult {
        return executeImagesSetSize(adapters.images, input, options);
      },
      setWrapType(input: SetWrapTypeInput, options?: MutationOptions): ImagesMutationResult {
        return executeImagesSetWrapType(adapters.images, input, options);
      },
      setWrapSide(input: SetWrapSideInput, options?: MutationOptions): ImagesMutationResult {
        return executeImagesSetWrapSide(adapters.images, input, options);
      },
      setWrapDistances(input: SetWrapDistancesInput, options?: MutationOptions): ImagesMutationResult {
        return executeImagesSetWrapDistances(adapters.images, input, options);
      },
      setPosition(input: SetPositionInput, options?: MutationOptions): ImagesMutationResult {
        return executeImagesSetPosition(adapters.images, input, options);
      },
      setAnchorOptions(input: SetAnchorOptionsInput, options?: MutationOptions): ImagesMutationResult {
        return executeImagesSetAnchorOptions(adapters.images, input, options);
      },
      setZOrder(input: SetZOrderInput, options?: MutationOptions): ImagesMutationResult {
        return executeImagesSetZOrder(adapters.images, input, options);
      },
      // SD-2100: Geometry
      scale(input: ScaleInput, options?: MutationOptions): ImagesMutationResult {
        return executeImagesScale(adapters.images, input, options);
      },
      setLockAspectRatio(input: SetLockAspectRatioInput, options?: MutationOptions): ImagesMutationResult {
        return executeImagesSetLockAspectRatio(adapters.images, input, options);
      },
      rotate(input: RotateInput, options?: MutationOptions): ImagesMutationResult {
        return executeImagesRotate(adapters.images, input, options);
      },
      flip(input: FlipInput, options?: MutationOptions): ImagesMutationResult {
        return executeImagesFlip(adapters.images, input, options);
      },
      crop(input: CropInput, options?: MutationOptions): ImagesMutationResult {
        return executeImagesCrop(adapters.images, input, options);
      },
      resetCrop(input: ResetCropInput, options?: MutationOptions): ImagesMutationResult {
        return executeImagesResetCrop(adapters.images, input, options);
      },
      // SD-2100: Content
      replaceSource(input: ReplaceSourceInput, options?: MutationOptions): ImagesMutationResult {
        return executeImagesReplaceSource(adapters.images, input, options);
      },
      // SD-2100: Semantic metadata
      setAltText(input: SetAltTextInput, options?: MutationOptions): ImagesMutationResult {
        return executeImagesSetAltText(adapters.images, input, options);
      },
      setDecorative(input: SetDecorativeInput, options?: MutationOptions): ImagesMutationResult {
        return executeImagesSetDecorative(adapters.images, input, options);
      },
      setName(input: SetNameInput, options?: MutationOptions): ImagesMutationResult {
        return executeImagesSetName(adapters.images, input, options);
      },
      setHyperlink(input: SetHyperlinkInput, options?: MutationOptions): ImagesMutationResult {
        return executeImagesSetHyperlink(adapters.images, input, options);
      },
      // SD-2100: Caption lifecycle
      insertCaption(input: InsertCaptionInput, options?: MutationOptions): ImagesMutationResult {
        return executeImagesInsertCaption(adapters.images, input, options);
      },
      updateCaption(input: UpdateCaptionInput, options?: MutationOptions): ImagesMutationResult {
        return executeImagesUpdateCaption(adapters.images, input, options);
      },
      removeCaption(input: RemoveCaptionInput, options?: MutationOptions): ImagesMutationResult {
        return executeImagesRemoveCaption(adapters.images, input, options);
      },
    },
    lists: {
      list(query?: ListsListQuery): ListsListResult {
        return executeListsList(adapters.lists, query);
      },
      get(input: ListsGetInput): ListItemInfo {
        return executeListsGet(adapters.lists, input);
      },
      insert(input: ListInsertInput, options?: MutationOptions): ListsInsertResult {
        return executeListsInsert(adapters.lists, input, options);
      },
      create(input: ListsCreateInput, options?: MutationOptions): ListsCreateResult {
        return executeListsCreate(adapters.lists, input, options);
      },
      attach(input: ListsAttachInput, options?: MutationOptions): ListsMutateItemResult {
        return executeListsAttach(adapters.lists, input, options);
      },
      detach(input: ListsDetachInput, options?: MutationOptions): ListsDetachResult {
        return executeListsDetach(adapters.lists, input, options);
      },
      delete(input: ListsDeleteInput, options?: MutationOptions): ListsDeleteResult {
        return executeListsDelete(adapters.lists, input, options);
      },
      indent(input: ListTargetInput, options?: MutationOptions): ListsMutateItemResult {
        return executeListsIndent(adapters.lists, input, options);
      },
      outdent(input: ListTargetInput, options?: MutationOptions): ListsMutateItemResult {
        return executeListsOutdent(adapters.lists, input, options);
      },
      join(input: ListsJoinInput, options?: MutationOptions): ListsJoinResult {
        return executeListsJoin(adapters.lists, input, options);
      },
      canJoin(input: ListsCanJoinInput): ListsCanJoinResult {
        return executeListsCanJoin(adapters.lists, input);
      },
      separate(input: ListsSeparateInput, options?: MutationOptions): ListsSeparateResult {
        return executeListsSeparate(adapters.lists, input, options);
      },
      merge(input: ListsMergeInput, options?: MutationOptions): ListsMergeResult {
        return executeListsMerge(adapters.lists, input, options);
      },
      split(input: ListsSplitInput, options?: MutationOptions): ListsSplitResult {
        return executeListsSplit(adapters.lists, input, options);
      },
      setLevel(input: ListsSetLevelInput, options?: MutationOptions): ListsMutateItemResult {
        return executeListsSetLevel(adapters.lists, input, options);
      },
      setValue(input: ListsSetValueInput, options?: MutationOptions): ListsMutateItemResult {
        return executeListsSetValue(adapters.lists, input, options);
      },
      continuePrevious(input: ListsContinuePreviousInput, options?: MutationOptions): ListsMutateItemResult {
        return executeListsContinuePrevious(adapters.lists, input, options);
      },
      canContinuePrevious(input: ListsCanContinuePreviousInput): ListsCanContinuePreviousResult {
        return executeListsCanContinuePrevious(adapters.lists, input);
      },
      setLevelRestart(input: ListsSetLevelRestartInput, options?: MutationOptions): ListsMutateItemResult {
        return executeListsSetLevelRestart(adapters.lists, input, options);
      },
      convertToText(input: ListsConvertToTextInput, options?: MutationOptions): ListsConvertToTextResult {
        return executeListsConvertToText(adapters.lists, input, options);
      },
      // SD-1973 formatting operations
      applyTemplate(input: ListsApplyTemplateInput, options?: MutationOptions): ListsMutateItemResult {
        return executeListsApplyTemplate(adapters.lists, input, options);
      },
      applyPreset(input: ListsApplyPresetInput, options?: MutationOptions): ListsMutateItemResult {
        return executeListsApplyPreset(adapters.lists, input, options);
      },
      captureTemplate(input: ListsCaptureTemplateInput): ListsCaptureTemplateResult {
        return executeListsCaptureTemplate(adapters.lists, input);
      },
      setLevelNumbering(input: ListsSetLevelNumberingInput, options?: MutationOptions): ListsMutateItemResult {
        return executeListsSetLevelNumbering(adapters.lists, input, options);
      },
      setLevelBullet(input: ListsSetLevelBulletInput, options?: MutationOptions): ListsMutateItemResult {
        return executeListsSetLevelBullet(adapters.lists, input, options);
      },
      setLevelPictureBullet(input: ListsSetLevelPictureBulletInput, options?: MutationOptions): ListsMutateItemResult {
        return executeListsSetLevelPictureBullet(adapters.lists, input, options);
      },
      setLevelAlignment(input: ListsSetLevelAlignmentInput, options?: MutationOptions): ListsMutateItemResult {
        return executeListsSetLevelAlignment(adapters.lists, input, options);
      },
      setLevelIndents(input: ListsSetLevelIndentsInput, options?: MutationOptions): ListsMutateItemResult {
        return executeListsSetLevelIndents(adapters.lists, input, options);
      },
      setLevelTrailingCharacter(
        input: ListsSetLevelTrailingCharacterInput,
        options?: MutationOptions,
      ): ListsMutateItemResult {
        return executeListsSetLevelTrailingCharacter(adapters.lists, input, options);
      },
      setLevelMarkerFont(input: ListsSetLevelMarkerFontInput, options?: MutationOptions): ListsMutateItemResult {
        return executeListsSetLevelMarkerFont(adapters.lists, input, options);
      },
      clearLevelOverrides(input: ListsClearLevelOverridesInput, options?: MutationOptions): ListsMutateItemResult {
        return executeListsClearLevelOverrides(adapters.lists, input, options);
      },
      setType(input: ListsSetTypeInput, options?: MutationOptions): ListsMutateItemResult {
        return executeListsSetType(adapters.lists, input, options);
      },
      // SD-2025 user-facing operations
      getStyle(input: ListsGetStyleInput): ListsGetStyleResult {
        return executeListsGetStyle(adapters.lists, input);
      },
      applyStyle(input: ListsApplyStyleInput, options?: MutationOptions): ListsMutateItemResult {
        return executeListsApplyStyle(adapters.lists, input, options);
      },
      restartAt(input: ListsRestartAtInput, options?: MutationOptions): ListsMutateItemResult {
        return executeListsRestartAt(adapters.lists, input, options);
      },
      setLevelNumberStyle(input: ListsSetLevelNumberStyleInput, options?: MutationOptions): ListsMutateItemResult {
        return executeListsSetLevelNumberStyle(adapters.lists, input, options);
      },
      setLevelText(input: ListsSetLevelTextInput, options?: MutationOptions): ListsMutateItemResult {
        return executeListsSetLevelText(adapters.lists, input, options);
      },
      setLevelStart(input: ListsSetLevelStartInput, options?: MutationOptions): ListsMutateItemResult {
        return executeListsSetLevelStart(adapters.lists, input, options);
      },
      setLevelLayout(input: ListsSetLevelLayoutInput, options?: MutationOptions): ListsMutateItemResult {
        return executeListsSetLevelLayout(adapters.lists, input, options);
      },
      // v2 numbering-aware list operations.
      getState(input: ListsGetStateInput): ListsGetStateResult {
        return executeListsGetState(adapters.lists, input);
      },
      apply(input: ListsApplyInput, options?: MutationOptions): ListsMutateItemResult {
        return executeListsApply(adapters.lists, input, options);
      },
      continue(input: ListsContinueV2Input, options?: MutationOptions): ListsMutateItemResult {
        return executeListsContinueV2(adapters.lists, input, options);
      },
      restart(input: ListsRestartV2Input, options?: MutationOptions): ListsMutateItemResult {
        return executeListsRestartV2(adapters.lists, input, options);
      },
      remove(input: ListsRemoveV2Input, options?: MutationOptions): ListsMutateItemResult {
        return executeListsRemoveV2(adapters.lists, input, options);
      },
    },
    sections: {
      list(query?: SectionsListQuery): SectionsListResult {
        return executeSectionsList(adapters.sections, query);
      },
      get(input: SectionsGetInput): SectionInfo {
        return executeSectionsGet(adapters.sections, input);
      },
      setBreakType(input: SectionsSetBreakTypeInput, options?: MutationOptions): SectionMutationResult {
        return executeSectionsSetBreakType(adapters.sections, input, options);
      },
      setPageMargins(input: SectionsSetPageMarginsInput, options?: MutationOptions): SectionMutationResult {
        return executeSectionsSetPageMargins(adapters.sections, input, options);
      },
      setHeaderFooterMargins(
        input: SectionsSetHeaderFooterMarginsInput,
        options?: MutationOptions,
      ): SectionMutationResult {
        return executeSectionsSetHeaderFooterMargins(adapters.sections, input, options);
      },
      setPageSetup(input: SectionsSetPageSetupInput, options?: MutationOptions): SectionMutationResult {
        return executeSectionsSetPageSetup(adapters.sections, input, options);
      },
      setColumns(input: SectionsSetColumnsInput, options?: MutationOptions): SectionMutationResult {
        return executeSectionsSetColumns(adapters.sections, input, options);
      },
      setLineNumbering(input: SectionsSetLineNumberingInput, options?: MutationOptions): SectionMutationResult {
        return executeSectionsSetLineNumbering(adapters.sections, input, options);
      },
      setPageNumbering(input: SectionsSetPageNumberingInput, options?: MutationOptions): SectionMutationResult {
        return executeSectionsSetPageNumbering(adapters.sections, input, options);
      },
      setTitlePage(input: SectionsSetTitlePageInput, options?: MutationOptions): SectionMutationResult {
        return executeSectionsSetTitlePage(adapters.sections, input, options);
      },
      setOddEvenHeadersFooters(
        input: SectionsSetOddEvenHeadersFootersInput,
        options?: MutationOptions,
      ): DocumentMutationResult {
        return executeSectionsSetOddEvenHeadersFooters(adapters.sections, input, options);
      },
      setVerticalAlign(input: SectionsSetVerticalAlignInput, options?: MutationOptions): SectionMutationResult {
        return executeSectionsSetVerticalAlign(adapters.sections, input, options);
      },
      setSectionDirection(input: SectionsSetSectionDirectionInput, options?: MutationOptions): SectionMutationResult {
        return executeSectionsSetSectionDirection(adapters.sections, input, options);
      },
      setHeaderFooterRef(input: SectionsSetHeaderFooterRefInput, options?: MutationOptions): SectionMutationResult {
        return executeSectionsSetHeaderFooterRef(adapters.sections, input, options);
      },
      clearHeaderFooterRef(input: SectionsClearHeaderFooterRefInput, options?: MutationOptions): SectionMutationResult {
        return executeSectionsClearHeaderFooterRef(adapters.sections, input, options);
      },
      setLinkToPrevious(input: SectionsSetLinkToPreviousInput, options?: MutationOptions): SectionMutationResult {
        return executeSectionsSetLinkToPrevious(adapters.sections, input, options);
      },
      setPageBorders(input: SectionsSetPageBordersInput, options?: MutationOptions): SectionMutationResult {
        return executeSectionsSetPageBorders(adapters.sections, input, options);
      },
      clearPageBorders(input: SectionsClearPageBordersInput, options?: MutationOptions): SectionMutationResult {
        return executeSectionsClearPageBorders(adapters.sections, input, options);
      },
    },
    tables: {
      convertFromText(input, options?) {
        return executeTableLocatorOp(
          'tables.convertFromText',
          adapters.tables.convertFromText.bind(adapters.tables),
          input,
          options,
        );
      },
      delete(input, options?) {
        return executeTableLocatorOp('tables.delete', adapters.tables.delete.bind(adapters.tables), input, options);
      },
      clearContents(input, options?) {
        return executeTableLocatorOp(
          'tables.clearContents',
          adapters.tables.clearContents.bind(adapters.tables),
          input,
          options,
        );
      },
      move(input, options?) {
        return executeTableLocatorOp('tables.move', adapters.tables.move.bind(adapters.tables), input, options);
      },
      split(input, options?) {
        const normalized = normalizeTablesSplitInput(input);
        return executeRowLocatorOp('tables.split', adapters.tables.split.bind(adapters.tables), normalized, options);
      },
      convertToText(input, options?) {
        return executeTableLocatorOp(
          'tables.convertToText',
          adapters.tables.convertToText.bind(adapters.tables),
          input,
          options,
        );
      },
      setLayout(input, options?) {
        return executeTablesSetLayoutOp(adapters.tables.setLayout.bind(adapters.tables), input, options);
      },
      insertRow(input, options?) {
        return executeRowLocatorOp(
          'tables.insertRow',
          adapters.tables.insertRow.bind(adapters.tables),
          input,
          options,
          { allowAppendShorthand: true },
        );
      },
      deleteRow(input, options?) {
        return executeRowLocatorOp('tables.deleteRow', adapters.tables.deleteRow.bind(adapters.tables), input, options);
      },
      moveRow(input, options?) {
        const moveRowAdapter =
          adapters.tables.moveRow?.bind(adapters.tables) ?? (() => unavailableTableMutationResult('tables.moveRow'));
        return executeRowLocatorOp('tables.moveRow', moveRowAdapter, input, options);
      },
      setRowHeight(input, options?) {
        return executeRowLocatorOp(
          'tables.setRowHeight',
          adapters.tables.setRowHeight.bind(adapters.tables),
          input,
          options,
        );
      },
      distributeRows(input, options?) {
        return executeTableLocatorOp(
          'tables.distributeRows',
          adapters.tables.distributeRows.bind(adapters.tables),
          input,
          options,
        );
      },
      setRowOptions(input, options?) {
        return executeRowLocatorOp(
          'tables.setRowOptions',
          adapters.tables.setRowOptions.bind(adapters.tables),
          input,
          options,
        );
      },
      insertColumn(input, options?) {
        return executeTableLocatorOp(
          'tables.insertColumn',
          adapters.tables.insertColumn.bind(adapters.tables),
          input,
          options,
        );
      },
      deleteColumn(input, options?) {
        return executeTableLocatorOp(
          'tables.deleteColumn',
          adapters.tables.deleteColumn.bind(adapters.tables),
          input,
          options,
        );
      },
      moveColumn(input, options?) {
        const moveColumnAdapter =
          adapters.tables.moveColumn?.bind(adapters.tables) ??
          (() => unavailableTableMutationResult('tables.moveColumn'));
        return executeTableLocatorOp('tables.moveColumn', moveColumnAdapter, input, options);
      },
      setColumnWidth(input, options?) {
        return executeTableLocatorOp(
          'tables.setColumnWidth',
          adapters.tables.setColumnWidth.bind(adapters.tables),
          input,
          options,
        );
      },
      distributeColumns(input, options?) {
        return executeTableLocatorOp(
          'tables.distributeColumns',
          adapters.tables.distributeColumns.bind(adapters.tables),
          input,
          options,
        );
      },
      insertCell(input, options?) {
        return executeTableLocatorOp(
          'tables.insertCell',
          adapters.tables.insertCell.bind(adapters.tables),
          input,
          options,
        );
      },
      deleteCell(input, options?) {
        return executeTableLocatorOp(
          'tables.deleteCell',
          adapters.tables.deleteCell.bind(adapters.tables),
          input,
          options,
        );
      },
      mergeCells(input, options?) {
        return executeTableLocatorOp(
          'tables.mergeCells',
          adapters.tables.mergeCells.bind(adapters.tables),
          input,
          options,
        );
      },
      unmergeCells(input, options?) {
        return executeCellOrTableScopedCellLocatorOp(
          'tables.unmergeCells',
          adapters.tables.unmergeCells.bind(adapters.tables),
          input,
          options,
        );
      },
      splitCell(input, options?) {
        return executeTableLocatorOp(
          'tables.splitCell',
          adapters.tables.splitCell.bind(adapters.tables),
          input,
          options,
        );
      },
      setCellProperties(input, options?) {
        return executeTableLocatorOp(
          'tables.setCellProperties',
          adapters.tables.setCellProperties.bind(adapters.tables),
          input,
          options,
        );
      },
      setCellText(input, options?) {
        return executeCellOrTableScopedCellLocatorOp(
          'tables.setCellText',
          adapters.tables.setCellText.bind(adapters.tables),
          input,
          options,
        );
      },
      sort(input, options?) {
        return executeTableLocatorOp('tables.sort', adapters.tables.sort.bind(adapters.tables), input, options);
      },
      setAltText(input, options?) {
        return executeTableLocatorOp(
          'tables.setAltText',
          adapters.tables.setAltText.bind(adapters.tables),
          input,
          options,
        );
      },
      setStyle(input, options?) {
        return executeTableLocatorOp('tables.setStyle', adapters.tables.setStyle.bind(adapters.tables), input, options);
      },
      clearStyle(input, options?) {
        return executeTableLocatorOp(
          'tables.clearStyle',
          adapters.tables.clearStyle.bind(adapters.tables),
          input,
          options,
        );
      },
      setStyleOption(input, options?) {
        return executeTableLocatorOp(
          'tables.setStyleOption',
          adapters.tables.setStyleOption.bind(adapters.tables),
          input,
          options,
        );
      },
      setBorder(input, options?) {
        return executeTableLocatorOp(
          'tables.setBorder',
          adapters.tables.setBorder.bind(adapters.tables),
          input,
          options,
        );
      },
      clearBorder(input, options?) {
        return executeTableLocatorOp(
          'tables.clearBorder',
          adapters.tables.clearBorder.bind(adapters.tables),
          input,
          options,
        );
      },
      applyBorderPreset(input, options?) {
        return executeTableLocatorOp(
          'tables.applyBorderPreset',
          adapters.tables.applyBorderPreset.bind(adapters.tables),
          input,
          options,
        );
      },
      setShading(input, options?) {
        return executeTableLocatorOp(
          'tables.setShading',
          adapters.tables.setShading.bind(adapters.tables),
          input,
          options,
        );
      },
      clearShading(input, options?) {
        return executeTableLocatorOp(
          'tables.clearShading',
          adapters.tables.clearShading.bind(adapters.tables),
          input,
          options,
        );
      },
      setTablePadding(input, options?) {
        return executeTableLocatorOp(
          'tables.setTablePadding',
          adapters.tables.setTablePadding.bind(adapters.tables),
          input,
          options,
        );
      },
      setCellPadding(input, options?) {
        return executeTablesSetCellPadding(
          'tables.setCellPadding',
          adapters.tables.setCellPadding.bind(adapters.tables),
          input,
          options,
        );
      },
      setCellSpacing(input, options?) {
        return executeTableLocatorOp(
          'tables.setCellSpacing',
          adapters.tables.setCellSpacing.bind(adapters.tables),
          input,
          options,
        );
      },
      clearCellSpacing(input, options?) {
        return executeTableLocatorOp(
          'tables.clearCellSpacing',
          adapters.tables.clearCellSpacing.bind(adapters.tables),
          input,
          options,
        );
      },
      applyStyle(input, options?) {
        return executeTablesApplyStyle(
          'tables.applyStyle',
          adapters.tables.applyStyle.bind(adapters.tables),
          input,
          options,
        );
      },
      setBorders(input, options?) {
        return executeTablesSetBorders(
          'tables.setBorders',
          adapters.tables.setBorders.bind(adapters.tables),
          input,
          options,
        );
      },
      setTableOptions(input, options?) {
        return executeTablesSetTableOptions(
          'tables.setTableOptions',
          adapters.tables.setTableOptions.bind(adapters.tables),
          input,
          options,
        );
      },
      applyPreset(input, options?) {
        return executeTableLocatorOp(
          'tables.applyPreset',
          adapters.tables.applyPreset.bind(adapters.tables),
          input,
          options,
        );
      },
      get(input) {
        return adapters.tables.get(input);
      },
      getCells(input) {
        return adapters.tables.getCells(input);
      },
      getProperties(input) {
        return adapters.tables.getProperties(input);
      },
      getStyles(input?) {
        return adapters.tables.getStyles(input);
      },
      setDefaultStyle(input: TablesSetDefaultStyleInput, options?: MutationOptions) {
        return executeDocumentLevelTableOp(adapters.tables.setDefaultStyle.bind(adapters.tables), input, options);
      },
      clearDefaultStyle(input?: TablesClearDefaultStyleInput, options?: MutationOptions) {
        return executeDocumentLevelTableOp(adapters.tables.clearDefaultStyle.bind(adapters.tables), input, options);
      },
    },
    toc: {
      list(query?: TocListQuery): TocListResult {
        return executeTocList(adapters.toc, query);
      },
      get(input: TocGetInput): TocInfo {
        return executeTocGet(adapters.toc, input);
      },
      configure(input: TocConfigureInput, options?: MutationOptions): TocMutationResult {
        return executeTocConfigure(adapters.toc, input, options);
      },
      update(input: TocUpdateInput, options?: MutationOptions): TocMutationResult {
        return executeTocUpdate(adapters.toc, input, options);
      },
      remove(input: TocRemoveInput, options?: MutationOptions): TocMutationResult {
        return executeTocRemove(adapters.toc, input, options);
      },
      markEntry(input: TocMarkEntryInput, options?: MutationOptions): TocEntryMutationResult {
        return executeTocMarkEntry(adapters.toc, input, options);
      },
      unmarkEntry(input: TocUnmarkEntryInput, options?: MutationOptions): TocEntryMutationResult {
        return executeTocUnmarkEntry(adapters.toc, input, options);
      },
      listEntries(query?: TocListEntriesQuery): TocListEntriesResult {
        return executeTocListEntries(adapters.toc, query);
      },
      getEntry(input: TocGetEntryInput): TocEntryInfo {
        return executeTocGetEntry(adapters.toc, input);
      },
      editEntry(input: TocEditEntryInput, options?: MutationOptions): TocEntryMutationResult {
        return executeTocEditEntry(adapters.toc, input, options);
      },
    },
    hyperlinks: {
      list(query?: HyperlinksListQuery): HyperlinksListResult {
        return executeHyperlinksList(adapters.hyperlinks, query);
      },
      get(input: HyperlinksGetInput): HyperlinkInfo {
        return executeHyperlinksGet(adapters.hyperlinks, input);
      },
      wrap(input: HyperlinksWrapInput, options?: MutationOptions): HyperlinkMutationResult {
        return executeHyperlinksWrap(adapters.hyperlinks, input, options);
      },
      insert(input: HyperlinksInsertInput, options?: MutationOptions): HyperlinkMutationResult {
        return executeHyperlinksInsert(adapters.hyperlinks, input, options);
      },
      patch(input: HyperlinksPatchInput, options?: MutationOptions): HyperlinkMutationResult {
        return executeHyperlinksPatch(adapters.hyperlinks, input, options);
      },
      remove(input: HyperlinksRemoveInput, options?: MutationOptions): HyperlinkMutationResult {
        return executeHyperlinksRemove(adapters.hyperlinks, input, options);
      },
    },
    headerFooters: {
      list(query?: HeaderFootersListQuery): HeaderFootersListResult {
        return executeHeaderFootersList(adapters.headerFooters, query);
      },
      get(input: HeaderFootersGetInput): HeaderFooterSlotEntry {
        return executeHeaderFootersGet(adapters.headerFooters, input);
      },
      resolve(input: HeaderFootersResolveInput): HeaderFooterResolveResult {
        return executeHeaderFootersResolve(adapters.headerFooters, input);
      },
      refs: {
        set(input: HeaderFootersRefsSetInput, options?: MutationOptions): SectionMutationResult {
          return executeHeaderFootersRefsSet(adapters.headerFooters, input, options);
        },
        clear(input: HeaderFootersRefsClearInput, options?: MutationOptions): SectionMutationResult {
          return executeHeaderFootersRefsClear(adapters.headerFooters, input, options);
        },
        setLinkedToPrevious(
          input: HeaderFootersRefsSetLinkedToPreviousInput,
          options?: MutationOptions,
        ): SectionMutationResult {
          return executeHeaderFootersRefsSetLinkedToPrevious(adapters.headerFooters, input, options);
        },
      },
      parts: {
        list(query?: HeaderFootersPartsListQuery): HeaderFootersPartsListResult {
          return executeHeaderFootersPartsList(adapters.headerFooters, query);
        },
        create(input: HeaderFootersPartsCreateInput, options?: MutationOptions): HeaderFooterPartsMutationResult {
          return executeHeaderFootersPartsCreate(adapters.headerFooters, input, options);
        },
        delete(input: HeaderFootersPartsDeleteInput, options?: MutationOptions): HeaderFooterPartsMutationResult {
          return executeHeaderFootersPartsDelete(adapters.headerFooters, input, options);
        },
      },
    },
    contentControls: {
      list(query) {
        return executeContentControlsList(adapters.contentControls, query);
      },
      get(input) {
        return executeContentControlsGet(adapters.contentControls, input);
      },
      listInRange(input) {
        return executeContentControlsListInRange(adapters.contentControls, input);
      },
      selectByTag(input) {
        return executeContentControlsSelectByTag(adapters.contentControls, input);
      },
      selectByTitle(input) {
        return executeContentControlsSelectByTitle(adapters.contentControls, input);
      },
      listChildren(input) {
        return executeContentControlsListChildren(adapters.contentControls, input);
      },
      getParent(input) {
        return executeContentControlsGetParent(adapters.contentControls, input);
      },
      wrap(input, options) {
        return executeContentControlsWrap(adapters.contentControls, input, options);
      },
      unwrap(input, options) {
        return executeContentControlsUnwrap(adapters.contentControls, input, options);
      },
      delete(input, options) {
        return executeContentControlsDelete(adapters.contentControls, input, options);
      },
      copy(input, options) {
        return executeContentControlsCopy(adapters.contentControls, input, options);
      },
      move(input, options) {
        return executeContentControlsMove(adapters.contentControls, input, options);
      },
      patch(input, options) {
        return executeContentControlsPatch(adapters.contentControls, input, options);
      },
      setLockMode(input, options) {
        return executeContentControlsSetLockMode(adapters.contentControls, input, options);
      },
      setType(input, options) {
        return executeContentControlsSetType(adapters.contentControls, input, options);
      },
      getContent(input) {
        return executeContentControlsGetContent(adapters.contentControls, input);
      },
      replaceContent(input, options) {
        return executeContentControlsReplaceContent(adapters.contentControls, input, options);
      },
      clearContent(input, options) {
        return executeContentControlsClearContent(adapters.contentControls, input, options);
      },
      appendContent(input, options) {
        return executeContentControlsAppendContent(adapters.contentControls, input, options);
      },
      prependContent(input, options) {
        return executeContentControlsPrependContent(adapters.contentControls, input, options);
      },
      insertBefore(input, options) {
        return executeContentControlsInsertBefore(adapters.contentControls, input, options);
      },
      insertAfter(input, options) {
        return executeContentControlsInsertAfter(adapters.contentControls, input, options);
      },
      getBinding(input) {
        return executeContentControlsGetBinding(adapters.contentControls, input);
      },
      setBinding(input, options) {
        return executeContentControlsSetBinding(adapters.contentControls, input, options);
      },
      clearBinding(input, options) {
        return executeContentControlsClearBinding(adapters.contentControls, input, options);
      },
      getRawProperties(input) {
        return executeContentControlsGetRawProperties(adapters.contentControls, input);
      },
      patchRawProperties(input, options) {
        return executeContentControlsPatchRawProperties(adapters.contentControls, input, options);
      },
      validateWordCompatibility(input) {
        return executeContentControlsValidateWordCompatibility(adapters.contentControls, input);
      },
      normalizeWordCompatibility(input, options) {
        return executeContentControlsNormalizeWordCompatibility(adapters.contentControls, input, options);
      },
      normalizeTagPayload(input, options) {
        return executeContentControlsNormalizeTagPayload(adapters.contentControls, input, options);
      },
      text: {
        setMultiline(input, options) {
          return executeContentControlsTextSetMultiline(adapters.contentControls, input, options);
        },
        setValue(input, options) {
          return executeContentControlsTextSetValue(adapters.contentControls, input, options);
        },
        clearValue(input, options) {
          return executeContentControlsTextClearValue(adapters.contentControls, input, options);
        },
      },
      date: {
        setValue(input, options) {
          return executeContentControlsDateSetValue(adapters.contentControls, input, options);
        },
        clearValue(input, options) {
          return executeContentControlsDateClearValue(adapters.contentControls, input, options);
        },
        setDisplayFormat(input, options) {
          return executeContentControlsDateSetDisplayFormat(adapters.contentControls, input, options);
        },
        setDisplayLocale(input, options) {
          return executeContentControlsDateSetDisplayLocale(adapters.contentControls, input, options);
        },
        setStorageFormat(input, options) {
          return executeContentControlsDateSetStorageFormat(adapters.contentControls, input, options);
        },
        setCalendar(input, options) {
          return executeContentControlsDateSetCalendar(adapters.contentControls, input, options);
        },
      },
      checkbox: {
        getState(input) {
          return executeContentControlsCheckboxGetState(adapters.contentControls, input);
        },
        setState(input, options) {
          return executeContentControlsCheckboxSetState(adapters.contentControls, input, options);
        },
        toggle(input, options) {
          return executeContentControlsCheckboxToggle(adapters.contentControls, input, options);
        },
        setSymbolPair(input, options) {
          return executeContentControlsCheckboxSetSymbolPair(adapters.contentControls, input, options);
        },
      },
      choiceList: {
        getItems(input) {
          return executeContentControlsChoiceListGetItems(adapters.contentControls, input);
        },
        setItems(input, options) {
          return executeContentControlsChoiceListSetItems(adapters.contentControls, input, options);
        },
        setSelected(input, options) {
          return executeContentControlsChoiceListSetSelected(adapters.contentControls, input, options);
        },
      },
      repeatingSection: {
        listItems(input) {
          return executeContentControlsRepeatingSectionListItems(adapters.contentControls, input);
        },
        insertItemBefore(input, options) {
          return executeContentControlsRepeatingSectionInsertItemBefore(adapters.contentControls, input, options);
        },
        insertItemAfter(input, options) {
          return executeContentControlsRepeatingSectionInsertItemAfter(adapters.contentControls, input, options);
        },
        cloneItem(input, options) {
          return executeContentControlsRepeatingSectionCloneItem(adapters.contentControls, input, options);
        },
        deleteItem(input, options) {
          return executeContentControlsRepeatingSectionDeleteItem(adapters.contentControls, input, options);
        },
        setAllowInsertDelete(input, options) {
          return executeContentControlsRepeatingSectionSetAllowInsertDelete(adapters.contentControls, input, options);
        },
      },
      group: {
        wrap(input, options) {
          return executeContentControlsGroupWrap(adapters.contentControls, input, options);
        },
        ungroup(input, options) {
          return executeContentControlsGroupUngroup(adapters.contentControls, input, options);
        },
      },
    },
    bookmarks: {
      list(query?: BookmarkListInput): BookmarksListResult {
        return executeBookmarksList(requireAdapter(adapters.bookmarks, 'bookmarks'), query);
      },
      get(input: BookmarkGetInput): BookmarkInfo {
        return executeBookmarksGet(requireAdapter(adapters.bookmarks, 'bookmarks'), input);
      },
      insert(input: BookmarkInsertInput, options?: MutationOptions): BookmarkMutationResult {
        return executeBookmarksInsert(requireAdapter(adapters.bookmarks, 'bookmarks'), input, options);
      },
      rename(input: BookmarkRenameInput, options?: MutationOptions): BookmarkMutationResult {
        return executeBookmarksRename(requireAdapter(adapters.bookmarks, 'bookmarks'), input, options);
      },
      remove(input: BookmarkRemoveInput, options?: MutationOptions): BookmarkMutationResult {
        return executeBookmarksRemove(requireAdapter(adapters.bookmarks, 'bookmarks'), input, options);
      },
    },
    footnotes: {
      list(query?: FootnoteListInput): FootnotesListResult {
        return executeFootnotesList(requireAdapter(adapters.footnotes, 'footnotes'), query);
      },
      get(input: FootnoteGetInput): FootnoteInfo {
        return executeFootnotesGet(requireAdapter(adapters.footnotes, 'footnotes'), input);
      },
      insert(input: FootnoteInsertInput, options?: MutationOptions): FootnoteMutationResult {
        return executeFootnotesInsert(requireAdapter(adapters.footnotes, 'footnotes'), input, options);
      },
      update(input: FootnoteUpdateInput, options?: MutationOptions): FootnoteMutationResult {
        return executeFootnotesUpdate(requireAdapter(adapters.footnotes, 'footnotes'), input, options);
      },
      remove(input: FootnoteRemoveInput, options?: MutationOptions): FootnoteMutationResult {
        return executeFootnotesRemove(requireAdapter(adapters.footnotes, 'footnotes'), input, options);
      },
      configure(input: FootnoteConfigureInput, options?: MutationOptions): FootnoteConfigResult {
        return executeFootnotesConfigure(requireAdapter(adapters.footnotes, 'footnotes'), input, options);
      },
    },
    clipboard: {
      parse(payload: ClipboardPayload, options?: ClipboardParseOptions): ClipboardParseResult {
        return executeClipboardParse(requireAdapter(adapters.clipboard, 'clipboard'), payload, options);
      },
      insert(input: ClipboardInsertInput, options?: MutationOptions): ClipboardInsertResult {
        return executeClipboardInsert(requireAdapter(adapters.clipboard, 'clipboard'), input, options);
      },
      serializeSelection(input?: ClipboardSerializeInput): ClipboardSerializeResult {
        return executeClipboardSerializeSelection(requireAdapter(adapters.clipboard, 'clipboard'), input);
      },
    },
    crossRefs: {
      list(query?: CrossRefListInput): CrossRefsListResult {
        return executeCrossRefsList(requireAdapter(adapters.crossRefs, 'crossRefs'), query);
      },
      get(input: CrossRefGetInput): CrossRefInfo {
        return executeCrossRefsGet(requireAdapter(adapters.crossRefs, 'crossRefs'), input);
      },
      insert(input: CrossRefInsertInput, options?: MutationOptions): CrossRefMutationResult {
        return executeCrossRefsInsert(requireAdapter(adapters.crossRefs, 'crossRefs'), input, options);
      },
      rebuild(input: CrossRefRebuildInput, options?: MutationOptions): CrossRefMutationResult {
        return executeCrossRefsRebuild(requireAdapter(adapters.crossRefs, 'crossRefs'), input, options);
      },
      remove(input: CrossRefRemoveInput, options?: MutationOptions): CrossRefMutationResult {
        return executeCrossRefsRemove(requireAdapter(adapters.crossRefs, 'crossRefs'), input, options);
      },
    },
    index: {
      list(input?: IndexListInput): IndexListResult {
        return executeIndexList(requireAdapter(adapters.index, 'index'), input);
      },
      get(input: IndexGetInput): IndexInfo {
        return executeIndexGet(requireAdapter(adapters.index, 'index'), input);
      },
      insert(input: IndexInsertInput, options?: MutationOptions): IndexMutationResult {
        return executeIndexInsert(requireAdapter(adapters.index, 'index'), input, options);
      },
      configure(input: IndexConfigureInput, options?: MutationOptions): IndexMutationResult {
        return executeIndexConfigure(requireAdapter(adapters.index, 'index'), input, options);
      },
      rebuild(input: IndexRebuildInput, options?: MutationOptions): IndexMutationResult {
        return executeIndexRebuild(requireAdapter(adapters.index, 'index'), input, options);
      },
      remove(input: IndexRemoveInput, options?: MutationOptions): IndexMutationResult {
        return executeIndexRemove(requireAdapter(adapters.index, 'index'), input, options);
      },
      entries: {
        list(input?: IndexEntryListInput): IndexEntryListResult {
          return executeIndexEntryList(requireAdapter(adapters.index, 'index'), input);
        },
        get(input: IndexEntryGetInput): IndexEntryInfo {
          return executeIndexEntryGet(requireAdapter(adapters.index, 'index'), input);
        },
        insert(input: IndexEntryInsertInput, options?: MutationOptions): IndexEntryMutationResult {
          return executeIndexEntryInsert(requireAdapter(adapters.index, 'index'), input, options);
        },
        update(input: IndexEntryUpdateInput, options?: MutationOptions): IndexEntryMutationResult {
          return executeIndexEntryUpdate(requireAdapter(adapters.index, 'index'), input, options);
        },
        remove(input: IndexEntryRemoveInput, options?: MutationOptions): IndexEntryMutationResult {
          return executeIndexEntryRemove(requireAdapter(adapters.index, 'index'), input, options);
        },
      },
    },
    captions: {
      list(input?: CaptionListInput): CaptionsListResult {
        return executeCaptionsList(requireAdapter(adapters.captions, 'captions'), input);
      },
      get(input: CaptionGetInput): CaptionInfo {
        return executeCaptionsGet(requireAdapter(adapters.captions, 'captions'), input);
      },
      insert(input: CaptionInsertInput, options?: MutationOptions): CaptionMutationResult {
        return executeCaptionsInsert(requireAdapter(adapters.captions, 'captions'), input, options);
      },
      update(input: CaptionUpdateInput, options?: MutationOptions): CaptionMutationResult {
        return executeCaptionsUpdate(requireAdapter(adapters.captions, 'captions'), input, options);
      },
      remove(input: CaptionRemoveInput, options?: MutationOptions): CaptionMutationResult {
        return executeCaptionsRemove(requireAdapter(adapters.captions, 'captions'), input, options);
      },
      configure(input: CaptionConfigureInput, options?: MutationOptions): CaptionConfigResult {
        return executeCaptionsConfigure(requireAdapter(adapters.captions, 'captions'), input, options);
      },
    },
    fields: {
      list(query?: FieldListInput): FieldsListResult {
        return executeFieldsList(requireAdapter(adapters.fields, 'fields'), query);
      },
      get(input: FieldGetInput): FieldInfo {
        return executeFieldsGet(requireAdapter(adapters.fields, 'fields'), input);
      },
      insert(input: FieldInsertInput, options?: MutationOptions): FieldMutationResult {
        return executeFieldsInsert(requireAdapter(adapters.fields, 'fields'), input, options);
      },
      rebuild(input: FieldRebuildInput, options?: MutationOptions): FieldMutationResult {
        return executeFieldsRebuild(requireAdapter(adapters.fields, 'fields'), input, options);
      },
      remove(input: FieldRemoveInput, options?: MutationOptions): FieldMutationResult {
        return executeFieldsRemove(requireAdapter(adapters.fields, 'fields'), input, options);
      },
    },
    citations: {
      list(query?: CitationListInput): CitationsListResult {
        return executeCitationsList(requireAdapter(adapters.citations, 'citations'), query);
      },
      get(input: CitationGetInput): CitationInfo {
        return executeCitationsGet(requireAdapter(adapters.citations, 'citations'), input);
      },
      insert(input: CitationInsertInput, options?: MutationOptions): CitationMutationResult {
        return executeCitationsInsert(requireAdapter(adapters.citations, 'citations'), input, options);
      },
      update(input: CitationUpdateInput, options?: MutationOptions): CitationMutationResult {
        return executeCitationsUpdate(requireAdapter(adapters.citations, 'citations'), input, options);
      },
      remove(input: CitationRemoveInput, options?: MutationOptions): CitationMutationResult {
        return executeCitationsRemove(requireAdapter(adapters.citations, 'citations'), input, options);
      },
      sources: {
        list(query?: CitationSourceListInput): CitationSourcesListResult {
          return executeCitationSourcesList(requireAdapter(adapters.citations, 'citations'), query);
        },
        get(input: CitationSourceGetInput): CitationSourceInfo {
          return executeCitationSourcesGet(requireAdapter(adapters.citations, 'citations'), input);
        },
        insert(input: CitationSourceInsertInput, options?: MutationOptions): CitationSourceMutationResult {
          return executeCitationSourcesInsert(requireAdapter(adapters.citations, 'citations'), input, options);
        },
        update(input: CitationSourceUpdateInput, options?: MutationOptions): CitationSourceMutationResult {
          return executeCitationSourcesUpdate(requireAdapter(adapters.citations, 'citations'), input, options);
        },
        remove(input: CitationSourceRemoveInput, options?: MutationOptions): CitationSourceMutationResult {
          return executeCitationSourcesRemove(requireAdapter(adapters.citations, 'citations'), input, options);
        },
      },
      bibliography: {
        get(input: BibliographyGetInput): BibliographyInfo {
          return executeBibliographyGet(requireAdapter(adapters.citations, 'citations'), input);
        },
        insert(input: BibliographyInsertInput, options?: MutationOptions): BibliographyMutationResult {
          return executeBibliographyInsert(requireAdapter(adapters.citations, 'citations'), input, options);
        },
        rebuild(input: BibliographyRebuildInput, options?: MutationOptions): BibliographyMutationResult {
          return executeBibliographyRebuild(requireAdapter(adapters.citations, 'citations'), input, options);
        },
        configure(input: BibliographyConfigureInput, options?: MutationOptions): BibliographyMutationResult {
          return executeBibliographyConfigure(requireAdapter(adapters.citations, 'citations'), input, options);
        },
        remove(input: BibliographyRemoveInput, options?: MutationOptions): BibliographyMutationResult {
          return executeBibliographyRemove(requireAdapter(adapters.citations, 'citations'), input, options);
        },
      },
    },
    authorities: {
      list(query?: AuthoritiesListInput): AuthoritiesListResult {
        return executeAuthoritiesList(requireAdapter(adapters.authorities, 'authorities'), query);
      },
      get(input: AuthoritiesGetInput): AuthoritiesInfo {
        return executeAuthoritiesGet(requireAdapter(adapters.authorities, 'authorities'), input);
      },
      insert(input: AuthoritiesInsertInput, options?: MutationOptions): AuthoritiesMutationResult {
        return executeAuthoritiesInsert(requireAdapter(adapters.authorities, 'authorities'), input, options);
      },
      configure(input: AuthoritiesConfigureInput, options?: MutationOptions): AuthoritiesMutationResult {
        return executeAuthoritiesConfigure(requireAdapter(adapters.authorities, 'authorities'), input, options);
      },
      rebuild(input: AuthoritiesRebuildInput, options?: MutationOptions): AuthoritiesMutationResult {
        return executeAuthoritiesRebuild(requireAdapter(adapters.authorities, 'authorities'), input, options);
      },
      remove(input: AuthoritiesRemoveInput, options?: MutationOptions): AuthoritiesMutationResult {
        return executeAuthoritiesRemove(requireAdapter(adapters.authorities, 'authorities'), input, options);
      },
      entries: {
        list(query?: AuthorityEntryListInput): AuthorityEntryListResult {
          return executeAuthorityEntriesList(requireAdapter(adapters.authorities, 'authorities'), query);
        },
        get(input: AuthorityEntryGetInput): AuthorityEntryInfo {
          return executeAuthorityEntriesGet(requireAdapter(adapters.authorities, 'authorities'), input);
        },
        insert(input: AuthorityEntryInsertInput, options?: MutationOptions): AuthorityEntryMutationResult {
          return executeAuthorityEntriesInsert(requireAdapter(adapters.authorities, 'authorities'), input, options);
        },
        update(input: AuthorityEntryUpdateInput, options?: MutationOptions): AuthorityEntryMutationResult {
          return executeAuthorityEntriesUpdate(requireAdapter(adapters.authorities, 'authorities'), input, options);
        },
        remove(input: AuthorityEntryRemoveInput, options?: MutationOptions): AuthorityEntryMutationResult {
          return executeAuthorityEntriesRemove(requireAdapter(adapters.authorities, 'authorities'), input, options);
        },
      },
    },
    query: {
      match(input: QueryMatchInput | TextSelector | NodeSelector): QueryMatchOutput {
        return executeQueryMatch(adapters.query, input);
      },
    },
    ranges: {
      resolve(input: ResolveRangeInput): ResolveRangeOutput {
        return executeResolveRange(adapters.ranges, input);
      },
    },
    selection: {
      current(input?: SelectionCurrentInput): SelectionInfo {
        const adapter = adapters.selection;
        if (!adapter) {
          throw new DocumentApiValidationError(
            'SELECTION_ADAPTER_UNAVAILABLE',
            'No selection adapter was registered. Pass `selection` in DocumentApiAdapters to call selection.current().',
          );
        }
        return executeSelectionCurrent(adapter, input);
      },
    },
    mutations: {
      preview(input: MutationsPreviewInput): Promise<MutationsPreviewOutput> {
        return adapters.mutations.preview(input);
      },
      apply(input: MutationsApplyInput): Promise<PlanReceipt> {
        return adapters.mutations.apply(input);
      },
    },
    plan: createPlanApi((operationId, input, options) =>
      api.invoke({ operationId, input, options } as DynamicInvokeRequest),
    ),
    diff: {
      capture(): DiffSnapshot {
        return executeDiffCapture(adapters.diff);
      },
      compare(input: DiffCompareInput): DiffPayload {
        return executeDiffCompare(adapters.diff, input);
      },
      apply(input: DiffApplyInput, options?: DiffApplyOptions): DiffApplyResult {
        return executeDiffApply(adapters.diff, input, options);
      },
    },
    export: {
      toDocx(input?: ExportToDocxInput): ExportToDocxResult {
        return executeExportToDocx(adapters.export, input);
      },
    },
    history: {
      get(): HistoryState {
        return executeHistoryGet(adapters.history);
      },
      undo(): HistoryActionResult {
        return executeHistoryUndo(adapters.history);
      },
      redo(): HistoryActionResult {
        return executeHistoryRedo(adapters.history);
      },
    },
    protection: {
      get(input?: ProtectionGetInput): DocumentProtectionState {
        return executeProtectionGet(adapters.protection, input);
      },
      setEditingRestriction(input: SetEditingRestrictionInput, options?: MutationOptions): ProtectionMutationResult {
        return executeSetEditingRestriction(adapters.protection, input, options);
      },
      clearEditingRestriction(
        input?: ClearEditingRestrictionInput,
        options?: MutationOptions,
      ): ProtectionMutationResult {
        return executeClearEditingRestriction(adapters.protection, input, options);
      },
    },
    permissionRanges: {
      list(input?: PermissionRangesListInput): PermissionRangesListResult {
        return executePermissionRangesList(adapters.permissionRanges, input);
      },
      get(input: PermissionRangesGetInput): PermissionRangeInfo {
        return executePermissionRangesGet(adapters.permissionRanges, input);
      },
      create(input: PermissionRangesCreateInput, options?: MutationOptions): PermissionRangeMutationResult {
        return executePermissionRangesCreate(adapters.permissionRanges, input, options);
      },
      remove(input: PermissionRangesRemoveInput, options?: MutationOptions): PermissionRangeRemoveResult {
        return executePermissionRangesRemove(adapters.permissionRanges, input, options);
      },
      updatePrincipal(
        input: PermissionRangesUpdatePrincipalInput,
        options?: MutationOptions,
      ): PermissionRangeMutationResult {
        return executePermissionRangesUpdatePrincipal(adapters.permissionRanges, input, options);
      },
    },
    customXml: {
      parts: {
        list(input?: CustomXmlPartsListInput): CustomXmlPartsListResult {
          return executeCustomXmlPartsList(requireAdapter(adapters.customXml, 'customXml').parts, input);
        },
        get(input: CustomXmlPartsGetInput): CustomXmlPartInfo | null {
          return executeCustomXmlPartsGet(requireAdapter(adapters.customXml, 'customXml').parts, input);
        },
        create(input: CustomXmlPartsCreateInput, options?: MutationOptions): CustomXmlPartsCreateResult {
          return executeCustomXmlPartsCreate(requireAdapter(adapters.customXml, 'customXml').parts, input, options);
        },
        patch(input: CustomXmlPartsPatchInput, options?: MutationOptions): CustomXmlPartsMutationResult {
          return executeCustomXmlPartsPatch(requireAdapter(adapters.customXml, 'customXml').parts, input, options);
        },
        remove(input: CustomXmlPartsRemoveInput, options?: MutationOptions): CustomXmlPartsMutationResult {
          return executeCustomXmlPartsRemove(requireAdapter(adapters.customXml, 'customXml').parts, input, options);
        },
      },
    },
    metadata: {
      attach(input: AnchoredMetadataAttachInput, options?: MutationOptions): AnchoredMetadataAttachResult {
        return executeAnchoredMetadataAttach(requireAdapter(adapters.metadata, 'metadata'), input, options);
      },
      list(input?: AnchoredMetadataListInput): AnchoredMetadataListResult {
        return executeAnchoredMetadataList(requireAdapter(adapters.metadata, 'metadata'), input);
      },
      get(input: AnchoredMetadataGetInput): AnchoredMetadataInfo | null {
        return executeAnchoredMetadataGet(requireAdapter(adapters.metadata, 'metadata'), input);
      },
      update(input: AnchoredMetadataUpdateInput, options?: MutationOptions): AnchoredMetadataMutationResult {
        return executeAnchoredMetadataUpdate(requireAdapter(adapters.metadata, 'metadata'), input, options);
      },
      remove(input: AnchoredMetadataRemoveInput, options?: MutationOptions): AnchoredMetadataMutationResult {
        return executeAnchoredMetadataRemove(requireAdapter(adapters.metadata, 'metadata'), input, options);
      },
      resolve(input: AnchoredMetadataResolveInput): AnchoredMetadataResolveInfo | null {
        return executeAnchoredMetadataResolve(requireAdapter(adapters.metadata, 'metadata'), input);
      },
    },
    invoke(request: DynamicInvokeRequest): unknown {
      if (!Object.prototype.hasOwnProperty.call(dispatch, request.operationId)) {
        throw new Error(`Unknown operationId: "${request.operationId}"`);
      }
      // Safe: InvokeRequest<T> provides caller-side type safety.
      // Dynamic callers accept adapter-level validation.
      const handler = dispatch[request.operationId] as unknown as (input: unknown, options?: unknown) => unknown;
      return handler(request.input, request.options);
    },
  };
  const dispatch = buildDispatchTable(api);
  return api;
}
