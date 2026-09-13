/**
 * Column Balancing Module
 *
 * Implements Word-compatible column balancing for section boundaries.
 * Column balancing distributes content evenly across columns at section end,
 * matching Microsoft Word's behavior.
 */

import {
  findColumnContaining,
  getColumnAtX,
  getColumnGeometry,
  getColumnX,
  hasGenuinelyUnequalExplicitColumnWidths,
} from '@superdoc/contracts';
import type { BaseDirection } from '@superdoc/contracts';

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Configuration for column balancing behavior.
 */
export interface ColumnBalancingConfig {
  /** Whether column balancing is enabled */
  enabled: boolean;
  /** Acceptable height difference between columns in pixels */
  tolerance: number;
  /** Maximum iterations to prevent infinite loops */
  maxIterations: number;
  /** Minimum content height per column in pixels */
  minColumnHeight: number;
}

/**
 * Default configuration for column balancing.
 * These values are tuned to match Word's behavior.
 */
export const DEFAULT_BALANCING_CONFIG: ColumnBalancingConfig = {
  enabled: true,
  tolerance: 5, // 5px tolerance for height differences
  maxIterations: 10, // Max 10 iterations to find balance
  minColumnHeight: 20, // Minimum 20px content per column
};

/**
 * Context for a column balancing operation.
 * Contains all information needed to calculate balanced layout.
 */
export interface BalancingContext {
  /** Number of columns to balance across */
  columnCount: number;
  /** Width of each column in pixels */
  columnWidth: number;
  /** Gap between columns in pixels */
  columnGap: number;
  /** Available height from current position to content bottom */
  availableHeight: number;
  /** Content blocks to distribute across columns */
  contentBlocks: BalancingBlock[];
}

/**
 * A content block for balancing calculations.
 * Contains height and constraint information.
 */
export interface BalancingBlock {
  /** Unique identifier for the block */
  blockId: string;
  /** Measured height of the block in pixels */
  measuredHeight: number;
  /** Whether this block can be split across columns */
  canBreak: boolean;
  /** Whether this block must stay with the next block */
  keepWithNext: boolean;
  /** Whether this block must stay together (not split) */
  keepTogether: boolean;
  /** Minimum lines at start of column (orphan control) */
  orphanLines?: number;
  /** Minimum lines at end of column (widow control) */
  widowLines?: number;
  /** Individual line heights for paragraph blocks (for line-level breaking) */
  lineHeights?: number[];
}

/**
 * Result of a column balancing calculation.
 */
export interface BalancingResult {
  /** Target height for each column */
  targetColumnHeight: number;
  /** Map of block ID to assigned column index */
  columnAssignments: Map<string, number>;
  /** Whether balancing converged successfully */
  success: boolean;
  /** Number of iterations used */
  iterations: number;
  /** Optional break points within blocks (for paragraph splitting) */
  blockBreakPoints?: Map<string, BlockBreakPoint>;
}

/**
 * Break point information for splitting a block across columns.
 */
export interface BlockBreakPoint {
  /** Block ID this break point applies to */
  blockId: string;
  /** Line index after which to break (for paragraphs) */
  breakAfterLine: number;
  /** Height of content before the break */
  heightBeforeBreak: number;
  /** Height of content after the break */
  heightAfterBreak: number;
}

/**
 * Internal result from simulating a balanced layout.
 */
interface SimulationResult {
  /** Map of block ID to column index */
  assignments: Map<string, number>;
  /** Height of content in each column */
  columnHeights: number[];
  /** Whether any column overflowed */
  hasOverflow: boolean;
  /** Break points for split blocks */
  breakPoints: Map<string, BlockBreakPoint>;
}

// ============================================================================
// Core Balancing Algorithm
// ============================================================================

/**
 * Calculate optimal column height for balanced layout.
 *
 * Algorithm:
 * 1. Sum total content height
 * 2. Calculate initial target = total / columnCount
 * 3. Simulate layout with target height
 * 4. Adjust if columns overflow/underflow
 * 5. Iterate until balanced or max iterations reached
 *
 * @param ctx - Balancing context with column config and content blocks
 * @param config - Balancing configuration
 * @returns Balancing result with column assignments
 */
export function calculateBalancedColumnHeight(
  ctx: BalancingContext,
  config: ColumnBalancingConfig = DEFAULT_BALANCING_CONFIG,
): BalancingResult {
  // Early exit: single column doesn't need balancing
  if (ctx.columnCount <= 1) {
    return createSingleColumnResult(ctx);
  }

  // Early exit: no content to balance
  if (ctx.contentBlocks.length === 0) {
    return {
      targetColumnHeight: 0,
      columnAssignments: new Map(),
      success: true,
      iterations: 0,
    };
  }

  // Calculate total content height and block-height extremes. A column can
  // never be shorter than its tallest INDIVISIBLE chunk: the full height for
  // an unbreakable block, but only the tallest LINE for a breakable paragraph
  // (SD-3359 — flooring at a breakable paragraph's full height pinned the
  // search above the balanced height and packed the overflow lines into the
  // first column instead of splitting evenly).
  const totalHeight = ctx.contentBlocks.reduce((sum, b) => sum + b.measuredHeight, 0);
  const maxBlockHeight = ctx.contentBlocks.reduce((m, b) => {
    const indivisible =
      b.canBreak && b.lineHeights && b.lineHeights.length > 1 ? Math.max(...b.lineHeights) : b.measuredHeight;
    return Math.max(m, indivisible);
  }, 0);

  // Early exit: content is very small, no need to balance
  if (totalHeight < config.minColumnHeight * ctx.columnCount) {
    return createSingleColumnResult(ctx);
  }

  // Binary-search for the minimum column height H such that a greedy
  // left-to-right fill places every block with every column ≤ H. This matches
  // Word's observed behavior: left columns are filled as tightly as possible
  // against the minimum viable height, leaving the last column shorter when
  // content doesn't divide evenly (e.g. 7 blocks across 3 columns → 3+3+1,
  // not 2+2+3). Both splits have the same max column height, but Word prefers
  // left-heavy packing for visual rhythm.
  let lo = Math.max(maxBlockHeight, config.minColumnHeight);
  let hi = Math.min(totalHeight, ctx.availableHeight);
  if (lo > hi) lo = hi;

  let bestResult: SimulationResult | null = null;
  let bestH = hi;
  let iterations = 0;

  while (lo <= hi) {
    iterations++;
    const mid = Math.floor((lo + hi) / 2);
    const sim = simulateBalancedLayout(ctx, mid, config);
    const maxCol = Math.max(...sim.columnHeights);
    const placed = sim.assignments.size === ctx.contentBlocks.length;
    if (placed && maxCol <= mid) {
      bestResult = sim;
      bestH = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
    if (iterations >= config.maxIterations) break;
  }

  if (bestResult) {
    return {
      targetColumnHeight: bestH,
      columnAssignments: bestResult.assignments,
      success: true,
      iterations,
      blockBreakPoints: bestResult.breakPoints.size > 0 ? bestResult.breakPoints : undefined,
    };
  }

  // Fallback: simple sequential layout if binary search never found a valid H
  // (e.g. availableHeight too small to fit content).
  return createSequentialResult(ctx);
}

/**
 * Simulate layout with given target column height.
 * Does NOT mutate actual layout state.
 */
function simulateBalancedLayout(
  ctx: BalancingContext,
  targetHeight: number,
  config: ColumnBalancingConfig,
): SimulationResult {
  const assignments = new Map<string, number>();
  const breakPoints = new Map<string, BlockBreakPoint>();
  const columnHeights: number[] = new Array(ctx.columnCount).fill(0);

  let currentColumn = 0;

  for (let i = 0; i < ctx.contentBlocks.length; i++) {
    const block = ctx.contentBlocks[i];
    const nextBlock = ctx.contentBlocks[i + 1];

    // Check if block fits in current column
    const wouldExceed = columnHeights[currentColumn] + block.measuredHeight > targetHeight;

    if (wouldExceed && currentColumn < ctx.columnCount - 1) {
      // Check keep-with-next constraint
      if (block.keepWithNext && nextBlock) {
        // This block must stay with next, check if both fit
        const combinedHeight = block.measuredHeight + nextBlock.measuredHeight;
        if (columnHeights[currentColumn] + combinedHeight <= targetHeight) {
          // Both fit, keep in current column
          assignments.set(block.blockId, currentColumn);
          columnHeights[currentColumn] += block.measuredHeight;
          continue;
        }
      }

      // Check if we can break this block (paragraph with multiple lines)
      if (block.canBreak && block.lineHeights && block.lineHeights.length > 1) {
        const breakPoint = calculateParagraphBreakPoint(
          block,
          targetHeight - columnHeights[currentColumn],
          block.orphanLines ?? 1,
          block.widowLines ?? 1,
        );

        if (breakPoint.canBreak && breakPoint.breakAfterLine >= 0) {
          // Split the block
          const heightBefore = block.lineHeights.slice(0, breakPoint.breakAfterLine + 1).reduce((sum, h) => sum + h, 0);
          const heightAfter = block.measuredHeight - heightBefore;

          breakPoints.set(block.blockId, {
            blockId: block.blockId,
            breakAfterLine: breakPoint.breakAfterLine,
            heightBeforeBreak: heightBefore,
            heightAfterBreak: heightAfter,
          });

          // First part stays in current column
          assignments.set(block.blockId, currentColumn);
          columnHeights[currentColumn] += heightBefore;

          // Move to next column for remaining content
          currentColumn++;
          columnHeights[currentColumn] += heightAfter;
          continue;
        }
      }

      // Move to next column
      currentColumn++;
    }

    // Assign block to current column
    assignments.set(block.blockId, currentColumn);
    columnHeights[currentColumn] += block.measuredHeight;
  }

  return {
    assignments,
    columnHeights,
    hasOverflow: columnHeights.some((h) => h > ctx.availableHeight),
    breakPoints,
  };
}

/**
 * Calculate where to break a paragraph for column balancing.
 * Respects orphan/widow constraints.
 */
function calculateParagraphBreakPoint(
  block: BalancingBlock,
  availableHeight: number,
  orphanLines: number,
  widowLines: number,
): { breakAfterLine: number; canBreak: boolean } {
  if (!block.lineHeights || block.lineHeights.length === 0) {
    return { breakAfterLine: -1, canBreak: false };
  }

  const lines = block.lineHeights;
  let heightSoFar = 0;

  for (let i = 0; i < lines.length; i++) {
    heightSoFar += lines[i];

    if (heightSoFar > availableHeight) {
      // Found break point, check constraints
      const linesBeforeBreak = i;
      const linesAfterBreak = lines.length - i;

      // Check orphan constraint (min lines at top of next column)
      if (linesAfterBreak < widowLines) {
        // Not enough lines for next column, try earlier break
        const adjustedBreak = Math.max(0, i - (widowLines - linesAfterBreak));
        if (adjustedBreak < orphanLines) {
          // Can't satisfy both constraints, don't break
          return { breakAfterLine: -1, canBreak: false };
        }
        return { breakAfterLine: adjustedBreak - 1, canBreak: true };
      }

      // Check orphan constraint (min lines in current column)
      if (linesBeforeBreak < orphanLines) {
        // Not enough lines in current column, don't break
        return { breakAfterLine: -1, canBreak: false };
      }

      return { breakAfterLine: i - 1, canBreak: true };
    }
  }

  // All content fits, no break needed
  return { breakAfterLine: lines.length - 1, canBreak: true };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create result for single-column layout (no balancing needed).
 */
function createSingleColumnResult(ctx: BalancingContext): BalancingResult {
  const assignments = new Map<string, number>();
  for (const block of ctx.contentBlocks) {
    assignments.set(block.blockId, 0);
  }
  return {
    targetColumnHeight: ctx.availableHeight,
    columnAssignments: assignments,
    success: true,
    iterations: 0,
  };
}

/**
 * Create result for sequential (non-balanced) layout.
 * Used as fallback when balancing fails.
 */
function createSequentialResult(ctx: BalancingContext): BalancingResult {
  const assignments = new Map<string, number>();
  const columnHeights: number[] = new Array(ctx.columnCount).fill(0);
  let currentColumn = 0;

  for (const block of ctx.contentBlocks) {
    // Fill columns sequentially
    if (
      columnHeights[currentColumn] + block.measuredHeight > ctx.availableHeight &&
      currentColumn < ctx.columnCount - 1
    ) {
      currentColumn++;
    }
    assignments.set(block.blockId, currentColumn);
    columnHeights[currentColumn] += block.measuredHeight;
  }

  return {
    targetColumnHeight: Math.max(...columnHeights),
    columnAssignments: assignments,
    success: false,
    iterations: 0,
  };
}

// ============================================================================
// Utility Exports
// ============================================================================

/**
 * Check if column balancing should be triggered for a section.
 *
 * Balancing is triggered when:
 * 1. Section type is 'continuous' (mid-page section break)
 * 2. Section has explicit balanceColumns flag set to true
 * 3. This is the last section in the document (end of document)
 *
 * @param sectionType - Type of section break
 * @param balanceColumns - Explicit balance flag from section properties
 * @param isLastSection - Whether this is the document's final section
 * @returns Whether column balancing should be performed
 */
export function shouldBalanceColumns(
  sectionType: 'continuous' | 'nextPage' | 'evenPage' | 'oddPage' | undefined,
  balanceColumns: boolean | undefined,
  isLastSection: boolean,
): boolean {
  // Explicit flag takes precedence
  if (balanceColumns === true) return true;
  if (balanceColumns === false) return false;

  // Default behavior: balance for continuous sections and end of document
  return sectionType === 'continuous' || isLastSection;
}

/**
 * Determine if content should skip balancing (optimization).
 *
 * Skip balancing when:
 * 1. Balancing is disabled
 * 2. Single column (nothing to balance across)
 * 3. No content blocks
 * 4. Single unbreakable block that can't be split
 * 5. Total content fits in a single column (no overflow = no need to balance)
 * 6. Total content is less than minimum column height
 *
 * Word only balances columns when content would overflow a single column.
 * If all content fits comfortably in column 0, there's no redistribution.
 *
 * @param ctx - Balancing context
 * @param config - Balancing configuration
 * @returns Whether to skip balancing
 */
export function shouldSkipBalancing(
  ctx: BalancingContext,
  config: ColumnBalancingConfig = DEFAULT_BALANCING_CONFIG,
): boolean {
  // Skip if disabled
  if (!config.enabled) return true;

  // Skip for single column
  if (ctx.columnCount <= 1) return true;

  // Skip if no content
  if (ctx.contentBlocks.length === 0) return true;

  // For single block, only skip if it can't be split across columns
  // A single long paragraph CAN be split, so we should try to balance it
  if (ctx.contentBlocks.length === 1) {
    const block = ctx.contentBlocks[0];
    // Skip if block is unbreakable - can't distribute a single atomic block
    // (whether small or large, it will stay in column 0)
    if (!block.canBreak) {
      return true;
    }
  }

  // Calculate total height
  const totalHeight = ctx.contentBlocks.reduce((sum, b) => sum + b.measuredHeight, 0);

  // Skip if content is smaller than minimum column height
  // (content is too small to meaningfully distribute)
  if (totalHeight < config.minColumnHeight) return true;

  // Skip if balanced height per column would be too small
  // This prevents distributing tiny content across many columns
  const targetHeightPerColumn = totalHeight / ctx.columnCount;
  if (targetHeightPerColumn < config.minColumnHeight) return true;

  return false;
}

// ============================================================================
// Post-Layout Column Balancing
// ============================================================================

/**
 * Fragment with required properties for column balancing.
 * Represents a positioned content block that can be redistributed across columns.
 */
export interface BalancingFragment {
  /** Horizontal position in pixels from left edge of page */
  x: number;
  /** Vertical position in pixels from top edge of page */
  y: number;
  /** Width of the fragment in pixels (updated during balancing to match column width) */
  width: number;
  /** Type of content: 'para', 'image', 'drawing', 'table', etc. */
  kind: string;
  /** Unique identifier linking fragment to its source block */
  blockId: string;
  /** Starting line index for partial paragraph fragments */
  fromLine?: number;
  /** Ending line index (exclusive) for partial paragraph fragments */
  toLine?: number;
  /**
   * Remeasured lines carried by the fragment itself (set when a paragraph measured at one
   * width is placed in a narrower column or beside a float). When present, the resolve
   * stage renders THIS array and ignores fromLine/toLine into measure.lines - so balancing
   * must source heights from it and slice it when splitting a fragment across columns.
   */
  lines?: Array<{ lineHeight: number }>;
  /** Pre-computed height for non-paragraph fragments */
  height?: number;
}

/**
 * Measure data used to calculate fragment heights.
 * Contains layout measurements from the measuring phase.
 */
export interface MeasureData {
  /** Type of measure: 'paragraph', 'image', etc. */
  kind: string;
  /** Line measurements for paragraph content */
  lines?: Array<{ lineHeight: number }>;
  /** Total height for non-paragraph content (image, drawing) */
  height?: number;
  /** Total height for table content (TableMeasure stores this rather than `height`). */
  totalHeight?: number;
}

/**
 * Internal structure tracking fragment info during balancing.
 */
interface FragmentInfo {
  /** Reference to the original fragment (mutated during balancing) */
  fragment: BalancingFragment;
  /** Computed height of this fragment */
  height: number;
  /** Original array index for debugging */
  originalIndex: number;
}

/**
 * Calculates the height of a fragment using measure data.
 *
 * For paragraph fragments, sums line heights from the measure data.
 * For images, drawings, and tables, uses the pre-computed height.
 *
 * @param fragment - The fragment to calculate height for
 * @param measureMap - Map of block IDs to their measure data
 * @returns Height in pixels, or 0 if height cannot be determined
 */
function getFragmentHeight(fragment: BalancingFragment, measureMap: Map<string, MeasureData>): number {
  if (fragment.kind === 'para') {
    // A fragment remeasured for a narrower column carries its own lines; the resolve
    // stage renders (and sizes) from THAT array, so balancing must agree with it.
    if (fragment.lines && fragment.lines.length > 0) {
      return fragment.lines.reduce((sum, l) => sum + (l.lineHeight ?? 0), 0);
    }
    const measure = measureMap.get(fragment.blockId);
    if (!measure || measure.kind !== 'paragraph' || !measure.lines) {
      return 0;
    }
    // Sum line heights for the fragment's line range
    let sum = 0;
    const fromLine = fragment.fromLine ?? 0;
    const toLine = fragment.toLine ?? measure.lines.length;
    for (let i = fromLine; i < toLine; i++) {
      sum += measure.lines[i]?.lineHeight ?? 0;
    }
    return sum;
  }

  // For non-paragraph content, prefer the layout-engine-assigned fragment.height,
  // then fall back to the measure's height field. TableMeasure stores totalHeight
  // (not `height`), so consult that as the final fallback for table fragments —
  // otherwise a fragment with height=0 (e.g. a layout that allocated zero height
  // for a header-less table) silently disappears from balancing math and the
  // balancer over-packs other blocks into column 0.
  if (fragment.kind === 'image' || fragment.kind === 'drawing' || fragment.kind === 'table') {
    if (typeof fragment.height === 'number' && fragment.height > 0) {
      return fragment.height;
    }
    const measure = measureMap.get(fragment.blockId);
    if (measure) {
      if (typeof measure.height === 'number' && measure.height > 0) {
        return measure.height;
      }
      if (fragment.kind === 'table' && typeof measure.totalHeight === 'number') {
        return measure.totalHeight;
      }
    }
    if (typeof fragment.height === 'number') {
      return fragment.height;
    }
  }

  return 0;
}

/**
 * Return the fragment height that the column balancer should use.
 *
 * Differs from `getFragmentHeight` for one case: an empty sectPr-marker
 * paragraph. In OOXML a paragraph that exists solely to carry `<w:sectPr>`
 * is invisible to Word's renderer, so it must take no vertical space in the
 * balanced layout (ECMA-376 §17.18.77). The pm-adapter stamps these
 * paragraphs with `attrs.sectPrMarker === true` (paragraph.ts), and the
 * caller threads the resulting block-id set through here.
 *
 * Earlier versions of this function tried to detect markers from line
 * geometry (`line.width === 0`), but a regular blank paragraph also
 * measures with width 0 and DOES occupy line height — collapsing those to
 * 0 caused the next paragraph to overlap the blank line. The metadata-based
 * gate is the only safe signal.
 */
function getBalancingHeight(
  fragment: BalancingFragment,
  measureMap: Map<string, MeasureData>,
  sectPrMarkerBlockIds?: Set<string>,
): number {
  if (fragment.kind === 'para' && sectPrMarkerBlockIds && sectPrMarkerBlockIds.has(fragment.blockId)) {
    return 0;
  }
  return getFragmentHeight(fragment, measureMap);
}

// ============================================================================
// Section-scoped balancing
// ============================================================================

/**
 * Column layout properties relevant to balancing decisions.
 * Mirrors the subset of ColumnLayout that this module reads.
 */
export interface SectionColumnLayout {
  count: number;
  gap: number;
  width?: number;
  widths?: number[];
  /**
   * Per-column gaps (px), length count-1; explicit mode only. Drives geometry so equal-width
   * sections with non-uniform gaps (e.g. F9) balance with correct column positions. (SD-2629)
   */
  gaps?: number[];
  equalWidth?: boolean;
  /**
   * Section page direction (`w:sectPr/w:bidi`) and the content width it was normalized against.
   *
   * Declared here — and not left to the structural subset above — because balancing REBUILDS the
   * geometry and then overwrites every fragment's `x` from it. A balanced page that dropped these
   * would be laid out left-to-right while every earlier page of the same RTL section was laid out
   * right-to-left, so the last page of a two-column Hebrew section would visibly flip.
   */
  direction?: BaseDirection;
  contentWidth?: number;
}

export interface BalanceSectionOnPageArgs {
  /** All fragments on the target page. Only those belonging to sectionIndex are balanced (mutated in place). */
  fragments: BalancingFragment[];
  /** Section whose content ends on this page. */
  sectionIndex: number;
  /** Column layout of the ending section. */
  sectionColumns: SectionColumnLayout;
  /** True if the section contains an explicit <w:br w:type="column"/> — skip balancing to preserve author intent. */
  sectionHasExplicitColumnBreak: boolean;
  /** blockId -> sectionIndex map (built once per layout, shared across calls). */
  blockSectionMap: Map<string, number>;
  /** Left page margin, used to compute column X positions. */
  margins: { left: number };
  /** Y position where the section's region begins on this page. */
  topMargin: number;
  /** Column width — passed to balancePageColumns so it can resize fragments. */
  columnWidth: number;
  /** Available height from topMargin to content bottom. */
  availableHeight: number;
  /** Measurement data for fragments (built from measures array). */
  measureMap: Map<string, MeasureData>;
  /**
   * Block IDs of paragraphs that exist only to carry `<w:sectPr>` properties.
   * These contribute zero height to balanced columns — see `getBalancingHeight`.
   * Optional; when omitted no fragment is treated as a marker.
   */
  sectPrMarkerBlockIds?: Set<string>;
  /**
   * Block IDs of paragraphs with `w:keepLines` — the author asked Word not to
   * split these, so they stay atomic during balancing. Optional; when omitted
   * every multi-line paragraph is splittable. (SD-3359)
   */
  keepLinesBlockIds?: Set<string>;
}

const COLUMN_EDGE_EPSILON = 0.01;

function fragmentColumnIndex(
  fragment: BalancingFragment,
  geometry: ReturnType<typeof getColumnGeometry>,
  originX: number,
): number {
  const recorded = (fragment as BalancingFragment & { columnIndex?: number }).columnIndex;
  if (typeof recorded === 'number' && Number.isInteger(recorded) && recorded >= 0 && recorded < geometry.length) {
    return recorded;
  }

  const x = fragment.x - originX;
  const width = Number.isFinite(fragment.width) && fragment.width > 0 ? fragment.width : 0;

  for (const column of geometry) {
    if (Math.abs(x - column.x) <= COLUMN_EDGE_EPSILON) return column.index;
  }
  for (const column of geometry) {
    if (Math.abs(x + width - (column.x + column.width)) <= COLUMN_EDGE_EPSILON) return column.index;
  }

  const containing = findColumnContaining(geometry, x);
  if (containing !== null) {
    const column = geometry.find((candidate) => candidate.index === containing);
    if (column && width <= column.width + COLUMN_EDGE_EPSILON) return containing;
  }

  let bestIndex: number | null = null;
  let bestOverlap = 0;
  for (const column of geometry) {
    const overlap = Math.min(x + width, column.x + column.width) - Math.max(x, column.x);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestIndex = column.index;
    }
  }
  return bestIndex ?? getColumnAtX(geometry, fragment.x, originX);
}

function setRecordedColumnIndex(fragment: BalancingFragment, columnIndex: number): void {
  if ('columnIndex' in fragment) {
    (fragment as BalancingFragment & { columnIndex: number }).columnIndex = columnIndex;
  }
}

/**
 * Balance the fragments of one section on one page.
 *
 * Returns the tallest balanced column's bottom Y, or null if balancing was skipped.
 * Callers can use the returned Y to update paginator cursors so subsequent content
 * starts just below the balanced section rather than below an unbalanced maxCursorY.
 *
 * Guards (skip balancing when):
 *   - Section has <= 1 column (nothing to balance)
 *   - Section contains an explicit column break (author intent wins)
 *   - Section uses GENUINELY-unequal column widths (Word fills these column-by-column;
 *     explicit widths that are all equal still balance — SD-2324)
 *   - No fragments on this page belong to the section
 */
export function balanceSectionOnPage(args: BalanceSectionOnPageArgs): { maxY: number } | null {
  const { sectionColumns, sectionHasExplicitColumnBreak, sectionIndex, blockSectionMap, fragments } = args;

  if (sectionColumns.count <= 1) return null;
  if (sectionHasExplicitColumnBreak) return null;
  // Genuinely-unequal explicit widths: Word fills these column-by-column rather than
  // rebalancing, and the height-balancer measures each fragment at a single width so it
  // can't reflow per column. Explicit widths that are all EQUAL (equalWidth="0" with every
  // <w:col w:w> equal — the common continuous newspaper case) DO balance like implicit
  // equal columns. (SD-2324) The predicate is shared with host retained-layout
  // dependency scanning (SD-3772); both sides must consume the same definition.
  if (hasGenuinelyUnequalExplicitColumnWidths(sectionColumns)) {
    return null;
  }

  // Filter to fragments of the target section on this page.
  const sectionFragments = fragments.filter((f) => blockSectionMap.get(f.blockId) === sectionIndex);
  if (sectionFragments.length === 0) return null;

  const columnCount = sectionColumns.count;
  const columnGap = sectionColumns.gap;
  const columnWidth = sectionColumns.width ?? 0;
  if (columnWidth <= 0) return null;

  // Use the minimum Y of the section's fragments as the balancing origin — the
  // section may start mid-page (e.g. section 0 is single-column and section 1
  // continues below it). Using topMargin unconditionally would stack balanced
  // columns on top of earlier single-column content on the same page.
  let sectionTopY = Number.POSITIVE_INFINITY;
  for (const f of sectionFragments) {
    if (f.y < sectionTopY) sectionTopY = f.y;
  }
  if (!Number.isFinite(sectionTopY)) sectionTopY = args.topMargin;

  // Remaining height from the section's actual top to the page content bottom.
  const remainingHeight = args.availableHeight - (sectionTopY - args.topMargin);
  if (remainingHeight <= 0) return null;

  // Pre-split a dominant table fragment at a row boundary before balancing.
  //
  // When a section's final page contains a single splittable table that's
  // taller than (totalSectionHeight / columnCount), the atomic-block balancer
  // can only place the whole table in one column — leaving the other column
  // empty. Word's behavior per ECMA-376 §17.18.77 is to balance the
  // REMAINING content, which for a narrow table means splitting at a row
  // boundary so both columns carry roughly half the rows.
  //
  // We split ONCE per balance call (we only need two halves for a 2-col
  // section; extending to N > 2 would iterate). SD-2646: IT-945 page 2 has a
  // 515px / 28-row table; splitting into ~257px halves lets the balancer
  // assign half to each column.
  //
  // The split takes the cumulative height of fragments preceding the table
  // (in document order) so the per-column target accounts for content
  // already destined for column 0. Without this, a 100px paragraph + 300px
  // table in 2 cols hits target=200, splits the table at row=200 → 100+200
  // / 100; subtracting the leading 100 gives target=150 → 100+100 / 200.
  //
  // The split returns a rollback closure. We invoke it if the post-split
  // shouldSkipBalancing check still rejects, so the page never carries a
  // mutated half table when balancing was ultimately skipped.
  let precedingHeightBeforeTable = 0;
  for (const f of sectionFragments) {
    if (f.kind === 'table') break;
    precedingHeightBeforeTable += getBalancingHeight(f, args.measureMap, args.sectPrMarkerBlockIds);
  }
  const splitResult = splitDominantTableAtRowBoundary({
    sectionFragments,
    fragments,
    columnCount,
    measureMap: args.measureMap,
    sectPrMarkerBlockIds: args.sectPrMarkerBlockIds,
    precedingHeight: precedingHeightBeforeTable,
  });

  const balancedGeometry = getColumnGeometry({
    count: columnCount,
    gap: columnGap,
    width: columnWidth,
    ...(Array.isArray(sectionColumns.widths) ? { widths: sectionColumns.widths } : {}),
    ...(Array.isArray(sectionColumns.gaps) ? { gaps: sectionColumns.gaps } : {}),
    ...(sectionColumns.direction !== undefined ? { direction: sectionColumns.direction } : {}),
    ...(sectionColumns.contentWidth !== undefined ? { contentWidth: sectionColumns.contentWidth } : {}),
  });

  // Reconstruct document order from the owning column, then the vertical position inside it. Raw x
  // is not a column key: indents, positioned frames, and over-wide tables can move a fragment's
  // origin without moving the fragment to another column.
  const ordered = [...sectionFragments].sort((a, b) => {
    const columnDifference =
      fragmentColumnIndex(a, balancedGeometry, args.margins.left) -
      fragmentColumnIndex(b, balancedGeometry, args.margins.left);
    if (columnDifference !== 0) return columnDifference;
    return a.y - b.y;
  });

  // Treat each fragment as its own block for binary-search balancing. Grouping
  // by y (as balancePageColumns does) would collapse fragments from different
  // source columns that happen to share a y coordinate into a single row and
  // re-stack them at one position — producing overlap.
  //
  // Use `getBalancingHeight` so empty sectPr-marker paragraphs contribute 0
  // to their column's cursor — matching Word's behavior of not rendering a
  // blank line for such markers.
  //
  // SD-3359: multi-line paragraphs additionally expose their per-line heights so
  // the balancer can SPLIT a paragraph that straddles the column boundary (Word
  // flows content line-by-line when balancing a continuous section, ECMA-376
  // §17.18.77 — atomic assignment leaves the columns lumpy whenever one
  // paragraph is large relative to the section). sectPr markers, `w:keepLines`
  // paragraphs, non-paragraph fragments, and single-line paragraphs stay atomic.
  const lineHeightsFor = (f: BalancingFragment): number[] | undefined => {
    if (f.kind !== 'para') return undefined;
    if (args.sectPrMarkerBlockIds?.has(f.blockId)) return undefined;
    if (args.keepLinesBlockIds?.has(f.blockId)) return undefined;
    // A remeasured fragment renders its own `lines` (resolveParagraph ignores
    // fromLine/toLine then), so break points must be computed against that array.
    if (f.lines && f.lines.length > 0) {
      if (f.lines.length <= 1) return undefined;
      return f.lines.map((l) => l.lineHeight);
    }
    const measure = args.measureMap.get(f.blockId);
    if (!measure || measure.kind !== 'paragraph' || !Array.isArray(measure.lines)) return undefined;
    const fromLine = f.fromLine ?? 0;
    const toLine = f.toLine ?? measure.lines.length;
    if (toLine - fromLine <= 1) return undefined;
    return measure.lines.slice(fromLine, toLine).map((l) => l.lineHeight);
  };

  const contentBlocks: BalancingBlock[] = ordered.map((f, i) => {
    const lineHeights = lineHeightsFor(f);
    return {
      blockId: `${f.blockId}#${i}`,
      measuredHeight: getBalancingHeight(f, args.measureMap, args.sectPrMarkerBlockIds),
      canBreak: lineHeights !== undefined,
      keepWithNext: false,
      keepTogether: lineHeights === undefined,
      lineHeights,
    };
  });

  if (
    shouldSkipBalancing({
      columnCount,
      columnWidth,
      columnGap,
      availableHeight: remainingHeight,
      contentBlocks,
    })
  ) {
    splitResult?.rollback();
    return null;
  }

  const result = calculateBalancedColumnHeight(
    { columnCount, columnWidth, columnGap, availableHeight: remainingHeight, contentBlocks },
    DEFAULT_BALANCING_CONFIG,
  );

  // Per-column x from the resolved geometry, not a uniform stride. SD-2629's core case is equal
  // widths with NON-uniform gaps (e.g. F9), which the equal-width guard above still admits, so
  // columnIndex * (width + gap) would mis-place later columns. Equal gaps reduce to the old stride.
  const columnX = (columnIndex: number): number => getColumnX(balancedGeometry, columnIndex, args.margins.left);

  const colCursors = new Array<number>(columnCount).fill(sectionTopY);
  let maxY = sectionTopY;
  for (let i = 0; i < ordered.length; i++) {
    const f = ordered[i];
    const block = contentBlocks[i];
    const col = result.columnAssignments.get(block.blockId) ?? 0;
    setRecordedColumnIndex(f, col);
    f.x = columnX(col);
    f.y = colCursors[col];
    f.width = columnWidth;
    // SD-3359: apply a line-boundary split chosen by the balancer. The first
    // half keeps the leading lines in this column; a cloned second half carries
    // the remaining lines to the top of the next column — the same
    // fromLine/toLine + continuation-flag surgery pagination uses when a
    // paragraph splits across pages. The simulation assigns the block to the
    // column of its FIRST half and flows the remainder into the next column,
    // so the cursors advance by the split heights it computed.
    const bp = result.blockBreakPoints?.get(block.blockId);
    if (bp && bp.heightAfterBreak > 0 && col < columnCount - 1) {
      const fromLine = f.fromLine ?? 0;
      const splitLine = fromLine + bp.breakAfterLine + 1;
      const measureLineCount = args.measureMap.get(f.blockId)?.lines?.length ?? splitLine;
      const originalToLine = f.toLine ?? measureLineCount;
      const originalContinuesOnNext = (f as { continuesOnNext?: boolean }).continuesOnNext ?? false;
      const secondHalf = {
        ...f,
        fromLine: splitLine,
        toLine: originalToLine,
        x: columnX(col + 1),
        y: colCursors[col + 1],
        width: columnWidth,
        continuesFromPrev: true,
        continuesOnNext: originalContinuesOnNext,
      } as BalancingFragment;
      setRecordedColumnIndex(secondHalf, col + 1);
      // Remeasured fragments render their own `lines` wholesale (fromLine/toLine are
      // ignored by the resolve stage then), so the halves must each carry ONLY their
      // slice or both columns render the entire paragraph.
      if (f.lines && f.lines.length > 0) {
        secondHalf.lines = f.lines.slice(bp.breakAfterLine + 1);
        f.lines = f.lines.slice(0, bp.breakAfterLine + 1);
      }
      f.toLine = splitLine;
      (f as { continuesOnNext?: boolean }).continuesOnNext = true;
      colCursors[col] += bp.heightBeforeBreak;
      colCursors[col + 1] += bp.heightAfterBreak;
      // Insert right after the first half so document order is preserved for
      // any later consumer that walks the page fragments.
      const fragIdx = fragments.indexOf(f);
      if (fragIdx >= 0) fragments.splice(fragIdx + 1, 0, secondHalf);
      if (colCursors[col] > maxY) maxY = colCursors[col];
      if (colCursors[col + 1] > maxY) maxY = colCursors[col + 1];
      continue;
    }
    colCursors[col] += block.measuredHeight;
    if (colCursors[col] > maxY) maxY = colCursors[col];
  }
  return { maxY };
}

/**
 * Table measure shape used by the row-split preprocessor.
 *
 * Only the row-heights array is required. We access it through the runtime
 * `measureMap` stored as `MeasureData`, which narrows the interface for the
 * public balancer API — but the stored value is the full `TableMeasure`
 * containing `rows: [{ height }]`, so a cast is safe.
 */
interface TableMeasureLike {
  kind: string;
  rows?: Array<{ height: number }>;
}

/**
 * Row-boundary record matching the contract `TableRowBoundary` shape.
 *
 * The DOM renderer serializes these into the compact `{i,y,h,min,r}` keys
 * for `data-table-boundaries`; storing them in the contract shape here
 * keeps the layout-engine/contract boundary intact and prevents `undefined`
 * row-boundary values from reaching the renderer when a table is split.
 */
interface RowBoundaryLike {
  index: number;
  y: number;
  height: number;
  minHeight: number;
  resizable: boolean;
}

/**
 * In-place split of a dominant table fragment at a row boundary.
 *
 * Problem this solves: the column balancer treats each fragment as an atomic
 * block. A multi-page two-column continuous section's final page can end up
 * with a single table fragment that exceeds half the section's height. The
 * balancer then places the whole table in one column and leaves the other
 * empty — diverging from Word, which balances by splitting the table at a
 * row boundary (ECMA-376 §17.18.77: continuous breaks balance the previous
 * section's content).
 *
 * This preprocessor runs once per `balanceSectionOnPage` call. It detects a
 * single dominant table fragment and splits it at the row whose cumulative
 * height first meets or exceeds totalSectionHeight / columnCount. The two
 * halves are inserted into both `sectionFragments` and the page's
 * `fragments` array in place of the original; the rest of the balancer then
 * runs on N + 1 similarly-sized blocks and naturally assigns one to each
 * column.
 *
 * Guards:
 *   - Only one splittable table fragment on the section's page (skip if 0 or >1).
 *   - Table must span at least 2 rows (can't split a 1-row fragment).
 *   - Total height must exceed target (= total / columnCount) by more than a
 *     small epsilon; otherwise the atomic balancer already fits.
 *
 * Splitting is NOT appropriate when the author placed explicit column breaks
 * or used unequal columns — those cases are already filtered by the caller.
 *
 * @param args Section fragments (already filtered to this section), the
 *             full page fragments (mutated in place), column count, and the
 *             measure map.
 */
/**
 * Result of attempting a dominant-table split. When `applied` is true the
 * caller is responsible for invoking `rollback()` if downstream balancing
 * decides to skip — otherwise the page is left with overlapping table halves
 * (the original table mutated to a partial range plus the inserted second
 * half). Returns `null` when the split preconditions (single splittable
 * table, rowSpan ≥ 2, oversized vs target) aren't met, in which case nothing
 * was mutated and there is nothing to roll back.
 */
type DominantTableSplitResult = {
  applied: true;
  rollback: () => void;
} | null;

function splitDominantTableAtRowBoundary(args: {
  sectionFragments: BalancingFragment[];
  fragments: BalancingFragment[];
  columnCount: number;
  measureMap: Map<string, MeasureData>;
  sectPrMarkerBlockIds?: Set<string>;
  /**
   * Cumulative height of fragments already placed in earlier columns, BEFORE
   * the dominant table. Subtracted from the per-column target so the split
   * row produces halves that pack alongside preceding atomic blocks (e.g.
   * a 100px paragraph + 300px table in 2 cols should split the table at
   * row=100 → 100+100 vs 100+200, not row=200 → 100+200 vs 100). Defaults
   * to 0 when caller doesn't track this.
   */
  precedingHeight?: number;
}): DominantTableSplitResult {
  const { sectionFragments, fragments, columnCount, measureMap, sectPrMarkerBlockIds } = args;
  const precedingHeight = Math.max(0, args.precedingHeight ?? 0);
  if (columnCount <= 1) return null;

  const tables = sectionFragments.filter((f) => f.kind === 'table');
  if (tables.length !== 1) return null;
  const table = tables[0] as BalancingFragment & {
    fromRow?: number;
    toRow?: number;
    height?: number;
    continuesFromPrev?: boolean;
    continuesOnNext?: boolean;
    metadata?: { rowBoundaries?: RowBoundaryLike[]; columnBoundaries?: unknown; coordinateSystem?: string };
  };
  const fromRow = table.fromRow ?? 0;
  const toRow = table.toRow ?? fromRow;
  const rowSpan = toRow - fromRow;
  if (rowSpan < 2) return null;

  const measure = measureMap.get(table.blockId) as TableMeasureLike | undefined;
  if (!measure || measure.kind !== 'table' || !Array.isArray(measure.rows)) return null;

  const totalSectionHeight = sectionFragments.reduce(
    (sum, f) => sum + getBalancingHeight(f, measureMap, sectPrMarkerBlockIds),
    0,
  );
  if (totalSectionHeight <= 0) return null;
  // Per-column target. Subtract the height already placed in earlier columns
  // before this table so the split row produces halves that pack alongside
  // those preceding atomic blocks. Without this adjustment, e.g. a 100px
  // paragraph + 300px table in 2 cols hits target=200, splits the table
  // at row=200 → cols 100+200 vs 100, max=300; subtracting precedingHeight
  // gives target=150 → splits at row=100 → cols 100+100 vs 200, max=200.
  // Floor at 1 so the pathological "preceding height already exceeds
  // target" case still yields a forward-progressing split row search.
  const target = Math.max(1, totalSectionHeight / columnCount - precedingHeight);

  const tableHeight = getBalancingHeight(table, measureMap, sectPrMarkerBlockIds);
  // Small-epsilon guard: if the table alone fits within the target, the
  // atomic balancer already produces a correct assignment — splitting would
  // only introduce visual churn.
  if (tableHeight <= target + 1) return null;

  // Find the row K in [fromRow + 1, toRow) such that cumulative height from
  // fromRow to K first reaches the target. Guaranteed to succeed because
  // tableHeight > target and rowSpan ≥ 2.
  let running = 0;
  let splitRow = fromRow + 1;
  for (let r = fromRow; r < toRow - 1; r++) {
    const h = measure.rows[r]?.height ?? 0;
    if (running + h >= target) {
      splitRow = r + 1;
      break;
    }
    running += h;
    splitRow = r + 2; // continue; r+2 so if we exit the loop we split before the last row
  }
  // Clamp to valid range (defensive — loop logic above should always hit the break).
  if (splitRow <= fromRow || splitRow >= toRow) return null;

  const firstHalfRows = measure.rows.slice(fromRow, splitRow);
  const secondHalfRows = measure.rows.slice(splitRow, toRow);
  const firstHalfHeight = firstHalfRows.reduce((s, r) => s + (r.height ?? 0), 0);
  const secondHalfHeight = secondHalfRows.reduce((s, r) => s + (r.height ?? 0), 0);

  // Regenerate rowBoundaries so the renderer draws horizontal dividers at the
  // right y-offsets inside each half. rowBoundaries are 0-origin within the
  // fragment; we walk the measure's rows for each half and accumulate.
  // Use the contract `TableRowBoundary` shape ({index, y, height, minHeight,
  // resizable}). The DOM renderer compresses these into {i,y,h,min,r} for the
  // serialized data-table-boundaries attribute; emitting the compact shape
  // here would produce undefined values after the renderer's projection and
  // break interactive row resize handles for split fragments.
  const makeRowBoundaries = (rows: Array<{ height: number }>, startIndex: number): RowBoundaryLike[] => {
    const out: RowBoundaryLike[] = [];
    let y = 0.5;
    for (let i = 0; i < rows.length; i++) {
      const h = rows[i].height ?? 0;
      out.push({ index: startIndex + i, y, height: h, minHeight: h, resizable: true });
      y += h;
    }
    return out;
  };

  const originalMetadata = table.metadata;
  const firstMetadata = originalMetadata
    ? {
        ...originalMetadata,
        rowBoundaries: makeRowBoundaries(firstHalfRows, 0),
      }
    : undefined;
  const secondMetadata = originalMetadata
    ? {
        ...originalMetadata,
        rowBoundaries: makeRowBoundaries(secondHalfRows, 0),
      }
    : undefined;

  // Capture original mutable fields BEFORE applying the split. Required for:
  //   (a) Rollback: if the caller decides to skip balancing post-split, we
  //       restore the table fragment to its pre-split state.
  //   (b) Correctly inheriting `continuesOnNext` on the second half. Reading
  //       `table.continuesOnNext` AFTER setting `table.continuesOnNext = true`
  //       always yielded `true`, so the prior `? false : (… ?? false)`
  //       ternary collapsed to `false` and the second half could never inherit
  //       the original cross-page continuation. Capturing first preserves the
  //       original intent: if the source table continued onto a later page,
  //       the SECOND half is the one that now carries that continuation.
  const originalToRow = table.toRow;
  const originalHeight = table.height;
  const originalContinuesOnNext = table.continuesOnNext ?? false;

  // Construct the first half by mutating the original (preserves object
  // identity so `fragments.indexOf(table)` still works below).
  table.toRow = splitRow;
  table.height = firstHalfHeight;
  table.continuesOnNext = true;
  if (firstMetadata) table.metadata = firstMetadata;

  const secondHalf: BalancingFragment = {
    ...table,
    fromRow: splitRow,
    toRow,
    height: secondHalfHeight,
    continuesFromPrev: true,
    continuesOnNext: originalContinuesOnNext,
    metadata: secondMetadata ?? table.metadata,
  } as BalancingFragment;

  // Insert the second half right after the first in both arrays so the
  // balancer's (x, y) ordering keeps them adjacent in document order.
  const fragIdx = fragments.indexOf(table);
  if (fragIdx >= 0) fragments.splice(fragIdx + 1, 0, secondHalf);
  const sectIdx = sectionFragments.indexOf(table);
  if (sectIdx >= 0) sectionFragments.splice(sectIdx + 1, 0, secondHalf);

  return {
    applied: true,
    rollback: () => {
      table.toRow = originalToRow;
      table.height = originalHeight;
      table.continuesOnNext = originalContinuesOnNext;
      table.metadata = originalMetadata;
      const fIdx = fragments.indexOf(secondHalf);
      if (fIdx >= 0) fragments.splice(fIdx, 1);
      const sIdx = sectionFragments.indexOf(secondHalf);
      if (sIdx >= 0) sectionFragments.splice(sIdx, 1);
    },
  };
}
