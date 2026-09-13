import { getColumnGeometry, getColumnX } from './column-layout.js';
import type { BaseDirection } from './direction-context.js';

/** ECMA-376 Part 1 §20.4.3.4 (`ST_RelFromH`). */
export const ANCHOR_H_RELATIVE_VALUES = [
  'margin',
  'page',
  'column',
  'character',
  'leftMargin',
  'rightMargin',
  'insideMargin',
  'outsideMargin',
] as const;

/** ECMA-376 Part 1 §20.4.3.5 (`ST_RelFromV`). */
export const ANCHOR_V_RELATIVE_VALUES = [
  'margin',
  'page',
  'paragraph',
  'line',
  'topMargin',
  'bottomMargin',
  'insideMargin',
  'outsideMargin',
] as const;

/** ECMA-376 Part 1 §20.4.3.1 (`ST_AlignH`). */
export const ANCHOR_H_ALIGN_VALUES = ['left', 'right', 'center', 'inside', 'outside'] as const;

/** ECMA-376 Part 1 §20.4.3.2 (`ST_AlignV`). */
export const ANCHOR_V_ALIGN_VALUES = ['top', 'bottom', 'center', 'inside', 'outside'] as const;

export type AnchorHRelative = (typeof ANCHOR_H_RELATIVE_VALUES)[number];
export type AnchorVRelative = (typeof ANCHOR_V_RELATIVE_VALUES)[number];
export type AnchorAlignH = (typeof ANCHOR_H_ALIGN_VALUES)[number];
export type AnchorAlignV = (typeof ANCHOR_V_ALIGN_VALUES)[number];

function includesString<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

export function isAnchorHRelative(value: unknown): value is AnchorHRelative {
  return includesString(ANCHOR_H_RELATIVE_VALUES, value);
}

export function isAnchorVRelative(value: unknown): value is AnchorVRelative {
  return includesString(ANCHOR_V_RELATIVE_VALUES, value);
}

export function isAnchorAlignH(value: unknown): value is AnchorAlignH {
  return includesString(ANCHOR_H_ALIGN_VALUES, value);
}

export function isAnchorAlignV(value: unknown): value is AnchorAlignV {
  return includesString(ANCHOR_V_ALIGN_VALUES, value);
}

export function isPositionedParagraphFrame<T extends { wrap?: string }>(
  frame: T | undefined,
): frame is T & { wrap: 'around' | 'none' } {
  return frame?.wrap === 'around' || frame?.wrap === 'none';
}

export function isPagePositionedParagraphFrame(
  frame: { wrap?: string; vAnchor?: string; y?: number } | undefined,
): frame is { wrap: 'around' | 'none'; vAnchor: 'page'; y: number } {
  return (
    isPositionedParagraphFrame(frame) &&
    frame?.vAnchor === 'page' &&
    typeof frame.y === 'number' &&
    Number.isFinite(frame.y)
  );
}

export function isPagePositionedFloatingTable<
  T extends {
    kind?: string;
    anchor?: { isAnchored?: boolean; vRelativeFrom?: string };
  },
>(
  block: T | undefined,
): block is T & {
  kind: 'table';
  anchor: { isAnchored: true; vRelativeFrom: 'page' };
} {
  return block?.kind === 'table' && block.anchor?.isAnchored === true && block.anchor.vRelativeFrom === 'page';
}

/**
 * Resolve the page-space origin used for page-anchored paragraph frames in a footer.
 * Invalid or negative bottom margins behave like a zero margin.
 */
export function resolveFooterPageFrameOriginY(pageHeight: number, bottomMargin?: number): number {
  const resolvedBottomMargin =
    typeof bottomMargin === 'number' && Number.isFinite(bottomMargin) ? Math.max(0, bottomMargin) : 0;
  return Math.max(0, pageHeight - resolvedBottomMargin);
}

export type ColumnLayoutForAnchor = {
  width: number;
  gap: number;
  count: number;
  // Per-column widths/gaps from the resolved (normalized) columns. When present, column-relative
  // anchor x honors them via getColumnGeometry instead of a uniform columnIndex * (width + gap)
  // stride; equal columns reduce to the old stride. (SD-2629)
  widths?: number[];
  gaps?: number[];
  // Section page direction and the content width it was normalized against, both read by
  // getColumnGeometry. Declared rather than left to structural pass-through: a column-relative
  // anchor in an RTL section must resolve against the mirrored geometry, and silently dropping
  // these would place it against the wrong margin with no type error to catch it.
  direction?: BaseDirection;
  contentWidth?: number;
};

/**
 * Inputs for resolving the paint Y of an anchored image, drawing, or floating table.
 * `offsetV` is applied inside this function; callers must pass the resolved value to
 * text-wrap registration without adding `offsetV` again.
 */
export type ResolveAnchoredGraphicYInput = {
  anchor?: {
    simplePos?: { x: number; y: number };
    vRelativeFrom?: AnchorVRelative;
    alignV?: AnchorAlignV;
    offsetV?: number;
  };
  objectHeight: number;
  contentTop: number;
  contentBottom: number;
  /** Bottom page margin in px (used when vRelativeFrom is `page`). */
  pageBottomMargin?: number;
  /**
   * Anchor paragraph top Y (body cursor when laying out the anchor paragraph).
   * Used for `paragraph` and legacy (undefined vRelativeFrom) positioning.
   */
  anchorParagraphY?: number;
  /** Anchor line top Y. Falls back to the paragraph top when unavailable. */
  anchorLineY?: number;
  /** First line height of the anchor paragraph (paragraph-relative alignV). */
  firstLineHeight?: number;
  /** One-based physical page number, used by inside/outside placement. */
  pageNumber?: number;
  /**
   * When true, anchor has no host paragraph (pre-registered / paragraphless layout).
   * For `vRelativeFrom: 'paragraph'`, use `contentTop + offsetV` instead of alignV on a
   * synthetic paragraph (defaults would wrongly center/bottom against contentTop).
   */
  preRegisteredFallbackToContentTop?: boolean;
};

/**
 * Resolve the vertical paint position for an anchored graphic (image, drawing, or table).
 */
export function resolveAnchoredGraphicY(input: ResolveAnchoredGraphicYInput): number {
  const {
    anchor,
    objectHeight,
    contentTop,
    contentBottom,
    pageBottomMargin = 0,
    anchorParagraphY = contentTop,
    anchorLineY = anchorParagraphY,
    firstLineHeight = 0,
    pageNumber = 1,
    preRegisteredFallbackToContentTop = false,
  } = input;

  if (anchor?.simplePos != null) return anchor.simplePos.y;

  const offsetV = anchor?.offsetV ?? 0;
  const vRelativeFrom = anchor?.vRelativeFrom;
  const alignV = anchor?.alignV;
  if (preRegisteredFallbackToContentTop && (vRelativeFrom == null || vRelativeFrom === 'paragraph')) {
    return contentTop + offsetV;
  }

  if (vRelativeFrom == null) return anchorParagraphY + offsetV;

  const pageHeight = Math.max(contentBottom, contentBottom + Math.max(0, pageBottomMargin));
  const topMarginHeight = Math.max(0, contentTop);
  const bottomMarginHeight = Math.max(0, pageHeight - contentBottom);
  const isOddPage = Math.max(1, Math.trunc(pageNumber)) % 2 === 1;

  let regionStart: number;
  let regionSize: number;
  switch (vRelativeFrom) {
    case 'page':
      regionStart = 0;
      regionSize = pageHeight;
      break;
    case 'margin':
      regionStart = contentTop;
      regionSize = Math.max(0, contentBottom - contentTop);
      break;
    case 'paragraph':
      regionStart = anchorParagraphY;
      regionSize = Math.max(0, firstLineHeight);
      break;
    case 'line':
      regionStart = anchorLineY;
      regionSize = Math.max(0, firstLineHeight);
      break;
    case 'topMargin':
      regionStart = 0;
      regionSize = topMarginHeight;
      break;
    case 'bottomMargin':
      regionStart = contentBottom;
      regionSize = bottomMarginHeight;
      break;
    case 'insideMargin':
      regionStart = isOddPage ? 0 : contentBottom;
      regionSize = isOddPage ? topMarginHeight : bottomMarginHeight;
      break;
    case 'outsideMargin':
      regionStart = isOddPage ? contentBottom : 0;
      regionSize = isOddPage ? bottomMarginHeight : topMarginHeight;
      break;
  }

  if (alignV === 'bottom') return regionStart + regionSize - objectHeight + offsetV;
  if (alignV === 'center') return regionStart + (regionSize - objectHeight) / 2 + offsetV;
  if (alignV === 'inside') {
    return (isOddPage ? regionStart : regionStart + regionSize - objectHeight) + offsetV;
  }
  if (alignV === 'outside') {
    return (isOddPage ? regionStart + regionSize - objectHeight : regionStart) + offsetV;
  }
  return regionStart + offsetV;
}

export type ResolveAnchoredGraphicXContext = {
  /** One-based physical page number, used by inside/outside placement. */
  pageNumber?: number;
  /** Page-space X of the anchor character. Falls back to the column origin. */
  anchorCharacterX?: number;
};

/**
 * Resolve horizontal paint position for an anchored graphic.
 */
export function resolveAnchoredGraphicX(
  anchor: {
    simplePos?: { x: number; y: number };
    hRelativeFrom?: AnchorHRelative;
    alignH?: AnchorAlignH;
    offsetH?: number;
  },
  columnIndex: number,
  columns: ColumnLayoutForAnchor,
  objectWidth: number,
  margins?: { left?: number; right?: number },
  pageWidth?: number,
  context: ResolveAnchoredGraphicXContext = {},
): number {
  if (anchor.simplePos != null) return anchor.simplePos.x;

  const alignH = anchor.alignH ?? 'left';
  const offsetH = anchor.offsetH ?? 0;

  const marginLeft = Math.max(0, margins?.left ?? 0);
  const marginRight = Math.max(0, margins?.right ?? 0);
  const contentWidth = pageWidth != null ? Math.max(1, pageWidth - (marginLeft + marginRight)) : columns.width;

  const contentLeft = marginLeft;
  // Column ORIGIN from the resolved geometry so column-relative anchors honor per-column widths and
  // gaps (SD-2629) rather than a uniform columnIndex * (width + gap) stride. Equal columns reduce to
  // the old stride. Page/margin semantics are unchanged. (Available width stays scalar; see below.)
  const geometry = getColumnGeometry({ ...columns, contentWidth: columns.contentWidth ?? contentWidth });
  const columnX = getColumnX(geometry, columnIndex, contentLeft);
  const resolvedPageWidth = pageWidth != null ? pageWidth : contentWidth + marginLeft + marginRight;
  const isOddPage = Math.max(1, Math.trunc(context.pageNumber ?? 1)) % 2 === 1;

  const relativeFrom = anchor.hRelativeFrom ?? 'column';

  let baseX: number;
  let availableWidth: number;
  switch (relativeFrom) {
    case 'page':
      baseX = 0;
      availableWidth = resolvedPageWidth;
      break;
    case 'margin':
      baseX = contentLeft;
      availableWidth = contentWidth;
      break;
    case 'column':
      baseX = columnX;
      // Available width is the scalar (max) column width, matching anchored-object MEASUREMENT,
      // which clamps width to columns.width (layout-image / layout-drawing), not the per-column
      // width. The column origin itself still honors authored unequal columns. (SD-2629)
      availableWidth = columns.width;
      break;
    case 'character':
      baseX = context.anchorCharacterX ?? columnX;
      availableWidth = 0;
      break;
    case 'leftMargin':
      baseX = 0;
      availableWidth = marginLeft;
      break;
    case 'rightMargin':
      baseX = resolvedPageWidth - marginRight;
      availableWidth = marginRight;
      break;
    case 'insideMargin':
      baseX = isOddPage ? 0 : resolvedPageWidth - marginRight;
      availableWidth = isOddPage ? marginLeft : marginRight;
      break;
    case 'outsideMargin':
      baseX = isOddPage ? resolvedPageWidth - marginRight : 0;
      availableWidth = isOddPage ? marginRight : marginLeft;
      break;
  }

  if (alignH === 'left') {
    return baseX + offsetH;
  }
  if (alignH === 'right') {
    return baseX + availableWidth - objectWidth - offsetH;
  }
  if (alignH === 'center') {
    return baseX + (availableWidth - objectWidth) / 2 + offsetH;
  }
  if (alignH === 'inside') {
    return isOddPage ? baseX + offsetH : baseX + availableWidth - objectWidth - offsetH;
  }
  if (alignH === 'outside') {
    return isOddPage ? baseX + availableWidth - objectWidth - offsetH : baseX + offsetH;
  }
  return baseX + offsetH;
}
