import type { DrawingBlock, DrawingMeasure, DrawingFragment, TextboxContentMeasure } from '@superdoc/contracts';
import type { NormalizedColumns } from './layout-image.js';
import { breakParagraphAdjacency, type PageState } from './paginator.js';
import { extractBlockPmRange } from './layout-utils.js';
import { getFragmentZIndex } from '@superdoc/contracts';

/**
 * Context for laying out a drawing block (vector shape) within the page layout.
 *
 * Drawings are vector-based graphical objects (shapes, diagrams, etc.) that can be
 * positioned inline or anchored. This context provides all necessary information and
 * callbacks for positioning the drawing fragment on the current page/column.
 */
export type DrawingLayoutContext = {
  /** The drawing block to layout */
  block: DrawingBlock;
  /** Measured dimensions and geometry data for the drawing */
  measure: DrawingMeasure;
  /** Normalized column configuration (width, gap, count) for the current layout */
  columns: NormalizedColumns;
  /** Ensures a page exists and returns the current page state */
  ensurePage: () => PageState;
  /** Advances to the next column or page, returning the new page state */
  advanceColumn: (state: PageState) => PageState;
  /** Computes the X coordinate for a column in the given page state (SD-2629). */
  columnX: (state: PageState, columnIndex?: number) => number;
  /** Optional canonical textbox block measurements carried alongside textbox drawings. */
  textboxContentMeasures?: TextboxContentMeasure[];
};

/**
 * Layout a drawing block (vector shape) within the document flow.
 *
 * This function handles inline/block-level vector shapes (rectangles, circles, etc.),
 * positioning them on the page with proper scaling and margin handling. Anchored
 * drawings (positioned objects) are skipped and handled separately via the anchoring
 * system.
 *
 * Algorithm:
 * 1. Skip anchored drawings (handled by anchor system)
 * 2. Apply margins and scale drawing to fit within column width
 * 3. Scale down if drawing exceeds page content height
 * 4. Advance column/page if drawing doesn't fit at current cursor position
 * 5. Create DrawingFragment with final position and dimensions
 * 6. Push fragment to page and advance cursor
 *
 * @param context - Layout context containing block, measure, and layout callbacks
 *
 * @remarks
 * **Side Effects:**
 * - Mutates page state via `ensurePage()` and `advanceColumn()`
 * - Pushes DrawingFragment to `state.page.fragments`
 * - Advances `state.cursorY` by the drawing's total height (including margins)
 *
 * **Scaling Behavior:**
 * - Width is constrained to fit within column width (minus margins)
 * - Height is constrained to fit within page content height
 * - Aspect ratio is preserved during scaling
 *
 * **Anchored Drawings:**
 * - Anchored drawings (`block.anchor?.isAnchored === true`) are skipped
 * - They are positioned via the paragraph anchoring pre-pass
 */
export function layoutDrawingBlock({
  block,
  measure,
  columns,
  ensurePage,
  advanceColumn,
  columnX,
  textboxContentMeasures,
}: DrawingLayoutContext): void {
  if (block.anchor?.isAnchored) {
    return;
  }

  const marginTop = Math.max(0, block.margin?.top ?? 0);
  const marginBottom = Math.max(0, block.margin?.bottom ?? 0);
  const marginLeft = Math.max(0, block.margin?.left ?? 0);
  const marginRight = Math.max(0, block.margin?.right ?? 0);

  const maxWidth = Math.max(0, columns.width - (marginLeft + marginRight));
  let width = measure.width;
  let height = measure.height;

  const attrs = block.attrs as Record<string, unknown> | undefined;
  const indentLeft = typeof attrs?.hrIndentLeft === 'number' ? attrs.hrIndentLeft : 0;
  const indentRight = typeof attrs?.hrIndentRight === 'number' ? attrs.hrIndentRight : 0;
  const maxWidthForBlock =
    attrs?.isFullWidth === true && maxWidth > 0 ? Math.max(1, maxWidth - indentLeft - indentRight) : maxWidth;
  const rawWrap = attrs?.wrap as { type?: unknown } | undefined;
  const isInlineShapeGroup = block.drawingKind === 'shapeGroup' && rawWrap?.type === 'Inline';
  const sourceExtent = attrs?.sourceExtent as { width?: unknown; height?: unknown } | undefined;
  const isInlineZeroHeightDrawing =
    block.drawingKind === 'vectorShape' &&
    rawWrap?.type === 'Inline' &&
    sourceExtent?.height === 0 &&
    typeof sourceExtent.width === 'number' &&
    Number.isFinite(sourceExtent.width);
  const isParagraphAlignedDrawing = isInlineShapeGroup || isInlineZeroHeightDrawing;
  const inlineParagraphAlignment =
    attrs?.inlineParagraphAlignment === 'center' || attrs?.inlineParagraphAlignment === 'right'
      ? attrs.inlineParagraphAlignment
      : undefined;
  const paragraphIndentLeft =
    isParagraphAlignedDrawing && typeof attrs?.paragraphIndentLeft === 'number' ? attrs.paragraphIndentLeft : 0;
  const paragraphIndentRight =
    isParagraphAlignedDrawing && typeof attrs?.paragraphIndentRight === 'number' ? attrs.paragraphIndentRight : 0;
  const availableWidth = isParagraphAlignedDrawing
    ? Math.max(0, maxWidthForBlock - paragraphIndentLeft - paragraphIndentRight)
    : maxWidthForBlock;
  const authoredFitWidth = isInlineZeroHeightDrawing ? (sourceExtent.width as number) : width;

  if (authoredFitWidth > availableWidth && availableWidth > 0) {
    const scale = availableWidth / authoredFitWidth;
    width *= scale;
    height *= scale;
  }

  let state = ensurePage();
  const pageContentHeight = Math.max(0, state.contentBottom - state.topMargin);
  if (height > pageContentHeight && pageContentHeight > 0) {
    const scale = pageContentHeight / height;
    height = pageContentHeight;
    width *= scale;
  }

  const requiredHeight = marginTop + height + marginBottom;

  if (requiredHeight > 0) {
    breakParagraphAdjacency(state);
  }

  if (state.cursorY + requiredHeight > state.contentBottom && state.cursorY > state.topMargin) {
    state = advanceColumn(state);
  }

  const pmRange = extractBlockPmRange(block);
  let x = columnX(state) + marginLeft + indentLeft;
  if (isParagraphAlignedDrawing) {
    const layoutScale = measure.width > 0 ? width / measure.width : 1;
    const alignedWidth = isInlineZeroHeightDrawing ? (sourceExtent.width as number) * layoutScale : width;
    const extra = Math.max(0, availableWidth - alignedWidth);
    x +=
      paragraphIndentLeft +
      (inlineParagraphAlignment === 'center' ? extra / 2 : inlineParagraphAlignment === 'right' ? extra : 0);
    if (isInlineZeroHeightDrawing) {
      x -= (block.drawingKind === 'vectorShape' ? (block.effectExtent?.left ?? 0) : 0) * layoutScale;
    }
  }

  const fragment: DrawingFragment = {
    kind: 'drawing',
    blockId: block.id,
    drawingKind: block.drawingKind,
    x,
    y: state.cursorY + marginTop,
    width,
    height,
    geometry: measure.geometry,
    scale: measure.scale,
    drawingContentId: block.drawingContentId,
    zIndex: getFragmentZIndex(block),
    pmStart: pmRange.pmStart,
    pmEnd: pmRange.pmEnd,
    sourceAnchor: block.sourceAnchor,
  };

  if (textboxContentMeasures) {
    fragment.contentMeasures = textboxContentMeasures;
    const textboxId = block.attrs?.textboxId;
    if (typeof textboxId === 'string' && textboxId.length > 0) fragment.textboxId = textboxId;
  }
  // SD-5244: carry per-child editable-textbox measurements from the
  // shape-group measure onto its painted fragment, mirroring the
  // `contentMeasures` wiring above.
  if (block.drawingKind === 'shapeGroup' && measure.groupChildContentMeasures) {
    fragment.groupChildContentMeasures = measure.groupChildContentMeasures;
  }

  state.page.fragments.push(fragment);
  state.cursorY += requiredHeight;
  state.maxCursorY = Math.max(state.maxCursorY, state.cursorY);
}
