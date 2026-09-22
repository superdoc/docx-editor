import type {
  DrawingBlock,
  DrawingMeasure,
  FlowBlock,
  ListBlock,
  ListMeasure,
  Measure,
  ParagraphBlock,
  ParagraphMeasure,
  TableBlock,
  TableMeasure,
} from '@superdoc/contracts';
import type { FontMeasureContext } from '@superdoc/font-system';
import { serializeMeasurementInput } from './measurement-input-key.js';

const TABLE_CELL_BLOCK_MEASURE_CACHE_SIZE = 5_000;

type CellBlockMeasurer = (
  block: FlowBlock,
  constraints: { maxWidth: number; maxHeight: number },
  blockIndex: number,
) => Promise<Measure>;

export type TableCellBlockMeasureCacheOutcome = 'exact-hit' | 'adopted-hit' | 'retained-hit' | 'miss';

class LruCache<T> {
  private readonly entries = new Map<string, T>();

  get(key: string): T | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > TABLE_CELL_BLOCK_MEASURE_CACHE_SIZE) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

const exactBlockMeasureCache = new LruCache<Measure>();
const latestBlockMeasureByContent = new LruCache<{ width: number; measure: Measure }>();

/** Drop cached cell-block measures after a font/runtime measurement change. */
export function clearTableCellBlockMeasureCache(): void {
  exactBlockMeasureCache.clear();
  latestBlockMeasureByContent.clear();
}

/**
 * Measure one cell's nested block sequence through a bounded content cache.
 * The key is the same geometry contract as top-level measurement: authored
 * content, exact width, font mapping, and measurement runtime configuration.
 */
export async function measureTableCellBlocks(
  blocks: readonly FlowBlock[],
  contentWidth: number,
  fontContext: FontMeasureContext,
  measurementRuntimeSignature: string,
  measureBlock: CellBlockMeasurer,
  observeCacheOutcome?: (outcome: TableCellBlockMeasureCacheOutcome) => void,
  identityNeutralCache = false,
  retainedParagraphMeasure?: (block: FlowBlock, blockIndex: number) => ParagraphMeasure | undefined,
): Promise<Measure[]> {
  const measured: Measure[] = [];
  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
    const block = blocks[blockIndex]!;
    const retained = retainedParagraphMeasure?.(block, blockIndex);
    if (retained) {
      observeCacheOutcome?.('retained-hit');
      measured.push(retained);
      continue;
    }
    const contentKey = serializeMeasurementInput(
      {
        block,
        fontSignature: fontContext.fontSignature ?? '',
        measurementRuntimeSignature,
      },
      { omitObjectIds: identityNeutralCache && block.kind === 'paragraph' },
    );
    const exactKey = `${contentWidth}@${contentKey}`;
    const exact = exactBlockMeasureCache.get(exactKey);
    if (exact) {
      observeCacheOutcome?.('exact-hit');
      hydrateTabRunWidthsFromMeasure(block, exact);
      latestBlockMeasureByContent.set(contentKey, { width: contentWidth, measure: exact });
      measured.push(exact);
      continue;
    }

    const latest = latestBlockMeasureByContent.get(contentKey);
    const adopted = latest ? adoptMeasureAtWidth(block, latest.measure, latest.width, contentWidth) : null;
    if (adopted) {
      observeCacheOutcome?.('adopted-hit');
      hydrateTabRunWidthsFromMeasure(block, adopted);
      exactBlockMeasureCache.set(exactKey, adopted);
      latestBlockMeasureByContent.set(contentKey, { width: contentWidth, measure: adopted });
      measured.push(adopted);
      continue;
    }

    observeCacheOutcome?.('miss');
    const next = await measureBlock(block, { maxWidth: contentWidth, maxHeight: Infinity }, blockIndex);
    exactBlockMeasureCache.set(exactKey, next);
    latestBlockMeasureByContent.set(contentKey, { width: contentWidth, measure: next });
    measured.push(next);
  }
  return measured;
}

/**
 * Reuse a width-sensitive measure only when the existing line partition is
 * provably unchanged. Narrowing is safe when every current line still fits;
 * widening is safe for a single line because there is no following line to
 * merge. The returned copy updates the available-width fields consumed by
 * resolve/painter alignment while retaining identical content geometry.
 */
function adoptMeasureAtWidth(
  block: FlowBlock,
  measure: Measure,
  previousWidth: number,
  nextWidth: number,
): Measure | null {
  if (previousWidth === nextWidth) return measure;
  if (!Number.isFinite(previousWidth) || !Number.isFinite(nextWidth) || nextWidth <= 0) return null;

  if (block.kind === 'sectionBreak' || block.kind === 'pageBreak' || block.kind === 'columnBreak') return measure;
  if (block.kind !== 'paragraph' || measure.kind !== 'paragraph') return null;

  const alignment = block.attrs?.alignment;
  if (alignment && alignment !== 'left') return null;
  if (block.attrs?.frame || block.attrs?.dropCap || measure.dropCap) return null;
  if (
    (block.attrs?.tabs?.length ?? 0) > 0 ||
    block.runs.some((run) => run.kind === 'tab' || ('text' in run && run.text?.includes('\t')))
  )
    return null;

  const widthDelta = nextWidth - previousWidth;
  if (widthDelta > 0 && measure.lines.length > 1) return null;
  const nextLineMaxWidths = measure.lines.map((line) =>
    typeof line.maxWidth === 'number' ? line.maxWidth + widthDelta : Number.NaN,
  );
  if (nextLineMaxWidths.some((lineWidth) => !Number.isFinite(lineWidth) || lineWidth <= 0)) return null;
  if (widthDelta < 0 && measure.lines.some((line, index) => line.width > nextLineMaxWidths[index]! + 0.001))
    return null;

  return {
    ...measure,
    measuredAtMaxWidth: nextWidth,
    lines: measure.lines.map((line, index) => ({
      ...line,
      maxWidth: nextLineMaxWidths[index]!,
    })),
  };
}

/** Reapply the only authored-block side effect produced by measurement. */
function hydrateTabRunWidthsFromMeasure(block: FlowBlock, measure: Measure): void {
  if (block.kind === 'paragraph' && measure.kind === 'paragraph') {
    hydrateParagraphTabRunWidths(block, measure);
    return;
  }
  if (block.kind === 'table' && measure.kind === 'table') {
    hydrateTableTabRunWidths(block, measure);
    return;
  }
  if (block.kind === 'list' && measure.kind === 'list') {
    hydrateListTabRunWidths(block, measure);
    return;
  }
  if (block.kind === 'drawing' && measure.kind === 'drawing') {
    hydrateDrawingTabRunWidths(block, measure);
  }
}

function hydrateParagraphTabRunWidths(block: ParagraphBlock, measure: ParagraphMeasure): void {
  for (const line of measure.lines ?? []) {
    const tabWidths = line.tabWidths;
    if (!tabWidths) continue;
    for (const key of Object.keys(tabWidths)) {
      const runIndex = Number(key);
      const run = block.runs[runIndex];
      if (run?.kind === 'tab') run.width = tabWidths[runIndex]!;
    }
  }
}

function hydrateTableTabRunWidths(block: TableBlock, measure: TableMeasure): void {
  for (let rowIndex = 0; rowIndex < block.rows.length; rowIndex += 1) {
    const blockCells = block.rows[rowIndex]?.cells ?? [];
    const measureCells = measure.rows[rowIndex]?.cells ?? [];
    for (let cellIndex = 0; cellIndex < blockCells.length; cellIndex += 1) {
      const blockCell = blockCells[cellIndex];
      const measureCell = measureCells[cellIndex];
      if (!blockCell || !measureCell) continue;
      const nestedBlocks = blockCell.blocks ?? (blockCell.paragraph ? [blockCell.paragraph] : []);
      const nestedMeasures = measureCell.blocks ?? (measureCell.paragraph ? [measureCell.paragraph] : []);
      for (let blockIndex = 0; blockIndex < nestedBlocks.length; blockIndex += 1) {
        const nestedMeasure = nestedMeasures[blockIndex];
        if (nestedMeasure) hydrateTabRunWidthsFromMeasure(nestedBlocks[blockIndex]!, nestedMeasure);
      }
    }
  }
}

function hydrateListTabRunWidths(block: ListBlock, measure: ListMeasure): void {
  for (let index = 0; index < block.items.length; index += 1) {
    const paragraphMeasure = measure.items[index]?.paragraph;
    if (paragraphMeasure) hydrateParagraphTabRunWidths(block.items[index]!.paragraph, paragraphMeasure);
  }
}

function hydrateDrawingTabRunWidths(block: DrawingBlock, measure: DrawingMeasure): void {
  const contentMeasures = measure.contentMeasures;
  if (block.drawingKind !== 'textboxShape' || !contentMeasures) return;
  for (let index = 0; index < block.contentBlocks.length; index += 1) {
    const contentBlock = block.contentBlocks[index];
    const contentMeasure = contentMeasures[index];
    if (contentBlock?.kind === 'paragraph' && contentMeasure?.kind === 'paragraph') {
      hydrateParagraphTabRunWidths(contentBlock, contentMeasure);
    }
  }
}
