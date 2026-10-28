import type {
  BorderSpec,
  ColumnBreakBlock,
  DrawingBlock,
  FieldAnnotationRun,
  FlowBlock,
  ImageBlock,
  MathRun,
  Measure,
  ParagraphBlock,
  ParagraphMeasure,
  PageBreakBlock,
  Run,
  SectionBreakBlock,
  TableBlock,
  TableCell,
} from '@superdoc/contracts';
import { getRenderedTableBorderWidthPx } from '@superdoc/contracts';
import { DEFAULT_FONT_MEASURE_CONTEXT, type FontMeasureContext } from '@superdoc/font-system';
import type { AutoFitRowInput } from './autofit-columns.js';
import type { WorkingTableCellInput, WorkingTableGridInput } from './autofit-normalize.js';
import {
  codePointAt,
  hasCjkBreakOpportunity,
  isCjkBreakOpportunityChar,
  nextCodePointBoundary,
  resolveKinsokuBoundary,
} from './cjk-line-break.js';
import type { FixedLayoutResult } from './fixed-table-columns.js';
import { getMeasuredTextWidth } from './measurementCache.js';
import {
  ensureSurfaceMeasurementCanvas,
  createMeasurementCanvasContext,
  getSurfaceMeasurementRuntime,
  getSurfaceMeasurementRuntimeForCanvas,
  surfaceMeasurementCheckpointIfDue,
} from './measurement-runtime-context.js';
import { memoizedMeasurementInputKey, serializeMeasurementInput } from './measurement-input-key.js';
import { beginProvisionalMetricWatch } from './measurement-runtime-context.js';

const DEFAULT_CELL_PADDING = { top: 0, right: 4, bottom: 0, left: 4 };
const DEFAULT_FIELD_ANNOTATION_FONT_SIZE = 16;
// Keep in sync with the field-annotation padding used in `measuring/dom/src/index.ts`.
const FIELD_ANNOTATION_PILL_PADDING = 8;
const TABLE_CELL_METRICS_CACHE_SIZE = 2000;
const TABLE_AUTOFIT_RESULT_CACHE_SIZE = 500;
/**
 * Sentinel width used to measure paragraph max-content width without introducing
 * artificial wrapping. It intentionally exceeds any realistic authored line.
 */
const NO_WRAP_MAX_WIDTH = Number.MAX_SAFE_INTEGER;
const TOKEN_BOUNDARY_PATTERN =
  /[ \t\f\v\-\u00ad\u2010\u2012\u2013\u2014\u200b\u2028\u2029]+|\r\n|\r|\n|\u2028|\u2029/gu;

/**
 * Minimal measurement constraints shape consumed by the injected block measurer.
 *
 * The helper only needs width and optional height ceilings, so it intentionally
 * avoids importing the full internal `MeasureConstraints` type from `index.ts`.
 */
export type AutoFitMeasureConstraints = {
  maxWidth: number;
  maxHeight?: number;
};

/**
 * Callback used to reuse the existing `measuring/dom` block measurer from the
 * AutoFit content-metrics layer without creating a module cycle.
 */
export type AutoFitMeasureBlock = (block: FlowBlock, constraints: AutoFitMeasureConstraints) => Promise<Measure>;

/**
 * Final intrinsic width metrics for a single table cell's content box.
 *
 * Both values include horizontal cell padding and borders so callers can feed
 * the result directly into column-width resolution.
 */
export type TableCellContentMetrics = {
  /**
   * Minimum outer cell width in pixels.
   *
   * This is the widest unbreakable content unit, plus horizontal cell chrome.
   */
  minWidthPx: number;
  /**
   * Maximum outer cell width in pixels.
   *
   * This is the no-wrap authored line width, plus horizontal cell chrome.
   */
  maxWidthPx: number;
};

/**
 * Options that affect cell content measurement and cache invalidation.
 */
export type TableCellContentMetricsOptions = {
  /**
   * Maximum content width available to the cell.
   *
   * For nested tables with percentage widths, this is the denominator used to
   * resolve the nested table's preferred width.
   */
  maxWidth: number;
  /**
   * Existing block measurer reused for paragraphs, drawings, and nested tables.
   */
  measureBlock: AutoFitMeasureBlock;
  /**
   * Per-document font measure context. Exported helpers default to the shared context
   * for tests and context-free callers; runtime layout passes the document context.
   *
   * `resolvePhysical` maps the run's logical family (e.g. "Calibri") to the
   * physical render family (e.g. "Carlito") so token min-width is measured in
   * the same font it is painted with. `fontSignature` is folded into the cache
   * key so two documents with different `fonts.map` tables never share cached
   * widths.
   */
  fontContext?: FontMeasureContext;
  /**
   * Optional external invalidation dimension. If measurement already depends on
   * a layout epoch or similar version, callers can fold it into the cache key.
   */
  layoutEpoch?: number | string;
  /** Ignore object IDs in geometry-only keys for explicitly gated large passes. */
  identityNeutralCache?: boolean;
};

type NormalizedTableCellContentMetricsOptions = TableCellContentMetricsOptions & {
  fontContext: FontMeasureContext;
};

type TableCellContentBlock =
  | ParagraphBlock
  | ImageBlock
  | DrawingBlock
  | TableBlock
  | SectionBreakBlock
  | PageBreakBlock
  | ColumnBreakBlock;

/**
 * Cacheable table-level AutoFit result skeleton.
 *
 * Commit 5 does not wire this cache into runtime layout yet; it only defines
 * the storage contract and invalidation boundary that later commits will use.
 */
export type AutoFitTableResultCacheEntry = {
  columnWidths: number[];
  totalWidth: number;
};

/**
 * Inputs that determine whether a cached table-level AutoFit result is still valid.
 *
 * The key intentionally depends on the participating cell-metrics keys so a
 * single-cell edit invalidates the owning table result without forcing unrelated
 * cells to drop their own cached intrinsic metrics.
 */
export type AutoFitTableResultKeyOptions = {
  maxWidth: number;
  cellMetricKeys: string[];
  /**
   * Document font-mapping identity. Already reflected indirectly through
   * `cellMetricKeys`, but folded in directly so the table result key is robust
   * even if the cell-key derivation changes.
   */
  fontSignature: string;
  layoutEpoch?: number | string;
  workingInput: WorkingTableGridInput;
  fixedLayout: FixedLayoutResult;
  identityNeutralCache?: boolean;
};

/**
 * Measured intrinsic width metrics for one concrete AutoFit cell.
 *
 * The shape is indexed by row and cell position so downstream code can:
 * - keep content metrics separate from final width resolution
 * - join the metrics back to normalized row placement deterministically
 * - cache the table result using the participating cell metric keys
 */
export type TableAutoFitCellMetrics = {
  /** Physical cell index within its source row. */
  cellIndex: number;
  /** Logical span width in grid columns. */
  span: number;
  /** Preferred cell width contributed by normalization, in pixels. */
  preferredWidth?: number;
  /** Measured minimum outer cell width, in pixels. */
  minContentWidth: number;
  /** Measured maximum outer cell width, in pixels. */
  maxContentWidth: number;
};

/**
 * Measured intrinsic width metrics for one AutoFit row.
 */
export type TableAutoFitRowMetrics = {
  /** Physical row index within the source table. */
  rowIndex: number;
  /** Concrete measured cells in physical document order. */
  cells: TableAutoFitCellMetrics[];
};

/**
 * Stable AutoFit content-metrics contract produced by the measurement layer.
 *
 * `rowMetrics` is the durable row/cell-indexed shape for the rework.
 * `rows` is the current solver-facing compatibility projection used until the
 * pure AutoFit solver consumes `rowMetrics` directly in later commits.
 */
export type TableAutoFitContentMetricsResult = {
  /** Stable row/cell-indexed intrinsic width metrics. */
  rowMetrics: TableAutoFitRowMetrics[];
  /** Current solver-facing projection that preserves skipped-column metadata. */
  rows: AutoFitRowInput[];
  /** Cache keys for each participating cell metrics entry. */
  cellMetricKeys: string[];
};

type LruEntry<T> = {
  value: T;
};

type TokenFragment = {
  text: string;
  font: string;
  letterSpacing: number;
  horizontalScale: number;
};

/**
 * Small LRU cache used for AutoFit-specific derived measurements.
 *
 * The implementation stays local to `measuring/dom` so cache ownership remains
 * at the same pipeline stage as the code that computes these values.
 */
class LruCache<T> {
  private readonly cache = new Map<string, LruEntry<T>>();
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: string): T | undefined {
    const hit = this.cache.get(key);
    if (!hit) return undefined;
    this.cache.delete(key);
    this.cache.set(key, hit);
    return hit.value;
  }

  set(key: string, value: T): void {
    this.cache.set(key, { value });
    this.evictIfNeeded();
  }

  clear(): void {
    this.cache.clear();
  }

  resize(nextSize: number): void {
    if (!Number.isFinite(nextSize) || nextSize <= 0) return;
    this.maxSize = nextSize;
    this.evictIfNeeded();
  }

  private evictIfNeeded(): void {
    while (this.cache.size > this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) break;
      this.cache.delete(oldestKey);
    }
  }
}

const tableCellMetricsCache = new LruCache<TableCellContentMetrics>(TABLE_CELL_METRICS_CACHE_SIZE);
const autoFitTableResultCache = new LruCache<AutoFitTableResultCacheEntry>(TABLE_AUTOFIT_RESULT_CACHE_SIZE);

let canvasContext: CanvasRenderingContext2D | null = null;

/**
 * Clears all AutoFit-specific measurement caches owned by `measuring/dom`.
 *
 * Tests should call this before assertions that depend on cache invalidation.
 */
export function clearTableAutoFitMeasurementCaches(): void {
  tableCellMetricsCache.clear();
  autoFitTableResultCache.clear();
}

/**
 * Adjusts the bounded cache sizes used by the AutoFit content-metrics layer.
 */
export function setTableAutoFitMeasurementCacheSizes(options: { cellMetrics?: number; tableResults?: number }): void {
  if (typeof options.cellMetrics === 'number') {
    tableCellMetricsCache.resize(options.cellMetrics);
  }
  if (typeof options.tableResults === 'number') {
    autoFitTableResultCache.resize(options.tableResults);
  }
}

/**
 * Builds the per-cell cache key used for intrinsic content metrics.
 *
 * The key includes:
 * - the cell's content tree
 * - cell attrs that affect width measurement
 * - the effective available width
 * - an optional external layout epoch
 */
export function buildTableCellContentMetricsCacheKey(
  cell: TableCell,
  options: Omit<TableCellContentMetricsOptions, 'measureBlock'>,
): string {
  const fontContext = options.fontContext ?? DEFAULT_FONT_MEASURE_CONTEXT;
  const maxWidth = Math.max(1, Math.round(options.maxWidth));
  const fontSignature = fontContext.fontSignature ?? '';
  const layoutEpoch = options.layoutEpoch ?? null;
  const omitObjectIds = options.identityNeutralCache === true;
  return memoizedMeasurementInputKey(
    cell,
    `${maxWidth}\u0000${fontSignature}\u0000${String(layoutEpoch)}\u0000${omitObjectIds ? 1 : 0}`,
    () =>
      serializeMeasurementInput(
        {
          maxWidth,
          fontSignature,
          layoutEpoch,
          attrs: cell.attrs ?? null,
          paragraph: cell.paragraph ?? null,
          blocks: cell.blocks ?? null,
        },
        { omitObjectIds },
      ),
  );
}

/**
 * Builds the owning-table cache key for a fully resolved AutoFit result.
 *
 * The table result cache deliberately depends on child cell-metrics keys so a
 * single-cell edit invalidates the table result while leaving unrelated cell
 * metric entries reusable.
 */
export function buildAutoFitTableResultCacheKey(table: TableBlock, options: AutoFitTableResultKeyOptions): string {
  return stableSerialize({
    ...(options.identityNeutralCache === true ? {} : { id: table.id }),
    attrs: table.attrs ?? null,
    columnWidths: table.columnWidths ?? null,
    rowCount: table.rows.length,
    maxWidth: Math.max(1, Math.round(options.maxWidth)),
    fontSignature: options.fontSignature ?? '',
    layoutEpoch: options.layoutEpoch ?? null,
    cellMetricKeys: options.cellMetricKeys,
    workingGrid: {
      layoutMode: options.workingInput.layoutMode,
      gridColumnCount: options.workingInput.gridColumnCount,
      preserveAuthoredGrid: options.workingInput.preserveAuthoredGrid === true,
      preserveAutoGrid: options.workingInput.preserveAutoGrid === true,
      stableAutoGrid: options.workingInput.stableAutoGrid === true,
      preserveExplicitAutoGrid: options.workingInput.preserveExplicitAutoGrid === true,
      autoGridWidthBudget: options.workingInput.autoGridWidthBudget ?? null,
      preferredTableWidth: options.workingInput.preferredTableWidth ?? null,
      preferredColumnWidths: options.workingInput.preferredColumnWidths,
      rows: options.workingInput.rows.map((row) => ({
        logicalColumnCount: row.logicalColumnCount,
        skippedColumns: (row.skippedColumns ?? []).map((column) => ({
          columnIndex: column.columnIndex,
          preferredWidth: column.preferredWidth ?? null,
        })),
        cells: (row.cells as WorkingTableCellInput[]).map((cell) => ({
          startColumn: cell.startColumn,
          span: cell.span ?? 1,
          preferredWidth: cell.preferredWidth ?? null,
        })),
      })),
    },
    fixedLayout: {
      columnWidths: options.fixedLayout.columnWidths,
      totalWidth: options.fixedLayout.totalWidth,
      gridColumnCount: options.fixedLayout.gridColumnCount,
      preferredTableWidth: options.fixedLayout.preferredTableWidth ?? null,
    },
  });
}

/**
 * Returns a cached table-level AutoFit result when available.
 */
export function getCachedAutoFitTableResult(cacheKey: string): AutoFitTableResultCacheEntry | undefined {
  return autoFitTableResultCache.get(cacheKey);
}

/**
 * Stores a table-level AutoFit result in the bounded LRU cache.
 */
export function setCachedAutoFitTableResult(cacheKey: string, result: AutoFitTableResultCacheEntry): void {
  autoFitTableResultCache.set(cacheKey, result);
}

/**
 * Computes the intrinsic minimum and maximum width contribution for a table cell.
 *
 * The helper is pure with respect to table layout decisions: it only measures
 * cell content, adds horizontal padding and borders, and returns the resulting
 * outer widths. It does not decide final column widths.
 */
export async function measureTableCellContentMetrics(
  cell: TableCell,
  options: TableCellContentMetricsOptions,
): Promise<TableCellContentMetrics> {
  const fontContext = options.fontContext ?? DEFAULT_FONT_MEASURE_CONTEXT;
  const normalizedOptions: NormalizedTableCellContentMetricsOptions = { ...options, fontContext };
  const cacheKey = buildTableCellContentMetricsCacheKey(cell, normalizedOptions);
  return measureTableCellContentMetricsWithKey(cell, normalizedOptions, cacheKey);
}

async function measureTableCellContentMetricsWithKey(
  cell: TableCell,
  options: NormalizedTableCellContentMetricsOptions,
  cacheKey: string,
  observeCacheOutcome?: (outcome: 'hit' | 'miss') => void,
): Promise<TableCellContentMetrics> {
  const cached = tableCellMetricsCache.get(cacheKey);
  if (cached) {
    observeCacheOutcome?.('hit');
    return cached;
  }
  observeCacheOutcome?.('miss');

  const horizontalInsets = getHorizontalCellInsets(cell);
  const contentBlocks = cell.blocks ?? (cell.paragraph ? [cell.paragraph] : []);

  if (contentBlocks.length === 0) {
    const emptyMetrics = {
      minWidthPx: horizontalInsets,
      maxWidthPx: horizontalInsets,
    };
    tableCellMetricsCache.set(cacheKey, emptyMetrics);
    return emptyMetrics;
  }

  let minContentWidthPx = 0;
  let maxContentWidthPx = 0;

  const consumedProvisionalMetrics = beginProvisionalMetricWatch(options.fontContext);
  for (const block of contentBlocks) {
    const metrics = await measureIntrinsicBlockWidthMetrics(block, options);
    minContentWidthPx = Math.max(minContentWidthPx, metrics.minWidthPx);
    maxContentWidthPx = Math.max(maxContentWidthPx, metrics.maxWidthPx);
  }

  const result = {
    minWidthPx: minContentWidthPx + horizontalInsets,
    maxWidthPx: maxContentWidthPx + horizontalInsets,
  };

  if (!consumedProvisionalMetrics()) tableCellMetricsCache.set(cacheKey, result);
  return result;
}

/**
 * Measure all concrete cells in a normalized AutoFit table and return a stable
 * row/cell-indexed metrics shape plus the current solver-facing projection.
 *
 * This helper keeps content measurement separate from width resolution:
 * - it does not decide final column widths
 * - it does not mutate the working grid
 * - it preserves the nested-table percentage denominator behavior by using the
 *   fixed-pass table width basis supplied by normalization/runtime
 *
 * @param table - Runtime table block being measured.
 * @param workingInput - Normalized working-grid input for the table.
 * @param measureBlock - Existing block measurer reused for intrinsic widths.
 * @param fontContext - Per-document font measure context. Omitted callers use the
 *   shared default; runtime layout passes the document context.
 * @returns Row/cell-indexed content metrics plus compatibility rows.
 */
export async function measureTableAutoFitContentMetrics(
  table: TableBlock,
  workingInput: WorkingTableGridInput,
  fixedLayout: FixedLayoutResult,
  measureBlock: AutoFitMeasureBlock,
  fontContext: FontMeasureContext = DEFAULT_FONT_MEASURE_CONTEXT,
  observeCellMetricCacheOutcome?: (outcome: 'hit' | 'miss') => void,
  identityNeutralCache = false,
): Promise<TableAutoFitContentMetricsResult> {
  const tableMeasurementBasis = Math.max(1, fixedLayout.totalWidth);
  const cellMetricKeys: string[] = [];

  const rowMetrics = await Promise.all(
    table.rows.map(async (row, rowIndex) => {
      const normalizedRow = workingInput.rows[rowIndex] ?? {};
      const cells = await Promise.all(
        row.cells.map(async (cell, cellIndex) => {
          const normalizedCell = normalizedRow.cells?.[cellIndex];
          const span = normalizedCell?.span ?? cell.colSpan ?? 1;
          const measurementMaxWidth = resolveAutoFitCellMeasurementMaxWidth(
            cell,
            normalizedCell,
            span,
            fixedLayout,
            tableMeasurementBasis,
            workingInput.gridColumnCount,
          );

          const cellMetricKey = buildTableCellContentMetricsCacheKey(cell, {
            maxWidth: measurementMaxWidth,
            fontContext,
            identityNeutralCache,
          });
          cellMetricKeys.push(cellMetricKey);

          const metrics = await measureTableCellContentMetricsWithKey(
            cell,
            {
              maxWidth: measurementMaxWidth,
              measureBlock,
              fontContext,
              identityNeutralCache,
            },
            cellMetricKey,
            observeCellMetricCacheOutcome,
          );

          return {
            cellIndex,
            span,
            preferredWidth: normalizedCell?.preferredWidth,
            minContentWidth: metrics.minWidthPx,
            maxContentWidth: metrics.maxWidthPx,
          };
        }),
      );

      return {
        rowIndex,
        cells,
      };
    }),
  );

  return {
    rowMetrics,
    rows: rowMetrics.map((rowMetrics, rowIndex) => {
      const normalizedRow = workingInput.rows[rowIndex] ?? {};
      return {
        skippedBefore: normalizedRow.skippedBefore ?? [],
        cells: rowMetrics.cells.map((cellMetrics) => ({
          span: cellMetrics.span,
          preferredWidth: cellMetrics.preferredWidth,
          minContentWidth: cellMetrics.minContentWidth,
          maxContentWidth: cellMetrics.maxContentWidth,
        })),
        skippedAfter: normalizedRow.skippedAfter ?? [],
      };
    }),
    cellMetricKeys,
  };
}

/**
 * Resolves intrinsic width metrics for a single flow block inside a table cell.
 */
async function measureIntrinsicBlockWidthMetrics(
  block: TableCellContentBlock,
  options: NormalizedTableCellContentMetricsOptions,
): Promise<TableCellContentMetrics> {
  if (block.kind === 'paragraph') {
    return measureParagraphIntrinsicWidthMetrics(block, options.measureBlock, options.fontContext);
  }

  if (block.kind === 'table') {
    return measureNestedTableIntrinsicWidthMetrics(block, options);
  }

  if (isControlBlock(block)) {
    return {
      minWidthPx: 0,
      maxWidthPx: 0,
    };
  }

  const intrinsicWidth = getIntrinsicAtomicBlockWidth(block);
  return {
    minWidthPx: intrinsicWidth,
    maxWidthPx: intrinsicWidth,
  };
}

function isControlBlock(
  block: TableCellContentBlock,
): block is Extract<TableCellContentBlock, { kind: 'sectionBreak' | 'pageBreak' | 'columnBreak' }> {
  return block.kind === 'sectionBreak' || block.kind === 'pageBreak' || block.kind === 'columnBreak';
}

/**
 * Measures paragraph min/max widths for AutoFit purposes.
 *
 * Maximum width reuses the normal paragraph measurer with a very wide line box
 * so explicit line breaks and authored line boundaries remain intact. Minimum
 * width is derived from the widest unbreakable token inside the paragraph.
 */
async function measureParagraphIntrinsicWidthMetrics(
  paragraph: ParagraphBlock,
  measureBlock: AutoFitMeasureBlock,
  fontContext: FontMeasureContext,
): Promise<TableCellContentMetrics> {
  const maxMeasure = (await measureBlock(paragraph, {
    maxWidth: NO_WRAP_MAX_WIDTH,
    maxHeight: Infinity,
  })) as ParagraphMeasure;

  const maxLineWidth = maxMeasure.lines.reduce((widest, line) => Math.max(widest, line.width), 0);
  const minTokenWidth = await measureParagraphMinTokenWidth(paragraph, fontContext);

  return {
    minWidthPx: minTokenWidth,
    maxWidthPx: maxLineWidth,
  };
}

/**
 * Measures nested table width contribution against the containing cell's content width.
 *
 * Percentage widths on nested tables must resolve against the containing cell,
 * not the outer section width, so the helper reuses the provided `maxWidth`
 * directly as the nested table's available width denominator.
 */
async function measureNestedTableIntrinsicWidthMetrics(
  table: TableBlock,
  options: NormalizedTableCellContentMetricsOptions,
): Promise<TableCellContentMetrics> {
  const nestedMeasure = await options.measureBlock(table, {
    maxWidth: Math.max(1, options.maxWidth),
    maxHeight: Infinity,
  });

  if (nestedMeasure.kind !== 'table') {
    return { minWidthPx: 0, maxWidthPx: 0 };
  }

  return {
    minWidthPx: nestedMeasure.totalWidth,
    maxWidthPx: nestedMeasure.totalWidth,
  };
}

/**
 * Computes the widest unbreakable token across all authored paragraph lines.
 */
async function measureParagraphMinTokenWidth(
  paragraph: ParagraphBlock,
  fontContext: FontMeasureContext,
): Promise<number> {
  let widestToken = 0;
  let currentTokenFragments: TokenFragment[] = [];
  let currentTokenStart: number | undefined;
  let currentTokenEnd: number | undefined;
  let paragraphOffset = 0;

  const flushToken = async (): Promise<void> => {
    const checkpoint = surfaceMeasurementCheckpointIfDue(fontContext);
    if (checkpoint) await checkpoint;
    const inlineAdvance =
      currentTokenStart === undefined || currentTokenEnd === undefined
        ? 0
        : inlineBoxAdvanceForRange(paragraph, currentTokenStart, currentTokenEnd);
    widestToken = Math.max(
      widestToken,
      (await measureTokenFragments(currentTokenFragments, fontContext)) + inlineAdvance,
    );
    currentTokenFragments = [];
    currentTokenStart = undefined;
    currentTokenEnd = undefined;
  };

  for (const run of paragraph.runs) {
    if (isExplicitLineBreakRun(run)) {
      await flushToken();
      paragraphOffset += 1;
      continue;
    }

    if (isTextLikeRun(run)) {
      if ('vanish' in run && run.vanish === true) {
        paragraphOffset += run.text.length;
        continue;
      }

      await accumulateTextRunMinTokenWidth(
        run,
        (fragment, from, to) => {
          currentTokenFragments.push(fragment);
          currentTokenStart ??= paragraphOffset + from;
          currentTokenEnd = paragraphOffset + to;
        },
        flushToken,
        fontContext,
      );
      paragraphOffset += run.text.length;
      continue;
    }

    await flushToken();

    const inlineAdvance = inlineBoxAdvanceForRange(paragraph, paragraphOffset, paragraphOffset + 1);
    if (run.kind === 'image') {
      widestToken = Math.max(widestToken, (run.width ?? 0) + inlineAdvance);
      paragraphOffset += 1;
      continue;
    }

    if (run.kind === 'fieldAnnotation') {
      widestToken = Math.max(widestToken, measureFieldAnnotationWidth(run, fontContext) + inlineAdvance);
      paragraphOffset += 1;
      continue;
    }

    if (run.kind === 'math') {
      widestToken = Math.max(widestToken, ((run as MathRun).width ?? 0) + inlineAdvance);
    }
    paragraphOffset += 1;
  }

  await flushToken();
  return widestToken;
}

const inlineBoxAdvanceForRange = (paragraph: ParagraphBlock, from: number, to: number): number =>
  (paragraph.inlineBoxes ?? []).reduce((advance, box) => {
    if (box.from >= to || box.to <= from) return advance;
    return (
      advance +
      box.layout.paddingInlineStart +
      box.layout.paddingInlineEnd +
      box.layout.borderWidth * 2 +
      (box.from >= from ? box.layout.gapBefore : 0) +
      (box.to <= to ? box.layout.gapAfter : 0)
    );
  }, 0);

/**
 * Measures the widest unbreakable token contributed by a text-bearing run.
 */
async function accumulateTextRunMinTokenWidth(
  run: Extract<Run, { text: string }>,
  appendTokenPiece: (fragment: TokenFragment, from: number, to: number) => void,
  flushToken: () => Promise<void>,
  fontContext: FontMeasureContext,
): Promise<void> {
  const font = buildFontString(run, fontContext);
  let cursor = 0;

  for (const boundary of run.text.matchAll(TOKEN_BOUNDARY_PATTERN)) {
    const boundaryStart = boundary.index ?? cursor;
    if (boundaryStart > cursor) {
      appendTokenPiece(buildTextRunTokenFragment(run, cursor, boundaryStart, font), cursor, boundaryStart);
    }
    await flushToken();
    cursor = boundaryStart + boundary[0].length;
  }

  if (cursor < run.text.length) {
    appendTokenPiece(buildTextRunTokenFragment(run, cursor, run.text.length, font), cursor, run.text.length);
  }
}

function buildTextRunTokenFragment(
  run: Extract<Run, { text: string }>,
  start: number,
  end: number,
  font: string,
): TokenFragment {
  const token = run.text.slice(start, end);
  return {
    text: applyTextTransform(token, run, start),
    font,
    letterSpacing: getLetterSpacing(run),
    horizontalScale: getHorizontalScale(run),
  };
}

async function measureTokenFragments(fragments: TokenFragment[], fontContext: FontMeasureContext): Promise<number> {
  if (fragments.length === 0) {
    return 0;
  }

  const mergedFragments: TokenFragment[] = [];

  for (const fragment of fragments) {
    const previous = mergedFragments[mergedFragments.length - 1];
    if (
      previous &&
      previous.font === fragment.font &&
      previous.letterSpacing === fragment.letterSpacing &&
      previous.horizontalScale === fragment.horizontalScale
    ) {
      previous.text += fragment.text;
      continue;
    }

    mergedFragments.push({ ...fragment });
  }

  const ctx = getCanvasContext(fontContext);
  const containsCjk = mergedFragments.some(
    (fragment) => hasCjkBreakOpportunity(fragment.text) || isCjkBreakOpportunityChar(fragment.text),
  );
  if (!containsCjk) {
    let width = 0;
    for (const fragment of mergedFragments) {
      width +=
        measureCachedTextWidth(fragment.text, fragment.font, fragment.letterSpacing, ctx) * fragment.horizontalScale;
    }
    return width;
  }

  const text = mergedFragments.map((fragment) => fragment.text).join('');
  let widestBreakUnit = 0;
  let rangeStart = 0;
  let fragmentIndex = 0;
  let fragmentStart = 0;

  while (rangeStart < text.length) {
    const checkpoint = surfaceMeasurementCheckpointIfDue(fontContext);
    if (checkpoint) await checkpoint;
    let greedyEnd = nextCodePointBoundary(text, rangeStart);
    if (!isCjkBreakOpportunityChar(codePointAt(text, rangeStart))) {
      while (greedyEnd < text.length && !isCjkBreakOpportunityChar(codePointAt(text, greedyEnd))) {
        greedyEnd = nextCodePointBoundary(text, greedyEnd);
      }
    }

    const rangeEnd = resolveKinsokuBoundary(text, rangeStart, greedyEnd);
    while (
      fragmentIndex < mergedFragments.length &&
      fragmentStart + mergedFragments[fragmentIndex].text.length <= rangeStart
    ) {
      fragmentStart += mergedFragments[fragmentIndex].text.length;
      fragmentIndex += 1;
    }
    widestBreakUnit = Math.max(
      widestBreakUnit,
      measureTokenFragmentRange(mergedFragments, rangeStart, rangeEnd, ctx, fragmentIndex, fragmentStart),
    );
    rangeStart = rangeEnd;
  }

  return widestBreakUnit;
}

function measureTokenFragmentRange(
  fragments: TokenFragment[],
  rangeStart: number,
  rangeEnd: number,
  ctx: CanvasRenderingContext2D,
  initialFragmentIndex = 0,
  initialFragmentStart = 0,
): number {
  let width = 0;
  let fragmentIndex = initialFragmentIndex;
  let fragmentStart = initialFragmentStart;

  while (fragmentIndex < fragments.length && fragmentStart < rangeEnd) {
    const fragment = fragments[fragmentIndex];
    const fragmentEnd = fragmentStart + fragment.text.length;
    const overlapStart = Math.max(rangeStart, fragmentStart);
    const overlapEnd = Math.min(rangeEnd, fragmentEnd);
    if (overlapEnd > overlapStart) {
      const text = fragment.text.slice(overlapStart - fragmentStart, overlapEnd - fragmentStart);
      width += measureCachedTextWidth(text, fragment.font, fragment.letterSpacing, ctx) * fragment.horizontalScale;
    }
    fragmentStart = fragmentEnd;
    fragmentIndex += 1;
  }

  return width;
}

/**
 * Returns the intrinsic width for atomic non-text block content.
 */
function getIntrinsicAtomicBlockWidth(block: ImageBlock | DrawingBlock): number {
  if (block.kind === 'image') {
    return block.width ?? 0;
  }

  if (block.drawingKind === 'image') {
    return block.width ?? 0;
  }

  if (block.drawingKind === 'shapeGroup') {
    return block.size?.width ?? block.geometry.width;
  }

  return block.geometry.width;
}

/**
 * Estimate the content-box width basis used for recursive intrinsic
 * measurement inside one AutoFit cell.
 *
 * This is intentionally not the final runtime cell width. It is only the
 * measurement basis for recursive content such as nested percentage tables
 * while the outer table's AutoFit width resolution is still pending.
 */
function resolveAutoFitCellMeasurementMaxWidth(
  cell: TableCell,
  normalizedCell:
    | {
        startColumn?: number;
        span?: number;
        preferredWidth?: number;
      }
    | undefined,
  span: number,
  fixedLayout: FixedLayoutResult,
  tableWidthBasis: number,
  gridColumnCount: number,
): number {
  const fixedPassOuterWidth = resolveFixedPassCellOuterWidth(normalizedCell, span, fixedLayout);
  const outerWidth =
    fixedPassOuterWidth ??
    normalizedCell?.preferredWidth ??
    Math.max(1, tableWidthBasis * (Math.max(1, span) / Math.max(1, gridColumnCount || span || 1)));
  const padding = cell.attrs?.padding ?? DEFAULT_CELL_PADDING;
  const leftPadding = padding.left ?? DEFAULT_CELL_PADDING.left;
  const rightPadding = padding.right ?? DEFAULT_CELL_PADDING.right;
  const leftBorder = getCellBorderWidthPx(cell.attrs?.borders?.left);
  const rightBorder = getCellBorderWidthPx(cell.attrs?.borders?.right);
  return Math.max(1, outerWidth - leftPadding - rightPadding - leftBorder - rightBorder);
}

/**
 * Resolve the actual fixed-pass outer width for a normalized cell when that
 * placement information is available.
 *
 * AutoFit content measurement must use the fixed-pass cell width basis so
 * nested percentage tables resolve against the containing cell's actual width,
 * not the page width fallback.
 */
function resolveFixedPassCellOuterWidth(
  normalizedCell:
    | {
        startColumn?: number;
        span?: number;
      }
    | undefined,
  fallbackSpan: number,
  fixedLayout: FixedLayoutResult,
): number | undefined {
  if (normalizedCell?.startColumn == null) {
    return undefined;
  }

  const span = Math.max(1, normalizedCell.span ?? fallbackSpan);
  let width = 0;
  for (let offset = 0; offset < span; offset++) {
    width += fixedLayout.columnWidths[normalizedCell.startColumn + offset] ?? 0;
  }

  return width > 0 ? width : undefined;
}

/**
 * Returns the horizontal cell chrome that must be added to content metrics.
 */
function getHorizontalCellInsets(cell: TableCell): number {
  const padding = cell.attrs?.padding ?? DEFAULT_CELL_PADDING;
  const leftPadding = padding.left ?? DEFAULT_CELL_PADDING.left;
  const rightPadding = padding.right ?? DEFAULT_CELL_PADDING.right;
  const leftBorder = getCellBorderWidthPx(cell.attrs?.borders?.left);
  const rightBorder = getCellBorderWidthPx(cell.attrs?.borders?.right);

  return leftPadding + rightPadding + leftBorder + rightBorder;
}

/**
 * Converts a cell border definition to pixels.
 *
 * The `thick` special case mirrors painter-side rendering in
 * `painters/dom/src/table/border-utils.ts`.
 */
function getCellBorderWidthPx(border: BorderSpec | undefined): number {
  if (!border || border.style === 'none') {
    return 0;
  }

  return getRenderedTableBorderWidthPx(border);
}

/**
 * Creates the canvas context used by token-level text measurement.
 */
function getCanvasContext(fontContext?: FontMeasureContext): CanvasRenderingContext2D {
  const runtime = getSurfaceMeasurementRuntime(fontContext);
  if (runtime) return ensureSurfaceMeasurementCanvas(runtime);
  canvasContext ??= createMeasurementCanvasContext();

  return canvasContext;
}

function measureCachedTextWidth(
  text: string,
  font: string,
  letterSpacing: number,
  context: CanvasRenderingContext2D,
): number {
  // Intrinsic table widths use the same Word kerning default as paragraph paint.
  // A cold table canvas must not inherit Canvas2D's automatic kerning.
  context.fontKerning = 'none';
  const runtime = getSurfaceMeasurementRuntimeForCanvas(context);
  return runtime
    ? runtime.textWidths.measure(text, font, letterSpacing, context)
    : getMeasuredTextWidth(text, font, letterSpacing, context);
}

/**
 * Builds a CSS font string from a text-bearing run.
 *
 * The logical family is resolved to the physical render family via the
 * document's `resolvePhysical` so token min-width is measured in the same font
 * the run is painted with, honoring any per-document `fonts.map`.
 */
function buildFontString(
  run: {
    fontFamily?: string;
    fontSize?: number | string;
    bold?: boolean;
    italic?: boolean;
    smallCaps?: boolean;
  },
  fontContext: FontMeasureContext,
): string {
  const parts: string[] = [];
  if (run.italic) parts.push('italic');
  if (run.bold) parts.push('bold');
  if (run.smallCaps) parts.push('small-caps');
  parts.push(`${normalizeFontSize(run.fontSize)}px`);
  const face = {
    weight: run.bold ? ('700' as const) : ('400' as const),
    style: run.italic ? ('italic' as const) : ('normal' as const),
  };
  const physicalFamily = normalizeFontFamily(fontContext.resolvePhysical(normalizeFontFamily(run.fontFamily), face));
  parts.push(physicalFamily);
  return parts.join(' ');
}

/**
 * Applies run-level text transforms before measuring token widths.
 */
function applyTextTransform(text: string, run: { textTransform?: string; text?: string }, startOffset = 0): string {
  const transform = run.textTransform;
  if (!text || !transform || transform === 'none') return text;
  if (transform === 'uppercase') return text.toUpperCase();
  if (transform === 'lowercase') return text.toLowerCase();
  if (transform === 'capitalize') {
    return capitalizeText(text, run.text ?? text, startOffset);
  }
  return text;
}

/**
 * Capitalizes a substring using the run's original full text to preserve
 * correct word-boundary detection for partial-token measurement.
 */
function capitalizeText(text: string, fullText: string, startOffset: number): string {
  let result = '';
  for (let index = 0; index < text.length; index++) {
    const absoluteIndex = startOffset + index;
    const currentChar = text[index];
    const previousChar = absoluteIndex > 0 ? fullText[absoluteIndex - 1] : '';
    result += isWordCharacter(currentChar) && !isWordCharacter(previousChar) ? currentChar.toUpperCase() : currentChar;
  }
  return result;
}

/**
 * Measures the rendered width of a field-annotation pill.
 */
function measureFieldAnnotationWidth(run: FieldAnnotationRun, fontContext: FontMeasureContext): number {
  const fontSize =
    typeof run.fontSize === 'number'
      ? run.fontSize
      : typeof run.fontSize === 'string'
        ? parseFloat(run.fontSize) || DEFAULT_FIELD_ANNOTATION_FONT_SIZE
        : DEFAULT_FIELD_ANNOTATION_FONT_SIZE;
  const fontFamily = normalizeFontFamily(run.fontFamily ?? 'Arial');
  const font = buildFontString(
    {
      fontFamily,
      fontSize,
      bold: run.bold,
      italic: run.italic,
    },
    fontContext,
  );
  const displayText = applyTextTransform(run.displayLabel || '', {
    text: run.displayLabel || '',
  });
  const context = getCanvasContext(fontContext);
  const textWidth = measureCachedTextWidth(displayText, font, 0, context);
  const horizontalPadding = run.highlighted === false ? 0 : FIELD_ANNOTATION_PILL_PADDING;
  return textWidth + horizontalPadding;
}

/**
 * Returns true when a run acts as an explicit authored line break.
 */
function isExplicitLineBreakRun(run: Run): boolean {
  return run.kind === 'lineBreak' || (run.kind === 'break' && run.breakType === 'line');
}

/**
 * Narrows to text-bearing runs that participate in token-based min-width measurement.
 */
function isTextLikeRun(run: Run): run is Extract<Run, { text: string }> {
  return 'text' in run && typeof run.text === 'string';
}

/**
 * Returns the run's effective letter spacing in pixels.
 */
function getLetterSpacing(run: Extract<Run, { text: string }>): number {
  return 'letterSpacing' in run && typeof run.letterSpacing === 'number' ? run.letterSpacing : 0;
}

/** Returns the run's effective OOXML character-width multiplier. */
function getHorizontalScale(run: Extract<Run, { text: string }>): number {
  if (!('horizontalScale' in run)) return 1;
  const value = run.horizontalScale;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 1;
}

/**
 * Normalizes font sizes coming from text and annotation runs.
 */
function normalizeFontSize(value: number | string | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 12;
}

/**
 * Normalizes font-family values for canvas measurement.
 */
function normalizeFontFamily(value: string | undefined): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : 'Arial';
}

/**
 * Stable serializer used for cache keys.
 */
function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`).join(',')}}`;
}

/**
 * Minimal word-character heuristic used for capitalization boundaries.
 */
function isWordCharacter(value: string): boolean {
  return /[A-Za-z0-9]/.test(value);
}
