import type {
  ColumnLayout,
  ColumnRegion,
  DocumentBackground,
  DrawingBlock,
  FlowMode,
  Fragment,
  ImageBlock,
  ImageFragmentMetadata,
  Line,
  ListBlock,
  ListMeasure,
  PageMargins,
  PageNumberChapterSeparator,
  PageNumberFormat,
  ParagraphBlock,
  ParagraphBorders,
  ParagraphMeasure,
  SectionVerticalAlign,
  SectionPageBorders,
  MarkerTrackedChange,
  SourceAnchor,
  TableBlock,
  TableMeasure,
} from './index.js';
import type { LayoutSourceIdentity } from './layout-identity.js';

/** A fully resolved layout ready for the next-generation paint pipeline. */
export type ResolvedLayout = {
  /** Schema version for forward compatibility. */
  version: 1;
  /** Rendering flow mode used to produce this layout. */
  flowMode: FlowMode;
  /** Gap between pages in pixels (0 when unset). */
  pageGap: number;
  /** Pre-computed block versions for painter-side cache invalidation. */
  blockVersions?: Record<string, string>;
  /** Resolved pages with normalized dimensions. */
  pages: ResolvedPage[];
  /** Exact physical page count for each section, keyed by section index. */
  sectionPageCounts?: Readonly<Record<string, number>>;
  /** Optional document-level page background from OOXML w:background. */
  documentBackground?: DocumentBackground;
  /** Document epoch identifier from the source layout. Used for change tracking in the painter. */
  layoutEpoch?: number;
};

/** A single resolved page with stable identity and normalized dimensions. */
export type ResolvedPage = {
  /** Stable page identifier (e.g. `page-0`). */
  id: string;
  /** 0-based page index. */
  index: number;
  /**
   * Layout generation this page was resolved from (mirrors the top-level
   * `layoutEpoch`). Lets window-paint consumers prove a packet belongs to the
   * same resolve pass as the extents it is painted against (painter plan P5x).
   */
  layoutEpoch?: number;
  /** 1-based page number (from Page.number). */
  number: number;
  /** Page width in pixels (resolved from page.size?.w ?? layout.pageSize.w). */
  width: number;
  /** Page height in pixels (resolved from page.size?.h ?? layout.pageSize.h). */
  height: number;
  /** Resolved paint items for this page. */
  items: ResolvedPaintItem[];
  /**
   * Whether total-page fields may use the resolved document totals while this
   * page is painted. `false` keeps the source-cached field text because the
   * surrounding document pagination is still provisional.
   */
  pageCountFieldsExact?: boolean;
  /** Page margins from the source page. Used for ruler rendering and header/footer positioning. */
  margins?: PageMargins;
  /** Page frame resolved from the owning section. */
  pageBorders?: SectionPageBorders;
  /** Extra bottom space reserved for footnotes (px). Used for footer space calculation. */
  footnoteReserved?: number;
  /** Numeric page number after section numbering restart/offset. Used for OOXML odd/even parity. */
  displayNumber?: number;
  /** Formatted page number text (e.g. "i", "ii" for Roman numeral sections). */
  numberText?: string;
  /** Numeric page number after section page numbering settings are applied. */
  effectivePageNumber?: number;
  /** One-based physical position within the owning section. */
  sectionPageNumber?: number;
  /** Section PAGE number format before any run-local PAGE switch is applied. */
  pageNumberFormat?: PageNumberFormat;
  /** MVP chapter prefix text derived from the nearest numbered Heading N marker. */
  pageNumberChapterText?: string;
  /** Separator between chapter prefix and page number component. */
  pageNumberChapterSeparator?: PageNumberChapterSeparator;
  /** Vertical alignment of content within this page. */
  vAlign?: SectionVerticalAlign;
  /** Base section margins before header/footer inflation. Used for vAlign and decoration positioning. */
  baseMargins?: { top: number; bottom: number };
  /** 0-based index of the section this page belongs to. */
  sectionIndex?: number;
  /** Header/footer reference IDs for this page's section. */
  sectionRefs?: {
    headerRefs?: { default?: string; first?: string; even?: string; odd?: string };
    footerRefs?: { default?: string; first?: string; even?: string; odd?: string };
  };
  /** Page orientation. */
  orientation?: 'portrait' | 'landscape';
  /** Column layout configuration for this page (reflects page-start config). */
  columns?: ColumnLayout;
  /** Vertical column regions when continuous section breaks change column layout mid-page. */
  columnRegions?: ColumnRegion[];
};

/** Union of all resolved paint item kinds. */
export type ResolvedPaintItem =
  | ResolvedGroupItem
  | ResolvedFragmentItem
  | ResolvedTableItem
  | ResolvedImageItem
  | ResolvedDrawingItem;

/** A group of nested resolved paint items (for future use). */
export type ResolvedGroupItem = {
  kind: 'group';
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  children: ResolvedPaintItem[];
};

/**
 * A resolved fragment wrapper item.
 * Carries positioning and metadata needed to create the fragment's DOM wrapper.
 */
export type ResolvedFragmentItem = {
  kind: 'fragment';
  /** Stable identifier matching fragmentKey() semantics from the painter. */
  id: string;
  /** 0-based page index this item belongs to. */
  pageIndex: number;
  /** Left position in pixels. */
  x: number;
  /** Top position in pixels. */
  y: number;
  /** Width in pixels. */
  width: number;
  /** Height in pixels (computed from measure data for para/list-item). */
  height: number;
  /** Stacking order for anchored images/drawings. */
  zIndex?: number;
  /** Source fragment kind — used by the painter for wrapper style decisions. */
  fragmentKind: Fragment['kind'];
  /** Source fragment back-pointer. Lets the painter iterate resolved items
   *  and pass the underlying fragment to render helpers without indexing
   *  back into the legacy `page.fragments` array. */
  fragment: Fragment;
  /** Block ID. Written to data-block-id. */
  blockId: string;
  fragmentIndex: number;
  /** ProseMirror start position for click-to-position mapping. */
  pmStart?: number;
  /** ProseMirror end position for click-to-position mapping. */
  pmEnd?: number;
  /** Whether this fragment continues from a previous page. */
  continuesFromPrev?: boolean;
  /** Whether this fragment continues on the next page. */
  continuesOnNext?: boolean;
  /** List marker box width in pixels (para/list-item only). */
  markerWidth?: number;
  /** Pre-resolved paragraph content for non-table paragraph fragments. */
  content?: ResolvedParagraphContent;
  /** Pre-computed SDT container key for boundary grouping (`structuredContent:<id>` or `documentSection:<id>`). */
  sdtContainerKey?: string | null;
  /** Pre-computed hash of paragraph borders for between-border grouping. */
  paragraphBorderHash?: string;
  /** Pre-extracted paragraph borders for between-border rendering. */
  paragraphBorders?: ParagraphBorders;
  /** Pre-computed visual/layout signature (blockVersion + fragment-specific data). */
  version?: string;
  /** Pre-computed source/evidence metadata signature. Does not imply visual/layout geometry changed. */
  evidenceVersion?: string;
  /** Combined paint reuse signature. DomPainter uses this to refresh source-linked DOM metadata. */
  paintCacheVersion?: string;
  /**
   * Interior-pm signature (painter plan P5): hash of the block's run pm
   * offsets RELATIVE to the block's first pm position. Stamps are pm-free by
   * design, so uniform pm drift keeps them equal — this key is how the
   * painter's window remap tier proves the drift is UNIFORM (equal key +
   * equal fragment span length) before shifting reused DOM in place; any
   * interior redistribution changes it and forces a rebuild.
   */
  pmInteriorVersion?: string;
  /** Pre-extracted block for paragraph (ParagraphBlock) or list-item (ListBlock) fragments. */
  block?: ParagraphBlock | ListBlock;
  /** Pre-extracted measure for paragraph (ParagraphMeasure) or list-item (ListMeasure) fragments. */
  measure?: ParagraphMeasure | ListMeasure;
  /** Optional DOCX source evidence preserved for intelligence adapters and paint snapshots. */
  sourceAnchor?: SourceAnchor;
  /**
   * Optional editor-neutral identity (prep-001). Mirrors the field on the
   * underlying `Fragment`; carried through resolve so the painter can stamp
   * neutral `data-layout-*` datasets without re-deriving from PM positions.
   */
  layoutSourceIdentity?: LayoutSourceIdentity;
};

/** Resolved paragraph content for non-table paragraph/list-item fragments. */
export type ResolvedParagraphContent = {
  /** The lines to render, with all layout data pre-resolved. */
  lines: ResolvedTextLineItem[];
  /** Drop cap rendering data. Only present on first fragment of a paragraph with a drop cap. */
  dropCap?: ResolvedDropCapItem;
  /** List marker rendering data. Only present on first fragment of a list paragraph. */
  marker?: ResolvedListMarkerItem;
  /** Whether this fragment continues from a previous page. */
  continuesFromPrev?: boolean;
  /** Whether this fragment continues on the next page. */
  continuesOnNext?: boolean;
  /** Whether the source paragraph ends with a lineBreak run. */
  paragraphEndsWithLineBreak?: boolean;
};

/** A single resolved text line with pre-computed rendering geometry. */
export type ResolvedTextLineItem = {
  /** The source Line data (segments, leaders, bars, dimensions, run indices). */
  line: Line;
  /** Global line index within the paragraph (fragment.fromLine + localIndex). */
  lineIndex: number;
  /** Pre-computed available width for justify calculations. */
  availableWidth: number;
  /** Whether to skip justification for this line (last line of paragraph). */
  skipJustify: boolean;
  /** Pre-computed CSS paddingLeft in pixels. */
  paddingLeftPx: number;
  /** Pre-computed CSS paddingRight in pixels. */
  paddingRightPx: number;
  /** Pre-computed CSS textIndent in pixels (0 when not applicable). */
  textIndentPx: number;
  /** Whether this is a list first line (indent handled by marker, not CSS). */
  isListFirstLine: boolean;
  /** Resolved text-start position for list first lines with explicit segment positioning. */
  resolvedListTextStartPx?: number;
  /** Whether this line has explicit segment positioning (tabs). */
  hasExplicitSegmentPositioning: boolean;
  /** Pre-computed indent offset for the segment positioning path in renderLine. */
  indentOffset: number;
};

/** Resolved drop cap rendering data. */
export type ResolvedDropCapItem = {
  /** Drop cap text content. */
  text: string;
  /** Drop cap mode. */
  mode: 'drop' | 'margin';
  /** Font family. */
  fontFamily: string;
  /** Font size in pixels. */
  fontSize: number;
  /** Bold styling. */
  bold?: boolean;
  /** Italic styling. */
  italic?: boolean;
  /** Text color. */
  color?: string;
  /** Vertical position offset in pixels. */
  position?: number;
  /** Measured width in pixels. */
  width?: number;
  /** Measured height in pixels. */
  height?: number;
};

// ============================================================================
// Kind-specific resolved items (PR7: table, image, drawing)
// ============================================================================

/**
 * A resolved table fragment with pre-extracted block/measure data.
 * Replaces blockLookup.get() in the table render path.
 */
export type ResolvedTableItem = {
  kind: 'fragment';
  /** Discriminant for table fragments. */
  fragmentKind: 'table';
  /** Stable identifier matching fragmentKey() semantics from the painter. */
  id: string;
  /** 0-based page index this item belongs to. */
  pageIndex: number;
  /** Left position in pixels. */
  x: number;
  /** Top position in pixels. */
  y: number;
  /** Width in pixels. */
  width: number;
  /** Height in pixels (from fragment.height). */
  height: number;
  /** Stacking order (tables typically don't have zIndex at fragment level). */
  zIndex?: number;
  /** Block ID — written to data-block-id. */
  blockId: string;
  fragmentIndex: number;
  /** Source TableFragment back-pointer (see ResolvedFragmentItem.fragment). */
  fragment: Fragment;
  /** ProseMirror start position for click-to-position mapping. */
  pmStart?: number;
  /** ProseMirror end position for click-to-position mapping. */
  pmEnd?: number;
  /** Whether this table fragment continues from a previous page. */
  continuesFromPrev?: boolean;
  /** Whether this table fragment continues on the next page. */
  continuesOnNext?: boolean;
  /** Pre-extracted TableBlock (replaces blockLookup.get()). */
  block: TableBlock;
  /** Pre-extracted TableMeasure (replaces blockLookup.get()). */
  measure: TableMeasure;
  /** Pre-computed cell spacing: measure.cellSpacingPx ?? getCellSpacingPx(block.attrs?.cellSpacing). */
  cellSpacingPx: number;
  /** Pre-computed effective column widths: fragment.columnWidths ?? measure.columnWidths. */
  effectiveColumnWidths: number[];
  /** Pre-computed SDT container key for boundary grouping (`structuredContent:<id>` or `documentSection:<id>`). */
  sdtContainerKey?: string | null;
  /** Pre-computed visual/layout signature (blockVersion + fragment-specific data). */
  version?: string;
  /** Pre-computed source/evidence metadata signature. Does not imply visual/layout geometry changed. */
  evidenceVersion?: string;
  /** Combined paint reuse signature. DomPainter uses this to refresh source-linked DOM metadata. */
  paintCacheVersion?: string;
  /**
   * Interior-pm signature (painter plan P5): hash of the block's run pm
   * offsets RELATIVE to the block's first pm position. Stamps are pm-free by
   * design, so uniform pm drift keeps them equal — this key is how the
   * painter's window remap tier proves the drift is UNIFORM (equal key +
   * equal fragment span length) before shifting reused DOM in place; any
   * interior redistribution changes it and forces a rebuild.
   */
  pmInteriorVersion?: string;
  /** Optional DOCX source evidence preserved for intelligence adapters and paint snapshots. */
  sourceAnchor?: SourceAnchor;
  /**
   * Optional editor-neutral identity (prep-001). Mirrors the field on the
   * underlying `Fragment`; carried through resolve so the painter can stamp
   * neutral `data-layout-*` datasets without re-deriving from PM positions.
   */
  layoutSourceIdentity?: LayoutSourceIdentity;
};

/**
 * A resolved image fragment with pre-extracted block data.
 * Replaces blockLookup.get() in the image render path.
 */
export type ResolvedImageItem = {
  kind: 'fragment';
  /** Discriminant for image fragments. */
  fragmentKind: 'image';
  /** Stable identifier matching fragmentKey() semantics from the painter. */
  id: string;
  /** 0-based page index this item belongs to. */
  pageIndex: number;
  /** Left position in pixels. */
  x: number;
  /** Top position in pixels. */
  y: number;
  /** Width in pixels. */
  width: number;
  /** Height in pixels. */
  height: number;
  /** Stacking order for anchored images. */
  zIndex?: number;
  /** Block ID — written to data-block-id. */
  blockId: string;
  fragmentIndex: number;
  /** Source ImageFragment back-pointer (see ResolvedFragmentItem.fragment). */
  fragment: Fragment;
  /** ProseMirror start position for click-to-position mapping. */
  pmStart?: number;
  /** ProseMirror end position for click-to-position mapping. */
  pmEnd?: number;
  /** Pre-extracted ImageBlock (replaces blockLookup.get()). */
  block: ImageBlock;
  /** Image metadata for interactive resizing (original dimensions, aspect ratio). */
  metadata?: ImageFragmentMetadata;
  /** Pre-computed SDT container key for boundary grouping (typically null for images). */
  sdtContainerKey?: string | null;
  /** Pre-computed visual/layout signature (blockVersion + fragment-specific data). */
  version?: string;
  /** Pre-computed source/evidence metadata signature. Does not imply visual/layout geometry changed. */
  evidenceVersion?: string;
  /** Combined paint reuse signature. DomPainter uses this to refresh source-linked DOM metadata. */
  paintCacheVersion?: string;
  /**
   * Interior-pm signature (painter plan P5): hash of the block's run pm
   * offsets RELATIVE to the block's first pm position. Stamps are pm-free by
   * design, so uniform pm drift keeps them equal — this key is how the
   * painter's window remap tier proves the drift is UNIFORM (equal key +
   * equal fragment span length) before shifting reused DOM in place; any
   * interior redistribution changes it and forces a rebuild.
   */
  pmInteriorVersion?: string;
  /** Optional DOCX source evidence preserved for intelligence adapters and paint snapshots. */
  sourceAnchor?: SourceAnchor;
  /**
   * Optional editor-neutral identity (prep-001). Mirrors the field on the
   * underlying `Fragment`; carried through resolve so the painter can stamp
   * neutral `data-layout-*` datasets without re-deriving from PM positions.
   */
  layoutSourceIdentity?: LayoutSourceIdentity;
};

/**
 * A resolved drawing fragment with pre-extracted block data.
 * Replaces blockLookup.get() in the drawing render path.
 */
export type ResolvedDrawingItem = {
  kind: 'fragment';
  /** Discriminant for drawing fragments. */
  fragmentKind: 'drawing';
  /** Stable identifier matching fragmentKey() semantics from the painter. */
  id: string;
  /** 0-based page index this item belongs to. */
  pageIndex: number;
  /** Left position in pixels. */
  x: number;
  /** Top position in pixels. */
  y: number;
  /** Width in pixels. */
  width: number;
  /** Height in pixels. */
  height: number;
  /** Stacking order for anchored drawings. */
  zIndex?: number;
  /** Block ID — written to data-block-id. */
  blockId: string;
  fragmentIndex: number;
  /** Source DrawingFragment back-pointer (see ResolvedFragmentItem.fragment). */
  fragment: Fragment;
  /** ProseMirror start position for click-to-position mapping. */
  pmStart?: number;
  /** ProseMirror end position for click-to-position mapping. */
  pmEnd?: number;
  /** Pre-extracted DrawingBlock (replaces blockLookup.get()). */
  block: DrawingBlock;
  /** Pre-computed SDT container key for boundary grouping (typically null for drawings). */
  sdtContainerKey?: string | null;
  /** Pre-computed visual/layout signature (blockVersion + fragment-specific data). */
  version?: string;
  /** Pre-computed source/evidence metadata signature. Does not imply visual/layout geometry changed. */
  evidenceVersion?: string;
  /** Combined paint reuse signature. DomPainter uses this to refresh source-linked DOM metadata. */
  paintCacheVersion?: string;
  /**
   * Interior-pm signature (painter plan P5): hash of the block's run pm
   * offsets RELATIVE to the block's first pm position. Stamps are pm-free by
   * design, so uniform pm drift keeps them equal — this key is how the
   * painter's window remap tier proves the drift is UNIFORM (equal key +
   * equal fragment span length) before shifting reused DOM in place; any
   * interior redistribution changes it and forces a rebuild.
   */
  pmInteriorVersion?: string;
  /** Optional DOCX source evidence preserved for intelligence adapters and paint snapshots. */
  sourceAnchor?: SourceAnchor;
  /**
   * Optional editor-neutral identity (prep-001). Mirrors the field on the
   * underlying `Fragment`; carried through resolve so the painter can stamp
   * neutral `data-layout-*` datasets without re-deriving from PM positions.
   */
  layoutSourceIdentity?: LayoutSourceIdentity;
};

/** Type guard: checks whether a resolved paint item is a ResolvedTableItem. */
export function isResolvedTableItem(item: ResolvedPaintItem): item is ResolvedTableItem {
  return item.kind === 'fragment' && 'fragmentKind' in item && item.fragmentKind === 'table' && 'measure' in item;
}

/** Type guard: checks whether a resolved paint item is a ResolvedImageItem. */
export function isResolvedImageItem(item: ResolvedPaintItem): item is ResolvedImageItem {
  return item.kind === 'fragment' && 'fragmentKind' in item && item.fragmentKind === 'image' && 'block' in item;
}

/** Type guard: checks whether a resolved paint item is a ResolvedDrawingItem. */
export function isResolvedDrawingItem(item: ResolvedPaintItem): item is ResolvedDrawingItem {
  return item.kind === 'fragment' && 'fragmentKind' in item && item.fragmentKind === 'drawing' && 'block' in item;
}

/** A resolved header/footer page — mirrors HeaderFooterPage but with resolved items. */
export type ResolvedHeaderFooterPage = {
  number: number;
  /** Page-local measurement height; see `HeaderFooterPage.measurementHeight`. */
  measurementHeight?: number;
  minY?: number;
  maxY?: number;
  renderHeight?: number;
  numberText?: string;
  /** Section-aware numeric page value before formatting. */
  displayNumber?: number;
  /** Section PAGE number format before any run-local PAGE switch is applied. */
  pageNumberFormat?: PageNumberFormat;
  /** MVP chapter prefix text derived from the nearest numbered Heading N marker. */
  pageNumberChapterText?: string;
  /** Separator between chapter prefix and page number component. */
  pageNumberChapterSeparator?: PageNumberChapterSeparator;
  items: ResolvedPaintItem[];
};

/** A resolved header/footer layout — mirrors HeaderFooterLayout but with resolved pages. */
export type ResolvedHeaderFooterLayout = {
  height: number;
  minY?: number;
  maxY?: number;
  renderHeight?: number;
  pages: ResolvedHeaderFooterPage[];
};

/** Resolved list marker rendering data with pre-computed positioning. */
export type ResolvedListMarkerItem = {
  textStartPx?: number;
  /** Marker text content (e.g., "1.", "a)", bullet). */
  text: string;
  /** Horizontal justification. */
  justification: 'left' | 'right' | 'center';
  /** Suffix type after marker. */
  suffix: 'tab' | 'space' | 'nothing';
  /** Whether marker should be hidden (vanish property). */
  vanish?: boolean;
  /** Pre-computed left position of marker container in pixels. */
  markerStartPx: number;
  /** Pre-computed tab/space suffix width in pixels. */
  suffixWidthPx: number;
  /** CSS paddingLeft for the first line when marker is present. */
  firstLinePaddingLeftPx: number;
  /** Extra padding adjustment for center-justified markers. */
  centerPaddingAdjustPx?: number;
  /** Marker run styling. */
  run: {
    fontFamily: string;
    fontSize: number;
    bold?: boolean;
    italic?: boolean;
    color?: string;
    letterSpacing?: number;
    /**
     * SD-2656: caps marks from the level rPr ( w:caps / w:smallCaps ). When
     * `allCaps` is true the painter applies CSS text-transform: uppercase to
     * the marker text — matching Word's legal/contract list rendering
     * ("FIRST:", "SECOND:", "THIRD:") for `ordinalText` numbering.
     */
    allCaps?: boolean;
    smallCaps?: boolean;
  };
  /** Optional DOCX source evidence for list-marker observations. */
  sourceAnchor?: SourceAnchor;
  /**
   * Optional tracked-change review metadata for the marker glyph (Plan 5).
   * Present only when the marker is affected by a guide-relevant tracked change;
   * absent for normal markers so existing rendering is unchanged.
   */
  trackedChange?: MarkerTrackedChange;
};
