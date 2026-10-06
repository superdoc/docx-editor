/**
 * @superdoc/style-engine
 *
 * Resolves OOXML styles to normalized ComputedStyle objects that engines can consume.
 * This module owns the cascade rules (defaults -> styles -> numbering -> direct formatting).
 *
 * Tab Stops:
 * - Passes through OOXML TabStop values unchanged (positions in twips, val: start/end/etc.)
 * - No unit conversion happens here - preserves exact OOXML values for round-trip fidelity
 * - Conversion to pixels happens at measurement boundary only
 */

// Re-export cascade utilities - these are the SINGLE SOURCE OF TRUTH for property merging
export { combineProperties, combineRunProperties, combineIndentProperties, type PropertyObject } from './cascade.js';
import type {
  TabStop,
  FieldAnnotationMetadata,
  StructuredContentMetadata,
  DocumentSectionMetadata,
  DocPartMetadata,
  SdtMetadata,
} from '@superdoc/contracts';

export type {
  FieldAnnotationMetadata,
  StructuredContentMetadata,
  DocumentSectionMetadata,
  DocPartMetadata,
  SdtMetadata,
};

export type SdtNodeType =
  | 'fieldAnnotation'
  | 'structuredContent'
  | 'structuredContentBlock'
  | 'documentSection'
  | 'docPartObject';

export interface ResolveSdtMetadataInput {
  nodeType?: SdtNodeType | string | null;
  attrs?: Record<string, unknown> | null;
  /**
   * Optional cache key for reusing normalized metadata between identical SDT nodes.
   * When omitted, the helper derives a key from attrs.hash/id when available.
   */
  cacheKey?: string | null;
}

export interface ResolveStyleOptions {
  sdt?: ResolveSdtMetadataInput | null;
}

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface BorderStyle {
  style?: 'none' | 'solid' | 'dashed' | 'dotted' | 'double';
  width?: number;
  color?: string;
}

export interface ComputedParagraphStyle {
  alignment?: 'left' | 'center' | 'right' | 'justify';
  spacing?: {
    before?: number;
    after?: number;
    line?: number;
    lineRule?: 'auto' | 'exact' | 'atLeast';
  };
  indent?: {
    left?: number;
    right?: number;
    firstLine?: number;
    hanging?: number;
  };
  borders?: {
    top?: BorderStyle;
    right?: BorderStyle;
    bottom?: BorderStyle;
    left?: BorderStyle;
  };
  shading?: {
    fill?: string;
    pattern?: string;
  };
  tabs?: TabStop[];
}

export interface StyleContext {
  styles?: Record<string, unknown>;
  numbering?: Record<string, unknown>;
  theme?: Record<string, unknown>;
  defaults?: {
    paragraphFont?: string;
    fontSize?: number;
    paragraphFontFallback?: string;
    paragraphFontFamily?: string;
    decimalSeparator?: string;
    defaultTabIntervalTwips?: number;
  };
}

// ---------------------------------------------------------------------------
// Style resolution
// ---------------------------------------------------------------------------

const sdtMetadataCache = new Map<string, SdtMetadata>();

/**
 * Clears the internal SDT metadata cache.
 *
 * This is primarily useful for testing to ensure a clean state between test runs.
 * In production, the cache persists for the lifetime of the module to maximize performance.
 *
 * @example
 * ```typescript
 * import { clearSdtMetadataCache } from '@superdoc/style-engine';
 *
 * // Before each test
 * beforeEach(() => {
 *   clearSdtMetadataCache();
 * });
 * ```
 */
export function clearSdtMetadataCache(): void {
  sdtMetadataCache.clear();
}

/**
 * Normalizes Structured Document Tag (SDT) metadata into a stable contract shape.
 *
 * Supports the following SDT node types:
 * - `fieldAnnotation`: Inline field annotations with display labels, colors, and visibility
 * - `structuredContent` / `structuredContentBlock`: Inline or block-level structured content containers
 * - `documentSection`: Document section metadata with locks and descriptions
 * - `docPartObject`: Document part objects (e.g., TOC, bibliography)
 *
 * Results are cached by hash/id to avoid recomputing metadata for identical SDT instances.
 *
 * @param input - SDT node information including nodeType, attrs, and optional cacheKey
 * @returns Normalized SdtMetadata or undefined if nodeType is unsupported/missing
 *
 * @example
 * ```typescript
 * import { resolveSdtMetadata } from '@superdoc/style-engine';
 *
 * const metadata = resolveSdtMetadata({
 *   nodeType: 'fieldAnnotation',
 *   attrs: {
 *     fieldId: 'CLIENT_NAME',
 *     displayLabel: 'Client Name',
 *     fieldColor: '#980043',
 *     visibility: 'visible'
 *   }
 * });
 *
 * console.log(metadata?.type); // 'fieldAnnotation'
 * console.log(metadata?.fieldColor); // '#980043'
 * ```
 */
export function resolveSdtMetadata(input?: ResolveSdtMetadataInput | null): SdtMetadata | undefined {
  if (!input) return undefined;
  const { nodeType, attrs, cacheKey: explicitKey } = input;
  if (!nodeType) return undefined;
  const normalizedAttrs = isPlainObject(attrs) ? (attrs as Record<string, unknown>) : {};
  const cacheKey = buildSdtCacheKey(nodeType, normalizedAttrs, explicitKey);

  if (cacheKey && sdtMetadataCache.has(cacheKey)) {
    return sdtMetadataCache.get(cacheKey);
  }

  let metadata: SdtMetadata | undefined;

  switch (nodeType) {
    case 'fieldAnnotation':
      metadata = normalizeFieldAnnotationMetadata(normalizedAttrs);
      break;
    case 'structuredContent':
    case 'structuredContentBlock':
      metadata = normalizeStructuredContentMetadata(nodeType, normalizedAttrs);
      break;
    case 'documentSection':
      metadata = normalizeDocumentSectionMetadata(normalizedAttrs);
      break;
    case 'docPartObject':
      metadata = normalizeDocPartMetadata(normalizedAttrs);
      break;
  }

  if (metadata && cacheKey) {
    sdtMetadataCache.set(cacheKey, metadata);
  }

  return metadata;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeFieldAnnotationMetadata(attrs: Record<string, unknown>): FieldAnnotationMetadata {
  const fieldId = toOptionalString(attrs.fieldId) ?? '';
  const formatting = extractFormatting(attrs);
  const size = normalizeSize(attrs.size);
  const extras = isPlainObject(attrs.extras) ? (attrs.extras as Record<string, unknown>) : null;
  const marks = isPlainObject(attrs.marks) ? (attrs.marks as Record<string, unknown>) : undefined;
  return {
    type: 'fieldAnnotation',
    fieldId,
    variant: normalizeFieldAnnotationVariant(attrs.type),
    fieldType: toOptionalString(attrs.fieldType),
    displayLabel: toOptionalString(attrs.displayLabel),
    defaultDisplayLabel: toOptionalString(attrs.defaultDisplayLabel),
    alias: toOptionalString(attrs.alias),
    fieldColor: normalizeColorValue(attrs.fieldColor),
    borderColor: normalizeColorValue(attrs.borderColor),
    highlighted: toBoolean(attrs.highlighted, true),
    fontFamily: toNullableString(attrs.fontFamily),
    fontSize: normalizeFontSize(attrs.fontSize),
    textColor: normalizeColorValue(attrs.textColor) ?? null,
    textHighlight: normalizeColorValue(attrs.textHighlight) ?? null,
    linkUrl: toNullableString(attrs.linkUrl),
    imageSrc: toNullableString(attrs.imageSrc),
    rawHtml: attrs.rawHtml ?? undefined,
    size: size ?? null,
    extras,
    multipleImage: toBoolean(attrs.multipleImage, false),
    hash: toOptionalString(attrs.hash) ?? null,
    generatorIndex: toNumber(attrs.generatorIndex),
    sdtId: toOptionalString(attrs.sdtId) ?? null,
    hidden: toBoolean(attrs.hidden, false),
    visibility: normalizeVisibility(attrs.visibility),
    isLocked: toBoolean(attrs.isLocked, false),
    formatting,
    marks,
  };
}

function normalizeStructuredContentMetadata(
  nodeType: 'structuredContent' | 'structuredContentBlock',
  attrs: Record<string, unknown>,
): StructuredContentMetadata {
  const metadata: StructuredContentMetadata = {
    type: 'structuredContent',
    scope: nodeType === 'structuredContentBlock' ? 'block' : 'inline',
    id: toNullableString(attrs.id),
    tag: toOptionalString(attrs.tag),
    alias: toOptionalString(attrs.alias),
    lockMode: attrs.lockMode as StructuredContentMetadata['lockMode'],
    sdtPr: attrs.sdtPr,
  };
  const checkbox = normalizeStructuredContentCheckbox(attrs.checkbox);
  if (checkbox) metadata.checkbox = checkbox;
  // `appearance` comes from the SDT's <w15:appearance> element on import.
  // Only the three spec-defined values flow through; anything else is
  // discarded so a bad value doesn't poison rendering decisions.
  const rawAppearance = toOptionalString(attrs.appearance);
  if (rawAppearance === 'boundingBox' || rawAppearance === 'tags' || rawAppearance === 'hidden') {
    metadata.appearance = rawAppearance;
  }
  return metadata;
}

function normalizeStructuredContentCheckbox(value: unknown): StructuredContentMetadata['checkbox'] | undefined {
  if (!isPlainObject(value)) return undefined;
  const checkedSymbol = value.checkedSymbol;
  const uncheckedSymbol = value.uncheckedSymbol;
  if (!isPlainObject(checkedSymbol) || !isPlainObject(uncheckedSymbol)) return undefined;
  const checkedFont = toOptionalString(checkedSymbol.font);
  const checkedChar = toOptionalString(checkedSymbol.char);
  const uncheckedFont = toOptionalString(uncheckedSymbol.font);
  const uncheckedChar = toOptionalString(uncheckedSymbol.char);
  if (!checkedFont || !checkedChar || !uncheckedFont || !uncheckedChar) return undefined;
  const fontSize = toNumber(value.fontSize);
  return {
    checked: toBoolean(value.checked, false),
    checkedSymbol: { font: checkedFont, char: checkedChar },
    uncheckedSymbol: { font: uncheckedFont, char: uncheckedChar },
    ...(fontSize != null && fontSize > 0 ? { fontSize } : {}),
  };
}

function normalizeDocumentSectionMetadata(attrs: Record<string, unknown>): DocumentSectionMetadata {
  return {
    type: 'documentSection',
    id: toNullableString(attrs.id),
    title: toOptionalString(attrs.title) ?? null,
    description: toOptionalString(attrs.description) ?? null,
    sectionType: toOptionalString(attrs.sectionType) ?? null,
    isLocked: toBoolean(attrs.isLocked, false),
    sdBlockId: toNullableString(attrs.sdBlockId),
  };
}

function normalizeDocPartMetadata(attrs: Record<string, unknown>): DocPartMetadata {
  return {
    type: 'docPartObject',
    gallery: toOptionalString(attrs.docPartGallery ?? attrs.gallery) ?? null,
    // Source uniqueId from attrs.id (PM adapter uses getDocPartObjectId which extracts attrs.id)
    // Fall back to attrs.uniqueId for compatibility
    uniqueId: toOptionalString(attrs.id ?? attrs.uniqueId) ?? null,
    alias: toOptionalString(attrs.alias) ?? null,
    instruction: toOptionalString(attrs.instruction) ?? null,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toOptionalString(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
  }
  return String(value);
}

function toNullableString(value: unknown): string | null {
  const str = toOptionalString(value);
  return str ?? null;
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
  }
  if (value == null) return fallback;
  return Boolean(value);
}

function normalizeVisibility(value: unknown): 'visible' | 'hidden' | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.toLowerCase();
  if (normalized === 'visible' || normalized === 'hidden') {
    return normalized as 'visible' | 'hidden';
  }
  return undefined;
}

function normalizeColorValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === 'none') return undefined;
  return trimmed;
}

function normalizeFontSize(value: unknown): string | number | null {
  if (value == null) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeSize(value: unknown): { width?: number; height?: number } | null {
  if (!isPlainObject(value)) return null;
  const obj = value as Record<string, unknown>;
  const width = toNumber(obj.width);
  const height = toNumber(obj.height);
  if (width == null && height == null) return null;
  const result: { width?: number; height?: number } = {};
  if (width != null) result.width = width;
  if (height != null) result.height = height;
  return result;
}

function normalizeFieldAnnotationVariant(value: unknown): FieldAnnotationMetadata['variant'] | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.toLowerCase();
  if (
    normalized === 'text' ||
    normalized === 'image' ||
    normalized === 'signature' ||
    normalized === 'checkbox' ||
    normalized === 'html' ||
    normalized === 'link'
  ) {
    return normalized as FieldAnnotationMetadata['variant'];
  }
  return undefined;
}

function extractFormatting(attrs: Record<string, unknown>): FieldAnnotationMetadata['formatting'] | undefined {
  const bold = toBoolean(attrs.bold, false);
  const italic = toBoolean(attrs.italic, false);
  const underline = toBoolean(attrs.underline, false);
  const formatting: FieldAnnotationMetadata['formatting'] = {};
  if (bold) formatting.bold = true;
  if (italic) formatting.italic = true;
  if (underline) formatting.underline = true;
  return Object.keys(formatting).length ? formatting : undefined;
}

function buildSdtCacheKey(
  nodeType: string,
  attrs: Record<string, unknown>,
  explicitKey?: string | null,
): string | undefined {
  const provided = toOptionalString(explicitKey);
  if (provided) {
    return `${nodeType}:${provided}`;
  }

  const hash = toOptionalString(attrs.hash);
  if (hash) {
    return `${nodeType}:${hash}`;
  }

  const id = toOptionalString(attrs.id);
  if (id) {
    return `${nodeType}:${id}`;
  }

  return undefined;
}
