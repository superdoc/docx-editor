import type { BlockNodeAddress, ChangeMode, ReceiptFailure, TrackedChangeAddress } from '../types/index.js';
import type { DiscoveryOutput } from '../types/discovery.js';

export type SectionAddress = {
  kind: 'section';
  sectionId: string;
};

export type SectionTargetInput = {
  target: SectionAddress;
};

export type SectionBreakType = 'continuous' | 'nextPage' | 'evenPage' | 'oddPage';

export type SectionHeaderFooterKind = 'header' | 'footer';

/**
 * Word models odd-page variants via the default header/footer reference when
 * even/odd mode is enabled, so the API keeps this enum aligned with OOXML refs.
 */
export type SectionHeaderFooterVariant = 'default' | 'first' | 'even';

export type SectionOrientation = 'portrait' | 'landscape';

export type SectionVerticalAlign = 'top' | 'center' | 'bottom' | 'both';

export type SectionDirection = 'ltr' | 'rtl';

export type SectionLineNumberRestart = 'continuous' | 'newPage' | 'newSection';

export type SectionPageNumberingFormat =
  | 'decimal'
  | 'lowerLetter'
  | 'upperLetter'
  | 'lowerRoman'
  | 'upperRoman'
  | 'numberInDash'
  | 'hebrew1'
  | 'hebrew2';

export type SectionPageNumberingChapterSeparator = 'hyphen' | 'period' | 'colon' | 'emDash' | 'enDash';

export interface SectionPageMargins {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  gutter?: number;
}

export interface SectionHeaderFooterMargins {
  header?: number;
  footer?: number;
}

export interface SectionPageSetup {
  width?: number;
  height?: number;
  orientation?: SectionOrientation;
  paperSize?: string;
}

export interface SectionColumns {
  count?: number;
  gap?: number;
  equalWidth?: boolean;
}

export interface SectionLineNumbering {
  enabled: boolean;
  countBy?: number;
  start?: number;
  distance?: number;
  restart?: SectionLineNumberRestart;
}

export interface SectionPageNumbering {
  start?: number;
  format?: SectionPageNumberingFormat;
  chapterStyle?: number;
  chapterSeparator?: SectionPageNumberingChapterSeparator;
}

export interface SectionHeaderFooterRefs {
  default?: string;
  first?: string;
  even?: string;
}

export interface SectionBorderSpec {
  style?: string;
  size?: number;
  space?: number;
  color?: string;
  shadow?: boolean;
  frame?: boolean;
}

export interface SectionPageBorders {
  display?: 'allPages' | 'firstPage' | 'notFirstPage';
  offsetFrom?: 'page' | 'text';
  zOrder?: 'front' | 'back';
  top?: SectionBorderSpec;
  right?: SectionBorderSpec;
  bottom?: SectionBorderSpec;
  left?: SectionBorderSpec;
}

export interface SectionRangeDomain {
  startParagraphIndex: number;
  endParagraphIndex: number;
}

export interface SectionDomain {
  address: SectionAddress;
  index: number;
  range: SectionRangeDomain;
  breakType?: SectionBreakType;
  pageSetup?: SectionPageSetup;
  margins?: SectionPageMargins;
  headerFooterMargins?: SectionHeaderFooterMargins;
  columns?: SectionColumns;
  lineNumbering?: SectionLineNumbering;
  pageNumbering?: SectionPageNumbering;
  titlePage?: boolean;
  oddEvenHeadersFooters?: boolean;
  verticalAlign?: SectionVerticalAlign;
  sectionDirection?: SectionDirection;
  headerRefs?: SectionHeaderFooterRefs;
  footerRefs?: SectionHeaderFooterRefs;
  pageBorders?: SectionPageBorders;
}

export type SectionInfo = SectionDomain;

export interface SectionsListQuery {
  limit?: number;
  offset?: number;
}

export interface SectionsGetInput {
  address: SectionAddress;
}

export type SectionsListResult = DiscoveryOutput<SectionDomain>;

export interface SectionMutationSuccessResult {
  success: true;
  dryRun?: boolean;
  section: SectionAddress;
  /** Committed review-aware content mode; omitted for dry runs, no-ops and non-reviewable settings. */
  appliedChangeMode?: ChangeMode;
}

export interface SectionMutationFailureResult {
  success: false;
  failure: ReceiptFailure;
}

export type SectionMutationResult = SectionMutationSuccessResult | SectionMutationFailureResult;

/**
 * Mutation receipt for document-scoped section settings operations that do not
 * target a specific section address.
 */
export interface DocumentMutationSuccessResult {
  success: true;
  dryRun?: boolean;
  changed?: boolean;
}

export type DocumentMutationResult = DocumentMutationSuccessResult | SectionMutationFailureResult;

export interface CreateSectionBreakSuccessResult {
  success: true;
  appliedChangeMode?: 'direct' | 'tracked';
  trackedChangeRefs?: TrackedChangeAddress[];
  section: SectionAddress;
  /**
   * Present only when the break is represented as a dedicated paragraph.
   * Attached breaks omit this field because the boundary is carried by the
   * preceding paragraph's sectPr rather than a new blank block.
   */
  breakParagraph?: BlockNodeAddress;
}

export interface CreateSectionBreakFailureResult {
  success: false;
  failure: ReceiptFailure;
}

export type CreateSectionBreakResult = CreateSectionBreakSuccessResult | CreateSectionBreakFailureResult;

export type SectionBreakCreateLocation =
  | { kind: 'documentStart' }
  | { kind: 'documentEnd' }
  | { kind: 'before'; target: BlockNodeAddress }
  | { kind: 'after'; target: BlockNodeAddress };

export type SectionBreakRepresentation = 'asNewParagraph' | 'attachToPreviousParagraph';

export interface CreateSectionBreakInput {
  at?: SectionBreakCreateLocation;
  breakType?: SectionBreakType;
  pageMargins?: SectionPageMargins;
  headerFooterMargins?: SectionHeaderFooterMargins;
  /**
   * Controls how the section break materializes in OOXML.
   *
   * - `asNewParagraph` (default): emit a dedicated carrier `<w:p><w:pPr><w:sectPr/></w:pPr></w:p>` just before the existing final body section.
   * - `attachToPreviousParagraph`: inline the new `<w:sectPr>` into the previous paragraph's `<w:pPr>` so that paragraph becomes the last paragraph of the new section.
   */
  representation?: SectionBreakRepresentation;
}

export interface SectionsSetBreakTypeInput extends SectionTargetInput {
  breakType: SectionBreakType;
}

export interface SectionsSetPageMarginsInput extends SectionTargetInput {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  gutter?: number;
}

export interface SectionsSetHeaderFooterMarginsInput extends SectionTargetInput {
  header?: number;
  footer?: number;
}

export interface SectionsSetPageSetupInput extends SectionTargetInput {
  width?: number;
  height?: number;
  orientation?: SectionOrientation;
  paperSize?: string;
}

export interface SectionsSetColumnsInput extends SectionTargetInput {
  count?: number;
  gap?: number;
  equalWidth?: boolean;
}

export interface SectionsSetLineNumberingInput extends SectionTargetInput {
  enabled: boolean;
  countBy?: number;
  start?: number;
  distance?: number;
  restart?: SectionLineNumberRestart;
}

export interface SectionsSetPageNumberingInput extends SectionTargetInput {
  /** First page number of the section, or null to continue from the previous section. */
  start?: number | null;
  format?: SectionPageNumberingFormat;
  chapterStyle?: number;
  chapterSeparator?: SectionPageNumberingChapterSeparator;
}

export interface SectionsSetTitlePageInput extends SectionTargetInput {
  enabled: boolean;
}

export interface SectionsSetOddEvenHeadersFootersInput {
  enabled: boolean;
}

export interface SectionsSetVerticalAlignInput extends SectionTargetInput {
  value: SectionVerticalAlign;
}

export interface SectionsSetSectionDirectionInput extends SectionTargetInput {
  direction: SectionDirection;
}

export interface SectionsSetHeaderFooterRefInput extends SectionTargetInput {
  kind: SectionHeaderFooterKind;
  variant: SectionHeaderFooterVariant;
  refId: string;
}

export interface SectionsClearHeaderFooterRefInput extends SectionTargetInput {
  kind: SectionHeaderFooterKind;
  variant: SectionHeaderFooterVariant;
}

export interface SectionsSetLinkToPreviousInput extends SectionTargetInput {
  kind: SectionHeaderFooterKind;
  variant: SectionHeaderFooterVariant;
  linked: boolean;
}

export interface SectionsSetPageBordersInput extends SectionTargetInput {
  borders: SectionPageBorders;
}

export type SectionsClearPageBordersInput = SectionTargetInput;
