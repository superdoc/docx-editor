import type {
  FlowBlock,
  Layout,
  Measure,
  Fragment,
  DrawingFragment,
  ImageFragment,
  Run,
  Line,
  TableFragment,
  TableBlock,
  TableMeasure,
  ParagraphBlock,
  ParagraphMeasure,
} from '@superdoc/contracts';
import {
  adjustAvailableWidthForTextIndent,
  computeLinePmRange as computeLinePmRangeUnified,
  effectiveTableCellSpacing,
  getFirstLineIndentOffset,
} from '@superdoc/contracts';
import { describeCellRenderBlocks, computeCellSliceContentHeight, getEmbeddedRowLines } from '@superdoc/layout-engine';
import { findCharacterAtX, measureCharacterX } from './text-measurement.js';
import { clickToPositionDom, findPageElement } from './dom-mapping.js';
import {
  isListItem,
  getWordLayoutConfig,
  calculateTextStartIndent,
  extractParagraphIndent,
} from './list-indent-utils.js';

export type { HeaderFooterType } from '@superdoc/contracts';
export {
  selectHeaderFooterVariantForPage,
  resolveEffectiveHeaderFooterRef,
  type HeaderFooterKind,
  type HeaderFooterVariant,
  type HeaderFooterSectionRefs,
  type HeaderFooterResolutionSection,
  type HeaderFooterVariantSelectionInput,
  type HeaderFooterEffectiveRefInput,
  type HeaderFooterEffectiveRefResult,
} from '@superdoc/contracts';
export {
  extractIdentifierFromConverter,
  getHeaderFooterType,
  defaultHeaderFooterIdentifier,
  resolveHeaderFooterForPage,
  // Multi-section header/footer support
  buildMultiSectionIdentifier,
  defaultMultiSectionIdentifier,
  getHeaderFooterTypeForSection,
  getHeaderFooterIdForPage,
  resolveHeaderFooterForPageAndSection,
} from './headerFooterUtils';
export type {
  HeaderFooterIdentifier,
  MultiSectionHeaderFooterIdentifier,
  SectionHeaderFooterIds,
} from './headerFooterUtils';
export {
  layoutHeaderFooterWithCache,
  createRetainedHeaderFooterPageReader,
  invalidateHeaderFooterMeasureCache,
  type HeaderFooterBatchResult,
  getBucketForPageNumber,
  getBucketRepresentative,
} from './layoutHeaderFooter';
export type { HeaderFooterBatch, DigitBucket } from './layoutHeaderFooter';
export {
  resolveHeaderFooterTokens,
  cloneHeaderFooterBlocks,
  PROVISIONAL_PAGE_COUNT_PLACEHOLDER,
  type ResolveHeaderFooterTokensOptions,
} from './resolveHeaderFooterTokens';
export {
  buildPageStyleReferenceResolver,
  flowBlocksContainCrossReferenceMetadata,
  type PageStyleReferenceResolver,
} from './resolveLiveCrossReferences';
export { findWordBoundaries, findParagraphBoundaries } from './text-boundaries';
export type { BoundaryRange } from './text-boundaries';
export {
  buildSectionAwareHeaderFooterLayoutKey,
  buildSectionContentWidth,
  buildEffectiveHeaderFooterRefsBySection,
  collectReferencedHeaderFooterRIds,
  buildSectionAwareHeaderFooterMeasurementGroups,
} from './sectionAwareHeaderFooter';
export type {
  HeaderFooterSectionKind,
  HeaderFooterRefs,
  SectionAwareHeaderFooterMeasurementGroup,
} from './sectionAwareHeaderFooter';
export { clearIncrementalModuleState, incrementalLayout, measureCache, normalizeMargin } from './incrementalLayout';
export { hashMeasureContent } from './cache';
export type {
  HeaderFooterLayoutResult,
  HeaderFooterGeometrySeed,
  IncrementalLayoutBridgeTiming,
  IncrementalLayoutResult,
  IncrementalLayoutExecutionControl,
  IncrementalLayoutContinuation,
  IncrementalMeasureReuseProof,
  IncrementalLayoutReuseOptions,
  IncrementalLayoutReuseSummary,
  IncrementalSectionPageNumberTransform,
  IncrementalLayoutTailAdoption,
  IncrementalLayoutTailDisposition,
  IncrementalPaginationProof,
  LayoutPositionTransform,
  FootnoteReserveSeed,
} from './incrementalLayout';
export {
  collectFootnoteLedgers,
  getPreferredReserveCandidates,
  getPreferredReserveTrialTargets,
  isMandatoryOnlyFootnotePage,
  scoreFootnoteWindow,
  summarizeFootnoteWindow,
} from './footnote-scorer';
export type {
  FootnotePreferredReserveCandidate,
  FootnoteWindowScoreInput,
  FootnoteWindowScoreReason,
  FootnoteWindowScoreResult,
  FootnoteWindowStats,
} from './footnote-scorer';
// Re-export computeDisplayPageNumber from layout-engine for section-aware page numbering
export { computeDisplayPageNumber } from '@superdoc/layout-engine';
export type { DisplayPageInfo, HeaderFooterConstraints } from '@superdoc/layout-engine';
export { clearRemeasureTextCaches, remeasureParagraph } from './remeasure';
export { findCharacterAtX, measureCharacterX } from './text-measurement';
export { sliceRunsForLine } from '@superdoc/contracts';
export { clickToPositionDom, findPageElement } from './dom-mapping';
export { isListItem, getWordLayoutConfig, calculateTextStartIndent, extractParagraphIndent } from './list-indent-utils';
export type { TextIndentCalculationParams } from './list-indent-utils';
export { LayoutVersionLogger } from './instrumentation';
export type { LayoutMetrics } from './instrumentation';
export { hitTestTextboxFragment, resolveTextboxContentHit } from './position-hit.js';
export type { TextboxHitResult } from './position-hit.js';

// Font Metrics Cache
export { FontMetricsCache } from './font-metrics-cache';
export type { FontMetrics, FontMetricsCacheConfig } from './font-metrics-cache';

// Paragraph Line Cache
export { ParagraphLineCache } from './paragraph-line-cache';
export type { LineInfo, ParagraphLines } from './paragraph-line-cache';

// Cursor Renderer
export { CursorRenderer } from './cursor-renderer';
export type { CursorRendererOptions, CursorRect } from './cursor-renderer';

// Local Paragraph Layout
export { LocalParagraphLayout } from './local-paragraph-layout';
export type { LocalLayoutResult, TextRun } from './local-paragraph-layout';

// PM DOM Fallback
export { PmDomFallback } from './pm-dom-fallback';
export type { PageTransform, PmEditorView } from './pm-dom-fallback';

// Page Geometry Helper
export { PageGeometryHelper } from './page-geometry-helper';
export type { PageGeometryConfig } from './page-geometry-helper';

// Dirty Tracker
export { DirtyTracker } from './dirty-tracker';
export type { DirtyRange } from './dirty-tracker';

// Debounced Pass Manager
export { DebouncedPassManager } from './debounced-passes';
export type { DebouncedPass } from './debounced-passes';

// PM Position Validator
export { PmPositionValidator } from './pm-position-validator';
export type { ValidationResult, ValidationError } from './pm-position-validator';

// IME Handler
export { ImeHandler } from './ime-handler';
export type { ImeState } from './ime-handler';

// Table Handler
export { TableHandler } from './table-handler';
export type { TableLayoutState } from './table-handler';

// Track Changes Handler
export { TrackChangesHandler } from './track-changes-handler';
export type { TrackChangeSpan } from './track-changes-handler';

// Cache Warmer
export { CacheWarmer } from './cache-warmer';
export type { WarmingConfig, ParagraphWarmInfo } from './cache-warmer';

// Performance Metrics
export { PerformanceMetricsCollector, perfMetrics } from './performance-metrics';
export type { MetricSample, MetricSummary, TypingPerfMetrics, BudgetViolation } from './performance-metrics';

// Safety Net
export { SafetyNet } from './safety-net';
export type { FallbackReason, SafetyConfig } from './safety-net';

// Focus Watchdog
export { FocusWatchdog } from './focus-watchdog';
export type { FocusWatchdogConfig } from './focus-watchdog';

// Paragraph Hash Utilities
export {
  hashParagraphBorder,
  hashParagraphBorders,
  hashParagraphAttrs,
  hashBorderSpec,
  hashTableBorderValue,
  hashTableBorders,
  hashCellBorders,
  hasStringProp,
  hasNumberProp,
  hasBooleanProp,
  getRunStringProp,
  getRunNumberProp,
  getRunBooleanProp,
} from './paragraph-hash-utils';

// Editor-neutral hit-test substrate (prep-001).
//
// Additive only — `pmStart`/`pmEnd` and the existing `clickToPosition` /
// `selectionToRects` entry points remain available for v1 callers. The
// neutral entry points project the same producer state onto an
// editor-neutral shape so future surfaces can address rendered output
// without consulting ProseMirror positions.
export type {
  LayoutHit,
  LayoutHitDiagnostic,
  LayoutFragmentOpaqueRange,
  LayoutFragmentSubrange,
  LayoutRangeMapping,
  LayoutRect,
  PmOpaqueRange,
} from './neutral-hit.js';
export { hitTestNeutral, mapRangeToFragmentsNeutral } from './neutral-hit.js';

// Editor-neutral measured segment-geometry readback (Phase 1 / 001).
//
// Promotes the per-line / per-segment geometry the measure + layout pipeline
// already computes to a first-class neutral output a host can use to resolve
// caret x/baseline/height and selection rects without DOM ratio math. Additive
// only — the v1 selection/caret entry points remain unchanged.
export { collectSegmentGeometry } from './neutral-segment-geometry.js';
export type { CollectSegmentGeometryOptions } from './neutral-segment-geometry.js';

// Pure RTL text-geometry substrate (direction-aware visual<->logical mapping).
export {
  lineHasComplexBidiContent,
  logicalAdvanceToContainerX,
  containerXToLogicalAdvance,
} from './rtl-text-geometry.js';

// Position-hit types and helpers (re-exported from position-hit.ts)
export type {
  Point,
  PageHit,
  FragmentHit,
  PositionHit,
  TableHitResult,
  GeometryPageHint,
  ClickToPositionGeometryOptions,
} from './position-hit.js';
export {
  isAtomicFragment,
  getAtomicPmRange,
  isRtlBlock,
  determineColumn,
  findLineIndexAtY,
  mapPointToPm,
  snapToNearestFragment,
  hitTestPage,
  hitTestFragment,
  hitTestAtomicFragment,
  hitTestTableFragment,
  findBlockIndexByFragmentId,
  calculatePageTopFallback,
  resolvePositionHitFromDomPosition,
  clickToPositionGeometry,
} from './position-hit.js';
import {
  type Point,
  type PageHit,
  type FragmentHit,
  type PositionHit,
  isAtomicFragment,
  getAtomicPmRange,
  isRtlBlock,
  determineColumn,
  findLineIndexAtY,
  mapPointToPm,
  snapToNearestFragment,
  hitTestPage,
  hitTestFragment,
  hitTestAtomicFragment,
  hitTestTableFragment,
  findBlockIndexByFragmentId,
  calculatePageTopFallback,
  resolvePositionHitFromDomPosition,
  clickToPositionGeometry,
} from './position-hit.js';

export type Rect = { x: number; y: number; width: number; height: number; pageIndex: number };

type AtomicFragment = DrawingFragment | ImageFragment;

const logClickStage = (_level: 'log' | 'warn' | 'error', _stage: string, _payload: Record<string, unknown>) => {
  // No-op in production. Enable for debugging click-to-position mapping.
};

const SELECTION_DEBUG_ENABLED = false;
const logSelectionDebug = (payload: Record<string, unknown>): void => {
  if (!SELECTION_DEBUG_ENABLED) return;
  try {
    console.log('[SELECTION-DEBUG]', JSON.stringify(payload));
  } catch {
    console.log('[SELECTION-DEBUG]', payload);
  }
};

/**
 * Debug flag for DOM and geometry position mapping.
 * Set to true to enable detailed logging of click-to-position operations.
 * WARNING: Should be false in production to avoid performance degradation.
 */
const DEBUG_POSITION_MAPPING = false;

/**
 * Logs position mapping debug information when DEBUG_POSITION_MAPPING is enabled.
 * @param payload - Debug data to log
 */
const logPositionDebug = (payload: Record<string, unknown>): void => {
  if (!DEBUG_POSITION_MAPPING) return;
  try {
    console.log('[CLICK-POS]', JSON.stringify(payload));
  } catch {
    console.log('[CLICK-POS]', payload);
  }
};

/**
 * Logs selection mapping debug information when DEBUG_POSITION_MAPPING is enabled.
 * @param payload - Debug data to log
 */
const logSelectionMapDebug = (payload: Record<string, unknown>): void => {
  if (!DEBUG_POSITION_MAPPING) return;
  try {
    console.log('[SELECTION-MAP]', JSON.stringify(payload));
  } catch {
    console.log('[SELECTION-MAP]', payload);
  }
};

/**
 * Extracts text content from a specific line within a paragraph block.
 *
 * This function concatenates text from all runs that contribute to the specified line,
 * handling partial runs at line boundaries and filtering out non-text runs (images, breaks).
 *
 * @param block - The flow block to extract text from (must be a paragraph block)
 * @param line - The line specification including run range (fromRun to toRun) and character offsets
 * @returns The complete text content of the line, or empty string if block is not a paragraph
 *
 * @example
 * ```typescript
 * // Line spanning runs [0, 1] with partial text from first and last run
 * const text = buildLineText(paragraphBlock, line);
 * // Returns: "Hello world" (combining partial run text)
 * ```
 */
const buildLineText = (block: FlowBlock, line: Line): string => {
  if (block.kind !== 'paragraph') return '';
  let text = '';
  for (let runIndex = line.fromRun; runIndex <= line.toRun; runIndex += 1) {
    const run = block.runs[runIndex];
    if (
      !run ||
      'src' in run ||
      run.kind === 'lineBreak' ||
      run.kind === 'break' ||
      run.kind === 'fieldAnnotation' ||
      run.kind === 'math'
    )
      continue;
    const runText = run.text ?? '';
    const isFirstRun = runIndex === line.fromRun;
    const isLastRun = runIndex === line.toRun;
    const start = isFirstRun ? line.fromChar : 0;
    const end = isLastRun ? line.toChar : runText.length;
    text += runText.slice(start, end);
  }
  return text;
};

const rangesOverlap = (startA: number | undefined, endA: number | undefined, startB: number, endB: number): boolean => {
  if (startA == null) return false;
  const effectiveEndA = endA ?? startA + 1;
  return effectiveEndA > startB && startA < endB;
};

// hitTestPage, hitTestFragment, hitTestAtomicFragment, hitTestTableFragment
// are now in position-hit.ts and re-exported above.

/**
 * Map a coordinate click to a ProseMirror position.
 *
 * This function supports two mapping strategies:
 * 1. **DOM-based mapping** (preferred): Uses actual DOM elements with data attributes
 *    for pixel-perfect accuracy. Handles PM position gaps correctly.
 * 2. **Geometry-based mapping** (fallback): Uses layout geometry and text measurement
 *    when DOM is unavailable or mapping fails.
 *
 * To enable DOM mapping, provide the `domContainer` parameter and `clientX`/`clientY`
 * coordinates. The function will attempt DOM mapping first, falling back to geometry
 * if needed.
 *
 * **Algorithm (Geometry-based):**
 * 1. Hit-test to find the page containing the click point
 * 2. Transform container coordinates to page-relative coordinates
 * 3. Hit-test to find the fragment (paragraph, table, drawing) at the point
 * 4. For paragraphs: find line at Y, then character at X using Canvas-based text measurement
 * 5. For tables: find cell, then paragraph within cell, then character position
 * 6. For drawings/images: return the fragment's PM position range
 * 7. If no direct hit, snap to nearest fragment on the page
 *
 * **Performance:**
 * - DOM mapping: O(1) DOM query via elementFromPoint
 * - Geometry mapping: O(n) where n = number of fragments on the clicked page
 * - With geometryHelper: Page lookups are O(1) cached
 *
 * @param layout - The layout data containing pages and fragments
 * @param blocks - Array of flow blocks from the document
 * @param measures - Array of text measurements for the blocks
 * @param containerPoint - Click point in layout container space (x, y from top-left of layout container).
 *   Used for geometry-based mapping when DOM mapping is unavailable.
 * @param domContainer - Optional DOM container element. When provided with clientX/clientY, enables
 *   DOM-based mapping which is more accurate and handles PM position gaps correctly.
 * @param clientX - Optional client X coordinate (viewport space). Required for DOM mapping.
 * @param clientY - Optional client Y coordinate (viewport space). Required for DOM mapping.
 * @param geometryHelper - Optional PageGeometryHelper for cached page position lookups. Strongly
 *   recommended for performance and consistency. When provided, ensures page positions match
 *   exactly with selection rendering and cursor positioning. Without it, falls back to inline
 *   calculation which may have subtle differences from other geometry operations.
 * @returns Position hit with PM position and metadata (blockId, pageIndex, column, lineIndex),
 *   or null if mapping fails (click outside all content, invalid coordinates, etc.).
 *
 * @example
 * ```typescript
 * // DOM-based mapping (preferred)
 * const hit = clickToPosition(
 *   layout, blocks, measures,
 *   { x: containerX, y: containerY },
 *   domElement,
 *   event.clientX,
 *   event.clientY,
 *   geometryHelper
 * );
 *
 * // Geometry-based mapping (fallback)
 * const hit = clickToPosition(
 *   layout, blocks, measures,
 *   { x: containerX, y: containerY },
 *   undefined, undefined, undefined,
 *   geometryHelper
 * );
 *
 * if (hit) {
 *   view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, hit.pos)));
 * }
 * ```
 */
const readLayoutEpochFromDom = (domContainer: HTMLElement, clientX: number, clientY: number): number | null => {
  const doc = domContainer.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
  if (!doc || typeof doc.elementsFromPoint !== 'function') {
    return null;
  }

  let hitChain: Element[] = [];
  try {
    hitChain = doc.elementsFromPoint(clientX, clientY) ?? [];
  } catch {
    return null;
  }

  let latestEpoch: number | null = null;
  for (const el of hitChain) {
    if (!(el instanceof HTMLElement)) continue;
    if (!domContainer.contains(el)) continue;
    const raw = el.dataset.layoutEpoch;
    if (raw == null) continue;
    const epoch = Number(raw);
    if (!Number.isFinite(epoch)) continue;
    // Pick the newest epoch in the hit chain to avoid stale descendants blocking mapping.
    if (latestEpoch == null || epoch > latestEpoch) {
      latestEpoch = epoch;
    }
  }

  return latestEpoch;
};

/**
 * Compatibility wrapper — delegates to resolvePositionHitFromDomPosition and
 * clickToPositionGeometry from position-hit.ts.
 *
 * Production editor-runtime callers should use resolvePointerPositionHit from
 * their pointer resolver instead. This wrapper exists so that external
 * consumers and tests that import clickToPosition from @superdoc/layout-bridge
 * continue to work unchanged.
 */
export function clickToPosition(
  layout: Layout,
  blocks: FlowBlock[],
  measures: Measure[],
  containerPoint: Point,
  domContainer?: HTMLElement,
  clientX?: number,
  clientY?: number,
  geometryHelper?: import('./page-geometry-helper').PageGeometryHelper,
): PositionHit | null {
  const layoutEpoch = layout.layoutEpoch ?? 0;

  // Try DOM-based mapping first if container and coordinates provided
  if (domContainer != null && clientX != null && clientY != null) {
    const domPos = clickToPositionDom(domContainer, clientX, clientY);
    const domLayoutEpoch = readLayoutEpochFromDom(domContainer, clientX, clientY) ?? layoutEpoch;

    if (domPos != null) {
      return resolvePositionHitFromDomPosition(layout, blocks, measures, domPos, domLayoutEpoch);
    }

    // DOM mapping failed — compute page hint from DOM for geometry fallback
    const pageEl = findPageElement(domContainer, clientX, clientY);
    if (pageEl) {
      const domPageIndex = Number(pageEl.dataset.pageIndex ?? 'NaN');
      if (Number.isFinite(domPageIndex) && domPageIndex >= 0 && domPageIndex < layout.pages.length) {
        const page = layout.pages[domPageIndex];
        const pageRect = pageEl.getBoundingClientRect();
        const layoutPageHeight = page.size?.h ?? layout.pageSize.h;
        const domPageHeight = pageRect.height;
        const effectiveZoom = domPageHeight > 0 && layoutPageHeight > 0 ? domPageHeight / layoutPageHeight : 1;
        const domPageRelativeY = (clientY - pageRect.top) / effectiveZoom;
        return clickToPositionGeometry(layout, blocks, measures, containerPoint, {
          geometryHelper,
          pageHint: { pageIndex: domPageIndex, pageRelativeY: domPageRelativeY },
        });
      }
    }
  }

  // Pure geometry path
  return clickToPositionGeometry(layout, blocks, measures, containerPoint, { geometryHelper });
}

// findBlockIndexByFragmentId is now in position-hit.ts and re-exported above.

type TableRowBlock = TableBlock['rows'][number];
type TableCellBlock = TableRowBlock['cells'][number];
type TableCellMeasure = TableMeasure['rows'][number]['cells'][number];

const DEFAULT_CELL_PADDING = { top: 0, bottom: 0, left: 4, right: 4 };

const getCellPaddingFromRow = (cellIdx: number, row?: TableRowBlock) => {
  const padding = row?.cells?.[cellIdx]?.attrs?.padding ?? {};
  return {
    top: padding.top ?? DEFAULT_CELL_PADDING.top,
    bottom: padding.bottom ?? DEFAULT_CELL_PADDING.bottom,
    left: padding.left ?? DEFAULT_CELL_PADDING.left,
    right: padding.right ?? DEFAULT_CELL_PADDING.right,
  };
};

const getCellBlocks = (cell: TableCellBlock | undefined) => {
  if (!cell) return [];
  return cell.blocks ?? (cell.paragraph ? [cell.paragraph] : []);
};

const getCellMeasures = (cell: TableCellMeasure | undefined) => {
  if (!cell) return [];
  return cell.blocks ?? (cell.paragraph ? [cell.paragraph] : []);
};

/**
 * Count the number of segments a measured block contributes to getCellLines().
 * Used to advance the global line counter past non-paragraph blocks so that
 * paragraph line ranges stay aligned with the full global index space.
 */
const countBlockSegments = (measure: {
  kind: string;
  rows?: { cells: unknown[] }[];
  height?: number;
  lines?: unknown[];
}): number => {
  if (measure.kind === 'paragraph') {
    return (measure as ParagraphMeasure).lines?.length ?? 0;
  }
  if (measure.kind === 'table') {
    let count = 0;
    for (const row of (measure as TableMeasure).rows) {
      count += getEmbeddedRowLines(row).length;
    }
    return count;
  }
  // Image, drawing, other: 1 segment if height > 0
  const h = typeof measure.height === 'number' ? measure.height : 0;
  return h > 0 ? 1 : 0;
};

const sumLineHeights = (measure: ParagraphMeasure, fromLine: number, toLine: number) => {
  let height = 0;
  for (let i = fromLine; i < toLine && i < measure.lines.length; i += 1) {
    height += measure.lines[i]?.lineHeight ?? 0;
  }
  return height;
};

// calculatePageTopFallback is now in position-hit.ts and re-exported above.

/**
 * SD-3328: an empty paragraph / blank line that the selection passes through is a
 * zero-width slice (`pmStart === pmEnd`). `findLinesIntersectingRange` only yields
 * such a line when `from < pos < to`, so it is genuinely spanned and must be
 * highlighted. Emit a content-width band so the selection highlight stays
 * continuous across the blank line — the same as selecting any text. Without this
 * the band shows a gap and the highlight appears to "disappear" while a drag
 * crosses a blank line (reported in body paragraphs and inside table cells).
 */
function pushEmptyLineSelectionBand(
  rects: Rect[],
  opts: {
    x: number;
    yBase: number;
    width: number;
    lineHeight: number;
    pageIndex: number;
    measure: ParagraphMeasure;
    lineIndex: number;
    startLineIndex: number;
  },
): void {
  const lineOffset = sumLineHeights(opts.measure, opts.startLineIndex, opts.lineIndex);
  rects.push({
    x: opts.x,
    y: opts.yBase + lineOffset,
    width: Math.max(1, opts.width),
    height: opts.lineHeight,
    pageIndex: opts.pageIndex,
  });
}

/**
 * Given a PM range [from, to), return selection rectangles for highlighting.
 *
 * @param layout - The layout containing page and fragment data
 * @param blocks - Array of flow blocks
 * @param measures - Array of measurements corresponding to blocks
 * @param from - Start PM position
 * @param to - End PM position
 * @param geometryHelper - Optional PageGeometryHelper for accurate Y calculations (recommended)
 * @returns Array of selection rectangles in container space
 */
export function selectionToRects(
  layout: Layout,
  blocks: FlowBlock[],
  measures: Measure[],
  from: number,
  to: number,
  geometryHelper?: import('./page-geometry-helper').PageGeometryHelper,
): Rect[] {
  if (from === to) {
    return [];
  }

  const rects: Rect[] = [];
  const debugEntries: Record<string, unknown>[] = [];

  layout.pages.forEach((page: Layout['pages'][number], pageIndex: number) => {
    // Calculate cumulative Y offset for this page
    const pageTopY = geometryHelper
      ? geometryHelper.getPageTop(pageIndex)
      : calculatePageTopFallback(layout, pageIndex);
    page.fragments.forEach((fragment: Fragment) => {
      if (fragment.kind === 'para') {
        const blockIndex = findBlockIndexByFragmentId(blocks, fragment.blockId, { from, to });
        if (blockIndex === -1) {
          return;
        }
        const block = blocks[blockIndex];
        const measure = measures[blockIndex];
        if (!block || block.kind !== 'paragraph' || measure?.kind !== 'paragraph') {
          return;
        }

        const intersectingLines = findLinesIntersectingRange(block, measure, from, to);
        intersectingLines.forEach(({ line, index }) => {
          if (index < fragment.fromLine || index >= fragment.toLine) {
            return;
          }
          const range = computeLinePmRange(block, line);
          if (range.pmStart == null || range.pmEnd == null) return;
          const sliceFrom = Math.max(range.pmStart, from);
          const sliceTo = Math.min(range.pmEnd, to);
          if (sliceFrom >= sliceTo) {
            // SD-3328: blank line spanned by the selection — see pushEmptyLineSelectionBand.
            pushEmptyLineSelectionBand(rects, {
              x: fragment.x,
              yBase: fragment.y + pageTopY,
              width: fragment.width,
              lineHeight: line.lineHeight,
              pageIndex,
              measure,
              lineIndex: index,
              startLineIndex: fragment.fromLine,
            });
            return;
          }

          // Convert PM positions to character offsets properly
          // (accounts for gaps in PM positions between runs)
          const charOffsetFrom = pmPosToCharOffset(block, line, sliceFrom);
          const charOffsetTo = pmPosToCharOffset(block, line, sliceTo);
          const visualCharOffsetFrom = pmPosToVisualCharOffset(block, line, sliceFrom);
          const visualCharOffsetTo = pmPosToVisualCharOffset(block, line, sliceTo);
          // Detect list items by checking for marker presence
          const markerWidth = fragment.markerWidth ?? measure.marker?.markerWidth ?? 0;
          const isListItemFlag = isListItem(markerWidth, block);
          // List items use textAlign: 'left' in the DOM for non-justify alignments.
          // For justify, we don't override so justify selection rectangles are calculated correctly.
          const blockAlignment = block.attrs?.alignment;
          const isJustified = blockAlignment === 'justify';
          const alignmentOverride = isListItemFlag && !isJustified ? 'left' : undefined;
          const isFirstLine = index === fragment.fromLine && !fragment.continuesFromPrev;
          const fragmentMarkerTextWidth = fragment.markerTextWidth ?? measure.marker?.markerTextWidth ?? undefined;
          const startX = mapPmToX(
            block,
            line,
            visualCharOffsetFrom,
            fragment.width,
            alignmentOverride,
            isFirstLine,
            fragmentMarkerTextWidth,
          );
          const endX = mapPmToX(
            block,
            line,
            visualCharOffsetTo,
            fragment.width,
            alignmentOverride,
            isFirstLine,
            fragmentMarkerTextWidth,
          );

          // Calculate text indent using shared utility
          const indent = extractParagraphIndent(block.attrs?.indent);
          const wordLayout = getWordLayoutConfig(block);
          const indentAdjust = calculateTextStartIndent({
            isFirstLine,
            isListItem: isListItemFlag,
            markerWidth,
            markerTextWidth: fragmentMarkerTextWidth,
            paraIndentLeft: indent.left,
            firstLineIndent: indent.firstLine,
            hangingIndent: indent.hanging,
            wordLayout,
          });

          const rectX = fragment.x + indentAdjust + Math.min(startX, endX);
          const rectWidth = Math.max(
            1,
            Math.min(Math.abs(endX - startX), line.width), // clamp to line width to prevent runaway widths
          );
          const lineOffset = lineHeightBeforeIndex(measure, index) - lineHeightBeforeIndex(measure, fragment.fromLine);
          const rectY = fragment.y + lineOffset;
          rects.push({
            x: rectX,
            y: rectY + pageTopY,
            width: rectWidth,
            height: line.lineHeight,
            pageIndex,
          });

          if (SELECTION_DEBUG_ENABLED) {
            const runs = block.runs.slice(line.fromRun, line.toRun + 1).map((run: Run, idx: number) => {
              const isAtomic =
                'src' in run ||
                run.kind === 'lineBreak' ||
                run.kind === 'break' ||
                run.kind === 'fieldAnnotation' ||
                run.kind === 'math';
              const text = isAtomic ? '' : (run.text ?? '');
              return {
                idx: line.fromRun + idx,
                kind: run.kind ?? 'text',
                pmStart: run.pmStart,
                pmEnd: run.pmEnd,
                textLength: text.length,
                textPreview: text.slice(0, 30),
                fontFamily: (run as { fontFamily?: string }).fontFamily,
                fontSize: (run as { fontSize?: number }).fontSize,
              };
            });

            debugEntries.push({
              pageIndex,
              blockId: block.id,
              lineIndex: index,
              lineFromRun: line.fromRun,
              lineToRun: line.toRun,
              lineFromChar: line.fromChar,
              lineToChar: line.toChar,
              lineWidth: line.width,
              fragment: {
                x: fragment.x,
                y: fragment.y,
                width: fragment.width,
                fromLine: fragment.fromLine,
                toLine: fragment.toLine,
              },
              pmRange: range,
              sliceFrom,
              sliceTo,
              charOffsetFrom,
              charOffsetTo,
              visualCharOffsetFrom,
              visualCharOffsetTo,
              startX,
              endX,
              rect: { x: rectX, y: rectY, width: rectWidth, height: line.lineHeight },
              runs,
              lineText: buildLineText(block, line),
              selectedText: buildLineText(block, line).slice(
                Math.min(charOffsetFrom, charOffsetTo),
                Math.max(charOffsetFrom, charOffsetTo),
              ),
              indent: (block.attrs as { indent?: unknown } | undefined)?.indent,
              alignment: (block.attrs as { alignment?: unknown } | undefined)?.alignment,
              marker: measure.marker,
              markerWidth,
              isListItemFlag,
              alignmentOverride,
              lineSegments: line.segments,
              lineSpaceCount: (line as { spaceCount?: unknown }).spaceCount,
              lineNaturalWidth: (line as { naturalWidth?: unknown }).naturalWidth,
              lineMaxWidth: (line as { maxWidth?: unknown }).maxWidth,
            });
          }
        });
        return;
      }

      if (fragment.kind === 'table') {
        const blockIndex = findBlockIndexByFragmentId(blocks, fragment.blockId, { from, to });
        if (blockIndex === -1) return;

        const block = blocks[blockIndex];
        const measure = measures[blockIndex];
        if (!block || block.kind !== 'table' || measure?.kind !== 'table') {
          return;
        }

        const tableBlock = block as TableBlock;
        const tableMeasure = measure as TableMeasure;
        const tableFragment = fragment as TableFragment;

        const rowHeights = tableMeasure.rows.map((rowMeasure: TableMeasure['rows'][number], idx: number) => {
          if (tableFragment.partialRow && tableFragment.partialRow.rowIndex === idx) {
            return tableFragment.partialRow.partialHeight;
          }
          return rowMeasure?.height ?? 0;
        });

        const cellSpacingPx = tableMeasure.cellSpacingPx ?? 0;
        const tableBorderWidths = tableMeasure.tableBorderWidths;
        const contentOffsetX = tableBlock.attrs?.borderCollapse === 'separate' ? (tableBorderWidths?.left ?? 0) : 0;
        const contentOffsetY = tableBlock.attrs?.borderCollapse === 'separate' ? (tableBorderWidths?.top ?? 0) : 0;

        const calculateCellX = (cellIdx: number, cellMeasure: TableCellMeasure) => {
          const gridStart = cellMeasure.gridColumnStart ?? cellIdx;
          let x = cellSpacingPx; // space before first column
          for (let i = 0; i < gridStart && i < tableMeasure.columnWidths.length; i += 1) {
            x += tableMeasure.columnWidths[i] + cellSpacingPx;
          }
          return x;
        };

        const processRow = (rowIndex: number, rowOffset: number): number => {
          const rowMeasure = tableMeasure.rows[rowIndex];
          const row = tableBlock.rows[rowIndex];
          if (!rowMeasure || !row) return rowOffset;

          const rowHeight = rowHeights[rowIndex] ?? rowMeasure.height;
          const isPartialRow = tableFragment.partialRow?.rowIndex === rowIndex;
          const partialRowData = isPartialRow ? tableFragment.partialRow : null;

          const totalColumns = Math.min(rowMeasure.cells.length, row.cells.length);

          for (let cellIdx = 0; cellIdx < totalColumns; cellIdx += 1) {
            const cellMeasure = rowMeasure.cells[cellIdx];
            const cell = row.cells[cellIdx];
            if (!cellMeasure || !cell) continue;

            const padding = getCellPaddingFromRow(cellIdx, row);
            const cellX = calculateCellX(cellIdx, cellMeasure);

            const cellBlocks = getCellBlocks(cell);
            const cellBlockMeasures = getCellMeasures(cellMeasure);

            // Build block descriptors for renderer-semantic content height.
            // This fixes the spacing.after bug where the old code used measurement
            // semantics (effectiveTableCellSpacing) for the last block, but the
            // renderer skips spacing.after entirely for the last block.
            const cellRenderBlocks = describeCellRenderBlocks(cellMeasure, cell, padding);
            const totalCellLines =
              cellRenderBlocks.length > 0 ? cellRenderBlocks[cellRenderBlocks.length - 1].globalEndLine : 0;
            const cellAllowedStart = partialRowData?.fromLineByCell?.[cellIdx] ?? 0;
            const rawCellAllowedEnd = partialRowData?.toLineByCell?.[cellIdx];
            const cellAllowedEnd =
              rawCellAllowedEnd == null || rawCellAllowedEnd === -1 ? totalCellLines : rawCellAllowedEnd;

            // Map each paragraph block to its global line range within the cell.
            // cumulativeLine must advance for ALL block types (not just paragraphs)
            // so that paragraph line ranges align with the global index space used
            // by cellAllowedStart/cellAllowedEnd and computeCellSliceContentHeight.
            const renderedBlocks: Array<{
              block: ParagraphBlock;
              measure: ParagraphMeasure;
              startLine: number;
              endLine: number;
              height: number;
              originalBlockIndex: number;
              globalBlockStart: number;
            }> = [];

            let cumulativeLine = 0;
            const blockCount = Math.min(cellBlocks.length, cellBlockMeasures.length);
            for (let i = 0; i < blockCount; i += 1) {
              const paraBlock = cellBlocks[i];
              const paraMeasure = cellBlockMeasures[i];
              if (!paraBlock || !paraMeasure || paraBlock.kind !== 'paragraph' || paraMeasure.kind !== 'paragraph') {
                // Advance cumulativeLine past non-paragraph segments to stay
                // aligned with getCellLines() / describeCellRenderBlocks().
                if (paraMeasure) {
                  cumulativeLine += countBlockSegments(paraMeasure);
                }
                continue;
              }
              const lineCount = paraMeasure.lines.length;
              const blockStart = cumulativeLine;
              const blockEnd = cumulativeLine + lineCount;
              cumulativeLine = blockEnd;

              const renderStartGlobal = Math.max(blockStart, cellAllowedStart);
              const renderEndGlobal = Math.min(blockEnd, cellAllowedEnd);
              if (renderStartGlobal >= renderEndGlobal) continue;

              const startLine = renderStartGlobal - blockStart;
              const endLine = renderEndGlobal - blockStart;

              let height = sumLineHeights(paraMeasure, startLine, endLine);
              const rendersWholeBlock = startLine === 0 && endLine >= lineCount;
              if (rendersWholeBlock) {
                const totalHeight = (paraMeasure as { totalHeight?: number }).totalHeight;
                if (typeof totalHeight === 'number' && totalHeight > height) {
                  height = totalHeight;
                }
                const isFirstBlock = i === 0;
                const spacingBefore = (paraBlock as ParagraphBlock).attrs?.spacing?.before;
                height += effectiveTableCellSpacing(spacingBefore, isFirstBlock, padding.top);
                // Match renderer: skip spacing.after for the last block
                const isLastBlock = i === blockCount - 1;
                if (!isLastBlock) {
                  const spacingAfter = (paraBlock as ParagraphBlock).attrs?.spacing?.after;
                  if (typeof spacingAfter === 'number' && spacingAfter > 0) {
                    height += spacingAfter;
                  }
                }
              }

              renderedBlocks.push({
                block: paraBlock,
                measure: paraMeasure,
                startLine,
                endLine,
                height,
                originalBlockIndex: i,
                globalBlockStart: blockStart,
              });
            }

            // Use shared helper for aggregate content height — keeps selection
            // rects aligned with pagination and the DOM painter.
            const contentHeight = computeCellSliceContentHeight(cellRenderBlocks, cellAllowedStart, cellAllowedEnd);
            const contentAreaHeight = Math.max(0, rowHeight - (padding.top + padding.bottom));
            const freeSpace = Math.max(0, contentAreaHeight - contentHeight);

            let verticalOffset = 0;
            const vAlign = cell.attrs?.verticalAlign;
            if (vAlign === 'center' || vAlign === 'middle') {
              verticalOffset = freeSpace / 2;
            } else if (vAlign === 'bottom') {
              verticalOffset = freeSpace;
            }

            let blockTopCursor = padding.top + verticalOffset;

            // Track the global end line of the last processed block so we can
            // advance blockTopCursor past non-paragraph blocks (images, tables)
            // that sit between consecutive paragraphs.
            let prevBlockGlobalEndLine = cellAllowedStart;

            renderedBlocks.forEach((info) => {
              // Advance past any visible non-paragraph blocks between the previous
              // paragraph and this one. Without this, images/tables between
              // paragraphs would be invisible to blockTopCursor and later
              // paragraph rects would be positioned too high.
              for (const rb of cellRenderBlocks) {
                if (rb.kind === 'paragraph') continue;
                if (rb.visibleHeight === 0) continue;
                if (rb.globalEndLine <= prevBlockGlobalEndLine) continue;
                if (rb.globalStartLine >= info.globalBlockStart) break;
                const localStart = Math.max(0, cellAllowedStart - rb.globalStartLine);
                const localEnd = Math.min(rb.lineHeights.length, cellAllowedEnd - rb.globalStartLine);
                for (let li = localStart; li < localEnd; li++) {
                  blockTopCursor += rb.lineHeights[li];
                }
              }
              const paragraphMarkerWidth = info.measure.marker?.markerWidth ?? 0;
              // List items in table cells are also rendered with left alignment
              const cellIsListItem = isListItem(paragraphMarkerWidth, info.block);
              const alignmentOverride = cellIsListItem ? 'left' : undefined;
              // Extract paragraph indent for text positioning
              const cellIndent = extractParagraphIndent(
                info.block.kind === 'paragraph' ? info.block.attrs?.indent : undefined,
              );
              const cellWordLayout = getWordLayoutConfig(info.block);

              const intersectingLines = findLinesIntersectingRange(info.block, info.measure, from, to);

              // Match renderer: spacing.before is only applied when rendering from the start of the block (startLine === 0).
              // Use the original block index (not renderedBlocks index) so that isFirstBlock matches
              // the renderer's i === 0 check, which includes non-paragraph blocks.
              const rawSpacingBefore = (info.block as ParagraphBlock).attrs?.spacing?.before;
              const effectiveSpacingBeforePx =
                info.startLine === 0
                  ? effectiveTableCellSpacing(rawSpacingBefore, info.originalBlockIndex === 0, padding.top)
                  : 0;

              intersectingLines.forEach(({ line, index }) => {
                if (index < info.startLine || index >= info.endLine) {
                  return;
                }
                const range = computeLinePmRange(info.block, line);
                if (range.pmStart == null || range.pmEnd == null) return;
                const sliceFrom = Math.max(range.pmStart, from);
                const sliceTo = Math.min(range.pmEnd, to);
                if (sliceFrom >= sliceTo) {
                  // SD-3328: blank line spanned by the selection — see pushEmptyLineSelectionBand.
                  pushEmptyLineSelectionBand(rects, {
                    x: fragment.x + contentOffsetX + cellX + padding.left,
                    yBase:
                      fragment.y + contentOffsetY + rowOffset + blockTopCursor + effectiveSpacingBeforePx + pageTopY,
                    width: cellMeasure.width - padding.left - padding.right,
                    lineHeight: line.lineHeight,
                    pageIndex,
                    measure: info.measure,
                    lineIndex: index,
                    startLineIndex: info.startLine,
                  });
                  return;
                }

                const charOffsetFrom = pmPosToCharOffset(info.block, line, sliceFrom);
                const charOffsetTo = pmPosToCharOffset(info.block, line, sliceTo);
                const visualCharOffsetFrom = pmPosToVisualCharOffset(info.block, line, sliceFrom);
                const visualCharOffsetTo = pmPosToVisualCharOffset(info.block, line, sliceTo);
                const availableWidth = Math.max(1, cellMeasure.width - padding.left - padding.right);
                const isFirstLine = index === 0;
                const cellMarkerTextWidth = info.measure?.marker?.markerTextWidth ?? undefined;
                const startX = mapPmToX(
                  info.block,
                  line,
                  visualCharOffsetFrom,
                  availableWidth,
                  alignmentOverride,
                  isFirstLine,
                  cellMarkerTextWidth,
                );
                const endX = mapPmToX(
                  info.block,
                  line,
                  visualCharOffsetTo,
                  availableWidth,
                  alignmentOverride,
                  isFirstLine,
                  cellMarkerTextWidth,
                );

                // Calculate text indent using shared utility
                const textIndentAdjust = calculateTextStartIndent({
                  isFirstLine,
                  isListItem: cellIsListItem,
                  markerWidth: paragraphMarkerWidth,
                  markerTextWidth: cellMarkerTextWidth,
                  paraIndentLeft: cellIndent.left,
                  firstLineIndent: cellIndent.firstLine,
                  hangingIndent: cellIndent.hanging,
                  wordLayout: cellWordLayout,
                });

                const rectX =
                  fragment.x + contentOffsetX + cellX + padding.left + textIndentAdjust + Math.min(startX, endX);
                const rectWidth = Math.max(
                  1,
                  Math.min(Math.abs(endX - startX), line.width), // clamp to line width to prevent runaway widths
                );
                const lineOffset =
                  lineHeightBeforeIndex(info.measure, index) - lineHeightBeforeIndex(info.measure, info.startLine);
                const rectY =
                  fragment.y + contentOffsetY + rowOffset + blockTopCursor + effectiveSpacingBeforePx + lineOffset;

                rects.push({
                  x: rectX,
                  y: rectY + pageTopY,
                  width: rectWidth,
                  height: line.lineHeight,
                  pageIndex,
                });
              });

              blockTopCursor += info.height;
              prevBlockGlobalEndLine = info.globalBlockStart + info.endLine;
            });
          }

          return rowOffset + rowHeight;
        };

        // First row starts after space before table content (space between table border and first row)
        let rowCursor = cellSpacingPx;

        const repeatHeaderCount = tableFragment.repeatHeaderCount ?? 0;
        for (let r = 0; r < repeatHeaderCount && r < tableMeasure.rows.length; r += 1) {
          rowCursor = processRow(r, rowCursor);
          rowCursor += cellSpacingPx; // spacing after every row (including last) for outer spacing
        }

        for (let r = tableFragment.fromRow; r < tableFragment.toRow && r < tableMeasure.rows.length; r += 1) {
          rowCursor = processRow(r, rowCursor);
          rowCursor += cellSpacingPx; // spacing after every row (including last) for outer spacing
        }

        return;
      }

      if (isAtomicFragment(fragment)) {
        const blockIndex = findBlockIndexByFragmentId(blocks, fragment.blockId, { from, to });
        if (blockIndex === -1) return;
        const block = blocks[blockIndex];
        const pmRange = getAtomicPmRange(fragment, block);
        if (!rangesOverlap(pmRange.pmStart, pmRange.pmEnd, from, to)) return;
        rects.push({
          x: fragment.x,
          y: fragment.y + pageTopY,
          width: fragment.width,
          height: fragment.height,
          pageIndex,
        });
      }
    });
  });

  if (SELECTION_DEBUG_ENABLED && debugEntries.length > 0) {
    logSelectionDebug({
      from,
      to,
      entries: debugEntries,
    });
  }

  return rects;
}

export function getFragmentAtPosition(
  layout: Layout,
  blocks: FlowBlock[],
  measures: Measure[],
  pos: number,
): FragmentHit | null {
  // Suppress bridge debug logs

  for (let pageIndex = 0; pageIndex < layout.pages.length; pageIndex += 1) {
    const page = layout.pages[pageIndex];
    for (const fragment of page.fragments) {
      // Debug fragment checks removed to reduce noise

      const blockIndex = findBlockIndexByFragmentId(blocks, fragment.blockId);
      if (blockIndex === -1) {
        continue;
      }
      const block = blocks[blockIndex];
      const measure = measures[blockIndex];
      if (!block || !measure) continue;

      if (fragment.kind === 'para') {
        if (block.kind !== 'paragraph' || measure.kind !== 'paragraph') continue;

        if (fragment.pmStart != null && fragment.pmEnd != null && pos >= fragment.pmStart && pos <= fragment.pmEnd) {
          return {
            fragment,
            block,
            measure,
            pageIndex,
            pageY: 0,
          };
        }
        continue;
      }

      // Handle table fragments - check if position falls within any cell's content
      if (fragment.kind === 'table') {
        if (block.kind !== 'table' || measure.kind !== 'table') continue;

        const tableBlock = block as TableBlock;
        const _tableMeasure = measure as TableMeasure;
        const tableFragment = fragment as TableFragment;

        // Calculate the PM range for this table fragment (rows fromRow to toRow)
        let tableMinPos: number | null = null;
        let tableMaxPos: number | null = null;

        for (let r = tableFragment.fromRow; r < tableFragment.toRow && r < tableBlock.rows.length; r++) {
          const row = tableBlock.rows[r];
          for (const cell of row.cells) {
            const cellBlocks = cell.blocks ?? (cell.paragraph ? [cell.paragraph] : []);
            for (const cellBlock of cellBlocks) {
              if (cellBlock?.kind === 'paragraph') {
                const paraBlock = cellBlock as ParagraphBlock;
                for (const run of paraBlock.runs ?? []) {
                  if (run.pmStart != null) {
                    if (tableMinPos === null || run.pmStart < tableMinPos) tableMinPos = run.pmStart;
                    if (tableMaxPos === null || run.pmStart > tableMaxPos) tableMaxPos = run.pmStart;
                  }
                  if (run.pmEnd != null) {
                    if (tableMinPos === null || run.pmEnd < tableMinPos) tableMinPos = run.pmEnd;
                    if (tableMaxPos === null || run.pmEnd > tableMaxPos) tableMaxPos = run.pmEnd;
                  }
                }
              }
            }
          }
        }

        if (tableMinPos != null && tableMaxPos != null && pos >= tableMinPos && pos <= tableMaxPos) {
          return {
            fragment,
            block,
            measure,
            pageIndex,
            pageY: 0,
          };
        }
        continue;
      }

      if (isAtomicFragment(fragment)) {
        const { pmStart, pmEnd } = getAtomicPmRange(fragment, block);
        const start = pmStart ?? pmEnd;
        const end = pmEnd ?? pmStart;
        if (start == null || end == null) {
          continue;
        }
        const rangeStart = Math.min(start, end);
        const rangeEnd = Math.max(start, end);
        if (pos >= rangeStart && pos <= rangeEnd) {
          return {
            fragment,
            block,
            measure,
            pageIndex,
            pageY: 0,
          };
        }
      }
    }
  }
  return null;
}

export function findLinesIntersectingRange(
  block: FlowBlock,
  measure: Measure,
  from: number,
  to: number,
): { line: Line; index: number }[] {
  if (block.kind !== 'paragraph' || measure.kind !== 'paragraph') {
    return [];
  }
  const hits: { line: Line; index: number }[] = [];
  measure.lines.forEach((line: Line, idx: number) => {
    const range = computeLinePmRange(block, line);
    if (range.pmStart == null || range.pmEnd == null) {
      return;
    }
    const intersects = range.pmEnd > from && range.pmStart < to;
    if (intersects) {
      hits.push({ line, index: idx });
    }
  });
  return hits;
}

/**
 * Computes the ProseMirror position range for a line within a paragraph block.
 *
 * This function calculates the start and end PM positions by iterating through all runs
 * that contribute to the line, handling partial runs at line boundaries and accounting
 * for various run types (text, images, breaks, annotations).
 *
 * **Empty Run Handling (SD-1108 Fix):**
 * Unlike `pmPosToCharOffset` which skips empty runs during position-to-character mapping,
 * this function intentionally PRESERVES empty runs to support cursor positioning in
 * zero-width content like empty table cells. Empty runs carry PM position metadata that
 * enables click-to-position mapping even when there's no visible text.
 *
 * **Why the difference?**
 * - `computeLinePmRange`: Used for spatial operations (click mapping, selection highlighting)
 *   where we need to know the PM range of ALL content, including zero-width positions.
 * - `pmPosToCharOffset`: Used for text measurement where only visible characters matter.
 *   Empty runs contribute no pixels and should be skipped during character-based calculations.
 *
 * **Algorithm:**
 * 1. Filter out atomic runs (images, line breaks, field annotations) - they have no text length
 * 2. For each text run in the line:
 *    a. If the run is empty (length 0), preserve its PM positions for cursor support
 *    b. If the run has text, calculate PM positions based on character offsets
 *    c. Handle partial runs (first/last in line) by adjusting offsets
 * 3. Return the accumulated PM range
 *
 * **Edge Cases Handled:**
 * - Empty runs (zero text length but valid PM positions) - PRESERVED for SD-1108
 * - Atomic runs (images, breaks) - skipped, don't contribute to text range
 * - Runs with missing PM data - skipped with warning logged
 * - Runs with invalid PM positions (negative, Infinity, NaN) - logged as warnings
 * - Partial runs at line boundaries - offset calculations applied
 *
 * @param block - The flow block to compute PM range for (must be a paragraph block)
 * @param line - The line specification including run range (fromRun to toRun) and character offsets
 * @returns Object containing pmStart and pmEnd positions, or empty object if block is not a paragraph
 *
 * @example
 * ```typescript
 * // Normal text run
 * const range = computeLinePmRange(paragraphBlock, line);
 * // { pmStart: 10, pmEnd: 25 }
 *
 * // Empty table cell (SD-1108 fix)
 * const emptyRange = computeLinePmRange(emptyParagraphBlock, line);
 * // { pmStart: 15, pmEnd: 15 } - zero-width but valid for cursor positioning
 * ```
 *
 * @see pmPosToCharOffset - Related function that skips empty runs during character offset calculation
 */
export function computeLinePmRange(block: FlowBlock, line: Line): { pmStart?: number; pmEnd?: number } {
  return computeLinePmRangeUnified(block, line);
}

/**
 * Convert a ProseMirror position to a character offset within a line.
 *
 * This function performs ratio-based interpolation to handle cases where the PM position
 * range doesn't match the text length (e.g., when a run has formatting marks or when
 * there are position gaps between runs due to wrapper nodes).
 *
 * Algorithm:
 * 1. Iterate through runs in the line
 * 2. For each run, calculate its PM range and character count
 * 3. If pmPos falls within the run's PM range:
 *    - Use ratio interpolation: (pmPos - runStart) / runPmRange * runCharCount
 *    - This handles cases where PM positions don't align 1:1 with characters
 * 4. Return the accumulated character offset
 *
 * Edge Cases:
 * - Position before line start: Returns 0
 * - Position after line end: Returns total character count of the line
 * - Empty runs (images, breaks): Skipped, don't contribute to character count
 * - Runs with missing PM data: Skipped
 * - Zero-length PM range: Returns current accumulated offset without adding
 *
 * Performance:
 * - Time complexity: O(n) where n is the number of runs in the line
 * - Space complexity: O(1)
 *
 * @param block - The paragraph block containing the line
 * @param line - The line containing the position
 * @param pmPos - The ProseMirror position to convert
 * @returns Character offset from start of line (0-based), or 0 if position not found
 *
 * @example
 * ```typescript
 * // Run with PM range [10, 15] containing "Hello" (5 chars)
 * // pmPos = 12 should map to character offset 2 within the run
 * const offset = pmPosToCharOffset(block, line, 12);
 * // offset = 2 (ratio: (12-10)/(15-10) * 5 = 2/5 * 5 = 2)
 * ```
 */
export function pmPosToCharOffset(block: FlowBlock, line: Line, pmPos: number): number {
  if (block.kind !== 'paragraph') return 0;

  let charOffset = 0;

  for (let runIndex = line.fromRun; runIndex <= line.toRun; runIndex += 1) {
    const run = block.runs[runIndex];
    if (!run) continue;

    const text =
      'src' in run ||
      run.kind === 'lineBreak' ||
      run.kind === 'break' ||
      run.kind === 'fieldAnnotation' ||
      run.kind === 'math'
        ? ''
        : (run.text ?? '');
    const runTextLength = text.length;
    const runPmStart = run.pmStart ?? null;
    const runPmEnd = run.pmEnd ?? (runPmStart != null ? runPmStart + runTextLength : null);

    if (runPmStart == null || runPmEnd == null || runTextLength === 0) continue;

    const isFirstRun = runIndex === line.fromRun;
    const isLastRun = runIndex === line.toRun;
    const lineStartChar = isFirstRun ? line.fromChar : 0;
    const lineEndChar = isLastRun ? line.toChar : runTextLength;
    const runSliceCharCount = lineEndChar - lineStartChar;

    // Calculate PM positions for this slice using ratio-based mapping
    // This handles cases where run's PM range doesn't equal its text length
    const runPmRange = runPmEnd - runPmStart;
    const runSlicePmStart = runPmStart + (lineStartChar / runTextLength) * runPmRange;
    const runSlicePmEnd = runPmStart + (lineEndChar / runTextLength) * runPmRange;

    // Check if pmPos falls within this run's PM range
    if (pmPos >= runSlicePmStart && pmPos <= runSlicePmEnd) {
      // Position is within this run - use ratio to calculate character offset
      const runSlicePmRange = runSlicePmEnd - runSlicePmStart;
      if (runSlicePmRange > 0) {
        const pmOffsetInSlice = pmPos - runSlicePmStart;
        const charOffsetInSlice = Math.round((pmOffsetInSlice / runSlicePmRange) * runSliceCharCount);
        const result = charOffset + Math.min(charOffsetInSlice, runSliceCharCount);
        const runText = text;
        const offsetInRun = result - charOffset - (isFirstRun ? 0 : 0);
        logSelectionMapDebug({
          kind: 'pmPosToCharOffset-hit',
          blockId: block.id,
          pmPos,
          runIndex,
          lineFromRun: line.fromRun,
          lineToRun: line.toRun,
          runPmStart,
          runPmEnd,
          runSlicePmStart,
          runSlicePmEnd,
          runSliceCharCount,
          pmOffsetInSlice,
          charOffsetInSlice,
          result,
          runTextPreview: runText.slice(Math.max(0, offsetInRun - 10), Math.min(runText.length, offsetInRun + 10)),
        });
        return result;
      }
      logSelectionMapDebug({
        kind: 'pmPosToCharOffset-zero-range',
        blockId: block.id,
        pmPos,
        runIndex,
      });
      return charOffset;
    }

    // Position is after this run - add this run's character count and continue
    if (pmPos > runSlicePmEnd) {
      charOffset += runSliceCharCount;
    }
  }

  // If we didn't find the position in any run, return the total character count
  // (position is at or past the end of the line)
  logSelectionMapDebug({
    kind: 'pmPosToCharOffset-fallback',
    blockId: block.id,
    pmPos,
    lineFromRun: line.fromRun,
    lineToRun: line.toRun,
    result: charOffset,
  });
  return charOffset;
}

/**
 * Convert a ProseMirror position to a rendered character offset within a line.
 *
 * Unlike {@link pmPosToCharOffset}, this helper includes visual-only text runs
 * that do not carry PM positions. That matters for selection highlighting when
 * a line starts with rendered chrome such as a synthetic footnote number:
 * the marker consumes horizontal space in the painter, but it is not part of
 * the editable PM story. Using a PM-only offset would place the highlight too
 * far left by the marker's width.
 *
 * The returned offset is intended for visual X mapping, not for slicing PM text.
 */
export function pmPosToVisualCharOffset(block: FlowBlock, line: Line, pmPos: number): number {
  if (block.kind !== 'paragraph') return 0;

  let visualOffset = 0;

  for (let runIndex = line.fromRun; runIndex <= line.toRun; runIndex += 1) {
    const run = block.runs[runIndex];
    if (!run) continue;

    const text =
      'src' in run ||
      run.kind === 'lineBreak' ||
      run.kind === 'break' ||
      run.kind === 'fieldAnnotation' ||
      run.kind === 'math'
        ? ''
        : (run.text ?? '');
    const runTextLength = text.length;
    if (runTextLength === 0) {
      continue;
    }

    const isFirstRun = runIndex === line.fromRun;
    const isLastRun = runIndex === line.toRun;
    const lineStartChar = isFirstRun ? line.fromChar : 0;
    const lineEndChar = isLastRun ? line.toChar : runTextLength;
    const runSliceCharCount = lineEndChar - lineStartChar;
    if (runSliceCharCount <= 0) {
      continue;
    }

    const runPmStart = run.pmStart ?? null;
    const runPmEnd = run.pmEnd ?? (runPmStart != null ? runPmStart + runTextLength : null);

    if (runPmStart == null || runPmEnd == null) {
      visualOffset += runSliceCharCount;
      continue;
    }

    const runPmRange = runPmEnd - runPmStart;
    const runSlicePmStart = runPmStart + (lineStartChar / runTextLength) * runPmRange;
    const runSlicePmEnd = runPmStart + (lineEndChar / runTextLength) * runPmRange;

    if (pmPos >= runSlicePmStart && pmPos <= runSlicePmEnd) {
      const runSlicePmRange = runSlicePmEnd - runSlicePmStart;
      if (runSlicePmRange <= 0) {
        return visualOffset;
      }

      const pmOffsetInSlice = pmPos - runSlicePmStart;
      const visualOffsetInSlice = Math.round((pmOffsetInSlice / runSlicePmRange) * runSliceCharCount);
      return visualOffset + Math.min(visualOffsetInSlice, runSliceCharCount);
    }

    if (pmPos > runSlicePmEnd) {
      visualOffset += runSliceCharCount;
      continue;
    }

    return visualOffset;
  }

  return visualOffset;
}

// determineColumn, findLineIndexAtY are now in position-hit.ts and re-exported above.

const lineHeightBeforeIndex = (measure: Measure, absoluteLineIndex: number): number => {
  if (measure.kind !== 'paragraph') return 0;
  let height = 0;
  for (let i = 0; i < absoluteLineIndex; i += 1) {
    height += measure.lines[i]?.lineHeight ?? 0;
  }
  return height;
};

// mapPointToPm is now in position-hit.ts and re-exported above.

/**
 * Maps a character offset within a line to an X coordinate.
 *
 * This function performs logical-to-spatial position mapping for selection highlighting
 * and caret positioning. It uses Canvas-based text measurement for pixel-perfect accuracy
 * and accounts for paragraph indents, justified alignment, and complex formatting.
 *
 * The function calculates available width by subtracting left and right paragraph indents
 * from the fragment width, ensuring that text measurements match the painter's rendering
 * constraints. This available width is critical for justified text, where extra spacing
 * is distributed proportionally.
 *
 * @param block - The paragraph block containing the line
 * @param line - The line to map within
 * @param offset - Character offset from the start of the line (0-based)
 * @param fragmentWidth - The total width of the fragment containing this line (in pixels)
 * @param alignmentOverride - Optional alignment override (e.g., 'left' for list items)
 * @returns X coordinate in pixels from the start of the line, or 0 if inputs are invalid
 *
 * @example
 * ```typescript
 * // Measure position of character 5 in a 200px wide fragment
 * const x = mapPmToX(block, line, 5, 200);
 * // Returns: 47 (pixels from line start)
 * ```
 */
const mapPmToX = (
  block: FlowBlock,
  line: Line,
  offset: number,
  fragmentWidth: number,
  alignmentOverride?: string,
  isFirstLine?: boolean,
  /**
   * Measured marker text width for the hit fragment (or cell measure).
   * Mirrors the painter's `fragment.markerTextWidth` check at
   * `renderer.ts:3210-3211` — a list paragraph whose marker metadata exists
   * but renders to zero width (empty/vanished marker, continuation fragment)
   * must still receive the first-line width adjustment, so we gate on
   * measured width, not on raw `marker.markerText` attribute.
   */
  markerTextWidth?: number,
): number => {
  if (fragmentWidth <= 0 || line.width <= 0) return 0;

  // Type guard: Validate indent structure and ensure numeric values
  let paraIndentLeft = 0;
  let paraIndentRight = 0;
  let effectiveLeft = 0;
  let isListParagraph = false;
  let wl: ReturnType<typeof getWordLayoutConfig> | undefined;
  if (block.kind === 'paragraph') {
    const indentLeft = typeof block.attrs?.indent?.left === 'number' ? block.attrs.indent.left : 0;
    const indentRight = typeof block.attrs?.indent?.right === 'number' ? block.attrs.indent.right : 0;
    paraIndentLeft = Number.isFinite(indentLeft) ? indentLeft : 0;
    paraIndentRight = Number.isFinite(indentRight) ? indentRight : 0;
    effectiveLeft = paraIndentLeft;
    wl = getWordLayoutConfig(block);
    isListParagraph = Boolean(block.attrs?.numberingProperties) || Boolean(wl?.marker);
    if (isListParagraph) {
      const explicitTextStart =
        typeof wl?.marker?.textStartX === 'number' && Number.isFinite(wl.marker.textStartX)
          ? wl.marker.textStartX
          : typeof wl?.textStartPx === 'number' && Number.isFinite(wl.textStartPx)
            ? wl.textStartPx
            : undefined;
      if (typeof explicitTextStart === 'number' && explicitTextStart > paraIndentLeft) {
        effectiveLeft = explicitTextStart;
      }
    }
  }

  const totalIndent = effectiveLeft + paraIndentRight;
  let availableWidth = Math.max(0, fragmentWidth - totalIndent);

  // Validation: Warn when indents exceed fragment width (potential layout issue)
  if (totalIndent > fragmentWidth) {
    console.warn(
      `[mapPmToX] Paragraph indents (${totalIndent}px) exceed fragment width (${fragmentWidth}px) ` +
        `for block ${block.id}. This may indicate a layout miscalculation. ` +
        `Available width clamped to 0.`,
    );
  }

  // Adjust availableWidth for first-line text indent to match the painter's justify spacing.
  // Skip for list-marker first lines — the renderer only skips when the marker is actually
  // rendered with non-zero measured text width, so gate on `markerTextWidth`, not on the
  // raw `marker.markerText` attribute (which can be truthy for markers that measure to zero).
  const hasRenderedMarkerText = isListParagraph && (markerTextWidth ?? 0) > 0;
  if (isFirstLine && block.kind === 'paragraph' && !hasRenderedMarkerText) {
    const suppressFLI = (block.attrs as Record<string, unknown>)?.suppressFirstLineIndent === true;
    const firstLineOffset = getFirstLineIndentOffset(block.attrs?.indent, suppressFLI);
    availableWidth = adjustAvailableWidthForTextIndent(availableWidth, firstLineOffset, line.maxWidth);
  }

  // Use shared text measurement utility for pixel-perfect accuracy
  return measureCharacterX(block, line, offset, availableWidth, alignmentOverride);
};

// isRtlBlock is now in position-hit.ts and re-exported above.
