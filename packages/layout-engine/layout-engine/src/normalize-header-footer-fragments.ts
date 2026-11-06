import type { FlowBlock, ImageBlock, DrawingBlock, TableBlock, Fragment, Measure } from '@superdoc/contracts';
import {
  isPagePositionedFloatingTable,
  isPagePositionedParagraphFrame,
  resolveAnchoredGraphicX,
  resolveAnchoredGraphicY,
  resolveFooterPageFrameOriginY,
} from '@superdoc/contracts';
/**
 * Subset of HeaderFooterConstraints needed for fragment normalization.
 * Defined locally to avoid circular imports with index.ts.
 */
export type RegionConstraints = {
  width?: number;
  pageWidth?: number;
  pageHeight?: number;
  margins?: {
    left: number;
    right: number;
    top?: number;
    bottom?: number;
    header?: number;
    footer?: number;
  };
};

// Word-authored header backgrounds can carry a small positive edge offset even
// when their extent is the full physical page. Word paints those shapes as a
// page cover. Keep this tolerance narrower than ordinary shape placement: the
// two known Word encodings are 1 pt and 1.2 pt (1.333 px and 1.6 px).
const PAGE_COVER_EDGE_TOLERANCE_PX = 2;
const PAGE_COVER_SIZE_TOLERANCE_PX = 0.5;

/**
 * Compute the physical-page Y coordinate for a page-relative anchored drawing,
 * using the real page geometry from constraints.
 *
 * The inner header/footer layout uses body content height as its "page height",
 * which gives wrong positions for page-relative anchors that use bottom/center
 * alignment. This function computes the CORRECT Y using the real page dimensions.
 */
function computePhysicalAnchorY(block: ImageBlock | DrawingBlock, fragmentHeight: number, pageHeight: number): number {
  const alignV = block.anchor?.alignV ?? 'top';
  const offsetV = block.anchor?.offsetV ?? 0;

  if (alignV === 'bottom') {
    return pageHeight - fragmentHeight + offsetV;
  }
  if (alignV === 'center') {
    return (pageHeight - fragmentHeight) / 2 + offsetV;
  }
  // 'top' or unrecognized
  return offsetV;
}

/**
 * Compute the footer band origin: the physical-page Y that corresponds to
 * footer-local y=0. This is the top of the bottom margin area.
 */
function computeFooterBandOrigin(constraints: RegionConstraints): number {
  const pageHeight = constraints.pageHeight ?? 0;
  const footerDistance = constraints.margins?.footer;
  if (typeof footerDistance === 'number' && Number.isFinite(footerDistance)) {
    return Math.max(0, pageHeight - Math.max(0, footerDistance));
  }
  return Math.max(0, pageHeight - (constraints.margins?.bottom ?? 0));
}

function isAnchoredFragment(fragment: Fragment): boolean {
  return (
    (fragment.kind === 'image' || fragment.kind === 'drawing') &&
    (fragment as { isAnchored?: boolean }).isAnchored === true
  );
}

function isPageRelativeBlock(block: FlowBlock): block is ImageBlock | DrawingBlock {
  return (block.kind === 'image' || block.kind === 'drawing') && block.anchor?.vRelativeFrom === 'page';
}

function isHeaderVmlWatermark(block: FlowBlock): block is ImageBlock {
  return block.kind === 'image' && block.attrs?.vmlWatermark === true && block.anchor?.isAnchored === true;
}

function normalizeHeaderVmlWatermarkFragment(
  fragment: Extract<Fragment, { kind: 'image' }>,
  block: ImageBlock,
  pageNumber: number,
  constraints: RegionConstraints,
): void {
  const pageWidth = constraints.pageWidth;
  const pageHeight = constraints.pageHeight;
  const width = block.width ?? fragment.width ?? 0;
  const height = block.height ?? fragment.height ?? 0;
  if (
    typeof pageWidth !== 'number' ||
    !Number.isFinite(pageWidth) ||
    typeof pageHeight !== 'number' ||
    !Number.isFinite(pageHeight)
  ) {
    return;
  }

  const physicalX = resolveAnchoredGraphicX(
    block.anchor!,
    0,
    { width: constraints.width ?? pageWidth, gap: 0, count: 1 },
    width,
    constraints.margins,
    pageWidth,
    { pageNumber },
  );
  fragment.x = block.anchor?.hRelativeFrom === 'page' ? physicalX : physicalX - (constraints.margins?.left ?? 0);
  const physicalY = resolveAnchoredGraphicY({
    anchor: block.anchor,
    objectHeight: height,
    contentTop: constraints.margins?.top ?? 0,
    contentBottom: pageHeight - (constraints.margins?.bottom ?? 0),
    pageBottomMargin: constraints.margins?.bottom ?? 0,
    pageNumber,
  });
  fragment.y = block.anchor?.vRelativeFrom === 'page' ? physicalY : physicalY - (constraints.margins?.header ?? 0);
}

function normalizeFloatingFooterTableFragment(
  fragment: Extract<Fragment, { kind: 'table' }>,
  block: TableBlock,
  pageNumber: number,
  constraints: RegionConstraints,
  bandOrigin: number,
): void {
  if (isPagePositionedFloatingTable(block)) {
    const pageHeight = constraints.pageHeight ?? 0;
    const physicalY = resolveAnchoredGraphicY({
      anchor: block.anchor as Parameters<typeof resolveAnchoredGraphicY>[0]['anchor'],
      objectHeight: fragment.height,
      contentTop: 0,
      contentBottom: pageHeight,
      pageBottomMargin: 0,
      pageNumber,
    });
    fragment.y = physicalY - bandOrigin;
  }

  const pageWidth = constraints.pageWidth;
  if (
    block.anchor?.hRelativeFrom !== 'page' ||
    typeof pageWidth !== 'number' ||
    !Number.isFinite(pageWidth) ||
    pageWidth <= 0
  ) {
    return;
  }
  fragment.x = resolveAnchoredGraphicX(
    block.anchor,
    0,
    { width: constraints.width ?? pageWidth, gap: 0, count: 1 },
    fragment.width,
    constraints.margins,
    pageWidth,
    { pageNumber },
  );
}

function isHeaderMarginContentBlock(block: FlowBlock): block is ImageBlock | DrawingBlock {
  if (block.kind !== 'image' && block.kind !== 'drawing') return false;
  if (block.anchor?.vRelativeFrom !== 'margin') return false;
  if (block.anchor.behindDoc === true && block.wrap?.type !== 'None') return false;
  return true;
}

function normalizePageCoveringHeaderOverlay(
  fragment: Fragment,
  block: FlowBlock,
  constraints: RegionConstraints,
): void {
  if (!isAnchoredFragment(fragment) || (block.kind !== 'image' && block.kind !== 'drawing')) return;
  if (block.anchor?.behindDoc !== true || block.wrap?.type !== 'None') return;

  const horizontalAnchor = block.anchor.hRelativeFrom;
  const verticalAnchor = block.anchor.vRelativeFrom;
  if (
    (horizontalAnchor !== 'page' && horizontalAnchor !== 'column') ||
    (verticalAnchor !== 'page' && verticalAnchor !== 'paragraph')
  ) {
    return;
  }

  const pageWidth = constraints.pageWidth;
  const pageHeight = constraints.pageHeight;
  const fragmentWidth = (fragment as { width?: number }).width;
  const fragmentHeight = (fragment as { height?: number }).height;
  if (
    typeof pageWidth !== 'number' ||
    !Number.isFinite(pageWidth) ||
    typeof pageHeight !== 'number' ||
    !Number.isFinite(pageHeight) ||
    typeof fragmentWidth !== 'number' ||
    !Number.isFinite(fragmentWidth) ||
    typeof fragmentHeight !== 'number' ||
    !Number.isFinite(fragmentHeight) ||
    Math.abs(fragmentWidth - pageWidth) > PAGE_COVER_SIZE_TOLERANCE_PX ||
    Math.abs(fragmentHeight - pageHeight) > PAGE_COVER_SIZE_TOLERANCE_PX
  ) {
    return;
  }

  const marginLeft = constraints.margins?.left ?? 0;
  const headerOffset = constraints.margins?.header ?? 0;
  const pageRelativeX = horizontalAnchor === 'page';
  const pageRelativeY = verticalAnchor === 'page';
  const physicalX = fragment.x + (pageRelativeX ? 0 : marginLeft);
  const physicalY = fragment.y + (pageRelativeY ? 0 : headerOffset);

  if (Math.abs(physicalX) <= PAGE_COVER_EDGE_TOLERANCE_PX) {
    fragment.x = pageRelativeX ? 0 : -marginLeft;
  }
  if (Math.abs(physicalY) <= PAGE_COVER_EDGE_TOLERANCE_PX) {
    fragment.y = pageRelativeY ? 0 : -headerOffset;
  }
}

/**
 * Post-normalize anchored fragment Y positions in header/footer layout.
 *
 * Problem: The inner `layoutDocument()` uses body content height as its page
 * height. For page-relative footer anchors and margin-relative header anchors,
 * this can produce incorrect Y positions because the real physical page/header
 * band geometry is different.
 *
 * Solution: After layout, rewrite affected anchored fragments into the region's
 * local coordinate system. Footer page-relative anchors use the real physical
 * page height and footer-band origin. Header page-relative anchors use their
 * physical page offset directly because header story coordinates are page-top
 * local. Header margin-relative content anchors reset to the header-local
 * offset so they do not inflate the reserved header height by carrying
 * body-canvas coordinates. No-wrap foreground overlays instead resolve against
 * the physical body margins, then subtract the header decoration origin.
 *
 * Page-anchored paragraph frames and floating footer tables are likewise
 * converted from physical-page coordinates; other paragraphs, inline images,
 * and absolute overlays pass through unchanged.
 */
export function normalizeFragmentsForRegion(
  pages: Array<{ number: number; fragments: Fragment[] }>,
  blocks: FlowBlock[],
  _measures: Measure[],
  kind: 'header' | 'footer',
  constraints: RegionConstraints,
): Array<{ number: number; fragments: Fragment[] }> {
  if (constraints.pageHeight == null || !constraints.margins) {
    return pages;
  }

  const pageHeight = constraints.pageHeight;
  const bandOrigin = computeFooterBandOrigin(constraints);

  const blockById = new Map<string, FlowBlock>();
  for (const block of blocks) {
    blockById.set(block.id, block);
  }

  for (const page of pages) {
    for (const fragment of page.fragments) {
      const block = blockById.get(fragment.blockId);
      if (!block) continue;

      const paragraphFrame = block.kind === 'paragraph' ? block.attrs?.frame : undefined;
      const horizontalAnchor = paragraphFrame?.hAnchor;
      const horizontalAlignment = paragraphFrame?.xAlign;
      if (fragment.kind === 'para' && isPagePositionedParagraphFrame(paragraphFrame)) {
        if (
          horizontalAnchor === 'page' &&
          horizontalAlignment &&
          typeof constraints.pageWidth === 'number' &&
          Number.isFinite(constraints.pageWidth) &&
          constraints.pageWidth > 0 &&
          typeof constraints.width === 'number' &&
          Number.isFinite(constraints.width) &&
          constraints.width > 0
        ) {
          const pageWidthDelta = constraints.pageWidth - constraints.width;
          if (horizontalAlignment === 'right') {
            fragment.x += pageWidthDelta;
          } else if (horizontalAlignment === 'center') {
            fragment.x += pageWidthDelta / 2;
          }
        }

        const physicalY = paragraphFrame.y;

        // Paragraph frames use the header/footer decoration container as their
        // local coordinate space. Footer decorations start at the top of the
        // bottom margin, unlike drawing anchors whose origin follows footerDistance.
        const regionOrigin =
          kind === 'footer' ? resolveFooterPageFrameOriginY(pageHeight, constraints.margins.bottom) : 0;
        fragment.y = physicalY - regionOrigin;
        continue;
      }

      if (
        kind === 'footer' &&
        fragment.kind === 'table' &&
        fragment.isAnchored === true &&
        block.kind === 'table' &&
        (isPagePositionedFloatingTable(block) || block.anchor?.hRelativeFrom === 'page')
      ) {
        normalizeFloatingFooterTableFragment(fragment, block, page.number, constraints, bandOrigin);
        continue;
      }

      if (!isAnchoredFragment(fragment)) continue;

      if (
        (block.kind === 'image' || block.kind === 'drawing') &&
        block.anchor?.hRelativeFrom === 'page' &&
        (!block.wrap || block.wrap.type === 'None' || block.wrap.type === 'Inline') &&
        typeof constraints.pageWidth === 'number' &&
        Number.isFinite(constraints.pageWidth) &&
        constraints.pageWidth > 0
      ) {
        fragment.x = resolveAnchoredGraphicX(
          block.anchor,
          0,
          { width: constraints.width ?? constraints.pageWidth, gap: 0, count: 1 },
          ('width' in fragment ? fragment.width : 0) ?? 0,
          constraints.margins,
          constraints.pageWidth,
          { pageNumber: page.number },
        );
      }

      if (kind === 'header' && fragment.kind === 'image' && isHeaderVmlWatermark(block)) {
        normalizeHeaderVmlWatermarkFragment(fragment, block, page.number, constraints);
        continue;
      }

      if (kind === 'header' && isHeaderMarginContentBlock(block)) {
        if (block.wrap?.type === 'None') {
          fragment.y =
            resolveAnchoredGraphicY({
              anchor: block.anchor,
              objectHeight: (fragment as { height?: number }).height ?? 0,
              contentTop: constraints.margins.top ?? 0,
              contentBottom: pageHeight - (constraints.margins.bottom ?? 0),
              pageBottomMargin: constraints.margins.bottom ?? 0,
              pageNumber: page.number,
            }) - (constraints.margins.header ?? 0);
        } else {
          fragment.y = block.anchor?.offsetV ?? 0;
        }
        continue;
      }

      if (!isPageRelativeBlock(block)) {
        if (kind === 'header') normalizePageCoveringHeaderOverlay(fragment, block, constraints);
        continue;
      }

      const fragmentHeight = (fragment as { height?: number }).height ?? 0;
      const physicalY = computePhysicalAnchorY(block, fragmentHeight, pageHeight);
      fragment.y = kind === 'header' ? physicalY : physicalY - bandOrigin;
      if (kind === 'header') normalizePageCoveringHeaderOverlay(fragment, block, constraints);
    }
  }

  return pages;
}
