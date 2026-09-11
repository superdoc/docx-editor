/**
 * DOM-based text measurer for layout engine
 *
 * Uses HTML5 Canvas API to measure text runs and calculate line breaks.
 *
 * Responsibilities:
 * - Measure text width using actual font rendering
 * - Perform greedy line breaking based on maxWidth constraint
 * - Calculate typography metrics (ascent, descent, lineHeight)
 * - Return Measure with positioned line boundaries
 *
 * Typography Approximations (v0.1.0):
 * - ascent ≈ fontSize * 0.8 (baseline to top)
 * - descent ≈ fontSize * 0.2 (baseline to bottom)
 * - automatic line height uses the font's Word-compatible natural line metric
 * - explicit OOXML auto multipliers (for example 1.33) are honored as-projected
 * - empty paragraphs use fontSize as the base line height
 *
 * These are documented heuristics; we can swap in precise font metrics later
 * if needed via libraries like opentype.js.
 *
 * Line Breaking Strategy:
 * - Greedy algorithm: accumulate words until exceeding maxWidth
 * - Breaks on word boundaries (spaces)
 * - Single words wider than maxWidth are kept on their own line
 *
 * Future improvements:
 * - Hyphenation support
 * - Justification and word spacing
 * - Precise font metrics from font files
 * - Kerning and ligature support
 */

import {
  Engines,
  type FlowBlock,
  type ParagraphBlock,
  type ParagraphSpacing,
  type ParagraphIndent,
  type ImageBlock,
  type ListBlock,
  type Measure,
  type Line,
  type InlineBoxSpan,
  type LineInlineBox,
  type LineInlineImageAlignment,
  type ParagraphMeasure,
  type ImageMeasure,
  type TableBlock,
  type TableMeasure,
  type TableRowMeasure,
  type TableCellMeasure,
  type ListMeasure,
  type Run,
  type TextRun,
  type TabRun,
  type ImageRun,
  type LineBreakRun,
  type FieldAnnotationRun,
  type TabStop,
  type DrawingBlock,
  type DrawingMeasure,
  type DrawingGeometry,
  type TextboxContentMeasure,
  type DropCapDescriptor,
  type CellSpacing,
  type CellBorders,
  type BorderSpec,
  type TableBorders,
  type TableBorderValue,
  EMPTY_SDT_PLACEHOLDER_TEXT,
  effectiveTableCellSpacing,
  expandRunsForInlineNewlines,
  isEmptySdtPlaceholderRun,
  isShapeTextBaselineWarp,
  isShapeTextSingleBandEnvelopeWarp,
  LeaderDecoration,
  resolveAnchoredGraphicY,
  resolveBaseFontSizeForVerticalText,
  resolveShapeTextContentMeasureWidth,
  getParagraphInlineDirection,
  sliceRunsForLine,
} from '@superdoc/contracts';
import type { WordParagraphLayoutOutput } from '@superdoc/word-layout';
import {
  LIST_MARKER_GAP,
  MIN_MARKER_GUTTER,
  DEFAULT_LIST_INDENT_BASE_PX as DEFAULT_LIST_INDENT_BASE,
  DEFAULT_LIST_INDENT_STEP_PX as DEFAULT_LIST_INDENT_STEP,
  DEFAULT_LIST_HANGING_PX as DEFAULT_LIST_HANGING,
} from '@superdoc/common/layout-constants';
import { resolveListTextStartPx, type MinimalMarker } from '@superdoc/common/list-marker-utils';
import { calculateRotatedBounds, normalizeRotation } from '@superdoc/geometry-utils';
import { toCssFontFamily } from '@superdoc/font-utils';
import {
  DEFAULT_FONT_MEASURE_CONTEXT,
  type FaceKey,
  type FontMeasureCapabilities,
  type FontMeasureContext,
  type FontMeasureFace,
} from '@superdoc/font-system';
export { installNodeCanvasPolyfill } from './setup.js';
import {
  clearMeasurementCache,
  getMeasuredTextWidth,
  setCacheSize,
  type TextWidthCacheStats,
} from './measurementCache.js';
import {
  firstBreakUnit,
  hasCjkBreakOpportunity,
  KINSOKU_FORBIDDEN_LINE_START,
  nextCodePointBoundary,
  resolveKinsokuBoundary,
} from './cjk-line-break.js';
import { collectCjkJustificationBoundaries } from './cjk-justification.js';
import {
  getCalibratedBodyEmptyLine,
  getFontMetrics,
  clearFontMetricsCache,
  type FontInfo,
  type FontMetricsResult,
} from './fontMetricsCache.js';
import {
  composedNaturalLineHeight,
  extendFontLineMetricEnvelope,
  type FontLineMetricEnvelope,
} from './line-metric-composition.js';
import {
  bindSurfaceMeasurementPass,
  clearSurfaceMeasurementGeneration,
  createSurfaceMeasurementRuntimeState,
  disposeSurfaceMeasurementRuntime,
  ensureSurfaceMeasurementCanvas,
  getSurfaceMeasurementRuntime,
  getSurfaceMeasurementRuntimeForCanvas,
  surfaceMeasurementCheckpointIfDue,
  unbindSurfaceMeasurementPass,
  type SurfaceMeasurementExecutionControl,
} from './measurement-runtime-context.js';
import { DomMeasurementInfrastructureError } from './measurement-infrastructure-error.js';
import { createTabularDigitProbe, type TabularDigitProbe } from './tabular-digits.js';
import {
  clearTableCellBlockMeasureCache,
  measureTableCellBlocks,
  type TableCellBlockMeasureCacheOutcome,
} from './table-cell-block-measure-cache.js';
import { computeAutoFitColumnWidths } from './autofit-columns.js';
import { buildAutoFitWorkingGridInput, type WorkingTableGridInput } from './autofit-normalize.js';
import { computeFixedTableColumnWidths } from './fixed-table-columns.js';
import type { FixedLayoutResult } from './fixed-table-columns.js';
import {
  type AutoFitMeasureBlock,
  buildAutoFitTableResultCacheKey,
  buildTableCellContentMetricsCacheKey,
  clearTableAutoFitMeasurementCaches,
  getCachedAutoFitTableResult,
  type TableAutoFitContentMetricsResult,
  measureTableAutoFitContentMetrics,
  setCachedAutoFitTableResult,
} from './table-autofit-metrics.js';

export { clearFontMetricsCache };
export { getCalibratedNaturalSingleLine } from './fontMetricsCache.js';
export { clearTableAutoFitMeasurementCaches };
/**
 * CJK line-breaking rules. Re-exported so every width-constrained wrapper —
 * including the layout-bridge remeasurement fallback — breaks CJK the same way
 * this measurer does.
 */
export {
  alignToCodePointBoundary,
  codePointAt,
  firstBreakUnit,
  hasCjkBreakOpportunity,
  isCjkBreakOpportunityChar,
  KINSOKU_FORBIDDEN_LINE_END,
  KINSOKU_FORBIDDEN_LINE_START,
  nextCodePointBoundary,
  resolveKinsokuBoundary,
} from './cjk-line-break.js';
export { collectCjkJustificationBoundaries } from './cjk-justification.js';

/**
 * Clear every font-dependent text-measurement cache owned by `measuring/dom`:
 * text advance widths, font ascent/descent metrics, and AutoFit cell metrics.
 *
 * Call this when the set of available fonts changes (a face finishes loading,
 * or a substitution/mapping is added) so the next measurement pass re-measures
 * with the correct font instead of reusing results taken against a fallback.
 * The caller is also responsible for clearing the layout-bridge block-measure
 * cache (`measureCache.clear()`), which holds derived block measures.
 */
export function clearTextMeasurementCaches(): void {
  clearMeasurementCache();
  clearFontMetricsCache();
  clearTableAutoFitMeasurementCaches();
  clearTableCellBlockMeasureCache();
  // Drop the persistent measuring canvas. A 2D context caches its font resolution: once it
  // measured a family while the font was absent (falling back), it keeps using the fallback
  // even after the font loads. A fresh context re-resolves to the now-available font.
  canvasContext = null;
}

const { computeTabStops } = Engines;

type MeasurementMode = 'browser' | 'deterministic';

type MeasurementConfig = {
  mode: MeasurementMode;
  fonts: {
    deterministicFamily: string;
    fallbackStack: string[];
  };
  cacheSize: number;
};

const measurementConfig: MeasurementConfig = {
  mode: 'browser',
  fonts: {
    deterministicFamily: 'Noto Sans',
    fallbackStack: ['Noto Sans', 'Arial', 'sans-serif'],
  },
  cacheSize: 5000,
};

export function configureMeasurement(options: Partial<MeasurementConfig>): void {
  if (options.mode) {
    measurementConfig.mode = options.mode;
  }
  if (options.fonts) {
    measurementConfig.fonts = {
      ...measurementConfig.fonts,
      ...options.fonts,
    };
  }
  if (typeof options.cacheSize === 'number' && Number.isFinite(options.cacheSize) && options.cacheSize > 0) {
    measurementConfig.cacheSize = options.cacheSize;
    setCacheSize(options.cacheSize);
  }
}

export { clearMeasurementCache };

/**
 * With Word's default no-kerning behavior applied, its Aptos glyph advances
 * remain 0.13–0.20% wider than the browser's installed face across the
 * reviewed oracle lines. Spaces are already within measurement tolerance, so
 * only non-whitespace glyph runs receive the residual calibration.
 */
const WORD_GLYPH_ADVANCE_SCALE_BY_FAMILY = new Map<string, number>([
  ['aptos', 1.0016],
  ['aptos display', 1.0016],
]);

function resolveWordGlyphAdvanceScale(fontFamily: string | undefined, text: string): number {
  if (!fontFamily || !/\S/u.test(text)) return 1;
  const primaryFamily = fontFamily
    .split(',')[0]
    ?.trim()
    .replace(/^['"]|['"]$/g, '')
    .toLowerCase();
  return WORD_GLYPH_ADVANCE_SCALE_BY_FAMILY.get(primaryFamily) ?? 1;
}

export type DomMeasurementExecutionControl = SurfaceMeasurementExecutionControl;

export interface DomMeasurementPass {
  readonly fontCapabilities: FontMeasureCapabilities;
  measureBlock(block: FlowBlock, constraints: number | MeasureConstraints): Promise<Measure>;
  snapshotStats(): TextWidthCacheStats;
  finish(): TextWidthCacheStats;
}

export interface DomMeasurementRuntime {
  beginPass(fontContext: FontMeasureContext, execution?: DomMeasurementExecutionControl): DomMeasurementPass;
  clearForFontGeneration(fontSignature: string): void;
  snapshotStats(): TextWidthCacheStats;
  dispose(): void;
}

export interface DomMeasurementRuntimeOptions {
  maxTextEntries?: number;
  maxEstimatedTextBytes?: number;
}

function createCanvasContext(): CanvasRenderingContext2D {
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!canvas) {
    throw new DomMeasurementInfrastructureError(
      'Canvas not available. Ensure this runs in a DOM environment (browser or jsdom).',
    );
  }
  const context = canvas.getContext('2d');
  if (!context) throw new DomMeasurementInfrastructureError('Failed to get 2D context from canvas');
  return context;
}

function statsDelta(current: TextWidthCacheStats, baseline: TextWidthCacheStats): TextWidthCacheStats {
  return {
    requests: current.requests - baseline.requests,
    hits: current.hits - baseline.hits,
    misses: current.misses - baseline.misses,
    evictions: current.evictions - baseline.evictions,
    intrinsicMeasureCalls: current.intrinsicMeasureCalls - baseline.intrinsicMeasureCalls,
    intrinsicMeasureMs: current.intrinsicMeasureMs - baseline.intrinsicMeasureMs,
    lookupMs: current.lookupMs - baseline.lookupMs,
    keyCharacters: current.keyCharacters - baseline.keyCharacters,
    residentEntries: current.residentEntries,
    estimatedResidentBytes: current.estimatedResidentBytes,
  };
}

const measurementCheckpointIfDue = surfaceMeasurementCheckpointIfDue;
// Wrapped long words retain their per-code-point checks. Batching only the
// word-boundary checks avoids repeated clock reads while ordinary prose remains
// cancellable within 8 tokens.
const WORD_BOUNDARIES_PER_MEASUREMENT_CHECKPOINT = 8;

export function createDomMeasurementRuntime(options: DomMeasurementRuntimeOptions = {}): DomMeasurementRuntime {
  const state = createSurfaceMeasurementRuntimeState({
    maxTextEntries: options.maxTextEntries ?? 50_000,
    maxEstimatedTextBytes: options.maxEstimatedTextBytes ?? 16 * 1024 * 1024,
  });

  return {
    beginPass(fontContext, execution) {
      if (state.disposed) throw new DomMeasurementInfrastructureError('DomMeasurementRuntime has been disposed');
      if (state.activePass) {
        throw new DomMeasurementInfrastructureError('DomMeasurementRuntime already has an active pass');
      }
      if (state.fontSignature !== fontContext.fontSignature) {
        clearSurfaceMeasurementGeneration(state, fontContext.fontSignature);
      }
      const passFontContext: FontMeasureContext = Object.freeze({
        fontSignature: fontContext.fontSignature,
        resolvePhysical: fontContext.resolvePhysical,
        ...(fontContext.resolveNaturalLineMultiplier
          ? { resolveNaturalLineMultiplier: fontContext.resolveNaturalLineMultiplier }
          : {}),
      });
      bindSurfaceMeasurementPass(state, passFontContext, execution);
      const baseline = state.textWidths.snapshotStats();
      let finished = false;
      let digitProbe: TabularDigitProbe | undefined;
      const fontCapabilities: FontMeasureCapabilities = Object.freeze({
        hasTabularDigits: (face: FontMeasureFace) => {
          digitProbe ??= createTabularDigitProbe(ensureSurfaceMeasurementCanvas(state));
          const { font } = buildFontString(
            {
              fontFamily: face.family,
              fontSize: face.sizePx,
              bold: face.weight === '700',
              italic: face.style === 'italic',
            },
            passFontContext,
          );
          return digitProbe.hasTabularDigits(font);
        },
      });
      const snapshot = (): TextWidthCacheStats => statsDelta(state.textWidths.snapshotStats(), baseline);
      return {
        fontCapabilities,
        measureBlock: async (block, constraints) => {
          if (finished) throw new DomMeasurementInfrastructureError('DomMeasurementPass has finished');
          state.execution?.throwIfAborted?.();
          const result = await measureBlock(block, constraints, passFontContext);
          state.execution?.throwIfAborted?.();
          return result;
        },
        snapshotStats: snapshot,
        finish: () => {
          if (finished) return snapshot();
          finished = true;
          unbindSurfaceMeasurementPass(state, passFontContext);
          return snapshot();
        },
      };
    },
    clearForFontGeneration(fontSignature) {
      if (state.disposed) throw new DomMeasurementInfrastructureError('DomMeasurementRuntime has been disposed');
      if (state.activePass) {
        throw new DomMeasurementInfrastructureError('Cannot change font generation during an active measurement pass');
      }
      if (state.fontSignature !== fontSignature) clearSurfaceMeasurementGeneration(state, fontSignature);
    },
    snapshotStats: () => state.textWidths.snapshotStats(),
    dispose() {
      disposeSurfaceMeasurementRuntime(state);
    },
  };
}

/** Compatibility canvas for callers using the exported singleton measureBlock. */
let canvasContext: CanvasRenderingContext2D | null = null;

export const TABLE_MEASUREMENT_PHASES = [
  'grid-normalization',
  'fixed-column-resolution',
  'autofit-content-metrics',
  'autofit-column-solve',
  'cell-block-measurement',
  'row-measure-assembly',
  'row-height-resolution',
  'other',
] as const;

export type TableMeasurementPhase = (typeof TABLE_MEASUREMENT_PHASES)[number];
export type TableMeasurementMode = 'fixed' | 'stable-auto-grid' | 'full-autofit';

export interface TableMeasurementObservation {
  depth: number;
  cacheIdentity: 'strict' | 'content';
  mode: TableMeasurementMode;
  totalWallMs: number;
  reconciliationDeltaMs: number;
  phases: Record<TableMeasurementPhase, number>;
  rowCount: number;
  cellCount: number;
  nestedBlockCount: number;
  cellBlockCache: Record<TableCellBlockMeasureCacheOutcome, number>;
  autoFitCellMetricCache: { hits: number; misses: number };
  autoFitTableResultCache: { hits: number; misses: number };
}

export interface TableMeasurementTraceContext {
  depth: number;
  cacheIdentity: 'strict' | 'content';
  observer: (observation: TableMeasurementObservation) => void;
}

export type MeasureConstraints = {
  maxWidth: number;
  maxHeight?: number;
  tableMeasurementTrace?: TableMeasurementTraceContext;
  /** Word uses the legacy font-size floor for empty header/footer story lines. */
  emptyParagraphLineMetrics?: 'body' | 'headerFooter';
};

// List constants centralized in @superdoc/common/layout-constants

// Tab constants (OOXML alignment: twips → pixels)
const DEFAULT_TAB_INTERVAL_TWIPS = 720; // 0.5 inch in twips
const TWIPS_PER_INCH = 1440;
const PX_PER_INCH = 96; // Standard CSS/DOM DPI
const TWIPS_PER_PX = TWIPS_PER_INCH / PX_PER_INCH; // 15 twips per pixel
const _PX_PER_PT = 96 / 72; // Reserved for future pt↔px conversions
const twipsToPx = (twips: number): number => twips / TWIPS_PER_PX;
const pxToTwips = (px: number): number => Math.round(px * TWIPS_PER_PX);

// Canonical implementation moved to @superdoc/contracts; re-imported for local use and re-exported.
export { getCellSpacingPx } from '@superdoc/contracts';
import { getCellSpacingPx, getRenderedTableBorderWidthPx } from '@superdoc/contracts';

/**
 * Returns the border width in pixels for a table border value (matches painter border-utils logic).
 * Used so total table dimensions include outer border sizes and there is enough space for last row/column spacing.
 */
function getTableBorderWidthPx(value: TableBorderValue | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === 'object' && 'none' in value && value.none) return 0;
  const raw = value as { style?: BorderSpec['style']; width?: number; size?: number };
  const w = typeof raw.width === 'number' ? raw.width : typeof raw.size === 'number' ? raw.size : 1;
  return getRenderedTableBorderWidthPx({ style: raw.style, width: w }, 1);
}

/** Computes outer table border widths in px from table attrs (for total dimensions and content offset). */
function getTableBorderWidths(borders: TableBorders | null | undefined): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  const top = getTableBorderWidthPx(borders?.top);
  const right = getTableBorderWidthPx(borders?.right);
  const bottom = getTableBorderWidthPx(borders?.bottom);
  const left = getTableBorderWidthPx(borders?.left);
  return { top, right, bottom, left };
}

type TableCellBorderInsets = { top: number; right: number; bottom: number; left: number };

const borderSpecsMatch = (left?: BorderSpec, right?: BorderSpec): boolean =>
  left?.style === right?.style && left?.width === right?.width && left?.color === right?.color;

const uniformDoubleRing = (borders: CellBorders | undefined): BorderSpec | undefined => {
  const first = borders?.top;
  if (!first || first.style !== 'double') return undefined;
  return [borders?.right, borders?.bottom, borders?.left].every((border) => borderSpecsMatch(first, border))
    ? first
    : undefined;
};

const cellBorderWidthPx = (border: BorderSpec | undefined): number =>
  border ? getRenderedTableBorderWidthPx(border, 1) : 0;

const hasExplicitCellBorders = (borders: CellBorders | undefined): borders is CellBorders =>
  Boolean(
    borders &&
    (borders.top !== undefined ||
      borders.right !== undefined ||
      borders.bottom !== undefined ||
      borders.left !== undefined),
  );

const inheritedBorderWidthPx = (border: BorderSpec | undefined, fallback: TableBorderValue | undefined): number =>
  border !== undefined ? cellBorderWidthPx(border) : getTableBorderWidthPx(fallback);

/**
 * Resolves the border-box chrome that table measurement must reserve for a
 * cell. The DOM painter uses a single-owner collapsed-border model: top/left
 * own shared edges, while a uniform double cell ring keeps all four sides on
 * the selected cell so its corners remain continuous.
 */
function getTableCellBorderInsets(params: {
  cellBorders?: CellBorders;
  aboveCellBorders?: CellBorders;
  leftCellBorders?: CellBorders;
  tableBorders?: TableBorders;
  rowIndex: number;
  rowSpan: number;
  rowCount: number;
  gridColumnStart: number;
  colSpan: number;
  gridColumnCount: number;
  cellSpacingPx: number;
}): TableCellBorderInsets {
  const {
    cellBorders,
    aboveCellBorders,
    leftCellBorders,
    tableBorders,
    rowIndex,
    rowSpan,
    rowCount,
    gridColumnStart,
    colSpan,
    gridColumnCount,
    cellSpacingPx,
  } = params;
  const touchesTop = rowIndex === 0;
  const touchesBottom = rowIndex + rowSpan >= rowCount;
  const touchesLeft = gridColumnStart === 0;
  const touchesRight = gridColumnStart + colSpan >= gridColumnCount;
  const ring = uniformDoubleRing(cellBorders);
  const hasBordersAttribute = cellBorders !== undefined;
  const hasExplicitBorders = hasExplicitCellBorders(cellBorders);

  if (cellSpacingPx > 0) {
    if (hasBordersAttribute && !hasExplicitBorders) {
      return { top: 0, right: 0, bottom: 0, left: 0 };
    }

    if (!tableBorders) {
      return {
        top: cellBorderWidthPx(cellBorders?.top),
        right: cellBorderWidthPx(cellBorders?.right),
        bottom: cellBorderWidthPx(cellBorders?.bottom),
        left: cellBorderWidthPx(cellBorders?.left),
      };
    }

    if (!hasExplicitBorders) {
      return {
        top: touchesTop ? 0 : getTableBorderWidthPx(tableBorders.insideH),
        right: touchesRight ? 0 : getTableBorderWidthPx(tableBorders.insideV),
        bottom: touchesBottom ? 0 : getTableBorderWidthPx(tableBorders.insideH),
        left: touchesLeft ? 0 : getTableBorderWidthPx(tableBorders.insideV),
      };
    }

    return {
      top: inheritedBorderWidthPx(cellBorders?.top, touchesTop ? tableBorders?.top : tableBorders?.insideH),
      right: inheritedBorderWidthPx(cellBorders?.right, touchesRight ? tableBorders?.right : undefined),
      bottom: inheritedBorderWidthPx(cellBorders?.bottom, touchesBottom ? tableBorders?.bottom : undefined),
      left: inheritedBorderWidthPx(cellBorders?.left, touchesLeft ? tableBorders?.left : tableBorders?.insideV),
    };
  }

  const aboveRing = uniformDoubleRing(aboveCellBorders);
  const leftRing = uniformDoubleRing(leftCellBorders);
  const top = touchesTop
    ? inheritedBorderWidthPx(cellBorders?.top, tableBorders?.top)
    : aboveRing && borderSpecsMatch(cellBorders?.top, aboveCellBorders?.bottom)
      ? 0
      : Math.max(
          cellBorderWidthPx(cellBorders?.top),
          cellBorderWidthPx(aboveCellBorders?.bottom),
          cellBorders?.top === undefined && aboveCellBorders?.bottom === undefined
            ? getTableBorderWidthPx(tableBorders?.insideH)
            : 0,
        );
  const left = touchesLeft
    ? inheritedBorderWidthPx(cellBorders?.left, tableBorders?.left)
    : leftRing && borderSpecsMatch(cellBorders?.left, leftCellBorders?.right)
      ? 0
      : Math.max(
          cellBorderWidthPx(cellBorders?.left),
          cellBorderWidthPx(leftCellBorders?.right),
          cellBorders?.left === undefined && leftCellBorders?.right === undefined
            ? getTableBorderWidthPx(tableBorders?.insideV)
            : 0,
        );

  return {
    top,
    left,
    bottom: ring
      ? cellBorderWidthPx(cellBorders?.bottom)
      : touchesBottom
        ? inheritedBorderWidthPx(cellBorders?.bottom, tableBorders?.bottom)
        : 0,
    right: ring
      ? cellBorderWidthPx(cellBorders?.right)
      : touchesRight
        ? inheritedBorderWidthPx(cellBorders?.right, tableBorders?.right)
        : cellBorderWidthPx(cellBorders?.right),
  };
}

const DEFAULT_TAB_INTERVAL_PX = twipsToPx(DEFAULT_TAB_INTERVAL_TWIPS);
const TAB_EPSILON = 0.1;
const DEFAULT_CELL_PADDING = { top: 0, left: 4, right: 4, bottom: 0 };
const DEFAULT_DECIMAL_SEPARATOR = '.';
const ALLOWED_TAB_VALS = new Set<TabStop['val']>(['start', 'center', 'end', 'decimal', 'bar', 'clear']);

// Field annotation pill styling constants
const FIELD_ANNOTATION_PILL_PADDING = 8; // Border (2px each side) + padding (2px each side)
const FIELD_ANNOTATION_LINE_HEIGHT_MULTIPLIER = 1.2; // Line height multiplier for pill height
const FIELD_ANNOTATION_VERTICAL_PADDING = 6; // Vertical padding/border for pill height
const DEFAULT_FIELD_ANNOTATION_FONT_SIZE = 16; // Default font size for field annotations
const DEFAULT_PARAGRAPH_FONT_SIZE = 12;
const DEFAULT_PARAGRAPH_FONT_FAMILY = 'Arial';
const isValidFontSize = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const normalizeFontSize = (value: unknown, fallback = DEFAULT_PARAGRAPH_FONT_SIZE): number => {
  if (isValidFontSize(value)) return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    if (isValidFontSize(parsed)) return parsed;
  }
  return fallback;
};

const normalizeFontFamily = (value: unknown, fallback = DEFAULT_PARAGRAPH_FONT_FAMILY): string =>
  typeof value === 'string' && value.trim().length > 0 ? value : fallback;

/**
 * Tab stop in pixel coordinates for measurement.
 * Converted from OOXML twips at measurement boundary.
 */
type TabStopPx = {
  pos: number; // px
  val: TabStop['val'];
  leader?: TabStop['leader'];
  source?: TabStop['source'];
};

// Unused type - may be needed for future decimal tab implementation
// type _PendingDecimalStop = {
//   target: number;
//   consumed: number;
// };

const roundValue = (value: number): number =>
  measurementConfig.mode === 'deterministic' ? Math.round(value * 10) / 10 : value;

// Utility functions for future unit conversion needs
// function _ptToPx(pt: number): number {
//   return pt * PX_PER_PT;
// }

// function _pxToPt(px: number): number {
//   return px / PX_PER_PT;
// }

/**
 * Get or create a canvas 2D context for text measurement.
 *
 * Lazily creates and caches a canvas 2D context for efficient text measurement.
 * The context is reused across multiple measurements to avoid the overhead of
 * repeated canvas creation.
 *
 * @returns A cached CanvasRenderingContext2D instance
 * @throws {Error} If canvas is not available (non-DOM environment without polyfill)
 * @throws {Error} If 2D context creation fails
 */
function getCanvasContext(fontContext?: FontMeasureContext): CanvasRenderingContext2D {
  const runtime = getSurfaceMeasurementRuntime(fontContext);
  if (runtime) {
    return ensureSurfaceMeasurementCanvas(runtime);
  }
  canvasContext ??= createCanvasContext();
  return canvasContext;
}

function measuredTextWidth(text: string, font: string, letterSpacing: number, ctx: CanvasRenderingContext2D): number {
  // Word does not kern a run unless w:kern explicitly enables it. The current
  // projection does not surface that opt-in yet, so the fail-closed default is
  // the Word default rather than Canvas' `auto` kerning.
  ctx.fontKerning = 'none';
  const runtime = getSurfaceMeasurementRuntimeForCanvas(ctx);
  return runtime
    ? runtime.textWidths.measure(text, font, letterSpacing, ctx)
    : getMeasuredTextWidth(text, font, letterSpacing, ctx);
}

function measuredFontMetrics(ctx: CanvasRenderingContext2D, fontInfo: FontInfo): FontMetricsResult {
  const runtime = getSurfaceMeasurementRuntimeForCanvas(ctx);
  return runtime
    ? runtime.fontMetrics.get(
        ctx,
        fontInfo,
        measurementConfig.mode,
        measurementConfig.fonts,
        runtime.fontSignature ?? '',
      )
    : getFontMetrics(ctx, fontInfo, measurementConfig.mode, measurementConfig.fonts);
}

/** The face (weight/style) a run renders at, for face-aware resolution. */
function faceOf(run: { bold?: boolean; italic?: boolean }): FaceKey {
  return { weight: run.bold ? '700' : '400', style: run.italic ? 'italic' : 'normal' };
}

/**
 * Build a CSS font string from Run styling properties
 *
 * @example
 * ```
 * buildFontString({ fontFamily: "Arial", fontSize: 16, bold: true, italic: true })
 * // Returns: { font: "italic bold 16px Arial", fontFamily: "Arial" }
 * ```
 */
function buildFontString(
  run: { fontFamily: string; fontSize: number; bold?: boolean; italic?: boolean },
  fontContext: FontMeasureContext,
  resolvedPhysicalFamily?: string,
): {
  font: string;
  fontFamily: string;
} {
  const parts: string[] = [];

  if (run.italic) parts.push('italic');
  if (run.bold) parts.push('bold');
  parts.push(`${run.fontSize}px`);

  // Resolve the logical family (e.g. "Calibri") to the physical render family
  // (e.g. "Carlito") so text is MEASURED in the same font it is painted with, using THIS
  // document's resolver so a per-document `fonts.map` is honored. The measure cache keys
  // on this font string, so the physical family is in the key.
  const physicalFamily = resolvedPhysicalFamily ?? fontContext.resolvePhysical(run.fontFamily, faceOf(run));

  if (measurementConfig.mode === 'deterministic') {
    // Deterministic mode still flattens to one family for reproducible server-side
    // measurement; per-font resolution here is follow-up T1 work (browser mode first).
    parts.push(
      measurementConfig.fonts.fallbackStack.length > 0
        ? measurementConfig.fonts.fallbackStack.join(', ')
        : measurementConfig.fonts.deterministicFamily,
    );
  } else {
    parts.push(physicalFamily);
  }

  return {
    font: parts.join(' '),
    fontFamily: physicalFamily,
  };
}

/**
 * Measure the width of a text string with specific styling, including letter spacing
 *
 * @param text - The text to measure
 * @param font - CSS font string (e.g., "16px Arial")
 * @param ctx - Canvas 2D context
 * @param fontFamily - Font family name for calibration
 * @param letterSpacing - Optional letter spacing in pixels
 * @returns Total width including letter spacing, calibration, and glyph overhang
 */
function measureText(
  text: string,
  font: string,
  ctx: CanvasRenderingContext2D,
  _fontFamily?: string,
  _letterSpacing?: number,
): number {
  // Deprecated direct measurement; kept for backward compatibility in case of direct calls.
  ctx.font = font;
  const metrics = ctx.measureText(text);
  const advanceWidth = metrics.width;
  const paintedWidth = (metrics.actualBoundingBoxLeft || 0) + (metrics.actualBoundingBoxRight || 0);
  return Math.max(advanceWidth, paintedWidth);
}

/**
 * Calculate typography metrics for a given font size
 *
 * When fontInfo is provided, uses actual Canvas TextMetrics API to get precise
 * ascent/descent values from actualBoundingBoxAscent/Descent. This prevents
 * text clipping that occurs when using hardcoded approximations (0.8/0.2 ratios)
 * which don't account for font-specific glyph heights.
 *
 * Falls back to approximations (0.8/0.2) only when:
 * - fontInfo is not provided (empty paragraphs)
 * - Browser doesn't support actualBoundingBox* metrics (legacy browsers)
 */

/**
 * Frozen-main baseline used by the initial paragraph measurer when a paragraph
 * does not carry explicit line spacing.
 */
const V1_DEFAULT_PARAGRAPH_LINE_HEIGHT_MULTIPLIER = 1.15;

/**
 * Word permits a bounded amount of inter-word compression before wrapping a
 * justified line. With the evidenced Aptos advance calibration applied, the
 * reviewed Word oracle accepts 27.24% compression and wraps at 29.11%.
 */
const MAX_JUSTIFIED_SPACE_COMPRESSION_RATIO = 0.275;
/** Word's Helvetica line fitter wraps before the 25.58% compression observed in the Select Management oracle. */
const MAX_JUSTIFIED_SPACE_COMPRESSION_RATIO_BY_FAMILY = new Map<string, number>([['helvetica', 0.25]]);
/** Tiny space adjustments do not need the larger-candidate fit guard. */
const MINOR_JUSTIFIED_SPACE_COMPRESSION_RATIO = 0.14;
const MAX_MINOR_CANDIDATE_OVERFLOW_RATIO = 0.6;
/** Beyond micro-compression, Word normally requires at least 56% of the candidate to fit naturally. */
const MAX_JUSTIFIED_CANDIDATE_OVERFLOW_RATIO = 0.44;
/** Borderline candidates remain eligible only when their total overflow is also tightly bounded. */
const MAX_BORDERLINE_CANDIDATE_OVERFLOW_RATIO = 0.46;
const MAX_BORDERLINE_OVERFLOW_SPACE_EQUIVALENTS = 3.65;
/** Word's evidenced Helvetica fitter allows a larger candidate fraction only for micro-compression. */
const MAX_HELVETICA_MINOR_CANDIDATE_OVERFLOW_RATIO = 0.4;
const MAX_HELVETICA_CANDIDATE_OVERFLOW_RATIO = 0.3;

function fitsWordJustificationCompression(
  overflow: number,
  candidateWidth: number,
  spaceCount: number,
  baseSpaceWidth: number,
  fontFamily?: string,
  useTightHelveticaCandidateFit = false,
): boolean {
  if (overflow <= 0 || candidateWidth <= 0 || spaceCount <= 0 || baseSpaceWidth <= 0) return false;
  const perSpaceCompressionRatio = overflow / spaceCount / baseSpaceWidth;
  const candidateOverflowRatio = overflow / candidateWidth;
  const primaryFamily = fontFamily
    ?.split(',')[0]
    ?.trim()
    .replace(/^['"]|['"]$/g, '')
    .toLowerCase();
  const maxMinorCandidateOverflowRatio =
    primaryFamily === 'helvetica' && useTightHelveticaCandidateFit
      ? MAX_HELVETICA_MINOR_CANDIDATE_OVERFLOW_RATIO
      : MAX_MINOR_CANDIDATE_OVERFLOW_RATIO;
  if (
    perSpaceCompressionRatio <= MINOR_JUSTIFIED_SPACE_COMPRESSION_RATIO &&
    candidateOverflowRatio <= maxMinorCandidateOverflowRatio
  ) {
    return true;
  }
  const maxSpaceCompressionRatio = primaryFamily
    ? (MAX_JUSTIFIED_SPACE_COMPRESSION_RATIO_BY_FAMILY.get(primaryFamily) ?? MAX_JUSTIFIED_SPACE_COMPRESSION_RATIO)
    : MAX_JUSTIFIED_SPACE_COMPRESSION_RATIO;
  if (perSpaceCompressionRatio > maxSpaceCompressionRatio) return false;
  if (primaryFamily === 'helvetica' && useTightHelveticaCandidateFit) {
    return candidateOverflowRatio <= MAX_HELVETICA_CANDIDATE_OVERFLOW_RATIO;
  }
  return (
    candidateOverflowRatio <= MAX_JUSTIFIED_CANDIDATE_OVERFLOW_RATIO ||
    (candidateOverflowRatio <= MAX_BORDERLINE_CANDIDATE_OVERFLOW_RATIO &&
      overflow / baseSpaceWidth <= MAX_BORDERLINE_OVERFLOW_SPACE_EQUIVALENTS)
  );
}

/**
 * Counts non-breaking space (U+00A0) characters within a substring committed to a
 * line, so justify (`Line.spaceCount`) treats NBSP as a stretch/compress point the
 * same way CSS `word-spacing` does at paint time (confirmed empirically across
 * Chromium/Firefox/WebKit to affect NBSP identically to a literal space).
 *
 * Only NBSP needs counting here: word tokens produced by `segment.split(' ')`
 * can never contain a literal U+0020 (every one was already extracted as a token
 * boundary), so U+0020 inside a `word`/`chunk.text` substring is impossible by
 * construction.
 */
function countNbspOccurrences(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\u00A0') count += 1;
  }
  return count;
}

/**
 * Calculate typography metrics for a given font size.
 *
 * This function computes the ascent, descent, and line height values needed for text layout.
 *
 * **Ascent/Descent Calculation:**
 * When fontInfo is provided, uses actual Canvas TextMetrics API to get precise
 * ascent/descent values from actualBoundingBoxAscent/Descent. This prevents
 * text clipping that occurs when using hardcoded approximations (0.8/0.2 ratios)
 * which don't account for font-specific glyph heights.
 *
 * Falls back to approximations (0.8/0.2) only when:
 * - fontInfo is not provided (empty paragraphs)
 * - Browser doesn't support actualBoundingBox* metrics (legacy browsers)
 *
 * **Line Height Calculation:**
 * Uses the frozen-main fallback baseline of fontSize × 1.15 only when a
 * paragraph has no explicit line spacing. Explicit multipliers coming from
 * projected OOXML spacing are honored as-is, while `atLeast` spacing still
 * clamps against that baseline.
 *
 * @param fontSize - The font size in pixels
 * @param spacing - Optional paragraph spacing configuration (lineRule, line value)
 * @param fontInfo - Optional font information for precise Canvas-based measurements
 * @returns Object containing ascent, descent, and lineHeight in pixels
 *
 * @example
 * // Basic usage with 16px font
 * const metrics = calculateTypographyMetrics(16);
 * // Returns: { ascent: ~12.8, descent: ~3.2, lineHeight: 18.4 }
 *
 * @example
 * // With an explicit 1.5 line spacing multiplier
 * const metrics = calculateTypographyMetrics(16, { line: 1.5, lineRule: 'auto' });
 * // Returns: { ascent: ~12.8, descent: ~3.2, lineHeight: 24 } // 16 × 1.5
 *
 * @example
 * // With exact line height override
 * const metrics = calculateTypographyMetrics(16, { line: 24, lineRule: 'exact' });
 * // Returns: { ascent: ~12.8, descent: ~3.2, lineHeight: 24 }
 */
function calculateTypographyMetrics(
  fontSize: number,
  spacing?: ParagraphSpacing,
  fontInfo?: FontInfo,
  fontContext?: FontMeasureContext,
): {
  ascent: number;
  descent: number;
  lineHeight: number;
} {
  const resolvedFontSize = normalizeFontSize(fontSize);
  let ascent: number;
  let descent: number;
  let naturalSingleLine: number | undefined;

  if (
    fontInfo &&
    isValidFontSize(fontInfo.fontSize) &&
    typeof fontInfo.fontFamily === 'string' &&
    fontInfo.fontFamily.trim().length > 0
  ) {
    // Use actual font metrics from Canvas API for accurate measurements
    const ctx = getCanvasContext(fontContext);
    const metrics = measuredFontMetrics(ctx, fontInfo);
    ascent = roundValue(metrics.ascent);
    descent = roundValue(metrics.descent);
    naturalSingleLine = metrics.naturalSingleLine;
  } else {
    // Fallback approximations for empty paragraphs or missing font info
    ascent = roundValue(resolvedFontSize * 0.8);
    descent = roundValue(resolvedFontSize * 0.2);
  }

  const lineHeight = resolveLineHeight(spacing, fontSize, naturalSingleLine ?? ascent + descent);

  return {
    ascent,
    descent,
    lineHeight,
  };
}

/**
 * Wraps `calculateTypographyMetrics` and applies inline-image height override.
 *
 * Typography metrics (ascent, descent) stay text-based so the baseline doesn't
 * shift. When the line contains an inline image taller than the text line height,
 * lineHeight is expanded to the image height — matching Word's behaviour where
 * the text baseline stays fixed and the image occupies exactly its own height.
 */
function finalizeLineMetrics(
  line: {
    maxFontSize: number;
    maxFontInfo?: FontInfo;
    fontMetricEnvelope?: FontLineMetricEnvelope;
    maxImageHeight?: number;
    structuralFallbackFontSize?: number;
    structuralFallbackFontInfo?: FontInfo;
  },
  spacing?: ParagraphSpacing,
  fontContext?: FontMeasureContext,
  emptyParagraphLineMetrics?: MeasureConstraints['emptyParagraphLineMetrics'],
): { ascent: number; descent: number; lineHeight: number; textLineHeight: number } {
  const metricFontSize =
    line.maxFontSize > 0 ? line.maxFontSize : (line.structuralFallbackFontSize ?? line.maxFontSize);
  const metricFontInfo =
    line.maxFontSize > 0 ? line.maxFontInfo : (line.structuralFallbackFontInfo ?? line.maxFontInfo);
  const metrics =
    line.maxFontSize > 0
      ? calculateTypographyMetrics(metricFontSize, spacing, metricFontInfo, fontContext)
      : calculateEmptyParagraphMetrics(metricFontSize, spacing, metricFontInfo, fontContext, emptyParagraphLineMetrics);
  if (line.maxFontSize > 0 && line.fontMetricEnvelope) {
    metrics.ascent = Math.max(metrics.ascent, line.fontMetricEnvelope.glyphAscent);
    metrics.descent = Math.max(metrics.descent, line.fontMetricEnvelope.glyphDescent);
    metrics.lineHeight = resolveLineHeight(spacing, metricFontSize, composedNaturalLineHeight(line.fontMetricEnvelope));
  }
  // Capture the text-derived line height BEFORE the inline-image expansion so the
  // glyph-vs-line-expanding decision can compare each image against the text box.
  const textLineHeight = metrics.lineHeight;
  const imageH = line.maxImageHeight ?? 0;
  if (imageH > metrics.lineHeight) {
    metrics.lineHeight = imageH;
  }
  return { ...metrics, textLineHeight };
}

/**
 * Tolerance (px) for the "image fits inside the text line box" decision.
 *
 * Canvas-derived text metrics and projected image heights both carry sub-pixel
 * rounding, so an image essentially equal to the text line height should still
 * be treated as a glyph. Kept small so a genuinely taller, line-expanding image
 * stays `top`. The exact Word equality boundary is verified with a generated
 * fixture; see the inline-image glyph baseline alignment plan.
 */
const INLINE_IMAGE_BASELINE_TOLERANCE_PX = 0.5;

/** One inline-image candidate tracked on the current line for alignment resolution. */
type InlineImageCandidate = {
  /** Index into `runsToProcess` (remapped to block.runs space with the line at the end). */
  runIndex: number;
  /** Image width including authored horizontal spacing (distLeft + distRight). */
  imageWidth: number;
  /** Image height including authored vertical spacing (distTop + distBottom). */
  imageHeight: number;
  /** True when the source run carries an explicit `verticalAlign`. */
  hasExplicitVerticalAlign: boolean;
  /** True when the image has authored vertical margins to preserve as line spacing. */
  hasVerticalMargins: boolean;
};

/**
 * Inline DrawingML rotation changes the visual line box even though the source
 * `wp:extent` remains unrotated. Keep this calculation shared with drawing
 * measurement so line breaking and paint use the same axis-aligned bounds.
 */
function resolveInlineImageVisualSize(run: ImageRun): { width: number; height: number } {
  return calculateRotatedBounds({
    width: run.width,
    height: run.height,
    rotation: run.rotation,
    flipH: run.flipH,
    flipV: run.flipV,
  });
}

/** Build an inline-image alignment candidate from an image run on the current line. */
function makeInlineImageCandidate(
  runIndex: number,
  run: ImageRun,
  imageWidth: number,
  imageHeight: number,
): InlineImageCandidate {
  return {
    runIndex,
    imageWidth,
    imageHeight,
    hasExplicitVerticalAlign: run.verticalAlign != null,
    hasVerticalMargins: (run.distTop ?? 0) !== 0 || (run.distBottom ?? 0) !== 0,
  };
}

/**
 * Resolve measured per-image vertical alignment for one completed line.
 *
 * An inline image is treated as a baseline-aligned glyph only when it fits
 * inside the text-derived line box and the line has real text to align to.
 * Line-expanding images, images with authored vertical margins, and images on
 * text-less lines keep the legacy `top` default (no entry emitted). Images with
 * an explicit source `verticalAlign` are owned by the source and skipped here.
 */
function resolveInlineImageAlignments(
  candidates: InlineImageCandidate[] | undefined,
  hasVisibleText: boolean,
  textLineHeight: number,
): LineInlineImageAlignment[] | undefined {
  if (!candidates || candidates.length === 0) return undefined;
  const alignments: LineInlineImageAlignment[] = [];
  for (const candidate of candidates) {
    if (candidate.hasExplicitVerticalAlign) continue;
    if (candidate.imageWidth <= 0) continue;
    if (candidate.imageHeight <= 0) continue;
    if (!hasVisibleText) continue;
    if (candidate.hasVerticalMargins) continue;
    if (candidate.imageHeight > textLineHeight + INLINE_IMAGE_BASELINE_TOLERANCE_PX) continue;
    alignments.push({ runIndex: candidate.runIndex, verticalAlign: 'baseline' });
  }
  return alignments.length > 0 ? alignments : undefined;
}

/**
 * Calculates typography metrics for empty paragraphs.
 *
 * Empty paragraphs in Word use the font size as the base line height rather than
 * the standard 1.15x fallback baseline used for populated paragraphs. This matches
 * Word's behavior where empty paragraphs appear shorter than their populated counterparts.
 *
 * @param fontSize - The font size in pixels
 * @param spacing - Optional paragraph spacing configuration (may override line height)
 * @param fontInfo - Optional font information for precise metric calculation
 * @returns Object containing ascent, descent, and lineHeight in pixels
 *
 * @example
 * ```typescript
 * // Empty paragraph with 12pt font
 * calculateEmptyParagraphMetrics(16); // { ascent: 12.8, descent: 3.2, lineHeight: 16 }
 *
 * // Compare to regular text which would use 16 * 1.15 = 18.4 for lineHeight
 * ```
 */
function calculateEmptyParagraphMetrics(
  fontSize: number,
  spacing?: ParagraphSpacing,
  fontInfo?: FontInfo,
  fontContext?: FontMeasureContext,
  emptyParagraphLineMetrics?: MeasureConstraints['emptyParagraphLineMetrics'],
): {
  ascent: number;
  descent: number;
  lineHeight: number;
} {
  const resolvedFontSize = normalizeFontSize(fontSize);
  let ascent: number;
  let descent: number;
  let naturalSingleLine: number | undefined;

  if (
    fontInfo &&
    isValidFontSize(fontInfo.fontSize) &&
    typeof fontInfo.fontFamily === 'string' &&
    fontInfo.fontFamily.trim().length > 0
  ) {
    const ctx = getCanvasContext(fontContext);
    const metrics = measuredFontMetrics(ctx, {
      ...fontInfo,
      wordLineMetricFamily: undefined,
      naturalLineMultiplier: undefined,
    });
    ascent = roundValue(metrics.ascent);
    descent = roundValue(metrics.descent);
    naturalSingleLine = metrics.naturalSingleLine;
  } else {
    ascent = roundValue(resolvedFontSize * 0.8);
    descent = roundValue(resolvedFontSize * 0.2);
  }

  const bodyNaturalLine =
    emptyParagraphLineMetrics === 'body' && fontInfo
      ? getCalibratedBodyEmptyLine(fontInfo.fontFamily, fontInfo.fontSize)
      : undefined;
  const maxLineHeight = Math.max(resolvedFontSize, bodyNaturalLine ?? naturalSingleLine ?? ascent + descent);
  // Word treats empty paragraphs as a single font-sized line unless line spacing is explicitly set.
  const lineHeight =
    !spacing || spacing.line == null
      ? roundValue(maxLineHeight)
      : roundValue(resolveLineHeight(spacing, resolvedFontSize, maxLineHeight));

  return {
    ascent,
    descent,
    lineHeight,
  };
}

function lineHeightFontSize(run: TextRun): number {
  return resolveBaseFontSizeForVerticalText(run.fontSize, run);
}

/**
 * Extract FontInfo from a TextRun for typography metrics calculation.
 * Uses the line-height font size so that superscript/subscript runs
 * produce metrics based on their original (un-scaled) base font.
 *
 * Resolves to the PHYSICAL render family (via `fontContext.resolvePhysical`) the same way
 * {@link buildFontString} does, so vertical metrics (ascent/descent from `getFontMetrics`)
 * are taken against the same font that width measurement uses - never the logical family,
 * which may have no loaded face and would yield fallback metrics.
 */
function getFontInfoFromRun(run: TextRun, fontContext: FontMeasureContext, resolvedPhysicalFamily?: string): FontInfo {
  const face = faceOf(run);
  return {
    fontFamily: normalizeFontFamily(resolvedPhysicalFamily ?? fontContext.resolvePhysical(run.fontFamily, face)),
    wordLineMetricFamily: run.fontFamily,
    naturalLineMultiplier: fontContext.resolveNaturalLineMultiplier?.(
      run.fontFamily,
      face,
      typeof run.text === 'string' ? run.text : '',
    ),
    fontSize: normalizeFontSize(lineHeightFontSize(run)),
    bold: run.bold,
    italic: run.italic,
  };
}

type MutableLineFontMetricState = {
  maxFontSize: number;
  maxFontInfo?: FontInfo;
  fontMetricEnvelope?: FontLineMetricEnvelope;
};

function addFontInfoToLineMetricEnvelope(
  line: MutableLineFontMetricState,
  fontInfo: FontInfo,
  fontContext: FontMeasureContext,
): void {
  const metrics = measuredFontMetrics(getCanvasContext(fontContext), fontInfo);
  const glyphHeight = metrics.ascent + metrics.descent;
  const naturalLineHeight = Math.max(
    metrics.naturalSingleLine ?? glyphHeight,
    V1_DEFAULT_PARAGRAPH_LINE_HEIGHT_MULTIPLIER * fontInfo.fontSize,
  );
  line.fontMetricEnvelope = extendFontLineMetricEnvelope(line.fontMetricEnvelope, {
    ascent: metrics.ascent,
    descent: metrics.descent,
    naturalLineHeight,
  });
}

/** Include one rendered face in the line's shared Word baseline envelope. */
function updateLineFontMetrics(
  line: MutableLineFontMetricState,
  newRun: TextRun,
  fontContext: FontMeasureContext,
  resolvedFontInfo?: FontInfo,
): void {
  if (!line.fontMetricEnvelope && line.maxFontInfo) {
    addFontInfoToLineMetricEnvelope(line, line.maxFontInfo, fontContext);
  }
  const newFontInfo = resolvedFontInfo ?? getFontInfoFromRun(newRun, fontContext);
  addFontInfoToLineMetricEnvelope(line, newFontInfo, fontContext);
  const newFontSize = lineHeightFontSize(newRun);
  if (newFontSize > line.maxFontSize || !line.maxFontInfo) {
    line.maxFontInfo = newFontInfo;
  }
  line.maxFontSize = Math.max(line.maxFontSize, newFontSize);
}

/**
 * Type guard to check if a run is a text run (kind is optional and defaults to 'text').
 */
function isTextRun(run: Run): run is TextRun {
  return run.kind === 'text' || run.kind === undefined;
}

const inlineBoxInlineStart = (box: InlineBoxSpan, startsRange: boolean): number =>
  box.layout.paddingInlineStart + box.layout.borderWidth + (startsRange ? box.layout.gapBefore : 0);

const inlineBoxInlineEnd = (box: InlineBoxSpan, endsRange: boolean): number =>
  box.layout.paddingInlineEnd + box.layout.borderWidth + (endsRange ? box.layout.gapAfter : 0);

const paragraphRunVisibleStarts = (block: ParagraphBlock): number[] => {
  const starts: number[] = [];
  let offset = 0;
  for (const run of block.runs) {
    starts.push(offset);
    offset += isTextRun(run) ? run.text.length : 1;
  }
  return starts;
};

const inlineBoxLineBudgets = (block: ParagraphBlock, lines: Line[], boxes: InlineBoxSpan[]): number[] => {
  const runStarts = paragraphRunVisibleStarts(block);
  return lines.map((line) => {
    const lineStart = (runStarts[line.fromRun] ?? 0) + line.fromChar;
    const lineEnd = (runStarts[line.toRun] ?? 0) + line.toChar;
    return boxes.reduce((budget, box) => {
      if (box.from >= lineEnd || box.to <= lineStart) return budget;
      return budget + inlineBoxInlineStart(box, box.from >= lineStart) + inlineBoxInlineEnd(box, box.to <= lineEnd);
    }, 0);
  });
};

const sameLineRanges = (first: Line[], second: Line[]): boolean =>
  first.length === second.length &&
  first.every(
    (line, index) =>
      line.fromRun === second[index]?.fromRun &&
      line.fromChar === second[index]?.fromChar &&
      line.toRun === second[index]?.toRun &&
      line.toChar === second[index]?.toChar,
  );

const visibleLineRange = (block: ParagraphBlock, line: Line): { from: number; to: number } => {
  const runStarts = paragraphRunVisibleStarts(block);
  return {
    from: (runStarts[line.fromRun] ?? 0) + line.fromChar,
    to: (runStarts[line.toRun] ?? 0) + line.toChar,
  };
};

const lineIndexAtVisibleOffset = (block: ParagraphBlock, lines: Line[], offset: number): number => {
  for (let index = 0; index < lines.length; index += 1) {
    const range = visibleLineRange(block, lines[index]!);
    if (offset >= range.from && offset < range.to) return index;
  }
  return Math.max(0, lines.length - 1);
};

const measuredWidthToVisibleOffset = (line: Line, runStarts: number[], visibleOffset: number): number => {
  let width = 0;
  for (const segment of line.segments ?? []) {
    const segmentX = segment.x ?? width;
    const segmentStart = (runStarts[segment.runIndex] ?? 0) + segment.fromChar;
    const segmentEnd = (runStarts[segment.runIndex] ?? 0) + segment.toChar;
    if (visibleOffset >= segmentEnd) {
      width = segmentX + segment.width;
      continue;
    }
    if (visibleOffset > segmentStart && segmentEnd > segmentStart) {
      width = segmentX + segment.width * ((visibleOffset - segmentStart) / (segmentEnd - segmentStart));
    } else if (visibleOffset === segmentStart) {
      width = segmentX;
    }
    break;
  }
  return width;
};

const splitSegmentsAtInlineBoxEdges = (
  block: ParagraphBlock,
  line: Line,
  runStarts: number[],
  boxes: InlineBoxSpan[],
  ctx: CanvasRenderingContext2D,
  fontContext: FontMeasureContext,
): void => {
  if (!line.segments?.length) return;
  const splitSegments: NonNullable<Line['segments']> = [];
  for (const segment of line.segments) {
    const runStart = runStarts[segment.runIndex] ?? 0;
    const segmentStart = runStart + segment.fromChar;
    const segmentEnd = runStart + segment.toChar;
    const boundaryBefore = boxes.some((box) => box.from === segmentStart || box.to === segmentStart);
    const boundaries = boxes
      .flatMap((box) => [box.from, box.to])
      .filter((boundary) => boundary > segmentStart && boundary < segmentEnd)
      .sort((a, b) => a - b);
    if (boundaries.length === 0) {
      appendSegment(
        splitSegments,
        segment.runIndex,
        segment.fromChar,
        segment.toChar,
        segment.width,
        segment.x,
        segment.precedingTabEndX,
        boundaryBefore,
      );
      continue;
    }

    const offsets = [segmentStart, ...new Set(boundaries), segmentEnd];
    const segmentLength = segmentEnd - segmentStart;
    const run = block.runs[segment.runIndex];
    offsets.slice(0, -1).forEach((from, index) => {
      const to = offsets[index + 1]!;
      const runFrom = from - runStart;
      const runTo = to - runStart;
      const width =
        run && isTextRun(run)
          ? measureRunWidth(run.text.slice(runFrom, runTo), buildFontString(run, fontContext).font, ctx, run, runFrom)
          : segmentLength > 0
            ? segment.width * ((to - from) / segmentLength)
            : 0;
      appendSegment(
        splitSegments,
        segment.runIndex,
        runFrom,
        runTo,
        width,
        index === 0 ? segment.x : undefined,
        index === 0 ? segment.precedingTabEndX : undefined,
        boundaryBefore || index > 0,
      );
    });
  }
  line.segments = splitSegments;
};

/** Applies paint-ready geometry after the canonical breaker has reserved box edges. */
const applyInlineBoxes = (
  block: ParagraphBlock,
  measure: ParagraphMeasure,
  boxes: InlineBoxSpan[],
  measuredAtMaxWidth: number,
  fontContext: FontMeasureContext,
): ParagraphMeasure => {
  const runStarts = paragraphRunVisibleStarts(block);
  const ctx = getCanvasContext(fontContext);

  for (const line of measure.lines) {
    const lineStart = (runStarts[line.fromRun] ?? 0) + line.fromChar;
    const lineEnd = (runStarts[line.toRun] ?? 0) + line.toChar;
    const slices = boxes.filter((box) => box.from < lineEnd && box.to > lineStart).sort((a, b) => a.from - b.from);
    if (slices.length === 0) {
      line.maxWidth = measuredAtMaxWidth;
      continue;
    }

    splitSegmentsAtInlineBoxEdges(block, line, runStarts, slices, ctx, fontContext);
    let precedingInlineAdvance = 0;
    let blockExpansion = 0;
    const inlineBoxes: LineInlineBox[] = [];
    for (const box of slices) {
      const sliceStart = Math.max(box.from, lineStart);
      const sliceEnd = Math.min(box.to, lineEnd);
      const startsRange = sliceStart === box.from;
      const endsRange = sliceEnd === box.to;
      const leadingAdvance = inlineBoxInlineStart(box, startsRange);
      const trailingAdvance = inlineBoxInlineEnd(box, endsRange);
      const leadingGap = startsRange ? box.layout.gapBefore : 0;
      const textStartX = measuredWidthToVisibleOffset(line, runStarts, sliceStart);
      const textEndX = measuredWidthToVisibleOffset(line, runStarts, sliceEnd);
      const boxWidth =
        box.layout.paddingInlineStart +
        box.layout.borderWidth +
        (textEndX - textStartX) +
        box.layout.paddingInlineEnd +
        box.layout.borderWidth;
      const verticalExpansion = box.layout.paddingBlockStart + box.layout.paddingBlockEnd + box.layout.borderWidth * 2;
      blockExpansion = Math.max(blockExpansion, verticalExpansion);
      inlineBoxes.push({
        id: box.id,
        from: sliceStart - lineStart,
        to: sliceEnd - lineStart,
        x: textStartX + precedingInlineAdvance + leadingGap,
        width: boxWidth,
        top: 0,
        height: line.lineHeight + verticalExpansion,
        startsRange,
        endsRange,
        style: { ...box.layout, ...box.appearance },
        ...(box.className ? { className: box.className } : {}),
        ...(box.data ? { data: { ...box.data } } : {}),
        ...(box.cursor ? { cursor: box.cursor } : {}),
      });
      precedingInlineAdvance += leadingAdvance + trailingAdvance;
    }
    line.inlineBoxes = inlineBoxes;
    line.width += precedingInlineAdvance;
    line.lineHeight += blockExpansion;
    line.maxWidth = measuredAtMaxWidth;
  }

  measure.totalHeight = measure.lines.reduce((sum, line) => sum + line.lineHeight, 0);
  measure.measuredAtMaxWidth = measuredAtMaxWidth;
  return measure;
};

/**
 * Type guard to check if a run is a tab run
 */
function isTabRun(run: Run): run is TabRun {
  return run.kind === 'tab';
}

function isVanishedRun(run: Run): boolean {
  return 'vanish' in run && run.vanish === true;
}

/**
 * Type guard to check if a run is an image run
 */
function isImageRun(run: Run): run is ImageRun {
  return run.kind === 'image';
}

/**
 * Type guard to check if a run is an explicit line break run
 */
function isLineBreakRun(run: Run): run is LineBreakRun {
  return run.kind === 'lineBreak';
}

/**
 * Type guard to check if a run is an empty text run.
 *
 * An empty text run is a text run (no kind or kind === 'text') with an empty string.
 * This is used to identify empty paragraph placeholders that need special handling
 * for line height calculations.
 *
 * @param run - The run to check
 * @returns True if the run is a text run with empty text
 */
const isEmptyTextRun = (run: Run): run is TextRun => {
  if (run.kind && run.kind !== 'text') return false;
  return typeof (run as TextRun).text === 'string' && (run as TextRun).text.length === 0;
};

// The predicate type must be narrower than TextRun (the marker attribute is required here but
// optional on TextRun) so that a failed check does not remove TextRun from the union entirely,
// which would collapse later narrowing to `never`. Same pattern as isEmptySdtPlaceholderRun in
// contracts/run-helpers.
const isBookmarkMarkerRun = (run: Run): run is TextRun & { dataAttrs: Record<string, string> } => {
  if (run.kind && run.kind !== 'text') return false;
  return typeof (run as TextRun).dataAttrs?.['data-bookmark-marker'] === 'string';
};

/**
 * Type guard to check if a run is a field annotation run
 */
function isFieldAnnotationRun(run: Run): run is FieldAnnotationRun {
  return run.kind === 'fieldAnnotation';
}

const normalizeRunsForMeasurement = (runs: Run[], fallbackFontSize: number, fallbackFontFamily: string): Run[] =>
  runs.map((run) => {
    if (isTabRun(run) && !Object.isExtensible(run)) return { ...run };
    if (run.kind && run.kind !== 'text') return run;
    if (!('text' in run)) return run;
    const textRun = run as TextRun;
    const fontSize = normalizeFontSize(textRun.fontSize, fallbackFontSize);
    const fontFamily = normalizeFontFamily(textRun.fontFamily, fallbackFontFamily);
    if (fontSize === textRun.fontSize && fontFamily === textRun.fontFamily) return run;
    return { ...textRun, fontSize, fontFamily };
  });

/**
 * Information about a single run in a tab alignment group.
 * Used for positioning content after right/center/decimal aligned tabs.
 */
type TabAlignmentGroupRun = {
  runIndex: number;
  width: number;
  /** For text runs, the full text content */
  text?: string;
  /** For decimal alignment, width of text before the decimal separator */
  beforeDecimalWidth?: number;
};

/**
 * Result of measuring content following a tab stop for alignment purposes.
 */
type TabAlignmentGroupMeasure = {
  /** Total width of all content in the group */
  totalWidth: number;
  /** Individual run measurements */
  runs: TabAlignmentGroupRun[];
  /** Index of the last run in the group (exclusive - next run to process after group) */
  endRunIndex: number;
  /** For decimal alignment, the width before the decimal point (from first run containing decimal) */
  beforeDecimalWidth?: number;
};

/**
 * Measures all content following a tab stop until the next tab or end of paragraph.
 *
 * This function implements "look-ahead" measurement for non-start tab alignments (end, center, decimal).
 * Microsoft Word treats all content from a tab to the next tab/EOL as a single unit for alignment:
 * - End (right) tabs: position the group so its right edge aligns at the tab stop
 * - Center tabs: position the group so its center aligns at the tab stop
 * - Decimal tabs: position the group so the decimal point aligns at the tab stop
 *
 * @param startRunIndex - Index of the first run after the tab (where content begins)
 * @param runs - Array of all runs in the paragraph
 * @param ctx - Canvas 2D context for text measurement
 * @param decimalSeparator - Character used as decimal point (for decimal tab alignment)
 * @returns Measurement info including total width and per-run widths
 */
function measureTabAlignmentGroup(
  startRunIndex: number,
  runs: Run[],
  ctx: CanvasRenderingContext2D,
  decimalSeparator: string = '.',
  fontContext: FontMeasureContext,
): TabAlignmentGroupMeasure {
  const result: TabAlignmentGroupMeasure = {
    totalWidth: 0,
    runs: [],
    endRunIndex: runs.length,
  };

  let foundDecimal = false;

  for (let i = startRunIndex; i < runs.length; i++) {
    const run = runs[i];

    // Stop at the next tab - it marks the end of this alignment group
    if (isTabRun(run)) {
      if (isVanishedRun(run)) {
        continue;
      }
      result.endRunIndex = i;
      break;
    }

    // Stop at line breaks - they end the alignment group
    if (isLineBreakRun(run) || (run.kind === 'break' && (run as { breakType?: string }).breakType === 'line')) {
      result.endRunIndex = i;
      break;
    }

    // Measure text runs
    if (run.kind === 'text' || run.kind === undefined) {
      const textRun = run as TextRun;
      if (textRun.vanish === true) {
        continue;
      }
      const text = textRun.text || '';

      if (text.length > 0) {
        const { font } = buildFontString(textRun, fontContext);
        const width = measureRunWidth(text, font, ctx, textRun, 0);

        // For decimal alignment, find the decimal position
        let beforeDecimalWidth: number | undefined;
        if (!foundDecimal) {
          const decimalIdx = text.indexOf(decimalSeparator);
          if (decimalIdx >= 0) {
            foundDecimal = true;
            const beforeText = text.slice(0, decimalIdx);
            beforeDecimalWidth = beforeText.length > 0 ? measureRunWidth(beforeText, font, ctx, textRun, 0) : 0;
            // Store the cumulative width before decimal (including previous runs)
            result.beforeDecimalWidth = result.totalWidth + beforeDecimalWidth;
          }
        }

        result.runs.push({
          runIndex: i,
          width,
          text,
          beforeDecimalWidth,
        });
        result.totalWidth += width;
      } else {
        // Empty text run - still track it but with zero width
        result.runs.push({ runIndex: i, width: 0, text: '' });
      }
      continue;
    }

    // Measure image runs
    if (isImageRun(run)) {
      const visualSize = resolveInlineImageVisualSize(run);
      const leftSpace = run.distLeft ?? 0;
      const rightSpace = run.distRight ?? 0;
      const imageWidth = visualSize.width + leftSpace + rightSpace;

      result.runs.push({ runIndex: i, width: imageWidth });
      result.totalWidth += imageWidth;
      continue;
    }

    // Measure math runs (atomic, pre-computed dimensions like images)
    if (run.kind === 'math') {
      const mathWidth = (run as { width: number }).width ?? 20;
      result.runs.push({ runIndex: i, width: mathWidth });
      result.totalWidth += mathWidth;
      continue;
    }

    // Measure field annotation runs
    if (isFieldAnnotationRun(run)) {
      const fontSize = (run as { fontSize?: number }).fontSize ?? DEFAULT_FIELD_ANNOTATION_FONT_SIZE;
      const { font } = buildFontString(
        {
          fontFamily: (run as { fontFamily?: string }).fontFamily ?? 'Arial',
          fontSize,
          bold: (run as { bold?: boolean }).bold,
          italic: (run as { italic?: boolean }).italic,
        },
        fontContext,
      );
      const textWidth = run.displayLabel ? measureRunWidth(run.displayLabel, font, ctx, run, 0) : 0;
      const pillWidth = textWidth + FIELD_ANNOTATION_PILL_PADDING;

      result.runs.push({ runIndex: i, width: pillWidth });
      result.totalWidth += pillWidth;
      continue;
    }

    // For other run types (break types we didn't catch, etc.), include with zero width
    // but they likely shouldn't appear in the middle of alignment groups
    result.runs.push({ runIndex: i, width: 0 });
  }

  return result;
}

const V2_RENDER_DIAGNOSTIC_MEASUREMENT_OWNER = Symbol.for('superdoc.v2.render-diagnostic.measurement-owner');
const offeredMeasurementFailures = new WeakSet<object>();

/**
 * Measure a single FlowBlock and calculate line breaks.
 *
 * Performs greedy line breaking: accumulates text width until exceeding maxWidth,
 * then starts a new line. Breaks on word boundaries when possible.
 *
 * @param block - The FlowBlock to measure (contains runs with text and styling)
 * @param maxWidth - Maximum width for each line in pixels
 * @returns Measure with lines array and total height
 *
 * @example
 * ```typescript
 * const block: FlowBlock = {
 *   id: "0-paragraph",
 *   runs: [
 *     { text: "Hello world", fontFamily: "Arial", fontSize: 16 }
 *   ],
 *   attrs: {}
 * };
 *
 * const measure = await measureBlock(block, 200);
 * // Result: { lines: [...], totalHeight: 19.2 }
 * ```
 */
export async function measureBlock(
  block: FlowBlock,
  constraints: number | MeasureConstraints,
  fontContext: FontMeasureContext = DEFAULT_FONT_MEASURE_CONTEXT,
): Promise<Measure> {
  const entryCheckpoint = measurementCheckpointIfDue(fontContext);
  if (entryCheckpoint) await entryCheckpoint;
  const normalized = normalizeConstraints(constraints);
  const renderDiagnosticOwner =
    typeof constraints === 'object' && constraints != null
      ? (constraints as Record<PropertyKey, unknown>)[V2_RENDER_DIAGNOSTIC_MEASUREMENT_OWNER]
      : undefined;
  try {
    if (block.kind === 'drawing') {
      return await measureDrawingBlock(block as DrawingBlock, normalized, fontContext, renderDiagnosticOwner);
    }

    if (block.kind === 'image') {
      return await measureImageBlock(block, normalized);
    }

    if (block.kind === 'list') {
      return await measureListBlock(block, normalized, fontContext);
    }

    if (block.kind === 'table') {
      return await measureTableBlock(block, normalized, fontContext, renderDiagnosticOwner);
    }

    // Break blocks (sectionBreak, pageBreak, columnBreak) are pass-through measures
    // with no dimensions - they only signal layout control flow
    if (block.kind === 'sectionBreak') {
      return { kind: 'sectionBreak' };
    }
    if (block.kind === 'pageBreak') {
      return { kind: 'pageBreak' };
    }
    if (block.kind === 'columnBreak') {
      return { kind: 'columnBreak' };
    }

    // Paragraph/default
    return await measureParagraphBlock(
      block as ParagraphBlock,
      normalized.maxWidth,
      fontContext,
      undefined,
      normalized.emptyParagraphLineMetrics,
    );
  } catch (error) {
    if (typeof error === 'object' && error != null && offeredMeasurementFailures.has(error)) throw error;
    if (typeof renderDiagnosticOwner === 'function') {
      const owned = (renderDiagnosticOwner as (blockId: string, error: unknown) => unknown)(block.id, error);
      if (owned !== undefined) {
        if (owned !== error && typeof owned === 'object' && owned != null) {
          offeredMeasurementFailures.add(owned);
        }
        throw owned;
      }
    }
    throw error;
  }
}

async function measureParagraphBlock(
  block: ParagraphBlock,
  maxWidth: number,
  fontContext: FontMeasureContext,
  inlineLineBudgets?: readonly number[],
  emptyParagraphLineMetrics?: MeasureConstraints['emptyParagraphLineMetrics'],
): Promise<ParagraphMeasure> {
  const visibleTextLength = block.runs.reduce((length, run) => length + (isTextRun(run) ? run.text.length : 1), 0);
  /*
   * The range checks are the whole filter. Direction is deliberately not part
   * of it: box advances are widths, and a width does not depend on which way
   * the line runs. The two direction clauses that used to sit here existed
   * because `paintInlineBoxes` wrote physical left/right edges and therefore
   * could not render an RTL line; it now writes logical ones, so the guard has
   * nothing left to protect.
   *
   * Dropping them also removes an asymmetry rather than adding one. A logical
   * range that straddles a direction change maps to more than one visual
   * segment, and the painter's first/last-leaf edges cannot express that. The
   * clause removed here did not target that case: it keyed on the declaration
   * (`run.bidi?.rtl`), while the Unicode Bidi Algorithm reorders a Hebrew phrase
   * inside a Latin paragraph whether or not anything declares it. So the same
   * defect was already reachable, undeclared, and shipped. Keeping the clause
   * would have bought consistency with LTR, not correctness — while holding
   * uniform RTL, which has no such ambiguity, to a stricter standard than LTR.
   */
  const inlineBoxes = block.inlineBoxes?.filter(
    (box) =>
      Number.isFinite(box.from) &&
      Number.isFinite(box.to) &&
      box.from >= 0 &&
      box.to > box.from &&
      box.to <= visibleTextLength,
  );
  if (inlineBoxes?.length && inlineLineBudgets === undefined) {
    const unboxedBlock = { ...block, inlineBoxes: undefined };
    let baseMeasure = await measureParagraphBlock(unboxedBlock, maxWidth, fontContext, [], emptyParagraphLineMetrics);
    let reservedBudgets: number[] = [];

    // Boundary edges alter the line ranges that determine which continuation
    // edges exist. Re-run the canonical breaker until those ranges stabilize;
    // all of its independent fit branches then consume the same per-line
    // maxWidth through getEffectiveWidth.
    for (let pass = 0; pass < 8; pass += 1) {
      const candidateBudgets = inlineBoxLineBudgets(block, baseMeasure.lines, inlineBoxes);
      reservedBudgets = candidateBudgets.map((budget, index) => Math.max(budget, reservedBudgets[index] ?? 0));
      const nextMeasure = await measureParagraphBlock(
        unboxedBlock,
        maxWidth,
        fontContext,
        reservedBudgets,
        emptyParagraphLineMetrics,
      );
      if (sameLineRanges(baseMeasure.lines, nextMeasure.lines)) {
        baseMeasure = nextMeasure;
        break;
      }
      baseMeasure = nextMeasure;
    }

    // The monotonic edge budgets above guarantee termination, but a box that
    // moves forward can leave its old line over-reserved. Replacing them with
    // the final slice budgets directly would make that box jump backward and
    // create a two-state cycle. In that case, retain only the smallest guard
    // that preserves the boundary before the moved box. Box edge budgets still
    // belong exclusively to the lines that contain the final box slices.
    const finalEdgeBudgets = inlineBoxLineBudgets(block, baseMeasure.lines, inlineBoxes);
    const boundaryGuards: number[] = [];
    const targetLineIndices = inlineBoxes.map((box) => lineIndexAtVisibleOffset(block, baseMeasure.lines, box.from));
    const fitsInlineBoxBudgets = (measure: ParagraphMeasure, appliedBudgets: readonly number[]): boolean => {
      const edgeBudgets = inlineBoxLineBudgets(block, measure.lines, inlineBoxes);
      // line.maxWidth retains first-line, indent, and drop-cap reductions, but already
      // excludes the reservation used to measure that line. Add only that reservation back.
      return measure.lines.every(
        (line, index) =>
          line.width + (edgeBudgets[index] ?? 0) <= (line.maxWidth ?? maxWidth) + (appliedBudgets[index] ?? 0),
      );
    };
    const convergeCandidate = async (
      initialMeasure: ParagraphMeasure,
      guards: readonly number[],
    ): Promise<ParagraphMeasure | undefined> => {
      let candidate = initialMeasure;
      const seenLineRanges: Line[][] = [];

      for (let pass = 0; pass < 8; pass += 1) {
        if (seenLineRanges.some((lines) => sameLineRanges(lines, candidate.lines))) return undefined;
        seenLineRanges.push(candidate.lines);

        const edgeBudgets = inlineBoxLineBudgets(block, candidate.lines, inlineBoxes);
        const candidateBudgets = edgeBudgets.map((budget, index) => budget + (guards[index] ?? 0));
        const nextMeasure = await measureParagraphBlock(
          unboxedBlock,
          maxWidth,
          fontContext,
          candidateBudgets,
          emptyParagraphLineMetrics,
        );
        if (sameLineRanges(candidate.lines, nextMeasure.lines))
          return fitsInlineBoxBudgets(nextMeasure, candidateBudgets) ? nextMeasure : undefined;
        candidate = nextMeasure;
      }

      return undefined;
    };
    const preservesTargetLines = (measure: ParagraphMeasure): boolean =>
      inlineBoxes.every(
        (box, index) => lineIndexAtVisibleOffset(block, measure.lines, box.from) >= targetLineIndices[index]!,
      );
    let cleanedMeasure = await measureParagraphBlock(
      unboxedBlock,
      maxWidth,
      fontContext,
      finalEdgeBudgets,
      emptyParagraphLineMetrics,
    );

    for (const [boxIndex, box] of inlineBoxes.entries()) {
      const targetLineIndex = targetLineIndices[boxIndex]!;
      if (lineIndexAtVisibleOffset(block, cleanedMeasure.lines, box.from) >= targetLineIndex) continue;

      const guardLineIndex = Math.max(0, targetLineIndex - 1);
      let lowerGuard = boundaryGuards[guardLineIndex] ?? 0;
      let upperGuard = Math.max(
        lowerGuard,
        (reservedBudgets[guardLineIndex] ?? 0) - (finalEdgeBudgets[guardLineIndex] ?? 0),
      );
      let guardedMeasure = baseMeasure;

      for (let pass = 0; pass < 12; pass += 1) {
        const candidateGuard = (lowerGuard + upperGuard) / 2;
        const candidateBudgets = finalEdgeBudgets.map(
          (budget, index) => budget + (index === guardLineIndex ? candidateGuard : (boundaryGuards[index] ?? 0)),
        );
        const candidateMeasure = await measureParagraphBlock(
          unboxedBlock,
          maxWidth,
          fontContext,
          candidateBudgets,
          emptyParagraphLineMetrics,
        );
        const candidateGuards = [...boundaryGuards];
        candidateGuards[guardLineIndex] = candidateGuard;
        const convergedCandidate = await convergeCandidate(candidateMeasure, candidateGuards);
        if (convergedCandidate && preservesTargetLines(convergedCandidate)) {
          upperGuard = candidateGuard;
          guardedMeasure = convergedCandidate;
        } else {
          lowerGuard = candidateGuard;
        }
      }

      boundaryGuards[guardLineIndex] = upperGuard;
      cleanedMeasure = guardedMeasure;
    }

    const convergedCleanedMeasure = await convergeCandidate(cleanedMeasure, boundaryGuards);
    if (convergedCleanedMeasure && preservesTargetLines(convergedCleanedMeasure)) {
      cleanedMeasure = convergedCleanedMeasure;
    } else {
      // A stable range can still carry a word that was tested against the
      // preceding line's budget before wrapping. Fall back to the maximum edge
      // reservation that can occur if every box shares a line rather than
      // accepting an overflow or re-entering a boundary cycle. Lines before or
      // after those candidates must retain their ordinary paragraph width.
      const cleanedEdgeBudgets = inlineBoxLineBudgets(block, cleanedMeasure.lines, inlineBoxes);
      const maximumInlineBoxBudget = inlineBoxes.reduce(
        (budget, box) => budget + inlineBoxInlineStart(box, true) + inlineBoxInlineEnd(box, true),
        0,
      );
      let safeBudget = Math.max(maximumInlineBoxBudget, ...reservedBudgets, ...finalEdgeBudgets, ...cleanedEdgeBudgets);
      let fallbackMeasure = cleanedMeasure;
      let fallbackFits = false;
      const seenFallbackRanges: Line[][] = [];

      for (let pass = 0; pass < 8; pass += 1) {
        if (seenFallbackRanges.some((lines) => sameLineRanges(lines, fallbackMeasure.lines))) break;
        seenFallbackRanges.push(fallbackMeasure.lines);

        const observedEdgeBudgets = inlineBoxLineBudgets(block, fallbackMeasure.lines, inlineBoxes);
        safeBudget = Math.max(safeBudget, ...observedEdgeBudgets);
        const fallbackBudgets = observedEdgeBudgets.map((budget) => (budget > 0 ? safeBudget : 0));
        for (const box of inlineBoxes) {
          const boxLineIndex = lineIndexAtVisibleOffset(block, fallbackMeasure.lines, box.from);
          fallbackBudgets[Math.max(0, boxLineIndex - 1)] = safeBudget;
        }

        const nextMeasure = await measureParagraphBlock(
          unboxedBlock,
          maxWidth,
          fontContext,
          fallbackBudgets,
          emptyParagraphLineMetrics,
        );
        fallbackMeasure = nextMeasure;
        fallbackFits = fitsInlineBoxBudgets(nextMeasure, fallbackBudgets);
        if (fallbackFits) break;
      }

      if (!fallbackFits) {
        fallbackMeasure = await measureParagraphBlock(
          unboxedBlock,
          maxWidth,
          fontContext,
          Array.from({ length: visibleTextLength + 1 }, () => safeBudget),
          emptyParagraphLineMetrics,
        );
      }

      cleanedMeasure = fallbackMeasure;
    }

    baseMeasure = cleanedMeasure;
    return applyInlineBoxes(block, baseMeasure, inlineBoxes, maxWidth, fontContext);
  }

  const wordLayout: WordParagraphLayoutOutput | undefined = block.attrs?.wordLayout as
    | WordParagraphLayoutOutput
    | undefined;

  // Compute fallback font size from the first text run BEFORE marker measurement.
  // This ensures the marker uses the paragraph's actual font context when its own fontSize is missing.
  const firstTextRunWithSize = block.runs.find((run) => {
    if (!isTextRun(run) || isBookmarkMarkerRun(run) || isVanishedRun(run)) return false;
    return typeof (run as TextRun).fontSize === 'number';
  }) as TextRun | undefined;
  // Prefer a text run's size, but fall back to any run (e.g. a tab) carrying a font
  // size when the paragraph has no sized text run. Otherwise a tab-only line is
  // measured at the 12px default and renders shorter than a text or empty line in the
  // same paragraph (SD-3330).
  const firstRunWithSize =
    firstTextRunWithSize ??
    block.runs.find(
      (run): run is Run & { fontSize: number } =>
        !isVanishedRun(run) &&
        typeof (run as { fontSize?: unknown }).fontSize === 'number' &&
        (run as { fontSize: number }).fontSize > 0,
    );
  const fallbackFontSize = normalizeFontSize(firstRunWithSize?.fontSize, DEFAULT_PARAGRAPH_FONT_SIZE);
  const firstTextRunWithFont = block.runs.find((run) => {
    if (!isTextRun(run) || isBookmarkMarkerRun(run) || isVanishedRun(run)) return false;
    const textRun = run as TextRun;
    return typeof textRun.fontFamily === 'string' && textRun.fontFamily.trim().length > 0;
  }) as TextRun | undefined;
  const firstRunWithFont =
    firstTextRunWithFont ??
    block.runs.find(
      (run): run is Run & { fontFamily: string } =>
        !isVanishedRun(run) &&
        typeof (run as { fontFamily?: unknown }).fontFamily === 'string' &&
        (run as { fontFamily: string }).fontFamily.trim().length > 0,
    );
  const fallbackFontFamily = firstRunWithFont?.fontFamily ?? DEFAULT_PARAGRAPH_FONT_FAMILY;
  const normalizedRuns = normalizeRunsForMeasurement(block.runs as Run[], fallbackFontSize, fallbackFontFamily);
  const hasRenderableParagraphContent = normalizedRuns.some((run) => {
    if (isBookmarkMarkerRun(run)) return false;
    if (isVanishedRun(run)) return false;
    if (isTextRun(run)) return run.text.length > 0;
    return (
      isTabRun(run) ||
      isImageRun(run) ||
      isLineBreakRun(run) ||
      run.kind === 'break' ||
      (run as { kind?: string }).kind === 'placeholder'
    );
  });

  const simpleEmptyParagraphRun =
    normalizedRuns.length === 1 &&
    isEmptyTextRun(normalizedRuns[0] as Run) &&
    !isEmptySdtPlaceholderRun(normalizedRuns[0] as Run)
      ? (normalizedRuns[0] as TextRun)
      : null;
  const canUseSimpleEmptyPath =
    inlineLineBudgets === undefined &&
    !block.inlineBoxes?.length &&
    !wordLayout?.marker &&
    !block.attrs?.tabs?.length &&
    !block.attrs?.dropCap &&
    !block.attrs?.dropCapDescriptor &&
    (simpleEmptyParagraphRun != null || normalizedRuns.length === 0);
  if (canUseSimpleEmptyPath) {
    const spacing = block.attrs?.spacing;
    const fontSize = simpleEmptyParagraphRun?.fontSize ?? DEFAULT_PARAGRAPH_FONT_SIZE;
    const metrics = calculateEmptyParagraphMetrics(
      fontSize,
      spacing,
      simpleEmptyParagraphRun ? getFontInfoFromRun(simpleEmptyParagraphRun, fontContext) : undefined,
      fontContext,
      emptyParagraphLineMetrics,
    );
    return {
      kind: 'paragraph',
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 0,
          width: 0,
          ...metrics,
        },
      ],
      totalHeight: metrics.lineHeight,
      measuredAtMaxWidth: maxWidth,
    };
  }

  const ctx = getCanvasContext(fontContext);
  const physicalFamilies = new Map<string, string>();
  const paragraphFontStrings = new Map<string, { font: string; fontFamily: string }>();
  const paragraphFontInfos = new Map<string, FontInfo>();
  const resolveParagraphPhysicalFamily = (run: { fontFamily: string; bold?: boolean; italic?: boolean }): string => {
    const face = faceOf(run);
    const key = `${run.fontFamily}\u0000${face.weight}\u0000${face.style}`;
    const cached = physicalFamilies.get(key);
    if (cached !== undefined) return cached;
    const resolved = fontContext.resolvePhysical(run.fontFamily, face);
    physicalFamilies.set(key, resolved);
    return resolved;
  };
  const resolveParagraphFontString = (run: {
    fontFamily: string;
    fontSize: number;
    bold?: boolean;
    italic?: boolean;
  }): { font: string; fontFamily: string } => {
    const physicalFamily = resolveParagraphPhysicalFamily(run);
    const key = `${physicalFamily}\u0000${run.fontSize}\u0000${run.bold ? 1 : 0}\u0000${run.italic ? 1 : 0}`;
    const cached = paragraphFontStrings.get(key);
    if (cached) return cached;
    const resolved = buildFontString(run, fontContext, physicalFamily);
    paragraphFontStrings.set(key, resolved);
    return resolved;
  };
  const resolveParagraphFontInfo = (run: TextRun): FontInfo => {
    const physicalFamily = resolveParagraphPhysicalFamily(run);
    const boldKey = run.bold === undefined ? 'u' : run.bold ? '1' : '0';
    const italicKey = run.italic === undefined ? 'u' : run.italic ? '1' : '0';
    const key = `${run.fontFamily}\u0000${physicalFamily}\u0000${lineHeightFontSize(run)}\u0000${boldKey}\u0000${italicKey}`;
    const cached = paragraphFontInfos.get(key);
    if (cached) return cached;
    const resolved = getFontInfoFromRun(run, fontContext, physicalFamily);
    paragraphFontInfos.set(key, resolved);
    return resolved;
  };
  // A paragraph repeatedly asks for the same exact word/delimiter widths while
  // evaluating fit, wrap, and segment geometry. Keep that pass-local reuse in
  // run/font-indexed maps so the common hit avoids even the surface CLOCK
  // lookup. Values still originate from the canonical exact runtime cache.
  const paragraphWidths = new WeakMap<Run, Map<string, Map<string, number>>>();
  const resolveParagraphRunWidth = (
    text: string,
    font: string,
    _ctx: CanvasRenderingContext2D,
    run: Run,
    startOffset?: number,
  ): number => {
    const displayText = applyTextTransform(text, run, startOffset);
    let widthsByFont = paragraphWidths.get(run);
    if (!widthsByFont) {
      widthsByFont = new Map();
      paragraphWidths.set(run, widthsByFont);
    }
    let widths = widthsByFont.get(font);
    if (!widths) {
      widths = new Map();
      widthsByFont.set(font, widths);
    }
    const cached = widths.get(displayText);
    if (cached !== undefined) return cached;
    const letterSpacing = run.kind === 'text' || run.kind === undefined ? (run as TextRun).letterSpacing || 0 : 0;
    const wordGlyphAdvanceScale =
      run.kind === 'text' || run.kind === undefined
        ? resolveWordGlyphAdvanceScale((run as TextRun).fontFamily, displayText)
        : 1;
    const width = roundValue(
      measuredTextWidth(displayText, font, letterSpacing, ctx) * wordGlyphAdvanceScale * getRunHorizontalScale(run),
    );
    widths.set(displayText, width);
    return width;
  };

  let markerLineFontInfo: FontInfo | undefined;
  const markerInfo: ParagraphMeasure['marker'] | undefined = wordLayout?.marker
    ? (() => {
        const markerText = wordLayout.marker.markerText ?? '';
        const markerRun: TextRun = {
          text: markerText,
          fontFamily: toCssFontFamily(wordLayout.marker.run.fontFamily) ?? wordLayout.marker.run.fontFamily,
          fontSize: wordLayout.marker.run.fontSize ?? fallbackFontSize,
          bold: wordLayout.marker.run.bold,
          italic: wordLayout.marker.run.italic,
        };
        const { font: markerFont } = resolveParagraphFontString(markerRun);
        if (markerText.length > 0) markerLineFontInfo = resolveParagraphFontInfo(markerRun);
        const glyphWidth = markerText ? measureText(markerText, markerFont, ctx) : 0;
        const gutter =
          typeof wordLayout.marker.gutterWidthPx === 'number' &&
          isFinite(wordLayout.marker.gutterWidthPx) &&
          wordLayout.marker.gutterWidthPx >= 0
            ? wordLayout.marker.gutterWidthPx
            : LIST_MARKER_GAP;

        // Marker box should match Word's box width when provided; otherwise fall back to glyph + gap.
        const markerBoxWidth = Math.max(0, glyphWidth + LIST_MARKER_GAP);

        return {
          markerWidth: markerBoxWidth,
          markerTextWidth: glyphWidth,
          indentLeft: wordLayout.indentLeftPx ?? 0,
          // For tab sizing in the renderer: expose gutter for word-layout lists
          gutterWidth: gutter,
        } as ParagraphMeasure['marker'];
      })()
    : undefined;

  /**
   * Floating-point tolerance for line breaking decisions (0.5px).
   *
   * Why this constant exists:
   * - Canvas text measurement can have minor floating-point precision differences
   *   between measurement and rendering contexts
   * - Different browsers may round sub-pixel measurements slightly differently
   * - Without a tolerance, lines might break prematurely when text is *almost*
   *   but not quite at maxWidth
   *
   * Why 0.5px was chosen:
   * - Large enough to absorb typical floating-point rounding errors (0.1-0.3px)
   * - Small enough to be visually imperceptible at standard screen resolutions
   * - Conservative value that prevents premature breaking without allowing
   *   significant overflow
   *
   * How it's used in line breaking:
   * - When checking if a word fits: `width + wordWidth <= maxWidth - WIDTH_FUDGE_PX`
   * - This gives the layout a 0.5px safety margin before triggering a line break
   * - Prevents edge cases where measured text at 199.7px breaks on a 200px line
   *   due to rounding, when it would actually render fine
   */
  const WIDTH_FUDGE_PX = 0.5;
  const lines: Line[] = [];
  const indent = block.attrs?.indent;
  const spacing = block.attrs?.spacing;
  // Use sanitizeIndent (not sanitizePositive) to allow negative values.
  // Negative indents extend text into the page margin area (OOXML spec).
  const indentLeft = sanitizeIndent(indent?.left);
  const indentRight = sanitizeIndent(indent?.right);
  const firstLine = indent?.firstLine ?? 0;
  const hanging = indent?.hanging ?? 0;
  const isWordLayoutList = Boolean(wordLayout?.marker);
  // Word quirk: justified paragraphs ignore first-line indent. The pm-adapter sets
  // suppressFirstLineIndent=true for these cases.
  const suppressFirstLine = (block.attrs as Record<string, unknown>)?.suppressFirstLineIndent === true;
  const rawFirstLineOffset = suppressFirstLine ? 0 : firstLine - hanging;
  // Standard Word list markers already occupy the hanging region, and their
  // first-line text is painted from indentLeft. Keep authored inline tab stops on
  // that same origin instead of applying the negative hanging offset twice.
  const firstLineTabIndent = indentLeft + (isWordLayoutList && rawFirstLineOffset < 0 ? 0 : rawFirstLineOffset);
  // When wordLayout is present, the hanging region is occupied by the list marker/tab,
  // so keep the same available width as body lines. For normal paragraphs we must honor
  // negative offsets (hanging indent) so the first line can extend into the hanging region.
  const clampedFirstLineOffset = Math.max(0, rawFirstLineOffset);
  // Avoid widening the first line when a negative LEFT indent already expands the content area.
  // Negative right indent doesn't cause this problem — it only extends rightward.
  const hasNegativeLeftIndent = indentLeft < 0;
  const allowNegativeFirstLineOffset = !isWordLayoutList && !hasNegativeLeftIndent && rawFirstLineOffset < 0;
  const firstLineOffset = isWordLayoutList
    ? 0
    : allowNegativeFirstLineOffset
      ? rawFirstLineOffset
      : clampedFirstLineOffset;
  const contentWidth = Math.max(1, maxWidth - indentLeft - indentRight);
  // Body lines use contentWidth (same as first line for most cases).
  // The hanging indent affects WHERE body lines start (indentLeft), not their available width.
  // Since indentLeft already accounts for the body line position, no additional offset is needed.
  const bodyContentWidth = contentWidth;

  // Calculate available width for the first line.
  // There are two list marker layout patterns in OOXML:
  //
  // 1. firstLineIndentMode (marker inline with text):
  //    - Uses indent.firstLine > 0 with no hanging
  //    - Marker is rendered in-flow, occupying horizontal space
  //    - Text starts at textStartPx from the left edge
  //    - Available width = maxWidth - textStartPx - indentRight
  //
  // 2. Standard hanging indent (marker in hanging area):
  //    - Uses indent.left with indent.hanging
  //    - Marker is positioned absolutely in the hanging region (left of text start)
  //    - Text starts at indent.left on ALL lines (first and subsequent)
  //    - Available width = maxWidth - indentLeft - indentRight (same as subsequent lines)
  //
  // Note: wordLayout.marker.justification (from lvlJc) describes text alignment WITHIN
  // the marker box (left/center/right), NOT whether the marker takes in-flow space.
  let initialAvailableWidth: number;
  // Shared helper is the canonical source for list text-start geometry.
  // Keep an explicit top-level fallback for producers that only provide textStartPx.
  const rawTextStartPx = (wordLayout as { textStartPx?: unknown } | undefined)?.textStartPx;
  const textStartPx =
    typeof rawTextStartPx === 'number' && Number.isFinite(rawTextStartPx) ? rawTextStartPx : undefined;
  const resolvedTextStartPx = resolveListTextStartPx(
    wordLayout,
    indentLeft,
    firstLine,
    hanging,
    (markerText: string, marker: MinimalMarker) => {
      const markerRun = {
        fontFamily: toCssFontFamily(marker.run?.fontFamily) ?? marker.run?.fontFamily ?? 'Arial',
        fontSize: marker.run?.fontSize ?? fallbackFontSize,
        bold: marker.run?.bold ?? false,
        italic: marker.run?.italic ?? false,
      };
      const { font: markerFont } = resolveParagraphFontString(markerRun);
      return measureText(markerText, markerFont, ctx);
    },
  );
  const effectiveTextStartPx = resolvedTextStartPx ?? textStartPx;
  const hasResolvedTextStartPx = typeof resolvedTextStartPx === 'number' && Number.isFinite(resolvedTextStartPx);
  const shouldUseListTextStartWidth =
    typeof effectiveTextStartPx === 'number' &&
    (hasResolvedTextStartPx ? effectiveTextStartPx !== indentLeft : effectiveTextStartPx > indentLeft);

  if (shouldUseListTextStartWidth) {
    // textStartPx indicates where text actually starts on the first line (after marker + tab/space).
    // Available width = from textStartPx to right margin.
    initialAvailableWidth = Math.max(1, maxWidth - effectiveTextStartPx - indentRight);
  } else {
    // No textStartPx: text starts at the normal indent position.
    initialAvailableWidth = Math.max(1, contentWidth - firstLineOffset);
  }

  const tabStops = buildTabStopsPx(
    indent,
    block.attrs?.tabs as TabStop[],
    block.attrs?.tabIntervalTwips as number | undefined,
  );
  const alignmentTabStopsPx = tabStops
    .map((stop, index) => ({ stop, index }))
    .filter(({ stop }) => stop.val === 'end' || stop.val === 'center' || stop.val === 'decimal');
  const decimalSeparator = sanitizeDecimalSeparator(block.attrs?.decimalSeparator);

  // Extract bar tab stops for paragraph-level rendering (OOXML: bars on all lines)
  const barTabStops = tabStops.filter((stop) => stop.val === 'bar');

  // Helper to add bar tabs to a line (paragraph-level decoration)
  const addBarTabsToLine = (line: Line): void => {
    if (barTabStops.length > 0) {
      line.bars = barTabStops.map((stop) => ({ x: stop.pos }));
    }
  };

  // Drop cap handling: measure drop cap and calculate reserved space
  const dropCapDescriptor = block.attrs?.dropCapDescriptor;
  let dropCapMeasure: {
    width: number;
    height: number;
    lines: number;
    mode: 'drop' | 'margin';
  } | null = null;

  if (dropCapDescriptor) {
    // Validate required fields before measuring
    if (!dropCapDescriptor.run || !dropCapDescriptor.run.text || !dropCapDescriptor.lines) {
      console.warn('Invalid drop cap descriptor - missing required fields:', dropCapDescriptor);
    } else {
      const dropCapMeasured = measureDropCap(ctx, dropCapDescriptor, spacing, fontContext);
      dropCapMeasure = dropCapMeasured;

      // Update the descriptor with measured dimensions
      (dropCapDescriptor as DropCapDescriptor).measuredWidth = dropCapMeasured.width;
      (dropCapDescriptor as DropCapDescriptor).measuredHeight = dropCapMeasured.height;
    }
  }

  const emptyParagraphRun =
    normalizedRuns.length === 1 &&
    isEmptyTextRun(normalizedRuns[0] as Run) &&
    !isEmptySdtPlaceholderRun(normalizedRuns[0] as Run)
      ? (normalizedRuns[0] as TextRun)
      : null;
  if (emptyParagraphRun) {
    const fontSize = emptyParagraphRun.fontSize ?? DEFAULT_PARAGRAPH_FONT_SIZE;
    const metrics = calculateEmptyParagraphMetrics(
      fontSize,
      spacing,
      resolveParagraphFontInfo(emptyParagraphRun),
      fontContext,
      emptyParagraphLineMetrics,
    );
    const emptyLine: Line = {
      fromRun: 0,
      fromChar: 0,
      toRun: 0,
      toChar: 0,
      width: 0,
      ...metrics,
    };
    addBarTabsToLine(emptyLine);
    lines.push(emptyLine);

    return {
      kind: 'paragraph',
      lines,
      totalHeight: metrics.lineHeight,
      measuredAtMaxWidth: maxWidth,
      ...(markerInfo ? { marker: markerInfo } : {}),
    };
  }

  if (normalizedRuns.length === 0) {
    const metrics = calculateEmptyParagraphMetrics(
      DEFAULT_PARAGRAPH_FONT_SIZE,
      spacing,
      undefined,
      fontContext,
      emptyParagraphLineMetrics,
    );
    const emptyLine: Line = {
      fromRun: 0,
      fromChar: 0,
      toRun: 0,
      toChar: 0,
      width: 0,
      ...metrics,
    };
    addBarTabsToLine(emptyLine);
    lines.push(emptyLine);

    return {
      kind: 'paragraph',
      lines,
      totalHeight: metrics.lineHeight,
      measuredAtMaxWidth: maxWidth,
      ...(markerInfo ? { marker: markerInfo } : {}),
    };
  }

  /** Fallback font info for accurate typography metrics on leading line breaks. */
  const fallbackFontInfo = firstTextRunWithSize ? resolveParagraphFontInfo(firstTextRunWithSize) : undefined;

  let currentLine: {
    fromRun: number;
    fromChar: number;
    toRun: number;
    toChar: number;
    width: number;
    /** Uncompressed width retained when a justified line fits by compressing spaces. */
    naturalWidth?: number;
    maxFontSize: number;
    /** Font info for the run with maxFontSize, used for accurate typography metrics */
    maxFontInfo?: FontInfo;
    /** Aggregate Word line-box extents for every physical face on this baseline. */
    fontMetricEnvelope?: FontLineMetricEnvelope;
    /** Tallest inline image on this line (pixels) */
    maxImageHeight?: number;
    /** Font fallback for structural-only text runs such as bookmark markers. */
    structuralFallbackFontSize?: number;
    structuralFallbackFontInfo?: FontInfo;
    maxWidth: number;
    hasExplicitTabStops?: boolean;
    /** Every in-progress line owns a concrete segment collection. */
    segments: NonNullable<Line['segments']>;
    leaders?: Line['leaders'];
    /** Count of breakable spaces already included on this line (for justify-aware fitting) */
    spaceCount: number;
    /** Measured tab widths keyed by tab run pmStart (mirrors Line.tabWidths). */
    tabWidths?: Record<number, number>;
    /** Internal marker for an empty line seeded by an explicit line break. */
    isLineBreakPlaceholder?: boolean;
    /** Internal marker: a terminal wrap space was already collapsed onto this line. */
    collapsedWrapSpaces?: true;
    /** Inline image runs on this line, tracked for measured baseline-vs-top resolution. */
    imageRunCandidates?: InlineImageCandidate[];
  } | null = null;

  /**
   * Single line-finalization helper shared by every line-close path (initial
   * close, wrap-before-image, explicit break, and final close). It computes
   * typography metrics, applies bar tabs, and attaches the measured
   * `inlineImageAlignments` so the glyph-vs-line-expanding decision lives in one
   * place instead of being duplicated per branch. Transient bookkeeping fields
   * (`imageRunCandidates`, `textLineHeight`) are stripped from the emitted
   * {@link Line}.
   */
  const closeLineWithMetrics = (lineState: NonNullable<typeof currentLine>): Line => {
    // Word composes the hanging-indent marker into the first line's physical
    // font envelope. Measuring its width separately is not enough: Symbol and
    // other marker faces can have taller ascent/descent than the body font,
    // moving the baseline and increasing the line box. Later wrapped lines do
    // not contain the marker and retain the body envelope.
    if (lines.length === 0 && markerLineFontInfo) {
      if (!lineState.fontMetricEnvelope && lineState.maxFontInfo) {
        addFontInfoToLineMetricEnvelope(lineState, lineState.maxFontInfo, fontContext);
      }
      addFontInfoToLineMetricEnvelope(lineState, markerLineFontInfo, fontContext);
      if (markerLineFontInfo.fontSize > lineState.maxFontSize || !lineState.maxFontInfo) {
        lineState.maxFontInfo = markerLineFontInfo;
      }
      lineState.maxFontSize = Math.max(lineState.maxFontSize, markerLineFontInfo.fontSize);
    }
    const metrics = finalizeLineMetrics(lineState, spacing, fontContext, emptyParagraphLineMetrics);
    const { textLineHeight, ...lineMetrics } = metrics;
    const {
      imageRunCandidates,
      fontMetricEnvelope: _fontMetricEnvelope,
      collapsedWrapSpaces: _collapsedWrapSpaces,
      ...rest
    } = lineState;
    const completedLine: Line = { ...rest, ...lineMetrics };
    // A small inline image on an otherwise textless OOXML run still composes
    // against that run's font baseline. Callers that do not provide run
    // typography retain the legacy top-aligned fallback.
    const alignments = resolveInlineImageAlignments(
      imageRunCandidates,
      lineState.maxFontSize > 0 || (lineState.structuralFallbackFontSize ?? 0) > 0,
      textLineHeight,
    );
    if (alignments) {
      completedLine.inlineImageAlignments = alignments;
    }
    addBarTabsToLine(completedLine);
    return completedLine;
  };

  // Helper to calculate effective available width based on current line count.
  // When drop cap is present in 'drop' mode, reduce width for the first N lines.
  const getEffectiveWidth = (baseWidth: number, lineIndex = lines.length): number => {
    const boxAdjustedWidth = Math.max(1, baseWidth - (inlineLineBudgets?.[lineIndex] ?? 0));
    if (dropCapMeasure && lineIndex < dropCapMeasure.lines && dropCapMeasure.mode === 'drop') {
      return Math.max(1, boxAdjustedWidth - dropCapMeasure.width);
    }
    return boxAdjustedWidth;
  };

  let lastFontSize = fallbackFontSize;
  /** Tracks whether we've encountered a text run yet; used to apply fallback font info to leading line breaks. */
  let hasSeenTextRun = false;
  let tabStopCursor = 0;
  let pendingTabAlignment: { target: number; val: TabStop['val']; compensateNegativeLeft?: boolean } | null = null;
  let pendingSegmentPrecedingTabEndX: number | undefined;
  let pendingLeader: LeaderDecoration | null = null;
  let pendingRunSpacing = 0;
  // Remember the last applied tab alignment so we can clamp end-aligned
  // segments to the exact target after measuring to avoid 1px drift.
  let lastAppliedTabAlign: { target: number; val: TabStop['val'] } | null = null;
  const warnedTabVals = new Set<string>();

  /**
   * Active tab alignment group state.
   *
   * When processing content after a non-start-aligned tab (end, center, decimal),
   * we use look-ahead measurement to determine the total width of all content
   * until the next tab or end of line. This state tracks:
   * - The pre-measured group information
   * - The starting X position for the aligned content
   * - The current X position as we process runs within the group
   *
   * This enables proper right/center/decimal alignment where ALL content after
   * the tab is treated as a unit, matching Microsoft Word's behavior.
   */
  let activeTabGroup: {
    /** The measurement result from measureTabAlignmentGroup */
    measure: TabAlignmentGroupMeasure;
    /** The X position where the aligned group starts */
    startX: number;
    /** Current X position within the group (cumulative as we process runs) */
    currentX: number;
    /** The tab stop target position */
    target: number;
    /** The tab alignment type */
    val: TabStop['val'];
  } | null = null;

  /**
   * Validate and track tab stop val to ensure it's normalized.
   * Returns true if validation passed, false if val is invalid (treated as 'start').
   */
  const validateTabStopVal = (stop: TabStopPx): boolean => {
    if (!ALLOWED_TAB_VALS.has(stop.val) && !warnedTabVals.has(stop.val)) {
      warnedTabVals.add(stop.val);
      return false;
    }
    return true;
  };

  const resolveBoundarySpacing = (lineWidth: number, isRunStart: boolean, run: TextRun): number => {
    if (lineWidth <= 0) return 0;
    return isRunStart ? pendingRunSpacing : getScaledLetterSpacing(run);
  };

  /**
   * Apply a pending tab alignment to the next segment/run given its width.
   * Returns the aligned starting X position when applied.
   */
  const alignPendingTabForWidth = (segmentWidth: number, beforeDecimalWidth?: number): number | undefined => {
    if (!pendingTabAlignment || !currentLine) return undefined;

    // Guard against negative segment width
    if (segmentWidth < 0) {
      segmentWidth = 0;
    }

    const { target, val, compensateNegativeLeft } = pendingTabAlignment;
    let startX = currentLine.width;

    if (val === 'decimal') {
      const beforeWidth = beforeDecimalWidth ?? 0;
      startX = Math.max(0, target - beforeWidth);
    } else if (val === 'end') {
      startX = Math.max(0, target - segmentWidth);
    } else if (val === 'center') {
      startX = Math.max(0, target - segmentWidth / 2);
    } else {
      startX = Math.max(0, target);
    }

    const effectiveIndent = lines.length === 0 ? firstLineTabIndent : indentLeft;

    // Update pending leader to end where aligned content begins
    if (pendingLeader) {
      pendingLeader.to = startX + effectiveIndent;
    }

    currentLine.width = roundValue(startX);
    // Track alignment used for post-segment clamping
    lastAppliedTabAlign = { target, val };
    pendingTabAlignment = null;
    pendingLeader = null;

    const shouldCompensateNegativeLeft = compensateNegativeLeft === true;
    pendingSegmentPrecedingTabEndX = shouldCompensateNegativeLeft ? startX : undefined;

    // Negative-left paragraphs move the fragment itself left. Explicit segment
    // x values are still consumed by the DOM painter with indentOffset added.
    // Only compensate generated/default stops that advance from the negative
    // line origin; authored explicit stops already have the same geometry Word
    // uses. The uncompensated tab end is carried on the
    // following segment as precedingTabEndX.
    return shouldCompensateNegativeLeft ? startX - Math.min(effectiveIndent, 0) : startX;
  };

  const consumePendingPrecedingTabEndX = (): number | undefined => {
    const value = pendingSegmentPrecedingTabEndX;
    pendingSegmentPrecedingTabEndX = undefined;
    return value;
  };
  const clearPendingPrecedingTabEndX = (): void => {
    pendingSegmentPrecedingTabEndX = undefined;
  };

  /**
   * Aligns a text segment at a pending tab stop by measuring its width and applying the appropriate alignment.
   *
   * This function handles different tab alignment types:
   * - 'decimal': Aligns text based on the decimal separator position
   * - 'end': Right-aligns text at the tab stop
   * - 'center': Centers text at the tab stop
   * - 'start': Left-aligns text at the tab stop (default)
   *
   * @param segmentText - The text content of the segment to align
   * @param font - CSS font string for measuring text width (e.g., "16px Arial")
   * @param runContext - The Run object containing styling properties (letterSpacing, etc.)
   * @returns The aligned starting X position for the segment, or undefined if no tab alignment is pending
   */
  const alignSegmentAtTab = (
    segmentText: string,
    font: string,
    runContext: Run,
    segmentStartChar: number,
  ): number | undefined => {
    if (!pendingTabAlignment || !currentLine) return undefined;
    const { val } = pendingTabAlignment;

    let segmentWidth = 0;
    let beforeDecimalWidth: number | undefined;

    if (val === 'decimal') {
      const idx = segmentText.indexOf(decimalSeparator);
      if (idx >= 0) {
        const beforeText = segmentText.slice(0, idx);
        beforeDecimalWidth =
          beforeText.length > 0 ? resolveParagraphRunWidth(beforeText, font, ctx, runContext, segmentStartChar) : 0;
      }
      segmentWidth =
        segmentText.length > 0 ? resolveParagraphRunWidth(segmentText, font, ctx, runContext, segmentStartChar) : 0;
    } else if (val === 'end' || val === 'center') {
      segmentWidth =
        segmentText.length > 0 ? resolveParagraphRunWidth(segmentText, font, ctx, runContext, segmentStartChar) : 0;
    }

    return alignPendingTabForWidth(segmentWidth, beforeDecimalWidth);
  };

  // Keep measurement line ranges aligned with the painter's run expansion.
  const newlineExpandedRuns = expandRunsForInlineNewlines(normalizedRuns as Run[]);
  let runsToProcess: Run[] = newlineExpandedRuns;
  let runIndexMap = runsToProcess.map((_, index) => index);
  let runCharOffsetMap = runsToProcess.map(() => 0);
  if (runsToProcess.some((run) => isTextRun(run) && typeof run.text === 'string' && run.text.includes('\t'))) {
    const expandedRuns: Run[] = [];
    const expandedRunIndexMap: number[] = [];
    const expandedRunCharOffsetMap: number[] = [];
    for (let runIndex = 0; runIndex < runsToProcess.length; runIndex += 1) {
      const run = runsToProcess[runIndex];
      const originalRunIndex = runIndexMap[runIndex] ?? runIndex;
      const originalRunCharOffset = runCharOffsetMap[runIndex] ?? 0;
      if (!isTextRun(run) || typeof run.text !== 'string' || !run.text.includes('\t')) {
        expandedRuns.push(run);
        expandedRunIndexMap.push(originalRunIndex);
        expandedRunCharOffsetMap.push(originalRunCharOffset);
        continue;
      }
      const textRun = run as TextRun;
      let buffer = '';
      let cursor = textRun.pmStart ?? 0;
      const text = textRun.text;
      for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        if (char === '\t') {
          if (buffer.length > 0) {
            expandedRuns.push({
              ...textRun,
              text: buffer,
              pmStart: cursor - buffer.length,
              pmEnd: cursor,
            });
            expandedRunIndexMap.push(originalRunIndex);
            expandedRunCharOffsetMap.push(originalRunCharOffset + i - buffer.length);
            buffer = '';
          }
          const tabRun: TabRun = {
            kind: 'tab',
            text: '\t',
            pmStart: cursor,
            pmEnd: cursor + 1,
            vanish: textRun.vanish,
            tabStops: block.attrs?.tabs as TabStop[] | undefined,
            indent,
            leader: (textRun as unknown as TabRun)?.leader ?? null,
            sdt: textRun.sdt,
          };
          expandedRuns.push(tabRun);
          expandedRunIndexMap.push(originalRunIndex);
          expandedRunCharOffsetMap.push(originalRunCharOffset + i);
          cursor += 1;
          continue;
        }
        buffer += char;
        cursor += 1;
      }
      if (buffer.length > 0) {
        expandedRuns.push({
          ...textRun,
          text: buffer,
          pmStart: cursor - buffer.length,
          pmEnd: cursor,
        });
        expandedRunIndexMap.push(originalRunIndex);
        expandedRunCharOffsetMap.push(originalRunCharOffset + text.length - buffer.length);
      }
    }
    runsToProcess = expandedRuns;
    runIndexMap = expandedRunIndexMap;
    runCharOffsetMap = expandedRunCharOffsetMap;
  }
  if (hasRenderableParagraphContent) {
    const filteredRuns: Run[] = [];
    const filteredRunIndexMap: number[] = [];
    const filteredRunCharOffsetMap: number[] = [];
    for (let runIndex = 0; runIndex < runsToProcess.length; runIndex += 1) {
      const run = runsToProcess[runIndex];
      if (isBookmarkMarkerRun(run)) continue;
      filteredRuns.push(run);
      filteredRunIndexMap.push(runIndexMap[runIndex] ?? runIndex);
      filteredRunCharOffsetMap.push(runCharOffsetMap[runIndex] ?? 0);
    }
    if (filteredRuns.length > 0) {
      runsToProcess = filteredRuns;
      runIndexMap = filteredRunIndexMap;
      runCharOffsetMap = filteredRunCharOffsetMap;
    }
  }
  const totalTabRuns = runsToProcess.reduce(
    (count, run) => (isTabRun(run) && !isVanishedRun(run) ? count + 1 : count),
    0,
  );
  const paragraphEndsWithTerminalTabBreak =
    runsToProcess.length >= 2 &&
    isLineBreakRun(runsToProcess[runsToProcess.length - 1]) &&
    isTabRun(runsToProcess[runsToProcess.length - 2]);
  const endsAtLineBoundary = (runIndex: number): boolean => {
    for (let nextRunIndex = runIndex + 1; nextRunIndex < runsToProcess.length; nextRunIndex += 1) {
      const nextRun = runsToProcess[nextRunIndex];
      // Vanished and empty runs paint nothing, so they do not make the space non-terminal.
      if (isVanishedRun(nextRun)) continue;
      if (isTextRun(nextRun) && /^[ ]*$/.test(nextRun.text)) continue;
      return isLineBreakRun(nextRun) || nextRun.kind === 'break';
    }
    return true;
  };

  /**
   * Trims trailing regular spaces from a line when it is finalized.
   *
   * Our renderer uses `white-space: pre`, so trailing wrap-point spaces would otherwise occupy
   * width and make the visible right edge look ragged (and would be incorrectly stretched by
   * word-spacing justify).
   *
   * This matches typical word-processor behavior: spaces that exist only because of wrapping at
   * a word boundary do not render at line ends.
   */
  const trimTrailingWrapSpaces = (lineToTrim: NonNullable<typeof currentLine>): void => {
    const lastRun = runsToProcess[lineToTrim.toRun];
    if (!lastRun || !('text' in lastRun) || typeof lastRun.text !== 'string') return;

    const sliceStart = lineToTrim.toRun === lineToTrim.fromRun ? lineToTrim.fromChar : 0;
    const sliceEnd = lineToTrim.toChar;
    if (sliceEnd <= sliceStart) return;

    const sliceText = lastRun.text.slice(sliceStart, sliceEnd);
    let trimCount = 0;
    for (let i = sliceText.length - 1; i >= 0 && sliceText[i] === ' '; i -= 1) {
      trimCount += 1;
    }
    if (trimCount === 0) return;

    // Preserve intentionally space-only lines (used in tests and in some documents).
    if (lineToTrim.fromRun === lineToTrim.toRun && sliceText.trim().length === 0) {
      return;
    }

    const keptText = sliceText.slice(0, Math.max(0, sliceText.length - trimCount));
    const { font } = resolveParagraphFontString(
      lastRun as { fontFamily: string; fontSize: number; bold?: boolean; italic?: boolean },
    );
    const fullWidth = resolveParagraphRunWidth(sliceText, font, ctx, lastRun, sliceStart);
    const keptWidth = keptText.length > 0 ? resolveParagraphRunWidth(keptText, font, ctx, lastRun, sliceStart) : 0;
    const delta = Math.max(0, fullWidth - keptWidth);

    lineToTrim.width = roundValue(Math.max(0, lineToTrim.width - delta));
    lineToTrim.spaceCount = Math.max(0, lineToTrim.spaceCount - trimCount);

    if (lineToTrim.naturalWidth != null) {
      lineToTrim.naturalWidth = roundValue(Math.max(0, lineToTrim.naturalWidth - delta));
    }
  };

  /**
   * Collapses an overflowing terminal wrap space onto the line it overflowed from.
   *
   * Like `trimTrailingWrapSpaces`, the characters stay in the line's source range and
   * only width and `spaceCount` are dropped. Sibling spaces of the same terminal cluster
   * that an earlier run or word token already committed are trimmed exactly once.
   */
  const collapseTerminalWrapSpaces = (
    lineToExtend: NonNullable<typeof currentLine>,
    runIndex: number,
    fromChar: number,
    toChar: number,
  ): void => {
    if (!lineToExtend.collapsedWrapSpaces) {
      trimTrailingWrapSpaces(lineToExtend);
      lineToExtend.collapsedWrapSpaces = true;
    }
    lineToExtend.toRun = runIndex;
    lineToExtend.toChar = toChar;
    appendSegment(lineToExtend.segments, runIndex, fromChar, toChar, 0);
  };

  // Per-line-segment tab counts. The heuristic below binds the last N tabs of a
  // segment to the last N alignment stops; segments are delimited by explicit
  // <w:br/> runs because pPr/tabs apply per line, not per paragraph.
  // sd-1480-two-col-tab-positions: a single paragraph "Page\t2<br/>Page\t5"
  // must emit a leader on BOTH lines, not only the last.
  const tabSegmentInfo = new Map<number, { localOrdinal: number; segmentTotal: number }>();
  {
    let segmentTabRunIndices: number[] = [];
    const closeSegment = () => {
      const total = segmentTabRunIndices.length;
      segmentTabRunIndices.forEach((runIdx, ord) => {
        tabSegmentInfo.set(runIdx, { localOrdinal: ord, segmentTotal: total });
      });
      segmentTabRunIndices = [];
    };
    for (let i = 0; i < runsToProcess.length; i++) {
      const r = runsToProcess[i];
      if (isLineBreakRun(r) || (r.kind === 'break' && (r as { breakType?: string }).breakType === 'line')) {
        closeSegment();
      } else if (isTabRun(r) && !isVanishedRun(r)) {
        segmentTabRunIndices.push(i);
      }
    }
    closeSegment();
  }

  // Word-compat heuristic (not ECMA-376 17.3.3.32): the last N tab characters in a
  // line bind to the last N explicit end/center/decimal stops. Needed for TOC
  // entries where a right-aligned dot-leader stop coexists with default grid stops —
  // strict greedy next-stop resolution would land the trailing tab on a default stop
  // instead of the leader stop. Mirrored in layout-bridge/src/remeasure.ts.
  const getAlignmentStopForOrdinal = (ordinal: number, runIdx?: number): { stop: TabStopPx; index: number } | null => {
    if (alignmentTabStopsPx.length === 0 || totalTabRuns === 0 || !Number.isFinite(ordinal)) {
      return null;
    }
    let scopeOrdinal = ordinal;
    let scopeTotal = totalTabRuns;
    if (runIdx !== undefined) {
      const info = tabSegmentInfo.get(runIdx);
      if (info) {
        scopeOrdinal = info.localOrdinal;
        scopeTotal = info.segmentTotal;
      }
    }
    if (scopeOrdinal < 0 || scopeOrdinal >= scopeTotal) return null;
    const remainingTabs = scopeTotal - scopeOrdinal - 1;
    const targetIndex = alignmentTabStopsPx.length - 1 - remainingTabs;
    if (targetIndex < 0 || targetIndex >= alignmentTabStopsPx.length) return null;
    return alignmentTabStopsPx[targetIndex];
  };

  let sequentialTabIndex = 0;
  let wordBoundariesUntilCheckpoint = WORD_BOUNDARIES_PER_MEASUREMENT_CHECKPOINT;
  for (let runIndex = 0; runIndex < runsToProcess.length; runIndex++) {
    const runCheckpoint = measurementCheckpointIfDue(fontContext);
    if (runCheckpoint) await runCheckpoint;
    const run = runsToProcess[runIndex];

    if ((run as Run).kind === 'break') {
      if (currentLine) {
        const completedLine: Line = closeLineWithMetrics(currentLine);
        lines.push(completedLine);
        currentLine = null;
      } else {
        const metrics = calculateTypographyMetrics(fallbackFontSize, spacing, fallbackFontInfo, fontContext);
        const emptyLine: Line = {
          fromRun: runIndex,
          fromChar: 0,
          toRun: runIndex,
          toChar: 0,
          width: 0,
          segments: [],
          ...metrics,
        };
        addBarTabsToLine(emptyLine);
        lines.push(emptyLine);
      }
      tabStopCursor = 0;
      pendingTabAlignment = null;
      pendingLeader = null;
      lastAppliedTabAlign = null;
      pendingRunSpacing = 0;
      continue;
    }

    // Handle explicit line breaks (e.g., DOCX <w:br/>)
    if (isLineBreakRun(run)) {
      // For leading line breaks (before any text), use fallback font info for accurate height calculation
      const lineBreakFontInfo = hasSeenTextRun ? undefined : fallbackFontInfo;
      if (currentLine) {
        const completedLine: Line = closeLineWithMetrics(currentLine);
        lines.push(completedLine);
      } else {
        // Line break at the start of paragraph (no currentLine yet):
        // Create an empty line to represent the leading line break
        const metrics = calculateTypographyMetrics(lastFontSize, spacing, lineBreakFontInfo, fontContext);
        const emptyLine: Line = {
          fromRun: runIndex,
          fromChar: 0,
          toRun: runIndex,
          toChar: 0,
          width: 0,
          maxWidth: getEffectiveWidth(lines.length === 0 ? initialAvailableWidth : bodyContentWidth),
          segments: [],
          ...metrics,
        };
        addBarTabsToLine(emptyLine);
        lines.push(emptyLine);
      }

      // Start a fresh (currently empty) line after the break. If no further content
      // is added, this placeholder will become a blank line with the appropriate height.
      const hadPreviousLine = lines.length > 0;
      // Body lines (line 2+) use bodyContentWidth which accounts for hanging indent.
      const nextLineMaxWidth: number = hadPreviousLine
        ? getEffectiveWidth(bodyContentWidth)
        : getEffectiveWidth(initialAvailableWidth);
      currentLine = {
        fromRun: runIndex,
        fromChar: 0,
        toRun: runIndex,
        toChar: 0,
        width: 0,
        maxFontSize: lastFontSize,
        maxFontInfo: lineBreakFontInfo,
        maxWidth: nextLineMaxWidth,
        segments: [],
        spaceCount: 0,
        isLineBreakPlaceholder: true,
      };
      tabStopCursor = 0;
      pendingTabAlignment = null;
      pendingLeader = null;
      lastAppliedTabAlign = null;
      pendingRunSpacing = 0;
      continue;
    }

    // When a text/tab/atomic run follows an explicit lineBreak, currentLine is a
    // placeholder line seeded with the break run index. Re-anchor it so line ranges
    // start at the first visible run on the new line.
    if (currentLine?.isLineBreakPlaceholder) {
      currentLine.fromRun = runIndex;
      currentLine.toRun = runIndex;
      currentLine.isLineBreakPlaceholder = false;
    }

    if (isTabRun(run) && isVanishedRun(run)) {
      // A vanished tab is transparent to tab alignment; keep activeTabGroup/pendingLeader intact.
      const hiddenLength = run.text.length;
      if (!currentLine) {
        currentLine = {
          fromRun: runIndex,
          fromChar: 0,
          toRun: runIndex,
          toChar: hiddenLength,
          width: 0,
          maxFontSize: 0,
          maxWidth: getEffectiveWidth(lines.length === 0 ? initialAvailableWidth : bodyContentWidth),
          segments: [{ runIndex, fromChar: 0, toChar: hiddenLength, width: 0 }],
          spaceCount: 0,
          structuralFallbackFontSize: lineHeightFontSize(run as unknown as TextRun),
          structuralFallbackFontInfo: resolveParagraphFontInfo(run as unknown as TextRun),
        };
      } else {
        currentLine.toRun = runIndex;
        currentLine.toChar = hiddenLength;
        appendSegment(currentLine.segments, runIndex, 0, hiddenLength, 0);
        if (currentLine.maxFontSize <= 0) {
          currentLine.structuralFallbackFontSize ??= lineHeightFontSize(run as unknown as TextRun);
          currentLine.structuralFallbackFontInfo ??= resolveParagraphFontInfo(run as unknown as TextRun);
        }
      }

      run.width = 0;
      const blockRunIndex = runIndexMap[runIndex] ?? runIndex;
      if (!currentLine.tabWidths) currentLine.tabWidths = {};
      currentLine.tabWidths[blockRunIndex] = 0;
      pendingRunSpacing = 0;
      continue;
    }

    // Handle tab runs specially
    if (isTabRun(run)) {
      // Clear any previous tab group when we encounter a new tab
      activeTabGroup = null;
      pendingLeader = null;

      // Initialize line if needed
      if (!currentLine) {
        const imageRunFontSize =
          typeof run.fontSize === 'number' && run.fontSize > 0 ? normalizeFontSize(run.fontSize) : undefined;
        currentLine = {
          fromRun: runIndex,
          fromChar: 0,
          toRun: runIndex,
          toChar: 1,
          width: 0,
          maxFontSize: lastFontSize,
          // A tab-only paragraph has no text run, so fallbackFontInfo is undefined and the line
          // would fall back to synthetic 0.8/0.2 ascent/descent. Derive metrics from the tab's own
          // font (it carries fontFamily/fontSize) so a tab-only underlined line gets the same
          // measured ascent/descent - hence underline offset and line height - as the equivalent
          // text line. getFontInfoFromRun reads only fontFamily/fontSize/bold/italic, all on a TabRun.
          maxFontInfo: hasSeenTextRun
            ? undefined
            : (fallbackFontInfo ?? resolveParagraphFontInfo(run as unknown as TextRun)),
          maxWidth: getEffectiveWidth(lines.length === 0 ? initialAvailableWidth : bodyContentWidth),
          segments: [],
          spaceCount: 0,
        };
      }

      // Advance to the appropriate tab stop (explicit alignment stops take precedence for trailing tabs)
      const originX = currentLine.width;
      // Use first-line effective indent (accounts for hanging) on first line, body indent otherwise
      const effectiveIndent = lines.length === 0 ? firstLineTabIndent : indentLeft;
      const absCurrentX = currentLine.width + effectiveIndent;
      let stop: TabStopPx | undefined;
      let target: number;
      const resolvedTabIndex =
        typeof (run as TabRun).tabIndex === 'number' && Number.isFinite((run as TabRun).tabIndex)
          ? (run as TabRun).tabIndex!
          : sequentialTabIndex;
      // Keep the sequential counter in sync with explicit tabIndex values so mixed
      // inputs (explicit + synthetic TabRuns) don't produce out-of-order ordinals.
      // Mirrors consumeTabOrdinal() in layout-bridge/src/remeasure.ts.
      sequentialTabIndex = Math.max(sequentialTabIndex, resolvedTabIndex + 1);
      // Compute greedy first so we can decide whether the SD-2447 heuristic is
      // actually needed. The heuristic exists because when tabStops are seeded
      // with synthetic 0.5" defaults from origin (TOC styles with only an
      // alignment stop), greedy lands on a default before reaching the
      // alignment stop. When the paragraph has an explicit start-aligned stop
      // ahead of the alignment stop (e.g. TOC1 with `start@740, end@9360`),
      // greedy already finds the correct stop and the heuristic over-fires.
      // Only force the heuristic when greedy would land on a `source:default`
      // stop — which is precisely the SD-2447 condition.
      const greedy = getNextTabStopPx(absCurrentX, tabStops, tabStopCursor);
      const greedyOnDefault = greedy.stop?.source === 'default';
      const forcedAlignment = greedyOnDefault ? getAlignmentStopForOrdinal(resolvedTabIndex, runIndex) : null;
      if (forcedAlignment && forcedAlignment.stop.pos > absCurrentX + TAB_EPSILON) {
        stop = forcedAlignment.stop;
        target = forcedAlignment.stop.pos;
        tabStopCursor = forcedAlignment.index + 1;
      } else {
        target = greedy.target;
        tabStopCursor = greedy.nextIndex;
        stop = greedy.stop;
      }
      const maxAbsWidth = currentLine.maxWidth + effectiveIndent;
      const clampedTarget = Math.min(target, maxAbsWidth);
      const tabAdvance = Math.max(0, clampedTarget - absCurrentX);
      currentLine.width = roundValue(currentLine.width + tabAdvance);
      if (stop?.source === 'explicit') {
        currentLine.hasExplicitTabStops = true;
      }
      // Persist measured tab width on the TabRun for downstream consumers/tests
      (run as TabRun & { width?: number }).width = tabAdvance;
      // Also record in Line.tabWidths so the painter has a cache-hit-safe fallback
      // when FlowBlock re-projection creates fresh run objects (run.width not re-set).
      // Key by the original block.runs index (runIndexMap[runIndex]) so the entry
      // remains valid even when annotateParagraphSyntheticPm assigns new pmStart
      // values after edits shift PM positions upstream.
      const blockRunIndex = runIndexMap[runIndex] ?? runIndex;
      if (!currentLine.tabWidths) currentLine.tabWidths = {};
      currentLine.tabWidths[blockRunIndex] = tabAdvance;

      // A visible tab can be the first visible metric contributor after vanished content.
      if (currentLine.maxFontSize <= 0) {
        currentLine.maxFontInfo = resolveParagraphFontInfo(run as unknown as TextRun);
      }
      currentLine.maxFontSize = Math.max(currentLine.maxFontSize, lastFontSize);
      currentLine.toRun = runIndex;
      currentLine.toChar = 1; // tab is a single character
      let currentLeader: LeaderDecoration | null = null;

      // Emit leader decoration if requested
      if (stop && stop.leader && stop.leader !== 'none') {
        const leaderStyle: 'heavy' | 'dot' | 'hyphen' | 'underscore' | 'middleDot' = stop.leader;
        const from = Math.min(originX + effectiveIndent, clampedTarget);
        const to = Math.max(originX + effectiveIndent, clampedTarget);
        if (!currentLine.leaders) currentLine.leaders = [];
        currentLeader = { from, to, style: leaderStyle };
        currentLine.leaders.push(currentLeader);
      }

      if (stop) {
        validateTabStopVal(stop);

        // For non-start alignments (end, center, decimal), use look-ahead measurement
        // to properly align ALL content until the next tab or end of line
        if (stop.val === 'end' || stop.val === 'center' || stop.val === 'decimal') {
          // Measure all content from the next run until the next tab or end of paragraph
          const groupMeasure = measureTabAlignmentGroup(
            runIndex + 1,
            runsToProcess,
            ctx,
            decimalSeparator,
            fontContext,
          );

          if (groupMeasure.totalWidth > 0) {
            // Calculate the aligned starting X position based on total group width
            const relativeTarget = clampedTarget - effectiveIndent;
            let groupStartX: number;
            if (stop.val === 'end') {
              // Right-align: position so right edge of group is at tab stop
              groupStartX = Math.max(0, relativeTarget - groupMeasure.totalWidth);
            } else if (stop.val === 'center') {
              // Center-align: position so center of group is at tab stop
              groupStartX = Math.max(0, relativeTarget - groupMeasure.totalWidth / 2);
            } else {
              // Decimal-align: position so decimal point is at tab stop
              const beforeDecimal = groupMeasure.beforeDecimalWidth ?? groupMeasure.totalWidth;
              groupStartX = Math.max(0, relativeTarget - beforeDecimal);
            }

            // Update current leader "to" ensuring leaders end where right-aligned content begins
            if (currentLeader) {
              currentLeader.to = groupStartX + effectiveIndent;
            }

            // Set up active tab group for subsequent run processing
            activeTabGroup = {
              measure: groupMeasure,
              startX: groupStartX,
              currentX: groupStartX,
              target: relativeTarget,
              val: stop.val,
            };

            // Update line width to start of aligned group
            // (the actual content will extend from groupStartX to groupStartX + totalWidth)
            currentLine.width = roundValue(groupStartX);
          }

          // Don't set pendingTabAlignment - we're using activeTabGroup instead
          pendingTabAlignment = null;
          pendingLeader = null;
        } else {
          // For start-aligned tabs, use the existing pendingTabAlignment mechanism
          const relativeTarget = clampedTarget - effectiveIndent;
          pendingTabAlignment = {
            target: relativeTarget,
            val: stop.val,
            compensateNegativeLeft:
              stop.val === 'start' && indentLeft < 0 && effectiveIndent === indentLeft && stop.source !== 'explicit',
          };
        }
      } else {
        pendingTabAlignment = null;
        pendingLeader = null;
      }
      pendingRunSpacing = 0;
      continue;
    }

    // Handle image runs
    if (isImageRun(run)) {
      const visualSize = resolveInlineImageVisualSize(run);
      const imageRunFontSize = isValidFontSize(run.fontSize) ? run.fontSize : undefined;
      // Calculate image width including spacing
      const leftSpace = run.distLeft ?? 0;
      const rightSpace = run.distRight ?? 0;
      const imageWidth = visualSize.width + leftSpace + rightSpace;

      // Calculate image height including spacing (for line height)
      const topSpace = run.distTop ?? 0;
      const bottomSpace = run.distBottom ?? 0;
      const imageHeight = visualSize.height + topSpace + bottomSpace;

      // Determine image position - check active tab group first, then pending alignment
      let imageStartX: number | undefined;
      if (activeTabGroup && currentLine) {
        // Part of an active tab alignment group - use pre-calculated position
        imageStartX = activeTabGroup.currentX;
        activeTabGroup.currentX = roundValue(activeTabGroup.currentX + imageWidth);
      } else if (pendingTabAlignment && currentLine) {
        // Legacy: single-segment tab alignment (for start-aligned tabs)
        imageStartX = alignPendingTabForWidth(imageWidth);
      }
      const imagePrecedingTabEndX = imageStartX !== undefined ? consumePendingPrecedingTabEndX() : undefined;

      // Initialize line if needed
      if (!currentLine) {
        currentLine = {
          fromRun: runIndex,
          fromChar: 0,
          toRun: runIndex,
          toChar: 1, // Images are treated as single atomic units
          width: imageWidth,
          maxFontSize: 0,
          maxImageHeight: imageHeight,
          maxWidth: getEffectiveWidth(lines.length === 0 ? initialAvailableWidth : bodyContentWidth),
          spaceCount: 0,
          ...(imageRunFontSize != null
            ? {
                structuralFallbackFontSize: imageRunFontSize,
                structuralFallbackFontInfo: resolveParagraphFontInfo(run as unknown as TextRun),
              }
            : {}),
          imageRunCandidates: [makeInlineImageCandidate(runIndex, run, imageWidth, imageHeight)],
          segments: [
            {
              runIndex,
              fromChar: 0,
              toChar: 1,
              width: imageWidth,
              ...(imageStartX !== undefined ? { x: imageStartX } : {}),
              ...(imagePrecedingTabEndX !== undefined ? { precedingTabEndX: imagePrecedingTabEndX } : {}),
            },
          ],
        };
        pendingRunSpacing = 0;
        // Check if we've reached the end of the tab group
        if (activeTabGroup && runIndex + 1 >= activeTabGroup.measure.endRunIndex) {
          activeTabGroup = null;
        }
        continue;
      }

      // Preserve the tab alignment before the if-else block to avoid TypeScript narrowing issues
      const appliedTabAlign: { target: number; val: TabStop['val'] } | null = lastAppliedTabAlign;

      // Check if image fits on current line (skip fit check if part of tab group - already measured)
      const skipFitCheck = activeTabGroup !== null;
      if (!skipFitCheck && currentLine.width + imageWidth > currentLine.maxWidth && currentLine.width > 0) {
        // Image doesn't fit - finish current line and start new line with image
        trimTrailingWrapSpaces(currentLine);
        const completedLine: Line = closeLineWithMetrics(currentLine);
        lines.push(completedLine);
        tabStopCursor = 0;
        pendingTabAlignment = null;
        pendingLeader = null;
        lastAppliedTabAlign = null;
        activeTabGroup = null;

        // Start new line with the image (body line, so use bodyContentWidth for hanging indent)
        currentLine = {
          fromRun: runIndex,
          fromChar: 0,
          toRun: runIndex,
          toChar: 1,
          width: imageWidth,
          maxFontSize: 0,
          maxImageHeight: imageHeight,
          maxWidth: getEffectiveWidth(bodyContentWidth),
          spaceCount: 0,
          imageRunCandidates: [makeInlineImageCandidate(runIndex, run, imageWidth, imageHeight)],
          segments: [
            {
              runIndex,
              fromChar: 0,
              toChar: 1,
              width: imageWidth,
            },
          ],
        };
      } else {
        // Image fits on current line - append it
        currentLine.toRun = runIndex;
        currentLine.toChar = 1;
        currentLine.width = roundValue(currentLine.width + imageWidth);
        currentLine.maxImageHeight = Math.max(currentLine.maxImageHeight ?? 0, imageHeight);
        (currentLine.imageRunCandidates ??= []).push(makeInlineImageCandidate(runIndex, run, imageWidth, imageHeight));
        if (!currentLine.segments) currentLine.segments = [];
        currentLine.segments.push({
          runIndex,
          fromChar: 0,
          toChar: 1,
          width: imageWidth,
          ...(imageStartX !== undefined ? { x: imageStartX } : {}),
          ...(imagePrecedingTabEndX !== undefined ? { precedingTabEndX: imagePrecedingTabEndX } : {}),
        });
      }

      // Check if we've reached the end of the tab group
      if (activeTabGroup && runIndex + 1 >= activeTabGroup.measure.endRunIndex) {
        activeTabGroup = null;
      }

      // Clamp width if aligned to an end tab to avoid rounding drift
      // Note: Using type assertion to work around TypeScript control flow narrowing issue
      // where TS incorrectly infers `never` type after the if-else block above.
      const tabAlign = appliedTabAlign as { target: number; val: TabStop['val'] } | null;
      if (tabAlign && currentLine && tabAlign.val === 'end') {
        currentLine.width = roundValue(tabAlign.target);
      }
      lastAppliedTabAlign = null;
      pendingRunSpacing = 0;

      continue;
    }

    // Handle math runs (atomic, pre-computed dimensions like images)
    if (run.kind === 'math') {
      const mathRun = run as { width: number; height: number };
      const mathWidth = mathRun.width ?? 20;
      const mathHeight = mathRun.height ?? 24;

      if (!currentLine) {
        currentLine = {
          fromRun: runIndex,
          fromChar: 0,
          toRun: runIndex,
          toChar: 1,
          width: mathWidth,
          maxFontSize: lastFontSize,
          maxWidth: getEffectiveWidth(lines.length === 0 ? initialAvailableWidth : bodyContentWidth),
          segments: [{ runIndex, fromChar: 0, toChar: 1, width: mathWidth }],
          spaceCount: 0,
          maxImageHeight: mathHeight,
        };
      } else {
        currentLine.toRun = runIndex;
        currentLine.toChar = 1;
        currentLine.width = roundValue(currentLine.width + mathWidth);
        currentLine.maxImageHeight = Math.max(currentLine.maxImageHeight ?? 0, mathHeight);
        if (!currentLine.segments) currentLine.segments = [];
        currentLine.segments.push({ runIndex, fromChar: 0, toChar: 1, width: mathWidth });
      }
      pendingRunSpacing = 0;
      continue;
    }

    // Handle field annotation runs (pill-styled form fields)
    if (isFieldAnnotationRun(run)) {
      // Use displayLabel for text measurement, with fallback defaults
      const rawDisplayText = run.displayLabel || '';
      const displayText = applyTextTransform(rawDisplayText, run);

      // Use annotation's typography or fallback to defaults (16px Arial is standard)
      const annotationFontSize =
        typeof run.fontSize === 'number'
          ? run.fontSize
          : typeof run.fontSize === 'string'
            ? parseFloat(run.fontSize) || DEFAULT_FIELD_ANNOTATION_FONT_SIZE
            : DEFAULT_FIELD_ANNOTATION_FONT_SIZE;
      // Resolve to the physical render family (a per-document fonts.map or the bundled substitute),
      // the same family the pill paints, so the measured pill width matches the painted glyphs.
      const annotationFontFamily = fontContext.resolvePhysical(run.fontFamily || 'Arial, sans-serif', faceOf(run));

      // Build font string for measurement
      const fontWeight = run.bold ? 'bold' : 'normal';
      const fontStyle = run.italic ? 'italic' : 'normal';
      const annotationFont = `${fontStyle} ${fontWeight} ${annotationFontSize}px ${annotationFontFamily}`;
      ctx.font = annotationFont;

      // Measure text width
      const textWidth = displayText ? measuredTextWidth(displayText, annotationFont, 0, ctx) : 0;

      const annotationHorizontalPadding = run.highlighted === false ? 0 : FIELD_ANNOTATION_PILL_PADDING;
      const annotationVerticalPadding = run.highlighted === false ? 0 : FIELD_ANNOTATION_VERTICAL_PADDING;

      // Add pill styling overhead: border (2px each side) + padding (2px each side) = 8px total
      const annotationWidth = textWidth + annotationHorizontalPadding;

      // Calculate height including pill styling
      let annotationHeight = annotationFontSize * FIELD_ANNOTATION_LINE_HEIGHT_MULTIPLIER + annotationVerticalPadding;

      // Signature images are capped to 28px in the renderer; reflect that in measurement.
      if (run.variant === 'signature' && run.imageSrc) {
        const signatureHeight = 28 + annotationVerticalPadding;
        annotationHeight = Math.max(annotationHeight, signatureHeight);
      }

      // Image annotations use explicit size when provided.
      if (run.variant === 'image' && run.imageSrc && run.size?.height) {
        const imageHeight = run.size.height + annotationVerticalPadding;
        annotationHeight = Math.max(annotationHeight, imageHeight);
      }

      if (run.variant === 'html' && run.size?.height) {
        annotationHeight = Math.max(annotationHeight, run.size.height);
      }

      // If a tab alignment is pending, apply it
      let annotationStartX: number | undefined;
      if (pendingTabAlignment && currentLine) {
        annotationStartX = alignPendingTabForWidth(annotationWidth);
      }
      const annotationPrecedingTabEndX = annotationStartX !== undefined ? consumePendingPrecedingTabEndX() : undefined;

      // Initialize line if needed
      if (!currentLine) {
        currentLine = {
          fromRun: runIndex,
          fromChar: 0,
          toRun: runIndex,
          toChar: 1, // Field annotations are atomic units
          width: annotationWidth,
          maxFontSize: annotationHeight,
          maxWidth: getEffectiveWidth(lines.length === 0 ? initialAvailableWidth : bodyContentWidth),
          spaceCount: 0,
          segments: [
            {
              runIndex,
              fromChar: 0,
              toChar: 1,
              width: annotationWidth,
              ...(annotationStartX !== undefined ? { x: annotationStartX } : {}),
              ...(annotationPrecedingTabEndX !== undefined ? { precedingTabEndX: annotationPrecedingTabEndX } : {}),
            },
          ],
        };
        pendingRunSpacing = 0;
        continue;
      }

      // Check if annotation fits on current line
      if (currentLine.width + annotationWidth > currentLine.maxWidth && currentLine.width > 0) {
        // Doesn't fit - finish current line and start new one
        trimTrailingWrapSpaces(currentLine);
        const completedLine: Line = closeLineWithMetrics(currentLine);
        lines.push(completedLine);
        tabStopCursor = 0;
        pendingTabAlignment = null;
        pendingLeader = null;
        lastAppliedTabAlign = null;

        // Start new line with the annotation (body line, so use bodyContentWidth for hanging indent)
        currentLine = {
          fromRun: runIndex,
          fromChar: 0,
          toRun: runIndex,
          toChar: 1,
          width: annotationWidth,
          maxFontSize: annotationHeight,
          maxWidth: getEffectiveWidth(bodyContentWidth),
          spaceCount: 0,
          segments: [
            {
              runIndex,
              fromChar: 0,
              toChar: 1,
              width: annotationWidth,
            },
          ],
        };
      } else {
        // Fits on current line - append it
        currentLine.toRun = runIndex;
        currentLine.toChar = 1;
        currentLine.width = roundValue(currentLine.width + annotationWidth);
        currentLine.maxFontSize = Math.max(currentLine.maxFontSize, annotationHeight);
        if (!currentLine.segments) currentLine.segments = [];
        currentLine.segments.push({
          runIndex,
          fromChar: 0,
          toChar: 1,
          width: annotationWidth,
          ...(annotationStartX !== undefined ? { x: annotationStartX } : {}),
          ...(annotationPrecedingTabEndX !== undefined ? { precedingTabEndX: annotationPrecedingTabEndX } : {}),
        });
      }

      // Handle end tab alignment
      const tabAlign = lastAppliedTabAlign as { target: number; val: TabStop['val'] } | null;
      if (tabAlign && currentLine && tabAlign.val === 'end') {
        currentLine.width = roundValue(tabAlign.target);
      }
      lastAppliedTabAlign = null;
      pendingRunSpacing = 0;

      continue;
    }

    // At this point, we've filtered out break, lineBreak, tab, image, math,
    // and fieldAnnotation runs. The remaining run must be TextRun.
    if (!('text' in run) || !('fontSize' in run)) {
      // Safety check - skip if this isn't a TextRun
      pendingRunSpacing = 0;
      continue;
    }
    const textRun = run as TextRun;

    if (isEmptySdtPlaceholderRun(textRun)) {
      const placeholderFont = resolveParagraphFontString(textRun).font;
      const placeholderText = applyTextTransform(EMPTY_SDT_PLACEHOLDER_TEXT, textRun);
      const measuredPlaceholderWidth =
        measuredTextWidth(placeholderText, placeholderFont, textRun.letterSpacing ?? 0, ctx) *
        getRunHorizontalScale(textRun);
      const fallbackPlaceholderWidth =
        placeholderText.length * textRun.fontSize * 0.45 * getRunHorizontalScale(textRun);
      const placeholderWidth =
        textRun.sdt?.type === 'structuredContent' && textRun.sdt.appearance === 'hidden'
          ? 0
          : measuredPlaceholderWidth > 0
            ? measuredPlaceholderWidth
            : fallbackPlaceholderWidth;

      if (!currentLine) {
        currentLine = {
          fromRun: runIndex,
          fromChar: 0,
          toRun: runIndex,
          toChar: 0,
          width: placeholderWidth,
          maxFontSize: lineHeightFontSize(textRun),
          maxFontInfo: resolveParagraphFontInfo(textRun),
          maxWidth: getEffectiveWidth(lines.length === 0 ? initialAvailableWidth : bodyContentWidth),
          segments: [{ runIndex, fromChar: 0, toChar: 0, width: placeholderWidth }],
          spaceCount: 0,
        };
      } else {
        const boundarySpacing = resolveBoundarySpacing(currentLine.width, true, textRun);
        if (
          currentLine.width + boundarySpacing + placeholderWidth > currentLine.maxWidth - WIDTH_FUDGE_PX &&
          currentLine.width > 0
        ) {
          trimTrailingWrapSpaces(currentLine);
          const completedLine: Line = closeLineWithMetrics(currentLine);
          lines.push(completedLine);
          tabStopCursor = 0;
          pendingTabAlignment = null;
          pendingLeader = null;
          lastAppliedTabAlign = null;
          activeTabGroup = null;

          currentLine = {
            fromRun: runIndex,
            fromChar: 0,
            toRun: runIndex,
            toChar: 0,
            width: placeholderWidth,
            maxFontSize: lineHeightFontSize(textRun),
            maxFontInfo: resolveParagraphFontInfo(textRun),
            maxWidth: getEffectiveWidth(bodyContentWidth),
            segments: [{ runIndex, fromChar: 0, toChar: 0, width: placeholderWidth }],
            spaceCount: 0,
          };
        } else {
          currentLine.toRun = runIndex;
          currentLine.toChar = 0;
          currentLine.width = roundValue(currentLine.width + boundarySpacing + placeholderWidth);
          updateLineFontMetrics(currentLine, textRun, fontContext, resolveParagraphFontInfo(textRun));
          appendSegment(currentLine.segments, runIndex, 0, 0, placeholderWidth);
        }
      }

      lastFontSize = textRun.fontSize;
      hasSeenTextRun = true;
      pendingRunSpacing = 0;
      continue;
    }

    if (isBookmarkMarkerRun(textRun)) {
      if (hasRenderableParagraphContent) {
        continue;
      }

      const markerLength = textRun.text.length;
      const markerFallbackFontSize = fallbackFontSize;
      const markerFallbackFontInfo = fallbackFontInfo;

      if (!currentLine) {
        currentLine = {
          fromRun: runIndex,
          fromChar: 0,
          toRun: runIndex,
          toChar: markerLength,
          width: 0,
          maxFontSize: 0,
          maxWidth: getEffectiveWidth(lines.length === 0 ? initialAvailableWidth : bodyContentWidth),
          segments: [{ runIndex, fromChar: 0, toChar: markerLength, width: 0 }],
          spaceCount: 0,
          structuralFallbackFontSize: markerFallbackFontSize,
          ...(markerFallbackFontInfo ? { structuralFallbackFontInfo: markerFallbackFontInfo } : {}),
        };
      } else {
        currentLine.toRun = runIndex;
        currentLine.toChar = markerLength;
        appendSegment(currentLine.segments, runIndex, 0, markerLength, 0);
        if (currentLine.maxFontSize <= 0) {
          currentLine.structuralFallbackFontSize ??= markerFallbackFontSize;
          if (markerFallbackFontInfo) currentLine.structuralFallbackFontInfo ??= markerFallbackFontInfo;
        }
      }

      pendingRunSpacing = 0;
      continue;
    }

    // Handle text runs
    if (textRun.text === '') {
      pendingRunSpacing = 0;
      continue;
    }

    if (textRun.vanish === true) {
      const hiddenLength = textRun.text.length;
      if (!currentLine) {
        currentLine = {
          fromRun: runIndex,
          fromChar: 0,
          toRun: runIndex,
          toChar: hiddenLength,
          width: 0,
          maxFontSize: 0,
          maxWidth: getEffectiveWidth(lines.length === 0 ? initialAvailableWidth : bodyContentWidth),
          segments: [{ runIndex, fromChar: 0, toChar: hiddenLength, width: 0 }],
          spaceCount: 0,
          structuralFallbackFontSize: lineHeightFontSize(textRun),
          structuralFallbackFontInfo: resolveParagraphFontInfo(textRun),
        };
      } else {
        currentLine.toRun = runIndex;
        currentLine.toChar = hiddenLength;
        appendSegment(currentLine.segments, runIndex, 0, hiddenLength, 0);
        if (currentLine.maxFontSize <= 0) {
          currentLine.structuralFallbackFontSize ??= lineHeightFontSize(textRun);
          currentLine.structuralFallbackFontInfo ??= resolveParagraphFontInfo(textRun);
        }
      }

      pendingRunSpacing = 0;
      continue;
    }

    lastFontSize = textRun.fontSize;
    hasSeenTextRun = true;

    const { font } = resolveParagraphFontString(textRun);
    const tabSegments = textRun.text.split('\t');

    let charPosInRun = 0;

    for (let segmentIndex = 0; segmentIndex < tabSegments.length; segmentIndex++) {
      const segment = tabSegments[segmentIndex];
      const isLastSegment = segmentIndex === tabSegments.length - 1;
      if (/^[ ]+$/.test(segment)) {
        const isRunStart = charPosInRun === 0 && segmentIndex === 0;
        const isTerminalWrapSpace = isLastSegment && endsAtLineBoundary(runIndex);
        const spacesLength = segment.length;
        const spacesStartChar = charPosInRun;
        const spacesEndChar = charPosInRun + spacesLength;
        const spacesWidth = resolveParagraphRunWidth(segment, font, ctx, run, spacesStartChar);

        if (!currentLine) {
          currentLine = {
            fromRun: runIndex,
            fromChar: spacesStartChar,
            toRun: runIndex,
            toChar: spacesEndChar,
            width: spacesWidth,
            maxFontSize: lineHeightFontSize(run),
            maxFontInfo: resolveParagraphFontInfo(run),
            maxWidth: getEffectiveWidth(lines.length === 0 ? initialAvailableWidth : bodyContentWidth),
            segments: [{ runIndex, fromChar: spacesStartChar, toChar: spacesEndChar, width: spacesWidth }],
            spaceCount: spacesLength,
          };
        } else {
          const boundarySpacing = resolveBoundarySpacing(currentLine.width, isRunStart, run as TextRun);
          const spaceOverflows =
            currentLine.width + boundarySpacing + spacesWidth > currentLine.maxWidth - WIDTH_FUDGE_PX &&
            currentLine.width > 0;
          // Once part of a terminal cluster has collapsed, the rest must collapse too, even
          // though each later space now fits against the trimmed width.
          if (isTerminalWrapSpace && (spaceOverflows || currentLine.collapsedWrapSpaces)) {
            collapseTerminalWrapSpaces(currentLine, runIndex, spacesStartChar, spacesEndChar);
            charPosInRun = spacesEndChar;
            continue;
          }
          if (spaceOverflows) {
            trimTrailingWrapSpaces(currentLine);
            const completedLine: Line = closeLineWithMetrics(currentLine);
            lines.push(completedLine);
            tabStopCursor = 0;
            pendingTabAlignment = null;
            pendingLeader = null;
            lastAppliedTabAlign = null;

            // Body line, so use bodyContentWidth for hanging indent
            currentLine = {
              fromRun: runIndex,
              fromChar: spacesStartChar,
              toRun: runIndex,
              toChar: spacesEndChar,
              width: spacesWidth,
              maxFontSize: lineHeightFontSize(run),
              maxFontInfo: resolveParagraphFontInfo(run),
              maxWidth: getEffectiveWidth(bodyContentWidth),
              segments: [{ runIndex, fromChar: spacesStartChar, toChar: spacesEndChar, width: spacesWidth }],
              spaceCount: spacesLength,
            };
          } else {
            currentLine.toRun = runIndex;
            currentLine.toChar = spacesEndChar;
            currentLine.width = roundValue(currentLine.width + boundarySpacing + spacesWidth);
            updateLineFontMetrics(currentLine, run, fontContext, resolveParagraphFontInfo(run));
            appendSegment(currentLine.segments, runIndex, spacesStartChar, spacesEndChar, spacesWidth);
            currentLine.spaceCount += spacesLength;
          }
        }

        charPosInRun = spacesEndChar;
        continue;
      }

      const words = segment.split(' ');
      // `split(' ')` produces empty strings for leading, consecutive, AND trailing spaces.
      // We need to know the last non-empty word index so we don't double-count a trailing space:
      //   "Por " → ["Por", ""]  (one trailing space)
      // If we treated "Por" as "not last", we'd append a space AND also process the "" token.
      let lastNonEmptyWordIndex = -1;
      for (let i = words.length - 1; i >= 0; i -= 1) {
        if (words[i] !== '') {
          lastNonEmptyWordIndex = i;
          break;
        }
      }

      // Determine segment position - check active tab group first, then pending alignment
      let segmentStartX: number | undefined;
      let inActiveTabGroup = false;
      if (activeTabGroup && currentLine) {
        // Part of an active tab alignment group - use pre-calculated position
        segmentStartX = activeTabGroup.currentX;
        inActiveTabGroup = true;
        // Note: activeTabGroup.currentX will be updated as we process words in this segment
      } else if (currentLine && pendingTabAlignment) {
        // Legacy: single-segment tab alignment (for start-aligned tabs)
        segmentStartX = alignSegmentAtTab(segment, font, run, charPosInRun);
        // After alignment, currentLine.width is the X position where this segment starts
        if (segmentStartX == null) {
          segmentStartX = currentLine.width;
        }
      }
      let hasPendingSegmentTabGeometry = segmentStartX !== undefined;
      const consumeSegmentPrecedingTabEndX = (): number | undefined => {
        if (!hasPendingSegmentTabGeometry) return undefined;
        hasPendingSegmentTabGeometry = false;
        return consumePendingPrecedingTabEndX();
      };
      const clearWrapState = (): void => {
        segmentStartX = undefined;
        hasPendingSegmentTabGeometry = false;
        clearPendingPrecedingTabEndX();
      };

      for (let wordIndex = 0; wordIndex < words.length; wordIndex++) {
        wordBoundariesUntilCheckpoint -= 1;
        if (wordBoundariesUntilCheckpoint === 0) {
          wordBoundariesUntilCheckpoint = WORD_BOUNDARIES_PER_MEASUREMENT_CHECKPOINT;
          const wordCheckpoint = measurementCheckpointIfDue(fontContext);
          if (wordCheckpoint) await wordCheckpoint;
        }
        const word = words[wordIndex];
        /**
         * Handle empty strings from split(' ') representing space characters.
         *
         * Background: segment.split(' ') produces empty strings for leading/consecutive spaces:
         *   " Hello" → ['', 'Hello']  (leading space)
         *   "A  B"   → ['A', '', 'B'] (consecutive spaces)
         *
         * Previously these were skipped (just incremented charPosInRun), causing spaces
         * to be dropped from measurements and rendering.
         */
        if (word === '') {
          // Empty string from split(' ') indicates a space character (leading or consecutive spaces).
          // We must add the space width to the line, not just skip it.
          const spaceStartChar = charPosInRun;
          const spaceEndChar = charPosInRun + 1;
          const singleSpaceWidth = resolveParagraphRunWidth(' ', font, ctx, run, spaceStartChar);
          const isRunStart = charPosInRun === 0 && segmentIndex === 0 && wordIndex === 0;
          const isTerminalWrapSpace =
            isLastSegment && wordIndex > lastNonEmptyWordIndex && endsAtLineBoundary(runIndex);

          if (!currentLine) {
            // Start a new line with just the space
            currentLine = {
              fromRun: runIndex,
              fromChar: spaceStartChar,
              toRun: runIndex,
              toChar: spaceEndChar,
              width: singleSpaceWidth,
              maxFontSize: lineHeightFontSize(run),
              maxFontInfo: resolveParagraphFontInfo(run),
              maxWidth: getEffectiveWidth(lines.length === 0 ? initialAvailableWidth : bodyContentWidth),
              segments: [{ runIndex, fromChar: spaceStartChar, toChar: spaceEndChar, width: singleSpaceWidth }],
              spaceCount: 1,
            };
          } else {
            // Add space to existing line
            // Safe cast: only TextRuns produce word segments from split(), other run types are handled earlier
            const boundarySpacing = resolveBoundarySpacing(currentLine.width, isRunStart, run as TextRun);
            const spaceOverflows =
              currentLine.width + boundarySpacing + singleSpaceWidth > currentLine.maxWidth - WIDTH_FUDGE_PX &&
              currentLine.width > 0;
            if (isTerminalWrapSpace && (spaceOverflows || currentLine.collapsedWrapSpaces)) {
              collapseTerminalWrapSpaces(currentLine, runIndex, spaceStartChar, spaceEndChar);
              charPosInRun = spaceEndChar;
              continue;
            }
            if (spaceOverflows) {
              // Space doesn't fit - finish current line and start new one with the space
              trimTrailingWrapSpaces(currentLine);
              const completedLine: Line = closeLineWithMetrics(currentLine);
              lines.push(completedLine);
              tabStopCursor = 0;
              pendingTabAlignment = null;
              pendingLeader = null;
              lastAppliedTabAlign = null;
              activeTabGroup = null;
              clearWrapState();

              // Body line, so use bodyContentWidth for hanging indent
              currentLine = {
                fromRun: runIndex,
                fromChar: spaceStartChar,
                toRun: runIndex,
                toChar: spaceEndChar,
                width: singleSpaceWidth,
                maxFontSize: lineHeightFontSize(run),
                maxFontInfo: resolveParagraphFontInfo(run),
                maxWidth: getEffectiveWidth(bodyContentWidth),
                segments: [{ runIndex, fromChar: spaceStartChar, toChar: spaceEndChar, width: singleSpaceWidth }],
                spaceCount: 1,
              };
            } else {
              // Space fits - add it to current line
              currentLine.toRun = runIndex;
              currentLine.toChar = spaceEndChar;
              currentLine.width = roundValue(currentLine.width + boundarySpacing + singleSpaceWidth);
              updateLineFontMetrics(currentLine, run, fontContext, resolveParagraphFontInfo(run));
              // If in an active tab alignment group, use explicit X positioning
              let spaceExplicitX: number | undefined;
              let spacePrecedingTabEndX: number | undefined;
              if (inActiveTabGroup && activeTabGroup) {
                spaceExplicitX = activeTabGroup.currentX;
                activeTabGroup.currentX = roundValue(activeTabGroup.currentX + singleSpaceWidth);
              } else if (wordIndex === 0 && segmentStartX !== undefined) {
                spaceExplicitX = segmentStartX;
                spacePrecedingTabEndX = consumeSegmentPrecedingTabEndX();
              }
              appendSegment(
                currentLine.segments,
                runIndex,
                spaceStartChar,
                spaceEndChar,
                singleSpaceWidth,
                spaceExplicitX,
                spacePrecedingTabEndX,
              );
              currentLine.spaceCount += 1;
            }
          }

          charPosInRun = spaceEndChar;
          continue;
        }
        const wordStartChar = charPosInRun;
        const wordOnlyWidth = resolveParagraphRunWidth(word, font, ctx, run, wordStartChar);
        // NBSP embedded inside `word` (e.g. "10\u00A0km" stays one token since
        // `.split(' ')` only splits on U+0020) is a justify-relevant space just like a
        // literal space -- see countNbspOccurrences. Sites below that commit the whole
        // `word` add this; sites that commit only a chunk/prefix of `word` (long-word
        // chunking, hyphen-break) recompute the count for that exact substring instead.
        const wordNbspCount = countNbspOccurrences(word);
        // Only include the implicit single delimiter space when there is a later non-empty word
        // in this same segment (i.e., before the next word). Do NOT include one before tabs or
        // at the end of the segment; those spaces are represented explicitly by "" tokens.
        const shouldIncludeDelimiterSpace = wordIndex < lastNonEmptyWordIndex;
        const wordEndNoSpace = charPosInRun + word.length;
        const spaceWidth = shouldIncludeDelimiterSpace
          ? resolveParagraphRunWidth(' ', font, ctx, run, wordEndNoSpace)
          : 0;
        const wordCommitWidth = wordOnlyWidth + spaceWidth;
        const wordEndWithSpace = wordEndNoSpace + (shouldIncludeDelimiterSpace ? 1 : 0);

        // Hoisted above the break paths so the CJK line-fill decision consults
        // exactly the boundary spacing / TOC posture the fit check below uses.
        const isRunStart = charPosInRun === 0 && segmentIndex === 0 && wordIndex === 0;
        // Safe cast: only TextRuns produce word segments from split(), other run types are handled earlier
        const boundarySpacing = currentLine ? resolveBoundarySpacing(currentLine.width, isRunStart, run as TextRun) : 0;
        // For TOC entries, never break lines - allow them to extend beyond maxWidth
        const isTocEntry = block.attrs?.isTocEntry;

        // Compute the ordinary wrap decision before long-token admission. A
        // hanging first line can be wider than the continuation line that will
        // actually receive a wrapped token.
        const justifyAlignment = block.attrs?.alignment === 'justify';
        let totalWidthWithWord = wordOnlyWidth;
        let availableWidth = 0;
        let shouldBreak = false;
        let compressedWidth: number | null = null;
        if (currentLine) {
          totalWidthWithWord = currentLine.width + boundarySpacing + wordOnlyWidth;
          const firstLineRunIndex = currentLine.segments[0]?.runIndex;
          const spansRunBoundary =
            firstLineRunIndex != null &&
            currentLine.segments.some((lineSegment) => lineSegment.runIndex !== firstLineRunIndex);
          const acceptsSubpixelOverflow = !justifyAlignment && (spansRunBoundary || currentLine.hasExplicitTabStops);
          availableWidth = currentLine.maxWidth + (acceptsSubpixelOverflow ? WIDTH_FUDGE_PX : -WIDTH_FUDGE_PX);
          shouldBreak =
            !inActiveTabGroup && totalWidthWithWord > availableWidth && currentLine.width > 0 && !isTocEntry;

          if (shouldBreak && justifyAlignment) {
            const candidateSpaces = currentLine.spaceCount ?? 0;
            if (candidateSpaces > 0) {
              const overflow = totalWidthWithWord - availableWidth;
              if (overflow > 0) {
                const baseSpaceWidth =
                  spaceWidth ||
                  resolveParagraphRunWidth(' ', font, ctx, run, wordEndNoSpace) ||
                  Math.max(1, boundarySpacing);
                if (
                  fitsWordJustificationCompression(
                    overflow,
                    wordOnlyWidth,
                    candidateSpaces,
                    baseSpaceWidth,
                    (run as TextRun).fontFamily,
                    (isWordLayoutList && wordLayout?.indentLeftPx === 0 && (wordLayout.tabsPx?.length ?? 0) > 0) ||
                      paragraphEndsWithTerminalTabBreak,
                  )
                ) {
                  shouldBreak = false;
                  compressedWidth = availableWidth;
                }
              }
            }
          }
        }

        /**
         * CJK clauses arrive as ONE "word" because `split(' ')` only
         * sees ASCII spaces. Wrapping such a word whole strands the preceding
         * run alone on a short line and opens the next line with the clause's
         * leading punctuation. Word (and CSS `line-break: normal`) breaks CJK
         * between ideographs instead, so when the word does not fit the current
         * line's remainder we route it through the character chunker and give
         * the first chunk that remainder as its budget. Requires at least one
         * character to fit; otherwise the plain wrap below is already correct.
         */
        let cjkLineFillWidth = 0;
        let useCjkLineFill = false;
        if (
          currentLine &&
          currentLine.width > 0 &&
          !inActiveTabGroup &&
          !isTocEntry &&
          // Drop caps narrow the available width by line index, but the chunker
          // budgets every continuation chunk before any of them is pushed, so the
          // two would disagree. Keep drop-cap paragraphs on the plain wrap path.
          !(dropCapMeasure && dropCapMeasure.mode === 'drop') &&
          // A lone closer is eligible too: OOXML routinely fragments punctuation
          // into its own run, and such a word has no CJK neighbour to make
          // `hasCjkBreakOpportunity` true, yet it still may not open a line.
          (hasCjkBreakOpportunity(word) || KINSOKU_FORBIDDEN_LINE_START.has(word)) &&
          currentLine.width + boundarySpacing + wordOnlyWidth > currentLine.maxWidth - WIDTH_FUDGE_PX
        ) {
          const remainingWidth = currentLine.maxWidth - WIDTH_FUDGE_PX - currentLine.width - boundarySpacing;
          // The first *break unit*, not the first character: a token like
          // `SuperDoc中文` may be chunked between its ideographs, but its Latin
          // head has to move as a whole, so filling the line with part of it
          // would split the word.
          const leadUnit = firstBreakUnit(word);
          // Take the chunker whenever that unit fits, and also when the clause
          // opens with a forbidden closer: hanging it here is the whole point of
          // the line-start rule, and the plain wrap below would open the next
          // line with it instead.
          if (
            remainingWidth >= resolveParagraphRunWidth(leadUnit, font, ctx, run, wordStartChar) ||
            KINSOKU_FORBIDDEN_LINE_START.has(leadUnit)
          ) {
            useCjkLineFill = true;
            cjkLineFillWidth = remainingWidth;
          }
        }

        const tabOnlyRemainingWidth =
          currentLine != null && currentLine.segments.length === 0 && currentLine.width > 0
            ? Math.max(1, currentLine.maxWidth - currentLine.width)
            : null;
        const effectiveMaxWidth =
          currentLine && shouldBreak
            ? getEffectiveWidth(bodyContentWidth, lines.length + 1)
            : (currentLine?.maxWidth ?? getEffectiveWidth(lines.length === 0 ? initialAvailableWidth : contentWidth));

        // Character-level word breaking: if a single word exceeds maxWidth, break it into chunks
        // This handles narrow table cells where long words would otherwise overflow and be clipped
        // Note: We use effectiveMaxWidth without WIDTH_FUDGE_PX here because:
        // - WIDTH_FUDGE_PX is meant to give leeway for fitting text that's very close
        // - We only want to break mid-word when the word truly exceeds available width
        // - Breaking words that exactly fit would cause unnecessary fragmentation
        if (!useCjkLineFill && wordOnlyWidth > effectiveMaxWidth + WIDTH_FUDGE_PX && word.length > 1) {
          // First, finish any existing currentLine before processing the long word
          // Only push the line if it has actual text content (segments), not just tab positioning.
          // If the line only has width from tab advances but no text, we should keep it so the
          // long word can use the pending tab alignment.
          if (currentLine && currentLine.width > 0 && currentLine.segments && currentLine.segments.length > 0) {
            trimTrailingWrapSpaces(currentLine);
            const completedLine: Line = closeLineWithMetrics(currentLine);
            lines.push(completedLine);
            tabStopCursor = 0;
            pendingTabAlignment = null;
            pendingLeader = null;
            currentLine = null;
            clearWrapState();
          }

          // Break the word into chunks that fit within maxWidth
          const lineMaxWidth = getEffectiveWidth(lines.length === 0 ? initialAvailableWidth : contentWidth);

          // If currentLine exists with tab positioning but no text segments, we need to handle
          // the first chunk specially to preserve the tab alignment
          const chunks = await breakWordIntoChunks(
            word,
            lineMaxWidth,
            font,
            ctx,
            run,
            wordStartChar,
            {
              ...(tabOnlyRemainingWidth != null ? { firstChunkWidth: tabOnlyRemainingWidth } : {}),
              applyKinsoku: hasCjkBreakOpportunity(word),
            },
            fontContext,
            resolveParagraphRunWidth,
          );

          // Process all chunks except the last one as complete lines
          let chunkCharOffset = wordStartChar;
          for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
            const chunk = chunks[chunkIndex];
            const chunkStartChar = chunkCharOffset;
            const chunkEndChar = chunkCharOffset + chunk.text.length;
            const isLastChunk = chunkIndex === chunks.length - 1;
            const isFirstChunk = chunkIndex === 0;

            // First chunk: if we have a tab-only line, add to it; otherwise create new line
            if (isFirstChunk && tabOnlyRemainingWidth != null && currentLine && currentLine.segments) {
              // Add first chunk to the existing line with tab positioning
              currentLine.toRun = runIndex;
              currentLine.toChar = chunkEndChar;
              currentLine.width = roundValue(currentLine.width + chunk.width);
              currentLine.maxFontSize = Math.max(currentLine.maxFontSize, lineHeightFontSize(run));
              currentLine.maxFontInfo = resolveParagraphFontInfo(run);
              currentLine.segments.push({
                runIndex,
                fromChar: chunkStartChar,
                toChar: chunkEndChar,
                width: chunk.width,
              });
              currentLine.spaceCount += countNbspOccurrences(chunk.text);

              if (isLastChunk) {
                // If this is also the last chunk, keep currentLine open for more content
                const ls = getScaledLetterSpacing(run as TextRun);
                if (
                  shouldIncludeDelimiterSpace &&
                  currentLine.width + spaceWidth <= currentLine.maxWidth - WIDTH_FUDGE_PX
                ) {
                  currentLine.toChar = wordEndWithSpace;
                  currentLine.width = roundValue(currentLine.width + spaceWidth + ls);
                  charPosInRun = wordEndWithSpace;
                  currentLine.spaceCount += 1;
                } else {
                  charPosInRun = wordEndWithSpace;
                }
              } else {
                // More chunks to come - finish this line and push it
                trimTrailingWrapSpaces(currentLine);
                const completedLine: Line = closeLineWithMetrics(currentLine);
                lines.push(completedLine);
                tabStopCursor = 0;
                pendingTabAlignment = null;
                pendingLeader = null;
                currentLine = null;
                clearWrapState();
              }
            } else if (isLastChunk) {
              // Last chunk becomes the start of a new line (will be continued with next word)
              currentLine = {
                fromRun: runIndex,
                fromChar: chunkStartChar,
                toRun: runIndex,
                toChar: chunkEndChar,
                width: chunk.width,
                maxFontSize: lineHeightFontSize(run),
                maxFontInfo: resolveParagraphFontInfo(run),
                maxWidth: getEffectiveWidth(contentWidth),
                segments: [{ runIndex, fromChar: chunkStartChar, toChar: chunkEndChar, width: chunk.width }],
                spaceCount: countNbspOccurrences(chunk.text),
              };
              // If trailing space fits, include it
              const ls = getScaledLetterSpacing(run as TextRun);
              if (
                shouldIncludeDelimiterSpace &&
                currentLine.width + spaceWidth <= currentLine.maxWidth - WIDTH_FUDGE_PX
              ) {
                currentLine.toChar = wordEndWithSpace;
                currentLine.width = roundValue(currentLine.width + spaceWidth + ls);
                charPosInRun = wordEndWithSpace;
                currentLine.spaceCount += 1;
              } else {
                charPosInRun = wordEndWithSpace;
              }
            } else {
              // Not the last chunk - create a complete line
              const chunkLineMaxWidth = getEffectiveWidth(lines.length === 0 ? initialAvailableWidth : contentWidth);
              const metrics = calculateTypographyMetrics(
                textRun.fontSize,
                spacing,
                resolveParagraphFontInfo(textRun),
                fontContext,
              );
              // spaceCount intentionally omitted (left undefined), not forced to 0: both
              // render-line.ts (`line.spaceCount ?? recount`) and text-measurement.ts
              // (`line.spaceCount ?? 0` then `=== 0` recount) already recompute a
              // NBSP-inclusive count from this line's own text when spaceCount is
              // undefined, so this closed single-chunk line self-heals downstream.
              const chunkLine: Line = {
                fromRun: runIndex,
                fromChar: chunkStartChar,
                toRun: runIndex,
                toChar: chunkEndChar,
                width: chunk.width,
                maxWidth: chunkLineMaxWidth,
                segments: [{ runIndex, fromChar: chunkStartChar, toChar: chunkEndChar, width: chunk.width }],
                ...metrics,
              };
              addBarTabsToLine(chunkLine);
              lines.push(chunkLine);
              clearWrapState();
            }
            chunkCharOffset = chunkEndChar;
          }
          continue;
        }

        if (!currentLine) {
          currentLine = {
            fromRun: runIndex,
            fromChar: wordStartChar,
            toRun: runIndex,
            toChar: wordEndNoSpace,
            width: wordOnlyWidth,
            maxFontSize: lineHeightFontSize(run),
            maxFontInfo: resolveParagraphFontInfo(run),
            maxWidth: getEffectiveWidth(lines.length === 0 ? initialAvailableWidth : bodyContentWidth),
            segments: [{ runIndex, fromChar: wordStartChar, toChar: wordEndNoSpace, width: wordOnlyWidth }],
            spaceCount: wordNbspCount,
          };
          // If a trailing space exists and fits safely, include it on this line
          // Safe cast: only TextRuns produce word segments from split(), other run types are handled earlier
          const ls = getScaledLetterSpacing(run as TextRun);
          if (shouldIncludeDelimiterSpace && currentLine.width + spaceWidth <= currentLine.maxWidth - WIDTH_FUDGE_PX) {
            currentLine.toChar = wordEndWithSpace;
            currentLine.width = roundValue(currentLine.width + spaceWidth + ls);
            charPosInRun = wordEndWithSpace;
            currentLine.spaceCount += 1;
            // Fix: Also update the segment to include the trailing space character.
            // Without this, the segment excludes the space even though the line includes it,
            // causing the space to not be rendered.
            if (currentLine.segments?.[0]) {
              currentLine.segments[0].toChar = wordEndWithSpace;
              currentLine.segments[0].width += spaceWidth;
            }
          } else {
            // Do not count trailing space at line end
            // but still advance char index to skip over the space for subsequent words
            charPosInRun = wordEndWithSpace;
          }
          continue;
        }

        // Fill the rest of this line with as many ideographs
        // as fit, then continue the clause on the following lines, instead of
        // wrapping the whole clause and stranding whatever opened the line.
        // Runs after the justify-aware fit above so justified paragraphs keep
        // their per-space compression escape hatch.
        if (shouldBreak && useCjkLineFill) {
          const chunks = await breakWordIntoChunks(
            word,
            getEffectiveWidth(bodyContentWidth),
            font,
            ctx,
            run,
            wordStartChar,
            { firstChunkWidth: cjkLineFillWidth, applyKinsoku: true },
            fontContext,
            resolveParagraphRunWidth,
          );

          // Non-null: `shouldBreak` requires a line with committed width.
          let activeLine: NonNullable<typeof currentLine> = currentLine;
          let chunkCharOffset = wordStartChar;

          for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
            const chunk = chunks[chunkIndex];
            const chunkStartChar = chunkCharOffset;
            const chunkEndChar = chunkCharOffset + chunk.text.length;
            const isLastChunk = chunkIndex === chunks.length - 1;

            if (chunkIndex === 0) {
              activeLine.toRun = runIndex;
              activeLine.toChar = chunkEndChar;
              activeLine.width = roundValue(activeLine.width + boundarySpacing + chunk.width);
              updateLineFontMetrics(activeLine, run, fontContext, resolveParagraphFontInfo(run));
              appendSegment(
                activeLine.segments,
                runIndex,
                chunkStartChar,
                chunkEndChar,
                chunk.width,
                wordIndex === 0 ? segmentStartX : undefined,
                wordIndex === 0 ? consumeSegmentPrecedingTabEndX() : undefined,
              );
              activeLine.spaceCount += countNbspOccurrences(chunk.text);
            } else {
              activeLine = {
                fromRun: runIndex,
                fromChar: chunkStartChar,
                toRun: runIndex,
                toChar: chunkEndChar,
                width: chunk.width,
                maxFontSize: lineHeightFontSize(run),
                maxFontInfo: resolveParagraphFontInfo(run),
                maxWidth: getEffectiveWidth(bodyContentWidth),
                segments: [{ runIndex, fromChar: chunkStartChar, toChar: chunkEndChar, width: chunk.width }],
                spaceCount: countNbspOccurrences(chunk.text),
              };
            }

            if (!isLastChunk) {
              trimTrailingWrapSpaces(activeLine);
              lines.push(closeLineWithMetrics(activeLine));
              tabStopCursor = 0;
              pendingTabAlignment = null;
              pendingLeader = null;
              clearWrapState();
            }

            chunkCharOffset = chunkEndChar;
          }

          // Last chunk stays open so following runs continue on the same line.
          currentLine = activeLine;
          if (shouldIncludeDelimiterSpace && currentLine.width + spaceWidth <= currentLine.maxWidth - WIDTH_FUDGE_PX) {
            currentLine.toChar = wordEndWithSpace;
            currentLine.width = roundValue(currentLine.width + spaceWidth + getScaledLetterSpacing(run as TextRun));
            currentLine.spaceCount += 1;
            const lastSegment = currentLine.segments?.[currentLine.segments.length - 1];
            if (lastSegment) {
              lastSegment.toChar = wordEndWithSpace;
              lastSegment.width += spaceWidth;
            }
          }
          charPosInRun = wordEndWithSpace;
          continue;
        }

        if (shouldBreak) {
          let breakableHyphenEnd = -1;
          let breakableHyphenWidth = 0;
          for (
            let hyphenIndex = word.indexOf('-');
            hyphenIndex >= 0;
            hyphenIndex = word.indexOf('-', hyphenIndex + 1)
          ) {
            const prefixEnd = hyphenIndex + 1;
            if (prefixEnd >= word.length) continue;
            const prefixWidth = resolveParagraphRunWidth(word.slice(0, prefixEnd), font, ctx, run, wordStartChar);
            const prefixTotalWidth = currentLine.width + boundarySpacing + prefixWidth;
            let prefixFits = prefixTotalWidth <= availableWidth;
            if (!prefixFits && justifyAlignment && currentLine.spaceCount > 0) {
              const prefixOverflow = prefixTotalWidth - availableWidth;
              const baseSpaceWidth =
                spaceWidth ||
                resolveParagraphRunWidth(' ', font, ctx, run, wordStartChar) ||
                Math.max(1, boundarySpacing);
              prefixFits = fitsWordJustificationCompression(
                prefixOverflow,
                prefixWidth,
                currentLine.spaceCount,
                baseSpaceWidth,
                (run as TextRun).fontFamily,
                (isWordLayoutList && wordLayout?.indentLeftPx === 0 && (wordLayout.tabsPx?.length ?? 0) > 0) ||
                  paragraphEndsWithTerminalTabBreak,
              );
            }
            if (prefixFits) {
              breakableHyphenEnd = prefixEnd;
              breakableHyphenWidth = prefixWidth;
            }
          }

          if (breakableHyphenEnd > 0) {
            const prefixEndChar = wordStartChar + breakableHyphenEnd;
            currentLine.toRun = runIndex;
            currentLine.toChar = prefixEndChar;
            const naturalWidth = roundValue(currentLine.width + boundarySpacing + breakableHyphenWidth);
            if (naturalWidth > availableWidth) {
              currentLine.naturalWidth = naturalWidth;
              currentLine.width = availableWidth;
            } else {
              currentLine.width = naturalWidth;
            }
            updateLineFontMetrics(currentLine, run, fontContext, resolveParagraphFontInfo(run));
            appendSegment(
              currentLine.segments,
              runIndex,
              wordStartChar,
              prefixEndChar,
              breakableHyphenWidth,
              wordIndex === 0 ? segmentStartX : undefined,
              wordIndex === 0 ? consumeSegmentPrecedingTabEndX() : undefined,
            );
            // Count only NBSP within the committed prefix -- the remainder (from
            // breakableHyphenEnd onward) is reprocessed as its own `word` next
            // iteration and will count its own NBSP then.
            currentLine.spaceCount += countNbspOccurrences(word.slice(0, breakableHyphenEnd));
            trimTrailingWrapSpaces(currentLine);
            lines.push(closeLineWithMetrics(currentLine));
            tabStopCursor = 0;
            pendingTabAlignment = null;
            pendingLeader = null;
            currentLine = null;
            clearWrapState();

            words[wordIndex] = word.slice(breakableHyphenEnd);
            charPosInRun = prefixEndChar;
            wordIndex -= 1;
            continue;
          }
        }

        if (shouldBreak) {
          if (wordIndex === 0 && hasPendingSegmentTabGeometry) {
            clearWrapState();
          }
          trimTrailingWrapSpaces(currentLine);
          const completedLine: Line = closeLineWithMetrics(currentLine);
          lines.push(completedLine);
          tabStopCursor = 0;
          pendingTabAlignment = null;
          pendingLeader = null;

          // Body line, so use bodyContentWidth for hanging indent
          currentLine = {
            fromRun: runIndex,
            fromChar: wordStartChar,
            toRun: runIndex,
            toChar: wordEndNoSpace,
            width: wordOnlyWidth,
            maxFontSize: lineHeightFontSize(run),
            maxFontInfo: resolveParagraphFontInfo(run),
            maxWidth: getEffectiveWidth(bodyContentWidth),
            segments: [{ runIndex, fromChar: wordStartChar, toChar: wordEndNoSpace, width: wordOnlyWidth }],
            spaceCount: wordNbspCount,
          };
          // If trailing space would fit on the new line, consume it here; otherwise skip it
          if (shouldIncludeDelimiterSpace && currentLine.width + spaceWidth <= currentLine.maxWidth - WIDTH_FUDGE_PX) {
            currentLine.toChar = wordEndWithSpace;
            currentLine.width = roundValue(currentLine.width + spaceWidth + getScaledLetterSpacing(run as TextRun));
            charPosInRun = wordEndWithSpace;
            currentLine.spaceCount += 1;
            // Fix: Also update the segment to include the trailing space character.
            // Without this, the segment excludes the space even though the line includes it,
            // causing the space to not be rendered.
            if (currentLine.segments?.[0]) {
              currentLine.segments[0].toChar = wordEndWithSpace;
              currentLine.segments[0].width += spaceWidth;
            }
          } else {
            // Skip the space in character indexing even if we don't render it
            charPosInRun = wordEndWithSpace;
          }
        } else {
          currentLine.toRun = runIndex;
          // If adding the trailing space would exceed, commit only the word and finalize line
          if (
            shouldIncludeDelimiterSpace &&
            currentLine.width + boundarySpacing + wordOnlyWidth + spaceWidth > currentLine.maxWidth - WIDTH_FUDGE_PX
          ) {
            currentLine.toChar = wordEndNoSpace;
            currentLine.width = roundValue(currentLine.width + boundarySpacing + wordOnlyWidth);
            updateLineFontMetrics(currentLine, run, fontContext, resolveParagraphFontInfo(run));
            // Determine explicit X position:
            // - If in active tab group, use currentX from the group (for ALL words in group)
            // - Otherwise, only use segmentStartX for first word after a tab
            let explicitXHere: number | undefined;
            if (inActiveTabGroup && activeTabGroup) {
              explicitXHere = activeTabGroup.currentX;
              activeTabGroup.currentX = roundValue(activeTabGroup.currentX + wordOnlyWidth);
            } else if (wordIndex === 0 && segmentStartX !== undefined) {
              explicitXHere = segmentStartX;
            }
            appendSegment(
              currentLine.segments,
              runIndex,
              wordStartChar,
              wordEndNoSpace,
              wordOnlyWidth,
              explicitXHere,
              wordIndex === 0 ? consumeSegmentPrecedingTabEndX() : undefined,
            );
            // The trailing delimiter space doesn't fit (excluded above), but `word`
            // itself may still contain embedded NBSP that must still be counted.
            currentLine.spaceCount += wordNbspCount;
            // finish current line and start a new one on next iteration
            trimTrailingWrapSpaces(currentLine);
            const completedLine: Line = closeLineWithMetrics(currentLine);
            lines.push(completedLine);
            tabStopCursor = 0;
            pendingTabAlignment = null;
            pendingLeader = null;
            currentLine = null;
            // advance past space
            charPosInRun = wordEndNoSpace + 1;
            continue;
          }
          const newToChar = shouldIncludeDelimiterSpace ? wordEndWithSpace : wordEndNoSpace;
          currentLine.toChar = newToChar;
          // Determine explicit X position:
          // - If in active tab group, use currentX from the group (for ALL words in group)
          // - Otherwise, only use segmentStartX for first word after a tab
          let explicitX: number | undefined;
          if (inActiveTabGroup && activeTabGroup) {
            explicitX = activeTabGroup.currentX;
            activeTabGroup.currentX = roundValue(activeTabGroup.currentX + wordCommitWidth);
          } else if (wordIndex === 0 && segmentStartX !== undefined) {
            explicitX = segmentStartX;
          }
          const targetWidth =
            compressedWidth != null
              ? compressedWidth
              : currentLine.width +
                boundarySpacing +
                wordCommitWidth +
                (shouldIncludeDelimiterSpace ? getScaledLetterSpacing(run as TextRun) : 0);
          // Preserve natural width when compression is applied for justify calculations
          if (compressedWidth != null) {
            currentLine.naturalWidth = roundValue(totalWidthWithWord);
          }
          currentLine.width = roundValue(targetWidth);
          updateLineFontMetrics(currentLine, run, fontContext, resolveParagraphFontInfo(run));
          appendSegment(
            currentLine.segments,
            runIndex,
            wordStartChar,
            newToChar,
            wordCommitWidth,
            explicitX,
            wordIndex === 0 ? consumeSegmentPrecedingTabEndX() : undefined,
          );
          currentLine.spaceCount += wordNbspCount + (shouldIncludeDelimiterSpace ? 1 : 0);
        }

        charPosInRun = shouldIncludeDelimiterSpace ? wordEndWithSpace : wordEndNoSpace;
      }

      // If this segment was positioned by a right-aligned tab, clamp the
      // final width to the tab target to avoid rounding drift.
      if (lastAppliedTabAlign && currentLine) {
        const appliedTab = lastAppliedTabAlign as { target: number; val: TabStop['val'] };
        if (appliedTab.val === 'end') {
          currentLine.width = roundValue(appliedTab.target);
        }
      }
      lastAppliedTabAlign = null;

      // Check if we've reached the end of the active tab alignment group
      if (activeTabGroup && runIndex + 1 >= activeTabGroup.measure.endRunIndex) {
        // Clamp line width to the tab target to ensure proper alignment
        if (currentLine && activeTabGroup.val === 'end') {
          currentLine.width = roundValue(activeTabGroup.target);
        }
        activeTabGroup = null;
      }

      if (!isLastSegment) {
        pendingTabAlignment = null;
        pendingLeader = null;

        if (!currentLine) {
          currentLine = {
            fromRun: runIndex,
            fromChar: charPosInRun,
            toRun: runIndex,
            toChar: charPosInRun,
            width: 0,
            maxFontSize: lineHeightFontSize(run),
            maxFontInfo: resolveParagraphFontInfo(run),
            maxWidth: getEffectiveWidth(lines.length === 0 ? initialAvailableWidth : bodyContentWidth),
            segments: [],
            spaceCount: 0,
          };
        }
        const originX = currentLine.width;
        // Use first-line effective indent (accounts for hanging) on first line, body indent otherwise
        const effectiveIndent = lines.length === 0 ? firstLineTabIndent : indentLeft;
        const absCurrentX = currentLine.width + effectiveIndent;
        const { target, nextIndex, stop } = getNextTabStopPx(absCurrentX, tabStops, tabStopCursor);
        tabStopCursor = nextIndex;
        const maxAbsWidth = currentLine.maxWidth + effectiveIndent;
        const clampedTarget = Math.min(target, maxAbsWidth);
        const tabAdvance = Math.max(0, clampedTarget - absCurrentX);
        currentLine.width = roundValue(currentLine.width + tabAdvance);
        if (stop?.source === 'explicit') {
          currentLine.hasExplicitTabStops = true;
        }

        updateLineFontMetrics(currentLine, run, fontContext, resolveParagraphFontInfo(run));
        currentLine.toRun = runIndex;
        currentLine.toChar = charPosInRun;
        charPosInRun += 1;
        if (stop) {
          validateTabStopVal(stop);
          const relativeTarget = clampedTarget - effectiveIndent;
          pendingTabAlignment = {
            target: relativeTarget,
            val: stop.val,
            compensateNegativeLeft:
              stop.val === 'start' && indentLeft < 0 && effectiveIndent === indentLeft && stop.source !== 'explicit',
          };
        } else {
          pendingTabAlignment = null;
          pendingLeader = null;
        }

        // Emit leader decoration if requested
        if (stop && stop.leader && stop.leader !== 'none' && stop.leader !== 'middleDot') {
          const leaderStyle: 'heavy' | 'dot' | 'hyphen' | 'underscore' = stop.leader;
          const from = Math.min(originX + effectiveIndent, clampedTarget);
          const to = Math.max(originX + effectiveIndent, clampedTarget);
          if (!currentLine.leaders) currentLine.leaders = [];
          const leader: LeaderDecoration = { from, to, style: leaderStyle };
          currentLine.leaders.push(leader);
          pendingLeader = leader;
        }
      }
    }

    pendingRunSpacing = getScaledLetterSpacing(run as TextRun);
  }

  if (!currentLine && lines.length === 0) {
    const uiDisplayFallbackFontSize =
      (normalizedRuns[0]?.kind === 'text' ? (normalizedRuns[0] as TextRun).fontSize : undefined) ??
      DEFAULT_PARAGRAPH_FONT_SIZE;
    const metrics = calculateTypographyMetrics(uiDisplayFallbackFontSize, spacing, undefined, fontContext);
    const fallbackLine: Line = {
      fromRun: 0,
      fromChar: 0,
      toRun: 0,
      toChar: 0,
      width: 0,
      segments: [],
      ...metrics,
    };
    addBarTabsToLine(fallbackLine);
    lines.push(fallbackLine);
  }

  if (currentLine) {
    const finalLine: Line = closeLineWithMetrics(currentLine);
    lines.push(finalLine);
  }

  if (runIndexMap.some((value, index) => value !== index)) {
    for (const line of lines) {
      const measuredFromRun = line.fromRun;
      const measuredToRun = line.toRun;
      line.fromRun = runIndexMap[measuredFromRun] ?? measuredFromRun;
      line.fromChar += runCharOffsetMap[measuredFromRun] ?? 0;
      line.toRun = runIndexMap[measuredToRun] ?? measuredToRun;
      line.toChar += runCharOffsetMap[measuredToRun] ?? 0;
      if (line.segments) {
        line.segments = line.segments.map((segment) => {
          const measuredRunIndex = segment.runIndex;
          const charOffset = runCharOffsetMap[measuredRunIndex] ?? 0;
          return {
            ...segment,
            runIndex: runIndexMap[measuredRunIndex] ?? measuredRunIndex,
            fromChar: segment.fromChar + charOffset,
            toChar: segment.toChar + charOffset,
          };
        });
      }
      if (line.inlineImageAlignments) {
        line.inlineImageAlignments = line.inlineImageAlignments.map((alignment) => ({
          ...alignment,
          runIndex: runIndexMap[alignment.runIndex] ?? alignment.runIndex,
        }));
      }
    }
  }

  if (block.attrs?.alignment === 'justify' && getParagraphInlineDirection(block.attrs) !== 'rtl') {
    const newlineExpandedBlock = { ...block, runs: newlineExpandedRuns };
    for (const line of lines) {
      if ((line.spaceCount ?? 0) !== 0 || line.segments?.some((segment) => segment.x !== undefined)) continue;
      const boundaries = collectCjkJustificationBoundaries(sliceRunsForLine(newlineExpandedBlock, line));
      if (boundaries) line.justificationPlan = { type: 'inter-character', boundaries };
    }
  }

  const totalHeight = lines.reduce((sum, line) => sum + line.lineHeight, 0);

  return {
    kind: 'paragraph',
    lines,
    totalHeight,
    measuredAtMaxWidth: maxWidth,
    ...(markerInfo ? { marker: markerInfo } : {}),
    ...(dropCapMeasure ? { dropCap: dropCapMeasure } : {}),
  };
}

interface MutableTableMeasurementObservation {
  phases: Record<TableMeasurementPhase, number>;
  cellBlockCache: Record<TableCellBlockMeasureCacheOutcome, number>;
  autoFitCellMetricCache: { hits: number; misses: number };
  autoFitTableResultCache: { hits: number; misses: number };
}

const tableMeasurementNow = (): number => globalThis.performance?.now?.() ?? Date.now();

function createMutableTableMeasurementObservation(): MutableTableMeasurementObservation {
  return {
    phases: Object.fromEntries(TABLE_MEASUREMENT_PHASES.map((phase) => [phase, 0])) as Record<
      TableMeasurementPhase,
      number
    >,
    cellBlockCache: { 'exact-hit': 0, 'adopted-hit': 0, miss: 0 },
    autoFitCellMetricCache: { hits: 0, misses: 0 },
    autoFitTableResultCache: { hits: 0, misses: 0 },
  };
}

function recordTableMeasurementPhase<T>(
  observation: MutableTableMeasurementObservation,
  phase: TableMeasurementPhase,
  work: () => T,
): T {
  const startedAt = tableMeasurementNow();
  try {
    return work();
  } finally {
    observation.phases[phase] += tableMeasurementNow() - startedAt;
  }
}

async function recordAsyncTableMeasurementPhase<T>(
  observation: MutableTableMeasurementObservation,
  phase: TableMeasurementPhase,
  work: () => Promise<T>,
): Promise<T> {
  const startedAt = tableMeasurementNow();
  try {
    return await work();
  } finally {
    observation.phases[phase] += tableMeasurementNow() - startedAt;
  }
}

async function measureTableBlock(
  block: TableBlock,
  constraints: MeasureConstraints,
  fontContext: FontMeasureContext,
  renderDiagnosticOwner?: unknown,
): Promise<TableMeasure> {
  const measurementStartedAt = tableMeasurementNow();
  const tableObservation = createMutableTableMeasurementObservation();
  const maxWidth = typeof constraints === 'number' ? constraints : constraints.maxWidth;
  const measurementRuntimeSignature = JSON.stringify({
    mode: measurementConfig.mode,
    deterministicFamily: measurementConfig.fonts.deterministicFamily,
    fallbackStack: measurementConfig.fonts.fallbackStack,
    fontSignature: fontContext.fontSignature,
  });
  const workingInput = recordTableMeasurementPhase(tableObservation, 'grid-normalization', () =>
    buildAutoFitWorkingGridInput(block, { maxWidth }),
  );
  const { columnWidths, mode } = await resolveRuntimeTableColumnWidths(
    block,
    workingInput,
    fontContext,
    tableObservation,
    constraints.tableMeasurementTrace,
  );

  // Derive grid column count from computed columnWidths (handles both explicit tblGrid and fallback cases)
  const gridColumnCount = columnWidths.length;
  const cellSpacingPx = getCellSpacingPx(block.attrs?.cellSpacing);
  const borderCollapse = block.attrs?.borderCollapse ?? (block.attrs?.cellSpacing != null ? 'separate' : 'collapse');
  const tableBorders = block.attrs?.borders;

  /**
   * Calculate the width for a cell by summing the grid column widths it spans.
   * @param startCol - The starting grid column index
   * @param colspan - Number of grid columns this cell spans
   */
  const calculateCellWidth = (startCol: number, colspan: number): number => {
    let width = 0;
    for (let i = 0; i < colspan && startCol + i < columnWidths.length; i++) {
      width += columnWidths[startCol + i];
    }
    // Ensure minimum width of 1px
    return Math.max(1, width);
  };

  // Track which grid columns are "occupied" by rowspans from previous rows
  // Each element contains the number of remaining rows the cell spans into
  const rowspanTracker: number[] = new Array(gridColumnCount).fill(0);

  // Measure each cell paragraph with appropriate column width based on colspan
  const rows: TableRowMeasure[] = [];
  const rowBaseHeights: number[] = new Array(block.rows.length).fill(0);
  const rowAuthoredHeightPadding: number[] = Array.from({ length: block.rows.length }, () => 0);
  // `w:trHeight` describes the row's authored inner height. In Word's
  // collapsed-border model an unmerged row adds its cell margins and owned
  // horizontal grid edge outside that minimum. Keep those insets separate
  // from automatic cell measurement so `atLeast` cannot consume them.
  const rowAuthoredHeightChrome: number[] = Array.from({ length: block.rows.length }, () => 0);
  const spanConstraints: Array<{ startRow: number; rowSpan: number; requiredHeight: number }> = [];
  const rowAssemblyStartedAt = tableMeasurementNow();
  const cellMeasurementBeforeRows = tableObservation.phases['cell-block-measurement'];
  for (let rowIndex = 0; rowIndex < block.rows.length; rowIndex++) {
    const row = block.rows[rowIndex];
    const normalizedRow = workingInput.rows[rowIndex];
    const cellMeasures: TableCellMeasure[] = [];
    let gridColIndex = 0; // Track position in the grid

    for (let cellIndex = 0; cellIndex < row.cells.length; cellIndex++) {
      const cell = row.cells[cellIndex];
      const colspan = cell.colSpan ?? 1;
      const rowspan = cell.rowSpan ?? 1;
      const normalizedCell = normalizedRow?.cells?.[cellIndex];
      const preferredStartColumn = normalizedCell?.startColumn ?? gridColIndex;

      // Skip grid columns that are occupied by rowspans from previous rows
      // and advance to the fixed-layout logical start column before processing this cell.
      while (gridColIndex < gridColumnCount && gridColIndex < preferredStartColumn) {
        if (rowspanTracker[gridColIndex] > 0) {
          rowspanTracker[gridColIndex]--;
        }
        gridColIndex++;
      }

      while (gridColIndex < gridColumnCount && rowspanTracker[gridColIndex] > 0) {
        rowspanTracker[gridColIndex]--;
        gridColIndex++;
      }

      // If we've exhausted the grid, stop processing cells
      if (gridColIndex >= gridColumnCount) {
        break;
      }

      const cellWidth = calculateCellWidth(gridColIndex, colspan);
      const previousRowMeasure = rows[rowIndex - 1];
      const aboveCellIndex = previousRowMeasure?.cells.findIndex((candidate) => {
        const start = candidate.gridColumnStart ?? 0;
        return start <= gridColIndex && gridColIndex < start + (candidate.colSpan ?? 1);
      });
      const leftCellIndex = cellMeasures.findIndex(
        (candidate) => (candidate.gridColumnStart ?? 0) + (candidate.colSpan ?? 1) === gridColIndex,
      );
      const borderInsets = getTableCellBorderInsets({
        cellBorders: cell.attrs?.borders,
        aboveCellBorders:
          aboveCellIndex !== undefined && aboveCellIndex >= 0
            ? block.rows[rowIndex - 1]?.cells[aboveCellIndex]?.attrs?.borders
            : undefined,
        leftCellBorders: leftCellIndex >= 0 ? row.cells[leftCellIndex]?.attrs?.borders : undefined,
        tableBorders,
        rowIndex,
        rowSpan: rowspan,
        rowCount: block.rows.length,
        gridColumnStart: gridColIndex,
        colSpan: colspan,
        gridColumnCount,
        cellSpacingPx,
      });
      rowAuthoredHeightChrome[rowIndex] = Math.max(
        rowAuthoredHeightChrome[rowIndex],
        borderCollapse === 'collapse' ? borderInsets.top : borderInsets.top + borderInsets.bottom,
      );

      // Mark grid columns as occupied for future rows if rowspan > 1
      if (rowspan > 1) {
        for (let c = 0; c < colspan && gridColIndex + c < gridColumnCount; c++) {
          rowspanTracker[gridColIndex + c] = rowspan - 1;
        }
      }

      // Get cell padding for height calculation
      const cellPadding = cell.attrs?.padding ?? DEFAULT_CELL_PADDING;
      const paddingTop = cellPadding.top ?? 0;
      const paddingBottom = cellPadding.bottom ?? 0;
      const paddingLeft = cellPadding.left ?? 4;
      const paddingRight = cellPadding.right ?? 4;
      if (rowspan === 1) {
        rowAuthoredHeightPadding[rowIndex] = Math.max(rowAuthoredHeightPadding[rowIndex], paddingTop + paddingBottom);
      }

      // The painter uses border-box cells, so nested content is constrained by
      // both horizontal padding and the resolved painted border insets.
      const contentWidth = Math.max(1, cellWidth - paddingLeft - paddingRight - borderInsets.left - borderInsets.right);

      /**
       * Measure all blocks in the cell and accumulate total content height.
       *
       * Multi-Block Cell Support:
       * - Cells can contain multiple blocks (paragraphs, lists, images, etc.)
       * - Each block is measured independently with the cell's content width
       * - Block heights are accumulated to calculate total content height
       * - Vertical padding is applied to the total accumulated height
       *
       * Backward Compatibility:
       * - If cell.blocks is not present, falls back to cell.paragraph (legacy format)
       * - Empty blocks arrays are handled gracefully (no content)
       *
       * Height Calculation:
       * - contentHeight = sum of all block.totalHeight values
       * - totalCellHeight = contentHeight + paddingTop + paddingBottom
       *
       * Example:
       * ```
       * cell.blocks = [paragraph1, paragraph2, paragraph3]
       * contentHeight = para1.height + para2.height + para3.height
       * totalCellHeight = contentHeight;
       * ```
       */
      let contentHeight = 0;
      const paragraphFlowTops = new Map<string, { top: number; firstLineHeight: number }>();
      const layoutInCellAnchors: Array<{
        block: ImageBlock | DrawingBlock;
        height: number;
      }> = [];

      const cellBlocks = (cell.blocks ?? (cell.paragraph ? [cell.paragraph] : [])) as FlowBlock[];
      const nestedTrace = constraints.tableMeasurementTrace
        ? { ...constraints.tableMeasurementTrace, depth: constraints.tableMeasurementTrace.depth + 1 }
        : undefined;
      const blockMeasures = await recordAsyncTableMeasurementPhase(tableObservation, 'cell-block-measurement', () =>
        measureTableCellBlocks(
          cellBlocks,
          contentWidth,
          fontContext,
          measurementRuntimeSignature,
          (nestedBlock, nestedConstraints) => {
            const recursiveConstraints = nestedTrace
              ? { ...nestedConstraints, tableMeasurementTrace: nestedTrace }
              : { ...nestedConstraints };
            if (typeof renderDiagnosticOwner === 'function') {
              Object.defineProperty(recursiveConstraints, V2_RENDER_DIAGNOSTIC_MEASUREMENT_OWNER, {
                configurable: true,
                enumerable: false,
                value: renderDiagnosticOwner,
              });
            }
            return measureBlock(nestedBlock, recursiveConstraints, fontContext);
          },
          (outcome) => {
            tableObservation.cellBlockCache[outcome] += 1;
          },
          nestedTrace?.cacheIdentity === 'content',
        ),
      );

      for (let blockIndex = 0; blockIndex < cellBlocks.length; blockIndex++) {
        const block = cellBlocks[blockIndex];
        const measure = blockMeasures[blockIndex]!;
        // Get height from different measure types
        const blockHeight = 'totalHeight' in measure ? measure.totalHeight : 'height' in measure ? measure.height : 0;
        const isAnchoredOutOfFlow =
          (block.kind === 'image' || block.kind === 'drawing') &&
          (block as ImageBlock | DrawingBlock).anchor?.isAnchored === true &&
          ((block as ImageBlock | DrawingBlock).wrap?.type ?? 'Inline') !== 'Inline';

        if (block.kind === 'paragraph') {
          paragraphFlowTops.set(block.id, {
            top: contentHeight,
            firstLineHeight: measure.kind === 'paragraph' ? (measure.lines[0]?.lineHeight ?? 0) : 0,
          });
        }

        // Anchored/floating objects inside table cells do not contribute to cell height.
        if (isAnchoredOutOfFlow) {
          const anchoredBlock = block as ImageBlock | DrawingBlock;
          if (anchoredBlock.anchor?.layoutInCell === true) {
            layoutInCellAnchors.push({ block: anchoredBlock, height: blockHeight });
          }
          continue;
        }

        contentHeight += blockHeight;

        // Add paragraph spacing.after/spacing.before to content height.
        // Word absorbs first paragraph's spacing.before into paddingTop and last's spacing.after into paddingBottom.
        const isFirstBlock = blockIndex === 0;
        const isLastBlock = blockIndex === cellBlocks.length - 1;
        if (block.kind === 'paragraph') {
          const spacingBefore = (block as ParagraphBlock).attrs?.spacing?.before;
          contentHeight += effectiveTableCellSpacing(spacingBefore, isFirstBlock, paddingTop);
          const spacingAfter = (block as ParagraphBlock).attrs?.spacing?.after;
          contentHeight += effectiveTableCellSpacing(spacingAfter, isLastBlock, paddingBottom);
        }
      }

      for (const entry of layoutInCellAnchors) {
        const anchor = entry.block.anchor;
        if (!anchor || (anchor.vRelativeFrom != null && anchor.vRelativeFrom !== 'paragraph')) continue;
        const anchorParagraphId =
          typeof entry.block.attrs?.anchorParagraphId === 'string' ? entry.block.attrs.anchorParagraphId : undefined;
        const paragraph = anchorParagraphId ? paragraphFlowTops.get(anchorParagraphId) : undefined;
        const top = paragraph
          ? resolveAnchoredGraphicY({
              anchor,
              objectHeight: entry.height,
              contentTop: 0,
              contentBottom: 0,
              anchorParagraphY: paragraph.top,
              firstLineHeight: paragraph.firstLineHeight,
            })
          : (anchor.offsetV ?? 0);
        // Word probes for Square, TopAndBottom, and None wrapping all resize the
        // cell when layoutInCell is true. Both authored vertical wrap distances
        // participate in that reserved cell-height budget.
        const wrapDistance = (entry.block.wrap?.distTop ?? 0) + (entry.block.wrap?.distBottom ?? 0);
        contentHeight = Math.max(contentHeight, Math.max(0, top + entry.height + wrapDistance));
      }

      // The painter uses border-box cells. Reserve padding and painted border
      // chrome after layout-in-cell anchors expand the content-height budget.
      const totalCellHeight = contentHeight + paddingTop + paddingBottom + borderInsets.top + borderInsets.bottom;

      cellMeasures.push({
        blocks: blockMeasures,
        // Backward compatibility
        paragraph: blockMeasures[0]?.kind === 'paragraph' ? (blockMeasures[0] as ParagraphMeasure) : undefined,
        width: cellWidth,
        height: totalCellHeight,
        gridColumnStart: gridColIndex,
        colSpan: colspan,
        rowSpan: rowspan,
      });

      if (rowspan === 1) {
        rowBaseHeights[rowIndex] = Math.max(rowBaseHeights[rowIndex], totalCellHeight);
      } else {
        spanConstraints.push({ startRow: rowIndex, rowSpan: rowspan, requiredHeight: totalCellHeight });
      }

      // Advance grid column position by colspan
      gridColIndex += colspan;
    }

    // Decrement any remaining rowspan trackers that weren't handled
    for (let col = gridColIndex; col < gridColumnCount; col++) {
      if (rowspanTracker[col] > 0) {
        rowspanTracker[col]--;
      }
    }

    rows.push({ cells: cellMeasures, height: 0 });
  }
  const rowAssemblyWallMs = tableMeasurementNow() - rowAssemblyStartedAt;
  const cellMeasurementInsideRows = tableObservation.phases['cell-block-measurement'] - cellMeasurementBeforeRows;
  tableObservation.phases['row-measure-assembly'] += Math.max(0, rowAssemblyWallMs - cellMeasurementInsideRows);

  const rowHeights = recordTableMeasurementPhase(tableObservation, 'row-height-resolution', () => {
    const resolvedRowHeights = [...rowBaseHeights];
    for (const constraint of spanConstraints) {
      const { startRow, rowSpan, requiredHeight } = constraint;
      if (rowSpan <= 0) continue;

      let currentHeight = 0;
      for (let i = 0; i < rowSpan && startRow + i < resolvedRowHeights.length; i++) {
        currentHeight += resolvedRowHeights[startRow + i];
      }

      if (currentHeight < requiredHeight) {
        const spanLength = Math.min(rowSpan, resolvedRowHeights.length - startRow);
        const increment = spanLength > 0 ? (requiredHeight - currentHeight) / spanLength : 0;
        for (let i = 0; i < spanLength; i++) {
          resolvedRowHeights[startRow + i] += increment;
        }
      }
    }

    // Apply explicit row heights (exact / atLeast) from row attributes
    block.rows.forEach((row, index) => {
      const spec = row.attrs?.rowHeight as { value?: number; rule?: string } | undefined;
      if (spec?.value != null && Number.isFinite(spec.value)) {
        const rule = spec.rule ?? 'atLeast';
        if (rule === 'exact') {
          resolvedRowHeights[index] = spec.value;
        } else if (rule === 'atLeast') {
          resolvedRowHeights[index] = Math.max(
            resolvedRowHeights[index],
            spec.value + rowAuthoredHeightPadding[index] + rowAuthoredHeightChrome[index],
          );
        }
      }
    });

    return resolvedRowHeights;
  });

  for (let i = 0; i < rows.length; i++) {
    rows[i].height = Math.max(0, rowHeights[i]);
  }

  const contentHeight = rowHeights.reduce((sum, h) => sum + h, 0);
  const contentWidth = columnWidths.reduce((a, b) => a + b, 0);

  // Cell margins (OOXML cellMargins) are applied as cell padding (attrs.padding) and are already
  // included in row heights and content width: row height = content + paddingTop + paddingBottom,
  // and content width per cell = cellWidth - paddingLeft - paddingRight.

  // Cell spacing (border-spacing): gaps between cells plus space before first and after last row/column
  const numRows = block.rows.length;
  const horizontalGaps = gridColumnCount > 0 ? (gridColumnCount + 1) * cellSpacingPx : 0;
  const verticalGaps = numRows > 0 ? (numRows + 1) * cellSpacingPx : 0;

  // Outer table border widths: only add to total dimensions when borderCollapse === 'separate',
  // since the DOM renderer only paints container-level outer borders in that path. For collapsed
  // (default), borders are on cells and don't grow the table container, so including them would
  // overstate size and cause premature wrapping/page breaks or alignment drift.
  const tableBorderWidths = getTableBorderWidths(tableBorders);
  const borderWidthH = tableBorderWidths.left + tableBorderWidths.right;
  const borderWidthV = tableBorderWidths.top + tableBorderWidths.bottom;
  const includeOuterBordersInTotal = borderCollapse === 'separate';
  const totalWidth = contentWidth + horizontalGaps + (includeOuterBordersInTotal ? borderWidthH : 0);
  const totalHeight = contentHeight + verticalGaps + (includeOuterBordersInTotal ? borderWidthV : 0);

  const measure: TableMeasure = {
    kind: 'table',
    rows,
    columnWidths,
    totalWidth,
    totalHeight,
    cellSpacingPx: cellSpacingPx > 0 ? cellSpacingPx : undefined,
    tableBorderWidths: borderWidthH > 0 || borderWidthV > 0 ? tableBorderWidths : undefined,
  };
  const totalWallMs = tableMeasurementNow() - measurementStartedAt;
  const attributedBeforeOther = TABLE_MEASUREMENT_PHASES.filter((phase) => phase !== 'other').reduce(
    (sum, phase) => sum + tableObservation.phases[phase],
    0,
  );
  tableObservation.phases.other += Math.max(0, totalWallMs - attributedBeforeOther);
  const attributedWallMs = TABLE_MEASUREMENT_PHASES.reduce((sum, phase) => sum + tableObservation.phases[phase], 0);
  constraints.tableMeasurementTrace?.observer({
    depth: constraints.tableMeasurementTrace.depth,
    cacheIdentity: constraints.tableMeasurementTrace.cacheIdentity,
    mode,
    totalWallMs,
    reconciliationDeltaMs: Math.abs(totalWallMs - attributedWallMs),
    phases: tableObservation.phases,
    rowCount: block.rows.length,
    cellCount: block.rows.reduce((sum, row) => sum + row.cells.length, 0),
    nestedBlockCount: block.rows.reduce(
      (rowSum, row) =>
        rowSum + row.cells.reduce((cellSum, cell) => cellSum + (cell.blocks?.length ?? (cell.paragraph ? 1 : 0)), 0),
      0,
    ),
    cellBlockCache: tableObservation.cellBlockCache,
    autoFitCellMetricCache: tableObservation.autoFitCellMetricCache,
    autoFitTableResultCache: tableObservation.autoFitTableResultCache,
  });
  return measure;
}

/**
 * Resolve the final runtime width vector for a table before downstream cell
 * measurement begins.
 *
 * This is the single measurement-stage switch between:
 * - fixed layout: preferred widths remain authoritative
 * - AutoFit: content metrics participate in width resolution
 */
async function resolveRuntimeTableColumnWidths(
  block: TableBlock,
  workingInput: WorkingTableGridInput,
  fontContext: FontMeasureContext,
  observation: MutableTableMeasurementObservation,
  trace: TableMeasurementTraceContext | undefined,
): Promise<{ columnWidths: number[]; mode: TableMeasurementMode }> {
  const fixedLayout = recordTableMeasurementPhase(observation, 'fixed-column-resolution', () =>
    computeFixedTableColumnWidths(workingInput),
  );
  // Stable imported grids are content-independent, so skip the intrinsic
  // measurement pass that would otherwise scan every cell after each edit.
  if (workingInput.layoutMode === 'fixed') {
    return { columnWidths: fixedLayout.columnWidths, mode: 'fixed' };
  }
  if (workingInput.stableAutoGrid === true) {
    const columnWidths = recordTableMeasurementPhase(
      observation,
      'autofit-column-solve',
      () =>
        computeAutoFitColumnWidths({
          workingInput,
          fixedLayout,
          contentMetrics: { rowMetrics: [] },
        }).columnWidths,
    );
    return { columnWidths, mode: 'stable-auto-grid' };
  }

  const { contentMetrics, cellMetricKeys } = await recordAsyncTableMeasurementPhase(
    observation,
    'autofit-content-metrics',
    () => buildMeasuredAutoFitContentMetrics(block, workingInput, fixedLayout, fontContext, observation, trace),
  );
  const cacheKey = buildAutoFitTableResultCacheKey(block, {
    maxWidth: workingInput.maxTableWidth,
    cellMetricKeys,
    fontSignature: fontContext.fontSignature,
    workingInput,
    fixedLayout,
    identityNeutralCache: trace?.cacheIdentity === 'content',
  });
  const cached = getCachedAutoFitTableResult(cacheKey);
  if (cached) {
    observation.autoFitTableResultCache.hits += 1;
    return { columnWidths: cached.columnWidths, mode: 'full-autofit' };
  }
  observation.autoFitTableResultCache.misses += 1;

  const result = recordTableMeasurementPhase(observation, 'autofit-column-solve', () =>
    computeAutoFitColumnWidths({
      workingInput,
      fixedLayout,
      contentMetrics: {
        rowMetrics: contentMetrics.rowMetrics,
      },
    }),
  );

  setCachedAutoFitTableResult(cacheKey, {
    columnWidths: result.columnWidths,
    totalWidth: result.totalWidth,
  });
  return { columnWidths: result.columnWidths, mode: 'full-autofit' };
}

/**
 * Attach measured min/max content widths to normalized AutoFit rows.
 *
 * The normalization layer already contributes skipped-column metadata and
 * preferred widths. This helper supplies the remaining content metrics required
 * by the pure AutoFit solver.
 */
async function buildMeasuredAutoFitContentMetrics(
  block: TableBlock,
  workingInput: WorkingTableGridInput,
  fixedLayout: FixedLayoutResult,
  fontContext: FontMeasureContext,
  observation: MutableTableMeasurementObservation,
  trace: TableMeasurementTraceContext | undefined,
): Promise<{
  contentMetrics: TableAutoFitContentMetricsResult;
  cellMetricKeys: string[];
}> {
  // Forward this document's font context into every sub-measurement (paragraph
  // max-line width, nested tables) so AutoFit honors a per-document `fonts.map`
  // throughout, not only in the token min-width path.
  const nestedTrace = trace ? { ...trace, depth: trace.depth + 1 } : undefined;
  const measureBlockWithFontContext: AutoFitMeasureBlock = (childBlock, childConstraints) =>
    measureBlock(
      childBlock,
      nestedTrace ? { ...childConstraints, tableMeasurementTrace: nestedTrace } : childConstraints,
      fontContext,
    );
  const contentMetrics = await measureTableAutoFitContentMetrics(
    block,
    workingInput,
    fixedLayout,
    measureBlockWithFontContext,
    fontContext,
    (outcome) => {
      observation.autoFitCellMetricCache[outcome === 'hit' ? 'hits' : 'misses'] += 1;
    },
    trace?.cacheIdentity === 'content',
  );
  return {
    contentMetrics,
    cellMetricKeys: contentMetrics.cellMetricKeys,
  };
}

async function measureImageBlock(block: ImageBlock, constraints: MeasureConstraints): Promise<ImageMeasure> {
  const intrinsic = getIntrinsicImageSize(block, constraints.maxWidth);

  const isBlockBehindDoc = block.anchor?.behindDoc;
  const isBlockWrapBehindDoc = block.wrap?.type === 'None' && block.wrap?.behindDoc;
  const isAnchoredImage = block.anchor?.isAnchored;
  const bypassWidthConstraint = isBlockBehindDoc || isBlockWrapBehindDoc || isAnchoredImage;
  const isWidthConstraintBypassed = bypassWidthConstraint || constraints.maxWidth <= 0;

  const maxWidth = isWidthConstraintBypassed ? intrinsic.width : constraints.maxWidth;

  // For anchored images with negative vertical positioning (designed to overflow their container),
  // bypass the height constraint. This matches MS Word behavior where images in headers/footers
  // with negative offsets are rendered at their full size regardless of region constraints.
  const hasNegativeVerticalPosition =
    block.anchor?.isAnchored &&
    ((typeof block.anchor?.offsetV === 'number' && block.anchor.offsetV < 0) ||
      (typeof block.margin?.top === 'number' && block.margin.top < 0));

  // Bypass height constraint when:
  // - Image has negative vertical positioning (designed to overflow container)
  // - objectFit is 'cover' (image should render at exact extent dimensions, CSS handles content scaling/clipping)
  const shouldBypassHeightConstraint = hasNegativeVerticalPosition || block.objectFit === 'cover';

  const maxHeight =
    shouldBypassHeightConstraint || !constraints.maxHeight || constraints.maxHeight <= 0
      ? Infinity
      : constraints.maxHeight;

  const widthScale = maxWidth / intrinsic.width;
  const heightScale = maxHeight / intrinsic.height;
  const scale = Math.min(1, widthScale, heightScale);

  const width = Number.isFinite(scale) ? intrinsic.width * scale : intrinsic.width;
  const height = Number.isFinite(scale) ? intrinsic.height * scale : intrinsic.height;

  return {
    kind: 'image',
    width,
    height,
  };
}

/**
 * Measures a drawing block (vector shapes, shape groups, embedded images) and calculates
 * its rendered dimensions within the given constraints.
 *
 * This function handles:
 * - Rotation transformations and their effect on bounding box dimensions
 * - Proportional scaling to fit within maxWidth/maxHeight constraints
 * - Floating drawings preserve their authored dimensions independently of story constraints
 *
 * @param block - The drawing block to measure, containing geometry, anchor, and margin data
 * @param constraints - Measurement constraints with maxWidth and optional maxHeight
 * @returns A DrawingMeasure containing final dimensions, scale factor, and geometry
 *
 * @example
 * ```typescript
 * const block: DrawingBlock = {
 *   kind: 'drawing',
 *   drawingKind: 'vectorShape',
 *   geometry: { width: 200, height: 100, rotation: 0 },
 *   anchor: { isAnchored: true, offsetV: 0 },
 * };
 *
 * const measure = await measureDrawingBlock(block, { maxWidth: 500, maxHeight: 80 });
 * // Result: { width: 200, height: 100, scale: 1 }
 * // (story constraints do not resize anchored drawings)
 * ```
 */
async function measureDrawingBlock(
  block: DrawingBlock,
  constraints: MeasureConstraints,
  fontContext: FontMeasureContext,
  renderDiagnosticOwner?: unknown,
): Promise<DrawingMeasure> {
  if (block.drawingKind === 'image') {
    const intrinsic = getIntrinsicSizeFromDims(block.width, block.height, constraints.maxWidth);

    const maxWidth = constraints.maxWidth > 0 ? constraints.maxWidth : intrinsic.width;
    const maxHeight = constraints.maxHeight && constraints.maxHeight > 0 ? constraints.maxHeight : Infinity;

    const widthScale = maxWidth / intrinsic.width;
    const heightScale = maxHeight / intrinsic.height;
    const scale = Math.min(1, widthScale, heightScale);

    const width = Number.isFinite(scale) ? intrinsic.width * scale : intrinsic.width;
    const height = Number.isFinite(scale) ? intrinsic.height * scale : intrinsic.height;

    return {
      kind: 'drawing',
      drawingKind: 'image',
      width,
      height,
      scale: Number.isFinite(scale) ? scale : 1,
      naturalWidth: intrinsic.width,
      naturalHeight: intrinsic.height,
      geometry: {
        width: intrinsic.width,
        height: intrinsic.height,
        rotation: 0,
        flipH: false,
        flipV: false,
      },
    };
  }

  const geometry = ensureDrawingGeometry(block.geometry);
  const attrs = block.attrs as Record<string, unknown> | undefined;
  const indentLeft = typeof attrs?.hrIndentLeft === 'number' ? attrs.hrIndentLeft : 0;
  const indentRight = typeof attrs?.hrIndentRight === 'number' ? attrs.hrIndentRight : 0;
  const hasFullWidth = attrs?.isFullWidth === true && constraints.maxWidth > 0;
  const fullWidthMax = hasFullWidth ? Math.max(1, constraints.maxWidth - indentLeft - indentRight) : undefined;
  if (fullWidthMax != null) {
    geometry.width = fullWidthMax;
  }
  let contentMeasures: TextboxContentMeasure[] | undefined;
  if (block.drawingKind === 'textboxShape' && Array.isArray(block.contentBlocks)) {
    const insets = block.textInsets ?? { top: 0, right: 0, bottom: 0, left: 0 };
    // Baseline-composed WordArt preserves the authored logical line. That
    // includes textButton: its three boundaries compose adjacent baseline
    // bands rather than a rectangular glyph envelope. Ordinary envelope
    // presets and textboxes still use the available boundary as a wrap cap.
    const autoFitBoundaryWidth =
      block.autoFit &&
      block.textLayout?.wrap === 'none' &&
      !isShapeTextBaselineWarp(block.textWarp) &&
      !isShapeTextSingleBandEnvelopeWarp(block.textWarp) &&
      constraints.maxWidth > 0
        ? constraints.maxWidth
        : undefined;
    // Text is laid out inside the untransformed shape and the drawing wrapper
    // applies rotation/scale afterwards, so use the geometry's local width.
    const contentWidth = resolveShapeTextContentMeasureWidth(
      geometry.width,
      insets,
      block.textLayout,
      autoFitBoundaryWidth,
    );
    contentMeasures = await Promise.all(
      block.contentBlocks.map(async (contentBlock) => {
        const nestedConstraints = { maxWidth: contentWidth };
        if (typeof renderDiagnosticOwner === 'function') {
          Object.defineProperty(nestedConstraints, V2_RENDER_DIAGNOSTIC_MEASUREMENT_OWNER, {
            configurable: true,
            enumerable: false,
            value: renderDiagnosticOwner,
          });
        }
        const contentMeasure = await measureBlock(contentBlock, nestedConstraints, fontContext);
        if (contentMeasure.kind !== 'paragraph' && contentMeasure.kind !== 'table') {
          throw new Error(`Unsupported textbox content measurement: ${contentMeasure.kind}`);
        }
        return contentMeasure;
      }),
    );
    if (block.autoFit) {
      if (block.textLayout?.wrap === 'none' && constraints.maxWidth > 0) {
        if (isShapeTextBaselineWarp(block.textWarp) || isShapeTextSingleBandEnvelopeWarp(block.textWarp)) {
          // Baseline-composed WordArt uses one unwrapped logical line and sizes
          // its frame from that natural advance. The frame may still be capped
          // by its container; paint compresses the baseline only at that point.
          const naturalContentWidth = contentMeasures.reduce((widest, measure) => {
            if (measure.kind === 'paragraph') {
              return Math.max(widest, ...measure.lines.map((line) => line.naturalWidth ?? line.width));
            }
            return Math.max(widest, measure.totalWidth);
          }, 0);
          geometry.width = Math.min(
            constraints.maxWidth,
            Math.max(1, insets.left + naturalContentWidth + insets.right),
          );
        } else {
          // Ordinary unwrapped textboxes grow to the available boundary before
          // composing their rectangular content. This is observable when a
          // visible textbox outline spans the column around centered text.
          geometry.width = constraints.maxWidth;
        }
      }
      const contentHeight = block.contentBlocks.reduce((height, contentBlock, index) => {
        const contentMeasure = contentMeasures?.[index];
        if (contentBlock.kind === 'table' && contentMeasure?.kind === 'table') {
          return height + contentMeasure.totalHeight;
        }
        if (contentBlock.kind === 'paragraph' && contentMeasure?.kind === 'paragraph') {
          const spacing = contentBlock.attrs?.spacing;
          return (
            height + contentMeasure.totalHeight + Math.max(0, spacing?.before ?? 0) + Math.max(0, spacing?.after ?? 0)
          );
        }
        return height;
      }, 0);
      geometry.height = Math.max(1, insets.top + contentHeight + insets.bottom);
    }
  }
  const rotatedBounds = calculateRotatedBounds(geometry);
  const naturalWidth = Math.max(1, rotatedBounds.width);
  const naturalHeight = Math.max(1, rotatedBounds.height);

  // Anchored and floating drawings are positioned independently — don't constrain
  // to the content area width (they can extend past margins/page edges).
  const isFloating = block.wrap?.type === 'None' || block.anchor?.isAnchored === true;
  // `wp:effectExtent` lies outside the authored `wp:extent`. Word constrains the
  // authored box to the text region but allows strokes/effects to paint past it;
  // include those outer pixels in the measurement budget so they do not shrink
  // the shape itself (notably zero-height footer connectors).
  const effectExtent =
    block.drawingKind === 'vectorShape' || block.drawingKind === 'textboxShape' ? block.effectExtent : undefined;
  const effectExtentWidth = (effectExtent?.left ?? 0) + (effectExtent?.right ?? 0);
  const effectExtentHeight = (effectExtent?.top ?? 0) + (effectExtent?.bottom ?? 0);
  const maxWidth =
    fullWidthMax ?? (constraints.maxWidth > 0 && !isFloating ? constraints.maxWidth + effectExtentWidth : naturalWidth);

  const maxHeight =
    isFloating || !constraints.maxHeight || constraints.maxHeight <= 0
      ? Infinity
      : constraints.maxHeight + effectExtentHeight;

  const widthScale = maxWidth / naturalWidth;
  const heightScale = maxHeight / naturalHeight;
  const normalizedScale = Math.min(1, widthScale, heightScale);
  const scale = Number.isFinite(normalizedScale) ? normalizedScale : 1;

  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  return {
    kind: 'drawing',
    drawingKind: block.drawingKind,
    width,
    height,
    scale,
    naturalWidth,
    naturalHeight,
    geometry: { ...geometry },
    ...(contentMeasures ? { contentMeasures } : {}),
    ...(block.drawingKind === 'shapeGroup' && block.groupTransform
      ? { groupTransform: { ...block.groupTransform } }
      : {}),
  };
}

function getIntrinsicImageSize(block: ImageBlock, fallback: number): { width: number; height: number } {
  const safeFallback = fallback > 0 ? fallback : 1;
  const suggestedWidth = typeof block.width === 'number' && block.width > 0 ? block.width : safeFallback;
  const suggestedHeight = typeof block.height === 'number' && block.height > 0 ? block.height : safeFallback * 0.75;

  return {
    width: suggestedWidth,
    height: suggestedHeight,
  };
}

function getIntrinsicSizeFromDims(width?: number, height?: number, fallback = 1): { width: number; height: number } {
  const safeFallback = fallback > 0 ? fallback : 1;
  const intrinsicWidth = typeof width === 'number' && width > 0 ? width : safeFallback;
  const intrinsicHeight = typeof height === 'number' && height > 0 ? height : safeFallback * 0.75;
  return {
    width: intrinsicWidth,
    height: intrinsicHeight,
  };
}

function ensureDrawingGeometry(geometry?: DrawingGeometry): DrawingGeometry {
  if (geometry) {
    return {
      width: Math.max(1, geometry.width),
      height: Math.max(1, geometry.height),
      rotation: normalizeRotation(geometry.rotation ?? 0),
      flipH: Boolean(geometry.flipH),
      flipV: Boolean(geometry.flipV),
    };
  }
  return {
    width: 1,
    height: 1,
    rotation: 0,
    flipH: false,
    flipV: false,
  };
}

function normalizeConstraints(constraints: number | MeasureConstraints): MeasureConstraints {
  if (typeof constraints === 'number') {
    return { maxWidth: constraints };
  }
  return constraints;
}

async function measureListBlock(
  block: ListBlock,
  constraints: MeasureConstraints,
  fontContext: FontMeasureContext,
): Promise<ListMeasure> {
  const ctx = getCanvasContext(fontContext);
  const items: ListMeasure['items'] = [];
  let totalHeight = 0;

  for (const item of block.items) {
    const wordLayout = item.paragraph.attrs?.wordLayout as
      | { marker?: WordParagraphLayoutOutput['marker']; indentLeftPx?: number }
      | undefined;
    let markerTextWidth: number;
    let markerWidth: number;
    let indentLeft: number;

    if ((wordLayout as WordParagraphLayoutOutput | undefined)?.marker) {
      // Track B: Use wordLayout from @superdoc/word-layout when available
      const marker = (wordLayout as WordParagraphLayoutOutput).marker!;
      // Fall back to paragraph's primary run fontSize if marker fontSize is missing
      const paragraphFallbackFontSize = getPrimaryRun(item.paragraph).fontSize ?? DEFAULT_PARAGRAPH_FONT_SIZE;
      const markerFontRun: TextRun = {
        text: marker.markerText,
        fontFamily: toCssFontFamily(marker.run.fontFamily) ?? marker.run.fontFamily,
        fontSize: marker.run.fontSize ?? paragraphFallbackFontSize,
        bold: marker.run.bold,
        italic: marker.run.italic,
        letterSpacing: marker.run.letterSpacing,
      };
      const { font: markerFont } = buildFontString(markerFontRun, fontContext);
      markerTextWidth = marker.markerText ? measureText(marker.markerText, markerFont, ctx) : 0;
      markerWidth = 0;
      indentLeft = (wordLayout as WordParagraphLayoutOutput).indentLeftPx ?? 0;
    } else {
      // Fallback: legacy behavior for backwards compatibility
      const markerFontRun = getPrimaryRun(item.paragraph);
      const { font: markerFont } = buildFontString(markerFontRun, fontContext);
      const markerText = item.marker.text ?? '';
      markerTextWidth = markerText ? measureText(markerText, markerFont, ctx) : 0;
      indentLeft = resolveIndentLeft(item);
      const indentHanging = resolveIndentHanging(item);
      markerWidth = Math.max(MIN_MARKER_GUTTER, markerTextWidth + LIST_MARKER_GAP, indentHanging);
    }

    // Account for both indentLeft and marker width so paragraph text wraps correctly
    const paragraphWidth = Math.max(1, constraints.maxWidth - indentLeft - markerWidth);

    const paragraphMeasure = await measureParagraphBlock(item.paragraph, paragraphWidth, fontContext);
    totalHeight += paragraphMeasure.totalHeight;

    items.push({
      itemId: item.id,
      markerWidth,
      markerTextWidth,
      indentLeft,
      paragraph: paragraphMeasure,
    });
  }

  return {
    kind: 'list',
    items,
    totalHeight,
  };
}

const getPrimaryRun = (paragraph: ParagraphBlock): TextRun => {
  return (
    paragraph.runs.find((run): run is TextRun => run.kind === 'text' && Boolean(run.fontFamily && run.fontSize)) || {
      text: '',
      fontFamily: 'Arial',
      fontSize: 16,
    }
  );
};

const isWordChar = (char: string): boolean => {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || char === "'";
};

const capitalizeText = (text: string, fullText?: string, startOffset?: number): string => {
  if (!text) return text;
  const hasFullText = typeof startOffset === 'number' && fullText != null;
  let result = '';
  for (let i = 0; i < text.length; i += 1) {
    const prevChar = hasFullText
      ? startOffset! + i > 0
        ? fullText![startOffset! + i - 1]
        : ''
      : i > 0
        ? text[i - 1]
        : '';
    const ch = text[i];
    result += isWordChar(ch) && !isWordChar(prevChar) ? ch.toUpperCase() : ch;
  }
  return result;
};

const applyTextTransform = (text: string, run: Run, startOffset?: number): string => {
  // Only TextRun and TabRun have textTransform (via RunMarks)
  const transform = 'textTransform' in run ? run.textTransform : undefined;
  if (!text || !transform || transform === 'none') return text;
  if (transform === 'uppercase') return text.toUpperCase();
  if (transform === 'lowercase') return text.toLowerCase();
  if (transform === 'capitalize') {
    const fullText = 'text' in run && typeof run.text === 'string' ? run.text : text;
    return capitalizeText(text, fullText, startOffset);
  }
  return text;
};

const measureRunWidth = (
  text: string,
  font: string,
  ctx: CanvasRenderingContext2D,
  run: Run,
  startOffset?: number,
): number => {
  // TextRun.kind is optional and defaults to 'text', so check for undefined or 'text'
  const letterSpacing = run.kind === 'text' || run.kind === undefined ? (run as TextRun).letterSpacing || 0 : 0;
  const displayText = applyTextTransform(text, run, startOffset);
  const width = measuredTextWidth(displayText, font, letterSpacing, ctx);
  return roundValue(width * getRunHorizontalScale(run));
};

const getRunHorizontalScale = (run: Run | undefined): number => {
  if (!run || !('horizontalScale' in run)) return 1;
  const value = run.horizontalScale;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 1;
};

const getScaledLetterSpacing = (run: TextRun): number => (run.letterSpacing ?? 0) * getRunHorizontalScale(run);

/**
 * Breaks a word that exceeds maxWidth into character-level chunks that fit within the constraint.
 *
 * This function handles the case where a single word is wider than the available line width,
 * which commonly occurs in table cells with narrow columns. Instead of letting the word overflow
 * and get clipped, this function determines where to break the word across multiple lines.
 * It also owns CJK wrapping, where the whole clause arrives as one space-free "word".
 *
 * The algorithm uses a greedy approach:
 * 1. Start with an empty chunk
 * 2. Add characters one by one, measuring the accumulated width
 * 3. When adding a character would exceed the current chunk's budget, finalize the chunk
 *    (adjusting the boundary for kinsoku when requested)
 * 4. Start a new chunk with the remaining characters
 * 5. Repeat until all characters are processed
 *
 * @param word - The word to break into chunks
 * @param maxWidth - Maximum width in pixels for each chunk
 * @param font - CSS font string for measurement
 * @param ctx - Canvas context for text measurement
 * @param run - The Run object containing styling (for letterSpacing)
 * @param startOffset - Index of the word within its run (text-transform context)
 * @param options - `firstChunkWidth` budgets the first chunk separately so it can
 *   fill the remainder of an already-started line; `applyKinsoku` enables the
 *   fullwidth line-start/line-end rules.
 * @returns Array of chunks, each containing the text and its measured width
 *
 * @example
 * // Word "Supercalifragilisticexpialidocious" in a 50px cell
 * breakWordIntoChunks("Supercalifragilisticexpialidocious", 50, "16px Arial", ctx, run)
 * // Returns: [
 * //   { text: "Super", width: 48 },
 * //   { text: "calif", width: 45 },
 * //   { text: "ragil", width: 42 },
 * //   ...
 * // ]
 */
const breakWordIntoChunks = async (
  word: string,
  maxWidth: number,
  font: string,
  ctx: CanvasRenderingContext2D,
  run: Run,
  startOffset?: number,
  options?: { firstChunkWidth?: number; applyKinsoku?: boolean },
  fontContext?: FontMeasureContext,
  measureWidth: typeof measureRunWidth = measureRunWidth,
): Promise<Array<{ text: string; width: number }>> => {
  const chunks: Array<{ text: string; width: number }> = [];
  const baseOffset = typeof startOffset === 'number' ? startOffset : 0;
  const applyKinsoku = options?.applyKinsoku === true;
  const firstChunkWidth = options?.firstChunkWidth;
  const budgetForChunk = (chunkIndex: number): number =>
    chunkIndex === 0 && typeof firstChunkWidth === 'number' ? firstChunkWidth : maxWidth;

  // Edge case: maxWidth is too small for even a single character
  // In this case, put one character per line as a fallback
  if (maxWidth <= 0) {
    for (let i = 0; i < word.length; i = nextCodePointBoundary(word, i)) {
      const end = nextCodePointBoundary(word, i);
      const char = word.slice(i, end);
      const charWidth = measureWidth(char, font, ctx, run, baseOffset + i);
      chunks.push({ text: char, width: charWidth });
    }
    return chunks;
  }

  // Each chunk is measured from its own offset. The previous implementation
  // measured every chunk from the word's start offset, which mis-capitalized
  // later chunks under `textTransform: 'capitalize'` and so mis-measured them.
  const pushChunk = (from: number, to: number): void => {
    const text = word.slice(from, to);
    chunks.push({ text, width: measureWidth(text, font, ctx, run, baseOffset + from) });
  };

  let chunkStart = 0;
  let index = 0;
  // `index` always advances a whole code point, so a boundary can never land
  // between the halves of a surrogate pair (astral CJK, e.g. U+20000). Splitting
  // there would emit lone surrogates and desync the pm offsets derived from
  // line fromChar/toChar.
  while (index < word.length) {
    if (fontContext) {
      const checkpoint = measurementCheckpointIfDue(fontContext);
      if (checkpoint) await checkpoint;
    }
    const candidateEnd = nextCodePointBoundary(word, index);
    const candidateWidth = measureWidth(word.slice(chunkStart, candidateEnd), font, ctx, run, baseOffset + chunkStart);

    if (candidateWidth > budgetForChunk(chunks.length) && index > chunkStart) {
      // Current chunk is full. resolveKinsokuBoundary always returns > chunkStart,
      // so the loop keeps making progress.
      const boundary = applyKinsoku ? resolveKinsokuBoundary(word, chunkStart, index) : index;
      pushChunk(chunkStart, boundary);
      chunkStart = boundary;
      index = boundary;
      continue;
    }

    index = candidateEnd;
  }

  // Don't forget the last chunk
  if (chunkStart < word.length) {
    pushChunk(chunkStart, word.length);
  }

  return chunks;
};

/**
 * Appends a segment to a line's segments array, with optimization for consecutive segments.
 *
 * Segments represent contiguous ranges of text within a run that may have explicit positioning
 * (e.g., from tab alignment). This function handles two cases:
 * 1. Merging: If the new segment is contiguous with the last segment in the same run and has no
 *    explicit X positioning, it merges them to reduce the number of DOM elements created during rendering.
 * 2. Appending: Otherwise, it adds a new segment to the array.
 *
 * CRITICAL: Explicit X positioning (via the `x` parameter) should only be set for the FIRST word
 * after a tab character. This is enforced by the caller checking `wordIndex === 0`. Setting explicit X
 * on all words after a tab would cause incorrect text positioning, as subsequent words should flow
 * naturally from the first word's position.
 *
 * @param segments - The segments array to append to (from a Line object), or undefined if segments are not being tracked
 * @param runIndex - The index of the run this segment belongs to
 * @param fromChar - The starting character index within the run (inclusive)
 * @param toChar - The ending character index within the run (exclusive)
 * @param width - The measured width of this segment in pixels
 * @param x - Optional explicit X position for this segment. Should only be provided for the first word
 *            after a tab character to enable absolute positioning. Subsequent words should have undefined
 *            X to allow natural text flow.
 *
 * @example
 * // First word after tab - gets explicit X
 * appendSegment(line.segments, 2, 0, 5, 50, 200);
 *
 * @example
 * // Second word after tab - no explicit X (flows from first word)
 * appendSegment(line.segments, 2, 6, 12, 60, undefined);
 *
 * @example
 * // Consecutive segments get merged
 * appendSegment(line.segments, 0, 0, 5, 40, undefined);
 * appendSegment(line.segments, 0, 5, 10, 40, undefined); // Merged with previous
 */
const appendSegment = (
  segments: Line['segments'] | undefined,
  runIndex: number,
  fromChar: number,
  toChar: number,
  width: number,
  x?: number,
  precedingTabEndX?: number,
  inlineBoxBoundaryBefore = false,
): void => {
  if (!segments) return;
  const last = segments[segments.length - 1];
  // Only merge segments if they are contiguous AND have no explicit X positioning
  // (explicit X means tab-aligned, shouldn't merge)
  if (
    last &&
    last.runIndex === runIndex &&
    last.toChar === fromChar &&
    last.x === undefined &&
    last.precedingTabEndX === undefined &&
    x === undefined &&
    precedingTabEndX === undefined &&
    !inlineBoxBoundaryBefore
  ) {
    last.toChar = toChar;
    last.width += width;
    return;
  }
  segments.push({
    runIndex,
    fromChar,
    toChar,
    width,
    ...(x !== undefined ? { x } : {}),
    ...(precedingTabEndX !== undefined ? { precedingTabEndX } : {}),
  });
};

const resolveLineHeight = (
  spacing: ParagraphSpacing | undefined,
  fontSize: number,
  naturalSingleLine: number = -1,
): number => {
  const fallbackFloor = V1_DEFAULT_PARAGRAPH_LINE_HEIGHT_MULTIPLIER * fontSize;
  const naturalSingle = naturalSingleLine > 0 ? Math.max(naturalSingleLine, fallbackFloor) : fallbackFloor;

  if (!spacing || spacing.line == null) {
    return naturalSingle;
  }

  const computedHeight = spacing.lineUnit === 'multiplier' ? spacing.line * naturalSingle : spacing.line;

  const lineRule = spacing.lineRule ?? 'auto';
  if (lineRule === 'exact') {
    return computedHeight;
  }
  if (lineRule === 'atLeast') {
    return Math.max(computedHeight, naturalSingle);
  }
  return computedHeight;
};

const sanitizePositive = (value: number | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;

/**
 * Sanitizes indent values, preserving negative numbers.
 * Unlike sanitizePositive, this allows negative values which represent
 * text extending into the page margin area (per OOXML specification).
 *
 * @param value - The indent value to sanitize (may be undefined, NaN, or Infinity)
 * @returns The sanitized indent value (0 if invalid, preserves negative if valid)
 */
export const sanitizeIndent = (value: number | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const sanitizeDecimalSeparator = (value: unknown): string => {
  if (value === ',') return ',';
  return DEFAULT_DECIMAL_SEPARATOR;
};

/**
 * Default padding around drop cap in pixels.
 * Applied to the right side of the drop cap box.
 */
const DROP_CAP_PADDING_PX = 4;

/**
 * Measure the drop cap and calculate its dimensions.
 *
 * Uses the drop cap run's font properties to measure the text width,
 * and calculates the height based on the number of lines it should span.
 *
 * @param ctx - Canvas context for text measurement
 * @param descriptor - Drop cap descriptor with run and metadata
 * @param spacing - Paragraph spacing for line height calculation
 * @returns Measured drop cap dimensions
 */
const measureDropCap = (
  ctx: CanvasRenderingContext2D,
  descriptor: DropCapDescriptor,
  spacing: ParagraphSpacing | undefined,
  fontContext: FontMeasureContext,
): { width: number; height: number; lines: number; mode: 'drop' | 'margin' } => {
  const { run, lines, mode } = descriptor;

  // Build font string for the drop cap run
  const { font } = buildFontString(
    {
      fontFamily: run.fontFamily,
      fontSize: run.fontSize,
      bold: run.bold,
      italic: run.italic,
    },
    fontContext,
  );

  // Measure the text width
  ctx.font = font;
  const displayText = applyTextTransform(run.text, run);
  const metrics = ctx.measureText(displayText);
  const advanceWidth = metrics.width;
  const paintedWidth = (metrics.actualBoundingBoxLeft || 0) + (metrics.actualBoundingBoxRight || 0);
  const textWidth = Math.max(advanceWidth, paintedWidth);

  // Add padding for spacing between drop cap and text
  const width = roundValue(textWidth + DROP_CAP_PADDING_PX);

  // Calculate height based on the number of lines the drop cap should span
  // This uses the base line height calculation from the paragraph's spacing
  const lineHeight = resolveLineHeight(spacing, run.fontSize);
  const height = roundValue(lineHeight * lines);

  return {
    width,
    height,
    lines,
    mode,
  };
};

const resolveIndentLeft = (item: ListBlock['items'][number]): number => {
  const indentLeft = sanitizePositive(item.paragraph.attrs?.indent?.left);
  if (indentLeft > 0) {
    return indentLeft;
  }
  return DEFAULT_LIST_INDENT_BASE + item.marker.level * DEFAULT_LIST_INDENT_STEP;
};

const resolveIndentHanging = (item: ListBlock['items'][number]): number => {
  const indentHanging = sanitizePositive(item.paragraph.attrs?.indent?.hanging);
  if (indentHanging > 0) {
    return indentHanging;
  }
  return DEFAULT_LIST_HANGING;
};

/**
 * Build tab stops in pixel coordinates for measurement.
 * Converts indent from px→twips, calls engine with twips, converts result twips→px.
 */
const buildTabStopsPx = (indent?: ParagraphIndent, tabs?: TabStop[], tabIntervalTwips?: number): TabStopPx[] => {
  // Convert indent from pixels to twips for the engine
  const paragraphIndentTwips = {
    left: pxToTwips(sanitizePositive(indent?.left)),
    right: pxToTwips(sanitizePositive(indent?.right)),
    firstLine: pxToTwips(sanitizePositive(indent?.firstLine)),
    hanging: pxToTwips(sanitizePositive(indent?.hanging)),
  };
  const rawParagraphIndentTwips = {
    left: pxToTwips(sanitizeIndent(indent?.left)),
    right: pxToTwips(sanitizeIndent(indent?.right)),
    firstLine: pxToTwips(sanitizeIndent(indent?.firstLine)),
    // Hanging is unsigned in OOXML; preserve negative left/right/firstLine only.
    hanging: pxToTwips(sanitizePositive(indent?.hanging)),
  };

  // Engine works in twips (tabs already in twips from PM adapter)
  const stops = computeTabStops({
    explicitStops: tabs ?? [],
    defaultTabInterval: tabIntervalTwips ?? DEFAULT_TAB_INTERVAL_TWIPS,
    paragraphIndent: paragraphIndentTwips,
    rawParagraphIndent: rawParagraphIndentTwips,
  });

  // Convert resulting tab stops from twips to pixels for measurement
  return stops.map((stop) => ({
    pos: twipsToPx(stop.pos),
    val: stop.val,
    leader: stop.leader,
    source: stop.source,
  }));
};

const getNextTabStopPx = (
  currentX: number,
  tabStops: TabStopPx[],
  startIndex: number,
): { target: number; nextIndex: number; stop?: TabStopPx } => {
  let index = startIndex;
  while (index < tabStops.length && tabStops[index].pos <= currentX + TAB_EPSILON) {
    index++;
  }
  if (index < tabStops.length) {
    return { target: tabStops[index].pos, nextIndex: index + 1, stop: tabStops[index] };
  }
  return { target: currentX + DEFAULT_TAB_INTERVAL_PX, nextIndex: index };
};
