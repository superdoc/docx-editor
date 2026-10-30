import type {
  DrawingBlock,
  DrawingFragment,
  DrawingMeasure,
  FlowBlock,
  Layout,
  Measure,
  ParagraphBlock,
  ParagraphMeasure,
} from '@superdoc/contracts';
import { getFragmentZIndex, sliceRunsForLine, usesPositionedTextGeometry } from '@superdoc/contracts';
import { collectSegmentGeometry } from './neutral-segment-geometry.js';

export function placeInlineDrawings(
  layout: Layout,
  blocks: FlowBlock[],
  measures: Measure[],
  blockIndexById?: ReadonlyMap<string, number>,
  retainedPages?: {
    prefixEndPageIndex?: number;
    tail?: {
      startPageIndex: number;
      endPageIndexExclusive: number;
      blockIdRewrites?: ReadonlyMap<string, string> | null;
    };
  },
): Layout {
  if (!measures.some((measure) => measure?.kind === 'drawing' && measure.inlineDrawing === true)) return layout;
  const drawings = new Map<string, { block: DrawingBlock; measure: DrawingMeasure }>();
  const retainedDrawingIndexes = new Set<number>();
  const retainedPageIndexes = new Set<number>();
  if (blockIndexById && retainedPages) {
    for (let pageIndex = 0; pageIndex < layout.pages.length; pageIndex++) {
      const inTail =
        retainedPages.tail != null &&
        pageIndex >= retainedPages.tail.startPageIndex &&
        pageIndex < retainedPages.tail.endPageIndexExclusive;
      if (pageIndex >= (retainedPages.prefixEndPageIndex ?? 0) && !inTail) continue;
      retainedPageIndexes.add(pageIndex);
      for (const fragment of layout.pages[pageIndex].fragments) {
        if (fragment.kind !== 'drawing') continue;
        const index = blockIndexById.get(fragment.blockId);
        if (index != null) retainedDrawingIndexes.add(index);
      }
    }
  }
  for (let index = 0; index < measures.length; index++) {
    const measure = measures[index];
    if (measure?.kind !== 'drawing' || measure.inlineDrawing !== true) continue;
    if (retainedDrawingIndexes.has(index)) continue;
    const block = blocks[index];
    if (block.kind === 'drawing' && measure?.kind === 'drawing' && block.attrs?.inlineParagraphRunIndex != null) {
      drawings.set(block.id, { block, measure });
    }
  }
  if (drawings.size === 0) return layout;
  const paragraphs = new Map<string, ParagraphBlock>();
  const measureById = new Map<string, ParagraphMeasure>();
  const scannedIndexes = new Map<string, number>();
  let scanCursor = 0;
  const ownerIndex = (id: string): number | undefined => {
    if (blockIndexById) return blockIndexById.get(id);
    const indexed = scannedIndexes.get(id);
    if (indexed != null) return indexed;
    while (scanCursor < blocks.length) {
      const index = scanCursor++;
      const block = blocks[index];
      scannedIndexes.set(block.id, index);
      if (block.id === id) return index;
    }
    return undefined;
  };
  for (const { block } of drawings.values()) {
    const id = block.attrs?.anchorParagraphId;
    if (typeof id !== 'string' || paragraphs.has(id)) continue;
    const index = ownerIndex(id);
    const paragraph = index == null ? null : blocks[index];
    const measure = index == null ? null : measures[index];
    if (paragraph?.kind !== 'paragraph' || paragraph.id !== id || measure?.kind !== 'paragraph') continue;
    paragraphs.set(id, paragraph);
    measureById.set(id, measure);
  }
  const geometryInput = {
    ...layout,
    pages: layout.pages.map((page, pageIndex) => ({
      ...page,
      fragments: retainedPageIndexes.has(pageIndex)
        ? []
        : page.fragments.filter((fragment) => fragment.kind === 'para' && paragraphs.has(fragment.blockId)),
    })),
  };
  const geometry = collectSegmentGeometry(geometryInput, [...paragraphs.values()], [...measureById.values()], {
    pageTopAt: () => 0,
  });
  const placements = new Map<number, DrawingFragment[]>();
  for (const fragment of geometry.fragments) {
    const paragraph = paragraphs.get(fragment.blockRef);
    if (!paragraph || fragment.lines.length === 0) continue;
    for (const line of fragment.lines) {
      for (const segment of line.segments) {
        const run = paragraph.runs[segment.runIndex];
        if (run?.kind !== 'image' || !run.inlineDrawingId) continue;
        const drawing = drawings.get(run.inlineDrawingId);
        if (!drawing) throw new Error(`Missing inline drawing ${run.inlineDrawingId}`);
        const { block, measure } = drawing;
        const paragraphMeasure = measureById.get(paragraph.id);
        const sourceFragment = layout.pages[fragment.pageIndex].fragments.find(
          (candidate) =>
            candidate.kind === 'para' &&
            candidate.blockId === paragraph.id &&
            line.lineIndex >= candidate.fromLine &&
            line.lineIndex < candidate.toLine,
        );
        const sourceLine =
          sourceFragment?.kind === 'para' && sourceFragment.lines
            ? sourceFragment.lines[line.lineIndex - sourceFragment.fromLine]
            : paragraphMeasure?.kind === 'paragraph'
              ? paragraphMeasure.lines[line.lineIndex]
              : undefined;
        const verticalAlign =
          run.verticalAlign ??
          sourceLine?.inlineImageAlignments?.find((alignment) => alignment.runIndex === segment.runIndex)
            ?.verticalAlign ??
          'top';
        const positioned = sourceLine
          ? usesPositionedTextGeometry(sourceLine, sliceRunsForLine(paragraph, sourceLine), line.direction === 'rtl')
          : false;
        const top =
          verticalAlign === 'baseline'
            ? positioned
              ? Math.max(line.top, line.baseline - run.height)
              : line.baseline - run.height
            : verticalAlign === 'bottom'
              ? line.top + line.lineHeight - run.height - (run.distBottom ?? 0)
              : line.top + (run.distTop ?? 0);
        const placed: DrawingFragment = {
          kind: 'drawing',
          blockId: block.id,
          drawingKind: block.drawingKind,
          x: segment.x + (run.distLeft ?? 0),
          y: top,
          width: measure.width,
          height: measure.height,
          geometry: measure.geometry,
          scale: measure.scale,
          zIndex: getFragmentZIndex(block),
          drawingContentId: block.drawingContentId,
          sourceAnchor: block.sourceAnchor,
          pmStart: run.pmStart,
          pmEnd: run.pmEnd,
        };
        if (measure.contentMeasures) placed.contentMeasures = measure.contentMeasures;
        const textboxId = block.attrs?.textboxId;
        if (typeof textboxId === 'string' && textboxId) placed.textboxId = textboxId;
        const page = placements.get(fragment.pageIndex) ?? [];
        page.push(placed);
        placements.set(fragment.pageIndex, page);
      }
    }
  }
  return {
    ...layout,
    pages: layout.pages.map((page, pageIndex) => {
      const added = placements.get(pageIndex) ?? [];
      const retained = page.fragments.filter(
        (fragment) => fragment.kind !== 'drawing' || !drawings.has(fragment.blockId),
      );
      return added.length || retained.length !== page.fragments.length
        ? { ...page, fragments: [...retained, ...added] }
        : page;
    }),
  };
}
