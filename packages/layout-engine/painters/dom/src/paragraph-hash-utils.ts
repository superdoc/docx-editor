import type {
  ParagraphBorders,
  ParagraphBorder,
  TableBorders,
  TableBorderValue,
  CellBorders,
  BorderSpec,
} from '@superdoc/contracts';

/**
 * Hash helpers are duplicated from layout-bridge to avoid a circular dependency
 * (layout-bridge imports DOM_CLASS_NAMES from painter-dom). Keep these helpers
 * in sync with layout-bridge when formatting changes need cache invalidation.
 */

export const hashParagraphBorder = (border: ParagraphBorder): string => {
  const parts: string[] = [];
  if (border.style !== undefined) parts.push(`s:${border.style}`);
  if (border.width !== undefined) parts.push(`w:${border.width}`);
  if (border.color !== undefined) parts.push(`c:${border.color}`);
  if (border.space !== undefined) parts.push(`sp:${border.space}`);
  return parts.join(',');
};

export const hashParagraphBorders = (borders: ParagraphBorders): string => {
  const parts: string[] = [];
  if (borders.top) parts.push(`t:[${hashParagraphBorder(borders.top)}]`);
  if (borders.right) parts.push(`r:[${hashParagraphBorder(borders.right)}]`);
  if (borders.bottom) parts.push(`b:[${hashParagraphBorder(borders.bottom)}]`);
  if (borders.left) parts.push(`l:[${hashParagraphBorder(borders.left)}]`);
  if (borders.between) parts.push(`bw:[${hashParagraphBorder(borders.between)}]`);
  return parts.join(';');
};

const isNoneBorder = (value: TableBorderValue): value is { none: true } => {
  return typeof value === 'object' && value !== null && 'none' in value && (value as { none: true }).none === true;
};

const isBorderSpec = (value: unknown): value is BorderSpec => {
  return typeof value === 'object' && value !== null && !('none' in value);
};

export const hashBorderSpec = (border: BorderSpec): string => {
  const parts: string[] = [];
  if (border.style !== undefined) parts.push(`s:${border.style}`);
  if (border.width !== undefined) parts.push(`w:${border.width}`);
  if (border.color !== undefined) parts.push(`c:${border.color}`);
  if (border.space !== undefined) parts.push(`sp:${border.space}`);
  return parts.join(',');
};

export const hashTableBorderValue = (borderValue: TableBorderValue | undefined): string => {
  if (borderValue === undefined) return '';
  if (borderValue === null) return 'null';
  if (isNoneBorder(borderValue)) return 'none';
  if (isBorderSpec(borderValue)) {
    return hashBorderSpec(borderValue);
  }
  return '';
};

export const hashTableBorders = (borders: TableBorders | undefined): string => {
  if (!borders) return '';
  const parts: string[] = [];
  if (borders.top !== undefined) parts.push(`t:[${hashTableBorderValue(borders.top)}]`);
  if (borders.right !== undefined) parts.push(`r:[${hashTableBorderValue(borders.right)}]`);
  if (borders.bottom !== undefined) parts.push(`b:[${hashTableBorderValue(borders.bottom)}]`);
  if (borders.left !== undefined) parts.push(`l:[${hashTableBorderValue(borders.left)}]`);
  if (borders.insideH !== undefined) parts.push(`ih:[${hashTableBorderValue(borders.insideH)}]`);
  if (borders.insideV !== undefined) parts.push(`iv:[${hashTableBorderValue(borders.insideV)}]`);
  return parts.join(';');
};

export const hashCellBorders = (borders: CellBorders | undefined): string => {
  if (!borders) return '';
  const parts: string[] = [];
  if (borders.top) parts.push(`t:[${hashBorderSpec(borders.top)}]`);
  if (borders.right) parts.push(`r:[${hashBorderSpec(borders.right)}]`);
  if (borders.bottom) parts.push(`b:[${hashBorderSpec(borders.bottom)}]`);
  if (borders.left) parts.push(`l:[${hashBorderSpec(borders.left)}]`);
  if (borders.tl2br) parts.push(`d1:[${hashBorderSpec(borders.tl2br)}]`);
  if (borders.tr2bl) parts.push(`d2:[${hashBorderSpec(borders.tr2bl)}]`);
  return parts.join(';');
};

export {
  getRunBooleanProp,
  getRunNumberProp,
  getRunStringProp,
  getRunUnderlineColor,
  getRunUnderlineStyle,
  hasBooleanProp,
  hasNumberProp,
  hasStringProp,
} from './runs/hash.js';
