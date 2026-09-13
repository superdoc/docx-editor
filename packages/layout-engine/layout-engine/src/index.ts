import type {
  ColumnLayout,
  ColumnRegion,
  FlowBlock,
  Fragment,
  HeaderFooterLayout,
  ImageBlock,
  ImageMeasure,
  ImageFragment,
  ImageFragmentMetadata,
  Layout,
  ListMeasure,
  Measure,
  Page,
  ParaFragment,
  PageBreakBlock,
  PageMargins,
  ParagraphBlock,
  ParagraphMeasure,
  SectionBreakBlock,
  SectionVerticalAlign,
  TableBlock,
  TableMeasure,
  TableFragment,
  SectionMetadata,
  DrawingBlock,
  DrawingMeasure,
  DrawingFragment,
  SectionNumbering,
  FlowMode,
  NormalizedColumnLayout,
  ColumnGeometry,
  DocumentBackground,
  PageNumberFormat,
  ParagraphLineRegion,
} from '@superdoc/contracts';
import {
  buildLayoutSourceIdentityForFragment,
  normalizeColumnLayout,
  getFragmentZIndex,
  getColumnGeometry,
  getColumnWidth,
  getColumnX,
  columnRenderLayoutsEqual,
  resolveColumnCount,
  resolveColumnLayout,
  resolveAnchoredGraphicY,
  createHeaderFooterResolutionIndex,
  selectHeaderFooterVariantForPage,
  isPagePositionedParagraphFrame,
  isPagePositionedFloatingTable,
  resolveFooterPageFrameOriginY,
  collectSectionBoundaryFillerBlockIdsSteps,
  isInvisibleSectionBoundaryMarkerBlock,
} from '@superdoc/contracts';
import { createFloatingObjectManager, computeAnchorX } from './floating-objects.js';
import { computeNextSectionPropsAtBreakSteps } from './section-props';
import {
  scheduleSectionBreak as scheduleSectionBreakExport,
  type SectionState,
  applyPendingToActive,
  SINGLE_COLUMN_DEFAULT,
  isInitialSectionBreak,
} from './section-breaks.js';
import { layoutParagraphBlock, type FootnoteAnchorRef } from './layout-paragraph.js';
import { buildFootnoteAnchorIndexSteps } from './footnote-anchor-index.js';
import { coupledFootnoteBodyBottom, type FootnotePageFlow } from './footnote-page-flow.js';
export type { FootnotePageFlow } from './footnote-page-flow.js';
import { layoutImageBlock } from './layout-image.js';
import { layoutDrawingBlock } from './layout-drawing.js';
import { alignInlineZeroHeightDrawingFragments } from './inline-drawing-alignment.js';
import { layoutTextboxContent, resolveTextboxContentMeasures } from './layout-textbox.js';
import {
  layoutTableBlockSteps,
  createAnchoredTableFragment,
  isAnchoredTableFullWidth,
  type TableLayoutCursor,
} from './layout-table.js';
import {
  readTableLayoutResume,
  writeTableLayoutResumeCheckpoints,
  type TableLayoutResumeCheckpoint,
} from './table-resume.js';
import {
  collectAnchoredDrawingsSteps,
  collectAnchoredTablesSteps,
  collectPreRegisteredAnchorsSteps,
  isPageRelativeAnchor,
} from './anchors.js';
import { normalizeFragmentsForRegion } from './normalize-header-footer-fragments.js';
import { createPaginator, isPaginationEarlyStop, type PageState, type ConstraintBoundary } from './paginator.js';
import { formatPageNumber } from './pageNumbering.js';
import { shouldSuppressSpacingForEmpty, shouldSuppressOwnSpacing, findLineIndexForRunOrdinal } from './layout-utils.js';
export { findLineIndexForRunOrdinal } from './layout-utils.js';
import { shouldSkipParagraphDuringLayout } from './paragraph-layout-eligibility.js';
import {
  balanceSectionOnPage,
  type BalancingFragment,
  type MeasureData,
  type SectionColumnLayout,
} from './column-balancing.js';
import { cloneColumnLayout } from './column-utils.js';
import {
  checkpointLayoutExecution,
  layoutExecutionCheckpointEveryBlocks,
  type LayoutExecutionCheckpoint,
  type LayoutExecutionControl,
  type LayoutExecutionPhase,
  type LayoutWorkCheckpoint,
} from './execution.js';

type PageSize = { w: number; h: number };
type Margins = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  header?: number;
  footer?: number;
};

type NormalizedColumns = NormalizedColumnLayout;

const getColumnWidthAt = (columns: NormalizedColumns, columnIndex: number): number => {
  if (Array.isArray(columns.widths) && columns.widths.length > 0) {
    return columns.widths[Math.max(0, Math.min(columnIndex, columns.widths.length - 1))] ?? columns.width;
  }
  return columns.width;
};

/**
 * Default paragraph line height in pixels used for vertical alignment calculations
 * when actual height is not available in the measure data.
 * This is a fallback estimate for paragraph and list-item fragments.
 */
const DEFAULT_PARAGRAPH_LINE_HEIGHT_PX = 20;

/**
 * Synthetic page height used in semantic flow mode to avoid pagination-driven clipping
 * during measurement. A large finite value preserves stable measurement constraints.
 */
export const SEMANTIC_PAGE_HEIGHT_PX = 1_000_000;

/**
 * Type guard to check if a fragment has a height property.
 * Image, drawing, and table fragments all have a required height property.
 *
 * @param fragment - The fragment to check
 * @returns True if the fragment is ImageFragment, DrawingFragment, or TableFragment
 */
function hasHeight(fragment: Fragment): fragment is ImageFragment | DrawingFragment | TableFragment {
  return fragment.kind === 'image' || fragment.kind === 'drawing' || fragment.kind === 'table';
}

/**
 * Read the paragraph spacing-before value (legacy key aware), normalized to pixels.
 *
 * @param block - Paragraph block to read spacing from
 * @returns Non-negative spacing-before value in pixels
 */
function getParagraphSpacingBefore(block: ParagraphBlock): number {
  const spacing = block.attrs?.spacing as Record<string, unknown> | undefined;
  const value = spacing?.before ?? spacing?.lineSpaceBefore;
  if (shouldSuppressSpacingForEmpty(block, 'before')) return 0;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Read the paragraph spacing-after value (legacy key aware), normalized to pixels.
 *
 * @param block - Paragraph block to read spacing from
 * @returns Non-negative spacing-after value in pixels
 */
function getParagraphSpacingAfter(block: ParagraphBlock): number {
  const spacing = block.attrs?.spacing as Record<string, unknown> | undefined;
  const value = spacing?.after ?? spacing?.lineSpaceAfter;
  if (shouldSuppressSpacingForEmpty(block, 'after')) return 0;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Get the layout height contribution for a measured block.
 *
 * @param block - Flow block associated with the measure
 * @param measure - Measure for the block
 * @returns Height in pixels for keep-next calculations
 */
function getMeasureHeight(block: FlowBlock, measure: Measure): number {
  switch (measure.kind) {
    case 'paragraph':
      return measure.totalHeight;
    case 'table':
      return measure.totalHeight;
    case 'list':
      return measure.totalHeight;
    case 'image':
    case 'drawing':
      return measure.height;
    case 'sectionBreak':
    case 'pageBreak':
    case 'columnBreak':
      return 0;
    default: {
      return block.kind === 'paragraph' ? DEFAULT_PARAGRAPH_LINE_HEIGHT_PX : 0;
    }
  }
}

function buildSectionAwareReferenceKey(refId: string, sectionIndex: number): string {
  return `${refId}::s${sectionIndex}`;
}

// ConstraintBoundary and PageState now come from paginator

/**
 * Represents a chain of consecutive paragraphs with keepNext=true.
 *
 * In OOXML, the `w:keepNext` property indicates that a paragraph should stay on the same
 * page as the following paragraph. When multiple consecutive paragraphs all have keepNext,
 * they form an indivisible "chain" that Word treats as a single unit for pagination.
 *
 * For example, given paragraphs A, B, C, D where A, B, C have keepNext=true:
 * - The chain includes A, B, C (memberIndices)
 * - D is the "anchor" - the paragraph the chain must stay with
 * - If the combined height of A+B+C+D.firstLine doesn't fit, the entire chain moves to the next page
 *
 * @see ECMA-376 Part 1, Section 17.3.1.14 (keepNext)
 */
type KeepNextChain = {
  /** Index of the first paragraph in the chain (the chain "starter") */
  startIndex: number;
  /** Index of the last paragraph with keepNext=true in the chain */
  endIndex: number;
  /** All paragraph indices that are members of this chain (inclusive of start and end) */
  memberIndices: number[];
  /**
   * Index of the paragraph immediately after the chain (the "anchor").
   * This is the paragraph that the chain must stay with on the same page.
   * Set to -1 if there is no valid anchor (e.g., chain at end of document or followed by a break).
   */
  anchorIndex: number;
};

/**
 * Pre-computes keepNext chains for correct pagination grouping.
 *
 * This function scans the document blocks to identify sequences of consecutive paragraphs
 * that all have `keepNext=true`. These sequences form "chains" that must be treated as
 * indivisible units during pagination - if the chain doesn't fit on the current page,
 * the entire chain moves to the next page together.
 *
 * Algorithm:
 * 1. Iterate through blocks looking for paragraphs with keepNext=true
 * 2. When found, walk forward to find all consecutive keepNext paragraphs
 * 3. Record the chain with its anchor (the first non-keepNext paragraph after the chain)
 * 4. Chains break at section/page/column breaks or non-paragraph blocks
 *
 * Time complexity: O(n) where n is the number of blocks
 * Space complexity: O(k) where k is the number of chains
 *
 * @param blocks - All flow blocks in the document
 * @returns Map where keys are chain start indices and values are KeepNextChain objects.
 *          Only paragraphs that START a chain are included as keys.
 *
 * @example
 * // Given blocks: [P1(keepNext), P2(keepNext), P3, P4(keepNext), P5]
 * // Returns Map with:
 * //   0 -> { startIndex: 0, endIndex: 1, memberIndices: [0, 1], anchorIndex: 2 }
 * //   3 -> { startIndex: 3, endIndex: 3, memberIndices: [3], anchorIndex: 4 }
 */
function* computeKeepNextChainSteps(
  blocks: FlowBlock[],
  checkpointEveryBlocks: number | null,
): Generator<LayoutWorkCheckpoint, Map<number, KeepNextChain>, void> {
  const chains = new Map<number, KeepNextChain>();
  // Track indices we've already included in a chain to avoid re-processing
  const processedIndices = new Set<number>();

  for (let i = 0; i < blocks.length; i++) {
    if (checkpointEveryBlocks != null && i % checkpointEveryBlocks === 0) {
      yield { index: i, total: blocks.length };
    }
    // Skip blocks already claimed by a previous chain (they're mid-chain, not starters)
    if (processedIndices.has(i)) continue;

    const block = blocks[i];
    // Only paragraph blocks can have the keepNext property in OOXML
    if (block.kind !== 'paragraph') continue;

    const paraBlock = block as ParagraphBlock;
    // Skip paragraphs without keepNext - they can't start a chain
    if (paraBlock.attrs?.keepNext !== true) continue;

    // Found a keepNext paragraph - this is a potential chain starter.
    // Walk forward to find all consecutive keepNext paragraphs.
    const memberIndices: number[] = [i];
    let endIndex = i;

    for (let j = i + 1; j < blocks.length; j++) {
      if (checkpointEveryBlocks != null && j % checkpointEveryBlocks === 0) {
        yield { index: j, total: blocks.length };
      }
      const nextBlock = blocks[j];

      // Explicit breaks terminate the chain - keepNext doesn't span across them
      if (nextBlock.kind === 'sectionBreak' || nextBlock.kind === 'pageBreak' || nextBlock.kind === 'columnBreak') {
        break;
      }

      // Non-paragraph blocks (tables, images) also terminate the chain
      // Note: This could be extended in the future to support tables in chains
      if (nextBlock.kind !== 'paragraph') {
        break;
      }

      const nextPara = nextBlock as ParagraphBlock;
      if (nextPara.attrs?.keepNext === true) {
        // This paragraph continues the chain - add it and mark as processed
        memberIndices.push(j);
        endIndex = j;
        processedIndices.add(j);
      } else {
        // Found a paragraph without keepNext - this becomes the anchor
        // The chain must stay on the same page as this paragraph's first line
        break;
      }
    }

    // Determine the anchor: the first paragraph after the chain that we must "keep with"
    // A single keepNext paragraph still needs chain logic to evaluate with its anchor
    const anchorIndex = endIndex + 1 < blocks.length ? endIndex + 1 : -1;

    // Validate that the anchor is not an explicit break (those don't count as anchors)
    if (anchorIndex !== -1) {
      const anchorBlock = blocks[anchorIndex];
      if (
        anchorBlock.kind === 'sectionBreak' ||
        anchorBlock.kind === 'pageBreak' ||
        anchorBlock.kind === 'columnBreak'
      ) {
        // No valid anchor due to break. Only record the chain if it has multiple
        // members (multi-member chains without anchors still need to stay together)
        if (memberIndices.length > 1) {
          chains.set(i, {
            startIndex: i,
            endIndex,
            memberIndices,
            anchorIndex: -1,
          });
        }
        continue;
      }
    }

    // Record this chain - it will be used during pagination to make group decisions
    chains.set(i, {
      startIndex: i,
      endIndex,
      memberIndices,
      anchorIndex,
    });
  }

  return chains;
}

/**
 * Calculates the total height needed to keep a keepNext chain together on the same page.
 *
 * This function computes the combined height of all paragraphs in a keepNext chain,
 * plus the first line of the anchor paragraph. This height is used to determine
 * whether the entire chain can fit on the current page or needs to move to the next.
 *
 * The calculation accounts for:
 * - Heights of all chain member paragraphs (from their measures)
 * - Inter-paragraph spacing with OOXML spacing collapse rules (max of after/before)
 * - Contextual spacing suppression when adjacent paragraphs share the same style
 * - Effective spacing before the first chain member (considering page state)
 * - First line height of the anchor paragraph (optimization per SD-1282)
 *
 * Spacing rules per OOXML spec:
 * - Adjacent paragraph spacing collapses to max(paragraph1.after, paragraph2.before)
 * - contextualSpacing suppresses a paragraph's spacing when adjacent to same-style paragraph
 *
 * @param chain - The keepNext chain to calculate height for
 * @param blocks - All flow blocks in the document
 * @param measures - Pre-computed measures for all blocks (must be parallel array with blocks)
 * @param state - Current page state, used for trailing spacing and last paragraph style
 * @returns Total height in pixels needed to keep the chain together. Returns 0 if chain is empty.
 *
 * @example
 * // For a chain of [Heading(30px), Body(50px)] with anchor Paragraph(20px first line):
 * // Height = 0 (spacing before heading on fresh page)
 * //        + 30 (heading height)
 * //        + 12 (inter-paragraph spacing)
 * //        + 50 (body height)
 * //        + 10 (spacing to anchor)
 * //        + 20 (anchor first line)
 * //        = 122px
 */
function keptAnchorLineCount(block: ParagraphBlock, measure: ParagraphMeasure): number {
  if (block.attrs?.keepLines === true) return measure.lines.length;
  if (block.attrs?.widowControl === false) return 1;
  // A three-line paragraph cannot split 1+2 or 2+1 under widow control.
  return Math.min(measure.lines.length, measure.lines.length === 3 ? 3 : 2);
}

function calculateChainHeight(
  chain: KeepNextChain,
  blocks: FlowBlock[],
  measures: Measure[],
  state: PageState,
  protectAnchorLines = false,
): number {
  let totalHeight = 0;

  // Track state from previous paragraph for spacing calculations
  let prevStyleId: string | undefined;
  let prevSpacingAfter = 0;
  let prevContextualSpacing = false;
  let isFirstMember = true;

  // Phase 1: Sum heights of all chain member paragraphs with inter-paragraph spacing
  for (const memberIndex of chain.memberIndices) {
    const block = blocks[memberIndex] as ParagraphBlock;
    const measure = measures[memberIndex];
    if (!measure) continue;

    // Extract spacing and style properties for this paragraph
    const spacingBefore = getParagraphSpacingBefore(block);
    const spacingAfter = getParagraphSpacingAfter(block);
    const styleId = typeof block.attrs?.styleId === 'string' ? block.attrs?.styleId : undefined;
    const contextualSpacing = block.attrs?.contextualSpacing === true;

    if (isFirstMember) {
      // First chain member: calculate spacing relative to the paragraph before the chain
      // (which is tracked in PageState from the previous layout operation)
      const prevTrailing =
        Number.isFinite(state.trailingSpacing) && state.trailingSpacing > 0 ? state.trailingSpacing : 0;
      // Per-paragraph contextual spacing: each side independently suppresses its own spacing
      const prevSuppressAfter = shouldSuppressOwnSpacing(
        state.lastParagraphStyleId,
        state.lastParagraphContextualSpacing,
        styleId,
      );
      const currSuppressBefore = shouldSuppressOwnSpacing(styleId, contextualSpacing, state.lastParagraphStyleId);
      let effectiveSpacingBefore: number;
      if (prevSuppressAfter && currSuppressBefore) {
        effectiveSpacingBefore = 0;
      } else if (prevSuppressAfter) {
        effectiveSpacingBefore = spacingBefore;
      } else if (currSuppressBefore) {
        effectiveSpacingBefore = 0;
      } else {
        effectiveSpacingBefore = Math.max(spacingBefore - prevTrailing, 0);
      }
      totalHeight += effectiveSpacingBefore;
      isFirstMember = false;
    } else {
      // Subsequent chain members: per-paragraph contextual spacing
      const prevSuppressAfter = shouldSuppressOwnSpacing(prevStyleId, prevContextualSpacing, styleId);
      const currSuppressBefore = shouldSuppressOwnSpacing(styleId, contextualSpacing, prevStyleId);
      const effectiveSpacingAfterPrev = prevSuppressAfter ? 0 : prevSpacingAfter;
      const effectiveSpacingBefore = currSuppressBefore ? 0 : spacingBefore;
      const interParagraphSpacing = Math.max(effectiveSpacingAfterPrev, effectiveSpacingBefore);
      totalHeight += interParagraphSpacing;
    }

    // Add this paragraph's content height
    totalHeight += getMeasureHeight(block, measure);

    // Store state for next iteration's spacing calculation
    prevStyleId = styleId;
    prevSpacingAfter = spacingAfter;
    prevContextualSpacing = contextualSpacing;
  }

  // Phase 2: Add the anchor paragraph's contribution (first line height only)
  // The "anchor" is the paragraph after the chain that we must keep with.
  // We only need space for its first line to start - not its full height.
  if (chain.anchorIndex !== -1) {
    const anchorBlock = blocks[chain.anchorIndex];
    const anchorMeasure = measures[chain.anchorIndex];

    if (anchorBlock && anchorMeasure) {
      if (anchorBlock.kind === 'paragraph' && anchorMeasure.kind === 'paragraph') {
        // Paragraph anchor: apply same spacing rules as chain members
        const anchorSpacingBefore = getParagraphSpacingBefore(anchorBlock as ParagraphBlock);
        const anchorStyleId =
          typeof (anchorBlock as ParagraphBlock).attrs?.styleId === 'string'
            ? (anchorBlock as ParagraphBlock).attrs?.styleId
            : undefined;
        const anchorContextualSpacing = (anchorBlock as ParagraphBlock).attrs?.contextualSpacing === true;

        const prevSuppressAfter = shouldSuppressOwnSpacing(prevStyleId, prevContextualSpacing, anchorStyleId);
        const anchorSuppressBefore = shouldSuppressOwnSpacing(anchorStyleId, anchorContextualSpacing, prevStyleId);
        const effectiveSpacingAfterPrev = prevSuppressAfter ? 0 : prevSpacingAfter;
        const effectiveAnchorSpacingBefore = anchorSuppressBefore ? 0 : anchorSpacingBefore;
        const interParagraphSpacing = Math.max(effectiveSpacingAfterPrev, effectiveAnchorSpacingBefore);

        // Optimization (SD-1282): Only require space for anchor's first line, not full height.
        // This prevents excessive page breaks while still honoring the keepNext contract.
        // keepLines is an explicit paragraph-level indivisibility contract. A
        // keepNext predecessor therefore needs room for the whole anchor even
        // when the coupled note flow has no demand on those lines. Widow-line
        // protection remains coupled-note-specific so ordinary keepNext
        // pagination keeps its established first-line behavior.
        const requiredLines =
          anchorBlock.attrs?.keepLines === true
            ? anchorMeasure.lines.length
            : protectAnchorLines
              ? keptAnchorLineCount(anchorBlock, anchorMeasure)
              : 1;
        const firstLineHeight = anchorMeasure.lines
          .slice(0, requiredLines)
          .reduce((sum, line) => sum + line.lineHeight, 0);
        const anchorHeight =
          typeof firstLineHeight === 'number' && Number.isFinite(firstLineHeight) && firstLineHeight > 0
            ? firstLineHeight
            : getMeasureHeight(anchorBlock, anchorMeasure);

        totalHeight += interParagraphSpacing + anchorHeight;
      } else {
        // Non-paragraph anchor (table, image, etc.).
        // No contextual spacing applies to non-paragraph blocks.
        // Skip anchored tables - they're positioned out of flow and don't consume flow height
        // (consistent with shouldSkipAnchoredTable guard in legacy keepNext path)
        const isAnchoredTable = anchorBlock.kind === 'table' && (anchorBlock as TableBlock).anchor?.isAnchored === true;
        if (!isAnchoredTable) {
          // For a table anchor, only require the FIRST ROW to stay with the chain, not
          // the full table. The keepNext contract keeps the heading with the table's
          // start; the table itself splits across pages (SD-3345). Reserving the full
          // height pushed a heading + tall splittable table wholly to the next page,
          // leaving a large gap, where Word starts the table here and splits it. This
          // mirrors the paragraph anchor's first-line optimization (SD-1282). A table
          // whose first row cannot split is still handled by the table-start preflight.
          let anchorHeight = getMeasureHeight(anchorBlock, anchorMeasure);
          if (anchorBlock.kind === 'table' && anchorMeasure.kind === 'table' && anchorMeasure.rows.length > 0) {
            const firstRowHeight = anchorMeasure.rows[0]?.height;
            if (typeof firstRowHeight === 'number' && Number.isFinite(firstRowHeight) && firstRowHeight > 0) {
              anchorHeight = firstRowHeight;
            }
          }
          totalHeight += prevSpacingAfter + anchorHeight;
        }
      }
    }
  }

  return totalHeight;
}

export type LayoutOptions = {
  /** @internal Exact forward body/note pagination; never supplied by document authors. */
  footnotePageFlow?: FootnotePageFlow;
  pageSize?: PageSize;
  margins?: Margins;
  documentBackground?: DocumentBackground;
  columns?: ColumnLayout;
  flowMode?: FlowMode;
  semantic?: {
    contentWidth?: number;
    marginLeft?: number;
    marginRight?: number;
    marginTop?: number;
    marginBottom?: number;
  };
  remeasureParagraph?: (
    block: ParagraphBlock,
    maxWidth: number,
    firstLineIndent?: number,
    lineRegions?: readonly (readonly ParagraphLineRegion[])[],
  ) => ParagraphMeasure;
  /** @internal Positioned paragraph frames that render without advancing the story cursor. */
  nonFlowPositionedParagraphFrameIds?: ReadonlySet<string>;
  sectionMetadata?: SectionMetadata[];
  /**
   * Extra bottom margin per page index (0-based) reserved for non-body content
   * rendered at the bottom of the page (e.g., footnotes).
   *
   * When provided, the paginator will shrink the body content area on that page by
   * increasing the effective bottom margin for that page only.
   */
  footnoteReservedByPageIndex?: number[];
  /**
   * Footnote metadata. The core layout engine consumes only the fields below
   * (SD-3049: ref positions + per-footnote body heights for block-aware breaks).
   * Higher-level orchestration (layout-bridge) attaches additional fields
   * (`blocksById`, separator dimensions, etc.) which the engine ignores.
   */
  footnotes?: {
    refs?: Array<{ id: string; pos: number; blockId?: string; runOrdinal?: number | null }>;
    /**
     * SD-3049: total measured body height per footnote id (sum of measured
     * paragraph heights + per-paragraph spacingAfter + inter-footnote gap +
     * separator overhead). Used by the body paginator to consult footnote
     * demand at fragment-commit time so body packs tight to the demand.
     */
    bodyHeightById?: Map<string, number>;
    /**
     * SD-2656: per-footnote first valid line/run height. The ordered-cluster
     * rule (Word-style) requires only the LAST anchor on a page to fit its
     * first line; all earlier anchors must fit fully (bodyHeightById). When
     * present, the body slicer uses this value for the last anchor in the
     * candidate cluster, otherwise falls back to bodyHeightById.
     */
    firstLineHeightById?: Map<string, number>;
    [key: string]: unknown;
  };
  /**
   * Actual measured header content heights per variant type.
   * When provided, the layout engine will ensure body content starts below
   * the header content, preventing overlap when headers exceed their allocated margin space.
   *
   * Keys correspond to header variant types: 'default', 'first', 'even', 'odd'
   * Values are the actual content heights in pixels.
   */
  headerContentHeights?: Partial<Record<'default' | 'first' | 'even' | 'odd', number>>;
  /**
   * Actual measured footer content heights per variant type.
   * When provided, the layout engine will ensure body content ends above
   * the footer content, preventing overlap when footers exceed their allocated margin space.
   *
   * Keys correspond to footer variant types: 'default', 'first', 'even', 'odd'
   * Values are the actual content heights in pixels.
   */
  footerContentHeights?: Partial<Record<'default' | 'first' | 'even' | 'odd', number>>;
  /**
   * Actual measured header content heights per relationship ID.
   * Used for multi-section documents where each section may have unique
   * headers/footers referenced by their relationship IDs.
   *
   * Keys are relationship IDs (e.g., 'rId6', 'rId7')
   * Values are the actual content heights in pixels.
   */
  headerContentHeightsByRId?: Map<string, number>;
  /**
   * Actual measured header content heights per section-specific reference.
   *
   * Keys combine the relationship ID and section index using the form
   * `${rId}::s${sectionIndex}` so the reserve path can distinguish documents
   * that reuse the same header part across sections with different geometry.
   */
  headerContentHeightsBySectionRef?: Map<string, number>;
  /**
   * Actual measured footer content heights per relationship ID.
   * Used for multi-section documents where each section may have unique
   * footers referenced by their relationship IDs.
   *
   * Keys are relationship IDs (e.g., 'rId8', 'rId9')
   * Values are the actual content heights in pixels.
   */
  footerContentHeightsByRId?: Map<string, number>;
  /**
   * Actual measured footer content heights per section-specific reference.
   *
   * Keys combine the relationship ID and section index using the form
   * `${rId}::s${sectionIndex}` so the reserve path can distinguish documents
   * that reuse the same footer part across sections with different geometry.
   */
  footerContentHeightsBySectionRef?: Map<string, number>;
  /**
   * Allow body layout to synthesize page 1 for anchored tables when a document has
   * no anchor paragraphs and would otherwise render zero pages.
   *
   * Header/footer layout keeps this disabled to avoid changing long-standing
   * overlay behavior in paragraph-free header/footer regions.
   */
  allowParagraphlessAnchoredTableFallback?: boolean;
  allowParagraphlessAnchoredDrawingFallback?: boolean;
  /**
   * Allow body layout to synthesize page 1 when section metadata exists but no
   * renderable body blocks survive conversion.
   *
   * Header/footer layout keeps this disabled to preserve existing empty-region
   * behavior for paragraph-free overlays.
   */
  allowSectionBreakOnlyPageFallback?: boolean;
  /**
   * Whether the document has odd/even header/footer differentiation enabled.
   * Corresponds to the w:evenAndOddHeaders element in OOXML settings.xml.
   * When true, odd pages use the 'odd' variant and even pages use the 'even' variant.
   * When false or omitted, all pages use the 'default' variant.
   *
   * Must stay in sync with `getHeaderFooterTypeForSection` in
   * `layout-bridge/src/headerFooterUtils.ts` — both sides read this value
   * and must agree on variant selection.
   */
  alternateHeaders?: boolean;
  /**
   * Additive start context for page-boundary resume callers. Omitted input
   * preserves the historical page-1 start behavior.
   */
  startContext?: {
    /** Physical page-number offset for emitted `Page.number` values. */
    pageNumberOffset?: number;
    /** Display/effective page counter to stamp on the first emitted page. */
    activePageCounter?: number;
    /** Active section index at the page boundary. */
    activeSectionIndex?: number;
    /** Physical page number on which the active section began. */
    activeSectionFirstPageNumber?: number;
    /** Effective inherited header/footer refs at the resumed page boundary. */
    activeSectionRefs?: {
      headerRefs?: Partial<Record<'default' | 'first' | 'even' | 'odd', string>>;
      footerRefs?: Partial<Record<'default' | 'first' | 'even' | 'odd', string>>;
    };
    /** Effective page orientation at the resumed page boundary. */
    activeOrientation?: 'portrait' | 'landscape' | null;
    /**
     * Base (uninflated) top/bottom margins of the active section at the
     * resumed boundary (SD-3772 D2). These seed the section base state so a
     * resumed run can never re-inflate an already header/footer-inflated
     * effective margin; `options.margins` stays the document default so
     * later section breaks with missing fields fall back exactly like cold.
     */
    activeSectionBaseMargins?: { top: number; bottom: number };
    /** Active left/right margins of the resumed section. */
    activeSectionSideMargins?: { left: number; right: number };
    /** Active header/footer distances of the resumed section. */
    activeHeaderFooterDistances?: { header: number; footer: number };
    /** Active page size at the resumed boundary (document default when omitted). */
    activePageSize?: { w: number; h: number };
    /** Resolved active column layout at the resumed boundary. */
    activeColumns?: ColumnLayout;
    /** Engine-authored exact state for a flow-fragment boundary inside the first emitted page. */
    initialPageState?: {
      prefixFragments: readonly Page['fragments'][number][];
      cursorY: number;
      maxCursorY: number;
      committedBodyBottom?: number;
      columnIndex: number;
      trailingSpacing: number;
      lastParagraphStyleId?: string;
      lastParagraphContextualSpacing: boolean;
      lastParagraphBorderHash?: string;
      constraintBoundaries: readonly ConstraintBoundary[];
      activeConstraintIndex: number;
      footnoteDemandThisPage: number;
      footnoteRefsThisPage: number;
      footnoteAnchorsThisPage: readonly PageState['footnoteAnchorsThisPage'][number][];
    };
  };
  /**
   * Optional page-boundary stop callback. Called after a page has completed
   * and before the next page is created; returning true makes layoutDocument
   * return the completed prefix.
   */
  pageBoundary?: {
    shouldStopBeforeNewPage?: (input: { completedPageIndex: number; pages: readonly Page[] }) => boolean;
  };
};

export type HeaderFooterConstraints = {
  width: number;
  /** Body content height used as the measurement canvas (pagination boundary). */
  height: number;
  /** Actual page width for page-relative anchor positioning. */
  pageWidth?: number;
  /** Physical page height for vertical page-relative anchor conversion. */
  pageHeight?: number;
  /**
   * Page margins for anchor positioning.
   * `left`/`right`: horizontal page-relative conversion.
   * `top`/`bottom`: vertical margin-relative conversion and fallback footer band origin.
   * `header`: header distance from page top edge (header band origin).
   * `footer`: footer distance from page bottom edge (footer band origin).
   */
  margins?: {
    left: number;
    right: number;
    top?: number;
    bottom?: number;
    header?: number;
    footer?: number;
  };
  /**
   * Optional base height used to bound behindDoc overflow handling.
   * When provided, decorative assets far outside the header/footer band
   * won't inflate layout height.
   */
  overflowBaseHeight?: number;
};

const DEFAULT_PAGE_SIZE: PageSize = { w: 612, h: 792 }; // Letter portrait in px (8.5in × 11in @ 72dpi)
const DEFAULT_MARGINS: Margins = { top: 72, right: 72, bottom: 72, left: 72 };

const COLUMN_EPSILON = 0.0001;
const PAGE_START_EPSILON = 0.0001;
const SECTION_BOUNDARY_FURNITURE_EPSILON_PX = 2;

/**
 * Safely converts OOXML boolean-like values to actual booleans.
 * OOXML can encode booleans as true, 1, '1', 'true', or 'on'.
 */
const asBoolean = (value: unknown): boolean => {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'on';
  }
  return false;
};

const normalizeNonNegativeInteger = (value: unknown, fallback: number): number => {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
};

const normalizeInitialColumnIndex = (columns: ColumnLayout | undefined, value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const columnCount = resolveColumnCount(columns);
  return Math.max(0, Math.min(Math.floor(value), columnCount - 1));
};

/**
 * A DOCX pageBreakBefore paragraph only requires that the paragraph start on a
 * new page. If pagination has already advanced to the top of a fresh page
 * because of a preceding section break, applying the break again would create
 * an extra blank page that Word does not render.
 */
const shouldSkipRedundantPageBreakBefore = (block: PageBreakBlock, state: PageState | undefined): boolean => {
  if (block.attrs?.source !== 'pageBreakBefore') {
    return false;
  }

  if (!state) {
    return true;
  }

  const isAtTopOfFreshPage =
    state.page.fragments.length === 0 &&
    state.columnIndex === 0 &&
    Math.abs(state.cursorY - state.topMargin) <= PAGE_START_EPSILON;

  return isAtTopOfFreshPage;
};

/** An explicit page break (manual `w:br w:type="page"`), as opposed to a style/direct pageBreakBefore. */
const isExplicitPageBreakBlock = (block: FlowBlock | undefined): boolean => {
  return block?.kind === 'pageBreak' && (block as PageBreakBlock).attrs?.source !== 'pageBreakBefore';
};

/**
 * A paragraph that renders no content: every run is a text run with empty
 * text, and the paragraph paints no list marker. List markers ("1.", "•")
 * come from paragraph attrs (`numberingProperties` / `wordLayout.marker`),
 * not runs, so an empty-text list item is still visible page content.
 */
const isEmptyParagraphBlock = (block: FlowBlock | undefined): boolean => {
  if (block?.kind !== 'paragraph') return false;
  const paragraph = block as ParagraphBlock;
  if (paragraph.attrs?.numberingProperties || paragraph.attrs?.wordLayout?.marker) return false;
  const runs = paragraph.runs ?? [];
  return runs.every((run) => (run.kind === undefined || run.kind === 'text') && run.text === '');
};

/**
 * The projection splits a paragraph containing only `w:br w:type="page"`
 * into a page-break block plus an empty paragraph-mark remnant. Word starts
 * the following paragraph at the normal body top; the remnant is structural
 * and consumes no line or paragraph spacing. The generated break id is tied
 * to its source paragraph id, which keeps genuine empty paragraphs visible.
 */
const isSyntheticExplicitPageBreakRemnant = (blocks: readonly FlowBlock[], index: number): boolean => {
  const paragraph = blocks[index];
  const pageBreak = blocks[index - 1];
  if (!isEmptyParagraphBlock(paragraph) || !isExplicitPageBreakBlock(pageBreak)) return false;
  if (pageBreak.id.startsWith(`${paragraph.id}-pageBreak-`)) return true;
  const leadingParagraph = blocks[index - 2];
  return (
    leadingParagraph?.kind === 'paragraph' &&
    sourceParagraphKey(leadingParagraph) != null &&
    sourceParagraphKey(leadingParagraph) === sourceParagraphKey(paragraph)
  );
};

const isEditableExplicitPageBreakContinuation = (blocks: readonly FlowBlock[], index: number): boolean => {
  const paragraph = blocks[index];
  const leadingParagraph = blocks[index - 2];
  if (!isEmptyParagraphBlock(paragraph) || !isExplicitPageBreakBlock(blocks[index - 1])) return false;
  const sourceKey = sourceParagraphKey(paragraph);
  return sourceKey != null && sourceParagraphKey(leadingParagraph) === sourceKey;
};

const isTinyInlineBoundaryDrawingCandidate = (block: FlowBlock | undefined, measure: Measure | undefined): boolean => {
  if (block?.kind !== 'drawing' || measure?.kind !== 'drawing') return false;
  const drawing = block as DrawingBlock;
  if (drawing.anchor?.isAnchored === true) return false;
  if (drawing.drawingKind !== 'vectorShape' && drawing.drawingKind !== 'shapeGroup') return false;
  return Math.max(0, measure.height) <= SECTION_BOUNDARY_FURNITURE_EPSILON_PX;
};

const pageHasMeaningfulBodyContent = (
  page: Page,
  blocksById: ReadonlyMap<string, FlowBlock>,
  boundaryFillerBlockIds: ReadonlySet<string>,
): boolean => {
  for (const fragment of page.fragments) {
    if (boundaryFillerBlockIds.has(fragment.blockId)) continue;
    const block = blocksById.get(fragment.blockId);
    if (isInvisibleSectionBoundaryMarkerBlock(block)) continue;
    return true;
  }
  return false;
};

const isLineBreakOnlyParagraphBlock = (block: FlowBlock | undefined): block is ParagraphBlock => {
  if (block?.kind !== 'paragraph') return false;
  const runs = block.runs ?? [];
  return runs.length > 0 && runs.every((run) => run.kind === 'lineBreak');
};

const hasPositiveParagraphSpacing = (block: ParagraphBlock): boolean => {
  const spacing = block.attrs?.spacing as Record<string, unknown> | undefined;
  const before = Number(spacing?.before ?? spacing?.lineSpaceBefore ?? 0);
  const after = Number(spacing?.after ?? spacing?.lineSpaceAfter ?? 0);
  return before > 0 || after > 0;
};

const sourceParagraphKey = (block: FlowBlock | undefined): string | null => {
  const sourceRef = (block as { sourceAnchor?: { sourceRef?: { partUri?: unknown; xpathLikePath?: unknown } } })
    ?.sourceAnchor?.sourceRef;
  if (typeof sourceRef?.partUri !== 'string' || typeof sourceRef?.xpathLikePath !== 'string') {
    return null;
  }
  return `${sourceRef.partUri}::${sourceRef.xpathLikePath}`;
};

type SplitLineBreakAnchorCarrierMode = 'layoutOnly' | 'spaced';

const splitLineBreakAnchorCarrierMode = (
  blocks: readonly FlowBlock[],
  index: number,
): SplitLineBreakAnchorCarrierMode | null => {
  const current = blocks[index];
  const sibling = blocks[index + 1];
  const trailingParagraph = blocks[index + 2];
  if (!isLineBreakOnlyParagraphBlock(current)) return null;
  if (sibling?.kind !== 'image' && sibling?.kind !== 'drawing') return null;
  if (sibling.anchor?.isAnchored !== true) return null;
  if (trailingParagraph?.kind !== 'paragraph') return null;
  const currentKey = sourceParagraphKey(current);
  if (currentKey == null || currentKey !== sourceParagraphKey(trailingParagraph)) return null;
  return hasPositiveParagraphSpacing(current) ? 'spaced' : 'layoutOnly';
};

/**
 * Word collapses a style/direct pageBreakBefore when the paragraph directly
 * follows an explicit page break. The break paragraph's own empty remnant
 * (its paragraph mark, emitted as an empty paragraph block right after the
 * break) does not re-arm the break — but any other content does: one extra
 * empty paragraph, or text after the break in the same paragraph, and Word
 * renders the second page break again. Verified against Word renders of the
 * SD-3366 fixture matrix (shapes A-E).
 *
 * The directly-adjacent case (break at the end of a paragraph with content,
 * which emits no remnant) is already covered by the fresh-page geometric
 * guard above; this structural check covers the remnant case, where the
 * remnant fragment makes the fresh page non-empty.
 */
const isPageBreakBeforeSatisfiedByExplicitBreak = (blocks: readonly FlowBlock[], index: number): boolean => {
  const block = blocks[index];
  if (block?.kind !== 'pageBreak' || (block as PageBreakBlock).attrs?.source !== 'pageBreakBefore') {
    return false;
  }
  return isEmptyParagraphBlock(blocks[index - 1]) && isExplicitPageBreakBlock(blocks[index - 2]);
};

const hasOnlySectionBreakBlocks = (blocks: readonly FlowBlock[]): boolean => {
  return blocks.length > 0 && blocks.every((block) => block.kind === 'sectionBreak');
};

const layoutDebugEnabled =
  typeof process !== 'undefined' && typeof process.env !== 'undefined' && Boolean(process.env.SD_DEBUG_LAYOUT);

const layoutLog = (...args: unknown[]): void => {
  if (!layoutDebugEnabled) return;

  console.log(...args);
};

function* mapLayoutWorkCheckpoints<T>(
  steps: Generator<LayoutWorkCheckpoint, T, void>,
  phase: LayoutExecutionPhase,
): Generator<LayoutExecutionCheckpoint, T, void> {
  while (true) {
    const step = steps.next();
    if (step.done) return step.value;
    yield {
      phase,
      index: step.value.index,
      ...(step.value.total == null ? {} : { total: step.value.total }),
    };
  }
}

type FootnoteAnchorEntry = FootnoteAnchorRef;

const V2_RENDER_DIAGNOSTIC_PAGINATION_OWNER = Symbol.for('superdoc.v2.render-diagnostic.pagination-owner');
const V2_RENDER_DIAGNOSTIC_PAGINATION_PREFIX = Symbol.for('superdoc.v2.render-diagnostic.pagination-prefix');

type V2RenderDiagnosticPaginationProgress = {
  blocks: FlowBlock[];
  measures: Measure[];
  layout: Layout;
  failedBlockId: string;
  sourcePageRange: { firstPage: number; lastPage: number };
};

type V2RenderDiagnosticPaginationOwner = (input: {
  blockIds: readonly string[];
  debugDetail: unknown;
  phase: 'input' | 'dispatch';
  progress?: V2RenderDiagnosticPaginationProgress;
}) => Error | null;

function paginationInputFailure(block: FlowBlock, measure: Measure | undefined): Error | null {
  if (!measure) return new Error(`layoutDocument: missing measure for block ${block.id}`);
  const expectedKind =
    block.kind === 'paragraph' ||
    block.kind === 'image' ||
    block.kind === 'drawing' ||
    block.kind === 'table' ||
    block.kind === 'pageBreak' ||
    block.kind === 'columnBreak' ||
    block.kind === 'sectionBreak'
      ? block.kind
      : null;
  if (expectedKind == null) {
    return new Error(`layoutDocument: unsupported block kind for ${block.id}`);
  }
  if (measure.kind !== expectedKind) {
    return new Error(`layoutDocument: expected ${expectedKind} measure for block ${block.id}`);
  }
  if (block.kind === 'table' && measure.kind === 'table') {
    if (!Array.isArray(block.rows) || !Array.isArray(measure.rows)) {
      return new Error(`layoutDocument: invalid table row plane for block ${block.id}`);
    }
    if (measure.rows.length > 0 && measure.rows.length < block.rows.length) {
      return new Error(
        `layoutDocument: incomplete table row measure plane for block ${block.id} (rows=${block.rows.length}, measures=${measure.rows.length})`,
      );
    }
  }
  return null;
}

/**
 * Layout FlowBlocks into paginated fragments using measured line data.
 *
 * The function is intentionally deterministic: it walks the provided
 * FlowBlocks in order, consumes their Measure objects (same index),
 * and greedily stacks fragments inside the content box of each page/column.
 */
function* layoutDocumentSteps(
  blocks: FlowBlock[],
  measures: Measure[],
  options: LayoutOptions,
  checkpointEveryBlocks: number | null,
): Generator<LayoutExecutionCheckpoint, Layout, void> {
  const renderDiagnosticOwner = (
    options as LayoutOptions & {
      [V2_RENDER_DIAGNOSTIC_PAGINATION_OWNER]?: V2RenderDiagnosticPaginationOwner;
    }
  )[V2_RENDER_DIAGNOSTIC_PAGINATION_OWNER];
  if (checkpointEveryBlocks != null) {
    yield { phase: 'layout-document:prepare', index: 0, total: blocks.length };
  }
  if (blocks.length !== measures.length) {
    throw new Error(
      `layoutDocument expected measures for every block (blocks=${blocks.length}, measures=${measures.length})`,
    );
  }

  const blocksById = new Map<string, FlowBlock>();
  for (let index = 0; index < blocks.length; index += 1) {
    if (checkpointEveryBlocks != null && index % checkpointEveryBlocks === 0) {
      yield { phase: 'layout-document:preflight-section', index, total: blocks.length };
    }
    const block = blocks[index]!;
    let inputFailure: Error | null;
    try {
      inputFailure = paginationInputFailure(block, measures[index]);
    } catch (error) {
      inputFailure = error instanceof Error ? error : new Error('layoutDocument: unreadable pagination input');
    }
    if (inputFailure) {
      const owned = renderDiagnosticOwner?.({ blockIds: [block.id], debugDetail: inputFailure, phase: 'input' });
      if (owned) throw owned;
      throw inputFailure;
    }
    blocksById.set(block.id, block);
  }
  const sectionBoundaryFillerBlockIds = yield* mapLayoutWorkCheckpoints(
    collectSectionBoundaryFillerBlockIdsSteps(
      blocks,
      {
        isTinyInlineBoundaryDrawing: (block, index) => isTinyInlineBoundaryDrawingCandidate(block, measures[index]),
      },
      checkpointEveryBlocks,
    ),
    'layout-document:preflight-section',
  );

  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const pageNumberOffset = normalizeNonNegativeInteger(options.startContext?.pageNumberOffset, 0);
  const margins = {
    top: options.margins?.top ?? DEFAULT_MARGINS.top,
    right: options.margins?.right ?? DEFAULT_MARGINS.right,
    bottom: options.margins?.bottom ?? DEFAULT_MARGINS.bottom,
    left: options.margins?.left ?? DEFAULT_MARGINS.left,
    header: options.margins?.header ?? options.margins?.top ?? DEFAULT_MARGINS.top,
    footer: options.margins?.footer ?? options.margins?.bottom ?? DEFAULT_MARGINS.bottom,
  };

  const baseContentWidth = pageSize.w - (margins.left + margins.right);
  if (baseContentWidth <= 0) {
    throw new Error('layoutDocument: pageSize and margins yield non-positive content area');
  }

  /**
   * Validates and normalizes a header or footer content height value to ensure it is a non-negative finite number.
   * Used to validate both header and footer heights before using them in layout calculations.
   *
   * @param height - The content height value to validate (may be undefined)
   * @returns A valid non-negative number, or 0 if the input is invalid
   */
  const validateContentHeight = (height: number | undefined): number => {
    if (height === undefined) return 0;
    if (!Number.isFinite(height) || height < 0) return 0;
    return height;
  };

  // Store content heights for per-page margin calculation
  const headerContentHeights = options.headerContentHeights;
  const footerContentHeights = options.footerContentHeights;
  const headerContentHeightsByRId = options.headerContentHeightsByRId;
  const headerContentHeightsBySectionRef = options.headerContentHeightsBySectionRef;
  const footerContentHeightsByRId = options.footerContentHeightsByRId;
  const footerContentHeightsBySectionRef = options.footerContentHeightsBySectionRef;

  /**
   * Gets the header content height for a specific page, considering:
   * 1. Per-rId heights (highest priority for multi-section documents)
   * 2. Per-variant heights (fallback)
   *
   * @param variantType - The variant type ('first', 'default', 'even', 'odd')
   * @param headerRef - Optional relationship ID from section's headerRefs
   * @returns The appropriate header content height, or 0 if not found
   */
  const getHeaderHeightForPage = (
    variantType: 'default' | 'first' | 'even' | 'odd',
    headerRef?: string,
    sectionIndex?: number,
  ): number => {
    // Priority 1: Check section-aware heights when the same part is reused across sections.
    if (headerRef && sectionIndex != null) {
      const sectionKey = buildSectionAwareReferenceKey(headerRef, sectionIndex);
      if (headerContentHeightsBySectionRef?.has(sectionKey)) {
        return validateContentHeight(headerContentHeightsBySectionRef.get(sectionKey));
      }
    }
    // Priority 2: Check per-rId heights if we have a specific rId
    if (headerRef && headerContentHeightsByRId?.has(headerRef)) {
      return validateContentHeight(headerContentHeightsByRId.get(headerRef));
    }
    // Priority 3: Fall back to per-variant heights
    if (headerContentHeights) {
      return validateContentHeight(headerContentHeights[variantType]);
    }
    return 0;
  };

  /**
   * Gets the footer content height for a specific page, considering:
   * 1. Per-rId heights (highest priority for multi-section documents)
   * 2. Per-variant heights (fallback)
   *
   * @param variantType - The variant type ('first', 'default', 'even', 'odd')
   * @param footerRef - Optional relationship ID from section's footerRefs
   * @returns The appropriate footer content height, or 0 if not found
   */
  const getFooterHeightForPage = (
    variantType: 'default' | 'first' | 'even' | 'odd',
    footerRef?: string,
    sectionIndex?: number,
  ): number => {
    // Priority 1: Check section-aware heights when the same part is reused across sections.
    if (footerRef && sectionIndex != null) {
      const sectionKey = buildSectionAwareReferenceKey(footerRef, sectionIndex);
      if (footerContentHeightsBySectionRef?.has(sectionKey)) {
        return validateContentHeight(footerContentHeightsBySectionRef.get(sectionKey));
      }
    }
    // Priority 2: Check per-rId heights if we have a specific rId
    if (footerRef && footerContentHeightsByRId?.has(footerRef)) {
      return validateContentHeight(footerContentHeightsByRId.get(footerRef));
    }
    // Priority 3: Fall back to per-variant heights
    if (footerContentHeights) {
      return validateContentHeight(footerContentHeights[variantType]);
    }
    return 0;
  };

  /**
   * Calculates the effective top margin for a page based on its header content height.
   *
   * @param headerContentHeight - The actual header content height for this page
   * @param currentHeaderDistance - The header distance from page top
   * @param baseTopMargin - The base top margin from section/document settings
   * @returns The effective top margin that prevents body/header overlap
   */
  const calculateEffectiveTopMargin = (
    headerContentHeight: number,
    currentHeaderDistance: number,
    baseTopMargin: number,
  ): number => {
    if (headerContentHeight > 0) {
      return Math.max(baseTopMargin, currentHeaderDistance + headerContentHeight);
    }
    return baseTopMargin;
  };

  /**
   * Calculates the effective bottom margin for a page based on its footer content height.
   *
   * @param footerContentHeight - The actual footer content height for this page
   * @param currentFooterDistance - The footer distance from page bottom
   * @param baseBottomMargin - The base bottom margin from section/document settings
   * @returns The effective bottom margin that prevents body/footer overlap
   */
  const calculateEffectiveBottomMargin = (
    footerContentHeight: number,
    currentFooterDistance: number,
    baseBottomMargin: number,
  ): number => {
    if (footerContentHeight > 0) {
      return Math.max(baseBottomMargin, currentFooterDistance + footerContentHeight);
    }
    return baseBottomMargin;
  };

  const MIN_BODY_CONTENT_HEIGHT = 1;
  const clampHeaderFooterInflatedMargins = (
    topMargin: number,
    bottomMargin: number,
    baseTopMargin: number,
    baseBottomMargin: number,
    currentPageHeight: number,
  ): { top: number; bottom: number } => {
    const maxMarginTotal = currentPageHeight - MIN_BODY_CONTENT_HEIGHT;
    if (topMargin + bottomMargin <= maxMarginTotal) return { top: topMargin, bottom: bottomMargin };

    const baseMarginTotal = baseTopMargin + baseBottomMargin;
    if (baseMarginTotal >= maxMarginTotal) return { top: topMargin, bottom: bottomMargin };

    const topInflation = Math.max(0, topMargin - baseTopMargin);
    const bottomInflation = Math.max(0, bottomMargin - baseBottomMargin);
    const totalInflation = topInflation + bottomInflation;
    if (totalInflation <= 0) return { top: topMargin, bottom: bottomMargin };

    const availableInflation = maxMarginTotal - baseMarginTotal;
    return {
      top: baseTopMargin + availableInflation * (topInflation / totalInflation),
      bottom: baseBottomMargin + availableInflation * (bottomInflation / totalInflation),
    };
  };

  // Calculate the maximum header/footer content heights (used for fallback and section breaks)
  // These are still needed for cases where we don't have per-page information
  const maxHeaderContentHeight = headerContentHeights
    ? Math.max(
        0,
        validateContentHeight(headerContentHeights.default),
        validateContentHeight(headerContentHeights.first),
        validateContentHeight(headerContentHeights.even),
        validateContentHeight(headerContentHeights.odd),
      )
    : 0;
  const maxFooterContentHeight = footerContentHeights
    ? Math.max(
        0,
        validateContentHeight(footerContentHeights.default),
        validateContentHeight(footerContentHeights.first),
        validateContentHeight(footerContentHeights.even),
        validateContentHeight(footerContentHeights.odd),
      )
    : 0;

  // Initial effective margins use default variant (will be adjusted per-page)
  const headerDistance = margins.header ?? margins.top;
  const footerDistance = margins.footer ?? margins.bottom;
  const initialHeaderHeight = 0;
  const initialFooterHeight = 0;
  const effectiveMargins = clampHeaderFooterInflatedMargins(
    calculateEffectiveTopMargin(initialHeaderHeight, headerDistance, margins.top),
    calculateEffectiveBottomMargin(initialFooterHeight, footerDistance, margins.bottom),
    margins.top,
    margins.bottom,
    pageSize.h,
  );

  // SD-3772 D2: a page-boundary resume seeds the ACTIVE section state from
  // the checkpoint page instead of mutating the document-level options, so
  // later section breaks with missing fields fall back to the same document
  // defaults a cold run uses.
  const startContext = options.startContext;
  let activeTopMargin = startContext?.activeSectionBaseMargins?.top ?? effectiveMargins.top;
  let activeBottomMargin = startContext?.activeSectionBaseMargins?.bottom ?? effectiveMargins.bottom;
  let activeLeftMargin = startContext?.activeSectionSideMargins?.left ?? margins.left;
  let activeRightMargin = startContext?.activeSectionSideMargins?.right ?? margins.right;
  let pendingTopMargin: number | null = null;
  let pendingBottomMargin: number | null = null;
  let pendingLeftMargin: number | null = null;
  let pendingRightMargin: number | null = null;
  // Track section base margins (before header/footer inflation) for per-page adjustment.
  // These represent the section's configured margins, not the effective margins after
  // accounting for header/footer content height.
  let activeSectionBaseTopMargin = startContext?.activeSectionBaseMargins?.top ?? margins.top;
  let activeSectionBaseBottomMargin = startContext?.activeSectionBaseMargins?.bottom ?? margins.bottom;
  let pendingSectionBaseTopMargin: number | null = null;
  let pendingSectionBaseBottomMargin: number | null = null;
  let activeHeaderDistance = startContext?.activeHeaderFooterDistances?.header ?? margins.header ?? margins.top;
  let pendingHeaderDistance: number | null = null;
  let activeFooterDistance = startContext?.activeHeaderFooterDistances?.footer ?? margins.footer ?? margins.bottom;
  let pendingFooterDistance: number | null = null;

  // Track active and pending page size
  let activePageSize = startContext?.activePageSize
    ? { w: startContext.activePageSize.w, h: startContext.activePageSize.h }
    : { w: pageSize.w, h: pageSize.h };
  let pendingPageSize: { w: number; h: number } | null = null;

  // Track active and pending columns
  let activeColumns = cloneColumnLayout(startContext?.activeColumns ?? options.columns);
  let pendingColumns: ColumnLayout | null = null;
  const allowParagraphlessAnchoredTableFallback = options.allowParagraphlessAnchoredTableFallback !== false;
  const allowParagraphlessAnchoredDrawingFallback = options.allowParagraphlessAnchoredDrawingFallback !== false;
  const allowSectionBreakOnlyPageFallback = options.allowSectionBreakOnlyPageFallback !== false;

  // Track active and pending orientation
  let activeOrientation: 'portrait' | 'landscape' | null = options.startContext?.activeOrientation ?? null;
  let pendingOrientation: 'portrait' | 'landscape' | null = null;

  // Track active and pending vertical alignment for sections.
  // - activeVAlign: current alignment for pages being created (null = default 'top')
  // - pendingVAlign: scheduled alignment for next page boundary
  //   - undefined = no pending change (keep activeVAlign as-is)
  //   - null = reset to default 'top'
  //   - 'center'/'bottom'/'both' = change to that alignment
  let activeVAlign: SectionVerticalAlign | null = null;
  let pendingVAlign: SectionVerticalAlign | null | undefined = undefined;

  // Create floating-object manager for anchored image tracking
  const paginatorMargins = { left: activeLeftMargin, right: activeRightMargin };
  const floatManager = createFloatingObjectManager(
    normalizeColumns(activeColumns, activePageSize.w - (activeLeftMargin + activeRightMargin)),
    { left: activeLeftMargin, right: activeRightMargin },
    activePageSize.w,
  );

  // Will be aliased to paginator.pages/states after paginator is created

  // Pre-scan sectionBreak blocks to map each boundary to the NEXT section's properties.
  // DOCX uses end-tagged sectPr: the properties that should apply to the section starting
  // AFTER a boundary live on the NEXT section's sectPr (or the body sectPr for the final range).
  // By looking ahead here, we can ensure the page that starts after a break uses the upcoming
  // section's pageSize/margins/columns instead of the section that just ended.
  const nextSectionPropsAtBreak = yield* mapLayoutWorkCheckpoints(
    computeNextSectionPropsAtBreakSteps(blocks, checkpointEveryBlocks),
    'layout-document:preflight-section',
  );

  const resolveEffectiveSectionBreakBlock = (block: SectionBreakBlock, index: number): SectionBreakBlock => {
    const ahead = nextSectionPropsAtBreak.get(index);
    const hasSectionIndex = typeof block.attrs?.sectionIndex === 'number';
    // Only adjust properties for breaks originating from DOCX sectPr (end-tagged semantics).
    // Skip the lookahead for PM-adapter blocks that already embed upcoming section metadata
    // via sectionIndex; those blocks have pre-resolved properties and don't need the map.
    if (!ahead || block.attrs?.source !== 'sectPr' || hasSectionIndex) {
      return block;
    }
    return {
      ...block,
      margins: ahead.margins ? { ...block.margins, ...ahead.margins } : (block.margins ?? {}),
      pageSize: ahead.pageSize ?? block.pageSize,
      columns: ahead.columns ?? block.columns,
      orientation: ahead.orientation ?? block.orientation,
      vAlign: ahead.vAlign ?? block.vAlign,
    };
  };

  // Compatibility wrapper in case module resolution for section-breaks fails in certain runners
  const scheduleSectionBreakCompat = (
    block: SectionBreakBlock,
    state: SectionState,
    baseMargins: { top: number; bottom: number; left: number; right: number },
  ): {
    decision: {
      forcePageBreak: boolean;
      forceColumnBreak?: boolean;
      forceMidPageRegion: boolean;
      requiredParity?: 'even' | 'odd';
    };
    state: SectionState;
  } => {
    if (typeof scheduleSectionBreakExport === 'function') {
      return scheduleSectionBreakExport(block, state, baseMargins, maxHeaderContentHeight, maxFooterContentHeight);
    }
    // Fallback inline logic (mirrors section-breaks.ts)
    const next = { ...state };
    if (isInitialSectionBreak(block, next.hasAnyPages)) {
      if (block.pageSize) {
        next.activePageSize = { w: block.pageSize.w, h: block.pageSize.h };
        next.pendingPageSize = null;
      }
      if (block.orientation) {
        next.activeOrientation = block.orientation;
        next.pendingOrientation = null;
      }
      const headerDistance =
        typeof block.margins?.header === 'number' ? Math.max(0, block.margins.header) : next.activeHeaderDistance;
      const footerDistance =
        typeof block.margins?.footer === 'number' ? Math.max(0, block.margins.footer) : next.activeFooterDistance;
      const sectionTop = typeof block.margins?.top === 'number' ? Math.max(0, block.margins.top) : baseMargins.top;
      const sectionBottom =
        typeof block.margins?.bottom === 'number' ? Math.max(0, block.margins.bottom) : baseMargins.bottom;
      if (block.margins?.header !== undefined) {
        next.activeHeaderDistance = headerDistance;
        next.pendingHeaderDistance = headerDistance;
      }
      if (block.margins?.footer !== undefined) {
        next.activeFooterDistance = footerDistance;
        next.pendingFooterDistance = footerDistance;
      }
      if (block.margins?.top !== undefined || block.margins?.header !== undefined) {
        // Word always positions header at headerDistance from page top.
        // Body must start at headerDistance + headerContentHeight (where header content ends).
        const requiredTop = maxHeaderContentHeight > 0 ? headerDistance + maxHeaderContentHeight : 0;
        next.activeTopMargin = Math.max(sectionTop, requiredTop);
        next.pendingTopMargin = next.activeTopMargin;
      }
      if (block.margins?.bottom !== undefined || block.margins?.footer !== undefined) {
        // Word always positions footer at footerDistance from page bottom.
        // Body must end at footerDistance + footerContentHeight from page bottom.
        const requiredBottom = maxFooterContentHeight > 0 ? footerDistance + maxFooterContentHeight : 0;
        next.activeBottomMargin = Math.max(sectionBottom, requiredBottom);
        next.pendingBottomMargin = next.activeBottomMargin;
      }
      if (block.margins?.left !== undefined) {
        const leftMargin = Math.max(0, block.margins.left);
        next.activeLeftMargin = leftMargin;
        next.pendingLeftMargin = leftMargin;
      }
      if (block.margins?.right !== undefined) {
        const rightMargin = Math.max(0, block.margins.right);
        next.activeRightMargin = rightMargin;
        next.pendingRightMargin = rightMargin;
      }
      // Update columns - if section has columns, use them; if undefined, reset to single column.
      // In OOXML, absence of <w:cols> means single column (default).
      if (block.columns) {
        next.activeColumns = cloneColumnLayout(block.columns);
        next.pendingColumns = null;
      } else {
        // No columns specified = reset to single column (OOXML default)
        next.activeColumns = cloneColumnLayout(undefined);
        next.pendingColumns = null;
      }
      // Schedule section refs for first section (will be applied on first page creation)
      if (block.headerRefs || block.footerRefs) {
        const baseSectionRefs = pendingSectionRefs ?? activeSectionRefs;
        const nextSectionRefs = {
          ...(block.headerRefs && { headerRefs: block.headerRefs }),
          ...(block.footerRefs && { footerRefs: block.footerRefs }),
        };
        pendingSectionRefs = mergeSectionRefs(baseSectionRefs, nextSectionRefs);
        layoutLog(`[Layout] First section: Scheduled pendingSectionRefs:`, pendingSectionRefs);
      }
      // Set section index for first section
      const firstSectionIndexRaw = block.attrs?.sectionIndex;
      const firstMetadataIndex =
        typeof firstSectionIndexRaw === 'number' ? firstSectionIndexRaw : Number(firstSectionIndexRaw ?? NaN);
      if (Number.isFinite(firstMetadataIndex)) {
        activeSectionIndex = firstMetadataIndex;
      }
      // Set numbering for first section from metadata
      const firstSectionMetadata = Number.isFinite(firstMetadataIndex)
        ? getSectionMetadata(firstMetadataIndex)
        : undefined;
      if (firstSectionMetadata?.numbering) {
        if (firstSectionMetadata.numbering.format) activeNumberFormat = firstSectionMetadata.numbering.format;
        if (typeof firstSectionMetadata.numbering.start === 'number') {
          activePageCounter = firstSectionMetadata.numbering.start;
        }
      }
      return { decision: { forcePageBreak: false, forceMidPageRegion: false }, state: next };
    }
    const headerPx = block.margins?.header;
    const footerPx = block.margins?.footer;
    const topPx = block.margins?.top;
    const bottomPx = block.margins?.bottom;
    const leftPx = block.margins?.left;
    const rightPx = block.margins?.right;
    const nextTop = next.pendingTopMargin ?? next.activeTopMargin;
    const nextBottom = next.pendingBottomMargin ?? next.activeBottomMargin;
    const nextLeft = next.pendingLeftMargin ?? next.activeLeftMargin;
    const nextRight = next.pendingRightMargin ?? next.activeRightMargin;
    const nextHeader = next.pendingHeaderDistance ?? next.activeHeaderDistance;
    const nextFooter = next.pendingFooterDistance ?? next.activeFooterDistance;

    // Update header/footer distances first
    next.pendingHeaderDistance = typeof headerPx === 'number' ? Math.max(0, headerPx) : nextHeader;
    next.pendingFooterDistance = typeof footerPx === 'number' ? Math.max(0, footerPx) : nextFooter;

    // Account for actual header content height when calculating top margin
    // Recalculate if either top or header margin changes
    if (typeof headerPx === 'number' || typeof topPx === 'number') {
      const sectionTop = typeof topPx === 'number' ? Math.max(0, topPx) : baseMargins.top;
      const sectionHeader = next.pendingHeaderDistance;
      const requiredTop = maxHeaderContentHeight > 0 ? sectionHeader + maxHeaderContentHeight : sectionHeader;
      next.pendingTopMargin = Math.max(sectionTop, requiredTop);
    } else {
      next.pendingTopMargin = nextTop;
    }

    // Account for actual footer content height when calculating bottom margin
    if (typeof footerPx === 'number' || typeof bottomPx === 'number') {
      const sectionFooter = next.pendingFooterDistance;
      const sectionBottom = typeof bottomPx === 'number' ? Math.max(0, bottomPx) : baseMargins.bottom;
      const requiredBottom = maxFooterContentHeight > 0 ? sectionFooter + maxFooterContentHeight : sectionFooter;
      next.pendingBottomMargin = Math.max(sectionBottom, requiredBottom);
    } else {
      next.pendingBottomMargin = nextBottom;
    }
    next.pendingLeftMargin = typeof leftPx === 'number' ? Math.max(0, leftPx) : nextLeft;
    next.pendingRightMargin = typeof rightPx === 'number' ? Math.max(0, rightPx) : nextRight;
    if (block.pageSize) next.pendingPageSize = { w: block.pageSize.w, h: block.pageSize.h };
    if (block.orientation) next.pendingOrientation = block.orientation;
    const sectionType = block.type ?? 'continuous';
    // Columns change when the block's resolved RENDER layout differs from the active one (render
    // equality ignores raw equalWidth / surplus count that resolution discards), or when columns
    // reset to single (undefined). withSeparator is part of render equality: a sep-only toggle still
    // needs a new region so the renderer can start or stop the separator from the toggle point.
    const isColumnsChanging =
      (block.columns && !columnRenderLayoutsEqual(block.columns, next.activeColumns)) ||
      (!block.columns && (resolveColumnCount(next.activeColumns) > 1 || Boolean(next.activeColumns.withSeparator)));
    // Schedule section index change for next page (enables section-aware page numbering)
    const sectionIndexRaw = block.attrs?.sectionIndex;
    const metadataIndex = typeof sectionIndexRaw === 'number' ? sectionIndexRaw : Number(sectionIndexRaw ?? NaN);
    if (Number.isFinite(metadataIndex)) {
      pendingSectionIndex = metadataIndex;
    }
    // Get section metadata for numbering if available
    const sectionMetadata = Number.isFinite(metadataIndex) ? getSectionMetadata(metadataIndex) : undefined;
    // Schedule numbering change for next page - prefer metadata over block
    if (sectionMetadata?.numbering) {
      pendingNumbering = { ...sectionMetadata.numbering };
    } else if (block.numbering) {
      pendingNumbering = { ...block.numbering };
    }
    // Schedule section refs changes (apply at next page boundary)
    if (block.headerRefs || block.footerRefs) {
      const baseSectionRefs = pendingSectionRefs ?? activeSectionRefs;
      const nextSectionRefs = {
        ...(block.headerRefs && { headerRefs: block.headerRefs }),
        ...(block.footerRefs && { footerRefs: block.footerRefs }),
      };
      pendingSectionRefs = mergeSectionRefs(baseSectionRefs, nextSectionRefs);
      layoutLog(`[Layout] Compat fallback: Scheduled pendingSectionRefs:`, pendingSectionRefs);
    }
    // Helper to get column config: use block.columns if defined, otherwise reset to single column (OOXML default)
    const getColumnConfig = () => cloneColumnLayout(block.columns);

    if (block.attrs?.requirePageBoundary) {
      next.pendingColumns = getColumnConfig();
      return {
        decision: {
          forcePageBreak: true,
          forceMidPageRegion: false,
          ...(sectionType === 'nextPage' && block.requiredPageParity
            ? { requiredParity: block.requiredPageParity }
            : {}),
        },
        state: next,
      };
    }
    if (sectionType === 'nextPage') {
      next.pendingColumns = getColumnConfig();
      return {
        decision: {
          forcePageBreak: true,
          forceMidPageRegion: false,
          ...(block.requiredPageParity ? { requiredParity: block.requiredPageParity } : {}),
        },
        state: next,
      };
    }
    if (sectionType === 'nextColumn') {
      next.pendingColumns = getColumnConfig();
      // See scheduleSectionBreak('nextColumn'): advance column, never mid-page restart.
      return {
        decision: { forcePageBreak: false, forceColumnBreak: true, forceMidPageRegion: false },
        state: next,
      };
    }
    if (sectionType === 'evenPage') {
      next.pendingColumns = getColumnConfig();
      return { decision: { forcePageBreak: true, forceMidPageRegion: false, requiredParity: 'even' }, state: next };
    }
    if (sectionType === 'oddPage') {
      next.pendingColumns = getColumnConfig();
      return { decision: { forcePageBreak: true, forceMidPageRegion: false, requiredParity: 'odd' }, state: next };
    }
    if (isColumnsChanging) {
      next.pendingColumns = getColumnConfig();
      return { decision: { forcePageBreak: false, forceMidPageRegion: true }, state: next };
    }
    // For continuous section breaks, schedule column change for next page boundary
    next.pendingColumns = getColumnConfig();
    return { decision: { forcePageBreak: false, forceMidPageRegion: false }, state: next };
  };

  const createPage = (number: number, pageMargins: PageMargins, pageSizeOverride?: { w: number; h: number }): Page => {
    const page: Page = {
      number,
      fragments: [],
      margins: pageMargins,
      baseMargins: {
        top: activeSectionBaseTopMargin,
        bottom: activeSectionBaseBottomMargin,
      },
    };
    if (pageSizeOverride) {
      page.size = pageSizeOverride;
    }
    // Set orientation from active section state
    if (activeOrientation) {
      page.orientation = activeOrientation;
    }

    if (resolveColumnCount(activeColumns) > 1) {
      // Render-facing metadata: resolve so it never advertises more columns than render (SD-2629).
      page.columns = resolveColumnLayout(activeColumns);
    }

    // Set vertical alignment from active section state
    if (activeVAlign && activeVAlign !== 'top') {
      page.vAlign = activeVAlign;
    }
    // Store base section margins (before header/footer inflation) on EVERY
    // page. vAlign centering reads them (Word centers within base margins,
    // not margins inflated for header/footer height), and deep-checkpoint
    // resume (SD-3772) requires them so a resumed section base can never be
    // seeded from an already inflated effective margin.
    page.baseMargins = {
      top: activeSectionBaseTopMargin,
      bottom: activeSectionBaseBottomMargin,
    };
    return page;
  };

  // Pending-to-active application moved to section-breaks.applyPendingToActive

  /**
   * SD-3049: per-block footnote demand lookup. Resolves each footnote ref's pos
   * to the body block whose pm range contains it; sums those refs' measured
   * body heights into a `Map<blockId, demandPx>`. The body paragraph layout
   * consults this map at fragment-commit time to keep body packing tight to
   * footnote demand instead of relying on the post-hoc page-level reserve.
   *
   * Builds once per layoutDocument call. Empty-map fallback when there are
   * no footnotes — the consumer's lookup is a no-op in that case.
   *
   * Recurses into table cells so refs inside table-cell paragraphs are
   * charged to the *containing table block* (the unit `layoutTableBlock` lays
   * out and breaks at). This is a conservative approximation: demand from a
   * cell ref is charged to the whole table even if the table spans pages, so
   * the table may break one row earlier than strictly necessary. The existing
   * `footnoteBandOverflow.test.ts` is the safety net guaranteeing the band
   * never overflows the page bottom margin.
   */
  // SD-2656: per-block footnote anchor entries. Stored as a sorted list of
  // {pmPos, height} so the slicer can ask range-aware questions ("how much
  // footnote demand is anchored in lines [pmStart, pmEnd) of this block?").
  // Word's body break respects per-line anchor positions; charging the whole
  // block's demand at block entry (the old behavior) over-defers paragraphs
  // that have multiple anchors but where the first line only contains one of
  // them.
  // SD-2656: each anchor carries both full body height and first-line height.
  // The body slicer applies the ordered-cluster rule at break time:
  //   demand = sum(fullHeight of cluster[0..N-1]) + firstLineHeight(cluster[N-1])
  // i.e. all anchors except the last must fit fully; only the last may split.
  // Aliased to the public FootnoteAnchorRef so callers across packages share
  // one type. The shared iterator also checkpoints nested table/ref scans;
  // synchronous callers drain it with checkpoints disabled.
  const footnoteAnchorsByBlockId = yield* mapLayoutWorkCheckpoints(
    buildFootnoteAnchorIndexSteps(
      blocks,
      options.footnotes ? { ...options.footnotes, nativeRunOwnership: options.footnotePageFlow != null } : undefined,
      checkpointEveryBlocks,
    ),
    'layout-document:preflight-footnote',
  );

  if (checkpointEveryBlocks != null) {
    yield { phase: 'layout-document:prepare', index: blocks.length, total: blocks.length };
  }

  /**
   * SD-2656: return the ordered list of footnote anchor entries in
   * `[pmStart, pmEnd]` of the given block (or the whole block if no range).
   * Each entry carries `fullHeight` and `firstLineHeight`. The body slicer
   * combines this candidate list with PageState's committed anchors and
   * applies the ordered-cluster rule.
   */
  const getFootnoteAnchorsForBlockId = (blockId: string, pmStart?: number, pmEnd?: number): FootnoteAnchorEntry[] => {
    const entries = footnoteAnchorsByBlockId.get(blockId);
    if (!entries || entries.length === 0) return [];
    if (pmStart == null || pmEnd == null) return entries;
    const out: FootnoteAnchorEntry[] = [];
    for (const e of entries) {
      if (e.pmPos >= pmStart && e.pmPos <= pmEnd) out.push(e);
    }
    return out;
  };

  /**
   * Range-aware demand lookup under the ordered-cluster rule:
   *
   *   demand = sum(fullHeight of cluster[0..N-1]) + firstLineHeight(cluster[N-1])
   *
   * where `cluster` = committed anchors on the current page followed by the
   * candidate anchors in this block range. With no committed list provided,
   * treats the in-range entries as the full cluster.
   */
  const getFootnoteDemandForBlockId = (
    blockId: string,
    pmStart?: number,
    pmEnd?: number,
    committed?: ReadonlyArray<FootnoteAnchorEntry>,
  ): number => {
    const candidate = getFootnoteAnchorsForBlockId(blockId, pmStart, pmEnd);
    if (candidate.length === 0 && (!committed || committed.length === 0)) return 0;
    const cluster = committed && committed.length > 0 ? [...committed, ...candidate] : candidate;
    if (cluster.length === 0) return 0;
    let total = 0;
    for (let i = 0; i < cluster.length - 1; i += 1) total += cluster[i].fullHeight;
    total += cluster[cluster.length - 1].firstLineHeight;
    return total;
  };

  /**
   * Range-aware ref count. Used by the slicer to compute band overhead
   * (separator + per-extra-ref gap + safety margin) for the candidate slice.
   */
  const getFootnoteRefCountForBlockId = (blockId: string, pmStart?: number, pmEnd?: number): number => {
    const entries = footnoteAnchorsByBlockId.get(blockId);
    if (!entries || entries.length === 0) return 0;
    if (pmStart == null || pmEnd == null) return entries.length;
    let count = 0;
    for (const e of entries) {
      if (e.pmPos >= pmStart && e.pmPos <= pmEnd) count += 1;
    }
    return count;
  };

  /**
   * SD-2656: per-page footnote-band overhead in pixels. Matches the planner's
   * data-driven formula (incrementalLayout.ts:1488 — `separatorBefore +
   * separatorHeight + topPadding + (refs-1)*gap`). The slicer consults this
   * via ctx so its body-fit budget matches the planner's band-size budget
   * exactly. The defaults below mirror the planner's defaults so legacy /
   * test callers that don't populate overhead fields still get correct math.
   */
  const getFootnoteBandOverhead = (() => {
    const fn = options.footnotes as
      | {
          topPadding?: number;
          dividerHeight?: number;
          separatorSpacingBefore?: number;
          gap?: number;
        }
      | undefined;
    const safeNum = (v: number | undefined, fallback: number): number =>
      typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
    // Defaults match incrementalLayout.ts:1330-1342 (gap=2, topPadding=6,
    // dividerHeight=6) and DEFAULT_FOOTNOTE_SEPARATOR_SPACING_BEFORE=12.
    // The planner threads its measured `separatorSpacingBefore` (typically
    // the first-fn lineHeight) through `options.footnotes` so subsequent
    // passes converge with this slicer.
    const topPadding = safeNum(fn?.topPadding, 6);
    const dividerHeight = safeNum(fn?.dividerHeight, 6);
    const separatorSpacingBefore = safeNum(fn?.separatorSpacingBefore, 12);
    const gap = safeNum(fn?.gap, 2);
    return (refsTotal: number): number => {
      if (refsTotal <= 0) return 0;
      return topPadding + dividerHeight + separatorSpacingBefore + Math.max(0, refsTotal - 1) * gap;
    };
  })();

  // Paginator encapsulation for page/column helpers
  let pageCount = 0;
  // Page numbering state
  let activeNumberFormat: PageNumberFormat = 'decimal';
  let activePageCounter = 1;
  let activeSectionPageCounterStart = activePageCounter;
  let pendingNumbering: SectionNumbering | null = null;
  // Section header/footer ref tracking state
  type SectionRefs = {
    headerRefs?: Partial<Record<'default' | 'first' | 'even' | 'odd', string>>;
    footerRefs?: Partial<Record<'default' | 'first' | 'even' | 'odd', string>>;
  };
  const normalizeRefs = (
    refs?: Partial<Record<'default' | 'first' | 'even' | 'odd', string>>,
  ): Partial<Record<'default' | 'first' | 'even' | 'odd', string>> | undefined =>
    refs && Object.keys(refs).length > 0 ? refs : undefined;
  const mergeSectionRefs = (base: SectionRefs | null, next: SectionRefs | null): SectionRefs | null => {
    if (!base && !next) return null;
    const headerRefs = normalizeRefs(next?.headerRefs) ?? normalizeRefs(base?.headerRefs);
    const footerRefs = normalizeRefs(next?.footerRefs) ?? normalizeRefs(base?.footerRefs);
    if (!headerRefs && !footerRefs) return null;
    return {
      ...(headerRefs && { headerRefs }),
      ...(footerRefs && { footerRefs }),
    };
  };
  const sectionMetadataList = options.sectionMetadata ?? [];
  const sectionMetadataByIndex = new Map<number, SectionMetadata>();
  sectionMetadataList.forEach((section, fallbackIndex) => {
    const sectionIndex = section.sectionIndex ?? fallbackIndex;
    if (!sectionMetadataByIndex.has(sectionIndex)) sectionMetadataByIndex.set(sectionIndex, section);
  });
  const getSectionMetadata = (sectionIndex: number) => sectionMetadataByIndex.get(sectionIndex);
  const headerFooterResolutionIndex = createHeaderFooterResolutionIndex(
    Array.from(sectionMetadataByIndex, ([sectionIndex, section]) => ({
      sectionIndex,
      titlePg: section.titlePg === true,
      headerRefs: section.headerRefs,
      footerRefs: section.footerRefs,
    })),
  );
  const updateRuntimeSectionRefs = (sectionIndex: number, runtimeRefs: SectionRefs): void => {
    const metadata = getSectionMetadata(sectionIndex);
    headerFooterResolutionIndex.updateSection({
      sectionIndex,
      titlePg: metadata?.titlePg === true,
      headerRefs: runtimeRefs.headerRefs ?? metadata?.headerRefs,
      footerRefs: runtimeRefs.footerRefs ?? metadata?.footerRefs,
    });
  };
  const initialSectionIndex =
    typeof options.startContext?.activeSectionIndex === 'number' &&
    Number.isFinite(options.startContext.activeSectionIndex)
      ? options.startContext.activeSectionIndex
      : (sectionMetadataList[0]?.sectionIndex ?? 0);
  const initialSectionMetadata = getSectionMetadata(initialSectionIndex) ?? sectionMetadataList[0];
  if (initialSectionMetadata?.numbering?.format) {
    activeNumberFormat = initialSectionMetadata.numbering.format;
  }
  if (typeof initialSectionMetadata?.numbering?.start === 'number') {
    activePageCounter = initialSectionMetadata.numbering.start;
    activeSectionPageCounterStart = activePageCounter;
  }
  if (
    typeof options.startContext?.activePageCounter === 'number' &&
    Number.isFinite(options.startContext.activePageCounter)
  ) {
    activePageCounter = options.startContext.activePageCounter;
    activeSectionPageCounterStart = activePageCounter;
  }
  let activeSectionRefs: SectionRefs | null = null;
  let pendingSectionRefs: SectionRefs | null = null;
  if (options.startContext?.activeSectionRefs) {
    activeSectionRefs = options.startContext.activeSectionRefs;
    updateRuntimeSectionRefs(initialSectionIndex, activeSectionRefs);
  } else if (initialSectionMetadata?.headerRefs || initialSectionMetadata?.footerRefs) {
    activeSectionRefs = {
      ...(initialSectionMetadata.headerRefs && { headerRefs: initialSectionMetadata.headerRefs }),
      ...(initialSectionMetadata.footerRefs && { footerRefs: initialSectionMetadata.footerRefs }),
    };
    updateRuntimeSectionRefs(initialSectionMetadata.sectionIndex ?? 0, activeSectionRefs);
  }
  // Initialize vertical alignment from first section metadata (for page 1)
  if (initialSectionMetadata?.vAlign) {
    activeVAlign = initialSectionMetadata.vAlign;
  }
  // Section index tracking for multi-section page numbering and header/footer selection
  let activeSectionIndex: number = initialSectionIndex;
  let pendingSectionIndex: number | null = null;

  // Track the first page number for each section (for determining 'first' variant)
  // Map<sectionIndex, firstPageNumber>
  const sectionFirstPageNumbers = new Map<number, number>();
  if (
    typeof options.startContext?.activeSectionFirstPageNumber === 'number' &&
    Number.isFinite(options.startContext.activeSectionFirstPageNumber)
  ) {
    sectionFirstPageNumbers.set(
      activeSectionIndex,
      Math.max(1, Math.floor(options.startContext.activeSectionFirstPageNumber)),
    );
  }

  // SD-3049: read the page-level reserve via a single helper so the same
  // value flows into both `getActiveBottomMargin` (existing behavior) and
  // `getFootnoteReserveForPage` (new — for the block-aware break decision).
  const readFootnoteReserveForPageIndex = (pageIndex: number): number => {
    if (options.footnotePageFlow) return 0;
    const reserves = options.footnoteReservedByPageIndex;
    const reserve = Array.isArray(reserves) ? reserves[pageIndex] : 0;
    return typeof reserve === 'number' && Number.isFinite(reserve) && reserve > 0 ? reserve : 0;
  };

  const completedFootnotePages = new WeakSet<Page>();
  const completeFootnotePage = (state: PageState): void => {
    if (!options.footnotePageFlow || completedFootnotePages.has(state.page)) return;
    options.footnotePageFlow.completePage({
      page: state.page,
      pageIndex: state.page.number - 1,
      bodyBottom: state.committedBodyBottom ?? state.topMargin,
      physicalBottom: state.contentBottom + state.pageFootnoteReserve,
      anchors: state.footnoteAnchorsThisPage,
    });
    completedFootnotePages.add(state.page);
  };
  const paginator = createPaginator({
    margins: paginatorMargins,
    getActiveTopMargin: () => activeTopMargin,
    getActiveBottomMargin: () => {
      const pageIndex = Math.max(0, pageCount - 1);
      return activeBottomMargin + readFootnoteReserveForPageIndex(pageIndex);
    },
    getFootnoteReserveForPage: (pageIndex: number) => readFootnoteReserveForPageIndex(pageIndex),
    getActiveHeaderDistance: () => activeHeaderDistance,
    getActiveFooterDistance: () => activeFooterDistance,
    getActivePageSize: () => activePageSize,
    getDefaultPageSize: () => pageSize,
    getActiveColumns: () => activeColumns,
    initialPageState: options.startContext?.initialPageState,
    pageNumberOffset,
    keepNoteOnlyPages: options.footnotePageFlow != null,
    createPage,
    shouldStopBeforeNewPage:
      options.pageBoundary?.shouldStopBeforeNewPage || options.footnotePageFlow
        ? ({ completedPageIndex, pages: completedPages, states: completedStates }) => {
            completeFootnotePage(completedStates[completedPageIndex]);
            return (
              options.pageBoundary?.shouldStopBeforeNewPage?.({
                completedPageIndex,
                pages: completedPages,
              }) ?? false
            );
          }
        : undefined,
    onNewPage: (state?: PageState, pageStartOptions?: { applyPendingSection: boolean }) => {
      // apply pending->active and invalidate columns cache (first callback)
      if (!state) {
        const applyPendingSection = pageStartOptions?.applyPendingSection !== false;
        // Track if we're entering a new section (pendingSectionIndex was just set)
        const isEnteringNewSection = applyPendingSection && pendingSectionIndex !== null;
        const isApplyingPendingSection =
          applyPendingSection &&
          (pendingTopMargin !== null ||
            pendingBottomMargin !== null ||
            pendingLeftMargin !== null ||
            pendingRightMargin !== null ||
            pendingHeaderDistance !== null ||
            pendingFooterDistance !== null ||
            pendingPageSize !== null ||
            pendingColumns !== null ||
            pendingOrientation !== null ||
            pendingNumbering !== null ||
            pendingSectionRefs !== null ||
            pendingSectionIndex !== null ||
            pendingVAlign !== undefined ||
            pendingSectionBaseTopMargin !== null ||
            pendingSectionBaseBottomMargin !== null);

        if (applyPendingSection) {
          const applied = applyPendingToActive({
            activeTopMargin,
            activeBottomMargin,
            activeLeftMargin,
            activeRightMargin,
            pendingTopMargin,
            pendingBottomMargin,
            pendingLeftMargin,
            pendingRightMargin,
            activeHeaderDistance,
            activeFooterDistance,
            pendingHeaderDistance,
            pendingFooterDistance,
            activePageSize,
            pendingPageSize,
            activeColumns,
            pendingColumns,
            activeOrientation,
            pendingOrientation,
            hasAnyPages: pageCount > 0,
          });
          activeTopMargin = applied.activeTopMargin;
          activeBottomMargin = applied.activeBottomMargin;
          activeLeftMargin = applied.activeLeftMargin;
          activeRightMargin = applied.activeRightMargin;
          pendingTopMargin = applied.pendingTopMargin;
          pendingBottomMargin = applied.pendingBottomMargin;
          pendingLeftMargin = applied.pendingLeftMargin;
          pendingRightMargin = applied.pendingRightMargin;
          activeHeaderDistance = applied.activeHeaderDistance;
          activeFooterDistance = applied.activeFooterDistance;
          pendingHeaderDistance = applied.pendingHeaderDistance;
          pendingFooterDistance = applied.pendingFooterDistance;
          activePageSize = applied.activePageSize;
          pendingPageSize = applied.pendingPageSize;
          activeColumns = applied.activeColumns;
          pendingColumns = applied.pendingColumns;
          activeOrientation = applied.activeOrientation;
          pendingOrientation = applied.pendingOrientation;
          cachedColumnsState.state = null;
          paginatorMargins.left = activeLeftMargin;
          paginatorMargins.right = activeRightMargin;
          const contentWidth = activePageSize.w - (activeLeftMargin + activeRightMargin);
          floatManager.setLayoutContext(
            normalizeColumns(activeColumns, contentWidth),
            { left: activeLeftMargin, right: activeRightMargin },
            activePageSize.w,
          );
          // Apply pending numbering
          if (pendingNumbering) {
            if (pendingNumbering.format) activeNumberFormat = pendingNumbering.format;
            if (typeof pendingNumbering.start === 'number' && Number.isFinite(pendingNumbering.start)) {
              activePageCounter = pendingNumbering.start as number;
            }
            pendingNumbering = null;
          }
          // Apply pending section refs
          if (pendingSectionRefs) {
            activeSectionRefs = mergeSectionRefs(activeSectionRefs, pendingSectionRefs);
            pendingSectionRefs = null;
          }
          // Apply pending section index
          if (pendingSectionIndex !== null) {
            activeSectionIndex = pendingSectionIndex;
            pendingSectionIndex = null;
          }
          if (activeSectionRefs) {
            updateRuntimeSectionRefs(activeSectionIndex, activeSectionRefs);
          }
          // Apply pending vertical alignment (undefined = no change, null = reset to default)
          if (pendingVAlign !== undefined) {
            activeVAlign = pendingVAlign;
            pendingVAlign = undefined;
          }
          // Apply pending section base margins
          if (pendingSectionBaseTopMargin !== null) {
            activeSectionBaseTopMargin = pendingSectionBaseTopMargin;
            pendingSectionBaseTopMargin = null;
          }
          if (pendingSectionBaseBottomMargin !== null) {
            activeSectionBaseBottomMargin = pendingSectionBaseBottomMargin;
            pendingSectionBaseBottomMargin = null;
          }
          if (isApplyingPendingSection) {
            activeSectionPageCounterStart = activePageCounter;
          }
        }
        pageCount += 1;

        // Calculate the page number for this new page
        const newPageNumber = pageCount + pageNumberOffset;

        // Track first page of section if this is a new section or the first page ever
        if (isEnteringNewSection || !sectionFirstPageNumbers.has(activeSectionIndex)) {
          sectionFirstPageNumbers.set(activeSectionIndex, newPageNumber);
        }

        // Calculate section-relative page number
        const firstPageInSection = sectionFirstPageNumbers.get(activeSectionIndex) ?? newPageNumber;
        const sectionPageNumber = newPageNumber - firstPageInSection + 1;

        // Get section metadata for titlePg setting
        const sectionMetadata = getSectionMetadata(activeSectionIndex);
        const titlePgEnabled = sectionMetadata?.titlePg ?? false;
        const alternateHeaders = options.alternateHeaders ?? false;

        // Determine which header/footer variant applies to this page.
        const variantType = selectHeaderFooterVariantForPage({
          sectionPageNumber,
          documentPageNumber: activePageCounter,
          titlePg: titlePgEnabled,
          alternateHeaders,
        });

        const headerResolved =
          variantType && headerFooterResolutionIndex.resolve(activeSectionIndex, 'header', variantType);
        const footerResolved =
          variantType && headerFooterResolutionIndex.resolve(activeSectionIndex, 'footer', variantType);

        const hasHeaderRefs = headerFooterResolutionIndex.hasAny('header');
        const hasFooterRefs = headerFooterResolutionIndex.hasAny('footer');
        const headerHeight = headerResolved
          ? getHeaderHeightForPage(headerResolved.matchedVariant, headerResolved.refId, activeSectionIndex)
          : variantType && !hasHeaderRefs
            ? getHeaderHeightForPage(variantType, undefined, activeSectionIndex)
            : 0;
        const footerHeight = footerResolved
          ? getFooterHeightForPage(footerResolved.matchedVariant, footerResolved.refId, activeSectionIndex)
          : variantType && !hasFooterRefs
            ? getFooterHeightForPage(variantType, undefined, activeSectionIndex)
            : 0;

        // Adjust margins based on the actual header/footer for this page.
        // Always recalculate to ensure pages without headers reset to base margin
        // (not the inflated margin from a previous page with a header).
        // Use section base margins, not document defaults, for correct per-section behavior.
        const adjustedMargins = clampHeaderFooterInflatedMargins(
          calculateEffectiveTopMargin(headerHeight, activeHeaderDistance, activeSectionBaseTopMargin),
          calculateEffectiveBottomMargin(footerHeight, activeFooterDistance, activeSectionBaseBottomMargin),
          activeSectionBaseTopMargin,
          activeSectionBaseBottomMargin,
          activePageSize.h,
        );
        activeTopMargin = adjustedMargins.top;
        activeBottomMargin = adjustedMargins.bottom;

        layoutLog(
          `[Layout] Page ${newPageNumber}: Using variant '${variantType ?? 'none'}' - headerHeight: ${headerHeight}, footerHeight: ${footerHeight}`,
        );
        layoutLog(
          `[Layout] Page ${newPageNumber}: Adjusted margins - top: ${activeTopMargin}, bottom: ${activeBottomMargin} (base: ${activeSectionBaseTopMargin}, ${activeSectionBaseBottomMargin})`,
        );

        return;
      }

      // second callback: after page creation -> stamp display number, section refs, section index, and advance counter
      if (state?.page) {
        state.page.displayNumber = activePageCounter;
        state.page.numberText = formatPageNumber(activePageCounter, activeNumberFormat);
        state.page.effectivePageNumber = activePageCounter;
        const firstPageInSection = sectionFirstPageNumbers.get(activeSectionIndex) ?? state.page.number;
        state.page.sectionPageNumber = state.page.number - firstPageInSection + 1;
        // Stamp section index on the page for section-aware page numbering and header/footer selection
        state.page.sectionIndex = activeSectionIndex;
        layoutLog(`[Layout] Page ${state.page.number}: Stamped sectionIndex:`, activeSectionIndex);
        // Stamp section refs on the page for per-section header/footer selection
        if (activeSectionRefs) {
          state.page.sectionRefs = {
            ...(activeSectionRefs.headerRefs && { headerRefs: activeSectionRefs.headerRefs }),
            ...(activeSectionRefs.footerRefs && { footerRefs: activeSectionRefs.footerRefs }),
          };
          layoutLog(`[Layout] Page ${state.page.number}: Stamped sectionRefs:`, state.page.sectionRefs);
        } else {
          layoutLog(`[Layout] Page ${state.page.number}: No activeSectionRefs to stamp`);
        }
        activePageCounter += 1;
      }
    },
  });
  // Alias local references to paginator-managed arrays
  const pages = paginator.pages;
  const states = paginator.states;

  // Helper to get current column configuration (respects constraint boundaries)
  const getActiveColumnsForState = paginator.getActiveColumnsForState;

  // Helper to get normalized columns for current page size
  let cachedColumnsState: {
    state: PageState | null;
    constraintIndex: number;
    contentWidth: number;
    colsConfig: ColumnLayout | null;
    normalized: NormalizedColumns | null;
  } = { state: null, constraintIndex: -2, contentWidth: -1, colsConfig: null, normalized: null };

  const getCurrentColumns = (): NormalizedColumns => {
    const currentContentWidth = activePageSize.w - (activeLeftMargin + activeRightMargin);
    const state = states[states.length - 1] ?? null;
    const colsConfig = state ? getActiveColumnsForState(state) : activeColumns;
    const constraintIndex = state ? state.activeConstraintIndex : -1;

    if (
      cachedColumnsState.state === state &&
      cachedColumnsState.constraintIndex === constraintIndex &&
      cachedColumnsState.contentWidth === currentContentWidth &&
      columnRenderLayoutsEqual(cachedColumnsState.colsConfig ?? undefined, colsConfig) &&
      cachedColumnsState.normalized
    ) {
      return cachedColumnsState.normalized;
    }

    const normalized = normalizeColumns(colsConfig, currentContentWidth);
    cachedColumnsState = {
      state,
      constraintIndex,
      contentWidth: currentContentWidth,
      colsConfig: cloneColumnLayout(colsConfig),
      normalized,
    };
    return normalized;
  };

  // SD-2629: state-aware resolved geometry. Derives from the SAME state's columns + page size +
  // margins (NOT the global latest-section values), so positioning an older page uses that page's
  // own geometry. Behavior-identical to getCurrentColumns for the latest state and constant margins,
  // and more correct for older pages once section margins/size vary.
  const getNormalizedColumnsForState = (state: PageState): NormalizedColumns => {
    // Columns for THIS page: the active mid-page region's config if one applies, else the page's own
    // creation-time snapshot (page.columns, the resolved metadata set in createPage). NOT
    // getActiveColumnsForState, which falls back to the global latest-section columns and would
    // mis-position an older page once columns vary across sections. (SD-2629)
    const cols =
      state.activeConstraintIndex >= 0 && state.constraintBoundaries[state.activeConstraintIndex]
        ? state.constraintBoundaries[state.activeConstraintIndex].columns
        : (state.page.columns ?? { count: 1, gap: 0 });
    const pageWidth = state.page.size?.w ?? pageSize.w;
    // page.margins is always set by createPage but optional in the type; fall back to the current
    // active margins (the guard never fires at runtime).
    const left = state.page.margins?.left ?? activeLeftMargin;
    const right = state.page.margins?.right ?? activeRightMargin;
    return normalizeColumns(cols, pageWidth - (left + right));
  };

  const getColumnGeometryForState = (state: PageState): ColumnGeometry[] =>
    getColumnGeometry(getNormalizedColumnsForState(state));

  const columnWidthForState = (state: PageState, columnIndex: number = state.columnIndex): number =>
    getColumnWidth(getColumnGeometryForState(state), columnIndex);

  const columnXForState = (state: PageState, columnIndex: number = state.columnIndex): number =>
    getColumnX(getColumnGeometryForState(state), columnIndex, state.page.margins?.left ?? activeLeftMargin);

  const getCurrentColumnWidth = (): number => {
    const state = states[states.length - 1] ?? null;
    return state ? columnWidthForState(state) : getColumnWidthAt(getCurrentColumns(), 0);
  };

  // Helper to get column X position (state-aware; positions the passed page state, SD-2629).
  const columnX = columnXForState;

  const advanceColumn = paginator.advanceColumn;

  // Start a new mid-page region with different column configuration
  const startMidPageRegion = (state: PageState, newColumns: ColumnLayout): void => {
    // Use the maximum Y reached across all columns so the new region starts
    // below ALL column content, not just the current column's cursor position.
    // This prevents overlap when a multi-column section's columns have unequal heights.
    const regionStartY = Math.max(state.cursorY, state.maxCursorY);
    state.cursorY = regionStartY;
    state.maxCursorY = regionStartY;

    // Record the boundary at the resolved Y position
    const boundary: ConstraintBoundary = {
      y: regionStartY,
      columns: newColumns,
    };
    state.constraintBoundaries.push(boundary);
    state.activeConstraintIndex = state.constraintBoundaries.length - 1;

    // Reset to first column with new configuration
    state.columnIndex = 0;

    layoutLog(`[Layout] *** COLUMNS CHANGED MID-PAGE ***`);
    layoutLog(`  OLD activeColumns: ${JSON.stringify(activeColumns)}`);
    layoutLog(`  NEW activeColumns: ${JSON.stringify(newColumns)}`);
    layoutLog(`  Current page: ${state.page.number}, cursorY: ${state.cursorY}, maxCursorY: ${state.maxCursorY}`);

    // Update activeColumns so subsequent pages use this column configuration
    activeColumns = cloneColumnLayout(newColumns);

    // Invalidate columns cache to ensure recalculation with new region
    cachedColumnsState.state = null;

    const contentWidth = activePageSize.w - (activeLeftMargin + activeRightMargin);
    floatManager.setLayoutContext(
      normalizeColumns(activeColumns, contentWidth),
      { left: activeLeftMargin, right: activeRightMargin },
      activePageSize.w,
    );
  };

  // Build shared maps for column balancing. These are consumed both mid-layout
  // (at continuous section-break boundaries) and post-layout (per-section final
  // page), so we construct them once here rather than rebuilding in each pass.
  const balancingMeasureMap = new Map<string, MeasureData>();
  const blockSectionMap = new Map<string, number>();
  const sectionColumnsMap = new Map<number, ColumnLayout>();
  const sectionHasExplicitColumnBreak = new Set<number>();
  // sectionIndex -> the section's own sectPr `w:type` (ECMA-376 §17.6.22):
  // how the section BEGINS relative to its predecessor — i.e. the type of the
  // break that closes the PREVIOUS section. The break that ENDS section N is
  // therefore `get(N + 1)`. Per ECMA-376 §17.18.77 only a `continuous` break
  // balances the section BEFORE it — `nextPage`, `evenPage`, `oddPage` do
  // not. (The earlier comment here claimed end-break semantics, which led the
  // post-layout gate to key off the wrong section — SD-3359.)
  const sectionEndBreakType = new Map<number, string>();
  // sectionIndex -> whether `<w:type>` was EXPLICIT in the source sectPr.
  // Body sectPrs default to `continuous` when w:type is omitted; Word does
  // NOT balance those single-page docs (sd-1655). Body sectPrs with explicit
  // `<w:type w:val="continuous"/>` DO balance (sd-1480), even single-page.
  // The flag carries the distinction across pm-adapter -> layout-engine.
  const sectionTypeIsExplicit = new Map<number, boolean>();
  // sectionIndex of the LAST section in the document. The body sectPr is
  // always the final section break and represents the end of the document,
  // not an actual mid-document break. Even when its type defaults to
  // `continuous` (DEFAULT_BODY_SECTION_TYPE), there is no break AFTER the
  // last section's content to trigger balancing. Excluding the last section
  // matches Word: a 3-column doc with only a body sectPr (e.g.
  // `sd-1655-col-sep-3-equal-columns`) is NOT balanced — content fills
  // top-to-bottom by column. Without this guard the previous post-layout
  // pass over-balanced single-section docs and split heading/body across
  // columns when Word kept them together.
  let lastSectionIdx: number | null = null;
  // Block IDs of empty paragraphs that exist only to carry sectPr properties.
  // These are invisible in Word's output and must contribute zero height to
  // balanced columns (ECMA-376 §17.18.77). Threading explicit metadata avoids
  // the older `line.width === 0` heuristic, which incorrectly collapsed normal
  // blank paragraphs and caused overlap on the next paragraph.
  const sectPrMarkerBlockIds = new Set<string>();
  // Block IDs of paragraphs with `w:keepLines` (ECMA-376 §17.3.1.14): the
  // author asked Word not to split these, so column balancing must keep them
  // atomic instead of breaking them at a line boundary. (SD-3359)
  const keepLinesBlockIds = new Set<string>();
  // True if any block in the document is a column break. Used as a guard for
  // the document-wide balancing fallback: when callers use
  // LayoutOptions.columns without section metadata, we still want Word's
  // balanced-final-page behavior unless the author placed an explicit column
  // break, in which case we preserve their intent.
  let documentHasExplicitColumnBreak = false;
  // True if any block in the document is a sectionBreak. The document-wide
  // fallback only fires when there are NO sectionBreak blocks — otherwise the
  // section-scoped path is the source of truth (even if pm-adapter or a
  // synthetic caller didn't stamp `attrs.sectionIndex`, treating it as a
  // single fallback section would clobber regions that the mid-page handler
  // already balanced).
  let documentHasAnySectionBreak = false;
  // Tracks sections already balanced mid-page — the post-layout pass skips these
  // to avoid double-balancing, which would overlap fragments at the same x/y.
  const alreadyBalancedSections = new Set<number>();
  // Walk blocks in document order. sectionBreak blocks carry attrs.sectionIndex and
  // are emitted BEFORE the first paragraph of their section (see pm-adapter). Every
  // subsequent content block belongs to that section until the next sectionBreak,
  // so we track currentSectionIdx and stamp it on each block. This is required because
  // pm-adapter only sets attrs.sectionIndex on sectionBreak blocks, not paragraphs.
  let currentSectionIdx: number | null = pageNumberOffset > 0 ? activeSectionIndex : null;
  if (currentSectionIdx !== null) {
    sectionColumnsMap.set(currentSectionIdx, cloneColumnLayout(activeColumns));
    const finalSectionIndex = sectionMetadataList.reduce(
      (max, section, fallbackIndex) => Math.max(max, section.sectionIndex ?? fallbackIndex),
      currentSectionIdx,
    );
    lastSectionIdx = finalSectionIndex;
  }
  for (let idx = 0; idx < blocks.length; idx += 1) {
    if (checkpointEveryBlocks != null && idx % checkpointEveryBlocks === 0) {
      yield { phase: 'layout-document:preflight-section', index: idx, total: blocks.length };
    }
    const block = blocks[idx]!;
    const measure = measures[idx];
    if (measure) {
      balancingMeasureMap.set(block.id, measure as MeasureData);
    }
    const blockWithAttrs = block as { attrs?: { sectionIndex?: number; typeIsExplicit?: boolean } };
    const attrSectionIdx = blockWithAttrs.attrs?.sectionIndex;
    if (block.kind === 'sectionBreak') {
      documentHasAnySectionBreak = true;
      if (typeof attrSectionIdx === 'number') {
        currentSectionIdx = attrSectionIdx;
        lastSectionIdx = attrSectionIdx;
        if (block.columns) {
          sectionColumnsMap.set(attrSectionIdx, cloneColumnLayout(block.columns));
        }
        if (typeof block.type === 'string') {
          sectionEndBreakType.set(attrSectionIdx, block.type);
        }
        if (typeof blockWithAttrs.attrs?.typeIsExplicit === 'boolean') {
          sectionTypeIsExplicit.set(attrSectionIdx, blockWithAttrs.attrs.typeIsExplicit);
        }
      }
    }
    if (currentSectionIdx !== null) {
      blockSectionMap.set(block.id, currentSectionIdx);
      if (block.kind === 'columnBreak') {
        sectionHasExplicitColumnBreak.add(currentSectionIdx);
        documentHasExplicitColumnBreak = true;
      }
    } else if (block.kind === 'columnBreak') {
      documentHasExplicitColumnBreak = true;
    }
    // Block paragraphs that exist only to carry sectPr metadata (pm-adapter
    // sets this attr on otherwise-empty section-property paragraphs). These
    // are invisible in Word's renderer and must not contribute height when
    // balancing columns.
    if (block.kind === 'paragraph' && isInvisibleSectionBoundaryMarkerBlock(block)) {
      sectPrMarkerBlockIds.add(block.id);
    }
    if (
      block.kind === 'paragraph' &&
      (blockWithAttrs as { attrs?: { keepLines?: boolean } }).attrs?.keepLines === true
    ) {
      keepLinesBlockIds.add(block.id);
    }
  }

  // Collect anchored drawings mapped to their anchor paragraphs
  const anchoredDrawings = yield* mapLayoutWorkCheckpoints(
    collectAnchoredDrawingsSteps(blocks, measures, checkpointEveryBlocks),
    'layout-document:preflight-anchor',
  );
  const anchoredByParagraph = anchoredDrawings.byParagraph;
  const paragraphlessAnchoredDrawings = anchoredDrawings.withoutParagraph;
  // PASS 1C: collect anchored/floating tables mapped to their anchor paragraphs.
  // Tables without any anchor paragraph need explicit fallback placement so
  // floating-only documents still produce a page and render their content.
  const anchoredTables = yield* mapLayoutWorkCheckpoints(
    collectAnchoredTablesSteps(blocks, measures, checkpointEveryBlocks),
    'layout-document:preflight-anchor',
  );
  const anchoredTablesByParagraph = anchoredTables.byParagraph;
  const paragraphlessAnchoredTables = anchoredTables.withoutParagraph;
  const placedAnchoredIds = new Set<string>();

  // Pre-register page/margin-relative anchored images before the layout loop.
  // These images position themselves relative to the page, not a paragraph, so they
  // must be registered first so all paragraphs can wrap around them.
  const preRegisteredAnchors = yield* mapLayoutWorkCheckpoints(
    collectPreRegisteredAnchorsSteps(blocks, measures, checkpointEveryBlocks),
    'layout-document:preflight-anchor',
  );

  type PreRegisteredPosition = {
    anchorX: number;
    anchorY: number;
    targetState?: PageState;
    targetColumnIndex?: number;
  };

  // Map to store pre-computed positions for page-relative anchors (for fragment creation later).
  // Page placement is resolved at encounter time unless a carrier-specific target state is recorded.
  const preRegisteredPositions = new Map<string, PreRegisteredPosition>();

  const findLastParagraphFragment = (blockId: string): { state: PageState; fragment: ParaFragment } | null => {
    for (let stateIndex = states.length - 1; stateIndex >= 0; stateIndex -= 1) {
      const state = states[stateIndex]!;
      for (let fragmentIndex = state.page.fragments.length - 1; fragmentIndex >= 0; fragmentIndex -= 1) {
        const fragment = state.page.fragments[fragmentIndex];
        if (fragment?.kind === 'para' && fragment.blockId === blockId) {
          return { state, fragment };
        }
      }
    }
    return null;
  };

  const resolveParagraphlessAnchoredTableY = (block: TableBlock, measure: TableMeasure, state: PageState): number => {
    const contentTop = state.topMargin;
    const contentBottom = state.contentBottom;
    const tableHeight = measure.totalHeight ?? 0;

    return resolveAnchoredGraphicY({
      anchor: block.anchor as Parameters<typeof resolveAnchoredGraphicY>[0]['anchor'],
      objectHeight: tableHeight,
      contentTop,
      contentBottom,
      pageBottomMargin: state.page.margins?.bottom ?? activeBottomMargin,
      pageNumber: state.page.number,
      preRegisteredFallbackToContentTop: true,
    });
  };

  const resolveParagraphlessAnchoredDrawingY = (
    block: ImageBlock | DrawingBlock,
    measure: ImageMeasure | DrawingMeasure,
    state: PageState,
  ): number =>
    resolveAnchoredGraphicY({
      anchor: block.anchor,
      objectHeight: measure.height ?? 0,
      contentTop: state.topMargin,
      contentBottom: state.contentBottom,
      pageBottomMargin: state.page.margins?.bottom ?? activeBottomMargin,
      pageNumber: state.page.number,
      preRegisteredFallbackToContentTop: true,
    });

  const resolveParagraphlessAnchoredDrawingX = (
    block: ImageBlock | DrawingBlock,
    measure: ImageMeasure | DrawingMeasure,
    state: PageState,
  ): number =>
    block.anchor
      ? computeAnchorX(
          block.anchor,
          state.columnIndex,
          normalizeColumns(activeColumns, activePageSize.w - (activeLeftMargin + activeRightMargin)),
          measure.width,
          { left: activeLeftMargin, right: activeRightMargin },
          activePageSize.w,
          { pageNumber: state.page.number },
        )
      : columnX(state);

  const syncSectionState = (updatedState: SectionState): void => {
    activeTopMargin = updatedState.activeTopMargin;
    activeBottomMargin = updatedState.activeBottomMargin;
    activeLeftMargin = updatedState.activeLeftMargin;
    activeRightMargin = updatedState.activeRightMargin;
    pendingTopMargin = updatedState.pendingTopMargin;
    pendingBottomMargin = updatedState.pendingBottomMargin;
    pendingLeftMargin = updatedState.pendingLeftMargin;
    pendingRightMargin = updatedState.pendingRightMargin;
    activeHeaderDistance = updatedState.activeHeaderDistance;
    activeFooterDistance = updatedState.activeFooterDistance;
    pendingHeaderDistance = updatedState.pendingHeaderDistance;
    pendingFooterDistance = updatedState.pendingFooterDistance;
    activePageSize = updatedState.activePageSize;
    pendingPageSize = updatedState.pendingPageSize;
    activeColumns = updatedState.activeColumns;
    pendingColumns = updatedState.pendingColumns;
    activeOrientation = updatedState.activeOrientation;
    pendingOrientation = updatedState.pendingOrientation;

    cachedColumnsState.state = null;
    paginatorMargins.left = activeLeftMargin;
    paginatorMargins.right = activeRightMargin;
    const contentWidth = activePageSize.w - (activeLeftMargin + activeRightMargin);
    floatManager.setLayoutContext(
      normalizeColumns(activeColumns, contentWidth),
      { left: activeLeftMargin, right: activeRightMargin },
      activePageSize.w,
    );
  };

  const applyLeadingInitialSectionBreak = (effectiveBlock: SectionBreakBlock): void => {
    const sectionState: SectionState = {
      activeTopMargin,
      activeBottomMargin,
      activeLeftMargin,
      activeRightMargin,
      pendingTopMargin,
      pendingBottomMargin,
      pendingLeftMargin,
      pendingRightMargin,
      activeHeaderDistance,
      activeFooterDistance,
      pendingHeaderDistance,
      pendingFooterDistance,
      activePageSize,
      pendingPageSize,
      activeColumns,
      pendingColumns,
      activeOrientation,
      pendingOrientation,
      hasAnyPages: false,
    };
    const scheduled = scheduleSectionBreakCompat(effectiveBlock, sectionState, {
      top: margins.top,
      bottom: margins.bottom,
      left: margins.left,
      right: margins.right,
    });
    syncSectionState(scheduled.state ?? sectionState);

    activeSectionBaseTopMargin =
      typeof effectiveBlock.margins?.top === 'number' ? effectiveBlock.margins.top : margins.top;
    activeSectionBaseBottomMargin =
      typeof effectiveBlock.margins?.bottom === 'number' ? effectiveBlock.margins.bottom : margins.bottom;
    activeVAlign = effectiveBlock.vAlign ?? null;
    pendingVAlign = undefined;

    if (effectiveBlock.headerRefs || effectiveBlock.footerRefs) {
      const nextSectionRefs = {
        ...(effectiveBlock.headerRefs && { headerRefs: effectiveBlock.headerRefs }),
        ...(effectiveBlock.footerRefs && { footerRefs: effectiveBlock.footerRefs }),
      };
      activeSectionRefs = mergeSectionRefs(activeSectionRefs, nextSectionRefs);
      if (activeSectionRefs) {
        updateRuntimeSectionRefs(activeSectionIndex, activeSectionRefs);
      }
    }

    const sectionIndexRaw = effectiveBlock.attrs?.sectionIndex;
    const metadataIndex = typeof sectionIndexRaw === 'number' ? sectionIndexRaw : Number(sectionIndexRaw ?? NaN);
    if (Number.isFinite(metadataIndex)) {
      activeSectionIndex = metadataIndex;
    }
    const sectionMetadata = Number.isFinite(metadataIndex) ? getSectionMetadata(metadataIndex) : undefined;
    const numbering = sectionMetadata?.numbering ?? effectiveBlock.numbering;
    if (numbering) {
      if (numbering.format) activeNumberFormat = numbering.format;
      if (typeof numbering.start === 'number' && Number.isFinite(numbering.start)) {
        activePageCounter = numbering.start;
        activeSectionPageCounterStart = activePageCounter;
      }
    }

    const initialColumnIndex = normalizeInitialColumnIndex(activeColumns, effectiveBlock.attrs?.initialColumnIndex);
    if (initialColumnIndex !== null && initialColumnIndex > 0) {
      const state = paginator.ensurePage();
      if (state.page.fragments.length === 0) {
        state.columnIndex = initialColumnIndex;
      }
    }
  };

  const preAppliedInitialSectionBreakIndices = new Set<number>();
  for (let index = 0; index < blocks.length; index += 1) {
    if (checkpointEveryBlocks != null && index > 0 && index % checkpointEveryBlocks === 0) {
      yield { phase: 'layout-document:block', index, total: blocks.length };
    }
    const block = blocks[index];
    if (block.kind !== 'sectionBreak') break;
    const effectiveBlock = resolveEffectiveSectionBreakBlock(block as SectionBreakBlock, index);
    if (!isInitialSectionBreak(effectiveBlock, false)) continue;
    applyLeadingInitialSectionBreak(effectiveBlock);
    preAppliedInitialSectionBreakIndices.add(index);
  }

  for (let entryIndex = 0; entryIndex < preRegisteredAnchors.length; entryIndex += 1) {
    if (checkpointEveryBlocks != null && entryIndex % checkpointEveryBlocks === 0) {
      yield {
        phase: 'layout-document:preflight-anchor',
        index: entryIndex,
        total: preRegisteredAnchors.length,
      };
    }
    const entry = preRegisteredAnchors[entryIndex]!;
    // Ensure first page exists
    const state = paginator.ensurePage();

    const contentTop = state.topMargin;
    const contentBottom = state.contentBottom;
    const anchorY = resolveAnchoredGraphicY({
      anchor: entry.block.anchor,
      objectHeight: entry.measure.height ?? 0,
      contentTop,
      contentBottom,
      pageBottomMargin: state.page.margins?.bottom ?? activeBottomMargin,
      pageNumber: state.page.number,
      preRegisteredFallbackToContentTop: true,
    });

    // Compute anchor X position
    const anchorX = entry.block.anchor
      ? computeAnchorX(
          entry.block.anchor,
          state.columnIndex,
          normalizeColumns(activeColumns, activePageSize.w - (activeLeftMargin + activeRightMargin)),
          entry.measure.width,
          { left: activeLeftMargin, right: activeRightMargin },
          activePageSize.w,
          { pageNumber: state.page.number },
        )
      : activeLeftMargin;

    // Register with float manager so all paragraphs see this exclusion
    // NOTE: We only register exclusion zones here, NOT fragments.
    // Fragments will be created when the image block is encountered in the layout loop.
    // This prevents the section break logic from seeing "content" on the page and creating a new page.
    floatManager.registerDrawing(entry.block, entry.measure, anchorY, state.columnIndex, state.page.number);

    // Store pre-computed position for later use when creating the fragment.
    preRegisteredPositions.set(entry.block.id, { anchorX, anchorY });
  }

  // Pre-compute keepNext chains for correct pagination grouping.
  // Word treats consecutive paragraphs with keepNext=true as indivisible units.
  const keepNextChains = yield* mapLayoutWorkCheckpoints(
    computeKeepNextChainSteps(blocks, checkpointEveryBlocks),
    'layout-document:preflight-keep-next',
  );

  // Build set of mid-chain indices (not chain starters) to skip redundant checks
  const midChainIndices = new Set<number>();
  let keepNextMemberIndex = 0;
  for (const chain of keepNextChains.values()) {
    // All members except the first are mid-chain
    for (let i = 1; i < chain.memberIndices.length; i++) {
      if (
        checkpointEveryBlocks != null &&
        keepNextMemberIndex > 0 &&
        keepNextMemberIndex % checkpointEveryBlocks === 0
      ) {
        yield { phase: 'layout-document:preflight-keep-next', index: keepNextMemberIndex };
      }
      midChainIndices.add(chain.memberIndices[i]);
      keepNextMemberIndex += 1;
    }
  }

  const blockResumeCheckpoints = new Map<string, import('@superdoc/contracts').LayoutBlockResumeCheckpoint>();
  const tableResumeCheckpoints = new Map<string, TableLayoutResumeCheckpoint[]>();
  const requestedTableResume = readTableLayoutResume(options);
  let tableResumeConsumed = false;
  const captureTableResumeCheckpoint = (blockId: string, state: PageState, cursor: TableLayoutCursor): void => {
    const checkpoint: TableLayoutResumeCheckpoint = {
      blockId,
      pageIndex: state.page.number - 1 - pageNumberOffset,
      prefixFragmentCount: state.page.fragments.length,
      cursorY: state.cursorY,
      maxCursorY: state.maxCursorY,
      ...(state.committedBodyBottom != null ? { committedBodyBottom: state.committedBodyBottom } : {}),
      columnIndex: state.columnIndex,
      trailingSpacing: state.trailingSpacing,
      ...(state.lastParagraphStyleId ? { lastParagraphStyleId: state.lastParagraphStyleId } : {}),
      lastParagraphContextualSpacing: state.lastParagraphContextualSpacing,
      ...(state.lastParagraphBorderHash ? { lastParagraphBorderHash: state.lastParagraphBorderHash } : {}),
      constraintBoundaries: state.constraintBoundaries.map((boundary) => ({
        y: boundary.y,
        columns: { ...boundary.columns },
      })),
      activeConstraintIndex: state.activeConstraintIndex,
      footnoteDemandThisPage: state.footnoteDemandThisPage,
      footnoteRefsThisPage: state.footnoteRefsThisPage,
      footnoteAnchorsThisPage: state.footnoteAnchorsThisPage.map((anchor) => ({ ...anchor })),
      cursor,
    };
    const current = tableResumeCheckpoints.get(blockId);
    if (current) current.push(checkpoint);
    else tableResumeCheckpoints.set(blockId, [checkpoint]);
  };
  const captureRenderDiagnosticPaginationProgress = (block: FlowBlock): V2RenderDiagnosticPaginationProgress | null => {
    if (block.kind !== 'paragraph') return null;
    const checkpoint = blockResumeCheckpoints.get(block.id);
    if (!checkpoint || checkpoint.blockId !== block.id) return null;
    const checkpointPage = pages[checkpoint.pageIndex];
    const checkpointState = states[checkpoint.pageIndex];
    if (
      !checkpointPage ||
      !checkpointState ||
      !Number.isInteger(checkpoint.prefixFragmentCount) ||
      checkpoint.prefixFragmentCount < 0 ||
      checkpoint.prefixFragmentCount > checkpointPage.fragments.length
    )
      return null;
    const snapshotPages = pages.slice(0, checkpoint.pageIndex + 1).map((page, pageIndex) => {
      const snapshot = clonePlain(page);
      const state = states[pageIndex];
      if (!state) return snapshot;
      if (pageIndex === checkpoint.pageIndex) {
        snapshot.fragments = snapshot.fragments.slice(0, checkpoint.prefixFragmentCount);
        const raw = Math.max(checkpoint.maxCursorY, checkpoint.cursorY);
        const trailing = checkpoint.cursorY >= checkpoint.maxCursorY ? checkpoint.trailingSpacing : 0;
        (snapshot as Page & { bodyMaxY?: number }).bodyMaxY = Math.max(checkpointState.topMargin, raw - trailing);
      } else {
        const raw = Math.max(state.maxCursorY, state.cursorY);
        const trailing = state.cursorY >= state.maxCursorY ? state.trailingSpacing : 0;
        (snapshot as Page & { bodyMaxY?: number }).bodyMaxY = Math.max(state.topMargin, raw - trailing);
      }
      return snapshot;
    });
    const layout: Layout = {
      pageSize,
      pages: snapshotPages,
      blockResumeCheckpoints: new Map(blockResumeCheckpoints),
      layoutEpoch: 0,
      ...(options.documentBackground ? { documentBackground: options.documentBackground } : {}),
      ...(resolveColumnCount(activeColumns) > 1 ? { columns: resolveColumnLayout(activeColumns) } : {}),
    };
    Object.defineProperty(layout, V2_RENDER_DIAGNOSTIC_PAGINATION_PREFIX, {
      configurable: false,
      enumerable: false,
      value: { blockId: block.id, pageIndex: checkpoint.pageIndex },
    });
    return {
      blocks,
      measures,
      layout,
      failedBlockId: block.id,
      sourcePageRange: { firstPage: checkpoint.pageIndex, lastPage: checkpoint.pageIndex },
    };
  };

  // PASS 2: Layout all blocks, consulting float manager for affected paragraphs
  let shouldUseBlankPageFallback = false;
  try {
    for (let index = 0; index < blocks.length; index += 1) {
      if (checkpointEveryBlocks != null && index % checkpointEveryBlocks === 0) {
        yield { phase: 'layout-document:block', index, total: blocks.length };
      }
      const block = blocks[index];
      const measure = measures[index];
      if (!measure) {
        throw new Error(`layoutDocument: missing measure for block ${block.id}`);
      }
      try {
        const sectionBoundaryAnchoredDrawings = block.kind === 'paragraph' ? anchoredByParagraph.get(index) : undefined;
        const isSectionBoundaryAnchorCarrier =
          sectionBoundaryFillerBlockIds.has(block.id) &&
          sectionBoundaryAnchoredDrawings != null &&
          sectionBoundaryAnchoredDrawings.length > 0;
        if (sectionBoundaryFillerBlockIds.has(block.id) && !isSectionBoundaryAnchorCarrier) {
          layoutLog(`[Layout] Skipping section-boundary filler block ${index} (${block.kind}) - ID: ${block.id}`);
          continue;
        }

        layoutLog(`[Layout] Block ${index} (${block.kind}) - ID: ${block.id}`);
        layoutLog(`  activeColumns: ${JSON.stringify(activeColumns)}`);
        layoutLog(`  pendingColumns: ${JSON.stringify(pendingColumns)}`);
        if (block.kind === 'sectionBreak') {
          const sectionBlock = block as SectionBreakBlock;
          layoutLog(`  sectionBreak.columns: ${JSON.stringify(sectionBlock.columns)}`);
          layoutLog(`  sectionBreak.type: ${sectionBlock.type}`);
        }

        if (block.kind === 'sectionBreak') {
          if (measure.kind !== 'sectionBreak') {
            throw new Error(`layoutDocument: expected sectionBreak measure for block ${block.id}`);
          }
          if (preAppliedInitialSectionBreakIndices.has(index)) {
            continue;
          }
          // Use next-section properties at this boundary when available, so the page started
          // after this break uses the upcoming section's layout (page size, margins, columns).
          const effectiveBlock = resolveEffectiveSectionBreakBlock(block as SectionBreakBlock, index);

          const sectionState: SectionState = {
            activeTopMargin,
            activeBottomMargin,
            activeLeftMargin,
            activeRightMargin,
            pendingTopMargin,
            pendingBottomMargin,
            pendingLeftMargin,
            pendingRightMargin,
            activeHeaderDistance,
            activeFooterDistance,
            pendingHeaderDistance,
            pendingFooterDistance,
            activePageSize,
            pendingPageSize,
            activeColumns,
            pendingColumns,
            activeOrientation,
            pendingOrientation,
            hasAnyPages: states.length > 0,
          };
          const _sched = scheduleSectionBreakCompat(effectiveBlock, sectionState, {
            top: margins.top,
            bottom: margins.bottom,
            left: margins.left,
            right: margins.right,
          });
          const breakInfo = _sched.decision;
          const updatedState = _sched.state ?? sectionState;

          layoutLog(`[Layout] ========== SECTION BREAK SCHEDULED ==========`);
          layoutLog(`  Block index: ${index}`);
          layoutLog(`  effectiveBlock.columns: ${JSON.stringify(effectiveBlock.columns)}`);
          layoutLog(`  effectiveBlock.type: ${effectiveBlock.type}`);
          layoutLog(`  breakInfo.forcePageBreak: ${breakInfo.forcePageBreak}`);
          layoutLog(`  breakInfo.forceMidPageRegion: ${breakInfo.forceMidPageRegion}`);
          layoutLog(
            `  BEFORE: activeColumns = ${JSON.stringify(sectionState.activeColumns)}, pendingColumns = ${JSON.stringify(sectionState.pendingColumns)}`,
          );
          layoutLog(
            `  AFTER: activeColumns = ${JSON.stringify(updatedState.activeColumns)}, pendingColumns = ${JSON.stringify(updatedState.pendingColumns)}`,
          );
          layoutLog(`[Layout] ========== END SECTION BREAK ==========`);

          // Sync updated section state
          activeTopMargin = updatedState.activeTopMargin;
          activeBottomMargin = updatedState.activeBottomMargin;
          activeLeftMargin = updatedState.activeLeftMargin;
          activeRightMargin = updatedState.activeRightMargin;
          pendingTopMargin = updatedState.pendingTopMargin;
          pendingBottomMargin = updatedState.pendingBottomMargin;
          pendingLeftMargin = updatedState.pendingLeftMargin;
          pendingRightMargin = updatedState.pendingRightMargin;
          activeHeaderDistance = updatedState.activeHeaderDistance;
          activeFooterDistance = updatedState.activeFooterDistance;
          pendingHeaderDistance = updatedState.pendingHeaderDistance;
          pendingFooterDistance = updatedState.pendingFooterDistance;
          activePageSize = updatedState.activePageSize;
          pendingPageSize = updatedState.pendingPageSize;
          activeColumns = updatedState.activeColumns;
          pendingColumns = updatedState.pendingColumns;
          activeOrientation = updatedState.activeOrientation;
          pendingOrientation = updatedState.pendingOrientation;

          // Track section base margins (not part of SectionState, handled separately).
          // These represent the section's configured margins before header/footer inflation.
          const isFirstSection = isInitialSectionBreak(effectiveBlock, states.length > 0);
          const blockTopMargin = effectiveBlock.margins?.top;
          const blockBottomMargin = effectiveBlock.margins?.bottom;
          if (isFirstSection) {
            // First section: apply immediately to active
            activeSectionBaseTopMargin = typeof blockTopMargin === 'number' ? blockTopMargin : margins.top;
            activeSectionBaseBottomMargin = typeof blockBottomMargin === 'number' ? blockBottomMargin : margins.bottom;
          } else if (blockTopMargin !== undefined || blockBottomMargin !== undefined) {
            // Non-first section with margin changes: schedule for next page
            if (blockTopMargin !== undefined) {
              pendingSectionBaseTopMargin = typeof blockTopMargin === 'number' ? blockTopMargin : margins.top;
            }
            if (blockBottomMargin !== undefined) {
              pendingSectionBaseBottomMargin =
                typeof blockBottomMargin === 'number' ? blockBottomMargin : margins.bottom;
            }
          }

          // Handle vAlign from section break (not part of SectionState, handled separately).
          // vAlign is a per-section property that does NOT inherit between sections.
          // When not specified, OOXML defaults to 'top' (represented as null here).
          // We must always process this for every section break to prevent stale values.
          const sectionVAlign = effectiveBlock.vAlign ?? null;
          const isFirstSectionForVAlign = isInitialSectionBreak(effectiveBlock, states.length > 0);
          if (isFirstSectionForVAlign) {
            // First section: apply immediately
            activeVAlign = sectionVAlign;
            pendingVAlign = undefined; // Clear any pending (undefined = no pending change)
          } else {
            // Non-first section: schedule for next page
            pendingVAlign = sectionVAlign;
          }

          // Schedule section refs (handled outside of SectionState since they're module-level vars)
          if (effectiveBlock.headerRefs || effectiveBlock.footerRefs) {
            const baseSectionRefs = pendingSectionRefs ?? activeSectionRefs;
            const nextSectionRefs = {
              ...(effectiveBlock.headerRefs && { headerRefs: effectiveBlock.headerRefs }),
              ...(effectiveBlock.footerRefs && { footerRefs: effectiveBlock.footerRefs }),
            };
            pendingSectionRefs = mergeSectionRefs(baseSectionRefs, nextSectionRefs);
            layoutLog(`[Layout] After scheduleSectionBreakCompat: Scheduled pendingSectionRefs:`, pendingSectionRefs);
          }

          // Schedule section index and numbering (handled outside of SectionState since they're module-level vars)
          const sectionIndexRaw = effectiveBlock.attrs?.sectionIndex;
          const metadataIndex = typeof sectionIndexRaw === 'number' ? sectionIndexRaw : Number(sectionIndexRaw ?? NaN);
          // Note: isFirstSection is already declared above for base margin tracking
          if (Number.isFinite(metadataIndex)) {
            if (isFirstSection) {
              // First section: apply immediately
              activeSectionIndex = metadataIndex;
            } else {
              // Non-first section: schedule for next page
              pendingSectionIndex = metadataIndex;
            }
          }
          // Get section metadata for numbering if available
          const sectionMetadata = Number.isFinite(metadataIndex) ? getSectionMetadata(metadataIndex) : undefined;
          if (sectionMetadata?.numbering) {
            if (isFirstSection) {
              // First section: apply immediately
              if (sectionMetadata.numbering.format) activeNumberFormat = sectionMetadata.numbering.format;
              if (typeof sectionMetadata.numbering.start === 'number') {
                activePageCounter = sectionMetadata.numbering.start;
                activeSectionPageCounterStart = activePageCounter;
              }
            } else {
              // Non-first section: schedule for next page
              pendingNumbering = { ...sectionMetadata.numbering };
            }
          } else if (effectiveBlock.numbering) {
            if (isFirstSection) {
              if (effectiveBlock.numbering.format) activeNumberFormat = effectiveBlock.numbering.format;
              if (typeof effectiveBlock.numbering.start === 'number') {
                activePageCounter = effectiveBlock.numbering.start;
                activeSectionPageCounterStart = activePageCounter;
              }
            } else {
              pendingNumbering = { ...effectiveBlock.numbering };
            }
          }

          // Handle mid-page region changes (column layout changes within a page)
          // Uses pendingColumns from scheduleSectionBreak which handles both:
          // - Explicit column changes (block.columns defined with different config)
          // - Implicit reset to single column (block.columns undefined per OOXML spec)
          if (breakInfo.forceMidPageRegion && updatedState.pendingColumns) {
            const state = paginator.ensurePage();
            const newColumns = updatedState.pendingColumns;

            // Identify the ending section from the current page's fragments.
            // `activeSectionIndex` only updates at page boundaries, so for continuous
            // mid-page section breaks it's stale. Walk back through page fragments
            // to find the most recent section index that isn't the new one — that's
            // the section that's ending.
            let endingSectionIndex: number | null = null;
            for (let i = state.page.fragments.length - 1; i >= 0; i--) {
              const mapped = blockSectionMap.get(state.page.fragments[i].blockId);
              if (typeof mapped === 'number' && mapped !== metadataIndex) {
                endingSectionIndex = mapped;
                break;
              }
            }
            const endingSectionColumns =
              endingSectionIndex !== null ? sectionColumnsMap.get(endingSectionIndex) : undefined;
            const willBalance =
              endingSectionIndex !== null &&
              !!endingSectionColumns &&
              resolveColumnCount(endingSectionColumns) > 1 &&
              !sectionHasExplicitColumnBreak.has(endingSectionIndex);

            // Balance BEFORE any forced page break. After balancing, all of the
            // ending section's fragments are repositioned within the section's own
            // vertical region — there's no risk of the new 1-col region overwriting
            // prior column content, because the cursor moves to maxY below them.
            //
            // `willBalance` is a coarse approval: balanceSectionOnPage has its own
            // late skip conditions (unequal column widths, zero remaining height,
            // section content too small for shouldSkipBalancing's thresholds) that
            // can return null even when willBalance was true. The page-break
            // fallback below must consider the actual balance outcome, not just
            // willBalance, otherwise we leave the new region starting on the same
            // page from a stale column index and overwriting the previous
            // section's column content.
            let balanceResult: { maxY: number } | null = null;
            if (willBalance) {
              // The current region starts at the last constraint boundary's Y, or at
              // the page's top margin if no mid-page region change has happened yet.
              const lastBoundary = state.constraintBoundaries[state.constraintBoundaries.length - 1];
              const activeRegionTop = lastBoundary?.y ?? activeTopMargin;
              const availableHeight = activePageSize.h - activeBottomMargin - activeRegionTop;
              const contentWidth = activePageSize.w - (activeLeftMargin + activeRightMargin);
              const normalized = normalizeColumns(endingSectionColumns!, contentWidth);
              balanceResult = balanceSectionOnPage({
                fragments: state.page.fragments as BalancingFragment[],
                sectionIndex: endingSectionIndex!,
                sectionColumns: toBalancingColumns(normalized),
                sectionHasExplicitColumnBreak: false,
                blockSectionMap,
                margins: { left: activeLeftMargin },
                topMargin: activeRegionTop,
                columnWidth: normalized.width,
                availableHeight,
                measureMap: balancingMeasureMap,
                sectPrMarkerBlockIds,
                keepLinesBlockIds,
              });
              if (balanceResult) {
                // Collapse both cursors to the balanced section bottom so the new
                // region starts there, not below an unbalanced tallest column.
                state.cursorY = balanceResult.maxY;
                state.maxCursorY = balanceResult.maxY;
                alreadyBalancedSections.add(endingSectionIndex!);
              }
            }
            startMidPageRegion(state, newColumns);
          }

          // Handle forced page breaks
          if (breakInfo.forcePageBreak) {
            let state = paginator.ensurePage();
            const hasMeaningfulContent = pageHasMeaningfulBodyContent(
              state.page,
              blocksById,
              sectionBoundaryFillerBlockIds,
            );

            // If current page has meaningful content, start a new page. Section-boundary
            // marker/filler fragments alone should not strand a blank page before the new section.
            if (hasMeaningfulContent) {
              layoutLog(`[Layout] Starting new page due to section break (forcePageBreak=true)`);
              layoutLog(
                `  Before: activeColumns = ${JSON.stringify(activeColumns)}, pendingColumns = ${JSON.stringify(pendingColumns)}`,
              );
              const nextPhysicalPage = state.page.number + 1;
              const needsParityBlank =
                breakInfo.requiredParity != null &&
                ((breakInfo.requiredParity === 'even' && nextPhysicalPage % 2 !== 0) ||
                  (breakInfo.requiredParity === 'odd' && nextPhysicalPage % 2 === 0));
              if (needsParityBlank) {
                // The parity filler belongs to the preceding section. Do not
                // consume the pending section restart or its first-page state;
                // Word suppresses all furniture on this physical page.
                const blankState = paginator.startNewPage({ applyPendingSection: false });
                blankState.page.suppressHeaderFooter = true;
              }
              state = paginator.startNewPage();
              layoutLog(
                `  After page ${state.page.number} created: activeColumns = ${JSON.stringify(activeColumns)}, pendingColumns = ${JSON.stringify(pendingColumns)}`,
              );
            }

            // Handle parity requirements (evenPage/oddPage)
            if (breakInfo.requiredParity && !hasMeaningfulContent) {
              const currentPageNumber = state.page.number;
              const isCurrentEven = currentPageNumber % 2 === 0;
              const needsEven = breakInfo.requiredParity === 'even';

              // If parity doesn't match, insert a blank page
              if ((needsEven && !isCurrentEven) || (!needsEven && isCurrentEven)) {
                // This already-open page is the parity filler. Keep its current
                // section state and suppress furniture; the next page applies
                // the pending section restart exactly once.
                layoutLog(`[Layout] Inserting blank page for parity (need ${breakInfo.requiredParity})`);
                state.page.suppressHeaderFooter = true;
                state = paginator.startNewPage();
              } else {
                // A preceding manual break already opened the correctly-paritied
                // target page. Rebuild it in place so pending section geometry,
                // numbering, and furniture become active without adding a blank.
                state = paginator.startNewPage({ replaceCurrentPage: true });
              }
            } else if (!hasMeaningfulContent) {
              // `nextPage` encountered on a page already opened by an explicit
              // page break targets that same physical page in Word. The page was
              // created with the previous section's state, so replace it in
              // place and snapshot the pending section contract now.
              state = paginator.startNewPage({ replaceCurrentPage: true });
            }
          }

          if (breakInfo.forceColumnBreak) {
            const state = paginator.ensurePage();
            // advanceColumn starts a new page when the active layout has only one
            // column (columnIndex is already the last). Activate pending multi-column
            // geometry first so nextColumn advances within the page.
            const pendingRegionColumns = updatedState.pendingColumns;
            if (
              pendingRegionColumns &&
              resolveColumnCount(pendingRegionColumns) > 1 &&
              resolveColumnCount(getActiveColumnsForState(state)) < 2
            ) {
              startMidPageRegion(state, pendingRegionColumns);
            }
            paginator.advanceColumn(state);
          }

          continue;
        }

        if (block.kind === 'paragraph') {
          if (measure.kind !== 'paragraph') {
            throw new Error(`layoutDocument: expected paragraph measure for block ${block.id}`);
          }

          // Skip empty paragraphs that appear between a pageBreak and a sectionBreak
          // (Word sectPr marker paragraphs should not create visible content)
          const paraBlock = block as ParagraphBlock;
          const splitCarrierMode = splitLineBreakAnchorCarrierMode(blocks, index);
          const isEmpty =
            !paraBlock.runs ||
            paraBlock.runs.length === 0 ||
            (paraBlock.runs.length === 1 &&
              (!paraBlock.runs[0].kind || paraBlock.runs[0].kind === 'text') &&
              (!(paraBlock.runs[0] as { text?: string }).text || (paraBlock.runs[0] as { text?: string }).text === ''));

          if (isEmpty && shouldSkipParagraphDuringLayout(blocks, index)) {
            continue;
          }

          const anchorsForPara = sectionBoundaryAnchoredDrawings ?? anchoredByParagraph.get(index);
          const tablesForPara = anchoredTablesByParagraph.get(index);
          if (
            isSyntheticExplicitPageBreakRemnant(blocks, index) &&
            index < blocks.length - 1 &&
            !isEditableExplicitPageBreakContinuation(blocks, index) &&
            (!anchorsForPara || anchorsForPara.length === 0) &&
            (!tablesForPara || tablesForPara.length === 0)
          ) {
            continue;
          }
          const deferredSplitCarrierAnchorId = splitCarrierMode === 'spaced' ? blocks[index + 1]?.id : null;
          const anchorsForLayout =
            deferredSplitCarrierAnchorId && anchorsForPara
              ? anchorsForPara.filter((entry) => entry.block.id !== deferredSplitCarrierAnchorId)
              : anchorsForPara;
          const hasAnchorsForLayout = anchorsForLayout != null && anchorsForLayout.length > 0;
          const preflightPageIndex = options.footnotePageFlow
            ? paginator.ensurePage().page.number - 1 - pageNumberOffset
            : undefined;

          /**
           * keepNext Chain-Aware Page Break Logic
           *
           * Word treats consecutive paragraphs with keepNext=true as an indivisible unit.
           * If the entire chain (plus the first line of the anchor paragraph) doesn't fit
           * on the current page, the whole chain moves to the next page.
           *
           * Three cases:
           * 1. Mid-chain paragraph: Skip keepNext check (chain-start already decided)
           * 2. Chain starter: Calculate total chain height and decide for entire chain
           * 3. Orphan keepNext (no chain, e.g., next is a break): Use single-paragraph logic
           */
          const chain = keepNextChains.get(index);

          if (midChainIndices.has(index)) {
            // Case 1: Mid-chain paragraph - chain starter already made the page break decision
            // No action needed, just proceed to layout
          } else if (chain) {
            // Case 2: Chain starter - evaluate entire chain height
            let state = paginator.ensurePage();
            const groupAnchors: FootnoteAnchorRef[] = [];
            let protectAnchorLines = false;
            if (options.footnotePageFlow) {
              for (const memberIndex of chain.memberIndices) {
                groupAnchors.push(...getFootnoteAnchorsForBlockId(blocks[memberIndex].id));
              }
              const anchor = blocks[chain.anchorIndex];
              const anchorMeasure = measures[chain.anchorIndex];
              if (anchor?.kind === 'paragraph' && anchorMeasure?.kind === 'paragraph') {
                const lineCount = keptAnchorLineCount(anchor, anchorMeasure);
                for (const entry of getFootnoteAnchorsForBlockId(anchor.id)) {
                  const line =
                    entry.runOrdinal == null ? null : findLineIndexForRunOrdinal(anchorMeasure.lines, entry.runOrdinal);
                  if (line != null && line < lineCount) {
                    groupAnchors.push(entry);
                    protectAnchorLines = true;
                  }
                }
              }
            }
            const groupDemand = groupAnchors.reduce((sum, anchor) => sum + anchor.fullHeight, 0);
            const committedDemand = state.footnoteAnchorsThisPage.reduce((sum, anchor) => sum + anchor.fullHeight, 0);
            const groupBottom = options.footnotePageFlow
              ? coupledFootnoteBodyBottom(
                  state,
                  committedDemand + groupDemand,
                  state.footnoteRefsThisPage + groupAnchors.length,
                  options.footnotePageFlow.incomingDemand(state.page.number - 1),
                  getFootnoteBandOverhead,
                )
              : state.contentBottom;
            const availableHeight = groupBottom - state.cursorY;

            // Check if first chain member has contextualSpacing that would reclaim trailing space.
            // When contextualSpacing applies, the previous paragraph's trailing spacing is not
            // rendered as a gap, so we have more available space than cursorY suggests.
            const firstMemberBlock = blocks[chain.startIndex] as ParagraphBlock;
            const firstMemberStyleId =
              typeof firstMemberBlock.attrs?.styleId === 'string' ? firstMemberBlock.attrs?.styleId : undefined;
            // Reclaim depends on whether the previous paragraph suppresses its own after-spacing
            const prevSuppressAfter = shouldSuppressOwnSpacing(
              state.lastParagraphStyleId,
              state.lastParagraphContextualSpacing,
              firstMemberStyleId,
            );
            const prevTrailing =
              Number.isFinite(state.trailingSpacing) && state.trailingSpacing > 0 ? state.trailingSpacing : 0;
            const effectiveAvailableHeight = prevSuppressAfter ? availableHeight + prevTrailing : availableHeight;

            const chainHeight = calculateChainHeight(chain, blocks, measures, state, protectAnchorLines);

            // Calculate page content height to check if chain fits on a blank page
            const blankBottom = options.footnotePageFlow
              ? coupledFootnoteBodyBottom(
                  state,
                  groupDemand,
                  groupAnchors.length,
                  { height: 0, refs: 0 },
                  getFootnoteBandOverhead,
                )
              : state.contentBottom;
            const pageContentHeight = blankBottom - state.topMargin;
            const blankChainHeight = options.footnotePageFlow
              ? calculateChainHeight(
                  chain,
                  blocks,
                  measures,
                  {
                    ...state,
                    trailingSpacing: 0,
                    lastParagraphStyleId: undefined,
                    lastParagraphContextualSpacing: false,
                  },
                  protectAnchorLines,
                )
              : chainHeight;
            const chainFitsOnBlankPage = blankChainHeight <= pageContentHeight;

            // Only advance if chain fits on blank page but not current page
            // (prevents infinite loop for chains taller than page)
            if (chainFitsOnBlankPage && chainHeight > effectiveAvailableHeight && state.page.fragments.length > 0) {
              state = paginator.advanceColumn(state);
            }
          } else if (paraBlock.attrs?.keepNext === true) {
            // Case 3: Orphan keepNext (next block is a break type or end of document)
            // This shouldn't normally happen since computeKeepNextChains handles most cases,
            // but we keep it for safety (e.g., keepNext at end of document with no anchor)
            const nextBlock = blocks[index + 1];
            const nextMeasure = measures[index + 1];
            if (
              nextBlock &&
              nextMeasure &&
              nextBlock.kind !== 'sectionBreak' &&
              nextBlock.kind !== 'pageBreak' &&
              nextBlock.kind !== 'columnBreak'
            ) {
              const shouldSkipAnchoredTable = nextBlock.kind === 'table' && nextBlock.anchor?.isAnchored === true;
              if (!shouldSkipAnchoredTable) {
                let state = paginator.ensurePage();
                const availableHeight = state.contentBottom - state.cursorY;

                const spacingBefore = getParagraphSpacingBefore(paraBlock);
                const spacingAfter = getParagraphSpacingAfter(paraBlock);
                const prevTrailing =
                  Number.isFinite(state.trailingSpacing) && state.trailingSpacing > 0 ? state.trailingSpacing : 0;
                const currentStyleId =
                  typeof paraBlock.attrs?.styleId === 'string' ? paraBlock.attrs?.styleId : undefined;
                const currentContextualSpacing = asBoolean(paraBlock.attrs?.contextualSpacing);
                // Per-paragraph: each side independently suppresses its own spacing
                const prevSuppressAfter = shouldSuppressOwnSpacing(
                  state.lastParagraphStyleId,
                  state.lastParagraphContextualSpacing,
                  currentStyleId,
                );
                const currSuppressBefore = shouldSuppressOwnSpacing(
                  currentStyleId,
                  currentContextualSpacing,
                  state.lastParagraphStyleId,
                );
                let effectiveSpacingBefore: number;
                if (prevSuppressAfter && currSuppressBefore) {
                  effectiveSpacingBefore = 0;
                } else if (prevSuppressAfter) {
                  effectiveSpacingBefore = spacingBefore;
                } else if (currSuppressBefore) {
                  effectiveSpacingBefore = 0;
                } else {
                  effectiveSpacingBefore = Math.max(spacingBefore - prevTrailing, 0);
                }
                const currentHeight = getMeasureHeight(paraBlock, measure);
                const nextHeight = getMeasureHeight(nextBlock, nextMeasure);

                const nextIsParagraph = nextBlock.kind === 'paragraph' && nextMeasure.kind === 'paragraph';
                const nextSpacingBefore = nextIsParagraph ? getParagraphSpacingBefore(nextBlock) : 0;
                const nextStyleId =
                  nextIsParagraph && typeof nextBlock.attrs?.styleId === 'string'
                    ? nextBlock.attrs?.styleId
                    : undefined;
                const nextContextualSpacing = nextIsParagraph && asBoolean(nextBlock.attrs?.contextualSpacing);

                const currSuppressAfter = shouldSuppressOwnSpacing(
                  currentStyleId,
                  currentContextualSpacing,
                  nextStyleId,
                );
                const nextSuppressBefore =
                  nextIsParagraph && shouldSuppressOwnSpacing(nextStyleId, nextContextualSpacing, currentStyleId);
                const effectiveSpacingAfter = currSuppressAfter ? 0 : spacingAfter;
                const effectiveNextSpacingBefore = nextSuppressBefore ? 0 : nextSpacingBefore;
                const interParagraphSpacing = nextIsParagraph
                  ? Math.max(effectiveSpacingAfter, effectiveNextSpacingBefore)
                  : effectiveSpacingAfter;

                const nextFirstLineHeight = (() => {
                  if (!nextIsParagraph) {
                    return nextHeight;
                  }
                  const firstLineHeight = nextMeasure.lines[0]?.lineHeight;
                  if (typeof firstLineHeight === 'number' && Number.isFinite(firstLineHeight) && firstLineHeight > 0) {
                    return firstLineHeight;
                  }
                  return nextHeight;
                })();

                const combinedHeight = nextIsParagraph
                  ? effectiveSpacingBefore + currentHeight + interParagraphSpacing + nextFirstLineHeight
                  : effectiveSpacingBefore + currentHeight + spacingAfter + nextHeight;

                const effectiveAvailableHeight = prevSuppressAfter ? availableHeight + prevTrailing : availableHeight;
                if (combinedHeight > effectiveAvailableHeight && state.page.fragments.length > 0) {
                  state = paginator.advanceColumn(state);
                }
              }
            }
          }

          /**
           * Contextual spacing suppression for spacingAfter.
           * Per-paragraph: current paragraph suppresses its own after-spacing when
           * it has contextualSpacing and the next paragraph shares the same styleId.
           */
          let overrideSpacingAfter: number | undefined;
          const curStyleId = typeof paraBlock.attrs?.styleId === 'string' ? paraBlock.attrs.styleId : undefined;
          const curContextualSpacing = asBoolean(paraBlock.attrs?.contextualSpacing);
          if (curContextualSpacing && curStyleId) {
            const nextBlock = index < blocks.length - 1 ? blocks[index + 1] : null;
            if (nextBlock?.kind === 'paragraph') {
              const nextPara = nextBlock as ParagraphBlock;
              const nextStyleId = typeof nextPara.attrs?.styleId === 'string' ? nextPara.attrs?.styleId : undefined;
              if (shouldSuppressOwnSpacing(curStyleId, curContextualSpacing, nextStyleId)) {
                overrideSpacingAfter = 0;
              }
            }
          }

          const checkpointState = paginator.ensurePage();
          blockResumeCheckpoints.set(block.id, {
            blockId: block.id,
            pageIndex: checkpointState.page.number - 1 - pageNumberOffset,
            ...(preflightPageIndex != null ? { preflightPageIndex } : {}),
            prefixFragmentCount: checkpointState.page.fragments.length,
            cursorY: checkpointState.cursorY,
            maxCursorY: checkpointState.maxCursorY,
            ...(checkpointState.committedBodyBottom != null
              ? { committedBodyBottom: checkpointState.committedBodyBottom }
              : {}),
            columnIndex: checkpointState.columnIndex,
            trailingSpacing: checkpointState.trailingSpacing,
            ...(checkpointState.lastParagraphStyleId
              ? { lastParagraphStyleId: checkpointState.lastParagraphStyleId }
              : {}),
            lastParagraphContextualSpacing: checkpointState.lastParagraphContextualSpacing,
            ...(checkpointState.lastParagraphBorderHash
              ? { lastParagraphBorderHash: checkpointState.lastParagraphBorderHash }
              : {}),
            constraintBoundaries: checkpointState.constraintBoundaries.map((boundary) => ({
              y: boundary.y,
              columns: { ...boundary.columns },
            })),
            activeConstraintIndex: checkpointState.activeConstraintIndex,
            footnoteDemandThisPage: checkpointState.footnoteDemandThisPage,
            footnoteRefsThisPage: checkpointState.footnoteRefsThisPage,
            footnoteAnchorsThisPage: checkpointState.footnoteAnchorsThisPage.map((anchor) => ({ ...anchor })),
          });

          layoutParagraphBlock(
            {
              block,
              measure,
              columnWidth: getCurrentColumnWidth(),
              ensurePage: paginator.ensurePage,
              advanceColumn: paginator.advanceColumn,
              columnX,
              floatManager,
              remeasureParagraph: options.remeasureParagraph,
              overrideSpacingAfter,
              getFootnoteDemandForBlockId,
              getFootnoteRefCountForBlockId,
              getFootnoteBandOverhead,
              getFootnoteAnchorsForBlockId,
              incomingFootnoteDemand: options.footnotePageFlow?.incomingDemand,
              // A section-boundary filler paragraph can still be the coordinate
              // base for a paragraph-relative DrawingML object. Register that
              // object, but keep the carrier itself out of normal flow so it
              // cannot add a line or change Word-compatible pagination.
              layoutOnlyAnchorCarrier: splitCarrierMode === 'layoutOnly' || isSectionBoundaryAnchorCarrier,
              preserveAnchorCarrierPage: isSectionBoundaryAnchorCarrier,
              collapseSplitLineBreakCarrier: splitCarrierMode === 'spaced',
              positionedFrameAffectsFlow: !options.nonFlowPositionedParagraphFrameIds?.has(block.id),
            },
            hasAnchorsForLayout || tablesForPara
              ? {
                  anchoredDrawings: anchorsForLayout,
                  anchoredTables: tablesForPara,
                  columnWidth: getCurrentColumnWidth(),
                  pageWidth: activePageSize.w,
                  pageMargins: {
                    top: activeTopMargin,
                    bottom: activeBottomMargin,
                    left: activeLeftMargin,
                    right: activeRightMargin,
                  },
                  columns: getCurrentColumns(),
                  placedAnchoredIds,
                }
              : undefined,
          );

          if (splitCarrierMode === 'spaced') {
            const siblingBlock = blocks[index + 1];
            const siblingMeasure = measures[index + 1];
            const isAnchoredGraphic =
              (siblingBlock?.kind === 'image' && siblingMeasure?.kind === 'image') ||
              (siblingBlock?.kind === 'drawing' && siblingMeasure?.kind === 'drawing');
            if (isAnchoredGraphic && siblingBlock.anchor?.isAnchored === true) {
              const carrierPlacement = findLastParagraphFragment(block.id);
              if (carrierPlacement) {
                const existingPreRegisteredPosition = preRegisteredPositions.get(siblingBlock.id);
                const { state: carrierState, fragment: carrierFragment } = carrierPlacement;
                const carrierPage = carrierState.page;
                const pageSize = carrierPage.size ?? activePageSize;
                const pageMargins = carrierPage.margins ?? {};
                const carrierColumnIndex = carrierFragment.columnIndex ?? 0;
                const carrierLeftMargin = pageMargins.left ?? activeLeftMargin;
                const carrierRightMargin = pageMargins.right ?? activeRightMargin;
                const carrierColumns = getNormalizedColumnsForState(carrierState);
                const anchorY =
                  existingPreRegisteredPosition?.anchorY ??
                  resolveAnchoredGraphicY({
                    anchor: siblingBlock.anchor,
                    objectHeight: siblingMeasure.height ?? 0,
                    contentTop: pageMargins.top ?? activeTopMargin,
                    contentBottom: pageSize.h - (pageMargins.bottom ?? activeBottomMargin),
                    pageBottomMargin: pageMargins.bottom ?? activeBottomMargin,
                    anchorParagraphY: carrierFragment.y,
                    firstLineHeight: measure.lines[0]?.lineHeight ?? 0,
                    pageNumber: carrierPage.number,
                  });
                const anchorX =
                  existingPreRegisteredPosition?.anchorX ??
                  (siblingBlock.anchor
                    ? computeAnchorX(
                        siblingBlock.anchor,
                        carrierColumnIndex,
                        carrierColumns,
                        siblingMeasure.width,
                        { left: carrierLeftMargin, right: carrierRightMargin },
                        pageSize.w,
                        { pageNumber: carrierPage.number },
                      )
                    : carrierFragment.x);
                if (!placedAnchoredIds.has(siblingBlock.id)) {
                  floatManager.registerDrawing(
                    siblingBlock,
                    siblingMeasure,
                    anchorY,
                    carrierColumnIndex,
                    carrierPage.number,
                  );
                }
                preRegisteredPositions.set(siblingBlock.id, {
                  anchorX,
                  anchorY,
                  targetState: carrierState,
                  targetColumnIndex: carrierColumnIndex,
                });
              }
            }
          }

          continue;
        }
        if (block.kind === 'image') {
          if (measure.kind !== 'image') {
            throw new Error(`layoutDocument: expected image measure for block ${block.id}`);
          }

          // Check if this is a pre-registered page-relative anchor
          const preRegPos = preRegisteredPositions.get(block.id);
          if (
            preRegPos &&
            Number.isFinite(preRegPos.anchorX) &&
            Number.isFinite(preRegPos.anchorY) &&
            !placedAnchoredIds.has(block.id)
          ) {
            // Use pre-computed coordinates, pinning split-carrier siblings to their carrier page when provided.
            const targetState = preRegPos.targetState;
            const state = targetState ?? paginator.ensurePage();
            const targetColumnIndex = preRegPos.targetColumnIndex ?? state.columnIndex;
            const imgBlock = block as ImageBlock;
            const imgMeasure = measure as ImageMeasure;

            const pageContentHeight = Math.max(0, state.contentBottom - state.topMargin);
            const relativeFrom = imgBlock.anchor?.hRelativeFrom ?? 'column';
            let maxWidth: number;
            if (relativeFrom === 'page') {
              if (targetState) {
                const pageWidth = state.page.size?.w ?? activePageSize.w;
                const pageMargins = state.page.margins;
                const leftMargin = pageMargins?.left ?? activeLeftMargin;
                const rightMargin = pageMargins?.right ?? activeRightMargin;
                maxWidth =
                  resolveColumnCount(state.page.columns ?? { count: 1, gap: 0 }) === 1
                    ? pageWidth - (leftMargin + rightMargin)
                    : pageWidth;
              } else {
                const cols = getCurrentColumns();
                maxWidth =
                  cols.count === 1 ? activePageSize.w - (activeLeftMargin + activeRightMargin) : activePageSize.w;
              }
            } else if (relativeFrom === 'margin') {
              if (targetState) {
                const pageWidth = state.page.size?.w ?? activePageSize.w;
                const pageMargins = state.page.margins;
                maxWidth =
                  pageWidth - ((pageMargins?.left ?? activeLeftMargin) + (pageMargins?.right ?? activeRightMargin));
              } else {
                maxWidth = activePageSize.w - (activeLeftMargin + activeRightMargin);
              }
            } else {
              maxWidth = columnWidthForState(state, targetColumnIndex);
            }

            const aspectRatio =
              imgMeasure.width > 0 && imgMeasure.height > 0 ? imgMeasure.width / imgMeasure.height : 1.0;
            const minWidth = 20;
            const minHeight = minWidth / aspectRatio;

            const metadata: ImageFragmentMetadata = {
              originalWidth: imgMeasure.width,
              originalHeight: imgMeasure.height,
              maxWidth,
              maxHeight: pageContentHeight,
              aspectRatio,
              minWidth,
              minHeight,
            };

            const fragment: ImageFragment = {
              kind: 'image',
              blockId: imgBlock.id,
              x: preRegPos.anchorX,
              y: preRegPos.anchorY,
              width: imgMeasure.width,
              height: imgMeasure.height,
              isAnchored: true,
              behindDoc: imgBlock.anchor?.behindDoc === true,
              zIndex: getFragmentZIndex(imgBlock),
              metadata,
              sourceAnchor: imgBlock.sourceAnchor,
            };

            const attrs = imgBlock.attrs as Record<string, unknown> | undefined;
            if (attrs?.pmStart != null) fragment.pmStart = attrs.pmStart as number;
            if (attrs?.pmEnd != null) fragment.pmEnd = attrs.pmEnd as number;

            state.page.fragments.push(fragment);
            placedAnchoredIds.add(imgBlock.id);
            continue;
          }

          layoutImageBlock({
            block: block as ImageBlock,
            measure: measure as ImageMeasure,
            columns: getCurrentColumns(),
            ensurePage: paginator.ensurePage,
            advanceColumn: paginator.advanceColumn,
            columnX,
          });
          continue;
        }
        if (block.kind === 'drawing') {
          if (measure.kind !== 'drawing') {
            throw new Error(`layoutDocument: expected drawing measure for block ${block.id}`);
          }

          // Check if this is a pre-registered page-relative anchor
          const preRegPos = preRegisteredPositions.get(block.id);
          if (
            preRegPos &&
            Number.isFinite(preRegPos.anchorX) &&
            Number.isFinite(preRegPos.anchorY) &&
            !placedAnchoredIds.has(block.id)
          ) {
            // Use pre-computed coordinates, pinning split-carrier siblings to their carrier page when provided.
            const state = preRegPos.targetState ?? paginator.ensurePage();
            const drawBlock = block as DrawingBlock;
            const drawMeasure = measure as DrawingMeasure;
            const contentMeasures =
              drawBlock.drawingKind === 'textboxShape'
                ? resolveTextboxContentMeasures(drawBlock, drawMeasure, options.remeasureParagraph)
                : undefined;

            const fragment: DrawingFragment = {
              kind: 'drawing',
              blockId: drawBlock.id,
              drawingKind: drawBlock.drawingKind,
              x: preRegPos.anchorX,
              y: preRegPos.anchorY,
              width: drawMeasure.width,
              height: drawMeasure.height,
              geometry: drawMeasure.geometry,
              scale: drawMeasure.scale,
              isAnchored: true,
              behindDoc: drawBlock.anchor?.behindDoc === true,
              zIndex: getFragmentZIndex(drawBlock),
              drawingContentId: drawBlock.drawingContentId,
              sourceAnchor: drawBlock.sourceAnchor,
            };

            if (contentMeasures) {
              fragment.contentMeasures = contentMeasures;
              const textboxId = drawBlock.attrs?.textboxId;
              if (typeof textboxId === 'string' && textboxId.length > 0) fragment.textboxId = textboxId;
            }

            const attrs = drawBlock.attrs as Record<string, unknown> | undefined;
            if (attrs?.pmStart != null) fragment.pmStart = attrs.pmStart as number;
            if (attrs?.pmEnd != null) fragment.pmEnd = attrs.pmEnd as number;

            state.page.fragments.push(fragment);
            placedAnchoredIds.add(drawBlock.id);
            continue;
          }

          layoutDrawingBlock({
            block: block as DrawingBlock,
            measure: measure as DrawingMeasure,
            columns: getCurrentColumns(),
            ensurePage: paginator.ensurePage,
            advanceColumn: paginator.advanceColumn,
            columnX,
            textboxContentMeasures:
              block.drawingKind === 'textboxShape'
                ? resolveTextboxContentMeasures(block, measure, options.remeasureParagraph)
                : undefined,
          });
          continue;
        }
        if (block.kind === 'table') {
          if (measure.kind !== 'table') {
            throw new Error(`layoutDocument: expected table measure for block ${block.id}`);
          }
          const resumeCursor =
            !tableResumeConsumed && requestedTableResume?.blockId === block.id
              ? requestedTableResume.cursor
              : undefined;
          if (resumeCursor) tableResumeConsumed = true;
          const tableSteps = layoutTableBlockSteps({
            block: block as TableBlock,
            measure: measure as TableMeasure,
            columnWidth: getCurrentColumnWidth(),
            ensurePage: paginator.ensurePage,
            advanceColumn: paginator.advanceColumn,
            columnX,
            ...(resumeCursor ? { resumeCursor } : {}),
            onFragmentStart: (state, cursor) => captureTableResumeCheckpoint(block.id, state, cursor),
          });
          while (true) {
            const tableStep = tableSteps.next();
            if (tableStep.done) break;
            if (checkpointEveryBlocks != null) {
              yield {
                phase: 'layout-document:table-fragment',
                index: tableStep.value.index,
                total: tableStep.value.total,
              };
            }
          }
          continue;
        }
        // (handled earlier) list and image

        // Page break: force start of new page
        // Corresponds to DOCX <w:br w:type="page"/> or manual page breaks
        if (block.kind === 'pageBreak') {
          if (measure.kind !== 'pageBreak') {
            throw new Error(`layoutDocument: expected pageBreak measure for block ${block.id}`);
          }
          const currentState = states[states.length - 1];
          if (
            shouldSkipRedundantPageBreakBefore(block as PageBreakBlock, currentState) ||
            isPageBreakBeforeSatisfiedByExplicitBreak(blocks, index)
          ) {
            continue;
          }
          paginator.startNewPage();
          continue;
        }

        // Column break: advance to next column or start new page if in last column
        // Corresponds to DOCX <w:br w:type="column"/>. Section `nextColumn` advances
        // via forceColumnBreak on the sectionBreak path instead.
        if (block.kind === 'columnBreak') {
          if (measure.kind !== 'columnBreak') {
            throw new Error(`layoutDocument: expected columnBreak measure for block ${block.id}`);
          }
          const state = paginator.ensurePage();
          // Activate pending multi-column geometry first so a column break that also
          // introduced columns advances within the page instead of startNewPage()-ing
          // from a 1-col layout.
          if (
            pendingColumns &&
            resolveColumnCount(pendingColumns) > 1 &&
            resolveColumnCount(getActiveColumnsForState(state)) < 2
          ) {
            startMidPageRegion(state, pendingColumns);
            pendingColumns = null;
          }
          const activeCols = getActiveColumnsForState(state);

          if (state.columnIndex < resolveColumnCount(activeCols) - 1) {
            // Not in last column: advance to next column
            advanceColumn(state);
          } else {
            // In last column: start new page
            paginator.startNewPage();
          }
          continue;
        }

        throw new Error(`layoutDocument: unsupported block kind for ${(block as FlowBlock).id}`);
      } catch (error) {
        if (isPaginationEarlyStop(error)) throw error;
        let progress: V2RenderDiagnosticPaginationProgress | null = null;
        try {
          progress = captureRenderDiagnosticPaginationProgress(block);
        } catch {
          progress = null;
        }
        const owned = renderDiagnosticOwner?.({
          blockIds: [block.id],
          debugDetail: error,
          phase: 'dispatch',
          ...(progress ? { progress } : {}),
        });
        if (owned) throw owned;
        throw error;
      }
    }

    // Prune trailing empty page(s) that can be created by page-boundary rules
    // (e.g., parity requirements) when no content follows. Word does not render
    // a final blank page for continuous final sections.
    if (options.footnotePageFlow && options.footnotePageFlow.completeDocument !== false && pages.length > 0) {
      completeFootnotePage(paginator.ensurePage());
      while (options.footnotePageFlow.hasPendingContinuation()) {
        const state = paginator.startNewPage();
        completeFootnotePage(state);
        if (checkpointEveryBlocks != null) {
          yield { phase: 'layout-document:footnote-continuation', index: pages.length - 1 };
        }
      }
    }
    paginator.pruneTrailingEmptyPages();

    const resetPaginationStateForBlankPageFallback = (): void => {
      pageCount = 0;
      activePageCounter = activeSectionPageCounterStart;
      sectionFirstPageNumbers.clear();
    };

    shouldUseBlankPageFallback = pages.length === 0;

    if (
      shouldUseBlankPageFallback &&
      ((allowParagraphlessAnchoredTableFallback && paragraphlessAnchoredTables.length > 0) ||
        (allowParagraphlessAnchoredDrawingFallback && paragraphlessAnchoredDrawings.length > 0) ||
        (allowSectionBreakOnlyPageFallback && hasOnlySectionBreakBlocks(blocks)))
    ) {
      resetPaginationStateForBlankPageFallback();
    }

    if (
      allowParagraphlessAnchoredDrawingFallback &&
      shouldUseBlankPageFallback &&
      paragraphlessAnchoredDrawings.length > 0
    ) {
      const state = paginator.ensurePage();

      for (const { block, measure } of paragraphlessAnchoredDrawings) {
        if (placedAnchoredIds.has(block.id)) continue;

        const anchorX = resolveParagraphlessAnchoredDrawingX(block, measure, state);
        const anchorY = resolveParagraphlessAnchoredDrawingY(block, measure, state);

        if (block.kind === 'image' && measure.kind === 'image') {
          const pageContentHeight = Math.max(0, state.contentBottom - state.topMargin);
          const aspectRatio = measure.width > 0 && measure.height > 0 ? measure.width / measure.height : 1.0;
          const minWidth = 20;
          const minHeight = minWidth / aspectRatio;
          const fragment: ImageFragment = {
            kind: 'image',
            blockId: block.id,
            x: anchorX,
            y: anchorY,
            width: measure.width,
            height: measure.height,
            isAnchored: true,
            behindDoc: block.anchor?.behindDoc === true,
            zIndex: getFragmentZIndex(block),
            metadata: {
              originalWidth: measure.width,
              originalHeight: measure.height,
              maxWidth: activePageSize.w - (activeLeftMargin + activeRightMargin),
              maxHeight: pageContentHeight,
              aspectRatio,
              minWidth,
              minHeight,
            },
            sourceAnchor: block.sourceAnchor,
          };
          const attrs = block.attrs as Record<string, unknown> | undefined;
          if (attrs?.pmStart != null) fragment.pmStart = attrs.pmStart as number;
          if (attrs?.pmEnd != null) fragment.pmEnd = attrs.pmEnd as number;
          state.page.fragments.push(fragment);
          placedAnchoredIds.add(block.id);
          continue;
        }

        if (block.kind === 'drawing' && measure.kind === 'drawing') {
          const contentMeasures =
            block.drawingKind === 'textboxShape'
              ? resolveTextboxContentMeasures(block, measure, options.remeasureParagraph)
              : undefined;
          const fragment: DrawingFragment = {
            kind: 'drawing',
            blockId: block.id,
            drawingKind: block.drawingKind,
            x: anchorX,
            y: anchorY,
            width: measure.width,
            height: measure.height,
            geometry: measure.geometry,
            scale: measure.scale,
            isAnchored: true,
            behindDoc: block.anchor?.behindDoc === true,
            zIndex: getFragmentZIndex(block),
            drawingContentId: block.drawingContentId,
            sourceAnchor: block.sourceAnchor,
          };
          if (contentMeasures) {
            fragment.contentMeasures = contentMeasures;
            const textboxId = block.attrs?.textboxId;
            if (typeof textboxId === 'string' && textboxId.length > 0) fragment.textboxId = textboxId;
          }
          const attrs = block.attrs as Record<string, unknown> | undefined;
          if (attrs?.pmStart != null) fragment.pmStart = attrs.pmStart as number;
          if (attrs?.pmEnd != null) fragment.pmEnd = attrs.pmEnd as number;
          state.page.fragments.push(fragment);
          placedAnchoredIds.add(block.id);
        }
      }
    }
  } catch (error) {
    if (!isPaginationEarlyStop(error)) {
      throw error;
    }
  }

  if (allowParagraphlessAnchoredTableFallback && shouldUseBlankPageFallback && paragraphlessAnchoredTables.length > 0) {
    const state = paginator.ensurePage();

    for (const { block: tableBlock, measure: tableMeasure } of paragraphlessAnchoredTables) {
      const columnWidthForTable = getCurrentColumnWidth();
      const totalWidth = tableMeasure.totalWidth ?? 0;
      const shouldFlowInline = isAnchoredTableFullWidth(tableBlock, tableMeasure, columnWidthForTable);

      if (shouldFlowInline) {
        continue;
      }

      const anchorY = resolveParagraphlessAnchoredTableY(tableBlock, tableMeasure, state);
      const anchorX = tableBlock.anchor?.offsetH ?? columnX(state);

      floatManager.registerTable(tableBlock, tableMeasure, anchorY, state.columnIndex, state.page.number);
      state.page.fragments.push(createAnchoredTableFragment(tableBlock, tableMeasure, anchorX, anchorY));
    }
  }

  if (allowSectionBreakOnlyPageFallback && shouldUseBlankPageFallback && hasOnlySectionBreakBlocks(blocks)) {
    paginator.ensurePage();
  }

  // Post-process pages with vertical alignment (center, bottom, both)
  // For each page, calculate content bounds and apply Y offset to all fragments
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex]!;
    if (checkpointEveryBlocks != null) {
      yield {
        phase: 'layout-document:finalize-page',
        index: pageIndex,
        total: pages.length,
      };
    }
    if (!page.vAlign || page.vAlign === 'top') {
      continue;
    }
    if (page.fragments.length === 0) {
      continue;
    }

    // Get page dimensions. For vAlign centering, use BASE margins (not inflated margins)
    // to match Word's behavior where headers/footers don't affect vertical alignment.
    const pageSizeForPage = page.size ?? pageSize;
    const baseTop = page.baseMargins?.top ?? page.margins?.top ?? margins.top;
    const baseBottom = page.baseMargins?.bottom ?? page.margins?.bottom ?? margins.bottom;
    const contentTop = baseTop;
    const contentBottom = pageSizeForPage.h - baseBottom;
    const contentHeight = contentBottom - contentTop;

    // Calculate the actual content bounds (min and max Y of all fragments)
    let minY = Infinity;
    let maxY = -Infinity;

    for (const fragment of page.fragments) {
      if (fragment.y < minY) minY = fragment.y;

      // Calculate fragment bottom based on type
      // Image, Drawing, and Table fragments have a height property
      // Para and ListItem fragments do not have height in their contract
      let fragmentBottom = fragment.y;
      if (hasHeight(fragment)) {
        // Type guard ensures fragment.height exists
        fragmentBottom += fragment.height;
      } else {
        // Para and list-item fragments don't have a height property
        // Calculate height based on number of lines spanned by the fragment
        const lineCount = fragment.toLine - fragment.fromLine;
        fragmentBottom += lineCount * DEFAULT_PARAGRAPH_LINE_HEIGHT_PX;
      }

      if (fragmentBottom > maxY) maxY = fragmentBottom;
    }

    // Content takes space from minY to maxY
    const actualContentHeight = maxY - minY;
    const availableSpace = contentHeight - actualContentHeight;

    if (availableSpace <= 0) {
      continue; // Content fills or exceeds page, no adjustment needed
    }

    // Calculate Y offset based on vAlign
    let yOffset = 0;
    if (page.vAlign === 'center') {
      yOffset = availableSpace / 2;
    } else if (page.vAlign === 'bottom') {
      yOffset = availableSpace;
    } else if (page.vAlign === 'both') {
      // LIMITATION: 'both' (vertical justification) is currently treated as 'center'
      //
      // The 'both' value in OOXML means content should be vertically justified:
      // space should be distributed evenly between paragraphs/blocks throughout
      // the page (similar to text-align: justify but in the vertical direction).
      //
      // Full implementation would require:
      // 1. Identifying gaps between content blocks (paragraphs, tables, images)
      // 2. Calculating total inter-block spacing
      // 3. Distributing available space proportionally across all gaps
      // 4. Adjusting Y positions of each fragment based on cumulative spacing
      //
      // This would need significant refactoring of the layout flow to track
      // block boundaries and inter-block relationships during pagination.
      // For now, center alignment provides a reasonable approximation.
      yOffset = availableSpace / 2;
    }

    // Apply Y offset to all fragments on this page
    if (yOffset > 0) {
      for (const fragment of page.fragments) {
        fragment.y += yOffset;
      }
    }
  }

  // Apply column balancing per section. For each section with a multi-column layout,
  // find the final page that carries any of its fragments and balance those fragments.
  // Earlier pages of a multi-page section are always fully filled (content overflowed
  // to reach them), so balancing is a no-op there. This replaces the previous
  // "last page of document" heuristic with proper per-section balancing — required
  // to match Word's behavior when a document has multiple multi-column sections
  // separated by continuous or next-page breaks.
  //
  // Mid-page continuous breaks are handled in the layout loop itself (see the
  // forceMidPageRegion branch above). This post-layout pass handles sections that
  // end at a page boundary or at document end.
  //
  // Document-wide fallback: when callers pass `LayoutOptions.columns` directly
  // without sectionBreak metadata, pm-adapter never stamps sectionIndex on any
  // block and `sectionColumnsMap` stays empty. Synthesize a single virtual
  // section that spans the whole document so multi-column callers still get
  // their final page balanced (preserves the pre-SD-2452 behavior). Skip when
  // the document carries an explicit column break — author intent wins.
  const FALLBACK_SECTION_IDX = -1;
  if (
    sectionColumnsMap.size === 0 &&
    !documentHasAnySectionBreak &&
    resolveColumnCount(activeColumns) > 1 &&
    !documentHasExplicitColumnBreak
  ) {
    sectionColumnsMap.set(FALLBACK_SECTION_IDX, cloneColumnLayout(activeColumns));
    for (const block of blocks) {
      blockSectionMap.set(block.id, FALLBACK_SECTION_IDX);
    }
  }

  for (const [sectionIdx, sectionCols] of sectionColumnsMap) {
    if (checkpointEveryBlocks != null) {
      yield { phase: 'layout-document:finalize-section', index: sectionIdx, total: sectionColumnsMap.size };
    }
    if (resolveColumnCount(sectionCols) <= 1) continue;
    if (sectionHasExplicitColumnBreak.has(sectionIdx)) continue;
    if (alreadyBalancedSections.has(sectionIdx)) continue;

    // Gate balancing per ECMA-376 §17.18.77 + empirical Word behavior. The
    // section type defaults to `nextPage` for any sectPr without `<w:type>`,
    // so we lean on `typeIsExplicit` to know what was actually authored:
    //
    //   - Explicit `<w:type w:val="continuous"/>` ending the section (or
    //     anywhere in the doc) signals continuous flow. Word balances the
    //     adjacent multi-column sections.
    //   - A multi-page multi-column section is balanced on its last page
    //     regardless of explicitness — this is the long-standing
    //     two_column_two_page-arial p17 behavior driven by SD-2646.
    //
    // Skip-when-not-allowed is the default. The three allowed scenarios:
    //
    //   1. Mid-doc explicit continuous: section's own end-break is
    //      `continuous` AND it is not the last section. Covers spec-test-1..5
    //      and sd-2326 (explicit continuous mid-doc).
    //
    //   2. Doc-wide explicit continuous + non-explicitly-non-continuous
    //      section: the doc has at least one EXPLICIT continuous break
    //      somewhere AND this section's type was NOT explicitly set to a
    //      page-forcing type. Covers sd-1480-two-col-tab-positions: section 0
    //      ends with default `nextPage` but the body sectPr has explicit
    //      `continuous` — Word balances 6 entries 3+3 on a single page.
    //
    //   3. Multi-page section: any section whose content spans more than one
    //      page. Covers `two_column_two_page-arial 2` p17 (body default,
    //      single section, 17 pages → balanced 3+2 on the final page).
    //
    // Skip path covers `sd-1655-col-sep-3-equal-columns` (single section,
    // body without `<w:type>`, single page, 3-col): no scenario fires →
    // Word fills column-by-column without balancing.
    //
    // FALLBACK_SECTION_IDX (-1) bypasses the gate — synthesized only when
    // pm-adapter emitted no section metadata at all.
    if (sectionIdx !== FALLBACK_SECTION_IDX) {
      const endBreakType = sectionEndBreakType.get(sectionIdx);
      const typeIsExplicit = sectionTypeIsExplicit.get(sectionIdx) === true;
      const isLast = lastSectionIdx !== null && sectionIdx === lastSectionIdx;

      // Per ECMA-376 §17.18.77, a continuous break balances the section it
      // ENDS — i.e., the section BEFORE the break, not the section that
      // contains or follows it. When the body sectPr authors an explicit
      // continuous break, the affected section is the one IMMEDIATELY
      // preceding the body. Compare:
      //
      //   sd-1480: 2 sections; body (section 1) is explicit-continuous,
      //            section 0 has the 2-col content. Word balances section 0
      //            (3+3) — exactly bodyExplicitContinuousIdx - 1.
      //   mixed-columns-tabs-tnr: body explicit-continuous, body has the
      //            2-col Test list, section 0 is 1-col descriptions. Word
      //            does NOT balance section 1 (14+5 column-flow); the
      //            body-as-trigger applies to section 0 (single-col, no-op).
      //
      // Earlier this rule used a doc-wide `docHasExplicitContinuous` flag,
      // which over-fired for any multi-col section in the document whenever
      // some other section was explicit-continuous — including a single-page
      // body section with omitted `<w:type>` that should match sd-1655's
      // skip rule. Tying it to bodyExplicitContinuousIdx − 1 (the section
      // the break actually ends) restores ECMA-correct scope.
      const bodyExplicitContinuousIdx =
        lastSectionIdx !== null &&
        sectionTypeIsExplicit.get(lastSectionIdx) === true &&
        sectionEndBreakType.get(lastSectionIdx) === 'continuous'
          ? lastSectionIdx
          : null;

      const isExplicitNonContinuous =
        typeIsExplicit && (endBreakType === 'nextPage' || endBreakType === 'evenPage' || endBreakType === 'oddPage');

      // Page-count probe used by both the multi-page allow rule (3) and the
      // mid-doc multi-page skip below. Computed once and short-circuits at >1.
      let sectionPagesCount = 0;
      for (const p of pages) {
        if (p.fragments.some((f) => blockSectionMap.get(f.blockId) === sectionIdx)) {
          sectionPagesCount += 1;
          if (sectionPagesCount > 1) break;
        }
      }
      const isMultiPage = sectionPagesCount > 1;

      // Mid-doc multi-page multi-column sections: Word does NOT balance the
      // last page. ECMA's "minimum section height" balancing makes sense for
      // single-page sections (rebalancing visibly shrinks the section) but
      // not for multi-page sections whose height is already pinned by the
      // page boundary — last-page rebalancing would just reshuffle a
      // handful of overflow fragments. Verified against:
      //   layout/ivosass-sub p3   (section 1, mid-doc, 2-page, 4 overflow
      //                            fragments → Word leaves them in col 0).
      //   lists/saas_original p4  (similar — overflow content stays single).
      // Multi-page LAST sections still balance via rule 3 below
      // (two_column_two_page-arial 2 p17 keeps its 3+2 split).
      if (isMultiPage && !isLast) continue;

      // The per-section type is the type of the break that BEGINS the section
      // (its own sectPr `w:type`, §17.6.22) — i.e. the break that closes the
      // PREVIOUS section. The break that ends section N is therefore section
      // N+1's begin type. Keying rule 1 off the section's OWN type balanced a
      // 2-col section that merely STARTED continuous even when it ended at a
      // nextPage break — Word only balances when the break AFTER the section
      // is continuous (§17.18.77 note, SD-3359 V6 repro). The next-is-body
      // case is excluded here: a body sectPr defaults to `continuous` when
      // `<w:type>` is omitted and Word does NOT balance then (sd-1655) —
      // rule 2 below owns that boundary and demands explicitness.
      const nextSectionBeginType = sectionEndBreakType.get(sectionIdx + 1);
      const nextIsBody = lastSectionIdx !== null && sectionIdx + 1 === lastSectionIdx;
      const allowedByMidDocContinuous = !isLast && !nextIsBody && nextSectionBeginType === 'continuous';
      // Body-explicit-continuous balances the section IT ENDS, which is the
      // section immediately preceding the body. No doc-wide flag.
      const allowedByBodyExplicitContinuous =
        bodyExplicitContinuousIdx !== null && sectionIdx === bodyExplicitContinuousIdx - 1 && !isExplicitNonContinuous;
      const allowedByMultiPage = isMultiPage;

      if (!allowedByMidDocContinuous && !allowedByBodyExplicitContinuous && !allowedByMultiPage) continue;
    }

    // Find the last page carrying any fragments from this section.
    let lastPageForSection: (typeof pages)[number] | null = null;
    for (const p of pages) {
      if (p.fragments.some((f) => blockSectionMap.get(f.blockId) === sectionIdx)) {
        lastPageForSection = p;
      }
    }
    if (!lastPageForSection) continue;

    // Section-local page geometry. Each page snapshots its own margins and size
    // at startNewPage time (paginator.ts), so different sections with different
    // page setups (margins, paper size, orientation) carry their own values on
    // their pages. Earlier code derived the content box from the FINAL active*
    // state, which silently rewrote earlier sections' fragments using the last
    // section's content width and left margin. Use the target page's metrics.
    const sectionPageSize = lastPageForSection.size ?? pageSize;
    const sectionPageMargins = lastPageForSection.margins;
    const sectionLeftMargin = sectionPageMargins?.left ?? activeLeftMargin;
    const sectionRightMargin = sectionPageMargins?.right ?? activeRightMargin;
    const sectionTopMarginPx = sectionPageMargins?.top ?? activeTopMargin;
    const sectionBottomMargin = sectionPageMargins?.bottom ?? activeBottomMargin;
    const sectionContentWidth = sectionPageSize.w - (sectionLeftMargin + sectionRightMargin);
    const sectionAvailableHeight = sectionPageSize.h - sectionBottomMargin - sectionTopMarginPx;

    const normalized = normalizeColumns(sectionCols, sectionContentWidth);

    balanceSectionOnPage({
      fragments: lastPageForSection.fragments as BalancingFragment[],
      sectionIndex: sectionIdx,
      sectionColumns: toBalancingColumns(normalized),
      sectionHasExplicitColumnBreak: false, // already filtered above
      blockSectionMap,
      margins: { left: sectionLeftMargin },
      topMargin: sectionTopMarginPx,
      columnWidth: normalized.width,
      availableHeight: sectionAvailableHeight,
      measureMap: balancingMeasureMap,
      sectPrMarkerBlockIds,
      keepLinesBlockIds,
    });
  }

  // Serialize constraint boundaries into page.columnRegions so DomPainter can
  // draw per-region overlays (e.g. column separator lines) bounded by the
  // correct Y span. Continuous section breaks with a changed column config
  // push boundaries into PageState.constraintBoundaries during layout; without
  // this step the renderer only sees the page-start column config and would
  // draw a single full-page separator across regions it no longer applies to.
  for (let stateIndex = 0; stateIndex < states.length; stateIndex += 1) {
    const state = states[stateIndex]!;
    if (checkpointEveryBlocks != null) {
      yield {
        phase: 'layout-document:finalize-page',
        index: stateIndex,
        total: states.length,
      };
    }
    const boundaries = state.constraintBoundaries;
    if (boundaries.length === 0) continue;

    const regions: ColumnRegion[] = [];
    // First region spans from the top of the content area to the first boundary.
    // Its columns come from page.columns (set at page creation before any
    // mid-page region change) or fall back to a single-column default so the
    // contract stays self-describing even when the page starts single-column.
    const firstRegionColumns: ColumnLayout = state.page.columns ?? { count: 1, gap: 0 };
    regions.push({
      yStart: state.topMargin,
      yEnd: boundaries[0].y,
      columns: firstRegionColumns,
    });
    for (let i = 0; i < boundaries.length; i++) {
      const start = boundaries[i];
      const end = boundaries[i + 1];
      regions.push({
        yStart: start.y,
        yEnd: end ? end.y : state.contentBottom,
        // Render-facing region metadata: resolve so a count>widths region does not advertise
        // phantom columns to the separator renderer, which reads these configs raw (SD-2629).
        columns: resolveColumnLayout(start.columns),
      });
    }
    state.page.columnRegions = regions;
  }

  alignInlineZeroHeightDrawingFragments(pages, blocks, measures);

  // SD-2656: stash each page's actual body-bottom on the Page so the band
  // painter can render the separator immediately under the last body
  // fragment instead of at the legacy reserve-derived position. Trailing
  // paragraph spacing is subtracted because it's "below the last line" and
  // shouldn't push the separator down by that much — but only when the
  // current column's cursorY is the one that set maxCursorY. In a multi-
  // column page, `advanceColumn` preserves maxCursorY across columns while
  // resetting trailingSpacing to 0; the trailingSpacing observed at the
  // page tail belongs to the last column's last fragment, not to whichever
  // fragment set maxCursorY. Subtracting it unconditionally would clip the
  // band up into the body of an earlier, taller column.
  const blockById = new Map(blocks.map((block) => [block.id, block]));
  const measureById = new Map(blocks.map((block, index) => [block.id, measures[index]]));
  for (let i = 0; i < pages.length && i < paginator.states.length; i++) {
    const s = paginator.states[i];
    const maxY = s.maxCursorY ?? 0;
    const cursorY = s.cursorY ?? 0;
    const trailing = s.trailingSpacing ?? 0;
    const floatingTableMaxY = maxFlowAffectingFloatingTableBottom(pages[i], blockById, measureById);
    const raw = Math.max(maxY, cursorY, floatingTableMaxY);
    const trailingAttachedToMax = cursorY >= maxY;
    const adjusted = raw - (trailingAttachedToMax ? trailing : 0);
    (pages[i] as { bodyMaxY?: number }).bodyMaxY = options.footnotePageFlow
      ? (s.committedBodyBottom ?? s.topMargin)
      : Math.max(s.topMargin ?? 0, adjusted);
  }

  const layout: Layout = {
    pageSize,
    pages,
    blockResumeCheckpoints,
    ...(options.documentBackground ? { documentBackground: options.documentBackground } : {}),
    // Note: columns here reflects the effective default for subsequent pages
    // after processing sections. Page/region-specific column changes are encoded
    // implicitly via fragment positions. Consumers should not assume this is
    // a static document-wide value.
    columns: resolveColumnCount(activeColumns) > 1 ? resolveColumnLayout(activeColumns) : undefined,
  };
  writeTableLayoutResumeCheckpoints(layout, tableResumeCheckpoints);
  return layout;
}

/**
 * The synchronous API drains the same resumable state machine without host
 * turns. Mounted orchestration uses `layoutDocumentCooperatively`; keeping one
 * algorithm prevents cancellation support from becoming a second paginator.
 */
export function layoutDocument(blocks: FlowBlock[], measures: Measure[], options: LayoutOptions = {}): Layout {
  const steps = layoutDocumentSteps(blocks, measures, options, null);
  while (true) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

export async function layoutDocumentCooperatively(
  blocks: FlowBlock[],
  measures: Measure[],
  options: LayoutOptions = {},
  execution?: LayoutExecutionControl,
): Promise<Layout> {
  const steps = layoutDocumentSteps(blocks, measures, options, layoutExecutionCheckpointEveryBlocks(execution));
  try {
    while (true) {
      const step = steps.next();
      if (step.done) return step.value;
      await checkpointLayoutExecution(execution, step.value);
    }
  } finally {
    steps.return?.(undefined as never);
  }
}

export type LayoutRangeBoundaryPolicy = 'conservative-context' | 'overscan' | 'degraded-on-incomplete-state';

export type LayoutRangeExactness = 'exact' | 'pending-layout' | 'degraded-unsupported' | 'stale';

export type LayoutRangeSourceRange = {
  startOrdinal: number;
  endOrdinalExclusive: number;
};

export type LayoutRangePage = {
  pageIndex: number;
  page: Page;
  sourceRange: LayoutRangeSourceRange | null;
};

export type LayoutRangeCheckpoint = {
  pageIndex: number;
  sourceOrdinal: number;
  pageNumber?: number;
  pageTopPx?: number;
  pageSize?: PageSize;
  margins?: Margins;
  activeColumns?: ColumnLayout;
};

export type LayoutRangeInput = {
  sourceSegment: {
    blocks: readonly FlowBlock[];
    measures: readonly Measure[];
    sourceRange: LayoutRangeSourceRange;
  };
  startingCheckpoint: LayoutRangeCheckpoint | null;
  pageRange: { startPageIndex: number; endPageIndexExclusive: number };
  pageCountBudget?: number;
  ordinalBudget?: number;
  boundaryPolicy?: LayoutRangeBoundaryPolicy;
  overscanBeforePages?: number;
  overscanAfterPages?: number;
  options?: LayoutOptions;
};

export type LayoutRangeResult = {
  layout: Layout;
  pages: readonly LayoutRangePage[];
  endingCheckpoint: LayoutRangeCheckpoint | null;
  exactness: LayoutRangeExactness;
  diagnostics: readonly string[];
};

/**
 * Legacy page-range exploration.
 *
 * This is not used by performance:pipeline or performance:pipeline:typing.
 * The new mutation work starts with the dedicated snapshotComplete stage in
 * the performance pipeline harness and should not be built on this API.
 *
 * Layout a page range from a validated page-boundary checkpoint without
 * replaying the document prefix. This first production slice is deliberately
 * conservative: simple self-contained ranges can be exact; unsupported shapes
 * fail closed so callers can paint pending/degraded slots instead of compacting
 * sparse content into fake page numbers.
 */
export function layoutDocumentRange(input: LayoutRangeInput): LayoutRangeResult {
  const diagnostics: string[] = [];
  const boundaryPolicy = input.boundaryPolicy ?? 'conservative-context';
  const pageRange = normalizePageRange(input.pageRange);
  const sourceRange = normalizeSourceRange(input.sourceSegment.sourceRange);
  const startingCheckpoint =
    input.startingCheckpoint ?? implicitInitialCheckpoint(pageRange, sourceRange, input.options);
  const pageSize = input.options?.pageSize ?? startingCheckpoint?.pageSize ?? DEFAULT_PAGE_SIZE;
  const margins = input.options?.margins ?? startingCheckpoint?.margins ?? DEFAULT_MARGINS;
  const pageCountBudget = positiveIntegerOrNull(input.pageCountBudget);
  const ordinalBudget = positiveIntegerOrNull(input.ordinalBudget);
  const blocks = input.sourceSegment.blocks.slice(0, ordinalBudget ?? input.sourceSegment.blocks.length);
  const measures = input.sourceSegment.measures.slice(0, blocks.length);

  if (input.sourceSegment.blocks.length !== input.sourceSegment.measures.length) {
    throw new Error(
      `layoutDocumentRange expected measures for every segment block (blocks=${input.sourceSegment.blocks.length}, measures=${input.sourceSegment.measures.length})`,
    );
  }
  if (pageRange.endPageIndexExclusive <= pageRange.startPageIndex) {
    return emptyLayoutRangeResult(pageSize, null, 'pending-layout', ['empty-page-range']);
  }
  if (blocks.length === 0) {
    return emptyLayoutRangeResult(pageSize, startingCheckpoint, 'pending-layout', ['empty-source-segment']);
  }
  if (!startingCheckpoint) {
    return emptyLayoutRangeResult(pageSize, null, 'degraded-unsupported', [
      `range-boundary-incomplete:${boundaryPolicy}`,
    ]);
  }

  const boundaryFailure = validateRangeBoundary(startingCheckpoint, pageRange, sourceRange, boundaryPolicy);
  if (boundaryFailure) {
    return emptyLayoutRangeResult(pageSize, startingCheckpoint, boundaryFailure.exactness, [boundaryFailure.reason]);
  }

  const unsupportedBlock = blocks.find((block) => unsupportedRangeBlockReason(block) != null);
  if (unsupportedBlock) {
    return emptyLayoutRangeResult(pageSize, startingCheckpoint, 'degraded-unsupported', [
      unsupportedRangeBlockReason(unsupportedBlock) ?? 'unsupported-range-layout-block',
    ]);
  }

  diagnostics.push(
    `range-layout-source:checkpoint:${startingCheckpoint.pageIndex}:${startingCheckpoint.sourceOrdinal}`,
  );
  if (boundaryPolicy === 'overscan') {
    diagnostics.push(
      `range-layout-overscan:${nonNegativeIntegerValue(input.overscanBeforePages)}:${nonNegativeIntegerValue(
        input.overscanAfterPages,
      )}`,
    );
  }

  const segmentLayout = layoutDocument([...blocks], [...measures], {
    ...input.options,
    pageSize,
    margins,
    columns: input.options?.columns ?? startingCheckpoint.activeColumns,
  });
  const effectiveRange = applyRangeOverscan(pageRange, input);
  const mappedPages = segmentLayout.pages
    .slice(0, pageCountBudget ?? segmentLayout.pages.length)
    .map((page, localPageIndex) => remapRangePage(page, startingCheckpoint, localPageIndex, sourceRange, blocks))
    .filter(
      (page) =>
        page.pageIndex >= effectiveRange.startPageIndex && page.pageIndex < effectiveRange.endPageIndexExclusive,
    );

  const layout: Layout = {
    ...segmentLayout,
    pageSize,
    pages: mappedPages.map((page) => page.page),
  };
  return {
    layout,
    pages: mappedPages,
    endingCheckpoint: buildEndingRangeCheckpoint(
      startingCheckpoint,
      mappedPages[mappedPages.length - 1] ?? null,
      sourceRange,
      pageSize,
      margins,
    ),
    exactness: 'exact',
    diagnostics,
  };
}

function emptyLayoutRangeResult(
  pageSize: PageSize,
  checkpoint: LayoutRangeCheckpoint | null,
  exactness: LayoutRangeExactness,
  diagnostics: readonly string[],
): LayoutRangeResult {
  return {
    layout: { pageSize, pages: [] },
    pages: [],
    endingCheckpoint: checkpoint,
    exactness,
    diagnostics,
  };
}

function implicitInitialCheckpoint(
  pageRange: { startPageIndex: number; endPageIndexExclusive: number },
  sourceRange: LayoutRangeSourceRange,
  options: LayoutOptions | undefined,
): LayoutRangeCheckpoint | null {
  if (pageRange.startPageIndex !== 0 || sourceRange.startOrdinal !== 0) return null;
  return {
    pageIndex: 0,
    sourceOrdinal: 0,
    pageNumber: 1,
    pageTopPx: 0,
    pageSize: options?.pageSize,
    margins: options?.margins,
    activeColumns: options?.columns,
  };
}

function validateRangeBoundary(
  checkpoint: LayoutRangeCheckpoint,
  pageRange: { startPageIndex: number; endPageIndexExclusive: number },
  sourceRange: LayoutRangeSourceRange,
  boundaryPolicy: LayoutRangeBoundaryPolicy,
): { exactness: LayoutRangeExactness; reason: string } | null {
  if (checkpoint.pageIndex > pageRange.startPageIndex) {
    return {
      exactness: 'degraded-unsupported',
      reason: `range-boundary-after-target:${checkpoint.pageIndex}:${pageRange.startPageIndex}`,
    };
  }
  if (checkpoint.sourceOrdinal > sourceRange.startOrdinal) {
    return {
      exactness: 'degraded-unsupported',
      reason: `range-boundary-after-source:${checkpoint.sourceOrdinal}:${sourceRange.startOrdinal}`,
    };
  }
  if (checkpoint.pageIndex < pageRange.startPageIndex && checkpoint.sourceOrdinal < sourceRange.startOrdinal) {
    return {
      exactness: 'degraded-unsupported',
      reason: `range-boundary-missing-preceding-context:${boundaryPolicy}:${checkpoint.sourceOrdinal}:${sourceRange.startOrdinal}`,
    };
  }
  if (checkpoint.sourceOrdinal < sourceRange.startOrdinal) {
    return {
      exactness: 'degraded-unsupported',
      reason: `range-boundary-missing-source-prefix:${boundaryPolicy}:${checkpoint.sourceOrdinal}:${sourceRange.startOrdinal}`,
    };
  }
  return null;
}

function unsupportedRangeBlockReason(block: FlowBlock): string | null {
  switch (block.kind) {
    case 'paragraph':
    case 'pageBreak':
    case 'columnBreak':
    case 'image':
    case 'list':
    case 'sectionBreak':
      return null;
    case 'drawing':
      return `unsupported-range-layout-block:drawing:${block.id}`;
    case 'table':
      return `unsupported-range-layout-block:table:${block.id}`;
    default: {
      const unknownBlock = block as FlowBlock & { kind: string; id?: string };
      return `unsupported-range-layout-block:${unknownBlock.kind}:${unknownBlock.id ?? 'unknown'}`;
    }
  }
}

function remapRangePage(
  page: Page,
  checkpoint: LayoutRangeCheckpoint,
  localPageIndex: number,
  segmentSourceRange: LayoutRangeSourceRange,
  blocks: readonly FlowBlock[],
): LayoutRangePage {
  const pageIndex = checkpoint.pageIndex + localPageIndex;
  const pageNumber = (finiteNumberOrNull(checkpoint.pageNumber) ?? checkpoint.pageIndex + 1) + localPageIndex;
  const mappedPage = clonePlain(page);
  mappedPage.number = pageNumber;
  const displayNumber = finiteNumberOrNull(mappedPage.displayNumber);
  if (displayNumber != null) mappedPage.displayNumber = pageNumber;
  const effectivePageNumber = finiteNumberOrNull(mappedPage.effectivePageNumber);
  if (effectivePageNumber != null) mappedPage.effectivePageNumber = pageNumber;
  if (typeof mappedPage.numberText === 'string') mappedPage.numberText = String(pageNumber);
  return {
    pageIndex,
    page: mappedPage,
    sourceRange: sourceRangeForRangePage(mappedPage, segmentSourceRange, blocks),
  };
}

function sourceRangeForRangePage(
  page: Page,
  segmentSourceRange: LayoutRangeSourceRange,
  blocks: readonly FlowBlock[],
): LayoutRangeSourceRange | null {
  const ordinalByBlockId = new Map<string, number>();
  blocks.forEach((block, index) => {
    ordinalByBlockId.set(block.id, segmentSourceRange.startOrdinal + index);
  });
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const fragment of page.fragments) {
    const ordinal = ordinalByBlockId.get(fragment.blockId);
    if (ordinal == null) continue;
    min = Math.min(min, ordinal);
    max = Math.max(max, ordinal);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { startOrdinal: min, endOrdinalExclusive: max + 1 };
}

function buildEndingRangeCheckpoint(
  checkpoint: LayoutRangeCheckpoint,
  lastPage: LayoutRangePage | null,
  sourceRange: LayoutRangeSourceRange,
  pageSize: PageSize,
  margins: Margins,
): LayoutRangeCheckpoint {
  const nextPageIndex = lastPage ? lastPage.pageIndex + 1 : checkpoint.pageIndex;
  return {
    ...checkpoint,
    pageIndex: nextPageIndex,
    pageNumber: lastPage ? lastPage.page.number + 1 : checkpoint.pageNumber,
    pageTopPx: nextPageIndex * pageSize.h,
    pageSize,
    margins,
    sourceOrdinal: sourceRange.endOrdinalExclusive,
  };
}

function applyRangeOverscan(
  pageRange: { startPageIndex: number; endPageIndexExclusive: number },
  input: LayoutRangeInput,
): { startPageIndex: number; endPageIndexExclusive: number } {
  if (input.boundaryPolicy !== 'overscan') return pageRange;
  return {
    startPageIndex: Math.max(0, pageRange.startPageIndex - nonNegativeIntegerValue(input.overscanBeforePages)),
    endPageIndexExclusive: pageRange.endPageIndexExclusive + nonNegativeIntegerValue(input.overscanAfterPages),
  };
}

function normalizePageRange(pageRange: { startPageIndex: number; endPageIndexExclusive: number }): {
  startPageIndex: number;
  endPageIndexExclusive: number;
} {
  const startPageIndex = nonNegativeIntegerValue(pageRange.startPageIndex);
  const endPageIndexExclusive = nonNegativeIntegerValue(pageRange.endPageIndexExclusive);
  return { startPageIndex, endPageIndexExclusive };
}

function normalizeSourceRange(sourceRange: LayoutRangeSourceRange): LayoutRangeSourceRange {
  const startOrdinal = nonNegativeIntegerValue(sourceRange.startOrdinal);
  const endOrdinalExclusive = Math.max(startOrdinal, nonNegativeIntegerValue(sourceRange.endOrdinalExclusive));
  return { startOrdinal, endOrdinalExclusive };
}

function positiveIntegerOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const next = Math.floor(value);
  return next > 0 ? next : null;
}

function nonNegativeIntegerValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clonePlain<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}

/**
 * Compute the bottom edge (y + height) of a fragment for bounds tracking.
 */
function computeFragmentBottom(fragment: Fragment, block: FlowBlock, measure: Measure): number {
  let bottom = fragment.y;

  if (fragment.kind === 'para' && measure?.kind === 'paragraph') {
    let sum = 0;
    for (let li = fragment.fromLine; li < fragment.toLine; li += 1) {
      sum += measure.lines[li]?.lineHeight ?? 0;
    }
    bottom += sum;
    const spacingAfter = (block as ParagraphBlock)?.attrs?.spacing?.after;
    if (spacingAfter && fragment.toLine === measure.lines.length) {
      bottom += Math.max(0, Number(spacingAfter));
    }
  } else if (fragment.kind === 'image') {
    bottom +=
      typeof fragment.height === 'number' ? fragment.height : ((measure as ImageMeasure | undefined)?.height ?? 0);
  } else if (fragment.kind === 'drawing') {
    bottom +=
      typeof fragment.height === 'number' ? fragment.height : ((measure as DrawingMeasure | undefined)?.height ?? 0);
  } else if (fragment.kind === 'table') {
    // TableFragment carries its own height (a required field) and hasHeight() already
    // classifies tables as height-bearing; without this branch a header/footer story
    // containing a table drops the table height from layout.height, so the region
    // never grows to fit the table and the body is not pushed below it (the table
    // overflows into the body — SD-1581).
    bottom += typeof fragment.height === 'number' ? fragment.height : 0;
  } else if (fragment.kind === 'list-item') {
    const listMeasure = measure as ListMeasure | undefined;
    if (listMeasure) {
      const item = listMeasure.items.find((it) => it.itemId === fragment.itemId);
      if (item?.paragraph) {
        let sum = 0;
        for (let li = fragment.fromLine; li < fragment.toLine; li += 1) {
          sum += item.paragraph.lines[li]?.lineHeight ?? 0;
        }
        bottom += sum;
      }
    }
  }

  return bottom;
}

function maxFlowAffectingFloatingTableBottom(
  page: Page,
  blockById: ReadonlyMap<string, FlowBlock>,
  measureById: ReadonlyMap<string, Measure | undefined>,
): number {
  let maxBottom = 0;
  for (const fragment of page.fragments) {
    if (fragment.kind !== 'table') continue;
    const block = blockById.get(fragment.blockId);
    const measure = measureById.get(fragment.blockId);
    if (block?.kind !== 'table' || measure?.kind !== 'table') continue;
    if (block.anchor?.isAnchored !== true) continue;
    if ((block.wrap?.type ?? 'None') === 'None') continue;
    const bottom = computeFragmentBottom(fragment, block, measure) + (block.wrap?.distBottom ?? 0);
    maxBottom = Math.max(maxBottom, bottom);
  }
  return maxBottom;
}

type VerticalBand = {
  start: number;
  end: number;
};

function rangesIntersect(startA: number, endA: number, startB: number, endB: number): boolean {
  return endA > startB && startA < endB;
}

function getPageRelativeMeasurementBand(
  kind: 'header' | 'footer' | undefined,
  constraints: HeaderFooterConstraints,
): VerticalBand | null {
  if (!kind || !constraints.margins) {
    return null;
  }

  const bandSize = kind === 'header' ? constraints.margins.top : constraints.margins.bottom;
  if (!Number.isFinite(bandSize) || bandSize == null || bandSize <= 0) {
    return null;
  }

  return {
    start: 0,
    end: bandSize,
  };
}

function collectNonFlowPagePositionedParagraphFrameIds(
  blocks: FlowBlock[],
  measures: Measure[],
  kind: 'header' | 'footer' | undefined,
  constraints: HeaderFooterConstraints,
): Set<string> {
  // Keep this footprint calculation aligned with computeFragmentBottom and
  // shouldExcludeFromMeasurement so flow and measurement use the same band test.
  const ids = new Set<string>();
  const measurementBand = getPageRelativeMeasurementBand(kind, constraints);
  const pageHeight = constraints.pageHeight;
  if (!kind || typeof pageHeight !== 'number' || !Number.isFinite(pageHeight)) {
    return ids;
  }

  const regionOrigin = kind === 'footer' ? resolveFooterPageFrameOriginY(pageHeight, constraints.margins?.bottom) : 0;

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const measure = measures[index];
    if (block.kind !== 'paragraph' || measure?.kind !== 'paragraph') continue;

    const frame = block.attrs?.frame;
    if (!isPagePositionedParagraphFrame(frame)) continue;
    if (frame.wrap === 'none') {
      ids.add(block.id);
      continue;
    }
    if (!measurementBand) continue;

    const frameTop = frame.y - regionOrigin;
    const lineHeight = measure.lines.reduce((total, line) => total + (line.lineHeight ?? 0), 0);
    const spacingAfter = Math.max(0, Number(block.attrs?.spacing?.after ?? 0));
    const frameBottom = frameTop + lineHeight + spacingAfter;
    if (!rangesIntersect(frameTop, frameBottom, measurementBand.start, measurementBand.end)) {
      ids.add(block.id);
    }
  }

  return ids;
}

function isHeaderFooterAbsoluteOverlay(
  block: ImageBlock | DrawingBlock,
  kind: 'header' | 'footer' | undefined,
  fragment: Fragment,
  fragmentBottom: number,
  canvasHeight: number,
  constraints: HeaderFooterConstraints,
): boolean {
  if (!kind) return false;
  if (block.anchor?.isAnchored !== true) return false;
  if (block.wrap?.type !== 'None') return false;

  if (fragment.y < 0 || fragmentBottom > canvasHeight) {
    return true;
  }

  const fragmentHeight =
    'height' in fragment && typeof fragment.height === 'number' ? fragment.height : fragmentBottom - fragment.y;
  const fragmentWidth = 'width' in fragment && typeof fragment.width === 'number' ? fragment.width : 0;
  const heightCoversCanvas = Number.isFinite(fragmentHeight) && fragmentHeight >= canvasHeight;
  const widthCoversCanvas =
    Number.isFinite(constraints.width) && constraints.width > 0 && fragmentWidth >= constraints.width;

  return heightCoversCanvas && widthCoversCanvas;
}

/**
 * Determine whether a fragment should be excluded from measurement (pagination) bounds.
 *
 * Excluded fragments:
 * 1. behindDoc anchored fragments — purely decorative z-order, per OOXML spec.
 * 2. Page-relative anchored fragments whose local Y range [y, y+h] does not
 *    intersect [0, canvasHeight] — they are out-of-band and should not inflate
 *    the measurement used by body pagination.
 * 3. Page-relative header/footer overlays that do not intersect the region's
 *    reserved margin band — they should still render, but must not reserve
 *    body space like true header/footer content.
 * 4. Header/footer anchored overlays with wrap=None that either extend
 *    outside the measurement canvas or cover it entirely. `wrap=None` is
 *    OOXML's "absolute overlay, no flow exclusion zone", so by definition
 *    such fragments must not reserve body space.
 */
function shouldExcludeFromMeasurement(
  fragment: Fragment,
  block: FlowBlock,
  fragmentBottom: number,
  canvasHeight: number,
  kind: 'header' | 'footer' | undefined,
  constraints: HeaderFooterConstraints,
): boolean {
  if (
    kind === 'footer' &&
    fragment.kind === 'table' &&
    fragment.isAnchored === true &&
    isPagePositionedFloatingTable(block)
  ) {
    return true;
  }

  const pageAnchoredParagraphFrame =
    fragment.kind === 'para' && block.kind === 'paragraph' && isPagePositionedParagraphFrame(block.attrs?.frame);

  if (pageAnchoredParagraphFrame) {
    if (kind && block.attrs?.frame?.wrap === 'none') return true;

    const measurementBand = getPageRelativeMeasurementBand(kind, constraints);
    return (
      measurementBand != null &&
      !rangesIntersect(fragment.y, fragmentBottom, measurementBand.start, measurementBand.end)
    );
  }

  const isAnchoredFragment =
    (fragment.kind === 'image' || fragment.kind === 'drawing') &&
    (fragment as { isAnchored?: boolean }).isAnchored === true;

  if (!isAnchoredFragment) return false;

  if (block.kind !== 'image' && block.kind !== 'drawing') {
    throw new Error(
      `Type mismatch: fragment kind is ${fragment.kind} but block kind is ${block.kind} for block ${block.id}`,
    );
  }

  const anchoredBlock = block as ImageBlock | DrawingBlock;

  // behindDoc fragments never affect measurement
  if (anchoredBlock.anchor?.behindDoc) return true;

  // Header/footer drawings with wrap=None are absolute overlays. Word keeps
  // the story origin stable when their height changes; the carrier paragraph,
  // not the overlay bounds, owns the decoration's measurement height.
  if (kind && anchoredBlock.wrap?.type === 'None') return true;

  if (isHeaderFooterAbsoluteOverlay(anchoredBlock, kind, fragment, fragmentBottom, canvasHeight, constraints)) {
    return true;
  }

  // Page-relative anchored fragments that sit entirely outside the measurement band
  // should not inflate pagination height.
  if (isPageRelativeAnchor(anchoredBlock)) {
    const fragmentTop = fragment.y;
    // Exclude if the fragment range [top, bottom] does not intersect [0, canvasHeight]
    if (fragmentBottom <= 0 || fragmentTop >= canvasHeight) {
      return true;
    }
  }

  if (anchoredBlock.anchor?.vRelativeFrom === 'page') {
    const measurementBand = getPageRelativeMeasurementBand(kind, constraints);
    if (measurementBand && !rangesIntersect(fragment.y, fragmentBottom, measurementBand.start, measurementBand.end)) {
      return true;
    }
  }

  return false;
}

/**
 * Lays out header or footer content within specified dimensional constraints.
 *
 * Positions blocks within a header/footer region, handling page-relative anchor
 * transformations and computing the actual height required by visible content.
 *
 * When `kind` and `constraints.pageHeight` are provided, page-relative and
 * margin-relative anchored drawings and page-relative floating footer tables
 * are post-normalized from the synthetic measurement canvas to
 * header/footer-local coordinates.
 *
 * Returns separate measurement bounds (for pagination) and render bounds
 * (for overlay shift). See the Coordinate Contract in the fix plan for details.
 */
export function layoutHeaderFooter(
  blocks: FlowBlock[],
  measures: Measure[],
  constraints: HeaderFooterConstraints,
  kind?: 'header' | 'footer',
  remeasureParagraph?: LayoutOptions['remeasureParagraph'],
): HeaderFooterLayout {
  const prepared = prepareHeaderFooterLayout(blocks, measures, constraints, kind, remeasureParagraph);
  if (prepared.empty) return { pages: [], height: 0 };
  let layout: Layout;
  try {
    layout = layoutDocument(blocks, measures, prepared.options);
  } finally {
    Reflect.deleteProperty(prepared.options, V2_RENDER_DIAGNOSTIC_PAGINATION_OWNER);
  }
  return finalizeHeaderFooterLayout(layout, blocks, measures, constraints, prepared.height, kind);
}

export async function layoutHeaderFooterCooperatively(
  blocks: FlowBlock[],
  measures: Measure[],
  constraints: HeaderFooterConstraints,
  kind?: 'header' | 'footer',
  remeasureParagraph?: LayoutOptions['remeasureParagraph'],
  execution?: LayoutExecutionControl,
): Promise<HeaderFooterLayout> {
  const prepared = prepareHeaderFooterLayout(blocks, measures, constraints, kind, remeasureParagraph);
  if (prepared.empty) return { pages: [], height: 0 };
  let layout: Layout;
  try {
    layout = await layoutDocumentCooperatively(blocks, measures, prepared.options, execution);
  } finally {
    Reflect.deleteProperty(prepared.options, V2_RENDER_DIAGNOSTIC_PAGINATION_OWNER);
  }
  await checkpointLayoutExecution(execution, {
    phase: 'header-footer:page',
    index: 0,
    total: layout.pages.length,
  });
  return finalizeHeaderFooterLayout(layout, blocks, measures, constraints, prepared.height, kind);
}

function prepareHeaderFooterLayout(
  blocks: FlowBlock[],
  measures: Measure[],
  constraints: HeaderFooterConstraints,
  kind: 'header' | 'footer' | undefined,
  remeasureParagraph: LayoutOptions['remeasureParagraph'],
): { empty: boolean; height: number; options: LayoutOptions } {
  if (blocks.length !== measures.length) {
    throw new Error(
      `layoutHeaderFooter expected measures for every block (blocks=${blocks.length}, measures=${measures.length})`,
    );
  }
  const width = Number(constraints?.width);
  const height = Number(constraints?.height);
  if (!Number.isFinite(width) || width <= 0) {
    throw new Error('layoutHeaderFooter: width must be positive');
  }
  // If height is zero or negative (e.g., edge-to-edge layouts with no margin space),
  // return an empty layout instead of crashing. This handles documents with zero margins
  // or unusual margin configurations gracefully.
  if (!Number.isFinite(height) || height <= 0) {
    return { empty: true, height: 0, options: {} };
  }

  const nonFlowPositionedParagraphFrameIds = collectNonFlowPagePositionedParagraphFrameIds(
    blocks,
    measures,
    kind,
    constraints,
  );
  const options: LayoutOptions = {
    pageSize: { w: width, h: height },
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    allowParagraphlessAnchoredTableFallback: false,
    allowSectionBreakOnlyPageFallback: false,
    remeasureParagraph,
    nonFlowPositionedParagraphFrameIds,
  };
  const renderDiagnosticOwner = (
    constraints as HeaderFooterConstraints & {
      [V2_RENDER_DIAGNOSTIC_PAGINATION_OWNER]?: V2RenderDiagnosticPaginationOwner;
    }
  )[V2_RENDER_DIAGNOSTIC_PAGINATION_OWNER];
  if (renderDiagnosticOwner) {
    Object.defineProperty(options, V2_RENDER_DIAGNOSTIC_PAGINATION_OWNER, {
      configurable: true,
      enumerable: false,
      value: renderDiagnosticOwner,
    });
  }
  return {
    empty: false,
    height,
    options,
  };
}

function finalizeHeaderFooterLayout(
  layout: Layout,
  blocks: FlowBlock[],
  measures: Measure[],
  constraints: HeaderFooterConstraints,
  height: number,
  kind: 'header' | 'footer' | undefined,
): HeaderFooterLayout {
  // Post-normalize anchored fragment Y positions for header/footer stories.
  //
  // The inner layoutDocument() uses the body content height as its page height,
  // but page/margin-relative anchors need real region geometry to avoid carrying
  // synthetic body-canvas coordinates into header/footer measurement.
  if (kind && constraints.pageHeight != null) {
    normalizeFragmentsForRegion(layout.pages, blocks, measures, kind, constraints);
  }

  const story = kind ? { kind } : undefined;
  if (story) {
    for (const page of layout.pages) {
      page.fragments = page.fragments.map((fragment) => ({
        ...fragment,
        layoutSourceIdentity: buildLayoutSourceIdentityForFragment(fragment, story),
      }));
    }
  }

  // Compute bounds using an index map to avoid building multiple Maps
  const idToIndex = new Map<string, number>();
  for (let i = 0; i < blocks.length; i += 1) {
    idToIndex.set(blocks[i].id, i);
  }

  // Track separate bounds for measurement (pagination) and rendering (overlay shift).
  // Measurement bounds exclude behindDoc and out-of-band page-relative anchored fragments.
  // Render bounds include all visible fragments.
  let measureMinY = 0;
  let measureMaxY = 0;
  let renderMinY = 0;
  let renderMaxY = 0;
  const pageBounds = layout.pages.map(() => ({
    measureMinY: 0,
    measureMaxY: 0,
    renderMinY: 0,
    renderMaxY: 0,
  }));

  for (let pageIndex = 0; pageIndex < layout.pages.length; pageIndex += 1) {
    const page = layout.pages[pageIndex];
    const bounds = pageBounds[pageIndex];
    for (const fragment of page.fragments) {
      const idx = idToIndex.get(fragment.blockId);
      if (idx == null) continue;
      const block = blocks[idx];
      const measure = measures[idx];

      const bottom = computeFragmentBottom(fragment, block, measure);

      // Track render bounds for all fragments (used by overlay shift in SessionManager)
      if (fragment.y < renderMinY) renderMinY = fragment.y;
      if (bottom > renderMaxY) renderMaxY = bottom;
      if (fragment.y < bounds.renderMinY) bounds.renderMinY = fragment.y;
      if (bottom > bounds.renderMaxY) bounds.renderMaxY = bottom;

      // Determine whether this fragment should be excluded from measurement (pagination) bounds
      if (shouldExcludeFromMeasurement(fragment, block, bottom, height, kind, constraints)) continue;

      if (fragment.y < measureMinY) measureMinY = fragment.y;
      if (bottom > measureMaxY) measureMaxY = bottom;
      if (fragment.y < bounds.measureMinY) bounds.measureMinY = fragment.y;
      if (bottom > bounds.measureMaxY) bounds.measureMaxY = bottom;
    }
  }

  return {
    height: measureMaxY - measureMinY,
    minY: renderMinY,
    maxY: renderMaxY,
    renderHeight: renderMaxY - renderMinY,
    pages: layout.pages.map((page, pageIndex) => {
      const bounds = pageBounds[pageIndex];
      return {
        number: page.number,
        fragments: page.fragments,
        measurementHeight: bounds.measureMaxY - bounds.measureMinY,
        minY: bounds.renderMinY,
        maxY: bounds.renderMaxY,
        renderHeight: bounds.renderMaxY - bounds.renderMinY,
      };
    }),
  };
}

// moved layouters and PM helpers to dedicated modules

/**
 * Normalize and validate column layout configuration, computing individual column widths.
 *
 * Takes raw column layout parameters and the available content width, then calculates
 * the actual width each column should have after accounting for gaps. Handles edge cases
 * like invalid column counts, excessive gaps, and degenerate layouts.
 *
 * Algorithm:
 * 1. Validate and normalize column count (floor to integer, ensure >= 1)
 * 2. Validate and normalize gap width (ensure >= 0)
 * 3. Calculate total gap space: gap * (count - 1)
 * 4. Calculate per-column width: (contentWidth - totalGap) / count
 * 5. If resulting width is too small (≤ epsilon), fallback to single-column layout
 *
 * Edge cases handled:
 * - Undefined or missing input: Defaults to single column, no gap
 * - Invalid count (NaN, negative, zero): Defaults to 1
 * - Negative gap: Clamps to 0
 * - Column width too small (gaps consume all space): Falls back to single column
 * - Non-integer count: Floors to nearest integer
 *
 * @param input - The column layout configuration (count and gap) or undefined
 * @param contentWidth - The total available width for content in pixels (must be positive)
 * @returns Normalized column configuration with computed width per column
 * @example
 * // Two columns with 48px gap in 612px content area
 * normalizeColumns({ count: 2, gap: 48 }, 612)
 * // Returns { count: 2, gap: 48, width: 282 }
 *
 * @example
 * // Excessive gap causes fallback to single column
 * normalizeColumns({ count: 3, gap: 500 }, 600)
 * // Returns { count: 1, gap: 0, width: 600 }
 */
function normalizeColumns(input: ColumnLayout | undefined, contentWidth: number): NormalizedColumns {
  return normalizeColumnLayout(input, contentWidth, COLUMN_EPSILON);
}

// Build balanceSectionOnPage's column input from the RESOLVED (normalized) layout. Both balancing
// call sites must source widths/gaps from `normalized` (sliced to the resolved count), never the raw
// config: raw widths can be longer than the count, which makes the equal-width balancing guard read
// surplus entries (vetoing balancing of columns that render equal) and builds phantom geometry
// columns. Single builder so the two call sites cannot drift apart. (SD-2629)
function toBalancingColumns(normalized: NormalizedColumns): SectionColumnLayout {
  return {
    count: normalized.count,
    gap: normalized.gap,
    width: normalized.width,
    ...(Array.isArray(normalized.widths) ? { widths: normalized.widths } : {}),
    ...(Array.isArray(normalized.gaps) ? { gaps: normalized.gaps } : {}),
    ...(normalized.equalWidth !== undefined ? { equalWidth: normalized.equalWidth } : {}),
    // Direction and the content width it was measured against travel with the widths: balancing
    // rebuilds the geometry and overwrites fragment x from it, so dropping them here would lay the
    // balanced page out left-to-right inside an otherwise right-to-left section.
    ...(normalized.direction !== undefined ? { direction: normalized.direction } : {}),
    ...(normalized.contentWidth !== undefined ? { contentWidth: normalized.contentWidth } : {}),
  };
}

const _buildMeasureMap = (blocks: FlowBlock[], measures: Measure[]): Map<string, Measure> => {
  const map = new Map<string, Measure>();
  blocks.forEach((block, index) => {
    const measure = measures[index];
    if (measure) {
      map.set(block.id, measure);
    }
  });
  return map;
};

/**
 * Compute the full bounding box of content across all pages.
 * Returns minY, maxY, and the total height including negative Y offsets.
 * This properly handles anchored images with negative Y positions.
 */
const _computeContentBounds = (
  pages: Page[],
  blocks: FlowBlock[],
  measureMap: Map<string, Measure>,
): { minY: number; maxY: number; height: number } => {
  let minY = 0;
  let maxY = 0;

  // Build a block map for O(1) lookup
  const blockMap = new Map<string, FlowBlock>();
  blocks.forEach((block) => {
    blockMap.set(block.id, block);
  });

  pages.forEach((page) => {
    page.fragments.forEach((fragment) => {
      const block = blockMap.get(fragment.blockId);
      const measure = measureMap.get(fragment.blockId);

      // Track minimum Y (for anchored images with negative offsets)
      if (fragment.y < minY) {
        minY = fragment.y;
      }

      // Compute fragment height and bottom position
      let fragmentBottom = fragment.y;

      if (fragment.kind === 'para') {
        const paraBlock = block as ParagraphBlock | undefined;
        const paraMeasure = measure as ParagraphMeasure | undefined;

        if (paraMeasure) {
          // Add line heights
          const linesHeight = sumLineHeights(paraMeasure, fragment.fromLine, fragment.toLine);
          fragmentBottom += linesHeight;

          // Add paragraph spacing if this is the last fragment of the paragraph
          if (paraBlock?.attrs?.spacing && fragment.toLine === paraMeasure.lines.length) {
            const spacingAfter = Math.max(0, Number(paraBlock.attrs.spacing.after ?? 0));
            fragmentBottom += spacingAfter;
          }
        }
      } else if (fragment.kind === 'image') {
        const imgHeight =
          typeof fragment.height === 'number' ? fragment.height : ((measure as ImageMeasure | undefined)?.height ?? 0);
        fragmentBottom += imgHeight;
      } else if (fragment.kind === 'drawing') {
        const drawingHeight =
          typeof fragment.height === 'number'
            ? fragment.height
            : ((measure as DrawingMeasure | undefined)?.height ?? 0);
        fragmentBottom += drawingHeight;
      } else if (fragment.kind === 'list-item') {
        const listMeasure = measure as ListMeasure | undefined;
        if (listMeasure) {
          const item = listMeasure.items.find((it) => it.itemId === fragment.itemId);
          if (item?.paragraph) {
            fragmentBottom += sumLineHeights(item.paragraph, fragment.fromLine, fragment.toLine);
          }
        }
      }

      if (fragmentBottom > maxY) {
        maxY = fragmentBottom;
      }
    });
  });

  return {
    minY,
    maxY,
    height: maxY - minY,
  };
};

const _computeUsedHeight = (pages: Page[], measureMap: Map<string, Measure>): number => {
  let maxHeight = 0;
  pages.forEach((page) => {
    page.fragments.forEach((fragment) => {
      const height = fragmentHeight(fragment, measureMap);
      const bottom = fragment.y + height;
      if (bottom > maxHeight) {
        maxHeight = bottom;
      }
    });
  });
  return maxHeight;
};

const fragmentHeight = (fragment: Fragment, measureMap: Map<string, Measure>): number => {
  if (fragment.kind === 'para') {
    const measure = measureMap.get(fragment.blockId);
    if (!measure || measure.kind !== 'paragraph') {
      return 0;
    }
    return sumLineHeights(measure, fragment.fromLine, fragment.toLine);
  }
  if (fragment.kind === 'image') {
    if (typeof fragment.height === 'number') {
      return fragment.height;
    }
    const measure = measureMap.get(fragment.blockId);
    if (measure && measure.kind === 'image') {
      return measure.height;
    }
    return 0;
  }
  if (fragment.kind === 'drawing') {
    if (typeof fragment.height === 'number') {
      return fragment.height;
    }
    const measure = measureMap.get(fragment.blockId);
    if (measure && measure.kind === 'drawing') {
      return measure.height;
    }
    return 0;
  }
  return 0;
};

const sumLineHeights = (measure: ParagraphMeasure, fromLine: number, toLine: number): number => {
  let sum = 0;
  for (let index = fromLine; index < toLine; index += 1) {
    sum += measure.lines[index]?.lineHeight ?? 0;
  }
  return sum;
};

// Export page reference resolution utilities
export { buildAnchorMap, resolvePageRefTokens, getTocBlocksForRemeasurement } from './resolvePageRefs.js';

// Export page numbering utilities
export {
  buildChapterContextByPage,
  buildChapterContextByPageCooperatively,
  computeDisplayPageNumber,
  computeDisplayPageNumberCooperatively,
  formatPageNumber,
  formatPageNumberFieldValue,
  formatSectionPageNumberText,
  normalizeChapterMarkerText,
} from './pageNumbering.js';
export type { ChapterPageInfo, DisplayPageInfo, PageNumberFormat } from './pageNumbering.js';

// Export page token resolution utilities
export { resolvePageNumberTokens, resolvePageNumberTokensCooperatively } from './resolvePageTokens.js';
export type { NumberingContext, ResolvePageTokensResult, ResolvePageTokensOptions } from './resolvePageTokens.js';

// Table utilities consumed by layout-bridge and cross-package sync tests
export {
  getCellLines,
  getEmbeddedRowLines,
  resolveTableFrame,
  resolveRenderedTableWidth,
  generateFragmentMetadata,
} from './layout-table.js';
export { describeCellRenderBlocks, computeCellSliceContentHeight } from './table-cell-slice.js';
export {
  readTableLayoutResumeCheckpoints,
  writeTableLayoutResume,
  writeTableLayoutResumeCheckpoints,
} from './table-resume.js';
export type { TableLayoutResumeCheckpoint, TableLayoutResumeInput } from './table-resume.js';
export type { TableLayoutCursor, TableLayoutStep } from './layout-table.js';
export { layoutTextboxContent, resolveTextboxContentMeasures } from './layout-textbox.js';

export { SINGLE_COLUMN_DEFAULT } from './section-breaks.js';
export { checkpointLayoutExecution, throwIfLayoutExecutionAborted } from './execution.js';
export type { LayoutExecutionCheckpoint, LayoutExecutionControl, LayoutExecutionPhase } from './execution.js';
