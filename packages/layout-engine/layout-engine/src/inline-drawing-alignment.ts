import type { FlowBlock, Measure, Page, ParaFragment } from '@superdoc/contracts';

/**
 * Word baseline-aligns an inline zero-height connector with the run that owns
 * it. Projection keeps vector drawings as sibling blocks, so the connector has
 * already reserved its authored flow height before the empty carrier paragraph
 * is laid out. Reposition only its paint fragment once that carrier's measured
 * baseline is known; later flow remains untouched.
 */
export function alignInlineZeroHeightDrawingFragments(
  pages: Page[],
  blocks: FlowBlock[],
  measures: Measure[],
  indices?: {
    blockById: ReadonlyMap<string, FlowBlock>;
    measureById: ReadonlyMap<string, Measure | undefined>;
  },
): void {
  const blockById = indices?.blockById ?? new Map(blocks.map((block) => [block.id, block]));
  const measureById = indices?.measureById ?? new Map(blocks.map((block, index) => [block.id, measures[index]]));

  for (const page of pages) {
    const paragraphFragments = new Map<string, ParaFragment>();
    for (const fragment of page.fragments) {
      if (fragment.kind === 'para' && !paragraphFragments.has(fragment.blockId)) {
        paragraphFragments.set(fragment.blockId, fragment);
      }
    }

    for (const fragment of page.fragments) {
      if (fragment.kind !== 'drawing') continue;
      const block = blockById.get(fragment.blockId);
      if (block?.kind !== 'drawing' || block.drawingKind !== 'vectorShape' || block.anchor?.isAnchored === true) {
        continue;
      }

      const attrs = block.attrs as Record<string, unknown> | undefined;
      const wrap = attrs?.wrap as { type?: unknown } | undefined;
      const sourceExtent = attrs?.sourceExtent as { height?: unknown } | undefined;
      const anchorParagraphId = attrs?.anchorParagraphId;
      if (wrap?.type !== 'Inline' || sourceExtent?.height !== 0 || typeof anchorParagraphId !== 'string') continue;

      const carrier = paragraphFragments.get(anchorParagraphId);
      const carrierMeasure = measureById.get(anchorParagraphId);
      if (!carrier || carrierMeasure?.kind !== 'paragraph') continue;

      const line = carrierMeasure.lines[carrier.fromLine];
      if (!line) continue;
      const halfLeading = Math.max(0, (line.lineHeight - line.ascent - line.descent) / 2);
      const baselineY = carrier.y + halfLeading + line.ascent;
      const effectTop = block.effectExtent?.top ?? 0;
      const effectBottom = block.effectExtent?.bottom ?? 0;
      const authoredContentHeight = Math.max(0, block.geometry.height - effectTop - effectBottom);
      const contentCenterY = effectTop + authoredContentHeight / 2;
      const scaleY = block.geometry.height > 0 ? fragment.height / block.geometry.height : 1;
      fragment.y = baselineY - contentCenterY * scaleY;
    }
  }
}
