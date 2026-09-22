import type {
  FlowBlock,
  ImageBlock,
  ImageMeasure,
  Measure,
  DrawingBlock,
  DrawingMeasure,
  TableBlock,
  TableMeasure,
} from '@superdoc/contracts';
import { isPageRelativeAnchor } from '@superdoc/contracts';
import {
  resolveFloatingTableAnchorResolution,
  resolveFloatingTableAnchorResolutionSteps,
} from './floating-table-anchor.js';
import { shouldSkipParagraphDuringLayout } from './paragraph-layout-eligibility.js';
import type { LayoutWorkCheckpoint } from './execution.js';

export type { FloatingTableAnchorResolution } from './floating-table-anchor.js';
export { resolveFloatingTableAnchorResolution };
export { isPageRelativeAnchor };

/**
 * Represents an anchored image or drawing block with its measurements.
 * Used to bundle block and measure data for anchor processing.
 */
export type AnchoredDrawing = {
  block: ImageBlock | DrawingBlock;
  measure: ImageMeasure | DrawingMeasure;
};

export type AnchoredDrawingCollection = {
  byParagraph: Map<number, AnchoredDrawing[]>;
  withoutParagraph: AnchoredDrawing[];
  readonly size: number;
  has(index: number): boolean;
  get(index: number): AnchoredDrawing[] | undefined;
};

export type AnchoredTable = {
  block: TableBlock;
  measure: TableMeasure;
  /** Raw w:tblpY offset from the resolved anchor paragraph. */
  layoutOffsetV?: number;
  /** True when raw w:tblpY is line-scoped on the anchor paragraph (Word centers tall form fields). */
  lineScopedOnAnchor?: boolean;
};

export type AnchoredObject = AnchoredDrawing | AnchoredTable;

export type AnchoredTableCollection = {
  byParagraph: Map<number, AnchoredTable[]>;
  withoutParagraph: AnchoredTable[];
};

function* buildParagraphIndexByIdSteps(
  blocks: FlowBlock[],
  len: number,
  checkpointEveryBlocks: number | null,
): Generator<LayoutWorkCheckpoint, Map<string, number>, void> {
  const paragraphIndexById = new Map<string, number>();

  for (let i = 0; i < len; i += 1) {
    if (checkpointEveryBlocks != null && i % checkpointEveryBlocks === 0) {
      yield { index: i, total: len };
    }
    const block = blocks[i];
    if (block.kind === 'paragraph') {
      paragraphIndexById.set(block.id, i);
    }
  }

  return paragraphIndexById;
}

function isAnchorableParagraph(blocks: FlowBlock[], index: number): boolean {
  return blocks[index]?.kind === 'paragraph' && !shouldSkipParagraphDuringLayout(blocks, index);
}

function* findNearestParagraphIndexSteps(
  blocks: FlowBlock[],
  len: number,
  fromIndex: number,
  checkpointEveryBlocks: number | null,
): Generator<LayoutWorkCheckpoint, number | null, void> {
  for (let i = fromIndex - 1; i >= 0; i -= 1) {
    if (checkpointEveryBlocks != null && i % checkpointEveryBlocks === 0) {
      yield { index: i, total: len };
    }
    if (isAnchorableParagraph(blocks, i)) return i;
  }

  for (let i = fromIndex + 1; i < len; i += 1) {
    if (checkpointEveryBlocks != null && i % checkpointEveryBlocks === 0) {
      yield { index: i, total: len };
    }
    if (isAnchorableParagraph(blocks, i)) return i;
  }

  return null;
}

function* findNextParagraphIndexSteps(
  blocks: FlowBlock[],
  len: number,
  fromIndex: number,
  checkpointEveryBlocks: number | null,
): Generator<LayoutWorkCheckpoint, number | null, void> {
  for (let i = fromIndex + 1; i < len; i += 1) {
    if (checkpointEveryBlocks != null && i % checkpointEveryBlocks === 0) {
      yield { index: i, total: len };
    }
    if (isAnchorableParagraph(blocks, i)) return i;
  }

  return null;
}

function* resolveAnchorParagraphIndexSteps(
  blocks: FlowBlock[],
  len: number,
  paragraphIndexById: Map<string, number>,
  fromIndex: number,
  anchorParagraphId: unknown,
  checkpointEveryBlocks: number | null,
): Generator<LayoutWorkCheckpoint, number | null, void> {
  if (typeof anchorParagraphId === 'string') {
    const explicitIndex = paragraphIndexById.get(anchorParagraphId);
    if (typeof explicitIndex === 'number') {
      const eligibleIndex = isAnchorableParagraph(blocks, explicitIndex)
        ? explicitIndex
        : yield* findNextParagraphIndexSteps(blocks, len, explicitIndex, checkpointEveryBlocks);
      if (eligibleIndex != null) return eligibleIndex;
    }
  }

  return yield* findNearestParagraphIndexSteps(blocks, len, fromIndex, checkpointEveryBlocks);
}

function drainAnchorSteps<T>(steps: Generator<LayoutWorkCheckpoint, T, void>): T {
  while (true) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

/**
 * Collect anchored images that should be pre-registered before the layout loop.
 * These are images with vRelativeFrom='margin' or 'page' that affect all paragraphs.
 *
 * @param blocks - Array of flow blocks to scan for anchored images
 * @param measures - Corresponding measures for each block
 * @returns Array of anchored drawings that should be pre-registered
 */
export function* collectPreRegisteredAnchorsSteps(
  blocks: FlowBlock[],
  measures: Measure[],
  checkpointEveryBlocks: number | null = null,
): Generator<LayoutWorkCheckpoint, AnchoredDrawing[], void> {
  const result: AnchoredDrawing[] = [];
  const len = Math.min(blocks.length, measures.length);

  for (let i = 0; i < len; i += 1) {
    if (checkpointEveryBlocks != null && i % checkpointEveryBlocks === 0) {
      yield { index: i, total: len };
    }
    const block = blocks[i];
    const measure = measures[i];
    const isImage = block.kind === 'image' && measure?.kind === 'image';
    const isDrawing = block.kind === 'drawing' && measure?.kind === 'drawing';
    if (!isImage && !isDrawing) continue;

    const drawingBlock = block as ImageBlock | DrawingBlock;
    const drawingMeasure = measure as ImageMeasure | DrawingMeasure;

    if (!drawingBlock.anchor?.isAnchored) {
      continue;
    }

    // Only pre-register page/margin-relative anchors
    if (isPageRelativeAnchor(drawingBlock)) {
      result.push({ block: drawingBlock, measure: drawingMeasure });
    }
  }

  return result;
}

export function collectPreRegisteredAnchors(blocks: FlowBlock[], measures: Measure[]): AnchoredDrawing[] {
  return drainAnchorSteps(collectPreRegisteredAnchorsSteps(blocks, measures));
}

/** Collect page- or margin-relative floating tables before paragraph layout. */
export function* collectPreRegisteredTablesSteps(
  blocks: FlowBlock[],
  measures: Measure[],
  checkpointEveryBlocks: number | null = null,
): Generator<LayoutWorkCheckpoint, AnchoredTable[], void> {
  const result: AnchoredTable[] = [];
  const len = Math.min(blocks.length, measures.length);

  for (let i = 0; i < len; i += 1) {
    if (checkpointEveryBlocks != null && i % checkpointEveryBlocks === 0) {
      yield { index: i, total: len };
    }
    const block = blocks[i];
    const measure = measures[i];
    if (block.kind !== 'table' || measure?.kind !== 'table') continue;

    const table = block as TableBlock;
    if (table.anchor?.isAnchored && isPageRelativeAnchor(table)) {
      result.push({ block: table, measure: measure as TableMeasure });
    }
  }

  return result;
}

/**
 * Collect anchored drawings (images/drawings) mapped to their anchor paragraph index.
 * Map of paragraph block index -> anchored images/drawings associated with that paragraph.
 */
export function* collectAnchoredDrawingsSteps(
  blocks: FlowBlock[],
  measures: Measure[],
  checkpointEveryBlocks: number | null = null,
): Generator<LayoutWorkCheckpoint, AnchoredDrawingCollection, void> {
  const byParagraph = new Map<number, AnchoredDrawing[]>();
  const withoutParagraph: AnchoredDrawing[] = [];
  const len = Math.min(blocks.length, measures.length);
  const paragraphIndexById = yield* buildParagraphIndexByIdSteps(blocks, len, checkpointEveryBlocks);

  for (let i = 0; i < len; i += 1) {
    if (checkpointEveryBlocks != null && i % checkpointEveryBlocks === 0) {
      yield { index: i, total: len };
    }
    const block = blocks[i];
    const measure = measures[i];
    const isImage = block.kind === 'image' && measure?.kind === 'image';
    const isDrawing = block.kind === 'drawing' && measure?.kind === 'drawing';
    if (!isImage && !isDrawing) continue;

    const drawingBlock = block as ImageBlock | DrawingBlock;
    const drawingMeasure = measure as ImageMeasure | DrawingMeasure;

    if (!drawingBlock.anchor?.isAnchored) {
      continue;
    }

    // Skip page/margin-relative anchors - they're handled by collectPreRegisteredAnchors
    if (isPageRelativeAnchor(drawingBlock)) {
      continue;
    }

    // Heuristic: anchor to nearest preceding paragraph, else nearest next paragraph
    const anchorParagraphId =
      typeof drawingBlock.attrs === 'object' && drawingBlock.attrs
        ? (drawingBlock.attrs as { anchorParagraphId?: unknown }).anchorParagraphId
        : undefined;
    const anchoredDrawing = { block: drawingBlock, measure: drawingMeasure };
    const anchorParaIndex = yield* resolveAnchorParagraphIndexSteps(
      blocks,
      len,
      paragraphIndexById,
      i,
      anchorParagraphId,
      checkpointEveryBlocks,
    );
    if (anchorParaIndex == null) {
      withoutParagraph.push(anchoredDrawing);
      continue;
    }

    const list = byParagraph.get(anchorParaIndex) ?? [];
    list.push(anchoredDrawing);
    byParagraph.set(anchorParaIndex, list);
  }

  return {
    byParagraph,
    withoutParagraph,
    get size() {
      return byParagraph.size;
    },
    has: (index: number) => byParagraph.has(index),
    get: (index: number) => byParagraph.get(index),
  };
}

export function collectAnchoredDrawings(blocks: FlowBlock[], measures: Measure[]): AnchoredDrawingCollection {
  return drainAnchorSteps(collectAnchoredDrawingsSteps(blocks, measures));
}

/**
 * Collect anchored/floating tables mapped to their anchor paragraph index.
 * Also returns anchored tables that have no paragraph to attach to.
 */
export function* collectAnchoredTablesSteps(
  blocks: FlowBlock[],
  measures: Measure[],
  checkpointEveryBlocks: number | null = null,
): Generator<LayoutWorkCheckpoint, AnchoredTableCollection, void> {
  const len = Math.min(blocks.length, measures.length);
  const byParagraph = new Map<number, AnchoredTable[]>();
  const withoutParagraph: AnchoredTable[] = [];
  const paragraphIndexById = yield* buildParagraphIndexByIdSteps(blocks, len, checkpointEveryBlocks);

  for (let i = 0; i < len; i += 1) {
    if (checkpointEveryBlocks != null && i % checkpointEveryBlocks === 0) {
      yield { index: i, total: len };
    }
    const block = blocks[i];
    const measure = measures[i];

    if (block.kind !== 'table' || measure?.kind !== 'table') continue;

    const tableBlock = block as TableBlock;
    const tableMeasure = measure as TableMeasure;

    // Check if the table is anchored/floating
    if (!tableBlock.anchor?.isAnchored) continue;

    const resolution = yield* resolveFloatingTableAnchorResolutionSteps(
      blocks,
      measures,
      len,
      i,
      tableBlock,
      paragraphIndexById,
      checkpointEveryBlocks,
    );
    if (resolution == null) {
      withoutParagraph.push({ block: tableBlock, measure: tableMeasure });
      continue;
    }

    const list = byParagraph.get(resolution.paragraphIndex) ?? [];
    list.push({
      block: tableBlock,
      measure: tableMeasure,
      layoutOffsetV: resolution.offsetV,
      lineScopedOnAnchor: resolution.lineScopedOnAnchor,
    });
    byParagraph.set(resolution.paragraphIndex, list);
  }

  return {
    byParagraph,
    withoutParagraph,
  };
}

export function collectAnchoredTables(blocks: FlowBlock[], measures: Measure[]): AnchoredTableCollection {
  return drainAnchorSteps(collectAnchoredTablesSteps(blocks, measures));
}
