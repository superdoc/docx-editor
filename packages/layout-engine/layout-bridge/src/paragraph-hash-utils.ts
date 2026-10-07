import {
  getParagraphInlineDirection,
  type ParagraphAttrs,
  type ParagraphBorders,
  type ParagraphBorder,
  type Run,
  type TableBorders,
  type TableBorderValue,
  type CellBorders,
  type BorderSpec,
} from '@superdoc/contracts';

/**
 * Creates a deterministic hash string for a paragraph border.
 * Ensures consistent ordering regardless of JS engine property enumeration.
 *
 * @param border - The paragraph border to hash
 * @returns A deterministic hash string
 */
export const hashParagraphBorder = (border: ParagraphBorder): string => {
  const parts: string[] = [];
  if (border.style !== undefined) parts.push(`s:${border.style}`);
  if (border.width !== undefined) parts.push(`w:${border.width}`);
  if (border.color !== undefined) parts.push(`c:${border.color}`);
  if (border.space !== undefined) parts.push(`sp:${border.space}`);
  return parts.join(',');
};

/**
 * Creates a deterministic hash string for paragraph borders.
 * Hashes all four sides (top, right, bottom, left) in a consistent order.
 *
 * @param borders - The paragraph borders to hash
 * @returns A deterministic hash string
 */
export const hashParagraphBorders = (borders: ParagraphBorders): string => {
  const parts: string[] = [];
  if (borders.top) parts.push(`t:[${hashParagraphBorder(borders.top)}]`);
  if (borders.right) parts.push(`r:[${hashParagraphBorder(borders.right)}]`);
  if (borders.bottom) parts.push(`b:[${hashParagraphBorder(borders.bottom)}]`);
  if (borders.left) parts.push(`l:[${hashParagraphBorder(borders.left)}]`);
  if (borders.between) parts.push(`bw:[${hashParagraphBorder(borders.between)}]`);
  return parts.join(';');
};

/**
 * Type guard for TableBorderValue 'none' variant.
 * Checks if a value is the explicit "no border" variant { none: true }.
 *
 * @param value - The table border value to check
 * @returns True if the value is { none: true }
 */
function isNoneBorder(value: TableBorderValue): value is { none: true } {
  return typeof value === 'object' && value !== null && 'none' in value && (value as { none: true }).none === true;
}

/**
 * Type guard for BorderSpec.
 * Checks if a value is a BorderSpec object (style, width, color, space properties).
 *
 * @param value - The value to check
 * @returns True if the value is a BorderSpec
 */
function isBorderSpec(value: unknown): value is BorderSpec {
  return typeof value === 'object' && value !== null && !('none' in value);
}

/**
 * Creates a deterministic hash string for a border spec (used in table/cell borders).
 * Ensures consistent ordering regardless of JS engine property enumeration.
 *
 * @param border - The border spec to hash
 * @returns A deterministic hash string in format "s:style,w:width,c:color,sp:space"
 */
export const hashBorderSpec = (border: BorderSpec): string => {
  const parts: string[] = [];
  if (border.style !== undefined) parts.push(`s:${border.style}`);
  if (border.width !== undefined) parts.push(`w:${border.width}`);
  if (border.color !== undefined) parts.push(`c:${border.color}`);
  if (border.space !== undefined) parts.push(`sp:${border.space}`);
  return parts.join(',');
};

/**
 * Creates a deterministic hash string for a table border value.
 * Handles the three-state value: null (inherit), { none: true } (explicit no border), or BorderSpec.
 *
 * @param borderValue - The table border value to hash
 * @returns A deterministic hash string:
 *   - Empty string for undefined
 *   - "null" for null (inherit from parent)
 *   - "none" for { none: true } (explicit no border)
 *   - Hash string for BorderSpec (e.g., "s:single,w:4,c:000000")
 * @example
 * hashTableBorderValue(undefined) // ""
 * hashTableBorderValue(null) // "null"
 * hashTableBorderValue({ none: true }) // "none"
 * hashTableBorderValue({ style: 'single', width: 4, color: '000000' }) // "s:single,w:4,c:000000"
 */
export const hashTableBorderValue = (borderValue: TableBorderValue | undefined): string => {
  if (borderValue === undefined) return '';
  if (borderValue === null) return 'null';
  if (isNoneBorder(borderValue)) return 'none';
  // At this point, borderValue is a BorderSpec (style, width, color, space)
  if (isBorderSpec(borderValue)) {
    return hashBorderSpec(borderValue);
  }
  // Fallback for unexpected types (should never happen with proper types)
  return '';
};

/**
 * Creates a deterministic hash string for table-level borders.
 * Hashes all six border positions (top, right, bottom, left, insideH, insideV) in a consistent order.
 *
 * @param borders - The table borders to hash
 * @returns A deterministic hash string with format "t:[top];r:[right];b:[bottom];l:[left];ih:[insideH];iv:[insideV]"
 *   where each border value is hashed using hashTableBorderValue. Empty string if borders is undefined.
 * @example
 * hashTableBorders(undefined) // ""
 * hashTableBorders({ top: { style: 'single', width: 4 } }) // "t:[s:single,w:4]"
 */
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

/**
 * Creates a deterministic hash string for cell-level borders.
 * Hashes all four sides (top, right, bottom, left) in a consistent order.
 *
 * @param borders - The cell borders to hash
 * @returns A deterministic hash string with format "t:[top];r:[right];b:[bottom];l:[left]"
 *   where each border is hashed using hashBorderSpec. Empty string if borders is undefined.
 * @example
 * hashCellBorders(undefined) // ""
 * hashCellBorders({ top: { style: 'single', width: 4, color: '000000' } }) // "t:[s:single,w:4,c:000000]"
 */
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

/**
 * Creates a deterministic hash string for paragraph-level attributes.
 * This is used for cache invalidation when paragraph formatting changes
 * (alignment, spacing, line height, indent, borders, shading, direction).
 *
 * The hash is deterministic to ensure consistent cache keys across different
 * JS engine property enumeration orders.
 *
 * @param attrs - The paragraph attributes to hash
 * @returns A deterministic hash string representing all paragraph attributes
 */
export const hashParagraphAttrs = (attrs: ParagraphAttrs | undefined): string => {
  if (!attrs) return '';

  const parts: string[] = [];

  // Alignment
  if (attrs.alignment) parts.push(`al:${attrs.alignment}`);

  // Spacing (includes line height)
  if (attrs.spacing) {
    const s = attrs.spacing;
    if (s.before !== undefined) parts.push(`sb:${s.before}`);
    if (s.after !== undefined) parts.push(`sa:${s.after}`);
    if (s.line !== undefined) parts.push(`sl:${s.line}`);
    if (s.lineRule) parts.push(`sr:${s.lineRule}`);
  }

  // Indentation
  if (attrs.indent) {
    const ind = attrs.indent;
    if (ind.left !== undefined) parts.push(`il:${ind.left}`);
    if (ind.right !== undefined) parts.push(`ir:${ind.right}`);
    if (ind.firstLine !== undefined) parts.push(`if:${ind.firstLine}`);
    if (ind.hanging !== undefined) parts.push(`ih:${ind.hanging}`);
  }

  // Borders
  if (attrs.borders) {
    parts.push(`br:${hashParagraphBorders(attrs.borders)}`);
  }

  // Shading
  if (attrs.shading) {
    const sh = attrs.shading;
    if (sh.fill) parts.push(`shf:${sh.fill}`);
    if (sh.color) parts.push(`shc:${sh.color}`);
  }

  // Direction
  const dir = getParagraphInlineDirection(attrs);
  if (dir) parts.push(`dir:${dir}`);

  return parts.join(':');
};

/**
 * Type guard to check if a run has a string property.
 *
 * @param run - The run to check
 * @param prop - The property name to check
 * @returns True if the run has the property and it's a string
 */
export const hasStringProp = (run: Run, prop: string): run is Run & Record<string, string> => {
  return prop in run && typeof (run as Record<string, unknown>)[prop] === 'string';
};

/**
 * Type guard to check if a run has a number property.
 *
 * @param run - The run to check
 * @param prop - The property name to check
 * @returns True if the run has the property and it's a number
 */
export const hasNumberProp = (run: Run, prop: string): run is Run & Record<string, number> => {
  return prop in run && typeof (run as Record<string, unknown>)[prop] === 'number';
};

/**
 * Type guard to check if a run has a boolean property.
 *
 * @param run - The run to check
 * @param prop - The property name to check
 * @returns True if the run has the property and it's a boolean
 */
export const hasBooleanProp = (run: Run, prop: string): run is Run & Record<string, boolean> => {
  return prop in run && typeof (run as Record<string, unknown>)[prop] === 'boolean';
};

/**
 * Safely gets a string property from a run, with type narrowing.
 *
 * @param run - The run to get the property from
 * @param prop - The property name
 * @returns The string value or empty string if not present
 */
export const getRunStringProp = (run: Run, prop: string): string => {
  if (hasStringProp(run, prop)) {
    return run[prop];
  }
  return '';
};

/**
 * Safely gets a number property from a run, with type narrowing.
 *
 * @param run - The run to get the property from
 * @param prop - The property name
 * @returns The number value or 0 if not present
 */
export const getRunNumberProp = (run: Run, prop: string): number => {
  if (hasNumberProp(run, prop)) {
    return run[prop];
  }
  return 0;
};

/**
 * Safely gets a boolean property from a run, with type narrowing.
 *
 * @param run - The run to get the property from
 * @param prop - The property name
 * @returns The boolean value or false if not present
 */
export const getRunBooleanProp = (run: Run, prop: string): boolean => {
  if (hasBooleanProp(run, prop)) {
    return run[prop];
  }
  return false;
};
