import type { FloatingObjectManager } from './floating-objects';
import type { PageState } from './paginator';
import { coupledFootnoteBodyBottom, type FootnotePageFlow } from './footnote-page-flow';
import type {
  PageMargins,
  ParagraphBlock,
  ParagraphMeasure,
  Line,
  ParaFragment,
  ImageBlock,
  ImageMeasure,
  ImageFragment,
  ImageFragmentMetadata,
  DrawingBlock,
  DrawingMeasure,
  DrawingFragment,
  Fragment,
  ParagraphBorders,
  TableAnchor,
  TableWrap,
  ParagraphLineRegion,
  ColumnLayoutForAnchor,
} from '@superdoc/contracts';
import {
  computeFragmentPmRange,
  findLineIndexForRunOrdinal,
  normalizeLines,
  extractBlockPmRange,
  isEmptyTextParagraph,
  shouldSuppressOwnSpacing,
  collapseSpacingBefore,
  rewindPreviousParagraphTrailing,
  computeParagraphLayoutStartY,
} from './layout-utils.js';
import { resolveTextboxContentMeasures } from './layout-textbox.js';
import {
  resolveAnchoredGraphicY,
  resolveAnchoredGraphicX,
  getFragmentZIndex,
  isPositionedParagraphFrame,
} from '@superdoc/contracts';
import { createAnchoredTableFragment, isAnchoredTableFullWidth } from './layout-table.js';
import type { AnchoredTable } from './anchors.js';

/** Points → CSS pixels (96 dpi / 72 pt-per-inch). */
const PX_PER_PT = 96 / 72;

/** FP tolerance when comparing a measure's constraint width against the active column width. */
const REMEASURE_WIDTH_EPSILON_PX = 0.5;

const spacingDebugEnabled = false;

/** Line-scoped tblpY (form field beside label on the same line). */
function isLineScopedTblpY(firstLineHeight: number, offsetV: number): boolean {
  if (firstLineHeight <= 0) return offsetV <= 1;
  return offsetV <= firstLineHeight * 1.5;
}

/** Vertically center a tall single-line form field with its anchor line (Word line-scoped tblpY). */
function anchorForLineScopedFormField(
  anchor: TableAnchor | undefined,
  tableHeight: number,
  firstLineHeight: number,
  layoutOffsetV?: number,
  lineScopedOnAnchor = false,
  wrapType: TableWrap['type'] | undefined = 'None',
): TableAnchor | undefined {
  if (!anchor) return anchor;
  if ((anchor.vRelativeFrom ?? 'paragraph') !== 'paragraph') return anchor;
  if (wrapType !== 'None') return anchor;
  if (!lineScopedOnAnchor) return anchor;
  const offsetV = layoutOffsetV ?? anchor.offsetV ?? 0;
  if (anchor.alignV || firstLineHeight <= 0 || tableHeight <= firstLineHeight) return anchor;
  if (!isLineScopedTblpY(firstLineHeight, offsetV)) return anchor;
  return { ...anchor, vRelativeFrom: 'paragraph', alignV: 'center', offsetV: 0 };
}

type GraphicPlacementAnchorY = Parameters<typeof resolveAnchoredGraphicY>[0]['anchor'];

function graphicAnchorY(anchor: TableAnchor | undefined): GraphicPlacementAnchorY {
  if (!anchor) return undefined;
  const alignV = anchor.alignV;
  const mappedAlignV =
    alignV === 'top' || alignV === 'center' || alignV === 'bottom' || alignV === 'inside' || alignV === 'outside'
      ? alignV
      : undefined;
  return { vRelativeFrom: anchor.vRelativeFrom, alignV: mappedAlignV, offsetV: anchor.offsetV };
}

function graphicAnchorH(anchor: TableAnchor): Parameters<typeof resolveAnchoredGraphicX>[0] {
  const alignH = anchor.alignH;
  const mappedAlignH =
    alignH === 'left' || alignH === 'center' || alignH === 'right' || alignH === 'inside' || alignH === 'outside'
      ? alignH
      : undefined;
  return {
    hRelativeFrom: anchor.hRelativeFrom,
    alignH: mappedAlignH,
    offsetH: anchor.offsetH,
  };
}

/**
 * SD-2656: ordered footnote anchor entry. The body slicer reads the candidate
 * anchors for a given PM range and pushes them onto `PageState.footnoteAnchorsThisPage`
 * after committing the slice; the demand formula consumes the resulting list.
 */
export type FootnoteAnchorRef = {
  pmPos: number;
  /** Exact run in this paragraph; absent for legacy or containing-table anchors. */
  runOrdinal?: number;
  refId: string;
  fullHeight: number;
  firstLineHeight: number;
};

/**
 * Type definition for Word layout attributes attached to paragraph blocks.
 * This is a subset of the WordParagraphLayoutOutput from @superdoc/word-layout.
 */
type WordLayoutAttrs = {
  /** List marker layout information */
  marker?: {
    /** Width of the marker box in pixels */
    markerBoxWidthPx?: number;
  };
  /**
   * True when list uses firstLine indent pattern (marker at left+firstLine)
   * instead of standard hanging pattern (marker at left-hanging).
   */
  firstLineIndentMode?: boolean;
  /** Horizontal position where paragraph text begins in pixels */
  textStartPx?: number;
};

/**
 * Type definition for paragraph spacing attributes.
 * Represents spacing values in pixels for paragraph layout.
 */
type ParagraphSpacingAttrs = {
  /** Spacing before the paragraph in pixels */
  before?: number;
  /** Spacing after the paragraph in pixels */
  after?: number;
  /** Legacy property for spacing before */
  lineSpaceBefore?: number;
  /** Legacy property for spacing after */
  lineSpaceAfter?: number;
};

/**
 * Type definition for paragraph block attributes accessed during layout.
 * Provides type-safe access to common paragraph properties.
 */
type ParagraphBlockAttrs = {
  /** Spacing configuration for the paragraph */
  spacing?: ParagraphSpacingAttrs;
  /** Tracks which spacing properties were explicitly set on the paragraph */
  spacingExplicit?: {
    before?: boolean;
    after?: boolean;
    line?: boolean;
  };
  /** Style identifier for the paragraph */
  styleId?: string;
  /** Whether to suppress spacing between same-style paragraphs */
  contextualSpacing?: boolean | string | number;
  /** Word layout output for list paragraphs */
  wordLayout?: WordLayoutAttrs;
  /** Frame positioning attributes */
  frame?: {
    wrap?: string;
    x?: number;
    y?: number;
    xAlign?: 'left' | 'right' | 'center';
  };
  /** Float alignment (left, right, center) */
  floatAlignment?: unknown;
  /** Keep all lines of the paragraph on the same page */
  keepLines?: boolean;
  /** Prevent a single first or last line from appearing alone on a page (default: true). */
  widowControl?: boolean;
  /** Border attributes for the paragraph */
  borders?: ParagraphBorders;
};

const spacingDebugLog = (..._args: unknown[]): void => {
  if (!spacingDebugEnabled) return;
};

/**
 * Type guard to safely access paragraph block attributes.
 * Validates that the attrs property exists and returns it with proper typing.
 *
 * @param block - The paragraph block to extract attributes from
 * @returns Typed paragraph attributes or undefined if attrs is missing
 */
const getParagraphAttrs = (block: ParagraphBlock): ParagraphBlockAttrs | undefined => {
  if (!block.attrs || typeof block.attrs !== 'object') {
    return undefined;
  }
  return block.attrs as ParagraphBlockAttrs;
};

/**
 * Safely extracts a string value from an unknown type.
 * Used for extracting styleId and similar string properties.
 *
 * @param value - The value to extract
 * @returns The value as a string, or undefined if not a string
 */
const asString = (value: unknown): string | undefined => {
  return typeof value === 'string' ? value : undefined;
};

/**
 * Safely extracts a boolean value from OOXML boolean representations.
 * Handles true, 1, '1', 'true', 'on' as truthy values.
 *
 * @param value - The value to convert to boolean
 * @returns Boolean value, or false if value is falsy or invalid
 */
const asBoolean = (value: unknown): boolean => {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'on';
  }
  return false;
};

/**
 * Safely extracts a finite numeric value, returning 0 for invalid values.
 * Validates that the number is finite (not NaN, Infinity, or -Infinity) and non-negative.
 *
 * @param value - The value to extract and validate
 * @returns A finite non-negative number, or 0 if value is invalid
 *
 * @example
 * ```typescript
 * asSafeNumber(15)        // 15
 * asSafeNumber(NaN)       // 0
 * asSafeNumber(Infinity)  // 0
 * asSafeNumber(-10)       // 0
 * asSafeNumber(null)      // 0
 * ```
 */
const asSafeNumber = (value: unknown): number => {
  if (typeof value !== 'number') {
    return 0;
  }
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
};

/**
 * Simple hash of paragraph borders for between-border group detection.
 * Two paragraphs form a group when their border hashes match (ECMA-376 §17.3.1.5).
 */
const hashBorders = (borders?: ParagraphBorders): string | undefined => {
  if (!borders) return undefined;
  const side = (b?: { style?: string; width?: number; color?: string; space?: number }) =>
    b ? `${b.style ?? ''},${b.width ?? 0},${b.color ?? ''},${b.space ?? 0}` : '';
  return `${side(borders.top)}|${side(borders.right)}|${side(borders.bottom)}|${side(borders.left)}|${side(borders.between)}`;
};

/**
 * Computes the vertical border expansion for a paragraph fragment.
 * The border's `space` attribute (in points) plus the border width extends
 * the visual box beyond the content area. This ensures cursorY accounts
 * for the full visual height when paragraphs have borders with space.
 */
const computeBorderVerticalExpansion = (borders?: ParagraphBorders): { top: number; bottom: number } => {
  if (!borders) return { top: 0, bottom: 0 };

  // Top border: space (pts) + width (px)
  const topSpace = (borders.top?.space ?? 0) * PX_PER_PT;
  const topWidth = borders.top?.width ?? 0;
  const top = topSpace + topWidth;

  // Bottom border: space (pts) + width (px)
  const bottomSpace = (borders.bottom?.space ?? 0) * PX_PER_PT;
  const bottomWidth = borders.bottom?.width ?? 0;
  const bottom = bottomSpace + bottomWidth;

  return { top, bottom };
};

/**
 * Calculates the first line indent for list markers when remeasuring paragraphs.
 *
 * In Word layout, there are two distinct list marker layout patterns:
 *
 * 1. **firstLineIndentMode** (marker inline with text):
 *    - The marker is positioned at `left + firstLine` and consumes horizontal space on the first line
 *    - Text begins after the marker (at `textStartPx`)
 *    - The first line's available width must account for the marker's width
 *    - This pattern is indicated by `firstLineIndentMode === true`
 *
 * 2. **Standard hanging indent** (marker in hanging area):
 *    - The marker is positioned absolutely in the hanging region at `left - hanging`
 *    - The marker does NOT consume horizontal space from the text flow
 *    - Text begins at `left` on ALL lines (first and subsequent)
 *    - The first line's available width is the same as subsequent lines
 *    - This is the default pattern when `firstLineIndentMode` is not set
 *
 * This function determines which pattern is in use and calculates the appropriate
 * first line indent for the remeasurement operation.
 *
 * @param block - The paragraph block being remeasured
 * @param measure - The current paragraph measurement (may contain marker measurements)
 * @returns The first line indent in pixels. Returns 0 for standard hanging indent,
 *   or the marker width + gutter width for firstLineIndentMode.
 *
 * @example
 * ```typescript
 * // Standard hanging indent - marker doesn't consume first line space
 * const block1 = {
 *   attrs: {
 *     wordLayout: {
 *       marker: { markerBoxWidthPx: 20 },
 *       // firstLineIndentMode is NOT set
 *     }
 *   }
 * };
 * const indent1 = calculateFirstLineIndent(block1, measure);
 * // Returns: 0 (marker is in hanging area)
 *
 * // firstLineIndentMode - marker consumes first line space
 * const block2 = {
 *   attrs: {
 *     wordLayout: {
 *       marker: { markerBoxWidthPx: 20 },
 *       firstLineIndentMode: true
 *     }
 *   }
 * };
 * const indent2 = calculateFirstLineIndent(block2, measure);
 * // Returns: markerWidth + gutterWidth (marker is inline)
 * ```
 */
function calculateFirstLineIndent(block: ParagraphBlock, measure: ParagraphMeasure): number {
  const wordLayout = block.attrs?.wordLayout as WordLayoutAttrs | undefined;

  // Only apply first line indent in firstLineIndentMode
  if (!wordLayout?.firstLineIndentMode) {
    return 0;
  }

  // Ensure marker exists in both wordLayout and measure
  if (!wordLayout.marker || !measure.marker) {
    return 0;
  }

  // Extract marker width with fallback chain and validation
  const markerWidthRaw = measure.marker.markerWidth ?? wordLayout.marker.markerBoxWidthPx ?? 0;
  const markerWidth = Number.isFinite(markerWidthRaw) && markerWidthRaw >= 0 ? markerWidthRaw : 0;

  // Extract gutter width with validation
  const gutterWidthRaw = measure.marker.gutterWidth ?? 0;
  const gutterWidth = Number.isFinite(gutterWidthRaw) && gutterWidthRaw >= 0 ? gutterWidthRaw : 0;

  return markerWidth + gutterWidth;
}

export type ParagraphLayoutContext = {
  incomingFootnoteDemand?: FootnotePageFlow['incomingDemand'];
  block: ParagraphBlock;
  measure: ParagraphMeasure;
  columnWidth: number;
  ensurePage: () => PageState;
  advanceColumn: (state: PageState) => PageState;
  columnX: (state: PageState, columnIndex?: number) => number;
  floatManager: FloatingObjectManager;
  remeasureParagraph?: (
    block: ParagraphBlock,
    maxWidth: number,
    firstLineIndent?: number,
    lineRegions?: readonly (readonly ParagraphLineRegion[])[],
  ) => ParagraphMeasure;
  /**
   * Override the paragraph's spacing-after value. Used when contextual spacing
   * should suppress spacing between this paragraph and the next (same-style) paragraph.
   * When undefined, uses the value from block.attrs.spacing.after.
   */
  overrideSpacingAfter?: number;
  /**
   * SD-3049 / SD-2656: footnote demand under the ordered-cluster rule.
   *
   *   demand = sum(fullHeight of cluster[0..N-1]) + firstLineHeight(cluster[N-1])
   *
   * where `cluster` is the ordered list of footnote anchors on the page. The
   * caller passes the already-committed anchors (from PageState) plus the
   * candidate range; this returns the demand assuming the candidate range is
   * appended to the page's cluster.
   *
   * With no committed list, the in-range anchors are treated as the full
   * cluster. With no range, returns the whole-block demand.
   */
  getFootnoteDemandForBlockId?: (
    blockId: string,
    pmStart?: number,
    pmEnd?: number,
    committed?: ReadonlyArray<FootnoteAnchorRef>,
  ) => number;

  /**
   * SD-2656: returns the ordered anchor entries in `[pmStart, pmEnd]` so the
   * slicer can push them onto PageState after accepting a candidate line.
   */
  getFootnoteAnchorsForBlockId?: (
    blockId: string,
    pmStart?: number,
    pmEnd?: number,
  ) => ReadonlyArray<FootnoteAnchorRef>;

  /**
   * SD-2656: companion to getFootnoteDemandForBlockId — returns the number
   * of footnote refs anchored in a given PM range of this block. Used to
   * compute band overhead (separator + per-extra-ref gap + safety margin)
   * for the candidate slice.
   */
  getFootnoteRefCountForBlockId?: (blockId: string, pmStart?: number, pmEnd?: number) => number;

  /**
   * SD-2656: per-page footnote-band overhead in pixels for a given number of
   * anchored refs. The slicer's `effectiveBottom` budget must match the
   * planner's, otherwise body packs onto a page whose band cannot fit the
   * refs. Source of truth lives in the planner (incrementalLayout.ts) and
   * derives from `topPadding + dividerHeight + separatorSpacingBefore +
   * (refs-1)*gap`. When not provided, the slicer falls back to a default
   * formula that matches the planner's default values.
   */
  getFootnoteBandOverhead?: (refsTotal: number) => number;
  /**
   * True when this paragraph exists only as a split line-break carrier for an
   * anchored sibling from the same source paragraph. The paragraph must remain
   * anchorable, but it must not emit its own visible fragment or consume
   * vertical layout height.
   */
  layoutOnlyAnchorCarrier?: boolean;
  /**
   * Keep positioned objects on the page that owns this zero-height carrier.
   * A carrier immediately before a forcing sectPr belongs to the preceding
   * section; moving its object for page-fit would insert an extra page before
   * the section break and detach it from its authored paragraph anchor.
   */
  preserveAnchorCarrierPage?: boolean;
  /**
   * True when a split line-break carrier carries paragraph spacing that should
   * remain in the flow. The carrier reserves one line plus spacing instead of
   * using the standalone line-break measure, which would double-count the soft
   * break after the paragraph was split around the anchored sibling.
   */
  collapseSplitLineBreakCarrier?: boolean;
  /** Whether a wrap=around positioned frame advances the surrounding story flow. */
  positionedFrameAffectsFlow?: boolean;
};

export type AnchoredDrawingEntry = {
  block: ImageBlock | DrawingBlock;
  measure: ImageMeasure | DrawingMeasure;
};

export type ParagraphAnchorsContext = {
  anchoredDrawings?: AnchoredDrawingEntry[];
  anchoredTables?: AnchoredTable[];
  columnWidth: number;
  pageWidth: number;
  pageMargins: PageMargins;
  // Carries the resolved column layout through to resolveAnchoredGraphicX, direction included: a
  // column-relative anchor in an RTL section resolves against the mirrored geometry.
  columns: ColumnLayoutForAnchor;
  placedAnchoredIds: Set<string>;
};

const ANCHORED_DRAWING_PAGE_FIT_EPSILON_PX = 0.01;

function shouldAdvanceForParagraphRelativeDrawing(
  entries: AnchoredDrawingEntry[] | undefined,
  state: PageState,
  explicitParagraphAnchorY: number,
  legacyParagraphAnchorY: number,
  firstLineHeight: number,
  pageBottomMargin: number,
): boolean {
  if (!entries?.length || state.cursorY <= state.topMargin) return false;

  const contentHeight = Math.max(0, state.contentBottom - state.topMargin);
  return entries.some((entry) => {
    const anchor = entry.block.anchor;
    const objectHeight = entry.measure.height ?? 0;
    const wrapType = entry.block.wrap?.type ?? 'Inline';
    if (
      (anchor?.vRelativeFrom != null && anchor.vRelativeFrom !== 'paragraph') ||
      wrapType === 'Inline' ||
      objectHeight <= 0 ||
      objectHeight > contentHeight + ANCHORED_DRAWING_PAGE_FIT_EPSILON_PX
    ) {
      return false;
    }

    const anchorY = resolveAnchoredGraphicY({
      anchor,
      objectHeight,
      contentTop: state.topMargin,
      contentBottom: state.contentBottom,
      pageBottomMargin,
      anchorParagraphY: anchor?.vRelativeFrom == null ? legacyParagraphAnchorY : explicitParagraphAnchorY,
      firstLineHeight,
      pageNumber: state.page.number,
    });
    return anchorY + objectHeight > state.contentBottom + ANCHORED_DRAWING_PAGE_FIT_EPSILON_PX;
  });
}

const collapseSplitLineBreakCarrierLines = (lines: Line[], collapse: boolean | undefined): Line[] => {
  return collapse && lines.length > 1 ? lines.slice(0, 1) : lines;
};

export function layoutParagraphBlock(ctx: ParagraphLayoutContext, anchors?: ParagraphAnchorsContext): void {
  const { block, measure, columnWidth, ensurePage, advanceColumn, columnX, floatManager } = ctx;
  const remeasureParagraph = ctx.remeasureParagraph;
  let reportedInlineBoxRemeasureDrop = false;
  const blockForRemeasure = (): ParagraphBlock => {
    if (!block.inlineBoxes?.length) return block;
    if (!reportedInlineBoxRemeasureDrop) {
      reportedInlineBoxRemeasureDrop = true;
      console.warn(
        `layout.inline-box-remeasure-unsupported: dropped ${block.inlineBoxes.length} inline box(es) from paragraph ${block.id}`,
      );
    }
    return { ...block, inlineBoxes: undefined };
  };

  const blockAttrs = getParagraphAttrs(block);
  const frame = blockAttrs?.frame;
  const positionedFrameYOffset =
    (frame?.wrap === 'none' || frame?.wrap === 'around') && typeof frame.y === 'number' && Number.isFinite(frame.y)
      ? frame.y
      : 0;

  let lines = collapseSplitLineBreakCarrierLines(normalizeLines(measure), ctx.collapseSplitLineBreakCarrier);

  // Check if paragraph was measured at a wider width than the current column.
  // This happens when a document has sections with different column counts -
  // text measured for a single-column section may need remeasurement when
  // placed in a multi-column section with narrower columns.
  const measurementWidth = lines[0]?.maxWidth;
  const paraIndent = (block.attrs as { indent?: { left?: number; right?: number } } | undefined)?.indent;
  const indentLeft = typeof paraIndent?.left === 'number' && Number.isFinite(paraIndent.left) ? paraIndent.left : 0;
  const indentRight = typeof paraIndent?.right === 'number' && Number.isFinite(paraIndent.right) ? paraIndent.right : 0;
  const negativeLeftIndent = indentLeft < 0 ? indentLeft : 0;
  const negativeRightIndent = indentRight < 0 ? indentRight : 0;
  // Paragraph content width should honor paragraph indents (including negative values).
  const remeasureWidth = Math.max(1, columnWidth - indentLeft - indentRight);
  // Width-change detection must compare the constraint the measure was produced
  // for, not per-line available widths: the first line legitimately exceeds the
  // body width under hanging/negative first-line indents, so the legacy
  // `lines[0].maxWidth` heuristic remeasured every hanging-indent paragraph even
  // when the column width never changed — replacing canonical measures with the
  // degraded fast-path lines (no ascent/descent) and dominating pagination cost.
  // The first-line heuristic remains only as a fallback for measures that
  // predate the `measuredAtMaxWidth` stamp.
  const measuredAtMaxWidth = measure.measuredAtMaxWidth;
  const needsRemeasureForColumnWidth =
    typeof measuredAtMaxWidth === 'number' && Number.isFinite(measuredAtMaxWidth)
      ? measuredAtMaxWidth - columnWidth > REMEASURE_WIDTH_EPSILON_PX
      : typeof measurementWidth === 'number' && measurementWidth > remeasureWidth;
  let didRemeasureForColumnWidth = false;
  // Track remeasured marker info to ensure fragment gets accurate marker text width
  let remeasuredMarkerInfo: ParagraphMeasure['marker'] | undefined;
  if (typeof remeasureParagraph === 'function' && needsRemeasureForColumnWidth) {
    // Use the proper helper to calculate firstLineIndent based on list marker mode.
    // This ensures correct handling of firstLineIndentMode vs standard hanging indent.
    const firstLineIndent = calculateFirstLineIndent(block, measure);
    // Pass columnWidth (not remeasureWidth) because the measurer handles indent subtraction internally.
    // Using remeasureWidth would cause double-subtraction, making line.maxWidth too small for justify calculations.
    const newMeasure = remeasureParagraph(blockForRemeasure(), columnWidth, firstLineIndent);
    const newLines = collapseSplitLineBreakCarrierLines(normalizeLines(newMeasure), ctx.collapseSplitLineBreakCarrier);
    lines = newLines;
    didRemeasureForColumnWidth = true;
    // Capture marker info from remeasure (may have updated markerTextWidth)
    if (newMeasure.marker) {
      remeasuredMarkerInfo = newMeasure.marker;
    }
  }

  let fromLine = 0;
  const attrs = getParagraphAttrs(block);
  const widowControl = attrs?.widowControl !== false;
  const spacing = attrs?.spacing ?? {};
  const spacingExplicit = attrs?.spacingExplicit;
  const styleId = asString(attrs?.styleId);
  const contextualSpacing = asBoolean(attrs?.contextualSpacing);
  let spacingBefore = Math.max(0, Number(spacing.before ?? spacing.lineSpaceBefore ?? 0));
  let spacingAfter = ctx.overrideSpacingAfter ?? Math.max(0, Number(spacing.after ?? spacing.lineSpaceAfter ?? 0));
  const emptyTextParagraph = isEmptyTextParagraph(block);
  if (emptyTextParagraph && spacingExplicit) {
    if (!spacingExplicit.before) spacingBefore = 0;
    if (!spacingExplicit.after) spacingAfter = 0;
  }
  /** Original spacing before value, preserved for blank page calculations where no trailing collapse occurs. */
  const baseSpacingBefore = spacingBefore;
  let appliedSpacingBefore = spacingBefore === 0;
  let lastState: PageState | null = null;
  if (spacingDebugEnabled) {
    spacingDebugLog('paragraph spacing attrs', {
      blockId: block.id,
      spacingAttrs: spacing,
      spacingBefore,
      spacingAfter,
    });
  }

  let previewState = ensurePage();

  // Border expansion must be included in anchor Y and float-scan line Y so they match
  // fragment placement (`state.cursorY + borderExpansion.top` in PHASE 2).
  const rawBorderExpansion = computeBorderVerticalExpansion(attrs?.borders);
  const currentBorderHash = hashBorders(attrs?.borders);
  let inBorderGroup = currentBorderHash != null && currentBorderHash === previewState.lastParagraphBorderHash;
  let borderExpansion = {
    top: inBorderGroup ? 0 : rawBorderExpansion.top,
    bottom: rawBorderExpansion.bottom,
  };
  let borderVertical = borderExpansion.top + borderExpansion.bottom;

  const resolveParagraphOrigins = () => {
    const suppressSpacingBefore = shouldSuppressOwnSpacing(
      styleId,
      contextualSpacing,
      previewState.lastParagraphStyleId,
    );
    const floatScanStartY = computeParagraphLayoutStartY({
      cursorY: previewState.cursorY,
      spacingBefore,
      trailingSpacing: previewState.trailingSpacing,
      suppressSpacingBefore,
      rewindTrailingFromPrevious: shouldSuppressOwnSpacing(
        previewState.lastParagraphStyleId,
        previewState.lastParagraphContextualSpacing,
        styleId,
      ),
    });
    const preSpacingOrigin = Math.max(
      previewState.topMargin,
      floatScanStartY - (suppressSpacingBefore ? 0 : spacingBefore),
    );
    return {
      paragraphAnchorBaseY: floatScanStartY + borderExpansion.top - (inBorderGroup ? rawBorderExpansion.bottom : 0),
      // Word resolves paragraph-relative drawing offsets from the paragraph's
      // outer origin, before its own spaceBefore.
      paragraphDrawingAnchorBaseY:
        preSpacingOrigin + borderExpansion.top - (inBorderGroup ? rawBorderExpansion.bottom : 0),
      paragraphTableAnchorBaseY:
        preSpacingOrigin +
        borderExpansion.top -
        (inBorderGroup ? rawBorderExpansion.bottom : 0) +
        positionedFrameYOffset,
    };
  };

  let paragraphOrigins = resolveParagraphOrigins();
  if (
    !ctx.preserveAnchorCarrierPage &&
    shouldAdvanceForParagraphRelativeDrawing(
      anchors?.anchoredDrawings,
      previewState,
      paragraphOrigins.paragraphDrawingAnchorBaseY,
      paragraphOrigins.paragraphAnchorBaseY,
      measure.lines?.[0]?.lineHeight || measure.totalHeight || 0,
      anchors?.pageMargins.bottom ?? 0,
    )
  ) {
    previewState = advanceColumn(previewState);
    inBorderGroup = currentBorderHash != null && currentBorderHash === previewState.lastParagraphBorderHash;
    borderExpansion = {
      top: inBorderGroup ? 0 : rawBorderExpansion.top,
      bottom: rawBorderExpansion.bottom,
    };
    borderVertical = borderExpansion.top + borderExpansion.bottom;
    paragraphOrigins = resolveParagraphOrigins();
  }

  const paragraphAnchorBaseY = paragraphOrigins.paragraphAnchorBaseY;
  const paragraphDrawingAnchorBaseY = paragraphOrigins.paragraphDrawingAnchorBaseY;
  const paragraphTableAnchorBaseY = paragraphOrigins.paragraphTableAnchorBaseY;

  const registerAnchoredDrawings = () => {
    if (!anchors?.anchoredDrawings?.length) return;
    for (const entry of anchors.anchoredDrawings) {
      if (anchors.placedAnchoredIds.has(entry.block.id)) continue;
      const state = ensurePage();

      const contentTop = state.topMargin;
      const contentBottom = state.contentBottom;
      // DrawingML explicitly anchored to a paragraph resolves from the
      // paragraph's outer, pre-spacing origin. Legacy VML omits
      // vRelativeFrom and Word resolves that offset from the paragraph's
      // content origin after spaceBefore.
      const anchorParagraphY =
        entry.block.anchor?.vRelativeFrom == null ? paragraphAnchorBaseY : paragraphDrawingAnchorBaseY;
      const anchorY = resolveAnchoredGraphicY({
        anchor: entry.block.anchor,
        objectHeight: entry.measure.height,
        contentTop,
        contentBottom,
        pageBottomMargin: anchors.pageMargins.bottom ?? 0,
        anchorParagraphY,
        firstLineHeight: measure.lines?.[0]?.lineHeight || measure.totalHeight || 0,
        pageNumber: state.page.number,
      });

      floatManager.registerDrawing(entry.block, entry.measure, anchorY, state.columnIndex, state.page.number);

      const anchorX = entry.block.anchor
        ? resolveAnchoredGraphicX(
            entry.block.anchor,
            state.columnIndex,
            anchors.columns,
            entry.measure.width,
            { left: anchors.pageMargins.left, right: anchors.pageMargins.right },
            anchors.pageWidth,
            { pageNumber: state.page.number },
          )
        : columnX(state);

      const pmRange = extractBlockPmRange(entry.block);
      if (entry.block.kind === 'image' && entry.measure.kind === 'image') {
        const pageContentHeight = Math.max(0, state.contentBottom - state.topMargin);
        const relativeFrom = entry.block.anchor?.hRelativeFrom ?? 'column';
        const marginLeft = anchors.pageMargins.left ?? 0;
        const marginRight = anchors.pageMargins.right ?? 0;
        let maxWidth: number;
        if (relativeFrom === 'page') {
          maxWidth = anchors.columns.count === 1 ? anchors.pageWidth - marginLeft - marginRight : anchors.pageWidth;
        } else if (relativeFrom === 'margin') {
          maxWidth = anchors.pageWidth - marginLeft - marginRight;
        } else {
          maxWidth = anchors.columns.width;
        }

        const aspectRatio =
          entry.measure.width > 0 && entry.measure.height > 0 ? entry.measure.width / entry.measure.height : 1.0;
        const minWidth = 20;
        const minHeight = minWidth / aspectRatio;

        const metadata: ImageFragmentMetadata = {
          originalWidth: entry.measure.width,
          originalHeight: entry.measure.height,
          maxWidth,
          maxHeight: pageContentHeight,
          aspectRatio,
          minWidth,
          minHeight,
        };

        const fragment: ImageFragment = {
          kind: 'image',
          blockId: entry.block.id,
          x: anchorX,
          y: anchorY,
          width: entry.measure.width,
          height: entry.measure.height,
          isAnchored: true,
          behindDoc: entry.block.anchor?.behindDoc === true,
          zIndex: getFragmentZIndex(entry.block),
          metadata,
          sourceAnchor: entry.block.sourceAnchor,
        };
        if (pmRange.pmStart != null) fragment.pmStart = pmRange.pmStart;
        if (pmRange.pmEnd != null) fragment.pmEnd = pmRange.pmEnd;
        state.page.fragments.push(fragment);
      } else if (entry.block.kind === 'drawing' && entry.measure.kind === 'drawing') {
        const contentMeasures =
          entry.block.drawingKind === 'textboxShape'
            ? resolveTextboxContentMeasures(entry.block, entry.measure, remeasureParagraph)
            : undefined;
        const fragment: DrawingFragment = {
          kind: 'drawing',
          blockId: entry.block.id,
          drawingKind: entry.block.drawingKind,
          x: anchorX,
          y: anchorY,
          width: entry.measure.width,
          height: entry.measure.height,
          geometry: entry.measure.geometry,
          scale: entry.measure.scale,
          isAnchored: true,
          behindDoc: entry.block.anchor?.behindDoc === true,
          zIndex: getFragmentZIndex(entry.block),
          drawingContentId: entry.block.drawingContentId,
          sourceAnchor: entry.block.sourceAnchor,
        };
        if (contentMeasures) {
          fragment.contentMeasures = contentMeasures;
          const textboxId = entry.block.attrs?.textboxId;
          if (typeof textboxId === 'string' && textboxId.length > 0) fragment.textboxId = textboxId;
        }
        if (pmRange.pmStart != null) fragment.pmStart = pmRange.pmStart;
        if (pmRange.pmEnd != null) fragment.pmEnd = pmRange.pmEnd;
        state.page.fragments.push(fragment);
      }

      anchors.placedAnchoredIds.add(entry.block.id);
    }
  };

  registerAnchoredDrawings();

  if (ctx.layoutOnlyAnchorCarrier) {
    return;
  }

  const registeredAnchoredTablePlacements = new Map<
    string,
    {
      page: PageState['page'];
      fragment: ReturnType<typeof createAnchoredTableFragment>;
      columnIndex: number;
      paragraphBaseY: number;
    }
  >();

  const registerAnchoredTablesAt = (paragraphContentStartY: number, entries: AnchoredTable[]) => {
    if (!entries.length) return;
    const columnWidthForTable = anchors!.columnWidth;
    let nextStackY = Number.NEGATIVE_INFINITY;
    for (const entry of entries) {
      if (anchors!.placedAnchoredIds.has(entry.block.id)) continue;
      const totalWidth = entry.measure.totalWidth ?? 0;
      if (isAnchoredTableFullWidth(entry.block, entry.measure, columnWidthForTable)) {
        continue;
      }

      const state = ensurePage();
      const contentTop = state.topMargin;
      const contentBottom = state.contentBottom;
      const layoutOffsetV = entry.layoutOffsetV;
      const firstLineHeight = measure.lines?.[0]?.lineHeight || measure.totalHeight || 0;
      const wrapType = entry.block.wrap?.type ?? 'None';
      const anchorForY = anchorForLineScopedFormField(
        layoutOffsetV != null && entry.block.anchor
          ? { ...entry.block.anchor, offsetV: layoutOffsetV }
          : entry.block.anchor,
        entry.measure.totalHeight ?? 0,
        firstLineHeight,
        layoutOffsetV,
        entry.lineScopedOnAnchor === true,
        wrapType,
      );
      const resolvedAnchorY = resolveAnchoredGraphicY({
        anchor: graphicAnchorY(anchorForY),
        objectHeight: entry.measure.totalHeight ?? 0,
        contentTop,
        contentBottom,
        pageBottomMargin: anchors!.pageMargins.bottom ?? 0,
        anchorParagraphY: paragraphContentStartY,
        firstLineHeight,
        pageNumber: state.page.number,
      });
      const anchorY = wrapType === 'None' ? resolvedAnchorY : Math.max(resolvedAnchorY, nextStackY);

      floatManager.registerTable(entry.block, entry.measure, anchorY, state.columnIndex, state.page.number);

      const anchorX = entry.block.anchor
        ? resolveAnchoredGraphicX(
            graphicAnchorH(entry.block.anchor),
            state.columnIndex,
            anchors!.columns,
            totalWidth,
            { left: anchors!.pageMargins.left, right: anchors!.pageMargins.right },
            anchors!.pageWidth,
            { pageNumber: state.page.number },
          )
        : columnX(state);

      const fragment = createAnchoredTableFragment(entry.block, entry.measure, anchorX, anchorY);
      state.page.fragments.push(fragment);
      registeredAnchoredTablePlacements.set(entry.block.id, {
        page: state.page,
        fragment,
        columnIndex: state.columnIndex,
        paragraphBaseY: paragraphContentStartY,
      });
      anchors!.placedAnchoredIds.add(entry.block.id);

      if (wrapType !== 'None') {
        const bottom = anchorY + (entry.measure.totalHeight ?? 0);
        const distBottom = entry.block.wrap?.distBottom ?? 0;
        nextStackY = Math.max(nextStackY, bottom + distBottom);
      }
    }
  };

  const anchoredTablesForPara = anchors?.anchoredTables ?? [];
  registerAnchoredTablesAt(paragraphTableAnchorBaseY, anchoredTablesForPara);

  const pageHasNonTableAnchorContent = (state: PageState): boolean => {
    const registeredFragments = new Set<Fragment>(
      [...registeredAnchoredTablePlacements.values()]
        .filter((placement) => placement.page === state.page)
        .map((placement) => placement.fragment),
    );
    return state.page.fragments.some((fragment) => !registeredFragments.has(fragment));
  };

  const relocateAnchoredTablesToFirstSlice = (state: PageState): void => {
    if (registeredAnchoredTablePlacements.size === 0) return;
    // Word applies paragraph-relative tblpY from the paragraph's pre-spacing position,
    // not from the first line after w:spacing/@w:before.
    const paragraphBaseY =
      Math.max(state.topMargin, state.cursorY - spacingBefore) + borderExpansion.top + positionedFrameYOffset;
    const alreadyCurrent = [...registeredAnchoredTablePlacements.values()].every(
      (placement) =>
        placement.page === state.page &&
        placement.columnIndex === state.columnIndex &&
        Math.abs(placement.paragraphBaseY - paragraphBaseY) < 0.01,
    );
    if (alreadyCurrent) return;

    for (const [blockId, placement] of registeredAnchoredTablePlacements) {
      const fragmentIndex = placement.page.fragments.indexOf(placement.fragment);
      if (fragmentIndex >= 0) placement.page.fragments.splice(fragmentIndex, 1);
      anchors!.placedAnchoredIds.delete(blockId);
    }
    registeredAnchoredTablePlacements.clear();
    registerAnchoredTablesAt(paragraphBaseY, anchoredTablesForPara);
  };

  const isOverlayFrame = frame?.wrap === 'none';
  const isFlowPositionedFrame = frame?.wrap === 'around';
  const positionedFrameAffectsFlow = isFlowPositionedFrame && ctx.positionedFrameAffectsFlow !== false;
  const positionedFrameAdvancesAtBoundary =
    (isOverlayFrame || isFlowPositionedFrame) && ctx.positionedFrameAffectsFlow !== false;
  if (isPositionedParagraphFrame(frame)) {
    let state = ensurePage();
    let positionedFrameAdvanced = false;
    if (positionedFrameAdvancesAtBoundary && state.cursorY >= state.contentBottom) {
      state = advanceColumn(state);
      positionedFrameAdvanced = true;
    }

    const computePositionedFrameBaseY = (pageState: PageState): number => {
      const suppressSpacingBefore = shouldSuppressOwnSpacing(
        styleId,
        contextualSpacing,
        pageState.lastParagraphStyleId,
      );
      const rewindTrailingFromPrevious = shouldSuppressOwnSpacing(
        pageState.lastParagraphStyleId,
        pageState.lastParagraphContextualSpacing,
        styleId,
      );
      const inFrameBorderGroup = currentBorderHash != null && currentBorderHash === pageState.lastParagraphBorderHash;
      return (
        computeParagraphLayoutStartY({
          cursorY: pageState.cursorY,
          spacingBefore,
          trailingSpacing: pageState.trailingSpacing,
          suppressSpacingBefore,
          rewindTrailingFromPrevious,
        }) +
        borderExpansion.top -
        (inFrameBorderGroup ? rawBorderExpansion.bottom : 0)
      );
    };

    let flowBaseY = computePositionedFrameBaseY(state);
    const maxLineWidth = lines.reduce((max, line) => Math.max(max, line.width ?? 0), 0);
    const alignmentWidth = maxLineWidth;
    const fragmentWidth = isFlowPositionedFrame ? columnWidth : maxLineWidth || columnWidth;
    const fragmentHeight = lines.reduce((sum, line) => sum + (line.lineHeight ?? 0), 0);

    if (
      positionedFrameAffectsFlow &&
      flowBaseY + fragmentHeight + borderExpansion.bottom > state.contentBottom &&
      pageHasNonTableAnchorContent(state)
    ) {
      state = advanceColumn(state);
      positionedFrameAdvanced = true;
      flowBaseY = computePositionedFrameBaseY(state);
    }

    if (positionedFrameAdvanced) {
      relocateAnchoredTablesToFirstSlice(state);
    }

    let x = columnX(state);
    if (frame.xAlign === 'right') {
      x += columnWidth - alignmentWidth;
    } else if (frame.xAlign === 'center') {
      x += (columnWidth - alignmentWidth) / 2;
    }
    if (typeof frame.x === 'number' && Number.isFinite(frame.x)) {
      x += frame.x;
    }

    const fragment: ParaFragment = {
      kind: 'para',
      blockId: block.id,
      columnIndex: state.columnIndex,
      fromLine: 0,
      toLine: lines.length,
      x,
      y: (isFlowPositionedFrame ? flowBaseY : state.cursorY) + positionedFrameYOffset,
      width: fragmentWidth,
      sourceAnchor: block.sourceAnchor,
      ...computeFragmentPmRange(block, lines, 0, lines.length),
    };

    if (measure.marker || remeasuredMarkerInfo) {
      // Prefer remeasured marker info when available (has more accurate markerTextWidth)
      const effectiveMarkerInfo = remeasuredMarkerInfo ?? measure.marker;
      fragment.markerWidth = effectiveMarkerInfo?.markerWidth ?? measure.marker?.markerWidth ?? 0;
      const markerTextWidth = remeasuredMarkerInfo?.markerTextWidth ?? measure.marker?.markerTextWidth;
      if (markerTextWidth != null) {
        fragment.markerTextWidth = markerTextWidth;
      }
    }

    state.page.fragments.push(fragment);
    if (isFlowPositionedFrame && !positionedFrameAffectsFlow) {
      return;
    }
    if (isFlowPositionedFrame) {
      state.cursorY = flowBaseY + fragmentHeight + borderExpansion.bottom;
      state.maxCursorY = Math.max(state.maxCursorY, state.cursorY);
      if (spacingAfter > 0) {
        if (state.cursorY + spacingAfter > state.contentBottom) {
          state = advanceColumn(state);
          state.trailingSpacing = 0;
        } else {
          state.cursorY += spacingAfter;
          state.maxCursorY = Math.max(state.maxCursorY, state.cursorY);
          state.trailingSpacing = spacingAfter;
        }
      } else {
        state.trailingSpacing = 0;
      }
    } else {
      state.trailingSpacing = 0;
    }

    state.lastParagraphStyleId = styleId;
    state.lastParagraphContextualSpacing = contextualSpacing;
    state.lastParagraphBorderHash = currentBorderHash;
    return;
  }

  // PHASE 1: Derive line-specific flow regions before remeasuring. A single
  // paragraph can be narrow beside a float and full-width immediately below
  // it, so a paragraph-wide "narrowest width" loses Word's line boundaries.
  let didRemeasureForFloats = false;

  if (typeof remeasureParagraph === 'function') {
    const paragraphContentLeft = indentLeft;
    const paragraphContentRight = columnWidth - indentRight;
    const paragraphContentWidth = Math.max(1, paragraphContentRight - paragraphContentLeft);

    const scanFloatConstraints = (candidateLines: Line[]): ParagraphLineRegion[][] => {
      const tempState = ensurePage();
      let tempY = paragraphAnchorBaseY;
      const constraints: ParagraphLineRegion[][] = [];

      for (let i = 0; i < candidateLines.length; i++) {
        const lineHeight = candidateLines[i]?.lineHeight || 0;
        let lineY = tempY;
        // A Square float that consumes the entire column behaves like a
        // vertical blocker for this paragraph, just as Word does. Resolve the
        // physical line origin before deriving its horizontal regions so the
        // remeasure path does not treat the 1px fail-closed sentinel as usable
        // text space.
        while (true) {
          const clearance = floatManager.computeVerticalClearance(
            lineY,
            lineHeight,
            tempState.columnIndex,
            tempState.page.number,
          );
          if (clearance == null || clearance <= lineY) break;
          lineY = clearance;
        }
        const availableRegions = floatManager.computeAvailableRegions(
          lineY,
          lineHeight,
          columnWidth,
          tempState.columnIndex,
          tempState.page.number,
        );

        const paragraphRegions = availableRegions
          .map((region) => {
            const left = Math.max(paragraphContentLeft, region.offsetX);
            const right = Math.min(paragraphContentRight, region.offsetX + region.width);
            return { offsetX: left - paragraphContentLeft, width: right - left };
          })
          .filter((region) => region.width > 0);

        constraints.push(paragraphRegions);

        tempY = lineY + lineHeight;
      }

      return constraints;
    };

    const isConstrained = (regions: readonly (readonly ParagraphLineRegion[])[]): boolean =>
      regions.some(
        (lineRegions) =>
          lineRegions.length !== 1 ||
          Math.abs((lineRegions[0]?.offsetX ?? 0) - 0) > REMEASURE_WIDTH_EPSILON_PX ||
          Math.abs((lineRegions[0]?.width ?? 0) - paragraphContentWidth) > REMEASURE_WIDTH_EPSILON_PX,
      );
    const sameConstraints = (
      left: readonly (readonly ParagraphLineRegion[])[],
      right: readonly (readonly ParagraphLineRegion[])[],
    ): boolean =>
      left.length === right.length &&
      left.every(
        (regions, index) =>
          regions.length === right[index]?.length &&
          regions.every(
            (region, regionIndex) =>
              Math.abs(region.offsetX - (right[index]?.[regionIndex]?.offsetX ?? Number.NaN)) <=
                REMEASURE_WIDTH_EPSILON_PX &&
              Math.abs(region.width - (right[index]?.[regionIndex]?.width ?? Number.NaN)) <= REMEASURE_WIDTH_EPSILON_PX,
          ),
      );

    const preFloatLines = lines;
    let lineRegions = scanFloatConstraints(lines);
    if (isConstrained(lineRegions)) {
      const firstLineIndent = calculateFirstLineIndent(block, measure);
      for (let pass = 0; pass < 8; pass += 1) {
        const newMeasure = remeasureParagraph(blockForRemeasure(), columnWidth, firstLineIndent, lineRegions);
        const newLines = collapseSplitLineBreakCarrierLines(
          normalizeLines(newMeasure),
          ctx.collapseSplitLineBreakCarrier,
        );
        const nextRegions = scanFloatConstraints(newLines);
        if (!isConstrained(nextRegions)) {
          lines = preFloatLines;
          didRemeasureForFloats = false;
          break;
        }
        lines = newLines;
        didRemeasureForFloats = true;
        if (newMeasure.marker) remeasuredMarkerInfo = newMeasure.marker;
        if (sameConstraints(lineRegions, nextRegions)) break;
        lineRegions = nextRegions;
      }
    }
  }

  // Resolve exact markers after width/float remeasurement, once for this
  // paragraph invocation. PM boundaries may coincide across lines; native run
  // ownership must match the final footnote planner rather than charge both.
  const paragraphAnchors = ctx.getFootnoteAnchorsForBlockId?.(block.id) ?? [];
  const anchorLines = new Map<FootnoteAnchorRef, number>();
  for (const anchor of paragraphAnchors) {
    if (anchor.runOrdinal == null) continue;
    const lineIndex = findLineIndexForRunOrdinal(lines, anchor.runOrdinal);
    if (lineIndex != null) anchorLines.set(anchor, lineIndex);
  }
  const getSliceAnchors = (startLine: number, endLine: number): ReadonlyArray<FootnoteAnchorRef> => {
    if (paragraphAnchors.length === 0) return paragraphAnchors;
    const range = computeFragmentPmRange(block, lines, startLine, endLine);
    return paragraphAnchors.filter((anchor) => {
      const lineIndex = anchorLines.get(anchor);
      if (lineIndex != null) return lineIndex >= startLine && lineIndex < endLine;
      return (
        range.pmStart == null || range.pmEnd == null || (anchor.pmPos >= range.pmStart && anchor.pmPos <= range.pmEnd)
      );
    });
  };
  const getSliceRefCount = (anchors: ReadonlyArray<FootnoteAnchorRef>, startLine: number, endLine: number): number => {
    if (ctx.getFootnoteAnchorsForBlockId) return anchors.length;
    const range = computeFragmentPmRange(block, lines, startLine, endLine);
    return ctx.getFootnoteRefCountForBlockId?.(block.id, range.pmStart, range.pmEnd) ?? 0;
  };

  // PHASE 2: Layout the paragraph with the remeasured lines
  while (fromLine < lines.length) {
    let state = ensurePage();
    if (state.trailingSpacing == null) state.trailingSpacing = 0;

    // Reclaim the previous paragraph's bottom border expansion when joining a group.
    // The previous paragraph already reserved space for its bottom border, but in a
    // group that border is suppressed — so we move cursorY back to close the gap.
    if (inBorderGroup && fromLine === 0) {
      state.cursorY -= rawBorderExpansion.bottom;
    }

    /**
     * Contextual Spacing Logic (OOXML w:contextualSpacing)
     *
     * Each paragraph independently decides whether to suppress its own spacing.
     * A paragraph suppresses its before/after spacing when it has contextualSpacing
     * enabled and the adjacent paragraph shares the same style. The adjacent
     * paragraph's contextualSpacing flag is NOT consulted.
     *
     * Two independent checks:
     * 1. Current paragraph suppresses its own before-spacing (based on current's flag)
     * 2. Previous paragraph suppresses its own after-spacing (based on previous's flag,
     *    carried in state.lastParagraphContextualSpacing)
     *
     * Input Validation:
     * - trailingSpacing is validated to be a finite, non-negative number
     * - Invalid values (NaN, Infinity, negative, null, undefined) are treated as 0
     */
    // Current paragraph suppresses its own before-spacing
    if (shouldSuppressOwnSpacing(styleId, contextualSpacing, state.lastParagraphStyleId)) {
      spacingBefore = 0;
    }
    // Previous paragraph suppresses its own after-spacing (rewind trailing)
    if (shouldSuppressOwnSpacing(state.lastParagraphStyleId, state.lastParagraphContextualSpacing, styleId)) {
      const prevTrailing = asSafeNumber(state.trailingSpacing);
      if (prevTrailing > 0) {
        state.cursorY = rewindPreviousParagraphTrailing(state.cursorY, prevTrailing);
        state.trailingSpacing = 0;
      }
    }

    /**
     * Keep Lines Together (OOXML w:keepLines)
     *
     * When keepLines is enabled, all lines of the paragraph should stay on the same page.
     * If the paragraph doesn't fit in the remaining space but WOULD fit on a blank page,
     * advance to the next page/column before laying out any lines.
     *
     * This check only runs when starting from line 0 (not when continuing after a page break).
     * We use baseSpacingBefore for the blank page check because on a new page there's no
     * previous trailing spacing to collapse with.
     */

    const keepLines = attrs?.keepLines === true;
    if (keepLines && fromLine === 0) {
      const neededSpacingBefore = collapseSpacingBefore(spacingBefore, state.trailingSpacing);
      const keptAnchors = ctx.incomingFootnoteDemand ? getSliceAnchors(0, lines.length) : [];
      const keptDemand = keptAnchors.reduce((sum, anchor) => sum + anchor.fullHeight, 0);
      const committedDemand = ctx.incomingFootnoteDemand
        ? state.footnoteAnchorsThisPage.reduce((sum, anchor) => sum + anchor.fullHeight, 0)
        : 0;
      const overhead = ctx.getFootnoteBandOverhead ?? ((refs: number) => (refs > 0 ? 22 + (refs - 1) * 2 : 0));
      const keptBottom = ctx.incomingFootnoteDemand
        ? coupledFootnoteBodyBottom(
            state,
            committedDemand + keptDemand,
            state.footnoteRefsThisPage + keptAnchors.length,
            ctx.incomingFootnoteDemand(state.page.number - 1),
            overhead,
          )
        : state.contentBottom;
      const blankBottom = ctx.incomingFootnoteDemand
        ? coupledFootnoteBodyBottom(state, keptDemand, keptAnchors.length, { height: 0, refs: 0 }, overhead)
        : state.contentBottom;
      const pageContentHeight = blankBottom - state.topMargin;
      const linesHeight = lines.reduce((sum, line) => sum + (line.lineHeight || 0), 0);
      const fullHeight = linesHeight + borderExpansion.top + borderExpansion.bottom;
      const fitsOnBlankPage = fullHeight + baseSpacingBefore <= pageContentHeight;
      const remainingHeightAfterSpacing = keptBottom - (state.cursorY + neededSpacingBefore);
      if (fitsOnBlankPage && pageHasNonTableAnchorContent(state) && fullHeight > remainingHeightAfterSpacing) {
        state = advanceColumn(state);
        spacingBefore = baseSpacingBefore;
        appliedSpacingBefore = spacingBefore === 0;
        continue;
      }
    }

    if (!appliedSpacingBefore && spacingBefore > 0) {
      while (!appliedSpacingBefore) {
        const prevTrailing = state.trailingSpacing ?? 0;
        const neededSpacingBefore = collapseSpacingBefore(spacingBefore, state.trailingSpacing);
        if (spacingDebugEnabled) {
          spacingDebugLog('spacingBefore pending', {
            blockId: block.id,
            cursorY: state.cursorY,
            contentBottom: state.contentBottom,
            spacingBefore,
            prevTrailing,
            neededSpacingBefore,
            column: state.columnIndex,
            page: state.page.number,
          });
        }
        if (state.cursorY + neededSpacingBefore > state.contentBottom) {
          /**
           * Infinite Loop Guard: Prevents layout hang when spacingBefore exceeds content area.
           *
           * When spacingBefore is larger than the entire available content area, the layout engine
           * would otherwise enter an infinite loop: attempting to advance to a new page/column,
           * finding the cursor at the top, attempting to apply spacing, finding it doesn't fit,
           * advancing again, and repeating indefinitely.
           *
           * Condition checked: cursor is at or above the top margin (start of page/column).
           * This indicates we've already advanced to a fresh page/column and the spacing
           * still won't fit, meaning it exceeds the total content area height.
           *
           * Resolution: Skip the spacing entirely and proceed with content placement at the
           * current cursor position (topMargin). This ensures layout completes successfully
           * even with pathological spacing values.
           *
           * Common scenarios:
           * - Header/footer layout with minimal height constraints
           * - Documents with very large spacingBefore values on small pages
           * - Edge cases where content area is smaller than spacing requirements
           *
           * Note on floating point precision: Epsilon comparison is not needed here because
           * both cursorY and topMargin are derived from integer pixel margins and direct
           * assignments (cursorY = topMargin) that occur during page/column advances.
           * No complex floating point arithmetic is involved between assignment and comparison.
           */
          if (state.cursorY <= state.topMargin) {
            if (spacingDebugEnabled) {
              spacingDebugLog('spacingBefore exceeds page capacity, skipping', {
                blockId: block.id,
                requestedSpacing: neededSpacingBefore,
                pageContentHeight: state.contentBottom - state.topMargin,
                column: state.columnIndex,
                page: state.page.number,
              });
            }
            state.trailingSpacing = 0;
            appliedSpacingBefore = true;
            break;
          }
          if (spacingDebugEnabled) {
            spacingDebugLog('spacingBefore triggers column advance', {
              blockId: block.id,
              cursorY: state.cursorY,
              spacingBefore,
              neededSpacingBefore,
              prevTrailing,
              column: state.columnIndex,
              page: state.page.number,
            });
          }
          state = advanceColumn(state);
          if (state.trailingSpacing == null) state.trailingSpacing = 0;
          continue;
        }

        if (neededSpacingBefore > 0) {
          state.cursorY += neededSpacingBefore;
          state.maxCursorY = Math.max(state.maxCursorY, state.cursorY);
          if (spacingDebugEnabled) {
            spacingDebugLog('spacingBefore applied', {
              blockId: block.id,
              added: neededSpacingBefore,
              prevTrailing,
              newCursorY: state.cursorY,
              column: state.columnIndex,
              page: state.page.number,
            });
          }
        } else if (spacingDebugEnabled && prevTrailing > 0) {
          spacingDebugLog('spacingBefore collapsed by trailing spacing', {
            blockId: block.id,
            prevTrailing,
            spacingBefore,
            column: state.columnIndex,
            page: state.page.number,
          });
        }
        state.trailingSpacing = 0;
        appliedSpacingBefore = true;
      }
    } else {
      state.trailingSpacing = 0;
    }

    // TopAndBottom wrapping is a vertical exclusion, not a horizontal width
    // reduction. Move the next flow line below every overlapping band,
    // including the authored bottom text distance.
    const lineTop = state.cursorY + borderExpansion.top;
    const verticalClearance = floatManager.computeVerticalClearance(
      lineTop,
      lines[fromLine]?.lineHeight ?? 0,
      state.columnIndex,
      state.page.number,
    );
    if (verticalClearance != null && verticalClearance > lineTop) {
      state.cursorY += verticalClearance - lineTop;
      state.maxCursorY = Math.max(state.maxCursorY, state.cursorY);
      if (state.cursorY + borderExpansion.top + (lines[fromLine]?.lineHeight ?? 0) > state.contentBottom) {
        advanceColumn(state);
        continue;
      }
    }

    // SD-2656: footnote band overhead. Source of truth is the planner
    // (incrementalLayout.ts), which derives overhead from data-driven
    // separator dimensions (`topPadding`, `dividerHeight`,
    // `separatorSpacingBefore`, inter-ref `gap`). The planner threads its
    // formula through `ctx.getFootnoteBandOverhead` so the slicer's
    // `effectiveBottom` budget matches the planner's exactly — otherwise
    // body packs onto a page whose band can't actually fit the refs.
    //
    // The fallback formula below matches the planner's *default* values
    // (topPadding=6, dividerHeight=6, separatorSpacingBefore≈14, gap=2)
    // and is only used when ctx doesn't supply the overhead function (e.g.
    // tests that don't exercise footnotes).
    const FN_SAFETY_MARGIN_PX = 1;
    const fallbackBandOverhead = (refsTotal: number): number =>
      refsTotal > 0 ? 22 + Math.max(0, refsTotal - 1) * 2 : 0;
    const bandOverhead = (refsTotal: number): number => {
      if (refsTotal <= 0) return 0;
      const fromCtx = ctx.getFootnoteBandOverhead?.(refsTotal);
      const base =
        typeof fromCtx === 'number' && Number.isFinite(fromCtx) && fromCtx >= 0
          ? fromCtx
          : fallbackBandOverhead(refsTotal);
      return base + FN_SAFETY_MARGIN_PX;
    };

    /**
     * SD-2656: effective bottom for a candidate slice.
     *
     * Critical: we ignore `state.pageFootnoteReserve` here and use the
     * page's raw content area (contentBottom + reserve). With range-aware
     * demand, the slicer knows exactly which fns are anchored on this
     * page — the planner's pre-allocated reserve is no longer needed and
     * actively harmful when it over-allocates. Body shrinkage is driven
     * entirely by what THIS page's slices have charged so far + what the
     * candidate slice would charge.
     *
     * `extraDemand` IS the total ordered-cluster demand for the page after
     * the candidate slice is committed (i.e., the demand function already
     * received state.footnoteAnchorsThisPage as `committed` and returned the
     * full cluster demand). Do NOT add state.footnoteDemandThisPage — that
     * would double-count the already-committed anchors (e.g. fn4 contributes
     * `firstLine(fn4)` to state.footnoteDemandThisPage when first committed,
     * then `full(fn4)` to extraDemand when fn5 arrives and upgrades fn4 from
     * "last" to "non-last"). Trust extraDemand as the total.
     */
    const rawContentBottom = state.contentBottom + state.pageFootnoteReserve;
    const computeEffectiveBottom = (extraDemand: number, extraRefs: number): number => {
      if (ctx.incomingFootnoteDemand) {
        return coupledFootnoteBodyBottom(
          state,
          extraDemand,
          state.footnoteRefsThisPage + extraRefs,
          ctx.incomingFootnoteDemand(state.page.number - 1),
          ctx.getFootnoteBandOverhead ?? fallbackBandOverhead,
          lines[fromLine]?.lineHeight ?? 0,
        );
      }
      const totalDemand = extraDemand;
      const totalRefs = state.footnoteRefsThisPage + extraRefs;
      const demandWithOverhead = totalDemand > 0 ? totalDemand + bandOverhead(totalRefs) : 0;
      // SD-2656: respect the planner's per-page reserve as a floor. The
      // convergence loop sets `state.pageFootnoteReserve` to communicate
      // continuation demand from prior pages (fn body content that was
      // deferred because it didn't fit on its anchor page). Range-aware
      // demand alone misses this — the slicer only knows about fns anchored
      // in THIS page's body, not about fn bodies migrating in from previous
      // pages. Taking the max of (continuation-reserve, anchored-demand+
      // overhead) ensures body leaves room for whichever is larger.
      const reservedSpace = Math.max(state.pageFootnoteReserve, demandWithOverhead);
      const minBodyLineHeight = lines[fromLine]?.lineHeight ?? 0;
      const maxAdditional = Math.max(0, rawContentBottom - state.topMargin - minBodyLineHeight);
      return rawContentBottom - Math.min(reservedSpace, maxAdditional);
    };

    // SD-2656: pre-slicer advance check must preview the FIRST candidate
    // line's footnote demand. Without this preview, the in-slicer force-
    // commit-first-line rule would unconditionally place line 0 even when
    // its fn anchors push the band off the page. This was the band-overflow
    // bug seen on the reference fixture's p19 (two fns ended up in the band
    // on top of a prior fn, pushing the band ~140 px past pageH).
    //
    // The pre-slicer check is allowed to defer the entire block to next
    // page only when the page already has body content (otherwise we'd
    // deadlock on oversized fns). On an empty page, the slicer's force-
    // commit-first-line rule keeps making progress and the band may end
    // up clipped — but that case is handled by the planner's continuation
    // split (separate fix path).
    // Reserve the full footnote cluster height up front, so the body slicer
    // backs off enough lines that every anchored footnote fits whole on its
    // own page. This matches Word's pagination, which knows each footnote's
    // full demand at every line decision rather than reserving a minimum
    // and patching later. Cost: bodies that previously packed to the brink
    // grow ≤ 1–4 pages per fixture; gain: footnote splits drop to ~0 on
    // the representative complex-footnote fixtures we measured.
    const computeFootnoteClusterDemand = (candidate: ReadonlyArray<FootnoteAnchorRef>): number => {
      const committed = state.footnoteAnchorsThisPage ?? [];
      if (candidate.length === 0 && committed.length === 0) return 0;
      let demand = 0;
      for (const anchor of committed) demand += anchor.fullHeight;
      for (const anchor of candidate) demand += anchor.fullHeight;
      return demand;
    };

    const previewAnchors = getSliceAnchors(fromLine, fromLine + 1);
    const previewRefs = getSliceRefCount(previewAnchors, fromLine, fromLine + 1);
    // Re-evaluates against current state after advanceColumn (footnoteAnchorsThisPage
    // resets on a fresh page, so demand can shrink).
    const computePreviewBottom = () => {
      const demand = computeFootnoteClusterDemand(previewAnchors);
      return computeEffectiveBottom(demand, previewRefs);
    };
    let effectiveBottom = computePreviewBottom();

    if (state.cursorY >= effectiveBottom) {
      state = advanceColumn(state);
      effectiveBottom = computePreviewBottom();
    }

    const availableHeight = effectiveBottom - state.cursorY;
    if (availableHeight <= 0) {
      state = advanceColumn(state);
      effectiveBottom = computePreviewBottom();
    }

    const nextLineHeight = lines[fromLine].lineHeight || 0;
    const remainingHeight = effectiveBottom - state.cursorY;
    if (pageHasNonTableAnchorContent(state) && remainingHeight < nextLineHeight) {
      state = advanceColumn(state);
      effectiveBottom = computePreviewBottom();
    }

    if (fromLine === 0) relocateAnchoredTablesToFirstSlice(state);

    // Region-aware remeasurement positions individual lines/segments. The
    // paragraph fragment itself remains column-wide and column-aligned.
    const effectiveColumnWidth = columnWidth;
    const offsetX = 0;

    // Reserve border expansion from available height so the slicer doesn't accept
    // lines that would overflow the page once border space is added.
    // SD-3049: use `effectiveBottom` (which already accounts for any
    // additional footnote demand above the page-level reserve) so we don't
    // greedily add a line that would push body content into the footnote area.
    // SD-2656: range-aware slicer. Commit lines one at a time, charging the
    // fn refs each line anchors. The first line always commits (otherwise
    // a paragraph with oversized fns could deadlock); subsequent lines must
    // pass the fit check (cursor + cumulative height + border + cumulative
    // demand + band overhead ≤ contentBottom). When the next line would
    // overflow, stop — the rest spills to the next page.
    let toLine = fromLine;
    let height = 0;
    let sliceDemand = 0;
    let sliceRefs = 0;
    while (toLine < lines.length) {
      const lineHeight = lines[toLine].lineHeight || 0;
      const candidateLineTop = state.cursorY + borderExpansion.top + height;
      const candidateVerticalClearance = floatManager.computeVerticalClearance(
        candidateLineTop,
        lineHeight,
        state.columnIndex,
        state.page.number,
      );
      if (toLine > fromLine && candidateVerticalClearance != null && candidateVerticalClearance > candidateLineTop) {
        // Commit the lines above the float as one fragment. The next loop
        // iteration will move the remaining line below the exclusion band.
        break;
      }
      const candidateAnchors = getSliceAnchors(fromLine, toLine + 1);
      // Preserve full-cluster acceptance; only marker ownership changes.
      const orderedDemand = computeFootnoteClusterDemand(candidateAnchors);
      const nextRefs = getSliceRefCount(candidateAnchors, fromLine, toLine + 1);

      if (toLine === fromLine) {
        // First line: commit unconditionally. The pre-slicer checks above
        // already advanced the column if even a single line couldn't fit.
        height = lineHeight;
        sliceDemand = orderedDemand;
        sliceRefs = nextRefs;
        toLine = fromLine + 1;
        continue;
      }

      const candidateBottom = state.cursorY + height + lineHeight + borderVertical;
      const effBot = computeEffectiveBottom(orderedDemand, nextRefs);
      if (candidateBottom > effBot) break;
      height += lineHeight;
      sliceDemand = orderedDemand;
      sliceRefs = nextRefs;
      toLine += 1;
    }

    const sliceLineCount = toLine - fromLine;
    const remainingLineCount = lines.length - toLine;
    let advanceForWidow = false;

    // ECMA-376 §17.3.1.44: widowControl defaults on. Do not leave a single
    // first line at the bottom of a populated page, and do not leave a single
    // final line on the following page. Explicit w:widowControl="off" keeps
    // the unconstrained line-by-line behavior.
    if (
      widowControl &&
      fromLine === 0 &&
      pageHasNonTableAnchorContent(state) &&
      remainingLineCount > 0 &&
      (sliceLineCount === 1 || (remainingLineCount === 1 && sliceLineCount <= 2))
    ) {
      state = advanceColumn(state);
      spacingBefore = baseSpacingBefore;
      appliedSpacingBefore = spacingBefore === 0;
      continue;
    }

    if (widowControl && remainingLineCount === 1 && sliceLineCount > 2) {
      toLine -= 1;
      height -= lines[toLine].lineHeight || 0;
      advanceForWidow = true;
      const adjustedAnchors = getSliceAnchors(fromLine, toLine);
      sliceDemand = computeFootnoteClusterDemand(adjustedAnchors);
      sliceRefs = getSliceRefCount(adjustedAnchors, fromLine, toLine);
    }

    const slice = { toLine, height };
    const fragmentHeight = slice.height;

    // Commit demand from this slice into page state. sliceDemand is the
    // ordered-cluster TOTAL for the page (it already accounts for committed
    // anchors), so the page-level tracker is replaced, not accumulated. The
    // ref count is additive (each slice's refs are new).
    if (sliceDemand > 0 || sliceRefs > 0) {
      state.footnoteDemandThisPage = sliceDemand;
      state.footnoteRefsThisPage = (state.footnoteRefsThisPage ?? 0) + sliceRefs;
    }
    // SD-2656: push the anchors actually introduced by this slice onto the
    // page's ordered cluster. The demand for the NEXT slice/block will then
    // see them as committed (so the current cluster's last anchor upgrades
    // from firstLine to fullHeight when a new anchor is added later).
    if (ctx.getFootnoteAnchorsForBlockId) {
      const newAnchors = getSliceAnchors(fromLine, toLine);
      if (newAnchors.length > 0) {
        if (!state.footnoteAnchorsThisPage) state.footnoteAnchorsThisPage = [];
        const seen = new Set(state.footnoteAnchorsThisPage.map((a) => a.refId));
        for (const a of newAnchors) {
          if (!seen.has(a.refId)) state.footnoteAnchorsThisPage.push(a);
        }
      }
    }
    void effectiveBottom;

    // Apply negative indent adjustment to fragment position and width (similar to table indent handling).
    // Negative left indent shifts content left into page margin; negative right indent extends into right margin.
    // This matches Word's behavior where paragraphs with negative indents extend beyond the content area.
    // Adjust x position: negative indent shifts left (e.g., -48px moves fragment 48px left).
    // When text was remeasured around floats, do not pull lines back into exclusion zones.
    const floatAdjustedX = columnX(state) + offsetX;
    const adjustedX = didRemeasureForFloats
      ? floatAdjustedX + Math.max(negativeLeftIndent, 0)
      : floatAdjustedX + negativeLeftIndent;
    const columnRight = columnX(state) + columnWidth;
    const adjustedWidth = didRemeasureForFloats
      ? Math.min(effectiveColumnWidth, Math.max(1, columnRight - adjustedX))
      : effectiveColumnWidth - negativeLeftIndent - negativeRightIndent;
    const fragment: ParaFragment = {
      kind: 'para',
      blockId: block.id,
      columnIndex: state.columnIndex,
      fromLine,
      toLine: slice.toLine,
      x: adjustedX,
      y: state.cursorY + borderExpansion.top,
      width: adjustedWidth,
      sourceAnchor: block.sourceAnchor,
      ...computeFragmentPmRange(block, lines, fromLine, slice.toLine),
    };
    // Store remeasured lines in fragment so renderer can use them.
    // This is needed because the original measure has different line breaks.
    if (didRemeasureForColumnWidth || didRemeasureForFloats) {
      fragment.lines = lines.slice(fromLine, slice.toLine);
    }

    if ((measure.marker || remeasuredMarkerInfo) && fromLine === 0) {
      // Prefer remeasured marker info when available (has more accurate markerTextWidth from canvas measurement)
      const effectiveMarkerInfo = remeasuredMarkerInfo ?? measure.marker;
      fragment.markerWidth = effectiveMarkerInfo?.markerWidth ?? measure.marker?.markerWidth ?? 0;
      // Preserve actual marker text width for accurate tab calculation in renderer
      // Prefer remeasured value which is measured via canvas (more accurate than original measure)
      const markerTextWidth = remeasuredMarkerInfo?.markerTextWidth ?? measure.marker?.markerTextWidth;
      if (markerTextWidth != null) {
        fragment.markerTextWidth = markerTextWidth;
      }
      // Preserve gutter info for word-layout lists (used by renderer for tab sizing)
      const gutterWidth = remeasuredMarkerInfo?.gutterWidth ?? measure.marker?.gutterWidth;
      if (gutterWidth != null) {
        fragment.markerGutter = gutterWidth;
      }
    }

    if (fromLine > 0) fragment.continuesFromPrev = true;
    if (slice.toLine < lines.length) fragment.continuesOnNext = true;

    const floatAlignment = block.attrs?.floatAlignment;
    if (floatAlignment && (floatAlignment === 'right' || floatAlignment === 'center')) {
      let maxLineWidth = 0;
      for (let i = fromLine; i < slice.toLine; i++) {
        if (lines[i].width > maxLineWidth) {
          maxLineWidth = lines[i].width;
        }
      }

      if (floatAlignment === 'right') {
        fragment.x = columnX(state) + offsetX + (effectiveColumnWidth - maxLineWidth);
      } else if (floatAlignment === 'center') {
        fragment.x = columnX(state) + offsetX + (effectiveColumnWidth - maxLineWidth) / 2;
      }
    }
    state.page.fragments.push(fragment);

    state.cursorY += borderExpansion.top + fragmentHeight + borderExpansion.bottom;
    if (ctx.incomingFootnoteDemand) {
      state.committedBodyBottom = Math.max(state.committedBodyBottom ?? state.topMargin, state.cursorY);
    }
    state.maxCursorY = Math.max(state.maxCursorY, state.cursorY);
    lastState = state;
    fromLine = slice.toLine;
    if (advanceForWidow && fromLine < lines.length) {
      advanceColumn(state);
    }
  }

  if (lastState) {
    if (spacingAfter > 0) {
      let targetState = lastState;
      let appliedSpacingAfter = spacingAfter;
      if (targetState.cursorY + spacingAfter > targetState.contentBottom) {
        if (spacingDebugEnabled) {
          spacingDebugLog('spacingAfter triggers column advance', {
            blockId: block.id,
            cursorY: targetState.cursorY,
            spacingAfter,
            column: targetState.columnIndex,
            page: targetState.page.number,
          });
        }
        targetState = advanceColumn(targetState);
        appliedSpacingAfter = 0;
      } else {
        targetState.cursorY += spacingAfter;
        targetState.maxCursorY = Math.max(targetState.maxCursorY, targetState.cursorY);
      }
      targetState.trailingSpacing = appliedSpacingAfter;
      if (spacingDebugEnabled) {
        spacingDebugLog('spacingAfter applied', {
          blockId: block.id,
          appliedSpacingAfter,
          newCursorY: targetState.cursorY,
          column: targetState.columnIndex,
          page: targetState.page.number,
        });
      }
    } else {
      lastState.trailingSpacing = 0;
    }
    lastState.lastParagraphStyleId = styleId;
    lastState.lastParagraphContextualSpacing = contextualSpacing;
    lastState.lastParagraphBorderHash = currentBorderHash;
  }
}
