/**
 * Canonical type-level mapping from OperationId to input, options, and output types.
 *
 * This interface is the single source of truth for the invoke dispatch layer.
 * The bidirectional completeness checks at the bottom of this file guarantee
 * that every OperationId has a registry entry and vice versa.
 */
import type { OperationId } from './types.js';
import type { NodeAddress } from '../types/index.js';
import type { SDNodeResult, SDFindInput, SDFindResult, SDGetInput } from '../types/sd-envelope.js';
import type { TextMutationReceipt, Receipt } from '../types/receipt.js';
import type { SDHtmlToFragmentResult, SDMutationReceipt, SDMarkdownToFragmentResult } from '../types/sd-contract.js';
import type { DocumentInfo } from '../types/info.types.js';
import type { SDDocument } from '../types/fragment.js';
import type {
  CreateParagraphInput,
  CreateParagraphResult,
  CreateHeadingInput,
  CreateHeadingResult,
} from '../types/create.types.js';
import type {
  BlocksDeleteInput,
  BlocksDeleteResult,
  BlocksListInput,
  BlocksListResult,
  BlocksFindTextInput,
  BlocksFindTextResult,
  BlocksDeleteRangeInput,
  BlocksDeleteRangeResult,
  BlocksMergeInput,
  BlocksMergeResult,
  BlocksMoveInput,
  BlocksMoveResult,
  BlocksSplitInput,
  BlocksSplitResult,
} from '../types/blocks.types.js';
import type { GetNodeByIdInput } from '../get-node/get-node.js';
import type { GetTextInput } from '../get-text/get-text.js';
import type { GetMarkdownInput } from '../get-markdown/get-markdown.js';
import type { GetHtmlInput } from '../get-html/get-html.js';
import type { ProjectHtmlInput, ProjectMarkdownInput, SDContentProjectionResult } from '../types/content-projection.js';
import type { MarkdownToFragmentInput } from '../markdown-to-fragment/markdown-to-fragment.js';
import type { HtmlToFragmentInput } from '../html-to-fragment/html-to-fragment.js';
import type { InfoInput } from '../info/info.js';
import type { ExtractInput } from '../extract/extract.js';
import type { ExtractResult } from '../types/extract.types.js';
import type { ClearContentInput } from '../clear-content/clear-content.js';
import type { InsertInput } from '../insert/insert.js';
import type { ReplaceInput } from '../replace/replace.js';
import type { DeleteInput } from '../delete/delete.js';
import type { MutationOptions, RevisionGuardOptions, RichContentMutationOptions } from '../write/write.js';
import type { FormatInlineAliasInput, FormatRangeInput, StyleApplyInput } from '../format/format.js';
import type { InlineRunPatchKey } from '../format/inline-run-patch.js';
import type {
  StylesApplyInput,
  StylesApplyOptions,
  StylesApplyReceipt,
  StylesGetCatalogInput,
  StylesGetCatalogResult,
} from '../styles/index.js';
import type { TemplatesApplyInput, TemplatesApplyOptions, TemplatesApplyReceipt } from '../templates/index.js';
import type {
  CommentsCreateReceipt,
  CommentsCreateInput,
  CommentsPatchInput,
  CommentsDeleteInput,
  GetCommentInput,
} from '../comments/comments.js';
import type { CommentInfo, CommentsListQuery, CommentsListResult } from '../comments/comments.types.js';
import type { TrackChangesListInput, TrackChangesGetInput, ReviewDecideInput } from '../track-changes/track-changes.js';
import type { TrackChangeInfo, TrackChangesListResult } from '../types/track-changes.types.js';
import type { DocumentApiCapabilities } from '../capabilities/capabilities.js';
import type {
  SDHtmlMarkdownSupportCheckInput,
  SDHtmlMarkdownSupportCheckResult,
} from '../capabilities/html-markdown-support.js';
import type { HistoryState, HistoryActionResult } from '../history/history.types.js';
import type {
  DiffSnapshot,
  DiffPayload,
  DiffApplyResult,
  DiffCompareInput,
  DiffApplyInput,
  DiffApplyOptions,
} from '../diff/diff.types.js';
import type { ExportToDocxInput, ExportToDocxResult } from '../export/export.types.js';
import type {
  DocumentProtectionState,
  ProtectionGetInput,
  SetEditingRestrictionInput,
  ClearEditingRestrictionInput,
  ProtectionMutationResult,
} from '../protection/protection.types.js';
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
} from '../permission-ranges/permission-ranges.types.js';
import type {
  ListsListQuery,
  ListsListResult,
  ListsGetInput,
  ListItemInfo,
  ListInsertInput,
  ListsInsertResult,
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
  ListsSetTypeInput,
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
} from '../lists/lists.types.js';
import type {
  ParagraphMutationResult,
  ParagraphsSetStyleInput,
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
} from '../paragraphs/paragraphs.js';
import type {
  CreateSectionBreakInput,
  CreateSectionBreakResult,
  DocumentMutationResult,
  SectionInfo,
  SectionMutationResult,
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
} from '../sections/sections.types.js';
import type { QueryMatchInput, QueryMatchOutput } from '../types/query-match.types.js';
import type { ResolveRangeInput, ResolveRangeOutput } from '../ranges/ranges.types.js';
import type { SelectionCurrentInput, SelectionInfo } from '../selection/selection.js';
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
} from '../images/images.types.js';
import type {
  MutationsApplyInput,
  MutationsPreviewInput,
  MutationsPreviewOutput,
  PlanReceipt,
} from '../types/mutation-plan.types.js';
import type { PlanExecuteInput, PlanExecuteResult } from '../plan/plan.js';
import type {
  CreateTableOfContentsInput,
  CreateTableOfContentsResult,
  TocListQuery,
  TocListResult,
  TocGetInput,
  TocInfo,
  TocConfigureInput,
  TocUpdateInput,
  TocRemoveInput,
  TocMutationResult,
  TocMarkEntryInput,
  TocUnmarkEntryInput,
  TocListEntriesQuery,
  TocListEntriesResult,
  TocGetEntryInput,
  TocEntryInfo,
  TocEditEntryInput,
  TocEntryMutationResult,
} from '../toc/toc.types.js';
import type {
  BookmarkListInput,
  BookmarksListResult,
  BookmarkGetInput,
  BookmarkInfo,
  BookmarkInsertInput,
  BookmarkRenameInput,
  BookmarkRemoveInput,
  BookmarkMutationResult,
} from '../bookmarks/bookmarks.types.js';
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
} from '../customXml/customXml.types.js';
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
} from '../metadata/anchored-metadata.types.js';
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
} from '../footnotes/footnotes.types.js';
import type {
  ClipboardInsertInput,
  ClipboardInsertResult,
  ClipboardParseOptions,
  ClipboardParseResult,
  ClipboardPayload,
  ClipboardSerializeInput,
  ClipboardSerializeResult,
} from '../types/clipboard.js';
import type {
  CrossRefListInput,
  CrossRefsListResult,
  CrossRefGetInput,
  CrossRefInfo,
  CrossRefInsertInput,
  CrossRefRebuildInput,
  CrossRefRemoveInput,
  CrossRefMutationResult,
} from '../cross-refs/cross-refs.types.js';
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
} from '../index/index.types.js';
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
} from '../captions/captions.types.js';
import type {
  FieldListInput,
  FieldsListResult,
  FieldGetInput,
  FieldInfo,
  FieldInsertInput,
  FieldRebuildInput,
  FieldRemoveInput,
  FieldMutationResult,
} from '../fields/fields.types.js';
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
} from '../citations/citations.types.js';
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
} from '../authorities/authorities.types.js';
import type {
  CreateTableInput,
  CreateTableResult,
  TablesConvertFromTextInput,
  TableLocator,
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
  TableMutationResult,
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
} from '../types/table-operations.types.js';
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
} from '../hyperlinks/hyperlinks.types.js';
import type {
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
} from '../header-footers/header-footers.types.js';
import type {
  ContentControlInfo,
  ContentControlMutationResult,
  ContentControlsListResult,
  ContentControlsListQuery,
  ContentControlsGetInput,
  ContentControlsListInRangeInput,
  ContentControlsSelectByTagInput,
  ContentControlsSelectByTitleInput,
  ContentControlsListChildrenInput,
  ContentControlsGetParentInput,
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
  ContentControlBinding,
  ContentControlsSetBindingInput,
  ContentControlsClearBindingInput,
  ContentControlsGetRawPropertiesInput,
  ContentControlsGetRawPropertiesResult,
  ContentControlsPatchRawPropertiesInput,
  ContentControlsValidateWordCompatibilityInput,
  ContentControlsValidateWordCompatibilityResult,
  ContentControlsNormalizeWordCompatibilityInput,
  ContentControlsNormalizeTagPayloadInput,
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
  CreateContentControlInput,
} from '../content-controls/content-controls.types.js';
type FormatInlineAliasOperationRegistry = {
  [K in InlineRunPatchKey as `format.${K}`]: {
    input: FormatInlineAliasInput<K>;
    options: MutationOptions;
    output: TextMutationReceipt;
  };
};
export interface OperationRegistry extends FormatInlineAliasOperationRegistry {
  // --- Singleton reads ---
  get: { input: SDGetInput; options: never; output: SDDocument };
  find: { input: SDFindInput; options: never; output: SDFindResult };
  getNode: { input: NodeAddress; options: never; output: SDNodeResult };
  getNodeById: { input: GetNodeByIdInput; options: never; output: SDNodeResult };
  getText: { input: GetTextInput; options: never; output: string };
  getMarkdown: { input: GetMarkdownInput; options: never; output: string };
  getHtml: { input: GetHtmlInput; options: never; output: string };
  projectMarkdown: {
    input: ProjectMarkdownInput;
    options: never;
    output: Promise<SDContentProjectionResult<'markdown'>>;
  };
  projectHtml: {
    input: ProjectHtmlInput;
    options: never;
    output: Promise<SDContentProjectionResult<'html'>>;
  };
  markdownToFragment: { input: MarkdownToFragmentInput; options: never; output: SDMarkdownToFragmentResult };
  htmlToFragment: { input: HtmlToFragmentInput; options: never; output: SDHtmlToFragmentResult };
  info: { input: InfoInput; options: never; output: DocumentInfo };
  extract: { input: ExtractInput; options: never; output: ExtractResult };
  // --- Singleton mutations ---
  clearContent: { input: ClearContentInput; options: RevisionGuardOptions; output: Receipt };
  insert: { input: InsertInput; options: RichContentMutationOptions; output: SDMutationReceipt };
  replace: { input: ReplaceInput; options: RichContentMutationOptions; output: SDMutationReceipt };
  delete: { input: DeleteInput; options: MutationOptions; output: TextMutationReceipt };
  formatRange: { input: FormatRangeInput; options: MutationOptions; output: TextMutationReceipt };
  // --- blocks.* ---
  'blocks.list': { input: BlocksListInput | undefined; options: never; output: BlocksListResult };
  'blocks.findText': { input: BlocksFindTextInput; options: never; output: BlocksFindTextResult };
  'blocks.delete': { input: BlocksDeleteInput; options: MutationOptions; output: BlocksDeleteResult };
  'blocks.deleteRange': { input: BlocksDeleteRangeInput; options: MutationOptions; output: BlocksDeleteRangeResult };
  'blocks.split': { input: BlocksSplitInput; options: MutationOptions; output: BlocksSplitResult };
  'blocks.merge': { input: BlocksMergeInput; options: MutationOptions; output: BlocksMergeResult };
  'blocks.move': { input: BlocksMoveInput; options: MutationOptions; output: BlocksMoveResult };
  // --- format.* ---
  'format.apply': { input: StyleApplyInput; options: MutationOptions; output: TextMutationReceipt };
  // --- styles.paragraph.* ---
  'styles.paragraph.setStyle': {
    input: ParagraphsSetStyleInput;
    options: MutationOptions;
    output: ParagraphMutationResult;
  };
  'styles.paragraph.setStyleRef': {
    input: ParagraphsSetStyleRefInput;
    options: MutationOptions;
    output: ParagraphMutationResult;
  };
  'styles.paragraph.clearStyle': {
    input: ParagraphsClearStyleInput;
    options: MutationOptions;
    output: ParagraphMutationResult;
  };
  // --- format.paragraph.* ---
  'format.paragraph.resetDirectFormatting': {
    input: ParagraphsResetDirectFormattingInput;
    options: MutationOptions;
    output: ParagraphMutationResult;
  };
  'format.paragraph.setAlignment': {
    input: ParagraphsSetAlignmentInput;
    options: MutationOptions;
    output: ParagraphMutationResult;
  };
  'format.paragraph.clearAlignment': {
    input: ParagraphsClearAlignmentInput;
    options: MutationOptions;
    output: ParagraphMutationResult;
  };
  'format.paragraph.setIndentation': {
    input: ParagraphsSetIndentationInput;
    options: MutationOptions;
    output: ParagraphMutationResult;
  };
  'format.paragraph.clearIndentation': {
    input: ParagraphsClearIndentationInput;
    options: MutationOptions;
    output: ParagraphMutationResult;
  };
  'format.paragraph.setSpacing': {
    input: ParagraphsSetSpacingInput;
    options: MutationOptions;
    output: ParagraphMutationResult;
  };
  'format.paragraph.clearSpacing': {
    input: ParagraphsClearSpacingInput;
    options: MutationOptions;
    output: ParagraphMutationResult;
  };
  'format.paragraph.setKeepOptions': {
    input: ParagraphsSetKeepOptionsInput;
    options: MutationOptions;
    output: ParagraphMutationResult;
  };
  'format.paragraph.setOutlineLevel': {
    input: ParagraphsSetOutlineLevelInput;
    options: MutationOptions;
    output: ParagraphMutationResult;
  };
  'format.paragraph.setFlowOptions': {
    input: ParagraphsSetFlowOptionsInput;
    options: MutationOptions;
    output: ParagraphMutationResult;
  };
  'format.paragraph.setTabStop': {
    input: ParagraphsSetTabStopInput;
    options: MutationOptions;
    output: ParagraphMutationResult;
  };
  'format.paragraph.clearTabStop': {
    input: ParagraphsClearTabStopInput;
    options: MutationOptions;
    output: ParagraphMutationResult;
  };
  'format.paragraph.clearAllTabStops': {
    input: ParagraphsClearAllTabStopsInput;
    options: MutationOptions;
    output: ParagraphMutationResult;
  };
  'format.paragraph.setBorder': {
    input: ParagraphsSetBorderInput;
    options: MutationOptions;
    output: ParagraphMutationResult;
  };
  'format.paragraph.clearBorder': {
    input: ParagraphsClearBorderInput;
    options: MutationOptions;
    output: ParagraphMutationResult;
  };
  'format.paragraph.setShading': {
    input: ParagraphsSetShadingInput;
    options: MutationOptions;
    output: ParagraphMutationResult;
  };
  'format.paragraph.clearShading': {
    input: ParagraphsClearShadingInput;
    options: MutationOptions;
    output: ParagraphMutationResult;
  };
  'format.paragraph.setMarkRunProps': {
    input: ParagraphsSetMarkRunPropsInput;
    options: MutationOptions;
    output: ParagraphMutationResult;
  };
  'format.paragraph.setDirection': {
    input: ParagraphsSetDirectionInput;
    options: MutationOptions;
    output: ParagraphMutationResult;
  };
  'format.paragraph.clearDirection': {
    input: ParagraphsClearDirectionInput;
    options: MutationOptions;
    output: ParagraphMutationResult;
  };
  'format.paragraph.setNumbering': {
    input: ParagraphsSetNumberingInput;
    options: MutationOptions;
    output: ParagraphMutationResult;
  };
  // --- styles.* ---
  'styles.apply': { input: StylesApplyInput; options: StylesApplyOptions; output: StylesApplyReceipt };
  'styles.getCatalog': {
    input: StylesGetCatalogInput | undefined;
    options: never;
    output: StylesGetCatalogResult;
  };
  // --- templates.* ---
  // Async operation (SD-3247): output is Promise<TemplatesApplyReceipt>. The JSON
  // output schema still describes the resolved receipt, not the Promise.
  'templates.apply': {
    input: TemplatesApplyInput;
    options: TemplatesApplyOptions;
    output: Promise<TemplatesApplyReceipt>;
  };
  // --- create.* ---
  'create.paragraph': { input: CreateParagraphInput; options: MutationOptions; output: CreateParagraphResult };
  'create.heading': { input: CreateHeadingInput; options: MutationOptions; output: CreateHeadingResult };
  'create.sectionBreak': { input: CreateSectionBreakInput; options: MutationOptions; output: CreateSectionBreakResult };
  // --- lists.* ---
  'lists.list': { input: ListsListQuery | undefined; options: never; output: ListsListResult };
  'lists.get': { input: ListsGetInput; options: never; output: ListItemInfo };
  'lists.insert': { input: ListInsertInput; options: MutationOptions; output: ListsInsertResult };
  'lists.create': { input: ListsCreateInput; options: MutationOptions; output: ListsCreateResult };
  'lists.attach': { input: ListsAttachInput; options: MutationOptions; output: ListsMutateItemResult };
  'lists.detach': { input: ListsDetachInput; options: MutationOptions; output: ListsDetachResult };
  'lists.delete': { input: ListsDeleteInput; options: MutationOptions; output: ListsDeleteResult };
  'lists.indent': { input: ListTargetInput; options: MutationOptions; output: ListsMutateItemResult };
  'lists.outdent': { input: ListTargetInput; options: MutationOptions; output: ListsMutateItemResult };
  'lists.join': { input: ListsJoinInput; options: MutationOptions; output: ListsJoinResult };
  'lists.canJoin': { input: ListsCanJoinInput; options: never; output: ListsCanJoinResult };
  'lists.separate': { input: ListsSeparateInput; options: MutationOptions; output: ListsSeparateResult };
  'lists.merge': { input: ListsMergeInput; options: MutationOptions; output: ListsMergeResult };
  'lists.split': { input: ListsSplitInput; options: MutationOptions; output: ListsSplitResult };
  'lists.setLevel': { input: ListsSetLevelInput; options: MutationOptions; output: ListsMutateItemResult };
  'lists.setValue': { input: ListsSetValueInput; options: MutationOptions; output: ListsMutateItemResult };
  'lists.continuePrevious': {
    input: ListsContinuePreviousInput;
    options: MutationOptions;
    output: ListsMutateItemResult;
  };
  'lists.canContinuePrevious': {
    input: ListsCanContinuePreviousInput;
    options: never;
    output: ListsCanContinuePreviousResult;
  };
  'lists.setLevelRestart': {
    input: ListsSetLevelRestartInput;
    options: MutationOptions;
    output: ListsMutateItemResult;
  };
  'lists.convertToText': { input: ListsConvertToTextInput; options: MutationOptions; output: ListsConvertToTextResult };
  // --- lists.* (SD-1973 formatting) ---
  'lists.applyTemplate': { input: ListsApplyTemplateInput; options: MutationOptions; output: ListsMutateItemResult };
  'lists.applyPreset': { input: ListsApplyPresetInput; options: MutationOptions; output: ListsMutateItemResult };
  'lists.setType': { input: ListsSetTypeInput; options: MutationOptions; output: ListsMutateItemResult };
  'lists.captureTemplate': { input: ListsCaptureTemplateInput; options: never; output: ListsCaptureTemplateResult };
  'lists.setLevelNumbering': {
    input: ListsSetLevelNumberingInput;
    options: MutationOptions;
    output: ListsMutateItemResult;
  };
  'lists.setLevelBullet': { input: ListsSetLevelBulletInput; options: MutationOptions; output: ListsMutateItemResult };
  'lists.setLevelPictureBullet': {
    input: ListsSetLevelPictureBulletInput;
    options: MutationOptions;
    output: ListsMutateItemResult;
  };
  'lists.setLevelAlignment': {
    input: ListsSetLevelAlignmentInput;
    options: MutationOptions;
    output: ListsMutateItemResult;
  };
  'lists.setLevelIndents': {
    input: ListsSetLevelIndentsInput;
    options: MutationOptions;
    output: ListsMutateItemResult;
  };
  'lists.setLevelTrailingCharacter': {
    input: ListsSetLevelTrailingCharacterInput;
    options: MutationOptions;
    output: ListsMutateItemResult;
  };
  'lists.setLevelMarkerFont': {
    input: ListsSetLevelMarkerFontInput;
    options: MutationOptions;
    output: ListsMutateItemResult;
  };
  'lists.clearLevelOverrides': {
    input: ListsClearLevelOverridesInput;
    options: MutationOptions;
    output: ListsMutateItemResult;
  };
  // --- lists.* (SD-2025 user-facing) ---
  'lists.getStyle': { input: ListsGetStyleInput; options: never; output: ListsGetStyleResult };
  'lists.applyStyle': { input: ListsApplyStyleInput; options: MutationOptions; output: ListsMutateItemResult };
  'lists.restartAt': { input: ListsRestartAtInput; options: MutationOptions; output: ListsMutateItemResult };
  'lists.setLevelNumberStyle': {
    input: ListsSetLevelNumberStyleInput;
    options: MutationOptions;
    output: ListsMutateItemResult;
  };
  'lists.setLevelText': { input: ListsSetLevelTextInput; options: MutationOptions; output: ListsMutateItemResult };
  'lists.setLevelStart': { input: ListsSetLevelStartInput; options: MutationOptions; output: ListsMutateItemResult };
  'lists.setLevelLayout': { input: ListsSetLevelLayoutInput; options: MutationOptions; output: ListsMutateItemResult };
  // --- lists.* (v2 numbering-aware) ---
  'lists.getState': { input: ListsGetStateInput; options: never; output: ListsGetStateResult };
  'lists.apply': { input: ListsApplyInput; options: MutationOptions; output: ListsMutateItemResult };
  'lists.continue': { input: ListsContinueV2Input; options: MutationOptions; output: ListsMutateItemResult };
  'lists.restart': { input: ListsRestartV2Input; options: MutationOptions; output: ListsMutateItemResult };
  'lists.remove': { input: ListsRemoveV2Input; options: MutationOptions; output: ListsMutateItemResult };
  // --- sections.* ---
  'sections.list': { input: SectionsListQuery | undefined; options: never; output: SectionsListResult };
  'sections.get': { input: SectionsGetInput; options: never; output: SectionInfo };
  'sections.setBreakType': {
    input: SectionsSetBreakTypeInput;
    options: MutationOptions;
    output: SectionMutationResult;
  };
  'sections.setPageMargins': {
    input: SectionsSetPageMarginsInput;
    options: MutationOptions;
    output: SectionMutationResult;
  };
  'sections.setHeaderFooterMargins': {
    input: SectionsSetHeaderFooterMarginsInput;
    options: MutationOptions;
    output: SectionMutationResult;
  };
  'sections.setPageSetup': {
    input: SectionsSetPageSetupInput;
    options: MutationOptions;
    output: SectionMutationResult;
  };
  'sections.setColumns': { input: SectionsSetColumnsInput; options: MutationOptions; output: SectionMutationResult };
  'sections.setLineNumbering': {
    input: SectionsSetLineNumberingInput;
    options: MutationOptions;
    output: SectionMutationResult;
  };
  'sections.setPageNumbering': {
    input: SectionsSetPageNumberingInput;
    options: MutationOptions;
    output: SectionMutationResult;
  };
  'sections.setTitlePage': {
    input: SectionsSetTitlePageInput;
    options: MutationOptions;
    output: SectionMutationResult;
  };
  // Returns DocumentMutationResult (not SectionMutationResult): document-level setting, not per-section.
  'sections.setOddEvenHeadersFooters': {
    input: SectionsSetOddEvenHeadersFootersInput;
    options: MutationOptions;
    output: DocumentMutationResult;
  };
  'sections.setVerticalAlign': {
    input: SectionsSetVerticalAlignInput;
    options: MutationOptions;
    output: SectionMutationResult;
  };
  'sections.setSectionDirection': {
    input: SectionsSetSectionDirectionInput;
    options: MutationOptions;
    output: SectionMutationResult;
  };
  'sections.setHeaderFooterRef': {
    input: SectionsSetHeaderFooterRefInput;
    options: MutationOptions;
    output: SectionMutationResult;
  };
  'sections.clearHeaderFooterRef': {
    input: SectionsClearHeaderFooterRefInput;
    options: MutationOptions;
    output: SectionMutationResult;
  };
  'sections.setLinkToPrevious': {
    input: SectionsSetLinkToPreviousInput;
    options: MutationOptions;
    output: SectionMutationResult;
  };
  'sections.setPageBorders': {
    input: SectionsSetPageBordersInput;
    options: MutationOptions;
    output: SectionMutationResult;
  };
  'sections.clearPageBorders': {
    input: SectionsClearPageBordersInput;
    options: MutationOptions;
    output: SectionMutationResult;
  };
  // --- comments.* ---
  'comments.create': { input: CommentsCreateInput; options: RevisionGuardOptions; output: CommentsCreateReceipt };
  'comments.patch': { input: CommentsPatchInput; options: RevisionGuardOptions; output: Receipt };
  'comments.delete': { input: CommentsDeleteInput; options: RevisionGuardOptions; output: Receipt };
  'comments.get': { input: GetCommentInput; options: never; output: CommentInfo };
  'comments.list': { input: CommentsListQuery | undefined; options: never; output: CommentsListResult };
  // --- trackChanges.* ---
  'trackChanges.list': { input: TrackChangesListInput | undefined; options: never; output: TrackChangesListResult };
  'trackChanges.get': { input: TrackChangesGetInput; options: never; output: TrackChangeInfo };
  'trackChanges.decide': { input: ReviewDecideInput; options: RevisionGuardOptions; output: Receipt };
  // --- query.* ---
  'query.match': { input: QueryMatchInput; options: never; output: QueryMatchOutput };
  // --- ranges.* ---
  'ranges.resolve': { input: ResolveRangeInput; options: never; output: ResolveRangeOutput };
  // --- selection.* ---
  'selection.current': { input: SelectionCurrentInput | undefined; options: never; output: SelectionInfo };
  // --- mutations.* ---
  'mutations.preview': { input: MutationsPreviewInput; options: never; output: MutationsPreviewOutput };
  'mutations.apply': { input: MutationsApplyInput; options: never; output: PlanReceipt };
  'plan.execute': { input: PlanExecuteInput; options: never; output: PlanExecuteResult };
  // --- capabilities ---
  'capabilities.get': { input: undefined; options: never; output: DocumentApiCapabilities };
  'capabilities.check': {
    input: SDHtmlMarkdownSupportCheckInput;
    options: never;
    output: Promise<SDHtmlMarkdownSupportCheckResult>;
  };
  // --- history.* ---
  'history.get': { input: undefined; options: never; output: HistoryState };
  'history.undo': { input: undefined; options: never; output: HistoryActionResult };
  'history.redo': { input: undefined; options: never; output: HistoryActionResult };
  // --- create.table ---
  'create.table': { input: CreateTableInput; options: MutationOptions; output: CreateTableResult };
  // --- tables.* ---
  'tables.convertFromText': {
    input: TablesConvertFromTextInput;
    options: MutationOptions;
    output: TableMutationResult;
  };
  'tables.delete': { input: TableLocator; options: MutationOptions; output: TableMutationResult };
  'tables.clearContents': { input: TableLocator; options: MutationOptions; output: TableMutationResult };
  'tables.move': { input: TablesMoveInput; options: MutationOptions; output: TableMutationResult };
  'tables.split': { input: TablesSplitInput; options: MutationOptions; output: TableMutationResult };
  'tables.convertToText': { input: TablesConvertToTextInput; options: MutationOptions; output: TableMutationResult };
  'tables.setLayout': { input: TablesSetLayoutInput; options: MutationOptions; output: TableMutationResult };
  'tables.insertRow': { input: TablesInsertRowInput; options: MutationOptions; output: TableMutationResult };
  'tables.deleteRow': { input: TablesDeleteRowInput; options: MutationOptions; output: TableMutationResult };
  'tables.moveRow': { input: TablesMoveRowInput; options: MutationOptions; output: TableMutationResult };
  'tables.setRowHeight': { input: TablesSetRowHeightInput; options: MutationOptions; output: TableMutationResult };
  'tables.distributeRows': { input: TablesDistributeRowsInput; options: MutationOptions; output: TableMutationResult };
  'tables.setRowOptions': { input: TablesSetRowOptionsInput; options: MutationOptions; output: TableMutationResult };
  'tables.insertColumn': { input: TablesInsertColumnInput; options: MutationOptions; output: TableMutationResult };
  'tables.deleteColumn': { input: TablesDeleteColumnInput; options: MutationOptions; output: TableMutationResult };
  'tables.moveColumn': { input: TablesMoveColumnInput; options: MutationOptions; output: TableMutationResult };
  'tables.setColumnWidth': { input: TablesSetColumnWidthInput; options: MutationOptions; output: TableMutationResult };
  'tables.distributeColumns': {
    input: TablesDistributeColumnsInput;
    options: MutationOptions;
    output: TableMutationResult;
  };
  'tables.insertCell': { input: TablesInsertCellInput; options: MutationOptions; output: TableMutationResult };
  'tables.deleteCell': { input: TablesDeleteCellInput; options: MutationOptions; output: TableMutationResult };
  'tables.mergeCells': { input: TablesMergeCellsInput; options: MutationOptions; output: TableMutationResult };
  'tables.unmergeCells': { input: TablesUnmergeCellsInput; options: MutationOptions; output: TableMutationResult };
  'tables.splitCell': { input: TablesSplitCellInput; options: MutationOptions; output: TableMutationResult };
  'tables.setCellProperties': {
    input: TablesSetCellPropertiesInput;
    options: MutationOptions;
    output: TableMutationResult;
  };
  'tables.setCellText': { input: TablesSetCellTextInput; options: MutationOptions; output: TableMutationResult };
  'tables.sort': { input: TablesSortInput; options: MutationOptions; output: TableMutationResult };
  'tables.setAltText': { input: TablesSetAltTextInput; options: MutationOptions; output: TableMutationResult };
  'tables.setStyle': { input: TablesSetStyleInput; options: MutationOptions; output: TableMutationResult };
  'tables.clearStyle': { input: TablesClearStyleInput; options: MutationOptions; output: TableMutationResult };
  'tables.setStyleOption': { input: TablesSetStyleOptionInput; options: MutationOptions; output: TableMutationResult };
  'tables.setBorder': { input: TablesSetBorderInput; options: MutationOptions; output: TableMutationResult };
  'tables.clearBorder': { input: TablesClearBorderInput; options: MutationOptions; output: TableMutationResult };
  'tables.applyBorderPreset': {
    input: TablesApplyBorderPresetInput;
    options: MutationOptions;
    output: TableMutationResult;
  };
  'tables.setShading': { input: TablesSetShadingInput; options: MutationOptions; output: TableMutationResult };
  'tables.clearShading': { input: TablesClearShadingInput; options: MutationOptions; output: TableMutationResult };
  'tables.setTablePadding': {
    input: TablesSetTablePaddingInput;
    options: MutationOptions;
    output: TableMutationResult;
  };
  'tables.setCellPadding': { input: TablesSetCellPaddingInput; options: MutationOptions; output: TableMutationResult };
  'tables.setCellSpacing': { input: TablesSetCellSpacingInput; options: MutationOptions; output: TableMutationResult };
  'tables.clearCellSpacing': {
    input: TablesClearCellSpacingInput;
    options: MutationOptions;
    output: TableMutationResult;
  };
  'tables.applyStyle': { input: TablesApplyStyleInput; options: MutationOptions; output: TableMutationResult };
  'tables.setBorders': { input: TablesSetBordersInput; options: MutationOptions; output: TableMutationResult };
  'tables.setTableOptions': {
    input: TablesSetTableOptionsInput;
    options: MutationOptions;
    output: TableMutationResult;
  };
  'tables.applyPreset': { input: TablesApplyPresetInput; options: MutationOptions; output: TableMutationResult };
  // --- tables.* reads ---
  'tables.get': { input: TablesGetInput; options: never; output: TablesGetOutput };
  'tables.getCells': { input: TablesGetCellsInput; options: never; output: TablesGetCellsOutput };
  'tables.getProperties': { input: TablesGetPropertiesInput; options: never; output: TablesGetPropertiesOutput };
  'tables.getStyles': { input: TablesGetStylesInput | undefined; options: never; output: TablesGetStylesOutput };
  'tables.setDefaultStyle': {
    input: TablesSetDefaultStyleInput;
    options: MutationOptions;
    output: DocumentMutationResult;
  };
  'tables.clearDefaultStyle': {
    input: TablesClearDefaultStyleInput | undefined;
    options: MutationOptions;
    output: DocumentMutationResult;
  };
  // --- create.tableOfContents ---
  'create.tableOfContents': {
    input: CreateTableOfContentsInput;
    options: MutationOptions;
    output: CreateTableOfContentsResult;
  };
  // --- toc.* ---
  'toc.list': { input: TocListQuery | undefined; options: never; output: TocListResult };
  'toc.get': { input: TocGetInput; options: never; output: TocInfo };
  'toc.configure': { input: TocConfigureInput; options: MutationOptions; output: TocMutationResult };
  'toc.update': { input: TocUpdateInput; options: MutationOptions; output: TocMutationResult };
  'toc.remove': { input: TocRemoveInput; options: MutationOptions; output: TocMutationResult };
  // --- toc entry (TC field) operations ---
  'toc.markEntry': { input: TocMarkEntryInput; options: MutationOptions; output: TocEntryMutationResult };
  'toc.unmarkEntry': { input: TocUnmarkEntryInput; options: MutationOptions; output: TocEntryMutationResult };
  'toc.listEntries': { input: TocListEntriesQuery | undefined; options: never; output: TocListEntriesResult };
  'toc.getEntry': { input: TocGetEntryInput; options: never; output: TocEntryInfo };
  'toc.editEntry': { input: TocEditEntryInput; options: MutationOptions; output: TocEntryMutationResult };
  // --- create.image ---
  'create.image': { input: CreateImageInput; options: MutationOptions; output: CreateImageResult };
  // --- images.* ---
  'images.list': { input: ImagesListInput | undefined; options: never; output: ImagesListResult };
  'images.get': { input: ImagesGetInput; options: never; output: ImageSummary };
  'images.delete': { input: ImagesDeleteInput; options: MutationOptions; output: ImagesMutationResult };
  'images.move': { input: MoveImageInput; options: MutationOptions; output: ImagesMutationResult };
  'images.convertToInline': { input: ConvertToInlineInput; options: MutationOptions; output: ImagesMutationResult };
  'images.convertToFloating': { input: ConvertToFloatingInput; options: MutationOptions; output: ImagesMutationResult };
  'images.setSize': { input: SetSizeInput; options: MutationOptions; output: ImagesMutationResult };
  'images.setWrapType': { input: SetWrapTypeInput; options: MutationOptions; output: ImagesMutationResult };
  'images.setWrapSide': { input: SetWrapSideInput; options: MutationOptions; output: ImagesMutationResult };
  'images.setWrapDistances': { input: SetWrapDistancesInput; options: MutationOptions; output: ImagesMutationResult };
  'images.setPosition': { input: SetPositionInput; options: MutationOptions; output: ImagesMutationResult };
  'images.setAnchorOptions': { input: SetAnchorOptionsInput; options: MutationOptions; output: ImagesMutationResult };
  'images.setZOrder': { input: SetZOrderInput; options: MutationOptions; output: ImagesMutationResult };
  // SD-2100: Geometry
  'images.scale': { input: ScaleInput; options: MutationOptions; output: ImagesMutationResult };
  'images.setLockAspectRatio': {
    input: SetLockAspectRatioInput;
    options: MutationOptions;
    output: ImagesMutationResult;
  };
  'images.rotate': { input: RotateInput; options: MutationOptions; output: ImagesMutationResult };
  'images.flip': { input: FlipInput; options: MutationOptions; output: ImagesMutationResult };
  'images.crop': { input: CropInput; options: MutationOptions; output: ImagesMutationResult };
  'images.resetCrop': { input: ResetCropInput; options: MutationOptions; output: ImagesMutationResult };
  // SD-2100: Content
  'images.replaceSource': { input: ReplaceSourceInput; options: MutationOptions; output: ImagesMutationResult };
  // SD-2100: Semantic metadata
  'images.setAltText': { input: SetAltTextInput; options: MutationOptions; output: ImagesMutationResult };
  'images.setDecorative': { input: SetDecorativeInput; options: MutationOptions; output: ImagesMutationResult };
  'images.setName': { input: SetNameInput; options: MutationOptions; output: ImagesMutationResult };
  'images.setHyperlink': { input: SetHyperlinkInput; options: MutationOptions; output: ImagesMutationResult };
  // SD-2100: Caption lifecycle
  'images.insertCaption': { input: InsertCaptionInput; options: MutationOptions; output: ImagesMutationResult };
  'images.updateCaption': { input: UpdateCaptionInput; options: MutationOptions; output: ImagesMutationResult };
  'images.removeCaption': { input: RemoveCaptionInput; options: MutationOptions; output: ImagesMutationResult };
  // --- hyperlinks.* ---
  'hyperlinks.list': { input: HyperlinksListQuery | undefined; options: never; output: HyperlinksListResult };
  'hyperlinks.get': { input: HyperlinksGetInput; options: never; output: HyperlinkInfo };
  'hyperlinks.wrap': { input: HyperlinksWrapInput; options: MutationOptions; output: HyperlinkMutationResult };
  'hyperlinks.insert': { input: HyperlinksInsertInput; options: MutationOptions; output: HyperlinkMutationResult };
  'hyperlinks.patch': { input: HyperlinksPatchInput; options: MutationOptions; output: HyperlinkMutationResult };
  'hyperlinks.remove': { input: HyperlinksRemoveInput; options: MutationOptions; output: HyperlinkMutationResult };
  // --- headerFooters.* ---
  'headerFooters.list': {
    input: HeaderFootersListQuery | undefined;
    options: never;
    output: HeaderFootersListResult;
  };
  'headerFooters.get': { input: HeaderFootersGetInput; options: never; output: HeaderFooterSlotEntry };
  'headerFooters.resolve': { input: HeaderFootersResolveInput; options: never; output: HeaderFooterResolveResult };
  'headerFooters.refs.set': {
    input: HeaderFootersRefsSetInput;
    options: MutationOptions;
    output: SectionMutationResult;
  };
  'headerFooters.refs.clear': {
    input: HeaderFootersRefsClearInput;
    options: MutationOptions;
    output: SectionMutationResult;
  };
  'headerFooters.refs.setLinkedToPrevious': {
    input: HeaderFootersRefsSetLinkedToPreviousInput;
    options: MutationOptions;
    output: SectionMutationResult;
  };
  'headerFooters.parts.list': {
    input: HeaderFootersPartsListQuery | undefined;
    options: never;
    output: HeaderFootersPartsListResult;
  };
  'headerFooters.parts.create': {
    input: HeaderFootersPartsCreateInput;
    options: MutationOptions;
    output: HeaderFooterPartsMutationResult;
  };
  'headerFooters.parts.delete': {
    input: HeaderFootersPartsDeleteInput;
    options: MutationOptions;
    output: HeaderFooterPartsMutationResult;
  };
  // --- create.contentControl ---
  'create.contentControl': {
    input: CreateContentControlInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  // --- contentControls.* core CRUD + discovery ---
  'contentControls.list': {
    input: ContentControlsListQuery | undefined;
    options: never;
    output: ContentControlsListResult;
  };
  'contentControls.get': { input: ContentControlsGetInput; options: never; output: ContentControlInfo };
  'contentControls.listInRange': {
    input: ContentControlsListInRangeInput;
    options: never;
    output: ContentControlsListResult;
  };
  'contentControls.selectByTag': {
    input: ContentControlsSelectByTagInput;
    options: never;
    output: ContentControlsListResult;
  };
  'contentControls.selectByTitle': {
    input: ContentControlsSelectByTitleInput;
    options: never;
    output: ContentControlsListResult;
  };
  'contentControls.listChildren': {
    input: ContentControlsListChildrenInput;
    options: never;
    output: ContentControlsListResult;
  };
  'contentControls.getParent': {
    input: ContentControlsGetParentInput;
    options: never;
    output: ContentControlInfo | null;
  };
  'contentControls.wrap': {
    input: ContentControlsWrapInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  'contentControls.unwrap': {
    input: ContentControlsUnwrapInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  'contentControls.delete': {
    input: ContentControlsDeleteInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  'contentControls.copy': {
    input: ContentControlsCopyInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  'contentControls.move': {
    input: ContentControlsMoveInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  'contentControls.patch': {
    input: ContentControlsPatchInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  'contentControls.setLockMode': {
    input: ContentControlsSetLockModeInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  'contentControls.setType': {
    input: ContentControlsSetTypeInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  'contentControls.getContent': {
    input: ContentControlsGetContentInput;
    options: never;
    output: ContentControlsGetContentResult;
  };
  'contentControls.replaceContent': {
    input: ContentControlsReplaceContentInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  'contentControls.clearContent': {
    input: ContentControlsClearContentInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  'contentControls.appendContent': {
    input: ContentControlsAppendContentInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  'contentControls.prependContent': {
    input: ContentControlsPrependContentInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  'contentControls.insertBefore': {
    input: ContentControlsInsertBeforeInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  'contentControls.insertAfter': {
    input: ContentControlsInsertAfterInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  // --- contentControls.* data binding + raw ---
  'contentControls.getBinding': {
    input: ContentControlsGetBindingInput;
    options: never;
    output: ContentControlBinding | null;
  };
  'contentControls.setBinding': {
    input: ContentControlsSetBindingInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  'contentControls.clearBinding': {
    input: ContentControlsClearBindingInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  'contentControls.getRawProperties': {
    input: ContentControlsGetRawPropertiesInput;
    options: never;
    output: ContentControlsGetRawPropertiesResult;
  };
  'contentControls.patchRawProperties': {
    input: ContentControlsPatchRawPropertiesInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  'contentControls.validateWordCompatibility': {
    input: ContentControlsValidateWordCompatibilityInput;
    options: never;
    output: ContentControlsValidateWordCompatibilityResult;
  };
  'contentControls.normalizeWordCompatibility': {
    input: ContentControlsNormalizeWordCompatibilityInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  'contentControls.normalizeTagPayload': {
    input: ContentControlsNormalizeTagPayloadInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  // --- contentControls.text.* ---
  'contentControls.text.setMultiline': {
    input: ContentControlsTextSetMultilineInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  'contentControls.text.setValue': {
    input: ContentControlsTextSetValueInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  'contentControls.text.clearValue': {
    input: ContentControlsTextClearValueInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  // --- contentControls.date.* ---
  'contentControls.date.setValue': {
    input: ContentControlsDateSetValueInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  'contentControls.date.clearValue': {
    input: ContentControlsDateClearValueInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  'contentControls.date.setDisplayFormat': {
    input: ContentControlsDateSetDisplayFormatInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  'contentControls.date.setDisplayLocale': {
    input: ContentControlsDateSetDisplayLocaleInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  'contentControls.date.setStorageFormat': {
    input: ContentControlsDateSetStorageFormatInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  'contentControls.date.setCalendar': {
    input: ContentControlsDateSetCalendarInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  // --- contentControls.checkbox.* ---
  'contentControls.checkbox.getState': {
    input: ContentControlsCheckboxGetStateInput;
    options: never;
    output: ContentControlsCheckboxGetStateResult;
  };
  'contentControls.checkbox.setState': {
    input: ContentControlsCheckboxSetStateInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  'contentControls.checkbox.toggle': {
    input: ContentControlsCheckboxToggleInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  'contentControls.checkbox.setSymbolPair': {
    input: ContentControlsCheckboxSetSymbolPairInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  // --- contentControls.choiceList.* ---
  'contentControls.choiceList.getItems': {
    input: ContentControlsChoiceListGetItemsInput;
    options: never;
    output: ContentControlsChoiceListGetItemsResult;
  };
  'contentControls.choiceList.setItems': {
    input: ContentControlsChoiceListSetItemsInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  'contentControls.choiceList.setSelected': {
    input: ContentControlsChoiceListSetSelectedInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  // --- contentControls.repeatingSection.* ---
  'contentControls.repeatingSection.listItems': {
    input: ContentControlsRepeatingSectionListItemsInput;
    options: never;
    output: ContentControlsRepeatingSectionListItemsResult;
  };
  'contentControls.repeatingSection.insertItemBefore': {
    input: ContentControlsRepeatingSectionInsertItemBeforeInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  'contentControls.repeatingSection.insertItemAfter': {
    input: ContentControlsRepeatingSectionInsertItemAfterInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  'contentControls.repeatingSection.cloneItem': {
    input: ContentControlsRepeatingSectionCloneItemInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  'contentControls.repeatingSection.deleteItem': {
    input: ContentControlsRepeatingSectionDeleteItemInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  'contentControls.repeatingSection.setAllowInsertDelete': {
    input: ContentControlsRepeatingSectionSetAllowInsertDeleteInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  // --- contentControls.group.* ---
  'contentControls.group.wrap': {
    input: ContentControlsGroupWrapInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  'contentControls.group.ungroup': {
    input: ContentControlsGroupUngroupInput;
    options: MutationOptions;
    output: ContentControlMutationResult;
  };
  // --- bookmarks.* ---
  'bookmarks.list': { input: BookmarkListInput | undefined; options: never; output: BookmarksListResult };
  'bookmarks.get': { input: BookmarkGetInput; options: never; output: BookmarkInfo };
  'bookmarks.insert': { input: BookmarkInsertInput; options: MutationOptions; output: BookmarkMutationResult };
  'bookmarks.rename': { input: BookmarkRenameInput; options: MutationOptions; output: BookmarkMutationResult };
  'bookmarks.remove': { input: BookmarkRemoveInput; options: MutationOptions; output: BookmarkMutationResult };
  // --- footnotes.* ---
  'footnotes.list': { input: FootnoteListInput | undefined; options: never; output: FootnotesListResult };
  'footnotes.get': { input: FootnoteGetInput; options: never; output: FootnoteInfo };
  'footnotes.insert': { input: FootnoteInsertInput; options: MutationOptions; output: FootnoteMutationResult };
  'footnotes.update': { input: FootnoteUpdateInput; options: MutationOptions; output: FootnoteMutationResult };
  'footnotes.remove': { input: FootnoteRemoveInput; options: MutationOptions; output: FootnoteMutationResult };
  'footnotes.configure': { input: FootnoteConfigureInput; options: MutationOptions; output: FootnoteConfigResult };
  // --- clipboard.* ---
  'clipboard.parse': { input: ClipboardPayload; options: ClipboardParseOptions; output: ClipboardParseResult };
  'clipboard.insert': { input: ClipboardInsertInput; options: MutationOptions; output: ClipboardInsertResult };
  'clipboard.serializeSelection': {
    input: ClipboardSerializeInput | undefined;
    options: never;
    output: ClipboardSerializeResult;
  };
  // --- crossRefs.* ---
  'crossRefs.list': { input: CrossRefListInput | undefined; options: never; output: CrossRefsListResult };
  'crossRefs.get': { input: CrossRefGetInput; options: never; output: CrossRefInfo };
  'crossRefs.insert': { input: CrossRefInsertInput; options: MutationOptions; output: CrossRefMutationResult };
  'crossRefs.rebuild': { input: CrossRefRebuildInput; options: MutationOptions; output: CrossRefMutationResult };
  'crossRefs.remove': { input: CrossRefRemoveInput; options: MutationOptions; output: CrossRefMutationResult };
  // --- index.* ---
  'index.list': { input: IndexListInput | undefined; options: never; output: IndexListResult };
  'index.get': { input: IndexGetInput; options: never; output: IndexInfo };
  'index.insert': { input: IndexInsertInput; options: MutationOptions; output: IndexMutationResult };
  'index.configure': { input: IndexConfigureInput; options: MutationOptions; output: IndexMutationResult };
  'index.rebuild': { input: IndexRebuildInput; options: MutationOptions; output: IndexMutationResult };
  'index.remove': { input: IndexRemoveInput; options: MutationOptions; output: IndexMutationResult };
  // --- index.entries.* ---
  'index.entries.list': { input: IndexEntryListInput | undefined; options: never; output: IndexEntryListResult };
  'index.entries.get': { input: IndexEntryGetInput; options: never; output: IndexEntryInfo };
  'index.entries.insert': { input: IndexEntryInsertInput; options: MutationOptions; output: IndexEntryMutationResult };
  'index.entries.update': { input: IndexEntryUpdateInput; options: MutationOptions; output: IndexEntryMutationResult };
  'index.entries.remove': { input: IndexEntryRemoveInput; options: MutationOptions; output: IndexEntryMutationResult };
  // --- captions.* ---
  'captions.list': { input: CaptionListInput | undefined; options: never; output: CaptionsListResult };
  'captions.get': { input: CaptionGetInput; options: never; output: CaptionInfo };
  'captions.insert': { input: CaptionInsertInput; options: MutationOptions; output: CaptionMutationResult };
  'captions.update': { input: CaptionUpdateInput; options: MutationOptions; output: CaptionMutationResult };
  'captions.remove': { input: CaptionRemoveInput; options: MutationOptions; output: CaptionMutationResult };
  'captions.configure': { input: CaptionConfigureInput; options: MutationOptions; output: CaptionConfigResult };
  // --- fields.* ---
  'fields.list': { input: FieldListInput | undefined; options: never; output: FieldsListResult };
  'fields.get': { input: FieldGetInput; options: never; output: FieldInfo };
  'fields.insert': { input: FieldInsertInput; options: MutationOptions; output: FieldMutationResult };
  'fields.rebuild': { input: FieldRebuildInput; options: MutationOptions; output: FieldMutationResult };
  'fields.remove': { input: FieldRemoveInput; options: MutationOptions; output: FieldMutationResult };
  // --- citations.* ---
  'citations.list': { input: CitationListInput | undefined; options: never; output: CitationsListResult };
  'citations.get': { input: CitationGetInput; options: never; output: CitationInfo };
  'citations.insert': { input: CitationInsertInput; options: MutationOptions; output: CitationMutationResult };
  'citations.update': { input: CitationUpdateInput; options: MutationOptions; output: CitationMutationResult };
  'citations.remove': { input: CitationRemoveInput; options: MutationOptions; output: CitationMutationResult };
  // --- citations.sources.* ---
  'citations.sources.list': {
    input: CitationSourceListInput | undefined;
    options: never;
    output: CitationSourcesListResult;
  };
  'citations.sources.get': { input: CitationSourceGetInput; options: never; output: CitationSourceInfo };
  'citations.sources.insert': {
    input: CitationSourceInsertInput;
    options: MutationOptions;
    output: CitationSourceMutationResult;
  };
  'citations.sources.update': {
    input: CitationSourceUpdateInput;
    options: MutationOptions;
    output: CitationSourceMutationResult;
  };
  'citations.sources.remove': {
    input: CitationSourceRemoveInput;
    options: MutationOptions;
    output: CitationSourceMutationResult;
  };
  // --- citations.bibliography.* ---
  'citations.bibliography.get': { input: BibliographyGetInput; options: never; output: BibliographyInfo };
  'citations.bibliography.insert': {
    input: BibliographyInsertInput;
    options: MutationOptions;
    output: BibliographyMutationResult;
  };
  'citations.bibliography.rebuild': {
    input: BibliographyRebuildInput;
    options: MutationOptions;
    output: BibliographyMutationResult;
  };
  'citations.bibliography.configure': {
    input: BibliographyConfigureInput;
    options: MutationOptions;
    output: BibliographyMutationResult;
  };
  'citations.bibliography.remove': {
    input: BibliographyRemoveInput;
    options: MutationOptions;
    output: BibliographyMutationResult;
  };
  // --- authorities.* ---
  'authorities.list': { input: AuthoritiesListInput | undefined; options: never; output: AuthoritiesListResult };
  'authorities.get': { input: AuthoritiesGetInput; options: never; output: AuthoritiesInfo };
  'authorities.insert': { input: AuthoritiesInsertInput; options: MutationOptions; output: AuthoritiesMutationResult };
  'authorities.configure': {
    input: AuthoritiesConfigureInput;
    options: MutationOptions;
    output: AuthoritiesMutationResult;
  };
  'authorities.rebuild': {
    input: AuthoritiesRebuildInput;
    options: MutationOptions;
    output: AuthoritiesMutationResult;
  };
  'authorities.remove': { input: AuthoritiesRemoveInput; options: MutationOptions; output: AuthoritiesMutationResult };
  // --- authorities.entries.* ---
  'authorities.entries.list': {
    input: AuthorityEntryListInput | undefined;
    options: never;
    output: AuthorityEntryListResult;
  };
  'authorities.entries.get': { input: AuthorityEntryGetInput; options: never; output: AuthorityEntryInfo };
  'authorities.entries.insert': {
    input: AuthorityEntryInsertInput;
    options: MutationOptions;
    output: AuthorityEntryMutationResult;
  };
  'authorities.entries.update': {
    input: AuthorityEntryUpdateInput;
    options: MutationOptions;
    output: AuthorityEntryMutationResult;
  };
  'authorities.entries.remove': {
    input: AuthorityEntryRemoveInput;
    options: MutationOptions;
    output: AuthorityEntryMutationResult;
  };
  // --- diff.* ---
  'diff.capture': { input: undefined; options: never; output: DiffSnapshot };
  'diff.compare': { input: DiffCompareInput; options: never; output: DiffPayload };
  'diff.apply': { input: DiffApplyInput; options: DiffApplyOptions; output: DiffApplyResult };
  // --- export.* ---
  'export.toDocx': { input: ExportToDocxInput; options: never; output: ExportToDocxResult };
  // --- protection.* ---
  'protection.get': { input: ProtectionGetInput; options: never; output: DocumentProtectionState };
  'protection.setEditingRestriction': {
    input: SetEditingRestrictionInput;
    options: MutationOptions;
    output: ProtectionMutationResult;
  };
  'protection.clearEditingRestriction': {
    input: ClearEditingRestrictionInput;
    options: MutationOptions;
    output: ProtectionMutationResult;
  };
  // --- permissionRanges.* ---
  'permissionRanges.list': {
    input: PermissionRangesListInput | undefined;
    options: never;
    output: PermissionRangesListResult;
  };
  'permissionRanges.get': { input: PermissionRangesGetInput; options: never; output: PermissionRangeInfo };
  'permissionRanges.create': {
    input: PermissionRangesCreateInput;
    options: MutationOptions;
    output: PermissionRangeMutationResult;
  };
  'permissionRanges.remove': {
    input: PermissionRangesRemoveInput;
    options: MutationOptions;
    output: PermissionRangeRemoveResult;
  };
  'permissionRanges.updatePrincipal': {
    input: PermissionRangesUpdatePrincipalInput;
    options: MutationOptions;
    output: PermissionRangeMutationResult;
  };
  // --- customXml.parts.* ---
  'customXml.parts.list': {
    input: CustomXmlPartsListInput | undefined;
    options: never;
    output: CustomXmlPartsListResult;
  };
  'customXml.parts.get': {
    input: CustomXmlPartsGetInput;
    options: never;
    output: CustomXmlPartInfo | null;
  };
  'customXml.parts.create': {
    input: CustomXmlPartsCreateInput;
    options: MutationOptions;
    output: CustomXmlPartsCreateResult;
  };
  'customXml.parts.patch': {
    input: CustomXmlPartsPatchInput;
    options: MutationOptions;
    output: CustomXmlPartsMutationResult;
  };
  'customXml.parts.remove': {
    input: CustomXmlPartsRemoveInput;
    options: MutationOptions;
    output: CustomXmlPartsMutationResult;
  };
  // --- metadata.* (anchored metadata) ---
  'metadata.attach': {
    input: AnchoredMetadataAttachInput;
    options: MutationOptions;
    output: AnchoredMetadataAttachResult;
  };
  'metadata.list': {
    input: AnchoredMetadataListInput | undefined;
    options: never;
    output: AnchoredMetadataListResult;
  };
  'metadata.get': {
    input: AnchoredMetadataGetInput;
    options: never;
    output: AnchoredMetadataInfo | null;
  };
  'metadata.update': {
    input: AnchoredMetadataUpdateInput;
    options: MutationOptions;
    output: AnchoredMetadataMutationResult;
  };
  'metadata.remove': {
    input: AnchoredMetadataRemoveInput;
    options: MutationOptions;
    output: AnchoredMetadataMutationResult;
  };
  'metadata.resolve': {
    input: AnchoredMetadataResolveInput;
    options: never;
    output: AnchoredMetadataResolveInfo | null;
  };
}
// --- Bidirectional completeness checks ---
// If either assertion fails, the `false extends true` branch produces a compile error.
type Assert<_T extends true> = void;
/** Fails to compile if OperationRegistry is missing any OperationId key. */
type _AllOpsHaveRegistryEntry = Assert<OperationId extends keyof OperationRegistry ? true : false>;
/** Fails to compile if OperationRegistry has extra keys not in OperationId. */
type _NoExtraRegistryKeys = Assert<keyof OperationRegistry extends OperationId ? true : false>;
// --- Invoke request/result types ---
/**
 * Typed invoke request. TypeScript narrows input and options based on operationId.
 *
 * When an operation has no options (`options: never` in the registry), the
 * request shape forbids `options` via `options?: never` rather than via an
 * intersection with `Record<string, never>` (which would also forbid
 * `operationId` and `input`, making the typed overload unmatchable and
 * silently falling through to the dynamic `unknown` return).
 */
export type InvokeRequest<T extends OperationId> = OperationRegistry[T]['options'] extends never
  ? {
      operationId: T;
      input: OperationRegistry[T]['input'];
      options?: never;
    }
  : {
      operationId: T;
      input: OperationRegistry[T]['input'];
      options?: OperationRegistry[T]['options'];
    };
/**
 * Typed invoke result, narrowed by operationId.
 */
export type InvokeResult<T extends OperationId> = T extends 'mutations.preview' | 'mutations.apply'
  ? Promise<OperationRegistry[T]['output']>
  : T extends 'plan.execute'
    ? OperationRegistry[T]['output'] | Promise<OperationRegistry[T]['output']>
    : OperationRegistry[T]['output'];
/**
 * Loose invoke request for dynamic callers who don't know the operation at compile time.
 * Invalid inputs will produce adapter-level errors, not input-validation errors.
 */
export type DynamicInvokeRequest = {
  operationId: OperationId;
  input: unknown;
  options?: unknown;
};
